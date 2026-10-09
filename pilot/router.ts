// The friends' Echo: one ordinary Echo process per learner, each with its own database, behind this router, which
// signs people in with Google and lets in only the emails the owner has allowed, plus anyone new while the owner holds
// the door open (pilot/accounts.ts). Google does not filter: an app asking only for name, email and profile is open to
// every Google account even while in Testing, so this list and the door are the only lock.
//
// Two listeners. The public one (PILOT_PORT, behind Tailscale) serves the sign-in pages and, for a signed-in learner,
// their Echo; without a valid session it serves nothing else. The admin one (PILOT_ADMIN_PORT) is bound to this Mac
// alone and is never exposed: the owner's Echo manages the allowed emails through it (its Friends page), and so
// does pilot/friends.ts from a shell on this Mac.
//
// Each learner lives in PILOT_DATA/<id>/ (echo.db, server.log, backup/). Their Echo runs from this checkout, so the
// recordings, decks, sentence bank and grammar course are the owner's, read and never recorded twice; the verb tables
// and the written sentence lanes are linked in from the owner's data folder. A learner's Echo records nothing, asks
// Claude nothing (ECHO_CLAUDE is a command that always fails) and leaves out the rooms that write and record for one
// person. It starts on the learner's first request and stops after IDLE without one. Every learner's database is
// snapshotted hourly under the owner's backup rules (lib/backups.ts).
import { existsSync, mkdirSync, openSync, readFileSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { backup, offsite, OFFSITE_DIR } from '../lib/backups';
import { createAccounts, OPEN_MINUTES, SESSION_DAYS, type Accounts, type Learner } from './accounts';
import { createGoogle, SignInError, type Exchange, type GoogleConfig } from './google';

const ROOT = join(import.meta.dir, '..');
const COOKIE = 'echo_session';
const IDLE = 30 * 60_000;
const READY_WITHIN = 30_000;
// Rooms that write or record for one person, or (say) run speech recognition, which one Mac cannot do per friend;
// write asks Claude on every answer, news fetches, transcribes and has Claude note every edition, and sentencecards
// has Claude write the sentences of Verbs' In sentences.
const ROOMS_OFF = 'story,radio,songs,friends,say,write,news,sentencecards';

export type PilotOptions = {
  data: string; origin: string; ownerData: string; firstPort: number;
  google: Omit<GoogleConfig, 'redirectUri'> | null; exchange?: Exchange;
  // Where a learner's Echo answers; by default their own Echo process, started on demand.
  backend?: (learner: Learner) => Promise<string>;
  owner?: string;
  // A folder off this Mac for each learner's daily copy (lib/backups.ts offsite); none when unset.
  offsite?: string;
};

const esc = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function page(title: string, body: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#14131e;color:#eeedf5;font:17px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:360px;padding:32px 24px;text-align:center}h1{font-size:30px;margin:0 0 6px}p{color:#aaa7bd;margin:0 0 22px}b{color:#eeedf5}
a.button{display:inline-flex;align-items:center;gap:10px;background:#aaa6e4;color:#14131e;text-decoration:none;font-weight:600;padding:13px 22px;border-radius:12px}
small{display:block;margin-top:26px;color:#77748c;font-size:13px}</style></head><body><main>${body}</main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' } });
}
const signInButton = (label = 'Sign in with Google') => `<a class="button" href="/auth/google">${esc(label)}</a>`;

export function createPilot(options: PilotOptions) {
  mkdirSync(options.data, { recursive: true });
  const accounts: Accounts = createAccounts({ dbPath: join(options.data, 'pilot.db'), firstPort: options.firstPort });
  const google = options.google ? createGoogle({ ...options.google, redirectUri: `${options.origin}/auth/callback` }, { exchange: options.exchange }) : null;
  const owner = options.owner ?? 'Gal';

  // ── Learners' Echo processes ──
  const running = new Map<string, { process: Subprocess; ready: Promise<void>; lastSeen: number }>();
  function prepare(learner: Learner): string {
    const dir = join(options.data, learner.id);
    mkdirSync(dir, { recursive: true });
    for (const shared of ['verbs.json', 'comprehension']) {
      const link = join(dir, shared);
      if (!existsSync(link) && existsSync(join(options.ownerData, shared))) symlinkSync(join(options.ownerData, shared), link);
    }
    return dir;
  }
  function start(learner: Learner) {
    const dir = prepare(learner);
    const log = openSync(join(dir, 'server.log'), 'a');
    const child = Bun.spawn([process.execPath, join(ROOT, 'server.ts')], {
      cwd: ROOT, stdout: log, stderr: log,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: homedir(), LANG: 'en_US.UTF-8',
        ECHO_DB: join(dir, 'echo.db'), ECHO_PORT: String(learner.port), ECHO_ORIGIN: options.origin,
        ECHO_WORD_AUDIO: 'off', ECHO_TEXT_TOPUP: 'off', ECHO_WORD_HOOKS: 'off', ECHO_STORY: 'off', ECHO_RADIO: 'off', ECHO_VERBS: 'off',
        ECHO_CLAUDE: '/usr/bin/false', ECHO_ROOMS_OFF: ROOMS_OFF, ECHO_LEARNER: learner.name,
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
  const processBackend = async (learner: Learner) => {
    const entry = running.get(learner.id) ?? start(learner);
    entry.lastSeen = Date.now();
    await entry.ready;
    return `http://127.0.0.1:${learner.port}`;
  };
  const backend = options.backend ?? processBackend;
  const stopLearner = (id: string) => { running.get(id)?.process.kill(); running.delete(id); };

  async function forward(req: Request, learner: Learner): Promise<Response> {
    const base = await backend(learner);
    const url = new URL(req.url);
    const headers = new Headers(req.headers);
    // The learner's Echo checks Host against its own address, and never sees the session cookie.
    headers.delete('host'); headers.delete('cookie');
    const response = await fetch(`${base}${url.pathname}${url.search}`, {
      method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
      redirect: 'manual', decompress: false,
    } as RequestInit);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  // ── Sessions ──
  const tokenOf = (req: Request) => req.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const sessionCookie = (token: string) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
  const clearedCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  const redirect = (to: string, cookie?: string) => new Response(null, { status: 303, headers: { Location: to, 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });

  async function publicFetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === '/signin') {
      if (!google) return page('Echo', `<h1>Echo</h1><p>Sign-in is not set up yet.</p>`, 503);
      const denied = url.searchParams.get('denied');
      if (denied) return page('Echo · private', `<h1>This Echo is private</h1><p><b>${esc(denied)}</b> is not on the list yet. ${esc(owner)} can see that you tried and can let you in; then sign in again.</p>${signInButton('Use another Google account')}`, 403);
      const failed = url.searchParams.get('failed');
      return page('Echo · sign in', `<h1>Echo</h1><p>${failed ? esc(failed) : 'French practice, with friends.'}</p>${signInButton()}<small>Only people ${esc(owner)} has added can come in.</small>`);
    }
    if (path === '/auth/google') {
      if (!google) return redirect('/signin');
      return new Response(null, { status: 302, headers: { Location: google.start(), 'Cache-Control': 'no-store' } });
    }
    if (path === '/auth/callback') {
      if (!google) return redirect('/signin');
      try {
        const identity = await google.finish(url.searchParams.get('code'), url.searchParams.get('state'));
        const listed = accounts.allowed(identity.email);
        const learner = accounts.admit(identity);
        if (!learner) {
          console.log(`pilot: ${identity.email} (${identity.name}) tried to sign in and is not on the list`);
          return redirect(`/signin?denied=${encodeURIComponent(identity.email)}`);
        }
        if (!listed) console.log(`pilot: ${identity.email} (${learner.name}) joined while the door was open`);
        return redirect('/echo/', sessionCookie(accounts.startSession(learner.id, req.headers.get('user-agent') ?? '')));
      } catch (error) {
        console.error(`pilot: a sign-in failed: ${error instanceof SignInError ? error.message : (error as Error).stack ?? error}`);
        return redirect(`/signin?failed=${encodeURIComponent(error instanceof SignInError ? error.message : 'Signing in did not work. Try again.')}`);
      }
    }
    if (path === '/auth/signout') {
      if (req.method !== 'POST' || req.headers.get('origin') !== options.origin) return new Response('Not allowed', { status: 403 });
      const token = tokenOf(req);
      if (token) accounts.endSession(token);
      return redirect('/signin', clearedCookie);
    }
    if (path === '/' || path === '/echo') return redirect('/echo/');
    if (!path.startsWith('/echo/')) return new Response('Not found', { status: 404 });
    const learner = accounts.session(tokenOf(req));
    if (!learner) {
      const wantsPage = req.method === 'GET' && (req.headers.get('accept') ?? '').includes('text/html');
      return wantsPage ? redirect('/signin', clearedCookie) : Response.json({ error: 'You are signed out. Reload Echo to sign in again.' }, { status: 401, headers: { 'Set-Cookie': clearedCookie } });
    }
    try { return await forward(req, learner); }
    catch (error) {
      console.error(`pilot: ${(error as Error).message}`);
      return Response.json({ error: 'Echo is starting up or could not start. Please try again in a moment.' }, { status: 503 });
    }
  }

  // ── Admin (this Mac only) ──
  async function adminFetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    try {
      if (path === '/friends' && req.method === 'GET') return Response.json({ friends: accounts.friends(), requests: accounts.requests(), openUntil: accounts.openUntil(), origin: options.origin, signIn: !!google });
      if (path === '/friends' && req.method === 'POST') return Response.json({ friend: accounts.add(await req.json()) });
      if (path === '/friends/remove' && req.method === 'POST') {
        const { id } = await req.json() as { id?: unknown };
        if (typeof id !== 'string' || !accounts.remove(id)) return Response.json({ error: 'That friend is not on the list.' }, { status: 404 });
        stopLearner(id);
        return Response.json({ ok: true });
      }
      if (path === '/friends/dismiss' && req.method === 'POST') {
        if (!accounts.dismiss((await req.json() as { email?: unknown }).email)) return Response.json({ error: 'Nobody with that email is waiting.' }, { status: 404 });
        return Response.json({ ok: true });
      }
      // The door: {"minutes": n} lets every new Google account in for n minutes (OPEN_MINUTES by default); 0 closes it.
      if (path === '/friends/door' && req.method === 'POST') {
        const { minutes } = await req.json() as { minutes?: unknown };
        const span = minutes === undefined ? OPEN_MINUTES : Number(minutes);
        if (!Number.isFinite(span) || span < 0 || span > 24 * 60) return Response.json({ error: 'Open the door for 0 to 1440 minutes.' }, { status: 400 });
        if (span === 0) accounts.closeDoor(); else accounts.openDoor(span);
        console.log(`pilot: the door is ${span === 0 ? 'closed' : `open until ${accounts.openUntil()}`}`);
        return Response.json({ openUntil: accounts.openUntil() });
      }
      return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
  }

  function backups() {
    for (const friend of accounts.friends()) {
      const db = join(options.data, friend.id, 'echo.db');
      try { backup(db, join(options.data, friend.id, 'backup')); } catch (error) { console.error(`pilot: backup of ${friend.id} failed`, error); }
      if (options.offsite) try { offsite(db, join(options.offsite, `${friend.id}.db`)); } catch (error) { console.error(`pilot: daily copy of ${friend.id} failed`, error); }
    }
    accounts.dropExpired();
  }
  // Stops a learner's Echo after IDLE without a request; the next request starts it again.
  function sweep() { for (const [id, entry] of running) if (Date.now() - entry.lastSeen > IDLE) stopLearner(id); }
  function stop() { for (const id of [...running.keys()]) stopLearner(id); accounts.close(); }

  return { publicFetch, adminFetch, backups, sweep, stop, accounts };
}

if (import.meta.main) {
  const data = process.env.PILOT_DATA ?? join(homedir(), 'echo-pilot');
  // Published by a second Tailscale node on the owner's private tailnet (launchd com.galt.echo-funnel), with Funnel.
  const origin = process.env.PILOT_ORIGIN ?? 'https://echo.tail023898.ts.net';
  // The Google OAuth client, kept on this Mac only: {"clientId": "...", "clientSecret": "..."}.
  const googleFile = join(data, 'google.json');
  const google = existsSync(googleFile) ? JSON.parse(readFileSync(googleFile, 'utf8')) as { clientId: string; clientSecret: string } : null;
  const pilot = createPilot({ data, origin, ownerData: process.env.PILOT_OWNER_DATA ?? join(ROOT, 'data'), firstPort: 7900, google, offsite: join(OFFSITE_DIR, 'friends') });
  const port = Number(process.env.PILOT_PORT ?? 7899), adminPort = Number(process.env.PILOT_ADMIN_PORT ?? 7898);
  const publicServer = Bun.serve({ hostname: '127.0.0.1', port, idleTimeout: 120, fetch: pilot.publicFetch });
  const adminServer = Bun.serve({ hostname: '127.0.0.1', port: adminPort, fetch: pilot.adminFetch });
  pilot.backups();
  const timers = [setInterval(pilot.sweep, 60_000), setInterval(pilot.backups, 60 * 60_000)];
  const shutdown = () => { timers.forEach(clearInterval); pilot.stop(); publicServer.stop(); adminServer.stop(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  console.log(`pilot: ${origin} on 127.0.0.1:${port}, admin on 127.0.0.1:${adminPort}; Google sign-in ${google ? 'on' : 'not set up'}; ${pilot.accounts.friends().length} on the list`);
}
