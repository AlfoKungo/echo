import { expect, test } from 'bun:test';
import { expired } from '../lib/backups';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test('the last 48 hourly copies stay, plus the first copy of each of the last 14 days; deploy copies go after 14 days', () => {
  const now = Date.parse('2026-09-25T22:30:00Z');
  const files: { name: string; mtimeMs: number }[] = [];
  for (let hours = 0; hours < 20 * 24; hours += 1) {
    const at = new Date(now - hours * HOUR);
    files.push({ name: `echo-${at.toISOString().slice(0, 13).replace('T', '-')}.db`, mtimeMs: at.getTime() });
  }
  files.push({ name: 'echo-before-old-20260901.db', mtimeMs: now - 20 * DAY }, { name: 'echo-before-old-20260901.db-wal', mtimeMs: now - 20 * DAY });
  files.push({ name: 'echo-before-new-20260920.db', mtimeMs: now - 5 * DAY });
  files.push({ name: 'a1-shopping-before-fix.json', mtimeMs: now - 30 * DAY });

  const gone = new Set(expired(files, now));
  const kept = files.map(f => f.name).filter(n => !gone.has(n));
  const hourly = kept.filter(n => /^echo-\d/.test(n)).sort();
  // 48 recent hours, plus midnight (UTC) copies of the 12 older days still inside the 14-day window.
  expect(hourly).toHaveLength(48 + 12);
  expect(hourly[0]).toBe('echo-2026-09-12-00.db');
  expect(kept).toContain('echo-before-new-20260920.db');
  expect(gone.has('echo-before-old-20260901.db')).toBe(true);
  expect(gone.has('echo-before-old-20260901.db-wal')).toBe(true);
  expect(gone.has('a1-shopping-before-fix.json')).toBe(false);
});
