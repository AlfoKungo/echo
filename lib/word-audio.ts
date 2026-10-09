// Records words added from songs with the same scripts as the built-in deck: the word's clip with its language's
// recorder (lib/language.ts: render-audio.py for French), then, where the language has the Walkman, the English one
// (render-english.py) and the Walkman copies (build-walkman-clips.py). A word can be practised once its clip exists;
// one that no take passes for stays out of practice and is counted as failed. A word is re-recorded (after a
// restart, say) until all its clips exist, since the Walkman needs the English too, but only while it has failed
// fewer than three times (lib/recording-attempts.ts).
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Word } from '../contract';
import type { Language } from './language';
import type { Attempts } from './recording-attempts';

export type RunScript = (args: string[]) => Promise<{ ok: boolean; error: string }>;
export type WordAudioStatus = { pending: number; recording: boolean; failed: string[] };

export function createWordAudio(options: { language: Pick<Language, 'audio' | 'tts' | 'textKey'>; walkman: boolean; extraWordsPath: string; addedWords: () => Word[]; run: RunScript; attempts: Attempts }) {
  const { language, extraWordsPath } = options;
  const pending = new Set<string>();
  const failed = new Set<string>();
  let recording = false;
  const ready = (id: string) => existsSync(join(language.audio, `${id}.mp3`));
  const complete = (id: string) => ready(id) && (!options.walkman || ['en', 'walkman/fr', 'walkman/en'].every((dir) => existsSync(join(language.audio, dir, `${id}.mp3`))));

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
        // The recorder reads a word's text under its language's code (render-audio-sv.py reads "sv").
        const added = options.addedWords();
        writeFileSync(extraWordsPath, JSON.stringify(language.textKey === 'fr' ? added : added.map((word) => ({ ...word, [language.textKey]: word.fr })), null, 1));
        const ids = batch.join(',');
        await options.run([language.tts.script, ...language.tts.args, '--extra-words', extraWordsPath, '--ids', ids]);
        if (options.walkman) {
          await options.run(['scripts/render-english.py', '--extra-words', extraWordsPath, '--ids', ids]);
          await options.run(['scripts/build-walkman-clips.py', '--extra-words', extraWordsPath]);
        }
        for (const id of batch) { pending.delete(id); if (!ready(id)) failed.add(id); }
        options.attempts.note(batch, (id) => !complete(id));
      }
    } finally { recording = false; }
  }

  // Added words still missing a clip, e.g. after a restart mid-recording. A word no take passes for is tried
  // again on each start until it has failed three times.
  function resume(): void {
    const incomplete = options.addedWords().map((word) => word.id).filter((id) => !complete(id));
    const skipped = options.attempts.skipped(incomplete);
    if (skipped.length) console.log(`word audio: not retrying ${skipped.join(', ')} (failed 3 times; see data/recording-attempts.json)`);
    enqueue(options.attempts.allowed(incomplete));
  }

  return { ready, enqueue, resume, status: (): WordAudioStatus => ({ pending: pending.size, recording, failed: [...failed] }) };
}
export type WordAudio = ReturnType<typeof createWordAudio>;
