import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ComprehensionLane } from '../comprehension-contract';
import { createTextTopup } from '../lib/text-topup';
import { createAttempts } from '../lib/recording-attempts';

const root = join(import.meta.dir, '..');
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

// A valid A1 sentence and passage in the form Claude writes them (no id or level, right answer first).
const sentence = {
  fr: 'Nous mangeons au restaurant ce soir.', en: 'We are eating at the restaurant this evening.',
  distractors: ['We are eating at the restaurant this morning.', 'They are eating at the restaurant this evening.'],
  topics: ['present-er', 'not-a-topic'], words: [],
  gloss: [{ fr: 'mangeons', en: 'eat (manger)', word: 'verbs-059' }, { fr: 'restaurant', en: 'restaurant', word: 'travel-020' }, { fr: 'ce soir', en: 'this evening', word: 'health-time-060' }],
};
const passage = (kind: 'dialogue' | 'text') => ({
  kind, title: 'At the café',
  lines: ['Nous mangeons au restaurant ce soir.', 'Nous mangeons au restaurant.', 'Ce soir, restaurant !']
    .map((fr, index) => ({ ...(kind === 'dialogue' ? { speaker: index % 2 ? 'Paul' : 'Claire' } : {}), fr, en: 'We eat.' })),
  questions: [1, 2, 3].map((n) => ({ question: `Question ${n}?`, choices: ['Right', 'Wrong one', 'Wrong two'], explanation: '« ce soir »' })),
  topics: ['present-er'], words: ['travel-020'],
  gloss: [{ fr: 'mangeons', en: 'eat (manger)' }, { fr: 'restaurant', en: 'restaurant' }, { fr: 'ce soir', en: 'this evening' }, { fr: 'Ce soir', en: 'this evening' }],
});

function setup(record: (ids: string[]) => { ok: boolean; error: string }, options: { dataDir?: string; stock?: { level: 'A1' | 'A2' | 'B1'; sentences: number; passages: number }[] } = {}) {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'echo-texts-'));
  directories.push(dataDir);
  const prompts: string[] = [];
  let reloads = 0;
  const recorded: string[][] = [];
  const texts = createTextTopup({
    root, dataDir, threshold: 10, random: () => 0,
    stock: () => options.stock ?? [{ level: 'A1', sentences: 40, passages: 9 }],
    attempts: createAttempts(join(dataDir, 'recording-attempts.json')),
    ask: async (prompt) => {
      prompts.push(prompt);
      if (prompt.includes('Pick one new everyday theme')) return '{"theme": "Weather & Seasons"}';
      if (prompt.includes('a checker found problems')) return JSON.stringify({ items: [{ ref: 'a1-weather-seasons-s01', item: sentence }] });
      // The first sentence leaves "restaurant" unglossed, which only a repair round fixes.
      if (prompt.includes('sentences on the theme')) return `Here: ${JSON.stringify({ sentences: [{ ...sentence, gloss: sentence.gloss.slice(0, 1).concat(sentence.gloss.slice(2)) }, ...Array(49).fill(sentence)] })}`;
      return JSON.stringify({ passages: [...Array(5).fill(passage('dialogue')), ...Array(4).fill(passage('text'))] });
    },
    record: async (ids) => { recorded.push(ids); return record(ids); },
    reload: async () => { reloads += 1; },
  });
  return { texts, dataDir, prompts, recorded, reloads: () => reloads };
}

test('a low level gets a checked new lane: a broken item is sent back and fixed, then the lane is recorded and joins practice', async () => {
  const { texts, dataDir, prompts, recorded, reloads } = setup(() => ({ ok: true, error: '' }));
  await texts.check();
  expect(texts.status().lastError).toBeNull();
  const lane = await Bun.file(join(dataDir, 'comprehension', 'a1-weather-seasons.json')).json() as ComprehensionLane;
  expect(prompts.filter((prompt) => prompt.includes('a checker found problems'))).toHaveLength(1);
  expect(lane.sentences).toHaveLength(50);
  expect(lane.passages).toHaveLength(9);
  expect(lane.sentences[0]).toMatchObject({ id: 'a1-weather-seasons-s01', level: 'A1', topics: ['present-er'], words: ['verbs-059', 'travel-020', 'health-time-060'] });
  // Whatever order the choices end up in, the answer still points at the one Claude listed first.
  for (const question of lane.passages.flatMap((entry) => entry.questions)) expect(question.choices[question.answer]).toBe('Right');
  expect(recorded[0]).toContain('a1-weather-seasons-p09-3');
  expect(reloads()).toBe(1);
  expect(readdirSync(join(dataDir, 'comprehension-pending'))).toEqual([]);
});

test('a lane waits, unrecorded and out of practice, while another recording holds the voice', async () => {
  let busy = true;
  const { texts, dataDir, prompts, reloads } = setup(() => (busy ? { ok: false, error: 'comprehension audio render failed: Another renderer owns audio/comprehension' } : { ok: true, error: '' }));
  await texts.check();
  expect(existsSync(join(dataDir, 'comprehension-pending', 'a1-weather-seasons.json'))).toBe(true);
  expect(reloads()).toBe(0);
  busy = false;
  const asked = prompts.length;
  await texts.check();
  expect(prompts.length).toBe(asked); // the waiting lane is recorded, not written again
  expect(existsSync(join(dataDir, 'comprehension', 'a1-weather-seasons.json'))).toBe(true);
  expect(reloads()).toBe(1);
});

test('a lane Echo wrote that no longer passes the checks is left out instead of stopping Echo', async () => {
  const { loadBank } = await import('../lib/comprehension-content');
  const dir = mkdtempSync(join(tmpdir(), 'echo-generated-'));
  directories.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a1-broken.json'), JSON.stringify({ sentences: [{ id: 'a1-broken-s01', level: 'A1', fr: 'Bonjour' }], passages: [] }));
  const bank = await loadBank(root, undefined, [dir]);
  expect(bank.sentences.some((entry) => entry.id === 'a1-broken-s01')).toBe(false);
  expect(bank.sentences.length).toBeGreaterThan(0);
});

test('of the levels running low, the one with the fewest unseen texts is written', async () => {
  const { texts, prompts } = setup(() => ({ ok: true, error: '' }), { stock: [{ level: 'A1', sentences: 8, passages: 9 }, { level: 'A2', sentences: 12, passages: 3 }] });
  await texts.check();
  expect(prompts[0]).toContain('another A2 lane');
});

test('a live clip no take passes for is re-recorded on each start until it has failed three times', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'echo-texts-'));
  mkdirSync(join(dataDir, 'comprehension'));
  writeFileSync(join(dataDir, 'comprehension', 'a1-never.json'), JSON.stringify({ sentences: [{ id: 'a1-never-s01' }], passages: [] }));
  const tries: string[][] = [];
  for (let restart = 0; restart < 5; restart++) {
    const { texts, recorded } = setup(() => ({ ok: false, error: '' }), { dataDir, stock: [{ level: 'A1', sentences: 40, passages: 20 }] });
    await texts.resume();
    tries.push(...recorded);
  }
  expect(tries).toEqual([['a1-never-s01'], ['a1-never-s01'], ['a1-never-s01']]);
});
