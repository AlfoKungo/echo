// Writes content/families.json: the deck's word families, grouped by Opus and checked by lib/families.ts.
// Unsound families are dropped and listed; with too few sound ones it asks again, naming the problems.
// Run from the repo root: bun scripts/make-families.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClaude } from '../lib/claude';
import { familiesPrompt, familyProblems } from '../lib/families';
import type { Word, WordFamily } from '../contract';

const root = join(import.meta.dir, '..');
const deck = [
  ...await Bun.file(join(root, 'content/core.json')).json() as Word[],
  ...await Bun.file(join(root, 'content/world.json')).json() as Word[],
];
const byId = new Map(deck.map((word) => [word.id, word]));
const ask = createClaude({ command: process.env.ECHO_CLAUDE ?? join(process.env.HOME ?? '', '.local/bin/claude') });

let problems: string[] = [];
for (let round = 1; round <= 3; round++) {
  const reply = await ask(familiesPrompt(deck, problems), { timeout: 20 * 60_000, purpose: 'grouping word families' });
  let families: WordFamily[] = [];
  try { families = (JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)) as { families: WordFamily[] }).families ?? []; } catch { problems = ['reply with JSON only.']; continue; }
  const used = new Set<string>();
  const sound: WordFamily[] = [];
  problems = [];
  for (const family of families) {
    const found = familyProblems(family, byId, used);
    if (found.length) { problems.push(...found); continue; }
    for (const member of family.members) used.add(member.id);
    sound.push({ members: family.members.map((member, index) => index === 0 ? { id: member.id } : { id: member.id, note: member.note!.trim() }) });
  }
  console.log(`round ${round}: ${sound.length} sound families of ${families.length}, ${used.size} words`);
  for (const problem of problems) console.log(`  dropped: ${problem}`);
  if (sound.length >= 40) {
    writeFileSync(join(root, 'content/families.json'), `${JSON.stringify({ families: sound }, null, 1)}\n`);
    process.exit(0);
  }
}
console.error('No usable set of families after 3 rounds.');
process.exit(1);
