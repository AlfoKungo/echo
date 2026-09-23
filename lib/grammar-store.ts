import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  GrammarAnswerInput, GrammarExercise, GrammarFeedback, GrammarHelpInput, GrammarMode, GrammarMutation,
  GrammarResult, GrammarScopeKind, GrammarSession, GrammarSnapshot, GrammarTestSummary, GrammarTopic,
  GrammarTopicContent, GrammarUnitContent, GrammarUnitView,
} from '../contract';
import { classify, joinTokens, normalize, validateCourse, type Course } from './grammar-content';
import { StoreError } from './store';

export interface GrammarStore {
  catalog(): GrammarUnitView[];
  state(scope: string): GrammarSnapshot;
  start(scope: string, requestId: string): GrammarSnapshot;
  answer(input: GrammarAnswerInput): GrammarSnapshot;
  help(input: GrammarHelpInput): GrammarSnapshot;
  next(input: GrammarMutation): GrammarSnapshot;
  exportData(): unknown;
  close(): void;
}

const PRACTICE_SIZE = 10;
const TOPIC_TEST_SIZE = 15;
const UNIT_TEST_SIZE = 20;
const PATTERN_CAP = 3;
const MIN_TYPES = 3;

type Outcome = GrammarResult['outcome'];
type StoredExercise = {
  topicId: string;
  content: GrammarExercise;
  answer: string;
  tokenOrder: number[];
  attempts: number;
  assisted: boolean;
  hint: string | null;
  feedback: GrammarFeedback | null;
  settled: boolean;
  help: GrammarHelpInput['kind'][];
  outcome: Outcome | null;
  misses: string[];
};
type Round = { mode: GrammarMode; version: number; index: number; exercises: StoredExercise[] };
type Picked = { topicId: string; content: GrammarExercise };
type Scope = { key: string; kind: GrammarScopeKind; topic?: GrammarTopicContent; unit?: GrammarUnitContent };
type SessionRow = { sequence: number; id: string; topic_id: string; round_json: string; created_at: string; updated_at: string };
type RequestRow = { sequence: number; request_id: string; action: string; payload_json: string; topic_id: string; created_at: string };
type ProgressRow = { topic_id: string; exercise_id: string; last_seen: number; outcome: Outcome | null; settled_in: GrammarMode | null };
type TestRow = { sequence: number; scope: string; session_id: string; score: number; total: number; finished_at: string };
type Lookup = { progress(topicId: string): ProgressRow[]; active(key: string): boolean; tests(key: string): TestRow[] };

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

// Neighbours differ in key wherever the remaining items still allow it; otherwise the given (priority) order wins.
function interleave<T>(items: T[], key: (item: T) => string): T[] {
  const rest = [...items];
  const ordered: T[] = [];
  let previous: string | null = null;
  const arrangeable = (remaining: T[], last: string) => {
    const half = remaining.length / 2;
    for (const [value, count] of countBy(remaining, key)) if (count > (value === last ? Math.floor(half) : Math.ceil(half))) return false;
    return true;
  };
  while (rest.length) {
    let index = rest.findIndex((item, at) => key(item) !== previous && arrangeable(rest.filter((_, other) => other !== at), key(item)));
    if (index < 0) index = rest.findIndex((item) => key(item) !== previous);
    const [item] = rest.splice(Math.max(index, 0), 1);
    ordered.push(item!);
    previous = key(item!);
  }
  return ordered;
}

function testSummary(rows: TestRow[]): GrammarTestSummary {
  let best: GrammarTestSummary['best'] = null;
  for (const row of rows) if (!best || row.score * best.total > best.score * row.total) best = { score: row.score, total: row.total };
  const last = rows.at(-1);
  return { taken: rows.length, best, last: last ? { score: last.score, total: last.total, finishedAt: last.finished_at } : null };
}

export function createGrammarStore(course: Course, options: { dbPath?: string; now?: () => Date; random?: () => number } = {}): GrammarStore {
  validateCourse(course);
  const { units, topics } = course;
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const exerciseIds = new Map(topics.map((topic) => [topic.id, new Set(topic.exercises.map((exercise) => exercise.id))]));
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const dbPath = options.dbPath ?? './data/echo.db';
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grammar_sessions (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        topic_id TEXT NOT NULL,
        round_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS grammar_sessions_topic ON grammar_sessions(topic_id, sequence DESC);
      CREATE TABLE IF NOT EXISTS grammar_requests (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        action TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        topic_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS grammar_progress (
        topic_id TEXT NOT NULL,
        exercise_id TEXT NOT NULL,
        last_seen INTEGER NOT NULL REFERENCES grammar_requests(sequence),
        outcome TEXT CHECK (outcome IN ('independent', 'helped', 'revisit')),
        PRIMARY KEY (topic_id, exercise_id)
      );
      CREATE TABLE IF NOT EXISTS grammar_tests (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        session_id TEXT NOT NULL UNIQUE,
        score INTEGER NOT NULL,
        total INTEGER NOT NULL,
        finished_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS grammar_tests_scope ON grammar_tests(scope, sequence);
    `);
    // settled_in says whether the latest outcome came from practice or a test, so missed test items return first.
    const columns = db.query<{ name: string }, []>('PRAGMA table_info(grammar_progress)').all();
    if (!columns.some((column) => column.name === 'settled_in')) db.exec('ALTER TABLE grammar_progress ADD COLUMN settled_in TEXT');
  }).immediate();

  // The topic_id column of sessions and requests holds the scope key; progress rows always hold a real topic ID.
  const latestSession = db.query<SessionRow, [string]>('SELECT * FROM grammar_sessions WHERE topic_id = ? ORDER BY sequence DESC LIMIT 1');
  const sessionById = db.query<SessionRow, [string]>('SELECT * FROM grammar_sessions WHERE id = ?');
  const requestById = db.query<RequestRow, [string]>('SELECT * FROM grammar_requests WHERE request_id = ?');
  const topicProgress = db.query<ProgressRow, [string]>('SELECT * FROM grammar_progress WHERE topic_id = ?');
  const activeExpression = "json_extract(round_json, '$.index') < json_array_length(round_json, '$.exercises')";
  const activeByKey = db.query<{ active: number }, [string]>(`SELECT ${activeExpression} AS active FROM grammar_sessions WHERE topic_id = ? ORDER BY sequence DESC LIMIT 1`);
  const testsByScope = db.query<TestRow, [string]>('SELECT * FROM grammar_tests WHERE scope = ? ORDER BY sequence');
  const appendRequest = db.query<{ sequence: number }, [string, string, string, string, string]>(`
    INSERT INTO grammar_requests (request_id, action, payload_json, topic_id, created_at)
    VALUES (?, ?, ?, ?, ?) RETURNING sequence
  `);
  const insertSession = db.query('INSERT INTO grammar_sessions (id, topic_id, round_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
  const saveSession = db.query('UPDATE grammar_sessions SET round_json = ?, updated_at = ? WHERE id = ?');
  const expose = db.query(`
    INSERT INTO grammar_progress (topic_id, exercise_id, last_seen, outcome) VALUES (?, ?, ?, NULL)
    ON CONFLICT (topic_id, exercise_id) DO UPDATE SET last_seen = excluded.last_seen
  `);
  const settleProgress = db.query(`
    INSERT INTO grammar_progress (topic_id, exercise_id, last_seen, outcome, settled_in) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (topic_id, exercise_id) DO UPDATE SET outcome = excluded.outcome, settled_in = excluded.settled_in
  `);
  const recordTest = db.query('INSERT INTO grammar_tests (scope, session_id, score, total, finished_at) VALUES (?, ?, ?, ?, ?)');

  const direct: Lookup = {
    progress: (topicId) => topicProgress.all(topicId),
    active: (key) => !!activeByKey.get(key)?.active,
    tests: (key) => testsByScope.all(key),
  };
  function bulk(): Lookup {
    const progress = Map.groupBy(db.query<ProgressRow, []>('SELECT * FROM grammar_progress').all(), (row) => row.topic_id);
    const active = new Map(db.query<{ topic_id: string; active: number }, []>(`
      SELECT topic_id, ${activeExpression} AS active FROM grammar_sessions
      WHERE sequence IN (SELECT MAX(sequence) FROM grammar_sessions GROUP BY topic_id)
    `).all().map((row) => [row.topic_id, !!row.active]));
    const tests = Map.groupBy(db.query<TestRow, []>('SELECT * FROM grammar_tests ORDER BY sequence').all(), (row) => row.scope);
    return { progress: (topicId) => progress.get(topicId) ?? [], active: (key) => active.get(key) ?? false, tests: (key) => tests.get(key) ?? [] };
  }

  function scopeOf(key: unknown): Scope {
    if (typeof key === 'string') {
      if (key.startsWith('unit:')) {
        const unit = unitById.get(key.slice(5));
        if (unit) return { key, kind: 'unit-test', unit };
      } else if (key.startsWith('test:')) {
        const topic = topicById.get(key.slice(5));
        if (topic) return { key, kind: 'topic-test', topic };
      } else {
        const topic = topicById.get(key);
        if (topic) return { key, kind: 'practice', topic };
      }
    }
    throw new StoreError('That grammar topic or unit does not exist.', 404);
  }

  // Rounds saved before tests existed have no mode, topicId or misses: they are practice rounds of their key's topic.
  function loadRound(row: SessionRow): Round {
    const round = JSON.parse(row.round_json) as Omit<Round, 'mode'> & { mode?: GrammarMode };
    return {
      ...round, mode: round.mode ?? 'practice',
      exercises: round.exercises.map((item) => ({ ...item, topicId: item.topicId ?? row.topic_id, misses: item.misses ?? [] })),
    };
  }

  function topicView(topic: GrammarTopicContent, lookup: Lookup): GrammarTopic {
    const { exercises, ...content } = topic;
    const ids = exerciseIds.get(topic.id)!;
    const progress = { seen: 0, independent: 0, needsReview: 0 };
    for (const record of lookup.progress(topic.id)) {
      if (!ids.has(record.exercise_id)) continue;
      progress.seen += 1;
      if (record.outcome === 'independent') progress.independent += 1;
      else if (record.outcome) progress.needsReview += 1;
    }
    return {
      ...content, exerciseCount: exercises.length,
      practiceLength: Math.min(PRACTICE_SIZE, exercises.length), testLength: Math.min(TOPIC_TEST_SIZE, exercises.length),
      progress, hasActiveSession: lookup.active(topic.id), hasActiveTest: lookup.active(`test:${topic.id}`), test: testSummary(lookup.tests(`test:${topic.id}`)),
    };
  }

  function unitView(unit: GrammarUnitContent, lookup: Lookup): GrammarUnitView {
    const views = unit.topics.map((id) => topicView(topicById.get(id)!, lookup));
    return {
      id: unit.id, title: unit.title, description: unit.description, topics: views,
      testLength: Math.min(UNIT_TEST_SIZE, views.reduce((total, topic) => total + topic.exerciseCount, 0)),
      hasActiveTest: lookup.active(`unit:${unit.id}`), test: testSummary(lookup.tests(`unit:${unit.id}`)),
    };
  }

  function topicTitle(topicId: string): string {
    return topicById.get(topicId)?.title ?? topicId;
  }

  function sessionView(row: SessionRow): GrammarSession {
    const round = loadRound(row);
    const current = round.exercises[round.index];
    const results: GrammarResult[] = round.exercises.filter((item) => item.settled).map((item) => ({
      exerciseId: item.content.id, topicId: item.topicId, topicTitle: topicTitle(item.topicId), type: item.content.type,
      source: item.content.source, answer: item.content.answers[0]!, given: item.answer, outcome: item.outcome!,
      ...(item.feedback?.spelling ? { spelling: true } : {}),
    }));
    const exercise = current?.content;
    return {
      id: row.id, mode: round.mode, version: round.version, index: round.index, total: round.exercises.length,
      complete: !current,
      current: current && exercise ? {
        exercise: {
          id: exercise.id, type: exercise.type, instruction: exercise.instruction, source: exercise.source,
          ...(exercise.tokens ? { tokens: exercise.tokens } : {}), ...(exercise.options ? { options: exercise.options } : {}),
          topicId: current.topicId, topicTitle: topicTitle(current.topicId),
        },
        answer: current.answer, tokenOrder: current.tokenOrder, attempts: current.attempts, assisted: current.assisted,
        hint: current.hint, feedback: current.feedback, settled: current.settled, misses: current.misses,
      } : null,
      results,
      ...(round.mode === 'test' ? { score: results.filter((result) => result.outcome === 'independent').length } : {}),
    };
  }

  function snapshot(key: string): GrammarSnapshot {
    const scope = scopeOf(key);
    const row = latestSession.get(key);
    return {
      scope: key, kind: scope.kind,
      topic: scope.topic ? topicView(scope.topic, direct) : null,
      unit: scope.unit ? unitView(scope.unit, direct) : null,
      session: row ? sessionView(row) : null,
    };
  }

  function requestId(value: string): void {
    if (typeof value !== 'string' || !value.trim()) throw new StoreError('This action needs a request ID. Please try again.');
  }

  function replay(id: string, action: string, payload: string): GrammarSnapshot | null {
    const previous = requestById.get(id);
    if (!previous) return null;
    if (previous.action !== action || previous.payload_json !== payload) throw new StoreError('This request ID was already used for a different action. Reload and try again.', 409);
    // A lost-response retry reads the scope's newest session, even after later actions or another session.
    return snapshot(previous.topic_id);
  }

  function shuffle<T>(items: T[]): T[] {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index--) {
      const other = Math.min(index, Math.floor(random() * (index + 1)));
      [copy[index], copy[other]] = [copy[other]!, copy[index]!];
    }
    return copy;
  }

  function practice(topic: GrammarTopicContent): Picked[] {
    const history = new Map(topicProgress.all(topic.id).map((row) => [row.exercise_id, row]));
    const struggling = (row: ProgressRow | undefined) => row?.outcome === 'helped' || row?.outcome === 'revisit';
    const struggled = new Set(topic.exercises.filter((exercise) => struggling(history.get(exercise.id))).map((exercise) => exercise.pattern));
    // Missed in a test, unseen in a pattern you struggled with, unseen, helped or to revisit, then on your own; oldest first.
    const tier = (exercise: GrammarExercise) => {
      const previous = history.get(exercise.id);
      if (!previous) return struggled.has(exercise.pattern) ? 1 : 2;
      if (previous.outcome === 'revisit' && previous.settled_in === 'test') return 0;
      return struggling(previous) ? 3 : 4;
    };
    const tiers = new Map(topic.exercises.map((exercise) => [exercise, tier(exercise)]));
    // Among equally ranked exercises, take each pattern's first before any pattern's second.
    const turn = new Map<GrammarExercise, number>();
    const turns = new Map<string, number>();
    for (const exercise of topic.exercises) {
      const group = `${tiers.get(exercise)}|${exercise.pattern}`;
      turn.set(exercise, turns.get(group) ?? 0);
      turns.set(group, (turns.get(group) ?? 0) + 1);
    }
    const ranked = [...topic.exercises].sort((left, right) => tiers.get(left)! - tiers.get(right)!
      || (history.get(left.id)?.last_seen ?? 0) - (history.get(right.id)?.last_seen ?? 0)
      || turn.get(left)! - turn.get(right)!);
    const rank = new Map(ranked.map((exercise, index) => [exercise, index]));
    const size = Math.min(PRACTICE_SIZE, ranked.length);
    const picked: GrammarExercise[] = [];
    const patterns = new Map<string, number>();
    for (const exercise of ranked) {
      if (picked.length === size) break;
      if ((patterns.get(exercise.pattern) ?? 0) >= PATTERN_CAP) continue;
      picked.push(exercise);
      patterns.set(exercise.pattern, (patterns.get(exercise.pattern) ?? 0) + 1);
    }
    // A topic with too few patterns to fill a round under the cap fills it anyway.
    for (const exercise of ranked) if (picked.length < size && !picked.includes(exercise)) picked.push(exercise);
    const wantedTypes = Math.min(MIN_TYPES, new Set(topic.exercises.map((exercise) => exercise.type)).size);
    while (new Set(picked.map((exercise) => exercise.type)).size < wantedTypes) {
      const types = countBy(picked, (exercise) => exercise.type);
      const perPattern = countBy(picked, (exercise) => exercise.pattern);
      const limit = Math.max(PATTERN_CAP, ...perPattern.values());
      let swapped = false;
      for (const candidate of ranked) {
        if (swapped) break;
        if (picked.includes(candidate) || types.has(candidate.type)) continue;
        // Give up the lowest-ranked exercise of a repeated type, never a missed test item.
        for (let index = picked.length - 1; index >= 0; index--) {
          const victim = picked[index]!;
          if (types.get(victim.type)! < 2 || tiers.get(victim) === 0) continue;
          if ((perPattern.get(candidate.pattern) ?? 0) + (victim.pattern === candidate.pattern ? 0 : 1) > limit) continue;
          picked[index] = candidate;
          swapped = true;
          break;
        }
      }
      if (!swapped) break;
    }
    picked.sort((left, right) => rank.get(left)! - rank.get(right)!);
    return interleave(picked, (exercise) => exercise.pattern).map((content) => ({ topicId: topic.id, content }));
  }

  // Every exercise once: round-robin over patterns in random order, random within a pattern, questions from the
  // previous test last, and within a turn the question type used least so far.
  function stratified(exercises: GrammarExercise[], previous: Set<string>): GrammarExercise[] {
    const groups = shuffle([...Map.groupBy(shuffle(exercises), (exercise) => exercise.pattern).values()])
      .map((group) => group.sort((left, right) => Number(previous.has(left.id)) - Number(previous.has(right.id))));
    const types = new Map<string, number>();
    const ordered: GrammarExercise[] = [];
    while (groups.some((group) => group.length)) {
      for (const group of groups) {
        if (!group.length) continue;
        const stale = previous.has(group[0]!.id);
        let best = group[0]!;
        for (const exercise of group) {
          if (previous.has(exercise.id) !== stale) break;
          if ((types.get(exercise.type) ?? 0) < (types.get(best.type) ?? 0)) best = exercise;
        }
        group.splice(group.indexOf(best), 1);
        ordered.push(best);
        types.set(best.type, (types.get(best.type) ?? 0) + 1);
      }
    }
    return ordered;
  }

  // Rounds of one question per key, each round in a fresh random order, so every stretch of a test covers every
  // key (a unit's topics, a topic's patterns) and no key repeats back to back where another is left.
  function spread<T>(items: T[], key: (item: T) => string): T[] {
    const groups = [...Map.groupBy(shuffle(items), key).values()];
    const ordered: T[] = [];
    while (groups.some((group) => group.length)) {
      const round = shuffle(groups.filter((group) => group.length));
      if (round.length > 1 && ordered.length && key(round[0]![0]!) === key(ordered.at(-1)!)) round.push(round.shift()!);
      for (const group of round) ordered.push(group.shift()!);
    }
    return ordered;
  }

  function topicTest(topic: GrammarTopicContent, previous: Set<string>): Picked[] {
    const chosen = stratified(topic.exercises, previous).slice(0, TOPIC_TEST_SIZE);
    return spread(chosen, (exercise) => exercise.pattern).map((content) => ({ topicId: topic.id, content }));
  }

  function unitTest(unit: GrammarUnitContent, previous: Set<string>): Picked[] {
    const streams = shuffle(unit.topics).map((topicId) => ({ topicId, queue: stratified(topicById.get(topicId)!.exercises, previous) }));
    const size = Math.min(UNIT_TEST_SIZE, streams.reduce((total, stream) => total + stream.queue.length, 0));
    const chosen: Picked[] = [];
    while (chosen.length < size) {
      for (const stream of streams) {
        const content = stream.queue.shift();
        if (content && chosen.length < size) chosen.push({ topicId: stream.topicId, content });
      }
    }
    return spread(chosen, (item) => item.topicId);
  }

  function fresh({ topicId, content }: Picked): StoredExercise {
    // Options are shuffled once per question, so the authored order never gives the answer away.
    const stored = content.options ? { ...content, options: shuffle(content.options) } : content;
    return { topicId, content: stored, answer: '', tokenOrder: [], attempts: 0, assisted: false, hint: null, feedback: null, settled: false, help: [], outcome: null, misses: [] };
  }

  function start(key: string, id: string): GrammarSnapshot {
    const scope = scopeOf(key);
    requestId(id);
    const payload = JSON.stringify({ scope: key });
    return db.transaction(() => {
      const replayed = replay(id, 'start', payload);
      if (replayed) return replayed;
      const at = now().toISOString();
      const sequence = appendRequest.get(id, 'start', payload, key, at)!.sequence;
      const row = latestSession.get(key);
      const existing = row ? loadRound(row) : null;
      if (!existing || existing.index >= existing.exercises.length) {
        const previous = new Set(existing?.exercises.map((item) => item.content.id));
        const picked = scope.kind === 'practice' ? practice(scope.topic!)
          : scope.kind === 'topic-test' ? topicTest(scope.topic!, previous) : unitTest(scope.unit!, previous);
        const round: Round = { mode: scope.kind === 'practice' ? 'practice' : 'test', version: 1, index: 0, exercises: picked.map(fresh) };
        insertSession.run(crypto.randomUUID(), key, JSON.stringify(round), at, at);
        expose.run(round.exercises[0]!.topicId, round.exercises[0]!.content.id, sequence);
      }
      return snapshot(key);
    }).immediate();
  }

  function mutation(input: GrammarMutation, action: string, details: object, apply: (current: StoredExercise, round: Round) => void): GrammarSnapshot {
    requestId(input.requestId);
    if (typeof input.sessionId !== 'string' || !input.sessionId.trim() || typeof input.exerciseId !== 'string' || !input.exerciseId.trim()
      || !Number.isSafeInteger(input.version) || input.version < 1) throw new StoreError('This action needs a valid session, exercise, and version. Reload and try again.');
    const payload = JSON.stringify({ sessionId: input.sessionId, exerciseId: input.exerciseId, version: input.version, ...details });
    return db.transaction(() => {
      const replayed = replay(input.requestId, action, payload);
      if (replayed) return replayed;
      const row = sessionById.get(input.sessionId);
      const round = row ? loadRound(row) : null;
      const current = round?.exercises[round.index];
      if (!row || !round || !current || round.version !== input.version || current.content.id !== input.exerciseId || latestSession.get(row.topic_id)?.id !== row.id) {
        throw new StoreError('This grammar exercise has changed on another screen. Your action was not recorded; reload the current exercise.', 409);
      }
      const wasSettled = current.settled;
      const previousIndex = round.index;
      apply(current, round);
      const at = now().toISOString();
      const sequence = appendRequest.get(input.requestId, action, payload, row.topic_id, at)!.sequence;
      if (!wasSettled && current.settled) settleProgress.run(current.topicId, current.content.id, sequence, current.outcome, round.mode);
      if (round.index !== previousIndex) {
        const upcoming = round.exercises[round.index];
        if (upcoming) expose.run(upcoming.topicId, upcoming.content.id, sequence);
        else if (round.mode === 'test') {
          recordTest.run(row.topic_id, row.id, round.exercises.filter((item) => item.outcome === 'independent').length, round.exercises.length, at);
        }
      }
      round.version += 1;
      saveSession.run(JSON.stringify(round), at, row.id);
      return snapshot(row.topic_id);
    }).immediate();
  }

  function answer(input: GrammarAnswerInput): GrammarSnapshot {
    if (typeof input.answer !== 'string' || (input.tokenOrder !== undefined && !Array.isArray(input.tokenOrder))) throw new StoreError('Submit an answer and a valid token order.');
    return mutation(input, 'answer', { answer: input.answer, tokenOrder: input.tokenOrder ?? null }, (current, round) => {
      if (current.settled) throw new StoreError('This exercise is already settled. Continue to the next sentence.', 409);
      const exercise = current.content;
      const order = input.tokenOrder ?? [];
      if (exercise.type === 'build') {
        if (order.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= exercise.tokens!.length) || new Set(order).size !== order.length) throw new StoreError('Choose each available token at most once.');
        current.tokenOrder = [...order];
        current.answer = joinTokens(order.map((index) => exercise.tokens![index]!));
      } else {
        if (order.length) throw new StoreError('This exercise takes a written answer, not building tokens.');
        current.answer = input.answer;
      }
      if (!normalize(current.answer)) {
        current.feedback = { kind: 'incorrect', message: 'Write an answer before checking it.' };
        return;
      }
      if (exercise.type === 'choose' && !exercise.options!.some((option) => normalize(option) === normalize(current.answer))) {
        throw new StoreError('Choose one of the options.');
      }
      current.attempts += 1;
      const verdict = classify(exercise, current.answer);
      const accepted = verdict.kind === 'correct' || verdict.kind === 'spelling';
      const spelling = verdict.kind === 'spelling' ? { spelling: true } : {};
      if (!accepted && !current.misses.includes(current.answer)) current.misses.push(current.answer);
      if (round.mode === 'test') {
        // One try: the first real answer settles, and feedback always shows the right answer and why.
        current.settled = true;
        current.outcome = accepted ? 'independent' : 'revisit';
        current.feedback = {
          kind: accepted ? 'correct' : verdict.kind === 'alternative' ? 'alternative' : 'incorrect',
          message: exercise.explanation, answer: exercise.answers[0], ...spelling,
          ...(verdict.kind === 'alternative' ? { note: verdict.message } : {}),
        };
      } else if (accepted) {
        current.feedback = { kind: 'correct', message: exercise.explanation, answer: exercise.answers[0], ...spelling };
        current.settled = true;
        current.outcome = current.assisted || current.attempts > 1 ? 'helped' : 'independent';
      } else {
        current.feedback = verdict.kind === 'alternative' ? { kind: 'alternative', message: verdict.message! } : { kind: 'incorrect', message: exercise.feedback };
      }
    });
  }

  function help(input: GrammarHelpInput): GrammarSnapshot {
    if (!['hint', 'rule', 'answer'].includes(input.kind)) throw new StoreError('Choose a hint, the rule, or a shown answer.');
    return mutation(input, 'help', { kind: input.kind }, (current, round) => {
      if (round.mode === 'test') throw new StoreError('Help is off during a test.', 409);
      if (!current.help.includes(input.kind)) current.help.push(input.kind);
      if (input.kind === 'hint') current.hint = current.content.hint;
      // Help read after settlement must never rewrite the earned result.
      if (current.settled) return;
      current.assisted = true;
      if (input.kind === 'answer') {
        current.feedback = { kind: 'shown', message: current.content.explanation, answer: current.content.answers[0] };
        current.settled = true;
        current.outcome = 'revisit';
      }
    });
  }

  function next(input: GrammarMutation): GrammarSnapshot {
    return mutation(input, 'next', {}, (current, round) => {
      if (!current.settled) throw new StoreError('Check a correct answer or show one before continuing.', 409);
      round.index += 1;
    });
  }

  function exportData(): unknown {
    return db.transaction(() => ({
      format: 'echo-grammar-progress', version: 2, exportedAt: now().toISOString(), units, topics,
      sessions: db.query<SessionRow, []>('SELECT * FROM grammar_sessions ORDER BY sequence').all().map(({ round_json, ...row }) => ({ ...row, round: JSON.parse(round_json) })),
      progress: db.query<ProgressRow, []>('SELECT * FROM grammar_progress ORDER BY topic_id, exercise_id').all(),
      tests: db.query<TestRow, []>('SELECT * FROM grammar_tests ORDER BY sequence').all(),
      requests: db.query<RequestRow, []>('SELECT * FROM grammar_requests ORDER BY sequence').all().map(({ payload_json, ...row }) => ({ ...row, payload: JSON.parse(payload_json) })),
    }))();
  }

  return {
    catalog: () => db.transaction(() => {
      const lookup = bulk();
      return units.map((unit) => unitView(unit, lookup));
    })(),
    state: (key) => db.transaction(() => snapshot(key))(),
    start, answer, help, next, exportData, close: () => db.close(),
  };
}
