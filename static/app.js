'use strict';

const main = document.querySelector('#main');
const aboutDialog = document.querySelector('#about-dialog');
const dialog = document.querySelector('#dialog');
const homeButton = document.querySelector('#home-button');
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
const readPreference = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const savePreference = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Progress is server-owned; local preferences are optional. */ } };
let direction = readPreference('echo.direction', 'fr-en') === 'en-fr' ? 'en-fr' : 'fr-en';
let deck = readPreference('echo.deck', 'all');
let speed = readPreference('echo.speed', '1') === '0.8' ? 0.8 : 1;
let audioMode = readPreference('echo.audio-mode', 'off') === 'on';
// Listen mode hides the French word until reveal; it only applies to French → English, where the recording is the prompt.
let listenMode = readPreference('echo.listen-mode', 'off') === 'on';
let heardCard = '';
const listening = () => listenMode && direction === 'fr-en';
const headphones = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16v-4a8 8 0 0 1 16 0v4"/><rect x="3.5" y="14" width="4" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4" height="6.5" rx="1.5"/></svg>';
const bookIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v14M12 6C9.5 4.2 6 4 3 4.7v13.6c3-.7 6.5-.5 9 1.3 2.5-1.8 6-2 9-1.3V4.7C18 4 14.5 4.2 12 6Z"/></svg>';
const mixIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="7" r="3.2"/><circle cx="17" cy="17" r="3.2"/><path d="M13.5 6.5h6.2m0 0-2.2-2.2m2.2 2.2-2.2 2.2M10.5 17.5H4.3m0 0 2.2-2.2m-2.2 2.2 2.2 2.2"/></svg>';
const cassette = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><circle cx="15.5" cy="11" r="2"/><path d="M10.5 11h3M7 19l1.5-3h7L17 19"/></svg>';
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5Z"/></svg>';
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
const storyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18.5V5a1.5 1.5 0 0 1 1.5-1.5h12v13H7a2 2 0 0 0-2 2Zm0 0a2 2 0 0 0 2 2h11.5v-4"/><path d="M10 3.5v6l2-1.4 2 1.4v-6"/></svg>';
const radioIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="m7 8 9-4.5"/><circle cx="15.5" cy="14" r="2.8"/><path d="M6.5 12h3M6.5 15h3M6.5 18h3"/></svg>';
const wordsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="12" height="15" rx="2"/><path d="M8 3h10a2 2 0 0 1 2 2v13"/><path d="M7.5 10h5M7.5 13.5h3.5"/></svg>';
const grammarIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 10 5l5 14M7 14h6M17 8h3M17 12h3M17 16h3"/></svg>';
const mistakesIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v3.5h3.5"/><path d="M12 8v4l2.5 2"/></svg>';
const statsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11M10 20V5M15 20v-7M20 20V8M3 20.5h18"/></svg>';
const soundsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/></svg>';
const chevronIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
// Echo always opens on Home; each screen change after that is a history entry, so Back returns to it.
// A place names a screen and what it shows: 'grammar', 'topic|negation', 'exercise|test:negation'.
let screen = 'home';
let depth = 0;
const trail = ['home'];
// A link may ask for one screen (#practice, #grammar); the address drops it, so a reload opens Home.
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
const clipSource = (url) => clipCache.get(url) || url;
// The answer being saved while the next card already shows, and a grade given before it was saved.
// Vocabulary runs the daily stacks or Endless: started words only, picked by score, each answer +1 or -1 to it.
let vocabMode = readPreference('echo.vocab-mode', 'daily') === 'endless' ? 'endless' : 'daily';
const endlessMode = () => vocabMode === 'endless' && screen === 'practice';
// cards: the word shown, then the ones fetched ahead; recent: words already answered, newest first; last: the
// answer Undo would take back.
let endless = null; // { direction, deck, cards, pool, recent, last, fetching, serial }
const ENDLESS_AHEAD = 2;
const ENDLESS_GAP = 10;
let pendingGrade = null;
// Set once the answer being saved has taken longer than SLOW_SAVE, so the screen says so instead of ignoring taps.
let savingSlow = false;
const SLOW_SAVE = 1200;
const GRADE_LIMIT = 10000;
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
const HEARD_KEY = 'echo.walkman-heard';
const HEARD_LIMIT = 50;
let walkmanHeard = (() => {
  try { const list = JSON.parse(localStorage.getItem(HEARD_KEY) || '[]'); return Array.isArray(list) ? list.slice(0, HEARD_LIMIT) : []; } catch { return []; }
})();
let heardOpen = false;
let heardSaying = '';
const heardMarking = new Set();
function saveHeard() { try { localStorage.setItem(HEARD_KEY, JSON.stringify(walkmanHeard)); } catch { /* private mode: history lasts this visit */ } }
// What the Walkman plays, remembered on this device: words by score (the default), words by groups, or sentences.
const WALKMAN_CHOICES = { scored: 'words by score', groups: 'words by groups', sentences: 'sentences', verbs: 'verbs' };
let walkmanChoice = (() => { const saved = readPreference('echo.walkman-words', 'scored'); return saved in WALKMAN_CHOICES ? saved : 'scored'; })();
function chooseWalkman(choice) {
  if (choice === walkmanChoice || walkman.loading) return;
  walkmanChoice = choice; savePreference('echo.walkman-words', choice);
  // The new choice starts a new tape straight away, playing on if the old one was.
  loadTape(!walkmanAudio.paused);
}
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
let streamDraft = '';
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
function directionLabel() { return direction === 'fr-en' ? 'French → English' : 'English → French'; }
function categoryTitle(category) { return snapshot?.decks.find((entry) => entry.id === category)?.title || category.replace(/[-_]/g, ' ').replace(/^./, (letter) => letter.toUpperCase()); }
function totalWords() { return snapshot?.decks.find((entry) => entry.id === 'all')?.count ?? 0; }
function dateLabel(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date); }
function dayLabel(value) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value)); }
function stopAudio() {
  const stopped = clipRun;
  if (stopped) clipSpot = { ...stopped };
  clipRun = null; audioGeneration++; clipProgress = null; audio.pause(); audio.removeAttribute('src'); audio.load(); clearTimeout(audioTimer); document.querySelector('#audio-status').hidden = true;
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
  const view = streamState?.current; return view ? `${streamId}:${view.key}` : '';
}
function clipHint() {
  const view = streamState?.current;
  if (clipProgress) return `line ${clipProgress.index} of ${clipProgress.total}`;
  if (!view?.audio?.length) return '';
  if (clipSpot?.key === clipKey() && view.audio.length > 1) return `paused · line ${clipSpot.heard + 1} of ${view.audio.length}`;
  if (audioBlocked && view.mode === 'listen' && !streamState.result) return 'Tap to listen';
  return view.audio.length > 1 ? `${view.audio.length} lines` : '';
}
// The speaker and its hint change as lines play, so the block is redrawn in place.
function showClipProgress() {
  if (screen === 'story' && storyView) { const block = document.querySelector('.story .story-player'); if (block) block.outerHTML = storyPlayHTML(); return; }
  const block = document.querySelector('.listen-block');
  if (block && streamState?.current) block.outerHTML = streamAudioHTML(streamState.current, !!streamState.result);
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
    if (error instanceof TypeError) throw new Error('Cannot reach your Mac. Check that Echo is running and your connection is available, then retry.');
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
    const kept = retryAction.body?.known !== undefined || retryAction.body?.given !== undefined || retryAction.type === 'grade' ? ' Your answer is kept and saves as soon as it’s back.' : '';
    return `<div class="notice info" role="status"><span>Can’t reach your Mac. Trying again by itself.${kept}</span><button class="quiet" data-action="retry" ${busy ? 'disabled' : ''}>Retry now</button></div>`;
  }
  return `<div class="notice ${notice.kind === 'info' ? 'info' : ''}" role="${notice.kind === 'info' ? 'status' : 'alert'}"><span>${esc(notice.message)}</span>${retryAction ? `<button class="quiet" data-action="retry" ${busy ? 'disabled' : ''}>Retry</button>` : ''}</div>`;
}
function optionsHTML(selected) { return (snapshot?.decks || []).map((entry) => `<option value="${esc(entry.id)}" ${entry.id === selected ? 'selected' : ''}>${esc(entry.title)} · ${entry.count}</option>`).join(''); }
// Nouns are coloured by gender (lib/store.ts genderOf): a class on the French, shown when the setting is on.
let genders = {};               // word id -> gender, for tappable words linked to a noun (api/genders)
let genderColours = localStorage.getItem('echo.genders') !== 'off';
document.body.classList.toggle('genders', genderColours);
const genderClass = (gender) => gender === 'masculine' ? ' g-m' : gender === 'feminine' ? ' g-f' : '';
fetch('api/genders').then((response) => response.ok ? response.json() : {}).then((map) => { genders = map; render(); }).catch(() => {});
function back(label, action) { return `<button class="back" data-action="${action}" ${busy ? 'disabled' : ''}><span aria-hidden="true">←</span> ${label}</button>`; }
function place() { return screen === 'song' ? `song|${songId}` : screen === 'lyrics' ? `lyrics|${songId}` : screen === 'topic' ? `topic|${topicId}` : screen === 'exercise' ? `exercise|${scope}` : screen === 'focus' ? `focus|${focusId}` : screen === 'sound' ? `sound|${soundId}` : screen === 'story' && storyNumber ? `story|${storyNumber}` : screen; }
function record(next) {
  depth += 1; trail.length = depth; trail[depth] = next;
  history.pushState({ echo: next, depth }, '');
}
function workingCounts(label) {
  if (savingSlow && pendingGrade) return `<span class="compact-line"><span class="compact-label" title="${esc(label)}">${esc(label)}</span><span class="compact-status" role="status">${queuedGrade !== null ? 'Saving your last answer — this one is kept…' : 'Saving your last answer…'}</span></span>`;
  const unavailable = !snapshot || retryAction || snapshot.direction !== direction || snapshot.deck !== deck;
  const counts = loading ? '<span class="compact-status" role="status">Loading counts…</span>' : unavailable ? '<span class="compact-status">Counts unavailable</span>' : `<span class="compact-counts"><span class="unseen"><strong>${formatCount(snapshot.stats.unseenActive)}</strong> unseen</span><span class="separator" aria-hidden="true">·</span><span><strong>${formatCount(snapshot.stats.seenActive)}</strong> seen</span></span>`;
  return `<span class="compact-line"><span class="compact-label" title="${esc(label)}">${esc(label)}</span>${counts}</span>`;
}
// Home: every room is a tile, Vocabulary first; each carries one live hint. The Story and Radio hints come from
// their own endpoints, read again at most once a minute while Home is open.
let homeInfo = { story: null, radio: null, at: 0 };
function loadHomeInfo() {
  if (Date.now() - homeInfo.at < 60_000) return;
  homeInfo.at = Date.now();
  Promise.all([api('api/story').catch(() => null), api('api/radio').catch(() => null)]).then(([story, radioView]) => {
    homeInfo = { story, radio: radioView, at: homeInfo.at };
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
function renderHome() {
  loadHomeInfo();
  const tile = (action, symbol, title, hint, mode, disabled = busy) => {
    const label = mode ? levelFor(mode) : '';
    return `<button class="tile" data-action="${action}" ${disabled ? 'disabled' : ''}><span class="ic" aria-hidden="true">${symbol}</span>${label ? `<span class="level-tag">${esc(label)}</span>` : ''}<h2>${esc(title)}</h2><p>${esc(hint)}</p></button>`;
  };
  const row = (action, symbol, title) => `<button class="study-row" data-action="${action}" ${busy ? 'disabled' : ''}><span class="ic" aria-hidden="true">${symbol}</span><span class="name">${esc(title)}</span><span class="chev" aria-hidden="true">${chevronIcon}</span></button>`;
  main.innerHTML = `${noticeHTML()}<section class="home"><h1>Choose your practice.</h1><div class="tiles">
    ${tile('start', wordsIcon, 'Vocabulary', vocabularyHint(), '', locked())}
    ${tile('practise', mixIcon, 'Practise', 'A little of everything')}
    ${tile('listen', headphones, 'Listen', 'Hear it, show you got it', 'listen')}
    ${tile('read', bookIcon, 'Read', 'Read it, show you got it', 'read')}
    ${tile('grammar', grammarIcon, 'Grammar', 'Rules, then practise')}
    ${tile('verbs', verbsIcon, 'Verbs', 'Conjugation, on its own')}
    ${tile('walkman', cassette, 'Walkman', 'A tape of your words')}
    ${tile('sounds', soundsIcon, 'Sounds', 'Tell twin sounds apart')}
    ${tile('story', storyIcon, 'Story', storyHint())}
    ${tile('radio', radioIcon, 'Radio', radioHint())}
  </div><p class="study-label">Study</p><div class="study">
    ${row('mistakes', mistakesIcon, 'Mistakes')}${row('statistics', statsIcon, 'Statistics')}
  </div></section>`;
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
  else if (screen === 'walkman') renderWalkman();
  else if (screen === 'statistics') renderStatistics();
  else if (screen === 'songs') renderSongs();
  else if (screen === 'song') renderSong();
  else if (screen === 'lyrics') renderLyrics();
  else if (screen === 'sounds') renderSounds();
  else if (screen === 'sound') renderSound();
  else if (screen === 'verbs') renderVerbs();
  else if (screen === 'verbs-forms') renderVerbForms();
  else if (screen === 'verbs-table') renderVerbTable();
  else if (screen === 'verbs-ear') renderVerbEar();
  else if (screen === 'verbs-cards') renderVerbCards();
  else if (screen === 'verbs-tense') renderVerbTense();
  else if (screen === 'verbs-verb') renderVerbPage();
  else if (screen === 'story') renderStory();
  else if (screen === 'radio') renderRadio();
  else renderHome();
}
function renderWalkman() {
  const header = `<div class="section-top">${back('Home', 'home')}<span class="stream-label">Walkman</span></div>`;
  const tape = walkman.tape;
  if (walkman.loading || (!tape && !notice)) { main.innerHTML = `${noticeHTML()}<section class="stream walkman">${header}<div class="loading-state" role="status">Winding the tape…</div></section>`; return; }
  if (!tape) { main.innerHTML = `${noticeHTML()}<section class="stream walkman">${header}</section>`; return; }
  const word = tape.words[walkman.index];
  const playing = !walkmanAudio.paused;
  const face = word
    ? `<p class="wm-fr${word.sentence || word.verb ? ' wm-sentence' : ''}" lang="fr">${frEsc(word.fr)}</p><p class="wm-en">${walkman.meaning ? esc(word.en) : '&nbsp;'}</p>`
    : `<p class="wm-hint">${tape.kind === 'verbs'
      ? 'You hear a verb, a tense and a person, then a pause to say the form, then the form twice. The 20 most common verbs, in the tenses you choose.'
      : tape.kind === 'sentences'
      ? 'You hear a French sentence, then a pause to understand it, then the English, then the French again.'
      : 'You hear a French word, then a pause to find its meaning, then the English, then the French again.'}</p>`;
  main.innerHTML = `${noticeHTML()}<section class="stream walkman">${header}
    <div class="wm-face" aria-live="polite">${face}</div>
    <div class="wm-controls"><button class="listen-play wm-play" data-action="walkman-toggle" aria-label="${playing ? 'Pause' : 'Play'}">${playing ? pauseIcon : playIcon}</button></div>
    <div class="wm-progress" aria-hidden="true"><span style="width:${walkmanProgress()}%"></span></div>
    ${heardHTML()}
    <p class="caption wm-note">Keeps playing with your phone locked. Listening doesn’t change your vocabulary progress.</p>
    ${walkmanChoice === 'verbs' ? `<p class="wm-choice wm-tenses">Tenses ${Object.entries(VB_TENSES).map(([tense, label]) => `<button data-action="walkman-tense" data-tense="${tense}" aria-pressed="${verbTenses.includes(tense)}">${esc(label)}</button>`).join('<span aria-hidden="true">·</span>')}</p>` : ''}
    <p class="wm-choice">Plays ${Object.entries(WALKMAN_CHOICES).map(([choice, label]) => `<button data-action="walkman-choice" data-words="${choice}" aria-pressed="${walkmanChoice === choice}">${label}</button>`).join('<span aria-hidden="true">·</span>')}</p>
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
    return `<li class="wm-heard-row${entry.sentence ? ' sentence' : ''}"><div class="wm-heard-text"><p class="wm-heard-fr" lang="fr">${frEsc(entry.fr)}</p><p class="wm-heard-en">${esc(entry.en)}</p>${add}</div>${marks}<button class="icon${heardSaying === entry.id ? ' playing' : ''}" data-action="walkman-say" data-word="${esc(entry.id)}" aria-label="Hear ${esc(entry.fr)} again">${speaker}</button></li>`;
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
  // leaves the vocabulary alone.
  if (!word.sentence && !word.verb) api('api/walkman/heard', { method: 'POST', body: JSON.stringify({ wordId: word.id, requestId: requestId() }), keepalive: true }).catch(() => {});
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
  await playClip(entry?.verb ? entry.verb.audio : entry?.sentence ? `audio/comprehension/${encodeURIComponent(id)}.mp3` : wordClipUrl(id), token);
  if (token !== audioGeneration) return;
  heardSaying = '';
  if (screen !== 'walkman') return;
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
  if (screen === 'walkman') render();
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
  if (screen === 'walkman') render();
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
    const tape = await api('api/walkman', { method: 'POST', body: JSON.stringify({ words: walkmanChoice, ...(walkmanChoice === 'verbs' ? { tenses: verbTenses } : {}) }) });
    if (token !== walkmanGeneration || screen !== 'walkman') return;
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
    if (error.name !== 'AbortError') { notice = { message: 'The tape could not start. Tap play to try again.' }; }
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
  const meaning = index >= 0 && time >= walkman.tape.words[index].meaningAt;
  let logged = false;
  if (walkman.index >= 0 && index !== walkman.index && walkman.meaning) logged = logHeard(walkman.index);
  if (index >= 0 && time >= walkman.tape.words[index].end) logged = logHeard(index) || logged;
  if (index !== walkman.index || meaning !== walkman.meaning) {
    walkman.index = index; walkman.meaning = meaning;
    const word = walkman.tape.words[index];
    if (word && 'mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: word.fr, artist: meaning ? word.en : '…', album: 'Echo · Walkman', artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] });
    }
    if (screen === 'walkman' && !document.hidden) render();
    return;
  }
  if (logged && heardOpen && screen === 'walkman' && !document.hidden) { render(); return; }
  const bar = document.querySelector('.wm-progress span');
  if (bar) bar.style.width = `${walkmanProgress()}%`;
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
walkmanAudio.addEventListener('play', () => { if (screen === 'walkman') render(); });
walkmanAudio.addEventListener('pause', () => { if (screen === 'walkman') render(); });
// A finished tape winds straight on to a new one, chosen afresh.
walkmanAudio.addEventListener('ended', () => { if (screen === 'walkman') loadTape(true); });
walkmanAudio.addEventListener('error', () => {
  if (screen !== 'walkman' || !walkman.tape) return;
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
  const header = `<div class="section-top">${back('Home', 'home')}<span class="stream-label">Radio</span></div>`;
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
    ? `<p class="wm-hint">${esc(SECTION_TITLE[part.section])}${part.label !== SECTION_TITLE[part.section] ? ` · ${esc(part.label)}` : ''}</p>${part.fr ? `<p class="wm-fr" lang="fr">${frEsc(part.fr)}</p>` : ''}<p class="wm-en">${esc(part.en || '')}</p>`
    : `<p class="wm-hint">Today’s episode, ${Math.max(1, Math.round(view.seconds / 60))} minutes: your words in sentences, the story, and a little grammar.</p>`;
  const sections = view.segments.filter((segment, index, all) => segment.section !== 'intro' && segment.section !== 'outro' && all.findIndex((other) => other.section === segment.section) === index);
  const chapters = sections.map((segment) => `<button class="secondary chip" data-action="radio-seek" data-at="${segment.start}">${esc(SECTION_TITLE[segment.section])}</button>`).join('');
  shell(`<div class="wm-face" aria-live="polite">${face}</div>
    <div class="wm-controls"><button class="listen-play wm-play" data-action="radio-toggle" aria-label="${playing ? 'Pause' : 'Play'}">${playing ? pauseIcon : playIcon}</button></div>
    <div class="wm-progress" aria-hidden="true"><span style="width:${radioProgress()}%"></span></div>
    ${chapters ? `<div class="radio-chapters" role="group" aria-label="Jump to">${chapters}</div>` : ''}`);
}
if ('mediaSession' in navigator) {
  const player = () => mediaPlayer === 'radio' ? { play: playRadio, audio: radioAudio, skip: skipRadio } : mediaPlayer === 'story' ? { play: playStory, audio: storyAudio, skip: skipStory } : { play: playWalkman, audio: walkmanAudio, skip: skipWord };
  navigator.mediaSession.setActionHandler('play', () => player().play());
  navigator.mediaSession.setActionHandler('pause', () => player().audio.pause());
  navigator.mediaSession.setActionHandler('nexttrack', () => player().skip(1));
  navigator.mediaSession.setActionHandler('previoustrack', () => player().skip(-1));
}
function availabilityCopy() {
  const parts = [];
  const elsewhere = snapshot.overview.remaining + snapshot.overview.newAvailable;
  if (deck !== 'all' && snapshot.stats.newAvailable === 0 && elsewhere > 0) parts.push(`${formatCount(elsewhere)} ${elsewhere === 1 ? 'word is' : 'words are'} waiting in other categories. Choose All words in vocabulary options to continue.`);
  if (snapshot.nextDue) parts.push(`Next review: ${dateLabel(snapshot.nextDue)}.`);
  const recording = snapshot.stats.recording || 0;
  if (recording > 0 && snapshot.stats.newAvailable === 0) parts.push(`${formatCount(recording)} ${recording === 1 ? 'word from a song is' : 'words from songs are'} still being recorded on your Mac. Each one joins your practice as soon as it is ready, usually within minutes.`);
  if (snapshot.stats.unseen - recording > 0 && snapshot.stats.newAvailable === 0) parts.push(snapshot.settings.newPerDay === 0 ? 'New words are paused with your daily allowance at 0.' : 'New words return with your next daily allowance at 04:00 on your Mac, or add extra words below.');
  return parts.join(' ') || 'You’re up to date in this vocabulary selection.';
}
let extraScope = 0;
function extraPracticeHTML() {
  const stats = snapshot.stats;
  // Unique per render: the options dialog can open over the end screen, which renders this too.
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
  return `<section class="extra-practice" aria-labelledby="extra-title-${scope}"><h2 id="extra-title-${scope}">Extra practice</h2>
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
function extraPractice(type, data) {
  if (locked() || !snapshot) return;
  if (dialog.open) dialog.close();
  runMutation({ type, body: { direction, deck, count: Number(data.count), requestId: requestId(), ...(type === 'review-early' ? { mode: data.mode } : {}) } });
}
// A word missed often: how often, and the words of its deck missed most with it, side by side to tell apart.
function troubleHTML(trouble) {
  const list = trouble.alongside.length ? `<ul>${trouble.alongside.map((word) => `<li><span lang="fr" class="${genderClass(word.gender).trim()}">${frEsc(word.fr)}</span> <span class="en">${esc(word.en)}</span></li>`).join('')}</ul>` : '';
  const hook = trouble.hook ? `<p class="word-hook">${esc(trouble.hook)}</p>` : '';
  return `<div class="word-trouble">${hook}<p>Missed ${trouble.misses} times${trouble.alongside.length ? '. Often missed with it:' : '.'}</p>${list}</div>`;
}
// The flashcard itself: shared by the Vocabulary screen and the Practise stream.
function cardHTML(card = snapshot.current, undoable = !!snapshot.undoId) {
  const reverse = direction === 'en-fr';
  const prompt = reverse ? card.en : card.fr;
  const answer = reverse ? card.fr : card.en;
  const hidden = listening() && !revealed;
  const face = hidden
    ? `<button class="listen-play" data-action="replay" aria-label="Play the French word again">${speaker}</button><p class="source-word">Listen, then tap to see the word</p>`
    : `<h1 class="main-word${(revealed ? reverse : !reverse) ? genderClass(card.gender) : ''}" lang="${(revealed ? reverse : !reverse) ? 'fr' : 'en'}">${esc(revealed ? answer : prompt)}</h1>${revealed ? `<p class="source-word${revealed && !reverse ? genderClass(card.gender) : ''}" lang="${reverse ? 'en' : 'fr'}">${esc(prompt)}</p>${card.note ? `<p class="word-note">${esc(card.note)}</p>` : ''}${card.trouble ? troubleHTML(card.trouble) : ''}` : ''}`;
  const listenToggle = direction === 'fr-en' ? `<button class="audio-mode ${listenMode ? 'on' : ''}" data-action="listen-mode" aria-pressed="${listenMode}" aria-label="Listen only: ${listenMode ? 'on' : 'off'}" title="Hear the French word instead of reading it">${headphones}<span>Listen ${listenMode ? 'on' : 'off'}</span></button>` : '';
  return `<div class="study-surface ${revealed ? 'revealed' : ''}" id="flashcard" role="${revealed ? 'group' : 'button'}" tabindex="${revealed ? '-1' : '0'}" aria-label="${revealed ? 'Revealed flashcard. Left: didn’t know. Right: knew it.' : hidden ? 'Reveal the meaning' : 'Reveal the translation'}" aria-busy="${busy}"><div class="word-content">${face}</div>${revealed ? `<button class="card-zone left" data-action="again" aria-label="Didn’t know this word" ${locked() ? 'disabled' : ''}><span aria-hidden="true">←</span></button><button class="card-zone right" data-action="known" aria-label="Knew this word" ${locked() ? 'disabled' : ''}><span aria-hidden="true">→</span></button>` : ''}</div><div class="study-tools"><div class="study-modes"><button class="audio-mode ${audioMode ? 'on' : ''}" data-action="audio-mode" aria-pressed="${audioMode}" aria-label="French audio on reveal: ${audioMode ? 'on' : 'off'}" title="Play French on each reveal">${speaker}<span>Audio ${audioMode ? 'on' : 'off'}</span></button>${listenToggle}</div><button class="quiet" data-action="undo" ${!undoable || locked() ? 'disabled' : ''}>Undo</button></div>`;
}
// Each new card (or new version after a grade or undo) plays once on its own; re-renders don't replay it.
function playCardOnce() {
  const card = shownCard();
  if (!card || !listening() || revealed) return;
  const key = `${card.id}:${card.version}:${card.serial ?? ''}`;
  if (key === heardCard) return;
  heardCard = key; playFrench(card.audioUrl);
}
function renderPractice() {
  if (vocabMode === 'endless') { renderEndless(); return; }
  const header = `<div class="section-top">${back('Home', 'home')}<div><span class="review-direction" aria-label="${esc(directionLabel())}">${direction === 'fr-en' ? 'FR → EN' : 'EN → FR'}</span><button class="icon" data-action="families" aria-label="Word families" ${busy ? 'disabled' : ''}>${familyIcon}</button><button class="icon" data-action="browse" aria-label="Browse vocabulary" ${busy ? 'disabled' : ''}>${searchIcon}</button><button class="icon" data-action="options" aria-label="Vocabulary options" aria-haspopup="dialog" ${busy || !snapshot ? 'disabled' : ''}>•••</button></div></div>`;
  if (!snapshot || loading) { main.innerHTML = `${noticeHTML()}<section class="practice">${header}<div class="loading-state" role="status">${loading ? 'Opening your vocabulary…' : 'Your progress is safe on your Mac.'}</div></section>`; return; }
  if (!snapshot.current) {
    main.innerHTML = `${noticeHTML()}<section class="practice">${header}${workingCounts(categoryTitle(deck))}<div class="completion"><h1>A good place to pause.</h1><p>${esc(availabilityCopy())}</p><div class="summary-actions">${snapshot.stats.newAvailable > 0 ? `<button class="primary" data-action="start" ${locked() ? 'disabled' : ''}>Continue practice</button>` : ''}<button class="secondary" data-action="studied" ${busy ? 'disabled' : ''}>Your studied words</button><button class="secondary" data-action="families" ${busy ? 'disabled' : ''}>Word families</button><button class="secondary" data-action="grammar" ${busy ? 'disabled' : ''}>Explore grammar</button>${snapshot.undoId ? `<button class="quiet" data-action="undo" ${locked() ? 'disabled' : ''}>Undo last answer</button>` : ''}</div>${extraPracticeHTML()}</div></section>`; return;
  }
  main.innerHTML = `${noticeHTML()}<section class="practice">${header}${workingCounts(categoryTitle(deck))}${cardHTML()}</section>`;
  playCardOnce();
  warmClip(snapshot.current.audioUrl);
  warmClip(snapshot.next?.audioUrl);
}
function renderEndless() {
  const header = `<div class="section-top">${back('Home', 'home')}<div><span class="review-direction" aria-label="${esc(directionLabel())}">${direction === 'fr-en' ? 'FR → EN' : 'EN → FR'}</span><button class="icon" data-action="families" aria-label="Word families">${familyIcon}</button><button class="icon" data-action="browse" aria-label="Browse vocabulary">${searchIcon}</button><button class="icon" data-action="options" aria-label="Vocabulary options" aria-haspopup="dialog" ${!snapshot ? 'disabled' : ''}>•••</button></div></div>`;
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="practice">${header}${body}</section>`; };
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
  main.innerHTML = `${noticeHTML()}<section class="topics browse"><div class="section-top">${back('Vocabulary', 'vocabulary')}<button class="icon" data-action="options" aria-label="Vocabulary options" ${!snapshot || busy ? 'disabled' : ''}>•••</button></div><h1>Your words</h1><p class="subtitle">${esc(directionLabel())}</p><div class="browse-tools"><label class="sr-only" for="vocab-search">Search French or English vocabulary</label><input type="search" id="vocab-search" placeholder="Find a word…" value="${esc(search)}" autocomplete="off"><label class="sr-only" for="browse-category">Category</label><select id="browse-category">${optionsHTML(browseCategory)}</select></div><div class="browse-filters"><label class="sr-only" for="browse-show">Show</label><select id="browse-show">${show}</select><button class="secondary chip" data-action="toggle-hide" aria-pressed="${hideTranslations}">${hideTranslations ? 'Show translations' : 'Hide translations'}</button></div><div id="browse-results"></div></section>`;
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
  const text = !hidden ? `<h2 lang="fr" class="${genderClass(word.gender).trim()}">${esc(word.fr)}</h2><p>${esc(word.en)}</p>`
    : (() => {
      const reveal = `<button class="reveal-word" data-reveal-word="${esc(word.id)}">${reverse ? 'Show French' : 'Show English'}</button>`;
      return reverse ? `<h2 lang="en">${esc(word.en)}</h2>${reveal}` : `<h2 lang="fr" class="${genderClass(word.gender).trim()}">${esc(word.fr)}</h2>${reveal}`;
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
  const header = `<div class="section-top">${back('Vocabulary', 'vocabulary')}</div><h1>Word families</h1><p class="subtitle">Words built from one another. You know a word in each of these, so the others come easily.</p>`;
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
    const nextLabel = next ? ` · ${next.state === 'new' ? 'next' : 'learning'}: <span lang="fr" class="${genderClass(next.word.gender).trim()}">${frEsc(next.word.fr)}</span>` : '';
    const members = open ? `<ol class="fam-members">${family.members.map((member) => `<li>${familyMemberHTML(member)}</li>`).join('')}</ol>` : '';
    return `<article class="fam-row${open ? ' open' : ''}"><button class="fam-head" data-action="family" data-family="${family.index}" aria-expanded="${open}"><span class="fam-title"><span lang="fr" class="${genderClass(head.gender).trim()}">${frEsc(head.fr)}</span> family</span><span class="fam-meta">You know ${family.known} of ${family.members.length}${nextLabel}</span><span class="fam-bar" aria-hidden="true"><span style="width:${(family.known / family.members.length * 100).toFixed(0)}%"></span></span><span class="fam-dots" aria-hidden="true">${family.members.map((member) => dot(member.state)).join('')}</span></button>${members}</article>`;
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
  return `<div class="fam-member"><span class="fam-dot ${member.state}" aria-hidden="true"></span><div class="fam-text"><p class="fam-fr ${genderClass(member.word.gender).trim()}" lang="fr">${frEsc(member.word.fr)}</p><p class="fam-en">${esc(member.word.en)}</p>${member.note ? `<p class="fam-note">${esc(member.note)}</p>` : ''}${add}</div><button class="icon" data-play-word="${esc(member.id)}" aria-label="Pronounce ${esc(member.word.fr)}">${speaker}</button></div>`;
}
function renderBuilding() {
  const header = `<div class="section-top">${back(buildingFrom === 'families' ? 'Word families' : 'Grammar', buildingFrom === 'families' ? 'families' : 'grammar')}</div><h1>Word building</h1><p class="subtitle">How French makes one word from another. Learn a pattern once, and new words arrive half known.</p>`;
  if (familiesLoading || familiesError) { main.innerHTML = `${noticeHTML()}<section class="topics families">${header}${familiesError ? `<div class="notice" role="alert"><span>${esc(familiesError)}</span><button class="quiet" data-action="word-building">Retry</button></div>` : '<div class="loading-state" role="status">Opening word building…</div>'}</section>`; return; }
  const byId = new Map((words || []).map((word) => [word.id, word]));
  const members = new Map((families || []).flatMap((family) => family.members).map((member) => [member.id, member]));
  const entry = (id) => { const word = byId.get(id); return word ? { ...members.get(id), id, word, state: familyState(word) } : null; };
  const rank = { known: 0, learning: 1, new: 2 };
  const chip = (index, member) => `<button class="wb-chip" data-action="building-word" data-pattern="${index}" data-word="${esc(member.id)}" aria-pressed="${buildingWord === `${index}:${member.id}`}"><span class="fam-dot ${member.state}" aria-hidden="true"></span><span lang="fr" class="${genderClass(member.word.gender).trim()}">${frEsc(member.word.fr)}</span></button>`;
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
function topicRowHTML(topic) {
  const parts = [];
  if (topic.progress.seen) parts.push(`${topic.progress.seen} of ${topic.exerciseCount} practised`);
  if (topic.test.best) parts.push(`best test ${topic.test.best.score}/${topic.test.best.total}`);
  const active = topic.hasActiveSession && topic.hasActiveTest ? 'Round and test in progress' : topic.hasActiveSession ? 'Continue your round' : topic.hasActiveTest ? 'Continue your test' : '';
  // Marks run from "du" to "ce · cet · cette": each " · " part gets its own line so the badge column stays narrow.
  const mark = topic.mark.split(' · ').map((part) => `<span>${esc(part)}</span>`).join('');
  return `<button class="topic-row" data-topic="${esc(topic.id)}" ${locked() ? 'disabled' : ''}><span class="topic-mark" aria-hidden="true">${mark}</span><span class="copy"><span class="topic-name"><h3>${esc(topic.title)}</h3><span class="level-tag">${esc(topic.level)}</span></span><p>${esc(topic.description)}</p>${parts.length ? `<small class="topic-progress">${parts.join(' · ')}</small>` : ''}${active ? `<small>${active}</small>` : ''}</span><span class="arrow" aria-hidden="true">→</span></button>`;
}
function renderGrammar() {
  const list = (units || []).map((unit, index) => `<section class="unit" aria-labelledby="unit-${esc(unit.id)}"><div class="unit-head"><div class="unit-copy"><p class="unit-kicker">Unit ${index + 1}</p><h2 id="unit-${esc(unit.id)}">${esc(unit.title)}</h2><p>${esc(unit.description)}</p></div><button class="secondary unit-test" data-scope="unit:${esc(unit.id)}" ${locked() ? 'disabled' : ''}>${unit.hasActiveTest ? 'Continue unit test' : `Unit test · ${unit.testLength}`}${unit.test.best ? `<small>best ${unit.test.best.score}/${unit.test.best.total}</small>` : ''}</button></div><div class="topic-list">${unit.topics.map(topicRowHTML).join('')}</div></section>`).join('');
  main.innerHTML = `${noticeHTML()}<section class="topics"><div class="section-top">${back('Home', 'home')}</div><h1>Grammar & sentences</h1><p class="subtitle">Practise a topic, then test yourself. Each unit ends with a test across its topics.</p><button class="topic-row wb-entry" data-action="word-building" ${locked() ? 'disabled' : ''}><span class="topic-mark" aria-hidden="true"><span>-er</span><span>-eur</span></span><span class="copy"><span class="topic-name"><h3>Word building</h3></span><p>Endings and prefixes that turn one word into another, shown with your own words.</p></span><span class="arrow" aria-hidden="true">→</span></button>${units ? list : loading ? '<div class="loading-state" role="status">Opening the workshop…</div>' : ''}</section>`;
}
// A guide section teaches one point: a table of forms (a highlighted row holds an answer), the steps for choosing,
// examples and traps. French and English share the cells, so every cell keeps French spacing.
function guideTableHTML(table, row = null) {
  return `<div class="guide-table-wrap"><table class="guide-table"><thead><tr>${table.columns.map((column) => `<th scope="col">${esc(column)}</th>`).join('')}</tr></thead><tbody>${table.rows.map((cells) => `<tr${cells[0] === row ? ' class="hit"' : ''}>${cells.map((cell, index) => index ? `<td>${frEsc(cell)}</td>` : `<th scope="row">${frEsc(cell)}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function guideSectionHTML(section, focus = false) {
  const steps = section.steps ? `<p class="guide-label">How to choose</p><ol class="guide-steps">${section.steps.map((step) => `<li>${frEsc(step)}</li>`).join('')}</ol>` : '';
  const examples = `<div class="guide-examples">${section.examples.map((example) => `<p><span lang="fr">${frEsc(example.fr)}</span><span class="en">${esc(example.en)}</span></p>`).join('')}</div>`;
  const watch = section.watch ? `<p class="guide-label">Watch out</p><ul class="guide-watch">${section.watch.map((item) => `<li>${frEsc(item)}</li>`).join('')}</ul>` : '';
  return `<section class="guide-section${focus ? ' focus' : ''}" id="guide-${esc(section.id)}"><h3>${esc(section.title)}</h3>${section.text ? `<p>${frEsc(section.text)}</p>` : ''}${section.table ? guideTableHTML(section.table) : ''}${steps}${examples}${watch}</section>`;
}
function guideHTML(guide, focusId = '') {
  return `<div class="guide"><p class="guide-summary">${frEsc(guide.summary)}</p>${guide.sections.map((section) => guideSectionHTML(section, section.id === focusId)).join('')}</div>`;
}
function renderTopic() {
  const topic = topicPage?.id === topicId ? topicPage : units?.flatMap((unit) => unit.topics).find((entry) => entry.id === topicId);
  if (!topic) { main.innerHTML = `${noticeHTML()}<section class="topic-page"><div class="section-top">${back('Grammar', 'grammar')}</div>${loading ? '<div class="loading-state" role="status">Opening the topic…</div>' : ''}</section>`; return; }
  const { progress, test } = topic;
  const practised = progress.seen ? `${progress.seen} of ${topic.exerciseCount} questions practised · ${progress.independent} on your own · ${progress.needsReview} to revisit` : `${topic.exerciseCount} questions to practise`;
  const history = test.taken ? `<div class="history-row"><span>Best</span><strong>${test.best.score} / ${test.best.total}</strong></div><div class="history-row"><span>Last · ${esc(dateLabel(test.last.finishedAt))}</span><strong>${test.last.score} / ${test.last.total}</strong></div><div class="history-row"><span>Taken</span><strong>${test.taken} ${test.taken === 1 ? 'time' : 'times'}</strong></div>` : `<p class="caption">No tests yet. A test asks ${topic.testLength} questions with no help and one try each; anything you miss comes back first when you practise.</p>`;
  main.innerHTML = `${noticeHTML()}<section class="topic-page"><div class="section-top">${back('Grammar', 'grammar')}</div><p class="topic-kicker" lang="fr" aria-hidden="true">${esc(topic.mark)}</p><div class="topic-heading"><h1>${esc(topic.title)}</h1><span class="level-tag">${esc(topic.level)}</span></div><p class="subtitle">${esc(topic.description)}</p><div class="topic-actions"><button class="primary" data-scope="${esc(topic.id)}" ${locked() ? 'disabled' : ''}>${topic.hasActiveSession ? 'Continue your round' : `Practise · ${topic.practiceLength} questions`}</button><button class="secondary" data-scope="test:${esc(topic.id)}" ${locked() ? 'disabled' : ''}>${topic.hasActiveTest ? 'Continue your test' : `Take the test · ${topic.testLength} questions`}</button></div><p class="caption topic-meta">${practised}</p><section class="rule-card" aria-labelledby="rule-heading"><h2 id="rule-heading">The rule</h2>${topic.guide ? guideHTML(topic.guide) : '<p>Opening the rule…</p>'}</section><section class="test-history" aria-labelledby="history-heading"><h2 id="history-heading">Your tests</h2>${history}</section></section>`;
}
// Complete (and most choose) sources hold a ____ blank: show the whole sentence rather than the missing word alone.
function completed(type, source, text) {
  return (type === 'complete' || type === 'choose') && /_{2,}/.test(source) ? source.replace(/_{2,}/, text).replace(/(['’‘ʼ])\s+/g, '$1') : text;
}
function promptHTML(exercise) {
  if (exercise.type === 'conjugate') {
    const [verb, subject, tense] = exercise.source.split(' · ');
    return `<dl class="conjugate-parts"><div><dt>Verb</dt><dd lang="fr">${esc(verb)}</dd></div><div><dt>Subject</dt><dd lang="fr">${esc(subject)}</dd></div><div><dt>Tense</dt><dd lang="fr">${esc(tense)}</dd></div></dl>`;
  }
  // An English cue in the sentence ("(she does not lend them to us)") is glossed as itself; it is not made tappable.
  const gloss = (exercise.gloss || []).filter((entry) => !(entry.fr === entry.en && /\s/.test(entry.fr)));
  return `<p class="prompt-sentence" lang="${exercise.type === 'translate' ? 'en' : 'fr'}">${exercise.type === 'translate' ? esc(exercise.source) : glossedHTML(exercise.source, gloss)}</p>`;
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
      return `<button class="choice${missed ? ' wrong' : right ? ' right' : ''}" data-choice="${esc(option)}" ${disabled || missed ? 'disabled' : ''}><span lang="fr">${esc(option)}</span>${mark}</button>`;
    }).join('')}</div>`;
  }
  if (exercise.type === 'conjugate') return `<label class="answer-label" for="answer">Verb form</label><input id="answer" class="answer-line" lang="fr" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="Write the verb form…" value="${esc(draft)}" ${disabled ? 'readonly' : ''}>`;
  const label = ({ complete: 'Missing word', translate: 'Your French' })[exercise.type] || 'Your answer';
  const placeholder = ({ complete: 'Type the missing word…', translate: 'Write it in French…' })[exercise.type] || 'Write your sentence…';
  return `<label class="answer-label" for="answer">${label}</label><textarea id="answer" lang="fr" autocomplete="off" autocapitalize="sentences" spellcheck="false" placeholder="${placeholder}" ${disabled ? 'readonly' : ''}>${esc(draft)}</textarea>`;
}
// After a miss: what you gave against the answer, why that answer is wrong (when it was anticipated), the steps that
// solve this kind of question, and once settled the guide table with the answer's row marked.
function feedbackHTML(current, test) {
  const feedback = current.feedback;
  if (!feedback) return '';
  const exercise = current.exercise;
  const tone = feedback.kind === 'incorrect' ? 'warn' : feedback.kind === 'alternative' || feedback.kind === 'shown' ? 'neutral' : '';
  const title = test && current.settled
    ? ({ correct: 'That’s right.', incorrect: 'Not quite.', alternative: 'Valid French, different form.' })[feedback.kind]
    : ({ correct: current.assisted || current.attempts > 1 ? 'You’ve got it.' : 'That’s right.', incorrect: 'Not quite yet.', alternative: 'Valid French, different form.', shown: 'One correct answer' })[feedback.kind];
  const answer = feedback.answer ? completed(exercise.type, exercise.source, feedback.answer) : '';
  const showAnswer = answer && (feedback.kind === 'shown' || (test && feedback.kind !== 'correct'));
  const given = current.settled && feedback.kind !== 'correct' ? current.misses.at(-1) : '';
  const compare = showAnswer && given
    ? `<div class="fb-compare"><p><span class="fb-label">${exercise.type === 'choose' ? 'You chose' : 'You wrote'}</span><span class="fb-yours" lang="fr">${frEsc(completed(exercise.type, exercise.source, given))}</span></p><p><span class="fb-label">The answer</span><span lang="fr">${frEsc(answer)}</span></p></div>`
    : showAnswer ? `<p class="model-answer" lang="fr">${frEsc(answer)}</p>` : '';
  const why = feedback.why ? `<p class="fb-why">${frEsc(feedback.why)}</p>` : '';
  // A try-again message only repeats what an anticipated mistake's why already says.
  const message = feedback.why && !current.settled ? '' : `<p>${frEsc(feedback.message)}</p>`;
  const independent = feedback.kind === 'correct' && current.attempts === 1 && !current.assisted;
  const help = current.help && !independent ? current.help : null;
  const steps = help ? `<div class="fb-steps"><p class="fb-label">${current.settled ? 'Next time' : 'How to work it out'}</p><ol>${help.steps.map((step) => `<li>${frEsc(step)}</li>`).join('')}</ol></div>` : '';
  const table = help?.row && help.section.table ? `<div class="fb-table"><p class="fb-label">From the rule · ${esc(help.section.title)}</p>${guideTableHTML(help.section.table, help.row)}</div>` : '';
  const clip = current.settled && current.audio ? `<button class="quiet audio-line" data-action="grammar-audio" aria-label="Hear the correct French sentence">${speaker}<span>Hear it</span></button>` : '';
  return `<div class="feedback ${tone}" role="status"><strong>${title}</strong>${feedback.note ? `<p>${esc(feedback.note)}</p>` : ''}${compare}${why}${message}${steps}${table}${feedback.spelling && answer ? `<span class="minor">A spelling detail to review: <span lang="fr">${esc(answer)}</span></span>` : ''}${feedback.kind === 'shown' ? '<span class="minor">This example stays in your revisit set.</span>' : ''}${clip}${!test && !current.settled ? `<button class="quiet" data-action="show-answer" ${locked() ? 'disabled' : ''}>Show one answer instead</button>` : ''}</div>`;
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
  const backButton = unitScope ? back('Grammar', 'grammar') : back('Topic', 'topic-page');
  if (!grammar || loading) { main.innerHTML = `${noticeHTML()}<section class="exercise"><div class="section-top">${backButton}</div><div class="loading-state" role="status">${loading || busy ? (testScope ? 'Opening your test…' : 'Opening your round…') : 'Your progress is saved on your Mac.'}</div></section>`; return; }
  const { session } = grammar;
  const heading = grammar.topic?.title ?? grammar.unit?.title ?? '';
  if (session?.complete) { renderSummary(); return; }
  if (!session?.current) { main.innerHTML = `${noticeHTML()}<section class="summary"><div class="section-top">${backButton}</div><h1>${esc(heading)}</h1><p class="summary-line">${esc(grammar.topic?.description ?? grammar.unit?.description ?? '')}</p><button class="primary dialog-action" data-action="restart" ${locked() ? 'disabled' : ''}>${testScope ? 'Start the test' : 'Start a round'}</button></section>`; return; }
  const test = session.mode === 'test';
  const current = session.current;
  const last = session.index + 1 === session.total;
  const nextText = test ? (last ? 'See your score' : 'Next question') : (last ? 'Finish round' : 'Next sentence');
  const borrowed = unitScope || (grammar.topic && current.exercise.topicId !== grammar.topic.id);
  main.innerHTML = `${noticeHTML()}<section class="exercise"><div class="section-top">${backButton}${test ? '' : `<button class="quiet" data-action="rule" aria-haspopup="dialog" ${locked() ? 'disabled' : ''}>The rule</button>`}</div><div class="exercise-head"><h1>${esc(heading)}</h1><span class="progress">${test ? 'Test · ' : ''}${session.index + 1} / ${session.total}</span></div>${borrowed ? `<p class="question-topic">${unitScope ? '' : 'From earlier · '}${esc(current.exercise.topicTitle)}</p>` : ''}${exerciseCoreHTML(grammar, test, nextText)}</section>`;
}
function resultHTML(result, test, unitTest) {
  const missed = result.outcome !== 'independent';
  const context = result.type === 'translate' || result.type === 'conjugate' || (result.type === 'choose' && !/_{2,}/.test(result.source))
    ? `<span class="result-context" lang="${result.type === 'translate' ? 'en' : 'fr'}">${esc(result.source)}</span>` : '';
  const given = test && (missed || result.spelling) && result.given.trim()
    ? `<span class="result-given">${result.type === 'choose' ? 'You chose' : 'You wrote'}: <span lang="fr">${esc(completed(result.type, result.source, result.given))}</span>${result.spelling ? ' · a spelling detail to review' : ''}</span>` : '';
  const label = test ? (missed ? 'Missed' : 'Right') : ({ independent: 'On your own', helped: 'With help', revisit: 'To revisit' })[result.outcome];
  return `<div class="result${test && missed ? ' missed' : ''}"><div class="result-text">${unitTest ? `<span class="result-topic">${esc(result.topicTitle)}</span>` : ''}<span lang="fr">${esc(completed(result.type, result.source, result.answer))}</span>${context}${given}</div><small>${label}</small></div>`;
}
function renderSummary() {
  const { session } = grammar;
  const unitTest = grammar.kind === 'unit-test';
  const backButton = unitTest ? back('Grammar', 'grammar') : back('Topic', 'topic-page');
  const results = session.results.map((result) => resultHTML(result, session.mode === 'test', unitTest)).join('');
  if (session.mode !== 'test') {
    main.innerHTML = `${noticeHTML()}<section class="summary"><div class="section-top">${backButton}</div><h1>A good place to pause.</h1><p class="summary-line">${esc(grammar.topic.title)}, practised in ${session.results.length} examples.</p><div class="results">${results}</div><div class="summary-actions"><button class="primary" data-action="restart" ${locked() ? 'disabled' : ''}>Another round</button><button class="secondary" data-action="grammar" ${busy ? 'disabled' : ''}>Choose another topic</button></div></section>`;
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
  'listen:gap': 'Type the word missing from what you hear.',
  'read:gap': 'Type the missing word.',
  'listen:dictation': 'Type the sentence you hear.',
  'read:dictation': 'Type the sentence.',
  'listen:question': 'Listen, then answer the question.',
  'read:question': 'Read, then answer the question.',
};
const ITEM_LABEL = { dialogue: 'Dialogue', text: 'Text' };
const LETTER = /[\p{L}\p{M}]/u;
function mixed() { return screen === 'mix' || screen === 'focus'; }
function streamScreen() { return screen === 'listen' || screen === 'read' || (mixed() && mixedSource === 'comprehension'); }
function mistakeGroup() { return (mistakes || []).find((group) => group.id === focusId) || null; }
// Practise alternates comprehension, vocabulary, comprehension, grammar; a mistake group practises what it is about.
function mixedSources() {
  if (screen === 'mix') return ['comprehension', 'vocabulary', 'comprehension', 'grammar'];
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
  return !!review?.session?.current;
}
// A source with nothing to show is skipped, so the pattern never stalls on an empty one.
function advanceMixed(first = false) {
  const sources = mixedSources();
  const from = first ? 0 : mixedStep + 1;
  for (let step = 0; step < sources.length; step++) {
    const at = (from + step) % sources.length;
    if (sourceReady(sources[at])) { mixedStep = at; mixedSource = sources[at]; return; }
  }
  mixedSource = '';
}
function levelFor(mode) {
  const entry = (streamState?.level || []).find((item) => item.mode === mode);
  return entry?.label || levels[mode] || '';
}
function applyStream(next) {
  streamState = next;
  if (!next.result) streamDraft = '';
  let changed = false;
  for (const entry of next.level || []) if (entry?.mode && entry.label && levels[entry.mode] !== entry.label) { levels[entry.mode] = entry.label; changed = true; }
  if (changed) savePreference('echo.levels', JSON.stringify(levels));
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
    // A button is an inline block, so the line may break after it; keep a following " ?" with its word.
    const tail = /^ [?!:;»]/.exec(text.slice(mark.end))?.[0] || '';
    html += `${frEsc(text.slice(at, mark.at))}${tail ? `<span class="nowrap">${button}${frEsc(tail)}</span>` : button}`;
    at = mark.end + tail.length;
  }
  return html + frEsc(text.slice(at));
}
// The glosses of what is on screen: the tapped song line's, a grammar question's, else the Listen/Read item's.
function glossFor(fr) {
  const lyricLine = screen === 'lyrics' ? (() => { const [s, l] = glossLine.split('.').map(Number); return songLyrics?.stanzas?.[s]?.[l]; })() : null;
  if (screen === 'story') { const found = storyView?.episode.gloss.find((entry) => entry.fr === fr); return found?.new ? { ...found, note: 'New in this episode.' } : found ?? null; }
  const lists = screen === 'lyrics' ? [lyricLine?.words] : grammarOnScreen() ? [activeGrammar()?.session?.current?.exercise?.gloss] : [streamState?.result?.gloss, streamState?.current?.gloss];
  for (const list of lists) { const found = (list || []).find((entry) => entry.fr === fr); if (found) return found; }
  return null;
}
function linesHTML(lines, glosses, withEnglish) {
  return `<div class="fr-lines">${lines.map((line) => `<div class="fr-line">${line.speaker ? `<span class="speaker">${esc(line.speaker)}</span>` : ''}<p lang="fr">${glossedHTML(line.fr, glosses)}</p>${withEnglish && line.en ? `<p class="en">${esc(line.en)}</p>` : ''}</div>`).join('')}</div>`;
}
function streamAudioHTML(view, settled) {
  if (!view.audio?.length) return '';
  const big = view.mode === 'listen' && !settled;
  const hint = clipHint();
  const key = `${streamId}:${view.key}`;
  const playing = clipRun?.key === key;
  const spot = !playing && clipSpot?.key === key ? clipSpot : null;
  const icon = playing ? pauseIcon : spot ? playIcon : speaker;
  const label = playing ? 'Pause' : spot && view.audio.length > 1 ? `Continue from line ${spot.index + 1}` : big ? 'Play the French' : 'Play the French again';
  const button = `<button class="${big ? 'listen-play' : 'icon'}" data-action="play-clips" aria-label="${esc(label)}">${icon}</button>`;
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
    else if (prompt.text) html += `<p class="fr-text" lang="fr">${glossedHTML(prompt.text, glosses)}</p>`;
  }
  if (prompt.question) html += `<p class="stream-question">${esc(prompt.question)}</p>`;
  return html;
}
function streamAnswerHTML(view, result) {
  const settled = !!result;
  if (view.choices?.length) {
    return `<div class="choice-list" role="group" aria-label="Choose your answer">${view.choices.map((choice, index) => {
      const right = settled && choice === result.expected;
      const wrong = settled && !right && choice === result.given;
      const mark = right ? '<span class="choice-mark"><span aria-hidden="true">✓</span><span class="sr-only">the answer</span></span>'
        : wrong ? '<span class="choice-mark"><span aria-hidden="true">✕</span><span class="sr-only">what you chose</span></span>' : '';
      return `<button class="choice${wrong ? ' wrong' : right ? ' right' : ''}" data-pick="${index}" ${settled || locked() ? 'disabled' : ''}><span>${esc(choice)}</span>${mark}</button>`;
    }).join('')}</div>`;
  }
  if (settled) return '';
  if (view.kind === 'gap') return `<label class="answer-label" for="stream-answer">The missing word</label><input id="stream-answer" class="answer-line" lang="fr" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="Type the word…" value="${esc(streamDraft)}" ${locked() ? 'disabled' : ''}>`;
  return `<label class="answer-label" for="stream-answer">${view.mode === 'listen' ? 'What you heard' : 'The sentence'}</label><textarea id="stream-answer" class="dictation" rows="2" lang="fr" autocomplete="off" autocapitalize="sentences" spellcheck="false" placeholder="Type the sentence…" ${locked() ? 'disabled' : ''}>${esc(streamDraft)}</textarea>`;
}
function streamResultHTML(view, result) {
  const tone = result.outcome === 'incorrect' ? 'warn' : result.outcome === 'helped' ? 'neutral' : '';
  const title = ({ correct: 'That’s right.', helped: 'Right — after a look at the words.', incorrect: 'Not quite.' })[result.outcome] || '';
  const chosen = !!view.choices?.length;
  const diff = result.diff?.length ? `<p class="diff" lang="fr">${result.diff.map((part, index) => `${index && /^[?!:;»]/.test(part.text) ? '\u00a0' : index ? ' ' : ''}<span class="${part.ok ? 'kept' : 'missed'}">${frEsc(part.text)}</span>`).join('')}</p>` : '';
  // A right answer already shows itself; the expected one is worth its own line only when it differs.
  const expected = diff || (result.outcome === 'incorrect' || result.spelling ? `<p class="model-answer" lang="${chosen ? 'en' : 'fr'}">${chosen ? esc(result.expected) : frEsc(result.expected)}</p>` : '');
  const given = !chosen && result.outcome === 'incorrect' && result.given?.trim() ? `<span class="minor">You wrote: <span lang="fr">${frEsc(result.given)}</span></span>` : '';
  const spelling = result.spelling ? '<span class="minor">Accepted — a small spelling or accent slip.</span>' : '';
  const missed = result.diff?.some((part) => !part.ok) ? '<span class="minor">The words in pink are the ones you missed.</span>' : '';
  return `<div class="feedback ${tone}" role="status"><strong>${title}</strong>${expected}${result.explanation ? `<p>${esc(result.explanation)}</p>` : ''}${given}${spelling}${missed}</div>`;
}
function streamRevealHTML(result) {
  if (!result.lines?.length) return '';
  return `<section class="reveal" aria-label="The French and its meaning">${linesHTML(result.lines, result.gloss, true)}<p class="caption">Tap any word for its meaning.</p></section>`;
}
function streamBodyHTML() {
  const view = streamState.current;
  const result = streamState.result;
  const settled = !!result;
  const item = view.item || {};
  const label = ITEM_LABEL[item.type];
  const context = label ? `<p class="stream-item">${esc(label)}${item.title ? ` · ${esc(item.title)}` : ''}</p>` : '';
  const action = settled
    ? `<button class="primary" data-action="stream-next" ${locked() ? 'disabled' : ''}>${busy ? 'Saving…' : 'Next'}</button>`
    : view.choices?.length ? '' : `<button class="primary" data-action="stream-check" ${locked() ? 'disabled' : ''}>${busy ? 'Checking…' : 'Check'}</button>`;
  return `${context}<p class="prompt-instruction">${esc(STREAM_INSTRUCTION[`${view.mode}:${view.kind}`] || '')}</p>${streamAudioHTML(view, settled)}${streamPromptHTML(view, settled)}<div class="answer-area">${streamAnswerHTML(view, result)}</div>${settled ? `${streamResultHTML(view, result)}${streamRevealHTML(result)}` : ''}${action ? `<div class="stream-actions${settled ? ' pinned' : ''}">${action}</div>` : ''}`;
}
function streamEmptyHTML(id) {
  if (id.startsWith('focus:')) return '<div class="stream-empty"><p>Nothing left to practise here for now.</p><button class="secondary" data-action="mistakes">Back to mistakes</button></div>';
  if (id === 'read') return '<div class="stream-empty"><p>There is nothing to read yet.</p><button class="secondary" data-action="home">Back to Home</button></div>';
  return '<div class="stream-empty"><p>Recordings are still being prepared — try Read meanwhile.</p><button class="secondary" data-action="read">Go to Read</button></div>';
}
function renderStream() {
  const mode = screen === 'read' ? 'read' : 'listen';
  const label = levelFor(mode);
  const header = `<div class="section-top">${back('Home', 'home')}${label ? `<span class="level-tag">${esc(label)}</span>` : ''}</div>`;
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
    : mixedSource === 'vocabulary' ? 'Vocabulary' : mixedSource === 'grammar' ? 'Grammar' : '';
  const label = focus ? `${group ? group.title : 'Mistakes'}${source ? ` · ${source}` : ''}` : source;
  const header = `<div class="section-top">${back(focus ? 'Mistakes' : 'Home', focus ? 'mistakes' : 'home')}<span class="stream-label">${esc(label)}</span></div>`;
  if (loading) { main.innerHTML = `${noticeHTML()}<section class="stream">${header}<div class="loading-state" role="status">Opening your practice…</div></section>`; return; }
  const vocabulary = mixedSource === 'vocabulary' && snapshot?.current;
  let body;
  if (mixedSource === 'comprehension' && streamState?.current) body = streamBodyHTML();
  else if (vocabulary) body = cardHTML();
  else if (mixedSource === 'grammar' && review?.session?.current) body = `<p class="question-topic">${esc(review.session.current.exercise.topicTitle)}</p>${exerciseCoreHTML(review, false, 'Next')}`;
  else body = focus
    ? '<div class="stream-empty"><p>Nothing left to practise here for now.</p><button class="secondary" data-action="mistakes">Back to mistakes</button></div>'
    : '<div class="stream-empty"><p>Nothing to practise right now. New words arrive at 04:00, and recordings are still being prepared.</p><button class="secondary" data-action="home">Back to Home</button></div>';
  main.innerHTML = `${noticeHTML()}<section class="${vocabulary ? 'practice' : 'stream'}">${header}${body}</section>`;
  if (vocabulary) playCardOnce();
  else if (mixedSource === 'comprehension') autoplay();
}
function renderMistakes() {
  const header = `<div class="section-top">${back('Home', 'home')}</div><h1>Mistakes</h1><p class="subtitle">What keeps catching you out. Tap one to practise it.</p>`;
  if (!mistakes || loading) { main.innerHTML = `${noticeHTML()}<section class="topics">${header}${loading ? '<div class="loading-state" role="status">Looking at what you missed…</div>' : ''}</section>`; return; }
  if (!mistakes.length) { main.innerHTML = `${noticeHTML()}<section class="topics">${header}<p class="empty-list">No mistakes recorded yet.</p></section>`; return; }
  const rows = mistakes.map((group) => {
    const examples = (group.examples || []).slice(0, 3).map((example) => `<p lang="fr">${frEsc(example)}</p>`).join('');
    return `<button class="topic-row" data-group="${esc(group.id)}" ${locked() ? 'disabled' : ''}><span class="copy"><span class="topic-name"><h3>${esc(group.title)}</h3></span>${examples}</span><span class="arrow" aria-hidden="true">→</span></button>`;
  }).join('');
  main.innerHTML = `${noticeHTML()}<section class="topics">${header}<div class="topic-list">${rows}</div></section>`;
}
async function loadStream(id, message = '') {
  const token = ++streamGeneration;
  streamId = id; streamState = null; streamDraft = ''; audioBlocked = false; loading = true;
  notice = message ? { kind: 'info', message } : null; retryAction = null;
  render();
  try {
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
function openMistakes() { if (move('mistakes', true)) loadMistakes(); }
// ── Statistics ───────────────────────────────────────────────────────────────
// statsBin is the score bar whose words are listed (null: none); bars run from -8 to 8, the ends holding everything beyond.
let statistics = null;
let statsBin = null;
let statsOpen = false; // the chosen bar's word list starts closed, and opens when a bar is tapped
let pointsDay = ''; // the day whose points are spelled out under the chart; today until another is tapped
// The Word scores chart can show the end of any past day (statistics.history, oldest first, today last); statsAt
// is the day shown. A past day's words load when its bar list is opened, once per visit.
let statsAt = 0;
let statsPlay = 0;
const statsDayWords = new Map(); // day → words, or 'loading'
const points = (value) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(Math.round(value * 10) / 10).toLocaleString('en')}`;
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
  return `<p class="st-big"><strong>${shown.know.toLocaleString('en')}</strong> ${shown.know === 1 ? 'word' : 'words'} you ${past ? 'knew' : 'know'}</p>
      <p class="st-sub">and ${shown.learning ? `${shown.learning} still learning` : 'none still learning'}, out of ${shown.total.toLocaleString('en')}.</p>
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
  const list = !statsOpen ? '' : !chosen ? '<p class="st-cap" role="status">Loading that day’s words…</p>' : chosen.length ? `<ol>${chosen.map((word) => `<li><span class="fr${genderClass(word.gender)}" lang="fr">${frEsc(word.fr)}</span><span class="en">${esc(word.en)}</span></li>`).join('')}</ol>` : '';
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
// The Verbs part of Statistics: forms now; their scores at the end of each day, with the day shown at vScoreAt (-1:
// today), the bar picked and its list; the points of the last two weeks; and answers and scores by tense and person.
let vScoreAt = -1, vScorePlay = 0, vScoreBin = null, vScoreOpen = true, vPointsDay = '';
const vScoreDayForms = new Map(); // day → its forms with their scores then, or 'loading'
const vsDays = () => statistics?.verbs?.scores.days ?? [];
const vsIndex = () => vScoreAt < 0 ? vsDays().length - 1 : vScoreAt;
const vsSeg = ({ solid, getting, shaky }, height = 10) => { const all = solid + getting + shaky || 1; return `<div class="vs-seg" style="height:${height}px"><span class="s" style="width:${solid / all * 100}%"></span><span class="g" style="width:${getting / all * 100}%"></span><span class="w" style="width:${shaky / all * 100}%"></span></div>`; };
const vsLegend = '<div class="st-legend"><span><i style="background:var(--violet)"></i>solid</span><span><i style="background:#6e6aa8"></i>getting there</span><span><i style="background:var(--danger)"></i>shaky</span></div>';
function vsRow(label, sub, cell, action = '') {
  const share = cell.total ? Math.round(cell.right / cell.total * 100) : null;
  const inner = `<span class="vs-lbl" lang="fr">${esc(label)}<small>${esc(sub)}</small></span><span class="vs-track"><span style="width:${share ?? 0}%"></span></span><span class="vs-pct">${share === null ? '—' : `${share}%`}</span>`;
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
  return `<p class="st-big"><strong>${shown.solid}</strong> ${shown.solid === 1 ? 'form' : 'forms'} scoring +3 or more</p>
      <p class="st-sub">${shown.shaky} at −2 or less, out of ${shown.practised} you ${past ? 'had' : 'have'} practised.</p>
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
  const list = !vScoreOpen ? '' : !chosen ? '<p class="st-cap" role="status">Loading that day’s forms…</p>' : chosen.length ? `<ol>${chosen.map((form) => `<li><span class="fr" lang="fr">${frEsc(form.form)}</span><span class="en">${esc(form.inf)} · ${esc(form.tenseName)}</span></li>`).join('')}</ol>` : '';
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
function verbPointsHTML() {
  const days = statistics.verbs.scores.points, today = days.at(-1);
  const shown = days.find((day) => day.day === vPointsDay) ?? today;
  const net = (day) => day.gained - day.lost;
  const top = Math.max(0, ...days.map(net)), bottom = Math.max(0, ...days.map((day) => -net(day)));
  const rows = top + bottom ? `grid-template-rows:${top}fr ${bottom}fr` : '';
  const bars = days.map((day) => `<button class="st-pt" style="${rows}" data-action="stats-vpoints" data-day="${day.day}" aria-pressed="${day.day === shown.day}" aria-label="${esc(dayLabel(`${day.day}T12:00`))}: ${points(net(day))} points"><span class="up"><span style="height:${top ? Math.max(0, net(day)) / top * 100 : 0}%"></span></span><span class="down"><span style="height:${bottom ? Math.max(0, -net(day)) / bottom * 100 : 0}%"></span></span></button>`).join('');
  const label = shown.day === today.day ? 'today' : `on ${new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${shown.day}T12:00`))}`;
  return `<p class="st-big"><strong>${points(net(shown))}</strong> ${esc(label)}</p>
      <p class="st-sub">${shown.gained || shown.lost ? `+${shown.gained} gained, −${shown.lost} lost` : 'Nothing practised'}</p>
      <div class="st-points">${bars}</div><div class="st-days-axis">${days.map((day, index) => `<span>${index % 2 === 1 ? Number(day.day.slice(8)) : ''}</span>`).join('')}</div>`;
}
// Average score rows (by tense, by person), tagged like the categories; the bar shows how many forms are behind it.
function verbScoreRows(entries) {
  const most = Math.max(1, ...entries.map(([, cell]) => cell.forms));
  const feel = (average) => average === null ? '' : average < 0 ? 'shaky' : average < 2 ? 'steady' : 'solid';
  // Rounded first, so an average of -0.04 reads 0.0 and is steady, not shaky.
  return entries.map(([label, cell]) => { const average = cell.average === null ? null : Math.round(cell.average * 10) / 10 || 0; return `<li><div class="name"><p lang="fr">${esc(label)}</p><small>${cell.forms ? `${cell.forms} ${cell.forms === 1 ? 'form' : 'forms'} · average ${average > 0 ? '+' : average < 0 ? '−' : ''}${Math.abs(average).toFixed(1)}` : 'not practised yet'}</small></div><div class="st-mini"><span style="width:${cell.forms / most * 100}%"></span></div><span class="st-tag ${feel(average)}">${feel(average)}</span></li>`; }).join('');
}
function verbStatsHTML() {
  const verbs = statistics.verbs;
  if (!verbs) return '';
  const { forms, scores } = verbs;
  if (!forms.practised) return `<div class="st-block"><h2>Verb forms</h2><p class="st-cap">Practise in Verbs and your forms show up here: one verb, in one tense, for one person.</p></div>`;
  const tenses = Object.entries(VB_TENSES).map(([tense, name]) => vsRow(name, verbs.tenses[tense].total ? `${verbs.tenses[tense].total} answers` : 'not practised lately', verbs.tenses[tense], `data-action="vb-tense-page" data-tense="${tense}"`)).join('');
  const people = VB_PERSONS.map((person, index) => vsRow(person, `${verbs.people[index].total} answers`, verbs.people[index])).join('');
  const kinds = verbs.kinds.map((kind) => vsRow(kind.title, `${VB_TENSES[kind.tense]} · ${kind.total} answers`, kind, `data-action="vb-tense-page" data-tense="${kind.tense}"`)).join('');
  const answered = verbs.people.some((cell) => cell.total);
  return `<div class="st-block">${stHead('Verb forms', 'A form is one verb in one tense for one person. Solid: your last two answers right; shaky: your last one wrong. Cards, Quick forms and Whole table all count.')}
      <p class="st-big"><strong>${forms.solid}</strong> forms solid</p>
      <p class="st-sub">${forms.getting} getting there and ${forms.shaky} shaky, of ${forms.practised} you’ve practised — out of ${forms.total.toLocaleString('en')} forms of your verbs in four tenses.</p>
      ${vsSeg(forms, 14)}${vsLegend}</div>
    <div class="st-block">${stHead('Verb form scores', 'Each bar counts your practised forms (one verb, one tense, one person) with that score. A typed answer right adds 2 and wrong takes 3 off; a Cards or Walkman mark adds 1 or takes 2 off; scores drift back towards the middle over a few weeks. Quick forms, Cards, Next table and the Walkman verb tape bring the left side most. Choose a day, or press ▶, to see the chart as it was; the dashed outline is today. Tap a bar to see its forms.')}
      <div id="vs-scores">${verbScoresHTML()}</div>
      ${vsDays().length > 1 ? `<div class="st-when" id="vs-when">${verbScoresWhenHTML()}</div>
      <input type="range" class="st-slider" id="vs-slider" min="0" max="${vsDays().length - 1}" step="1" value="${vsIndex()}" aria-label="Choose a day">
      <div class="st-ticks" aria-hidden="true">${vsDays().map((day, index, all) => `<span>${index === all.length - 1 ? 'today' : (all.length - 1 - index) % 2 === 0 ? Number(day.day.slice(8)) : ''}</span>`).join('')}</div>` : ''}
      <div id="vs-scores-after">${verbScoresAfterHTML()}</div></div>
    <div class="st-block">${stHead('Verb points, last two weeks', 'The points your verb scores are made of: +2 or −3 for a typed answer, +1 or −2 for a Cards or Walkman mark. Each bar is the day’s total: above the line when you gained more than you lost, below it when you lost more. Tap a day to see its total.')}${verbPointsHTML()}</div>
    ${answered ? `<div class="st-block">${stHead('Verb answers, last two weeks', 'The share you got right. The kinds are the groups on each tense page: tap a tense or a kind to read about it.')}
      <p class="vs-label">By tense</p><div class="vs-rows">${tenses}</div>
      <p class="vs-label">By person</p><div class="vs-rows">${people}</div>
      <p class="vs-label">By kind of verb</p><div class="vs-rows">${kinds}</div></div>` : ''}
    <div class="st-block">${stHead('By tense', 'Shaky, steady or solid is the average score of the forms you have practised in that tense.')}<ol class="st-rows">${verbScoreRows(Object.entries(VB_TENSES).map(([tense, name]) => [name, scores.tenses[tense]]))}</ol></div>
    <div class="st-block">${stHead('By person', 'Shaky, steady or solid is the average score of your forms for that person, across every verb and tense.')}<ol class="st-rows">${verbScoreRows(VB_PERSONS.map((person, index) => [person, scores.people[index]]))}</ol></div>
    <div class="st-block">${stHead('Hardest forms right now', 'The five forms with the lowest score. Tap one to fill in its whole table.')}<ol class="st-rows">${scores.hardest.map((form) => `<li><button class="st-row-link" data-action="vb-cell" data-verb="${esc(form.verbId)}" data-tense="${form.tense}"><div class="name"><p lang="fr" class="fr">${frEsc(form.form)}</p><small>${esc(form.inf)} · ${esc(form.tenseName)}</small></div><span class="st-tag shaky">missed ${form.misses}×</span></button></li>`).join('')}</ol></div>`;
}
function renderStatistics() {
  const header = `<div class="section-top">${back('Home', 'home')}</div><h1>Your progress</h1><p class="subtitle">How your French words are doing. Nothing here is a target.</p>`;
  if (!statistics || loading) { main.innerHTML = `${noticeHTML()}<section class="st">${header}${loading ? '<div class="loading-state" role="status">Adding it all up…</div>' : ''}</section>`; return; }
  const { words, counts } = statistics;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const parts = [['learning', 'learning', 'var(--violet)'], ['due', 'due now', '#d7c38a'], ['scheduled', 'known', '#6e6aa8'], ['new', 'not started', 'var(--frame)']];
  const stack = parts.map(([key, , colour]) => `<span style="width:${counts[key] / total * 100}%;background:${colour}"></span>`).join('');
  const legend = parts.map(([key, label, colour]) => `<span><i style="background:${colour}"></i><b>${counts[key]}</b>${label}</span>`).join('');
  const hardest = words.filter((word) => word.score < 0).slice(0, 6);
  const hard = hardest.length ? `<ol class="st-rows">${hardest.map((word) => `<li><div class="name"><p lang="fr" class="fr${genderClass(word.gender)}">${frEsc(word.fr)}</p><small>${esc(word.en)}</small></div><span class="st-tag shaky">missed ${word.misses}×</span></li>`).join('')}</ol>` : '<p class="st-cap">Nothing shaky right now.</p>';
  const feel = (average) => average === null ? '' : average < 0 ? 'shaky' : average < 2 ? 'steady' : 'solid';
  const categories = statistics.categories.map((category) => `<li><div class="name"><p>${esc(categoryTitle(category.id))}</p><small>${category.started} of ${category.total} started</small></div><div class="st-mini"><span style="width:${category.started / category.total * 100}%"></span></div>${category.average === null ? '<span class="st-tag"></span>' : `<span class="st-tag ${feel(category.average)}">${feel(category.average)}</span>`}</li>`).join('');
  const busiest = Math.max(1, ...statistics.days.map((day) => day.knew + day.missed));
  const days = statistics.days.map((day) => day.knew + day.missed
    ? `<div title="${esc(dayLabel(`${day.day}T12:00`))}: ${day.knew} knew, ${day.missed} missed"><span class="k" style="height:${day.knew / busiest * 100}%"></span><span class="m" style="height:${day.missed / busiest * 100}%"></span></div>`
    : '<div><span class="empty"></span></div>').join('');
  const dayAxis = statistics.days.map((day, index) => `<span>${index % 2 === 1 ? Number(day.day.slice(8)) : ''}</span>`).join('');
  const today = statistics.days.at(-1);
  const shown = statistics.days.find((day) => day.day === pointsDay) ?? today;
  const net = (day) => day.gained - day.lost;
  // The line sits where the days put it: with no losing day, the whole height is for gains.
  const top = Math.max(0, ...statistics.days.map(net)), bottom = Math.max(0, ...statistics.days.map((day) => -net(day)));
  const rows = top + bottom ? `grid-template-rows:${top}fr ${bottom}fr` : '';
  const pointBars = statistics.days.map((day) => `<button class="st-pt" style="${rows}" data-action="points-day" data-day="${day.day}" aria-pressed="${day.day === shown.day}" aria-label="${esc(dayLabel(`${day.day}T12:00`))}: ${points(net(day))} points"><span class="up"><span style="height:${top ? Math.max(0, net(day)) / top * 100 : 0}%"></span></span><span class="down"><span style="height:${bottom ? Math.max(0, -net(day)) / bottom * 100 : 0}%"></span></span></button>`).join('');
  const shownLabel = shown.day === today.day ? 'Today' : new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${shown.day}T12:00`));
  const pointsBlock = `<div class="st-block">${stHead('Points, last two weeks', 'The points your word scores are made of: +2 for a word you knew and −3 for one you missed in Vocabulary, +0.5 for a word heard to the end on the Walkman, ✓ and ✗ on the Walkman counting the same as knowing or missing, and +1 or −1 for each Endless answer. Each bar is the day’s total: above the line when you gained more than you lost, below it when you lost more. Tap a day to see its total.')}
      <p class="st-big"><strong>${points(net(shown))}</strong> ${esc(shownLabel.toLowerCase() === 'today' ? 'today' : `on ${shownLabel}`)}</p>
      ${shown.gained || shown.lost ? '' : '<p class="st-sub">Nothing practised</p>'}
      <div class="st-points">${pointBars}</div><div class="st-days-axis">${statistics.days.map((day, index) => `<span>${index % 2 === 1 ? Number(day.day.slice(8)) : ''}</span>`).join('')}</div></div>`;
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
  const accuracyBlock = `<div class="st-block">${stHead('Right answers, last two weeks', 'Each bar is the share of that day’s answers you got right, out of 100%; the number beside each row covers both weeks. In Listen and Read, an answer right with help counts as right.')}
      ${accuracyRow('Words', statistics.days.map((day) => ({ right: day.knew, total: day.knew + day.missed })))}
      ${accuracyRow('Listen', comprehensionDays.map((day) => day.listen))}
      ${accuracyRow('Read', comprehensionDays.map((day) => day.read))}
      <div class="st-days-axis">${dayAxis}</div></div>`;
  const level = (mode) => statistics.levels.find((entry) => entry.mode === mode)?.label ?? 'A1';
  const facts = [[level('listen'), 'Listen level'], [level('read'), 'Read level'], [statistics.answered, 'Listen & Read questions answered'], [statistics.grammarTopics, statistics.grammarTopics === 1 ? 'grammar topic practised' : 'grammar topics practised'], [statistics.walkmanHeard, 'words heard on the Walkman'], [counts.scheduled, 'known words waiting for review']];
  main.innerHTML = `${noticeHTML()}<section class="st">${header}
    <div class="st-block">${stHead('Word scores', `Each bar counts the started words with that score. Recalling a word moves it right, missing it moves it left, and scores drift back to the middle over a few weeks. The Walkman plays the left side most. ${statistics.history.length > 1 ? 'Choose a day to see the chart as it was at the end of it; the dashed outline is today. ' : ''}Tap a bar to see its words.`)}
      <div id="st-scores">${scoresViewHTML()}</div>
      ${statistics.history.length > 1 ? `<div class="st-when" id="st-when">${scoresWhenHTML()}</div>
      <input type="range" class="st-slider" id="st-slider" min="0" max="${statistics.history.length - 1}" step="1" value="${statsAt}" aria-label="Choose a day">
      <div class="st-ticks" aria-hidden="true">${statistics.history.map((day, index, all) => `<span>${index === all.length - 1 ? 'today' : (all.length - 1 - index) % 2 === 0 ? Number(day.day.slice(8)) : ''}</span>`).join('')}</div>` : ''}
      <div id="st-scores-after">${scoresAfterHTML()}</div></div>
    ${pointsBlock}
    ${accuracyBlock}
    <div class="st-block"><h2>Your ${total.toLocaleString('en')} words</h2><div class="st-stack">${stack}</div><div class="st-legend">${legend}</div></div>
    <div class="st-block"><h2>Hardest right now</h2>${hard}</div>
    <div class="st-block">${stHead('By category', 'Shaky, steady or solid is the average score of the words you’ve started there.')}<ol class="st-rows">${categories}</ol></div>
    <div class="st-block"><h2>Vocabulary answers, last two weeks</h2><div class="st-days">${days}</div><div class="st-days-axis">${dayAxis}</div>
      <div class="st-legend"><span><i style="background:var(--violet)"></i>knew it</span><span><i style="background:var(--danger)"></i>missed</span></div></div>
    ${verbStatsHTML()}
    <div class="st-block"><h2>Everything else</h2><div class="st-facts">${facts.map(([value, label]) => `<div class="st-fact"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('')}</div></div>
  </section>`;
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
  const header = `<div class="section-top">${back('Vocabulary', 'start')}</div><h1>Words from a song</h1><p class="subtitle">Find a French song; Claude reads it and turns its words into flashcards in their dictionary form. Only the words are kept.</p>`;
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
// How much of the song's words you know, and how much you are learning, as one bar.
function understoodHTML(understood) {
  if (!understood) return '';
  return `<div class="song-known"><p><strong>You know ${understood.known}%</strong> of the words in this song${understood.learning ? ` · ${understood.learning}% still learning` : ''}</p><span class="song-known-bar"><span class="k" style="width:${understood.known}%"></span><span class="l" style="width:${understood.learning}%"></span></span><p class="caption">Every word as it is sung, little words and names left out. A word counts once you know it in your practice.</p></div>`;
}
function renderSong() {
  const song = songView;
  const header = `<div class="section-top">${back('Songs', 'songs')}</div>`;
  if (!song) { main.innerHTML = `${noticeHTML()}<section class="topics songs">${header}${loading ? '<div class="loading-state" role="status">Opening the song…</div>' : ''}</section>`; return; }
  const readable = (song.status === 'ready' || song.status === 'added') && song.notes !== 'none';
  const title = `<h1>${esc(song.title)}</h1><p class="subtitle">${esc(song.artist || 'Pasted lyrics')}</p>${readable ? `<button class="secondary song-lyrics-open" data-action="song-lyrics">Read the song${song.notes === 'ready' ? '' : ' · notes on the way'}</button>` : ''}`;
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
    const row = (entry) => `<li><button class="song-pick" role="checkbox" aria-checked="${picks.has(entry.fr)}" data-action="song-pick" data-fr="${esc(entry.fr)}"><span class="tick" aria-hidden="true"></span><span class="song-word"><strong lang="fr" class="${genderClass(entry.gender).trim()}">${frEsc(entry.fr)}</strong><span>${esc(entry.en)}</span>${entry.note ? `<small>${esc(entry.note)}</small>` : ''}</span><span class="song-forms" lang="fr">${entry.forms.map(esc).join(', ')}</span></button></li>`;
    body = `<p class="song-hint">Untick any word you don’t want. On the right: how it appears in the song.</p>
      <div class="song-tools"><button class="quiet" data-action="song-pick-all">Tick all</button><button class="quiet" data-action="song-pick-none">Untick all</button></div>
      <ol class="song-picks">${fresh.map(row).join('')}</ol>
      ${known.length ? `<h2 class="song-list-title">Already in your words · ${known.length}</h2><p class="song-hint">They join this song’s deck too, keeping their place in their own category and your progress on them.</p><ol class="song-picks">${known.map(row).join('')}</ol>` : ''}
      ${little.length ? `<h2 class="song-list-title">Little words · ${little.length}</h2><p class="song-hint">Articles, pronouns and the like. Tick any you want as flashcards.</p><ol class="song-picks">${little.map(row).join('')}</ol>` : ''}
      ${song.skipped.length ? `<details class="song-more"><summary>Left out · ${song.skipped.length}</summary><ol class="song-plain">${song.skipped.map((skip) => `<li><strong lang="fr">${esc(skip.form)}</strong> <span>${esc(skip.reason)}</span></li>`).join('')}</ol></details>` : ''}
      <div class="song-add"><button class="primary" data-action="song-add" data-song="${esc(song.id)}" ${busy || !picks.size ? 'disabled' : ''}>Add ${picks.size} ${picks.size === 1 ? 'word' : 'words'}</button></div>`;
  } else {
    const audio = songList?.audio;
    const recording = audio && (audio.pending || audio.recording) ? `Recording the new words on your Mac… ${audio.pending} left. Each one joins your practice as soon as it is recorded.` : audio?.failed?.some((id) => song.added.includes(id)) ? `${audio.failed.filter((id) => song.added.includes(id)).length} could not be recorded and stay out of practice.` : 'Every word is recorded.';
    const linked = song.linked?.length ?? 0;
    body = `<div class="song-progress"><p><strong>${song.added.length}</strong> new ${song.added.length === 1 ? 'word' : 'words'}${linked ? ` and <strong>${linked}</strong> you already had` : ''} in the “${esc(song.title)}” deck.</p><p class="caption">${esc(recording)} New words from songs come ${snapshot?.settings?.songsFirst === false ? 'in turn with your other categories' : 'before your other new words'}; change this in Vocabulary options.</p><div class="summary-actions"><button class="primary" data-action="song-practise" data-category="${esc(song.category)}" ${busy ? 'disabled' : ''}>Practise these words</button></div></div>`;
  }
  main.innerHTML = `${noticeHTML()}<section class="topics songs">${header}${title}${understoodHTML(song.understood)}${body}</section>`;
}
function openSongs() { if (dialog.open) dialog.close(); if (move('songs', true)) loadSongs(); }
function openSong(id) { songId = id; songView = songList?.songs.find((song) => song.id === id) ?? null; if (move(`song|${id}`, true)) loadSong(); }
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
  try { const view = await api(`api/songs/${encodeURIComponent(id)}/lyrics`); if (songId === id) songLyrics = view; }
  catch (error) { notice = { message: error.message }; }
  loading = false;
  if (screen === 'lyrics') render();
  clearTimeout(lyricsPoll);
  if (screen === 'lyrics' && (songLyrics?.notes === 'writing' || songLyrics?.notes === 'waiting')) lyricsPoll = setTimeout(() => { if (screen === 'lyrics' && songId === id) loadLyrics(); }, 8000);
}
function renderLyrics() {
  const view = songLyrics;
  const header = `<div class="section-top">${back('Song', 'song-page')}</div>`;
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
    return `<div class="lyric-line" data-line="${key}">${start}<div class="lyric-text"><p lang="fr">${glossedHTML(line.fr, line.words)}</p>${open ? `<p class="lyric-en">${esc(line.en)}</p>` : ''}</div></div>`;
  }).join('')}</div>`).join('');
  main.innerHTML = `${noticeHTML()}<section class="topics songs lyrics">${header}<h1>${esc(view.title)}</h1><p class="subtitle">${esc(view.artist || 'Pasted lyrics')}</p>${status}<div class="lyric-lines">${lines}</div></section>`;
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
  try { snapshot.settings = await api('api/settings/songs', { method: 'PUT', body: JSON.stringify({ songsFirst: value }) }); openOptions(); }
  catch (error) { notice = { message: error.message }; render(); }
}
function openStatistics() { if (move('statistics', true)) loadStatistics(); }
async function loadStatistics() {
  loading = true; notice = null; retryAction = null; render();
  try {
    statistics = await api('api/statistics');
    stopStatsPlay(); statsAt = statistics.history.length - 1; statsDayWords.clear();
    stopVerbPlay(); vScoreAt = -1; vScoreBin = null; vScoreOpen = true; vPointsDay = ''; vScoreDayForms.clear();
    // The weakest bar is chosen to begin with, its list closed; tapping a bar opens its list.
    statsBin = statistics.words.length ? statsBinOf(statistics.words[0].score) : null;
    statsOpen = false;
    pointsDay = '';
  } catch (error) {
    notice = { message: error.message }; retryAction = { type: 'statistics' };
  }
  loading = false;
  if (screen === 'statistics') render();
}
function chooseStatsBin(bin) { if (statsBin === bin) statsOpen = !statsOpen; else { statsBin = bin; statsOpen = true; } drawScores(); }
function openWalkman() { if (move('walkman', true)) loadTape(); }
// Sounds: pairs that differ by one sound (lib/sounds.ts). One side plays; the learner picks which one they heard,
// then can hear both. A round is ten pairs, the ones missed most first.
let soundList = null;          // api/sounds: each contrast with its recent record
let soundId = '';              // the contrast drilled, or 'mix'
let soundRound = null;         // { questions, index, chose, right }
// The version matches CLIP_VERSION in lib/sounds.ts.
// The version matches WORD_CLIP_VERSION in lib/store.ts.
const wordClipUrl = (id) => `audio/${encodeURIComponent(id)}.mp3?v=2`;
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
  const header = `<div class="section-top">${back('Home', 'home')}<span class="stream-label">Sounds</span></div>`;
  if (loading || !soundList) { main.innerHTML = `${noticeHTML()}<section class="topics">${header}${loading ? '<div class="loading-state" role="status">Loading…</div>' : ''}</section>`; return; }
  const record = (entry) => entry.ready === 0 ? 'Being recorded'
    : entry.recent.total ? `${entry.recent.right} of your last ${entry.recent.total} right` : 'Not tried yet';
  const row = (entry) => `<button class="topic-row" data-action="sound-open" data-sound="${esc(entry.id)}" ${busy || !entry.ready ? 'disabled' : ''}><span class="copy"><span class="topic-name"><h3>${esc(entry.title)}</h3><span class="level-tag">${esc(entry.level)}</span></span><p lang="fr">${entry.labels.map(esc).join(' · ')}</p><small class="topic-progress">${esc(record(entry))}</small></span><span class="arrow" aria-hidden="true">→</span></button>`;
  const ready = soundList.some((entry) => entry.ready);
  const mix = `<button class="topic-row" data-action="sound-open" data-sound="mix" ${busy || !ready ? 'disabled' : ''}><span class="copy"><span class="topic-name"><h3>All sounds</h3></span><p>A mix, with the pairs you miss most first.</p></span><span class="arrow" aria-hidden="true">→</span></button>`;
  main.innerHTML = `${noticeHTML()}<section class="topics">${header}<h1>Sounds</h1><p class="subtitle">Two phrases that differ by one sound. Listen, then choose the one you heard.</p><div class="topic-list">${mix}${soundList.map(row).join('')}</div></section>`;
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
    const pick = `<button class="choice${wrong ? ' wrong' : right ? ' right' : ''}" data-action="sound-choose" data-side="${choice.side}" ${settled ? 'disabled' : ''}><span><span lang="fr">${frEsc(choice.fr)}</span><small class="sound-en">${esc(choice.en)}</small></span>${mark}</button>`;
    const hear = settled ? `<button class="icon sound-hear" data-action="sound-hear" data-side="${choice.side}" aria-label="Hear ${esc(choice.fr)}">${speaker}</button>` : '';
    return `<div class="sound-choice">${pick}${hear}</div>`;
  }).join('');
  const heard = question.choices.find((choice) => choice.side === question.side);
  const feedback = settled ? `<div class="feedback ${chose === question.side ? '' : 'warn'}" role="status"><strong>${chose === question.side ? 'That’s right.' : 'Not quite.'}</strong><p>It was <span lang="fr">${frEsc(heard.fr)}</span>. Tap a speaker to hear each one.</p></div>` : '';
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
// Verbs: conjugation drills on the verbs in the vocabulary (lib/verbs.ts, lib/verb-drills.ts). The room picks
// which verbs and tenses; Quick forms asks one form at a time, Whole table all six persons, By ear which tense
// or how many; the verb map colours every form by how it is doing.
const VB_TENSES = { pres: 'présent', pc: 'passé composé', imp: 'imparfait', fut: 'futur' };
const VB_PERSONS = ['je', 'tu', 'il / elle', 'nous', 'vous', 'ils / elles'];
const VB_SETS = { mine: 'Your verbs', common: 'Most common 20', chosen: 'Choose…' };
const VB_USES = { pres: 'now, always, and what is about to happen', pc: 'what happened: a finished action', imp: 'how things were, what used to happen', fut: 'what will happen' };
const VB_ACCENTS = ['é', 'è', 'ê', 'à', 'â', 'ç', 'î', 'ô', 'ù', 'û'];
const verbsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h7M4 12h5M4 17h7"/><path d="M14 6l3 12 3-12"/></svg>';
let verbsInfo = null;    // api/verbs
let verbsPoll = 0;
let verbSet = (() => { const saved = readPreference('echo.verbs-set', 'mine'); return saved in VB_SETS ? saved : 'mine'; })();
let verbChosen = (() => { try { const list = JSON.parse(readPreference('echo.verbs-chosen', '[]')); return Array.isArray(list) ? list : []; } catch { return []; } })();
let verbTenses = (() => { try { const list = JSON.parse(readPreference('echo.verbs-tenses', '["pres"]')).filter((tense) => tense in VB_TENSES); return list.length ? list : ['pres']; } catch { return ['pres']; } })();
let verbForms = null;      // { items, index, result, given, fetching, done }
let verbCards = null;      // { items, index, size, revealed, marks: [], first: [] }
let verbDraft = '';
let verbTable = { verbId: '', tense: 'pres', answers: ['', '', '', '', '', ''], result: null };
// Whole table either picks the next table from the room's verbs and tenses ('next') or lets you choose one ('choose');
// a table opened from a verb's page is chosen for that visit only. recent: the tables just done, newest first.
let vbTableMode = readPreference('echo.verbs-table-mode', 'next') === 'choose' ? 'choose' : 'next';
let vbTableVisit = vbTableMode;
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
function paradigmHTML(rows, hit = -1) {
  return `<table class="vb-para">${rows.map((row) => `<tr class="${row.person === hit ? 'hit' : ''}"><td lang="fr">${row.parts.map((part) => part.lit ? `<span class="end">${esc(part.text)}</span>` : esc(part.text)).join('')}</td></tr>`).join('')}</table>`;
}
const vbAccentsHTML = () => `<div class="vb-accents" aria-label="Accented letters">${VB_ACCENTS.map((letter) => `<button type="button" data-action="vb-accent" data-letter="${letter}">${letter}</button>`).join('')}</div>`;

function openVerbs() { if (move('verbs', true)) loadVerbs(); }
async function loadVerbs(quiet = false) {
  clearTimeout(verbsPoll);
  if (!quiet) { loading = true; notice = null; retryAction = null; render(); }
  try { verbsInfo = await api('api/verbs'); }
  catch (error) { if (!quiet) { notice = { message: error.message }; retryAction = { type: 'verbs' }; } }
  loading = false;
  if (screen !== 'verbs') return;
  render();
  // While tables are being written, the room looks again now and then.
  if (verbsInfo && verbsInfo.tables.ready < verbsInfo.tables.total && !verbsInfo.tables.error) verbsPoll = setTimeout(() => { if (screen === 'verbs') loadVerbs(true); }, 15000);
}
function renderVerbs() {
  const header = `<div class="section-top">${back('Home', 'home')}<span class="stream-label">Verbs</span></div>`;
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="topics vb">${header}<h1>Verbs</h1><p class="subtitle">Conjugation on its own: pick verbs and tenses, then drill.</p>${body}</section>`; };
  if (loading || !verbsInfo) { shell(loading ? '<div class="loading-state" role="status">Loading…</div>' : ''); return; }
  const { tables } = verbsInfo;
  if (!tables.ready) { shell(`<div class="song-progress" role="status"><p>${tables.error ? `Your verb tables could not be written: ${esc(tables.error)}` : `Echo is writing a table for each of your ${tables.total} verbs. It takes a few minutes.`}</p></div>`); return; }
  const writing = tables.ready < tables.total ? `<p class="caption vb-writing" role="status">${tables.ready} of ${tables.total} verb tables written; the rest follow in a few minutes.</p>` : '';
  const setDetail = { mine: `${verbsInfo.mine} started, shakiest first`, common: 'être, avoir, aller, faire…', chosen: verbChosen.length ? `${verbChosen.length} chosen` : 'pick any' };
  const sets = Object.entries(VB_SETS).map(([set, label]) => `<button class="vb-pill" data-action="vb-set" data-set="${set}" aria-pressed="${verbSet === set}">${label}<small>${esc(setDetail[set])}</small></button>`).join('');
  const chooser = verbSet === 'chosen' ? `<div class="vb-chooser">${[...verbsInfo.verbs].sort((a, b) => Number(b.started) - Number(a.started) || a.inf.localeCompare(b.inf, 'fr')).map((verb) => `<button class="vb-chip" data-action="vb-choose" data-verb="${esc(verb.id)}" aria-pressed="${verbChosen.includes(verb.id)}" lang="fr">${frEsc(verb.inf)}</button>`).join('')}</div>` : '';
  const tenses = Object.entries(VB_TENSES).map(([tense, label]) => `<button class="vb-pill" data-action="vb-tense" data-tense="${tense}" aria-pressed="${verbTenses.includes(tense)}">${label}</button>`).join('');
  const blocked = (verbSet === 'mine' && !verbsInfo.mine) || (verbSet === 'chosen' && !verbChosen.length);
  const ear = verbsInfo.ear.ready < verbsInfo.ear.total ? `${verbsInfo.ear.ready} of ${verbsInfo.ear.total} phrases recorded` : 'hear a form, tell the tense or how many';
  const mode = (action, title, detail, disabled = blocked) => `<button class="topic-row" data-action="${action}" ${busy || disabled ? 'disabled' : ''}><span class="copy"><span class="topic-name"><h3>${title}</h3></span><p>${esc(detail)}</p></span><span class="arrow" aria-hidden="true">→</span></button>`;
  const modes = `${mode('vb-cards', 'Cards', 'think of the form, turn the card, say if you knew it')}${mode('vb-forms', 'Quick forms', 'type one form at a time, as many as you like')}${mode('vb-table', 'Whole table', 'all six persons of one verb', false)}${mode('vb-ear', 'By ear', ear, blocked || !verbsInfo.ear.ready)}`;
  // The map: every verb with a form practised, most shaky forms first.
  const drilled = verbsInfo.verbs.filter((verb) => Object.values(verb.states).some((states) => states.some((state) => state && state !== 'new')));
  const shaky = (verb) => Object.values(verb.states).flat().filter((state) => state === 'shaky').length;
  const rows = drilled.sort((a, b) => shaky(b) - shaky(a)).map((verb) => `<tr><td><button class="vb-name" data-action="vb-verb" data-verb="${esc(verb.id)}" lang="fr">${frEsc(verb.inf)}</button></td>${Object.keys(VB_TENSES).map((tense) => `<td><button class="vb-cell" data-action="vb-cell" data-verb="${esc(verb.id)}" data-tense="${tense}" aria-label="${esc(verb.inf)}, ${VB_TENSES[tense]}">${verb.states[tense].map((state) => `<i class="${state ?? 'none'}"></i>`).join('')}</button></td>`).join('')}</tr>`).join('');
  const map = rows ? `<table class="vb-map"><tr><th></th>${Object.values(VB_TENSES).map((label) => `<th>${label.replace('passé composé', 'passé c.')}</th>`).join('')}</tr>${rows}</table>
    <div class="vb-legend"><span><i class="solid"></i>solid</span><span><i class="getting"></i>getting there</span><span><i class="shaky"></i>shaky</span><span><i class="new"></i>not tried</span></div>` : '<p class="caption">Your map fills in as you practise: one square per person, for each verb and tense.</p>';
  const worst = verbsInfo.worst.length ? `<p class="settings-label vb-label">Forms that catch you most</p><ol class="vb-worst">${verbsInfo.worst.map((entry) => `<li><button data-action="vb-cell" data-verb="${esc(entry.verbId)}" data-tense="${entry.tense}"><span lang="fr">${frEsc(entry.form)}</span><small>${esc(entry.tenseName)}</small><span class="vb-misses">missed ${entry.misses}×</span></button></li>`).join('')}</ol>` : '';
  shell(`${writing}<p class="settings-label vb-label">Which verbs</p><div class="vb-pills">${sets}</div>${chooser}
    <p class="settings-label vb-label">Tenses</p><div class="vb-pills">${tenses}</div>
    <div class="topic-list vb-modes">${modes}</div>
    <h2 class="story-heading">Learn the tenses</h2><div class="topic-list">${Object.entries(VB_TENSES).map(([tense, label]) => `<button class="topic-row" data-action="vb-tense-page" data-tense="${tense}" ${busy ? 'disabled' : ''}><span class="copy"><span class="topic-name"><h3 lang="fr">${label}</h3></span><p>${esc(VB_USES[tense])}</p></span><span class="arrow" aria-hidden="true">→</span></button>`).join('')}</div>
    <div class="dialog-row vb-lookup"><label for="vb-lookup">Look up a verb</label><select id="vb-lookup"><option value="">Choose a verb…</option>${[...verbsInfo.verbs].sort((a, b) => a.inf.localeCompare(b.inf, 'fr')).map((verb) => `<option value="${esc(verb.id)}">${esc(verb.inf)}</option>`).join('')}</select></div>
    <h2 class="story-heading">Verb map</h2>${map}${worst}`);
}
function verbAction(action, button) {
  if (action === 'vb-set') { verbSet = button.dataset.set; savePreference('echo.verbs-set', verbSet); render(); }
  else if (action === 'vb-choose') { const id = button.dataset.verb; verbChosen = verbChosen.includes(id) ? verbChosen.filter((entry) => entry !== id) : [...verbChosen, id]; savePreference('echo.verbs-chosen', JSON.stringify(verbChosen)); render(); }
  else if (action === 'vb-tense') { const tense = button.dataset.tense; const next = verbTenses.includes(tense) ? verbTenses.filter((entry) => entry !== tense) : [...verbTenses, tense]; if (!next.length) return; verbTenses = Object.keys(VB_TENSES).filter((entry) => next.includes(entry)); savePreference('echo.verbs-tenses', JSON.stringify(verbTenses)); render(); }
  else if (action === 'vb-cards') { verbFormsOverride = null; if (move('verbs-cards', true)) startVerbCards(); }
  else if (action === 'vb-card-no' || action === 'vb-card-yes') markVerbCard(action === 'vb-card-yes');
  else if (action === 'vb-forms') { verbFormsOverride = null; if (move('verbs-forms', true)) startVerbForms(); }
  else if (action === 'vb-tense-page') { if (move(`verbs-tense|${button.dataset.tense}`, true)) loadVerbTense(); }
  else if (action === 'vb-verb') openVerbPage(button.dataset.verb);
  else if (action === 'vb-practise-tense') { verbFormsOverride = { set: verbSet, verbIds: verbChosen, tenses: [button.dataset.tense] }; if (move('verbs-forms', true)) startVerbForms(); }
  else if (action === 'vb-practise-verb') { verbFormsOverride = { set: 'chosen', verbIds: [button.dataset.verb], tenses: verbTenses }; if (move('verbs-forms', true)) startVerbForms(); }
  else if (action === 'vb-table') { verbFormsOverride = null; openVerbTable(); }
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
  return `<div class="guide-table-wrap"><table class="guide-table vb-models"><thead><tr>${models.map((model) => `<th scope="col"><button class="vb-name" data-action="vb-verb" data-verb="${esc(model.id)}" lang="fr">${frEsc(model.inf)}</button></th>`).join('')}</tr></thead><tbody>${people.map((person) => `<tr>${models.map((model) => `<td lang="fr">${cell(model, person)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function renderVerbTense() {
  const header = `<div class="section-top">${back('Verbs', 'verbs')}<span class="stream-label">Tense</span></div>`;
  const view = verbTenseView;
  if (loading || !view) { main.innerHTML = `${noticeHTML()}<section class="topic-page vb">${header}${loading ? '<div class="loading-state" role="status">Opening the tense…</div>' : ''}</section>`; return; }
  const groups = view.groups.map((group) => {
    const list = group.many
      ? `<details class="vb-many"><summary>${group.verbs.length} of your verbs</summary><div class="vb-chooser">${group.verbs.map((verb) => `<button class="vb-chip" data-action="vb-verb" data-verb="${esc(verb.id)}" lang="fr">${frEsc(verb.inf)}</button>`).join('')}</div></details>`
      : `<ul class="vb-group-list">${group.verbs.map((verb) => `<li><button data-action="vb-verb" data-verb="${esc(verb.id)}"><span lang="fr" class="vb-inf">${frEsc(verb.inf)}</span><span lang="fr" class="vb-detail">${frEsc(verb.detail)}</span></button></li>`).join('')}</ul>`;
    return `<section class="vb-group"><h3>${esc(group.title)} <span class="vb-count">${group.verbs.length}</span></h3><p class="vb-why">${frEsc(group.text)}</p>${list}</section>`;
  }).join('');
  const guides = view.guides.map((topic) => `<details class="vb-guide"><summary><span>${esc(topic.title)}</span><span class="level-tag">${esc(topic.level)}</span></summary>${guideHTML(topic.guide)}</details>`).join('');
  main.innerHTML = `${noticeHTML()}<section class="topic-page vb">${header}<h1 lang="fr">${esc(view.name)}</h1><p class="subtitle">${esc(view.use)}</p>
    <h2 class="story-heading">The pattern</h2>${modelsHTML(view.models)}<p class="caption">The lit part is what changes from person to person. Tap a verb to see all its tenses.</p>
    <h2 class="story-heading">Your verbs in the ${esc(view.name)}</h2>${groups}
    <h2 class="story-heading">The rules in full</h2><p class="caption">From Grammar. Tap one to open it.</p>${guides}
    <div class="summary-actions"><button class="primary" data-action="vb-practise-tense" data-tense="${view.tense}">Practise the ${esc(view.name)}</button></div></section>`;
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
  const header = `<div class="section-top">${back('Verbs', 'verbs')}<span class="stream-label">Verb</span></div>`;
  const view = verbPageView;
  if (loading || !view) { main.innerHTML = `${noticeHTML()}<section class="topic-page vb">${header}${loading ? '<div class="loading-state" role="status">Opening the verb…</div>' : ''}</section>`; return; }
  const tenses = view.tenses.map((entry) => `<section class="vb-tense-block"><div class="vb-tense-head"><h2 lang="fr">${esc(entry.name)}</h2><button class="quiet" data-action="vb-tense-page" data-tense="${entry.tense}">${esc(entry.group)} →</button></div>${paradigmHTML(entry.paradigm)}<p class="vb-why vb-rule">${frEsc(entry.rule)}</p><button class="quiet vb-table-link" data-action="vb-cell" data-verb="${esc(view.id)}" data-tense="${entry.tense}">Fill in this table</button></section>`).join('');
  main.innerHTML = `${noticeHTML()}<section class="topic-page vb">${header}<h1 lang="fr">${frEsc(view.inf)}</h1><p class="subtitle">${esc(view.en)}</p>
    <div class="summary-actions"><button class="primary" data-action="vb-practise-verb" data-verb="${esc(view.id)}">Practise ${esc(view.inf)}</button></div>${tenses}</section>`;
}

// ── Cards: like vocabulary cards, for forms, and just as endless. Think of the form, tap to turn the card, then left
// if you didn't know it and right if you did. The mark counts for the form like a typed answer; a missed card comes
// back once, a few cards later. More cards are fetched while a few are still waiting, chosen afresh from the marks
// so far, so the stream goes on as long as you do.
const VB_CARDS_AHEAD = 5;
const VB_CARDS_RECENT = 8;
const vbCardKey = (card) => `${card.verbId}|${card.tense}|${card.person}`;
async function startVerbCards() {
  loading = true; notice = null; retryAction = null; verbCards = null; render();
  try { const { items } = await api('api/verbs/cards', { method: 'POST', body: JSON.stringify(vbSettings()) }); verbCards = { items, index: 0, revealed: false, fetching: false, done: false }; }
  catch (error) { notice = { message: error.message }; retryAction = { type: 'verbs-cards' }; }
  loading = false;
  if (screen === 'verbs-cards') render();
}
// Tops a stream (Cards or Quick forms) up from its endpoint; a form already waiting, or seen in the last few, is
// left out so nothing comes straight back. Only the "choosing more" screen is redrawn; a form being looked at is
// left alone.
async function topUpVerbStream(stream, path, current, onScreen) {
  if (!stream || stream.fetching || stream.done || stream.items.length - stream.index > VB_CARDS_AHEAD) return;
  stream.fetching = true;
  const waitingOnScreen = stream.index >= stream.items.length;
  try {
    const { items } = await api(path, { method: 'POST', body: JSON.stringify(vbSettings()) });
    if (current() !== stream) return;
    const near = new Set(stream.items.slice(Math.max(0, stream.index - VB_CARDS_RECENT)).map(vbCardKey));
    const fresh = items.filter((card) => !near.has(vbCardKey(card)));
    const waiting = new Set(stream.items.slice(stream.index).map(vbCardKey));
    // With very few forms to choose from, anything not already waiting will do.
    const added = fresh.length ? fresh : items.filter((card) => !waiting.has(vbCardKey(card)));
    if (!added.length && stream.index >= stream.items.length) stream.done = true;
    stream.items.push(...added);
  } catch (error) { notice = { message: error.message }; }
  stream.fetching = false;
  if (screen === onScreen && current() === stream && waitingOnScreen) render();
}
const topUpVerbCards = () => topUpVerbStream(verbCards, 'api/verbs/cards', () => verbCards, 'verbs-cards');
function renderVerbCards() {
  const header = `<div class="section-top">${back('Verbs', 'verbs')}<span class="stream-label">Cards</span></div>`;
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="stream vb vb-cards">${header}${body}</section>`; };
  if (loading || !verbCards) { shell(loading ? '<div class="loading-state" role="status">Choosing forms…</div>' : ''); return; }
  const { items, index, revealed } = verbCards;
  if (index >= items.length) {
    shell(verbCards.done ? '<p class="caption">No forms to show for these verbs and tenses.</p>' : '<div class="loading-state" role="status">Choosing more forms…</div>');
    topUpVerbCards();
    return;
  }
  const card = items[index];
  const again = card.again ? '<p class="caption vb-again-note">Once more, from a few cards ago.</p>' : '';
  const face = revealed
    ? `<h1 class="main-word vb-card-answer" lang="fr">${frEsc(card.answer)}</h1><p class="source-word" lang="fr">${frEsc(card.inf)} · ${esc(card.tenseName)}</p>`
    : `<p class="vb-card-who" lang="fr">${esc(VB_PERSONS[card.person])}</p><h1 class="main-word" lang="fr">${frEsc(card.inf)}</h1><p class="source-word">${esc(card.en)}</p><span class="vb-tense">${esc(card.tenseName)}</span>`;
  const zones = revealed ? `<button class="card-zone left" data-action="vb-card-no" aria-label="Didn’t know it"><span aria-hidden="true">←</span></button><button class="card-zone right" data-action="vb-card-yes" aria-label="Knew it"><span aria-hidden="true">→</span></button>` : '';
  const after = revealed ? `${paradigmHTML(card.paradigm, card.person)}<p class="vb-why vb-rule">${frEsc(card.rule)}</p>` : `<p class="caption vb-card-hint">Say the form to yourself, then tap the card.</p>`;
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
  api('api/verbs/mark', { method: 'POST', body: JSON.stringify({ requestId: requestId(), verbId: card.verbId, tense: card.tense, person: card.person, knew }) })
    .catch((error) => { notice = { message: `This mark was not saved: ${error.message}` }; if (screen === 'verbs-cards') render(); })
    // The next cards are chosen once this mark counts, so a form just missed is weighed as shaky.
    .finally(() => topUpVerbCards());
}

// ── Quick forms: type one form at a time, as endless as Cards. A wrong answer comes back once, four forms later;
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
  const header = `<div class="section-top">${back('Verbs', 'verbs')}<span class="stream-label">Quick forms</span></div>`;
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="stream vb">${header}${body}</section>`; };
  if (loading || !verbForms) { shell(loading ? '<div class="loading-state" role="status">Choosing forms…</div>' : ''); return; }
  const { items, index, result } = verbForms;
  if (index >= items.length) {
    shell(verbForms.done ? '<p class="caption">No forms to ask for these verbs and tenses.</p>' : '<div class="loading-state" role="status">Choosing more forms…</div>');
    topUpVerbForms();
    return;
  }
  const item = items[index];
  const prompt = `<div class="vb-prompt"><div class="vb-who" lang="fr">${esc(VB_PERSONS[item.person])}</div><div class="vb-verb" lang="fr">${frEsc(item.inf)}</div><div class="vb-meta">${esc(item.en)}</div><span class="vb-tense">${esc(item.tenseName)}</span></div>`;
  const again = item.again ? '<p class="caption vb-again-note">Once more, from a few forms ago.</p>' : '';
  if (!result) {
    shell(`${again}${prompt}<form class="vb-answer-row" id="vb-form"><input class="vb-input" id="vb-answer" lang="fr" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="The form of ${esc(item.inf)} for ${esc(VB_PERSONS[item.person])}, ${esc(item.tenseName)}" value="${esc(verbDraft)}" ${busy ? 'disabled' : ''}><button class="primary" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Check'}</button></form>${vbAccentsHTML()}`);
    return;
  }
  const comesBack = !result.right && !item.again ? ' · this one comes back soon' : '';
  shell(`${again}${prompt}<div class="feedback ${result.right ? '' : 'warn'}" role="status"><strong>${result.right ? 'That’s right.' : 'Not quite.'}</strong><p><span lang="fr">${frEsc(result.expected)}</span>${result.right ? '' : ` — you wrote <span lang="fr">${esc(verbForms.given)}</span>.`}</p>${result.why ? `<p class="vb-why">${esc(result.why)}</p>` : ''}${paradigmHTML(result.paradigm, item.person)}<p class="vb-why vb-rule">${esc(result.rule)}</p></div>
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
  verbTable = { verbId: verbId || verbTable.verbId || fallback, tense: tense || (verbTenses.includes(verbTable.tense) ? verbTable.tense : verbTenses[0]), answers: ['', '', '', '', '', ''], result: null };
  if (move('verbs-table', true)) render();
}
// Draws the next table from the room's settings, passing over the last few done.
async function nextVerbTable() {
  loading = true; notice = null; retryAction = null; render();
  try {
    const [next] = await Promise.all([
      api('api/verbs/next-table', { method: 'POST', body: JSON.stringify({ ...vbSettings(), exclude: vbTableRecent }) }),
      verbsInfo ? null : loadVerbs(true),
    ]);
    verbTable = { verbId: next.verbId, tense: next.tense, answers: ['', '', '', '', '', ''], result: null };
  } catch (error) { notice = { message: error.message }; retryAction = { type: 'verbs-table' }; }
  loading = false;
  if (screen !== 'verbs-table') return;
  render(); main.querySelector('#vb-cell-0, .vb-input')?.focus({ preventScroll: true });
}
function chooseVerbTableMode(mode) {
  if (busy || loading || mode === vbTableVisit) return;
  vbTableMode = vbTableVisit = mode; savePreference('echo.verbs-table-mode', mode);
  if (mode === 'next') nextVerbTable(); else { verbTable = { ...verbTable, answers: ['', '', '', '', '', ''], result: null }; render(); }
}
function renderVerbTable() {
  const header = `<div class="section-top">${back('Verbs', 'verbs')}<span class="stream-label">Whole table</span></div><div class="segmented vb-table-modes" role="group" aria-label="How the table is picked">${[['next', 'Next table'], ['choose', 'Choose']].map(([mode, label]) => `<button data-action="vb-table-mode" data-value="${mode}" aria-pressed="${vbTableVisit === mode}" ${busy || loading ? 'disabled' : ''}>${label}</button>`).join('')}</div>`;
  // Back on this screen with no table drawn yet (a reload, say): draw one, unless the last try failed.
  if (vbTableVisit === 'next' && !verbTable.verbId && !loading && !retryAction) { nextVerbTable(); return; }
  if (vbTableVisit === 'next' && (loading || !verbTable.verbId)) { main.innerHTML = `${noticeHTML()}<section class="stream vb">${header}${loading ? '<div class="loading-state" role="status">Choosing a table…</div>' : ''}</section>`; return; }
  if (!verbsInfo) { main.innerHTML = `${noticeHTML()}<section class="stream vb">${header}</section>`; loadVerbs(true).then(() => { if (screen === 'verbs-table') { if (!verbTable.verbId) verbTable.verbId = verbsInfo?.verbs[0]?.id || ''; render(); } }); return; }
  const verb = vbVerb(verbTable.verbId) ?? verbsInfo.verbs[0];
  if (!verb) { main.innerHTML = `${noticeHTML()}<section class="stream vb">${header}<p class="caption">No verb tables yet.</p></section>`; return; }
  verbTable.verbId = verb.id;
  const options = [...verbsInfo.verbs].sort((a, b) => Number(b.started) - Number(a.started) || a.inf.localeCompare(b.inf, 'fr')).map((entry) => `<option value="${esc(entry.id)}" ${entry.id === verb.id ? 'selected' : ''}>${esc(entry.inf)}</option>`).join('');
  const tenses = Object.entries(VB_TENSES).map(([tense, label]) => `<option value="${tense}" ${tense === verbTable.tense ? 'selected' : ''}>${label}</option>`).join('');
  const result = verbTable.result;
  const rows = verb.states[verbTable.tense].map((state, person) => {
    if (state === null) return '';
    const cell = result?.cells[person];
    const mark = cell ? `<span class="vb-mark ${cell.right ? 'ok' : 'bad'}" aria-label="${cell.right ? 'right' : 'wrong'}">${cell.right ? '✓' : '✕'}</span>` : '<span class="vb-mark"></span>';
    const fix = cell && !cell.right ? `<span class="vb-fix"><span lang="fr">${frEsc(cell.expected)}</span>${cell.why ? ` · ${esc(cell.why)}` : ''}</span>` : cell?.why ? `<span class="vb-fix vb-fix-ok">${esc(cell.why)}</span>` : '';
    return `<div class="vb-trow"><label class="vb-pro" for="vb-cell-${person}" lang="fr">${esc(VB_PERSONS[person])}</label><input class="vb-input${cell ? (cell.right ? ' ok' : ' bad') : ''}" id="vb-cell-${person}" data-vb-cell="${person}" lang="fr" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(verbTable.answers[person])}">${mark}${fix}</div>`;
  }).join('');
  const summary = result ? `<div class="feedback ${result.right === result.total ? '' : 'warn'}" role="status"><strong>${result.right} of ${result.total}.</strong><p class="vb-why">${esc(result.rule)}</p>${paradigmHTML(result.paradigm)}</div>` : '';
  main.innerHTML = `${noticeHTML()}<section class="stream vb">${header}
    ${vbTableVisit === 'choose' ? `<div class="vb-grid-head"><label class="sr-only" for="vb-table-verb">Verb</label><select id="vb-table-verb">${options}</select><label class="sr-only" for="vb-table-tense">Tense</label><select id="vb-table-tense">${tenses}</select></div>
    <p class="caption">${esc(verb.en)}</p>` : `<div class="vb-prompt vb-table-prompt"><div class="vb-verb" lang="fr">${frEsc(verb.inf)}</div><div class="vb-meta">${esc(verb.en)}</div><span class="vb-tense">${esc(VB_TENSES[verbTable.tense])}</span></div>`}
    <div class="vb-rows">${rows}</div>${vbAccentsHTML()}
    <div class="summary-actions">${vbTableVisit === 'next' && result ? `<button class="primary" data-action="vb-next-table">Next table</button><button class="secondary" data-action="vb-check-table" ${busy ? 'disabled' : ''}>Check again</button>` : `<button class="primary" data-action="vb-check-table" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : result ? 'Check again' : 'Check'}</button>`}</div>${summary}</section>`;
}
async function checkVerbTable() {
  if (busy) return;
  busy = true; render();
  const done = `${verbTable.verbId}|${verbTable.tense}`;
  vbTableRecent = [done, ...vbTableRecent.filter((entry) => entry !== done)].slice(0, VB_TABLE_GAP);
  try { verbTable.result = await api('api/verbs/table', { method: 'POST', body: JSON.stringify({ requestId: requestId(), verbId: verbTable.verbId, tense: verbTable.tense, answers: verbTable.answers }) }); }
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
  try { const { questions } = await api('api/verbs/ear', { method: 'POST', body: JSON.stringify(vbSettings()) }); verbEar = { questions, index: 0, chose: null, result: null, right: 0 }; }
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
  const feedback = result ? `<div class="feedback ${result.right ? '' : 'warn'}" role="status"><strong>${result.right ? 'That’s right.' : 'Not quite.'}</strong><p><span lang="fr">${frEsc(result.said)}</span></p><p class="vb-why">${esc(result.why)}</p></div>` : '';
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
  try { verbEar.result = await api('api/verbs/ear-answer', { method: 'POST', body: JSON.stringify({ requestId: requestId(), id: question.id, choice }) }); if (verbEar.result.right) verbEar.right += 1; }
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
  const start = `<button class="lyric-start" data-action="story-line" data-index="${index}" aria-expanded="${open}" aria-label="What this line means">›</button>`;
  return `<div class="lyric-line story-line${current ? ' playing' : ''}" data-line="${index}">${start}<div class="lyric-text">${line.speaker ? `<span class="speaker">${esc(line.speaker)}</span>` : ''}<p lang="fr">${glossedHTML(line.fr, glosses)}</p>${english ? `<p class="lyric-en">${esc(line.en)}</p>` : ''}</div></div>`;
}
// The episode as one MP3, French only or each line then its English, so lines follow each other without a wait
// and it plays on with the phone locked. Until its recordings are converted, the lines play one by one.
const storyAudio = new Audio();
const STORY_MODES = { fr: 'French', both: 'French, then English' };
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
    const hint = storyAt >= 0 ? `${playing ? 'line' : 'stopped at line'} ${storyAt + 1} of ${total}` : 'Listen to the episode';
    const modes = Object.entries(STORY_MODES).map(([mode, label]) => `<button data-action="story-mode" data-mode="${mode}" aria-pressed="${storyMode === mode}">${label}</button>`).join('<span aria-hidden="true">·</span>');
    return `<div class="story-player"><div class="listen-block"><button class="icon" data-action="story-play" aria-label="${playing ? 'Pause' : 'Listen to the episode'}">${playing ? pauseIcon : speaker}</button><p class="listen-hint" id="clip-progress" role="status">${esc(hint)}</p></div><p class="wm-choice story-mode">Plays ${modes}</p></div>`;
  }
  const recorded = storyView.audio.filter(Boolean).length;
  if (!recorded) return '<div class="story-player"><div class="listen-block"><p class="caption">The lines are being recorded.</p></div></div>';
  const playing = clipRun?.key === `story:${storyView.episode.id}`;
  const hint = playing && clipProgress ? `line ${clipProgress.index} of ${clipProgress.total}` : recorded < storyView.audio.length ? `${recorded} of ${storyView.audio.length} lines recorded` : 'Listen to the episode';
  return `<div class="story-player"><div class="listen-block"><button class="icon" data-action="story-play" aria-label="${playing ? 'Stop' : 'Listen to the episode'}">${playing ? pauseIcon : speaker}</button><p class="listen-hint" id="clip-progress" role="status">${esc(hint)}</p></div></div>`;
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
  const header = `<div class="section-top">${back('Home', 'home')}<span class="stream-label">Story</span></div>`;
  const shell = (body) => { main.innerHTML = `${noticeHTML()}<section class="topics songs lyrics story">${header}${body}</section>`; };
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
  const earlier = storyStatus.episodes.filter((entry) => entry.number !== episode.number).reverse().map((entry) => `<button class="topic-row" data-action="story-open" data-n="${entry.number}"><span class="copy"><span class="topic-name"><h3 lang="fr">${esc(entry.title)}</h3></span><p>Episode ${entry.number} · ${esc(entry.titleEn)}${entry.finished ? '' : ' · not finished'}</p></span><span class="arrow" aria-hidden="true">→</span></button>`).join('');
  shell(`<p class="topic-kicker">Episode ${episode.number}</p><h1 lang="fr">${frEsc(episode.title)}</h1><p class="subtitle">${esc(episode.titleEn)}</p>${recap}${play}
    <p class="song-hint">Tap a word for its meaning, or › for what a line means.</p>
    <div class="lyric-lines">${lines}</div>${note}
    <h2 class="story-heading">Questions</h2>${storyQuestionsHTML(episode, !!read)}${end}
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
function openGroup(id) { focusId = id; if (move(`focus|${id}`, true)) enterMixed(); }
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
function streamAction(kind, extra = {}) {
  const view = streamState?.current;
  if (!view || locked()) return;
  const id = streamId;
  const body = { stream: id, key: view.key, version: streamState.version, requestId: requestId(), ...extra };
  runAction(async () => {
    const state = await api(`api/comprehension/${kind}`, { method: 'POST', body: JSON.stringify(body) });
    if (streamId !== id) return;
    applyStream(state);
    if (kind === 'next' && mixed()) advanceMixed();
    if (kind === 'answer' && streamState.result) announce(`${({ correct: 'That’s right.', helped: 'Right, with help.', incorrect: 'Not quite.' })[streamState.result.outcome] || ''} ${streamState.result.expected}`);
  }, () => loadStream(id, 'This exercise was refreshed. Answer the question shown now.'));
}
function streamCheck() {
  const view = streamState?.current;
  if (!view || streamState.result || locked() || view.choices?.length) return;
  if (!streamDraft.trim()) { announce('Write what you heard first.'); document.querySelector('#stream-answer')?.focus(); return; }
  streamAction('answer', { text: streamDraft });
}
function streamPick(index) {
  const view = streamState?.current;
  if (!view || streamState.result || locked() || !view.choices?.length) return;
  streamAction('answer', { choice: Number(index) });
}
function streamNext() {
  if (!streamState?.result || locked()) return;
  streamAction('next');
}
function autoplay() {
  const view = streamState?.current;
  if (!view || !streamScreen() || streamState.result || view.mode !== 'listen' || !view.audio?.length) return;
  const key = `${streamId}:${view.key}`;
  if (key === heardKey) return;
  heardKey = key; playClips(view.audio);
}
// The speaker pauses while it plays and otherwise continues from the line it stopped at; "From the start"
// (fromStart) plays every line again.
// Plays only the line last heard, then waits paused after it.
function replayLine() {
  const view = streamState?.current;
  if (!view?.audio?.length) return;
  const key = `${streamId}:${view.key}`;
  const line = clipRun?.key === key ? clipRun.heard : clipSpot?.key === key ? clipSpot.heard : null;
  if (line === null || line === undefined) return;
  audioBlocked = false; heardKey = key;
  playClips(view.audio, line, line + 1);
}
function toggleClips(fromStart = false) {
  const view = streamState?.current;
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
  if (grammarOnScreen() || screen === 'lyrics' || screen === 'story') return;
  const view = streamState?.current;
  if (!view || streamState.result || view.mode !== 'read' || (streamState.lookups || []).includes(fr)) return;
  const id = streamId;
  const token = streamGeneration;
  api('api/comprehension/lookup', { method: 'POST', body: JSON.stringify({ stream: id, key: view.key, fr, version: streamState.version, requestId: requestId() }) })
    .then((state) => { if (token === streamGeneration && streamId === id) applyStream(state); })
    .catch((error) => { notice = { message: error.message }; render(); });
}
function renderGlossSheet() {
  const entry = glossWord;
  if (!entry) return;
  const add = entry.word
    ? (addStatus ? `<p class="gloss-status" role="status">${esc(addStatus)}</p>` : `<button class="secondary gloss-add" data-action="add-word" ${busy ? 'disabled' : ''}>Add to my words</button>`)
    : '';
  const gender = genders[entry.word] ?? entry.gender;
  const extra = `${gender ? `<p class="gloss-gender${genderClass(gender)}">${gender} noun</p>` : ''}${entry.base ? `<p class="gloss-base">from <span lang="fr">${frEsc(entry.base)}</span></p>` : ''}${entry.note ? `<p class="gloss-note">${esc(entry.note)}</p>` : ''}`;
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
  const paths = { answer: 'api/grammar/answer', help: 'api/grammar/help', next: 'api/grammar/next' };
  runAction(async () => {
    let snap = await api(paths[type], { method: 'POST', body: JSON.stringify(body) });
    if (snap.session?.complete) snap = await api('api/grammar/session', { method: 'POST', body: JSON.stringify({ scope: key, requestId: requestId() }) });
    applyReview(snap, type === 'help');
    if (body.kind === 'hint') hintOpen = true;
    if (type === 'next') { hintOpen = true; advanceMixed(); }
    const current = review.session?.current;
    if (current?.feedback) announce(current.feedback.message);
  }, async () => {
    const token = mixedGeneration;
    try { await loadReview(token); notice = { kind: 'info', message: 'This question was refreshed. Answer the one shown now.' }; }
    catch (error) { notice = { message: error.message }; }
    render();
  });
}
function mixedGrade(body) {
  runAction(async () => {
    let state = await api('api/grade', { method: 'POST', body: JSON.stringify(body) });
    // The daily allowance may have run out; Practise then carries on with its other sources.
    if (!state.current) { try { state = await api('api/session', { method: 'POST', body: JSON.stringify({ direction, deck }) }); } catch { /* nothing left today */ } }
    applySnapshot(state);
    advanceMixed();
  });
}
async function enterMixed() {
  const token = ++mixedGeneration;
  ++streamGeneration;
  const focus = screen === 'focus';
  streamState = null; review = null; streamDraft = ''; audioBlocked = false;
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
  if (sources.includes('comprehension') && streamId) {
    jobs.push(guard(api(`api/comprehension/state?stream=${encodeURIComponent(streamId)}`).then((state) => { if (token === mixedGeneration) applyStream(state); })));
  }
  if (sources.includes('vocabulary')) {
    jobs.push(guard((async () => {
      let state = await api(`api/state?direction=${encodeURIComponent(direction)}&deck=${encodeURIComponent(deck)}`);
      if (!state.current) state = await api('api/session', { method: 'POST', body: JSON.stringify({ direction, deck }) });
      if (token === mixedGeneration) applySnapshot(state);
    })()));
  }
  if (sources.includes('grammar')) jobs.push(guard(loadReview(token)));
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
  if (name !== 'lyrics') clearTimeout(lyricsPoll);
  if (name !== 'story') clearTimeout(storyPoll);
  if (name !== 'verbs') clearTimeout(verbsPoll);
  // Leaving the Radio pauses it where it is; coming back plays on from there.
  if (name !== 'statistics') { stopStatsPlay(); stopVerbPlay(); }
  if (name !== 'radio') { clearTimeout(radioPoll); if (!radioAudio.paused) radioAudio.pause(); }
  if (name !== 'mix' && name !== 'focus') { mixedSource = ''; review = null; }
  if (name !== 'listen' && name !== 'read' && name !== 'mix' && name !== 'focus') { streamState = null; streamId = ''; }
  // Leaving the Walkman stops the tape; coming back winds a new one.
  if (name !== 'walkman' && walkmanAudio.src) {
    ++walkmanGeneration; walkmanAudio.pause(); walkmanAudio.removeAttribute('src'); walkmanAudio.load();
    walkman = { tape: null, index: -1, meaning: false, loading: false, started: false, logged: new Set() };
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  }
  if (name !== 'walkman') { heardOpen = false; heardSaying = ''; heardResume = false; }
  if (name === 'home') homeInfo.at = 0;
  screen = name; render(); window.scrollTo(0, 0); main.focus({ preventScroll: true });
  if (name === 'home') fetchState();
}
async function startPractice() {
  if (busy) return;
  move('practice', true);
  if (locked()) return;
  if (!await fetchState()) return;
  if (vocabMode === 'endless') { if (screen === 'practice') { endless = null; render(); } return; }
  if (screen === 'practice') runMutation({ type: 'start', body: { direction, deck } });
}
function shownCard() { return endlessMode() ? endless?.cards[0] ?? null : snapshot?.current ?? null; }
function vocabularyCard() { return !!shownCard() && (screen === 'practice' || (mixed() && mixedSource === 'vocabulary')); }
function reveal() {
  if (!vocabularyCard() || revealed || locked() || loading) return;
  revealed = true; render(); document.querySelector('#flashcard')?.focus({ preventScroll: true });
  const card = shownCard();
  announce(`Answer: ${direction === 'en-fr' ? card.fr : card.en}.`);
  // Listen mode already played the word when the card appeared; the reveal only shows the answer.
  if (audioMode && !listening()) playFrench(card.audioUrl);
}
function grade(known) {
  if (!revealed || locked() || loading || !vocabularyCard()) return;
  // The previous answer is still being saved: this one follows as soon as it is.
  if (endlessMode()) { markEndless(known); return; }
  if (pendingGrade) { queuedGrade = known; if (savingSlow) render(); return; }
  const card = snapshot.current;
  const body = { direction, deck, wordId: card.id, version: card.version, known, requestId: requestId() };
  if (mixed()) mixedGrade(body);
  else if (snapshot.next) answerAhead(body);
  else runMutation({ type: 'grade', body });
}
// Shows the predicted next card at once and saves the answer behind it. The server's reply replaces the
// prediction only when it differs; if the answer could not be saved, the answered card comes back to retry.
function answerAhead(body) {
  const answered = snapshot;
  const token = ++generation;
  stopAudio();
  snapshot = { ...snapshot, current: snapshot.next, next: null, undoId: null };
  revealed = false; notice = null; retryAction = null;
  render(); main.focus({ preventScroll: true });
  announce(direction === 'en-fr' ? snapshot.current.en : snapshot.current.fr);
  // An answer is saved in well under a second; one that takes longer says so, and one that takes over GRADE_LIMIT
  // is retried by itself with the same request id, so it cannot count twice.
  const saving = setTimeout(() => { if (token === generation && screen === 'practice') { savingSlow = true; render(); } }, SLOW_SAVE);
  pendingGrade = api('api/grade', { method: 'POST', body: JSON.stringify(body), limit: GRADE_LIMIT }).then((result) => {
    if (token !== generation || screen !== 'practice') return;
    const shown = snapshot.current;
    if (result.current && shown && result.current.id === shown.id && result.current.version === shown.version) {
      snapshot = result; render();
    } else { applySnapshot(result); render(); }
  }, async (error) => {
    if (token !== generation) return;
    queuedGrade = null;
    if (error.status === 409) { await fetchState(`${error.message} Your progress was refreshed. Reveal the current card again before answering.`); return; }
    snapshot = answered; revealed = true; stopAudio();
    notice = { message: error.message }; retryAction = { type: 'grade', body }; render();
  }).finally(() => {
    clearTimeout(saving);
    pendingGrade = null;
    if (savingSlow) { savingSlow = false; if (screen === 'practice') render(); }
    if (queuedGrade === null) return;
    const known = queuedGrade;
    queuedGrade = null;
    grade(known);
  });
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
  stream.last = { requestId: markId, card };
  revealed = false; stopAudio(); notice = null;
  render(); main.focus({ preventScroll: true });
  if (stream.cards[0]) announce(direction === 'en-fr' ? stream.cards[0].en : stream.cards[0].fr);
  api('api/endless/mark', { method: 'POST', body: JSON.stringify({ requestId: markId, direction: stream.direction, wordId: card.id, known }) })
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
function chooseVocabMode(mode) {
  if (mode === vocabMode || locked()) return;
  vocabMode = mode; savePreference('echo.vocab-mode', mode);
  endless = null; revealed = false;
  dialog.close(); startPractice();
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
function openOptions() {
  if (!snapshot) return;
  const disabled = locked() ? 'disabled' : '';
  openDialog('Vocabulary options', `<p class="settings-label">Practice</p><div class="segmented" role="group" aria-label="Practice mode"><button data-action="vocab-mode" data-value="daily" aria-pressed="${vocabMode === 'daily'}" ${disabled}>Daily</button><button data-action="vocab-mode" data-value="endless" aria-pressed="${vocabMode === 'endless'}" ${disabled}>Endless</button></div><p class="caption">${vocabMode === 'endless' ? 'Endless: only words you have started, the hard ones most often, for as long as you like. Each answer moves the word’s score by one; your daily stacks and schedule stay as they are.' : 'Daily: new words and reviews in their stacks, on your schedule.'}</p><p class="settings-label">Direction</p><div class="segmented" role="group" aria-label="Practice direction"><button data-direction="fr-en" aria-pressed="${direction === 'fr-en'}" ${disabled}>French → English</button><button data-direction="en-fr" aria-pressed="${direction === 'en-fr'}" ${disabled}>English → French</button></div><div class="dialog-row"><label for="deck-select">Category</label><select id="deck-select" ${disabled}>${optionsHTML(deck)}</select></div><div class="dialog-row"><label for="audio-speed">Pronunciation speed</label><select id="audio-speed"><option value="1" ${speed === 1 ? 'selected' : ''}>Normal</option><option value="0.8" ${speed === 0.8 ? 'selected' : ''}>Slower</option></select></div><div class="dialog-row"><span>Colour nouns by gender<small class="gender-key"><span class="g-m">masculine</span> · <span class="g-f">feminine</span></small></span><button class="secondary" data-action="gender-colours" aria-pressed="${genderColours}">${genderColours ? 'On' : 'Off'}</button></div><form id="goal-form" novalidate><div class="goal-row"><label for="daily-goal">New words / day<br><small>in each direction</small></label><input id="daily-goal" name="newPerDay" type="number" inputmode="numeric" min="0" max="${totalWords()}" step="1" value="${snapshot.settings.newPerDay}" aria-describedby="goal-help goal-feedback" ${disabled}><button class="secondary" type="submit" ${disabled}>Save</button></div><p id="goal-help" class="caption">Shared across categories. Resets at 04:00 on your Mac. Set 0 to pause new words; due reviews are not capped.</p><div id="goal-feedback" class="caption" role="status"></div></form>${extraPracticeHTML()}<p class="settings-label">Words from songs</p><div class="segmented" role="group" aria-label="When song words are introduced"><button data-action="songs-first" data-value="true" aria-pressed="${snapshot.settings.songsFirst !== false}" ${disabled}>Before other new words</button><button data-action="songs-first" data-value="false" aria-pressed="${snapshot.settings.songsFirst === false}" ${disabled}>Mixed in</button></div><button class="secondary song-entry" data-action="songs" ${disabled}>Add words from a song…</button><div class="options-links"><button class="quiet" data-action="about">How it works</button><a href="api/export" download="echo-progress.json">Download my progress ↓</a></div><button class="primary dialog-action" data-action="close-dialog">Back to practice</button>`, 'options');
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
  if (action.run) runAction(action.run);
  else if (action.body) runMutation(action);
  else if (action.type === 'grammar-state') { if (move(action.place)) loadGrammar(action.message, action.preserveDraft); }
  else if (action.type === 'stream') loadStream(action.stream, action.message);
  else if (action.type === 'mixed') enterMixed();
  else if (action.type === 'mistakes') loadMistakes();
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
  else if (action.type === 'verbs-tense') loadVerbTense();
  else if (action.type === 'verbs-verb') loadVerbPage();
  else if (action.type === 'story') loadStory();
  else if (action.type === 'radio') loadRadio();
  else if (action.type === 'songs') loadSongs();
  else if (action.type === 'song') loadSong();
  else fetchState(action.message);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button'); if (button?.disabled) return;
  const action = button?.dataset.action;
  if (action === 'st-info') { toggleStatsTip(button); return; }
  if (!event.target.closest('.st-tip')) closeStatsTips();
  if (action === 'close-dialog') { if (!busy) dialog.close(); return; }
  if (action === 'audio-mode') { audioMode = !audioMode; savePreference('echo.audio-mode', audioMode ? 'on' : 'off'); if (!audioMode) stopAudio(); render(); return; }
  if (action === 'listen-mode') { listenMode = !listenMode; savePreference('echo.listen-mode', listenMode ? 'on' : 'off'); heardCard = ''; if (!listenMode) stopAudio(); render(); return; }
  if (action === 'replay') { const card = shownCard(); if (card) playFrench(card.audioUrl); return; }
  if (action === 'play-clips') { toggleClips(); return; }
  if (action === 'clips-restart') { toggleClips(true); return; }
  if (action === 'clips-line') { replayLine(); return; }
  if (action === 'grammar-audio') { const clip = activeGrammar()?.session?.current?.audio; if (clip) playFrench(clip); return; }
  if (button?.dataset.gloss !== undefined) { glossLine = button.closest('[data-line]')?.dataset.line ?? ''; lookupGloss(button.dataset.gloss); return; }
  if (action === 'add-word') { addWord(); return; }
  if (action === 'vb-accent') { insertAccent(button.dataset.letter); return; }
  if (!button && screen === 'verbs-cards' && event.target.closest('#vb-card')) { revealVerbCard(); return; }
  if (busy) return;
  if (action === 'verbs' || action?.startsWith('vb-')) { if (action === 'verbs' && screen === 'home') openVerbs(); else verbAction(action, button); return; }
  if (button?.dataset.direction) {
    if (locked() || direction === button.dataset.direction) return;
    direction = button.dataset.direction; savePreference('echo.direction', direction); dialog.close(); startPractice(); return;
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
  else if (action === 'vocabulary') { if (move('practice')) fetchState(); }
  else if (action === 'grammar') { if (move('grammar')) loadGrammar(); }
  else if (action === 'topic-page') { if (move(`topic|${topicId}`)) loadGrammar(); }
  else if (action === 'browse') browseWords();
  else if (action === 'studied') { browseShow = 'studied'; browseWords(); }
  else if (action === 'families') { if (move('families', true)) enterFamilies(); }
  else if (action === 'family') { const index = Number(button.dataset.family); familyOpen = familyOpen === index ? -1 : index; renderFamilies(); }
  else if (action === 'family-add') addFromFamily(button.dataset.word);
  else if (action === 'word-building') { buildingFrom = button.dataset.from === 'families' ? 'families' : 'grammar'; if (move('building', true)) enterBuilding(); }
  else if (action === 'building-word') { const key = `${button.dataset.pattern}:${button.dataset.word}`; buildingWord = buildingWord === key ? '' : key; renderBuilding(); }
  else if (action === 'toggle-hide') { hideTranslations = !hideTranslations; revealedWords.clear(); renderBrowse(); document.querySelector('[data-action="toggle-hide"]')?.focus(); }
  else if (action === 'extra-words' || action === 'review-early') extraPractice(action, button.dataset);
  else if (action === 'options') openOptions();
  else if (action === 'about') { dialog.close(); stopAudio(); aboutDialog.showModal(); }
  else if (action === 'again') grade(false);
  else if (action === 'known') grade(true);
  else if (action === 'undo') undo();
  else if (action === 'vocab-mode') chooseVocabMode(button.dataset.value);
  else if (action === 'retry') { clearTimeout(autoRetryTimer); autoRetryTimer = 0; retry(); }
  else if (action === 'retry-browse') loadBrowse();
  else if (action === 'restart') startScope(scope);
  else if (action === 'check') checkAnswer();
  else if (action === 'next') { hintOpen = true; grammarMutation('next'); }
  else if (action === 'rule') grammarMutation('help', { kind: 'rule' });
  else if (action === 'show-answer') grammarMutation('help', { kind: 'answer' });
  else if (action === 'hint') { if (activeGrammar()?.session?.current?.hint) { hintOpen = !hintOpen; render(); } else grammarMutation('help', { kind: 'hint' }); }
  else if (action === 'listen' || action === 'read') openStream(action);
  else if (action === 'practise') openMix();
  else if (action === 'mistakes') openMistakes();
  else if (action === 'statistics') openStatistics();
  else if (action === 'songs') openSongs();
  else if (action === 'song-open') openSong(button.dataset.song);
  else if (action === 'song-read') readSong({ lrclibId: Number(button.dataset.lrclib) });
  else if (action === 'song-paste') { songPasting = true; render(); document.querySelector('#song-title')?.focus(); }
  else if (action === 'song-pick') pickSongWord(button.dataset.fr);
  else if (action === 'song-pick-all') pickAllSongWords(true);
  else if (action === 'song-pick-none') pickAllSongWords(false);
  else if (action === 'song-add') songAction(`api/songs/${encodeURIComponent(button.dataset.song)}/add`, { method: 'POST', body: JSON.stringify({ words: [...(songPicks.get(button.dataset.song) || [])] }) }, (song) => { songView = song; loadSong(); announce(`${song.added.length} words added.`); });
  else if (action === 'song-retry') songAction(`api/songs/${encodeURIComponent(button.dataset.song)}/retry`, { method: 'POST', body: '{}' }, (song) => { songView = song; loadSong(); });
  else if (action === 'song-remove') songAction(`api/songs/${encodeURIComponent(button.dataset.song)}`, { method: 'DELETE' }, () => { songView = null; move('songs'); loadSongs(); });
  else if (action === 'song-practise') { deck = button.dataset.category; savePreference('echo.deck', deck); startPractice(); }
  else if (action === 'song-lyrics') openLyrics();
  else if (action === 'song-page') openSong(songId);
  else if (action === 'lyric-line') { const key = button.dataset.line; if (openLines.has(key)) openLines.delete(key); else openLines.add(key); render(); }
  else if (action === 'song-notes') rewriteSongNotes();
  else if (action === 'gender-colours') { genderColours = !genderColours; localStorage.setItem('echo.genders', genderColours ? 'on' : 'off'); document.body.classList.toggle('genders', genderColours); openOptions(); render(); }
  else if (action === 'songs-first') setSongsFirst(button.dataset.value === 'true');
  else if (action === 'stats-bin') chooseStatsBin(Number(button.dataset.bin));
  else if (action === 'stats-list') { statsOpen = !statsOpen; drawScores(); }
  else if (action === 'stats-day') { stopStatsPlay(); showStatsDay(statsAt + Number(button.dataset.step)); }
  else if (action === 'stats-play') toggleStatsPlay();
  else if (action === 'stats-vbin') chooseVerbBin(Number(button.dataset.bin));
  else if (action === 'stats-vlist') { vScoreOpen = !vScoreOpen; drawVerbScores(); }
  else if (action === 'stats-vstep') { stopVerbPlay(); showVerbDay(vsIndex() + Number(button.dataset.step)); }
  else if (action === 'stats-vplay') toggleVerbPlay();
  else if (action === 'stats-vpoints') { vPointsDay = button.dataset.day; render(); }
  else if (action === 'points-day') { pointsDay = button.dataset.day; render(); }
  else if (action === 'walkman') openWalkman();
  else if (action === 'sounds') { if (move('sounds')) loadSounds(); }
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
  else if (action === 'stream-check') streamCheck();
  else if (action === 'stream-next') streamNext();
  else if (event.target.closest('#flashcard') && !event.target.closest('button,a,input,select')) reveal();
});
// Accent buttons type into the Verbs field last used, without taking the focus from it.
document.addEventListener('focusin', (event) => { if (event.target.classList?.contains('vb-input')) vbLastInput = event.target.id; });
document.addEventListener('pointerdown', (event) => { if (event.target.closest?.('.vb-accents button')) event.preventDefault(); });
document.addEventListener('change', (event) => {
  if (event.target.id === 'deck-select' && !locked()) { deck = event.target.value; browseCategory = deck; savePreference('echo.deck', deck); dialog.close(); startPractice(); }
  else if (event.target.id === 'browse-category') { browseCategory = event.target.value; renderBrowseResults(); }
  else if (event.target.id === 'browse-show') { browseShow = event.target.value; renderBrowseResults(); }
  else if (event.target.id === 'vb-lookup' && event.target.value) openVerbPage(event.target.value);
  else if (event.target.id === 'vb-table-verb' || event.target.id === 'vb-table-tense') {
    verbTable = { ...verbTable, [event.target.id === 'vb-table-verb' ? 'verbId' : 'tense']: event.target.value, answers: ['', '', '', '', '', ''], result: null };
    render(); main.querySelector('.vb-input')?.focus({ preventScroll: true });
  }
  else if (event.target.id === 'audio-speed') { speed = event.target.value === '0.8' ? 0.8 : 1; savePreference('echo.speed', String(speed)); audio.playbackRate = speed; }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'vocab-search') { search = event.target.value; renderBrowseResults(); }
  if (event.target.id === 'answer') draft = event.target.value;
  if (event.target.id === 'stream-answer') streamDraft = event.target.value;
  if (event.target.id === 'song-query') songQuery = event.target.value;
  if (event.target.id === 'vb-answer') verbDraft = event.target.value;
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
});
document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.repeat || aboutDialog.open || dialog.open || busy || loading || locked()) return;
  const grammarScreen = grammarOnScreen();
  if (grammarScreen && (event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (activeGrammar()?.session?.current?.settled) grammarMutation('next'); else checkAnswer(); return; }
  // The verb-form field is one line, so Enter checks it (and continues once it is settled).
  if (grammarScreen && event.key === 'Enter' && !event.shiftKey && event.target.matches('input#answer')) { event.preventDefault(); if (activeGrammar()?.session?.current?.settled) grammarMutation('next'); else checkAnswer(); return; }
  // Enter checks what you typed, and continues once the exercise has settled.
  if (streamScreen() && streamState?.current && event.key === 'Enter' && !event.shiftKey && (event.target.matches('#stream-answer') || !event.target.closest('input,select,textarea,[contenteditable="true"],button,a'))) {
    event.preventDefault();
    if (streamState.result) streamNext(); else streamCheck();
    return;
  }
  // Verb cards: Space or Enter turns the card, the arrow keys mark it.
  if (screen === 'verbs-cards' && verbCards && !event.ctrlKey && !event.altKey && !event.metaKey && !event.target.closest('input,select,textarea')) {
    if (!verbCards.revealed && (event.key === ' ' || event.key === 'Enter') && !event.target.closest('button,a')) { event.preventDefault(); revealVerbCard(); }
    else if (verbCards.revealed && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); markVerbCard(event.key === 'ArrowRight'); }
    return;
  }
  if (event.ctrlKey || event.altKey || event.metaKey || !vocabularyCard() || event.target.closest('input,select,textarea,[contenteditable="true"]')) return;
  if (!revealed && (event.key === ' ' || event.key === 'Enter') && !event.target.closest('button,a')) { event.preventDefault(); reveal(); }
  else if (revealed && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && (!event.target.closest('button,a') || event.target.closest('.card-zone'))) { event.preventDefault(); grade(event.key === 'ArrowRight'); }
});
homeButton.addEventListener('click', () => move('home'));
document.querySelector('#about-button').addEventListener('click', () => { stopAudio(); aboutDialog.showModal(); });
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
  else if (screen === 'walkman') loadTape();
  else if (screen === 'statistics') loadStatistics();
  else if (screen === 'songs') loadSongs();
  else if (screen === 'song') loadSong();
  else if (screen === 'lyrics') loadLyrics();
  else if (screen === 'sounds') loadSounds();
  else if (screen === 'sound') startSoundRound();
  else if (screen === 'verbs') loadVerbs();
  else if (screen === 'verbs-forms') startVerbForms();
  else if (screen === 'verbs-table') render();
  else if (screen === 'verbs-ear') startVerbEar();
  else if (screen === 'verbs-cards') startVerbCards();
  else if (screen === 'verbs-tense') loadVerbTense();
  else if (screen === 'verbs-verb') loadVerbPage();
  else if (screen === 'story') loadStory();
  else if (screen === 'radio') loadRadio();
});
if (requestedScreen === 'practice') { if (move('practice', true)) fetchState(); }
else if (requestedScreen === 'grammar') { if (move('grammar', true)) loadGrammar(); }
else fetchState();
