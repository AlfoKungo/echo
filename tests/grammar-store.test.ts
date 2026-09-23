import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GrammarExercise, GrammarExerciseType, GrammarMutation, GrammarSnapshot, GrammarTopicContent, GrammarUnitContent, Word } from '../contract';
import { loadCourse, type Course } from '../lib/grammar-content';
import { createGrammarStore, type GrammarStore } from '../lib/grammar-store';
import { createStore, StoreError, type Store } from '../lib/store';

const SHAPES: Record<GrammarExerciseType, Pick<GrammarExercise, 'source' | 'answers' | 'tokens' | 'options'>> = {
  rewrite: { source: 'Je parle.', answers: ['Je ne parle pas.'] },
  build: { source: 'Tu aimes le thé.', tokens: ['Tu', 'n’aimes', 'pas', 'le', 'thé.', 'ne'], answers: ['Tu n’aimes pas le thé.'] },
  complete: { source: 'Elle ____ française.', answers: ['est'] },
  repair: { source: 'Il habite Paris.', answers: ['Il habite à Paris.'] },
  choose: { source: 'Tu ____ ici.', options: ['es', 'est', 'êtes'], answers: ['es'] },
  translate: { source: 'I am here.', answers: ['Je suis ici.'] },
  conjugate: { source: 'finir · nous · présent', answers: ['finissons', 'nous finissons'] },
};

function exercise(id: string, pattern: string, type: GrammarExerciseType, extra: Partial<GrammarExercise> = {}): GrammarExercise {
  return { id, pattern, type, instruction: `Answer ${id}.`, hint: `Hint for ${id}.`, feedback: `Nudge for ${id}.`, explanation: `Why ${id} works.`, ...SHAPES[type], ...extra };
}

function topic(id: string, unit: string, exercises: GrammarExercise[]): GrammarTopicContent {
  return { id, unit, level: 'A1', title: `Topic ${id}`, description: `Practise ${id}.`, mark: id.slice(0, 2), rule: `The rule of ${id}.`, example: 'Je ne parle pas. · Il est ici.', aside: '', exercises };
}

// Alpha lists its patterns in blocks, so taking exercises in file order would break the per-pattern cap.
const alphaPlan: [string, GrammarExerciseType[]][] = [
  ['p1', ['rewrite', 'build', 'complete', 'choose']],
  ['p2', ['repair', 'translate', 'conjugate', 'choose']],
  ['p3', ['complete', 'choose', 'rewrite', 'translate']],
  ['p4', ['build', 'conjugate', 'repair', 'complete']],
];
const alpha = topic('alpha', 'basics', alphaPlan.flatMap(([pattern, types]) => types.map((type, n) => exercise(`alpha-${pattern}-${n}`, pattern, type))));
// Beta's first ten by rank are all one type, so the round must trade some for variety.
const beta = topic('beta', 'basics', ['b1', 'b2', 'b3', 'b4', 'b5'].flatMap((pattern) =>
  (['complete', 'complete', 'choose', 'translate'] as const).map((type, n) => exercise(`beta-${pattern}-${n}`, pattern, type))));
const gamma = topic('gamma', 'more', [
  exercise('gamma-accent', 'place', 'rewrite', {
    source: 'He is in Paris.', answers: ['Il est à Paris.'],
    alternatives: [{ answer: 'Il se trouve à Paris.', message: 'That locates him correctly, but this example practises être.' }],
  }),
  exercise('gamma-strict', 'place', 'complete', { source: 'Il va ____ Paris.', answers: ['à'], strictAccents: true }),
  exercise('gamma-comma', 'si', 'translate', { source: 'If you come, we will go to the cinema.', answers: ['Si tu viens, on ira au cinéma.'] }),
  exercise('gamma-choose', 'si', 'choose'),
  exercise('gamma-build', 'si', 'build'),
]);
const units: GrammarUnitContent[] = [
  { id: 'basics', title: 'Basics', description: 'The basics.', topics: ['alpha', 'beta'] },
  { id: 'more', title: 'More', description: 'A little more.', topics: ['gamma'] },
];
const course: Course = { units, topics: [alpha, beta, gamma] };
const byId = new Map(course.topics.flatMap((entry) => entry.exercises.map((item) => [item.id, item])));

const stores = new Set<GrammarStore | Store>();
const directories: string[] = [];
let sequence = 0;
const requestId = () => `grammar-test-${++sequence}`;

afterEach(() => {
  for (const store of stores) store.close();
  stores.clear();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function close(store: GrammarStore | Store): void {
  store.close();
  stores.delete(store);
}

function seeded(seed = 7): () => number {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function fixture(content: Course = course) {
  const directory = mkdtempSync(join(tmpdir(), 'echo-grammar-'));
  directories.push(directory);
  const dbPath = join(directory, 'nested', 'echo.db');
  const now = () => new Date('2026-09-22T10:00:00Z');
  const random = seeded();
  const open = () => {
    const store = createGrammarStore(content, { dbPath, now, random });
    stores.add(store);
    return store;
  };
  return { store: open(), open, dbPath, now };
}

function mutation(snapshot: GrammarSnapshot, id = requestId()): GrammarMutation {
  const session = snapshot.session;
  if (!session?.current) throw new Error('Test needs a current grammar exercise.');
  return { sessionId: session.id, exerciseId: session.current.exercise.id, version: session.version, requestId: id };
}

function currentId(snapshot: GrammarSnapshot): string {
  return snapshot.session!.current!.exercise.id;
}

function correct(store: GrammarStore, snapshot: GrammarSnapshot): GrammarSnapshot {
  const content = byId.get(currentId(snapshot))!;
  return store.answer({ ...mutation(snapshot), answer: content.answers[0]!, ...(content.type === 'build' ? { tokenOrder: [0, 1, 2, 3, 4] } : {}) });
}

function wrong(store: GrammarStore, snapshot: GrammarSnapshot): GrammarSnapshot {
  const content = byId.get(currentId(snapshot))!;
  return store.answer({ ...mutation(snapshot), answer: content.type === 'choose' ? 'est' : 'Faux.', ...(content.type === 'build' ? { tokenOrder: [0, 2] } : {}) });
}

// Settles every remaining question (correctly unless `miss` says otherwise) and moves past the last one.
function finish(store: GrammarStore, snapshot: GrammarSnapshot, miss: (id: string) => boolean = () => false): { snapshot: GrammarSnapshot; ids: string[] } {
  const ids: string[] = [];
  while (snapshot.session?.current) {
    const id = currentId(snapshot);
    ids.push(id);
    if (!snapshot.session.current.settled) snapshot = miss(id) && snapshot.session.mode === 'practice' ? store.help({ ...mutation(snapshot), kind: 'answer' }) : miss(id) ? wrong(store, snapshot) : correct(store, snapshot);
    snapshot = store.next(mutation(snapshot));
  }
  return { snapshot, ids };
}

// Answers correctly and advances until the current question satisfies `found`.
function until(store: GrammarStore, snapshot: GrammarSnapshot, found: (id: string) => boolean): GrammarSnapshot {
  while (!found(currentId(snapshot))) snapshot = store.next(mutation(correct(store, snapshot)));
  return snapshot;
}

function expectError(action: () => unknown, status: number, message?: string): void {
  let error: unknown;
  try { action(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(StoreError);
  expect((error as StoreError).status).toBe(status);
  if (message) expect((error as StoreError).message).toBe(message);
}

function patternOf(id: string): string {
  return byId.get(id)!.pattern;
}

describe('practice rounds', () => {
  test('a round has ten questions, at most three per pattern, three or more types, and no neighbouring pattern repeats', () => {
    const { store } = fixture();
    for (const topicId of ['alpha', 'beta']) {
      let state = store.start(topicId, requestId());
      expect(state).toMatchObject({ scope: topicId, kind: 'practice', unit: null, session: { mode: 'practice', total: 10 } });
      expect(state.session?.score).toBeUndefined();
      for (let round = 0; round < 3; round++) {
        const { ids, snapshot } = finish(store, state);
        const perPattern = Map.groupBy(ids, patternOf);
        expect(ids).toHaveLength(10);
        expect(new Set(ids).size).toBe(10);
        expect(Math.max(...[...perPattern.values()].map((group) => group.length))).toBeLessThanOrEqual(3);
        expect(new Set(ids.map((id) => byId.get(id)!.type)).size).toBeGreaterThanOrEqual(3);
        for (let index = 1; index < ids.length; index++) expect(patternOf(ids[index]!)).not.toBe(patternOf(ids[index - 1]!));
        expect(snapshot.session).toMatchObject({ complete: true, current: null });
        state = store.start(topicId, requestId());
      }
    }
    const small = finish(store, store.start('gamma', requestId()));
    expect(small.ids.toSorted()).toEqual(gamma.exercises.map((item) => item.id).toSorted());
  });

  test('fresh variants of a struggled pattern come first, and every unseen question makes the next round', () => {
    const { store } = fixture();
    let state = store.start('alpha', requestId());
    const struggled = currentId(state);
    state = store.help({ ...mutation(state), kind: 'answer' });
    const first = finish(store, store.next(mutation(state)));
    const round = [struggled, ...first.ids];
    expect(first.snapshot.topic?.progress).toEqual({ seen: 10, independent: 9, needsReview: 1 });
    const unseen = alpha.exercises.map((item) => item.id).filter((id) => !round.includes(id));
    state = store.start('alpha', requestId());
    expect(patternOf(currentId(state))).toBe(patternOf(struggled));
    expect(unseen).toContain(currentId(state));
    const second = finish(store, state).ids;
    expect(second).toEqual(expect.arrayContaining([...unseen, struggled]));
  });

  test('a question missed in a test comes first in the next practice round, before unseen ones', () => {
    const { store } = fixture();
    let test = store.start('test:alpha', requestId());
    const missed = currentId(test);
    test = finish(store, test, (id) => id === missed).snapshot;
    const untested = alpha.exercises.map((item) => item.id).filter((id) => !test.session!.results.some((result) => result.exerciseId === id));
    expect(untested).toHaveLength(1);
    expect(test.topic?.progress).toEqual({ seen: 15, independent: 14, needsReview: 1 });
    const practice = store.start('alpha', requestId());
    expect(currentId(practice)).toBe(missed);
    const ids = finish(store, practice).ids;
    expect(ids).toContain(untested[0]);
    expect(store.start('alpha', requestId()).session?.current?.exercise.id).not.toBe(missed);
  });
});

describe('tests', () => {
  test('a topic test refuses help, settles on the first answer, scores, and records the result', () => {
    const { store } = fixture();
    let state = store.start('test:alpha', requestId());
    expect(state).toMatchObject({ scope: 'test:alpha', kind: 'topic-test', topic: { id: 'alpha', hasActiveTest: true, hasActiveSession: false }, session: { mode: 'test', total: 15, score: 0 } });
    for (const kind of ['hint', 'rule', 'answer'] as const) expectError(() => store.help({ ...mutation(state), kind }), 409, 'Help is off during a test.');
    expect(store.state('test:alpha')).toEqual(state);
    const blank = store.answer({ ...mutation(state), answer: '  ' });
    expect(blank.session?.current).toMatchObject({ attempts: 0, settled: false });
    const missed = byId.get(currentId(state))!;
    state = wrong(store, blank);
    expect(state.session?.current).toMatchObject({ attempts: 1, settled: true, hint: null, feedback: { kind: 'incorrect', answer: missed.answers[0], message: missed.explanation } });
    expect(state.session?.results).toMatchObject([{ exerciseId: missed.id, topicId: 'alpha', outcome: 'revisit' }]);
    expectError(() => correct(store, state), 409);
    let finished = finish(store, store.next(mutation(state)));
    expect(finished.snapshot.session).toMatchObject({ complete: true, score: 14, total: 15 });
    const lastNext = finished.snapshot;
    expect(lastNext.topic?.test).toEqual({ taken: 1, best: { score: 14, total: 15 }, last: { score: 14, total: 15, finishedAt: '2026-09-22T10:00:00.000Z' } });
    expect(lastNext.topic?.hasActiveTest).toBe(false);
    const exported = store.exportData() as { tests: { scope: string; score: number; total: number }[] };
    expect(exported.tests).toMatchObject([{ scope: 'test:alpha', score: 14, total: 15 }]);

    const firstIds = new Set(lastNext.session!.results.map((result) => result.exerciseId));
    const leftOut = alpha.exercises.find((item) => !firstIds.has(item.id))!.id;
    state = store.start('test:alpha', requestId());
    expect(state.session?.id).not.toBe(lastNext.session?.id);
    finished = finish(store, state, (id) => patternOf(id) === 'p1');
    expect(finished.ids).toContain(leftOut);
    const p1 = finished.ids.filter((id) => patternOf(id) === 'p1').length;
    expect(finished.snapshot.topic?.test).toEqual({ taken: 2, best: { score: 14, total: 15 }, last: { score: 15 - p1, total: 15, finishedAt: '2026-09-22T10:00:00.000Z' } });
    expect(store.catalog()[0]!.topics[0]!.test.taken).toBe(2);
  });

  test('a topic test takes the same share from every pattern, mixes types, and separates patterns', () => {
    const { store } = fixture();
    const ids = finish(store, store.start('test:beta', requestId())).ids;
    expect(ids).toHaveLength(15);
    expect([...Map.groupBy(ids, patternOf).values()].map((group) => group.length)).toEqual([3, 3, 3, 3, 3]);
    expect(new Set(ids.map((id) => byId.get(id)!.type))).toEqual(new Set(['complete', 'choose', 'translate']));
    for (let index = 1; index < ids.length; index++) expect(patternOf(ids[index]!)).not.toBe(patternOf(ids[index - 1]!));
  });

  test('test feedback carries the answer and explanation, an alternative’s message, and counts spelling as right', () => {
    const { store } = fixture();
    let state = store.start('test:gamma', requestId());
    expect(state.session?.total).toBe(5);
    while (state.session?.current) {
      const id = currentId(state);
      if (id === 'gamma-accent') {
        state = store.answer({ ...mutation(state), answer: 'Il se trouve à Paris.' });
        expect(state.session?.current?.feedback).toEqual({
          kind: 'alternative', answer: 'Il est à Paris.', message: 'Why gamma-accent works.',
          note: 'That locates him correctly, but this example practises être.',
        });
      } else if (id === 'gamma-comma') {
        state = store.answer({ ...mutation(state), answer: 'Si tu viens on ira au cinema' });
        expect(state.session?.current).toMatchObject({ settled: true, feedback: { kind: 'correct', spelling: true, answer: 'Si tu viens, on ira au cinéma.' } });
      } else state = correct(store, state);
      state = store.next(mutation(state));
    }
    expect(state.session?.score).toBe(4);
    expect(state.session?.results.find((result) => result.exerciseId === 'gamma-accent')).toMatchObject({ outcome: 'revisit', given: 'Il se trouve à Paris.' });
    expect(state.session?.results.find((result) => result.exerciseId === 'gamma-comma')).toMatchObject({ outcome: 'independent', spelling: true, given: 'Si tu viens on ira au cinema' });
  });

  test('a practice round and a test on the same topic resume independently', () => {
    const { store } = fixture();
    let practice = store.start('alpha', requestId());
    practice = wrong(store, practice);
    let test = store.start('test:alpha', requestId());
    test = correct(store, test);
    expect(store.state('alpha').session).toEqual(practice.session);
    expect(store.start('alpha', requestId()).session).toEqual(practice.session);
    expect(store.start('test:alpha', requestId()).session).toEqual(test.session);
    const [basics] = store.catalog();
    expect(basics!.topics[0]).toMatchObject({ id: 'alpha', hasActiveSession: true, hasActiveTest: true, practiceLength: 10, testLength: 15 });
    expect(basics!.topics[1]).toMatchObject({ id: 'beta', hasActiveSession: false, hasActiveTest: false });
  });

  test('every stretch of a unit test covers every topic, so stopping halfway still tests the whole unit', () => {
    const names = ['north', 'south', 'east', 'west'];
    const wide: Course = {
      units: [{ id: 'compass', title: 'Compass', description: 'Four topics.', topics: names }],
      topics: names.map((name) => topic(name, 'compass', [1, 2, 3, 4, 5, 6].map((n) => exercise(`${name}-${n}`, `${name}-p${n % 3}`, 'complete')))),
    };
    const answers = new Map(wide.topics.flatMap((entry) => entry.exercises.map((item) => [item.id, item.answers[0]!])));
    const { store } = fixture(wide);
    let state = store.start('unit:compass', requestId());
    const order: string[] = [];
    while (state.session?.current) {
      order.push(state.session.current.exercise.topicId);
      state = store.next(mutation(store.answer({ ...mutation(state), answer: answers.get(currentId(state))! })));
    }
    expect(order).toHaveLength(20);
    for (let start = 0; start < 20; start += 4) expect(new Set(order.slice(start, start + 4)).size).toBe(4);
  });

  test('a unit test takes twenty questions round-robin across its topics and credits each topic', () => {
    const { store } = fixture();
    let state = store.start('unit:basics', requestId());
    expect(state).toMatchObject({ scope: 'unit:basics', kind: 'unit-test', topic: null, unit: { id: 'basics', testLength: 20, hasActiveTest: true }, session: { mode: 'test', total: 20 } });
    expect(state.session?.current?.exercise).toMatchObject({ topicId: expect.stringMatching(/^(alpha|beta)$/), topicTitle: expect.stringMatching(/^Topic (alpha|beta)$/) });
    expectError(() => store.help({ ...mutation(state), kind: 'hint' }), 409, 'Help is off during a test.');
    const { ids, snapshot } = finish(store, state, (id) => id.startsWith('beta-b1'));
    const topicOf = (id: string) => id.split('-')[0]!;
    expect(Map.groupBy(ids, topicOf).get('alpha')).toHaveLength(10);
    expect(Map.groupBy(ids, topicOf).get('beta')).toHaveLength(10);
    for (let index = 1; index < ids.length; index++) expect(topicOf(ids[index]!)).not.toBe(topicOf(ids[index - 1]!));
    const misses = ids.filter((id) => id.startsWith('beta-b1')).length;
    expect(snapshot.session?.score).toBe(20 - misses);
    expect(snapshot.session?.results.filter((result) => result.outcome === 'revisit').map((result) => result.topicTitle)).toEqual(Array(misses).fill('Topic beta'));
    expect(snapshot.unit?.test).toMatchObject({ taken: 1, best: { score: 20 - misses, total: 20 } });
    const [basics, more] = store.catalog();
    expect(basics!.topics.map((entry) => entry.progress)).toEqual([
      { seen: 10, independent: 10, needsReview: 0 },
      { seen: 10, independent: 10 - misses, needsReview: misses },
    ]);
    expect(basics).toMatchObject({ hasActiveTest: false, test: { taken: 1 } });
    expect(more).toMatchObject({ testLength: 5, test: { taken: 0, best: null, last: null } });
  });
});

describe('answer classification', () => {
  test('accent and comma slips are spelling unless strictAccents, and alternatives explain without settling', () => {
    const { store } = fixture();
    let state = store.start('gamma', requestId());
    const checked = new Set<string>();
    while (state.session?.current) {
      const id = currentId(state);
      checked.add(id);
      if (id === 'gamma-accent') {
        state = store.answer({ ...mutation(state), answer: 'Il se trouve à Paris.' });
        expect(state.session?.current).toMatchObject({ attempts: 1, settled: false, misses: ['Il se trouve à Paris.'], feedback: { kind: 'alternative', message: 'That locates him correctly, but this example practises être.' } });
        state = store.answer({ ...mutation(state), answer: 'il est a paris' });
        expect(state.session?.current).toMatchObject({ settled: true, feedback: { kind: 'correct', spelling: true, answer: 'Il est à Paris.' } });
        expect(state.session?.results.at(-1)).toMatchObject({ exerciseId: 'gamma-accent', outcome: 'helped', spelling: true });
      } else if (id === 'gamma-comma') {
        state = store.answer({ ...mutation(state), answer: 'Si tu viens on ira au cinéma' });
        expect(state.session?.current).toMatchObject({ settled: true, feedback: { kind: 'correct', spelling: true } });
        expect(state.session?.results.at(-1)).toMatchObject({ exerciseId: 'gamma-comma', outcome: 'independent' });
      } else if (id === 'gamma-strict') {
        state = store.answer({ ...mutation(state), answer: 'a' });
        expect(state.session?.current).toMatchObject({ settled: false, feedback: { kind: 'incorrect', message: 'Nudge for gamma-strict.' } });
        state = store.answer({ ...mutation(state), answer: 'à' });
        expect(state.session?.current).toMatchObject({ settled: true, feedback: { kind: 'correct' } });
        expect(state.session?.current?.feedback?.spelling).toBeUndefined();
      } else state = correct(store, state);
      state = store.next(mutation(state));
    }
    expect(checked.size).toBe(5);
  });

  test('choose accepts only the exact option, marks wrong picks, and rejects text that is not an option', () => {
    const { store } = fixture();
    let state = until(store, store.start('gamma', requestId()), (id) => id === 'gamma-choose');
    expect(state.session?.current?.exercise.options?.toSorted()).toEqual(['es', 'est', 'êtes']);
    state = store.answer({ ...mutation(state), answer: 'est' });
    expect(state.session?.current).toMatchObject({ attempts: 1, settled: false, misses: ['est'], feedback: { kind: 'incorrect' } });
    expectError(() => store.answer({ ...mutation(state), answer: 'etes' }), 400);
    expectError(() => store.answer({ ...mutation(state), answer: 'Tu es ici.' }), 400);
    state = store.answer({ ...mutation(state), answer: 'ES' });
    expect(state.session?.current).toMatchObject({ attempts: 2, settled: true, misses: ['est'], feedback: { kind: 'correct' } });
    expect(state.session?.results.at(-1)).toMatchObject({ exerciseId: 'gamma-choose', outcome: 'helped', given: 'ES' });
  });

  test('building derives the answer from unique in-range tokens and permits unused distractors', () => {
    const { store } = fixture();
    let state = until(store, store.start('gamma', requestId()), (id) => id === 'gamma-build');
    expectError(() => store.answer({ ...mutation(state), answer: 'Tu n’aimes pas le thé.', tokenOrder: [0, 0] }), 400);
    expectError(() => store.answer({ ...mutation(state), answer: 'Tu n’aimes pas le thé.', tokenOrder: [9] }), 400);
    state = store.answer({ ...mutation(state), answer: 'Tu n’aimes pas le thé.', tokenOrder: [] });
    expect(state.session?.current).toMatchObject({ answer: '', attempts: 0, settled: false });
    const input = { ...mutation(state), answer: 'This text is not trusted.', tokenOrder: [0, 1, 2, 3, 4] };
    state = store.answer(input);
    expect(state.session?.current).toMatchObject({ answer: 'Tu n’aimes pas le thé.', attempts: 1, settled: true });
    expectError(() => store.answer({ ...input, answer: 'Different payload with the same request ID.' }), 409);
  });

  test('rule help earns helped, a shown answer settles revisit once, and later help cannot downgrade success', () => {
    const { store } = fixture();
    let state = store.start('alpha', requestId());
    expectError(() => store.next(mutation(state)), 409);
    state = store.help({ ...mutation(state), kind: 'rule' });
    state = correct(store, state);
    expect(state.session?.results[0]?.outcome).toBe('helped');
    state = store.next(mutation(state));
    const shown = { ...mutation(state), kind: 'answer' as const };
    state = store.help(shown);
    expect(state.session?.current).toMatchObject({ attempts: 0, assisted: true, settled: true, feedback: { kind: 'shown' } });
    expect(store.help(shown)).toEqual(state);
    state = store.next(mutation(state));
    state = correct(store, state);
    const earned = state.session?.results;
    state = store.help({ ...mutation(state), kind: 'answer' });
    expect(state.session?.results).toEqual(earned);
    expect(state.session?.results.map((result) => result.outcome)).toEqual(['helped', 'revisit', 'independent']);
    expect(state.topic?.progress).toEqual({ seen: 3, independent: 1, needsReview: 2 });
  });
});

describe('persistence and concurrency', () => {
  test('reload resumes submitted text, attempts, help, and settled results before Next', () => {
    const { store, open } = fixture();
    let state = store.start('alpha', requestId());
    state = wrong(store, state);
    state = store.help({ ...mutation(state), kind: 'hint' });
    close(store);
    const reopened = open();
    expect(reopened.state('alpha')).toEqual(state);
    expect(reopened.start('alpha', requestId())).toEqual(state);
    expect(state.session?.current).toMatchObject({ attempts: 1, assisted: true, hint: byId.get(currentId(state))!.hint, settled: false });
    state = correct(reopened, state);
    close(reopened);
    expect(open().state('alpha')).toEqual(state);
    expect(state.session?.results).toMatchObject([{ outcome: 'helped' }]);
  });

  test('lost-response retries return live state without repeating an attempt, settlement, help, or advance', () => {
    const { store } = fixture();
    let state = store.start('alpha', requestId());
    const miss = { ...mutation(state), answer: 'Faux.' };
    state = store.answer(miss);
    expect(store.answer(miss)).toEqual(state);
    const hint = { ...mutation(state), kind: 'hint' as const };
    state = store.help(hint);
    state = correct(store, state);
    const advance = mutation(state);
    state = store.next(advance);
    expect(store.answer(miss)).toEqual(state);
    expect(store.help(hint)).toEqual(state);
    expect(store.next(advance)).toEqual(state);
    expect(state.session?.results).toHaveLength(1);
    expect(state.session?.current?.attempts).toBe(0);
    expect(state.topic?.progress).toEqual({ seen: 2, independent: 0, needsReview: 1 });
  });

  test('stale versions and reused request IDs cannot overwrite the winner', () => {
    const { store, open } = fixture();
    const otherScreen = open();
    const initial = store.start('alpha', requestId());
    const input = { ...mutation(initial), answer: byId.get(currentId(initial))!.answers[0]!, ...(byId.get(currentId(initial))!.type === 'build' ? { tokenOrder: [0, 1, 2, 3, 4] } : {}) };
    const settled = store.answer(input);
    expectError(() => otherScreen.answer({ ...input, answer: 'Faux.', tokenOrder: undefined, requestId: requestId() }), 409);
    expectError(() => otherScreen.answer({ ...input, answer: 'Faux.' }), 409);
    expectError(() => otherScreen.help({ ...mutation(initial), requestId: input.requestId, kind: 'rule' }), 409);
    expectError(() => otherScreen.next(mutation(initial)), 409);
    expect(otherScreen.answer(input)).toEqual(settled);
    expect(otherScreen.state('alpha')).toEqual(settled);
  });

  test('retrying an old start returns the scope’s newest session, and unknown scopes are 404', () => {
    const { store } = fixture();
    const firstId = requestId();
    const first = finish(store, store.start('gamma', firstId)).snapshot;
    const fresh = store.start('gamma', requestId());
    expect(fresh.session?.id).not.toBe(first.session?.id);
    expect(store.start('gamma', firstId)).toEqual(fresh);
    expectError(() => store.start('test:gamma', firstId), 409);
    for (const scope of ['nope', 'test:nope', 'unit:nope', 'unit:gamma', 'test:unit:basics']) expectError(() => store.state(scope), 404);
  });

  test('a practice round saved before tests existed still answers and finishes', () => {
    const { store, dbPath } = fixture();
    const legacy = {
      version: 1, index: 0,
      exercises: gamma.exercises.slice(0, 3).map((content) => ({ content, answer: '', tokenOrder: [], attempts: 0, assisted: false, hint: null, feedback: null, settled: false, help: [], outcome: null })),
    };
    const raw = new Database(dbPath);
    raw.query('INSERT INTO grammar_sessions (id, topic_id, round_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('legacy-round', 'gamma', JSON.stringify(legacy), 'x', 'x');
    raw.close();
    expect(store.catalog()[1]!.topics[0]!.hasActiveSession).toBe(true);
    let state = store.start('gamma', requestId());
    expect(state.session).toMatchObject({ id: 'legacy-round', mode: 'practice', total: 3, current: { exercise: { id: 'gamma-accent', topicId: 'gamma', topicTitle: 'Topic gamma' }, misses: [] } });
    state = wrong(store, state);
    const { snapshot } = finish(store, state);
    expect(snapshot.session).toMatchObject({ id: 'legacy-round', complete: true });
    expect(snapshot.session?.results.map((result) => [result.exerciseId, result.outcome])).toEqual([['gamma-accent', 'helped'], ['gamma-strict', 'independent'], ['gamma-comma', 'independent']]);
    expect(snapshot.topic?.progress).toEqual({ seen: 3, independent: 2, needsReview: 1 });
    expect(store.start('gamma', requestId()).session?.id).not.toBe('legacy-round');
  });

  test('grammar writes and reloads preserve vocabulary progress on the same database', () => {
    const { store, open, dbPath, now } = fixture();
    const words: Word[] = [{ id: 'bread', fr: 'le pain', en: 'bread', category: 'food' }];
    const vocabulary = createStore(words, { dbPath, now });
    stores.add(vocabulary);
    const word = vocabulary.start('fr-en', 'all').current!;
    vocabulary.grade({ direction: 'fr-en', deck: 'all', wordId: word.id, version: word.version, known: true, requestId: requestId() });
    const before = vocabulary.exportData();
    const grammar = finish(store, store.start('test:gamma', requestId())).snapshot;
    expect(vocabulary.exportData()).toEqual(before);
    close(store);
    close(vocabulary);
    const reopenedVocabulary = createStore(words, { dbPath, now });
    stores.add(reopenedVocabulary);
    expect(reopenedVocabulary.exportData()).toEqual(before);
    expect(open().state('test:gamma')).toEqual(grammar);
  });
});

describe('course content', () => {
  test('an invalid course fails before opening a store', () => {
    const invalid: Course[] = [
      { units, topics: [alpha, beta] },
      { units, topics: [alpha, beta, { ...gamma, exercises: [gamma.exercises[0]!, gamma.exercises[0]!] }] },
      { units, topics: [alpha, beta, { ...gamma, rule: '<strong>Not plain text</strong>' }] },
      { units, topics: [alpha, beta, { ...gamma, exercises: [{ ...gamma.exercises[3]!, answers: ['vous'] }] }] },
    ];
    for (const entry of invalid) expect(() => createGrammarStore(entry, { dbPath: ':memory:' })).toThrow(StoreError);
  });

  test('the real course in content/grammar loads and lists every unit and topic', async () => {
    const real = await loadCourse(join(import.meta.dir, '..', 'content', 'grammar'));
    const store = createGrammarStore(real, { dbPath: ':memory:' });
    stores.add(store);
    const catalog = store.catalog();
    expect(catalog).toHaveLength(7);
    expect(catalog.flatMap((unit) => unit.topics)).toHaveLength(35);
  });
});
