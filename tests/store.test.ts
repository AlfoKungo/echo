import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fsrs, Rating, type CardInput } from 'ts-fsrs';
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

type Progress = {
  cards: Array<{ word_id: string; direction: Direction; version: number; fsrs: CardInput }>;
  grades: Array<{ request_id: string; fsrsLog: { rating: number } | null }>;
  undos: Array<{ grade_sequence: number }>;
};

const stores: Store[] = [];
const directories: string[] = [];
let requestSequence = 0;

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(at = new Date(2026, 8, 21, 10)) {
  const directory = mkdtempSync(join(tmpdir(), 'echo-store-'));
  directories.push(directory);
  const dbPath = join(directory, 'nested', 'echo.db');
  const clock = { value: at };
  const open = () => {
    const store = createStore(words, { dbPath, now: () => new Date(clock.value) });
    stores.push(store);
    return store;
  };
  return { store: open(), open, clock };
}

function answer(snapshot: Snapshot, known: boolean, requestId = `answer-${++requestSequence}`): GradeInput {
  if (!snapshot.current) throw new Error('Test expected an active card.');
  return { direction: snapshot.direction, deck: snapshot.deck, wordId: snapshot.current.id, version: snapshot.current.version, known, requestId };
}

function progress(store: Store): Progress {
  return store.exportData() as Progress;
}

function expectConflict(action: () => unknown): void {
  let error: unknown;
  try { action(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(StoreError);
  expect((error as StoreError).status).toBe(409);
}

describe('daily admission and selected-deck state', () => {
  test('GET is read-only and 04:00 renews only one daily allowance, without catch-up', () => {
    const { store, clock } = fixture(new Date(2026, 8, 21, 3, 59));
    store.setSettings(1);
    const before = store.exportData();
    expect(store.state('fr-en', 'all').stats.newAvailable).toBe(1);
    expect(store.state('fr-en', 'all').current).toBeNull();
    expect(store.exportData()).toEqual(before);
    let state = store.start('fr-en', 'all');
    expect(state.day).toBe('2026-09-20');
    expect(state.stats.introducedToday).toBe(1);
    expect(store.start('fr-en', 'all').stats.remaining).toBe(1);

    clock.value = new Date(2026, 8, 21, 4);
    state = store.state('fr-en', 'all');
    expect(state.day).toBe('2026-09-21');
    expect(state.stats.introducedToday).toBe(0);
    expect(state.stats.remaining).toBe(1);
    expect(state.stats.newAvailable).toBe(1);
    state = store.start('fr-en', 'all');
    expect(state.stats.remaining).toBe(2);
    expect(state.stats.introducedToday).toBe(1);

    clock.value = new Date(2026, 8, 28, 4);
    state = store.start('fr-en', 'all');
    expect(state.stats.introducedToday).toBe(1);
    expect(state.stats.remaining).toBe(3);
    expect(state.stats.unseen).toBe(5);
  });

  test('filters share one admission budget while directions have independent memory and budgets', () => {
    const { store } = fixture();
    store.setSettings(2);
    const food = store.start('fr-en', 'food');
    expect(food.stats).toMatchObject({ total: 4, unseen: 2, introducedToday: 2, remaining: 2 });
    const travel = store.start('fr-en', 'travel');
    expect(travel.stats).toMatchObject({ total: 4, unseen: 4, introducedToday: 2, newAvailable: 0, remaining: 0 });
    expect(travel.overview).toMatchObject({ total: 8, remaining: 2, practised: 0 });
    expect(travel.current).toBeNull();
    expect(store.state('fr-en', 'all').stats.remaining).toBe(2);
    expect(store.start('en-fr', 'travel').stats).toMatchObject({ introducedToday: 2, remaining: 2 });
    store.grade(answer(food, true));
    expect(store.state('en-fr', 'travel').current?.successes).toBe(0);
    expect(store.state('fr-en', 'travel').overview.practised).toBe(1);
    expect(store.state('en-fr', 'travel').overview.practised).toBe(0);
    expect(store.browse('en-fr', 'food').every((word) => word.status === 'new')).toBe(true);
  });

  test('coverage counts actual practice, not admission, and undo restores coverage and completion', () => {
    const { store } = fixture();
    store.setSettings(1);
    let state = store.start('fr-en', 'all');
    expect(state.overview).toMatchObject({ practised: 0, remaining: 1, completedToday: 0, recallProgress: 0 });
    state = store.grade(answer(state, false));
    expect(state.overview.practised).toBe(1);
    state = store.undo('fr-en', 'all', state.undoId!);
    expect(state.overview).toMatchObject({ practised: 0, remaining: 1, completedToday: 0 });
    state = store.grade(answer(state, true));
    expect(state.overview).toMatchObject({ practised: 1, scheduled: 0, completedToday: 0, recallProgress: 1 });
    state = store.grade(answer(state, true));
    expect(state.overview).toMatchObject({ practised: 1, scheduled: 1, remaining: 0, completedToday: 1, recallProgress: 2 });
    state = store.undo('fr-en', 'all', state.undoId!);
    expect(state.overview).toMatchObject({ practised: 1, scheduled: 0, remaining: 1, completedToday: 0, recallProgress: 1 });
    expect(state.current?.successes).toBe(1);
    state = store.grade(answer(state, false));
    expect(state.overview).toMatchObject({ practised: 1, recallProgress: 0, completedToday: 0 });
  });

  test('lowering allowance retains cards; zero is review-only; raising it admits only the difference', () => {
    const { store, clock } = fixture();
    store.setSettings(3);
    store.start('fr-en', 'all');
    store.setSettings(1);
    expect(store.start('fr-en', 'all').stats).toMatchObject({ introducedToday: 3, newAvailable: 0, remaining: 3 });
    store.setSettings(0);
    clock.value = new Date(2026, 8, 22, 10);
    expect(store.start('fr-en', 'all').stats).toMatchObject({ introducedToday: 0, newAvailable: 0, remaining: 3 });
    store.setSettings(2);
    expect(store.start('fr-en', 'all').stats).toMatchObject({ introducedToday: 2, remaining: 5 });
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

describe('practice cycles and FSRS memory', () => {
  test('interleaves cards, resets on a miss and schedules exactly once using the whole cycle outcome', () => {
    const { store, clock } = fixture();
    store.setSettings(2);
    let state = store.start('fr-en', 'all');
    const initial = progress(store).cards;
    expect(state.current?.id).toBe('food-001');
    state = store.grade(answer(state, true));
    expect(state.current?.id).toBe('travel-001');
    expect(progress(store).cards.find((card) => card.word_id === 'food-001')?.fsrs).toEqual(initial[0].fsrs);
    state = store.grade(answer(state, true));
    expect(state.current).toMatchObject({ id: 'food-001', successes: 1 });
    state = store.grade(answer(state, false));
    expect(state.current).toMatchObject({ id: 'travel-001', successes: 1 });
    state = store.grade(answer(state, true));
    expect(state.current).toMatchObject({ id: 'food-001', successes: 0 });
    expect(state.stats.completedToday).toBe(1);
    state = store.grade(answer(state, true));
    expect(state.current?.successes).toBe(1);
    state = store.grade(answer(state, true));
    expect(state.current).toBeNull();
    expect(state.stats).toMatchObject({ completedToday: 2, remaining: 0, unseen: 6, newAvailable: 0 });
    const exported = progress(store);
    expect(exported.grades.filter((grade) => grade.fsrsLog).map((grade) => grade.fsrsLog!.rating)).toEqual([Rating.Good, Rating.Again]);
    expect(exported.cards.map((card) => card.fsrs.reps)).toEqual([1, 1]);
    const expected = fsrs({ enable_short_term: false, enable_fuzz: false }).next(initial[0].fsrs, clock.value, Rating.Again);
    expect(exported.cards.find((card) => card.word_id === 'food-001')?.fsrs).toEqual(JSON.parse(JSON.stringify(expected.card)));
    const tomorrow = new Date(2026, 8, 22, 4);
    expect(new Date(state.nextDue!).getTime()).toBeGreaterThanOrEqual(tomorrow.getTime());
    expect(store.browse('fr-en', 'all').filter((word) => word.status === 'scheduled')).toHaveLength(2);
    expect(store.browse('fr-en', 'all').filter((word) => word.status === 'new')).toHaveLength(6);
  });

  test('partial successes and misses survive reopen and missed days without applying FSRS early', () => {
    const { store, open, clock } = fixture();
    store.setSettings(1);
    let state = store.start('fr-en', 'food');
    state = store.grade(answer(state, false));
    state = store.grade(answer(state, true));
    const originalVersion = state.current!.version;
    expect(progress(store).cards[0].fsrs.reps).toBe(0);
    store.close();
    stores.splice(stores.indexOf(store), 1);
    clock.value = new Date(2026, 8, 25, 10);
    const reopened = open();
    state = reopened.state('fr-en', 'food');
    expect(state.current).toMatchObject({ id: 'food-001', successes: 1, version: originalVersion });
    expect(state.stats.introducedToday).toBe(0);
    state = reopened.grade(answer(state, true));
    expect(state.current).toBeNull();
    expect(progress(reopened).grades.at(-1)?.fsrsLog?.rating).toBe(Rating.Again);
    expect(progress(reopened).cards[0].fsrs.reps).toBe(1);
  });

  test('future scheduled words are not new, and due cards become current without a GET write', () => {
    const { store, clock } = fixture();
    store.setSettings(1);
    let state = store.start('fr-en', 'food');
    state = store.grade(answer(state, true));
    state = store.grade(answer(state, true));
    expect(state.stats.unseen).toBe(3);
    expect(state.stats.remaining).toBe(0);
    expect(state.overview).toMatchObject({ practised: 1, scheduled: 1, completedToday: 1 });
    expect(state.nextDue).not.toBeNull();
    const dueAt = new Date(state.nextDue!);
    clock.value = new Date(dueAt.getTime() - 1);
    expect(store.state('fr-en', 'food').current).toBeNull();
    clock.value = dueAt;
    const before = store.exportData();
    state = store.state('fr-en', 'food');
    expect(state.current).toMatchObject({ id: 'food-001', successes: 0, stage: 'review' });
    expect(state.stats).toMatchObject({ due: 1, learning: 0, remaining: 1, unseen: 3 });
    expect(state.overview).toMatchObject({ practised: 1, scheduled: 0, due: 1, completedToday: 0 });
    expect(state.nextDue).toBeNull();
    expect(store.exportData()).toEqual(before);
    state = store.grade(answer(state, true));
    expect(state.current?.successes).toBe(1);
    expect(progress(store).cards[0].fsrs.reps).toBe(1);
    state = store.grade(answer(state, true));
    expect(state.current).toBeNull();
    expect(progress(store).cards[0].fsrs.reps).toBe(2);
  });
});

describe('transactional grade and undo protection', () => {
  test('duplicate requests across connections are idempotent; reused IDs, stale versions and non-current cards reject', () => {
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

  test('undo restores completed scheduling and FSRS exactly, retains history, and invalidates stale versions', () => {
    const { store } = fixture();
    store.setSettings(1);
    let state = store.start('fr-en', 'food');
    state = store.grade(answer(state, true));
    const beforeCompletion = progress(store).cards[0].fsrs;
    const completion = answer(state, true);
    state = store.grade(completion);
    const scheduled = progress(store).cards[0].fsrs;
    expect(state.current).toBeNull();
    expect(state.stats.completedToday).toBe(1);
    state = store.undo('fr-en', 'food', state.undoId!);
    expect(state.current).toMatchObject({ id: 'food-001', successes: 1 });
    expect(state.current!.version).toBeGreaterThan(completion.version + 1);
    expect(state.stats).toMatchObject({ completedToday: 0, remaining: 1 });
    expect(state.nextDue).toBeNull();
    expect(progress(store).cards[0].fsrs).toEqual(beforeCompletion);
    expect(progress(store).grades).toHaveLength(2);
    expect(progress(store).undos).toHaveLength(1);
    expect(store.grade(completion)).toEqual(state);
    expectConflict(() => store.grade({ ...completion, requestId: 'pre-undo-stale' }));
    expectConflict(() => store.undo('fr-en', 'food', completion.requestId));
    state = store.grade(answer(state, true));
    expect(state.current).toBeNull();
    expect(progress(store).cards[0].fsrs).toEqual(scheduled);
    expect(progress(store).grades).toHaveLength(3);
  });

  test('undo is latest-per-direction across filters and restores the queue without affecting the reverse direction', () => {
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
    state = store.undo('fr-en', 'all', second.requestId);
    expect(state.current).toMatchObject({ id: 'travel-001', successes: 0 });
    state = store.undo('fr-en', 'all', first.requestId);
    expect(state.current).toMatchObject({ id: 'food-001', successes: 0 });
    expect(state.undoId).toBeNull();
    expect(store.state('en-fr', 'all')).toEqual(reverse);
    expect(progress(store).grades).toHaveLength(3);
    expect(progress(store).undos).toHaveLength(2);
  });
});
