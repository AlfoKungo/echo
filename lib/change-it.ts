// Change it: a spoken transformation drill on the Verbs tape. Each drill is a French sentence, a cue (a time phrase
// that asks for another tense, or another subject) and the sentence changed as the cue asks, with its English and the
// verb form that changed. Echo picks what each drill trains (a verb, a tense and a person, in a fixed mix of the four
// tenses, leaning on the learner's started verbs and shaky forms); Claude (Opus) writes the sentences ahead, a batch
// at a time; every verb form in them is checked against conjugate() before a drill is kept. A drill joins the tape
// once its three clips (sentence, cue, answer) are recorded.
import { Database } from 'bun:sqlite';
import type { Ask } from './claude';
import { conjugate, normal, persons, PERSON_LABELS, TENSE_NAMES, type Tense, type Verb } from './verbs';
import { FRAME_BYTES, FRAME_SECONDS, TAPE_SECONDS, type Tape } from './walkman';
import type { WalkmanWord } from '../contract';

export type ChangeKind = 'time' | 'person';
// What one drill trains: the answer's verb, tense and person, and the base sentence's tense and person.
export type ChangeSlot = { verbId: string; kind: ChangeKind; tense: Tense; person: number; baseTense: Tense; basePerson: number; cue?: string };
export type ChangeDrill = { id: number; base: string; cue: string; answer: string; en: string; form: string; verbId: string; tense: Tense; person: number; kind: ChangeKind; heard: number };
export type ShakyForm = { verbId: string; tense: Tense; person: number; score: number };

// The answers' tenses, whatever the Verbs tense setting: passé composé most, then présent, imparfait, futur.
export const TENSE_MIX: [Tense, number][] = [['pc', 0.35], ['pres', 0.30], ['imp', 0.20], ['fut', 0.15]];
// The time phrases that ask for each tense; a time cue is always one of these.
export const TIME_CUES: Record<Tense, string[]> = {
  pc: ['Hier', 'Hier soir', 'La semaine dernière', 'Samedi dernier'],
  pres: ['Maintenant', 'D’habitude', 'Aujourd’hui', 'Tous les jours'],
  imp: ['Quand j’étais petit', 'Avant', 'Autrefois', 'Quand j’étais jeune'],
  fut: ['Demain', 'Demain matin', 'La semaine prochaine', 'L’année prochaine'],
};
const PERSON_CUES = [['je'], ['tu'], ['il', 'elle'], ['nous'], ['vous'], ['ils', 'elles']];
// The share of drills a person change takes, by answer tense; the rest are time cues.
const PERSON_SHARE: Record<Tense, number> = { pres: 0.6, pc: 0.4, imp: 0, fut: 0 };
// The share of drills drawn for a shaky form of the slot's tense, when there is one.
const SHAKY_SHARE = 0.5;
const BATCH = 8;
// A batch is asked for when fewer drills than this wait unheard (recorded or still being recorded).
const REFILL_AT = 4;
// Drills recorded per check, and the checks a drill's clips may fail before it is dropped.
const RECORD_PER_CHECK = 8;
const TRIES = 5;

// How many of a batch go to each tense: the mix's shares, rounded by largest remainder so a batch always adds up.
export function mixCounts(count: number): Record<Tense, number> {
  const rows = TENSE_MIX.map(([tense, share]) => ({ tense, exact: share * count, n: Math.floor(share * count) }));
  let left = count - rows.reduce((sum, row) => sum + row.n, 0);
  for (const row of [...rows].sort((a, b) => (b.exact - b.n) - (a.exact - a.n))) { if (left-- <= 0) break; row.n++; }
  return Object.fromEntries(rows.map((row) => [row.tense, row.n])) as Record<Tense, number>;
}

// A batch of slots: tenses by the mix, each verb once where the pool allows, a shaky form of the slot's tense about
// half the time there is one, and verbs not in recent drills before those that were.
export function planSlots(count: number, pool: Verb[], shaky: ShakyForm[], recent: Set<string>, random: () => number = Math.random): ChangeSlot[] {
  if (!pool.length) return [];
  const counts = mixCounts(count);
  const tenses = TENSE_MIX.flatMap(([tense]) => Array<Tense>(counts[tense]).fill(tense));
  for (let index = tenses.length - 1; index > 0; index--) { const other = Math.floor(random() * (index + 1)); [tenses[index], tenses[other]] = [tenses[other]!, tenses[index]!]; }
  const byId = new Map(pool.map((verb) => [verb.id, verb]));
  const used = new Set<string>();
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!;
  return tenses.flatMap((tense): ChangeSlot[] => {
    const kind: ChangeKind = random() < PERSON_SHARE[tense] ? 'person' : 'time';
    const fits = (verb: Verb) => kind === 'time' || !verb.impersonal;
    const weak = shaky.filter((form) => form.tense === tense && !used.has(form.verbId) && byId.has(form.verbId) && fits(byId.get(form.verbId)!));
    let verb: Verb, person: number;
    if (weak.length && random() < SHAKY_SHARE) {
      const form = [...weak].sort((a, b) => a.score - b.score)[0]!;
      verb = byId.get(form.verbId)!; person = form.person;
    } else {
      const open = pool.filter((entry) => fits(entry) && !used.has(entry.id));
      const fresh = open.filter((entry) => !recent.has(entry.id));
      const list = fresh.length ? fresh : open.length ? open : pool.filter(fits);
      if (!list.length) return [];
      verb = pick(list); person = pick(persons(verb));
    }
    used.add(verb.id);
    if (kind === 'time') return [{ verbId: verb.id, kind, tense, person, baseTense: tense === 'pres' ? 'pc' : 'pres', basePerson: person }];
    const basePerson = pick(persons(verb).filter((other) => other !== person));
    return [{ verbId: verb.id, kind, tense, person, baseTense: tense, basePerson, cue: pick(PERSON_CUES[person]!) }];
  });
}

export function drillsPrompt(slots: ChangeSlot[], verbs: Map<string, Verb>, known: { fr: string; en: string }[]): string {
  const lines = slots.map((slot, index) => {
    const verb = verbs.get(slot.verbId)!;
    const cue = slot.kind === 'person' ? `cue "${slot.cue}" (the new subject)` : `cue: one of ${TIME_CUES[slot.tense].map((cue) => `"${cue}"`).join(', ')}`;
    return `${index + 1}. ${verb.inf} (${verb.en}) — base: ${TENSE_NAMES[slot.baseTense]}, ${PERSON_LABELS[slot.basePerson]}; answer: ${TENSE_NAMES[slot.tense]}, ${PERSON_LABELS[slot.person]}; ${cue}`;
  }).join('\n');
  return `You write spoken drills for Echo, an app for one English speaker learning French (A2, aiming B1). The learner hears a short French sentence, then a cue, and says the sentence changed as the cue asks: a time phrase puts it in another tense, a subject pronoun gives it another subject. Then they hear the answer.

Write one drill for each line below, with exactly the verb, tenses and persons given.
- base: 3 to 9 words of everyday French, the verb in the base tense and person, with a subject (a pronoun, or a name or noun for il / elle and ils / elles). No time phrase in it.
- answer: for a time cue, the cue, a comma, then the base sentence with only the verb changed to the answer tense (and what grammar then needs, nothing else); for a subject cue, the base sentence with the cue as its subject and the verb, and anything that agrees with the subject (possessives, reflexive pronouns, participles), changed.
- Keep the verb in one piece: no negation in the passé composé, and no object pronoun (le, la, lui, y, en…) before the verb. A reflexive verb keeps its own pronoun (je me lève, nous nous levons).
- form and baseForm: the verb's words exactly as they are written in the answer and in the base, without the subject: "mange", "ai mangé", "me lève", "est allée".
- en: natural English for the answer.
- Use words from the learner's vocabulary below (any form), plus little words (articles, pronouns, prepositions, common determiners) and first names.

Reply with JSON only: {"drills": [{"line": 1, "base": "...", "baseForm": "...", "cue": "...", "answer": "...", "form": "...", "en": "..."}]}

${lines}

The learner's vocabulary (French = English):
${known.map((word) => `${word.fr} = ${word.en}`).join('\n')}`;
}

const SUBJECT_WORDS = new Set(['je', 'j’', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles']);
const SUBJECT_OK: ((subject: string) => boolean)[] = [
  (subject) => subject === 'je' || subject === 'j’',
  (subject) => subject === 'tu',
  (subject) => ['il', 'elle', 'on'].includes(subject) || !SUBJECT_WORDS.has(subject),
  (subject) => subject === 'nous',
  (subject) => subject === 'vous',
  (subject) => ['ils', 'elles'].includes(subject) || !SUBJECT_WORDS.has(subject),
];
const BEFORE = new Set([' ', '’', ',']);
const AFTER = new Set([' ', ',', '.', '!', '?', ';', ':', '…', '»']);
// The subject of the verb form found at `at` in a normalised sentence: the word before it, past a ne / n’.
function subjectBefore(text: string, at: number): string | null {
  const tokens = text.slice(0, at).match(/[^\s,’]+’|[^\s,’]+/g) ?? [];
  while (tokens.length && (tokens.at(-1) === 'ne' || tokens.at(-1) === 'n’')) tokens.pop();
  return tokens.at(-1) ?? null;
}
// Whether `sentence` holds `form`, written as conjugate() has it for this verb, tense and person, after a subject of
// that person. Returns the subject, or null when the form is wrong or not there.
export function formIn(sentence: string, form: string, verb: Verb, tense: Tense, person: number): string | null {
  const wanted = conjugate(verb, tense)[person];
  const said = normal(form);
  if (!wanted || !said || !wanted.accepted.map(normal).includes(said)) return null;
  const text = normal(sentence);
  for (let at = text.indexOf(said); at >= 0; at = text.indexOf(said, at + 1)) {
    const before = text[at - 1], after = text[at + said.length];
    if ((before !== undefined && !BEFORE.has(before)) || (after !== undefined && !AFTER.has(after))) continue;
    const subject = subjectBefore(text, at);
    if (subject && (verb.impersonal ? SUBJECT_OK[2]! : SUBJECT_OK[person]!)(subject)) return subject;
  }
  return null;
}

const json = (reply: string): unknown => { try { return JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)); } catch { return null; } };
const text = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/'/g, '’') : '');
type Written = Omit<ChangeDrill, 'id' | 'heard'>;
// One drill as Claude wrote it, kept only when both verb forms are right for their slot, the cue is the one asked
// for, and the answer differs from the base; null otherwise.
export function checkDrill(slot: ChangeSlot, verb: Verb, entry: unknown): Written | null {
  const raw = (entry ?? {}) as Record<string, unknown>;
  const base = text(raw.base), answer = text(raw.answer), en = text(raw.en), form = text(raw.form), baseForm = text(raw.baseForm);
  let cue = text(raw.cue);
  if (!base || !answer || !en || !form || !cue || [base, answer, en].some((value) => value.length > 160)) return null;
  if (normal(base) === normal(answer)) return null;
  if (!formIn(base, baseForm, verb, slot.baseTense, slot.basePerson)) return null;
  const subject = formIn(answer, form, verb, slot.tense, slot.person);
  if (!subject) return null;
  if (slot.kind === 'time') {
    const canonical = TIME_CUES[slot.tense].find((option) => normal(option) === normal(cue));
    if (!canonical || !normal(answer).startsWith(normal(canonical))) return null;
    cue = canonical;
  } else {
    if (normal(cue) !== slot.cue) return null;
    if (subject !== slot.cue && !(slot.cue === 'je' && subject === 'j’')) return null;
    cue = slot.cue;
  }
  return { base, cue, answer, en, form, verbId: verb.id, tense: slot.tense, person: slot.person, kind: slot.kind };
}

export function parseDrills(reply: string, slots: ChangeSlot[], verbs: Map<string, Verb>): Written[] {
  const parsed = json(reply) as { drills?: unknown } | null;
  if (!Array.isArray(parsed?.drills)) return [];
  return parsed.drills.flatMap((entry) => {
    const line = Number((entry as Record<string, unknown>)?.line);
    const slot = Number.isInteger(line) ? slots[line - 1] : undefined;
    const verb = slot && verbs.get(slot.verbId);
    const drill = slot && verb ? checkDrill(slot, verb, entry) : null;
    return drill ? [drill] : [];
  });
}

// Per drill on the tape: the sentence, a breath, the cue, a pause to say the answer (as long as the answer takes to say,
// and a second more, held between 3 and 5 seconds), the answer, then a gap before the next.
const LEAD = 0.6;
const CUE_GAP = 0.5;
const BETWEEN = 1.6;
export const sayPause = (answer: Uint8Array) => Math.min(5, Math.max(3, answer.length / FRAME_BYTES * FRAME_SECONDS + 1));
export type ChangeTapeItem = { drill: ChangeDrill; base: Uint8Array; cue: Uint8Array; answer: Uint8Array; audio: string };
// The tape's word times mark the four phases: start the sentence, recallAt the cue, meaningAt the pause to say it,
// againAt the answer, end the answer's end.
export function layChangeTape(id: string, items: Iterable<ChangeTapeItem>, silence: Uint8Array, seconds = TAPE_SECONDS): Tape {
  const parts: Uint8Array[] = [];
  let frames = 0;
  const add = (bytes: Uint8Array) => { parts.push(bytes); frames += bytes.length / FRAME_BYTES; };
  const pause = (length: number) => {
    const count = Math.round(length / FRAME_SECONDS);
    const block = new Uint8Array(count * FRAME_BYTES);
    for (let frame = 0; frame < count; frame++) block.set(silence.subarray(0, FRAME_BYTES), frame * FRAME_BYTES);
    add(block);
  };
  const now = () => Math.round(frames * FRAME_SECONDS * 1000) / 1000;
  const words: WalkmanWord[] = [];
  pause(LEAD);
  for (const { drill, base, cue, answer, audio } of items) {
    const start = now();
    add(base); pause(CUE_GAP);
    const recallAt = now();
    add(cue);
    const meaningAt = now();
    pause(sayPause(answer));
    const againAt = now();
    add(answer);
    const end = now();
    pause(BETWEEN);
    words.push({
      id: `change-${drill.id}`, fr: drill.answer, en: drill.en, fresh: false,
      verb: { verbId: drill.verbId, tense: drill.tense, person: drill.person, audio },
      change: { id: drill.id, base: drill.base, cue: drill.cue, form: drill.form },
      start, recallAt, meaningAt, againAt, end,
    });
    if (now() >= seconds) break;
  }
  const bytes = new Uint8Array(frames * FRAME_BYTES);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return { id, kind: 'change', bytes, words, seconds: now() };
}

export function createChangeIt(deps: {
  dbPath: string; ask: Ask;
  verbs: () => Verb[];
  // The verbs the learner has started (vocabulary words past new), and every started word for Claude to write with.
  started: () => Set<string>;
  known: () => { fr: string; en: string }[];
  shaky: () => ShakyForm[];
  clipReady: (text: string) => boolean;
  // Records French texts; false when recording is switched off, so nothing was tried.
  record: (texts: string[]) => Promise<boolean>;
  now?: () => Date; random?: () => number;
}) {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const db = new Database(deps.dbPath, { create: true, strict: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    -- A Change it drill. heard counts the times it played to the end; tries the checks its clips failed to record;
    -- a dropped drill (its clips never made) is never played.
    CREATE TABLE IF NOT EXISTS change_drills (
      id INTEGER PRIMARY KEY, base TEXT NOT NULL, cue TEXT NOT NULL, answer TEXT NOT NULL UNIQUE, en TEXT NOT NULL,
      form TEXT NOT NULL, verb_id TEXT NOT NULL, tense TEXT NOT NULL, person INTEGER NOT NULL, kind TEXT NOT NULL,
      created_at TEXT NOT NULL, heard INTEGER NOT NULL DEFAULT 0, heard_at TEXT, tries INTEGER NOT NULL DEFAULT 0, dropped_at TEXT
    );
    CREATE TABLE IF NOT EXISTS change_heard (request_id TEXT PRIMARY KEY, drill_id INTEGER NOT NULL, heard_at TEXT NOT NULL);`);
  type Row = { id: number; base: string; cue: string; answer: string; en: string; form: string; verb_id: string; tense: Tense; person: number; kind: ChangeKind; heard: number; heard_at: string | null; tries: number };
  const live = db.query<Row, []>('SELECT id, base, cue, answer, en, form, verb_id, tense, person, kind, heard, heard_at, tries FROM change_drills WHERE dropped_at IS NULL ORDER BY id');
  const recentVerbs = db.query<{ verb_id: string }, []>('SELECT verb_id FROM change_drills ORDER BY id DESC LIMIT 24');
  const add = db.query('INSERT OR IGNORE INTO change_drills (base, cue, answer, en, form, verb_id, tense, person, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const failed = db.query('UPDATE change_drills SET tries = tries + 1, dropped_at = CASE WHEN tries + 1 >= ? THEN ? END WHERE id = ?');
  const noteHeard = db.query('INSERT OR IGNORE INTO change_heard (request_id, drill_id, heard_at) VALUES (?, ?, ?)');
  const countHeard = db.query('UPDATE change_drills SET heard = heard + 1, heard_at = ? WHERE id = ?');

  let writing: Promise<void> | null = null;
  let checking: Promise<void> | null = null;
  let error: string | null = null;
  const recorded = (row: Row) => [row.base, row.cue, row.answer].every(deps.clipReady);

  // A batch from Claude when few drills wait unheard; one batch at a time, and a failure is shown until the next try.
  function refill(): Promise<void> {
    if (writing || live.all().filter((row) => !row.heard).length >= REFILL_AT) return writing ?? Promise.resolve();
    writing = (async () => {
      try {
        const verbs = deps.verbs();
        const started = deps.started();
        const mine = verbs.filter((verb) => started.has(verb.id));
        const pool = mine.length >= 4 ? mine : verbs.slice(0, 20);
        const byId = new Map(verbs.map((verb) => [verb.id, verb]));
        const known = deps.known();
        if (!pool.length || !known.length) throw new Error('Change it needs a few words and verbs started first.');
        const slots = planSlots(BATCH, pool, deps.shaky().filter((form) => pool.some((verb) => verb.id === form.verbId)), new Set(recentVerbs.all().map((row) => row.verb_id)), random);
        const reply = await deps.ask(drillsPrompt(slots, byId, known), { timeout: 5 * 60_000, purpose: 'writing Change it sentences' });
        const drills = parseDrills(reply, slots, byId);
        console.log(`change it: ${drills.length} of ${slots.length} drills kept`);
        if (!drills.length) throw new Error('Claude’s Change it sentences could not be used. Echo will ask again.');
        const at = now().toISOString();
        for (const drill of drills) add.run(drill.base, drill.cue, drill.answer, drill.en, drill.form, drill.verbId, drill.tense, drill.person, drill.kind, at);
        error = null;
      } catch (failure) {
        error = failure instanceof Error ? failure.message : 'The Change it sentences could not be written.';
        console.error(`change it: ${error}`);
      } finally { writing = null; }
    })();
    return writing;
  }

  // Records the drills still missing a clip, oldest first, one drill at a time so each finished one can play.
  async function recordPending(): Promise<void> {
    for (const row of live.all().filter((entry) => !recorded(entry)).slice(0, RECORD_PER_CHECK)) {
      const missing = [...new Set([row.base, row.cue, row.answer])].filter((clip) => !deps.clipReady(clip));
      if (!await deps.record(missing)) return;
      if (!recorded(row)) failed.run(TRIES, now().toISOString(), row.id);
    }
  }

  function check(): Promise<void> {
    checking ??= (async () => { await refill(); await recordPending(); })().finally(() => { checking = null; });
    return checking;
  }

  // The recorded drills in the order a tape plays them: unheard first, then by how shaky the changed form is, then
  // the longest unheard. A drill whose form no longer matches its verb's table (a corrected table) is left out.
  function playlist(): ChangeDrill[] {
    const verbs = new Map(deps.verbs().map((verb) => [verb.id, verb]));
    const scores = new Map(deps.shaky().map((form) => [`${form.verbId}|${form.tense}|${form.person}`, form.score]));
    const score = (row: Row) => scores.get(`${row.verb_id}|${row.tense}|${row.person}`) ?? 0;
    return live.all()
      .filter((row) => { const verb = verbs.get(row.verb_id); return verb && recorded(row) && formIn(row.answer, row.form, verb, row.tense, row.person); })
      .sort((a, b) => (a.heard ? 1 : 0) - (b.heard ? 1 : 0) || score(a) - score(b) || (a.heard_at ?? '').localeCompare(b.heard_at ?? '') || a.id - b.id)
      .map((row) => ({ id: row.id, base: row.base, cue: row.cue, answer: row.answer, en: row.en, form: row.form, verbId: row.verb_id, tense: row.tense, person: row.person, kind: row.kind, heard: row.heard }));
  }

  // A drill played to the end, counted once per request id.
  function heard(input: { requestId?: unknown; id?: unknown }): void {
    const requestId = typeof input?.requestId === 'string' ? input.requestId : '';
    const id = Number(input?.id);
    if (!requestId || !Number.isInteger(id)) return;
    const at = now().toISOString();
    if (noteHeard.run(requestId, id, at).changes) countHeard.run(at, id);
  }

  // Why a tape has no drills yet, for the learner.
  function waitingMessage(): string {
    if (writing) return 'Claude is writing your Change it sentences. Please try again in a minute.';
    if (live.all().some((row) => !recorded(row))) return 'Your Change it sentences are being recorded on your Mac. Please try again in a few minutes.';
    return error ?? 'Change it has no sentences yet. Please try again in a few minutes.';
  }

  return { check, playlist, heard, waitingMessage, settled: () => checking ?? Promise.resolve(), close: () => db.close() };
}
