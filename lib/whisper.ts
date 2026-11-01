// Speech recognition for Say it and Talk: Whisper large-v3-turbo on Apple's MLX (lib/whisper-mlx.py), started on the
// first clip and kept running while the learner talks (about 0.2 s a one-word clip), then stopped after ten idle
// minutes, as it holds about 1.6 GB of the GPU's memory (lib/local-model.ts). A clip arrives as the page captured it
// (WAV at the phone's rate); ffmpeg turns it into 16 kHz mono with a little silence around the speech, which short
// words need. That file serves both the transcription and, when the answer seems wrong, scoring how well the wanted
// answer fits it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalModel } from './local-model';

export type WhisperOptions = { python: string; script: string; model: string; ffmpeg: string; port: number };
// One clip, converted and on disk until closed.
export type Recording = {
  wav: string;
  // The loudest sample, 0 to 1: a clip that never gets loud held no answer, whatever recognition makes of it.
  peak: number;
  // What was said, with `prompt` telling recognition which words to expect, in `language` (Whisper's code: the
  // language the learner answers in).
  transcribe(prompt: string, language?: string): Promise<string>;
  // How likely recognition finds each text for the clip, in `language`: summed log-probabilities, higher is likelier.
  score(texts: string[], language?: string): Promise<number[]>;
  close(): void;
};

export function createWhisper(options: WhisperOptions) {
  const model = createLocalModel({ python: options.python, script: options.script, args: [options.model], port: options.port, name: 'Speech recognition' });

  async function open(clip: Uint8Array): Promise<Recording> {
    const work = mkdtempSync(join(tmpdir(), 'echo-say-'));
    const close = () => rmSync(work, { recursive: true, force: true });
    try {
      const input = join(work, 'clip'), wav = join(work, 'clip.wav');
      await Bun.write(input, clip);
      const convert = Bun.spawn([options.ffmpeg, '-loglevel', 'error', '-y', '-i', input, '-af', 'adelay=300|300,apad=pad_dur=0.4', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { stdout: 'ignore', stderr: 'pipe' });
      if (await convert.exited !== 0) throw new Error('That recording could not be read.');
      return {
        wav,
        peak: peak(new Uint8Array(await Bun.file(wav).arrayBuffer())),
        transcribe: async (prompt, language = 'en') => String((await model.call<{ text?: unknown }>('/transcribe', { path: wav, prompt, language })).text ?? '').trim(),
        score: async (texts, language = 'en') => (await model.call<{ scores: number[] }>('/score', { path: wav, texts, language })).scores,
        close,
      };
    } catch (error) {
      close();
      throw error;
    }
  }

  // warm starts recognition ahead of the first clip (Speak's Start, Talk's screen), so that clip is not kept waiting on
  // the model loading; sweep stops it after ten minutes without a clip, and the next clip starts it again.
  return { open, warm: model.warm, sweep: model.sweep, stop: model.stop };
}
export type Whisper = ReturnType<typeof createWhisper>;
// The loudest sample of a 16-bit PCM WAV, 0 to 1 (the samples are in its "data" chunk).
function peak(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at + 4, true);
    if (String.fromCharCode(...bytes.subarray(at, at + 4)) === 'data') {
      let loudest = 0;
      for (let sample = at + 8; sample + 1 < Math.min(bytes.length, at + 8 + size); sample += 2) loudest = Math.max(loudest, Math.abs(view.getInt16(sample, true)));
      return loudest / 32768;
    }
    at += 8 + size + (size % 2);
  }
  return 0;
}
