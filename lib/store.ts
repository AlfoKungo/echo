import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createEmptyCard, fsrs, Rating, type Card, type CardInput } from 'ts-fsrs';
import { pointsFromLowest } from './score-points';
import type { AddWordInput, AddWordResult, BrowseWord, CardTrouble, CardView, Deck, Direction, EndlessInput, EndlessMarkInput, EndlessPick, ExtraWordsInput, GradeInput, HeardInput, AddWordsInput, LinkWordsInput, ListeningWord, ReviewEarlyInput, Settings, Snapshot, ScoreDayWords, ScoreHistoryDay, Stats, StatsDay, VerdictInput, VocabularyStatistics, VocabularyStack, Word } from '../contract';

export class StoreError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
    this.name = 'StoreError';
  }
}

export interface Store {
  state(direction: Direction, deck: string): Snapshot;
  start(direction: Direction, deck: string): Snapshot;
  grade(input: GradeInput): Snapshot;
  undo(direction: Direction, deck: string, undoId: string): Snapshot;
  settings(): Settings;
  setSettings(newPerDay: number): Settings;
  setSongsFirst(songsFirst: boolean): Settings;
  // Adds words to a category of their own (a song); they are new words from then on. Returns them with their ids.
  addWords(input: AddWordsInput): Word[];
  // Puts words already in Echo into a song's deck as well, keeping their own category and their one progress
  // record: a deck only chooses which words a practice draws from. Idempotent; returns the ids now linked.
  linkWords(input: LinkWordsInput): string[];
  word(id: string): Word | undefined;
  words(): Word[];
  // Word ids added from songs, in the order they were added.
  addedIds(): string[];
  addExtraWords(input: ExtraWordsInput): Snapshot;
  reviewEarly(input: ReviewEarlyInput): Snapshot;
  addWord(input: AddWordInput): AddWordResult;
  browse(direction: Direction, deck: string): BrowseWord[];
  // Per deck in one direction: words started today and words not started yet (the shared daily allowance decides
  // how many of those come in).
  deckCounts(direction: Direction): Record<string, { today: number; waiting: number }>;
  // Every word as the Walkman sees it, both directions merged: a word being learnt either way is learning.
  listening(): ListeningWord[];
  // A word heard to the end on the Walkman; a repeated requestId counts once.
  recordHeard(input: HeardInput): void;
  // The learner's own say, after a Walkman listen, on whether they knew the word; knew:null withdraws it.
  recordVerdict(input: VerdictInput): void;
  // Say it: what recognition wrote down for a word when the learner says it heard them wrong; marking it right
  // replaces the ✗ (id is the check's) with ✓, and the same words count as that word's English from then on.
  acceptSaid(input: { id: string; wordId: string; heard: string }): void;
  sayAccepted(wordId: string): string[];
  endlessNext(input: EndlessInput): EndlessPick;
  endlessMark(input: EndlessMarkInput): void;
  endlessUndo(requestId: string): void;
  statistics(): VocabularyStatistics;
  // A past study day's started words, with the score and state each had at the end of that day.
  statisticsDay(day: string): ScoreDayWords;
  // Words missed TROUBLE_MISSES times in either direction that have no memory hook yet, with the deck words missed
  // most alongside them; and saving hooks for them.
  hookless(): { id: string; fr: string; en: string; note?: string; alongside: Pick<Word, 'fr' | 'en'>[] }[];
  setHooks(hooks: { wordId: string; hook: string }[]): void;
  exportData(): unknown;
  close(): void;
}

type CardRow = {
  direction: Direction;
  word_id: string;
  introduced_day: string;
  active: number;
  successes: number;
  cycle_misses: number;
  completed_day: string | null;
  due_at: number;
  fsrs_json: string;
  version: number;
};

type GradeRow = {
  sequence: number;
  request_id: string;
  direction: Direction;
  deck: string;
  word_id: string;
  version: number;
  known: number;
  graded_at: string;
  before_json: string;
  after_json: string;
  fsrs_log: string | null;
  queue_before_json: string | null;
};

type UndoRow = {
  sequence: number;
  grade_sequence: number;
  undone_at: string;
  before_version: number;
  after_version: number;
};

// Raised whenever the word recordings change, so a phone holding a cached clip fetches the new one; the app's
// wordClipUrl carries the same number.
export const WORD_CLIP_VERSION = 2;

// Walkman scores: what each event adds to a word's score, and how fast a point fades.
export const SCORE_RECALLED = 2;
export const SCORE_MISSED = -3;
export const SCORE_HEARD = 0.5;
// An Endless mark: smaller than a daily answer, since the same word comes round again within minutes.
export const SCORE_ENDLESS = 1;
// Endless picks a word with odds 2^(-score/ENDLESS_PULL), the score held within ±ENDLESS_LIMIT, as the Walkman does.
const ENDLESS_PULL = 1.7;
const ENDLESS_LIMIT = 8;
export const SCORE_HALF_LIFE_DAYS = 21;
// recent holds the last words answered, newest first; selection passes over them while anything else is left.
// credit carries the unseen share from turn to turn (see unseenShare); turn cycles seenMix.
type PracticeQueue = { day: string; warmup: number; turn: number; credit?: number; unseen: string[]; failed: string[]; successful: string[]; recent?: string[] };
const RECENT_GAP = 3;
// A word answered right waits until every other seen word has had a turn (30 answers at 30 seen), between
// SUCCESS_GAP_MIN and SUCCESS_GAP_MAX, so seeing it again tests memory rather than the last minute. Waiting
// longer than the pile cannot be kept: nothing else would be left to show but new words.
const SUCCESS_GAP_MIN = 5;
const SUCCESS_GAP_MAX = 40;
export function successGap(seen: number): number {
  return Math.max(SUCCESS_GAP_MIN, Math.min(SUCCESS_GAP_MAX, seen));
}
// A word missed this many times shows, on its answer side, up to ALONGSIDE words of its deck missed most with it.
const TROUBLE_MISSES = 6;
const ALONGSIDE = 3;
type HistoricalGrade = { before: CardRow; known: number; graded_at: string };
const stackNames: VocabularyStack[] = ['unseen', 'failed', 'successful'];
// Among words already seen today, missed ones come twice as often as ones answered right.
const seenMix: VocabularyStack[] = ['failed', 'successful', 'failed'];
// After the warm-up, the share of turns given to words not seen yet today. Turns for seen words per turn for a
// new one double every SEEN_SPREAD words of pile: one each at SEEN_EVEN, two at 33, four at 41; the share stays
// between UNSEEN_LEAST, so new words never stop, and UNSEEN_MOST, so a miss in a small pile still comes back soon.
// A new word needs about 1.3 more turns before it leaves the pile on a day of few misses and about 2.5 on a day
// of many, so the pile settles where the two match, near SEEN_EVEN + SEEN_SPREAD·log2 of that: about 27 to 35.
const SEEN_EVEN = 25;
const SEEN_SPREAD = 8;
const UNSEEN_LEAST = 0.1;
const UNSEEN_MOST = 0.75;
export function unseenShare(seen: number): number {
  return Math.max(UNSEEN_LEAST, Math.min(UNSEEN_MOST, 1 / (1 + 2 ** ((seen - SEEN_EVEN) / SEEN_SPREAD))));
}

function emptyQueue(day: string): PracticeQueue {
  return { day, warmup: 0, turn: 0, credit: 0, unseen: [], failed: [], successful: [] };
}

function studyDayStart(now: Date): Date {
  const start = new Date(now);
  if (start.getHours() < 4) start.setDate(start.getDate() - 1);
  start.setHours(4, 0, 0, 0);
  return start;
}

export function studyDay(now: Date): string {
  const day = studyDayStart(now);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

// The last `count` study days, oldest first, and the moment the first one began. Days step back from today's 04:00
// by calendar date, so a clock change never skips or repeats a day.
export function recentStudyDays(now: Date, count: number): { days: string[]; since: Date } {
  const start = studyDayStart(now);
  const days = Array.from({ length: count }, (_, index) => { const day = new Date(start); day.setDate(day.getDate() - count + 1 + index); return studyDay(day); });
  const since = new Date(start);
  since.setDate(since.getDate() - count + 1);
  return { days, since };
}

function nextStudyDay(now: Date): Date {
  const next = new Date(now);
  next.setHours(4, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

// A noun's gender from how it is written: le / un masculine, la / une feminine, and for l’ and les the note, which
// opens with "Masculine…" or "Feminine…". A noun that can be either ("Masculine or feminine…") has none.
export function genderOf(word: { fr: string; note?: string }): 'masculine' | 'feminine' | undefined {
  const fr = word.fr.toLowerCase();
  if (/^(le|un)\s/.test(fr)) return 'masculine';
  if (/^(la|une)\s/.test(fr)) return 'feminine';
  if (!/^(l['’]|les\s|des\s)/.test(fr)) return undefined;
  const note = (word.note ?? '').toLowerCase();
  if (/^(masculine|feminine) or /.test(note) || /^can be masculine or feminine/.test(note)) return undefined;
  return /^masculine/.test(note) ? 'masculine' : /^feminine/.test(note) ? 'feminine' : undefined;
}

function withGender(word: Word): Word {
  const { gender: _old, ...rest } = word;
  const gender = genderOf(rest);
  return gender ? { ...rest, gender } : rest;
}

// ready tells whether an added word can be practised yet (its recording exists); the built-in words always can.
export function createStore(baseWords: Word[], options: { dbPath?: string; now?: () => Date; random?: () => number; ready?: (wordId: string) => boolean; families?: string[][] } = {}): Store {
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const ready = options.ready ?? (() => true);
  // words grows when songs are added; wordById, categories and decks follow it (rebuildDecks).
  const words: Word[] = baseWords.map(withGender);
  const wordById = new Map(words.map((word) => [word.id, word]));
  if (wordById.size !== words.length) throw new StoreError('Vocabulary contains duplicate word IDs.');
  // word id -> every member of its word family (itself included); a word in no family is absent.
  const familyOf = new Map((options.families ?? []).flatMap((members) => members.map((id) => [id, members] as const)));
  for (const word of words) {
    if (!word.id || !word.category || word.category === 'all') throw new StoreError('Vocabulary contains an invalid word or category.');
  }
  const categories = new Map<string, number>();
  const categoryTitles = new Map<string, string>();
  const added = new Set<string>();
  // song category -> the words already in Echo it also holds, in the order they joined it.
  const links = new Map<string, string[]>();
  // Song categories in the order they were made, which is the order songs-first admission takes them in.
  const songCategories: string[] = [];
  const decks: Deck[] = [];
  let order: Word[] | null = null;
  // The song that brings each song word in: see songHome().
  let songOf: Map<string, string> | null = null;
  function rebuildDecks(): void {
    categories.clear();
    for (const word of words) categories.set(word.category, (categories.get(word.category) ?? 0) + 1);
    for (const [category, ids] of links) categories.set(category, (categories.get(category) ?? 0) + ids.length);
    decks.length = 0;
    decks.push({ id: 'all', title: 'All words', count: words.length },
      ...Array.from(categories, ([id, count]) => ({ id, title: categoryTitles.get(id) ?? id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()), count })));
    order = null; songOf = null;
  }
  const dbPath = options.dbPath ?? './data/echo.db';
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const scheduler = fsrs({ enable_short_term: false, enable_fuzz: false });
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        new_per_day INTEGER NOT NULL CHECK (new_per_day >= 0)
      );
      -- Words added from songs; sequence keeps the order they were added in.
      CREATE TABLE IF NOT EXISTS added_words (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        fr TEXT NOT NULL,
        en TEXT NOT NULL,
        note TEXT,
        category TEXT NOT NULL,
        category_title TEXT NOT NULL,
        added_at TEXT NOT NULL
      );
      -- Words already in Echo that a song's deck also holds; sequence keeps the order they joined it in.
      CREATE TABLE IF NOT EXISTS deck_links (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        category_title TEXT NOT NULL,
        word_id TEXT NOT NULL,
        UNIQUE (category, word_id)
      );
      CREATE TABLE IF NOT EXISTS cards (
        direction TEXT NOT NULL CHECK (direction IN ('fr-en', 'en-fr')),
        word_id TEXT NOT NULL,
        introduced_day TEXT NOT NULL,
        active INTEGER NOT NULL CHECK (active IN (0, 1)),
        successes INTEGER NOT NULL CHECK (successes IN (0, 1)),
        cycle_misses INTEGER NOT NULL CHECK (cycle_misses >= 0),
        completed_day TEXT,
        due_at INTEGER NOT NULL,
        fsrs_json TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        PRIMARY KEY (direction, word_id)
      );
      CREATE TABLE IF NOT EXISTS grades (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        direction TEXT NOT NULL,
        deck TEXT NOT NULL,
        word_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        known INTEGER NOT NULL CHECK (known IN (0, 1)),
        graded_at TEXT NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        fsrs_log TEXT,
        queue_before_json TEXT,
        FOREIGN KEY (direction, word_id) REFERENCES cards(direction, word_id)
      );
      CREATE TABLE IF NOT EXISTS undos (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        grade_sequence INTEGER NOT NULL UNIQUE REFERENCES grades(sequence),
        undone_at TEXT NOT NULL,
        before_version INTEGER NOT NULL,
        after_version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS practice_queues (
        direction TEXT PRIMARY KEY CHECK (direction IN ('fr-en', 'en-fr')),
        state_json TEXT NOT NULL
      );
      -- Extra new words granted for one study day only; the daily setting is untouched.
      CREATE TABLE IF NOT EXISTS extra_allowance (
        direction TEXT NOT NULL CHECK (direction IN ('fr-en', 'en-fr')),
        day TEXT NOT NULL,
        extra INTEGER NOT NULL CHECK (extra > 0),
        PRIMARY KEY (direction, day)
      );
      -- Makes a retried extra-words, early-review or added-word request apply once; result replays its answer.
      CREATE TABLE IF NOT EXISTS vocabulary_requests (
        request_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        direction TEXT NOT NULL,
        created_at TEXT NOT NULL,
        result TEXT
      );
      -- One row per word heard to the end on the Walkman; request_id makes a retried report count once.
      CREATE TABLE IF NOT EXISTS walkman_heard (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        word_id TEXT NOT NULL,
        heard_at TEXT NOT NULL
      );
      -- The learner's mark on one listen in "Words you heard": id is chosen by the phone, so changing
      -- the mark replaces it and the latest mark on a listen is the only one that counts.
      CREATE TABLE IF NOT EXISTS walkman_verdicts (
        id TEXT PRIMARY KEY,
        word_id TEXT NOT NULL,
        knew INTEGER NOT NULL,
        marked_at TEXT NOT NULL
      );
      -- Say it: what recognition wrote down for a word when the learner said its English and was heard wrong
      -- (lib/say-check.ts said()); it counts as that word's English from then on.
      CREATE TABLE IF NOT EXISTS say_accepted (
        word_id TEXT NOT NULL,
        heard TEXT NOT NULL,
        added_at TEXT NOT NULL,
        PRIMARY KEY (word_id, heard)
      );
      -- One mark in Endless: request_id is chosen by the phone, so a retried mark counts once; an undo deletes it.
      CREATE TABLE IF NOT EXISTS endless_marks (
        request_id TEXT PRIMARY KEY,
        direction TEXT NOT NULL,
        word_id TEXT NOT NULL,
        known INTEGER NOT NULL,
        marked_at TEXT NOT NULL
      );
      -- A memory hook Claude wrote for a word missed TROUBLE_MISSES times (lib/word-hooks.ts).
      CREATE TABLE IF NOT EXISTS word_hooks (
        word_id TEXT PRIMARY KEY,
        hook TEXT NOT NULL,
        written_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS grades_direction_sequence ON grades(direction, sequence DESC);
      CREATE INDEX IF NOT EXISTS grades_direction_time ON grades(direction, graded_at);
    `);
    db.query('INSERT OR IGNORE INTO settings (singleton, new_per_day) VALUES (1, ?)').run(Math.min(30, words.length));
    const hasColumn = (table: string, name: string) => db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().some((column) => column.name === name);
    if (!hasColumn('grades', 'queue_before_json')) db.exec('ALTER TABLE grades ADD COLUMN queue_before_json TEXT');
    if (!hasColumn('settings', 'songs_first')) db.exec('ALTER TABLE settings ADD COLUMN songs_first INTEGER NOT NULL DEFAULT 1');
    if (!hasColumn('vocabulary_requests', 'result')) db.exec('ALTER TABLE vocabulary_requests ADD COLUMN result TEXT');
    const at = now();
    const day = studyDay(at);
    const putQueue = db.query('INSERT OR REPLACE INTO practice_queues (direction, state_json) VALUES (?, ?)');
    if (hasColumn('cards', 'queue_order')) {
      const queues: Record<Direction, PracticeQueue> = { 'fr-en': emptyQueue(day), 'en-fr': emptyQueue(day) };
      const history = new Map<string, HistoricalGrade[]>();
      const start = studyDayStart(at).toISOString();
      const end = at.toISOString();
      for (const grade of db.query<GradeRow, []>('SELECT * FROM grades WHERE NOT EXISTS (SELECT 1 FROM undos WHERE grade_sequence = grades.sequence) ORDER BY sequence').all()) {
        const before = JSON.parse(grade.before_json) as CardRow;
        const key = `${grade.direction}:${grade.word_id}`;
        const entries = history.get(key) ?? [];
        entries.push({ before, known: grade.known, graded_at: grade.graded_at });
        history.set(key, entries);
        if (grade.graded_at >= start && grade.graded_at <= end && firstRecall(before)) {
          queues[grade.direction].warmup = Math.min(10, queues[grade.direction].warmup + 1);
        }
      }
      const update = db.query('UPDATE cards SET active = ?, successes = ?, cycle_misses = ?, completed_day = ?, due_at = ?, fsrs_json = ?, version = ? WHERE direction = ? AND word_id = ?');
      for (const original of db.query<CardRow, []>('SELECT * FROM cards ORDER BY queue_order').all()) {
        const { row, stack } = legacyState(original, history.get(`${original.direction}:${original.word_id}`) ?? []);
        if (original.active) update.run(row.active, row.successes, row.cycle_misses, row.completed_day, row.due_at, row.fsrs_json, row.version + 1, row.direction, row.word_id);
        if (wordById.has(row.word_id) && (row.active || row.due_at <= at.getTime())) insertRandom(queues[row.direction][row.active ? stack : 'unseen'], row.word_id);
      }
      for (const direction of ['fr-en', 'en-fr'] as const) putQueue.run(direction, JSON.stringify(queues[direction]));
      db.exec('ALTER TABLE cards DROP COLUMN queue_order; DROP TABLE IF EXISTS queue_counter;');
    }
    for (const direction of ['fr-en', 'en-fr'] as const) {
      db.query('INSERT OR IGNORE INTO practice_queues (direction, state_json) VALUES (?, ?)').run(direction, JSON.stringify(emptyQueue(day)));
    }
  }).immediate();

  const rowsForDirection = db.query<CardRow, [Direction]>('SELECT * FROM cards WHERE direction = ? ORDER BY word_id');
  const rowForWord = db.query<CardRow, [Direction, string]>('SELECT * FROM cards WHERE direction = ? AND word_id = ?');
  const readSettings = db.query<{ newPerDay: number; songsFirst: number }, []>('SELECT new_per_day AS newPerDay, songs_first AS songsFirst FROM settings WHERE singleton = 1');
  const insertAdded = db.query('INSERT INTO added_words (id, fr, en, note, category, category_title, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  // A word added twice (two songs read before either was added) keeps one copy: a practised one, else the
  // built-in word or the first added; unpractised extra copies are removed.
  const comparable = (fr: string) => fr.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  const practised = db.query<{ count: number }, [string]>('SELECT count(*) AS count FROM cards WHERE word_id = ?');
  const addedRows = db.query<{ id: string; fr: string; en: string; note: string | null; category: string; category_title: string }, []>('SELECT * FROM added_words ORDER BY sequence').all();
  const holder = new Map(words.map((word) => [comparable(word.fr), word.id]));
  const keep = new Set<string>();
  for (const row of addedRows) {
    const key = comparable(row.fr);
    const other = holder.get(key);
    if (!other) { holder.set(key, row.id); keep.add(row.id); continue; }
    if (!practised.get(row.id)!.count) continue;
    keep.add(row.id);
    if (keep.has(other) && !practised.get(other)!.count) { keep.delete(other); holder.set(key, row.id); }
  }
  const extra = addedRows.filter((row) => !keep.has(row.id));
  if (extra.length) db.transaction(() => { for (const row of extra) db.query('DELETE FROM added_words WHERE id = ?').run(row.id); }).immediate();
  for (const row of addedRows) {
    if (!keep.has(row.id) || wordById.has(row.id)) continue;
    const word: Word = withGender({ id: row.id, fr: row.fr, en: row.en, category: row.category, ...(row.note ? { note: row.note } : {}) });
    words.push(word); wordById.set(word.id, word); added.add(word.id); categoryTitles.set(row.category, row.category_title);
    if (!songCategories.includes(row.category)) songCategories.push(row.category);
  }
  const linkRow = db.query('INSERT OR IGNORE INTO deck_links (category, category_title, word_id) VALUES (?, ?, ?)');
  for (const row of db.query<{ category: string; category_title: string; word_id: string }, []>('SELECT category, category_title, word_id FROM deck_links ORDER BY sequence').all()) {
    // A link to a word that has since gone (a removed duplicate) is simply not shown.
    const word = wordById.get(row.word_id);
    if (!word || word.category === row.category) continue;
    links.set(row.category, [...(links.get(row.category) ?? []), row.word_id]);
    if (!categoryTitles.has(row.category)) categoryTitles.set(row.category, row.category_title);
    if (!songCategories.includes(row.category)) songCategories.push(row.category);
  }
  rebuildDecks();

  // The song that brings each song word in: the first song whose deck holds it, for a word it added or one already
  // in Echo that it linked. Cleared with the admission order.
  function songHome(): Map<string, string> {
    if (songOf) return songOf;
    songOf = new Map();
    for (const category of songCategories) {
      for (const word of words) if (word.category === category && !songOf.has(word.id)) songOf.set(word.id, category);
      for (const id of links.get(category) ?? []) if (!songOf.has(id)) songOf.set(id, category);
    }
    return songOf;
  }
  // The order new words are introduced in. The built-in words keep their given order; with songsFirst every
  // song's words go first, song by song, including the ones already in Echo that the song's deck holds; otherwise
  // every category takes one turn in each round, and a song's turn brings in its words of either kind.
  function admissionOrder(): Word[] {
    if (order) return order;
    const home = songHome();
    const group = (word: Word) => home.get(word.id) ?? word.category;
    if (settings().songsFirst) {
      const songs = songCategories.flatMap((category) => [
        ...words.filter((word) => word.category === category),
        ...(links.get(category) ?? []).map((id) => wordById.get(id)!),
      ].filter((word) => home.get(word.id) === category));
      order = [...songs, ...words.filter((word) => !home.has(word.id))];
    } else {
      const groups = [...Map.groupBy(words, group).values()];
      order = [];
      for (let round = 0; order.length < words.length; round++) for (const members of groups) if (members[round]) order.push(members[round]);
    }
    return order;
  }
  const queueForDirection = db.query<{ state_json: string }, [Direction]>('SELECT state_json FROM practice_queues WHERE direction = ?');
  const saveQueue = db.query('UPDATE practice_queues SET state_json = ? WHERE direction = ?');
  const gradeByRequest = db.query<GradeRow, [string]>('SELECT * FROM grades WHERE request_id = ?');
  const latestGrade = db.query<GradeRow, [Direction]>(`
    SELECT grades.* FROM grades
    WHERE direction = ? AND NOT EXISTS (SELECT 1 FROM undos WHERE grade_sequence = grades.sequence)
    ORDER BY sequence DESC LIMIT 1
  `);
  const saveCard = db.query(`
    INSERT INTO cards (direction, word_id, introduced_day, active, successes, cycle_misses,
      completed_day, due_at, fsrs_json, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (direction, word_id) DO UPDATE SET
      introduced_day = excluded.introduced_day, active = excluded.active,
      successes = excluded.successes, cycle_misses = excluded.cycle_misses,
      completed_day = excluded.completed_day, due_at = excluded.due_at,
      fsrs_json = excluded.fsrs_json, version = excluded.version
  `);
  const appendGrade = db.query(`
    INSERT INTO grades (request_id, direction, deck, word_id, version, known,
      graded_at, before_json, after_json, fsrs_log, queue_before_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const readExtra = db.query<{ extra: number }, [Direction, string]>('SELECT extra FROM extra_allowance WHERE direction = ? AND day = ?');
  const addExtra = db.query('INSERT INTO extra_allowance (direction, day, extra) VALUES (?, ?, ?) ON CONFLICT (direction, day) DO UPDATE SET extra = extra + excluded.extra');
  const requestById = db.query<{ kind: string; direction: string; result: string | null }, [string]>('SELECT kind, direction, result FROM vocabulary_requests WHERE request_id = ?');
  const recordRequest = db.query('INSERT INTO vocabulary_requests (request_id, kind, direction, created_at, result) VALUES (?, ?, ?, ?, ?)');
  const historyForDirection = db.query<{ word_id: string; misses: number; last: string }, [Direction]>(`
    SELECT word_id, SUM(known = 0) AS misses, MAX(graded_at) AS last FROM grades
    WHERE direction = ? AND NOT EXISTS (SELECT 1 FROM undos WHERE grade_sequence = grades.sequence)
    GROUP BY word_id
  `);

  function extraToday(direction: Direction, day: string): number {
    return readExtra.get(direction, day)?.extra ?? 0;
  }

  // False means this request already ran and must not apply again.
  function claimRequest(requestId: string, kind: string, direction: Direction, at: Date): boolean {
    const previous = requestById.get(requestId);
    if (previous) {
      if (previous.kind !== kind || previous.direction !== direction) throw new StoreError('This request ID was already used for something else. Reload and try again.', 409);
      return false;
    }
    recordRequest.run(requestId, kind, direction, at.toISOString(), null);
    return true;
  }

  function validateBatch(count: unknown, requestId: unknown, noun: string): void {
    if (!Number.isSafeInteger(count) || (count as number) < 1) throw new StoreError(`Choose a whole number of ${noun}, 1 or more.`);
    if (typeof requestId !== 'string' || !requestId.trim()) throw new StoreError('This request is missing its ID. Reload and try again.');
  }

  function insertRandom(stack: string[], id: string): void {
    stack.splice(Math.floor(random() * (stack.length + 1)), 0, id);
  }

  function firstRecall(row: CardRow): boolean {
    return row.active === 0 || (row.successes === 0 && row.cycle_misses === 0);
  }

  function finishCycle(row: CardRow, at: Date): string {
    const result = scheduler.next(JSON.parse(row.fsrs_json) as CardInput, at, row.cycle_misses > 0 ? Rating.Again : Rating.Good);
    const card: Card = { ...result.card, due: new Date(Math.max(result.card.due.getTime(), nextStudyDay(at).getTime())) };
    row.fsrs_json = JSON.stringify(card);
    row.due_at = card.due.getTime();
    row.active = 0;
    row.successes = 0;
    row.cycle_misses = 0;
    row.completed_day = studyDay(at);
    return JSON.stringify(result.log);
  }

  function legacyState(original: CardRow, history: HistoricalGrade[]): { row: CardRow; stack: VocabularyStack } {
    const row = { ...original };
    if (!row.active) return { row, stack: 'unseen' };
    const cycle = history.filter((grade) => grade.before.fsrs_json === row.fsrs_json);
    let stack: VocabularyStack = row.successes ? 'successful' : row.cycle_misses ? 'failed' : 'unseen';
    if (cycle.length) {
      row.successes = 0;
      row.cycle_misses = 0;
      for (const grade of cycle) {
        row.successes = grade.known ? row.successes + 1 : 0;
        row.cycle_misses += Number(!grade.known);
        stack = grade.known ? 'successful' : 'failed';
        if (row.successes === 2) {
          finishCycle(row, new Date(grade.graded_at));
          break;
        }
      }
    }
    return { row, stack };
  }

  function loadQueue(direction: Direction, at: Date): PracticeQueue {
    const queue = JSON.parse(queueForDirection.get(direction)!.state_json) as PracticeQueue;
    const day = studyDay(at);
    if (queue.day !== day) Object.assign(queue, { day, warmup: 0, turn: 0, credit: 0 });
    return queue;
  }

  function reconcileQueue(queue: PracticeQueue, rows: CardRow[], at: Date, randomize: boolean): void {
    const eligible = new Set(rows.filter((row) => wordById.has(row.word_id) && (row.active || row.due_at <= at.getTime())).map((row) => row.word_id));
    const queued = new Set<string>();
    for (const name of stackNames) queue[name] = queue[name].filter((id) => {
      if (!eligible.has(id) || queued.has(id)) return false;
      queued.add(id);
      return true;
    });
    for (const id of eligible) {
      if (queued.has(id)) continue;
      if (randomize) insertRandom(queue.unseen, id);
      else queue.unseen.push(id);
    }
  }

  type Selection = { id: string; stack: VocabularyStack; nextTurn: number; nextCredit: number };
  function selectCard(queue: PracticeQueue, deck: string): Selection | null {
    const recent = queue.recent ?? [];
    // The word just answered is left out of the count, so the card after it is the same whether it was known,
    // missed or finished, and can be shown before the answer is saved.
    const piled = (id: string) => inDeck(id, deck) && id !== recent[0];
    const seen = queue.failed.filter(piled).length + queue.successful.filter(piled).length;
    // Credit is capped at one turn, so a stretch with nothing unseen to offer does not save up a burst of them.
    const credit = Math.min(1, (queue.credit ?? 0) + unseenShare(seen));
    const gap = successGap(seen);
    // A word just answered waits for others: RECENT_GAP answers after a miss, gap answers after a success. When
    // every seen word is still waiting, the success that has waited longest comes back rather than an extra new
    // word, so new words keep to their share of turns. The waits shorten further only when nothing else is left.
    const waited = (id: string) => { const index = recent.indexOf(id); return index < 0 ? Infinity : index; };
    for (const [pass, avoid] of [recent.slice(0, RECENT_GAP), recent.slice(0, 1), []].entries()) {
      const spaced = pass === 0 ? recent.slice(0, gap) : avoid;
      const pick = (list: string[], wait = avoid) => list.find((id) => inDeck(id, deck) && !wait.includes(id));
      const unseen = pick(queue.unseen);
      const fresh = (id: string): Selection => ({ id, stack: 'unseen', nextTurn: queue.turn, nextCredit: Math.max(0, credit - 1) });
      if (queue.warmup < 10 && unseen) return { ...fresh(unseen), nextCredit: 0 };
      if (credit >= 1 && unseen) return fresh(unseen);
      for (let offset = 0; offset < seenMix.length; offset++) {
        const position = (queue.turn + offset) % seenMix.length;
        const stack = seenMix[position]!;
        const id = pick(queue[stack], stack === 'successful' ? spaced : avoid);
        if (id) return { id, stack, nextTurn: (position + 1) % seenMix.length, nextCredit: credit };
      }
      const longest = queue.successful.filter((id) => inDeck(id, deck) && !avoid.includes(id))
        .reduce<string | null>((best, id) => best === null || waited(id) > waited(best) ? id : best, null);
      if (longest) return { id: longest, stack: 'successful', nextTurn: queue.turn, nextCredit: credit };
      if (unseen) return fresh(unseen);
    }
    return null;
  }

  // What answering the selected card does to the queue before the card is filed again: it leaves its stack,
  // counts toward the ten-card warm-up, advances the stack mix and becomes the most recent word.
  function passOver(queue: PracticeQueue, selection: Selection, wordId: string): void {
    queue[selection.stack].splice(queue[selection.stack].indexOf(wordId), 1);
    if (selection.stack === 'unseen') queue.warmup = Math.min(10, queue.warmup + 1);
    queue.turn = selection.nextTurn;
    queue.credit = selection.nextCredit;
    queue.recent = [wordId, ...(queue.recent ?? []).filter((id) => id !== wordId)].slice(0, SUCCESS_GAP_MAX);
  }

  // The words of the same deck missed most besides this one (at least twice each), when this one has been missed
  // TROUBLE_MISSES times: the answer side shows them together so the difference can be seen.
  function trouble(wordId: string, misses: Map<string, number>): CardTrouble | undefined {
    const count = misses.get(wordId) ?? 0;
    if (count < TROUBLE_MISSES) return undefined;
    const category = wordById.get(wordId)!.category;
    const alongside = [...misses].filter(([id, missed]) => id !== wordId && missed >= 2 && wordById.get(id)?.category === category)
      .sort((left, right) => right[1] - left[1]).slice(0, ALONGSIDE).map(([id]) => { const { fr, en, gender } = wordById.get(id)!; return { fr, en, ...(gender ? { gender } : {}) }; });
    const hook = hookFor.get(wordId)?.hook;
    return { misses: count, alongside, ...(hook ? { hook } : {}) };
  }

  const hookFor = db.query<{ hook: string }, [string]>('SELECT hook FROM word_hooks WHERE word_id = ?');
  const allHooks = db.query<{ word_id: string }, []>('SELECT word_id FROM word_hooks');
  const saveHook = db.query('INSERT INTO word_hooks (word_id, hook, written_at) VALUES (?, ?, ?) ON CONFLICT (word_id) DO UPDATE SET hook = excluded.hook, written_at = excluded.written_at');

  function hookless() {
    const hooked = new Set(allHooks.all().map((row) => row.word_id));
    const misses = new Map<string, number>();
    for (const direction of ['fr-en', 'en-fr'] as const) for (const entry of historyForDirection.all(direction)) misses.set(entry.word_id, Math.max(misses.get(entry.word_id) ?? 0, entry.misses));
    return [...misses].filter(([id, count]) => count >= TROUBLE_MISSES && !hooked.has(id) && wordById.has(id)).map(([id]) => {
      const { fr, en, note } = wordById.get(id)!;
      return { id, fr, en, ...(note ? { note } : {}), alongside: trouble(id, misses)!.alongside.map(({ fr: other, en: meaning }) => ({ fr: other, en: meaning })) };
    });
  }

  function setHooks(hooks: { wordId: string; hook: string }[]): void {
    const at = now().toISOString();
    db.transaction(() => { for (const { wordId, hook } of hooks) if (wordById.has(wordId) && hook.trim()) saveHook.run(wordId, hook.trim(), at); })();
  }

  function cardView(row: CardRow, stack: VocabularyStack, misses: Map<string, number>): CardView {
    const problem = trouble(row.word_id, misses);
    return {
      ...wordById.get(row.word_id)!,
      successes: row.active ? row.successes : 0,
      stack,
      version: row.version,
      stage: row.active === 0 ? 'review' : row.completed_day === null && row.successes === 0 && row.cycle_misses === 0 ? 'new' : 'learning',
      audioUrl: `audio/${encodeURIComponent(row.word_id)}.mp3?v=${WORD_CLIP_VERSION}`,
      ...(problem ? { trouble: problem } : {}),
    };
  }

  function validateSelection(direction: Direction, deck: string): void {
    if (direction !== 'fr-en' && direction !== 'en-fr') throw new StoreError('Choose French → English or English → French.');
    if (deck !== 'all' && !categories.has(deck)) throw new StoreError('That vocabulary category does not exist.');
  }

  function inDeck(wordId: string, deck: string): boolean {
    const word = wordById.get(wordId);
    return !!word && (deck === 'all' || word.category === deck || !!links.get(deck)?.includes(wordId));
  }

  function settings(): Settings {
    const row = readSettings.get()!;
    return { newPerDay: row.newPerDay, songsFirst: row.songsFirst === 1 };
  }

  function save(row: CardRow): void {
    saveCard.run(row.direction, row.word_id, row.introduced_day, row.active, row.successes,
      row.cycle_misses, row.completed_day, row.due_at, row.fsrs_json, row.version);
  }

  function snapshot(direction: Direction, deck: string, at: Date): Snapshot {
    const day = studyDay(at);
    const time = at.getTime();
    const preferences = settings();
    const rows = rowsForDirection.all(direction);
    const selected = rows.filter((row) => inDeck(row.word_id, deck));
    const total = deck === 'all' ? words.length : categories.get(deck)!;
    const introducedToday = rows.filter((row) => row.introduced_day === day).length;
    const extra = extraToday(direction, day);
    const misses = new Map(historyForDirection.all(direction).map((entry) => [entry.word_id, entry.misses]));
    const queue = loadQueue(direction, at);
    reconcileQueue(queue, rows, at, false);
    const seen = new Set([...queue.failed, ...queue.successful]);
    const started = new Set(rows.map((row) => row.word_id));
    function summarize(records: CardRow[], count: number, scope: string): Stats {
      const unseen = count - records.length;
      // Song words without a recording cannot be introduced yet, so they are not offered as new.
      const recording = [...added].filter((id) => !started.has(id) && inDeck(id, scope) && !ready(id)).length;
      const stats: Stats = {
        total: count, unseen, seenActive: 0, unseenActive: 0, introducedToday,
        newAvailable: Math.min(unseen - recording, Math.max(0, preferences.newPerDay + extra - introducedToday)),
        learning: 0, due: 0, completedToday: 0, remaining: 0, scheduled: 0, scheduledMissed: 0, recording,
      };
      for (const candidate of records) {
        if (candidate.active === 1 || candidate.due_at <= time) {
          if (seen.has(candidate.word_id)) stats.seenActive++;
          else stats.unseenActive++;
        }
        if (candidate.active === 1) stats.learning++;
        else if (candidate.due_at <= time) stats.due++;
        else {
          stats.scheduled++;
          if ((misses.get(candidate.word_id) ?? 0) > 0) stats.scheduledMissed++;
        }
        if (candidate.completed_day === day) stats.completedToday++;
      }
      stats.remaining = stats.learning + stats.due;
      stats.unseenActive += stats.newAvailable;
      return stats;
    }
    const stats = summarize(selected, total, deck);
    const overview = deck === 'all' ? stats : summarize(rows.filter((candidate) => inDeck(candidate.word_id, 'all')), words.length, 'all');
    const selection = selectCard(queue, deck);
    const row = selection ? selected.find((candidate) => candidate.word_id === selection.id) : null;
    const current = row ? cardView(row, selection!.stack, misses) : null;
    // The card after this one. The answered word is always passed over, so knowing it or not does not change
    // what follows; the phone shows it at once and fetches its recording ahead.
    let next: CardView | null = null;
    if (row) {
      const after = structuredClone(queue);
      passOver(after, selection!, row.word_id);
      const following = selectCard(after, deck);
      const nextRow = following && following.id !== row.word_id ? selected.find((candidate) => candidate.word_id === following.id) : null;
      if (nextRow) next = cardView(nextRow, following!.stack, misses);
    }
    let nextDue: number | null = null;
    for (const candidate of selected) {
      if (candidate.active === 0 && candidate.due_at > time && (nextDue === null || candidate.due_at < nextDue)) nextDue = candidate.due_at;
    }
    const latest = latestGrade.get(direction);
    return {
      day, direction, deck, settings: preferences, extraToday: extra, decks,
      stats, overview,
      current, next,
      nextDue: nextDue === null ? null : new Date(nextDue).toISOString(),
      undoId: latest && inDeck(latest.word_id, deck) ? latest.request_id : null,
    };
  }

  function state(direction: Direction, deck: string): Snapshot {
    validateSelection(direction, deck);
    return db.transaction(() => snapshot(direction, deck, now()))();
  }

  // Admits new words up to today's allowance: the daily setting plus any extra granted today.
  function admit(direction: Direction, deck: string, at: Date): void {
    const day = studyDay(at);
    const rows = rowsForDirection.all(direction);
    const seen = new Set(rows.map((row) => row.word_id));
    const allowance = Math.max(0, settings().newPerDay + extraToday(direction, day) - rows.filter((row) => row.introduced_day === day).length);
    const eligible = admissionOrder().filter((word) => inDeck(word.id, deck) && !seen.has(word.id) && !(added.has(word.id) && !ready(word.id)));
    for (const word of pickNew(eligible, seen, allowance)) {
      save({
        direction, word_id: word.id, introduced_day: day,
        active: 1, successes: 0, cycle_misses: 0, completed_day: null,
        due_at: at.getTime(), fsrs_json: JSON.stringify(createEmptyCard(at)),
        version: 1,
      });
    }
    const queue = loadQueue(direction, at);
    reconcileQueue(queue, rowsForDirection.all(direction), at, true);
    saveQueue.run(JSON.stringify(queue), direction);
  }
  // Today's new words. Up to half come from word families with a member already started, the most started
  // family first, since a word whose relative you know is half known; the rest keep the usual order, so every
  // category still moves on. With songsFirst, song words come before either.
  function pickNew(eligible: Word[], seen: Set<string>, count: number): Word[] {
    const home = songHome();
    const songs = settings().songsFirst ? eligible.filter((word) => home.has(word.id)).slice(0, count) : [];
    const rest = eligible.filter((word) => !songs.includes(word));
    const started = (word: Word) => { const members = familyOf.get(word.id); return members ? members.filter((id) => seen.has(id)).length / members.length : 0; };
    const kin = rest.filter((word) => started(word) > 0).sort((a, b) => started(b) - started(a)).slice(0, Math.ceil((count - songs.length) / 2));
    const others = rest.filter((word) => !kin.includes(word)).slice(0, count - songs.length - kin.length);
    return [...songs, ...kin, ...others];
  }

  function start(direction: Direction, deck: string): Snapshot {
    validateSelection(direction, deck);
    return db.transaction(() => {
      const at = now();
      admit(direction, deck, at);
      return snapshot(direction, deck, at);
    }).immediate();
  }

  function addExtraWords(input: ExtraWordsInput): Snapshot {
    validateSelection(input.direction, input.deck);
    validateBatch(input.count, input.requestId, 'extra words');
    return db.transaction(() => {
      const at = now();
      if (claimRequest(input.requestId, 'extra-words', input.direction, at)) {
        const started = new Set(rowsForDirection.all(input.direction).map((row) => row.word_id));
        if (!words.some((word) => inDeck(word.id, input.deck) && !started.has(word.id))) {
          throw new StoreError(input.deck === 'all' ? 'You have already started every word in Echo.' : 'You have already started every word in this category. Choose All words to learn more.');
        }
        addExtra.run(input.direction, studyDay(at), input.count);
        admit(input.direction, input.deck, at);
      }
      return snapshot(input.direction, input.deck, at);
    }).immediate();
  }

  // Makes finished words due now. Their FSRS memory is untouched, so finishing one scores an early review.
  function reviewEarly(input: ReviewEarlyInput): Snapshot {
    validateSelection(input.direction, input.deck);
    if (input.mode !== 'soonest' && input.mode !== 'missed') throw new StoreError('Choose the words due soonest or the words you missed most.');
    validateBatch(input.count, input.requestId, 'words to review');
    return db.transaction(() => {
      const at = now();
      const time = at.getTime();
      if (claimRequest(input.requestId, 'review-early', input.direction, at)) {
        const misses = new Map(historyForDirection.all(input.direction).map((entry) => [entry.word_id, entry.misses]));
        const missed = (row: CardRow) => misses.get(row.word_id) ?? 0;
        const candidates = rowsForDirection.all(input.direction)
          .filter((row) => inDeck(row.word_id, input.deck) && row.active === 0 && row.due_at > time && (input.mode === 'soonest' || missed(row) > 0))
          .sort((a, b) => (input.mode === 'missed' ? missed(b) - missed(a) : 0) || a.due_at - b.due_at)
          .slice(0, input.count);
        if (!candidates.length) {
          throw new StoreError(input.mode === 'missed' ? 'None of your finished words here have been missed. Try the words due soonest.' : 'No finished words here are waiting for a later review.');
        }
        for (const row of candidates) save({ ...row, due_at: time, version: row.version + 1 });
        const queue = loadQueue(input.direction, at);
        reconcileQueue(queue, rowsForDirection.all(input.direction), at, true);
        saveQueue.run(JSON.stringify(queue), input.direction);
      }
      return snapshot(input.direction, input.deck, at);
    }).immediate();
  }

  // Tapping a word in a French text adds it to the fr-en deck. A word the learner has never met is admitted today
  // on its own extra allowance, so it costs the daily new-word budget nothing; a finished word becomes due now.
  function addWord(input: AddWordInput): AddWordResult {
    const direction: Direction = 'fr-en';
    if (typeof input?.wordId !== 'string' || !wordById.has(input.wordId)) throw new StoreError('That word is not in Echo’s vocabulary.', 404);
    if (typeof input.requestId !== 'string' || !input.requestId.trim()) throw new StoreError('This request is missing its ID. Reload and try again.');
    const kind = `add-word:${input.wordId}`;
    return db.transaction(() => {
      const at = now();
      const previous = requestById.get(input.requestId);
      if (previous) {
        if (previous.kind !== kind || previous.direction !== direction || !previous.result) throw new StoreError('This request ID was already used for something else. Reload and try again.', 409);
        return { status: previous.result as AddWordResult['status'] };
      }
      const row = rowForWord.get(direction, input.wordId);
      let status: AddWordResult['status'];
      if (!row) {
        addExtra.run(direction, studyDay(at), 1);
        save({
          direction, word_id: input.wordId, introduced_day: studyDay(at),
          active: 1, successes: 0, cycle_misses: 0, completed_day: null,
          due_at: at.getTime(), fsrs_json: JSON.stringify(createEmptyCard(at)), version: 1,
        });
        status = 'added';
      } else if (row.active === 1 || row.due_at <= at.getTime()) {
        status = 'already-practising';
      } else {
        save({ ...row, due_at: at.getTime(), version: row.version + 1 });
        status = 'made-due';
      }
      if (status !== 'already-practising') {
        const queue = loadQueue(direction, at);
        reconcileQueue(queue, rowsForDirection.all(direction), at, true);
        saveQueue.run(JSON.stringify(queue), direction);
      }
      recordRequest.run(input.requestId, kind, direction, at.toISOString(), status);
      return { status };
    }).immediate();
  }

  function grade(input: GradeInput): Snapshot {
    validateSelection(input.direction, input.deck);
    if (!Number.isSafeInteger(input.version) || input.version < 1 || typeof input.known !== 'boolean' || typeof input.requestId !== 'string' || !input.requestId.trim()) {
      throw new StoreError('This answer is missing a valid card version, result, or request ID. Reload the card and try again.');
    }
    if (!inDeck(input.wordId, input.deck)) throw new StoreError('That word is not in the selected category.');
    return db.transaction(() => {
      const at = now();
      const previous = gradeByRequest.get(input.requestId);
      if (previous) {
        if (previous.direction !== input.direction || previous.deck !== input.deck || previous.word_id !== input.wordId || previous.version !== input.version || previous.known !== Number(input.known)) {
          throw new StoreError('This answer ID was already used for a different answer. Reload the card and try again.', 409);
        }
        // A retried request returns live state, even if its original grade has since been undone.
        return snapshot(input.direction, input.deck, at);
      }
      const current = snapshot(input.direction, input.deck, at).current;
      if (!current || current.id !== input.wordId || current.version !== input.version) {
        throw new StoreError('This card has changed on another screen. Your answer was not recorded; reload the current card.', 409);
      }
      const before = rowForWord.get(input.direction, input.wordId)!;
      const queue = loadQueue(input.direction, at);
      reconcileQueue(queue, rowsForDirection.all(input.direction), at, false);
      const selection = selectCard(queue, input.deck)!;
      const queueBefore = JSON.stringify(queue);
      passOver(queue, selection, input.wordId);
      const after = { ...before, active: 1, version: before.version + 1 };
      // A miss restarts the count: finishing needs two successes after the latest miss.
      after.successes = input.known ? (before.active ? before.successes : 0) + 1 : 0;
      after.cycle_misses = (before.active ? before.cycle_misses : 0) + Number(!input.known);
      let fsrsLog: string | null = null;
      if (after.successes === 2) {
        // The two-recall loop is a practice cycle, not two independent FSRS reviews.
        fsrsLog = finishCycle(after, at);
      }
      if (after.active) insertRandom(queue[input.known ? 'successful' : 'failed'], input.wordId);
      save(after);
      saveQueue.run(JSON.stringify(queue), input.direction);
      appendGrade.run(input.requestId, input.direction, input.deck, input.wordId, input.version,
        Number(input.known), at.toISOString(), JSON.stringify(before), JSON.stringify(after), fsrsLog, queueBefore);
      return snapshot(input.direction, input.deck, at);
    }).immediate();
  }

  function undo(direction: Direction, deck: string, undoId: string): Snapshot {
    validateSelection(direction, deck);
    if (typeof undoId !== 'string' || !undoId) throw new StoreError('Choose the latest answer to undo.');
    return db.transaction(() => {
      const latest = latestGrade.get(direction);
      if (!latest || latest.request_id !== undoId || !inDeck(latest.word_id, deck)) {
        throw new StoreError('Only the latest answer in this direction can be undone. Reload to see the current answer.', 409);
      }
      const at = now();
      const current = rowForWord.get(direction, latest.word_id)!;
      let restored = JSON.parse(latest.before_json) as CardRow;
      let queue: PracticeQueue;
      if (latest.queue_before_json) {
        queue = JSON.parse(latest.queue_before_json) as PracticeQueue;
        if (queue.day !== studyDay(at)) Object.assign(queue, { day: studyDay(at), warmup: 0, turn: 0, credit: 0 });
      } else {
        const history = db.query<GradeRow, [Direction, string, number]>(`
          SELECT * FROM grades WHERE direction = ? AND word_id = ? AND sequence < ?
          AND NOT EXISTS (SELECT 1 FROM undos WHERE grade_sequence = grades.sequence) ORDER BY sequence
        `).all(direction, latest.word_id, latest.sequence).map((grade) => ({ before: JSON.parse(grade.before_json) as CardRow, known: grade.known, graded_at: grade.graded_at }));
        const legacy = legacyState(restored, history);
        restored = legacy.row;
        queue = loadQueue(direction, at);
        for (const stack of stackNames) queue[stack] = queue[stack].filter((id) => id !== latest.word_id);
        if (restored.active || restored.due_at <= at.getTime()) insertRandom(queue[restored.active ? legacy.stack : 'unseen'], restored.word_id);
        const firsts = db.query<{ before_json: string }, [Direction, string, string, number]>(`
          SELECT before_json FROM grades WHERE direction = ? AND graded_at >= ? AND graded_at <= ? AND sequence != ?
          AND NOT EXISTS (SELECT 1 FROM undos WHERE grade_sequence = grades.sequence)
        `).all(direction, studyDayStart(at).toISOString(), at.toISOString(), latest.sequence);
        queue.warmup = Math.min(10, firsts.filter((grade) => firstRecall(JSON.parse(grade.before_json) as CardRow)).length);
      }
      // History recorded under the earlier rule could carry a success into the failed stack.
      if (restored.active && queue.failed.includes(restored.word_id)) restored.successes = 0;
      // Restoring memory must never restore an old concurrency token.
      restored.version = current.version + 1;
      save(restored);
      db.query('INSERT INTO undos (grade_sequence, undone_at, before_version, after_version) VALUES (?, ?, ?, ?)')
        .run(latest.sequence, at.toISOString(), current.version, restored.version);
      reconcileQueue(queue, rowsForDirection.all(direction), at, true);
      saveQueue.run(JSON.stringify(queue), direction);
      return snapshot(direction, deck, at);
    }).immediate();
  }

  function setSettings(newPerDay: number): Settings {
    if (!Number.isSafeInteger(newPerDay) || newPerDay < 0 || newPerDay > words.length) {
      throw new StoreError(`New words per day must be a whole number from 0 to ${words.length}. Choose 0 to review only.`);
    }
    return db.transaction(() => {
      db.query('UPDATE settings SET new_per_day = ? WHERE singleton = 1').run(newPerDay);
      return settings();
    }).immediate();
  }

  function setSongsFirst(songsFirst: boolean): Settings {
    if (typeof songsFirst !== 'boolean') throw new StoreError('Choose whether song words come first.');
    return db.transaction(() => {
      db.query('UPDATE settings SET songs_first = ? WHERE singleton = 1').run(songsFirst ? 1 : 0);
      order = null; songOf = null;
      return settings();
    }).immediate();
  }

  function addWords(input: AddWordsInput): Word[] {
    const { category, title } = input;
    if (typeof category !== 'string' || !/^song-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category)) throw new StoreError('A song needs a category of its own.');
    if (typeof title !== 'string' || !title.trim()) throw new StoreError('A song needs a title.');
    if (!Array.isArray(input.words) || !input.words.length) throw new StoreError('Choose at least one word to add.');
    for (const word of input.words) {
      if (typeof word?.fr !== 'string' || !word.fr.trim() || typeof word.en !== 'string' || !word.en.trim()) throw new StoreError('Every word needs its French and its English.');
    }
    return db.transaction(() => {
      const at = now().toISOString();
      let next = words.filter((word) => word.category === category).length;
      const made = input.words.map((entry): Word => {
        let id: string;
        do id = `${category}-${String(++next).padStart(3, '0')}`; while (wordById.has(id));
        const note = entry.note?.trim() || undefined;
        insertAdded.run(id, entry.fr.trim(), entry.en.trim(), note ?? null, category, title.trim(), at);
        return withGender({ id, fr: entry.fr.trim(), en: entry.en.trim(), category, ...(note ? { note } : {}) });
      });
      for (const word of made) { words.push(word); wordById.set(word.id, word); added.add(word.id); }
      categoryTitles.set(category, title.trim());
      if (!songCategories.includes(category)) songCategories.push(category);
      rebuildDecks();
      return made;
    }).immediate();
  }

  function linkWords(input: LinkWordsInput): string[] {
    const { category, title } = input;
    if (typeof category !== 'string' || !/^song-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category)) throw new StoreError('A song needs a category of its own.');
    if (typeof title !== 'string' || !title.trim()) throw new StoreError('A song needs a title.');
    if (!Array.isArray(input.ids)) throw new StoreError('Choose the words to put in the song.');
    const ids = [...new Set(input.ids)].filter((id) => { const word = wordById.get(id); return !!word && word.category !== category; });
    return db.transaction(() => {
      const held = links.get(category) ?? [];
      for (const id of ids) {
        linkRow.run(category, title.trim(), id);
        if (!held.includes(id)) held.push(id);
      }
      if (held.length) links.set(category, held);
      if (!categoryTitles.has(category)) categoryTitles.set(category, title.trim());
      if (held.length && !songCategories.includes(category)) songCategories.push(category);
      rebuildDecks();
      return ids;
    }).immediate();
  }

  function browse(direction: Direction, deck: string): BrowseWord[] {
    validateSelection(direction, deck);
    return db.transaction(() => {
      const time = now().getTime();
      const rows = new Map(rowsForDirection.all(direction).map((row) => [row.word_id, row]));
      const history = new Map(historyForDirection.all(direction).map((entry) => [entry.word_id, entry]));
      return words.filter((word) => inDeck(word.id, deck)).map((word): BrowseWord => {
        const row = rows.get(word.id);
        const studied = history.get(word.id);
        return {
          ...word,
          status: !row ? 'new' : row.active ? 'learning' : row.due_at <= time ? 'due' : 'scheduled',
          due: row ? new Date(row.due_at).toISOString() : null,
          lastStudied: studied?.last ?? null,
          misses: studied?.misses ?? 0,
        };
      });
    })();
  }

  // A word's score: +2 for each recall, -3 for each miss (undone answers excluded), +0.5 for each time it
  // was heard to the end on the Walkman, +2 or -3 when the learner marks a listen as known or not, and +1 or -1
  // for each Endless mark. Every
  // point halves over SCORE_HALF_LIFE_DAYS, so an untouched word drifts back towards 0 and turns up again.
  const scoreEvents = db.query<{ word_id: string; weight: number; at: string }, []>(`
    SELECT word_id, CASE known WHEN 1 THEN ${SCORE_RECALLED} ELSE ${SCORE_MISSED} END AS weight, graded_at AS at FROM grades
    WHERE NOT EXISTS (SELECT 1 FROM undos WHERE grade_sequence = grades.sequence)
    UNION ALL SELECT word_id, ${SCORE_HEARD} AS weight, heard_at AS at FROM walkman_heard
    UNION ALL SELECT word_id, CASE knew WHEN 1 THEN ${SCORE_RECALLED} ELSE ${SCORE_MISSED} END AS weight, marked_at AS at FROM walkman_verdicts
    UNION ALL SELECT word_id, CASE known WHEN 1 THEN ${SCORE_ENDLESS} ELSE ${-SCORE_ENDLESS} END AS weight, marked_at AS at FROM endless_marks`);
  const answeredOnce = db.query<{ one: number }, [Direction, string]>('SELECT 1 AS one FROM grades WHERE direction = ? AND word_id = ? AND NOT EXISTS (SELECT 1 FROM undos WHERE grade_sequence = grades.sequence) LIMIT 1');
  const saveEndless = db.query('INSERT OR IGNORE INTO endless_marks (request_id, direction, word_id, known, marked_at) VALUES (?, ?, ?, ?, ?)');
  const dropEndless = db.query('DELETE FROM endless_marks WHERE request_id = ?');

  function scoresAt(time: number): Map<string, number> {
    const scores = new Map<string, number>();
    for (const event of scoreEvents.all()) {
      const days = Math.max(0, (time - Date.parse(event.at)) / 86400000);
      scores.set(event.word_id, (scores.get(event.word_id) ?? 0) + event.weight * 0.5 ** (days / SCORE_HALF_LIFE_DAYS));
    }
    return scores;
  }
  const saveVerdict = db.query('INSERT INTO walkman_verdicts (id, word_id, knew, marked_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET knew = ?3, marked_at = ?4 WHERE word_id = ?2');
  const dropVerdict = db.query('DELETE FROM walkman_verdicts WHERE id = ? AND word_id = ?');
  const saveAccepted = db.query('INSERT OR IGNORE INTO say_accepted (word_id, heard, added_at) VALUES (?, ?, ?)');
  const readAccepted = db.query<{ heard: string }, [string]>('SELECT heard FROM say_accepted WHERE word_id = ?');
  const saveHeard = db.query('INSERT OR IGNORE INTO walkman_heard (request_id, word_id, heard_at) VALUES (?, ?, ?)');

  function listening(): ListeningWord[] {
    const rank = { learning: 3, due: 2, scheduled: 1, new: 0 } as const;
    const scores = scoresAt(now().getTime());
    const reverse = new Map(browse('en-fr', 'all').map((word) => [word.id, word]));
    return browse('fr-en', 'all').map((word) => {
      const other = reverse.get(word.id)!;
      const earliest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);
      const latest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
      return {
        ...word,
        status: rank[other.status] > rank[word.status] ? other.status : word.status,
        due: earliest(word.due, other.due),
        lastStudied: latest(word.lastStudied, other.lastStudied),
        misses: word.misses + other.misses,
        score: Math.round((scores.get(word.id) ?? 0) * 1000) / 1000,
      };
    });
  }

  // The next Endless word: any word answered at least once in this direction, within the deck (a word admitted
  // today but not yet shown does not count), with odds that double for
  // every ENDLESS_PULL points its score is lower. The most recent words are passed over; with only a few words
  // to choose from, the passed-over list is halved until something is left.
  function endlessNext(input: EndlessInput): EndlessPick {
    validateSelection(input.direction, input.deck);
    const misses = new Map(historyForDirection.all(input.direction).map((entry) => [entry.word_id, entry.misses]));
    const rows = rowsForDirection.all(input.direction).filter((row) => misses.has(row.word_id) && wordById.has(row.word_id) && inDeck(row.word_id, input.deck));
    if (!rows.length) return { card: null, pool: 0 };
    const exclude = Array.isArray(input.exclude) ? input.exclude.filter((id): id is string => typeof id === 'string').slice(0, 60) : [];
    let candidates = rows;
    for (let keep = exclude.length; keep >= 0; keep = keep > 1 ? Math.floor(keep / 2) : keep - 1) {
      const passed = new Set(exclude.slice(0, keep));
      candidates = rows.filter((row) => !passed.has(row.word_id));
      if (candidates.length) break;
    }
    const scores = scoresAt(now().getTime());
    const weights = candidates.map((row) => 2 ** (-Math.max(-ENDLESS_LIMIT, Math.min(ENDLESS_LIMIT, scores.get(row.word_id) ?? 0)) / ENDLESS_PULL));
    let left = random() * weights.reduce((total, weight) => total + weight, 0);
    const index = weights.findIndex((weight) => (left -= weight) < 0);
    const row = candidates[index < 0 ? candidates.length - 1 : index]!;
    // Endless has no stacks; the stack is only there to fill the card's shape.
    return { card: cardView(row, 'unseen', misses), pool: rows.length };
  }

  function endlessMark(input: EndlessMarkInput): void {
    if (input?.direction !== 'fr-en' && input?.direction !== 'en-fr') throw new StoreError('Choose a practice direction.');
    if (typeof input.requestId !== 'string' || !input.requestId || typeof input.known !== 'boolean') throw new StoreError('This answer was incomplete. Try again.');
    if (!answeredOnce.get(input.direction, input.wordId)) throw new StoreError('Endless only practises words you have started.');
    saveEndless.run(input.requestId, input.direction, input.wordId, input.known ? 1 : 0, now().toISOString());
  }

  function endlessUndo(requestId: string): void {
    if (typeof requestId !== 'string' || !requestId) throw new StoreError('Choose the answer to take back.');
    dropEndless.run(requestId);
  }

  function recordHeard(input: HeardInput): void {
    if (!wordById.has(input.wordId)) throw new StoreError('This word is not in the vocabulary deck.', 404);
    if (typeof input.requestId !== 'string' || !input.requestId) throw new StoreError('The listen report was incomplete.', 400);
    saveHeard.run(input.requestId, input.wordId, now().toISOString());
  }

  function recordVerdict(input: VerdictInput): void {
    if (!wordById.has(input.wordId)) throw new StoreError('This word is not in the vocabulary deck.', 404);
    if (typeof input.id !== 'string' || !input.id || (input.knew !== true && input.knew !== false && input.knew !== null)) throw new StoreError('The mark was incomplete.', 400);
    if (input.knew === null) dropVerdict.run(input.id, input.wordId);
    else saveVerdict.run(input.id, input.wordId, input.knew ? 1 : 0, now().toISOString());
  }
  function acceptSaid(input: { id: string; wordId: string; heard: string }): void {
    if (typeof input.heard !== 'string' || !input.heard) throw new StoreError('Nothing was heard to accept.', 400);
    db.transaction(() => {
      recordVerdict({ id: input.id, wordId: input.wordId, knew: true });
      saveAccepted.run(input.wordId, input.heard, now().toISOString());
    })();
  }
  const sayAccepted = (wordId: string) => readAccepted.all(wordId).map((row) => row.heard);

  const answersSince = db.query<{ known: number; at: string }, [string]>(`
    SELECT known, graded_at AS at FROM grades WHERE graded_at >= ?
    AND NOT EXISTS (SELECT 1 FROM undos WHERE grade_sequence = grades.sequence)`);
  const heardCount = db.query<{ count: number }, []>('SELECT count(*) AS count FROM walkman_heard');
  // What the past days' charts are built from, counted up to the start of today: they are rebuilt only when this
  // changes (an undo, a Walkman mark moved, a card introduced late) or a new study day begins.
  const pastRecord = db.query<{ key: string }, [string, string]>(`SELECT
    (SELECT count(*) FROM grades WHERE graded_at < ?1) || '|' ||
    (SELECT count(*) FROM undos JOIN grades ON grades.sequence = undos.grade_sequence WHERE graded_at < ?1) || '|' ||
    (SELECT count(*) FROM walkman_heard WHERE heard_at < ?1) || '|' ||
    (SELECT count(*) || ':' || coalesce(sum(knew), 0) FROM walkman_verdicts WHERE marked_at < ?1) || '|' ||
    (SELECT count(*) || ':' || coalesce(sum(known), 0) FROM endless_marks WHERE marked_at < ?1) || '|' ||
    (SELECT count(*) FROM cards WHERE introduced_day < ?2) || '|' ||
    (SELECT count(*) FROM added_words WHERE added_at < ?1) AS key`);
  let past: { key: string; history: ScoreHistoryDay[] } | null = null;

  function statistics(): VocabularyStatistics {
    return db.transaction(() => {
      const all = listening();
      const counts = { learning: 0, due: 0, scheduled: 0, new: 0 };
      for (const word of all) counts[word.status] += 1;
      const started = all.filter((word) => word.status !== 'new').sort((a, b) => a.score - b.score);
      const categories = decks.filter((entry) => entry.id !== 'all').map((entry) => {
        const mine = started.filter((word) => inDeck(word.id, entry.id));
        const average = mine.length ? Math.round(mine.reduce((sum, word) => sum + word.score, 0) / mine.length * 10) / 10 : null;
        return { id: entry.id, title: entry.title, total: entry.count, started: mine.length, average };
      });
      const recent = recentStudyDays(now(), 14);
      const days: StatsDay[] = recent.days.map((day) => ({ day, knew: 0, missed: 0, gained: 0, lost: 0 }));
      const first = recent.since;
      const byDay = new Map(days.map((entry) => [entry.day, entry]));
      for (const answer of answersSince.all(first.toISOString())) {
        const entry = byDay.get(studyDay(new Date(answer.at)));
        if (entry) { if (answer.known) entry.knew += 1; else entry.missed += 1; }
      }
      // Points come from the whole record, in time order: what a miss costs depends on how far the word's answers had climbed (lib/score-points.ts).
      const events = scoreEvents.all().map((event) => ({ id: event.word_id, weight: event.weight, at: Date.parse(event.at) })).sort((left, right) => left.at - right.at);
      pointsFromLowest(events).forEach((value, index) => {
        const entry = byDay.get(studyDay(new Date(events[index]!.at)));
        if (entry) { if (value > 0) entry.gained += value; else entry.lost -= value; }
      });
      const words = started.map(({ id, fr, en, category, status, score, misses, gender }) => ({ id, fr, en, category, status, score, misses, ...(gender ? { gender } : {}) }));
      // Past days are rebuilt; today is the live chart above, so the last day always matches it.
      const bins: [number, number][] = Array.from({ length: SCORE_BINS }, () => [0, 0]);
      for (const word of started) bins[scoreBin(word.score)]![word.status === 'scheduled' || word.status === 'due' ? 0 : 1] += 1;
      const today = { day: studyDay(now()), know: counts.scheduled + counts.due, learning: counts.learning, total: all.length, bins };
      const key = `${today.day}|${words.length}|${pastRecord.get(studyDayStart(now()).toISOString(), today.day)!.key}`;
      if (past?.key !== key) past = { key, history: pastDays().map(({ day, end }): ScoreHistoryDay => {
        const bins: [number, number][] = Array.from({ length: SCORE_BINS }, () => [0, 0]);
        let know = 0;
        const snapshot = replayed.get(end)!;
        for (const [id, known] of snapshot.status) { bins[scoreBin(snapshot.scores.get(id) ?? 0)]![known ? 0 : 1] += 1; if (known) know += 1; }
        return { day, know, learning: snapshot.status.size - know, total: snapshot.total, bins };
      }) };
      replayed.clear();
      return { words, counts, categories, days, walkmanHeard: heardCount.get()!.count, history: [...past.history, today] };
    })();
  }

  // The Word scores chart as it stood at the end of each past study day, rebuilt from the same record the live
  // chart reads: every score event (decayed to that moment, as listening() decays to now) and the card state each
  // answer left. A word counts as started from the day it was introduced, still learning until answers finish it.
  const SCORE_BINS = 17;
  const scoreBin = (score: number) => Math.max(-8, Math.min(8, Math.round(Math.round(score * 1000) / 1000))) + 8;
  const historyGrades = db.query<{ direction: Direction; word_id: string; at: string; after_json: string }, []>(`
    SELECT direction, word_id, graded_at AS at, after_json FROM grades
    WHERE NOT EXISTS (SELECT 1 FROM undos WHERE grade_sequence = grades.sequence) ORDER BY graded_at, sequence`);
  const introductions = db.query<{ direction: Direction; word_id: string; day: string }, []>('SELECT direction, word_id, introduced_day AS day FROM cards WHERE introduced_day IS NOT NULL');
  const addedTimes = db.query<{ id: string; at: string }, []>('SELECT id, added_at AS at FROM added_words');
  type Replayed = { scores: Map<string, number>; status: Map<string, boolean>; total: number };
  const replayed = new Map<number, Replayed>();
  // Each past study day from the first score event to yesterday, with the moment it ended (the next 04:00).
  function pastDays(): { day: string; end: number }[] {
    const first = scoreEvents.all().reduce((earliest, event) => Math.min(earliest, Date.parse(event.at)), Infinity);
    if (first === Infinity) return [];
    const today = studyDayStart(now());
    const days: { day: string; end: number }[] = [];
    for (let start = studyDayStart(new Date(first)); start < today;) {
      const end = new Date(start); end.setDate(end.getDate() + 1);
      days.push({ day: studyDay(start), end: end.getTime() });
      start = end;
    }
    replay(days);
    return days;
  }
  // Walks the record once, oldest first, keeping a snapshot at each of the given moments (ascending).
  function replay(ends: { day: string; end: number }[]): void {
    const day = 86400000;
    const events = scoreEvents.all().map((event) => ({ id: event.word_id, weight: event.weight, at: Date.parse(event.at) })).sort((a, b) => a.at - b.at);
    const answers = historyGrades.all();
    const addedAt = addedTimes.all().filter((entry) => wordById.has(entry.id)).map((entry) => Date.parse(entry.at));
    const scores = new Map<string, number>();
    const active = new Map<string, boolean>();
    const introduced = introductions.all();
    let reference = ends[0]?.end ?? 0, nextEvent = 0, nextAnswer = 0;
    for (const { day: through, end } of ends) {
      const fade = 0.5 ** ((end - reference) / day / SCORE_HALF_LIFE_DAYS);
      for (const [id, score] of scores) scores.set(id, score * fade);
      reference = end;
      for (; nextEvent < events.length && events[nextEvent]!.at <= end; nextEvent++) {
        const event = events[nextEvent]!;
        scores.set(event.id, (scores.get(event.id) ?? 0) + event.weight * 0.5 ** (Math.max(0, end - event.at) / day / SCORE_HALF_LIFE_DAYS));
      }
      for (; nextAnswer < answers.length && Date.parse(answers[nextAnswer]!.at) <= end; nextAnswer++) {
        const answer = answers[nextAnswer]!;
        active.set(`${answer.direction}|${answer.word_id}`, (JSON.parse(answer.after_json) as CardRow).active === 1);
      }
      // Known: started and finished in both directions; still learning: in progress in either.
      const status = new Map<string, boolean>();
      const cards = new Map(active);
      for (const card of introduced) { const key = `${card.direction}|${card.word_id}`; if (card.day <= through && !cards.has(key)) cards.set(key, true); }
      for (const [key, on] of cards) {
        const id = key.slice(key.indexOf('|') + 1);
        if (!wordById.has(id)) continue;
        status.set(id, (status.get(id) ?? true) && !on);
      }
      replayed.set(end, { scores: new Map(scores), status, total: words.length - addedAt.filter((at) => at > end).length });
    }
  }

  function statisticsDay(day: string): ScoreDayWords {
    return db.transaction(() => {
      const entry = pastDays().find((candidate) => candidate.day === day);
      if (!entry) { replayed.clear(); throw new StoreError('There is no record of that day.', 404); }
      const snapshot = replayed.get(entry.end)!;
      replayed.clear();
      return { day, words: [...snapshot.status].map(([id, known]) => ({ id, score: Math.round((snapshot.scores.get(id) ?? 0) * 1000) / 1000, known })) };
    })();
  }

  function exportData(): unknown {
    return db.transaction(() => ({
      format: 'echo-progress', version: 2, exportedAt: now().toISOString(),
      studyDayStartsAt: '04:00 server local time', settings: settings(), words,
      cards: db.query<CardRow, []>('SELECT * FROM cards ORDER BY direction, word_id').all().map(({ fsrs_json, ...row }) => ({ ...row, fsrs: JSON.parse(fsrs_json) })),
      queues: db.query<{ direction: Direction; state_json: string }, []>('SELECT * FROM practice_queues ORDER BY direction').all().map(({ direction, state_json }) => ({ direction, ...JSON.parse(state_json) })),
      grades: db.query<GradeRow, []>('SELECT * FROM grades ORDER BY sequence').all().map(({ before_json, after_json, fsrs_log, ...row }) => ({
        ...row, before: JSON.parse(before_json), after: JSON.parse(after_json), fsrsLog: fsrs_log ? JSON.parse(fsrs_log) : null,
      })),
      undos: db.query<UndoRow, []>('SELECT * FROM undos ORDER BY sequence').all(),
      extraAllowance: db.query('SELECT * FROM extra_allowance ORDER BY day, direction').all(),
      walkmanHeard: db.query('SELECT word_id, heard_at FROM walkman_heard ORDER BY sequence').all(),
      addedWords: db.query('SELECT id, fr, en, note, category, category_title, added_at FROM added_words ORDER BY sequence').all(),
      deckLinks: db.query('SELECT category, category_title, word_id FROM deck_links ORDER BY sequence').all(),
      walkmanVerdicts: db.query('SELECT word_id, knew, marked_at FROM walkman_verdicts ORDER BY marked_at').all(),
      sayAccepted: db.query('SELECT word_id, heard, added_at FROM say_accepted ORDER BY added_at').all(),
      endlessMarks: db.query('SELECT direction, word_id, known, marked_at FROM endless_marks ORDER BY marked_at').all(),
    }))();
  }

  function deckCounts(direction: Direction): Record<string, { today: number; waiting: number }> {
    return db.transaction(() => {
      const day = studyDay(now());
      const counts: Record<string, { today: number; waiting: number }> = {};
      for (const [deck, total] of categories) counts[deck] = { today: 0, waiting: total };
      // A started word counts in its own category and in every song deck that holds it.
      const linkedIn = new Map<string, string[]>();
      for (const [deck, ids] of links) for (const id of ids) linkedIn.set(id, [...(linkedIn.get(id) ?? []), deck]);
      for (const row of rowsForDirection.all(direction)) {
        for (const deck of [wordById.get(row.word_id)?.category ?? '', ...(linkedIn.get(row.word_id) ?? [])]) {
          const count = counts[deck];
          if (!count) continue;
          count.waiting -= 1;
          if (row.introduced_day === day) count.today += 1;
        }
      }
      return counts;
    })();
  }

  return { state, start, grade, undo, settings, setSettings, setSongsFirst, addWords, linkWords, word: (id) => wordById.get(id), words: () => words, addedIds: () => [...added], addExtraWords, reviewEarly, addWord, browse, deckCounts, listening, recordHeard, recordVerdict, acceptSaid, sayAccepted, endlessNext, endlessMark, endlessUndo, statistics, statisticsDay, hookless, setHooks, exportData, close: () => db.close() };
}
