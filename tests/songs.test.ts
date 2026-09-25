import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Word } from '../contract';
import { createSongs } from '../lib/songs';
import { candidateFrom, groupMatches, lyricForms, mergeCandidates, songCategory, type LyricForm, type WordFacts } from '../lib/song-words';
import { createStore, StoreError } from '../lib/store';

// Invented lyrics: the tests never need a real song.
const LYRICS = "Les nuages glissent sur la mer\nJ'arrête de rêver, Paris est loin\nOh, les ailes jaunes du vent";
const deck: Word[] = [
  { id: 'nature-001', fr: 'la mer', en: 'sea', category: 'nature' },
  { id: 'nature-002', fr: 'le vent', en: 'wind', category: 'nature' },
];
const FACTS: Record<string, WordFacts> = {
  nuages: { kind: 'word', pos: 'noun', base: 'nuage', gender: 'masculine', pluralOnly: false, elision: false, feminine: '', en: 'cloud' },
  glissent: { kind: 'word', pos: 'verb', base: 'glisser', gender: 'none', pluralOnly: false, elision: false, feminine: '', en: 'to slide' },
  mer: { kind: 'word', pos: 'noun', base: 'mer', gender: 'feminine', pluralOnly: false, elision: false, feminine: '', en: 'sea' },
  arrête: { kind: 'word', pos: 'verb', base: 'arrêter', gender: 'none', pluralOnly: false, elision: false, feminine: '', en: 'to stop' },
  rêver: { kind: 'word', pos: 'verb', base: 'rêver', gender: 'none', pluralOnly: false, elision: false, feminine: '', en: 'to dream' },
  paris: { kind: 'name', pos: 'noun', base: 'Paris', gender: 'masculine', pluralOnly: false, elision: false, feminine: '', en: 'Paris' },
  est: { kind: 'word', pos: 'verb', base: 'être', gender: 'none', pluralOnly: false, elision: false, feminine: '', en: 'to be' },
  loin: { kind: 'word', pos: 'adverb', base: 'loin', gender: 'none', pluralOnly: false, elision: false, feminine: '', en: 'far' },
  oh: { kind: 'sound', pos: 'expression', base: 'oh', gender: 'none', pluralOnly: false, elision: false, feminine: '', en: 'oh' },
  ailes: { kind: 'word', pos: 'noun', base: 'aile', gender: 'feminine', pluralOnly: false, elision: false, feminine: '', en: 'the wing' },
  jaunes: { kind: 'word', pos: 'adjective', base: 'jaune', gender: 'none', pluralOnly: false, elision: false, feminine: 'jaune', en: 'yellow' },
  vent: { kind: 'word', pos: 'noun', base: 'vent', gender: 'masculine', pluralOnly: false, elision: false, feminine: '', en: 'wind' },
};
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function setup(ask: (entry: LyricForm) => Promise<WordFacts> = async (entry) => FACTS[entry.form]) {
  const directory = mkdtempSync(join(tmpdir(), 'echo-songs-'));
  directories.push(directory);
  const dbPath = join(directory, 'echo.db');
  const store = createStore(deck, { dbPath });
  const asked: string[] = [];
  const addedIds: string[][] = [];
  const songs = createSongs({
    dbPath, vocabulary: store,
    ask: async (entry) => { asked.push(entry.form); return ask(entry); },
    fetchJson: async (url) => {
      if (url.includes('/get/7')) return { id: 7, trackName: 'Nuages', artistName: 'Someone - Topic', plainLyrics: LYRICS };
      throw new Error('offline');
    },
    onAdded: (ids) => addedIds.push(ids),
  });
  return { store, songs, asked, addedIds };
}

describe('reading lyrics', () => {
  test('splits elisions, keeps up to three lines per form, and notes mid-line capitals', () => {
    const forms = new Map(lyricForms(LYRICS).map((entry) => [entry.form, entry]));
    expect(forms.has("j'")).toBe(true);
    expect(forms.has('arrête')).toBe(true);
    expect(forms.get('paris')!.capitalised).toBe(true);
    expect(forms.get('les')!.capitalised).toBe(false);
    expect(forms.get('les')!.lines).toHaveLength(2);
  });

  test('builds the deck’s spelling from the facts: articles, elision, gender notes, feminine forms', () => {
    expect(candidateFrom('ailes', FACTS.ailes)).toEqual({ fr: "l'aile", en: 'wing', note: 'Feminine.', pos: 'noun' });
    expect(candidateFrom('nuages', FACTS.nuages)).toEqual({ fr: 'le nuage', en: 'cloud', note: '', pos: 'noun' });
    expect(candidateFrom('gens', { ...FACTS.nuages, base: 'gens', pluralOnly: true })).toMatchObject({ fr: 'les gens', note: 'Masculine plural.' });
    expect(candidateFrom('vieilles', { ...FACTS.jaunes, base: 'vieux', feminine: 'vieille' })).toMatchObject({ fr: 'vieux', note: 'Feminine: vieille.' });
    expect(candidateFrom('jaunes', FACTS.jaunes)).toMatchObject({ fr: 'jaune', note: '' });
    expect(candidateFrom('paris', FACTS.paris)).toEqual({ form: 'paris', reason: 'a name' });
    // Plural-only needs a plural headword; h aspiré keeps its article; verbs read 'to …'; noun meanings are singular.
    expect(candidateFrom('idées', { ...FACTS.ailes, base: 'idée', pluralOnly: true, en: 'ideas' })).toMatchObject({ fr: "l'idée", en: 'idea', note: 'Feminine.' });
    expect(candidateFrom('hauteurs', { ...FACTS.ailes, base: 'hauteur', elision: false, en: 'heights' })).toMatchObject({ fr: 'la hauteur', en: 'height' });
    expect(candidateFrom('hommes', { ...FACTS.nuages, base: 'homme', elision: true, en: 'men' })).toMatchObject({ fr: "l'homme", note: 'Masculine.' });
    expect(candidateFrom('marécages', { ...FACTS.nuages, base: 'marécage', en: 'marshes' })).toMatchObject({ en: 'marsh' });
    expect(candidateFrom('vole', { ...FACTS.glissent, base: 'voler', en: 'fly; steal' })).toMatchObject({ en: 'to fly; to steal' });
  });

  test('merges forms with one dictionary form and marks words already in the deck', () => {
    const merged = mergeCandidates([
      { form: 'est', entry: { fr: 'être', en: 'to be', note: '', pos: 'verb' } },
      { form: 'suis', entry: { fr: 'être', en: 'to be', note: '', pos: 'verb' } },
      { form: 'mer', entry: { fr: 'la mer', en: 'sea', note: '', pos: 'noun' } },
    ], deck);
    expect(merged.map((entry) => [entry.fr, entry.forms, entry.existing])).toEqual([['être', ['est', 'suis'], null], ['la mer', ['mer'], 'nature-001']]);
  });

  test('groups covers that sing the same lyrics under the most common artist', () => {
    const matches = groupMatches([
      { id: 1, trackName: 'Nuages', artistName: 'Someone - Topic', plainLyrics: LYRICS, duration: 247 },
      { id: 2, trackName: 'Nuages', artistName: 'Someone', plainLyrics: LYRICS.toUpperCase(), duration: 250 },
      { id: 3, trackName: 'Nuages', artistName: 'A cover band', plainLyrics: `${LYRICS}\nNuages nuages`, duration: 200 },
      { id: 4, trackName: 'Nuages', artistName: 'Instrumental', instrumental: true, plainLyrics: '' },
    ]);
    expect(matches.map((match) => [match.artist, match.versions])).toEqual([['Someone', 2], ['A cover band', 1]]);
  });

  test('gives each song a category of its own', () => {
    expect(songCategory('Voyage, voyage', new Set())).toBe('song-voyage-voyage');
    expect(songCategory('Voyage, voyage', new Set(['song-voyage-voyage']))).toBe('song-voyage-voyage-2');
  });
});

describe('songs', () => {
  test('a song is read in the background, little words without asking, then its chosen words join a deck of their own', async () => {
    const { store, songs, asked, addedIds } = setup();
    const started = await songs.start({ lrclibId: 7 });
    expect(started).toMatchObject({ title: 'Nuages', artist: 'Someone', status: 'reading', category: 'song-nuages' });
    await songs.settled();
    const song = songs.get(started.id);
    expect(song.status).toBe('ready');
    expect(song.done).toBe(song.total);
    expect(asked).not.toContain('les');
    expect(asked).not.toContain("j'");
    expect(song.skipped.map((skip) => skip.form).sort()).toEqual(['oh', 'paris']);
    const byFr = new Map(song.candidates.map((entry) => [entry.fr, entry]));
    expect(byFr.get('la mer')!.existing).toBe('nature-001');
    expect(byFr.get('le vent')!.existing).toBe('nature-002');
    expect(byFr.get('je')!.forms).toEqual(["j'"]);
    const added = songs.add(song.id, ['le nuage', 'glisser', 'la mer']);
    expect(added.status).toBe('added');
    expect(added.added).toHaveLength(2);
    expect(addedIds).toEqual([added.added]);
    expect(added.added.map((id) => store.word(id)!.fr).sort()).toEqual(['glisser', 'le nuage']);
    expect(store.word(added.added[0])!.category).toBe('song-nuages');
    expect(songs.add(song.id, ['le nuage']).added).toEqual(added.added);
  });

  test('a word Qwen cannot answer is skipped, but Qwen being unreachable stops the song with its message', async () => {
    const shaky = setup(async (entry) => { if (entry.form === 'rêver') throw new Error('no answer'); return FACTS[entry.form]; });
    const one = await shaky.songs.start({ title: 'Nuages', lyrics: LYRICS });
    await shaky.songs.settled();
    expect(shaky.songs.get(one.id).skipped).toContainEqual({ form: 'rêver', reason: 'Qwen gave no clear answer' });
    const down = setup(async () => { throw new StoreError('Qwen is not running on your Mac.', 503); });
    const two = await down.songs.start({ title: 'Nuages', lyrics: LYRICS });
    await down.songs.settled();
    expect(down.songs.get(two.id)).toMatchObject({ status: 'failed', error: 'Qwen is not running on your Mac.' });
    await expect(down.songs.retry(two.id)).rejects.toThrow('Paste the lyrics again');
  });

  test('a song started after an empty resume at startup is still read', async () => {
    const { songs } = setup();
    await songs.resume();
    const song = await songs.start({ title: 'Nuages', lyrics: LYRICS });
    await songs.settled();
    expect(songs.get(song.id).status).toBe('ready');
  });

  test('a noun that comes back in its plural form is asked about once more', async () => {
    const { songs, asked } = setup(async (entry) => entry.form === 'nuages'
      ? { ...FACTS.nuages, base: entry.note ? 'nuage' : 'nuages' }
      : FACTS[entry.form]);
    const song = await songs.start({ title: 'Nuages', lyrics: LYRICS });
    await songs.settled();
    expect(asked.filter((form) => form === 'nuages')).toHaveLength(2);
    expect(songs.get(song.id).candidates.map((entry) => entry.fr)).toContain('le nuage');
  });

  test('a song not yet read cannot be added, and bad input is refused with a reason', async () => {
    const { songs } = setup(() => new Promise(() => {}));
    const song = await songs.start({ title: 'Nuages', lyrics: LYRICS });
    expect(() => songs.add(song.id, ['le nuage'])).toThrow('still being read');
    await expect(songs.start({ title: '', lyrics: LYRICS })).rejects.toThrow('title');
    await expect(songs.start({ title: 'x', lyrics: '123 456' })).rejects.toThrow('No French words');
    await expect(songs.search('voyage')).rejects.toThrow('could not be reached');
  });
});
