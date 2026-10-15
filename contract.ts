import type { Gender } from './lib/language';

export type Direction = 'fr-en' | 'en-fr';
// gender: a noun's, worked out by the store from its article or note under its language's rules (lib/store.ts genderOf).
export type Word = { id: string; fr: string; en: string; category: string; note?: string; gender?: Gender };
export type Deck = { id: string; title: string; count: number };
// songsFirst: words added from songs are introduced before all other new words; otherwise each song takes
// its turn with the categories.
export type Settings = { newPerDay: number; songsFirst: boolean };
// A word the learner added from a song: the store gives it an id in the song's own category.
export type NewWord = { fr: string; en: string; note?: string };
export type AddWordsInput = { category: string; title: string; words: NewWord[] };
// Words already in Echo that a song's deck holds too (by id); they keep their own category and progress.
export type LinkWordsInput = { category: string; title: string; ids: string[] };
export type VocabularyStack = 'unseen' | 'failed' | 'successful';
// trouble: set on a word missed TROUBLE_MISSES times or more in this direction (lib/store.ts), with the words of the
// same deck missed most alongside it, since words learnt together are the ones that get mixed up.
export type CardTrouble = { misses: number; alongside: Pick<Word, 'fr' | 'en' | 'gender'>[]; hook?: string };
export type CardView = Word & { successes: number; version: number; stack: VocabularyStack; stage: 'new' | 'learning' | 'review'; audioUrl: string; trouble?: CardTrouble };
// Active counts exclude finished cards; unseen also includes the available daily admission allowance.
// Stack membership survives the 04:00 allowance reset until the practice cycle is completed.
// scheduled counts finished words waiting for a later review; scheduledMissed is the subset ever missed.
// recording counts unseen words from songs still waiting for their recording; newAvailable leaves them out.
export type Stats = { total: number; unseen: number; seenActive: number; unseenActive: number; introducedToday: number; newAvailable: number; learning: number; due: number; completedToday: number; remaining: number; scheduled: number; scheduledMissed: number; recording: number };
// stats follows the selected category; overview covers all words in the selected direction.
// extraToday is the extra allowance granted for this study day in this direction.
// next is the card that follows current once it is answered (known or not); null when none, or when it would be current again.
// ahead: the cards after next, before the answers that decide them are saved, so quick answers never wait on the Mac:
// ahead[how current is answered].card is the card after next, and its after[how next is answered] the one after that.
// Each is a prediction; the reply to the saved answers is what counts.
export type CardAhead = { card: CardView | null; after?: { known: CardView | null; missed: CardView | null } };
export type CardsAhead = { known: CardAhead; missed: CardAhead };
export type Snapshot = { day: string; direction: Direction; deck: string; settings: Settings; extraToday: number; decks: Deck[]; stats: Stats; overview: Stats; current: CardView | null; next: CardView | null; ahead: CardsAhead | null; nextDue: string | null; undoId: string | null };
export type GradeInput = { direction: Direction; deck: string; wordId: string; version: number; known: boolean; requestId: string };
export type ExtraWordsInput = { direction: Direction; deck: string; count: number; requestId: string };
export type ReviewEarlyMode = 'soonest' | 'missed';
export type ReviewEarlyInput = { direction: Direction; deck: string; mode: ReviewEarlyMode; count: number; requestId: string };
// lastStudied is the latest answer's time; misses counts every miss ever recorded (undone answers excluded).
export type BrowseWord = Word & { status: 'new' | 'learning' | 'due' | 'scheduled'; due: string | null; lastStudied: string | null; misses: number };
// score: recalls and Walkman listens raise it, misses lower it, and it fades with time (see lib/store.ts).
export type ListeningWord = BrowseWord & { score: number };
// Word board: every word of a category, or for All words up to BOARD_LIMIT of the words in Cards right now (missed,
// then known, then waiting); each with its score. total counts them all. audioUrl is null while there is no recording.
export type BoardWord = Word & { score: number; audioUrl: string | null };
export type Board = { words: BoardWord[]; total: number };
export type HeardInput = { wordId: string; requestId: string };
// Statistics. words lists every started word, weakest score first. counts covers all words. A category's average
// is the mean score of its started words (null before any). days holds the last 14 study days, oldest first,
// counting vocabulary answers in both directions, undone ones excluded. gained and lost are that day's points as
// they were scored, before fading: recalls, Walkman listens and ✓ marks add, misses and ✗ marks take away.
export type StatsWord = Pick<ListeningWord, 'id' | 'fr' | 'en' | 'category' | 'status' | 'score' | 'misses' | 'gender'>;
export type StatsCategory = { id: string; title: string; total: number; started: number; average: number | null };
export type StatsDay = { day: string; knew: number; missed: number; gained: number; lost: number };
// The Word scores chart at the end of a study day: words known and still learning, of how many, every score added
// up (whole: stored scores are rounded, replayed ones are not), and each score bar (-8 to 8) as [known, still learning].
export type ScoreHistoryDay = { day: string; know: number; learning: number; total: number; sum: number; bins: [number, number][] };
// A past day's started words with the score and state they had at its end.
export type ScoreDayWords = { day: string; words: { id: string; score: number; known: boolean }[] };
export type VocabularyStatistics = { words: StatsWord[]; counts: Record<BrowseWord['status'], number>; categories: StatsCategory[]; days: StatsDay[]; walkmanHeard: number; history: ScoreHistoryDay[] };
// comprehensionDays: per study day of the last 14, Listen and Read answers right (on your own or with help) and in all.
export type ComprehensionDayCounts = { day: string; listen: { right: number; total: number }; read: { right: number; total: number } };
export type Statistics = VocabularyStatistics & { levels: { mode: 'listen' | 'read'; label: GrammarLevel }[]; answered: number; comprehensionDays: ComprehensionDayCounts[]; grammarTopics: number };
// A mark on one listen: id stays the same while the learner changes their mind; knew:null withdraws it.
export type VerdictInput = { id: string; wordId: string; knew: boolean | null };
// Endless: a stream of started words picked by score, with no stacks and no schedule. exclude lists the words
// shown most recently, newest first; they are passed over while anything else is left.
export type EndlessInput = { direction: Direction; deck: string; exclude?: string[] };
export type EndlessPick = { card: CardView | null; pool: number };
export type EndlessMarkInput = { requestId: string; direction: Direction; wordId: string; known: boolean };
// words: 'scored' draws familiar words by score; 'groups' goes through learning, due and known words in turn;
// 'sentences' plays Listen/Read sentences instead of words; 'verbs' the verb forms tape, 'change' the Change it tape.
export type WalkmanChoice = 'scored' | 'groups' | 'sentences' | 'verbs' | 'change';
// Adding a word the learner tapped in a French text, always in the fr-en direction.
// added: it was never started, so today admits it as an extra word, leaving the daily allowance untouched.
// already-practising: it is in the working deck already (a cycle in progress, or finished and due again).
// made-due: it was finished and waiting for a later review, so it becomes due now, like an early review.
export type AddWordInput = { wordId: string; requestId: string };
export type AddWordResult = { status: 'added' | 'already-practising' | 'made-due' };
// One word on a Walkman tape, times in seconds from the tape's start: the French at start, the pause to recall it
// from recallAt, the English at meaningAt, the French again at againAt, ending at end. fresh: not yet started in
// Vocabulary when the tape was made. sentence: a whole Listen/Read sentence (id is the sentence's), which hearing
// leaves the vocabulary untouched. On a verb tape, fr is the prompt (verb · tense · person), en the form, and verb
// names the form for marks and replays. On a Change it tape, fr is the answer and en its English; change holds the
// sentence, the cue and the changed form, and the times mark the sentence (start), the cue (recallAt), the pause to
// say it (meaningAt) and the answer (againAt).
export type WalkmanWord = { id: string; fr: string; en: string; fresh: boolean; sentence?: true; verb?: { verbId: string; tense: string; person: number; audio: string }; change?: { id: number; base: string; cue: string; form: string }; start: number; recallAt: number; meaningAt: number; againAt: number; end: number };
export type WalkmanTape = { id: string; kind: 'words' | 'sentences' | 'verbs' | 'change'; url: string; seconds: number; words: WalkmanWord[] };
// A word family: deck words built from one root, simplest first; each later member's note says how it is built.
export type WordFamily = { members: { id: string; note?: string }[] };
// A way French builds one word from another, with [from, to] example pairs taken from the word families.
export type WordPattern = { title: string; explanation: string; tip?: string; examples: [string, string][] };

// All routes are relative to the app root, so /echo/ works behind a path proxy.
// GET api/state?direction=fr-en&deck=all -> Snapshot (does not admit new cards)
// GET api/warm?screen=&direction=&deck= -> {ok: true}: the reads the phone's screen makes next, answered with nothing; it changes nothing
// POST api/session {direction,deck} -> Snapshot (admits up to remaining daily allowance)
// POST api/grade GradeInput -> Snapshot; a stale card version is HTTP 409, never double-graded
// POST api/undo {direction,deck,undoId} -> Snapshot (undo only the latest matching grade)
// PUT api/settings {newPerDay:number} -> Settings (0..number of words, integer)
// POST api/extra-words ExtraWordsInput -> Snapshot (adds to today's allowance only, then admits; idempotent by requestId)
// POST api/review-early ReviewEarlyInput -> Snapshot (makes finished words due now; counts as a real FSRS review; idempotent)
// GET api/words?direction=fr-en&deck=all -> {words:BrowseWord[]}
// POST api/vocabulary/add AddWordInput -> AddWordResult (idempotent by requestId; unknown word is HTTP 404)
// GET api/families -> {families:WordFamily[], patterns:WordPattern[]}: the deck's word families and the patterns
// they are built by; the client joins them with api/words
// GET audio/:id.mp3 -> French Chatterbox recording, or actionable JSON error
// POST api/walkman {words?:WalkmanChoice} -> WalkmanTape: a new tape of the words (or sentences) worth hearing now ('scored' by default)
// POST api/walkman/heard HeardInput -> {ok:true}: a word heard to the end, which raises its score a little
// POST api/change/heard {requestId, id} -> {ok:true}: a Change it drill heard to the end, once per request id
// POST api/endless/next EndlessInput -> EndlessPick: the next word of an Endless stream, likelier the lower its score
// POST api/endless/mark EndlessMarkInput -> {ok:true}: knew it +1 to the score, didn't -1; a retried request counts once
// POST api/endless/undo {requestId} -> {ok:true}: takes an Endless mark back
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
// mistakes: wrong answers a learner is likely to give, each with why it is wrong. A choose exercise lists every
// option that is not the answer; other types list the likeliest slips (another person's form, the unfixed repair
// source, the sentence built with the distractor tile). `why` never contains the right answer, since practice
// allows another try. row names the guide-table row (its first cell) that holds the answer, when there is one.
export type GrammarMistake = { answers: string[]; why: string };
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
  mistakes: GrammarMistake[];
  row?: string;
  strictAccents?: boolean;
  hint: string;
  feedback: string;
  explanation: string;
  // The meaning of each content word in a French source (choose, complete, repair, rewrite), tapped as in Read.
  gloss?: { fr: string; en: string; word?: string }[];
};
// A topic's guide: what the topic is for, then sections that each teach one point with a table of forms, steps
// for choosing, examples and traps. A table's first column labels its rows, and labels are unique in the table.
export type GrammarGuideTable = { columns: string[]; rows: string[][] };
export type GrammarGuideSection = {
  id: string;
  title: string;
  text?: string;
  table?: GrammarGuideTable;
  steps?: string[];
  examples: { fr: string; en: string }[];
  watch?: string[];
};
export type GrammarGuide = { summary: string; sections: GrammarGuideSection[] };
// Every pattern the exercises use is taught in one guide section, with the steps that solve any of its questions.
export type GrammarPatternHelp = { section: string; steps: string[] };
export type GrammarTopicContent = {
  id: string;
  unit: string;
  level: GrammarLevel;
  title: string;
  description: string;
  mark: string;
  guide: GrammarGuide;
  patterns: Record<string, GrammarPatternHelp>;
  exercises: GrammarExercise[];
};
export type GrammarUnitContent = { id: string; title: string; description: string; topics: string[] };
export type GrammarProgress = { seen: number; independent: number; needsReview: number };
export type GrammarScore = { score: number; total: number };
// taken counts finished tests of one scope; best is the highest score/total ratio, last the most recent finish.
export type GrammarTestSummary = { taken: number; best: GrammarScore | null; last: (GrammarScore & { finishedAt: string }) | null };
// guide and patterns come with a topic's own state (GET api/grammar/state), not with the catalog.
export type GrammarTopic = Omit<GrammarTopicContent, 'exercises' | 'guide' | 'patterns'> & Partial<Pick<GrammarTopicContent, 'guide' | 'patterns'>> & {
  exerciseCount: number;
  practiceLength: number;
  testLength: number;
  progress: GrammarProgress;
  round: { index: number; total: number } | null; // the topic's practice round while it is open: the question reached, of how many
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
// why explains the checked answer when it is one of the exercise's listed mistakes.
export type GrammarFeedback = {
  kind: 'correct' | 'incorrect' | 'alternative' | 'shown';
  message: string;
  answer?: string;
  spelling?: boolean;
  note?: string;
  why?: string;
};
// How to solve this kind of question, once a practice answer missed or the exercise settled: the steps and the guide
// section that teaches it. row (the table row holding the answer) is given only once settled, since it shows the answer.
export type GrammarHelp = { steps: string[]; section: GrammarGuideSection; row: string | null };
export type GrammarCurrent = {
  exercise: Pick<GrammarExercise, 'id' | 'type' | 'instruction' | 'source' | 'tokens' | 'options' | 'pattern' | 'gloss'> & { topicId: string; topicTitle: string };
  answer: string;
  tokenOrder: number[];
  attempts: number;
  assisted: boolean;
  hint: string | null;
  feedback: GrammarFeedback | null;
  help: GrammarHelp | null;
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
  // The exercise Next brings, as it shows unanswered, so Practise can move on before Next is saved; null at the round's end.
  following: GrammarCurrent | null;
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
// Guide, pattern and exercise prose are plain text, never HTML.
// Word tiles may include distractors: selected indices are unique, but using every tile is not required.
// Complete sources (and most choose sources) use ____ for the missing text, so summaries can show the finished sentence.
// GrammarCurrent.audio names the settled exercise's spoken French, audio/grammar/<exercise id>.mp3, when that file exists.
// GET audio/grammar/:id.mp3 -> the spoken correct sentence, or actionable JSON error.
