'use strict';

const main = document.querySelector('#main');
const aboutDialog = document.querySelector('#about-dialog');
const dialog = document.querySelector('#dialog');
const homeButton = document.querySelector('#home-button');
// Rooms this Echo leaves out, from the page (ECHO_ROOMS_OFF on the server).
const roomsOff = new Set((document.body.dataset.roomsOff || '').split(',').filter(Boolean));
const speaker = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const checkIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const crossIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 6.5 11 11m0-11-11 11"/></svg>';
const familyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5.5" r="2.5"/><circle cx="5.5" cy="18" r="2.5"/><circle cx="18.5" cy="18" r="2.5"/><path d="M11 7.8 6.6 15.8M13 7.8l4.4 8M8 18h8"/></svg>';
const infoIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.4"/></svg>';
const searchIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
// French sets a space before ? ! : ; and inside « »; a no-break space keeps the mark on its word's line.
const frEsc = (value) => esc(String(value ?? '').replace(/ ([?!:;»])/g, '\u00a0$1').replace(/« /g, '«\u00a0'));
const formatCount = new Intl.NumberFormat('en').format;
// The language switch (lib/language.ts): this page's language and every language's own name, from the page. Each
// language's Echo is its own app on this one origin, so everything it keeps on this device is under its own keys;
// only the theme and the last language opened belong to the device. French keeps the keys it always had.
const language = document.body.dataset.lang || 'fr';
// The BCP-47 tag on the learnt language's text (lang="pt-BR"): the page's data-lang-tag where it differs from the code.
const languageTag = document.body.dataset.langTag || language;
const languageNames = Object.fromEntries((document.body.dataset.languages || '').split(',').filter(Boolean).map((entry) => entry.split(':')));
const PER_DEVICE = ['echo.theme', 'echo.language'];
const localKey = (key) => language === 'fr' || PER_DEVICE.includes(key) ? key : key.replace(/^echo\./, `echo.${language}.`);
// French is at the root of Echo, every other language one folder down (/echo/pt/).
const echoRoot = language === 'fr' ? './' : '../';
const readPreference = (key, fallback) => { try { return localStorage.getItem(localKey(key)) || fallback; } catch { return fallback; } };
const savePreference = (key, value) => { try { localStorage.setItem(localKey(key), value); } catch { /* Progress is server-owned; local preferences are optional. */ } };
// A French start on its way to another language (index.html) leaves the last language as it is.
if (Object.keys(languageNames).length && !document.documentElement.dataset.leaving) savePreference('echo.language', language);
// Theme: Dusk (the default) or Paper, remembered on this device; index.html applies it before the first paint.
const THEME_COLOURS = { dusk: '#0e0d16', paper: '#f6f2eb' };
function applyTheme(theme) {
  if (theme === 'paper') document.documentElement.dataset.theme = 'paper'; else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEME_COLOURS[theme]);
  for (const choice of document.querySelectorAll('[data-theme-choice]')) choice.setAttribute('aria-pressed', String(choice.dataset.themeChoice === theme));
}
applyTheme(readPreference('echo.theme', 'dusk') === 'paper' ? 'paper' : 'dusk');
let direction = readPreference('echo.direction', 'fr-en') === 'en-fr' ? 'en-fr' : 'fr-en';
let deck = readPreference('echo.deck', 'all');
let speed = readPreference('echo.speed', '1') === '0.8' ? 0.8 : 1;
// Say the French when a card turns: for cards you turn yourself in Read, and in English → French.
let audioMode = readPreference('echo.audio-mode', 'off') === 'on';
// How a Words card is practised, in French → English: Read (see the French), Listen (hear it, hidden until it
// turns) or Speak (see and hear it, then say the English aloud; Echo checks it and turns and grades the card).
// A device that had the Listen or Say switch on starts on that way.
let practiceWay = readPreference('echo.way', readPreference('echo.say-mode', 'off') === 'on' || readPreference('echo.words-tab', '') === 'say' ? 'speak' : readPreference('echo.listen-mode', 'off') === 'on' ? 'listen' : 'read');
if (!['read', 'listen', 'speak'].includes(practiceWay)) practiceWay = 'read';
let heardCard = '';
// Speak is offered on the Words cards (not in Practise), in the Echo that has it.
const speakOffered = () => screen === 'practice' && !roomsOff.has('say');
// The way the card on screen is practised: always Read in English → French, and Read where Speak is not offered.
const wayNow = () => direction !== 'fr-en' || (practiceWay === 'speak' && !speakOffered()) ? 'read' : practiceWay;
const listening = () => wayNow() === 'listen';
const headphones = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16v-4a8 8 0 0 1 16 0v4"/><rect x="3.5" y="14" width="4" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4" height="6.5" rx="1.5"/></svg>';
const micIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
const eyeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>';
const bookIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v14M12 6C9.5 4.2 6 4 3 4.7v13.6c3-.7 6.5-.5 9 1.3 2.5-1.8 6-2 9-1.3V4.7C18 4 14.5 4.2 12 6Z"/></svg>';
const mixIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="7" r="3.2"/><circle cx="17" cy="17" r="3.2"/><path d="M13.5 6.5h6.2m0 0-2.2-2.2m2.2 2.2-2.2 2.2M10.5 17.5H4.3m0 0 2.2-2.2m-2.2 2.2 2.2 2.2"/></svg>';
const cassette = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><circle cx="15.5" cy="11" r="2"/><path d="M10.5 11h3M7 19l1.5-3h7L17 19"/></svg>';
const shuffleIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7h3.2c2.2 0 3.4 1 4.6 3l1.4 2.4c1.2 2 2.4 3 4.6 3h3.2m0 0-2.4-2.4m2.4 2.4-2.4 2.4M3.5 17h3.2c1.6 0 2.6-.5 3.5-1.6m3.6-6.8c.9-1.1 1.9-1.6 3.5-1.6h3.2m0 0-2.4-2.4m2.4 2.4-2.4 2.4"/></svg>';
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5Z"/></svg>';
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
const storyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18.5V5a1.5 1.5 0 0 1 1.5-1.5h12v13H7a2 2 0 0 0-2 2Zm0 0a2 2 0 0 0 2 2h11.5v-4"/><path d="M10 3.5v6l2-1.4 2 1.4v-6"/></svg>';
const radioIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="m7 8 9-4.5"/><circle cx="15.5" cy="14" r="2.8"/><path d="M6.5 12h3M6.5 15h3M6.5 18h3"/></svg>';
const wordsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="12" height="15" rx="2"/><path d="M8 3h10a2 2 0 0 1 2 2v13"/><path d="M7.5 10h5M7.5 13.5h3.5"/></svg>';
const grammarIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 10 5l5 14M7 14h6M17 8h3M17 12h3M17 16h3"/></svg>';
const mistakesIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v3.5h3.5"/><path d="M12 8v4l2.5 2"/></svg>';
const statsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11M10 20V5M15 20v-7M20 20V8M3 20.5h18"/></svg>';
const soundsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/></svg>';
const friendsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.2c2.4.1 4 1.7 4.5 4.3"/></svg>';
const cardsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="15" height="13" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v10M6.5 11h8M6.5 14.5h5"/></svg>';
const chevronIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
// Echo always opens on Home; each screen change after that is a history entry, so Back returns to it.
// A place names a screen and what it shows: 'grammar', 'topic|negation', 'exercise|test:negation'.
let screen = 'home';
let depth = 0;
const trail = ['home'];
// A link may ask for one screen (#practice, #grammar, #walkman; #say opens Endless with Say on); the address drops
// it, so a reload opens Home.
const requestedScreen = location.hash.slice(1);
history.replaceState({ echo: 'home', depth: 0 }, '', location.pathname + location.search);
let topicId = '';
// A scope is one resumable session line: '<topic>' practice, 'test:<topic>' topic test, 'unit:<unit>' unit test.
let scope = '';
let snapshot = null;
let grammar = null;
let units = null;
let topicPage = null;
let draft = '';
let tokenOrder = [];
let draftKey = '';
let hintOpen = true;
let revealed = false;
let busy = false;
let loading = false;
let generation = 0;
let notice = null;
let retryAction = null;
let words = null;
let search = '';
let browseCategory = deck;
let browseLoading = false;
// Word families (api/families, fetched once) joined with the statuses in words; open is the family shown in full.
let families = null;
let familiesLoading = false;
let familiesError = '';
let familyOpen = -1;
// Word building: the patterns from api/families; the word opened under a pattern ("index:id"), and where to go back to.
let patterns = null;
let buildingWord = '';
let buildingFrom = 'grammar';
const familyAdding = new Set();
let browseError = '';
let browseGeneration = 0;
let browseShow = 'all';
let hideTranslations = false;
const revealedWords = new Set();
const audio = new Audio();
audio.preload = 'none';
let audioGeneration = 0;
let audioTimer;
// Board's Web Audio clip (playBoardClip); here, beside the <audio> state, because stopAudio stops it too.
let boardSource = null;
let boardPlays = 0;
// Recordings fetched ahead of need, held as in-memory object URLs: playing one starts at once, with no
// round trip to the Mac. The oldest are dropped past a small cap.
const clipCache = new Map();
const CLIP_CACHE_SIZE = 40;
function warmClip(url) {
  if (!url || clipCache.has(url)) return;
  clipCache.set(url, null);
  fetch(url).then((response) => (response.ok ? response.blob() : null)).then((blob) => {
    if (!blob || !clipCache.has(url)) { clipCache.delete(url); return; }
    clipCache.set(url, URL.createObjectURL(blob));
    while (clipCache.size > CLIP_CACHE_SIZE) {
      const [oldest, source] = clipCache.entries().next().value;
      if (source) URL.revokeObjectURL(source);
      clipCache.delete(oldest);
    }
  }).catch(() => clipCache.delete(url));
}
// Board recordings, fetched in the background once the tiles are laid out (see warmBoardClips); kept apart from
// clipCache so a full board never pushes out the clips Cards fetched ahead.
const boardClips = new Map();
const clipSource = (url) => clipCache.get(url) || boardClips.get(url) || url;
// Vocabulary runs the daily stacks or Endless: started words only, picked by score, each answer +1 or -1 to it.
let vocabMode = readPreference('echo.vocab-mode', 'daily') === 'endless' ? 'endless' : 'daily';
const endlessMode = () => vocabMode === 'endless' && screen === 'practice';
// cards: the word shown, then the ones fetched ahead; recent: words already answered, newest first; last: the
// answer Undo would take back.
let endless = null; // { direction, deck, cards, pool, recent, last, fetching, serial }
const ENDLESS_AHEAD = 2;
const ENDLESS_GAP = 10;
// Answers given ahead of the Mac, in Words' cards and Practise: the latest snapshot it confirmed and the answers since,
// saved one at a time in order (answers[0] is on its way). The card shown is that snapshot's prediction for them.
let grades = null; // { confirmed, answers: [{ body }], where: 'practice' | 'mixed', sending, failed, settle }
let pendingGrade = null; // settles once every answer given ahead is saved, or given up after a conflict
// Set once the answer being saved has taken longer than SLOW_SAVE, so the screen says so instead of ignoring taps.
let savingSlow = false;
const SLOW_SAVE = 1200;
const GRADE_LIMIT = 10000;
// An answer given when no card after it could be predicted: it is given once the Mac's reply shows the next card.
let queuedGrade = null;
// The Walkman plays one long tape on its own audio element, so a locked phone keeps playing it.
// tape.words times each word; the screen and the lock screen follow currentTime.
const walkmanAudio = new Audio();
walkmanAudio.preload = 'auto';
// logged holds the tape positions already added to the history.
let walkman = { tape: null, index: -1, meaning: false, loading: false, started: false, logged: new Set() };
let walkmanGeneration = 0;
// Words you heard, newest first, one entry per word, kept on this device across tapes. added records the
// answer to "Add to my words" so the row keeps saying it, and mark is the learner's own "knew it or not"
// ({id, knew}) for that listen. The list opens only when asked, each visit.
const HEARD_KEY = localKey('echo.walkman-heard');
const HEARD_LIMIT = 50;
let walkmanHeard = (() => {
  try { const list = JSON.parse(localStorage.getItem(HEARD_KEY) || '[]'); return Array.isArray(list) ? list.slice(0, HEARD_LIMIT) : []; } catch { return []; }
})();
let heardOpen = false;
let heardSaying = '';
const heardMarking = new Set();
function saveHeard() { try { localStorage.setItem(HEARD_KEY, JSON.stringify(walkmanHeard)); } catch { /* private mode: history lasts this visit */ } }
// What the Walkman tab in Words plays, remembered on this device: words by score (the default) or by groups.
const WALKMAN_CHOICES = { scored: 'words by score', groups: 'words by groups' };
let walkmanChoice = (() => { const saved = readPreference('echo.walkman-words', 'scored'); return saved in WALKMAN_CHOICES ? saved : 'scored'; })();
function chooseWalkman(choice) {
  if (choice === walkmanChoice || walkman.loading) return;
  walkmanChoice = choice; savePreference('echo.walkman-words', choice);
  // The new choice starts a new tape straight away, playing on if the old one was.
  loadTape(!walkmanAudio.paused);
}
// The three tapes, each in its own room: the Walkman tab in Words, Tape in Listen (sentences) and Tape in Verbs.
const TAPE_SCREENS = { walkman: 'words', 'listen-tape': 'sentences', 'verbs-tape': 'verbs' };
const tapeScreen = (name = screen) => name in TAPE_SCREENS;
// What the tape on screen plays: the Walkman's choice of words, or its room's sentences, or Verbs' choice of tape.
const tapeKind = () => screen === 'walkman' ? walkmanChoice : screen === 'verbs-tape' ? verbTapeKind : TAPE_SCREENS[screen];
// Tape in Verbs plays the form tape or Change it, remembered on this device; without the room, only the form tape.
const VERB_TAPES = { verbs: 'Forms', ...(roomsOff.has('changeit') ? {} : { change: 'Change it' }) };
let verbTapeKind = (() => { const saved = readPreference('echo.verb-tape', 'verbs'); return saved in VERB_TAPES ? saved : 'verbs'; })();
function chooseVerbTape(kind) {
  if (!(kind in VERB_TAPES) || kind === verbTapeKind || walkman.loading) return;
  verbTapeKind = kind; savePreference('echo.verb-tape', kind);
  loadTape(!walkmanAudio.paused);
}
// Words and Listen are rooms of tabs; each opens on the tab last used, remembered on this device.
const WORDS_TABS = { cards: 'Cards', endless: 'Endless', board: 'Board', ...(roomsOff.has('walkman') ? {} : { walkman: 'Walkman' }), ...(roomsOff.has('songs') ? {} : { songs: 'Songs' }) };
const LISTEN_TABS = { listen: 'Questions', ...(roomsOff.has('sounds') ? {} : { sounds: 'Sounds' }), ...(roomsOff.has('sentencetape') ? {} : { 'listen-tape': 'Tape' }), ...(roomsOff.has('news') ? {} : { news: 'News' }) };
// A device last on the old Say it tab opens on Endless, with Say on.
let wordsTab = (() => { const saved = readPreference('echo.words-tab', vocabMode === 'endless' ? 'endless' : 'cards'); return saved === 'say' ? 'endless' : saved in WORDS_TABS ? saved : 'cards'; })();
let listenTab = (() => { const saved = readPreference('echo.listen-tab', 'listen'); return saved in LISTEN_TABS ? saved : 'listen'; })();
// The verb tape plays the tenses chosen in Verbs; changing them here changes them there too.
function chooseWalkmanTense(tense) {
  if (walkman.loading) return;
  const next = verbTenses.includes(tense) ? verbTenses.filter((entry) => entry !== tense) : [...verbTenses, tense];
  if (!next.length) return;
  verbTenses = next; savePreference('echo.verbs-tenses', JSON.stringify(next));
  loadTape(!walkmanAudio.paused);
}
// One comprehension stream at a time: the Listen and Read screens, Practise and a Mistakes focus all show one.
let streamId = '';
let streamState = null;
// Grammar by ear (lib/grammar-ear.ts): Listen's state carries one under ear when it is due. It is shown before the
// question waiting under current, and its answer is kept here until Next.
let earResult = null;
// Listen, Read and Practise's comprehension turns save behind the screen: answers, Next, looked-up words and Grammar by
// ear answers go to the Mac one at a time, in order (queue[0] is on its way), each with the version the reply before it
// gave. confirmed is the Mac's latest state; the screen runs ahead of it on what the Mac sends with each question.
let streamSaves = null; // { id, confirmed, queue, sending, failed, slow, settle, done }
let streamSlow = false;
// A Grammar by ear question the Mac offered once the question after it was already under way: it shows at the next Next.
let earLater = null;
const earsAnswered = new Set();
// A Practise grammar Next on its way: answers and help wait for it, as they need the version its reply carries.
let reviewSaving = null;
let streamGeneration = 0;
let heardKey = '';
let audioBlocked = false;
let clipProgress = null;
// A passage or sentence that is playing, and where one was stopped (a tapped word, Pause, an answer), so the
// speaker continues from that line; "From the start" plays it all again.
let clipRun = null; // { key, index, heard }: index is where play continues, heard the line last started
let clipSpot = null; // { key, index, heard }
let glossWord = null;
let addStatus = '';
let mistakes = null;
let focusId = '';
// Practise and a Mistakes focus alternate sources; review holds the grammar session they show.
let mixedSource = '';
let mixedStep = -1;
let mixedGeneration = 0;
let review = null;
let levels = readLevels();
function readLevels() {
  try { const saved = JSON.parse(readPreference('echo.levels', '') || 'null'); return saved && typeof saved === 'object' ? saved : {}; } catch { return {}; }
}

function announce(message) { document.querySelector('#announcer').textContent = message; }
function locked() { return busy || !!retryAction?.body || !!retryAction?.run; }
// The language being learnt, in English (the page's data-english; French in a French Echo without the switch).
const languageEnglish = document.body.dataset.english || 'French';
function directionLabel() { return direction === 'fr-en' ? `${languageEnglish} → English` : `English → ${languageEnglish}`; }
function categoryTitle(category) { return snapshot?.decks.find((entry) => entry.id === category)?.title || category.replace(/[-_]/g, ' ').replace(/^./, (letter) => letter.toUpperCase()); }
function totalWords() { return snapshot?.decks.find((entry) => entry.id === 'all')?.count ?? 0; }
function dateLabel(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date); }
function dayLabel(value) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value)); }
function stopAudio() {
  const stopped = clipRun;
  if (stopped) clipSpot = { ...stopped };
  clipRun = null; audioGeneration++; clipProgress = null; audio.pause(); audio.removeAttribute('src'); audio.load(); clearTimeout(audioTimer); document.querySelector('#audio-status').hidden = true;
  stopBoardClip();
  if (!storyAudio.paused) storyAudio.pause();
  if (stopped) showClipProgress();
}
function audioMessage(message, url) {
  const status = document.querySelector('#audio-status');
  clearTimeout(audioTimer);
  status.innerHTML = `<span>${esc(message)}</span>${url ? '<button type="button" class="quiet" data-audio-retry>Retry audio</button>' : ''}<button type="button" class="icon" data-audio-dismiss aria-label="Dismiss audio message">×</button>`;
  status.hidden = false;
  status.querySelector('[data-audio-dismiss]').onclick = () => { status.hidden = true; };
  if (url) status.querySelector('[data-audio-retry]').onclick = () => playFrench(url);
  audioTimer = setTimeout(() => { status.hidden = true; }, 20000);
}
async function playFrench(url) {
  const token = ++audioGeneration;
  audio.pause(); audio.src = clipSource(url); audio.playbackRate = speed; audio.preservesPitch = true; audio.webkitPreservesPitch = true;
  try {
    await audio.play();
    if (token === audioGeneration) document.querySelector('#audio-status').hidden = true;
  } catch (error) {
    if (token !== audioGeneration) return;
    if (error.name === 'NotAllowedError') { audioMessage('Your browser blocked playback. Retry audio to hear this recording.', url); return; }
    audioMessage('Pronunciation could not play. Checking the recording…');
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (token !== audioGeneration) return;
      if (!response.ok && response.headers.get('content-type')?.includes('application/json')) {
        const result = await response.json();
        if (token === audioGeneration) audioMessage(result.error || 'This recording is unavailable.', url);
      } else {
        if (response.body) await response.body.cancel();
        if (token === audioGeneration) audioMessage('This recording could not play. Check your connection, then retry audio.', url);
      }
    } catch { if (token === audioGeneration) audioMessage('Cannot reach your Mac for pronunciation. Check your connection, then retry audio.', url); }
  }
}
// Passages play line by line: one clip, a short pause, the next, with the line shown while it plays.
function playClip(url, token) {
  return new Promise((resolve) => {
    const done = (ok) => { audio.removeEventListener('ended', ended); audio.removeEventListener('error', failed); resolve(ok); };
    const ended = () => done(true);
    const failed = () => { if (token === audioGeneration) audioMessage('This recording is not ready yet.'); done(false); };
    audio.addEventListener('ended', ended); audio.addEventListener('error', failed);
    audio.pause(); audio.src = clipSource(url); audio.playbackRate = speed; audio.preservesPitch = true; audio.webkitPreservesPitch = true;
    audio.play().then(() => {
      if (token === audioGeneration) { audioBlocked = false; document.querySelector('#audio-status').hidden = true; }
    }).catch((error) => {
      if (token !== audioGeneration) { done(false); return; }
      if (error.name === 'NotAllowedError') { audioBlocked = true; render(); }
      else audioMessage('This recording could not play. Tap the speaker to try again.');
      done(false);
    });
  });
}
// The line under the speaker: the line playing now, where it stopped, or why nothing is playing.
function clipKey() {
  if (screen === 'story' && storyView) return `story:${storyView.episode.id}`;
  const view = shownView(); return view ? `${streamId}:${view.key}` : '';
}
function clipHint() {
  const view = shownView();
  if (clipProgress) return `line ${clipProgress.index} of ${clipProgress.total}`;
  if (!view?.audio?.length) return '';
  if (clipSpot?.key === clipKey() && view.audio.length > 1) return `paused · line ${clipSpot.heard + 1} of ${view.audio.length}`;
  if (audioBlocked && view.mode === 'listen' && !shownSettled()) return 'Tap to listen';
  return view.audio.length > 1 ? `${view.audio.length} lines` : '';
}
// The speaker and its hint change as lines play, so the block is redrawn in place.
function showClipProgress() {
  if (screen === 'story' && storyView) { const block = document.querySelector('.story .story-player'); if (block) block.outerHTML = storyPlayHTML(); return; }
  const block = document.querySelector('.listen-block');
  if (block && shownView()) block.outerHTML = streamAudioHTML(shownView(), shownSettled());
}
// Plays lines from `from` up to (not including) `to`; stopping short of the end leaves the spot after the last
// line played, so Continue goes on from there.
async function playClips(urls, from = 0, to = urls?.length ?? 0) {
  if (!urls?.length) return;
  const token = ++audioGeneration;
  clipRun = { key: clipKey(), index: from, heard: from }; clipSpot = null;
  for (let index = from; index < to; index++) {
    if (token !== audioGeneration) return;
    clipRun.index = index; clipRun.heard = index;
    clipProgress = urls.length > 1 ? { index: index + 1, total: urls.length } : null;
    showClipProgress();
    if (!await playClip(urls[index], token) || token !== audioGeneration) {
      if (token === audioGeneration) { clipRun = null; clipProgress = null; showClipProgress(); }
      return;
    }
    if (index + 1 < to) { clipRun.index = index + 1; await new Promise((resolve) => { audioTimer = setTimeout(resolve, 500); }); }
  }
  if (token !== audioGeneration) return;
  clipSpot = to < urls.length ? { key: clipRun.key, index: to, heard: to - 1 } : null;
  clipRun = null; clipProgress = null; showClipProgress();
}
// Whether the last request failed to reach the Mac at all (no reply, or none in time). While it did and an action
// waits to be retried, Echo retries it by itself: every retried action carries the request id it was first sent
// with, so sending it again can never count twice.
let offline = false;
let autoRetryTimer = 0, autoRetryTries = 0;
const AUTO_RETRY_SECONDS = [2, 4, 8, 15, 30];
// limit: how long to wait for the Mac before giving up (and, for an action, retrying it by itself).
async function api(path, { limit = 25000, ...options } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), limit);
  try {
    const response = await fetch(path, { ...options, signal: controller.signal, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, cache: 'no-store' });
    offline = false;
    let data;
    try { data = await response.json(); } catch { throw new Error('Your Mac returned an unreadable response. Please try again.'); }
    if (!response.ok) { const error = new Error(data.error || `Request failed (${response.status}). Please try again.`); error.status = response.status; throw error; }
    return data;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) offline = true;
    if (error.name === 'AbortError') throw new Error('The request timed out. Retry to safely check and finish the same action.');
    if (error instanceof TypeError) throw Object.assign(new Error('Cannot reach your Mac. Check that Echo is running and your connection is available, then retry.'), { network: true });
    throw error;
  } finally { clearTimeout(timeout); }
}
function requestId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function applySnapshot(next) {
  snapshot = next; direction = next.direction; deck = next.deck;
  savePreference('echo.direction', direction); savePreference('echo.deck', deck);
  revealed = false; stopAudio();
}
function applyGrammar(next, preserveDraft = false) {
  const key = next.session?.current ? `${next.session.id}:${next.session.current.exercise.id}` : '';
  if (!preserveDraft || key !== draftKey || next.session?.current?.settled) {
    draft = next.session?.current?.answer || '';
    tokenOrder = [...(next.session?.current?.tokenOrder || [])];
  }
  draftKey = key; grammar = next; scope = next.scope;
  if (next.topic) { topicId = next.topic.id; topicPage = next.topic; }
}
// Switching scope drops the other scope's snapshot, so a loading screen never shows another session's questions.
function enterScope(key) {
  if (key !== scope) { grammar = null; draftKey = ''; }
  scope = key;
  if (!key.startsWith('unit:')) topicId = key.replace(/^test:/, '');
}
function noticeHTML() {
  if (!notice) return '';
  if (offline && retryAction) {
    const kept = retryAction.body?.known !== undefined || retryAction.body?.given !== undefined || retryAction.type === 'grade' || retryAction.type === 'stream-saves' || retryAction.type === 'sentence-saves' ? ' Your answer is kept and saves as soon as it’s back.' : '';
    return `<div class="notice info" role="status"><span>Can’t reach your Mac. Trying again by itself.${kept}</span><button class="quiet" data-action="retry" ${busy ? 'disabled' : ''}>Retry now</button></div>`;
  }
  return `<div class="notice ${notice.kind === 'info' ? 'info' : ''}" role="${notice.kind === 'info' ? 'status' : 'alert'}"><span>${esc(notice.message)}</span>${retryAction ? `<button class="quiet" data-action="retry" ${busy ? 'disabled' : ''}>Retry</button>` : ''}</div>`;
}
function optionsHTML(selected) { return (snapshot?.decks || []).map((entry) => `<option value="${esc(entry.id)}" ${entry.id === selected ? 'selected' : ''}>${esc(entry.title)} · ${entry.count}</option>`).join(''); }
// Nouns are coloured by gender (lib/store.ts genderOf): a class on the learnt word, shown when the setting is on.
let genders = {};               // word id -> gender, for tappable words linked to a noun (api/genders)
let genderColours = localStorage.getItem(localKey('echo.genders')) !== 'off';
document.body.classList.toggle('genders', genderColours);
// Each gender's colour class (app.css) and its name on a card. Swedish en and ett are not masculine and feminine, so
// they have names and colours of their own.
const GENDERS = { masculine: ['g-m', 'masculine'], feminine: ['g-f', 'feminine'], common: ['g-c', 'en-word'], neuter: ['g-n', 'ett-word'] };
// The two genders this language's nouns come in, for the key in Words options.
const LANGUAGE_GENDERS = language === 'sv' ? ['common', 'neuter'] : ['masculine', 'feminine'];
const genderClass = (gender) => GENDERS[gender] ? ` ${GENDERS[gender][0]}` : '';
fetch('api/genders').then((response) => response.ok ? response.json() : {}).then((map) => { genders = map; render(); }).catch(() => {});
function back(label, action) { return `<button class="back" data-action="${action}" ${busy ? 'disabled' : ''}><span aria-hidden="true">←</span> ${label}</button>`; }
function place() { return screen === 'song' ? `song|${songId}` : screen === 'lyrics' ? `lyrics|${songId}` : screen === 'topic' ? `topic|${topicId}` : screen === 'exercise' ? `exercise|${scope}` : screen === 'focus' ? `focus|${focusId}` : screen === 'sound' ? `sound|${soundId}` : screen === 'story' && storyNumber ? `story|${storyNumber}` : screen === 'news-edition' ? `news-edition|${newsDate}` : screen; }
function record(next) {
  depth += 1; trail.length = depth; trail[depth] = next;
  history.pushState({ echo: next, depth }, '');
}
function workingCounts(label) {
  if (savingSlow && pendingGrade) return `<span class="compact-line"><span class="compact-label" title="${esc(label)}">${esc(label)}</span><span class="compact-status" role="status">${(grades?.answers.length ?? 0) > 1 || queuedGrade !== null ? 'Saving your last answers…' : 'Saving your last answer…'}</span></span>`;
  const unavailable = !snapshot || retryAction || snapshot.direction !== direction || snapshot.deck !== deck;
  const counts = loading ? '<span class="compact-status" role="status">Loading counts…</span>' : unavailable ? '<span class="compact-status">Counts unavailable</span>' : `<span class="compact-counts"><span class="unseen"><strong>${formatCount(snapshot.stats.unseenActive)}</strong> unseen</span><span class="separator" aria-hidden="true">·</span><span><strong>${formatCount(snapshot.stats.seenActive)}</strong> seen</span></span>`;
  return `<span class="compact-line"><span class="compact-label" title="${esc(label)}">${esc(label)}</span>${counts}</span>`;
}
// Home: every room is a tile, Vocabulary first; each carries one live hint. The Story and Radio hints come from
// their own endpoints, and the Friends row says how many people are waiting to be let in, all read again at most
// once a minute while Home is open.
let homeInfo = { story: null, radio: null, waiting: 0, at: 0 };
function loadHomeInfo() {
  if (Date.now() - homeInfo.at < 60_000) return;
  homeInfo.at = Date.now();
  const hint = (room) => roomsOff.has(room) ? Promise.resolve(null) : api(`api/${room}`).catch(() => null);
  Promise.all([hint('story'), hint('radio'), hint('friends')]).then(([story, radioView, friends]) => {
    homeInfo = { story, radio: radioView, waiting: friends?.requests?.length ?? 0, doorOpen: !!friends?.openUntil, at: homeInfo.at };
    if (screen === 'home' && !busy) renderHome();
  });
}
function storyHint() {
  const last = homeInfo.story?.episodes?.at(-1);
  if (!homeInfo.story) return 'A serial for you';
  if (!last) return 'First episode on its way';
  return last.finished ? `Episode ${last.number + 1} on its way` : `Episode ${last.number} to read`;
}
function radioHint() {
  const view = homeInfo.radio;
  if (view?.state === 'ready') return `Today · ${Math.max(1, Math.round(view.seconds / 60))} min`;
  return view?.state === 'preparing' ? 'Today’s is being made' : 'An episode a day';
}
function vocabularyHint() {
  const unavailable = !snapshot || retryAction || snapshot.direction !== direction || snapshot.deck !== deck;
  return unavailable ? 'Your words' : `${formatCount(snapshot.stats.unseenActive)} unseen · ${formatCount(snapshot.stats.seenActive)} seen`;
}
// How it works leaves out what it says about those rooms; data-room names every room a passage is about.
if (roomsOff.size) {
  document.querySelectorAll('[data-room]').forEach((element) => { if (element.dataset.room.split(' ').some((room) => roomsOff.has(room))) element.remove(); });
}
// In the friends' Echo: who is signed in, with a way out, at the top of How it works.
if (document.body.dataset.learner) document.querySelector('#about-dialog .dialog-copy, .dialog-copy')?.insertAdjacentHTML('afterbegin', `<form class="signed-in" method="post" action="/auth/signout"><span>Signed in as <b>${esc(document.body.dataset.learner)}</b></span><button class="quiet">Sign out</button></form>`);
// The language switch, under the theme in How it works. Each language is its own Echo with its own progress, and this
// phone opens the one chosen last (index.html sends a French start on to it). A language still starting or down says
// so under the switch; choosing it opens a page that says the same and offers the way back.
const languageSwitch = Object.keys(languageNames).length ? document.querySelector('.theme-switch') : null;
languageSwitch?.insertAdjacentHTML('afterend', `<div class="segmented language-switch" role="group" aria-label="Language">${Object.entries(languageNames).map(([code, name]) => `<button data-language-choice="${esc(code)}" lang="${esc(code)}" aria-pressed="${code === language}">${esc(name)}</button>`).join('')}</div><p class="language-state" role="status"></p><p class="language-note">Each language keeps its own progress, and this phone opens the one you used last.</p>`);
if (language !== 'fr' && languageNames[language]) homeButton.insertAdjacentHTML('beforeend', `<span class="lang-tag" lang="${esc(languageTag)}">${esc(languageNames[language])}</span>`);
async function refreshLanguages() {
  const state = document.querySelector('.language-state');
  if (!state) return;
  try {
    const response = await fetch(`${echoRoot}api/languages`, { cache: 'no-store', headers: { Accept: 'application/json' } });
    const { languages } = await response.json();
    for (const entry of languages) document.querySelector(`[data-language-choice="${entry.code}"]`)?.setAttribute('data-state', entry.state);
    state.textContent = languages.filter((entry) => entry.state === 'starting' || entry.state === 'down')
      .map((entry) => `${entry.own} ${entry.state === 'starting' ? 'is starting…' : 'is unavailable right now.'}`).join(' ');
  } catch { state.textContent = ''; }
}
function openLanguage(code) {
  if (code === language || !(code in languageNames)) return;
  savePreference('echo.language', code);
  location.href = code === 'fr' ? echoRoot : `${echoRoot}${code}/`;
}
// Home: Practise on top, then the rooms in two shelves, the three tapes and Radio together for listening on the
// move, and Study.
function renderHome() {
  loadHomeInfo();
  // Each room is tinted by its family: lavender for words, grammar and the tapes, green for listening, peach for Story. Story and Radio tiles are filled with their colour.
  const family = (action) => ['listen', 'read', 'sentences', 'radio'].includes(action) ? ' fam-green' : action === 'story' ? ' fam-peach' : ['mistakes', 'statistics', 'friends'].includes(action) ? ' fam-plain' : '';
  const filled = (action) => ['story', 'radio'].includes(action) ? ' fam-fill' : '';
  const tile = (action, symbol, title, hint, mode, disabled = busy, wide = '') => {
    if (roomsOff.has(action)) return '';
    const label = mode ? levelFor(mode) : '';
    const horizontal = !['practise', 'story', 'radio'].includes(action);
    return `<button class="tile${horizontal ? ' tile-row' : ''}${wide}${family(action)}${filled(action)}" data-action="${action}" ${disabled ? 'disabled' : ''}><span class="ic" aria-hidden="true">${symbol}</span><span class="tile-copy"><span class="tile-heading"><h2>${esc(title)}</h2>${label ? `<span class="level-tag">${esc(label)}</span>` : ''}</span><p>${esc(hint)}</p></span>${action === 'words' ? '<span class="go" aria-hidden="true">→</span>' : ''}</button>`;
  };
  // room: the room a row belongs to, when it is not the action itself (a tape's room).
  const row = (action, symbol, title, data = '', room = action) => roomsOff.has(room) ? '' : `<button class="study-row${family(action)}" data-action="${action}" ${data} ${busy ? 'disabled' : ''}><span class="ic" aria-hidden="true">${symbol}</span><span class="name">${esc(title)}</span><span class="${action === 'tape' || action === 'radio' ? 'shelf-play' : 'chev'}" aria-hidden="true">${action === 'tape' || action === 'radio' ? playIcon : chevronIcon}</span></button>`;
  // A shelf whose rooms are all left out (another language's, before its content) goes with its label.
  const shelf = (label, kind, items) => items.trim() ? `${label ? `<p class="study-label">${label}</p>` : ''}<div class="${kind}">${items}</div>` : '';
  main.innerHTML = `${noticeHTML()}<section class="home"><h1>Choose your practice.</h1>
    ${shelf('', 'tiles', tile('practise', mixIcon, 'Practise', 'A little of everything: words, listening and grammar, mixed for you', '', busy, ' wide hero'))}
    ${shelf(roomsOff.has('grammar') && roomsOff.has('verbs') ? 'Words' : 'Words &amp; grammar', 'tiles shelf', `
    ${tile('words', wordsIcon, 'Words', vocabularyHint(), '', locked(), ' wide')}
    ${tile('grammar', grammarIcon, 'Grammar', 'Rules, then practise')}
    ${tile('verbs', verbsIcon, 'Verbs', 'Conjugation, on its own')}
    `)}${shelf('Listen &amp; read', 'tiles shelf', `
    ${tile('listen', headphones, 'Listen', roomsOff.has('sounds') && roomsOff.has('sentencetape') ? 'Hear it, show you got it' : 'Questions, twin sounds, a tape', 'listen')}
    ${tile('read', bookIcon, 'Read', 'Read it, show you got it', 'read')}
    ${tile('sentences', cardsIcon, 'Sentences', 'Hear or read one, then see if you got it', '', busy, ' wide')}
    ${tile('story', storyIcon, 'Story', storyHint())}
    ${tile('radio', radioIcon, 'Radio', radioHint())}
    `)}${shelf('Hands-free', 'study hands-free', `
    ${row('tape', cassette, 'Words tape', 'data-tape="walkman"', 'walkman')}${row('tape', cassette, 'Verbs tape', 'data-tape="verbs-tape"', 'verbs')}${roomsOff.has('sentencetape') ? '' : row('tape', cassette, 'Sentences tape', 'data-tape="listen-tape"', 'listen')}${row('radio', radioIcon, `Today’s Radio · ${radioHint()}`)}
    `)}${shelf('Study', 'study home-study', `
    ${row('mistakes', mistakesIcon, 'Mistakes')}${row('statistics', statsIcon, 'Statistics')}${row('friends', friendsIcon, ['Friends', homeInfo.doorOpen ? 'open to anyone' : '', homeInfo.waiting ? `${homeInfo.waiting} waiting` : ''].filter(Boolean).join(' · '))}
  `)}</section>`;
}
// The tabs along the top of a room; each button carries the action that opens its tab.
function roomTabs(action, current, tabs) {
  return `<div class="room-tabs" role="tablist">${Object.entries(tabs).map(([id, label]) => `<button role="tab" data-action="${action}" data-tab="${id}" aria-selected="${id === current}" ${busy ? 'disabled' : ''}>${esc(label)}</button>`).join('')}</div>`;
}
// ⓘ: what the room does, from its part of How it works (index.html, data-info).
function infoButton(room) { return `<button class="icon" data-action="info" data-info-room="${room}" aria-label="How this works" aria-haspopup="dialog">${infoIcon}</button>`; }
const INFO_TITLES = { words: 'Words', listen: 'Listen', read: 'Read', sentences: 'Sentences', verbs: 'Verbs', grammar: 'Grammar', practise: 'Practise', mistakes: 'Mistakes', story: 'Story', radio: 'Radio' };
function openInfo(room) {
  const parts = [...aboutDialog.querySelectorAll('[data-info]')].filter((part) => part.dataset.info.split(' ').includes(room)).map((part) => part.innerHTML).join('');
  if (!parts) return;
  openDialog(INFO_TITLES[room] ?? 'How it works', `<div class="dialog-copy">${parts}</div><button class="primary dialog-action" data-action="close-dialog">Done</button>`, 'info');
}
const wordsTabNow = () => screen === 'walkman' || screen === 'songs' || screen === 'board' ? screen : vocabMode === 'endless' ? 'endless' : 'cards';
// The top of every Words tab: back, the direction (for cards and the board), Your words, ⓘ, options, then the tabs.
function wordsTop() {
  const tab = wordsTabNow(), cards = tab === 'cards' || tab === 'endless' || tab === 'board';
  return `<div class="section-top">${back('Home', 'home')}<div>${cards ? `<span class="review-direction" aria-label="${esc(directionLabel())}">${direction === 'fr-en' ? `${language.toUpperCase()} → EN` : `EN → ${language.toUpperCase()}`}</span>` : ''}<button class="icon" data-action="browse" aria-label="Your words" ${busy ? 'disabled' : ''}>${searchIcon}</button>${infoButton('words')}<button class="icon" data-action="options" aria-label="Words options" aria-haspopup="dialog" ${busy || !snapshot ? 'disabled' : ''}>•••</button></div></div>${roomTabs('words-tab', tab, WORDS_TABS)}`;
}
// The top of every Listen tab: back, the level (for questions), ⓘ, then the tabs.
function listenTop(right = '') {
  // A Listen with Questions alone (a language without Sounds or Tape) shows no tabs.
  return `<div class="section-top">${back('Home', 'home')}<div>${right}${infoButton('listen')}</div></div>${Object.keys(LISTEN_TABS).length > 1 ? roomTabs('listen-tab', screen === 'sound' ? 'sounds' : screen, LISTEN_TABS) : ''}`;
}
// Keeps a retry scheduled while the Mac is out of reach and an action waits, sooner at first, then every 30 s.
function syncAutoRetry() {
  // The wait grows only while the Mac stays silent; any reply starts it again from the shortest.
  if (!offline) autoRetryTries = 0;
  if (!offline || !retryAction) { clearTimeout(autoRetryTimer); autoRetryTimer = 0; return; }
  if (autoRetryTimer || busy) return;
  const seconds = AUTO_RETRY_SECONDS[Math.min(autoRetryTries, AUTO_RETRY_SECONDS.length - 1)];
  autoRetryTimer = setTimeout(() => { autoRetryTimer = 0; autoRetryTries += 1; retry(); }, seconds * 1000);
}
// Back on the network, or back in the app: try at once rather than waiting for the next turn.
function retryNow() {
  if (!offline || !retryAction || busy) return;
  clearTimeout(autoRetryTimer); autoRetryTimer = 0; retry();
}
window.addEventListener('online', retryNow);
window.addEventListener('pageshow', retryNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retryNow(); });
// Opening Echo or coming back to it: one read the Mac answers with nothing (api/warm), so a Mac that has swapped Echo
// out brings it back before the first tap, and the recordings the screen plays next are fetched meanwhile. Once per
// visit: hiding the page lets the next return send it again. It reads only, so it never saves or changes anything.
let warmed = false;
function warmUp() {
  if (warmed || document.visibilityState !== 'visible') return;
  warmed = true;
  fetch(`api/warm?${new URLSearchParams({ screen, direction, deck })}`, { cache: 'no-store' }).catch(() => {});
  if (screen === 'practice') { warmClip(snapshot?.current?.audioUrl); warmClip(snapshot?.next?.audioUrl); }
  if (streamState?.current?.mode === 'listen') streamState.current.audio.forEach(warmClip);
}
window.addEventListener('pageshow', warmUp);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') warmed = false; else warmUp(); });
function render() {
  syncAutoRetry();
  homeButton.disabled = busy;
  document.querySelector('#about-button').disabled = busy;
  if (screen === 'practice') renderPractice();
  else if (screen === 'browse') renderBrowse();
  else if (screen === 'families') renderFamilies();
  else if (screen === 'building') renderBuilding();
  else if (screen === 'grammar') renderGrammar();
  else if (screen === 'topic') renderTopic();
  else if (screen === 'exercise') renderExercise();
  else if (screen === 'listen' || screen === 'read') renderStream();
  else if (screen === 'mix' || screen === 'focus') renderMixed();
  else if (screen === 'mistakes') renderMistakes();
  else if (screen === 'friends') renderFriends();
  else if (tapeScreen()) renderWalkman();
  else if (screen === 'statistics') renderStatistics();
  else if (screen === 'songs') renderSongs();
  else if (screen === 'board') renderBoard();
  else if (screen === 'song') renderSong();
  else if (screen === 'lyrics') renderLyrics();
  else if (screen === 'write') renderWrite();
  else if (screen === 'sounds') renderSounds();
  else if (screen === 'sound') renderSound();
  else if (screen === 'verbs') renderVerbs();
  else if (screen === 'verbs-all') renderVerbAll();
  else if (screen === 'verbs-forms') renderVerbForms();
  else if (screen === 'verbs-table') renderVerbTable();
  else if (screen === 'verbs-ear') renderVerbEar();
  else if (screen === 'verbs-cards') renderVerbCards();
  else if (screen === 'verbs-rules') renderRuleCards();
  else if (screen === 'verbs-sentences') renderVerbSentences();
  else if (screen === 'sentences') renderSentences();
  else if (screen === 'verbs-tense') renderVerbTense();
  else if (screen === 'verbs-verb') renderVerbPage();
  else if (screen === 'story') renderStory();
  else if (screen === 'radio') renderRadio();
  else if (screen === 'news') renderNews();
  else if (screen === 'news-edition') renderNewsEdition();
  else renderHome();
}
// What each part of a tape word is called, by tape: its French, the pause to recall it, its meaning, the French again.
const TAPE_PHASES = { words: ['Listen', 'Recall', 'Meaning', 'Again'], sentences: ['Listen', 'Understand', 'Meaning', 'Again'], verbs: ['Prompt', 'Say it', 'Form', 'Again'], change: ['Sentence', 'Change', 'Say it', 'Answer'] };
const PHASE_KEYS = ['listen', 'recall', 'meaning', 'again'];
// The part of the word playing that the tape has reached; '' between words.
function walkmanPhase() {
  const word = walkman.tape?.words[walkman.index];
  if (!word) return '';
  const time = walkmanAudio.currentTime;
  return time >= word.againAt ? 'again' : time >= word.meaningAt ? 'meaning' : time >= word.recallAt ? 'recall' : 'listen';
}
const reelIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.4"/><path d="M12 3v4.6M12 16.4V21M4.2 7.5l4 2.3M15.8 14.2l4 2.3M4.2 16.5l4-2.3M15.8 9.8l4-2.3"/></svg>';
// A Change it answer with its changed verb form lit.
function changedAnswer(answer, form) {
  const at = answer.toLowerCase().indexOf(form.toLowerCase());
  return at < 0 ? frEsc(answer) : `${frEsc(answer.slice(0, at))}<span class="wm-form">${frEsc(answer.slice(at, at + form.length))}</span>${frEsc(answer.slice(at + form.length))}`;
}
// The tape player: the Walkman tab in Words, or Tape in Listen or in Verbs.
function renderWalkman() {
  const room = TAPE_SCREENS[screen];
  const verbTapeSwitch = room === 'verbs' && Object.keys(VERB_TAPES).length > 1 ? `<div class="segmented wm-way" role="group" aria-label="What the verb tape plays">${Object.entries(VERB_TAPES).map(([kind, label]) => `<button data-action="walkman-verb-tape" data-kind="${kind}" aria-pressed="${verbTapeKind === kind}" ${walkman.loading ? 'disabled' : ''}>${label}</button>`).join('')}</div>` : '';
  const header = room === 'words' ? wordsTop() : room === 'sentences' ? listenTop() : `<div class="section-top">${back('Verbs', 'verbs')}<div><span class="stream-label">${verbTapeKind === 'change' ? 'Change it' : 'Tape'}</span>${infoButton('verbs')}</div></div>${verbTapeSwitch}`;
  const tape = walkman.tape;
  if (walkman.loading || (!tape && !notice)) { main.innerHTML = `${noticeHTML()}<section class="stream walkman">${header}<div class="loading-state" role="status">Winding the tape…</div></section>`; return; }
  if (!tape) { main.innerHTML = `${noticeHTML()}<section class="stream walkman">${header}</section>`; return; }
  const word = tape.words[walkman.index];
  const playing = !walkmanAudio.paused;
  const phase = word ? walkmanPhase() : '';
  // Change it shows the sentence, then the cue under it, and once the answer plays, the answer and its English.
  const face = word?.change
    ? phase === 'again'
      ? `<p class="wm-fr wm-sentence" lang="${languageTag}">${changedAnswer(word.fr, word.change.form)}</p><p class="wm-en">${esc(word.en)}</p>`
      : `<p class="wm-fr wm-sentence" lang="${languageTag}">${frEsc(word.change.base)}</p><p class="wm-en wm-cue">${phase === 'listen' ? '&nbsp;' : `→ <span lang="${languageTag}">${frEsc(word.change.cue)}</span>`}</p>`
    : word
    ? `<p class="wm-fr${word.sentence || word.verb ? ' wm-sentence' : ''}" lang="${languageTag}">${frEsc(word.fr)}</p><p class="wm-en">${walkman.meaning ? esc(word.en) : '&nbsp;'}</p>`
    : `<p class="wm-hint">${tape.kind === 'change'
      ? 'You hear a sentence, then a change: a time, or another person. Say the new sentence in the pause, then hear it. The verbs and tenses on your Practising line; with one tense, only the person changes.'
      : tape.kind === 'verbs'
      ? 'You hear a verb, a tense and a person, then a pause to say the form, then the form twice. The 20 most common verbs, in the tenses you choose.'
      : tape.kind === 'sentences'
      ? `You hear a ${languageEnglish} sentence, then a pause to understand it, then the English, then the ${languageEnglish} again.`
      : `You hear a ${languageEnglish} word, then a pause to find its meaning, then the English, then the ${languageEnglish} again.`}</p>`;
  // The phase row shows where the word playing has got to; the reels turn only while the tape plays.
  const phases = word ? `<div class="wm-phase" aria-hidden="true">${TAPE_PHASES[tape.kind].map((label, index) => `<span data-phase="${PHASE_KEYS[index]}"${PHASE_KEYS[index] === phase ? ' class="on"' : ''}>${label}</span>`).join('')}</div>` : '';
  main.innerHTML = `${noticeHTML()}<section class="stream walkman">${header}
    <div class="wm-face" aria-live="polite">${face}</div>${phases}
    <div class="wm-deck${playing ? ' playing' : ''}" aria-hidden="true"><span class="wm-reel">${reelIcon}</span><div class="wm-progress"><span style="width:${walkmanProgress()}%"></span></div><span class="wm-reel">${reelIcon}</span></div>
    <div class="wm-controls"><button class="listen-play wm-play" data-action="walkman-toggle" aria-label="${playing ? 'Pause' : 'Play'}">${playing ? pauseIcon : playIcon}</button></div>
    ${heardHTML()}
    <p class="caption wm-note">Keeps playing with your phone locked. ${tape.kind === 'change' ? '✓ or ✗ on a sentence counts for its verb form, like a Verbs card.' : 'Listening doesn’t change your vocabulary progress.'}</p>
    ${room === 'verbs' && tape.kind === 'verbs' ? `<p class="wm-choice wm-tenses">Tenses ${Object.entries(VB_TENSES).map(([tense, label]) => `<button data-action="walkman-tense" data-tense="${tense}" aria-pressed="${verbTenses.includes(tense)}">${esc(label)}</button>`).join('<span aria-hidden="true">·</span>')}</p>` : ''}
    ${room === 'words' ? `<p class="wm-choice">Plays ${Object.entries(WALKMAN_CHOICES).map(([choice, label]) => `<button data-action="walkman-choice" data-words="${choice}" aria-pressed="${walkmanChoice === choice}">${label}</button>`).join('<span aria-hidden="true">·</span>')}</p>` : ''}
  </section>`;
}
const HEARD_STATUS = { saving: 'Adding…', added: 'Added to your words', 'already-practising': 'Already in your practice', 'made-due': 'Due again now' };
function heardHTML() {
  const rows = walkmanHeard.map((entry) => {
    const add = entry.added
      ? `<span class="wm-heard-status" role="status">${esc(HEARD_STATUS[entry.added] || '')}</span>`
      : entry.fresh ? `<button class="wm-heard-add" data-action="walkman-add" data-word="${esc(entry.id)}">Add to my words</button>` : '';
    // A sentence is heard for its meaning only: it has no score to mark and nothing to add.
    const marks = entry.sentence ? '' : [[true, checkIcon, 'I knew'], [false, crossIcon, 'I didn’t know']].map(([knew, icon, label]) =>
      `<button class="icon mark ${knew ? 'knew' : 'missed'}" data-action="walkman-mark" data-word="${esc(entry.id)}" data-knew="${knew}" aria-pressed="${entry.mark?.knew === knew}" aria-label="${label} ${esc(entry.fr)}"${heardMarking.has(entry.id) || (entry.verb && entry.mark) ? ' disabled' : ''}>${icon}</button>`).join('');
    return `<li class="wm-heard-row${entry.sentence ? ' sentence' : ''}"><div class="wm-heard-text"><p class="wm-heard-fr" lang="${languageTag}">${frEsc(entry.fr)}</p><p class="wm-heard-en">${esc(entry.en)}</p>${add}</div>${marks}<button class="icon${heardSaying === entry.id ? ' playing' : ''}" data-action="walkman-say" data-word="${esc(entry.id)}" aria-label="Hear ${esc(entry.fr)} again">${speaker}</button></li>`;
  }).join('');
  const list = heardOpen ? `<ol class="wm-heard-list">${rows || '<li class="wm-heard-empty">Words and sentences appear here as each one finishes, newest first.</li>'}</ol>` : '';
  return `<div class="wm-heard"><button class="wm-heard-toggle" data-action="walkman-heard" aria-expanded="${heardOpen}"><span>${heardOpen ? 'Hide what you heard' : 'What you heard'}</span><span class="chev" aria-hidden="true">⌄</span></button>${list}</div>`;
}
// A word joins the history once it has finished, or once the tape moves on after its meaning was heard.
function logHeard(position) {
  if (walkman.logged.has(position)) return false;
  walkman.logged.add(position);
  const word = walkman.tape.words[position];
  const previous = walkmanHeard.find((entry) => entry.id === word.id);
  const added = previous?.added && previous.added !== 'saving' ? { added: previous.added } : {};
  walkmanHeard = [{ id: word.id, fr: word.fr, en: word.en, fresh: word.fresh, ...(word.sentence ? { sentence: true } : {}), ...(word.verb ? { verb: word.verb } : {}), ...added }, ...walkmanHeard.filter((entry) => entry.id !== word.id)].slice(0, HEARD_LIMIT);
  saveHeard();
  // Hearing a word to the end raises its score a little; a lost report only costs that little. A sentence
  // leaves the vocabulary alone; a Change it drill heard waits behind those not heard yet.
  if (word.change) api('api/change/heard', { method: 'POST', body: JSON.stringify({ id: word.change.id, requestId: requestId() }), keepalive: true }).catch(() => {});
  else if (!word.sentence && !word.verb) api('api/walkman/heard', { method: 'POST', body: JSON.stringify({ wordId: word.id, requestId: requestId() }), keepalive: true }).catch(() => {});
  return true;
}
// A form heard on the verb tape is marked like a Verbs card: saved as an answer, so it can't be taken back.
async function markHeardForm(entry, knew) {
  if (entry.mark) return;
  const markId = requestId();
  entry.mark = { id: markId, knew };
  heardMarking.add(entry.id); render();
  try {
    await api('api/verbs/mark', { method: 'POST', body: JSON.stringify({ requestId: markId, verbId: entry.verb.verbId, tense: entry.verb.tense, person: entry.verb.person, knew }) });
  } catch (error) {
    entry.mark = undefined;
    notice = { message: error.message };
  }
  heardMarking.delete(entry.id);
  saveHeard();
  render();
}
// Hearing a word or sentence again pauses the tape, plays it alone, then carries on if the tape was playing.
let heardResume = false;
async function hearAgain(id) {
  const entry = walkmanHeard.find((item) => item.id === id);
  if (!walkmanAudio.paused) { heardResume = true; walkmanAudio.pause(); }
  heardSaying = id; render();
  const token = ++audioGeneration;
  await playClip(entry?.verb ? entry.verb.audio : entry?.sentence ? sentenceClipUrl(id) : wordClipUrl(id), token);
  if (token !== audioGeneration) return;
  heardSaying = '';
  if (!tapeScreen()) return;
  if (heardResume) playWalkman(); else render();
}
// Marking a listen as known or not moves the word's score like a recall or a miss; tapping the same mark
// again takes it back. The listen keeps one mark id, so changing your mind replaces the mark.
async function markHeard(id, knew) {
  const entry = walkmanHeard.find((item) => item.id === id);
  if (!entry || heardMarking.has(id)) return;
  if (entry.verb) return markHeardForm(entry, knew);
  const before = entry.mark;
  const next = before?.knew === knew ? null : knew;
  const markId = before?.id || requestId();
  entry.mark = next === null ? undefined : { id: markId, knew: next };
  heardMarking.add(id); render();
  try {
    await api('api/walkman/verdict', { method: 'POST', body: JSON.stringify({ id: markId, wordId: id, knew: next }) });
  } catch (error) {
    entry.mark = before;
    notice = { message: error.message };
  }
  heardMarking.delete(id);
  saveHeard();
  if (tapeScreen()) render();
}
async function addHeard(id) {
  const entry = walkmanHeard.find((item) => item.id === id);
  if (!entry || entry.added) return;
  entry.added = 'saving'; render();
  try {
    const result = await api('api/vocabulary/add', { method: 'POST', body: JSON.stringify({ wordId: id, requestId: requestId() }) });
    entry.added = HEARD_STATUS[result.status] ? result.status : 'added';
    announce(HEARD_STATUS[entry.added]);
  } catch (error) {
    delete entry.added;
    notice = { message: error.message };
  }
  saveHeard();
  if (tapeScreen()) render();
}
function walkmanProgress() {
  const seconds = walkman.tape?.seconds;
  return seconds ? Math.min(100, (walkmanAudio.currentTime / seconds) * 100).toFixed(2) : 0;
}
async function loadTape(autoplay = false) {
  const token = ++walkmanGeneration;
  walkman = { tape: null, index: -1, meaning: false, loading: true, started: autoplay, logged: new Set() };
  notice = null; retryAction = null;
  render();
  try {
    const kind = tapeKind(), on = screen;
    const tape = await api('api/walkman', { method: 'POST', body: JSON.stringify({ words: kind, ...(kind === 'verbs' ? { tenses: verbTenses } : kind === 'change' ? { practising: vbPractising() } : {}) }) });
    if (token !== walkmanGeneration || screen !== on) return;
    walkman = { ...walkman, tape, loading: false };
    walkmanAudio.src = tape.url;
    walkmanAudio.playbackRate = speed; walkmanAudio.preservesPitch = true; walkmanAudio.webkitPreservesPitch = true;
    render();
    if (autoplay) playWalkman();
  } catch (error) {
    if (token !== walkmanGeneration) return;
    walkman = { ...walkman, loading: false };
    notice = { message: error.message }; retryAction = { type: 'walkman' };
    render();
  }
}
async function playWalkman() {
  mediaPlayer = 'walkman';
  heardResume = false;
  if (heardSaying) { heardSaying = ''; stopAudio(); }
  walkmanAudio.playbackRate = speed;
  try {
    await walkmanAudio.play();
    walkman.started = true;
  } catch (error) {
    // NotAllowedError: the browser wants a tap on the page before sound (a link opening the Walkman); Play waits for it.
    if (error.name !== 'AbortError' && error.name !== 'NotAllowedError') { notice = { message: 'The tape could not start. Tap play to try again.' }; }
  }
  render();
}
function toggleWalkman() {
  if (!walkman.tape) return;
  if (walkmanAudio.paused) playWalkman(); else walkmanAudio.pause();
}
// The word playing at a moment is the last one to have started by then.
function walkmanWordAt(time) {
  const words = walkman.tape?.words ?? [];
  let low = 0, high = words.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (words[middle].start <= time) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found;
}
function followTape() {
  if (!walkman.tape) return;
  const time = walkmanAudio.currentTime;
  const index = walkmanWordAt(time);
  // On Change it the meaning is the answer, which comes after the pause to say it.
  const meaning = index >= 0 && time >= (walkman.tape.kind === 'change' ? walkman.tape.words[index].againAt : walkman.tape.words[index].meaningAt);
  let logged = false;
  if (walkman.index >= 0 && index !== walkman.index && walkman.meaning) logged = logHeard(walkman.index);
  if (index >= 0 && time >= walkman.tape.words[index].end) logged = logHeard(index) || logged;
  if (index !== walkman.index || meaning !== walkman.meaning) {
    walkman.index = index; walkman.meaning = meaning;
    const word = walkman.tape.words[index];
    if (word && 'mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: word.change ? word.change.base : word.fr, artist: meaning ? (word.change ? word.fr : word.en) : '…', album: 'Echo · Walkman', artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] });
    }
    if (tapeScreen() && !document.hidden) render();
    return;
  }
  if (logged && heardOpen && tapeScreen() && !document.hidden) { render(); return; }
  const bar = document.querySelector('.wm-progress span');
  if (bar) bar.style.width = `${walkmanProgress()}%`;
  const phase = walkmanPhase();
  // Change it's face follows each phase: the cue appears, then the answer replaces the sentence.
  if (walkman.tape.kind === 'change' && phase !== walkman.phase) { walkman.phase = phase; if (tapeScreen() && !document.hidden) { render(); return; } }
  for (const step of document.querySelectorAll('.wm-phase span')) step.classList.toggle('on', step.dataset.phase === phase);
}
// Lock-screen skip moves a whole word: forward to the next, back to this word's start or the one before.
function skipWord(step) {
  const words = walkman.tape?.words;
  if (!words?.length) return;
  const index = walkmanWordAt(walkmanAudio.currentTime);
  const into = index >= 0 ? walkmanAudio.currentTime - words[index].start : 0;
  const target = step > 0 ? index + 1 : into > 1.5 ? index : index - 1;
  walkmanAudio.currentTime = words[Math.max(0, Math.min(words.length - 1, target))].start;
}
walkmanAudio.addEventListener('timeupdate', followTape);
walkmanAudio.addEventListener('play', () => { if (tapeScreen()) render(); });
walkmanAudio.addEventListener('pause', () => { if (tapeScreen()) render(); });
// A finished tape winds straight on to a new one, chosen afresh.
walkmanAudio.addEventListener('ended', () => { if (tapeScreen()) loadTape(true); });
walkmanAudio.addEventListener('error', () => {
  if (!tapeScreen() || !walkman.tape) return;
  notice = { message: 'The tape stopped loading. Retry for a new one.' }; retryAction = { type: 'walkman' }; render();
});
// ── Radio ────────────────────────────────────────────────────────────────────
// One episode a day (lib/radio.ts): today's words in sentences, the story read line by line, a grammar point.
// Like the Walkman it is one MP3, so it plays on with the phone locked; the part playing is shown as it goes.
const radioAudio = new Audio();
let radio = { view: null, index: -1, loading: false };
let radioPoll = 0;
let mediaPlayer = 'walkman';    // which player the lock-screen buttons control: the one that last started
function openRadio() { if (move('radio', true)) loadRadio(); }
async function loadRadio(quiet = false) {
  clearTimeout(radioPoll);
  if (!quiet) { radio.loading = true; notice = null; retryAction = null; render(); }
  try {
    const view = await api('api/radio');
    if (view.url && radio.view?.url !== view.url) { radioAudio.src = view.url; radio.index = -1; }
    radio.view = view;
  } catch (error) { if (!quiet) { notice = { message: error.message }; retryAction = { type: 'radio' }; } }
  radio.loading = false;
  if (screen !== 'radio') return;
  render();
  if (radio.view?.state === 'preparing') radioPoll = setTimeout(() => { if (screen === 'radio') loadRadio(true); }, 15000);
}
function radioAt(time) {
  const segments = radio.view?.segments ?? [];
  let found = -1;
  for (let index = 0; index < segments.length && segments[index].start <= time; index++) found = index;
  return found;
}
function radioProgress() { const seconds = radio.view?.seconds; return seconds ? Math.min(100, (radioAudio.currentTime / seconds) * 100).toFixed(2) : 0; }
async function playRadio() {
  mediaPlayer = 'radio';
  radioAudio.playbackRate = speed; radioAudio.preservesPitch = true; radioAudio.webkitPreservesPitch = true;
  try { await radioAudio.play(); } catch (error) { if (error.name !== 'AbortError') notice = { message: 'The Radio could not start. Tap play to try again.' }; }
  render();
}
function toggleRadio() { if (!radio.view?.url) return; if (radioAudio.paused) playRadio(); else radioAudio.pause(); }
// Lock-screen skip moves a whole part: forward to the next, back to this part's start or the one before.
function skipRadio(step) {
  const segments = radio.view?.segments;
  if (!segments?.length) return;
  const index = radioAt(radioAudio.currentTime);
  const into = index >= 0 ? radioAudio.currentTime - segments[index].start : 0;
  const target = step > 0 ? index + 1 : into > 1.5 ? index : index - 1;
  radioAudio.currentTime = segments[Math.max(0, Math.min(segments.length - 1, target))].start;
}
function followRadio() {
  const index = radioAt(radioAudio.currentTime);
  if (index !== radio.index) {
    radio.index = index;
    const part = radio.view?.segments[index];
    if (part && 'mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: part.fr || part.en || part.label, artist: part.fr ? part.en || '' : part.label, album: 'Echo · Radio', artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] });
    if (screen === 'radio' && !document.hidden) render();
    return;
  }
  const bar = document.querySelector('.radio .wm-progress span');
  if (bar) bar.style.width = `${radioProgress()}%`;
}
radioAudio.addEventListener('timeupdate', followRadio);
for (const event of ['play', 'pause', 'ended']) radioAudio.addEventListener(event, () => { if (screen === 'radio') render(); });
radioAudio.addEventListener('error', () => {
  if (screen !== 'radio' || !radio.view?.url) return;
  notice = { message: 'The Radio stopped loading. Retry to tune in again.' }; retryAction = { type: 'radio' }; radio.view = null; render();
});
const SECTION_TITLE = { intro: 'Echo Radio', words: 'Your words', story: 'The story', grammar: 'Grammar', outro: 'Echo Radio' };
function renderRadio() {
  const header = `<div class="section-top">${back('Home', 'home')}<div><span class="stream-label">Radio</span>${infoButton('radio')}</div></div>`;
  const view = radio.view;
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="stream walkman radio">${header}${body}</section>`; };
  if (!view) { shell(radio.loading ? '<div class="loading-state" role="status">Tuning in…</div>' : ''); return; }
  if (view.state !== 'ready') {
    shell(`<div class="song-progress" role="status">${view.state === 'failed' ? `<p class="song-error">Today’s episode could not be made: ${esc(view.error || 'unknown error')}</p><p class="caption">Echo tries again in half an hour.</p>` : '<p>Today’s episode is being made: your words, the story and a little grammar. It takes a few minutes.</p>'}</div>`);
    return;
  }
  const part = view.segments[radio.index];
  const playing = !radioAudio.paused;
  const face = part
    ? `<p class="wm-hint">${esc(SECTION_TITLE[part.section])}${part.label !== SECTION_TITLE[part.section] ? ` · ${esc(part.label)}` : ''}</p>${part.fr ? `<p class="wm-fr" lang="${languageTag}">${frEsc(part.fr)}</p>` : ''}<p class="wm-en">${esc(part.en || '')}</p>`
    : `<p class="wm-hint">Today’s episode, ${Math.max(1, Math.round(view.seconds / 60))} minutes: your words in sentences, the story, and a little grammar.</p>`;
  const sections = view.segments.filter((segment, index, all) => segment.section !== 'intro' && segment.section !== 'outro' && all.findIndex((other) => other.section === segment.section) === index);
  const chapters = sections.map((segment) => `<button class="secondary chip" data-action="radio-seek" data-at="${segment.start}">${esc(SECTION_TITLE[segment.section])}</button>`).join('');
  shell(`<div class="wm-face" aria-live="polite">${face}</div>
    <div class="wm-controls"><button class="listen-play wm-play" data-action="radio-toggle" aria-label="${playing ? 'Pause' : 'Play'}">${playing ? pauseIcon : playIcon}</button></div>
    <div class="wm-progress" aria-hidden="true"><span style="width:${radioProgress()}%"></span></div>
    ${chapters ? `<div class="radio-chapters" role="group" aria-label="Jump to">${chapters}</div>` : ''}`);
}
// ── News ─────────────────────────────────────────────────────────────────────
// RFI's Journal en français facile (lib/news.ts): the editions in the News tab of Listen, and one edition read like a
// song's lyrics with its recording under it. The recording is one MP3 on its own audio element, so it plays on with
// the phone locked; once its lines are timed, the line playing is marked and any line can be played from.
const newsAudio = new Audio();
let newsList = null;        // api/news
let newsDate = '';          // the edition open, yyyymmdd
let newsView = null;        // api/news/<date>
let newsAt = -1;            // the line playing, or where it paused; -1 before it starts or once it ends
const newsLines = new Set(); // "stanza.line" keys whose meaning is showing
let newsPoll = 0;
const NEWS_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const newsDay = (date) => NEWS_DAY.format(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6))));
// Every line of the open edition in reading order, with its place in the stanzas.
const newsPlaces = () => (newsView?.stanzas || []).flatMap((stanza, s) => stanza.map((line, l) => ({ line, s, l })));
const newsLoaded = () => !!newsView?.audio && newsAudio.dataset.url === newsView.audio;
const newsPlaying = () => newsLoaded() && !newsAudio.paused;
function newsStateLine(edition) {
  if (edition.status === 'ready') return 'Ready';
  if (edition.status === 'failed') return `Could not be prepared: ${edition.error}`;
  if (edition.status === 'preparing') return edition.step === 'text' ? 'Fetching the transcript…' : edition.step === 'audio' ? 'Downloading the recording…' : edition.step === 'timing' ? 'Timing the lines…' : `Writing the notes…${edition.total ? ` ${edition.done} of ${edition.total} lines` : ''}`;
  return edition.step === 'notes' ? 'Ready to hear; its notes are waiting their turn' : 'Waiting its turn';
}
async function loadNews(quiet = false) {
  clearTimeout(newsPoll);
  if (!quiet && !newsList) { loading = true; render(); }
  try { newsList = await api('api/news'); }
  catch (error) { if (!quiet) { notice = { message: error.message }; retryAction = { type: 'news' }; } }
  loading = false;
  if (screen !== 'news') return;
  render();
  // The list is looked at again while an edition is on its way, or before the first editions have been found.
  const coming = newsList && (newsList.editions.some((edition) => edition.status === 'preparing' || edition.status === 'waiting') || (!newsList.editions.length && !newsList.error));
  if (coming) newsPoll = setTimeout(() => { if (screen === 'news') loadNews(true); }, 15000);
}
function renderNews() {
  const header = listenTop();
  if (!newsList) { main.innerHTML = `${noticeHTML()}<section class="topics songs">${header}${loading ? '<div class="loading-state" role="status">Loading…</div>' : ''}</section>`; return; }
  const rows = newsList.editions.map((edition) => `<li><button class="song-row" data-action="news-open" data-date="${esc(edition.date)}"><span class="song-copy"><strong>${esc(newsDay(edition.date))}</strong>${edition.headlines.length ? `<span lang="${languageTag}">${edition.headlines.map(esc).join(' · ')}</span>` : ''}<small class="song-state ${edition.status}">${esc(newsStateLine(edition))}</small>${edition.status === 'preparing' ? '<span class="song-bar busy"><span></span></span>' : ''}</span><span class="arrow" aria-hidden="true">→</span></button></li>`).join('');
  const trouble = newsList.error ? `<p class="song-error">New editions could not be looked for: ${esc(newsList.error)} Echo tries again within half an hour.</p>` : '';
  const empty = !rows && !trouble ? '<p class="song-hint" role="status">Looking for the latest editions on RFI…</p>' : '';
  main.innerHTML = `${noticeHTML()}<section class="topics songs">${header}<p class="subtitle">RFI’s <span lang="fr">Journal en français facile</span>: ten minutes of the world’s news in slow French, Monday to Friday, read by RFI’s presenters. Read it line by line while you listen.</p>${trouble}${empty}${rows ? `<ol class="song-results news-list">${rows}</ol>` : ''}</section>`;
}
function openNewsEdition(date) { if (move(`news-edition|${date}`, true)) loadNewsEdition(); }
async function loadNewsEdition(quiet = false) {
  clearTimeout(newsPoll);
  const date = newsDate;
  if (!quiet && newsView?.date !== date) { newsView = null; loading = true; render(); }
  let changed = !quiet;
  try {
    const view = await api(`api/news/${encodeURIComponent(date)}`);
    if (newsDate !== date) return;
    if (newsView?.date !== date) { newsLines.clear(); newsAt = -1; if (newsAudio.dataset.url) { newsAudio.pause(); newsAudio.removeAttribute('src'); delete newsAudio.dataset.url; } }
    const shape = (entry) => entry && `${entry.status}|${entry.step}|${entry.done}|${entry.noted}|${!!entry.starts}|${!!entry.audio}`;
    changed ||= shape(view) !== shape(newsView);
    newsView = view;
  } catch (error) { if (!quiet) { notice = { message: error.message }; retryAction = { type: 'news-edition' }; } }
  loading = false;
  if (screen !== 'news-edition') return;
  if (changed) render();
  if (newsView && newsView.status !== 'ready' && newsView.status !== 'failed') newsPoll = setTimeout(() => { if (screen === 'news-edition' && newsDate === date) loadNewsEdition(true); }, 10000);
}
function newsLineHTML({ line, s, l }, index) {
  const key = `${s}.${l}`;
  const open = newsLines.has(key);
  const start = line.en ? `<button class="lyric-start" data-action="news-line" data-line="${key}" aria-expanded="${open}" aria-label="What this line means">›</button>` : '<span class="lyric-start" aria-hidden="true"></span>';
  const from = newsView.starts && newsView.audio ? `<button class="news-from" data-action="news-from" data-index="${index}" aria-label="Play from this line">${playIcon}</button>` : '';
  const current = index === newsAt && newsLoaded();
  return `<div class="lyric-line news-line${current ? ' playing' : ''}" data-line="${key}" data-index="${index}">${start}<div class="lyric-text"><p lang="${languageTag}">${glossedHTML(line.fr, line.words)}</p>${open ? `<p class="lyric-en">${esc(line.en)}</p>` : ''}</div>${from}</div>`;
}
function newsPlayerHTML() {
  const view = newsView;
  if (!view.audio) return `<div class="news-player"><p class="caption">${view.status === 'failed' ? 'The recording is not here yet.' : 'The recording is on its way.'}</p></div>`;
  const playing = newsPlaying();
  const total = newsPlaces().length;
  const hint = !view.starts ? 'The lines are being timed; it plays from the start meanwhile.' : newsAt >= 0 && newsLoaded() ? `${playing ? 'line' : 'stopped at line'} ${newsAt + 1} of ${total}` : '';
  return `<div class="news-player"><div class="listen-block"><button class="primary reading-play" data-action="news-play" aria-label="${playing ? 'Pause' : 'Play'}">${playing ? pauseIcon : playIcon}<span>${playing ? 'Pause' : 'Play'}</span></button><p class="listen-hint" id="news-progress" role="status">${esc(hint)}</p></div></div>`;
}
function renderNewsEdition() {
  const header = `<div class="section-top">${back('News', 'news')}<div>${infoButton('listen')}</div></div>`;
  const view = newsView;
  if (!view) { main.innerHTML = `${noticeHTML()}<section class="topics songs lyrics">${header}${loading ? '<div class="loading-state" role="status">Opening the news…</div>' : ''}</section>`; return; }
  const status = view.status === 'failed' ? `<div class="song-progress"><p class="song-error">${esc(view.error)}</p><p class="caption">Echo tries again within half an hour.</p></div>`
    : view.noted ? '<p class="song-hint">Tap › at the start of a line for what it means, or tap a word for its note. ▶ plays from that line.</p>'
    : view.status === 'preparing' && view.step === 'notes' ? `<div class="song-progress" role="status"><p>Writing the notes… ${view.done} of ${view.total} lines</p><span class="song-bar"><span style="width:${view.total ? view.done / view.total * 100 : 0}%"></span></span><p class="caption">Claude translates every line and explains its words. The transcript is here meanwhile; the notes appear when they are all written.</p></div>`
    : `<p class="song-hint" role="status">${esc(newsStateLine(view))}</p>`;
  let index = 0;
  const lines = view.stanzas.map((stanza, s) => `<div class="lyric-stanza">${stanza.map((line, l) => newsLineHTML({ line, s, l }, index++)).join('')}</div>`).join('');
  main.innerHTML = `${noticeHTML()}<section class="topics songs lyrics news">${header}<p class="reading-kicker">RFI · Journal en français facile</p><h1>${esc(newsDay(view.date))}</h1>${view.headlines.length ? `<ul class="news-headlines" lang="${languageTag}">${view.headlines.map((headline) => `<li>${esc(headline)}</li>`).join('')}</ul>` : ''}${status}<div class="lyric-lines">${lines}</div>${newsPlayerHTML()}</section>`;
}
// Plays from the start of a line; without line times, on from where it is (the start, at first).
async function playNews(index = Math.max(0, newsAt)) {
  const view = newsView;
  if (!view?.audio) return;
  stopAudio();
  mediaPlayer = 'news';
  const at = view.starts ? view.starts[Math.min(index, view.starts.length - 1)] ?? 0 : newsLoaded() ? newsAudio.currentTime : 0;
  if (!newsLoaded()) { newsAudio.src = `${view.audio}#t=${at}`; newsAudio.dataset.url = view.audio; }
  else newsAudio.currentTime = at;
  if (view.starts && index !== newsAt) { const before = newsAt; newsAt = index; markNewsLines(before, index); }
  if (!view.starts && 'mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: view.headlines.join(' · ') || 'Journal en français facile', artist: 'RFI', album: `Echo · News, ${newsDay(view.date)}`, artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] });
  newsAudio.playbackRate = speed; newsAudio.preservesPitch = true; newsAudio.webkitPreservesPitch = true;
  try { await newsAudio.play(); } catch (error) { if (error.name !== 'AbortError') { notice = { message: 'The news could not start. Tap Play to try again.' }; render(); } }
}
function toggleNews() { if (newsPlaying()) newsAudio.pause(); else playNews(); }
// Lock-screen skip moves a whole line: forward to the next, back to this line's start or the one before.
function skipNews(step) {
  const starts = newsView?.starts;
  if (!starts || !newsLoaded()) return;
  const index = Math.max(0, newsAt);
  const target = step > 0 ? index + 1 : newsAudio.currentTime - starts[index] > 1.5 ? index : index - 1;
  if (target < starts.length) newsAudio.currentTime = starts[Math.max(0, target)];
}
function followNews() {
  const starts = newsView?.starts;
  if (!starts || !newsLoaded()) return;
  let index = -1;
  for (let line = 0; line < starts.length && starts[line] <= newsAudio.currentTime + 0.01; line++) index = line;
  if (index === newsAt) return;
  const before = newsAt;
  newsAt = index;
  const line = newsPlaces()[index]?.line;
  if (line && 'mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: line.fr, artist: line.en || 'RFI', album: `Echo · News, ${newsDay(newsView.date)}`, artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] });
  if (screen === 'news-edition' && !document.hidden) markNewsLines(before, index);
}
// Redraws only the lines whose mark changed and the player, so reading is undisturbed. While the line before was in
// sight, the new one is brought into sight too, so the page follows the voice.
function markNewsLines(before, index) {
  if (screen !== 'news-edition' || !newsView) return;
  const places = newsPlaces();
  const element = (at) => main.querySelector(`.news-line[data-index="${at}"]`);
  const player = main.querySelector('.news-player');
  const inSight = (node) => { const box = node?.getBoundingClientRect(); return !!box && box.top >= 0 && box.bottom <= window.innerHeight - (player?.offsetHeight ?? 0); };
  const following = before < 0 || inSight(element(before));
  for (const at of new Set([before, index])) { const node = element(at); if (node && places[at]) node.outerHTML = newsLineHTML(places[at], at); }
  if (player) player.outerHTML = newsPlayerHTML();
  const now = element(index);
  if (following && newsPlaying() && now && !inSight(now)) now.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
newsAudio.addEventListener('timeupdate', followNews);
for (const event of ['play', 'pause']) newsAudio.addEventListener(event, () => markNewsLines(newsAt, newsAt));
newsAudio.addEventListener('ended', () => { const last = newsAt; newsAt = -1; markNewsLines(last, -1); });
newsAudio.addEventListener('error', () => {
  if (screen !== 'news-edition' || !newsAudio.dataset.url) return;
  delete newsAudio.dataset.url; notice = { message: 'The news stopped loading. Tap Play to try again.' }; render();
});
if ('mediaSession' in navigator) {
  const player = () => mediaPlayer === 'radio' ? { play: playRadio, audio: radioAudio, skip: skipRadio } : mediaPlayer === 'story' ? { play: playStory, audio: storyAudio, skip: skipStory } : mediaPlayer === 'news' ? { play: playNews, audio: newsAudio, skip: skipNews } : { play: playWalkman, audio: walkmanAudio, skip: skipWord };
  navigator.mediaSession.setActionHandler('play', () => player().play());
  navigator.mediaSession.setActionHandler('pause', () => player().audio.pause());
  navigator.mediaSession.setActionHandler('nexttrack', () => player().skip(1));
  navigator.mediaSession.setActionHandler('previoustrack', () => player().skip(-1));
}
function availabilityCopy() {
  const parts = [];
  const elsewhere = snapshot.overview.remaining + snapshot.overview.newAvailable;
  if (deck !== 'all' && snapshot.stats.newAvailable === 0 && elsewhere > 0) parts.push(`${formatCount(elsewhere)} ${elsewhere === 1 ? 'word is' : 'words are'} waiting in other categories. Choose All words in Words options to continue.`);
  if (snapshot.nextDue) parts.push(`Next review: ${dateLabel(snapshot.nextDue)}.`);
  const recording = snapshot.stats.recording || 0;
  if (recording > 0 && snapshot.stats.newAvailable === 0) parts.push(`${formatCount(recording)} ${recording === 1 ? 'word is' : 'words are'} still being recorded on your Mac. Each one joins your practice as soon as it is ready.`);
  if (snapshot.stats.unseen - recording > 0 && snapshot.stats.newAvailable === 0) parts.push(snapshot.settings.newPerDay === 0 ? 'New words are paused with your daily allowance at 0.' : 'New words return with your next daily allowance at 04:00 on your Mac, or add extra words below.');
  return parts.join(' ') || 'You’re up to date in this vocabulary selection.';
}
let extraScope = 0;
// titled: the end of the cards shows it under its own heading; More for today (in Your words) is the dialog's title.
function extraPracticeHTML(titled = true) {
  const stats = snapshot.stats;
  // Unique per render: the dialog can open over the end screen, which renders this too.
  const scope = ++extraScope;
  const off = (enabled) => (enabled && !locked() ? '' : 'disabled');
  const chip = (attrs, text, label, enabled) => `<button class="secondary chip" ${attrs} aria-label="${esc(label)}" ${off(enabled)}>${text}</button>`;
  const custom = (kind, mode, label, verb, enabled) => {
    const id = `custom-${kind}-${mode || 'new'}-${scope}`;
    return `<form class="custom-count" data-kind="${kind}" ${mode ? `data-mode="${mode}"` : ''} novalidate><label class="sr-only" for="${id}">${esc(label)}</label><input id="${id}" type="number" inputmode="numeric" min="1" step="1" placeholder="Custom" ${off(enabled)}><button class="secondary chip" type="submit" ${off(enabled)}>${verb}</button></form>`;
  };
  const row = (title, detail, controls) => `<div class="extra-row"><div><p>${title}</p><small>${esc(detail)}</small></div><div class="extra-controls">${controls}</div></div>`;
  const newDetail = !stats.unseen ? 'Every word here is already started' : snapshot.extraToday ? `${formatCount(snapshot.extraToday)} extra added today · resets at 04:00` : 'Today only · resets at 04:00';
  const review = (mode, available, noun) => `<div class="chips">${[15, 20, 30].map((count) => chip(`data-action="review-early" data-mode="${mode}" data-count="${count}"`, count, `Review ${count} ${noun}`, available > 0)).join('')}</div>${custom('review-early', mode, `How many ${noun} to review`, 'Review', available > 0)}`;
  const extra = `<div class="chips">${[15, 20, 30].map((count) => chip(`data-action="extra-words" data-count="${count}"`, `+${count}`, `Add ${count} new words today`, stats.unseen > 0)).join('')}</div>${custom('extra-words', '', 'How many new words to add today', 'Add', stats.unseen > 0)}`;
  return `<section class="extra-practice" ${titled ? `aria-labelledby="extra-title-${scope}"` : ''}>${titled ? `<h2 id="extra-title-${scope}">Extra practice</h2>` : ''}
    ${row('New words today', newDetail, extra)}
    ${row('Review due soonest', stats.scheduled ? `${formatCount(stats.scheduled)} waiting for a later review` : 'No finished words are waiting', review('soonest', stats.scheduled, 'words due soonest'))}
    ${row('Review most missed', stats.scheduledMissed ? `${formatCount(stats.scheduledMissed)} missed at least once` : 'No missed words are waiting', review('missed', stats.scheduledMissed, 'most-missed words'))}
    <p class="caption">Asking for more than are available takes all of them. An early review counts: finishing it updates the word’s schedule, with a smaller step because it came early.</p></section>`;
}
function submitCustomCount(form) {
  const input = form.querySelector('input');
  const value = Number(input.value.trim());
  if (!input.value.trim() || !Number.isInteger(value) || value < 1) {
    input.setAttribute('aria-invalid', 'true'); input.focus(); announce('Enter a whole number of 1 or more.'); return;
  }
  extraPractice(form.dataset.kind, { count: value, mode: form.dataset.mode });
}
// Extra words and early reviews are daily cards, so they open on the Cards tab of Words.
function extraPractice(type, data) {
  if (locked() || !snapshot) return;
  if (dialog.open) dialog.close();
  if (vocabMode !== 'daily') { vocabMode = 'daily'; savePreference('echo.vocab-mode', 'daily'); endless = null; revealed = false; }
  wordsTab = 'cards'; savePreference('echo.words-tab', 'cards');
  runMutation({ type, body: { direction, deck, count: Number(data.count), requestId: requestId(), ...(type === 'review-early' ? { mode: data.mode } : {}) } });
}
// A word missed often: how often, and the words of its deck missed most with it, side by side to tell apart.
function troubleHTML(trouble) {
  const list = trouble.alongside.length ? `<ul>${trouble.alongside.map((word) => `<li><span lang="${languageTag}" class="${genderClass(word.gender).trim()}">${frEsc(word.fr)}</span> <span class="en">${esc(word.en)}</span></li>`).join('')}</ul>` : '';
  const hook = trouble.hook ? `<p class="word-hook">${esc(trouble.hook)}</p>` : '';
  return `<div class="word-trouble">${hook}<p>Missed ${trouble.misses} times${trouble.alongside.length ? '. Often missed with it:' : '.'}</p>${list}</div>`;
}
// The flashcard itself: shared by the Vocabulary screen and the Practise stream.
function cardHTML(card = snapshot.current, undoable = !!snapshot.undoId) {
  const reverse = direction === 'en-fr';
  const prompt = reverse ? card.en : card.fr;
  const answer = reverse ? card.fr : card.en;
  const hidden = listening() && !revealed;
  // Say, on this card: the verdict once Say turned it, and Say's foot instead of "Tap to reveal" before.
  const saying = sayHere();
  const verdict = saying && revealed && say.phase === 'result' && say.key === cardKey(card) ? say.result : null;
  const right = verdict?.verdict === 'right';
  // The noun's gender, in words, wherever the learnt word is showing (the colour alone is optional).
  const gender = card.gender && (revealed || !reverse) ? `<p class="gender-tag${genderClass(card.gender)}">${esc(GENDERS[card.gender]?.[1] ?? card.gender)}</p>` : '';
  const face = hidden
    ? `<button class="listen-play" data-action="replay" aria-label="Play the ${languageEnglish} word again">${speaker}</button>${saying ? '' : '<p class="source-word">Listen, then tap to see the word</p>'}`
    : `${verdict ? sayVerdictHTML() : ''}<h1 class="main-word${(revealed ? reverse : !reverse) ? genderClass(card.gender) : ''}" lang="${(revealed ? reverse : !reverse) ? languageTag : 'en'}">${esc(revealed ? answer : prompt)}</h1>${revealed ? `<p class="source-word${revealed && !reverse ? genderClass(card.gender) : ''}" lang="${reverse ? 'en' : languageTag}">${esc(prompt)}</p>${gender}${card.note ? `<p class="word-note">${esc(card.note)}</p>` : ''}${card.trouble ? troubleHTML(card.trouble) : ''}` : gender}`;
  // How this card is practised, in French → English: Read, Listen, and Speak where it is offered.
  const ways = direction === 'fr-en' ? [['read', 'Read', eyeIcon], ['listen', 'Listen', headphones], ...(speakOffered() ? [['speak', 'Speak', micIcon]] : [])] : [];
  const wayChoice = ways.length ? `<div class="practice-way" role="group" aria-label="How you practise">${ways.map(([way, title, icon]) => `<button data-action="practice-way" data-way="${way}" aria-pressed="${wayNow() === way}">${icon}<span>${title}</span></button>`).join('')}</div>` : '';
  const zones = `<button class="card-zone left" data-action="again" aria-label="Didn’t know this word" ${locked() ? 'disabled' : ''}><span class="zone-label${verdict && !right ? ' picked' : ''}" aria-hidden="true">← Didn’t know</span></button><button class="card-zone right" data-action="known" aria-label="Knew this word" ${locked() ? 'disabled' : ''}><span class="zone-label${right ? ' picked' : ''}" aria-hidden="true">Knew it →</span></button>`;
  const foot = revealed ? zones : saying ? sayFootHTML() : hidden ? '' : '<span class="card-hint" aria-hidden="true">Tap to reveal</span>';
  const label = revealed ? 'Revealed flashcard. Left: didn’t know. Right: knew it.' : saying && !say.running ? 'Start speaking' : hidden ? 'Reveal the meaning' : 'Reveal the translation';
  return `<div class="study-surface ${revealed ? 'revealed' : ''}${verdict ? ` say-${right ? 'right' : 'wrong'}` : ''}" id="flashcard" role="${revealed ? 'group' : 'button'}" tabindex="${revealed ? '-1' : '0'}" aria-label="${label}" aria-busy="${busy}"><div class="word-content">${face}</div>${foot}</div>${saying ? sayControlsHTML() : ''}<div class="study-tools">${wayChoice}<button class="quiet" data-action="undo" ${!undoable || locked() ? 'disabled' : ''}>Undo</button></div>`;
}
// Each new card (or new version after a grade or undo) plays once on its own; re-renders don't replay it.
function playCardOnce() {
  const card = shownCard();
  // Say plays the French itself, in turn with listening.
  if (!card || !listening() || revealed || say.running) return;
  const key = `${card.id}:${card.version}:${card.serial ?? ''}`;
  if (key === heardCard) return;
  heardCard = key; playFrench(card.audioUrl);
}
// A language whose deck is not written yet has nothing to practise, and offers nothing else.
const EMPTY_DECK = `<div class="completion"><h1>No words yet.</h1><p>The ${esc(languageEnglish)} deck is still being written.</p></div>`;
function renderPractice() {
  if (vocabMode === 'endless') { renderEndless(); return; }
  const header = wordsTop();
  if (!snapshot || loading) { main.innerHTML = `${noticeHTML()}<section class="practice">${header}<div class="loading-state" role="status">${loading ? 'Opening your vocabulary…' : 'Your progress is safe on your Mac.'}</div></section>`; return; }
  if (!totalWords()) { main.innerHTML = `${noticeHTML()}<section class="practice">${header}${EMPTY_DECK}</section>`; return; }
  if (!snapshot.current) {
    main.innerHTML = `${noticeHTML()}<section class="practice">${header}${workingCounts(categoryTitle(deck))}<div class="completion"><h1>A good place to pause.</h1><p>${esc(availabilityCopy())}</p><div class="summary-actions">${snapshot.stats.newAvailable > 0 ? `<button class="primary" data-action="start" ${locked() ? 'disabled' : ''}>Continue practice</button>` : ''}<button class="secondary" data-action="studied" ${busy ? 'disabled' : ''}>Your studied words</button><button class="secondary" data-action="families" ${busy ? 'disabled' : ''}>Word families</button><button class="secondary" data-action="grammar" ${busy ? 'disabled' : ''}>Explore grammar</button>${snapshot.undoId ? `<button class="quiet" data-action="undo" ${locked() ? 'disabled' : ''}>Undo last answer</button>` : ''}</div>${extraPracticeHTML()}</div></section>`; return;
  }
  main.innerHTML = `${noticeHTML()}<section class="practice">${header}${workingCounts(categoryTitle(deck))}${cardHTML()}</section>`;
  playCardOnce();
  warmClip(snapshot.current.audioUrl);
  warmClip(snapshot.next?.audioUrl);
}
function renderEndless() {
  const header = wordsTop();
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="practice">${header}${body}</section>`; };
  if (snapshot && !totalWords()) { shell(EMPTY_DECK); return; }
  if (!endless || endless.direction !== direction || endless.deck !== deck) { shell('<div class="loading-state" role="status">Choosing a word…</div>'); startEndless(); return; }
  const counts = `<span class="compact-line"><span class="compact-label" title="${esc(categoryTitle(deck))}">${esc(categoryTitle(deck))}</span><span class="compact-counts"><span class="unseen"><strong>Endless</strong></span><span class="separator" aria-hidden="true">·</span><span><strong>${formatCount(endless.pool)}</strong> ${endless.pool === 1 ? 'word' : 'words'}</span></span></span>`;
  const card = endless.cards[0];
  if (!card) {
    shell(endless.fetching || retryAction ? `${counts}<div class="loading-state" role="status">Choosing a word…</div>` : `${counts}<div class="completion"><h1>No words to practise here yet.</h1><p>Endless goes over words you have started. Practise a few in the daily mode first, or choose another category.</p></div>`);
    return;
  }
  shell(`${counts}${cardHTML(card, !!endless.last)}`);
  playCardOnce();
  for (const ahead of endless.cards) warmClip(ahead.audioUrl);
}
function renderBrowse() {
  const show = [['all', 'All words'], ['studied', 'Studied'], ['learning', 'Still learning'], ['missed', 'Missed at least once']].map(([value, label]) => `<option value="${value}" ${browseShow === value ? 'selected' : ''}>${label}</option>`).join('');
  // Word families and Word building are French's (content/families.json); another language's page has the room off.
  const more = [
    ...(roomsOff.has('families') ? [] : [
      ['families', 'Word families', 'Words built from one another; add a relative of one you know', ''],
      ['word-building', 'Word building', 'How French makes one word from another: -er, -eur, in-…', 'data-from="browse"'],
    ]),
    ['more-today', 'More for today', 'Extra new words, or finished words reviewed early', ''],
  ].map(([action, title, text, data]) => `<button class="topic-row" data-action="${action}" ${data} ${busy || (action === 'more-today' && !snapshot) ? 'disabled' : ''}><span class="copy"><span class="topic-name"><h3>${title}</h3></span><p>${esc(text)}</p></span><span class="arrow" aria-hidden="true">→</span></button>`).join('');
  main.innerHTML = `${noticeHTML()}<section class="topics browse"><div class="section-top">${back('Words', 'vocabulary')}<button class="icon" data-action="options" aria-label="Words options" ${!snapshot || busy ? 'disabled' : ''}>•••</button></div><h1>Your words</h1><p class="subtitle">Everything in your deck, and ways to add to it.</p><div class="topic-list">${more}</div><h2 class="story-heading">All your words · ${esc(directionLabel())}</h2><div class="browse-tools"><label class="sr-only" for="vocab-search">Search ${languageEnglish} or English vocabulary</label><input type="search" id="vocab-search" placeholder="Find a word…" value="${esc(search)}" autocomplete="off"><label class="sr-only" for="browse-category">Category</label><select id="browse-category">${optionsHTML(browseCategory)}</select></div><div class="browse-filters"><label class="sr-only" for="browse-show">Show</label><select id="browse-show">${show}</select><button class="secondary chip" data-action="toggle-hide" aria-pressed="${hideTranslations}">${hideTranslations ? 'Show translations' : 'Hide translations'}</button></div><div id="browse-results"></div></section>`;
  renderBrowseResults();
}
function normalized(value) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase(); }
// Each word's searchable text, normalized once rather than on every keystroke.
const searchKeys = new WeakMap();
function searchKey(word) {
  let key = searchKeys.get(word);
  if (key === undefined) { key = normalized(`${word.fr} ${word.en}`); searchKeys.set(word, key); }
  return key;
}
// The list is drawn a chunk at a time: the first at once, the rest in short background steps, so typing a search
// or opening the list never lays out a thousand rows in one go, and each keystroke drops the steps still pending.
const BROWSE_CHUNK = 120;
let browseList = [];
let browseShown = 0;
let browseMore = 0;
function browseRowHTML(word) {
  const reverse = direction === 'en-fr';
  const hidden = hideTranslations && !revealedWords.has(word.id);
  const text = !hidden ? `<h2 lang="${languageTag}" class="${genderClass(word.gender).trim()}">${esc(word.fr)}</h2><p>${esc(word.en)}</p>`
    : (() => {
      const reveal = `<button class="reveal-word" data-reveal-word="${esc(word.id)}">${reverse ? `Show ${languageEnglish}` : 'Show English'}</button>`;
      return reverse ? `<h2 lang="en">${esc(word.en)}</h2>${reveal}` : `<h2 lang="${languageTag}" class="${genderClass(word.gender).trim()}">${esc(word.fr)}</h2>${reveal}`;
    })();
  const history = [
    categoryTitle(word.category),
    word.lastStudied ? `Studied ${dayLabel(word.lastStudied)}` : '',
    word.misses ? `Missed ${word.misses}×` : '',
    word.status === 'scheduled' && word.due ? `Review ${dateLabel(word.due)}` : '',
    word.note || '',
  ].filter(Boolean).map(esc).join(' · ');
  return `<article class="word-row" data-row-word="${esc(word.id)}"><div>${text}<small>${history}</small></div><div class="word-controls"><small>${esc(({ new: 'New', learning: 'Learning', due: 'Due', scheduled: 'Scheduled' })[word.status])}</small><button class="icon" data-play-word="${esc(word.id)}" aria-label="Pronounce ${esc(word.fr)}">${speaker}</button></div></article>`;
}
function showMoreBrowse() {
  const list = document.querySelector('#browse-list');
  if (!list || browseShown >= browseList.length) return;
  const next = browseList.slice(browseShown, browseShown + BROWSE_CHUNK);
  browseShown += next.length;
  list.insertAdjacentHTML('beforeend', next.map(browseRowHTML).join(''));
  if (browseShown < browseList.length) browseMore = setTimeout(showMoreBrowse, 0);
}
function renderBrowseResults() {
  const container = document.querySelector('#browse-results'); if (!container) return;
  clearTimeout(browseMore);
  if (browseLoading) { container.innerHTML = '<div class="loading-state" role="status">Finding your words…</div>'; return; }
  if (browseError) { container.innerHTML = `<div class="notice" role="alert"><span>${esc(browseError)}</span><button class="quiet" data-action="retry-browse">Retry</button></div>`; return; }
  const query = normalized(search.trim());
  const matches = { all: () => true, studied: (word) => word.lastStudied, learning: (word) => word.status === 'learning', missed: (word) => word.misses > 0 }[browseShow];
  const filtered = (words || []).filter((word) => (browseCategory === 'all' || word.category === browseCategory) && matches(word) && (!query || searchKey(word).includes(query)));
  // Studied views put the most recently practised words first.
  if (browseShow !== 'all') filtered.sort((a, b) => (b.lastStudied || '').localeCompare(a.lastStudied || ''));
  browseList = filtered; browseShown = 0;
  const empty = browseShow === 'all' ? 'No words match. Try another spelling or category.' : 'No words here yet. Practise some vocabulary and they will appear.';
  container.innerHTML = `<p class="browse-count" role="status">${filtered.length} ${filtered.length === 1 ? 'word' : 'words'}${hideTranslations && filtered.length ? ' · recall each one, then check it' : ''}</p>${filtered.length ? '<div id="browse-list"></div>' : `<p class="empty-list">${empty}</p>`}`;
  showMoreBrowse();
}
// Revealing one word redraws only its row, so the list keeps its place.
function revealBrowseWord(id) {
  revealedWords.add(id);
  const word = words?.find((entry) => entry.id === id);
  const row = document.querySelector(`.word-row[data-row-word="${CSS.escape(id)}"]`);
  if (word && row) row.outerHTML = browseRowHTML(word); else renderBrowseResults();
}
// A family member is known once it has finished a learning cycle (due or scheduled), learning while in one.
const familyState = (word) => !word || word.status === 'new' ? 'new' : word.status === 'learning' ? 'learning' : 'known';
function familyViews() {
  const byId = new Map((words || []).map((word) => [word.id, word]));
  return (families || []).map((family, index) => {
    const members = family.members.map((member) => ({ ...member, word: byId.get(member.id), state: familyState(byId.get(member.id)) })).filter((member) => member.word);
    return { index, members, known: members.filter((member) => member.state === 'known').length };
  }).filter((family) => family.members.length >= 2);
}
function renderFamilies() {
  const header = `<div class="section-top">${back('Your words', 'your-words')}</div><h1>Word families</h1><p class="subtitle">Words built from one another. You know a word in each of these, so the others come easily.</p>`;
  if (familiesLoading || familiesError) { main.innerHTML = `${noticeHTML()}<section class="topics families">${header}${familiesError ? `<div class="notice" role="alert"><span>${esc(familiesError)}</span><button class="quiet" data-action="families">Retry</button></div>` : '<div class="loading-state" role="status">Finding your word families…</div>'}</section>`; return; }
  const views = familyViews();
  const nearly = views.filter((family) => family.known > 0 && family.known < family.members.length)
    .sort((a, b) => b.known / b.members.length - a.known / a.members.length || b.members.length - a.members.length);
  const waiting = views.filter((family) => family.known === 0).length;
  const complete = views.filter((family) => family.known === family.members.length).length;
  const dot = (state) => `<span class="fam-dot ${state}" aria-hidden="true"></span>`;
  const rows = nearly.map((family) => {
    const open = familyOpen === family.index;
    const head = family.members[0].word;
    const next = family.members.find((member) => member.state === 'new') ?? family.members.find((member) => member.state === 'learning');
    const nextLabel = next ? ` · ${next.state === 'new' ? 'next' : 'learning'}: <span lang="${languageTag}" class="${genderClass(next.word.gender).trim()}">${frEsc(next.word.fr)}</span>` : '';
    const members = open ? `<ol class="fam-members">${family.members.map((member) => `<li>${familyMemberHTML(member)}</li>`).join('')}</ol>` : '';
    return `<article class="fam-row${open ? ' open' : ''}"><button class="fam-head" data-action="family" data-family="${family.index}" aria-expanded="${open}"><span class="fam-title"><span lang="${languageTag}" class="${genderClass(head.gender).trim()}">${frEsc(head.fr)}</span> family</span><span class="fam-meta">You know ${family.known} of ${family.members.length}${nextLabel}</span><span class="fam-bar" aria-hidden="true"><span style="width:${(family.known / family.members.length * 100).toFixed(0)}%"></span></span><span class="fam-dots" aria-hidden="true">${family.members.map((member) => dot(member.state)).join('')}</span></button>${members}</article>`;
  }).join('');
  const legend = `<p class="fam-legend">${dot('known')}you know it ${dot('learning')}learning ${dot('new')}not started</p>`;
  const empty = '<p class="empty-list">None yet. Once you know a word that has relatives, its family shows here.</p>';
  const footer = [waiting ? `${waiting} more ${waiting === 1 ? 'family waits' : 'families wait'} until you know one of ${waiting === 1 ? 'its' : 'their'} words.` : '', complete ? `You know every word in ${complete} ${complete === 1 ? 'family' : 'families'}.` : ''].filter(Boolean);
  main.innerHTML = `${noticeHTML()}<section class="topics families">${header}${nearly.length ? legend : ''}<div class="fam-list">${rows || empty}</div>${footer.map((line) => `<p class="caption fam-footer">${esc(line)}</p>`).join('')}<p class="caption fam-footer">New words from these families come into your practice sooner: up to half of each day’s new words.</p><button class="secondary fam-link" data-action="word-building" data-from="families">How French builds these words</button></section>`;
}
// One family word in full: its dot, French (gender colour), English, how it is built, and add or its status.
function familyMemberHTML(member) {
  const status = familyAdding.has(member.id) ? 'Adding…' : member.added ? HEARD_STATUS[member.added] : '';
  const add = member.state === 'new' && direction === 'fr-en' && !member.added
    ? `<button class="wm-heard-add" data-action="family-add" data-word="${esc(member.id)}" ${familyAdding.has(member.id) ? 'disabled' : ''}>Add to my words</button>`
    : status ? `<span class="wm-heard-status" role="status">${esc(status)}</span>` : '';
  return `<div class="fam-member"><span class="fam-dot ${member.state}" aria-hidden="true"></span><div class="fam-text"><p class="fam-fr ${genderClass(member.word.gender).trim()}" lang="${languageTag}">${frEsc(member.word.fr)}</p><p class="fam-en">${esc(member.word.en)}</p>${member.note ? `<p class="fam-note">${esc(member.note)}</p>` : ''}${add}</div><button class="icon" data-play-word="${esc(member.id)}" aria-label="Pronounce ${esc(member.word.fr)}">${speaker}</button></div>`;
}
function renderBuilding() {
  const [label, to] = { families: ['Word families', 'families'], browse: ['Your words', 'your-words'] }[buildingFrom] ?? ['Grammar', 'grammar'];
  const header = `<div class="section-top">${back(label, to)}</div><h1>Word building</h1><p class="subtitle">How French makes one word from another. Learn a pattern once, and new words arrive half known.</p>`;
  if (familiesLoading || familiesError) { main.innerHTML = `${noticeHTML()}<section class="topics families">${header}${familiesError ? `<div class="notice" role="alert"><span>${esc(familiesError)}</span><button class="quiet" data-action="word-building">Retry</button></div>` : '<div class="loading-state" role="status">Opening word building…</div>'}</section>`; return; }
  const byId = new Map((words || []).map((word) => [word.id, word]));
  const members = new Map((families || []).flatMap((family) => family.members).map((member) => [member.id, member]));
  const entry = (id) => { const word = byId.get(id); return word ? { ...members.get(id), id, word, state: familyState(word) } : null; };
  const rank = { known: 0, learning: 1, new: 2 };
  const chip = (index, member) => `<button class="wb-chip" data-action="building-word" data-pattern="${index}" data-word="${esc(member.id)}" aria-pressed="${buildingWord === `${index}:${member.id}`}"><span class="fam-dot ${member.state}" aria-hidden="true"></span><span lang="${languageTag}" class="${genderClass(member.word.gender).trim()}">${frEsc(member.word.fr)}</span></button>`;
  const cards = (patterns || []).map((pattern, index) => {
    // Pairs whose first word you know come first: they show the pattern on ground you stand on.
    const pairs = pattern.examples.map(([from, to]) => [entry(from), entry(to)]).filter(([from, to]) => from && to)
      .sort((a, b) => rank[a[0].state] - rank[b[0].state] || rank[a[1].state] - rank[b[1].state]);
    if (pairs.length < 2) return '';
    const [openIndex, openId] = buildingWord.split(':');
    const open = Number(openIndex) === index ? entry(openId) : null;
    return `<article class="wb-card"><h2>${esc(pattern.title)}</h2><div class="wb-chains">${pairs.map(([from, to]) => `<div class="wb-chain">${chip(index, from)}<span class="wb-arrow" aria-hidden="true">→</span>${chip(index, to)}</div>`).join('')}</div>${open ? familyMemberHTML(open) : ''}<p class="wb-text">${esc(pattern.explanation)}</p>${pattern.tip ? `<p class="caption wb-tip">${esc(pattern.tip)}</p>` : ''}</article>`;
  }).join('');
  const legend = `<p class="fam-legend"><span class="fam-dot known" aria-hidden="true"></span>you know it <span class="fam-dot learning" aria-hidden="true"></span>learning <span class="fam-dot new" aria-hidden="true"></span>not started</p>`;
  main.innerHTML = `${noticeHTML()}<section class="topics families">${header}${cards ? legend : ''}<div class="fam-list">${cards || '<p class="empty-list">Word building is not ready yet.</p>'}</div></section>`;
}
function enterFamilies() { familyOpen = -1; loadFamilyData('families'); }
function enterBuilding() { buildingWord = ''; loadFamilyData('building'); }
// Both pages join the families (and their patterns, fetched once) with the words' statuses in this direction.
async function loadFamilyData(on) {
  familiesError = ''; familiesLoading = true; render();
  if (!snapshot && !await fetchState()) { familiesLoading = false; return; }
  const token = ++browseGeneration;
  try {
    const [list, found] = await Promise.all([families ? { families, patterns } : api('api/families'), api(`api/words?direction=${encodeURIComponent(direction)}&deck=all`)]);
    if (token !== browseGeneration || screen !== on) return;
    families = list.families; patterns = list.patterns || []; words = found.words;
  } catch (error) {
    if (token !== browseGeneration || screen !== on) return;
    familiesError = error.message;
  }
  familiesLoading = false;
  render();
}
// Adding a relative from its family: the same add as a word tapped in a French text (fr-en, today, on its own allowance).
async function addFromFamily(id) {
  if (familyAdding.has(id)) return;
  familyAdding.add(id); render();
  try {
    const result = await api('api/vocabulary/add', { method: 'POST', body: JSON.stringify({ wordId: id, requestId: requestId() }) });
    const word = words?.find((entry) => entry.id === id);
    if (word && word.status === 'new') word.status = 'learning';
    const member = (families || []).flatMap((family) => family.members).find((entry) => entry.id === id);
    if (member) member.added = HEARD_STATUS[result.status] ? result.status : 'added';
    announce(HEARD_STATUS[member?.added] || 'Added to your words');
  } catch (error) {
    notice = { message: error.message };
  }
  familyAdding.delete(id);
  if (screen === 'families' || screen === 'building') render();
}
// Grammar: what you are in the middle of first, then the units folded with only the one you are working in open.
let grammarBy = readPreference('echo.grammar-by', 'unit') === 'level' ? 'level' : 'unit';
let grammarOpen = null; // the units opened by hand this visit; null opens just the current one
const topicStarted = (topic) => topic.progress.seen > 0 || !!topic.round;
// The unit being worked through: the first with a topic started and one not yet, else the first with one not yet.
const currentUnit = () => units?.find((unit) => unit.topics.some(topicStarted) && !unit.topics.every(topicStarted)) ?? units?.find((unit) => !unit.topics.every(topicStarted)) ?? null;
// Marks run from "du" to "ce · cet · cette": each " · " part gets its own line so the mark column stays narrow.
const markHTML = (mark) => mark.split(' · ').map((part) => `<span>${esc(part)}</span>`).join('');
// A topic's or unit's questions: answered on your own, to revisit (missed, or right with help), the rest not yet.
function grammarBarHTML(own, revisit, total) {
  const width = (count) => `${total ? (100 * count / total).toFixed(2) : 0}%`;
  return `<span class="gr-bar" aria-hidden="true"><i class="own" style="width:${width(own)}"></i><i class="rev" style="width:${width(revisit)}"></i></span>`;
}
function grammarRowHTML(attr, mark, title, detail, end = '→', level = '') {
  return `<button class="gr-row" ${attr} ${locked() ? 'disabled' : ''}><span class="gr-mark" aria-hidden="true">${mark}</span><span class="gr-copy"><span class="gr-title"><b>${esc(title)}</b>${level ? `<span class="level-tag">${esc(level)}</span>` : ''}</span>${detail}</span><span class="gr-end" aria-hidden="true">${end}</span></button>`;
}
function topicRowHTML(topic) {
  const { seen, independent, needsReview } = topic.progress;
  const notes = [seen ? `${seen} of ${topic.exerciseCount} practised` : '', needsReview ? `${needsReview} to revisit` : '', topic.test.best ? `best test ${topic.test.best.score}/${topic.test.best.total}` : ''].filter(Boolean);
  const detail = seen ? `${grammarBarHTML(independent, needsReview, topic.exerciseCount)}<small>${notes.join(' · ')}</small>` : notes.length ? `<small>${notes.join(' · ')}</small>` : '';
  return grammarRowHTML(`data-topic="${esc(topic.id)}"`, markHTML(topic.mark), topic.title, detail, '→', topic.level);
}
function renderGrammar() {
  const header = `<div class="section-top">${back('Home', 'home')}${infoButton('grammar')}</div><h1>Grammar</h1>`;
  if (!units) { main.innerHTML = `${noticeHTML()}<section class="topics grammar">${header}${loading ? '<div class="loading-state" role="status">Opening the workshop…</div>' : ''}</section>`; return; }
  const topics = units.flatMap((unit) => unit.topics);
  const current = currentUnit();
  // Continue: every open round and test, in course order, then what is waiting to be revisited.
  const going = units.flatMap((unit, index) => [
    ...unit.topics.flatMap((topic) => [
      topic.round ? grammarRowHTML(`data-scope="${esc(topic.id)}"`, markHTML(topic.mark), topic.title, `<small>Round · question ${topic.round.index + 1} of ${topic.round.total}</small>`, 'Continue →') : '',
      topic.hasActiveTest ? grammarRowHTML(`data-scope="test:${esc(topic.id)}"`, markHTML(topic.mark), topic.title, '<small>Test in progress</small>', 'Continue →') : '',
    ]),
    unit.hasActiveTest ? grammarRowHTML(`data-scope="unit:${esc(unit.id)}"`, `<span>Unit</span><span>${index + 1}</span>`, unit.title, '<small>Unit test in progress</small>', 'Continue →') : '',
  ]).join('');
  const revisit = topics.filter((topic) => topic.progress.needsReview);
  const revisitCount = revisit.reduce((sum, topic) => sum + topic.progress.needsReview, 0);
  const revisitRow = revisitCount ? grammarRowHTML('data-scope="review"', '<span class="gr-revisit">↺</span>', 'To revisit', `<small>${revisitCount} ${revisitCount === 1 ? 'question' : 'questions'} you missed or needed help with, in ${revisit.length} ${revisit.length === 1 ? 'topic' : 'topics'}</small>`, 'Practise →') : '';
  const next = current?.topics.find((topic) => !topicStarted(topic));
  const nextCard = next ? `<button class="gr-row gr-next" data-topic="${esc(next.id)}" ${locked() ? 'disabled' : ''}><span class="gr-mark" aria-hidden="true">${markHTML(next.mark)}</span><span class="gr-copy"><span class="gr-kicker">Next up · Unit ${units.indexOf(current) + 1}</span><span class="gr-title"><b>${esc(next.title)}</b><span class="level-tag">${esc(next.level)}</span></span><small>${esc(next.description)}</small></span><span class="gr-end" aria-hidden="true">→</span></button>` : '';
  const resume = going || revisitRow ? `<p class="study-label">Continue</p><div class="gr-box">${going}${revisitRow}</div>` : '';
  const opened = (unit) => grammarOpen ? grammarOpen.has(unit.id) : unit === current;
  const unitCard = (unit, index) => {
    const sum = (key) => unit.topics.reduce((total, topic) => total + topic.progress[key], 0);
    const all = unit.topics.reduce((total, topic) => total + topic.exerciseCount, 0);
    const started = unit.topics.filter(topicStarted).length;
    const open = opened(unit);
    const best = unit.test.best ? ` · best unit test ${unit.test.best.score}/${unit.test.best.total}` : '';
    const test = grammarRowHTML(`data-scope="unit:${esc(unit.id)}"`, '<span>Unit</span><span>test</span>', `Unit test · ${unit.testLength} questions`, `<small>${unit.hasActiveTest ? 'Continue your test' : 'Questions from every topic here; no help, one try each'}</small>`);
    return `<section class="gr-box gr-unit" aria-labelledby="unit-${esc(unit.id)}"><button class="gr-unit-top" data-action="grammar-unit" data-unit="${esc(unit.id)}" aria-expanded="${open}"><span class="gr-kicker"><span>Unit ${index + 1}</span><span class="gr-chev" aria-hidden="true">›</span></span><h2 id="unit-${esc(unit.id)}">${esc(unit.title)}</h2>${grammarBarHTML(sum('independent'), sum('needsReview'), all)}<small>${started ? `${started} of ${unit.topics.length} topics started` : `${unit.topics.length} topics · not started`}${best}</small></button>${open ? `<div class="gr-unit-body">${unit.topics.map(topicRowHTML).join('')}${test}</div>` : ''}</section>`;
  };
  const byLevel = ['A1', 'A2', 'B1'].map((level) => {
    const list = topics.filter((topic) => topic.level === level);
    return list.length ? `<p class="study-label">${level} · ${list.filter(topicStarted).length} of ${list.length} started</p><div class="gr-box">${list.map(topicRowHTML).join('')}</div>` : '';
  }).join('');
  const switcher = `<div class="segmented gr-by" role="group" aria-label="Show topics">${[['unit', 'By unit'], ['level', 'By level']].map(([value, label]) => `<button data-action="grammar-by" data-value="${value}" aria-pressed="${grammarBy === value}">${label}</button>`).join('')}</div>`;
  const legend = '<div class="gr-legend"><span><i class="own"></i>on your own</span><span><i class="rev"></i>to revisit</span><span><i></i>not yet</span></div>';
  const writeRow = roomsOff.has('write') ? '' : grammarRowHTML('data-action="write"', '<span>✎</span>', 'Write it', `<small>Write a short sentence in ${languageEnglish} with the grammar you are learning; Claude checks it</small>`);
  // Word building is French's (content/families.json), shown with the Word families room.
  const buildingRow = roomsOff.has('families') ? '' : grammarRowHTML('data-action="word-building"', '<span>-er</span><span>-eur</span>', 'Word building', '<small>Endings and prefixes that turn one word into another; also in Your words</small>');
  const building = writeRow || buildingRow ? `<p class="study-label">Also</p><div class="gr-box">${writeRow}${buildingRow}</div>` : '';
  main.innerHTML = `${noticeHTML()}<section class="topics grammar">${header}${resume}${nextCard}${switcher}${grammarBy === 'unit' ? units.map(unitCard).join('') : byLevel}${legend}${building}</section>`;
}
// ── Write it: an English sentence to write in French, from your words and a grammar topic you have started.
// Claude writes the sentences ahead and checks each answer (lib/write-it.ts); the check takes a few seconds.
let writeView = null;       // api/write: { current, result, waiting, writing, error }
let writeDraft = '';
let writeChecking = false;
let writeRetry = false;     // the result is set aside to write the sentence again
let writePoll = 0;
function openWrite() { if (move('write', true)) loadWrite(); }
async function loadWrite() {
  clearTimeout(writePoll);
  if (!writeView) { loading = true; render(); }
  try { writeView = await api('api/write'); }
  catch (error) { notice = { message: error.message }; retryAction = { type: 'write' }; }
  loading = false;
  if (screen !== 'write') return;
  render();
  if (!writeView?.current && writeView?.writing) writePoll = setTimeout(() => { if (screen === 'write') loadWrite(); }, 5000);
  else main.querySelector('#write-answer')?.focus({ preventScroll: true });
}
const WRITE_VERDICTS = { right: 'That’s right.', nearly: 'Nearly.', wrong: 'Not quite.' };
// The sentence, the answer line and the verdict: Write it's own screen and Practise both show it.
function writeBodyHTML() {
  const { current, error } = writeView;
  if (!current) {
    return writeView.writing ? '<div class="loading-state" role="status">Claude is writing sentences for you. This takes about a minute.</div>'
      : `<div class="notice" role="alert"><span>${esc(error || 'No sentences yet.')}</span><button class="quiet" data-action="write">Try again</button></div>`;
  }
  const prompt = `<div class="vb-prompt"><p class="write-en" lang="en">${esc(current.en)}</p>${current.topicTitle ? `<span class="vb-tense">${esc(current.topicTitle)}</span>` : ''}</div>`;
  const result = writeRetry ? null : writeView.result;
  if (!result) {
    return `${prompt}<form class="vb-answer-row" id="write-form"><input class="vb-input" id="write-answer" lang="${languageTag}" autocomplete="off" autocapitalize="sentences" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="The sentence in ${languageEnglish}" value="${esc(writeDraft)}" ${writeChecking ? 'disabled' : ''}><button class="primary" ${writeChecking ? 'disabled' : ''}>${writeChecking ? 'Checking…' : 'Check'}</button></form>${vbAccentsHTML()}
      <div class="summary-actions"><button class="quiet" data-action="write-next" ${writeChecking ? 'disabled' : ''}>Skip this one</button></div>`;
  }
  const right = result.verdict === 'right';
  const lines = [
    `<p>You wrote <span lang="${languageTag}">${esc(result.given)}</span></p>`,
    right ? '' : `<p>Corrected: <span lang="${languageTag}" class="write-fix">${esc(result.corrected)}</span></p>`,
    result.explanation ? `<p class="vb-why">${esc(result.explanation)}</p>` : '',
    result.natural && result.natural !== result.corrected ? `<p class="vb-why">A ${languageEnglish} speaker would say: <span lang="${languageTag}">${esc(result.natural)}</span></p>` : '',
  ].join('');
  return `${prompt}<div class="feedback ${right ? '' : 'warn'}" role="status"><strong>${WRITE_VERDICTS[result.verdict]}</strong>${lines}</div>
    <div class="stream-actions pinned"><button class="primary" data-action="write-next">${mixed() ? 'Next' : 'Next sentence'}</button>${right ? '' : '<button class="secondary" data-action="write-again">Write it again</button>'}</div>`;
}
function renderWrite() {
  const header = `<div class="section-top">${back('Grammar', 'grammar')}<span class="stream-label">Write it</span></div>`;
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="stream vb write">${header}${body}</section>`; };
  if (loading || !writeView) { shell(loading ? '<div class="loading-state" role="status">Opening Write it…</div>' : ''); return; }
  shell(writeBodyHTML());
  main.querySelector('[data-action="write-next"].primary')?.focus({ preventScroll: true });
}
// Practise is showing a Write it sentence.
const writingInMix = () => mixed() && mixedSource === 'write';
async function checkWrite() {
  const item = writeView?.current;
  const given = (main.querySelector('#write-answer')?.value ?? writeDraft).trim();
  if (!item || writeChecking || !given) return;
  writeChecking = true; notice = null; render();
  try { const result = await api('api/write/check', { method: 'POST', body: JSON.stringify({ requestId: requestId(), itemId: item.id, given }) }); if (writeView?.current?.id === item.id) { writeView.result = result; writeRetry = false; } }
  catch (error) { notice = { message: error.message }; }
  writeChecking = false;
  if (screen === 'write' || writingInMix()) render();
}
async function nextWrite() {
  const item = writeView?.current;
  if (!item || writeChecking) return;
  writeChecking = true; render();
  try { writeView = await api('api/write/next', { method: 'POST', body: JSON.stringify({ itemId: item.id }) }); writeDraft = ''; writeRetry = false; }
  catch (error) { notice = { message: error.message }; }
  writeChecking = false;
  if (screen === 'write') loadWriteAfterNext();
  else if (writingInMix()) { advanceMixed(); render(); }
}
// The next sentence is on screen at once; with none left, the screen waits for the batch being written.
function loadWriteAfterNext() {
  render();
  if (!writeView?.current && writeView?.writing) { clearTimeout(writePoll); writePoll = setTimeout(() => { if (screen === 'write') loadWrite(); }, 5000); }
  else main.querySelector('#write-answer')?.focus({ preventScroll: true });
}
// The rule on a topic page: its summary, then each part folded under its title.
function foldedGuideHTML(guide) {
  return `<div class="guide"><p class="guide-summary">${frEsc(guide.summary)}</p>${guide.sections.map((section) => `<details class="gr-part"><summary>${esc(section.title)}</summary>${guideSectionHTML(section)}</details>`).join('')}</div>`;
}
// A guide section teaches one point: a table of forms (a highlighted row holds an answer), the steps for choosing,
// examples and traps. French and English share the cells, so every cell keeps French spacing.
function guideTableHTML(table, row = null) {
  return `<div class="guide-table-wrap"><table class="guide-table"><thead><tr>${table.columns.map((column) => `<th scope="col">${esc(column)}</th>`).join('')}</tr></thead><tbody>${table.rows.map((cells) => `<tr${cells[0] === row ? ' class="hit"' : ''}>${cells.map((cell, index) => index ? `<td>${frEsc(cell)}</td>` : `<th scope="row">${frEsc(cell)}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function guideSectionHTML(section, focus = false) {
  const steps = section.steps ? `<p class="guide-label">How to choose</p><ol class="guide-steps">${section.steps.map((step) => `<li>${frEsc(step)}</li>`).join('')}</ol>` : '';
  const examples = `<div class="guide-examples">${section.examples.map((example) => `<p><span lang="${languageTag}">${frEsc(example.fr)}</span><span class="en">${esc(example.en)}</span></p>`).join('')}</div>`;
  const watch = section.watch ? `<p class="guide-label">Watch out</p><ul class="guide-watch">${section.watch.map((item) => `<li>${frEsc(item)}</li>`).join('')}</ul>` : '';
  return `<section class="guide-section${focus ? ' focus' : ''}" id="guide-${esc(section.id)}"><h3>${esc(section.title)}</h3>${section.text ? `<p>${frEsc(section.text)}</p>` : ''}${section.table ? guideTableHTML(section.table) : ''}${steps}${examples}${watch}</section>`;
}
function guideHTML(guide, focusId = '') {
  return `<div class="guide"><p class="guide-summary">${frEsc(guide.summary)}</p>${guide.sections.map((section) => guideSectionHTML(section, section.id === focusId)).join('')}</div>`;
}
function renderTopic() {
  const topic = topicPage?.id === topicId ? topicPage : units?.flatMap((unit) => unit.topics).find((entry) => entry.id === topicId);
  if (!topic) { main.innerHTML = `${noticeHTML()}<section class="topic-page"><div class="section-top">${back('Grammar', 'grammar')}</div>${loading ? '<div class="loading-state" role="status">Opening the topic…</div>' : ''}</section>`; return; }
  const { progress, test, round } = topic;
  const notYet = topic.exerciseCount - progress.independent - progress.needsReview;
  const practised = progress.seen ? `${grammarBarHTML(progress.independent, progress.needsReview, topic.exerciseCount)}<p>${progress.independent} on your own · ${progress.needsReview} to revisit · ${notYet} not yet</p>` : `<p>${topic.exerciseCount} questions, none practised yet</p>`;
  const tests = test.taken
    ? `<strong>Best ${test.best.score} / ${test.best.total}</strong> · last ${test.last.score} / ${test.last.total}, ${esc(dateLabel(test.last.finishedAt))} · taken ${test.taken} ${test.taken === 1 ? 'time' : 'times'}`
    : `<strong>No tests yet.</strong> ${topic.testLength} questions, no help, one try each; what you miss comes back first when you practise.`;
  main.innerHTML = `${noticeHTML()}<section class="topic-page"><div class="section-top">${back('Grammar', 'grammar')}</div><p class="topic-kicker" lang="${languageTag}" aria-hidden="true">${esc(topic.mark)}</p><div class="topic-heading"><h1>${esc(topic.title)}</h1><span class="level-tag">${esc(topic.level)}</span></div><p class="subtitle">${esc(topic.description)}</p><div class="topic-actions"><button class="primary" data-scope="${esc(topic.id)}" ${locked() ? 'disabled' : ''}>${round ? `Continue your round · ${round.index + 1} of ${round.total}` : `Practise · ${topic.practiceLength} questions`}</button><button class="secondary" data-scope="test:${esc(topic.id)}" ${locked() ? 'disabled' : ''}>${topic.hasActiveTest ? 'Continue your test' : `Take the test · ${topic.testLength} questions`}</button></div><div class="gr-topic-stats">${practised}</div><p class="gr-tests">${tests}</p><section class="rule-card" aria-labelledby="rule-heading"><h2 id="rule-heading">The rule</h2>${topic.guide ? foldedGuideHTML(topic.guide) : '<p>Opening the rule…</p>'}</section></section>`;
}
// Back from a round or its summary: Grammar for a unit test or the revisit round, else the topic, by name.
function grammarBackHTML() {
  if (scope.startsWith('unit:') || scope === 'review') return back('Grammar', 'grammar');
  const title = grammar?.topic?.title ?? units?.flatMap((unit) => unit.topics).find((entry) => entry.id === topicId)?.title ?? 'Topic';
  return back(esc(title), 'topic-page');
}
// Complete (and most choose) sources hold a ____ blank: show the whole sentence rather than the missing word alone.
function completed(type, source, text) {
  return (type === 'complete' || type === 'choose') && /_{2,}/.test(source) ? source.replace(/_{2,}/, text).replace(/(['’‘ʼ])\s+/g, '$1') : text;
}
function promptHTML(exercise) {
  if (exercise.type === 'conjugate') {
    const [verb, subject, tense] = exercise.source.split(' · ');
    return `<dl class="conjugate-parts"><div><dt>Verb</dt><dd lang="${languageTag}">${esc(verb)}</dd></div><div><dt>Subject</dt><dd lang="${languageTag}">${esc(subject)}</dd></div><div><dt>Tense</dt><dd lang="${languageTag}">${esc(tense)}</dd></div></dl>`;
  }
  // An English cue in the sentence ("(she does not lend them to us)") is glossed as itself; it is not made tappable.
  const gloss = (exercise.gloss || []).filter((entry) => !(entry.fr === entry.en && /\s/.test(entry.fr)));
  return `<p class="prompt-sentence" lang="${exercise.type === 'translate' ? 'en' : languageTag}">${exercise.type === 'translate' ? esc(exercise.source) : glossedHTML(exercise.source, gloss)}</p>`;
}
function answerHTML(current, disabled) {
  const exercise = current.exercise;
  if (exercise.type === 'build') return `<p class="answer-label">Your answer</p><div class="token-answer" role="group" aria-label="Your sentence">${tokenOrder.map((index) => `<button class="token" data-remove-token="${index}" aria-label="Remove ${esc(exercise.tokens[index])}" ${disabled ? 'disabled' : ''}>${esc(exercise.tokens[index])}</button>`).join('')}</div><div class="token-pool" role="group" aria-label="Available words">${exercise.tokens.map((text, index) => `<button class="token" data-token="${index}" ${disabled || tokenOrder.includes(index) ? 'disabled' : ''}>${esc(text)}</button>`).join('')}</div>`;
  if (exercise.type === 'choose') {
    const answer = current.settled ? current.feedback?.answer?.toLocaleLowerCase() : null;
    return `<p class="answer-label" id="choice-label">Choose one</p><div class="choice-list" role="group" aria-labelledby="choice-label">${exercise.options.map((option) => {
      const missed = current.misses.includes(option);
      const right = option.toLocaleLowerCase() === answer;
      const mark = missed ? '<span class="choice-mark"><span aria-hidden="true">✕</span><span class="sr-only">not this one</span></span>' : right ? '<span class="choice-mark"><span aria-hidden="true">✓</span><span class="sr-only">the answer</span></span>' : '';
      return `<button class="choice${missed ? ' wrong' : right ? ' right' : ''}" data-choice="${esc(option)}" ${disabled || missed ? 'disabled' : ''}><span lang="${languageTag}">${esc(option)}</span>${mark}</button>`;
    }).join('')}</div>`;
  }
  if (exercise.type === 'conjugate') return `<label class="answer-label" for="answer">Verb form</label><input id="answer" class="answer-line" lang="${languageTag}" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="Write the verb form…" value="${esc(draft)}" ${disabled ? 'readonly' : ''}>`;
  const label = ({ complete: 'Missing word', translate: `Your ${languageEnglish}` })[exercise.type] || 'Your answer';
  const placeholder = ({ complete: 'Type the missing word…', translate: `Write it in ${languageEnglish}…` })[exercise.type] || 'Write your sentence…';
  return `<label class="answer-label" for="answer">${label}</label><textarea id="answer" lang="${languageTag}" autocomplete="off" autocapitalize="sentences" spellcheck="false" placeholder="${placeholder}" ${disabled ? 'readonly' : ''}>${esc(draft)}</textarea>`;
}
// After a miss: what you gave against the answer, why that answer is wrong (when it was anticipated), the steps that
// solve this kind of question, and once settled the guide table with the answer's row marked.
function feedbackHTML(current, test) {
  const feedback = current.feedback;
  if (!feedback) return '';
  const exercise = current.exercise;
  const tone = feedback.kind === 'incorrect' ? 'warn' : feedback.kind === 'alternative' || feedback.kind === 'shown' ? 'neutral' : '';
  const title = test && current.settled
    ? ({ correct: 'That’s right.', incorrect: 'Not quite.', alternative: `Valid ${languageEnglish}, different form.` })[feedback.kind]
    : ({ correct: current.assisted || current.attempts > 1 ? 'You’ve got it.' : 'That’s right.', incorrect: 'Not quite yet.', alternative: `Valid ${languageEnglish}, different form.`, shown: 'One correct answer' })[feedback.kind];
  const answer = feedback.answer ? completed(exercise.type, exercise.source, feedback.answer) : '';
  const showAnswer = answer && (feedback.kind === 'shown' || (test && feedback.kind !== 'correct'));
  const given = current.settled && feedback.kind !== 'correct' ? current.misses.at(-1) : '';
  const compare = showAnswer && given
    ? `<div class="fb-compare"><p><span class="fb-label">${exercise.type === 'choose' ? 'You chose' : 'You wrote'}</span><span class="fb-yours" lang="${languageTag}">${frEsc(completed(exercise.type, exercise.source, given))}</span></p><p><span class="fb-label">The answer</span><span lang="${languageTag}">${frEsc(answer)}</span></p></div>`
    : showAnswer ? `<p class="model-answer" lang="${languageTag}">${frEsc(answer)}</p>` : '';
  const why = feedback.why ? `<p class="fb-why">${frEsc(feedback.why)}</p>` : '';
  // A try-again message only repeats what an anticipated mistake's why already says.
  const message = feedback.why && !current.settled ? '' : `<p>${frEsc(feedback.message)}</p>`;
  const independent = feedback.kind === 'correct' && current.attempts === 1 && !current.assisted;
  const help = current.help && !independent ? current.help : null;
  const steps = help ? `<div class="fb-steps"><p class="fb-label">${current.settled ? 'Next time' : 'How to work it out'}</p><ol>${help.steps.map((step) => `<li>${frEsc(step)}</li>`).join('')}</ol></div>` : '';
  const table = help?.row && help.section.table ? `<div class="fb-table"><p class="fb-label">From the rule · ${esc(help.section.title)}</p>${guideTableHTML(help.section.table, help.row)}</div>` : '';
  const clip = current.settled && current.audio ? `<button class="quiet audio-line" data-action="grammar-audio" aria-label="Hear the correct ${languageEnglish} sentence">${speaker}<span>Hear it</span></button>` : '';
  return `<div class="feedback ${tone}" role="status"><strong>${title}</strong>${feedback.note ? `<p>${esc(feedback.note)}</p>` : ''}${compare}${why}${message}${steps}${table}${feedback.spelling && answer ? `<span class="minor">A spelling detail to review: <span lang="${languageTag}">${esc(answer)}</span></span>` : ''}${feedback.kind === 'shown' ? '<span class="minor">This example stays in your revisit set.</span>' : ''}${clip}${!test && !current.settled ? `<button class="quiet" data-action="show-answer" ${locked() ? 'disabled' : ''}>Show one answer instead</button>` : ''}</div>`;
}
// The question itself: instruction, prompt, answer, feedback, help and the one primary button.
// The Grammar screens and the Practise stream both render it; only the frame around it differs.
function exerciseCoreHTML(snap, test, nextText) {
  const session = snap.session; const current = session.current; const exercise = current.exercise;
  const disabled = locked() || current.settled;
  const primary = current.settled ? `<button class="primary" data-action="next" ${locked() ? 'disabled' : ''}>${busy ? 'Saving…' : nextText}</button>`
    : exercise.type === 'choose' ? '' : `<button class="primary" data-action="check" ${locked() ? 'disabled' : ''}>${busy ? 'Saving…' : 'Check answer'}</button>`;
  const helpButton = !test && !current.settled ? `<button class="quiet accent" data-action="hint" ${locked() ? 'disabled' : ''}>${current.hint && hintOpen ? 'Hide hint' : 'A little help'}</button>` : '';
  const actions = primary || helpButton ? `<div class="exercise-actions${current.settled ? ' pinned' : ''}">${helpButton || '<span></span>'}${primary}</div>` : '';
  const hint = !test && current.hint && hintOpen && !current.settled ? `<div class="rule-hint"><p>${esc(current.hint)}</p><button class="quiet" data-action="show-answer" ${locked() ? 'disabled' : ''}>Show one answer</button></div>` : '';
  return `<p class="prompt-instruction">${esc(exercise.instruction)}</p>${promptHTML(exercise)}<div class="answer-area">${answerHTML(current, disabled)}</div>${feedbackHTML(current, test)}${hint}${actions}${current.assisted && !current.settled ? '<p class="assistance-note">Help used for this example.</p>' : ''}`;
}
function renderExercise() {
  const unitScope = scope.startsWith('unit:');
  const testScope = unitScope || scope.startsWith('test:');
  const backButton = grammarBackHTML();
  if (!grammar || loading) { main.innerHTML = `${noticeHTML()}<section class="exercise"><div class="section-top">${backButton}</div><div class="loading-state" role="status">${loading || busy ? (testScope ? 'Opening your test…' : 'Opening your round…') : 'Your progress is saved on your Mac.'}</div></section>`; return; }
  const { session } = grammar;
  const heading = grammar.topic?.title ?? grammar.unit?.title ?? 'To revisit';
  if (session?.complete) { renderSummary(); return; }
  if (!session?.current) { main.innerHTML = `${noticeHTML()}<section class="summary"><div class="section-top">${backButton}</div><h1>${esc(heading)}</h1><p class="summary-line">${esc(grammar.topic?.description ?? grammar.unit?.description ?? '')}</p><button class="primary dialog-action" data-action="restart" ${locked() ? 'disabled' : ''}>${testScope ? 'Start the test' : 'Start a round'}</button></section>`; return; }
  const test = session.mode === 'test';
  const current = session.current;
  const last = session.index + 1 === session.total;
  const nextText = test ? (last ? 'See your score' : 'Next question') : (last ? 'Finish round' : 'Next sentence');
  // The revisit round and a unit test name each question's topic; a topic round names one borrowed from earlier.
  const borrowed = unitScope || !grammar.topic || current.exercise.topicId !== grammar.topic.id;
  main.innerHTML = `${noticeHTML()}<section class="exercise"><div class="section-top">${backButton}${test || !grammar.topic ? '' : `<button class="quiet" data-action="rule" aria-haspopup="dialog" ${locked() ? 'disabled' : ''}>The rule</button>`}</div><div class="exercise-head"><h1>${esc(heading)}</h1><span class="progress">${test ? 'Test · ' : ''}${session.index + 1} / ${session.total}</span></div>${borrowed ? `<p class="question-topic">${unitScope || !grammar.topic ? '' : 'From earlier · '}${esc(current.exercise.topicTitle)}</p>` : ''}${exerciseCoreHTML(grammar, test, nextText)}</section>`;
}
function resultHTML(result, test, unitTest) {
  const missed = result.outcome !== 'independent';
  const context = result.type === 'translate' || result.type === 'conjugate' || (result.type === 'choose' && !/_{2,}/.test(result.source))
    ? `<span class="result-context" lang="${result.type === 'translate' ? 'en' : languageTag}">${esc(result.source)}</span>` : '';
  const given = test && (missed || result.spelling) && result.given.trim()
    ? `<span class="result-given">${result.type === 'choose' ? 'You chose' : 'You wrote'}: <span lang="${languageTag}">${esc(completed(result.type, result.source, result.given))}</span>${result.spelling ? ' · a spelling detail to review' : ''}</span>` : '';
  const label = test ? (missed ? 'Missed' : 'Right') : ({ independent: 'On your own', helped: 'With help', revisit: 'To revisit' })[result.outcome];
  return `<div class="result${test && missed ? ' missed' : ''}"><div class="result-text">${unitTest ? `<span class="result-topic">${esc(result.topicTitle)}</span>` : ''}<span lang="${languageTag}">${esc(completed(result.type, result.source, result.answer))}</span>${context}${given}</div><small>${label}</small></div>`;
}
function renderSummary() {
  const { session } = grammar;
  const unitTest = grammar.kind === 'unit-test';
  const backButton = grammarBackHTML();
  const results = session.results.map((result) => resultHTML(result, session.mode === 'test', unitTest)).join('');
  if (session.mode !== 'test') {
    main.innerHTML = `${noticeHTML()}<section class="summary"><div class="section-top">${backButton}</div><h1>A good place to pause.</h1><p class="summary-line">${grammar.topic ? esc(grammar.topic.title) : 'What you had to revisit'}, practised in ${session.results.length} examples.</p><div class="results">${results}</div><div class="summary-actions"><button class="primary" data-action="restart" ${locked() ? 'disabled' : ''}>Another round</button><button class="secondary" data-action="grammar" ${busy ? 'disabled' : ''}>Choose another topic</button></div></section>`;
    return;
  }
  const history = (grammar.topic ?? grammar.unit).test;
  const misses = session.results.filter((result) => result.outcome !== 'independent');
  const missedTopics = [...new Map(misses.map((result) => [result.topicId, result.topicTitle])).entries()];
  const choices = [...(unitTest ? missedTopics.map(([id, title]) => ({ attr: `data-scope="${esc(id)}"`, label: `Practise ${title}` })) : [{ attr: `data-scope="${esc(grammar.topic.id)}"`, label: 'Practise this topic' }]), { attr: 'data-action="restart"', label: 'Take it again' }];
  const buttons = choices.map((entry, index) => `<button class="${index ? 'secondary' : 'primary'}" ${entry.attr} ${locked() ? 'disabled' : ''}>${esc(entry.label)}</button>`).join('');
  const line = `${misses.length ? `${misses.length} to revisit: they come back first when you practise.` : 'Every question right.'}${history.best ? ` Best ${history.best.score} / ${history.best.total} · ${history.taken} ${history.taken === 1 ? 'test' : 'tests'} taken.` : ''}`;
  main.innerHTML = `${noticeHTML()}<section class="summary"><div class="section-top">${backButton}</div><p class="summary-kicker">${esc(grammar.topic?.title ?? grammar.unit.title)} · ${unitTest ? 'unit test' : 'test'}</p><h1 class="score"><span class="sr-only">Score: </span>${session.score} <span>/ ${session.total}</span></h1><p class="summary-line">${esc(line)}</p><div class="results">${results}</div><div class="summary-actions">${buttons}<button class="secondary" data-action="grammar" ${busy ? 'disabled' : ''}>Back to grammar</button></div></section>`;
}
// ── Listen, Read, Practise and Mistakes ─────────────────────────────────────
// A stream is one endless run of comprehension exercises. The server keeps the current question,
// so a reload — or the same stream reached from another screen — shows the same one.
const STREAM_INSTRUCTION = {
  'listen:meaning': 'Listen, then choose what it means.',
  'read:meaning': 'Read, then choose what it means.',
  'listen:question': 'Listen, then answer the question.',
  'read:question': 'Read, then answer the question.',
};
const ITEM_LABEL = { dialogue: 'Dialogue', text: 'Text' };
const LETTER = /[\p{L}\p{M}]/u;
function mixed() { return screen === 'mix' || screen === 'focus'; }
function streamScreen() { return screen === 'listen' || screen === 'read' || (mixed() && mixedSource === 'comprehension'); }
function mistakeGroup() { return (mistakes || []).find((group) => group.id === focusId) || null; }
// Practise alternates comprehension, vocabulary, comprehension, grammar, and every other grammar turn is a Write it
// sentence where that room is on; a mistake group practises what it is about.
function mixedSources() {
  if (screen === 'mix') return ['comprehension', 'vocabulary', 'comprehension', 'grammar', ...(roomsOff.has('write') ? [] : ['comprehension', 'vocabulary', 'comprehension', 'write'])];
  const group = mistakeGroup();
  if (!group) return [];
  const sources = [];
  if (group.kind === 'grammar') { if (group.grammarScope) sources.push('grammar'); if (group.stream) sources.push('comprehension'); }
  else { if (group.stream) sources.push('comprehension'); if (group.kind === 'words') sources.push('vocabulary'); }
  return sources;
}
function mixedStream() { return screen === 'mix' ? 'mix' : mistakeGroup()?.stream || ''; }
function mixedScope() { return screen === 'mix' ? 'review' : mistakeGroup()?.grammarScope || ''; }
function sourceReady(source) {
  if (source === 'comprehension') return !!streamState?.current;
  if (source === 'vocabulary') return !!snapshot?.current;
  if (source === 'write') return !!writeView?.current;
  return !!review?.session?.current;
}
// A source with nothing to show is skipped, so the pattern never stalls on an empty one. Write it may be writing its
// next sentences; they are looked for again, quietly, each time its turn is skipped.
function advanceMixed(first = false) {
  const sources = mixedSources();
  const from = first ? 0 : mixedStep + 1;
  for (let step = 0; step < sources.length; step++) {
    const at = (from + step) % sources.length;
    if (sourceReady(sources[at])) { mixedStep = at; mixedSource = sources[at]; return; }
    if (sources[at] === 'write' && writeView?.writing) api('api/write').then((view) => { writeView = view; }).catch(() => {});
  }
  mixedSource = '';
}
function levelFor(mode) {
  const entry = (streamState?.level || []).find((item) => item.mode === mode);
  return entry?.label || levels[mode] || '';
}
function applyStream(next) {
  if (next.ear?.id !== streamState?.ear?.id) earResult = null;
  streamState = next;
  let changed = false;
  for (const entry of next.level || []) if (entry?.mode && entry.label && levels[entry.mode] !== entry.label) { levels[entry.mode] = entry.label; changed = true; }
  if (changed) savePreference('echo.levels', JSON.stringify(levels));
  // The questions Next may bring are fetched ahead, so a Listen question shown before the Mac confirms it plays at once.
  for (const held of Object.values(next.after || {})) if (held?.current?.mode === 'listen') held.current.audio.forEach(warmClip);
}
// "Saving…" beside a stream's or Practise's title while what was done there is still on its way to a slow Mac.
const savingNow = () => streamSlow || scSlow || (savingSlow && !!pendingGrade);
const savingStatusHTML = () => `<span class="compact-status saving-status" role="status">${savingNow() ? 'Saving…' : ''}</span>`;
function refreshSavingStatus() {
  for (const element of document.querySelectorAll('.saving-status')) element.textContent = savingNow() ? 'Saving…' : '';
}
// Mirrors the server's whole-word rule, so a tappable word covers exactly the text its gloss was written for.
function wholeMatches(text, needle) {
  const found = [];
  if (!needle) return found;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    const before = text[at - 1] ?? ' ';
    const after = text[at + needle.length] ?? ' ';
    if (LETTER.test(before) || before === '’' || before === '-') continue;
    if (LETTER.test(after) && !/[’']$/.test(needle)) continue;
    found.push(at);
  }
  return found;
}
// Longest glosses first, so "il y a" wins over "a"; each stretch of text is wrapped once.
function glossedHTML(text, glosses) {
  const list = (glosses || []).filter((entry) => entry?.fr);
  if (!list.length) return frEsc(text);
  const taken = new Array(text.length).fill(false);
  const marks = [];
  for (const entry of [...list].sort((a, b) => b.fr.length - a.fr.length)) {
    for (const at of wholeMatches(text, entry.fr)) {
      const end = at + entry.fr.length;
      let free = true;
      for (let index = at; index < end; index++) if (taken[index]) { free = false; break; }
      if (!free) continue;
      for (let index = at; index < end; index++) taken[index] = true;
      marks.push({ at, end, fr: entry.fr, gender: genders[entry.word] ?? entry.gender });
    }
  }
  marks.sort((a, b) => a.at - b.at);
  let html = '';
  let at = 0;
  for (const mark of marks) {
    const button = `<button class="gloss${genderClass(mark.gender)}" data-gloss="${esc(mark.fr)}">${frEsc(text.slice(mark.at, mark.end))}</button>`;
    // A button is an inline block, so the line may break after it; keep a following " ?" or "," with its word.
    const tail = /^(?: [?!:;»]|[,.…)]+(?: [?!:;»])?)/.exec(text.slice(mark.end))?.[0] || '';
    html += `${frEsc(text.slice(at, mark.at))}${tail ? `<span class="nowrap">${button}${frEsc(tail)}</span>` : button}`;
    at = mark.end + tail.length;
  }
  return html + frEsc(text.slice(at));
}
// The glosses of what is on screen: the tapped song or news line's, a grammar question's, else the Listen/Read item's.
function glossFor(fr) {
  const lined = screen === 'lyrics' || screen === 'news-edition';
  const lyricLine = lined ? (() => { const [s, l] = glossLine.split('.').map(Number); return (screen === 'lyrics' ? songLyrics : newsView)?.stanzas?.[s]?.[l]; })() : null;
  if (screen === 'story') { const found = storyView?.episode.gloss.find((entry) => entry.fr === fr); return found?.new ? { ...found, note: 'New in this episode.' } : found ?? null; }
  if (screen === 'sentences') return scCard()?.gloss.find((entry) => entry.fr === fr) ?? null;
  const lists = lined ? [lyricLine?.words] : grammarOnScreen() ? [activeGrammar()?.session?.current?.exercise?.gloss] : [streamState?.result?.gloss, streamState?.current?.gloss];
  for (const list of lists) { const found = (list || []).find((entry) => entry.fr === fr); if (found) return found; }
  return null;
}
function linesHTML(lines, glosses, withEnglish) {
  return `<div class="fr-lines">${lines.map((line) => `<div class="fr-line">${line.speaker ? `<span class="speaker">${esc(line.speaker)}</span>` : ''}<p lang="${languageTag}">${glossedHTML(line.fr, glosses)}</p>${withEnglish && line.en ? `<p class="en">${esc(line.en)}</p>` : ''}</div>`).join('')}</div>`;
}
function streamAudioHTML(view, settled) {
  if (!view.audio?.length) return '';
  const big = view.mode === 'listen' && !settled;
  const hint = clipHint();
  const key = `${streamId}:${view.key}`;
  const playing = clipRun?.key === key;
  const spot = !playing && clipSpot?.key === key ? clipSpot : null;
  const icon = playing ? pauseIcon : spot ? playIcon : speaker;
  const label = playing ? 'Pause' : spot && view.audio.length > 1 ? `Continue from line ${spot.index + 1}` : big ? `Play the ${languageEnglish}` : `Play the ${languageEnglish} again`;
  const reading = view.mode === 'read';
  const button = `<button class="${big ? 'listen-play' : reading ? 'primary reading-play' : 'icon'}" data-action="play-clips" aria-label="${esc(label)}">${icon}${reading ? `<span>${playing ? 'Pause' : spot ? 'Continue' : 'Listen'}</span>` : ''}</button>`;
  // In a passage, the line just heard can be heard once more on its own, playing or paused.
  const heard = view.audio.length > 1 ? (playing ? clipRun.heard : spot?.heard) : undefined;
  const again = heard !== undefined ? `<button class="quiet clip-again" data-action="clips-line">Line ${heard + 1} again</button>` : '';
  const restart = spot && spot.index > 0 ? '<button class="quiet clip-restart" data-action="clips-restart">From the start</button>' : '';
  return `<div class="listen-block${big ? ' big' : ''}">${button}<p class="listen-hint" id="clip-progress" role="status">${esc(hint)}</p>${again || restart ? `<div class="clip-actions">${again}${restart}</div>` : ''}</div>`;
}
function streamPromptHTML(view, settled) {
  const prompt = view.prompt || {};
  let html = '';
  // Once settled the full French appears below with its English, so the prompt does not repeat it.
  if (!settled) {
    const glosses = view.mode === 'read' ? view.gloss || [] : [];
    if (Array.isArray(prompt.lines) && prompt.lines.length) html += linesHTML(prompt.lines, glosses, false);
    else if (prompt.text) html += `<p class="fr-text" lang="${languageTag}">${glossedHTML(prompt.text, glosses)}</p>`;
    if (view.mode === 'read' && html) html = `<div class="reading-body">${html}</div>`;
  }
  if (prompt.question) html += `<p class="stream-question">${esc(prompt.question)}</p>`;
  return html;
}
function streamAnswerHTML(view, result) {
  const settled = !!result;
  return `<div class="choice-list" role="group" aria-label="Choose your answer">${view.choices.map((choice, index) => {
    const right = settled && choice === result.expected;
    const wrong = settled && !right && choice === result.given;
    const mark = right ? '<span class="choice-mark"><span aria-hidden="true">✓</span><span class="sr-only">the answer</span></span>'
      : wrong ? '<span class="choice-mark"><span aria-hidden="true">✕</span><span class="sr-only">what you chose</span></span>' : '';
    return `<button class="choice${wrong ? ' wrong' : right ? ' right' : ''}" data-pick="${index}" ${settled || locked() ? 'disabled' : ''}><span>${esc(choice)}</span>${mark}</button>`;
  }).join('')}</div>`;
}
function streamResultHTML(result) {
  const tone = result.outcome === 'incorrect' ? 'warn' : result.outcome === 'helped' ? 'neutral' : '';
  const title = ({ correct: 'That’s right.', helped: 'Right — after a look at the words.', incorrect: 'Not quite.' })[result.outcome] || '';
  // A right answer already shows itself; the expected one is worth its own line only when it differs.
  const expected = result.outcome === 'incorrect' ? `<p class="model-answer" lang="en">${esc(result.expected)}</p>` : '';
  return `<div class="feedback ${tone}" role="status"><strong>${title}</strong>${expected}${result.explanation ? `<p>${esc(result.explanation)}</p>` : ''}</div>`;
}
function streamRevealHTML(result) {
  if (!result.lines?.length) return '';
  return `<section class="reveal" aria-label="The ${languageEnglish} and its meaning">${linesHTML(result.lines, result.gloss, true)}<p class="caption">Tap any word for its meaning.</p></section>`;
}
// The Grammar by ear question on screen in Listen, if any.
function earShown() { return streamId === 'listen' && streamState?.ear ? streamState.ear : null; }
// What the speaker plays: the Grammar by ear sentence while one is shown, else the stream's question.
function shownView() { const ear = earShown(); return ear ? { key: `ear-${ear.id}`, mode: 'listen', audio: ear.audio } : streamState?.current; }
function shownSettled() { return earShown() ? !!earResult : !!streamState?.result; }
// The same choices, feedback and Next as a Listen question; then the French with its English.
function earBodyHTML(ear) {
  const result = earResult;
  const settled = !!result;
  const answered = settled ? { expected: ear.choices[result.answer], given: ear.choices[result.chosen], outcome: result.right ? 'correct' : 'incorrect', explanation: result.why } : null;
  const again = result?.again ? '<p class="caption">It comes back once, a few questions on.</p>' : '';
  const reveal = settled ? `<section class="reveal" aria-label="The ${languageEnglish} and its meaning">${linesHTML([{ fr: result.fr, en: result.en }], [], true)}</section>` : '';
  const action = settled ? `<div class="stream-actions pinned"><button class="primary" data-action="stream-next" ${locked() ? 'disabled' : ''}>${busy ? 'Saving…' : 'Next'}</button></div>` : '';
  return `<p class="stream-item">Grammar by ear${ear.again ? ' · again' : ''}</p><p class="prompt-instruction">Listen, then answer.</p>${streamAudioHTML(shownView(), settled)}<p class="stream-question">${esc(ear.question)}</p><div class="answer-area">${streamAnswerHTML(ear, answered)}</div>${settled ? `${streamResultHTML(answered)}${again}${reveal}` : ''}${action}`;
}
function streamBodyHTML() {
  const ear = earShown();
  if (ear) return earBodyHTML(ear);
  const view = streamState.current;
  const result = streamState.result;
  const settled = !!result;
  const item = view.item || {};
  const label = ITEM_LABEL[item.type];
  const reading = view.mode === 'read';
  const context = reading
    ? `<header class="reading-heading">${label ? `<p class="reading-kicker">${esc(label)}</p>` : ''}${item.title ? `<h1>${esc(item.title)}</h1>` : ''}</header>`
    : label ? `<p class="stream-item">${esc(label)}${item.title ? ` · ${esc(item.title)}` : ''}</p>` : '';
  const action = settled ? `<button class="primary" data-action="stream-next" ${locked() || streamState.waiting ? 'disabled' : ''}>${busy || streamState.waiting ? 'Saving…' : 'Next'}</button>` : '';
  const body = `${context}<p class="prompt-instruction">${esc(STREAM_INSTRUCTION[`${view.mode}:${view.kind}`] || '')}</p>${streamAudioHTML(view, settled)}${streamPromptHTML(view, settled)}<div class="answer-area">${streamAnswerHTML(view, result)}</div>${settled ? `${streamResultHTML(result)}${streamRevealHTML(result)}` : ''}${action ? `<div class="stream-actions${settled ? ' pinned' : ''}">${action}</div>` : ''}`;
  return reading ? `<article class="reading-exercise">${body}</article>` : body;
}
function streamEmptyHTML(id) {
  if (id.startsWith('focus:')) return '<div class="stream-empty"><p>Nothing left to practise here for now.</p><button class="secondary" data-action="mistakes">Back to mistakes</button></div>';
  if (id === 'read') return '<div class="stream-empty"><p>There is nothing to read yet.</p><button class="secondary" data-action="home">Back to Home</button></div>';
  return '<div class="stream-empty"><p>Recordings are still being prepared — try Read meanwhile.</p><button class="secondary" data-action="read">Go to Read</button></div>';
}
function renderStream() {
  const mode = screen === 'read' ? 'read' : 'listen';
  const label = levelFor(mode);
  const level = label ? `<span class="level-tag">${esc(label)}</span>` : '';
  const header = mode === 'listen' ? listenTop(`${savingStatusHTML()}${level}`) : `<div class="section-top">${back('Home', 'home')}<div>${savingStatusHTML()}${level}${infoButton('read')}</div></div>`;
  if (!streamState || loading) {
    main.innerHTML = `${noticeHTML()}<section class="stream">${header}<div class="loading-state" role="status">${loading ? `Opening ${mode === 'read' ? 'Read' : 'Listen'}…` : 'Your progress is safe on your Mac.'}</div></section>`;
    return;
  }
  main.innerHTML = `${noticeHTML()}<section class="stream">${header}${streamState.current ? streamBodyHTML() : streamEmptyHTML(streamId)}</section>`;
  autoplay();
}
function renderMixed() {
  const focus = screen === 'focus';
  const group = focus ? mistakeGroup() : null;
  const source = mixedSource === 'comprehension' ? (streamState?.current?.mode === 'read' ? 'Read' : 'Listen')
    : mixedSource === 'vocabulary' ? 'Words' : mixedSource === 'grammar' ? 'Grammar' : mixedSource === 'write' ? 'Write it' : '';
  const label = focus ? `${group ? group.title : 'Mistakes'}${source ? ` · ${source}` : ''}` : source;
  const header = `<div class="section-top">${back(focus ? 'Mistakes' : 'Home', focus ? 'mistakes' : 'home')}<div>${savingStatusHTML()}<span class="stream-label">${esc(label)}</span>${infoButton(focus ? 'mistakes' : 'practise')}</div></div>`;
  if (loading) { main.innerHTML = `${noticeHTML()}<section class="stream">${header}<div class="loading-state" role="status">Opening your practice…</div></section>`; return; }
  const vocabulary = mixedSource === 'vocabulary' && snapshot?.current;
  const writing = mixedSource === 'write' && writeView?.current;
  let body;
  if (mixedSource === 'comprehension' && streamState?.current) body = streamBodyHTML();
  else if (vocabulary) body = cardHTML();
  else if (mixedSource === 'grammar' && review?.session?.current) body = `<p class="question-topic">${esc(review.session.current.exercise.topicTitle)}</p>${exerciseCoreHTML(review, false, 'Next')}`;
  else if (writing) body = writeBodyHTML();
  else body = focus
    ? '<div class="stream-empty"><p>Nothing left to practise here for now.</p><button class="secondary" data-action="mistakes">Back to mistakes</button></div>'
    : '<div class="stream-empty"><p>Nothing to practise right now. New words arrive at 04:00, and recordings are still being prepared.</p><button class="secondary" data-action="home">Back to Home</button></div>';
  main.innerHTML = `${noticeHTML()}<section class="${vocabulary ? 'practice' : writing ? 'stream vb write' : 'stream'}">${header}${body}</section>`;
  if (vocabulary) playCardOnce();
  else if (mixedSource === 'comprehension') autoplay();
  else if (writing) main.querySelector('[data-action="write-next"].primary')?.focus({ preventScroll: true });
}
function renderMistakes() {
  const header = `<div class="section-top">${back('Home', 'home')}${infoButton('mistakes')}</div><h1>Mistakes</h1><p class="subtitle">What keeps catching you out. Tap one to practise it.</p>`;
  if (!mistakes || loading) { main.innerHTML = `${noticeHTML()}<section class="topics">${header}${loading ? '<div class="loading-state" role="status">Looking at what you missed…</div>' : ''}</section>`; return; }
  if (!mistakes.length) { main.innerHTML = `${noticeHTML()}<section class="topics">${header}<p class="empty-list">No mistakes recorded yet.</p></section>`; return; }
  const rows = mistakes.map((group) => {
    const examples = (group.examples || []).slice(0, 3).map((example) => `<p lang="${languageTag}">${frEsc(example)}</p>`).join('');
    return `<button class="topic-row" data-group="${esc(group.id)}" ${locked() ? 'disabled' : ''}><span class="copy"><span class="topic-name"><h3>${esc(group.title)}</h3></span>${examples}</span><span class="arrow" aria-hidden="true">→</span></button>`;
  }).join('');
  main.innerHTML = `${noticeHTML()}<section class="topics">${header}<div class="topic-list">${rows}</div></section>`;
}
async function loadStream(id, message = '') {
  const token = ++streamGeneration;
  streamId = id; streamState = null; earResult = null; earLater = null; audioBlocked = false; loading = true;
  notice = message ? { kind: 'info', message } : null; retryAction = null;
  render();
  try {
    await streamSettled();
    const state = await api(`api/comprehension/state?stream=${encodeURIComponent(id)}`);
    if (token !== streamGeneration) return false;
    applyStream(state); loading = false; render(); return true;
  } catch (error) {
    if (token !== streamGeneration) return false;
    loading = false; notice = { message: error.message }; retryAction = { type: 'stream', stream: id, message };
    render(); return false;
  }
}
function enterStream() { loadStream(screen === 'read' ? 'read' : 'listen'); }
function openStream(name) { if (move(name, true)) enterStream(); }
function openMix() { if (move('mix', true)) enterMixed(); }
// ── Friends: who may sign in to the friends' Echo (pilot/router.ts) with Google. Only in the owner's Echo. ──
let friendsInfo = null; // { friends, origin, signIn } from api/friends
function openFriends() { if (move('friends', true)) loadFriends(); }
async function loadFriends() {
  loading = true; notice = null; retryAction = null; render();
  try { friendsInfo = await api('api/friends'); } catch (error) { notice = { message: error.message }; retryAction = { type: 'friends' }; }
  loading = false;
  if (screen === 'friends') render();
}
async function saveFriend(email, name) {
  if (busy) return;
  busy = true; notice = null; render();
  try { await api('api/friends', { method: 'POST', body: JSON.stringify({ email, name }) }); friendsInfo = await api('api/friends'); notice = { kind: 'info', message: `${email.trim().toLowerCase()} can sign in now.` }; }
  catch (error) { notice = { message: error.message }; }
  busy = false;
  if (screen === 'friends') render();
}
async function removeFriend(id, name) {
  if (busy || !confirm(`Take ${name} off the list? They are signed out at once; their progress is kept in case you add them back.`)) return;
  busy = true; notice = null; render();
  try { await api('api/friends/remove', { method: 'POST', body: JSON.stringify({ id }) }); friendsInfo = await api('api/friends'); }
  catch (error) { notice = { message: error.message }; }
  busy = false;
  if (screen === 'friends') render();
}
async function dismissRequest(email) {
  if (busy) return;
  busy = true; notice = null; render();
  try { await api('api/friends/dismiss', { method: 'POST', body: JSON.stringify({ email }) }); friendsInfo = await api('api/friends'); }
  catch (error) { notice = { message: error.message }; }
  busy = false;
  if (screen === 'friends') render();
}
// The door: open, anyone who signs in with Google joins at once; it closes by itself after an hour (pilot/accounts.ts).
async function setDoor(minutes) {
  if (busy) return;
  busy = true; notice = null; render();
  try { await api('api/friends/door', { method: 'POST', body: JSON.stringify({ minutes }) }); friendsInfo = await api('api/friends'); homeInfo.at = 0; }
  catch (error) { notice = { message: error.message }; }
  busy = false;
  if (screen === 'friends') render();
}
// While the door is open the page reads the list again every 15 s, so a friend who just joined shows up.
let friendsPoll = 0;
function pollFriends() {
  clearTimeout(friendsPoll);
  if (!friendsInfo?.openUntil) return;
  friendsPoll = setTimeout(async () => {
    if (screen !== 'friends' || busy) return;
    try { friendsInfo = await api('api/friends'); } catch { /* the next look tries again */ }
    if (screen === 'friends' && !busy) render();
  }, 15_000);
}
async function copyFriendsLink() {
  try { await navigator.clipboard.writeText(`${friendsInfo.origin}/`); notice = { kind: 'info', message: 'Link copied.' }; } catch { notice = { message: `Copy this link: ${friendsInfo.origin}/` }; }
  render();
}
function renderFriends() {
  const header = `<div class="section-top">${back('Home', 'home')}</div><h1>Friends</h1><p class="subtitle">Who can sign in to the friends’ Echo with Google. Each has their own progress; nobody sees anyone else’s.</p>`;
  if (!friendsInfo || loading) { main.innerHTML = `${noticeHTML()}<section class="topics friends">${header}${loading ? '<div class="loading-state" role="status">Looking up your friends…</div>' : ''}</section>`; return; }
  const seen = (at) => at ? `last in ${dayLabel(at).toLowerCase()}` : 'not signed in yet';
  const active = friendsInfo.friends.filter((friend) => !friend.removedAt), removed = friendsInfo.friends.filter((friend) => friend.removedAt);
  const rows = active.map((friend) => `<li><div class="name"><p>${esc(friend.name)}</p><small>${esc(friend.email)} · ${seen(friend.lastSeenAt)}${friend.devices ? ` · ${friend.devices} ${friend.devices === 1 ? 'device' : 'devices'}` : ''}</small></div><button class="quiet" data-action="friend-remove" data-id="${esc(friend.id)}" data-name="${esc(friend.name)}" ${busy ? 'disabled' : ''}>Remove</button></li>`).join('');
  const gone = removed.map((friend) => `<li><div class="name"><p>${esc(friend.name)}</p><small>${esc(friend.email)} · removed, progress kept</small></div><button class="quiet" data-action="friend-restore" data-email="${esc(friend.email)}" data-name="${esc(friend.name)}" ${busy ? 'disabled' : ''}>Add back</button></li>`).join('');
  // Google accounts that signed in while not on the list, latest first: let one in, or dismiss it.
  const waiting = (friendsInfo.requests || []).map((request) => `<li><div class="name"><p>${esc(request.name)}</p><small>${esc(request.email)} · tried ${dateLabel(request.lastAt)}${request.attempts > 1 ? ` · ${request.attempts} times` : ''}</small></div><button class="quiet" data-action="friend-restore" data-email="${esc(request.email)}" data-name="${esc(request.name)}" ${busy ? 'disabled' : ''}>Let in</button><button class="quiet" data-action="friend-dismiss" data-email="${esc(request.email)}" ${busy ? 'disabled' : ''}>Dismiss</button></li>`).join('');
  const clock = (at) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const door = friendsInfo.openUntil
    ? `<div class="friends-door open"><p><b>Open until ${clock(friendsInfo.openUntil)}.</b> Anyone who signs in with Google joins now, under the name Google gives. It closes by itself.</p><button class="secondary" data-action="friends-door" data-minutes="0" ${busy ? 'disabled' : ''}>Close now</button></div>`
    : `<div class="friends-door"><p><b>Closed.</b> Only the people below can sign in; anyone else waits under Tried to sign in.</p><button class="primary" data-action="friends-door" data-minutes="60" ${busy ? 'disabled' : ''}>Let anyone in for 1 hour</button></div>`;
  main.innerHTML = `${noticeHTML()}<section class="topics friends">${header}
    ${friendsInfo.signIn ? '' : '<p class="feedback warn">Google sign-in is not set up yet, so nobody can sign in. Its client goes in ~/echo-pilot/google.json.</p>'}
    ${door}
    ${waiting ? `<p class="vs-label">Tried to sign in</p><ol class="st-rows">${waiting}</ol>` : ''}
    <form id="friend-form" class="friend-form"><label for="friend-email">Google email</label><input id="friend-email" type="email" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="dana@gmail.com" required>
      <label for="friend-name">Name</label><input id="friend-name" autocomplete="off" placeholder="Dana"><button class="primary" ${busy ? 'disabled' : ''}>Add</button></form>
    ${active.length ? `<ol class="st-rows">${rows}</ol>` : '<p class="empty-list">Nobody yet. Add a friend’s Google email, then send them the link.</p>'}
    <div class="friends-link"><p>Their link</p><code>${esc(friendsInfo.origin)}/</code><button class="secondary" data-action="friends-copy">Copy link</button></div>
    ${gone ? `<p class="vs-label">Removed</p><ol class="st-rows">${gone}</ol>` : ''}</section>`;
  pollFriends();
}
function openMistakes() { if (move('mistakes', true)) loadMistakes(); }
// ── Statistics ───────────────────────────────────────────────────────────────
// statsBin is the score bar whose words are listed (null: none); bars run from -8 to 8, the ends holding everything beyond.
let statistics = null;
let statsBin = null;
let statsOpen = false; // the chosen bar's word list starts closed, and opens when a bar is tapped
let pointsDay = ''; // the day whose points are spelled out under the chart; today until another is tapped
// Statistics shows the points of words and verbs together, then one part at a time: Words, Verbs or Other.
const STATS_TABS = { words: 'Words', verbs: 'Verbs', other: 'Other' };
let statsTab = (() => { const saved = readPreference('echo.stats-tab', 'words'); return saved in STATS_TABS ? saved : 'words'; })();
// The Word scores chart can show the end of any past day (statistics.history, oldest first, today last); statsAt
// is the day shown. A past day's words load when its bar list is opened, once per visit.
let statsAt = 0;
let statsPlay = 0;
const statsDayWords = new Map(); // day → words, or 'loading'
const points = (value) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(Math.round(value * 10) / 10).toLocaleString('en')}`;
// The figures above a chart: one big number under its label, the others in a quiet line beneath, and Total small in
// the top right. The big number sits on the left edge and Total on the right, so another day's longer number or label
// moves nothing. Whole, no sign unless below zero; figures saved before totals existed show a dash.
const wholeFigure = (value) => typeof value === 'number' ? `${Math.round(value) < 0 ? '−' : ''}${Math.abs(Math.round(value)).toLocaleString('en')}` : '–';
const statFigures = ([label, value], parts, total) => `<div class="st-figures"><div><span>${esc(label)}</span><strong>${wholeFigure(value)}</strong><small>${parts.map(([name, count]) => `${esc(name)} ${wholeFigure(count)}`).join(' · ')}</small></div><div class="total"><span>Total</span><strong>${wholeFigure(total)}</strong></div></div>`;
const STATS_BINS = Array.from({ length: 17 }, (_, index) => index - 8);
const statsBinOf = (score) => Math.max(-8, Math.min(8, Math.round(score)));
const statsKnown = (word) => word.status === 'scheduled' || word.status === 'due';
const signed = (value) => String(value).replace('-', '−');
const statsDayLabel = (day) => new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00`));
// The started words of the day shown, with the score and state they had then.
function statsShownWords() {
  const history = statistics.history, day = history[statsAt];
  if (statsAt === history.length - 1) return statistics.words.map((word) => ({ ...word, known: statsKnown(word) }));
  const then = statsDayWords.get(day.day);
  if (!Array.isArray(then)) return null;
  const now = new Map(statistics.words.map((word) => [word.id, word]));
  return then.flatMap((entry) => now.has(entry.id) ? [{ ...now.get(entry.id), score: entry.score, known: entry.known }] : []);
}
function scoresViewHTML() {
  const history = statistics.history, shown = history[statsAt], today = history.at(-1), past = statsAt < history.length - 1;
  // One scale for every day, so bars grow as the words did.
  const tallest = Math.max(1, ...history.flatMap((day) => day.bins.map(([know, learning]) => know + learning)));
  const bars = STATS_BINS.map((bin, index) => {
    const [know, learning] = shown.bins[index];
    const tone = bin < 0 ? 'neg' : bin === 0 ? 'zero' : 'pos';
    const ghost = past ? `<span class="ghost" style="height:${(today.bins[index][0] + today.bins[index][1]) / tallest * 100}%"></span>` : '';
    return `<button class="st-bar ${tone}" data-action="stats-bin" data-bin="${bin}" aria-pressed="${statsBin === bin}" aria-label="Score ${signed(bin)}: ${know} known, ${learning} still learning">${ghost}<span class="learning" style="height:${learning / tallest * 100}%"></span><span class="know" style="height:${know / tallest * 100}%"></span></button>`;
  }).join('');
  return `${statFigures(['Known', shown.know], [['learning', shown.learning]], shown.sum)}
      <div class="st-hist">${bars}</div>
      <div class="st-axis"><span>shaky</span><span>0</span><span>solid</span></div>
      <div class="st-legend"><span><i class="know"></i>words you know</span><span><i class="learning"></i>still learning</span>${past ? '<span><i class="ghost"></i>today</span>' : ''}</div>`;
}
// A Statistics block's heading, with what it shows behind an ⓘ: tapping it opens the explanation in a bubble, and
// tapping anywhere else closes it.
const stHead = (title, help) => `<div class="st-head"><h2>${esc(title)}</h2><button class="st-info" data-action="st-info" aria-expanded="false" aria-label="What ${esc(title.toLowerCase())} shows">${infoIcon}</button><p class="st-tip" role="note" hidden>${esc(help)}</p></div>`;
function closeStatsTips(except) {
  for (const tip of document.querySelectorAll('.st-tip:not([hidden])')) if (tip !== except) { tip.hidden = true; tip.previousElementSibling?.setAttribute('aria-expanded', 'false'); }
}
function toggleStatsTip(button) {
  const tip = button.nextElementSibling;
  closeStatsTips(tip);
  tip.hidden = !tip.hidden;
  button.setAttribute('aria-expanded', String(!tip.hidden));
}
function scoresWhenHTML() {
  const history = statistics.history, shown = history[statsAt], past = statsAt < history.length - 1;
  const label = past ? `${esc(statsDayLabel(shown.day))}<small>end of the day</small>` : `Today<small>${esc(statsDayLabel(shown.day))}</small>`;
  return `<button class="icon" data-action="stats-day" data-step="-1" aria-label="Day before" ${statsAt === 0 ? 'disabled' : ''}>‹</button><p class="st-when-label" role="status">${label}</p><button class="icon" data-action="stats-day" data-step="1" aria-label="Day after" ${past ? '' : 'disabled'}>›</button><button class="icon" data-action="stats-play" aria-label="${statsPlay ? 'Stop' : 'Play from your first day'}">${statsPlay ? '❚❚' : '▶'}</button>`;
}
function scoresAfterHTML() {
  const history = statistics.history, shown = history[statsAt], today = history.at(-1), past = statsAt < history.length - 1;
  const solid = (day) => day.bins.slice(9).reduce((sum, [know, learning]) => sum + know + learning, 0);
  const more = today.know - shown.know, firmer = solid(today) - solid(shown);
  const change = (value) => `<strong>${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}</strong>`;
  const delta = past ? `<p class="st-delta">Since then: ${change(more)} words you know${firmer ? `, and ${Math.abs(firmer)} ${firmer > 0 ? 'more' : 'fewer'} on the solid side` : ''}.</p>` : '';
  const words = statsBin === null ? [] : statsShownWords();
  const chosen = words ? words.filter((word) => statsBinOf(word.score) === statsBin) : null;
  const binLabel = statsBin === -8 ? '−8 or lower' : statsBin === 8 ? '8 or higher' : signed(statsBin);
  const count = chosen ? ` · ${chosen.length} ${chosen.length === 1 ? 'word' : 'words'}` : '';
  const list = !statsOpen ? '' : !chosen ? '<p class="st-cap" role="status">Loading that day’s words…</p>' : chosen.length ? `<ol>${chosen.map((word) => `<li><span class="fr${genderClass(word.gender)}" lang="${languageTag}">${frEsc(word.fr)}</span><span class="en">${esc(word.en)}</span></li>`).join('')}</ol>` : '';
  const binList = statsBin === null ? '' : `<div class="st-bin"><button class="st-bin-head" data-action="stats-list" aria-expanded="${statsOpen}"><span>Score ${binLabel}${count}</span><span class="chev" aria-hidden="true">⌄</span></button>${list}</div>`;
  return `${delta}
      ${binList}`;
}
// Redraws the Word scores block in place, so the slider keeps its drag and the page its scroll.
function drawScores() {
  if (screen !== 'statistics' || !statistics) return;
  const view = document.querySelector('#st-scores'), when = document.querySelector('#st-when'), after = document.querySelector('#st-scores-after'), slider = document.querySelector('#st-slider');
  if (view) view.innerHTML = scoresViewHTML();
  if (when) when.innerHTML = scoresWhenHTML();
  if (after) after.innerHTML = scoresAfterHTML();
  if (slider && Number(slider.value) !== statsAt) slider.value = statsAt;
  if (statsOpen && statsBin !== null) loadStatsDay();
}
async function loadStatsDay() {
  const day = statistics?.history[statsAt];
  if (!day || statsAt === statistics.history.length - 1 || statsDayWords.has(day.day)) return;
  statsDayWords.set(day.day, 'loading');
  try { statsDayWords.set(day.day, (await api(`api/statistics/day/${day.day}`)).words); }
  catch (error) { statsDayWords.delete(day.day); notice = { message: error.message }; render(); return; }
  drawScores();
}
function showStatsDay(index) { statsAt = Math.max(0, Math.min(statistics.history.length - 1, index)); drawScores(); }
function stopStatsPlay() { clearInterval(statsPlay); statsPlay = 0; }
// Plays from the first day to today, a step each 0.7 s; tapping again stops where it is.
function toggleStatsPlay() {
  if (statsPlay) { stopStatsPlay(); drawScores(); return; }
  statsAt = 0;
  statsPlay = setInterval(() => {
    if (screen !== 'statistics' || !statistics || statsAt >= statistics.history.length - 1) { stopStatsPlay(); drawScores(); return; }
    statsAt += 1; drawScores();
  }, 700);
  drawScores();
}
// The Verbs part of Statistics: the forms' scores at the end of each day, with the day shown at vScoreAt (-1: today),
// the bar picked and its list; the hardest forms; and scores and answers by tense, person and kind of verb.
let vScoreAt = -1, vScorePlay = 0, vScoreBin = null, vScoreOpen = true;
const vScoreDayForms = new Map(); // day → its forms with their scores then, or 'loading'
const vsDays = () => statistics?.verbs?.scores.days ?? [];
const vsIndex = () => vScoreAt < 0 ? vsDays().length - 1 : vScoreAt;
function vsRow(label, sub, cell, action = '') {
  const share = cell.total ? Math.round(cell.right / cell.total * 100) : null;
  const inner = `<span class="vs-lbl" lang="${languageTag}">${esc(label)}<small>${esc(sub)}</small></span><span class="vs-track"><span style="width:${share ?? 0}%"></span></span><span class="vs-pct">${share === null ? '—' : `${share}%`}</span>`;
  const tone = share === null ? ' none' : share < 50 ? ' low' : '';
  return action ? `<button class="vs-row${tone}" ${action}>${inner}</button>` : `<div class="vs-row${tone}">${inner}</div>`;
}
function verbScoresHTML() {
  const days = vsDays(), at = vsIndex(), shown = days[at], today = days.at(-1), past = at < days.length - 1;
  // One scale for every day, so bars grow as the forms did.
  const tallest = Math.max(1, ...days.flatMap((day) => day.bins));
  const bars = STATS_BINS.map((bin, index) => {
    const tone = bin < 0 ? 'neg' : bin === 0 ? 'zero' : 'pos';
    const ghost = past ? `<span class="ghost" style="height:${today.bins[index] / tallest * 100}%"></span>` : '';
    return `<button class="st-bar ${tone}" data-action="stats-vbin" data-bin="${bin}" aria-pressed="${vScoreBin === bin}" aria-label="Score ${signed(bin)}: ${shown.bins[index]} forms">${ghost}<span class="know" style="height:${shown.bins[index] / tallest * 100}%"></span></button>`;
  }).join('');
  return `${statFigures(['Solid', shown.solid], [['shaky', shown.shaky], ['practised', shown.practised]], shown.sum)}
      <div class="st-hist">${bars}</div>
      <div class="st-axis"><span>shaky</span><span>0</span><span>solid</span></div>
      <div class="st-legend"><span><i class="know"></i>verb forms</span>${past ? '<span><i class="ghost"></i>today</span>' : ''}</div>`;
}
function verbScoresWhenHTML() {
  const days = vsDays(), at = vsIndex(), shown = days[at], past = at < days.length - 1;
  const label = past ? `${esc(statsDayLabel(shown.day))}<small>end of the day</small>` : `Today<small>${esc(statsDayLabel(shown.day))}</small>`;
  return `<button class="icon" data-action="stats-vstep" data-step="-1" aria-label="Day before" ${at === 0 ? 'disabled' : ''}>‹</button><p class="st-when-label" role="status">${label}</p><button class="icon" data-action="stats-vstep" data-step="1" aria-label="Day after" ${past ? '' : 'disabled'}>›</button><button class="icon" data-action="stats-vplay" aria-label="${vScorePlay ? 'Stop' : 'Play from your first day'}">${vScorePlay ? '❚❚' : '▶'}</button>`;
}
function verbScoresAfterHTML() {
  const days = vsDays(), at = vsIndex(), shown = days[at], today = days.at(-1), past = at < days.length - 1;
  const change = (value) => `<strong>${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}</strong>`;
  const delta = past ? `<p class="st-delta">Since then: ${change(today.solid - shown.solid)} at +3 or more, ${change(today.shaky - shown.shaky)} at −2 or less.</p>` : '';
  if (vScoreBin === null) return delta;
  const forms = vScoreDayForms.get(shown.day);
  if (forms === undefined) loadVerbScoreDay(shown.day);
  const chosen = Array.isArray(forms) ? forms.filter((form) => statsBinOf(form.score) === vScoreBin) : null;
  const binLabel = vScoreBin === -8 ? '−8 or lower' : vScoreBin === 8 ? '8 or higher' : signed(vScoreBin);
  const count = chosen ? ` · ${chosen.length} ${chosen.length === 1 ? 'form' : 'forms'}` : '';
  const list = !vScoreOpen ? '' : !chosen ? '<p class="st-cap" role="status">Loading that day’s forms…</p>' : chosen.length ? `<ol>${chosen.map((form) => `<li><span class="fr" lang="${languageTag}">${frEsc(form.form)}</span><span class="en">${esc(form.inf)} · ${esc(form.tenseName)}</span></li>`).join('')}</ol>` : '';
  return `${delta}<div class="st-bin"><button class="st-bin-head" data-action="stats-vlist" aria-expanded="${vScoreOpen}"><span>Score ${binLabel}${count}</span><span class="chev" aria-hidden="true">⌄</span></button>${list}</div>`;
}
async function loadVerbScoreDay(day) {
  vScoreDayForms.set(day, 'loading');
  try { vScoreDayForms.set(day, (await api(`api/verbs/scores/${day}`)).forms); }
  catch (error) { vScoreDayForms.delete(day); notice = { message: error.message }; render(); return; }
  drawVerbScores();
}
// Redraws the score block in place, so the slider keeps its drag and the page its scroll.
function drawVerbScores() {
  if (screen !== 'statistics') return;
  const view = document.querySelector('#vs-scores'), when = document.querySelector('#vs-when'), after = document.querySelector('#vs-scores-after'), slider = document.querySelector('#vs-slider');
  if (view) view.innerHTML = verbScoresHTML();
  if (when) when.innerHTML = verbScoresWhenHTML();
  if (after) after.innerHTML = verbScoresAfterHTML();
  if (slider) slider.value = String(vsIndex());
}
function showVerbDay(index) { vScoreAt = Math.max(0, Math.min(vsDays().length - 1, index)); if (vScoreAt === vsDays().length - 1) vScoreAt = -1; drawVerbScores(); }
function chooseVerbBin(bin) { vScoreBin = vScoreBin === bin ? null : bin; vScoreOpen = true; drawVerbScores(); }
function stopVerbPlay() { clearInterval(vScorePlay); vScorePlay = 0; }
function toggleVerbPlay() {
  if (vScorePlay) { stopVerbPlay(); drawVerbScores(); return; }
  vScoreAt = 0;
  vScorePlay = setInterval(() => {
    if (screen !== 'statistics' || vsIndex() >= vsDays().length - 1) { stopVerbPlay(); drawVerbScores(); return; }
    vScoreAt += 1; drawVerbScores();
  }, 700);
  drawVerbScores();
}
// By tense and by person: the average score of the forms (tagged like the categories), and the share right in the
// last two weeks as the bar. A tense row opens that tense's page.
function verbTensePersonRows(entries) {
  const feel = (average) => average === null ? '' : average < 0 ? 'shaky' : average < 2 ? 'steady' : 'solid';
  return entries.map(({ label, score, answered, action }) => {
    // Rounded first, so an average of -0.04 reads 0.0 and is steady, not shaky.
    const average = score.average === null ? null : Math.round(score.average * 10) / 10 || 0;
    const share = answered.total ? Math.round(answered.right / answered.total * 100) : null;
    const sub = score.forms ? `${score.forms} ${score.forms === 1 ? 'form' : 'forms'} · average ${average > 0 ? '+' : average < 0 ? '−' : ''}${Math.abs(average).toFixed(1)}${share === null ? '' : ` · ${share}% right lately`}` : 'not practised yet';
    const inner = `<div class="name"><p lang="${languageTag}">${esc(label)}</p><small>${sub}</small></div><div class="st-mini"><span style="width:${share ?? 0}%"></span></div><span class="st-tag ${feel(average)}">${feel(average)}</span>`;
    return action ? `<li><button class="st-row-link" ${action}>${inner}</button></li>` : `<li>${inner}</li>`;
  }).join('');
}
function verbStatsHTML() {
  const verbs = statistics.verbs;
  if (!verbs?.forms.practised) return `<div class="st-block"><h2>Verb forms</h2><p class="st-cap">Practise in Verbs and your forms show up here: one verb, in one tense, for one person.</p></div>`;
  const { scores } = verbs;
  const kinds = verbs.kinds.map((kind) => vsRow(kind.title, `${VB_TENSES[kind.tense]} · ${kind.total} answers`, kind, `data-action="vb-tense-page" data-tense="${kind.tense}"`)).join('');
  const tenses = verbTensePersonRows(Object.entries(VB_TENSES).map(([tense, name]) => ({ label: name, score: scores.tenses[tense], answered: verbs.tenses[tense], action: `data-action="vb-tense-page" data-tense="${tense}"` })));
  const people = verbTensePersonRows(VB_PERSONS.flatMap((person, index) => person ? [{ label: person, score: scores.people[index], answered: verbs.people[index] }] : []));
  return `<div class="st-block">${stHead('Verb form scores', `Each bar counts your practised forms (${VB.stats.form}) with that score. A typed answer right adds 2 and wrong takes 3 off; ${VB.stats.mark} adds 1 or takes 2 off; scores drift back towards the middle over a few weeks. Look, then write grades whole tables, not forms, so it doesn’t move these. ${VB.stats.drills} bring the left side most. Solid is +3 or more, shaky −2 or less; practised counts the forms tried, of ${statistics.verbs.forms.total.toLocaleString('en')} in your verbs’ ${VB.stats.all}. Total is every form’s score added up. Choose a day, or press ▶, to see the chart as it was; the dashed outline is today. Tap a bar to see its forms.`)}
      <div id="vs-scores">${verbScoresHTML()}</div>
      ${vsDays().length > 1 ? `<div class="st-when" id="vs-when">${verbScoresWhenHTML()}</div>
      <input type="range" class="st-slider" id="vs-slider" min="0" max="${vsDays().length - 1}" step="1" value="${vsIndex()}" aria-label="Choose a day">
      <div class="st-ticks" aria-hidden="true">${vsDays().map((day, index, all) => `<span>${index === all.length - 1 ? 'today' : (all.length - 1 - index) % 2 === 0 ? Number(day.day.slice(8)) : ''}</span>`).join('')}</div>` : ''}
      <div id="vs-scores-after">${verbScoresAfterHTML()}</div></div>
    <div class="st-block">${stHead('Hardest forms right now', 'The five forms with the lowest score. Tap one to fill in its whole table.')}<ol class="st-rows">${scores.hardest.map((form) => `<li><button class="st-row-link" data-action="vb-cell" data-verb="${esc(form.verbId)}" data-tense="${form.tense}"><div class="name"><p lang="${languageTag}" class="fr">${frEsc(form.form)}</p><small>${esc(form.inf)} · ${esc(form.tenseName)}</small></div><span class="st-tag shaky">missed ${form.misses}×</span></button></li>`).join('')}</ol></div>
    <div class="st-block">${stHead(VB.stats.head, `Shaky, steady or solid is the average score of your forms; the bar and the percentage are the share you got right in the last two weeks. Tap a ${VB.unit} to read about it.`)}
      <p class="vs-label">${VB.units}</p><ol class="st-rows">${tenses}</ol>
      <p class="vs-label">${VB.stats.persons}</p><ol class="st-rows">${people}</ol></div>
    ${kinds ? `<div class="st-block">${stHead('By kind of verb', VB.stats.kinds)}<div class="vs-rows">${kinds}</div></div>` : ''}`;
}
function renderStatistics() {
  const header = `<div class="section-top">${back('Home', 'home')}</div><h1>Your progress</h1><p class="subtitle">How your ${languageEnglish} words are doing. Nothing here is a target.</p>`;
  if (!statistics || loading) { main.innerHTML = `${noticeHTML()}<section class="st">${header}${loading ? '<div class="loading-state" role="status">Adding it all up…</div>' : ''}</section>`; return; }
  const { words, counts } = statistics;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const parts = [['learning', 'learning', 'var(--violet)'], ['due', 'due now', 'var(--peach)'], ['scheduled', 'known', 'var(--getting)'], ['new', 'not started', 'var(--frame)']];
  const stack = parts.map(([key, , colour]) => `<span style="width:${counts[key] / total * 100}%;background:${colour}"></span>`).join('');
  const legend = parts.map(([key, label, colour]) => `<span><i style="background:${colour}"></i><b>${counts[key]}</b>${label}</span>`).join('');
  const hardest = words.filter((word) => word.score < 0).slice(0, 6);
  const hard = hardest.length ? `<ol class="st-rows">${hardest.map((word) => `<li><div class="name"><p lang="${languageTag}" class="fr${genderClass(word.gender)}">${frEsc(word.fr)}</p><small>${esc(word.en)}</small></div><span class="st-tag shaky">missed ${word.misses}×</span></li>`).join('')}</ol>` : '<p class="st-cap">Nothing shaky right now.</p>';
  const feel = (average) => average === null ? '' : average < 0 ? 'shaky' : average < 2 ? 'steady' : 'solid';
  const categories = statistics.categories.map((category) => `<li><div class="name"><p>${esc(categoryTitle(category.id))}</p><small>${category.started} of ${category.total} started</small></div><div class="st-mini"><span style="width:${category.started / category.total * 100}%"></span></div>${category.average === null ? '<span class="st-tag"></span>' : `<span class="st-tag ${feel(category.average)}">${feel(category.average)}</span>`}</li>`).join('');
  const busiest = Math.max(1, ...statistics.days.map((day) => day.knew + day.missed));
  const days = statistics.days.map((day) => day.knew + day.missed
    ? `<div title="${esc(dayLabel(`${day.day}T12:00`))}: ${day.knew} knew, ${day.missed} missed"><span class="k" style="height:${day.knew / busiest * 100}%"></span><span class="m" style="height:${day.missed / busiest * 100}%"></span></div>`
    : '<div><span class="empty"></span></div>').join('');
  const dayAxis = statistics.days.map((day, index) => `<span>${index % 2 === 1 ? Number(day.day.slice(8)) : ''}</span>`).join('');
  // Points, words and verbs together: each day's gains stacked above the line and its losses below, words in violet
  // and verbs in the darker shade. The line sits where the days put it: with no losing day, all the height is gains.
  const verbPoints = new Map((statistics.verbs?.scores.points ?? []).map((day) => [day.day, day.gained - day.lost]));
  const together = statistics.days.map((day) => ({ day: day.day, words: day.gained - day.lost, verbs: verbPoints.get(day.day) ?? 0 }));
  const today = together.at(-1);
  const shown = together.find((day) => day.day === pointsDay) ?? today;
  const rise = (day) => Math.max(0, day.words) + Math.max(0, day.verbs), fall = (day) => Math.max(0, -day.words) + Math.max(0, -day.verbs);
  const top = Math.max(0, ...together.map(rise)), bottom = Math.max(0, ...together.map(fall));
  const rows = top + bottom ? `grid-template-rows:${top}fr ${bottom}fr` : '';
  const part = (value, of, kind) => `<span class="${kind}" style="height:${of ? value / of * 100 : 0}%"></span>`;
  const pointBars = together.map((day) => `<button class="st-pt st-pt-both" style="${rows}" data-action="points-day" data-day="${day.day}" aria-pressed="${day.day === shown.day}" aria-label="${esc(dayLabel(`${day.day}T12:00`))}: ${points(day.words + day.verbs)} points, words ${points(day.words)}, verbs ${points(day.verbs)}"><span class="up">${part(Math.max(0, day.verbs), top, 'verbs')}${part(Math.max(0, day.words), top, 'words')}</span><span class="down">${part(Math.max(0, -day.words), bottom, 'words')}${part(Math.max(0, -day.verbs), bottom, 'verbs')}</span></button>`).join('');
  const shownLabel = shown.day === today.day ? 'Today' : new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${shown.day}T12:00`));
  const pointsBlock = `<div class="st-block">${stHead('Points, last two weeks', 'How far your words and verbs climbed, together. Words: +2 an answer known in Cards, +1 in Endless, +0.5 a word heard to the end on the Walkman, and ✓ there counting like knowing it. Verbs: +2 a typed form, +1 a Cards or tape mark, and in Look, then write +2 a table written perfectly or −1 a table with any miss. A miss (−3, or −1 in Endless, −2 a mark) only takes back what that word or form had climbed, by your answers, above the lowest it had been: missing something you never knew costs nothing, forgetting something you knew costs what you had. Each bar is the day: gains stacked above the line, losses below. Tap a day to see its points and how they split; Total is the two weeks added up.')}
      ${statFigures([shownLabel, shown.words + shown.verbs], [['words', shown.words], ['verbs', shown.verbs]], together.reduce((sum, day) => sum + day.words + day.verbs, 0))}
      <div class="st-points">${pointBars}</div><div class="st-days-axis">${dayAxis}</div>
      <div class="st-legend"><span><i style="background:var(--violet)"></i>words</span><span><i style="background:var(--getting)"></i>verbs</span><span><i style="background:var(--danger)"></i>lost more than gained</span></div></div>`;
  // Each row is the share right per day, always out of 100%, with its two-week share beside the label.
  const accuracyRow = (label, counts) => {
    const right = counts.reduce((sum, count) => sum + count.right, 0), total = counts.reduce((sum, count) => sum + count.total, 0);
    const cells = counts.map((count, index) => {
      const when = esc(dayLabel(`${statistics.days[index].day}T12:00`));
      return count.total
        ? `<div title="${when}: ${Math.round(count.right / count.total * 100)}% (${count.right} of ${count.total})"><span class="k" style="height:${count.right / count.total * 100}%"></span></div>`
        : `<div title="${when}: nothing answered"><span class="empty"></span></div>`;
    }).join('');
    return `<div class="st-acc-head"><span>${label}</span><strong>${total ? `${Math.round(right / total * 100)}%` : '—'}</strong></div><div class="st-days st-acc">${cells}</div>`;
  };
  const comprehensionDays = statistics.comprehensionDays ?? [];
  const answersBlock = `<div class="st-block">${stHead('Answers, last two weeks', 'Top: how many word cards you answered each day, known in violet and missed in red. Below: the share right each day, out of 100%, for Vocabulary, Listen and Read; the number beside each row covers both weeks. In Listen and Read, an answer right with help counts as right.')}
      <div class="st-days">${days}</div><div class="st-days-axis">${dayAxis}</div>
      <div class="st-legend"><span><i style="background:var(--violet)"></i>knew it</span><span><i style="background:var(--danger)"></i>missed</span></div>
      <p class="vs-label">Share right</p>
      ${accuracyRow('Words', statistics.days.map((day) => ({ right: day.knew, total: day.knew + day.missed })))}
      ${accuracyRow('Listen', comprehensionDays.map((day) => day.listen))}
      ${accuracyRow('Read', comprehensionDays.map((day) => day.read))}
      <div class="st-days-axis">${dayAxis}</div></div>`;
  const level = (mode) => statistics.levels.find((entry) => entry.mode === mode)?.label ?? 'A1';
  const facts = [[level('listen'), 'Listen level'], [level('read'), 'Read level'], [statistics.answered, 'Listen & Read questions answered'], [statistics.grammarTopics, statistics.grammarTopics === 1 ? 'grammar topic practised' : 'grammar topics practised'], [statistics.walkmanHeard, 'words heard on the Walkman'], [counts.scheduled, 'known words waiting for review']];
  const wordsPart = `<div class="st-block">${stHead('Word scores', `Each bar counts the started words with that score. Recalling a word moves it right, missing it moves it left, and scores drift back to the middle over a few weeks. The Walkman plays the left side most. Total is every word’s score added up. ${statistics.history.length > 1 ? 'Choose a day to see the chart as it was at the end of it; the dashed outline is today. ' : ''}Tap a bar to see its words.`)}
      <div id="st-scores">${scoresViewHTML()}</div>
      ${statistics.history.length > 1 ? `<div class="st-when" id="st-when">${scoresWhenHTML()}</div>
      <input type="range" class="st-slider" id="st-slider" min="0" max="${statistics.history.length - 1}" step="1" value="${statsAt}" aria-label="Choose a day">
      <div class="st-ticks" aria-hidden="true">${statistics.history.map((day, index, all) => `<span>${index === all.length - 1 ? 'today' : (all.length - 1 - index) % 2 === 0 ? Number(day.day.slice(8)) : ''}</span>`).join('')}</div>` : ''}
      <div id="st-scores-after">${scoresAfterHTML()}</div></div>
    <div class="st-block"><h2>Your ${total.toLocaleString('en')} words</h2><div class="st-stack">${stack}</div><div class="st-legend">${legend}</div></div>
    <div class="st-block"><h2>Hardest right now</h2>${hard}</div>
    <div class="st-block">${stHead('By category', 'Shaky, steady or solid is the average score of the words you’ve started there.')}<ol class="st-rows">${categories}</ol></div>
    ${answersBlock}`;
  const otherPart = `<div class="st-block"><h2>Everything else</h2><div class="st-facts">${facts.map(([value, label]) => `<div class="st-fact"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('')}</div></div>`;
  const tabs = `<div class="segmented st-tabs" role="group" aria-label="Show">${Object.entries(STATS_TABS).map(([tab, label]) => `<button data-action="stats-tab" data-tab="${tab}" aria-pressed="${statsTab === tab}">${label}</button>`).join('')}</div>`;
  main.innerHTML = `${noticeHTML()}<section class="st">${header}
    ${pointsBlock}
    ${tabs}
    ${statsTab === 'words' ? wordsPart : statsTab === 'verbs' ? verbStatsHTML() : otherPart}
  </section>`;
}
function chooseStatsTab(tab) {
  if (!(tab in STATS_TABS) || tab === statsTab) return;
  statsTab = tab; savePreference('echo.stats-tab', tab);
  stopStatsPlay(); stopVerbPlay(); closeStatsTips();
  render();
}
// ── Songs ────────────────────────────────────────────────────────────────────
// A song is found on LRCLIB (or pasted), read by Claude (Opus) in the background, reviewed here, and its ticked
// words join a deck of their own. Its lyrics stay on this Mac for the song view, which Claude annotates.
let songList = null;        // { songs, audio } from api/songs
let songMatches = null;     // search results, null before a search
let songQuery = '';
let songSearching = false;
let songPasting = false;
let songId = '';
let songView = null;
const songPicks = new Map(); // song id -> Set of ticked fr, all new words ticked to begin with
let songPoll = 0;
const songTime = (seconds) => seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '';
function songStatusLine(song) {
  if (song.status === 'reading') return 'Reading…';
  if (song.status === 'ready') { const known = song.candidates.filter((entry) => entry.existing && !entry.little).length; const fresh = song.candidates.filter((entry) => !entry.existing).length; return `Ready to review · ${fresh} new ${fresh === 1 ? 'word' : 'words'}${known ? ` · ${known} already in Echo` : ''}`; }
  if (song.status === 'added') {
    // New words from every deck share one daily allowance, so "waiting" is how many are still to come in.
    const deck = songList?.decks?.[song.category];
    const count = song.added.length + (song.linked?.length ?? 0);
    return `${song.understood ? `You know ${song.understood.known}%` : 'Added'} · ${count} ${count === 1 ? 'word' : 'words'}${deck ? ` · ${deck.today} today · ${deck.waiting} waiting` : ''}`;
  }
  return 'Could not be read';
}
function renderSongs() {
  const disabled = locked() || !snapshot ? 'disabled' : '';
  const order = snapshot ? `<div class="song-order"><p class="settings-label">New words from songs come</p><div class="segmented" role="group" aria-label="When song words are introduced"><button data-action="songs-first" data-value="true" aria-pressed="${snapshot.settings.songsFirst !== false}" ${disabled}>Before other new words</button><button data-action="songs-first" data-value="false" aria-pressed="${snapshot.settings.songsFirst === false}" ${disabled}>Mixed in</button></div></div>` : '';
  const header = `${wordsTop()}<p class="subtitle">Find a French song; Claude reads it and turns its words into flashcards in their dictionary form. Only the words are kept.</p>${order}`;
  const search = `<form id="song-search-form" class="song-search" role="search"><label class="sr-only" for="song-query">Song title and artist</label><input id="song-query" type="search" placeholder="Title, and the artist if you know it" value="${esc(songQuery)}" autocomplete="off" ${songSearching ? 'disabled' : ''}><button class="primary" type="submit" ${songSearching ? 'disabled' : ''}>${songSearching ? 'Searching…' : 'Search'}</button></form>`;
  const matches = songMatches === null ? '' : songMatches.length
    ? `<p class="song-hint">Pick the one you mean. Covers that sing the same words are grouped together.</p><ol class="song-results">${songMatches.map((match) => `<li><button class="song-row" data-action="song-read" data-lrclib="${match.id}" ${busy ? 'disabled' : ''}><span class="song-copy"><strong>${esc(match.title)}</strong><span>${esc(match.artist)}${match.album && match.album !== match.title ? ` · ${esc(match.album)}` : ''}${match.seconds ? ` · ${songTime(match.seconds)}` : ''}</span>${match.versions > 1 ? `<small>${match.versions} versions${match.artists.length > 1 ? ` · also ${esc(match.artists.filter((name) => name !== match.artist).slice(0, 3).join(', '))}` : ''}</small>` : ''}</span><span class="arrow" aria-hidden="true">→</span></button></li>`).join('')}</ol>`
    : '<p class="song-hint">No song with lyrics matched. Try the artist’s name too, or paste the lyrics.</p>';
  const paste = songPasting
    ? `<form id="song-paste-form" class="song-paste"><label for="song-title">Title</label><input id="song-title" required autocomplete="off"><label for="song-artist">Artist <small>(optional)</small></label><input id="song-artist" autocomplete="off"><label for="song-lyrics">Lyrics</label><textarea id="song-lyrics" rows="8" required></textarea><button class="primary" type="submit" ${busy ? 'disabled' : ''}>Read these lyrics</button></form>`
    : '<button class="quiet song-paste-open" data-action="song-paste">Paste the lyrics instead</button>';
  main.innerHTML = `${noticeHTML()}<section class="topics songs">${header}${search}${matches}${paste}<div id="song-list">${songListHTML()}</div></section>`;
}
// Your songs, redrawn alone while one is being read so typing in the search or paste boxes is never lost.
function songListHTML() {
  const list = (songList?.songs || []).map((song) => `<li><button class="song-row" data-action="song-open" data-song="${esc(song.id)}"><span class="song-copy"><strong>${esc(song.title)}</strong><span>${esc(song.artist || 'Pasted lyrics')}</span><small class="song-state ${song.status}">${esc(songStatusLine(song))}</small>${song.status === 'reading' ? '<span class="song-bar busy"><span></span></span>' : ''}</span><span class="arrow" aria-hidden="true">→</span></button></li>`).join('');
  return list ? `<h2 class="song-list-title">Your songs</h2><ol class="song-results">${list}</ol>` : '';
}
// ── Board (a tab in Words): every word of the chosen category, or for All words up to 100 of the words in Cards right
// now, as tiles in a new random order each visit, kept to the score range in Board options. A tap shows the other side
// for BOARD_TURN_MS and, when Say the French when a card turns (audioMode) is on, says the French; a second tap turns a
// tile back sooner. French is coloured by gender, and a word whose score is below 0 is outlined. It changes no score or
// schedule.
const BOARD_TURN_MS = 2000;
// The score range, over Statistics' bars (STATS_BINS): the ends stand for "or lower" and "or higher", so the full range
// shows every word and a narrower one only words with a score in it (lib/store.ts). Remembered on this device.
const BOARD_LOW = STATS_BINS[0], BOARD_HIGH = STATS_BINS.at(-1);
let boardRange = (() => {
  const [min, max] = readPreference('echo.board-range', '').split(',').map(Number);
  return Number.isInteger(min) && Number.isInteger(max) && BOARD_LOW <= min && min <= max && max <= BOARD_HIGH ? { min, max } : { min: BOARD_LOW, max: BOARD_HIGH };
})();
const boardRangeFull = () => boardRange.min === BOARD_LOW && boardRange.max === BOARD_HIGH;
const boardBoundLabel = (bound) => bound === BOARD_LOW ? `${signed(bound)} or lower` : bound === BOARD_HIGH ? `${bound} or higher` : signed(bound);
const boardRangeLabel = () => boardRangeFull() ? 'All scores' : `Scores ${boardBoundLabel(boardRange.min)} to ${boardBoundLabel(boardRange.max)}`;
// Board shows the words of the chosen category that are in Cards right now (on, the default) or all of its words.
// Remembered on this device.
let boardCards = readPreference('echo.board-cards', 'on') === 'on';
// Board options, a level below Words options: what Board itself shows.
function openBoardOptions() {
  const thumb = (end) => `<span class="range-thumb" data-end="${end}" role="slider" tabindex="0" aria-label="${end === 'min' ? 'Lowest score' : 'Highest score'}" aria-valuemin="${BOARD_LOW}" aria-valuemax="${BOARD_HIGH}"></span>`;
  const ends = [BOARD_LOW, 0, BOARD_HIGH].map((bound) => `<span style="left:calc(${RANGE_INSET}px + (100% - ${2 * RANGE_INSET}px) * ${(bound - BOARD_LOW) / (BOARD_HIGH - BOARD_LOW)})">${signed(bound)}</span>`).join('');
  openDialog('Board options', `<div class="range-pick"><p class="range-value"></p><div class="range-track"><span class="range-fill"></span>${thumb('min')}${thumb('max')}</div><div class="range-ends">${ends}</div></div><div class="dialog-row"><span>Only words in Cards<small class="dialog-note">Off: every word</small></span><button class="secondary" data-action="board-cards" aria-pressed="${boardCards}">${boardCards ? 'On' : 'Off'}</button></div><div class="options-links"><button class="quiet" data-action="options">‹ Words options</button></div><button class="primary dialog-action" data-action="close-dialog">Done</button>`, 'board-options');
  drawBoardRange();
}
function toggleBoardCards() {
  boardCards = !boardCards;
  savePreference('echo.board-cards', boardCards ? 'on' : 'off');
  openBoardOptions();
  if (screen === 'board') loadBoard();
}
// One track, two thumbs that never cross. A press moves the nearer thumb to it; where the thumbs meet, the first move
// decides — left takes the lowest, right the highest — so neither end can get stuck under the other. The range is kept
// when the finger lifts (or a key moves a thumb), not on every step of a drag.
const RANGE_INSET = 14; // half a thumb: a thumb's centre runs from 14px to the width less 14px
let rangeDrag = null;   // { pointerId, end: 'min' | 'max' | null, from, moved }
function rangeBoundAt(track, clientX) {
  const box = track.getBoundingClientRect();
  const share = Math.max(0, Math.min(1, (clientX - box.left - RANGE_INSET) / (box.width - 2 * RANGE_INSET)));
  return Math.round(BOARD_LOW + share * (BOARD_HIGH - BOARD_LOW));
}
function slideBoardRange(end, bound) {
  const before = `${boardRange.min},${boardRange.max}`;
  boardRange = end === 'min' ? { min: Math.min(bound, boardRange.max), max: boardRange.max } : { min: boardRange.min, max: Math.max(bound, boardRange.min) };
  drawBoardRange();
  return before !== `${boardRange.min},${boardRange.max}`;
}
function drawBoardRange() {
  const pick = dialog.querySelector('.range-pick');
  if (!pick) return;
  const at = (bound) => `calc(${RANGE_INSET}px + (100% - ${2 * RANGE_INSET}px) * ${(bound - BOARD_LOW) / (BOARD_HIGH - BOARD_LOW)})`;
  for (const thumb of pick.querySelectorAll('.range-thumb')) {
    const bound = boardRange[thumb.dataset.end];
    thumb.style.left = at(bound);
    thumb.setAttribute('aria-valuenow', bound);
    thumb.setAttribute('aria-valuetext', boardBoundLabel(bound));
  }
  pick.querySelector('.range-fill').style.left = at(boardRange.min);
  pick.querySelector('.range-fill').style.width = `calc((100% - ${2 * RANGE_INSET}px) * ${(boardRange.max - boardRange.min) / (BOARD_HIGH - BOARD_LOW)})`;
  pick.querySelector('.range-value').textContent = boardRangeLabel();
}
function pressBoardRange(event) {
  const track = event.target.closest?.('.range-track');
  if (!track || rangeDrag) return;
  event.preventDefault();
  const bound = rangeBoundAt(track, event.clientX);
  const near = (end) => Math.abs(bound - boardRange[end]);
  const end = boardRange.min === boardRange.max && bound === boardRange.min ? null
    : near('min') < near('max') || (near('min') === near('max') && bound < boardRange.min) ? 'min' : 'max';
  rangeDrag = { pointerId: event.pointerId, end, from: bound, moved: end ? slideBoardRange(end, bound) : false };
  track.setPointerCapture(event.pointerId);
  (end ? track.querySelector(`[data-end="${end}"]`) : track.querySelector('.range-thumb'))?.focus({ preventScroll: true });
}
function dragBoardRange(event) {
  if (!rangeDrag || event.pointerId !== rangeDrag.pointerId) return;
  const bound = rangeBoundAt(event.target.closest('.range-track') ?? dialog.querySelector('.range-track'), event.clientX);
  if (!rangeDrag.end) {
    if (bound === rangeDrag.from) return;
    rangeDrag.end = bound < rangeDrag.from ? 'min' : 'max';
  }
  if (slideBoardRange(rangeDrag.end, bound)) rangeDrag.moved = true;
}
function releaseBoardRange(event) {
  if (!rangeDrag || event.pointerId !== rangeDrag.pointerId) return;
  const moved = rangeDrag.moved;
  rangeDrag = null;
  if (moved) chooseBoardRange();
}
function keyBoardRange(event) {
  const thumb = event.target.closest?.('.range-thumb');
  const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
  if (!thumb || !step) return;
  event.preventDefault();
  const end = thumb.dataset.end;
  if (slideBoardRange(end, Math.max(BOARD_LOW, Math.min(BOARD_HIGH, boardRange[end] + step)))) chooseBoardRange();
}
// The range is kept on this device and the board behind the dialog follows it.
function chooseBoardRange() {
  savePreference('echo.board-range', `${boardRange.min},${boardRange.max}`);
  if (screen === 'board') loadBoard();
}
let board = null;
const boardTurned = new Map();
let boardLoads = 0;
// Fetches the recordings of the first BOARD_WARM tiles, top of the board first, a few at a time so the Mac is not
// flooded; a tap then plays from memory. A newer load stops the older one and frees its clips. The bytes are kept for
// Web Audio (playBoardClip), the object URL for the <audio> fallback.
const BOARD_WARM = 200;
const boardBytes = new Map();
async function warmBoardClips(words, load) {
  // Made here, suspended, so the first tap only has to resume it (that resume needs the tap).
  if (boardWebAudio) boardContext ??= new (window.AudioContext || window.webkitAudioContext)();
  const urls = words.slice(0, BOARD_WARM).map((word) => word.audioUrl).filter(Boolean);
  const worker = async () => {
    while (urls.length && load === boardLoads) {
      const url = urls.shift();
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const bytes = await response.arrayBuffer();
        if (load !== boardLoads) continue;
        boardBytes.set(url, bytes);
        boardClips.set(url, URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })));
      } catch {}
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}
// A Board tap plays through Web Audio: no media element to load, and the start skips most of the 0.25 s of silence
// every word recording opens with, keeping BOARD_KEPT_LEAD_S so a speaker or earphones waking up don't clip the first
// sound. iPhone mutes Web Audio on the silent switch unless the page's audio session is "playback" (navigator.
// audioSession, iOS 17); where that is missing, or the pronunciation is slowed (Web Audio would lower the pitch), the tap
// plays through the <audio> element as before. Decoded clips are kept for the last BOARD_DECODED taps.
const BOARD_LEAD_S = 0.25;
const BOARD_KEPT_LEAD_S = 0.06;
const BOARD_DECODED = 30;
const appleTouch = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const boardWebAudio = !!(window.AudioContext || window.webkitAudioContext) && (!appleTouch || 'audioSession' in navigator);
let boardContext = null;
const boardDecoded = new Map();
async function playBoardClip(url) {
  const bytes = boardBytes.get(url);
  if (!boardWebAudio || !bytes || speed !== 1) { playFrench(url); return; }
  stopAudio();
  const play = ++boardPlays;
  if ('audioSession' in navigator && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
  boardContext ??= new (window.AudioContext || window.webkitAudioContext)();
  const resumed = boardContext.resume(); // inside the tap, as iPhone requires
  try {
    let buffer = boardDecoded.get(url);
    if (!buffer) {
      buffer = await boardContext.decodeAudioData(bytes.slice(0));
      boardDecoded.set(url, buffer);
      if (boardDecoded.size > BOARD_DECODED) boardDecoded.delete(boardDecoded.keys().next().value);
    }
    await resumed;
    if (play !== boardPlays) return;
    const source = boardContext.createBufferSource();
    source.buffer = buffer;
    source.connect(boardContext.destination);
    source.start(0, Math.min(BOARD_LEAD_S - BOARD_KEPT_LEAD_S, buffer.duration));
    boardSource = source;
  } catch { if (play === boardPlays) playFrench(url); }
}
function stopBoardClip() {
  boardPlays++;
  try { boardSource?.stop(); } catch {}
  boardSource = null;
}
async function loadBoard() {
  for (const timer of boardTurned.values()) clearTimeout(timer);
  boardTurned.clear();
  const load = ++boardLoads;
  for (const source of boardClips.values()) URL.revokeObjectURL(source);
  boardClips.clear(); boardBytes.clear(); boardDecoded.clear();
  const cards = boardCards;
  const wanted = `${direction}|${deck}|${boardRange.min}|${boardRange.max}|${cards}`;
  const asked = () => `${direction}|${deck}|${boardRange.min}|${boardRange.max}|${boardCards}`;
  board = null; loading = true; notice = null; retryAction = null; render();
  if (!snapshot) await fetchState();
  try {
    const { words, total } = await api(`api/board?direction=${encodeURIComponent(direction)}&deck=${encodeURIComponent(deck)}&min=${boardRange.min}&max=${boardRange.max}${cards ? '&cards=1' : ''}`);
    const order = shuffled(words);
    if (wanted === asked() && load === boardLoads) {
      board = { deck, words: order, total, full: boardRangeFull(), cards };
      if (audioMode) warmBoardClips(order, load);
    }
  } catch (error) { notice = { message: error.message }; retryAction = { type: 'board' }; }
  loading = false;
  if (screen === 'board') render();
}
function renderBoard() {
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="board-room">${wordsTop()}${body}</section>`; };
  if (loading || !board) { shell(loading ? '<div class="loading-state" role="status">Laying out the words…</div>' : ''); return; }
  const frenchFirst = direction === 'fr-en';
  const title = snapshot?.decks?.find((entry) => entry.id === board.deck)?.title ?? 'All words';
  const face = (word, french, side) => french
    ? `<span class="board-face board-${side}${genderClass(word.gender)}" lang="${languageTag}">${frEsc(word.fr)}${side === 'back' ? '<i class="board-bar"></i>' : ''}</span>`
    : `<span class="board-face board-${side}" lang="en">${esc(word.en)}${side === 'back' ? '<i class="board-bar"></i>' : ''}</span>`;
  const tiles = board.words.map((word) => `<button class="board-tile${word.score < 0 ? ' weak' : ''}${boardTurned.has(word.id) ? ' turned' : ''}" data-action="board-turn" data-id="${esc(word.id)}" aria-label="${esc(frenchFirst ? word.fr : word.en)}">${face(word, frenchFirst, 'front')}${face(word, !frenchFirst, 'back')}</button>`).join('');
  const empty = !board.full ? 'No words with a score in this range.' : board.cards ? (board.deck === 'all' ? 'Nothing in Cards right now.' : 'None of these words are in Cards right now.') : 'No words in this category yet.';
  const body = board.words.length ? `<div class="board-grid">${tiles}</div>` : `<p class="caption">${empty}</p>`;
  const count = !board.cards ? `${board.total} ${board.total === 1 ? 'word' : 'words'}`
    : board.total > board.words.length ? `${board.words.length} of ${board.total} in Cards` : `${board.total} in Cards`;
  shell(`<div class="board-head"><h2>${esc(title)}</h2><span>${count}</span>${board.words.length > 1 ? `<button class="icon board-shuffle" data-action="board-shuffle" aria-label="Shuffle the tiles">${shuffleIcon}</button>` : ''}</div>${body}`);
}
const shuffled = (list) => list.map((item) => [Math.random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);
// Lays the same tiles out in a new order, all face up again.
function shuffleBoard() {
  if (!board) return;
  for (const timer of boardTurned.values()) clearTimeout(timer);
  boardTurned.clear();
  board.words = shuffled(board.words);
  render();
  announce('Shuffled.');
}
function turnBoardTile(button) {
  const id = button.dataset.id;
  const word = board?.words.find((entry) => entry.id === id);
  if (!word) return;
  if (boardTurned.has(id)) { clearTimeout(boardTurned.get(id)); boardTurned.delete(id); button.classList.remove('turned'); return; }
  button.classList.add('turned');
  boardTurned.set(id, setTimeout(() => {
    boardTurned.delete(id);
    main.querySelector(`.board-tile[data-id="${CSS.escape(id)}"]`)?.classList.remove('turned');
  }, BOARD_TURN_MS));
  if (word.audioUrl && audioMode) playBoardClip(word.audioUrl);
}
// How much of the song's words you know, and how much you are learning, as one bar.
function understoodHTML(understood) {
  if (!understood) return '';
  return `<div class="song-known"><p><strong>You know ${understood.known}%</strong> of the words in this song${understood.learning ? ` · ${understood.learning}% still learning` : ''}</p><span class="song-known-bar"><span class="k" style="width:${understood.known}%"></span><span class="l" style="width:${understood.learning}%"></span></span><p class="caption">Every word as it is sung, little words and names left out. A word counts once you know it in your practice.</p></div>`;
}
// The song's words page, under its lyrics: choosing the words to add, then their deck and recordings.
function renderSong() {
  const song = songView;
  const header = `<div class="section-top">${song && song.notes === 'none' ? back('Songs', 'songs') : back('Lyrics', 'song-lyrics')}</div>`;
  if (!song) { main.innerHTML = `${noticeHTML()}<section class="topics songs">${header}${loading ? '<div class="loading-state" role="status">Opening the song…</div>' : ''}</section>`; return; }
  const title = `<h1>${esc(song.title)}</h1><p class="subtitle">${esc(song.artist || 'Pasted lyrics')}</p>`;
  let body = '';
  if (song.status === 'reading') {
    body = `<div class="song-progress" role="status"><p>Reading the song…</p><span class="song-bar busy"><span></span></span><p class="caption">Claude reads the whole song and gives every word its dictionary form, gender and meaning here. It usually takes under a minute; you can leave and come back.</p></div>`;
  } else if (song.status === 'failed') {
    body = `<div class="song-progress"><p class="song-error">${esc(song.error || 'This song could not be read.')}</p><div class="summary-actions"><button class="primary" data-action="song-retry" data-song="${esc(song.id)}" ${busy ? 'disabled' : ''}>Try again</button><button class="secondary" data-action="song-remove" data-song="${esc(song.id)}" ${busy ? 'disabled' : ''}>Remove</button></div></div>`;
  } else if (song.status === 'ready') {
    // Every word of the song is ticked but the little ones: new words, and the ones already in Echo, which join the
    // song's deck as they are.
    const picks = songPicks.get(song.id) ?? new Set(song.candidates.filter((entry) => !entry.little).map((entry) => entry.fr));
    songPicks.set(song.id, picks);
    const fresh = song.candidates.filter((entry) => !entry.existing && !entry.little);
    const little = song.candidates.filter((entry) => entry.little);
    const known = song.candidates.filter((entry) => entry.existing && !entry.little);
    const row = (entry) => `<li><button class="song-pick" role="checkbox" aria-checked="${picks.has(entry.fr)}" data-action="song-pick" data-fr="${esc(entry.fr)}"><span class="tick" aria-hidden="true"></span><span class="song-word"><strong lang="${languageTag}" class="${genderClass(entry.gender).trim()}">${frEsc(entry.fr)}</strong><span>${esc(entry.en)}</span>${entry.note ? `<small>${esc(entry.note)}</small>` : ''}</span><span class="song-forms" lang="${languageTag}">${entry.forms.map(esc).join(', ')}</span></button></li>`;
    body = `<p class="song-hint">Untick any word you don’t want. On the right: how it appears in the song.</p>
      <div class="song-tools"><button class="quiet" data-action="song-pick-all">Tick all</button><button class="quiet" data-action="song-pick-none">Untick all</button></div>
      <ol class="song-picks">${fresh.map(row).join('')}</ol>
      ${known.length ? `<h2 class="song-list-title">Already in your words · ${known.length}</h2><p class="song-hint">They join this song’s deck too, keeping their place in their own category and your progress on them.</p><ol class="song-picks">${known.map(row).join('')}</ol>` : ''}
      ${little.length ? `<h2 class="song-list-title">Little words · ${little.length}</h2><p class="song-hint">Articles, pronouns and the like. Tick any you want as flashcards.</p><ol class="song-picks">${little.map(row).join('')}</ol>` : ''}
      ${song.skipped.length ? `<details class="song-more"><summary>Left out · ${song.skipped.length}</summary><ol class="song-plain">${song.skipped.map((skip) => `<li><strong lang="${languageTag}">${esc(skip.form)}</strong> <span>${esc(skip.reason)}</span></li>`).join('')}</ol></details>` : ''}
      <div class="song-add"><button class="primary" data-action="song-add" data-song="${esc(song.id)}" ${busy || !picks.size ? 'disabled' : ''}>Add ${picks.size} ${picks.size === 1 ? 'word' : 'words'}</button></div>`;
  } else {
    const audio = songList?.audio;
    const recording = audio && (audio.pending || audio.recording) ? `Recording the new words on your Mac… ${audio.pending} left. Each one joins your practice as soon as it is recorded.` : audio?.failed?.some((id) => song.added.includes(id)) ? `${audio.failed.filter((id) => song.added.includes(id)).length} could not be recorded and stay out of practice.` : 'Every word is recorded.';
    const linked = song.linked?.length ?? 0;
    body = `<div class="song-progress"><p><strong>${song.added.length}</strong> new ${song.added.length === 1 ? 'word' : 'words'}${linked ? ` and <strong>${linked}</strong> you already had` : ''} in the “${esc(song.title)}” deck.</p><p class="caption">${esc(recording)} New words from songs come ${snapshot?.settings?.songsFirst === false ? 'in turn with your other categories' : 'before your other new words'}; change this on the Songs tab.</p><div class="summary-actions"><button class="primary" data-action="song-practise" data-category="${esc(song.category)}" ${busy ? 'disabled' : ''}>Practise these words</button></div></div>`;
  }
  main.innerHTML = `${noticeHTML()}<section class="topics songs">${header}${title}${understoodHTML(song.understood)}${body}</section>`;
}
// A song opens on its lyrics; one whose lyrics are not on this Mac opens on its words page.
function openSong(id) {
  songId = id; songView = songList?.songs.find((song) => song.id === id) ?? null;
  if (songView?.notes === 'none') openSongPage(); else openLyrics();
}
function openSongPage() { if (move(`song|${songId}`, true)) loadSong(); }
async function loadSongs(refresh = false) {
  try { songList = await api('api/songs'); }
  catch (error) { if (!refresh) { notice = { message: error.message }; retryAction = { type: 'songs' }; } }
  const holder = document.querySelector('#song-list');
  if (screen === 'songs') { if (refresh && holder) holder.innerHTML = songListHTML(); else render(); }
  watchSongs();
}
async function loadSong() {
  if (!songView) { loading = true; render(); }
  try { const [song, list] = await Promise.all([api(`api/songs/${encodeURIComponent(songId)}`), api('api/songs')]); songView = song; songList = list; }
  catch (error) { notice = { message: error.message }; retryAction = { type: 'song' }; }
  loading = false;
  if (screen === 'song') render();
  watchSongs();
}
// ── The song view ────────────────────────────────────────────────────────────
// The lyrics line by line: the button at a line's start shows what the line means, and a tapped word shows its
// meaning, dictionary form and grammar note. Until Claude has written the notes, the lines show plain.
let songLyrics = null;          // api/songs/<id>/lyrics
const openLines = new Set();    // "stanza.line" keys whose meaning is showing
let glossLine = '';             // the line a tapped word belongs to
let lyricsPoll = 0;
function openLyrics() { if (move(`lyrics|${songId}`, true)) loadLyrics(); }
async function loadLyrics() {
  const id = songId;
  if (songLyrics?.id !== id) { songLyrics = null; openLines.clear(); loading = true; render(); }
  // The song itself too: its row under the title says where its words stand.
  try { const [view, song, list] = await Promise.all([api(`api/songs/${encodeURIComponent(id)}/lyrics`), api(`api/songs/${encodeURIComponent(id)}`), api('api/songs')]); if (songId === id) { songLyrics = view; songView = song; songList = list; } }
  catch (error) { notice = { message: error.message }; }
  loading = false;
  if (screen === 'lyrics') render();
  clearTimeout(lyricsPoll);
  const waiting = songLyrics?.notes === 'writing' || songLyrics?.notes === 'waiting' || songView?.status === 'reading';
  if (screen === 'lyrics' && waiting) lyricsPoll = setTimeout(() => { if (screen === 'lyrics' && songId === id) loadLyrics(); }, songView?.status === 'reading' ? 4000 : 8000);
}
// The way from the lyrics to the song's words page, saying where its words stand.
function songPageRowHTML(song) {
  if (!song) return '';
  const [title, detail] = song.status === 'reading' ? ['Reading the words…', 'Claude gives every word its dictionary form; usually under a minute']
    : song.status === 'ready' ? ['Choose the words to add', songStatusLine(song)]
    : song.status === 'added' ? ['Words and deck', songStatusLine(song)]
    : ['The words could not be read', 'Try again, or remove the song'];
  return `<button class="song-row song-page-row" data-action="song-page"><span class="song-copy"><strong>${esc(title)}</strong><small class="song-state ${song.status}">${esc(detail)}</small>${song.status === 'reading' ? '<span class="song-bar busy"><span></span></span>' : ''}</span><span class="arrow" aria-hidden="true">→</span></button>`;
}
function renderLyrics() {
  const view = songLyrics;
  const header = `<div class="section-top">${back('Songs', 'songs')}</div>`;
  if (!view) { main.innerHTML = `${noticeHTML()}<section class="topics songs">${header}${loading ? '<div class="loading-state" role="status">Opening the lyrics…</div>' : ''}</section>`; return; }
  const status = view.notes === 'ready' ? '<p class="song-hint">Tap › at the start of a line for what it means, or tap a word for its note.</p>'
    : view.notes === 'writing' ? `<div class="song-progress" role="status"><p>Writing the notes… ${view.done} of ${view.total} lines</p><span class="song-bar"><span style="width:${view.total ? view.done / view.total * 100 : 0}%"></span></span><p class="caption">Claude translates every line and explains its words. The lyrics are here meanwhile; the notes appear when they are all written.</p></div>`
    : view.notes === 'waiting' ? '<p class="song-hint" role="status">The notes are waiting their turn behind another song.</p>'
    : view.notes === 'failed' ? `<div class="song-progress"><p class="song-error">${esc(view.error || 'The notes could not be written.')}</p><div class="summary-actions"><button class="primary" data-action="song-notes" ${busy ? 'disabled' : ''}>Try again</button></div></div>`
    : '<p class="song-hint">The lyrics of this song are not on this Mac. Paste the song again to read it here.</p>';
  const lines = view.stanzas.map((stanza, s) => `<div class="lyric-stanza">${stanza.map((line, l) => {
    const key = `${s}.${l}`;
    const open = openLines.has(key);
    const start = line.en ? `<button class="lyric-start" data-action="lyric-line" data-line="${key}" aria-expanded="${open}" aria-label="What this line means">›</button>` : '<span class="lyric-start" aria-hidden="true"></span>';
    return `<div class="lyric-line" data-line="${key}">${start}<div class="lyric-text"><p lang="${languageTag}">${glossedHTML(line.fr, line.words)}</p>${open ? `<p class="lyric-en">${esc(line.en)}</p>` : ''}</div></div>`;
  }).join('')}</div>`).join('');
  main.innerHTML = `${noticeHTML()}<section class="topics songs lyrics">${header}<h1>${esc(view.title)}</h1><p class="subtitle">${esc(view.artist || 'Pasted lyrics')}</p>${songPageRowHTML(songView?.id === view.id ? songView : null)}${status}<div class="lyric-lines">${lines}</div></section>`;
}
async function rewriteSongNotes() {
  if (busy) return;
  busy = true; render();
  try { songLyrics = await api(`api/songs/${encodeURIComponent(songId)}/notes`, { method: 'POST', body: '{}' }); }
  catch (error) { notice = { message: error.message }; }
  busy = false;
  loadLyrics();
}
// While a song is being read or recorded, its screen refreshes every few seconds; nothing polls otherwise.
function watchSongs() {
  clearTimeout(songPoll);
  const busySong = (songList?.songs || []).some((song) => song.status === 'reading') || songList?.audio?.pending > 0;
  if (!busySong || (screen !== 'songs' && screen !== 'song')) return;
  songPoll = setTimeout(() => { if (screen === 'song') loadSong(); else if (screen === 'songs') loadSongs(true); }, 4000);
}
async function searchSongs(query) {
  songQuery = query.trim();
  if (songQuery.length < 2) return;
  songSearching = true; notice = null; render();
  try { songMatches = (await api(`api/songs/search?q=${encodeURIComponent(songQuery)}`)).matches; }
  catch (error) { notice = { message: error.message }; songMatches = null; }
  songSearching = false;
  if (screen === 'songs') { render(); document.querySelector('.song-results button')?.focus({ preventScroll: true }); }
}
async function readSong(body) {
  if (busy) return;
  busy = true; notice = null; render();
  try {
    const song = await api('api/songs', { method: 'POST', body: JSON.stringify(body) });
    busy = false; songMatches = null; songQuery = ''; songPasting = false;
    songList = { ...(songList || { audio: null }), songs: [song, ...(songList?.songs || [])] };
    openSong(song.id);
  } catch (error) { busy = false; notice = { message: error.message }; render(); }
}
async function songAction(path, options, afterwards) {
  if (busy) return;
  busy = true; notice = null; render();
  try { const result = await api(path, options); busy = false; afterwards(result); }
  catch (error) { busy = false; notice = { message: error.message }; render(); }
}
function pickSongWord(fr) {
  const picks = songPicks.get(songId);
  if (!picks) return;
  if (picks.has(fr)) picks.delete(fr); else picks.add(fr);
  render();
}
function pickAllSongWords(all) {
  if (!songView) return;
  // Tick all and Untick all work on the song's words, new and already known; the little words keep their own ticks.
  const picks = songPicks.get(songId) ?? new Set();
  for (const entry of songView.candidates.filter((candidate) => !candidate.little)) if (all) picks.add(entry.fr); else picks.delete(entry.fr);
  songPicks.set(songId, picks);
  render();
}
async function setSongsFirst(value) {
  try { snapshot.settings = await api('api/settings/songs', { method: 'PUT', body: JSON.stringify({ songsFirst: value }) }); render(); }
  catch (error) { notice = { message: error.message }; render(); }
}
function openStatistics() { if (move('statistics', true)) loadStatistics(); }
// Statistics opens at once on the last figures (from this visit, or saved on this phone earlier in the study day) and
// redraws when the fresh ones arrive, keeping the day and bar chosen; only a first open of the day waits.
const STATS_SAVED = localKey('echo.statistics');
const clientStudyDay = () => { const day = new Date(); if (day.getHours() < 4) day.setDate(day.getDate() - 1); return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`; };
function savedStatistics() {
  try { const saved = JSON.parse(localStorage.getItem(STATS_SAVED) || 'null'); return saved?.history?.at(-1)?.day === clientStudyDay() ? saved : null; } catch { return null; }
}
function saveStatistics() { try { localStorage.setItem(STATS_SAVED, JSON.stringify(statistics)); } catch { /* a full store only costs the next open its wait */ } }
async function loadStatistics() {
  const shown = statistics?.history?.at(-1)?.day === clientStudyDay() ? statistics : savedStatistics();
  if (shown) { if (shown !== statistics) { statistics = shown; resetStatsView(); } notice = null; retryAction = null; render(); refreshStatistics(); return; }
  loading = true; notice = null; retryAction = null; render();
  try {
    statistics = await api('api/statistics');
    saveStatistics();
    resetStatsView();
  } catch (error) {
    notice = { message: error.message }; retryAction = { type: 'statistics' };
  }
  loading = false;
  if (screen === 'statistics') render();
}
// Fresh figures behind the ones shown. A choice made meanwhile stays where it still exists; today stays today.
let statsRefreshing = false;
async function refreshStatistics() {
  if (statsRefreshing) return;
  statsRefreshing = true;
  try {
    const fresh = await api('api/statistics');
    const wasToday = statsAt >= statistics.history.length - 1;
    statistics = fresh; saveStatistics();
    statsAt = wasToday ? fresh.history.length - 1 : Math.min(statsAt, fresh.history.length - 1);
    statsDayWords.clear(); vScoreDayForms.clear();
    if (!fresh.days.some((day) => day.day === pointsDay)) pointsDay = '';
    if (screen === 'statistics' && !statsPlay && !vScorePlay) render();
  } catch (error) {
    if (screen === 'statistics') { notice = { message: `These are your figures from earlier today: ${error.message}` }; render(); }
  } finally { statsRefreshing = false; }
}
function resetStatsView() {
  stopStatsPlay(); statsAt = statistics.history.length - 1; statsDayWords.clear();
  stopVerbPlay(); vScoreAt = -1; vScoreBin = null; vScoreOpen = true; vScoreDayForms.clear();
  // The weakest bar is chosen to begin with, its list closed; tapping a bar opens its list.
  statsBin = statistics.words.length ? statsBinOf(statistics.words[0].score) : null;
  statsOpen = false;
  pointsDay = '';
}
function chooseStatsBin(bin) { if (statsBin === bin) statsOpen = !statsOpen; else { statsBin = bin; statsOpen = true; } drawScores(); }
// ── Speak (a way of practising a Words card in Cards and Endless, French → English): the learner says each card's
// English aloud and Echo checks it (api/say/check, lib/say-check.ts). The verdict turns the card, and after
// SAY_SHOW_MS (and the English, after a miss) grades it as a tap on that half would: a Cards grade or an Endless mark.
// A level meter tells speech from the room's quiet, so an answer ends SAY_QUIET_MS after the learner stops. A wrong
// verdict waits until SAY_RESUME_MS have passed since their last sound: if they speak again before then they had only
// paused, and Echo listens on and checks the whole answer again. The learner has SAY_WAIT_MS to start an answer, and
// can give up sooner by saying so ("I don't know") or tapping Don't know; what Echo can't make out, or thinking aloud,
// is shown and listened past. Tapping the card turns it as usual, to answer that one by hand. After a wrong verdict,
// "I said it right" teaches Echo what it heard (api/say/correct) and re-marks that answer as right. iPhone stops the
// microphone when the screen locks or Echo leaves the screen, so the screen is kept awake while Say listens, and Say
// pauses if it goes away; it needs a tap to start again.
const SAY_QUIET_MS = 700;
const SAY_RESUME_MS = 1600;
const SAY_LONGEST_MS = 8000;
const SAY_WAIT_MS = 40000;
const SAY_SHOW_MS = 900;
// A moment of silence played on Start, inside the tap, so Safari lets the words that follow play without one.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
const sayAudio = new Audio();
// Say listens on this card: the way is Speak (French → English, on the Words cards, in the Echo that has it).
const sayHere = () => wayNow() === 'speak';
// A card as Say follows it: a grade or an undo brings a new version, an Endless word a new serial.
const cardKey = (card) => card ? `${card.id}:${card.version}:${card.serial ?? ''}` : '';
// phase: idle · starting · prompt (the French plays) · listening · checking · again (heard, not an answer) · result · skipped
// key: the card Say is answering; result: its verdict { verdict, heard, en, request }
// fix: the last wrong verdict, while it can still be marked right: { wordId, fr, request, heard, endless, state: offer|sending|done }
let say = { running: false, phase: 'idle', key: '', result: null, fix: null, error: '', token: 0 };
// The microphone stays open from Start to Stop. While it is, iPhone plays sound at phone-call quality; opening it
// only to listen sounded worse on the phone than keeping it open.
let sayContext = null;      // the AudioContext for the level, the capture and the chimes, while Say listens
let sayMic = null;          // { stream, source, processor, analyser, data } while Say listens
let sayCapture = null;      // the raw sound of the answer being listened to: Float32Array blocks
let sayWake = null;         // the screen wake lock
let sayInterrupt = null;    // ends whatever the run is waiting on (a sound or the microphone) when it stops
let sayGiveUp = null;       // ends the listening as Don't know
let saySkip = null;         // ends the listening for this card without an answer (it was turned by hand, or changed)
// Opens the microphone into sayContext; false when Say stopped while it opened.
async function sayOpenMic(token) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  if (!sayCurrent(token) || !sayContext) { stream.getTracks().forEach((track) => track.stop()); return false; }
  const context = sayContext;
  await context.resume().catch(() => {});
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  // The raw sound, kept from the moment Echo starts listening, so the first sound of an answer is never lost to
  // a recorder still starting. The processor's own output is silence; it is connected only so that it runs.
  const processor = context.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => { sayCapture?.push(new Float32Array(event.inputBuffer.getChannelData(0))); };
  source.connect(processor); processor.connect(context.destination);
  sayMic = { stream, source, processor, analyser, data: new Float32Array(analyser.fftSize) };
  return true;
}
function sayCloseMic() {
  if (!sayMic) return;
  sayMic.stream.getTracks().forEach((track) => track.stop());
  sayMic.processor.onaudioprocess = null;
  sayMic.source.disconnect(); sayMic.processor.disconnect();
  sayMic = null;
}
async function startSay() {
  if (say.running) return;
  // Board may have set the audio session to playback-only; the microphone needs it back to the browser's choice.
  if ('audioSession' in navigator && navigator.audioSession.type === 'playback') navigator.audioSession.type = 'auto';
  sayAudio.src = SILENT_WAV; sayAudio.play().catch(() => {});
  sayContext ??= new (window.AudioContext || window.webkitAudioContext)();
  sayContext.resume().catch(() => {});
  say = { ...say, running: true, phase: 'starting', error: '', result: null, token: say.token + 1 };
  const token = say.token;
  render();
  try {
    if (!await sayOpenMic(token)) return;
  } catch (error) {
    sayContext?.close().catch(() => {}); sayContext = null;
    say = { ...say, running: false, phase: 'idle', error: error.name === 'NotAllowedError'
      ? 'Echo needs the microphone for Speak. Allow it for this site (in Safari: aA → Website Settings → Microphone), then tap the card.'
      : `The microphone could not start: ${error.message}` };
    render();
    return;
  }
  try { sayWake = await navigator.wakeLock?.request('screen') ?? null; } catch { sayWake = null; }
  if (sayCurrent(token)) runSay(token);
}
// Stops the run and lets go of the microphone; `message` says why, when it was not the learner's choice.
function stopSay(message = '') {
  if (!say.running && !sayContext) return;
  say = { ...say, running: false, phase: 'idle', error: message, token: say.token + 1 };
  sayInterrupt?.();
  sayAudio.pause();
  sayWake?.release().catch(() => {}); sayWake = null;
  sayCloseMic();
  sayContext?.close().catch(() => {}); sayContext = null;
  if (screen === 'practice') render();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && say.running) stopSay('Speak paused when the screen locked or Echo went to the background. Tap the card to go on.'); });
const sayCurrent = (token) => say.running && token === say.token;
function sayWait(ms, token) {
  return new Promise((resolve) => { const timer = setTimeout(() => { sayInterrupt = null; resolve(sayCurrent(token)); }, ms); sayInterrupt = () => { clearTimeout(timer); sayInterrupt = null; resolve(false); }; });
}
// Plays one recording to its end; false when it could not play or the run stopped meanwhile. The browser can pause
// a clip on its own (iPhone does as the microphone opens or closes, Chrome as a new capture starts): it is played on
// once, then left; and a clip that never ends gives up after SAY_CLIP_MS, so Speak never waits on it for good.
const SAY_CLIP_MS = 10000;
function sayPlay(url, token) {
  return new Promise((resolve) => {
    let resumed = false;
    const limit = setTimeout(() => done(false), SAY_CLIP_MS);
    const done = (played) => { clearTimeout(limit); sayAudio.onended = sayAudio.onerror = sayAudio.onpause = null; sayInterrupt = null; resolve(played && sayCurrent(token)); };
    sayAudio.onended = () => done(true); sayAudio.onerror = () => done(false);
    sayAudio.onpause = () => { if (sayAudio.ended) return; if (resumed) { done(false); return; } resumed = true; sayAudio.play().catch(() => done(false)); };
    sayInterrupt = () => { sayAudio.onpause = null; sayAudio.pause(); done(false); };
    sayAudio.src = url; sayAudio.play().catch(() => done(false));
  });
}
// Two short tones: rising for right, falling otherwise.
function sayChime(right, token) {
  const context = sayContext;
  if (context) {
    // Closing the microphone can leave iPhone's audio paused for a moment.
    context.resume().catch(() => {});
    (right ? [660, 880] : [330, 247]).forEach((frequency, index) => {
      const at = context.currentTime + index * 0.13, tone = context.createOscillator(), level = context.createGain();
      tone.frequency.value = frequency;
      level.gain.setValueAtTime(0.0001, at); level.gain.exponentialRampToValueAtTime(0.25, at + 0.02); level.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
      tone.connect(level).connect(context.destination); tone.start(at); tone.stop(at + 0.3);
    });
  }
  return sayWait(450, token);
}
// 16-bit mono WAV of `samples` at `rate`.
function sayWav(samples, rate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at, value) => { for (let index = 0; index < value.length; index++) view.setUint8(at + index, value.charCodeAt(index)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return new Blob([view], { type: 'audio/wav' });
}
// The microphone's level now, in dB.
function sayLevel() {
  const { analyser, data } = sayMic;
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (const sample of data) sum += sample * sample;
  return 10 * Math.log10(sum / data.length + 1e-12);
}
// Loud enough to be the learner's voice rather than the room.
const sayLoud = (level, floor) => level > Math.max(floor + 15, -55);
// The listening ring breathes slowly on its own (one breath every 4 s), so it shows Echo is listening while the
// learner thinks, and swells and glows with their voice (`level`, 0–1) on top of that.
function sayRing(level, now) {
  const ring = main.querySelector('.say-ring');
  if (!ring) return;
  const rest = 0.5 + 0.5 * Math.sin(now / 1000 * Math.PI / 2);
  ring.style.transform = `scale(${(1 + rest * 0.08 + level * 0.45).toFixed(3)})`;
  ring.style.opacity = (0.3 + rest * 0.2 + level * 0.5).toFixed(3);
  ring.style.boxShadow = `0 0 ${Math.round(level * 22)}px ${Math.round(level * 4)}px color-mix(in srgb,var(--violet) 33%,transparent)`;
}
// Listens for one answer: { clip, answer } once the learner stops, the clip as WAV from a third of a second before
// they began; 'dontknow' when they tap Don't know, 'silent' when nothing was said by `deadline`, 'skip' when the card
// was turned by hand or another card came, null if Say stopped meanwhile. `answer` is what was heard so far; passed
// back in, listening goes on with it after a pause, and its sound goes on being kept until the next listen or
// sayAnswer lets it go.
function sayListen(token, deadline, answer = null) {
  return new Promise((resolve) => {
    const rate = sayContext.sampleRate;
    const heard = answer ?? { blocks: [], began: performance.now(), floor: null, spokeAt: 0, lastLoud: 0, dropped: 0 };
    sayCapture = heard.blocks;
    let loudTicks = 0, over = false, shown = 0;
    const finish = (outcome) => {
      if (over) return;
      over = true; clearInterval(timer); sayInterrupt = null; sayGiveUp = null; saySkip = null;
      if (outcome !== 'speech') { sayCapture = null; resolve(outcome); return; }
      const all = new Float32Array(heard.blocks.reduce((sum, block) => sum + block.length, 0));
      let at = 0;
      for (const block of heard.blocks) { all.set(block, at); at += block.length; }
      const from = Math.max(0, Math.floor((heard.spokeAt - heard.began - 330) / 1000 * rate) - heard.dropped);
      resolve({ clip: sayWav(all.subarray(from), rate), answer: heard });
    };
    sayInterrupt = () => finish(null);
    sayGiveUp = () => finish('dontknow');
    saySkip = () => finish('skip');
    // Every 50 ms: the level in dB against the room's quiet, which is learned while nobody speaks.
    const timer = setInterval(() => {
      if (!sayCurrent(token)) return finish(null);
      if (revealed || cardKey(shownCard()) !== say.key) return finish('skip');
      const level = sayLevel(), now = performance.now();
      // A microphone can give pure zeros (just opened, or noise suppression in a silent room). The room's quiet
      // starts no louder than -50 dB, in case the first real sound is already the learner's voice, and is learned
      // from there.
      if (heard.floor === null) {
        sayRing(0, now);
        if (level < -100) { if (now > deadline) finish('silent'); return; }
        heard.floor = Math.min(level, -50);
      }
      const loud = sayLoud(level, heard.floor);
      if (loud) { loudTicks += 1; heard.lastLoud = now; if (!heard.spokeAt && loudTicks >= 3) heard.spokeAt = now - 150; }
      else { loudTicks = 0; if (!heard.spokeAt) heard.floor += (level - heard.floor) * (level < heard.floor ? 0.3 : 0.05); }
      // The ring follows the voice, not the room: it starts 8 dB over the room's quiet, swells at once and settles
      // slowly.
      const target = Math.max(0, Math.min(1, (level - heard.floor - 8) / 22));
      shown += (target - shown) * (target > shown ? 0.6 : 0.15);
      sayRing(shown, now);
      if (heard.spokeAt && (now - heard.lastLoud > SAY_QUIET_MS || now - heard.spokeAt > SAY_LONGEST_MS)) finish('speech');
      else if (!heard.spokeAt && now > deadline) finish('silent');
      // Only about a second from before the learner speaks is kept, however long they think.
      while (!heard.spokeAt && heard.blocks.length > 1 && (heard.blocks.length - 1) * heard.blocks[0].length > rate) heard.dropped += heard.blocks.shift().length;
    }, 50);
  });
}
// After the pause that ended an answer: `resumed` turns true if the learner speaks again within SAY_RESUME_MS of
// their last sound (they had not finished), and false once that passes, Say stops, or `stop` is called.
function sayResumes(token, answer) {
  let stop;
  const resumed = new Promise((resolve) => {
    let loudTicks = 0;
    const end = (value) => { clearInterval(timer); resolve(value); };
    stop = () => end(false);
    const timer = setInterval(() => {
      if (!sayCurrent(token) || !sayMic) return end(false);
      const now = performance.now();
      if (sayLoud(sayLevel(), answer.floor)) {
        loudTicks += 1;
        if (loudTicks >= 2) { answer.lastLoud = now; return end(true); }
      } else loudTicks = 0;
      if (now - answer.lastLoud > SAY_RESUME_MS) end(false);
    }, 50);
  });
  return { resumed, stop };
}
async function sayCheck(card, clip, request) {
  let response;
  try { response = await fetch(`api/say/check?word=${encodeURIComponent(card.id)}&request=${request}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', Accept: 'application/json' }, body: clip, cache: 'no-store' }); }
  catch { throw Object.assign(new Error('Echo couldn’t reach your Mac to check that answer. Check your connection, then tap the card to go on.'), { network: true }); }
  let data;
  try { data = await response.json(); } catch { throw new Error('Your Mac returned an unreadable response.'); }
  if (!response.ok) throw new Error(data.error || `Checking failed (${response.status}).`);
  return data;
}
// A request Say makes, tried again after 1 and 2 seconds when the phone loses the Mac for a moment (Safari's
// "Load failed"). Sending a check again is safe: a check records nothing. Null if Say stopped meanwhile.
async function sayTry(token, request) {
  for (const pause of [1000, 2000, 0]) {
    try { return await request(); }
    catch (error) { if (!error.network || !pause) throw error; if (!await sayWait(pause, token)) return null; }
  }
}
// Listens until there is an answer to judge; what is heard but is not one ("let me think") is shown, and Echo listens
// on, until the word's SAY_WAIT_MS are up. Null when Say stopped; { verdict: 'skip' } when the card was turned by
// hand or another card came. An answer checked again after a pause keeps its request.
async function sayAnswer(card, token) {
  const deadline = performance.now() + SAY_WAIT_MS;
  say.phase = 'listening'; render();
  let answer = null, request = null;
  for (;;) {
    const heard = await sayListen(token, deadline, answer);
    if (!heard || !sayCurrent(token)) { sayCapture = null; return null; }
    if (heard === 'skip') return { verdict: 'skip' };
    if (!answer) request = requestId();
    if (heard === 'dontknow' || heard === 'silent') return { verdict: heard, heard: '', en: card.en, request };
    say.phase = 'checking'; render();
    const more = sayResumes(token, heard.answer);
    let result;
    try { result = await sayTry(token, () => sayCheck(card, heard.clip, request)); }
    catch (error) { more.stop(); sayCapture = null; if (sayCurrent(token)) stopSay(error.message); return null; }
    if (!result) { more.stop(); sayCapture = null; return null; }
    if (revealed || cardKey(shownCard()) !== say.key) { more.stop(); sayCapture = null; return { verdict: 'skip' }; }
    // Wrong, and they speak again: they had only paused. Listen on and check the whole answer.
    if (result.verdict === 'wrong' && await more.resumed && sayCurrent(token)) {
      answer = heard.answer;
      say.phase = 'listening'; render();
      continue;
    }
    more.stop(); sayCapture = null;
    if (!sayCurrent(token)) return null;
    if (result.verdict !== 'unclear') return { ...result, request };
    answer = null;
    // Breath or noise heard as nothing changes nothing on screen; words that were not an answer are shown.
    say.phase = result.heard.trim() ? 'again' : 'listening'; say.result = result; render();
  }
}
// Card after card until stopped: the French (played when Audio or Listen is on), the answer, the card turned with
// the verdict, the English after anything but a right answer, then the grade a tap would give. A card turned or
// answered by hand meanwhile is left to the learner, and Say takes up the next one.
async function runSay(token) {
  while (sayCurrent(token)) {
    if (!sayHere()) { stopSay(); return; }
    const card = shownCard();
    if (!card || revealed || locked() || loading) { if (!await sayWait(150, token)) return; continue; }
    const key = cardKey(card);
    say.key = key; say.result = null; say.phase = 'prompt'; render();
    if (!await sayPlay(card.audioUrl, token) && !sayCurrent(token)) return;
    if (revealed || cardKey(shownCard()) !== key) continue;
    const result = await sayAnswer(card, token);
    if (!result) return;
    if (result.verdict === 'skip') { say.phase = 'skipped'; continue; }
    revealed = true; say.phase = 'result'; say.result = result;
    if (result.verdict !== 'right' && result.heard) say.fix = { wordId: card.id, fr: card.fr, request: result.request, heard: result.heard, endless: endlessMode(), state: 'offer' };
    render(); announce(`${result.verdict === 'right' ? 'Right' : 'Not quite'}: ${card.en}.`);
    if (!await sayChime(result.verdict === 'right', token)) return;
    if (result.verdict !== 'right' && !await sayPlay(`audio/en/${encodeURIComponent(card.id)}.mp3`, token) && !sayCurrent(token)) return;
    if (!await sayWait(SAY_SHOW_MS, token)) return;
    if (!revealed || cardKey(shownCard()) !== key) continue;
    grade(result.verdict === 'right');
  }
}
// Echo heard the learner wrong: what it heard counts for that word from then on, and the answer, still the last one
// given, is marked again as right: the Cards grade taken back and given as known, or the Endless mark replaced.
async function sayCorrect() {
  const fix = say.fix;
  if (!fix || fix.state !== 'offer' || busy) return;
  fix.state = 'sending'; render();
  try {
    await api('api/say/correct', { method: 'POST', body: JSON.stringify({ word: fix.wordId, request: fix.request, heard: fix.heard }) });
    if (fix.endless) await sayRemarkEndless(fix.wordId);
    else await sayRegrade(fix.wordId);
    fix.state = 'done';
  } catch (error) { fix.state = 'offer'; notice = { message: error.message }; }
  if (screen === 'practice') render();
}
async function sayRemarkEndless(wordId) {
  const stream = endless, last = stream?.last;
  if (!last || last.card.id !== wordId) throw new Error('Another answer came after that one, so it stays as it was.');
  await last.saved;
  await api('api/endless/undo', { method: 'POST', body: JSON.stringify({ requestId: last.requestId }) });
  const markId = requestId();
  stream.last = { requestId: markId, card: last.card, saved: Promise.resolve() };
  await api('api/endless/mark', { method: 'POST', body: JSON.stringify({ requestId: markId, direction: stream.direction, wordId, known: true }) });
}
// The card on screen stays as it is: the wrong grade is undone and given again as known behind it.
async function sayRegrade(wordId) {
  await pendingGrade;
  if (!snapshot?.undoId) throw new Error('Another answer came after that one, so it stays as it was.');
  const undone = await api('api/undo', { method: 'POST', body: JSON.stringify({ direction, deck, undoId: snapshot.undoId }) });
  if (undone.current?.id !== wordId) { applySnapshot(undone); throw new Error('Another answer came after that one, so it stays as it was.'); }
  const body = { direction, deck, wordId, version: undone.current.version, known: true, requestId: requestId() };
  applySnapshot(await api('api/grade', { method: 'POST', body: JSON.stringify(body), limit: GRADE_LIMIT }));
}
// What was heard, quoted inside a sentence: in lower case and without recognition's own full stop.
const sayQuoted = (text) => esc((text ?? '').trim().replace(/[.!?…]+$/, '').toLowerCase());
// The foot of a card Say is answering, in place of "Tap to reveal", as the Say it card had it: what Say is doing,
// then the ring while it listens (the speaker while the French plays, a spinner while it checks).
function sayFootHTML() {
  if (!say.running) return say.error ? `<p class="say-foot-note warn" role="alert">${esc(say.error)}</p>` : '';
  const listens = say.phase === 'listening' || say.phase === 'again';
  const line = { starting: 'Opening the microphone…', prompt: 'Listen', listening: 'Say it in English — take your time', again: `Heard “${sayQuoted(say.result?.heard)}” · still listening`, checking: 'Checking…' }[say.phase] ?? '';
  const slot = say.phase === 'prompt' ? `<span class="say-speaker">${speaker}</span>` : listens ? '<span class="say-ring"></span>' : say.phase === 'checking' || say.phase === 'starting' ? '<span class="say-busy"></span>' : '';
  return `<div class="say-foot" aria-live="polite"><span class="say-line">${line}</span><span class="say-slot" aria-hidden="true">${slot}</span></div>`;
}
// On a card Say turned: the verdict at its top, and what was heard after a miss.
function sayVerdictHTML() {
  const result = say.result, right = result.verdict === 'right';
  const label = right ? 'Right' : { dontknow: 'Not this time', silent: 'No answer' }[result.verdict] ?? 'Not quite';
  return `<p class="say-verdict ${right ? 'right' : 'wrong'}">${right ? checkIcon : crossIcon}<span>${label}${!right && result.heard ? ` · heard “${sayQuoted(result.heard)}”` : ''}</span></p>`;
}
// Under the card, with Say on, a row that keeps its place so the card never moves: Start before Say listens; then
// Don't know (live while it listens) and, after a miss, "I said it right" (naming the word once another card is up),
// or what it did.
function sayControlsHTML() {
  if (!say.running) return '<div class="say-controls"><button class="primary" data-action="say-start">Start speaking</button></div>';
  const listens = say.phase === 'listening' || say.phase === 'again';
  const dontKnow = `<button class="secondary" data-action="say-dontknow" ${listens ? '' : 'disabled'}>Don’t know</button>`;
  const fix = say.fix;
  if (!fix) return `<div class="say-controls">${dontKnow}</div>`;
  if (fix.state === 'done') return `<div class="say-controls two">${dontKnow}<p class="say-done">Counted as right · <span lang="${languageTag}">${frEsc(fix.fr)}</span></p></div>`;
  const onIt = say.phase === 'result' && shownCard()?.id === fix.wordId;
  return `<div class="say-controls two">${dontKnow}<button class="secondary" data-action="say-fix" ${fix.state === 'sending' ? 'disabled' : ''}>I said it right${onIt ? '' : `<small><span lang="${languageTag}">${frEsc(fix.fr)}</span> · “${sayQuoted(fix.heard)}”</small>`}</button></div>`;
}
// Sounds: pairs that differ by one sound (lib/sounds.ts). One side plays; the learner picks which one they heard,
// then can hear both. A round is ten pairs, the ones missed most first.
let soundList = null;          // api/sounds: each contrast with its recent record
let soundId = '';              // the contrast drilled, or 'mix'
let soundRound = null;         // { questions, index, chose, right }
// The version matches CLIP_VERSION in lib/sounds.ts.
// The version matches WORD_CLIP_VERSION in lib/store.ts.
const wordClipUrl = (id) => `audio/${encodeURIComponent(id)}.mp3?v=2`;
// The version matches SENTENCE_CLIP_VERSION in lib/comprehension-store.ts.
const sentenceClipUrl = (id) => `audio/comprehension/${encodeURIComponent(id)}.mp3?v=2`;
const soundUrl = (itemId, side) => `audio/sounds/${itemId}-${side}.mp3?v=2`;
function openSounds() { if (move('sounds', true)) loadSounds(); }
async function loadSounds() {
  loading = true; notice = null; retryAction = null; render();
  try { soundList = (await api('api/sounds')).contrasts; }
  catch (error) { notice = { message: error.message }; retryAction = { type: 'sounds' }; }
  loading = false;
  if (screen === 'sounds') render();
}
function renderSounds() {
  const header = listenTop();
  if (loading || !soundList) { main.innerHTML = `${noticeHTML()}<section class="topics">${header}${loading ? '<div class="loading-state" role="status">Loading…</div>' : ''}</section>`; return; }
  const record = (entry) => entry.ready === 0 ? 'Being recorded'
    : entry.recent.total ? `${entry.recent.right} of your last ${entry.recent.total} right` : 'Not tried yet';
  const row = (entry) => `<button class="topic-row" data-action="sound-open" data-sound="${esc(entry.id)}" ${busy || !entry.ready ? 'disabled' : ''}><span class="copy"><span class="topic-name"><h3>${esc(entry.title)}</h3><span class="level-tag">${esc(entry.level)}</span></span><p lang="${languageTag}">${entry.labels.map(esc).join(' · ')}</p><small class="topic-progress">${esc(record(entry))}</small></span><span class="arrow" aria-hidden="true">→</span></button>`;
  const ready = soundList.some((entry) => entry.ready);
  const mix = `<button class="topic-row" data-action="sound-open" data-sound="mix" ${busy || !ready ? 'disabled' : ''}><span class="copy"><span class="topic-name"><h3>All sounds</h3></span><p>A mix, with the pairs you miss most first.</p></span><span class="arrow" aria-hidden="true">→</span></button>`;
  main.innerHTML = `${noticeHTML()}<section class="topics">${header}<p class="subtitle">Two phrases that differ by one sound. Listen, then choose the one you heard.</p><div class="topic-list">${mix}${soundList.map(row).join('')}</div></section>`;
}
function openSound(id) { soundId = id; if (move(`sound|${id}`, true)) startSoundRound(); }
async function startSoundRound() {
  loading = true; notice = null; retryAction = null; soundRound = null; render();
  try {
    if (!soundList) soundList = (await api('api/sounds')).contrasts;
    const { questions } = await api('api/sounds/round', { method: 'POST', body: JSON.stringify({ id: soundId }) });
    soundRound = { questions, index: 0, chose: null, right: 0 };
  } catch (error) { notice = { message: error.message }; retryAction = { type: 'sound' }; }
  loading = false;
  if (screen !== 'sound') return;
  render();
  if (soundRound) playFrench(soundRound.questions[0].audio);
}
function soundContrast(id) { return soundList?.find((entry) => entry.id === id); }
function renderSound() {
  const title = soundId === 'mix' ? 'All sounds' : soundContrast(soundId)?.title || 'Sounds';
  const header = `<div class="section-top">${back('Sounds', 'sounds')}<span class="stream-label">${esc(title)}</span></div>`;
  if (loading || !soundRound) { main.innerHTML = `${noticeHTML()}<section class="stream">${header}${loading ? '<div class="loading-state" role="status">Loading…</div>' : ''}</section>`; return; }
  const { questions, index, chose } = soundRound;
  if (index >= questions.length) {
    main.innerHTML = `${noticeHTML()}<section class="summary">${header}<h1 class="score"><span class="sr-only">Score: </span>${soundRound.right} <span>/ ${questions.length}</span></h1><p class="summary-line">${soundRound.right === questions.length ? 'Every one heard right.' : 'The pairs you missed come back first next time.'}</p><div class="summary-actions"><button class="primary" data-action="sound-again">Another round</button><button class="secondary" data-action="sounds">All the sounds</button></div></section>`;
    return;
  }
  const question = questions[index];
  const settled = !!chose;
  const choices = question.choices.map((choice) => {
    const right = settled && choice.side === question.side;
    const wrong = settled && !right && choice.side === chose;
    const mark = right ? '<span class="choice-mark"><span aria-hidden="true">✓</span><span class="sr-only">what played</span></span>'
      : wrong ? '<span class="choice-mark"><span aria-hidden="true">✕</span><span class="sr-only">what you chose</span></span>' : '';
    const pick = `<button class="choice${wrong ? ' wrong' : right ? ' right' : ''}" data-action="sound-choose" data-side="${choice.side}" ${settled ? 'disabled' : ''}><span><span lang="${languageTag}">${frEsc(choice.fr)}</span><small class="sound-en">${esc(choice.en)}</small></span>${mark}</button>`;
    const hear = settled ? `<button class="icon sound-hear" data-action="sound-hear" data-side="${choice.side}" aria-label="Hear ${esc(choice.fr)}">${speaker}</button>` : '';
    return `<div class="sound-choice">${pick}${hear}</div>`;
  }).join('');
  const heard = question.choices.find((choice) => choice.side === question.side);
  const feedback = settled ? `<div class="feedback ${chose === question.side ? '' : 'warn'}" role="status"><strong>${chose === question.side ? 'That’s right.' : 'Not quite.'}</strong><p>It was <span lang="${languageTag}">${frEsc(heard.fr)}</span>. Tap a speaker to hear each one.</p></div>` : '';
  const tip = soundContrast(question.contrastId)?.listen;
  main.innerHTML = `${noticeHTML()}<section class="stream sounds">${header}
    <p class="stream-item">${index + 1} of ${questions.length}${soundId === 'mix' ? ` · ${esc(soundContrast(question.contrastId)?.title || '')}` : ''}</p>
    <div class="listen-block big"><button class="listen-play" data-action="sound-play" aria-label="Play it again">${speaker}</button></div>
    <div class="choice-list" role="group" aria-label="Which did you hear?">${choices}</div>
    ${feedback}${tip ? `<p class="caption sound-tip">${esc(tip)}</p>` : ''}
    ${settled ? `<div class="stream-actions pinned"><button class="primary" data-action="sound-next">${index + 1 === questions.length ? 'See how it went' : 'Next'}</button></div>` : ''}
  </section>`;
}
function chooseSound(side) {
  const question = soundRound?.questions[soundRound.index];
  if (!question || soundRound.chose) return;
  soundRound.chose = side;
  if (side === question.side) soundRound.right += 1;
  render();
  main.querySelector('[data-action="sound-next"]')?.focus({ preventScroll: true });
  api('api/sounds/answer', { method: 'POST', body: JSON.stringify({ itemId: question.itemId, heard: question.side, chose: side, requestId: requestId() }) })
    .then((entry) => { if (soundList) soundList = soundList.map((item) => item.id === entry.id ? entry : item); })
    .catch((error) => { notice = { message: `This answer was not saved: ${error.message}` }; if (screen === 'sound') render(); });
}
function nextSound() {
  if (!soundRound?.chose) return;
  soundRound.index += 1; soundRound.chose = null; notice = null;
  render();
  const question = soundRound.questions[soundRound.index];
  if (question) playFrench(question.audio);
}
// Verbs: conjugation drills on the verbs in the vocabulary (lib/verbs.ts, lib/verb-drills.ts). Verbs options picks
// which verbs and tenses; Type it asks one form at a time, Whole table all six persons, By ear which tense or how
// many; each tense row sums your forms in it, and All your verbs colours every form by how it is doing.
// Each language's words for the room (lib/verb-grammar.ts): French conjugates six persons in four tenses, Portuguese
// four persons (Brazil drops tu and vós, so their slots stay empty), Swedish three key forms per verb, drilled by
// conjugation group where the others drill tenses. keyForms: a Swedish card asks all three forms of one verb.
const VB_LANGUAGES = {
  fr: {
    tenses: { pres: 'présent', pc: 'passé composé', imp: 'imparfait', fut: 'futur' },
    columns: { pres: 'présent', pc: 'passé c.', imp: 'imparfait', fut: 'futur' },
    persons: ['je', 'tu', 'il / elle', 'nous', 'vous', 'ils / elles'],
    uses: { pres: 'now, always, and what is about to happen', pc: 'what happened: a finished action', imp: 'how things were, what used to happen', fut: 'what will happen' },
    accents: ['é', 'è', 'ê', 'à', 'â', 'ç', 'î', 'ô', 'ù', 'û'],
    start: ['pres'], common: 'être, avoir, aller, faire…', table: 'All six persons', rules: 'Stems, endings, être or avoir', ear: true, tape: true,
    ways: [['produce', 'Verb → form'], ['recognize', 'Form → verb']],
    unit: 'tense', units: 'Tenses', the: 'the ', lit: 'The lit part is what changes from person to person.',
    note: 'Cards, Type it, In sentences, By ear, How it’s built, the verb tape and Change it use these. Whole table picks its own verb.',
    stats: { head: 'By tense and person', persons: 'Persons', all: 'four tenses', kinds: 'The share you got right in the last two weeks, by the groups on each tense page: regular -er verbs, -ir verbs like finir, and so on. Tap one to read about it.', form: 'one verb, one tense, one person', mark: 'a Cards or tape mark', drills: 'Type it, Cards, Next table, Look, then write and the verb tape' },
  },
  pt: {
    tenses: { pres: 'presente', perf: 'pretérito perfeito', imp: 'pretérito imperfeito', fut: 'futuro com ir' },
    columns: { pres: 'presente', perf: 'perfeito', imp: 'imperfeito', fut: 'futuro' },
    persons: ['eu', null, 'você / ele / ela', 'nós', null, 'vocês / eles / elas'],
    uses: { pres: 'now, always, and what you usually do', perf: 'what happened: a finished action', imp: 'how things were, what used to happen', fut: 'what is going to happen: vou falar' },
    accents: ['á', 'â', 'ã', 'à', 'é', 'ê', 'í', 'ó', 'ô', 'õ', 'ú', 'ç'],
    start: ['pres'], common: 'ser, estar, ter, fazer…', table: 'All four persons', rules: 'Endings, eu changes, the irregular ones', ear: true, tape: false,
    ways: [['produce', 'Verb → form'], ['recognize', 'Form → verb']],
    unit: 'tense', units: 'Tenses', the: 'the ', lit: 'The lit part is what changes from person to person.',
    note: 'Cards, Type it, By ear and How it’s built use these. Whole table picks its own verb.',
    stats: { head: 'By tense and person', persons: 'Persons', all: 'four tenses', kinds: 'The share you got right in the last two weeks, by the groups on each tense page. Tap one to read about it.', form: 'one verb, one tense, one person', mark: 'a Cards mark', drills: 'Type it, Cards, Next table and Look, then write' },
  },
  sv: {
    tenses: { one: 'Group 1 · -ar', two: 'Group 2 · -er', three: 'Group 3 · short', four: 'Group 4 · strong & irregular' },
    columns: { one: '1', two: '2', three: '3', four: '4' },
    persons: ['present', 'past', 'supine'],
    uses: { one: 'pratar, pratade, pratat: the biggest group', two: '-er, then -de or -te: ringde, köpte', three: 'short verbs: bor, bodde, bott', four: 'strong and irregular: learnt by heart' },
    accents: ['å', 'ä', 'ö'],
    start: ['one', 'two', 'three', 'four'], common: 'vara, ha, göra, gå…', table: 'All three forms', rules: 'Groups, endings, vowel changes', ear: false, tape: false, keyForms: true,
    ways: [['produce', 'Verb → forms'], ['meaning', 'English → forms']],
    unit: 'group', units: 'Groups', the: '', lit: 'The lit part is what changes from form to form.', every: 'all four groups',
    note: 'Cards, Type it and How it’s built use these. Whole table picks its own verb.',
    stats: { head: 'By group and form', persons: 'Forms', all: 'three key forms', kinds: 'The share you got right in the last two weeks, by the kinds of verb on each group page. Tap one to read about it.', form: 'one verb, one key form', mark: 'a Cards mark', drills: 'Type it, Cards, Next table and Look, then write' },
  },
};
const VB = VB_LANGUAGES[language] ?? VB_LANGUAGES.fr;
const VB_TENSES = VB.tenses;
const VB_PERSONS = VB.persons;
const VB_SETS = { mine: 'Your verbs', common: 'Most common 20', chosen: 'Choose…' };
const VB_USES = VB.uses;
const VB_ACCENTS = VB.accents;
const verbsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h7M4 12h5M4 17h7"/><path d="M14 6l3 12 3-12"/></svg>';
const VB_DRILL_ICONS = {
  cards: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="12" height="15" rx="2"/><path d="M8 3h10a2 2 0 0 1 2 2v13"/></svg>',
  forms: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>',
  table: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.6h16M12 4v16"/></svg>',
  ear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16v-4a8 8 0 0 1 16 0v4"/><rect x="3.5" y="14" width="4" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4" height="6.5" rx="1.5"/></svg>',
  tape: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><circle cx="15.5" cy="11" r="2"/><path d="M10.5 11h3M7 19l1.5-3h7L17 19"/></svg>',
  rules: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="14" width="8" height="6" rx="1"/><rect x="13" y="14" width="8" height="6" rx="1"/><rect x="8" y="5" width="8" height="6" rx="1"/></svg>',
  sentence: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M6.5 10.5h3M14.5 10.5h3M6.5 14.5h11"/><path d="M10.5 11.5h3" stroke-dasharray="1 1"/></svg>',
};
let vbWorstAll = false;    // Catching you out shows every form, not just the top three
// All your verbs: the search, the filter (practised, shaky, new, all) and whether every tense gets a column.
let vbAllQuery = '', vbAllFilter = 'practised', vbAllTenses = false;
let verbsInfo = null;    // api/verbs
let verbsPoll = 0;
let verbSet = (() => { const saved = readPreference('echo.verbs-set', 'mine'); return saved in VB_SETS ? saved : 'mine'; })();
let verbChosen = (() => { try { const list = JSON.parse(readPreference('echo.verbs-chosen', '[]')); return Array.isArray(list) ? list : []; } catch { return []; } })();
let verbTenses = (() => { try { const list = JSON.parse(readPreference('echo.verbs-tenses', JSON.stringify(VB.start))).filter((tense) => tense in VB_TENSES); return list.length ? list : VB.start; } catch { return VB.start; } })();
let verbForms = null;      // { items, index, result, given, fetching, done }
let verbCards = null;      // { items, index, size, revealed, marks: [], first: [] }
let verbDraft = '';
let verbTable = { verbId: '', tense: 'pres', answers: ['', '', '', '', '', ''], result: null, look: null };
// Whole table either picks the next table from the room's verbs and tenses ('next') or lets you choose one ('choose');
// a table opened from a verb's page is chosen for that visit only. Look, then write ('look') draws its tables like
// 'next' and shows each one filled in first (verbTable.look: its paradigm and rule) until Next empties it to be
// written. recent: the tables just done, newest first.
let vbTableMode = readPreference('echo.verbs-table-mode', 'next') === 'choose' ? 'choose' : 'next';
let vbTableVisit = vbTableMode;
const vbTableDrawn = () => vbTableVisit !== 'choose';
let vbTableRecent = [];
const VB_TABLE_GAP = 5;
let verbEar = null;        // { questions, index, chose, result, right }
let vbLastInput = '';
let verbTensePage = '', verbTenseView = null; // the tense page shown, and api/verbs/tense/<tense>
let verbPageId = '', verbPageView = null;     // the verb page shown, and api/verbs/verb/<id>
// A round started from a verb or tense page practises just that, without changing the room's own choice.
let verbFormsOverride = null;
const vbSettings = () => verbFormsOverride ?? { set: verbSet, verbIds: verbChosen, tenses: verbTenses };
const vbVerb = (id) => verbsInfo?.verbs.find((verb) => verb.id === id);
// hit: the person (or persons) to light. A row's note names what the forms alone don't (Swedish present, past, supine).
function paradigmHTML(rows, hit = -1) {
  const hits = [hit].flat();
  return `<table class="vb-para">${rows.map((row) => `<tr class="${hits.includes(row.person) ? 'hit' : ''}"><td lang="${languageTag}">${row.note ? `<small class="vb-key">${esc(row.note)}</small>` : ''}${row.parts.map((part) => part.lit ? `<span class="end">${esc(part.text)}</span>` : esc(part.text)).join('')}</td></tr>`).join('')}</table>`;
}
const vbAccentsHTML = () => `<div class="vb-accents" aria-label="Accented letters">${VB_ACCENTS.map((letter) => `<button type="button" data-action="vb-accent" data-letter="${letter}">${letter}</button>`).join('')}</div>`;

function openVerbs() { if (move('verbs', true)) loadVerbs(); }
async function loadVerbs(quiet = false) {
  clearTimeout(verbsPoll);
  if (!quiet) { loading = true; notice = null; retryAction = null; render(); }
  try { verbsInfo = await api('api/verbs'); }
  catch (error) { if (!quiet) { notice = { message: error.message }; retryAction = { type: 'verbs' }; } }
  loading = false;
  if (screen !== 'verbs' && screen !== 'verbs-all') return;
  render();
  // While tables are being written, the room looks again now and then.
  if (verbsInfo && verbsInfo.tables.ready < verbsInfo.tables.total && !verbsInfo.tables.error) verbsPoll = setTimeout(() => { if (screen === 'verbs' || screen === 'verbs-all') loadVerbs(true); }, 15000);
}
// A verb's forms: practised once any has a state past new; shaky counts its shaky forms. A null state is a form whose
// table is not written yet.
const vbPractised = (verb) => Object.values(verb.states).flat().some((state) => state && state !== 'new');
const vbShaky = (verb) => Object.values(verb.states).flat().filter((state) => state === 'shaky').length;
// What the drills will use, in one line: the verbs, then the tenses.
function verbChoiceText() {
  const verbs = verbSet === 'chosen' ? (verbChosen.length ? `${verbChosen.length} chosen ${verbChosen.length === 1 ? 'verb' : 'verbs'}` : 'No verbs chosen yet') : VB_SETS[verbSet];
  // Swedish names all four groups at once; its group names are long, and four of them fill the line.
  const units = VB.every && verbTenses.length === Object.keys(VB_TENSES).length ? VB.every : verbTenses.map((tense) => VB_TENSES[tense]).join(', ');
  return `${verbs} · ${units}`;
}
function renderVerbs() {
  const header = `<div class="section-top">${back('Home', 'home')}<div>${infoButton('verbs')}<button class="icon" data-action="vb-options" aria-label="Verbs options" aria-haspopup="dialog" ${busy || !verbsInfo ? 'disabled' : ''}>•••</button></div></div>`;
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="topics vb">${header}<h1>Verbs</h1>${body}</section>`; };
  if (loading || !verbsInfo) { shell(loading ? '<div class="loading-state" role="status">Loading…</div>' : ''); return; }
  const { tables } = verbsInfo;
  if (!tables.ready) { shell(`<div class="song-progress" role="status"><p>${tables.error ? `Your verb tables could not be written: ${esc(tables.error)}` : `Echo is writing a table for each of your ${tables.total} verbs. It takes a few minutes.`}</p></div>`); return; }
  const writing = tables.ready < tables.total ? `<p class="caption vb-writing" role="status">${tables.ready} of ${tables.total} verb tables written; the rest follow in a few minutes.</p>` : '';
  const blocked = (verbSet === 'mine' && !verbsInfo.mine) || (verbSet === 'chosen' && !verbChosen.length);
  const setup = `<button class="vb-setup" data-action="vb-options" aria-haspopup="dialog" ${busy ? 'disabled' : ''}><span class="what"><small>Practising</small><b>${esc(verbChoiceText())}</b></span><span class="change">Change</span></button>`;
  const ear = verbsInfo.ear.ready < verbsInfo.ear.total ? `${verbsInfo.ear.ready} of ${verbsInfo.ear.total} recorded` : 'Tell the tense by ear';
  const tile = (action, icon, title, detail, disabled) => `<button class="tile tile-row${['vb-ear', 'tape'].includes(action) ? ' fam-green' : ''}" data-action="${action}" ${action === 'tape' ? 'data-tape="verbs-tape"' : ''} ${busy || disabled ? 'disabled' : ''}><span class="ic" aria-hidden="true">${VB_DRILL_ICONS[icon]}</span><span class="tile-copy"><h2>${title}</h2><p>${esc(detail)}</p></span></button>`;
  const sentences = roomsOff.has('sentencecards') ? '' : tile('vb-sentences', 'sentence', 'In sentences', 'A verb inside a sentence', blocked);
  const drills = `<div class="vb-drills">${tile('vb-cards', 'cards', 'Cards', 'Turn it, say if you knew it', blocked)}${sentences}${tile('vb-forms', 'forms', 'Type it', 'One form at a time', blocked)}${tile('vb-table', 'table', 'Whole table', VB.table, false)}${tile('vb-look', 'table', 'Look, then write', 'See a table, then fill it in', false)}${VB.ear ? tile('vb-ear', 'ear', 'By ear', ear, blocked || !verbsInfo.ear.ready) : ''}${VB.tape ? tile('tape', 'tape', 'Tape', 'Hands-free, phone locked', false) : ''}${tile('vb-rules', 'rules', 'How it’s built', VB.rules, blocked)}</div>`;
  const worstShown = vbWorstAll ? verbsInfo.worst : verbsInfo.worst.slice(0, 3);
  const worst = verbsInfo.worst.length ? `<p class="study-label vb-sec">Catching you out${verbsInfo.worst.length > 3 ? `<button data-action="vb-worst-all">${vbWorstAll ? 'Fewer' : `All ${verbsInfo.worst.length}`}</button>` : ''}</p><ol class="vb-worst">${worstShown.map((entry) => `<li><button data-action="vb-cell" data-verb="${esc(entry.verbId)}" data-tense="${entry.tense}"><span lang="${languageTag}">${frEsc(entry.form)}</span><small>${esc(entry.tenseName)}</small><span class="vb-misses">missed ${entry.misses}×</span></button></li>`).join('')}</ol>` : '';
  // Each tense: its use, and a bar of your forms in it from solid to shaky, the rest still to try.
  const tenseRows = Object.entries(VB_TENSES).map(([tense, label]) => {
    const count = { solid: 0, getting: 0, shaky: 0, new: 0 };
    for (const verb of verbsInfo.verbs) for (const state of verb.states[tense]) if (state) count[state] += 1;
    const total = count.solid + count.getting + count.shaky + count.new;
    const width = (n) => total ? `${(100 * n / total).toFixed(2)}%` : '0';
    const note = count.solid + count.getting + count.shaky ? `${count.solid} solid · ${count.getting} getting there · ${count.shaky} shaky · ${count.new} to try` : 'Not started · how it works, and your verbs in it';
    return `<button class="vb-tense-row" data-action="vb-tense-page" data-tense="${tense}" ${busy ? 'disabled' : ''}><span class="top"><b lang="${languageTag}">${label}</b><span>${esc(VB_USES[tense])}</span><i aria-hidden="true">→</i></span><span class="vb-bar" aria-hidden="true"><i class="solid" style="width:${width(count.solid)}"></i><i class="getting" style="width:${width(count.getting)}"></i><i class="shaky" style="width:${width(count.shaky)}"></i></span><small>${note}</small></button>`;
  }).join('');
  const practised = verbsInfo.verbs.filter(vbPractised).length;
  const all = `<div class="topic-list vb-all-row"><button class="topic-row" data-action="vb-all" ${busy ? 'disabled' : ''}><span class="copy"><span class="topic-name"><h3>All your verbs</h3></span><p>${practised} practised of ${verbsInfo.verbs.length} · look one up, see every form</p></span><span class="arrow" aria-hidden="true">→</span></button></div>`;
  shell(`${writing}${setup}${drills}${worst}<p class="study-label vb-sec">${VB.units}</p><div class="vb-tenses">${tenseRows}</div>${all}`);
}
// Verbs options: which verbs and tenses Cards, Type it, In sentences, By ear, How it's built, the verb tape and Change it use.
function openVerbOptions() {
  if (!verbsInfo) return;
  const setDetail = { mine: `${verbsInfo.mine} started, shakiest first`, common: VB.common, chosen: verbChosen.length ? `${verbChosen.length} chosen` : 'pick any' };
  const sets = Object.entries(VB_SETS).map(([set, label]) => `<button class="vb-pill" data-action="vb-set" data-set="${set}" aria-pressed="${verbSet === set}">${label}<small${set === 'chosen' ? ' class="vb-chosen-count"' : ''}>${esc(setDetail[set])}</small></button>`).join('');
  const chooser = verbSet === 'chosen' ? `<div class="vb-chooser">${[...verbsInfo.verbs].sort((a, b) => Number(b.started) - Number(a.started) || a.inf.localeCompare(b.inf, languageTag)).map((verb) => `<button class="vb-chip" data-action="vb-choose" data-verb="${esc(verb.id)}" aria-pressed="${verbChosen.includes(verb.id)}" lang="${languageTag}">${frEsc(verb.inf)}</button>`).join('')}</div>` : '';
  const tenses = Object.entries(VB_TENSES).map(([tense, label]) => `<button class="vb-pill" data-action="vb-tense" data-tense="${tense}" aria-pressed="${verbTenses.includes(tense)}">${label}</button>`).join('');
  openDialog('Verbs options', `<p class="settings-label vb-label vb-first">Which verbs</p><div class="vb-pills">${sets}</div>${chooser}<p class="settings-label vb-label">${VB.units}</p><div class="vb-pills">${tenses}</div><p class="caption vb-options-note">${VB.note}</p><button class="primary dialog-action" data-action="close-dialog">Done</button>`, 'verbs-options');
}
function openVerbAll() { vbAllQuery = ''; if (move('verbs-all', true)) { if (verbsInfo) render(); else loadVerbs(); } }
// A verb's page or a table opened from All your verbs goes back there; from anywhere else, back to Verbs.
const vbBack = () => trail[depth - 1] === 'verbs-all' ? back('All your verbs', 'vb-all-back') : back('Verbs', 'verbs');
function renderVerbAll() {
  const header = `<div class="section-top">${back('Verbs', 'verbs')}</div>`;
  if (loading || !verbsInfo) { main.innerHTML = `${noticeHTML()}<section class="topics vb">${header}<h1>All your verbs</h1>${loading ? '<div class="loading-state" role="status">Loading…</div>' : ''}</section>`; return; }
  main.innerHTML = `${noticeHTML()}<section class="topics vb">${header}<h1>All your verbs</h1><label class="sr-only" for="vb-search">Find a verb</label><input id="vb-search" class="vb-search" type="search" placeholder="Find a verb, ${languageEnglish} or English…" value="${esc(vbAllQuery)}" autocomplete="off" autocapitalize="off" spellcheck="false"><div id="vb-all-results"></div></section>`;
  renderVerbAllResults();
}
// The list under the search box, redrawn on its own so typing keeps the keyboard up. A search looks through every
// verb, in alphabetical order; otherwise the filter applies, the shakiest first.
function renderVerbAllResults() {
  const target = document.querySelector('#vb-all-results');
  if (!target || !verbsInfo) return;
  const query = normalized(vbAllQuery.trim());
  const verbs = verbsInfo.verbs;
  const filters = { practised: ['Practised', vbPractised], shaky: ['Shaky', (verb) => vbShaky(verb) > 0], new: ['Not practised', (verb) => !vbPractised(verb)], all: ['All', () => true] };
  const list = query
    ? verbs.filter((verb) => normalized(verb.inf).includes(query) || normalized(verb.en).includes(query)).sort((a, b) => a.inf.localeCompare(b.inf, languageTag))
    : verbs.filter(filters[vbAllFilter][1]).sort((a, b) => vbShaky(b) - vbShaky(a) || Number(vbPractised(b)) - Number(vbPractised(a)) || a.inf.localeCompare(b.inf, languageTag));
  // Columns: the tenses with a form practised (the chosen tenses before any), or all four. Swedish has one: each
  // verb's three forms, in its own group.
  const practisedTenses = Object.keys(VB_TENSES).filter((tense) => verbs.some((verb) => verb.states[tense].some((state) => state && state !== 'new')));
  const columns = vbAllTenses ? Object.keys(VB_TENSES) : practisedTenses.length ? practisedTenses : verbTenses;
  const chips = Object.entries(filters).map(([id, [label, test]]) => `<button data-action="vb-all-filter" data-filter="${id}" aria-pressed="${!query && vbAllFilter === id}">${label} · ${verbs.filter(test).length}</button>`).join('');
  const toggle = !VB.keyForms && (columns.length < 4 || vbAllTenses) ? `<button data-action="vb-all-tenses">${vbAllTenses ? 'Only tenses you practise' : 'Show all 4 tenses'}</button>` : '';
  const cell = (verb, tense) => `<button class="vb-cell" data-action="vb-cell" data-verb="${esc(verb.id)}" data-tense="${tense}" aria-label="${esc(verb.inf)}, ${VB_TENSES[tense]}">${verb.states[tense].filter((state, person) => VB_PERSONS[person]).map((state) => `<i class="${state ?? 'none'}"></i>`).join('')}</button>`;
  const cells = (verb) => VB.keyForms ? cell(verb, Object.keys(VB_TENSES).find((tense) => verb.states[tense].some((state) => state !== null)))
    : verb.states[columns[0]].every((state) => state === null) ? '<span class="vb-unwritten">table being written</span>'
    : columns.map((tense) => cell(verb, tense)).join('');
  const rows = list.map((verb) => `<li class="vb-vrow"><button class="vb-vname" data-action="vb-verb" data-verb="${esc(verb.id)}"><span lang="${languageTag}">${frEsc(verb.inf)}</span><small>${esc(verb.en)}</small></button><span class="vb-vcells">${cells(verb)}</span></li>`).join('');
  const heads = VB.keyForms ? '<span>present · past · supine</span>' : columns.map((tense) => `<span>${VB.columns[tense]}</span>`).join('');
  target.innerHTML = `<div class="vb-chips">${chips}</div><div class="vb-list-meta"><span>${list.length} ${list.length === 1 ? 'verb' : 'verbs'}</span>${toggle}</div>${list.length ? `<div class="vb-colhead" aria-hidden="true">${heads}</div><ul class="vb-vrows">${rows}</ul><div class="vb-legend"><span><i class="solid"></i>solid</span><span><i class="getting"></i>getting there</span><span><i class="shaky"></i>shaky</span><span><i class="new"></i>not tried</span></div>` : `<p class="empty-list">${query ? 'No verb matches.' : 'None yet.'}</p>`}`;
}
function verbAction(action, button) {
  if (action === 'vb-options') openVerbOptions();
  else if (action === 'vb-set') { verbSet = button.dataset.set; savePreference('echo.verbs-set', verbSet); render(); openVerbOptions(); }
  // Choosing a verb only presses its chip, so the list stays where it was scrolled to.
  else if (action === 'vb-choose') { const id = button.dataset.verb; verbChosen = verbChosen.includes(id) ? verbChosen.filter((entry) => entry !== id) : [...verbChosen, id]; savePreference('echo.verbs-chosen', JSON.stringify(verbChosen)); button.setAttribute('aria-pressed', String(verbChosen.includes(id))); const count = dialog.querySelector('.vb-chosen-count'); if (count) count.textContent = verbChosen.length ? `${verbChosen.length} chosen` : 'pick any'; render(); }
  else if (action === 'vb-tense') { const tense = button.dataset.tense; const next = verbTenses.includes(tense) ? verbTenses.filter((entry) => entry !== tense) : [...verbTenses, tense]; if (!next.length) return; verbTenses = Object.keys(VB_TENSES).filter((entry) => next.includes(entry)); savePreference('echo.verbs-tenses', JSON.stringify(verbTenses)); render(); if (dialog.open && dialog.dataset.kind === 'verbs-options') openVerbOptions(); }
  else if (action === 'vb-worst-all') { vbWorstAll = !vbWorstAll; render(); }
  else if (action === 'vb-all') openVerbAll();
  else if (action === 'vb-all-back') { if (move('verbs-all')) loadVerbs(); }
  else if (action === 'vb-all-filter') { vbAllFilter = button.dataset.filter; vbAllQuery = ''; const input = document.querySelector('#vb-search'); if (input) input.value = ''; renderVerbAllResults(); }
  else if (action === 'vb-all-tenses') { vbAllTenses = !vbAllTenses; renderVerbAllResults(); }
  else if (action === 'vb-cards') { verbFormsOverride = null; if (move('verbs-cards', true)) startVerbCards(); }
  else if (action === 'vb-card-no' || action === 'vb-card-yes') markVerbCard(action === 'vb-card-yes');
  else if (action === 'vb-rules') { if (move('verbs-rules', true)) startRuleCards(); }
  else if (action === 'vb-rule-no' || action === 'vb-rule-yes') markRuleCard(action === 'vb-rule-yes');
  else if (action === 'vb-sentences') { if (move('verbs-sentences', true)) startVerbSentences(); }
  else if (action === 'vb-sentence-no' || action === 'vb-sentence-yes') markVerbSentence(action === 'vb-sentence-yes');
  else if (action === 'vb-sentence-play') { const card = verbSentences?.items[verbSentences.index]; if (card) playFrench(card.audio); }
  else if (action === 'vb-card-way') { const way = VB.ways.some(([value]) => value === button.dataset.way) ? button.dataset.way : 'produce'; if (way === verbCardsWay || loading) return; verbCardsWay = way; savePreference('echo.vb-cards-way', way); startVerbCards(); }
  else if (action === 'vb-forms') { verbFormsOverride = null; if (move('verbs-forms', true)) startVerbForms(); }
  else if (action === 'vb-tense-page') { if (move(`verbs-tense|${button.dataset.tense}`, true)) loadVerbTense(); }
  else if (action === 'vb-verb') openVerbPage(button.dataset.verb);
  else if (action === 'vb-practise-tense') { verbFormsOverride = { set: verbSet, verbIds: verbChosen, tenses: [button.dataset.tense] }; if (move('verbs-forms', true)) startVerbForms(); }
  else if (action === 'vb-practise-verb') { verbFormsOverride = { set: 'chosen', verbIds: [button.dataset.verb], tenses: verbTenses }; if (move('verbs-forms', true)) startVerbForms(); }
  else if (action === 'vb-table') { verbFormsOverride = null; openVerbTable(); }
  else if (action === 'vb-look') { verbFormsOverride = null; vbTableVisit = 'look'; if (move('verbs-table', true)) nextVerbTable(); }
  else if (action === 'vb-look-write') { verbTable.look = null; render(); main.querySelector('#vb-cell-0, .vb-input')?.focus({ preventScroll: true }); }
  else if (action === 'vb-table-mode') chooseVerbTableMode(button.dataset.value);
  else if (action === 'vb-next-table') nextVerbTable();
  else if (action === 'vb-cell') openVerbTable(button.dataset.verb, button.dataset.tense);
  else if (action === 'vb-ear') { if (move('verbs-ear', true)) startVerbEar(); }
  else if (action === 'vb-next') nextVerbForm();
  else if (action === 'vb-check-table') checkVerbTable();
  else if (action === 'vb-ear-play') { const question = verbEar?.questions[verbEar.index]; if (question) playFrench(question.audio); }
  else if (action === 'vb-ear-choose') chooseVerbEar(Number(button.dataset.choice));
  else if (action === 'vb-ear-next') nextVerbEar();
  else if (action === 'vb-ear-again') startVerbEar();
  else if (action === 'verbs') { if (move('verbs')) loadVerbs(); }
}
// An accent button types into the field last used, where the cursor was.
function insertAccent(letter) {
  const input = document.getElementById(vbLastInput) || main.querySelector('.vb-input');
  if (!input || input.disabled) return;
  const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
  input.value = input.value.slice(0, start) + letter + input.value.slice(end);
  input.focus(); input.setSelectionRange(start + 1, start + 1);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── Learn: a tense, and a verb ──
async function loadVerbTense() {
  loading = true; notice = null; retryAction = null; verbTenseView = null; render();
  try { verbTenseView = await api(`api/verbs/tense/${verbTensePage}`); }
  catch (error) { notice = { message: error.message }; retryAction = { type: 'verbs-tense' }; }
  loading = false;
  if (screen === 'verbs-tense') render();
}
// The model verbs side by side, one row per person, each ending lit.
function modelsHTML(models) {
  if (!models.length) return '';
  const people = models[0].paradigm.map((row) => row.person).filter((person) => models.every((model) => model.paradigm.some((row) => row.person === person)));
  const cell = (model, person) => { const row = model.paradigm.find((entry) => entry.person === person); return row.parts.map((part) => part.lit ? `<span class="end">${esc(part.text)}</span>` : esc(part.text)).join(''); };
  return `<div class="guide-table-wrap"><table class="guide-table vb-models"><thead><tr>${models.map((model) => `<th scope="col"><button class="vb-name" data-action="vb-verb" data-verb="${esc(model.id)}" lang="${languageTag}">${frEsc(model.inf)}</button></th>`).join('')}</tr></thead><tbody>${people.map((person) => `<tr>${models.map((model) => `<td lang="${languageTag}">${cell(model, person)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function renderVerbTense() {
  const header = `<div class="section-top">${back('Verbs', 'verbs')}<span class="stream-label">${VB.unit === 'group' ? 'Group' : 'Tense'}</span></div>`;
  const view = verbTenseView;
  if (loading || !view) { main.innerHTML = `${noticeHTML()}<section class="topic-page vb">${header}${loading ? '<div class="loading-state" role="status">Opening the tense…</div>' : ''}</section>`; return; }
  const groups = view.groups.map((group) => {
    const list = group.many
      ? `<details class="vb-many"><summary>${group.verbs.length} of your verbs</summary><div class="vb-chooser">${group.verbs.map((verb) => `<button class="vb-chip" data-action="vb-verb" data-verb="${esc(verb.id)}" lang="${languageTag}">${frEsc(verb.inf)}</button>`).join('')}</div></details>`
      : `<ul class="vb-group-list">${group.verbs.map((verb) => `<li><button data-action="vb-verb" data-verb="${esc(verb.id)}"><span lang="${languageTag}" class="vb-inf">${frEsc(verb.inf)}</span><span lang="${languageTag}" class="vb-detail">${frEsc(verb.detail)}</span></button></li>`).join('')}</ul>`;
    return `<section class="vb-group"><h3>${esc(group.title)} <span class="vb-count">${group.verbs.length}</span></h3><p class="vb-why">${frEsc(group.text)}</p>${list}</section>`;
  }).join('');
  const guides = view.guides.map((topic) => `<details class="vb-guide"><summary><span>${esc(topic.title)}</span><span class="level-tag">${esc(topic.level)}</span></summary>${guideHTML(topic.guide)}</details>`).join('');
  main.innerHTML = `${noticeHTML()}<section class="topic-page vb">${header}<h1 lang="${languageTag}">${esc(view.name)}</h1><p class="subtitle">${esc(view.use)}</p>
    <h2 class="story-heading">The pattern</h2>${modelsHTML(view.models)}<p class="caption">${VB.lit} Tap a verb to see all its ${VB.unit === 'group' ? 'forms' : 'tenses'}.</p>
    <h2 class="story-heading">Your verbs in ${VB.the}${esc(view.name)}</h2>${groups}
    ${view.guides.length ? `<h2 class="story-heading">The rules in full</h2><p class="caption">From Grammar. Tap one to open it.</p>${guides}` : ''}
    <div class="summary-actions"><button class="primary" data-action="vb-practise-tense" data-tense="${view.tense}">Practise ${VB.the}${esc(view.name)}</button></div></section>`;
}
function openVerbPage(id) { if (move(`verbs-verb|${id}`, true)) loadVerbPage(); }
async function loadVerbPage() {
  loading = true; notice = null; retryAction = null; verbPageView = null; render();
  try { verbPageView = await api(`api/verbs/verb/${verbPageId}`); }
  catch (error) { notice = { message: error.message }; retryAction = { type: 'verbs-verb' }; }
  loading = false;
  if (screen === 'verbs-verb') render();
}
function renderVerbPage() {
  const header = `<div class="section-top">${vbBack()}<span class="stream-label">Verb</span></div>`;
  const view = verbPageView;
  if (loading || !view) { main.innerHTML = `${noticeHTML()}<section class="topic-page vb">${header}${loading ? '<div class="loading-state" role="status">Opening the verb…</div>' : ''}</section>`; return; }
  const tenses = view.tenses.map((entry) => `<section class="vb-tense-block"><div class="vb-tense-head"><h2 lang="${languageTag}">${esc(entry.name)}</h2><button class="quiet" data-action="vb-tense-page" data-tense="${entry.tense}">${esc(entry.group)} →</button></div>${paradigmHTML(entry.paradigm)}<p class="vb-why vb-rule">${frEsc(entry.rule)}</p><button class="quiet vb-table-link" data-action="vb-cell" data-verb="${esc(view.id)}" data-tense="${entry.tense}">Fill in this table</button></section>`).join('');
  main.innerHTML = `${noticeHTML()}<section class="topic-page vb">${header}<h1 lang="${languageTag}">${frEsc(view.inf)}</h1><p class="subtitle">${esc(view.en)}</p>
    <div class="summary-actions"><button class="primary" data-action="vb-practise-verb" data-verb="${esc(view.id)}">Practise ${esc(view.inf)}</button></div>${tenses}</section>`;
}

// ── Cards: like vocabulary cards, for forms, and just as endless. Think of the form, tap to turn the card, then left
// if you didn't know it and right if you did. The mark counts for the form like a typed answer; a missed card comes
// back once, a few cards later. More cards are fetched while a few are still waiting, chosen afresh from the marks
// so far, so the stream goes on as long as you do.
const VB_CARDS_AHEAD = 5;
const VB_CARDS_RECENT = 8;
// Which side comes first: 'produce' shows the verb, tense and person and asks for the form; 'recognize' shows a form
// ("mens") and asks which verb, tense and persons it is. A recognize card stands for its form, whichever person drew it.
let verbCardsWay = (() => { const saved = readPreference('echo.vb-cards-way', 'produce'); return VB.ways.some(([value]) => value === saved) ? saved : 'produce'; })();
const vbCardsBody = () => ({ ...vbSettings(), way: verbCardsWay });
const vbCardKey = (card) => `${card.verbId}|${card.tense}|${card.form ?? card.person}`;
async function startVerbCards() {
  loading = true; notice = null; retryAction = null; verbCards = null; render();
  try { const { items } = await api('api/verbs/cards', { method: 'POST', body: JSON.stringify(vbCardsBody()) }); verbCards = { items, index: 0, revealed: false, fetching: false, done: false }; }
  catch (error) { notice = { message: error.message }; retryAction = { type: 'verbs-cards' }; }
  loading = false;
  if (screen === 'verbs-cards') render();
}
// Tops a stream (Cards, Type it, How it's built) up from its endpoint; a card already waiting, or seen in the last
// few, is left out so nothing comes straight back. Only the "choosing more" screen is redrawn; a card being looked
// at is left alone. keyOf names what counts as the same card.
async function topUpVerbStream(stream, path, current, onScreen, body = vbSettings, keyOf = vbCardKey) {
  if (!stream || stream.fetching || stream.done || stream.items.length - stream.index > VB_CARDS_AHEAD) return;
  stream.fetching = true;
  const waitingOnScreen = stream.index >= stream.items.length;
  try {
    const { items } = await api(path, { method: 'POST', body: JSON.stringify(body()) });
    if (current() !== stream) return;
    const near = new Set(stream.items.slice(Math.max(0, stream.index - VB_CARDS_RECENT)).map(keyOf));
    const fresh = items.filter((card) => !near.has(keyOf(card)));
    const waiting = new Set(stream.items.slice(stream.index).map(keyOf));
    // With very few forms to choose from, anything not already waiting will do.
    const added = fresh.length ? fresh : items.filter((card) => !waiting.has(keyOf(card)));
    if (!added.length && stream.index >= stream.items.length) stream.done = true;
    stream.items.push(...added);
  } catch (error) { notice = { message: error.message }; }
  stream.fetching = false;
  if (screen === onScreen && current() === stream && waitingOnScreen) render();
}
const topUpVerbCards = () => topUpVerbStream(verbCards, 'api/verbs/cards', () => verbCards, 'verbs-cards', vbCardsBody);
function renderVerbCards() {
  const way = `<div class="segmented vb-card-way" role="group" aria-label="Which side of the card comes first">${VB.ways.map(([value, label]) => `<button data-action="vb-card-way" data-way="${value}" aria-pressed="${verbCardsWay === value}" ${loading ? 'disabled' : ''}>${label}</button>`).join('')}</div>`;
  const header = `<div class="section-top">${back('Verbs', 'verbs')}<span class="stream-label">Cards</span></div>${way}`;
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="stream vb vb-cards">${header}${body}</section>`; };
  if (loading || !verbCards) { shell(loading ? '<div class="loading-state" role="status">Choosing forms…</div>' : ''); return; }
  const { items, index, revealed } = verbCards;
  if (index >= items.length) {
    shell(verbCards.done ? `<p class="caption">No forms to show for these verbs and ${VB.units.toLowerCase()}.</p>` : '<div class="loading-state" role="status">Choosing more forms…</div>');
    topUpVerbCards();
    return;
  }
  const card = items[index];
  const again = card.again ? '<p class="caption vb-again-note">Once more, from a few cards ago.</p>' : '';
  const recognize = !!card.readings;
  const [own, ...also] = card.readings ?? [];
  // A Swedish card asks all three key forms of its verb, from the verb or (English → forms) from its meaning alone.
  const keyFace = revealed
    ? `<h1 class="main-word vb-card-answer" lang="${languageTag}">${frEsc(card.answer)}</h1><p class="source-word"><span lang="${languageTag}">${frEsc(card.inf)}</span> · ${esc(card.en)}</p><span class="vb-tense">${esc(card.tenseName)}</span>`
    : verbCardsWay === 'meaning' ? `<h1 class="main-word vb-card-meaning">${esc(card.en)}</h1>` : `<h1 class="main-word" lang="${languageTag}">${frEsc(card.inf)}</h1><p class="source-word">${esc(card.en)}</p>`;
  const face = VB.keyForms ? keyFace : recognize
    ? revealed
      ? `<h1 class="main-word" lang="${languageTag}">${frEsc(own.inf)}</h1><p class="source-word">${esc(own.tenseName)} · ${esc(own.en)}</p><p class="vb-card-forms" lang="${languageTag}">${own.forms.map(frEsc).join(' · ')}</p>${also.map((reading) => `<p class="vb-card-also">Also <span lang="${languageTag}">${frEsc(reading.inf)}</span>, ${esc(reading.tenseName)}: <span lang="${languageTag}">${reading.forms.map(frEsc).join(' · ')}</span></p>`).join('')}`
      : `<h1 class="main-word" lang="${languageTag}">${frEsc(card.form)}</h1>`
    : revealed
      ? `<h1 class="main-word vb-card-answer" lang="${languageTag}">${frEsc(card.answer)}</h1><p class="source-word" lang="${languageTag}">${frEsc(card.inf)} · ${esc(card.tenseName)}</p>${card.hook ? `<p class="word-hook">${esc(card.hook)}</p>` : ''}`
      : `<p class="vb-card-who" lang="${languageTag}">${esc(VB_PERSONS[card.person])}</p><h1 class="main-word" lang="${languageTag}">${frEsc(card.inf)}</h1><p class="source-word">${esc(card.en)}</p><span class="vb-tense">${esc(card.tenseName)}</span>`;
  const zones = revealed ? `<button class="card-zone left" data-action="vb-card-no" aria-label="Didn’t know it"><span aria-hidden="true">←</span></button><button class="card-zone right" data-action="vb-card-yes" aria-label="Knew it"><span aria-hidden="true">→</span></button>` : '';
  const hint = VB.keyForms ? (verbCardsWay === 'meaning' ? 'Which verb is it? Say its present, past and supine to yourself, then tap the card.' : 'Say the present, past and supine to yourself, then tap the card.')
    : recognize ? 'Which verb, tense and person is it? Say it to yourself, then tap the card.' : 'Say the form to yourself, then tap the card.';
  const after = revealed ? `${paradigmHTML(card.paradigm, VB.keyForms ? -1 : recognize ? own.persons : card.person)}<p class="vb-why vb-rule">${frEsc(card.rule)}</p>` : `<p class="caption vb-card-hint">${hint}</p>`;
  shell(`${again}<div class="study-surface vb-card${revealed ? ' revealed' : ''}" id="vb-card" role="${revealed ? 'group' : 'button'}" tabindex="${revealed ? '-1' : '0'}" aria-label="${revealed ? 'The answer. Left: didn’t know. Right: knew it.' : 'Turn the card'}"><div class="word-content">${face}</div>${zones}</div>${after}`);
}
function revealVerbCard() {
  if (!verbCards || verbCards.revealed || verbCards.index >= verbCards.items.length) return;
  verbCards.revealed = true; render();
}
function markVerbCard(knew) {
  const stream = verbCards;
  const card = stream?.items[stream.index];
  if (!card || !stream.revealed) return;
  // A miss comes back four cards later, once.
  if (!knew && !card.again) stream.items.splice(Math.min(stream.items.length, stream.index + 5), 0, { ...card, again: true });
  stream.index += 1; stream.revealed = false; notice = null;
  render(); main.querySelector('#vb-card')?.focus({ preventScroll: true });
  api('api/verbs/mark', { method: 'POST', body: JSON.stringify({ requestId: requestId(), verbId: card.verbId, tense: card.tense, person: card.person, knew, ...(card.readings ? { way: 'recognize' } : {}) }) })
    .catch((error) => { notice = { message: `This mark was not saved: ${error.message}` }; if (screen === 'verbs-cards') render(); })
    // The next cards are chosen once this mark counts, so a form just missed is weighed as shaky.
    .finally(() => topUpVerbCards());
}

// ── How it's built: cards on how a tense is formed for a verb (its imparfait or futur stem, être or avoir and the
// participle) and on the rules themselves, turned and marked like Cards. A miss comes back once, a few cards later,
// and more cards are drawn from the marks so far while a few are still waiting. Turning a card plays its example
// forms where the verb tape or By ear has recorded them.
let vbRules = null; // { items, index, revealed, fetching, done }
// The verbs and tenses on the Practising line, never Mistakes' shaky forms.
const vbPractising = () => ({ set: verbSet, verbIds: verbChosen, tenses: verbTenses });
async function startRuleCards() {
  loading = true; notice = null; retryAction = null; vbRules = null; render();
  try { const { items } = await api('api/verbs/rules', { method: 'POST', body: JSON.stringify(vbPractising()) }); vbRules = { items, index: 0, revealed: false, fetching: false, done: false }; }
  catch (error) { notice = { message: error.message }; retryAction = { type: 'verbs-rules' }; }
  loading = false;
  if (screen === 'verbs-rules') render();
}
const topUpRuleCards = () => topUpVerbStream(vbRules, 'api/verbs/rules', () => vbRules, 'verbs-rules', vbPractising, (card) => card.id);
function renderRuleCards() {
  const header = `<div class="section-top">${back('Verbs', 'verbs')}<span class="stream-label">How it’s built</span></div>`;
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="stream vb vb-cards">${header}${body}</section>`; };
  if (loading || !vbRules) { shell(loading ? '<div class="loading-state" role="status">Choosing cards…</div>' : ''); return; }
  const { items, index, revealed } = vbRules;
  if (index >= items.length) {
    shell(vbRules.done ? `<p class="caption">No cards for these verbs and ${VB.units.toLowerCase()}. Change them on the Practising line in Verbs.</p>` : '<div class="loading-state" role="status">Choosing more cards…</div>');
    topUpRuleCards();
    return;
  }
  const card = items[index];
  const rule = card.kind === 'rule';
  const again = card.again ? '<p class="caption vb-again-note">Once more, from a few cards ago.</p>' : '';
  // A rule's answer breaks only between its words, never after the hyphen of an ending.
  const answer = rule ? card.answer.split(' ').map((part) => `<span>${frEsc(part)}</span>`).join(' ') : frEsc(card.answer);
  const face = revealed
    ? `<h1 class="main-word vb-card-answer${rule ? ' vb-rule-answer' : ''}" lang="${rule ? 'en' : languageTag}">${answer}</h1><p class="source-word">${rule ? esc(card.ask) : `<span lang="${languageTag}">${frEsc(card.inf)}</span> · ${esc(card.tenseName)}`}</p>${card.examples.length ? `<p class="vb-card-forms" lang="${languageTag}">${card.examples.map((example) => frEsc(example.text)).join(' · ')}</p>` : ''}`
    : `<p class="vb-card-who">${esc(card.ask)}</p><h1 class="main-word" lang="${languageTag}">${frEsc(card.inf)}</h1><p class="source-word" lang="${card.clueLang === 'fr' ? languageTag : card.clueLang}">${frEsc(card.clue)}</p>`;
  const zones = revealed ? `<button class="card-zone left" data-action="vb-rule-no" aria-label="Didn’t know it"><span aria-hidden="true">←</span></button><button class="card-zone right" data-action="vb-rule-yes" aria-label="Knew it"><span aria-hidden="true">→</span></button>` : '';
  const after = revealed ? `${card.paradigm.length ? paradigmHTML(card.paradigm) : ''}<p class="vb-why vb-rule">${frEsc(card.rule)}</p>` : '<p class="caption vb-card-hint">How is it built? Say it to yourself, then tap the card.</p>';
  shell(`${again}<div class="study-surface vb-card${revealed ? ' revealed' : ''}" id="vb-card" role="${revealed ? 'group' : 'button'}" tabindex="${revealed ? '-1' : '0'}" aria-label="${revealed ? 'The answer. Left: didn’t know. Right: knew it.' : 'Turn the card'}"><div class="word-content">${face}</div>${zones}</div>${after}`);
}
function revealRuleCard() {
  const card = vbRules?.items[vbRules.index];
  if (!card || vbRules.revealed) return;
  vbRules.revealed = true; render();
  const urls = card.examples.flatMap((example) => example.audio ? [example.audio] : []);
  if (urls.length) playClips(urls);
}
function markRuleCard(knew) {
  const stream = vbRules;
  const card = stream?.items[stream.index];
  if (!card || !stream.revealed) return;
  stopAudio();
  // A miss comes back four cards later, once.
  if (!knew && !card.again) stream.items.splice(Math.min(stream.items.length, stream.index + 5), 0, { ...card, again: true });
  stream.index += 1; stream.revealed = false; notice = null;
  render(); main.querySelector('#vb-card')?.focus({ preventScroll: true });
  api('api/verbs/rules/mark', { method: 'POST', body: JSON.stringify({ requestId: requestId(), id: card.id, knew }) })
    .catch((error) => { notice = { message: `This mark was not saved: ${error.message}` }; if (screen === 'verbs-rules') render(); })
    // The next cards are drawn once this mark counts, so a card just missed is weighed as such.
    .finally(() => topUpRuleCards());
}
// ── In sentences: a Verbs card with the verb inside a French sentence, its infinitive beside the blank, and a word
// or context that settles the tense. Claude writes the sentences ahead and the Mac records them (lib/verb-sentences.ts),
// for the verbs and tenses on the Practising line, which every request sends. The turned card fills the blank,
// plays the sentence and says why that tense; left or right marks it as in Cards, and the mark counts for the form.
// A miss comes back once, a few cards later.
let verbSentences = null;   // { items, index, revealed, fetching, writing, recording, error }
let vbSentencePoll = 0;
const VB_SENTENCES_AHEAD = 3;
async function startVerbSentences() {
  clearTimeout(vbSentencePoll);
  loading = true; notice = null; retryAction = null; verbSentences = null; render();
  try { const round = await api('api/verbs/sentences', { method: 'POST', body: JSON.stringify({ exclude: [], practising: vbPractising() }) }); verbSentences = { ...round, index: 0, revealed: false, fetching: false }; }
  catch (error) { notice = { message: error.message }; retryAction = { type: 'verbs-sentences' }; }
  loading = false;
  if (screen !== 'verbs-sentences') return;
  render(); waitForVerbSentences();
  main.querySelector('#vb-sentence')?.focus({ preventScroll: true });
}
// More cards while a few are still waiting: the Mac leaves out those waiting and the last few seen, unless
// nothing else is left.
async function topUpVerbSentences() {
  const stream = verbSentences;
  if (!stream || stream.fetching || stream.items.length - stream.index > VB_SENTENCES_AHEAD) return;
  stream.fetching = true;
  const waitingOnScreen = stream.index >= stream.items.length;
  if (waitingOnScreen && screen === 'verbs-sentences') render();
  try {
    const waiting = stream.items.slice(stream.index).map((card) => card.id);
    const recent = stream.items.slice(Math.max(0, stream.index - VB_CARDS_RECENT), stream.index).map((card) => card.id);
    const ask = (exclude) => api('api/verbs/sentences', { method: 'POST', body: JSON.stringify({ exclude: [...new Set(exclude)], practising: vbPractising() }) });
    let round = await ask([...waiting, ...recent]);
    if (!round.items.length && !waiting.length && recent.length) round = await ask([]);
    if (verbSentences !== stream) return;
    stream.items.push(...round.items.filter((card) => !waiting.includes(card.id)));
    Object.assign(stream, { writing: round.writing, recording: round.recording, error: round.error });
  } catch (error) { notice = { message: error.message }; }
  stream.fetching = false;
  if (screen === 'verbs-sentences' && verbSentences === stream && waitingOnScreen) { render(); waitForVerbSentences(); }
}
// With no card left while Claude writes or the Mac records, the screen looks again every few seconds.
function waitForVerbSentences() {
  clearTimeout(vbSentencePoll);
  const stream = verbSentences;
  if (stream && stream.index >= stream.items.length && (stream.writing || stream.recording)) vbSentencePoll = setTimeout(() => { if (screen === 'verbs-sentences') topUpVerbSentences(); }, 5000);
}
function renderVerbSentences() {
  const header = `<div class="section-top">${back('Verbs', 'verbs')}<span class="stream-label">In sentences</span></div>`;
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="stream vb vb-cards vb-sentences">${header}${body}</section>`; };
  if (loading || !verbSentences) { shell(loading ? '<div class="loading-state" role="status">Opening In sentences…</div>' : ''); return; }
  const { items, index, revealed, writing, recording, error } = verbSentences;
  if (index >= items.length) {
    shell(verbSentences.fetching ? '<div class="loading-state" role="status">Choosing more sentences…</div>'
      : writing ? '<div class="loading-state" role="status">Claude is writing sentences for you. This takes about a minute.</div>'
      : recording ? `<div class="loading-state" role="status">Your Mac is recording ${recording} new ${recording === 1 ? 'sentence' : 'sentences'}. This takes a minute or two.</div>`
      : `<div class="notice" role="alert"><span>${esc(error || 'No sentences yet.')}</span><button class="quiet" data-action="vb-sentences">Try again</button></div>`);
    return;
  }
  const card = items[index];
  warmClip(card.audio); warmClip(items[index + 1]?.audio);
  const [before, after = ''] = card.fr.split('___');
  const gap = revealed ? `<span class="vb-sentence-form">${frEsc(card.answer)}</span>` : '<span class="vb-sentence-gap"><span class="sr-only">blank</span></span>';
  const sentence = `<p class="vb-sentence" lang="${languageTag}">${frEsc(before)}${gap}${frEsc(after)}</p>`;
  const face = revealed
    ? `${sentence}<p class="source-word">${esc(card.en)}</p><span class="vb-tense">${esc(card.tenseName)} · <span lang="${languageTag}">${frEsc(card.inf)}</span></span>`
    : `${sentence}<span class="vb-tense" lang="${languageTag}">${frEsc(card.inf)}</span>`;
  const again = card.again ? '<p class="caption vb-again-note">Once more, from a few cards ago.</p>' : '';
  const zones = revealed ? `<button class="card-zone left" data-action="vb-sentence-no" aria-label="Didn’t know it"><span aria-hidden="true">←</span></button><button class="card-zone right" data-action="vb-sentence-yes" aria-label="Knew it"><span aria-hidden="true">→</span></button>` : '';
  const below = revealed
    ? `<div class="vb-sentence-why"><p class="vb-why vb-rule">${frEsc(card.why)}</p><button class="icon" data-action="vb-sentence-play" aria-label="Play the sentence again">${speaker}</button></div>`
    : '<p class="caption vb-card-hint">Which tense? Say the whole sentence to yourself, then tap the card.</p>';
  shell(`${again}<div class="study-surface vb-card${revealed ? ' revealed' : ''}" id="vb-sentence" role="${revealed ? 'group' : 'button'}" tabindex="${revealed ? '-1' : '0'}" aria-label="${revealed ? 'The answer. Left: didn’t know. Right: knew it.' : 'Turn the card'}"><div class="word-content">${face}</div>${zones}</div>${below}`);
}
function revealVerbSentence() {
  const card = verbSentences?.items[verbSentences.index];
  if (!card || verbSentences.revealed) return;
  verbSentences.revealed = true; render();
  playFrench(card.audio);
}
function markVerbSentence(knew) {
  const stream = verbSentences;
  const card = stream?.items[stream.index];
  if (!card || !stream.revealed) return;
  if (!knew && !card.again) stream.items.splice(Math.min(stream.items.length, stream.index + 5), 0, { ...card, again: true });
  stream.index += 1; stream.revealed = false; notice = null;
  stopAudio(); render(); main.querySelector('#vb-sentence')?.focus({ preventScroll: true });
  api('api/verbs/sentences/mark', { method: 'POST', body: JSON.stringify({ requestId: requestId(), id: card.id, knew }) })
    .catch((error) => { notice = { message: `This mark was not saved: ${error.message}` }; if (screen === 'verbs-sentences') render(); })
    // The next cards are chosen once this mark counts, so a form just missed is weighed as shaky.
    .finally(() => topUpVerbSentences());
}

// ── Sentence cards (French): hear a sentence, read it, or both; think what it means; turn the card for its English
// (and the French, if it was heard only), with every word tappable and the recording to hear again; then Got it or
// Not yet. The marks only decide when a sentence comes back (lib/sentence-cards.ts). The Mac sends the next few cards
// that fit Verbs' Practising line and the room's topics; a tap moves on at once, and each mark is saved behind, one at
// a time, in order, with its request id (kept on this device until the Mac has it), so a slow Mac never holds a card
// up and no mark counts twice.
const SC_MODES = { hear: ['Hear', headphones], read: ['Read', eyeIcon], both: ['Both', mixIcon] };
let scMode = (() => { const saved = readPreference('echo.sentences-mode', 'hear'); return saved in SC_MODES ? saved : 'hear'; })();
let scCards = null; // { items, index, revealed, fetching, asked, empty, next }
let scTopics = null; // [{ id, title, on }] from api/sentences/options
// More cards are asked for while this few wait; a Not yet comes back once, this many cards later.
const SC_AHEAD = 3;
const SC_AGAIN_AFTER = 4;
const SC_RECENT = 12;
const SC_SAVES_KEY = localKey('echo.sentences-saves');
let scSaves = (() => { try { const list = JSON.parse(localStorage.getItem(SC_SAVES_KEY) || '[]'); return { queue: Array.isArray(list) ? list : [], sending: false, failed: false }; } catch { return { queue: [], sending: false, failed: false }; } })();
let scSlow = false;
const SC_EMPTY = {
  tenses: 'No sentences in these tenses yet — more are being written.',
  topics: 'Every sentence in these tenses uses a topic you switched off.',
  words: 'These sentences use words you haven’t met yet — more are being written.',
  recordings: 'None of these sentences is recorded yet — try Read.',
};
const scCard = () => scCards?.items[scCards.index] ?? null;
function openSentences() { if (move('sentences', true)) startSentences(); }
// The cards the phone holds or has just shown, and those whose mark is still on its way, are never sent again.
function scExclude() {
  if (!scCards) return scSaves.queue.map((entry) => entry.id);
  return [...new Set([...scCards.items.slice(Math.max(0, scCards.index - SC_RECENT)).map((card) => card.id), ...scSaves.queue.map((entry) => entry.id)])];
}
const scRound = (exclude) => api('api/sentences/round', { method: 'POST', body: JSON.stringify({ practising: vbPractising(), mode: scMode, exclude }) });
async function startSentences() {
  loading = true; notice = null; retryAction = null; scCards = null; render();
  try { const round = await scRound(scExclude()); scCards = { items: round.items, index: 0, revealed: false, fetching: false, asked: 0, empty: round.empty, next: round.next }; }
  catch (error) { notice = { message: error.message }; retryAction = { type: 'sentences' }; }
  loading = false;
  if (screen !== 'sentences') return;
  render(); scWarm(); scAutoplay();
}
// More cards while a few still wait; with fresh=true (a new line, topic or way) the cards waiting are chosen again,
// and the one on screen too unless it is turned. Only the latest request's reply is used, so a reply to an older one
// never adds stale cards.
async function topUpSentences(fresh = false) {
  const stream = scCards;
  if (!stream || (stream.fetching && !fresh) || (!fresh && stream.items.length - stream.index > SC_AHEAD)) return;
  if (fresh) stream.items = stream.items.slice(0, stream.index + (stream.revealed ? 1 : 0));
  const asked = ++stream.asked;
  stream.fetching = true;
  const waitingOnScreen = stream.index >= stream.items.length;
  if (waitingOnScreen && screen === 'sentences') render();
  try {
    const round = await scRound(scExclude());
    if (scCards !== stream || asked !== stream.asked) return;
    const held = new Set(stream.items.slice(stream.index).map((card) => card.id));
    stream.items.push(...round.items.filter((card) => !held.has(card.id)));
    stream.empty = round.empty; stream.next = round.next;
  } catch (error) { if (asked === stream.asked) notice = { message: error.message }; }
  if (asked !== stream.asked) return;
  stream.fetching = false;
  scWarm();
  if (screen === 'sentences' && scCards === stream && (waitingOnScreen || fresh)) { render(); if (waitingOnScreen) scAutoplay(); }
}
// The recordings of the cards coming next are fetched ahead, so each plays the moment it shows.
function scWarm() {
  if (!scCards || scMode === 'read') return;
  for (const card of scCards.items.slice(scCards.index, scCards.index + SC_AHEAD + 1)) warmClip(card.audio);
}
function scAutoplay() {
  const card = scCard();
  if (screen === 'sentences' && card?.audio && !scCards.revealed && scMode !== 'read' && !dialog.open) playFrench(card.audio);
}
function sentencesTop() {
  return `<div class="section-top">${back('Home', 'home')}<div>${savingStatusHTML()}<span class="stream-label">Sentences</span>${infoButton('sentences')}<button class="icon" data-action="sc-options" aria-label="Sentences options" aria-haspopup="dialog">•••</button></div></div>`;
}
function renderSentences() {
  const way = `<div class="practice-way sc-way" role="group" aria-label="How the sentence comes">${Object.entries(SC_MODES).map(([mode, [title, icon]]) => `<button data-action="sc-mode" data-mode="${mode}" aria-pressed="${scMode === mode}">${icon}<span>${title}</span></button>`).join('')}</div>`;
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="stream sc">${sentencesTop()}${way}${body}</section>`; };
  if (loading || !scCards) { shell(loading ? '<div class="loading-state" role="status">Choosing sentences…</div>' : ''); return; }
  const card = scCard();
  if (!card) {
    if (scCards.fetching) { shell('<div class="loading-state" role="status">Choosing more sentences…</div>'); return; }
    const reason = SC_EMPTY[scCards.empty] || (scCards.next ? `All done for now — the next one is due ${dayLabel(scCards.next)}.` : 'All done for now.');
    shell(`<div class="stream-empty"><p>${esc(reason)}</p><button class="secondary" data-action="sc-options">Settings</button></div>`);
    return;
  }
  const { revealed } = scCards;
  const showFrench = revealed || scMode !== 'hear';
  const french = `<p class="vb-sentence sc-fr" lang="${languageTag}">${glossedHTML(card.fr, card.gloss)}</p>`;
  const play = card.audio && (revealed || scMode !== 'read') ? `<button class="${!revealed && scMode === 'hear' ? 'listen-play' : 'icon'} sc-play" data-action="sc-play" aria-label="Play the sentence${revealed ? ' again' : ''}">${speaker}</button>` : '';
  const face = `${showFrench ? french : ''}${revealed ? `<p class="source-word sc-en">${esc(card.en)}</p>` : ''}${play}`;
  const again = card.again ? '<p class="caption vb-again-note">Once more, from a few cards ago.</p>' : '';
  const foot = revealed
    ? `<button class="card-zone left" data-action="sc-not" aria-label="Not yet"><span class="zone-label" aria-hidden="true">← Not yet</span></button><button class="card-zone right" data-action="sc-got" aria-label="Got it"><span class="zone-label" aria-hidden="true">Got it →</span></button>`
    : '<span class="card-hint" aria-hidden="true">What does it mean? Tap to see</span>';
  shell(`${again}<div class="study-surface sc-card${revealed ? ' revealed' : ''}" id="sc-card" role="${revealed ? 'group' : 'button'}" tabindex="${revealed ? '-1' : '0'}" aria-label="${revealed ? 'The sentence and its meaning. Left: not yet. Right: got it.' : 'Turn the card'}"><div class="word-content">${face}</div>${foot}</div>`);
}
function revealSentence() {
  if (!scCard() || scCards.revealed) return;
  scCards.revealed = true; render();
  main.querySelector('#sc-card')?.focus({ preventScroll: true });
}
function markSentence(knew) {
  const stream = scCards;
  const card = scCard();
  if (!card || !stream.revealed) return;
  stopAudio();
  if (!knew && !card.again) stream.items.splice(Math.min(stream.items.length, stream.index + 1 + SC_AGAIN_AFTER), 0, { ...card, again: true });
  stream.index += 1; stream.revealed = false; notice = null;
  scSaves.queue.push({ requestId: requestId(), id: card.id, knew, again: !!card.again });
  keepSentenceSaves();
  render(); main.querySelector('#sc-card')?.focus({ preventScroll: true });
  scAutoplay();
  sendSentenceSaves();
  topUpSentences();
}
function keepSentenceSaves() {
  try { if (scSaves.queue.length) localStorage.setItem(SC_SAVES_KEY, JSON.stringify(scSaves.queue)); else localStorage.removeItem(SC_SAVES_KEY); } catch { /* private mode: kept for this visit */ }
}
// One mark at a time, in order: the first waits for its reply before the next goes, and a failed one goes again with
// its own request id, so the Mac counts it once whatever happened to the reply.
function sendSentenceSaves() {
  const saves = scSaves;
  if (saves.sending || saves.failed || !saves.queue.length) return;
  saves.sending = true;
  const entry = saves.queue[0];
  const slow = setTimeout(() => { scSlow = true; refreshSavingStatus(); }, SLOW_SAVE);
  api('api/sentences/mark', { method: 'POST', body: JSON.stringify(entry), limit: GRADE_LIMIT }).then(() => {
    clearTimeout(slow); saves.sending = false;
    if (saves.queue[0] === entry) saves.queue.shift();
    keepSentenceSaves();
    if (!saves.queue.length) { scSlow = false; refreshSavingStatus(); }
    sendSentenceSaves();
  }, (error) => {
    clearTimeout(slow); saves.sending = false;
    // The Mac answered and turned this mark down (a sentence no longer in Echo): it can never count, so it goes.
    if (error.status && error.status < 500) { saves.queue.shift(); keepSentenceSaves(); notice = { message: `A mark was not saved: ${error.message}` }; sendSentenceSaves(); }
    else { saves.failed = true; scSlow = false; notice = { message: error.message }; retryAction = { type: 'sentence-saves' }; }
    if (screen === 'sentences') render(); else refreshSavingStatus();
  });
}
function resumeSentenceSaves() {
  if (retryAction?.type === 'sentence-saves') { notice = null; retryAction = null; }
  scSaves.failed = false;
  if (screen === 'sentences') render();
  sendSentenceSaves();
}
function chooseSentenceMode(mode) {
  if (!(mode in SC_MODES) || mode === scMode) return;
  scMode = mode; savePreference('echo.sentences-mode', mode);
  stopAudio(); render();
  // Hear offers only recorded sentences, so the cards are chosen again for the new way.
  topUpSentences(true);
}
// Options: the Practising line's tenses (the same line as in Verbs: a change here is a change there) and the grammar
// topics, each on unless switched off.
async function openSentenceOptions() {
  const draw = () => {
    const tenses = Object.entries(VB_TENSES).map(([tense, label]) => `<button class="vb-pill" data-action="sc-tense" data-tense="${tense}" aria-pressed="${verbTenses.includes(tense)}">${label}</button>`).join('');
    const topics = scTopics ? scTopics.map((topic) => `<button class="vb-pill" data-action="sc-topic" data-topic="${esc(topic.id)}" aria-pressed="${topic.on}">${esc(topic.title)}</button>`).join('') : '<p class="caption">Loading topics…</p>';
    const all = scTopics?.length ? `<button class="vb-pill sc-all" data-action="sc-topics-all" aria-pressed="${scTopics.every((topic) => topic.on)}">All</button>` : '';
    openDialog('Sentences options', `<p class="settings-label vb-label vb-first">Tenses · your Practising line in Verbs</p><div class="vb-pills">${tenses}</div><div class="sc-topics-head"><p class="settings-label">Grammar topics</p>${all}</div><div class="vb-pills sc-topics">${topics}</div><button class="primary dialog-action" data-action="close-dialog">Done</button>`, 'sc-options');
  };
  draw();
  if (scTopics) return;
  try { scTopics = (await api('api/sentences/options')).topics; } catch (error) { notice = { message: error.message }; }
  if (dialog.open && dialog.dataset.kind === 'sc-options') draw();
}
function chooseSentenceTense(tense) {
  const next = verbTenses.includes(tense) ? verbTenses.filter((entry) => entry !== tense) : [...verbTenses, tense];
  if (!next.length) return;
  verbTenses = Object.keys(VB_TENSES).filter((entry) => next.includes(entry)); savePreference('echo.verbs-tenses', JSON.stringify(verbTenses));
  openSentenceOptions();
  scChanged();
}
// The All pill is pressed while every topic is on; tapping it switches them all on, or all off when they already are.
function showSentenceTopics() {
  for (const topic of scTopics ?? []) dialog.querySelector(`[data-action="sc-topic"][data-topic="${CSS.escape(topic.id)}"]`)?.setAttribute('aria-pressed', String(topic.on));
  dialog.querySelector('[data-action="sc-topics-all"]')?.setAttribute('aria-pressed', String(!!scTopics?.every((topic) => topic.on)));
}
async function chooseSentenceTopic(id) {
  const topic = scTopics?.find((entry) => entry.id === id);
  if (!topic) return;
  topic.on = !topic.on; showSentenceTopics();
  try { scTopics = (await api('api/sentences/topic', { method: 'POST', body: JSON.stringify({ topic: id, on: topic.on }) })).topics; }
  catch (error) { topic.on = !topic.on; notice = { message: error.message }; }
  showSentenceTopics();
  scChanged();
}
async function chooseAllSentenceTopics() {
  if (!scTopics?.length) return;
  const before = scTopics.map((topic) => topic.on);
  const on = !scTopics.every((topic) => topic.on);
  for (const topic of scTopics) topic.on = on;
  showSentenceTopics();
  try { scTopics = (await api('api/sentences/topic', { method: 'POST', body: JSON.stringify({ topic: '*', on }) })).topics; }
  catch (error) { scTopics.forEach((topic, index) => { topic.on = before[index]; }); notice = { message: error.message }; }
  showSentenceTopics();
  scChanged();
}
// A changed line or topic: the cards waiting are chosen again, or the room starts again from an empty one.
function scChanged() {
  if (screen !== 'sentences') return;
  if (scCards && scCard()) topUpSentences(true); else startSentences();
}

// ── Type it: type one form at a time, as endless as Cards. A wrong answer comes back once, four forms later;
// more forms are chosen from the answers so far while a few are still waiting.
const topUpVerbForms = () => topUpVerbStream(verbForms, 'api/verbs/round', () => verbForms, 'verbs-forms');
async function startVerbForms() {
  loading = true; notice = null; retryAction = null; verbForms = null; verbDraft = ''; render();
  try { const { items } = await api('api/verbs/round', { method: 'POST', body: JSON.stringify(vbSettings()) }); verbForms = { items, index: 0, result: null, given: '', fetching: false, done: false }; }
  catch (error) { notice = { message: error.message }; retryAction = { type: 'verbs-forms' }; }
  loading = false;
  if (screen !== 'verbs-forms') return;
  render(); main.querySelector('#vb-answer')?.focus({ preventScroll: true });
}
function renderVerbForms() {
  const fromMistakes = verbFormsOverride?.set === 'shaky';
  const header = `<div class="section-top">${fromMistakes ? back('Mistakes', 'mistakes') : back('Verbs', 'verbs')}<span class="stream-label">${fromMistakes ? 'Shaky forms' : 'Type it'}</span></div>`;
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="stream vb">${header}${body}</section>`; };
  if (loading || !verbForms) { shell(loading ? '<div class="loading-state" role="status">Choosing forms…</div>' : ''); return; }
  const { items, index, result } = verbForms;
  if (index >= items.length) {
    shell(verbForms.done ? `<p class="caption">${fromMistakes ? 'Nothing shaky left: every form you have practised is above −2.' : `No forms to ask for these verbs and ${VB.units.toLowerCase()}.`}</p>` : '<div class="loading-state" role="status">Choosing more forms…</div>');
    topUpVerbForms();
    return;
  }
  const item = items[index];
  const prompt = `<div class="vb-prompt"><div class="vb-who" lang="${languageTag}">${esc(VB_PERSONS[item.person])}</div><div class="vb-verb" lang="${languageTag}">${frEsc(item.inf)}</div><div class="vb-meta">${esc(item.en)}</div><span class="vb-tense">${esc(item.tenseName)}</span></div>`;
  const again = item.again ? '<p class="caption vb-again-note">Once more, from a few forms ago.</p>' : '';
  if (!result) {
    shell(`${again}${prompt}<form class="vb-answer-row" id="vb-form"><input class="vb-input" id="vb-answer" lang="${languageTag}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="The form of ${esc(item.inf)} for ${esc(VB_PERSONS[item.person])}, ${esc(item.tenseName)}" value="${esc(verbDraft)}" ${busy ? 'disabled' : ''}><button class="primary" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Check'}</button></form>${vbAccentsHTML()}`);
    return;
  }
  const comesBack = !result.right && !item.again ? ' · this one comes back soon' : '';
  shell(`${again}${prompt}<div class="feedback ${result.right ? '' : 'warn'}" role="status"><strong>${result.right ? 'That’s right.' : 'Not quite.'}</strong><p><span lang="${languageTag}">${frEsc(result.expected)}</span>${result.right ? '' : ` — you wrote <span lang="${languageTag}">${esc(verbForms.given)}</span>.`}</p>${result.why ? `<p class="vb-why">${esc(result.why)}</p>` : ''}${!result.right && result.hook ? `<p class="word-hook">${esc(result.hook)}</p>` : ''}${paradigmHTML(result.paradigm, item.person)}<p class="vb-why vb-rule">${esc(result.rule)}</p></div>
    <div class="stream-actions pinned"><button class="primary" data-action="vb-next">Next${comesBack}</button></div>`);
  main.querySelector('[data-action="vb-next"]')?.focus({ preventScroll: true });
}
async function submitVerbForm() {
  const stream = verbForms;
  const item = stream?.items[stream.index];
  const given = main.querySelector('#vb-answer')?.value ?? verbDraft;
  if (!item || stream.result || busy || !given.trim()) return;
  busy = true; render();
  try {
    const result = await api('api/verbs/answer', { method: 'POST', body: JSON.stringify({ requestId: requestId(), verbId: item.verbId, tense: item.tense, person: item.person, given }) });
    stream.result = result; stream.given = given;
    if (!result.right && !item.again) stream.items.splice(Math.min(stream.items.length, stream.index + 5), 0, { ...item, again: true });
  } catch (error) { notice = { message: error.message }; }
  busy = false;
  if (screen === 'verbs-forms') render();
}
function nextVerbForm() {
  if (!verbForms?.result) return;
  verbForms.index += 1; verbForms.result = null; verbDraft = ''; notice = null;
  render(); main.querySelector('#vb-answer')?.focus({ preventScroll: true });
  // The next forms are chosen once this answer counts, so a form just missed is weighed as shaky.
  topUpVerbForms();
}

// ── Whole table ──
function openVerbTable(verbId, tense) {
  vbTableVisit = verbId ? 'choose' : vbTableMode;
  if (vbTableVisit === 'next') { if (move('verbs-table', true)) nextVerbTable(); return; }
  const verbs = verbsInfo?.verbs ?? [];
  const fallback = verbsInfo?.worst[0]?.verbId || verbs.find((verb) => verb.started)?.id || verbs[0]?.id || '';
  verbTable = { verbId: verbId || verbTable.verbId || fallback, tense: tense || (verbTenses.includes(verbTable.tense) ? verbTable.tense : verbTenses[0]), answers: ['', '', '', '', '', ''], result: null, look: null };
  if (move('verbs-table', true)) render();
}
// Draws the next table from the room's settings, passing over the last few done; Look, then write also fetches it
// filled in, to show first.
async function nextVerbTable() {
  loading = true; notice = null; retryAction = null; render();
  try {
    const [next] = await Promise.all([
      api('api/verbs/next-table', { method: 'POST', body: JSON.stringify({ ...vbSettings(), exclude: vbTableRecent }) }),
      verbsInfo ? null : loadVerbs(true),
    ]);
    const shown = vbTableVisit === 'look' ? (await api(`api/verbs/verb/${encodeURIComponent(next.verbId)}`)).tenses.find((entry) => entry.tense === next.tense) : null;
    verbTable = { verbId: next.verbId, tense: next.tense, answers: ['', '', '', '', '', ''], result: null, look: shown ? { paradigm: shown.paradigm, rule: shown.rule } : null };
  } catch (error) { notice = { message: error.message }; retryAction = { type: 'verbs-table' }; }
  loading = false;
  if (screen !== 'verbs-table') return;
  render(); if (!verbTable.look) main.querySelector('#vb-cell-0, .vb-input')?.focus({ preventScroll: true });
}
function chooseVerbTableMode(mode) {
  if (busy || loading || mode === vbTableVisit) return;
  vbTableMode = vbTableVisit = mode; savePreference('echo.verbs-table-mode', mode);
  if (mode === 'next') nextVerbTable(); else { verbTable = { ...verbTable, answers: ['', '', '', '', '', ''], result: null, look: null }; render(); }
}
function renderVerbTable() {
  const look = vbTableVisit === 'look';
  const modes = look ? '' : `<div class="segmented vb-table-modes" role="group" aria-label="How the table is picked">${[['next', 'Next table'], ['choose', 'Choose']].map(([mode, label]) => `<button data-action="vb-table-mode" data-value="${mode}" aria-pressed="${vbTableVisit === mode}" ${busy || loading ? 'disabled' : ''}>${label}</button>`).join('')}</div>`;
  const header = `<div class="section-top">${vbBack()}<span class="stream-label">${look ? 'Look, then write' : 'Whole table'}</span></div>${modes}`;
  // Back on this screen with no table drawn yet (a reload, say): draw one, unless the last try failed.
  if (vbTableDrawn() && !verbTable.verbId && !loading && !retryAction) { nextVerbTable(); return; }
  if (vbTableDrawn() && (loading || !verbTable.verbId)) { main.innerHTML = `${noticeHTML()}<section class="stream vb">${header}${loading ? '<div class="loading-state" role="status">Choosing a table…</div>' : ''}</section>`; return; }
  if (!verbsInfo) { main.innerHTML = `${noticeHTML()}<section class="stream vb">${header}</section>`; loadVerbs(true).then(() => { if (screen === 'verbs-table') { if (!verbTable.verbId) verbTable.verbId = verbsInfo?.verbs[0]?.id || ''; render(); } }); return; }
  const verb = vbVerb(verbTable.verbId) ?? verbsInfo.verbs[0];
  if (!verb) { main.innerHTML = `${noticeHTML()}<section class="stream vb">${header}<p class="caption">No verb tables yet.</p></section>`; return; }
  verbTable.verbId = verb.id;
  const options = [...verbsInfo.verbs].sort((a, b) => Number(b.started) - Number(a.started) || a.inf.localeCompare(b.inf, languageTag)).map((entry) => `<option value="${esc(entry.id)}" ${entry.id === verb.id ? 'selected' : ''}>${esc(entry.inf)}</option>`).join('');
  // A Swedish verb has a table only in its own group, so a table asked for in another moves to it.
  if (verb.states[verbTable.tense].every((state) => state === null)) verbTable.tense = Object.keys(VB_TENSES).find((tense) => verb.states[tense].some((state) => state !== null)) ?? verbTable.tense;
  const tenses = Object.entries(VB_TENSES).filter(([tense]) => verb.states[tense].some((state) => state !== null)).map(([tense, label]) => `<option value="${tense}" ${tense === verbTable.tense ? 'selected' : ''}>${label}</option>`).join('');
  const result = verbTable.result;
  const rows = verb.states[verbTable.tense].map((state, person) => {
    if (state === null) return '';
    const cell = result?.cells[person];
    const mark = cell ? `<span class="vb-mark ${cell.right ? 'ok' : 'bad'}" aria-label="${cell.right ? 'right' : 'wrong'}">${cell.right ? '✓' : '✕'}</span>` : '<span class="vb-mark"></span>';
    const fix = cell && !cell.right ? `<span class="vb-fix"><span lang="${languageTag}">${frEsc(cell.expected)}</span>${cell.why ? ` · ${esc(cell.why)}` : ''}</span>` : cell?.why ? `<span class="vb-fix vb-fix-ok">${esc(cell.why)}</span>` : '';
    return `<div class="vb-trow"><label class="vb-pro" for="vb-cell-${person}" lang="${languageTag}">${esc(VB_PERSONS[person])}</label><input class="vb-input${cell ? (cell.right ? ' ok' : ' bad') : ''}" id="vb-cell-${person}" data-vb-cell="${person}" lang="${languageTag}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(verbTable.answers[person])}">${mark}${fix}</div>`;
  }).join('');
  const hooks = result ? result.cells.filter((cell) => cell && !cell.right && cell.hook).map((cell) => `<p class="word-hook">${esc(cell.hook)}</p>`).join('') : '';
  const summary = result ? `<div class="feedback ${result.right === result.total ? '' : 'warn'}" role="status"><strong>${result.right} of ${result.total}.</strong>${hooks}<p class="vb-why">${esc(result.rule)}</p>${paradigmHTML(result.paradigm)}</div>` : '';
  const prompt = vbTableVisit === 'choose' ? `<div class="vb-grid-head"><label class="sr-only" for="vb-table-verb">Verb</label><select id="vb-table-verb">${options}</select><label class="sr-only" for="vb-table-tense">Tense</label><select id="vb-table-tense">${tenses}</select></div>
    <p class="caption">${esc(verb.en)}</p>` : `<div class="vb-prompt vb-table-prompt"><div class="vb-verb" lang="${languageTag}">${frEsc(verb.inf)}</div><div class="vb-meta">${esc(verb.en)}</div><span class="vb-tense">${esc(VB_TENSES[verbTable.tense])}</span></div>`;
  if (look && verbTable.look) {
    main.innerHTML = `${noticeHTML()}<section class="stream vb">${header}${prompt}<div class="vb-look">${paradigmHTML(verbTable.look.paradigm)}<p class="vb-why vb-rule">${frEsc(verbTable.look.rule)}</p></div><div class="summary-actions"><button class="primary" data-action="vb-look-write">Next · write it</button></div></section>`;
    return;
  }
  main.innerHTML = `${noticeHTML()}<section class="stream vb">${header}
    ${prompt}
    <div class="vb-rows">${rows}</div>${vbAccentsHTML()}
    <div class="summary-actions">${vbTableDrawn() && result ? `<button class="primary" data-action="vb-next-table">Next table</button><button class="secondary" data-action="vb-check-table" ${busy ? 'disabled' : ''}>Check again</button>` : `<button class="primary" data-action="vb-check-table" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : result ? 'Check again' : 'Check'}</button>`}</div>${summary}</section>`;
}
async function checkVerbTable() {
  if (busy) return;
  busy = true; render();
  const done = `${verbTable.verbId}|${verbTable.tense}`;
  vbTableRecent = [done, ...vbTableRecent.filter((entry) => entry !== done)].slice(0, VB_TABLE_GAP);
  try { verbTable.result = await api('api/verbs/table', { method: 'POST', body: JSON.stringify({ requestId: requestId(), verbId: verbTable.verbId, tense: verbTable.tense, answers: verbTable.answers, looked: vbTableVisit === 'look', again: !!verbTable.result }) }); }
  catch (error) { notice = { message: error.message }; }
  busy = false;
  if (screen !== 'verbs-table') return;
  render();
  // The table's marks change the map, so the room is fresh on the way back.
  loadVerbs(true);
}

// ── By ear ──
async function startVerbEar() {
  loading = true; notice = null; retryAction = null; verbEar = null; render();
  // An answer is checked against the tenses the round was asked in; Mistakes' shaky forms are asked in all four.
  const settings = vbSettings();
  try { const { questions } = await api('api/verbs/ear', { method: 'POST', body: JSON.stringify(settings) }); verbEar = { questions, index: 0, chose: null, result: null, right: 0, tenses: settings.set === 'shaky' ? undefined : settings.tenses }; }
  catch (error) { notice = { message: error.message }; retryAction = { type: 'verbs-ear' }; }
  loading = false;
  if (screen !== 'verbs-ear') return;
  render();
  if (verbEar) playFrench(verbEar.questions[0].audio);
}
function renderVerbEar() {
  const header = `<div class="section-top">${back('Verbs', 'verbs')}<span class="stream-label">By ear</span></div>`;
  if (loading || !verbEar) { main.innerHTML = `${noticeHTML()}<section class="stream vb">${header}${loading ? '<div class="loading-state" role="status">Loading…</div>' : ''}</section>`; return; }
  const { questions, index, chose, result } = verbEar;
  if (index >= questions.length) {
    main.innerHTML = `${noticeHTML()}<section class="summary">${header}<h1 class="score"><span class="sr-only">Score: </span>${verbEar.right} <span>/ ${questions.length}</span></h1><p class="summary-line">heard right.</p><div class="summary-actions"><button class="primary" data-action="vb-ear-again">Another round</button><button class="secondary" data-action="verbs">Back to Verbs</button></div></section>`;
    return;
  }
  const question = questions[index];
  const choices = question.choices.map((choice, at) => {
    const right = result && at === result.answer, wrong = result && !right && at === chose;
    const mark = right ? '<span class="choice-mark"><span aria-hidden="true">✓</span><span class="sr-only">the answer</span></span>' : wrong ? '<span class="choice-mark"><span aria-hidden="true">✕</span><span class="sr-only">what you chose</span></span>' : '';
    return `<button class="choice${wrong ? ' wrong' : right ? ' right' : ''}" data-action="vb-ear-choose" data-choice="${at}" ${chose !== null ? 'disabled' : ''}><span>${esc(choice)}</span>${mark}</button>`;
  }).join('');
  const feedback = result ? `<div class="feedback ${result.right ? '' : 'warn'}" role="status"><strong>${result.right ? 'That’s right.' : 'Not quite.'}</strong><p><span lang="${languageTag}">${frEsc(result.said)}</span></p><p class="vb-why">${esc(result.why)}</p></div>` : '';
  main.innerHTML = `${noticeHTML()}<section class="stream vb">${header}
    <p class="stream-item">${index + 1} of ${questions.length}</p>
    <div class="listen-block big"><button class="listen-play" data-action="vb-ear-play" aria-label="Play it again">${speaker}</button></div>
    <p class="stream-question">${esc(question.question)}</p>
    <div class="choice-list" role="group" aria-label="${esc(question.question)}">${choices}</div>${feedback}
    ${result ? `<div class="stream-actions pinned"><button class="primary" data-action="vb-ear-next">${index + 1 === questions.length ? 'See how it went' : 'Next'}</button></div>` : ''}
  </section>`;
}
async function chooseVerbEar(choice) {
  const question = verbEar?.questions[verbEar.index];
  if (!question || verbEar.chose !== null || busy) return;
  verbEar.chose = choice; busy = true; render();
  try { verbEar.result = await api('api/verbs/ear-answer', { method: 'POST', body: JSON.stringify({ requestId: requestId(), id: question.id, choice, tenses: verbEar.tenses }) }); if (verbEar.result.right) verbEar.right += 1; }
  catch (error) { verbEar.chose = null; notice = { message: error.message }; }
  busy = false;
  if (screen !== 'verbs-ear') return;
  render(); main.querySelector('[data-action="vb-ear-next"]')?.focus({ preventScroll: true });
}
function nextVerbEar() {
  if (!verbEar?.result) return;
  verbEar.index += 1; verbEar.chose = null; verbEar.result = null; notice = null;
  render();
  const question = verbEar.questions[verbEar.index];
  if (question) playFrench(question.audio);
}
// Story: a serial written for the learner a little above their level (lib/story.ts). An episode is read line by
// line, words tapped for their meaning and › for a line's; three questions follow, and finishing it lets the next
// episode be written, harder or easier by how this one went. Taps and opened lines are counted until then.
let storyStatus = null;         // api/story
let storyView = null;           // api/story/<n>
let storyNumber = 0;            // the episode shown; 0 = the latest
let storyAnswers = [];          // the choice picked for each question, until finished
const storyTaps = new Set();    // gloss "fr" tapped in this episode
const storyLines = new Set();   // lines whose meaning was opened
let storyRecap = false, storyNote = false, storyPoll = 0;
function openStory(number = 0) { storyNumber = number; if (move(number ? `story|${number}` : 'story', true)) loadStory(); }
async function loadStory(quiet = false) {
  clearTimeout(storyPoll);
  if (!quiet) { loading = true; notice = null; retryAction = null; render(); }
  try {
    storyStatus = await api('api/story');
    const number = storyNumber || storyStatus.episodes.at(-1)?.number || 0;
    if (number) {
      const view = await api(`api/story/${number}`);
      if (storyView?.episode.id !== view.episode.id) {
        storyAnswers = view.episode.questions.map(() => null); storyTaps.clear(); storyLines.clear(); storyRecap = false; storyNote = false;
        storyAudio.pause(); storyAudio.removeAttribute('src'); delete storyAudio.dataset.url; storyAt = -1; storyEnglish = false;
      }
      storyView = view;
    } else storyView = null;
  } catch (error) { if (!quiet) { notice = { message: error.message }; retryAction = { type: 'story' }; } }
  loading = false;
  if (screen !== 'story') return;
  render();
  // While an episode is being written or its lines recorded, the screen looks again now and then.
  const waiting = !storyView || (storyView.last && storyView.read) || storyView.audio.some((url) => !url);
  if (waiting && storyStatus && !storyStatus.error) storyPoll = setTimeout(() => { if (screen === 'story') loadStory(true); }, 15000);
}
// While the tape plays, the line playing is marked, and in French-then-English its English shows as it is said.
function storyLineHTML(line, index, glosses) {
  const open = storyLines.has(index);
  const current = storyTapeActive() && index === storyAt;
  const english = open || (current && storyEnglish && !storyAudio.paused);
  const translation = `<button class="line-meaning" data-action="story-line" data-index="${index}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} translation for line ${index + 1}">›</button>`;
  return `<div class="story-line${current ? ' playing' : ''}" data-line="${index}">${line.speaker ? `<span class="speaker">${esc(line.speaker)}</span>` : ''}<p class="reading-french" lang="${languageTag}">${glossedHTML(line.fr, glosses)} ${translation}</p>${english ? `<p class="reading-translation" lang="en">${esc(line.en)}</p>` : ''}</div>`;
}
// The episode as one MP3, French only or each line then its English, so lines follow each other without a wait
// and it plays on with the phone locked. Until its recordings are converted, the lines play one by one.
const storyAudio = new Audio();
const STORY_MODES = { fr: languageEnglish, both: `${languageEnglish}, then English` };
let storyMode = (() => { const saved = readPreference('echo.story-mode', 'fr'); return saved in STORY_MODES ? saved : 'fr'; })();
let storyAt = -1;          // the tape's line playing or where it paused; -1 before it starts or once it ends
let storyEnglish = false;  // whether that line's English is being said
function storyTape() { return storyView?.tapes?.[storyMode] ?? null; }
function storyTapeActive() { const tape = storyTape(); return !!tape && storyAudio.dataset.url === tape.url && storyAt >= 0; }
function storyPlayHTML() {
  const tape = storyTape();
  if (tape) {
    const playing = !storyAudio.paused && storyAudio.dataset.url === tape.url;
    const total = tape.lines.length;
    const hint = storyAt >= 0 ? `${playing ? 'line' : 'stopped at line'} ${storyAt + 1} of ${total}` : '';
    const modes = Object.entries(STORY_MODES).map(([mode, label]) => `<button data-action="story-mode" data-mode="${mode}" aria-pressed="${storyMode === mode}">${label}</button>`).join('<span aria-hidden="true">·</span>');
    return `<div class="story-player"><div class="listen-block"><button class="primary reading-play" data-action="story-play" aria-label="${playing ? 'Pause' : 'Listen to the episode'}">${playing ? pauseIcon : speaker}<span>${playing ? 'Pause' : 'Listen'}</span></button><p class="listen-hint" id="clip-progress" role="status">${esc(hint)}</p></div><p class="wm-choice story-mode">${modes}</p></div>`;
  }
  const recorded = storyView.audio.filter(Boolean).length;
  if (!recorded) return '<div class="story-player"><div class="listen-block"><p class="caption">The lines are being recorded.</p></div></div>';
  const playing = clipRun?.key === `story:${storyView.episode.id}`;
  const hint = playing && clipProgress ? `line ${clipProgress.index} of ${clipProgress.total}` : recorded < storyView.audio.length ? `${recorded} of ${storyView.audio.length} lines recorded` : '';
  return `<div class="story-player"><div class="listen-block"><button class="primary reading-play" data-action="story-play" aria-label="${playing ? 'Stop' : 'Listen to the episode'}">${playing ? pauseIcon : speaker}<span>${playing ? 'Stop' : 'Listen'}</span></button><p class="listen-hint" id="clip-progress" role="status">${esc(hint)}</p></div></div>`;
}
function storyQuestionsHTML(episode, finished) {
  return episode.questions.map((question, q) => {
    const chosen = storyAnswers[q];
    const settled = finished || chosen !== null;
    const choices = question.choices.map((choice, index) => {
      const right = settled && index === question.answer;
      const wrong = settled && !finished && !right && index === chosen;
      const mark = right ? '<span class="choice-mark"><span aria-hidden="true">✓</span><span class="sr-only">the answer</span></span>' : wrong ? '<span class="choice-mark"><span aria-hidden="true">✕</span><span class="sr-only">what you chose</span></span>' : '';
      return `<button class="choice${wrong ? ' wrong' : right ? ' right' : ''}" data-action="story-answer" data-q="${q}" data-story-choice="${index}" ${settled ? 'disabled' : ''}><span>${esc(choice)}</span>${mark}</button>`;
    }).join('');
    const why = settled && !finished ? `<div class="feedback ${chosen === question.answer ? '' : 'warn'}" role="status"><strong>${chosen === question.answer ? 'That’s right.' : 'Not quite.'}</strong><p>${esc(question.explanation)}</p></div>` : '';
    return `<div class="story-question"><p class="stream-question">${esc(question.question)}</p><div class="choice-list" role="group" aria-label="Choose your answer">${choices}</div>${why}</div>`;
  }).join('');
}
function renderStory() {
  const header = `<div class="section-top">${back('Home', 'home')}<div><span class="stream-label">Story</span>${infoButton('story')}</div></div>`;
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="topics story">${header}${body}</section>`; };
  if (loading && !storyView) { shell('<div class="loading-state" role="status">Opening the story…</div>'); return; }
  if (!storyStatus) { shell(''); return; }
  if (!storyView) {
    shell(`<h1>Your story</h1><div class="song-progress" role="status">${storyStatus.error ? `<p class="song-error">The first episode could not be written: ${esc(storyStatus.error)}</p><p class="caption">Echo tries again in half an hour.</p>` : '<p>The first episode is being written for you, from the words and grammar you know. It takes a few minutes.</p>'}</div>`);
    return;
  }
  const { episode, read } = storyView;
  const glosses = episode.gloss;
  const recap = storyView.previously ? `<button class="quiet story-recap" data-action="story-recap" aria-expanded="${storyRecap}">Previously ${storyRecap ? '▴' : '▾'}</button>${storyRecap ? `<p class="caption story-previously">${esc(storyView.previously)}</p>` : ''}` : '';
  const play = storyPlayHTML();
  const lines = episode.lines.map((line, index) => storyLineHTML(line, index, glosses)).join('');
  const note = `<button class="quiet story-grammar" data-action="story-note" aria-expanded="${storyNote}">Grammar in this episode: ${esc(episode.focus.title)} ${storyNote ? '▴' : '▾'}</button>${storyNote ? `<p class="caption">${esc(episode.focus.note)}</p>` : ''}`;
  const answered = storyAnswers.every((answer) => answer !== null);
  const later = storyStatus.episodes.find((entry) => entry.number === episode.number + 1);
  const nextCopy = storyView.next === 'harder' ? 'The next episode will be a little harder.' : storyView.next === 'easier' ? 'The next episode will be a little easier.' : 'The next episode stays at this level.';
  const end = read
    ? `<div class="song-progress story-done"><p><strong>${read.right} of ${read.total}</strong> right${read.taps.length ? `, ${read.taps.length} ${read.taps.length === 1 ? 'word' : 'words'} looked up` : ', no words looked up'}.</p><p class="caption">${esc(nextCopy)}</p>${later ? `<div class="summary-actions"><button class="primary" data-action="story-open" data-n="${later.number}">Episode ${later.number} →</button></div>` : storyView.last ? `<p class="caption" role="status">${storyStatus.error ? `The next episode could not be written: ${esc(storyStatus.error)}` : `Episode ${episode.number + 1} is being written. It takes a few minutes.`}</p>` : ''}</div>`
    : `<div class="summary-actions"><button class="primary" data-action="story-finish" ${!answered || busy ? 'disabled' : ''}>${busy ? 'Saving…' : answered ? 'Finish the episode' : 'Answer the questions to finish'}</button></div>`;
  const earlier = storyStatus.episodes.filter((entry) => entry.number !== episode.number).reverse().map((entry) => `<button class="topic-row" data-action="story-open" data-n="${entry.number}"><span class="copy"><span class="topic-name"><h3 lang="${languageTag}">${esc(entry.title)}</h3></span><p>Episode ${entry.number} · ${esc(entry.titleEn)}${entry.finished ? '' : ' · not finished'}</p></span><span class="arrow" aria-hidden="true">→</span></button>`).join('');
  shell(`<article class="reading-article" aria-labelledby="story-title"><header class="reading-heading"><p class="reading-kicker">Episode ${episode.number}</p><h1 id="story-title" lang="${languageTag}">${frEsc(episode.title)}</h1><p class="reading-subtitle">${esc(episode.titleEn)}</p>${recap}</header>${play}
    <div class="reading-body">${lines}</div><aside class="reading-note">${note}</aside></article>
    <section class="reading-questions" aria-labelledby="story-questions"><h2 id="story-questions" class="story-heading">Questions</h2>${storyQuestionsHTML(episode, !!read)}${end}</section>
    ${earlier ? `<h2 class="story-heading">Other episodes</h2><div class="topic-list">${earlier}</div>` : ''}`);
}
function playStory() {
  const tape = storyTape();
  if (!tape) {
    if (clipRun?.key === `story:${storyView?.episode.id}`) { stopAudio(); render(); return; }
    const urls = (storyView?.audio || []).filter(Boolean);
    if (urls.length) playClips(urls);
    return;
  }
  if (!storyAudio.paused) { storyAudio.pause(); return; }
  stopAudio();
  startStoryTape(tape, Math.max(0, storyAt));
}
// Plays the tape from the start of a line; a new tape opens there (a media fragment), a loaded one seeks.
async function startStoryTape(tape, line) {
  const at = tape.lines[Math.min(line, tape.lines.length - 1)]?.start ?? 0;
  mediaPlayer = 'story';
  if (storyAudio.dataset.url !== tape.url) { storyAudio.src = `${tape.url}#t=${at}`; storyAudio.dataset.url = tape.url; }
  else storyAudio.currentTime = at;
  storyAudio.playbackRate = speed; storyAudio.preservesPitch = true; storyAudio.webkitPreservesPitch = true;
  try { await storyAudio.play(); } catch (error) { if (error.name !== 'AbortError') { notice = { message: 'The episode could not start. Tap the speaker to try again.' }; render(); } }
}
function chooseStoryMode(mode) {
  if (mode === storyMode || !(mode in STORY_MODES)) return;
  const playing = !storyAudio.paused;
  storyMode = mode; savePreference('echo.story-mode', mode); storyEnglish = false;
  // Switching carries on from the line playing, in the new way.
  const tape = storyTape();
  if (playing && tape) startStoryTape(tape, Math.max(0, storyAt));
  render();
}
// Lock-screen skip moves a whole line: forward to the next, back to this line's start or the one before.
function skipStory(step) {
  const tape = storyTape();
  if (!tape || storyAudio.dataset.url !== tape.url) return;
  const index = Math.max(0, storyAt);
  const into = storyAudio.currentTime - (tape.lines[index]?.start ?? 0);
  const target = step > 0 ? index + 1 : into > 1.5 ? index : index - 1;
  if (target >= tape.lines.length) return;
  storyAudio.currentTime = tape.lines[Math.max(0, target)].start;
}
function followStory() {
  const tape = storyTape();
  if (!tape || storyAudio.dataset.url !== tape.url) return;
  const time = storyAudio.currentTime;
  let index = -1;
  for (let line = 0; line < tape.lines.length && tape.lines[line].start <= time + 0.01; line++) index = line;
  const english = index >= 0 && tape.lines[index].enAt !== null && time >= tape.lines[index].enAt - 0.01;
  if (index === storyAt && english === storyEnglish) return;
  const before = storyAt;
  storyAt = index; storyEnglish = english;
  const line = storyView.episode.lines[index];
  if (line && index !== before && 'mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: line.fr, artist: line.en, album: `Echo · Story, episode ${storyView.episode.number}`, artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] });
  if (screen === 'story' && !document.hidden) markStoryLines(before, index);
}
// Redraws only the lines whose mark changed and the hint, so reading and scrolling are undisturbed.
function markStoryLines(...indexes) {
  for (const index of new Set(indexes)) {
    const element = document.querySelector(`.story-line[data-line="${index}"]`);
    const line = storyView?.episode.lines[index];
    if (element && line) element.outerHTML = storyLineHTML(line, index, storyView.episode.gloss);
  }
  showClipProgress();
}
storyAudio.addEventListener('timeupdate', followStory);
for (const event of ['play', 'pause']) storyAudio.addEventListener(event, () => { if (screen === 'story' && storyView) markStoryLines(storyAt); });
storyAudio.addEventListener('ended', () => { const last = storyAt; storyAt = -1; storyEnglish = false; if (screen === 'story' && storyView) markStoryLines(last); });
storyAudio.addEventListener('error', () => {
  if (screen !== 'story' || !storyAudio.dataset.url) return;
  delete storyAudio.dataset.url; notice = { message: 'The episode stopped loading. Tap the speaker to try again.' }; render();
});
async function finishStory() {
  if (busy || !storyView || storyView.read || storyAnswers.some((answer) => answer === null)) return;
  busy = true; render();
  try {
    storyView = await api(`api/story/${storyView.episode.number}/finish`, { method: 'POST', body: JSON.stringify({ taps: [...storyTaps], linesOpened: storyLines.size, answers: storyAnswers, requestId: requestId() }) });
    storyStatus = await api('api/story');
  } catch (error) { notice = { message: error.message }; }
  busy = false;
  render();
  if (storyView?.read) loadStory(true);
}
function openGroup(id) {
  // Verb forms practise the shaky forms in Type it; every other group is a focus stream.
  if (mistakes?.find((group) => group.id === id)?.kind === 'verbs') { verbFormsOverride = { set: 'shaky', verbIds: [], tenses: Object.keys(VB_TENSES) }; if (move('verbs-forms', true)) startVerbForms(); return; }
  focusId = id; if (move(`focus|${id}`, true)) enterMixed();
}
async function loadMistakes(quiet = false) {
  if (!quiet) { loading = true; notice = null; retryAction = null; render(); }
  try {
    const result = await api('api/mistakes');
    mistakes = result.groups || [];
    loading = false;
    if (!quiet) render();
    return true;
  } catch (error) {
    loading = false; notice = { message: error.message }; retryAction = { type: 'mistakes' };
    render(); return false;
  }
}
// One mutation on a new screen: the same request is safe to retry, because the server keys it by requestId.
async function runAction(run, onConflict) {
  if (busy) return false;
  stopAudio(); busy = true; loading = false; notice = null; retryAction = null; render();
  try {
    await run();
    busy = false; render(); return true;
  } catch (error) {
    busy = false;
    if (error.status === 409 && onConflict) { await onConflict(error); return false; }
    notice = { message: error.message }; retryAction = { type: 'redo', run };
    render(); return false;
  }
}
// The state a step leaves, worked out here as the Mac works it out (StreamState.check and .after): an answer settles
// the question, Next brings the pick made for that outcome (null when none was sent), a lookup counts as help.
function settleLocally(state, choice) {
  const { check, current } = state;
  const outcome = choice !== check.answer ? 'incorrect' : current.mode === 'read' && state.lookups.length ? 'helped' : 'correct';
  const result = { outcome, expected: current.choices[check.answer], given: current.choices[choice], ...(check.explanation ? { explanation: check.explanation } : {}), lines: check.lines, gloss: check.gloss };
  return { ...state, result, check: null, level: state.after?.[outcome]?.level ?? state.level };
}
function nextLocally(state) {
  const held = state.result && state.after?.[state.result.outcome];
  return held?.current ? { stream: state.stream, level: held.level, current: held.current, result: null, lookups: [], version: state.version, check: held.check, after: held.after ?? null } : null;
}
// A step belongs to the question it was taken on: the same exercise, its choices in the same order.
function sameQuestion(current, entry) {
  return !!current && current.key === entry.key && (!entry.choices || current.choices.join('\n') === entry.choices.join('\n'));
}
// The screen's state: the Mac's latest with the steps still on their way done on top of it. A step taken on another
// question than the one reached is left out; sendStreamSaves finds it when its turn comes (streamMoved).
function streamAhead(confirmed, queue) {
  let state = confirmed;
  for (const entry of queue) {
    if (entry.kind === 'ear' || !sameQuestion(state.current, entry)) continue;
    if (entry.kind === 'answer' && state.check && !state.result) state = settleLocally(state, entry.extra.choice);
    else if (entry.kind === 'lookup' && !state.lookups.includes(entry.extra.fr)) state = { ...state, lookups: [...state.lookups, entry.extra.fr] };
    else if (entry.kind === 'next') state = nextLocally(state) ?? { ...state, waiting: true };
  }
  return state;
}
function startStreamSaves(id, confirmed) {
  let settle;
  const done = new Promise((resolve) => { settle = resolve; });
  streamSaves = { id, confirmed, queue: [], sending: false, failed: false, slow: 0, settle, done };
}
// Every stream waits for the one queue: a stream opened while another's steps are on their way reads the Mac after them.
function streamSettled() {
  if (streamSaves?.failed) resumeStreamSaves();
  return streamSaves?.done ?? Promise.resolve();
}
function saveBehind(entry) {
  if (!streamSaves) startStreamSaves(streamId, streamState);
  streamSaves.queue.push(entry);
  keepSaves();
  sendStreamSaves();
}
function sendStreamSaves() {
  const saves = streamSaves;
  if (!saves || saves.sending || saves.failed || !saves.queue.length) return;
  const entry = saves.queue[0];
  // Saves kept from an earlier visit start from the Mac's state as it is now.
  if (!saves.confirmed) {
    saves.sending = true;
    api(`api/comprehension/state?stream=${encodeURIComponent(saves.id)}`)
      .then((state) => { saves.sending = false; saves.confirmed = state; sendStreamSaves(); }, (error) => streamFailed(saves, null, error));
    return;
  }
  if (!entry.body) {
    // A step goes with the version of the Mac's state it follows, and only on the question that state shows.
    if (!sameQuestion(saves.confirmed.current, entry)) { streamMoved(saves); return; }
    entry.body = { stream: saves.id, key: entry.key, version: saves.confirmed.version, requestId: entry.requestId, ...entry.extra };
    keepSaves();
  }
  saves.sending = true;
  saves.slow = setTimeout(() => { if (streamSaves === saves) { streamSlow = true; refreshSavingStatus(); } }, SLOW_SAVE);
  api(entry.kind === 'ear' ? 'api/ear/answer' : `api/comprehension/${entry.kind}`, { method: 'POST', body: JSON.stringify(entry.body) })
    .then((reply) => streamSaved(saves, entry, reply), (error) => streamFailed(saves, entry, error));
}
function streamSaved(saves, entry, reply) {
  clearTimeout(saves.slow); saves.sending = false;
  if (streamSaves !== saves) return;
  saves.queue.shift();
  keepSaves();
  const here = streamId === saves.id;
  if (entry.kind === 'ear') {
    // The Mac's verdict counts; it differs from the one shown only when its record of earlier answers does.
    if (here && earShown()?.id === reply.id) {
      const changed = earResult?.right !== reply.right || earResult?.again !== reply.again;
      earResult = reply;
      if (changed && streamScreen()) render();
    }
    if (saves.queue.length) sendStreamSaves(); else endStreamSaves(saves);
    return;
  }
  saves.confirmed = reply;
  const step = saves.queue.find((queued) => queued.kind !== 'ear' && !queued.body);
  if (step && !sameQuestion(reply.current, step)) { streamMoved(saves); return; }
  if (saves.queue.length) sendStreamSaves(); else endStreamSaves(saves);
  if (!here) return;
  const before = streamState;
  const shown = { ...streamAhead(reply, saves.queue), ear: before?.ear ?? null };
  if (entry.kind === 'next' && reply.ear && !earsAnswered.has(reply.ear.id) && reply.ear.id !== before?.ear?.id) {
    // Grammar by ear goes before the question after it while that question has barely begun, else at the next Next.
    if (before?.waiting || (Date.now() - entry.at < SLOW_SAVE && !before?.result && !before?.ear)) shown.ear = reply.ear;
    else earLater = reply.ear;
  }
  const labels = (state) => (state?.level || []).map((level) => level.label).join();
  const changed = !!before?.waiting || before?.current?.key !== shown.current?.key || before?.ear?.id !== shown.ear?.id
    || before?.result?.outcome !== shown.result?.outcome || labels(before) !== labels(shown);
  applyStream(shown);
  const waited = before?.waiting && entry.mixed && mixed();
  if (waited) advanceMixed();
  // A question the Mac picked differently replaces the one shown only while nothing was done on it (else streamMoved).
  // Practise that waited on this reply may have moved to a card or grammar, which no stream render would draw.
  if ((changed && streamScreen()) || (waited && mixedSource !== 'comprehension')) render(); else refreshSavingStatus();
}
function streamFailed(saves, entry, error) {
  clearTimeout(saves.slow); saves.sending = false;
  if (streamSaves !== saves) return;
  streamSlow = false;
  // The Mac turned the step down: the stream is read again from it, with its reason.
  if (error.status >= 400 && error.status < 500) {
    endStreamSaves(saves);
    if (streamId === saves.id) loadStream(saves.id, error.status === 409 ? 'This exercise was refreshed. Answer the question shown now.' : error.message);
    return;
  }
  saves.failed = true;
  notice = { message: error.message }; retryAction = { type: 'stream-saves', body: entry?.body ?? { stream: saves.id } };
  if (streamScreen() || mixed()) render();
}
// The Mac's question is not the one the next step was taken on (the pick made ahead no longer fitted when Next was
// saved): those steps are not saved, and the Mac's question shows with a note. Grammar by ear answers still go.
function streamMoved(saves) {
  const ears = saves.queue.filter((queued) => queued.kind === 'ear');
  endStreamSaves(saves);
  if (ears.length) { startStreamSaves(saves.id, saves.confirmed); streamSaves.queue.push(...ears); sendStreamSaves(); }
  if (streamId !== saves.id) return;
  applyStream({ ...saves.confirmed, ear: null });
  notice = { kind: 'info', message: 'Your Mac had a different question next, so your answer to the last one was not counted. Answer the one shown now.' };
  if (streamScreen() || mixed()) render();
}
function endStreamSaves(saves) {
  if (streamSaves !== saves) return;
  clearTimeout(saves.slow);
  streamSaves = null; streamSlow = false;
  keepSaves();
  saves.settle();
  refreshSavingStatus();
}
// What is still on its way outlives the page: it is kept on this device and sent again, with the same request ids,
// when Echo next opens, and the Mac counts a request it has already saved only once.
const SAVES_KEY = localKey('echo.saves');
function keepSaves() {
  const kept = {
    grades: grades?.answers.map((entry) => entry.body) ?? [],
    stream: streamSaves?.queue.length ? { id: streamSaves.id, queue: streamSaves.queue.map(({ kind, key, choices, extra, requestId: id, body }) => ({ kind, key, choices, extra, requestId: id, body })) } : null,
  };
  try {
    if (kept.grades.length || kept.stream) localStorage.setItem(SAVES_KEY, JSON.stringify(kept));
    else localStorage.removeItem(SAVES_KEY);
  } catch { /* private mode: they are kept for this visit */ }
}
function resumeKeptSaves() {
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(SAVES_KEY) || 'null'); } catch { /* nothing kept */ }
  if (kept?.grades?.length) {
    grades = { confirmed: null, answers: kept.grades.map((body) => ({ body })), where: 'practice', sending: false, failed: false, settle: null };
    pendingGrade = new Promise((resolve) => { grades.settle = resolve; });
    saveGrades();
  }
  if (kept?.stream?.queue?.length) {
    startStreamSaves(kept.stream.id, null);
    streamSaves.queue.push(...kept.stream.queue);
    sendStreamSaves();
  }
}
// Retry: the step that failed goes again with its request id, then those after it.
function resumeStreamSaves() {
  notice = null; retryAction = null;
  if (streamSaves) streamSaves.failed = false;
  render();
  sendStreamSaves();
}
function streamPick(index) {
  if (earShown()) { earPick(Number(index)); return; }
  const view = streamState?.current;
  if (!view || streamState.result || !streamState.check || locked()) return;
  const choice = Number(index);
  stopAudio(); notice = null;
  applyStream(settleLocally(streamState, choice));
  saveBehind({ kind: 'answer', key: view.key, choices: view.choices, extra: { choice }, requestId: requestId() });
  render();
  announce(`${({ correct: 'That’s right.', helped: 'Right, with help.', incorrect: 'Not quite.' })[streamState.result.outcome] || ''} ${streamState.result.expected}`);
}
function earPick(choice) {
  const ear = earShown();
  if (!ear || earResult || locked()) return;
  const right = choice === ear.check.answer;
  // A question missed for the first time comes back once (lib/grammar-ear.ts); one shown again does not.
  earResult = { id: ear.id, right, answer: ear.check.answer, chosen: choice, why: ear.check.why, fr: ear.check.fr, en: ear.check.en, again: !right && !ear.again };
  earsAnswered.add(ear.id);
  stopAudio();
  saveBehind({ kind: 'ear', body: { requestId: requestId(), id: ear.id, choice } });
  render();
  announce(`${right ? 'That’s right.' : 'Not quite.'} ${ear.choices[ear.check.answer]}`);
}
function streamNext() {
  if (earShown()) {
    if (earResult && !locked()) { streamState = { ...streamState, ear: null }; earResult = null; render(); }
    return;
  }
  if (!streamState?.result || streamState.waiting || locked()) return;
  const held = nextLocally(streamState);
  saveBehind({ kind: 'next', key: streamState.current.key, extra: {}, requestId: requestId(), at: Date.now(), mixed: mixed() });
  stopAudio();
  if (!held) { streamState = { ...streamState, waiting: true }; render(); return; }
  const ear = earLater && !earsAnswered.has(earLater.id) ? earLater : null;
  earLater = null;
  applyStream({ ...held, ear });
  if (mixed()) advanceMixed();
  render(); main.focus({ preventScroll: true });
}
function autoplay() {
  const view = shownView();
  if (!view || !streamScreen() || shownSettled() || view.mode !== 'listen' || !view.audio?.length) return;
  const key = `${streamId}:${view.key}`;
  if (key === heardKey) return;
  heardKey = key; playClips(view.audio);
}
// The speaker pauses while it plays and otherwise continues from the line it stopped at; "From the start"
// (fromStart) plays every line again.
// Plays only the line last heard, then waits paused after it.
function replayLine() {
  const view = shownView();
  if (!view?.audio?.length) return;
  const key = `${streamId}:${view.key}`;
  const line = clipRun?.key === key ? clipRun.heard : clipSpot?.key === key ? clipSpot.heard : null;
  if (line === null || line === undefined) return;
  audioBlocked = false; heardKey = key;
  playClips(view.audio, line, line + 1);
}
function toggleClips(fromStart = false) {
  const view = shownView();
  if (!view?.audio?.length) return;
  const key = `${streamId}:${view.key}`;
  audioBlocked = false; heardKey = key;
  if (!fromStart && clipRun?.key === key) { stopAudio(); return; }
  playClips(view.audio, !fromStart && clipSpot?.key === key ? Math.min(clipSpot.index, view.audio.length - 1) : 0);
}
// Tapping a French word shows its meaning; before answering in Read that counts as help. In grammar it is free:
// the question tests the grammar, not the words around it.
function lookupGloss(fr) {
  const entry = glossFor(fr);
  if (!entry) return;
  glossWord = entry; addStatus = '';
  renderGlossSheet();
  if (screen === 'story' && storyView && !storyView.read) storyTaps.add(fr);
  if (grammarOnScreen() || screen === 'lyrics' || screen === 'news-edition' || screen === 'story' || screen === 'sentences') return;
  const view = streamState?.current;
  if (!view || streamState.result || view.mode !== 'read' || (streamState.lookups || []).includes(fr)) return;
  // The lookup is saved behind, before the answer that it makes a helped one.
  applyStream({ ...streamState, lookups: [...(streamState.lookups || []), fr] });
  saveBehind({ kind: 'lookup', key: view.key, extra: { fr }, requestId: requestId() });
}
function renderGlossSheet() {
  const entry = glossWord;
  if (!entry) return;
  const add = entry.word
    ? (addStatus ? `<p class="gloss-status" role="status">${esc(addStatus)}</p>` : `<button class="secondary gloss-add" data-action="add-word" ${busy ? 'disabled' : ''}>Add to my words</button>`)
    : '';
  const gender = genders[entry.word] ?? entry.gender;
  const extra = `${gender ? `<p class="gloss-gender${genderClass(gender)}">${gender} noun</p>` : ''}${entry.base ? `<p class="gloss-base">from <span lang="${languageTag}">${frEsc(entry.base)}</span></p>` : ''}${entry.note ? `<p class="gloss-note">${esc(entry.note)}</p>` : ''}`;
  openDialog(entry.fr, `<p class="gloss-en">${esc(entry.en)}</p>${extra}${add}<button class="primary dialog-action" data-action="close-dialog">Close</button>`, 'gloss');
}
async function addWord() {
  const entry = glossWord;
  if (!entry?.word || busy) return;
  busy = true; addStatus = 'Adding…'; renderGlossSheet();
  try {
    const result = await api('api/vocabulary/add', { method: 'POST', body: JSON.stringify({ wordId: entry.word, requestId: requestId() }) });
    addStatus = ({ added: 'Added to your words.', 'already-practising': 'Already in your practice.', 'made-due': 'Due again now.' })[result.status] || 'Added to your words.';
  } catch (error) { addStatus = error.message; }
  busy = false; renderGlossSheet(); announce(addStatus); render();
}
function applyReview(next, preserveDraft = false) {
  const key = next.session?.current ? `${next.session.id}:${next.session.current.exercise.id}` : '';
  if (!preserveDraft || key !== draftKey || next.session?.current?.settled) {
    draft = next.session?.current?.answer || '';
    tokenOrder = [...(next.session?.current?.tokenOrder || [])];
  }
  draftKey = key; review = next;
}
// Practise and a mistake group both run a grammar round quietly: a finished round is replaced, never scored.
async function loadReview(token) {
  const key = mixedScope();
  if (!key) { review = null; return; }
  try {
    // A Next still on its way lands first, so the round is read after it.
    await reviewSaving;
    let snap = await api(`api/grammar/state?scope=${encodeURIComponent(key)}`);
    if (!snap.session || snap.session.complete) snap = await api('api/grammar/session', { method: 'POST', body: JSON.stringify({ scope: key, requestId: requestId() }) });
    if (token === mixedGeneration) applyReview(snap);
  } catch (error) {
    // 409 means there is nothing to review yet, so Practise simply leaves grammar out.
    if (error.status !== 409) throw error;
  }
}
function reviewMutation(type, body) {
  const key = mixedScope();
  if (type === 'next' && review.session.following) { reviewNextAhead(body, key); return; }
  const paths = { answer: 'api/grammar/answer', help: 'api/grammar/help', next: 'api/grammar/next' };
  runAction(async () => {
    // A Next still on its way carries the version this step needs; a step on a question the Mac has not reached is refused.
    if (reviewSaving) {
      await reviewSaving;
      const session = review?.session;
      if (session?.id !== body.sessionId || session.current?.exercise.id !== body.exerciseId) throw Object.assign(new Error('This question changed.'), { status: 409 });
      body = { ...body, version: session.version };
    }
    let snap = await api(paths[type], { method: 'POST', body: JSON.stringify(body) });
    if (snap.session?.complete) snap = await api('api/grammar/session', { method: 'POST', body: JSON.stringify({ scope: key, requestId: requestId() }) });
    applyReview(snap, type === 'help');
    if (body.kind === 'hint') hintOpen = true;
    if (type === 'next') { hintOpen = true; advanceMixed(); }
    const current = review.session?.current;
    if (current?.feedback) announce(current.feedback.message);
  }, () => reviewRefreshed(mixedGeneration));
}
async function reviewRefreshed(token) {
  try { await loadReview(token); notice = { kind: 'info', message: 'This question was refreshed. Answer the one shown now.' }; }
  catch (error) { notice = { message: error.message }; }
  render();
}
// Practise moves on at once when the round's next exercise is known (GrammarSession.following): Next is saved behind,
// and the Mac's reply replaces the exercise held for the round's next turn only if it differs.
function reviewNextAhead(body, key) {
  const token = mixedGeneration;
  const session = review.session;
  applyReview({ ...review, session: { ...session, index: session.index + 1, current: session.following, following: null } });
  hintOpen = true; stopAudio(); advanceMixed(); render(); main.focus({ preventScroll: true });
  const run = async () => {
    let snap = await api('api/grammar/next', { method: 'POST', body: JSON.stringify(body) });
    if (snap.session?.complete) snap = await api('api/grammar/session', { method: 'POST', body: JSON.stringify({ scope: key, requestId: requestId() }) });
    if (token !== mixedGeneration) return;
    const shown = review?.session?.current?.exercise.id;
    applyReview(snap, true);
    if (mixedSource === 'grammar' && snap.session?.current?.exercise.id !== shown) render();
  };
  const saving = run().catch(async (error) => {
    // Let go first: reading the round again waits on reviewSaving.
    if (reviewSaving === saving) reviewSaving = null;
    if (token !== mixedGeneration) return;
    if (error.status === 409) { await reviewRefreshed(token); return; }
    notice = { message: error.message }; retryAction = { type: 'redo', run }; render();
  }).finally(() => { if (reviewSaving === saving) reviewSaving = null; });
  reviewSaving = saving;
}
async function enterMixed() {
  const token = ++mixedGeneration;
  ++streamGeneration;
  const focus = screen === 'focus';
  streamState = null; review = null; audioBlocked = false;
  mixedSource = ''; mixedStep = -1; loading = true; notice = null; retryAction = null;
  render();
  if (focus && !mistakeGroup() && !await loadMistakes(true)) return;
  if (token !== mixedGeneration) return;
  if (focus && !mistakeGroup()) { loading = false; render(); return; }
  streamId = mixedStream();
  const sources = mixedSources();
  const problems = [];
  const guard = (promise) => promise.catch((error) => { problems.push(error.message); });
  const jobs = [];
  // What is still on its way to the Mac lands first, so Practise opens on the Mac's state after it.
  if (sources.includes('comprehension') && streamId) {
    jobs.push(guard(streamSettled(streamId).then(() => api(`api/comprehension/state?stream=${encodeURIComponent(streamId)}`)).then((state) => { if (token === mixedGeneration) applyStream(state); })));
  }
  if (sources.includes('vocabulary')) {
    jobs.push(guard((async () => {
      await gradesSettled();
      let state = await api(`api/state?direction=${encodeURIComponent(direction)}&deck=${encodeURIComponent(deck)}`);
      if (!state.current) state = await api('api/session', { method: 'POST', body: JSON.stringify({ direction, deck }) });
      if (token === mixedGeneration) applySnapshot(state);
    })()));
  }
  if (sources.includes('grammar')) jobs.push(guard(loadReview(token)));
  // Write it starts writing its sentences when asked for them; Practise doesn't wait on that.
  if (sources.includes('write')) jobs.push(api('api/write').then((view) => { if (token === mixedGeneration) writeView = view; }).catch(() => {}));
  await Promise.all(jobs);
  if (token !== mixedGeneration) return;
  loading = false;
  advanceMixed(true);
  if (!mixedSource && problems.length) { notice = { message: problems[0] }; retryAction = { type: 'mixed' }; }
  render();
}
async function fetchState(message = '') {
  const token = ++generation; loading = true;
  if (!retryAction?.body) { notice = message ? { kind: 'info', message } : null; retryAction = null; }
  render();
  try {
    const result = await api(`api/state?direction=${encodeURIComponent(direction)}&deck=${encodeURIComponent(deck)}`);
    if (token !== generation) return false;
    applySnapshot(result); loading = false; render(); return true;
  } catch (error) {
    if (token !== generation) return false;
    loading = false;
    if (!retryAction?.body) { notice = { message: error.message }; retryAction = { type: 'state', message }; }
    render(); return false;
  }
}
// Loads whatever the current grammar screen shows: the course, one topic, or one scope's session.
async function loadGrammar(message = '', preserveDraft = false) {
  const token = ++generation; loading = true;
  const target = screen;
  const key = target === 'topic' ? topicId : target === 'exercise' ? scope : '';
  if (!retryAction?.body) { notice = message ? { kind: 'info', message } : null; retryAction = null; }
  render();
  try {
    const result = await api(key ? `api/grammar/state?scope=${encodeURIComponent(key)}` : 'api/grammar');
    if (token !== generation) return false;
    if (target === 'topic') topicPage = result.topic;
    else if (target === 'exercise') applyGrammar(result, preserveDraft);
    else units = result.units;
    loading = false; render(); return true;
  } catch (error) {
    if (token !== generation) return false;
    loading = false;
    if (!retryAction?.body) { notice = { message: error.message }; retryAction = { type: 'grammar-state', place: place(), message, preserveDraft }; }
    render(); return false;
  }
}
function grammarAnnouncement() {
  const session = grammar.session; const current = session?.current; const feedback = current?.feedback;
  const test = session?.mode === 'test';
  if (feedback) return `${test && current.settled ? (feedback.kind === 'correct' ? 'That’s right. ' : `Not quite. The answer: ${feedback.answer}. `) : ''}${feedback.message}`;
  if (session?.complete) return test ? `Test complete: ${session.score} out of ${session.total}. Your score is saved.` : 'Round complete. Your progress is saved.';
  return test ? 'Your test is saved.' : 'Your round is saved.';
}
async function runMutation(action) {
  if (busy) return;
  stopAudio(); busy = true; loading = false; ++generation;
  notice = null; retryAction = null;
  const grammarAction = action.type.startsWith('grammar-');
  const target = grammarAction ? `exercise|${action.scope}` : 'practice';
  if (target !== place()) record(target);
  if (grammarAction) enterScope(action.scope);
  screen = grammarAction ? 'exercise' : 'practice'; render();
  const paths = { start: 'api/session', grade: 'api/grade', undo: 'api/undo', 'extra-words': 'api/extra-words', 'review-early': 'api/review-early', 'grammar-start': 'api/grammar/session', 'grammar-answer': 'api/grammar/answer', 'grammar-help': 'api/grammar/help', 'grammar-next': 'api/grammar/next' }
  try {
    const result = await api(paths[action.type], { method: 'POST', body: JSON.stringify(action.body), ...(action.type === 'grade' ? { limit: GRADE_LIMIT } : {}) });
    if (grammarAction) {
      applyGrammar(result, action.type === 'grammar-help');
      if (action.body.kind === 'hint') hintOpen = true;
    } else applySnapshot(result);
    busy = false; render();
    if (action.body.kind === 'rule') showRule();
    else if (action.type === 'grammar-answer' && !grammar.session.current?.settled) (document.querySelector('#answer') || main.querySelector('.choice:not(:disabled)'))?.focus({ preventScroll: true });
    else main.focus({ preventScroll: true });
    announce(grammarAction ? grammarAnnouncement() : result.current ? `${action.type === 'undo' ? 'Last answer undone. ' : ''}${direction === 'en-fr' ? result.current.en : result.current.fr}` : 'Practice complete. Your progress is saved.');
  } catch (error) {
    busy = false;
    if (error.status === 409) {
      if (grammarAction) await loadGrammar(`${error.message} This screen was refreshed. Review the current question before answering.`, true);
      else await fetchState(`${error.message} Your progress was refreshed. Reveal the current card again before answering.`);
    } else { notice = { message: error.message }; retryAction = action; render(); }
  }
}
// forward: an action that opens a screen (start practice, a topic, the word list) never walks back through history.
function move(next, forward = false) {
  if (busy) return false;
  if (next !== place()) {
    // Home and any place already behind this one are reached by walking back, so history holds no duplicate copies.
    const behind = forward || !depth ? -1 : trail.lastIndexOf(next, depth - 1);
    if (behind >= 0) { history.go(behind - depth); return false; }
    record(next);
  }
  show(next);
  return true;
}
function show(next) {
  stopAudio(); ++generation; ++browseGeneration; ++streamGeneration; ++mixedGeneration; loading = false; revealed = false;
  const [name, arg = ''] = next.split('|');
  if (name === 'topic') topicId = arg;
  else if (name === 'exercise') enterScope(arg);
  else if (name === 'focus') focusId = arg;
  else if (name === 'sound') { soundId = arg; soundRound = null; }
  else if (name === 'verbs-tense' && arg !== verbTensePage) { verbTensePage = arg; verbTenseView = null; }
  else if (name === 'verbs-verb' && arg !== verbPageId) { verbPageId = arg; verbPageView = null; }
  else if (name === 'story') storyNumber = Number(arg) || 0;
  else if ((name === 'song' || name === 'lyrics') && arg !== songId) { songId = arg; songView = null; songLyrics = null; }
  else if (name === 'news-edition' && arg !== newsDate) { newsDate = arg; newsView = null; }
  if (name !== 'news' && name !== 'news-edition') clearTimeout(newsPoll);
  // Leaving an edition pauses it where it is; coming back plays on from there.
  if (name !== 'news-edition' && !newsAudio.paused) newsAudio.pause();
  if (name !== 'lyrics') clearTimeout(lyricsPoll);
  if (name !== 'story') clearTimeout(storyPoll);
  if (name !== 'verbs') clearTimeout(verbsPoll);
  // Leaving the Radio pauses it where it is; coming back plays on from there.
  if (name !== 'statistics') { stopStatsPlay(); stopVerbPlay(); }
  if (name !== 'radio') { clearTimeout(radioPoll); if (!radioAudio.paused) radioAudio.pause(); }
  if (name !== 'mix' && name !== 'focus') { mixedSource = ''; review = null; }
  if (name !== 'listen' && name !== 'read' && name !== 'mix' && name !== 'focus') { streamState = null; streamId = ''; }
  // Leaving a tape stops it; another tape, or coming back, winds a new one.
  if (name !== screen && walkmanAudio.src) {
    ++walkmanGeneration; walkmanAudio.pause(); walkmanAudio.removeAttribute('src'); walkmanAudio.load();
    walkman = { tape: null, index: -1, meaning: false, loading: false, started: false, logged: new Set() };
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  }
  if (!tapeScreen(name)) { heardOpen = false; heardSaying = ''; heardResume = false; }
  // Leaving the cards lets go of the microphone; moving between Cards and Endless keeps it.
  if (name !== 'practice') stopSay();
  if (name === 'home') homeInfo.at = 0;
  screen = name; render(); window.scrollTo(0, 0); main.focus({ preventScroll: true });
  if (name === 'home') fetchState();
}
async function startPractice() {
  if (busy) return;
  move('practice', true);
  await beginPractice();
}
// The cards on screen: a fresh daily session, or Endless choosing its first word.
async function beginPractice() {
  // Answers still on their way land first, so the cards start again from the Mac's state after them.
  if (grades) { loading = true; render(); await gradesSettled(); }
  if (locked()) return;
  if (!await fetchState()) return;
  if (vocabMode === 'endless') { if (screen === 'practice') { endless = null; render(); } return; }
  if (screen === 'practice') runMutation({ type: 'start', body: { direction, deck } });
}
// Settles once the answers given ahead are saved; a chain a failure stopped is sent again first.
function gradesSettled() {
  if (grades?.failed) resumeGrades();
  return pendingGrade ?? Promise.resolve();
}
// Words opens on a tab: the one asked for, or the one used last. Switching tabs takes the old tab's place in
// history, so Back leaves the room; 'back' walks back to the tab already behind (from Your words).
function openWords(tab = wordsTab, how = 'forward', autoplay = false) {
  if (busy) return;
  if (!(tab in WORDS_TABS)) tab = 'cards';
  wordsTab = tab; savePreference('echo.words-tab', tab);
  if (tab === 'cards' || tab === 'endless') {
    const mode = tab === 'endless' ? 'endless' : 'daily';
    if (mode !== vocabMode) { vocabMode = mode; savePreference('echo.vocab-mode', mode); endless = null; revealed = false; }
  }
  const next = tab === 'walkman' || tab === 'songs' || tab === 'board' ? tab : 'practice';
  if (how === 'switch') switchPlace(next);
  else if (!move(next, how === 'forward')) return;
  if (next === 'practice') beginPractice(); else if (next === 'walkman') loadTape(autoplay); else if (next === 'board') loadBoard(); else loadSongs();
}
// Listen opens on a tab the same way: Questions, Sounds or the sentence tape.
function openListen(tab = listenTab, how = 'forward') {
  if (busy) return;
  if (!(tab in LISTEN_TABS)) tab = 'listen';
  listenTab = tab; savePreference('echo.listen-tab', tab);
  if (how === 'switch') switchPlace(tab);
  else if (!move(tab, how === 'forward')) return;
  if (tab === 'listen') enterStream(); else if (tab === 'sounds') loadSounds(); else if (tab === 'news') loadNews(); else loadTape();
}
// A tab of the same room replaces the current place in history rather than adding one.
function switchPlace(next) {
  if (next !== place()) { trail[depth] = next; history.replaceState({ echo: next, depth }, ''); }
  show(next);
}
// A new direction or category: the cards start again on it; Your words lists it; other tabs just redraw.
function wordsOptionChanged() {
  if (screen === 'practice') beginPractice();
  else if (screen === 'browse') enterBrowse();
  else if (screen === 'board') loadBoard();
  else render();
}
// A tape from Home's Hands-free shelf or the Verbs page; the words tape is the Walkman tab of Words.
function openTape(name) {
  if (name === 'walkman') openWords('walkman');
  else if (name === 'listen-tape') openListen('listen-tape');
  else if (move(name, true)) loadTape();
}
function shownCard() { return endlessMode() ? endless?.cards[0] ?? null : snapshot?.current ?? null; }
function vocabularyCard() { return !!shownCard() && (screen === 'practice' || (mixed() && mixedSource === 'vocabulary')); }
// Read · Listen · Speak, under the card. Speak opens the microphone inside this tap, as iPhone requires; the
// others close it.
function choosePracticeWay(way) {
  if (way === practiceWay || !['read', 'listen', 'speak'].includes(way)) return;
  practiceWay = way; savePreference('echo.way', way);
  heardCard = ''; stopAudio();
  if (sayHere()) { startSay(); return; }
  say.fix = null; say.error = '';
  stopSay(); render();
}
function reveal() {
  if (!vocabularyCard() || revealed || locked() || loading) return;
  // With Say on and not yet listening (iPhone opens the microphone only on a tap), the tap starts it instead.
  if (sayHere() && !say.running) { startSay(); return; }
  revealed = true; saySkip?.(); render(); document.querySelector('#flashcard')?.focus({ preventScroll: true });
  const card = shownCard();
  announce(`Answer: ${direction === 'en-fr' ? card.fr : card.en}.`);
  // Listen and Speak already said the word when the card appeared; turning it only shows the answer.
  if (audioMode && wayNow() === 'read') playFrench(card.audioUrl);
}
function grade(known) {
  if (!revealed || locked() || loading || !vocabularyCard()) return;
  // "I said it right" is for the last answer only: answering another card withdraws it.
  if (say.fix && say.fix.state !== 'sending' && say.fix.wordId !== shownCard()?.id) say.fix = null;
  if (endlessMode()) { markEndless(known); return; }
  // An answer already waits for the card after it; this tap has no card of its own until the Mac replies.
  if (queuedGrade !== null) return;
  const card = snapshot.current;
  const body = { direction, deck, wordId: card.id, version: card.version, known, requestId: requestId() };
  const following = grades ? predictedCard(grades.confirmed, [...grades.answers, { body }]) : snapshot.next;
  // Practise moves on to its other sources even when no card is known to follow.
  if (following || mixed()) answerAhead(body);
  else if (grades) { queuedGrade = known; savingSlow = true; refreshPracticeChrome(); }
  else runMutation({ type: 'grade', body });
}
// The card a snapshot predicts after the given answers to its current card and those after it (Snapshot.ahead); null
// past what it predicts.
function predictedCard(confirmed, answers, at = answers.length) {
  const how = (index) => (answers[index].body.known ? 'known' : 'missed');
  if (at === 0) return confirmed.current;
  if (at === 1) return confirmed.next;
  if (at === 2) return confirmed.ahead?.[how(0)]?.card ?? null;
  if (at === 3) return confirmed.ahead?.[how(0)]?.after?.[how(1)] ?? null;
  return null;
}
function gradesView(chain) {
  return { ...chain.confirmed, current: predictedCard(chain.confirmed, chain.answers), next: predictedCard(chain.confirmed, chain.answers, chain.answers.length + 1), undoId: null };
}
const onGradeScreen = (chain) => (chain.where === 'mixed' ? mixed() : screen === 'practice' && !endlessMode());
// Shows the predicted next card at once and saves the answer behind it, after any still on their way. The Mac's
// reply replaces the prediction only when it differs; if an answer could not be saved, its card comes back to retry.
function answerAhead(body) {
  if (!grades) {
    grades = { confirmed: snapshot, answers: [], where: mixed() ? 'mixed' : 'practice', sending: false, failed: false, settle: null };
    pendingGrade = new Promise((resolve) => { grades.settle = resolve; });
  }
  grades.answers.push({ body });
  keepSaves();
  stopAudio();
  snapshot = gradesView(grades);
  revealed = false; notice = null; retryAction = null;
  if (grades.where === 'mixed') advanceMixed();
  render(); main.focus({ preventScroll: true });
  if (vocabularyCard()) announce(direction === 'en-fr' ? snapshot.current.en : snapshot.current.fr);
  warmClip(snapshot.next?.audioUrl);
  saveGrades();
}
function saveGrades() {
  const chain = grades;
  if (!chain || chain.sending || chain.failed || !chain.answers.length) return;
  chain.sending = true;
  const { body } = chain.answers[0];
  // An answer is saved in well under a second; one that takes longer says so, and one that takes over GRADE_LIMIT
  // is retried by itself with the same request id, so it cannot count twice.
  const slow = setTimeout(() => {
    if (grades !== chain) return;
    savingSlow = true;
    if (screen === 'practice') refreshPracticeChrome(); else refreshSavingStatus();
  }, SLOW_SAVE);
  api('api/grade', { method: 'POST', body: JSON.stringify(body), limit: GRADE_LIMIT }).then(async (reply) => {
    clearTimeout(slow); chain.sending = false;
    if (grades !== chain) return;
    chain.answers.shift();
    keepSaves();
    let result = reply;
    // The daily allowance may have run out; Practise then carries on with its other sources.
    if (chain.where === 'mixed' && !result.current && !chain.answers.length) {
      try { result = await api('api/session', { method: 'POST', body: JSON.stringify({ direction: body.direction, deck: body.deck }) }); } catch { /* nothing left today */ }
    }
    chain.confirmed = result;
    const following = chain.answers[0];
    if (following && !(result.current?.id === following.body.wordId && result.current.version === following.body.version)) { gradesMoved(chain, result); return; }
    if (chain.answers.length) saveGrades(); else endGrades(chain);
    const view = chain.answers.length ? gradesView(chain) : result;
    const shown = snapshot?.current;
    if (!onGradeScreen(chain)) return;
    if (view.current && shown && view.current.id === shown.id && view.current.version === shown.version) {
      // The card on screen was the right guess: only the counts and Undo change. Redrawing the card here would
      // replace it under a finger that may already be on it, and a tap whose target is replaced mid-tap can be lost.
      snapshot = view;
      if (chain.where === 'practice') refreshPracticeChrome(); else refreshSavingStatus();
      if (queuedGrade !== null) { const known = queuedGrade; queuedGrade = null; grade(known); }
      return;
    }
    if (chain.where === 'mixed' && mixedSource !== 'vocabulary') { snapshot = view; refreshSavingStatus(); return; }
    if (queuedGrade !== null) { queuedGrade = null; notice = { kind: 'info', message: 'Your Mac had a different card next, so your last answer was not counted. Answer this one.' }; }
    applySnapshot(view); render();
  }, async (error) => {
    clearTimeout(slow); chain.sending = false;
    if (grades !== chain) return;
    queuedGrade = null;
    if (error.status === 409) {
      endGrades(chain);
      if (onGradeScreen(chain) && chain.where === 'practice') { await fetchState(`${error.message} Your progress was refreshed. Reveal the current card again before answering.`); return; }
      notice = { message: error.message };
      api(`api/state?direction=${encodeURIComponent(body.direction)}&deck=${encodeURIComponent(body.deck)}`).then((state) => { if (!grades) snapshot = state; }).catch(() => {});
    } else {
      chain.failed = true; savingSlow = false;
      if (onGradeScreen(chain) && chain.where === 'practice' && chain.confirmed) { snapshot = { ...chain.confirmed, undoId: null }; revealed = true; stopAudio(); }
      notice = { message: error.message }; retryAction = { type: 'grades', body };
    }
    if (screen === 'practice' || mixed()) render();
  });
}
// The Mac's card is not the one the next answer was given on, so that answer and those after it were given on a wrong
// guess: they are not saved, and the Mac's card shows with a note saying how many were not counted.
function gradesMoved(chain, result) {
  const lost = chain.answers.length + (queuedGrade !== null ? 1 : 0);
  queuedGrade = null;
  endGrades(chain);
  if (!onGradeScreen(chain) || (chain.where === 'mixed' && mixedSource !== 'vocabulary')) { snapshot = result; return; }
  applySnapshot(result);
  notice = { kind: 'info', message: `Your Mac had a different card next, so your last ${lost === 1 ? 'answer was' : `${lost} answers were`} not counted. Carry on from this card.` };
  render();
}
function endGrades(chain) {
  if (grades !== chain) return;
  grades = null; pendingGrade = null; savingSlow = false;
  keepSaves();
  chain.settle();
}
// Retry: the answer that failed goes again with its request id, then those given after it.
function resumeGrades() {
  const chain = grades;
  notice = null; retryAction = null;
  if (chain) {
    chain.failed = false;
    if (onGradeScreen(chain) && chain.where === 'practice' && chain.confirmed) { snapshot = gradesView(chain); revealed = false; }
  }
  render();
  saveGrades();
}
// The counts line and Undo under the card, brought up to date without redrawing the card itself.
function refreshPracticeChrome() {
  main.querySelector('.practice > .compact-line')?.replaceWith(document.createRange().createContextualFragment(workingCounts(categoryTitle(deck))));
  const undo = main.querySelector('.study-tools [data-action=undo]');
  if (undo) undo.disabled = !snapshot.undoId || locked();
  warmClip(snapshot.next?.audioUrl);
}
function undo() {
  if (endlessMode()) { undoEndless(); return; }
  if (!snapshot?.undoId || locked()) return;
  const body = { direction, deck, undoId: snapshot.undoId };
  if (mixed()) runAction(async () => { applySnapshot(await api('api/undo', { method: 'POST', body: JSON.stringify(body) })); });
  else runMutation({ type: 'undo', body });
}
// ── Endless ──
// A fresh stream for the current direction and category. Each word is fetched while two wait ahead, so a card
// answered shows the next at once; the server picks it with the latest scores, passing over the words just seen.
function startEndless() {
  endless = { direction, deck, cards: [], pool: 0, recent: [], last: null, fetching: false, serial: 0 };
  revealed = false;
  fillEndless();
}
async function fillEndless() {
  const stream = endless;
  if (!stream || stream.fetching || stream.cards.length >= ENDLESS_AHEAD) return;
  stream.fetching = true;
  const exclude = [...stream.cards.map((card) => card.id).reverse(), ...stream.recent].slice(0, ENDLESS_GAP);
  try {
    const { card, pool } = await api('api/endless/next', { method: 'POST', body: JSON.stringify({ direction: stream.direction, deck: stream.deck, exclude }) });
    if (endless !== stream) return;
    stream.pool = pool; stream.fetching = false;
    if (retryAction?.type === 'endless') { retryAction = null; notice = null; }
    const first = !stream.cards.length;
    if (card) stream.cards.push({ ...card, serial: ++stream.serial });
    if (first && screen === 'practice') render();
    if (card) fillEndless();
  } catch (error) {
    if (endless !== stream) return;
    stream.fetching = false;
    notice = { message: error.message }; retryAction = { type: 'endless' };
    if (screen === 'practice') render();
  }
}
function markEndless(known) {
  const stream = endless;
  const card = stream?.cards.shift();
  if (!card) return;
  const markId = requestId();
  stream.recent = [card.id, ...stream.recent.filter((id) => id !== card.id)].slice(0, ENDLESS_GAP);
  const last = stream.last = { requestId: markId, card, saved: null };
  revealed = false; stopAudio(); notice = null;
  render(); main.focus({ preventScroll: true });
  if (stream.cards[0]) announce(direction === 'en-fr' ? stream.cards[0].en : stream.cards[0].fr);
  // saved: Say's "I said it right" replaces this mark only once it is stored.
  last.saved = api('api/endless/mark', { method: 'POST', body: JSON.stringify({ requestId: markId, direction: stream.direction, wordId: card.id, known }) })
    .catch((error) => { if (endless === stream) { notice = { message: `This answer was not saved: ${error.message}` }; if (stream.last?.requestId === markId) stream.last = null; if (screen === 'practice') render(); } })
    // The next words are chosen once this answer counts, so a word just missed is likelier to come back.
    .finally(() => fillEndless());
}
// Takes the last answer back and shows that word again, to answer afresh.
async function undoEndless() {
  const stream = endless;
  const last = stream?.last;
  if (!last || busy) return;
  busy = true; render();
  try {
    await api('api/endless/undo', { method: 'POST', body: JSON.stringify({ requestId: last.requestId }) });
    if (endless === stream) {
      stream.cards.unshift({ ...last.card, serial: ++stream.serial });
      stream.recent = stream.recent.filter((id) => id !== last.card.id);
      stream.last = null; revealed = false;
    }
  } catch (error) { notice = { message: error.message }; }
  busy = false;
  if (screen === 'practice') render();
}
function browseWords() {
  if (move('browse', true)) enterBrowse();
}
async function enterBrowse() {
  if (!snapshot && !await fetchState()) return;
  if (screen === 'browse') loadBrowse();
}
async function loadBrowse() {
  const token = ++browseGeneration; browseLoading = true; browseError = ''; renderBrowse();
  try {
    const result = await api(`api/words?direction=${encodeURIComponent(direction)}&deck=all`);
    if (token !== browseGeneration || screen !== 'browse') return;
    words = result.words; browseLoading = false; renderBrowseResults();
  } catch (error) {
    if (token !== browseGeneration || screen !== 'browse') return;
    browseLoading = false; browseError = error.message; renderBrowseResults();
  }
}
function openTopic(id) {
  if (locked()) return;
  if (topicPage?.id !== id) topicPage = null;
  if (move(`topic|${id}`, true)) loadGrammar();
}
function startScope(key) {
  if (locked() || !key) return;
  hintOpen = true;
  runMutation({ type: 'grammar-start', scope: key, body: { scope: key, requestId: requestId() } });
}
function activeGrammar() { return mixed() && mixedSource === 'grammar' ? review : grammar; }
function grammarOnScreen() { return screen === 'exercise' || (mixed() && mixedSource === 'grammar'); }
function grammarMutation(type, extra = {}) {
  const snap = activeGrammar(); const session = snap?.session; const current = session?.current;
  if (locked() || !current || session.complete) return;
  if (type === 'answer' && current.settled || type === 'next' && !current.settled) return;
  const body = { sessionId: session.id, exerciseId: current.exercise.id, version: session.version, requestId: requestId(), ...extra };
  if (snap === review) reviewMutation(type, body);
  else runMutation({ type: `grammar-${type}`, scope, body });
}
function checkAnswer() {
  const current = activeGrammar()?.session?.current; if (!current || current.settled || current.exercise.type === 'choose') return;
  if (current.exercise.type === 'build' ? !tokenOrder.length : !draft.trim()) { announce('Write an answer first.'); document.querySelector('#answer')?.focus(); return; }
  grammarMutation('answer', { answer: draft, ...(current.exercise.type === 'build' ? { tokenOrder: [...tokenOrder] } : {}) });
}
// A tap on an option is the check: in practice a wrong pick stays marked and the others remain; in a test it settles.
function pickOption(option) {
  const current = activeGrammar()?.session?.current;
  if (!current || current.settled || current.exercise.type !== 'choose' || current.misses.includes(option)) return;
  draft = option;
  grammarMutation('answer', { answer: option });
}
function openDialog(title, body, kind) {
  stopAudio(); dialog.dataset.kind = kind;
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="icon" data-action="close-dialog" aria-label="Close">×</button></div>${body}`;
  if (!dialog.open) dialog.showModal();
}
// The rule opens at the section that teaches the question on screen.
function showRule() {
  const topic = grammar.topic;
  if (!topic?.guide) return;
  const focus = topic.patterns?.[grammar.session?.current?.exercise.pattern]?.section || '';
  openDialog(topic.title, `<div class="dialog-copy">${guideHTML(topic.guide, focus)}</div><button class="primary dialog-action" data-action="close-dialog">Back to the sentence</button>`, 'rule');
  dialog.querySelector('.guide-section.focus')?.scrollIntoView({ block: 'start' });
}
// Words options: what the cards follow. Daily and Endless are tabs; extra words, early reviews and songs are in Your words.
function openOptions() {
  if (!snapshot) return;
  const disabled = locked() ? 'disabled' : '';
  openDialog('Words options', `<p class="settings-label">Direction</p><div class="segmented" role="group" aria-label="Practice direction"><button data-direction="fr-en" aria-pressed="${direction === 'fr-en'}" ${disabled}>${languageEnglish} → English</button><button data-direction="en-fr" aria-pressed="${direction === 'en-fr'}" ${disabled}>English → ${languageEnglish}</button></div><div class="dialog-row"><label for="deck-select">Category</label><select id="deck-select" ${disabled}>${optionsHTML(deck)}</select></div><div class="dialog-row"><label for="audio-speed">Pronunciation speed</label><select id="audio-speed"><option value="1" ${speed === 1 ? 'selected' : ''}>Normal</option><option value="0.8" ${speed === 0.8 ? 'selected' : ''}>Slower</option></select></div><div class="dialog-row"><span>Say the ${languageEnglish} when a card turns<small class="dialog-note">When you Read, practise English → ${languageEnglish}, or tap a tile on Board</small></span><button class="secondary" data-action="turn-sound" aria-pressed="${audioMode}">${audioMode ? 'On' : 'Off'}</button></div><div class="dialog-row"><span>Colour nouns by gender<small class="gender-key">${LANGUAGE_GENDERS.map((gender) => `<span class="${GENDERS[gender][0]}">${GENDERS[gender][1]}</span>`).join(' · ')}</small></span><button class="secondary" data-action="gender-colours" aria-pressed="${genderColours}">${genderColours ? 'On' : 'Off'}</button></div><button class="dialog-row dialog-link" data-action="board-options"><span>Board<small class="dialog-note">${esc(boardRangeLabel())} · ${boardCards ? 'words in Cards' : 'every word'}</small></span><span aria-hidden="true">›</span></button><form id="goal-form" novalidate><div class="goal-row"><label for="daily-goal">New words / day<br><small>in each direction</small></label><input id="daily-goal" name="newPerDay" type="number" inputmode="numeric" min="0" max="${totalWords()}" step="1" value="${snapshot.settings.newPerDay}" aria-describedby="goal-help goal-feedback" ${disabled}><button class="secondary" type="submit" ${disabled}>Save</button></div><p id="goal-help" class="caption">Shared across categories. Resets at 04:00 on your Mac. Set 0 to pause new words; due reviews are not capped.</p><div id="goal-feedback" class="caption" role="status"></div></form><div class="options-links"><button class="quiet" data-action="about">How it works</button><a href="api/export" download="echo-progress.json">Download my progress ↓</a></div><button class="primary dialog-action" data-action="close-dialog">Done</button>`, 'options');
}
// More for today (in Your words): extra new words for today, and finished words reviewed early.
function openMoreToday() {
  if (!snapshot) return;
  openDialog('More for today', `${extraPracticeHTML(false)}<button class="primary dialog-action" data-action="close-dialog">Done</button>`, 'more-today');
}
async function saveGoal(event) {
  event.preventDefault(); if (locked() || !snapshot) return;
  const input = document.querySelector('#daily-goal'); const feedback = document.querySelector('#goal-feedback');
  const raw = input.value.trim(); const value = Number(raw);
  if (raw === '' || !Number.isInteger(value) || value < 0 || value > totalWords()) {
    input.setAttribute('aria-invalid', 'true'); feedback.textContent = `Choose a whole number from 0 to ${totalWords()}. Use 0 to pause new words.`; input.focus(); return;
  }
  input.removeAttribute('aria-invalid'); busy = true; render();
  const controls = [...dialog.querySelectorAll('button,input,select')]; controls.forEach((control) => { control.disabled = true; });
  feedback.textContent = 'Saving…';
  try {
    const settings = await api('api/settings', { method: 'PUT', body: JSON.stringify({ newPerDay: value }) });
    snapshot.settings = settings; busy = false;
    await fetchState();
    feedback.textContent = `Saved: ${value} new words per day in each direction. Words already introduced today still count.`;
  } catch (error) { feedback.textContent = `${error.message} Press Save to retry.`; }
  finally { busy = false; controls.forEach((control) => { control.disabled = false; }); render(); }
}
function retry() {
  if (busy || !retryAction) return;
  const action = retryAction;
  if (action.type === 'grades') resumeGrades();
  else if (action.type === 'stream-saves') resumeStreamSaves();
  else if (action.type === 'sentence-saves') resumeSentenceSaves();
  else if (action.type === 'sentences') startSentences();
  else if (action.run) runAction(action.run);
  else if (action.body) runMutation(action);
  else if (action.type === 'grammar-state') { if (move(action.place)) loadGrammar(action.message, action.preserveDraft); }
  else if (action.type === 'stream') loadStream(action.stream, action.message);
  else if (action.type === 'mixed') enterMixed();
  else if (action.type === 'mistakes') loadMistakes();
  else if (action.type === 'friends') loadFriends();
  else if (action.type === 'walkman') loadTape();
  else if (action.type === 'statistics') loadStatistics();
  else if (action.type === 'sounds') loadSounds();
  else if (action.type === 'sound') startSoundRound();
  else if (action.type === 'verbs') loadVerbs();
  else if (action.type === 'verbs-forms') startVerbForms();
  else if (action.type === 'verbs-table') nextVerbTable();
  else if (action.type === 'endless') fillEndless();
  else if (action.type === 'verbs-ear') startVerbEar();
  else if (action.type === 'verbs-cards') startVerbCards();
  else if (action.type === 'verbs-rules') startRuleCards();
  else if (action.type === 'verbs-sentences') startVerbSentences();
  else if (action.type === 'verbs-tense') loadVerbTense();
  else if (action.type === 'verbs-verb') loadVerbPage();
  else if (action.type === 'story') loadStory();
  else if (action.type === 'radio') loadRadio();
  else if (action.type === 'news') loadNews();
  else if (action.type === 'news-edition') loadNewsEdition();
  else if (action.type === 'songs') loadSongs();
  else if (action.type === 'board') loadBoard();
  else if (action.type === 'song') loadSong();
  else fetchState(action.message);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button'); if (button?.disabled) return;
  const action = button?.dataset.action;
  if (button?.dataset.themeChoice) { const theme = button.dataset.themeChoice === 'paper' ? 'paper' : 'dusk'; savePreference('echo.theme', theme); applyTheme(theme); return; }
  if (button?.dataset.languageChoice) { openLanguage(button.dataset.languageChoice); return; }
  if (action === 'st-info') { toggleStatsTip(button); return; }
  if (!event.target.closest('.st-tip')) closeStatsTips();
  if (action === 'close-dialog') { if (!busy) dialog.close(); return; }
  if (action === 'turn-sound') {
    audioMode = !audioMode; savePreference('echo.audio-mode', audioMode ? 'on' : 'off');
    if (!audioMode) stopAudio(); else if (board && !boardClips.size) warmBoardClips(board.words, boardLoads);
    openOptions(); return;
  }
  if (action === 'practice-way') { choosePracticeWay(button.dataset.way); return; }
  if (action === 'replay') { const card = shownCard(); if (card) playFrench(card.audioUrl); return; }
  if (action === 'play-clips') { toggleClips(); return; }
  if (action === 'clips-restart') { toggleClips(true); return; }
  if (action === 'clips-line') { replayLine(); return; }
  if (action === 'grammar-audio') { const clip = activeGrammar()?.session?.current?.audio; if (clip) playFrench(clip); return; }
  if (button?.dataset.gloss !== undefined) { glossLine = button.closest('[data-line]')?.dataset.line ?? ''; lookupGloss(button.dataset.gloss); return; }
  if (action === 'add-word') { addWord(); return; }
  if (action === 'vb-accent') { insertAccent(button.dataset.letter); return; }
  if (!button && screen === 'verbs-cards' && event.target.closest('#vb-card')) { revealVerbCard(); return; }
  if (!button && screen === 'verbs-rules' && event.target.closest('#vb-card')) { revealRuleCard(); return; }
  if (!button && screen === 'verbs-sentences' && event.target.closest('#vb-sentence')) { revealVerbSentence(); return; }
  if (!button && screen === 'sentences' && event.target.closest('#sc-card')) { revealSentence(); return; }
  if (action === 'sc-play') { const card = scCard(); if (card?.audio) playFrench(card.audio); return; }
  if (action === 'sc-got' || action === 'sc-not') { markSentence(action === 'sc-got'); return; }
  if (action === 'sc-mode') { chooseSentenceMode(button.dataset.mode); return; }
  if (action === 'sc-options') { openSentenceOptions(); return; }
  if (action === 'sc-tense') { chooseSentenceTense(button.dataset.tense); return; }
  if (action === 'sc-topic') { chooseSentenceTopic(button.dataset.topic); return; }
  if (action === 'board-turn') { turnBoardTile(button); return; }
  if (action === 'board-shuffle') { shuffleBoard(); return; }
  if (action === 'board-cards') { toggleBoardCards(); return; }
  if (action === 'sc-topics-all') { chooseAllSentenceTopics(); return; }
  if (busy) return;
  if (action === 'verbs' || action?.startsWith('vb-')) { if (action === 'verbs' && screen === 'home') openVerbs(); else verbAction(action, button); return; }
  if (button?.dataset.direction) {
    if (locked() || direction === button.dataset.direction) return;
    direction = button.dataset.direction; savePreference('echo.direction', direction); dialog.close(); wordsOptionChanged(); return;
  }
  if (button?.dataset.playWord) { const word = words?.find((entry) => entry.id === button.dataset.playWord); if (word) playFrench(wordClipUrl(word.id)); return; }
  if (button?.dataset.revealWord) { revealBrowseWord(button.dataset.revealWord); return; }
  if (button?.dataset.topic) { openTopic(button.dataset.topic); return; }
  if (button?.dataset.group) { openGroup(button.dataset.group); return; }
  if (button?.dataset.pick !== undefined) { streamPick(button.dataset.pick); return; }
  if (button?.dataset.scope) { startScope(button.dataset.scope); return; }
  if (button?.dataset.choice !== undefined) { pickOption(button.dataset.choice); return; }
  if (button?.dataset.token !== undefined || button?.dataset.removeToken !== undefined) {
    if (locked() || activeGrammar()?.session?.current?.settled) return;
    if (button.dataset.token !== undefined) tokenOrder.push(Number(button.dataset.token)); else tokenOrder = tokenOrder.filter((index) => index !== Number(button.dataset.removeToken));
    render();
    const nextToken = main.querySelector('[data-token]:not(:disabled)') || main.querySelector('[data-remove-token]:not(:disabled)');
    nextToken?.focus({ preventScroll: true });
    return;
  }
  if (action === 'home') move('home');
  else if (action === 'start') startPractice();
  else if (action === 'words') openWords();
  else if (action === 'vocabulary') openWords(wordsTab, 'back');
  else if (action === 'words-tab') openWords(button.dataset.tab, 'switch');
  else if (action === 'listen-tab') openListen(button.dataset.tab, 'switch');
  else if (action === 'tape') openTape(button.dataset.tape);
  else if (action === 'info') openInfo(button.dataset.infoRoom);
  else if (action === 'more-today') openMoreToday();
  else if (action === 'your-words') { if (move('browse')) enterBrowse(); }
  else if (action === 'grammar') { if (screen === 'home') grammarOpen = null; if (move('grammar')) loadGrammar(); }
  else if (action === 'grammar-unit') { const id = button.dataset.unit; grammarOpen ??= new Set([currentUnit()?.id].filter(Boolean)); if (!grammarOpen.delete(id)) grammarOpen.add(id); renderGrammar(); }
  else if (action === 'grammar-by') { grammarBy = button.dataset.value === 'level' ? 'level' : 'unit'; savePreference('echo.grammar-by', grammarBy); renderGrammar(); }
  else if (action === 'topic-page') { if (move(`topic|${topicId}`)) loadGrammar(); }
  else if (action === 'browse') browseWords();
  else if (action === 'studied') { browseShow = 'studied'; browseWords(); }
  else if (action === 'families') { if (move('families', true)) enterFamilies(); }
  else if (action === 'family') { const index = Number(button.dataset.family); familyOpen = familyOpen === index ? -1 : index; renderFamilies(); }
  else if (action === 'family-add') addFromFamily(button.dataset.word);
  else if (action === 'word-building') { buildingFrom = ['families', 'browse'].includes(button.dataset.from) ? button.dataset.from : 'grammar'; if (move('building', true)) enterBuilding(); }
  else if (action === 'building-word') { const key = `${button.dataset.pattern}:${button.dataset.word}`; buildingWord = buildingWord === key ? '' : key; renderBuilding(); }
  else if (action === 'toggle-hide') { hideTranslations = !hideTranslations; revealedWords.clear(); renderBrowse(); document.querySelector('[data-action="toggle-hide"]')?.focus(); }
  else if (action === 'extra-words' || action === 'review-early') extraPractice(action, button.dataset);
  else if (action === 'options') openOptions();
  else if (action === 'board-options') openBoardOptions();
  else if (action === 'about') { dialog.close(); stopAudio(); aboutDialog.showModal(); refreshLanguages(); }
  else if (action === 'again') grade(false);
  else if (action === 'known') grade(true);
  else if (action === 'undo') undo();
  else if (action === 'retry') { clearTimeout(autoRetryTimer); autoRetryTimer = 0; retry(); }
  else if (action === 'retry-browse') loadBrowse();
  else if (action === 'restart') startScope(scope);
  else if (action === 'check') checkAnswer();
  else if (action === 'next') { hintOpen = true; grammarMutation('next'); }
  else if (action === 'rule') grammarMutation('help', { kind: 'rule' });
  else if (action === 'show-answer') grammarMutation('help', { kind: 'answer' });
  else if (action === 'hint') { if (activeGrammar()?.session?.current?.hint) { hintOpen = !hintOpen; render(); } else grammarMutation('help', { kind: 'hint' }); }
  else if (action === 'listen') openListen();
  else if (action === 'read') openStream('read');
  else if (action === 'sentences') openSentences();
  else if (action === 'practise') openMix();
  else if (action === 'mistakes') openMistakes();
  else if (action === 'friends') openFriends();
  else if (action === 'friend-remove') removeFriend(button.dataset.id, button.dataset.name);
  else if (action === 'friend-restore') saveFriend(button.dataset.email, button.dataset.name);
  else if (action === 'friend-dismiss') dismissRequest(button.dataset.email);
  else if (action === 'friends-door') setDoor(Number(button.dataset.minutes));
  else if (action === 'friends-copy') copyFriendsLink();
  else if (action === 'statistics') openStatistics();
  else if (action === 'songs') openWords('songs', 'back');
  else if (action === 'song-open') openSong(button.dataset.song);
  else if (action === 'song-read') readSong({ lrclibId: Number(button.dataset.lrclib) });
  else if (action === 'song-paste') { songPasting = true; render(); document.querySelector('#song-title')?.focus(); }
  else if (action === 'song-pick') pickSongWord(button.dataset.fr);
  else if (action === 'song-pick-all') pickAllSongWords(true);
  else if (action === 'song-pick-none') pickAllSongWords(false);
  else if (action === 'song-add') songAction(`api/songs/${encodeURIComponent(button.dataset.song)}/add`, { method: 'POST', body: JSON.stringify({ words: [...(songPicks.get(button.dataset.song) || [])] }) }, (song) => { songView = song; loadSong(); announce(`${song.added.length} words added.`); });
  else if (action === 'song-retry') songAction(`api/songs/${encodeURIComponent(button.dataset.song)}/retry`, { method: 'POST', body: '{}' }, (song) => { songView = song; loadSong(); });
  else if (action === 'song-remove') songAction(`api/songs/${encodeURIComponent(button.dataset.song)}`, { method: 'DELETE' }, () => { songView = null; move('songs'); loadSongs(); });
  else if (action === 'song-practise') { deck = button.dataset.category; savePreference('echo.deck', deck); openWords('cards'); }
  // From the words page back up to the lyrics: walks back when the lyrics are behind it.
  else if (action === 'song-lyrics') { if (move(`lyrics|${songId}`)) loadLyrics(); }
  else if (action === 'song-page') openSongPage();
  else if (action === 'lyric-line') { const key = button.dataset.line; if (openLines.has(key)) openLines.delete(key); else openLines.add(key); render(); }
  else if (action === 'song-notes') rewriteSongNotes();
  else if (action === 'gender-colours') { genderColours = !genderColours; localStorage.setItem(localKey('echo.genders'), genderColours ? 'on' : 'off'); document.body.classList.toggle('genders', genderColours); openOptions(); render(); }
  else if (action === 'songs-first') setSongsFirst(button.dataset.value === 'true');
  else if (action === 'write') { writeView = screen === 'write' ? null : writeView; if (screen === 'write') loadWrite(); else openWrite(); }
  else if (action === 'write-next') nextWrite();
  else if (action === 'write-again') { writeRetry = true; writeDraft = writeView?.result?.given ?? ''; render(); main.querySelector('#write-answer')?.focus({ preventScroll: true }); }
  else if (action === 'stats-bin') chooseStatsBin(Number(button.dataset.bin));
  else if (action === 'stats-list') { statsOpen = !statsOpen; drawScores(); }
  else if (action === 'stats-day') { stopStatsPlay(); showStatsDay(statsAt + Number(button.dataset.step)); }
  else if (action === 'stats-play') toggleStatsPlay();
  else if (action === 'stats-vbin') chooseVerbBin(Number(button.dataset.bin));
  else if (action === 'stats-vlist') { vScoreOpen = !vScoreOpen; drawVerbScores(); }
  else if (action === 'stats-vstep') { stopVerbPlay(); showVerbDay(vsIndex() + Number(button.dataset.step)); }
  else if (action === 'stats-vplay') toggleVerbPlay();
  else if (action === 'stats-tab') chooseStatsTab(button.dataset.tab);
  else if (action === 'points-day') { pointsDay = button.dataset.day; render(); }
  else if (action === 'sounds') openListen('sounds', 'back');
  else if (action === 'news') openListen('news', 'back');
  else if (action === 'news-open') openNewsEdition(button.dataset.date);
  else if (action === 'news-play') toggleNews();
  else if (action === 'news-from') playNews(Number(button.dataset.index));
  else if (action === 'news-line') { const key = button.dataset.line; if (newsLines.has(key)) newsLines.delete(key); else newsLines.add(key); render(); }
  else if (action === 'sound-open') openSound(button.dataset.sound);
  else if (action === 'sound-again') startSoundRound();
  else if (action === 'sound-play') { const question = soundRound?.questions[soundRound.index]; if (question) playFrench(question.audio); }
  else if (action === 'sound-hear') { const question = soundRound?.questions[soundRound.index]; if (question) playFrench(soundUrl(question.itemId, button.dataset.side)); }
  else if (action === 'sound-choose') chooseSound(button.dataset.side);
  else if (action === 'sound-next') nextSound();
  else if (action === 'story') openStory();
  else if (action === 'story-open') openStory(Number(button.dataset.n));
  else if (action === 'story-play') playStory();
  else if (action === 'story-mode') chooseStoryMode(button.dataset.mode);
  else if (action === 'story-line') { const index = Number(button.dataset.index); if (storyLines.has(index)) storyLines.delete(index); else storyLines.add(index); render(); }
  else if (action === 'story-recap') { storyRecap = !storyRecap; render(); }
  else if (action === 'story-note') { storyNote = !storyNote; render(); }
  else if (action === 'story-answer') { const q = Number(button.dataset.q); if (storyAnswers[q] === null && !storyView?.read) { storyAnswers[q] = Number(button.dataset.storyChoice); render(); } }
  else if (action === 'story-finish') finishStory();
  else if (action === 'radio') openRadio();
  else if (action === 'radio-toggle') toggleRadio();
  else if (action === 'radio-seek') { radioAudio.currentTime = Number(button.dataset.at); if (radioAudio.paused) playRadio(); }
  else if (action === 'walkman-toggle') toggleWalkman();
  else if (action === 'walkman-heard') { heardOpen = !heardOpen; render(); }
  else if (action === 'walkman-say') hearAgain(button.dataset.word);
  else if (action === 'walkman-add') addHeard(button.dataset.word);
  else if (action === 'walkman-mark') markHeard(button.dataset.word, button.dataset.knew === 'true');
  else if (action === 'walkman-choice') chooseWalkman(button.dataset.words);
  else if (action === 'walkman-tense') chooseWalkmanTense(button.dataset.tense);
  else if (action === 'walkman-verb-tape') chooseVerbTape(button.dataset.kind);
  else if (action === 'say-start') startSay();
  else if (action === 'say-dontknow') sayGiveUp?.();
  else if (action === 'say-fix') sayCorrect();
  else if (action === 'stream-next') streamNext();
  else if (event.target.closest('#flashcard') && !event.target.closest('button,a,input,select')) reveal();
});
// Accent buttons type into the Verbs field last used, without taking the focus from it.
document.addEventListener('focusin', (event) => { if (event.target.classList?.contains('vb-input')) vbLastInput = event.target.id; });
document.addEventListener('pointerdown', (event) => { if (event.target.closest?.('.vb-accents button')) event.preventDefault(); });
dialog.addEventListener('pointerdown', pressBoardRange);
dialog.addEventListener('pointermove', dragBoardRange);
dialog.addEventListener('pointerup', releaseBoardRange);
dialog.addEventListener('pointercancel', releaseBoardRange);
dialog.addEventListener('keydown', keyBoardRange);
document.addEventListener('change', (event) => {
  if (event.target.id === 'deck-select' && !locked()) { deck = event.target.value; browseCategory = deck; savePreference('echo.deck', deck); dialog.close(); wordsOptionChanged(); }
  else if (event.target.id === 'browse-category') { browseCategory = event.target.value; renderBrowseResults(); }
  else if (event.target.id === 'browse-show') { browseShow = event.target.value; renderBrowseResults(); }
  else if (event.target.id === 'vb-table-verb' || event.target.id === 'vb-table-tense') {
    verbTable = { ...verbTable, [event.target.id === 'vb-table-verb' ? 'verbId' : 'tense']: event.target.value, answers: ['', '', '', '', '', ''], result: null };
    render(); main.querySelector('.vb-input')?.focus({ preventScroll: true });
  }
  else if (event.target.id === 'audio-speed') { speed = event.target.value === '0.8' ? 0.8 : 1; savePreference('echo.speed', String(speed)); audio.playbackRate = speed; }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'vocab-search') { search = event.target.value; renderBrowseResults(); }
  if (event.target.id === 'vb-search') { vbAllQuery = event.target.value; renderVerbAllResults(); }
  if (event.target.id === 'answer') draft = event.target.value;
  if (event.target.id === 'song-query') songQuery = event.target.value;
  if (event.target.id === 'vb-answer') verbDraft = event.target.value;
  if (event.target.id === 'write-answer') writeDraft = event.target.value;
  if (event.target.dataset?.vbCell !== undefined) verbTable.answers[Number(event.target.dataset.vbCell)] = event.target.value;
  if (event.target.id === 'st-slider') { stopStatsPlay(); showStatsDay(Number(event.target.value)); }
  if (event.target.id === 'vs-slider') { stopVerbPlay(); showVerbDay(Number(event.target.value)); }
});
document.addEventListener('submit', (event) => {
  if (event.target.id === 'goal-form') saveGoal(event);
  else if (event.target.id === 'song-search-form') { event.preventDefault(); searchSongs(document.querySelector('#song-query').value); }
  else if (event.target.id === 'song-paste-form') { event.preventDefault(); readSong({ title: document.querySelector('#song-title').value, artist: document.querySelector('#song-artist').value, lyrics: document.querySelector('#song-lyrics').value }); }
  else if (event.target.matches('.custom-count')) { event.preventDefault(); submitCustomCount(event.target); }
  else if (event.target.id === 'vb-form') { event.preventDefault(); submitVerbForm(); }
  else if (event.target.id === 'write-form') { event.preventDefault(); checkWrite(); }
  else if (event.target.id === 'friend-form') { event.preventDefault(); saveFriend(document.querySelector('#friend-email').value, document.querySelector('#friend-name').value); }
});
document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.repeat || aboutDialog.open || dialog.open || busy || loading || locked()) return;
  const grammarScreen = grammarOnScreen();
  if (grammarScreen && (event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (activeGrammar()?.session?.current?.settled) grammarMutation('next'); else checkAnswer(); return; }
  // The verb-form field is one line, so Enter checks it (and continues once it is settled).
  if (grammarScreen && event.key === 'Enter' && !event.shiftKey && event.target.matches('input#answer')) { event.preventDefault(); if (activeGrammar()?.session?.current?.settled) grammarMutation('next'); else checkAnswer(); return; }
  // Enter continues once the exercise has settled.
  if (streamScreen() && shownSettled() && event.key === 'Enter' && !event.shiftKey && !event.target.closest('input,select,textarea,[contenteditable="true"],button,a')) {
    event.preventDefault();
    streamNext();
    return;
  }
  // Verb cards: Space or Enter turns the card, the arrow keys mark it.
  if (screen === 'verbs-cards' && verbCards && !event.ctrlKey && !event.altKey && !event.metaKey && !event.target.closest('input,select,textarea')) {
    if (!verbCards.revealed && (event.key === ' ' || event.key === 'Enter') && !event.target.closest('button,a')) { event.preventDefault(); revealVerbCard(); }
    else if (verbCards.revealed && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); markVerbCard(event.key === 'ArrowRight'); }
    return;
  }
  if (screen === 'verbs-rules' && vbRules && !event.ctrlKey && !event.altKey && !event.metaKey && !event.target.closest('input,select,textarea')) {
    if (!vbRules.revealed && (event.key === ' ' || event.key === 'Enter') && !event.target.closest('button,a')) { event.preventDefault(); revealRuleCard(); }
    else if (vbRules.revealed && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); markRuleCard(event.key === 'ArrowRight'); }
    return;
  }
  if (screen === 'verbs-sentences' && verbSentences && !event.ctrlKey && !event.altKey && !event.metaKey && !event.target.closest('input,select,textarea')) {
    if (!verbSentences.revealed && (event.key === ' ' || event.key === 'Enter') && !event.target.closest('button,a')) { event.preventDefault(); revealVerbSentence(); }
    else if (verbSentences.revealed && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); markVerbSentence(event.key === 'ArrowRight'); }
    return;
  }
  if (screen === 'sentences' && scCard() && !event.ctrlKey && !event.altKey && !event.metaKey && !event.target.closest('input,select,textarea')) {
    if (!scCards.revealed && (event.key === ' ' || event.key === 'Enter') && !event.target.closest('button,a')) { event.preventDefault(); revealSentence(); }
    else if (scCards.revealed && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); markSentence(event.key === 'ArrowRight'); }
    return;
  }
  if (event.ctrlKey || event.altKey || event.metaKey || !vocabularyCard() || event.target.closest('input,select,textarea,[contenteditable="true"]')) return;
  if (!revealed && (event.key === ' ' || event.key === 'Enter') && !event.target.closest('button,a')) { event.preventDefault(); reveal(); }
  else if (revealed && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && (!event.target.closest('button,a') || event.target.closest('.card-zone'))) { event.preventDefault(); grade(event.key === 'ArrowRight'); }
});
homeButton.addEventListener('click', () => move('home'));
document.querySelector('#about-button').addEventListener('click', () => { stopAudio(); aboutDialog.showModal(); refreshLanguages(); });
document.querySelector('#close-about').addEventListener('click', () => aboutDialog.close());
for (const modal of [dialog, aboutDialog]) {
  modal.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  modal.addEventListener('click', (event) => { if (event.target === modal && !busy) { const box = modal.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) modal.close(); } });
}
// The control that opened the dialog was re-rendered while it opened, so return focus to its replacement.
dialog.addEventListener('close', () => {
  glossWord = null;
  if (main.contains(document.activeElement) && document.activeElement !== main) return;
  (main.querySelector(`[data-action="${dialog.dataset.kind}"]:not(:disabled)`) || main).focus({ preventScroll: true });
});
window.addEventListener('pagehide', stopAudio);
document.addEventListener('visibilitychange', () => { if (!document.hidden && screen === 'home' && !busy && !loading && !dialog.open) fetchState(); });
render();
window.addEventListener('popstate', (event) => {
  const state = event.state;
  if (!state?.echo) return;
  if (busy) {
    // A save is in flight; stay on this screen and keep its history entry.
    depth = state.depth + 1; trail.length = depth; trail[depth] = place();
    history.pushState({ echo: place(), depth }, '');
    return;
  }
  // Entries saved before places carried their topic, scope or mistake group fall back to a list screen.
  const target = /^(topic|exercise)$/.test(state.echo) ? 'grammar' : state.echo === 'focus' ? 'mistakes' : state.echo;
  depth = state.depth; trail.length = depth + 1; trail[depth] = target;
  if (dialog.open) dialog.close();
  if (aboutDialog.open) aboutDialog.close();
  show(target);
  if (screen === 'practice') fetchState();
  else if (screen === 'browse') enterBrowse();
  else if (screen === 'families') enterFamilies();
  else if (screen === 'building') enterBuilding();
  else if (screen === 'grammar' || screen === 'topic' || screen === 'exercise') loadGrammar();
  else if (screen === 'listen' || screen === 'read') enterStream();
  else if (screen === 'mix' || screen === 'focus') enterMixed();
  else if (screen === 'mistakes') loadMistakes();
  else if (screen === 'friends') loadFriends();
  else if (tapeScreen()) loadTape();
  else if (screen === 'statistics') loadStatistics();
  else if (screen === 'songs') loadSongs();
  else if (screen === 'board') loadBoard();
  else if (screen === 'song') loadSong();
  else if (screen === 'lyrics') loadLyrics();
  else if (screen === 'write') loadWrite();
  else if (screen === 'sounds') loadSounds();
  else if (screen === 'sound') startSoundRound();
  else if (screen === 'verbs' || screen === 'verbs-all') loadVerbs();
  else if (screen === 'verbs-forms') startVerbForms();
  else if (screen === 'verbs-table') render();
  else if (screen === 'verbs-ear') startVerbEar();
  else if (screen === 'verbs-cards') startVerbCards();
  else if (screen === 'verbs-rules') startRuleCards();
  else if (screen === 'verbs-sentences') startVerbSentences();
  else if (screen === 'sentences') startSentences();
  else if (screen === 'verbs-tense') loadVerbTense();
  else if (screen === 'verbs-verb') loadVerbPage();
  else if (screen === 'story') loadStory();
  else if (screen === 'radio') loadRadio();
  else if (screen === 'news') loadNews();
  else if (screen === 'news-edition') loadNewsEdition();
});
resumeKeptSaves();
sendSentenceSaves();
if (requestedScreen === 'practice') { if (move('practice', true)) fetchState(); }
else if (requestedScreen === 'grammar' && !roomsOff.has('grammar')) { if (move('grammar', true)) loadGrammar(); }
// The tape starts at once where the browser allows it; Safari wants a tap first, and then Play is right there.
else if (requestedScreen === 'walkman' && !roomsOff.has('walkman')) openWords('walkman', 'forward', true);
else if (requestedScreen === 'say' && !roomsOff.has('say')) { practiceWay = 'speak'; savePreference('echo.way', 'speak'); openWords('endless'); }
else fetchState();
