// Every phrase the Verbs room says in a language other than French, to be recorded in that language's voice
// (scripts/list-clips.ts verbs): By ear's forms and How it's built's examples, for every verb in the deck, so a verb
// the learner starts later is already recorded. French's phrases are the Radio's (server.ts recordSentences).
import { join } from 'node:path';
import type { Language } from './language';
import { loadPtVerbs, PORTUGUESE } from './verbs-pt';
import { SWEDISH, svVerbs } from './verbs-sv';

export async function verbPhrases(language: Language): Promise<string[]> {
  if (language.code === 'fr') throw new Error('French verb phrases are the Radio’s; list them with the server.');
  const words = (await Promise.all(['core', 'world'].map((name) => Bun.file(join(language.content, `${name}.json`)).json() as Promise<Record<string, string>[]>)))
    .flat().map((word) => ({ id: word.id!, fr: word[language.textKey]!, en: word.en!, category: word.category, note: word.note }));
  if (language.code === 'pt') {
    const verbs = loadPtVerbs(join(language.content, 'verbs.json'), words);
    return [...new Set([...verbs.flatMap((verb) => PORTUGUESE.earQuestions(verb).map((question) => question.said)), ...PORTUGUESE.ruleCandidates(verbs, new Set()).flatMap((card) => card.examples)])];
  }
  return [...new Set(SWEDISH.ruleCandidates(svVerbs(words), new Set()).flatMap((card) => card.examples))];
}
