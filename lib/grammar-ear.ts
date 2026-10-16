// Grammar by ear (Listen → Questions): one recorded French sentence and a question in English that only its grammar
// answers — when it happens (the tense of its verb), how many people do it (il or ils, where the verb sounds
// different), or who it is done to or belongs to (lui / leur, le / la / les, son / leur). Claude (Opus) writes them
// ahead, a batch at a time, from the verbs and words the learner has started; each one is checked here before it is
// kept: its verb against conjugate(), and its answer against what can be heard (the rules below). Anything doubtful
// is dropped. An item is offered once its sentence is recorded, after every EVERY comprehension answers in Listen; one
// answered wrong comes back once, RETURN_AFTER Grammar by ear questions later. Its answers live in their own table and
// change no Listen level or comprehension score.
import { Database } from 'bun:sqlite';
import type { Ask } from './claude';
import { StoreError } from './store';
import { conjugate, subject, TENSE_NAMES, TENSES, type Tense, type Verb } from './verbs';

export type EarSentenceKind = 'when' | 'howmany' | 'who';
export type EarSlot = { kind: EarSentenceKind; tense: Tense };
export type EarKnowledge = { known: { fr: string; en: string }[]; verbs: Verb[] };
// What is kept for one item: `answer` is the index of the right choice, worked out here from what the choices stand for.
export type EarSentence = {
  kind: EarSentenceKind; fr: string; en: string; question: string; choices: string[]; answer: number; why: string;
  verbId: string; tense: Tense; person: number;
};
// check settles the question on the phone the moment it is answered, as answer() does; the saved answer's reply counts.
export type EarView = { id: string; kind: EarSentenceKind; question: string; choices: string[]; audio: string[]; again: boolean; check: { answer: number; why: string; fr: string; en: string } };
export type EarResult = { id: string; right: boolean; answer: number; chosen: number; why: string; fr: string; en: string; again: boolean };

const BATCH = 8;
const REFILL_AT = 3; // a new batch is asked for while fewer than this many wait to be answered
const EVERY = 2; // comprehension answers in Listen between two Grammar by ear questions
const RETURN_AFTER = 3; // Grammar by ear answers before a missed question comes back, once
const RETRY_AFTER = 10 * 60_000; // after a failed or empty batch

// The mix of tenses for these questions (not the Verbs tense setting): the four a listener tells apart by when things
// happen; and of kinds of question: most ask when, since the tenses are what the learner is moving on to.
export const TENSE_MIX: Partial<Record<Tense, number>> = { pc: 0.35, pres: 0.30, imp: 0.20, fut: 0.15 };
export const KIND_MIX: Record<EarSentenceKind, number> = { when: 0.5, howmany: 0.25, who: 0.25 };

function weighted<T extends string>(mix: Partial<Record<T, number>>, random: () => number): T {
  const entries = Object.entries(mix) as [T, number][];
  let left = random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [key, weight] of entries) { left -= weight; if (left < 0) return key; }
  return entries.at(-1)![0];
}
export function planSlots(count: number, random: () => number): EarSlot[] {
  return Array.from({ length: count }, () => ({ kind: weighted(KIND_MIX, random), tense: weighted(TENSE_MIX, random) }));
}

// ── Hearing ──
// The words as said, lowercased, with an elided word kept apart with its apostrophe: "J’ai pris" → j’ ai pris.
export function words(text: string): string[] {
  return text.normalize('NFC').toLowerCase().replace(/['`]/g, '’').replace(/’/g, '’ ')
    .replace(/[«»"“”.,!?;:()…\-–—]/g, ' ').split(/\s+/).filter(Boolean);
}
const fold = (word: string) => word.normalize('NFD').replace(/\p{M}/gu, '');
// A word as heard at the end of a form: its silent final consonants (t, d, s, x, p) and a final mute e dropped,
// accents and ai folded together. Folding only ever makes two forms look more alike, so a doubt drops the item.
const said = (word: string) => fold(word).replace(/[tdspx]+$/, '').replace(/(..)e$/, '$1').replace(/ai/g, 'e');
// An ils form's -ent is silent: what is left of it is heard, with its last consonant (prenn-, finiss-, aim-).
const saidPlural = (word: string) => (/ent$/.test(word) && word.length > 4 ? fold(word).slice(0, -3).replace(/ai/g, 'e') : said(word));
// Starting with a vowel: after ils or elles the s links to it with a z (ils‿ont). An h never counts, mute or not.
const VOWEL = /^[aàâäeéèêëiîïoôöuùûüœæ]/;

// Whether il and ils (elle / elles) can be told apart by ear in this tense: the forms differ once their silent
// letters are dropped (il prend / ils prennent, il a pris / ils ont pris, il ira / ils iront), or the ils form
// starts with a vowel and follows ils straight away (ils‿aiment). il mange / ils mangent, il voit / ils voient,
// il court / ils courent and il prenait / ils prenaient sound the same.
export function numberHeard(verb: Verb, tense: Tense, linked: boolean): boolean {
  const forms = conjugate(verb, tense);
  if (!forms[2] || !forms[5]) return false;
  const one = words(forms[2].accepted[0]!), more = words(forms[5].accepted[0]!);
  if (linked && VOWEL.test(more[0]!)) return true;
  if (one.length !== more.length) return true;
  return one.some((word, index) => said(word) !== saidPlural(more[index]!));
}

// A whole form with its subject, as heard, for telling tenses apart: an i or y before -ions / -iez is not heard
// (nous étudiions / étudions, payiez / payez, travaillions / travaillons, gagnions / gagnons), nor a double r
// (je courrai / je courais).
function tenseSaid(person: number, form: string): string {
  return words(subject(person, form) + form).map((word, index, all) => {
    const heard = person === 5 && index === all.length - 1 ? saidPlural(word) : said(word);
    return heard.replace(/(i|y|ill|gn)i(on|e)/g, '$1$2').replace(/rr/g, 'r');
  }).join(' ');
}
// Whether every pair of these tenses sounds different for this verb and person.
export function tensesHeardApart(verb: Verb, person: number, tenses: Tense[]): boolean {
  const heard = tenses.map((tense) => { const form = conjugate(verb, tense)[person]; return form ? tenseSaid(person, form.accepted[0]!) : null; });
  return heard.every((entry) => entry !== null) && new Set(heard).size === heard.length;
}

// ── Checking what Claude wrote ──
const flags = (list: string[]): Record<string, true> => Object.fromEntries(list.map((word) => [word, true]));
// Own keys only: a word such as "constructor" is never in a table.
const has = (table: Record<string, unknown>, word: string) => Object.hasOwn(table, word);
const PERSONS: Record<string, number> = { je: 0, 'j’': 0, tu: 1, il: 2, elle: 2, on: 2, nous: 3, vous: 4, ils: 5, elles: 5 };
// Little words that may stand between a subject and its verb.
const CLITICS = flags(['ne', 'n’', 'me', 'm’', 'te', 't’', 'se', 's’', 'le', 'la', 'l’', 'les', 'lui', 'leur', 'y', 'en', 'nous', 'vous']);
// Words that may stand between a helper and its participle (il a déjà fini, ils n’ont pas pris).
const BETWEEN = flags(['pas', 'jamais', 'plus', 'rien', 'déjà', 'bien', 'mal', 'tout', 'toujours', 'encore', 'souvent', 'beaucoup', 'trop', 'vraiment', 'enfin']);
// Time words that would answer a "when" question without the verb.
const TIME_WORDS = flags(['hier', 'demain', 'maintenant', 'bientôt', 'autrefois', 'dernier', 'dernière', 'prochain', 'prochaine', 'déjà', 'actuellement', 'aujourd’']);
const OBJECT_PRONOUNS = flags(['me', 'te', 'le', 'la', 'les', 'lui', 'nous', 'vous', 'leur']);
// Possessives by whose they say the thing is: son, sa and ses all mean one owner, man or woman.
const OWNERS: Record<string, string> = { mon: 'me', ma: 'me', mes: 'me', ton: 'you', ta: 'you', tes: 'you', son: 'one', sa: 'one', ses: 'one', notre: 'us', nos: 'us', votre: 'you all', vos: 'you all', leur: 'them', leurs: 'them' };

// Where the form starts in the sentence's words, with any one of BETWEEN allowed inside it; -1 when absent.
function findForm(sentence: string[], form: string[]): number {
  for (let start = 0; start < sentence.length; start++) {
    let at = start, ok = true;
    for (let index = 0; index < form.length; index++) {
      if (index > 0 && sentence[at] !== form[index] && has(BETWEEN, sentence[at] ?? '')) at++;
      if (sentence[at] !== form[index]) { ok = false; break; }
      at++;
    }
    if (ok) return start;
  }
  return -1;
}
// The little words just before the form, nearest last, and the word before them (the subject, usually).
function before(sentence: string[], start: number): { clitics: string[]; subject: string } {
  let at = start - 1;
  while (at >= 0 && has(CLITICS, sentence[at]!)) at--;
  return { clitics: sentence.slice(at + 1, start), subject: sentence[at] ?? '' };
}

const text = (value: unknown, max: number) => (typeof value === 'string' && value.trim().length <= max ? value.trim() : '');

// One item as Claude wrote it, checked: the sentence of it to keep, or why it is dropped.
export function checkItem(raw: unknown, verbs: Verb[]): { item: EarSentence } | { dropped: string } {
  const entry = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = entry.kind;
  const fr = text(entry.fr, 140), en = text(entry.en, 200), question = text(entry.question, 140);
  // French quotes as Echo prints them: « with a no-break space inside ».
  const why = text(entry.why, 400).replace(/«\s*/g, '«\u00a0').replace(/\s*»/g, '\u00a0»');
  if (kind !== 'when' && kind !== 'howmany' && kind !== 'who') return { dropped: `no kind of question (${String(kind)})` };
  if (!fr || !en || !question || !why) return { dropped: 'a part is missing or too long' };
  if (!why.includes('«')) return { dropped: 'the why quotes no French' };
  const choices = Array.isArray(entry.choices) ? entry.choices.map((choice) => text(choice, 60)) : [];
  const means = Array.isArray(entry.means) ? entry.means.map((value) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/'/g, '’') : '')) : [];
  if (choices.length < 2 || choices.length > 3 || choices.some((choice) => !choice) || new Set(choices).size !== choices.length) return { dropped: 'needs 2 or 3 different choices' };
  if (means.length !== choices.length || means.some((value) => !value) || new Set(means).size !== means.length) return { dropped: 'the choices do not each stand for something different' };
  const tense = TENSES.find((name) => name === entry.tense);
  if (!tense) return { dropped: `no tense (${String(entry.tense)})` };
  const personName = typeof entry.person === 'string' ? entry.person.trim().toLowerCase() : '';
  const person = has(PERSONS, personName) ? PERSONS[personName]! : -1;
  if (person < 0) return { dropped: `no person (${String(entry.person)})` };
  const sentence = words(fr);
  if (sentence.length < 3 || sentence.length > 16) return { dropped: 'too short or too long' };

  // The verb: one of the learner's, its form for this tense and person exactly as conjugate() writes it.
  const named = typeof entry.verb === 'string' ? entry.verb.normalize('NFC').toLowerCase().replace(/'/g, '’').trim() : '';
  const candidates = verbs.filter((verb) => verb.inf === named || verb.base === named);
  if (!candidates.length) return { dropped: `the verb «${named}» is not one of the learner’s` };
  let found: { verb: Verb; start: number } | null = null;
  for (const verb of candidates) {
    const form = conjugate(verb, tense)[person];
    for (const accepted of form?.accepted ?? []) {
      const start = findForm(sentence, words(accepted));
      if (start >= 0) { found = { verb, start }; break; }
    }
    if (found) break;
  }
  if (!found) {
    const expected = candidates.map((verb) => conjugate(verb, tense)[person]?.shown).filter(Boolean).join(' / ');
    return { dropped: `no «${expected || '—'}» (${named}, ${TENSE_NAMES[tense]}, ${personName}) in «${fr}»` };
  }
  const { verb, start } = found;
  const near = before(sentence, start);

  let answer = -1;
  if (kind === 'when') {
    const offered = means.flatMap((value) => TENSES.filter((name) => name === value));
    if (offered.length !== means.length) return { dropped: 'a when choice stands for no tense' };
    if (sentence.some((word) => has(TIME_WORDS, word))) return { dropped: 'a time word gives the answer away' };
    if (!tensesHeardApart(verb, person, offered)) return { dropped: `the tenses offered sound alike for ${verb.inf}` };
    answer = means.indexOf(tense);
  } else if (kind === 'howmany') {
    if (person !== 2 && person !== 5) return { dropped: 'how many needs il, elle, ils or elles' };
    if (personName === 'on' || !['il', 'elle', 'ils', 'elles'].includes(near.subject)) return { dropped: 'the verb’s subject is not il, elle, ils or elles' };
    if (PERSONS[near.subject] !== person) return { dropped: 'the subject does not match the person' };
    if (means.some((value) => value !== 'one' && value !== 'more')) return { dropped: 'a how-many choice is not one or more' };
    if (!numberHeard(verb, tense, near.clitics.length === 0)) return { dropped: `il and ils sound alike for ${verb.inf} in the ${TENSE_NAMES[tense]}` };
    answer = means.indexOf(person === 5 ? 'more' : 'one');
  } else {
    const cue = entry.cue;
    if (cue === 'pronoun') {
      if (means.some((value) => !has(OBJECT_PRONOUNS, value))) return { dropped: 'a who choice is not an object pronoun' };
      const heard = means.filter((value) => near.clitics.includes(value));
      if (heard.length !== 1) return { dropped: 'not exactly one of the pronouns offered comes before the verb' };
      // The others must not be heard anywhere else either (le, la and les may still be articles).
      if (means.some((value) => value !== heard[0] && !['le', 'la', 'les'].includes(value) && sentence.includes(value))) return { dropped: 'another pronoun offered is in the sentence' };
      answer = means.indexOf(heard[0]!);
    } else if (cue === 'possessive') {
      if (means.some((value) => !has(OWNERS, value))) return { dropped: 'a who choice is not a possessive' };
      if (new Set(means.map((value) => OWNERS[value])).size !== means.length) return { dropped: 'two choices mean the same owner (son and sa both say one owner)' };
      const owners = new Set(sentence.filter((word) => has(OWNERS, word)).map((word) => OWNERS[word]));
      const heard = means.filter((value) => owners.has(OWNERS[value]!));
      if (heard.length !== 1 || owners.size !== 1) return { dropped: 'not exactly one owner offered is heard in the sentence' };
      answer = means.indexOf(heard[0]!);
    } else return { dropped: 'a who question says neither pronoun nor possessive' };
  }
  if (answer < 0) return { dropped: 'no choice stands for the answer' };
  if (entry.answer !== answer) return { dropped: `Claude’s answer (${String(entry.answer)}) is not the one the sentence gives (${answer})` };
  return { item: { kind, fr, en, question, choices, answer, why, verbId: verb.id, tense, person } };
}

export function parseItems(reply: string, verbs: Verb[]): { items: EarSentence[]; dropped: string[] } {
  let parsed: { items?: unknown } | null = null;
  try { parsed = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)); } catch { parsed = null; }
  const items: EarSentence[] = [], dropped: string[] = [];
  for (const raw of Array.isArray(parsed?.items) ? parsed.items : []) {
    const checked = checkItem(raw, verbs);
    if ('item' in checked) { items.push(checked.item); continue; }
    const fr = raw && typeof raw === 'object' && 'fr' in raw && typeof raw.fr === 'string' ? `«${raw.fr}»` : 'an item';
    dropped.push(`${fr}: ${checked.dropped}`);
  }
  return { items, dropped };
}

const SLOT_TEXT: Record<EarSentenceKind, string> = { when: 'when', howmany: 'how many', who: 'who' };
export function itemsPrompt(knowledge: EarKnowledge, slots: EarSlot[]): string {
  return `You write listening questions for Echo, an app for one English speaker learning French. Their listening is about A1 (their reading A2), and they are moving from the présent to the passé composé, the imparfait and the futur.

Each item is one short spoken French sentence and a question in English that only the sentence's grammar can answer. The learner hears the sentence (they do not read it) and answers by ear, so the answer must be in what is HEARD: never in spelling, silent letters or written-only agreement.

Write exactly these ${slots.length} items, in this order:
${slots.map((slot, index) => `${index + 1}. ${SLOT_TEXT[slot.kind]} — the verb in the ${TENSE_NAMES[slot.tense]}`).join('\n')}

The kinds:
- when ("kind": "when"): when it happens, told only by the tense of the verb. Ask in plain English ("When does she finish it?", "One Saturday, or every Saturday?"). Each choice stands for one tense: "pc" (done, it happened), "pres" (happening now, or always true), "imp" (used to happen, or was going on), "fut" (still to come). Give 2 or 3 choices, one of them the item's tense. No word in the French may give the time away: no hier, demain, maintenant, bientôt, autrefois, déjà, dernier, prochain, aujourd'hui, quand j'étais petit… — only the verb tells.
- how many ("kind": "howmany"): how many people do it. The subject is the pronoun il or elle (one) or ils or elles (more than one), and the verb must SOUND different in the plural: il prend / ils prennent, il finit / ils finissent, il a / ils ont, il est / ils sont, il fait / ils font, il va / ils vont, il peut / ils peuvent, il a mangé / ils ont mangé, il ira / ils iront. Never a verb whose singular and plural sound the same (il mange / ils mangent, il parle / ils parlent, il voit / ils voient, il court / ils courent, il mangeait / ils mangeaient), unless the verb starts with a vowel (not h) and comes straight after ils or elles, so the liaison z is heard (elles‿aiment, ils‿écoutaient). So in the imparfait, use a verb starting with a vowel right after the subject. Exactly 2 choices, such as "One" and "More than one".
- who ("kind": "who"): who something is done to or whose it is, told by one little word. Either an object pronoun just before the verb ("cue": "pronoun": lui = to him or her, leur = to them, le = him or it, la = her or it, les = them, me, te, nous, vous), or a possessive ("cue": "possessive": son, sa, ses = his or her; leur, leurs = their; mon, ton, notre, votre…). Never le or la before a vowel (they become l’, and nobody can hear which); never ask whether an owner is a man or a woman (son and sa agree with the thing owned); never offer two choices that sound alike. 2 or 3 choices.

Every item:
- fr: 4 to 10 words of everyday spoken French, simple enough for A1 listening, using the verbs and words below (any form of them), little words and first names. The verb the question rests on is one of the learner's verbs below, in the tense asked, correctly conjugated; keep it affirmative and right after its subject or pronoun.
- question and choices: plain English, short, not giving the answer away.
- why: one or two short sentences in English, quoting the French in « », saying what you hear that gives the answer and what the other choice would have sounded like. Point at sounds by quoting French words (the n of « prennent »), never with English spellings of sounds.
- en: the sentence's natural English.

Reply with JSON only:
{"items": [{"kind": "when", "fr": "...", "en": "...", "question": "...", "choices": ["...", "..."], "means": ["...", "..."], "answer": 0, "why": "...", "verb": "<the infinitive, as listed>", "tense": "pres" | "pc" | "imp" | "fut", "person": "je" | "tu" | "il" | "elle" | "on" | "nous" | "vous" | "ils" | "elles", "form": "<the verb as it is in the sentence, without its subject>", "cue": "pronoun" | "possessive" (who only)}]}
- means: what each choice stands for, in the order of the choices. when: the tense ("pc", "pres", "imp", "fut"). howmany: "one" or "more". who: the French word the choice stands for ("lui", "leur", "me"; "son", "leur").
- answer: the index of the right choice.

The learner's verbs (French infinitive = English), the ones they have started first:
${knowledge.verbs.map((verb) => `${verb.inf} = ${verb.en}`).join('\n')}

The learner's words (French = English):
${knowledge.known.map((word) => `${word.fr} = ${word.en}`).join('\n')}`;
}

// ── The store ──
export function createGrammarEar(deps: {
  dbPath: string; ask: Ask; knowledge: () => EarKnowledge;
  // The recording of a sentence: its clip id and URL, whether it exists, and whether recording it has given up.
  clip: (fr: string) => string; audio: (clip: string) => string; recorded: (clip: string) => boolean; stuck: (clip: string) => boolean;
  // Records the sentences waiting for a recording (the caller serialises it with the other recordings).
  record: () => Promise<void>;
  // Comprehension answers given in Listen after this moment (lib/comprehension-store.ts).
  listenAnswersSince: (since: string) => number;
  now?: () => Date; random?: () => number;
}) {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const db = new Database(deps.dbPath, { create: true, strict: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS ear_sentences (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, fr TEXT NOT NULL UNIQUE, en TEXT NOT NULL, question TEXT NOT NULL,
      choices_json TEXT NOT NULL, answer INTEGER NOT NULL, why TEXT NOT NULL, verb_id TEXT NOT NULL, tense TEXT NOT NULL,
      person INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ear_sentence_answers (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, item_id INTEGER NOT NULL,
      choice INTEGER NOT NULL, right INTEGER NOT NULL, answered_at TEXT NOT NULL);`);
  type Row = { id: number; kind: EarSentenceKind; fr: string; en: string; question: string; choices_json: string; answer: number; why: string; created_at: string };
  const allItems = db.query<Row, []>('SELECT id, kind, fr, en, question, choices_json, answer, why, created_at FROM ear_sentences ORDER BY id');
  const itemById = db.query<Row, [number]>('SELECT id, kind, fr, en, question, choices_json, answer, why, created_at FROM ear_sentences WHERE id = ?');
  const addItem = db.query('INSERT OR IGNORE INTO ear_sentences (kind, fr, en, question, choices_json, answer, why, verb_id, tense, person, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const allAnswers = db.query<{ sequence: number; item_id: number; right: number; answered_at: string }, []>('SELECT sequence, item_id, right, answered_at FROM ear_sentence_answers ORDER BY sequence');
  const answerById = db.query<{ item_id: number; choice: number; sequence: number }, [string]>('SELECT item_id, choice, sequence FROM ear_sentence_answers WHERE request_id = ?');
  const addAnswer = db.query('INSERT INTO ear_sentence_answers (request_id, item_id, choice, right, answered_at) VALUES (?, ?, ?, ?, ?)');

  let writing: Promise<void> | null = null;
  let retryAt = 0;

  // Each item's answers, and which items wait: never answered, or missed once and due back.
  function standing() {
    const items = allItems.all();
    const answers = allAnswers.all();
    const byItem = Map.groupBy(answers, (answer) => answer.item_id);
    const returning = items.filter((item) => {
      const given = byItem.get(item.id) ?? [];
      return given.length === 1 && !given[0]!.right && answers.filter((answer) => answer.sequence > given[0]!.sequence).length >= RETURN_AFTER;
    });
    const fresh = items.filter((item) => !byItem.has(item.id));
    const missedOnce = items.filter((item) => { const given = byItem.get(item.id) ?? []; return given.length === 1 && !given[0]!.right; });
    return { items, answers, returning, fresh, missedOnce };
  }

  // Asks for a batch when few are left; one at a time, and after a failure or an empty batch not again for a while.
  function refill(): void {
    if (writing || Date.now() < retryAt) return;
    const { fresh } = standing();
    if (fresh.filter((item) => !deps.stuck(deps.clip(item.fr))).length >= REFILL_AT) return;
    writing = (async () => {
      try {
        const knowledge = deps.knowledge();
        if (!knowledge.verbs.length) throw new StoreError('Grammar by ear needs the verb tables first.');
        const slots = planSlots(BATCH, random);
        const reply = await deps.ask(itemsPrompt(knowledge, slots), { timeout: 5 * 60_000, purpose: 'writing Grammar by ear questions' });
        const { items, dropped } = parseItems(reply, knowledge.verbs);
        const at = now().toISOString();
        // A sentence already in Echo is not kept twice.
        const kept = items.filter((item) => addItem.run(item.kind, item.fr, item.en, item.question, JSON.stringify(item.choices), item.answer, item.why, item.verbId, item.tense, item.person, at).changes > 0).length;
        console.log(`grammar by ear: kept ${kept} of ${items.length + dropped.length}${dropped.length ? `; dropped ${dropped.join('; ')}` : ''}`);
        if (!kept) retryAt = Date.now() + RETRY_AFTER;
      } catch (failure) {
        console.error(`grammar by ear: ${failure instanceof Error ? failure.message : String(failure)}`);
        retryAt = Date.now() + RETRY_AFTER;
      } finally { writing = null; }
    })();
  }

  // The sentences to record: every item still to be answered, or answered once wrong.
  function phrases(): string[] {
    const { fresh, missedOnce } = standing();
    return [...fresh, ...missedOnce].map((item) => item.fr);
  }

  // Tops up, then records what waits; at start and whenever the Mac is quiet.
  async function check(): Promise<void> {
    refill();
    await writing;
    await deps.record();
  }

  function view(item: Row, again: boolean): EarView {
    return { id: String(item.id), kind: item.kind, question: item.question, choices: JSON.parse(item.choices_json) as string[], audio: [deps.audio(deps.clip(item.fr))], again, check: { answer: item.answer, why: item.why, fr: item.fr, en: item.en } };
  }

  // The question Listen shows next, once EVERY comprehension answers have been given there since the last one (or
  // since the first item was written): a missed one due back first, else the oldest recorded one; null when none.
  function offer(): EarView | null {
    refill();
    const { items, answers, returning, fresh } = standing();
    if (!items.length) return null;
    const since = answers.at(-1)?.answered_at ?? items[0]!.created_at;
    if (deps.listenAnswersSince(since) < EVERY) return null;
    const ready = (item: Row) => deps.recorded(deps.clip(item.fr));
    const back = returning.find(ready);
    if (back) return view(back, true);
    const next = fresh.find(ready);
    return next ? view(next, false) : null;
  }

  // An answer, kept once per request id.
  function answer(input: { requestId?: unknown; id?: unknown; choice?: unknown }): EarResult {
    const requestId = typeof input?.requestId === 'string' && input.requestId.trim() ? input.requestId : '';
    if (!requestId) throw new StoreError('This answer is missing its request ID.');
    const kept = answerById.get(requestId);
    const item = kept ? itemById.get(kept.item_id) : typeof input?.id === 'string' && /^\d+$/.test(input.id) ? itemById.get(Number(input.id)) : null;
    if (!item) throw new StoreError('That question is not in Echo.', 404);
    const choices = JSON.parse(item.choices_json) as string[];
    let chosen = kept?.choice ?? -1;
    if (!kept) {
      if (typeof input.choice !== 'number' || !Number.isInteger(input.choice) || input.choice < 0 || input.choice >= choices.length) throw new StoreError('Choose one of the answers.');
      chosen = input.choice;
      addAnswer.run(requestId, item.id, chosen, chosen === item.answer ? 1 : 0, now().toISOString());
    }
    const sequence = kept?.sequence ?? answerById.get(requestId)!.sequence;
    const earlier = allAnswers.all().filter((entry) => entry.item_id === item.id && entry.sequence < sequence).length;
    const right = chosen === item.answer;
    return { id: String(item.id), right, answer: item.answer, chosen, why: item.why, fr: item.fr, en: item.en, again: !right && earlier === 0 };
  }

  return { offer, answer, check, phrases, settled: () => writing ?? Promise.resolve(), close: () => db.close() };
}
