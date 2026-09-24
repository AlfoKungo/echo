// bun scripts/check-comprehension.ts [lane ...]
// Checks lane files in content/comprehension against the content format and the lane rules below. Exits 1 on any problem.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ComprehensionLane } from '../comprehension-contract';
import { loadKnown, validateLane, wholeMatches } from '../lib/comprehension-content';

const root = join(import.meta.dir, '..');
const dir = join(root, 'content/comprehension');
const known = await loadKnown(root);
const SENTENCES = 50;
const PASSAGES = 9;
// Words a reader never needs to tap. Everything else in the French needs a gloss.
const FUNCTION = new Set(['le', 'la', 'les', 'l’', 'un', 'une', 'des', 'de', 'du', 'd’', 'à', 'au', 'aux', 'et', 'ou', 'mais',
  'je', 'j’', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'ne', 'n’', 'pas', 'que', 'qu’', 'ce', 'c’', 'se', 's’',
  'me', 'm’', 'te', 't’', 'y', 'en']);

const requested = process.argv.slice(2);
const lanes = requested.length ? requested : readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)).sort();
const ids = new Set<string>();
let problems = 0;

function unglossed(text: string, gloss: { fr: string }[]): string[] {
  const covered = new Array(text.length).fill(false);
  for (const entry of gloss) for (const at of wholeMatches(text, entry.fr)) for (let i = at; i < at + entry.fr.length; i++) covered[i] = true;
  const missing: string[] = [];
  for (const match of text.matchAll(/[\p{L}\p{M}]+(’)?/gu)) {
    const start = match.index!;
    const letters = match[0].replace(/’$/, '');
    let fully = true;
    for (let i = start; i < start + letters.length; i++) if (!covered[i]) fully = false;
    if (fully || FUNCTION.has(match[0].toLowerCase())) continue;
    missing.push(match[0]);
  }
  return missing;
}

for (const name of lanes) {
  const path = join(dir, `${name}.json`);
  if (!existsSync(path)) { console.log(`✗ ${name}: no file`); problems++; continue; }
  let lane: ComprehensionLane;
  try { lane = await Bun.file(path).json(); } catch (error) { console.log(`✗ ${name}: invalid JSON: ${(error as Error).message}`); problems++; continue; }
  const errors = validateLane(lane, `${name}.json`, known, ids);
  const level = /^(a1|a2|b1)-/.exec(name)?.[1]?.toUpperCase();
  if (!level) errors.push(`lane file name must start with a1-, a2- or b1-.`);
  const sentences = Array.isArray(lane.sentences) ? lane.sentences : [];
  const passages = Array.isArray(lane.passages) ? lane.passages : [];
  if (sentences.length !== SENTENCES) errors.push(`has ${sentences.length} sentences; write exactly ${SENTENCES}.`);
  if (passages.length !== PASSAGES) errors.push(`has ${passages.length} passages; write exactly ${PASSAGES}.`);
  const dialogues = passages.filter((passage) => passage.kind === 'dialogue').length;
  if (dialogues < 3 || passages.length - dialogues < 3) errors.push(`needs at least 3 dialogues and 3 texts (has ${dialogues} and ${passages.length - dialogues}).`);
  for (const item of [...sentences, ...passages]) {
    if (typeof item?.id === 'string' && !item.id.startsWith(`${name}-`)) errors.push(`${item.id}: ids must start with "${name}-".`);
    if (level && item?.level !== level) errors.push(`${item?.id}: this lane is ${level}.`);
    if (Array.isArray(item?.words) && !item.words.length) errors.push(`${item.id}: tag at least one vocabulary word it uses.`);
  }
  for (const sentence of sentences) {
    if (typeof sentence?.fr !== 'string' || !Array.isArray(sentence.gloss)) continue;
    const missing = unglossed(sentence.fr, sentence.gloss);
    if (missing.length) errors.push(`${sentence.id}: no gloss covers ${missing.join(', ')}.`);
  }
  for (const passage of passages) {
    if (!Array.isArray(passage?.lines) || !Array.isArray(passage.gloss)) continue;
    const missing = [...new Set(passage.lines.flatMap((line) => typeof line?.fr === 'string' ? unglossed(line.fr, passage.gloss) : []))];
    if (missing.length) errors.push(`${passage.id}: no gloss covers ${missing.join(', ')}.`);
  }
  const summary = `${sentences.length} sentences · ${passages.length} passages (${dialogues} dialogues)`;
  if (errors.length) { problems += errors.length; console.log(`✗ ${name}: ${summary}`); for (const error of errors.slice(0, 60)) console.log(`    - ${error}`); if (errors.length > 60) console.log(`    …and ${errors.length - 60} more`); }
  else console.log(`✓ ${name}: ${summary}`);
}
process.exit(problems ? 1 : 0);
