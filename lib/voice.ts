// Talk's French voice: Chatterbox on Apple's MLX (lib/voice-mlx.py), in the reference voice and settings every
// recorded sentence uses, started on Talk's screen or its first line and stopped after ten idle minutes, as it holds
// gigabytes of the GPU's memory (lib/local-model.ts). About 2.3 s to load and 1.5 to 2 s a short sentence once warm.
// A line becomes <dir>/<name>.mp3, its name a hash of the text, so a line said again (a topic's opener) is not voiced
// twice. Lines are Talk's own and not kept: sweep() deletes those untouched for KEEP_DAYS, so the folder stays small.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalModel } from './local-model';

export type VoiceOptions = { python: string; script: string; model: string; reference: string; ffmpeg: string; port: number; dir: string };

const KEEP_DAYS = 7;
// Part of every name: a change to how lines are voiced (here or in voice-mlx.py) bumps it, so no old take is served.
const VOICE_VERSION = 'talk-v1';
const SEED = 42;
// 250 ms of quiet before the speech, as recorded sentences have (scripts/render-clips.py LEAD_IN): a phone, and
// Bluetooth earbuds more, drop the first moment of a clip while the output wakes. libmp3lame takes 1152-sample frames,
// which adelay's output is not cut into.
const LEAD_IN = 'silenceremove=start_periods=1:start_threshold=-60dB,adelay=250:all=1,asetnsamples=n=1152:p=1';

export const clipName = (text: string) => createHash('sha256').update(`${VOICE_VERSION}\n${text}`).digest('hex').slice(0, 24);

export function createVoice(options: VoiceOptions) {
  const model = createLocalModel({ python: options.python, script: options.script, args: [options.model, options.reference], port: options.port, name: 'Talk’s voice' });

  // The line's clip name, voiced first unless it already is (a reuse counts as a use, so sweep() keeps it).
  async function say(text: string): Promise<string> {
    const name = clipName(text), mp3 = join(options.dir, `${name}.mp3`);
    if (existsSync(mp3)) { const now = new Date(); utimesSync(mp3, now, now); return name; }
    mkdirSync(options.dir, { recursive: true });
    const work = mkdtempSync(join(tmpdir(), 'echo-voice-'));
    try {
      const wav = join(work, 'line.wav'), part = `${mp3}.part`;
      await model.call('/speak', { text, path: wav, seed: SEED }, 60_000);
      const encode = Bun.spawn([options.ffmpeg, '-nostdin', '-loglevel', 'error', '-y', '-i', wav, '-af', LEAD_IN, '-codec:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3', part], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' });
      const [code, said] = await Promise.all([encode.exited, new Response(encode.stderr).text()]);
      if (code !== 0) { rmSync(part, { force: true }); throw new Error(`the line could not be encoded (${said.trim().slice(0, 160)})`); }
      renameSync(part, mp3);
      return name;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  // Deletes the lines untouched for KEEP_DAYS; returns how many went.
  function sweepClips(now = Date.now()): number {
    if (!existsSync(options.dir)) return 0;
    let gone = 0;
    for (const file of readdirSync(options.dir)) {
      if (!/\.mp3(\.part)?$/.test(file)) continue;
      const path = join(options.dir, file);
      if (now - statSync(path).mtimeMs > KEEP_DAYS * 86_400_000) { rmSync(path, { force: true }); gone++; }
    }
    return gone;
  }
  const file = (name: string) => /^[0-9a-f]{24}$/.test(name) ? join(options.dir, `${name}.mp3`) : null;
  return { say, file, sweepClips, warm: model.warm, sweep: model.sweep, stop: model.stop, pid: model.pid };
}
