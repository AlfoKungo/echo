// Say it: whether a word recognition wrote down sounds like the word wanted, by the CMU pronouncing dictionary
// (126,000 English words with their sounds). Recognition mixes up words a vowel or a near sound apart — leave and
// live, eye and hi, old and hold — and a learner who meant one hardly ever says the other by mistake, so those count
// as the same word. The dictionary is read on the first check (about 30 ms, 20 MB) and kept.
import { readFileSync } from 'node:fs';

// Vowels next to each other in the mouth, which recognition (and an accent) swaps: leave and live, full and fool.
const CLOSE_VOWELS = [['IY', 'IH'], ['IH', 'EH'], ['EH', 'AE'], ['EY', 'EH'], ['EY', 'IY'], ['AE', 'AA'], ['AA', 'AH'], ['AH', 'AO'], ['AA', 'AO'], ['AO', 'OW'], ['OW', 'UH'], ['UH', 'UW'], ['UH', 'AH'], ['ER', 'AH'], ['AY', 'AA'], ['AW', 'AA']];
// Consonants that sound alike: voiced and voiceless twins, th against t, d, f and s, w and v, the nasals, r and l,
// and a nasal against the stop made in the same place (m and b, n and d, ng and g: "bi" for "my").
const NEAR = new Set([...CLOSE_VOWELS, ['P', 'B'], ['T', 'D'], ['K', 'G'], ['F', 'V'], ['S', 'Z'], ['SH', 'ZH'], ['CH', 'JH'], ['TH', 'DH'], ['TH', 'T'], ['DH', 'D'], ['TH', 'F'], ['TH', 'S'], ['DH', 'Z'], ['W', 'V'], ['M', 'N'], ['N', 'NG'], ['S', 'SH'], ['CH', 'SH'], ['JH', 'ZH'], ['R', 'L'], ['M', 'B'], ['N', 'D'], ['NG', 'G']].flatMap(([a, b]) => [`${a} ${b}`, `${b} ${a}`]));

let dictionary: Map<string, string[][]> | null = null;
function sounds(word: string): string[][] | undefined {
  if (!dictionary) {
    dictionary = new Map();
    // The package is one object literal; read as text it costs a sixth of what importing it does.
    const text = readFileSync(Bun.resolveSync('cmu-pronouncing-dictionary', import.meta.dir), 'utf8');
    for (const [, key, value] of text.matchAll(/^ {2}"([^"]+)": "([^"]+)",?$/gm)) {
      // Keys as say-check writes words: without apostrophes ("don't" is "dont").
      const name = key!.replace(/\(\d+\)$/, '').replace(/'/g, ''), said = value!.replace(/\d/g, '').split(' ');
      const known = dictionary.get(name);
      if (known) known.push(said); else dictionary.set(name, [said]);
    }
  }
  return dictionary.get(word);
}

const change = (left: string, right: string) => left === right ? 0 : NEAR.has(`${left} ${right}`) ? 0.5 : 1;
// An h, or an unstressed "uh", comes and goes in recognition.
const extra = (sound: string) => sound === 'HH' ? 0.3 : sound === 'AH' ? 0.5 : 1;
function distance(heard: string[], wanted: string[]): number {
  let previous = [0];
  for (let j = 1; j <= wanted.length; j++) previous[j] = previous[j - 1]! + extra(wanted[j - 1]!);
  for (let i = 1; i <= heard.length; i++) {
    const current = [previous[0]! + extra(heard[i - 1]!)];
    for (let j = 1; j <= wanted.length; j++) {
      current[j] = Math.min(previous[j]! + extra(heard[i - 1]!), current[j - 1]! + extra(wanted[j - 1]!), previous[j - 1]! + change(heard[i - 1]!, wanted[j - 1]!));
    }
    previous = current;
  }
  return previous[wanted.length]!;
}
// How far a word may be from the wanted one: one near sound (or an h) in a word of up to four sounds, two in longer ones.
const allowed = (length: number) => length <= 4 ? 0.5 : length <= 7 ? 1 : 1.5;
export function soundsAlike(heard: string, wanted: string): boolean {
  const heardSounds = sounds(heard), wantedSounds = sounds(wanted);
  if (!heardSounds || !wantedSounds) return false;
  return wantedSounds.some((want) => heardSounds.some((said) => distance(said, want) <= allowed(want.length)));
}
