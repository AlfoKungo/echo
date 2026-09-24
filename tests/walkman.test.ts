import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowseWord, Word } from '../contract';
import { buildTape, createClips, FRAME_BYTES, FRAME_SECONDS, planTape } from '../lib/walkman';

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

  test('new words come from the most studied category, in order, each heard three times close together', () => {
    const plan = planTape(deck(), 300, seeded(3));
    const fresh = [...new Set(plan.filter((id) => id.includes('new')))];
    // Food holds 16 studied words and home 20, so home's new words come first.
    expect(fresh.slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => `home-new-${i}`));
    for (const id of fresh) {
      const slots = plan.flatMap((entry, slot) => (entry === id ? [slot] : []));
      expect(slots.length).toBeGreaterThanOrEqual(3);
      expect(slots[2]! - slots[0]!).toBeLessThanOrEqual(16);
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
      expect(a!.meaningAt - a!.start).toBeCloseTo(25 * FRAME_SECONDS + 2.0, 1);
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
