import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyCard } from 'ts-fsrs';
import type { Word } from '../contract';
import { checkItem, createPairs, lookAlike, minePairs, nextItem, pairLabel, parseItems, type Pair, type PairWord } from '../lib/pairs';
import { createStore, type Store } from '../lib/store';

const stores: Store[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const folder = () => { const directory = mkdtempSync(join(tmpdir(), 'echo-pairs-')); directories.push(directory); return directory; };

const deck: Word[] = [
  { id: 'verbs-042', fr: 'porter', en: 'to carry; to wear', category: 'verbs' },
  { id: 'verbs-043', fr: 'apporter', en: 'to bring', category: 'verbs' },
  { id: 'verbs-044', fr: 'emporter', en: 'to take away', category: 'verbs' },
  { id: 'verbs-090', fr: 'importer', en: 'to import', category: 'verbs' },
  { id: 'verbs-100', fr: 'cuisiner', en: 'to cook', category: 'verbs' },
  { id: 'home-010', fr: 'la cuisine', en: 'kitchen', category: 'home' },
  { id: 'food-001', fr: 'le pain', en: 'bread', category: 'food' },
  { id: 'body-001', fr: 'la main', en: 'hand', category: 'body' },
  { id: 'qualities-021', fr: 'lent', en: 'slow', category: 'qualities' },
  { id: 'qualities-015', fr: 'haut', en: 'high', category: 'qualities' },
  { id: 'animals-001', fr: 'le chat', en: 'cat', category: 'animals' },
  { id: 'places-001', fr: 'chez', en: 'at the home of', category: 'places' },
  // A song's copy of a deck word: the same French under another id.
  { id: 'song-x-001', fr: 'porter', en: 'to carry', category: 'song-x' },
];
const families = [['verbs-042', 'verbs-043', 'verbs-044'], ['home-010', 'verbs-100']];
// Misses French → English per started word; importer is never started.
const misses: Record<string, number> = {
  'verbs-042': 5, 'verbs-043': 0, 'verbs-044': 6, 'verbs-100': 1, 'home-010': 2, 'food-001': 1, 'body-001': 1,
  'qualities-021': 7, 'qualities-015': 3, 'animals-001': 1, 'places-001': 1, 'song-x-001': 0,
};

// A store on a fresh database holding the fixture's history: every started word a finished French → English card,
// and its misses as answers known=0.
function fixtureStore(): Store {
  const dbPath = join(folder(), 'echo.db');
  const store = createStore(deck, { dbPath, families, now: () => new Date(2026, 9, 1, 10) });
  stores.push(store);
  const db = new Database(dbPath);
  const at = new Date(2026, 9, 1).getTime();
  let request = 0;
  for (const [id, count] of Object.entries(misses)) {
    db.query(`INSERT INTO cards (direction, word_id, introduced_day, active, successes, cycle_misses, completed_day, due_at, fsrs_json, version, last_clean)
      VALUES ('fr-en', ?, '2026-09-01', 0, 0, 0, '2026-09-01', ?, ?, 1, 0)`).run(id, at + 7 * 86400000, JSON.stringify(createEmptyCard(new Date(at))));
    for (let miss = 0; miss < count; miss++) {
      db.query(`INSERT INTO grades (request_id, direction, deck, word_id, version, known, graded_at, before_json, after_json)
        VALUES (?, 'fr-en', 'all', ?, 1, 0, '2026-09-20T10:00:00.000Z', '{}', '{}')`).run(`miss-${++request}`, id);
    }
  }
  db.close();
  return store;
}

describe('finding the pairs', () => {
  test('look-alikes: one inside the other, or a letter or two apart in a long enough word', () => {
    expect(lookAlike('porter', 'emporter')).toBe(true);
    expect(lookAlike('emporter', 'apporter')).toBe(true);
    expect(lookAlike('pain', 'main')).toBe(true);
    expect(lookAlike('chat', 'chez')).toBe(false);
    expect(lookAlike('lent', 'haut')).toBe(false);
  });

  test('ranks family pairs, look-alikes and the trouble list by misses, never a word with itself or an unstarted one', () => {
    const pairs = minePairs(fixtureStore().browse('fr-en', 'all'), families);
    expect(pairs.map((pair) => [pairLabel(pair), pair.misses, pair.kinds.toSorted()])).toEqual([
      ['porter · emporter', 11, ['alongside', 'family', 'look-alike']],
      ['haut · lent', 10, ['alongside']],
      ['apporter · emporter', 6, ['family', 'look-alike']],
      ['porter · apporter', 5, ['family', 'look-alike']],
      ['la cuisine · cuisiner', 3, ['family', 'look-alike']],
      ['la main · le pain', 2, ['look-alike']],
    ]);
    for (const pair of pairs) expect(pair.a.id).not.toBe(pair.b.id);
    expect(pairs.flatMap((pair) => [pair.a.id, pair.b.id])).not.toContain('verbs-090');
  });

  test('a pair needs one of its words missed: two started words never missed make none', () => {
    const word = (id: string, fr: string): PairWord => ({ id, fr, en: fr, category: 'verbs', status: 'scheduled', misses: 0 });
    expect(minePairs([word('a', 'porter'), word('b', 'emporter')], [['a', 'b']])).toEqual([]);
    expect(minePairs([word('a', 'porter'), { ...word('b', 'emporter'), status: 'new', misses: 4 }], [['a', 'b']])).toEqual([]);
  });
});

const word = (id: string, fr: string, en: string): PairWord => ({ id, fr, en, category: 'verbs', status: 'scheduled', misses: 3 });
const porter = word('verbs-042', 'porter', 'to carry'), emporter = word('verbs-044', 'emporter', 'to take away');
const pair: Pair = { a: porter, b: emporter, kinds: ['look-alike'], misses: 6 };
const item = (fr: string, answer: string, other: string, which = 2) => ({ pair: 1, word: which, fr, answer, other, en: 'I take a sandwich for the train.', why: '« Emporter » is to take along.' });

describe('checking what Claude wrote', () => {
  test('keeps an item with one blank and a form of each word, the answer’s word named', () => {
    expect(checkItem(item('Je ___ un sandwich pour le train.', 'emporte', 'porte'), pair)).toEqual({
      wordId: 'verbs-044', otherId: 'verbs-042', fr: 'Je ___ un sandwich pour le train.', answer: 'emporte', other: 'porte',
      en: 'I take a sandwich for the train.', why: '« Emporter » is to take along.',
    });
    expect(checkItem(item('Elle ____ une robe rouge.', 'porte', 'emporte', 1), pair)).toMatchObject({ wordId: 'verbs-042', otherId: 'verbs-044', fr: 'Elle ___ une robe rouge.' });
  });

  test.each([
    ['two blanks', item('Je ___ un sandwich et ___ le train.', 'emporte', 'porte')],
    ['no blank', item('Je mange un sandwich.', 'emporte', 'porte')],
    ['the same two forms', item('Je ___ un sandwich.', 'porte', 'Porte')],
    ['an answer unrelated to its word', item('Je ___ un sandwich.', 'mange', 'porte')],
    ['another form unrelated to its word', item('Je ___ un sandwich.', 'emporte', 'mange')],
    ['the forms the wrong way round', item('Je ___ un sandwich.', 'porte', 'emporte')],
    ['no word named', item('Je ___ un sandwich.', 'emporte', 'porte', 3)],
    ['a sentence past the A2 cap', item('Demain matin très tôt je ___ un grand sandwich au jambon pour le long voyage en train.', 'emporte', 'porte')],
    ['a missing part', { ...item('Je ___ un sandwich.', 'emporte', 'porte'), why: '' }],
  ])('drops %s', (_name, raw) => {
    expect(checkItem(raw, pair)).toBeString();
  });

  test('a verb’s conjugated form counts as its form even when it shares no letters with it', () => {
    const aller = word('verbs-001', 'aller', 'to go'), venir = word('verbs-002', 'venir', 'to come');
    const going: Pair = { a: aller, b: venir, kinds: ['alongside'], misses: 6 };
    const forms = (id: string) => (id === 'verbs-001' ? ['vais', 'vas', 'va', 'suis allé'] : ['viens', 'vient']);
    const raw = { pair: 1, word: 1, fr: 'Demain je ___ à Paris.', answer: 'vais', other: 'viens', en: 'Tomorrow I am going to Paris.', why: '…' };
    expect(checkItem(raw, going)).toBeString();
    expect(checkItem(raw, going, forms)).toMatchObject({ wordId: 'verbs-001', answer: 'vais' });
  });

  test('a reply keeps the good items, names what is wrong with the rest, and reads nothing from prose', () => {
    const reply = `Here: ${JSON.stringify({ items: [item('Je ___ un sandwich.', 'emporte', 'porte'), item('Je ___ ___.', 'emporte', 'porte'), { ...item('Je ___ un sac.', 'porte', 'emporte', 1), pair: 7 }] })}`;
    const { items, problems } = parseItems(reply, [pair]);
    expect(items.map((entry) => entry.fr)).toEqual(['Je ___ un sandwich.']);
    expect(problems).toEqual(['porter · emporter: not exactly one blank', 'pair 7: no such pair']);
    expect(parseItems('I could not do that.', [pair])).toEqual({ items: [], problems: ['the reply could not be read'] });
  });
});

describe('the order items come in', () => {
  const items = [1, 2, 3, 4, 5].map((id) => ({ id, rank: id === 5 ? 0 : 1 }));
  const answered = (...given: [number, boolean][]) => given.map(([item_id, right], index) => ({ sequence: index + 1, item_id, right: Number(right) }));

  test('least seen first, the most missed pair first among equals', () => {
    expect(nextItem(items, [])).toEqual({ id: 5, again: false });
    expect(nextItem(items, answered([5, true], [1, true]))).toEqual({ id: 2, again: false });
  });

  test('a missed item comes back after three others, not before', () => {
    expect(nextItem(items, answered([5, false]))).toEqual({ id: 1, again: false });
    expect(nextItem(items, answered([5, false], [1, true], [2, true]))).toEqual({ id: 3, again: false });
    expect(nextItem(items, answered([5, false], [1, true], [2, true], [3, true]))).toEqual({ id: 5, again: true });
    expect(nextItem(items, answered([5, false], [1, true], [2, true], [3, true], [5, true]))).toEqual({ id: 4, again: false });
  });

  test('with only missed items left, the one missed longest ago comes back early', () => {
    expect(nextItem(items.slice(0, 2), answered([1, false], [2, false]))).toEqual({ id: 1, again: true });
    expect(nextItem([], [])).toBeNull();
  });
});

describe('the stream of items', () => {
  test('writes a batch for the top pairs, shows it, keeps answers once, and brings a miss back after three others', async () => {
    const prompts: string[] = [];
    const sentences = ['Je ___ un sandwich.', 'Tu ___ ton sac.', 'Il ___ un livre.', 'Elle ___ une robe.', 'On ___ du pain.'];
    const pairs = createPairs({
      dbPath: join(folder(), 'echo.db'),
      ask: async (prompt) => {
        prompts.push(prompt);
        return JSON.stringify({ items: sentences.map((fr, index) => item(fr, index % 2 ? 'porte' : 'emporte', index % 2 ? 'emporte' : 'porte', index % 2 ? 1 : 2)) });
      },
      enabled: () => true,
      words: () => [porter, emporter, word('verbs-090', 'importer', 'to import')].map((entry) => entry.id === 'verbs-090' ? { ...entry, status: 'new' as const } : entry),
      families: [], verbForms: () => [], known: () => [{ fr: 'le pain', en: 'bread' }],
    });
    const first = pairs.state();
    expect(first).toEqual({ current: null, writing: true, error: null, pairs: 1 });
    await pairs.settled();
    expect(prompts[0]).toContain('word 1: porter (to carry); word 2: emporter (to take away)');
    expect(prompts[0]).toContain('le pain = bread');
    const shown: string[] = [];
    let state = pairs.state();
    expect(state.current).toMatchObject({ fr: 'Je ___ un sandwich.', words: ['porter', 'emporter'], again: false });
    expect(state.current!.choices.toSorted()).toEqual(['emporte', 'porte']);
    // Missed, then three others, then back.
    expect(pairs.answer({ requestId: 'r1', id: state.current!.id, choice: 'porte' })).toMatchObject({ right: false, answer: 'emporte', chosen: 'porte' });
    expect(pairs.answer({ requestId: 'r1', id: state.current!.id, choice: 'emporte' })).toMatchObject({ right: false, chosen: 'porte' });
    expect(() => pairs.answer({ requestId: 'r2', id: state.current!.id, choice: 'mange' })).toThrow('Choose one of the two words.');
    for (let turn = 0; turn < 4; turn++) {
      state = pairs.state();
      shown.push(`${state.current!.fr}${state.current!.again ? ' again' : ''}`);
      pairs.answer({ requestId: `t${turn}`, id: state.current!.id, choice: state.current!.check.answer });
    }
    expect(shown).toEqual(['Tu ___ ton sac.', 'Il ___ un livre.', 'Elle ___ une robe.', 'Je ___ un sandwich. again']);
    await pairs.settled();
    pairs.close();
  });

  test('with Claude switched off nothing is asked, and a failed batch is shown and not asked again at once', async () => {
    let asked = 0;
    const words = () => [porter, emporter];
    const off = createPairs({ dbPath: join(folder(), 'echo.db'), ask: async () => { asked++; return ''; }, enabled: () => false, words, families: [], verbForms: () => [], known: () => [] });
    expect(off.state()).toEqual({ current: null, writing: false, error: null, pairs: 1 });
    off.close();
    const failing = createPairs({ dbPath: join(folder(), 'echo.db'), ask: async () => { asked++; return 'Sorry.'; }, enabled: () => true, words, families: [], verbForms: () => [], known: () => [] });
    failing.state();
    await failing.settled();
    expect(failing.state()).toMatchObject({ current: null, writing: false, error: 'Claude’s sentences for your pairs could not be used. Please try again later.' });
    expect(asked).toBe(1);
    failing.close();
  });
});
