// The song view's notes: every line of a song's lyrics with an English translation and a note for each word or
// phrase worth tapping (meaning, dictionary form, the grammar at work there). Claude (Opus) writes them in the
// background once a song's words are read, in batches of lines; a second request reviews each batch against the
// song for mistakes of meaning and grammar, then each line is checked here and a broken one goes back to be fixed.
// A line still broken after that keeps what passed. The News room (lib/news.ts) has its transcripts noted the same way.
import type { Ask } from './claude';
import { unglossed, wholeMatches } from './comprehension-content';

export type SongWordNote = { fr: string; en: string; base?: string; note?: string; gender?: 'masculine' | 'feminine' };
// Bumped when the notes' content changes, so songs noted before are written again (lib/songs.ts resume).
export const NOTES_VERSION = 2;
export type SongLine = { fr: string; en: string | null; words: SongWordNote[] };
// Stanzas of lines, blank lines in the lyrics separating stanzas.
export type SongNotes = SongLine[][];
// What is being noted: a song's lyrics, or the transcript of a news bulletin (lib/news.ts), its lines in stanzas.
export type NotedText = { kind: 'song' | 'news'; title: string; artist: string; lyrics: string };

// How the prompts speak of each kind of text.
const KINDS = {
  song: { reads: 'these lyrics', piece: 'song', named: (text: NotedText) => `The song is "${text.title}"${text.artist ? ` by ${text.artist}` : ''}.`, whole: 'The whole lyrics' },
  news: { reads: 'this transcript of a radio news bulletin in slow French', piece: 'bulletin', named: (text: NotedText) => `The bulletin is "${text.title}"${text.artist ? ` from ${text.artist}` : ''}.`, whole: 'The whole transcript' },
};

const BATCH = 20;
const REPAIRS = 2;
const TIMEOUT = 10 * 60_000;

// The lyrics' lines in stanzas, trimmed; runs of blank lines end a stanza.
export function stanzasOf(lyrics: string): string[][] {
  const stanzas: string[][] = [[]];
  for (const raw of lyrics.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (line) stanzas.at(-1)!.push(line);
    else if (stanzas.at(-1)!.length) stanzas.push([]);
  }
  return stanzas.filter((stanza) => stanza.length);
}

// A line is checked as written, straight apostrophes and all, so a word counts as covered exactly when the song
// view can make it tappable.
export function lineProblems(fr: string, line: { en?: unknown; words?: unknown }): string[] {
  const problems: string[] = [];
  if (typeof line.en !== 'string' || !line.en.trim()) problems.push('the line has no English translation.');
  const words = Array.isArray(line.words) ? line.words as Partial<SongWordNote>[] : [];
  const seen = new Set<string>();
  for (const word of words) {
    if (!word || typeof word.fr !== 'string' || !word.fr.trim() || typeof word.en !== 'string' || !word.en.trim()) { problems.push('every word needs fr and en text.'); continue; }
    if (seen.has(word.fr)) problems.push(`"${word.fr}" is listed twice.`);
    seen.add(word.fr);
    if (!wholeMatches(fr, word.fr).length) problems.push(`"${word.fr}" is not a whole word or phrase of the line as written.`);
  }
  const missing = unglossed(fr, words.filter((word) => typeof word?.fr === 'string').map((word) => ({ fr: word.fr! })));
  if (missing.length) problems.push(`${missing.map((word) => `"${word}"`).join(', ')} ${missing.length === 1 ? 'has' : 'have'} no entry.`);
  return problems;
}

// The parts of a line's notes that pass: a translation if there is one, and the words that stand whole in it.
function kept(fr: string, line: { en?: unknown; words?: unknown }): SongLine {
  const words = (Array.isArray(line.words) ? line.words as Partial<SongWordNote>[] : [])
    .filter((word): word is SongWordNote => !!word && typeof word.fr === 'string' && typeof word.en === 'string' && !!word.en.trim() && wholeMatches(fr, word.fr).length > 0)
    .filter((word, index, all) => all.findIndex((other) => other.fr === word.fr) === index)
    .map(({ fr: span, en, base, note, gender }) => ({
      fr: span, en: en.trim(),
      ...(typeof base === 'string' && base.trim() && base.trim() !== span && !/\s/.test(span) ? { base: base.trim() } : {}),
      ...(typeof note === 'string' && note.trim() ? { note: note.trim() } : {}),
      ...(gender === 'masculine' || gender === 'feminine' ? { gender } : {}),
    }));
  return { fr, en: typeof line.en === 'string' && line.en.trim() ? line.en.trim() : null, words };
}

function guide(text: NotedText): string {
  const kind = KINDS[text.kind];
  return `Echo is an app for an English speaker learning French, at A1 to A2 and aiming for B1. The learner reads ${kind.reads}, taps the start of a line to see what it means, and taps any word to see a short note.

For each numbered line give:
- "en": a natural English translation of the whole line as it is meant in the ${kind.piece} (use the whole ${kind.piece} for context).
- "words": an entry for every word or phrase worth tapping, in the order they appear:
  - "fr": the exact text as it stands in the line: the same capitals, the same apostrophe (' or ’), nothing added or left out.
  - "en": its meaning here, short.
  - "base": for a single word only, its dictionary form when it differs: the infinitive of a verb (for a conjugated form, the verb it comes from, not a similar-looking one), the masculine singular of an adjective, the singular of a noun. Never on a phrase.
  - "note": one or two plain sentences on what a learner needs to read it here. A verb: its infinitive, the tense or mood, and who it goes with (for example "Vais is aller in the present with je: je vais, tu vas, il va."). An article or preposition joined to a noun: what it adds ("du = de + le: some, or of the"). Elision (l’, j’, qu’), the pieces of a negation, what a pronoun (le, lui, y, en…) stands for, spoken or slang forms (t’as = tu as, y’a = il y a), and unusual word order. Leave "note" out when the meaning says it all.
  - "gender": "masculine" or "feminine" for a noun, alone or with its article; leave it out for every other word and for a noun that can be either.
Every content word needs an entry. Keep a fixed expression together (il y a, tout à coup, avoir besoin de), and put an article with its noun when the article is the interesting part. Little words (le, de, et, je, que…) may have their own entry when they do something worth explaining. A word written two ways in the same line gets one entry per spelling.`;
}

function prompt(text: NotedText, lines: { n: number; fr: string }[]): string {
  return `${guide(text)}

${KINDS[text.kind].named(text)} ${KINDS[text.kind].whole}, for context:
"""
${text.lyrics}
"""

The lines to write for:
${lines.map((line) => `${line.n}. ${line.fr}`).join('\n')}

Reply with only JSON: {"lines": [{"n": 1, "en": "...", "words": [{"fr": "...", "en": "...", "base": "...", "note": "..."}]}]} with one entry for every numbered line.`;
}

function repairPrompt(text: NotedText, lines: { n: number; fr: string; wrote: unknown; problems: string[] }[]): string {
  return `${guide(text)}

You wrote notes for these lines of "${text.title}", and a checker found problems. Fix each line so the problems are gone, keeping what was right.

${JSON.stringify(lines)}

Reply with only JSON: {"lines": [{"n": 1, "en": "...", "words": [...]}]} with one fixed entry for every n above.`;
}

// A second, independent read: the notes checked against the whole text for mistakes of meaning, grammar and
// dictionary form, which the format checks cannot see.
function reviewPrompt(text: NotedText, lines: { n: number; fr: string; wrote: unknown }[]): string {
  const kind = KINDS[text.kind];
  return `${guide(text)}

Another writer produced the notes below for lines of "${text.title}"${text.artist ? ` by ${text.artist}` : ''}. Check every line and every entry against the ${kind.piece}, as a careful French teacher would:
- Is the line's English translation faithful to what the line means in the ${kind.piece}?
- Is each entry's meaning right in this context?
- Is each dictionary form ("base") really the word it comes from?
- Is each note true: the tense, mood, person, agreement, contraction and what each pronoun stands for?

${kind.whole}, for context:
"""
${text.lyrics}
"""

${JSON.stringify(lines)}

Reply with only JSON: {"lines": [{"n": 1, "en": "...", "words": [...]}]} listing ONLY the lines that need a correction, each written out in full with every entry (corrected and unchanged ones). Reply {"lines": []} when everything is right.`;
}

function replyLines(reply: string): Map<number, { en?: unknown; words?: unknown }> {
  let value: unknown;
  try { value = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)); } catch { value = null; }
  const lines = value && typeof value === 'object' && Array.isArray((value as { lines?: unknown }).lines) ? (value as { lines: unknown[] }).lines : [];
  const byNumber = new Map<number, { en?: unknown; words?: unknown }>();
  for (const line of lines) if (line && typeof line === 'object' && typeof (line as { n?: unknown }).n === 'number') byNumber.set((line as { n: number }).n, line as { en?: unknown; words?: unknown });
  return byNumber;
}

// Writes notes for every distinct line; a repeated line (a chorus) is written once. `progress` hears how many
// distinct lines are done. A StoreError from ask (Claude cannot be reached) stops the whole text.
export async function writeNotes(ask: Ask, text: NotedText, progress: (done: number, total: number) => void): Promise<SongNotes> {
  const stanzas = stanzasOf(text.lyrics);
  const distinct = [...new Set(stanzas.flat())];
  const notes = new Map<string, SongLine>();
  const piece = KINDS[text.kind].piece;
  progress(0, distinct.length);
  for (let start = 0; start < distinct.length; start += BATCH) {
    const batch = distinct.slice(start, start + BATCH).map((fr, index) => ({ n: start + index + 1, fr }));
    const answers = replyLines(await ask(prompt(text, batch), { timeout: TIMEOUT, purpose: `writing the ${piece} notes` }));
    const reviewed = replyLines(await ask(reviewPrompt(text, batch.map((line) => ({ ...line, wrote: answers.get(line.n) ?? null }))), { timeout: TIMEOUT, purpose: `checking the ${piece} notes` }));
    for (const line of batch) {
      const corrected = reviewed.get(line.n);
      // A correction is taken only when it keeps the line as well formed as the notes it replaces.
      if (corrected && lineProblems(line.fr, corrected).length <= lineProblems(line.fr, answers.get(line.n) ?? {}).length) answers.set(line.n, corrected);
    }
    for (let round = 0; round < REPAIRS; round++) {
      const broken = batch.map((line) => ({ ...line, wrote: answers.get(line.n) ?? null, problems: lineProblems(line.fr, answers.get(line.n) ?? {}) })).filter((line) => line.problems.length);
      if (!broken.length) break;
      const fixed = replyLines(await ask(repairPrompt(text, broken), { timeout: TIMEOUT, purpose: `fixing the ${piece} notes` }));
      for (const line of broken) {
        const again = fixed.get(line.n);
        // A fix is taken only when it is no worse than what it replaces.
        if (again && lineProblems(line.fr, again).length <= line.problems.length) answers.set(line.n, again);
      }
    }
    for (const line of batch) notes.set(line.fr, kept(line.fr, answers.get(line.n) ?? {}));
    progress(Math.min(distinct.length, start + BATCH), distinct.length);
  }
  return stanzas.map((stanza) => stanza.map((fr) => notes.get(fr)!));
}
