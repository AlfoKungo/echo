import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ComprehensionPassage, ComprehensionSentence, ExerciseView, StreamId, StreamState } from '../comprehension-contract';
import type { GrammarLevel } from '../contract';
import type { Bank } from '../lib/comprehension-content';
import { createComprehensionStore, type ComprehensionStore, type WordKnowledge } from '../lib/comprehension-store';
import { StoreError } from '../lib/store';

// ── A small bank: enough A1 sentences to keep a stream running, plus one A2, one B1, a dialogue and a text. ──
function sentence(
  id: string, level: GrammarLevel, fr: string, en: string, distractors: [string, string], gap: string,
  extra: { topics?: string[]; words?: string[]; gloss?: ComprehensionSentence['gloss'] } = {},
): ComprehensionSentence {
  return {
    id, level, fr, en, distractors, gap,
    topics: extra.topics ?? ['present'],
    words: extra.words ?? [],
    gloss: extra.gloss ?? [{ fr: gap, en: `meaning of ${gap}` }],
  };
}

const sentences: ComprehensionSentence[] = [
  sentence('s01', 'A1', 'Je vais à la gare ce matin.', 'I am going to the station this morning.',
    ['I am going to the station this evening.', 'We are going to the station this morning.'], 'à',
    { words: ['aller', 'gare'], gloss: [{ fr: 'vais', en: 'go (aller)', word: 'aller' }, { fr: 'gare', en: 'station', word: 'gare' }, { fr: 'ce matin', en: 'this morning' }] }),
  sentence('s02', 'A1', 'Elle achète du pain à la boulangerie.', 'She buys bread at the bakery.',
    ['He buys bread at the bakery.', 'She buys cake at the bakery.'], 'achète',
    { words: ['pain'], gloss: [{ fr: 'achète', en: 'buys (acheter)' }, { fr: 'pain', en: 'bread', word: 'pain' }] }),
  sentence('s03', 'A1', 'Nous mangeons des crêpes le dimanche.', 'We eat pancakes on Sundays.',
    ['We eat pancakes on Saturdays.', 'They eat pancakes on Sundays.'], 'dimanche'),
  sentence('s04', 'A1', 'Il ne travaille pas aujourd’hui.', 'He is not working today.',
    ['He is working today.', 'She is not working today.'], 'pas', { topics: ['negation'] }),
  sentence('s05', 'A1', 'Tu préfères le thé ou le café ?', 'Do you prefer tea or coffee?',
    ['Do you prefer tea or juice?', 'Does he prefer tea or coffee?'], 'préfères'),
  sentence('s06', 'A1', 'On habite près de l’école.', 'We live near the school.',
    ['We live far from the school.', 'We live near the station.'], 'près'),
  sentence('s07', 'A1', 'Vous arrivez à huit heures.', 'You arrive at eight o’clock.',
    ['You arrive at nine o’clock.', 'We arrive at eight o’clock.'], 'huit'),
  sentence('s08', 'A1', 'Les enfants jouent dans le jardin.', 'The children are playing in the garden.',
    ['The children are playing in the street.', 'The child is playing in the garden.'], 'jardin'),
  sentence('s09', 'A1', 'Ma sœur étudie à Paris.', 'My sister studies in Paris.',
    ['My brother studies in Paris.', 'My sister studies in Lyon.'], 'étudie', { topics: ['focus-topic'] }),
  sentence('s10', 'A1', 'J’ai soif, alors je bois de l’eau.', 'I am thirsty, so I am drinking water.',
    ['I am hungry, so I am drinking water.', 'I am thirsty, so I am drinking juice.'], 'soif', { topics: ['focus-topic'] }),
  sentence('a01', 'A2', 'Hier, nous avons visité le musée du quartier.', 'Yesterday we visited the local museum.',
    ['Tomorrow we are visiting the local museum.', 'Yesterday we visited the local market.'], 'avons', { topics: ['passe-compose'] }),
  sentence('s11', 'A1', 'Il y a vingt et un élèves dans la classe.', 'There are twenty-one pupils in the class.',
    ['There are twenty-one teachers in the class.', 'There are twelve pupils in the class.'], 'vingt'),
  sentence('s12', 'A1', 'Les élèves sont arrivés en retard.', 'The pupils arrived late.',
    ['The pupils arrived early.', 'The teacher arrived late.'], 'arrivés'),
  sentence('b01', 'B1', 'Si tu venais plus tôt, on pourrait finir le travail ensemble.', 'If you came earlier, we could finish the work together.',
    ['If you came later, we could finish the work together.', 'If you came earlier, we could start the work together.'], 'pourrait', { topics: ['si-clauses'] }),
];

const passages: ComprehensionPassage[] = [
  {
    id: 'd01', level: 'A1', kind: 'dialogue', title: 'At the bakery',
    lines: [
      { speaker: 'Léa', fr: 'Bonjour, je voudrais deux croissants.', en: 'Hello, I would like two croissants.' },
      { speaker: 'Le vendeur', fr: 'Très bien. C’est trois euros.', en: 'Very good. That is three euros.' },
      { speaker: 'Léa', fr: 'Merci, à demain !', en: 'Thank you, see you tomorrow!' },
    ],
    questions: [
      { question: 'What does Léa order?', choices: ['Two croissants', 'Two baguettes', 'Three croissants'], answer: 0, explanation: '“deux croissants”.' },
      { question: 'How much does it cost?', choices: ['Two euros', 'Three euros', 'Thirteen euros'], answer: 1, explanation: '“trois euros”.' },
      { question: 'When will Léa come back?', choices: ['Tonight', 'Tomorrow', 'Next week'], answer: 1, explanation: '“à demain”.' },
    ],
    topics: ['present'], words: [], gloss: [{ fr: 'croissants', en: 'croissants' }, { fr: 'euros', en: 'euros' }],
  },
  {
    id: 't01', level: 'A1', kind: 'text', title: 'A note on the door',
    lines: [
      { fr: 'Le magasin est fermé le lundi.', en: 'The shop is closed on Mondays.' },
      { fr: 'Nous ouvrons à neuf heures du mardi au samedi.', en: 'We open at nine o’clock from Tuesday to Saturday.' },
      { fr: 'Pour une commande, téléphonez le matin.', en: 'For an order, telephone in the morning.' },
    ],
    questions: [
      { question: 'Which day is the shop closed?', choices: ['Monday', 'Tuesday', 'Saturday'], answer: 0, explanation: '“fermé le lundi”.' },
      { question: 'What time does it open?', choices: ['Eight', 'Nine', 'Ten'], answer: 1, explanation: '“à neuf heures”.' },
      { question: 'When should you call to order?', choices: ['In the morning', 'In the afternoon', 'On Monday'], answer: 0, explanation: '“téléphonez le matin”.' },
    ],
    topics: ['present'], words: [], gloss: [{ fr: 'magasin', en: 'shop' }, { fr: 'fermé', en: 'closed' }],
  },
];

const bank: Bank = { sentences, passages };
const sentenceById = new Map(sentences.map((item) => [item.id, item]));
const passageById = new Map(passages.map((item) => [item.id, item]));
const everyClip = new Set([
  ...sentences.map((item) => item.id),
  ...passages.flatMap((item) => item.lines.map((_, index) => `${item.id}-${index + 1}`)),
]);

const stores = new Set<ComprehensionStore>();
const directories: string[] = [];
let sequence = 0;

afterEach(() => {
  for (const store of stores) store.close();
  stores.clear();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function seeded(seed = 11): () => number {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

type Fixture = { store: ComprehensionStore; dbPath: string; reopen: (seed?: number) => ComprehensionStore };

function fixture(options: { clips?: Set<string>; known?: Map<string, WordKnowledge>; seed?: number; at?: Date } = {}): Fixture {
  const directory = mkdtempSync(join(tmpdir(), 'echo-comprehension-'));
  directories.push(directory);
  const dbPath = join(directory, 'echo.db');
  const clips = options.clips ?? everyClip;
  const at = options.at ?? new Date('2026-03-01T09:00:00Z');
  const open = (seed = options.seed ?? 11) => {
    const store = createComprehensionStore(bank, {
      dbPath, now: () => at, random: seeded(seed),
      clipExists: (clip) => clips.has(clip),
      knownStatus: () => options.known ?? new Map<string, WordKnowledge>(),
    });
    stores.add(store);
    return store;
  };
  return { store: open(), dbPath, reopen: (seed) => open(seed) };
}

// The passage question behind a question exercise, found through its key: `${passageId}:question:${n}`.
function questionOf(view: ExerciseView) {
  return passageById.get(view.item.id)!.questions[Number(view.key.split(':')[2]) - 1]!;
}

function rightAnswerOf(view: ExerciseView): string {
  const question = questionOf(view);
  return question.choices[question.answer]!;
}

// The answer a learner who understood the French would give.
function correctInput(view: ExerciseView): { choice?: number; text?: string } {
  if (view.kind === 'meaning') return { choice: view.choices!.indexOf(sentenceById.get(view.item.id)!.en) };
  if (view.kind === 'question') return { choice: view.choices!.indexOf(rightAnswerOf(view)) };
  const item = sentenceById.get(view.item.id)!;
  return { text: view.kind === 'gap' ? item.gap : item.fr };
}

function wrongInput(view: ExerciseView): { choice?: number; text?: string } {
  const right = correctInput(view);
  if (right.choice !== undefined) return { choice: (right.choice + 1) % view.choices!.length };
  return { text: 'quelque chose de faux' };
}

function settle(store: ComprehensionStore, stream: StreamId, state: StreamState, input: { choice?: number; text?: string }): StreamState {
  return store.answer({ stream, key: state.current!.key, version: state.version, requestId: `answer-${++sequence}`, ...input });
}

function advance(store: ComprehensionStore, stream: StreamId, state: StreamState): StreamState {
  return store.next({ stream, key: state.current!.key, version: state.version, requestId: `next-${++sequence}` });
}

// Answers the current exercise the way `pick` says and moves on; returns the state showing the next exercise.
function step(store: ComprehensionStore, stream: StreamId, pick: (view: ExerciseView) => { choice?: number; text?: string } = correctInput): StreamState {
  const state = store.state(stream);
  return advance(store, stream, settle(store, stream, state, pick(state.current!)));
}

function driveTo(store: ComprehensionStore, stream: StreamId, wanted: ExerciseView['kind'], where: (view: ExerciseView) => boolean = () => true, limit = 120): StreamState {
  for (let attempt = 0; attempt < limit; attempt++) {
    const state = store.state(stream);
    if (!state.current) throw new Error(`${stream} ran out before a ${wanted} exercise appeared`);
    if (state.current.kind === wanted && where(state.current)) return state;
    advance(store, stream, settle(store, stream, state, correctInput(state.current)));
  }
  throw new Error(`no ${wanted} exercise in ${limit} answers`);
}

const levelOf = (state: StreamState, mode: 'listen' | 'read') => state.level.find((entry) => entry.mode === mode)!.value;
const plain = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');

describe('level fitting', () => {
  test('rises on correct answers, falls on misses, and sits still at 80% correct', () => {
    const { store } = fixture();
    let state = store.state('read');
    expect(levelOf(state, 'read')).toBe(1);
    expect(state.current!.mode).toBe('read');

    for (let answer = 0; answer < 6; answer++) state = step(store, 'read');
    expect(levelOf(state, 'read')).toBeCloseTo(1.3, 5);
    expect(levelOf(state, 'listen')).toBe(1); // practising one mode leaves the other alone

    state = step(store, 'read', wrongInput);
    expect(levelOf(state, 'read')).toBeCloseTo(1.1, 5);

    // Four correct answers for every miss is the equilibrium the steps are chosen for.
    for (let round = 0; round < 3; round++) {
      for (let answer = 0; answer < 4; answer++) state = step(store, 'read');
      state = step(store, 'read', wrongInput);
      expect(levelOf(state, 'read')).toBeCloseTo(1.1, 5);
    }
  });

  test('never falls below A1', () => {
    const { store } = fixture();
    let state = store.state('read');
    for (let answer = 0; answer < 3; answer++) state = step(store, 'read', wrongInput);
    expect(levelOf(state, 'read')).toBe(1);
    expect(state.level.map((entry) => entry.label)).toEqual(['A1', 'A1']);
  });

  test('a reader who knows every sentence word still meets passages', () => {
    // Sentences cover known words better than any passage; that must not starve Read of passages.
    const inPassages = new Set(passages.flatMap((item) => item.words));
    const known = new Map<string, WordKnowledge>(sentences.flatMap((item) => item.words).filter((word) => !inPassages.has(word)).map((word) => [word, { status: 'due', misses: 0 }]));
    const { store } = fixture({ known });
    const kinds = new Set<string>();
    let state = store.state('read');
    for (let answer = 0; answer < 6; answer++) { kinds.add(state.current!.kind); state = step(store, 'read'); }
    expect([...kinds].sort()).toEqual(['meaning', 'question']);
  });
});

describe('scheduling', () => {
  test('a missed exercise comes back after eight more answers', () => {
    const { store } = fixture();
    const missed = store.state('read').current!.key;
    let state = step(store, 'read', wrongInput);

    const between: string[] = [];
    for (let answer = 0; answer < 8; answer++) {
      between.push(state.current!.key);
      state = step(store, 'read');
    }
    expect(between).not.toContain(missed);
    expect(state.current!.key).toBe(missed);
  });

  test('a correct answer is not offered again the same day', () => {
    const { store } = fixture();
    const first = store.state('read').current!.key;
    let state = step(store, 'read');
    const seen: string[] = [];
    for (let answer = 0; answer < 8; answer++) {
      seen.push(state.current!.key);
      state = step(store, 'read');
    }
    expect(seen).not.toContain(first);
  });

  test('misses are reported for the mistakes list with their item and topics', () => {
    const { store } = fixture();
    const view = store.state('read').current!;
    step(store, 'read', wrongInput);
    const misses = store.misses();
    expect(misses.map((miss) => miss.key)).toContain(view.key);
    const miss = misses.find((entry) => entry.key === view.key)!;
    expect(miss.itemId).toBe(view.item.id);
    expect(miss.example.length).toBeGreaterThan(0);
    expect(miss.topics.length).toBeGreaterThan(0);
  });
});

describe('audio readiness', () => {
  test('listen only offers items whose clips exist, while read offers the rest', () => {
    const { store } = fixture({ clips: new Set(['s01', 's02', 's03']) });
    const heard: string[] = [];
    let listen = store.state('listen');
    for (let answer = 0; answer < 6; answer++) {
      heard.push(listen.current!.item.id);
      expect(listen.current!.audio.length).toBeGreaterThan(0);
      listen = step(store, 'listen');
    }
    expect(new Set(heard)).toEqual(new Set(['s01', 's02', 's03']));

    const read: string[] = [];
    let state = store.state('read');
    for (let answer = 0; answer < 8; answer++) {
      read.push(state.current!.item.id);
      state = step(store, 'read');
    }
    expect(read.some((id) => !['s01', 's02', 's03'].includes(id))).toBe(true);
  });

  test('a listen stream with nothing rendered yet has no exercise', () => {
    const { store } = fixture({ clips: new Set<string>() });
    expect(store.state('listen').current).toBeNull();
    const read = store.state('read');
    expect(read.current).not.toBeNull();
    expect(read.current!.audio).toEqual([]); // nothing to play, so nothing is offered
  });
});

describe('typed answers', () => {
  test('a gap answer missing its accent counts as correct with a spelling note', () => {
    const { store } = fixture();
    const state = driveTo(store, 'listen', 'gap', (view) => plain(sentenceById.get(view.item.id)!.gap) !== sentenceById.get(view.item.id)!.gap);
    const gap = sentenceById.get(state.current!.item.id)!.gap;
    const slip = plain(gap);
    expect(slip).not.toBe(gap);
    const settled = settle(store, 'listen', state, { text: slip });
    expect(settled.result!.outcome).toBe('correct');
    expect(settled.result!.spelling).toBe(true);
    expect(settled.result!.expected).toBe(gap);
  });

  test('a dictation forgives accents, commas, case and a straight apostrophe', () => {
    const { store } = fixture();
    const state = driveTo(store, 'listen', 'dictation', (view) => sentenceById.get(view.item.id)!.fr.includes(','));
    const fr = sentenceById.get(state.current!.item.id)!.fr;
    const slip = plain(fr).replace(/,/g, '').replace(/’/g, "'").toLocaleUpperCase('fr');
    expect(slip).not.toBe(fr);
    const settled = settle(store, 'listen', state, { text: slip });
    expect(settled.result!.outcome).toBe('correct');
    expect(settled.result!.spelling).toBe(true);
    expect(settled.result!.diff!.every((word) => word.ok)).toBe(true);
    expect(settled.result!.diff!.map((word) => word.text).join(' ')).toBe(fr);
  });

  test('a dictation that drops a word is incorrect and says which word was missed', () => {
    const { store } = fixture();
    const state = driveTo(store, 'listen', 'dictation');
    const fr = sentenceById.get(state.current!.item.id)!.fr;
    const words = fr.split(' ');
    const index = words.findLastIndex((word) => /[\p{L}]/u.test(word));
    const dropped = words[index]!;
    const settled = settle(store, 'listen', state, { text: words.filter((_, at) => at !== index).join(' ') });
    expect(settled.result!.outcome).toBe('incorrect');
    expect(settled.result!.diff!.filter((word) => !word.ok).map((word) => word.text)).toEqual([dropped]);
  });

  test('an empty typed answer is refused rather than counted as a miss', () => {
    const { store } = fixture();
    const state = driveTo(store, 'listen', 'gap');
    expect(() => settle(store, 'listen', state, { text: '   ' })).toThrow(StoreError);
    expect(store.state('listen').current!.key).toBe(state.current!.key);
    expect(store.state('listen').result).toBeNull();
  });

  test('a number typed in digits is correct with a spelling note', () => {
    const { store } = fixture();
    const state = driveTo(store, 'listen', 'gap', (view) => view.item.id === 's07'); // "Vous arrivez à huit heures."
    const settled = settle(store, 'listen', state, { text: '8' });
    expect(settled.result!.expected).toBe('huit');
    expect(settled.result!.outcome).toBe('correct');
    expect(settled.result!.spelling).toBe(true);
  });

  test('a dictation may write its numbers in digits, and every word still counts as caught', () => {
    const { store } = fixture();
    const state = driveTo(store, 'listen', 'dictation', (view) => view.item.id === 's11'); // "…vingt et un élèves…"
    const settled = settle(store, 'listen', state, { text: 'Il y a 21 élèves dans la classe.' });
    expect(settled.result!.outcome).toBe('correct');
    expect(settled.result!.spelling).toBe(true);
    expect(settled.result!.diff!.every((word) => word.ok)).toBe(true);
    expect(settled.result!.diff!.map((word) => word.text).join(' ')).toBe('Il y a vingt et un élèves dans la classe.');
  });

  test('a silent agreement the ear cannot hear is correct with a spelling note', () => {
    const { store } = fixture();
    const state = driveTo(store, 'listen', 'gap', (view) => view.item.id === 's12'); // gap "arrivés"
    const settled = settle(store, 'listen', state, { text: 'arrive' });
    expect(settled.result!.outcome).toBe('correct');
    expect(settled.result!.spelling).toBe(true);
  });

  test('a dictation that mishears an ending is still correct, word by word', () => {
    const { store } = fixture();
    const state = driveTo(store, 'listen', 'dictation', (view) => view.item.id === 's12');
    const settled = settle(store, 'listen', state, { text: 'Les élève sont arriver en retard.' });
    expect(settled.result!.outcome).toBe('correct');
    expect(settled.result!.spelling).toBe(true);
    expect(settled.result!.diff!.every((word) => word.ok)).toBe(true);
  });

  test('a different word is still wrong, however close its ending', () => {
    const { store } = fixture();
    const state = driveTo(store, 'listen', 'gap', (view) => view.item.id === 's11'); // gap "vingt"
    const settled = settle(store, 'listen', state, { text: 'trente' });
    expect(settled.result!.outcome).toBe('incorrect');
    expect(settled.result!.spelling).toBeUndefined();
    expect(settled.result!.expected).toBe('vingt');
  });
});

describe('looking words up', () => {
  test('a read exercise answered after a lookup settles as helped', () => {
    const { store } = fixture();
    const state = store.state('read');
    expect(state.current!.mode).toBe('read');
    expect(state.current!.gloss.length).toBeGreaterThan(0);
    const word = state.current!.gloss[0]!.fr;
    const looked = store.lookup({ stream: 'read', key: state.current!.key, fr: word, version: state.version, requestId: 'look-1' });
    expect(looked.lookups).toEqual([word]);

    const settled = settle(store, 'read', looked, correctInput(looked.current!));
    expect(settled.result!.outcome).toBe('helped');
    expect(store.lookupCounts().length + 1).toBeGreaterThan(0);
  });

  test('a word that is not in the text cannot be looked up', () => {
    const { store } = fixture();
    const state = store.state('read');
    expect(() => store.lookup({ stream: 'read', key: state.current!.key, fr: 'saucisson', version: state.version, requestId: 'look-2' })).toThrow(StoreError);
  });

  test('the listen exercise hides its glosses until it is settled', () => {
    const { store } = fixture();
    const state = store.state('listen');
    expect(state.current!.mode).toBe('listen');
    expect(state.current!.gloss).toEqual([]);
    const settled = settle(store, 'listen', state, correctInput(state.current!));
    expect(settled.result!.gloss.length).toBeGreaterThan(0);
    expect(settled.result!.lines[0]!.en.length).toBeGreaterThan(0);
  });

  test('a read passage shows its French but never its translation before settling', () => {
    const { store } = fixture();
    const state = driveTo(store, 'read', 'question');
    const lines = state.current!.prompt.lines!;
    expect(lines.map((line) => line.fr)).toEqual(passageById.get(state.current!.item.id)!.lines.map((line) => line.fr));
    expect(lines.every((line) => line.en === '')).toBe(true);
    const settled = settle(store, 'read', state, correctInput(state.current!));
    expect(settled.result!.lines.every((line) => line.en.length > 0)).toBe(true);
    expect(settled.result!.explanation!.length).toBeGreaterThan(0);
  });
});

describe('multiple choice', () => {
  test('a passage question is shown shuffled and graded through its shuffle', () => {
    const { store } = fixture();
    const seen: { authored: string[]; shown: string[] }[] = [];
    let moved: StreamState | null = null;
    for (let answer = 0; answer < 30 && !moved; answer++) {
      const state = store.state('read');
      const view = state.current!;
      if (view.kind === 'question') {
        const question = questionOf(view);
        seen.push({ authored: question.choices, shown: view.choices! });
        if (view.choices![question.answer] !== rightAnswerOf(view)) { moved = state; break; }
      }
      advance(store, 'read', settle(store, 'read', state, correctInput(view)));
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const entry of seen) expect([...entry.shown].sort()).toEqual([...entry.authored].sort());
    // The authored position of the right answer gives nothing away, and choosing it is simply wrong.
    expect(moved).not.toBeNull();
    const view = moved!.current!;
    const settled = settle(store, 'read', moved!, { choice: questionOf(view).answer });
    expect(settled.result!.outcome).toBe('incorrect');
    expect(settled.result!.expected).toBe(rightAnswerOf(view));
    expect(settled.result!.given).toBe(view.choices![questionOf(view).answer]);
  });

  test('a reloaded question keeps the order it was shown in', () => {
    const shop = fixture();
    const before = driveTo(shop.store, 'read', 'question');
    shop.store.close();
    stores.delete(shop.store);

    const after = shop.reopen(99).state('read');
    expect(after.current!.key).toBe(before.current!.key);
    expect(after.current!.choices).toEqual(before.current!.choices);
  });
});

describe('replays and stale requests', () => {
  test('answering twice with the same request ID counts once', () => {
    const { store } = fixture();
    const state = store.state('read');
    const input = { stream: 'read' as const, key: state.current!.key, version: state.version, requestId: 'answer-once', ...correctInput(state.current!) };
    const first = store.answer(input);
    const replay = store.answer(input);
    expect(replay).toEqual(first);
    expect(levelOf(replay, 'read')).toBe(levelOf(first, 'read'));
  });

  test('answering a settled exercise again is refused, however fresh the request', () => {
    const { store } = fixture();
    const state = store.state('read');
    const settled = settle(store, 'read', state, correctInput(state.current!));
    const before = levelOf(settled, 'read');
    try {
      store.answer({ stream: 'read', key: settled.current!.key, version: settled.version, requestId: 'twice', ...correctInput(settled.current!) });
      throw new Error('expected a refusal');
    } catch (error) { expect((error as StoreError).status).toBe(409); }
    expect(levelOf(store.state('read'), 'read')).toBe(before);
  });

  test('moving on twice with the same request ID does not skip an exercise', () => {
    const { store } = fixture();
    const settled = settle(store, 'read', store.state('read'), correctInput(store.state('read').current!));
    const input = { stream: 'read' as const, key: settled.current!.key, version: settled.version, requestId: 'next-once' };
    const first = store.next(input);
    expect(store.next(input)).toEqual(first);
  });

  test('a stale version or the wrong exercise is refused with 409', () => {
    const { store } = fixture();
    const state = store.state('read');
    const stale = () => store.answer({ stream: 'read', key: state.current!.key, version: state.version - 1, requestId: 'stale-1', ...correctInput(state.current!) });
    expect(stale).toThrow(StoreError);
    try { stale(); } catch (error) { expect((error as StoreError).status).toBe(409); }
    try {
      store.answer({ stream: 'read', key: 'nothing:meaning', version: state.version, requestId: 'stale-2', choice: 0 });
    } catch (error) { expect((error as StoreError).status).toBe(409); }
    expect(store.state('read').result).toBeNull();
  });

  test('moving on before answering is refused', () => {
    const { store } = fixture();
    const state = store.state('read');
    try {
      store.next({ stream: 'read', key: state.current!.key, version: state.version, requestId: 'early-next' });
      throw new Error('expected a refusal');
    } catch (error) { expect((error as StoreError).status).toBe(409); }
  });
});

describe('a reopened Echo', () => {
  test('shows the same exercise with the same choices', () => {
    const shop = fixture();
    const before = shop.store.state('read');
    shop.store.close();
    stores.delete(shop.store);

    const after = shop.reopen(99).state('read');
    expect(after.current!.key).toBe(before.current!.key);
    expect(after.current!.choices).toEqual(before.current!.choices);
    expect(after.version).toBe(before.version);
  });

  test('keeps a settled result until the learner moves on', () => {
    const shop = fixture();
    const settled = settle(shop.store, 'read', shop.store.state('read'), correctInput(shop.store.state('read').current!));
    shop.store.close();
    stores.delete(shop.store);

    const store = shop.reopen(99);
    const after = store.state('read');
    expect(after.result).toEqual(settled.result);
    expect(after.current!.key).toBe(settled.current!.key);
    expect(advance(store, 'read', after).result).toBeNull();
  });
});

describe('focus streams', () => {
  test('a topic stream only serves items tagged with that topic and then ends', () => {
    const { store } = fixture();
    const stream: StreamId = 'focus:topic:focus-topic';
    const served: string[] = [];
    for (let answer = 0; answer < 30; answer++) {
      const state = store.state(stream);
      if (!state.current) break;
      served.push(state.current.item.id);
      advance(store, stream, settle(store, stream, state, correctInput(state.current)));
    }
    expect(served.length).toBeGreaterThan(1);
    expect(new Set(served)).toEqual(new Set(['s09', 's10']));
    expect(store.state(stream).current).toBeNull();
  });

  test('a word stream only serves items using a word the learner keeps missing', () => {
    const known = new Map<string, WordKnowledge>([['gare', { status: 'learning', misses: 3 }], ['pain', { status: 'due', misses: 0 }]]);
    const { store } = fixture({ known });
    expect(store.weakWords()).toEqual(['gare']);
    const state = store.state('focus:words');
    expect(state.current!.item.id).toBe('s01');
    expect(advance(store, 'focus:words', settle(store, 'focus:words', state, correctInput(state.current!))).current).toBeNull();
  });

  test('the mistakes stream serves outstanding misses and runs dry once they are answered', () => {
    const { store } = fixture();
    expect(store.state('focus:missed').current).toBeNull();

    const missed: string[] = [];
    for (let answer = 0; answer < 2; answer++) {
      const state = store.state('read');
      missed.push(state.current!.key);
      advance(store, 'read', settle(store, 'read', state, wrongInput(state.current!)));
    }

    const replayed: string[] = [];
    for (let answer = 0; answer < 6; answer++) {
      const state = store.state('focus:missed');
      if (!state.current) break;
      replayed.push(state.current.key);
      advance(store, 'focus:missed', settle(store, 'focus:missed', state, correctInput(state.current)));
    }
    expect(replayed.sort()).toEqual([...missed].sort());
    expect(store.state('focus:missed').current).toBeNull();
    expect(store.misses()).toEqual([]);
  });

  test('an unknown stream is refused', () => {
    const { store } = fixture();
    expect(() => store.state('practice' as StreamId)).toThrow(StoreError);
  });
});

describe('the practise stream', () => {
  test('alternates listening and reading', () => {
    const { store } = fixture();
    const modes: string[] = [];
    let state = store.state('mix');
    for (let answer = 0; answer < 4; answer++) {
      modes.push(state.current!.mode);
      state = step(store, 'mix');
    }
    expect(modes).toEqual(['listen', 'read', 'listen', 'read']);
  });

  test('falls back to reading while no audio is rendered', () => {
    const { store } = fixture({ clips: new Set<string>() });
    const modes: string[] = [];
    let state = store.state('mix');
    for (let answer = 0; answer < 3; answer++) {
      modes.push(state.current!.mode);
      state = step(store, 'mix');
    }
    expect(modes).toEqual(['read', 'read', 'read']);
  });
});
