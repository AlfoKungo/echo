import { expect, test } from 'bun:test';
import { pointsFromLowest } from '../lib/score-points';

const answers = (id: string, weights: number[]) => weights.map((weight) => ({ id, weight }));

test('a miss costs only what the item climbed above its lowest, so a new item missed loses nothing', () => {
  // A new form: miss, right, miss, then three right — the table that set the rule.
  const moved = pointsFromLowest(answers('form', [-3, 2, -3, 2, 2, 2]));
  expect(moved).toEqual([0, 2, -2, 2, 2, 2]);
  // The total is how far the form now stands above its worst: from -4 up to +2.
  expect(moved.reduce((sum, value) => sum + value, 0)).toBe(6);
});

test('forgetting something known is a loss in full, and items keep their own lowest', () => {
  const moved = pointsFromLowest([...answers('known', [2, 2, 2]), ...answers('other', [-3]), ...answers('known', [-3])]);
  expect(moved).toEqual([2, 2, 2, 0, -3]);
});

test('a miss takes back no more than the climb, whatever made it: Walkman halves, Endless marks, answers', () => {
  expect(pointsFromLowest(answers('heard', [0.5, 0.5, -3]))).toEqual([0.5, 0.5, -1]);
  expect(pointsFromLowest(answers('endless', [1, -1, -1]))).toEqual([1, -1, 0]);
  expect(pointsFromLowest(answers('card', [2, -3, 2, 2, -3]))).toEqual([2, -2, 2, 2, -3]);
});
