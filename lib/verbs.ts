// Verbs: the conjugation tables behind the Verbs room. Claude (Opus) writes each vocabulary verb's présent,
// imparfait, futur stem, participle and helper (createVerbTables, in the background, a batch at a time); verbProblems
// checks every table against the rules French is regular about before it is kept. Everything else is built here:
// the four tenses, reflexive pronouns, participle agreement, what counts as a right answer, which mistake a wrong
// one was, and the questions of the By ear drill.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Ask } from './claude';

export const TENSES = ['pres', 'pc', 'imp', 'fut'] as const;
export type Tense = typeof TENSES[number];
export const TENSE_NAMES: Record<Tense, string> = { pres: 'présent', pc: 'passé composé', imp: 'imparfait', fut: 'futur' };
export const PERSON_LABELS = ['je', 'tu', 'il / elle', 'nous', 'vous', 'ils / elles'];
const SUBJECTS = ['je', 'tu', 'il', 'nous', 'vous', 'ils'];

// As Claude writes it. A reflexive verb (se laisser) is written as its base verb, without the pronoun; a verb used
// only with il (falloir) has one présent and one imparfait form.
export type VerbTable = { id: string; pres: string[]; imp: string[]; fut: string; pp: string; aux: 'avoir' | 'être' };
export type Verb = VerbTable & { inf: string; en: string; base: string; reflexive: boolean; impersonal: boolean };
export type VerbWord = { id: string; fr: string; en: string };
// One person's form: how it is shown, and every answer accepted for it (participle agreements), without the subject.
export type Form = { shown: string; accepted: string[] };
export type ParadigmRow = { person: number; label: string; parts: { text: string; lit?: true }[] };

const REFLEXIVE = /^(se |s’|s')/;
const IMP_END = ['ais', 'ais', 'ait', 'ions', 'iez', 'aient'];
const FUT_END = ['ai', 'as', 'a', 'ons', 'ez', 'ont'];
const AUX: Record<'avoir' | 'être', string[]> = { avoir: ['ai', 'as', 'a', 'avons', 'avez', 'ont'], 'être': ['suis', 'es', 'est', 'sommes', 'êtes', 'sont'] };
const LETTERS = /^[a-zàâäçéèêëîïôöùûüÿœæ]+$/;
export const startsVowel = (word: string) => /^[aàâäeéèêëiîïoôöuùûüyœæh]/.test(word);
export const isVerbWord = (word: { en: string }) => /^to /.test(word.en);

export function verbOf(table: VerbTable, word: VerbWord): Verb {
  const inf = word.fr.replace(/'/g, '’');
  return { ...table, inf, en: word.en, base: inf.replace(REFLEXIVE, ''), reflexive: REFLEXIVE.test(inf), impersonal: table.pres.length === 1 };
}
export const persons = (verb: Verb) => verb.impersonal ? [2] : [0, 1, 2, 3, 4, 5];

// The imparfait as the rule builds it: the nous présent without -ons (être: ét-), and the -ge / -ç that keep a soft
// g or c before a and o dropped before i (mangeais, mangions; commençais, commencions).
export function derivedImparfait(nous: string, base: string): string[] {
  const stem = base === 'être' ? 'ét' : nous.replace(/ons$/, '');
  return IMP_END.map((ending) => (ending.startsWith('i') ? stem.replace(/ge$/, 'g').replace(/ç$/, 'c') : stem) + ending);
}

function pronoun(person: number, next: string): string {
  const full = ['me', 'te', 'se', 'nous', 'vous', 'se'][person]!;
  return person !== 3 && person !== 4 && startsVowel(next) ? `${full[0]}’` : `${full} `;
}
// The subject as said before a form: j’ before a vowel.
export function subject(person: number, form: string): string {
  return person === 0 && startsVowel(form) ? 'j’' : `${SUBJECTS[person]} `;
}

function simpleForm(verb: Verb, tense: Exclude<Tense, 'pc'>, person: number): string {
  if (tense === 'pres') return verb.impersonal ? verb.pres[0]! : verb.pres[person]!;
  if (tense === 'imp') return verb.impersonal ? verb.imp[0]! : verb.imp[person]!;
  return verb.fut + FUT_END[person]!;
}

// The six forms of a tense (null where the verb has no such person).
export function conjugate(verb: Verb, tense: Tense): (Form | null)[] {
  return [0, 1, 2, 3, 4, 5].map((person) => {
    if (verb.impersonal && person !== 2) return null;
    if (tense !== 'pc') {
      const simple = simpleForm(verb, tense, person);
      const form = (verb.reflexive ? pronoun(person, simple) : '') + simple;
      return { shown: form, accepted: [form] };
    }
    const helper = verb.reflexive ? 'être' : verb.aux;
    const aux = AUX[helper][person]!;
    const lead = `${verb.reflexive ? pronoun(person, aux) : ''}${aux} `;
    if (helper === 'avoir') return { shown: lead + verb.pp, accepted: [lead + verb.pp] };
    // With être the participle agrees with the subject; a participle ending in -s (mis) takes no second -s.
    const plural = (ending: string) => verb.pp.endsWith('s') ? ending.replace(/^s/, '') : ending;
    const endings = person === 4 ? ['', 'e', plural('s'), plural('es')] : person > 2 ? [plural('s'), plural('es')] : ['', 'e'];
    const shown = person === 4 ? `${verb.pp}(e)(s)` : person > 2 ? (verb.pp.endsWith('s') ? `${verb.pp}(es)` : `${verb.pp}(e)s`) : `${verb.pp}(e)`;
    return { shown: lead + shown, accepted: [...new Set(endings.map((ending) => lead + verb.pp + ending))] };
  });
}

export const normal = (value: string) => value.normalize('NFC').toLowerCase().replace(/[’'`]/g, '’').replace(/’\s+/g, '’').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
const strip = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '');
const SUBJECT = /^(j’|je |tu |il |elle |on |nous |vous |ils |elles )/;
// What was typed, as given and without a subject pronoun in front: "nous nous levons" and "nous levons" both count.
function readings(given: string): string[] {
  const typed = normal(given);
  const bare = typed.replace(SUBJECT, '');
  return bare === typed ? [typed] : [typed, bare];
}
// Accents are not required: the right letters with a missing or wrong accent count, and accentSlip says so.
const sameLetters = (form: Form, reading: string) => form.accepted.some((right) => strip(right) === strip(reading));
export const isRight = (form: Form, given: string) => readings(given).some((reading) => sameLetters(form, reading));
export const accentSlip = (form: Form, given: string) => isRight(form, given) && !readings(given).some((reading) => form.accepted.includes(reading));

// Which mistake a wrong answer was, in one sentence, or '' when it is none Echo can name.
export function diagnose(verb: Verb, tense: Tense, person: number, given: string): string {
  const typed = readings(given);
  const matches = (form: Form | null) => !!form && typed.some((reading) => sameLetters(form, reading));
  const all = conjugate(verb, tense);
  const target = all[person]!;
  for (const other of persons(verb)) if (other !== person && matches(all[other]!)) return `That’s the ${PERSON_LABELS[other]} form.`;
  for (const other of TENSES) if (other !== tense && matches(conjugate(verb, other)[person]!)) return `That’s the ${TENSE_NAMES[other]}.`;
  for (const right of target.accepted) {
    for (const reading of typed) {
      for (let at = 1; at < right.length; at++) if (right[at] === right[at - 1] && right.slice(0, at) + right.slice(at + 1) === reading) return `The ${right[at]} doubles here: ${right}.`;
      for (let at = 1; at < reading.length; at++) if (reading[at] === reading[at - 1] && reading.slice(0, at) + reading.slice(at + 1) === right) return `Only one ${right[at - 1]} here: ${right}.`;
      if (right.replace(/ge([ao])/, 'g$1') === reading && right !== reading) return `Keep the e after the g before a or o: ${right}.`;
      if (right.replace(/ç/, 'c') === reading && right !== reading) return `The c takes a cedilla before a or o: ${right}.`;
      if (verb.reflexive && right.replace(/^(me |te |se |nous |vous |m’|t’|s’)/, '') === reading) return `${verb.inf} is reflexive: its pronoun comes before the verb (${subject(person, right)}${right}).`;
    }
  }
  if (tense === 'pc') {
    const helper = verb.reflexive ? 'être' : verb.aux;
    const other = helper === 'être' ? 'avoir' : 'être';
    if (typed.some((reading) => reading.startsWith(`${AUX[other][person]} `))) return `${verb.inf} goes with ${helper} in the passé composé, not ${other}.`;
    if (helper === 'être') {
      const lead = target.accepted[0]!.slice(0, target.accepted[0]!.lastIndexOf(' ') + 1);
      const agreed = typed.find((reading) => reading.startsWith(lead) && reading.slice(lead.length).replace(/e?s?$/, '') === verb.pp.replace(/s$/, '').replace(/e?s?$/, ''));
      if (agreed) return person > 2 ? 'More than one person: the participle takes -s.' : 'One person: no -s on the participle.';
    }
  }
  if (tense === 'pres' && person === 5 && verb.base.endsWith('er') && verb.base !== 'aller' && typed.some((reading) => reading.endsWith('ont'))) return 'Only a few verbs end in -ont (sont, ont, vont, font); -er verbs take -ent.';
  return '';
}

// The whole tense, each form split so its ending can be lit: the part every person shares, then the ending. In the
// passé composé the helper is what changes, so it is the part lit.
export function paradigm(verb: Verb, tense: Tense): ParadigmRow[] {
  const all = conjugate(verb, tense);
  const people = persons(verb);
  if (tense === 'pc') {
    return people.map((person) => {
      const form = all[person]!.shown;
      const space = form.lastIndexOf(' ');
      const helper = form.slice(0, space);
      const lead = verb.reflexive ? helper.slice(0, helper.search(/(suis|es|est|sommes|êtes|sont)$/)) : '';
      return { person, label: PERSON_LABELS[person]!, parts: [{ text: subject(person, form) + lead }, { text: helper.slice(lead.length), lit: true }, { text: form.slice(space) }] };
    });
  }
  const simple = people.map((person) => simpleForm(verb, tense, person));
  let shared = 0;
  while (simple.length > 1 && simple.every((form) => form[shared] !== undefined && form[shared] === simple[0]![shared])) shared++;
  return people.map((person, index) => {
    const form = all[person]!.shown;
    const lead = form.slice(0, form.length - simple[index]!.length);
    const word = simple[index]!;
    return { person, label: PERSON_LABELS[person]!, parts: [{ text: subject(person, form) + lead + word.slice(0, shared) }, ...(word.slice(shared) ? [{ text: word.slice(shared), lit: true as const }] : [])] };
  });
}

const regularEr = (verb: Verb) => verb.base.endsWith('er') && verb.base !== 'aller' && verb.pres.join() === ['e', 'es', 'e', 'ons', 'ez', 'ent'].map((ending) => verb.base.slice(0, -2) + ending).join();
// The one rule behind a tense for this verb, in a sentence or two.
export function rule(verb: Verb, tense: Tense): string {
  const reflexive = verb.reflexive ? ' As a reflexive verb it keeps its pronoun before the verb: me, te, se, nous, vous, se.' : '';
  if (tense === 'pres') {
    if (verb.impersonal) return `${verb.inf} is only used with il: il ${verb.pres[0]}.`;
    let text: string;
    if (regularEr(verb)) text = '-er verbs: -e, -es, -e, -ons, -ez, -ent. Only nous and vous sound different; the other four sound alike.';
    else if (verb.base.endsWith('er') && verb.base !== 'aller') text = `-er endings (-e, -es, -e, -ons, -ez, -ent), but the stem changes: je ${verb.pres[0]}, nous ${verb.pres[3]}.`;
    else if (verb.base.endsWith('ir') && verb.pres[3] === `${verb.base.slice(0, -2)}issons`) text = `Verbs like finir add -iss- in the plural: nous ${verb.pres[3]}, ils ${verb.pres[5]} — you can hear it.`;
    else if (partirType(verb)) text = `Like partir: the stem loses its last consonant in je, tu and il (je ${verb.pres[0]}, il ${verb.pres[2]}) and keeps it in the plural (nous ${verb.pres[3]}).`;
    else if (ouvrirType(verb)) text = `Like ouvrir: -er endings on an -ir verb (je ${verb.pres[0]}, nous ${verb.pres[3]}).`;
    else if (verb.base.endsWith('venir')) text = `Like venir: je ${verb.pres[0]}, nous ${verb.pres[3]}, ils ${verb.pres[5]}.`;
    else if (verb.base.endsWith('prendre')) text = `Like prendre: the d goes in the plural and ils doubles the n (nous ${verb.pres[3]}, ils ${verb.pres[5]}).`;
    else if (verb.base.endsWith('re') && verb.pres[0]!.endsWith('s') && verb.pres[2] === verb.pres[0]!.slice(0, -1)) text = `-re verbs: -s, -s, (nothing), -ons, -ez, -ent, so il ${verb.pres[2]} has no -t.`;
    else text = `${verb.base} is irregular in the présent: worth learning as a whole table.`;
    return text + reflexive;
  }
  if (tense === 'imp') {
    if (verb.impersonal) return `The imparfait: il ${verb.imp[0]}.`;
    if (verb.base === 'être') return 'The imparfait of être is built on ét-: j’étais, nous étions. It is the only irregular one.';
    return `The imparfait takes the nous form of the présent (nous ${verb.pres[3]}), drops -ons and adds -ais, -ais, -ait, -ions, -iez, -aient.${reflexive}`;
  }
  if (tense === 'fut') {
    const usual = verb.base.endsWith('re') ? verb.base.slice(0, -1) : verb.base;
    return `The futur adds -ai, -as, -a, -ons, -ez, -ont to a stem ending in r: ${verb.fut}-.${verb.fut === usual ? '' : ' This stem is irregular, so it is worth learning.'}${reflexive}`;
  }
  const forms = conjugate(verb, 'pc');
  if (verb.reflexive) return `Reflexive verbs take être in the passé composé, and the participle agrees: il ${forms[2]!.accepted[0]}, elle ${forms[2]!.accepted.at(-1)}.`;
  if (verb.aux === 'être') return `${verb.inf} takes être in the passé composé, so the participle agrees: elle ${forms[2]!.accepted.at(-1)}, ils ${forms[5]!.accepted[0]}.`;
  return `${verb.inf} takes avoir: the helper changes (j’ai, tu as, il a…), the participle ${verb.pp} stays the same.`;
}

// Every problem in a table, so a wrong one is never kept. The rules check what French is regular about: all six
// forms of a regular -er or -ir verb, the imparfait from the nous form, and each person's ending.
export function verbProblems(table: VerbTable, word: VerbWord): string[] {
  const at = `${word.fr} (${table?.id ?? '?'})`;
  const problems: string[] = [];
  if (!table || table.id !== word.id) return [`${at}: the id must be "${word.id}".`];
  const count = Array.isArray(table.pres) ? table.pres.length : 0;
  if (count !== 6 && count !== 1) return [`${at}: "pres" must hold the six forms (je, tu, il, nous, vous, ils), or only the il form for a verb used only with il.`];
  if (!Array.isArray(table.imp) || table.imp.length !== count) return [`${at}: "imp" must hold as many forms as "pres".`];
  for (const form of [...table.pres, ...table.imp, table.fut, table.pp]) {
    if (typeof form !== 'string' || !LETTERS.test(form)) { problems.push(`${at}: "${form}" must be one lowercase French word, without a subject or reflexive pronoun.`); }
  }
  if (problems.length) return problems;
  if (table.aux !== 'avoir' && table.aux !== 'être') problems.push(`${at}: "aux" must be "avoir" or "être".`);
  const verb = verbOf(table, word);
  if (verb.reflexive && table.aux !== 'être') problems.push(`${at}: a reflexive verb takes être.`);
  if (!table.fut.endsWith('r')) problems.push(`${at}: the futur stem ends in r (parler, ir, viendr).`);
  if (count === 1) {
    if (!table.imp[0]!.endsWith('ait')) problems.push(`${at}: the il imparfait ends in -ait.`);
    return problems;
  }
  const [je, tu, , nous, vous, ils] = table.pres as [string, string, string, string, string, string];
  if (verb.base !== 'être' && !nous.endsWith('ons')) problems.push(`${at}: the nous présent ends in -ons.`);
  if (!['être', 'faire', 'dire', 'redire'].includes(verb.base) && !vous.endsWith('ez')) problems.push(`${at}: the vous présent ends in -ez.`);
  if (!ils.endsWith('ent') && !ils.endsWith('ont')) problems.push(`${at}: the ils présent ends in -ent or -ont.`);
  if (!/[sx]$/.test(tu)) problems.push(`${at}: the tu présent ends in -s or -x.`);
  if (!/(e|s|x|ai)$/.test(je)) problems.push(`${at}: the je présent ends in -e, -s, -x or -ai.`);
  const imparfait = derivedImparfait(nous, verb.base);
  if (table.imp.join() !== imparfait.join()) problems.push(`${at}: the imparfait follows from nous ${nous}: ${imparfait.join(', ')}.`);
  if (verb.base.endsWith('er') && verb.base !== 'aller') {
    const stem = verb.base.slice(0, -2);
    // The stem may change where the ending is silent (achète, appelle, jette, paie), and keep a soft g or c before -ons.
    const variants = new Set([stem, stem.replace(/[eé]([^aeiouyéèêë]+)$/, 'è$1'), stem.replace(/([lt])$/, '$1$1'), stem.replace(/y$/, 'i')]);
    ([[0, 'e'], [1, 'es'], [2, 'e'], [5, 'ent']] as const).forEach(([person, ending]) => {
      const form = table.pres[person]!;
      if (!form.endsWith(ending) || !variants.has(form.slice(0, -ending.length))) problems.push(`${at}: the ${PERSON_LABELS[person]} présent of an -er verb is ${stem}${ending} (or its stem with è, a doubled l or t, or i for y).`);
    });
    const softNous = stem.endsWith('g') ? `${stem}eons` : stem.endsWith('c') ? `${stem.slice(0, -1)}çons` : `${stem}ons`;
    if (nous !== softNous) problems.push(`${at}: the nous présent is ${softNous}.`);
    if (vous !== `${stem}ez`) problems.push(`${at}: the vous présent is ${stem}ez.`);
    if (table.pp !== `${stem}é`) problems.push(`${at}: the participle is ${stem}é.`);
    const futures = new Set([...variants].map((variant) => `${variant}er`));
    if (!['envoyer', 'renvoyer'].includes(verb.base) && !futures.has(table.fut)) problems.push(`${at}: the futur stem is ${verb.base} (or with the same stem change as je ${je}).`);
  }
  // A verb like finir: an -ir verb whose nous form adds -iss- to the stem (laissons and connaissons are not).
  if (verb.base.endsWith('ir') && nous === `${verb.base.slice(0, -2)}issons`) {
    const stem = verb.base.slice(0, -2);
    const expected = ['is', 'is', 'it', 'issons', 'issez', 'issent'].map((ending) => stem + ending);
    if (table.pres.join() !== expected.join()) problems.push(`${at}: a verb like finir goes ${expected.join(', ')}.`);
    else if (table.pp !== `${stem}i` || table.fut !== verb.base) problems.push(`${at}: a verb like finir has the participle ${stem}i and the futur stem ${verb.base}.`);
  }
  return problems;
}

export function tablesPrompt(words: VerbWord[], problems: string[]): string {
  return `Echo is an app for an English speaker learning French. Write the conjugation of each French verb below (its English meaning is given so you conjugate the right verb).

For each verb give:
- "pres": the présent, six forms in the order je, tu, il, nous, vous, ils — the forms only, never a subject pronoun ("parle", not "je parle").
- "imp": the imparfait, six forms in the same order.
- "fut": the stem the futur endings join (parler → "parler", prendre → "prendr", aller → "ir", venir → "viendr").
- "pp": the past participle, masculine singular ("parlé", "pris", "venu").
- "aux": the helper in the passé composé, "avoir" or "être". A verb that can take either (passer, monter, descendre, sortir, rentrer, retourner) takes the one for its meaning given here, used without an object.
A reflexive verb (se laisser, s’habituer) is written as its base verb, without the reflexive pronoun, with "aux": "être". A verb used only with il (falloir, pleuvoir) has one form in "pres" and one in "imp": "pres": ["faut"], "imp": ["fallait"].
Write French with ’ for an apostrophe; every form is one lowercase word.
${problems.length ? `\nA previous answer had these problems; fix them:\n${problems.map((problem) => `- ${problem}`).join('\n')}\n` : ''}
${JSON.stringify(words.map(({ id, fr, en }) => ({ id, fr, en })))}

Reply with only JSON: {"verbs": [{"id": "...", "pres": [...], "imp": [...], "fut": "...", "pp": "...", "aux": "..."}]} with one entry for every id above.`;
}

const BATCH = 30;
const RETRY_AFTER = 3_600_000;
const TRIES = 3;
// Keeps a table for every verb in the vocabulary (the deck's and those added from songs), written by Claude a batch
// at a time and kept in one file; a verb whose table fails the checks three times is left out.
export function createVerbTables(options: { file: string; words: () => VerbWord[]; ask: Ask; now?: () => number }) {
  const now = options.now ?? Date.now;
  type Kept = { tables: VerbTable[]; failed: Record<string, number> };
  const read = (): Kept => {
    if (!existsSync(options.file)) return { tables: [], failed: {} };
    const value = JSON.parse(readFileSync(options.file, 'utf8')) as Partial<Kept>;
    return { tables: value.tables ?? [], failed: value.failed ?? {} };
  };
  let kept = read();
  let byId = new Map(kept.tables.map((table) => [table.id, table]));
  let busy: Promise<void> | null = null;
  let failedAt = -Infinity;
  let lastError: string | null = null;
  const save = () => {
    mkdirSync(dirname(options.file), { recursive: true });
    writeFileSync(`${options.file}.tmp`, `${JSON.stringify(kept, null, 1)}\n`);
    renameSync(`${options.file}.tmp`, options.file);
    byId = new Map(kept.tables.map((table) => [table.id, table]));
  };
  const verbWords = () => options.words().filter(isVerbWord);
  const missing = () => verbWords().filter((word) => !byId.has(word.id) && (kept.failed[word.id] ?? 0) < TRIES);

  async function fill(): Promise<void> {
    let problems: string[] = [];
    for (let batch = missing().slice(0, BATCH); batch.length; batch = missing().slice(0, BATCH)) {
      const reply = await options.ask(tablesPrompt(batch, problems), { timeout: 10 * 60_000, purpose: 'writing verb tables' });
      let value: unknown;
      try { value = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)); } catch { value = null; }
      const written = value && typeof value === 'object' && Array.isArray((value as { verbs?: unknown }).verbs) ? (value as { verbs: VerbTable[] }).verbs : [];
      const given = new Map(written.filter((entry) => entry && typeof entry === 'object').map((entry) => [entry.id, entry]));
      problems = [];
      for (const word of batch) {
        const table = given.get(word.id);
        const found = table ? verbProblems(table, word) : [`${word.fr} (${word.id}): missing from the reply.`];
        if (!found.length && table) kept.tables.push({ id: table.id, pres: table.pres, imp: table.imp, fut: table.fut, pp: table.pp, aux: table.aux });
        else { kept.failed[word.id] = (kept.failed[word.id] ?? 0) + 1; problems.push(...found); }
      }
      save();
      console.log(`verbs: ${byId.size} verb tables kept${problems.length ? `; ${problems.length} problems sent back` : ''}`);
      for (const problem of problems) console.log(`  verbs: ${problem}`);
    }
  }

  function check(): Promise<void> {
    if (busy || now() - failedAt < RETRY_AFTER || !missing().length) return busy ?? Promise.resolve();
    busy = fill().then(() => { lastError = null; }, (error: Error) => {
      failedAt = now(); lastError = error.message; console.error(`verbs: could not write verb tables: ${error.message}`);
    }).finally(() => { busy = null; });
    return busy;
  }

  // The verbs Echo can drill, in vocabulary order.
  function verbs(): Verb[] {
    return verbWords().flatMap((word) => { const table = byId.get(word.id); return table ? [verbOf(table, word)] : []; });
  }
  const status = () => ({ total: verbWords().length, ready: verbWords().filter((word) => byId.has(word.id)).length, writing: !!busy, error: lastError });

  return { check, verbs, status };
}
export type VerbTables = ReturnType<typeof createVerbTables>;

// ── By ear ──
export type EarKind = 'tense' | 'number';
export type EarQuestion = { id: string; verbId: string; tense: Tense; person: number; kind: EarKind; said: string; question: string; choices: string[]; answer: number; why: string };
const EAR_TENSES: Tense[] = ['pres', 'imp', 'fut', 'pc'];
const NUMBER_CHOICES = ['one', 'more than one', 'can’t tell by ear'];

function earSaid(verb: Verb, tense: Tense, person: number): string {
  const form = conjugate(verb, tense)[person]!.accepted[0]!;
  return subject(person, form) + form;
}
// il and ils sound alike when the ils form only adds a silent -nt and nothing links to the vowel after ils.
function soundsAlike(verb: Verb, tense: 'pres' | 'imp'): boolean {
  const one = conjugate(verb, tense)[2]!.accepted[0]!, more = conjugate(verb, tense)[5]!.accepted[0]!;
  if (startsVowel(one)) return false;
  return tense === 'pres' ? one.endsWith('e') && more === `${one}nt` : more === one.replace(/ait$/, 'aient');
}

// A "Which tense?" question offers only the tenses being practised (Verbs' Practising line), so it needs two of
// them; with one, every answer would be that tense.
export function earQuestion(verb: Verb, tense: Tense, person: number, kind: EarKind, tenses: readonly Tense[] = EAR_TENSES): EarQuestion | null {
  const forms = conjugate(verb, tense);
  if (!forms[person]) return null;
  const said = earSaid(verb, tense, person);
  const id = `${verb.id}~${tense}~${person}~${kind}`;
  if (kind === 'tense') {
    const offered = EAR_TENSES.filter((entry) => tenses.includes(entry));
    if (offered.length < 2 || !offered.includes(tense)) return null;
    const cue: Record<Tense, string> = { pres: 'the présent', imp: 'the imparfait: its ending sounds like “è” (-ais) or “yon” (-ions)', fut: 'the futur: listen for the r before the ending', pc: 'the passé composé: a helper and then the participle' };
    return { id, verbId: verb.id, tense, person, kind, said, question: 'Which tense?', choices: offered.map((entry) => TENSE_NAMES[entry]), answer: offered.indexOf(tense), why: `${said}: ${cue[tense]}.` };
  }
  if (tense !== 'pres' && tense !== 'imp') return null;
  const one = earSaid(verb, tense, 2), more = earSaid(verb, tense, 5);
  const alike = soundsAlike(verb, tense);
  const answer = alike ? 2 : person === 2 ? 0 : 1;
  const why = alike ? `${one} and ${more} sound exactly the same. Only the sentence around it tells you.`
    : startsVowel(conjugate(verb, tense)[2]!.accepted[0]!) ? `${person === 2 ? one : more}: after ils the s links to the vowel with a z sound, so you can hear ${person === 2 ? 'there is none' : 'it'}.`
    : `${one} and ${more} sound different, so you can hear it.`;
  return { id, verbId: verb.id, tense, person, kind, said, question: 'One person or more?', choices: NUMBER_CHOICES, answer, why };
}

// The questions By ear can ask about a verb in the tenses practised: which tense, for je and nous (skipping nous
// where -ions would sound like -ons after an i or y), and one person or more, for il and ils in the présent and the
// imparfait.
export function earQuestions(verb: Verb, tenses: readonly Tense[] = EAR_TENSES): EarQuestion[] {
  const questions: (EarQuestion | null)[] = [];
  const speakers = verb.impersonal ? [2] : [0, 3];
  for (const tense of EAR_TENSES) for (const person of speakers) {
    if (person === 3 && tense === 'imp' && /[iy]$/.test(verb.pres[3]!.replace(/ons$/, ''))) continue;
    questions.push(earQuestion(verb, tense, person, 'tense', tenses));
  }
  if (!verb.impersonal) for (const tense of ['pres', 'imp'] as const) for (const person of [2, 5]) questions.push(earQuestion(verb, tense, person, 'number'));
  return questions.filter((question): question is EarQuestion => !!question);
}

// ── Guides: each tense, and each verb, explained from the learner's own verbs ──
export type GuideVerb = { id: string; inf: string; detail: string };
export type TenseGroup = { id: string; title: string; text: string; verbs: GuideVerb[]; many?: true };
export type TenseModel = { id: string; inf: string; paradigm: ParadigmRow[] };
export const TENSE_USES: Record<Tense, string> = {
  pres: 'What is happening now, what is generally true, and often what is about to happen.',
  pc: 'A finished action in the past, what happened: the helper (avoir or être) in the présent, then the past participle.',
  imp: 'The past as background: how things were, what used to happen, what was going on when something else happened.',
  fut: 'What will happen: the endings join a stem that ends in r.',
};

// A form with its subject; a verb used only with il is shown with il whatever the person asked for.
const said = (verb: Verb, tense: Tense, asked: number) => { const person = verb.impersonal ? 2 : asked; const form = conjugate(verb, tense)[person]!.shown; return subject(person, form) + form; };
const finirType = (verb: Verb) => !verb.impersonal && verb.base.endsWith('ir') && verb.pres[3] === `${verb.base.slice(0, -2)}issons`;
const regularRe = (verb: Verb) => {
  const stem = verb.base.slice(0, -2);
  return !verb.impersonal && verb.base.endsWith('re') && verb.pres.join() === ['s', 's', '', 'ons', 'ez', 'ent'].map((ending) => stem + ending).join();
};
const erEndings = (stem: string) => ['e', 'es', 'e', 'ons', 'ez', 'ent'].map((ending) => stem + ending).join();
// -ir verbs that drop the stem's last consonant in the singular (je pars, nous partons), and -ir verbs with -er endings (j'ouvre).
const partirType = (verb: Verb) => {
  const stem = verb.base.slice(0, -2), short = stem.slice(0, -1);
  return !verb.impersonal && verb.base.endsWith('ir') && verb.pres.join() === [`${short}s`, `${short}s`, `${short}t`, `${stem}ons`, `${stem}ez`, `${stem}ent`].join();
};
const ouvrirType = (verb: Verb) => !verb.impersonal && verb.base.endsWith('ir') && verb.pres.join() === erEndings(verb.base.slice(0, -2));
const usualParticiple = (verb: Verb) => verb.base.endsWith('er') && verb.base !== 'aller' ? `${verb.base.slice(0, -2)}é`
  : finirType(verb) ? `${verb.base.slice(0, -2)}i` : regularRe(verb) ? `${verb.base.slice(0, -2)}u` : null;
const usualFuture = (verb: Verb) => verb.base.endsWith('re') ? verb.base.slice(0, -1) : verb.base;

// Which kind of verb this is in a tense: the group that says what is regular or not about it here.
export function groupOf(verb: Verb, tense: Tense): string {
  if (tense === 'pres') {
    if (verb.impersonal) return 'only-il';
    if (verb.base.endsWith('er') && verb.base !== 'aller') return regularEr(verb) ? 'er' : 'er-change';
    return finirType(verb) ? 'finir' : partirType(verb) ? 'partir' : ouvrirType(verb) ? 'ouvrir' : verb.base.endsWith('prendre') ? 'prendre' : verb.base.endsWith('venir') ? 'venir' : regularRe(verb) ? 're' : 'irregular';
  }
  if (tense === 'pc') {
    if (verb.reflexive) return 'reflexive';
    if (verb.aux === 'être') return 'etre';
    // Other -ir verbs make -i too: dormi, parti, senti.
    return verb.pp === usualParticiple(verb) || (verb.base.endsWith('ir') && verb.pp === verb.base.slice(0, -1)) ? 'regular' : 'participle';
  }
  if (tense === 'imp') {
    if (verb.base === 'être') return 'etre';
    if (verb.impersonal) return 'only-il';
    const stem = verb.imp[0]!.replace(/ais$/, '');
    if (/(ge|ç)$/.test(stem)) return 'soft';
    if (/[iy]$/.test(stem)) return 'double-i';
    return ['irregular', 'prendre', 'venir'].includes(groupOf(verb, 'pres')) ? 'from-nous' : 'regular';
  }
  if (verb.fut === usualFuture(verb)) return 'regular';
  return verb.base.endsWith('er') && verb.base !== 'aller' && verb.base !== 'envoyer' ? 'er-change' : 'stem';
}

const GROUPS: Record<Tense, { id: string; title: string; text: string; many?: true; detail: (verb: Verb) => string }[]> = {
  pres: [
    { id: 'irregular', title: 'Irregular', text: 'These follow no pattern in the présent, so each is worth learning as a whole table. Many are the most common verbs.', detail: (verb) => [0, 2, 3, 5].map((person) => said(verb, 'pres', person)).join(', ') },
    { id: 'er-change', title: '-er verbs whose stem changes', text: 'Regular -er endings, but the stem changes where the ending is silent (je, tu, il, ils): an è, a doubled l or t, i for y — or a soft g or c kept before -ons.', detail: (verb) => `${said(verb, 'pres', 0)}, ${said(verb, 'pres', 3)}` },
    { id: 'finir', title: 'Like finir', text: '-is, -is, -it, -issons, -issez, -issent: the -iss- in the plural is heard.', detail: (verb) => said(verb, 'pres', 5) },
    { id: 'partir', title: 'Like partir', text: '-ir verbs that drop the last consonant of the stem in je, tu and il (je pars, il part) and keep it in the plural (nous partons, ils partent).', detail: (verb) => `${said(verb, 'pres', 0)}, ${said(verb, 'pres', 3)}` },
    { id: 'ouvrir', title: 'Like ouvrir', text: '-ir verbs that take -er endings in the présent: j’ouvre, tu ouvres, il ouvre, nous ouvrons.', detail: (verb) => said(verb, 'pres', 0) },
    { id: 'prendre', title: 'Like prendre', text: 'prendre and the verbs built on it lose the d in the plural and double the n in ils: nous prenons, ils prennent.', detail: (verb) => `${said(verb, 'pres', 3)}, ${said(verb, 'pres', 5)}` },
    { id: 'venir', title: 'Like venir', text: 'venir and the verbs built on it (revenir, se souvenir, devenir): je viens, nous venons, ils viennent.', detail: (verb) => `${said(verb, 'pres', 0)}, ${said(verb, 'pres', 5)}` },
    { id: 're', title: 'Regular -re', text: '-s, -s, nothing, -ons, -ez, -ent: il attend has no -t.', detail: (verb) => said(verb, 'pres', 2) },
    { id: 'only-il', title: 'Only with il', text: 'Used only as il, with no other person.', detail: (verb) => said(verb, 'pres', 2) },
    { id: 'er', title: 'Regular -er', text: '-e, -es, -e, -ons, -ez, -ent on the stem (the infinitive without -er). Only nous and vous sound different.', many: true, detail: () => '' },
  ],
  pc: [
    { id: 'etre', title: 'Take être', text: 'Mostly verbs of moving or changing state (aller, venir, partir, arriver, rester, mourir…). The participle agrees with the subject like an adjective: elle est allée, ils sont partis.', detail: (verb) => said(verb, 'pc', 0) },
    { id: 'reflexive', title: 'Reflexive verbs', text: 'Every reflexive verb takes être, with its pronoun before the helper: je me suis levé(e).', detail: (verb) => said(verb, 'pc', 0) },
    { id: 'participle', title: 'Irregular participles', text: 'avoir, but a participle to learn by heart (the regular ones end in -é, -i or -u).', detail: (verb) => said(verb, 'pc', 0) },
    { id: 'regular', title: 'avoir and a regular participle', text: '-er verbs make -é (parlé), -ir verbs -i (fini, dormi), regular -re verbs -u (attendu).', many: true, detail: () => '' },
  ],
  imp: [
    { id: 'etre', title: 'The only irregular one', text: 'être is built on ét-: j’étais, nous étions.', detail: (verb) => said(verb, 'imp', 0) },
    { id: 'from-nous', title: 'Irregular in the présent, regular here', text: 'Take the nous présent, drop -ons, add the endings: even the irregular verbs follow the rule.', detail: (verb) => `nous ${verb.pres[3]} → ${said(verb, 'imp', 0)}` },
    { id: 'soft', title: 'A soft g or c', text: 'The e after g and the ç stay before a (-ais, -ait, -aient) and go before i (-ions, -iez).', detail: (verb) => `${said(verb, 'imp', 0)}, ${said(verb, 'imp', 3)}` },
    { id: 'double-i', title: 'A stem ending in i or y', text: 'The nous and vous forms keep that i or y before -ions and -iez, so they are easy to miss: nous étudiions.', detail: (verb) => said(verb, 'imp', 3) },
    { id: 'only-il', title: 'Only with il', text: 'Used only as il.', detail: (verb) => said(verb, 'imp', 2) },
    { id: 'regular', title: 'Everything else', text: 'The nous présent without -ons, and -ais, -ais, -ait, -ions, -iez, -aient.', many: true, detail: () => '' },
  ],
  fut: [
    { id: 'stem', title: 'Irregular stems', text: 'The endings are always -ai, -as, -a, -ons, -ez, -ont; these verbs have a stem of their own to learn.', detail: (verb) => said(verb, 'fut', 0) },
    { id: 'er-change', title: '-er verbs with their présent stem change', text: 'The same change as in je (j’achète → j’achèterai, j’appelle → j’appellerai).', detail: (verb) => said(verb, 'fut', 0) },
    { id: 'regular', title: 'The infinitive as the stem', text: 'The infinitive, without the final e of -re verbs: parler-, finir-, prendr-.', many: true, detail: () => '' },
  ],
};
export const GROUP_TITLES = Object.fromEntries(TENSES.map((tense) => [tense, Object.fromEntries(GROUPS[tense].map((group) => [group.id, group.title]))])) as Record<Tense, Record<string, string>>;
const MODELS: Record<Tense, string[]> = { pres: ['parler', 'finir', 'attendre'], pc: ['parler', 'aller', 'se lever'], imp: ['parler', 'finir', 'être'], fut: ['parler', 'prendre', 'être'] };

// A tense explained through the learner's verbs: three model tables, then every verb in the group that says what
// is regular or not about it in this tense.
export function tenseGuide(verbs: Verb[], tense: Tense): { tense: Tense; name: string; use: string; models: TenseModel[]; groups: TenseGroup[] } {
  const models = MODELS[tense].flatMap((inf) => { const verb = verbs.find((entry) => entry.inf === inf); return verb ? [{ id: verb.id, inf: verb.inf, paradigm: paradigm(verb, tense) }] : []; });
  const groups = GROUPS[tense].map((group) => ({
    id: group.id, title: group.title, text: group.text, ...(group.many ? { many: true as const } : {}),
    verbs: verbs.filter((verb) => groupOf(verb, tense) === group.id).map((verb) => ({ id: verb.id, inf: verb.inf, detail: group.detail(verb) })).sort((a, b) => a.inf.localeCompare(b.inf, 'fr')),
  })).filter((group) => group.verbs.length);
  return { tense, name: TENSE_NAMES[tense], use: TENSE_USES[tense], models, groups };
}

// One verb in every tense: its table, its rule, and which group it falls in there.
export function verbGuide(verb: Verb) {
  return {
    id: verb.id, inf: verb.inf, en: verb.en,
    tenses: TENSES.map((tense) => {
      const group = GROUPS[tense].find((entry) => entry.id === groupOf(verb, tense))!;
      return { tense, name: TENSE_NAMES[tense], group: group.title, rule: rule(verb, tense), paradigm: paradigm(verb, tense) };
    }),
  };
}
