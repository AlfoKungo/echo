import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { GrammarExercise } from '../contract';
import { unglossed } from '../lib/comprehension-content';
import { classify, fromLanguageKey, grammarSpeech, loadCourse } from '../lib/grammar-content';
import { createGrammarStore } from '../lib/grammar-store';

const content = join(import.meta.dir, '..', 'content');

const typed = (answers: string[], extra: Partial<GrammarExercise> = {}): GrammarExercise => ({
  id: 'x', pattern: 'p', type: 'translate', instruction: 'Translate.', source: 'x', answers, mistakes: [],
  hint: 'h', feedback: 'f', explanation: 'e', ...extra,
});

describe('Portuguese and Swedish grammar', () => {
  test('each course loads from its own folder with the topic ids the other rooms tag', async () => {
    const expected = {
      pt: ['articles-gender', 'plural', 'adjective-agreement', 'possessives', 'prepositions-contractions', 'ser-estar', 'present-regular',
        'present-irregular', 'negation-questions', 'object-pronouns', 'comparison', 'ir-future', 'preterite', 'imperfect'],
      sv: ['en-ett', 'definite-form', 'plural', 'adjective-agreement', 'possessives', 'word-order-v2', 'negation-placement', 'questions',
        'object-pronouns', 'present-tense', 'past-tense', 'perfect-tense', 'future', 'modal-verbs'],
    } as const;
    for (const code of ['pt', 'sv'] as const) {
      const course = await loadCourse(join(content, code, 'grammar'), code);
      expect(course.code).toBe(code);
      expect(course.topics.map((topic) => topic.id)).toEqual([...expected[code]]);
      expect(course.topics.every((topic) => topic.level === 'A1' || topic.level === 'A2')).toBe(true);
      // The learnt text arrives under Echo's internal fr field, as the decks' does.
      const examples = course.topics.flatMap((topic) => topic.guide.sections.flatMap((section) => section.examples));
      expect(examples.every((example) => typeof example.fr === 'string' && !(code in example))).toBe(true);
      const glosses = course.topics.flatMap((topic) => topic.exercises.flatMap((exercise) => exercise.gloss ?? []));
      expect(glosses.length).toBeGreaterThan(0);
      expect(glosses.every((entry) => typeof entry.fr === 'string' && !(code in entry))).toBe(true);
      const store = createGrammarStore(course, { dbPath: ':memory:' });
      expect(store.catalog().flatMap((unit) => unit.topics)).toHaveLength(14);
      store.close();
    }
  });

  test('a course written under fr outside French is mapped untouched, and French loads as before', async () => {
    const topic = { id: 't', guide: { summary: 's', sections: [{ id: 'a', title: 'A', text: 't', examples: [{ pt: 'Eu falo.', en: 'I speak.' }] }] }, exercises: [{ id: 'e', gloss: [{ pt: 'falo', en: 'speak', word: 'verbs-001' }] }] };
    const mapped = fromLanguageKey(topic as never, 'pt');
    expect(mapped.guide.sections[0]!.examples[0]).toEqual({ en: 'I speak.', fr: 'Eu falo.' });
    expect(mapped.exercises[0]!.gloss![0]).toEqual({ en: 'speak', word: 'verbs-001', fr: 'falo' });
    const french = await loadCourse(join(content, 'grammar'));
    expect(french.code).toBeUndefined();
    expect(french.topics).toHaveLength(35);
  });

  test('a missing Portuguese or Swedish mark is a spelling slip, and wrong where the exercise makes the mark the point', () => {
    expect(classify(typed(['Você está cansado.']), 'voce esta cansado').kind).toBe('spelling');
    expect(classify(typed(['Eu não falo alemão.']), 'Eu nao falo alemao.').kind).toBe('spelling');
    expect(classify(typed(['A lição começa às três.']), 'A licao comeca as tres.').kind).toBe('spelling');
    expect(classify(typed(['Jag har ätit.']), 'jag har atit').kind).toBe('spelling');
    expect(classify(typed(['Här är min väska.']), 'Har ar min vaska.').kind).toBe('spelling');
    expect(classify(typed(['Här är min väska.'], { strictAccents: true }), 'Har ar min vaska.').kind).toBe('incorrect');
    expect(classify(typed(['Jag har ätit.']), 'Jag har ätit').kind).toBe('correct');
    expect(classify(typed(['Jag har ätit.']), 'Jag har ät').kind).toBe('incorrect');
  });

  test('each language leaves only its own little words unglossed', () => {
    expect(unglossed('Eu não sei o nome dela.', [{ fr: 'sei' }, { fr: 'nome' }, { fr: 'dela' }], 'pt')).toEqual([]);
    expect(unglossed('Jag ser inte den.', [{ fr: 'ser' }], 'sv')).toEqual([]);
    expect(unglossed('Jag ser inte den.', [{ fr: 'ser' }])).toEqual(['Jag', 'inte', 'den']);
  });

  test('the spoken sentence of a Swedish blank reads without its cue', () => {
    expect(grammarSpeech(typed(['skrev'], { type: 'complete', source: 'Igår ____ (skriva) jag ett brev.' }))).toBe('Igår skrev jag ett brev.');
  });
});
