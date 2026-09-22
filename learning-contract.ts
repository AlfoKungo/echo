export type LearningSkill = 'recognition' | 'listening' | 'production';
export type LearningOutcome = 'independent' | 'helped' | 'revisit';
export type Annotation = { phrase: string; translation: string; explanation: string };
export type ListeningLesson = {
  id: string; title: string; description: string; kind: 'sentence' | 'dialogue' | 'passage';
  fr: string; en: string; audioId: string;
  meaning: { question: string; choices: string[]; correctIndex: number; explanation: string };
  gap: { prompt: string; answer: string; alternatives?: string[]; explanation: string };
};
export type ReadingLesson = {
  id: string; title: string; kind: 'story' | 'message' | 'menu' | 'everyday' | 'imported';
  fr: string; en: string; explanation?: string; annotations: Annotation[];
  writingPrompt: string; modelAnswer: string;
  practice?: { prompt: string; answer: string; explanation: string }[];
};
export type ConversationLesson = {
  id: string; title: string; goal: string;
  turns: { id: string; speaker: string; fr: string; en: string; audioId: string; prompt: string; choices: string[]; correctIndex: number; explanation: string }[];
};
export type LearningContent = { listening: ListeningLesson[]; reading: ReadingLesson[]; conversations: ConversationLesson[] };
export type LearningAttemptInput = {
  requestId: string; kind: 'listening' | 'conversation' | 'material'; itemId: string;
  mode: 'meaning' | 'gap' | 'dictation' | 'reply' | 'practice'; answer: string;
  exerciseIndex?: number; assisted: boolean;
};
export type LearningFeedback = {
  kind: 'correct' | 'incorrect' | 'spelling'; answer: string; explanation: string;
  outcome: LearningOutcome; reviewId: string;
};
export type SavedPhrase = { id: string; fr: string; en: string; explanation: string; sourceId: string; createdAt: string };
export type ReviewItem = {
  id: string; title: string; skill: LearningSkill; dueAt: string;
  kind: 'listening' | 'conversation' | 'material' | 'phrase'; itemId: string;
  mode: 'meaning' | 'gap' | 'dictation' | 'reply' | 'practice' | 'fr-en' | 'en-fr';
  exerciseIndex?: number; fr?: string; en?: string; explanation?: string;
};
export type ReviewOverview = {
  due: ReviewItem[];
  skills: { id: LearningSkill; label: string; attempts: number; independent: number; helped: number; revisit: number; due: number }[];
  goingWell: { title: string; skill: LearningSkill; successes: number; attempts: number; source: 'self-rated' | 'prepared' }[];
  needsPractice: { title: string; skill: LearningSkill; misses: number; attempts: number; source: 'self-rated' | 'prepared' }[];
  vocabulary: { direction: 'fr-en' | 'en-fr'; unseenActive: number; seenActive: number; remaining: number }[];
  grammar: { title: string; independent: number; helped: number; revisit: number }[];
};
export type WritingFeedback = {
  corrected: string; summary: string;
  errors: { original: string; replacement: string; explanation: string }[];
  suggestions: { original: string; replacement: string; explanation: string }[];
};
export type MaterialExplanation = { translation: string; explanation: string; annotations: Annotation[] };
export type TutorInput = { requestId: string; kind: 'writing' | 'material'; text: string; sourceId: string; prompt?: string; title?: string };
export type TutorResult = { kind: 'writing'; feedback: WritingFeedback } | { kind: 'material'; material: ReadingLesson };
export type TutorJob = {
  id: string; input: TutorInput; status: 'queued' | 'loading' | 'working' | 'releasing' | 'complete' | 'cancelled' | 'error';
  progress: string; result?: TutorResult; error?: string; createdAt: string; updatedAt: string;
};
export type TutorStatus = { state: 'off' | 'loading' | 'working' | 'releasing'; activeJobId: string | null; queued: number; model: string };

// All paths are relative to /echo/; ordinary lesson access never invokes the tutor.
// GET api/learning/catalog -> LearningContent
// GET api/learning/materials -> { materials: { id, title, kind }[] }
// GET api/learning/materials/:id -> ReadingLesson
// POST api/learning/attempt LearningAttemptInput -> LearningFeedback
// POST api/learning/phrases { requestId, fr, en, explanation, sourceId } -> SavedPhrase
// GET api/learning/progress -> ReviewOverview
// POST api/learning/review { requestId, reviewId, known } -> ReviewOverview
// POST api/learning/tutor TutorInput -> TutorJob (202; model work is asynchronous)
// GET api/learning/tutor/status -> TutorStatus (off means Echo owns no model process)
// GET api/learning/tutor/last?sourceId=...&kind=writing|material -> { job: TutorJob | null }
// GET api/learning/tutor/:id -> TutorJob
// POST api/learning/tutor/:id/stop -> TutorJob
// POST api/learning/tutor/request/:requestId/stop -> { stopping: true } (also covers Stop racing submission)
// POST api/learning/tutor/stop -> TutorStatus (cancels Echo-owned active and queued work)
// Tutor errors preserve the submitted text. Model output is advice, never an automatic mastery score.
