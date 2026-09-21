import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createEmptyCard, fsrs, Rating, type Card, type CardInput } from 'ts-fsrs';
import type { BrowseWord, CardView, Deck, Direction, GradeInput, Settings, Snapshot, Stats, Word } from '../contract';

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
  queue_order: number;
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
};

type UndoRow = {
  sequence: number;
  grade_sequence: number;
  undone_at: string;
  before_version: number;
  after_version: number;
};

function studyDay(now: Date): string {
  const day = new Date(now);
  if (day.getHours() < 4) day.setDate(day.getDate() - 1);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

function nextStudyDay(now: Date): Date {
  const next = new Date(now);
  next.setHours(4, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

export function createStore(words: Word[], options: { dbPath?: string; now?: () => Date } = {}): Store {
  const now = options.now ?? (() => new Date());
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
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        new_per_day INTEGER NOT NULL CHECK (new_per_day >= 0)
      );
      CREATE TABLE IF NOT EXISTS queue_counter (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        value INTEGER NOT NULL
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
        queue_order INTEGER NOT NULL,
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
        FOREIGN KEY (direction, word_id) REFERENCES cards(direction, word_id)
      );
      CREATE TABLE IF NOT EXISTS undos (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        grade_sequence INTEGER NOT NULL UNIQUE REFERENCES grades(sequence),
        undone_at TEXT NOT NULL,
        before_version INTEGER NOT NULL,
        after_version INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS grades_direction_sequence ON grades(direction, sequence DESC);
    `);
    db.query('INSERT OR IGNORE INTO settings VALUES (1, ?)').run(Math.min(30, words.length));
    db.query('INSERT OR IGNORE INTO queue_counter VALUES (1, 0)').run();
  }).immediate();

  const scheduler = fsrs({ enable_short_term: false, enable_fuzz: false });
  const rowsForDirection = db.query<CardRow, [Direction]>('SELECT * FROM cards WHERE direction = ? ORDER BY queue_order');
  const rowForWord = db.query<CardRow, [Direction, string]>('SELECT * FROM cards WHERE direction = ? AND word_id = ?');
  const readSettings = db.query<{ newPerDay: number }, []>('SELECT new_per_day AS newPerDay FROM settings WHERE singleton = 1');
  const nextOrder = db.query<{ value: number }, []>('UPDATE queue_counter SET value = value + 1 WHERE singleton = 1 RETURNING value');
  const gradeByRequest = db.query<GradeRow, [string]>('SELECT * FROM grades WHERE request_id = ?');
  const latestGrade = db.query<GradeRow, [Direction]>(`
    SELECT grades.* FROM grades
    WHERE direction = ? AND NOT EXISTS (SELECT 1 FROM undos WHERE grade_sequence = grades.sequence)
    ORDER BY sequence DESC LIMIT 1
  `);
  const saveCard = db.query(`
    INSERT INTO cards (direction, word_id, introduced_day, active, successes, cycle_misses,
      completed_day, due_at, fsrs_json, version, queue_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (direction, word_id) DO UPDATE SET
      introduced_day = excluded.introduced_day, active = excluded.active,
      successes = excluded.successes, cycle_misses = excluded.cycle_misses,
      completed_day = excluded.completed_day, due_at = excluded.due_at,
      fsrs_json = excluded.fsrs_json, version = excluded.version, queue_order = excluded.queue_order
  `);
  const appendGrade = db.query(`
    INSERT INTO grades (request_id, direction, deck, word_id, version, known,
      graded_at, before_json, after_json, fsrs_log) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

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
      row.cycle_misses, row.completed_day, row.due_at, row.fsrs_json, row.version, row.queue_order);
  }

  function snapshot(direction: Direction, deck: string, at: Date): Snapshot {
    const day = studyDay(at);
    const time = at.getTime();
    const preferences = settings();
    const rows = rowsForDirection.all(direction);
    const selected = rows.filter((row) => inDeck(row.word_id, deck));
    const total = deck === 'all' ? words.length : categories.get(deck)!;
    const introducedToday = rows.filter((row) => row.introduced_day === day).length;
    function summarize(records: CardRow[], count: number): Stats {
      const unseen = count - records.length;
      const stats: Stats = {
        total: count, unseen, practised: 0, scheduled: 0, introducedToday,
        newAvailable: Math.min(unseen, Math.max(0, preferences.newPerDay - introducedToday)),
        learning: 0, due: 0, completedToday: 0, remaining: 0,
      };
      for (const candidate of records) {
        if (candidate.completed_day !== null || candidate.successes > 0 || candidate.cycle_misses > 0) stats.practised++;
        if (candidate.active === 1) stats.learning++;
        else if (candidate.due_at <= time) stats.due++;
        else stats.scheduled++;
        if (candidate.completed_day === day) stats.completedToday++;
      }
      stats.remaining = stats.learning + stats.due;
      return stats;
    }
    const stats = summarize(selected, total);
    const overview = deck === 'all' ? stats : summarize(rows.filter((candidate) => inDeck(candidate.word_id, 'all')), words.length);
    const row = selected.find((candidate) => candidate.active === 1 || candidate.due_at <= time);
    let current: CardView | null = null;
    if (row) {
      current = {
        ...wordById.get(row.word_id)!,
        successes: row.active ? row.successes : 0,
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
      day, direction, deck, settings: preferences, decks,
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

  function start(direction: Direction, deck: string): Snapshot {
    validateSelection(direction, deck);
    return db.transaction(() => {
      const at = now();
      const day = studyDay(at);
      const rows = rowsForDirection.all(direction);
      const seen = new Set(rows.map((row) => row.word_id));
      let allowance = Math.max(0, settings().newPerDay - rows.filter((row) => row.introduced_day === day).length);
      for (const word of words) {
        if (allowance === 0) break;
        if ((deck !== 'all' && word.category !== deck) || seen.has(word.id)) continue;
        save({
          direction, word_id: word.id, introduced_day: day,
          active: 1, successes: 0, cycle_misses: 0, completed_day: null,
          due_at: at.getTime(), fsrs_json: JSON.stringify(createEmptyCard(at)),
          version: 1, queue_order: nextOrder.get()!.value,
        });
        allowance -= 1;
      }
      return snapshot(direction, deck, at);
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
      const after = { ...before, active: 1, version: before.version + 1, queue_order: nextOrder.get()!.value };
      after.successes = input.known ? (before.active ? before.successes : 0) + 1 : 0;
      after.cycle_misses = (before.active ? before.cycle_misses : 0) + Number(!input.known);
      let fsrsLog: string | null = null;
      if (after.successes === 2) {
        // The two-recall loop is a practice cycle, not two independent FSRS reviews.
        const result = scheduler.next(JSON.parse(before.fsrs_json) as CardInput, at, after.cycle_misses > 0 ? Rating.Again : Rating.Good);
        const card: Card = { ...result.card, due: new Date(Math.max(result.card.due.getTime(), nextStudyDay(at).getTime())) };
        after.fsrs_json = JSON.stringify(card);
        after.due_at = card.due.getTime();
        after.active = 0;
        after.successes = 0;
        after.cycle_misses = 0;
        after.completed_day = studyDay(at);
        fsrsLog = JSON.stringify(result.log);
      }
      save(after);
      appendGrade.run(input.requestId, input.direction, input.deck, input.wordId, input.version,
        Number(input.known), at.toISOString(), JSON.stringify(before), JSON.stringify(after), fsrsLog);
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
      const restored = JSON.parse(latest.before_json) as CardRow;
      // Restoring memory must never restore an old concurrency token.
      restored.version = current.version + 1;
      save(restored);
      db.query('INSERT INTO undos (grade_sequence, undone_at, before_version, after_version) VALUES (?, ?, ?, ?)')
        .run(latest.sequence, at.toISOString(), current.version, restored.version);
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
      return words.filter((word) => deck === 'all' || word.category === deck).map((word): BrowseWord => {
        const row = rows.get(word.id);
        return {
          ...word,
          status: !row ? 'new' : row.active ? 'learning' : row.due_at <= time ? 'due' : 'scheduled',
          due: row ? new Date(row.due_at).toISOString() : null,
        };
      });
    })();
  }

  function exportData(): unknown {
    return db.transaction(() => ({
      format: 'echo-progress', version: 1, exportedAt: now().toISOString(),
      studyDayStartsAt: '04:00 server local time', settings: settings(), words,
      cards: db.query<CardRow, []>('SELECT * FROM cards ORDER BY direction, queue_order').all().map(({ fsrs_json, ...row }) => ({ ...row, fsrs: JSON.parse(fsrs_json) })),
      grades: db.query<GradeRow, []>('SELECT * FROM grades ORDER BY sequence').all().map(({ before_json, after_json, fsrs_log, ...row }) => ({
        ...row, before: JSON.parse(before_json), after: JSON.parse(after_json), fsrsLog: fsrs_log ? JSON.parse(fsrs_log) : null,
      })),
      undos: db.query<UndoRow, []>('SELECT * FROM undos ORDER BY sequence').all(),
    }))();
  }

  return { state, start, grade, undo, settings, setSettings, browse, exportData, close: () => db.close() };
}
