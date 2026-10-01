// Sounds: drills on pairs of French phrases that differ by one sound (le chat / les chats, tu / tout, bon / banc).
// Echo plays one side, the learner picks which they heard, and each contrast keeps its own record, so the pairs
// they confuse come back most. Content is content/sounds.json; every side is recorded by scripts/render-sounds.py
// and kept only when the recording is heard as itself rather than its twin. A pair with a side missing waits.
import { Database } from 'bun:sqlite';
import { StoreError } from './store';

export type SoundSide = { fr: string; en: string };
export type SoundItem = { id: string; a: SoundSide; b: SoundSide };
export type SoundContrast = { id: string; title: string; level: 'A1' | 'A2' | 'B1'; labels: [string, string]; listen: string; items: SoundItem[] };
export type SoundsContent = { contrasts: SoundContrast[] };

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROUND = 10;
const RECENT = 20;

// Every problem in the content, so a writer can fix them all at once.
export function soundProblems(content: SoundsContent): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const text = (value: unknown) => typeof value === 'string' && !!value.trim() && value === value.trim();
  if (!content || !Array.isArray(content.contrasts) || !content.contrasts.length) return ['sounds.json must be {"contrasts": [...]} with at least one contrast.'];
  for (const contrast of content.contrasts) {
    const where = `contrast ${contrast?.id ?? '?'}`;
    if (!ID.test(contrast?.id ?? '') || ids.has(contrast.id)) { problems.push(`${where}: id must be lowercase-with-hyphens and unique.`); continue; }
    ids.add(contrast.id);
    if (!text(contrast.title) || !text(contrast.listen)) problems.push(`${where}: needs a title and a "listen" explanation.`);
    if (!['A1', 'A2', 'B1'].includes(contrast.level)) problems.push(`${where}: level must be A1, A2 or B1.`);
    if (!Array.isArray(contrast.labels) || contrast.labels.length !== 2 || !contrast.labels.every(text)) problems.push(`${where}: labels must be two short texts.`);
    if (!Array.isArray(contrast.items) || contrast.items.length < 8 || contrast.items.length > 12) problems.push(`${where}: write 8 to 12 items.`);
    for (const item of contrast.items ?? []) {
      const at = `${where} item ${item?.id ?? '?'}`;
      if (!ID.test(item?.id ?? '') || !item.id.startsWith(`${contrast.id}-`) || ids.has(item.id)) { problems.push(`${at}: id must start with "${contrast.id}-" and be unique.`); continue; }
      ids.add(item.id);
      for (const side of ['a', 'b'] as const) {
        const value = item[side];
        if (!value || !text(value.fr) || !text(value.en)) { problems.push(`${at}: side ${side} needs fr and en.`); continue; }
        if (value.fr.includes("'")) problems.push(`${at}: side ${side} uses ' — write French with ’.`);
      }
      if (item.a?.fr && item.a.fr === item.b?.fr) problems.push(`${at}: the two sides are the same.`);
    }
  }
  return problems;
}

export async function loadSounds(path: string): Promise<SoundsContent> {
  const file = Bun.file(path);
  if (!await file.exists()) return { contrasts: [] };
  const content = await file.json() as SoundsContent;
  const problems = soundProblems(content);
  if (problems.length) throw new StoreError(`Sounds content: ${problems[0]}`);
  return content;
}

// The clip ids of an item's two sides.
export const sideClip = (itemId: string, side: 'a' | 'b') => `${itemId}-${side}`;

export type SoundsSummary = { id: string; title: string; level: string; labels: [string, string]; listen: string; ready: number; recent: { right: number; total: number } };
export type SoundQuestion = { contrastId: string; itemId: string; side: 'a' | 'b'; audio: string; choices: [SoundSide & { side: 'a' }, SoundSide & { side: 'b' }] };
export type SoundAnswer = { itemId: string; heard: 'a' | 'b'; chose: 'a' | 'b'; requestId: string };

// Raised whenever the recordings change, so a phone holding a cached clip fetches the new one; the app's soundUrl
// carries the same number.
export const CLIP_VERSION = 2;

export function createSounds(content: SoundsContent, options: { dbPath: string; clipExists: (clipId: string) => boolean; random?: () => number; now?: () => Date }) {
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => new Date());
  const db = new Database(options.dbPath, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
    -- One answer in a sounds drill: which side played and which the learner chose.
    CREATE TABLE IF NOT EXISTS sound_answers (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, contrast_id TEXT NOT NULL,
      item_id TEXT NOT NULL, heard TEXT NOT NULL, chose TEXT NOT NULL, right INTEGER NOT NULL, answered_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sound_answers_contrast ON sound_answers(contrast_id, sequence DESC);
  `);
  const contrasts = new Map(content.contrasts.map((contrast) => [contrast.id, contrast]));
  const itemById = new Map(content.contrasts.flatMap((contrast) => contrast.items.map((item) => [item.id, { contrast, item }] as const)));
  const recentFor = db.query<{ right: number }, [string, number]>('SELECT right FROM sound_answers WHERE contrast_id = ? ORDER BY sequence DESC LIMIT ?');
  const missesFor = db.query<{ item_id: string; misses: number; answers: number }, [string]>('SELECT item_id, SUM(right = 0) AS misses, COUNT(*) AS answers FROM sound_answers WHERE contrast_id = ? GROUP BY item_id');
  const insert = db.query('INSERT OR IGNORE INTO sound_answers (request_id, contrast_id, item_id, heard, chose, right, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const ready = (item: SoundItem) => options.clipExists(sideClip(item.id, 'a')) && options.clipExists(sideClip(item.id, 'b'));

  function summary(): SoundsSummary[] {
    return content.contrasts.map((contrast) => {
      const recent = recentFor.all(contrast.id, RECENT);
      return { id: contrast.id, title: contrast.title, level: contrast.level, labels: contrast.labels, listen: contrast.listen, ready: contrast.items.filter(ready).length, recent: { right: recent.filter((row) => row.right).length, total: recent.length } };
    });
  }

  // A round from one contrast, or from every contrast when id is 'mix' (the ones missed most weigh more): items
  // missed most and answered least come first, each side chosen at random.
  function round(id: string): SoundQuestion[] {
    const chosen = id === 'mix' ? content.contrasts : [contrasts.get(id)].filter((entry): entry is SoundContrast => !!entry);
    if (!chosen.length) throw new StoreError('That sound is not in Echo.', 404);
    const pool = chosen.flatMap((contrast) => {
      const history = new Map(missesFor.all(contrast.id).map((row) => [row.item_id, row]));
      return contrast.items.filter(ready).map((item) => {
        const seen = history.get(item.id);
        return { contrast, item, weight: (seen?.misses ?? 0) * 2 - (seen?.answers ?? 0) * 0.5 + random() * 3 };
      });
    });
    if (!pool.length) throw new StoreError('These sounds are still being recorded. Try again in a few minutes.', 409);
    const picked = pool.sort((left, right) => right.weight - left.weight).slice(0, ROUND);
    return picked.sort(() => random() - 0.5).map(({ contrast, item }) => {
      const side = random() < 0.5 ? 'a' : 'b';
      return { contrastId: contrast.id, itemId: item.id, side, audio: `audio/sounds/${sideClip(item.id, side)}.mp3?v=${CLIP_VERSION}`, choices: [{ ...item.a, side: 'a' }, { ...item.b, side: 'b' }] };
    });
  }

  // Answers are kept once per request id; the contrast's record is returned.
  function answer(input: SoundAnswer): SoundsSummary {
    const found = itemById.get(input?.itemId);
    if (!found) throw new StoreError('That sound is not in Echo.', 404);
    if (!['a', 'b'].includes(input.heard) || !['a', 'b'].includes(input.chose)) throw new StoreError('Choose one of the two.');
    if (typeof input.requestId !== 'string' || !input.requestId) throw new StoreError('This answer is missing its request ID.');
    insert.run(input.requestId, found.contrast.id, found.item.id, input.heard, input.chose, input.heard === input.chose ? 1 : 0, now().toISOString());
    return summary().find((entry) => entry.id === found.contrast.id)!;
  }

  return { summary, round, answer, close: () => db.close() };
}
export type Sounds = ReturnType<typeof createSounds>;
