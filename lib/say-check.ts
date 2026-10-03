// Say it: whether what the learner said aloud, as speech recognition wrote it down, is the English for a French
// word. A word's English is a list of meanings ("to learn; to teach someone something", "stranger (unknown
// person, male)"): any one of them counts, without what is in brackets or a leading "to", "the", "a" or "an".
// Recognition is not spelling: one slip in a long word, a plural for a singular, a filler ("um", "it's") and words
// that only finish a phrase ("look" for "to look at") are all fine. What recognition invents from silence or noise
// ("Thank you.", "you") is not an answer at all, so it counts neither way.
export type SayVerdict = 'right' | 'wrong' | 'unclear';

const LEADING = new Set(['to', 'the', 'a', 'an']);
const FILLERS = new Set(['um', 'umm', 'uh', 'uhm', 'er', 'erm', 'ah', 'hmm', 'mm', 'oh', 'so', 'well', 'okay', 'ok']);
const OPENERS = [['it', 's'], ['it', 'is'], ['its'], ['i', 'think'], ['that', 's'], ['that', 'is'], ['it', 'means'], ['means']];
// Words that only finish a phrase: saying "look" for "to look at" or "teach" for "to teach someone something".
const TAILS = new Set(['at', 'of', 'to', 'up', 'out', 'on', 'in', 'for', 'with', 'about', 'off', 'someone', 'something', 'oneself', 'yourself', 'sth', 'sb']);
// What Whisper writes for silence, breath or room noise when nothing was said.
const NOTHING = new Set(['you', 'thank you', 'thanks', 'thanks for watching', 'thank you for watching', 'bye bye', 'music', 'applause', 'silence', 'blank audio', 'inaudible']);

const plain = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const words = (text: string) => plain(text).split(' ').filter(Boolean);
function trimLeading(list: string[]): string[] {
  let start = 0;
  while (start < list.length - 1 && LEADING.has(list[start]!)) start++;
  return list.slice(start);
}

// The ways a gloss can be said: each meaning between semicolons or commas, as words.
export function answers(english: string): string[][] {
  return english.replace(/\([^)]*\)/g, ' ').split(/[;,/]/).map((part) => trimLeading(words(part))).filter((list) => list.length > 0);
}
// What recognition is told to expect: the word's meanings. On 50 words said by two voices it caught 90 of 100 right
// answers against 88 without, and still let none of 50 wrong answers through.
export const hint = (english: string) => answers(english).map((list) => list.join(' ')).join(', ') + '.';

function heardWords(heard: string): string[] {
  let list = words(heard).filter((word) => !FILLERS.has(word));
  for (const opener of OPENERS) if (opener.every((word, index) => list[index] === word) && list.length > opener.length) { list = list.slice(opener.length); break; }
  return trimLeading(list);
}

function distance(left: string, right: string): number {
  if (Math.abs(left.length - right.length) > 2) return 3;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[right.length]!;
}
// A plural for a singular, either way: gates and gate, boxes and box.
const forms = (word: string) => [word, ...(word.length > 2 && word.endsWith('s') ? [word.slice(0, -1)] : []), ...(word.length > 3 && word.endsWith('es') ? [word.slice(0, -2)] : [])];
function sameWord(heard: string, wanted: string): boolean {
  if (forms(heard).some((form) => forms(wanted).includes(form))) return true;
  const allowed = wanted.length >= 9 ? 2 : wanted.length >= 5 ? 1 : 0;
  return allowed > 0 && distance(heard, wanted) <= allowed;
}
const samePhrase = (heard: string[], wanted: string[]) => heard.length === wanted.length && heard.every((word, index) => sameWord(word, wanted[index]!));

function matches(heard: string[], wanted: string[]): boolean {
  if (samePhrase(heard, wanted)) return true;
  // The phrase without the words that only finish it.
  let core = wanted.length;
  while (core > 1 && TAILS.has(wanted[core - 1]!)) core--;
  for (let end = core; end < wanted.length; end++) if (samePhrase(heard, wanted.slice(0, end))) return true;
  // The answer said within a few more words: "a frog, I think", "rich, wealthy".
  if (heard.length > wanted.length && heard.length <= wanted.length + 3) {
    for (let start = 0; start + wanted.length <= heard.length; start++) if (samePhrase(heard.slice(start, start + wanted.length), wanted)) return true;
  }
  return false;
}

export function judge(heard: string, english: string): SayVerdict {
  const said = heardWords(heard);
  if (said.length && answers(english).some((wanted) => matches(said, wanted))) return 'right';
  if (!said.length || NOTHING.has(plain(heard))) return 'unclear';
  return 'wrong';
}
