// Swedish verbs for the Verbs room (lib/verb-grammar.ts). A Swedish verb does not change by person, so what is
// drilled is its key forms: present, past and supine, in the engine's person slots 0, 1 and 2. The room drills by
// conjugation group where French drills tenses: each group (1 -ar, 2 -er, 3 short, 4 strong and irregular) is a tense
// id, and a verb has forms only in its own. The forms are the deck's notes, which give exactly "present, past,
// supine" for every verb (particle and reflexive verbs with their particle or sig in each); the group is read off
// them, so it can never disagree with the forms taught.
import type { RuleCard } from './rule-cards';
import { litRows, type DrillVerb, type EarQuestion, type Form, type ParadigmRow, type VerbGrammar } from './verb-grammar';
import { normal } from './verbs';

export const SV_TENSES = ['one', 'two', 'three', 'four'] as const;
export type SvTense = typeof SV_TENSES[number];
type Three = [string, string, string];
// head: the verb itself (gå in gå ut); tail: what follows it in every form (ut, sig, mat). kind: the group within the
// group (2: de, te, r-stem; 4: strong, irregular). deponent: an s-verb (hoppas), whose -s stays in every form.
export type SvVerb = DrillVerb & { forms: Three; group: SvTense; kind: string; head: string; tail: string; deponent: boolean };

export const SV_TENSE_NAMES: Record<SvTense, string> = { one: 'Group 1: -ar', two: 'Group 2: -er', three: 'Group 3: short verbs', four: 'Group 4: strong and irregular' };
export const SV_PERSON_LABELS = ['present', 'past', 'supine'];
const KEY = [0, 1, 2];
const PARTICLES = new Set(['ut', 'upp', 'in', 'ner', 'av', 'på', 'med', 'om', 'ihåg', 'tillbaka', 'under', 'bort', 'hem', 'iväg', 'fram']);

// The group a verb's three forms put it in, from the verb alone (no particle or sig).
export function svGroup(inf: string, forms: Three): { group: SvTense; kind: string } {
  const deponent = inf.endsWith('s') && forms.every((form) => form.endsWith('s'));
  const base = deponent ? inf.slice(0, -1) : inf;
  // An s-verb's present drops more than the -r (skäms, finns), so only its past and supine are compared.
  const [present, past, supine] = deponent ? [null, forms[1].slice(0, -1), forms[2].slice(0, -1)] : forms;
  const presentIs = (...options: string[]) => present === null || options.includes(present);
  if (base.endsWith('a') && presentIs(`${base}r`) && past === `${base}de` && supine === `${base}t`) return { group: 'one', kind: 'ar' };
  if (!base.endsWith('a') && presentIs(`${base}r`) && past === `${base}dde` && supine === `${base}tt`) return { group: 'three', kind: 'short' };
  if (base.endsWith('a')) {
    const stem = base.slice(0, -1);
    // A double m or n is single before -de and -t (kände, känt); a stem in d merges with it (tände, tänt; betydde, betytt).
    const short = stem.replace(/(mm|nn)$/, (pair) => pair[0]!);
    const pastStems = new Set([stem, short, stem.replace(/d$/, '')]), supineStems = new Set([stem, short, stem.replace(/d$/, ''), stem.replace(/d$/, 't')]);
    const ending = past.endsWith('de') ? 'de' : past.endsWith('te') ? 'te' : '';
    if (ending && pastStems.has(past.slice(0, -2)) && supine.endsWith('t') && supineStems.has(supine.slice(0, -1)) && presentIs(`${stem}er`, stem)) {
      return { group: 'two', kind: ending === 'te' ? 'te' : present === stem ? 'r-stem' : 'de' };
    }
  }
  // Strong: a regular present (skriver, tar, bär) with a past of no ending and a supine in -it; vara (är) is irregular.
  const stem = base.replace(/a$/, '');
  return { group: 'four', kind: supine.endsWith('it') && presentIs(`${stem}er`, `${base}r`, stem) ? 'strong' : 'irregular' };
}

// The deck's verbs with their key forms, in vocabulary order: every "to …" word and the modal verbs in Verbs (kunna,
// and måste and ska, which have no infinitive and are listed by their present). A word whose note is not three forms
// each carrying the verb's particle or sig is left out.
export function svVerbs(words: { id: string; fr: string; en: string; category?: string; note?: string }[]): SvVerb[] {
  return words.flatMap((word) => {
    if (!/^to /.test(word.en) && word.category !== 'verbs') return [];
    const forms = (word.note ?? '').split(', ');
    const [head, ...rest] = word.fr.split(' ');
    const tail = rest.join(' ');
    if (forms.length !== 3 || !head || forms.some((form) => !form || (tail && !form.endsWith(` ${tail}`)))) return [];
    const bare = forms.map((form) => tail ? form.slice(0, -tail.length - 1) : form) as Three;
    const { group, kind } = svGroup(head, bare);
    return [{ id: word.id, inf: word.fr, en: word.en, forms: forms as Three, group, kind, head, tail, deponent: head.endsWith('s') && bare.every((form) => form.endsWith('s')) }];
  });
}

// ── Forms, answers, mistakes ──
// The deck gives the short spoken forms; the written ones are right too (sade, lade; givit), so either counts.
const WRITTEN: Record<string, string> = { sa: 'sade', la: 'lade', gett: 'givit' };
const persons = (verb: SvVerb, tense: SvTense) => tense === verb.group ? KEY : [];
const conjugate = (verb: SvVerb, tense: SvTense): (Form | null)[] => [0, 1, 2, 3, 4, 5].map((slot) => {
  if (tense !== verb.group || slot > 2) return null;
  const form = verb.forms[slot]!, [word, ...rest] = form.split(' ');
  const written = WRITTEN[word!] ? [[WRITTEN[word!], ...rest].join(' ')] : [];
  return { shown: form, accepted: [form, ...written] };
});
// A form is said on its own: no subject.
const subject = () => '';
// The form as typed, and without the words that may come before it: a subject (jag sprang) or the helper of the
// supine (har sprungit).
function readings(given: string): string[] {
  const typed = normal(given);
  const bare = typed.replace(/^(jag|du|han|hon|vi|ni|de|man) /, '').replace(/^(har|hade) /, '');
  return bare === typed ? [typed] : [typed, bare];
}
// å, ä and ö are letters of their own in Swedish, so a form counts only spelt as it is.
const isRight = (form: Form, given: string) => readings(given).some((reading) => form.accepted.includes(reading));
const accentSlip = () => false;
const dots = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '');

function diagnose(verb: SvVerb, _tense: SvTense, person: number, given: string): string {
  const typed = readings(given);
  const is = (text: string) => typed.includes(text);
  const right = verb.forms[person]!;
  for (const other of KEY) if (other !== person && is(verb.forms[other]!)) return `That’s the ${SV_PERSON_LABELS[other]}.`;
  if (typed.some((reading) => dots(reading) === dots(right))) return `Mind å, ä and ö: they are letters of their own (${right}).`;
  const bare = verb.tail ? right.slice(0, -verb.tail.length - 1) : right;
  if (verb.tail && is(bare)) return verb.tail.endsWith('sig') ? `Keep sig with it: ${right}.` : PARTICLES.has(verb.tail.split(' ')[0]!) ? `Keep the particle after the verb: ${right}.` : `Keep the whole phrase: ${right}.`;
  const tail = verb.tail ? ` ${verb.tail}` : '';
  const base = verb.deponent ? verb.head.slice(0, -1) : verb.head, s = verb.deponent ? 's' : '';
  const stem = base.replace(/a$/, '');
  // The forms a learner gets by putting a verb in the wrong group.
  const asGroup1 = [`${base}r`, `${base}de`, `${base}t`][person]!, asGroup2 = [`${stem}er`, `${stem}de`, `${stem}t`][person]!;
  if (verb.group !== 'one' && base.endsWith('a') && is(asGroup1 + s + tail)) return `${verb.inf} is not an -ar verb: ${right}.`;
  if (verb.kind === 'te' && person === 1 && is(`${right.slice(0, right.length - tail.length - s.length - 2)}de${s}${tail}`)) return `After k, p, s or t the past takes -te: ${right}.`;
  if (verb.group === 'two' && verb.kind !== 'te' && person === 1 && is(`${right.slice(0, right.length - tail.length - s.length - 2)}te${s}${tail}`)) return `-de here, since the stem ends in a voiced sound; -te comes after k, p, s, t: ${right}.`;
  if (verb.group === 'three' && is(`${base}${['r', 'de', 't'][person]}${s}${tail}`)) return `Short verbs double the consonant: ${verb.forms.join(', ')}.`;
  if (verb.group === 'four') {
    if (person > 0 && (is(asGroup2 + s + tail) || is(asGroup1 + s + tail))) return verb.kind === 'strong' ? `${verb.inf} is strong: the past takes no ending, and usually a new vowel: ${verb.forms.join(', ')}.` : `${verb.inf} is irregular: ${verb.forms.join(', ')}.`;
    if (verb.kind === 'strong' && person === 2 && typed.some((reading) => reading.replace(/(at|t)$/, 'it') === right || reading.replace(/(at|t)( .+)$/, 'it$2') === right)) return `A strong verb’s supine ends in -it: ${right}.`;
  }
  return '';
}

// ── Tables, rules, groups ──
function paradigm(verb: SvVerb, _tense?: SvTense): ParadigmRow[] {
  const bare = verb.forms.map((form) => verb.tail ? form.slice(0, -verb.tail.length - 1) : form);
  return litRows(KEY, SV_PERSON_LABELS, bare, () => '', verb.tail, (person) => SV_PERSON_LABELS[person]!);
}
const groupOf = (verb: SvVerb) => verb.kind;
const RULES: Record<string, string> = {
  ar: 'Group 1: the infinitive + -r, -de and -t. The biggest group, and new verbs join it (swishar, swishade, swishat).',
  de: 'Group 2: the stem (the infinitive without -a) + -er, -de and -t. A double m or n is single before -de and -t (kände, känt).',
  te: 'Group 2 with a stem ending in k, p, s or t: the past takes -te, not -de.',
  'r-stem': 'Group 2 with a stem ending in r: the present is the stem itself, with no -er.',
  short: 'Group 3: a short verb ending in a vowel other than -a, + -r, -dde and -tt.',
  strong: 'Strong: the past takes no ending and usually a new vowel, and the supine ends in -it.',
  irregular: 'Irregular: learn the three forms as they are.',
};
// A stem in d meets the d and t of the endings: after a consonant one d goes (använde, använt), after a long vowel
// it gives -dde and -tt (betydde, betytt).
const D_STEM = ' A stem ending in consonant + d keeps one d (använde, använt); after a long vowel, d gives -dde and -tt (betydde, betytt).';
function rule(verb: SvVerb): string {
  const tail = verb.tail.endsWith('sig') ? ' sig changes with the person (jag sätter mig, du sätter dig, vi sätter oss), and is listed as sig.'
    : verb.tail && PARTICLES.has(verb.tail.split(' ')[0]!) ? ' The particle stays after the verb in every form.'
    : verb.tail ? ` Only ${verb.head} changes; ${verb.tail} stays as it is.` : '';
  const deponent = verb.deponent ? ' An s-verb: the -s ends every form, and the present loses its -r (hoppas, skäms).' : '';
  const dStem = verb.kind === 'de' && /da$/.test(verb.head) ? D_STEM : '';
  return `${RULES[verb.kind]}${dStem} ${verb.forms.join(', ')}.${tail}${deponent}`;
}

type Group = { id: string; title: string; text: string; many?: true };
const GROUPS: Record<SvTense, Group[]> = {
  one: [{ id: 'ar', title: '-ar, -ade, -at', text: 'The infinitive + -r, -de and -t: pratar, pratade, pratat.', many: true }],
  two: [
    { id: 'r-stem', title: 'A stem ending in r', text: 'The present is the stem itself, with no -er: hör, hörde, hört.' },
    { id: 'te', title: '-te after k, p, s, t', text: 'After these sounds the past takes -te: köper, köpte, köpt.' },
    { id: 'de', title: '-er, -de, -t', text: 'The stem + -er, -de and -t: ringer, ringde, ringt. A double m or n is single before -de and -t: känner, kände, känt. A stem in consonant + d keeps one d: använde, använt.', many: true },
  ],
  three: [{ id: 'short', title: '-r, -dde, -tt', text: 'Short verbs that end in a vowel other than -a: bor, bodde, bott.' }],
  four: [
    { id: 'irregular', title: 'Irregular', text: 'The commonest verbs, each with its own forms: learn all three by heart.' },
    { id: 'strong', title: 'Strong', text: 'The past takes no ending and usually a new vowel, and the supine ends in -it: springer, sprang, sprungit.' },
  ],
};
const GROUP_TITLES = Object.fromEntries(SV_TENSES.map((tense) => [tense, Object.fromEntries(GROUPS[tense].map((group) => [group.id, group.title]))])) as Record<SvTense, Record<string, string>>;
const MODELS: Record<SvTense, string[]> = { one: ['prata', 'vänta', 'studera'], two: ['ringa', 'köpa', 'höra'], three: ['bo', 'tro', 'må'], four: ['skriva', 'springa', 'vara'] };
const USES: Record<SvTense, string> = {
  one: 'Verbs whose present ends in -ar: the biggest group, and the one new verbs join. The supine goes after har: jag har pratat.',
  two: 'A present in -er (or just the stem after r); the past adds -de, or -te after k, p, s, t.',
  three: 'Short verbs that end in a vowel other than -a: -r, -dde, -tt.',
  four: 'Strong and irregular verbs: the vowel changes, or the forms are their own, so each is learnt by heart.',
};
function tenseGuide(verbs: SvVerb[], tense: SvTense) {
  const models = MODELS[tense].flatMap((inf) => { const verb = verbs.find((entry) => entry.inf === inf); return verb ? [{ id: verb.id, inf: verb.inf, paradigm: paradigm(verb) }] : []; });
  const groups = GROUPS[tense].map((group) => ({
    id: group.id, title: group.title, text: group.text, ...(group.many ? { many: true as const } : {}),
    verbs: verbs.filter((verb) => verb.group === tense && verb.kind === group.id).map((verb) => ({ id: verb.id, inf: verb.inf, detail: verb.forms.join(', ') })).sort((a, b) => a.inf.localeCompare(b.inf, 'sv')),
  })).filter((group) => group.verbs.length);
  return { tense, name: SV_TENSE_NAMES[tense], use: USES[tense], models, groups };
}
function verbGuide(verb: SvVerb) {
  return { id: verb.id, inf: verb.inf, en: verb.en, tenses: [{ tense: verb.group, name: SV_TENSE_NAMES[verb.group], group: GROUP_TITLES[verb.group][verb.kind]!, rule: rule(verb), paradigm: paradigm(verb) }] };
}

// ── How it's built: which group a verb is in, a strong verb's vowel change, and the groups themselves ──
// examples are said as recorded: the three forms in one phrase.
// Group 4 holds every strong and irregular verb and each strong verb's vowel card, so all of them fit its cap.
const CAPS: Record<SvTense, number> = { one: 25, two: 35, three: 12, four: 75 };
const STARTED_LEAN = 1.5;
const VALUES: Record<string, number> = { irregular: 3, strong: 2.5, short: 2, te: 1.6, 'r-stem': 1.6, de: 1.3, ar: 0.5 };
export const keyPhrase = (verb: SvVerb) => verb.forms.join(', ');
const SHORT: Record<SvTense, string> = { one: 'Group 1', two: 'Group 2', three: 'Group 3', four: 'Group 4' };
// A strong verb's vowels: the first vowel of its infinitive, past and supine (skriva, skrev, skrivit: i → e → i).
function vowels(verb: SvVerb): string | null {
  const first = (word: string) => word.match(/[aeiouyåäö]/)?.[0] ?? '';
  const found = [verb.head, ...verb.forms.slice(1).map((form) => form.split(' ')[0]!)].map(first);
  return found.every(Boolean) && new Set(found).size > 1 ? found.join(' → ') : null;
}
function ruleCards(verbs: SvVerb[]): RuleCard<SvTense>[] {
  const find = (inf: string) => verbs.find((verb) => verb.inf === inf);
  const card = (id: string, tense: SvTense, ask: string, clue: string, answer: string, model: SvVerb | undefined, examples: string[], text: string): RuleCard<SvTense> => ({
    id: `rule:${id}`, kind: 'rule', tense, ask, inf: SHORT[tense], clue, clueLang: 'en', answer, tenseName: SV_TENSE_NAMES[tense],
    examples, paradigm: model ? paradigm(model) : [], rule: text, value: 3,
  });
  const phrase = (verb: SvVerb | undefined) => verb ? [keyPhrase(verb)] : [];
  const of = (kind: string, most = 8) => verbs.filter((verb) => verb.kind === kind).slice(0, most).map((verb) => verb.inf).join(', ');
  const prata = find('prata'), ringa = find('ringa'), kopa = find('köpa'), hora = find('höra'), bo = find('bo'), springa = find('springa'), gaUt = find('gå ut');
  return [
    card('group-1', 'one', 'Group 1', 'The three endings?', '-ar -ade -at', prata, phrase(prata), `The infinitive + -r, -de and -t. ${of('ar')}…`),
    card('group-2', 'two', 'Group 2', 'The three endings?', '-er -de -t', ringa, phrase(ringa), `On the stem, the infinitive without -a: ${of('de')}…`),
    card('group-2-te', 'two', 'Group 2: -de or -te?', 'When is it -te?', 'after k, p, s, t', kopa, phrase(kopa), `A voiceless sound takes the voiceless t: ${of('te')}.`),
    card('group-2-r', 'two', 'Group 2 stems in r', 'The present?', 'the stem alone: hör, kör', hora, phrase(hora), `No -er after a stem in r: ${of('r-stem')}.`),
    card('group-3', 'three', 'Group 3', 'The three endings?', '-r -dde -tt', bo, phrase(bo), `Short verbs ending in a vowel other than -a: ${of('short')}.`),
    card('group-4', 'four', 'Group 4', 'What changes?', 'the past; the supine ends in -it', springa, phrase(springa), `Strong verbs add no ending in the past, and usually change the vowel: ${of('strong')}. The irregular ones are learnt one by one.`),
    card('supine', 'one', 'The supine', 'What goes before it?', 'har (or hade)', springa, [...(prata ? [`har ${prata.forms[2]}`] : []), ...(springa ? [`har ${springa.forms[2]}`] : [])], 'The supine makes the perfect with har (jag har sprungit) and the pluperfect with hade (jag hade sprungit), in every group.'),
    card('particles', 'four', 'Particle verbs', 'Where does the particle go?', 'after the verb, in every form', gaUt, phrase(gaUt), 'gå ut, gick ut, gått ut: the verb changes as it always does, the particle stays and takes the stress.'),
  ];
}
function ruleCandidates(verbs: SvVerb[], started: Set<string>, picked: SvVerb[] = verbs): RuleCard<SvTense>[] {
  const wanted = new Set(picked.map((verb) => verb.id));
  const cards = ruleCards(verbs);
  for (const verb of verbs) {
    if (!wanted.has(verb.id)) continue;
    const lean = started.has(verb.id) ? STARTED_LEAN : 1;
    const base = { inf: verb.inf, clue: verb.en, clueLang: 'en' as const, tense: verb.group, kind: verb.group, tenseName: SV_TENSE_NAMES[verb.group], examples: [keyPhrase(verb)], paradigm: paradigm(verb), rule: rule(verb) };
    cards.push({ ...base, id: `group:${verb.id}`, ask: 'Which group?', answer: `${SHORT[verb.group]} · ${GROUP_TITLES[verb.group][verb.kind]}`, value: lean * (VALUES[verb.kind] ?? 1) });
    const change = verb.kind === 'strong' ? vowels(verb) : null;
    if (change) cards.push({ ...base, id: `vowels:${verb.id}`, ask: 'The vowel change', answer: change, value: lean * 2 });
  }
  return cards;
}
function ruleDeck(verbs: SvVerb[], started: Set<string>, picked: SvVerb[] = verbs, tenses: readonly SvTense[] = SV_TENSES): RuleCard<SvTense>[] {
  const cards = ruleCandidates(verbs, started, picked).filter((card) => tenses.includes(card.tense));
  return [
    ...cards.filter((card) => card.kind === 'rule'),
    ...tenses.flatMap((tense) => cards.filter((card) => card.kind === tense).sort((left, right) => right.value - left.value).slice(0, CAPS[tense])),
  ];
}

export const SWEDISH: VerbGrammar<SvVerb, SvTense> = {
  tenses: SV_TENSES, tenseNames: SV_TENSE_NAMES, personLabels: SV_PERSON_LABELS, groupTitles: GROUP_TITLES, unit: 'group', wholeCards: true,
  // Swedish forms do not tell a tense or a number by ear the way French ones do; By ear stays French and Portuguese.
  earNeeds: 'By ear is not part of Swedish verbs.',
  earAskable: () => false,
  earQuestion: (): EarQuestion<SvTense> | null => null,
  earQuestions: (): EarQuestion<SvTense>[] => [],
  persons, conjugate, subject, isRight, accentSlip, diagnose, paradigm, rule, groupOf, tenseGuide, verbGuide, ruleDeck, ruleCandidates,
};
