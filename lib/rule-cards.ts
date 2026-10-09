// How it's built: cards on how a tense is formed for a verb, not on one form: the présent's stems, the imparfait
// stem, the futur stem, the passé composé helper and participle, and a few cards on the rules themselves. Every answer
// is read off the verb tables (lib/verbs.ts), so a card can never teach a form the tables don't have. A round draws
// only from the verbs and tenses on Verbs' Practising line. The learner marks each card, as in Cards: +1 knew it, −2
// didn't, halving over SCORE_HALF_LIFE_DAYS. The marks are kept per card, apart from the forms' answers: knowing that
// venir takes être is not knowing "nous sommes venus".
import { Database } from 'bun:sqlite';
import { SCORE_HALF_LIFE_DAYS, StoreError } from './store';
import { conjugate, groupOf, paradigm, rule, subject, TENSE_NAMES, TENSES, type ParadigmRow, type Tense, type Verb } from './verbs';

export type RuleKind = Tense | 'rule';
// ask: what the card asks; inf and clue: what the front shows under it; answer: the back's big line. examples are
// forms said as the verb tape records them (subject + form), so their recordings can be found. value: how much the
// card is worth drawing, higher for the exceptions (être's ét-, an irregular stem, a verb taking être) and
// STARTED_LEAN times higher for a verb the learner has started.
export type RuleCard = {
  id: string; kind: RuleKind; tense: Tense; ask: string; inf: string; clue: string; clueLang: 'fr' | 'en'; answer: string;
  tenseName: string; examples: string[]; paradigm: ParadigmRow[]; rule: string; value: number;
};
export type RuleCardView = Omit<RuleCard, 'examples' | 'value'> & { examples: { text: string; audio: string | null }[] };

const COMMON = 20;
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
const list = (items: string[], most = 8) => items.slice(0, most).join(', ') + (items.length > most ? ` and ${items.length - most} more` : '');

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
    id: `pres:${verb.id}`, kind: 'pres', tense: 'pres', ask: stems ? 'Présent stems' : 'Présent: je, nous, ils', inf: verb.inf, clue: verb.en, clueLang: 'en',
    answer: stems ? stems.map((stem) => `${stem}-`).join(' · ') : examples.join(' · '),
    tenseName: TENSE_NAMES.pres, examples, paradigm: paradigm(verb, 'pres'), rule: rule(verb, 'pres'),
    value: lean * (!stems ? 3 : stems.length === 3 ? 2.5 : stems.length === 2 ? (verb.base.endsWith('er') ? 1.2 : 2) : verb.base.endsWith('er') ? 0.5 : 1),
  };
}
function impCard(verb: Verb, lean: number): RuleCard {
  const group = groupOf(verb, 'imp');
  const stem = verb.base === 'être' ? 'ét' : verb.imp[0]!.replace(/ais$/, '');
  return {
    id: `imp:${verb.id}`, kind: 'imp', tense: 'imp', ask: 'Imparfait stem', inf: verb.inf, clue: said(verb, 'pres', 3), clueLang: 'fr', answer: `${stem}-`,
    tenseName: TENSE_NAMES.imp, examples: forms(verb, 'imp', [0, 3, 5]), paradigm: paradigm(verb, 'imp'), rule: rule(verb, 'imp'),
    value: lean * (group === 'etre' ? 3 : group === 'from-nous' ? 2 : group === 'soft' || group === 'double-i' ? 1.5 : verb.base.endsWith('er') ? 0.6 : 1.2),
  };
}
function futCard(verb: Verb, lean: number): RuleCard {
  const group = groupOf(verb, 'fut');
  return {
    id: `fut:${verb.id}`, kind: 'fut', tense: 'fut', ask: 'Futur stem', inf: verb.inf, clue: verb.en, clueLang: 'en', answer: `${verb.fut}-`,
    tenseName: TENSE_NAMES.fut, examples: forms(verb, 'fut', [0, 2, 5]), paradigm: paradigm(verb, 'fut'), rule: rule(verb, 'fut'),
    value: lean * (group === 'stem' ? 3 : group === 'er-change' ? 2 : verb.base.endsWith('re') ? 1.2 : 0.6),
  };
}
function pcCard(verb: Verb, lean: number): RuleCard {
  const group = groupOf(verb, 'pc');
  const helper = verb.reflexive ? 'être' : verb.aux;
  return {
    id: `pc:${verb.id}`, kind: 'pc', tense: 'pc', ask: 'Passé composé', inf: verb.inf, clue: verb.en, clueLang: 'en', answer: `${helper} + ${verb.pp}`,
    tenseName: TENSE_NAMES.pc, examples: forms(verb, 'pc', [0, 2, 5]), paradigm: paradigm(verb, 'pc'), rule: rule(verb, 'pc'),
    value: lean * (group === 'etre' ? 3 : group === 'participle' ? 2.5 : group === 'reflexive' ? 2 : 0.6),
  };
}

// The rules themselves, each shown through a model verb when the tables have it; the lists in them are the
// learner's own verbs.
function ruleCards(verbs: Verb[], common: Verb[]): RuleCard[] {
  const find = (inf: string) => verbs.find((verb) => verb.inf === inf);
  const card = (id: string, tense: Tense, ask: string, clue: string, answer: string, model: Verb | undefined, examples: string[], text: string): RuleCard => ({
    id: `rule:${id}`, kind: 'rule', tense, ask, inf: TENSE_NAMES[tense], clue, clueLang: 'en', answer, tenseName: TENSE_NAMES[tense],
    examples, paradigm: model ? paradigm(model, tense) : [], rule: text, value: 3,
  });
  const parler = find('parler'), finir = find('finir'), prendre = find('prendre'), faire = find('faire'), aller = find('aller'), attendre = find('attendre'), venir = find('venir');
  const etreVerbs = verbs.filter((verb) => !verb.reflexive && verb.aux === 'être').map((verb) => verb.inf);
  const reflexive = verbs.find((verb) => verb.reflexive && !verb.impersonal);
  const stems = verbs.filter((verb) => groupOf(verb, 'fut') === 'stem').map((verb) => `${verb.fut}- (${verb.inf})`);
  const participles = common.filter((verb) => groupOf(verb, 'pc') === 'participle').map((verb) => `${verb.pp} (${verb.inf})`);
  const arrow = (verb: Verb | undefined, from: (verb: Verb) => string, to: (verb: Verb) => string) => verb ? [`${from(verb)} → ${to(verb)}`] : [];
  return [
    card('pres-er', 'pres', 'Présent of -er verbs', 'The six endings?', '-e -es -e -ons -ez -ent', parler,
      parler ? forms(parler, 'pres', [0, 3, 5]) : [],
      'Every -er verb but aller takes them. je, tu, il and ils sound the same; only nous (-ons) and vous (-ez) are heard differently.'),
    card('pres-ir', 'pres', 'Présent of finir', 'The six endings?', '-is -is -it -issons -issez -issent', finir,
      finir ? forms(finir, 'pres', [0, 3, 5]) : [],
      'Most -ir verbs (finir, choisir, réussir) add -iss- for nous, vous and ils. A few do not: je pars, nous partons; je dors, nous dormons.'),
    card('pres-stems', 'pres', 'Présent stems', 'Which persons keep the infinitive’s stem?', 'nous and vous', venir,
      venir ? forms(venir, 'pres', [0, 3, 5]) : [],
      `In a verb with two or three stems, nous and vous are built on the infinitive${venir ? ` (venir → nous venons)` : ''}; je, tu, il and often ils change it${venir ? ` (je viens, ils viennent)` : ''}.`),
    card('imp-stem', 'imp', 'The imparfait stem', 'Where does it come from?', 'nous présent − ons', finir,
      finir ? [said(finir, 'pres', 3), said(finir, 'imp', 0), said(finir, 'imp', 5)] : [],
      `Take the nous form of the présent and drop -ons: ${[...arrow(finir, (verb) => said(verb, 'pres', 3), (verb) => `${verb.imp[0]!.replace(/ais$/, '')}-`), ...arrow(faire, (verb) => said(verb, 'pres', 3), (verb) => `${verb.imp[0]!.replace(/ais$/, '')}-`)].join(', ')}. It works for verbs irregular in the présent too. The one exception is être: ét- (j’étais).`),
    card('imp-endings', 'imp', 'Imparfait endings', 'The six endings?', '-ais -ais -ait -ions -iez -aient', parler,
      parler ? forms(parler, 'imp', [0, 3, 5]) : [],
      'Every verb takes them, être too. je, tu, il and ils sound the same; only nous (-ions) and vous (-iez) are heard differently.'),
    card('fut-stem', 'fut', 'The futur stem', 'For a regular verb?', 'the infinitive (-re: drop the e)', prendre,
      prendre ? forms(prendre, 'fut', [0, 2, 5]) : [],
      `${[parler, finir, prendre].flatMap((verb) => arrow(verb, (entry) => entry.inf, (entry) => `${entry.fut}-`)).join(', ')}. Every futur stem ends in r, the irregular ones too${stems.length ? `: ${list(stems)}` : ''}.`),
    card('fut-endings', 'fut', 'Futur endings', 'Which verb are they borrowed from?', 'avoir: -ai -as -a -ons -ez -ont', parler,
      parler ? forms(parler, 'fut', [0, 1, 5]) : [],
      'The futur endings are the présent of avoir (ai, as, a, ont), with nous and vous cut to -ons and -ez. Every verb takes them, on its futur stem.'),
    card('pc-etre', 'pc', 'être or avoir?', 'Which verbs take être?', 'coming, going, becoming — and reflexives', aller,
      [...(aller ? forms(aller, 'pc', [0, 5]) : []), ...(reflexive ? [said(reflexive, 'pc', 0)] : [])],
      `${etreVerbs.length ? `Among your verbs: ${list(etreVerbs, 12)}. ` : ''}Every reflexive verb takes être too${reflexive ? ` (${said(reflexive, 'pc', 0)})` : ''}. All the others take avoir.`),
    card('pc-agree', 'pc', 'With être', 'What does the participle do?', 'it agrees with the subject', aller,
      aller ? [`elle ${conjugate(aller, 'pc')[2]!.accepted.at(-1)}`, said(aller, 'pc', 5), `elles ${conjugate(aller, 'pc')[5]!.accepted.at(-1)}`] : [],
      `With être the participle agrees like an adjective: -e for a woman, -s for more than one. With avoir it stays as it is${prendre ? `: elle ${conjugate(prendre, 'pc')[2]!.accepted[0]}, ils ${conjugate(prendre, 'pc')[5]!.accepted[0]}` : ''}.`),
    card('pc-participles', 'pc', 'Participles', 'How do the regular ones end?', '-er → -é · -ir → -i · -re → -u', parler,
      [parler, finir, attendre].flatMap((verb) => verb ? [said(verb, 'pc', 0)] : []),
      `${[parler, finir, attendre].flatMap((verb) => arrow(verb, (entry) => entry.inf, (entry) => entry.pp)).join(', ')}.${participles.length ? ` The common ones to know by heart: ${list(participles, 10)}.` : ''}`),
  ];
}

// Every card the verbs give: the rule cards (their lists from all the learner's verbs), and for each picked verb its
// présent stems, imparfait stem, futur stem and passé composé. Phrases built on a verb (avoir peur, se rendre compte)
// get no cards of their own: their table is their verb's, so a picked phrase stands for the verb with that table.
export function ruleCandidates(verbs: Verb[], started: Set<string>, picked: Verb[] = verbs): RuleCard[] {
  const seen = new Set<string>();
  const usable = verbs.filter((verb) => !verb.base.includes(' ') && !seen.has(verb.inf) && !!seen.add(verb.inf));
  const common = new Set(verbs.slice(0, COMMON).map((verb) => verb.id));
  const table = (verb: Verb) => `${verb.pres.join(',')}|${verb.fut}|${verb.pp}`;
  const wanted = new Set(picked.flatMap((verb) => [verb.inf, table(verb)]));
  const cards: RuleCard[] = ruleCards(usable, usable.filter((verb) => common.has(verb.id)));
  for (const verb of usable) {
    if (!wanted.has(verb.inf) && !wanted.has(table(verb))) continue;
    const lean = started.has(verb.id) ? STARTED_LEAN : 1;
    // An impersonal verb (falloir) has only il: no stems to compare and no nous form to build the imparfait on.
    if (!verb.impersonal) cards.push(presCard(verb, lean), impCard(verb, lean));
    cards.push(futCard(verb, lean), pcCard(verb, lean));
  }
  return cards;
}

// The deck for the picked verbs and tenses: the rule cards of those tenses, then the most valuable cards of each
// tense up to its cap (a stable sort, so among equals the more common verb stays).
export function ruleDeck(verbs: Verb[], started: Set<string>, picked: Verb[] = verbs, tenses: readonly Tense[] = TENSES): RuleCard[] {
  const cards = ruleCandidates(verbs, started, picked).filter((card) => tenses.includes(card.tense));
  return [
    ...cards.filter((card) => card.kind === 'rule'),
    ...tenses.flatMap((tense) => cards.filter((card) => card.kind === tense).sort((left, right) => right.value - left.value).slice(0, CAPS[tense])),
  ];
}

export function createRuleCards(options: {
  dbPath: string;
  verbs: () => Verb[];
  // Each vocabulary word's status, for which verbs are started.
  vocabulary: () => { id: string; status: string }[];
  // The recording of a phrase (the verb tape's, By ear's), or null when there is none.
  audio: (said: string) => string | null;
  now?: () => Date; random?: () => number;
}) {
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
  const view = (card: RuleCard): RuleCardView => {
    const { examples, value: _value, ...rest } = card;
    return { ...rest, examples: examples.map((text) => ({ text, audio: options.audio(text) })) };
  };

  // The next cards from the verbs and tenses picked (Verbs' Practising line): drawn without replacement by weight
  // (random^(1/weight), highest first), so low-scoring and unmarked cards come first, the exceptions and the
  // learner's own verbs a little sooner; neighbours differ in verb.
  function round(scope: { verbs: Verb[]; tenses: Tense[] }): RuleCardView[] {
    const score = scores();
    const started = new Set(options.vocabulary().filter((word) => word.status !== 'new').map((word) => word.id));
    const drawn = ruleDeck(options.verbs(), started, scope.verbs, scope.tenses)
      .map((card) => ({ card, key: random() ** (1 / (pull(score.get(card.id)) * card.value)) }))
      .sort((left, right) => right.key - left.key).slice(0, ROUND).map((entry) => entry.card);
    const ordered: RuleCard[] = [];
    while (drawn.length) {
      const index = drawn.findIndex((card) => card.inf !== ordered.at(-1)?.inf);
      ordered.push(...drawn.splice(index < 0 ? 0 : index, 1));
    }
    return ordered.map(view);
  }

  // The learner's own say on a card, once per request id. Any card the verbs give counts, in the deck now or not.
  function mark(input: { requestId: string; id: string; knew: boolean }) {
    if (typeof input?.requestId !== 'string' || !input.requestId) throw new StoreError('This mark is missing its request ID.');
    if (typeof input.knew !== 'boolean') throw new StoreError('Say whether you knew it.');
    const started = new Set(options.vocabulary().filter((word) => word.status !== 'new').map((word) => word.id));
    if (typeof input.id !== 'string' || !ruleCandidates(options.verbs(), started).some((card) => card.id === input.id)) throw new StoreError('That card is not in Echo.', 404);
    insert.run(input.requestId, input.id, input.knew ? 1 : 0, now().toISOString());
    return { ok: true };
  }

  return { round, mark, close: () => db.close() };
}
