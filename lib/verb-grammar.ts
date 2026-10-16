// A language's verbs as the Verbs room drills them (lib/verb-drills.ts, lib/rule-cards.ts): French is lib/verbs.ts,
// Portuguese lib/verbs-pt.ts (four persons in four tenses), Swedish lib/verbs-sv.ts (three key forms per verb, drilled
// by conjugation group where the others drill tenses). The drills keep every answer as verb, tense and person and hand
// them back only to the grammar that made them, so each language's tense ids and person slots are its own.
import { createHash } from 'node:crypto';
import { ruleCandidates, ruleDeck, type RuleCard } from './rule-cards';
import * as french from './verbs';

export type DrillVerb = { id: string; inf: string; en: string };
export type Form = french.Form;
export type ParadigmRow = french.ParadigmRow;
export type EarQuestion<T extends string = string> = Omit<french.EarQuestion, 'tense'> & { tense: T };

// Members are written as methods so a grammar built on its own verb type still fits.
export interface VerbGrammar<V extends DrillVerb = french.Verb, T extends string = french.Tense> {
  tenses: readonly T[];
  tenseNames: Record<T, string>;
  personLabels: readonly string[];
  groupTitles: Record<T, Record<string, string>>;
  // What a tense id stands for in the room's messages: a tense, or (Swedish) a conjugation group.
  unit: 'tense' | 'group';
  // One Cards card stands for all of a verb's forms in the tense (Swedish key forms), and its mark counts for each.
  wholeCards?: true;
  // Whether By ear can ask anything in these tenses, and why not when it cannot.
  earAskable(tenses: readonly T[]): boolean;
  earNeeds: string;
  persons(verb: V, tense: T): number[];
  conjugate(verb: V, tense: T): (Form | null)[];
  // The subject said before a form; French's depends on the tense (que je, none in the impératif).
  subject(person: number, form: string, tense?: T): string;
  isRight(form: Form, given: string): boolean;
  accentSlip(form: Form, given: string): boolean;
  diagnose(verb: V, tense: T, person: number, given: string): string;
  paradigm(verb: V, tense: T): ParadigmRow[];
  rule(verb: V, tense: T): string;
  groupOf(verb: V, tense: T): string;
  earQuestion(verb: V, tense: T, person: number, kind: french.EarKind, tenses?: readonly T[]): EarQuestion<T> | null;
  earQuestions(verb: V, tenses?: readonly T[]): EarQuestion<T>[];
  tenseGuide(verbs: V[], tense: T): object;
  verbGuide(verb: V): object;
  ruleDeck(verbs: V[], started: Set<string>, picked?: V[], tenses?: readonly T[]): RuleCard<T>[];
  ruleCandidates(verbs: V[], started: Set<string>, picked?: V[]): RuleCard<T>[];
}

export const FRENCH: VerbGrammar = {
  tenses: french.TENSES, tenseNames: french.TENSE_NAMES, personLabels: french.PERSON_LABELS, groupTitles: french.GROUP_TITLES, unit: 'tense',
  earNeeds: 'By ear needs two tenses to ask which one you hear, or the présent or imparfait to ask how many people. Add one on the Practising line.',
  earAskable: (tenses) => tenses.some((tense) => tense === 'pres' || tense === 'imp') || tenses.length >= 2,
  persons: french.persons, conjugate: french.conjugate, subject: french.subject, isRight: french.isRight, accentSlip: french.accentSlip,
  diagnose: french.diagnose, paradigm: french.paradigm, rule: french.rule, groupOf: french.groupOf,
  earQuestion: french.earQuestion, earQuestions: french.earQuestions, tenseGuide: french.tenseGuide, verbGuide: french.verbGuide,
  ruleDeck, ruleCandidates,
};

// A verb phrase recorded for a language other than French (By ear, How it's built), by the language's own voice into
// <audio>/verbs/<id>.mp3: the id is fixed by the text, so a changed phrase is a new clip.
export const verbClip = (text: string) => ({ id: `vb-${createHash('sha256').update(text).digest('hex').slice(0, 16)}`, text });

// A tense's forms, each split so its ending can be lit: the letters every form shares, then the rest. lead is said
// before a form (a subject) and tail after it (a particle), both unlit.
export function litRows(people: number[], labels: readonly string[], words: string[], lead: (person: number) => string, tail = '', note?: (person: number) => string): ParadigmRow[] {
  let shared = 0;
  while (words.length > 1 && words.every((word) => word[shared] !== undefined && word[shared] === words[0]![shared])) shared++;
  return people.map((person, index) => {
    const word = words[index]!;
    const parts: ParadigmRow['parts'] = [{ text: lead(person) + word.slice(0, shared) }];
    if (word.slice(shared)) parts.push({ text: word.slice(shared), lit: true });
    if (tail) parts.push({ text: ` ${tail}` });
    return { person, label: labels[person]!, parts, ...(note ? { note: note(person) } : {}) };
  });
}
