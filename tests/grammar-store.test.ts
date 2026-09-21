import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GrammarExercise, GrammarMutation, GrammarSnapshot, GrammarTopicContent, Word } from '../contract';
import { createGrammarStore, type GrammarStore } from '../lib/grammar-store';
import { createStore, StoreError, type Store } from '../lib/store';

const exercises: GrammarExercise[] = [
  {
    id: 'location', pattern: 'preposition', type: 'rewrite', instruction: 'Use être and à to say where he is.', source: 'He is in Paris.',
    answers: ['Il est à Paris.'], spellingAnswers: ['Il est a Paris.'],
    alternatives: [{ answer: 'Il se trouve à Paris.', message: 'That locates him correctly, but this example practises être.' }],
    hint: 'Put à before the city.', feedback: 'Use il est, then à and the city.', explanation: 'À introduces the city.',
  },
  {
    id: 'tea', pattern: 'elision', type: 'build', instruction: 'Build the negative sentence.', source: 'Tu aimes le thé.',
    tokens: ['le', 'pas', 'Tu', 'thé.', 'aimes', 'n’'], answers: ['Tu n’aimes pas le thé.'],
    hint: 'Ne becomes n’ before aimes.', feedback: 'Put n’ before aimes and pas after it.', explanation: 'N’ and pas surround aimes.',
  },
  {
    id: 'elle', pattern: 'copula', type: 'complete', instruction: 'Complete with être.', source: 'Elle ____ française.', answers: ['est'],
    hint: 'Use the third-person singular.', feedback: 'Elle takes est.', explanation: 'Est agrees with elle.',
  },
  {
    id: 'speaking', pattern: 'negation', type: 'rewrite', instruction: 'Make the sentence negative.', source: 'Je parle.', answers: ['Je ne parle pas.'],
    hint: 'Put ne and pas around parle.', feedback: 'Keep parle between ne and pas.', explanation: 'Ne and pas surround parle.',
  },
  {
    id: 'home', pattern: 'preposition', type: 'repair', instruction: 'Add the missing preposition.', source: 'Il habite Paris.', answers: ['Il habite à Paris.'],
    hint: 'The city needs à.', feedback: 'Put à before Paris.', explanation: 'À introduces a city after habiter.',
  },
  {
    id: 'tu', pattern: 'copula', type: 'complete', instruction: 'Complete with être.', source: 'Tu ____ ici.', answers: ['es'],
    hint: 'Use the second-person singular.', feedback: 'Tu takes es.', explanation: 'Es agrees with tu.',
  },
];

function topic(id = 'sentences', examples = exercises): GrammarTopicContent {
  return { id, title: 'Sentences', description: 'Practise a few sentence patterns.', mark: 'Aa', rule: 'Match the requested pattern.', example: 'Il est à Paris.', aside: 'Each example names its target form.', exercises: examples };
}

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

function fixture(topics = [topic()]) {
  const directory = mkdtempSync(join(tmpdir(), 'echo-grammar-'));
  directories.push(directory);
  const dbPath = join(directory, 'nested', 'echo.db');
  const now = () => new Date('2026-09-22T10:00:00Z');
  const open = () => {
    const store = createGrammarStore(topics, { dbPath, now });
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

function correct(store: GrammarStore, snapshot: GrammarSnapshot): GrammarSnapshot {
  const id = snapshot.session?.current?.exercise.id;
  const content = exercises.find((exercise) => exercise.id === id);
  if (!content) throw new Error(`No fixture answer for ${id}.`);
  return store.answer({ ...mutation(snapshot), answer: content.answers[0]!, ...(content.type === 'build' ? { tokenOrder: [2, 5, 4, 1, 0, 3] } : {}) });
}

function finishRound(store: GrammarStore, snapshot: GrammarSnapshot): { snapshot: GrammarSnapshot; ids: string[] } {
  const ids: string[] = [];
  while (snapshot.session?.current) {
    ids.push(snapshot.session.current.exercise.id);
    if (!snapshot.session.current.settled) snapshot = correct(store, snapshot);
    snapshot = store.next(mutation(snapshot));
  }
  return { snapshot, ids };
}

function expectError(action: () => unknown, status: number): void {
  let error: unknown;
  try { action(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(StoreError);
  expect((error as StoreError).status).toBe(status);
}

describe('grammar persistence and concurrency', () => {
  test('reload resumes submitted text, token order, attempts, help, and settled results before Next', () => {
    const { store, open } = fixture();
    let state = store.start('sentences', requestId());
    state = store.answer({ ...mutation(state), answer: 'Il est Paris.' });
    state = store.help({ ...mutation(state), kind: 'hint' });
    close(store);
    const reopened = open();
    expect(reopened.state('sentences')).toEqual(state);
    expect(reopened.start('sentences', requestId())).toEqual(state);
    expect(state.session?.current).toMatchObject({ answer: 'Il est Paris.', attempts: 1, assisted: true, hint: exercises[0]!.hint, settled: false });
    state = correct(reopened, state);
    expect(state.session?.results).toMatchObject([{ exerciseId: 'location', outcome: 'helped' }]);
    expect(state.topic.progress).toEqual({ seen: 1, independent: 0, needsReview: 1 });
    state = reopened.next(mutation(state));
    state = reopened.answer({ ...mutation(state), answer: 'ignored', tokenOrder: [2, 4] });
    close(reopened);
    const final = open();
    expect(final.state('sentences')).toEqual(state);
    expect(state.session?.current).toMatchObject({ answer: 'Tu aimes', tokenOrder: [2, 4], attempts: 1, settled: false });
    expect(state.session?.results).toHaveLength(1);
    expect(state.topic.progress.seen).toBe(2);
  });

  test('lost-response retries return live state without repeating an attempt, settlement, help, or advance', () => {
    const { store } = fixture();
    let state = store.start('sentences', requestId());
    const wrong = { ...mutation(state), answer: 'Il est Paris.' };
    state = store.answer(wrong);
    expect(store.answer(wrong)).toEqual(state);
    expect(state.session?.current?.attempts).toBe(1);
    const hint = { ...mutation(state), kind: 'hint' as const };
    state = store.help(hint);
    const right = { ...mutation(state), answer: 'Il est à Paris.' };
    state = store.answer(right);
    const advance = mutation(state);
    state = store.next(advance);
    expect(store.answer(wrong)).toEqual(state);
    expect(store.answer(right)).toEqual(state);
    expect(store.help(hint)).toEqual(state);
    expect(store.next(advance)).toEqual(state);
    expect(state.session?.results).toHaveLength(1);
    expect(state.session?.current?.attempts).toBe(0);
    expect(state.topic.progress).toEqual({ seen: 2, independent: 0, needsReview: 1 });
  });

  test('different concurrent answers and reused IDs cannot overwrite the winner', () => {
    const { store, open } = fixture();
    const otherScreen = open();
    const initial = store.start('sentences', requestId());
    const input = { ...mutation(initial), answer: 'Il est à Paris.' };
    const settled = store.answer(input);
    expectError(() => otherScreen.answer({ ...input, answer: 'Il est Paris.', requestId: requestId() }), 409);
    expectError(() => otherScreen.answer({ ...input, answer: 'Il est Paris.' }), 409);
    expectError(() => otherScreen.help({ ...mutation(initial), requestId: input.requestId, kind: 'rule' }), 409);
    expectError(() => otherScreen.answer({ ...mutation(settled), answer: 'Il est à Paris.' }), 409);
    expectError(() => otherScreen.next(mutation(initial)), 409);
    expect(otherScreen.answer(input)).toEqual(settled);
    expect(otherScreen.state('sentences')).toEqual(settled);
  });

  test('topics have independent resumable rounds, and retrying an old start cannot resurrect it', () => {
    const other = topic('other', [{ ...exercises[0]!, id: 'other-location' }]);
    const { store } = fixture([topic(), other]);
    const firstId = requestId();
    let first = store.start('sentences', firstId);
    const second = store.start('other', requestId());
    first = finishRound(store, first).snapshot;
    expect(first.session).toMatchObject({ complete: true, current: null, total: 3 });
    expect(store.state('other')).toEqual(second);
    const fresh = store.start('sentences', requestId());
    expect(fresh.session?.id).not.toBe(first.session?.id);
    expect(store.start('sentences', firstId)).toEqual(fresh);
    expectError(() => store.start('other', firstId), 409);
    expect(store.state('other')).toEqual(second);
    expect(store.catalog().map((entry) => entry.hasActiveSession)).toEqual([true, true]);
  });
});

describe('grammar feedback and outcomes', () => {
  test('empty answers are not attempts, settlement gates Next, and post-success help cannot downgrade recall', () => {
    const { store } = fixture();
    let state = store.start('sentences', requestId());
    expectError(() => store.next(mutation(state)), 409);
    state = store.answer({ ...mutation(state), answer: ' \n ' });
    expect(state.session?.current).toMatchObject({ attempts: 0, settled: false });
    state = store.answer({ ...mutation(state), answer: '  IL   EST À PARIS...  ' });
    expect(state.session?.current).toMatchObject({ attempts: 1, assisted: false, settled: true, feedback: { kind: 'correct' } });
    expect(state.session?.results[0]?.outcome).toBe('independent');
    const earned = state.session?.results;
    state = store.help({ ...mutation(state), kind: 'rule' });
    state = store.help({ ...mutation(state), kind: 'answer' });
    expect(state.session?.results).toEqual(earned);
    expect(state.session?.current).toMatchObject({ assisted: false, feedback: { kind: 'correct' } });
    expect(state.topic.progress).toEqual({ seen: 1, independent: 1, needsReview: 0 });
  });

  test('rule help earns helped, while showing an answer immediately settles revisit once', () => {
    const { store } = fixture();
    let state = store.start('sentences', requestId());
    state = store.help({ ...mutation(state), kind: 'rule' });
    state = correct(store, state);
    expect(state.session?.results[0]?.outcome).toBe('helped');
    state = store.next(mutation(state));
    const shown = { ...mutation(state), kind: 'answer' as const };
    state = store.help(shown);
    expect(state.session?.current).toMatchObject({ attempts: 0, assisted: true, settled: true, feedback: { kind: 'shown', answer: 'Tu n’aimes pas le thé.' } });
    expect(state.session?.results.map((result) => result.outcome)).toEqual(['helped', 'revisit']);
    expect(state.topic.progress).toEqual({ seen: 2, independent: 0, needsReview: 2 });
    expect(store.help(shown)).toEqual(state);
    expectError(() => store.answer({ ...mutation(state), answer: 'correct-looking', tokenOrder: [2, 5, 4, 1, 0, 3] }), 409);
    expect(store.state('sentences')).toEqual(state);
  });

  test('only explicitly authored spelling variants succeed without falsely adding assistance', () => {
    const { store } = fixture([topic('spelling', [exercises[0]!, {
      ...exercises[4]!, id: 'certainty', answers: ['Je suis sûr.'], source: 'I am certain.', spellingAnswers: undefined,
    }])]);
    let state = store.start('spelling', requestId());
    state = store.answer({ ...mutation(state), answer: 'Il est a Paris.' });
    expect(state.session?.current).toMatchObject({ assisted: false, feedback: { kind: 'correct', spelling: true, answer: 'Il est à Paris.' } });
    expect(state.session?.results[0]?.outcome).toBe('independent');
    state = store.next(mutation(state));
    state = store.answer({ ...mutation(state), answer: 'Je suis sur.' });
    expect(state.session?.current).toMatchObject({ settled: false, feedback: { kind: 'incorrect' } });
    expect(state.session?.results).toHaveLength(1);
  });

  test('recognized French alternatives explain the requested form instead of calling the sentence incorrect', () => {
    const { store } = fixture();
    let state = store.start('sentences', requestId());
    state = store.answer({ ...mutation(state), answer: 'Il se trouve à Paris.' });
    expect(state.session?.current).toMatchObject({ attempts: 1, settled: false, feedback: { kind: 'alternative', message: exercises[0]!.alternatives![0]!.message } });
    expect(state.session?.results).toEqual([]);
    state = correct(store, state);
    expect(state.session?.results[0]?.outcome).toBe('helped');
  });

  test('building derives the answer from unique in-range tokens and permits unused distractors', () => {
    const { store } = fixture([topic('building', [{ ...exercises[1]!, tokens: [...exercises[1]!.tokens!, 'ne'] }])]);
    let state = store.start('building', requestId());
    expectError(() => store.answer({ ...mutation(state), answer: 'Tu n’aimes pas le thé.', tokenOrder: [2, 2] }), 400);
    expectError(() => store.answer({ ...mutation(state), answer: 'Tu n’aimes pas le thé.', tokenOrder: [7] }), 400);
    expect(store.state('building')).toEqual(state);
    state = store.answer({ ...mutation(state), answer: 'Tu n’aimes pas le thé.', tokenOrder: [] });
    expect(state.session?.current).toMatchObject({ answer: '', attempts: 0, settled: false });
    const input = { ...mutation(state), answer: 'This text is not trusted.', tokenOrder: [2, 5, 4, 1, 0, 3] };
    state = store.answer(input);
    expect(state.session?.current).toMatchObject({ answer: 'Tu n’aimes pas le thé.', attempts: 1, settled: true });
    expect(state.session?.results[0]?.outcome).toBe('independent');
    expectError(() => store.answer({ ...input, answer: 'Different payload with the same request ID.' }), 409);
  });
});

describe('grammar practice selection and database coexistence', () => {
  test('fresh variants of helped patterns come first, no early repeats, and latest outcomes replace prior needs-review counts', () => {
    const { store } = fixture();
    let state = store.start('sentences', requestId());
    state = store.help({ ...mutation(state), kind: 'answer' });
    state = store.next(mutation(state));
    state = store.help({ ...mutation(state), kind: 'hint' });
    state = correct(store, state);
    state = store.next(mutation(state));
    state = finishRound(store, state).snapshot;
    expect(state.topic.progress).toEqual({ seen: 3, independent: 1, needsReview: 2 });
    state = store.start('sentences', requestId());
    expect(state.session?.current?.exercise.id).toBe('home');
    const fresh = finishRound(store, state);
    expect(fresh.ids).toEqual(['home', 'speaking', 'tu']);
    expect(fresh.snapshot.topic.progress).toEqual({ seen: 6, independent: 4, needsReview: 2 });
    state = store.start('sentences', requestId());
    expect(state.session?.current?.exercise.id).toBe('location');
    state = correct(store, state);
    expect(state.topic.progress).toEqual({ seen: 6, independent: 5, needsReview: 1 });
    state = store.next(mutation(state));
    expect(state.session?.current?.exercise.id).toBe('tea');
    state = correct(store, state);
    state = store.next(mutation(state));
    expect(state.session?.current?.exercise.id).toBe('elle');
    state = finishRound(store, state).snapshot;
    expect(state.topic.progress).toEqual({ seen: 6, independent: 6, needsReview: 0 });
    state = store.start('sentences', requestId());
    expect(state.session?.current?.exercise.id).toBe('home');
    expect(state.session?.total).toBe(3);
  });

  test('grammar writes and reloads preserve vocabulary progress on the same database', () => {
    const { store, open, dbPath, now } = fixture();
    const words: Word[] = [{ id: 'bread', fr: 'le pain', en: 'bread', category: 'food' }];
    const vocabulary = createStore(words, { dbPath, now });
    stores.add(vocabulary);
    const word = vocabulary.start('fr-en', 'all').current!;
    vocabulary.grade({ direction: 'fr-en', deck: 'all', wordId: word.id, version: word.version, known: true, requestId: requestId() });
    const before = vocabulary.exportData();
    const grammar = finishRound(store, store.start('sentences', requestId())).snapshot;
    expect(vocabulary.exportData()).toEqual(before);
    close(store);
    close(vocabulary);
    const reopenedVocabulary = createStore(words, { dbPath, now });
    stores.add(reopenedVocabulary);
    expect(reopenedVocabulary.exportData()).toEqual(before);
    expect(open().state('sentences')).toEqual(grammar);
  });
});

describe('authored grammar integrity', () => {
  test('ambiguous accepted answers, duplicate IDs, HTML, and impossible token phrases fail before opening a store', () => {
    const invalidCatalogs: GrammarTopicContent[][] = [
      [topic(), topic()],
      [topic('duplicate', [exercises[0]!, exercises[0]!])],
      [topic('ambiguous', [{ ...exercises[0]!, spellingAnswers: [' IL EST À PARIS! '] }])],
      [{ ...topic(), rule: '<strong>Not plain text</strong>' }],
      [topic('tokens', [{ ...exercises[1]!, tokens: ['Tu pas', 'n’aimes', 'le thé.'] }])],
      [topic('missing-answer', [{ ...exercises[0]!, answers: [] }])],
    ];
    for (const catalog of invalidCatalogs) {
      expect(() => createGrammarStore(catalog, { dbPath: ':memory:' })).toThrow(StoreError);
    }
  });
});
