// Speech recognition for Say it: whisper.cpp's server, started on the first clip and kept running while the learner
// talks (about 0.25 s a one-word clip, against 0.75-1.3 s when the model loads for each one), then stopped after
// IDLE without a clip, as it holds about 1.6 GB of the GPU's memory. A clip arrives as the page captured it (WAV at
// the phone's rate); ffmpeg turns it into 16 kHz mono with a little silence around the speech, which short words need.
import type { Subprocess } from 'bun';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IDLE = 10 * 60_000;
const READY_WITHIN = 60_000;

export type WhisperOptions = { server: string; model: string; ffmpeg: string; port: number };

export function createWhisper(options: WhisperOptions) {
  let child: Subprocess | null = null;
  let ready: Promise<void> | null = null;
  let lastUse = 0;
  const base = `http://127.0.0.1:${options.port}`;

  function start(): Promise<void> {
    const spawned = Bun.spawn([options.server, '-m', options.model, '-l', 'en', '--host', '127.0.0.1', '--port', String(options.port), '-nt'], {
      stdout: 'ignore', stderr: 'ignore',
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

  // What was said in `clip`, with `prompt` telling recognition which words to expect.
  async function transcribe(clip: Uint8Array, prompt: string): Promise<string> {
    lastUse = Date.now();
    const work = mkdtempSync(join(tmpdir(), 'echo-say-'));
    try {
      const input = join(work, 'clip'), wav = join(work, 'clip.wav');
      await Bun.write(input, clip);
      const convert = Bun.spawn([options.ffmpeg, '-loglevel', 'error', '-y', '-i', input, '-af', 'adelay=300|300,apad=pad_dur=0.4', '-ar', '16000', '-ac', '1', wav], { stdout: 'ignore', stderr: 'pipe' });
      if (await convert.exited !== 0) throw new Error('That recording could not be read.');
      await ensure();
      const form = new FormData();
      form.append('file', Bun.file(wav));
      form.append('response_format', 'json');
      form.append('temperature', '0');
      form.append('prompt', prompt);
      const reply = await fetch(`${base}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(20_000) });
      if (!reply.ok) throw new Error(`Speech recognition answered ${reply.status}.`);
      return String(((await reply.json()) as { text?: unknown }).text ?? '').trim();
    } finally {
      lastUse = Date.now();
      rmSync(work, { recursive: true, force: true });
    }
  }

  // Stops recognition after IDLE without a clip; the next clip starts it again.
  function sweep() { if (child && Date.now() - lastUse > IDLE) { child.kill(); child = null; ready = null; } }
  function stop() { child?.kill(); child = null; ready = null; }
  return { transcribe, sweep, stop };
}
export type Whisper = ReturnType<typeof createWhisper>;
