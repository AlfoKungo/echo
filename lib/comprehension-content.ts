import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ComprehensionLane, ComprehensionPassage, ComprehensionSentence, Gloss, PassageLine } from '../comprehension-contract';
import { languages, type Language, type LanguageCode } from './language';
import { StoreError } from './store';

export type Bank = { sentences: ComprehensionSentence[]; passages: ComprehensionPassage[] };
// topicsUnchecked: the language's grammar topics are not written yet (no units.json), so topic tags are taken as given.
export type Known = { words: Set<string>; topics: Set<string>; topicsUnchecked?: boolean };

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
// `code` picks the typography the learnt text is checked against; every field is read as Echo's internal `fr`.
export function validateLane(lane: ComprehensionLane, where: string, known: Known, ids: Set<string>, code: LanguageCode = 'fr'): string[] {
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
    if (code !== 'fr') { learnt(id, label, text, open); return; }
    if (text.includes("'")) say(id, `${label} uses ' — write French with ’.`);
    if (!(open ? /[.!?…»,:]$/ : /[.!?…»]$/).test(text)) say(id, `${label} must end with . ! ? or …${open ? ' (or , : for a text line)' : ''}`);
    if (/[^\s][?!:;]/.test(text.replace(/[?!]{2,}/g, '?'))) say(id, `${label} needs a space before ? ! : ; in French.`);
  };
  // Portuguese and Swedish set ? ! : ; straight after the word, and need no apostrophe at A1–A2; a quote closes with ”.
  const learnt = (id: string, label: string, text: string, open: boolean) => {
    if (/['’]/.test(text)) say(id, `${label} has an apostrophe; write the words out in full.`);
    if (!(open ? /[.!?…”,:]$/ : /[.!?…”]$/).test(text)) say(id, `${label} must end with . ! ? or …${open ? ' (or , : for a text line)' : ''}`);
    if (/\s[?!:;,.]/.test(text)) say(id, `${label} has a space before a punctuation mark.`);
  };
  const identity = (id: unknown) => {
    if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) { errors.push(`${where}: invalid id ${JSON.stringify(id)} (lowercase letters, digits, hyphens).`); return false; }
    if (ids.has(id)) say(id, 'duplicate id.');
    ids.add(id);
    return true;
  };
  const tags = (id: string, topics: unknown, words: unknown) => {
    if (!Array.isArray(topics)) say(id, 'topics must be a list.');
    else for (const topic of topics) if (!known.topicsUnchecked && !known.topics.has(topic)) say(id, `unknown grammar topic ${topic}.`);
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

// Words a reader never needs to tap. Everything else in the learnt text needs a gloss.
const FUNCTION: Record<LanguageCode, Set<string>> = {
  fr: new Set(['le', 'la', 'les', 'l’', 'un', 'une', 'des', 'de', 'du', 'd’', 'à', 'au', 'aux', 'et', 'ou', 'mais',
    'je', 'j’', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'ne', 'n’', 'pas', 'que', 'qu’', 'ce', 'c’', 'se', 's’',
    'me', 'm’', 'te', 't’', 'y', 'en']),
  pt: new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
    'ao', 'aos', 'à', 'às', 'e', 'ou', 'mas', 'eu', 'tu', 'ele', 'ela', 'você', 'nós', 'vocês', 'eles', 'elas', 'não', 'que', 'se',
    'me', 'te']),
  sv: new Set(['en', 'ett', 'och', 'eller', 'men', 'jag', 'du', 'han', 'hon', 'vi', 'ni', 'de', 'den', 'det', 'inte', 'att', 'som',
    'man', 'sig', 'mig', 'dig']),
};

export function unglossed(text: string, gloss: { fr: string }[], code: LanguageCode = 'fr'): string[] {
  const covered = new Array(text.length).fill(false);
  for (const entry of gloss) for (const at of wholeMatches(text, entry.fr)) for (let i = at; i < at + entry.fr.length; i++) covered[i] = true;
  const missing: string[] = [];
  // A straight apostrophe (song lyrics as written) elides like ’ does.
  for (const match of text.matchAll(/[\p{L}\p{M}]+([’'])?/gu)) {
    const start = match.index!;
    const letters = match[0].replace(/[’']$/, '');
    let fully = true;
    for (let i = start; i < start + letters.length; i++) if (!covered[i]) fully = false;
    if (fully || FUNCTION[code].has(match[0].toLowerCase().replace(/'$/, '’'))) continue;
    missing.push(match[0]);
  }
  return missing;
}

// The lane rules on top of the format: the file name gives the level and the id prefix, every item tags a word,
// and every content word is glossed. Item counts are an authoring rule, checked by scripts/check-comprehension.ts.
export function laneProblems(lane: ComprehensionLane, name: string, known: Known, ids: Set<string>, code: LanguageCode = 'fr'): string[] {
  const errors = validateLane(lane, `${name}.json`, known, ids, code);
  const level = /^(a1|a2|b1)-/.exec(name)?.[1]?.toUpperCase();
  if (!level) errors.push(`lane file name must start with a1-, a2- or b1-.`);
  const sentences = Array.isArray(lane?.sentences) ? lane.sentences : [];
  const passages = Array.isArray(lane?.passages) ? lane.passages : [];
  for (const item of [...sentences, ...passages]) {
    if (typeof item?.id === 'string' && !item.id.startsWith(`${name}-`)) errors.push(`${item.id}: ids must start with "${name}-".`);
    if (level && item?.level !== level) errors.push(`${item?.id}: this lane is ${level}.`);
    if (Array.isArray(item?.words) && !item.words.length) errors.push(`${item.id}: tag at least one vocabulary word it uses.`);
  }
  for (const sentence of sentences) {
    if (typeof sentence?.fr !== 'string' || !Array.isArray(sentence.gloss)) continue;
    const missing = unglossed(sentence.fr, sentence.gloss, code);
    if (missing.length) errors.push(`${sentence.id}: no gloss covers ${missing.join(', ')}.`);
  }
  for (const passage of passages) {
    if (!Array.isArray(passage?.lines) || !Array.isArray(passage.gloss)) continue;
    const missing = [...new Set(passage.lines.flatMap((line) => typeof line?.fr === 'string' ? unglossed(line.fr, passage.gloss, code) : []))];
    if (missing.length) errors.push(`${passage.id}: no gloss covers ${missing.join(', ')}.`);
  }
  return errors;
}

// The deck ids and grammar topic ids a lane may name, from the language's own content folder.
export async function loadKnown(root: string, language: Language = languages(root).fr): Promise<Known> {
  const words = [...await Bun.file(join(language.content, 'core.json')).json(), ...await Bun.file(join(language.content, 'world.json')).json()] as { id: string }[];
  const unitsFile = join(language.content, 'grammar/units.json');
  if (language.code !== 'fr' && !existsSync(unitsFile)) return { words: new Set(words.map((word) => word.id)), topics: new Set(), topicsUnchecked: true };
  const units = await Bun.file(unitsFile).json() as { topics: string[] }[];
  return { words: new Set(words.map((word) => word.id)), topics: new Set(units.flatMap((unit) => unit.topics)) };
}

// A lane file outside French carries the learnt text under the language's code (pt, sv), as its deck does; Echo reads
// it as `fr` everywhere, so the copy is made once, here, before any check.
type Learnt = Record<string, unknown>;
function asInternal(lane: ComprehensionLane, key: LanguageCode): ComprehensionLane {
  if (key === 'fr' || !lane || typeof lane !== 'object') return lane;
  const text = <T extends Learnt>(entry: T) => {
    if (!entry || typeof entry !== 'object') return entry;
    const { [key]: learnt, ...rest } = entry;
    return { ...rest, fr: learnt };
  };
  const gloss = (value: unknown) => Array.isArray(value) ? value.map((entry) => text(entry as Learnt)) : value;
  return {
    ...lane,
    sentences: Array.isArray(lane.sentences) ? lane.sentences.map((sentence) => ({ ...text(sentence as unknown as Learnt), gloss: gloss(sentence?.gloss) }) as unknown as ComprehensionSentence) : lane.sentences,
    passages: Array.isArray(lane.passages) ? lane.passages.map((passage) => ({
      ...passage, gloss: gloss(passage?.gloss),
      lines: Array.isArray(passage?.lines) ? passage.lines.map((line) => text(line as unknown as Learnt) as unknown as PassageLine) : passage?.lines,
    }) as ComprehensionPassage) : lane.passages,
  };
}
export const readLane = async (path: string, language: Language) => asInternal(await Bun.file(path).json() as ComprehensionLane, language.textKey);

const laneFiles = (dir: string) => existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')).sort() : [];

// Loads every lane in the language's content/comprehension (or `dir`); any invalid file there stops startup with every
// problem listed. Lanes Echo wrote itself (`generated`, see lib/text-topup.ts) passed these checks before they were
// saved, so one that no longer does is left out with a logged reason instead of stopping Echo.
export async function loadBank(root: string, dir?: string, generated: string[] = [], language: Language = languages(root).fr): Promise<Bank> {
  const known = await loadKnown(root, language);
  const authored = dir ?? join(language.content, 'comprehension');
  const ids = new Set<string>();
  const bank: Bank = { sentences: [], passages: [] };
  const errors: string[] = [];
  for (const file of laneFiles(authored)) {
    const lane = await readLane(join(authored, file), language);
    errors.push(...validateLane(lane, file, known, ids, language.code));
    if (Array.isArray(lane?.sentences)) bank.sentences.push(...lane.sentences);
    if (Array.isArray(lane?.passages)) bank.passages.push(...lane.passages);
  }
  if (errors.length) throw new StoreError(`Comprehension content is invalid:\n${errors.slice(0, 40).join('\n')}${errors.length > 40 ? `\n…and ${errors.length - 40} more` : ''}`);
  for (const extra of generated) for (const file of laneFiles(extra)) {
    let lane: ComprehensionLane;
    try { lane = await readLane(join(extra, file), language); } catch { console.error(`comprehension: ${join(extra, file)} is not valid JSON; left out`); continue; }
    const trial = new Set(ids);
    const problems = laneProblems(lane, file.slice(0, -5), known, trial, language.code);
    if (problems.length) { console.error(`comprehension: ${join(extra, file)} left out: ${problems.slice(0, 3).join('; ')}`); continue; }
    for (const id of trial) ids.add(id);
    bank.sentences.push(...lane.sentences);
    bank.passages.push(...lane.passages);
  }
  if (!bank.sentences.length) throw new StoreError('Comprehension content is empty.');
  return bank;
}
