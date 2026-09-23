import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createEmptyCard, fsrs, Rating, type Card, type CardInput } from 'ts-fsrs';
import type { Direction, Word } from '../contract';
import type {
  Annotation, LearningAttemptInput, LearningContent, LearningFeedback, LearningOutcome, LearningSkill,
  MaterialExplanation, ReadingLesson, ReviewItem, ReviewOverview, SavedPhrase, TutorInput, TutorJob,
} from '../learning-contract';
import type { GrammarStore } from './grammar-store';
import { StoreError, type Store } from './store';

type PhraseInput = { requestId: string; fr: string; en: string; explanation: string; sourceId: string };
type ReviewInput = { requestId: string; reviewId: string; known: boolean };
type MaterialInput = { text: string; title?: string; sourceId: string; explanation: MaterialExplanation };
type TutorPatch = Partial<Pick<TutorJob, 'status' | 'progress' | 'result' | 'error'>>;

export interface LearningStore {
  catalog(): LearningContent;
  materials(): { id: string; title: string; kind: ReadingLesson['kind'] }[];
  material(id: string): ReadingLesson;
  attempt(input: LearningAttemptInput): LearningFeedback;
  savePhrase(input: PhraseInput): SavedPhrase;
  review(input: ReviewInput): ReviewOverview;
  progress(): ReviewOverview;
  createTutorJob(input: TutorInput): { job: TutorJob; isNew: boolean };
  getTutorJob(id: string): TutorJob | null;
  lastTutorJob(sourceId: string, kind: TutorInput['kind']): TutorJob | null;
  updateTutorJob(id: string, patch: TutorPatch): TutorJob;
  storeMaterial(input: MaterialInput): ReadingLesson;
  cancelInterruptedTutorJobs(): void;
  exportData(): unknown;
  close(): void;
}

type ReviewDescriptor = Omit<ReviewItem, 'id' | 'dueAt'>;
type ReviewRow = {
  id: string; identity_key: string; view_json: string; skill: LearningSkill; title: string;
  fsrs_json: string; due_at: number; cycle_helped: number;
};
type RequestRow = { request_id: string; action: string; payload_json: string; result_json: string; created_at: string };
type PhraseRow = { id: string; phrase_key: string; fr: string; en: string; explanation: string; source_id: string; created_at: string };
type MaterialRow = { id: string; source_id: string; text: string; lesson_json: string; created_at: string };
type TutorRow = {
  sequence: number; id: string; source_id: string; kind: TutorInput['kind']; input_json: string;
  status: TutorJob['status']; progress: string; result_json: string | null; error: string | null; created_at: string; updated_at: string;
};
type GradeRow = {
  sequence: number; request_id: string; review_id: string; answer: string; feedback_kind: LearningFeedback['kind'];
  outcome: LearningOutcome; source: 'self-rated' | 'prepared'; graded_at: string; fsrs_log: string | null;
};
type TopicSummary = {
  title: string; skill: LearningSkill; successes: number; helped: number; revisit: number; attempts: number;
  source: 'self-rated' | 'prepared'; latest: LearningOutcome;
};
type VocabularyExport = {
  words: Word[];
  grades: { sequence: number; direction: Direction; word_id: string; known: number }[];
  undos: { grade_sequence: number }[];
};
type GrammarExport = {
  topics: { id: string; exercises: { id: string }[] }[];
  progress: { topic_id: string; exercise_id: string; outcome: LearningOutcome | null }[];
};
type TutorRequestResult = { id: string };

function requireText(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new StoreError(message);
}

// Keep letters and word order: punctuation tolerance must not accept missing words.
function normalize(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('fr').replace(/[’‘ʼ]/gu, "'")
    .replace(/\s*'\s*/gu, "'").replace(/[^\p{L}\p{M}\p{N}'\s]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function withoutAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

function phrasePosition(text: string, phrase: string): number {
  let index = text.indexOf(phrase);
  const startsWord = /^[\p{L}\p{M}\p{N}]/u;
  const endsWord = /[\p{L}\p{M}\p{N}]$/u;
  while (index >= 0) {
    const before = text.slice(Math.max(0, index - 2), index);
    const after = text.slice(index + phrase.length, index + phrase.length + 2);
    if (!(startsWord.test(phrase) && endsWord.test(before)) && !(endsWord.test(phrase) && startsWord.test(after))) return index;
    index = text.indexOf(phrase, index + 1);
  }
  return -1;
}

function groundedAnnotations(text: string, annotations: Annotation[]): Annotation[] {
  const seen = new Set<string>();
  return annotations.filter((annotation) => {
    if (!annotation || typeof annotation.phrase !== 'string' || !annotation.phrase.trim()
      || typeof annotation.translation !== 'string' || !annotation.translation.trim()
      || typeof annotation.explanation !== 'string' || phrasePosition(text, annotation.phrase) < 0
      || seen.has(annotation.phrase)) return false;
    seen.add(annotation.phrase);
    return true;
  });
}

function practiceFor(text: string, annotations: Annotation[]): NonNullable<ReadingLesson['practice']> {
  const sentences = [...new Intl.Segmenter('fr', { granularity: 'sentence' }).segment(text)];
  return annotations.map((annotation) => {
    const index = phrasePosition(text, annotation.phrase);
    const start = sentences.findLast(sentence => sentence.index <= index)?.index ?? 0;
    const end = sentences.find(sentence => sentence.index >= index + annotation.phrase.length)?.index ?? text.length;
    const cloze = `${text.slice(start, index)}____${text.slice(index + annotation.phrase.length, end)}`.trim();
    return {
      prompt: `Use the phrase meaning “${annotation.translation}”: ${cloze}`,
      answer: annotation.phrase,
      explanation: `${annotation.translation}${annotation.explanation ? ` — ${annotation.explanation}` : ''}`,
    };
  });
}

function prepareCatalog(content: LearningContent): LearningContent {
  const ids = new Set<string>();
  function identity(id: string): void {
    requireText(id, 'A learning lesson needs an ID.');
    if (ids.has(id)) throw new StoreError('Learning content contains duplicate lesson IDs.');
    ids.add(id);
  }
  function choices(values: string[], correctIndex: number): void {
    if (!Array.isArray(values) || !values.length || !Number.isSafeInteger(correctIndex) || correctIndex < 0 || correctIndex >= values.length
      || values.some((value) => typeof value !== 'string' || !normalize(value)) || new Set(values.map(normalize)).size !== values.length) {
      throw new StoreError('A prepared question has invalid answer choices.');
    }
  }
  for (const lesson of content.listening) {
    identity(lesson.id);
    requireText(lesson.fr, 'A listening lesson needs its French transcript.');
    requireText(lesson.gap.answer, 'A listening gap needs an answer.');
    choices(lesson.meaning.choices, lesson.meaning.correctIndex);
  }
  for (const lesson of content.conversations) {
    identity(lesson.id);
    const turnIds = new Set<string>();
    for (const turn of lesson.turns) {
      requireText(turn.id, 'A conversation turn needs an ID.');
      if (turnIds.has(turn.id)) throw new StoreError('A conversation contains duplicate turn IDs.');
      turnIds.add(turn.id);
      choices(turn.choices, turn.correctIndex);
    }
  }
  const reading = content.reading.map((lesson) => {
    identity(lesson.id);
    const annotations = groundedAnnotations(lesson.fr, lesson.annotations);
    if (annotations.length !== lesson.annotations.length) throw new StoreError('Prepared reading annotations must be unique, exact phrases in the text.');
    const practice = lesson.practice ?? practiceFor(lesson.fr, annotations);
    if (practice.some((item) => !item.answer?.trim() || phrasePosition(lesson.fr, item.answer) < 0)) {
      throw new StoreError('Prepared reading practice answers must be exact phrases in the source text.');
    }
    return { ...lesson, annotations, practice };
  });
  return { ...content, reading };
}

export function createLearningStore(content: LearningContent, options: {
  dbPath?: string; now?: () => Date; words?: Word[]; vocabulary?: Store; grammar?: GrammarStore;
} = {}): LearningStore {
  const catalog = prepareCatalog(content);
  const listening = new Map(catalog.listening.map((lesson) => [lesson.id, lesson]));
  const conversations = new Map(catalog.conversations.map((lesson) => [lesson.id, lesson]));
  const reading = new Map(catalog.reading.map((lesson) => [lesson.id, lesson]));
  const now = options.now ?? (() => new Date());
  const dbPath = options.dbPath ?? './data/echo.db';
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.transaction(() => db.exec(`
    CREATE TABLE IF NOT EXISTS learning_requests (
      request_id TEXT PRIMARY KEY, action TEXT NOT NULL, payload_json TEXT NOT NULL,
      result_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_reviews (
      id TEXT PRIMARY KEY, identity_key TEXT NOT NULL UNIQUE, view_json TEXT NOT NULL,
      skill TEXT NOT NULL CHECK (skill IN ('recognition', 'listening', 'production')), title TEXT NOT NULL,
      fsrs_json TEXT NOT NULL, due_at INTEGER NOT NULL, cycle_helped INTEGER NOT NULL CHECK (cycle_helped IN (0, 1))
    );
    CREATE INDEX IF NOT EXISTS learning_reviews_due ON learning_reviews(due_at);
    CREATE TABLE IF NOT EXISTS learning_grades (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE REFERENCES learning_requests(request_id),
      review_id TEXT NOT NULL REFERENCES learning_reviews(id), answer TEXT NOT NULL,
      feedback_kind TEXT NOT NULL CHECK (feedback_kind IN ('correct', 'incorrect', 'spelling')),
      outcome TEXT NOT NULL CHECK (outcome IN ('independent', 'helped', 'revisit')),
      source TEXT NOT NULL CHECK (source IN ('self-rated', 'prepared')), graded_at TEXT NOT NULL, fsrs_log TEXT
    );
    CREATE INDEX IF NOT EXISTS learning_grades_review ON learning_grades(review_id, sequence);
    CREATE TABLE IF NOT EXISTS learning_phrases (
      id TEXT PRIMARY KEY, phrase_key TEXT NOT NULL UNIQUE, fr TEXT NOT NULL, en TEXT NOT NULL,
      explanation TEXT NOT NULL, source_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_phrase_sources (
      phrase_id TEXT NOT NULL REFERENCES learning_phrases(id), source_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (phrase_id, source_id)
    );
    CREATE TABLE IF NOT EXISTS learning_materials (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, text TEXT NOT NULL, lesson_json TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE (source_id, text)
    );
    CREATE TABLE IF NOT EXISTS learning_tutor_jobs (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, source_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('writing', 'material')), input_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'loading', 'working', 'releasing', 'complete', 'cancelled', 'error')),
      progress TEXT NOT NULL, result_json TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS learning_tutor_source ON learning_tutor_jobs(source_id, kind, sequence DESC);
  `)).immediate();

  const scheduler = fsrs({ enable_short_term: false, enable_fuzz: false });
  const requestById = db.query<RequestRow, [string]>('SELECT * FROM learning_requests WHERE request_id = ?');
  const reviewById = db.query<ReviewRow, [string]>('SELECT * FROM learning_reviews WHERE id = ?');
  const reviewByIdentity = db.query<ReviewRow, [string]>('SELECT * FROM learning_reviews WHERE identity_key = ?');
  const appendRequest = db.query('INSERT INTO learning_requests VALUES (?, ?, ?, ?, ?)');
  const appendGrade = db.query(`
    INSERT INTO learning_grades (request_id, review_id, answer, feedback_kind, outcome, source, graded_at, fsrs_log)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tutorById = db.query<TutorRow, [string]>('SELECT * FROM learning_tutor_jobs WHERE id = ?');

  function replay(requestId: string, action: string, payload: string): RequestRow | null {
    requireText(requestId, 'This action needs a request ID. Please try again.');
    const previous = requestById.get(requestId);
    if (previous && (previous.action !== action || previous.payload_json !== payload)) {
      throw new StoreError('This request ID was already used for a different action. Reload and try again.', 409);
    }
    return previous;
  }

  function material(id: string): ReadingLesson {
    const prepared = reading.get(id);
    if (prepared) return prepared;
    const stored = db.query<MaterialRow, [string]>('SELECT * FROM learning_materials WHERE id = ?').get(id);
    if (!stored) throw new StoreError('That reading material does not exist.', 404);
    return JSON.parse(stored.lesson_json) as ReadingLesson;
  }

  function ensureReview(view: ReviewDescriptor, at: Date): ReviewRow {
    const identity = JSON.stringify([view.kind, view.itemId, view.mode, view.exerciseIndex ?? null]);
    const previous = reviewByIdentity.get(identity);
    if (previous) return previous;
    const row: ReviewRow = {
      id: crypto.randomUUID(), identity_key: identity, view_json: JSON.stringify(view), skill: view.skill, title: view.title,
      fsrs_json: JSON.stringify(createEmptyCard(at)), due_at: at.getTime(), cycle_helped: 0,
    };
    db.query('INSERT INTO learning_reviews VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.identity_key, row.view_json, row.skill, row.title, row.fsrs_json, row.due_at, row.cycle_helped);
    return row;
  }

  function schedule(row: ReviewRow, kind: LearningFeedback['kind'], outcome: LearningOutcome, at: Date): string | null {
    // A correct early rehearsal is useful practice, not another spaced recall or interval extension.
    if (kind === 'correct' && row.due_at > at.getTime()) return null;
    const rating = kind !== 'correct' ? Rating.Again : outcome === 'independent' ? Rating.Good : Rating.Hard;
    const result = scheduler.next(JSON.parse(row.fsrs_json) as CardInput, at, rating);
    // FSRS records the lapse; its follow-up is immediately available for a corrective rehearsal.
    const card: Card = kind === 'correct' ? result.card : { ...result.card, due: at };
    db.query('UPDATE learning_reviews SET fsrs_json = ?, due_at = ?, cycle_helped = ? WHERE id = ?')
      .run(JSON.stringify(card), card.due.getTime(), Number(kind !== 'correct'), row.id);
    return JSON.stringify(result.log);
  }

  function exercise(input: LearningAttemptInput): { view: ReviewDescriptor; answers: string[]; explanation: string; choices?: string[] } {
    if (input.kind === 'listening') {
      const lesson = listening.get(input.itemId);
      if (!lesson) throw new StoreError('That listening lesson does not exist.', 404);
      if (input.exerciseIndex !== undefined) throw new StoreError('This listening exercise does not have a turn index.');
      const view: ReviewDescriptor = { kind: 'listening', itemId: lesson.id, mode: input.mode, title: lesson.title, skill: 'listening' };
      if (input.mode === 'meaning') return {
        view: { ...view, title: `${lesson.title} · Meaning` }, choices: lesson.meaning.choices,
        answers: [lesson.meaning.choices[lesson.meaning.correctIndex]!], explanation: lesson.meaning.explanation,
      };
      if (input.mode === 'gap') return {
        view: { ...view, title: `${lesson.title} · Missing words` },
        answers: [lesson.gap.answer, ...(lesson.gap.alternatives ?? [])], explanation: lesson.gap.explanation,
      };
      if (input.mode === 'dictation') return {
        view: { ...view, title: `${lesson.title} · Dictation` }, answers: [lesson.fr], explanation: lesson.en,
      };
      throw new StoreError('Choose meaning, missing words, or dictation for this listening lesson.');
    }
    if (input.kind === 'conversation') {
      const lesson = conversations.get(input.itemId);
      if (!lesson) throw new StoreError('That conversation does not exist.', 404);
      if (input.mode !== 'reply' || !Number.isSafeInteger(input.exerciseIndex) || input.exerciseIndex! < 0) {
        throw new StoreError('Choose a conversation turn to answer.');
      }
      const turn = lesson.turns[input.exerciseIndex!];
      if (!turn) throw new StoreError('That conversation turn does not exist.', 404);
      return {
        view: { kind: 'conversation', itemId: lesson.id, mode: 'reply', exerciseIndex: input.exerciseIndex, skill: 'recognition', title: `${lesson.title} · ${turn.prompt}` },
        choices: turn.choices, answers: [turn.choices[turn.correctIndex]!], explanation: turn.explanation,
      };
    }
    if (input.kind === 'material') {
      const lesson = material(input.itemId);
      if (input.mode !== 'practice' || !Number.isSafeInteger(input.exerciseIndex) || input.exerciseIndex! < 0) {
        throw new StoreError('Choose a phrase practice from this reading material.');
      }
      const practice = lesson.practice?.[input.exerciseIndex!];
      if (!practice) throw new StoreError('That reading practice does not exist.', 404);
      return {
        view: { kind: 'material', itemId: lesson.id, mode: 'practice', exerciseIndex: input.exerciseIndex, skill: 'production', title: `${lesson.title} · ${practice.answer}` },
        answers: [practice.answer], explanation: practice.explanation,
      };
    }
    throw new StoreError('Choose listening, conversation, or reading practice.');
  }

  function attempt(input: LearningAttemptInput): LearningFeedback {
    requireText(input.itemId, 'Choose a learning exercise.');
    requireText(input.answer, 'Write or choose an answer before checking it.');
    if (typeof input.assisted !== 'boolean') throw new StoreError('Include whether you used the transcript, translation, or answer.');
    const payload = JSON.stringify({ kind: input.kind, itemId: input.itemId, mode: input.mode, answer: input.answer, exerciseIndex: input.exerciseIndex ?? null, assisted: input.assisted });
    return db.transaction(() => {
      const previous = replay(input.requestId, 'attempt', payload);
      if (previous) return JSON.parse(previous.result_json) as LearningFeedback;
      const current = exercise(input);
      const answer = normalize(input.answer);
      if (!answer) throw new StoreError('Write or choose an answer before checking it.');
      if (current.choices && !current.choices.some((choice) => normalize(choice) === answer)) throw new StoreError('Choose one of the offered answers.');
      const correct = current.answers.some((accepted) => normalize(accepted) === answer);
      const spelling = !correct && !current.choices && current.answers.some((accepted) => withoutAccents(normalize(accepted)) === withoutAccents(answer));
      const at = now();
      const row = ensureReview(current.view, at);
      const outcome: LearningOutcome = !correct && !spelling ? 'revisit'
        : spelling || input.assisted || row.cycle_helped || row.due_at > at.getTime() ? 'helped' : 'independent';
      const feedback: LearningFeedback = {
        kind: correct ? 'correct' : spelling ? 'spelling' : 'incorrect', answer: current.answers[0]!, outcome, reviewId: row.id,
        explanation: spelling ? `The words match; check the French accents in the answer. ${current.explanation}` : current.explanation,
      };
      const fsrsLog = schedule(row, feedback.kind, outcome, at);
      appendRequest.run(input.requestId, 'attempt', payload, JSON.stringify(feedback), at.toISOString());
      appendGrade.run(input.requestId, row.id, input.answer, feedback.kind, outcome, 'prepared', at.toISOString(), fsrsLog);
      return feedback;
    }).immediate();
  }

  function phraseView(row: PhraseRow): SavedPhrase {
    return { id: row.id, fr: row.fr, en: row.en, explanation: row.explanation, sourceId: row.source_id, createdAt: row.created_at };
  }

  function savePhrase(input: PhraseInput): SavedPhrase {
    requireText(input.fr, 'Choose a French phrase to save.');
    requireText(input.en, 'Include the meaning of the phrase.');
    requireText(input.sourceId, 'Include where this phrase came from.');
    if (typeof input.explanation !== 'string') throw new StoreError('Include the phrase explanation, or an empty explanation.');
    if (!normalize(input.fr) || !normalize(input.en)) throw new StoreError('Include the phrase and its meaning, not only punctuation.');
    const payload = JSON.stringify({ fr: input.fr, en: input.en, explanation: input.explanation, sourceId: input.sourceId });
    return db.transaction(() => {
      const previous = replay(input.requestId, 'phrase', payload);
      if (previous) return JSON.parse(previous.result_json) as SavedPhrase;
      const at = now();
      const key = JSON.stringify([normalize(input.fr), normalize(input.en)]);
      let row = db.query<PhraseRow, [string]>('SELECT * FROM learning_phrases WHERE phrase_key = ?').get(key);
      if (!row) {
        row = { id: crypto.randomUUID(), phrase_key: key, fr: input.fr.trim(), en: input.en.trim(), explanation: input.explanation, source_id: input.sourceId, created_at: at.toISOString() };
        db.query('INSERT INTO learning_phrases VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(row.id, row.phrase_key, row.fr, row.en, row.explanation, row.source_id, row.created_at);
        for (const direction of ['fr-en', 'en-fr'] as const) {
          ensureReview({
            kind: 'phrase', itemId: row.id, mode: direction, title: `${row.fr} · ${direction === 'fr-en' ? 'French → English' : 'English → French'}`,
            skill: direction === 'fr-en' ? 'recognition' : 'production', fr: row.fr, en: row.en, explanation: row.explanation,
          }, at);
        }
      }
      db.query('INSERT OR IGNORE INTO learning_phrase_sources VALUES (?, ?, ?)').run(row.id, input.sourceId, at.toISOString());
      const phrase = phraseView(row);
      appendRequest.run(input.requestId, 'phrase', payload, JSON.stringify(phrase), at.toISOString());
      return phrase;
    }).immediate();
  }

  function progressAt(at: Date): ReviewOverview {
    const due = db.query<ReviewRow, [number]>('SELECT * FROM learning_reviews WHERE due_at <= ? ORDER BY due_at, rowid').all(at.getTime())
      .map((row): ReviewItem => ({ ...JSON.parse(row.view_json) as ReviewDescriptor, id: row.id, dueAt: new Date(row.due_at).toISOString() }));
    const topics = db.query<TopicSummary, []>(`
      SELECT r.title, r.skill, g.source, COUNT(*) AS attempts,
        SUM(g.outcome = 'independent') AS successes, SUM(g.outcome = 'helped') AS helped, SUM(g.outcome = 'revisit') AS revisit,
        (SELECT outcome FROM learning_grades WHERE review_id = r.id ORDER BY sequence DESC LIMIT 1) AS latest
      FROM learning_grades g JOIN learning_reviews r ON r.id = g.review_id GROUP BY r.id, g.source ORDER BY MAX(g.sequence) DESC
    `).all();
    const vocabulary: ReviewOverview['vocabulary'] = [];
    if (options.vocabulary) {
      for (const direction of ['fr-en', 'en-fr'] as const) {
        const { unseenActive, seenActive, remaining } = options.vocabulary.state(direction, 'all').overview;
        vocabulary.push({ direction, unseenActive, seenActive, remaining });
      }
      const exported = options.vocabulary.exportData() as VocabularyExport;
      const words = new Map((options.words ?? exported.words).map((word) => [word.id, word]));
      const undone = new Set(exported.undos.map((undo) => undo.grade_sequence));
      const recall = new Map<string, TopicSummary>();
      for (const grade of exported.grades) {
        const word = words.get(grade.word_id);
        if (undone.has(grade.sequence) || !word) continue;
        const key = JSON.stringify([grade.direction, word.id]);
        let topic = recall.get(key);
        if (!topic) {
          topic = {
            title: `${word.fr} · ${grade.direction === 'fr-en' ? 'French → English' : 'English → French'}`,
            skill: grade.direction === 'fr-en' ? 'recognition' : 'production', attempts: 0, successes: 0, helped: 0, revisit: 0,
            source: 'self-rated', latest: 'revisit',
          };
          recall.set(key, topic);
        }
        topic.attempts += 1;
        topic.successes += Number(!!grade.known);
        topic.revisit += Number(!grade.known);
        topic.latest = grade.known ? 'independent' : 'revisit';
      }
      topics.push(...recall.values());
    }
    const grammar: ReviewOverview['grammar'] = [];
    if (options.grammar) {
      const exported = options.grammar.exportData() as GrammarExport;
      const currentIds = new Map(exported.topics.map((topic) => [topic.id, new Set(topic.exercises.map((exercise) => exercise.id))]));
      const byTopic = new Map<string, { helped: number; revisit: number }>();
      for (const record of exported.progress) {
        if (!currentIds.get(record.topic_id)?.has(record.exercise_id)) continue;
        const counts = byTopic.get(record.topic_id) ?? { helped: 0, revisit: 0 };
        if (record.outcome === 'helped') counts.helped += 1;
        if (record.outcome === 'revisit') counts.revisit += 1;
        byTopic.set(record.topic_id, counts);
      }
      for (const topic of options.grammar.catalog().flatMap((unit) => unit.topics)) {
        grammar.push({ title: topic.title, independent: topic.progress.independent, ...(byTopic.get(topic.id) ?? { helped: 0, revisit: 0 }) });
      }
    }
    return {
      due,
      skills: (['recognition', 'listening', 'production'] as const).map((id) => {
        const records = topics.filter((topic) => topic.skill === id);
        return {
          id, label: id === 'production' ? 'Written production' : id === 'listening' ? 'Listening' : 'Recognition',
          attempts: records.reduce((total, topic) => total + topic.attempts, 0), independent: records.reduce((total, topic) => total + topic.successes, 0),
          helped: records.reduce((total, topic) => total + topic.helped, 0), revisit: records.reduce((total, topic) => total + topic.revisit, 0),
          due: due.filter((item) => item.skill === id).length,
        };
      }),
      goingWell: topics.filter((topic) => topic.latest === 'independent').map(({ title, skill, successes, attempts, source }) => ({ title, skill, successes, attempts, source })),
      needsPractice: topics.filter((topic) => topic.latest !== 'independent').map(({ title, skill, helped, revisit, attempts, source }) => ({ title, skill, misses: helped + revisit, attempts, source })),
      vocabulary, grammar,
    };
  }

  function progress(): ReviewOverview {
    return db.transaction(() => progressAt(now()))();
  }

  function review(input: ReviewInput): ReviewOverview {
    requireText(input.reviewId, 'Choose a review card.');
    if (typeof input.known !== 'boolean') throw new StoreError('Choose whether you recalled the answer.');
    const payload = JSON.stringify({ reviewId: input.reviewId, known: input.known });
    return db.transaction(() => {
      const previous = replay(input.requestId, 'review', payload);
      const at = now();
      if (previous) return progressAt(at);
      const row = reviewById.get(input.reviewId);
      if (!row) throw new StoreError('That review card does not exist.', 404);
      const item = JSON.parse(row.view_json) as ReviewDescriptor;
      if (item.kind !== 'phrase') throw new StoreError('Answer the prepared exercise to review this item.');
      if (row.due_at > at.getTime()) throw new StoreError('This card was already reviewed. Refresh to see the remaining due cards.', 409);
      const outcome: LearningOutcome = !input.known ? 'revisit' : row.cycle_helped ? 'helped' : 'independent';
      const kind = input.known ? 'correct' : 'incorrect';
      const fsrsLog = schedule(row, kind, outcome, at);
      appendRequest.run(input.requestId, 'review', payload, JSON.stringify({ reviewId: row.id }), at.toISOString());
      appendGrade.run(input.requestId, row.id, input.known ? 'recalled' : 'not recalled', kind, outcome, 'self-rated', at.toISOString(), fsrsLog);
      return progressAt(at);
    }).immediate();
  }

  function jobView(row: TutorRow): TutorJob {
    return {
      id: row.id, input: JSON.parse(row.input_json) as TutorInput, status: row.status, progress: row.progress,
      ...(row.result_json !== null ? { result: JSON.parse(row.result_json) as TutorJob['result'] } : {}),
      ...(row.error !== null ? { error: row.error } : {}), createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  function getTutorJob(id: string): TutorJob | null {
    const row = tutorById.get(id);
    return row ? jobView(row) : null;
  }

  function createTutorJob(input: TutorInput): { job: TutorJob; isNew: boolean } {
    if (input.kind !== 'writing' && input.kind !== 'material') throw new StoreError('Choose writing feedback or material explanation.');
    requireText(input.text, 'Add your text before asking the local tutor.');
    requireText(input.sourceId, 'Include the source of this tutor request.');
    if ((input.prompt !== undefined && typeof input.prompt !== 'string') || (input.title !== undefined && typeof input.title !== 'string')) {
      throw new StoreError('The writing prompt and material title must be text.');
    }
    const payload = JSON.stringify({ kind: input.kind, text: input.text, sourceId: input.sourceId, prompt: input.prompt ?? null, title: input.title ?? null });
    return db.transaction(() => {
      const previous = replay(input.requestId, 'tutor', payload);
      if (previous) {
        const result = JSON.parse(previous.result_json) as TutorRequestResult;
        return { job: getTutorJob(result.id)!, isNew: false };
      }
      const at = now().toISOString();
      const job: TutorJob = { id: crypto.randomUUID(), input: { ...input }, status: 'queued', progress: 'Waiting for the local tutor. Your text is saved.', createdAt: at, updatedAt: at };
      db.query(`INSERT INTO learning_tutor_jobs (id, source_id, kind, input_json, status, progress, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(job.id, input.sourceId, input.kind, JSON.stringify(input), job.status, job.progress, at, at);
      appendRequest.run(input.requestId, 'tutor', payload, JSON.stringify({ id: job.id }), at);
      return { job, isNew: true };
    }).immediate();
  }

  function lastTutorJob(sourceId: string, kind: TutorInput['kind']): TutorJob | null {
    if (kind !== 'writing' && kind !== 'material') throw new StoreError('Choose writing feedback or material explanation.');
    const row = db.query<TutorRow, [string, string]>('SELECT * FROM learning_tutor_jobs WHERE source_id = ? AND kind = ? ORDER BY sequence DESC LIMIT 1').get(sourceId, kind);
    return row ? jobView(row) : null;
  }

  function updateTutorJob(id: string, patch: TutorPatch): TutorJob {
    return db.transaction(() => {
      const row = tutorById.get(id);
      if (!row) throw new StoreError('That tutor request does not exist.', 404);
      if (patch.status !== undefined && !['queued', 'loading', 'working', 'releasing', 'complete', 'cancelled', 'error'].includes(patch.status)) throw new StoreError('That tutor status is not supported.');
      if ((patch.progress !== undefined && typeof patch.progress !== 'string') || (patch.error !== undefined && typeof patch.error !== 'string')) throw new StoreError('Tutor progress and errors must be text.');
      if (patch.result !== undefined && (!patch.result || patch.result.kind !== row.kind)) throw new StoreError('The tutor result does not match the submitted request.');
      const previous = jobView(row);
      const job: TutorJob = {
        ...previous, ...patch, status: patch.status ?? previous.status,
        progress: patch.progress ?? previous.progress, updatedAt: now().toISOString(),
      };
      if (job.status === 'complete' && !job.result) throw new StoreError('A completed tutor request needs its result.');
      db.query('UPDATE learning_tutor_jobs SET status = ?, progress = ?, result_json = ?, error = ?, updated_at = ? WHERE id = ?')
        .run(job.status, job.progress, job.result === undefined ? null : JSON.stringify(job.result), job.error ?? null, job.updatedAt, id);
      return job;
    }).immediate();
  }

  function cancelInterruptedTutorJobs(): void {
    db.query(`UPDATE learning_tutor_jobs SET status = 'cancelled', progress = ?, error = ?, updated_at = ? WHERE status IN ('queued', 'loading', 'working', 'releasing')`)
      .run('Interrupted when Echo stopped. Your submitted text is saved; ask again to restart.', 'The local tutor was interrupted. No work was resumed automatically.', now().toISOString());
  }

  function storeMaterial(input: MaterialInput): ReadingLesson {
    requireText(input.text, 'Add the French text to import.');
    requireText(input.sourceId, 'Include the source of the imported text.');
    if (input.title !== undefined && typeof input.title !== 'string') throw new StoreError('The material title must be text.');
    if (!input.explanation || typeof input.explanation.translation !== 'string' || typeof input.explanation.explanation !== 'string' || !Array.isArray(input.explanation.annotations)) {
      throw new StoreError('The material explanation needs a translation and annotations.');
    }
    return db.transaction(() => {
      const existing = db.query<MaterialRow, [string, string]>('SELECT * FROM learning_materials WHERE source_id = ? AND text = ?').get(input.sourceId, input.text);
      if (existing) return JSON.parse(existing.lesson_json) as ReadingLesson;
      const annotations = groundedAnnotations(input.text, input.explanation.annotations);
      const omitted = annotations.length !== input.explanation.annotations.length;
      const lesson: ReadingLesson = {
        id: `material-${createHash('sha256').update(JSON.stringify([input.sourceId, input.text])).digest('hex')}`,
        title: input.title?.trim() || 'My French material', kind: 'imported', fr: input.text, en: input.explanation.translation,
        explanation: `${input.explanation.explanation}${omitted ? '\nSome suggested annotations were omitted because they were repeated or not exact phrases in your text.' : ''}`,
        annotations, writingPrompt: 'Write a short response to this text, using a phrase you want to remember.', modelAnswer: '',
        practice: practiceFor(input.text, annotations),
      };
      db.query('INSERT INTO learning_materials VALUES (?, ?, ?, ?, ?)').run(lesson.id, input.sourceId, input.text, JSON.stringify(lesson), now().toISOString());
      return lesson;
    }).immediate();
  }

  function exportData(): unknown {
    return db.transaction(() => ({
      format: 'echo-learning-progress', version: 1, exportedAt: now().toISOString(), content: catalog,
      reviews: db.query<ReviewRow, []>('SELECT * FROM learning_reviews ORDER BY rowid').all().map(({ view_json, fsrs_json, ...row }) => ({ ...row, item: JSON.parse(view_json), fsrs: JSON.parse(fsrs_json) })),
      grades: db.query<GradeRow, []>('SELECT * FROM learning_grades ORDER BY sequence').all().map(({ fsrs_log, ...row }) => ({ ...row, fsrsLog: fsrs_log === null ? null : JSON.parse(fsrs_log) })),
      requests: db.query<RequestRow, []>('SELECT * FROM learning_requests ORDER BY rowid').all().map(({ payload_json, result_json, ...row }) => ({ ...row, payload: JSON.parse(payload_json), result: JSON.parse(result_json) })),
      phrases: db.query<PhraseRow, []>('SELECT * FROM learning_phrases ORDER BY rowid').all().map(phraseView),
      phraseSources: db.query('SELECT * FROM learning_phrase_sources ORDER BY rowid').all(),
      materials: db.query<MaterialRow, []>('SELECT * FROM learning_materials ORDER BY rowid').all().map(({ lesson_json, ...row }) => ({ ...row, lesson: JSON.parse(lesson_json) })),
      tutorJobs: db.query<TutorRow, []>('SELECT * FROM learning_tutor_jobs ORDER BY sequence').all().map(jobView),
    }))();
  }

  cancelInterruptedTutorJobs();
  return {
    catalog: () => catalog,
    materials: () => [...catalog.reading, ...db.query<MaterialRow, []>('SELECT * FROM learning_materials ORDER BY rowid').all().map((row) => JSON.parse(row.lesson_json) as ReadingLesson)]
      .map(({ id, title, kind }) => ({ id, title, kind })),
    material, attempt, savePhrase, review, progress, createTutorJob, getTutorJob, lastTutorJob, updateTutorJob, storeMaterial, cancelInterruptedTutorJobs,
    exportData, close: () => db.close(),
  };
}
