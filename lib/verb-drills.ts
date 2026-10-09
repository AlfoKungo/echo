// The Verbs room's record and rounds: every answer to a form (a verb in one tense for one person), from Type it,
// Whole table, Cards (the learner says whether they knew it), In sentences (the same, for a form inside a sentence)
// or By ear, kept once per request. A form's state comes from its latest answers (By ear is kept apart:
// it tests hearing, not writing), and a round leans on the forms that are shaky or not tried yet.
import { Database } from 'bun:sqlite';
import { pointsFromLowest } from './score-points';
import { recentStudyDays, SCORE_HALF_LIFE_DAYS, StoreError, studyDay } from './store';
import type { EarKind, ParadigmRow, Tense, Verb } from './verbs';
import { FRENCH, type DrillVerb, type VerbGrammar } from './verb-grammar';

export type FormState = 'solid' | 'getting' | 'shaky' | 'new';
// shaky: every form at SHAKY_AT or below, in any verb and tense (Mistakes practises these).
export type VerbSet = 'mine' | 'common' | 'chosen' | 'shaky';
export type RoundInput<T extends string = Tense> = { set: VerbSet; verbIds?: string[]; tenses: T[] };
export type RoundItem<T extends string = Tense> = { verbId: string; inf: string; en: string; tense: T; tenseName: string; person: number };
// One way to read a shown form: a verb and tense it belongs to, the persons sharing it there, their forms with subjects.
export type FormReading<T extends string = Tense> = { verbId: string; inf: string; en: string; tense: T; tenseName: string; persons: number[]; forms: string[] };
export type VerbCard<T extends string = Tense> = RoundItem<T> & { answer: string; rule: string; paradigm: ParadigmRow[]; hook?: string; form?: string; readings?: FormReading<T>[] };
export type FormResult = { right: boolean; expected: string; why: string; rule: string; paradigm: ParadigmRow[]; hook?: string };
export type EarItem = { id: string; audio: string; question: string; choices: string[] };

const ROUND = 20;
const EAR_ROUND = 10;
const COMMON = 20;
const WORST = 6;
const PER_VERB = 3;
const PER_TENSE = 2;
// A form's score: +2 for a typed answer right and -3 wrong (Type it, each cell of a whole table); +1 or -2 for a
// Cards, In sentences or Walkman mark, the learner's own say; +1 or -1 for a Form → verb mark, since knowing a form
// when you see it is the easier half. By ear asks about a tense or a number, not one form, and counts for none. Every point
// halves over SCORE_HALF_LIFE_DAYS, as a word's does. A table written in Look, then write is graded as a whole,
// apart from its forms: TABLE_PERFECT points when every form was right, TABLE_MISSED when any was not.
export const points = (mode: string, right: number) => mode === 'card' || mode === 'sentence' ? (right ? 1 : -2) : mode === 'recognize' ? (right ? 1 : -1) : (right ? 2 : -3);
const TABLE_PERFECT = 2, TABLE_MISSED = -1;
// Every drill picks a form with odds 2^(-score/PULL), the score held within ±LIMIT, as the Walkman picks words: an
// untried form at 0, one missed once about three times as likely, one known twice in a row about a fifth as likely.
const PULL = 1.7;
const LIMIT = 8;
export const pull = (score: number | undefined) => 2 ** (-Math.max(-LIMIT, Math.min(LIMIT, score ?? 0)) / PULL);
// On the score chart: at or above SOLID_AT is solid, at or below SHAKY_AT shaky; the chart keeps SCORE_DAYS days.
const SOLID_AT = 3;
const SHAKY_AT = -2;
const SCORE_DAYS = 60;
// A form at SHAKY_AT or below that was missed HOOK_MISSES times gets a memory hook (lib/word-hooks.ts).
const HOOK_MISSES = 3;
const DAY_MS = 86_400_000;
// On the verb tape the person is said in English: il and ils sound alike in French. It is shown short and said as
// a phrase: the English voice garbles a lone pronoun, and a one-word take is too short to check.
export const WALKMAN_PERSONS = ['I', 'you', 'he or she', 'we', 'you, plural', 'they'];
export const WALKMAN_PERSONS_SAID = ['the I form', 'the you form', 'the he or she form', 'the we form', 'the you plural form', 'the they-form'];

// The calendar day after a study day (YYYY-MM-DD).
function nextDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(year!, month! - 1, date! + 1, 12);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

// grammar: the language's verbs (lib/verb-grammar.ts); French's unless given.
export function createVerbDrills<V extends DrillVerb = Verb, T extends string = Tense>(options: {
  dbPath: string;
  verbs: () => V[];
  grammar?: VerbGrammar<V, T>;
  // Each vocabulary word's status and score, for "your verbs".
  vocabulary: () => { id: string; status: string; score: number }[];
  // The recording of a phrase said By ear, or null until it has been made.
  earAudio: (said: string) => string | null;
  now?: () => Date; random?: () => number;
}) {
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const grammar = options.grammar ?? (FRENCH as unknown as VerbGrammar<V, T>);
  const { tenses: TENSES, tenseNames: TENSE_NAMES, groupTitles: GROUP_TITLES, persons, conjugate, subject, isRight, accentSlip, diagnose, paradigm, rule, groupOf, earQuestion, earQuestions } = grammar;
  const db = new Database(options.dbPath, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
    -- One answer in the Verbs room: a form typed (mode form or table) or a By ear question (mode ear, with its id).
    CREATE TABLE IF NOT EXISTS verb_answers (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, verb_id TEXT NOT NULL,
      tense TEXT NOT NULL, person INTEGER NOT NULL, mode TEXT NOT NULL, question TEXT, given TEXT NOT NULL,
      right INTEGER NOT NULL, answered_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS verb_answers_form ON verb_answers(verb_id, tense, person, sequence DESC);
    -- A memory hook Claude wrote for a stubborn form, with the form it was written for: a hook whose form no longer
    -- matches the verb's table (a corrected table) is not shown, and is written again.
    CREATE TABLE IF NOT EXISTS verb_hooks (
      verb_id TEXT NOT NULL, tense TEXT NOT NULL, person INTEGER NOT NULL, form TEXT NOT NULL, hook TEXT NOT NULL,
      written_at TEXT NOT NULL, PRIMARY KEY (verb_id, tense, person)
    );
    -- A table written from memory just after seeing it (Look, then write), graded as a whole: perfect or not.
    CREATE TABLE IF NOT EXISTS verb_tables (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, verb_id TEXT NOT NULL,
      tense TEXT NOT NULL, perfect INTEGER NOT NULL, answered_at TEXT NOT NULL
    );
  `);
  const insert = db.query('INSERT OR IGNORE INTO verb_answers (request_id, verb_id, tense, person, mode, question, given, right, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertTable = db.query('INSERT OR IGNORE INTO verb_tables (request_id, verb_id, tense, perfect, answered_at) VALUES (?, ?, ?, ?, ?)');
  const everyTable = db.query<{ verb_id: string; perfect: number; answered_at: string }, []>('SELECT verb_id, perfect, answered_at FROM verb_tables ORDER BY sequence');
  const written = db.query<{ verb_id: string; tense: T; person: number; right: number }, []>("SELECT verb_id, tense, person, right FROM verb_answers WHERE mode != 'ear' ORDER BY sequence DESC");
  const everyScored = db.query<{ verb_id: string; tense: T; person: number; mode: string; right: number; answered_at: string }, []>("SELECT verb_id, tense, person, mode, right, answered_at FROM verb_answers WHERE mode != 'ear' ORDER BY sequence");
  const everyWritten = db.query<{ verb_id: string; tense: T; person: number; right: number; answered_at: string }, []>("SELECT verb_id, tense, person, right, answered_at FROM verb_answers WHERE mode != 'ear' ORDER BY sequence");
  const hookRows = db.query<{ verb_id: string; tense: string; person: number; form: string; hook: string }, []>('SELECT verb_id, tense, person, form, hook FROM verb_hooks');
  const hookRow = db.query<{ form: string; hook: string }, [string, string, number]>('SELECT form, hook FROM verb_hooks WHERE verb_id = ? AND tense = ? AND person = ?');
  const saveHook = db.query('INSERT INTO verb_hooks (verb_id, tense, person, form, hook, written_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (verb_id, tense, person) DO UPDATE SET form = excluded.form, hook = excluded.hook, written_at = excluded.written_at');
  const wrongGiven = db.query<{ given: string }, [string, string, number]>("SELECT given FROM verb_answers WHERE verb_id = ? AND tense = ? AND person = ? AND right = 0 AND given != '' GROUP BY lower(given) ORDER BY MAX(sequence) DESC LIMIT 3");
  const heard = db.query<{ question: string; misses: number; answers: number }, []>("SELECT question, SUM(right = 0) AS misses, COUNT(*) AS answers FROM verb_answers WHERE mode = 'ear' GROUP BY question");

  const key = (verbId: string, tense: string, person: number) => `${verbId}|${tense}|${person}`;
  // Each written form's answers, newest first.
  function history(): Map<string, number[]> {
    const byForm = new Map<string, number[]>();
    for (const row of written.all()) {
      const id = key(row.verb_id, row.tense, row.person);
      const list = byForm.get(id);
      if (list) list.push(row.right); else byForm.set(id, [row.right]);
    }
    return byForm;
  }
  // Solid: the last two answers right. Shaky: the last one wrong. Getting there: right once, or right after a miss.
  const stateOf = (answers: number[] | undefined): FormState => !answers?.length ? 'new' : !answers[0] ? 'shaky' : answers[1] === 1 ? 'solid' : 'getting';

  const byId = () => new Map(options.verbs().map((verb) => [verb.id, verb]));
  // Every practised form's score as it stood at `end` (a time in ms), and how often each was missed by then.
  function scoresAt(end: number, rows = everyScored.all()): { scores: Map<string, number>; misses: Map<string, number> } {
    const scores = new Map<string, number>(), misses = new Map<string, number>();
    for (const row of rows) {
      const at = Date.parse(row.answered_at);
      if (at > end) continue;
      const id = key(row.verb_id, row.tense, row.person);
      scores.set(id, (scores.get(id) ?? 0) + points(row.mode, row.right) * 0.5 ** ((end - at) / DAY_MS / SCORE_HALF_LIFE_DAYS));
      if (!row.right) misses.set(id, (misses.get(id) ?? 0) + 1);
    }
    return { scores, misses };
  }
  // The end of a study day: 04:00 the next morning, or now for today.
  const endOf = (day: string) => { if (day === studyDay(now())) return now().getTime(); const [year, month, date] = day.split('-').map(Number); return new Date(year!, month! - 1, date! + 1, 4).getTime(); };
  const formText = (verb: V, tense: T, person: number) => { const form = conjugate(verb, tense)[person]!; return subject(person, form.shown) + form.shown; };
  function chosenVerbs(input: RoundInput<T>): V[] {
    const verbs = options.verbs();
    if (input?.set === 'mine') {
      const started = new Map(options.vocabulary().filter((word) => word.status !== 'new').map((word) => [word.id, word.score]));
      const mine = verbs.filter((verb) => started.has(verb.id));
      if (!mine.length) throw new StoreError('None of your started words is a verb with its table ready yet. Choose Most common for now.', 409);
      return mine;
    }
    if (input?.set === 'common') return verbs.slice(0, COMMON);
    if (input?.set === 'shaky') return verbs;
    if (input?.set === 'chosen') {
      const found = byId();
      const picked = (Array.isArray(input.verbIds) ? input.verbIds : []).flatMap((id) => { const verb = found.get(id); return verb ? [verb] : []; });
      if (!picked.length) throw new StoreError('Choose at least one verb.');
      return picked;
    }
    throw new StoreError('Choose which verbs to practise: yours, the most common, or your own pick.');
  }
  function chosenTenses(input: RoundInput<T>): T[] {
    if (input?.set === 'shaky') return [...TENSES];
    const tenses = Array.isArray(input?.tenses) ? TENSES.filter((tense) => input.tenses.includes(tense)) : [];
    if (!tenses.length) throw new StoreError(`Choose at least one ${grammar.unit}.`);
    return tenses;
  }
  // Neighbours differ in verb wherever the rest allows it.
  function spread<T extends { verbId: string }>(items: T[]): T[] {
    const rest = [...items];
    const ordered: T[] = [];
    while (rest.length) {
      const index = rest.findIndex((item) => item.verbId !== ordered.at(-1)?.verbId);
      ordered.push(...rest.splice(index < 0 ? 0 : index, 1));
    }
    return ordered;
  }

  // A form's memory hook, when one was written for the form as the table has it now.
  function hookFor(verb: V, tense: T, person: number): string | undefined {
    const row = hookRow.get(verb.id, tense, person);
    return row && row.form === formText(verb, tense, person) ? row.hook : undefined;
  }
  // Every form at SHAKY_AT or below, lowest first, with how often it was missed.
  function shaky() {
    const verbs = byId();
    const { scores, misses } = scoresAt(now().getTime(), everyScored.all().filter((row) => verbs.has(row.verb_id)));
    return [...scores].filter(([, score]) => score <= SHAKY_AT).sort((left, right) => left[1] - right[1]).map(([id, score]) => {
      const [verbId, tense, person] = id.split('|') as [string, T, string];
      const verb = verbs.get(verbId)!;
      return { verbId, verb, tense, person: Number(person), form: formText(verb, tense, Number(person)), score, misses: misses.get(id) ?? 0 };
    });
  }
  // The stubborn forms still without a hook (or with one for an older table), lowest score first, each with the
  // wrong answers last typed for it.
  function hookless() {
    const written = new Map(hookRows.all().map((row) => [key(row.verb_id, row.tense, row.person), row.form]));
    return shaky().filter((entry) => entry.misses >= HOOK_MISSES && written.get(key(entry.verbId, entry.tense, entry.person)) !== entry.form).map((entry) => ({
      id: key(entry.verbId, entry.tense, entry.person), form: entry.form, verb: entry.verb.inf, means: entry.verb.en, tense: TENSE_NAMES[entry.tense],
      wrongAnswers: wrongGiven.all(entry.verbId, entry.tense, entry.person).map((row) => row.given),
    }));
  }
  function setHooks(hooks: { id: string; hook: string }[]): void {
    const verbs = byId();
    const at = now().toISOString();
    db.transaction(() => {
      for (const { id, hook } of hooks) {
        const [verbId, tense, person] = id.split('|') as [string, T, string];
        const verb = verbs.get(verbId);
        if (verb && TENSES.includes(tense) && persons(verb, tense).includes(Number(person))) saveHook.run(verbId, tense, Number(person), formText(verb, tense, Number(person)), hook, at);
      }
    })();
  }

  // A Type it round: the forms most worth practising (shaky first, then untried), spread so a round of many
  // verbs covers several (at most three forms per verb, two per verb and tense); for your verbs, low vocabulary scores weigh a little.
  function round(input: RoundInput<T>): RoundItem<T>[] {
    const verbs = chosenVerbs(input), tenses = chosenTenses(input);
    const { scores } = scoresAt(now().getTime());
    const score = new Map(options.vocabulary().map((word) => [word.id, word.score]));
    // Weighted order without replacement: each key is random^(1/weight), highest first. Among your own verbs, a
    // verb whose word is shaky in Vocabulary leans a little earlier.
    const shakyOnly = input.set === 'shaky';
    const pool = verbs.flatMap((verb) => tenses.flatMap((tense) => persons(verb, tense).filter((person) => !shakyOnly || (scores.get(key(verb.id, tense, person)) ?? 0) <= SHAKY_AT).map((person) => {
      const lean = input.set === 'mine' ? 2 ** (-Math.max(-4, Math.min(4, score.get(verb.id) ?? 0)) / 4) : 1;
      return { verb, tense, person, weight: random() ** (1 / (pull(scores.get(key(verb.id, tense, person))) * lean)) };
    })));
    // With few verbs chosen, each may fill more of the round: one verb alone can give all its forms.
    const verbCap = Math.max(PER_VERB, Math.ceil(ROUND / verbs.length)), tenseCap = Math.max(PER_TENSE, Math.ceil(verbCap / tenses.length));
    const perVerb = new Map<string, number>(), perTense = new Map<string, number>();
    const picked: RoundItem<T>[] = [];
    for (const entry of pool.sort((left, right) => right.weight - left.weight)) {
      if (picked.length >= ROUND) break;
      const tenseKey = `${entry.verb.id}|${entry.tense}`;
      if ((perVerb.get(entry.verb.id) ?? 0) >= verbCap || (perTense.get(tenseKey) ?? 0) >= tenseCap) continue;
      perVerb.set(entry.verb.id, (perVerb.get(entry.verb.id) ?? 0) + 1);
      perTense.set(tenseKey, (perTense.get(tenseKey) ?? 0) + 1);
      picked.push({ verbId: entry.verb.id, inf: entry.verb.inf, en: entry.verb.en, tense: entry.tense, tenseName: TENSE_NAMES[entry.tense], person: entry.person });
    }
    return spread(picked.sort(() => random() - 0.5));
  }

  function findTense(verbId: unknown, tense: unknown): { verb: V; tense: T } {
    const verb = typeof verbId === 'string' ? byId().get(verbId) : undefined;
    if (!verb) throw new StoreError('That verb is not in Echo.', 404);
    if (!TENSES.includes(tense as T)) throw new StoreError(`Choose a ${grammar.unit} Echo drills.`);
    return { verb, tense: tense as T };
  }
  function findForm(verbId: unknown, tense: unknown, person: unknown): { verb: V; tense: T; person: number } {
    const { verb } = findTense(verbId, tense);
    if (!Number.isInteger(person) || !persons(verb, tense as T).includes(person as number)) throw new StoreError(`${verb.inf} has no such person.`);
    return { verb, tense: tense as T, person: person as number };
  }
  function result(verb: V, tense: T, person: number, given: string): FormResult {
    const form = conjugate(verb, tense)[person]!;
    const right = isRight(form, given);
    const expected = subject(person, form.shown) + form.shown;
    const why = right ? (accentSlip(form, given) ? `Right — with the accents: ${expected}.` : '') : !given.trim() ? '' : diagnose(verb, tense, person, given);
    const hook = hookFor(verb, tense, person);
    return { right, expected, why, rule: rule(verb, tense), paradigm: paradigm(verb, tense), ...(hook ? { hook } : {}) };
  }
  const requestIdOf = (value: unknown) => {
    if (typeof value !== 'string' || !value) throw new StoreError('This answer is missing its request ID.');
    return value;
  };

  // One typed form, checked and kept once per request id.
  function answer(input: { requestId: string; verbId: string; tense: T; person: number; given: string }): FormResult {
    const requestId = requestIdOf(input?.requestId);
    const { verb, tense, person } = findForm(input.verbId, input.tense, input.person);
    if (typeof input.given !== 'string' || !input.given.trim()) throw new StoreError('Type the form first.');
    const checked = result(verb, tense, person, input.given);
    insert.run(requestId, verb.id, tense, person, 'form', null, input.given.slice(0, 80), checked.right ? 1 : 0, now().toISOString());
    return checked;
  }

  // A Cards round: the same forms as Type it, each with its answer, so the card can turn over at once. With
  // way 'recognize' the card shows the bare form ("mens") and turns over to every reading of it: each verb and tense
  // it belongs to, with all the persons that share it (je mens, tu mens). Two cards showing the same form are one.
  // A grammar with whole cards (Swedish key forms) asks every form of the verb at once, one card per verb.
  function cards(input: RoundInput<T> & { way?: string }): VerbCard<T>[] {
    const verbs = byId();
    const recognize = input?.way === 'recognize';
    const whole = !!grammar.wholeCards && !recognize;
    const readingsOf = recognize ? formReadings() : null;
    const shownForms = new Set<string>();
    const items = round(input);
    const drawn = whole ? items.filter((item, index) => items.findIndex((other) => other.verbId === item.verbId && other.tense === item.tense) === index) : items;
    return drawn.flatMap((item): VerbCard<T>[] => {
      const verb = verbs.get(item.verbId)!;
      if (whole) {
        const person = persons(verb, item.tense)[0]!;
        const answer = conjugate(verb, item.tense).flatMap((form, at) => form ? [subject(at, form.shown) + form.shown] : []).join(', ');
        return [{ ...item, person, answer, rule: rule(verb, item.tense), paradigm: paradigm(verb, item.tense) }];
      }
      const form = conjugate(verb, item.tense)[item.person]!;
      const hook = hookFor(verb, item.tense, item.person);
      const card: VerbCard<T> = { ...item, answer: subject(item.person, form.shown) + form.shown, rule: rule(verb, item.tense), paradigm: paradigm(verb, item.tense), ...(hook ? { hook } : {}) };
      if (!readingsOf) return [card];
      if (shownForms.has(form.shown)) return [];
      shownForms.add(form.shown);
      // Phrases built on a verb (avoir peur, avoir raison) conjugate exactly like it, so readings with the same tense
      // and forms are one, named by the shortest: the verb itself. The card's own reading comes first.
      const same = (reading: FormReading<T>) => `${reading.tense}|${reading.forms.join('|')}`;
      const readings = [...readingsOf.get(form.shown)!].sort((left, right) => left.inf.length - right.inf.length);
      const seen = new Set<string>();
      const distinct = readings.filter((reading) => !seen.has(same(reading)) && !!seen.add(same(reading)));
      const mine = same(readings.find((reading) => reading.verbId === verb.id && reading.tense === item.tense)!);
      return [{ ...card, form: form.shown, readings: [...distinct.filter((reading) => same(reading) === mine), ...distinct.filter((reading) => same(reading) !== mine)] }];
    });
  }
  // Every form Echo drills, by how it is shown without its subject: the verbs and tenses it belongs to, each with
  // the persons that share it there and those persons' forms with their subjects.
  function formReadings() {
    const readings = new Map<string, FormReading<T>[]>();
    for (const verb of options.verbs()) for (const tense of TENSES) {
      const table = conjugate(verb, tense);
      for (const person of persons(verb, tense)) {
        const shown = table[person]!.shown;
        const list = readings.get(shown) ?? readings.set(shown, []).get(shown)!;
        let reading = list.find((entry) => entry.verbId === verb.id && entry.tense === tense);
        if (!reading) list.push(reading = { verbId: verb.id, inf: verb.inf, en: verb.en, tense, tenseName: TENSE_NAMES[tense], persons: [], forms: [] });
        reading.persons.push(person); reading.forms.push(subject(person, shown) + shown);
      }
    }
    return readings;
  }
  // The learner's own say on a card: counts for the form, once per request id; way 'recognize' is a Form → verb card,
  // way 'sentence' a card of In sentences (lib/verb-sentences.ts). A whole card (Swedish key forms) counts for every
  // form of its tense.
  function mark(input: { requestId: string; verbId: string; tense: T; person: number; knew: boolean; way?: string }) {
    const requestId = requestIdOf(input?.requestId);
    const { verb, tense, person } = findForm(input?.verbId, input?.tense, input?.person);
    if (typeof input.knew !== 'boolean') throw new StoreError('Say whether you knew it.');
    const way = input.way === 'recognize' || input.way === 'sentence' ? input.way : 'card';
    if (grammar.wholeCards && way === 'card') for (const each of persons(verb, tense)) insert.run(`${requestId}:${each}`, verb.id, tense, each, way, null, '', input.knew ? 1 : 0, now().toISOString());
    else insert.run(requestId, verb.id, tense, person, way, null, '', input.knew ? 1 : 0, now().toISOString());
    return { ok: true };
  }
  // Every practised form's score now, by "verbId|tense|person".
  const formScores = () => scoresAt(now().getTime()).scores;

  // A whole table at once: every person checked, a blank one counted as not known.
  // The next whole table to fill in: one verb in one tense from the chosen verbs and tenses, drawn with odds of its
  // forms' average odds (see pull), so a table with low-scoring forms comes far more often than a solid one. exclude
  // lists the tables just done ("verbId|tense", newest first); it is halved until something is left.
  function nextTable(input: RoundInput<T> & { exclude?: string[] }): { verbId: string; tense: T } {
    const verbs = chosenVerbs(input), tenses = chosenTenses(input);
    const { scores } = scoresAt(now().getTime());
    // A verb has no table in a tense with no persons (a Swedish verb outside the group).
    const pool = verbs.flatMap((verb) => tenses.flatMap((tense) => {
      const people = persons(verb, tense);
      if (!people.length) return [];
      const weight = people.reduce((total, person) => total + pull(scores.get(key(verb.id, tense, person))), 0) / people.length;
      return [{ verbId: verb.id, tense, weight }];
    }));
    if (!pool.length) throw new StoreError(`No tables for these verbs in that ${grammar.unit}.`);
    const exclude = Array.isArray(input.exclude) ? input.exclude.filter((entry): entry is string => typeof entry === 'string').slice(0, 20) : [];
    let candidates = pool;
    for (let keep = exclude.length; keep >= 0; keep = keep > 1 ? Math.floor(keep / 2) : keep - 1) {
      const passed = new Set(exclude.slice(0, keep));
      candidates = pool.filter((entry) => !passed.has(`${entry.verbId}|${entry.tense}`));
      if (candidates.length) break;
    }
    let left = random() * candidates.reduce((total, entry) => total + entry.weight, 0);
    const index = candidates.findIndex((entry) => (left -= entry.weight) < 0);
    const { verbId, tense } = candidates[index < 0 ? candidates.length - 1 : index]!;
    return { verbId, tense };
  }

  // looked: the table was just shown (Look, then write), so it gets one grade, kept apart from its forms' scores.
  // again: Check again on a table already checked, which counts for nothing.
  function table(input: { requestId: string; verbId: string; tense: T; answers: string[]; looked?: boolean; again?: boolean }) {
    const requestId = requestIdOf(input?.requestId);
    const { verb, tense } = findTense(input?.verbId, input?.tense);
    if (!Array.isArray(input.answers) || input.answers.length !== 6) throw new StoreError('Send an answer for each of the six persons.');
    const at = now().toISOString();
    const checks = [0, 1, 2, 3, 4, 5].map((person) => {
      if (!persons(verb, tense).includes(person)) return null;
      const given = typeof input.answers[person] === 'string' ? input.answers[person]! : '';
      return { person, given, checked: result(verb, tense, person, given) };
    });
    if (input.again !== true) {
      if (input.looked === true) insertTable.run(requestId, verb.id, tense, checks.every((entry) => !entry || entry.checked.right) ? 1 : 0, at);
      else for (const entry of checks) if (entry) insert.run(`${requestId}:${entry.person}`, verb.id, tense, entry.person, 'table', null, entry.given.slice(0, 80), entry.checked.right ? 1 : 0, at);
    }
    const cells = checks.map((entry) => entry && { right: entry.checked.right, expected: entry.checked.expected, why: entry.checked.why, ...(entry.checked.hook ? { hook: entry.checked.hook } : {}) });
    return { cells, right: cells.filter((cell) => cell?.right).length, total: persons(verb, tense).length, rule: rule(verb, tense), paradigm: paradigm(verb, tense) };
  }

  // A By ear round from the phrases already recorded, in the tenses practised, the questions missed most first. "One
  // person or more" takes at most half the round, unless "Which tense?" can't be asked (one tense chosen).
  function earRound(input: RoundInput<T>): EarItem[] {
    const verbs = chosenVerbs(input), tenses = chosenTenses(input);
    const record = new Map(heard.all().map((row) => [row.question, row]));
    const pool = verbs.flatMap((verb) => earQuestions(verb, tenses).filter((question) => tenses.includes(question.tense)).flatMap((question) => {
      const audio = options.earAudio(question.said);
      const seen = record.get(question.id);
      return audio ? [{ question, audio, verbId: verb.id, weight: (seen?.misses ?? 0) * 2 - (seen?.answers ?? 0) * 0.5 + random() * 3 }] : [];
    }));
    if (!pool.length && !grammar.earAskable(tenses)) throw new StoreError(grammar.earNeeds, 409);
    if (!pool.length) throw new StoreError('The phrases for By ear are still being recorded on your Mac. Try again later.', 409);
    const numberCap = pool.some((entry) => entry.question.kind === 'tense') ? EAR_ROUND / 2 : EAR_ROUND;
    const picked: typeof pool = [];
    let numbers = 0;
    for (const entry of pool.sort((left, right) => right.weight - left.weight)) {
      if (picked.length >= EAR_ROUND) break;
      if (entry.question.kind === 'number' && numbers >= numberCap) continue;
      if (picked.some((other) => other.question.said === entry.question.said)) continue;
      if (entry.question.kind === 'number') numbers++;
      picked.push(entry);
    }
    return spread(picked.sort(() => random() - 0.5)).map(({ question, audio }) => ({ id: question.id, audio, question: question.question, choices: question.choices }));
  }

  // An answer is checked against the question as the round asked it: its tenses are the round's.
  function earAnswer(input: { requestId: string; id: string; choice: number; tenses?: unknown }) {
    const requestId = requestIdOf(input?.requestId);
    const [verbId, tense, person, kind] = typeof input?.id === 'string' ? input.id.split('~') : [];
    const found = findForm(verbId, tense, Number(person));
    const tenses = Array.isArray(input?.tenses) ? TENSES.filter((entry) => (input.tenses as unknown[]).includes(entry)) : [...TENSES];
    const question = kind === 'tense' || kind === 'number' ? earQuestion(found.verb, found.tense, found.person, kind as EarKind, tenses) : null;
    if (!question) throw new StoreError('That question is not in Echo.', 404);
    if (!Number.isInteger(input.choice) || input.choice < 0 || input.choice >= question.choices.length) throw new StoreError('Choose one of the answers.');
    const right = input.choice === question.answer;
    insert.run(requestId, found.verb.id, found.tense, found.person, 'ear', question.id, question.choices[input.choice]!, right ? 1 : 0, now().toISOString());
    return { right, answer: question.answer, said: question.said, why: question.why };
  }

  // What the Verbs room shows: which verbs are ready, every form's state, and the forms missed most.
  function summary() {
    const verbs = options.verbs();
    const forms = history();
    const words = new Map(options.vocabulary().map((word) => [word.id, word]));
    const rows = verbs.map((verb) => {
      const states = Object.fromEntries(TENSES.map((tense) => [tense, [0, 1, 2, 3, 4, 5].map((person) => persons(verb, tense).includes(person) ? stateOf(forms.get(key(verb.id, tense, person))) : null)])) as Record<T, (FormState | null)[]>;
      const word = words.get(verb.id);
      return { id: verb.id, inf: verb.inf, en: verb.en, started: !!word && word.status !== 'new', score: word?.score ?? 0, states };
    });
    const worst = verbs.flatMap((verb) => TENSES.flatMap((tense) => persons(verb, tense).flatMap((person) => {
      const answers = forms.get(key(verb.id, tense, person)) ?? [];
      const misses = answers.filter((right) => !right).length;
      if (!misses || (answers[0] && misses < 2)) return [];
      const form = conjugate(verb, tense)[person]!;
      return [{ verbId: verb.id, tense, tenseName: TENSE_NAMES[tense], person, form: subject(person, form.shown) + form.shown, misses, shaky: !answers[0] }];
    }))).sort((left, right) => Number(right.shaky) - Number(left.shaky) || right.misses - left.misses).slice(0, WORST);
    const ear = earPhrases();
    return { verbs: rows, worst, mine: rows.filter((row) => row.started).length, common: Math.min(COMMON, verbs.length), ear: { ready: ear.filter((said) => options.earAudio(said)).length, total: ear.length } };
  }

  // The Statistics page's Verbs part: every form's state now, the same counts at the end of each study day since the
  // first answer (rebuilt from the answers, as All your verbs reads them), and the share right in each tense over the
  // last two weeks, for each person and for each kind of verb (the groups of the tense pages). A form counts once
  // practised, in any mode but By ear.
  // The score side of Statistics: for each study day from the first answer (the last SCORE_DAYS), how many forms had
  // each score from -8 to +8 at its end (the ends hold everything beyond), and how many were solid or shaky; the
  // points gained and lost on each of the last 14 days; the average score by tense and by person; and the five
  // lowest-scoring forms.
  function scoreStatistics(verbs: Map<string, V>, today: string) {
    const rows = everyScored.all().filter((row) => verbs.has(row.verb_id));
    const days: { day: string; bins: number[]; solid: number; shaky: number; practised: number; sum: number }[] = [];
    if (rows.length) {
      let first = studyDay(new Date(rows[0]!.answered_at));
      const earliest = recentStudyDays(now(), SCORE_DAYS).days[0]!;
      if (first < earliest) first = earliest;
      for (let day = first; day <= today; day = nextDay(day)) {
        const { scores } = scoresAt(endOf(day), rows);
        const bins = Array.from({ length: 17 }, () => 0);
        let solid = 0, shaky = 0, sum = 0;
        for (const score of scores.values()) { bins[Math.max(-8, Math.min(8, Math.round(score))) + 8]! += 1; sum += score; if (score >= SOLID_AT) solid++; if (score <= SHAKY_AT) shaky++; }
        days.push({ day, bins, solid, shaky, practised: scores.size, sum: Math.round(sum) });
      }
    }
    const recent = recentStudyDays(now(), 14).days;
    const daily = recent.map((day) => ({ day, gained: 0, lost: 0 }));
    const byDay = new Map(daily.map((entry) => [entry.day, entry]));
    // What a miss costs depends on how far the form's answers had climbed (lib/score-points.ts).
    const events = rows.map((row) => ({ id: key(row.verb_id, row.tense, row.person), weight: points(row.mode, row.right), at: Date.parse(row.answered_at) }));
    pointsFromLowest(events).forEach((value, index) => {
      const entry = byDay.get(studyDay(new Date(events[index]!.at)));
      if (entry) { if (value > 0) entry.gained += value; else entry.lost -= value; }
    });
    // A Look, then write table counts as graded, a miss included, whatever came before.
    for (const row of everyTable.all()) {
      const entry = verbs.has(row.verb_id) ? byDay.get(studyDay(new Date(row.answered_at))) : undefined;
      if (entry) { if (row.perfect) entry.gained += TABLE_PERFECT; else entry.lost -= TABLE_MISSED; }
    }
    const { scores, misses } = scoresAt(now().getTime(), rows);
    const average = (match: (tense: string, person: number) => boolean) => {
      const list = [...scores].filter(([id]) => { const [, tense, person] = id.split('|'); return match(tense!, Number(person)); }).map(([, score]) => score);
      return { average: list.length ? Math.round(list.reduce((sum, score) => sum + score, 0) / list.length * 100) / 100 : null, forms: list.length };
    };
    const hardest = [...scores].sort((left, right) => left[1] - right[1]).slice(0, 5).map(([id, score]) => {
      const [verbId, tense, person] = id.split('|') as [string, T, string];
      const verb = verbs.get(verbId)!;
      return { verbId, tense, person: Number(person), form: formText(verb, tense, Number(person)), inf: verb.inf, tenseName: TENSE_NAMES[tense], score: Math.round(score * 10) / 10, misses: misses.get(id) ?? 0 };
    });
    return {
      days, points: daily,
      tenses: Object.fromEntries(TENSES.map((tense) => [tense, average((other) => other === tense)])) as Record<T, { average: number | null; forms: number }>,
      people: [0, 1, 2, 3, 4, 5].map((person) => average((_, other) => other === person)),
      hardest,
    };
  }
  // Every form practised by the end of `day`, with its score then, lowest first: the list behind a bar of the chart.
  function scoresOn(day: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new StoreError('Choose a day.');
    const verbs = byId();
    const { scores } = scoresAt(endOf(day), everyScored.all().filter((row) => verbs.has(row.verb_id)));
    return [...scores].sort((left, right) => left[1] - right[1]).map(([id, score]) => {
      const [verbId, tense, person] = id.split('|') as [string, T, string];
      const verb = verbs.get(verbId)!;
      return { verbId, tense, form: formText(verb, tense, Number(person)), inf: verb.inf, tenseName: TENSE_NAMES[tense], score: Math.round(score * 10) / 10 };
    });
  }

  function statistics() {
    const verbs = byId();
    const total = [...verbs.values()].reduce((sum, verb) => sum + TENSES.reduce((count, tense) => count + persons(verb, tense).length, 0), 0);
    const today = studyDay(now());
    const since = recentStudyDays(now(), 14).since.getTime();
    const answers = new Map<string, number[]>();
    const tenses = Object.fromEntries(TENSES.map((tense) => [tense, { right: 0, total: 0 }])) as Record<T, { right: number; total: number }>;
    const people = [0, 1, 2, 3, 4, 5].map(() => ({ right: 0, total: 0 }));
    const kinds = new Map<string, { tense: T; group: string; right: number; total: number }>();
    for (const row of everyWritten.all()) {
      if (!verbs.has(row.verb_id)) continue;
      const at = new Date(row.answered_at);
      const id = key(row.verb_id, row.tense, row.person);
      answers.set(id, [row.right, ...(answers.get(id) ?? [])].slice(0, 2));
      if (at.getTime() >= since) {
        const group = groupOf(verbs.get(row.verb_id)!, row.tense);
        const kind = kinds.get(`${row.tense}|${group}`) ?? kinds.set(`${row.tense}|${group}`, { tense: row.tense, group, right: 0, total: 0 }).get(`${row.tense}|${group}`)!;
        for (const cell of [tenses[row.tense], people[row.person]!, kind]) { cell.total += 1; cell.right += row.right; }
      }
    }
    const forms = { solid: 0, getting: 0, shaky: 0 };
    for (const list of answers.values()) forms[stateOf(list) as 'solid' | 'getting' | 'shaky'] += 1;
    return { forms: { ...forms, practised: answers.size, total }, scores: scoreStatistics(verbs, today), tenses, people, kinds: [...kinds.values()].sort((a, b) => b.total - a.total).map((kind) => ({ ...kind, title: GROUP_TITLES[kind.tense][kind.group] ?? kind.group })) };
  }

  // The Walkman's verb tape, for the most common verbs: every form of the chosen tenses, the lower its score the
  // likelier to come early, with what is said for each. Neighbours differ in verb wherever the rest allows it.
  function walkmanForms(tenses: T[]) {
    const chosen = TENSES.filter((tense) => tenses.includes(tense));
    if (!chosen.length) throw new StoreError('Choose at least one tense.');
    const { scores } = scoresAt(now().getTime());
    const pool = options.verbs().slice(0, COMMON).flatMap((verb) => chosen.flatMap((tense) => persons(verb, tense).map((person) => {
      const form = conjugate(verb, tense)[person]!;
      // Weighted order without replacement: each key is random^(1/weight), highest first.
      return { verbId: verb.id, verb, tense, person, said: subject(person, form.accepted[0]!) + form.accepted[0], shown: subject(person, form.shown) + form.shown, key: random() ** (1 / pull(scores.get(key(verb.id, tense, person)))) };
    })));
    return spread(pool.sort((a, b) => b.key - a.key));
  }
  // What the verb tape records: the four tense names, the six persons and every form of the most common verbs.
  function walkmanPhrases(): { french: string[]; english: string[] } {
    const french = options.verbs().slice(0, COMMON).flatMap((verb) => TENSES.flatMap((tense) => persons(verb, tense).map((person) => { const form = conjugate(verb, tense)[person]!.accepted[0]!; return subject(person, form) + form; })));
    return { french: [...TENSES.map((tense) => TENSE_NAMES[tense]), ...new Set(french)], english: [...WALKMAN_PERSONS_SAID] };
  }

  // The phrases By ear says, for the verbs it can ask about (the most common and those started), to be recorded.
  function earPhrases(): string[] {
    const verbs = options.verbs();
    const started = new Set(options.vocabulary().filter((word) => word.status !== 'new').map((word) => word.id));
    return [...new Set(verbs.filter((verb, index) => index < COMMON || started.has(verb.id)).flatMap((verb) => earQuestions(verb).map((question) => question.said)))];
  }
  // The verbs and tenses the Practising line picks, for drills kept outside this module (How it's built).
  const practising = (input: RoundInput<T>) => ({ verbs: chosenVerbs(input), tenses: chosenTenses(input) });

  return { round, cards, mark, formScores, nextTable, statistics, scoresOn, walkmanForms, walkmanPhrases, answer, table, earRound, earAnswer, summary, earPhrases, shaky, hookless, setHooks, practising, close: () => db.close() };
}
export type VerbDrills = ReturnType<typeof createVerbDrills<Verb, Tense>>;
