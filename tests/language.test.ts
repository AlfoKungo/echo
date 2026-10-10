import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { currentLanguage, languagePage, languages, ROOMS } from '../lib/language';
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
    expect(language.rooms).toEqual(['practise', 'words', 'grammar', 'statistics', 'listen', 'read', 'verbs']);
    expect(language.claude).toBe(false);
  }
  expect([pt.port, sv.port]).toEqual([7795, 7796]);
  const moved = languages(root, { ECHO_LANGUAGE_PORTS: 'pt:7885,sv:7886' });
  expect([moved.pt.port, moved.sv.port]).toEqual([7885, 7886]);
});

test('an unknown ECHO_LANG stops the server rather than teach French under another name', () => {
  expect(() => currentLanguage(root, { ECHO_LANG: 'de' })).toThrow('ECHO_LANG must be one of fr, pt, sv');
});

test('the page names the language: French’s is served as written; another’s How it works speaks of it and its noun colours', async () => {
  const page = await Bun.file(join(import.meta.dir, '..', 'static', 'index.html')).text();
  const { fr, pt, sv } = languages(root, {});
  expect(languagePage(page, fr)).toBe(page);
  expect([pt.tag, sv.tag, fr.tag]).toEqual(['pt-BR', 'sv', 'fr']);
  const portuguese = languagePage(page, pt);
  expect(portuguese).toContain('<title>Echo · Portuguese practice</title>');
  expect(portuguese).toContain('(Portuguese → English), is how you practise the card. <strong>Read</strong> shows the Portuguese.');
  expect(portuguese).toContain('<strong>Say the Portuguese when a card turns</strong>');
  expect(portuguese).toContain('<p><strong>Colours.</strong> Nouns are coloured by gender — blue for masculine, pink for feminine — wherever Echo shows Portuguese (switch it off in Words options, •••).</p>');
  expect(portuguese).toContain('<p data-room="families"><strong>Word families</strong>');
  expect(portuguese).toContain('with <span data-room="families">Word families, Word building and </span>More for today at the top');
  expect(portuguese).not.toContain('Colours and hooks');
  expect(portuguese).toContain('<strong>Grammar.</strong> Its units take you through A1 and A2.');
  expect(portuguese).toContain('reads the correct Portuguese aloud');
  expect(languagePage(page, sv)).toContain('Nouns are coloured by gender — green for en-words, orange for ett-words — wherever Echo shows Swedish');
  expect(portuguese).toContain('<strong>Listen</strong> plays Portuguese and asks what you understood<span data-room="sounds">, trains your ear on twin sounds</span><span data-room="sentencetape">, and has a sentence tape</span>');
  expect(portuguese).toContain('<strong>Read</strong> shows Portuguese and asks the same');
  expect(portuguese).toContain('chosen for you from graded Portuguese — single sentences, short dialogues and short texts, A1 and A2.');
  expect(portuguese).toContain('The Portuguese stays hidden until you answer.');
  expect(portuguese).toContain('<p data-room="sounds"><strong>Sounds</strong>');
  expect(portuguese).toContain('<p data-room="sentencetape"><strong>Tape</strong> (in Listen');
  // Practise's How it works names Write it, and French, only inside the write room's span, which the app drops.
  const practise = /<div data-info="practise">[^]*?<\/div>/.exec(portuguese)![0].replace(/<span data-room="write">[^<]*<\/span>/, '');
  expect(practise).toContain('a comprehension question, a vocabulary card, another comprehension question, a grammar question');
  expect(practise).not.toMatch(/Write it|French/);
  // Verbs' How it works speaks of the language's own verbs, never French's tenses.
  expect(portuguese).toContain('as Brazil speaks: eu, você / ele / ela, nós and vocês / eles / elas');
  expect(portuguese).not.toContain('passé composé, imparfait, futur');
  expect(languagePage(page, sv)).toContain('drills Swedish verbs by their key forms');
  expect(() => languagePage(page.replace('<strong>Read · Listen', '<strong>Read'), pt)).toThrow('no longer has the passage');
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
