import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { languages } from '../lib/language';
import { createWordAudio } from '../lib/word-audio';
import { createAttempts } from '../lib/recording-attempts';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

test('a word recorded in French but not yet in English is recorded again on resume, and joins practice already', async () => {
  const root = mkdtempSync(join(tmpdir(), 'echo-word-audio-'));
  directories.push(root);
  for (const dir of ['audio', 'audio/en', 'audio/walkman/fr', 'audio/walkman/en']) mkdirSync(join(root, dir), { recursive: true });
  const clip = (dir: string, id: string) => writeFileSync(join(root, dir, `${id}.mp3`), 'x');
  for (const dir of ['audio', 'audio/en', 'audio/walkman/fr', 'audio/walkman/en']) clip(dir, 'song-a-001');
  clip('audio', 'song-a-002');
  const runs: string[][] = [];
  let finish = () => {};
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const audio = createWordAudio({
    language: languages(root).fr, walkman: true, extraWordsPath: join(root, 'added.json'),
    addedWords: () => [{ id: 'song-a-001', fr: 'le ciel', en: 'sky', category: 'song-a' }, { id: 'song-a-002', fr: 'la mer', en: 'sea', category: 'song-a' }],
    run: async (args) => {
      runs.push(args);
      if (args[0] === 'scripts/build-walkman-clips.py') { for (const dir of ['audio/en', 'audio/walkman/fr', 'audio/walkman/en']) clip(dir, 'song-a-002'); finish(); }
      return { ok: true, error: '' };
    },
    attempts: createAttempts(join(root, 'attempts.json')),
  });
  expect(audio.ready('song-a-002')).toBe(true);
  audio.resume();
  await done;
  expect(runs.map((args) => args.at(-1))).toEqual(['song-a-002', 'song-a-002', join(root, 'added.json')]);
});

test('a word no take passes for is retried on each start until it has failed three times, then left alone', async () => {
  const root = mkdtempSync(join(tmpdir(), 'echo-word-audio-'));
  directories.push(root);
  mkdirSync(join(root, 'audio'), { recursive: true });
  let runs = 0;
  const start = async () => {
    let finish = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const audio = createWordAudio({
      language: languages(root).fr, walkman: true, extraWordsPath: join(root, 'added.json'),
      addedWords: () => [{ id: 'song-a-003', fr: 'le vent', en: 'wind', category: 'song-a' }],
      run: async (args) => { if (args[0] === 'scripts/render-audio.py') runs += 1; if (args[0] === 'scripts/build-walkman-clips.py') setTimeout(finish, 0); return { ok: false, error: '' }; },
      attempts: createAttempts(join(root, 'attempts.json')),
    });
    audio.resume();
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 50))]);
  };
  for (let restart = 0; restart < 5; restart++) await start();
  expect(runs).toBe(3);
  // Deleting its entry from the file lets it be tried again.
  writeFileSync(join(root, 'attempts.json'), '{}');
  await start();
  expect(runs).toBe(4);
});

test('another language records with its own recorder into its own folder, its text under its code, and no Walkman copies', async () => {
  const root = mkdtempSync(join(tmpdir(), 'echo-word-audio-'));
  directories.push(root);
  const swedish = languages(root).sv;
  mkdirSync(swedish.audio, { recursive: true });
  const runs: string[][] = [];
  let finish = () => {};
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const audio = createWordAudio({
    language: swedish, walkman: false, extraWordsPath: join(root, 'added.json'),
    addedWords: () => [{ id: 'song-a-004', fr: 'havet', en: 'the sea', category: 'song-a' }],
    run: async (args) => { runs.push(args); writeFileSync(join(swedish.audio, 'song-a-004.mp3'), 'x'); finish(); return { ok: true, error: '' }; },
    attempts: createAttempts(join(root, 'attempts.json')),
  });
  audio.enqueue(['song-a-004']);
  await done;
  expect(runs).toEqual([['scripts/render-audio-sv.py', '--extra-words', join(root, 'added.json'), '--ids', 'song-a-004']]);
  expect(JSON.parse(readFileSync(join(root, 'added.json'), 'utf8'))[0].sv).toBe('havet');
  expect(audio.ready('song-a-004')).toBe(true);
  expect(existsSync(join(root, 'audio', 'song-a-004.mp3'))).toBe(false);
});
