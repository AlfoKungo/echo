export type Direction = 'fr-en' | 'en-fr';
export type Word = { id: string; fr: string; en: string; category: string; note?: string };
export type Deck = { id: string; title: string; count: number };
export type Settings = { newPerDay: number };
export type CardView = Word & { successes: number; version: number; stage: 'new' | 'learning' | 'review'; audioUrl: string };
export type Stats = { total: number; unseen: number; introducedToday: number; newAvailable: number; learning: number; due: number; completedToday: number; remaining: number };
export type Snapshot = { day: string; direction: Direction; deck: string; settings: Settings; decks: Deck[]; stats: Stats; current: CardView | null; nextDue: string | null; undoId: string | null };
export type GradeInput = { direction: Direction; deck: string; wordId: string; version: number; known: boolean; requestId: string };
export type BrowseWord = Word & { status: 'new' | 'learning' | 'due' | 'scheduled'; due: string | null };

// All routes are relative to the app root, so /echo/ works behind a path proxy.
// GET api/state?direction=fr-en&deck=all -> Snapshot (does not admit new cards)
// POST api/session {direction,deck} -> Snapshot (admits up to remaining daily allowance)
// POST api/grade GradeInput -> Snapshot; a stale card version is HTTP 409, never double-graded
// POST api/undo {direction,deck,undoId} -> Snapshot (undo only the latest matching grade)
// PUT api/settings {newPerDay:number} -> Settings (0..number of words, integer)
// GET api/words?direction=fr-en&deck=all -> {words:BrowseWord[]}
// GET audio/:id.mp3 -> French Chatterbox recording, or actionable JSON error
// GET api/export -> all progress as downloadable JSON
// Errors are {error:string}; UI must display the server message and allow retry.
