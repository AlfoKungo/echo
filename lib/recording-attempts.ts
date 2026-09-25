// Counts how many times a recording has been tried and failed, across restarts (data/recording-attempts.json).
// After LIMIT failed tries a clip is skipped when Echo restarts, instead of loading the voice for it every time;
// deleting its entry from the file, or recording it successfully by hand, lets it be tried again.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const LIMIT = 3;

export function createAttempts(path: string, limit = LIMIT) {
  const counts: Record<string, number> = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const save = () => writeFileSync(path, JSON.stringify(counts, null, 1));
  return {
    // The ids still worth trying on a restart.
    allowed: (ids: string[]) => ids.filter((id) => (counts[id] ?? 0) < limit),
    // After a run: every tried id that is still missing counts one more failure; one that now exists is cleared.
    note(tried: string[], missing: (id: string) => boolean): void {
      let changed = false;
      for (const id of tried) {
        if (missing(id)) { counts[id] = (counts[id] ?? 0) + 1; changed = true; }
        else if (id in counts) { delete counts[id]; changed = true; }
      }
      if (changed) save();
    },
    skipped: (ids: string[]) => ids.filter((id) => (counts[id] ?? 0) >= limit),
  };
}
export type Attempts = ReturnType<typeof createAttempts>;
