import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createStore, StoreError } from './lib/store';
import { createGrammarStore } from './lib/grammar-store';
import { loadCourse } from './lib/grammar-content';
import { loadBank } from './lib/comprehension-content';
import { createComprehensionRoutes } from './lib/comprehension-routes';
import { buildTape, createClips, FRAME_BYTES, FRAME_SECONDS, layTape, planSentences, planTape, SENTENCE_TIMING, tapeView, VERB_TIMING, type Tape, type TapeItem } from './lib/walkman';
import { createSongs } from './lib/songs';
import { createClaude, createClaudeReader } from './lib/claude';
import { createWordAudio } from './lib/word-audio';
import { createTextTopup } from './lib/text-topup';
import { createWordHooks } from './lib/word-hooks';
import { createSounds, loadSounds, sideClip, type SoundAnswer } from './lib/sounds';
import { createStory, type StoryFinish } from './lib/story';
import { createRadio, englishClip, frenchClip, layStory, radioClip, radioClipExists, sentenceClips, storyLineClips, type StoryTapeMode } from './lib/radio';
import { createVerbTables, TENSE_NAMES, TENSES, tenseGuide, verbGuide, type Tense } from './lib/verbs';
import { createVerbDrills, WALKMAN_PERSONS, WALKMAN_PERSONS_SAID } from './lib/verb-drills';
import { loadFamilies, loadPatterns } from './lib/families';
import { audioFile, compressed, ranged, staticFile } from './lib/http';
import type { Direction, EndlessInput, EndlessMarkInput, GradeInput, GrammarMutation, ReviewEarlyInput, WalkmanChoice, Word } from './contract';
import { backup as snapshot } from './lib/backups';
import { createAttempts } from './lib/recording-attempts';
import { answerTexts, hint, judge, said, SCORE_GAP } from './lib/say-check';
import { createSayClips } from './lib/say-clips';
import { createWhisper, type Recording } from './lib/whisper';
// Every log line starts with the local time, so a restart or failure in data/server.log can be placed.
for (const level of ['log', 'error', 'warn'] as const) {
  const write = console[level].bind(console);
  console[level] = (...args: unknown[]) => write(new Date().toLocaleString('sv-SE'), ...args);
}

const root = import.meta.dir;
const core = await Bun.file(join(root, 'content/core.json')).json() as Word[];
const world = await Bun.file(join(root, 'content/world.json')).json() as Word[];
const groups = Map.groupBy([...core, ...world], (word) => word.category);
// Interleave topics so a mixed deck begins with useful words from every topic.
const words: Word[] = [];
for (let i = 0; i < Math.max(...[...groups.values()].map(group => group.length)); i++) {
  for (const group of groups.values()) if (group[i]) words.push(group[i]);
}
if (new Set(words.map(word => word.id)).size !== words.length) throw new Error('Duplicate vocabulary IDs');
const dbPath = process.env.ECHO_DB ?? join(root, 'data/echo.db');
// Word families bring a new word's relatives in sooner, once one of them is started.
const families = loadFamilies(root, words);
const patterns = loadPatterns(root, families);
// A word added from a song joins practice once its French recording exists.
const store = createStore(words, { dbPath, ready: (id) => existsSync(join(root, 'audio', `${id}.mp3`)), families: families.map((family) => family.members.map((member) => member.id)) });
// Song words and new texts are recorded with the deck's own scripts, in its TTS environment (see voices/provenance.json).
const python = process.env.ECHO_PYTHON ?? JSON.parse(readFileSync(join(root, 'voices/provenance.json'), 'utf8')).python as string;
// The scripts print one JSON line per clip no take passed for ({"failed": id, "attempts": [...]}); the log names
// those, with what the checker heard last. Any other failure logs stderr without the libraries' warnings.
async function runPython(args: string[], env: Record<string, string> = {}): Promise<{ ok: boolean; error: string }> {
  if (process.env.ECHO_WORD_AUDIO === 'off') return { ok: false, error: 'Recording is switched off.' };
  const child = Bun.spawn([python, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, PYTHONUNBUFFERED: '1', ...env } });
  const [output, error] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const ok = (await child.exited) === 0;
  if (ok) return { ok, error };
  // A clip id is a string; a script's closing summary may carry a count under the same key.
  const failed = output.split('\n').flatMap((line) => {
    try { const entry = JSON.parse(line) as { failed?: unknown; error?: string; attempts?: { transcript?: string }[] }; return typeof entry.failed === 'string' ? [entry] : []; } catch { return []; }
  });
  if (failed.length) for (const entry of failed) console.error(`audio: ${args[0]} could not record ${entry.failed} (${entry.attempts ? `last heard: ${JSON.stringify(entry.attempts.at(-1)?.transcript ?? '')}` : entry.error ?? 'no reason given'})`);
  else console.error(`audio: ${args[0]} failed`, error.split('\n').filter((line) => line.trim() && !/Warning|warnings\.warn|pkuseg/.test(line)).join('\n').slice(-800));
  return { ok, error };
}
const attempts = createAttempts(join(dirname(dbPath), 'recording-attempts.json'));
const wordAudio = createWordAudio({
  root, extraWordsPath: join(dirname(dbPath), 'added-words.json'),
  addedWords: () => store.addedIds().map((id) => store.word(id)!),
  run: (args) => runPython(args), attempts,
});
const ask = createClaude({ command: process.env.ECHO_CLAUDE ?? join(process.env.HOME ?? '', '.local/bin/claude'), model: process.env.ECHO_CLAUDE_MODEL });
const songs = createSongs({
  dbPath, vocabulary: store,
  read: createClaudeReader(ask), ask,
  fetchJson: async (url) => {
    const response = await fetch(url, { headers: { 'User-Agent': 'Echo French practice (personal, local)' }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`LRCLIB ${response.status}`);
    return response.json();
  },
  onAdded: (ids) => wordAudio.enqueue(ids),
});
void songs.resume();
wordAudio.resume();
const course = await loadCourse(join(root, 'content/grammar'));
const grammar = createGrammarStore(course, { dbPath, audioDir: join(root, 'audio/grammar') });
const grammarAudio = new Set(course.topics.flatMap(topic => topic.exercises.map(exercise => exercise.id)));
// Lanes Echo writes itself (lib/text-topup.ts) live next to the database, out of the checked-in content.
const generatedLanes = join(dirname(dbPath), 'comprehension');
let bank = await loadBank(root, process.env.ECHO_COMPREHENSION_DIR, [generatedLanes]);
let comprehension = createComprehensionRoutes({ root, dbPath, bank, vocabulary: store, grammar, shakyForms: () => verbs.shaky() });
const texts = createTextTopup({
  root, dataDir: dirname(dbPath), ask, stock: () => comprehension.stock(), attempts,
  ...(process.env.ECHO_TEXT_THRESHOLD ? { threshold: Number(process.env.ECHO_TEXT_THRESHOLD) } : {}),
  record: (ids, dirs) => runPython(['scripts/render-clips.py', '--set', 'comprehension', '--ids', ids.join(',')], { ECHO_COMPREHENSION_GENERATED: dirs.join(':') }),
  // A new lane joins by rebuilding the comprehension store; every stream's state is in the database. The old
  // store closes a minute later so a request already inside it can finish.
  reload: async () => {
    bank = await loadBank(root, process.env.ECHO_COMPREHENSION_DIR, [generatedLanes]);
    const previous = comprehension;
    comprehension = createComprehensionRoutes({ root, dbPath, bank, vocabulary: store, grammar, shakyForms: () => verbs.shaky() });
    setTimeout(() => previous.close(), 60_000);
  },
});
const textsStarted = process.env.ECHO_TEXT_TOPUP !== 'off' ? texts.resume() : Promise.resolve();
const textChecks = setInterval(() => { if (process.env.ECHO_TEXT_TOPUP !== 'off') void texts.check(); }, 10 * 60_000);
// The Verbs room: a conjugation table for every vocabulary verb, written by Claude in the background (at start and
// every ten minutes; ECHO_VERBS=off switches it off), and the record of every form practised.
const verbTables = createVerbTables({ file: join(dirname(dbPath), 'verbs.json'), words: () => store.words(), ask });
const verbChecks = setInterval(() => { if (process.env.ECHO_VERBS !== 'off') void verbTables.check(); }, 10 * 60_000);
if (process.env.ECHO_VERBS !== 'off') void verbTables.check();
const earClip = (said: string) => frenchClip(said).id;
// The grammar topics that teach each tense, shown on its page in the Verbs room.
const TENSE_TOPICS: Record<Tense, string[]> = {
  pres: ['etre-avoir', 'present-er', 'present-ir-re', 'irregular-present', 'reflexive'],
  pc: ['passe-compose-avoir', 'passe-compose-etre', 'pc-vs-imparfait'],
  imp: ['imparfait', 'pc-vs-imparfait'],
  fut: ['futur-simple', 'futur-proche'],
};
const verbs = createVerbDrills({
  dbPath, verbs: () => verbTables.verbs(), vocabulary: () => store.listening(),
  earAudio: (said) => existsSync(join(root, 'audio/radio', `${earClip(said)}.mp3`)) ? `audio/radio/${earClip(said)}.mp3` : null,
});
// Memory hooks for stubborn words and verb forms: at start and every ten minutes (ECHO_WORD_HOOKS=off switches them off).
const hooks = createWordHooks({ ask, store, verbs });
const hookChecks = setInterval(() => { if (process.env.ECHO_WORD_HOOKS !== 'off') void hooks.check(); }, 10 * 60_000);
if (process.env.ECHO_WORD_HOOKS !== 'off') void hooks.check();
// The Sounds drill: both sides of every pair, recorded after the texts (one voice model at a time).
const soundsContent = await loadSounds(join(root, 'content/sounds.json'));
const soundClips = new Set(soundsContent.contrasts.flatMap((contrast) => contrast.items.flatMap((item) => [sideClip(item.id, 'a'), sideClip(item.id, 'b')])));
const soundExists = (id: string) => existsSync(join(root, 'audio/sounds', `${id}.mp3`));
const sounds = createSounds(soundsContent, { dbPath, clipExists: soundExists });
void textsStarted.then(async () => {
  if (process.env.ECHO_WORD_AUDIO === 'off') return;
  const missing = [...soundClips].filter((id) => !soundExists(id));
  const skipped = attempts.skipped(missing);
  if (skipped.length) console.log(`sounds: not retrying ${skipped.length} ${skipped.length === 1 ? 'side' : 'sides'} (failed 3 times; see data/recording-attempts.json)`);
  const tried = attempts.allowed(missing);
  if (!tried.length) return;
  await runPython(['scripts/render-sounds.py', '--ids', tried.join(',')]);
  attempts.note(tried, (id) => !soundExists(id));
});
// The Story: a serial written a little above what the learner knows (lib/story.ts). What they know comes from
// the vocabulary (any word no longer new), what they understood in Read and Listen, and their grammar progress.
const storyDir = process.env.ECHO_STORY_DIR ?? join(dirname(dbPath), 'story');
const storyExists = (id: string) => existsSync(join(root, 'audio/story', `${id}.mp3`));
const story = createStory({
  dir: storyDir, dbPath, ask, clipExists: storyExists,
  knowledge: () => {
    const words = store.listening();
    const met = comprehension.metWords();
    return {
      known: words.filter((word) => word.status !== 'new' || met.words.has(word.id)).map((word) => ({ id: word.id, fr: word.fr, en: word.en })),
      deck: words.map((word) => ({ id: word.id, fr: word.fr })),
      forms: [...met.forms],
      level: comprehension.summary().levels.find((entry) => entry.mode === 'read')?.value ?? 1,
      topics: grammar.catalog().flatMap((unit) => unit.topics.map((topic) => ({ id: topic.id, title: topic.title, level: topic.level, description: topic.description, seen: topic.progress.seen, independent: topic.progress.independent }))),
    };
  },
  record: async (ids) => {
    const tried = attempts.allowed(ids);
    if (!tried.length) return;
    await runPython(['scripts/render-clips.py', '--set', 'story', '--ids', tried.join(',')], { ECHO_STORY_DIR: storyDir });
    if (process.env.ECHO_WORD_AUDIO !== 'off') attempts.note(tried, (id) => !storyExists(id));
  },
});
void textsStarted.then(() => { if (process.env.ECHO_STORY !== 'off') return story.check(); });
const storyChecks = setInterval(() => { if (process.env.ECHO_STORY !== 'off') void story.check(); }, 10 * 60_000);
// The Radio: one episode a day from today's words, the latest recorded story episode and one grammar point.
const radio = createRadio({
  root, dataDir: dirname(dbPath), ask,
  words: () => store.listening(),
  sentences: () => bank.sentences,
  episode: () => [...story.episodes()].reverse().find((episode) => episode.lines.every((_, index) => storyExists(`${episode.id}-${index + 1}`))) ?? null,
  topics: () => grammar.catalog().flatMap((unit) => unit.topics.map((topic) => ({ id: topic.id, title: topic.title, level: topic.level, description: topic.description, independent: topic.progress.independent }))),
  level: () => comprehension.summary().levels.find((entry) => entry.mode === 'read')?.label ?? 'A2',
  record: (planPath) => runPython(['scripts/render-radio.py', '--plan', planPath]),
  ready: () => process.env.ECHO_STORY !== 'off' ? story.check() : Promise.resolve(),
});
// The Walkman's sentence tape plays every recorded Listen/Read sentence converted to the Walkman format, with
// its English said and checked, and the Story page's tape does the same with each recorded story line (those
// first, as there are few). They are made in the background after each Radio check, one renderer at a time,
// each tried a few times.
let sentencesRecording: Promise<void> | null = null;
function recordSentences(): Promise<void> {
  if (process.env.ECHO_WORD_AUDIO === 'off') return Promise.resolve();
  sentencesRecording ??= (async () => {
    const storyLines = story.episodes().flatMap((episode) => episode.lines.flatMap((line, index) => {
      if (!storyExists(`${episode.id}-${index + 1}`)) return [];
      const clips = storyLineClips(episode.id, index, line.en);
      return [clips.fr, clips.en];
    }));
    const tape = verbs.walkmanPhrases();
    const phrases = [...tape.french.map(frenchClip), ...tape.english.map(englishClip), ...verbs.earPhrases().map(frenchClip)];
    const sentences = bank.sentences.filter((sentence) => existsSync(join(root, `audio/comprehension/${sentence.id}.mp3`)))
      .flatMap((sentence) => { const clips = sentenceClips(sentence); return [clips.fr, clips.en]; });
    const missing = [...new Map([...storyLines, ...phrases, ...sentences].map((clip) => [clip.id, clip])).values()].filter((clip) => !radioClipExists(root, clip.id));
    const allowed = new Set(attempts.allowed(missing.map((clip) => clip.id)));
    const plan = missing.filter((clip) => allowed.has(clip.id));
    if (!plan.length) return;
    const planPath = join(dirname(dbPath), 'radio', 'sentences.plan.json');
    mkdirSync(dirname(planPath), { recursive: true });
    writeFileSync(planPath, JSON.stringify(plan, null, 1));
    await runPython(['scripts/render-radio.py', '--plan', planPath]);
    attempts.note(plan.map((clip) => clip.id), (id) => !radioClip(root, id));
  })().catch((error: Error) => console.error(`sentence tape: ${error.message}`)).finally(() => { sentencesRecording = null; });
  return sentencesRecording;
}
const radioThenSentences = async () => { if (process.env.ECHO_RADIO !== 'off') await radio.check(); await recordSentences(); };
void textsStarted.then(radioThenSentences);
// The recorder loads voice models of several GB; while the learner is using Echo it waits for a quiet spell, so
// the Mac never has to make room for them in the middle of a practice.
const QUIET_BEFORE_RECORDING = 3 * 60_000;
let lastRequestAt = 0;
const radioChecks = setInterval(() => { if (Date.now() - lastRequestAt >= QUIET_BEFORE_RECORDING) void radioThenSentences(); }, 10 * 60_000);
const port = Number(process.env.ECHO_PORT ?? 7792);
const prefix = '/echo';
const publicOrigin = process.env.ECHO_ORIGIN ?? 'https://gals-macbook-pro.tailb1ce54.ts.net';
// Rooms this Echo leaves out (the friends' pilot: story,radio,songs, which write and record for one learner). The page
// carries the list, and the app hides those rooms.
const roomsOff = (process.env.ECHO_ROOMS_OFF ?? '').split(',').map((room) => room.trim()).filter((room) => /^[a-z]+$/.test(room));
// The signed-in learner's name, in the friends' Echo (pilot/router.ts): the app shows it beside Sign out.
const learnerName = process.env.ECHO_LEARNER?.trim() ?? '';
const attribute = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// The friends' Echo's admin door on this Mac, for the Friends page (the owner's Echo only).
const pilotAdmin = process.env.ECHO_PILOT_ADMIN ?? 'http://127.0.0.1:7898';
const allowedHosts = new Set([new URL(publicOrigin).host, `127.0.0.1:${port}`, `localhost:${port}`]);
const allowedOrigins = new Set([publicOrigin, `http://127.0.0.1:${port}`, `http://localhost:${port}`]);
// Say it: the learner hears a French word and says its English aloud; recognition runs on this Mac (lib/whisper.ts,
// lib/whisper-mlx.py), in the Python environment set up for it under ~/.local/share/echo-whisper.
const whisper = createWhisper({
  python: process.env.ECHO_WHISPER_PYTHON ?? join(process.env.HOME ?? '', '.local/share/echo-whisper/venv/bin/python'),
  script: join(root, 'lib/whisper-mlx.py'),
  model: process.env.ECHO_WHISPER_MODEL ?? 'mlx-community/whisper-large-v3-turbo',
  ffmpeg: process.env.ECHO_FFMPEG ?? '/opt/homebrew/bin/ffmpeg',
  port: Number(process.env.ECHO_WHISPER_PORT ?? 7793),
});
const sayClips = createSayClips(join(dirname(dbPath), 'say-clips'));
const whisperSweep = setInterval(() => whisper.sweep(), 60_000);

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
// Walkman tapes live in memory, the latest few only; clips are re-read whenever they are rebuilt.
const walkmanClips = createClips(join(root, 'audio'));
const walkmanManifest = join(root, 'audio/walkman/manifest.json');
let walkmanStamp = 0;
const tapes = new Map<string, Tape>();
function newTape(choice: WalkmanChoice, tenses: Tense[] = ['pres']): Tape {
  const stamp = existsSync(walkmanManifest) ? statSync(walkmanManifest).mtimeMs : 0;
  if (stamp !== walkmanStamp) { walkmanClips.forget(); walkmanStamp = stamp; }
  const listening = store.listening();
  const tape = choice === 'verbs' ? verbTape(tenses) : choice === 'sentences' ? sentenceTape(listening) : (() => {
    const fresh = new Set(listening.filter((word) => word.status === 'new').map((word) => word.id));
    return buildTape(crypto.randomUUID(), planTape(listening, 600, Math.random, choice), new Map(store.words().map((word) => [word.id, word])), walkmanClips, fresh);
  })();
  if (!tape.words.length) throw new StoreError(choice === 'verbs' ? 'The verb recordings are still being made on your Mac. Please try again later.' : choice === 'sentences' ? 'The sentence recordings are still being made. Please try again later.' : 'The Walkman recordings are not ready yet. Please try again later.', 503);
  tapes.set(tape.id, tape);
  for (const id of [...tapes.keys()].slice(0, -3)) tapes.delete(id);
  return tape;
}
// The verb tape: for each form of the most common verbs, the verb (its Walkman word recording), the tense and the
// person, a pause to say the form in your head, then the form twice. A form not yet recorded is left out.
function verbTape(tenses: Tense[]): Tape {
  const silence = walkmanClips.silence();
  if (!silence) throw new Error('The Walkman silence frame is missing.');
  const gap = (() => { const count = Math.round(0.3 / FRAME_SECONDS); const block = new Uint8Array(count * FRAME_BYTES); for (let frame = 0; frame < count; frame++) block.set(silence.subarray(0, FRAME_BYTES), frame * FRAME_BYTES); return block; })();
  const join = (parts: Uint8Array[]) => { const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length; } return bytes; };
  const tenseClips = new Map(TENSES.map((tense) => [tense, radioClip(root, frenchClip(TENSE_NAMES[tense]).id)]));
  const personClips = WALKMAN_PERSONS_SAID.map((said) => radioClip(root, englishClip(said).id));
  const forms = verbs.walkmanForms(tenses);
  function* items(): Generator<TapeItem> {
    // Round after round of the same forms, each in a fresh order, until the tape is full.
    for (let round = 0; round < 50; round++) {
      let laid = 0;
      for (const form of round ? verbs.walkmanForms(tenses) : forms) {
        const name = walkmanClips.french(form.verbId), tense = tenseClips.get(form.tense), person = personClips[form.person];
        const answerId = frenchClip(form.said).id;
        const answer = radioClip(root, answerId);
        if (!name || !tense || !person || !answer) continue;
        laid++;
        yield {
          id: `${form.verbId}~${form.tense}~${form.person}`, fr: `${form.verb.inf} · ${TENSE_NAMES[form.tense]} · ${WALKMAN_PERSONS[form.person]}`, en: form.shown, fresh: false,
          verb: { verbId: form.verbId, tense: form.tense, person: form.person, audio: `audio/radio/${answerId}.mp3` },
          french: join([name, gap, tense, gap, person]), english: answer, again: answer,
        };
      }
      if (!laid) return;
    }
  }
  return layTape(crypto.randomUUID(), 'verbs', items(), silence, VERB_TIMING);
}
// Sentences up to the Read level, those holding the words most worth hearing likelier to come first.
function sentenceTape(listening: ReturnType<typeof store.listening>): Tape {
  const silence = walkmanClips.silence();
  if (!silence) throw new Error('The Walkman silence frame is missing.');
  const level = comprehension.summary().levels.find((entry) => entry.mode === 'read')?.label ?? 'A2';
  function* items(): Generator<TapeItem> {
    for (const sentence of planSentences(bank.sentences, listening, level)) {
      const clips = sentenceClips(sentence);
      const french = radioClip(root, clips.fr.id);
      const english = radioClip(root, clips.en.id);
      if (french && english) yield { id: sentence.id, fr: sentence.fr, en: sentence.en, fresh: false, sentence: true, french, english };
    }
  }
  return layTape(crypto.randomUUID(), 'sentences', items(), silence, SENTENCE_TIMING);
}
// The Story page's tapes, built from the made clips whenever a clip joins them; the URL carries which clips
// went in, so a page holding an older tape asks for the new one.
const storyTapes = new Map<string, { version: string; tape: NonNullable<ReturnType<typeof layStory>> }>();
function storyTape(number: number, mode: StoryTapeMode) {
  const episode = story.episodes().find((entry) => entry.number === number);
  const silence = walkmanClips.silence();
  if (!episode || !silence) return null;
  const clips = episode.lines.map((line, index) => { const ids = storyLineClips(episode.id, index, line.en); return { fr: radioClip(root, ids.fr.id), en: mode === 'both' ? radioClip(root, ids.en.id) : null }; });
  const version = Bun.hash(clips.map((clip) => `${clip.fr ? 1 : 0}${clip.en ? 1 : 0}`).join('')).toString(36);
  const key = `${episode.id}:${mode}`;
  const kept = storyTapes.get(key);
  if (kept?.version === version) return kept;
  const tape = layStory(clips, mode, silence);
  if (!tape) return null;
  const entry = { version, tape };
  storyTapes.set(key, entry);
  return entry;
}
function storyWithTapes(view: ReturnType<typeof story.view>) {
  const tape = (mode: StoryTapeMode) => {
    const built = storyTape(view.episode.number, mode);
    return built ? { url: `api/story/${view.episode.number}/${mode}.mp3?v=${built.version}`, seconds: built.tape.seconds, lines: built.tape.lines } : null;
  };
  return { ...view, tapes: { fr: tape('fr'), both: tape('both') } };
}
function direction(value: unknown): Direction {
  if (value !== 'fr-en' && value !== 'en-fr') throw new StoreError('Choose French to English or English to French.', 400);
  return value;
}
function deck(value: unknown): string {
  if (typeof value !== 'string') throw new StoreError('Choose a vocabulary deck.', 400);
  return value;
}
async function body(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new StoreError('This action requires a JSON request.', 415);
  }
  let data: unknown;
  try { data = await req.json(); } catch { throw new StoreError('The request was not valid JSON. Please try again.', 400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new StoreError('The request must be an object.', 400);
  return data as Record<string, unknown>;
}
function grammarMutation(data: Record<string, unknown>): GrammarMutation {
  const { sessionId, exerciseId, version, requestId } = data;
  if (typeof sessionId !== 'string' || !sessionId || typeof exerciseId !== 'string' || !exerciseId ||
      typeof version !== 'number' || !Number.isInteger(version) || version < 0 ||
      typeof requestId !== 'string' || !requestId) {
    throw new StoreError('This exercise has changed. Reload it and try again.', 400);
  }
  return { sessionId, exerciseId, version, requestId };
}
const staticFiles: Record<string, true> = {
  'index.html': true, 'app.js': true, 'app.css': true, 'icon.svg': true,
  'icon-180.png': true, 'icon-192.png': true, 'icon-512.png': true, 'manifest.webmanifest': true,
};

const server = Bun.serve({
  hostname: '127.0.0.1', port,
  // Every response goes out through compressed(), which gzips text for a browser that accepts it.
  async fetch(req) { return compressed(req, await route(req)); },
});
async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (!allowedHosts.has(req.headers.get('host') ?? '')) return json({ error: 'Unknown host.' }, 403);
  let path = url.pathname;
  if (path === prefix) return Response.redirect(`${prefix}/`, 308);
  if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length);
  if (path.startsWith('/api/')) lastRequestAt = Date.now();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin');
    if ((origin && !allowedOrigins.has(origin)) || req.headers.get('sec-fetch-site') === 'cross-site') {
      return json({ error: 'Open Echo directly before changing your progress.' }, 403);
    }
  }
  try {
    if (path === '/healthz' && req.method === 'GET') return json({ ok: true, app: 'Echo', words: words.length });
    // The learning rooms are gone; their bookmarks open the app home. The proxy may strip /echo, so the
    // redirect is relative: it lands on the home page under whatever prefix the browser used.
    if (path === '/learn' || path === '/learn/' || path === '/learning.html') {
      return new Response(null, { status: 308, headers: { location: path === '/learn/' ? '../' : './' } });
    }
    const comprehended = await comprehension.handle(path, req, url);
    if (comprehended) return comprehended;
    if (path === '/api/state' && req.method === 'GET') return json(store.state(direction(url.searchParams.get('direction') ?? 'fr-en'), deck(url.searchParams.get('deck') ?? 'all')));
    if (path === '/api/families' && req.method === 'GET') return json({ families, patterns });
    if (path === '/api/words' && req.method === 'GET') return json({ words: store.browse(direction(url.searchParams.get('direction') ?? 'fr-en'), deck(url.searchParams.get('deck') ?? 'all')) });
    // Word id → gender for every noun, so the client can colour a tappable word linked to one.
    if (path === '/api/genders' && req.method === 'GET') return json(Object.fromEntries(store.words().flatMap((word) => word.gender ? [[word.id, word.gender]] : [])));
    // The Friends page: who may use the friends' Echo, who tried, and the door for new people. Passed to its admin
    // door, which only this Mac can reach.
    if (['/api/friends', '/api/friends/remove', '/api/friends/dismiss', '/api/friends/door'].includes(path) && !roomsOff.includes('friends')) {
      const sent = req.method === 'POST' ? JSON.stringify(await body(req)) : undefined;
      let reply: Response;
      try { reply = await fetch(`${pilotAdmin}${path.slice('/api'.length)}`, { method: req.method === 'POST' ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: sent, signal: AbortSignal.timeout(5000) }); }
      catch { throw new StoreError('The friends’ Echo is not running on this Mac.', 503); }
      return json(await reply.json(), reply.status);
    }
    if (path === '/api/statistics' && req.method === 'GET') {
      const grammarTopics = grammar.catalog().flatMap((unit) => unit.topics).filter((topic) => topic.progress.seen > 0).length;
      return json({ ...store.statistics(), ...comprehension.summary(), grammarTopics, texts: texts.status(), verbs: verbs.statistics() });
    }
    const statisticsDay = path.match(/^\/api\/statistics\/day\/(\d{4}-\d{2}-\d{2})$/);
    if (statisticsDay && req.method === 'GET') return json(store.statisticsDay(statisticsDay[1]!));
    if (path === '/api/export' && req.method === 'GET') return new Response(JSON.stringify(Object.assign({}, store.exportData(), { version: 3, grammar: grammar.exportData(), comprehension: comprehension.exportData() }), null, 2), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="echo-progress-${new Date().toISOString().slice(0, 10)}.json"` } });
    if (path === '/api/grammar' && req.method === 'GET') return json({ units: grammar.catalog() });
    if (path === '/api/grammar/state' && req.method === 'GET') return json(grammar.state(url.searchParams.get('scope') ?? ''));
    if (path === '/api/grammar/session' && req.method === 'POST') {
      const data = await body(req);
      if (typeof data.scope !== 'string' || !data.scope || typeof data.requestId !== 'string' || !data.requestId) {
        throw new StoreError('Choose a grammar topic, test or unit test and try again.', 400);
      }
      return json(grammar.start(data.scope, data.requestId));
    }
    if (path === '/api/grammar/answer' && req.method === 'POST') {
      const data = await body(req);
      const mutation = grammarMutation(data);
      if (typeof data.answer !== 'string') throw new StoreError('Enter your answer before checking it.', 400);
      if (data.tokenOrder !== undefined && (!Array.isArray(data.tokenOrder) || !data.tokenOrder.every(Number.isInteger))) {
        throw new StoreError('Choose words from this exercise’s tiles and try again.', 400);
      }
      return json(grammar.answer({ ...mutation, answer: data.answer, tokenOrder: data.tokenOrder as number[] | undefined }));
    }
    if (path === '/api/grammar/help' && req.method === 'POST') {
      const data = await body(req);
      const mutation = grammarMutation(data);
      if (data.kind !== 'hint' && data.kind !== 'rule' && data.kind !== 'answer') {
        throw new StoreError('Choose a hint, the rule, or the answer.', 400);
      }
      return json(grammar.help({ ...mutation, kind: data.kind }));
    }
    if (path === '/api/grammar/next' && req.method === 'POST') return json(grammar.next(grammarMutation(await body(req))));
    if (path === '/api/settings' && req.method === 'PUT') {
      const data = await body(req);
      if (typeof data.newPerDay !== 'number') throw new StoreError('New words per day must be a number.', 400);
      return json(store.setSettings(data.newPerDay));
    }
    if (path === '/api/settings/songs' && req.method === 'PUT') {
      const data = await body(req);
      return json(store.setSongsFirst(data.songsFirst as boolean));
    }
    // Song words are practised French → English (a word tapped in a text joins that direction too).
    if (path === '/api/songs' && req.method === 'GET') return json({ songs: songs.list(), audio: wordAudio.status(), decks: store.deckCounts('fr-en') });
    if (path === '/api/songs/search' && req.method === 'GET') return json({ matches: await songs.search(url.searchParams.get('q') ?? '') });
    if (path === '/api/songs' && req.method === 'POST') {
      const data = await body(req);
      return json(await songs.start(typeof data.lrclibId === 'number' ? { lrclibId: data.lrclibId } : { title: String(data.title ?? ''), artist: String(data.artist ?? ''), lyrics: String(data.lyrics ?? '') }));
    }
    const song = path.match(/^\/api\/songs\/([0-9a-f-]{36})(?:\/(add|retry|lyrics|notes))?$/);
    if (song?.[2] === 'lyrics' && req.method === 'GET') return json(songs.lyrics(song[1]));
    if (song?.[2] === 'notes' && req.method === 'POST') return json(songs.rewriteNotes(song[1]));
    if (song && !song[2] && req.method === 'GET') return json(songs.get(song[1]));
    if (song && !song[2] && req.method === 'DELETE') { songs.remove(song[1]); return json({ ok: true }); }
    if (song?.[2] === 'add' && req.method === 'POST') {
      const data = await body(req);
      return json(songs.add(song[1], Array.isArray(data.words) ? data.words.map(String) : []));
    }
    if (song?.[2] === 'retry' && req.method === 'POST') return json(await songs.retry(song[1]));
    if (path === '/api/extra-words' && req.method === 'POST') {
      const data = await body(req);
      return json(store.addExtraWords({ direction: direction(data.direction), deck: deck(data.deck), count: data.count as number, requestId: data.requestId as string }));
    }
    if (path === '/api/review-early' && req.method === 'POST') {
      const data = await body(req);
      return json(store.reviewEarly({ direction: direction(data.direction), deck: deck(data.deck), mode: data.mode as ReviewEarlyInput['mode'], count: data.count as number, requestId: data.requestId as string }));
    }
    if (path === '/api/session' && req.method === 'POST') {
      const data = await body(req);
      return json(store.start(direction(data.direction), deck(data.deck)));
    }
    if (path === '/api/grade' && req.method === 'POST') {
      const data = await body(req);
      if (typeof data.wordId !== 'string' || typeof data.known !== 'boolean' || !Number.isInteger(data.version) || typeof data.requestId !== 'string' || !data.requestId) {
        throw new StoreError('The answer was incomplete. Reload this card and try again.', 400);
      }
      return json(store.grade({ ...data, direction: direction(data.direction), deck: deck(data.deck) } as GradeInput));
    }
    if (path === '/api/undo' && req.method === 'POST') {
      const data = await body(req);
      if (typeof data.undoId !== 'string') throw new StoreError('There is no answer to undo.', 400);
      return json(store.undo(direction(data.direction), deck(data.deck), data.undoId));
    }
    if (path === '/api/walkman' && req.method === 'POST') {
      const data = await body(req);
      if (data.words !== undefined && !['scored', 'groups', 'sentences', 'verbs'].includes(data.words as string)) throw new StoreError('Choose what the Walkman plays: words by score, words by groups, sentences, or verbs.', 400);
      const tenses = Array.isArray(data.tenses) ? TENSES.filter((tense) => (data.tenses as unknown[]).includes(tense)) : ['pres' as Tense];
      return json(tapeView(newTape((data.words as WalkmanChoice | undefined) ?? 'scored', tenses)));
    }
    if (path === '/api/walkman/heard' && req.method === 'POST') {
      const data = await body(req);
      store.recordHeard({ wordId: String(data.wordId ?? ''), requestId: String(data.requestId ?? '') });
      return json({ ok: true });
    }
    if (path === '/api/endless/next' && req.method === 'POST') { const data = await body(req); return json(store.endlessNext({ ...data, direction: direction(String(data.direction ?? 'fr-en')), deck: deck(String(data.deck ?? 'all')) } as EndlessInput)); }
    if (path === '/api/endless/mark' && req.method === 'POST') { const data = await body(req); store.endlessMark(data as unknown as EndlessMarkInput); return json({ ok: true }); }
    if (path === '/api/endless/undo' && req.method === 'POST') { const data = await body(req); store.endlessUndo(String(data.requestId ?? '')); return json({ ok: true }); }
    if (path === '/api/walkman/verdict' && req.method === 'POST') {
      const data = await body(req);
      store.recordVerdict({ id: String(data.id ?? ''), wordId: String(data.wordId ?? ''), knew: data.knew as boolean | null });
      return json({ ok: true });
    }
    // Say it: a recording of the learner saying a French word's English, judged against the word's meanings and what
    // they once marked right for it. When that says wrong, the wanted answer is scored against the recording: nearly
    // as likely as what was heard, it was said and recognition misread it. Right counts like a Walkman ✓; wrong or
    // "I don't know" like ✗; what recognition could not make out counts for nothing, and the phone listens on.
    if (path === '/api/say/check' && req.method === 'POST' && !roomsOff.includes('say')) {
      if (!req.headers.get('content-type')?.toLowerCase().startsWith('audio/')) throw new StoreError('Send the recording itself.', 415);
      const wordId = url.searchParams.get('word') ?? '', requestId = url.searchParams.get('request') ?? '';
      const word = store.word(wordId);
      if (!word) throw new StoreError('This word is not in the vocabulary deck.', 404);
      if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) throw new StoreError('This answer has no request id.');
      const clip = new Uint8Array(await req.arrayBuffer());
      if (!clip.length || clip.length > 4_000_000) throw new StoreError('That recording is empty or too long.');
      let recording: Recording, heard: string;
      try { recording = await whisper.open(clip); heard = await recording.transcribe(hint(word.en)); }
      catch (error) { throw new StoreError(`Echo could not listen: ${(error as Error).message}`, 503); }
      try {
        let verdict = judge(heard, word.en, store.sayAccepted(wordId));
        let gap: number | null = null;
        if (verdict === 'wrong') {
          try {
            const [heardScore, ...answerScores] = await recording.score([heard, ...answerTexts(word.en)]);
            gap = Math.round((heardScore! - Math.max(...answerScores)) * 10) / 10;
            if (gap <= SCORE_GAP) verdict = 'right';
          } catch (error) { console.error(`say: scoring failed: ${(error as Error).message}`); }
        }
        if (verdict !== 'unclear') store.recordVerdict({ id: `say-${requestId}`, wordId, knew: verdict === 'right' });
        // What was heard, kept in the log so a verdict that seems wrong can be looked into afterwards.
        console.log(`say: ${word.fr} (${word.en}) heard ${JSON.stringify(heard.trim())} → ${verdict}${gap === null ? '' : ` (answer ${gap} below what was heard)`}`);
        if (gap !== null) {
          try { sayClips.keep(requestId, recording.wav, { word: wordId, fr: word.fr, en: word.en, heard, verdict, gap }); }
          catch (error) { console.error(`say: keeping the clip failed: ${(error as Error).message}`); }
        }
        return json({ verdict, heard, en: word.en });
      } finally {
        recording.close();
      }
    }
    // Heard wrong: the learner says they said it right. The check's ✗ becomes ✓, and what was heard counts as the
    // word's English from then on.
    if (path === '/api/say/correct' && req.method === 'POST' && !roomsOff.includes('say')) {
      const data = await body(req);
      const requestId = String(data.request ?? '');
      if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) throw new StoreError('This answer has no request id.');
      const wordId = String(data.word ?? ''), heard = said(String(data.heard ?? ''));
      store.acceptSaid({ id: `say-${requestId}`, wordId, heard });
      sayClips.markedRight(requestId);
      console.log(`say: ${store.word(wordId)?.fr ?? wordId} marked right; "${heard}" now counts for it`);
      return json({ ok: true });
    }
    const tapeAudio = path.match(/^\/api\/walkman\/([0-9a-f-]+)\.mp3$/);
    if (tapeAudio && (req.method === 'GET' || req.method === 'HEAD')) {
      const tape = tapes.get(tapeAudio[1]!);
      if (!tape) return json({ error: 'This tape has ended. Start the Walkman again for a new one.' }, 404);
      return ranged(req, tape.bytes.length, (start, end) => tape.bytes.subarray(start, end), { 'Cache-Control': 'no-store' });
    }
    const radioAudio = path.match(/^\/api\/radio\/(\d{4}-\d{2}-\d{2})\.mp3$/);
    if (radioAudio && (req.method === 'GET' || req.method === 'HEAD')) {
      const bytes = radio.audio(radioAudio[1]!);
      if (!bytes) return json({ error: 'This Radio episode is over. Open the Radio again for today’s.' }, 404);
      return ranged(req, bytes.length, (start, end) => bytes.subarray(start, end), { 'Cache-Control': 'no-store' });
    }
    if (path === '/api/radio' && req.method === 'GET') return json(radio.view());
    const storyClip = path.match(/^\/audio\/story\/(story-\d{2}-\d+)\.mp3$/);
    if (storyClip && (req.method === 'GET' || req.method === 'HEAD')) {
      const file = Bun.file(join(root, 'audio/story', `${storyClip[1]}.mp3`));
      if (!await file.exists()) return json({ error: 'This line has not been recorded yet.' }, 404);
      return audioFile(req, file);
    }
    if (path === '/api/story' && req.method === 'GET') return json(story.status());
    const storyEpisode = path.match(/^\/api\/story\/(\d+)(\/finish)?$/);
    if (storyEpisode && !storyEpisode[2] && req.method === 'GET') return json(storyWithTapes(story.view(Number(storyEpisode[1]))));
    if (storyEpisode?.[2] && req.method === 'POST') { const data = await body(req); return json(storyWithTapes(story.finish(Number(storyEpisode[1]), data as unknown as StoryFinish))); }
    const storyAudio = path.match(/^\/api\/story\/(\d+)\/(fr|both)\.mp3$/);
    if (storyAudio && (req.method === 'GET' || req.method === 'HEAD')) {
      const built = storyTape(Number(storyAudio[1]), storyAudio[2] as StoryTapeMode);
      if (!built) return json({ error: 'This episode’s recordings are still being made.' }, 404);
      const bytes = built.tape.bytes;
      return ranged(req, bytes.length, (start, end) => bytes.subarray(start, end), { 'Cache-Control': 'no-store' });
    }
    const soundClip = path.match(/^\/audio\/sounds\/([a-z0-9-]+)\.mp3$/);
    if (soundClip && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!soundClips.has(soundClip[1]!)) return json({ error: 'This sound is not part of a drill.' }, 404);
      const file = Bun.file(join(root, 'audio/sounds', `${soundClip[1]}.mp3`));
      if (!await file.exists()) return json({ error: 'This sound has not been recorded yet.' }, 404);
      return audioFile(req, file);
    }
    if (path === '/api/verbs' && req.method === 'GET') return json({ ...verbs.summary(), tables: verbTables.status() });
    // A tense explained: the grammar guides on it, then the learner's verbs sorted by what is regular about them.
    const tensePage = path.match(/^\/api\/verbs\/tense\/([a-z]+)$/);
    if (tensePage && req.method === 'GET') {
      const tense = tensePage[1] as Tense;
      if (!TENSES.includes(tense)) return json({ error: 'Echo does not drill that tense.' }, 404);
      const guides = TENSE_TOPICS[tense].flatMap((id) => { const topic = course.topics.find((entry) => entry.id === id); return topic ? [{ id: topic.id, title: topic.title, level: topic.level, guide: topic.guide }] : []; });
      return json({ ...tenseGuide(verbTables.verbs(), tense), guides });
    }
    const verbPage = path.match(/^\/api\/verbs\/verb\/([a-z0-9-]+)$/);
    if (verbPage && req.method === 'GET') {
      const verb = verbTables.verbs().find((entry) => entry.id === verbPage[1]);
      return verb ? json(verbGuide(verb)) : json({ error: 'That verb is not in Echo.' }, 404);
    }
    if (path === '/api/verbs/round' && req.method === 'POST') { const data = await body(req); return json({ items: verbs.round(data as never) }); }
    if (path === '/api/verbs/cards' && req.method === 'POST') { const data = await body(req); return json({ items: verbs.cards(data as never) }); }
    if (path === '/api/verbs/mark' && req.method === 'POST') { const data = await body(req); return json(verbs.mark(data as never)); }
    if (path === '/api/verbs/answer' && req.method === 'POST') { const data = await body(req); return json(verbs.answer(data as never)); }
    const verbScoresDay = path.match(/^\/api\/verbs\/scores\/(\d{4}-\d{2}-\d{2})$/);
    if (verbScoresDay && req.method === 'GET') return json({ forms: verbs.scoresOn(verbScoresDay[1]!) });
    if (path === '/api/verbs/next-table' && req.method === 'POST') { const data = await body(req); return json(verbs.nextTable(data as never)); }
    if (path === '/api/verbs/table' && req.method === 'POST') { const data = await body(req); return json(verbs.table(data as never)); }
    if (path === '/api/verbs/ear' && req.method === 'POST') { const data = await body(req); return json({ questions: verbs.earRound(data as never) }); }
    if (path === '/api/verbs/ear-answer' && req.method === 'POST') { const data = await body(req); return json(verbs.earAnswer(data as never)); }
    // By ear's recorded phrases.
    const earFile = path.match(/^\/audio\/radio\/(fr-[0-9a-f]{16})\.mp3$/);
    if (earFile && (req.method === 'GET' || req.method === 'HEAD')) {
      const file = Bun.file(join(root, 'audio/radio', `${earFile[1]}.mp3`));
      if (!await file.exists()) return json({ error: 'This phrase has not been recorded yet.' }, 404);
      return audioFile(req, file);
    }
    if (path === '/api/sounds' && req.method === 'GET') return json({ contrasts: sounds.summary() });
    if (path === '/api/sounds/round' && req.method === 'POST') { const data = await body(req); return json({ questions: sounds.round(String(data.id ?? '')) }); }
    if (path === '/api/sounds/answer' && req.method === 'POST') { const data = await body(req); return json(sounds.answer(data as unknown as SoundAnswer)); }
    // A word's English, as the Walkman says it: Say it plays it after a miss.
    const englishAnswer = path.match(/^\/audio\/en\/([a-z0-9-]+)\.mp3$/);
    if (englishAnswer && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!store.word(englishAnswer[1]!)) return json({ error: 'This word is not in the vocabulary deck.' }, 404);
      const file = Bun.file(join(root, 'audio/en', `${englishAnswer[1]}.mp3`));
      if (!await file.exists()) return json({ error: 'This English recording has not been made yet.' }, 404);
      return audioFile(req, file);
    }
    if (path.startsWith('/audio/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const spoken = path.match(/^\/audio\/grammar\/([a-z0-9-]+)\.mp3$/);
      const word = path.match(/^\/audio\/([a-z0-9-]+)\.mp3$/);
      if (spoken && !grammarAudio.has(spoken[1])) return json({ error: 'This sentence is not part of a grammar exercise.' }, 404);
      if (!spoken && (!word || !store.word(word[1]))) return json({ error: 'This word is not in the vocabulary deck.' }, 404);
      const file = Bun.file(spoken ? join(root, 'audio/grammar', `${spoken[1]}.mp3`) : join(root, 'audio', `${word![1]}.mp3`));
      if (!await file.exists()) {
        // Grammar sentences are rendered clip by clip: a missing one is simply not offered yet.
        return spoken
          ? json({ error: 'This spoken sentence has not been recorded yet.' }, 404)
          : json({ error: 'This French recording is not ready. Please try again shortly.' }, 503);
      }
      return audioFile(req, file);
    }
    const name = path === '/' ? 'index.html' : path.slice(1);
    if (Object.hasOwn(staticFiles, name) && (req.method === 'GET' || req.method === 'HEAD')) {
      const file = Bun.file(join(root, 'static', name));
      if (name === 'index.html' && (roomsOff.length || learnerName) && await file.exists()) {
        const marks = `${roomsOff.length ? ` data-rooms-off="${roomsOff.join(',')}"` : ''}${learnerName ? ` data-learner="${attribute(learnerName)}"` : ''}`;
        const page = (await file.text()).replace('<body>', `<body${marks}>`);
        return new Response(req.method === 'HEAD' ? null : page, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' } });
      }
      if (await file.exists()) return staticFile(req, file);
    }
    return json({ error: 'This Echo page or action does not exist.' }, 404);
  } catch (error) {
    if (error instanceof StoreError) return json({ error: error.message }, error.status);
    console.error(error);
    return json({ error: 'Echo could not finish this request. Please try again; saved answers will not be counted twice.' }, 500);
  }
}

function backup() {
  if (process.env.ECHO_DB) return;
  snapshot(dbPath, join(root, 'backup'));
}
try { backup(); } catch (error) { console.error('Echo backup failed', error); }
const backups = setInterval(() => { try { backup(); } catch (error) { console.error('Echo backup failed', error); } }, 60 * 60 * 1000);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(backups);
  clearInterval(textChecks);
  clearInterval(hookChecks);
  clearInterval(verbChecks);
  clearInterval(storyChecks);
  clearInterval(radioChecks);
  clearInterval(whisperSweep);
  whisper.stop();
  await server.stop(true);
  comprehension.close();
  story.close();
  sounds.close();
  verbs.close();
  grammar.close();
  store.close();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
console.log(`Echo ready at http://127.0.0.1:${port}/echo/ (${words.length} words, ${bank.sentences.length} sentences)`);
