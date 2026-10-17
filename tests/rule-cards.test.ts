import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuleCards, ruleCandidates, ruleDeck, type RuleCard } from '../lib/rule-cards';
import { createVerbDrills, NEW_PER_DAY } from '../lib/verb-drills';
import { conjugate, presentStems, TENSES, verbOf, type VerbTable, type VerbWord } from '../lib/verbs';
import fixture from './fixtures/rule-verbs.json';

// Tables as Claude wrote them in the learner's verbs.json, with their vocabulary words, in vocabulary order.
const { words, tables } = fixture as { words: VerbWord[]; tables: VerbTable[] };
const verbs = words.map((word, index) => verbOf(tables[index]!, word));
const idOf = (fr: string) => words.find((word) => word.fr === fr)!.id;
const all = ruleCandidates(verbs, new Set());
const cardFor = (cards: RuleCard[], kind: string, fr: string) => cards.find((card) => card.id === `${kind}:${idOf(fr)}`);
const verbNamed = (fr: string) => verbs.find((verb) => verb.id === idOf(fr))!;
const everything = { verbs, tenses: [...TENSES] };

describe('how it’s built: the deck', () => {
  test('a reflexive verb next to its plain verb keeps only the cards where it differs, and brings the plain verb\'s', () => {
    const reflexive = verbNamed('se réveiller');
    const withPlain = [...verbs, { ...reflexive, id: 'v-réveiller', inf: 'réveiller', reflexive: false }];
    const kinds = (cards: RuleCard[], id: string) => cards.filter((card) => card.verbId === id).map((card) => card.kind);
    expect(kinds(ruleCandidates(verbs, new Set()), reflexive.id)).toContain('pres');
    const picked = ruleCandidates(withPlain, new Set(), [reflexive]);
    expect(kinds(picked, reflexive.id)).toEqual(['pc', 'pqp', 'impe']);
    expect(kinds(picked, 'v-réveiller')).toEqual(['pres', 'imp', 'fut', 'pc', 'cond', 'pqp', 'subj', 'impe']);
  });

  test('a card says what sets its verb apart from a regular one, and nothing for a verb regular in its family', () => {
    const said = Object.fromEntries(['parler', 'finir', 'manger', 'acheter', 'prendre', 'revenir', 'partir', 'pouvoir'].map((fr) => [fr, cardFor(all, 'pres', fr)!.differs]));
    expect(said).toEqual({
      parler: undefined, finir: undefined, manger: 'Regular, but nous mangeons', acheter: '-er, but the stem changes',
      prendre: undefined, revenir: 'Like venir', partir: undefined, pouvoir: '-x, -x, -t, the stem changes',
    });
    const ouvrir = verbOf({ id: 'x-ouvrir', pres: ['ouvre', 'ouvres', 'ouvre', 'ouvrons', 'ouvrez', 'ouvrent'], imp: ['ouvrais', 'ouvrais', 'ouvrait', 'ouvrions', 'ouvriez', 'ouvraient'], fut: 'ouvrir', pp: 'ouvert', aux: 'avoir' }, { id: 'x-ouvrir', fr: 'ouvrir', en: 'to open' } as VerbWord);
    const card = ruleCandidates([ouvrir], new Set()).find((entry) => entry.kind === 'pres')!;
    expect(card.differs).toBe('Behaves like an -er verb');
    // The surprise weighs like a three-stem verb, well above a regular -er one.
    expect(card.value).toBeGreaterThan(cardFor(all, 'pres', 'parler')!.value);
    expect([cardFor(all, 'pc', 'partir')!.differs, cardFor(all, 'pc', 'prendre')!.differs, cardFor(all, 'pc', 'parler')!.differs]).toEqual(['Takes être, so it agrees', 'Irregular participle', undefined]);
    expect([cardFor(all, 'fut', 'venir')!.differs, cardFor(all, 'fut', 'prendre')!.differs]).toEqual(['Irregular stem', undefined]);
  });

  test('a verb outside the named families says what sets it apart, and only être, avoir, aller and faire are irregular', () => {
    const said = Object.fromEntries(['mettre', 'boire', 'dire', 'courir', 'devoir', 'pouvoir', 'voir', "s'asseoir", 'faire', 'être'].map((fr) => [fr, cardFor(all, 'pres', fr)?.differs]));
    expect(said).toEqual({
      mettre: '-re, but the stem changes', boire: '-re, but il takes -t, the stem changes', dire: '-re, but il takes -t, the stem changes · vous dites',
      courir: 'No -iss-', devoir: 'The stem changes', pouvoir: '-x, -x, -t, the stem changes', voir: 'The stem changes',
      "s'asseoir": '-s, -s, no -t, the stem changes', faire: 'Irregular', être: 'Irregular',
    });
  });

  test('the four built tenses ask for what they are built from and say what sets a verb apart', () => {
    expect(cardFor(all, 'cond', 'être')).toMatchObject({ answer: 'ser- + -ais', differs: 'Irregular stem, as in the futur' });
    expect(cardFor(all, 'pqp', 'aller')).toMatchObject({ answer: 'étais + allé', differs: 'Takes être, so it agrees', clue: 'je suis allé' });
    const prendre = cardFor(all, 'subj', 'prendre')!;
    expect(prendre).toMatchObject({ clue: 'ils prennent', differs: 'Two stems', stems: [{ stem: 'prenn-', persons: 'je, tu, il, ils' }, { stem: 'pren-', persons: 'nous, vous' }] });
    expect(prendre.paradigm.map((row) => row.parts.map((part) => part.lit ? `[${part.text}]` : part.text).join(''))).toEqual(['que je prenn[e]', 'que tu prenn[es]', 'qu’il prenn[e]', 'que nous pren[ions]', 'que vous pren[iez]', 'qu’ils prenn[ent]']);
    expect(cardFor(all, 'subj', 'faire')).toMatchObject({ differs: 'A subjonctif of its own', answer: 'que je fasse · que nous fassions · qu’ils fassent' });
    expect([cardFor(all, 'impe', 'aller')!.differs, cardFor(all, 'impe', 'parler')!.differs, cardFor(all, 'impe', 'se lever')!.differs]).toEqual(['tu drops the -s, like an -er verb', undefined, 'The pronoun goes after']);
    expect([cardFor(all, 'impe', 'pouvoir'), cardFor(all, 'impe', 'falloir')]).toEqual([undefined, undefined]);
  });

  test('every card says its pattern: what sets the verb apart, or the regular one it follows', () => {
    const label = (kind: string, fr: string) => cardFor(all, kind, fr)!.label;
    expect([label('pres', 'parler'), label('pres', 'finir'), label('pres', 'attendre'), label('pres', 'partir'), label('pres', 'acheter')])
      .toEqual(['Regular -er verb', 'Regular -ir verb, like finir', 'Regular -re verb', 'The partir pattern', '-er, but the stem changes']);
    expect([label('fut', 'parler'), label('pc', 'parler'), label('subj', 'parler'), label('impe', 'parler')]).toEqual(['Regular stem', 'avoir, regular participle', 'Regular, from ils', 'Regular -er: tu drops the -s']);
  });

  test('each stem is listed with the persons it serves, and the table lights the ending on it', () => {
    // Each stem with the letters where the stems differ in [ ].
    const marked = (fr: string) => cardFor(all, 'pres', fr)!.stems!.map(({ stem, persons, change }) => `${change ? `${stem.slice(0, change[0])}[${stem.slice(...change)}]${stem.slice(change[1])}` : stem} ${persons}`);
    expect(marked('revenir')).toEqual(['rev[ie]n- je, tu, il', 'rev[e]n- nous, vous', 'rev[ien]n- ils']);
    expect(marked('acheter')).toEqual(['ach[è]t- je, tu, il, ils', 'ach[e]t- nous, vous']);
    expect(marked('prendre')).toEqual(['pren[d]- je, tu, il', 'pren- nous, vous', 'pren[n]- ils']);
    // The table marks the same letters, and lights the ending after them.
    const row = (fr: string, person: number) => cardFor(all, 'pres', fr)!.paradigm[person]!.parts.map((part) => part.change ? `[${part.text}]` : part.lit ? `{${part.text}}` : part.text).join('');
    expect([row('prendre', 0), row('prendre', 3), row('prendre', 5), row('acheter', 0)]).toEqual(['je pren[d]{s}', 'nous pren{ons}', 'ils pren[n]{ent}', 'j’ach[è]t{e}']);
    const lit = (fr: string) => cardFor(all, 'pres', fr)!.paradigm.map((row) => row.parts.find((part) => part.lit)?.text ?? '');
    expect(lit('revenir')).toEqual(['s', 's', 't', 'ons', 'ez', 'ent']);
    expect(lit('dire')).toEqual(['s', 's', 't', 'ons', 'dites', 'ent']);
    expect(lit('manger')).toEqual(['e', 'es', 'e', 'eons', 'ez', 'ent']);
  });

  test('the présent stems: one for a regular verb, two or three for the others, the forms for être, avoir, aller, faire', () => {
    const stems = Object.fromEntries(['parler', 'finir', 'venir', 'prendre', 'manger', 'acheter', 'boire', 'pouvoir'].map((fr) => [fr, cardFor(all, 'pres', fr)!.answer]));
    expect(stems).toEqual({
      parler: 'parl-', finir: 'fini- · finiss-', venir: 'vien- · ven- · vienn-', prendre: 'prend- · pren- · prenn-',
      manger: 'mang-', acheter: 'achèt- · achet-', boire: 'boi- · buv- · boiv-', pouvoir: 'peu- · pouv- · peuv-',
    });
    for (const fr of ['être', 'avoir', 'aller', 'faire']) expect(presentStems(verbNamed(fr))).toBeNull();
    expect(cardFor(all, 'pres', 'être')).toMatchObject({ ask: 'Présent: je, nous, ils', answer: 'je suis · nous sommes · ils sont' });
    expect(cardFor(all, 'pres', 'falloir')).toBeUndefined();
  });

  test('the imparfait stem is the nous présent without -ons, except être’s ét-', () => {
    expect(cardFor(all, 'imp', 'être')).toMatchObject({ clue: 'nous sommes', answer: 'ét-', examples: ['j’étais', 'nous étions', 'ils étaient'] });
    expect(cardFor(all, 'imp', 'prendre')).toMatchObject({ clue: 'nous prenons', answer: 'pren-' });
    expect(cardFor(all, 'imp', 'faire')).toMatchObject({ clue: 'nous faisons', answer: 'fais-' });
    // The e kept before -ais shows in the stem; the examples show it go before -ions.
    expect(cardFor(ruleCandidates(verbs, new Set([idOf('manger')])), 'imp', 'manger')).toMatchObject({ answer: 'mange-', examples: ['je mangeais', 'nous mangions', 'ils mangeaient'] });
    expect(cardFor(ruleCandidates(verbs, new Set([idOf('se lever')])), 'imp', 'se lever')).toMatchObject({ clue: 'nous nous levons', answer: 'lev-' });
    // falloir has no nous form to build on.
    expect(cardFor(all, 'imp', 'falloir')).toBeUndefined();
  });

  test('every irregular futur stem is a card, started or not, and a regular one is the infinitive', () => {
    const stems = Object.fromEntries(all.filter((card) => card.kind === 'fut').map((card) => [card.inf, card.answer]));
    expect(stems).toMatchObject({
      'être': 'ser-', avoir: 'aur-', faire: 'fer-', aller: 'ir-', venir: 'viendr-', voir: 'verr-', savoir: 'saur-', vouloir: 'voudr-', pouvoir: 'pourr-',
      devoir: 'devr-', falloir: 'faudr-', envoyer: 'enverr-', mourir: 'mourr-', courir: 'courr-', tenir: 'tiendr-', revenir: 'reviendr-', 's’asseoir': 'assiér-',
      acheter: 'achèter-', appeler: 'appeller-', jeter: 'jetter-', payer: 'paier-', prendre: 'prendr-', parler: 'parler-',
    });
    expect(cardFor(all, 'fut', 'envoyer')!.examples).toEqual(['j’enverrai', 'il enverra', 'ils enverront']);
    expect(cardFor(all, 'fut', 'falloir')!.examples).toEqual(['il faudra']);
    expect(cardFor(ruleCandidates(verbs, new Set([idOf('attendre')])), 'fut', 'attendre')!.answer).toBe('attendr-');
  });

  test('the passé composé card is the helper and the participle: être verbs, reflexives, irregular participles', () => {
    for (const [fr, answer] of [['aller', 'être + allé'], ['venir', 'être + venu'], ['partir', 'être + parti'], ['rester', 'être + resté'], ['descendre', 'être · avoir + descendu'], ['tomber', 'être + tombé'], ['mourir', 'être + mort'],
      ['être', 'avoir + été'], ['avoir', 'avoir + eu'], ['prendre', 'avoir + pris'], ['mettre', 'avoir + mis'], ['boire', 'avoir + bu'], ['devoir', 'avoir + dû'], ['falloir', 'avoir + fallu']] as const) {
      expect(cardFor(ruleCandidates(verbs, new Set(words.map((word) => word.id))), 'pc', fr)?.answer).toBe(answer);
    }
    // Every verb taking être is in, started or not; a reflexive verb takes être whatever its table's helper says.
    for (const fr of ['tomber', 'mourir', 'descendre']) expect(cardFor(all, 'pc', fr)).toBeDefined();
    const index = words.findIndex((word) => word.fr === 'se lever');
    const leverWithAvoir = verbOf({ ...tables[index]!, aux: 'avoir' }, words[index]!);
    const [card] = ruleCandidates([leverWithAvoir], new Set([leverWithAvoir.id])).filter((entry) => entry.kind === 'pc');
    expect(card).toMatchObject({ answer: 'être + levé', examples: ['je me suis levé', 'il s’est levé', 'ils se sont levés'] });
  });

  test('every example holds the verb’s own form, as conjugate gives it', () => {
    for (const card of ruleCandidates(verbs, new Set(words.map((word) => word.id)))) {
      const verb = verbs.find((entry) => card.id.endsWith(`:${entry.id}`))!;
      const tense = card.tense;
      const said = conjugate(verb, tense).flatMap((form) => form ? form.accepted : []);
      for (const example of card.examples) expect(said.some((form) => example.includes(form))).toBe(true);
    }
  });

  test('phrases built on a verb get no cards of their own', () => {
    const started = new Set([idOf('avoir peur'), idOf('se rendre compte')]);
    const ids = ruleCandidates(verbs, started).map((card) => card.id);
    expect(ids.filter((id) => id.endsWith(idOf('avoir peur')) || id.endsWith(idOf('se rendre compte')))).toEqual([]);
  });

  test('a verb taking either helper shows a table for each, its own helper’s recorded forms, and both in the rule', () => {
    const card = cardFor(all, 'pc', 'descendre')!;
    // The examples are the forms the verb tape records, so they can be heard; the two sentences live in the rule.
    expect(card.examples).toEqual(['je suis descendu', 'il est descendu', 'ils sont descendus']);
    expect(card.paradigm.map((row) => row.parts.map((part) => part.text).join(''))).toEqual([
      'je suis descendu(e)', 'tu es descendu(e)', 'il est descendu(e)', 'nous sommes descendu(e)s', 'vous êtes descendu(e)(s)', 'ils sont descendu(e)s',
      'j’ai descendu', 'tu as descendu', 'il a descendu', 'nous avons descendu', 'vous avez descendu', 'ils ont descendu',
    ]);
    expect(card.rule).toBe('descendre takes être on its own (je suis descendu du bus) and avoir when it has an object (j’ai descendu l’escalier). With être the participle agrees: elle est descendue, ils sont descendus.');
    expect(all.some((entry) => entry.kind === 'rule')).toBe(false);
  });

  test('every card with something of its own is in the deck; each tense keeps its ten most valuable regular cards', () => {
    const deck = ruleDeck(verbs, new Set());
    expect(deck.filter((card) => !card.regular).map((card) => card.id).sort()).toEqual(all.filter((card) => !card.regular).map((card) => card.id).sort());
    for (const tense of TENSES) expect(deck.filter((card) => card.tense === tense && card.regular).length).toBe(Math.min(10, all.filter((card) => card.tense === tense && card.regular).length));
    expect(cardFor(deck, 'imp', 'être')!.regular).toBe(false);
    expect(cardFor(deck, 'imp', 'commencer')!.regular).toBe(false);
    expect(cardFor(deck, 'pres', 'parler')!.regular).toBe(true);
    // The least common regular card (passé composé has eleven here) is left out until its verb is started, which
    // outranks the regular cards not started.
    const last = all.filter((card) => card.tense === 'pc' && card.regular).at(-1)!;
    expect(deck.some((card) => card.id === last.id)).toBe(false);
    expect(ruleDeck(verbs, new Set([last.verbId!])).some((card) => card.id === last.id)).toBe(true);
    const some = ruleDeck(verbs, new Set([idOf('étudier')]));
    expect(cardFor(some, 'imp', 'étudier')!.value).toBeGreaterThan(cardFor(some, 'imp', 'voir')!.value);
  });

  test('the deck holds only the verbs and tenses on the Practising line', () => {
    const picked = ['venir', 'parler', 'avoir peur'].map(verbNamed);
    const deck = ruleDeck(verbs, new Set(), picked, ['pres']);
    expect(deck.map((card) => card.id).sort()).toEqual([`pres:${idOf('avoir')}`, `pres:${idOf('parler')}`, `pres:${idOf('venir')}`].sort());
    const past = ruleDeck(verbs, new Set(), picked, ['pc', 'imp']);
    expect(new Set(past.map((card) => card.tense))).toEqual(new Set(['pc', 'imp']));
    expect(past.length).toBe(6);
  });
});

describe('how it’s built: marks', () => {
  const directories: string[] = [];
  const closers: (() => void)[] = [];
  afterEach(() => { for (const close of closers.splice(0)) close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
  const clock = { value: new Date(2026, 9, 9, 10) };
  // The cards with the verb drills behind them, as the server wires them: a mark counts for the forms and the
  // schedule, and a round is drawn by the schedule.
  function open(directory = mkdtempSync(join(tmpdir(), 'echo-rules-')), onVerbMark?: (input: { requestId: string; verbId: string; tense: string; knew: boolean }) => void) {
    directories.push(directory);
    const dbPath = join(directory, 'echo.db');
    const drills = createVerbDrills({ dbPath, verbs: () => verbs, vocabulary: () => [], earAudio: () => null, now: () => new Date(clock.value) });
    // A constant draw orders new cards purely by value, so the order can be checked.
    const cards = createRuleCards({
      dbPath, verbs: () => verbs, vocabulary: () => [{ id: idOf('tomber'), status: 'learning' }],
      audio: (said) => said === 'je suis tombé' ? 'audio/radio/fr-0000000000000000.mp3' : null, random: () => 0.5, now: () => new Date(clock.value),
      onVerbMark: onVerbMark ?? drills.markBuilt, onVerbUnmark: drills.unmarkBuilt,
      schedule: () => { const standings = drills.standings(); return { standings, newLeft: drills.newLeft(standings) }; },
    });
    closers.push(cards.close, drills.close);
    return { cards, drills, directory };
  }

  test('a first round is new cards, the started verbs and exceptions first, with recordings where they exist', () => {
    const { cards } = open();
    const round = cards.round(everything);
    expect([round.items.length, round.due, round.fresh]).toEqual([12, 0, NEW_PER_DAY]);
    // tomber is started: its être + tombé card outweighs every other.
    expect(round.items[0]).toMatchObject({ id: `pc:${idOf('tomber')}`, answer: 'être + tombé' });
    expect(round.items[0]!.examples[0]).toEqual({ text: 'je suis tombé', audio: 'audio/radio/fr-0000000000000000.mp3' });
    expect(round.items[0]!.examples[1]!.audio).toBeNull();
    expect(round.items[0]).not.toHaveProperty('value');
  });

  test('each verb-tense has its card\'s pattern; a phrase has the pattern of the verb whose table it shares', () => {
    const { cards } = open();
    const patterns = cards.patterns(['pres']);
    expect(patterns[`${idOf('parler')}|pres`]).toEqual(['Regular -er verb', 'parl-']);
    expect(patterns[`${idOf('avoir peur')}|pres`]).toEqual(patterns[`${idOf('avoir')}|pres`]!);
    expect(patterns[`${idOf('avoir')}|pres`]![0]).toBe('Irregular');
    expect(Object.keys(patterns).some((id) => !id.endsWith('|pres'))).toBe(false);
  });

  test('a card known goes away for a day, one missed is due at once and first, and the marks persist; a request counts once', () => {
    const first = open();
    const known = `pc:${idOf('tomber')}`, missed = `fut:${idOf('envoyer')}`;
    first.cards.mark({ requestId: 'a', id: known, knew: true });
    first.cards.mark({ requestId: 'a', id: known, knew: true });
    const db = new Database(join(first.directory, 'echo.db'), { readonly: true });
    expect(db.query('SELECT COUNT(*) AS marks FROM rule_card_marks').get()).toEqual({ marks: 1 });
    db.close();
    first.cards.mark({ requestId: 'b', id: missed, knew: false });
    const round = first.cards.round(everything);
    expect([round.items[0]!.id, round.due, round.fresh]).toEqual([missed, 1, NEW_PER_DAY - 2]);
    // The known card is practised ahead, after the due one and today's new ones.
    const standing = (kind: string) => round.items.filter((card) => card.standing === kind).map((card) => card.id);
    expect([standing('due'), standing('ahead')]).toEqual([[missed], [known]]);
    first.cards.close(); first.drills.close();
    closers.splice(0);
    const again = open(first.directory);
    expect(again.cards.round(everything).items[0]!.id).toBe(missed);
    // A day on, the known card is due again too, after the one due longest.
    clock.value = new Date(clock.value.getTime() + 86_400_000);
    expect(again.cards.round(everything).items.slice(0, 2).map((card) => card.id)).toEqual([missed, known]);
    clock.value = new Date(2026, 9, 9, 10);
  });

  test('Undo takes a mark back from the schedule too', () => {
    const { cards } = open();
    const id = `fut:${idOf('envoyer')}`;
    cards.mark({ requestId: 'u', id, knew: false });
    expect(cards.round(everything).due).toBe(1);
    cards.unmark({ requestId: 'u' });
    expect(cards.round(everything).due).toBe(0);
  });

  test('a mark needs a card Echo has, a request id and a yes or no', () => {
    const { cards } = open();
    expect(() => cards.mark({ requestId: 'x', id: 'imp:nope', knew: true })).toThrow('That card is not in Echo.');
    expect(() => cards.mark({ requestId: '', id: `pc:${idOf('aller')}`, knew: true })).toThrow('request ID');
    expect(() => cards.mark({ requestId: 'y', id: `pc:${idOf('aller')}`, knew: 'yes' as never })).toThrow('Say whether you knew it.');
    // A card dropped from the deck by the cap still counts: it is one the verbs give.
    expect(cards.mark({ requestId: 'z', id: `imp:${idOf('parler')}`, knew: true })).toEqual({ ok: true });
  });

  test('a mark passes on to its verb’s tense', () => {
    const passed: unknown[] = [];
    const { cards } = open(undefined, (input) => passed.push(input));
    cards.mark({ requestId: 'v', id: `fut:${idOf('envoyer')}`, knew: false });
    expect(passed).toEqual([{ requestId: 'v', verbId: idOf('envoyer'), tense: 'fut', knew: false }]);
  });
});
