// Records words added from songs with the same scripts as the built-in deck: the French clip (render-audio.py),
// the English one (render-english.py), then the Walkman copies (build-walkman-clips.py). A word can be practised
// once its French clip exists; one that no take passes for stays out of practice and is counted as failed. A word
// is re-recorded (after a restart, say) until all four of its clips exist, since the Walkman needs the English too.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Word } from '../contract';

export type RunScript = (args: string[]) => Promise<{ ok: boolean; error: string }>;
export type WordAudioStatus = { pending: number; recording: boolean; failed: string[] };

export function createWordAudio(options: { root: string; extraWordsPath: string; addedWords: () => Word[]; run: RunScript }) {
  const { root, extraWordsPath } = options;
  const pending = new Set<string>();
  const failed = new Set<string>();
  let recording = false;
  const ready = (id: string) => existsSync(join(root, 'audio', `${id}.mp3`));
  const complete = (id: string) => ready(id) && ['en', 'walkman/fr', 'walkman/en'].every((dir) => existsSync(join(root, 'audio', dir, `${id}.mp3`)));

  function enqueue(ids: string[]): void {
    for (const id of ids) if (!complete(id)) { pending.add(id); failed.delete(id); }
    void drain();
  }

  async function drain(): Promise<void> {
    if (recording) return;
    recording = true;
    try {
      while (pending.size) {
        const batch = [...pending];
        writeFileSync(extraWordsPath, JSON.stringify(options.addedWords(), null, 1));
        const ids = batch.join(',');
        await options.run(['scripts/render-audio.py', '--extra-words', extraWordsPath, '--ids', ids]);
        await options.run(['scripts/render-english.py', '--extra-words', extraWordsPath, '--ids', ids]);
        await options.run(['scripts/build-walkman-clips.py', '--extra-words', extraWordsPath]);
        for (const id of batch) { pending.delete(id); if (!ready(id)) failed.add(id); }
      }
    } finally { recording = false; }
  }

  // Added words still missing a clip, e.g. after a restart mid-recording. A word no take passes for is tried
  // again once per start.
  function resume(): void { enqueue(options.addedWords().map((word) => word.id)); }

  return { ready, enqueue, resume, status: (): WordAudioStatus => ({ pending: pending.size, recording, failed: [...failed] }) };
}
export type WordAudio = ReturnType<typeof createWordAudio>;
