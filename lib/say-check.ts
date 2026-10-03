// Say it: whether what the learner said aloud, as speech recognition wrote it down, is the English for a French
// word. A word's English is a list of meanings ("to learn; to teach someone something", "stranger (unknown
// person, male)"): any one of them counts, without what is in brackets or a leading "to", "the", "a" or "an".
// Recognition is not spelling: one slip in a long word, a plural for a singular, a filler ("um", "it's") and words
// that only finish a phrase ("look" for "to look at") are all fine. What recognition invents from silence or noise
// ("Thank you.", "you"), and thinking aloud ("let me think", "wait"), is not an answer at all, so Echo listens on.
// Giving up out loud ("I don't know", "no idea", "pass") is: it counts as not knowing the word. What the learner
// once marked as heard wrong for a word (Store.sayAccepted) counts as its English.
export type SayVerdict = 'right' | 'wrong' | 'dontknow' | 'unclear';

const LEADING = new Set(['to', 'the', 'a', 'an']);
const FILLERS = new Set(['um', 'umm', 'uh', 'uhm', 'er', 'erm', 'ah', 'hmm', 'mm', 'oh', 'so', 'well', 'okay', 'ok']);
const OPENERS = [['it', 's'], ['it', 'is'], ['its'], ['i', 'think'], ['that', 's'], ['that', 'is'], ['it', 'means'], ['means']];
// Words that only finish a phrase: saying "look" for "to look at" or "teach" for "to teach someone something".
const TAILS = new Set(['at', 'of', 'to', 'up', 'out', 'on', 'in', 'for', 'with', 'about', 'off', 'someone', 'something', 'oneself', 'yourself', 'sth', 'sb']);
// What Whisper writes for silence, breath or room noise when nothing was said.
const NOTHING = new Set(['you', 'thank you', 'thanks', 'thanks for watching', 'thank you for watching', 'bye bye', 'music', 'applause', 'silence', 'blank audio', 'inaudible']);
// Thinking aloud, or an opener cut off before the answer, after fillers are dropped.
const THINKING = ['let me think', 'let me see', 'wait', 'hold on', 'one second', 'one sec', 'just a second', 'just a moment', 'moment', 'i know this', 'i know this one', 'what is it', 'what was it', 'i think', 'it s', 'it is', 'its', 'that s', 'it means', 'means'];
// Giving up, said at the start of what was heard ("I don't know this one").
const DONT_KNOW = ['i don t know', 'don t know', 'i dont know', 'dont know', 'i do not know', 'dunno', 'i dunno', 'no idea', 'i have no idea', 'i ve got no idea', 'no clue', 'i have no clue', 'pass', 'i pass', 'skip', 'i give up', 'i forgot', 'i forget', 'i don t remember', 'don t remember', 'i can t remember', 'i m not sure', 'not sure'];

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

// What was said, as it is kept when the learner marks it right after Echo heard it wrong.
export const said = (heard: string) => heardWords(heard).join(' ');
const startsWith = (phrase: string, start: string) => phrase === start || (phrase.startsWith(start + ' ') && phrase.split(' ').length <= start.split(' ').length + 3);

export function judge(heard: string, english: string, accepted: readonly string[] = []): SayVerdict {
  const list = heardWords(heard), phrase = list.join(' ');
  if (list.length && (accepted.includes(phrase) || answers(english).some((wanted) => matches(list, wanted)))) return 'right';
  if (DONT_KNOW.some((start) => startsWith(phrase, start))) return 'dontknow';
  if (!list.length || NOTHING.has(plain(heard)) || THINKING.includes(phrase)) return 'unclear';
  return 'wrong';
}
