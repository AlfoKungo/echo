// The language an Echo process teaches, chosen by ECHO_LANG (French when unset). Each language is its own Echo
// process with its own database and data folder; the owner's French Echo starts the others and passes /echo/<code>/
// on to them (lib/languages.ts). Everything a process needs to know about its language lives here, so French reads
// exactly as it did before there were other languages.
import { homedir } from 'node:os';
import { join } from 'node:path';

export type LanguageCode = 'fr' | 'pt' | 'sv';

// Every room the app can leave out; the server sends the ones that are off to the page (data-rooms-off) and the app
// hides them. A language has only the rooms it has content for, so the app never shows French material under another.
// sounds and sentencetape are Listen's Sounds and Tape tabs, which play French-only recordings.
export const ROOMS = [
  'practise', 'words', 'walkman', 'grammar', 'verbs', 'listen', 'read', 'story', 'radio', 'songs', 'mistakes', 'statistics',
  'friends', 'say', 'write', 'news', 'changeit', 'sentencecards', 'earsentences', 'families', 'sounds', 'sentencetape',
] as const;
export type Room = (typeof ROOMS)[number];

// A noun's grammatical class: masculine or feminine in French and Portuguese, common (en) or neuter (ett) in Swedish.
export type Gender = 'masculine' | 'feminine' | 'common' | 'neuter';
// How a deck's spelling shows a noun's gender (lib/store.ts genderOf). Only an article followed by a word counts, so a
// bare article in the deck (Portuguese um, Swedish ett: "one") has none.
export type GenderRules = {
  articles: Record<string, Gender>;
  // Words the article does not decide (French l’, les, des; a Swedish noun written bare) take the gender their note
  // opens with ("Feminine noun.", "Ett-word: vattnet."); a note naming two ("Masculine or feminine…") names none.
  noteWhen?: RegExp;
  notes?: Record<string, Gender>;
  // Entries written like article + noun that are not nouns: Portuguese a gente (we) and o que (what).
  notNouns?: readonly string[];
};
export const GENDER_RULES: Record<LanguageCode, GenderRules> = {
  fr: {
    articles: { le: 'masculine', un: 'masculine', la: 'feminine', une: 'feminine' },
    noteWhen: /^(l['’]|les\s|des\s)/, notes: { masculine: 'masculine', feminine: 'feminine' },
  },
  // Every Portuguese noun in the deck carries its article, plural-only ones too (os óculos, as férias).
  pt: {
    articles: { o: 'masculine', os: 'masculine', um: 'masculine', uns: 'masculine', a: 'feminine', as: 'feminine', uma: 'feminine', umas: 'feminine' },
    notNouns: ['a gente', 'o que'],
  },
  // A plural-only Swedish noun ("Plural only: pengarna") shows no en or ett, so it has no gender.
  sv: {
    articles: { en: 'common', ett: 'neuter' },
    noteWhen: /^/, notes: { 'en-word': 'common', 'ett-word': 'neuter' },
  },
};

export type Language = {
  code: LanguageCode;
  // The language's name in English (page titles, logs) and in itself (the language switch), and its BCP-47 tag, which
  // marks the learnt text on the page (lang="pt-BR").
  english: string;
  own: string;
  tag: string;
  gender: GenderRules;
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
      code: 'fr', english: 'French', own: 'Français', tag: 'fr', gender: GENDER_RULES.fr,
      content: join(root, 'content'), audio: join(root, 'audio'), textKey: 'fr',
      tts: { script: 'scripts/render-audio.py', args: [] },
      rooms: ROOMS, claude: true, port: 7792,
    },
    // Brazilian Portuguese, in the French voice: Chatterbox told to speak Portuguese (render-audio.py --lang pt).
    pt: {
      code: 'pt', english: 'Portuguese', own: 'Português', tag: 'pt-BR', gender: GENDER_RULES.pt,
      content: join(root, 'content/pt'), audio: join(root, 'audio/pt'), textKey: 'pt',
      tts: { script: 'scripts/render-audio.py', args: ['--lang', 'pt'] },
      rooms: [...firstRooms, 'listen', 'read'], claude: false, port: ports.pt ?? 7795,
    },
    // Swedish: Higgs TTS 3 checked by KB-Whisper (render-audio-sv.py), which writes audio/sv by default.
    sv: {
      code: 'sv', english: 'Swedish', own: 'Svenska', tag: 'sv', gender: GENDER_RULES.sv,
      content: join(root, 'content/sv'), audio: join(root, 'audio/sv'), textKey: 'sv',
      tts: { script: 'scripts/render-audio-sv.py', args: [] },
      rooms: [...firstRooms, 'listen', 'read'], claude: false, port: ports.sv ?? 7796,
    },
  };
}

export function currentLanguage(root: string, env: Record<string, string | undefined> = process.env): Language {
  const code = env.ECHO_LANG ?? 'fr';
  if (!(LANGUAGE_CODES as readonly string[]).includes(code)) throw new Error(`ECHO_LANG must be one of ${LANGUAGE_CODES.join(', ')}; it is ${code}.`);
  return languages(root, env)[code as LanguageCode];
}

// What each noun colour is, in How it works; static/app.css colours the classes the same way.
const GENDER_COLOURS: Record<Gender, string> = {
  masculine: 'blue for masculine', feminine: 'pink for feminine', common: 'green for en-words', neuter: 'orange for ett-words',
};

// The page (static/index.html) for a language other than French: its title and the How it works passages every
// language shares name the language; what its noun colours mean replaces French's colours and hooks (hooks come from
// Claude, which only French asks); and what it says about Word families, Sounds and the sentence tape is marked as
// that room, so the app drops it where the room is off. Listen and Read hold A1 and A2 outside French.
// French's page is served as written. A passage missing from the page throws, so the page cannot drift from this list
// unnoticed (tests/language.test.ts).
export function languagePage(page: string, language: Language): string {
  if (language.code === 'fr') return page;
  const name = language.english;
  const colours = [...new Set(Object.values(language.gender.articles))].map((gender) => GENDER_COLOURS[gender]).join(', ');
  const swaps: [string | RegExp, (found: string) => string][] = [
    ['French practice', () => `${name} practice`],
    ['practise French', () => `practise ${name}`],
    ['<p><strong>Word families</strong>', () => '<p data-room="families"><strong>Word families</strong>'],
    ['with Word families, Word building and More for today', () => 'with <span data-room="families">Word families, Word building and </span>More for today'],
    [/<p><strong>Read · Listen<[^]*?<\/p>/, (found) => found.replaceAll('French', name)],
    [/<p><strong>Colours and hooks\.<\/strong>[^]*?<\/p>/, () => `<p><strong>Colours.</strong> Nouns are coloured by gender — ${colours} — wherever Echo shows ${name} (switch it off in Words options, •••).</p>`],
    ['plays French and asks what you understood, trains your ear on twin sounds, and has a sentence tape', () => `plays ${name} and asks what you understood<span data-room="sounds">, trains your ear on twin sounds</span><span data-room="sentencetape">, and has a sentence tape</span>`],
    ['<strong>Read</strong> shows French and asks the same', () => `<strong>Read</strong> shows ${name} and asks the same`],
    [/<div data-info="listen read">[^]*?<\/div>/, (found) => found.replaceAll('French', name).replace('A1 towards B1', 'A1 and A2').replace('A1 · A2 · B1 label', 'A1 · A2 label')],
    [/<p><strong>In Listen<\/strong>[^]*?<\/p>/, (found) => found.replaceAll('French', name)],
    ['<p><strong>Sounds</strong>', () => '<p data-room="sounds"><strong>Sounds</strong>'],
    ['<p><strong>Tape</strong> (in Listen', () => '<p data-room="sentencetape"><strong>Tape</strong> (in Listen'],
  ];
  for (const [passage, swap] of swaps) {
    const found = typeof passage === 'string' ? (page.includes(passage) ? passage : null) : passage.exec(page)?.[0] ?? null;
    if (found === null) throw new Error(`static/index.html no longer has the passage ${passage} that the ${name} page rewrites.`);
    page = page.replace(found, () => swap(found));
  }
  return page;
}

// Each language process keeps its database, log and backups in <ECHO_LANGUAGES_DATA>/<code>/, out of the French
// data/ folder, so no language can touch French progress.
export const languagesData = (env: Record<string, string | undefined> = process.env) => env.ECHO_LANGUAGES_DATA ?? join(homedir(), 'echo-langs-data');
