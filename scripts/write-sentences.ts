// Writes Sentence cards in bulk with the French top-up (lib/text-topup.ts writeCards): batches of sentences for the
// learner's Practising tenses and the deck words they have met, each checked by the lane rules and the tense detector
// (lib/tenses.ts). Resumable: batch n of a run is <out>/<run>-<nnn>.json, a batch already written is skipped, and a
// batch that fails is left for the next run. It reads the learner's database read-only (a copy is taken in memory and
// worked on in a temporary folder) and writes nothing but its own new files in <out>.
//
// Usage: bun scripts/write-sentences.ts --db <echo.db> --out <folder> [--run sc-bulk] [--count 2000] [--batch 50]
//          [--parallel 2] [--tenses pres,pc]
// The tenses are those on the Practising line the database last saw (Sentence cards, In sentences or Change it), else
// the présent; --tenses chooses them instead. The recordings are made afterwards: scripts/render-clips.py --set sentences.
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadBank } from '../lib/comprehension-content';
import { createClaude } from '../lib/claude';
import { DEFAULT_LINE, lineOf, type PractisingLine } from '../lib/practising';
import { createStore } from '../lib/store';
import { CARD_BATCH, CARD_THEMES, normalFrench, writeCards } from '../lib/text-topup';
import { TENSES, type Tense } from '../lib/verbs';
import type { CardLane } from '../comprehension-contract';
import type { Word } from '../contract';

const root = join(import.meta.dir, '..');
const flag = (name: string, fallback?: string) => { const at = process.argv.indexOf(`--${name}`); return at >= 0 ? process.argv[at + 1] : fallback; };
const dbPath = flag('db');
const out = flag('out');
if (!dbPath || !out || !existsSync(dbPath)) { console.error('Usage: bun scripts/write-sentences.ts --db <echo.db> --out <folder> [--run sc-bulk] [--count 2000] [--batch 50] [--parallel 2] [--tenses pres,pc]'); process.exit(2); }
const run = flag('run', 'sc-bulk')!;
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(run)) { console.error('--run takes lowercase letters, digits and hyphens.'); process.exit(2); }
const count = Number(flag('count', '2000'));
const batch = Number(flag('batch', String(CARD_BATCH)));
const parallel = Math.max(1, Number(flag('parallel', '2')));

// The learner's database, copied read-only into a scratch folder, so the store can read it without touching it.
// A read-only open of a WAL database needs its -shm file, which exists only while Echo has it open; without it no one
// is writing and every change is in the main file, so it opens as immutable.
const scratch = mkdtempSync(join(tmpdir(), 'echo-sentences-'));
let tenses: Tense[];
let words: { id: string; fr: string }[];
try {
  const source = new Database(existsSync(`${dbPath}-shm`) ? dbPath : `file:${encodeURI(resolve(dbPath))}?immutable=1`, { readonly: true });
  const copy = join(scratch, 'echo.db');
  writeFileSync(copy, source.serialize());
  source.close();
  const lines = new Database(copy);
  const remembered = ['sentence_card_line', 'verb_sentence_line', 'change_line'].flatMap((table) => {
    try { return lines.query<{ line_json: string }, []>(`SELECT line_json FROM ${table} WHERE singleton = 1`).all().map((row) => lineOf(JSON.parse(row.line_json))); } catch { return []; }
  }).find((line): line is PractisingLine => !!line && line.tenses.length > 0) ?? DEFAULT_LINE;
  lines.close();
  const chosen = flag('tenses')?.split(',') ?? remembered.tenses;
  tenses = TENSES.filter((tense) => chosen.includes(tense));
  const deck = [...await Bun.file(join(root, 'content/core.json')).json(), ...await Bun.file(join(root, 'content/world.json')).json()] as Word[];
  const store = createStore(deck, { dbPath: copy, ready: () => true });
  words = store.listening().filter((word) => word.status !== 'new').map((word) => ({ id: word.id, fr: word.fr }));
  store.close();
} finally { rmSync(scratch, { recursive: true, force: true }); }
if (!tenses.length) { console.error('No tenses to write for.'); process.exit(2); }

// Every sentence Echo has: the bank, the lanes it wrote next to the database, and the cards already in <out>.
mkdirSync(out, { recursive: true });
const dataDir = join(dbPath, '..');
const bank = await loadBank(root, undefined, [join(dataDir, 'comprehension')]);
const seen = new Set(bank.sentences.map((sentence) => normalFrench(sentence.fr)));
for (const file of readdirSync(out).filter((name) => name.endsWith('.json'))) {
  try { for (const sentence of (await Bun.file(join(out, file)).json() as CardLane).sentences) seen.add(normalFrench(sentence.fr)); } catch { /* a broken file is the server's to leave out */ }
}

const batches = Math.ceil(count / batch);
const names = Array.from({ length: batches }, (_, index) => `${run}-${String(index + 1).padStart(3, '0')}`);
const todo = names.filter((name) => !existsSync(join(out, `${name}.json`)));
console.log(JSON.stringify({ tenses, words: words.length, batches, done: batches - todo.length, todo: todo.length, out }));
const ask = createClaude({ command: process.env.ECHO_CLAUDE ?? join(process.env.HOME ?? '', '.local/bin/claude'), model: process.env.ECHO_CLAUDE_MODEL });
let failed = 0;
async function worker() {
  for (let name = todo.shift(); name; name = todo.shift()) {
    const started = Date.now();
    const index = names.indexOf(name);
    try {
      const lane = await writeCards(root, ask, { tenses, words }, name, CARD_THEMES[index % CARD_THEMES.length]!, new Set(seen), batch);
      // A batch written alongside may have taken a sentence first; it keeps it.
      lane.sentences = lane.sentences.filter((sentence) => !seen.has(normalFrench(sentence.fr)));
      for (const sentence of lane.sentences) seen.add(normalFrench(sentence.fr));
      const path = join(out, `${name}.json`);
      writeFileSync(`${path}.tmp`, JSON.stringify(lane, null, 1));
      renameSync(`${path}.tmp`, path);
      console.log(JSON.stringify({ batch: name, sentences: lane.sentences.length, seconds: Math.round((Date.now() - started) / 1000) }));
    } catch (error) {
      failed += 1;
      console.log(JSON.stringify({ batch: name, failed: (error as Error).message, seconds: Math.round((Date.now() - started) / 1000) }));
    }
  }
}
await Promise.all(Array.from({ length: parallel }, worker));
const written = readdirSync(out).filter((file) => file.startsWith(`${run}-`) && file.endsWith('.json')).length;
console.log(JSON.stringify({ run, written, of: batches, failed }));
process.exit(failed ? 1 : 0);
