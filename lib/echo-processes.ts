// Child Echo processes on this Mac, each an ordinary server.ts from this checkout with its own port, data folder and
// environment, started on the first request that needs one and passed requests from then on. The friends' pilot
// runs one per learner (pilot/router.ts); the owner's French Echo runs one per other language (lib/languages.ts).
import { mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

const ROOT = join(import.meta.dir, '..');
const READY_WITHIN = 30_000;

// dir holds the child's server.log; env is all the environment it gets beyond PATH, HOME and LANG.
export type EchoChild = { port: number; dir: string; env: Record<string, string> };
export type EchoState = 'ready' | 'starting' | 'down';

export function createEchoProcesses() {
  const running = new Map<string, { process: Subprocess; ready: Promise<void>; started: boolean; lastSeen: number; port: number }>();

  function start(id: string, spec: EchoChild) {
    mkdirSync(spec.dir, { recursive: true });
    const log = openSync(join(spec.dir, 'server.log'), 'a');
    const child = Bun.spawn([process.execPath, join(ROOT, 'server.ts')], {
      cwd: ROOT, stdout: log, stderr: log,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: homedir(), LANG: 'en_US.UTF-8', ...spec.env, ECHO_PORT: String(spec.port) },
      onExit: () => { if (running.get(id)?.process === child) running.delete(id); },
    });
    const ready = (async () => {
      const until = Date.now() + READY_WITHIN;
      while (Date.now() < until) {
        if (child.exitCode !== null) throw new Error(`Echo for ${id} stopped while starting (see ${join(spec.dir, 'server.log')})`);
        try { if ((await fetch(`http://127.0.0.1:${spec.port}/echo/`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* not listening yet */ }
        await Bun.sleep(150);
      }
      child.kill();
      throw new Error(`Echo for ${id} did not start within ${READY_WITHIN / 1000} s`);
    })();
    const entry = { process: child, ready, started: false, lastSeen: Date.now(), port: spec.port };
    running.set(id, entry);
    ready.then(() => { entry.started = true; }, () => { if (running.get(id) === entry) running.delete(id); });
    return entry;
  }

  // The child's address once it answers, starting it first if it is not running; `spec` is read only to start it.
  async function backend(id: string, spec: () => EchoChild): Promise<string> {
    const entry = running.get(id) ?? start(id, spec());
    entry.lastSeen = Date.now();
    await entry.ready;
    return `http://127.0.0.1:${entry.port}`;
  }

  function state(id: string): EchoState {
    const entry = running.get(id);
    return !entry ? 'down' : entry.started ? 'ready' : 'starting';
  }
  function stop(id: string) { running.get(id)?.process.kill(); running.delete(id); }
  // Stops each child that has had no request for `idle` ms; the next request starts it again.
  function sweep(idle: number) { for (const [id, entry] of running) if (Date.now() - entry.lastSeen > idle) stop(id); }
  function stopAll() { for (const id of [...running.keys()]) stop(id); }

  return { backend, state, stop, sweep, stopAll };
}

// Passes a request to a child Echo at `base` under `path`. The child checks Host against its own address, and never
// sees the cookies of the server in front of it; its response, gzipped or not, goes back as it came.
export async function forward(req: Request, base: string, path: string): Promise<Response> {
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  headers.delete('host'); headers.delete('cookie');
  const response = await fetch(`${base}${path}${url.search}`, {
    method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    redirect: 'manual', decompress: false,
  } as RequestInit);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
