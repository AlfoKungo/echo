// Radio: one episode a day, a few minutes of French to listen to anywhere. It is apart from the Walkman, which
// drills single words: the Radio puts today's words in sentences, reads the latest story episode line by line
// with its English, and explains one grammar point in English with French examples. Like a Walkman tape it is
// one MP3 joined byte for byte on the Mac (lib/walkman.ts), so it keeps playing on a locked phone.
//
// The day's script is fixed the first time it is prepared and kept in <data>/radio/<day>.json; its clips are
// made by scripts/render-radio.py into audio/radio (existing recordings converted, English and French sentences
// spoken and checked). A part whose clips could not be made is left out. The grammar segment is written once
// per topic by Claude (Opus) and kept beside the scripts.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ComprehensionSentence } from '../comprehension-contract';
import type { Ask } from './claude';
import { FRAME_BYTES, FRAME_SECONDS } from './walkman';

export type RadioClip = { id: string; kind: 'convert'; source: string } | { id: string; kind: 'en' | 'fr'; text: string };
// An optional clip (the English after a French line) is left out, with its pause, when it could not be made;
// a missing required clip leaves out the whole part.
type Step = { clip: RadioClip; optional?: true } | { pause: number };
// A part is one thing shown on screen while it plays: a word's sentence, a story line, a grammar example.
export type RadioPart = { section: 'intro' | 'words' | 'story' | 'grammar' | 'outro'; label: string; fr?: string; en?: string; steps: Step[] };
export type RadioScript = { day: string; topic: string | null; parts: RadioPart[] };
export type RadioSegment = { section: RadioPart['section']; label: string; fr?: string; en?: string; start: number; end: number };
export type RadioView = { day: string; state: 'ready' | 'preparing' | 'failed'; error: string | null; url: string | null; seconds: number; segments: RadioSegment[] };
export type GrammarSegment = { topic: string; title: string; lines: ({ en: string } | { fr: string; en: string })[] };

type Word = { id: string; fr: string; en: string; status: string; score: number };
type Episode = { id: string; number: number; titleEn: string; summary: string; lines: { fr: string; en: string }[]; focus: { topic: string; title: string } };
type Topic = { id: string; title: string; level: string; description: string; independent: number };

const WORDS = 8;
const TIMEOUT = 10 * 60_000;
const RETRY_AFTER = 30 * 60_000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);
const en = (text: string): Step => { const said = speakable(text); return { clip: { id: `en-${hash(said)}`, kind: 'en', text: said } }; };
const translation = (text: string): Step => ({ ...(en(text) as { clip: RadioClip }), optional: true });
const fr = (text: string): Step => ({ clip: frenchClip(text) });
// French said by the Radio's French voice and checked; the Verbs room's By ear phrases are made the same way.
export function frenchClip(text: string): RadioClip { return { id: `fr-${hash(text)}`, kind: 'fr', text }; }
// English said by the Walkman's English voice and checked, the same clip the Radio would make for the text.
export function englishClip(text: string): RadioClip { return (en(text) as { clip: RadioClip }).clip; }
const recording = (source: string): Step => ({ clip: { id: `cv-${hash(source)}`, kind: 'convert', source } });
// A Listen/Read sentence as the Radio and the Walkman's sentence tape both play it: its recording converted to
// the Walkman format, and its English said and checked. One source of the clip ids, so both share one recording.
export function sentenceClips(sentence: { id: string; en: string }): { fr: RadioClip; en: RadioClip } {
  return { fr: (recording(`audio/comprehension/${sentence.id}.mp3`) as { clip: RadioClip }).clip, en: (en(sentence.en) as { clip: RadioClip }).clip };
}
// A story line as the Radio and the Story page's tape both play it: its recording converted, and its English.
export function storyLineClips(episodeId: string, index: number, english: string): { fr: RadioClip; en: RadioClip } {
  return { fr: (recording(`audio/story/${episodeId}-${index + 1}.mp3`) as { clip: RadioClip }).clip, en: (en(english) as { clip: RadioClip }).clip };
}
// The Story page's tape: every line in French, or each line in French and then its English. Recordings end on
// about half a second of their own silence, so the French-only gap is short. A line whose English could not be
// made plays in French only.
export type StoryTapeMode = 'fr' | 'both';
export type StoryTapeLine = { start: number; enAt: number | null; end: number };
const STORY_TIMING = { fr: { meaning: 0, between: 0.25 }, both: { meaning: 0.5, between: 0.9 } } as const;
export function layStory(lines: { fr: Uint8Array | null; en: Uint8Array | null }[], mode: StoryTapeMode, silence: Uint8Array): { bytes: Uint8Array<ArrayBuffer>; seconds: number; lines: StoryTapeLine[] } | null {
  if (!lines.length || lines.some((line) => !line.fr)) return null;
  const chunks: Uint8Array[] = [];
  let frames = 0;
  const add = (bytes: Uint8Array) => { chunks.push(bytes); frames += bytes.length / FRAME_BYTES; };
  const pause = (seconds: number) => {
    const count = Math.round(seconds / FRAME_SECONDS);
    const block = new Uint8Array(count * FRAME_BYTES);
    for (let frame = 0; frame < count; frame++) block.set(silence.subarray(0, FRAME_BYTES), frame * FRAME_BYTES);
    add(block);
  };
  const time = () => Math.round(frames * FRAME_SECONDS * 1000) / 1000;
  const timing = STORY_TIMING[mode];
  const laid = lines.map((line, index) => {
    const start = time();
    add(line.fr!);
    let enAt: number | null = null;
    if (mode === 'both' && line.en) { pause(timing.meaning); enAt = time(); add(line.en); }
    const end = time();
    if (index + 1 < lines.length) pause(timing.between);
    return { start, enAt, end };
  });
  const bytes = new Uint8Array(frames * FRAME_BYTES);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { bytes, seconds: time(), lines: laid };
}
// A made clip's bytes, or null while it is missing or not whole Walkman frames.
// Whether a clip has been made, without reading it: cheap enough to ask for thousands of clips at once.
export function radioClipExists(root: string, id: string): boolean {
  return existsSync(join(root, 'audio', 'radio', `${id}.mp3`));
}
export function radioClip(root: string, id: string): Uint8Array | null {
  const path = join(root, 'audio', 'radio', `${id}.mp3`);
  if (!existsSync(path)) return null;
  const data = new Uint8Array(readFileSync(path));
  return data.length && data.length % FRAME_BYTES === 0 && data[0] === 0xff && data[1] === 0xf3 ? data : null;
}
const pause = (seconds: number): Step => ({ pause: seconds });
// The grammar segment's English is said by an English voice, so it must quote no French: no accented letters,
// no French apostrophe or quotation, no common French word that is not also English. Elsewhere English only
// names people and places, said plainly without their accents.
const FRENCH_IN_ENGLISH = /[àâäçéèêëîïôöùûüÿœæ’«»“”"]|\b(je|tu|il|elle|nous|vous|ils|elles|le|les|une|des|du|est|sont|suis|avons|avez|avoir|mon|mes|ta|tes|cette|ces|qui|que|avec|pour|dans|oui)\b/i;
const speakable = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/’/g, "'").replace(/[«»]/g, '"').replace(/œ/g, 'oe');

// The study day, from 04:00 local time (new words arrive then), as YYYY-MM-DD.
export function radioDay(at: Date): string {
  const shifted = new Date(at.getTime() - 4 * 3_600_000);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
}

export function grammarProblems(segment: GrammarSegment): string[] {
  const problems: string[] = [];
  const explanations = segment.lines.filter((line) => !('fr' in line)).length;
  const examples = segment.lines.length - explanations;
  if (explanations < 3 || explanations > 6) problems.push('write 3 to 6 English explanation lines.');
  if (examples < 3 || examples > 6) problems.push('give 3 to 6 French examples.');
  segment.lines.forEach((line, index) => {
    if (typeof line.en !== 'string' || !line.en.trim() || line.en.length > 220) problems.push(`line ${index + 1}: "en" must be one or two short English sentences.`);
    else if (FRENCH_IN_ENGLISH.test(line.en)) problems.push(`line ${index + 1}: the English is read by an English voice, so it cannot quote French ("${line.en.slice(0, 60)}"). Put French only in an example.`);
    if ('fr' in line) {
      if (typeof line.fr !== 'string' || !line.fr.trim()) problems.push(`line ${index + 1}: an example needs its French.`);
      else {
        if (line.fr.includes("'")) problems.push(`line ${index + 1}: write French with ’.`);
        if (!/[.!?…]$/.test(line.fr)) problems.push(`line ${index + 1}: the French must end with . ! ? or …`);
        if (line.fr.split(/\s+/).length > 12) problems.push(`line ${index + 1}: keep each example to 12 words or fewer.`);
      }
    }
  });
  return problems;
}

function grammarPrompt(topic: Topic, level: string, problems: string[] = [], previous?: unknown): string {
  return `You write one short segment of Echo Radio, a daily French listening episode for one English speaker learning French at about ${level}. This segment explains one grammar point, about 90 seconds long: "${topic.title}" (${topic.description}).

It is read aloud: English lines by an English voice, French examples by a French voice. So:
- "lines" alternate English explanation and French examples. An explanation line is {"en": "..."}: one or two short, plain English sentences, and it NEVER quotes French (no French words at all; say "the verb ends in E R" rather than writing the French). An example line is {"fr": "...", "en": "..."}: a short French sentence (12 words at most) using very common words, and its English.
- 3 to 6 explanation lines and 3 to 6 examples. Start by saying what the point is for, then show it working, then one tip for hearing it in speech.
- French uses the typographic apostrophe ’ and a space before ? ! : ;

${problems.length ? `Your last version had these problems; fix them:\n${problems.map((problem) => `- ${problem}`).join('\n')}\n${JSON.stringify(previous)}\n\n` : ''}Reply with only JSON: {"lines": [...]}`;
}

export function createRadio(options: {
  root: string; dataDir: string; ask: Ask;
  words: () => Word[]; sentences: () => ComprehensionSentence[]; episode: () => Episode | null; topics: () => Topic[]; level: () => string;
  record: (planPath: string) => Promise<unknown>; now?: () => Date;
  // Waited for before the day's script is made: the story's own check, so an episode being written is in it.
  ready?: () => Promise<unknown>;
}) {
  const now = options.now ?? (() => new Date());
  const dir = join(options.dataDir, 'radio');
  const audio = join(options.root, 'audio');
  const built = new Map<string, { bytes: Uint8Array<ArrayBuffer>; segments: RadioSegment[]; seconds: number }>();
  let busy: Promise<void> | null = null;
  let lastError: string | null = null;
  let failedAt = -Infinity;

  const read = <T>(path: string): T | null => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : null;
  const save = (path: string, value: unknown) => { mkdirSync(dir, { recursive: true }); writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 1)); renameSync(`${path}.tmp`, path); };
  const exists = (path: string) => existsSync(join(options.root, path));

  // The grammar point: the latest story episode's focus, so the two help each other; else the first topic not
  // yet made one's own. Written once per topic.
  async function grammar(): Promise<GrammarSegment | null> {
    const topics = options.topics();
    const focus = options.episode()?.focus.topic;
    const topic = topics.find((entry) => entry.id === focus) ?? topics.find((entry) => entry.independent < 5) ?? topics[0];
    if (!topic) return null;
    const path = join(dir, `grammar-${topic.id}.json`);
    const kept = read<GrammarSegment>(path);
    if (kept) return kept;
    let segment: GrammarSegment | null = null;
    let problems: string[] = [];
    for (let round = 0; round < 3; round++) {
      const reply = await options.ask(grammarPrompt(topic, options.level(), problems, segment?.lines), { timeout: TIMEOUT, purpose: 'writing the Radio grammar segment' });
      const body = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1);
      let lines: unknown[] = [];
      try { lines = (JSON.parse(body) as { lines?: unknown[] }).lines ?? []; } catch { problems = ['reply with JSON only.']; continue; }
      segment = {
        topic: topic.id, title: topic.title,
        lines: lines.map((entry) => {
          const line = entry as { fr?: unknown; en?: unknown };
          const english = typeof line.en === 'string' ? line.en.trim() : '';
          return typeof line.fr === 'string' && line.fr.trim() ? { fr: line.fr.trim().replace(/'/g, '’'), en: english } : { en: english };
        }),
      };
      problems = grammarProblems(segment);
      if (!problems.length) { save(path, segment); return segment; }
    }
    throw new Error(`the grammar segment still had problems: ${problems.slice(0, 2).join(' ')}`);
  }

  // Today's due words, each in a Listen/Read sentence already recorded, else as its Walkman word clips.
  function wordParts(): RadioPart[] {
    const rank: Record<string, number> = { learning: 0, due: 1 };
    const due = options.words().filter((word) => word.status in rank).sort((a, b) => rank[a.status]! - rank[b.status]! || a.score - b.score).slice(0, WORDS);
    const sentences = options.sentences();
    return due.flatMap((word): RadioPart[] => {
      const sentence = sentences.filter((entry) => entry.words.includes(word.id) && exists(`audio/comprehension/${entry.id}.mp3`))
        .sort((a, b) => a.fr.length - b.fr.length)[0];
      if (sentence) {
        const clip = recording(`audio/comprehension/${sentence.id}.mp3`);
        return [{ section: 'words', label: word.fr, fr: sentence.fr, en: sentence.en, steps: [clip, pause(1.5), translation(sentence.en), pause(0.8), clip, pause(1.8)] }];
      }
      if (!exists(`audio/walkman/fr/${word.id}.mp3`) || !exists(`audio/walkman/en/${word.id}.mp3`)) return [];
      const clip = recording(`audio/walkman/fr/${word.id}.mp3`);
      return [{ section: 'words', label: word.fr, fr: word.fr, en: word.en, steps: [clip, pause(1.5), recording(`audio/walkman/en/${word.id}.mp3`), pause(0.8), clip, pause(1.8)] }];
    });
  }

  function storyParts(): RadioPart[] {
    const episode = options.episode();
    if (!episode || !episode.lines.every((_, index) => exists(`audio/story/${episode.id}-${index + 1}.mp3`))) return [];
    const opening = `Now, the story. Episode ${episode.number}: ${episode.titleEn}.`;
    return [
      { section: 'story', label: `Episode ${episode.number}`, en: episode.titleEn, steps: [en(opening), pause(0.8)] },
      ...episode.lines.map((line, index): RadioPart => { const clips = storyLineClips(episode.id, index, line.en); return { section: 'story', label: `Episode ${episode.number}`, fr: line.fr, en: line.en, steps: [{ clip: clips.fr }, pause(1), { clip: clips.en, optional: true }, pause(1.4)] }; }),
    ];
  }

  async function script(day: string): Promise<RadioScript> {
    const path = join(dir, `${day}.json`);
    const kept = read<RadioScript>(path);
    if (kept) return kept;
    const words = wordParts();
    const story = storyParts();
    const point = await grammar();
    const episode = options.episode();
    const pieces = [words.length ? `${words.length} of your words` : '', story.length && episode ? `episode ${episode.number} of your story` : '', point ? `a little grammar` : ''].filter(Boolean);
    const intro = `This is Echo Radio. Today: ${pieces.length > 1 ? `${pieces.slice(0, -1).join(', ')} and ${pieces.at(-1)}` : pieces[0] ?? 'a little French'}.`;
    const parts: RadioPart[] = [
      { section: 'intro', label: 'Echo Radio', en: intro, steps: [pause(0.5), en(intro), pause(1)] },
      ...(words.length ? [{ section: 'words', label: 'Your words', en: 'First, your words.', steps: [en('First, your words. Listen to the French, then its meaning.'), pause(1)] } satisfies RadioPart, ...words] : []),
      ...story,
      ...(point ? [
        // A topic title is often unsayable in English ("-ir and -re verbs"), so it is shown, not spoken.
        { section: 'grammar', label: point.title, en: point.title, steps: [en('Now, a little grammar.'), pause(0.8)] } satisfies RadioPart,
        ...point.lines.map((line): RadioPart => 'fr' in line
          ? { section: 'grammar', label: point.title, fr: line.fr, en: line.en, steps: [fr(line.fr), pause(1.2), translation(line.en), pause(1)] }
          : { section: 'grammar', label: point.title, en: line.en, steps: [en(line.en), pause(0.6)] }),
      ] : []),
      { section: 'outro', label: 'Echo Radio', en: 'That is all for today. See you tomorrow.', steps: [pause(0.6), en('That is all for today. See you tomorrow.'), pause(1)] },
    ];
    const value: RadioScript = { day, topic: point?.topic ?? null, parts };
    save(path, value);
    return value;
  }

  const clipOf = (id: string) => radioClip(options.root, id);

  // Joins the parts whose clips were all made, with silence frames for the pauses.
  function assemble(value: RadioScript) {
    const silenceFile = join(audio, 'walkman', 'silence.mp3');
    if (!existsSync(silenceFile)) throw new Error('The Walkman silence frame is missing.');
    const silence = new Uint8Array(readFileSync(silenceFile)).subarray(0, FRAME_BYTES);
    const chunks: Uint8Array[] = [];
    const segments: RadioSegment[] = [];
    let frames = 0;
    const time = () => Math.round(frames * FRAME_SECONDS * 1000) / 1000;
    for (const part of value.parts) {
      const clips = part.steps.map((step) => 'clip' in step ? clipOf(step.clip.id) : null);
      if (part.steps.some((step, index) => 'clip' in step && !step.optional && !clips[index])) continue;
      const start = time();
      let skipPause = false;
      part.steps.forEach((step, index) => {
        if ('clip' in step) {
          if (!clips[index]) { skipPause = true; return; }
          chunks.push(clips[index]!); frames += clips[index]!.length / FRAME_BYTES; return;
        }
        if (skipPause) { skipPause = false; return; }
        const count = Math.round(step.pause / FRAME_SECONDS);
        const block = new Uint8Array(count * FRAME_BYTES);
        for (let frame = 0; frame < count; frame++) block.set(silence, frame * FRAME_BYTES);
        chunks.push(block); frames += count;
      });
      segments.push({ section: part.section, label: part.label, ...(part.fr ? { fr: part.fr } : {}), ...(part.en ? { en: part.en } : {}), start, end: time() });
    }
    const bytes = new Uint8Array(frames * FRAME_BYTES);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { bytes, segments, seconds: time() };
  }

  async function prepare(day: string): Promise<void> {
    await options.ready?.();
    const value = await script(day);
    const clips = new Map<string, RadioClip>();
    for (const part of value.parts) for (const step of part.steps) if ('clip' in step) clips.set(step.clip.id, step.clip);
    const planPath = join(dir, `${day}.plan.json`);
    save(planPath, [...clips.values()]);
    await options.record(planPath);
    const episode = assemble(value);
    if (!episode.segments.some((segment) => segment.section !== 'intro' && segment.section !== 'outro')) throw new Error('none of today’s parts could be recorded.');
    built.set(day, episode);
    for (const key of [...built.keys()].filter((key) => key !== day)) built.delete(key);
    console.log(`radio: ${day} is ready (${Math.round(episode.seconds / 60 * 10) / 10} min, ${episode.segments.length} parts of ${value.parts.length})`);
  }

  // Prepares today's episode once; a failed attempt waits half an hour before the next.
  function check(): Promise<void> {
    const day = radioDay(now());
    if (built.has(day) || busy || now().getTime() - failedAt < RETRY_AFTER) return busy ?? Promise.resolve();
    busy = prepare(day).then(() => { lastError = null; }, (error: Error) => {
      failedAt = now().getTime(); lastError = error.message; console.error(`radio: could not prepare ${day}: ${error.message}`);
    }).finally(() => { busy = null; });
    return busy;
  }

  function view(): RadioView {
    const day = radioDay(now());
    const ready = built.get(day);
    if (!ready) { void check(); return { day, state: busy ? 'preparing' : lastError ? 'failed' : 'preparing', error: lastError, url: null, seconds: 0, segments: [] }; }
    return { day, state: 'ready', error: null, url: `api/radio/${day}.mp3`, seconds: ready.seconds, segments: ready.segments };
  }

  return { check, view, audio: (day: string) => built.get(day)?.bytes ?? null };
}
export type Radio = ReturnType<typeof createRadio>;
