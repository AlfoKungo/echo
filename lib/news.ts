// News: RFI's Journal en français facile, ten minutes of the day's world news in slow French read by RFI's own
// presenters, Monday to Friday, with RFI's transcript; read and heard like a song's lyrics. A check (at start and every
// 30 minutes, server.ts) finds new editions on RFI's page and keeps the latest KEEP. Each edition is prepared in steps,
// each saved as it finishes, so a restart carries on where it stopped: the transcript (from the edition's page), the
// recording (<audio>/news/<yyyymmdd>.mp3), the time each line starts (Whisper on this Mac, aligned to RFI's text, which
// stays the words shown), then the notes (lib/song-lyrics.ts). A step that fails is kept on the edition, shown, and
// tried again at the next check. Editions live in <data>/news as <yyyymmdd>.json.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Ask } from './claude';
import { writeNotes, type SongNotes } from './song-lyrics';
import { StoreError } from './store';

export const KEEP = 14;
const ORIGIN = 'https://francaisfacile.rfi.fr';
export const LIST_URL = `${ORIGIN}/fr/podcasts/journal-en-fran%C3%A7ais-facile/`;
// RFI answers a browser; a bare client may be turned away.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const WHISPER = '/opt/homebrew/bin/whisper-cli';
const WHISPER_MODEL = join(homedir(), '.local/share/whisper-models/ggml-large-v3-turbo.bin');
// A line plays from this long before Whisper's time for its first word, so the word is heard from its start.
const LEAD = 0.3;
// Below this share of the transcript's words found in what Whisper heard, the recording is not the one transcribed.
const MIN_MATCHED = 0.3;
// A recording smaller than this is an error page, not ten minutes of news.
const MIN_RECORDING = 200_000;

export type NewsStep = 'text' | 'audio' | 'timing' | 'notes';
const STEPS: NewsStep[] = ['text', 'audio', 'timing', 'notes'];
export type HeardWord = { text: string; at: number };
type Edition = {
  date: string; page: string; title: string;
  mp3: string | null;
  // RFI's transcript: its paragraphs, each split into sentences, which are the lines.
  stanzas: string[][] | null;
  // Seconds into the recording where each line starts, the lines taken in reading order; strictly increasing.
  starts: number[] | null;
  notes: SongNotes | null;
  failure: { step: NewsStep; message: string; at: string } | null;
};
export type NewsStatus = 'ready' | 'preparing' | 'waiting' | 'failed';
export type NewsSummary = { date: string; title: string; headlines: string[]; status: NewsStatus; step: NewsStep | null; error: string | null; done: number; total: number };
export type NewsView = NewsSummary & { audio: string | null; starts: number[] | null; noted: boolean; stanzas: SongNotes };
export type NewsDeps = {
  dir: string; audioDir: string; ask: Ask;
  fetchText?: (url: string) => Promise<string>;
  download?: (url: string, file: string) => Promise<void>;
  transcribe?: (file: string) => Promise<HeardWord[]>;
  now?: () => Date;
};

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', oelig: 'œ', OElig: 'Œ',
};
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => name[0] !== '#' ? NAMED[name] ?? whole
    : String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))));
}

// A sentence ends at . ! ? or … (a closing » staying with it) before a capital, a digit or an opening quote. A full
// stop after a lone capital is an initial (M. Dupont, J.-L.), not an end.
export function sentencesOf(paragraph: string): string[] {
  const sentences: string[] = [];
  let from = 0;
  for (const end of paragraph.matchAll(/[.!?…]+(?:\s*»)?(?=\s+[«"“\p{Lu}\p{N}])/gu)) {
    if (end[0] === '.' && /(?:^|[\s.'’-])\p{Lu}$/u.test(paragraph.slice(Math.max(0, end.index - 2), end.index))) continue;
    const stop = end.index + end[0].length;
    sentences.push(paragraph.slice(from, stop).trim());
    from = stop;
  }
  sentences.push(paragraph.slice(from).trim());
  return sentences.filter(Boolean);
}

// The transcript on an edition's page: each paragraph as its sentences, entities decoded and spacing made single.
export function parseTranscript(html: string): string[][] {
  const at = html.indexOf('m-transcription__content');
  const from = at < 0 ? -1 : html.indexOf('<p', at);
  if (from < 0) return [];
  // The paragraphs hold only text, so the first closing div after them ends the transcript.
  const end = html.indexOf('</div>', from);
  return [...html.slice(from, end < 0 ? undefined : end).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
    .map((paragraph) => decodeEntities(paragraph[1]!.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(sentencesOf);
}

function linkedData(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') { nodes.push(value as Record<string, unknown>); Object.values(value).forEach(walk); }
  };
  for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { walk(JSON.parse(block[1]!)); } catch { /* A broken block names nothing. */ }
  }
  return nodes;
}
const cleanTitle = (title: string) => decodeEntities(title).replace(/^Journal en français facile\s*-\s*/i, '').replace(/\s*(\.\.\.|…)$/, '').trim();

// The editions RFI's page links to, newest first; the date is the eight digits leading each edition's address.
export function parseEditionList(html: string): { date: string; page: string; title: string }[] {
  const titles = new Map<string, string>();
  for (const node of linkedData(html)) if (node['@type'] === 'PodcastEpisode' && typeof node.url === 'string' && typeof node.name === 'string') titles.set(node.url, node.name);
  const editions = new Map<string, { date: string; page: string; title: string }>();
  for (const link of html.matchAll(/href="(\/fr\/podcasts\/journal-en-fran%C3%A7ais-facile\/(\d{8})-[^"#?]+)"/g)) {
    const page = ORIGIN + link[1];
    if (!editions.has(link[2]!)) editions.set(link[2]!, { date: link[2]!, page, title: cleanTitle(titles.get(page) ?? '') });
  }
  return [...editions.values()].sort((a, b) => b.date.localeCompare(a.date));
}

// The page also plays other editions; the recording is the one named with this edition's date.
export function parseEditionPage(html: string, date: string): { mp3: string | null; title: string; stanzas: string[][] } {
  const recordings = [...html.matchAll(/https:(?:\\?\/){2}aod-fle\.akamaized\.net[^"'\s<>?]*?\.mp3/g)].map((match) => match[0].replace(/\\\//g, '/'));
  const mp3 = recordings.find((url) => url.endsWith(`_${date}.mp3`)) ?? null;
  const headline = linkedData(html).find((node) => node['@type'] === 'NewsArticle' && typeof node.headline === 'string')?.headline as string | undefined;
  return { mp3, title: cleanTitle(headline ?? ''), stanzas: parseTranscript(html) };
}

// Whisper's words with the time each starts. The tokens come byte for byte (the file read as latin1), since whisper.cpp
// can split one accented letter across two tokens; a word's bytes are decoded once the word is whole.
export function heardWords(result: { transcription: { tokens: { text: string; t_dtw: number; offsets: { from: number } }[] }[] }): HeardWord[] {
  const words: HeardWord[] = [];
  let bytes: number[] = [];
  let at = 0;
  const flush = () => {
    const text = new TextDecoder().decode(new Uint8Array(bytes)).trim();
    if (text) words.push({ text, at });
    bytes = [];
  };
  for (const token of result.transcription.flatMap((segment) => segment.tokens)) {
    if (token.text.startsWith('[_')) continue;
    if (token.text.startsWith(' ')) flush();
    if (!bytes.length) at = token.t_dtw >= 0 ? token.t_dtw / 100 : token.offsets.from / 1000;
    for (const char of token.text) bytes.push(char.charCodeAt(0) & 0xff);
  }
  flush();
  return words;
}

export async function whisperWords(file: string): Promise<HeardWord[]> {
  const dir = mkdtempSync(join(tmpdir(), 'echo-news-'));
  try {
    const child = Bun.spawn([WHISPER, '-m', WHISPER_MODEL, '-l', 'fr', '--dtw', 'large.v3.turbo', '--no-flash-attn', '-ojf', '-np', '-of', join(dir, 'heard'), file], { stdout: 'ignore', stderr: 'pipe' });
    const [said, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`Whisper could not listen to the recording (${said.trim().split('\n').pop() || `exit ${code}`}).`);
    return heardWords(JSON.parse(readFileSync(join(dir, 'heard.json')).toString('latin1')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Words compared as letters and digits only, accents and case aside: l'écoute is l + ecoute on both sides.
const units = (text: string): string[] => text.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu) ?? [];

// When each line starts in the recording. RFI's words are matched in order to Whisper's (the longest common
// subsequence); a word matched inside a run of matches, or a long one, gives its time. Every other word takes its time
// from the matched words around it, in proportion to the words between, so a line Whisper heard differently (a number
// read out, a name misheard) still gets a time.
export function lineStarts(lines: string[], heard: HeardWord[]): number[] {
  const said: string[] = [];
  const first: number[] = [];
  for (const line of lines) { first.push(said.length); said.push(...units(line)); }
  const spoken: string[] = [];
  const times: number[] = [];
  for (const word of heard) for (const unit of units(word.text)) { spoken.push(unit); times.push(word.at); }
  const n = said.length, m = spoken.length, width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) table[i * width + j] = said[i] === spoken[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (said[i] === spoken[j]) { pairs.push([i, j]); i++; j++; }
    else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i++;
    else j++;
  }
  // A short word matched alone between misses may be a coincidence (a "de" heard somewhere else).
  const known: [number, number][] = [];
  pairs.forEach(([i, j], k) => {
    const before = pairs[k - 1], after = pairs[k + 1];
    const inRun = (!!before && before[0] === i - 1 && before[1] === j - 1) || (!!after && after[0] === i + 1 && after[1] === j + 1);
    if ((inRun || said[i]!.length >= 5) && times[j]! >= (known.at(-1)?.[1] ?? 0)) known.push([i, times[j]!]);
  });
  if (!known.length || known.length < n * MIN_MATCHED) throw new Error(`Whisper heard too little of RFI’s transcript to time its lines (${n ? Math.round(known.length / n * 100) : 0}% of its words).`);
  const [i0, t0] = known[0]!, [i1, t1] = known.at(-1)!;
  const pace = i1 > i0 ? (t1 - t0) / (i1 - i0) : 0.4;
  const timeAt = (i: number): number => {
    if (i <= i0) return t0 - (i0 - i) * pace;
    if (i >= i1) return t1 + (i - i1) * pace;
    let low = 0, high = known.length - 1;
    while (high - low > 1) { const middle = (low + high) >> 1; if (known[middle]![0] <= i) low = middle; else high = middle; }
    const [ia, ta] = known[low]!, [ib, tb] = known[high]!;
    return ta + (tb - ta) * (i - ia) / (ib - ia);
  };
  const starts: number[] = [];
  for (const unit of first) {
    const at = Math.max(0, timeAt(unit) - LEAD);
    const previous = starts.at(-1);
    starts.push(Math.round((previous === undefined ? at : Math.max(at, previous + 0.1)) * 100) / 100);
  }
  return starts;
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`RFI answered ${response.status} for ${url}.`);
  return response.text();
}

async function downloadFile(url: string, file: string): Promise<void> {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(5 * 60_000) });
  if (!response.ok) throw new Error(`RFI answered ${response.status} for the recording.`);
  const part = `${file}.part`;
  await Bun.write(part, response);
  if (statSync(part).size < MIN_RECORDING) { rmSync(part, { force: true }); throw new Error('RFI sent something too small to be the recording.'); }
  renameSync(part, file);
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayOf = (date: string) => DAY.format(new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T12:00:00Z`));

export function createNews(deps: NewsDeps) {
  const fetchText = deps.fetchText ?? fetchPage;
  const download = deps.download ?? downloadFile;
  const transcribe = deps.transcribe ?? whisperWords;
  const now = deps.now ?? (() => new Date());
  mkdirSync(deps.dir, { recursive: true });
  mkdirSync(deps.audioDir, { recursive: true });
  const file = (date: string) => join(deps.dir, `${date}.json`);
  const recording = (date: string) => join(deps.audioDir, `${date}.mp3`);
  const read = (date: string): Edition => JSON.parse(readFileSync(file(date), 'utf8'));
  const save = (edition: Edition) => { writeFileSync(`${file(edition.date)}.tmp`, JSON.stringify(edition)); renameSync(`${file(edition.date)}.tmp`, file(edition.date)); };
  const dates = () => readdirSync(deps.dir).filter((name) => /^\d{8}\.json$/.test(name)).map((name) => name.slice(0, 8)).sort().reverse();
  const done: Record<NewsStep, (edition: Edition) => boolean> = {
    text: (edition) => !!edition.stanzas && !!edition.mp3,
    audio: (edition) => existsSync(recording(edition.date)),
    timing: (edition) => !!edition.starts,
    notes: (edition) => !!edition.notes,
  };
  const nextStep = (edition: Edition) => STEPS.find((step) => !done[step](edition)) ?? null;
  // The edition being prepared, and how far its notes are.
  let working: { date: string; step: NewsStep; done: number; total: number } | null = null;
  let listError: string | null = null;

  async function run(step: NewsStep, edition: Edition): Promise<Edition> {
    if (step === 'text') {
      const page = parseEditionPage(await fetchText(edition.page), edition.date);
      if (!page.mp3) throw new Error('The edition’s page has no recording yet.');
      if (!page.stanzas.length) throw new Error('RFI has not put the transcript on the edition’s page yet.');
      return { ...edition, mp3: page.mp3, stanzas: page.stanzas, title: edition.title || page.title };
    }
    if (step === 'audio') { await download(edition.mp3!, recording(edition.date)); return edition; }
    if (step === 'timing') return { ...edition, starts: lineStarts(edition.stanzas!.flat(), await transcribe(recording(edition.date))) };
    const notes = await writeNotes(deps.ask, { kind: 'news', title: `Journal en français facile, ${dayOf(edition.date)}`, artist: 'RFI', lyrics: edition.stanzas!.map((stanza) => stanza.join('\n')).join('\n\n') }, (written, total) => {
      if (working) { working.done = written; working.total = total; }
    });
    return { ...edition, notes };
  }

  // Every step still to do, in order; the first that fails is recorded and the edition waits for the next check.
  async function prepare(date: string): Promise<void> {
    let edition = read(date);
    for (let step = nextStep(edition); step; step = nextStep(edition)) {
      working = { date, step, done: 0, total: 0 };
      try {
        edition = { ...await run(step, edition), failure: null };
        save(edition);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`news: ${date} ${step} failed: ${message}`);
        save({ ...edition, failure: { step, message, at: now().toISOString() } });
        break;
      } finally {
        working = null;
      }
    }
  }

  // The latest KEEP editions of those listed and those kept; older ones go, recording and all.
  function keepLatest(listed: { date: string; page: string; title: string }[]): void {
    const kept = new Set([...dates(), ...listed.map((entry) => entry.date)].sort().reverse().slice(0, KEEP));
    for (const entry of listed) {
      if (kept.has(entry.date) && !existsSync(file(entry.date))) save({ ...entry, mp3: null, stanzas: null, starts: null, notes: null, failure: null });
    }
    for (const date of dates()) {
      if (kept.has(date)) continue;
      for (const path of [file(date), recording(date), `${recording(date)}.part`]) rmSync(path, { force: true });
    }
  }

  let running: Promise<void> | null = null;
  function check(): Promise<void> {
    if (running) return running;
    running = (async () => {
      try {
        const listed = parseEditionList(await fetchText(LIST_URL));
        if (!listed.length) throw new Error('RFI’s page lists no editions; its layout may have changed.');
        keepLatest(listed);
        listError = null;
      }
      catch (error) { listError = error instanceof Error ? error.message : String(error); console.error(`news: the list of editions could not be read: ${listError}`); }
      for (const date of dates()) if (nextStep(read(date))) await prepare(date);
    })().finally(() => { running = null; });
    return running;
  }

  function summary(edition: Edition): NewsSummary {
    const here = working?.date === edition.date ? working : null;
    const step = here?.step ?? nextStep(edition);
    const status: NewsStatus = here ? 'preparing' : edition.failure ? 'failed' : step ? 'waiting' : 'ready';
    return {
      date: edition.date, title: edition.title, headlines: edition.title.split(' / ').map((headline) => headline.trim()).filter(Boolean),
      status, step, error: edition.failure?.message ?? null, done: here?.done ?? 0, total: here?.total ?? 0,
    };
  }

  function list(): { editions: NewsSummary[]; error: string | null } {
    return { editions: dates().map((date) => summary(read(date))), error: listError };
  }

  // An edition as read: its lines with their notes once written (plain until then), and the line times once known.
  function view(date: string): NewsView {
    if (!/^\d{8}$/.test(date) || !existsSync(file(date))) throw new StoreError('That edition of the news is not in Echo.', 404);
    const edition = read(date);
    const stanzas: SongNotes = edition.notes ?? (edition.stanzas ?? []).map((stanza) => stanza.map((fr) => ({ fr, en: null, words: [] })));
    return { ...summary(edition), audio: done.audio(edition) ? `api/news/${date}.mp3` : null, starts: edition.starts, noted: !!edition.notes, stanzas };
  }

  // The recording's file, for an edition still kept.
  const audio = (date: string): string | null => /^\d{8}$/.test(date) && existsSync(file(date)) && existsSync(recording(date)) ? recording(date) : null;

  return { check, list, view, audio };
}
