import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { Word, WordFamily } from '../contract';
import { familyIndex, familyProblems, loadFamilies, patternProblems } from '../lib/families';
import type { WordPattern } from '../contract';

const root = join(import.meta.dir, '..');

test('every committed word family is sound against the current deck', async () => {
  const deck = [
    ...await Bun.file(join(root, 'content/core.json')).json() as Word[],
    ...await Bun.file(join(root, 'content/world.json')).json() as Word[],
  ];
  const byId = new Map(deck.map((word) => [word.id, word]));
  const used = new Set<string>();
  const problems: string[] = [];
  for (const family of (await Bun.file(join(root, 'content/families.json')).json() as { families: WordFamily[] }).families) {
    problems.push(...familyProblems(family, byId, used));
    for (const member of family.members) used.add(member.id);
  }
  expect(problems).toEqual([]);
});

test('every word-building pattern uses pairs from one committed family, each pair once', async () => {
  const deck = [
    ...await Bun.file(join(root, 'content/core.json')).json() as Word[],
    ...await Bun.file(join(root, 'content/world.json')).json() as Word[],
  ];
  const familyOf = familyIndex(loadFamilies(root, deck));
  const used = new Set<string>();
  const problems: string[] = [];
  for (const pattern of (await Bun.file(join(root, 'content/word-building.json')).json() as { patterns: WordPattern[] }).patterns) {
    problems.push(...patternProblems(pattern, familyOf, used));
    for (const [from, to] of pattern.examples) used.add(`${from}>${to}`);
  }
  expect(problems).toEqual([]);
});
