import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TalkTurn } from '../contract';
import { createTalk, endsAt, looksFrench, MAX_EXCHANGES, parseReply, pickTopic, sampleKnown, talkPrompt, TOPICS, type KnownWord } from '../lib/talk';
import { StoreError } from '../lib/store';

const directories: string[] = [];
const talks: { close(): void }[] = [];
afterEach(() => {
  for (const talk of talks.splice(0)) talk.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const folder = () => { const directory = mkdtempSync(join(tmpdir(), 'echo-talk-')); directories.push(directory); return directory; };
const seeded = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

const known: KnownWord[] = Array.from({ length: 200 }, (_, index) => ({ fr: `mot${index}`, en: `word${index}` }));
const reply = (fields: Record<string, unknown>) => JSON.stringify(fields);

describe('the prompt', () => {
  test('names the Practising line’s tenses and lists a sample of the learner’s words', () => {
    const words = [{ fr: 'la maison', en: 'house' }, { fr: 'manger', en: 'to eat' }];
    const prompt = talkPrompt({ topic: TOPICS[0]!, tenses: ['pres', 'pc'], level: 'A2', known: words, lines: [] });
    expect(prompt).toContain('présent, passé composé');
    expect(prompt).not.toContain('imparfait');
    expect(prompt).toContain('la maison = house');
    expect(prompt).toContain('manger = to eat');
    expect(prompt).toContain('le week-end');
  });
  test('a sample holds at most its count, all of them the learner’s words, each once', () => {
    const sample = sampleKnown(known, 80, seeded(3));
    expect(sample).toHaveLength(80);
    expect(new Set(sample).size).toBe(80);
    expect(sample.every((word) => known.includes(word))).toBe(true);
    expect(sampleKnown(known.slice(0, 5), 80)).toHaveLength(5);
  });
  test('tells Claude it may not close before the third exchange and must by the fifth', () => {
    const lines = (count: number) => Array.from({ length: count }, (_, index) => [{ who: 'echo' as const, fr: `Question ${index} ?` }, { who: 'you' as const, fr: `Réponse ${index}` }]).flat();
    const base = { topic: TOPICS[0]!, tenses: ['pres' as const], level: 'A2', known: [] };
    expect(talkPrompt({ ...base, lines: lines(1) })).toContain('too early to close');
    expect(talkPrompt({ ...base, lines: lines(5) })).toContain('this is the last exchange');
  });
  test('a new topic is none of the last four', () => {
    const recent = TOPICS.slice(0, 4).map((topic) => topic.id);
    for (let seed = 1; seed < 40; seed++) expect(recent).not.toContain(pickTopic(recent, seeded(seed)).id);
  });
});

describe('Claude’s reply', () => {
  test('a turn’s JSON is read, even inside a code fence', () => {
    const parsed = parseReply('```json\n' + reply({ correction: 'Je suis allé au marché.', reply_fr: 'Ah, et qu’est-ce que tu as acheté ?', reply_en: 'Oh, and what did you buy?', done: false }) + '\n```', 'je suis aller au marché');
    expect(parsed).toEqual({ correction: 'Je suis allé au marché.', fr: 'Ah, et qu’est-ce que tu as acheté ?', en: 'Oh, and what did you buy?', done: false });
  });
  test('prose, a missing field or a reply in English is refused', () => {
    expect(parseReply('Bien sûr ! Tu as acheté quoi ?', 'oui')).toBe('the reply could not be read');
    expect(parseReply(reply({ reply_fr: 'Tu as acheté quoi ?', reply_en: 'What did you buy?', done: false }), 'oui')).toBe('a part is missing');
    expect(parseReply(reply({ correction: null, reply_fr: 'Tu as acheté quoi ?', done: false }), 'oui')).toBe('a part is missing');
    expect(parseReply(reply({ correction: null, reply_fr: 'Tu as acheté quoi ?', reply_en: 'What did you buy?' }), 'oui')).toBe('a part is missing');
    expect(parseReply(reply({ correction: null, reply_fr: 'Tu as acheté quoi ?', reply_en: 'What did you buy?', done: 'no' }), 'oui')).toBe('done is not true or false');
    expect(parseReply(reply({ correction: null, reply_fr: 'What did you buy at the market?', reply_en: 'What did you buy at the market?', done: false }), 'oui')).toBe('reply_fr is not French');
  });
  test('an opener needs only its French and English', () => {
    expect(parseReply(reply({ reply_fr: 'Salut ! Tu fais quoi ce week-end ?', reply_en: 'Hi! What are you doing this weekend?' }), null)).toEqual({ correction: null, fr: 'Salut ! Tu fais quoi ce week-end ?', en: 'Hi! What are you doing this weekend?', done: false });
  });
  test('the correction is null when the line was right, even if Claude rewrote only its punctuation or accents', () => {
    const turn = (correction: unknown) => parseReply(reply({ correction, reply_fr: 'Super, tu aimes ça ?', reply_en: 'Great, do you like it?', done: false }), 'je vais au cinema ce soir');
    expect(turn(null)).toMatchObject({ correction: null });
    expect(turn('')).toMatchObject({ correction: null });
    expect(turn('Je vais au cinéma ce soir.')).toMatchObject({ correction: null });
    expect(turn('Je vais au cinéma ce soir avec toi.')).toMatchObject({ correction: 'Je vais au cinéma ce soir avec toi.' });
  });
  test('French is told from English by their commonest words', () => {
    expect(looksFrench('Tu as passé un bon week-end ?')).toBe(true);
    expect(looksFrench('Génial !')).toBe(true);
    expect(looksFrench('Did you have a good weekend?')).toBe(false);
  });
});

describe('a conversation', () => {
  // A Claude that always closes, or never, and corrects only one line; and a voice that names each line by its order.
  function harness(close = false) {
    const prompts: string[] = [];
    let spoken = 0;
    const talk = createTalk({
      dbPath: join(folder(), 'echo.db'), model: 'sonnet', random: seeded(7),
      ask: async (prompt, options) => {
        prompts.push(prompt);
        expect(options.model).toBe('sonnet');
        if (prompt.includes('Open the conversation')) return reply({ reply_fr: 'Salut ! Tu fais quoi ce week-end ?', reply_en: 'Hi! What are you doing this weekend?' });
        const last = prompt.split('\n').filter((line) => line.startsWith('Learner: ')).at(-1);
        return reply({ correction: last === 'Learner: je suis aller au marché' ? 'Je suis allé au marché.' : null, reply_fr: close ? 'Bon week-end, à bientôt !' : 'Ah bon ? Et après, tu fais quoi ?', reply_en: close ? 'Have a good weekend, see you soon!' : 'Really? And afterwards, what do you do?', done: close });
      },
      speak: async () => `${String(++spoken).padStart(24, '0')}`,
      knowledge: () => ({ known, level: 'A2' }),
      tensesOf: () => ['pres', 'pc'],
    });
    talks.push(talk);
    return { talk, prompts };
  }
  let request = 0;
  const say = (talk: ReturnType<typeof harness>['talk'], id: string, heard: string | null) => talk.turn({ conversation: id, request: `request-${++request}` }, async () => heard);
  const conversation = (turn: TalkTurn) => { if (turn.unclear) throw new Error('unclear'); return turn.conversation; };

  test('opens with Claude’s line, voiced, and keeps the learner’s tenses and words for every turn', async () => {
    const { talk, prompts } = harness();
    const { view } = await talk.start({ practising: {} });
    expect(view.lines).toEqual([{ who: 'echo', fr: 'Salut ! Tu fais quoi ce week-end ?', en: 'Hi! What are you doing this weekend?', correction: null, audio: `audio/talk/${'1'.padStart(24, '0')}.mp3` }]);
    await say(talk, view.id, 'je vais au marché');
    expect(prompts[1]).toContain('présent, passé composé');
    expect(prompts[1]).toContain('Learner: je vais au marché');
    expect(prompts[1]!.split('\n').filter((line) => / = word\d+$/.test(line))).toHaveLength(80);
  });
  test('ends by the fifth exchange even when Claude would go on, and takes no more turns', async () => {
    const { talk } = harness(false);
    const { view } = await talk.start({});
    for (let exchange = 1; exchange <= MAX_EXCHANGES; exchange++) {
      const now = conversation((await say(talk, view.id, `je dis la phrase ${exchange}`)).turn);
      expect(now.done).toBe(exchange === MAX_EXCHANGES);
    }
    expect(talk.view(view.id).lines.filter((line) => line.who === 'you')).toHaveLength(MAX_EXCHANGES);
    await expect(say(talk, view.id, 'encore une')).rejects.toBeInstanceOf(StoreError);
  });
  test('a close before the third exchange is not taken; from the third it is', async () => {
    const { talk } = harness(true);
    const { view } = await talk.start({});
    expect(conversation((await say(talk, view.id, 'je vais bien')).turn).done).toBe(false);
    expect(conversation((await say(talk, view.id, 'je travaille')).turn).done).toBe(false);
    expect(conversation((await say(talk, view.id, 'oui c’est ça')).turn).done).toBe(true);
    expect(endsAt(2, true)).toBe(false);
    expect(endsAt(3, true)).toBe(true);
    expect(endsAt(5, false)).toBe(true);
  });
  test('the correction sits on the learner’s line, and a right line has none', async () => {
    const { talk } = harness();
    const { view } = await talk.start({});
    const first = conversation((await say(talk, view.id, 'je suis aller au marché')).turn);
    expect(first.lines[1]).toMatchObject({ who: 'you', fr: 'je suis aller au marché', correction: 'Je suis allé au marché.', en: '' });
    const second = conversation((await say(talk, view.id, 'j’ai acheté du pain')).turn);
    expect(second.lines[3]).toMatchObject({ who: 'you', correction: null });
  });
  test('nothing usable heard asks Claude nothing and adds no line', async () => {
    const { talk, prompts } = harness();
    const { view } = await talk.start({});
    expect((await say(talk, view.id, null)).turn).toEqual({ unclear: true, heard: '' });
    expect((await say(talk, view.id, 'Merci.')).turn).toEqual({ unclear: true, heard: 'Merci.' });
    expect((await say(talk, view.id, 'Sous-titres réalisés par la communauté d’Amara.org')).turn.unclear).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(talk.view(view.id).lines).toHaveLength(1);
    expect((await say(talk, view.id, 'Merci, et toi ?')).turn.unclear).toBe(false);
  });
  test('a turn sent again answers what the first did, asking Claude once', async () => {
    const { talk, prompts } = harness();
    const { view } = await talk.start({});
    const input = { conversation: view.id, request: 'again-123456' };
    const [first, second] = await Promise.all([talk.turn(input, async () => 'je vais bien'), talk.turn(input, async () => 'je vais bien')]);
    const third = await talk.turn(input, async () => 'je vais bien');
    expect(prompts).toHaveLength(2);
    expect(second.turn).toEqual(first.turn);
    expect(third.turn).toEqual(first.turn);
    expect(talk.view(view.id).lines).toHaveLength(3);
  });
  test('Again keeps the topic', async () => {
    const { talk } = harness();
    const { view } = await talk.start({});
    const { view: again } = await talk.start({ topic: view.topic.id });
    expect(again.topic).toEqual(view.topic);
    expect(again.id).not.toBe(view.id);
  });
});
