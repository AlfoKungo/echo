'use strict';

const main = document.querySelector('#main');
const aboutDialog = document.querySelector('#about-dialog');
const dialog = document.querySelector('#dialog');
const homeButton = document.querySelector('#home-button');
const speaker = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
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
let pendingGrade = null;
let queuedGrade = null;
// The Walkman plays one long tape on its own audio element, so a locked phone keeps playing it.
// tape.words times each word; the screen and the lock screen follow currentTime.
const walkmanAudio = new Audio();
walkmanAudio.preload = 'auto';
// logged holds the tape positions already added to the history.
let walkman = { tape: null, index: -1, meaning: false, loading: false, started: false, logged: new Set() };
let walkmanGeneration = 0;
// Words you heard, newest first, one entry per word, kept on this device across tapes. added records the
// answer to "Add to my words" so the row keeps saying it. The list opens only when asked, each visit.
const HEARD_KEY = 'echo.walkman-heard';
const HEARD_LIMIT = 50;
let walkmanHeard = (() => {
  try { const list = JSON.parse(localStorage.getItem(HEARD_KEY) || '[]'); return Array.isArray(list) ? list.slice(0, HEARD_LIMIT) : []; } catch { return []; }
})();
let heardOpen = false;
let heardSaying = '';
function saveHeard() { try { localStorage.setItem(HEARD_KEY, JSON.stringify(walkmanHeard)); } catch { /* private mode: history lasts this visit */ } }
// One comprehension stream at a time: the Listen and Read screens, Practise and a Mistakes focus all show one.
let streamId = '';
let streamState = null;
let streamDraft = '';
let streamGeneration = 0;
let heardKey = '';
let audioBlocked = false;
let clipProgress = null;
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
function stopAudio() { audioGeneration++; clipProgress = null; audio.pause(); audio.removeAttribute('src'); audio.load(); clearTimeout(audioTimer); document.querySelector('#audio-status').hidden = true; }
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
// The line under the speaker: the line playing now, or why nothing is playing.
function clipHint() {
  const view = streamState?.current;
  if (clipProgress) return `line ${clipProgress.index} of ${clipProgress.total}`;
  if (!view?.audio?.length) return '';
  if (audioBlocked && view.mode === 'listen' && !streamState.result) return 'Tap to listen';
  return view.audio.length > 1 ? `${view.audio.length} lines` : '';
}
function showClipProgress() {
  const line = document.querySelector('#clip-progress');
  if (line) line.textContent = clipHint();
}
async function playClips(urls) {
  if (!urls?.length) return;
  const token = ++audioGeneration;
  for (let index = 0; index < urls.length; index++) {
    if (token !== audioGeneration) return;
    clipProgress = urls.length > 1 ? { index: index + 1, total: urls.length } : null;
    showClipProgress();
    if (!await playClip(urls[index], token) || token !== audioGeneration) { clipProgress = null; showClipProgress(); return; }
    if (index + 1 < urls.length) await new Promise((resolve) => { audioTimer = setTimeout(resolve, 500); });
  }
  if (token !== audioGeneration) return;
  clipProgress = null; showClipProgress();
}
async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(path, { ...options, signal: controller.signal, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, cache: 'no-store' });
    let data;
    try { data = await response.json(); } catch { throw new Error('Your Mac returned an unreadable response. Please try again.'); }
    if (!response.ok) { const error = new Error(data.error || `Request failed (${response.status}). Please try again.`); error.status = response.status; throw error; }
    return data;
  } catch (error) {
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
  return `<div class="notice ${notice.kind === 'info' ? 'info' : ''}" role="${notice.kind === 'info' ? 'status' : 'alert'}"><span>${esc(notice.message)}</span>${retryAction ? `<button class="quiet" data-action="retry" ${busy ? 'disabled' : ''}>Retry</button>` : ''}</div>`;
}
function optionsHTML(selected) { return (snapshot?.decks || []).map((entry) => `<option value="${esc(entry.id)}" ${entry.id === selected ? 'selected' : ''}>${esc(entry.title)} · ${entry.count}</option>`).join(''); }
function back(label, action) { return `<button class="back" data-action="${action}" ${busy ? 'disabled' : ''}><span aria-hidden="true">←</span> ${label}</button>`; }
function place() { return screen === 'topic' ? `topic|${topicId}` : screen === 'exercise' ? `exercise|${scope}` : screen === 'focus' ? `focus|${focusId}` : screen; }
function record(next) {
  depth += 1; trail.length = depth; trail[depth] = next;
  history.pushState({ echo: next, depth }, '');
}
function workingCounts(label) {
  const unavailable = !snapshot || retryAction || snapshot.direction !== direction || snapshot.deck !== deck;
  const counts = loading ? '<span class="compact-status" role="status">Loading counts…</span>' : unavailable ? '<span class="compact-status">Counts unavailable</span>' : `<span class="compact-counts"><span class="unseen"><strong>${formatCount(snapshot.stats.unseenActive)}</strong> unseen</span><span class="separator" aria-hidden="true">·</span><span><strong>${formatCount(snapshot.stats.seenActive)}</strong> seen</span></span>`;
  return `<span class="compact-line"><span class="compact-label" title="${esc(label)}">${esc(label)}</span>${counts}</span>`;
}
function renderHome() {
  const room = (action, symbol, title, copy, mode) => {
    const label = mode ? levelFor(mode) : '';
    return `<button class="room" data-action="${action}" ${busy ? 'disabled' : ''}><span class="symbol" aria-hidden="true">${symbol}</span><span class="room-title"><h2>${esc(title)}</h2>${label ? `<span class="level-tag">${esc(label)}</span>` : ''}</span><p>${esc(copy)}</p><span class="end" aria-hidden="true">→</span></button>`;
  };
  main.innerHTML = `${noticeHTML()}<section class="home"><h1>Choose your practice.</h1><div class="rooms">
    ${room('practise', mixIcon, 'Practise', 'A little of everything: words, grammar and understanding.')}
    ${room('listen', headphones, 'Listen', 'Hear French and show you understood it.', 'listen')}
    ${room('read', bookIcon, 'Read', 'Read French and show you understood it.', 'read')}
    ${room('walkman', cassette, 'Walkman', 'French words, then their meaning, like an old language tape.')}
  </div><div class="side-row">
    <button class="side-link" data-action="start" ${locked() ? 'disabled' : ''}>Vocabulary</button>
    <button class="side-link" data-action="grammar" ${busy ? 'disabled' : ''}>Grammar</button>
    <button class="side-link" data-action="mistakes" ${busy ? 'disabled' : ''}>Mistakes</button>
  </div></section>`;
}
function render() {
  homeButton.disabled = busy;
  document.querySelector('#about-button').disabled = busy;
  if (screen === 'practice') renderPractice();
  else if (screen === 'browse') renderBrowse();
  else if (screen === 'grammar') renderGrammar();
  else if (screen === 'topic') renderTopic();
  else if (screen === 'exercise') renderExercise();
  else if (screen === 'listen' || screen === 'read') renderStream();
  else if (screen === 'mix' || screen === 'focus') renderMixed();
  else if (screen === 'mistakes') renderMistakes();
  else if (screen === 'walkman') renderWalkman();
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
    ? `<p class="wm-fr" lang="fr">${frEsc(word.fr)}</p><p class="wm-en">${walkman.meaning ? esc(word.en) : '&nbsp;'}</p>`
    : `<p class="wm-hint">You hear a French word, then a pause to find its meaning, then the English, then the French again.</p>`;
  main.innerHTML = `${noticeHTML()}<section class="stream walkman">${header}
    <div class="wm-face" aria-live="polite">${face}</div>
    <div class="wm-controls"><button class="listen-play wm-play" data-action="walkman-toggle" aria-label="${playing ? 'Pause' : 'Play'}">${playing ? pauseIcon : playIcon}</button></div>
    <div class="wm-progress" aria-hidden="true"><span style="width:${walkmanProgress()}%"></span></div>
    ${heardHTML()}
    <p class="caption wm-note">Keeps playing with your phone locked. Listening doesn’t change your vocabulary progress.</p>
  </section>`;
}
const HEARD_STATUS = { saving: 'Adding…', added: 'Added to your words', 'already-practising': 'Already in your practice', 'made-due': 'Due again now' };
function heardHTML() {
  const rows = walkmanHeard.map((entry) => {
    const add = entry.added
      ? `<span class="wm-heard-status" role="status">${esc(HEARD_STATUS[entry.added] || '')}</span>`
      : entry.fresh ? `<button class="wm-heard-add" data-action="walkman-add" data-word="${esc(entry.id)}">Add to my words</button>` : '';
    return `<li class="wm-heard-row"><div class="wm-heard-text"><p class="wm-heard-fr" lang="fr">${frEsc(entry.fr)}</p><p class="wm-heard-en">${esc(entry.en)}</p>${add}</div><button class="icon${heardSaying === entry.id ? ' playing' : ''}" data-action="walkman-say" data-word="${esc(entry.id)}" aria-label="Hear ${esc(entry.fr)} again">${speaker}</button></li>`;
  }).join('');
  const list = heardOpen ? `<ol class="wm-heard-list">${rows || '<li class="wm-heard-empty">Words appear here as each one finishes, newest first.</li>'}</ol>` : '';
  return `<div class="wm-heard"><button class="wm-heard-toggle" data-action="walkman-heard" aria-expanded="${heardOpen}"><span>${heardOpen ? 'Hide words you heard' : 'Words you heard'}</span><span class="chev" aria-hidden="true">⌄</span></button>${list}</div>`;
}
// A word joins the history once it has finished, or once the tape moves on after its meaning was heard.
function logHeard(position) {
  if (walkman.logged.has(position)) return false;
  walkman.logged.add(position);
  const word = walkman.tape.words[position];
  const previous = walkmanHeard.find((entry) => entry.id === word.id);
  const added = previous?.added && previous.added !== 'saving' ? { added: previous.added } : {};
  walkmanHeard = [{ id: word.id, fr: word.fr, en: word.en, fresh: word.fresh, ...added }, ...walkmanHeard.filter((entry) => entry.id !== word.id)].slice(0, HEARD_LIMIT);
  saveHeard();
  return true;
}
// Hearing a word again pauses the tape, plays that word alone, then carries on if the tape was playing.
let heardResume = false;
async function hearAgain(id) {
  if (!walkmanAudio.paused) { heardResume = true; walkmanAudio.pause(); }
  heardSaying = id; render();
  const token = ++audioGeneration;
  await playClip(`audio/${encodeURIComponent(id)}.mp3`, token);
  if (token !== audioGeneration) return;
  heardSaying = '';
  if (screen !== 'walkman') return;
  if (heardResume) playWalkman(); else render();
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
    const tape = await api('api/walkman', { method: 'POST', body: '{}' });
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
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => playWalkman());
  navigator.mediaSession.setActionHandler('pause', () => walkmanAudio.pause());
  navigator.mediaSession.setActionHandler('nexttrack', () => skipWord(1));
  navigator.mediaSession.setActionHandler('previoustrack', () => skipWord(-1));
}
function availabilityCopy() {
  const parts = [];
  const elsewhere = snapshot.overview.remaining + snapshot.overview.newAvailable;
  if (deck !== 'all' && snapshot.stats.newAvailable === 0 && elsewhere > 0) parts.push(`${formatCount(elsewhere)} ${elsewhere === 1 ? 'word is' : 'words are'} waiting in other categories. Choose All words in vocabulary options to continue.`);
  if (snapshot.nextDue) parts.push(`Next review: ${dateLabel(snapshot.nextDue)}.`);
  if (snapshot.stats.unseen > 0 && snapshot.stats.newAvailable === 0) parts.push(snapshot.settings.newPerDay === 0 ? 'New words are paused with your daily allowance at 0.' : 'New words return with your next daily allowance at 04:00 on your Mac, or add extra words below.');
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
  const review = (mode, available, noun) => `<div class="chips">${[10, 20].map((count) => chip(`data-action="review-early" data-mode="${mode}" data-count="${count}"`, count, `Review ${count} ${noun}`, available > 0)).join('')}</div>${custom('review-early', mode, `How many ${noun} to review`, 'Review', available > 0)}`;
  const extra = `<div class="chips">${[5, 10, 20].map((count) => chip(`data-action="extra-words" data-count="${count}"`, `+${count}`, `Add ${count} new words today`, stats.unseen > 0)).join('')}</div>${custom('extra-words', '', 'How many new words to add today', 'Add', stats.unseen > 0)}`;
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
// The flashcard itself: shared by the Vocabulary screen and the Practise stream.
function cardHTML() {
  const card = snapshot.current;
  const reverse = direction === 'en-fr';
  const prompt = reverse ? card.en : card.fr;
  const answer = reverse ? card.fr : card.en;
  const hidden = listening() && !revealed;
  const face = hidden
    ? `<button class="listen-play" data-action="replay" aria-label="Play the French word again">${speaker}</button><p class="source-word">Listen, then tap to see the word</p>`
    : `<h1 class="main-word" lang="${(revealed ? reverse : !reverse) ? 'fr' : 'en'}">${esc(revealed ? answer : prompt)}</h1>${revealed ? `<p class="source-word" lang="${reverse ? 'en' : 'fr'}">${esc(prompt)}</p>${card.note ? `<p class="word-note">${esc(card.note)}</p>` : ''}` : ''}`;
  const listenToggle = direction === 'fr-en' ? `<button class="audio-mode ${listenMode ? 'on' : ''}" data-action="listen-mode" aria-pressed="${listenMode}" aria-label="Listen only: ${listenMode ? 'on' : 'off'}" title="Hear the French word instead of reading it">${headphones}<span>Listen ${listenMode ? 'on' : 'off'}</span></button>` : '';
  return `<div class="study-surface ${revealed ? 'revealed' : ''}" id="flashcard" role="${revealed ? 'group' : 'button'}" tabindex="${revealed ? '-1' : '0'}" aria-label="${revealed ? 'Revealed flashcard. Left: didn’t know. Right: knew it.' : hidden ? 'Reveal the meaning' : 'Reveal the translation'}" aria-busy="${busy}"><div class="word-content">${face}</div>${revealed ? `<button class="card-zone left" data-action="again" aria-label="Didn’t know this word" ${locked() ? 'disabled' : ''}><span aria-hidden="true">←</span></button><button class="card-zone right" data-action="known" aria-label="Knew this word" ${locked() ? 'disabled' : ''}><span aria-hidden="true">→</span></button>` : ''}</div><div class="study-tools"><div class="study-modes"><button class="audio-mode ${audioMode ? 'on' : ''}" data-action="audio-mode" aria-pressed="${audioMode}" aria-label="French audio on reveal: ${audioMode ? 'on' : 'off'}" title="Play French on each reveal">${speaker}<span>Audio ${audioMode ? 'on' : 'off'}</span></button>${listenToggle}</div><button class="quiet" data-action="undo" ${!snapshot.undoId || locked() ? 'disabled' : ''}>Undo</button></div>`;
}
// Each new card (or new version after a grade or undo) plays once on its own; re-renders don't replay it.
function playCardOnce() {
  const card = snapshot?.current;
  if (!card || !listening() || revealed) return;
  const key = `${card.id}:${card.version}`;
  if (key === heardCard) return;
  heardCard = key; playFrench(card.audioUrl);
}
function renderPractice() {
  const header = `<div class="section-top">${back('Home', 'home')}<div><span class="review-direction" aria-label="${esc(directionLabel())}">${direction === 'fr-en' ? 'FR → EN' : 'EN → FR'}</span><button class="icon" data-action="browse" aria-label="Browse vocabulary" ${busy ? 'disabled' : ''}>${searchIcon}</button><button class="icon" data-action="options" aria-label="Vocabulary options" aria-haspopup="dialog" ${busy || !snapshot ? 'disabled' : ''}>•••</button></div></div>`;
  if (!snapshot || loading) { main.innerHTML = `${noticeHTML()}<section class="practice">${header}<div class="loading-state" role="status">${loading ? 'Opening your vocabulary…' : 'Your progress is safe on your Mac.'}</div></section>`; return; }
  if (!snapshot.current) {
    main.innerHTML = `${noticeHTML()}<section class="practice">${header}${workingCounts(categoryTitle(deck))}<div class="completion"><h1>A good place to pause.</h1><p>${esc(availabilityCopy())}</p><div class="summary-actions">${snapshot.stats.newAvailable > 0 ? `<button class="primary" data-action="start" ${locked() ? 'disabled' : ''}>Continue practice</button>` : ''}<button class="secondary" data-action="studied" ${busy ? 'disabled' : ''}>Your studied words</button><button class="secondary" data-action="grammar" ${busy ? 'disabled' : ''}>Explore grammar</button>${snapshot.undoId ? `<button class="quiet" data-action="undo" ${locked() ? 'disabled' : ''}>Undo last answer</button>` : ''}</div>${extraPracticeHTML()}</div></section>`; return;
  }
  main.innerHTML = `${noticeHTML()}<section class="practice">${header}${workingCounts(categoryTitle(deck))}${cardHTML()}</section>`;
  playCardOnce();
  warmClip(snapshot.current.audioUrl);
  warmClip(snapshot.next?.audioUrl);
}
function renderBrowse() {
  const show = [['all', 'All words'], ['studied', 'Studied'], ['learning', 'Still learning'], ['missed', 'Missed at least once']].map(([value, label]) => `<option value="${value}" ${browseShow === value ? 'selected' : ''}>${label}</option>`).join('');
  main.innerHTML = `${noticeHTML()}<section class="topics browse"><div class="section-top">${back('Vocabulary', 'vocabulary')}<button class="icon" data-action="options" aria-label="Vocabulary options" ${!snapshot || busy ? 'disabled' : ''}>•••</button></div><h1>Your words</h1><p class="subtitle">${esc(directionLabel())}</p><div class="browse-tools"><label class="sr-only" for="vocab-search">Search French or English vocabulary</label><input type="search" id="vocab-search" placeholder="Find a word…" value="${esc(search)}" autocomplete="off"><label class="sr-only" for="browse-category">Category</label><select id="browse-category">${optionsHTML(browseCategory)}</select></div><div class="browse-filters"><label class="sr-only" for="browse-show">Show</label><select id="browse-show">${show}</select><button class="secondary chip" data-action="toggle-hide" aria-pressed="${hideTranslations}">${hideTranslations ? 'Show translations' : 'Hide translations'}</button></div><div id="browse-results"></div></section>`;
  renderBrowseResults();
}
function normalized(value) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase(); }
function renderBrowseResults() {
  const container = document.querySelector('#browse-results'); if (!container) return;
  if (browseLoading) { container.innerHTML = '<div class="loading-state" role="status">Finding your words…</div>'; return; }
  if (browseError) { container.innerHTML = `<div class="notice" role="alert"><span>${esc(browseError)}</span><button class="quiet" data-action="retry-browse">Retry</button></div>`; return; }
  const query = normalized(search.trim());
  const matches = { all: () => true, studied: (word) => word.lastStudied, learning: (word) => word.status === 'learning', missed: (word) => word.misses > 0 }[browseShow];
  const filtered = (words || []).filter((word) => (browseCategory === 'all' || word.category === browseCategory) && matches(word) && (!query || normalized(`${word.fr} ${word.en}`).includes(query)));
  // Studied views put the most recently practised words first.
  if (browseShow !== 'all') filtered.sort((a, b) => (b.lastStudied || '').localeCompare(a.lastStudied || ''));
  const reverse = direction === 'en-fr';
  const rowText = (word) => {
    const hidden = hideTranslations && !revealedWords.has(word.id);
    if (!hidden) return `<h2 lang="fr">${esc(word.fr)}</h2><p>${esc(word.en)}</p>`;
    const reveal = `<button class="reveal-word" data-reveal-word="${esc(word.id)}">${reverse ? 'Show French' : 'Show English'}</button>`;
    return reverse ? `<h2 lang="en">${esc(word.en)}</h2>${reveal}` : `<h2 lang="fr">${esc(word.fr)}</h2>${reveal}`;
  };
  const history = (word) => [
    categoryTitle(word.category),
    word.lastStudied ? `Studied ${dayLabel(word.lastStudied)}` : '',
    word.misses ? `Missed ${word.misses}×` : '',
    word.status === 'scheduled' && word.due ? `Review ${dateLabel(word.due)}` : '',
    word.note || '',
  ].filter(Boolean).map(esc).join(' · ');
  const empty = browseShow === 'all' ? 'No words match. Try another spelling or category.' : 'No words here yet. Practise some vocabulary and they will appear.';
  container.innerHTML = `<p class="browse-count" role="status">${filtered.length} ${filtered.length === 1 ? 'word' : 'words'}${hideTranslations && filtered.length ? ' · recall each one, then check it' : ''}</p>${filtered.map((word) => `<article class="word-row"><div>${rowText(word)}<small>${history(word)}</small></div><div class="word-controls"><small>${esc(({ new: 'New', learning: 'Learning', due: 'Due', scheduled: 'Scheduled' })[word.status])}</small><button class="icon" data-play-word="${esc(word.id)}" aria-label="Pronounce ${esc(word.fr)}">${speaker}</button></div></article>`).join('') || `<p class="empty-list">${empty}</p>`}`;
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
  main.innerHTML = `${noticeHTML()}<section class="topics"><div class="section-top">${back('Home', 'home')}</div><h1>Grammar & sentences</h1><p class="subtitle">Practise a topic, then test yourself. Each unit ends with a test across its topics.</p>${units ? list : loading ? '<div class="loading-state" role="status">Opening the workshop…</div>' : ''}</section>`;
}
// The example holds two or three sentences separated by " · "; each gets its own line.
function exampleHTML(topic) { return `<div class="rule-example" lang="fr">${topic.example.split(' · ').map((line) => `<p>${frEsc(line)}</p>`).join('')}</div>`; }
function renderTopic() {
  const topic = topicPage?.id === topicId ? topicPage : units?.flatMap((unit) => unit.topics).find((entry) => entry.id === topicId);
  if (!topic) { main.innerHTML = `${noticeHTML()}<section class="topic-page"><div class="section-top">${back('Grammar', 'grammar')}</div>${loading ? '<div class="loading-state" role="status">Opening the topic…</div>' : ''}</section>`; return; }
  const { progress, test } = topic;
  const practised = progress.seen ? `${progress.seen} of ${topic.exerciseCount} questions practised · ${progress.independent} on your own · ${progress.needsReview} to revisit` : `${topic.exerciseCount} questions to practise`;
  const history = test.taken ? `<div class="history-row"><span>Best</span><strong>${test.best.score} / ${test.best.total}</strong></div><div class="history-row"><span>Last · ${esc(dateLabel(test.last.finishedAt))}</span><strong>${test.last.score} / ${test.last.total}</strong></div><div class="history-row"><span>Taken</span><strong>${test.taken} ${test.taken === 1 ? 'time' : 'times'}</strong></div>` : `<p class="caption">No tests yet. A test asks ${topic.testLength} questions with no help and one try each; anything you miss comes back first when you practise.</p>`;
  main.innerHTML = `${noticeHTML()}<section class="topic-page"><div class="section-top">${back('Grammar', 'grammar')}</div><p class="topic-kicker" lang="fr" aria-hidden="true">${esc(topic.mark)}</p><div class="topic-heading"><h1>${esc(topic.title)}</h1><span class="level-tag">${esc(topic.level)}</span></div><p class="subtitle">${esc(topic.description)}</p><div class="topic-actions"><button class="primary" data-scope="${esc(topic.id)}" ${locked() ? 'disabled' : ''}>${topic.hasActiveSession ? 'Continue your round' : `Practise · ${topic.practiceLength} questions`}</button><button class="secondary" data-scope="test:${esc(topic.id)}" ${locked() ? 'disabled' : ''}>${topic.hasActiveTest ? 'Continue your test' : `Take the test · ${topic.testLength} questions`}</button></div><p class="caption topic-meta">${practised}</p><section class="rule-card" aria-labelledby="rule-heading"><h2 id="rule-heading">The rule</h2><p>${esc(topic.rule)}</p>${exampleHTML(topic)}${topic.aside ? `<p>${esc(topic.aside)}</p>` : ''}</section><section class="test-history" aria-labelledby="history-heading"><h2 id="history-heading">Your tests</h2>${history}</section></section>`;
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
  return `<p class="prompt-sentence" lang="${exercise.type === 'translate' ? 'en' : 'fr'}">${exercise.type === 'translate' ? esc(exercise.source) : frEsc(exercise.source)}</p>`;
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
function feedbackHTML(current, test) {
  const feedback = current.feedback;
  if (!feedback) return '';
  const exercise = current.exercise;
  const tone = feedback.kind === 'incorrect' ? 'warn' : feedback.kind === 'alternative' || feedback.kind === 'shown' ? 'neutral' : '';
  const title = test && current.settled
    ? ({ correct: 'That’s right.', incorrect: 'Not quite.', alternative: 'Valid French, different form.' })[feedback.kind]
    : ({ correct: current.assisted || current.attempts > 1 ? 'You’ve got it.' : 'That’s right.', incorrect: 'Not quite yet.', alternative: 'Valid French, different form.', shown: 'One correct answer' })[feedback.kind];
  const answer = feedback.answer ? completed(exercise.type, exercise.source, feedback.answer) : '';
  const model = answer && (feedback.kind === 'shown' || (test && feedback.kind !== 'correct')) ? `<p class="model-answer" lang="fr">${esc(answer)}</p>` : '';
  const clip = current.settled && current.audio ? `<button class="quiet audio-line" data-action="grammar-audio" aria-label="Hear the correct French sentence">${speaker}<span>Hear it</span></button>` : '';
  return `<div class="feedback ${tone}" role="status"><strong>${title}</strong>${feedback.note ? `<p>${esc(feedback.note)}</p>` : ''}${model}<p>${esc(feedback.message)}</p>${feedback.spelling && answer ? `<span class="minor">A spelling detail to review: <span lang="fr">${esc(answer)}</span></span>` : ''}${feedback.kind === 'shown' ? '<span class="minor">This example stays in your revisit set.</span>' : ''}${clip}${!test && !current.settled ? `<button class="quiet" data-action="show-answer" ${locked() ? 'disabled' : ''}>Show one answer instead</button>` : ''}</div>`;
}
// The question itself: instruction, prompt, answer, feedback, help and the one primary button.
// The Grammar screens and the Practise stream both render it; only the frame around it differs.
function exerciseCoreHTML(snap, test, nextText) {
  const session = snap.session; const current = session.current; const exercise = current.exercise;
  const disabled = locked() || current.settled;
  const primary = current.settled ? `<button class="primary" data-action="next" ${locked() ? 'disabled' : ''}>${busy ? 'Saving…' : nextText}</button>`
    : exercise.type === 'choose' ? '' : `<button class="primary" data-action="check" ${locked() ? 'disabled' : ''}>${busy ? 'Saving…' : 'Check answer'}</button>`;
  const helpButton = !test && !current.settled ? `<button class="quiet accent" data-action="hint" ${locked() ? 'disabled' : ''}>${current.hint && hintOpen ? 'Hide hint' : 'A little help'}</button>` : '';
  const actions = primary || helpButton ? `<div class="exercise-actions">${helpButton || '<span></span>'}${primary}</div>` : '';
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
  main.innerHTML = `${noticeHTML()}<section class="exercise"><div class="section-top">${backButton}${test ? '' : `<button class="quiet" data-action="rule" aria-haspopup="dialog" ${locked() ? 'disabled' : ''}>The rule</button>`}</div><div class="exercise-head"><h1>${esc(heading)}</h1><span class="progress">${test ? 'Test · ' : ''}${session.index + 1} / ${session.total}</span></div>${unitScope ? `<p class="question-topic">${esc(current.exercise.topicTitle)}</p>` : ''}${exerciseCoreHTML(grammar, test, nextText)}</section>`;
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
      marks.push({ at, end, fr: entry.fr });
    }
  }
  marks.sort((a, b) => a.at - b.at);
  let html = '';
  let at = 0;
  for (const mark of marks) {
    const button = `<button class="gloss" data-gloss="${esc(mark.fr)}">${frEsc(text.slice(mark.at, mark.end))}</button>`;
    // A button is an inline block, so the line may break after it; keep a following " ?" with its word.
    const tail = /^ [?!:;»]/.exec(text.slice(mark.end))?.[0] || '';
    html += `${frEsc(text.slice(at, mark.at))}${tail ? `<span class="nowrap">${button}${frEsc(tail)}</span>` : button}`;
    at = mark.end + tail.length;
  }
  return html + frEsc(text.slice(at));
}
function glossFor(fr) {
  const lists = [streamState?.result?.gloss, streamState?.current?.gloss];
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
  const button = big
    ? `<button class="listen-play" data-action="play-clips" aria-label="Play the French">${speaker}</button>`
    : `<button class="icon" data-action="play-clips" aria-label="Play the French again">${speaker}</button>`;
  return `<div class="listen-block${big ? ' big' : ''}">${button}<p class="listen-hint" id="clip-progress" role="status">${esc(hint)}</p></div>`;
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
  return `${context}<p class="prompt-instruction">${esc(STREAM_INSTRUCTION[`${view.mode}:${view.kind}`] || '')}</p>${streamAudioHTML(view, settled)}${streamPromptHTML(view, settled)}<div class="answer-area">${streamAnswerHTML(view, result)}</div>${settled ? `${streamResultHTML(view, result)}${streamRevealHTML(result)}` : ''}${action ? `<div class="stream-actions">${action}</div>` : ''}`;
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
function openWalkman() { if (move('walkman', true)) loadTape(); }
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
function replayClips() {
  const view = streamState?.current;
  if (!view?.audio?.length) return;
  audioBlocked = false; heardKey = `${streamId}:${view.key}`;
  playClips(view.audio);
}
// Tapping a French word shows its meaning; before answering in Read that counts as help.
function lookupGloss(fr) {
  const entry = glossFor(fr);
  if (!entry) return;
  glossWord = entry; addStatus = '';
  renderGlossSheet();
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
  openDialog(entry.fr, `<p class="gloss-en">${esc(entry.en)}</p>${add}<button class="primary dialog-action" data-action="close-dialog">Close</button>`, 'gloss');
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
    const result = await api(paths[action.type], { method: 'POST', body: JSON.stringify(action.body) });
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
  if (name !== 'mix' && name !== 'focus') { mixedSource = ''; review = null; }
  if (name !== 'listen' && name !== 'read' && name !== 'mix' && name !== 'focus') { streamState = null; streamId = ''; }
  // Leaving the Walkman stops the tape; coming back winds a new one.
  if (name !== 'walkman' && walkmanAudio.src) {
    ++walkmanGeneration; walkmanAudio.pause(); walkmanAudio.removeAttribute('src'); walkmanAudio.load();
    walkman = { tape: null, index: -1, meaning: false, loading: false, started: false, logged: new Set() };
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  }
  if (name !== 'walkman') { heardOpen = false; heardSaying = ''; heardResume = false; }
  screen = name; render(); window.scrollTo(0, 0); main.focus({ preventScroll: true });
  if (name === 'home') fetchState();
}
async function startPractice() {
  if (busy) return;
  move('practice', true);
  if (locked()) return;
  if (!await fetchState()) return;
  if (screen === 'practice') runMutation({ type: 'start', body: { direction, deck } });
}
function vocabularyCard() { return !!snapshot?.current && (screen === 'practice' || (mixed() && mixedSource === 'vocabulary')); }
function reveal() {
  if (!vocabularyCard() || revealed || locked() || loading) return;
  revealed = true; render(); document.querySelector('#flashcard')?.focus({ preventScroll: true });
  announce(`Answer: ${direction === 'en-fr' ? snapshot.current.fr : snapshot.current.en}.`);
  // Listen mode already played the word when the card appeared; the reveal only shows the answer.
  if (audioMode && !listening()) playFrench(snapshot.current.audioUrl);
}
function grade(known) {
  if (!revealed || locked() || loading || !vocabularyCard()) return;
  // The previous answer is still being saved: this one follows as soon as it is.
  if (pendingGrade) { queuedGrade = known; return; }
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
  pendingGrade = api('api/grade', { method: 'POST', body: JSON.stringify(body) }).then((result) => {
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
    pendingGrade = null;
    if (queuedGrade === null) return;
    const known = queuedGrade;
    queuedGrade = null;
    grade(known);
  });
}
function undo() {
  if (!snapshot?.undoId || locked()) return;
  const body = { direction, deck, undoId: snapshot.undoId };
  if (mixed()) runAction(async () => { applySnapshot(await api('api/undo', { method: 'POST', body: JSON.stringify(body) })); });
  else runMutation({ type: 'undo', body });
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
function showRule() {
  const topic = grammar.topic;
  openDialog(topic.title, `<div class="dialog-copy"><p>${esc(topic.rule)}</p>${exampleHTML(topic)}${topic.aside ? `<p>${esc(topic.aside)}</p>` : ''}</div><button class="primary dialog-action" data-action="close-dialog">Back to the sentence</button>`, 'rule');
}
function openOptions() {
  if (!snapshot) return;
  const disabled = locked() ? 'disabled' : '';
  openDialog('Vocabulary options', `<p class="settings-label">Direction</p><div class="segmented" role="group" aria-label="Practice direction"><button data-direction="fr-en" aria-pressed="${direction === 'fr-en'}" ${disabled}>French → English</button><button data-direction="en-fr" aria-pressed="${direction === 'en-fr'}" ${disabled}>English → French</button></div><div class="dialog-row"><label for="deck-select">Category</label><select id="deck-select" ${disabled}>${optionsHTML(deck)}</select></div><div class="dialog-row"><label for="audio-speed">Pronunciation speed</label><select id="audio-speed"><option value="1" ${speed === 1 ? 'selected' : ''}>Normal</option><option value="0.8" ${speed === 0.8 ? 'selected' : ''}>Slower</option></select></div><form id="goal-form" novalidate><div class="goal-row"><label for="daily-goal">New words / day<br><small>in each direction</small></label><input id="daily-goal" name="newPerDay" type="number" inputmode="numeric" min="0" max="${totalWords()}" step="1" value="${snapshot.settings.newPerDay}" aria-describedby="goal-help goal-feedback" ${disabled}><button class="secondary" type="submit" ${disabled}>Save</button></div><p id="goal-help" class="caption">Shared across categories. Resets at 04:00 on your Mac. Set 0 to pause new words; due reviews are not capped.</p><div id="goal-feedback" class="caption" role="status"></div></form>${extraPracticeHTML()}<div class="options-links"><button class="quiet" data-action="about">How it works</button><a href="api/export" download="echo-progress.json">Download my progress ↓</a></div><button class="primary dialog-action" data-action="close-dialog">Back to practice</button>`, 'options');
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
  else fetchState(action.message);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button'); if (button?.disabled) return;
  const action = button?.dataset.action;
  if (action === 'close-dialog') { if (!busy) dialog.close(); return; }
  if (action === 'audio-mode') { audioMode = !audioMode; savePreference('echo.audio-mode', audioMode ? 'on' : 'off'); if (!audioMode) stopAudio(); render(); return; }
  if (action === 'listen-mode') { listenMode = !listenMode; savePreference('echo.listen-mode', listenMode ? 'on' : 'off'); heardCard = ''; if (!listenMode) stopAudio(); render(); return; }
  if (action === 'replay') { if (snapshot?.current) playFrench(snapshot.current.audioUrl); return; }
  if (action === 'play-clips') { replayClips(); return; }
  if (action === 'grammar-audio') { const clip = activeGrammar()?.session?.current?.audio; if (clip) playFrench(clip); return; }
  if (button?.dataset.gloss !== undefined) { lookupGloss(button.dataset.gloss); return; }
  if (action === 'add-word') { addWord(); return; }
  if (busy) return;
  if (button?.dataset.direction) {
    if (locked() || direction === button.dataset.direction) return;
    direction = button.dataset.direction; savePreference('echo.direction', direction); dialog.close(); startPractice(); return;
  }
  if (button?.dataset.playWord) { const word = words?.find((entry) => entry.id === button.dataset.playWord); if (word) playFrench(`audio/${encodeURIComponent(word.id)}.mp3`); return; }
  if (button?.dataset.revealWord) { revealedWords.add(button.dataset.revealWord); renderBrowseResults(); return; }
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
  else if (action === 'toggle-hide') { hideTranslations = !hideTranslations; revealedWords.clear(); renderBrowse(); document.querySelector('[data-action="toggle-hide"]')?.focus(); }
  else if (action === 'extra-words' || action === 'review-early') extraPractice(action, button.dataset);
  else if (action === 'options') openOptions();
  else if (action === 'about') { dialog.close(); stopAudio(); aboutDialog.showModal(); }
  else if (action === 'again') grade(false);
  else if (action === 'known') grade(true);
  else if (action === 'undo') undo();
  else if (action === 'retry') retry();
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
  else if (action === 'walkman') openWalkman();
  else if (action === 'walkman-toggle') toggleWalkman();
  else if (action === 'walkman-heard') { heardOpen = !heardOpen; render(); }
  else if (action === 'walkman-say') hearAgain(button.dataset.word);
  else if (action === 'walkman-add') addHeard(button.dataset.word);
  else if (action === 'stream-check') streamCheck();
  else if (action === 'stream-next') streamNext();
  else if (event.target.closest('#flashcard') && !event.target.closest('button,a,input,select')) reveal();
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'deck-select' && !locked()) { deck = event.target.value; browseCategory = deck; savePreference('echo.deck', deck); dialog.close(); startPractice(); }
  else if (event.target.id === 'browse-category') { browseCategory = event.target.value; renderBrowseResults(); }
  else if (event.target.id === 'browse-show') { browseShow = event.target.value; renderBrowseResults(); }
  else if (event.target.id === 'audio-speed') { speed = event.target.value === '0.8' ? 0.8 : 1; savePreference('echo.speed', String(speed)); audio.playbackRate = speed; }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'vocab-search') { search = event.target.value; renderBrowseResults(); }
  if (event.target.id === 'answer') draft = event.target.value;
  if (event.target.id === 'stream-answer') streamDraft = event.target.value;
});
document.addEventListener('submit', (event) => {
  if (event.target.id === 'goal-form') saveGoal(event);
  else if (event.target.matches('.custom-count')) { event.preventDefault(); submitCustomCount(event.target); }
});
document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.repeat || aboutDialog.open || dialog.open || busy || loading || locked()) return;
  const grammarScreen = screen === 'exercise' || (mixed() && mixedSource === 'grammar');
  if (grammarScreen && (event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (activeGrammar()?.session?.current?.settled) grammarMutation('next'); else checkAnswer(); return; }
  // The verb-form field is one line, so Enter checks it (and continues once it is settled).
  if (grammarScreen && event.key === 'Enter' && !event.shiftKey && event.target.matches('input#answer')) { event.preventDefault(); if (activeGrammar()?.session?.current?.settled) grammarMutation('next'); else checkAnswer(); return; }
  // Enter checks what you typed, and continues once the exercise has settled.
  if (streamScreen() && streamState?.current && event.key === 'Enter' && !event.shiftKey && (event.target.matches('#stream-answer') || !event.target.closest('input,select,textarea,[contenteditable="true"],button,a'))) {
    event.preventDefault();
    if (streamState.result) streamNext(); else streamCheck();
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
  else if (screen === 'grammar' || screen === 'topic' || screen === 'exercise') loadGrammar();
  else if (screen === 'listen' || screen === 'read') enterStream();
  else if (screen === 'mix' || screen === 'focus') enterMixed();
  else if (screen === 'mistakes') loadMistakes();
  else if (screen === 'walkman') loadTape();
});
if (requestedScreen === 'practice') { if (move('practice', true)) fetchState(); }
else if (requestedScreen === 'grammar') { if (move('grammar', true)) loadGrammar(); }
else fetchState();
