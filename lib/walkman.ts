import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowseWord, GrammarLevel, WalkmanChoice, WalkmanTape, WalkmanWord, Word } from '../contract';

// Walkman clips are all encoded the same way: 24 kHz mono MPEG-2 Layer III at 64 kbps, no headers or tags.
// Every frame is then exactly 192 bytes and 24 ms, so a tape is plain concatenation: clips and silence
// frames joined byte for byte, with every word's timing known exactly.
export const FRAME_BYTES = 192;
export const FRAME_SECONDS = 0.024;
const HEADER = [0xff, 0xf3];

// Per word: French, a pause to recall the meaning, the English, the French again, then a breath.
const LEAD = 0.6;
export type Timing = { recall: number; afterMeaning: number; between: number };
export const WORD_TIMING: Timing = { recall: 2.0, afterMeaning: 0.7, between: 1.8 };
// A sentence takes longer to understand than a word to recall, and a breath more before the next.
export const SENTENCE_TIMING: Timing = { recall: 2.5, afterMeaning: 0.8, between: 2.2 };
// A familiar word returns only after this many others; a new word returns twice, 10 and 30 words later, so each
// return is a real recall and the start of a tape, where new words gather, does not circle the same few.
const SPACING = 15;
const NEW_EVERY = 8;
const NEW_PER_TAPE = 20;
const REPEATS = [10, 30];
export const TAPE_SECONDS = 30 * 60;
// By score, a familiar word's chance is 2^(-score/SCORE_PULL): a word at -6 is about 130 times likelier than one
// at +6.
// Scores are clamped so no word is ever certain or never heard; each pick counts the listen to come.
const SCORE_PULL = 1.7;
const SCORE_LIMIT = 8;
const PICK_HEARD = 0.5;

// The order of a tape, word ids with repeats. Every eighth word is new, taken in content order from one
// category (the one already most studied that still has new words), and heard twice more later on.
// The other words are familiar ones. By groups: words being learnt come first, those missed most at the
// front; then words due for review, then the known words soonest to fade. By score: any started word,
// drawn at random with low scores far likelier. Listening never changes the vocabulary schedule.
export function planTape(words: (BrowseWord & { score?: number })[], slots: number, random: () => number = Math.random, choice: WalkmanChoice = 'groups'): string[] {
  const shuffled = <T>(list: T[]) => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  };
  const learning = shuffled(words.filter((word) => word.status === 'learning')).sort((a, b) => b.misses - a.misses);
  const byDue = (a: BrowseWord, b: BrowseWord) => (a.due ?? '').localeCompare(b.due ?? '');
  const due = words.filter((word) => word.status === 'due').sort(byDue);
  const scheduled = words.filter((word) => word.status === 'scheduled').sort(byDue);
  const familiar = choice === 'scored'
    ? [...learning, ...due, ...scheduled].map((word) => word.id)
    : [...learning, ...due, ...shuffled(scheduled.slice(0, 80))].map((word) => word.id);
  const score = new Map(words.map((word) => [word.id, word.score ?? 0]));

  const studied = new Map<string, number>();
  for (const word of words) if (word.status !== 'new') studied.set(word.category, (studied.get(word.category) ?? 0) + 1);
  const categories = [...new Set(words.map((word) => word.category))]
    .filter((category) => words.some((word) => word.category === category && word.status === 'new'));
  const first = categories.toSorted((a, b) => (studied.get(b) ?? 0) - (studied.get(a) ?? 0))[0];
  const fresh = [first, ...categories.filter((category) => category !== first)]
    .flatMap((category) => words.filter((word) => word.category === category && word.status === 'new').map((word) => word.id))
    .slice(0, NEW_PER_TAPE);

  const plan: string[] = [];
  const heardAt = new Map<string, number>();
  // slot -> new words due to be heard again there. After its last repeat a new word joins the familiar
  // rotation, so a learner with few familiar words still gets a full tape.
  const repeats = new Map<number, string[]>();
  const repeatsLeft = new Map<string, number>();
  let pointer = 0;
  const waiting = () => [...repeatsLeft.values()].reduce((total, left) => total + left, 0);
  const introduce = (slot: number) => {
    const id = fresh.shift()!;
    for (const gap of REPEATS) repeats.set(slot + gap, [...(repeats.get(slot + gap) ?? []), id]);
    repeatsLeft.set(id, REPEATS.length);
    return id;
  };
  const nextFamiliar = (slot: number) => {
    if (choice === 'scored') return drawFamiliar(slot);
    for (let step = 0; step < familiar.length; step++) {
      const index = (pointer + step) % familiar.length;
      const id = familiar[index]!;
      if (slot - (heardAt.get(id) ?? -Infinity) > SPACING) {
        pointer = index + 1;
        return id;
      }
    }
    return undefined;
  };
  const drawFamiliar = (slot: number) => {
    const eligible = familiar.filter((id) => slot - (heardAt.get(id) ?? -Infinity) > SPACING);
    const weights = eligible.map((id) => 2 ** (-Math.max(-SCORE_LIMIT, Math.min(SCORE_LIMIT, score.get(id) ?? 0)) / SCORE_PULL));
    let left = random() * weights.reduce((total, weight) => total + weight, 0);
    const index = weights.findIndex((weight) => (left -= weight) < 0);
    const id = eligible[index < 0 ? eligible.length - 1 : index];
    if (id) score.set(id, (score.get(id) ?? 0) + PICK_HEARD);
    return id;
  };
  // A hole in the plan is filled by bringing the next repeat forward, never the word just played.
  const earliestRepeat = (previous: string | undefined) => {
    for (const slot of [...repeats.keys()].sort((a, b) => a - b)) {
      const list = repeats.get(slot)!;
      const index = list.findIndex((candidate) => candidate !== previous);
      if (index < 0) continue;
      const [id] = list.splice(index, 1);
      if (!list.length) repeats.delete(slot);
      return id;
    }
    return undefined;
  };
  for (let slot = 0; slot < slots; slot++) {
    const previous = plan.at(-1);
    const queued = repeats.get(slot);
    let id = queued?.shift();
    if (queued?.length) repeats.set(slot + 1, [...queued, ...(repeats.get(slot + 1) ?? [])]);
    repeats.delete(slot);
    const newTurn = slot % NEW_EVERY === NEW_EVERY - 1 || familiar.length === 0;
    if (!id && newTurn && fresh.length && waiting() < 3 * REPEATS.length) id = introduce(slot);
    id ??= nextFamiliar(slot);
    if (!id && fresh.length) id = introduce(slot);
    id ??= earliestRepeat(previous);
    // Too few words for full spacing: the one heard longest ago, never the word just played.
    id ??= familiar.filter((candidate) => candidate !== previous)
      .sort((a, b) => (heardAt.get(a) ?? -Infinity) - (heardAt.get(b) ?? -Infinity))[0];
    if (!id) break;
    if (heardAt.has(id) && repeatsLeft.has(id)) {
      const left = repeatsLeft.get(id)! - 1;
      if (left) repeatsLeft.set(id, left);
      else {
        repeatsLeft.delete(id);
        familiar.push(id);
      }
    }
    plan.push(id);
    heardAt.set(id, slot);
  }
  return plan;
}

const LEVELS: GrammarLevel[] = ['A1', 'A2', 'B1'];
// The order of a sentence tape: sentences up to the learner's level, each at most once, drawn at random with
// the ones holding the words most worth hearing far likelier to come early. A sentence counts as its most
// pressing word: one being learnt or due weighs four times its score's weight, any other started word its
// score's weight (2^(-score/2), as on a word tape by score), and a sentence of unstarted words only a little.
export function planSentences<T extends { level: GrammarLevel; words: string[] }>(sentences: T[], words: (BrowseWord & { score?: number })[], level: GrammarLevel, random: () => number = Math.random): T[] {
  const top = LEVELS.indexOf(level);
  const weight = new Map(words.filter((word) => word.status !== 'new').map((word) => {
    const base = 2 ** (-Math.max(-SCORE_LIMIT, Math.min(SCORE_LIMIT, word.score ?? 0)) / 2);
    return [word.id, word.status === 'learning' || word.status === 'due' ? 4 * base : base];
  }));
  // Weighted order without replacement: each key is random^(1/weight), highest first.
  return sentences.filter((sentence) => LEVELS.indexOf(sentence.level) <= top)
    .map((sentence) => ({ sentence, key: random() ** (1 / Math.max(0.05, ...sentence.words.map((id) => weight.get(id) ?? 0))) }))
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.sentence);
}

export type Tape = { id: string; kind: 'words' | 'sentences'; bytes: Uint8Array<ArrayBuffer>; words: WalkmanWord[]; seconds: number };
// One thing on a tape with its two recordings; sentence marks a whole sentence rather than a word.
export type TapeItem = Omit<WalkmanWord, 'start' | 'meaningAt' | 'againAt' | 'end'> & { french: Uint8Array; english: Uint8Array };

// Clips are read once and kept; a clip that is missing or not in the Walkman format is skipped.
export function createClips(audioDir: string) {
  const cache = new Map<string, Uint8Array | null>();
  const load = (path: string) => {
    if (cache.has(path)) return cache.get(path)!;
    let bytes: Uint8Array | null = null;
    if (existsSync(path)) {
      const data = new Uint8Array(readFileSync(path));
      if (data.length && data.length % FRAME_BYTES === 0 && data[0] === HEADER[0] && data[1] === HEADER[1]) bytes = data;
    }
    cache.set(path, bytes);
    return bytes;
  };
  return {
    french: (id: string) => load(join(audioDir, 'walkman', 'fr', `${id}.mp3`)),
    english: (id: string) => load(join(audioDir, 'walkman', 'en', `${id}.mp3`)),
    silence: () => load(join(audioDir, 'walkman', 'silence.mp3')),
    forget: () => cache.clear(),
  };
}

// fresh names the words not yet started in Vocabulary, so the history can offer to add them.
export function buildTape(id: string, plan: string[], byId: Map<string, Word>, clips: ReturnType<typeof createClips>, fresh: Set<string> = new Set(), seconds = TAPE_SECONDS): Tape {
  const silence = clips.silence();
  if (!silence) throw new Error('The Walkman silence frame is missing.');
  function* items(): Generator<TapeItem> {
    for (const wordId of plan) {
      const word = byId.get(wordId);
      const french = clips.french(wordId);
      const english = clips.english(wordId);
      if (word && french && english) yield { id: wordId, fr: word.fr, en: word.en, fresh: fresh.has(wordId), french, english };
    }
  }
  return layTape(id, 'words', items(), silence, WORD_TIMING, seconds);
}

// Lays items end to end, each as French, a pause, the English, a breath, the French again, until the tape
// reaches its length; items are drawn only as needed.
export function layTape(id: string, kind: Tape['kind'], items: Iterable<TapeItem>, silence: Uint8Array, timing: Timing, seconds = TAPE_SECONDS): Tape {
  const parts: Uint8Array[] = [];
  let frames = 0;
  const add = (bytes: Uint8Array) => {
    parts.push(bytes);
    frames += bytes.length / FRAME_BYTES;
  };
  const pause = (length: number) => {
    const count = Math.round(length / FRAME_SECONDS);
    const block = new Uint8Array(count * FRAME_BYTES);
    for (let frame = 0; frame < count; frame++) block.set(silence.subarray(0, FRAME_BYTES), frame * FRAME_BYTES);
    add(block);
  };
  const now = () => Math.round(frames * FRAME_SECONDS * 1000) / 1000;
  const words: WalkmanWord[] = [];
  pause(LEAD);
  for (const { french, english, ...item } of items) {
    const start = now();
    add(french);
    pause(timing.recall);
    const meaningAt = now();
    add(english);
    pause(timing.afterMeaning);
    const againAt = now();
    add(french);
    const end = now();
    pause(timing.between);
    words.push({ ...item, start, meaningAt, againAt, end });
    if (now() >= seconds) break;
  }
  const bytes = new Uint8Array(frames * FRAME_BYTES);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return { id, kind, bytes, words, seconds: now() };
}

export function tapeView(tape: Tape): WalkmanTape {
  return { id: tape.id, kind: tape.kind, url: `api/walkman/${tape.id}.mp3`, seconds: tape.seconds, words: tape.words };
}
