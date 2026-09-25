// bun scripts/check-grammar.ts [topicId ...]
// Validates the named topic files (or every file units.json lists that exists) against the content schema,
// then against the course's depth rules. Exits 1 on any problem.
import { join } from 'node:path';
import type { GrammarTopicContent, GrammarUnitContent } from '../contract';
import { glossProblems, validateCourse } from '../lib/grammar-content';

const wordIds = new Set((await Promise.all(['core.json', 'world.json'].map((name) => Bun.file(join(import.meta.dir, '..', 'content', name)).json()))).flat().map((word: { id: string }) => word.id));

const dir = join(import.meta.dir, '..', 'content', 'grammar');
const units = await Bun.file(join(dir, 'units.json')).json() as GrammarUnitContent[];
const unitOf = new Map(units.flatMap((unit) => unit.topics.map((id) => [id, unit] as const)));
const VERB_UNITS = new Set(['present', 'past', 'future-moods']);
const MINIMUM: Record<string, number> = { choose: 8, complete: 6, translate: 6, rewrite: 4, repair: 4, build: 4 };

const requested = process.argv.slice(2);
const ids = requested.length ? requested : [...unitOf.keys()];
let problems = 0;
const allIds = new Map<string, string>();

for (const id of ids) {
  const file = Bun.file(join(dir, `${id}.json`));
  if (!await file.exists()) { if (requested.length) { console.log(`✗ ${id}: no file`); problems++; } continue; }
  const errors: string[] = [];
  let topic: GrammarTopicContent;
  try { topic = await file.json(); } catch (error) { console.log(`✗ ${id}: invalid JSON: ${(error as Error).message}`); problems++; continue; }
  const unit = unitOf.get(id);
  if (!unit) errors.push('not listed in units.json');
  else {
    try { validateCourse({ units: [{ ...unit, topics: [id] }], topics: [topic] }); }
    catch (error) { errors.push((error as Error).message); }
  }
  const exercises = Array.isArray(topic.exercises) ? topic.exercises : [];
  if (exercises.length < 36 || exercises.length > 48) errors.push(`has ${exercises.length} exercises; write 36 to 48.`);
  const byType = new Map<string, number>();
  const byPattern = new Map<string, Set<string>>();
  const perPattern = new Map<string, number>();
  for (const exercise of exercises) {
    byType.set(exercise.type, (byType.get(exercise.type) ?? 0) + 1);
    perPattern.set(exercise.pattern, (perPattern.get(exercise.pattern) ?? 0) + 1);
    if (!byPattern.has(exercise.pattern)) byPattern.set(exercise.pattern, new Set());
    byPattern.get(exercise.pattern)!.add(exercise.type);
    if (typeof exercise.id === 'string' && !exercise.id.startsWith(`${id}-`)) errors.push(`exercise ${exercise.id} should start with "${id}-".`);
    const owner = allIds.get(exercise.id);
    if (owner && owner !== id) errors.push(`exercise ID ${exercise.id} is also used in ${owner}.`);
    allIds.set(exercise.id, id);
    errors.push(...glossProblems(exercise, wordIds));
  }
  for (const [type, minimum] of Object.entries(MINIMUM)) if ((byType.get(type) ?? 0) < minimum) errors.push(`has ${byType.get(type) ?? 0} ${type}; write at least ${minimum}.`);
  if (unit && VERB_UNITS.has(unit.id) && (byType.get('conjugate') ?? 0) < 4) errors.push(`has ${byType.get('conjugate') ?? 0} conjugate; verb topics need at least 4.`);
  if (byPattern.size < 6) errors.push(`has ${byPattern.size} patterns; cover at least 6 distinct points of the rule.`);
  for (const [pattern, count] of perPattern) {
    if (count < 4) errors.push(`pattern ${pattern} has ${count} exercises; give each at least 4.`);
    if (byPattern.get(pattern)!.size < 2) errors.push(`pattern ${pattern} uses only one question type.`);
  }
  const summary = `${exercises.length} exercises · ${byPattern.size} patterns · ${[...byType].map(([type, count]) => `${type} ${count}`).join(', ')}`;
  if (errors.length) { problems += errors.length; console.log(`✗ ${id}: ${summary}`); for (const error of errors) console.log(`    - ${error}`); }
  else console.log(`✓ ${id}: ${summary}`);
}
process.exit(problems ? 1 : 0);
