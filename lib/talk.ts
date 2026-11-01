// Talk: a short spoken conversation with Claude in French on one everyday topic, 3 to 5 exchanges at the learner's
// level: verbs in the tenses on Verbs' Practising line, mostly words they have started. Claude opens; then each turn
// is the learner's recording, as recognition heard it in French, and Claude's answer: at most one minimal correction
// of the learner's line (none when it was right), its French reply and that reply's English. Echo says every French
// line in its voice (lib/voice.ts). Claude may close from the third exchange and must by the fifth, and Echo holds it
// to that whatever it answers. A recording recognition made nothing of never reaches Claude: the learner says it
// again. Conversations and their lines are kept in the database; a turn sent again (the phone lost the answer)
// answers what the first did.
import { Database } from 'bun:sqlite';
import type { TalkLine, TalkTopic, TalkTurn, TalkView } from '../contract';
import type { Ask } from './claude';
import { heardNothing } from './say-check-fr';
import { StoreError } from './store';
import { TENSE_NAMES, type Tense } from './verbs';

export const TOPICS: readonly TalkTopic[] = [
  { id: 'weekend', fr: 'le week-end', en: 'the weekend' },
  { id: 'meals', fr: 'la cuisine et les repas', en: 'cooking and meals' },
  { id: 'shopping', fr: 'les courses', en: 'shopping' },
  { id: 'work', fr: 'le travail', en: 'work' },
  { id: 'holidays', fr: 'les vacances', en: 'holidays' },
  { id: 'weather', fr: 'le temps qu’il fait', en: 'the weather' },
  { id: 'family', fr: 'la famille', en: 'family' },
  { id: 'free-time', fr: 'le temps libre', en: 'free time' },
  { id: 'neighbourhood', fr: 'le quartier', en: 'the neighbourhood' },
  { id: 'mornings', fr: 'le matin', en: 'mornings' },
  { id: 'getting-around', fr: 'les transports', en: 'getting around' },
  { id: 'eating-out', fr: 'au restaurant', en: 'eating out' },
  { id: 'sport', fr: 'le sport', en: 'sport' },
  { id: 'films', fr: 'les films et les séries', en: 'films and series' },
  { id: 'home', fr: 'la maison', en: 'home' },
  { id: 'friends', fr: 'les amis', en: 'friends' },
];
export const MIN_EXCHANGES = 3;
export const MAX_EXCHANGES = 5;
// A new conversation's topic is none of the last few.
const RECENT_TOPICS = 4;
// How many of the learner's words the prompt lists: enough to talk with, few enough to keep Claude quick.
export const KNOWN_SAMPLE = 80;
const MAX_FRENCH = 300;
const ASK_TIMEOUT = 45_000;
// The longest a line waits for its voice (about 2 s warm, 5 with the model loading): past it the line goes out unsaid.
const VOICE_WAIT = 30_000;

export type KnownWord = { fr: string; en: string };
// The conversation as Claude is told it: who said what, in order.
export type TalkContext = { topic: TalkTopic; tenses: readonly Tense[]; level: string; known: readonly KnownWord[]; lines: readonly Pick<TalkLine, 'who' | 'fr'>[] };
// done is false on an opener.
export type TalkReply = { correction: string | null; fr: string; en: string; done: boolean };

// A topic none of the `recent` ones (newest first), or any when every topic was recent.
export function pickTopic(recent: readonly string[], random = Math.random): TalkTopic {
  const last = recent.slice(0, RECENT_TOPICS);
  const fresh = TOPICS.filter((topic) => !last.includes(topic.id));
  const from = fresh.length ? fresh : TOPICS;
  return from[Math.floor(random() * from.length)]!;
}

// Up to `count` of the learner's words, a different few each conversation.
export function sampleKnown<T>(known: readonly T[], count = KNOWN_SAMPLE, random = Math.random): T[] {
  const list = [...known];
  for (let index = 0; index < Math.min(count, list.length); index++) {
    const pick = index + Math.floor(random() * (list.length - index));
    [list[index], list[pick]] = [list[pick]!, list[index]!];
  }
  return list.slice(0, count);
}

// The learner's nth line (n from 1) ends the conversation once Claude closes from MIN_EXCHANGES on, and always at
// MAX_EXCHANGES.
export const endsAt = (exchange: number, closed: boolean) => exchange >= MAX_EXCHANGES || (exchange >= MIN_EXCHANGES && closed);

export function talkPrompt(context: TalkContext): string {
  const { topic, tenses, level, known, lines } = context;
  const exchange = lines.filter((line) => line.who === 'you').length;
  const opening = exchange === 0;
  const said = lines.map((line) => `${line.who === 'echo' ? 'You' : 'Learner'}: ${line.fr}`).join('\n');
  const closing = exchange < MIN_EXCHANGES ? 'false: it is too early to close, so end reply_fr with a simple question'
    : exchange >= MAX_EXCHANGES ? 'true: this is the last exchange, so reply_fr answers them briefly and closes the conversation warmly, with no question'
    : 'true when the topic has run its course, with reply_fr a short warm closing line and no question; otherwise false, ending reply_fr with a simple question';
  return `You are the conversation partner in Echo, an app for one English speaker learning French at about ${level}. You are having a short spoken chat in French about ${topic.fr} (${topic.en}): ${MIN_EXCHANGES} to ${MAX_EXCHANGES} exchanges. A French voice reads aloud everything you write in French; what the learner says reaches you through speech recognition, so it has little punctuation and may spell a word as another that sounds the same.

Keep your French to what this learner practises:
- verbs only in these tenses: ${tenses.map((tense) => TENSE_NAMES[tense]).join(', ')} (and the infinitive);
- mostly words from the learner's vocabulary below, plus little words (articles, pronouns, prepositions), numbers and first names;
- one or two short sentences, 20 words at most, everyday and natural; say tu to the learner; no English in reply_fr;
- react to what they said as a friend would, and start each reply differently: never open two replies with the same word (D'accord, Super, Ah…).

${opening ? `Open the conversation: greet the learner in a few words and ask one simple question about ${topic.fr}.

Reply with JSON only: {"reply_fr": "...", "reply_en": "..."}
- reply_fr: your opening line in French;
- reply_en: its natural English.` : `The conversation so far:
${said}

That was exchange ${exchange} of at most ${MAX_EXCHANGES}. Reply with JSON only: {"correction": null, "reply_fr": "...", "reply_en": "...", "done": false}
- correction: null when the learner's last line is acceptable French for what they meant. Ignore punctuation, capitals, accents and any word recognition may have written differently from what was said. When it has a real mistake (a verb form, a gender, an agreement, word order, a missing word, or English), write their whole line again with only the one fix that matters most, everything else unchanged;
- reply_fr: your answer to what they said, in French, following the rules above;
- reply_en: its natural English;
- done: ${closing}.`}

The learner's vocabulary (French = English):
${known.map((word) => `${word.fr} = ${word.en}`).join('\n')}`;
}

// Lower case, without accents or punctuation: two lines that fold alike differ only in what speech does not carry.
const fold = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/œ/g, 'oe').replace(/[^a-z0-9]+/g, ' ').trim();
// Words only one of the two languages has, among the commonest; a French line has more of the first.
const FRENCH_WORDS = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'est', 'je', 'j', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles', 'que', 'qu', 'qui', 'pas', 'ne', 'c', 'l', 'd', 'au', 'aux', 'dans', 'pour', 'avec', 'sur', 'ce', 'cette', 'ton', 'ta', 'tes', 'mon', 'ma', 'mes', 'ou', 'tres', 'bien', 'oui', 'non', 'quoi', 'comment', 'aimes', 'aime', 'fais', 'vas', 'suis', 'es', 'sont', 'ai', 'as', 'avez', 'bonjour', 'salut', 'merci', 'quel', 'quelle', 'aussi', 'mais', 'beaucoup']);
const ENGLISH_WORDS = new Set(['the', 'and', 'is', 'are', 'you', 'i', 'he', 'she', 'it', 'we', 'they', 'to', 'of', 'for', 'with', 'what', 'do', 'does', 'did', 'how', 'your', 'my', 'this', 'that', 'have', 'has', 'was', 'were', 'be', 'not', 'like', 'hello', 'hi', 'yes', 'no', 'very', 'thanks', 'but', 'also', 'so']);
export function looksFrench(text: string): boolean {
  const words = fold(text).split(' ').filter(Boolean);
  const french = words.filter((word) => FRENCH_WORDS.has(word)).length + (/[àâçéèêëîïôûùüœ]/i.test(text) ? 1 : 0);
  return french > 0 && french > words.filter((word) => ENGLISH_WORDS.has(word)).length;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');

// Claude's answer read and checked, or what is wrong with it. An opener needs only reply_fr and reply_en; a turn also
// correction (a line or null) and done. reply_fr must be French. A correction that folds to what was heard (it
// changed only punctuation, capitals or accents) is no correction.
export function parseReply(reply: string, heard: string | null): TalkReply | string {
  let entry: Record<string, unknown> | null;
  try { entry = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)); } catch { entry = null; }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'the reply could not be read';
  const fr = text(entry.reply_fr), en = text(entry.reply_en);
  if (!fr || !en) return 'a part is missing';
  if (fr.length > MAX_FRENCH || en.length > MAX_FRENCH) return 'too long';
  if (!looksFrench(fr)) return 'reply_fr is not French';
  if (heard === null) return { correction: null, fr, en, done: false };
  if (!('correction' in entry) || !('done' in entry)) return 'a part is missing';
  if (typeof entry.done !== 'boolean') return 'done is not true or false';
  if (entry.correction !== null && typeof entry.correction !== 'string') return 'correction is not a line or null';
  const correction = text(entry.correction);
  if (correction.length > MAX_FRENCH) return 'too long';
  return { correction: correction && fold(correction) !== fold(heard) ? correction : null, fr, en, done: entry.done };
}

export type TalkDeps = {
  dbPath: string;
  ask: Ask;
  // The Claude model Talk asks (sonnet: a turn waits on it).
  model: string;
  // Says a French line in Echo's voice: the name of its clip (audio/talk/<name>.mp3).
  speak: (text: string) => Promise<string>;
  knowledge: () => { known: KnownWord[]; level: string };
  // The tenses on the Practising line a start sends.
  tensesOf: (practising: unknown) => Tense[];
  random?: () => number;
};
// How long each part of a turn took, in ms: hearing (recognition), Claude, the voice, and all of it.
export type TalkTimings = { hear: number; claude: number; voice: number; total: number };

export function createTalk(deps: TalkDeps) {
  const random = deps.random ?? Math.random;
  const db = new Database(deps.dbPath, { create: true, strict: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS talk_conversations (id TEXT PRIMARY KEY, topic TEXT NOT NULL, level TEXT NOT NULL, tenses_json TEXT NOT NULL, known_json TEXT NOT NULL, started_at INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS talk_lines (conversation_id TEXT NOT NULL, seq INTEGER NOT NULL, who TEXT NOT NULL, fr TEXT NOT NULL, en TEXT NOT NULL, correction TEXT, clip TEXT, request_id TEXT UNIQUE, at INTEGER NOT NULL, PRIMARY KEY (conversation_id, seq));`);
  type Conversation = { id: string; topic: string; level: string; tenses_json: string; known_json: string; done: number };
  type Row = { who: 'echo' | 'you'; fr: string; en: string; correction: string | null; clip: string | null };
  const conversationOf = db.query<Conversation, [string]>('SELECT id, topic, level, tenses_json, known_json, done FROM talk_conversations WHERE id = ?');
  const linesOf = db.query<Row, [string]>('SELECT who, fr, en, correction, clip FROM talk_lines WHERE conversation_id = ? ORDER BY seq');
  const recentTopics = db.query<{ topic: string }, [number]>('SELECT topic FROM talk_conversations ORDER BY started_at DESC, rowid DESC LIMIT ?');
  const answered = db.query<{ conversation_id: string }, [string]>('SELECT conversation_id FROM talk_lines WHERE request_id = ?');
  const addConversation = db.query('INSERT INTO talk_conversations (id, topic, level, tenses_json, known_json, started_at) VALUES (?, ?, ?, ?, ?, ?)');
  const addLine = db.query('INSERT INTO talk_lines (conversation_id, seq, who, fr, en, correction, clip, request_id, at) VALUES (?, (SELECT COUNT(*) FROM talk_lines WHERE conversation_id = ?), ?, ?, ?, ?, ?, ?, ?)');
  const finish = db.query('UPDATE talk_conversations SET done = 1 WHERE id = ?');
  // Turns being answered, by request id: a request sent again while its first is still running waits for that one.
  const running = new Map<string, Promise<{ turn: TalkTurn; ms: TalkTimings }>>();

  const topicOf = (id: string) => TOPICS.find((topic) => topic.id === id) ?? { id, fr: id, en: id };
  function view(id: string): TalkView {
    const conversation = conversationOf.get(id)!;
    return {
      id, topic: topicOf(conversation.topic), done: conversation.done === 1,
      lines: linesOf.all(id).map((row) => ({ who: row.who, fr: row.fr, en: row.en, correction: row.correction, audio: row.clip ? `audio/talk/${row.clip}.mp3` : null })),
    };
  }
  // Claude's answer to the prompt, asked a second time when the first cannot be used.
  async function reply(prompt: string, heard: string | null): Promise<TalkReply> {
    let problem = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const parsed = parseReply(await deps.ask(prompt, { timeout: ASK_TIMEOUT, purpose: 'talking with you', model: deps.model }), heard);
      if (typeof parsed !== 'string') return parsed;
      problem = parsed;
      console.error(`talk: Claude's reply was not usable (${problem})`);
    }
    throw new StoreError(`Claude’s answer could not be used (${problem}). Try again.`, 503);
  }
  // A line's clip, or null when the voice failed or took longer than VOICE_WAIT: the line is shown and the
  // conversation goes on.
  async function voiced(fr: string): Promise<string | null> {
    const late = Promise.withResolvers<never>();
    const timer = setTimeout(() => late.reject(new Error(`no clip within ${VOICE_WAIT / 1000} s`)), VOICE_WAIT);
    try { return await Promise.race([deps.speak(fr), late.promise]); }
    catch (error) { console.error(`talk: the voice could not say ${JSON.stringify(fr)}: ${(error as Error).message}`); return null; }
    finally { clearTimeout(timer); }
  }

  // A new conversation on `topic` (Again) or on a topic none of the last few, with Echo's opener said.
  async function start(input: { practising?: unknown; topic?: unknown }): Promise<{ view: TalkView; ms: Omit<TalkTimings, 'hear'> }> {
    const began = performance.now();
    const again = TOPICS.find((topic) => topic.id === input.topic);
    const topic = again ?? pickTopic(recentTopics.all(RECENT_TOPICS).map((row) => row.topic), random);
    const tenses = deps.tensesOf(input.practising);
    const { known, level } = deps.knowledge();
    const words = sampleKnown(known, KNOWN_SAMPLE, random);
    const context: TalkContext = { topic, tenses: tenses.length ? tenses : ['pres'], level, known: words, lines: [] };
    const opener = await reply(talkPrompt(context), null);
    const asked = performance.now();
    const clip = await voiced(opener.fr);
    const id = crypto.randomUUID(), at = Date.now();
    db.transaction(() => {
      addConversation.run(id, topic.id, level, JSON.stringify(context.tenses), JSON.stringify(words), at);
      addLine.run(id, id, 'echo', opener.fr, opener.en, null, clip, null, at);
    })();
    const end = performance.now();
    return { view: view(id), ms: { claude: Math.round(asked - began), voice: Math.round(end - asked), total: Math.round(end - began) } };
  }

  // The learner's line: `hear` gives what recognition made of their recording (null: too quiet to be speech), told
  // Echo's last line, which the learner is answering, so it expects the topic's words.
  async function turn(input: { conversation: string; request: string }, hear: (prompt: string) => Promise<string | null>): Promise<{ turn: TalkTurn; ms: TalkTimings }> {
    if (!/^[A-Za-z0-9-]{8,64}$/.test(input.request)) throw new StoreError('This line has no request id.');
    const conversation = conversationOf.get(input.conversation);
    if (!conversation) throw new StoreError('This conversation is not on this Mac. Start a new one.', 404);
    const zero = { hear: 0, claude: 0, voice: 0, total: 0 };
    const prior = answered.get(input.request);
    if (prior) return { turn: { unclear: false, conversation: view(prior.conversation_id) }, ms: zero };
    if (conversation.done) throw new StoreError('This conversation is over. Start another.', 409);
    const already = running.get(input.request);
    if (already) return already;
    const work = (async () => {
      const began = performance.now();
      const lines = view(conversation.id).lines;
      const heard = (await hear(lines.at(-1)?.fr ?? ''))?.trim() ?? null;
      const listened = performance.now();
      if (heard === null || heardNothing(heard)) return { turn: { unclear: true as const, heard: heard ?? '' }, ms: { ...zero, hear: Math.round(listened - began), total: Math.round(listened - began) } };
      const exchange = lines.filter((line) => line.who === 'you').length + 1;
      const context: TalkContext = { topic: topicOf(conversation.topic), level: conversation.level, tenses: JSON.parse(conversation.tenses_json), known: JSON.parse(conversation.known_json), lines: [...lines, { who: 'you', fr: heard }] };
      const answer = await reply(talkPrompt(context), heard);
      const asked = performance.now();
      const clip = await voiced(answer.fr);
      const end = performance.now(), at = Date.now();
      db.transaction(() => {
        addLine.run(conversation.id, conversation.id, 'you', heard, '', answer.correction, null, input.request, at);
        addLine.run(conversation.id, conversation.id, 'echo', answer.fr, answer.en, null, clip, null, at);
        if (endsAt(exchange, answer.done)) finish.run(conversation.id);
      })();
      return { turn: { unclear: false as const, conversation: view(conversation.id) }, ms: { hear: Math.round(listened - began), claude: Math.round(asked - listened), voice: Math.round(end - asked), total: Math.round(end - began) } };
    })();
    running.set(input.request, work);
    try { return await work; } finally { running.delete(input.request); }
  }

  return { start, turn, view, close: () => db.close() };
}
