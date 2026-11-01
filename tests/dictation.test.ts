import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DictationSegment, GrammarLevel, ListeningWord } from '../contract';
import { AGAIN_AFTER, afterAnswer, candidates, createDictation, explain, judge, pickNext, type DictationState } from '../lib/dictation';
import type { Eligibility, PoolSentence } from '../lib/sentence-cards';

// The marked letters of one side, each as [letter, mark].
const marked = (segments: DictationSegment[]) => segments.filter((segment) => segment.mark).flatMap((segment) => [...segment.text].map((letter) => [letter, segment.mark]));

describe('judge', () => {
  test('marks exactly the missing letters, and an accent as a note', () => {
    const result = judge('Ils dine chez leur amis.', 'Ils dînent chez leurs amis.');
    expect(result.verdict).toBe('wrong');
    expect(marked(result.expected)).toEqual([['î', 'accent'], ['n', 'missing'], ['t', 'missing'], ['s', 'missing']]);
    expect(result.expected.map((segment) => segment.text).join('')).toBe('Ils dînent chez leurs amis.');
    expect(marked(result.given)).toEqual([]);
  });
  test('an extra letter is shown as extra, a wrong one on both sides', () => {
    const extra = judge('Elle mangee une pomme', 'Elle mange une pomme.');
    expect(marked(extra.given)).toEqual([['e', 'extra']]);
    expect(marked(extra.expected)).toEqual([]);
    const wrong = judge('Il a prit le train', 'Il a pris le train.');
    expect(marked(wrong.given)).toEqual([['t', 'extra']]);
    expect(marked(wrong.expected)).toEqual([['s', 'missing']]);
  });
  test('case, punctuation, apostrophes and spaces are set aside', () => {
    expect(judge("j' ai  vu L'homme", 'J’ai vu l’homme !').verdict).toBe('right');
    expect(judge('est ce que tu viens', 'Est-ce que tu viens ?').verdict).toBe('right');
    expect(judge('jai vu', 'J’ai vu.').verdict).toBe('wrong');
  });
  test('an answer wrong only in accents is right, with the accents noted', () => {
    const result = judge('Ils dinent a la maison', 'Ils dînent à la maison.');
    expect(result.verdict).toBe('accent');
    expect(marked(result.expected)).toEqual([['î', 'accent'], ['à', 'accent']]);
  });
});

describe('explain', () => {
  const why = (given: string, expected: string) => explain(expected, judge(given, expected).missed);
  test('names the -ent after ils and the plural -s', () => {
    expect(why('Ils dine chez leur amis.', 'Ils dînent chez leurs amis.')).toEqual([
      'dînent: after ils the verb ends in -ent, which is not heard.',
      'leurs: plural, so it ends in -s, which is not heard.',
    ]);
  });
  test('reaches the verb past object pronouns, and -nt after elles', () => {
    expect(why('Elles ne les voie pas.', 'Elles ne les voient pas.')).toEqual(['voient: after elles the verb ends in -ent, which is not heard.']);
    expect(why('Elles on faim.', 'Elles ont faim.')).toEqual(['ont: after elles the verb ends in -nt; the t is not heard.']);
  });
  test('a plural -x, a silent final consonant, a mute e', () => {
    expect(why('Les cheveu sont longs.', 'Les cheveux sont longs.')).toEqual(['cheveux: plural, so it ends in -x, which is not heard.']);
    expect(why('Il est peti.', 'Il est petit.')).toEqual(['petit: the final t is not heard.']);
    expect(why('Il fait beaucou.', 'Il fait beaucoup.')).toEqual(['beaucoup: the final p is not heard.']);
    expect(why('Mon ami est là.', 'Mon amie est là.')).toEqual(['amie: the final e is silent.']);
  });
  test('a missed letter that is heard gets no line', () => {
    expect(why('Il a pri le train.', 'Il a pris le train.')).toEqual(['pris: the final s is not heard.']);
    expect(why('Il a pis le train.', 'Il a pris le train.')).toEqual([]);
  });
});

const sentence = (id: string, extra: Partial<PoolSentence> = {}): PoolSentence => ({
  id, level: 'A1', fr: 'Je mange une pomme.', en: 'I eat an apple.', topics: [], words: [], gloss: [], tenses: ['pres'],
  audio: `audio/comprehension/${id}.mp3?v=2`, clip: `/clips/${id}.mp3`, ...extra,
});
const rules = (recorded: Set<string>, extra: Partial<Eligibility> = {}): Eligibility => ({ tenses: ['pres'], topicsOff: new Set(), met: new Set(), hear: true, recorded: (clip) => recorded.has(clip), ...extra });

describe('candidates', () => {
  test('only recorded sentences within the level and its word cap that pass Sentence cards’ rules', () => {
    const pool = [
      sentence('ok'), sentence('silent'),
      sentence('above', { level: 'B1' }), sentence('long', { fr: 'Un deux trois quatre cinq six sept huit neuf dix onze.' }),
      sentence('tense', { tenses: ['fut'] }), sentence('topic', { topics: ['negation'] }), sentence('words', { words: ['w1', 'w2'] }),
    ];
    const recorded = new Set(pool.filter((item) => item.id !== 'silent').map((item) => item.clip));
    const { items } = candidates(pool, 'A1', rules(recorded, { topicsOff: new Set(['negation']) }));
    expect(items.map((item) => item.id)).toEqual(['ok']);
    expect(candidates(pool, 'B1', rules(recorded, { topicsOff: new Set(['negation']) })).items.map((item) => item.id)).toEqual(['ok', 'above', 'long']);
  });
});

describe('picking', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => sentence(id));
  const pick = (states: Map<string, DictationState>, lastAnswered: Map<string, number>, sequence: number, now = 0, exclude: string[] = []) =>
    pickNext({ items, states, lastAnswered, sequence, now, exclude: new Set(exclude), vocabulary: [], level: 'A1' as GrammarLevel, random: () => 0.5 });
  test('a missed sentence comes back once 3 others are answered, and not before', () => {
    const states = new Map<string, DictationState>([['a', { missedAt: 1, dueAt: 1e15 }]]);
    const answered = new Map([['a', 1]]);
    for (const [sequence, id] of [[2, 'b'], [3, 'c']] as const) {
      answered.set(id, sequence);
      expect(pick(states, answered, sequence)?.item.id).not.toBe('a');
    }
    answered.set('d', 4);
    expect(pick(states, answered, 1 + AGAIN_AFTER)).toEqual({ item: items[0], again: true });
  });
  test('it returns again at the next study day, and a right answer then ends it', () => {
    const missedAt = new Date('2026-11-01T10:00:00');
    const missed = afterAnswer(null, false, 1, missedAt);
    expect(missed.missedAt).toBe(1);
    expect(new Date(missed.dueAt!).toString()).toBe(new Date('2026-11-02T04:00:00').toString());
    const once = afterAnswer(missed, true, 5, new Date('2026-11-01T10:05:00'));
    expect(once).toEqual({ missedAt: null, dueAt: missed.dueAt });
    const lastAnswered = new Map(['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => [id, index + 1]));
    expect(pick(new Map([['a', once]]), lastAnswered, 6, missed.dueAt! - 1)?.item.id).toBe('b');
    expect(pick(new Map([['a', once]]), lastAnswered, 6, missed.dueAt!)).toEqual({ item: items[0], again: true });
    expect(afterAnswer(once, true, 7, new Date(missed.dueAt! + 1000))).toEqual({ missedAt: null, dueAt: null });
  });
  test('fresh sentences before ones answered right, then the one answered longest ago', () => {
    const answered = new Map([['a', 3], ['b', 1]]);
    expect(answered.has(pick(new Map(), answered, 3)!.item.id)).toBe(false);
    const all = new Map(items.map((item, index) => [item.id, index + 10]));
    all.set('d', 2);
    expect(pick(new Map(), all, 20, 0, ['d'])?.item.id).toBe('a');
    expect(pick(new Map(), all, 20)?.item.id).toBe('d');
  });
});

describe('createDictation', () => {
  test('serves only eligible recorded sentences, keeps answers once per request, and brings a miss back after 3 others', () => {
    const dir = mkdtempSync(join(tmpdir(), 'echo-dictation-'));
    try {
      const pool = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => sentence(id, { fr: `Ils dînent chez leurs amis ${id}.` }));
      pool.push(sentence('silent'), sentence('later', { tenses: ['fut'] }));
      const recorded = new Set(pool.filter((item) => item.id !== 'silent').map((item) => item.clip));
      const vocabulary: ListeningWord[] = [];
      const dictation = createDictation({ dbPath: join(dir, 'echo.db'), pool: () => pool, vocabulary: () => vocabulary, rules: (tenses) => rules(recorded, { tenses }), level: () => 'A1', random: () => 0.3 });
      const seen: string[] = [];
      let missed = '';
      for (let turn = 0; turn < 6; turn++) {
        const { item } = dictation.next({ practising: { set: 'mine', verbIds: [], tenses: ['pres'] }, exclude: seen.slice(-1) });
        expect(item).not.toBeNull();
        expect(['silent', 'later']).not.toContain(item!.id);
        seen.push(item!.id);
        if (turn === 0) {
          missed = item!.id;
          const result = dictation.check({ requestId: 'r0', id: missed, given: 'Ils dine chez leur amis' });
          expect(result.verdict).toBe('wrong');
          expect(result.why).toHaveLength(2);
          // The same request sent again counts once.
          dictation.check({ requestId: 'r0', id: missed, given: 'anything' });
        } else dictation.check({ requestId: `r${turn}`, id: item!.id, given: `Ils dinent chez leurs amis ${item!.id}` });
      }
      expect(seen.indexOf(missed, 1)).toBe(4);
      expect(seen.filter((id) => id === missed)).toHaveLength(2);
      dictation.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
