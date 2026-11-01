// Dictation (French, in Listen): hear one sentence of the Listen and Read bank, type it, Check. An answer is right when
// it equals the sentence once case, punctuation, apostrophes and spaces are set aside; one differing only in accents is
// right too, with a quiet note. The result marks letter by letter what was missing or wrong (judge()), and explains a
// missed letter French does not say with grammar-ear's silent-letter rules (explain()).
//
// The sentences (candidates()): recorded, at or below the learner's Listen level and within that level's word cap, and
// passing Sentence cards' rules (the Practising line's tenses, topics switched on, at most one unmet word).
// A missed sentence comes back once after 3 other answers, and again at the start of the next study day (pickNext()).
// Every answer is kept in dictation_answers, once per request id.
import { Database } from 'bun:sqlite';
import type { DictationItem, DictationMark, DictationResult, DictationSegment, DictationVerdict, GrammarLevel, ListeningWord } from '../contract';
import { SENTENCE_WORDS, wordCount } from './comprehension-content';
import { fold, MUTE_E, SILENT_CONSONANTS, silentEnt } from './grammar-ear';
import { lineOf, rememberedLine } from './practising';
import { eligible, type EmptyReason, type Eligibility, type PoolSentence } from './sentence-cards';
import { StoreError, studyDayStart } from './store';
import { DETECTED_TENSES, type DetectedTense } from './tenses';
import { planSentences } from './walkman';

// How many other answers come between a miss and its once-more pass.
export const AGAIN_AFTER = 3;
const LEVELS: GrammarLevel[] = ['A1', 'A2', 'B1'];
const EXCLUDE_LIMIT = 20;

// ── Judging ──
// One comparable unit of a written sentence: a letter or digit (key lowercased, plain also without accents), a word
// gap (' ') or an apostrophe ('’'), with the index of the character it came from. Other punctuation is not compared.
type Unit = { at: number; key: string; plain: string };
const LETTER = /[\p{L}\p{N}]/u;
const APOSTROPHE = /['’`ʼ]/;
const GAP = /[\s\-‐‑–—]/;
function units(text: string): Unit[] {
  const out: Unit[] = [];
  const chars = [...text];
  let at = 0;
  for (const char of chars) {
    const lower = char.toLowerCase();
    if (LETTER.test(char)) out.push({ at, key: lower, plain: fold(lower) });
    else if (APOSTROPHE.test(char)) {
      if (out.at(-1)?.key === ' ') out.pop();
      out.push({ at, key: '’', plain: '’' });
    } else if (GAP.test(char) && out.length && out.at(-1)!.key !== ' ' && out.at(-1)!.key !== '’') out.push({ at, key: ' ', plain: ' ' });
    at += char.length;
  }
  if (out.at(-1)?.key === ' ') out.pop();
  return out;
}

// Costs of the letter alignment: an accent-only difference is cheaper than any slip, so a letter is paired with its
// accented twin rather than left over; one wrong letter costs as much as one missing letter.
const ACCENT = 1, SLIP = 100;
// Pairs the given units with the expected ones (fewest slips); null on a side is a unit the other side lacks.
function align(given: Unit[], expected: Unit[]): [Unit | null, Unit | null][] {
  const rows = given.length + 1, cols = expected.length + 1;
  const cost = new Uint32Array(rows * cols);
  const pair = (a: Unit, b: Unit) => (a.key === b.key ? 0 : a.plain === b.plain ? ACCENT : SLIP);
  for (let i = 0; i < rows; i++) cost[i * cols] = i * SLIP;
  for (let j = 0; j < cols; j++) cost[j] = j * SLIP;
  for (let i = 1; i < rows; i++) for (let j = 1; j < cols; j++) {
    cost[i * cols + j] = Math.min(cost[(i - 1) * cols + j - 1]! + pair(given[i - 1]!, expected[j - 1]!), cost[(i - 1) * cols + j]! + SLIP, cost[i * cols + j - 1]! + SLIP);
  }
  // Walking back from the end, a pairing wins ties, then a missing letter, so a slip lands where the words differ.
  const out: [Unit | null, Unit | null][] = [];
  let i = given.length, j = expected.length;
  while (i > 0 || j > 0) {
    const here = cost[i * cols + j]!;
    if (i > 0 && j > 0 && here === cost[(i - 1) * cols + j - 1]! + pair(given[i - 1]!, expected[j - 1]!)) { out.push([given[i - 1]!, expected[j - 1]!]); i--; j--; }
    else if (j > 0 && here === cost[i * cols + j - 1]! + SLIP) { out.push([null, expected[j - 1]!]); j--; }
    else { out.push([given[i - 1]!, null]); i--; }
  }
  return out.reverse();
}

// The text cut into runs of the same mark; characters outside the compared units (punctuation) carry none.
function segments(text: string, marks: Map<number, DictationMark>): DictationSegment[] {
  const out: DictationSegment[] = [];
  let at = 0;
  for (const char of text) {
    const mark = marks.get(at);
    const last = out.at(-1);
    if (last && last.mark === mark) last.text += char;
    else out.push(mark ? { text: char, mark } : { text: char });
    at += char.length;
  }
  return out;
}

// What the learner typed against the sentence: the verdict, both texts marked, and the expected letters missed
// (by character index), for explain().
export function judge(given: string, expected: string): { verdict: DictationVerdict; given: DictationSegment[]; expected: DictationSegment[]; missed: number[]; accents: number[] } {
  given = given.normalize('NFC').trim(); expected = expected.normalize('NFC');
  const pairs = align(units(given), units(expected));
  const givenMarks = new Map<number, DictationMark>(), expectedMarks = new Map<number, DictationMark>();
  const missed: number[] = [], accents: number[] = [];
  let slips = 0;
  for (const [mine, theirs] of pairs) {
    if (mine && theirs && mine.key === theirs.key) continue;
    if (mine && theirs && mine.plain === theirs.plain) { expectedMarks.set(theirs.at, 'accent'); accents.push(theirs.at); continue; }
    slips++;
    if (mine) givenMarks.set(mine.at, 'extra');
    if (theirs) { expectedMarks.set(theirs.at, 'missing'); missed.push(theirs.at); }
  }
  const verdict: DictationVerdict = slips ? 'wrong' : accents.length ? 'accent' : 'right';
  return { verdict, given: segments(given, givenMarks), expected: segments(expected, expectedMarks), missed, accents };
}

// ── Explaining ──
type Word = { text: string; at: number };
// The words of a sentence with where each starts; an elided word keeps its apostrophe (l’, j’).
function wordsOf(text: string): Word[] {
  return [...text.matchAll(/[\p{L}\p{M}]+(?:['’ʼ])?/gu)].map((match) => ({ text: match[0].toLowerCase().replace(/['ʼ]$/, '’'), at: match.index! }));
}
// Words that may stand between ils / elles and its verb (ils ne les voient pas, elles s’en vont).
const CLITICS = new Set(['ne', 'n’', 'se', 's’', 'me', 'm’', 'te', 't’', 'le', 'la', 'l’', 'les', 'lui', 'leur', 'y', 'en', 'nous', 'vous']);
// Words that make the noun after them plural; the -s of the ones ending in s is itself a plural -s.
const PLURAL = new Set(['les', 'des', 'mes', 'tes', 'ses', 'nos', 'vos', 'leurs', 'ces', 'aux', 'quelques', 'plusieurs', 'certains', 'certaines', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'mille', 'tous', 'toutes', 'nombreux', 'nombreuses']);

// One line for each word where the learner missed a letter French does not say: the verb ending -nt (-ent) after ils or
// elles, a plural -s or -x, a silent final consonant, a mute final e. A word explains its first rule that fits; a word
// whose missed letters are all sounded gets no line. Deterministic: the same miss always gets the same line.
export function explain(expected: string, missed: number[]): string[] {
  const words = wordsOf(expected.normalize('NFC'));
  const lines: string[] = [];
  words.forEach((word, index) => {
    const offsets = missed.filter((at) => at >= word.at && at < word.at + word.text.length).map((at) => at - word.at);
    if (!offsets.length) return;
    const plain = fold(word.text);
    const end = plain.length;
    const tailFrom = (from: number) => offsets.some((offset) => offset >= from);
    // The verb after ils / elles, past any object pronouns before it.
    let back = index - 1;
    while (back >= 0 && CLITICS.has(words[back]!.text)) back--;
    const subject = back >= 0 && (words[back]!.text === 'ils' || words[back]!.text === 'elles') ? words[back]!.text : '';
    if (subject && /nt$/.test(plain)) {
      const ent = silentEnt(plain);
      if (tailFrom(ent ? end - 3 : end - 1)) {
        lines.push(ent ? `${word.text}: after ${subject} the verb ends in -ent, which is not heard.` : `${word.text}: after ${subject} the verb ends in -nt; the t is not heard.`);
        return;
      }
    }
    const last = plain.at(-1);
    const pluralBefore = words.slice(Math.max(0, index - 2), index).some((other) => PLURAL.has(other.text));
    const pluralItself = PLURAL.has(word.text) && index < words.length - 1;
    if ((last === 's' || last === 'x') && offsets.includes(end - 1) && end > 1 && (pluralBefore || pluralItself)) {
      lines.push(`${word.text}: plural, so it ends in -${last}, which is not heard.`);
      return;
    }
    const sounded = plain.replace(SILENT_CONSONANTS, '');
    if (end > 1 && sounded.length < end && tailFrom(sounded.length)) {
      lines.push(`${word.text}: the final ${plain.slice(sounded.length)} is not heard.`);
      return;
    }
    if (MUTE_E.test(sounded) && offsets.includes(sounded.length - 1)) lines.push(`${word.text}: the final e is silent.`);
  });
  return lines;
}

// ── Choosing ──
export type DictationState = { missedAt: number | null; dueAt: number | null };
// The next sentence, from the candidates not in exclude: first a miss whose once-more pass is ready (AGAIN_AFTER other
// answers since it; the oldest first), then one due today (the longest waiting first), then one never answered (the
// ones holding the words most worth hearing likelier, as on the sentence tape), then the one answered longest ago that
// is not waiting for a return. sequence counts every answer so far; missedAt is that count at the miss.
export function pickNext<T extends { id: string; level: GrammarLevel; words: string[] }>(input: {
  items: T[]; states: Map<string, DictationState>; lastAnswered: Map<string, number>; sequence: number; now: number;
  exclude: ReadonlySet<string>; vocabulary: ListeningWord[]; level: GrammarLevel; random: () => number;
}): { item: T; again: boolean } | null {
  const open = input.items.filter((item) => !input.exclude.has(item.id));
  const state = (item: T) => input.states.get(item.id);
  const ready = open.filter((item) => { const missedAt = state(item)?.missedAt; return missedAt != null && input.sequence - missedAt >= AGAIN_AFTER; })
    .sort((a, b) => state(a)!.missedAt! - state(b)!.missedAt!);
  if (ready[0]) return { item: ready[0], again: true };
  const due = open.filter((item) => { const s = state(item); return s && s.missedAt == null && s.dueAt != null && s.dueAt <= input.now; })
    .sort((a, b) => state(a)!.dueAt! - state(b)!.dueAt!);
  if (due[0]) return { item: due[0], again: true };
  const fresh = planSentences(open.filter((item) => !input.lastAnswered.has(item.id)), input.vocabulary, input.level, input.random);
  if (fresh[0]) return { item: fresh[0], again: false };
  const settled = open.filter((item) => { const s = state(item); return input.lastAnswered.has(item.id) && s?.missedAt == null && s?.dueAt == null; })
    .sort((a, b) => input.lastAnswered.get(a.id)! - input.lastAnswered.get(b.id)!);
  return settled[0] ? { item: settled[0], again: false } : null;
}

// The state an answer leaves. A miss waits for its once-more pass and returns at the next study day's start; the
// once-more pass, whatever its verdict, leaves that return in place; a right answer on the day's return ends it.
export function afterAnswer(state: DictationState | null, right: boolean, sequence: number, now: Date): DictationState {
  const nextDay = () => { const day = studyDayStart(now); day.setDate(day.getDate() + 1); day.setHours(4, 0, 0, 0); return day.getTime(); };
  const wasAgain = state?.missedAt != null;
  const wasDue = state?.dueAt != null && state.dueAt <= now.getTime();
  if (!right) return { missedAt: wasAgain ? null : sequence, dueAt: wasAgain && !wasDue ? state!.dueAt : nextDay() };
  return { missedAt: null, dueAt: state?.dueAt != null && !wasDue ? state.dueAt : null };
}

// The sentences Dictation may offer: recorded, at or below level and within its word cap, passing Sentence cards' rules.
export function candidates<T extends PoolSentence>(pool: T[], level: GrammarLevel, rules: Eligibility): { items: T[]; reason: EmptyReason } {
  const top = LEVELS.indexOf(level);
  const sized = pool.filter((sentence) => LEVELS.indexOf(sentence.level) <= top && wordCount(sentence.fr) <= SENTENCE_WORDS[level]);
  return eligible(sized, { ...rules, hear: true });
}

const tensesOf = (line: { tenses: string[] }) => DETECTED_TENSES.filter((tense) => line.tenses.includes(tense));

export function createDictation(deps: {
  dbPath: string;
  // The bank's sentences with their tenses and recordings (Sentence cards' pool, its bank part).
  pool: () => PoolSentence[];
  vocabulary: () => ListeningWord[];
  rules: (tenses: readonly DetectedTense[]) => Eligibility;
  level: () => GrammarLevel;
  now?: () => Date; random?: () => number;
}) {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const db = new Database(deps.dbPath, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
    -- Every answer, kept once per request id, so an answer sent again after a lost reply never counts twice.
    CREATE TABLE IF NOT EXISTS dictation_answers (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, sentence_id TEXT NOT NULL,
      given TEXT NOT NULL, verdict TEXT NOT NULL, answered_at TEXT NOT NULL
    );
    -- Where a sentence answered stands: how many answers there were at its miss while its once-more pass waits, and its
    -- next-day return. (A count, not the answer's sequence: an answer sent twice is ignored but still uses a sequence.)
    CREATE TABLE IF NOT EXISTS dictation_sentences (sentence_id TEXT PRIMARY KEY, missed_at INTEGER, due_at INTEGER);
  `);
  const line = rememberedLine(db, 'dictation_line');
  const insert = db.query('INSERT OR IGNORE INTO dictation_answers (request_id, sentence_id, given, verdict, answered_at) VALUES (?, ?, ?, ?, ?)');
  const previous = db.query<{ given: string }, [string]>('SELECT given FROM dictation_answers WHERE request_id = ?');
  const answerCount = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM dictation_answers');
  const lastAnswers = db.query<{ sentence_id: string; sequence: number }, []>('SELECT sentence_id, MAX(sequence) AS sequence FROM dictation_answers GROUP BY sentence_id');
  const allStates = db.query<{ sentence_id: string; missed_at: number | null; due_at: number | null }, []>('SELECT sentence_id, missed_at, due_at FROM dictation_sentences');
  const stateOf = db.query<{ missed_at: number | null; due_at: number | null }, [string]>('SELECT missed_at, due_at FROM dictation_sentences WHERE sentence_id = ?');
  const saveState = db.query('INSERT OR REPLACE INTO dictation_sentences (sentence_id, missed_at, due_at) VALUES (?, ?, ?)');

  function next(input: { practising?: unknown; exclude?: unknown }): { item: DictationItem | null; empty: EmptyReason } {
    const sent = lineOf(input?.practising);
    if (sent && tensesOf(sent).length) line.set(sent);
    const tenses = tensesOf(sent && tensesOf(sent).length ? sent : line.get());
    const level = deps.level();
    const { items, reason } = candidates(deps.pool(), level, deps.rules(tenses));
    const exclude = new Set(Array.isArray(input?.exclude) ? input.exclude.filter((id): id is string => typeof id === 'string').slice(0, EXCLUDE_LIMIT) : []);
    const states = new Map(allStates.all().map((row) => [row.sentence_id, { missedAt: row.missed_at, dueAt: row.due_at }]));
    const lastAnswered = new Map(lastAnswers.all().map((row) => [row.sentence_id, row.sequence]));
    const picked = pickNext({ items, states, lastAnswered, sequence: answerCount.get()!.count, now: now().getTime(), exclude, vocabulary: deps.vocabulary(), level, random });
    if (!picked) return { item: null, empty: reason ?? 'later' };
    return { item: { id: picked.item.id, level: picked.item.level, audio: picked.item.audio, again: picked.again }, empty: null };
  }

  // An answer, judged and kept once per request id; the same request sent again is judged on what it first sent.
  function check(input: { requestId?: unknown; id?: unknown; given?: unknown }): DictationResult {
    if (typeof input?.requestId !== 'string' || !input.requestId) throw new StoreError('This answer is missing its request ID.');
    if (typeof input.given !== 'string' || !input.given.trim()) throw new StoreError('Type what you heard.');
    const sentence = typeof input.id === 'string' ? deps.pool().find((entry) => entry.id === input.id) : undefined;
    if (!sentence) throw new StoreError('That sentence is not in Echo.', 404);
    const requestId = input.requestId;
    const given = (previous.get(requestId)?.given ?? input.given).slice(0, 400);
    const judged = judge(given, sentence.fr);
    const when = now();
    db.transaction(() => {
      if (!insert.run(requestId, sentence.id, given, judged.verdict, when.toISOString()).changes) return;
      const sequence = answerCount.get()!.count;
      const row = stateOf.get(sentence.id);
      const state = afterAnswer(row ? { missedAt: row.missed_at, dueAt: row.due_at } : null, judged.verdict !== 'wrong', sequence, when);
      saveState.run(sentence.id, state.missedAt, state.dueAt);
    })();
    return {
      verdict: judged.verdict, given: judged.given, expected: judged.expected, fr: sentence.fr, en: sentence.en,
      why: explain(sentence.fr, judged.missed),
    };
  }

  return { next, check, close: () => db.close() };
}
export type Dictation = ReturnType<typeof createDictation>;
