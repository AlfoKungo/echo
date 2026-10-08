import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MistakeGroup } from '../comprehension-contract';
import type { Bank } from './comprehension-content';
import { createComprehensionStore, parseStream, type ComprehensionMutation, type ComprehensionStore, type WordKnowledge } from './comprehension-store';
import type { GrammarStore } from './grammar-store';
import { StoreError, type Store } from './store';
import { audioFile } from './http';

export type ComprehensionDeps = {
  root: string;
  dbPath: string;
  bank: Bank;
  vocabulary: Store;
  grammar: GrammarStore;
  // The verb forms at -2 or lower, lowest first (lib/verb-drills.ts): Mistakes shows them as one group.
  shakyForms?: () => { form: string }[];
  now?: () => Date;
  random?: () => number;
};

export type ComprehensionRoutes = {
  handle(path: string, req: Request, url: URL): Promise<Response | null>;
  summary: ComprehensionStore['summary'];
  stock: ComprehensionStore['stock'];
  metWords: ComprehensionStore['metWords'];
  exportData(): unknown;
  close(): void;
};

const CLIP_TTL = 10_000; // a missing clip is re-checked this often, so Listen picks up new audio without a restart
const EXAMPLES = 3;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export function createComprehensionRoutes(deps: ComprehensionDeps): ComprehensionRoutes {
  const clipDir = join(deps.root, 'audio/comprehension');
  const clipIds = new Set([
    ...deps.bank.sentences.map((sentence) => sentence.id),
    ...deps.bank.passages.flatMap((passage) => passage.lines.map((_, index) => `${passage.id}-${index + 1}`)),
  ]);
  const clipCache = new Map<string, { at: number; exists: boolean }>();
  function clipExists(clip: string): boolean {
    const at = Date.now();
    const cached = clipCache.get(clip);
    if (cached && (cached.exists || at - cached.at < CLIP_TTL)) return cached.exists;
    const exists = existsSync(join(clipDir, `${clip}.mp3`));
    clipCache.set(clip, { at, exists });
    return exists;
  }

  const store = createComprehensionStore(deps.bank, {
    dbPath: deps.dbPath,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.random ? { random: deps.random } : {}),
    clipExists,
    knownStatus: () => {
      const scores = new Map(deps.vocabulary.listening().map((word) => [word.id, word.score]));
      return new Map<string, WordKnowledge>(deps.vocabulary.browse('fr-en', 'all').map((word) => [word.id, { status: word.status, misses: word.misses, score: scores.get(word.id) ?? 0 }]));
    },
  });

  async function body(req: Request): Promise<Record<string, unknown>> {
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      throw new StoreError('This action requires a JSON request.', 415);
    }
    let data: unknown;
    try { data = await req.json(); } catch { throw new StoreError('The request was not valid JSON. Please try again.', 400); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new StoreError('The request must be an object.', 400);
    return data as Record<string, unknown>;
  }

  function mutation(data: Record<string, unknown>): ComprehensionMutation {
    const stream = parseStream(data.stream);
    if (typeof data.key !== 'string' || !data.key.trim() || !Number.isInteger(data.version) || (data.version as number) < 0) {
      throw new StoreError('This exercise has moved on. Reload it and try again.', 400);
    }
    if (typeof data.requestId !== 'string' || !data.requestId.trim()) {
      throw new StoreError('This request is missing its ID. Reload and try again.', 400);
    }
    return { stream, key: data.key, version: data.version as number, requestId: data.requestId };
  }

  function mistakes(): { groups: MistakeGroup[] } {
    const vocabulary = deps.vocabulary.listening();
    const comprehension = store.misses();

    const titles = new Map<string, string>();
    for (const unit of deps.grammar.catalog()) for (const topic of unit.topics) titles.set(topic.id, topic.title);
    const topics = new Map<string, { count: number; examples: string[] }>();
    const note = (topicId: string, example: string) => {
      const group = topics.get(topicId) ?? { count: 0, examples: [] };
      group.count += 1;
      if (example && !group.examples.includes(example)) group.examples.push(example);
      topics.set(topicId, group);
    };
    for (const miss of deps.grammar.misses()) {
      if (!titles.has(miss.topicId)) titles.set(miss.topicId, miss.topicTitle);
      note(miss.topicId, miss.example);
    }
    for (const miss of comprehension) for (const topic of miss.topics) note(topic, miss.example);

    // Weak words: those scoring below 0 now, weakest first. The group shrinks as they are fixed.
    const weak = vocabulary.filter((word) => word.score < 0).sort((a, b) => a.score - b.score);

    const groups: MistakeGroup[] = [];
    // A comprehension miss carries several topic tags, so one slip alone says little: a topic shows once it recurs.
    for (const [topicId, group] of topics) {
      if (group.count < 2) continue;
      groups.push({
        id: topicId, kind: 'grammar', title: titles.get(topicId) ?? topicId, count: group.count,
        examples: group.examples.slice(0, EXAMPLES), grammarScope: topicId, stream: `focus:topic:${topicId}`,
      });
    }
    if (weak.length) {
      groups.push({
        id: 'words', kind: 'words', title: 'Words you keep missing', count: weak.length,
        examples: weak.slice(0, EXAMPLES).map((word) => word.fr), stream: 'focus:words',
      });
    }
    const forms = deps.shakyForms?.() ?? [];
    if (forms.length) {
      groups.push({
        id: 'verb-forms', kind: 'verbs', title: 'Verb forms', count: forms.length,
        examples: forms.slice(0, EXAMPLES).map((entry) => entry.form),
      });
    }
    if (comprehension.length) {
      const examples: string[] = [];
      for (const miss of comprehension) if (examples.length < EXAMPLES && !examples.includes(miss.example)) examples.push(miss.example);
      groups.push({
        id: 'missed', kind: 'sentences', title: 'Sentences you didn’t catch', count: comprehension.length,
        examples, stream: 'focus:missed',
      });
    }
    return { groups: groups.filter((group) => group.count > 0).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)) };
  }

  async function audio(clip: string, req: Request): Promise<Response> {
    if (!clipIds.has(clip)) return json({ error: 'This recording is not part of a comprehension exercise.' }, 404);
    const file = Bun.file(join(clipDir, `${clip}.mp3`));
    if (!await file.exists()) return json({ error: 'This French recording is not ready yet. Read this one instead, or try again shortly.' }, 404);
    return audioFile(req, file);
  }

  async function handle(path: string, req: Request, url: URL): Promise<Response | null> {
    const route = path.replace(/^\/+/, '');
    if (route === 'api/comprehension/state' && req.method === 'GET') {
      return json(store.state(parseStream(url.searchParams.get('stream'))));
    }
    if (route === 'api/comprehension/lookup' && req.method === 'POST') {
      const data = await body(req);
      if (typeof data.fr !== 'string' || !data.fr.trim()) throw new StoreError('Tap a word in the French to look it up.', 400);
      return json(store.lookup({ ...mutation(data), fr: data.fr }));
    }
    if (route === 'api/comprehension/answer' && req.method === 'POST') {
      const data = await body(req);
      if (!Number.isInteger(data.choice)) throw new StoreError('Choose one of the answers before checking.', 400);
      return json(store.answer({ ...mutation(data), choice: data.choice as number }));
    }
    if (route === 'api/comprehension/next' && req.method === 'POST') return json(store.next(mutation(await body(req))));
    if (route === 'api/vocabulary/add' && req.method === 'POST') {
      const data = await body(req);
      if (typeof data.wordId !== 'string' || !data.wordId.trim()) throw new StoreError('Choose a word to add to your vocabulary.', 400);
      if (typeof data.requestId !== 'string' || !data.requestId.trim()) throw new StoreError('This request is missing its ID. Reload and try again.', 400);
      return json(deps.vocabulary.addWord({ wordId: data.wordId, requestId: data.requestId }));
    }
    if (route === 'api/mistakes' && req.method === 'GET') return json(mistakes());
    if (route.startsWith('audio/comprehension/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const match = /^audio\/comprehension\/([a-z0-9-]+)\.mp3$/.exec(route);
      if (!match) return json({ error: 'This recording is not part of a comprehension exercise.' }, 404);
      return audio(match[1]!, req);
    }
    return null;
  }

  return { handle, summary: store.summary, stock: store.stock, metWords: store.metWords, exportData: store.exportData, close: store.close };
}
