// The Practising line for drills Claude writes ahead (In sentences, Change it): the client sends its line with each
// request, the drill keeps the last usable one so its background batches write for it (after a restart too), and
// verbs.practising() (lib/verb-drills.ts) turns a line into verbs and tenses.
import type { Database } from 'bun:sqlite';
import { TENSES, type Tense, type Verb } from './verbs';

// What the client's line holds (vbPractising in static/app.js).
export type PractisingLine = { set: string; verbIds: string[]; tenses: string[] };
export type Practising = { verbs: Verb[]; tenses: Tense[] };
// The client's own line until the learner changes it, so a drill never sent one writes for what the client shows.
export const DEFAULT_LINE: PractisingLine = { set: 'mine', verbIds: [], tenses: ['pres'] };
// The share of a batch each tense takes when all four are chosen: passé composé most, then présent, imparfait, futur.
export const TENSE_MIX: Record<Tense, number> = { pc: 0.35, pres: 0.3, imp: 0.2, fut: 0.15 };
const MIX_ORDER = Object.keys(TENSE_MIX) as Tense[];

// How many of a batch go to each chosen tense: TENSE_MIX restricted to `tenses` and renormalized, rounded by largest
// remainder so a batch always adds up; a tense not chosen gets none.
export function mixCounts(count: number, tenses: readonly Tense[] = TENSES): Record<Tense, number> {
  const chosen = MIX_ORDER.filter((tense) => tenses.includes(tense));
  const total = chosen.reduce((sum, tense) => sum + TENSE_MIX[tense], 0);
  const rows = chosen.map((tense) => { const exact = TENSE_MIX[tense] / total * count; return { tense, exact, n: Math.floor(exact) }; });
  let left = count - rows.reduce((sum, row) => sum + row.n, 0);
  for (const row of [...rows].sort((a, b) => (b.exact - b.n) - (a.exact - a.n))) { if (left-- <= 0) break; row.n++; }
  return Object.fromEntries(TENSES.map((tense) => [tense, rows.find((row) => row.tense === tense)?.n ?? 0])) as Record<Tense, number>;
}

// A line as a request sent it, or null when none was sent.
export function lineOf(value: unknown): PractisingLine | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const strings = (list: unknown) => (Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string').slice(0, 500) : []);
  return { set: typeof raw.set === 'string' ? raw.set : '', verbIds: strings(raw.verbIds), tenses: strings(raw.tenses) };
}

// Whether an item of this verb and tense belongs to the line.
export function inLine(scope: Practising): (verbId: string, tense: Tense) => boolean {
  const verbs = new Set(scope.verbs.map((verb) => verb.id));
  return (verbId, tense) => verbs.has(verbId) && scope.tenses.includes(tense);
}

// The line a drill was last sent, one row of `table`; DEFAULT_LINE before any.
export function rememberedLine(db: Database, table: string) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), line_json TEXT NOT NULL)`);
  const read = db.query<{ line_json: string }, []>(`SELECT line_json FROM ${table} WHERE singleton = 1`);
  const write = db.query(`INSERT OR REPLACE INTO ${table} (singleton, line_json) VALUES (1, ?)`);
  return {
    get: (): PractisingLine => { const row = read.get(); return (row && lineOf(JSON.parse(row.line_json))) ?? DEFAULT_LINE; },
    set: (line: PractisingLine) => { write.run(JSON.stringify(line)); },
  };
}
