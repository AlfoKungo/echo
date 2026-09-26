// Word families: deck words built from one French root (la cuisine → cuisiner → le cuisinier). Once one member
// is known the others are half known, so Vocabulary lists the families you nearly know and brings their other
// words in sooner. content/families.json is written once by scripts/make-families.ts (Opus) and checked here.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Word, WordFamily, WordPattern } from '../contract';

export const MAX_MEMBERS = 8;
const NOTE_MAX = 120;

// A word's French without its article or reflexive pronoun, accents or case: what a shared root is looked for in.
function stem(fr: string): string {
  return fr.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/^(le |la |les |l'|l’|un |une |se |s'|s’)/, '').replace(/[^a-z]/g, '');
}
function sharesRoot(a: string, b: string): boolean {
  const [x, y] = [stem(a), stem(b)];
  for (let i = 0; i + 3 <= x.length; i++) if (y.includes(x.slice(i, i + 3))) return true;
  return false;
}

// Problems with a family, empty when it is sound: every member a deck word used once across all families, 2 to 8
// members, a short note on how each word after the first is built, and some letters in common with another member
// (a guard against words grouped by meaning or by chance spelling).
export function familyProblems(family: WordFamily, byId: Map<string, Word>, used: Set<string>): string[] {
  const problems: string[] = [];
  const members = Array.isArray(family?.members) ? family.members : [];
  if (members.length < 2 || members.length > MAX_MEMBERS) problems.push(`a family has 2 to ${MAX_MEMBERS} members, not ${members.length}.`);
  const words = members.map((member) => byId.get(member?.id));
  members.forEach((member, index) => {
    const word = words[index];
    if (!word) { problems.push(`"${member?.id}" is not a deck id.`); return; }
    if (used.has(word.id)) problems.push(`"${word.fr}" (${word.id}) is in more than one family.`);
    if (index > 0 && (typeof member.note !== 'string' || member.note.trim().length < 8 || member.note.length > NOTE_MAX)) problems.push(`"${word.fr}" needs a note of at most ${NOTE_MAX} characters on how it is built.`);
    if (!words.some((other, j) => j !== index && other && sharesRoot(word.fr, other.fr))) problems.push(`"${word.fr}" shares no root with the rest of its family (${words.filter(Boolean).map((other) => other!.fr).join(', ')}).`);
  });
  return problems;
}

// The committed families, keeping only sound ones, so a deck edit that drops a word cannot break Vocabulary.
export function loadFamilies(root: string, deck: Word[]): WordFamily[] {
  const path = join(root, 'content/families.json');
  if (!existsSync(path)) return [];
  const byId = new Map(deck.map((word) => [word.id, word]));
  const used = new Set<string>();
  const sound: WordFamily[] = [];
  for (const family of (JSON.parse(readFileSync(path, 'utf8')) as { families: WordFamily[] }).families) {
    if (familyProblems(family, byId, used).length) continue;
    for (const member of family.members) used.add(member.id);
    sound.push(family);
  }
  return sound;
}

export function familiesPrompt(deck: Word[], problems: string[] = []): string {
  return `You are helping an English speaker (level A1 to A2) learning French. Below is their vocabulary deck, one word per line as "id | French | English".

Group deck words into WORD FAMILIES: words built from the same French root in a way a learner can see once it is pointed out.
- Good: a noun and its verb (la cuisine, cuisiner), the person who does it (vendre, le vendeur), an adjective and its noun (chaud, la chaleur), a word hidden inside a compound (bonjour, le jour; minuit, la nuit), a prefix (faire, défaire).
- Never group words that are only close in meaning (le chien, le chat) or that look alike by chance (la mer, la mère; le livre, libre).
- Only use ids from the list, each in at most one family. Families have 2 to ${MAX_MEMBERS} members. Most words belong to no family: leave them out.
- Put the simplest base word first. Every member after the first gets a "note": one plain English line (at most ${NOTE_MAX} characters) saying how it is built from another member, quoting the French, e.g. "la cuisine + -er makes the verb: to do what happens in a kitchen." or "Hidden inside: bon (good) + jour (day)."
${problems.length ? `\nYour previous answer had these problems; fix them:\n${problems.slice(0, 40).map((problem) => `- ${problem}`).join('\n')}\n` : ''}
Reply with JSON only: {"families": [{"members": [{"id": "..."}, {"id": "...", "note": "..."}]}]}

Deck:
${deck.map((word) => `${word.id} | ${word.fr} | ${word.en}`).join('\n')}`;
}

// Word building: the few patterns the families are made by (-er makes the verb, in- makes the opposite…), each
// shown with pairs from one family. content/word-building.json is written by scripts/make-word-building.ts.
const TITLE_MAX = 48;
const EXPLANATION_MAX = 240;
const TIP_MAX = 170;

// Problems with one pattern: short plain text, and 2 to 6 examples, each a [from, to] pair of two members of one
// family, used by no other pattern.
export function patternProblems(pattern: WordPattern, familyOf: Map<string, WordFamily>, used: Set<string>): string[] {
  const problems: string[] = [];
  const title = typeof pattern?.title === 'string' ? pattern.title.trim() : '';
  if (!title || title.length > TITLE_MAX) problems.push(`a pattern needs a title of at most ${TITLE_MAX} characters.`);
  if (typeof pattern?.explanation !== 'string' || pattern.explanation.trim().length < 20 || pattern.explanation.length > EXPLANATION_MAX) problems.push(`"${title}": the explanation must be 20 to ${EXPLANATION_MAX} characters.`);
  if (pattern?.tip !== undefined && (typeof pattern.tip !== 'string' || pattern.tip.length > TIP_MAX)) problems.push(`"${title}": a tip is at most ${TIP_MAX} characters.`);
  const examples = Array.isArray(pattern?.examples) ? pattern.examples : [];
  if (examples.length < 2 || examples.length > 6) problems.push(`"${title}" needs 2 to 6 examples, not ${examples.length}.`);
  for (const example of examples) {
    const [from, to] = Array.isArray(example) ? example : [];
    const family = familyOf.get(from as string);
    if (!family || from === to || familyOf.get(to as string) !== family) problems.push(`"${title}": [${from}, ${to}] is not a pair from one family.`);
    else if (used.has(`${from}>${to}`)) problems.push(`"${title}": [${from}, ${to}] is already an example of another pattern.`);
  }
  return problems;
}

export function familyIndex(families: WordFamily[]): Map<string, WordFamily> {
  return new Map(families.flatMap((family) => family.members.map((member) => [member.id, family] as const)));
}

// The committed patterns whose examples still fit the families, so a regenerated family file cannot break Grammar.
export function loadPatterns(root: string, families: WordFamily[]): WordPattern[] {
  const path = join(root, 'content/word-building.json');
  if (!existsSync(path)) return [];
  const familyOf = familyIndex(families);
  const used = new Set<string>();
  const sound: WordPattern[] = [];
  for (const pattern of (JSON.parse(readFileSync(path, 'utf8')) as { patterns: WordPattern[] }).patterns) {
    if (patternProblems(pattern, familyOf, used).length) continue;
    for (const [from, to] of pattern.examples) used.add(`${from}>${to}`);
    sound.push(pattern);
  }
  return sound;
}

export function patternsPrompt(families: WordFamily[], byId: Map<string, Word>, problems: string[] = []): string {
  const lines = families.map((family, index) => `${index + 1}. ${family.members.map((member) => `${member.id} = ${byId.get(member.id)?.fr} (${byId.get(member.id)?.en})${member.note ? ` [${member.note}]` : ''}`).join('; ')}`);
  return `You are helping an English speaker (level A1 to A2) learning French. Below are word families from their vocabulary: each line lists "id = French (English)", and for every word after the first, a note on how it is built.

Sort how these words are built into 6 to 12 PATTERNS a learner can reuse on words they have never seen, for a short "Word building" page. For example: "-er makes the verb", "-eur, -ier: the person who does it", "in-, im-: the opposite", "re-: again or back", "-ée, -ure: the noun for the action", "Two words make one". Most useful pattern first; skip a pattern with fewer than 2 examples.
- "title": at most ${TITLE_MAX} characters; it may quote the French ending or prefix.
- "explanation": one or two plain English sentences (at most ${EXPLANATION_MAX} characters) on what the pattern does and how to spot it in speech or text.
- "tip" (optional): one extra line at most ${TIP_MAX} characters, e.g. the gender such words take, or the feminine form.
- "examples": 2 to 6 pairs ["fromId", "toId"], both ids from the SAME family line, where the second word is built from the first by this pattern. Use each pair once across all patterns.
${problems.length ? `\nYour previous answer had these problems; fix them:\n${problems.slice(0, 30).map((problem) => `- ${problem}`).join('\n')}\n` : ''}
Reply with JSON only: {"patterns": [{"title": "...", "explanation": "...", "tip": "...", "examples": [["fromId", "toId"]]}]}

Families:
${lines.join('\n')}`;
}
