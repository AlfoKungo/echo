export type Direction = 'fr-en' | 'en-fr';
export type Word = { id: string; fr: string; en: string; category: string; note?: string };
export type Deck = { id: string; title: string; count: number };
export type Settings = { newPerDay: number };
export type VocabularyStack = 'unseen' | 'failed' | 'successful';
export type CardView = Word & { successes: number; version: number; stack: VocabularyStack; stage: 'new' | 'learning' | 'review'; audioUrl: string };
// Active counts exclude finished cards; unseen also includes the available daily admission allowance.
// Stack membership survives the 04:00 allowance reset until the practice cycle is completed.
// scheduled counts finished words waiting for a later review; scheduledMissed is the subset ever missed.
export type Stats = { total: number; unseen: number; seenActive: number; unseenActive: number; introducedToday: number; newAvailable: number; learning: number; due: number; completedToday: number; remaining: number; scheduled: number; scheduledMissed: number };
// stats follows the selected category; overview covers all words in the selected direction.
// extraToday is the extra allowance granted for this study day in this direction.
export type Snapshot = { day: string; direction: Direction; deck: string; settings: Settings; extraToday: number; decks: Deck[]; stats: Stats; overview: Stats; current: CardView | null; nextDue: string | null; undoId: string | null };
export type GradeInput = { direction: Direction; deck: string; wordId: string; version: number; known: boolean; requestId: string };
export type ExtraWordsInput = { direction: Direction; deck: string; count: number; requestId: string };
export type ReviewEarlyMode = 'soonest' | 'missed';
export type ReviewEarlyInput = { direction: Direction; deck: string; mode: ReviewEarlyMode; count: number; requestId: string };
// lastStudied is the latest answer's time; misses counts every miss ever recorded (undone answers excluded).
export type BrowseWord = Word & { status: 'new' | 'learning' | 'due' | 'scheduled'; due: string | null; lastStudied: string | null; misses: number };

// All routes are relative to the app root, so /echo/ works behind a path proxy.
// GET api/state?direction=fr-en&deck=all -> Snapshot (does not admit new cards)
// POST api/session {direction,deck} -> Snapshot (admits up to remaining daily allowance)
// POST api/grade GradeInput -> Snapshot; a stale card version is HTTP 409, never double-graded
// POST api/undo {direction,deck,undoId} -> Snapshot (undo only the latest matching grade)
// PUT api/settings {newPerDay:number} -> Settings (0..number of words, integer)
// POST api/extra-words ExtraWordsInput -> Snapshot (adds to today's allowance only, then admits; idempotent by requestId)
// POST api/review-early ReviewEarlyInput -> Snapshot (makes finished words due now; counts as a real FSRS review; idempotent)
// GET api/words?direction=fr-en&deck=all -> {words:BrowseWord[]}
// GET audio/:id.mp3 -> French Chatterbox recording, or actionable JSON error
// GET api/export -> all progress as downloadable JSON
// Errors are {error:string}; UI must display the server message and allow retry.

export type GrammarExerciseType = 'rewrite' | 'build' | 'complete' | 'repair';
export type GrammarExercise = {
  id: string;
  pattern: string;
  type: GrammarExerciseType;
  instruction: string;
  source: string;
  tokens?: string[];
  answers: string[];
  spellingAnswers?: string[];
  alternatives?: { answer: string; message: string }[];
  hint: string;
  feedback: string;
  explanation: string;
};
export type GrammarTopicContent = {
  id: string;
  title: string;
  description: string;
  mark: string;
  rule: string;
  example: string;
  aside: string;
  exercises: GrammarExercise[];
};
export type GrammarProgress = { seen: number; independent: number; needsReview: number };
export type GrammarTopic = Omit<GrammarTopicContent, 'exercises'> & {
  exerciseCount: number;
  progress: GrammarProgress;
  hasActiveSession: boolean;
};
export type GrammarFeedback = {
  kind: 'correct' | 'incorrect' | 'alternative' | 'shown';
  message: string;
  answer?: string;
  spelling?: boolean;
};
export type GrammarCurrent = {
  exercise: Pick<GrammarExercise, 'id' | 'type' | 'instruction' | 'source' | 'tokens'>;
  answer: string;
  tokenOrder: number[];
  attempts: number;
  assisted: boolean;
  hint: string | null;
  feedback: GrammarFeedback | null;
  settled: boolean;
};
export type GrammarResult = {
  exerciseId: string;
  type: GrammarExerciseType;
  source: string;
  answer: string;
  outcome: 'independent' | 'helped' | 'revisit';
};
export type GrammarSession = {
  id: string;
  version: number;
  index: number;
  total: number;
  complete: boolean;
  current: GrammarCurrent | null;
  results: GrammarResult[];
};
export type GrammarSnapshot = { topic: GrammarTopic; session: GrammarSession | null };
export type GrammarMutation = {
  sessionId: string;
  exerciseId: string;
  version: number;
  requestId: string;
};
export type GrammarAnswerInput = GrammarMutation & { answer: string; tokenOrder?: number[] };
export type GrammarHelpInput = GrammarMutation & { kind: 'hint' | 'rule' | 'answer' };

// GET api/grammar -> {topics:GrammarTopic[]}; GET api/grammar/state?topic=id -> GrammarSnapshot.
// POST api/grammar/session {topicId,requestId} resumes an active round or starts a new three-example round.
// POST api/grammar/answer GrammarAnswerInput -> GrammarSnapshot; build answers derive from tokenOrder.
// POST api/grammar/help GrammarHelpInput -> GrammarSnapshot; requesting help is saved before displaying it.
// POST api/grammar/next GrammarMutation -> GrammarSnapshot; only a settled answer can advance.
// Mutations are idempotent by requestId and return current state on replay; stale versions return HTTP 409.
// Session index is zero-based. Results include settled examples, including the current one before Next.
// Correct checks and shown answers settle once; later rule views cannot turn unaided success into assisted success.
// Rule and exercise prose are plain text, never HTML. Spelling variants are explicitly authored, not accent-stripped.
// Word tiles may include distractors: selected indices are unique, but using every tile is not required.
// Complete-exercise sources use ____ for the missing text, so summaries can show the finished sentence.
