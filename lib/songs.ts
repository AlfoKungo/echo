// Songs: find one on LRCLIB (or take pasted lyrics), read it into dictionary-form words with Claude in the
// background, let the learner review the list, then add the chosen words as a deck of their own. The lyrics are
// kept on this Mac for the song view, whose line translations and word notes Claude writes once the words are read
// (lib/song-lyrics.ts).
import { Database } from 'bun:sqlite';
import type { Ask } from './claude';
import { GENDER_RULES } from './language';
import { genderOf, StoreError, type Store } from './store';
import { candidateFrom, comparable, formCounts, groupMatches, littleWord, lyricForms, mergeCandidates, songCategory, type LrclibTrack, type LyricForm, type SongCandidate, type SongMatch, type SongSkip, type WordFacts } from './song-words';
import { NOTES_VERSION, stanzasOf, writeNotes, type SongNotes } from './song-lyrics';

// A rewrite of older notes that failed is tried again after this long (the old notes stay on show meanwhile).
const NOTES_RETRY = 30 * 60_000;

export type SongStatus = 'reading' | 'ready' | 'added' | 'failed';
// The song view: 'none' when the lyrics are not on this Mac (a pasted song from before they were kept).
export type NotesStatus = 'none' | 'waiting' | 'writing' | 'ready' | 'failed';
export type SongView = {
  id: string; title: string; artist: string; category: string; status: SongStatus;
  done: number; total: number; error: string | null; candidates: SongCandidate[]; skipped: SongSkip[];
  // added: the new words the song made; linked: the words already in Echo that its deck holds too.
  added: string[]; linked: string[]; createdAt: string; notes: NotesStatus;
  // Of the song's words as sung (little words and names left out), the percentage known (the Statistics sense:
  // scheduled or due) and still learning; null before the words are read or when the lyrics are not kept.
  understood: { known: number; learning: number } | null;
};
export type SongLyricsView = { id: string; title: string; artist: string; notes: NotesStatus; done: number; total: number; error: string | null; stanzas: SongNotes };
export type SongStart = { lrclibId: number } | { title: string; artist?: string; lyrics: string };

export type SongDeps = {
  dbPath: string;
  vocabulary: Store;
  // Answers the facts for a batch of the song's word forms, with the whole song as context; a form missing from
  // the answer is left out. A StoreError (the model cannot be reached) stops the song.
  read: (lyrics: string, forms: LyricForm[]) => Promise<Map<string, WordFacts>>;
  fetchJson: (url: string) => Promise<unknown>;
  // Writes the song view's notes; without it a song keeps its lyrics but gets no notes.
  ask?: Ask;
  onAdded?: (wordIds: string[]) => void;
  now?: () => Date;
};

type SongRow = {
  id: string; title: string; artist: string; category: string; source: string; source_id: number | null; status: SongStatus;
  done: number; total: number; error: string | null; words_json: string | null; added_json: string | null; linked_json: string | null; created_at: string;
  lyrics: string | null; notes_json: string | null; notes_status: string | null; notes_done: number; notes_total: number; notes_error: string | null; notes_version: number;
};

const LRCLIB = 'https://lrclib.net/api';
const MAX_LYRICS = 20_000;
// Forms asked about in one request; a long song takes a few.
const BATCH = 120;

export function createSongs(deps: SongDeps) {
  const now = deps.now ?? (() => new Date());
  const db = new Database(deps.dbPath, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
    -- A song being read or read: words_json holds {candidates, skipped}; added_json the word ids it added.
    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, category TEXT NOT NULL,
      source TEXT NOT NULL, source_id INTEGER, status TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0, error TEXT, words_json TEXT, added_json TEXT, created_at TEXT NOT NULL
    );
  `);
  // Columns added once the song view kept the lyrics; older databases gain them here.
  const columns = new Set(db.query<{ name: string }, []>('PRAGMA table_info(songs)').all().map((column) => column.name));
  for (const [name, type] of [['lyrics', 'TEXT'], ['notes_json', 'TEXT'], ['notes_status', 'TEXT'], ['notes_done', 'INTEGER NOT NULL DEFAULT 0'], ['notes_total', 'INTEGER NOT NULL DEFAULT 0'], ['notes_error', 'TEXT'], ['notes_version', 'INTEGER NOT NULL DEFAULT 1'], ['linked_json', 'TEXT']] as const) {
    if (!columns.has(name)) db.exec(`ALTER TABLE songs ADD COLUMN ${name} ${type}`);
  }
  const byId = db.query<SongRow, [string]>('SELECT * FROM songs WHERE id = ?');
  const all = db.query<SongRow, []>('SELECT * FROM songs ORDER BY created_at DESC');
  const progress = db.query('UPDATE songs SET done = ?, total = ? WHERE id = ?');
  const finish = db.query("UPDATE songs SET status = 'ready', done = total, words_json = ?, error = NULL WHERE id = ?");
  const fail = db.query("UPDATE songs SET status = 'failed', error = ? WHERE id = ?");
  const queue: { id: string; lyrics: string }[] = [];
  const noteQueue: string[] = [];
  let running: Promise<void> | null = null;
  const notesStatus = (row: SongRow): NotesStatus => !row.lyrics ? 'none' : (row.notes_status as NotesStatus | null) ?? 'waiting';

  // Word statuses for the understanding share, read once per call that builds views.
  function statuses(): Map<string, string> { return new Map(deps.vocabulary.listening().map((word) => [word.id, word.status])); }

  function understood(row: SongRow, candidates: SongCandidate[], status: Map<string, string>): SongView['understood'] {
    if (!row.lyrics || !candidates.length) return null;
    const deck = new Map(deps.vocabulary.words().map((word) => [comparable(word.fr), word.id]));
    const byForm = new Map(candidates.filter((candidate) => !candidate.forms.every((form) => littleWord(form) !== null)).flatMap((candidate) => candidate.forms.map((form) => [form, candidate] as const)));
    let total = 0, known = 0, learning = 0;
    for (const [form, count] of formCounts(row.lyrics)) {
      const candidate = byForm.get(form);
      if (!candidate) continue;
      total += count;
      const state = status.get(deck.get(comparable(candidate.fr)) ?? '');
      if (state === 'scheduled' || state === 'due') known += count; else if (state === 'learning') learning += count;
    }
    return total ? { known: Math.round(known / total * 100), learning: Math.round(learning / total * 100) } : null;
  }

  function view(row: SongRow, status = statuses()): SongView {
    const words = row.words_json ? JSON.parse(row.words_json) as { candidates: SongCandidate[]; skipped: SongSkip[] } : { candidates: [], skipped: [] };
    return {
      id: row.id, title: row.title, artist: row.artist, category: row.category, status: row.status,
      done: row.done, total: row.total, error: row.error, skipped: words.skipped,
      // Songs are French (lib/song-words.ts writes French articles), so their words take French's rules.
      candidates: words.candidates.map((candidate) => { const gender = genderOf(candidate, GENDER_RULES.fr); return { ...candidate, little: candidate.forms.every((form) => littleWord(form) !== null), ...(gender ? { gender } : {}) }; }),
      // A word the song added that Echo later dropped as a duplicate is linked from its kept copy instead.
      added: (row.added_json ? JSON.parse(row.added_json) as string[] : []).filter((wordId) => !!deps.vocabulary.word(wordId)), linked: row.linked_json ? JSON.parse(row.linked_json) : [], createdAt: row.created_at, notes: notesStatus(row),
      understood: understood(row, words.candidates, status),
    };
  }

  async function search(query: string): Promise<SongMatch[]> {
    if (typeof query !== 'string' || query.trim().length < 2) throw new StoreError('Type a song title to search for.');
    let tracks: unknown;
    try { tracks = await deps.fetchJson(`${LRCLIB}/search?q=${encodeURIComponent(query.trim())}`); }
    catch { throw new StoreError('The lyrics search could not be reached. Check the Mac’s internet connection, or paste the lyrics instead.', 502); }
    return Array.isArray(tracks) ? groupMatches(tracks as LrclibTrack[]).slice(0, 12) : [];
  }

  async function lyricsFor(sourceId: number): Promise<{ title: string; artist: string; lyrics: string }> {
    let track: LrclibTrack;
    try { track = await deps.fetchJson(`${LRCLIB}/get/${sourceId}`) as LrclibTrack; }
    catch { throw new StoreError('The lyrics could not be fetched. Check the Mac’s internet connection, or paste the lyrics instead.', 502); }
    if (!track?.plainLyrics?.trim()) throw new StoreError('That version has no lyrics. Choose another one.', 404);
    return { title: track.trackName, artist: track.artistName.replace(/\s+-\s+Topic$/i, '').trim(), lyrics: track.plainLyrics };
  }

  async function start(input: SongStart): Promise<SongView> {
    let title: string, artist: string, lyrics: string, source: 'lrclib' | 'paste', sourceId: number | null = null;
    if ('lrclibId' in input) {
      if (!Number.isSafeInteger(input.lrclibId)) throw new StoreError('Choose a song from the list.');
      ({ title, artist, lyrics } = await lyricsFor(input.lrclibId));
      source = 'lrclib'; sourceId = input.lrclibId;
    } else {
      title = String(input.title ?? '').trim(); artist = String(input.artist ?? '').trim(); lyrics = String(input.lyrics ?? '');
      if (!title) throw new StoreError('Give the song a title.');
      if (!lyrics.trim()) throw new StoreError('Paste the lyrics to read.');
      if (lyrics.length > MAX_LYRICS) throw new StoreError('Those lyrics are longer than a song. Paste one song at a time.');
      source = 'paste';
    }
    const total = lyricForms(lyrics).length;
    if (!total) throw new StoreError('No French words were found in those lyrics.');
    const taken = new Set([...deps.vocabulary.words().map((word) => word.category), ...all.all().map((row) => row.category)]);
    const id = crypto.randomUUID();
    db.query('INSERT INTO songs (id, title, artist, category, source, source_id, status, total, created_at, lyrics) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, title, artist, songCategory(title, taken), source, sourceId, 'reading', total, now().toISOString(), lyrics);
    queue.push({ id, lyrics });
    void drain();
    return view(byId.get(id)!);
  }

  // One song at a time, word forms in alphabetical order; progress is saved after each one. A song's notes are
  // written after every waiting word list, so a new song's words are never held up behind another's notes.
  // running is cleared only once the loop has settled, and a song queued in that gap starts a new loop.
  function drain(): Promise<void> {
    if (running) return running;
    const work = (async () => {
      while (queue.length || noteQueue.length) {
        if (queue.length) {
          const job = queue.shift()!;
          try { finish.run(JSON.stringify(await read(job)), job.id); queueNotes(job.id); }
          catch (error) { fail.run(error instanceof Error ? error.message : 'Reading the song failed.', job.id); }
          continue;
        }
        await notes(noteQueue.shift()!);
      }
    })();
    running = work;
    return work.finally(() => { if (running === work) running = null; if (queue.length || noteQueue.length) void drain(); });
  }

  function queueNotes(id: string): void {
    if (!deps.ask || noteQueue.includes(id)) return;
    db.query("UPDATE songs SET notes_status = 'waiting', notes_error = NULL WHERE id = ? AND lyrics IS NOT NULL").run(id);
    noteQueue.push(id);
  }

  async function notes(id: string): Promise<void> {
    const row = byId.get(id);
    if (!row?.lyrics || !deps.ask) return;
    db.query("UPDATE songs SET notes_status = 'writing', notes_done = 0 WHERE id = ?").run(id);
    try {
      const written = await writeNotes(deps.ask, { kind: 'song', title: row.title, artist: row.artist, lyrics: row.lyrics }, (done, total) => db.query('UPDATE songs SET notes_done = ?, notes_total = ? WHERE id = ?').run(done, total, id));
      db.query("UPDATE songs SET notes_status = 'ready', notes_json = ?, notes_error = NULL, notes_version = ? WHERE id = ?").run(JSON.stringify(written), NOTES_VERSION, id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Writing the notes failed.';
      // A rewrite for a newer notes version keeps the old notes on show and tries again later, so a Claude that
      // cannot be reached (a usage limit, say) never leaves a readable song showing an error.
      if (row.notes_json) {
        db.query("UPDATE songs SET notes_status = 'ready', notes_error = ? WHERE id = ?").run(message, id);
        setTimeout(() => { if (byId.get(id)) { queueNotes(id); void drain(); } }, NOTES_RETRY).unref();
      } else db.query("UPDATE songs SET notes_status = 'failed', notes_error = ? WHERE id = ?").run(message, id);
    }
  }

  // The song view: the lyrics in stanzas, with their notes once written (plain lines until then).
  function lyrics(id: string): SongLyricsView {
    const row = byId.get(id);
    if (!row) throw new StoreError('That song is not in Echo.', 404);
    const stanzas: SongNotes = row.notes_json ? JSON.parse(row.notes_json)
      : row.lyrics ? stanzasOf(row.lyrics).map((stanza) => stanza.map((fr) => ({ fr, en: null, words: [] }))) : [];
    return { id: row.id, title: row.title, artist: row.artist, notes: notesStatus(row), done: row.notes_done, total: row.notes_total, error: row.notes_error, stanzas };
  }

  // Notes that failed (Claude could not be reached, say) are written again on request.
  function rewriteNotes(id: string): SongLyricsView {
    const row = byId.get(id);
    if (!row) throw new StoreError('That song is not in Echo.', 404);
    if (!row.lyrics) throw new StoreError('The lyrics of this song are not on this Mac. Paste it again to read it.', 409);
    if (row.notes_status === 'failed') { queueNotes(id); void drain(); }
    return lyrics(id);
  }

  async function read(job: { id: string; lyrics: string }): Promise<{ candidates: SongCandidate[]; skipped: SongSkip[] }> {
    const forms = lyricForms(job.lyrics);
    const found: { form: string; entry: Omit<SongCandidate, 'forms' | 'existing'> }[] = [];
    const skipped: SongSkip[] = [];
    const open: LyricForm[] = [];
    for (const entry of forms) {
      const known = littleWord(entry.form);
      if (known) found.push({ form: entry.form, entry: { ...known, note: '' } }); else open.push(entry);
    }
    let done = forms.length - open.length;
    progress.run(done, forms.length, job.id);
    for (let start = 0; start < open.length; start += BATCH) {
      const batch = open.slice(start, start + BATCH);
      let answers: Map<string, WordFacts>;
      try { answers = await deps.read(job.lyrics, batch); }
      catch (error) {
        if (error instanceof StoreError) throw error;
        answers = new Map();
      }
      for (const entry of batch) {
        const facts = answers.get(entry.form);
        const result = facts ? candidateFrom(entry.form, facts) : { form: entry.form, reason: 'no clear answer' };
        if ('reason' in result) skipped.push(result); else found.push({ form: entry.form, entry: result });
      }
      progress.run(done += batch.length, forms.length, job.id);
    }
    return { candidates: mergeCandidates(found, deps.vocabulary.words()), skipped };
  }

  function get(id: string): SongView {
    const row = byId.get(id);
    if (!row) throw new StoreError('That song is not in Echo.', 404);
    return view(row);
  }

  // The deck word a candidate already is, if any: checked now, not when the song was read, since another song may
  // have added it since.
  function deckIds(): (candidate: SongCandidate) => string | undefined {
    const byFr = new Map(deps.vocabulary.words().map((word) => [comparable(word.fr), word.id]));
    return (candidate) => (candidate.existing && deps.vocabulary.word(candidate.existing) ? candidate.existing : byFr.get(comparable(candidate.fr)));
  }

  // fr names the chosen candidates. A new word is added to the song's deck; a word already in Echo joins the deck
  // as it is, keeping its own category and progress, so practising the song covers every word of it.
  function add(id: string, chosen: string[]): SongView {
    const song = get(id);
    if (song.status === 'added') return song;
    if (song.status !== 'ready') throw new StoreError('This song is still being read. Wait for its word list.', 409);
    if (!Array.isArray(chosen) || !chosen.length) throw new StoreError('Tick at least one word to add.');
    const idOf = deckIds();
    const ticked = song.candidates.filter((candidate) => chosen.includes(candidate.fr));
    const fresh = ticked.filter((candidate) => !idOf(candidate));
    const known = [...new Set(ticked.map(idOf).filter((wordId): wordId is string => !!wordId))];
    if (!fresh.length && !known.length) throw new StoreError('Tick at least one word to add.');
    const made = fresh.length ? deps.vocabulary.addWords({ category: song.category, title: song.title, words: fresh.map(({ fr, en, note }) => ({ fr, en, note })) }) : [];
    const linked = known.length ? deps.vocabulary.linkWords({ category: song.category, title: song.title, ids: known }) : [];
    db.query("UPDATE songs SET status = 'added', added_json = ?, linked_json = ? WHERE id = ?").run(JSON.stringify(made.map((word) => word.id)), JSON.stringify(linked), id);
    if (made.length) deps.onAdded?.(made.map((word) => word.id));
    return get(id);
  }

  // Songs added before their decks could hold words already in Echo: each gets those words once, the ones it would
  // have offered ticked (every one but the little words). linked_json records it, so a later untick stays untouched.
  for (const row of all.all().filter((song) => song.status === 'added' && song.linked_json === null)) {
    const song = view(row, new Map());
    const idOf = deckIds();
    const own = new Set(song.added);
    const known = [...new Set(song.candidates.filter((candidate) => !candidate.little).map(idOf).filter((wordId): wordId is string => !!wordId && !own.has(wordId)))];
    const linked = known.length ? deps.vocabulary.linkWords({ category: row.category, title: row.title, ids: known }) : [];
    db.query('UPDATE songs SET linked_json = ? WHERE id = ?').run(JSON.stringify(linked), row.id);
  }

  // A failed song starts again from its kept lyrics; an older song without them fetches them from LRCLIB again,
  // and an older pasted one must be pasted again.
  async function retry(id: string): Promise<SongView> {
    const row = byId.get(id);
    if (!row) throw new StoreError('That song is not in Echo.', 404);
    if (row.status !== 'failed') return view(row);
    const lyrics = await keptLyrics(row);
    if (!lyrics) throw new StoreError('Paste the lyrics again to read this song.', 409);
    db.query("UPDATE songs SET status = 'reading', done = 0, error = NULL WHERE id = ?").run(id);
    queue.push({ id, lyrics });
    void drain();
    return get(id);
  }

  // The song's lyrics: the kept copy, or for a song added before they were kept, LRCLIB's, saved from now on.
  async function keptLyrics(row: SongRow): Promise<string | null> {
    if (row.lyrics) return row.lyrics;
    if (row.source !== 'lrclib' || row.source_id === null) return null;
    const { lyrics } = await lyricsFor(row.source_id);
    db.query('UPDATE songs SET lyrics = ? WHERE id = ?').run(lyrics, row.id);
    return lyrics;
  }

  // After a restart: songs cut short while their words were read start again, then every read song whose notes are
  // not written yet (or were cut short) gets them. Notes that failed wait for the learner to ask again.
  async function resume(): Promise<void> {
    for (const row of all.all().filter((song) => song.status === 'reading').reverse()) {
      try {
        const lyrics = await keptLyrics(row);
        if (lyrics) { queue.push({ id: row.id, lyrics }); db.query('UPDATE songs SET done = 0 WHERE id = ?').run(row.id); }
        else fail.run('Echo restarted while reading this song. Paste the lyrics again.', row.id);
      } catch (error) { fail.run(error instanceof Error ? error.message : 'The lyrics could not be fetched.', row.id); }
    }
    // Notes written before the current version are written again; the old ones stay on show until then.
    const due = (song: SongRow) => (song.notes_status !== 'ready' && song.notes_status !== 'failed') || (song.notes_status === 'ready' && song.notes_version < NOTES_VERSION);
    for (const row of all.all().filter((song) => (song.status === 'ready' || song.status === 'added') && due(song)).reverse()) {
      try { if (await keptLyrics(row)) queueNotes(row.id); }
      catch { /* LRCLIB unreachable: the song view waits for the next start. */ }
    }
    void drain();
  }

  function remove(id: string): void {
    const row = byId.get(id);
    if (!row) return;
    if (row.status === 'reading') throw new StoreError('This song is still being read.', 409);
    if (row.status === 'added') throw new StoreError('Its words are in your practice now; they stay.', 409);
    db.query('DELETE FROM songs WHERE id = ?').run(id);
  }

  return { search, start, get, lyrics, rewriteNotes, list: () => { const status = statuses(); return all.all().map((row) => view(row, status)); }, add, retry, resume, remove, settled: () => running ?? Promise.resolve(), close: () => db.close() };
}
export type Songs = ReturnType<typeof createSongs>;
