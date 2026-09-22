import { expect, test } from 'bun:test';
import { createLearningStore } from '../lib/learning-store';
import { LocalTutor, splitTutorText } from '../lib/local-tutor';
import type { LearningContent } from '../learning-contract';

const empty: LearningContent = { listening: [], reading: [], conversations: [] };

test('sectioning preserves every character, separator and complete Unicode code point', () => {
  const source = 'é'.repeat(1199) + '𝄞' + '\n\n' + 'Une phrase assez longue. '.repeat(130) + '\nLa dernière phrase.';
  const sections = splitTutorText(source);
  expect(sections.join('')).toBe(source);
  expect(sections.every(section => section.length <= 1200 && !/\p{Surrogate}/u.test(section))).toBe(true);
  expect(sections.at(-1)?.endsWith('La dernière phrase.')).toBe(true);
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
