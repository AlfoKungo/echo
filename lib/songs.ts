// Songs: find one on LRCLIB (or take pasted lyrics), read it into dictionary-form words with Claude in the
// background, let the learner review the list, then add the chosen words as a deck of their own. The lyrics are
// held in memory only while a song is being read; the database keeps the title, the progress and the word list.
import { Database } from 'bun:sqlite';
import { StoreError, type Store } from './store';
import { candidateFrom, groupMatches, littleWord, lyricForms, mergeCandidates, songCategory, type LrclibTrack, type LyricForm, type SongCandidate, type SongMatch, type SongSkip, type WordFacts } from './song-words';

export type SongStatus = 'reading' | 'ready' | 'added' | 'failed';
export type SongView = {
  id: string; title: string; artist: string; category: string; status: SongStatus;
  done: number; total: number; error: string | null; candidates: SongCandidate[]; skipped: SongSkip[];
  added: string[]; createdAt: string;
};
export type SongStart = { lrclibId: number } | { title: string; artist?: string; lyrics: string };

export type SongDeps = {
  dbPath: string;
  vocabulary: Store;
  // Answers the facts for a batch of the song's word forms, with the whole song as context; a form missing from
  // the answer is left out. A StoreError (the model cannot be reached) stops the song.
  read: (lyrics: string, forms: LyricForm[]) => Promise<Map<string, WordFacts>>;
  fetchJson: (url: string) => Promise<unknown>;
  onAdded?: (wordIds: string[]) => void;
  now?: () => Date;
};

type SongRow = {
  id: string; title: string; artist: string; category: string; source: string; source_id: number | null; status: SongStatus;
  done: number; total: number; error: string | null; words_json: string | null; added_json: string | null; created_at: string;
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
  const byId = db.query<SongRow, [string]>('SELECT * FROM songs WHERE id = ?');
  const all = db.query<SongRow, []>('SELECT * FROM songs ORDER BY created_at DESC');
  const progress = db.query('UPDATE songs SET done = ?, total = ? WHERE id = ?');
  const finish = db.query("UPDATE songs SET status = 'ready', done = total, words_json = ?, error = NULL WHERE id = ?");
  const fail = db.query("UPDATE songs SET status = 'failed', error = ? WHERE id = ?");
  const queue: { id: string; lyrics: string }[] = [];
  let running: Promise<void> | null = null;

  function view(row: SongRow): SongView {
    const words = row.words_json ? JSON.parse(row.words_json) as { candidates: SongCandidate[]; skipped: SongSkip[] } : { candidates: [], skipped: [] };
    return {
      id: row.id, title: row.title, artist: row.artist, category: row.category, status: row.status,
      done: row.done, total: row.total, error: row.error, skipped: words.skipped,
      candidates: words.candidates.map((candidate) => ({ ...candidate, little: candidate.forms.every((form) => littleWord(form) !== null) })),
      added: row.added_json ? JSON.parse(row.added_json) : [], createdAt: row.created_at,
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
    db.query('INSERT INTO songs (id, title, artist, category, source, source_id, status, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, title, artist, songCategory(title, taken), source, sourceId, 'reading', total, now().toISOString());
    queue.push({ id, lyrics });
    void drain();
    return view(byId.get(id)!);
  }

  // One song at a time, word forms in alphabetical order; progress is saved after each one.
  // running is cleared only once the loop has settled, and a song queued in that gap starts a new loop.
  function drain(): Promise<void> {
    if (running) return running;
    const work = (async () => {
      while (queue.length) {
        const job = queue.shift()!;
        try { finish.run(JSON.stringify(await read(job)), job.id); }
        catch (error) { fail.run(error instanceof Error ? error.message : 'Reading the song failed.', job.id); }
      }
    })();
    running = work;
    return work.finally(() => { if (running === work) running = null; if (queue.length) void drain(); });
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

  // fr names the chosen candidates; words already in the deck are never added twice.
  function add(id: string, chosen: string[]): SongView {
    const song = get(id);
    if (song.status === 'added') return song;
    if (song.status !== 'ready') throw new StoreError('This song is still being read. Wait for its word list.', 409);
    if (!Array.isArray(chosen) || !chosen.length) throw new StoreError('Tick at least one word to add.');
    // Words already in the deck are checked now, not when the song was read: another song may have added them since.
    const have = new Set(deps.vocabulary.words().map((word) => word.fr.toLowerCase().replace(/[’‘]/g, "'").trim()));
    const picks = song.candidates.filter((candidate) => !candidate.existing && chosen.includes(candidate.fr) && !have.has(candidate.fr.toLowerCase()));
    if (!picks.length) throw new StoreError('All the ticked words are already in your words.');
    const made = deps.vocabulary.addWords({ category: song.category, title: song.title, words: picks.map(({ fr, en, note }) => ({ fr, en, note })) });
    db.query("UPDATE songs SET status = 'added', added_json = ? WHERE id = ?").run(JSON.stringify(made.map((word) => word.id)), id);
    deps.onAdded?.(made.map((word) => word.id));
    return get(id);
  }

  // A failed song starts again; lyrics from LRCLIB are fetched again, pasted lyrics must be pasted again.
  async function retry(id: string): Promise<SongView> {
    const row = byId.get(id);
    if (!row) throw new StoreError('That song is not in Echo.', 404);
    if (row.status !== 'failed') return view(row);
    if (row.source !== 'lrclib' || row.source_id === null) throw new StoreError('Paste the lyrics again to read this song.', 409);
    const { lyrics } = await lyricsFor(row.source_id);
    db.query("UPDATE songs SET status = 'reading', done = 0, error = NULL WHERE id = ?").run(id);
    queue.push({ id, lyrics });
    void drain();
    return get(id);
  }

  // Songs cut short by a restart: LRCLIB ones are read again, pasted ones ask to be pasted again.
  async function resume(): Promise<void> {
    for (const row of all.all().filter((song) => song.status === 'reading').reverse()) {
      if (row.source === 'lrclib' && row.source_id !== null) {
        try { queue.push({ id: row.id, lyrics: (await lyricsFor(row.source_id)).lyrics }); db.query('UPDATE songs SET done = 0 WHERE id = ?').run(row.id); }
        catch (error) { fail.run(error instanceof Error ? error.message : 'The lyrics could not be fetched.', row.id); }
      } else fail.run('Echo restarted while reading this song. Paste the lyrics again.', row.id);
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

  return { search, start, get, list: () => all.all().map(view), add, retry, resume, remove, settled: () => running ?? Promise.resolve(), close: () => db.close() };
}
export type Songs = ReturnType<typeof createSongs>;
