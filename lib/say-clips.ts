// Say it recordings kept for tuning the check: every answer judged wrong, and every one counted right only because the
// wanted answer scored close to what was heard — the cases its rules are set from. Each is the 16 kHz clip Whisper
// heard, `<request>.wav`, and a note, `<request>.json`: the word, its meanings, what was heard, the verdict, the
// scores, and `markedRight` once the learner says Echo heard them wrong. The newest KEEP stay; older ones go.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEEP = 200;

export function createSayClips(dir: string) {
  function keep(request: string, wav: string, note: Record<string, unknown>): void {
    mkdirSync(dir, { recursive: true });
    copyFileSync(wav, join(dir, `${request}.wav`));
    writeFileSync(join(dir, `${request}.json`), JSON.stringify({ at: new Date().toISOString(), ...note }, null, 2));
    const notes = readdirSync(dir).filter((name) => name.endsWith('.json'))
      .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs })).sort((left, right) => right.at - left.at);
    for (const { name } of notes.slice(KEEP)) {
      rmSync(join(dir, name), { force: true });
      rmSync(join(dir, name.replace(/\.json$/, '.wav')), { force: true });
    }
  }
  // The learner marked this answer right: the note says so, the clearest sign of where the check falls short.
  function markedRight(request: string): void {
    const path = join(dir, `${request}.json`);
    if (!existsSync(path)) return;
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), markedRight: true }, null, 2));
  }
  return { keep, markedRight };
}
