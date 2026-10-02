import { expect, test } from 'bun:test';
import { expired } from '../lib/backups';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.parse('2026-09-25T22:30:00Z');
const hourlyFor = (days: number) => Array.from({ length: days * 24 }, (_, hours) => {
  const at = new Date(now - hours * HOUR);
  return { name: `echo-${at.toISOString().slice(0, 13).replace('T', '-')}.db`, mtimeMs: at.getTime() };
});
const kept = (entries: { name: string; mtimeMs: number }[]) => { const gone = new Set(expired(entries, now)); return entries.map((entry) => entry.name).filter((name) => !gone.has(name)); };

test('hourly copies: the last 24, the first of each of the last 14 days, and the first of every month', () => {
  const left = kept(hourlyFor(80)).sort();
  // 24 recent hours; midnight (UTC) copies of the 13 earlier days inside the 14-day window (today's midnight copy is
  // among the 24); and the first copies of July, August and September, which are older than the window.
  expect(left).toHaveLength(24 + 13 + 3);
  expect(left[0]).toBe('echo-2026-07-07-23.db');
  expect(left).toContain('echo-2026-08-01-00.db');
  expect(left).toContain('echo-2026-09-01-00.db');
  expect(left).not.toContain('echo-2026-09-01-01.db');
  expect(left).toContain('echo-2026-09-12-00.db');
  expect(left).not.toContain('echo-2026-09-11-00.db');
});

test('deploy copies: the ten newest stay with their -shm and -wal, the rest go however recent', () => {
  const deploys = Array.from({ length: 12 }, (_, index) => ({ name: `echo-before-change-${String(index).padStart(2, '0')}.db`, mtimeMs: now - index * HOUR }));
  const left = kept([...deploys, { name: 'echo-before-change-00.db-wal', mtimeMs: now }, { name: 'echo-before-change-11.db-shm', mtimeMs: now }]);
  expect(left).toContain('echo-before-change-09.db');
  expect(left).toContain('echo-before-change-00.db-wal');
  expect(left).not.toContain('echo-before-change-10.db');
  expect(left).not.toContain('echo-before-change-11.db-shm');
});

test('anything else put in backup/ by hand goes after 14 days', () => {
  const left = kept([
    { name: 'word-audio-before-lead-in-20260901', mtimeMs: now - 20 * DAY },
    { name: 'comprehension-before-lead-in-20260924', mtimeMs: now - DAY },
    { name: 'a1-shopping-before-fix.json', mtimeMs: now - 15 * DAY },
  ]);
  expect(left).toEqual(['comprehension-before-lead-in-20260924']);
});
