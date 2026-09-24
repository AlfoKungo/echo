import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ComprehensionLane, ComprehensionPassage, ComprehensionSentence, Gloss } from '../comprehension-contract';
import { StoreError } from './store';

export type Bank = { sentences: ComprehensionSentence[]; passages: ComprehensionPassage[] };
export type Known = { words: Set<string>; topics: Set<string> };

const LEVELS = new Set(['A1', 'A2', 'B1']);
export const SENTENCE_WORDS = { A1: 10, A2: 14, B1: 20 } as const;
export const PASSAGE_WORDS = { A1: 70, A2: 110, B1: 160 } as const;
const LETTER = /[\p{L}\p{M}]/u;

export const wordCount = (text: string) => text.split(/\s+/).filter((part) => LETTER.test(part)).length;

// Positions where `needle` stands as whole words: no letter joined on either side,
// except that an elided form (l’, j’) may be followed directly by the next word.
export function wholeMatches(text: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) return found;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    const before = text[at - 1] ?? ' ';
    const after = text[at + needle.length] ?? ' ';
    if (LETTER.test(before) || before === '’' || before === '-') continue;
    if (LETTER.test(after) && !/[’']$/.test(needle)) continue;
    found.push(at);
  }
  return found;
}

// Validates one lane file; `where` names it in messages. Pure, so the author check and the server share it.
export function validateLane(lane: ComprehensionLane, where: string, known: Known, ids: Set<string>): string[] {
  const errors: string[] = [];
  const say = (id: string, message: string) => errors.push(`${where} ${id}: ${message}`);
  const plain = (id: string, label: string, value: unknown, allowEmpty = false) => {
    if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || /<\/?[A-Za-z][^>]*>/.test(value)) { say(id, `${label} must be plain text.`); return false; }
    if (value !== value.trim() || /\s{2,}/.test(value)) say(id, `${label} has stray spaces.`);
    return true;
  };
  // A text line may open a letter or a list (Chers voisins, / Au programme :); sentences always end a sentence.
  const french = (id: string, label: string, value: unknown, open = false) => {
    if (!plain(id, label, value)) return;
    const text = value as string;
    if (text.includes("'")) say(id, `${label} uses ' — write French with ’.`);
    if (!(open ? /[.!?…»,:]$/ : /[.!?…»]$/).test(text)) say(id, `${label} must end with . ! ? or …${open ? ' (or , : for a text line)' : ''}`);
    if (/[^\s][?!:;]/.test(text.replace(/[?!]{2,}/g, '?'))) say(id, `${label} needs a space before ? ! : ; in French.`);
  };
  const identity = (id: unknown) => {
    if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) { errors.push(`${where}: invalid id ${JSON.stringify(id)} (lowercase letters, digits, hyphens).`); return false; }
    if (ids.has(id)) say(id, 'duplicate id.');
    ids.add(id);
    return true;
  };
  const tags = (id: string, topics: unknown, words: unknown) => {
    if (!Array.isArray(topics)) say(id, 'topics must be a list.');
    else for (const topic of topics) if (!known.topics.has(topic)) say(id, `unknown grammar topic ${topic}.`);
    if (!Array.isArray(words)) say(id, 'words must be a list.');
    else {
      for (const word of words) if (!known.words.has(word)) say(id, `unknown vocabulary id ${word}.`);
      if (new Set(words).size !== words.length) say(id, 'words lists an id twice.');
    }
  };
  const glosses = (id: string, gloss: unknown, text: string) => {
    if (!Array.isArray(gloss) || !gloss.length) { say(id, 'gloss must list the content words.'); return; }
    const seen = new Set<string>();
    for (const entry of gloss as Gloss[]) {
      if (!entry || !plain(id, 'gloss fr', entry.fr) || !plain(id, `gloss en for ${entry.fr}`, entry.en)) continue;
      if (seen.has(entry.fr)) say(id, `gloss repeats ${entry.fr}.`);
      seen.add(entry.fr);
      if (!wholeMatches(text, entry.fr).length) say(id, `gloss "${entry.fr}" is not a whole word or phrase in the French.`);
      if (entry.word !== undefined && !known.words.has(entry.word)) say(id, `gloss "${entry.fr}" links unknown vocabulary id ${entry.word}.`);
    }
  };
  if (!lane || !Array.isArray(lane.sentences) || !Array.isArray(lane.passages)) return [`${where}: must be { "sentences": [...], "passages": [...] }.`];
  for (const sentence of lane.sentences) {
    if (!identity(sentence?.id)) continue;
    const id = sentence.id;
    if (!LEVELS.has(sentence.level)) say(id, 'level must be A1, A2 or B1.');
    french(id, 'fr', sentence.fr);
    plain(id, 'en', sentence.en);
    if (typeof sentence.fr !== 'string') continue;
    const limit = SENTENCE_WORDS[sentence.level as keyof typeof SENTENCE_WORDS];
    if (limit && wordCount(sentence.fr) > limit) say(id, `has ${wordCount(sentence.fr)} words; ${sentence.level} sentences take at most ${limit}.`);
    if (!Array.isArray(sentence.distractors) || sentence.distractors.length < 2 || sentence.distractors.length > 3) say(id, 'needs 2–3 distractors.');
    else {
      const all = [sentence.en, ...sentence.distractors].map((value) => String(value).toLowerCase().replace(/[.!?]+$/, '').trim());
      if (new Set(all).size !== all.length) say(id, 'a distractor repeats the meaning or another distractor.');
      sentence.distractors.forEach((value) => plain(id, 'distractor', value));
    }
    if (plain(id, 'gap', sentence.gap)) {
      const hits = wholeMatches(sentence.fr, sentence.gap).length;
      if (hits !== 1) say(id, `gap "${sentence.gap}" must occur exactly once as a whole word (found ${hits}).`);
    }
    tags(id, sentence.topics, sentence.words);
    glosses(id, sentence.gloss, sentence.fr);
  }
  for (const passage of lane.passages) {
    if (!identity(passage?.id)) continue;
    const id = passage.id;
    if (!LEVELS.has(passage.level)) say(id, 'level must be A1, A2 or B1.');
    if (passage.kind !== 'dialogue' && passage.kind !== 'text') say(id, 'kind must be dialogue or text.');
    plain(id, 'title', passage.title);
    if (!Array.isArray(passage.lines) || passage.lines.length < 3 || passage.lines.length > 10) { say(id, 'needs 3–10 lines.'); continue; }
    passage.lines.forEach((line, index) => {
      french(id, `line ${index + 1} fr`, line?.fr, passage.kind === 'text');
      plain(id, `line ${index + 1} en`, line?.en);
      if (passage.kind === 'dialogue' && !(typeof line?.speaker === 'string' && line.speaker.trim())) say(id, `line ${index + 1} needs a speaker.`);
      if (passage.kind === 'text' && line?.speaker !== undefined) say(id, `line ${index + 1}: text lines take no speaker.`);
    });
    const text = passage.lines.map((line) => line?.fr ?? '').join('\n');
    const limit = PASSAGE_WORDS[passage.level as keyof typeof PASSAGE_WORDS];
    if (limit && wordCount(text) > limit) say(id, `has ${wordCount(text)} words; ${passage.level} passages take at most ${limit}.`);
    if (!Array.isArray(passage.questions) || passage.questions.length < 3 || passage.questions.length > 4) say(id, 'needs 3–4 questions.');
    else passage.questions.forEach((question, index) => {
      plain(id, `question ${index + 1}`, question?.question);
      plain(id, `question ${index + 1} explanation`, question?.explanation);
      if (!Array.isArray(question?.choices) || question.choices.length < 3 || question.choices.length > 4) { say(id, `question ${index + 1} needs 3–4 choices.`); return; }
      question.choices.forEach((choice) => plain(id, `question ${index + 1} choice`, choice));
      if (new Set(question.choices.map((choice) => String(choice).toLowerCase())).size !== question.choices.length) say(id, `question ${index + 1} repeats a choice.`);
      if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.choices.length) say(id, `question ${index + 1} answer must index its choices.`);
    });
    tags(id, passage.topics, passage.words);
    glosses(id, passage.gloss, text);
  }
  return errors;
}

export async function loadKnown(root: string): Promise<Known> {
  const words = [...await Bun.file(join(root, 'content/core.json')).json(), ...await Bun.file(join(root, 'content/world.json')).json()] as { id: string }[];
  const units = await Bun.file(join(root, 'content/grammar/units.json')).json() as { topics: string[] }[];
  return { words: new Set(words.map((word) => word.id)), topics: new Set(units.flatMap((unit) => unit.topics)) };
}

// Loads every lane in content/comprehension (or `dir`); any invalid file stops startup with every problem listed.
export async function loadBank(root: string, dir = join(root, 'content/comprehension')): Promise<Bank> {
  const known = await loadKnown(root);
  const ids = new Set<string>();
  const bank: Bank = { sentences: [], passages: [] };
  const errors: string[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json')).sort()) {
    const lane = await Bun.file(join(dir, file)).json() as ComprehensionLane;
    errors.push(...validateLane(lane, file, known, ids));
    if (Array.isArray(lane?.sentences)) bank.sentences.push(...lane.sentences);
    if (Array.isArray(lane?.passages)) bank.passages.push(...lane.passages);
  }
  if (errors.length) throw new StoreError(`Comprehension content is invalid:\n${errors.slice(0, 40).join('\n')}${errors.length > 40 ? `\n…and ${errors.length - 40} more` : ''}`);
  if (!bank.sentences.length) throw new StoreError('Comprehension content is empty.');
  return bank;
}
