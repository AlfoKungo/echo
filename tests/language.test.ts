import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { currentLanguage, languages, ROOMS } from '../lib/language';
import { createLanguageHost } from '../lib/languages';

const root = '/echo';

test('French reads and records exactly where it always has, with every room and Claude', () => {
  const french = currentLanguage(root, {});
  expect(french.code).toBe('fr');
  expect(french.content).toBe(join(root, 'content'));
  expect(french.audio).toBe(join(root, 'audio'));
  expect(french.tts).toEqual({ script: 'scripts/render-audio.py', args: [] });
  expect(french.rooms).toEqual(ROOMS);
  expect(french.claude).toBe(true);
});

test('Portuguese and Swedish keep their own content, recordings and recorder, and only the rooms they have content for', () => {
  const { pt, sv } = languages(root, {});
  expect([pt.content, pt.audio, pt.textKey]).toEqual([join(root, 'content/pt'), join(root, 'audio/pt'), 'pt']);
  expect(pt.tts).toEqual({ script: 'scripts/render-audio.py', args: ['--lang', 'pt'] });
  expect([sv.content, sv.audio, sv.textKey]).toEqual([join(root, 'content/sv'), join(root, 'audio/sv'), 'sv']);
  expect(sv.tts).toEqual({ script: 'scripts/render-audio-sv.py', args: [] });
  for (const language of [pt, sv]) {
    expect(language.rooms).toEqual(['words', 'statistics']);
    expect(language.claude).toBe(false);
  }
  expect([pt.port, sv.port]).toEqual([7795, 7796]);
  const moved = languages(root, { ECHO_LANGUAGE_PORTS: 'pt:7885,sv:7886' });
  expect([moved.pt.port, moved.sv.port]).toEqual([7885, 7886]);
});

test('an unknown ECHO_LANG stops the server rather than teach French under another name', () => {
  expect(() => currentLanguage(root, { ECHO_LANG: 'de' })).toThrow('ECHO_LANG must be one of fr, pt, sv');
});

test('the French Echo passes on only its languages\' paths, and sends a bare /pt to /pt/', async () => {
  const all = languages(root, {});
  const host = createLanguageHost({ french: all.fr, others: [all.pt, all.sv], data: '/nowhere', origin: 'http://127.0.0.1' });
  const get = (path: string) => host.handle(new Request(`http://127.0.0.1/echo${path}`), path);
  expect(await get('/api/state')).toBeNull();
  expect(await get('/de/')).toBeNull();
  expect(await get('/pt')).toMatchObject({ status: 308 });
  expect((await get('/pt'))!.headers.get('location')).toBe('pt/');
  expect(host.status().map((entry) => [entry.code, entry.state])).toEqual([['fr', 'here'], ['pt', 'down'], ['sv', 'down']]);
});
