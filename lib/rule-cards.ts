// How it's built: cards on how a tense is formed for a verb, not on one form: the présent's stems, the imparfait
// stem, the futur stem, the passé composé helper and participle. Every answer is read off the verb tables
// (lib/verbs.ts), so a card can never teach a form the tables don't have. A round draws only from the verbs and tenses
// on Verbs' Practising line. The learner marks each card, as in Cards: +1 knew it, −2 didn't, halving over
// SCORE_HALF_LIFE_DAYS; the mark also counts for the verb's forms in that tense (onVerbMark).
import { Database } from 'bun:sqlite';
import { SCORE_HALF_LIFE_DAYS, StoreError } from './store';
import { bothHelpers, conjugate, groupOf, paradigm, rule, subject, TENSE_NAMES, TENSES, type ParadigmRow, type Tense, type Verb } from './verbs';
import type { DrillVerb, VerbGrammar } from './verb-grammar';

export type RuleKind = Tense | 'rule';
// ask: what the card asks; inf and clue: what the front shows under it; answer: the back's big line. examples are
// forms said as the verb tape records them (subject + form), so their recordings can be found. value: how much the
// card is worth drawing, higher for the exceptions (être's ét-, an irregular stem, a verb taking être) and
// STARTED_LEAN times higher for a verb the learner has started.
// clueLang 'fr' marks a clue in the language learnt, whichever it is. verbId names the verb a card is about (a verb's
// stems, its futur stem, its passé composé); a card about a rule itself has none.
export type RuleCard<T extends string = Tense> = {
  id: string; kind: T | 'rule'; tense: T; ask: string; inf: string; clue: string; clueLang: 'fr' | 'en'; answer: string;
  tenseName: string; examples: string[]; paradigm: ParadigmRow[]; rule: string; value: number; verbId?: string;
};
export type RuleCardView<T extends string = Tense> = Omit<RuleCard<T>, 'examples' | 'value'> & { examples: { text: string; audio: string | null }[] };

// The deck holds at most this many cards of each kind, the most valuable first, so a regular -er verb's card only
// fills a place nothing irregular wants.
const CAPS: Record<Tense, number> = { pres: 40, imp: 30, fut: 35, pc: 45 };
const STARTED_LEAN = 1.5;
const ROUND = 12;
// A card is drawn with odds 2^(-score/PULL) × its value, the score held within ±LIMIT, as Cards draws forms: an
// unmarked card at 0, one missed once about twice as likely, one known twice in a row about half as likely.
const PULL = 1.7;
const LIMIT = 8;
const pull = (score: number | undefined) => 2 ** (-Math.max(-LIMIT, Math.min(LIMIT, score ?? 0)) / PULL);
const DAY_MS = 86_400_000;

// A form as the verb tape and By ear say it: the subject, then the first accepted form (the participle unagreed).
function said(verb: Verb, tense: Tense, person: number): string {
  const asked = verb.impersonal ? 2 : person;
  const form = conjugate(verb, tense)[asked]!.accepted[0]!;
  return subject(asked, form) + form;
}
const forms = (verb: Verb, tense: Tense, people: number[]) => [...new Set(people.map((person) => said(verb, tense, person)))];

// The présent's stems: the je form without -e, -s or -x, the nous form without -ons, the ils form without -ent. A
// regular verb has one (parl-), others two or three (fini- finiss-, vien- ven- vienn-). A verb whose forms don't take
// those endings (être, avoir, aller, faire) is null: its three forms are learnt as they are.
export function presentStems(verb: Verb): string[] | null {
  const one = verb.pres[0]?.match(/^(.+?)(e|s|x)$/)?.[1], two = verb.pres[3]?.match(/^(.+)ons$/)?.[1], three = verb.pres[5]?.match(/^(.+)ent$/)?.[1];
  return one && two && three ? [...new Set([one, two, three])] : null;
}
function presCard(verb: Verb, lean: number): RuleCard {
  const stems = presentStems(verb);
  const examples = forms(verb, 'pres', [0, 3, 5]);
  return {
    id: `pres:${verb.id}`, verbId: verb.id, kind: 'pres', tense: 'pres', ask: stems ? 'Présent stems' : 'Présent: je, nous, ils', inf: verb.inf, clue: verb.en, clueLang: 'en',
    answer: stems ? stems.map((stem) => `${stem}-`).join(' · ') : examples.join(' · '),
    tenseName: TENSE_NAMES.pres, examples, paradigm: paradigm(verb, 'pres'), rule: rule(verb, 'pres'),
    value: lean * (!stems ? 3 : stems.length === 3 ? 2.5 : stems.length === 2 ? (verb.base.endsWith('er') ? 1.2 : 2) : verb.base.endsWith('er') ? 0.5 : 1),
  };
}
function impCard(verb: Verb, lean: number): RuleCard {
  const group = groupOf(verb, 'imp');
  const stem = verb.base === 'être' ? 'ét' : verb.imp[0]!.replace(/ais$/, '');
  return {
    id: `imp:${verb.id}`, verbId: verb.id, kind: 'imp', tense: 'imp', ask: 'Imparfait stem', inf: verb.inf, clue: said(verb, 'pres', 3), clueLang: 'fr', answer: `${stem}-`,
    tenseName: TENSE_NAMES.imp, examples: forms(verb, 'imp', [0, 3, 5]), paradigm: paradigm(verb, 'imp'), rule: rule(verb, 'imp'),
    value: lean * (group === 'etre' ? 3 : group === 'from-nous' ? 2 : group === 'soft' || group === 'double-i' ? 1.5 : verb.base.endsWith('er') ? 0.6 : 1.2),
  };
}
function futCard(verb: Verb, lean: number): RuleCard {
  const group = groupOf(verb, 'fut');
  return {
    id: `fut:${verb.id}`, verbId: verb.id, kind: 'fut', tense: 'fut', ask: 'Futur stem', inf: verb.inf, clue: verb.en, clueLang: 'en', answer: `${verb.fut}-`,
    tenseName: TENSE_NAMES.fut, examples: forms(verb, 'fut', [0, 2, 5]), paradigm: paradigm(verb, 'fut'), rule: rule(verb, 'fut'),
    value: lean * (group === 'stem' ? 3 : group === 'er-change' ? 2 : verb.base.endsWith('re') ? 1.2 : 0.6),
  };
}
// A verb taking either helper (sortir: je suis sorti · j’ai sorti la poubelle) shows both: an example and a table each.
function pcCard(verb: Verb, lean: number): RuleCard {
  const group = groupOf(verb, 'pc');
  const helper = verb.reflexive ? 'être' : verb.aux;
  const both = bothHelpers(verb);
  return {
    id: `pc:${verb.id}`, verbId: verb.id, kind: 'pc', tense: 'pc', ask: 'Passé composé', inf: verb.inf, clue: verb.en, clueLang: 'en',
    answer: both ? `être · avoir + ${verb.pp}` : `${helper} + ${verb.pp}`,
    tenseName: TENSE_NAMES.pc, examples: both ? [both.etre, both.avoir] : forms(verb, 'pc', [0, 2, 5]),
    paradigm: both ? [...paradigm({ ...verb, aux: 'être' }, 'pc'), ...paradigm({ ...verb, aux: 'avoir' }, 'pc')] : paradigm(verb, 'pc'),
    rule: rule(verb, 'pc'), value: lean * (group === 'etre' ? 3 : group === 'participle' ? 2.5 : group === 'reflexive' ? 2 : 0.6),
  };
}

// Every card the verbs give: for each picked verb its présent stems, imparfait stem, futur stem and passé composé.
// Phrases built on a verb (avoir peur, se rendre compte) get no cards of their own: their table is their verb's, so a
// picked phrase stands for the verb with that table.
export function ruleCandidates(verbs: Verb[], started: Set<string>, picked: Verb[] = verbs): RuleCard[] {
  const seen = new Set<string>();
  const usable = verbs.filter((verb) => !verb.base.includes(' ') && !seen.has(verb.inf) && !!seen.add(verb.inf));
  const table = (verb: Verb) => `${verb.pres.join(',')}|${verb.fut}|${verb.pp}`;
  const wanted = new Set(picked.flatMap((verb) => [verb.inf, table(verb)]));
  const cards: RuleCard[] = [];
  for (const verb of usable) {
    if (!wanted.has(verb.inf) && !wanted.has(table(verb))) continue;
    const lean = started.has(verb.id) ? STARTED_LEAN : 1;
    // An impersonal verb (falloir) has only il: no stems to compare and no nous form to build the imparfait on.
    if (!verb.impersonal) cards.push(presCard(verb, lean), impCard(verb, lean));
    cards.push(futCard(verb, lean), pcCard(verb, lean));
  }
  return cards;
}

// The deck for the picked verbs and tenses: the most valuable cards of each tense up to its cap (a stable sort, so
// among equals the more common verb stays).
export function ruleDeck(verbs: Verb[], started: Set<string>, picked: Verb[] = verbs, tenses: readonly Tense[] = TENSES): RuleCard[] {
  const cards = ruleCandidates(verbs, started, picked).filter((card) => tenses.includes(card.tense));
  return tenses.flatMap((tense) => cards.filter((card) => card.kind === tense).sort((left, right) => right.value - left.value).slice(0, CAPS[tense]));
}

// grammar: where another language's cards come from (lib/verb-grammar.ts); French's are the ones above.
export function createRuleCards<V extends DrillVerb = Verb, T extends string = Tense>(options: {
  dbPath: string;
  verbs: () => V[];
  // Each vocabulary word's status, for which verbs are started.
  vocabulary: () => { id: string; status: string }[];
  // The recording of a phrase (the verb tape's, By ear's), or null when there is none.
  audio: (said: string) => string | null;
  grammar?: Pick<VerbGrammar<V, T>, 'ruleDeck' | 'ruleCandidates'>;
  // A mark on a card about one verb, passed on so it counts for that verb's forms in the tense (lib/verb-drills.ts).
  onVerbMark?: (input: { requestId: string; verbId: string; tense: T; knew: boolean }) => void;
  now?: () => Date; random?: () => number;
}) {
  const deck = options.grammar ?? ({ ruleDeck, ruleCandidates } as unknown as Pick<VerbGrammar<V, T>, 'ruleDeck' | 'ruleCandidates'>);
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const db = new Database(options.dbPath, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
    -- A How it's built card marked: knew it or not, kept once per request.
    CREATE TABLE IF NOT EXISTS rule_card_marks (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, card_id TEXT NOT NULL,
      knew INTEGER NOT NULL, marked_at TEXT NOT NULL
    );
  `);
  const insert = db.query('INSERT OR IGNORE INTO rule_card_marks (request_id, card_id, knew, marked_at) VALUES (?, ?, ?, ?)');
  const every = db.query<{ card_id: string; knew: number; marked_at: string }, []>('SELECT card_id, knew, marked_at FROM rule_card_marks ORDER BY sequence');

  function scores(): Map<string, number> {
    const end = now().getTime();
    const byCard = new Map<string, number>();
    for (const row of every.all()) byCard.set(row.card_id, (byCard.get(row.card_id) ?? 0) + (row.knew ? 1 : -2) * 0.5 ** ((end - Date.parse(row.marked_at)) / DAY_MS / SCORE_HALF_LIFE_DAYS));
    return byCard;
  }
  const view = (card: RuleCard<T>): RuleCardView<T> => {
    const { examples, value: _value, ...rest } = card;
    return { ...rest, examples: examples.map((text) => ({ text, audio: options.audio(text) })) };
  };

  // The next cards from the verbs and tenses picked (Verbs' Practising line): drawn without replacement by weight
  // (random^(1/weight), highest first), so low-scoring and unmarked cards come first, the exceptions and the
  // learner's own verbs a little sooner; neighbours differ in verb.
  function round(scope: { verbs: V[]; tenses: T[] }): RuleCardView<T>[] {
    const score = scores();
    const started = new Set(options.vocabulary().filter((word) => word.status !== 'new').map((word) => word.id));
    const drawn = deck.ruleDeck(options.verbs(), started, scope.verbs, scope.tenses)
      .map((card) => ({ card, key: random() ** (1 / (pull(score.get(card.id)) * card.value)) }))
      .sort((left, right) => right.key - left.key).slice(0, ROUND).map((entry) => entry.card);
    const ordered: RuleCard<T>[] = [];
    while (drawn.length) {
      const index = drawn.findIndex((card) => card.inf !== ordered.at(-1)?.inf);
      ordered.push(...drawn.splice(index < 0 ? 0 : index, 1));
    }
    return ordered.map(view);
  }

  // The learner's own say on a card, once per request id. Any card the verbs give counts, in the deck now or not; a
  // card about one verb counts for its forms too (onVerbMark).
  function mark(input: { requestId: string; id: string; knew: boolean }) {
    if (typeof input?.requestId !== 'string' || !input.requestId) throw new StoreError('This mark is missing its request ID.');
    if (typeof input.knew !== 'boolean') throw new StoreError('Say whether you knew it.');
    const started = new Set(options.vocabulary().filter((word) => word.status !== 'new').map((word) => word.id));
    const card = typeof input.id === 'string' ? deck.ruleCandidates(options.verbs(), started).find((entry) => entry.id === input.id) : undefined;
    if (!card) throw new StoreError('That card is not in Echo.', 404);
    insert.run(input.requestId, input.id, input.knew ? 1 : 0, now().toISOString());
    if (card.verbId) options.onVerbMark?.({ requestId: input.requestId, verbId: card.verbId, tense: card.tense, knew: input.knew });
    return { ok: true };
  }

  return { round, mark, close: () => db.close() };
}
