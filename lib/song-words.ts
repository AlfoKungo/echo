// Turning a song's lyrics into dictionary-form vocabulary. Lyrics only pass through here: nothing in this module
// keeps them, and a candidate carries single word forms, never lines.
import type { Word } from '../contract';

export type WordFacts = {
  kind: 'word' | 'name' | 'sound' | 'foreign';
  pos: 'noun' | 'verb' | 'adjective' | 'adverb' | 'pronoun' | 'article' | 'preposition' | 'conjunction' | 'number' | 'expression';
  base: string;
  gender: 'masculine' | 'feminine' | 'none';
  pluralOnly: boolean;
  // Whether the singular article elides before the noun (l'eau, l'homme); false for h aspiré (la hauteur).
  elision: boolean;
  feminine: string;
  en: string;
};
// One distinct word form of the song, with up to three of its lines for the model and whether it was
// capitalised mid-line (a hint of a name, which songs also use for emphasis).
export type LyricForm = { form: string; lines: string[]; capitalised: boolean };
// A word to offer: fr is the dictionary form in the deck's style; existing names the deck word it already is.
// little: every form is one of the little words below (le, de, pas…); those start unticked in the review.
export type SongCandidate = { fr: string; en: string; note: string; pos: string; forms: string[]; existing: string | null; little?: boolean };
export type SongSkip = { form: string; reason: string };

const LETTERS = "a-zA-ZÀ-ÖØ-öø-ÿœŒæÆ";
const WORD = new RegExp(`[${LETTERS}]+(?:-[${LETTERS}]+)*'?`, 'g');
const ELIDED = /^(qu|[ljdcsmnt])'(.+)$/i;

export function lyricForms(lyrics: string): LyricForm[] {
  const forms = new Map<string, LyricForm>();
  for (const raw of lyrics.split(/\r?\n/)) {
    const line = raw.trim().replace(/[’‘`]/g, "'");
    if (!line || /^\[.*\]$/.test(line)) continue;
    const parts: string[] = [];
    for (const match of line.match(WORD) ?? []) {
      const elided = ELIDED.exec(match);
      if (elided) parts.push(`${elided[1]}'`, elided[2]); else parts.push(match);
    }
    parts.forEach((part, index) => {
      const form = part.toLowerCase();
      const entry = forms.get(form) ?? { form, lines: [], capitalised: false };
      if (entry.lines.length < 3 && !entry.lines.includes(line)) entry.lines.push(line);
      if (index > 0 && part[0] !== part[0].toLowerCase()) entry.capitalised = true;
      forms.set(form, entry);
    });
  }
  return [...forms.values()].sort((a, b) => a.form.localeCompare(b.form, 'fr'));
}

// Little words have one dictionary form whatever the song: answered here, never asked of the model.
const LITTLE: Record<string, [string, string, string]> = {};
const little = (forms: string, fr: string, en: string, pos: string) => { for (const form of forms.split(' ')) LITTLE[form] = [fr, en, pos]; };
little("le l'", 'le', 'the (masculine)', 'article');
little('la', 'la', 'the (feminine)', 'article');
little('les', 'les', 'the (plural)', 'article');
little('un', 'un', 'a; an (masculine)', 'article');
little('une', 'une', 'a; an (feminine)', 'article');
little('des', 'des', 'some (plural)', 'article');
little('du', 'du', 'some; of the (masculine)', 'article');
little('au', 'au', 'to the; at the (masculine)', 'preposition');
little('aux', 'aux', 'to the; at the (plural)', 'preposition');
little("de d'", 'de', 'of; from', 'preposition');
little('à', 'à', 'to; at', 'preposition');
little('dans', 'dans', 'in', 'preposition');
little('sur', 'sur', 'on', 'preposition');
little('sous', 'sous', 'under', 'preposition');
little('chez', 'chez', "at the home of; at", 'preposition');
little('avec', 'avec', 'with', 'preposition');
little('sans', 'sans', 'without', 'preposition');
little('pour', 'pour', 'for', 'preposition');
little('par', 'par', 'by; through', 'preposition');
little('vers', 'vers', 'towards', 'preposition');
little('en', 'en', 'in; to (a place); of it', 'preposition');
little('plus', 'plus', 'more; no longer (ne… plus)', 'adverb');
little('et', 'et', 'and', 'conjunction');
little('ou', 'ou', 'or', 'conjunction');
little('mais', 'mais', 'but', 'conjunction');
little('si', 'si', 'if; so', 'conjunction');
little("que qu'", 'que', 'that; than', 'conjunction');
little('qui', 'qui', 'who; which', 'pronoun');
little("ne n'", 'ne', 'not (with pas)', 'adverb');
little('pas', 'pas', 'not', 'adverb');
little("je j'", 'je', 'I', 'pronoun');
little('tu', 'tu', 'you (informal)', 'pronoun');
little("te t'", 'te', 'you (informal, as object)', 'pronoun');
little("me m'", 'me', 'me', 'pronoun');
little('moi', 'moi', 'me', 'pronoun');
little('toi', 'toi', 'you (informal)', 'pronoun');
little("se s'", 'se', 'oneself; himself; herself', 'pronoun');
little('il', 'il', 'he; it', 'pronoun');
little('elle', 'elle', 'she; it', 'pronoun');
little('on', 'on', 'one; we', 'pronoun');
little('nous', 'nous', 'we; us', 'pronoun');
little('vous', 'vous', 'you (formal or plural)', 'pronoun');
little('ils', 'ils', 'they (masculine)', 'pronoun');
little('elles', 'elles', 'they (feminine)', 'pronoun');
little("ce c' cet cette ces", 'ce', 'this; that', 'pronoun');
little('y', 'y', 'there', 'pronoun');
little('mon ma mes', 'mon', 'my', 'determiner');
little('ton ta tes', 'ton', 'your (informal)', 'determiner');
little('son sa ses', 'son', 'his; her; its', 'determiner');
little('notre nos', 'notre', 'our', 'determiner');
little('votre vos', 'votre', 'your (formal or plural)', 'determiner');
little('leur leurs', 'leur', 'their', 'determiner');

export function littleWord(form: string): { fr: string; en: string; pos: string } | null {
  const found = LITTLE[form];
  return found ? { fr: found[0], en: found[1], pos: found[2] } : null;
}

const FACT_RULES = `kind: "word" for any ordinary French word, little words and elided forms included; "name" for a proper noun: a place, a person, or a people or nationality written with a capital (les Sikhs, les Blacks, les Jaunes); "sound" for interjections (oh, ah); "foreign" for non-French words.
pos: one of noun, verb, adjective, adverb, pronoun, article, preposition, conjunction, number, expression. A verb in the imperative (a command) is "verb". A past participle used as an adjective is "adjective". A word that only makes sense inside a fixed expression here (au-dessus de, il y a) is "expression".
base: the dictionary headword, with no article: nouns in the singular (unless the noun only exists in the plural), adjectives in the masculine singular even when the song uses the feminine or plural (fatales -> fatal), verbs in the infinitive (an imperative too: voyage ! -> voyager; with "se " or "s'" for a reflexive use). For an expression, the whole expression.
gender: for nouns, "masculine" or "feminine" (of the headword); "none" for everything else.
pluralOnly: true only for nouns that have no singular, like les vacances or les gens.
elision: for nouns, true when the singular article is written l' before it (l'eau, l'homme), false otherwise, including h aspiré words (la hauteur, le héros); false for everything else.
feminine: for adjectives, the feminine singular form, always filled in (vieux -> vieille, jaune -> jaune); empty for everything else.
en: a short English meaning of the headword in the sense the song uses: "to fly" for verbs, "wing" for nouns (singular, no article), "yellow" for adjectives, "eternally" for adverbs. Two senses separated by "; " at most.`;

// One request for a whole song: the model sees every line, so each form is read in its real context.
export function songPrompt(lyrics: string, forms: LyricForm[]): string {
  return `You help build French flashcards for an English speaker. Below are a French song's lyrics, then some word forms that appear in it. For EACH form, give these facts about the word as it is used in this song:
${FACT_RULES}

Reply with one JSON object and nothing else: its keys are the forms exactly as listed, each value an object with the keys kind, pos, base, gender, pluralOnly, elision, feminine, en.

LYRICS:
${lyrics}

FORMS:
${forms.map((entry) => entry.form + (entry.capitalised ? ' (capitalised mid-line)' : '')).join('\n')}`;
}

const KINDS: readonly WordFacts['kind'][] = ['word', 'name', 'sound', 'foreign'];
const PARTS: readonly WordFacts['pos'][] = ['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'article', 'preposition', 'conjunction', 'number', 'expression'];
const isKind = (value: unknown): value is WordFacts['kind'] => KINDS.some((kind) => kind === value);
const isPart = (value: unknown): value is WordFacts['pos'] => PARTS.some((part) => part === value);
const fields = (value: unknown): Map<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? new Map(Object.entries(value)) : null);

// The facts the model gave for each form; a form whose answer is missing or malformed is left out of the map.
export function parseFacts(reply: string, forms: LyricForm[]): Map<string, WordFacts> {
  let parsed: unknown;
  try { parsed = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)); } catch { return new Map(); }
  const answers = new Map<string, WordFacts>();
  const byForm = fields(parsed);
  if (!byForm) return answers;
  for (const { form } of forms) {
    const facts = fields(byForm.get(form));
    if (!facts) continue;
    const kind = facts.get('kind'), pos = facts.get('pos'), base = facts.get('base'), en = facts.get('en');
    const gender = facts.get('gender'), feminine = facts.get('feminine');
    if (!isKind(kind) || typeof base !== 'string' || typeof en !== 'string') continue;
    answers.set(form, {
      kind, pos: isPart(pos) ? pos : 'expression', base, en,
      gender: gender === 'masculine' || gender === 'feminine' ? gender : 'none',
      pluralOnly: facts.get('pluralOnly') === true, elision: facts.get('elision') === true,
      feminine: typeof feminine === 'string' ? feminine : '',
    });
  }
  return answers;
}

const STARTS_WITH_VOWEL = /^[aeiouyàâäéèêëîïôöùûüœæ]/i;
// English plural -> singular for the common endings, used only when the French headword is singular.
function singularEnglish(en: string): string {
  return en.split('; ').map((sense) => {
    if (/\s/.test(sense) || /(ss|us|is)$/i.test(sense)) return sense;
    if (/ies$/i.test(sense)) return sense.replace(/ies$/i, 'y');
    if (/(sh|ch|x|s)es$/i.test(sense)) return sense.replace(/es$/i, '');
    return sense.replace(/s$/i, '');
  }).join('; ');
}
const SKIP_REASON = { name: 'a name', sound: 'a sound, not a word', foreign: 'not French' } as const;

// The model answers facts; the deck's spelling of the entry is built here, so the format cannot drift.
export function candidateFrom(form: string, facts: WordFacts): Omit<SongCandidate, 'forms' | 'existing'> | SongSkip {
  if (facts.kind !== 'word') return { form, reason: SKIP_REASON[facts.kind] ?? 'a name' };
  const base = facts.base.trim().toLowerCase().replace(/\s+/g, ' ');
  let en = facts.en.trim().replace(/^(the|a|an) /i, '').replace(/\s*\/\s*/g, '; ');
  if (!base || !en) return { form, reason: 'no clear meaning' };
  if (facts.pos === 'verb' && !/^to /i.test(en)) en = en.split('; ').map((sense) => (/^to /i.test(sense) ? sense : `to ${sense}`)).join('; ');
  if (facts.pos === 'noun') {
    const feminine = facts.gender === 'feminine';
    // A noun that only exists in the plural ends in -s or -x (les gens, les vacances); anything else has a singular.
    if (facts.pluralOnly && /[sx]$/.test(base)) return { fr: `les ${base}`, en, note: feminine ? 'Feminine plural.' : 'Masculine plural.', pos: 'noun' };
    en = singularEnglish(en);
    if (STARTS_WITH_VOWEL.test(base) || (base.startsWith('h') && facts.elision)) return { fr: `l'${base}`, en, note: feminine ? 'Feminine.' : 'Masculine.', pos: 'noun' };
    return { fr: `${feminine ? 'la' : 'le'} ${base}`, en, note: '', pos: 'noun' };
  }
  const feminine = facts.feminine.trim().toLowerCase();
  const note = facts.pos === 'adjective' && feminine && feminine !== base ? `Feminine: ${feminine}.` : '';
  return { fr: base, en, note, pos: facts.pos };
}

const comparable = (fr: string) => fr.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();

// Merges forms that share a dictionary form, and marks the ones already in the deck.
export function mergeCandidates(found: { form: string; entry: Omit<SongCandidate, 'forms' | 'existing'> }[], deck: Word[]): SongCandidate[] {
  const known = new Map(deck.map((word) => [comparable(word.fr), word.id]));
  const merged = new Map<string, SongCandidate>();
  for (const { form, entry } of found) {
    const key = comparable(entry.fr);
    const current = merged.get(key);
    if (current) { if (!current.forms.includes(form)) current.forms.push(form); continue; }
    merged.set(key, { ...entry, forms: [form], existing: known.get(key) ?? null });
  }
  return [...merged.values()].sort((a, b) => a.fr.replace(/^(le |la |les |l')/, '').localeCompare(b.fr.replace(/^(le |la |les |l')/, ''), 'fr'));
}

// A song found on LRCLIB. Covers that sing the same words collapse into one match with the most common
// artist; versions counts them. Lyrics stay on the server.
export type LrclibTrack = { id: number; trackName: string; artistName: string; albumName?: string | null; duration?: number | null; instrumental?: boolean; plainLyrics?: string | null };
export type SongMatch = { id: number; title: string; artist: string; album: string; seconds: number; versions: number; artists: string[] };

export function groupMatches(tracks: LrclibTrack[]): SongMatch[] {
  const sung = tracks.filter((track) => !track.instrumental && track.plainLyrics?.trim());
  const artistName = (track: LrclibTrack) => track.artistName.replace(/\s+-\s+Topic$/i, '').trim();
  const plain = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Two uploads are one song when they sing the same lyrics (covers) or share title and artist (re-uploads
  // whose lyrics differ by a line break or a typo). Union-find joins both kinds of link.
  const parent = sung.map((_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index])));
  const first = new Map<string, number>();
  sung.forEach((track, index) => {
    for (const key of [`lyrics:${plain(track.plainLyrics!)}`, `name:${plain(track.trackName)}:${plain(artistName(track))}`]) {
      const seen = first.get(key);
      if (seen === undefined) first.set(key, index); else parent[root(index)] = root(seen);
    }
  });
  const groups = new Map<number, LrclibTrack[]>();
  sung.forEach((track, index) => groups.set(root(index), [...(groups.get(root(index)) ?? []), track]));
  return [...groups.values()].map((group) => {
    const tally = new Map<string, number>();
    for (const track of group) tally.set(artistName(track).toLowerCase(), (tally.get(artistName(track).toLowerCase()) ?? 0) + 1);
    const [top] = [...tally].sort((a, b) => b[1] - a[1]);
    // The artist's upload of typical length stands for the group: extended mixes and fragments sit at the ends.
    const theirs = group.filter((track) => artistName(track).toLowerCase() === top[0]).sort((a, b) => (a.duration ?? 0) - (b.duration ?? 0));
    const pick = theirs[Math.floor((theirs.length - 1) / 2)];
    const artists = [...new Set(group.map(artistName).map((name) => name))].filter((name, index, all) => all.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === index);
    return { id: pick.id, title: pick.trackName, artist: artistName(pick), album: pick.albumName ?? '', seconds: Math.round(pick.duration ?? 0), versions: group.length, artists };
  }).sort((a, b) => b.versions - a.versions);
}

export function songCategory(title: string, taken: Set<string>): string {
  const slug = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'song';
  let category = `song-${slug}`;
  for (let n = 2; taken.has(category); n++) category = `song-${slug}-${n}`;
  return category;
}
