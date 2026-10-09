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
  test('first introduces ten, then serves seen words with misses ahead of successes', () => {
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
    expect(served.filter((stack) => stack === 'unseen').length).toBeGreaterThanOrEqual(4);
    expect(served.filter((stack) => stack === 'failed').length).toBeGreaterThan(served.filter((stack) => stack === 'successful').length);
  });

  test('new words take a smaller share of turns as the seen pile grows, and never stop', () => {
    const many: Word[] = Array.from({ length: 150 }, (_, index) => ({ id: `many-${index}`, fr: `mot ${index}`, en: `word ${index}`, category: 'daily' }));
    const { store } = fixture(undefined, many);
    store.setSettings(many.length);
    let state = store.start('fr-en', 'all');
    const newIn = (turns: number) => {
      let fresh = 0;
      for (let index = 0; index < turns; index++) {
        if (state.current!.stack === 'unseen') fresh++;
        state = store.grade(answer(state, false));
      }
      return fresh;
    };
    // Every answer is a miss, so the seen pile only grows.
    newIn(10);
    const small = newIn(20);
    while (state.stats.seenActive < 70) state = store.grade(answer(state, false));
    const large = newIn(20);
    expect(small).toBeGreaterThanOrEqual(7);
    expect(large).toBeLessThanOrEqual(5);
    expect(large).toBeGreaterThan(0);
  });

  test('a word answered right waits until the rest of the seen pile has had a turn, even filed at the front', () => {
    const many: Word[] = Array.from({ length: 150 }, (_, index) => ({ id: `spaced-${index}`, fr: `mot ${index}`, en: `word ${index}`, category: 'daily' }));
    const { store, randomness } = fixture(undefined, many);
    // Every answered word is filed at the front of its stack: the case where it used to come straight back.
    randomness.value = 0;
    store.setSettings(many.length);
    let state = store.start('fr-en', 'all');
    const shown = new Map<string, number>();
    const successGaps: number[] = [];
    const answered = new Map<string, boolean>();
    for (let turn = 0; turn < 300 && state.current; turn++) {
      const { id } = state.current;
      const piled = state.stats.seenActive >= 30;
      if (shown.has(id) && piled && answered.get(id)) successGaps.push(turn - shown.get(id)! - 1);
      // Two misses to every success keeps the seen pile large.
      const known = turn % 3 === 0;
      shown.set(id, turn); answered.set(id, known);
      state = store.grade(answer(state, known));
    }
    expect(successGaps.length).toBeGreaterThan(10);
    expect(Math.min(...successGaps)).toBeGreaterThanOrEqual(28);
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

  test('an answered word waits for three others, then a miss placed at the front beats older misses', () => {
    const { store, randomness } = fixture(undefined, thirtyWords);
    randomness.value = 0.999999;
    let state = store.start('fr-en', 'all');
    for (let index = 0; index < 10; index++) state = store.grade(answer(state, false));
    const served: string[] = [];
    let frontMiss: string | null = null;
    let sinceMiss = 0;
    for (let step = 0; step < 40 && state.current; step++) {
      const { id, stack } = state.current;
      // The reported bug: a word shown again straight after it was answered.
      expect(served.slice(-3)).not.toContain(id);
      if (frontMiss && stack === 'failed' && sinceMiss >= 3) {
        expect(id).toBe(frontMiss);
        frontMiss = null;
      }
      served.push(id);
      sinceMiss++;
      if (stack === 'failed' && !frontMiss) {
        randomness.value = 0;
        state = store.grade(answer(state, false));
        randomness.value = 0.999999;
        frontMiss = id;
        sinceMiss = 0;
      } else {
        state = store.grade(answer(state, true));
      }
    }
  });

  test('with a single word left, a miss still brings it back rather than ending the session', () => {
    const { store } = fixture(undefined, thirtyWords.slice(0, 1));
    let state = store.start('fr-en', 'all');
    const id = state.current!.id;
    state = store.grade(answer(state, false));
    expect(state.current?.id).toBe(id);
  });

  test('the predicted next card is the one that follows, whether the word was known or missed', () => {
    const { store } = fixture(undefined, thirtyWords);
    let state = store.start('fr-en', 'all');
    let predicted = 0;
    for (let step = 0; step < 40 && state.current; step++) {
      const next = state.next;
      state = store.grade(answer(state, step % 3 !== 0));
      if (!next) continue;
      predicted++;
      expect({ id: state.current?.id, version: state.current?.version }).toEqual({ id: next.id, version: next.version });
    }
    expect(predicted).toBeGreaterThan(30);
  });

  test('the cards predicted after next are the ones that come, however the answers go', () => {
    const { store } = fixture(undefined, thirtyWords);
    const pattern = [true, false, false, true, true, true, false, true, false, false, true];
    const states = [store.start('fr-en', 'all')];
    const known: boolean[] = [];
    for (let step = 0; step < 60 && states.at(-1)!.current; step++) {
      known.push(pattern[step % pattern.length]!);
      states.push(store.grade(answer(states.at(-1)!, known.at(-1)!)));
    }
    const card = (view: Snapshot['current'] | undefined) => view ? { id: view.id, version: view.version } : null;
    const how = (value: boolean) => (value ? 'known' : 'missed');
    let checked = 0;
    for (let index = 0; index + 3 < states.length; index++) {
      const ahead = states[index]!.ahead?.[how(known[index]!)];
      if (ahead?.card) { checked++; expect(card(states[index + 2]!.current)).toEqual(card(ahead.card)); }
      const after = ahead?.after?.[how(known[index + 1]!)];
      if (after) { checked++; expect(card(states[index + 3]!.current)).toEqual(card(after)); }
    }
    expect(checked).toBeGreaterThan(80);
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

describe('Walkman scores', () => {
  test('a recall raises a score, a miss lowers it more, a listen raises it a little, and every point halves in 21 days', () => {
    const { store, clock } = fixture(undefined, thirtyWords);
    store.setSettings(3);
    let state = store.start('fr-en', 'all');
    const recalled = state.current!.id;
    state = store.grade(answer(state, true));
    const missed = state.current!.id;
    state = store.grade(answer(state, false));
    const undone = state.current!.id;
    state = store.grade(answer(state, true));
    store.undo('fr-en', 'all', state.undoId!);
    store.recordHeard({ wordId: 'word-20', requestId: 'heard-a' });
    store.recordHeard({ wordId: 'word-20', requestId: 'heard-a' });
    store.recordHeard({ wordId: 'word-21', requestId: 'heard-b' });
    store.recordHeard({ wordId: 'word-21', requestId: 'heard-c' });
    const scores = () => new Map(store.listening().map((word) => [word.id, word.score]));
    let now = scores();
    expect([now.get(recalled), now.get(missed), now.get(undone), now.get('word-20'), now.get('word-21'), now.get('word-29')]).toEqual([2, -3, 0, 0.5, 1, 0]);
    clock.value = new Date(clock.value.getTime() + 21 * 86400000);
    now = scores();
    expect([now.get(recalled), now.get(missed), now.get('word-21')]).toEqual([1, -1.5, 0.5]);
  });

  test('a listen report for a word outside the deck is refused', () => {
    const { store } = fixture(undefined, thirtyWords);
    expect(() => store.recordHeard({ wordId: 'nope', requestId: 'x' })).toThrow(StoreError);
  });

  test('marking a listen counts like a recall or a miss, a changed mark replaces it, and a withdrawn one is gone', () => {
    const { store } = fixture(undefined, thirtyWords);
    const score = (id: string) => store.listening().find((word) => word.id === id)!.score;
    store.recordVerdict({ id: 'mark-a', wordId: 'word-20', knew: true });
    store.recordVerdict({ id: 'mark-b', wordId: 'word-21', knew: true });
    store.recordVerdict({ id: 'mark-b', wordId: 'word-21', knew: false });
    store.recordVerdict({ id: 'mark-c', wordId: 'word-22', knew: false });
    store.recordVerdict({ id: 'mark-c', wordId: 'word-22', knew: null });
    expect([score('word-20'), score('word-21'), score('word-22')]).toEqual([2, -3, 0]);
    // A mark id belongs to one word: reusing it for another word changes nothing.
    store.recordVerdict({ id: 'mark-a', wordId: 'word-23', knew: false });
    expect([score('word-20'), score('word-23')]).toEqual([2, 0]);
  });

  test('an incomplete mark is refused', () => {
    const { store } = fixture(undefined, thirtyWords);
    expect(() => store.recordVerdict({ id: '', wordId: 'word-20', knew: true })).toThrow(StoreError);
    expect(() => store.recordVerdict({ id: 'x', wordId: 'word-20', knew: 'yes' as never })).toThrow(StoreError);
    expect(() => store.recordVerdict({ id: 'x', wordId: 'nope', knew: true })).toThrow(StoreError);
  });
});

describe('Statistics', () => {
  test('answers fall on study days that start at 04:00, undone answers are left out, and every word is counted once', () => {
    const { store, clock } = fixture(new Date(2026, 8, 21, 10));
    let state = store.start('fr-en', 'all');
    state = store.grade(answer(state, true));
    state = store.grade(answer(state, false));
    state = store.grade(answer(state, true));
    store.undo('fr-en', 'all', state.undoId!);
    clock.value = new Date(2026, 8, 22, 3, 30);
    state = store.state('fr-en', 'all');
    state = store.grade(answer(state, true));
    clock.value = new Date(2026, 8, 23, 9);
    state = store.start('fr-en', 'all');
    store.grade(answer(state, false));
    const stats = store.statistics();
    const day = (value: string) => stats.days.find((entry) => entry.day === value);
    expect(stats.days).toHaveLength(14);
    expect(stats.days.at(-1)!.day).toBe('2026-09-23');
    // Every miss here is a word's first answer: a word at its lowest loses nothing (lib/score-points.ts).
    expect([day('2026-09-21'), day('2026-09-22'), day('2026-09-23')]).toEqual([
      { day: '2026-09-21', knew: 2, missed: 1, gained: 4, lost: 0 },
      { day: '2026-09-22', knew: 0, missed: 0, gained: 0, lost: 0 },
      { day: '2026-09-23', knew: 0, missed: 1, gained: 0, lost: 0 },
    ]);
    expect(Object.values(stats.counts).reduce((sum, count) => sum + count, 0)).toBe(words.length);
    expect(stats.words.length).toBe(words.length - stats.counts.new);
    expect(stats.words.map((word) => word.score)).toEqual([...stats.words.map((word) => word.score)].sort((a, b) => a - b));
    const started = new Map(stats.categories.map((category) => [category.id, category.started]));
    expect(started.get('food')! + started.get('travel')!).toBe(stats.words.length);
    expect(stats.categories.every((category) => category.total === 4)).toBe(true);
  });
});

describe('Words added from a song', () => {
  const song = { category: 'song-rain-song', title: 'Rain song', words: [{ fr: 'la pluie', en: 'rain', note: '' }, { fr: 'chanter', en: 'to sing' }, { fr: 'le ciel', en: 'sky' }] };
  const introduced = (snapshot: Snapshot) => snapshot.stats.unseen;

  test('get a deck of their own, survive reopening, and go first when songs come first', () => {
    const { store, open } = fixture();
    const made = store.addWords(song);
    expect(made.map((word) => word.id)).toEqual(['song-rain-song-001', 'song-rain-song-002', 'song-rain-song-003']);
    expect(made[0].note).toBeUndefined();
    store.setSettings(2);
    let state = store.start('fr-en', 'all');
    expect(state.decks.find((deck) => deck.id === 'song-rain-song')).toEqual({ id: 'song-rain-song', title: 'Rain song', count: 3 });
    expect(state.overview.total).toBe(words.length + 3);
    const again = open();
    state = again.start('fr-en', 'song-rain-song');
    expect(state.stats.introducedToday).toBe(2);
    expect(new Set(again.browse('fr-en', 'all').filter((word) => word.status !== 'new').map((word) => word.id))).toEqual(new Set(['song-rain-song-001', 'song-rain-song-002']));
    expect(introduced(state)).toBeGreaterThanOrEqual(0);
  });

  test('mixed in, a song takes one turn in each round of categories', () => {
    const { store } = fixture();
    store.addWords(song);
    expect(store.setSongsFirst(false).songsFirst).toBe(false);
    store.setSettings(3);
    store.start('fr-en', 'all');
    const started = store.browse('fr-en', 'all').filter((word) => word.status !== 'new').map((word) => word.category);
    expect(started.sort()).toEqual(['food', 'song-rain-song', 'travel']);
  });

  test('wait until their recording is ready', () => {
    const readyIds = new Set<string>();
    const directory = mkdtempSync(join(tmpdir(), 'echo-store-'));
    directories.push(directory);
    const store = createStore(words, { dbPath: join(directory, 'echo.db'), now: () => new Date(2026, 8, 21, 10), ready: (id) => readyIds.has(id) });
    stores.push(store);
    const [first] = store.addWords(song);
    store.setSettings(1);
    const songDeck = store.start('fr-en', 'song-rain-song');
    expect([songDeck.current, songDeck.stats.recording, songDeck.stats.newAvailable]).toEqual([null, 3, 0]);
    store.start('fr-en', 'all');
    expect(store.browse('fr-en', 'all').filter((word) => word.status !== 'new').map((word) => word.category)).not.toContain('song-rain-song');
    readyIds.add(first.id);
    store.addExtraWords({ direction: 'fr-en', deck: 'all', count: 1, requestId: 'more-1' });
    expect(store.browse('fr-en', 'all').filter((word) => word.status !== 'new').map((word) => word.id)).toContain(first.id);
  });

  test('a deck word waits for its recording too', () => {
    const readyIds = new Set<string>();
    const directory = mkdtempSync(join(tmpdir(), 'echo-store-'));
    directories.push(directory);
    const store = createStore(words, { dbPath: join(directory, 'echo.db'), now: () => new Date(2026, 8, 21, 10), ready: (id) => readyIds.has(id) });
    stores.push(store);
    store.setSettings(2);
    const none = store.start('fr-en', 'all');
    expect([none.current, none.stats.recording, none.stats.newAvailable]).toEqual([null, words.length, 0]);
    readyIds.add(words[3]!.id);
    store.addExtraWords({ direction: 'fr-en', deck: 'all', count: 2, requestId: 'more-deck' });
    expect(store.browse('fr-en', 'all').filter((word) => word.status !== 'new').map((word) => word.id)).toEqual([words[3]!.id]);
  });

  test('refuse a category that is not a song, and an empty word', () => {
    const { store } = fixture();
    expect(() => store.addWords({ ...song, category: 'food' })).toThrow(StoreError);
    expect(() => store.addWords({ ...song, words: [{ fr: ' ', en: 'x' }] })).toThrow(StoreError);
  });

  test('a word added twice keeps its practised copy and loses the unpractised one when Echo next starts', () => {
    const { store, open } = fixture();
    const [first] = store.addWords({ category: 'song-one', title: 'One', words: [{ fr: 'la pluie', en: 'rain' }] });
    const [second] = store.addWords({ category: 'song-two', title: 'Two', words: [{ fr: 'la pluie', en: 'rain' }, { fr: 'le ciel', en: 'sky' }] });
    store.setSettings(1);
    store.start('fr-en', 'song-two');
    expect(store.browse('fr-en', 'song-two').find((word) => word.id === second.id)!.status).not.toBe('new');
    const again = open();
    expect(again.word(first.id)).toBeUndefined();
    expect(again.word(second.id)?.fr).toBe('la pluie');
    expect(again.words().filter((word) => word.fr === 'la pluie')).toHaveLength(1);
    expect(again.addedIds()).toHaveLength(2);
  });
});

test('a word missed six times shows the words of its deck missed most with it; deck counts split today from waiting', () => {
  const { store } = fixture();
  let snapshot = store.start('fr-en', 'food');
  let troubled = snapshot.current;
  for (let turn = 0; turn < 80 && !troubled?.trouble; turn++) { snapshot = store.grade(answer(snapshot, false)); troubled = snapshot.current; }
  const trouble = troubled!.trouble!;
  expect(trouble.misses).toBeGreaterThanOrEqual(6);
  expect(trouble.alongside.length).toBeGreaterThan(0);
  for (const word of trouble.alongside) expect(words.find((entry) => entry.fr === word.fr)?.category).toBe('food');
  expect(trouble.alongside.map((word) => word.fr)).not.toContain(troubled!.fr);
  const counts = store.deckCounts('fr-en');
  expect(counts.travel).toEqual({ today: 0, waiting: 4 });
  expect(counts.food!.today).toBeGreaterThan(0);
  expect(counts.food!.today + counts.food!.waiting).toBe(4);
});

test('the store gives each noun its gender, by French rules when no others are given', () => {
  const { store } = fixture();
  expect(store.word('food-002')).toMatchObject({ fr: "l'eau" });
  expect(store.word('food-001')!.gender).toBe('masculine');
});

test('a stubborn word waits for a memory hook, then shows it on its card and waits no more', () => {
  const { store } = fixture();
  let snapshot = store.start('fr-en', 'food');
  for (let turn = 0; turn < 80 && !snapshot.current?.trouble; turn++) snapshot = store.grade(answer(snapshot, false));
  const stubborn = snapshot.current!;
  const waiting = store.hookless();
  expect(waiting.map((word) => word.id)).toContain(stubborn.id);
  expect(waiting.find((word) => word.id === stubborn.id)!.alongside.length).toBeGreaterThan(0);
  store.setHooks([{ wordId: stubborn.id, hook: 'Pain sounds like pan: bread baked in a pan.' }]);
  expect(store.hookless().map((word) => word.id)).not.toContain(stubborn.id);
  expect(store.state('fr-en', 'food').current?.trouble?.hook ?? store.state('fr-en', 'food').next?.trouble?.hook).toBeDefined();
});

describe('song decks holding words already in Echo', () => {
  test('with songs first, a song’s known-but-unstarted words come in with its new words, before other new words', () => {
    const directory = mkdtempSync(join(tmpdir(), 'echo-store-'));
    directories.push(directory);
    const store = createStore(thirtyWords, { dbPath: join(directory, 'echo.db'), now: () => new Date(2026, 8, 21, 10) });
    stores.push(store);
    store.setSettings(3);
    const [made] = store.addWords({ category: 'song-la-pluie', title: 'La pluie', words: [{ fr: 'la pluie', en: 'rain' }] });
    expect(store.linkWords({ category: 'song-la-pluie', title: 'La pluie', ids: ['word-29', 'word-20', 'missing'] })).toEqual(['word-29', 'word-20']);
    store.start('fr-en', 'all');
    const admitted = (store.exportData() as { cards: { word_id: string; direction: string }[] }).cards.filter((card) => card.direction === 'fr-en').map((card) => card.word_id).toSorted();
    expect(admitted).toEqual([made!.id, 'word-20', 'word-29'].toSorted());
    expect(store.state('fr-en', 'all').decks.find((entry) => entry.id === 'song-la-pluie')?.count).toBe(3);
    expect(store.state('fr-en', 'all').decks.find((entry) => entry.id === 'all')?.count).toBe(31);
  });
});

describe('word families in admission', () => {
  test('up to half of a day’s new words are relatives of started words; unstarted families wait', () => {
    const vocabulary: Word[] = ['a', 'b'].flatMap((category) => Array.from({ length: 8 }, (_, index) => ({ id: `${category}-${index}`, fr: `mot ${category}${index}`, en: `word ${category}${index}`, category })));
    const directory = mkdtempSync(join(tmpdir(), 'echo-store-'));
    directories.push(directory);
    const clock = { value: new Date(2026, 8, 21, 10) };
    const store = createStore(vocabulary, { dbPath: join(directory, 'echo.db'), now: () => new Date(clock.value), families: [['a-0', 'a-5'], ['b-0', 'b-7'], ['a-3', 'b-3']] });
    stores.push(store);
    store.setSettings(2);
    const admitted = (day: string) => (store.exportData() as { cards: { word_id: string; direction: string; introduced_day: string }[] }).cards.filter((card) => card.direction === 'fr-en' && card.introduced_day === day).map((card) => card.word_id).toSorted();
    store.start('fr-en', 'all');
    expect(admitted('2026-09-21')).toEqual(['a-0', 'a-1']);
    clock.value = new Date(2026, 8, 22, 10);
    store.start('fr-en', 'all');
    // a-0's relative, then the next word in the usual order; b-7 and the unstarted a-3/b-3 family wait.
    expect(admitted('2026-09-22')).toEqual(['a-2', 'a-5']);
  });
});

describe('score history', () => {
  test('a past day shows the chart exactly as it stood at the end of that day, and its words agree', () => {
    const { store, clock } = fixture(new Date(2026, 8, 21, 10), thirtyWords);
    store.setSettings(6);
    let state = store.start('fr-en', 'all');
    // Four of the six introduced words answered: the other two are started but not yet answered.
    for (let index = 0; index < 4; index++) state = store.grade(answer(state, index !== 1));
    store.recordHeard({ wordId: 'word-29', requestId: 'heard-once' });
    clock.value = new Date(2026, 8, 22, 3, 59, 59, 999);
    const endOfFirst = store.statistics().history.at(-1)!;
    expect(endOfFirst).toMatchObject({ day: '2026-09-21', learning: 6 });
    clock.value = new Date(2026, 8, 22, 10);
    state = store.start('fr-en', 'all');
    while (state.current) state = store.grade(answer(state, true));
    clock.value = new Date(2026, 8, 23, 3, 59, 59, 999);
    const endOfSecond = store.statistics().history.at(-1)!;
    clock.value = new Date(2026, 8, 25, 12);
    const { history } = store.statistics();
    expect(history.map((day) => day.day)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
    expect(history[0]).toEqual(endOfFirst);
    expect(history[1]).toEqual(endOfSecond);
    // A day with nothing done keeps the words, their scores fading towards the middle.
    expect(history[3]!.know).toBe(history[1]!.know);
    const day = store.statisticsDay('2026-09-21');
    expect(day.words.filter((word) => word.known)).toHaveLength(endOfFirst.know);
    expect(day.words.filter((word) => !word.known)).toHaveLength(endOfFirst.learning);
    expect(() => store.statisticsDay('2026-09-25')).toThrow(StoreError);
    expect(() => store.statisticsDay('2026-09-20')).toThrow(StoreError);
  });
});

describe('endless', () => {
  test('picks only started words, the hard ones far more often, passes over recent ones, and leaves the daily stacks alone', () => {
    const { store, randomness } = fixture();
    let state = store.start('fr-en', 'all');
    const answeredIds = new Set<string>();
    for (let turn = 0; turn < 4; turn++) { answeredIds.add(state.current!.id); state = store.grade(answer(state, true)); }
    const started = [...answeredIds];
    // Admitted today but never shown: not started.
    const fresh = words.find((word) => !answeredIds.has(word.id))!.id;
    expect(started.length).toBeGreaterThanOrEqual(3);
    const [hard, easy] = started as [string, string];
    for (let mark = 0; mark < 6; mark++) {
      store.endlessMark({ requestId: `hard-${mark}`, direction: 'fr-en', wordId: hard, known: false });
      store.endlessMark({ requestId: `easy-${mark}`, direction: 'fr-en', wordId: easy, known: true });
    }
    const daily = JSON.stringify(store.state('fr-en', 'all').stats);
    const picks = Array.from({ length: 200 }, (_, index) => { randomness.value = (index + 0.5) / 200; return store.endlessNext({ direction: 'fr-en', deck: 'all' }); });
    expect(picks.every((pick) => started.includes(pick.card!.id) && pick.pool === started.length)).toBe(true);
    const count = (id: string) => picks.filter((pick) => pick.card!.id === id).length;
    expect(count(hard)).toBeGreaterThan(4 * Math.max(1, count(easy)));
    for (const value of [0.01, 0.5, 0.99]) {
      randomness.value = value;
      expect(store.endlessNext({ direction: 'fr-en', deck: 'all', exclude: [hard] }).card!.id).not.toBe(hard);
    }
    // With every word passed over, one still comes.
    expect(started).toContain(store.endlessNext({ direction: 'fr-en', deck: 'all', exclude: started }).card!.id);
    expect(JSON.stringify(store.state('fr-en', 'all').stats)).toBe(daily);
    expectStatus(() => store.endlessMark({ requestId: 'new', direction: 'fr-en', wordId: fresh, known: true }), 400);
  });

  test('a mark moves the score by one, a retried mark counts once, and undo takes it back', () => {
    const { store } = fixture();
    let state = store.start('fr-en', 'all');
    const id = state.current!.id;
    state = store.grade(answer(state, true));
    const score = () => store.listening().find((word) => word.id === id)!.score;
    const before = score();
    store.endlessMark({ requestId: 'm1', direction: 'fr-en', wordId: id, known: true });
    store.endlessMark({ requestId: 'm1', direction: 'fr-en', wordId: id, known: true });
    expect(score()).toBeCloseTo(before + 1, 3);
    store.endlessMark({ requestId: 'm2', direction: 'fr-en', wordId: id, known: false });
    expect(score()).toBeCloseTo(before, 3);
    store.endlessUndo('m2');
    expect(score()).toBeCloseTo(before + 1, 3);
  });
});
