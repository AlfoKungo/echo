// A model Echo runs on this Mac as a long-lived Python HTTP process on 127.0.0.1 (speech recognition, lib/whisper.ts;
// Talk's voice, lib/voice.ts): started on the first call, kept while Echo calls on it, and stopped after IDLE without
// a call, as each holds gigabytes of the GPU's memory. The process answers GET / once its model is loaded, and one
// request at a time, as the GPU runs one model.
import type { Subprocess } from 'bun';

const IDLE = 10 * 60_000;
const READY_WITHIN = 90_000;

// name: what the learner reads in an error ("Speech recognition"); args follow the script (the port first).
export type LocalModelOptions = { python: string; script: string; args: string[]; port: number; name: string };

export function createLocalModel(options: LocalModelOptions) {
  let child: Subprocess | null = null;
  let ready: Promise<void> | null = null;
  let lastUse = 0;
  const base = `http://127.0.0.1:${options.port}`;

  function start(): Promise<void> {
    // Offline: the model is already in the Hugging Face cache, and a start must not wait on the network. stdin stays
    // an open pipe: the process leaves when it closes, so it never outlives Echo.
    const spawned = Bun.spawn([options.python, options.script, String(options.port), ...options.args], {
      env: { ...process.env, HF_HUB_OFFLINE: '1' }, stdin: 'pipe', stdout: 'ignore', stderr: 'inherit',
      onExit: () => { if (child === spawned) { child = null; ready = null; } },
    });
    child = spawned;
    return (async () => {
      const until = Date.now() + READY_WITHIN;
      while (Date.now() < until) {
        if (spawned.exitCode !== null) throw new Error(`${options.name} stopped while starting.`);
        try { if ((await fetch(`${base}/`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* not listening yet */ }
        await Bun.sleep(200);
      }
      spawned.kill();
      throw new Error(`${options.name} did not start in time.`);
    })();
  }
  function ensure(): Promise<void> {
    if (!ready) {
      ready = start();
      ready.catch(() => { ready = null; });
    }
    return ready;
  }
  async function call<T>(path: string, body: unknown, timeout = 20_000): Promise<T> {
    lastUse = Date.now();
    await ensure();
    try {
      const reply = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
      const data = await reply.json() as T & { error?: string };
      if (!reply.ok) throw new Error(data.error || `${options.name} answered ${reply.status}.`);
      return data;
    } finally {
      lastUse = Date.now();
    }
  }
  // Starts the model ahead of its first call, so that call is not kept waiting on the model loading.
  function warm(): Promise<void> { lastUse = Date.now(); return ensure(); }
  // Stops the model after `idle` without a call; the next call starts it again.
  function sweep(idle = IDLE) { if (child && Date.now() - lastUse > idle) { child.kill(); child = null; ready = null; } }
  function stop() { child?.kill(); child = null; ready = null; }
  // The running process's id, or null when it is stopped.
  const pid = () => child?.pid ?? null;
  return { call, warm, sweep, stop, pid };
}
