import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSounds, soundProblems, type SoundContrast, type SoundsContent } from '../lib/sounds';
import { StoreError } from '../lib/store';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function contrast(id: string, count = 8): SoundContrast {
  return {
    id, title: id, level: 'A1', labels: ['le', 'les'], listen: 'Listen to the little word.',
    items: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}`, a: { fr: `le mot ${index}`, en: `the word ${index}` }, b: { fr: `les mots ${index}`, en: `the words ${index}` } })),
  };
}
function sounds(content: SoundsContent, clipExists: (id: string) => boolean = () => true) {
  const directory = mkdtempSync(join(tmpdir(), 'echo-sounds-'));
  directories.push(directory);
  return createSounds(content, { dbPath: join(directory, 'echo.db'), clipExists, random: () => 0.5 });
}

describe('sound content', () => {
  test('accepts well-formed content', () => {
    expect(soundProblems({ contrasts: [contrast('le-les'), contrast('un-une')] })).toEqual([]);
  });

  test('reports identical sides, straight apostrophes, bad counts and duplicate ids', () => {
    const bad = contrast('le-les', 7);
    bad.items[0]!.b = { ...bad.items[0]!.a };
    bad.items[1]!.a = { fr: "l'ami", en: 'the friend' };
    bad.items[2]!.id = bad.items[3]!.id;
    const problems = soundProblems({ contrasts: [bad] });
    expect(problems.some((problem) => problem.includes('8 to 12'))).toBe(true);
    expect(problems.some((problem) => problem.includes('the same'))).toBe(true);
    expect(problems.some((problem) => problem.includes('’'))).toBe(true);
    expect(problems.some((problem) => problem.includes('unique'))).toBe(true);
  });
});

describe('sound drills', () => {
  test('a round offers only pairs with both sides recorded, and says when none are', () => {
    const drill = sounds({ contrasts: [contrast('le-les')] }, (id) => !id.startsWith('le-les-0') && id !== 'le-les-1-b');
    const round = drill.round('le-les');
    expect(round.map((question) => question.itemId).sort()).toEqual(['le-les-2', 'le-les-3', 'le-les-4', 'le-les-5', 'le-les-6', 'le-les-7']);
    expect(round.every((question) => question.audio === `audio/sounds/${question.itemId}-${question.side}.mp3`)).toBe(true);
    expect(drill.summary()[0]!.ready).toBe(6);
    const empty = sounds({ contrasts: [contrast('le-les')] }, () => false);
    expect(() => empty.round('le-les')).toThrow(StoreError);
  });

  test('pairs missed before come first', () => {
    const drill = sounds({ contrasts: [contrast('le-les', 12)] });
    drill.answer({ itemId: 'le-les-11', heard: 'a', chose: 'b', requestId: 'r1' });
    drill.answer({ itemId: 'le-les-11', heard: 'b', chose: 'a', requestId: 'r2' });
    drill.answer({ itemId: 'le-les-4', heard: 'a', chose: 'a', requestId: 'r3' });
    const round = drill.round('le-les');
    expect(round).toHaveLength(10);
    expect(round.map((question) => question.itemId)).toContain('le-les-11');
    expect(round.map((question) => question.itemId)).not.toContain('le-les-4');
  });

  test('an answer is kept once per request and counted in the record', () => {
    const drill = sounds({ contrasts: [contrast('le-les'), contrast('un-une')] });
    drill.answer({ itemId: 'le-les-1', heard: 'a', chose: 'a', requestId: 'same' });
    const record = drill.answer({ itemId: 'le-les-1', heard: 'a', chose: 'a', requestId: 'same' });
    expect(record.recent).toEqual({ right: 1, total: 1 });
    drill.answer({ itemId: 'le-les-2', heard: 'a', chose: 'b', requestId: 'other' });
    expect(drill.summary().map((entry) => entry.recent)).toEqual([{ right: 1, total: 2 }, { right: 0, total: 0 }]);
    expect(() => drill.answer({ itemId: 'nope', heard: 'a', chose: 'a', requestId: 'x' })).toThrow(StoreError);
  });

  test('the mix draws from every contrast', () => {
    const drill = sounds({ contrasts: [contrast('le-les'), contrast('un-une')] });
    const round = drill.round('mix');
    expect(new Set(round.map((question) => question.contrastId))).toEqual(new Set(['le-les', 'un-une']));
    expect(() => drill.round('missing')).toThrow(StoreError);
  });
});
