import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { Word } from '../contract';
import { GENDER_RULES, type LanguageCode } from '../lib/language';
import { createStore, genderOf } from '../lib/store';

const { fr, pt, sv } = GENDER_RULES;
const content = join(import.meta.dir, '..', 'content');
// A deck as the server loads it: the learnt text under fr, whatever key its file keeps it under.
async function deck(code: LanguageCode): Promise<Map<string, Word>> {
  const dir = code === 'fr' ? content : join(content, code);
  const entries = [...await Bun.file(join(dir, 'core.json')).json(), ...await Bun.file(join(dir, 'world.json')).json()] as (Word & Record<string, string>)[];
  return new Map(entries.map((entry) => [entry.id, { ...entry, fr: entry[code] }]));
}

test('French: the article, or for l’, les and des the note; a note naming both genders names none', () => {
  expect(genderOf({ fr: 'le nuage' }, fr)).toBe('masculine');
  expect(genderOf({ fr: 'un livre' }, fr)).toBe('masculine');
  expect(genderOf({ fr: 'la pluie' }, fr)).toBe('feminine');
  expect(genderOf({ fr: 'une table' }, fr)).toBe('feminine');
  expect(genderOf({ fr: "l'eau", note: 'Feminine noun.' }, fr)).toBe('feminine');
  expect(genderOf({ fr: 'l’arbre', note: 'Masculine.' }, fr)).toBe('masculine');
  expect(genderOf({ fr: 'les lunettes', note: 'Feminine plural.' }, fr)).toBe('feminine');
  expect(genderOf({ fr: 'des gens', note: 'Masculine plural.' }, fr)).toBe('masculine');
  expect(genderOf({ fr: "l'enfant", note: 'Masculine or feminine according to the child.' }, fr)).toBeUndefined();
  expect(genderOf({ fr: "l'artiste", note: 'Can be masculine or feminine.' }, fr)).toBeUndefined();
  expect(genderOf({ fr: "l'hôtel" }, fr)).toBeUndefined();
  expect(genderOf({ fr: 'manger', note: 'Masculine nouns follow it.' }, fr)).toBeUndefined();
});

test('Portuguese: o, os, um, uns masculine and a, as, uma, umas feminine, the surprises included', async () => {
  const words = await deck('pt');
  const gender = (id: string) => genderOf(words.get(id)!, pt);
  expect([gender('work-043'), gender('travel-021'), gender('health-time-028')]).toEqual(['masculine', 'masculine', 'masculine']); // o problema, o mapa, o dia
  expect([gender('health-time-004'), gender('people-001'), gender('media-034')]).toEqual(['feminine', 'feminine', 'feminine']); // a mão, a pessoa, a foto
  // Plural-only nouns keep their article's gender.
  expect([gender('people-050'), gender('travel-018')]).toEqual(['masculine', 'feminine']); // os óculos, as férias
  expect(genderOf({ fr: 'um carro' }, pt)).toBe('masculine');
  expect(genderOf({ fr: 'umas casas' }, pt)).toBe('feminine');
  // Not nouns: a gente (we), o que (what), um alone (a; one), and words whose note names a feminine form.
  expect([gender('essentials-024'), gender('essentials-032'), gender('essentials-058')]).toEqual([undefined, undefined, undefined]);
  expect([gender('essentials-017'), gender('qualities-003'), gender('essentials-003')]).toEqual([undefined, undefined, undefined]); // bem-vindo, bom, bom dia
  const counts = Map.groupBy([...words.values()], (word) => genderOf(word, pt) ?? 'none');
  expect([counts.get('masculine')?.length, counts.get('feminine')?.length]).toEqual([336, 286]);
});

test('Swedish: en a common noun and ett a neuter one, from the article or the note of a bare noun; ett alone is the number', async () => {
  const words = await deck('sv');
  const gender = (id: string) => genderOf(words.get(id)!, sv);
  expect([gender('essentials-051'), gender('health-time-003')]).toEqual(['common', 'neuter']); // en sak, ett huvud
  expect([gender('food-006'), gender('food-001')]).toEqual(['common', 'neuter']); // mjölk "En-word: …", vatten "Ett-word: …"
  expect([gender('travel-028'), gender('media-002')]).toEqual(['neuter', 'neuter']); // centrum, internet: "Ett-word; …"
  expect(gender('health-time-047')).toBeUndefined(); // ett: one
  expect(gender('shopping-001')).toBeUndefined(); // pengar: "Plural only: pengarna."
  expect([gender('essentials-022'), gender('essentials-013'), gender('verbs-014')]).toEqual([undefined, undefined, undefined]); // den, välkommen, veta
  expect(genderOf({ fr: 'en' }, sv)).toBeUndefined();
  const counts = Map.groupBy([...words.values()], (word) => genderOf(word, sv) ?? 'none');
  expect([counts.get('common')?.length, counts.get('neuter')?.length]).toEqual([444, 159]);
  expect(counts.has('masculine') || counts.has('feminine')).toBe(false);
});

test('the store reads its deck by the rules it is given, and French rules give a Swedish word no gender', () => {
  const words: Word[] = [
    { id: 'a-001', fr: 'ett hus', en: 'house', category: 'a' },
    { id: 'a-002', fr: 'vatten', en: 'water', category: 'a', note: 'Ett-word: vattnet.' },
    { id: 'a-003', fr: 'ett', en: 'one', category: 'a', note: 'En before an en-word: en bil, ett hus.' },
  ];
  const swedish = createStore(words, { dbPath: ':memory:', gender: sv });
  expect(words.map((word) => swedish.word(word.id)!.gender)).toEqual(['neuter', 'neuter', undefined]);
  const french = createStore(words, { dbPath: ':memory:' });
  expect(words.map((word) => french.word(word.id)!.gender)).toEqual([undefined, undefined, undefined]);
});
