import { expect, test } from 'bun:test';
import { createLearningStore } from '../lib/learning-store';
import { LocalTutor, splitTutorText, writingFeedback } from '../lib/local-tutor';
import type { LearningContent } from '../learning-contract';

const empty: LearningContent = { listening: [], reading: [], conversations: [] };

test('sectioning preserves every character, separator and complete Unicode code point', () => {
  const source = 'é'.repeat(1199) + '𝄞' + '\n\n' + 'Une phrase assez longue. '.repeat(130) + '\nLa dernière phrase.';
  const sections = splitTutorText(source);
  expect(sections.join('')).toBe(source);
  expect(sections.every(section => section.length <= 1200 && !/\p{Surrogate}/u.test(section))).toBe(true);
  expect(sections.at(-1)?.endsWith('La dernière phrase.')).toBe(true);
});

test('a correction quoted with the other apostrophe still applies to the learner’s own text', () => {
  const typed = "Hier, j'ai habiter a Tel Aviv.";
  const feedback = writingFeedback({ summary: 'Two errors.', suggestions: [], errors: [
    { original: 'j’ai habiter', replacement: 'j’ai habité', explanation: 'Past participle after avoir.' },
    { original: 'a Tel Aviv', replacement: 'à Tel Aviv', explanation: 'À takes an accent.' },
  ] }, typed);
  expect(feedback.corrected).toBe('Hier, j’ai habité à Tel Aviv.');
  expect(feedback.errors.map((error) => error.original)).toEqual(["j'ai habiter", 'a Tel Aviv']);
  expect(() => writingFeedback({ summary: '', suggestions: [], errors: [{ original: 'nous avons', replacement: 'x', explanation: '' }] }, typed)).toThrow('not in your text');
});

test('Stop arriving before submission prevents loading and preserves the submitted draft', async () => {
  const store = createLearningStore(empty, { dbPath: ':memory:' });
  const tutor = new LocalTutor(store);
  try {
    tutor.cancelRequest('request-stopped-before-post');
    const job = tutor.submit({ requestId: 'request-stopped-before-post', kind: 'writing', sourceId: 'free-writing', text: 'Je voudrais un café.' });
    expect(job.status).toBe('cancelled');
    expect(tutor.get(job.id).input.text).toBe('Je voudrais un café.');
    expect(tutor.status().state).toBe('off');
    expect(tutor.status().queued).toBe(0);
    expect(tutor.submit(job.input).id).toBe(job.id);
    expect(tutor.get(job.id).status).toBe('cancelled');
  } finally { await tutor.close(); store.close(); }
});
