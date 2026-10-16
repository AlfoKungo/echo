// How it's built: cards on how a tense is formed for a verb, not on one form: the présent's stems, the imparfait
// stem, the futur stem, the passé composé helper and participle, the conditionnel stem, the plus-que-parfait helper,
// the subjonctif stems and the impératif's three forms. Every answer is read off the verb tables
// (lib/verbs.ts), so a card can never teach a form the tables don't have. A round draws only from the verbs and tenses
// on Verbs' Practising line, by the verb-tense schedule the other drills share (lib/verb-drills.ts): what is due
// first, then new ones while today has room, then the rest. The learner marks each card, as in Cards; the mark counts
// for the verb's forms in that tense and moves it in the schedule (onVerbMark).
import { Database } from 'bun:sqlite';
import { StoreError } from './store';
import { bothHelpers, conjugate, groupOf, paradigm, persons, presentShape, usualEndings, presentStems, rule, stemOf, stemsByPerson, subject, TENSE_NAMES, TENSES, type ParadigmRow, type Tense, type Verb } from './verbs';
import type { DrillVerb, VerbGrammar } from './verb-grammar';

export type RuleKind = Tense | 'rule';
// ask: what the card asks; inf and clue: what the front shows under it; answer: the back's big line (the stems, the
// helper and participle). differs: what sets the verb apart from a regular one in this tense, or the family it follows
// instead of its infinitive's (ouvrir behaves like an -er verb); a verb fully regular in the tense has none, since
// the table under the card shows its endings. examples are
// forms said as the verb tape records them (subject + form), so their recordings can be found. value: how much the
// card is worth drawing, higher for the exceptions (être's ét-, an irregular stem, a verb taking être) and
// STARTED_LEAN times higher for a verb the learner has started.
// clueLang 'fr' marks a clue in the language learnt, whichever it is. verbId names the verb a card is about (a verb's
// stems, its futur stem, its passé composé); a card about a rule itself has none. regular marks a card that only
// repeats its tense's pattern (one -er présent stem, an -er imparfait, a futur on the whole infinitive, avoir with a
// regular participle).
// stems: on a présent or subjonctif card, each stem with the persons it serves (fini- for je, tu, il; finiss- for nous,
// vous, ils), so the answer says which stem goes where; change: where in it the stems differ, [from, to).
export type RuleCard<T extends string = Tense> = {
  id: string; kind: T | 'rule'; tense: T; ask: string; inf: string; clue: string; clueLang: 'fr' | 'en'; answer: string; differs?: string;
  stems?: { stem: string; persons: string; change?: [number, number] }[];
  tenseName: string; examples: string[]; paradigm: ParadigmRow[]; rule: string; value: number; verbId?: string; regular?: boolean;
};
// standing: where the card's verb-tense stood when drawn: due now, new, or not yet due (practised ahead).
export type RuleCardView<T extends string = Tense> = Omit<RuleCard<T>, 'examples' | 'value' | 'regular'> & { examples: { text: string; audio: string | null }[]; standing: 'due' | 'new' | 'ahead' };

// Every card with something of its own to learn is in the deck. The regular ones all teach the same pattern, so each
// tense keeps only its REGULAR_KEPT most valuable (started and common verbs first) as reminders of it.
const REGULAR_KEPT = 10;
const STARTED_LEAN = 1.5;
const ROUND = 12;

// A form as the verb tape and By ear say it: the subject, then the first accepted form (the participle unagreed).
function said(verb: Verb, tense: Tense, person: number): string {
  const asked = verb.impersonal ? 2 : person;
  const form = conjugate(verb, tense)[asked]!.accepted[0]!;
  return subject(asked, form, tense) + form;
}
const forms = (verb: Verb, tense: Tense, people: number[]) => [...new Set(people.map((person) => said(verb, tense, person)))];

const PRONOUNS = ['je', 'tu', 'il', 'nous', 'vous', 'ils'];
// What sets a verb apart from a regular one, by tense and by its group in that tense (lib/verbs.ts groupOf). A
// regular group has no entry. A family named after a verb (Like partir) is not said on that verb's own card.
const DIFFERS: Record<Tense, Record<string, { label: string; model?: string }>> = {
  pres: {
    'er-change': { label: '-er, but the stem changes' },
    ouvrir: { label: 'Behaves like an -er verb' },
    partir: { label: 'Like partir', model: 'partir' },
    venir: { label: 'Like venir', model: 'venir' },
    prendre: { label: 'Like prendre', model: 'prendre' },
    irregular: { label: 'Irregular' },
  },
  imp: {
    etre: { label: 'The only irregular imparfait' },
    soft: { label: 'Keeps the soft g or ç before a' },
    'double-i': { label: 'Two i’s in nous and vous' },
  },
  fut: {
    stem: { label: 'Irregular stem' },
    'er-change': { label: 'The stem changes, as in je' },
  },
  pc: {
    etre: { label: 'Takes être, so it agrees' },
    reflexive: { label: 'Reflexive, so it takes être' },
    participle: { label: 'Irregular participle' },
  },
  cond: {
    stem: { label: 'Irregular stem, as in the futur' },
    'er-change': { label: 'The stem changes, as in je' },
  },
  pqp: {
    etre: { label: 'Takes être, so it agrees' },
    reflexive: { label: 'Reflexive, so it takes être' },
    participle: { label: 'Irregular participle' },
  },
  subj: {
    irregular: { label: 'A subjonctif of its own' },
    'two-stems': { label: 'Two stems' },
  },
  impe: {
    irregular: { label: 'An impératif of its own' },
    reflexive: { label: 'The pronoun goes after' },
  },
};
// A verb outside the named families says what sets it apart: il's -t, no -iss-, its -oir endings, a changing stem, and
// any form off its own pattern (vous dites, il connaît).
const PATTERNS = new Set(['re-change', 're-t', 'ir-s', 'oir']);
function patternDiffers(verb: Verb): string | undefined {
  const shape = presentShape(verb)!;
  const changes = new Set(shape.stems).size > 1;
  const group = groupOf(verb, 'pres');
  const parts = group === 're-change' ? ['-re, but the stem changes']
    : group === 're-t' ? ['-re, but il takes -t', ...(changes ? ['the stem changes'] : [])]
    : group === 'ir-s' ? ['No -iss-', ...(changes ? ['the stem changes'] : [])]
    // An -oir verb with the usual endings (devoir, voir) differs only by its stem.
    : usualEndings(shape) ? (changes ? ['The stem changes'] : [])
    : [verb.pres[0]!.endsWith('x') ? '-x, -x, -t' : '-s, -s, no -t', ...(changes ? ['the stem changes'] : [])];
  return [parts.join(', '), ...shape.odd].filter(Boolean).join(' · ') || undefined;
}
export function differs(verb: Verb, tense: Tense): string | undefined {
  if ((tense === 'pc' || tense === 'pqp') && bothHelpers(verb)) return 'Takes être or avoir';
  // Dropping the -s of tu is the -er rule; outside -er (ouvrir, aller) it is worth saying.
  if (tense === 'impe' && groupOf(verb, tense) === 'drop-s' && !(verb.base.endsWith('er') && verb.base !== 'aller')) return 'tu drops the -s, like an -er verb';
  if (tense === 'pres' && groupOf(verb, tense) === 'er-soft') return `Regular, but nous ${verb.pres[3]}`;
  if (tense === 'pres' && PATTERNS.has(groupOf(verb, tense))) return patternDiffers(verb);
  const entry = DIFFERS[tense][groupOf(verb, tense)];
  return entry && entry.model !== verb.base ? entry.label : undefined;
}
// Each stem with the persons it serves, in the order they first appear (achèt- for je, tu, il, ils; achet- for nous, vous).
function stemGroups(stems: [string, string, string]): { stem: string; persons: string; change?: [number, number] }[] {
  const groups = new Map<string, string[]>();
  PRONOUNS.forEach((pronoun, person) => { const stem = stemOf(stems, person); groups.set(stem, [...groups.get(stem) ?? [], pronoun]); });
  const change = changeOf(stems);
  return [...groups].map(([stem, persons]) => {
    const to = stem.length - (change?.end ?? 0);
    return { stem: `${stem}-`, persons: persons.join(', '), ...(change && to > change.start ? { change: [change.start, to] as [number, number] } : {}) };
  });
}
// Where a verb's stems differ: what is left once the start and the end they all share are taken off (promèn- and
// promen-: the è and the e; prend-, pren- and prenn-: the d and the second n). Null for a single stem.
function changeOf(stems: readonly string[]): { start: number; end: number } | null {
  const unique = [...new Set(stems)];
  if (unique.length < 2) return null;
  const first = unique[0]!;
  let start = 0;
  while (unique.every((stem) => start < stem.length && stem[start] === first[start])) start++;
  let end = 0;
  while (unique.every((stem) => stem.length - end > start && stem[stem.length - 1 - end] === first[first.length - 1 - end])) end++;
  return { start, end };
}
// A stem after what leads up to it, as parts, with the letters where the stems differ marked.
function stemParts(lead: string, stem: string, change: { start: number; end: number } | null): ParadigmRow['parts'] {
  const to = stem.length - (change?.end ?? 0);
  if (!change || to <= change.start) return [{ text: lead + stem }];
  return [{ text: lead + stem.slice(0, change.start) }, { text: stem.slice(change.start, to), change: true }, ...(to < stem.length ? [{ text: stem.slice(to) }] : [])];
}
// The table with each form split at its own person's stem, so what is lit is exactly the ending the card names
// (je me souvien|s, nous nous souven|ons), not whatever the six forms happen not to share. A form not built on its
// stem (vous dites) is lit whole.
function presentParadigm(verb: Verb, stems: [string, string, string] | null): ParadigmRow[] {
  const rows = paradigm(verb, 'pres');
  if (!stems) return rows;
  return rows.map((row) => {
    const full = row.parts.map((part) => part.text).join('');
    const form = verb.pres[row.person]!;
    if (!full.endsWith(form)) return row;
    const lead = full.slice(0, full.length - form.length);
    const stem = stemOf(stems, row.person);
    if (!form.startsWith(stem)) return { ...row, parts: [{ text: lead }, { text: form, lit: true as const }] };
    const ending = form.slice(stem.length);
    return { ...row, parts: [...stemParts(lead, stem, changeOf(stems)), ...(ending ? [{ text: ending, lit: true as const }] : [])] };
  });
}
// A -ger or -cer verb (manger, commencer) has one stem, the infinitive's: nous mangeons only keeps the g soft, so it
// counts as a regular -er card and its table lights the -eons.
function presCard(verb: Verb, lean: number): RuleCard {
  const soft = groupOf(verb, 'pres') === 'er-soft';
  const stem = verb.base.slice(0, -2);
  const byPerson: [string, string, string] | null = soft ? [stem, stem, stem] : stemsByPerson(verb);
  const stems = soft ? [stem] : presentStems(verb);
  const examples = forms(verb, 'pres', [0, 3, 5]);
  return {
    id: `pres:${verb.id}`, verbId: verb.id, kind: 'pres', tense: 'pres', ask: stems ? 'Présent stems' : 'Présent: je, nous, ils', inf: verb.inf, clue: verb.en, clueLang: 'en',
    answer: stems ? stems.map((stem) => `${stem}-`).join(' · ') : examples.join(' · '), differs: differs(verb, 'pres'), stems: byPerson ? stemGroups(byPerson) : undefined,
    tenseName: TENSE_NAMES.pres, examples, paradigm: presentParadigm(verb, byPerson), rule: rule(verb, 'pres'),
    value: lean * (!stems ? 3 : groupOf(verb, 'pres') === 'ouvrir' ? 2.5 : stems.length === 3 ? 2.5 : stems.length === 2 ? (verb.base.endsWith('er') ? 1.2 : 2) : verb.base.endsWith('er') ? 0.5 : 1),
    regular: stems?.length === 1 && verb.base.endsWith('er'),
  };
}
function impCard(verb: Verb, lean: number): RuleCard {
  const group = groupOf(verb, 'imp');
  const stem = verb.base === 'être' ? 'ét' : verb.imp[0]!.replace(/ais$/, '');
  return {
    id: `imp:${verb.id}`, verbId: verb.id, kind: 'imp', tense: 'imp', ask: 'Imparfait stem', inf: verb.inf, clue: said(verb, 'pres', 3), clueLang: 'fr', answer: `${stem}-`, differs: differs(verb, 'imp'),
    tenseName: TENSE_NAMES.imp, examples: forms(verb, 'imp', [0, 3, 5]), paradigm: paradigm(verb, 'imp'), rule: rule(verb, 'imp'),
    value: lean * (group === 'etre' ? 3 : group === 'from-nous' ? 2 : group === 'soft' || group === 'double-i' ? 1.5 : verb.base.endsWith('er') ? 0.6 : 1.2),
    regular: !['etre', 'from-nous', 'soft', 'double-i'].includes(group) && verb.base.endsWith('er'),
  };
}
function futCard(verb: Verb, lean: number): RuleCard {
  const group = groupOf(verb, 'fut');
  return {
    id: `fut:${verb.id}`, verbId: verb.id, kind: 'fut', tense: 'fut', ask: 'Futur stem', inf: verb.inf, clue: verb.en, clueLang: 'en', answer: `${verb.fut}-`, differs: differs(verb, 'fut'),
    tenseName: TENSE_NAMES.fut, examples: forms(verb, 'fut', [0, 2, 5]), paradigm: paradigm(verb, 'fut'), rule: rule(verb, 'fut'),
    value: lean * (group === 'stem' ? 3 : group === 'er-change' ? 2 : verb.base.endsWith('re') ? 1.2 : 0.6),
    regular: group !== 'stem' && group !== 'er-change' && !verb.base.endsWith('re'),
  };
}
// A verb taking either helper (sortir: je suis sorti · j’ai sorti la poubelle) shows a table for each; its examples
// stay its own helper's forms, the ones the verb tape records, and the rule gives a sentence with each helper.
function pcCard(verb: Verb, lean: number): RuleCard {
  const group = groupOf(verb, 'pc');
  const helper = verb.reflexive ? 'être' : verb.aux;
  const both = bothHelpers(verb);
  return {
    id: `pc:${verb.id}`, verbId: verb.id, kind: 'pc', tense: 'pc', ask: 'Passé composé', inf: verb.inf, clue: verb.en, clueLang: 'en',
    answer: both ? `être · avoir + ${verb.pp}` : `${helper} + ${verb.pp}`, differs: differs(verb, 'pc'),
    tenseName: TENSE_NAMES.pc, examples: forms(verb, 'pc', [0, 2, 5]),
    paradigm: both ? [...paradigm({ ...verb, aux: 'être' }, 'pc'), ...paradigm({ ...verb, aux: 'avoir' }, 'pc')] : paradigm(verb, 'pc'),
    rule: rule(verb, 'pc'), value: lean * (group === 'etre' ? 3 : group === 'participle' ? 2.5 : group === 'reflexive' ? 2 : 0.6),
    regular: !['etre', 'participle', 'reflexive'].includes(group),
  };
}

// The conditionnel's stem is the futur's; the card asks for it with the endings it takes.
function condCard(verb: Verb, lean: number): RuleCard {
  const group = groupOf(verb, 'cond');
  return {
    id: `cond:${verb.id}`, verbId: verb.id, kind: 'cond', tense: 'cond', ask: 'Conditionnel stem', inf: verb.inf, clue: verb.en, clueLang: 'en', answer: `${verb.fut}- + -ais`, differs: differs(verb, 'cond'),
    tenseName: TENSE_NAMES.cond, examples: forms(verb, 'cond', [0, 2, 3]), paradigm: paradigm(verb, 'cond'), rule: rule(verb, 'cond'),
    value: lean * (group === 'stem' ? 2.5 : group === 'er-change' ? 1.5 : verb.base.endsWith('re') ? 1 : 0.5),
    regular: group !== 'stem' && group !== 'er-change' && !verb.base.endsWith('re'),
  };
}
// The plus-que-parfait: the passé composé with its helper in the imparfait. A verb taking either helper shows both.
function pqpCard(verb: Verb, lean: number): RuleCard {
  const group = groupOf(verb, 'pqp');
  const helper = verb.reflexive || verb.aux === 'être' ? 'étais' : 'avais';
  const both = bothHelpers(verb);
  return {
    id: `pqp:${verb.id}`, verbId: verb.id, kind: 'pqp', tense: 'pqp', ask: 'Plus-que-parfait', inf: verb.inf, clue: said(verb, 'pc', 0), clueLang: 'fr',
    answer: both ? `étais · avais + ${verb.pp}` : `${helper} + ${verb.pp}`, differs: differs(verb, 'pqp'),
    tenseName: TENSE_NAMES.pqp, examples: forms(verb, 'pqp', [0, 2, 5]),
    paradigm: both ? [...paradigm({ ...verb, aux: 'être' }, 'pqp'), ...paradigm({ ...verb, aux: 'avoir' }, 'pqp')] : paradigm(verb, 'pqp'),
    rule: rule(verb, 'pqp'), value: lean * (group === 'etre' ? 2 : group === 'participle' ? 2 : group === 'reflexive' ? 1.5 : 0.5),
    regular: !['etre', 'participle', 'reflexive'].includes(group),
  };
}
// The subjonctif's stems: the ils présent's for je, tu, il and ils, the imparfait's for nous and vous; a verb with a
// subjonctif of its own shows its forms instead. The table lights each person's ending on its own stem.
function subjCard(verb: Verb, lean: number): RuleCard {
  const group = groupOf(verb, 'subj');
  const all = conjugate(verb, 'subj');
  const one = verb.pres[5]?.replace(/ent$/, ''), two = verb.imp[3]?.replace(/ions$/, '');
  const byPerson: [string, string, string] | null = group === 'regular' || group === 'two-stems' ? [one!, two!, one!] : null;
  const examples = forms(verb, 'subj', verb.impersonal ? [2] : [0, 3, 5]);
  const rows = paradigm(verb, 'subj');
  return {
    id: `subj:${verb.id}`, verbId: verb.id, kind: 'subj', tense: 'subj', ask: byPerson ? 'Subjonctif stems' : 'Subjonctif: que je, que nous, qu’ils', inf: verb.inf,
    clue: verb.impersonal ? verb.en : said(verb, 'pres', 5), clueLang: verb.impersonal ? 'en' : 'fr',
    answer: byPerson ? [...new Set([one, two])].map((stem) => `${stem}-`).join(' · ') : examples.join(' · '), differs: differs(verb, 'subj'),
    stems: byPerson && one !== two ? stemGroups(byPerson) : undefined,
    tenseName: TENSE_NAMES.subj, examples,
    paradigm: byPerson ? rows.map((row) => stemRow(row, all[row.person]!.shown, stemOf(byPerson, row.person), changeOf(byPerson))) : rows,
    rule: rule(verb, 'subj'), value: lean * (group === 'irregular' ? 3 : group === 'two-stems' ? 2 : verb.base.endsWith('er') ? 0.5 : 1),
    regular: group === 'regular' && verb.base.endsWith('er'),
  };
}
// The impératif's three forms: tu, nous, vous, without a subject.
function impeCard(verb: Verb, lean: number): RuleCard {
  const group = groupOf(verb, 'impe');
  const examples = forms(verb, 'impe', [1, 3, 4]);
  const er = verb.base.endsWith('er') && verb.base !== 'aller';
  return {
    id: `impe:${verb.id}`, verbId: verb.id, kind: 'impe', tense: 'impe', ask: 'Impératif: tu, nous, vous', inf: verb.inf, clue: verb.en, clueLang: 'en',
    answer: examples.join(' · '), differs: differs(verb, 'impe'),
    tenseName: TENSE_NAMES.impe, examples, paradigm: paradigm(verb, 'impe'), rule: rule(verb, 'impe'),
    value: lean * (group === 'irregular' ? 3 : group === 'drop-s' && !er ? 2 : group === 'reflexive' ? 1.5 : er ? 0.5 : 1),
    regular: (group === 'drop-s' && er) || group === 'regular',
  };
}
// A row split at its person's stem, so what is lit is the ending on it (que je prenn|e, que nous pren|ions).
function stemRow(row: ParadigmRow, form: string, stem: string, change: { start: number; end: number } | null): ParadigmRow {
  const full = row.parts.map((part) => part.text).join('');
  if (!full.endsWith(form)) return row;
  const lead = full.slice(0, full.length - form.length);
  const at = form.lastIndexOf(stem);
  if (at < 0) return { ...row, parts: [{ text: lead }, { text: form, lit: true as const }] };
  const ending = form.slice(at + stem.length);
  return { ...row, parts: [...stemParts(lead + form.slice(0, at), stem, change), ...(ending ? [{ text: ending, lit: true as const }] : [])] };
}

// Every card the verbs give: for each picked verb a card per tense it has (présent stems, imparfait stem, futur stem,
// passé composé, conditionnel stem, plus-que-parfait, subjonctif stems, impératif).
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
    // An impersonal verb (falloir) has only il: no stems to compare and no nous form to build the imparfait on, and
    // no impératif.
    if (!verb.impersonal) cards.push(presCard(verb, lean), impCard(verb, lean));
    cards.push(futCard(verb, lean), pcCard(verb, lean), condCard(verb, lean), pqpCard(verb, lean));
    if (persons(verb, 'subj').length) cards.push(subjCard(verb, lean));
    if (persons(verb, 'impe').length) cards.push(impeCard(verb, lean));
  }
  return cards;
}

// The deck for the picked verbs and tenses: every card with something of its own, then the REGULAR_KEPT most valuable
// regular cards of each tense (a stable sort, so among equals the more common verb stays).
export function ruleDeck(verbs: Verb[], started: Set<string>, picked: Verb[] = verbs, tenses: readonly Tense[] = TENSES): RuleCard[] {
  const cards = ruleCandidates(verbs, started, picked).filter((card) => tenses.includes(card.tense));
  return tenses.flatMap((tense) => {
    const own = cards.filter((card) => card.kind === tense).sort((left, right) => right.value - left.value);
    return [...own.filter((card) => !card.regular), ...own.filter((card) => card.regular).slice(0, REGULAR_KEPT)];
  });
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
  // A mark taken back: what onVerbMark counted for that request goes too.
  onVerbUnmark?: (requestId: string) => void;
  // Where each verb-tense stands in the schedule ("verbId|tense": when it is due), and how many may still be new today.
  schedule: () => { standings: Map<string, { due: number }>; newLeft: number };
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
  const remove = db.query('DELETE FROM rule_card_marks WHERE request_id = ?');
  const view = (card: RuleCard<T>, standing: RuleCardView<T>['standing']): RuleCardView<T> => {
    const { examples, value: _value, regular: _regular, ...rest } = card;
    return { ...rest, examples: examples.map((text) => ({ text, audio: options.audio(text) })), standing };
  };

  // The next cards from the verbs and tenses picked (Verbs' Practising line), by the schedule: those due, longest
  // overdue first; then new ones, up to what today has left, the exceptions and the learner's own verbs likelier
  // (random^(1/value), highest first); then the rest, soonest due first. Every verb-tense already on the schedule keeps
  // its card, so a regular one comes back when due; only new cards are kept to the deck (ruleDeck's cap on regular
  // ones). Neighbours differ in verb. due and fresh: how many cards are due now, and how many new ones today allows.
  function round(scope: { verbs: V[]; tenses: T[] }): { items: RuleCardView<T>[]; due: number; fresh: number } {
    const { standings, newLeft } = options.schedule();
    const at = now().getTime();
    const started = new Set(options.vocabulary().filter((word) => word.status !== 'new').map((word) => word.id));
    const kept = new Set(deck.ruleDeck(options.verbs(), started, scope.verbs, scope.tenses).map((card) => card.id));
    const cards = deck.ruleCandidates(options.verbs(), started, scope.verbs).filter((card) => scope.tenses.includes(card.tense));
    const standingOf = (card: RuleCard<T>) => card.verbId ? standings.get(`${card.verbId}|${card.tense}`) : undefined;
    const due = cards.filter((card) => (standingOf(card)?.due ?? Infinity) <= at).sort((left, right) => standingOf(left)!.due - standingOf(right)!.due);
    const fresh = cards.filter((card) => !standingOf(card) && kept.has(card.id)).map((card) => ({ card, key: random() ** (1 / card.value) })).sort((left, right) => right.key - left.key).map((entry) => entry.card);
    const ahead = cards.filter((card) => (standingOf(card)?.due ?? -Infinity) > at).sort((left, right) => standingOf(left)!.due - standingOf(right)!.due);
    const allowed = fresh.slice(0, newLeft);
    const drawn = [...due, ...allowed, ...ahead, ...fresh.slice(newLeft)].slice(0, ROUND);
    const ordered: RuleCard<T>[] = [];
    while (drawn.length) {
      const index = drawn.findIndex((card) => card.inf !== ordered.at(-1)?.inf);
      ordered.push(...drawn.splice(index < 0 ? 0 : index, 1));
    }
    const dueIds = new Set(due.map((card) => card.id)), freshIds = new Set(fresh.map((card) => card.id));
    return { items: ordered.map((card) => view(card, dueIds.has(card.id) ? 'due' : freshIds.has(card.id) ? 'new' : 'ahead')), due: due.length, fresh: allowed.length };
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

  // Undo: the mark made under this request id is taken back, with what it counted for the verb's forms.
  function unmark(input: { requestId: string }) {
    if (typeof input?.requestId !== 'string' || !input.requestId) throw new StoreError('This undo is missing its request ID.');
    const removed = remove.run(input.requestId).changes > 0;
    if (removed) options.onVerbUnmark?.(input.requestId);
    return { ok: true, removed };
  }

  return { round, mark, unmark, close: () => db.close() };
}
