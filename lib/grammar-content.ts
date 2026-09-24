import { join } from 'node:path';
import type { GrammarExercise, GrammarTopicContent, GrammarUnitContent } from '../contract';
import { StoreError } from './store';

export type Course = { units: GrammarUnitContent[]; topics: GrammarTopicContent[] };
export type Classification = { kind: 'correct' | 'spelling' | 'alternative' | 'incorrect'; message?: string };

const TYPES = new Set(['rewrite', 'build', 'complete', 'repair', 'choose', 'translate', 'conjugate']);
const LEVELS = new Set(['A1', 'A2', 'B1']);

export function normalize(answer: string): string {
  return answer.normalize('NFC').toLocaleLowerCase('fr').replace(/[’‘ʼ]/g, "'")
    .replace(/\s*'\s*/g, "'").replace(/\s+/g, ' ').replace(/\s+([,;:!?])/g, '$1')
    .replace(/[\s.!?…]+$/u, '').trim();
}

// Ligatures are not accents, but a phone keyboard makes "soeur" for "sœur" the same kind of slip.
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
// The loose fallback forgives what no exercise tests — commas, and accents unless strictAccents — as a spelling note.
export function classify(exercise: GrammarExercise, text: string): Classification {
  const given = normalize(text);
  if (!given) return { kind: 'incorrect' };
  const same = (list: string[] | undefined) => !!list?.some((item) => normalize(item) === given);
  if (same(exercise.answers)) return { kind: 'correct' };
  if (exercise.type === 'choose') return { kind: 'incorrect' };
  if (same(exercise.spellingAnswers)) return { kind: 'spelling' };
  const alternative = exercise.alternatives?.find((item) => normalize(item.answer) === given);
  if (alternative) return { kind: 'alternative', message: alternative.message };
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
    for (const field of ['title', 'description', 'mark', 'rule', 'example', 'aside'] as const) text(topic[field], `${topic.id}.${field}`, field === 'aside');
    if (!Array.isArray(topic.exercises) || !topic.exercises.length) fail(`topic ${topic.id} has no exercises.`);
    for (const exercise of topic.exercises) validateExercise(exercise, topic.id, exerciseIds, text, fail);
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
}

export async function loadCourse(dir: string): Promise<Course> {
  const units = await Bun.file(join(dir, 'units.json')).json() as GrammarUnitContent[];
  const topics: GrammarTopicContent[] = [];
  for (const unit of Array.isArray(units) ? units : []) {
    for (const id of Array.isArray(unit?.topics) ? unit.topics : []) {
      const file = Bun.file(join(dir, `${id}.json`));
      if (!await file.exists()) throw new StoreError(`Grammar content: units.json lists ${id}, but there is no ${id}.json.`);
      topics.push(await file.json() as GrammarTopicContent);
    }
  }
  const course = { units, topics };
  validateCourse(course);
  return course;
}
