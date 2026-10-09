import { join } from 'node:path';
import type { GrammarExercise, GrammarGuideSection, GrammarTopicContent, GrammarUnitContent } from '../contract';
import { StoreError } from './store';
import { unglossed, wholeMatches } from './comprehension-content';
import type { LanguageCode } from './language';

// Question types whose source is a French sentence the learner reads; its words carry glosses.
export const GLOSSED_TYPES = new Set(['choose', 'complete', 'repair', 'rewrite']);

// A gloss covers every content word of the source, as in Read, names words and phrases that stand whole in it, and
// never names a word of the answer a choose or complete question asks for. `wordIds` checks vocabulary links.
export function glossProblems(exercise: GrammarExercise, wordIds?: Set<string>, code: LanguageCode = 'fr'): string[] {
  const where = `${exercise.id}.gloss`;
  const gloss = exercise.gloss;
  if (!GLOSSED_TYPES.has(exercise.type)) return gloss === undefined ? [] : [`${where}: only ${[...GLOSSED_TYPES].join(', ')} questions carry a gloss.`];
  if (!Array.isArray(gloss) || !gloss.length) return [`${where} is missing: list the meaning of each content word in the source.`];
  const problems: string[] = [];
  const seen = new Set<string>();
  // Words of the answer the source does not already show: naming one in English would give it away.
  const shown = new Set(normalize(exercise.source).split(/[^\p{L}]+/u));
  const asked = exercise.type === 'choose' || exercise.type === 'complete'
    ? exercise.answers.flatMap((answer) => normalize(answer).split(/[\s']+/)).filter((word) => word.length > 1 && !shown.has(word)) : [];
  for (const entry of gloss) {
    if (!entry || typeof entry.fr !== 'string' || !entry.fr.trim() || typeof entry.en !== 'string' || !entry.en.trim()) { problems.push(`${where}: every entry needs fr and en text.`); continue; }
    if (seen.has(entry.fr)) problems.push(`${where} repeats "${entry.fr}".`);
    seen.add(entry.fr);
    if (!wholeMatches(exercise.source, entry.fr).length) problems.push(`${where}: "${entry.fr}" is not a whole word or phrase in the source.`);
    if (entry.word !== undefined && wordIds && !wordIds.has(entry.word)) problems.push(`${where}: "${entry.fr}" links unknown vocabulary id ${entry.word}.`);
    const english = ` ${normalize(entry.en).replace(/[^\p{L}' ]+/gu, ' ')} `;
    for (const word of asked) if (english.includes(` ${word} `)) problems.push(`${where}: "${entry.fr}" is glossed "${entry.en}", which names "${word}" from the answer.`);
  }
  const missing = unglossed(exercise.source, gloss.filter((entry) => typeof entry?.fr === 'string'), code);
  if (missing.length) problems.push(`${where} leaves ${missing.map((word) => `"${word}"`).join(', ')} without a meaning.`);
  return problems;
}

// code names the language the course teaches (French when absent), which decides the words a gloss may leave out.
export type Course = { units: GrammarUnitContent[]; topics: GrammarTopicContent[]; code?: LanguageCode };
export type Classification = { kind: 'correct' | 'spelling' | 'alternative' | 'incorrect'; message?: string };

const TYPES = new Set(['rewrite', 'build', 'complete', 'repair', 'choose', 'translate', 'conjugate']);
const LEVELS = new Set(['A1', 'A2', 'B1']);

export function normalize(answer: string): string {
  return answer.normalize('NFC').toLocaleLowerCase('fr').replace(/[’‘ʼ]/g, "'")
    .replace(/\s*'\s*/g, "'").replace(/\s+/g, ' ').replace(/\s+([,;:!?])/g, '$1')
    .replace(/[\s.!?…]+$/u, '').trim();
}

// Ligatures are not accents, but a phone keyboard makes "soeur" for "sœur" the same kind of slip. Decomposing also
// folds Portuguese ã, ç, é… and Swedish å, ä, ö to their bare letters, so a missing mark is a spelling slip in every
// language; strictAccents keeps it wrong where the mark makes another word (pt e/é, sv har/här).
export function stripAccents(normalized: string): string {
  return normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFC');
}

export function joinTokens(tokens: string[]): string {
  return tokens.join(' ').replace(/(['’‘ʼ])\s+/g, '$1').replace(/\s+([,.;:!?…])/g, '$1');
}

// The French sentence to speak for an exercise: the finished sentence where the question hides one, the answer otherwise.
// A conjugate answer is listed twice, bare and with its subject ("finissons", "nous finissons"); the longer one is speakable.
// A filled sentence drops its bracketed cues — "(prendre)", "(to a girl)" tell the reader what to write and are not
// part of the sentence — glues the answer to a leading elision ("j’" + "irais"), and keeps the space before ? ! : ;.
export function grammarSpeech(exercise: GrammarExercise): string {
  const answer = exercise.type === 'conjugate'
    ? exercise.answers.reduce((longest, item) => (item.length > longest.length ? item : longest))
    : exercise.answers[0]!;
  if (exercise.type !== 'complete' && exercise.type !== 'choose') return answer;
  if (!/_{2,}/.test(exercise.source)) return answer;
  return exercise.source.replace(/_{2,}/, answer).replace(/\s*\([^()]*\)/g, '')
    .replace(/\s+/g, ' ').replace(/(['’‘ʼ])\s+/g, '$1').replace(/\s+([,.…])/g, '$1').trim();
}

// Check token phrases as units, not a bag of words: a multiword token cannot be split. Unused tiles are distractors.
export function canBuild(tokens: string[], answer: string): boolean {
  const target = normalize(answer);
  const failed = new Set<string>();
  function visit(remaining: number[], selected: string[]): boolean {
    const prefix = normalize(joinTokens(selected));
    if (!target.startsWith(prefix)) return false;
    if (prefix === target) return true;
    if (!remaining.length) return false;
    const key = `${remaining.join(',')}|${prefix}`;
    if (failed.has(key)) return false;
    const tried = new Set<string>();
    for (const index of remaining) {
      if (tried.has(tokens[index]!)) continue;
      tried.add(tokens[index]!);
      if (visit(remaining.filter((value) => value !== index), [...selected, tokens[index]!])) return true;
    }
    failed.add(key);
    return false;
  }
  return visit(tokens.map((_, index) => index), []);
}

// Order matters: an exact accepted answer beats a listed near-miss, and a listed near-miss beats the loose fallback.
// An alternative marked accepted counts as right, with its message kept as a note.
// The loose fallback forgives what no exercise tests — commas, and accents unless strictAccents — as a spelling note.
export function classify(exercise: GrammarExercise, text: string): Classification {
  const given = normalize(text);
  if (!given) return { kind: 'incorrect' };
  const same = (list: string[] | undefined) => !!list?.some((item) => normalize(item) === given);
  if (same(exercise.answers)) return { kind: 'correct' };
  if (exercise.type === 'choose') return { kind: 'incorrect' };
  if (same(exercise.spellingAnswers)) return { kind: 'spelling' };
  const alternative = exercise.alternatives?.find((item) => normalize(item.answer) === given);
  if (alternative) return { kind: alternative.accepted ? 'correct' : 'alternative', message: alternative.message };
  if (exercise.type !== 'build') {
    const loose = (value: string) => {
      const bare = value.replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim();
      return exercise.strictAccents ? bare : stripAccents(bare);
    };
    const target = loose(given);
    if (exercise.answers.some((item) => loose(normalize(item)) === target)) return { kind: 'spelling' };
  }
  return { kind: 'incorrect' };
}

const loosely = (value: string, strict: boolean | undefined) => {
  const bare = normalize(value).replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return strict ? bare : stripAccents(bare);
};

// Why a wrong answer is wrong, when it is one the exercise anticipated: the same text, or the same but for accents
// and commas (unless the accent is the point).
export function mistakeFor(exercise: GrammarExercise, text: string): string | null {
  const given = normalize(text);
  if (!given) return null;
  const exact = exercise.mistakes.find((mistake) => mistake.answers.some((answer) => normalize(answer) === given));
  if (exact) return exact.why;
  if (exercise.type === 'choose') return null;
  const target = loosely(text, exercise.strictAccents);
  return exercise.mistakes.find((mistake) => mistake.answers.some((answer) => loosely(answer, exercise.strictAccents) === target))?.why ?? null;
}

const SECTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateGuide(topic: GrammarTopicContent, text: (value: unknown, label: string, allowEmpty?: boolean) => asserts value is string, fail: (message: string) => never): Map<string, GrammarGuideSection> {
  const guide = topic.guide;
  const where = `${topic.id}.guide`;
  if (!guide || typeof guide !== 'object') fail(`${where} is missing.`);
  text(guide.summary, `${where}.summary`);
  if (!Array.isArray(guide.sections) || guide.sections.length < 2 || guide.sections.length > 8) fail(`${where} needs 2 to 8 sections.`);
  const sections = new Map<string, GrammarGuideSection>();
  const list = (value: unknown, label: string, min: number, max: number) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label} needs ${min} to ${max} entries.`);
    (value as unknown[]).forEach((entry) => text(entry, label));
  };
  for (const section of guide.sections) {
    if (!section || typeof section !== 'object') fail(`${where} has an invalid section.`);
    text(section.id, `${where} section id`);
    const label = `${where}.${section.id}`;
    if (!SECTION_ID.test(section.id) || sections.has(section.id)) fail(`${label}: section ids are unique lowercase-hyphen names.`);
    sections.set(section.id, section);
    text(section.title, `${label}.title`);
    if (section.text !== undefined) text(section.text, `${label}.text`);
    if (section.table !== undefined) {
      const table = section.table;
      if (!table || !Array.isArray(table.columns) || table.columns.length < 2 || table.columns.length > 4) fail(`${label}.table needs 2 to 4 columns.`);
      table.columns.forEach((column) => text(column, `${label}.table column`, true));
      if (!Array.isArray(table.rows) || !table.rows.length || table.rows.length > 14) fail(`${label}.table needs 1 to 14 rows.`);
      const labels = new Set<string>();
      for (const row of table.rows) {
        if (!Array.isArray(row) || row.length !== table.columns.length) fail(`${label}.table: every row has one cell per column.`);
        row.forEach((cell) => text(cell, `${label}.table cell`, true));
        if (!row[0]!.trim() || labels.has(row[0]!)) fail(`${label}.table: row labels (first cells) must be filled and unique; "${row[0]}" is not.`);
        labels.add(row[0]!);
      }
    }
    if (section.steps !== undefined) list(section.steps, `${label}.steps`, 2, 5);
    if (section.watch !== undefined) list(section.watch, `${label}.watch`, 1, 4);
    if (section.text === undefined && section.table === undefined && section.steps === undefined) fail(`${label} needs text, a table or steps.`);
    if (!Array.isArray(section.examples) || !section.examples.length || section.examples.length > 4) fail(`${label} needs 1 to 4 examples.`);
    for (const example of section.examples) { text(example?.fr, `${label} example fr`); text(example.en, `${label} example en`); }
  }
  const patterns = topic.patterns;
  if (!patterns || typeof patterns !== 'object') fail(`${topic.id}.patterns is missing.`);
  const used = new Set(topic.exercises.map((exercise) => exercise.pattern));
  for (const pattern of used) if (!patterns[pattern]) fail(`${topic.id}.patterns has no entry for pattern ${pattern}.`);
  for (const [pattern, help] of Object.entries(patterns)) {
    if (!used.has(pattern)) fail(`${topic.id}.patterns.${pattern} is not used by any exercise.`);
    if (!sections.has(help?.section)) fail(`${topic.id}.patterns.${pattern} names section ${help?.section}, which the guide does not have.`);
    list(help.steps, `${topic.id}.patterns.${pattern}.steps`, 2, 4);
  }
  return sections;
}

export function validateCourse(course: Course): void {
  const { units, topics } = course;
  const fail = (message: string): never => { throw new StoreError(`Grammar content: ${message}`); };
  function text(value: unknown, label: string, allowEmpty = false): asserts value is string {
    if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || /<\/?[A-Za-z][^>]*>/.test(value)) fail(`invalid plain text at ${label}.`);
  }
  if (!Array.isArray(units) || !units.length) fail('units.json must list at least one unit.');
  const unitIds = new Set<string>();
  const listed = new Map<string, string>();
  for (const unit of units) {
    text(unit?.id, 'unit ID');
    if (unitIds.has(unit.id)) fail(`duplicate unit ${unit.id}.`);
    unitIds.add(unit.id);
    text(unit.title, `${unit.id}.title`); text(unit.description, `${unit.id}.description`);
    if (!Array.isArray(unit.topics) || !unit.topics.length) fail(`unit ${unit.id} lists no topics.`);
    for (const id of unit.topics) {
      text(id, `${unit.id} topic`);
      if (listed.has(id)) fail(`topic ${id} is listed in more than one unit.`);
      listed.set(id, unit.id);
    }
  }
  const topicIds = new Set<string>();
  const exerciseIds = new Set<string>();
  for (const topic of topics) {
    if (!topic || typeof topic !== 'object') fail('a topic file is not an object.');
    text(topic.id, 'topic ID');
    if (topicIds.has(topic.id)) fail(`duplicate topic ${topic.id}.`);
    topicIds.add(topic.id);
    if (listed.get(topic.id) !== topic.unit) fail(`topic ${topic.id} says unit ${topic.unit}, but units.json places it in ${listed.get(topic.id) ?? 'no unit'}.`);
    if (!LEVELS.has(topic.level)) fail(`topic ${topic.id} has level ${topic.level}; use A1, A2 or B1.`);
    for (const field of ['title', 'description', 'mark'] as const) text(topic[field], `${topic.id}.${field}`);
    if (!Array.isArray(topic.exercises) || !topic.exercises.length) fail(`topic ${topic.id} has no exercises.`);
    for (const exercise of topic.exercises) {
      validateExercise(exercise, topic.id, exerciseIds, text, fail);
      if (exercise.gloss !== undefined) { const problem = glossProblems(exercise, undefined, course.code)[0]; if (problem) fail(problem); }
    }
    const sections = validateGuide(topic, text, fail);
    for (const exercise of topic.exercises) {
      if (exercise.row === undefined) continue;
      text(exercise.row, `${exercise.id}.row`);
      const table = sections.get(topic.patterns[exercise.pattern]!.section)?.table;
      if (!table?.rows.some((row) => row[0] === exercise.row)) fail(`${exercise.id}.row "${exercise.row}" is not a row label in the table of section ${topic.patterns[exercise.pattern]!.section}.`);
    }
  }
  for (const id of listed.keys()) if (!topicIds.has(id)) fail(`units.json lists ${id}, but there is no ${id}.json.`);
}

function validateExercise(
  exercise: GrammarExercise, topicId: string, ids: Set<string>,
  text: (value: unknown, label: string, allowEmpty?: boolean) => asserts value is string,
  fail: (message: string) => never,
): void {
  if (!exercise || typeof exercise !== 'object') fail(`topic ${topicId} contains an invalid exercise.`);
  text(exercise.id, `${topicId} exercise ID`);
  const label = exercise.id;
  if (exercise.id !== exercise.id.trim() || ids.has(exercise.id)) fail(`exercise ID ${label} is duplicated or padded.`);
  ids.add(exercise.id);
  if (!TYPES.has(exercise.type)) fail(`${label} has unknown type ${exercise.type}.`);
  for (const field of ['pattern', 'instruction', 'source', 'hint', 'feedback', 'explanation'] as const) text(exercise[field], `${label}.${field}`);
  if (exercise.strictAccents !== undefined && typeof exercise.strictAccents !== 'boolean') fail(`${label}.strictAccents must be true or false.`);
  if (!Array.isArray(exercise.answers) || !exercise.answers.length) fail(`${label} has no accepted answers.`);
  const seen = new Set<string>();
  const unique = (value: unknown, what: string) => {
    text(value, `${label} ${what}`);
    const key = normalize(value);
    if (!key || seen.has(key)) fail(`${label} has an empty or repeated ${what}: "${value}".`);
    seen.add(key);
  };
  exercise.answers.forEach((value) => unique(value, 'answer'));
  if (exercise.spellingAnswers !== undefined) {
    if (!Array.isArray(exercise.spellingAnswers)) fail(`${label}.spellingAnswers must be a list.`);
    exercise.spellingAnswers.forEach((value) => unique(value, 'spelling answer'));
  }
  if (exercise.alternatives !== undefined) {
    if (!Array.isArray(exercise.alternatives)) fail(`${label}.alternatives must be a list.`);
    for (const alternative of exercise.alternatives) {
      unique(alternative?.answer, 'alternative');
      text(alternative.message, `${label} alternative message`);
      if (alternative.accepted !== undefined && typeof alternative.accepted !== 'boolean') fail(`${label} alternative accepted must be true or false.`);
    }
  }
  if (exercise.type !== 'build' && exercise.tokens !== undefined) fail(`${label} has tiles but is not a build exercise.`);
  if (exercise.type !== 'choose' && exercise.options !== undefined) fail(`${label} has options but is not a choose exercise.`);
  switch (exercise.type) {
    case 'build':
      if (!Array.isArray(exercise.tokens) || exercise.tokens.length < 2) fail(`${label} needs at least two tiles.`);
      exercise.tokens.forEach((token) => text(token, `${label} tile`));
      for (const accepted of exercise.answers) if (!canBuild(exercise.tokens, accepted)) fail(`${label}: "${accepted}" cannot be built from its tiles.`);
      break;
    case 'choose': {
      if (!Array.isArray(exercise.options) || exercise.options.length < 2 || exercise.options.length > 5) fail(`${label} needs 2 to 5 options.`);
      const options = new Set<string>();
      for (const option of exercise.options) {
        text(option, `${label} option`);
        if (options.has(normalize(option))) fail(`${label} repeats the option "${option}".`);
        options.add(normalize(option));
      }
      if (exercise.answers.length !== 1 || !options.has(normalize(exercise.answers[0]!))) fail(`${label} must have exactly one answer, taken from its options.`);
      if (exercise.spellingAnswers?.length || exercise.alternatives?.length) fail(`${label}: choose exercises take no spelling answers or alternatives.`);
      break;
    }
    case 'complete':
      if ((exercise.source.match(/_{2,}/g) ?? []).length !== 1) fail(`${label} must contain exactly one ____ blank.`);
      break;
    case 'conjugate':
      if (exercise.source.split(' · ').length !== 3) fail(`${label} source must read "verb · subject · tense".`);
      break;
  }
  // Every listed mistake must be wrong as checked: classify would otherwise accept it, note it or call it spelling.
  if (!Array.isArray(exercise.mistakes)) fail(`${label}.mistakes must be a list.`);
  const wrong = new Set<string>();
  for (const mistake of exercise.mistakes) {
    if (!mistake || !Array.isArray(mistake.answers) || !mistake.answers.length) fail(`${label}: each mistake lists at least one answer.`);
    text(mistake.why, `${label} mistake why`);
    for (const answer of mistake.answers) {
      text(answer, `${label} mistake answer`);
      const key = normalize(answer);
      if (!key || wrong.has(key)) fail(`${label} lists the mistake "${answer}" twice or empty.`);
      wrong.add(key);
      if (classify(exercise, answer).kind !== 'incorrect') fail(`${label}: the mistake "${answer}" is accepted, noted or treated as spelling; it cannot be a mistake.`);
      if (exercise.type === 'choose' && !exercise.options!.some((option) => normalize(option) === key)) fail(`${label}: the mistake "${answer}" is not one of its options.`);
      if (exercise.type === 'build' && !canBuild(exercise.tokens!, answer)) fail(`${label}: the mistake "${answer}" cannot be built from its tiles.`);
    }
    for (const accepted of exercise.answers) {
      const right = normalize(accepted).replace(/[.!?]+$/, '');
      if (right.length > 2 && ` ${normalize(mistake.why)} `.includes(` ${right} `)) fail(`${label}: a mistake's why gives away the answer "${accepted}".`);
    }
  }
  if (exercise.type === 'choose') {
    for (const option of exercise.options!) {
      if (normalize(option) !== normalize(exercise.answers[0]!) && !wrong.has(normalize(option))) fail(`${label}: the option "${option}" has no mistake explaining it.`);
    }
  } else if (!exercise.mistakes.length || exercise.mistakes.length > 5) fail(`${label} needs 1 to 5 mistakes.`);
}

// A course outside French writes the learnt text of guide examples and glosses under its language's key (pt, sv), as
// its deck does; loading copies it into Echo's internal fr field.
export async function loadCourse(dir: string, code: LanguageCode = 'fr'): Promise<Course> {
  const units = await Bun.file(join(dir, 'units.json')).json() as GrammarUnitContent[];
  const topics: GrammarTopicContent[] = [];
  for (const unit of Array.isArray(units) ? units : []) {
    for (const id of Array.isArray(unit?.topics) ? unit.topics : []) {
      const file = Bun.file(join(dir, `${id}.json`));
      if (!await file.exists()) throw new StoreError(`Grammar content: units.json lists ${id}, but there is no ${id}.json.`);
      const topic = await file.json() as GrammarTopicContent;
      topics.push(code === 'fr' ? topic : fromLanguageKey(topic, code));
    }
  }
  const course: Course = code === 'fr' ? { units, topics } : { units, topics, code };
  validateCourse(course);
  return course;
}

export function fromLanguageKey(topic: GrammarTopicContent, code: LanguageCode): GrammarTopicContent {
  const mapped = <T extends object>(entry: T): T => {
    if (!entry || typeof entry !== 'object' || !(code in entry)) return entry;
    const { [code]: text, ...rest } = entry as Record<string, unknown>;
    return { ...rest, fr: text } as T;
  };
  return {
    ...topic,
    guide: topic.guide && Array.isArray(topic.guide.sections)
      ? { ...topic.guide, sections: topic.guide.sections.map((section) => (Array.isArray(section?.examples) ? { ...section, examples: section.examples.map(mapped) } : section)) }
      : topic.guide,
    exercises: Array.isArray(topic.exercises)
      ? topic.exercises.map((exercise) => (Array.isArray(exercise?.gloss) ? { ...exercise, gloss: exercise.gloss.map(mapped) } : exercise))
      : topic.exercises,
  };
}
