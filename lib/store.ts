import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createEmptyCard, fsrs, Rating, type Card, type CardInput } from 'ts-fsrs';
import type { AddWordInput, AddWordResult, BrowseWord, CardView, Deck, Direction, ExtraWordsInput, GradeInput, ReviewEarlyInput, Settings, Snapshot, Stats, VocabularyStack, Word } from '../contract';

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
  addExtraWords(input: ExtraWordsInput): Snapshot;
  reviewEarly(input: ReviewEarlyInput): Snapshot;
  addWord(input: AddWordInput): AddWordResult;
  browse(direction: Direction, deck: string): BrowseWord[];
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

// recent holds the last words answered, newest first; selection passes over them while anything else is left.
type PracticeQueue = { day: string; warmup: number; turn: number; unseen: string[]; failed: string[]; successful: string[]; recent?: string[] };
const RECENT_GAP = 3;
type HistoricalGrade = { before: CardRow; known: number; graded_at: string };
const stackNames: VocabularyStack[] = ['unseen', 'failed', 'successful'];
const stackMix: VocabularyStack[] = ['failed', 'unseen', 'successful', 'unseen', 'failed', 'unseen'];

function emptyQueue(day: string): PracticeQueue {
  return { day, warmup: 0, turn: 0, unseen: [], failed: [], successful: [] };
}

function studyDayStart(now: Date): Date {
  const start = new Date(now);
  if (start.getHours() < 4) start.setDate(start.getDate() - 1);
  start.setHours(4, 0, 0, 0);
  return start;
}

function studyDay(now: Date): string {
  const day = studyDayStart(now);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

function nextStudyDay(now: Date): Date {
  const next = new Date(now);
  next.setHours(4, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

export function createStore(words: Word[], options: { dbPath?: string; now?: () => Date; random?: () => number } = {}): Store {
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const wordById = new Map(words.map((word) => [word.id, word]));
  if (wordById.size !== words.length) throw new StoreError('Vocabulary contains duplicate word IDs.');
  const categories = new Map<string, number>();
  for (const word of words) {
    if (!word.id || !word.category || word.category === 'all') throw new StoreError('Vocabulary contains an invalid word or category.');
    categories.set(word.category, (categories.get(word.category) ?? 0) + 1);
  }
  const decks: Deck[] = [
    { id: 'all', title: 'All words', count: words.length },
    ...Array.from(categories, ([id, count]) => ({ id, title: id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()), count })),
  ];
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
      CREATE INDEX IF NOT EXISTS grades_direction_sequence ON grades(direction, sequence DESC);
      CREATE INDEX IF NOT EXISTS grades_direction_time ON grades(direction, graded_at);
    `);
    db.query('INSERT OR IGNORE INTO settings VALUES (1, ?)').run(Math.min(30, words.length));
    const hasColumn = (table: string, name: string) => db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().some((column) => column.name === name);
    if (!hasColumn('grades', 'queue_before_json')) db.exec('ALTER TABLE grades ADD COLUMN queue_before_json TEXT');
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
  const readSettings = db.query<{ newPerDay: number }, []>('SELECT new_per_day AS newPerDay FROM settings WHERE singleton = 1');
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
    if (queue.day !== day) Object.assign(queue, { day, warmup: 0, turn: 0 });
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

  function selectCard(queue: PracticeQueue, deck: string): { id: string; stack: VocabularyStack; nextTurn: number } | null {
    const recent = queue.recent ?? [];
    // A word just answered, missed or not, waits for others; it returns at once only when nothing else is left.
    for (const avoid of [recent, recent.slice(0, 1), []]) {
      const pick = (list: string[]) => list.find((id) => inDeck(id, deck) && !avoid.includes(id));
      const unseen = pick(queue.unseen);
      if (queue.warmup < 10 && unseen) return { id: unseen, stack: 'unseen', nextTurn: queue.turn };
      for (let offset = 0; offset < stackMix.length; offset++) {
        const position = (queue.turn + offset) % stackMix.length;
        const stack = stackMix[position]!;
        const id = pick(queue[stack]);
        if (id) return { id, stack, nextTurn: (position + 1) % stackMix.length };
      }
    }
    return null;
  }

  function validateSelection(direction: Direction, deck: string): void {
    if (direction !== 'fr-en' && direction !== 'en-fr') throw new StoreError('Choose French → English or English → French.');
    if (deck !== 'all' && !categories.has(deck)) throw new StoreError('That vocabulary category does not exist.');
  }

  function inDeck(wordId: string, deck: string): boolean {
    const word = wordById.get(wordId);
    return !!word && (deck === 'all' || word.category === deck);
  }

  function settings(): Settings {
    return readSettings.get()!;
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
    function summarize(records: CardRow[], count: number): Stats {
      const unseen = count - records.length;
      const stats: Stats = {
        total: count, unseen, seenActive: 0, unseenActive: 0, introducedToday,
        newAvailable: Math.min(unseen, Math.max(0, preferences.newPerDay + extra - introducedToday)),
        learning: 0, due: 0, completedToday: 0, remaining: 0, scheduled: 0, scheduledMissed: 0,
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
    const stats = summarize(selected, total);
    const overview = deck === 'all' ? stats : summarize(rows.filter((candidate) => inDeck(candidate.word_id, 'all')), words.length);
    const selection = selectCard(queue, deck);
    const row = selection ? selected.find((candidate) => candidate.word_id === selection.id) : null;
    let current: CardView | null = null;
    if (row) {
      current = {
        ...wordById.get(row.word_id)!,
        successes: row.active ? row.successes : 0,
        stack: selection!.stack,
        version: row.version,
        stage: row.active === 0 ? 'review' : row.completed_day === null && row.successes === 0 && row.cycle_misses === 0 ? 'new' : 'learning',
        audioUrl: `audio/${encodeURIComponent(row.word_id)}.mp3`,
      };
    }
    let nextDue: number | null = null;
    for (const candidate of selected) {
      if (candidate.active === 0 && candidate.due_at > time && (nextDue === null || candidate.due_at < nextDue)) nextDue = candidate.due_at;
    }
    const latest = latestGrade.get(direction);
    return {
      day, direction, deck, settings: preferences, extraToday: extra, decks,
      stats, overview,
      current,
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
    let allowance = Math.max(0, settings().newPerDay + extraToday(direction, day) - rows.filter((row) => row.introduced_day === day).length);
    for (const word of words) {
      if (allowance === 0) break;
      if ((deck !== 'all' && word.category !== deck) || seen.has(word.id)) continue;
      save({
        direction, word_id: word.id, introduced_day: day,
        active: 1, successes: 0, cycle_misses: 0, completed_day: null,
        due_at: at.getTime(), fsrs_json: JSON.stringify(createEmptyCard(at)),
        version: 1,
      });
      allowance -= 1;
    }
    const queue = loadQueue(direction, at);
    reconcileQueue(queue, rowsForDirection.all(direction), at, true);
    saveQueue.run(JSON.stringify(queue), direction);
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
      queue[selection.stack].splice(queue[selection.stack].indexOf(input.wordId), 1);
      if (selection.stack === 'unseen') queue.warmup = Math.min(10, queue.warmup + 1);
      queue.turn = selection.nextTurn;
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
      queue.recent = [input.wordId, ...(queue.recent ?? []).filter((id) => id !== input.wordId)].slice(0, RECENT_GAP);
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
        if (queue.day !== studyDay(at)) Object.assign(queue, { day: studyDay(at), warmup: 0, turn: 0 });
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

  function browse(direction: Direction, deck: string): BrowseWord[] {
    validateSelection(direction, deck);
    return db.transaction(() => {
      const time = now().getTime();
      const rows = new Map(rowsForDirection.all(direction).map((row) => [row.word_id, row]));
      const history = new Map(historyForDirection.all(direction).map((entry) => [entry.word_id, entry]));
      return words.filter((word) => deck === 'all' || word.category === deck).map((word): BrowseWord => {
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
    }))();
  }

  return { state, start, grade, undo, settings, setSettings, addExtraWords, reviewEarly, addWord, browse, exportData, close: () => db.close() };
}
