// Brazilian Portuguese verbs for the Verbs room (lib/verb-grammar.ts): the presente, pretérito perfeito, pretérito
// imperfeito and the future Brazil speaks (ir + infinitive), for four persons. The engine's six person slots are kept
// where they mean the same thing: 0 eu, 2 você/ele/ela, 3 nós, 5 vocês/eles/elas; 1 and 4 (tu, vós) stay empty, as
// Brazilian usage drops them. The tables are content/pt/verbs.json, made by scripts/make-pt-verbs.ts from the rules and
// the irregular forms below, so a card can never teach a form the rules and the list don't give.
import { readFileSync } from 'node:fs';
import type { RuleCard } from './rule-cards';
import { litRows, type DrillVerb, type EarQuestion, type Form, type ParadigmRow, type VerbGrammar } from './verb-grammar';
import { normal } from './verbs';

export const PT_TENSES = ['pres', 'perf', 'imp', 'fut'] as const;
export type PtTense = typeof PT_TENSES[number];
type Four = [string, string, string, string];
type Written = 'pres' | 'perf' | 'imp';
export type PtTable = Record<Written, Four>;
// A reflexive verb (se divertir) and a phrase (sentir falta) are kept as their verb, base, with the rest after it.
export type PtVerb = DrillVerb & PtTable & { base: string; rest: string; reflexive: boolean };

export const PT_TENSE_NAMES: Record<PtTense, string> = { pres: 'presente', perf: 'pretérito perfeito', imp: 'pretérito imperfeito', fut: 'futuro com ir' };
export const PT_PERSON_LABELS = ['eu', 'tu', 'você / ele / ela', 'nós', 'vós', 'vocês / eles / elas'];
const PEOPLE = [0, 2, 3, 5];
// Where each person's form sits in a table of four.
const SLOT: Record<number, number> = { 0: 0, 2: 1, 3: 2, 5: 3 };
const SUBJECTS: Record<number, string> = { 0: 'eu', 2: 'ele', 3: 'nós', 5: 'eles' };
// Brazil puts the pronoun before the verb (eu me divirto) and before the infinitive (vou me divertir).
const PRONOUNS: Record<number, string> = { 0: 'me', 2: 'se', 3: 'nos', 5: 'se' };
const IR: Record<number, string> = { 0: 'vou', 2: 'vai', 3: 'vamos', 5: 'vão' };

// ── The tables: regular endings, spelling rules, and every irregular form ──
// Only the tenses a verb is irregular in; the rest follow the rules.
const IRREGULAR: Record<string, Partial<PtTable>> = {
  ser: { pres: ['sou', 'é', 'somos', 'são'], perf: ['fui', 'foi', 'fomos', 'foram'], imp: ['era', 'era', 'éramos', 'eram'] },
  estar: { pres: ['estou', 'está', 'estamos', 'estão'], perf: ['estive', 'esteve', 'estivemos', 'estiveram'] },
  ter: { pres: ['tenho', 'tem', 'temos', 'têm'], perf: ['tive', 'teve', 'tivemos', 'tiveram'], imp: ['tinha', 'tinha', 'tínhamos', 'tinham'] },
  ir: { pres: ['vou', 'vai', 'vamos', 'vão'], perf: ['fui', 'foi', 'fomos', 'foram'] },
  vir: { pres: ['venho', 'vem', 'vimos', 'vêm'], perf: ['vim', 'veio', 'viemos', 'vieram'], imp: ['vinha', 'vinha', 'vínhamos', 'vinham'] },
  pôr: { pres: ['ponho', 'põe', 'pomos', 'põem'], perf: ['pus', 'pôs', 'pusemos', 'puseram'], imp: ['punha', 'punha', 'púnhamos', 'punham'] },
  fazer: { pres: ['faço', 'faz', 'fazemos', 'fazem'], perf: ['fiz', 'fez', 'fizemos', 'fizeram'] },
  dizer: { pres: ['digo', 'diz', 'dizemos', 'dizem'], perf: ['disse', 'disse', 'dissemos', 'disseram'] },
  trazer: { pres: ['trago', 'traz', 'trazemos', 'trazem'], perf: ['trouxe', 'trouxe', 'trouxemos', 'trouxeram'] },
  querer: { pres: ['quero', 'quer', 'queremos', 'querem'], perf: ['quis', 'quis', 'quisemos', 'quiseram'] },
  poder: { pres: ['posso', 'pode', 'podemos', 'podem'], perf: ['pude', 'pôde', 'pudemos', 'puderam'] },
  saber: { pres: ['sei', 'sabe', 'sabemos', 'sabem'], perf: ['soube', 'soube', 'soubemos', 'souberam'] },
  ver: { pres: ['vejo', 'vê', 'vemos', 'veem'], perf: ['vi', 'viu', 'vimos', 'viram'] },
  dar: { pres: ['dou', 'dá', 'damos', 'dão'], perf: ['dei', 'deu', 'demos', 'deram'] },
  ler: { pres: ['leio', 'lê', 'lemos', 'leem'] },
  rir: { pres: ['rio', 'ri', 'rimos', 'riem'] },
  sorrir: { pres: ['sorrio', 'sorri', 'sorrimos', 'sorriem'] },
  sair: { pres: ['saio', 'sai', 'saímos', 'saem'], perf: ['saí', 'saiu', 'saímos', 'saíram'], imp: ['saía', 'saía', 'saíamos', 'saíam'] },
  cair: { pres: ['caio', 'cai', 'caímos', 'caem'], perf: ['caí', 'caiu', 'caímos', 'caíram'], imp: ['caía', 'caía', 'caíamos', 'caíam'] },
  ouvir: { pres: ['ouço', 'ouve', 'ouvimos', 'ouvem'] },
  pedir: { pres: ['peço', 'pede', 'pedimos', 'pedem'] },
  perder: { pres: ['perco', 'perde', 'perdemos', 'perdem'] },
  dormir: { pres: ['durmo', 'dorme', 'dormimos', 'dormem'] },
  subir: { pres: ['subo', 'sobe', 'subimos', 'sobem'] },
  odiar: { pres: ['odeio', 'odeia', 'odiamos', 'odeiam'] },
};
// -ir verbs whose e becomes i in eu alone (sinto, sente); -guir also drops the u there (sigo).
const E_TO_I = new Set(['sentir', 'preferir', 'vestir', 'repetir', 'seguir', 'conseguir', 'divertir', 'mentir', 'servir']);
const ENDINGS: Record<Written, Record<'ar' | 'er' | 'ir', string[]>> = {
  pres: { ar: ['o', 'a', 'amos', 'am'], er: ['o', 'e', 'emos', 'em'], ir: ['o', 'e', 'imos', 'em'] },
  perf: { ar: ['ei', 'ou', 'amos', 'aram'], er: ['i', 'eu', 'emos', 'eram'], ir: ['i', 'iu', 'imos', 'iram'] },
  imp: { ar: ['ava', 'ava', 'ávamos', 'avam'], er: ['ia', 'ia', 'íamos', 'iam'], ir: ['ia', 'ia', 'íamos', 'iam'] },
};
const kindOf = (base: string) => base.slice(-2) as 'ar' | 'er' | 'ir';
// The endings on the stem with nothing changed: what a learner who knows only the endings would say.
function plainTable(base: string): PtTable {
  const stem = base.slice(0, -2), kind = kindOf(base);
  return { pres: ENDINGS.pres[kind].map((end) => stem + end) as Four, perf: ENDINGS.perf[kind].map((end) => stem + end) as Four, imp: ENDINGS.imp[kind].map((end) => stem + end) as Four };
}
// The endings with the spelling rules that keep the stem's sound: eu conheço, protejo, sigo (presente) and fiquei,
// cheguei, comecei (perfeito).
function spelledTable(base: string): PtTable {
  const plain = plainTable(base), stem = base.slice(0, -2);
  const pres = [...plain.pres] as Four, perf = [...plain.perf] as Four;
  if (kindOf(base) !== 'ar') pres[0] = `${stem.replace(/c$/, 'ç').replace(/g$/, 'j').replace(/gu$/, 'g')}o`;
  else perf[0] = `${stem.replace(/c$/, 'qu').replace(/g$/, 'gu').replace(/ç$/, 'c')}ei`;
  return { ...plain, pres, perf };
}
export function ptTable(base: string): PtTable {
  if (!['ar', 'er', 'ir'].includes(kindOf(base)) && !IRREGULAR[base]) throw new Error(`${base} is not an -ar, -er or -ir verb and has no irregular table.`);
  const table = spelledTable(base);
  if (E_TO_I.has(base)) table.pres[0] = table.pres[0].replace(/e([^aeiou]*o)$/, 'i$1');
  return { ...table, ...IRREGULAR[base] };
}
// The verb a deck entry conjugates: se divertir → divertir, sentir falta → sentir.
export const ptBase = (text: string) => text.replace(/^se /, '').split(' ')[0]!;

// The deck's verbs with their tables, in vocabulary order. A table whose text no longer matches its word throws, so
// the file cannot drift from the deck unnoticed.
export function loadPtVerbs(file: string, words: { id: string; fr: string; en: string }[]): PtVerb[] {
  const tables = new Map((JSON.parse(readFileSync(file, 'utf8')) as (PtTable & { id: string; pt: string })[]).map((entry) => [entry.id, entry]));
  return words.flatMap((word) => {
    const table = tables.get(word.id);
    if (!table) return [];
    if (table.pt !== word.fr) throw new Error(`${file}: ${word.id} is "${table.pt}" but the deck says "${word.fr}"; run scripts/make-pt-verbs.ts.`);
    const reflexive = word.fr.startsWith('se '), base = ptBase(word.fr);
    const rest = word.fr.replace(/^se /, '').slice(base.length).trim();
    return [{ id: word.id, inf: word.fr, en: word.en, base, rest, reflexive, pres: table.pres, perf: table.perf, imp: table.imp }];
  });
}

// ── Forms, answers, mistakes ──
const persons = () => PEOPLE;
const subject = (person: number) => `${SUBJECTS[person]} `;
const pronoun = (verb: PtVerb, person: number) => verb.reflexive ? `${PRONOUNS[person]} ` : '';
const tail = (verb: PtVerb) => verb.rest ? ` ${verb.rest}` : '';
function conjugate(verb: PtVerb, tense: PtTense): (Form | null)[] {
  return [0, 1, 2, 3, 4, 5].map((person) => {
    if (!PEOPLE.includes(person)) return null;
    // ir's own future is its presente in speech (amanhã eu vou); vou ir is heard too, so it counts.
    if (tense === 'fut' && verb.base === 'ir' && !verb.rest) return { shown: IR[person]!, accepted: [IR[person]!, `${IR[person]} ir`] };
    const form = tense === 'fut' ? `${IR[person]} ${pronoun(verb, person)}${verb.base}${tail(verb)}` : `${pronoun(verb, person)}${verb[tense][SLOT[person]!]}${tail(verb)}`;
    return { shown: form, accepted: [form] };
  });
}
const strip = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '');
const SUBJECT = /^(eu|você|ele|ela|nós|vocês|eles|elas) /;
function readings(given: string): string[] {
  const typed = normal(given);
  const bare = typed.replace(SUBJECT, '');
  return bare === typed ? [typed] : [typed, bare];
}
// Accents are not required, as in French: the right letters count, and accentSlip says the accents were off.
const sameLetters = (form: Form, reading: string) => form.accepted.some((right) => strip(right) === strip(reading));
const isRight = (form: Form, given: string) => readings(given).some((reading) => sameLetters(form, reading));
const accentSlip = (form: Form, given: string) => isRight(form, given) && !readings(given).some((reading) => form.accepted.includes(reading));

function diagnose(verb: PtVerb, tense: PtTense, person: number, given: string): string {
  const typed = readings(given).map(strip);
  const is = (text: string) => typed.includes(strip(text));
  const all = conjugate(verb, tense);
  const right = all[person]!.accepted[0]!;
  for (const other of PEOPLE) if (other !== person && all[other]!.accepted.some(is)) return `That’s the ${PT_PERSON_LABELS[other]} form.`;
  for (const other of PT_TENSES) if (other !== tense && conjugate(verb, other)[person]!.accepted.some(is)) return `That’s the ${PT_TENSE_NAMES[other]}.`;
  const said = subject(person) + right;
  if (verb.reflexive && is(right.replace(/^(me|se|nos) /, ''))) return `${verb.inf} is reflexive: its pronoun comes before the verb (${said}).`;
  if (verb.rest && is(right.slice(0, -tail(verb).length))) return `Keep the whole phrase: ${said}.`;
  if (tense === 'fut') {
    const helper = IR[person]!;
    if (typed.some((reading) => reading.startsWith(`${strip(helper)} `))) return `After ${helper}, the verb stays in the infinitive: ${said}.`;
    const stem = { fazer: 'far', dizer: 'dir', trazer: 'trar' }[verb.base] ?? verb.base;
    if (is(`${pronoun(verb, person)}${stem}${['ei', 'á', 'emos', 'ão'][SLOT[person]!]}${tail(verb)}`)) return `That’s the written future; in speech Brazil says ${said}.`;
    return '';
  }
  if (verb.base === 'pôr') return '';
  const slot = SLOT[person]!, kind = kindOf(verb.base);
  const plain = plainTable(verb.base), spelled = spelledTable(verb.base);
  const withVerb = (form: string) => `${pronoun(verb, person)}${form}${tail(verb)}`;
  if (spelled[tense][slot] !== plain[tense][slot] && is(withVerb(plain[tense][slot]))) {
    return tense === 'perf' ? `Before -ei the stem keeps its sound: c becomes qu, g becomes gu, ç becomes c (${said}).` : `Before -o the stem keeps its sound: c becomes ç, g becomes j, gu becomes g${E_TO_I.has(verb.base) ? '; here e also becomes i' : ''} (${said}).`;
  }
  if (verb[tense][slot] !== spelled[tense][slot] && is(withVerb(spelled[tense][slot]))) {
    const onlyEu = groupOf(verb, tense) === 'eu-change';
    return onlyEu ? `Only eu changes its stem here: ${said} (ele ${verb.pres[1]}${tail(verb)}).` : `${verb.base} is irregular in the ${PT_TENSE_NAMES[tense]}: ${said}.`;
  }
  const stem = verb.base.slice(0, -2);
  const wrong = (other: 'ar' | 'er' | 'ir') => other !== kind && is(withVerb(stem + ENDINGS[tense][other][slot]));
  if (tense === 'pres' && person === 5 && (wrong('ar') || wrong('er'))) return kind === 'ar' ? `-ar verbs end in -am for eles: ${said}.` : `-er and -ir verbs end in -em for eles: ${said}.`;
  if (tense === 'imp' && (wrong('ar') || wrong('er'))) return kind === 'ar' ? `-ar verbs take -ava in the imperfeito: ${said}.` : `-er and -ir verbs take -ia in the imperfeito: ${said}.`;
  if (tense === 'perf' && person === 2 && (wrong('ar') || wrong('er') || wrong('ir'))) return `For ele, -ar verbs end in -ou, -er verbs in -eu, -ir verbs in -iu: ${said}.`;
  return '';
}

// ── Tables, rules, groups ──
function paradigm(verb: PtVerb, tense: PtTense): ParadigmRow[] {
  // In the future the helper is what changes from person to person, so it is the part lit.
  if (tense === 'fut') return PEOPLE.map((person) => {
    const form = conjugate(verb, 'fut')[person]!.shown, helper = IR[person]!;
    return { person, label: PT_PERSON_LABELS[person]!, parts: [{ text: subject(person) }, { text: helper, lit: true }, ...(form.length > helper.length ? [{ text: form.slice(helper.length) }] : [])] };
  });
  return litRows(PEOPLE, PT_PERSON_LABELS, PEOPLE.map((person) => verb[tense][SLOT[person]!]), (person) => subject(person) + pronoun(verb, person), verb.rest);
}

export function groupOf(verb: PtVerb, tense: PtTense): string {
  if (tense === 'fut') return verb.base === 'ir' && !verb.rest ? 'ir' : verb.reflexive ? 'reflexive' : 'regular';
  if (verb.base === 'pôr') return 'irregular';
  const kind = kindOf(verb.base), plain = plainTable(verb.base), spelled = spelledTable(verb.base);
  const forms = verb[tense].join();
  const regular = forms === plain[tense].join() ? (tense === 'imp' && kind !== 'ar' ? 'er-ir' : kind) : null;
  if (regular) return regular;
  if (forms === spelled[tense].join()) return 'spelling';
  if (strip(forms) === strip(plain[tense].join())) return 'accent';
  // Only eu changes, and it still ends in -o (durmo, posso); saber's sei is irregular.
  if (tense === 'pres' && verb.pres[0].endsWith('o') && verb.pres.slice(1).join() === plain.pres.slice(1).join()) return 'eu-change';
  return 'irregular';
}

const said = (verb: PtVerb, tense: PtTense, person: number) => subject(person) + conjugate(verb, tense)[person]!.shown;
const REFLEXIVE_NOTE = ' As a reflexive verb it keeps its pronoun before the verb: me, se, nos, se.';
function rule(verb: PtVerb, tense: PtTense): string {
  const group = groupOf(verb, tense);
  const reflexive = verb.reflexive ? REFLEXIVE_NOTE : '';
  const stem = `${verb.base.slice(0, -2)}-`;
  if (tense === 'pres') {
    const text = group === 'ar' ? `-ar verbs: -o, -a, -amos, -am on the stem (${stem}).`
      : group === 'er' ? `-er verbs: -o, -e, -emos, -em on the stem (${stem}).`
      : group === 'ir' ? `-ir verbs: -o, -e, -imos, -em on the stem (${stem}). Only nós differs from -er verbs.`
      : group === 'spelling' ? `Regular, but eu keeps the stem’s sound before -o: ${said(verb, 'pres', 0)}, ${said(verb, 'pres', 2)}.`
      : group === 'eu-change' ? `Regular endings, but the stem changes in eu alone: ${said(verb, 'pres', 0)}, ${said(verb, 'pres', 2)}.`
      : `${verb.base} is irregular in the presente: worth learning as a whole table (${said(verb, 'pres', 0)}, ${said(verb, 'pres', 2)}, ${said(verb, 'pres', 5)}).`;
    return text + reflexive;
  }
  if (tense === 'perf') {
    const same = ' nós is the same as in the presente; the rest of the sentence tells them apart.';
    const text = group === 'ar' ? `-ar verbs: -ei, -ou, -amos, -aram.${same}`
      : group === 'er' ? `-er verbs: -i, -eu, -emos, -eram.${same}`
      : group === 'ir' ? `-ir verbs: -i, -iu, -imos, -iram.${same}`
      : group === 'spelling' ? `Regular, but eu keeps the stem’s sound before -ei (c → qu, g → gu, ç → c): ${said(verb, 'perf', 0)}, ${said(verb, 'perf', 2)}.`
      : group === 'accent' ? `Regular, with an accent that keeps the i apart: ${said(verb, 'perf', 0)}, ${said(verb, 'perf', 3)}.`
      : `${verb.base} is irregular in the pretérito perfeito: ${said(verb, 'perf', 0)}, ${said(verb, 'perf', 2)}, ${said(verb, 'perf', 5)}.${['ser', 'ir'].includes(verb.base) ? ' ser and ir share it.' : ''}`;
    return text + reflexive;
  }
  if (tense === 'imp') {
    const text = group === 'ar' ? `-ar verbs: -ava, -ava, -ávamos, -avam on the stem (${stem}).`
      : group === 'er-ir' ? `-er and -ir verbs: -ia, -ia, -íamos, -iam ${stem === '-' ? `with no stem before them: ${said(verb, 'imp', 0)}, ${said(verb, 'imp', 3)}` : `on the stem (${stem})`}.`
      : group === 'accent' ? `-ia endings, with an accent that keeps the i apart: ${said(verb, 'imp', 0)}, ${said(verb, 'imp', 3)}.`
      : `One of only four irregular imperfeitos (ser, ter, vir, pôr): ${said(verb, 'imp', 0)}, ${said(verb, 'imp', 3)}.`;
    return text + reflexive;
  }
  if (group === 'ir') return 'For ir itself the presente already says it: amanhã eu vou. Vou ir is heard in speech too.';
  if (group === 'reflexive') return `ir in the presente, then the pronoun and the infinitive: ${said(verb, 'fut', 0)}, ${said(verb, 'fut', 2)}.`;
  return `ir in the presente (vou, vai, vamos, vão), then the infinitive, which never changes: ${said(verb, 'fut', 0)}.`;
}

type Group = { id: string; title: string; text: string; many?: true; detail: (verb: PtVerb) => string };
const GROUPS: Record<PtTense, Group[]> = {
  pres: [
    { id: 'irregular', title: 'Irregular', text: 'These follow no pattern in the presente, so each is worth learning as a whole table. Many are the most common verbs.', detail: (verb) => [0, 2, 5].map((person) => said(verb, 'pres', person)).join(', ') },
    { id: 'eu-change', title: 'Only eu changes', text: 'Regular endings, but the stem changes in eu alone: eu durmo, ele dorme; eu peço, ele pede.', detail: (verb) => `${said(verb, 'pres', 0)}, ${said(verb, 'pres', 2)}` },
    { id: 'spelling', title: 'A spelling change in eu', text: 'Before -o the stem keeps its sound: c becomes ç (conheço), g becomes j (protejo), gu becomes g (sigo).', detail: (verb) => said(verb, 'pres', 0) },
    { id: 'ar', title: 'Regular -ar', text: '-o, -a, -amos, -am on the stem (the infinitive without -ar).', many: true, detail: () => '' },
    { id: 'er', title: 'Regular -er', text: '-o, -e, -emos, -em.', many: true, detail: () => '' },
    { id: 'ir', title: 'Regular -ir', text: '-o, -e, -imos, -em: only nós differs from -er verbs.', many: true, detail: () => '' },
  ],
  perf: [
    { id: 'irregular', title: 'Irregular', text: 'A stem of their own, and eu and ele often without the usual endings: fiz, fez; tive, teve. ser and ir share theirs: fui, foi.', detail: (verb) => `${said(verb, 'perf', 0)}, ${said(verb, 'perf', 2)}` },
    { id: 'spelling', title: '-car, -gar, -çar', text: 'Regular, but eu keeps the sound before -ei: fiquei, cheguei, comecei.', detail: (verb) => said(verb, 'perf', 0) },
    { id: 'accent', title: 'An accent on the i', text: 'Verbs in -air keep the i apart with an accent: saí, saímos.', detail: (verb) => `${said(verb, 'perf', 0)}, ${said(verb, 'perf', 3)}` },
    { id: 'ar', title: 'Regular -ar', text: '-ei, -ou, -amos, -aram. nós is the same as in the presente.', many: true, detail: () => '' },
    { id: 'er', title: 'Regular -er', text: '-i, -eu, -emos, -eram. nós is the same as in the presente.', many: true, detail: () => '' },
    { id: 'ir', title: 'Regular -ir', text: '-i, -iu, -imos, -iram. nós is the same as in the presente.', many: true, detail: () => '' },
  ],
  imp: [
    { id: 'irregular', title: 'The four irregular ones', text: 'Only ser, ter, vir and pôr: eu era, eu tinha, eu vinha, eu punha.', detail: (verb) => `${said(verb, 'imp', 0)}, ${said(verb, 'imp', 3)}` },
    { id: 'accent', title: 'An accent on the i', text: 'Verbs in -air keep the i apart with an accent: saía, saíamos.', detail: (verb) => said(verb, 'imp', 0) },
    { id: 'ar', title: '-ar verbs', text: '-ava, -ava, -ávamos, -avam on the stem.', many: true, detail: () => '' },
    { id: 'er-ir', title: '-er and -ir verbs', text: '-ia, -ia, -íamos, -iam on the stem.', many: true, detail: () => '' },
  ],
  fut: [
    { id: 'ir', title: 'ir itself', text: 'The presente already says it: amanhã eu vou. Vou ir is heard in speech too.', detail: (verb) => said(verb, 'fut', 0) },
    { id: 'reflexive', title: 'Reflexive verbs', text: 'The pronoun goes before the infinitive: vou me divertir.', detail: (verb) => said(verb, 'fut', 0) },
    { id: 'regular', title: 'Every other verb', text: 'vou, vai, vamos, vão and the infinitive, which never changes.', many: true, detail: () => '' },
  ],
};
const GROUP_TITLES = Object.fromEntries(PT_TENSES.map((tense) => [tense, Object.fromEntries(GROUPS[tense].map((group) => [group.id, group.title]))])) as Record<PtTense, Record<string, string>>;
const MODELS: Record<PtTense, string[]> = { pres: ['falar', 'comer', 'abrir'], perf: ['falar', 'comer', 'abrir'], imp: ['falar', 'comer', 'ser'], fut: ['falar', 'fazer', 'ir'] };
const TENSE_USES: Record<PtTense, string> = {
  pres: 'What is happening now, what is generally true, and what you usually do.',
  perf: 'A finished action in the past, what happened: ontem eu falei com ela.',
  imp: 'The past as background: how things were, what used to happen, what was going on when something else happened.',
  fut: 'What is going to happen, as Brazil says it: ir in the presente, then the infinitive.',
};
function tenseGuide(verbs: PtVerb[], tense: PtTense) {
  const models = MODELS[tense].flatMap((inf) => { const verb = verbs.find((entry) => entry.inf === inf); return verb ? [{ id: verb.id, inf: verb.inf, paradigm: paradigm(verb, tense) }] : []; });
  const groups = GROUPS[tense].map((group) => ({
    id: group.id, title: group.title, text: group.text, ...(group.many ? { many: true as const } : {}),
    verbs: verbs.filter((verb) => groupOf(verb, tense) === group.id).map((verb) => ({ id: verb.id, inf: verb.inf, detail: group.detail(verb) })).sort((a, b) => a.inf.localeCompare(b.inf, 'pt')),
  })).filter((group) => group.verbs.length);
  return { tense, name: PT_TENSE_NAMES[tense], use: TENSE_USES[tense], models, groups };
}
function verbGuide(verb: PtVerb) {
  return {
    id: verb.id, inf: verb.inf, en: verb.en,
    tenses: PT_TENSES.map((tense) => ({ tense, name: PT_TENSE_NAMES[tense], group: GROUP_TITLES[tense][groupOf(verb, tense)]!, rule: rule(verb, tense), paradigm: paradigm(verb, tense) })),
  };
}

// ── By ear: which tense is it? Asked for eu and nós, never where two of the tenses offered sound the same (nós
// falamos is presente and perfeito alike; ir's future is its presente). Portuguese says one person or more out
// loud (fala, falam), so the number question French asks has nothing to train here.
const CUES: Record<PtTense, string> = {
  pres: 'the presente', perf: 'the pretérito perfeito: a finished action', imp: 'the imperfeito: listen for -ava or -ia', fut: 'the future: vou, vai, vamos or vão, then the infinitive',
};
function earQuestion(verb: PtVerb, tense: PtTense, person: number, kind: string, tenses: readonly PtTense[] = PT_TENSES): EarQuestion<PtTense> | null {
  if (kind !== 'tense' || !PEOPLE.includes(person)) return null;
  const offered = PT_TENSES.filter((entry) => tenses.includes(entry));
  if (offered.length < 2 || !offered.includes(tense)) return null;
  const heard = subject(person) + conjugate(verb, tense)[person]!.accepted[0];
  if (offered.some((other) => other !== tense && strip(subject(person) + conjugate(verb, other)[person]!.accepted[0]) === strip(heard))) return null;
  const cue = tense === 'imp' && groupOf(verb, 'imp') === 'irregular' ? 'the imperfeito: one of the four irregular ones (era, tinha, vinha, punha)' : CUES[tense];
  return { id: `${verb.id}~${tense}~${person}~tense`, verbId: verb.id, tense, person, kind: 'tense', said: heard, question: 'Which tense?', choices: offered.map((entry) => PT_TENSE_NAMES[entry]), answer: offered.indexOf(tense), why: `${heard}: ${cue}.` };
}
function earQuestions(verb: PtVerb, tenses: readonly PtTense[] = PT_TENSES): EarQuestion<PtTense>[] {
  return PT_TENSES.flatMap((tense) => [0, 3].flatMap((person) => { const question = earQuestion(verb, tense, person, 'tense', tenses); return question ? [question] : []; }));
}

// ── How it's built: per verb, the forms each tense is built on; and the rules themselves ──
const CAPS: Record<PtTense, number> = { pres: 40, perf: 40, imp: 25, fut: 0 };
const STARTED_LEAN = 1.5;
const COMMON = 20;
const list = (items: string[], most = 8) => items.slice(0, most).join(', ') + (items.length > most ? ` and ${items.length - most} more` : '');
const VALUES: Record<string, number> = { irregular: 3, 'eu-change': 2.5, spelling: 1.8, accent: 1.5, ar: 0.5, er: 0.7, ir: 0.7, 'er-ir': 0.7 };
function verbCard(verb: PtVerb, tense: Written, ask: string, people: [number, number], examples: number[], lean: number): RuleCard<PtTense> {
  return {
    id: `${tense}:${verb.id}`, kind: tense, tense, ask, inf: verb.inf, clue: verb.en, clueLang: 'en',
    answer: people.map((person) => said(verb, tense, person)).join(' · '), tenseName: PT_TENSE_NAMES[tense],
    examples: examples.map((person) => said(verb, tense, person)), paradigm: paradigm(verb, tense), rule: rule(verb, tense),
    value: lean * (VALUES[groupOf(verb, tense)] ?? 1),
  };
}
function ruleCards(verbs: PtVerb[], common: PtVerb[]): RuleCard<PtTense>[] {
  const find = (inf: string) => verbs.find((verb) => verb.inf === inf);
  const card = (id: string, tense: PtTense, ask: string, clue: string, answer: string, model: PtVerb | undefined, examples: string[], text: string): RuleCard<PtTense> => ({
    id: `rule:${id}`, kind: 'rule', tense, ask, inf: PT_TENSE_NAMES[tense], clue, clueLang: 'en', answer, tenseName: PT_TENSE_NAMES[tense],
    examples, paradigm: model ? paradigm(model, tense) : [], rule: text, value: 3,
  });
  const forms = (verb: PtVerb | undefined, tense: PtTense, people: number[]) => verb ? people.map((person) => said(verb, tense, person)) : [];
  const falar = find('falar'), comer = find('comer'), abrir = find('abrir'), ficar = find('ficar'), chegar = find('chegar'), ser = find('ser'), ter = find('ter');
  const euChange = common.filter((verb) => groupOf(verb, 'pres') === 'eu-change').map((verb) => said(verb, 'pres', 0));
  const irregularPerf = [...new Set(common.filter((verb) => groupOf(verb, 'perf') === 'irregular' && !['ser', 'ir'].includes(verb.base)).map((verb) => said(verb, 'perf', 0)))];
  const spelling = verbs.filter((verb) => groupOf(verb, 'perf') === 'spelling').map((verb) => said(verb, 'perf', 0));
  return [
    card('pres-ar', 'pres', 'Presente of -ar verbs', 'The four endings?', '-o -a -amos -am', falar, forms(falar, 'pres', [0, 2, 5]), 'Every regular -ar verb takes them on its stem, the infinitive without -ar.'),
    card('pres-er', 'pres', 'Presente of -er verbs', 'The four endings?', '-o -e -emos -em', comer, forms(comer, 'pres', [0, 2, 5]), 'Like -ar, with e where -ar has a: come, comemos, comem.'),
    card('pres-ir', 'pres', 'Presente of -ir verbs', 'The four endings?', '-o -e -imos -em', abrir, forms(abrir, 'pres', [0, 3, 5]), 'The same as -er but for nós: abrimos, comemos.'),
    card('pres-eu', 'pres', 'Presente stems', 'Which person changes the most?', 'eu', undefined, [],
      `Many verbs change only in eu${euChange.length ? `: ${list(euChange, 10)}` : ''}; the other persons keep the infinitive’s stem. ser, estar, ir and vir change throughout.`),
    card('perf-ar', 'perf', 'Perfeito of -ar verbs', 'The four endings?', '-ei -ou -amos -aram', falar, forms(falar, 'perf', [0, 2, 5]), 'nós falamos is the same as in the presente; ontem or the rest of the sentence tells them apart.'),
    card('perf-er', 'perf', 'Perfeito of -er verbs', 'The four endings?', '-i -eu -emos -eram', comer, forms(comer, 'perf', [0, 2, 5]), 'The ele form ends in -eu: comeu, bebeu, escreveu. nós comemos is the same as in the presente.'),
    card('perf-ir', 'perf', 'Perfeito of -ir verbs', 'The four endings?', '-i -iu -imos -iram', abrir, forms(abrir, 'perf', [0, 2, 5]), 'The ele form ends in -iu: abriu, partiu, dormiu.'),
    card('perf-spelling', 'perf', '-car, -gar, -çar', 'What happens in eu?', 'c → qu · g → gu · ç → c', ficar ?? chegar, [...forms(ficar, 'perf', [0]), ...forms(chegar, 'perf', [0])],
      `Before -ei the stem keeps its sound${spelling.length ? `: ${list(spelling, 10)}` : ''}. Every other person is regular: ficou, chegou.`),
    card('perf-ser-ir', 'perf', 'ser and ir', 'Their perfeito?', 'the same: fui, foi, fomos, foram', ser, forms(ser, 'perf', [0, 2, 5]),
      `Only the sentence tells them apart: fui ao Rio (went), fui feliz (was).${irregularPerf.length ? ` The common irregular ones: ${list(irregularPerf, 10)}.` : ''}`),
    card('imp-ar', 'imp', 'Imperfeito of -ar verbs', 'The four endings?', '-ava -ava -ávamos -avam', falar, forms(falar, 'imp', [0, 3, 5]), 'eu and ele are the same: eu falava, ele falava. nós takes an accent.'),
    card('imp-er', 'imp', 'Imperfeito of -er and -ir', 'The four endings?', '-ia -ia -íamos -iam', comer, forms(comer, 'imp', [0, 3, 5]), '-er and -ir verbs share them: comia, abria. nós takes an accent.'),
    card('imp-irregular', 'imp', 'Irregular imperfeitos', 'How many are there?', 'four: ser, ter, vir, pôr', ser ?? ter, [...forms(ser, 'imp', [0]), ...forms(ter, 'imp', [0])], 'eu era, eu tinha, eu vinha, eu punha. Every other verb is regular in the imperfeito.'),
    card('fut-ir', 'fut', 'The future in speech', 'How is it built?', 'ir + the infinitive', falar, forms(falar, 'fut', [0, 2, 5]), 'vou, vai, vamos, vão, then the infinitive, which never changes. The written future (falarei) is rare in speech.'),
  ];
}
// A phrase built on a verb in the deck (fazer compras, with fazer) is drilled through that verb, so it gets no cards
// of its own.
function ruleCandidates(verbs: PtVerb[], started: Set<string>, picked: PtVerb[] = verbs): RuleCard<PtTense>[] {
  const bases = new Set(verbs.filter((verb) => !verb.rest).map((verb) => verb.base));
  const usable = verbs.filter((verb) => !verb.rest || !bases.has(verb.base));
  const wanted = new Set(picked.map((verb) => verb.base));
  const common = new Set(verbs.slice(0, COMMON).map((verb) => verb.id));
  const cards = ruleCards(usable, usable.filter((verb) => common.has(verb.id)));
  for (const verb of usable) {
    if (!wanted.has(verb.base)) continue;
    const lean = started.has(verb.id) ? STARTED_LEAN : 1;
    cards.push(verbCard(verb, 'pres', 'Presente: eu and ele', [0, 2], [0, 2, 5], lean), verbCard(verb, 'perf', 'Perfeito: eu and ele', [0, 2], [0, 2, 5], lean), verbCard(verb, 'imp', 'Imperfeito: eu and nós', [0, 3], [0, 3, 5], lean));
  }
  return cards;
}
function ruleDeck(verbs: PtVerb[], started: Set<string>, picked: PtVerb[] = verbs, tenses: readonly PtTense[] = PT_TENSES): RuleCard<PtTense>[] {
  const cards = ruleCandidates(verbs, started, picked).filter((card) => tenses.includes(card.tense));
  return [
    ...cards.filter((card) => card.kind === 'rule'),
    ...tenses.flatMap((tense) => cards.filter((card) => card.kind === tense).sort((left, right) => right.value - left.value).slice(0, CAPS[tense])),
  ];
}

export const PORTUGUESE: VerbGrammar<PtVerb, PtTense> = {
  tenses: PT_TENSES, tenseNames: PT_TENSE_NAMES, personLabels: PT_PERSON_LABELS, groupTitles: GROUP_TITLES, unit: 'tense',
  earNeeds: 'By ear asks which tense you hear, so it needs two tenses. Add one on the Practising line.',
  earAskable: (tenses) => tenses.length >= 2,
  persons, conjugate, subject, isRight, accentSlip, diagnose, paradigm, rule, groupOf, earQuestion, earQuestions, tenseGuide, verbGuide, ruleDeck, ruleCandidates,
};
