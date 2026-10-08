import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWriteIt, parseCheck, pickTopics, type WriteKnowledge } from '../lib/write-it';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const knowledge: WriteKnowledge = {
  known: [{ fr: 'le pain', en: 'bread' }, { fr: 'manger', en: 'to eat' }],
  level: 2,
  topics: [
    { id: 'negation', title: 'Negation', seen: 10, independent: 9 },
    { id: 'passe-compose', title: 'Passé composé', seen: 10, independent: 2 },
    { id: 'futur', title: 'Futur', seen: 0, independent: 0 },
  ],
};
const sentences = JSON.stringify({ sentences: [
  { en: 'I ate the bread.', fr: 'J’ai mangé le pain.', topic: 'passe-compose' },
  { en: 'I do not eat bread.', fr: 'Je ne mange pas de pain.', topic: 'negation' },
  { en: 'Not a topic we asked for.', fr: 'Non.', topic: 'futur' },
] });

function fixture(replies: (prompt: string) => string) {
  const directory = mkdtempSync(join(tmpdir(), 'echo-write-'));
  directories.push(directory);
  const prompts: string[] = [];
  const write = createWriteIt({
    dbPath: join(directory, 'echo.db'), knowledge: () => knowledge, titles: () => new Map([['passe-compose', 'Passé composé']]),
    ask: async (prompt) => { prompts.push(prompt); return replies(prompt); },
  });
  return { write, prompts };
}

test('topics to write about are the started ones, weakest first', () => {
  expect(pickTopics(knowledge.topics).map((topic) => topic.id)).toEqual(['passe-compose', 'negation']);
});

test('sentences are written ahead from the known words and started topics, then checked once per request', async () => {
  const { write, prompts } = fixture((prompt) => prompt.includes('They typed')
    ? '{"verdict": "nearly", "corrected": "J’ai mangé le pain.", "explanation": "Manger takes avoir.", "natural": "J’ai mangé le pain."}'
    : sentences);
  expect(write.state()).toMatchObject({ current: null, writing: true });
  await write.settled();
  expect(prompts[0]).toContain('le pain = bread');
  expect(prompts[0]).toContain('passe-compose (Passé composé)');
  const first = write.state();
  // The sentence for a topic that was not asked for is dropped.
  expect([first.waiting, first.current]).toEqual([2, { id: expect.any(String), en: 'I ate the bread.', topicId: 'passe-compose', topicTitle: 'Passé composé' }]);

  const input = { requestId: 'w1', itemId: first.current!.id, given: 'Je suis mangé le pain.' };
  const [a, b] = await Promise.all([write.check(input), write.check(input)]);
  expect(a).toEqual({ verdict: 'nearly', given: 'Je suis mangé le pain.', corrected: 'J’ai mangé le pain.', explanation: 'Manger takes avoir.', natural: 'J’ai mangé le pain.' });
  expect(b).toEqual(a);
  expect(await write.check(input)).toEqual(a);
  expect(prompts.filter((prompt) => prompt.includes('They typed'))).toHaveLength(1);
  expect(write.state().result).toEqual(a);

  const next = write.next({ itemId: first.current!.id });
  expect([next.current?.en, next.result]).toEqual(['I do not eat bread.', null]);
  await expect(write.check({ requestId: 'w2', itemId: next.current!.id, given: '  ' })).rejects.toThrow('Write the sentence in French first.');
  write.close();
});

test('a check Claude did not answer properly is refused, not guessed', () => {
  expect(() => parseCheck('{"verdict": "maybe"}', 'Je mange.')).toThrow('could not be checked');
  expect(parseCheck('{"verdict": "right", "explanation": "ignored"}', 'Je mange.')).toEqual({ verdict: 'right', given: 'Je mange.', corrected: 'Je mange.', explanation: '', natural: '' });
});
