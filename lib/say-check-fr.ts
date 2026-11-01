// Say it in French: whether what the learner said aloud for an English → French card, as speech recognition wrote it
// down in French, is the card's French. Case, punctuation and accents do not count ("evier" is "évier"), an elided
// word is its own word ("l'évier" is "l" and "évier", and "lévier" as recognition may run them together), and the
// article is optional: "salon" and "le salon" are both "le salon", and so is "un salon". An article of the other
// gender is wrong ("la salon"), as is any other word: French has no slips by sound or by one letter here, since one
// letter is often another word (poison, poisson); a short answer recognition may have misheard is scored instead
// (server.ts, lib/whisper-mlx.py). Fillers ("euh", "alors"), an opener ("c'est") and a few words more are fine.
// Recognition's inventions from silence ("Merci.", "Sous-titres réalisés par…"), thinking aloud ("attends") and
// giving up ("je ne sais pas", "I don't know") are told apart as in English (lib/say-check.ts). What the learner
// once marked as heard wrong for the card (Store.sayAccepted, en-fr) counts as its French.
import type { Gender } from './language';
import type { SayVerdict } from './say-check';

const ARTICLES: Record<string, Gender | null> = { le: 'masculine', un: 'masculine', la: 'feminine', une: 'feminine', l: null, les: null, des: null };
// Letters an apostrophe cuts a word to: l'évier, d'accord, j'ai, qu'il.
const ELIDED = new Set(['l', 'd', 'j', 'm', 't', 's', 'n', 'c', 'qu']);
const FILLERS = new Set(['euh', 'heu', 'euhm', 'hum', 'hmm', 'mm', 'ben', 'bah', 'bon', 'alors', 'ah', 'oh', 'eh', 'um', 'uh', 'er', 'erm', 'donc']);
const OPENERS = [['c', 'est'], ['ce', 'est'], ['ca', 'veut', 'dire'], ['je', 'pense'], ['je', 'crois'], ['on', 'dit']];
// What Whisper writes in French for silence, breath or room noise when nothing was said; the English ones too, as
// the learner's room is the same. Starts of a phrase: recognition goes on to name the subtitler or the channel.
const NOTHING = ['sous titres', 'sous titrage', 'merci', 'merci d avoir regarde', 'merci de votre attention', 'musique', 'applaudissements', 'rires', 'silence', 'you', 'thank you', 'thanks for watching', 'blank audio', 'inaudible'];
const THINKING = ['attends', 'attendez', 'attends voir', 'voyons', 'voyons voir', 'un instant', 'une seconde', 'une minute', 'comment dit on', 'comment on dit', 'c est quoi', 'qu est ce que c est', 'je sais', 'je pense', 'je crois', 'c est', 'let me think', 'wait', 'hold on'];
const DONT_KNOW = ['je ne sais pas', 'je sais pas', 'sais pas', 'chais pas', 'j sais pas', 'je ne sais plus', 'je sais plus', 'aucune idee', 'je n ai aucune idee', 'j ai aucune idee', 'je ne me souviens pas', 'je me souviens pas', 'je ne me souviens plus', 'je me souviens plus', 'j ai oublie', 'je passe', 'passe', 'joker', 'je donne ma langue au chat', 'i don t know', 'don t know', 'i do not know', 'no idea', 'pass', 'i give up', 'i forgot', 'i can t remember'];
const SMALL = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'de', 'du', 'des', 'd', 'c', 'est', 'et', 'ou', 'ce', 'ca', 'je', 'j', 'il', 'elle', 'que', 'qu', 'quoi', 'euh']);

// Lower case, without accents or brackets; an apostrophe or hyphen parts words ("l'évier" is "l evier").
const plain = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
  .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const words = (text: string) => plain(text).split(' ').filter(Boolean);
const startsWith = (phrase: string, start: string) => phrase === start || (phrase.startsWith(start + ' ') && phrase.split(' ').length <= start.split(' ').length + 3);

function heardWords(heard: string): string[] {
  let list = words(heard).filter((word) => !FILLERS.has(word));
  for (const opener of OPENERS) if (opener.every((word, index) => list[index] === word) && list.length > opener.length) { list = list.slice(opener.length); break; }
  return list;
}
// The card's French as words, its article apart: "le salon" is { article: "le", core: ["salon"] }.
function wanted(french: string): { article: string | null; core: string[] } {
  const list = words(french);
  return list.length > 1 && Object.hasOwn(ARTICLES, list[0]!) ? { article: list[0]!, core: list.slice(1) } : { article: null, core: list };
}
// A plural for a singular, either way, as French writes both alike aloud: salon and salons, bijou and bijoux.
const forms = (word: string) => [word, ...(word.length > 2 && /[sx]$/.test(word) ? [word.slice(0, -1)] : [])];
const sameWord = (heard: string, want: string) => forms(heard).some((form) => forms(want).includes(form));

type Match = 'right' | 'gender' | null;
// Where the wanted words are among the heard ones (with at most three more), and whether an article said before them
// is of the other gender. An elided article run into the word ("lévier") is parted first.
function find(heard: string[], french: string, gender: Gender | undefined): Match {
  const { article, core } = wanted(french);
  if (!core.length) return null;
  const list = heard.flatMap((word) => word.length > 1 && word !== core[0] && ELIDED.has(word[0]!) && word.slice(1) === core[0] ? [word[0]!, word.slice(1)] : [word]);
  const own = article ? ARTICLES[article] ?? gender ?? null : null;
  let found: Match = null;
  for (let start = 0; start + core.length <= list.length; start++) {
    if (!core.every((word, index) => sameWord(list[start + index]!, word))) continue;
    const before = start > 0 ? list[start - 1]! : null;
    const said = before !== null && Object.hasOwn(ARTICLES, before) ? before : null;
    if (list.length - core.length - (said ? 1 : 0) > 3) continue;
    const saidGender = said ? ARTICLES[said] : null;
    if (article && own && saidGender && saidGender !== own) { found ??= 'gender'; continue; }
    return 'right';
  }
  return found;
}

// Whether what was heard may be kept as a card's French: not giving up, thinking aloud or recognition's noise.
export const learnableFrench = (heard: string) => judgeFrench(heard, '') === 'wrong';
// What was said, as it is kept when the learner marks it right after Echo heard it wrong.
export const saidFrench = (heard: string) => heardWords(heard).join(' ');
// Whether what was heard is the word with an article of the other gender: wrong however likely the word itself.
export const wrongGender = (heard: string, french: string, gender?: Gender) => find(heardWords(heard), french, gender) === 'gender';

export function judgeFrench(heard: string, french: string, gender?: Gender, accepted: readonly string[] = []): SayVerdict {
  const list = heardWords(heard), phrase = list.join(' ');
  if ((list.length && accepted.includes(phrase) && learnableFrench(phrase)) || [list, words(heard)].some((each) => find(each, french, gender) === 'right')) return 'right';
  if (DONT_KNOW.some((start) => startsWith(phrase, start))) return 'dontknow';
  const whole = plain(heard);
  if (!list.length || NOTHING.some((noise) => whole === noise || whole.startsWith(noise + ' ')) || THINKING.includes(phrase) || list.every((word) => SMALL.has(word))) return 'unclear';
  return 'wrong';
}

// What recognition is told to expect: the word without its article, as written ("évier."), so the article the
// learner says is written as said.
export const hintFrench = (french: string) => french.replace(/^(le|la|les|l['’]|un|une)\s*/i, '').trim() + '.';
// The wanted answer as Whisper writes text, to score against a clip that seemed wrong: with its article and without,
// capitalised, with a full stop ("Le salon.", "Salon.", "L'évier.", "Évier.").
export function answerTextsFrench(french: string): string[] {
  const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1) + '.';
  const bare = french.replace(/^(le|la|les|l['’]|un|une)\s*/i, '').trim();
  return [...new Set([capital(french.trim()), capital(bare)])].filter((text) => text.length > 1);
}
// How many words the wanted answer is, for asking the score only of a short answer.
export const frenchLength = (french: string) => Math.max(1, wanted(french).core.length);
