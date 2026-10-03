// Speech recognition for Say it: Whisper large-v3-turbo on Apple's MLX (lib/whisper-mlx.py), started on the first clip
// and kept running while the learner talks (about 0.2 s a one-word clip), then stopped after IDLE without a clip, as
// it holds about 1.6 GB of the GPU's memory. A clip arrives as the page captured it (WAV at the phone's rate); ffmpeg
// turns it into 16 kHz mono with a little silence around the speech, which short words need. That file serves both
// the transcription and, when the answer seems wrong, scoring how well the wanted answer fits it.
import type { Subprocess } from 'bun';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IDLE = 10 * 60_000;
const READY_WITHIN = 90_000;

export type WhisperOptions = { python: string; script: string; model: string; ffmpeg: string; port: number };
// One clip, converted and on disk until closed.
export type Recording = {
  wav: string;
  // What was said, with `prompt` telling recognition which words to expect.
  transcribe(prompt: string): Promise<string>;
  // How likely recognition finds each text for the clip: summed log-probabilities, higher is likelier.
  score(texts: string[]): Promise<number[]>;
  close(): void;
};

export function createWhisper(options: WhisperOptions) {
  let child: Subprocess | null = null;
  let ready: Promise<void> | null = null;
  let lastUse = 0;
  const base = `http://127.0.0.1:${options.port}`;

  function start(): Promise<void> {
    // Offline: the model is already in the Hugging Face cache, and a start must not wait on the network.
    const spawned = Bun.spawn([options.python, options.script, String(options.port), options.model], {
      env: { ...process.env, HF_HUB_OFFLINE: '1' }, stdout: 'ignore', stderr: 'inherit',
      onExit: () => { if (child === spawned) { child = null; ready = null; } },
    });
    child = spawned;
    return (async () => {
      const until = Date.now() + READY_WITHIN;
      while (Date.now() < until) {
        if (spawned.exitCode !== null) throw new Error('Speech recognition stopped while starting.');
        try { if ((await fetch(`${base}/`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* not listening yet */ }
        await Bun.sleep(200);
      }
      spawned.kill();
      throw new Error('Speech recognition did not start in time.');
    })();
  }
  function ensure(): Promise<void> {
    if (!ready) {
      ready = start();
      ready.catch(() => { ready = null; });
    }
    return ready;
  }
  async function call<T>(path: string, body: unknown): Promise<T> {
    lastUse = Date.now();
    await ensure();
    try {
      const reply = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      const data = await reply.json() as T & { error?: string };
      if (!reply.ok) throw new Error(data.error || `Speech recognition answered ${reply.status}.`);
      return data;
    } finally {
      lastUse = Date.now();
    }
  }

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
        transcribe: async (prompt) => String((await call<{ text?: unknown }>('/transcribe', { path: wav, prompt })).text ?? '').trim(),
        score: async (texts) => (await call<{ scores: number[] }>('/score', { path: wav, texts })).scores,
        close,
      };
    } catch (error) {
      close();
      throw error;
    }
  }

  // Stops recognition after IDLE without a clip; the next clip starts it again.
  function sweep() { if (child && Date.now() - lastUse > IDLE) { child.kill(); child = null; ready = null; } }
  function stop() { child?.kill(); child = null; ready = null; }
  return { open, sweep, stop };
}
export type Whisper = ReturnType<typeof createWhisper>;
