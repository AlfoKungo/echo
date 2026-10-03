// Say it: whether what recognition wrote down sounds like the answer wanted, by the CMU pronouncing dictionary
// (126,000 English words with their sounds). Recognition mixes up words a vowel or a near sound apart — leave and
// live, eye and hi, old and hold — and splits or joins words (far away, faraway); a learner who meant one hardly
// ever says the other by mistake, so those count as the same. Phrases are compared as one run of sounds. A word the
// dictionary lacks (recognition's own inventions, "medjit") is compared by its outline of consonants instead. The
// dictionary is read on the first check (about 30 ms, 20 MB) and kept.
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
// How far an answer may be from the wanted one: one near sound (or an h) in up to four sounds, two in up to seven.
// Looser (two in three or four sounds) let through four times as many different words (run for rain, walk for talk)
// and none of the real answers missed in use.
const allowed = (length: number) => length <= 4 ? 0.5 : length <= 7 ? 1 : 1.5;

// A phrase's sounds: its words' one after another, each word's first two ways of saying it, at most eight ways in all;
// undefined when a word is not in the dictionary.
function phraseSounds(list: readonly string[]): string[][] | undefined {
  let ways: string[][] = [[]];
  for (const word of list) {
    const own = sounds(word);
    if (!own) return undefined;
    ways = ways.flatMap((start) => own.slice(0, 2).map((way) => [...start, ...way])).slice(0, 8);
  }
  return ways;
}
// The consonants of letters, with near ones written alike and vowels, h and y dropped: "medjit" and "bedsheet" are
// both BTST.
function outline(text: string): string {
  const letters = text.replace(/ph/g, 'f').replace(/th/g, 't').replace(/[sc]h|j|g(?=[eiy])|c(?=[eiy])|x|z/g, 's').replace(/ck|c|q/g, 'k');
  const marks: Record<string, string> = { b: 'B', p: 'B', m: 'B', f: 'F', v: 'F', w: 'F', d: 'T', t: 'T', n: 'T', k: 'K', g: 'K', s: 'S', l: 'L', r: 'L' };
  let out = '';
  for (const letter of letters) { const mark = marks[letter]; if (mark && !out.endsWith(mark)) out += mark; }
  return out;
}

// Whether `heard` sounds like `wanted` (each plain lower-case words).
export function soundsAlike(heard: readonly string[], wanted: readonly string[]): boolean {
  const heardWays = phraseSounds(heard), wantedWays = phraseSounds(wanted);
  if (heardWays && wantedWays) return wantedWays.some((want) => heardWays.some((said) => distance(said, want) <= allowed(want.length)));
  const said = outline(heard.join('')), want = outline(wanted.join(''));
  return want.length >= 2 && said === want;
}
