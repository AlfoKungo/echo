// Writes content/word-building.json: the patterns the word families are built by, sorted by Opus from
// content/families.json and checked by lib/families.ts. Unsound patterns are dropped and listed; with too few
// sound ones it asks again, naming the problems. Run from the repo root: bun scripts/make-word-building.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClaude } from '../lib/claude';
import { familyIndex, loadFamilies, patternProblems, patternsPrompt } from '../lib/families';
import type { Word, WordPattern } from '../contract';

const root = join(import.meta.dir, '..');
const deck = [
  ...await Bun.file(join(root, 'content/core.json')).json() as Word[],
  ...await Bun.file(join(root, 'content/world.json')).json() as Word[],
];
const byId = new Map(deck.map((word) => [word.id, word]));
const families = loadFamilies(root, deck);
const familyOf = familyIndex(families);
const ask = createClaude({ command: process.env.ECHO_CLAUDE ?? join(process.env.HOME ?? '', '.local/bin/claude') });

let problems: string[] = [];
for (let round = 1; round <= 3; round++) {
  const reply = await ask(patternsPrompt(families, byId, problems), { timeout: 15 * 60_000, purpose: 'sorting word-building patterns' });
  let patterns: WordPattern[] = [];
  try { patterns = (JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)) as { patterns: WordPattern[] }).patterns ?? []; } catch { problems = ['reply with JSON only.']; continue; }
  const used = new Set<string>();
  const sound: WordPattern[] = [];
  problems = [];
  for (const pattern of patterns) {
    const found = patternProblems(pattern, familyOf, used);
    if (found.length) { problems.push(...found); continue; }
    for (const [from, to] of pattern.examples) used.add(`${from}>${to}`);
    sound.push({ title: pattern.title.trim(), explanation: pattern.explanation.trim(), ...(pattern.tip?.trim() ? { tip: pattern.tip.trim() } : {}), examples: pattern.examples });
  }
  console.log(`round ${round}: ${sound.length} sound patterns of ${patterns.length}, ${used.size} examples`);
  for (const problem of problems) console.log(`  dropped: ${problem}`);
  if (sound.length >= 5) {
    writeFileSync(join(root, 'content/word-building.json'), `${JSON.stringify({ patterns: sound }, null, 1)}\n`);
    process.exit(0);
  }
}
console.error('No usable set of patterns after 3 rounds.');
process.exit(1);
