// The owner's French Echo hosts the other languages: /echo/<code>/… goes to that language's own Echo process as
// /echo/…, so the phone reaches every language through the one address Tailscale already serves. Each process is
// started with the French Echo and again on the first request after it stopped (lib/echo-processes.ts), and stops
// with it. A language that is down or still starting never holds French up: its page says so, offers the way back to
// French and, while starting, reloads itself.
import { join } from 'node:path';
import { backup, offsite, OFFSITE_DIR } from './backups';
import { createEchoProcesses, forward, type EchoState } from './echo-processes';
import type { Language } from './language';

// How long a request waits for a language that is starting before it gets the starting page instead.
const STARTING_WAIT = 4000;
// The French Echo's settings a language process shares: whether to record at all, and the recorders' Python.
const SHARED_ENV = ['ECHO_WORD_AUDIO', 'ECHO_PYTHON'];

export type LanguageStatus = { code: string; english: string; own: string; state: EchoState | 'here' };

export function createLanguageHost(options: { french: Language; others: Language[]; data: string; origin: string }) {
  const processes = createEchoProcesses();
  const byCode = new Map(options.others.map((language) => [language.code as string, language]));
  const shared = Object.fromEntries(SHARED_ENV.flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []));
  const dirOf = (language: Language) => join(options.data, language.code);
  const backend = (language: Language) => processes.backend(language.code, () => ({
    port: language.port, dir: dirOf(language),
    env: { ...shared, ECHO_LANG: language.code, ECHO_DB: join(dirOf(language), 'echo.db'), ECHO_ORIGIN: options.origin },
  }));

  // Every language starts with the French Echo, so the first switch to one does not wait for it.
  function start() {
    for (const language of options.others) backend(language).catch((error: Error) => console.error(`languages: ${error.message}`));
  }

  const status = (): LanguageStatus[] => [options.french, ...options.others].map((language) => ({
    code: language.code, english: language.english, own: language.own,
    state: language === options.french ? 'here' : processes.state(language.code),
  }));

  function unavailable(req: Request, language: Language, starting: boolean): Response {
    const message = starting ? `${language.own} is starting…` : `${language.own} is unavailable right now.`;
    const wantsPage = (req.method === 'GET' || req.method === 'HEAD') && (req.headers.get('accept') ?? '').includes('text/html');
    if (!wantsPage) return Response.json({ error: starting ? `${language.own} is starting. Try again in a moment.` : message }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '2' } });
    // The app's own colours (Dusk, or Paper when this phone chose it), and the way back to French, which this phone
    // then opens on (static/app.js, echo.language).
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Echo · ${language.english}</title>
<script>try { if (localStorage.getItem('echo.theme') === 'paper') document.documentElement.dataset.theme = 'paper'; } catch {}</script>${starting ? '<meta http-equiv="refresh" content="2">' : ''}
<style>:root{color-scheme:dark;--page:#0b0b10;--ink:#f4f2f8;--violet:#bdb5ff}:root[data-theme=paper]{color-scheme:light;--page:#f6f2eb;--ink:#302936;--violet:#725197}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--page);color:var(--ink);font:17px/1.5 system-ui,-apple-system,sans-serif}main{padding:32px 24px;text-align:center}
h1{font-size:24px;font-weight:600;margin:0 0 20px}a,button{font:inherit;color:var(--violet);background:none;border:0;padding:8px 12px;cursor:pointer;text-decoration:none}</style></head>
<body><main><h1 role="status">${message}</h1>${starting ? '' : '<button onclick="location.reload()">Try again</button>'}<a href="../" onclick="try { localStorage.setItem('echo.language', 'fr') } catch {}">Back to ${options.french.own}</a></main></body></html>`;
    return new Response(req.method === 'HEAD' ? null : page, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '2' } });
  }

  // A request under /echo/<code>/ (`path` is what follows /echo), or null when it is not for another language.
  async function handle(req: Request, path: string): Promise<Response | null> {
    const match = path.match(/^\/([a-z]{2})(\/.*)?$/);
    const language = match ? byCode.get(match[1]!) : undefined;
    if (!language) return null;
    // Relative, like the server's other redirects: the proxy in front may strip /echo.
    if (!match![2]) return new Response(null, { status: 308, headers: { location: `${language.code}/` } });
    const starting = backend(language);
    starting.catch(() => {});
    const base = await Promise.race([starting, Bun.sleep(STARTING_WAIT).then(() => null)]).catch(() => undefined);
    if (base === undefined) return unavailable(req, language, false);
    if (base === null) return unavailable(req, language, true);
    try { return await forward(req, base, `/echo${match![2]}`); }
    catch (error) {
      console.error(`languages: ${language.code} did not answer: ${(error as Error).message}`);
      return unavailable(req, language, processes.state(language.code) === 'starting');
    }
  }

  // Each language's database, snapshotted hourly beside it and copied off this Mac daily, as French is (lib/backups.ts).
  function backups() {
    for (const language of options.others) {
      const db = join(dirOf(language), 'echo.db');
      try { backup(db, join(dirOf(language), 'backup')); } catch (error) { console.error(`languages: backup of ${language.code} failed`, error); }
      try { offsite(db, join(OFFSITE_DIR, 'languages', `${language.code}.db`)); } catch (error) { console.error(`languages: daily copy of ${language.code} failed`, error); }
    }
  }

  return { start, status, handle, backups, stop: processes.stopAll };
}
