import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyCard, fsrs, Rating, type CardInput } from 'ts-fsrs';
import type { Direction, GradeInput, Snapshot, Word } from '../contract';
import { createStore, StoreError, type Store } from '../lib/store';

const words: Word[] = [
  { id: 'food-001', fr: 'le pain', en: 'bread', category: 'food' },
  { id: 'travel-001', fr: 'le train', en: 'train', category: 'travel' },
  { id: 'food-002', fr: "l'eau", en: 'water', category: 'food' },
  { id: 'travel-002', fr: 'la gare', en: 'station', category: 'travel' },
  { id: 'food-003', fr: 'le lait', en: 'milk', category: 'food' },
  { id: 'travel-003', fr: 'le billet', en: 'ticket', category: 'travel' },
  { id: 'food-004', fr: 'la pomme', en: 'apple', category: 'food' },
  { id: 'travel-004', fr: 'la rue', en: 'street', category: 'travel' },
];
const thirtyWords: Word[] = Array.from({ length: 30 }, (_, index) => ({ id: `word-${String(index).padStart(2, '0')}`, fr: `mot ${index}`, en: `word ${index}`, category: 'daily' }));
type Progress = {
  cards: Array<{ word_id: string; direction: Direction; version: number; fsrs: CardInput }>;
  grades: Array<{ request_id: string; known: number; fsrsLog: { rating: number } | null }>;
  undos: Array<{ grade_sequence: number }>;
};
const stores: Store[] = [];
const directories: string[] = [];
let requestSequence = 0;
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function close(store: Store): void {
  store.close();
  stores.splice(stores.indexOf(store), 1);
}
function fixture(at = new Date(2026, 8, 21, 10), vocabulary = words) {
  const directory = mkdtempSync(join(tmpdir(), 'echo-store-'));
  directories.push(directory);
  const dbPath = join(directory, 'nested', 'echo.db');
  const clock = { value: at };
  const randomness = { value: 0.999999 };
  const open = () => {
    const store = createStore(vocabulary, { dbPath, now: () => new Date(clock.value), random: () => randomness.value });
    stores.push(store);
    return store;
  };
  return { store: open(), open, clock, randomness, dbPath };
}
function answer(snapshot: Snapshot, known: boolean, requestId = `answer-${++requestSequence}`): GradeInput {
  if (!snapshot.current) throw new Error('Test expected an active card.');
  return { direction: snapshot.direction, deck: snapshot.deck, wordId: snapshot.current.id, version: snapshot.current.version, known, requestId };
}
function progress(store: Store): Progress { return store.exportData() as Progress; }
function expectStatus(action: () => unknown, status: number): void {
  try { action(); throw new Error(`Expected HTTP ${status}.`); }
  catch (error) { expect(error).toBeInstanceOf(StoreError); expect((error as StoreError).status).toBe(status); }
}
function expectConflict(action: () => unknown): void {
  expectStatus(action, 409);
}

describe('working-deck counts and admission', () => {
  test('GET is read-only; 04:00 renews the allowance without forgetting seen cards or granting catch-up days', () => {
    const { store, clock } = fixture(new Date(2026, 8, 21, 3, 59));
    store.setSettings(1);
    const before = store.exportData();
    expect(store.state('fr-en', 'all').stats).toMatchObject({ newAvailable: 1, seenActive: 0, unseenActive: 1 });
    expect(store.state('fr-en', 'all').current).toBeNull();
    expect(store.exportData()).toEqual(before);
    let state = store.start('fr-en', 'all');
    expect(state.day).toBe('2026-09-20');
    expect(store.start('fr-en', 'all').stats.remaining).toBe(1);
    state = store.grade(answer(state, true));
    expect(state.stats).toMatchObject({ seenActive: 1, unseenActive: 0, remaining: 1 });
    clock.value = new Date(2026, 8, 21, 4);
    state = store.state('fr-en', 'all');
    expect(state.day).toBe('2026-09-21');
    expect(state.stats).toMatchObject({ introducedToday: 0, remaining: 1, newAvailable: 1, seenActive: 1, unseenActive: 1 });
    expect(state.current?.successes).toBe(1);
    state = store.start('fr-en', 'all');
    expect(state.stats).toMatchObject({ introducedToday: 1, remaining: 2, seenActive: 1, unseenActive: 1 });
    clock.value = new Date(2026, 8, 28, 4);
    state = store.start('fr-en', 'all');
    expect(state.stats).toMatchObject({ introducedToday: 1, remaining: 3, unseen: 5, seenActive: 1, unseenActive: 2 });
  });

  test('categories share admission and stack priorities; directions keep independent memory', () => {
    const { store } = fixture();
    expect(store.state('fr-en', 'food').stats).toMatchObject({ seenActive: 0, unseenActive: 4, newAvailable: 4 });
    expect(store.state('fr-en', 'all').stats.unseenActive).toBe(8);
    store.setSettings(2);
    const food = store.start('fr-en', 'food');
    expect(food.stats).toMatchObject({ total: 4, unseen: 2, introducedToday: 2, remaining: 2, seenActive: 0, unseenActive: 2 });
    const travel = store.start('fr-en', 'travel');
    expect(travel.stats).toMatchObject({ total: 4, newAvailable: 0, remaining: 0, seenActive: 0, unseenActive: 0 });
    expect(travel.current).toBeNull();
    expect(travel.overview.remaining).toBe(2);
    store.start('en-fr', 'travel');
    store.grade(answer(food, true));
    store.grade(answer(store.state('fr-en', 'all'), false));
    expect(store.state('fr-en', 'food').stats).toMatchObject({ seenActive: 2, unseenActive: 0 });
    expect(store.state('fr-en', 'travel').stats).toMatchObject({ seenActive: 0, unseenActive: 0 });
    expect(store.state('en-fr', 'travel').stats).toMatchObject({ seenActive: 0, unseenActive: 2 });
    store.grade(answer(store.state('en-fr', 'travel'), false));
    expect(store.state('en-fr', 'all').stats).toMatchObject({ seenActive: 1, unseenActive: 1 });
    expect(store.state('fr-en', 'all').stats).toMatchObject({ seenActive: 2, unseenActive: 0 });
    expect(store.browse('en-fr', 'food').every((word) => word.status === 'new')).toBe(true);
  });

  test('seen counts only the two unfinished stacks, including undo through completion and stack changes', () => {
    const { store } = fixture();
    store.setSettings(1);
    let state = store.start('fr-en', 'all');
    expect(state.stats).toMatchObject({ seenActive: 0, unseenActive: 1, remaining: 1 });
    state = store.grade(answer(state, false));
    expect(state.current?.stack).toBe('failed');
    expect(state.stats).toMatchObject({ seenActive: 1, unseenActive: 0 });
    state = store.undo('fr-en', 'all', state.undoId!);
    expect(state.current?.stack).toBe('unseen');
    expect(state.stats).toMatchObject({ seenActive: 0, unseenActive: 1 });
    state = store.grade(answer(state, true));
    expect(state.current).toMatchObject({ stack: 'successful', successes: 1 });
    state = store.grade(answer(state, false));
    expect(state.current).toMatchObject({ stack: 'failed', successes: 0 });
    expect(state.stats).toMatchObject({ seenActive: 1, unseenActive: 0 });
    state = store.grade(answer(state, true));
    expect(state.current).toMatchObject({ stack: 'successful', successes: 1 });
    expect(state.stats).toMatchObject({ seenActive: 1, completedToday: 0 });
    state = store.grade(answer(state, true));
    expect(state.current).toBeNull();
    expect(state.stats).toMatchObject({ seenActive: 0, unseenActive: 0, remaining: 0, completedToday: 1 });
    state = store.undo('fr-en', 'all', state.undoId!);
    expect(state.current).toMatchObject({ stack: 'successful', successes: 1 });
    expect(state.stats).toMatchObject({ seenActive: 1, unseenActive: 0, completedToday: 0 });
    state = store.undo('fr-en', 'all', state.undoId!);
    expect(state.current).toMatchObject({ stack: 'failed', successes: 0 });
    state = store.undo('fr-en', 'all', state.undoId!);
    expect(state.current).toMatchObject({ stack: 'successful', successes: 1 });
    state = store.undo('fr-en', 'all', state.undoId!);
    expect(state.current).toMatchObject({ stack: 'unseen', successes: 0 });
    expect(state.stats).toMatchObject({ seenActive: 0, unseenActive: 1 });
  });

  test.each([['spring forward', 2, 8], ['fall back', 10, 1]] as const)('keeps unfinished stacks across the local 04:00 %s boundary', (_name, month, date) => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const { store, clock } = fixture(new Date(2026, month, date, 3, 59, 59));
      store.setSettings(1);
      let state = store.start('fr-en', 'all');
      state = store.grade(answer(state, false));
      expect(state.stats).toMatchObject({ seenActive: 1, unseenActive: 0, newAvailable: 0 });
      clock.value = new Date(2026, month, date, 4);
      const before = store.exportData();
      expect(store.state('fr-en', 'all').stats).toMatchObject({ seenActive: 1, unseenActive: 1, newAvailable: 1 });
      expect(store.exportData()).toEqual(before);
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  test('allowance changes never discard admitted cards; zero is review-only', () => {
    const { store, clock } = fixture();
    store.setSettings(3);
    store.start('fr-en', 'all');
    store.setSettings(1);
    expect(store.start('fr-en', 'all').stats).toMatchObject({ introducedToday: 3, newAvailable: 0, remaining: 3, unseenActive: 3 });
    store.setSettings(0);
    clock.value = new Date(2026, 8, 22, 10);
    expect(store.start('fr-en', 'all').stats).toMatchObject({ introducedToday: 0, newAvailable: 0, remaining: 3 });
    store.setSettings(2);
    expect(store.state('fr-en', 'all').stats).toMatchObject({ newAvailable: 2, unseenActive: 5 });
    expect(store.start('fr-en', 'all').stats.remaining).toBe(5);
    expect(store.start('fr-en', 'all').stats.remaining).toBe(5);
    store.setSettings(3);
    expect(store.start('fr-en', 'all').stats).toMatchObject({ introducedToday: 3, remaining: 6 });
    expect(() => store.setSettings(words.length + 1)).toThrow(StoreError);
    expect(() => store.setSettings(0.5)).toThrow(StoreError);
    expect(() => store.setSettings(Number.NaN)).toThrow(StoreError);
    expect(() => store.state('invalid' as Direction, 'all')).toThrow(StoreError);
    expect(() => store.start('fr-en', 'missing')).toThrow(StoreError);
  });
});

describe('three-stack selection', () => {
  test('first introduces ten, then serves unseen, failed and successful in a 3:2:1 mix', () => {
    const { store, open } = fixture(undefined, thirtyWords);
    let state = store.start('fr-en', 'all');
    const introduced = new Set<string>();
    for (let index = 0; index < 10; index++) {
      expect(state.current?.stack).toBe('unseen');
      introduced.add(state.current!.id);
      state = store.grade(answer(state, index % 2 === 0));
    }
    expect(introduced.size).toBe(10);
    expect(state.stats).toMatchObject({ unseenActive: 20, seenActive: 10 });
    expect(state.current?.stack).toBe('failed');
    const other = open();
    expect(other.start('fr-en', 'all')).toEqual(state);
    const served: string[] = [];
    for (let index = 0; index < 12; index++) {
      served.push(state.current!.stack);
      state = other.grade(answer(state, state.current!.stack !== 'failed'));
    }
    expect(served.filter((stack) => stack === 'unseen')).toHaveLength(6);
    expect(served.filter((stack) => stack === 'failed')).toHaveLength(4);
    expect(served.filter((stack) => stack === 'successful')).toHaveLength(2);
    expect(state.stats).toMatchObject({ unseenActive: 14, seenActive: 14, completedToday: 2 });
  });

  test('does not run through all unseen cards when the first ten were correct, and empty stacks never block completion', () => {
    const { store } = fixture(undefined, thirtyWords);
    let state = store.start('fr-en', 'all');
    for (let index = 0; index < 10; index++) state = store.grade(answer(state, true));
    let extraUnseen = 0;
    while (state.current?.stack === 'unseen' && extraUnseen < 20) {
      extraUnseen++;
      state = store.grade(answer(state, true));
    }
    expect(extraUnseen).toBeLessThan(3);
    expect(state.current?.stack).toBe('successful');
    let steps = 0;
    while (state.current && steps++ < 60) state = store.grade(answer(state, true));
    expect(state.current).toBeNull();
    expect(state.stats).toMatchObject({ unseenActive: 0, seenActive: 0, completedToday: 30 });
    expect(progress(store).grades).toHaveLength(60);
  });

  test('random reinsertion can place the same failed card at the front, back or middle, rather than forcing FIFO', () => {
    const { store, randomness } = fixture(undefined, thirtyWords);
    randomness.value = 0;
    let state = store.start('fr-en', 'all');
    expect(state.current?.id).toBe(thirtyWords.at(-1)!.id);
    randomness.value = 0.999999;
    const failed: string[] = [];
    for (let index = 0; index < 10; index++) {
      failed.push(state.current!.id);
      state = store.grade(answer(state, false));
    }
    const nextFailed = () => {
      for (let step = 0; state.current?.stack !== 'failed' && step < 6; step++) state = store.grade(answer(state, true));
      expect(state.current?.stack).toBe('failed');
      return state.current!.id;
    };
    expect(nextFailed()).toBe(failed[0]!);
    randomness.value = 0;
    state = store.grade(answer(state, false));
    randomness.value = 0.999999;
    expect(nextFailed()).toBe(failed[0]!);
    state = store.grade(answer(state, false));
    expect(nextFailed()).toBe(failed[1]!);
    randomness.value = 0.5;
    state = store.grade(answer(state, false));
    randomness.value = 0.999999;
    for (const id of failed.slice(2, 7)) {
      expect(nextFailed()).toBe(id);
      state = store.grade(answer(state, false));
    }
    expect(nextFailed()).toBe(failed[1]!);
  });

  test('undo restores the ten-card boundary and reopening does not restart or reshuffle the queue', () => {
    const { store, open } = fixture(undefined, thirtyWords);
    let state = store.start('fr-en', 'all');
    for (let index = 0; index < 9; index++) state = store.grade(answer(state, false));
    const tenth = state.current!;
    state = store.grade(answer(state, false));
    expect(state.current?.stack).toBe('failed');
    state = store.undo('fr-en', 'all', state.undoId!);
    expect(state.current).toMatchObject({ id: tenth.id, stack: 'unseen' });
    expect(state.stats).toMatchObject({ unseenActive: 21, seenActive: 9 });
    close(store);
    const reopened = open();
    expect(reopened.state('fr-en', 'all')).toEqual(state);
    state = reopened.grade(answer(state, false));
    expect(state.current?.stack).toBe('failed');
  });
});

describe('FSRS and transactional protection', () => {
  test('a miss resets the count, so the cycle finishes only after two successes following it', () => {
    const { store, clock } = fixture();
    store.setSettings(1);
    let state = store.start('fr-en', 'all');
    const initial = progress(store).cards[0]!.fsrs;
    state = store.grade(answer(state, true));
    state = store.grade(answer(state, false));
    expect(state.current?.successes).toBe(0);
    state = store.grade(answer(state, true));
    expect(state.current).toMatchObject({ stack: 'successful', successes: 1 });
    expect(progress(store).cards[0]!.fsrs).toEqual(initial);
    state = store.grade(answer(state, true));
    expect(state.current).toBeNull();
    const exported = progress(store);
    expect(exported.grades.filter((grade) => grade.fsrsLog).map((grade) => grade.fsrsLog!.rating)).toEqual([Rating.Again]);
    const expected = fsrs({ enable_short_term: false, enable_fuzz: false }).next(initial, clock.value, Rating.Again);
    expect(exported.cards[0]!.fsrs).toEqual(JSON.parse(JSON.stringify(expected.card)));
    expect(new Date(state.nextDue!).getTime()).toBeGreaterThanOrEqual(new Date(2026, 8, 22, 4).getTime());
    expect(store.browse('fr-en', 'all').filter((word) => word.status === 'scheduled')).toHaveLength(1);
  });

  test('undoing into history recorded under the earlier rule cannot finish a card after one success', () => {
    const { store, dbPath } = fixture();
    store.setSettings(1);
    let state = store.start('fr-en', 'all');
    state = store.grade(answer(state, true));
    state = store.grade(answer(state, false));
    // The earlier rule kept the first success through a miss.
    const db = new Database(dbPath);
    db.query("UPDATE cards SET successes = 1 WHERE word_id = 'food-001'").run();
    db.close();
    state = store.grade(answer(store.state('fr-en', 'all'), true));
    expect(state.current).toBeNull();
    state = store.undo('fr-en', 'all', state.undoId!);
    expect(state.current).toMatchObject({ stack: 'failed', successes: 0 });
    state = store.grade(answer(state, true));
    expect(state.current).toMatchObject({ stack: 'successful', successes: 1 });
    state = store.grade(answer(state, true));
    expect(state.current).toBeNull();
  });

  test('partial successes survive missed days, while scheduled cards enter unseen when they become due', () => {
    const { store, open, clock } = fixture();
    store.setSettings(1);
    let state = store.start('fr-en', 'food');
    state = store.grade(answer(state, false));
    state = store.grade(answer(state, true));
    close(store);
    clock.value = new Date(2026, 8, 25, 10);
    const reopened = open();
    state = reopened.state('fr-en', 'food');
    expect(state.current).toMatchObject({ stack: 'successful', successes: 1 });
    expect(state.stats).toMatchObject({ seenActive: 1, unseenActive: 1 });
    state = reopened.grade(answer(state, true));
    expect(state.stats).toMatchObject({ seenActive: 0, unseenActive: 1 });
    reopened.setSettings(0);
    const due = new Date(state.nextDue!);
    clock.value = new Date(due.getTime() - 1);
    expect(reopened.state('fr-en', 'food').current).toBeNull();
    clock.value = due;
    const before = reopened.exportData();
    state = reopened.state('fr-en', 'food');
    expect(state.current).toMatchObject({ stack: 'unseen', successes: 0, stage: 'review' });
    expect(state.stats).toMatchObject({ seenActive: 0, unseenActive: 1, due: 1 });
    expect(reopened.exportData()).toEqual(before);
    state = reopened.grade(answer(state, true));
    state = reopened.grade(answer(state, true));
    expect(state.current).toBeNull();
    expect(progress(reopened).cards[0]!.fsrs.reps).toBe(2);
  });

  test('duplicate requests are idempotent across connections and reject stale or non-current cards', () => {
    const { store, open } = fixture();
    store.setSettings(2);
    const state = store.start('fr-en', 'all');
    const other = open();
    const request = answer(state, true, 'duplicate-test');
    const after = store.grade(request);
    expect(other.grade(request)).toEqual(after);
    expect(progress(store).grades).toHaveLength(1);
    expectConflict(() => other.grade({ ...request, known: false }));
    expectConflict(() => other.grade({ ...request, requestId: 'stale-test' }));
    expectConflict(() => other.grade({ ...answer(after, true), wordId: 'food-002', version: 1 }));
    const returned = other.grade(answer(after, true));
    expect(returned.current).toMatchObject({ id: 'food-001', successes: 1 });
    expectConflict(() => store.grade({ ...request, requestId: 'old-version-current-again' }));
    expect(progress(store).grades).toHaveLength(2);
  });

  test('undo restores FSRS exactly, retains the answer history and invalidates stale versions', () => {
    const { store } = fixture();
    store.setSettings(1);
    let state = store.start('fr-en', 'food');
    state = store.grade(answer(state, true));
    const memory = progress(store).cards[0]!.fsrs;
    const completion = answer(state, true);
    state = store.grade(completion);
    const scheduled = progress(store).cards[0]!.fsrs;
    expect(state.current).toBeNull();
    state = store.undo('fr-en', 'food', state.undoId!);
    expect(state.current).toMatchObject({ id: 'food-001', successes: 1, stack: 'successful' });
    expect(state.current!.version).toBeGreaterThan(completion.version + 1);
    expect(progress(store).cards[0]!.fsrs).toEqual(memory);
    expect(progress(store).grades).toHaveLength(2);
    expect(progress(store).undos).toHaveLength(1);
    expect(store.grade(completion)).toEqual(state);
    expectConflict(() => store.grade({ ...completion, requestId: 'pre-undo-stale' }));
    expectConflict(() => store.undo('fr-en', 'food', completion.requestId));
    state = store.grade(answer(state, true));
    expect(state.current).toBeNull();
    expect(progress(store).cards[0]!.fsrs).toEqual(scheduled);
  });

  test('undo across categories preserves the other direction and cards admitted after the answer', () => {
    const { store } = fixture();
    store.setSettings(2);
    let state = store.start('fr-en', 'all');
    const first = answer(state, true);
    state = store.grade(first);
    const second = answer(state, false);
    state = store.grade(second);
    expect(store.state('fr-en', 'food').undoId).toBeNull();
    expectConflict(() => store.undo('fr-en', 'food', first.requestId));
    let reverse = store.start('en-fr', 'all');
    reverse = store.grade(answer(reverse, true));
    store.setSettings(3);
    store.start('fr-en', 'food');
    state = store.undo('fr-en', 'all', second.requestId);
    expect(state.current).toMatchObject({ id: 'travel-001', stack: 'unseen' });
    expect(state.stats).toMatchObject({ unseenActive: 2, seenActive: 1, remaining: 3 });
    state = store.undo('fr-en', 'all', first.requestId);
    expect(state.current).toMatchObject({ id: 'food-001', stack: 'unseen' });
    expect(state.stats).toMatchObject({ unseenActive: 3, seenActive: 0 });
    expect(store.state('en-fr', 'all').current).toEqual(reverse.current);
    expect(progress(store).undos).toHaveLength(2);
  });
});

function legacyFixture(answers: boolean[]) {
  const directory = mkdtempSync(join(tmpdir(), 'echo-legacy-'));
  directories.push(directory);
  const dbPath = join(directory, 'echo.db');
  const at = new Date(2026, 8, 21, 10);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE settings (singleton INTEGER PRIMARY KEY, new_per_day INTEGER NOT NULL);
    INSERT INTO settings VALUES (1, 1);
    CREATE TABLE queue_counter (singleton INTEGER PRIMARY KEY, value INTEGER NOT NULL);
    INSERT INTO queue_counter VALUES (1, 100);
    CREATE TABLE cards (direction TEXT, word_id TEXT, introduced_day TEXT, active INTEGER, successes INTEGER, cycle_misses INTEGER, completed_day TEXT, due_at INTEGER, fsrs_json TEXT, version INTEGER, queue_order INTEGER NOT NULL, PRIMARY KEY (direction, word_id));
    CREATE TABLE grades (sequence INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT UNIQUE, direction TEXT, deck TEXT, word_id TEXT, version INTEGER, known INTEGER, graded_at TEXT, before_json TEXT, after_json TEXT, fsrs_log TEXT);
    CREATE TABLE undos (sequence INTEGER PRIMARY KEY AUTOINCREMENT, grade_sequence INTEGER UNIQUE, undone_at TEXT, before_version INTEGER, after_version INTEGER);
  `);
  let row = { direction: 'fr-en', word_id: 'food-001', introduced_day: '2026-09-21', active: 1, successes: 0, cycle_misses: 0, completed_day: null, due_at: at.getTime(), fsrs_json: JSON.stringify(createEmptyCard(at)), version: 1, queue_order: 1 };
  for (const [index, known] of answers.entries()) {
    const before = row;
    row = { ...row, version: row.version + 1, queue_order: row.queue_order + 1, successes: known ? row.successes + 1 : 0, cycle_misses: row.cycle_misses + Number(!known) };
    db.query('INSERT INTO grades (request_id, direction, deck, word_id, version, known, graded_at, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(`legacy-${index}`, 'fr-en', 'all', row.word_id, before.version, Number(known), at.toISOString(), JSON.stringify(before), JSON.stringify(row));
  }
  db.query('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(row.direction, row.word_id, row.introduced_day, row.active, row.successes, row.cycle_misses, row.completed_day, row.due_at, row.fsrs_json, row.version, row.queue_order);
  db.close();
  const open = () => {
    const store = createStore(words, { dbPath, now: () => at, random: () => 0.5 });
    stores.push(store);
    return store;
  };
  return { store: open(), open };
}

describe('saved progress migration', () => {
  test('replays saved misses as resets without discarding either answer', () => {
    const { store } = legacyFixture([true, false]);
    let state = store.state('fr-en', 'all');
    expect(state.current).toMatchObject({ successes: 0, stack: 'failed' });
    expect(state.stats).toMatchObject({ unseenActive: 0, seenActive: 1 });
    expect(progress(store).grades.map((grade) => grade.known)).toEqual([1, 0]);
    state = store.grade(answer(state, true));
    expect(state.current).toMatchObject({ successes: 1, stack: 'successful' });
    state = store.grade(answer(state, true));
    expect(state.current).toBeNull();
    expect(state.stats.seenActive).toBe(0);
  });

  test('graduates two successes after the latest miss, survives reopening, and can undo old answers', () => {
    const { store, open } = legacyFixture([true, false, true, true]);
    let state = store.state('fr-en', 'all');
    expect(state.current).toBeNull();
    expect(state.stats).toMatchObject({ unseenActive: 0, seenActive: 0, completedToday: 1 });
    expect(progress(store).grades.map((grade) => grade.known)).toEqual([1, 0, 1, 1]);
    expect(progress(store).cards[0]!.fsrs.reps).toBe(1);
    const exported = store.exportData();
    close(store);
    const reopened = open();
    expect(reopened.exportData()).toEqual(exported);
    state = reopened.undo('fr-en', 'all', 'legacy-3');
    expect(state.current).toMatchObject({ successes: 1, stack: 'successful' });
    state = reopened.undo('fr-en', 'all', 'legacy-2');
    expect(state.current).toMatchObject({ successes: 0, stack: 'failed' });
    expect(state.stats).toMatchObject({ seenActive: 1, unseenActive: 0 });
    state = reopened.grade(answer(state, true));
    expect(state.current).toMatchObject({ successes: 1, stack: 'successful' });
    state = reopened.grade(answer(state, true));
    expect(state.current).toBeNull();
    expect(progress(reopened).cards[0]!.fsrs.reps).toBe(1);
  });
});

describe('extra practice', () => {
  test('extra words add to today only, admit at once, and a retried request applies once', () => {
    const { store, clock } = fixture();
    store.setSettings(1);
    let state = store.start('fr-en', 'all');
    expect(state.stats.newAvailable).toBe(0);
    const request = { direction: 'fr-en', deck: 'all', count: 2, requestId: 'extra-today' } as const;
    state = store.addExtraWords(request);
    expect(state.extraToday).toBe(2);
    expect(state.stats).toMatchObject({ introducedToday: 3, newAvailable: 0, unseenActive: 3 });
    expect(store.addExtraWords(request).stats.introducedToday).toBe(3);
    expect(store.settings().newPerDay).toBe(1);
    expect(store.state('en-fr', 'all').stats.newAvailable).toBe(1);
    clock.value = new Date(2026, 8, 22, 10);
    state = store.state('fr-en', 'all');
    expect(state.extraToday).toBe(0);
    expect(state.stats.newAvailable).toBe(1);
  });

  test('a custom count larger than what is available takes all of it instead of failing', () => {
    const { store, clock } = fixture();
    store.setSettings(0);
    let state = store.addExtraWords({ direction: 'fr-en', deck: 'all', count: 500, requestId: 'extra-large' });
    expect(state.stats).toMatchObject({ introducedToday: words.length, newAvailable: 0 });
    while (state.current) state = store.grade(answer(state, true));
    clock.value = new Date(2026, 8, 22, 5);
    state = store.reviewEarly({ direction: 'fr-en', deck: 'all', mode: 'soonest', count: 500, requestId: 'review-large' });
    expect(state.stats).toMatchObject({ due: words.length, scheduled: 0 });
  });

  test('extra words are refused, without granting anything, once every word in the selection is started', () => {
    const { store } = fixture();
    store.setSettings(words.length);
    store.start('fr-en', 'all');
    expect(() => store.addExtraWords({ direction: 'fr-en', deck: 'all', count: 5, requestId: 'extra-none' })).toThrow('You have already started every word in Echo.');
    expect(store.state('fr-en', 'all').extraToday).toBe(0);
  });

  test('early review pulls the soonest finished word and scores it as an early FSRS review', () => {
    const { store, clock } = fixture();
    store.setSettings(1);
    let state = store.start('fr-en', 'all');
    while (state.current) state = store.grade(answer(state, true));
    clock.value = new Date(2026, 8, 22, 10);
    state = store.start('fr-en', 'all');
    while (state.current) state = store.grade(answer(state, true));
    clock.value = new Date(2026, 8, 23, 10);
    const firstFinish = progress(store).cards.find((card) => card.word_id === 'food-001')!.fsrs;
    const request = { direction: 'fr-en', deck: 'all', mode: 'soonest', count: 1, requestId: 'early-soonest' } as const;
    state = store.reviewEarly(request);
    expect(state.current).toMatchObject({ id: 'food-001', stage: 'review' });
    expect(state.stats).toMatchObject({ due: 1, scheduled: 1 });
    expect(store.reviewEarly(request).stats).toMatchObject({ due: 1, scheduled: 1 });
    state = store.grade(answer(state, true));
    state = store.grade(answer(state, true));
    expect(state.current).toBeNull();
    const scheduler = fsrs({ enable_short_term: false, enable_fuzz: false });
    const early = scheduler.next(firstFinish, clock.value, Rating.Good).card;
    const onTime = scheduler.next(firstFinish, new Date(firstFinish.due), Rating.Good).card;
    const reviewed = progress(store).cards.find((card) => card.word_id === 'food-001')!.fsrs;
    expect(reviewed).toEqual(JSON.parse(JSON.stringify(early)));
    expect(new Date(reviewed.due).getTime() - clock.value.getTime()).toBeLessThan(new Date(onTime.due).getTime() - new Date(firstFinish.due).getTime());
  });

  test('most-missed review skips words never missed, and the word list reports study history', () => {
    const { store, clock } = fixture();
    store.setSettings(2);
    let state = store.start('fr-en', 'all');
    const missOnce = new Set(['food-001']);
    while (state.current) state = store.grade(answer(state, !missOnce.delete(state.current.id)));
    clock.value = new Date(2026, 8, 22, 5);
    expect(store.state('fr-en', 'all').stats).toMatchObject({ scheduled: 2, scheduledMissed: 1 });
    state = store.reviewEarly({ direction: 'fr-en', deck: 'all', mode: 'missed', count: 5, requestId: 'early-missed' });
    expect(state.current?.id).toBe('food-001');
    expect(state.stats).toMatchObject({ due: 1, scheduled: 1, scheduledMissed: 0 });
    expect(() => store.reviewEarly({ direction: 'fr-en', deck: 'all', mode: 'missed', count: 5, requestId: 'early-missed-again' })).toThrow('None of your finished words here have been missed.');
    const list = new Map(store.browse('fr-en', 'all').map((word) => [word.id, word]));
    expect(list.get('food-001')).toMatchObject({ misses: 1, status: 'due' });
    expect(list.get('travel-001')).toMatchObject({ misses: 0, status: 'scheduled' });
    expect(list.get('travel-001')!.lastStudied).not.toBeNull();
    expect(list.get('food-002')).toMatchObject({ misses: 0, lastStudied: null, status: 'new' });
  });
});

describe('adding a word tapped in a French text', () => {
  test('a word never met joins today on its own allowance, and the same tap replays', () => {
    const { store } = fixture();
    store.setSettings(2);
    expect(store.state('fr-en', 'all').stats).toMatchObject({ newAvailable: 2, introducedToday: 0, learning: 0 });
    expect(store.addWord({ wordId: 'travel-004', requestId: 'tap-rue' })).toEqual({ status: 'added' });
    const added = store.state('fr-en', 'all');
    expect(added.stats).toMatchObject({ newAvailable: 2, introducedToday: 1, learning: 1, remaining: 1 });
    expect(added.extraToday).toBe(1);
    expect(added.current).toMatchObject({ id: 'travel-004', stack: 'unseen', stage: 'new' });
    // A retried tap neither grants a second allowance nor changes its answer.
    expect(store.addWord({ wordId: 'travel-004', requestId: 'tap-rue' })).toEqual({ status: 'added' });
    expect(store.state('fr-en', 'all').extraToday).toBe(1);
    // The two new words of the day are still waiting.
    expect(store.start('fr-en', 'all').stats).toMatchObject({ introducedToday: 3, learning: 3, newAvailable: 0 });
  });

  test('a word already in the deck stays put, and a finished one becomes due now', () => {
    const { store } = fixture(new Date(2026, 8, 21, 10), words.slice(0, 2));
    store.setSettings(1);
    let state = store.start('fr-en', 'all');
    expect(state.current?.id).toBe('food-001');
    expect(store.addWord({ wordId: 'food-001', requestId: 'tap-active' })).toEqual({ status: 'already-practising' });
    state = store.grade(answer(state, true));
    state = store.grade(answer(state, true));
    expect(state.stats).toMatchObject({ learning: 0, due: 0, scheduled: 1 });
    expect(store.addWord({ wordId: 'food-001', requestId: 'tap-finished' })).toEqual({ status: 'made-due' });
    state = store.state('fr-en', 'all');
    expect(state.stats).toMatchObject({ due: 1, scheduled: 0 });
    expect(state.current?.id).toBe('food-001');
    // Waiting in the deck again, it is no longer something to add.
    expect(store.addWord({ wordId: 'food-001', requestId: 'tap-due' })).toEqual({ status: 'already-practising' });
    expect(store.state('fr-en', 'all').extraToday).toBe(0);
  });

  test('an unknown word is a 404, and one tap ID cannot add two words', () => {
    const { store } = fixture();
    expectStatus(() => store.addWord({ wordId: 'food-999', requestId: 'tap-unknown' }), 404);
    expect(store.addWord({ wordId: 'food-001', requestId: 'tap-once' })).toEqual({ status: 'added' });
    expectConflict(() => store.addWord({ wordId: 'food-002', requestId: 'tap-once' }));
    expect(store.state('fr-en', 'all').stats.introducedToday).toBe(1);
  });
});
