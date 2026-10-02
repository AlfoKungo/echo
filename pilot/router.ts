// The friends' Echo: one ordinary Echo process per learner, each with its own database, behind this router.
//
// Each learner lives in PILOT_DATA/<id>/ (echo.db, server.log, backup/). Their Echo runs from this checkout, so the
// recordings, decks, sentence bank and grammar course are the ones the owner's Echo uses, read and never recorded
// twice: the verb tables and the written sentence lanes are linked in from the owner's data folder. A learner's Echo
// records nothing, asks Claude nothing (ECHO_CLAUDE is a command that always fails) and leaves out the rooms that
// write and record for one person (Story, Radio, Songs).
//
// A learner's process starts on their first request and stops after IDLE without one, so a quiet pilot costs no
// memory. Every learner's database is snapshotted hourly under the same rules as the owner's (lib/backups.ts).
//
// Until sign-in exists every visitor is the one test learner, so this router must only be reachable from the
// owner's tailnet (Tailscale Serve, never Funnel).
import { existsSync, mkdirSync, openSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { backup } from '../lib/backups';

const ROOT = join(import.meta.dir, '..');
const DATA = process.env.PILOT_DATA ?? join(homedir(), 'echo-pilot');
const PORT = Number(process.env.PILOT_PORT ?? 7899);
// The address learners use; each learner's Echo accepts requests from it.
const ORIGIN = process.env.PILOT_ORIGIN ?? 'https://gals-macbook-pro.tailb1ce54.ts.net:8443';
const OWNER_DATA = process.env.PILOT_OWNER_DATA ?? join(ROOT, 'data');
const FIRST_PORT = 7900;
const IDLE = 30 * 60_000;
const READY_WITHIN = 30_000;
const ROOMS_OFF = 'story,radio,songs';
const BUN = process.execPath;

type Learner = { id: string; name: string; port: number };
type Running = { process: Subprocess; ready: Promise<void>; lastSeen: number };

mkdirSync(DATA, { recursive: true });
const registryPath = join(DATA, 'learners.json');
const learners: Learner[] = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : [];
function addLearner(id: string, name: string): Learner {
  const learner = { id, name, port: FIRST_PORT + learners.length };
  learners.push(learner);
  writeFileSync(registryPath, JSON.stringify(learners, null, 1));
  return learner;
}
const testLearner = learners.find((learner) => learner.id === 'test') ?? addLearner('test', 'Test learner');

// A learner's folder, with the owner's shared, read-only data linked in.
function prepare(learner: Learner): string {
  const dir = join(DATA, learner.id);
  mkdirSync(dir, { recursive: true });
  for (const shared of ['verbs.json', 'comprehension']) {
    const link = join(dir, shared);
    if (!existsSync(link) && existsSync(join(OWNER_DATA, shared))) symlinkSync(join(OWNER_DATA, shared), link);
  }
  return dir;
}

const running = new Map<string, Running>();
function start(learner: Learner): Running {
  const dir = prepare(learner);
  const log = openSync(join(dir, 'server.log'), 'a');
  const child = Bun.spawn([BUN, join(ROOT, 'server.ts')], {
    cwd: ROOT, stdout: log, stderr: log,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: homedir(), LANG: 'en_US.UTF-8',
      ECHO_DB: join(dir, 'echo.db'), ECHO_PORT: String(learner.port), ECHO_ORIGIN: ORIGIN,
      ECHO_WORD_AUDIO: 'off', ECHO_TEXT_TOPUP: 'off', ECHO_WORD_HOOKS: 'off', ECHO_STORY: 'off', ECHO_RADIO: 'off', ECHO_VERBS: 'off',
      ECHO_CLAUDE: '/usr/bin/false', ECHO_ROOMS_OFF: ROOMS_OFF,
    },
    onExit: () => { if (running.get(learner.id)?.process === child) running.delete(learner.id); },
  });
  const ready = (async () => {
    const until = Date.now() + READY_WITHIN;
    while (Date.now() < until) {
      if (child.exitCode !== null) throw new Error(`Echo for ${learner.id} stopped while starting (see ${join(dir, 'server.log')})`);
      try { if ((await fetch(`http://127.0.0.1:${learner.port}/echo/`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* not listening yet */ }
      await Bun.sleep(150);
    }
    child.kill();
    throw new Error(`Echo for ${learner.id} did not start within ${READY_WITHIN / 1000} s`);
  })();
  const entry = { process: child, ready, lastSeen: Date.now() };
  running.set(learner.id, entry);
  ready.catch(() => { if (running.get(learner.id) === entry) running.delete(learner.id); });
  return entry;
}

async function forward(req: Request, learner: Learner): Promise<Response> {
  const entry = running.get(learner.id) ?? start(learner);
  entry.lastSeen = Date.now();
  await entry.ready;
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  // Each learner's Echo checks Host against its own address; Origin passes through and must be ORIGIN.
  headers.delete('host');
  const response = await fetch(`http://127.0.0.1:${learner.port}${url.pathname}${url.search}`, {
    method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    redirect: 'manual', decompress: false,
  } as RequestInit);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// The learner a request belongs to. Until sign-in, everyone is the test learner.
function learnerFor(_req: Request): Learner { return testLearner; }

const server = Bun.serve({
  hostname: '127.0.0.1', port: PORT, idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/echo') return Response.redirect(`${ORIGIN}/echo/`, 302);
    if (!url.pathname.startsWith('/echo/')) return new Response('Not found', { status: 404 });
    try { return await forward(req, learnerFor(req)); }
    catch (error) {
      console.error(`pilot: ${(error as Error).message}`);
      return Response.json({ error: 'Echo is starting up or could not start. Please try again in a moment.' }, { status: 503 });
    }
  },
});

// Stops a learner's Echo after IDLE without a request; the next request starts it again.
const sweep = setInterval(() => {
  for (const [id, entry] of running) if (Date.now() - entry.lastSeen > IDLE) { entry.process.kill(); running.delete(id); }
}, 60_000);
function backups() {
  for (const learner of learners) {
    const db = join(DATA, learner.id, 'echo.db');
    try { backup(db, join(DATA, learner.id, 'backup')); } catch (error) { console.error(`pilot: backup of ${learner.id} failed`, error); }
  }
}
backups();
const hourly = setInterval(backups, 60 * 60_000);
const stop = () => { clearInterval(sweep); clearInterval(hourly); for (const entry of running.values()) entry.process.kill(); server.stop(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
console.log(`pilot: router on http://127.0.0.1:${PORT} for ${ORIGIN}; ${learners.length} ${learners.length === 1 ? 'learner' : 'learners'} in ${DATA}`);
