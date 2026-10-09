import type { GrammarLevel } from './contract';

// ── Content ─────────────────────────────────────────────────────────────────────
// content/comprehension/<lane>.json holds { sentences, passages } for one theme and level.
// Every French string is standard written French with the typographic apostrophe ’.
// Every English string is natural English. Plain text only.

// One contextual meaning for a word or fixed expression as it appears in the text.
// `fr` is the exact surface text (case and apostrophes as written); `word` links it to the vocabulary list.
export type Gloss = { fr: string; en: string; word?: string };

export type ComprehensionSentence = {
  id: string;
  level: GrammarLevel;
  fr: string;
  en: string;
  // 2–3 English sentences that are wrong because of ONE detail a listener must catch
  // (who, when, where, how many, negation, tense). Never a paraphrase of `en`.
  distractors: string[];
  topics: string[]; // grammar topic ids from content/grammar/units.json the sentence uses
  words: string[]; // vocabulary ids from content/core.json and content/world.json the sentence uses
  gloss: Gloss[]; // every content word and fixed expression in `fr`
};

export type PassageLine = { speaker?: string; fr: string; en: string };
export type ComprehensionQuestion = {
  question: string; // English; answerable only by understanding the French
  choices: string[]; // English, 3–4, exactly one correct
  answer: number; // index into choices
  explanation: string; // English; quotes the French that decides it
};
export type ComprehensionPassage = {
  id: string;
  level: GrammarLevel;
  kind: 'dialogue' | 'text';
  title: string; // short English title
  lines: PassageLine[]; // dialogue: every line has a speaker; text: none has
  questions: ComprehensionQuestion[]; // 3–4
  topics: string[];
  words: string[];
  gloss: Gloss[]; // surface forms found in the lines
};

export type ComprehensionLane = { sentences: ComprehensionSentence[]; passages: ComprehensionPassage[] };

// Audio: a sentence plays audio/comprehension/<sentence id>.mp3; passage line n (1-based) plays
// audio/comprehension/<passage id>-<n>.mp3. A missing clip is reported by the audio route, never guessed.

// ── Practice API ────────────────────────────────────────────────────────────────
// A stream is one endless run of exercises. listen and read are the Listen and Read modes; mix alternates both
// (Practise uses it); focus streams come from Mistakes. Each stream keeps one current exercise on the server,
// so a reload or a second device shows the same question.
export type StreamId = 'listen' | 'read' | 'mix' | `focus:topic:${string}` | 'focus:words' | 'focus:missed';

// meaning: choose the English meaning of a sentence. question: answer a question about a dialogue or text.
export type ExerciseKind = 'meaning' | 'question';

export type ExerciseView = {
  key: string; // `${itemId}:${kind}` or `${passageId}:question:${n}`
  kind: ExerciseKind;
  mode: 'listen' | 'read'; // how the French is presented: heard (text hidden until settled) or read
  level: GrammarLevel;
  item: { id: string; type: 'sentence' | 'dialogue' | 'text'; title?: string };
  audio: string[]; // clip URLs in play order (sentence: one; passage: one per line); read mode may still offer them after settling
  // Shown before answering. read mode: the French (sentence or lines). listen mode: no French, only a question's text.
  gloss: Gloss[]; // glosses of the French shown now (read mode); empty in listen mode before settling
  prompt: { lines?: PassageLine[]; text?: string; question?: string };
  choices: string[]; // the answers to choose from, in the order shown
};

export type ExerciseResult = {
  outcome: 'correct' | 'helped' | 'incorrect'; // helped: correct after looking words up first
  expected: string; // the correct choice
  given: string;
  explanation?: string;
  // Revealed once settled: the full French with its translation and tappable glosses.
  lines: PassageLine[];
  gloss: Gloss[];
};

export type StreamLevel = { mode: 'listen' | 'read'; label: GrammarLevel; value: number };
// What settles an exercise on the phone the moment it is answered: where the right choice sits among those shown,
// and what the result reveals. The phone works out the outcome as the server does (right after a lookup in read mode
// is helped); the saved answer's reply is what counts.
export type ExerciseCheck = { answer: number; explanation?: string; lines: PassageLine[]; gloss: Gloss[] };
// The exercise Next brings once the current one is answered with this outcome, picked ahead, with the levels that
// outcome leaves; next() serves this pick, so Next can show it before the answer is saved. after: the same one step
// further, by the outcome of that exercise, so two questions can go by before the Mac has saved either.
export type ExerciseAhead = { level: StreamLevel[]; current: ExerciseView | null; check: ExerciseCheck | null; after?: Partial<Record<ExerciseResult['outcome'], ExerciseAhead>> };

export type StreamState = {
  stream: StreamId;
  level: StreamLevel[]; // the adaptive level per mode, 1.0–3.99
  current: ExerciseView | null; // null only when a focus stream has nothing left
  result: ExerciseResult | null; // set once the current exercise is settled, until next
  lookups: string[]; // gloss fr values looked up on the current exercise before settling
  version: number;
  check: ExerciseCheck | null; // the current exercise's, until it is settled
  after: Partial<Record<ExerciseResult['outcome'], ExerciseAhead>> | null; // by outcome: correct, incorrect, and helped in read mode
};

// GET  api/comprehension/state?stream=<id>                       -> StreamState (creates the current exercise if needed)
// POST api/comprehension/lookup {stream, key, fr, version, requestId} -> StreamState (records a looked-up gloss; a read
//      exercise answered after a lookup settles as helped)
// POST api/comprehension/answer {stream, key, version, requestId, choice} -> StreamState
// POST api/comprehension/next   {stream, key, version, requestId} -> StreamState (only after settling)
// POST api/vocabulary/add {wordId, requestId}                       -> { status: 'added' | 'already-practising' | 'made-due' }
// GET  api/mistakes -> { groups: MistakeGroup[] }
// Mutations are idempotent by requestId and return current state on replay; a stale version or key returns HTTP 409.

export type MistakeGroup = {
  id: string; // grammar topic id, 'words', 'missed' or 'verb-forms'
  kind: 'grammar' | 'words' | 'sentences' | 'verbs';
  title: string; // e.g. the grammar topic title, 'Words you keep missing', 'Sentences you didn’t catch'
  count: number;
  examples: string[]; // up to 3 short French examples
  // What a tap starts: a grammar practice scope and/or a comprehension focus stream; a verbs group opens Type it
  // on the shaky forms.
  grammarScope?: string;
  stream?: StreamId;
};
