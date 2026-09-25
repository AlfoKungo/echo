export type Direction = 'fr-en' | 'en-fr';
export type Word = { id: string; fr: string; en: string; category: string; note?: string };
export type Deck = { id: string; title: string; count: number };
// songsFirst: words added from songs are introduced before all other new words; otherwise each song takes
// its turn with the categories.
export type Settings = { newPerDay: number; songsFirst: boolean };
// A word the learner added from a song: the store gives it an id in the song's own category.
export type NewWord = { fr: string; en: string; note?: string };
export type AddWordsInput = { category: string; title: string; words: NewWord[] };
export type VocabularyStack = 'unseen' | 'failed' | 'successful';
export type CardView = Word & { successes: number; version: number; stack: VocabularyStack; stage: 'new' | 'learning' | 'review'; audioUrl: string };
// Active counts exclude finished cards; unseen also includes the available daily admission allowance.
// Stack membership survives the 04:00 allowance reset until the practice cycle is completed.
// scheduled counts finished words waiting for a later review; scheduledMissed is the subset ever missed.
// recording counts unseen words from songs still waiting for their recording; newAvailable leaves them out.
export type Stats = { total: number; unseen: number; seenActive: number; unseenActive: number; introducedToday: number; newAvailable: number; learning: number; due: number; completedToday: number; remaining: number; scheduled: number; scheduledMissed: number; recording: number };
// stats follows the selected category; overview covers all words in the selected direction.
// extraToday is the extra allowance granted for this study day in this direction.
// next is the card that follows current once it is answered (known or not); null when none, or when it would be current again.
export type Snapshot = { day: string; direction: Direction; deck: string; settings: Settings; extraToday: number; decks: Deck[]; stats: Stats; overview: Stats; current: CardView | null; next: CardView | null; nextDue: string | null; undoId: string | null };
export type GradeInput = { direction: Direction; deck: string; wordId: string; version: number; known: boolean; requestId: string };
export type ExtraWordsInput = { direction: Direction; deck: string; count: number; requestId: string };
export type ReviewEarlyMode = 'soonest' | 'missed';
export type ReviewEarlyInput = { direction: Direction; deck: string; mode: ReviewEarlyMode; count: number; requestId: string };
// lastStudied is the latest answer's time; misses counts every miss ever recorded (undone answers excluded).
export type BrowseWord = Word & { status: 'new' | 'learning' | 'due' | 'scheduled'; due: string | null; lastStudied: string | null; misses: number };
// score: recalls and Walkman listens raise it, misses lower it, and it fades with time (see lib/store.ts).
export type ListeningWord = BrowseWord & { score: number };
export type HeardInput = { wordId: string; requestId: string };
// Statistics. words lists every started word, weakest score first. counts covers all words. A category's average
// is the mean score of its started words (null before any). days holds the last 14 study days, oldest first,
// counting vocabulary answers in both directions, undone ones excluded. gained and lost are that day's points as
// they were scored, before fading: recalls, Walkman listens and ✓ marks add, misses and ✗ marks take away.
export type StatsWord = Pick<ListeningWord, 'id' | 'fr' | 'en' | 'category' | 'status' | 'score' | 'misses'>;
export type StatsCategory = { id: string; title: string; total: number; started: number; average: number | null };
export type StatsDay = { day: string; knew: number; missed: number; gained: number; lost: number };
export type VocabularyStatistics = { words: StatsWord[]; counts: Record<BrowseWord['status'], number>; categories: StatsCategory[]; days: StatsDay[]; walkmanHeard: number };
export type Statistics = VocabularyStatistics & { levels: { mode: 'listen' | 'read'; label: GrammarLevel }[]; answered: number; grammarTopics: number };
// A mark on one listen: id stays the same while the learner changes their mind; knew:null withdraws it.
export type VerdictInput = { id: string; wordId: string; knew: boolean | null };
// words: 'scored' draws familiar words by score; 'groups' goes through learning, due and known words in turn.
export type WalkmanChoice = 'scored' | 'groups';
// Adding a word the learner tapped in a French text, always in the fr-en direction.
// added: it was never started, so today admits it as an extra word, leaving the daily allowance untouched.
// already-practising: it is in the working deck already (a cycle in progress, or finished and due again).
// made-due: it was finished and waiting for a later review, so it becomes due now, like an early review.
export type AddWordInput = { wordId: string; requestId: string };
export type AddWordResult = { status: 'added' | 'already-practising' | 'made-due' };
// One word on a Walkman tape, times in seconds from the tape's start: the French at start, the English at
// meaningAt, the French again at againAt, ending at end. fresh: not yet started in Vocabulary when the tape was made.
export type WalkmanWord = { id: string; fr: string; en: string; fresh: boolean; start: number; meaningAt: number; againAt: number; end: number };
export type WalkmanTape = { id: string; url: string; seconds: number; words: WalkmanWord[] };

// All routes are relative to the app root, so /echo/ works behind a path proxy.
// GET api/state?direction=fr-en&deck=all -> Snapshot (does not admit new cards)
// POST api/session {direction,deck} -> Snapshot (admits up to remaining daily allowance)
// POST api/grade GradeInput -> Snapshot; a stale card version is HTTP 409, never double-graded
// POST api/undo {direction,deck,undoId} -> Snapshot (undo only the latest matching grade)
// PUT api/settings {newPerDay:number} -> Settings (0..number of words, integer)
// POST api/extra-words ExtraWordsInput -> Snapshot (adds to today's allowance only, then admits; idempotent by requestId)
// POST api/review-early ReviewEarlyInput -> Snapshot (makes finished words due now; counts as a real FSRS review; idempotent)
// GET api/words?direction=fr-en&deck=all -> {words:BrowseWord[]}
// POST api/vocabulary/add AddWordInput -> AddWordResult (idempotent by requestId; unknown word is HTTP 404)
// GET audio/:id.mp3 -> French Chatterbox recording, or actionable JSON error
// POST api/walkman {words?:WalkmanChoice} -> WalkmanTape: a new tape of the words worth hearing now ('scored' by default)
// POST api/walkman/heard HeardInput -> {ok:true}: a word heard to the end, which raises its score a little
// POST api/walkman/verdict VerdictInput -> {ok:true}: 'I knew it' raises the word's score like a recall, 'I didn't' lowers it like a miss
// GET api/walkman/:id.mp3 -> that tape's audio, with byte ranges; only the latest few tapes are kept
// GET api/statistics -> Statistics
// GET api/export -> all progress as downloadable JSON
// Errors are {error:string}; UI must display the server message and allow retry.

export type GrammarExerciseType = 'rewrite' | 'build' | 'complete' | 'repair' | 'choose' | 'translate' | 'conjugate';
export type GrammarLevel = 'A1' | 'A2' | 'B1';
// Content lives in content/grammar/: units.json lists units in course order, each naming its topic files.
// build: tokens (answers must be buildable; unused distractor tiles are allowed).
// choose: options (2–5, distinct); exactly one answer, which is one of the options.
// complete: source holds exactly one ____ blank; answers are the missing text.
// translate: source is English; answers list every accepted French translation.
// conjugate: source is "verb · subject · tense"; answers list the form with and without the subject.
// Typed answers that differ from an accepted answer only in accents (œ/oe included) or commas count as correct
// with a spelling note; strictAccents keeps accents strict where the accent is the point (a/à, ou/où).
export type GrammarExercise = {
  id: string;
  pattern: string;
  type: GrammarExerciseType;
  instruction: string;
  source: string;
  tokens?: string[];
  options?: string[];
  answers: string[];
  spellingAnswers?: string[];
  alternatives?: { answer: string; message: string; accepted?: boolean }[];
  strictAccents?: boolean;
  hint: string;
  feedback: string;
  explanation: string;
};
export type GrammarTopicContent = {
  id: string;
  unit: string;
  level: GrammarLevel;
  title: string;
  description: string;
  mark: string;
  rule: string;
  example: string;
  aside: string;
  exercises: GrammarExercise[];
};
export type GrammarUnitContent = { id: string; title: string; description: string; topics: string[] };
export type GrammarProgress = { seen: number; independent: number; needsReview: number };
export type GrammarScore = { score: number; total: number };
// taken counts finished tests of one scope; best is the highest score/total ratio, last the most recent finish.
export type GrammarTestSummary = { taken: number; best: GrammarScore | null; last: (GrammarScore & { finishedAt: string }) | null };
export type GrammarTopic = Omit<GrammarTopicContent, 'exercises'> & {
  exerciseCount: number;
  practiceLength: number;
  testLength: number;
  progress: GrammarProgress;
  hasActiveSession: boolean;
  hasActiveTest: boolean;
  test: GrammarTestSummary;
};
export type GrammarUnitView = Omit<GrammarUnitContent, 'topics'> & {
  topics: GrammarTopic[];
  testLength: number;
  hasActiveTest: boolean;
  test: GrammarTestSummary;
};
export type GrammarMode = 'practice' | 'test';
export type GrammarScopeKind = 'practice' | 'topic-test' | 'unit-test';
// In a test, answer and explanation are always present; note carries an alternative's message.
export type GrammarFeedback = {
  kind: 'correct' | 'incorrect' | 'alternative' | 'shown';
  message: string;
  answer?: string;
  spelling?: boolean;
  note?: string;
};
export type GrammarCurrent = {
  exercise: Pick<GrammarExercise, 'id' | 'type' | 'instruction' | 'source' | 'tokens' | 'options'> & { topicId: string; topicTitle: string };
  answer: string;
  tokenOrder: number[];
  attempts: number;
  assisted: boolean;
  hint: string | null;
  feedback: GrammarFeedback | null;
  settled: boolean;
  misses: string[];
  // Set once this exercise is settled and its recording exists: audio/grammar/<exercise id>.mp3, else null.
  audio: string | null;
};
export type GrammarResult = {
  exerciseId: string;
  topicId: string;
  topicTitle: string;
  type: GrammarExerciseType;
  source: string;
  answer: string;
  given: string;
  outcome: 'independent' | 'helped' | 'revisit';
  spelling?: boolean;
};
export type GrammarSession = {
  id: string;
  mode: GrammarMode;
  version: number;
  index: number;
  total: number;
  complete: boolean;
  current: GrammarCurrent | null;
  results: GrammarResult[];
  score?: number;
};
export type GrammarSnapshot = {
  scope: string;
  kind: GrammarScopeKind;
  topic: GrammarTopic | null;
  unit: GrammarUnitView | null;
  session: GrammarSession | null;
};
export type GrammarMutation = {
  sessionId: string;
  exerciseId: string;
  version: number;
  requestId: string;
};
export type GrammarAnswerInput = GrammarMutation & { answer: string; tokenOrder?: number[] };
export type GrammarHelpInput = GrammarMutation & { kind: 'hint' | 'rule' | 'answer' };
// One exercise the learner has not got right on their own, newest first. example is its spoken French sentence;
// sequence orders the misses (the request that last touched the exercise).
export type GrammarMiss = { topicId: string; topicTitle: string; exerciseId: string; example: string; sequence: number };

// A scope names one resumable session line: "<topicId>" is practice, "test:<topicId>" a topic test,
// "unit:<unitId>" a unit test, "review" a practice round across every topic the learner has touched.
// Each scope keeps its own latest session, so a round and a test can both be open.
// The review scope has no topic or unit (both are null) and never appears in the grammar list; Practise starts it.
// GET api/grammar -> {units:GrammarUnitView[]} in course order, topics in unit order, without exercises.
// GET api/grammar/state?scope=key -> GrammarSnapshot; topic is set for topic scopes, unit for unit scopes.
// POST api/grammar/session {scope,requestId} -> GrammarSnapshot; resumes the scope's unfinished session or starts one:
//   practice 10 questions (missed test items first, then fresh variants of struggled patterns, unseen, to revisit, known;
//   at most 3 per pattern, at least 3 question types, neighbours differ in pattern where possible);
//   topic test 15 (round-robin over patterns, avoiding the previous test's questions); unit test 20 (round-robin over topics).
//   review 10 questions over the touched topics (missed test items first, then to revisit or helped, then their unseen
//   questions, then the ones answered alone longest ago), with the same variety rules; 409 before any topic is touched.
// POST api/grammar/answer GrammarAnswerInput -> GrammarSnapshot; build answers derive from tokenOrder; choose answers must be an option.
// POST api/grammar/help GrammarHelpInput -> GrammarSnapshot; requesting help is saved before displaying it. Tests refuse help (409).
// POST api/grammar/next GrammarMutation -> GrammarSnapshot; only a settled answer can advance. Finishing a test records its score.
// Mutations are idempotent by requestId and return current state on replay; stale versions return HTTP 409.
// Practice: a correct check settles independent (helped after help or a retry); a shown answer settles revisit.
// Test: the first non-blank answer settles; correct or spelling is independent, anything else revisit. score counts independent results.
// Every settlement updates the exercise's own topic progress, whichever scope asked it.
// Session index is zero-based. Results include settled examples, including the current one before Next; given is the last checked text.
// misses lists checked answers that were not accepted (a choose question marks these options).
// Correct checks and shown answers settle once; later rule views cannot turn unaided success into assisted success.
// Rule and exercise prose are plain text, never HTML. The example separates sentences with " · ".
// Word tiles may include distractors: selected indices are unique, but using every tile is not required.
// Complete sources (and most choose sources) use ____ for the missing text, so summaries can show the finished sentence.
// GrammarCurrent.audio names the settled exercise's spoken French, audio/grammar/<exercise id>.mp3, when that file exists.
// GET audio/grammar/:id.mp3 -> the spoken correct sentence, or actionable JSON error.
