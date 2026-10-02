import { expect, test } from 'bun:test';
import { pointsFromLowest } from '../lib/score-points';

const DAY = 86_400_000;
// Events in the first two tests share one moment, so nothing fades between them.

test('a miss costs only what the item climbed above its lowest, so a new item missed loses nothing', () => {
  // A new form: miss, right, miss, then three right — the table that set the rule.
  const weights = [-3, 2, -3, 2, 2, 2];
  const moved = pointsFromLowest(weights.map((weight) => ({ id: 'form', weight, at: 0 })), 21);
  expect(moved).toEqual([0, 2, -2, 2, 2, 2]);
  // The total is how far the form now stands above its worst: from -4 up to +2.
  expect(moved.reduce((sum, value) => sum + value, 0)).toBe(6);
});

test('forgetting something known is a loss in full, and items keep their own lowest', () => {
  const moved = pointsFromLowest([
    { id: 'known', weight: 2, at: 0 }, { id: 'known', weight: 2, at: 0 }, { id: 'known', weight: 2, at: 0 },
    { id: 'other', weight: -3, at: 0 },
    { id: 'known', weight: -3, at: 0 },
  ], 21);
  expect(moved).toEqual([2, 2, 2, 0, -3]);
});

test('fading lifts the score and its lowest together, so a miss after a lift that fading gave costs nothing', () => {
  const halfLife = 21;
  const moved = pointsFromLowest([{ id: 'word', weight: -3, at: 0 }, { id: 'word', weight: -3, at: 3 * halfLife * DAY }], halfLife);
  expect(moved).toEqual([0, 0]);
  // A word learned and left to fade loses only what is left of it.
  const faded = pointsFromLowest([{ id: 'word', weight: 2, at: 0 }, { id: 'word', weight: -3, at: halfLife * DAY }], halfLife);
  expect(faded).toEqual([2, -1]);
});
