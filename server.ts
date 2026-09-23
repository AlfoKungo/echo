import { mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { createStore, StoreError } from './lib/store';
import { createGrammarStore } from './lib/grammar-store';
import { loadCourse } from './lib/grammar-content';
import { createLearningStore } from './lib/learning-store';
import { LocalTutor } from './lib/local-tutor';
import type { LearningAttemptInput, LearningContent, TutorInput } from './learning-contract';
import type { Direction, GradeInput, GrammarMutation, ReviewEarlyInput, Word } from './contract';

const root = import.meta.dir;
const core = await Bun.file(join(root, 'content/core.json')).json() as Word[];
const world = await Bun.file(join(root, 'content/world.json')).json() as Word[];
const groups = Map.groupBy([...core, ...world], (word) => word.category);
// Interleave topics so a mixed deck begins with useful words from every topic.
const words: Word[] = [];
for (let i = 0; i < Math.max(...[...groups.values()].map(group => group.length)); i++) {
  for (const group of groups.values()) if (group[i]) words.push(group[i]);
}
const byId = new Map(words.map(word => [word.id, word]));
if (byId.size !== words.length) throw new Error('Duplicate vocabulary IDs');
const dbPath = process.env.ECHO_DB ?? join(root, 'data/echo.db');
const store = createStore(words, { dbPath });
const grammar = createGrammarStore(await loadCourse(join(root, 'content/grammar')), { dbPath });
const learningContent = await Bun.file(join(root, 'content/learning.json')).json() as LearningContent;
const learning = createLearningStore(learningContent, { dbPath, words, vocabulary: store, grammar });
const tutor = new LocalTutor(learning);
const learningAudio = new Set([
  ...learningContent.listening.map(lesson => lesson.audioId),
  ...learningContent.conversations.flatMap(lesson => lesson.turns.map(turn => turn.audioId)),
]);
const port = Number(process.env.ECHO_PORT ?? 7792);
const prefix = '/echo';
const publicOrigin = process.env.ECHO_ORIGIN ?? 'https://gals-macbook-pro.tailb1ce54.ts.net';
const allowedHosts = new Set([new URL(publicOrigin).host, `127.0.0.1:${port}`, `localhost:${port}`]);
const allowedOrigins = new Set([publicOrigin, `http://127.0.0.1:${port}`, `http://localhost:${port}`]);

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
function direction(value: unknown): Direction {
  if (value !== 'fr-en' && value !== 'en-fr') throw new StoreError('Choose French to English or English to French.', 400);
  return value;
}
function deck(value: unknown): string {
  if (typeof value !== 'string') throw new StoreError('Choose a vocabulary deck.', 400);
  return value;
}
async function body(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new StoreError('This action requires a JSON request.', 415);
  }
  let data: unknown;
  try { data = await req.json(); } catch { throw new StoreError('The request was not valid JSON. Please try again.', 400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new StoreError('The request must be an object.', 400);
  return data as Record<string, unknown>;
}
function grammarMutation(data: Record<string, unknown>): GrammarMutation {
  const { sessionId, exerciseId, version, requestId } = data;
  if (typeof sessionId !== 'string' || !sessionId || typeof exerciseId !== 'string' || !exerciseId ||
      typeof version !== 'number' || !Number.isInteger(version) || version < 0 ||
      typeof requestId !== 'string' || !requestId) {
    throw new StoreError('This exercise has changed. Reload it and try again.', 400);
  }
  return { sessionId, exerciseId, version, requestId };
}
const staticFiles: Record<string, true> = {
  'index.html': true, 'app.js': true, 'app.css': true, 'icon.svg': true,
  'learning.html': true, 'learning.js': true, 'learning.css': true,
  'icon-180.png': true, 'icon-192.png': true, 'icon-512.png': true, 'manifest.webmanifest': true,
};

const server = Bun.serve({
  hostname: '127.0.0.1', port,
  async fetch(req) {
    const url = new URL(req.url);
    if (!allowedHosts.has(req.headers.get('host') ?? '')) return json({ error: 'Unknown host.' }, 403);
    let path = url.pathname;
    if (path === prefix) return Response.redirect(`${prefix}/`, 308);
    if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.get('origin');
      if ((origin && !allowedOrigins.has(origin)) || req.headers.get('sec-fetch-site') === 'cross-site') {
        return json({ error: 'Open Echo directly before changing your progress.' }, 403);
      }
    }
    try {
      if (path === '/healthz' && req.method === 'GET') return json({ ok: true, app: 'Echo', words: words.length });
      if (path === '/api/state' && req.method === 'GET') return json(store.state(direction(url.searchParams.get('direction') ?? 'fr-en'), deck(url.searchParams.get('deck') ?? 'all')));
      if (path === '/api/words' && req.method === 'GET') return json({ words: store.browse(direction(url.searchParams.get('direction') ?? 'fr-en'), deck(url.searchParams.get('deck') ?? 'all')) });
      if (path === '/api/export' && req.method === 'GET') return new Response(JSON.stringify(Object.assign({}, store.exportData(), { version: 3, grammar: grammar.exportData(), learning: learning.exportData() }), null, 2), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="echo-progress-${new Date().toISOString().slice(0, 10)}.json"` } });
      if (path === '/learn' || path === '/learning.html') return Response.redirect(`${url.pathname.startsWith(prefix) ? prefix : ''}/learn/`, 308);
      if (path === '/api/learning/catalog' && req.method === 'GET') return json(learning.catalog());
      if (path === '/api/learning/materials' && req.method === 'GET') return json({ materials: learning.materials() });
      if (path.startsWith('/api/learning/materials/') && req.method === 'GET') return json(learning.material(decodeURIComponent(path.slice('/api/learning/materials/'.length))));
      if (path === '/api/learning/progress' && req.method === 'GET') return json(learning.progress());
      if (path === '/api/learning/attempt' && req.method === 'POST') return json(learning.attempt(await body(req) as unknown as LearningAttemptInput));
      if (path === '/api/learning/phrases' && req.method === 'POST') {
        const data = await body(req);
        if (['requestId', 'fr', 'en', 'sourceId'].some(key => typeof data[key] !== 'string' || !String(data[key]).trim()) || typeof data.explanation !== 'string') throw new StoreError('Choose a phrase and its meaning before saving it.', 400);
        return json(learning.savePhrase(data as { requestId: string; fr: string; en: string; sourceId: string; explanation: string }));
      }
      if (path === '/api/learning/review' && req.method === 'POST') {
        const data = await body(req);
        if (typeof data.requestId !== 'string' || !data.requestId || typeof data.reviewId !== 'string' || typeof data.known !== 'boolean') throw new StoreError('Reveal this review card before rating your recall.', 400);
        return json(learning.review(data as { requestId: string; reviewId: string; known: boolean }));
      }
      if (path === '/api/learning/tutor/status' && req.method === 'GET') return json(tutor.status());
      if (path === '/api/learning/tutor/last' && req.method === 'GET') {
        const kind = url.searchParams.get('kind');
        if (kind !== 'writing' && kind !== 'material') throw new StoreError('Choose writing or material feedback.', 400);
        return json({ job: learning.lastTutorJob(url.searchParams.get('sourceId') ?? '', kind) });
      }
      if (path === '/api/learning/tutor/stop' && req.method === 'POST') return json(await tutor.stopAll());
      if (path === '/api/learning/tutor' && req.method === 'POST') return json(tutor.submit(await body(req) as unknown as TutorInput), 202);
      const pendingStop = path.match(/^\/api\/learning\/tutor\/request\/([^/]+)\/stop$/);
      if (pendingStop && req.method === 'POST') return json(tutor.cancelRequest(decodeURIComponent(pendingStop[1])));
      const tutorMatch = path.match(/^\/api\/learning\/tutor\/([^/]+)(\/stop)?$/);
      if (tutorMatch && req.method === 'GET' && !tutorMatch[2]) return json(tutor.get(tutorMatch[1]));
      if (tutorMatch && req.method === 'POST' && tutorMatch[2]) return json(tutor.cancel(tutorMatch[1]));
      if (path === '/api/grammar' && req.method === 'GET') return json({ units: grammar.catalog() });
      if (path === '/api/grammar/state' && req.method === 'GET') return json(grammar.state(url.searchParams.get('scope') ?? ''));
      if (path === '/api/grammar/session' && req.method === 'POST') {
        const data = await body(req);
        if (typeof data.scope !== 'string' || !data.scope || typeof data.requestId !== 'string' || !data.requestId) {
          throw new StoreError('Choose a grammar topic, test or unit test and try again.', 400);
        }
        return json(grammar.start(data.scope, data.requestId));
      }
      if (path === '/api/grammar/answer' && req.method === 'POST') {
        const data = await body(req);
        const mutation = grammarMutation(data);
        if (typeof data.answer !== 'string') throw new StoreError('Enter your answer before checking it.', 400);
        if (data.tokenOrder !== undefined && (!Array.isArray(data.tokenOrder) || !data.tokenOrder.every(Number.isInteger))) {
          throw new StoreError('Choose words from this exercise’s tiles and try again.', 400);
        }
        return json(grammar.answer({ ...mutation, answer: data.answer, tokenOrder: data.tokenOrder as number[] | undefined }));
      }
      if (path === '/api/grammar/help' && req.method === 'POST') {
        const data = await body(req);
        const mutation = grammarMutation(data);
        if (data.kind !== 'hint' && data.kind !== 'rule' && data.kind !== 'answer') {
          throw new StoreError('Choose a hint, the rule, or the answer.', 400);
        }
        return json(grammar.help({ ...mutation, kind: data.kind }));
      }
      if (path === '/api/grammar/next' && req.method === 'POST') return json(grammar.next(grammarMutation(await body(req))));
      if (path === '/api/settings' && req.method === 'PUT') {
        const data = await body(req);
        if (typeof data.newPerDay !== 'number') throw new StoreError('New words per day must be a number.', 400);
        return json(store.setSettings(data.newPerDay));
      }
      if (path === '/api/extra-words' && req.method === 'POST') {
        const data = await body(req);
        return json(store.addExtraWords({ direction: direction(data.direction), deck: deck(data.deck), count: data.count as number, requestId: data.requestId as string }));
      }
      if (path === '/api/review-early' && req.method === 'POST') {
        const data = await body(req);
        return json(store.reviewEarly({ direction: direction(data.direction), deck: deck(data.deck), mode: data.mode as ReviewEarlyInput['mode'], count: data.count as number, requestId: data.requestId as string }));
      }
      if (path === '/api/session' && req.method === 'POST') {
        const data = await body(req);
        return json(store.start(direction(data.direction), deck(data.deck)));
      }
      if (path === '/api/grade' && req.method === 'POST') {
        const data = await body(req);
        if (typeof data.wordId !== 'string' || typeof data.known !== 'boolean' || !Number.isInteger(data.version) || typeof data.requestId !== 'string' || !data.requestId) {
          throw new StoreError('The answer was incomplete. Reload this card and try again.', 400);
        }
        return json(store.grade({ ...data, direction: direction(data.direction), deck: deck(data.deck) } as GradeInput));
      }
      if (path === '/api/undo' && req.method === 'POST') {
        const data = await body(req);
        if (typeof data.undoId !== 'string') throw new StoreError('There is no answer to undo.', 400);
        return json(store.undo(direction(data.direction), deck(data.deck), data.undoId));
      }
      if (path.startsWith('/audio/') && (req.method === 'GET' || req.method === 'HEAD')) {
        const isLearning = path.startsWith('/audio/learning/');
        const match = path.match(isLearning ? /^\/audio\/learning\/([a-z0-9-]+)\.mp3$/ : /^\/audio\/([a-z0-9-]+)\.mp3$/);
        if (!match || !(isLearning ? learningAudio.has(match[1]) : byId.has(match[1]))) return json({ error: isLearning ? 'This recording is not part of a learning activity.' : 'This word is not in the vocabulary deck.' }, 404);
        const file = Bun.file(join(root, 'audio', ...(isLearning ? ['learning'] : []), `${match[1]}.mp3`));
        if (!await file.exists()) return json({ error: 'This French recording is not ready. Please try again shortly.' }, 503);
        const headers = { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
        const range = req.headers.get('range');
        if (range) {
          const r = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!r || (!r[1] && !r[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}` } });
          const start = r[1] ? Number(r[1]) : Math.max(0, file.size - Number(r[2]));
          const end = r[1] && r[2] ? Math.min(Number(r[2]), file.size - 1) : file.size - 1;
          if (start >= file.size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}` } });
          return new Response(req.method === 'HEAD' ? null : file.slice(start, end + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${file.size}`, 'Content-Length': String(end - start + 1) } });
        }
        return new Response(req.method === 'HEAD' ? null : file, { headers: { ...headers, 'Content-Length': String(file.size) } });
      }
      const name = path === '/' ? 'index.html' : path === '/learn/' ? 'learning.html' : path.slice(1);
      if (Object.hasOwn(staticFiles, name) && (req.method === 'GET' || req.method === 'HEAD')) {
        const file = Bun.file(join(root, 'static', name));
        if (await file.exists()) return new Response(req.method === 'HEAD' ? null : file, { headers: { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' } });
      }
      return json({ error: 'This Echo page or action does not exist.' }, 404);
    } catch (error) {
      if (error instanceof StoreError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: 'Echo could not finish this request. Please try again; saved answers will not be counted twice.' }, 500);
    }
  },
});

// SQLite's snapshot copy includes WAL commits, unlike copying the .db file.
function backup() {
  if (process.env.ECHO_DB || !existsSync(dbPath)) return;
  const dir = join(root, 'backup');
  mkdirSync(dir, { recursive: true });
  const name = `echo-${new Date().toISOString().slice(0, 13).replace('T', '-')}.db`;
  const target = join(dir, name);
  if (existsSync(target)) return;
  const db = new Database(dbPath);
  try { db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`); } finally { db.close(); }
  for (const entry of readdirSync(dir).filter(n => /^echo-\d{4}-\d{2}-\d{2}-\d{2}\.db$/.test(n)).sort().slice(0, -48)) unlinkSync(join(dir, entry));
}
try { backup(); } catch (error) { console.error('Echo backup failed', error); }
const backups = setInterval(() => { try { backup(); } catch (error) { console.error('Echo backup failed', error); } }, 60 * 60 * 1000);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(backups);
  await server.stop(true);
  await tutor.close();
  learning.close();
  grammar.close();
  store.close();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
console.log(`Echo ready at http://127.0.0.1:${port}/echo/ (${words.length} words)`);
