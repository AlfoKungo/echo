import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVerbDrills } from '../lib/verb-drills';
import { conjugate, diagnose, earQuestions, groupOf, isRight, paradigm, tenseGuide, verbGuide, verbOf, verbProblems, type VerbTable, type VerbWord } from '../lib/verbs';

const words: Record<string, VerbWord> = {
  parler: { id: 'v-parler', fr: 'parler', en: 'to speak' },
  finir: { id: 'v-finir', fr: 'finir', en: 'to finish' },
  aller: { id: 'v-aller', fr: 'aller', en: 'to go' },
  prendre: { id: 'v-prendre', fr: 'prendre', en: 'to take' },
  manger: { id: 'v-manger', fr: 'manger', en: 'to eat' },
  lever: { id: 'v-lever', fr: 'se lever', en: 'to get up' },
  habituer: { id: 'v-habituer', fr: 's\'habituer', en: 'to get used to' },
  arriver: { id: 'v-arriver', fr: 'arriver', en: 'to arrive' },
  falloir: { id: 'v-falloir', fr: 'falloir', en: 'to be necessary' },
  etre: { id: 'v-etre', fr: 'être', en: 'to be' },
  laisser: { id: 'v-laisser', fr: 'laisser', en: 'to leave' },
  partir: { id: 'v-partir', fr: 'partir', en: 'to leave' },
  connaitre: { id: 'v-connaitre', fr: 'connaître', en: 'to know' },
};
const tables: Record<string, VerbTable> = {
  parler: { id: 'v-parler', pres: ['parle', 'parles', 'parle', 'parlons', 'parlez', 'parlent'], imp: ['parlais', 'parlais', 'parlait', 'parlions', 'parliez', 'parlaient'], fut: 'parler', pp: 'parlé', aux: 'avoir' },
  finir: { id: 'v-finir', pres: ['finis', 'finis', 'finit', 'finissons', 'finissez', 'finissent'], imp: ['finissais', 'finissais', 'finissait', 'finissions', 'finissiez', 'finissaient'], fut: 'finir', pp: 'fini', aux: 'avoir' },
  aller: { id: 'v-aller', pres: ['vais', 'vas', 'va', 'allons', 'allez', 'vont'], imp: ['allais', 'allais', 'allait', 'allions', 'alliez', 'allaient'], fut: 'ir', pp: 'allé', aux: 'être' },
  prendre: { id: 'v-prendre', pres: ['prends', 'prends', 'prend', 'prenons', 'prenez', 'prennent'], imp: ['prenais', 'prenais', 'prenait', 'prenions', 'preniez', 'prenaient'], fut: 'prendr', pp: 'pris', aux: 'avoir' },
  manger: { id: 'v-manger', pres: ['mange', 'manges', 'mange', 'mangeons', 'mangez', 'mangent'], imp: ['mangeais', 'mangeais', 'mangeait', 'mangions', 'mangiez', 'mangeaient'], fut: 'manger', pp: 'mangé', aux: 'avoir' },
  lever: { id: 'v-lever', pres: ['lève', 'lèves', 'lève', 'levons', 'levez', 'lèvent'], imp: ['levais', 'levais', 'levait', 'levions', 'leviez', 'levaient'], fut: 'lèver', pp: 'levé', aux: 'être' },
  habituer: { id: 'v-habituer', pres: ['habitue', 'habitues', 'habitue', 'habituons', 'habituez', 'habituent'], imp: ['habituais', 'habituais', 'habituait', 'habituions', 'habituiez', 'habituaient'], fut: 'habituer', pp: 'habitué', aux: 'être' },
  arriver: { id: 'v-arriver', pres: ['arrive', 'arrives', 'arrive', 'arrivons', 'arrivez', 'arrivent'], imp: ['arrivais', 'arrivais', 'arrivait', 'arrivions', 'arriviez', 'arrivaient'], fut: 'arriver', pp: 'arrivé', aux: 'être' },
  falloir: { id: 'v-falloir', pres: ['faut'], imp: ['fallait'], fut: 'faudr', pp: 'fallu', aux: 'avoir' },
  partir: { id: 'v-partir', pres: ['pars', 'pars', 'part', 'partons', 'partez', 'partent'], imp: ['partais', 'partais', 'partait', 'partions', 'partiez', 'partaient'], fut: 'partir', pp: 'parti', aux: 'être' },
  laisser: { id: 'v-laisser', pres: ['laisse', 'laisses', 'laisse', 'laissons', 'laissez', 'laissent'], imp: ['laissais', 'laissais', 'laissait', 'laissions', 'laissiez', 'laissaient'], fut: 'laisser', pp: 'laissé', aux: 'avoir' },
  connaitre: { id: 'v-connaitre', pres: ['connais', 'connais', 'connaît', 'connaissons', 'connaissez', 'connaissent'], imp: ['connaissais', 'connaissais', 'connaissait', 'connaissions', 'connaissiez', 'connaissaient'], fut: 'connaîtr', pp: 'connu', aux: 'avoir' },
  etre: { id: 'v-etre', pres: ['suis', 'es', 'est', 'sommes', 'êtes', 'sont'], imp: ['étais', 'étais', 'était', 'étions', 'étiez', 'étaient'], fut: 'ser', pp: 'été', aux: 'avoir' },
};
const verb = (name: string) => verbOf(tables[name]!, words[name]!);

describe('verb tables', () => {
  test('correct tables pass the checks, including stem changes, soft g, -issons that is not finir, reflexive and impersonal verbs', () => {
    for (const name of Object.keys(tables)) expect(verbProblems(tables[name]!, words[name]!)).toEqual([]);
  });

  test.each([
    ['an -er ils form in -ont', 'parler', { pres: ['parle', 'parles', 'parle', 'parlons', 'parlez', 'parlont'] }],
    ['a finir verb missing its double s', 'finir', { pres: ['finis', 'finis', 'finit', 'finissons', 'finissez', 'finisent'] }],
    ['an imparfait that keeps the e before i', 'manger', { imp: ['mangeais', 'mangeais', 'mangeait', 'mangeions', 'mangeiez', 'mangeaient'] }],
    ['a form written with its subject', 'parler', { pres: ['je parle', 'parles', 'parle', 'parlons', 'parlez', 'parlent'] }],
    ['a reflexive verb with avoir', 'lever', { aux: 'avoir' as const }],
    ['an imparfait not built on the nous form', 'prendre', { imp: ['prendais', 'prendais', 'prendait', 'prendions', 'prendiez', 'prendaient'] }],
    ['a futur stem without r', 'aller', { fut: 'i' }],
  ])('rejects %s', (_name, verbName, change) => {
    expect(verbProblems({ ...tables[verbName]!, ...change }, words[verbName]!).length).toBeGreaterThan(0);
  });
});

describe('conjugation and answers', () => {
  test('reflexive pronouns elide before a vowel, être participles agree, and the subject is optional', () => {
    expect(conjugate(verb('habituer'), 'pres')[0]!.shown).toBe('m’habitue');
    expect(conjugate(verb('lever'), 'pres')[3]!.shown).toBe('nous levons');
    expect(conjugate(verb('lever'), 'pc')[0]).toEqual({ shown: 'me suis levé(e)', accepted: ['me suis levé', 'me suis levée'] });
    expect(conjugate(verb('aller'), 'pc')[5]!.accepted).toEqual(['sont allés', 'sont allées']);
    expect(conjugate(verb('prendre'), 'pc')[5]!.accepted).toEqual(['ont pris']);
    expect(conjugate(verb('falloir'), 'fut').map((form) => form?.shown ?? null)).toEqual([null, null, 'faudra', null, null, null]);
    const levons = conjugate(verb('lever'), 'pres')[3]!;
    expect(isRight(levons, 'nous nous levons')).toBe(true);
    expect(isRight(levons, 'Nous levons.')).toBe(true);
    expect(isRight(levons, 'levons')).toBe(false);
    expect(isRight(conjugate(verb('aller'), 'fut')[0]!, 'j\'irai')).toBe(true);
    expect(isRight(conjugate(verb('aller'), 'pc')[2]!, 'elle est allée')).toBe(true);
  });

  test.each([
    ['another person', 'parler', 'pres', 0, 'parles', 'That’s the tu form.'],
    ['another tense', 'prendre', 'imp', 3, 'prenons', 'That’s the présent.'],
    ['a missing accent', 'parler', 'pc', 0, 'ai parle', 'The letters are right, but the accent matters here.'],
    ['a letter not doubled', 'prendre', 'pres', 5, 'prenent', 'The n doubles here: prennent.'],
    ['the wrong helper', 'aller', 'pc', 0, 'j’ai allé', 'aller goes with être in the passé composé, not avoir.'],
    ['a plural participle for one person', 'aller', 'pc', 0, 'je suis allés', 'One person: no -s on the participle.'],
    ['a soft g lost', 'manger', 'imp', 0, 'mangais', 'Keep the e after the g before a or o: mangeais.'],
    ['a reflexive pronoun left out', 'lever', 'pres', 0, 'lève', 'se lever is reflexive: its pronoun comes before the verb (je me lève).'],
    ['an -er verb in -ont', 'arriver', 'pres', 5, 'arrivont', 'Only a few verbs end in -ont (sont, ont, vont, font); -er verbs take -ent.'],
  ] as const)('names %s', (_name, verbName, tense, person, given, why) => {
    expect(diagnose(verb(verbName), tense, person, given)).toBe(why);
  });

  test('the table lights each ending, and in the passé composé the helper', () => {
    expect(paradigm(verb('finir'), 'pres')[3]!.parts).toEqual([{ text: 'nous fini' }, { text: 'ssons', lit: true }]);
    expect(paradigm(verb('parler'), 'pc')[0]!.parts).toEqual([{ text: 'j’' }, { text: 'ai', lit: true }, { text: ' parlé' }]);
    expect(paradigm(verb('lever'), 'pc')[1]!.parts).toEqual([{ text: 'tu t’' }, { text: 'es', lit: true }, { text: ' levé(e)' }]);
  });

  test('By ear knows which il and ils forms sound alike', () => {
    const number = (name: string, tense: string, person: number) => earQuestions(verb(name)).find((question) => question.kind === 'number' && question.tense === tense && question.person === person)!;
    expect(number('parler', 'pres', 5).answer).toBe(2);
    expect(number('parler', 'imp', 2).answer).toBe(2);
    expect(number('finir', 'pres', 2).answer).toBe(0);
    expect(number('prendre', 'pres', 5).answer).toBe(1);
    // After ils the s links to a vowel: ils arrivent is heard as more than one.
    expect(number('arriver', 'pres', 5).answer).toBe(1);
    const tense = earQuestions(verb('aller')).find((question) => question.kind === 'tense' && question.tense === 'fut' && question.person === 3)!;
    expect(tense.said).toBe('nous irons');
    expect(tense.choices[tense.answer]).toBe('futur');
    expect(earQuestions(verb('falloir')).every((question) => question.kind === 'tense' && question.person === 2)).toBe(true);
  });
});

describe('guides', () => {
  test.each([
    ['pres', { parler: 'er', lever: 'er-change', finir: 'finir', prendre: 'prendre', partir: 'partir', aller: 'irregular', falloir: 'only-il', laisser: 'er' }],
    ['pc', { aller: 'etre', partir: 'etre', lever: 'reflexive', prendre: 'participle', parler: 'regular', finir: 'regular', etre: 'participle' }],
    ['imp', { etre: 'etre', manger: 'soft', prendre: 'from-nous', aller: 'from-nous', parler: 'regular', connaitre: 'from-nous' }],
    ['fut', { aller: 'stem', etre: 'stem', lever: 'er-change', parler: 'regular', prendre: 'regular' }],
  ] as const)('each verb falls in the group that says what is regular about it in the %s', (tense, expected) => {
    for (const [name, group] of Object.entries(expected)) expect([name, groupOf(verb(name), tense)]).toEqual([name, group]);
  });

  test('a tense guide shows model tables and lists every verb once, in its group', () => {
    const all = Object.keys(tables).map(verb);
    const guide = tenseGuide(all, 'fut');
    expect(guide.models.map((model) => model.inf)).toEqual(['parler', 'prendre', 'être']);
    expect(guide.groups.flatMap((group) => group.verbs).length).toBe(all.length);
    expect(guide.groups.find((group) => group.id === 'stem')!.verbs.find((entry) => entry.inf === 'aller')!.detail).toBe('j’irai');
    const page = verbGuide(verb('aller'));
    expect(page.tenses.map((entry) => entry.group)).toEqual(['Irregular', 'Take être', 'Irregular in the présent, regular here', 'Irregular stems']);
  });
});

describe('verb drills', () => {
  const directories: string[] = [];
  const closers: (() => void)[] = [];
  afterEach(() => { for (const close of closers.splice(0)) close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
  const clock = { value: new Date(2026, 8, 21, 10) };
  function fixture(recorded: (said: string) => boolean = () => true) {
    const directory = mkdtempSync(join(tmpdir(), 'echo-verbs-'));
    directories.push(directory);
    let seed = 7;
    const drills = createVerbDrills({
      dbPath: join(directory, 'echo.db'),
      verbs: () => Object.keys(tables).map(verb),
      vocabulary: () => [{ id: 'v-parler', status: 'learning', score: -2 }, { id: 'v-prendre', status: 'scheduled', score: 3 }, { id: 'v-finir', status: 'new', score: 0 }],
      earAudio: (said) => recorded(said) ? `audio/radio/${encodeURIComponent(said)}.mp3` : null,
      random: () => ((seed = (seed * 16807) % 2147483647) / 2147483647),
      now: () => new Date(clock.value),
    });
    closers.push(drills.close);
    return drills;
  }
  const state = (drills: ReturnType<typeof fixture>, verbId: string, tense: 'pres', person: number) => drills.summary().verbs.find((row) => row.id === verbId)!.states[tense][person];

  test('a form goes from untried to getting there to solid, and a miss makes it shaky; a request counts once', () => {
    const drills = fixture();
    expect(state(drills, 'v-parler', 'pres', 5)).toBe('new');
    expect(drills.answer({ requestId: 'a', verbId: 'v-parler', tense: 'pres', person: 5, given: 'ils parlent' }).right).toBe(true);
    expect(state(drills, 'v-parler', 'pres', 5)).toBe('getting');
    drills.answer({ requestId: 'b', verbId: 'v-parler', tense: 'pres', person: 5, given: 'parlent' });
    expect(state(drills, 'v-parler', 'pres', 5)).toBe('solid');
    const missed = drills.answer({ requestId: 'c', verbId: 'v-parler', tense: 'pres', person: 5, given: 'parlont' });
    expect(missed).toMatchObject({ right: false, expected: 'ils parlent' });
    drills.answer({ requestId: 'c', verbId: 'v-parler', tense: 'pres', person: 5, given: 'parlent' });
    expect(state(drills, 'v-parler', 'pres', 5)).toBe('shaky');
    expect(drills.summary().worst).toEqual([expect.objectContaining({ form: 'ils parlent', misses: 1, shaky: true })]);
    drills.answer({ requestId: 'd', verbId: 'v-parler', tense: 'pres', person: 5, given: 'parlons' });
    expect(drills.summary().worst[0]).toMatchObject({ verbId: 'v-parler', form: 'ils parlent', misses: 2 });
  });

  test('a round takes your started verbs, puts shaky forms first, and spreads over verbs', () => {
    const drills = fixture();
    drills.answer({ requestId: 'm', verbId: 'v-prendre', tense: 'pres', person: 5, given: 'prenent' });
    const items = drills.round({ set: 'mine', tenses: ['pres', 'pc'] });
    expect(new Set(items.map((item) => item.verbId))).toEqual(new Set(['v-parler', 'v-prendre']));
    expect(items.some((item) => item.verbId === 'v-prendre' && item.tense === 'pres' && item.person === 5)).toBe(true);
    const common = drills.round({ set: 'common', tenses: ['imp'] });
    expect(common.length).toBeGreaterThan(10);
    for (const id of new Set(common.map((item) => item.verbId))) expect(common.filter((item) => item.verbId === id).length).toBeLessThanOrEqual(3);
    // One verb alone fills the round with its forms.
    expect(drills.round({ set: 'chosen', verbIds: ['v-aller'], tenses: ['pres', 'fut'] }).length).toBe(12);
    expect(() => drills.round({ set: 'mine', tenses: [] })).toThrow('Choose at least one tense.');
  });

  test('a card carries its answer, and a mark counts for the form like a typed answer', () => {
    const drills = fixture();
    const [card] = drills.cards({ set: 'chosen', verbIds: ['v-aller'], tenses: ['fut'] });
    expect(card!.answer).toBe(`${['j’', 'tu ', 'il ', 'nous ', 'vous ', 'ils '][card!.person]}${['irai', 'iras', 'ira', 'irons', 'irez', 'iront'][card!.person]}`);
    drills.mark({ requestId: 'k1', verbId: 'v-aller', tense: 'fut', person: card!.person, knew: false });
    drills.mark({ requestId: 'k1', verbId: 'v-aller', tense: 'fut', person: card!.person, knew: true });
    expect(drills.summary().verbs.find((row) => row.id === 'v-aller')!.states.fut[card!.person]).toBe('shaky');
    drills.mark({ requestId: 'k2', verbId: 'v-aller', tense: 'fut', person: card!.person, knew: true });
    expect(drills.summary().verbs.find((row) => row.id === 'v-aller')!.states.fut[card!.person]).toBe('getting');
    expect(() => drills.mark({ requestId: 'k3', verbId: 'v-aller', tense: 'fut', person: 0, knew: 'yes' as never })).toThrow('Say whether you knew it.');
  });

  test('statistics rebuild the forms of each day, carry quiet days over, and split the last two weeks by tense, person and kind', () => {
    const drills = fixture();
    const mark = (id: string, person: number, knew: boolean, tense: 'pres' | 'fut' = 'pres') => drills.mark({ requestId: `${id}`, verbId: 'v-parler', tense, person, knew });
    clock.value = new Date(2026, 8, 21, 10);
    mark('a', 0, true); mark('b', 0, true); mark('c', 3, false);
    // Before 04:00 still counts for the 21st.
    clock.value = new Date(2026, 8, 22, 3, 30);
    mark('d', 5, true);
    clock.value = new Date(2026, 8, 23, 10);
    mark('e', 3, true); mark('f', 0, false, 'fut');
    clock.value = new Date(2026, 8, 24, 10);
    const stats = drills.statistics();
    expect(stats.history).toEqual([
      { day: '2026-09-21', solid: 1, getting: 1, shaky: 1 },
      { day: '2026-09-22', solid: 1, getting: 1, shaky: 1 },
      { day: '2026-09-23', solid: 1, getting: 2, shaky: 1 },
      { day: '2026-09-24', solid: 1, getting: 2, shaky: 1 },
    ]);
    expect(stats.forms).toMatchObject({ solid: 1, getting: 2, shaky: 1, practised: 4 });
    expect(stats.tenses.pres).toEqual({ right: 4, total: 5 });
    expect(stats.tenses.fut).toEqual({ right: 0, total: 1 });
    expect(stats.people[3]).toEqual({ right: 1, total: 2 });
    expect(stats.kinds.find((kind) => kind.tense === 'pres')).toMatchObject({ group: 'er', title: 'Regular -er', right: 4, total: 5 });
    clock.value = new Date(2026, 9, 20, 10);
    expect(drills.statistics().tenses.pres).toEqual({ right: 0, total: 0 });
  });

  test('a whole table checks every person and names the mistakes', () => {
    const drills = fixture();
    const checked = drills.table({ requestId: 't', verbId: 'v-prendre', tense: 'pres', answers: ['prends', 'prend', 'prend', 'prenons', 'prenez', 'prenent'] });
    expect(checked.right).toBe(4);
    expect(checked.cells[1]).toMatchObject({ right: false, expected: 'tu prends', why: 'That’s the il / elle form.' });
    expect(checked.cells[5]).toMatchObject({ right: false, why: 'The n doubles here: prennent.' });
    expect(state(drills, 'v-prendre', 'pres', 1)).toBe('shaky');
    const falloir = drills.table({ requestId: 'f', verbId: 'v-falloir', tense: 'fut', answers: ['', '', 'il faudra', '', '', ''] });
    expect([falloir.right, falloir.total, falloir.cells[0]]).toEqual([1, 1, null]);
  });

  test('By ear asks only about recorded phrases and checks the choice', () => {
    const drills = fixture((said) => said.startsWith('nous'));
    const round = drills.earRound({ set: 'common', tenses: ['pres', 'imp', 'fut', 'pc'] });
    expect(round.length).toBeGreaterThan(0);
    expect(round.every((item) => decodeURIComponent(item.audio).includes('radio/nous'))).toBe(true);
    const item = round[0]!;
    const result = drills.earAnswer({ requestId: 'e', id: item.id, choice: 0 });
    expect(result.said.startsWith('nous')).toBe(true);
    expect(result.right).toBe(result.answer === 0);
    expect(() => fixture(() => false).earRound({ set: 'common', tenses: ['pres'] })).toThrow('still being recorded');
  });
});
