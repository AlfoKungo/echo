// Story: a serial (feuilleton) written for this learner, one episode at a time, in their zone of proximal
// development. Each episode is built from what they know: the vocabulary they practise or have understood in
// Read and Listen, the words earlier episodes taught, and grammar at their Read level. On top it adds a few new
// words and one grammar point just ahead of them. A checker counts every running word: at least the plan's
// share must be known, and every unknown word must be one of the episode's few new ones.
//
// How the learner did sets the next episode: few taps, few lines opened and every question right make it a
// step harder; many taps or wrong answers make it a step easier. The words they tapped, and the ones the last
// episodes taught, come back in the next. Claude (Opus) writes and then reviews each episode; episodes live in
// <data>/story as episode-NN.json and are recorded line by line (scripts/render-clips.py --set story).
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GrammarLevel } from '../contract';
import type { Gloss } from '../comprehension-contract';
import { unglossed, wholeMatches, wordCount } from './comprehension-content';
import type { Ask } from './claude';
import { StoreError } from './store';

// gender: on a noun, from Claude; the client colours a linked word by the vocabulary's own gender first.
export type StoryGloss = Gloss & { new?: true; name?: true; gender?: 'masculine' | 'feminine' };
export type StoryLine = { fr: string; en: string; speaker?: string };
export type StoryQuestion = { question: string; choices: string[]; answer: number; explanation: string };
export type StoryEpisode = {
  id: string; number: number; title: string; titleEn: string; level: GrammarLevel; step: number;
  focus: { topic: string; title: string; note: string };
  lines: StoryLine[]; gloss: StoryGloss[]; questions: StoryQuestion[];
  // The gloss "fr" of the episode's new words, and of the earlier words it brought back.
  newWords: string[]; recycled: string[];
  summary: string; coverage: number; writtenAt: string;
};
export type StoryBible = { premise: string; characters: { name: string; about: string }[] };
// What the learner knows now, from the vocabulary, Read/Listen and grammar stores (wired in server.ts).
export type StoryKnowledge = {
  known: { id: string; fr: string; en: string }[];
  deck: { id: string; fr: string }[];
  forms: string[];
  level: number;
  topics: { id: string; title: string; level: GrammarLevel; description: string; seen: number; independent: number }[];
};
export type StoryRead = { taps: string[]; linesOpened: number; right: number; total: number; finishedAt: string };
export type StoryFinish = { taps: string[]; linesOpened: number; answers: number[]; requestId: string };
export type StoryPlan = { step: number; level: GrammarLevel; newWords: [number, number]; coverage: number; lines: [number, number]; words: number };

export const MAX_STEP = 10;
const REPAIRS = 3;
const RETRY_AFTER = 30 * 60_000;
const TIMEOUT = 20 * 60_000;
const RECYCLE = 8;
const LEVEL_RANK: Record<GrammarLevel, number> = { A1: 1, A2: 2, B1: 3 };
// Words a reader never needs to tap (lib/comprehension-content.ts leaves them unglossed too).
const LITTLE = 'le la les l’ un une des de du d’ à au aux et ou mais je j’ tu il elle on nous vous ils elles ne n’ pas que qu’ ce c’ se s’ me m’ te t’ y en';
const LITTLE_WORDS = new Set(LITTLE.split(' '));
const TOKEN = /[\p{L}\p{M}]+([’'])?/gu;

// The step sets everything the episode is asked for: its level, how many new words, the share of running words
// the learner must know, and its length.
export function planFor(step: number): StoryPlan {
  const s = Math.max(0, Math.min(MAX_STEP, Math.round(step)));
  const extra = Math.floor(s / 3);
  return {
    step: s, level: s < 3 ? 'A1' : s < 8 ? 'A2' : 'B1',
    newWords: [3 + extra, 5 + extra], coverage: Math.round((0.96 - 0.006 * s) * 1000) / 1000,
    lines: [8 + Math.floor(s / 2), 12 + Math.floor(s / 2)], words: 90 + 14 * s,
  };
}
// The first episode starts where Read is: level 1 (A1) is step 0, level 2.3 (A2) step 5.
export const firstStep = (readLevel: number) => Math.max(0, Math.min(MAX_STEP, Math.round((readLevel - 1) * 3.5)));

// How the learner did on one episode moves the next one: easy (few taps, few lines opened, every answer right)
// a step up, hard (many taps, many lines opened, or half the answers wrong) a step down.
export function nextStep(step: number, read: StoryRead, episode: Pick<StoryEpisode, 'gloss' | 'lines'>): number {
  const tapShare = new Set(read.taps).size / Math.max(1, episode.gloss.length);
  const lineShare = read.linesOpened / Math.max(1, episode.lines.length);
  const answers = read.total ? read.right / read.total : 1;
  if (tapShare <= 0.05 && lineShare <= 0.1 && answers === 1) return Math.min(MAX_STEP, step + 1);
  if (tapShare > 0.15 || lineShare > 0.35 || answers < 0.5) return Math.max(0, step - 1);
  return step;
}

// The glosses in the text, longest first so "il y a" wins over "a", each stretch of text taken once: the spans
// each gloss entry covers (the client marks words the same way).
function spans(text: string, gloss: StoryGloss[]): { entry: StoryGloss; at: number; end: number }[] {
  const taken = new Array(text.length).fill(false);
  const found: { entry: StoryGloss; at: number; end: number }[] = [];
  for (const entry of [...gloss].sort((a, b) => b.fr.length - a.fr.length)) {
    for (const at of wholeMatches(text, entry.fr)) {
      const end = at + entry.fr.length;
      if (taken.slice(at, end).some(Boolean)) continue;
      for (let i = at; i < end; i++) taken[i] = true;
      found.push({ entry, at, end });
    }
  }
  return found;
}

export type StoryCheck = {
  known: { ids: Set<string>; forms: Set<string> };      // what the learner knows, forms lowercased
  introduced: { ids: Set<string>; forms: Set<string> }; // what earlier episodes taught or the learner tapped
  deck: Set<string>;
  recycle: { fr: string; word?: string }[];
  plan: StoryPlan;
};
const formKnown = (form: string, check: StoryCheck) => LITTLE_WORDS.has(form) || check.known.forms.has(form) || check.introduced.forms.has(form);
// Known: a name, a word linked to a known vocabulary entry, a known form, or a phrase every part of which is
// known (c’est, il y a), since links to the vocabulary are not always given.
const isKnown = (entry: StoryGloss, check: StoryCheck) => !!entry.name
  || (entry.word !== undefined && (check.known.ids.has(entry.word) || check.introduced.ids.has(entry.word)))
  || formKnown(entry.fr.toLowerCase(), check)
  || [...entry.fr.toLowerCase().matchAll(TOKEN)].every((match) => formKnown(match[0].replace(/'$/, '’'), check));

// Marks each gloss entry new or not from what the learner knows (Claude's own flags are only its intent), and
// counts the running words they know.
export function measure(episode: Pick<StoryEpisode, 'lines' | 'gloss'>, check: StoryCheck) {
  const gloss = episode.gloss.map((entry): StoryGloss => {
    const { new: _new, ...rest } = entry;
    return isKnown(rest, check) ? rest : { ...rest, new: true };
  });
  let tokens = 0, unknown = 0;
  const used = new Set<string>();
  for (const line of episode.lines) {
    const covered = spans(line.fr, gloss);
    for (const span of covered) used.add(span.entry.fr);
    for (const match of line.fr.matchAll(TOKEN)) {
      tokens += 1;
      const at = match.index!;
      if (covered.some((span) => span.entry.new && span.at <= at && at < span.end)) unknown += 1;
    }
  }
  const newWords = gloss.filter((entry) => entry.new && used.has(entry.fr)).map((entry) => entry.fr);
  return { gloss, newWords, coverage: tokens ? Math.round((1 - unknown / tokens) * 1000) / 1000 : 0, used, tokens, unknown };
}

// Every problem in an episode, so Claude can fix them all at once.
export function storyProblems(episode: StoryEpisode, check: StoryCheck): string[] {
  const problems: string[] = [];
  const plain = (label: string, value: unknown) => {
    if (typeof value !== 'string' || !value.trim() || /<\/?[A-Za-z][^>]*>/.test(value)) { problems.push(`${label} must be plain text.`); return false; }
    if (value !== value.trim() || /\s{2,}/.test(value)) problems.push(`${label} has stray spaces.`);
    return true;
  };
  const french = (label: string, value: unknown) => {
    if (!plain(label, value)) return;
    const text = value as string;
    if (text.includes("'")) problems.push(`${label} uses ' — write French with ’.`);
    if (!/[.!?…»]$/.test(text)) problems.push(`${label} must end with . ! ? … or »`);
    if (/[^\s«][?!:;]/.test(text.replace(/[?!]{2,}/g, '?'))) problems.push(`${label} needs a space before ? ! : ; in French.`);
  };
  plain('title', episode.title);
  plain('titleEn', episode.titleEn);
  plain('summary', episode.summary);
  plain('focusNote', episode.focus?.note);
  // The lower end of the new-word range is only asked for: an episode with fewer new words is easier, not wrong.
  const { lines: [least, most], words, newWords: [, mostNew], coverage } = check.plan;
  if (!Array.isArray(episode.lines) || episode.lines.length < least || episode.lines.length > most) problems.push(`write ${least}–${most} lines (there are ${episode.lines?.length ?? 0}).`);
  (episode.lines ?? []).forEach((line, index) => {
    french(`line ${index + 1} fr`, line?.fr);
    plain(`line ${index + 1} en`, line?.en);
    if (line?.speaker !== undefined && !(typeof line.speaker === 'string' && line.speaker.trim())) problems.push(`line ${index + 1}: a speaker must be a name.`);
  });
  const lines = (episode.lines ?? []).filter((line) => typeof line?.fr === 'string');
  const text = lines.map((line) => line.fr).join('\n');
  if (wordCount(text) > words) problems.push(`has ${wordCount(text)} French words; this episode takes at most ${words}.`);
  if (!Array.isArray(episode.questions) || episode.questions.length !== 3) problems.push('needs exactly 3 questions.');
  else episode.questions.forEach((question, index) => {
    plain(`question ${index + 1}`, question?.question);
    plain(`question ${index + 1} explanation`, question?.explanation);
    if (!Array.isArray(question?.choices) || question.choices.length < 3 || question.choices.length > 4) { problems.push(`question ${index + 1} needs 3–4 choices.`); return; }
    question.choices.forEach((choice) => plain(`question ${index + 1} choice`, choice));
    if (new Set(question.choices.map((choice) => String(choice).toLowerCase())).size !== question.choices.length) problems.push(`question ${index + 1} repeats a choice.`);
    if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.choices.length) problems.push(`question ${index + 1} answer must index its choices.`);
  });
  if (!Array.isArray(episode.gloss) || !episode.gloss.length) return [...problems, 'gloss must list the content words.'];
  const seen = new Set<string>();
  for (const entry of episode.gloss) {
    if (!entry || !plain('gloss fr', entry.fr) || !plain(`gloss en for ${entry.fr}`, entry.en)) continue;
    if (seen.has(entry.fr)) problems.push(`gloss repeats ${entry.fr}.`);
    seen.add(entry.fr);
    if (!wholeMatches(text, entry.fr).length) problems.push(`gloss "${entry.fr}" is not a whole word or phrase in the French.`);
    if (entry.word !== undefined && !check.deck.has(entry.word)) problems.push(`gloss "${entry.fr}" links unknown vocabulary id ${entry.word}.`);
    if (entry.name && !/^\p{Lu}/u.test(entry.fr)) problems.push(`gloss "${entry.fr}" is marked as a name but does not start with a capital.`);
  }
  const missing = [...new Set(lines.flatMap((line) => unglossed(line.fr, episode.gloss)))];
  if (missing.length) problems.push(`no gloss covers ${missing.join(', ')}.`);
  const measured = measure(episode, check);
  if (measured.newWords.length > mostNew) problems.push(`uses ${measured.newWords.length} words the learner does not know (${measured.newWords.join(', ')}); at most ${mostNew} may be new. Replace the others with words from the known list.`);
  if (measured.coverage < coverage) problems.push(`${measured.unknown} of the ${measured.tokens} running words are new words; at most ${Math.floor(measured.tokens * (1 - coverage))} may be (${Math.round(coverage * 100)}% must be known). Use the new words less often, or write more with known words.`);
  const back = check.recycle.filter((word) => measured.gloss.some((entry) => measured.used.has(entry.fr) && ((word.word && entry.word === word.word) || entry.fr.toLowerCase() === word.fr.toLowerCase())));
  const wanted = Math.ceil(check.recycle.length / 2);
  if (back.length < wanted) problems.push(`brings back ${back.length} of the words to reuse; use at least ${wanted} of: ${check.recycle.map((word) => word.fr).join(', ')}.`);
  return problems;
}

// ── Prompts ──────────────────────────────────────────────────────────────────

type Context = { number: number; plan: StoryPlan; knowledge: StoryKnowledge; introduced: { fr: string; en: string }[]; recycle: { fr: string; en: string }[]; focus: StoryKnowledge['topics'][number]; bible: StoryBible | null; previous: StoryEpisode[] };

const FIELDS = `The episode is JSON:
{"title": "a short French title", "titleEn": "its English",
 "lines": [{"fr": "...", "en": "...", "speaker": "Name (only on a line of dialogue)"}],
 "gloss": [{"fr": "...", "en": "...", "word": "vocabulary id, when it is that word", "new": true, "name": true}],
 "questions": [{"question": "...", "choices": ["RIGHT ANSWER FIRST", "...", "..."], "explanation": "..."}],
 "focusNote": "...", "summary": "..."}
- "lines": narration and dialogue. A line is one or two sentences. A line of dialogue has a "speaker" and its "fr" is only what they say, without quotation marks or dashes.
- French uses the typographic apostrophe ’ and a space before ? ! : ; Every line ends with . ! ? or …
- "gloss": one entry for EVERY word in the French except these little words: ${LITTLE}. A fixed expression (il y a, tout à coup) may be one entry. "fr" is the exact text as it appears (same case and apostrophe); an elided word keeps what is joined to it ("l’arbre", not "arbre"; "d’eau", not "eau"). "en" its meaning here (for a verb, add the infinitive: "is waiting (attendre)"); "word" the vocabulary id when the text is a form of that deck word, from either list. "gender": "masculine" or "feminine" on a noun. "new": true on each new word. "name": true on the names of people and places. Never list the same "fr" twice.
- "questions": exactly 3 questions in English about what happens, each answerable only by understanding the French; 3–4 short English choices, the right one FIRST (Echo shuffles them); "explanation": one English sentence quoting the French that decides it.
- "focusNote": two or three English sentences on the grammar focus, quoting one example from the episode.
- "summary": two or three English sentences saying what happened in this episode, for the "previously" at the start of the next.
- English is natural English. Plain text only, no markup.`;

function writePrompt(ctx: Context): string {
  const { plan, knowledge } = ctx;
  const comfortable = knowledge.topics.filter((topic) => topic.seen > 0 || LEVEL_RANK[topic.level] < LEVEL_RANK[plan.level]).map((topic) => topic.title);
  const knownIds = new Set(knowledge.known.map((word) => word.id));
  const story = ctx.bible
    ? `THE STORY SO FAR
Premise: ${ctx.bible.premise}
Characters: ${ctx.bible.characters.map((person) => `${person.name}: ${person.about}`).join('; ')}
${ctx.previous.map((episode) => `Episode ${episode.number}, "${episode.title}": ${episode.summary}`).join('\n')}
The last episode in full:
${ctx.previous.at(-1)!.lines.map((line) => `${line.speaker ? `${line.speaker}: ` : ''}${line.fr}`).join('\n')}

Continue from there. Keep the characters, places and tone; move the story on.`
    : `THE STORY
This is episode 1. Invent the story: everyday life with a small mystery or goal that can run for many episodes, a few characters (French first names), one French town or city. Nothing violent or sad. Also reply with "premise" (three English sentences: who, where, what is going on) and "characters" ([{"name": "...", "about": "one English line"}]).`;
  return `You write a serial story in French, a feuilleton, for Echo: an app for one English speaker learning French. Each episode is read by that learner, so it must sit just above what they can do: nearly every word one they already know, a handful of new words, one grammar point a step ahead. Write episode ${ctx.number}.

THE LEARNER
- Reads French at about ${plan.level}. Grammar they handle: ${comfortable.join('; ')}.
- Words they know ("id french — english"; any form of them is fine: a conjugated verb, a plural, a feminine):
${knowledge.known.map((word) => `${word.id} ${word.fr} — ${word.en}`).join('\n')}
- Words they have read and understood (forms): ${knowledge.forms.join(', ')}
${ctx.introduced.length ? `- Words earlier episodes taught them: ${ctx.introduced.map((word) => word.fr).join(', ')}\n` : ''}
THIS EPISODE
- ${plan.lines[0]}–${plan.lines[1]} lines and at most ${plan.words} French words in all.
- Build it from the words above, the little words (${LITTLE}) and names, plus ${plan.newWords[0]}–${plan.newWords[1]} NEW words: everyday words the learner will meet again, guessable from the story around them, each used once or twice. At least ${Math.round(plan.coverage * 100)}% of the running words must be known: at most one new word in every ${Math.floor(1 / (1 - plan.coverage))} running words, counting repeats. A checker counts this, so when in doubt use a word from the list.
${ctx.recycle.length ? `- Bring back at least ${Math.ceil(ctx.recycle.length / 2)} of these words the learner looked up or learned in the last episodes: ${ctx.recycle.map((word) => `${word.fr} (${word.en})`).join(', ')}.\n` : ''}- Grammar focus: "${ctx.focus.title}" (${ctx.focus.description}). Use it naturally three to five times. All other grammar stays at the learner's level.
- End on a small hook that makes the learner want the next episode.

${story}

Other deck words, for "word" links only (the learner does not know these; any you use counts as new):
${knowledge.deck.filter((word) => !knownIds.has(word.id)).map((word) => `${word.id} ${word.fr}`).join('\n')}

${FIELDS}

Reply with only JSON: the episode object${ctx.bible ? '' : ' with "premise" and "characters"'}.`;
}

function repairPrompt(ctx: Context, raw: unknown, problems: string[]): string {
  const knownIds = new Set(ctx.knowledge.known.map((word) => word.id));
  return `You wrote this episode of a French serial story for Echo, an app for one English speaker learning French at about ${ctx.plan.level}. A checker found problems. Fix every one and keep the story the same. When the problem is unknown words, replace them with words the learner knows:
${ctx.knowledge.known.map((word) => `${word.id} ${word.fr}`).join('\n')}
Also known (forms): ${ctx.knowledge.forms.join(', ')}${ctx.introduced.length ? `, ${ctx.introduced.map((word) => word.fr).join(', ')}` : ''}
Other deck words (unknown; for "word" links): ${ctx.knowledge.deck.filter((word) => !knownIds.has(word.id)).map((word) => `${word.id} ${word.fr}`).join(', ')}

${FIELDS}

Problems:
${problems.map((problem) => `- ${problem}`).join('\n')}

The episode:
${JSON.stringify(raw)}

Reply with only JSON: the whole fixed episode object.`;
}

function reviewPrompt(ctx: Context, raw: unknown): string {
  return `You are a French teacher checking an episode of a French serial story written for one English speaker learning French at about ${ctx.plan.level}, before they read it. Fix anything wrong:
1. The French: correct, natural and standard; tenses and agreements right; typography (’ and a space before ? ! : ;).
2. Each line's "en" says what the French says.
3. Each gloss "en" is right for this context; a "word" link names the vocabulary entry that really is this word, else drop the link; "name" only on names.
4. The questions: each answerable from the French alone, with one right answer, listed first; the explanation quotes the French that decides it.
5. "summary" and "focusNote" match the episode.
Keep the vocabulary: do not bring in words that are not already in the episode, and keep every line unless it is wrong.

${FIELDS}

The episode:
${JSON.stringify(raw)}

Reply with only JSON: {"episode": {the whole episode, fixed}, "changes": ["one short line per change"]}`;
}

// ── Building ─────────────────────────────────────────────────────────────────

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
function json(reply: string): Record<string, unknown> {
  const body = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1);
  try { return JSON.parse(body); } catch { throw new Error('Claude did not reply with JSON.'); }
}
// ’ and a space before ? ! : ; slip easily, so they are set here rather than sent back.
const typography = (value: string) => value.replace(/'/g, '’').replace(/([^\s?!«])([?!:;])/g, '$1 $2').replace(/\s{2,}/g, ' ').trim();

export function buildEpisode(raw: Record<string, unknown>, base: { number: number; plan: StoryPlan; focus: { topic: string; title: string } }, check: StoryCheck, random: () => number, now: Date): StoryEpisode {
  const lines = list(raw.lines).map((entry) => {
    const line = entry as Record<string, unknown>;
    const speaker = text(line.speaker);
    return { fr: typography(text(line.fr)), en: text(line.en), ...(speaker ? { speaker } : {}) };
  });
  const gloss = list(raw.gloss).flatMap((entry): StoryGloss[] => {
    const item = entry as Record<string, unknown>;
    const fr = text(item.fr).replace(/'/g, '’'), en = text(item.en);
    if (!fr || !en) return [];
    const gender = item.gender === 'masculine' || item.gender === 'feminine' ? item.gender : undefined;
    return [{ fr, en, ...(typeof item.word === 'string' && item.word ? { word: item.word } : {}), ...(gender ? { gender } : {}), ...(item.name === true ? { name: true as const } : {}), ...(item.new === true ? { new: true as const } : {}) }];
  });
  const questions = list(raw.questions).map((entry) => {
    const question = entry as Record<string, unknown>;
    const choices = list(question.choices).map(text);
    const order = choices.map((_, index) => index);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; }
    return { question: text(question.question), choices: order.map((index) => choices[index]!), answer: order.indexOf(0), explanation: text(question.explanation) };
  });
  const episode: StoryEpisode = {
    id: `story-${String(base.number).padStart(2, '0')}`, number: base.number, title: typography(text(raw.title)), titleEn: text(raw.titleEn),
    level: base.plan.level, step: base.plan.step, focus: { ...base.focus, note: text(raw.focusNote) },
    lines, gloss, questions, newWords: [], recycled: [], summary: text(raw.summary), coverage: 0, writtenAt: now.toISOString(),
  };
  const measured = measure(episode, check);
  const recycled = check.recycle.filter((word) => measured.gloss.some((entry) => measured.used.has(entry.fr) && ((word.word && entry.word === word.word) || entry.fr.toLowerCase() === word.fr.toLowerCase()))).map((word) => word.fr);
  return { ...episode, gloss: measured.gloss, newWords: measured.newWords, coverage: measured.coverage, recycled };
}

// ── The store ────────────────────────────────────────────────────────────────

export type StoryStatus = { episodes: { number: number; title: string; titleEn: string; finished: boolean }[]; writing: boolean; error: string | null; step: number | null };
export type StoryView = { episode: StoryEpisode; read: StoryRead | null; previously: string | null; audio: (string | null)[]; last: boolean; next: 'harder' | 'same' | 'easier' | null };

export function createStory(options: {
  dir: string; dbPath: string; ask: Ask; knowledge: () => StoryKnowledge;
  record: (clipIds: string[]) => Promise<unknown>; clipExists: (clipId: string) => boolean;
  random?: () => number; now?: () => Date;
}) {
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => new Date());
  const db = new Database(options.dbPath, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
    -- How the learner read one story episode: the words they tapped, the lines whose meaning they opened, their answers.
    CREATE TABLE IF NOT EXISTS story_reads (
      episode_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, taps_json TEXT NOT NULL, lines_opened INTEGER NOT NULL,
      right INTEGER NOT NULL, total INTEGER NOT NULL, finished_at TEXT NOT NULL
    );
  `);
  const readOf = db.query<{ taps_json: string; lines_opened: number; right: number; total: number; finished_at: string }, [string]>('SELECT * FROM story_reads WHERE episode_id = ?');
  const saveRead = db.query('INSERT OR IGNORE INTO story_reads (episode_id, request_id, taps_json, lines_opened, right, total, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  let failedAt = -Infinity;
  let lastError: string | null = null;

  const file = (number: number) => join(options.dir, `episode-${String(number).padStart(2, '0')}.json`);
  const bibleFile = join(options.dir, 'bible.json');
  function episodes(): StoryEpisode[] {
    if (!existsSync(options.dir)) return [];
    return readdirSync(options.dir).filter((name) => /^episode-\d+\.json$/.test(name)).sort()
      .map((name) => JSON.parse(readFileSync(join(options.dir, name), 'utf8')) as StoryEpisode);
  }
  const bible = (): StoryBible | null => existsSync(bibleFile) ? JSON.parse(readFileSync(bibleFile, 'utf8')) : null;
  function read(episode: StoryEpisode): StoryRead | null {
    const row = readOf.get(episode.id);
    return row ? { taps: JSON.parse(row.taps_json), linesOpened: row.lines_opened, right: row.right, total: row.total, finishedAt: row.finished_at } : null;
  }
  const clipIds = (episode: StoryEpisode) => episode.lines.map((_, index) => `${episode.id}-${index + 1}`);
  const write = (path: string, value: unknown) => { mkdirSync(options.dir, { recursive: true }); writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 1)); renameSync(`${path}.tmp`, path); };

  // The step the next episode is written at: the first from the Read level, then each finished episode moves it.
  function stepAfter(all: StoryEpisode[], knowledge: () => StoryKnowledge): number {
    const last = all.at(-1);
    if (!last) return firstStep(knowledge().level);
    const done = read(last);
    return done ? nextStep(last.step, done, last) : last.step;
  }

  // Grammar focus: the first topic, in course order, at or below the episode's level that the learner has not
  // made their own (fewer than five answered alone), not the focus of the last two episodes.
  function focusFor(plan: StoryPlan, knowledge: StoryKnowledge, previous: StoryEpisode[]) {
    const recent = new Set(previous.slice(-2).map((episode) => episode.focus.topic));
    const within = knowledge.topics.filter((topic) => LEVEL_RANK[topic.level] <= LEVEL_RANK[plan.level]);
    return within.find((topic) => topic.independent < 5 && !recent.has(topic.id)) ?? within.find((topic) => !recent.has(topic.id)) ?? knowledge.topics[0]!;
  }

  function contextFor(number: number, all: StoryEpisode[]) {
    const knowledge = options.knowledge();
    const plan = planFor(stepAfter(all, () => knowledge));
    const introduced = new Map<string, { fr: string; en: string; word?: string }>();
    for (const episode of all) {
      const tapped = new Set(read(episode)?.taps ?? []);
      for (const entry of episode.gloss) if (entry.new || tapped.has(entry.fr)) introduced.set(entry.fr.toLowerCase(), { fr: entry.fr, en: entry.en, ...(entry.word ? { word: entry.word } : {}) });
    }
    // Brought back next: the words tapped in the last episode, then the new words of the last two.
    const recycle = new Map<string, { fr: string; en: string; word?: string }>();
    const last = all.at(-1);
    const tappedLast = new Set(last ? read(last)?.taps ?? [] : []);
    for (const entry of last?.gloss ?? []) if (tappedLast.has(entry.fr) && !entry.name) recycle.set(entry.fr.toLowerCase(), entry);
    for (const episode of all.slice(-2).reverse()) for (const entry of episode.gloss) if (entry.new) recycle.set(entry.fr.toLowerCase(), entry);
    const focus = focusFor(plan, knowledge, all);
    const check: StoryCheck = {
      known: { ids: new Set(knowledge.known.map((word) => word.id)), forms: new Set(knowledge.forms.map((form) => form.toLowerCase())) },
      introduced: { ids: new Set([...introduced.values()].flatMap((word) => word.word ? [word.word] : [])), forms: new Set(introduced.keys()) },
      deck: new Set(knowledge.deck.map((word) => word.id)),
      recycle: [...recycle.values()].slice(0, RECYCLE).map((word) => ({ fr: word.fr, ...(word.word ? { word: word.word } : {}) })),
      plan,
    };
    const ctx: Context = { number, plan, knowledge, introduced: [...introduced.values()], recycle: [...recycle.values()].slice(0, RECYCLE), focus, bible: bible(), previous: all };
    return { ctx, check };
  }

  // Writes the next episode: Claude writes, the checker counts, broken episodes go back up to REPAIRS times, then
  // Claude reviews it as a teacher. A review that breaks a rule is repaired, or dropped for the checked version.
  async function writeNext(): Promise<StoryEpisode> {
    const all = episodes();
    const number = all.length + 1;
    const { ctx, check } = contextFor(number, all);
    const base = { number, plan: ctx.plan, focus: { topic: ctx.focus.id, title: ctx.focus.title } };
    const build = (raw: Record<string, unknown>) => buildEpisode(raw, base, check, random, now());
    const settle = async (start: Record<string, unknown>) => {
      let raw = start;
      for (let round = 0; ; round++) {
        const problems = storyProblems(build(raw), check);
        if (!problems.length) return raw;
        if (round === REPAIRS) throw new Error(`episode ${number} still broke ${problems.length} rules after ${REPAIRS} repairs: ${problems.slice(0, 3).join(' ')}`);
        console.log(`story: episode ${number} has ${problems.length} problems; sending them back: ${problems.map((problem) => problem.slice(0, 160)).join(' | ')}`);
        raw = json(await options.ask(repairPrompt(ctx, raw, problems), { timeout: TIMEOUT, purpose: 'fixing the story episode' }));
      }
    };
    const written = json(await options.ask(writePrompt(ctx), { timeout: TIMEOUT, purpose: 'writing the story episode' }));
    const checked = await settle(written);
    const reviewed = json(await options.ask(reviewPrompt(ctx, checked), { timeout: TIMEOUT, purpose: 'reviewing the story episode' }));
    const changes = list(reviewed.changes).map(text).filter(Boolean);
    let final = checked;
    if (reviewed.episode && typeof reviewed.episode === 'object') {
      try { final = await settle(reviewed.episode as Record<string, unknown>); }
      catch (error) { console.error(`story: the review of episode ${number} could not be kept (${(error as Error).message}); using the checked version`); }
    }
    if (number === 1) {
      const premise = text(written.premise);
      const characters = list(written.characters).flatMap((entry) => { const person = entry as Record<string, unknown>; return text(person.name) ? [{ name: text(person.name), about: text(person.about) }] : []; });
      if (!premise) throw new Error('episode 1 came without its premise.');
      write(bibleFile, { premise, characters } satisfies StoryBible);
    }
    const episode = build(final);
    write(file(number), episode);
    console.log(`story: episode ${number} written at step ${episode.step} (${episode.level}, ${Math.round(episode.coverage * 100)}% known, new: ${episode.newWords.join(', ')}; ${changes.length} review changes)`);
    return episode;
  }

  // Writes an episode when there is none yet, or the last is finished; records any line not yet recorded. A check
  // already running is returned, so a caller (the Radio) can wait for the episode it is writing.
  let running: Promise<void> | null = null;
  function check(): Promise<void> {
    if (running) return running;
    running = (async () => {
      let all = episodes();
      const last = all.at(-1);
      if ((!last || read(last)) && now().getTime() - failedAt >= RETRY_AFTER) {
        try { await writeNext(); lastError = null; all = episodes(); }
        catch (error) { failedAt = now().getTime(); lastError = (error as Error).message; console.error(`story: could not write the next episode: ${lastError}`); }
      }
      const missing = all.flatMap(clipIds).filter((id) => !options.clipExists(id));
      if (missing.length) await options.record(missing);
    })().finally(() => { running = null; });
    return running;
  }

  function status(): StoryStatus {
    const all = episodes();
    const last = all.at(-1);
    return {
      episodes: all.map((episode) => ({ number: episode.number, title: episode.title, titleEn: episode.titleEn, finished: !!read(episode) })),
      writing: !!running || !last || !!read(last), error: lastError, step: last ? last.step : null,
    };
  }

  function view(number: number): StoryView {
    const all = episodes();
    const episode = all.find((entry) => entry.number === number);
    if (!episode) throw new StoreError('That episode has not been written yet.', 404);
    const done = read(episode);
    const next = done ? nextStep(episode.step, done, episode) : null;
    return {
      episode, read: done, previously: all.find((entry) => entry.number === number - 1)?.summary ?? null,
      audio: clipIds(episode).map((id) => options.clipExists(id) ? `audio/story/${id}.mp3` : null), last: number === all.length,
      next: next === null ? null : next > episode.step ? 'harder' : next < episode.step ? 'easier' : 'same',
    };
  }

  // Finishing is kept once per episode; it lets the next episode be written, at a step set by how it went.
  function finish(number: number, input: StoryFinish): StoryView {
    const episode = episodes().find((entry) => entry.number === number);
    if (!episode) throw new StoreError('That episode has not been written yet.', 404);
    if (typeof input?.requestId !== 'string' || !input.requestId) throw new StoreError('This finish is missing its request ID.');
    if (!Array.isArray(input.answers) || input.answers.length !== episode.questions.length || !input.answers.every((answer) => Number.isInteger(answer))) throw new StoreError('Answer every question first.');
    const glossed = new Set(episode.gloss.map((entry) => entry.fr));
    const taps = [...new Set(list(input.taps).filter((fr): fr is string => typeof fr === 'string' && glossed.has(fr)))];
    const opened = Math.max(0, Math.min(episode.lines.length, Math.round(Number(input.linesOpened) || 0)));
    const right = episode.questions.filter((question, index) => question.answer === input.answers[index]).length;
    saveRead.run(episode.id, input.requestId, JSON.stringify(taps), opened, right, episode.questions.length, now().toISOString());
    void check();
    return view(number);
  }

  // An episode's recorded line clips, in order, for the Radio.
  const clipsOf = (number: number) => { const episode = episodes().find((entry) => entry.number === number); return episode ? clipIds(episode).filter(options.clipExists) : []; };

  return { status, view, finish, check, episodes, clipsOf, close: () => db.close() };
}
export type Story = ReturnType<typeof createStory>;
