// bun scripts/check-sounds.ts
// Checks content/sounds.json against the sounds rules (lib/sounds.ts) and prints a line per contrast. Exits 1 on any problem.
import { join } from 'node:path';
import { soundProblems, type SoundsContent } from '../lib/sounds';

const content = await Bun.file(join(import.meta.dir, '..', 'content', 'sounds.json')).json() as SoundsContent;
const problems = soundProblems(content);
for (const contrast of content.contrasts ?? []) console.log(`${problems.some((problem) => problem.startsWith(`contrast ${contrast.id}`)) ? '✗' : '✓'} ${contrast.id}: ${contrast.items?.length ?? 0} pairs`);
for (const problem of problems) console.log(`    - ${problem}`);
process.exit(problems.length ? 1 : 0);
