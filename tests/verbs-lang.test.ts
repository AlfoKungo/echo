import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuleCards } from '../lib/rule-cards';
import { createVerbDrills } from '../lib/verb-drills';
import { loadPtVerbs, PORTUGUESE, PT_TENSES, ptBase, ptTable, type PtVerb } from '../lib/verbs-pt';
import { svGroup, svVerbs, SWEDISH, type SvVerb } from '../lib/verbs-sv';

const root = join(import.meta.dir, '..');
async function deck(code: 'pt' | 'sv') {
  const entries = [...await Bun.file(join(root, `content/${code}/core.json`)).json(), ...await Bun.file(join(root, `content/${code}/world.json`)).json()] as Record<string, string>[];
  return entries.map((word) => ({ id: word.id!, fr: word[code]!, en: word.en!, category: word.category, note: word.note }));
}
const ptVerbs = loadPtVerbs(join(root, 'content/pt/verbs.json'), await deck('pt'));
const svList = svVerbs(await deck('sv'));
const pt = (inf: string) => ptVerbs.find((verb) => verb.inf === inf)!;
const sv = (inf: string) => svList.find((verb) => verb.inf === inf)!;
const shown = (forms: ({ shown: string } | null)[]) => forms.filter(Boolean).map((form) => form!.shown);

describe('Portuguese', () => {
  test('content/pt/verbs.json is what the rules and the irregular list make, for every verb in the deck', async () => {
    const words = (await deck('pt')).filter((word) => /^to /.test(word.en) || word.category === 'verbs');
    expect(ptVerbs.map((verb) => verb.id)).toEqual(words.map((word) => word.id));
    for (const verb of ptVerbs) expect({ pres: verb.pres, perf: verb.perf, imp: verb.imp }).toEqual(ptTable(ptBase(verb.inf)));
  });

  test('four persons in Brazilian usage, the irregular forms, reflexives, phrases and the future with ir', () => {
    expect(PORTUGUESE.persons(pt('falar'), 'pres')).toEqual([0, 2, 3, 5]);
    expect(PORTUGUESE.conjugate(pt('falar'), 'pres')[1]).toBeNull();
    expect(shown(PORTUGUESE.conjugate(pt('fazer'), 'perf'))).toEqual(['fiz', 'fez', 'fizemos', 'fizeram']);
    expect(shown(PORTUGUESE.conjugate(pt('ficar'), 'perf'))).toEqual(['fiquei', 'ficou', 'ficamos', 'ficaram']);
    expect(shown(PORTUGUESE.conjugate(pt('ter'), 'imp'))).toEqual(['tinha', 'tinha', 'tínhamos', 'tinham']);
    expect(shown(PORTUGUESE.conjugate(pt('se divertir'), 'pres'))).toEqual(['me divirto', 'se diverte', 'nos divertimos', 'se divertem']);
    expect(shown(PORTUGUESE.conjugate(pt('se divertir'), 'fut'))).toEqual(['vou me divertir', 'vai se divertir', 'vamos nos divertir', 'vão se divertir']);
    expect(shown(PORTUGUESE.conjugate(pt('sentir falta'), 'pres'))[0]).toBe('sinto falta');
    expect(PORTUGUESE.conjugate(pt('ir'), 'fut')[0]).toEqual({ shown: 'vou', accepted: ['vou', 'vou ir'] });
    expect(PORTUGUESE.groupOf(pt('dormir'), 'pres')).toBe('eu-change');
    expect(PORTUGUESE.groupOf(pt('conhecer'), 'pres')).toBe('spelling');
    expect(PORTUGUESE.groupOf(pt('saber'), 'pres')).toBe('irregular');
    expect(PORTUGUESE.groupOf(pt('ser'), 'imp')).toBe('irregular');
  });

  test('a wrong answer is named: another person or tense, the regular form of an irregular verb, a spelling rule', () => {
    const why = (inf: string, tense: typeof PT_TENSES[number], person: number, given: string) => PORTUGUESE.diagnose(pt(inf), tense, person, given);
    expect(why('falar', 'pres', 0, 'fala')).toBe('That’s the você / ele / ela form.');
    expect(why('falar', 'pres', 0, 'falei')).toBe('That’s the pretérito perfeito.');
    expect(why('fazer', 'perf', 0, 'fazi')).toBe('fazer is irregular in the pretérito perfeito: eu fiz.');
    expect(why('dormir', 'pres', 0, 'dormo')).toBe('Only eu changes its stem here: eu durmo (ele dorme).');
    expect(why('ficar', 'perf', 0, 'ficei')).toContain('c becomes qu');
    expect(why('falar', 'fut', 0, 'falarei')).toBe('That’s the written future; in speech Brazil says eu vou falar.');
    expect(PORTUGUESE.isRight(PORTUGUESE.conjugate(pt('poder'), 'perf')[2]!, 'ele pode')).toBe(true);
    expect(PORTUGUESE.accentSlip(PORTUGUESE.conjugate(pt('poder'), 'perf')[2]!, 'ele pode')).toBe(true);
  });

  test('By ear never asks a tense two of the tenses offered say alike', () => {
    const asked = PORTUGUESE.earQuestions(pt('falar'), ['pres', 'perf']).map((question) => question.said);
    expect(asked).toEqual(['eu falo', 'eu falei']);
    expect(PORTUGUESE.earQuestions(pt('ir'), ['pres', 'fut'])).toEqual([]);
  });
});

describe('Swedish', () => {
  test('every verb in the deck has its three key forms from its note, and a group read off them', async () => {
    const words = (await deck('sv')).filter((word) => /^to /.test(word.en) || word.category === 'verbs');
    expect(svList.map((verb) => verb.id)).toEqual(words.map((word) => word.id));
    const group = (inf: string) => `${sv(inf).group}:${sv(inf).kind}`;
    expect([group('prata'), group('ringa'), group('köpa'), group('höra'), group('bo'), group('springa'), group('vara')]).toEqual(['one:ar', 'two:de', 'two:te', 'two:r-stem', 'three:short', 'four:strong', 'four:irregular']);
    expect([group('gå ut'), group('sätta sig'), group('hoppas'), group('skämmas'), group('ska'), group('måste')]).toEqual(['four:irregular', 'four:irregular', 'one:ar', 'two:de', 'four:irregular', 'four:irregular']);
    expect(svGroup('tända', ['tänder', 'tände', 'tänt'])).toEqual({ group: 'two', kind: 'de' });
    expect(sv('gå ut').forms).toEqual(['går ut', 'gick ut', 'gått ut']);
  });

  test('a verb has forms only in its own group; har before the supine counts, å ä ö do not come for free', () => {
    expect(SWEDISH.persons(sv('springa'), 'four')).toEqual([0, 1, 2]);
    expect(SWEDISH.persons(sv('springa'), 'one')).toEqual([]);
    const supine = SWEDISH.conjugate(sv('springa'), 'four')[2]!;
    expect(SWEDISH.isRight(supine, 'har sprungit')).toBe(true);
    expect(SWEDISH.isRight(SWEDISH.conjugate(sv('gå'), 'four')[1]!, 'gick')).toBe(true);
    expect(SWEDISH.isRight(SWEDISH.conjugate(sv('gå'), 'four')[2]!, 'gatt')).toBe(false);
    expect(SWEDISH.diagnose(sv('gå'), 'four', 2, 'gatt')).toBe('Mind å, ä and ö: they are letters of their own (gått).');
    expect(SWEDISH.diagnose(sv('springa'), 'four', 1, 'springade')).toBe('springa is not an -ar verb: sprang.');
    expect(SWEDISH.diagnose(sv('köpa'), 'two', 1, 'köpde')).toBe('After k, p, s or t the past takes -te: köpte.');
    expect(SWEDISH.diagnose(sv('gå ut'), 'four', 1, 'gick')).toBe('Keep the particle after the verb: gick ut.');
    expect(SWEDISH.diagnose(sv('springa'), 'four', 1, 'sprungit')).toBe('That’s the supine.');
    expect(SWEDISH.isRight(SWEDISH.conjugate(sv('säga'), 'four')[1]!, 'sade')).toBe(true);
    expect(SWEDISH.isRight(SWEDISH.conjugate(sv('lägga sig'), 'four')[1]!, 'lade sig')).toBe(true);
    expect(SWEDISH.isRight(SWEDISH.conjugate(sv('ge'), 'four')[2]!, 'har givit')).toBe(true);
  });
});

describe('drills in another language', () => {
  const directories: string[] = [];
  const closers: (() => void)[] = [];
  afterEach(() => { for (const close of closers.splice(0)) close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
  function fixture<V extends { id: string; inf: string; en: string }, T extends string>(verbs: V[], grammar: Parameters<typeof createVerbDrills<V, T>>[0]['grammar']) {
    const directory = mkdtempSync(join(tmpdir(), 'echo-verbs-lang-'));
    directories.push(directory);
    let seed = 11;
    const options = { dbPath: join(directory, 'echo.db'), verbs: () => verbs, grammar, vocabulary: () => [], earAudio: () => null, random: () => ((seed = (seed * 16807) % 2147483647) / 2147483647), now: () => new Date(2026, 9, 10, 10) };
    const drills = createVerbDrills<V, T>(options);
    const rules = createRuleCards<V, T>({ dbPath: options.dbPath, verbs: options.verbs, grammar, vocabulary: () => [], audio: () => null, random: options.random, now: options.now });
    closers.push(drills.close, rules.close);
    return { drills, rules };
  }

  test('Portuguese rounds ask only eu, ele, nós and eles, and a typed answer and a whole table are checked', () => {
    const { drills, rules } = fixture<PtVerb, typeof PT_TENSES[number]>(ptVerbs, PORTUGUESE);
    const round = drills.round({ set: 'common', tenses: ['pres', 'perf'] });
    expect(round.length).toBe(20);
    expect(round.every((item) => [0, 2, 3, 5].includes(item.person) && ['presente', 'pretérito perfeito'].includes(item.tenseName))).toBe(true);
    expect(drills.answer({ requestId: 'a', verbId: pt('ser').id, tense: 'perf', person: 0, given: 'eu fui' })).toMatchObject({ right: true, expected: 'eu fui' });
    expect(drills.answer({ requestId: 'b', verbId: pt('fazer').id, tense: 'perf', person: 0, given: 'fazi' })).toMatchObject({ right: false, why: 'fazer is irregular in the pretérito perfeito: eu fiz.' });
    const table = drills.table({ requestId: 'c', verbId: pt('falar').id, tense: 'imp', answers: ['falava', '', 'fala', 'falávamos', '', 'falavam'] });
    expect([table.right, table.total, table.cells[1]]).toEqual([3, 4, null]);
    expect(drills.summary().verbs.find((row) => row.id === pt('fazer').id)!.states.perf).toEqual(['shaky', null, 'new', 'new', null, 'new']);
    const cards = rules.round({ verbs: ptVerbs.slice(0, 20), tenses: ['imp'] });
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.tense === 'imp')).toBe(true);
  });

  test('a Swedish card asks one verb’s three forms, and its mark counts for each of them', () => {
    const { drills, rules } = fixture<SvVerb, 'one' | 'two' | 'three' | 'four'>(svList, SWEDISH);
    const cards = drills.cards({ set: 'chosen', verbIds: [sv('springa').id, sv('prata').id], tenses: ['one', 'two', 'three', 'four'] });
    expect(cards.map((card) => [card.inf, card.answer]).sort()).toEqual([['prata', 'pratar, pratade, pratat'], ['springa', 'springer, sprang, sprungit']]);
    drills.mark({ requestId: 'm', verbId: sv('springa').id, tense: 'four', person: 0, knew: true });
    expect(drills.summary().verbs.find((row) => row.id === sv('springa').id)!.states.four).toEqual(['getting', 'getting', 'getting', null, null, null]);
    expect(drills.nextTable({ set: 'chosen', verbIds: [sv('springa').id], tenses: ['four'] })).toEqual({ verbId: sv('springa').id, tense: 'four' });
    expect(() => drills.nextTable({ set: 'chosen', verbIds: [sv('springa').id], tenses: ['one'] })).toThrow('No tables for these verbs in that group.');
    expect(() => drills.round({ set: 'common', tenses: [] })).toThrow('Choose at least one group.');
    expect(rules.round({ verbs: svList, tenses: ['four'] }).every((card) => card.tense === 'four')).toBe(true);
    expect(SWEDISH.ruleDeck(svList, new Set(), svList, ['four']).filter((card) => card.ask === 'The vowel change').map((card) => card.answer)).toContain('i → a → u');
  });
});
