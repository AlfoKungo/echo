import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowseWord, Word } from '../contract';
import { buildTape, createClips, FRAME_BYTES, FRAME_SECONDS, planSentences, planTape, REVERSE_TIMING } from '../lib/walkman';
import { SCORE_ONE_RECALL } from '../lib/store';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

function word(id: string, category: string, status: BrowseWord['status'], extra: Partial<BrowseWord> = {}): BrowseWord {
  return { id, fr: `fr-${id}`, en: `en-${id}`, category, status, due: null, lastStudied: null, misses: 0, ...extra };
}

const deck = (): BrowseWord[] => [
  ...Array.from({ length: 6 }, (_, i) => word(`learn-${i}`, 'food', 'learning', { misses: i })),
  ...Array.from({ length: 10 }, (_, i) => word(`due-${i}`, 'food', 'due', { due: `2026-01-${String(10 + i).padStart(2, '0')}T00:00:00Z` })),
  ...Array.from({ length: 20 }, (_, i) => word(`known-${i}`, 'home', 'scheduled', { due: `2026-03-${String(1 + i).padStart(2, '0')}T00:00:00Z` })),
  ...Array.from({ length: 10 }, (_, i) => word(`home-new-${i}`, 'home', 'new')),
  ...Array.from({ length: 10 }, (_, i) => word(`food-new-${i}`, 'food', 'new')),
];

describe('planTape', () => {
  test('opens with the words being learnt, most missed first, then words due', () => {
    const plan = planTape(deck(), 200, seeded(1));
    const familiar = plan.filter((id) => !id.includes('new'));
    expect(familiar.slice(0, 6)).toEqual(['learn-5', 'learn-4', 'learn-3', 'learn-2', 'learn-1', 'learn-0']);
    expect(familiar.slice(6, 16)).toEqual(Array.from({ length: 10 }, (_, i) => `due-${i}`));
  });

  test('a familiar word waits at least fifteen others before it returns', () => {
    const plan = planTape(deck(), 300, seeded(2));
    const last = new Map<string, number>();
    plan.forEach((id, slot) => {
      if (!id.includes('new') && last.has(id)) expect(slot - last.get(id)!).toBeGreaterThan(15);
      last.set(id, slot);
    });
  });

  test('new words come from the most studied category, in order, each heard three times, spaced so it never comes straight back', () => {
    const plan = planTape(deck(), 300, seeded(3));
    const fresh = [...new Set(plan.filter((id) => id.includes('new')))];
    // Food holds 16 studied words and home 20, so home's new words come first.
    expect(fresh.slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => `home-new-${i}`));
    for (const id of fresh) {
      const slots = plan.flatMap((entry, slot) => (entry === id ? [slot] : []));
      expect(slots.length).toBeGreaterThanOrEqual(3);
      expect(slots[1]! - slots[0]!).toBeGreaterThanOrEqual(10);
      expect(slots[2]! - slots[1]!).toBeGreaterThanOrEqual(10);
      expect(slots[2]! - slots[0]!).toBeLessThanOrEqual(34);
    }
  });

  test('with only two words known it alternates them and never plays one twice in a row', () => {
    const plan = planTape([word('a', 'x', 'learning'), word('b', 'x', 'learning')], 20, seeded(4));
    expect(plan).toHaveLength(20);
    plan.forEach((id, slot) => { if (slot) expect(id).not.toBe(plan[slot - 1]); });
  });

  test('a first-day learner gets a full tape of new words, each introduced and repeated', () => {
    const plan = planTape(Array.from({ length: 30 }, (_, i) => word(`n-${i}`, 'x', 'new')), 40, seeded(5));
    expect(plan.length).toBe(40);
    expect(plan[0]).toBe('n-0');
    expect(plan.filter((id) => id === 'n-0').length).toBeGreaterThanOrEqual(3);
    plan.forEach((id, slot) => { if (slot) expect(id).not.toBe(plan[slot - 1]); });
  });
});

describe('buildTape', () => {
  test('joins whole frames and times each word exactly, skipping words without both recordings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'walkman-'));
    try {
      const frame = (count: number) => {
        const bytes = new Uint8Array(count * FRAME_BYTES);
        for (let i = 0; i < count; i++) bytes.set([0xff, 0xf3], i * FRAME_BYTES);
        return bytes;
      };
      mkdirSync(join(dir, 'walkman', 'fr'), { recursive: true });
      mkdirSync(join(dir, 'walkman', 'en'), { recursive: true });
      writeFileSync(join(dir, 'walkman', 'silence.mp3'), frame(10));
      for (const id of ['a', 'b']) {
        writeFileSync(join(dir, 'walkman', 'fr', `${id}.mp3`), frame(25));
        writeFileSync(join(dir, 'walkman', 'en', `${id}.mp3`), frame(40));
      }
      writeFileSync(join(dir, 'walkman', 'fr', 'c.mp3'), frame(25));
      writeFileSync(join(dir, 'walkman', 'en', 'broken.mp3'), new Uint8Array(100));
      writeFileSync(join(dir, 'walkman', 'fr', 'broken.mp3'), frame(5));
      const words = new Map<string, Word>(['a', 'b', 'c', 'broken'].map((id) => [id, { id, fr: `fr ${id}`, en: `en ${id}`, category: 'x' }]));
      const tape = buildTape('t', ['a', 'c', 'broken', 'b'], words, createClips(dir));
      expect(tape.words.map((entry) => entry.id)).toEqual(['a', 'b']);
      expect(tape.bytes.length % FRAME_BYTES).toBe(0);
      expect(tape.seconds).toBeCloseTo((tape.bytes.length / FRAME_BYTES) * FRAME_SECONDS, 6);
      const [a, b] = tape.words;
      expect(a!.recallAt - a!.start).toBeCloseTo(25 * FRAME_SECONDS, 6);
      expect(a!.meaningAt - a!.recallAt).toBeCloseTo(2.0, 1);
      expect(a!.againAt - a!.meaningAt).toBeCloseTo(40 * FRAME_SECONDS + 0.7, 1);
      expect(a!.end - a!.againAt).toBeCloseTo(25 * FRAME_SECONDS, 6);
      expect(b!.start).toBeGreaterThan(a!.end);
      for (let offset = 0; offset < tape.bytes.length; offset += FRAME_BYTES) {
        if (tape.bytes[offset] !== 0xff || tape.bytes[offset + 1] !== 0xf3) throw new Error(`frame out of step at ${offset}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('planTape by score', () => {
  const scored = (): (BrowseWord & { score: number })[] => [
    word('weak', 'food', 'learning', { misses: 3 }),
    word('strong', 'food', 'scheduled', { due: '2026-05-01T00:00:00Z' }),
    ...Array.from({ length: 38 }, (_, i) => word(`even-${i}`, 'food', i % 2 ? 'scheduled' : 'learning', { due: '2026-04-01T00:00:00Z' })),
  ].map((entry) => ({ ...entry, score: entry.id === 'weak' ? -6 : entry.id === 'strong' ? 6 : 0 }));

  // Real tapes: about 200 words each, twenty of them.
  const tapes = () => Array.from({ length: 20 }, (_, i) => planTape(scored(), 200, seeded(100 + i), 'scored'));

  test('a low score is heard far more often than a high one, and spacing still holds', () => {
    const plans = tapes();
    const count = (id: string) => plans.reduce((total, plan) => total + plan.filter((entry) => entry === id).length, 0);
    expect(count('weak')).toBeGreaterThan(4 * Math.max(1, count('strong')));
    for (const plan of plans) {
      const last = new Map<string, number>();
      plan.forEach((id, slot) => {
        if (last.has(id)) expect(slot - last.get(id)!).toBeGreaterThan(15);
        last.set(id, slot);
      });
    }
  });

  test('a high score still turns up now and then', () => {
    expect(tapes().some((plan) => plan.includes('strong'))).toBe(true);
  });
});

describe('English first', () => {
  const pool = (): (BrowseWord & { score: number })[] => [
    ...Array.from({ length: 40 }, (_, i) => ({ ...word(`low-${i}`, 'food', 'scheduled'), score: SCORE_ONE_RECALL })),
    ...Array.from({ length: 40 }, (_, i) => ({ ...word(`high-${i}`, 'food', 'scheduled'), score: 8 })),
    { ...word('almost', 'food', 'scheduled'), score: SCORE_ONE_RECALL - 0.5 },
    { ...word('learning', 'food', 'learning'), score: 6 },
    { ...word('due', 'food', 'due'), score: 6 },
    ...Array.from({ length: 10 }, (_, i) => ({ ...word(`new-${i}`, 'food', 'new'), score: 0 })),
  ];

  test('plans only finished words with a score of at least one recall, never a new word', () => {
    for (let seed = 0; seed < 10; seed++) {
      const plan = planTape(pool(), 200, seeded(200 + seed), 'reverse');
      expect(plan).toHaveLength(200);
      expect(plan.every((id) => id.startsWith('low-') || id.startsWith('high-'))).toBe(true);
    }
  });

  test('the lower scores of the well-known words come most', () => {
    const plans = Array.from({ length: 10 }, (_, i) => planTape(pool(), 200, seeded(300 + i), 'reverse')).flat();
    const low = plans.filter((id) => id.startsWith('low-')).length;
    expect(low).toBeGreaterThan(2 * (plans.length - low));
  });

  test('plans nothing when no word is known well enough', () => {
    expect(planTape(pool().filter((entry) => entry.score < SCORE_ONE_RECALL || entry.status !== 'scheduled'), 50, seeded(1), 'reverse')).toEqual([]);
  });

  test('lays each word as the English, a pause, the French, a breath, the French again', () => {
    const dir = mkdtempSync(join(tmpdir(), 'walkman-'));
    try {
      // Each clip's frames carry a third byte naming it, so the laid order can be read back from the tape.
      const frames = (count: number, mark: number) => {
        const bytes = new Uint8Array(count * FRAME_BYTES);
        for (let i = 0; i < count; i++) bytes.set([0xff, 0xf3, mark], i * FRAME_BYTES);
        return bytes;
      };
      mkdirSync(join(dir, 'walkman', 'fr'), { recursive: true });
      mkdirSync(join(dir, 'walkman', 'en'), { recursive: true });
      writeFileSync(join(dir, 'walkman', 'silence.mp3'), frames(10, 0));
      writeFileSync(join(dir, 'walkman', 'fr', 'a.mp3'), frames(25, 1));
      writeFileSync(join(dir, 'walkman', 'en', 'a.mp3'), frames(40, 2));
      const words = new Map<string, Word>([['a', { id: 'a', fr: 'le pain', en: 'bread', category: 'x' }]]);
      const tape = buildTape('t', ['a'], words, createClips(dir), new Set(), 'reverse');
      expect(tape.kind).toBe('reverse');
      const [a] = tape.words;
      expect(a).toMatchObject({ fr: 'le pain', en: 'bread' });
      const runs: [string, number][] = [];
      for (let offset = 0; offset < tape.bytes.length; offset += FRAME_BYTES) {
        const name = ['pause', 'French', 'English'][tape.bytes[offset + 2]!]!;
        if (runs.at(-1)?.[0] === name) runs.at(-1)![1]++;
        else runs.push([name, 1]);
      }
      const pause = (seconds: number) => Math.round(seconds / FRAME_SECONDS);
      expect(runs).toEqual([['pause', pause(0.6)], ['English', 40], ['pause', pause(REVERSE_TIMING.recall)], ['French', 25], ['pause', pause(REVERSE_TIMING.afterMeaning)], ['French', 25], ['pause', pause(REVERSE_TIMING.between)]]);
      expect(REVERSE_TIMING.recall).toBe(3.0);
      expect(a!.recallAt - a!.start).toBeCloseTo(40 * FRAME_SECONDS, 6);
      expect(a!.meaningAt - a!.recallAt).toBeCloseTo(3.0, 1);
      expect(a!.againAt - a!.meaningAt).toBeCloseTo(25 * FRAME_SECONDS + REVERSE_TIMING.afterMeaning, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('planSentences', () => {
  const sentences = [
    { id: 'plain-a1', level: 'A1' as const, words: ['known-0'] },
    { id: 'shaky-a2', level: 'A2' as const, words: ['known-1', 'learn-0'] },
    { id: 'unstarted-a1', level: 'A1' as const, words: ['home-new-0'] },
    { id: 'hard-b1', level: 'B1' as const, words: ['learn-0'] },
    ...Array.from({ length: 20 }, (_, i) => ({ id: `filler-${i}`, level: 'A1' as const, words: [`known-${i}`] })),
  ];
  const words = deck().map((entry) => ({ ...entry, score: entry.id === 'learn-0' ? -6 : 4 }));

  test('plays each sentence up to the level once', () => {
    const plan = planSentences(sentences, words, 'A2', seeded(3));
    expect(plan.map((entry) => entry.id).toSorted()).toEqual(sentences.filter((entry) => entry.level !== 'B1').map((entry) => entry.id).toSorted());
  });

  test('puts a sentence holding a shaky word being learnt first, a sentence of unstarted words late', () => {
    let first = 0, unstartedPlace = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const plan = planSentences(sentences, words, 'A2', seeded((seed * 2654435761) % 2 ** 32)).map((entry) => entry.id);
      if (plan[0] === 'shaky-a2') first++;
      unstartedPlace += plan.indexOf('unstarted-a1');
    }
    // Drawn in proportion to weight: 32 against 21 sentences at 0.25 and one at 0.05, about 86% of tapes.
    expect(first).toBeGreaterThan(150);
    expect(unstartedPlace / 200).toBeGreaterThan(10);
  });
});
