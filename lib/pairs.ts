// Mixed-up pairs: two started words the learner keeps confusing, practised in a French sentence with one blank where
// a form of only one of them fits by meaning. The pairs come from the learner's own misses (French → English): each
// missed word with a word of its family, a word that looks like it (one inside the other, or two letters apart at
// most) and the deck words missed most alongside it (the trouble list), ranked by the two words' misses together.
// Claude writes items ahead, a few per pair, a batch at a time; each is kept only when it has one blank, two
// different forms, each a form of its own word, and a sentence within the A2 word cap. An item is shown least seen
// first; one answered wrong comes back after three others. Answers live in their own table and change no word score.
import { Database } from 'bun:sqlite';
import type { BrowseWord, PairResult, PairsState, PairView } from '../contract';
import type { Ask } from './claude';
import { SENTENCE_WORDS, wordCount } from './comprehension-content';
import { bareFrench, stem } from './families';
import { missedAlongside, StoreError } from './store';

export type PairKind = 'family' | 'look-alike' | 'alongside';
export type PairWord = Pick<BrowseWord, 'id' | 'fr' | 'en' | 'category' | 'status' | 'misses'>;
// a and b in id order, so a pair has one identity and one way of being shown; misses: both words' together.
export type Pair = { a: PairWord; b: PairWord; kinds: PairKind[]; misses: number };
export type PairItem = { wordId: string; otherId: string; fr: string; answer: string; other: string; en: string; why: string };

const BLANK = '___';
// The pairs batches are written for: the most missed this many.
const TOP_PAIRS = 12;
const PAIRS_PER_BATCH = 4;
const ITEMS_PER_PAIR = 3;
// A new batch is asked for while fewer than this many items wait unanswered.
const REFILL_AT = 4;
// After a batch fails or keeps nothing, the next is asked for no sooner than this.
const WRITE_RETRY_MS = 60_000;
// Answers to other items before a missed one comes back.
export const RETURN_AFTER = 3;
const MAX_WORDS = SENTENCE_WORDS.A2;
// A look-alike is a word of this many letters at least: below it, most words are a letter or two from each other.
const LOOK_LETTERS = 4;

// The edit distance between two words while it is at most `limit`, else limit + 1: once a whole row is past the
// limit the rest cannot come back under it, so most words stop after a row or two (mining compares every pair).
function editDistance(a: string, b: string, limit: number): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...next) > limit) return limit + 1;
    row = next;
  }
  return Math.min(row[b.length]!, limit + 1);
}

// A single word's letters, unaccented, without its article or reflexive pronoun; null for a phrase or a short word.
function shape(fr: string): string | null {
  const bare = bareFrench(fr);
  if (/\s/.test(bare)) return null;
  const letters = bare.replace(/[^a-z]/g, '');
  return letters.length >= LOOK_LETTERS ? letters : null;
}

// Two shapes that look alike: one inside the other (porter, emporter), or at most two letters apart and fewer than
// half the shorter word's letters (pain, main; but not chat, chez).
export function lookAlike(x: string, y: string): boolean {
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (long.includes(short)) return true;
  const limit = Math.min(2, Math.ceil(short.length / 2) - 1);
  return long.length - short.length <= limit && editDistance(x, y, limit) <= limit;
}

// The mixed-up pairs in a learner's words, most missed first: every started word missed at least once, with each
// started word of its family, each started look-alike, and its trouble list (lib/store.ts missedAlongside). A word is
// never paired with itself or with another word of the same French, and two words' French make one pair however
// many copies of them songs added (the most missed is kept).
export function minePairs(words: PairWord[], families: string[][]): Pair[] {
  const started = words.filter((word) => word.status !== 'new');
  const byId = new Map(started.map((word) => [word.id, word]));
  const misses = new Map(started.filter((word) => word.misses > 0).map((word) => [word.id, word.misses]));
  const familyOf = new Map(families.flatMap((ids) => ids.map((id) => [id, ids] as const)));
  const shapes = started.flatMap((word) => { const letters = shape(word.fr); return letters ? [{ word, letters }] : []; });
  const found = new Map<string, Pair>();
  const add = (one: PairWord, two: PairWord | undefined, kind: PairKind) => {
    if (!two || one.id === two.id || stem(one.fr) === stem(two.fr)) return;
    const [a, b] = one.id < two.id ? [one, two] : [two, one];
    const key = `${a.id}|${b.id}`;
    const pair = found.get(key) ?? { a, b, kinds: [], misses: a.misses + b.misses };
    if (!pair.kinds.includes(kind)) pair.kinds.push(kind);
    found.set(key, pair);
  };
  for (const word of started) {
    if (!word.misses) continue;
    for (const id of familyOf.get(word.id) ?? []) add(word, byId.get(id), 'family');
    const letters = shape(word.fr);
    if (letters) for (const other of shapes) if (lookAlike(letters, other.letters)) add(word, other.word, 'look-alike');
    for (const id of missedAlongside(word.id, misses, (other) => byId.get(other)?.category)) add(word, byId.get(id), 'alongside');
  }
  const seen = new Set<string>();
  return [...found.values()].sort((p, q) => q.misses - p.misses || p.a.id.localeCompare(q.a.id) || p.b.id.localeCompare(q.b.id))
    .filter((pair) => { const key = [stem(pair.a.fr), stem(pair.b.fr)].sort().join('|'); if (seen.has(key)) return false; seen.add(key); return true; });
}

export const pairLabel = (pair: Pick<Pair, 'a' | 'b'>) => `${pair.a.fr} · ${pair.b.fr}`;

// Whether a form written for a word is plausibly a form of it: one of its verb forms (the word after any helper or
// pronoun: allé of suis allé), or the same first three letters as the word, or as one of its words in a phrase.
export function formOf(form: string, word: string, verbForms: readonly string[] = []): boolean {
  const letters = stem(form);
  if (!letters) return false;
  if (verbForms.some((accepted) => stem(accepted.split(/[\s’']+/).at(-1) ?? '') === letters)) return true;
  const parts = bareFrench(word).split(/[^a-z]+/).filter((part) => part.length >= 3);
  return (parts.length ? parts : [stem(word)]).some((part) => {
    const n = Math.min(3, part.length);
    return n > 0 && letters.length >= n && letters.slice(0, n) === part.slice(0, n);
  });
}

export function pairsPrompt(pairs: Pair[], known: { fr: string; en: string }[], perPair = ITEMS_PER_PAIR): string {
  const lines = pairs.map((pair, index) => `${index + 1}. word 1: ${pair.a.fr} (${pair.a.en}); word 2: ${pair.b.fr} (${pair.b.en})`);
  return `You write practice items for Echo, an app for one English speaker learning French at about A2. The learner keeps mixing up the two words of each pair below. Each item is a French sentence with one blank and two choices, a form of word 1 and a form of word 2; only one of them fits the sentence by meaning, so choosing it shows the learner what each word means.

Write ${perPair} items for each pair, at least one whose answer is word 1 and one whose answer is word 2.

Each item:
- fr: one sentence of everyday French, at most ${MAX_WORDS} words with the answer in place, natural and true to life, with exactly one blank written ${BLANK}; the blank stands for the answer alone (no article, helper or pronoun in it);
- word: 1 or 2, the word of the pair the answer is a form of;
- answer: the form of that word that fits the blank (a verb conjugated, a noun or adjective agreed, as the sentence needs);
- other: the other word's form in the same shape (same person and tense, same number and gender), so that only the meaning tells them apart; it must not make sense in the sentence;
- en: a natural English translation of the whole sentence with the answer;
- why: one short line in plain English saying why the answer fits and the other does not, quoting the French in « ». For example: "« Emporter » is to take something along; « porter » is to carry or wear."

Use words from the learner's vocabulary below where you can (any form of them), plus little words (articles, pronouns, prepositions), time words and first names.

Reply with JSON only: {"items": [{"pair": 1, "word": 2, "fr": "Je ${BLANK} un sandwich pour le train.", "answer": "emporte", "other": "porte", "en": "I am taking a sandwich for the train.", "why": "..."}]}

Pairs:
${lines.join('\n')}

The learner's vocabulary (French = English):
${known.map((word) => `${word.fr} = ${word.en}`).join('\n')}`;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/['`]/g, '’') : '');

// One item as Claude wrote it for a pair, kept only when it has exactly one blank, an answer and another form that
// differ, each a form of its own word (formOf), and at most MAX_WORDS words with the answer in place. Returns the
// item, or what is wrong with it.
export function checkItem(raw: unknown, pair: Pair, verbForms: (wordId: string) => readonly string[] = () => []): PairItem | string {
  const entry = (raw ?? {}) as Record<string, unknown>;
  const fr = text(entry.fr).replace(/_{2,}/g, BLANK);
  const answer = text(entry.answer), other = text(entry.other), en = text(entry.en), why = text(entry.why);
  if (!fr || !answer || !other || !en || !why) return 'a part is missing';
  if (fr.length > 160 || answer.length > 40 || other.length > 40 || en.length > 200 || why.length > 300) return 'too long';
  const at = fr.indexOf(BLANK);
  if (at < 0 || fr.indexOf(BLANK, at + 1) >= 0) return 'not exactly one blank';
  if (answer.toLowerCase() === other.toLowerCase()) return 'the two forms are the same';
  const words = wordCount(fr.replace(BLANK, answer));
  if (words > MAX_WORDS) return `${words} words; at most ${MAX_WORDS}`;
  if (entry.word !== 1 && entry.word !== 2) return 'no word named for the answer';
  const [word, otherWord] = entry.word === 1 ? [pair.a, pair.b] : [pair.b, pair.a];
  if (!formOf(answer, word.fr, verbForms(word.id))) return `"${answer}" is not a form of ${word.fr}`;
  if (!formOf(other, otherWord.fr, verbForms(otherWord.id))) return `"${other}" is not a form of ${otherWord.fr}`;
  return { wordId: word.id, otherId: otherWord.id, fr, answer, other, en, why };
}

export function parseItems(reply: string, pairs: Pair[], verbForms?: (wordId: string) => readonly string[]): { items: PairItem[]; problems: string[] } {
  let parsed: { items?: unknown } | null;
  try { parsed = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)); } catch { parsed = null; }
  if (!Array.isArray(parsed?.items)) return { items: [], problems: ['the reply could not be read'] };
  const items: PairItem[] = [], problems: string[] = [];
  for (const raw of parsed.items) {
    const index = Number((raw as Record<string, unknown>)?.pair) - 1;
    const pair = pairs[index];
    if (!pair) { problems.push(`pair ${index + 1}: no such pair`); continue; }
    const checked = checkItem(raw, pair, verbForms);
    if (typeof checked === 'string') problems.push(`${pairLabel(pair)}: ${checked}`);
    else items.push(checked);
  }
  return { items, problems };
}

export type ItemStanding = { id: number; rank: number };
export type AnswerStanding = { sequence: number; item_id: number; right: number };

// The item to show next: a missed one RETURN_AFTER answers on (the one missed first, first), else among the rest
// (a missed one still waiting held back) the least seen, then the most missed pair, then the oldest. With nothing
// else left, a held one comes back early. again: it is back after a miss.
export function nextItem(items: ItemStanding[], answers: AnswerStanding[]): { id: number; again: boolean } | null {
  const byItem = Map.groupBy(answers, (answer) => answer.item_id);
  const standing = items.map((item) => {
    const given = byItem.get(item.id) ?? [];
    const last = given.at(-1);
    const missed = !!last && !last.right;
    const since = last ? answers.filter((answer) => answer.sequence > last.sequence).length : 0;
    return { item, seen: given.length, missed, due: missed && since >= RETURN_AFTER, lastAt: last?.sequence ?? 0 };
  });
  const back = standing.filter((entry) => entry.due).sort((x, y) => x.lastAt - y.lastAt)[0];
  if (back) return { id: back.item.id, again: true };
  const byOrder = (x: typeof standing[number], y: typeof standing[number]) => x.seen - y.seen || x.item.rank - y.item.rank || x.item.id - y.item.id;
  const next = standing.filter((entry) => !entry.missed).sort(byOrder)[0];
  if (next) return { id: next.item.id, again: false };
  const early = standing.sort((x, y) => x.lastAt - y.lastAt)[0];
  return early ? { id: early.item.id, again: true } : null;
}

type Row = { id: number; word_id: string; other_id: string; fr: string; answer: string; other: string; en: string; why: string };
type Standing = { byId: Map<string, PairWord>; pairs: Pair[]; rank: Map<string, number>; items: Row[]; answers: AnswerStanding[] };

export function createPairs(deps: {
  dbPath: string; ask: Ask;
  // Whether Claude may write (ECHO_PAIRS); items already written are shown either way.
  enabled: () => boolean;
  // Every word French → English, with its status and misses (store.browse('fr-en', 'all')).
  words: () => PairWord[];
  families: string[][];
  // Every form of a word that is a verb (lib/verbs.ts conjugate), none for another word.
  verbForms: (wordId: string) => readonly string[];
  known: () => { fr: string; en: string }[];
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  const db = new Database(deps.dbPath, { create: true, strict: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    -- A Mixed-up pairs item: fr holds one ___ for answer, a form of word_id; other is the form of other_id beside it.
    CREATE TABLE IF NOT EXISTS pair_items (
      id INTEGER PRIMARY KEY, word_id TEXT NOT NULL, other_id TEXT NOT NULL, fr TEXT NOT NULL UNIQUE, answer TEXT NOT NULL,
      other TEXT NOT NULL, en TEXT NOT NULL, why TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pair_answers (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, item_id INTEGER NOT NULL,
      chosen TEXT NOT NULL, right INTEGER NOT NULL, answered_at TEXT NOT NULL);`);
  const allItems = db.query<Row, []>('SELECT id, word_id, other_id, fr, answer, other, en, why FROM pair_items ORDER BY id');
  const itemById = db.query<Row, [number]>('SELECT id, word_id, other_id, fr, answer, other, en, why FROM pair_items WHERE id = ?');
  const addItem = db.query('INSERT OR IGNORE INTO pair_items (word_id, other_id, fr, answer, other, en, why, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const allAnswers = db.query<AnswerStanding, []>('SELECT sequence, item_id, right FROM pair_answers ORDER BY sequence');
  const answerByRequest = db.query<{ item_id: number; chosen: string }, [string]>('SELECT item_id, chosen FROM pair_answers WHERE request_id = ?');
  const addAnswer = db.query('INSERT INTO pair_answers (request_id, item_id, chosen, right, answered_at) VALUES (?, ?, ?, ?, ?)');

  let writing: Promise<void> | null = null;
  let error: string | null = null;
  let retryAt = -Infinity;
  const keyOf = (one: string, two: string) => (one < two ? `${one}|${two}` : `${two}|${one}`);
  // Mining compares every missed word with every started one (a few hundred ms on a full deck), and its result changes
  // only with a word's French, status or misses, so it is kept until one of those changes.
  let mined = { key: '', pairs: [] as Pair[] };
  function mine(words: PairWord[]): Pair[] {
    const key = words.map((word) => `${word.id}\t${word.fr}\t${word.status === 'new' ? 0 : 1}\t${word.misses}`).join('\n');
    if (key !== mined.key) mined = { key, pairs: minePairs(words, deps.families) };
    return mined.pairs;
  }

  // The pairs as the learner's misses give them now, and the items whose two words are still in Echo.
  function standing(): Standing {
    const words = deps.words();
    const byId = new Map(words.map((word) => [word.id, word]));
    const pairs = mine(words);
    const rank = new Map(pairs.map((pair, index) => [keyOf(pair.a.id, pair.b.id), index]));
    const items = allItems.all().filter((row) => byId.has(row.word_id) && byId.has(row.other_id));
    return { byId, pairs, rank, items, answers: allAnswers.all() };
  }

  // Asks for a batch while fewer than REFILL_AT items wait unanswered: the top pairs with the fewest items first. One
  // batch at a time; a failure is shown and not retried for WRITE_RETRY_MS, so a Claude that is down is not asked on
  // every item.
  function refill(state: Standing): void {
    if (writing || !deps.enabled() || now().getTime() < retryAt) return;
    const answered = new Set(state.answers.map((answer) => answer.item_id));
    if (state.items.filter((row) => !answered.has(row.id)).length >= REFILL_AT) return;
    const count = new Map<string, number>();
    for (const row of state.items) { const key = keyOf(row.word_id, row.other_id); count.set(key, (count.get(key) ?? 0) + 1); }
    const chosen = state.pairs.slice(0, TOP_PAIRS).map((pair, index) => ({ pair, index, have: count.get(keyOf(pair.a.id, pair.b.id)) ?? 0 }))
      .sort((x, y) => x.have - y.have || x.index - y.index).slice(0, PAIRS_PER_BATCH).map((entry) => entry.pair);
    if (!chosen.length) return;
    // The promise is cleared in .finally, which always runs after this assignment, even when the batch fails at once.
    writing = (async () => {
      try {
        const reply = await deps.ask(pairsPrompt(chosen, deps.known()), { timeout: 5 * 60_000, purpose: 'writing mixed-up pairs' });
        const { items, problems } = parseItems(reply, chosen, deps.verbForms);
        const at = now().toISOString();
        const kept = db.transaction(() => items.filter((item) => addItem.run(item.wordId, item.otherId, item.fr, item.answer, item.other, item.en, item.why, at).changes > 0).length)();
        console.log(`mixed-up pairs: kept ${kept} of ${items.length + problems.length}${problems.length ? `; left out ${problems.join('; ')}` : ''}`);
        if (!kept) throw new StoreError('Claude’s sentences for your pairs could not be used. Please try again later.');
        error = null;
      } catch (failure) {
        error = failure instanceof Error ? failure.message : 'The sentences could not be written.';
        retryAt = now().getTime() + WRITE_RETRY_MS;
        console.error(`mixed-up pairs: ${error}`);
      }
    })().finally(() => { writing = null; });
  }

  function view(row: Row, byId: Map<string, PairWord>, again: boolean): PairView {
    const [first, second] = [row.word_id, row.other_id].sort();
    // The order of the choices is fixed per item, so a reload shows it the same.
    const choices = row.id % 2 ? [row.answer, row.other] : [row.other, row.answer];
    return { id: String(row.id), fr: row.fr, en: row.en, choices, words: [byId.get(first!)!.fr, byId.get(second!)!.fr], again, check: { answer: row.answer, why: row.why } };
  }

  // What the screen shows: the next item, and whether a batch is being written.
  function state(): PairsState {
    const current = standing();
    refill(current);
    const next = nextItem(current.items.map((row) => ({ id: row.id, rank: current.rank.get(keyOf(row.word_id, row.other_id)) ?? Infinity })), current.answers);
    const row = next ? current.items.find((item) => item.id === next.id)! : null;
    return { current: row ? view(row, current.byId, next!.again) : null, writing: !!writing, error: writing ? null : error, pairs: current.pairs.length };
  }

  // An answer, kept once per request id.
  function answer(input: { requestId?: unknown; id?: unknown; choice?: unknown }): PairResult {
    const requestId = typeof input?.requestId === 'string' && input.requestId.trim() ? input.requestId : '';
    if (!requestId) throw new StoreError('This answer is missing its request ID.');
    const kept = answerByRequest.get(requestId);
    const row = kept ? itemById.get(kept.item_id) : typeof input?.id === 'string' && /^\d+$/.test(input.id) ? itemById.get(Number(input.id)) : null;
    if (!row) throw new StoreError('That sentence is not in Echo.', 404);
    const chosen = kept?.chosen ?? (typeof input.choice === 'string' ? input.choice : '');
    if (!kept) {
      if (chosen !== row.answer && chosen !== row.other) throw new StoreError('Choose one of the two words.');
      addAnswer.run(requestId, row.id, chosen, chosen === row.answer ? 1 : 0, now().toISOString());
    }
    return { id: String(row.id), right: chosen === row.answer, answer: row.answer, chosen, why: row.why };
  }

  // The pairs batches are written for (the most missed TOP_PAIRS), as Mistakes lists them.
  function labels(count = 3): { count: number; examples: string[] } {
    const pairs = mine(deps.words()).slice(0, TOP_PAIRS);
    return { count: pairs.length, examples: pairs.slice(0, count).map(pairLabel) };
  }

  // prepare: the batch at start, so the first pairs are ready when Mixed-up pairs is first opened.
  return { state, answer, labels, prepare: () => refill(standing()), settled: async () => { await writing; }, close: () => db.close() };
}
