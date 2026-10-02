// Echo snapshots its database every hour into backup/. Kept: the last 24 hourly copies, the first copy of each of the
// last 14 days, and the first copy of every month, so a mistake noticed a week (or a season) later can still be
// undone. Copies made by hand before a deploy (echo-before-*.db, with their -shm and -wal) are kept ten at a time,
// the newest; anything else put here by hand (a folder of recordings before a re-render, a content file) goes after
// 14 days.
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HOURLY = /^echo-((\d{4}-\d{2})-\d{2})-\d{2}\.db$/;
const DEPLOY = /^(echo-before-.*\.db)(-shm|-wal)?$/;
const KEEP_HOURS = 24;
const KEEP_DAYS = 14;
const KEEP_DEPLOYS = 10;
const DAY = 24 * 60 * 60 * 1000;

export function hourlyName(now: Date): string {
  return `echo-${now.toISOString().slice(0, 13).replace('T', '-')}.db`;
}

export function expired(entries: { name: string; mtimeMs: number }[], now: number): string[] {
  const hourly = entries.map(entry => entry.name).filter(name => HOURLY.test(name)).sort();
  const keep = new Set(hourly.slice(-KEEP_HOURS));
  const oldest = new Date(now - (KEEP_DAYS - 1) * DAY).toISOString().slice(0, 10);
  const days = new Set<string>(), months = new Set<string>();
  for (const name of hourly) {
    const [, day, month] = HOURLY.exec(name)!;
    if (day! >= oldest && !days.has(day!)) { days.add(day!); keep.add(name); }
    if (!months.has(month!)) { months.add(month!); keep.add(name); }
  }
  // The newest deploy copies by their .db file; a -shm or -wal goes with its .db.
  const keptDeploys = new Set(entries.filter(entry => entry.name.endsWith('.db') && DEPLOY.test(entry.name))
    .sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, KEEP_DEPLOYS).map(entry => entry.name));
  return entries.filter(entry => {
    if (HOURLY.test(entry.name)) return !keep.has(entry.name);
    const deploy = DEPLOY.exec(entry.name);
    if (deploy) return !keptDeploys.has(deploy[1]!);
    return now - entry.mtimeMs > KEEP_DAYS * DAY;
  }).map(entry => entry.name);
}

// SQLite's snapshot copy includes WAL commits, unlike copying the .db file.
export function backup(dbPath: string, dir: string, now = new Date()): void {
  if (!existsSync(dbPath)) return;
  mkdirSync(dir, { recursive: true });
  const target = join(dir, hourlyName(now));
  if (!existsSync(target)) {
    const db = new Database(dbPath);
    try { db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`); } finally { db.close(); }
  }
  const entries = readdirSync(dir).filter(name => !name.startsWith('.')).map(name => ({ name, mtimeMs: statSync(join(dir, name)).mtimeMs }));
  for (const name of expired(entries, now.getTime())) rmSync(join(dir, name), { recursive: true, force: true });
}
