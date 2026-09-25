import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Word } from '../contract';
import { createSongs } from '../lib/songs';
import { candidateFrom, groupMatches, lyricForms, mergeCandidates, parseFacts, songCategory, songPrompt, type LyricForm, type WordFacts } from '../lib/song-words';
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

// A stand-in for Claude: answers each form from FACTS, or as the test's own answer function says.
type Answer = (entry: LyricForm) => WordFacts | undefined;
function setup(answer: Answer = (entry) => FACTS[entry.form], failure?: Error) {
  const directory = mkdtempSync(join(tmpdir(), 'echo-songs-'));
  directories.push(directory);
  const dbPath = join(directory, 'echo.db');
  const store = createStore(deck, { dbPath });
  const asked: string[] = [];
  const addedIds: string[][] = [];
  const songs = createSongs({
    dbPath, vocabulary: store,
    read: async (lyrics, forms) => {
      asked.push(...forms.map((entry) => entry.form));
      if (failure) throw failure;
      return new Map(forms.flatMap((entry) => { const facts = answer(entry); return facts ? [[entry.form, facts] as const] : []; }));
    },
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

  test('reads the model reply: the facts of each listed form, malformed or missing ones left out', () => {
    const forms = lyricForms(LYRICS).filter((entry) => ['nuages', 'glissent', 'mer'].includes(entry.form));
    expect(songPrompt(LYRICS, forms)).toContain('nuages');
    const reply = 'Here you go:\n' + JSON.stringify({ nuages: FACTS.nuages, glissent: { ...FACTS.glissent, pos: 'gerund' }, mer: { kind: 'place' }, extra: FACTS.vent });
    const facts = parseFacts(reply, forms);
    expect([...facts.keys()].sort()).toEqual(['glissent', 'nuages']);
    expect(facts.get('glissent')!.pos).toBe('expression');
    expect(parseFacts('no json here', forms).size).toBe(0);
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
    expect([byFr.get('je')!.little, byFr.get('les')!.little, byFr.get('le nuage')!.little, byFr.get('glisser')!.little]).toEqual([true, true, false, false]);
    const added = songs.add(song.id, ['le nuage', 'glisser', 'la mer']);
    expect(added.status).toBe('added');
    expect(added.added).toHaveLength(2);
    expect(addedIds).toEqual([added.added]);
    expect(added.added.map((id) => store.word(id)!.fr).sort()).toEqual(['glisser', 'le nuage']);
    expect(store.word(added.added[0])!.category).toBe('song-nuages');
    expect(songs.add(song.id, ['le nuage']).added).toEqual(added.added);
  });

  test('a word Claude leaves unanswered is skipped, but Claude being unreachable stops the song with its message', async () => {
    const shaky = setup((entry) => (entry.form === 'rêver' ? undefined : FACTS[entry.form]));
    const one = await shaky.songs.start({ title: 'Nuages', lyrics: LYRICS });
    await shaky.songs.settled();
    expect(shaky.songs.get(one.id).skipped).toContainEqual({ form: 'rêver', reason: 'no clear answer' });
    const down = setup(undefined, new StoreError('Claude could not read the song.', 503));
    const two = await down.songs.start({ title: 'Nuages', lyrics: LYRICS });
    await down.songs.settled();
    expect(down.songs.get(two.id)).toMatchObject({ status: 'failed', error: 'Claude could not read the song.' });
    await expect(down.songs.retry(two.id)).rejects.toThrow('Paste the lyrics again');
  });

  test('a song started after an empty resume at startup is still read', async () => {
    const { songs } = setup();
    await songs.resume();
    const song = await songs.start({ title: 'Nuages', lyrics: LYRICS });
    await songs.settled();
    expect(songs.get(song.id).status).toBe('ready');
  });

  test('a song not yet read cannot be added, and bad input is refused with a reason', async () => {
    const { songs } = setup();
    const song = await songs.start({ title: 'Nuages', lyrics: LYRICS });
    expect(() => songs.add(song.id, ['le nuage'])).toThrow('still being read');
    await songs.settled();
    await expect(songs.start({ title: '', lyrics: LYRICS })).rejects.toThrow('title');
    await expect(songs.start({ title: 'x', lyrics: '123 456' })).rejects.toThrow('No French words');
    await expect(songs.search('voyage')).rejects.toThrow('could not be reached');
  });
});
