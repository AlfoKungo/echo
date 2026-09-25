import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStory, firstStep, measure, nextStep, planFor, storyProblems, type StoryCheck, type StoryEpisode, type StoryKnowledge } from '../lib/story';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const known = { ids: new Set(['maison', 'chat', 'manger', 'grand']), forms: new Set(['avec', 'dans']) };
function check(overrides: Partial<StoryCheck> = {}): StoryCheck {
  return { known, introduced: { ids: new Set(), forms: new Set() }, deck: new Set(['maison', 'chat', 'manger', 'grand', 'souris', 'jardin']), recycle: [], plan: { ...planFor(5), lines: [2, 6], words: 200, newWords: [1, 2], coverage: 0.7 }, ...overrides };
}
// Two lines: every word known except "souris" (new), "Léa" (a name).
function episode(overrides: Partial<StoryEpisode> = {}): StoryEpisode {
  return {
    id: 'story-01', number: 1, title: 'La souris', titleEn: 'The mouse', level: 'A2', step: 5,
    focus: { topic: 'present-er', title: 'Present tense', note: 'Mange is the present of manger.' },
    lines: [{ fr: 'Léa mange dans la grande maison.', en: 'Léa eats in the big house.' }, { fr: 'Le chat mange avec la souris.', en: 'The cat eats with the mouse.', speaker: 'Léa' }],
    gloss: [
      { fr: 'Léa', en: 'Léa (a name)', name: true }, { fr: 'mange', en: 'eats (manger)', word: 'manger' }, { fr: 'dans', en: 'in' },
      { fr: 'grande', en: 'big', word: 'grand' }, { fr: 'maison', en: 'house', word: 'maison' }, { fr: 'chat', en: 'cat', word: 'chat' },
      { fr: 'avec', en: 'with' }, { fr: 'souris', en: 'mouse', word: 'souris' },
    ],
    questions: Array.from({ length: 3 }, (_, index) => ({ question: `Question ${index}?`, choices: ['A', 'B', 'C'], answer: 0, explanation: 'Because.' })),
    newWords: [], recycled: [], summary: 'Léa eats.', coverage: 0, writtenAt: '2026-01-01T00:00:00Z', ...overrides,
  };
}

describe('the plan and its steps', () => {
  test('a harder step asks for more new words, fewer known words and a longer episode', () => {
    const easy = planFor(0), hard = planFor(10);
    expect(easy.level).toBe('A1');
    expect(hard.level).toBe('B1');
    expect(hard.newWords[0]).toBeGreaterThan(easy.newWords[0]);
    expect(hard.coverage).toBeLessThan(easy.coverage);
    expect(hard.words).toBeGreaterThan(easy.words);
    expect(planFor(99).step).toBe(10);
  });

  test('the first step follows the Read level', () => {
    expect(firstStep(1)).toBe(0);
    expect(firstStep(2.3)).toBe(5);
    expect(firstStep(3.99)).toBe(10);
  });

  test('an easy read moves up, a hard one down, anything else stays', () => {
    const shape = { gloss: Array.from({ length: 40 }, () => ({ fr: 'x', en: 'x' })), lines: Array.from({ length: 10 }, () => ({ fr: 'x', en: 'x' })) };
    expect(nextStep(5, { taps: ['a'], linesOpened: 0, right: 3, total: 3, finishedAt: '' }, shape)).toBe(6);
    expect(nextStep(5, { taps: ['a'], linesOpened: 0, right: 2, total: 3, finishedAt: '' }, shape)).toBe(5);
    expect(nextStep(5, { taps: Array.from({ length: 7 }, (_, i) => `w${i}`), linesOpened: 0, right: 3, total: 3, finishedAt: '' }, shape)).toBe(4);
    expect(nextStep(5, { taps: [], linesOpened: 4, right: 3, total: 3, finishedAt: '' }, shape)).toBe(4);
    expect(nextStep(0, { taps: [], linesOpened: 0, right: 0, total: 3, finishedAt: '' }, shape)).toBe(0);
    expect(nextStep(10, { taps: [], linesOpened: 0, right: 3, total: 3, finishedAt: '' }, shape)).toBe(10);
  });
});

describe('the coverage check', () => {
  test('marks unknown words new, whatever Claude flagged, and counts running words', () => {
    const flagged = episode({ gloss: episode().gloss.map((entry) => entry.fr === 'chat' ? { ...entry, new: true as const } : entry) });
    const measured = measure(flagged, check());
    expect(measured.newWords).toEqual(['souris']);
    expect(measured.gloss.find((entry) => entry.fr === 'chat')?.new).toBeUndefined();
    // 12 running words (6 a line), one of them unknown.
    expect(measured.coverage).toBe(Math.round((1 - 1 / 12) * 1000) / 1000);
  });

  test('a well-built episode passes', () => {
    expect(storyProblems(episode(), check())).toEqual([]);
  });

  test('a little word is known even capitalised and glossed', () => {
    const opening = episode({ lines: [{ fr: 'Un chat mange.', en: 'A cat eats.' }], gloss: [{ fr: 'Un', en: 'a' }, { fr: 'chat', en: 'cat', word: 'chat' }, { fr: 'mange', en: 'eats', word: 'manger' }] });
    expect(measure(opening, check())).toMatchObject({ newWords: [], coverage: 1 });
  });

  test('a phrase whose parts are all known is known, even unlinked', () => {
    const phrase = episode({ lines: [{ fr: 'C’est dans la maison.', en: 'It is in the house.' }], gloss: [{ fr: 'C’est', en: 'it is' }, { fr: 'dans', en: 'in' }, { fr: 'maison', en: 'house', word: 'maison' }] });
    const taught = check({ known: { ids: known.ids, forms: new Set([...known.forms, 'est']) } });
    expect(measure(phrase, taught).newWords).toEqual([]);
    expect(measure(phrase, check()).newWords).toEqual(['C’est']);
  });

  test('too many unknown words, too low coverage and a missing recycle are all reported', () => {
    const strict = check({ known: { ids: new Set(['chat']), forms: new Set() }, plan: { ...check().plan, newWords: [1, 2], coverage: 0.95 }, recycle: [{ fr: 'jardin', word: 'jardin' }, { fr: 'souris' }] });
    const problems = storyProblems(episode(), strict);
    expect(problems.some((problem) => problem.includes('at most 2 may be new'))).toBe(true);
    expect(problems.some((problem) => problem.includes('running words are new words; at most'))).toBe(true);
    // "souris" is back, "jardin" is not: one of two is enough.
    expect(problems.some((problem) => problem.includes('brings back'))).toBe(false);
    const both = check({ recycle: [{ fr: 'jardin', word: 'jardin' }, { fr: 'poisson' }] });
    expect(storyProblems(episode(), both).some((problem) => problem.includes('brings back 0'))).toBe(true);
  });

  test('earlier episodes’ words count as known', () => {
    const taught = check({ introduced: { ids: new Set(['souris']), forms: new Set() }, plan: { ...check().plan, newWords: [0, 2] } });
    expect(measure(episode(), taught).newWords).toEqual([]);
  });

  test('an unglossed word and a mislinked id are reported', () => {
    const broken = episode({ gloss: episode().gloss.filter((entry) => entry.fr !== 'avec').map((entry) => entry.fr === 'chat' ? { ...entry, word: 'chien' } : entry) });
    const problems = storyProblems(broken, check());
    expect(problems.some((problem) => problem.includes('no gloss covers avec'))).toBe(true);
    expect(problems.some((problem) => problem.includes('unknown vocabulary id chien'))).toBe(true);
  });
});

describe('the story store', () => {
  const knowledge = (): StoryKnowledge => ({
    known: [{ id: 'maison', fr: 'la maison', en: 'house' }, { id: 'chat', fr: 'le chat', en: 'cat' }, { id: 'manger', fr: 'manger', en: 'to eat' }, { id: 'grand', fr: 'grand', en: 'big' }],
    deck: [{ id: 'maison', fr: 'la maison' }, { id: 'chat', fr: 'le chat' }, { id: 'manger', fr: 'manger' }, { id: 'grand', fr: 'grand' }, { id: 'souris', fr: 'la souris' }],
    forms: ['avec', 'dans'], level: 2.3,
    topics: [{ id: 'present-er', title: 'Present tense', level: 'A1', description: 'Regular -er verbs.', seen: 0, independent: 0 }],
  });
  // A reply for step 5 (A2: 10–14 lines, 4–6 new words, 93% known): 74 running words, 4 of them new.
  const lines = [
    ['Léa mange dans la grande maison avec le chat.', 'Léa eats in the big house with the cat.'], ['Le chat mange avec Léa dans la maison.', 'The cat eats with Léa in the house.'],
    ['Elle mange et il mange avec elle.', 'She eats and he eats with her.'], ['La souris mange dans la maison.', 'The mouse eats in the house.'],
    ['Le chat mange avec Léa et elle mange avec le chat.', 'The cat eats with Léa and she eats with the cat.'], ['Le fromage est dans la grande maison.', 'The cheese is in the big house.'],
    ['Léa mange dans le jardin avec le chat.', 'Léa eats in the garden with the cat.'], ['Le grand chat mange.', 'The big cat eats.'],
    ['Elle mange avec le chat dans la maison.', 'She eats with the cat in the house.'], ['Le chat mange et Léa mange.', 'The cat eats and Léa eats.'],
  ];
  const reply = {
    title: 'La souris', titleEn: 'The mouse', focusNote: 'Mange is the present of manger.', summary: 'Léa, her cat and a mouse eat.',
    premise: 'Léa lives with a cat.', characters: [{ name: 'Léa', about: 'a young woman' }],
    lines: lines.map(([fr, en]) => ({ fr, en })),
    gloss: [
      { fr: 'Léa', en: 'Léa', name: true }, { fr: 'mange', en: 'eats (manger)', word: 'manger' }, { fr: 'dans', en: 'in' }, { fr: 'grande', en: 'big', word: 'grand' },
      { fr: 'grand', en: 'big', word: 'grand' }, { fr: 'maison', en: 'house', word: 'maison' }, { fr: 'chat', en: 'cat', word: 'chat' }, { fr: 'avec', en: 'with' },
      { fr: 'souris', en: 'mouse', word: 'souris', new: true }, { fr: 'fromage', en: 'cheese', new: true }, { fr: 'est', en: 'is (être)', new: true }, { fr: 'jardin', en: 'garden', new: true },
    ],
    questions: Array.from({ length: 3 }, (_, index) => ({ question: `Question ${index}?`, choices: ['Right', 'Wrong', 'Also wrong'], explanation: 'Because.' })),
  };
  function story(ask: (prompt: string) => string) {
    const directory = mkdtempSync(join(tmpdir(), 'echo-story-'));
    directories.push(directory);
    const prompts: string[] = [];
    const recorded: string[][] = [];
    const store = createStory({
      dir: join(directory, 'story'), dbPath: join(directory, 'echo.db'), knowledge, clipExists: () => false, random: () => 0.5,
      ask: async (prompt) => { prompts.push(prompt); return ask(prompt); }, record: async (ids) => { recorded.push(ids); },
    });
    return { store, prompts, recorded };
  }

  test('writes the first episode, reviewed, records its lines, and waits until it is finished', async () => {
    const { store, prompts, recorded } = story((prompt) => JSON.stringify(prompt.startsWith('You are a French teacher') ? { episode: reply, changes: [] } : reply));
    expect(store.status()).toMatchObject({ episodes: [], writing: true });
    await store.check();
    expect(prompts.map((prompt) => prompt.slice(0, 20))).toEqual(['You write a serial s', 'You are a French tea']);
    const view = store.view(1);
    expect(view.episode.newWords.sort()).toEqual(['est', 'fromage', 'jardin', 'souris']);
    expect(view.episode.questions.every((question) => question.choices[question.answer] === 'Right')).toBe(true);
    expect(recorded).toEqual([lines.map((_, index) => `story-01-${index + 1}`)]);
    expect(store.status().writing).toBe(false);
    await store.check();
    expect(prompts).toHaveLength(2);
  });

  test('finishing counts the answers and brings the tapped words back in the next prompt', async () => {
    const { store, prompts } = story((prompt) => JSON.stringify(prompt.startsWith('You are a French teacher') ? { episode: reply, changes: [] } : reply));
    await store.check();
    const correct = store.view(1).episode.questions.map((question) => question.answer);
    expect(() => store.finish(1, { taps: [], linesOpened: 0, answers: [0], requestId: 'r' })).toThrow('Answer every question first.');
    const view = store.finish(1, { taps: ['fromage', 'not in the gloss'], linesOpened: 1, answers: [correct[0]!, correct[1]!, (correct[2]! + 1) % 3], requestId: 'r' });
    expect(view.read).toMatchObject({ taps: ['fromage'], linesOpened: 1, right: 2, total: 3 });
    expect(view.next).toBe('same');
    await store.check();
    const next = prompts.find((prompt) => prompt.includes('Write episode 2'))!;
    expect(next).toContain('Bring back at least');
    expect(next).toContain('fromage (cheese)');
    expect(next).toContain('Episode 1, "La souris": Léa, her cat and a mouse eat.');
  });

  test('a review that breaks the rules is dropped for the checked episode', async () => {
    const { store } = story((prompt) => JSON.stringify(prompt.startsWith('You are a French teacher') ? { episode: { ...reply, lines: reply.lines.slice(0, 2) }, changes: ['cut'] } : prompt.startsWith('You wrote this episode') ? { ...reply, lines: reply.lines.slice(0, 2) } : reply));
    await store.check();
    expect(store.view(1).episode.lines).toHaveLength(10);
  });

  test('a write that cannot be fixed is reported and tried again later', async () => {
    const { store } = story(() => JSON.stringify({ ...reply, lines: [] }));
    await store.check();
    expect(store.status()).toMatchObject({ episodes: [], error: expect.stringContaining('still broke') });
  });
});
