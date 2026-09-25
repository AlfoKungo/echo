import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ComprehensionPassage, ComprehensionSentence, ExerciseKind, ExerciseResult, ExerciseView,
  Gloss, PassageLine, StreamId, StreamState,
} from '../comprehension-contract';
import type { ComprehensionDayCounts, GrammarLevel } from '../contract';
import type { Bank } from './comprehension-content';
import { wholeMatches, wordCount } from './comprehension-content';
import { normalize, stripAccents } from './grammar-content';
import { recentStudyDays, StoreError, studyDay } from './store';

export type Mode = 'listen' | 'read';
export type ItemType = 'sentence' | 'dialogue' | 'text';
export type Outcome = ExerciseResult['outcome'];
// The vocabulary side of level fitting: how well the learner knows each word, from browse('fr-en', 'all').
export type WordKnowledge = { status: 'new' | 'learning' | 'due' | 'scheduled'; misses: number };
export type ComprehensionMutation = { stream: StreamId; key: string; version: number; requestId: string };
export type LookupInput = ComprehensionMutation & { fr: string };
export type AnswerInput = ComprehensionMutation & { choice?: number; text?: string };
// One outstanding comprehension mistake: the latest answer for this exercise was incorrect or helped.
export type ComprehensionMiss = {
  key: string; mode: Mode; kind: ExerciseKind; itemId: string; type: ItemType;
  topics: string[]; words: string[]; example: string; lastAt: string; due: boolean;
};

export interface ComprehensionStore {
  state(stream: StreamId): StreamState;
  lookup(input: LookupInput): StreamState;
  answer(input: AnswerInput): StreamState;
  next(input: ComprehensionMutation): StreamState;
  misses(): ComprehensionMiss[];
  lookupCounts(): { wordId: string; count: number }[];
  weakWords(): string[];
  // Words read or heard in items answered right at least once, without being tapped there: their gloss forms
  // (lowercase, as written) and the vocabulary ids those glosses link. What the learner meets and understands.
  metWords(): { forms: Set<string>; words: Set<string> };
  // The level each mode is choosing from now, how many answers were given in all, and per study day of the last
  // 14 (oldest first) how many Listen and Read answers were right (on your own or with help) out of how many.
  summary(): { levels: { mode: Mode; label: GrammarLevel; value: number }[]; answered: number; comprehensionDays: ComprehensionDayCounts[] };
  // Unseen sentences and dialogues/texts at each level either mode is choosing from now (see BAND_BELOW/BAND_ABOVE).
  stock(): { level: GrammarLevel; sentences: number; passages: number }[];
  exportData(): unknown;
  close(): void;
}

export type ComprehensionOptions = {
  dbPath?: string;
  now?: () => Date;
  random?: () => number;
  // Listen exercises are only offered once every clip they need is on disk, so Listen works while audio renders.
  clipExists?: (clipId: string) => boolean;
  knownStatus?: () => Map<string, WordKnowledge>;
};

const BASE: Record<GrammarLevel, number> = { A1: 1, A2: 2, B1: 3 };
const MIN_LEVEL = 1;
const MAX_LEVEL = 3.99;
const BAND_BELOW = 0.6;
const BAND_ABOVE = 0.3;
const CORRECT_STEP = 0.05;
const MISS_STEP = 0.2;
const MISS_ANSWERS = 8; // a first miss returns after this many answers in the stream it was missed in
const REVIEW_DAYS = 3; // a correct exercise returns in 3 days, then ×3 for each further correct answer
const RECENT = 20; // prefer not to repeat an item within this many answers
const REST_DAYS = 7; // once every item at hand is met, another kind of one waits this long before it is offered
const DAY = 86_400_000;
const LEVEL_OF = (value: number): GrammarLevel => (value < 2 ? 'A1' : value < 3 ? 'A2' : 'B1');
const MODES: Mode[] = ['listen', 'read'];
const TOPIC_STREAM = /^focus:topic:[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EDGE = /^[«»"“”'’,.;:!?…\-]+|[«»"“”'’,.;:!?…\-]+$/gu;

export function parseStream(value: unknown): StreamId {
  if (typeof value === 'string' &&
    (value === 'listen' || value === 'read' || value === 'mix' || value === 'focus:words' || value === 'focus:missed' || TOPIC_STREAM.test(value))) {
    return value as StreamId;
  }
  throw new StoreError('Choose Practise, Listen, Read or one of your mistake groups.', 400);
}

// Loose comparison: what a phone keyboard slips on — accents, ligatures and commas — is a spelling note, not a miss.
const loose = (value: string) => stripAccents(value.replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim());
const bare = (token: string) => loose(normalize(token)).replace(EDGE, '');

// A typed answer is a listening check, so a difference the ear cannot hear is a spelling note too: the digits of a
// number heard as words, and one silent ending (plural, agreement, or a verb ending that sounds like its stem).
const INAUDIBLE = /(e?nt|e?s|e?x|e?t|e?d|e?z|er|e)$/;
const fold = (key: string) => key.replace(INAUDIBLE, '') || key;
const NUMBER_WORDS = ['zero', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];

// Every way to write 0–100 in French: both 70–99 systems, with hyphens, with spaces, and with "et un".
function buildFrenchNumbers(): Map<string, number> {
  const names = new Map<string, number>();
  const add = (value: number, ...forms: string[]) => {
    for (const form of forms) { names.set(form, value); names.set(form.replace(/-/g, ' '), value); }
  };
  NUMBER_WORDS.forEach((word, value) => add(value, word));
  add(1, 'une');
  for (const [tens, word] of [[20, 'vingt'], [30, 'trente'], [40, 'quarante'], [50, 'cinquante'], [60, 'soixante']] as const) {
    add(tens, word);
    add(tens + 1, `${word}-et-un`, `${word}-et-une`, `${word}-un`);
    for (let unit = 2; unit <= 9; unit++) add(tens + unit, `${word}-${NUMBER_WORDS[unit]}`);
  }
  add(70, 'soixante-dix');
  add(71, 'soixante-et-onze', 'soixante-onze');
  for (let unit = 12; unit <= 19; unit++) add(60 + unit, `soixante-${NUMBER_WORDS[unit]}`);
  add(80, 'quatre-vingts', 'quatre-vingt');
  for (let unit = 1; unit <= 19; unit++) add(80 + unit, `quatre-vingt-${NUMBER_WORDS[unit]}`);
  for (const [tens, word] of [[70, 'septante'], [80, 'huitante'], [80, 'octante'], [90, 'nonante']] as const) {
    add(tens, word);
    add(tens + 1, `${word}-et-un`, `${word}-un`);
    for (let unit = 2; unit <= 9; unit++) add(tens + unit, `${word}-${NUMBER_WORDS[unit]}`);
  }
  return names;
}

const FRENCH_NUMBERS = buildFrenchNumbers();
const NUMBER_SPAN = 4; // "quatre vingt dix sept"

// The longest number starting at `at`: 0–100 from the table, or "<2–9> cent(s) <0–99>" built on top of it.
function matchNumber(tokens: string[], at: number): { value: number; span: number } | null {
  const table = (start: number) => {
    for (let span = Math.min(NUMBER_SPAN, tokens.length - start); span >= 1; span--) {
      const value = FRENCH_NUMBERS.get(tokens.slice(start, start + span).map(bare).join(' '));
      if (value !== undefined) return { value, span };
    }
    return null;
  };
  const head = table(at);
  const hundreds = head && head.value >= 2 && head.value <= 9 ? head : null;
  const centAt = at + (hundreds?.span ?? 0);
  const cent = bare(tokens[centAt] ?? '');
  if (cent !== 'cent' && cent !== 'cents') return head;
  const rest = table(centAt + 1);
  const tail = rest && rest.value < 100 ? rest : null;
  return { value: (hundreds?.value ?? 1) * 100 + (tail?.value ?? 0), span: centAt + 1 + (tail?.span ?? 0) - at };
}

// An answer as comparable units: a number written either way collapses to its digits, every other word stands alone.
function units(text: string): { key: string; tokens: string[] }[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const found: { key: string; tokens: string[] }[] = [];
  for (let at = 0; at < tokens.length;) {
    const number = matchNumber(tokens, at);
    if (number) { found.push({ key: String(number.value), tokens: tokens.slice(at, at + number.span) }); at += number.span; continue; }
    found.push({ key: bare(tokens[at]!), tokens: [tokens[at]!] });
    at += 1;
  }
  return found;
}

const spoken = (text: string) => units(text).map((unit) => fold(unit.key)).join(' ');

type Item = {
  id: string;
  type: ItemType;
  level: GrammarLevel;
  title?: string;
  lines: PassageLine[];
  gloss: Gloss[];
  words: string[];
  topics: string[];
  clips: string[];
  sentence?: ComprehensionSentence;
  passage?: ComprehensionPassage;
  example: string; // a short French line, for mistake lists
};

type Candidate = {
  key: string;
  kind: ExerciseKind;
  mode: Mode;
  item: Item;
  questionIndex: number | null; // 1-based, question exercises only
  difficulty: number;
};

type Current = {
  key: string;
  kind: ExerciseKind;
  mode: Mode;
  itemId: string;
  questionIndex: number | null;
  choiceOrder: number[] | null; // meaning: the stored shuffle of [en, ...distractors]
  startedAt: string;
};

type StreamRow = {
  stream: string;
  version: number;
  answers: number;
  current_json: string | null;
  result_json: string | null;
  lookups_json: string;
  recent_json: string;
  updated_at: string;
};

type HistoryRow = {
  exercise_key: string;
  mode: Mode;
  item_id: string;
  kind: ExerciseKind;
  outcome: Outcome;
  misses: number;
  corrects: number;
  seen: number;
  due_at: number | null;
  due_stream: string | null;
  due_answers: number | null;
  last_at: string;
};

export function createComprehensionStore(bank: Bank, options: ComprehensionOptions = {}): ComprehensionStore {
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const clipExists = options.clipExists ?? (() => true);
  const knownStatus = options.knownStatus ?? (() => new Map<string, WordKnowledge>());

  // ── Content, flattened once ──────────────────────────────────────────────────
  const items = new Map<string, Item>();
  for (const sentence of bank.sentences) {
    items.set(sentence.id, {
      id: sentence.id, type: 'sentence', level: sentence.level, lines: [{ fr: sentence.fr, en: sentence.en }],
      gloss: sentence.gloss, words: sentence.words, topics: sentence.topics, clips: [sentence.id],
      sentence, example: sentence.fr,
    });
  }
  for (const passage of bank.passages) {
    const shortest = passage.lines.reduce((best, line) => (line.fr.length < best.fr.length ? line : best), passage.lines[0]);
    items.set(passage.id, {
      id: passage.id, type: passage.kind, level: passage.level, title: passage.title, lines: passage.lines,
      gloss: passage.gloss, words: passage.words, topics: passage.topics,
      clips: passage.lines.map((_, index) => `${passage.id}-${index + 1}`),
      passage, example: shortest?.fr ?? passage.title,
    });
  }

  // A long item is harder than its level alone suggests: more than 60% above the median length of its kind.
  const medians = new Map<string, number>();
  for (const group of ['sentence', 'passage'] as const) {
    for (const level of ['A1', 'A2', 'B1'] as GrammarLevel[]) {
      const lengths = [...items.values()]
        .filter((item) => (group === 'sentence' ? item.type === 'sentence' : item.type !== 'sentence') && item.level === level)
        .map((item) => wordCount(item.lines.map((line) => line.fr).join(' ')))
        .sort((a, b) => a - b);
      if (lengths.length) medians.set(`${group}:${level}`, lengths[Math.floor(lengths.length / 2)]!);
    }
  }
  function longBonus(item: Item): number {
    const median = medians.get(`${item.type === 'sentence' ? 'sentence' : 'passage'}:${item.level}`);
    if (!median) return 0;
    return wordCount(item.lines.map((line) => line.fr).join(' ')) > median * 1.6 ? 0.1 : 0;
  }

  const candidates: Candidate[] = [];
  for (const item of items.values()) {
    const base = BASE[item.level] + longBonus(item);
    if (item.sentence) {
      candidates.push({ key: `${item.id}:meaning`, kind: 'meaning', mode: 'read', item, questionIndex: null, difficulty: base });
      candidates.push({ key: `${item.id}:meaning`, kind: 'meaning', mode: 'listen', item, questionIndex: null, difficulty: base + 0.1 });
      candidates.push({ key: `${item.id}:gap`, kind: 'gap', mode: 'listen', item, questionIndex: null, difficulty: base + 0.3 });
      candidates.push({ key: `${item.id}:dictation`, kind: 'dictation', mode: 'listen', item, questionIndex: null, difficulty: base + 0.6 });
    }
    if (item.passage) {
      const read = item.type === 'dialogue' ? 0.3 : 0.5;
      const listen = item.type === 'dialogue' ? 0.5 : 0.7;
      item.passage.questions.forEach((_, index) => {
        const key = `${item.id}:question:${index + 1}`;
        candidates.push({ key, kind: 'question', mode: 'read', item, questionIndex: index + 1, difficulty: base + read });
        candidates.push({ key, kind: 'question', mode: 'listen', item, questionIndex: index + 1, difficulty: base + listen });
      });
    }
  }
  const byKeyMode = new Map(candidates.map((candidate) => [`${candidate.key}|${candidate.mode}`, candidate]));

  // ── Storage ──────────────────────────────────────────────────────────────────
  const dbPath = options.dbPath ?? './data/echo.db';
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS comprehension_streams (
        stream TEXT PRIMARY KEY,
        version INTEGER NOT NULL CHECK (version >= 0),
        answers INTEGER NOT NULL CHECK (answers >= 0),
        current_json TEXT,
        result_json TEXT,
        lookups_json TEXT NOT NULL,
        recent_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS comprehension_levels (
        mode TEXT PRIMARY KEY CHECK (mode IN ('listen', 'read')),
        value REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS comprehension_history (
        exercise_key TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('listen', 'read')),
        item_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('correct', 'helped', 'incorrect')),
        misses INTEGER NOT NULL,
        corrects INTEGER NOT NULL,
        seen INTEGER NOT NULL,
        due_at INTEGER,
        due_stream TEXT,
        due_answers INTEGER,
        last_at TEXT NOT NULL,
        PRIMARY KEY (exercise_key, mode)
      );
      CREATE TABLE IF NOT EXISTS comprehension_lookups (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        stream TEXT NOT NULL,
        exercise_key TEXT NOT NULL,
        mode TEXT NOT NULL,
        fr TEXT NOT NULL,
        word_id TEXT,
        looked_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS comprehension_answers (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        stream TEXT NOT NULL,
        exercise_key TEXT NOT NULL,
        mode TEXT NOT NULL,
        item_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        outcome TEXT NOT NULL,
        spelling INTEGER NOT NULL CHECK (spelling IN (0, 1)),
        given TEXT NOT NULL,
        level_before REAL NOT NULL,
        level_after REAL NOT NULL,
        answered_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS comprehension_requests (
        request_id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        stream TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS comprehension_lookups_word ON comprehension_lookups(word_id);
      CREATE INDEX IF NOT EXISTS comprehension_answers_key ON comprehension_answers(exercise_key, mode);
    `);
    for (const mode of MODES) db.query('INSERT OR IGNORE INTO comprehension_levels (mode, value) VALUES (?, ?)').run(mode, MIN_LEVEL);
  }).immediate();

  const readStream = db.query<StreamRow, [string]>('SELECT * FROM comprehension_streams WHERE stream = ?');
  const insertStream = db.query('INSERT INTO comprehension_streams (stream, version, answers, current_json, result_json, lookups_json, recent_json, updated_at) VALUES (?, 0, 0, NULL, NULL, ?, ?, ?)');
  const saveStream = db.query('UPDATE comprehension_streams SET version = ?, answers = ?, current_json = ?, result_json = ?, lookups_json = ?, recent_json = ?, updated_at = ? WHERE stream = ?');
  const readLevels = db.query<{ mode: Mode; value: number }, []>('SELECT mode, value FROM comprehension_levels');
  const saveLevel = db.query('UPDATE comprehension_levels SET value = ? WHERE mode = ?');
  const allHistory = db.query<HistoryRow, []>('SELECT * FROM comprehension_history');
  const itemMetAt = db.query<{ at: string | null }, [string]>('SELECT MAX(last_at) AS at FROM comprehension_history WHERE item_id = ?');
  const historyFor = db.query<HistoryRow, [string, string]>('SELECT * FROM comprehension_history WHERE exercise_key = ? AND mode = ?');
  const saveHistory = db.query(`
    INSERT INTO comprehension_history (exercise_key, mode, item_id, kind, outcome, misses, corrects, seen, due_at, due_stream, due_answers, last_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (exercise_key, mode) DO UPDATE SET
      outcome = excluded.outcome, misses = excluded.misses, corrects = excluded.corrects, seen = excluded.seen,
      due_at = excluded.due_at, due_stream = excluded.due_stream, due_answers = excluded.due_answers, last_at = excluded.last_at
  `);
  const addLookup = db.query('INSERT INTO comprehension_lookups (stream, exercise_key, mode, fr, word_id, looked_at) VALUES (?, ?, ?, ?, ?, ?)');
  const addAnswer = db.query(`
    INSERT INTO comprehension_answers (request_id, stream, exercise_key, mode, item_id, kind, outcome, spelling, given, level_before, level_after, answered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const requestById = db.query<{ action: string; stream: string }, [string]>('SELECT action, stream FROM comprehension_requests WHERE request_id = ?');
  const recordRequest = db.query('INSERT INTO comprehension_requests (request_id, action, stream, created_at) VALUES (?, ?, ?, ?)');
  const lookupTotals = db.query<{ word_id: string; count: number }, []>(`
    SELECT word_id, COUNT(DISTINCT exercise_key || '|' || fr) AS count FROM comprehension_lookups
    WHERE word_id IS NOT NULL GROUP BY word_id ORDER BY count DESC, word_id
  `);

  function levels(): Map<Mode, number> {
    return new Map(readLevels.all().map((row) => [row.mode, row.value]));
  }

  function loadStream(stream: StreamId, at: Date): StreamRow {
    const existing = readStream.get(stream);
    if (existing) return existing;
    insertStream.run(stream, '[]', '[]', at.toISOString());
    return readStream.get(stream)!;
  }

  function persist(row: StreamRow, at: Date): void {
    saveStream.run(row.version, row.answers, row.current_json, row.result_json, row.lookups_json, row.recent_json, at.toISOString(), row.stream);
  }

  const currentOf = (row: StreamRow): Current | null => (row.current_json ? JSON.parse(row.current_json) as Current : null);
  const resultOf = (row: StreamRow): ExerciseResult | null => (row.result_json ? JSON.parse(row.result_json) as ExerciseResult : null);
  const lookupsOf = (row: StreamRow): string[] => JSON.parse(row.lookups_json) as string[];
  const recentOf = (row: StreamRow): string[] => JSON.parse(row.recent_json) as string[];

  // ── Selection ────────────────────────────────────────────────────────────────
  function weakWordSet(known: Map<string, WordKnowledge>): Set<string> {
    const weak = new Set<string>();
    for (const [id, word] of known) if (word.misses >= 2) weak.add(id);
    for (const row of lookupTotals.all()) if (row.count >= 2) weak.add(row.word_id);
    return weak;
  }

  function pool(stream: StreamId, history: Map<string, HistoryRow>, known: Map<string, WordKnowledge>): Candidate[] {
    // A listen exercise is only offered once every clip it needs is on disk, so Listen works while audio renders.
    let allowed = candidates.filter((candidate) => candidate.mode === 'read' || candidate.item.clips.every((clip) => clipExists(clip)));
    if (stream === 'listen') allowed = allowed.filter((candidate) => candidate.mode === 'listen');
    if (stream === 'read') allowed = allowed.filter((candidate) => candidate.mode === 'read');
    if (stream.startsWith('focus:topic:')) {
      const topic = stream.slice('focus:topic:'.length);
      allowed = allowed.filter((candidate) => candidate.item.topics.includes(topic));
    }
    if (stream === 'focus:words') {
      const weak = weakWordSet(known);
      allowed = allowed.filter((candidate) => candidate.item.words.some((word) => weak.has(word)));
    }
    if (stream === 'focus:missed') {
      allowed = allowed.filter((candidate) => {
        const row = history.get(`${candidate.key}|${candidate.mode}`);
        return !!row && row.outcome !== 'correct';
      });
    }
    return allowed;
  }

  function coverage(item: Item, known: Map<string, WordKnowledge>): number {
    if (!item.words.length) return 0.5;
    let score = 0;
    for (const word of item.words) {
      const status = known.get(word)?.status;
      if (status === 'due' || status === 'scheduled') score += 1;
      else if (status === 'learning') score += 0.3;
    }
    return score / item.words.length;
  }

  function pickBest(all: Candidate[], known: Map<string, WordKnowledge>): Candidate {
    // Coverage ranks items within one kind: across kinds, short sentences would always outrank passages.
    const kinds = [...new Set(all.map((candidate) => candidate.kind))];
    const kind = kinds[Math.floor(random() * kinds.length)];
    const list = all.filter((candidate) => candidate.kind === kind);
    let best = -1;
    let top: Candidate[] = [];
    for (const candidate of list) {
      const score = coverage(candidate.item, known);
      if (score > best + 1e-9) { best = score; top = [candidate]; }
      else if (score > best - 1e-9) top.push(candidate);
    }
    return top[Math.floor(random() * top.length)] ?? list[0]!;
  }

  function choose(stream: StreamId, list: Candidate[], row: StreamRow, at: Date, history: Map<string, HistoryRow>, known: Map<string, WordKnowledge>, level: number, metAt: Map<string, string>): Candidate | null {
    if (!list.length) return null;
    const recent = recentOf(row);
    const last = recent[0];
    // Never the same item twice in a row.
    const notLast = (group: Candidate[]) => group.filter((candidate) => candidate.item.id !== last);
    // Prefer an item untouched for the last 20 answers — but a miss due after 8 answers still comes back on time.
    const fresh = (group: Candidate[]) => {
      const untouched = group.filter((candidate) => !recent.includes(candidate.item.id));
      return untouched.length ? untouched : notLast(group);
    };
    const rowOf = (candidate: Candidate) => history.get(`${candidate.key}|${candidate.mode}`);
    const oldest = (group: Candidate[]) => [...group].sort((a, b) => (rowOf(a)?.last_at ?? '').localeCompare(rowOf(b)?.last_at ?? ''))[0] ?? null;
    const time = at.getTime();
    const dueByTime = (entry: HistoryRow) => entry.due_at !== null && entry.due_at <= time;
    const dueByCount = (entry: HistoryRow) => entry.due_stream === stream && entry.due_answers !== null && row.answers >= entry.due_answers;

    const misses = list.filter((candidate) => { const entry = rowOf(candidate); return !!entry && entry.outcome !== 'correct'; });
    const dueMiss = notLast(misses.filter((candidate) => { const entry = rowOf(candidate)!; return dueByTime(entry) || dueByCount(entry); }));
    if (dueMiss.length) return oldest(dueMiss);
    // The mistakes drill serves every outstanding miss, due or not, then runs dry; two misses from one passage
    // may follow each other rather than end the drill early.
    if (stream === 'focus:missed') return oldest(notLast(misses)) ?? oldest(misses);

    const band = (group: Candidate[], widen = 0) => group.filter((candidate) => candidate.difficulty >= level - BAND_BELOW - widen && candidate.difficulty <= level + BAND_ABOVE + widen);
    const untried = fresh(list.filter((candidate) => !rowOf(candidate)));
    // An item met in any stream, as any kind, is known: its other exercises would be too easy to count as new.
    // A new passage opens at its first question; the rest follow it (see select).
    const unmet = untried.filter((candidate) => !metAt.has(candidate.item.id) && (candidate.kind !== 'question' || candidate.questionIndex === 1));
    if (band(unmet).length) return pickBest(band(unmet), known);

    const dueReview = fresh(list.filter((candidate) => { const entry = rowOf(candidate); return !!entry && entry.outcome === 'correct' && dueByTime(entry); }));
    if (dueReview.length) return oldest(dueReview);

    for (let widen = BAND_ABOVE; unmet.length && widen <= 4; widen += BAND_ABOVE) {
      const wider = band(unmet, widen);
      if (wider.length) return pickBest(wider, known);
    }
    if (unmet.length) return pickBest(unmet, known);
    // Every item at hand has been met: another kind of the one met longest ago is the next-best novelty,
    // first among those rested for a week, then any.
    const longestAgo = (group: Candidate[]) => [...group].sort((a, b) => metAt.get(a.item.id)!.localeCompare(metAt.get(b.item.id)!))[0] ?? null;
    const restedBefore = new Date(time - REST_DAYS * DAY).toISOString();
    const rested = untried.filter((candidate) => metAt.get(candidate.item.id)! <= restedBefore);
    if (rested.length) return longestAgo(band(rested).length ? band(rested) : rested);
    if (untried.length && stream.startsWith('focus:')) return longestAgo(untried);
    if (stream.startsWith('focus:')) return null; // a focus stream ends rather than looping over settled work
    return untried.length ? longestAgo(untried) : oldest(fresh(list));
  }

  function select(stream: StreamId, row: StreamRow, at: Date): Current | null {
    const history = new Map(allHistory.all().map((entry) => [`${entry.exercise_key}|${entry.mode}`, entry]));
    const metAt = new Map<string, string>();
    for (const entry of history.values()) if ((metAt.get(entry.item_id) ?? '') < entry.last_at) metAt.set(entry.item_id, entry.last_at);
    const known = knownStatus();
    const value = levels();
    const available = pool(stream, history, known);
    // A passage just answered keeps its reader: its remaining questions follow in the same mode while it is fresh.
    const last = recentOf(row)[0];
    const lastEntry = last ? [...history.values()].filter((entry) => entry.item_id === last).sort((a, b) => b.last_at.localeCompare(a.last_at))[0] : undefined;
    if (lastEntry?.kind === 'question') {
      const next = available
        .filter((candidate) => candidate.item.id === last && candidate.mode === lastEntry.mode && !history.has(`${candidate.key}|${candidate.mode}`))
        .sort((a, b) => a.questionIndex! - b.questionIndex!)[0];
      if (next) return makeCurrent(next, at);
    }
    // Practise alternates by item: the mode after a passage's last question is the other one.
    const first: Mode = stream === 'read' ? 'read' : stream === 'listen' ? 'listen' : lastEntry?.mode === 'listen' ? 'read' : 'listen';
    for (const mode of first === 'listen' ? MODES : [...MODES].reverse()) {
      const chosen = choose(stream, available.filter((candidate) => candidate.mode === mode), row, at, history, known, value.get(mode) ?? MIN_LEVEL, metAt);
      if (chosen) return makeCurrent(chosen, at);
    }
    return null;
  }

  function makeCurrent(candidate: Candidate, at: Date): Current {
    // Both kinds of multiple choice are shuffled, so the right answer never sits in a giveaway position.
    const pool = candidate.kind === 'meaning' ? [candidate.item.sentence!.en, ...candidate.item.sentence!.distractors]
      : candidate.kind === 'question' ? candidate.item.passage!.questions[candidate.questionIndex! - 1]!.choices
      : null;
    let choiceOrder: number[] | null = null;
    if (pool) {
      choiceOrder = pool.map((_, index) => index);
      for (let index = choiceOrder.length - 1; index > 0; index--) {
        const other = Math.floor(random() * (index + 1));
        [choiceOrder[index], choiceOrder[other]] = [choiceOrder[other]!, choiceOrder[index]!];
      }
    }
    return {
      key: candidate.key, kind: candidate.kind, mode: candidate.mode, itemId: candidate.item.id,
      questionIndex: candidate.questionIndex, choiceOrder, startedAt: at.toISOString(),
    };
  }

  // ── Views ────────────────────────────────────────────────────────────────────
  function itemOf(current: Current): Item {
    const item = items.get(current.itemId);
    if (!item) throw new StoreError('This exercise is no longer part of Echo. Move on to the next one.', 409);
    return item;
  }

  // Before settling the French is shown but never its translation, so a read exercise stays a comprehension test.
  const hidden = (lines: PassageLine[]): PassageLine[] =>
    lines.map((line) => (line.speaker === undefined ? { fr: line.fr, en: '' } : { speaker: line.speaker, fr: line.fr, en: '' }));

  function gapPrompt(sentence: ComprehensionSentence): string {
    const at = wholeMatches(sentence.fr, sentence.gap)[0];
    if (at === undefined) return sentence.fr;
    return `${sentence.fr.slice(0, at)}____${sentence.fr.slice(at + sentence.gap.length)}`;
  }

  // The choices as this exercise shows them, and where its stored shuffle put the right one.
  function shownChoices(item: Item, current: Current): { choices: string[]; answerIndex: number } | null {
    const question = current.kind === 'question' ? item.passage!.questions[current.questionIndex! - 1]! : null;
    if (!question && current.kind !== 'meaning') return null;
    const pool = question ? question.choices : [item.sentence!.en, ...item.sentence!.distractors];
    const order = current.choiceOrder ?? pool.map((_, index) => index);
    return { choices: order.map((index) => pool[index]!), answerIndex: order.indexOf(question ? question.answer : 0) };
  }

  function view(current: Current): ExerciseView {
    const item = itemOf(current);
    const question = current.kind === 'question' ? item.passage!.questions[current.questionIndex! - 1]! : null;
    const clips = current.mode === 'listen' ? item.clips : item.clips.filter((clip) => clipExists(clip));
    const prompt: ExerciseView['prompt'] = {};
    if (question) prompt.question = question.question;
    if (current.mode === 'read') {
      if (item.sentence) prompt.text = item.sentence.fr;
      else prompt.lines = hidden(item.lines);
    } else if (current.kind === 'gap') {
      prompt.text = gapPrompt(item.sentence!);
    }
    const shown = shownChoices(item, current);
    return {
      key: current.key, kind: current.kind, mode: current.mode, level: item.level,
      item: { id: item.id, type: item.type, ...(item.title === undefined ? {} : { title: item.title }) },
      audio: clips.map((clip) => `audio/comprehension/${clip}.mp3`),
      gloss: current.mode === 'read' ? item.gloss : [],
      prompt,
      ...(shown ? { choices: shown.choices } : {}),
    };
  }

  function snapshot(row: StreamRow): StreamState {
    const value = levels();
    const current = currentOf(row);
    return {
      stream: row.stream as StreamId,
      level: MODES.map((mode) => {
        const raw = value.get(mode) ?? MIN_LEVEL;
        return { mode, label: LEVEL_OF(raw), value: Math.round(raw * 100) / 100 };
      }),
      current: current ? view(current) : null,
      result: resultOf(row),
      lookups: lookupsOf(row),
      version: row.version,
    };
  }

  // ── Answer checking ──────────────────────────────────────────────────────────
  function typedCheck(expected: string, given: string): { ok: boolean; spelling: boolean } {
    const target = normalize(expected);
    const answer = normalize(given);
    if (!answer) return { ok: false, spelling: false };
    if (target === answer) return { ok: true, spelling: false };
    if (loose(target) === loose(answer)) return { ok: true, spelling: true };
    // Same words to the ear: "21" for "vingt et un", "arrive" for "arrivés".
    if (spoken(target) === spoken(answer)) return { ok: true, spelling: true };
    return { ok: false, spelling: false };
  }

  function dictationDiff(expected: string, given: string): { text: string; ok: boolean }[] {
    const pool = units(given).map((unit) => unit.key).filter(Boolean);
    const diff: { text: string; ok: boolean }[] = [];
    for (const unit of units(expected)) {
      // A lone ? or ! is spacing, not a word to catch.
      const at = unit.key ? pool.findIndex((key) => key === unit.key || fold(key) === fold(unit.key)) : -1;
      if (at >= 0) pool.splice(at, 1);
      for (const token of unit.tokens) diff.push({ text: token, ok: !unit.key || at >= 0 });
    }
    return diff;
  }

  function grade(current: Current, input: AnswerInput, lookups: string[]): { result: ExerciseResult; outcome: Outcome } {
    const item = itemOf(current);
    let expected = '';
    let given = '';
    let ok = false;
    let spelling = false;
    let diff: { text: string; ok: boolean }[] | undefined;
    let explanation: string | undefined;
    const shown = shownChoices(item, current);
    if (shown) {
      if (!Number.isInteger(input.choice) || input.choice! < 0 || input.choice! >= shown.choices.length) {
        throw new StoreError('Choose one of the answers before checking.', 400);
      }
      expected = shown.choices[shown.answerIndex]!;
      given = shown.choices[input.choice!]!;
      ok = input.choice === shown.answerIndex;
      if (current.kind === 'question') explanation = item.passage!.questions[current.questionIndex! - 1]!.explanation;
    } else {
      if (typeof input.text !== 'string' || !input.text.trim()) throw new StoreError('Type what you heard before checking it.', 400);
      expected = current.kind === 'gap' ? item.sentence!.gap : item.sentence!.fr;
      given = input.text.trim();
      const check = typedCheck(expected, given);
      ok = check.ok;
      spelling = check.spelling;
      if (current.kind === 'dictation') diff = dictationDiff(expected, given);
    }
    const helped = ok && current.mode === 'read' && lookups.length > 0;
    const outcome: Outcome = !ok ? 'incorrect' : helped ? 'helped' : 'correct';
    const result: ExerciseResult = {
      outcome, expected, given,
      ...(spelling ? { spelling: true } : {}),
      ...(diff ? { diff } : {}),
      ...(explanation ? { explanation } : {}),
      lines: item.lines,
      gloss: item.gloss,
    };
    return { result, outcome };
  }

  // ── Scheduling ───────────────────────────────────────────────────────────────
  function schedule(current: Current, outcome: Outcome, stream: StreamId, answers: number, at: Date): void {
    const previous = historyFor.get(current.key, current.mode);
    const time = at.getTime();
    let misses = previous?.misses ?? 0;
    let corrects = previous?.corrects ?? 0;
    let dueAt: number | null = null;
    let dueStream: string | null = null;
    let dueAnswers: number | null = null;
    if (outcome === 'correct') {
      corrects += 1;
      misses = 0;
      dueAt = time + REVIEW_DAYS * DAY * Math.pow(3, corrects - 1);
    } else {
      misses += 1;
      corrects = 0;
      if (misses === 1) { dueStream = stream; dueAnswers = answers + MISS_ANSWERS; dueAt = time + DAY; }
      else if (misses === 2) dueAt = time + DAY;
      else dueAt = time + 3 * DAY;
    }
    saveHistory.run(current.key, current.mode, current.itemId, current.kind, outcome, misses, corrects,
      (previous?.seen ?? 0) + 1, dueAt, dueStream, dueAnswers, at.toISOString());
  }

  function adjust(mode: Mode, outcome: Outcome): { before: number; after: number } {
    const before = levels().get(mode) ?? MIN_LEVEL;
    const step = outcome === 'correct' ? CORRECT_STEP : outcome === 'incorrect' ? -MISS_STEP : 0;
    const after = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, before + step));
    if (after !== before) saveLevel.run(after, mode);
    return { before, after };
  }

  // ── Mutations ────────────────────────────────────────────────────────────────
  function claim(requestId: unknown, action: string, stream: StreamId, at: Date): boolean {
    if (typeof requestId !== 'string' || !requestId.trim()) throw new StoreError('This request is missing its ID. Reload and try again.', 400);
    const previous = requestById.get(requestId);
    if (previous) {
      if (previous.action !== action || previous.stream !== stream) throw new StoreError('This request ID was already used for something else. Reload and try again.', 409);
      return false;
    }
    recordRequest.run(requestId, action, stream, at.toISOString());
    return true;
  }

  function match(row: StreamRow, input: ComprehensionMutation): Current {
    const current = currentOf(row);
    if (!current || current.key !== input.key || row.version !== input.version) {
      throw new StoreError('This exercise has moved on. Reload it and try again.', 409);
    }
    return current;
  }

  function ensureCurrent(row: StreamRow, stream: StreamId, at: Date): boolean {
    if (row.result_json) return false;
    const waiting = currentOf(row);
    if (waiting) {
      // An exercise left waiting here whose item was answered in another stream since would now be a repeat.
      const met = itemMetAt.get(waiting.itemId)?.at;
      if (!met || met < waiting.startedAt) return false;
      row.current_json = null;
      row.lookups_json = '[]';
    }
    const chosen = select(stream, row, at);
    if (!chosen && !waiting) return false;
    row.current_json = chosen ? JSON.stringify(chosen) : null;
    row.version += 1;
    return true;
  }

  function state(stream: StreamId): StreamState {
    return db.transaction(() => {
      const at = now();
      const row = loadStream(stream, at);
      if (ensureCurrent(row, stream, at)) persist(row, at);
      return snapshot(row);
    }).immediate();
  }

  function lookup(input: LookupInput): StreamState {
    const stream = parseStream(input.stream);
    return db.transaction(() => {
      const at = now();
      const row = loadStream(stream, at);
      if (!claim(input.requestId, 'lookup', stream, at)) return snapshot(row);
      const current = match(row, input);
      const item = itemOf(current);
      if (typeof input.fr !== 'string' || !item.gloss.some((entry) => entry.fr === input.fr)) {
        throw new StoreError('That word is not part of this text.', 400);
      }
      const gloss = item.gloss.find((entry) => entry.fr === input.fr)!;
      addLookup.run(stream, current.key, current.mode, gloss.fr, gloss.word ?? null, at.toISOString());
      const lookups = lookupsOf(row);
      if (!lookups.includes(gloss.fr)) lookups.push(gloss.fr);
      row.lookups_json = JSON.stringify(lookups);
      row.version += 1;
      persist(row, at);
      return snapshot(row);
    }).immediate();
  }

  function answer(input: AnswerInput): StreamState {
    const stream = parseStream(input.stream);
    return db.transaction(() => {
      const at = now();
      const row = loadStream(stream, at);
      if (!claim(input.requestId, 'answer', stream, at)) return snapshot(row);
      const current = match(row, input);
      if (row.result_json) throw new StoreError('This exercise is already answered. Move on to the next one.', 409);
      const lookups = lookupsOf(row);
      const { result, outcome } = grade(current, input, lookups);
      row.answers += 1;
      schedule(current, outcome, stream, row.answers, at);
      const level = adjust(current.mode, outcome);
      addAnswer.run(input.requestId, stream, current.key, current.mode, current.itemId, current.kind, outcome,
        result.spelling ? 1 : 0, result.given, level.before, level.after, at.toISOString());
      const recent = [current.itemId, ...recentOf(row).filter((id) => id !== current.itemId)].slice(0, RECENT);
      row.recent_json = JSON.stringify(recent);
      row.result_json = JSON.stringify(result);
      row.version += 1;
      persist(row, at);
      return snapshot(row);
    }).immediate();
  }

  function next(input: ComprehensionMutation): StreamState {
    const stream = parseStream(input.stream);
    return db.transaction(() => {
      const at = now();
      const row = loadStream(stream, at);
      if (!claim(input.requestId, 'next', stream, at)) return snapshot(row);
      match(row, input);
      if (!row.result_json) throw new StoreError('Answer this exercise before moving on.', 409);
      row.current_json = null;
      row.result_json = null;
      row.lookups_json = '[]';
      row.version += 1;
      const chosen = select(stream, row, at);
      row.current_json = chosen ? JSON.stringify(chosen) : null;
      persist(row, at);
      return snapshot(row);
    }).immediate();
  }

  // ── Mistakes ─────────────────────────────────────────────────────────────────
  function misses(): ComprehensionMiss[] {
    const time = now().getTime();
    return allHistory.all()
      .filter((entry) => entry.outcome !== 'correct')
      .sort((a, b) => b.last_at.localeCompare(a.last_at))
      .flatMap((entry) => {
        const candidate = byKeyMode.get(`${entry.exercise_key}|${entry.mode}`);
        if (!candidate) return [];
        const item = candidate.item;
        return [{
          key: entry.exercise_key, mode: entry.mode, kind: entry.kind, itemId: item.id, type: item.type,
          topics: item.topics, words: item.words, example: item.example, lastAt: entry.last_at,
          due: entry.due_at !== null && entry.due_at <= time,
        }];
      });
  }

  function lookupCounts(): { wordId: string; count: number }[] {
    return lookupTotals.all().map((row) => ({ wordId: row.word_id, count: row.count }));
  }
  const answeredItems = db.query<{ item_id: string }, []>('SELECT DISTINCT item_id FROM comprehension_history WHERE corrects > 0');
  const lookedUp = db.query<{ exercise_key: string; fr: string }, []>('SELECT DISTINCT exercise_key, fr FROM comprehension_lookups');
  function metWords(): { forms: Set<string>; words: Set<string> } {
    const tapped = new Set(lookedUp.all().map((row) => `${row.exercise_key.slice(0, row.exercise_key.lastIndexOf(':'))}|${row.fr}`));
    const forms = new Set<string>(), words = new Set<string>();
    for (const { item_id } of answeredItems.all()) {
      for (const entry of items.get(item_id)?.gloss ?? []) {
        if (tapped.has(`${item_id}|${entry.fr}`)) continue;
        forms.add(entry.fr.toLowerCase());
        if (entry.word) words.add(entry.word);
      }
    }
    return { forms, words };
  }

  function exportData(): unknown {
    return db.transaction(() => ({
      levels: readLevels.all(),
      streams: db.query<StreamRow, []>('SELECT * FROM comprehension_streams ORDER BY stream').all().map((row) => ({
        stream: row.stream, version: row.version, answers: row.answers, updatedAt: row.updated_at,
        current: row.current_json ? JSON.parse(row.current_json) : null,
        result: row.result_json ? JSON.parse(row.result_json) : null,
        lookups: JSON.parse(row.lookups_json), recent: JSON.parse(row.recent_json),
      })),
      history: db.query('SELECT * FROM comprehension_history ORDER BY exercise_key, mode').all(),
      answers: db.query('SELECT * FROM comprehension_answers ORDER BY sequence').all(),
      lookups: db.query('SELECT * FROM comprehension_lookups ORDER BY sequence').all(),
    }))();
  }

  return {
    state: (stream) => state(parseStream(stream)),
    lookup, answer, next, misses, lookupCounts, metWords,
    weakWords: () => [...weakWordSet(knownStatus())],
    summary: () => {
      const value = levels();
      const recent = recentStudyDays(now(), 14);
      const comprehensionDays: ComprehensionDayCounts[] = recent.days.map((day) => ({ day, listen: { right: 0, total: 0 }, read: { right: 0, total: 0 } }));
      const byDay = new Map(comprehensionDays.map((entry) => [entry.day, entry]));
      for (const row of db.query<{ mode: Mode; outcome: Outcome; at: string }, [string]>('SELECT mode, outcome, answered_at AS at FROM comprehension_answers WHERE answered_at >= ?').all(recent.since.toISOString())) {
        const count = byDay.get(studyDay(new Date(row.at)))?.[row.mode];
        if (count) { count.total += 1; if (row.outcome !== 'incorrect') count.right += 1; }
      }
      return {
        levels: MODES.map((mode) => ({ mode, label: LEVEL_OF(value.get(mode) ?? MIN_LEVEL), value: value.get(mode) ?? MIN_LEVEL })),
        answered: db.query<{ count: number }, []>('SELECT count(*) AS count FROM comprehension_answers').get()!.count,
        comprehensionDays,
      };
    },
    stock: () => {
      const value = levels();
      const reach = new Set(MODES.flatMap((mode) => {
        const raw = value.get(mode) ?? MIN_LEVEL;
        return [LEVEL_OF(Math.max(MIN_LEVEL, raw - BAND_BELOW)), LEVEL_OF(Math.min(MAX_LEVEL, raw + BAND_ABOVE))];
      }));
      const met = new Set(db.query<{ id: string }, []>('SELECT DISTINCT item_id AS id FROM comprehension_history').all().map((row) => row.id));
      return (['A1', 'A2', 'B1'] as GrammarLevel[]).filter((level) => reach.has(level)).map((level) => {
        const unmet = [...items.values()].filter((item) => item.level === level && !met.has(item.id));
        return { level, sentences: unmet.filter((item) => item.type === 'sentence').length, passages: unmet.filter((item) => item.type !== 'sentence').length };
      });
    },
    exportData,
    close: () => db.close(),
  };
}
