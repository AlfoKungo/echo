import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowseWord, WalkmanTape, WalkmanWord, Word } from '../contract';

// Walkman clips are all encoded the same way: 24 kHz mono MPEG-2 Layer III at 64 kbps, no headers or tags.
// Every frame is then exactly 192 bytes and 24 ms, so a tape is plain concatenation: clips and silence
// frames joined byte for byte, with every word's timing known exactly.
export const FRAME_BYTES = 192;
export const FRAME_SECONDS = 0.024;
const HEADER = [0xff, 0xf3];

// Per word: French, a pause to recall the meaning, the English, the French again, then a breath.
const LEAD = 0.6;
const RECALL = 2.0;
const AFTER_MEANING = 0.7;
const BETWEEN = 1.8;
// A familiar word returns only after this many others; a new word returns twice, 5 and 14 words later.
const SPACING = 15;
const NEW_EVERY = 5;
const NEW_PER_TAPE = 20;
const REPEATS = [5, 14];
export const TAPE_SECONDS = 30 * 60;

// The order of a tape, word ids with repeats. Words being learnt come first, those missed most at the
// front; then words due for review, then the known words soonest to fade. Every fifth word is new, taken
// in content order from one category (the one already most studied that still has new words), and heard
// twice more soon after. Listening never changes the vocabulary schedule.
export function planTape(words: BrowseWord[], slots: number, random: () => number = Math.random): string[] {
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
  const fading = shuffled(words.filter((word) => word.status === 'scheduled').sort(byDue).slice(0, 80));
  const familiar = [...learning, ...due, ...fading].map((word) => word.id);

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

export type Tape = { id: string; bytes: Uint8Array<ArrayBuffer>; words: WalkmanWord[]; seconds: number };

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

export function buildTape(id: string, plan: string[], byId: Map<string, Word>, clips: ReturnType<typeof createClips>, seconds = TAPE_SECONDS): Tape {
  const silence = clips.silence();
  if (!silence) throw new Error('The Walkman silence frame is missing.');
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
  for (const wordId of plan) {
    const word = byId.get(wordId);
    const french = clips.french(wordId);
    const english = clips.english(wordId);
    if (!word || !french || !english) continue;
    const start = now();
    add(french);
    pause(RECALL);
    const meaningAt = now();
    add(english);
    pause(AFTER_MEANING);
    const againAt = now();
    add(french);
    const end = now();
    pause(BETWEEN);
    words.push({ id: wordId, fr: word.fr, en: word.en, start, meaningAt, againAt, end });
    if (now() >= seconds) break;
  }
  const bytes = new Uint8Array(frames * FRAME_BYTES);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return { id, bytes, words, seconds: now() };
}

export function tapeView(tape: Tape): WalkmanTape {
  return { id: tape.id, url: `api/walkman/${tape.id}.mp3`, seconds: tape.seconds, words: tape.words };
}
