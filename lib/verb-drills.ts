// The Verbs room's record and rounds: every answer to a form (a verb in one tense for one person), from Quick forms,
// Whole table or By ear, kept once per request. A form's state comes from its latest answers (By ear is kept apart:
// it tests hearing, not writing), and a round leans on the forms that are shaky or not tried yet.
import { Database } from 'bun:sqlite';
import { StoreError } from './store';
import { conjugate, diagnose, earQuestion, earQuestions, isRight, paradigm, persons, rule, subject, TENSES, TENSE_NAMES, type EarKind, type ParadigmRow, type Tense, type Verb } from './verbs';

export type FormState = 'solid' | 'getting' | 'shaky' | 'new';
export type VerbSet = 'mine' | 'common' | 'chosen';
export type RoundInput = { set: VerbSet; verbIds?: string[]; tenses: Tense[] };
export type RoundItem = { verbId: string; inf: string; en: string; tense: Tense; tenseName: string; person: number };
export type FormResult = { right: boolean; expected: string; why: string; rule: string; paradigm: ParadigmRow[] };
export type EarItem = { id: string; audio: string; question: string; choices: string[] };

const ROUND = 20;
const EAR_ROUND = 10;
const COMMON = 20;
const WORST = 6;
const PER_VERB = 3;
const PER_TENSE = 2;
const WEIGHT: Record<FormState, number> = { shaky: 6, new: 3, getting: 2, solid: 0.5 };

export function createVerbDrills(options: {
  dbPath: string;
  verbs: () => Verb[];
  // Each vocabulary word's status and score, for "your verbs".
  vocabulary: () => { id: string; status: string; score: number }[];
  // The recording of a phrase said By ear, or null until it has been made.
  earAudio: (said: string) => string | null;
  now?: () => Date; random?: () => number;
}) {
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
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
  `);
  const insert = db.query('INSERT OR IGNORE INTO verb_answers (request_id, verb_id, tense, person, mode, question, given, right, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const written = db.query<{ verb_id: string; tense: Tense; person: number; right: number }, []>("SELECT verb_id, tense, person, right FROM verb_answers WHERE mode != 'ear' ORDER BY sequence DESC");
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
  function chosenVerbs(input: RoundInput): Verb[] {
    const verbs = options.verbs();
    if (input?.set === 'mine') {
      const started = new Map(options.vocabulary().filter((word) => word.status !== 'new').map((word) => [word.id, word.score]));
      const mine = verbs.filter((verb) => started.has(verb.id));
      if (!mine.length) throw new StoreError('None of your started words is a verb with its table ready yet. Choose Most common for now.', 409);
      return mine;
    }
    if (input?.set === 'common') return verbs.slice(0, COMMON);
    if (input?.set === 'chosen') {
      const found = byId();
      const picked = (Array.isArray(input.verbIds) ? input.verbIds : []).flatMap((id) => { const verb = found.get(id); return verb ? [verb] : []; });
      if (!picked.length) throw new StoreError('Choose at least one verb.');
      return picked;
    }
    throw new StoreError('Choose which verbs to practise: yours, the most common, or your own pick.');
  }
  function chosenTenses(input: RoundInput): Tense[] {
    const tenses = Array.isArray(input?.tenses) ? TENSES.filter((tense) => input.tenses.includes(tense)) : [];
    if (!tenses.length) throw new StoreError('Choose at least one tense.');
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

  // A Quick forms round: the forms most worth practising (shaky first, then untried), spread so a round of many
  // verbs covers several (at most three forms per verb, two per verb and tense); for your verbs, low vocabulary scores weigh a little.
  function round(input: RoundInput): RoundItem[] {
    const verbs = chosenVerbs(input), tenses = chosenTenses(input);
    const forms = history();
    const score = new Map(options.vocabulary().map((word) => [word.id, word.score]));
    const pool = verbs.flatMap((verb) => tenses.flatMap((tense) => persons(verb).map((person) => {
      const lean = input.set === 'mine' ? (2 - Math.max(-4, Math.min(4, score.get(verb.id) ?? 0))) * 0.25 : 0;
      return { verb, tense, person, weight: WEIGHT[stateOf(forms.get(key(verb.id, tense, person)))] + lean + random() * 2.5 };
    })));
    // With few verbs chosen, each may fill more of the round: one verb alone can give all its forms.
    const verbCap = Math.max(PER_VERB, Math.ceil(ROUND / verbs.length)), tenseCap = Math.max(PER_TENSE, Math.ceil(verbCap / tenses.length));
    const perVerb = new Map<string, number>(), perTense = new Map<string, number>();
    const picked: RoundItem[] = [];
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

  function findTense(verbId: unknown, tense: unknown): { verb: Verb; tense: Tense } {
    const verb = typeof verbId === 'string' ? byId().get(verbId) : undefined;
    if (!verb) throw new StoreError('That verb is not in Echo.', 404);
    if (!TENSES.includes(tense as Tense)) throw new StoreError('Choose a tense Echo drills.');
    return { verb, tense: tense as Tense };
  }
  function findForm(verbId: unknown, tense: unknown, person: unknown): { verb: Verb; tense: Tense; person: number } {
    const { verb } = findTense(verbId, tense);
    if (!Number.isInteger(person) || !persons(verb).includes(person as number)) throw new StoreError(`${verb.inf} has no such person.`);
    return { verb, tense: tense as Tense, person: person as number };
  }
  function result(verb: Verb, tense: Tense, person: number, given: string): FormResult {
    const form = conjugate(verb, tense)[person]!;
    const right = isRight(form, given);
    return { right, expected: subject(person, form.shown) + form.shown, why: right || !given.trim() ? '' : diagnose(verb, tense, person, given), rule: rule(verb, tense), paradigm: paradigm(verb, tense) };
  }
  const requestIdOf = (value: unknown) => {
    if (typeof value !== 'string' || !value) throw new StoreError('This answer is missing its request ID.');
    return value;
  };

  // One typed form, checked and kept once per request id.
  function answer(input: { requestId: string; verbId: string; tense: Tense; person: number; given: string }): FormResult {
    const requestId = requestIdOf(input?.requestId);
    const { verb, tense, person } = findForm(input.verbId, input.tense, input.person);
    if (typeof input.given !== 'string' || !input.given.trim()) throw new StoreError('Type the form first.');
    const checked = result(verb, tense, person, input.given);
    insert.run(requestId, verb.id, tense, person, 'form', null, input.given.slice(0, 80), checked.right ? 1 : 0, now().toISOString());
    return checked;
  }

  // A whole table at once: every person checked, a blank one counted as not known.
  function table(input: { requestId: string; verbId: string; tense: Tense; answers: string[] }) {
    const requestId = requestIdOf(input?.requestId);
    const { verb, tense } = findTense(input?.verbId, input?.tense);
    if (!Array.isArray(input.answers) || input.answers.length !== 6) throw new StoreError('Send an answer for each of the six persons.');
    const at = now().toISOString();
    const cells = [0, 1, 2, 3, 4, 5].map((person) => {
      if (!persons(verb).includes(person)) return null;
      const given = typeof input.answers[person] === 'string' ? input.answers[person]! : '';
      const checked = result(verb, tense, person, given);
      insert.run(`${requestId}:${person}`, verb.id, tense, person, 'table', null, given.slice(0, 80), checked.right ? 1 : 0, at);
      return { right: checked.right, expected: checked.expected, why: checked.why };
    });
    return { cells, right: cells.filter((cell) => cell?.right).length, total: persons(verb).length, rule: rule(verb, tense), paradigm: paradigm(verb, tense) };
  }

  // A By ear round from the phrases already recorded, the questions missed most first, at most half of them
  // "one person or more".
  function earRound(input: RoundInput): EarItem[] {
    const verbs = chosenVerbs(input), tenses = chosenTenses(input);
    const record = new Map(heard.all().map((row) => [row.question, row]));
    const pool = verbs.flatMap((verb) => earQuestions(verb).filter((question) => tenses.includes(question.tense)).flatMap((question) => {
      const audio = options.earAudio(question.said);
      const seen = record.get(question.id);
      return audio ? [{ question, audio, verbId: verb.id, weight: (seen?.misses ?? 0) * 2 - (seen?.answers ?? 0) * 0.5 + random() * 3 }] : [];
    }));
    if (!pool.length) throw new StoreError('The phrases for By ear are still being recorded on your Mac. Try again later.', 409);
    const picked: typeof pool = [];
    let numbers = 0;
    for (const entry of pool.sort((left, right) => right.weight - left.weight)) {
      if (picked.length >= EAR_ROUND) break;
      if (entry.question.kind === 'number' && numbers >= EAR_ROUND / 2) continue;
      if (picked.some((other) => other.question.said === entry.question.said)) continue;
      if (entry.question.kind === 'number') numbers++;
      picked.push(entry);
    }
    return spread(picked.sort(() => random() - 0.5)).map(({ question, audio }) => ({ id: question.id, audio, question: question.question, choices: question.choices }));
  }

  function earAnswer(input: { requestId: string; id: string; choice: number }) {
    const requestId = requestIdOf(input?.requestId);
    const [verbId, tense, person, kind] = typeof input?.id === 'string' ? input.id.split('~') : [];
    const found = findForm(verbId, tense, Number(person));
    const question = kind === 'tense' || kind === 'number' ? earQuestion(found.verb, found.tense, found.person, kind as EarKind) : null;
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
      const states = Object.fromEntries(TENSES.map((tense) => [tense, [0, 1, 2, 3, 4, 5].map((person) => persons(verb).includes(person) ? stateOf(forms.get(key(verb.id, tense, person))) : null)])) as Record<Tense, (FormState | null)[]>;
      const word = words.get(verb.id);
      return { id: verb.id, inf: verb.inf, en: verb.en, started: !!word && word.status !== 'new', score: word?.score ?? 0, states };
    });
    const worst = verbs.flatMap((verb) => TENSES.flatMap((tense) => persons(verb).flatMap((person) => {
      const answers = forms.get(key(verb.id, tense, person)) ?? [];
      const misses = answers.filter((right) => !right).length;
      if (!misses || (answers[0] && misses < 2)) return [];
      const form = conjugate(verb, tense)[person]!;
      return [{ verbId: verb.id, tense, tenseName: TENSE_NAMES[tense], person, form: subject(person, form.shown) + form.shown, misses, shaky: !answers[0] }];
    }))).sort((left, right) => Number(right.shaky) - Number(left.shaky) || right.misses - left.misses).slice(0, WORST);
    const ear = earPhrases();
    return { verbs: rows, worst, mine: rows.filter((row) => row.started).length, common: Math.min(COMMON, verbs.length), ear: { ready: ear.filter((said) => options.earAudio(said)).length, total: ear.length } };
  }

  // The phrases By ear says, for the verbs it can ask about (the most common and those started), to be recorded.
  function earPhrases(): string[] {
    const verbs = options.verbs();
    const started = new Set(options.vocabulary().filter((word) => word.status !== 'new').map((word) => word.id));
    return [...new Set(verbs.filter((verb, index) => index < COMMON || started.has(verb.id)).flatMap((verb) => earQuestions(verb).map((question) => question.said)))];
  }

  return { round, answer, table, earRound, earAnswer, summary, earPhrases, close: () => db.close() };
}
export type VerbDrills = ReturnType<typeof createVerbDrills>;
