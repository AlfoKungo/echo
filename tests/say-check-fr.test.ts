import { describe, expect, test } from 'bun:test';
import { answerTextsFrench, hintFrench, judgeFrench, learnableFrench, saidFrench, wrongGender } from '../lib/say-check-fr';

describe('Say it in French: judging what was heard against the card’s French', () => {
  test('the article is optional, and any article of the right gender counts', () => {
    for (const heard of ['Salon.', 'Le salon.', 'un salon', 'Euh… le salon', 'C’est le salon.', 'Les salons.']) expect(judgeFrench(heard, 'le salon', 'masculine')).toBe('right');
  });

  test('an article of the other gender is wrong, however clearly the word was said', () => {
    expect(judgeFrench('La salon.', 'le salon', 'masculine')).toBe('wrong');
    expect(judgeFrench('Une salon.', 'le salon', 'masculine')).toBe('wrong');
    expect(wrongGender('La salon.', 'le salon', 'masculine')).toBe(true);
    expect(wrongGender('Le salon.', 'le salon', 'masculine')).toBe(false);
  });

  test('accents and elision do not count, and an elided article run into the word is parted', () => {
    for (const heard of ['L’évier.', "l'evier", 'Évier.', 'evier', 'Lévier.']) expect(judgeFrench(heard, "l'évier", 'masculine')).toBe('right');
    expect(judgeFrench('La évier', "l'évier", 'masculine')).toBe('wrong');
  });

  test('another word is wrong, even one letter away', () => {
    expect(judgeFrench('Le poison.', 'le poisson', 'masculine')).toBe('wrong');
    expect(judgeFrench('La cuisine.', 'le salon', 'masculine')).toBe('wrong');
    expect(judgeFrench('Le salon de ma grand-mère est très grand.', 'le salon', 'masculine')).toBe('wrong');
  });

  test('silence, thinking aloud and giving up are told apart from a wrong answer', () => {
    expect(judgeFrench('Sous-titres réalisés par la communauté d’Amara.org', 'le salon', 'masculine')).toBe('unclear');
    expect(judgeFrench('Merci.', 'le salon', 'masculine')).toBe('unclear');
    expect(judgeFrench('Attends…', 'le salon', 'masculine')).toBe('unclear');
    expect(judgeFrench('Je ne sais pas.', 'le salon', 'masculine')).toBe('dontknow');
    expect(judgeFrench("I don't know", 'le salon', 'masculine')).toBe('dontknow');
    expect(learnableFrench('je ne sais pas')).toBe(false);
  });

  test('what the learner once marked right counts from then on', () => {
    const kept = saidFrench('Euh, le salo.');
    expect(judgeFrench('Le salo.', 'le salon', 'masculine')).toBe('wrong');
    expect(judgeFrench('Le salo.', 'le salon', 'masculine', [kept])).toBe('right');
  });

  test('recognition is told the word without its article, and scored with and without it', () => {
    expect(hintFrench("l'évier")).toBe('évier.');
    expect(answerTextsFrench('le salon')).toEqual(['Le salon.', 'Salon.']);
  });
});
