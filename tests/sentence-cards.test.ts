import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ListeningWord } from '../contract';
import { createSentenceCards, eligible, GOT_IT_DAYS, schedule, type PoolSentence } from '../lib/sentence-cards';
import { cardProblems } from '../lib/text-topup';

const DAY = 86_400_000;
// 10 October 2026, 15:00 local: the study day began at 04:00 today.
const at = (day: number, hour = 15) => new Date(2026, 9, day, hour, 0, 0);
const fourAm = (day: number) => new Date(2026, 9, day, 4, 0, 0).getTime();

const sentence = (id: string, over: Partial<PoolSentence> = {}): PoolSentence => ({
  id, level: 'A1', fr: `${id}.`, en: id, topics: ['present-er'], words: ['w1'], gloss: [], tenses: ['pres'],
  audio: `audio/comprehension/${id}.mp3`, clip: `/clips/${id}.mp3`, ...over,
});
const word = (id: string, status: ListeningWord['status'], score = 0) => ({ id, status, score }) as unknown as ListeningWord;

describe('scheduling', () => {
  test('Not yet makes the sentence due at the start of the next study day, from any step', () => {
    expect(schedule(null, false, false, at(10))).toEqual({ step: 0, dueAt: fourAm(11) });
    expect(schedule({ step: 3, dueAt: 0 }, false, false, at(10))).toEqual({ step: 0, dueAt: fourAm(11) });
    // Before 04:00 the study day is still yesterday's, so tomorrow is today at 04:00.
    expect(schedule(null, false, false, at(11, 2))).toEqual({ step: 0, dueAt: fourAm(11) });
  });

  test('Got it climbs GOT_IT_DAYS from the start of today and stays on its last step', () => {
    let state = schedule(null, true, false, at(10));
    expect(state).toEqual({ step: 1, dueAt: fourAm(10) + GOT_IT_DAYS[0]! * DAY });
    const seen: number[] = [];
    for (let n = 0; n < 6; n++) { state = schedule(state, true, false, at(10)); seen.push(Math.round((state!.dueAt - fourAm(10)) / DAY)); }
    expect(GOT_IT_DAYS).toEqual([3, 8, 20, 45, 90]);
    expect(seen).toEqual([8, 20, 45, 90, 90, 90]);
  });

  test('the once-more pass after a Not yet changes nothing: the sentence still comes back tomorrow', () => {
    const missed = schedule(null, false, false, at(10));
    expect(schedule(missed, true, true, at(10))).toEqual(missed);
    expect(schedule(missed, false, true, at(10))).toEqual(missed);
  });
});

describe('eligibility', () => {
  const rules = { tenses: ['pres', 'pc'] as const, topicsOff: new Set<string>(), met: new Set(['w1', 'w2']), hear: false, recorded: () => true };
  test('every tense in the sentence must be on the line, and other never is', () => {
    const pool = [sentence('a'), sentence('b', { tenses: ['pres', 'pc'] }), sentence('c', { tenses: ['pc', 'imp'] }), sentence('d', { tenses: ['other'] }), sentence('e', { tenses: [] })];
    expect(eligible(pool, rules).items.map((entry) => entry.id)).toEqual(['a', 'b', 'e']);
  });
  test('a topic switched off leaves out every sentence tagged with it', () => {
    const pool = [sentence('a', { topics: ['negation', 'present-er'] }), sentence('b')];
    expect(eligible(pool, { ...rules, topicsOff: new Set(['negation']) }).items.map((entry) => entry.id)).toEqual(['b']);
  });
  test('at most one deck word the learner has not met', () => {
    const pool = [sentence('a', { words: ['w1', 'new1'] }), sentence('b', { words: ['new1', 'new2'] }), sentence('c', { words: ['w1', 'w2'] })];
    expect(eligible(pool, rules).items.map((entry) => entry.id)).toEqual(['a', 'c']);
  });
  test('Hear needs a recording; Read does not', () => {
    const pool = [sentence('a'), sentence('b')];
    const recorded = (clip: string) => clip.endsWith('/a.mp3');
    expect(eligible(pool, { ...rules, hear: true, recorded }).items.map((entry) => entry.id)).toEqual(['a']);
    expect(eligible(pool, { ...rules, hear: false, recorded }).items.map((entry) => entry.id)).toEqual(['a', 'b']);
  });
  test('an empty room says which filter emptied it', () => {
    expect(eligible([sentence('a', { tenses: ['fut'] })], rules).reason).toBe('tenses');
    expect(eligible([sentence('a', { topics: ['negation'] })], { ...rules, topicsOff: new Set(['negation']) }).reason).toBe('topics');
    expect(eligible([sentence('a', { words: ['x', 'y'] })], rules).reason).toBe('words');
    expect(eligible([sentence('a')], { ...rules, hear: true, recorded: () => false }).reason).toBe('recordings');
  });
});

describe('the room', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  function room(pool: PoolSentence[], now: { value: Date }, words = [word('w1', 'scheduled'), word('w2', 'due', -3)]) {
    const dir = mkdtempSync(join(tmpdir(), 'echo-sentences-')); dirs.push(dir);
    return createSentenceCards({
      dbPath: join(dir, 'echo.db'), pool: () => pool, vocabulary: () => words, recorded: () => true,
      topics: () => [{ id: 'present-er', title: 'Regular -er verbs' }, { id: 'negation', title: 'Negation' }], now: () => now.value, random: () => 0.5,
    });
  }
  const line = (tenses: string[]) => ({ set: 'mine', verbIds: [], tenses });

  test('due sentences come first, then new ones, those holding due or shaky words first; marked ones wait their turn', () => {
    const now = { value: at(10) };
    const cards = room([sentence('a'), sentence('b', { words: ['w2'] }), sentence('c')], now);
    expect(cards.round({ practising: line(['pres']), mode: 'read' }).items.map((card) => card.id)).toEqual(['b', 'a', 'c']);
    cards.mark({ requestId: 'r1', id: 'c', knew: false });
    cards.mark({ requestId: 'r2', id: 'a', knew: true });
    expect(cards.round({ practising: line(['pres']), mode: 'read' }).items.map((card) => card.id)).toEqual(['b']);
    now.value = at(11);
    const next = cards.round({ practising: line(['pres']), mode: 'read' });
    expect(next.items.map((card) => [card.id, card.due])).toEqual([['c', true], ['b', false]]);
    now.value = at(13);
    expect(cards.round({ practising: line(['pres']), mode: 'read' }).items.map((card) => card.id)).toEqual(['c', 'a', 'b']);
  });

  test('a mark sent twice with one request id counts once', () => {
    const now = { value: at(10) };
    const cards = room([sentence('a')], now);
    cards.mark({ requestId: 'same', id: 'a', knew: true });
    cards.mark({ requestId: 'same', id: 'a', knew: true });
    now.value = at(13);
    // One Got it: due after 3 days (twice would have been 8).
    expect(cards.round({ practising: line(['pres']), mode: 'read' }).items.map((card) => card.id)).toEqual(['a']);
  });

  test('the line is remembered for rounds that send none, and an empty room says why', () => {
    const now = { value: at(10) };
    const cards = room([sentence('a', { tenses: ['pc'] })], now);
    expect(cards.round({ practising: line(['pres']), mode: 'read' })).toMatchObject({ items: [], empty: 'tenses' });
    expect(cards.round({ practising: line(['pres', 'pc']), mode: 'read' }).items).toHaveLength(1);
    expect(cards.round({ mode: 'read' }).tenses).toEqual(['pres', 'pc']);
    expect(cards.stock()).toEqual({ unseen: 1, tenses: ['pres', 'pc'] });
  });

  test('topics are all on until switched off', () => {
    const now = { value: at(10) };
    const cards = room([sentence('a', { topics: ['negation'] }), sentence('b')], now);
    expect(cards.options().topics.map((topic) => topic.on)).toEqual([true, true]);
    cards.setTopic({ topic: 'negation', on: false });
    expect(cards.round({ practising: line(['pres']), mode: 'read' }).items.map((card) => card.id)).toEqual(['b']);
  });

  test('every topic switches off and back on together', () => {
    const now = { value: at(10) };
    const cards = room([sentence('a', { topics: ['negation'] }), sentence('b', { topics: ['present-er'] })], now);
    expect(cards.setTopic({ topic: '*', on: false }).topics.map((topic) => topic.on)).toEqual([false, false]);
    expect(cards.round({ practising: line(['pres']), mode: 'read' }).items).toEqual([]);
    cards.setTopic({ topic: 'negation', on: true });
    expect(cards.setTopic({ topic: '*', on: true }).topics.map((topic) => topic.on)).toEqual([true, true]);
    expect(cards.round({ practising: line(['pres']), mode: 'read' }).items.map((card) => card.id).sort()).toEqual(['a', 'b']);
  });
});

describe('written cards', () => {
  const target = { tenses: ['pres'] as ('pres')[], words: [{ id: 'w1', fr: 'manger' }] };
  const card = (over: object) => ({ id: 'sc-x-s01', level: 'A1' as const, fr: 'Je mange.', en: 'I eat.', topics: [], words: ['w1'], gloss: [], tenses: ['pres' as const], ...over });
  test('a tense off the target, two unmet deck words or a sentence Echo has already are sent back', () => {
    expect(cardProblems(card({}), target, new Set())).toEqual([]);
    expect(cardProblems(card({ tenses: ['pres', 'pc'] }), target, new Set())[0]).toContain('passé composé');
    expect(cardProblems(card({ tenses: ['other'] }), target, new Set())[0]).toContain('conditional');
    expect(cardProblems(card({ words: ['w1', 'n1', 'n2'] }), target, new Set())[0]).toContain('at most one');
    expect(cardProblems(card({ words: ['w1', 'n1'] }), target, new Set())).toEqual([]);
    expect(cardProblems(card({}), target, new Set(['je mange']))[0]).toContain('already');
  });
});
