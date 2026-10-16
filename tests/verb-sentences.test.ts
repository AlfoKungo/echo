import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mixCounts } from '../lib/practising';
import { createVerbDrills } from '../lib/verb-drills';
import { checkSentence, createVerbSentences, parseSentences, planSlots, type Slot } from '../lib/verb-sentences';
import { verbOf, type Tense, type Verb, type VerbTable } from '../lib/verbs';

const table = (id: string, fr: string, en: string, rest: Omit<VerbTable, 'id'>): Verb => verbOf({ id, ...rest }, { id, fr, en });
const aller = table('v-aller', 'aller', 'to go', { pres: ['vais', 'vas', 'va', 'allons', 'allez', 'vont'], imp: ['allais', 'allais', 'allait', 'allions', 'alliez', 'allaient'], fut: 'ir', pp: 'allé', aux: 'être' });
const etre = table('v-etre', 'être', 'to be', { pres: ['suis', 'es', 'est', 'sommes', 'êtes', 'sont'], imp: ['étais', 'étais', 'était', 'étions', 'étiez', 'étaient'], fut: 'ser', pp: 'été', aux: 'avoir' });
const habituer = table('v-habituer', 's\'habituer', 'to get used to', { pres: ['habitue', 'habitues', 'habitue', 'habituons', 'habituez', 'habituent'], imp: ['habituais', 'habituais', 'habituait', 'habituions', 'habituiez', 'habituaient'], fut: 'habituer', pp: 'habitué', aux: 'être' });
const falloir = table('v-falloir', 'falloir', 'to be necessary', { pres: ['faut'], imp: ['fallait'], fut: 'faudr', pp: 'fallu', aux: 'avoir' });
const parler = table('v-parler', 'parler', 'to speak', { pres: ['parle', 'parles', 'parle', 'parlons', 'parlez', 'parlent'], imp: ['parlais', 'parlais', 'parlait', 'parlions', 'parliez', 'parlaient'], fut: 'parler', pp: 'parlé', aux: 'avoir' });
const regular = (name: string) => table(`v-${name}`, `${name}er`, `to ${name}`, { pres: ['e', 'es', 'e', 'ons', 'ez', 'ent'].map((end) => name + end), imp: ['ais', 'ais', 'ait', 'ions', 'iez', 'aient'].map((end) => name + end), fut: `${name}er`, pp: `${name}é`, aux: 'avoir' });
// Twelve more verbs than a batch needs, so every slot can take a different one.
const many = [aller, etre, habituer, falloir, parler, ...['aim', 'chant', 'dans', 'jou', 'mang', 'port', 'regard', 'trouv', 'pens'].map(regular)];
const byId = new Map(many.map((verb) => [verb.id, verb]));
const FOUR: Tense[] = ['pres', 'pc', 'imp', 'fut'];
const NONE = { cond: 0, pqp: 0, subj: 0, impe: 0 };
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const sentence = (fr: string, answer: string) => ({ fr, answer, en: 'An English sentence.', why: 'A cue: so this tense.' });

describe('the batch plan', () => {
  test('each tense gets its share of a batch, a passé composé third and a futur sixth or so', () => {
    expect(mixCounts(12, FOUR)).toEqual({ pres: 4, pc: 4, imp: 2, fut: 2, ...NONE });
    expect(Object.values(mixCounts(7)).reduce((sum, n) => sum + n, 0)).toBe(7);
    expect(mixCounts(20, FOUR)).toEqual({ pres: 6, pc: 7, imp: 4, fut: 3, ...NONE });
  });

  test('with fewer tenses chosen, the mix keeps to them, their shares scaled up to fill the batch', () => {
    expect(mixCounts(12, ['pres', 'pc'])).toEqual({ pres: 6, pc: 6, imp: 0, fut: 0, ...NONE });
    expect(mixCounts(10, ['imp', 'fut'])).toEqual({ pres: 0, pc: 0, imp: 6, fut: 4, ...NONE });
    expect(mixCounts(8, ['pres'])).toEqual({ pres: 8, pc: 0, imp: 0, fut: 0, ...NONE });
  });

  test('one tense and fewer verbs than the batch: every slot in that tense, verbs again on other persons', () => {
    for (let seed = 1; seed < 30; seed++) {
      const slots = planSlots([aller, parler], new Map(), 12, seeded(seed), ['pres']);
      expect(slots).toHaveLength(12);
      expect(slots.every((slot) => slot.tense === 'pres')).toBe(true);
      expect(new Set(slots.map((slot) => `${slot.verbId}|${slot.person}`)).size).toBe(12);
    }
  });

  test('a batch takes a different verb for every slot, follows the mix, and asks an il-only verb only for il', () => {
    for (let seed = 1; seed < 30; seed++) {
      const slots = planSlots(many, new Map(), 12, seeded(seed), FOUR);
      expect(slots).toHaveLength(12);
      expect(new Set(slots.map((slot) => slot.verbId)).size).toBe(12);
      expect(slots.filter((slot) => slot.tense === 'pc')).toHaveLength(4);
      expect(slots.filter((slot) => slot.tense === 'fut')).toHaveLength(2);
      for (const slot of slots.filter((entry) => entry.verbId === 'v-falloir')) expect(slot.person).toBe(2);
    }
  });

  test('a shaky form is far likelier to be asked for than a solid one, and je more than tu', () => {
    const scores = new Map([['v-parler|pc|0', -6], ['v-parler|pc|2', 6]]);
    let shaky = 0, solid = 0, je = 0, tu = 0;
    for (let seed = 1; seed < 400; seed++) {
      for (const slot of planSlots([parler], scores, 4, seeded(seed), FOUR).filter((entry) => entry.tense === 'pc')) {
        if (slot.person === 0) shaky++;
        if (slot.person === 2) solid++;
      }
      for (const slot of planSlots([aller], new Map(), 4, seeded(seed), FOUR)) { if (slot.person === 0) je++; if (slot.person === 1) tu++; }
    }
    expect(shaky).toBeGreaterThan(solid * 10);
    expect(je).toBeGreaterThan(tu * 2);
  });
});

describe('checking a sentence against the table', () => {
  const pc = (verb: Verb, person: number): Slot => ({ verbId: verb.id, tense: 'pc', person });
  test('keeps a sentence whose blank holds the form after its subject, the être agreement chosen to fit', () => {
    expect(checkSentence(sentence("Hier soir, nous ___ au cinéma.", 'sommes allés'), pc(aller, 3), aller)).toMatchObject({ fr: 'Hier soir, nous ___ au cinéma.', answer: 'sommes allés' });
    expect(checkSentence(sentence('Hier, elle ___ au marché.', 'est allée'), pc(aller, 2), aller)).toMatchObject({ answer: 'est allée' });
    expect(checkSentence(sentence('Le mois dernier, je ___ vite.', 'm’suis habitué'), pc(habituer, 0), habituer)).toBeString();
    expect(checkSentence(sentence('Le mois dernier, je ___ vite.', 'me suis habitué'), pc(habituer, 0), habituer)).toMatchObject({ answer: 'me suis habitué' });
    expect(checkSentence(sentence('Hier, il ___ partir tôt.', 'a fallu'), pc(falloir, 2), falloir)).toMatchObject({ answer: 'a fallu' });
  });

  test('a subjonctif has que before its subject, and an impératif has no subject at all', () => {
    expect(checkSentence(sentence('Il faut que tu ___ plus fort.', 'parles'), { verbId: parler.id, tense: 'subj', person: 1 }, parler)).toMatchObject({ answer: 'parles' });
    expect(checkSentence(sentence('___ plus fort, s’il te plaît.', 'parle'), { verbId: parler.id, tense: 'impe', person: 1 }, parler)).toMatchObject({ answer: 'parle' });
    expect(checkSentence(sentence('Tu ___ plus fort, s’il te plaît.', 'parle'), { verbId: parler.id, tense: 'impe', person: 1 }, parler)).toBe('an impératif takes no subject');
  });

  test.each([
    ['a wrong agreement', 'Hier soir, nous ___ au cinéma.', 'sommes allé', 3],
    ['another tense’s form', 'Hier soir, nous ___ au cinéma.', 'allions', 3],
    ['another person’s subject', 'Hier soir, ils ___ au cinéma.', 'sommes allés', 3],
    ['a noun as subject', 'Hier soir, mes amis ___ au cinéma.', 'sont allés', 5],
    ['a negation before the blank', 'Hier soir, nous ne ___ pas au cinéma.', 'sommes allés', 3],
    ['two blanks', 'Hier soir, nous ___ au cinéma et ___.', 'sommes allés', 3],
    ['no blank', 'Hier soir, nous sommes allés au cinéma.', 'sommes allés', 3],
  ])('drops %s', (_name, fr, answer, person) => {
    expect(checkSentence(sentence(fr, answer), pc(aller, person), aller)).toBeString();
  });

  test('wants j’ exactly before a form starting with a vowel, and the accents right', () => {
    const imp: Slot = { verbId: 'v-etre', tense: 'imp', person: 0 };
    expect(checkSentence(sentence('Quand j’___ petit, je jouais dehors.', 'étais'), imp, etre)).toMatchObject({ answer: 'étais' });
    expect(checkSentence(sentence("Quand J'___ petit, je jouais dehors.", 'étais'), imp, etre)).toMatchObject({ fr: 'Quand J’___ petit, je jouais dehors.' });
    expect(checkSentence(sentence('Quand je ___ petit, je jouais dehors.', 'étais'), imp, etre)).toBeString();
    expect(checkSentence(sentence('Quand j’___ petit, je jouais dehors.', 'etais'), imp, etre)).toBeString();
    expect(checkSentence(sentence('Demain, j’___ au travail.', 'vais'), { verbId: 'v-aller', tense: 'pres', person: 0 }, aller)).toBeString();
  });

  test('a reply keeps the good sentences, names what is wrong with the rest, and ignores unknown slots', () => {
    const slots: Slot[] = [pc(aller, 3), { verbId: 'v-parler', tense: 'fut', person: 4 }];
    const reply = `Here: {"sentences": [{"slot": 1, ${JSON.stringify(sentence('Hier, nous ___ à Paris.', 'sommes allées')).slice(1, -1)}}, {"slot": 2, ${JSON.stringify(sentence('Demain, vous ___ au chef.', 'parlez')).slice(1, -1)}}, {"slot": 9, "fr": "x"}]}`;
    const { items, problems } = parseSentences(reply, slots, byId);
    expect(items.map((item) => item.answer)).toEqual(['sommes allées']);
    expect(problems).toHaveLength(2);
    expect(parseSentences('no json', slots, byId).items).toEqual([]);
  });
});

describe('the stream of sentence cards', () => {
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

  // Claude, as a stub: one right sentence for every slot in the prompt, built from the slot's subject and form.
  const writer = (calls: { count: number; prompts?: string[] }) => async (prompt: string) => {
    calls.count++;
    calls.prompts?.push(prompt);
    const sentences = [...prompt.matchAll(/^(\d+)\. .*?, subject (.+?): the blank is "([^"]+)"/gm)].map(([, slot, who, form]) => {
      const pronoun = who!.split(/,| or /)[0]!;
      return { slot: Number(slot), ...sentence(`Ce matin, ${pronoun === 'j’' ? 'j’___' : `${pronoun} ___`} ici.`, form!) };
    });
    return JSON.stringify({ sentences });
  };
  // Every verb started unless `started` says otherwise; `dbPath` reopens an earlier fixture's database, as a restart.
  function fixture(recorded: Set<string>, calls: { count: number; prompts?: string[] } = { count: 0 }, busy = { runs: 0 }, options: { started?: string[]; dbPath?: string } = {}) {
    if (!options.dbPath) dir = mkdtempSync(join(tmpdir(), 'echo-sentences-'));
    const dbPath = options.dbPath ?? join(dir, 'echo.db');
    const clock = { value: new Date(2026, 9, 9, 10) };
    const started = options.started ?? many.map((verb) => verb.id);
    const drills = createVerbDrills({ dbPath, verbs: () => many, vocabulary: () => started.map((id) => ({ id, status: 'learning', score: 0 })), earAudio: () => null, now: () => clock.value });
    const recordings: string[][] = [];
    const sentences = createVerbSentences({
      dbPath, ask: writer(calls), verbs: () => many, batch: 12, random: seeded(7), now: () => clock.value,
      practising: (line) => drills.practising(line as never),
      knowledge: () => ({ known: [{ fr: 'ici', en: 'here' }], level: 2 }),
      scores: () => drills.formScores(),
      markForm: (input) => drills.mark({ ...input, way: 'sentence' }),
      clipExists: (id) => recorded.has(id), givenUp: () => false,
      record: async (clips) => {
        recordings.push(clips.map((clip) => clip.id));
        if (busy.runs-- > 0) return false;
        for (const clip of clips) recorded.add(clip.id);
        return true;
      },
    });
    return { dbPath, drills, sentences, recordings, calls, clock };
  }

  test('a batch is written and recorded before its cards show, and a new one waits until fewer than ten are unseen', async () => {
    const recorded = new Set<string>();
    const { sentences, recordings, calls } = fixture(recorded);
    const first = sentences.round({});
    expect(first).toMatchObject({ items: [], writing: true });
    await sentences.settled();
    expect(calls.count).toBe(1);
    expect(recordings).toHaveLength(1);
    expect(recordings[0]).toHaveLength(12);
    const round = sentences.round({});
    expect(round.items).toHaveLength(8);
    expect(round.items[0]!.audio).toMatch(/^audio\/radio\/fr-[0-9a-f]{16}\.mp3$/);
    expect(round.items[0]!.fr).toContain('___');
    await sentences.settled();
    expect(calls.count).toBe(1);
  });

  test('a mark counts for the form as a sentence mark, +1 or −2, and a seen sentence waits until the rest are seen', async () => {
    const recorded = new Set<string>();
    const { sentences, drills, dbPath } = fixture(recorded);
    sentences.round({});
    await sentences.settled();
    const all = sentences.round({ exclude: [] }).items;
    const [missed, known] = all;
    sentences.mark({ requestId: 'm1', id: missed!.id, knew: false });
    sentences.mark({ requestId: 'm1', id: missed!.id, knew: false });
    sentences.mark({ requestId: 'm2', id: known!.id, knew: true });
    const db = new Database(dbPath, { readonly: true });
    expect(db.query('SELECT request_id, mode, right FROM verb_answers ORDER BY sequence').all()).toEqual([{ request_id: 'm1', mode: 'sentence', right: 0 }, { request_id: 'm2', mode: 'sentence', right: 1 }]);
    db.close();
    const scores = drills.formScores();
    expect(scores.get(`${missed!.verbId}|${missed!.tense}|${missed!.person}`)).toBe(-2);
    expect(scores.get(`${known!.verbId}|${known!.tense}|${known!.person}`)).toBe(1);
    // With ten left unseen no batch is asked for; the two seen come after every unseen one.
    const next = sentences.round({ exclude: [] }).items.map((item) => item.id);
    expect(next).not.toContain(missed!.id);
    expect(next).not.toContain(known!.id);
    expect(() => sentences.mark({ requestId: 'm3', id: '999', knew: true })).toThrow('That sentence is not in Echo.');
  });

  test('when another recording holds the recorder, the sentences are tried again half a minute later', async () => {
    const recorded = new Set<string>();
    const { sentences, recordings, clock } = fixture(recorded, { count: 0 }, { runs: 1 });
    sentences.round({});
    await sentences.settled();
    expect(sentences.round({})).toMatchObject({ items: [], recording: 12 });
    await sentences.settled();
    expect(recordings).toHaveLength(1);
    clock.value = new Date(clock.value.getTime() + 31_000);
    sentences.round({});
    await sentences.settled();
    expect(recordings).toHaveLength(2);
    expect(sentences.round({}).items).toHaveLength(8);
  });

  test('a sentence waits out of practice until its recording exists', async () => {
    const recorded = new Set<string>();
    const { sentences } = fixture(recorded);
    sentences.round({});
    await sentences.settled();
    const ids = [...recorded];
    recorded.delete(ids[0]!);
    const round = sentences.round({});
    expect(round.items.map((item) => item.audio)).not.toContain(`audio/radio/${ids[0]}.mp3`);
  });

  test('a round shows only sentences on the line sent; another line gets its own batch, and the first comes back', async () => {
    const recorded = new Set<string>();
    const { sentences, calls } = fixture(recorded);
    const verbIds = ['v-aller', 'v-parler', 'v-etre'];
    const presLine = { set: 'chosen', verbIds, tenses: ['pres'] };
    const pcLine = { set: 'chosen', verbIds, tenses: ['pc'] };
    sentences.round({ practising: presLine });
    await sentences.settled();
    const pres = sentences.round({ practising: presLine }).items;
    expect(pres).toHaveLength(8);
    for (const item of pres) { expect(item.tense).toBe('pres'); expect(verbIds).toContain(item.verbId); }
    expect(sentences.round({ practising: pcLine })).toMatchObject({ items: [], writing: true });
    await sentences.settled();
    expect(calls.count).toBe(2);
    const pc = sentences.round({ practising: pcLine }).items;
    expect(pc).toHaveLength(8);
    for (const item of pc) { expect(item.tense).toBe('pc'); expect(verbIds).toContain(item.verbId); }
    const back = sentences.round({ practising: presLine });
    expect(back.items).toHaveLength(8);
    for (const item of back.items) expect(item.tense).toBe('pres');
    expect(back.writing).toBe(false);
  });

  test('the line last sent drives the batch written at start, after a restart too', async () => {
    const recorded = new Set<string>();
    const first = fixture(recorded);
    const line = { set: 'chosen', verbIds: ['v-parler'], tenses: ['fut'] };
    first.sentences.round({ practising: line });
    await first.sentences.settled();
    first.sentences.close();
    const calls = { count: 0, prompts: [] as string[] };
    const again = fixture(recorded, calls, { runs: 0 }, { dbPath: first.dbPath });
    again.sentences.prepare();
    await again.sentences.settled();
    expect(calls.count).toBe(1);
    const slots = calls.prompts[0]!.split('\n').filter((row) => /^\d+\. /.test(row));
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) expect(slot).toStartWith(`${slot.split('.')[0]}. parler (to speak), futur,`);
    for (const item of again.sentences.round({}).items) expect(item).toMatchObject({ verbId: 'v-parler', tense: 'fut' });
  });

  test('“Your verbs” with no verb started says so, before any line has been sent too', () => {
    const { sentences } = fixture(new Set(), { count: 0 }, { runs: 0 }, { started: [] });
    expect(() => sentences.round({ practising: { set: 'mine', verbIds: [], tenses: ['pres'] } })).toThrow('None of your started words is a verb');
    expect(() => sentences.round({})).toThrow('None of your started words is a verb');
  });
});
