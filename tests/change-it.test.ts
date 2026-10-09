import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDrill, createChangeIt, layChangeTape, planSlots, sayPause, type ChangeDrill, type ChangeSlot } from '../lib/change-it';
import { mixCounts, type PractisingLine } from '../lib/practising';
import { conjugate, PERSON_LABELS, TENSE_NAMES, TENSES, verbOf, type Tense, type VerbTable, type VerbWord } from '../lib/verbs';
import { FRAME_BYTES, FRAME_SECONDS } from '../lib/walkman';

const table = (id: string, pres: string[], imp: string[], fut: string, pp: string, aux: 'avoir' | 'être'): VerbTable => ({ id, pres, imp, fut, pp, aux });
const word = (id: string, fr: string, en: string): VerbWord => ({ id, fr, en });
const manger = verbOf(table('v-manger', ['mange', 'manges', 'mange', 'mangeons', 'mangez', 'mangent'], ['mangeais', 'mangeais', 'mangeait', 'mangions', 'mangiez', 'mangeaient'], 'manger', 'mangé', 'avoir'), word('v-manger', 'manger', 'to eat'));
const aller = verbOf(table('v-aller', ['vais', 'vas', 'va', 'allons', 'allez', 'vont'], ['allais', 'allais', 'allait', 'allions', 'alliez', 'allaient'], 'ir', 'allé', 'être'), word('v-aller', 'aller', 'to go'));
const partir = verbOf(table('v-partir', ['pars', 'pars', 'part', 'partons', 'partez', 'partent'], ['partais', 'partais', 'partait', 'partions', 'partiez', 'partaient'], 'partir', 'parti', 'être'), word('v-partir', 'partir', 'to leave'));
const lever = verbOf(table('v-lever', ['lève', 'lèves', 'lève', 'levons', 'levez', 'lèvent'], ['levais', 'levais', 'levait', 'levions', 'leviez', 'levaient'], 'lèver', 'levé', 'être'), word('v-lever', 'se lever', 'to get up'));
const prendre = verbOf(table('v-prendre', ['prends', 'prends', 'prend', 'prenons', 'prenez', 'prennent'], ['prenais', 'prenais', 'prenait', 'prenions', 'preniez', 'prenaient'], 'prendr', 'pris', 'avoir'), word('v-prendre', 'prendre', 'to take'));
const falloir = verbOf(table('v-falloir', ['faut'], ['fallait'], 'faudr', 'fallu', 'avoir'), word('v-falloir', 'falloir', 'to be necessary'));
const verbs = [manger, aller, partir, lever, prendre, falloir];
// A fixed sequence standing in for Math.random, so a plan can be checked exactly.
const sequence = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

describe('the tense mix', () => {
  test('a batch splits by the shares, passé composé most', () => {
    expect(mixCounts(8)).toEqual({ pc: 3, pres: 2, imp: 2, fut: 1 });
    expect(mixCounts(20)).toEqual({ pc: 7, pres: 6, imp: 4, fut: 3 });
  });
  test('slots follow the mix, each verb once, and person changes keep within their tense', () => {
    for (let seed = 1; seed < 40; seed++) {
      const slots = planSlots(5, verbs, [], new Set(), sequence(seed));
      expect(slots.map((slot) => slot.tense as string).sort()).toEqual(['fut', 'imp', 'pc', 'pc', 'pres'].sort());
      expect(new Set(slots.map((slot) => slot.verbId)).size).toBe(slots.length);
      for (const slot of slots) {
        if (slot.kind === 'person') {
          expect(slot.baseTense).toBe(slot.tense);
          expect(slot.basePerson).not.toBe(slot.person);
          expect(slot.verbId).not.toBe('v-falloir');
          expect([['je'], ['tu'], ['il', 'elle'], ['nous'], ['vous'], ['ils', 'elles']][slot.person]).toContain(slot.cue!);
        } else {
          expect(slot.basePerson).toBe(slot.person);
          expect(slot.baseTense).toBe(slot.tense === 'pres' ? 'pc' : 'pres');
        }
      }
    }
  });
  test('with one tense chosen, every drill changes only the person, in that tense', () => {
    for (const tense of TENSES) for (let seed = 1; seed < 20; seed++) {
      const slots = planSlots(8, verbs, [], new Set(), sequence(seed), [tense]);
      expect(slots.length).toBeGreaterThan(0);
      for (const slot of slots) expect(slot).toMatchObject({ kind: 'person', tense, baseTense: tense });
    }
  });
  test('time cues move a sentence between the chosen tenses only, and a verb comes back on another person', () => {
    let times = 0;
    for (let seed = 1; seed < 40; seed++) {
      const slots = planSlots(8, [manger, partir], [], new Set(), sequence(seed), ['imp', 'fut']);
      expect(slots).toHaveLength(8);
      expect(new Set(slots.map((slot) => `${slot.verbId}|${slot.tense}|${slot.person}`)).size).toBe(8);
      for (const slot of slots) {
        expect(['imp', 'fut']).toContain(slot.tense);
        expect(['imp', 'fut']).toContain(slot.baseTense);
        if (slot.kind === 'time') { times++; expect(slot.baseTense).not.toBe(slot.tense); }
      }
    }
    expect(times).toBeGreaterThan(0);
  });
  test('a shaky form of the slot’s tense is drawn when the coin says so', () => {
    const slots = planSlots(1, verbs, [{ verbId: 'v-prendre', tense: 'pc', person: 5, score: -4 }], new Set(), () => 0);
    expect(slots[0]).toMatchObject({ verbId: 'v-prendre', tense: 'pc', person: 5 });
  });
});

describe('checking a drill', () => {
  const time = (tense: ChangeSlot['tense'], verb: string, person: number): ChangeSlot => ({ verbId: verb, kind: 'time', tense, person, baseTense: tense === 'pres' ? 'pc' : 'pres', basePerson: person });
  test('a right time drill is kept with its cue as listed', () => {
    const drill = checkDrill(time('pc', 'v-manger', 0), manger, { base: 'Je mange une pomme.', baseForm: 'mange', cue: 'hier', answer: "Hier, j'ai mangé une pomme.", form: 'ai mangé', en: 'Yesterday I ate an apple.' });
    expect(drill).toMatchObject({ cue: 'Hier', answer: 'Hier, j’ai mangé une pomme.', verbId: 'v-manger', tense: 'pc', person: 0 });
  });
  test('the passé composé needs the right helper and agreement', () => {
    const slot = time('pc', 'v-aller', 2);
    const drill = (answer: string, form: string) => checkDrill(slot, aller, { base: 'Elle va au marché.', baseForm: 'va', cue: 'Hier', answer, form, en: 'Yesterday she went to the market.' });
    expect(drill('Hier, elle est allée au marché.', 'est allée')).not.toBeNull();
    expect(drill('Hier, elle a allé au marché.', 'a allé')).toBeNull();
    expect(drill('Hier, elle est allés au marché.', 'est allés')).toBeNull();
    expect(checkDrill(time('pc', 'v-manger', 2), manger, { base: 'Il mange.', baseForm: 'mange', cue: 'Hier', answer: 'Hier, il a mangée.', form: 'a mangée', en: 'Yesterday he ate.' })).toBeNull();
  });
  test('a form must be in the sentence, after a subject of its person', () => {
    const slot = time('fut', 'v-prendre', 3);
    const drill = (base: string, answer: string, form: string) => checkDrill(slot, prendre, { base, baseForm: 'prenons', cue: 'Demain', answer, form, en: 'Tomorrow we will take the bus.' });
    expect(drill('Nous prenons le bus.', 'Demain, nous prendrons le bus.', 'prendrons')).not.toBeNull();
    expect(drill('Nous prenons le bus.', 'Demain, nous prendrons le bus.', 'prendront')).toBeNull();
    expect(drill('Nous prenons le bus.', 'Demain, ils prendrons le bus.', 'prendrons')).toBeNull();
    expect(drill('Nous prenons le bus.', 'Demain, nous prendrez le bus.', 'prendrons')).toBeNull();
    expect(drill('Vous prenons le bus.', 'Demain, nous prendrons le bus.', 'prendrons')).toBeNull();
  });
  test('the cue must be one listed for the tense, and lead the answer', () => {
    const base = { base: 'Je pars tôt.', baseForm: 'pars', form: 'partais', en: 'When I was little, I left early.' };
    expect(checkDrill(time('imp', 'v-partir', 0), partir, { ...base, cue: 'Quand j’étais petit', answer: 'Quand j’étais petit, je ne partais pas tôt.' })).not.toBeNull();
    expect(checkDrill(time('imp', 'v-partir', 0), partir, { ...base, cue: 'Hier', answer: 'Hier, je partais tôt.' })).toBeNull();
    expect(checkDrill(time('imp', 'v-partir', 0), partir, { ...base, cue: 'Avant', answer: 'Je partais tôt avant.' })).toBeNull();
  });
  test('a person change needs the cue as the new subject', () => {
    const slot: ChangeSlot = { verbId: 'v-lever', kind: 'person', tense: 'pres', person: 3, baseTense: 'pres', basePerson: 0, cue: 'nous' };
    const drill = (answer: string, form: string, cue = 'nous') => checkDrill(slot, lever, { base: 'Je me lève tôt.', baseForm: 'me lève', cue, answer, form, en: 'We get up early.' });
    expect(drill('Nous nous levons tôt.', 'nous levons')).toMatchObject({ cue: 'nous', kind: 'person' });
    expect(drill('Nous levons tôt.', 'levons')).toBeNull();
    expect(drill('Nous nous levons tôt.', 'nous levons', 'vous')).toBeNull();
    expect(drill('Je me lève tôt.', 'me lève')).toBeNull();
  });
});

describe('the Change it tape', () => {
  const frames = (seconds: number) => new Uint8Array(Math.round(seconds / FRAME_SECONDS) * FRAME_BYTES);
  const drill: ChangeDrill = { id: 1, base: 'Je mange.', cue: 'Hier', answer: 'Hier, j’ai mangé.', en: 'Yesterday I ate.', form: 'ai mangé', verbId: 'v-manger', tense: 'pc', person: 0, kind: 'time', heard: 0 };
  test('the pause to say it scales with the answer, between 3 and 5 seconds', () => {
    expect(sayPause(frames(1))).toBe(3);
    expect(sayPause(frames(3))).toBeCloseTo(4, 1);
    expect(sayPause(frames(7))).toBe(5);
  });
  test('each drill plays sentence, cue, a pause sized to the answer, then the answer', () => {
    const tape = layChangeTape('t', [{ drill, base: frames(1.5), cue: frames(0.6), answer: frames(2.4), audio: 'a.mp3' }, { drill: { ...drill, id: 2 }, base: frames(1), cue: frames(0.5), answer: frames(1), audio: 'b.mp3' }], frames(0.024));
    const [first, second] = tape.words;
    expect(tape.kind).toBe('change');
    expect(first!.recallAt - first!.start).toBeCloseTo(2, 1);
    expect(first!.meaningAt - first!.recallAt).toBeCloseTo(0.6, 1);
    expect(first!.againAt - first!.meaningAt).toBeCloseTo(3.4, 1);
    expect(first!.end - first!.againAt).toBeCloseTo(2.4, 1);
    expect(second!.againAt - second!.meaningAt).toBeCloseTo(3, 1);
    expect(first!).toMatchObject({ id: 'change-1', fr: 'Hier, j’ai mangé.', verb: { verbId: 'v-manger', tense: 'pc', person: 0, audio: 'a.mp3' }, change: { id: 1, base: 'Je mange.', cue: 'Hier' } });
    expect(tape.bytes.length).toBe(Math.round(tape.seconds / FRAME_SECONDS) * FRAME_BYTES);
  });
});

describe('the drill store', () => {
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  test('drills are written, checked, recorded, and played unheard first', async () => {
    dir = mkdtempSync(join(tmpdir(), 'echo-change-'));
    const made = new Set<string>();
    const recorded: string[][] = [];
    let asked = '';
    const changeIt = createChangeIt({
      dbPath: join(dir, 'echo.db'), verbs: () => [manger], practising: () => ({ verbs: [manger], tenses: [...TENSES] }), known: () => [{ fr: 'pomme', en: 'apple' }], shaky: () => [],
      clipReady: (text) => made.has(text),
      record: async (texts) => { recorded.push(texts); for (const text of texts) made.add(text); return true; },
      // With random() at 0.99 the plan keeps the mix's order and draws ils: line 1 is manger, ils, présent → passé composé.
      ask: async (prompt) => { asked = prompt; return JSON.stringify({ drills: [
        { line: 1, base: 'Ils mangent une pomme.', baseForm: 'mangent', cue: 'Hier', answer: 'Hier, ils ont mangé une pomme.', form: 'ont mangé', en: 'Yesterday they ate an apple.' },
        { line: 2, base: 'Ils mangent une pomme.', baseForm: 'mangent', cue: 'Hier', answer: 'Hier, ils ont mangés une pomme.', form: 'ont mangés', en: 'Wrong agreement.' },
      ] }); },
      random: () => 0.99,
    });
    await changeIt.check();
    expect(asked).toContain('1. manger (to eat) — base: présent, ils / elles; answer: passé composé, ils / elles');
    expect(recorded).toEqual([['Ils mangent une pomme.', 'Hier', 'Hier, ils ont mangé une pomme.']]);
    const [only, ...rest] = changeIt.playlist();
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ answer: 'Hier, ils ont mangé une pomme.', tense: 'pc', person: 5, heard: 0 });
    changeIt.heard({ requestId: 'r1', id: only!.id });
    changeIt.heard({ requestId: 'r1', id: only!.id });
    expect(changeIt.playlist()[0]!.heard).toBe(1);
    changeIt.close();
  });

  // The Practising line as verbs.practising reads a chosen set, over this file's verbs.
  const practising = (line: PractisingLine) => {
    const picked = verbs.filter((verb) => line.verbIds.includes(verb.id));
    if (!picked.length) throw new Error('Choose at least one verb.');
    return { verbs: picked, tenses: TENSES.filter((tense) => line.tenses.includes(tense)) };
  };
  // Claude, as a stub: a right drill for every line of the prompt, built from conjugate().
  const SUBJECTS = ['je', 'tu', 'il', 'nous', 'vous', 'ils'];
  const named = (name: string) => TENSES.find((tense) => TENSE_NAMES[tense] === name)!;
  const writer = (asked: string[]) => async (prompt: string) => {
    asked.push(prompt);
    const drills = [...prompt.matchAll(/^(\d+)\. (\S+) \(.*?\) — base: (.+?), (.+?); answer: (.+?), (.+?); cue(?: "(.+?)"|: one of "(.+?)")/gm)].map(([, line, inf, baseTense, basePerson, tense, person, subjectCue, timeCue]) => {
      const verb = verbs.find((entry) => entry.inf === inf)!;
      const from = PERSON_LABELS.indexOf(basePerson!), to = PERSON_LABELS.indexOf(person!);
      const baseForm = conjugate(verb, named(baseTense!))[from]!.accepted[0]!, form = conjugate(verb, named(tense!))[to]!.accepted[0]!;
      const answer = timeCue ? `${timeCue}, ${SUBJECTS[to]} ${form} vite.` : `${subjectCue} ${form} vite.`;
      return { line: Number(line), base: `${SUBJECTS[from]} ${baseForm} vite.`, baseForm, cue: timeCue ?? subjectCue, answer, form, en: 'English.' };
    });
    return JSON.stringify({ drills });
  };
  const store = (dbPath: string, asked: string[], random = sequence(5)) => createChangeIt({
    dbPath, verbs: () => verbs, practising, known: () => [{ fr: 'vite', en: 'quickly' }], shaky: () => [],
    clipReady: () => true, record: async () => true, ask: writer(asked), random,
  });
  const line = (tenses: Tense[]): PractisingLine => ({ set: 'chosen', verbIds: ['v-manger', 'v-partir'], tenses });

  test('the tape plays only drills on the line, both tenses on it; a line widened to a tense gets a batch', async () => {
    dir = mkdtempSync(join(tmpdir(), 'echo-change-'));
    const asked: string[] = [];
    const changeIt = store(join(dir, 'echo.db'), asked);
    changeIt.choose(line(['pres']));
    await changeIt.check();
    const present = changeIt.playlist();
    expect(present.length).toBeGreaterThan(3);
    for (const drill of present) expect(drill).toMatchObject({ kind: 'person', tense: 'pres' });
    changeIt.choose(line(['pres', 'pc']));
    await changeIt.check();
    expect(asked).toHaveLength(2);
    const both = changeIt.playlist();
    expect(both.some((drill) => drill.kind === 'time')).toBe(true);
    expect(both.some((drill) => drill.tense === 'pc')).toBe(true);
    for (const drill of both) expect(['pres', 'pc']).toContain(drill.tense);
    // On a passé composé line, a time cue from the présent stays out, as does every présent answer.
    changeIt.choose(line(['pc']));
    for (const drill of changeIt.playlist()) expect(drill).toMatchObject({ kind: 'person', tense: 'pc' });
    expect(() => changeIt.choose({ set: 'chosen', verbIds: [], tenses: ['pres'] })).toThrow('Choose at least one verb.');
    for (const drill of changeIt.playlist()) expect(drill.tense).toBe('pc');
    changeIt.close();
  });

  test('a check between tapes writes for the line last chosen, after a restart too', async () => {
    dir = mkdtempSync(join(tmpdir(), 'echo-change-'));
    const first = store(join(dir, 'echo.db'), []);
    first.choose({ set: 'chosen', verbIds: ['v-partir'], tenses: ['fut'] });
    first.close();
    const asked: string[] = [];
    const again = store(join(dir, 'echo.db'), asked);
    await again.check();
    const lines = asked[0]!.split('\n').filter((row) => /^\d+\. /.test(row));
    expect(lines.length).toBeGreaterThan(0);
    for (const row of lines) expect(row).toMatch(/^\d+\. partir \(to leave\) — base: futur, .+; answer: futur, .+; cue "/);
    for (const drill of again.playlist()) expect(drill).toMatchObject({ verbId: 'v-partir', kind: 'person', tense: 'fut' });
    again.close();
  });
});
