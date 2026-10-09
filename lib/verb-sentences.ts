// In sentences: Verbs cards where the verb sits inside a French sentence with one blank, its infinitive beside it,
// and a time word or context that settles the tense. Claude writes the sentences ahead, a batch at a time, for
// forms Echo chooses (a fixed mix of the four tenses, persons spread, the learner's started verbs, shaky forms
// likelier); each sentence is kept only when its blank holds exactly the form conjugate() gives for its verb, tense
// and person, after that person's subject pronoun. Every sentence is recorded, and waits out of practice until
// its recording exists. A mark counts for the form in the Verbs record (mode 'sentence', scored like Cards).
import { Database } from 'bun:sqlite';
import type { Ask } from './claude';
import { frenchClip, type RadioClip } from './radio';
import { StoreError } from './store';
import { pull } from './verb-drills';
import { conjugate, normal, persons, subject, TENSE_NAMES, TENSES, type Tense, type Verb } from './verbs';

export type Slot = { verbId: string; tense: Tense; person: number };
export type SentenceItem = Slot & { fr: string; answer: string; en: string; why: string };
export type SentenceCard = Slot & { id: string; inf: string; tenseName: string; fr: string; answer: string; en: string; why: string; audio: string };
export type SentenceKnowledge = { known: { fr: string; en: string }[]; started: string[]; level: number };
export type SentenceRound = { items: SentenceCard[]; writing: boolean; recording: number; error: string | null };

// The tenses a batch is written in, whatever Verbs options say: mostly the passé composé and the présent.
export const TENSE_MIX: Record<Tense, number> = { pc: 0.35, pres: 0.3, imp: 0.2, fut: 0.15 };
// How likely each person is in a slot: je, il/elle/on and ils most, vous next, nous and tu least.
export const PERSON_WEIGHTS = [3, 1, 3, 1, 2, 2];
const BATCH = 12;
// A new batch is written once fewer sentences than this are left unseen (recorded or still being recorded).
const REFILL_AT = 10;
const ROUND = 8;
// With fewer started verbs than this, the most common verbs join them.
const MIN_VERBS = 8;
const COMMON = 20;
// A recording that failed is tried again after this long, up to the recorder's own limit (lib/recording-attempts.ts).
const RECORD_RETRY_MS = 10 * 60_000;
// The Radio, the sentence tape and this share one recorder; while another holds it, this tries again after this long.
const RECORDER_BUSY_MS = 30_000;
// After a batch fails, the next is asked for no sooner than this.
const WRITE_RETRY_MS = 60_000;
const LEVELS = ['A1', 'A2', 'B1'];
const BLANK = '___';
const SUBJECT_PERSON: Record<string, number> = { je: 0, 'j’': 0, tu: 1, il: 2, elle: 2, on: 2, nous: 3, vous: 4, ils: 5, elles: 5 };
const SUBJECT_BEFORE = /(?:^|[^\p{L}])(je|j’|tu|il|elle|on|nous|vous|ils|elles)(\s*)$/iu;
const SUBJECT_WORDS = ['je', 'tu', 'il, elle or on', 'nous', 'vous', 'ils or elles'];

// How many slots of a batch each tense gets: TENSE_MIX by largest remainder, so a batch of 12 is 4 pc, 4 présent,
// 2 imparfait, 2 futur.
export function tenseCounts(count: number): Record<Tense, number> {
  const exact = TENSES.map((tense) => ({ tense, share: TENSE_MIX[tense] * count }));
  const counts = Object.fromEntries(exact.map(({ tense, share }) => [tense, Math.floor(share)])) as Record<Tense, number>;
  let left = count - Object.values(counts).reduce((sum, n) => sum + n, 0);
  for (const { tense } of [...exact].sort((a, b) => (b.share % 1) - (a.share % 1))) { if (left-- <= 0) break; counts[tense] += 1; }
  return counts;
}

// The forms a batch is written for: each tense its share, each slot a different verb while there are verbs to go
// round, the verb and person drawn with odds PERSON_WEIGHTS × the form's pull (a shaky form likelier, a solid one
// less), in a shuffled order.
export function planSlots(verbs: Verb[], scores: Map<string, number>, count = BATCH, random: () => number = Math.random): Slot[] {
  const counts = tenseCounts(count);
  const used = new Set<string>();
  const slots: Slot[] = [];
  for (const tense of TENSES) for (let n = 0; n < counts[tense]; n++) {
    if (verbs.every((verb) => used.has(verb.id))) used.clear();
    const options = verbs.filter((verb) => !used.has(verb.id)).flatMap((verb) => persons(verb).map((person) => ({ verb, person, weight: PERSON_WEIGHTS[person]! * pull(scores.get(`${verb.id}|${tense}|${person}`)) })));
    if (!options.length) return slots;
    let left = random() * options.reduce((sum, option) => sum + option.weight, 0);
    const chosen = options.find((option) => (left -= option.weight) < 0) ?? options.at(-1)!;
    used.add(chosen.verb.id);
    slots.push({ verbId: chosen.verb.id, tense, person: chosen.person });
  }
  return slots.map((slot) => ({ slot, key: random() })).sort((a, b) => a.key - b.key).map(({ slot }) => slot);
}

// The subject written before the blank for a slot: j’ when the form starts with a vowel.
const subjectFor = (verb: Verb, slot: Slot) => {
  const form = conjugate(verb, slot.tense)[slot.person]!;
  return slot.person === 0 ? subject(0, form.accepted[0]!).trim() : verb.impersonal ? 'il' : SUBJECT_WORDS[slot.person]!;
};

export function sentencesPrompt(slots: Slot[], verbs: Map<string, Verb>, knowledge: SentenceKnowledge): string {
  const level = LEVELS[Math.max(0, Math.min(2, Math.floor(knowledge.level) - 1))];
  const lines = slots.map((slot, index) => {
    const verb = verbs.get(slot.verbId)!;
    const forms = conjugate(verb, slot.tense)[slot.person]!.accepted;
    return `${index + 1}. ${verb.inf} (${verb.en}), ${TENSE_NAMES[slot.tense]}, subject ${subjectFor(verb, slot)}: the blank is ${forms.map((form) => JSON.stringify(form)).join(' or ')}`;
  });
  return `You write practice sentences for Echo, an app for one English speaker learning French at about ${level}, working towards B1. Each sentence becomes a card in a verb drill: the French is shown with one verb left blank and its infinitive beside it; the learner works out the tense from the sentence, says the whole sentence to themselves with the right form, then turns the card to see the answer, the English, and one line on why.

Write one sentence for each numbered slot below. A slot gives the verb, the tense, the subject and exactly what goes in the blank.

Each sentence:
- is 5 to 12 words of everyday French, natural and true to life;
- has exactly one blank, written ${BLANK}, standing for exactly the slot's form (with its reflexive pronoun when it has one) and nothing else; where two forms are given (an être verb in the passé composé), choose the one that agrees with the subject in your sentence, and say who the subject is when the agreement depends on it;
- has the slot's subject pronoun written immediately before the blank (j’${BLANK} for j’, otherwise the pronoun, a space, then ${BLANK}), with nothing between them: no ne, no object pronoun, no noun as subject, and the verb not negated;
- makes the tense unmistakable from a time word or the context, so no other tense would fit: for the passé composé a finished event at a point in the past (hier, hier soir, la semaine dernière, ce matin, l’année dernière); for the imparfait a past habit or background (quand j’étais petit, avant, tous les étés, à l’époque); for the futur something still to come (demain, la semaine prochaine, dans deux ans, l’été prochain); for the présent what is true now or usually (maintenant, d’habitude, tous les jours, en ce moment);
- uses words from the learner's vocabulary below where it can (any form of them), plus little words (articles, pronouns, prepositions, common determiners), time words and first names.

For each also write:
- en: a natural English translation of the whole sentence;
- why: one short line in plain English naming the cue in the sentence and why it gives this tense, plus anything about the form worth noticing (the helper, an agreement, a stem). For example: "Hier soir: one finished event, so passé composé. Aller goes with être, and allés agrees with nous."

Reply with JSON only: {"sentences": [{"slot": 1, "fr": "Hier soir, nous ${BLANK} au cinéma.", "answer": "sommes allés", "en": "Last night we went to the cinema.", "why": "..."}]}

Slots:
${lines.join('\n')}

The learner's vocabulary (French = English):
${knowledge.known.map((word) => `${word.fr} = ${word.en}`).join('\n')}`;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

// One sentence as Claude wrote it for a slot, kept only when its blank holds the slot's form exactly as conjugate()
// gives it (accents included) and the subject pronoun just before the blank is the slot's person (j’ exactly when
// the form starts with a vowel). Returns the item, or what is wrong with it.
export function checkSentence(raw: unknown, slot: Slot, verb: Verb): SentenceItem | string {
  const entry = (raw ?? {}) as Record<string, unknown>;
  const fr = text(entry.fr).replace(/_{2,}/g, BLANK).replace(/['`]/g, '’');
  const given = text(entry.answer).replace(/['`]/g, '’');
  const en = text(entry.en).replace(/['`]/g, '’'), why = text(entry.why).replace(/['`]/g, '’');
  if (!fr || !given || !en || !why) return 'a part is missing';
  if (fr.length > 160 || en.length > 200 || why.length > 300) return 'too long';
  const at = fr.indexOf(BLANK);
  if (at < 0 || fr.indexOf(BLANK, at + 1) >= 0) return 'not exactly one blank';
  const form = conjugate(verb, slot.tense)[slot.person];
  const answer = form?.accepted.find((accepted) => accepted === normal(given));
  if (!form || !answer) return `the blank holds "${given}", not ${form?.accepted.join(' / ') ?? 'a form of this person'}`;
  const found = fr.slice(0, at).match(SUBJECT_BEFORE);
  const pronoun = found?.[1]!.toLowerCase();
  if (!found || pronoun === undefined) return 'no subject pronoun right before the blank';
  if (SUBJECT_PERSON[pronoun] !== slot.person) return `the subject is ${pronoun}, not person ${slot.person}`;
  if ((pronoun === 'j’') !== (found[2] === '') || (slot.person === 0 && (pronoun === 'j’') !== (subject(0, answer) === 'j’'))) return `"${pronoun}" does not fit before ${answer}`;
  return { ...slot, fr, answer, en, why };
}

export function parseSentences(reply: string, slots: Slot[], verbs: Map<string, Verb>): { items: SentenceItem[]; problems: string[] } {
  let parsed: { sentences?: unknown } | null;
  try { parsed = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)); } catch { parsed = null; }
  if (!Array.isArray(parsed?.sentences)) return { items: [], problems: ['the reply could not be read'] };
  const items: SentenceItem[] = [], problems: string[] = [];
  const done = new Set<number>();
  for (const raw of parsed.sentences) {
    const index = Number((raw as Record<string, unknown>)?.slot) - 1;
    const slot = slots[index];
    if (!slot || done.has(index)) { problems.push(`slot ${index + 1}: no such slot`); continue; }
    done.add(index);
    const checked = checkSentence(raw, slot, verbs.get(slot.verbId)!);
    if (typeof checked === 'string') problems.push(`slot ${index + 1} (${verbs.get(slot.verbId)!.inf}, ${slot.tense}): ${checked}`);
    else items.push(checked);
  }
  return { items, problems };
}

type Row = { id: number; verb_id: string; tense: Tense; person: number; fr: string; answer: string; en: string; why: string; clip: string; seen: number };
// The sentence with its blank filled, as recorded.
const filled = (row: { fr: string; answer: string }) => row.fr.replace(BLANK, row.answer);

export function createVerbSentences(deps: {
  dbPath: string; ask: Ask;
  verbs: () => Verb[];
  knowledge: () => SentenceKnowledge;
  // Each practised form's score, by "verbId|tense|person" (lib/verb-drills.ts formScores).
  scores: () => Map<string, number>;
  // Counts a mark for the form in the Verbs record (verbs.mark with way 'sentence').
  markForm: (input: { requestId: string; verbId: string; tense: Tense; person: number; knew: boolean }) => void;
  clipExists: (id: string) => boolean;
  // Whether a clip has failed too often to be tried again (lib/recording-attempts.ts).
  givenUp: (id: string) => boolean;
  // Records the clips; false when another recording holds the recorder, so nothing was tried.
  record: (clips: RadioClip[]) => Promise<boolean>;
  batch?: number;
  now?: () => Date; random?: () => number;
}) {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const batch = deps.batch ?? BATCH;
  const refillAt = Math.min(REFILL_AT, batch - 2);
  const db = new Database(deps.dbPath, { create: true, strict: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    -- A sentence of In sentences: fr holds one ___ for answer, the form of verb_id in tense for person; clip is its recording.
    CREATE TABLE IF NOT EXISTS verb_sentences (
      id INTEGER PRIMARY KEY, verb_id TEXT NOT NULL, tense TEXT NOT NULL, person INTEGER NOT NULL, fr TEXT NOT NULL,
      answer TEXT NOT NULL, en TEXT NOT NULL, why TEXT NOT NULL, clip TEXT NOT NULL, created_at TEXT NOT NULL
    );
    -- Each mark on a sentence card, once per request: how often a sentence has been seen.
    CREATE TABLE IF NOT EXISTS verb_sentence_marks (
      request_id TEXT PRIMARY KEY, sentence_id INTEGER NOT NULL, knew INTEGER NOT NULL, marked_at TEXT NOT NULL
    );`);
  const everyRow = db.query<Row, []>('SELECT s.*, (SELECT COUNT(*) FROM verb_sentence_marks m WHERE m.sentence_id = s.id) AS seen FROM verb_sentences s ORDER BY s.id');
  const rowById = db.query<Row, [number]>('SELECT *, 0 AS seen FROM verb_sentences WHERE id = ?');
  const addRow = db.query('INSERT INTO verb_sentences (verb_id, tense, person, fr, answer, en, why, clip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const saveMark = db.query('INSERT OR IGNORE INTO verb_sentence_marks (request_id, sentence_id, knew, marked_at) VALUES (?, ?, ?, ?)');

  let writing: Promise<void> | null = null;
  let recording: Promise<void> | null = null;
  let error: string | null = null;
  let failedAt = -Infinity;
  const triedAt = new Map<string, number>();
  const byId = () => new Map(deps.verbs().map((verb) => [verb.id, verb]));
  // The sentences still right for their verb's table as it is now (a corrected table can unmake one).
  function current(verbs = byId()) {
    return everyRow.all().flatMap((row) => {
      const verb = verbs.get(row.verb_id);
      return verb && conjugate(verb, row.tense)[row.person]?.accepted.includes(row.answer) ? [{ row, verb }] : [];
    });
  }

  // Records every sentence still without its recording: a clip tried in this run waits RECORD_RETRY_MS before
  // another try, and when another recording holds the recorder, the clips wait RECORDER_BUSY_MS instead. One
  // recording run at a time.
  function recordMissing(): void {
    if (recording) return;
    const at = now().getTime();
    const clips = new Map(current().filter(({ row }) => !deps.clipExists(row.clip) && !deps.givenUp(row.clip) && at - (triedAt.get(row.clip) ?? -Infinity) >= RECORD_RETRY_MS)
      .map(({ row }) => [row.clip, frenchClip(filled(row))]));
    if (!clips.size) return;
    for (const id of clips.keys()) triedAt.set(id, at);
    recording = deps.record([...clips.values()])
      .then((tried) => { if (!tried) for (const id of clips.keys()) triedAt.set(id, at - RECORD_RETRY_MS + RECORDER_BUSY_MS); })
      .catch((failure: Error) => console.error(`verb sentences: recording failed: ${failure.message}`))
      .finally(() => { recording = null; });
  }

  // Asks for a batch when fewer than refillAt are left unseen (counting those still to be recorded, not those
  // whose recording was given up); one batch at a time, and a failure is shown, and not retried for
  // WRITE_RETRY_MS, so a Claude that is down is not asked on every card.
  function refill(): void {
    if (writing) return;
    const unseen = current().filter(({ row }) => !row.seen && !deps.givenUp(row.clip)).length;
    if (unseen >= refillAt || now().getTime() - failedAt < WRITE_RETRY_MS) { recordMissing(); return; }
    // The promise is cleared in .finally, which always runs after this assignment, even when the batch fails at once.
    writing = (async () => {
      try {
        const knowledge = deps.knowledge();
        const verbs = deps.verbs();
        const started = new Set(knowledge.started);
        const mine = verbs.filter((verb) => started.has(verb.id));
        const pool = mine.length >= MIN_VERBS ? mine : [...new Set([...mine, ...verbs.slice(0, COMMON)])];
        if (!pool.length) throw new StoreError('In sentences needs your verb tables first; they are still being written.');
        const slots = planSlots(pool, deps.scores(), batch, random);
        const found = byId();
        const reply = await deps.ask(sentencesPrompt(slots, found, knowledge), { timeout: 5 * 60_000, purpose: 'writing verb sentences' });
        const { items, problems } = parseSentences(reply, slots, found);
        if (problems.length) console.log(`verb sentences: left out ${problems.length} of ${slots.length}: ${problems.join('; ')}`);
        if (!items.length) throw new StoreError('Claude’s sentences could not be used. Please try again.');
        const at = now().toISOString();
        db.transaction(() => { for (const item of items) addRow.run(item.verbId, item.tense, item.person, item.fr, item.answer, item.en, item.why, frenchClip(filled(item)).id, at); })();
        error = null;
      } catch (failure) {
        error = failure instanceof Error ? failure.message : 'The sentences could not be written.';
        failedAt = now().getTime();
      }
    })().finally(() => { writing = null; recordMissing(); });
  }

  // The next cards: recorded sentences not in `exclude` (those waiting on the phone and just seen), the least seen
  // first so none comes back before the rest have been seen, and among equals a shaky form likelier first.
  function round(input: { exclude?: unknown }): SentenceRound {
    refill();
    const exclude = new Set(Array.isArray(input?.exclude) ? input.exclude.filter((id): id is string => typeof id === 'string').slice(0, 40) : []);
    const scores = deps.scores();
    const rows = current();
    const ready = rows.filter(({ row }) => deps.clipExists(row.clip));
    const items = ready.filter(({ row }) => !exclude.has(String(row.id)))
      .map((entry) => ({ ...entry, key: random() ** (1 / pull(scores.get(`${entry.row.verb_id}|${entry.row.tense}|${entry.row.person}`))) }))
      .sort((a, b) => a.row.seen - b.row.seen || b.key - a.key).slice(0, ROUND)
      .map(({ row, verb }): SentenceCard => ({
        id: String(row.id), verbId: row.verb_id, inf: verb.inf, tense: row.tense, tenseName: TENSE_NAMES[row.tense], person: row.person,
        fr: row.fr, answer: row.answer, en: row.en, why: row.why, audio: `audio/radio/${row.clip}.mp3`,
      }));
    const waiting = rows.filter(({ row }) => !row.seen && !deps.clipExists(row.clip) && !deps.givenUp(row.clip)).length;
    return { items, writing: !!writing, recording: waiting, error: writing ? null : error };
  }

  // The learner's say on a sentence card: counts for its form, and the sentence as seen, once per request id.
  function mark(input: { requestId?: unknown; id?: unknown; knew?: unknown }): { ok: true } {
    const requestId = typeof input?.requestId === 'string' && input.requestId ? input.requestId : '';
    if (!requestId) throw new StoreError('This answer is missing its request ID.');
    const row = typeof input.id === 'string' && /^\d+$/.test(input.id) ? rowById.get(Number(input.id)) : null;
    if (!row) throw new StoreError('That sentence is not in Echo.', 404);
    if (typeof input.knew !== 'boolean') throw new StoreError('Say whether you knew it.');
    deps.markForm({ requestId, verbId: row.verb_id, tense: row.tense, person: row.person, knew: input.knew });
    saveMark.run(requestId, row.id, input.knew ? 1 : 0, now().toISOString());
    return { ok: true };
  }

  return { round, mark, settled: async () => { await writing; await recording; }, close: () => db.close() };
}
