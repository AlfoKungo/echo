// bun scripts/check-comprehension.ts [--lang pt|sv] [lane ...]
// Checks lane files in the language's content/comprehension (French unless --lang is given) against the content
// format and the lane rules (lib/comprehension-content.ts), plus the authoring counts below. Exits 1 on any problem.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ComprehensionLane } from '../comprehension-contract';
import { laneProblems, loadKnown, readLane } from '../lib/comprehension-content';
import { LANGUAGE_CODES, languages, type LanguageCode } from '../lib/language';

const root = join(import.meta.dir, '..');
const flag = process.argv.indexOf('--lang');
const code = (flag >= 0 ? process.argv[flag + 1] : 'fr') as LanguageCode;
if (!LANGUAGE_CODES.includes(code)) { console.log(`--lang must be one of ${LANGUAGE_CODES.join(', ')}`); process.exit(2); }
const language = languages(root)[code];
const dir = join(language.content, 'comprehension');
const known = await loadKnown(root, language);
const SENTENCES = 50;
const PASSAGES = 9;

const requested = process.argv.slice(2).filter((_, index) => flag < 0 || (index !== flag - 2 && index !== flag - 1));
const lanes = requested.length ? requested : readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)).sort();
const ids = new Set<string>();
let problems = 0;

for (const name of lanes) {
  const path = join(dir, `${name}.json`);
  if (!existsSync(path)) { console.log(`✗ ${name}: no file`); problems++; continue; }
  let lane: ComprehensionLane;
  try { lane = await readLane(path, language); } catch (error) { console.log(`✗ ${name}: invalid JSON: ${(error as Error).message}`); problems++; continue; }
  const errors = laneProblems(lane, name, known, ids, code);
  const sentences = Array.isArray(lane.sentences) ? lane.sentences : [];
  const passages = Array.isArray(lane.passages) ? lane.passages : [];
  if (sentences.length !== SENTENCES) errors.push(`has ${sentences.length} sentences; write exactly ${SENTENCES}.`);
  if (passages.length !== PASSAGES) errors.push(`has ${passages.length} passages; write exactly ${PASSAGES}.`);
  const dialogues = passages.filter((passage) => passage.kind === 'dialogue').length;
  if (dialogues < 3 || passages.length - dialogues < 3) errors.push(`needs at least 3 dialogues and 3 texts (has ${dialogues} and ${passages.length - dialogues}).`);
  const summary = `${sentences.length} sentences · ${passages.length} passages (${dialogues} dialogues)`;
  if (errors.length) { problems += errors.length; console.log(`✗ ${name}: ${summary}`); for (const error of errors.slice(0, 60)) console.log(`    - ${error}`); if (errors.length > 60) console.log(`    …and ${errors.length - 60} more`); }
  else console.log(`✓ ${name}: ${summary}`);
}
if (known.topicsUnchecked) console.log(`(grammar topic tags unchecked: ${join(language.content, 'grammar/units.json')} is not written yet)`);
process.exit(problems ? 1 : 0);
