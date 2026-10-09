// The language an Echo process teaches, chosen by ECHO_LANG (French when unset). Each language is its own Echo
// process with its own database and data folder; the owner's French Echo starts the others and passes /echo/<code>/
// on to them (lib/languages.ts). Everything a process needs to know about its language lives here, so French reads
// exactly as it did before there were other languages.
import { homedir } from 'node:os';
import { join } from 'node:path';

export type LanguageCode = 'fr' | 'pt' | 'sv';

// Every room the app can leave out; the server sends the ones that are off to the page (data-rooms-off) and the app
// hides them. A language has only the rooms it has content for, so the app never shows French material under another.
export const ROOMS = [
  'practise', 'words', 'walkman', 'grammar', 'verbs', 'listen', 'read', 'story', 'radio', 'songs', 'mistakes', 'statistics',
  'friends', 'say', 'write', 'news', 'changeit', 'sentencecards', 'earsentences',
] as const;
export type Room = (typeof ROOMS)[number];

export type Language = {
  code: LanguageCode;
  // The language's name in English (page titles, logs) and in itself (the language switch).
  english: string;
  own: string;
  // Where its deck and other content live, and where its recordings are kept. Echo's word shape calls the learnt
  // text `fr` in every language; a deck file outside French carries it under the language's code instead (the key
  // its recorder reads), and the server copies it across on loading.
  content: string;
  audio: string;
  textKey: LanguageCode;
  // The recorder for a word: the script, then the arguments that pick this language, before --ids and --extra-words.
  tts: { script: string; args: string[] };
  rooms: readonly Room[];
  // Claude writes French content (texts, stories, verb tables, hooks); a language without it asks Claude nothing.
  claude: boolean;
  // Port and data folder of the process the French Echo starts for this language (unused for French itself).
  port: number;
};

export const LANGUAGE_CODES: readonly LanguageCode[] = ['fr', 'pt', 'sv'];

export function languages(root: string, env: Record<string, string | undefined> = process.env): Record<LanguageCode, Language> {
  // ECHO_LANGUAGE_PORTS (pt:7885,sv:7886) moves the language processes, so a test Echo never meets the real ones.
  const ports = Object.fromEntries((env.ECHO_LANGUAGE_PORTS ?? '').split(',').map((entry) => entry.split(':')).filter(([, port]) => Number(port) > 0).map(([code, port]) => [code, Number(port)]));
  // Words and Statistics only until each language's content is written; Statistics reads only its own database.
  const firstRooms: readonly Room[] = ['words', 'statistics'];
  return {
    fr: {
      code: 'fr', english: 'French', own: 'Français',
      content: join(root, 'content'), audio: join(root, 'audio'), textKey: 'fr',
      tts: { script: 'scripts/render-audio.py', args: [] },
      rooms: ROOMS, claude: true, port: 7792,
    },
    // Brazilian Portuguese, in the French voice: Chatterbox told to speak Portuguese (render-audio.py --lang pt).
    pt: {
      code: 'pt', english: 'Portuguese', own: 'Português',
      content: join(root, 'content/pt'), audio: join(root, 'audio/pt'), textKey: 'pt',
      tts: { script: 'scripts/render-audio.py', args: ['--lang', 'pt'] },
      rooms: firstRooms, claude: false, port: ports.pt ?? 7795,
    },
    // Swedish: Higgs TTS 3 checked by KB-Whisper (render-audio-sv.py), which writes audio/sv by default.
    sv: {
      code: 'sv', english: 'Swedish', own: 'Svenska',
      content: join(root, 'content/sv'), audio: join(root, 'audio/sv'), textKey: 'sv',
      tts: { script: 'scripts/render-audio-sv.py', args: [] },
      rooms: firstRooms, claude: false, port: ports.sv ?? 7796,
    },
  };
}

export function currentLanguage(root: string, env: Record<string, string | undefined> = process.env): Language {
  const code = env.ECHO_LANG ?? 'fr';
  if (!(LANGUAGE_CODES as readonly string[]).includes(code)) throw new Error(`ECHO_LANG must be one of ${LANGUAGE_CODES.join(', ')}; it is ${code}.`);
  return languages(root, env)[code as LanguageCode];
}

// Each language process keeps its database, log and backups in <ECHO_LANGUAGES_DATA>/<code>/, out of the French
// data/ folder, so no language can touch French progress.
export const languagesData = (env: Record<string, string | undefined> = process.env) => env.ECHO_LANGUAGES_DATA ?? join(homedir(), 'echo-langs-data');
