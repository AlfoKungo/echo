import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkItem, createGrammarEar, KIND_MIX, numberHeard, planSlots, TENSE_MIX, tensesHeardApart } from '../lib/grammar-ear';
import { verbOf, type VerbTable } from '../lib/verbs';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const tables: Record<string, [VerbTable, string]> = {
  prendre: [{ id: 'prendre', pres: ['prends', 'prends', 'prend', 'prenons', 'prenez', 'prennent'], imp: ['prenais', 'prenais', 'prenait', 'prenions', 'preniez', 'prenaient'], fut: 'prendr', pp: 'pris', aux: 'avoir' }, 'to take'],
  manger: [{ id: 'manger', pres: ['mange', 'manges', 'mange', 'mangeons', 'mangez', 'mangent'], imp: ['mangeais', 'mangeais', 'mangeait', 'mangions', 'mangiez', 'mangeaient'], fut: 'manger', pp: 'mangé', aux: 'avoir' }, 'to eat'],
  aimer: [{ id: 'aimer', pres: ['aime', 'aimes', 'aime', 'aimons', 'aimez', 'aiment'], imp: ['aimais', 'aimais', 'aimait', 'aimions', 'aimiez', 'aimaient'], fut: 'aimer', pp: 'aimé', aux: 'avoir' }, 'to love'],
  voir: [{ id: 'voir', pres: ['vois', 'vois', 'voit', 'voyons', 'voyez', 'voient'], imp: ['voyais', 'voyais', 'voyait', 'voyions', 'voyiez', 'voyaient'], fut: 'verr', pp: 'vu', aux: 'avoir' }, 'to see'],
  courir: [{ id: 'courir', pres: ['cours', 'cours', 'court', 'courons', 'courez', 'courent'], imp: ['courais', 'courais', 'courait', 'courions', 'couriez', 'couraient'], fut: 'courr', pp: 'couru', aux: 'avoir' }, 'to run'],
  finir: [{ id: 'finir', pres: ['finis', 'finis', 'finit', 'finissons', 'finissez', 'finissent'], imp: ['finissais', 'finissais', 'finissait', 'finissions', 'finissiez', 'finissaient'], fut: 'finir', pp: 'fini', aux: 'avoir' }, 'to finish'],
  etudier: [{ id: 'etudier', pres: ['étudie', 'étudies', 'étudie', 'étudions', 'étudiez', 'étudient'], imp: ['étudiais', 'étudiais', 'étudiait', 'étudiions', 'étudiiez', 'étudiaient'], fut: 'étudier', pp: 'étudié', aux: 'avoir' }, 'to study'],
  donner: [{ id: 'donner', pres: ['donne', 'donnes', 'donne', 'donnons', 'donnez', 'donnent'], imp: ['donnais', 'donnais', 'donnait', 'donnions', 'donniez', 'donnaient'], fut: 'donner', pp: 'donné', aux: 'avoir' }, 'to give'],
};
const infinitives: Record<string, string> = { etudier: 'étudier' };
const verbs = Object.entries(tables).map(([name, [table, en]]) => verbOf(table, { id: table.id, fr: infinitives[name] ?? name, en }));
const verb = (id: string) => verbs.find((entry) => entry.id === id)!;

test('il and ils count as heard apart only where the verb sounds different, or ils links to a vowel', () => {
  expect(numberHeard(verb('prendre'), 'pres', false)).toBe(true); // prend / prennent
  expect(numberHeard(verb('finir'), 'pres', false)).toBe(true); // finit / finissent
  expect(numberHeard(verb('prendre'), 'pc', false)).toBe(true); // a pris / ont pris
  expect(numberHeard(verb('prendre'), 'fut', false)).toBe(true); // prendra / prendront
  expect(numberHeard(verb('manger'), 'pres', false)).toBe(false); // mange / mangent
  expect(numberHeard(verb('voir'), 'pres', false)).toBe(false); // voit / voient
  expect(numberHeard(verb('courir'), 'pres', false)).toBe(false); // court / courent
  expect(numberHeard(verb('prendre'), 'imp', false)).toBe(false); // prenait / prenaient
  expect(numberHeard(verb('aimer'), 'pres', true)).toBe(true); // ils‿aiment
  expect(numberHeard(verb('aimer'), 'imp', false)).toBe(false); // ils les aimaient: no liaison onto the verb
});

test('tenses offered must sound different for that person', () => {
  expect(tensesHeardApart(verb('manger'), 0, ['pc', 'pres', 'imp'])).toBe(true);
  expect(tensesHeardApart(verb('etudier'), 3, ['pres', 'imp'])).toBe(false); // étudions / étudiions
  expect(tensesHeardApart(verb('voir'), 4, ['pres', 'imp'])).toBe(false); // voyez / voyiez
  expect(tensesHeardApart(verb('courir'), 0, ['imp', 'fut'])).toBe(false); // courais / courrai
  expect(tensesHeardApart(verb('courir'), 0, ['pres', 'fut'])).toBe(true);
});

const howMany = { kind: 'howmany', fr: 'Ils prennent le train de huit heures.', en: 'They take the eight o’clock train.', question: 'How many people take the train?', choices: ['One', 'More than one'], means: ['one', 'more'], answer: 1, why: 'You hear the n of « prennent »; one person is « il prend ».', verb: 'prendre', tense: 'pres', person: 'ils', form: 'prennent' };

test('an item is kept only when its verb form is conjugate()’s and its answer can be heard', () => {
  const why = 'You hear the n of «\u00a0prennent\u00a0»; one person is «\u00a0il prend\u00a0».';
  expect(checkItem(howMany, verbs)).toEqual({ item: { kind: 'howmany', fr: howMany.fr, en: howMany.en, question: howMany.question, choices: howMany.choices, answer: 1, why, verbId: 'prendre', tense: 'pres', person: 5 } });
  const dropped = (patch: Record<string, unknown>) => 'dropped' in checkItem({ ...howMany, ...patch }, verbs);
  expect(dropped({ fr: 'Ils mangent le pain.', verb: 'manger', form: 'mangent' })).toBe(true); // sounds like il mange
  expect(dropped({ fr: 'Ils prendent le train.', form: 'prendent' })).toBe(true); // not the form conjugate() gives
  expect(dropped({ answer: 0 })).toBe(true); // Claude's answer disagrees with the sentence
  expect(dropped({ fr: 'Les enfants prennent le train.' })).toBe(true); // the subject must be il / ils
  expect(dropped({ verb: 'partir' })).toBe(true); // not one of the learner's verbs
  expect(dropped({ fr: 'Ils aiment le train.', verb: 'aimer', form: 'aiment' })).toBe(false); // ils‿aiment
  expect(dropped({ fr: 'Ils les aiment.', verb: 'aimer', form: 'aiment' })).toBe(true); // the liaison goes to les

  const when = { kind: 'when', fr: 'Elle a fini ses devoirs.', en: 'She has finished her homework.', question: 'When does it happen?', choices: ['It’s already done', 'It’s happening now', 'It’s still to come'], means: ['pc', 'pres', 'fut'], answer: 0, why: '« a fini » is the passé composé.', verb: 'finir', tense: 'pc', person: 'elle', form: 'a fini' };
  expect('item' in checkItem(when, verbs)).toBe(true);
  expect('dropped' in checkItem({ ...when, fr: 'Elle a fini ses devoirs hier.' }, verbs)).toBe(true); // a time word answers it
  expect('dropped' in checkItem({ ...when, fr: 'Elle a finit ses devoirs.' }, verbs)).toBe(true);

  const who = { kind: 'who', cue: 'pronoun', fr: 'Je lui donne mon numéro.', en: 'I give him my number.', question: 'Who gets the number?', choices: ['Him or her', 'Them'], means: ['lui', 'leur'], answer: 0, why: '« lui » is to him or her; to them is « leur ».', verb: 'donner', tense: 'pres', person: 'je', form: 'donne' };
  expect('item' in checkItem(who, verbs)).toBe(true);
  expect('dropped' in checkItem({ ...who, fr: 'Je l’aime.', verb: 'aimer', form: 'aime', means: ['le', 'la'], choices: ['Him', 'Her'] }, verbs)).toBe(true); // l’ hides le or la
  const whose = { ...who, cue: 'possessive', fr: 'Il prend son vélo.', verb: 'prendre', person: 'il', form: 'prend', question: 'Whose bike?', choices: ['His own', 'Theirs'], means: ['son', 'leur'], why: '« son » is one owner; « leur » would be several.' };
  expect('item' in checkItem(whose, verbs)).toBe(true);
  expect('dropped' in checkItem({ ...whose, choices: ['His', 'Hers'], means: ['son', 'sa'] }, verbs)).toBe(true); // son and sa do not say who owns it
});

test('batches follow the shared tense mix and lean on when', () => {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const slots = planSlots(8000, random);
  for (const [tense, share] of Object.entries(TENSE_MIX)) expect(Math.abs(slots.filter((slot) => slot.tense === tense).length / slots.length - share)).toBeLessThan(0.02);
  for (const [kind, share] of Object.entries(KIND_MIX)) expect(Math.abs(slots.filter((slot) => slot.kind === kind).length / slots.length - share)).toBeLessThan(0.02);
});

function fixture(reply: string) {
  const directory = mkdtempSync(join(tmpdir(), 'echo-ear-'));
  directories.push(directory);
  let listened = 0;
  let clock = Date.parse('2026-10-09T10:00:00Z');
  const now = () => new Date(clock += 1000);
  const recorded = new Set<string>();
  const ear = createGrammarEar({
    dbPath: join(directory, 'echo.db'), ask: async () => reply, now,
    knowledge: () => ({ known: [], verbs }),
    clip: (fr) => `fr-${fr.length}`, audio: (clip) => `audio/radio/${clip}.mp3`,
    recorded: (clip) => recorded.has(clip), stuck: () => false, record: async () => {},
    listenAnswersSince: () => listened,
  });
  return { ear, listen: (count: number) => { listened = count; }, recorded };
}

test('a question comes after every two Listen answers once recorded, and a missed one returns once, three questions later', async () => {
  const items = ['Ils prennent le bus.', 'Ils prennent le train.', 'Ils prennent un café.', 'Ils prennent la voiture.', 'Ils prennent du pain.', 'Ils mangent le pain.'].map((fr) => ({ ...howMany, fr, ...(fr.includes('mangent') ? { verb: 'manger', form: 'mangent' } : {}) }));
  const { ear, listen, recorded } = fixture(JSON.stringify({ items }));
  expect(ear.offer()).toBeNull();
  await ear.settled();
  expect(ear.phrases()).toHaveLength(5); // ils mangent was dropped
  listen(2);
  expect(ear.offer()).toBeNull(); // nothing recorded yet
  for (const item of items) recorded.add(`fr-${item.fr.length}`);
  const first = ear.offer()!;
  expect(first.choices).toEqual(['One', 'More than one']);
  expect(first).not.toHaveProperty('answer');
  const missed = ear.answer({ requestId: 'r1', id: first.id, choice: 0 });
  expect(missed).toMatchObject({ right: false, answer: 1, again: true, fr: 'Ils prennent le bus.' });
  expect(ear.answer({ requestId: 'r1', id: first.id, choice: 1 })).toEqual(missed); // kept once per request
  listen(1);
  expect(ear.offer()).toBeNull(); // only one Listen answer since
  const seen = [first.id];
  for (let round = 2; round <= 5; round++) {
    listen(2);
    const next = ear.offer()!;
    seen.push(next.id);
    ear.answer({ requestId: `r${round}`, id: next.id, choice: 1 });
    listen(0);
  }
  // Three answers after the miss, the missed question is back, marked again; after that it is done.
  expect(seen).toEqual([first.id, '2', '3', '4', first.id]);
  listen(2);
  expect(ear.offer()?.id).toBe('5');
});
