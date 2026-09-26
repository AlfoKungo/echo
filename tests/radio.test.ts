import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRadio, grammarProblems, radioDay, type RadioClip } from '../lib/radio';
import { FRAME_BYTES, FRAME_SECONDS } from '../lib/walkman';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const frames = (count: number) => { const bytes = new Uint8Array(count * FRAME_BYTES); for (let i = 0; i < count; i++) { bytes[i * FRAME_BYTES] = 0xff; bytes[i * FRAME_BYTES + 1] = 0xf3; } return bytes; };
const grammarReply = JSON.stringify({ lines: [
  { en: 'We use this for things happening now.' }, { fr: 'Je mange une pomme.', en: 'I eat an apple.' },
  { en: 'The ending changes with the person.' }, { fr: 'Nous mangeons.', en: 'We eat.' },
  { en: 'Listen for the ending.' }, { fr: 'Ils mangent.', en: 'They eat.' },
] });

function radio(options: { skip?: (clip: RadioClip) => boolean; recorded?: boolean; at?: Date; ready?: (root: string) => Promise<void> } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'echo-radio-'));
  directories.push(root);
  mkdirSync(join(root, 'audio/walkman/fr'), { recursive: true });
  mkdirSync(join(root, 'audio/walkman/en'), { recursive: true });
  mkdirSync(join(root, 'audio/comprehension'), { recursive: true });
  mkdirSync(join(root, 'audio/story'), { recursive: true });
  mkdirSync(join(root, 'audio/radio'), { recursive: true });
  writeFileSync(join(root, 'audio/walkman/silence.mp3'), frames(42));
  for (const file of ['walkman/fr/chat.mp3', 'walkman/en/chat.mp3', 'comprehension/s1.mp3']) writeFileSync(join(root, 'audio', file), frames(10));
  if (options.recorded !== false) for (const index of [1, 2]) writeFileSync(join(root, `audio/story/story-01-${index}.mp3`), frames(10));
  const asks: string[] = [];
  const made: string[] = [];
  let at = options.at ?? new Date(2026, 8, 26, 12);
  const value = createRadio({
    root, dataDir: join(root, 'data'), now: () => at,
    ask: async (prompt) => { asks.push(prompt); return grammarReply; },
    words: () => [
      { id: 'chat', fr: 'le chat', en: 'cat', status: 'due', score: 1 },
      { id: 'pain', fr: 'le pain', en: 'bread', status: 'learning', score: 0 },
      { id: 'maison', fr: 'la maison', en: 'house', status: 'scheduled', score: 0 },
    ],
    sentences: () => [{ id: 's1', level: 'A1', fr: 'Le pain est bon.', en: 'The bread is good.', distractors: [], gap: 'pain', topics: [], words: ['pain'], gloss: [] }],
    episode: () => ({ id: 'story-01', number: 1, titleEn: 'The Key', summary: 'Léa finds a key.', focus: { topic: 'present-er', title: 'Present tense' }, lines: [{ fr: 'Léa arrive.', en: 'Léa arrives.' }, { fr: 'Elle regarde.', en: 'She looks.' }] }),
    topics: () => [{ id: 'present-er', title: 'Present tense', level: 'A1', description: 'Regular -er verbs.', independent: 0 }],
    level: () => 'A2',
    record: async (planPath) => {
      for (const clip of JSON.parse(readFileSync(planPath, 'utf8')) as RadioClip[]) {
        if (options.skip?.(clip)) continue;
        writeFileSync(join(root, 'audio/radio', `${clip.id}.mp3`), frames(clip.kind === 'convert' ? 10 : 20));
        made.push(clip.kind === 'convert' ? `convert ${clip.source}` : `${clip.kind} ${clip.text}`);
      }
    },
    ...(options.ready ? { ready: () => options.ready!(root) } : {}),
  });
  return { value, asks, made, root, move: (next: Date) => { at = next; } };
}

describe('the radio', () => {
  test('the day turns at 04:00', () => {
    expect(radioDay(new Date(2026, 8, 26, 3, 59))).toBe('2026-09-25');
    expect(radioDay(new Date(2026, 8, 26, 4, 0))).toBe('2026-09-26');
  });

  test('a grammar segment that quotes French in its English is sent back', () => {
    const problems = grammarProblems({ topic: 't', title: 'T', lines: [{ en: 'Say “je mange”.' }, { en: 'b' }, { en: 'c' }, { fr: 'Je mange', en: 'I eat.' }, { fr: 'Tu manges.', en: 'You eat.' }, { fr: 'Il mange.', en: 'He eats.' }] });
    expect(problems.some((problem) => problem.includes('cannot quote French'))).toBe(true);
    expect(problems.some((problem) => problem.includes('must end with'))).toBe(true);
  });

  test('prepares one episode: words in sentences, the story line by line, then grammar, timed to the frame', async () => {
    const { value, made } = radio();
    expect(value.view().state).toBe('preparing');
    await value.check();
    const view = value.view();
    expect(view.state).toBe('ready');
    expect(view.segments.map((segment) => segment.section)).toEqual(['intro', 'words', 'words', 'words', 'story', 'story', 'story', 'grammar', 'grammar', 'grammar', 'grammar', 'grammar', 'grammar', 'grammar', 'outro']);
    // The word being learnt comes first and is heard in its sentence; the due word falls back to its word clips.
    expect(view.segments[2]).toMatchObject({ label: 'le pain', fr: 'Le pain est bon.', en: 'The bread is good.' });
    expect(view.segments[3]).toMatchObject({ label: 'le chat', fr: 'le chat', en: 'cat' });
    // English is said without French accents; the screen keeps them.
    expect(made).toContain('en Lea arrives.');
    expect(view.segments[5]).toMatchObject({ fr: 'Léa arrive.', en: 'Léa arrives.' });
    const bytes = value.audio(view.day)!;
    expect(bytes.length % FRAME_BYTES).toBe(0);
    expect(view.seconds).toBe(Math.round((bytes.length / FRAME_BYTES) * FRAME_SECONDS * 1000) / 1000);
    view.segments.forEach((segment, index) => { if (index) expect(segment.start).toBe(view.segments[index - 1]!.end); });
  });

  test('a missing French clip leaves its part out, a missing translation only itself; an unrecorded story is not offered', async () => {
    const { value } = radio({ skip: (clip) => (clip.kind === 'en' && clip.text === 'The bread is good.') || (clip.kind === 'convert' && clip.source === 'audio/walkman/fr/chat.mp3'), recorded: false });
    await value.check();
    const view = value.view();
    const bread = view.segments.find((segment) => segment.label === 'le pain')!;
    // The French twice (10 frames each) and its pauses 1.5 + 1.8 s, without the English or the 0.8 s after it.
    expect(Math.round((bread.end - bread.start) * 1000)).toBe(Math.round((20 * FRAME_SECONDS + Math.round(1.5 / FRAME_SECONDS) * FRAME_SECONDS + Math.round(1.8 / FRAME_SECONDS) * FRAME_SECONDS) * 1000));
    expect(view.segments.some((segment) => segment.label === 'le chat')).toBe(false);
    expect(view.segments.some((segment) => segment.section === 'story')).toBe(false);
    expect(view.segments.some((segment) => segment.section === 'grammar')).toBe(true);
  });

  test('the grammar segment is written once per topic; each day keeps its own script', async () => {
    const { value, asks, move } = radio();
    await value.check();
    move(new Date(2026, 8, 27, 12));
    await value.check();
    expect(asks).toHaveLength(1);
    expect(value.view().day).toBe('2026-09-27');
    expect(value.audio('2026-09-26')).toBeNull();
  });
});

test('the day’s script waits for the story, so an episode it is still recording is in it', async () => {
  const { value } = radio({ recorded: false, ready: async (root) => { for (const index of [1, 2]) writeFileSync(join(root, `audio/story/story-01-${index}.mp3`), frames(10)); } });
  await value.check();
  expect(value.view().segments.filter((segment) => segment.section === 'story')).toHaveLength(3);
});
