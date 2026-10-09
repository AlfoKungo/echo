import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ComprehensionSentence } from '../comprehension-contract';
import { laneProblems, loadBank, unglossed, validateLane, type Known } from '../lib/comprehension-content';
import { createComprehensionStore } from '../lib/comprehension-store';
import { languages } from '../lib/language';

const root = join(import.meta.dir, '..');
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const temporary = () => { const directory = mkdtempSync(join(tmpdir(), 'echo-lanes-')); directories.push(directory); return directory; };
const known: Known = { words: new Set(['w1']), topics: new Set(['t']) };

test('a Portuguese lane carries its text under pt and is read as fr, glosses and lines too', async () => {
  const dir = temporary();
  const sentences = Array.from({ length: 1 }, () => ({
    id: 'a1-test-s01', level: 'A1', pt: 'Eu moro perto da praia.', en: 'I live near the beach.',
    distractors: ['I live far from the beach.', 'I work near the beach.'], topics: ['present-regular'], words: ['essentials-001'],
    gloss: [{ pt: 'moro', en: 'live (morar)' }, { pt: 'perto', en: 'near' }, { pt: 'praia', en: 'beach' }],
  }));
  const passages = [{
    id: 'a1-test-p01', level: 'A1', kind: 'text', title: 'A note', words: ['essentials-001'], topics: ['present-regular'],
    lines: [{ pt: 'Oi, Ana!', en: 'Hi, Ana!' }, { pt: 'Eu moro perto da praia.', en: 'I live near the beach.' }, { pt: 'Tchau.', en: 'Bye.' }],
    questions: Array.from({ length: 3 }, (_, index) => ({ question: `Q${index}?`, choices: ['a', 'b', 'c'], answer: index, explanation: 'Because “Eu moro perto da praia.”' })),
    gloss: [{ pt: 'Oi', en: 'hi' }, { pt: 'Ana', en: 'Ana' }, { pt: 'moro', en: 'live (morar)' }, { pt: 'perto', en: 'near' }, { pt: 'praia', en: 'beach' }, { pt: 'Tchau', en: 'bye' }],
  }];
  writeFileSync(join(dir, 'a1-test.json'), JSON.stringify({ sentences, passages }));
  const bank = await loadBank(root, dir, [], languages(root).pt);
  expect(bank.sentences[0]!.fr).toBe('Eu moro perto da praia.');
  expect(bank.sentences[0]!.gloss[0]).toEqual({ fr: 'moro', en: 'live (morar)' });
  expect(bank.passages[0]!.lines.map((line) => line.fr)).toEqual(['Oi, Ana!', 'Eu moro perto da praia.', 'Tchau.']);
  expect(Object.keys(bank.sentences[0]!)).not.toContain('pt');
});

test('Portuguese and Swedish are checked by their own typography and little words; French keeps its rules', () => {
  const lane = (fr: string) => ({ sentences: [{ id: 'x', level: 'A1', fr, en: 'A meaning.', distractors: ['One.', 'Two.'], topics: ['t'], words: ['w1'], gloss: [{ fr: fr.split(/[ ?.]/)[0]!, en: 'a word' }] } as ComprehensionSentence], passages: [] });
  expect(validateLane(lane('Você mora aqui?'), 'f', known, new Set(), 'pt')).toEqual([]);
  expect(validateLane(lane('Você mora aqui ?'), 'f', known, new Set(), 'pt').join()).toContain('space before a punctuation mark');
  expect(validateLane(lane('Bor du här?'), 'f', known, new Set(), 'sv')).toEqual([]);
  expect(validateLane(lane('Tu habites ici?'), 'f', known, new Set()).join()).toContain('needs a space before ? ! : ; in French.');
  expect(unglossed('Eu não moro na praia.', [{ fr: 'moro' }, { fr: 'praia' }], 'pt')).toEqual([]);
  expect(unglossed('Jag bor inte i stan.', [{ fr: 'bor' }, { fr: 'stan' }], 'sv')).toEqual(['i']);
  expect(unglossed('Jag bor inte i stan.', [{ fr: 'bor' }, { fr: 'stan' }])).toEqual(['Jag', 'inte', 'i']);
  expect(laneProblems(lane('Você mora aqui?'), 'a1-x', known, new Set(), 'pt').join()).toContain('ids must start with "a1-x-"');
});

test('a bank without B1 never lifts the level to B1', () => {
  const dir = temporary();
  const sentences: ComprehensionSentence[] = Array.from({ length: 30 }, (_, index) => ({
    id: `s${index}`, level: index < 15 ? 'A1' : 'A2', fr: `Frase número ${index}.`, en: `Sentence ${index}.`,
    distractors: [`Wrong ${index}.`, `Other ${index}.`], topics: [], words: [], gloss: [{ fr: 'Frase', en: 'sentence' }],
  }));
  const store = createComprehensionStore({ sentences, passages: [] }, { dbPath: join(dir, 'echo.db'), clipExists: () => true, knownStatus: () => new Map() });
  let state = store.state('read');
  for (let answered = 0; answered < 120 && state.current; answered++) {
    const choice = state.current.choices.indexOf(sentences.find((entry) => entry.id === state.current!.item.id)!.en);
    state = store.answer({ stream: 'read', key: state.current.key, version: state.version, requestId: `a${answered}`, choice });
    state = store.next({ stream: 'read', key: state.current!.key, version: state.version, requestId: `n${answered}` });
  }
  const read = store.summary().levels.find((entry) => entry.mode === 'read')!;
  expect(read.label).toBe('A2');
  expect(read.value).toBeLessThan(3);
  store.close();
});
