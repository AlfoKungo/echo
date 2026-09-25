// Keeps Listen and Read from running out: when a level in reach has fewer than LOW unseen sentences or
// dialogues/texts, Claude (Opus) writes a new lane for it on a theme that level does not have yet. Claude supplies
// the French, English, glosses and questions; this code builds the lane (ids, level, answer order, vocabulary links)
// and checks it with the same rules as the written lanes, sending any broken item back to be fixed. The lane is
// recorded with scripts/render-clips.py, then joins practice. Lanes wait in <data>/comprehension-pending until
// recorded and live in <data>/comprehension after that.
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GrammarLevel } from '../contract';
import type { ComprehensionLane, ComprehensionPassage, ComprehensionSentence, Gloss } from '../comprehension-contract';
import { laneProblems, loadKnown, PASSAGE_WORDS, SENTENCE_WORDS, type Known } from './comprehension-content';
import type { Ask } from './claude';
import type { Attempts } from './recording-attempts';

export const LOW = 10;
const SENTENCES = 50;
const PASSAGES = 9;
// Items no repair round fixed are dropped; a lane left with fewer than these is not used.
const MIN_SENTENCES = 40;
const MIN_PASSAGES = 7;
const REPAIRS = 2;
const RETRY_AFTER = 6 * 3_600_000; // after a failed attempt, so a broken sign-in does not spend a request every check
const TIMEOUT = 20 * 60_000;

type Stock = { level: GrammarLevel; sentences: number; passages: number }[];
type Record = (clipIds: string[], generatedDirs: string[]) => Promise<{ ok: boolean; error: string }>;
export type TopupStatus = { level: GrammarLevel | null; step: 'writing' | 'recording' | null; lastError: string | null; made: string[] };

// What Claude writes: a lane item without id or level, and each question with its right answer first.
type RawSentence = Omit<ComprehensionSentence, 'id' | 'level'>;
type RawQuestion = { question: string; choices: string[]; explanation: string };
type RawPassage = Omit<ComprehensionPassage, 'id' | 'level' | 'questions'> & { questions: RawQuestion[] };
type VocabularyWord = { id: string; fr: string };

const laneFiles = (dir: string) => existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)) : [];
const pad = (value: number) => String(value).padStart(2, '0');

function json(reply: string): unknown {
  const text = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1);
  try { return JSON.parse(text); } catch { throw new Error('Claude did not reply with JSON.'); }
}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === 'string' ? value : '';

// Written French uses ’ and a space before ? ! : ; — both slip easily, so they are set here rather than sent back.
function frenchTypography(value: string): string {
  return value.replace(/'/g, '’').replace(/([^\s?!])([?!:;])/g, '$1 $2').replace(/\s{2,}/g, ' ').trim();
}

function glossOf(value: unknown, known: Known): Gloss[] {
  const seen = new Set<string>();
  const gloss: Gloss[] = [];
  for (const entry of list(value)) {
    const item = entry as Partial<Gloss>;
    const fr = text(item.fr).replace(/'/g, '’').trim(), en = text(item.en).trim();
    if (!fr || !en || seen.has(fr)) continue;
    seen.add(fr);
    gloss.push(typeof item.word === 'string' && known.words.has(item.word) ? { fr, en, word: item.word } : { fr, en });
  }
  return gloss;
}

// The vocabulary an item tags: what Claude listed and what its glosses link, if the deck has it.
function wordsOf(value: unknown, gloss: Gloss[], known: Known): string[] {
  return [...new Set([...list(value).filter((id): id is string => typeof id === 'string' && known.words.has(id)), ...gloss.flatMap((entry) => entry.word ? [entry.word] : [])])];
}
const topicsOf = (value: unknown, known: Known) => [...new Set(list(value).filter((id): id is string => typeof id === 'string' && known.topics.has(id)))];

export function buildSentence(raw: RawSentence, id: string, level: GrammarLevel, known: Known): ComprehensionSentence {
  const gloss = glossOf(raw.gloss, known);
  return {
    id, level, fr: frenchTypography(text(raw.fr)), en: text(raw.en).trim(),
    distractors: list(raw.distractors).map((value) => text(value).trim()),
    gap: text(raw.gap).replace(/'/g, '’').trim(), topics: topicsOf(raw.topics, known), words: wordsOf(raw.words, gloss, known), gloss,
  };
}

export function buildPassage(raw: RawPassage, id: string, level: GrammarLevel, known: Known, random: () => number): ComprehensionPassage {
  const gloss = glossOf(raw.gloss, known);
  const kind = raw.kind === 'text' ? 'text' : 'dialogue';
  return {
    id, level, kind, title: text(raw.title).trim(),
    lines: list(raw.lines).map((entry) => {
      const line = entry as { speaker?: unknown; fr?: unknown; en?: unknown };
      const built = { fr: frenchTypography(text(line.fr)), en: text(line.en).trim() };
      return kind === 'dialogue' ? { speaker: text(line.speaker).trim(), ...built } : built;
    }),
    // Claude lists the right answer first; the choices are shuffled here so it is not always in the same place.
    questions: list(raw.questions).map((entry) => {
      const question = entry as Partial<RawQuestion>;
      const choices = list(question.choices).map((value) => text(value).trim());
      const order = choices.map((_, index) => index);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; }
      return { question: text(question.question).trim(), choices: order.map((index) => choices[index]!), answer: order.indexOf(0), explanation: text(question.explanation).trim() };
    }),
    topics: topicsOf(raw.topics, known), words: wordsOf(raw.words, gloss, known), gloss,
  };
}

const RULES = (level: GrammarLevel) => `Rules for every item:
- Natural, correct, standard written French that a French teacher would sign off, about everyday life on the theme. Vary people, places and situations.
- ${level} level: ${level === 'A1' ? 'mostly the present tense, futur proche, simple questions and negation; very common words' : level === 'A2' ? 'the passé composé and imparfait, futur proche and futur simple, object pronouns, comparisons; common words' : 'opinions and reasons, the conditional, si-clauses, the subjunctive after common triggers, relative pronouns, connectors'}. Use words from the vocabulary list where you can; other common words are fine.
- French uses the typographic apostrophe ’ and a space before ? ! : ;
- "topics": grammar topic ids from the list that the item really uses.
- "words": vocabulary ids from the list for words the item uses.
- "gloss": one entry for EVERY word in the French except these little words: le la les l’ un une des de du d’ à au aux et ou mais je j’ tu il elle on nous vous ils elles ne n’ pas que qu’ ce c’ se s’ me m’ te t’ y en. A fixed expression (s’il vous plaît, ce soir, il y a) may be one entry. "fr" is the exact text as it appears (same case and apostrophe), a whole word or phrase; "en" is its meaning here (for a verb, add the infinitive: "eat; are eating (manger)"); "word" is its vocabulary id when it is that word from the list. Never list the same "fr" twice.
- English is natural English. Plain text only, no markup.`;

function sentencesPrompt(level: GrammarLevel, theme: string, context: string, example: RawSentence[]): string {
  return `You write graded French for Echo, an app for an English speaker learning French. Write ${SENTENCES} new ${level} sentences on the theme "${theme}".

Each sentence:
- "fr": one sentence of at most ${SENTENCE_WORDS[level]} words, ending with . ! ? or …
- "en": its English meaning.
- "distractors": 2–3 English sentences that are wrong because of ONE detail a listener must catch (who, when, where, how many, negation, tense). Never a paraphrase of "en".
- "gap": the exact text of one word of "fr" (or an elided unit such as l’ or j’ai) that occurs once in it; the learner types it after hearing the sentence. Prefer a meaningful word.
- "topics", "words", "gloss" as below.

${RULES(level)}

${context}

The format, with two sentences from another ${level} theme:
${JSON.stringify({ sentences: example })}

Reply with only JSON: {"sentences": [...]} with exactly ${SENTENCES} sentences.`;
}

function passagesPrompt(level: GrammarLevel, theme: string, context: string, example: RawPassage[]): string {
  return `You write graded French for Echo, an app for an English speaker learning French. Write ${PASSAGES} new ${level} passages on the theme "${theme}": 4 or 5 dialogues and 4 or 5 texts (a message, an email, a notice, a short story…).

Each passage:
- "kind": "dialogue" or "text"; "title": a short English title.
- "lines": 3–10 lines, at most ${PASSAGE_WORDS[level]} French words in all. Each line has "fr" and "en". In a dialogue every line has a "speaker" (a first name or a role in French, like "Le serveur"); a text line has no speaker. Lines end with . ! ? or …, and a text line may also end with , or : (Chers voisins, / Au programme :).
- "questions": 3–4 questions in English, each answerable only by understanding the French. "choices": 3–4 short English answers with the RIGHT ANSWER FIRST (Echo shuffles them), the others believable but clearly wrong from the French. "explanation": one English sentence that quotes the French deciding it.
- "topics", "words", "gloss" (for all the lines together) as below.

${RULES(level)}

${context}

The format, with a dialogue and a text from another ${level} theme:
${JSON.stringify({ passages: example })}

Reply with only JSON: {"passages": [...]} with exactly ${PASSAGES} passages.`;
}

function repairPrompt(level: GrammarLevel, part: 'sentences' | 'passages', broken: { ref: string; item: unknown; problems: string[] }[]): string {
  return `You wrote these ${level} ${part} for Echo, a French-learning app, and a checker found problems in them. Fix each one so the problems are gone, keeping the same meaning and format (questions keep the right answer first).

${RULES(level)}

${JSON.stringify(broken)}

Reply with only JSON: {"items": [{"ref": "...", "item": {...}}]} with one fixed item for every ref.`;
}

export function createTextTopup(options: {
  root: string; dataDir: string; ask: Ask; record: Record; stock: () => Stock; reload: () => Promise<void>; attempts: Attempts;
  threshold?: number; now?: () => number; random?: () => number;
}) {
  const { root, ask } = options;
  const live = join(options.dataDir, 'comprehension');
  const pending = join(options.dataDir, 'comprehension-pending');
  const authored = join(root, 'content/comprehension');
  const threshold = options.threshold ?? LOW;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const status: TopupStatus = { level: null, step: null, lastError: null, made: [] };
  let busy = false;
  let failedAt = -Infinity;

  async function lane(dir: string, name: string): Promise<ComprehensionLane> { return Bun.file(join(dir, `${name}.json`)).json(); }
  const clipIdsOf = (value: ComprehensionLane) => [...value.sentences.map((sentence) => sentence.id), ...value.passages.flatMap((passage) => passage.lines.map((_, index) => `${passage.id}-${index + 1}`))];

  async function context(level: GrammarLevel) {
    const prefix = `${level.toLowerCase()}-`;
    const names = [...laneFiles(authored), ...laneFiles(live), ...laneFiles(pending)];
    const vocabulary = [...await Bun.file(join(root, 'content/core.json')).json(), ...await Bun.file(join(root, 'content/world.json')).json()] as VocabularyWord[];
    const lanes = await Promise.all(laneFiles(authored).filter((name) => name.startsWith(prefix)).map((name) => lane(authored, name)));
    const used = new Map<string, number>();
    for (const item of lanes.flatMap((entry) => [...entry.sentences, ...entry.passages])) for (const topic of item.topics) used.set(topic, (used.get(topic) ?? 0) + 1);
    const units = await Bun.file(join(root, 'content/grammar/units.json')).json() as { title: string; topics: string[] }[];
    const summary = `Grammar topics (id list per unit): ${units.map((unit) => `${unit.title}: ${unit.topics.join(', ')}`).join(' | ')}
The topics ${level} texts use most, most used first: ${[...used].sort((a, b) => b[1] - a[1]).map(([topic]) => topic).join(', ')}

Vocabulary list ("id french"):
${vocabulary.map((word) => `${word.id} ${word.fr}`).join('\n')}`;
    const sample = lanes[0];
    const sentences: RawSentence[] = (sample?.sentences ?? []).slice(0, 2).map(({ id: _id, level: _level, ...rest }) => rest);
    const passages: RawPassage[] = (['dialogue', 'text'] as const).flatMap((kind) => {
      const found = sample?.passages.find((passage) => passage.kind === kind);
      if (!found) return [];
      const { id: _id, level: _level, questions, ...rest } = found;
      return [{ ...rest, questions: questions.map((question) => ({ question: question.question, explanation: question.explanation, choices: [question.choices[question.answer]!, ...question.choices.filter((_, index) => index !== question.answer)] })) }];
    });
    return { names, summary, sentences, passages, themes: names.filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length)) };
  }

  async function theme(level: GrammarLevel, themes: string[], names: string[]): Promise<string> {
    const reply = json(await ask(`Echo, an app for an English speaker learning French, has ${level} reading and listening lanes on these themes: ${themes.join(', ')}. Pick one new everyday theme for another ${level} lane, different from all of them, broad enough for 50 sentences and 9 dialogues and texts. Reply with only JSON: {"theme": "a short lowercase English slug, words joined by hyphens"}`, { timeout: 5 * 60_000, purpose: 'choosing a theme' })) as { theme?: unknown };
    const slug = text(reply.theme).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'everyday';
    let name = `${level.toLowerCase()}-${slug}`;
    for (let n = 2; names.includes(name); n++) name = `${level.toLowerCase()}-${slug}-${n}`;
    return name;
  }

  // Writes one lane for `level`: Claude writes, the lane rules check, broken items go back to Claude up to REPAIRS
  // times, and anything still broken is left out.
  async function write(level: GrammarLevel): Promise<ComprehensionLane> {
    const known = await loadKnown(root);
    const ctx = await context(level);
    const name = await theme(level, ctx.themes, ctx.names);
    const themeName = name.slice(level.length + 1).replace(/-\d+$/, '').replace(/-/g, ' ');
    const [sentenceReply, passageReply] = await Promise.all([
      ask(sentencesPrompt(level, themeName, ctx.summary, ctx.sentences), { timeout: TIMEOUT, purpose: 'writing new sentences' }),
      ask(passagesPrompt(level, themeName, ctx.summary, ctx.passages), { timeout: TIMEOUT, purpose: 'writing new dialogues and texts' }),
    ]);
    const objects = (value: unknown) => list(value).filter((item) => !!item && typeof item === 'object' && !Array.isArray(item));
    const raw = new Map<string, unknown>();
    objects((json(sentenceReply) as { sentences?: unknown }).sentences).slice(0, SENTENCES).forEach((item, index) => raw.set(`${name}-s${pad(index + 1)}`, item));
    objects((json(passageReply) as { passages?: unknown }).passages).slice(0, PASSAGES).forEach((item, index) => raw.set(`${name}-p${pad(index + 1)}`, item));

    const build = (): ComprehensionLane => ({
      sentences: [...raw].filter(([id]) => id.startsWith(`${name}-s`)).map(([id, item]) => buildSentence(item as RawSentence, id, level, known)),
      passages: [...raw].filter(([id]) => id.startsWith(`${name}-p`)).map(([id, item]) => buildPassage(item as RawPassage, id, level, known, random)),
    });
    const problemsById = (built: ComprehensionLane) => {
      const byId = new Map<string, string[]>();
      for (const problem of laneProblems(built, name, known, new Set())) {
        const id = new RegExp(`${name}-[sp]\\d{2}`).exec(problem)?.[0];
        if (!id) throw new Error(`the new lane broke a rule: ${problem}`);
        byId.set(id, [...byId.get(id) ?? [], problem]);
      }
      return byId;
    };

    let built = build();
    for (let round = 0; round < REPAIRS; round++) {
      const broken = problemsById(built);
      if (!broken.size) break;
      for (const part of ['sentences', 'passages'] as const) {
        const refs = [...broken.keys()].filter((id) => id.startsWith(`${name}-${part[0]}`));
        if (!refs.length) continue;
        const reply = json(await ask(repairPrompt(level, part, refs.map((ref) => ({ ref, item: raw.get(ref), problems: broken.get(ref)! }))), { timeout: TIMEOUT, purpose: 'fixing new texts' })) as { items?: unknown };
        for (const entry of list(reply.items)) {
          const fix = entry as { ref?: unknown; item?: unknown };
          if (typeof fix.ref === 'string' && refs.includes(fix.ref) && fix.item && typeof fix.item === 'object') raw.set(fix.ref, fix.item);
        }
      }
      built = build();
    }
    for (const id of problemsById(built).keys()) raw.delete(id);
    built = build();
    const dialogues = built.passages.filter((passage) => passage.kind === 'dialogue').length;
    if (built.sentences.length < MIN_SENTENCES || built.passages.length < MIN_PASSAGES || dialogues < 3 || built.passages.length - dialogues < 3) {
      throw new Error(`only ${built.sentences.length} sentences and ${built.passages.length} passages (${dialogues} dialogues) passed the checks`);
    }
    return built;
  }

  // Records a waiting lane, then moves it into practice. If another recording holds the voice, it waits for the
  // next check; clips no take passes for are left out of Listen, like the written lanes'.
  async function publish(name: string): Promise<void> {
    const value = await lane(pending, name);
    status.step = 'recording';
    status.level = value.sentences[0]?.level ?? value.passages[0]?.level ?? null;
    const recorded = await options.record(clipIdsOf(value), [live, pending]);
    if (!recorded.ok && /Another renderer owns/.test(recorded.error)) return;
    mkdirSync(live, { recursive: true });
    renameSync(join(pending, `${name}.json`), join(live, `${name}.json`));
    await options.reload();
    status.made.push(name);
    console.log(`texts: ${name} joined practice (${value.sentences.length} sentences, ${value.passages.length} passages)`);
  }

  async function check(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const waiting = laneFiles(pending);
      if (waiting.length) { for (const name of waiting) await publish(name); return; }
      if (now() - failedAt < RETRY_AFTER) return;
      // Of the levels in reach that are running low, the one with the fewest unseen texts is written first (on a
      // tie, the higher level), so a new lane goes where practice will run out soonest.
      const scarce = (entry: Stock[number]) => Math.min(entry.sentences, entry.passages);
      const low = options.stock().filter((entry) => entry.sentences < threshold || entry.passages < threshold).reverse().sort((a, b) => scarce(a) - scarce(b))[0];
      if (!low) return;
      status.level = low.level; status.step = 'writing';
      console.log(`texts: ${low.level} has ${low.sentences} unseen sentences and ${low.passages} unseen dialogues/texts; writing a new lane`);
      const value = await write(low.level);
      const name = value.sentences[0]!.id.replace(/-s\d{2}$/, '');
      mkdirSync(pending, { recursive: true });
      writeFileSync(join(pending, `${name}.json`), JSON.stringify(value, null, 1));
      await publish(name);
      status.lastError = null;
    } catch (error) {
      failedAt = now();
      status.lastError = (error as Error).message;
      console.error(`texts: could not add a lane: ${status.lastError}`);
    } finally {
      busy = false; status.level = null; status.step = null;
    }
  }

  // After a restart: re-record any clip of a live lane still missing (a failed take is tried again on each start
  // until it has failed three times), then check the stock.
  async function resume(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const missing = (id: string) => !existsSync(join(root, 'audio/comprehension', `${id}.mp3`));
      const ids = (await Promise.all(laneFiles(live).map((name) => lane(live, name)))).flatMap(clipIdsOf).filter(missing);
      const skipped = options.attempts.skipped(ids);
      if (skipped.length) console.log(`texts: not retrying ${skipped.join(', ')} (failed 3 times; see data/recording-attempts.json)`);
      const tried = options.attempts.allowed(ids);
      if (tried.length) {
        await options.record(tried, [live, pending]);
        options.attempts.note(tried, missing);
      }
    } catch (error) {
      console.error(`texts: could not re-record: ${(error as Error).message}`);
    } finally { busy = false; }
    await check();
  }

  return { check, resume, status: () => ({ ...status, made: [...status.made] }) };
}
export type TextTopup = ReturnType<typeof createTextTopup>;
