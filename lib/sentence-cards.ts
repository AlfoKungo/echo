// Sentence cards (French): hear or read one sentence, think what it means, turn the card for its English, then say
// Got it or Not yet. The marks only decide when a sentence comes back; they score nothing anywhere else.
//
// The sentences are the Listen and Read bank's (recorded in audio/comprehension) and the ones Echo writes for this
// room (<data>/sentence-cards, recorded in audio/sentences; lib/text-topup.ts). A sentence is offered only when every
// tense lib/tenses.ts finds in it is on Verbs' Practising line, none of its grammar topics is switched off here, at
// most one of its deck words is one the learner has not met, and, when the card plays it, its recording exists.
//
// Scheduling (schedule()): Not yet makes a sentence due at the start of the next study day (04:00), and the phone
// shows it once more a few cards later (SC_AGAIN_AFTER in static/app.js). Got it moves it up one step of GOT_IT_DAYS
// from today's start: 3, 8, 20, 45, then every 90 days. The phone marks its once-more pass with again, which leaves
// the next-day return as it is.
import { Database } from 'bun:sqlite';
import type { CardSentence, Gloss } from '../comprehension-contract';
import type { GrammarLevel, ListeningWord } from '../contract';
import { lineOf, rememberedLine, type PractisingLine } from './practising';
import { StoreError, studyDayStart } from './store';
import type { TenseTag } from './tenses';
import { TENSES, type Tense } from './verbs';
import { planSentences } from './walkman';

export const GOT_IT_DAYS = [3, 8, 20, 45, 90];
// How many cards a round brings; the phone asks for more while a few are still waiting.
const ROUND = 6;
const EXCLUDE_LIMIT = 80;
// A recording found stays found; a missing one is looked for again after this long, so new clips join without a restart.
const MISSING_TTL = 10_000;
export type CardMode = 'hear' | 'read' | 'both';
export const CARD_MODES: readonly CardMode[] = ['hear', 'read', 'both'];

// A sentence the room can offer: its text and tags, and the recording it plays (a URL path, or null when it has none).
export type PoolSentence = Omit<CardSentence, 'tenses'> & { tenses: TenseTag[]; audio: string; clip: string };
export type CardView = { id: string; level: GrammarLevel; fr: string; en: string; gloss: Gloss[]; audio: string | null; due: boolean };
export type CardState = { step: number; dueAt: number };
export type Eligibility = { tenses: readonly Tense[]; topicsOff: ReadonlySet<string>; met: ReadonlySet<string>; hear: boolean; recorded: (clip: string) => boolean };
// Why nothing is offered, in the order the filters run; null when something is.
export type EmptyReason = 'tenses' | 'topics' | 'words' | 'recordings' | 'later' | null;

const dayAt = (now: Date, days: number) => { const day = studyDayStart(now); day.setDate(day.getDate() + days); day.setHours(4, 0, 0, 0); return day.getTime(); };

// The next state after a mark. The once-more pass (again) changes nothing: the sentence already returns tomorrow.
export function schedule(state: CardState | null, knew: boolean, again: boolean, now: Date): CardState | null {
  if (again) return state;
  if (!knew) return { step: 0, dueAt: dayAt(now, 1) };
  const step = Math.min((state?.step ?? 0) + 1, GOT_IT_DAYS.length);
  return { step, dueAt: dayAt(now, GOT_IT_DAYS[step - 1]!) };
}

// The sentences the learner can be offered now, and when there are none, which filter emptied the pool.
export function eligible<T extends Pick<PoolSentence, 'tenses' | 'topics' | 'words' | 'clip'>>(pool: T[], rules: Eligibility): { items: T[]; reason: EmptyReason } {
  const inTenses = pool.filter((sentence) => sentence.tenses.every((tense) => tense !== 'other' && rules.tenses.includes(tense)));
  const inTopics = inTenses.filter((sentence) => !sentence.topics.some((topic) => rules.topicsOff.has(topic)));
  const inWords = inTopics.filter((sentence) => sentence.words.filter((id) => !rules.met.has(id)).length <= 1);
  const items = rules.hear ? inWords.filter((sentence) => rules.recorded(sentence.clip)) : inWords;
  const reason = items.length ? null : !inTenses.length ? 'tenses' : !inTopics.length ? 'topics' : !inWords.length ? 'words' : 'recordings';
  return { items, reason };
}

// Which tenses a request asked for: the Practising line it sent, else the one last sent.
const tensesOf = (line: PractisingLine) => TENSES.filter((tense) => line.tenses.includes(tense));

export function createSentenceCards(deps: {
  dbPath: string;
  pool: () => PoolSentence[];
  vocabulary: () => ListeningWord[];
  recorded: (clip: string) => boolean;
  // The grammar topics, for the room's options: id and title, in the course's order.
  topics: () => { id: string; title: string }[];
  now?: () => Date; random?: () => number;
}) {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const clips = new Map<string, { at: number; exists: boolean }>();
  const recorded = (clip: string) => {
    const at = Date.now();
    const cached = clips.get(clip);
    if (cached && (cached.exists || at - cached.at < MISSING_TTL)) return cached.exists;
    const exists = deps.recorded(clip);
    clips.set(clip, { at, exists });
    return exists;
  };
  const db = new Database(deps.dbPath, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
    -- Where each sentence marked stands: its step on GOT_IT_DAYS (0 after Not yet) and when it is due again.
    CREATE TABLE IF NOT EXISTS sentence_cards (
      sentence_id TEXT PRIMARY KEY, step INTEGER NOT NULL, due_at TEXT NOT NULL, marked_at TEXT NOT NULL
    );
    -- Every mark, kept once per request id, so a mark sent again after a lost reply never counts twice.
    CREATE TABLE IF NOT EXISTS sentence_card_marks (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, sentence_id TEXT NOT NULL,
      knew INTEGER NOT NULL, again INTEGER NOT NULL, marked_at TEXT NOT NULL
    );
    -- The grammar topics switched off in the room's options; every other topic is on.
    CREATE TABLE IF NOT EXISTS sentence_card_topics_off (topic TEXT PRIMARY KEY);
  `);
  // The Practising line the room was last sent, so the top-up writes for it (lib/text-topup.ts).
  const line = rememberedLine(db, 'sentence_card_line');
  const states = db.query<{ sentence_id: string; step: number; due_at: string }, []>('SELECT sentence_id, step, due_at FROM sentence_cards');
  const stateOf = db.query<{ step: number; due_at: string }, [string]>('SELECT step, due_at FROM sentence_cards WHERE sentence_id = ?');
  const saveState = db.query('INSERT OR REPLACE INTO sentence_cards (sentence_id, step, due_at, marked_at) VALUES (?, ?, ?, ?)');
  const insertMark = db.query('INSERT OR IGNORE INTO sentence_card_marks (request_id, sentence_id, knew, again, marked_at) VALUES (?, ?, ?, ?, ?)');
  const topicsOff = () => new Set(db.query<{ topic: string }, []>('SELECT topic FROM sentence_card_topics_off').all().map((row) => row.topic));

  const view = (sentence: PoolSentence, due: boolean, hear: boolean): CardView => ({
    id: sentence.id, level: sentence.level, fr: sentence.fr, en: sentence.en, gloss: sentence.gloss,
    audio: hear || recorded(sentence.clip) ? sentence.audio : null, due,
  });
  const modeOf = (value: unknown): CardMode => CARD_MODES.includes(value as CardMode) ? value as CardMode : 'both';

  function rules(tenses: readonly Tense[], hear: boolean): Eligibility {
    const met = new Set(deps.vocabulary().filter((word) => word.status !== 'new').map((word) => word.id));
    return { tenses, topicsOff: topicsOff(), met, hear, recorded };
  }

  // The next cards: those due first (longest waiting first), then sentences never marked, the ones holding the words
  // most worth hearing (due, being learnt, low scores) likelier first. exclude: the cards the phone already holds or
  // has just shown.
  function round(input: { practising?: unknown; mode?: unknown; exclude?: unknown }) {
    const sent = lineOf(input?.practising);
    if (sent && tensesOf(sent).length) line.set(sent);
    const tenses = tensesOf(sent && tensesOf(sent).length ? sent : line.get());
    const hear = modeOf(input?.mode) !== 'read';
    const exclude = new Set(Array.isArray(input?.exclude) ? input.exclude.filter((id): id is string => typeof id === 'string').slice(0, EXCLUDE_LIMIT) : []);
    const { items, reason } = eligible(deps.pool(), rules(tenses, hear));
    const marked = new Map(states.all().map((row) => [row.sentence_id, Date.parse(row.due_at)]));
    const at = now().getTime();
    const open = items.filter((sentence) => !exclude.has(sentence.id));
    const due = open.filter((sentence) => (marked.get(sentence.id) ?? Infinity) <= at).sort((a, b) => marked.get(a.id)! - marked.get(b.id)!);
    const fresh = planSentences(open.filter((sentence) => !marked.has(sentence.id)), deps.vocabulary(), 'B1', random);
    const cards = [...due.map((sentence) => view(sentence, true, hear)), ...fresh.map((sentence) => view(sentence, false, hear))].slice(0, ROUND);
    const waiting = items.map((sentence) => marked.get(sentence.id)).filter((when): when is number => when !== undefined && when > at);
    const next = waiting.length ? new Date(Math.min(...waiting)).toISOString() : null;
    return { items: cards, empty: cards.length || exclude.size ? null : reason ?? 'later', next, tenses };
  }

  // A Got it or Not yet, once per request id; marks are applied in the order they arrive (the phone sends them one at
  // a time). Any sentence in the pool counts, offered now or not.
  function mark(input: { requestId?: unknown; id?: unknown; knew?: unknown; again?: unknown }) {
    if (typeof input?.requestId !== 'string' || !input.requestId) throw new StoreError('This mark is missing its request ID.');
    if (typeof input.knew !== 'boolean') throw new StoreError('Say whether you got it.');
    if (typeof input.id !== 'string' || !deps.pool().some((sentence) => sentence.id === input.id)) throw new StoreError('That sentence is not in Echo.', 404);
    const id = input.id, knew = input.knew, again = input.again === true;
    const when = now();
    db.transaction(() => {
      if (!insertMark.run(input.requestId as string, id, knew ? 1 : 0, again ? 1 : 0, when.toISOString()).changes) return;
      const row = stateOf.get(id);
      const next = schedule(row ? { step: row.step, dueAt: Date.parse(row.due_at) } : null, knew, again, when);
      if (next) saveState.run(id, next.step, new Date(next.dueAt).toISOString(), when.toISOString());
    })();
    return { ok: true };
  }

  // The room's options: every grammar topic its sentences use, each on unless switched off, and how many sentences each
  // tense on the line leaves.
  function options() {
    const used = new Set(deps.pool().flatMap((sentence) => sentence.topics));
    const off = topicsOff();
    return { topics: deps.topics().filter((topic) => used.has(topic.id)).map((topic) => ({ ...topic, on: !off.has(topic.id) })) };
  }
  // topic '*': every topic the options list, switched together.
  function setTopic(input: { topic?: unknown; on?: unknown }) {
    const all = input?.topic === '*';
    if (!all && (typeof input?.topic !== 'string' || !deps.topics().some((topic) => topic.id === input.topic))) throw new StoreError('Choose a grammar topic.');
    if (typeof input.on !== 'boolean') throw new StoreError('Say whether the topic is on.');
    const ids = all ? options().topics.map((topic) => topic.id) : [input.topic as string];
    const set = db.query(input.on ? 'DELETE FROM sentence_card_topics_off WHERE topic = ?' : 'INSERT OR IGNORE INTO sentence_card_topics_off (topic) VALUES (?)');
    db.transaction(() => { for (const id of ids) set.run(id); })();
    return options();
  }

  // How many sentences the top-up's target leaves unseen and offerable, read aloud (Hear needs a recording, so a
  // sentence still being recorded does not count): it writes more once these run low.
  function stock(): { unseen: number; tenses: Tense[] } {
    const tenses = tensesOf(line.get());
    const marked = new Set(states.all().map((row) => row.sentence_id));
    return { unseen: eligible(deps.pool(), rules(tenses, false)).items.filter((sentence) => !marked.has(sentence.id)).length, tenses };
  }

  return { round, mark, options, setTopic, stock, line: () => line.get(), close: () => db.close() };
}
export type SentenceCards = ReturnType<typeof createSentenceCards>;
