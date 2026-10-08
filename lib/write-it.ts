// Write it: a short English sentence to write in French, built from words the learner knows and a grammar topic
// they have started. Claude writes the sentences ahead, a batch at a time, so only checking an answer waits on it;
// a new batch is asked for while a few are still waiting. Each check is kept once per request id. Nothing here is
// scored: it is practice, like Listen and Read.
import { Database } from 'bun:sqlite';
import type { Ask } from './claude';
import { StoreError } from './store';

export type WriteKnowledge = {
  known: { fr: string; en: string }[];
  level: number; // the Read level: 1 A1, 2 A2, 3 B1
  topics: { id: string; title: string; seen: number; independent: number }[];
};
export type WriteItem = { id: string; en: string; topicId: string; topicTitle: string };
export type WriteVerdict = 'right' | 'nearly' | 'wrong';
export type WriteResult = { verdict: WriteVerdict; given: string; corrected: string; explanation: string; natural: string };
export type WriteState = { current: WriteItem | null; result: WriteResult | null; waiting: number; writing: boolean; error: string | null };

const BATCH = 8;
const REFILL_AT = 3;
const LEVELS = ['A1', 'A2', 'B1'];

// Topics to write about: the ones started, weakest first (fewest answered on their own for what was seen); the
// first ones in the course while none is started yet.
export function pickTopics(topics: WriteKnowledge['topics'], count = 3): WriteKnowledge['topics'] {
  const started = topics.filter((topic) => topic.seen > 0).sort((a, b) => a.independent / a.seen - b.independent / b.seen);
  return (started.length ? started : topics).slice(0, count);
}

export function sentencesPrompt(knowledge: WriteKnowledge, topics: WriteKnowledge['topics']): string {
  const level = LEVELS[Math.max(0, Math.min(2, knowledge.level - 1))];
  return `You write practice sentences for Echo, an app for one English speaker learning French at about ${level}. The learner reads an English sentence and types it in French; then their answer is checked.

Write ${BATCH} sentences. Each:
- uses one of these grammar topics, spread evenly across them: ${topics.map((topic) => `${topic.id} (${topic.title})`).join('; ')};
- is 4 to 12 words of everyday French, the kind of thing a person says or writes, with one clear natural translation;
- uses only words from the learner's vocabulary below (any form of them: conjugated, plural, feminine), plus little words (articles, pronouns, prepositions, common determiners) and first names;
- has English that leads to that French without giving the grammar away in brackets.

Reply with JSON only: {"sentences": [{"en": "...", "fr": "...", "topic": "<topic id>"}]}

The learner's vocabulary (French = English):
${knowledge.known.map((word) => `${word.fr} = ${word.en}`).join('\n')}`;
}

export function checkPrompt(item: { en: string; fr: string }, given: string): string {
  return `You check a French sentence typed by an English speaker learning French (A2 towards B1) in Echo, a learning app.

They were asked to write this in French: ${JSON.stringify(item.en)}
One good answer: ${JSON.stringify(item.fr)}
They typed: ${JSON.stringify(given)}

Judge their sentence on its own merits: any correct, natural way of saying it is right, even far from the answer above. Then reply with JSON only:
{"verdict": "right" | "nearly" | "wrong", "corrected": "...", "explanation": "...", "natural": "..."}
- verdict: "right" if it is correct French that says it; "nearly" if the only slips are accents, a typo, or one small agreement or spelling mistake; "wrong" otherwise.
- corrected: their own sentence with the fewest changes that make it right (exactly their sentence when it is right).
- explanation: in plain English, one short sentence per mistake saying what was wrong and why, in a way they can reuse; empty when it is right.
- natural: how a French speaker would most naturally say it.`;
}

const json = (reply: string): unknown => { try { return JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)); } catch { return null; } };
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export function parseSentences(reply: string, topicIds: Set<string>): { en: string; fr: string; topicId: string }[] {
  const parsed = json(reply) as { sentences?: unknown } | null;
  if (!Array.isArray(parsed?.sentences)) return [];
  return parsed.sentences.flatMap((entry) => {
    const sentence = entry as Record<string, unknown>;
    const en = text(sentence?.en), fr = text(sentence?.fr), topicId = text(sentence?.topic);
    return en && fr && topicIds.has(topicId) && en.length <= 200 && fr.length <= 200 ? [{ en, fr, topicId }] : [];
  });
}

export function parseCheck(reply: string, given: string): WriteResult {
  const parsed = json(reply) as Record<string, unknown> | null;
  const verdict = parsed?.verdict;
  if (verdict !== 'right' && verdict !== 'nearly' && verdict !== 'wrong') throw new StoreError('The answer could not be checked. Please try again.', 503);
  return { verdict, given, corrected: text(parsed?.corrected) || given, explanation: verdict === 'right' ? '' : text(parsed?.explanation), natural: text(parsed?.natural) };
}

export function createWriteIt(deps: { dbPath: string; ask: Ask; knowledge: () => WriteKnowledge; titles: () => Map<string, string>; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  const db = new Database(deps.dbPath, { create: true, strict: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS write_items (id INTEGER PRIMARY KEY, en TEXT NOT NULL, fr TEXT NOT NULL, topic_id TEXT NOT NULL, created_at TEXT NOT NULL, done_at TEXT);
    CREATE TABLE IF NOT EXISTS write_answers (request_id TEXT PRIMARY KEY, item_id INTEGER NOT NULL, given TEXT NOT NULL, result_json TEXT NOT NULL, answered_at TEXT NOT NULL);`);
  const waitingItems = db.query<{ id: number; en: string; fr: string; topic_id: string }, []>('SELECT id, en, fr, topic_id FROM write_items WHERE done_at IS NULL ORDER BY id');
  const itemById = db.query<{ id: number; en: string; fr: string; topic_id: string; done_at: string | null }, [number]>('SELECT id, en, fr, topic_id, done_at FROM write_items WHERE id = ?');
  const addItem = db.query('INSERT INTO write_items (en, fr, topic_id, created_at) VALUES (?, ?, ?, ?)');
  const finish = db.query('UPDATE write_items SET done_at = ? WHERE id = ? AND done_at IS NULL');
  const answerById = db.query<{ item_id: number; result_json: string }, [string]>('SELECT item_id, result_json FROM write_answers WHERE request_id = ?');
  const latestAnswer = db.query<{ result_json: string }, [number]>('SELECT result_json FROM write_answers WHERE item_id = ? ORDER BY answered_at DESC LIMIT 1');
  const saveAnswer = db.query('INSERT OR IGNORE INTO write_answers (request_id, item_id, given, result_json, answered_at) VALUES (?, ?, ?, ?, ?)');

  let writing: Promise<void> | null = null;
  let error: string | null = null;
  const checking = new Map<string, Promise<WriteResult>>();

  // Asks for a batch when few are left; one batch at a time, and a failure is shown until the next try.
  function refill(): void {
    if (writing || waitingItems.all().length >= REFILL_AT) return;
    writing = (async () => {
      try {
        const knowledge = deps.knowledge();
        const topics = pickTopics(knowledge.topics);
        if (!topics.length || !knowledge.known.length) throw new StoreError('Write it needs a few words and a grammar topic started first.');
        const reply = await deps.ask(sentencesPrompt(knowledge, topics), { timeout: 5 * 60_000, purpose: 'writing sentences to translate' });
        const sentences = parseSentences(reply, new Set(topics.map((topic) => topic.id)));
        if (!sentences.length) throw new StoreError('Claude’s sentences could not be read. Please try again.');
        const at = now().toISOString();
        for (const sentence of sentences) addItem.run(sentence.en, sentence.fr, sentence.topicId, at);
        error = null;
      } catch (failure) {
        error = failure instanceof Error ? failure.message : 'The sentences could not be written.';
      } finally { writing = null; }
    })();
  }

  function itemView(row: { id: number; en: string; topic_id: string }): WriteItem {
    return { id: String(row.id), en: row.en, topicId: row.topic_id, topicTitle: deps.titles().get(row.topic_id) ?? '' };
  }
  function state(): WriteState {
    refill();
    const waiting = waitingItems.all();
    const first = waiting[0];
    const answered = first ? latestAnswer.get(first.id) : null;
    return { current: first ? itemView(first) : null, result: answered ? JSON.parse(answered.result_json) as WriteResult : null, waiting: waiting.length, writing: !!writing, error: writing ? null : error };
  }
  const itemOf = (id: unknown) => {
    const row = typeof id === 'string' && /^\d+$/.test(id) ? itemById.get(Number(id)) : null;
    if (!row) throw new StoreError('That sentence is not in Echo.', 404);
    return row;
  };

  async function check(input: { requestId?: unknown; itemId?: unknown; given?: unknown }): Promise<WriteResult> {
    const requestId = typeof input?.requestId === 'string' && input.requestId ? input.requestId : '';
    if (!requestId) throw new StoreError('This answer is missing its request ID.');
    const kept = answerById.get(requestId);
    if (kept) return JSON.parse(kept.result_json) as WriteResult;
    const running = checking.get(requestId);
    if (running) return running;
    const item = itemOf(input.itemId);
    const given = typeof input.given === 'string' ? input.given.trim().slice(0, 300) : '';
    if (!given) throw new StoreError('Write the sentence in French first.');
    const asked = (async () => {
      const result = parseCheck(await deps.ask(checkPrompt(item, given), { timeout: 2 * 60_000, purpose: 'checking your sentence' }), given);
      saveAnswer.run(requestId, item.id, given, JSON.stringify(result), now().toISOString());
      return result;
    })();
    checking.set(requestId, asked);
    try { return await asked; } finally { checking.delete(requestId); }
  }

  // On to the next sentence: this one is done, checked or skipped.
  function next(input: { itemId?: unknown }): WriteState {
    finish.run(now().toISOString(), itemOf(input?.itemId).id);
    return state();
  }

  return { state, check, next, settled: () => writing ?? Promise.resolve(), close: () => db.close() };
}
