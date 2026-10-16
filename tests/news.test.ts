import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNews, heardWords, KEEP, lineStarts, LIST_URL, parseEditionPage, parseStories, sentencesOf, type HeardWord } from '../lib/news';

// A real edition's page (7 October 2026), trimmed to a few paragraphs of its transcript and two of its players.
const PAGE = await Bun.file(join(import.meta.dir, 'fixtures/rfi-journal-20261007.html')).text();
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('the transcript on an edition page', () => {
  const page = parseEditionPage(PAGE, '20261007');

  test('takes this edition’s recording, not the other editions the page plays', () => {
    expect(page.mp3).toBe('https://aod-fle.akamaized.net/rfi/francais/audio/jff/202610/journal_francais_facile_16h00_-_16h10_gmt_20261007.mp3');
    expect(parseEditionPage(PAGE, '20261008').mp3).toBeNull();
    expect(page.title).toBe('7-Octobre: trois ans de traumatismes pour Gaza / Soupçon de peste en Russie / France: le mouvement lycéen persiste / Auditrice du JFF');
  });

  test('keeps each paragraph as a stanza of its sentences, entities decoded and spacing single', () => {
    expect(page.stanzas).toHaveLength(14);
    expect(page.stanzas[0]).toEqual(['Bonjour à toutes et à tous.', 'À l\'écoute de RFI en direct de Paris, il est 18 heures.']);
    expect(page.stanzas[6]).toEqual(['Une date qui réveille de douloureux souvenirs.', 'Il y a trois ans, en Israël, le Hamas massacre une partie de la population.', 'Depuis, l\'armée israélienne s\'est largement vengée.', 'Nous sommes à Gaza dans un instant.']);
    // A quotation's closing guillemet stays with its last sentence.
    expect(page.stanzas[10]).toEqual(['« Ce quartier était très peuplé, très animé avant.', 'Aujourd\'hui, c\'est vraiment très calme.', 'On appelle cette zone le Bloc 3. »']);
    for (const line of page.stanzas.flat()) {
      expect(line).toBe(line.trim());
      expect(line).not.toMatch(/\s{2}|&#?\w+;|<|>/);
    }
  });

  test('does not end a sentence at an initial', () => {
    expect(sentencesOf('Selon M. Dupont, J.-L. Martin arrive. Il parle à 18 h. Oui ! « Bien. » Fin…')).toEqual(['Selon M. Dupont, J.-L. Martin arrive.', 'Il parle à 18 h.', 'Oui !', '« Bien. »', 'Fin…']);
  });
});

describe('line times', () => {
  // Whisper's words for some lines, a word every half second from `at`.
  const said = (text: string, at: number): HeardWord[] => text.split(' ').map((word, index) => ({ text: word, at: at + index * 0.5 }));

  test('start each line where its first word was heard, always later than the line before', () => {
    const lines = ['Bonjour à toutes et à tous.', 'Le Journal en français facile.', 'Nous sommes le 7 octobre.'];
    const starts = lineStarts(lines, [...said('Bonjour à toutes et à tous.', 9), ...said('Le Journal en français facile.', 13), ...said('Nous sommes le 7 octobre.', 20)]);
    expect(starts).toEqual([8.7, 12.7, 19.7]);
  });

  test('give a line Whisper heard differently a time from its neighbours', () => {
    const lines = ['Il y a trois ans, en Israël, le Hamas massacre une partie de la population.', 'Au moins 74 000 morts.', 'L\'armée israélienne occupe 60 % du territoire palestinien.'];
    const heard = [...said('Il y a trois ans, en Israël, le Hamas massacre une partie de la population.', 30), ...said('Soixante-quatorze mille victimes.', 37), ...said('L\'armée israélienne occupe 60 % du territoire palestinien.', 40)];
    const starts = lineStarts(lines, heard);
    expect(starts[1]).toBeGreaterThan(starts[0]! + 5);
    expect(starts[1]).toBeLessThan(starts[2]!);
    expect(starts[2]).toBe(39.7);
  });

  test('stay increasing when lines share their words or are not heard at all', () => {
    const lines = ['Le Journal en français facile.', 'RFI.', 'À Paris, 18 h 06.', 'Le Journal en français facile.'];
    const starts = lineStarts(lines, said('Le Journal en français facile. Le Journal en français facile.', 2));
    for (let index = 1; index < starts.length; index++) expect(starts[index]).toBeGreaterThan(starts[index - 1]!);
  });

  test('refuse a recording that is not the transcript', () => {
    expect(() => lineStarts(['Nous sommes le 7 octobre.', 'Le gouvernement est sous pression.'], said('Hello and welcome to the news from London tonight.', 0))).toThrow(/heard too little/);
  });

  test('read Whisper’s words whole when an accented letter is split across tokens', () => {
    // The bytes of "été" (c3 a9 74 c3 a9), as whisper.cpp writes them read as latin1, cut inside each é.
    const tokens = [{ text: ' \u00c3', t_dtw: 412, offsets: { from: 4000 } }, { text: '\u00a9t\u00c3', t_dtw: 418, offsets: { from: 4100 } }, { text: '\u00a9', t_dtw: 420, offsets: { from: 4200 } }, { text: ' tu\u00c3\u00a9es', t_dtw: 430, offsets: { from: 4300 } }, { text: '.', t_dtw: 440, offsets: { from: 4400 } }];
    expect(heardWords({ transcription: [{ tokens: [{ text: '[_BEG_]', t_dtw: -1, offsets: { from: 0 } }, ...tokens] }] })).toEqual([{ text: 'été', at: 4.12 }, { text: 'tuées.', at: 4.3 }]);
  });
});

describe('the editions kept', () => {
  function setup(dates: string[], fail: { page?: boolean; transcribe?: number } = {}, stories: () => Promise<string> = async () => '{"stories": [{"line": 2, "title": "Ukraine"}]}') {
    const root = mkdtempSync(join(tmpdir(), 'echo-news-'));
    directories.push(root);
    const dir = join(root, 'news'), audioDir = join(root, 'audio');
    const list = dates.map((date) => `<a href="/fr/podcasts/journal-en-fran%C3%A7ais-facile/${date}-les-titres">${date}</a>`).join('\n');
    let transcribeFailures = fail.transcribe ?? 0;
    const lines = parseEditionPage(PAGE, '20261007').stanzas.flat();
    const news = createNews({
      dir, audioDir,
      ask: async (prompt) => prompt.includes('Mark the line where each news story starts') ? stories() : '{"lines": []}',
      fetchText: async (url) => {
        if (url === LIST_URL) return list;
        if (fail.page) throw new Error('RFI answered 503.');
        return PAGE;
      },
      download: async (_url, file) => writeFileSync(file, 'mp3'),
      // News first looked before every edition these tests list.
      now: () => new Date('2026-08-01T12:00:00'),
      transcribe: async () => {
        if (transcribeFailures-- > 0) throw new Error('Whisper could not listen to the recording (no model).');
        return lines.flatMap((line, index) => line.split(' ').map((word, at) => ({ text: word, at: index * 10 + at * 0.4 })));
      },
    });
    return { news, dir, audioDir, lines };
  }

  test('are the latest 14, older ones going with their recordings', async () => {
    const listed = Array.from({ length: 16 }, (_, index) => `202609${String(index + 1).padStart(2, '0')}`);
    const { news, dir, audioDir } = setup(listed, { page: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '20260801.json'), JSON.stringify({ date: '20260801', page: '', title: 'Old', mp3: null, stanzas: null, starts: null, notes: null, failure: null }));
    writeFileSync(join(audioDir, '20260801.mp3'), 'mp3');
    await news.check();
    const kept = listed.slice(-KEEP).reverse();
    expect(news.list().editions.map((edition) => edition.date)).toEqual(kept);
    expect(readdirSync(dir).sort()).toEqual([...kept.map((date) => `${date}.json`), 'since'].sort());
    expect(existsSync(join(audioDir, '20260801.mp3'))).toBe(false);
  });

  test('show a failed step with its reason, and try it again at the next check', async () => {
    const { news } = setup(['20261007'], { transcribe: 1 });
    await news.check();
    const failed = news.view('20261007');
    expect(failed).toMatchObject({ status: 'failed', step: 'timing', error: 'Whisper could not listen to the recording (no model).', audio: 'api/news/20261007.mp3', starts: null, noted: false });
    expect(failed.stanzas.flat()[0]).toEqual({ fr: 'Bonjour à toutes et à tous.', en: null, words: [] });
    await news.check();
    const ready = news.view('20261007');
    expect(ready).toMatchObject({ status: 'ready', step: null, error: null, noted: true });
    expect(ready.starts).toHaveLength(ready.stanzas.flat().length);
  });

  test('start on the day News first looks: earlier editions are not fetched, and only prepared ones stay', async () => {
    const root = mkdtempSync(join(tmpdir(), 'echo-news-'));
    directories.push(root);
    const dir = join(root, 'news'), audioDir = join(root, 'audio');
    const listed = ['20261005', '20261007', '20261008', '20261009'];
    const make = (today: string) => createNews({
      dir, audioDir, ask: async () => '{"lines": []}', now: () => new Date(`${today}T12:00:00`),
      fetchText: async (url) => url === LIST_URL ? listed.map((date) => `<a href="/fr/podcasts/journal-en-fran%C3%A7ais-facile/${date}-les-titres">${date}</a>`).join('\n') : PAGE,
      download: async (_url, file) => writeFileSync(file, 'mp3'),
      transcribe: async () => [],
    });
    mkdirSync(dir, { recursive: true });
    mkdirSync(audioDir, { recursive: true });
    const prepared = { date: '20261006', page: '', title: 'Prepared', mp3: 'x.mp3', stanzas: [['Bonjour.']], starts: [0], notes: [[{ fr: 'Bonjour.', en: 'Hello.', words: [] }]], failure: null };
    writeFileSync(join(dir, '20261006.json'), JSON.stringify(prepared));
    writeFileSync(join(audioDir, '20261006.mp3'), 'mp3');
    writeFileSync(join(dir, '20261005.json'), JSON.stringify({ ...prepared, date: '20261005', starts: null, notes: null }));
    expect(make('2026-10-08').list().editions.map((edition) => edition.date)).toEqual(['20261006']);
    // A later start keeps the first day.
    const later = make('2026-10-20');
    await later.check();
    expect(later.list().editions.map((edition) => edition.date)).toEqual(['20261009', '20261008', '20261006']);
    expect(readdirSync(dir).sort()).toEqual(['20261006.json', '20261008.json', '20261009.json', 'since']);
  });

  test('a reply with no story leaves the edition without headings, not asked again', async () => {
    let asked = 0;
    const { news } = setup(['20261007'], {}, async () => { asked++; return 'Sorry.'; });
    await news.check();
    await news.check();
    expect(news.view('20261007')).toMatchObject({ status: 'ready', stories: [] });
    expect(asked).toBe(1);
  });

  test('show how far each was played: the line reached, or finished', async () => {
    const { news, lines } = setup(['20261007']);
    await news.check();
    expect(news.list().editions[0]).toMatchObject({ lines: lines.length, progress: null });
    news.setProgress('20261007', { line: 2 });
    expect(news.list().editions[0]!.progress).toEqual({ line: 2, finished: false });
    news.setProgress('20261007', { line: lines.length - 1, finished: true });
    expect(news.view('20261007').progress).toEqual({ line: lines.length - 1, finished: true });
    expect(() => news.setProgress('20261007', { line: lines.length })).toThrow('Say which line');
    expect(() => news.setProgress('20261007', { line: 1, finished: 'yes' })).toThrow('Say whether');
    expect(() => news.setProgress('20260101', { line: 0 })).toThrow('not in Echo');
  });

  test('forget how far an edition no longer kept was played', async () => {
    const listed = Array.from({ length: 16 }, (_, index) => `202609${String(index + 1).padStart(2, '0')}`);
    const { news, dir } = setup(listed, { page: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'progress.json'), JSON.stringify({ '20260901': { line: 3, finished: false }, '20260916': { line: 1, finished: true } }));
    await news.check();
    expect(JSON.parse(await Bun.file(join(dir, 'progress.json')).text())).toEqual({ '20260916': { line: 1, finished: true } });
  });
});

describe('the stories in an edition', () => {
  test('keep only lines of the edition, in order, with short titles; a headline leads to one story at most', () => {
    const reply = `Here they are: {"stories": [
      {"line": 3, "title": "Ukraine", "headline": 1}, {"line": 2, "title": "Earlier"}, {"line": 5, "title": "  Ebola en RDC ", "headline": 1},
      {"line": 11, "title": "Beyond the end"}, {"line": 7, "title": "${'x'.repeat(61)}"}, {"line": 8, "title": "Yémen", "headline": 3}]}`;
    expect(parseStories(reply, 10, 2)).toEqual([{ line: 2, title: 'Ukraine', headline: 0 }, { line: 4, title: 'Ebola en RDC' }, { line: 7, title: 'Yémen' }]);
    expect(parseStories('no JSON here', 10, 2)).toEqual([]);
  });

  test('are marked after the notes and never hold an edition back: it is ready while Claude is out of reach', async () => {
    const root = mkdtempSync(join(tmpdir(), 'echo-news-'));
    directories.push(root);
    let reachable = false;
    let asked = 0;
    const lines = parseEditionPage(PAGE, '20261007').stanzas.flat();
    const news = createNews({
      dir: join(root, 'news'), audioDir: join(root, 'audio'), now: () => new Date('2026-08-01T12:00:00'),
      ask: async (prompt) => {
        if (!prompt.includes('Mark the line where each news story starts')) return '{"lines": []}';
        asked++;
        if (!reachable) throw new Error('Claude could not be reached.');
        return '{"stories": [{"line": 2, "title": "Ukraine"}]}';
      },
      fetchText: async (url) => url === LIST_URL ? '<a href="/fr/podcasts/journal-en-fran%C3%A7ais-facile/20261007-les-titres">x</a>' : PAGE,
      download: async (_url, file) => writeFileSync(file, 'mp3'),
      transcribe: async () => lines.flatMap((line, index) => line.split(' ').map((word, at) => ({ text: word, at: index * 10 + at * 0.4 }))),
    });
    await news.check();
    expect(news.view('20261007')).toMatchObject({ status: 'ready', error: null, stories: [] });
    reachable = true;
    await news.check();
    expect(news.view('20261007').stories).toEqual([{ line: 1, title: 'Ukraine' }]);
    await news.check();
    expect(asked).toBe(2);
  });
});
