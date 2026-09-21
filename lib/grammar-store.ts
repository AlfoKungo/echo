import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  GrammarAnswerInput, GrammarCurrent, GrammarExercise, GrammarHelpInput, GrammarMutation,
  GrammarResult, GrammarSession, GrammarSnapshot, GrammarTopic, GrammarTopicContent,
} from '../contract';
import { StoreError } from './store';

export interface GrammarStore {
  catalog(): GrammarTopic[];
  state(topicId: string): GrammarSnapshot;
  start(topicId: string, requestId: string): GrammarSnapshot;
  answer(input: GrammarAnswerInput): GrammarSnapshot;
  help(input: GrammarHelpInput): GrammarSnapshot;
  next(input: GrammarMutation): GrammarSnapshot;
  exportData(): unknown;
  close(): void;
}

type StoredExercise = Omit<GrammarCurrent, 'exercise'> & {
  content: GrammarExercise;
  help: GrammarHelpInput['kind'][];
  outcome: GrammarResult['outcome'] | null;
};
type Round = { version: number; index: number; exercises: StoredExercise[] };
type SessionRow = { sequence: number; id: string; topic_id: string; round_json: string; created_at: string; updated_at: string };
type RequestRow = { sequence: number; request_id: string; action: string; payload_json: string; topic_id: string; created_at: string };
type ProgressRow = { topic_id: string; exercise_id: string; last_seen: number; outcome: GrammarResult['outcome'] | null };

function normalize(answer: string): string {
  return answer.normalize('NFC').toLocaleLowerCase('fr').replace(/[’‘ʼ]/g, "'")
    .replace(/\s*'\s*/g, "'").replace(/\s+/g, ' ').replace(/\s+([,;:!?])/g, '$1')
    .replace(/[\s.!?…]+$/u, '').trim();
}

function joinTokens(tokens: string[]): string {
  return tokens.join(' ').replace(/(['’‘ʼ])\s+/g, '$1').replace(/\s+([,.;:!?…])/g, '$1');
}

// Check token phrases as units, not a bag of words: a multiword token cannot be split.
function canBuild(tokens: string[], answer: string): boolean {
  const target = normalize(answer);
  const failed = new Set<string>();
  function visit(remaining: number[], selected: string[]): boolean {
    const prefix = normalize(joinTokens(selected));
    if (!target.startsWith(prefix)) return false;
    if (prefix === target) return true;
    if (!remaining.length) return false;
    const key = `${remaining.join(',')}|${prefix}`;
    if (failed.has(key)) return false;
    const tried = new Set<string>();
    for (const index of remaining) {
      if (tried.has(tokens[index]!)) continue;
      tried.add(tokens[index]!);
      if (visit(remaining.filter((value) => value !== index), [...selected, tokens[index]!])) return true;
    }
    failed.add(key);
    return false;
  }
  return visit(tokens.map((_, index) => index), []);
}

function validateCatalog(topics: GrammarTopicContent[]): void {
  const topicIds = new Set<string>();
  const exerciseIds = new Set<string>();
  function text(value: unknown, label: string, allowEmpty = false): asserts value is string {
    if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || /<\/?[A-Za-z][^>]*>/.test(value)) {
      throw new StoreError(`Grammar content has invalid plain text: ${label}.`);
    }
  }
  function identifier(value: unknown, ids: Set<string>, label: string): void {
    text(value, label);
    if (value !== value.trim() || ids.has(value)) throw new StoreError(`Grammar content has an invalid or duplicate ${label}.`);
    ids.add(value);
  }
  if (!Array.isArray(topics)) throw new StoreError('Grammar content must be a list of topics.');
  for (const topic of topics) {
    if (!topic || typeof topic !== 'object') throw new StoreError('Grammar content contains an invalid topic.');
    identifier(topic.id, topicIds, 'topic ID');
    for (const field of ['title', 'description', 'mark', 'rule', 'example', 'aside'] as const) text(topic[field], `${topic.id}.${field}`, field === 'aside');
    if (!Array.isArray(topic.exercises) || !topic.exercises.length) throw new StoreError(`Grammar topic ${topic.id} has no exercises.`);
    for (const exercise of topic.exercises) {
      if (!exercise || typeof exercise !== 'object') throw new StoreError(`Grammar topic ${topic.id} contains an invalid exercise.`);
      identifier(exercise.id, exerciseIds, 'exercise ID');
      if (!['rewrite', 'build', 'complete', 'repair'].includes(exercise.type)) throw new StoreError(`Grammar exercise ${exercise.id} has an invalid type.`);
      for (const field of ['pattern', 'instruction', 'source', 'hint', 'feedback', 'explanation'] as const) text(exercise[field], `${exercise.id}.${field}`);
      if (!Array.isArray(exercise.answers) || !exercise.answers.length) throw new StoreError(`Grammar exercise ${exercise.id} has no accepted answers.`);
      const classifications = new Set<string>();
      function answer(value: unknown): void {
        text(value, `${exercise.id} answer`);
        const normalized = normalize(value);
        if (!normalized || classifications.has(normalized)) throw new StoreError(`Grammar exercise ${exercise.id} has an empty or conflicting answer.`);
        classifications.add(normalized);
      }
      exercise.answers.forEach(answer);
      if (exercise.spellingAnswers !== undefined) {
        if (!Array.isArray(exercise.spellingAnswers)) throw new StoreError(`Grammar exercise ${exercise.id} has invalid spelling answers.`);
        exercise.spellingAnswers.forEach(answer);
      }
      if (exercise.alternatives !== undefined) {
        if (!Array.isArray(exercise.alternatives)) throw new StoreError(`Grammar exercise ${exercise.id} has invalid alternatives.`);
        for (const alternative of exercise.alternatives) {
          if (!alternative || typeof alternative !== 'object') throw new StoreError(`Grammar exercise ${exercise.id} has an invalid alternative.`);
          answer(alternative.answer);
          text(alternative.message, `${exercise.id} alternative feedback`);
        }
      }
      if (exercise.type === 'build') {
        if (!Array.isArray(exercise.tokens) || !exercise.tokens.length) throw new StoreError(`Grammar exercise ${exercise.id} has no building tokens.`);
        exercise.tokens.forEach((token) => text(token, `${exercise.id} token`));
        if (exercise.answers.some((accepted) => !canBuild(exercise.tokens!, accepted))) throw new StoreError(`Grammar exercise ${exercise.id} has an answer that cannot be built from its tokens.`);
      } else if (exercise.tokens !== undefined) {
        throw new StoreError(`Grammar exercise ${exercise.id} has tokens but is not a building exercise.`);
      }
    }
  }
}

export function createGrammarStore(topics: GrammarTopicContent[], options: { dbPath?: string; now?: () => Date } = {}): GrammarStore {
  validateCatalog(topics);
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const now = options.now ?? (() => new Date());
  const dbPath = options.dbPath ?? './data/echo.db';
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.transaction(() => db.exec(`
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
  `)).immediate();

  const latestSession = db.query<SessionRow, [string]>('SELECT * FROM grammar_sessions WHERE topic_id = ? ORDER BY sequence DESC LIMIT 1');
  const sessionById = db.query<SessionRow, [string]>('SELECT * FROM grammar_sessions WHERE id = ?');
  const requestById = db.query<RequestRow, [string]>('SELECT * FROM grammar_requests WHERE request_id = ?');
  const topicProgress = db.query<ProgressRow, [string]>('SELECT * FROM grammar_progress WHERE topic_id = ?');
  const appendRequest = db.query<{ sequence: number }, [string, string, string, string, string]>(`
    INSERT INTO grammar_requests (request_id, action, payload_json, topic_id, created_at)
    VALUES (?, ?, ?, ?, ?) RETURNING sequence
  `);
  const saveSession = db.query('UPDATE grammar_sessions SET round_json = ?, updated_at = ? WHERE id = ?');
  const expose = db.query(`
    INSERT INTO grammar_progress (topic_id, exercise_id, last_seen, outcome) VALUES (?, ?, ?, NULL)
    ON CONFLICT (topic_id, exercise_id) DO UPDATE SET last_seen = excluded.last_seen
  `);
  const settleProgress = db.query('UPDATE grammar_progress SET outcome = ? WHERE topic_id = ? AND exercise_id = ?');

  function topicContent(topicId: string): GrammarTopicContent {
    const topic = topicById.get(topicId);
    if (!topic) throw new StoreError('That grammar topic does not exist.', 404);
    return topic;
  }

  function topicView(topic: GrammarTopicContent, row: SessionRow | null): GrammarTopic {
    const { exercises, ...content } = topic;
    const exerciseIds = new Set(exercises.map((exercise) => exercise.id));
    const progress = { seen: 0, independent: 0, needsReview: 0 };
    for (const record of topicProgress.all(topic.id)) {
      if (!exerciseIds.has(record.exercise_id)) continue;
      progress.seen += 1;
      if (record.outcome === 'independent') progress.independent += 1;
      else if (record.outcome) progress.needsReview += 1;
    }
    const round: Round | null = row ? JSON.parse(row.round_json) : null;
    return { ...content, exerciseCount: exercises.length, progress, hasActiveSession: !!round && round.index < round.exercises.length };
  }

  function sessionView(row: SessionRow): GrammarSession {
    const round: Round = JSON.parse(row.round_json);
    const current = round.exercises[round.index];
    const exercise = current?.content;
    return {
      id: row.id, version: round.version, index: round.index, total: round.exercises.length,
      complete: !current,
      current: current && exercise ? {
        exercise: { id: exercise.id, type: exercise.type, instruction: exercise.instruction, source: exercise.source, ...(exercise.tokens ? { tokens: exercise.tokens } : {}) },
        answer: current.answer, tokenOrder: current.tokenOrder, attempts: current.attempts,
        assisted: current.assisted, hint: current.hint, feedback: current.feedback, settled: current.settled,
      } : null,
      results: round.exercises.filter((item) => item.settled).map((item) => ({
        exerciseId: item.content.id, type: item.content.type, source: item.content.source, answer: item.content.answers[0]!, outcome: item.outcome!,
      })),
    };
  }

  function snapshot(topicId: string): GrammarSnapshot {
    const topic = topicContent(topicId);
    const row = latestSession.get(topicId);
    return { topic: topicView(topic, row), session: row ? sessionView(row) : null };
  }

  function requestId(value: string): void {
    if (typeof value !== 'string' || !value.trim()) throw new StoreError('This action needs a request ID. Please try again.');
  }

  function replay(id: string, action: string, payload: string): GrammarSnapshot | null {
    const previous = requestById.get(id);
    if (!previous) return null;
    if (previous.action !== action || previous.payload_json !== payload) throw new StoreError('This request ID was already used for a different action. Reload and try again.', 409);
    // A lost-response retry reads the newest round, even after later actions or another round.
    return snapshot(previous.topic_id);
  }

  function choose(topic: GrammarTopicContent): GrammarExercise[] {
    const history = new Map(topicProgress.all(topic.id).map((row) => [row.exercise_id, row]));
    const revisitPatterns = new Set(topic.exercises.filter((exercise) => {
      const outcome = history.get(exercise.id)?.outcome;
      return outcome === 'helped' || outcome === 'revisit';
    }).map((exercise) => exercise.pattern));
    function priority(exercise: GrammarExercise): number {
      const previous = history.get(exercise.id);
      if (!previous) return revisitPatterns.has(exercise.pattern) ? 0 : 1;
      return previous.outcome === 'helped' || previous.outcome === 'revisit' ? 2 : 3;
    }
    return [...topic.exercises].sort((left, right) => priority(left) - priority(right)
      || (history.get(left.id)?.last_seen ?? 0) - (history.get(right.id)?.last_seen ?? 0)).slice(0, 3);
  }

  function start(topicId: string, id: string): GrammarSnapshot {
    const topic = topicContent(topicId);
    requestId(id);
    const payload = JSON.stringify({ topicId });
    return db.transaction(() => {
      const previous = replay(id, 'start', payload);
      if (previous) return previous;
      const at = now().toISOString();
      const sequence = appendRequest.get(id, 'start', payload, topicId, at)!.sequence;
      const row = latestSession.get(topicId);
      const existing: Round | null = row ? JSON.parse(row.round_json) : null;
      if (!existing || existing.index >= existing.exercises.length) {
        const round: Round = {
          version: 1, index: 0,
          exercises: choose(topic).map((content) => ({ content, answer: '', tokenOrder: [], attempts: 0, assisted: false, hint: null, feedback: null, settled: false, help: [], outcome: null })),
        };
        db.query('INSERT INTO grammar_sessions (id, topic_id, round_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(crypto.randomUUID(), topicId, JSON.stringify(round), at, at);
        expose.run(topicId, round.exercises[0]!.content.id, sequence);
      }
      return snapshot(topicId);
    }).immediate();
  }

  function mutation(input: GrammarMutation, action: string, details: object, apply: (current: StoredExercise, round: Round) => void): GrammarSnapshot {
    requestId(input.requestId);
    if (typeof input.sessionId !== 'string' || !input.sessionId.trim() || typeof input.exerciseId !== 'string' || !input.exerciseId.trim()
      || !Number.isSafeInteger(input.version) || input.version < 1) throw new StoreError('This action needs a valid session, exercise, and version. Reload and try again.');
    const payload = JSON.stringify({ sessionId: input.sessionId, exerciseId: input.exerciseId, version: input.version, ...details });
    return db.transaction(() => {
      const previous = replay(input.requestId, action, payload);
      if (previous) return previous;
      const row = sessionById.get(input.sessionId);
      const round: Round | null = row ? JSON.parse(row.round_json) : null;
      const current = round?.exercises[round.index];
      if (!row || !round || !current || round.version !== input.version || current.content.id !== input.exerciseId || latestSession.get(row.topic_id)?.id !== row.id) {
        throw new StoreError('This grammar exercise has changed on another screen. Your action was not recorded; reload the current exercise.', 409);
      }
      const wasSettled = current.settled;
      const previousIndex = round.index;
      apply(current, round);
      const at = now().toISOString();
      const sequence = appendRequest.get(input.requestId, action, payload, row.topic_id, at)!.sequence;
      if (!wasSettled && current.settled) settleProgress.run(current.outcome, row.topic_id, current.content.id);
      if (round.index !== previousIndex && round.exercises[round.index]) expose.run(row.topic_id, round.exercises[round.index]!.content.id, sequence);
      round.version += 1;
      saveSession.run(JSON.stringify(round), at, row.id);
      return snapshot(row.topic_id);
    }).immediate();
  }

  function answer(input: GrammarAnswerInput): GrammarSnapshot {
    if (typeof input.answer !== 'string' || (input.tokenOrder !== undefined && !Array.isArray(input.tokenOrder))) throw new StoreError('Submit an answer and a valid token order.');
    return mutation(input, 'answer', { answer: input.answer, tokenOrder: input.tokenOrder ?? null }, (current) => {
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
      const normalized = normalize(current.answer);
      if (!normalized) {
        current.feedback = { kind: 'incorrect', message: 'Write an answer before checking it.' };
        return;
      }
      current.attempts += 1;
      const correct = exercise.answers.some((accepted) => normalize(accepted) === normalized);
      const spelling = !correct && !!exercise.spellingAnswers?.some((accepted) => normalize(accepted) === normalized);
      if (correct || spelling) {
        current.feedback = { kind: 'correct', message: exercise.explanation, answer: exercise.answers[0], ...(spelling ? { spelling: true } : {}) };
        current.settled = true;
        current.outcome = current.assisted || current.attempts > 1 ? 'helped' : 'independent';
      } else {
        const alternative = exercise.alternatives?.find((item) => normalize(item.answer) === normalized);
        current.feedback = alternative ? { kind: 'alternative', message: alternative.message } : { kind: 'incorrect', message: exercise.feedback };
      }
    });
  }

  function help(input: GrammarHelpInput): GrammarSnapshot {
    if (!['hint', 'rule', 'answer'].includes(input.kind)) throw new StoreError('Choose a hint, the rule, or a shown answer.');
    return mutation(input, 'help', { kind: input.kind }, (current) => {
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
      format: 'echo-grammar-progress', version: 1, exportedAt: now().toISOString(), topics,
      sessions: db.query<SessionRow, []>('SELECT * FROM grammar_sessions ORDER BY sequence').all().map(({ round_json, ...row }) => ({ ...row, round: JSON.parse(round_json) })),
      progress: db.query<ProgressRow, []>('SELECT * FROM grammar_progress ORDER BY topic_id, exercise_id').all(),
      requests: db.query<RequestRow, []>('SELECT * FROM grammar_requests ORDER BY sequence').all().map(({ payload_json, ...row }) => ({ ...row, payload: JSON.parse(payload_json) })),
    }))();
  }

  return {
    catalog: () => db.transaction(() => topics.map((topic) => topicView(topic, latestSession.get(topic.id))))(),
    state: (topicId) => db.transaction(() => snapshot(topicId))(),
    start, answer, help, next, exportData, close: () => db.close(),
  };
}
