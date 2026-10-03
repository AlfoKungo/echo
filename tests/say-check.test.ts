import { expect, test } from 'bun:test';
import { hint, judge, said } from '../lib/say-check';

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

test('giving up out loud is not knowing the word; thinking aloud is not an answer yet', () => {
  for (const giveUp of ['I don\'t know.', 'Um, I don\'t know this one.', 'No idea.', 'Pass.', 'I give up!', 'I can\'t remember.']) expect(judge(giveUp, 'frog')).toBe('dontknow');
  for (const thinking of ['Let me think.', 'Hmm, wait.', 'I think...', 'It\'s...', 'Hold on.']) expect(judge(thinking, 'frog')).toBe('unclear');
  // The answer first: a word that means "pass" is right when it is said.
  expect(judge('Pass.', 'to pass; to spend (time)')).toBe('right');
  // Giving up followed by a long ramble is not mistaken for it.
  expect(judge('I don\'t know what you mean by this word really', 'frog')).toBe('wrong');
});

test('what the learner marked as heard wrong counts for that word from then on', () => {
  expect(judge('Umbrella.', 'lock (mechanism)')).toBe('wrong');
  expect(said('An umbrella.')).toBe('umbrella');
  expect(judge('Umbrella!', 'lock (mechanism)', [said('An umbrella.')])).toBe('right');
  expect(judge('Key.', 'lock (mechanism)', [said('An umbrella.')])).toBe('wrong');
});

test('a word that sounds like the answer counts; a different word does not', () => {
  for (const [heard, english] of [['To live.', 'to leave'], ['Hi.', 'eye'], ['I.', 'eye'], ['Hold.', 'old'], ['Ship.', 'sheep'], ['Fill.', 'to feel'], ['Fool.', 'full'], ['Tree.', 'three'], ['Sink.', 'to think'], ['Vest.', 'west'], ['Bi.', 'my (before a masculine noun)']]) {
    expect(judge(heard!, english!)).toBe('right');
  }
  for (const [heard, english] of [['Boy.', 'to be'], ['Train.', 'rain'], ['Run.', 'rain'], ['Back.', 'big; tall'], ['Lesson.', 'person'], ['Toad.', 'frog']]) {
    expect(judge(heard!, english!)).toBe('wrong');
  }
  // Among more words, a word that only sounds like the answer is not it: the "to" of "listen to" is not "tea".
  expect(judge('Listen to.', 'tea')).toBe('wrong');
});

test('answers missed in use: a split word, one word put another way, a word recognition made up, a start', () => {
  expect(judge('Far away.', 'distant; faraway')).toBe('right');
  expect(judge('Piece of clothing.', 'item of clothing; garment')).toBe('right');
  // Not an English word: compared by its consonants, b/m-d-j/s-t like bedsheet.
  expect(judge('Medjit.', 'bedsheet')).toBe('right');
  expect(judge('Just a...', 'chest of drawers; dresser')).toBe('unclear');
  // A real mix-up stays wrong.
  expect(judge('Gift.', 'frame (for a picture)')).toBe('wrong');
  expect(judge('Box of clothing.', 'chest of drawers')).toBe('wrong');
});

test('an apostrophe joins: "It\'s." is the answer "its", and still only an opener for another word', () => {
  expect(judge('It\'s.', 'his; her; its (before a masculine noun)')).toBe('right');
  expect(judge('It’s.', 'frog')).toBe('unclear');
  expect(judge('It\'s a frog.', 'frog')).toBe('right');
  expect(judge('I’m not sure.', 'frog')).toBe('dontknow');
});

test('the hint lists the meanings recognition should expect', () => {
  expect(hint('to learn; to teach someone something')).toBe('learn, teach someone something.');
  expect(hint('perm (hairstyle)')).toBe('perm.');
});
