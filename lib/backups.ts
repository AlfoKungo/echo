// Echo snapshots its database every hour into backup/. The last 48 hourly copies are kept, plus the first copy of
// each of the last 14 days, so a mistake noticed a week later can still be undone. Copies made by hand before a
// deploy (echo-before-*) are kept for 14 days. Anything else in the folder is left alone.
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const HOURLY = /^echo-(\d{4}-\d{2}-\d{2})-\d{2}\.db$/;
const DEPLOY = /^echo-before-.*\.db(-shm|-wal)?$/;
const KEEP_HOURS = 48;
const KEEP_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

export function hourlyName(now: Date): string {
  return `echo-${now.toISOString().slice(0, 13).replace('T', '-')}.db`;
}

export function expired(files: { name: string; mtimeMs: number }[], now: number): string[] {
  const hourly = files.map(f => f.name).filter(n => HOURLY.test(n)).sort();
  const keep = new Set(hourly.slice(-KEEP_HOURS));
  const oldest = new Date(now - (KEEP_DAYS - 1) * DAY).toISOString().slice(0, 10);
  const days = new Set<string>();
  for (const name of hourly) {
    const day = HOURLY.exec(name)![1];
    if (day >= oldest && !days.has(day)) { days.add(day); keep.add(name); }
  }
  return [
    ...hourly.filter(n => !keep.has(n)),
    ...files.filter(f => DEPLOY.test(f.name) && now - f.mtimeMs > KEEP_DAYS * DAY).map(f => f.name),
  ];
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
  const files = readdirSync(dir).filter(n => HOURLY.test(n) || DEPLOY.test(n)).map(name => ({ name, mtimeMs: statSync(join(dir, name)).mtimeMs }));
  for (const name of expired(files, now.getTime())) unlinkSync(join(dir, name));
}
