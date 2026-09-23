import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GrammarTopicContent, Word } from '../contract';
import type { LearningAttemptInput, LearningContent, ReadingLesson, TutorJob } from '../learning-contract';
import { createGrammarStore } from '../lib/grammar-store';
import { createLearningStore, type LearningStore } from '../lib/learning-store';
import { createStore, StoreError } from '../lib/store';

const content: LearningContent = {
  listening: [{
    id: 'bread', title: 'At the shop', kind: 'sentence', description: 'A shopping update.',
    fr: 'J’ai acheté du pain à l’épicerie.', en: 'I bought bread at the grocery store.', audioId: 'bread',
    meaning: { question: 'What did I buy?', choices: ['Bread', 'A ticket'], correctIndex: 0, explanation: 'Du pain means bread.' },
    gap: { prompt: 'J’ai acheté ____ à l’épicerie.', answer: 'du pain', alternatives: ['un peu de pain'], explanation: 'Du introduces an unspecified amount.' },
  }],
  reading: [{
    id: 'message', title: 'A message', kind: 'message', fr: 'Je suis à la gare. Tu peux venir ?', en: 'I am at the station. Can you come?',
    annotations: [{ phrase: 'à la gare', translation: 'at the station', explanation: 'À locates the speaker.' }],
    writingPrompt: 'Reply with your location.', modelAnswer: 'Je suis au café.',
    practice: [{ prompt: 'Je suis à la ____. (station)', answer: 'gare', explanation: 'Gare means station.' }],
  }],
  conversations: [{
    id: 'cafe', title: 'Ordering coffee', goal: 'Order and pay politely.', turns: [{
      id: 'order', speaker: 'Serveur', fr: 'Vous désirez ?', en: 'What would you like?', audioId: 'order',
      prompt: 'Order a coffee politely.', choices: ['Un café, s’il vous plaît.', 'Où est la gare ?'], correctIndex: 0,
      explanation: 'S’il vous plaît makes the request polite.',
    }],
  }],
};

const words: Word[] = [{ id: 'pain', fr: 'le pain', en: 'bread', category: 'food' }];
const closers: { close(): void }[] = [];
const directories: string[] = [];
let requestSequence = 0;
const requestId = () => `learning-request-${++requestSequence}`;

type Export = {
  reviews: { id: string; due_at: number; fsrs: { reps: number }; item: { mode: string; itemId: string } }[];
  grades: { request_id: string; outcome: string; source: string; fsrsLog: unknown }[];
  phrases: { id: string }[];
  phraseSources: { phrase_id: string; source_id: string }[];
  materials: { lesson: ReadingLesson }[];
  tutorJobs: TutorJob[];
};

afterEach(() => {
  for (const closer of closers.splice(0)) closer.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'echo-learning-'));
  directories.push(directory);
  const dbPath = join(directory, 'nested', 'echo.db');
  const clock = { value: new Date('2026-09-22T10:00:00.000Z') };
  const open = () => {
    const store = createLearningStore(content, { dbPath, now: () => new Date(clock.value) });
    closers.push(store);
    return store;
  };
  const close = (store: LearningStore) => {
    store.close();
    closers.splice(closers.indexOf(store), 1);
  };
  return { store: open(), open, close, clock, dbPath };
}

function attempt(overrides: Partial<LearningAttemptInput> = {}): LearningAttemptInput {
  return { requestId: requestId(), kind: 'listening', itemId: 'bread', mode: 'meaning', answer: 'Bread', assisted: false, ...overrides };
}

function savePhrase(store: LearningStore, overrides: Partial<Parameters<LearningStore['savePhrase']>[0]> = {}) {
  return store.savePhrase({ requestId: requestId(), fr: 'Je voudrais du pain.', en: 'I would like some bread.', explanation: 'A polite request.', sourceId: 'bread', ...overrides });
}

function exported(store: LearningStore): Export {
  return store.exportData() as Export;
}

function expectStatus(run: () => unknown, status: number): void {
  let caught: unknown;
  try { run(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(StoreError);
  if (!(caught instanceof StoreError)) throw new Error('Expected a StoreError.');
  expect(caught.status).toBe(status);
}

describe('authored answer grading', () => {
  test('normalizes harmless punctuation, case and apostrophe spacing without removing words', () => {
    const { store } = fixture();
    const correct = store.attempt(attempt({ mode: 'dictation', answer: "  J ’ AI ACHETÉ, du pain — À l ’ épicerie !  " }));
    expect(correct).toMatchObject({ kind: 'correct', outcome: 'independent' });
    const missing = store.attempt(attempt({ mode: 'dictation', answer: 'J’ai acheté à l’épicerie.' }));
    expect(missing).toMatchObject({ kind: 'incorrect', outcome: 'revisit' });
    expect(store.progress().due.map((item) => item.id)).toContain(missing.reviewId);
  });

  test('accent-only spelling receives targeted feedback but no independent credit', () => {
    const { store } = fixture();
    const spelling = store.attempt(attempt({ mode: 'dictation', answer: "J'ai achete du pain a l'epicerie." }));
    expect(spelling).toMatchObject({ kind: 'spelling', outcome: 'helped', answer: content.listening[0]!.fr });
    expect(store.progress().skills.find((skill) => skill.id === 'listening')).toMatchObject({ independent: 0, helped: 1, revisit: 0 });
    expect(store.progress().due.map((item) => item.id)).toContain(spelling.reviewId);
    const wrongWords = store.attempt(attempt({ mode: 'dictation', answer: "J'ai achete du lait a l'epicerie." }));
    expect(wrongWords).toMatchObject({ kind: 'incorrect', outcome: 'revisit' });
  });

  test('grades authored alternatives, choice distractors, and assistance separately', () => {
    const { store } = fixture();
    expect(store.attempt(attempt({ mode: 'gap', answer: 'Un peu de pain !' }))).toMatchObject({ kind: 'correct', outcome: 'independent' });
    expect(store.attempt(attempt({ assisted: true }))).toMatchObject({ kind: 'correct', outcome: 'helped' });
    expect(store.attempt(attempt({ kind: 'conversation', itemId: 'cafe', mode: 'reply', exerciseIndex: 0, answer: 'Où est la gare ?' })))
      .toMatchObject({ kind: 'incorrect', outcome: 'revisit' });
    expect(store.attempt(attempt({ kind: 'conversation', itemId: 'cafe', mode: 'reply', exerciseIndex: 0, answer: 'Un café, s’il vous plaît.' })))
      .toMatchObject({ kind: 'correct', outcome: 'helped' });
  });

  test('keeps curated source-grounded clozes rather than replacing them with whole annotations', () => {
    const { store } = fixture();
    const input = attempt({ kind: 'material', itemId: 'message', mode: 'practice', exerciseIndex: 0, answer: 'gare' });
    expect(store.attempt(input)).toMatchObject({ kind: 'correct', outcome: 'independent', answer: 'gare' });
    expect(store.attempt({ ...input, requestId: requestId(), answer: 'à la gare' })).toMatchObject({ kind: 'incorrect', outcome: 'revisit' });
  });

  test('correcting a miss is helped; a later due recall can be independent', () => {
    const { store, clock } = fixture();
    const miss = store.attempt(attempt({ answer: 'A ticket' }));
    expect(miss.outcome).toBe('revisit');
    const correction = store.attempt(attempt());
    expect(correction).toMatchObject({ kind: 'correct', outcome: 'helped', reviewId: miss.reviewId });
    const scheduled = exported(store).reviews.find((item) => item.id === correction.reviewId)!;
    expect(scheduled.due_at).toBeGreaterThan(clock.value.getTime());
    expect(store.progress().due.map((item) => item.id)).not.toContain(correction.reviewId);
    clock.value = new Date(scheduled.due_at);
    expect(store.progress().due.map((item) => item.id)).toContain(correction.reviewId);
    expect(store.attempt(attempt()).outcome).toBe('independent');
    expect(store.progress().goingWell).toContainEqual({ title: 'At the shop · Meaning', skill: 'listening', successes: 1, attempts: 3, source: 'prepared' });
  });

  test('correct early rehearsal neither creates independent credit nor extends its interval', () => {
    const { store } = fixture();
    const first = store.attempt(attempt());
    const scheduled = exported(store).reviews.find((item) => item.id === first.reviewId)!;
    expect(store.attempt(attempt()).outcome).toBe('helped');
    expect(exported(store).reviews.find((item) => item.id === first.reviewId)).toEqual(scheduled);
    expect(store.progress().skills.find((skill) => skill.id === 'listening')).toMatchObject({ attempts: 2, independent: 1, helped: 1 });
  });

  test('rejects unknown lessons, indexes, modes and non-authored choices without recording progress', () => {
    const { store } = fixture();
    const invalid: [Partial<LearningAttemptInput>, number][] = [
      [{ itemId: 'missing' }, 404],
      [{ answer: 'An invented answer' }, 400],
      [{ mode: 'reply' }, 400],
      [{ exerciseIndex: 0 }, 400],
      [{ kind: 'conversation', itemId: 'cafe', mode: 'reply', exerciseIndex: -1 }, 400],
      [{ kind: 'conversation', itemId: 'cafe', mode: 'reply', exerciseIndex: 0.5 }, 400],
      [{ kind: 'conversation', itemId: 'cafe', mode: 'reply', exerciseIndex: 1 }, 404],
      [{ kind: 'material', itemId: 'missing', mode: 'practice', exerciseIndex: 0 }, 404],
      [{ kind: 'material', itemId: 'message', mode: 'practice', exerciseIndex: 1 }, 404],
    ];
    for (const [input, status] of invalid) expectStatus(() => store.attempt(attempt(input)), status);
    expect(exported(store).grades).toEqual([]);
    expect(store.progress().due).toEqual([]);
  });
});

describe('idempotent mutations and phrase scheduling', () => {
  test('attempt replay returns original feedback without regrading; changed payload and cross-action reuse conflict', () => {
    const { store } = fixture();
    const input = attempt();
    const feedback = store.attempt(input);
    store.attempt(attempt({ answer: 'A ticket' }));
    expect(store.attempt(input)).toEqual(feedback);
    expect(exported(store).grades).toHaveLength(2);
    expectStatus(() => store.attempt({ ...input, answer: 'A ticket' }), 409);
    expectStatus(() => savePhrase(store, { requestId: input.requestId }), 409);
    expect(store.progress().needsPractice).toContainEqual({ title: 'At the shop · Meaning', skill: 'listening', misses: 1, attempts: 2, source: 'prepared' });
  });

  test('deduplicates phrases across punctuation and sources while retaining independent direction cards', () => {
    const { store } = fixture();
    const first = savePhrase(store);
    const second = savePhrase(store, { fr: 'JE VOUDRAIS du pain!', en: 'I WOULD LIKE SOME BREAD', sourceId: 'message' });
    expect(second.id).toBe(first.id);
    expect(exported(store).phrases.map((phrase) => phrase.id)).toEqual([first.id]);
    expect(exported(store).phraseSources.map((source) => source.source_id).sort()).toEqual(['bread', 'message']);
    const due = store.progress().due;
    expect(due.map((item) => [item.mode, item.skill]).sort()).toEqual([['en-fr', 'production'], ['fr-en', 'recognition']]);
    expect(new Set(due.map((item) => item.id)).size).toBe(2);
    const recognition = due.find((item) => item.mode === 'fr-en')!;
    store.review({ requestId: requestId(), reviewId: recognition.id, known: true });
    expect(store.progress().due.map((item) => item.mode)).toEqual(['en-fr']);
    const production = due.find((item) => item.mode === 'en-fr')!;
    store.review({ requestId: requestId(), reviewId: production.id, known: false });
    expect(store.progress().due.map((item) => item.mode)).toEqual(['en-fr']);
    expect(store.progress().goingWell.find((topic) => topic.skill === 'recognition')).toMatchObject({ attempts: 1, successes: 1, source: 'self-rated' });
    expect(store.progress().needsPractice.find((topic) => topic.skill === 'production')).toMatchObject({ attempts: 1, misses: 1, source: 'self-rated' });
  });

  test('phrase and review request retries do not create cards or advance FSRS twice', () => {
    const { store, clock } = fixture();
    const phraseRequest = { requestId: requestId(), fr: 'À demain !', en: 'See you tomorrow!', explanation: '', sourceId: 'message' };
    expect(store.savePhrase(phraseRequest)).toEqual(store.savePhrase(phraseRequest));
    expectStatus(() => store.savePhrase({ ...phraseRequest, fr: 'À bientôt !' }), 409);
    const card = store.progress().due.find((item) => item.mode === 'fr-en')!;
    const input = { requestId: requestId(), reviewId: card.id, known: true };
    store.review(input);
    const scheduled = exported(store).reviews.find((item) => item.id === card.id)!;
    expect(scheduled.due_at).toBeGreaterThan(clock.value.getTime());
    expect(store.review(input).due.map((item) => item.id)).not.toContain(card.id);
    expect(exported(store).reviews.find((item) => item.id === card.id)).toEqual(scheduled);
    expect(exported(store).grades).toHaveLength(1);
    expectStatus(() => store.review({ ...input, known: false }), 409);
    expectStatus(() => store.review({ ...input, requestId: requestId() }), 409);
    clock.value = new Date(scheduled.due_at - 1);
    expect(store.progress().due.map((item) => item.id)).not.toContain(card.id);
    clock.value = new Date(scheduled.due_at);
    expect(store.progress().due.map((item) => item.id)).toContain(card.id);
  });

  test('a self-rated miss is immediately available and its corrective recall is helped', () => {
    const { store } = fixture();
    savePhrase(store);
    const card = store.progress().due[0]!;
    store.review({ requestId: requestId(), reviewId: card.id, known: false });
    expect(store.progress().due.map((item) => item.id)).toContain(card.id);
    store.review({ requestId: requestId(), reviewId: card.id, known: true });
    expect(store.progress().due.map((item) => item.id)).not.toContain(card.id);
    const grades = exported(store).grades;
    expect(grades.map((grade) => grade.outcome)).toEqual(['revisit', 'helped']);
    expect(grades.every((grade) => grade.source === 'self-rated')).toBe(true);
  });

  test('review rejects unknown cards and cannot bypass prepared grading through self-rating', () => {
    const { store } = fixture();
    expectStatus(() => store.review({ requestId: requestId(), reviewId: 'missing', known: true }), 404);
    const activity = store.attempt(attempt({ answer: 'A ticket' }));
    expectStatus(() => store.review({ requestId: requestId(), reviewId: activity.reviewId, known: true }), 400);
    expect(exported(store).grades.map((grade) => grade.outcome)).toEqual(['revisit']);
  });
});

describe('grounded imported materials and durable tutor drafts', () => {
  test('imports only exact whole phrases, preserves submitted text, and grades clozes from those phrases', () => {
    const { store } = fixture();
    const text = 'Le chat est à la fenêtre. À la fenêtre, il regarde la rue.';
    const material = store.storeMaterial({
      sourceId: 'my-note', title: 'My window note', text,
      explanation: {
        translation: 'The cat is at the window. At the window, it watches the street.', explanation: 'A short description.',
        annotations: [
          { phrase: 'à la fenêtre', translation: 'at the window', explanation: 'A location phrase.' },
          { phrase: 'la rue', translation: 'the street', explanation: 'A feminine noun.' },
          { phrase: 'la gare', translation: 'the station', explanation: 'Not in the source.' },
          { phrase: 'chat', translation: 'cat', explanation: 'An animal.' },
          { phrase: 'ha', translation: 'invented substring', explanation: 'Not a standalone phrase.' },
          { phrase: 'à la fenêtre', translation: 'duplicate', explanation: 'Repeated annotation.' },
        ],
      },
    });
    expect(material.fr).toBe(text);
    expect(material.annotations.map((annotation) => annotation.phrase)).toEqual(['à la fenêtre', 'la rue', 'chat']);
    expect(material.practice?.map((practice) => practice.answer)).toEqual(['à la fenêtre', 'la rue', 'chat']);
    expect(material.practice?.[0]?.prompt).toContain('Le chat est ____.');
    expect(material.practice?.[0]?.prompt).not.toContain('il regarde');
    expect(store.materials()).toContainEqual({ id: material.id, title: 'My window note', kind: 'imported' });
    const input = attempt({ kind: 'material', itemId: material.id, mode: 'practice', exerciseIndex: 0, answer: 'à la fenêtre' });
    expect(store.attempt(input)).toMatchObject({ kind: 'correct', outcome: 'independent', answer: 'à la fenêtre' });
    expect(store.attempt({ ...input, requestId: requestId(), answer: 'à la gare' })).toMatchObject({ kind: 'incorrect', outcome: 'revisit' });
    const duplicate = store.storeMaterial({ sourceId: 'my-note', text, explanation: { translation: 'Changed', explanation: '', annotations: [] } });
    expect(duplicate).toEqual(material);
    expect(exported(store).materials.map((record) => record.lesson)).toEqual([material]);
  });

  test('clozes keep a complete cross-sentence phrase without repeating unrelated material', () => {
    const { store } = fixture();
    const text = 'Avant, il range ses affaires. Il ferme la porte. Puis il part. Après, il prend le bus.';
    const phrase = 'la porte. Puis il part';
    const material = store.storeMaterial({
      sourceId: 'sentence-boundary', text,
      explanation: {
        translation: 'He gets ready and leaves.', explanation: '',
        annotations: [{ phrase, translation: 'the door. Then he leaves', explanation: 'Two actions in sequence.' }],
      },
    });
    expect(material.fr).toBe(text);
    expect(material.practice?.[0]?.answer).toBe(phrase);
    expect(material.practice?.[0]?.prompt).toContain('Il ferme ____.');
    expect(material.practice?.[0]?.prompt).not.toContain('ses affaires');
    expect(material.practice?.[0]?.prompt).not.toContain('le bus');
    expect(store.attempt(attempt({ kind: 'material', itemId: material.id, mode: 'practice', exerciseIndex: 0, answer: phrase }))).toMatchObject({ kind: 'correct', outcome: 'independent' });
  });

  test('a whole-sentence cloze gives an English cue without revealing its French answer', () => {
    const { store } = fixture();
    const phrase = 'Nous achetons du pain.';
    const translation = 'We buy bread.';
    const material = store.storeMaterial({
      sourceId: 'whole-sentence', text: phrase,
      explanation: { translation, explanation: '', annotations: [{ phrase, translation, explanation: '' }] },
    });
    const exercise = material.practice![0]!;
    expect(exercise.prompt).toContain(translation);
    expect(exercise.prompt).toContain('____');
    expect(exercise.prompt).not.toContain(phrase);
    expect(store.attempt(attempt({ kind: 'material', itemId: material.id, mode: 'practice', exerciseIndex: 0, answer: phrase }))).toMatchObject({ kind: 'correct', outcome: 'independent' });
  });

  test('an import with no grounded annotation stays readable without invented exercises', () => {
    const { store } = fixture();
    const material = store.storeMaterial({ sourceId: 'text', text: 'Bonjour.', explanation: { translation: 'Hello.', explanation: '', annotations: [{ phrase: 'Salut', translation: 'Hi', explanation: '' }] } });
    expect(material.annotations).toEqual([]);
    expect(material.practice).toEqual([]);
    expect(store.material(material.id).fr).toBe('Bonjour.');
    expectStatus(() => store.attempt(attempt({ kind: 'material', itemId: material.id, mode: 'practice', exerciseIndex: 0, answer: 'Salut' })), 404);
  });

  test('tutor request retries return the live job; results and errors never create mastery', () => {
    const { store } = fixture();
    const input = { requestId: requestId(), kind: 'writing' as const, text: 'Je va au café.', sourceId: 'message', prompt: 'Say where you are going.' };
    const created = store.createTutorJob(input);
    expect(created.isNew).toBe(true);
    store.updateTutorJob(created.job.id, { status: 'working', progress: 'Reviewing the submitted text.' });
    const retry = store.createTutorJob(input);
    expect(retry).toMatchObject({ isNew: false, job: { id: created.job.id, status: 'working', input } });
    expectStatus(() => store.createTutorJob({ ...input, text: 'Different text' }), 409);
    const result = { kind: 'writing' as const, feedback: { corrected: 'Je vais au café.', summary: 'Use vais with je.', errors: [{ original: 'va', replacement: 'vais', explanation: 'First person.' }], suggestions: [] } };
    store.updateTutorJob(created.job.id, { status: 'releasing', progress: 'Releasing the model.', result });
    store.updateTutorJob(created.job.id, { status: 'complete', progress: 'Done.' });
    expect(store.getTutorJob(created.job.id)?.result).toEqual(result);
    expect(store.lastTutorJob('message', 'writing')?.id).toBe(created.job.id);
    expect(store.progress().skills.map((skill) => skill.attempts)).toEqual([0, 0, 0]);
    expect(exported(store).grades).toEqual([]);
    expectStatus(() => store.updateTutorJob('missing', { status: 'error' }), 404);
  });

  test('restart cancels every interrupted phase, preserving full submissions and completed results', () => {
    const { store, open, close } = fixture();
    const unfinished = (['queued', 'loading', 'working', 'releasing'] as const).map((status) => {
      const { job } = store.createTutorJob({ requestId: requestId(), kind: 'writing', text: `Texte conservé — ${status}\nEncore une ligne.`, sourceId: status });
      store.updateTutorJob(job.id, { status, progress: 'In progress.' });
      return job;
    });
    const completed = store.createTutorJob({ requestId: requestId(), kind: 'writing', text: 'Bonjour.', sourceId: 'complete' }).job;
    const result = { kind: 'writing' as const, feedback: { corrected: 'Bonjour.', summary: 'A greeting.', errors: [], suggestions: [] } };
    store.updateTutorJob(completed.id, { status: 'complete', progress: 'Done.', result });
    const failed = store.createTutorJob({ requestId: requestId(), kind: 'material', text: 'Un texte.', sourceId: 'error' }).job;
    store.updateTutorJob(failed.id, { status: 'error', progress: 'Stopped.', error: 'Model unavailable.' });
    close(store);
    const restarted = open();
    for (const job of unfinished) {
      expect(restarted.getTutorJob(job.id)).toMatchObject({ status: 'cancelled', input: job.input });
      expect(restarted.createTutorJob(job.input)).toMatchObject({ isNew: false, job: { status: 'cancelled' } });
    }
    expect(restarted.getTutorJob(completed.id)).toMatchObject({ status: 'complete', result });
    expect(restarted.getTutorJob(failed.id)).toMatchObject({ status: 'error', error: 'Model unavailable.', input: failed.input });
    expect(restarted.progress().due).toEqual([]);
  });

  test('restart retains attempts, schedules, phrase deduplication and imported materials', () => {
    const { store, open, close } = fixture();
    const phrase = savePhrase(store);
    const recognition = store.progress().due.find((item) => item.mode === 'fr-en')!;
    store.review({ requestId: requestId(), reviewId: recognition.id, known: true });
    const scheduled = exported(store).reviews.find((item) => item.id === recognition.id)!;
    const input = attempt({ answer: 'A ticket' });
    const feedback = store.attempt(input);
    const material = store.storeMaterial({ sourceId: 'own', text: 'Je pars demain.', explanation: { translation: 'I leave tomorrow.', explanation: '', annotations: [{ phrase: 'demain', translation: 'tomorrow', explanation: '' }] } });
    const before = store.progress();
    close(store);
    const restarted = open();
    expect(restarted.progress()).toEqual(before);
    expect(exported(restarted).reviews.find((item) => item.id === recognition.id)).toEqual(scheduled);
    expect(restarted.attempt(input)).toEqual(feedback);
    expect(savePhrase(restarted).id).toBe(phrase.id);
    expect(restarted.material(material.id)).toEqual(material);
    expect(exported(restarted).grades).toHaveLength(2);
  });
});

describe('existing vocabulary and grammar integration', () => {
  test('schema setup leaves existing progress untouched and overview uses its counters and undo-aware provenance', () => {
    const { dbPath, clock, store: original, close } = fixture();
    close(original);
    const vocabulary = createStore(words, { dbPath, now: () => new Date(clock.value) });
    closers.push(vocabulary);
    let state = vocabulary.start('fr-en', 'all');
    const current = state.current!;
    state = vocabulary.grade({ direction: 'fr-en', deck: 'all', requestId: 'vocab-one', wordId: current.id, version: current.version, known: true });
    const before = vocabulary.exportData();
    const store = createLearningStore(content, { dbPath, vocabulary, words, now: () => new Date(clock.value) });
    closers.push(store);
    expect(vocabulary.exportData()).toEqual(before);
    const summary = store.progress();
    expect(summary.vocabulary.find((item) => item.direction === 'fr-en')).toEqual({ direction: 'fr-en', unseenActive: state.overview.unseenActive, seenActive: state.overview.seenActive, remaining: state.overview.remaining });
    expect(summary.goingWell).toContainEqual({ title: 'le pain · French → English', skill: 'recognition', successes: 1, attempts: 1, source: 'self-rated' });
    vocabulary.undo('fr-en', 'all', 'vocab-one');
    expect(store.progress().goingWell).toEqual([]);
    expect(store.progress().skills.find((skill) => skill.id === 'recognition')?.attempts).toBe(0);
    const db = new Database(dbPath, { readonly: true });
    expect(db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM grades').get()?.count).toBe(1);
    db.close();
  });

  test('grammar overview preserves independent, helped and revisit outcomes without substituting latest-round results', () => {
    const { dbPath, clock } = fixture();
    const topic: GrammarTopicContent = {
      id: 'location', unit: 'places', level: 'A1', title: 'Locations', description: 'Express locations.', mark: 'à', rule: 'Use the location preposition.', example: 'Je suis à Paris.', aside: 'Cities use à.',
      exercises: [0, 1, 2].map((index) => ({ id: `location-${index}`, pattern: `location-${index}`, type: 'complete' as const, instruction: 'Complete the sentence.', source: 'Je suis ____ Paris.', answers: ['à'], hint: 'Use à.', explanation: 'À introduces a city.', feedback: 'Check the preposition.' })),
    };
    const units = [{ id: 'places', title: 'Places', description: 'Where things are.', topics: ['location'] }];
    const grammar = createGrammarStore({ units, topics: [topic] }, { dbPath, now: () => new Date(clock.value) });
    closers.push(grammar);
    let state = grammar.start('location', requestId());
    const mutation = () => ({ sessionId: state.session!.id, exerciseId: state.session!.current!.exercise.id, version: state.session!.version, requestId: requestId() });
    state = grammar.answer({ ...mutation(), answer: 'à' });
    state = grammar.next(mutation());
    state = grammar.help({ ...mutation(), kind: 'hint' });
    state = grammar.answer({ ...mutation(), answer: 'à' });
    state = grammar.next(mutation());
    state = grammar.help({ ...mutation(), kind: 'answer' });
    state = grammar.next(mutation());
    state = grammar.start('location', requestId());
    expect(state.session?.results).toEqual([]);
    const before = grammar.exportData();
    const learning = createLearningStore(content, { dbPath, grammar, now: () => new Date(clock.value) });
    closers.push(learning);
    expect(learning.progress().grammar).toEqual([{ title: 'Locations', independent: 1, helped: 1, revisit: 1 }]);
    expect(grammar.exportData()).toEqual(before);
  });
});
