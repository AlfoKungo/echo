// Word families: deck words built from one French root (la cuisine → cuisiner → le cuisinier). Once one member
// is known the others are half known, so Vocabulary lists the families you nearly know and brings their other
// words in sooner. content/families.json is written once by scripts/make-families.ts (Opus) and checked here.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Word, WordFamily } from '../contract';

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
