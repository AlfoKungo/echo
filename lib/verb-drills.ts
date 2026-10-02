// The Verbs room's record and rounds: every answer to a form (a verb in one tense for one person), from Quick forms,
// Whole table, Cards (the learner says whether they knew it) or By ear, kept once per request. A form's state comes from its latest answers (By ear is kept apart:
// it tests hearing, not writing), and a round leans on the forms that are shaky or not tried yet.
import { Database } from 'bun:sqlite';
import { recentStudyDays, SCORE_HALF_LIFE_DAYS, StoreError, studyDay } from './store';
import { accentSlip, conjugate, diagnose, earQuestion, earQuestions, GROUP_TITLES, groupOf, isRight, paradigm, persons, rule, subject, TENSES, TENSE_NAMES, type EarKind, type ParadigmRow, type Tense, type Verb } from './verbs';

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
// A form's score: +2 for a typed answer right and -3 wrong (Quick forms, each cell of a whole table); +1 or -2 for a
// Cards or Walkman mark, the learner's own say. By ear asks about a tense or a number, not one form, and counts for
// none. Every point halves over SCORE_HALF_LIFE_DAYS, as a word's does.
const points = (mode: string, right: number) => mode === 'card' ? (right ? 1 : -2) : (right ? 2 : -3);
// Every drill picks a form with odds 2^(-score/PULL), the score held within ±LIMIT, as the Walkman picks words: an
// untried form at 0, one missed once about three times as likely, one known twice in a row about a fifth as likely.
const PULL = 1.7;
const LIMIT = 8;
const pull = (score: number | undefined) => 2 ** (-Math.max(-LIMIT, Math.min(LIMIT, score ?? 0)) / PULL);
// On the score chart: at or above SOLID_AT is solid, at or below SHAKY_AT shaky; the chart keeps SCORE_DAYS days.
const SOLID_AT = 3;
const SHAKY_AT = -2;
const SCORE_DAYS = 60;
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
  const everyScored = db.query<{ verb_id: string; tense: Tense; person: number; mode: string; right: number; answered_at: string }, []>("SELECT verb_id, tense, person, mode, right, answered_at FROM verb_answers WHERE mode != 'ear' ORDER BY sequence");
  const everyWritten = db.query<{ verb_id: string; tense: Tense; person: number; right: number; answered_at: string }, []>("SELECT verb_id, tense, person, right, answered_at FROM verb_answers WHERE mode != 'ear' ORDER BY sequence");
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
  const formText = (verb: Verb, tense: Tense, person: number) => { const form = conjugate(verb, tense)[person]!; return subject(person, form.shown) + form.shown; };
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
    const { scores } = scoresAt(now().getTime());
    const score = new Map(options.vocabulary().map((word) => [word.id, word.score]));
    // Weighted order without replacement: each key is random^(1/weight), highest first. Among your own verbs, a
    // verb whose word is shaky in Vocabulary leans a little earlier.
    const pool = verbs.flatMap((verb) => tenses.flatMap((tense) => persons(verb).map((person) => {
      const lean = input.set === 'mine' ? 2 ** (-Math.max(-4, Math.min(4, score.get(verb.id) ?? 0)) / 4) : 1;
      return { verb, tense, person, weight: random() ** (1 / (pull(scores.get(key(verb.id, tense, person))) * lean)) };
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
    const expected = subject(person, form.shown) + form.shown;
    const why = right ? (accentSlip(form, given) ? `Right — with the accents: ${expected}.` : '') : !given.trim() ? '' : diagnose(verb, tense, person, given);
    return { right, expected, why, rule: rule(verb, tense), paradigm: paradigm(verb, tense) };
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

  // A Cards round: the same forms as Quick forms, each with its answer, so the card can turn over at once.
  function cards(input: RoundInput) {
    const verbs = byId();
    return round(input).map((item) => {
      const verb = verbs.get(item.verbId)!;
      const form = conjugate(verb, item.tense)[item.person]!;
      return { ...item, answer: subject(item.person, form.shown) + form.shown, rule: rule(verb, item.tense), paradigm: paradigm(verb, item.tense) };
    });
  }
  // The learner's own say on a card: counts for the form like a typed answer, once per request id.
  function mark(input: { requestId: string; verbId: string; tense: Tense; person: number; knew: boolean }) {
    const requestId = requestIdOf(input?.requestId);
    const { verb, tense, person } = findForm(input?.verbId, input?.tense, input?.person);
    if (typeof input.knew !== 'boolean') throw new StoreError('Say whether you knew it.');
    insert.run(requestId, verb.id, tense, person, 'card', null, '', input.knew ? 1 : 0, now().toISOString());
    return { ok: true };
  }

  // A whole table at once: every person checked, a blank one counted as not known.
  // The next whole table to fill in: one verb in one tense from the chosen verbs and tenses, drawn with odds of its
  // forms' average odds (see pull), so a table with low-scoring forms comes far more often than a solid one. exclude
  // lists the tables just done ("verbId|tense", newest first); it is halved until something is left.
  function nextTable(input: RoundInput & { exclude?: string[] }): { verbId: string; tense: Tense } {
    const verbs = chosenVerbs(input), tenses = chosenTenses(input);
    const { scores } = scoresAt(now().getTime());
    const pool = verbs.flatMap((verb) => tenses.map((tense) => {
      const people = persons(verb);
      const weight = people.reduce((total, person) => total + pull(scores.get(key(verb.id, tense, person))), 0) / people.length;
      return { verbId: verb.id, tense, weight };
    }));
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

  // The Statistics page's Verbs part: every form's state now, the same counts at the end of each study day since the
  // first answer (rebuilt from the answers, as the verb map reads them), and the share right in each tense over the
  // last two weeks, for each person and for each kind of verb (the groups of the tense pages). A form counts once
  // practised, in any mode but By ear.
  // The score side of Statistics: for each study day from the first answer (the last SCORE_DAYS), how many forms had
  // each score from -8 to +8 at its end (the ends hold everything beyond), and how many were solid or shaky; the
  // points gained and lost on each of the last 14 days; the average score by tense and by person; and the five
  // lowest-scoring forms.
  function scoreStatistics(verbs: Map<string, Verb>, today: string) {
    const rows = everyScored.all().filter((row) => verbs.has(row.verb_id));
    const days: { day: string; bins: number[]; solid: number; shaky: number; practised: number }[] = [];
    if (rows.length) {
      let first = studyDay(new Date(rows[0]!.answered_at));
      const earliest = recentStudyDays(now(), SCORE_DAYS).days[0]!;
      if (first < earliest) first = earliest;
      for (let day = first; day <= today; day = nextDay(day)) {
        const { scores } = scoresAt(endOf(day), rows);
        const bins = Array.from({ length: 17 }, () => 0);
        let solid = 0, shaky = 0;
        for (const score of scores.values()) { bins[Math.max(-8, Math.min(8, Math.round(score))) + 8]! += 1; if (score >= SOLID_AT) solid++; if (score <= SHAKY_AT) shaky++; }
        days.push({ day, bins, solid, shaky, practised: scores.size });
      }
    }
    const recent = recentStudyDays(now(), 14).days;
    const daily = recent.map((day) => ({ day, gained: 0, lost: 0 }));
    const byDay = new Map(daily.map((entry) => [entry.day, entry]));
    for (const row of rows) { const entry = byDay.get(studyDay(new Date(row.answered_at))); if (!entry) continue; const value = points(row.mode, row.right); if (value > 0) entry.gained += value; else entry.lost -= value; }
    const { scores, misses } = scoresAt(now().getTime(), rows);
    const average = (match: (tense: string, person: number) => boolean) => {
      const list = [...scores].filter(([id]) => { const [, tense, person] = id.split('|'); return match(tense!, Number(person)); }).map(([, score]) => score);
      return { average: list.length ? Math.round(list.reduce((sum, score) => sum + score, 0) / list.length * 100) / 100 : null, forms: list.length };
    };
    const hardest = [...scores].sort((left, right) => left[1] - right[1]).slice(0, 5).map(([id, score]) => {
      const [verbId, tense, person] = id.split('|') as [string, Tense, string];
      const verb = verbs.get(verbId)!;
      return { verbId, tense, person: Number(person), form: formText(verb, tense, Number(person)), inf: verb.inf, tenseName: TENSE_NAMES[tense], score: Math.round(score * 10) / 10, misses: misses.get(id) ?? 0 };
    });
    return {
      days, points: daily,
      tenses: Object.fromEntries(TENSES.map((tense) => [tense, average((other) => other === tense)])) as Record<Tense, { average: number | null; forms: number }>,
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
      const [verbId, tense, person] = id.split('|') as [string, Tense, string];
      const verb = verbs.get(verbId)!;
      return { verbId, tense, form: formText(verb, tense, Number(person)), inf: verb.inf, tenseName: TENSE_NAMES[tense], score: Math.round(score * 10) / 10 };
    });
  }

  function statistics() {
    const verbs = byId();
    const total = [...verbs.values()].reduce((sum, verb) => sum + persons(verb).length * TENSES.length, 0);
    const today = studyDay(now());
    const since = recentStudyDays(now(), 14).since.getTime();
    const answers = new Map<string, number[]>();
    const tenses = Object.fromEntries(TENSES.map((tense) => [tense, { right: 0, total: 0 }])) as Record<Tense, { right: number; total: number }>;
    const people = [0, 1, 2, 3, 4, 5].map(() => ({ right: 0, total: 0 }));
    const kinds = new Map<string, { tense: Tense; group: string; right: number; total: number }>();
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
  function walkmanForms(tenses: Tense[]) {
    const chosen = TENSES.filter((tense) => tenses.includes(tense));
    if (!chosen.length) throw new StoreError('Choose at least one tense.');
    const { scores } = scoresAt(now().getTime());
    const pool = options.verbs().slice(0, COMMON).flatMap((verb) => chosen.flatMap((tense) => persons(verb).map((person) => {
      const form = conjugate(verb, tense)[person]!;
      // Weighted order without replacement: each key is random^(1/weight), highest first.
      return { verbId: verb.id, verb, tense, person, said: subject(person, form.accepted[0]!) + form.accepted[0], shown: subject(person, form.shown) + form.shown, key: random() ** (1 / pull(scores.get(key(verb.id, tense, person)))) };
    })));
    return spread(pool.sort((a, b) => b.key - a.key));
  }
  // What the verb tape records: the four tense names, the six persons and every form of the most common verbs.
  function walkmanPhrases(): { french: string[]; english: string[] } {
    const french = options.verbs().slice(0, COMMON).flatMap((verb) => TENSES.flatMap((tense) => persons(verb).map((person) => { const form = conjugate(verb, tense)[person]!.accepted[0]!; return subject(person, form) + form; })));
    return { french: [...TENSES.map((tense) => TENSE_NAMES[tense]), ...new Set(french)], english: [...WALKMAN_PERSONS_SAID] };
  }

  // The phrases By ear says, for the verbs it can ask about (the most common and those started), to be recorded.
  function earPhrases(): string[] {
    const verbs = options.verbs();
    const started = new Set(options.vocabulary().filter((word) => word.status !== 'new').map((word) => word.id));
    return [...new Set(verbs.filter((verb, index) => index < COMMON || started.has(verb.id)).flatMap((verb) => earQuestions(verb).map((question) => question.said)))];
  }

  return { round, cards, mark, nextTable, statistics, scoresOn, walkmanForms, walkmanPhrases, answer, table, earRound, earAnswer, summary, earPhrases, close: () => db.close() };
}
export type VerbDrills = ReturnType<typeof createVerbDrills>;
