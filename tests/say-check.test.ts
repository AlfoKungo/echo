import { expect, test } from 'bun:test';
import { hint, judge } from '../lib/say-check';

test('any one meaning counts, without brackets or a leading to, the, a or an', () => {
  expect(judge('Wealthy.', 'rich; wealthy')).toBe('right');
  expect(judge('Stranger', 'stranger (unknown person, male)')).toBe('right');
  expect(judge('To learn.', 'to learn; to teach someone something')).toBe('right');
  expect(judge('learn', 'to learn; to teach someone something')).toBe('right');
  expect(judge('The frog!', 'frog')).toBe('right');
  expect(judge('an idea', 'idea')).toBe('right');
});

test('a phrase may be said without the words that only finish it, but not cut short otherwise', () => {
  expect(judge('Teach.', 'to learn; to teach someone something')).toBe('right');
  expect(judge('look', 'to look at; to watch')).toBe('right');
  expect(judge('on top', 'on; on top of')).toBe('right');
  expect(judge('High.', 'high school; upper secondary school')).toBe('wrong');
});

test('recognition slips are forgiven: a plural, one letter in a long word, a filler or an opener', () => {
  expect(judge('Gates.', 'gate (large entrance gate)')).toBe('right');
  expect(judge('Mushrooms', 'mushroom')).toBe('right');
  expect(judge('Appetiser.', 'starter; appetizer')).toBe('right');
  expect(judge('Um, it\'s a frog.', 'frog')).toBe('right');
  expect(judge('I think rich, wealthy.', 'rich; wealthy')).toBe('right');
  // A short word gets no slip: one letter is a different word.
  expect(judge('Bog.', 'dog')).toBe('wrong');
});

test('another word is wrong, and what recognition makes of silence is not an answer at all', () => {
  expect(judge('Toad.', 'frog')).toBe('wrong');
  expect(judge('Poor.', 'rich; wealthy')).toBe('wrong');
  for (const noise of ['', ' ', 'Thank you.', 'you', '[BLANK_AUDIO]', 'Hmm.', 'Oh.', '...']) expect(judge(noise, 'frog')).toBe('unclear');
  // "bye" is an answer when the word means it.
  expect(judge('Bye.', 'hi; bye (informal)')).toBe('right');
});

test('the hint lists the meanings recognition should expect', () => {
  expect(hint('to learn; to teach someone something')).toBe('learn, teach someone something.');
  expect(hint('perm (hairstyle)')).toBe('perm.');
});
