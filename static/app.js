'use strict';

const main = document.querySelector('#main');
const aboutDialog = document.querySelector('#about-dialog');
const homeButton = document.querySelector('#home-button');
const speaker = '<svg class="speaker-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const readPreference = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const savePreference = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Preferences are optional; progress is server-owned. */ } };
let direction = readPreference('echo.direction', 'fr-en') === 'en-fr' ? 'en-fr' : 'fr-en';
let deck = readPreference('echo.deck', 'all');
let speed = readPreference('echo.speed', '1') === '0.8' ? 0.8 : 1;
let snapshot = null;
let screen = 'home';
let revealed = false;
let busy = false;
let loading = true;
let generation = 0;
let notice = null;
let retryAction = null;
let words = null;
let search = '';
let browseCategory = 'all';
let browseLoading = false;
let browseError = '';
let browseGeneration = 0;
const audio = new Audio();
audio.preload = 'none';
let audioGeneration = 0;
let audioTimer;

function announce(message) { document.querySelector('#announcer').textContent = message; }
function directionLabel() { return direction === 'fr-en' ? 'French → English' : 'English → French'; }
function deckTitle(id = deck) { return snapshot?.decks.find((entry) => entry.id === id)?.title || (id === 'all' ? 'All vocabulary' : id); }
function categoryTitle(category) { return snapshot?.decks.find((entry) => entry.id === category)?.title || category.replace(/[-_]/g, ' ').replace(/^./, (letter) => letter.toUpperCase()); }
function totalWords() { return snapshot?.decks.find((entry) => entry.id === 'all')?.count ?? snapshot?.decks.filter((entry) => entry.id !== 'all').reduce((sum, entry) => sum + entry.count, 0) ?? 0; }
function dateLabel(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date); }
function stopAudio() { audioGeneration++; audio.pause(); audio.removeAttribute('src'); audio.load(); clearTimeout(audioTimer); document.querySelector('#audio-status').hidden = true; }
function audioMessage(message) {
  const status = document.querySelector('#audio-status');
  clearTimeout(audioTimer);
  status.innerHTML = `<span>${esc(message)}</span><button type="button" aria-label="Dismiss audio message">×</button>`;
  status.hidden = false;
  status.querySelector('button').onclick = () => { status.hidden = true; };
  audioTimer = setTimeout(() => { status.hidden = true; }, 12000);
}
async function playFrench(url) {
  const token = ++audioGeneration;
  audio.pause();
  audio.src = url;
  audio.playbackRate = speed;
  audio.preservesPitch = true;
  audio.webkitPreservesPitch = true;
  try {
    // Call play directly in the click's user gesture; no fetch or await precedes it.
    await audio.play();
    if (token === audioGeneration) document.querySelector('#audio-status').hidden = true;
  } catch (error) {
    if (token !== audioGeneration) return;
    if (error.name === 'NotAllowedError') { audioMessage('Your browser blocked playback. Tap the pronunciation button again to play.'); return; }
    audioMessage('Pronunciation could not play. Checking the recording…');
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (token !== audioGeneration) return;
      if (!response.ok && response.headers.get('content-type')?.includes('application/json')) {
        const result = await response.json();
        if (token === audioGeneration) audioMessage(result.error || 'This recording is unavailable. Tap pronunciation to try again.');
      } else {
        if (response.body) await response.body.cancel();
        if (token === audioGeneration) audioMessage('This recording could not be played. Check your connection to your Mac, then tap pronunciation to retry.');
      }
    } catch { if (token === audioGeneration) audioMessage('Cannot reach your Mac for pronunciation. Check your connection, then tap pronunciation to retry.'); }
  }
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
    if (error.name === 'AbortError') throw new Error('The request timed out. Your place is unchanged here; retry to safely check and finish the same action.');
    if (error instanceof TypeError) throw new Error('Cannot reach your Mac. Check that Echo is running and your connection is available, then retry.');
    throw error;
  } finally { clearTimeout(timeout); }
}
function applySnapshot(next) {
  snapshot = next;
  direction = next.direction;
  deck = next.deck;
  savePreference('echo.direction', direction);
  savePreference('echo.deck', deck);
  revealed = false;
  announce('');
  stopAudio();
}
function noticeHTML() {
  if (!notice) return '';
  return `<div class="notice ${notice.kind === 'info' ? 'info' : ''}" role="${notice.kind === 'info' ? 'status' : 'alert'}"><span>${esc(notice.message)}</span>${retryAction ? '<button type="button" data-action="retry">Retry</button>' : ''}</div>`;
}
function optionsHTML(selected, includeCounts = true) {
  return (snapshot?.decks || []).map((entry) => `<option value="${esc(entry.id)}" ${entry.id === selected ? 'selected' : ''}>${esc(entry.title)}${includeCounts ? ` · ${entry.count}` : ''}</option>`).join('');
}
function render() {
  homeButton.disabled = busy;
  if (!snapshot) {
    main.innerHTML = `${noticeHTML()}<div class="loading-state" role="status">${notice ? 'Your progress is safe on your Mac.' : 'Opening your vocabulary…'}</div>`;
    return;
  }
  if (screen === 'practice') renderPractice();
  else if (screen === 'browse') renderBrowse();
  else renderHome();
}
function renderHome() {
  if (!snapshot) return;
  const stats = snapshot.stats;
  const available = !!snapshot.current || stats.remaining > 0 || stats.newAvailable > 0;
  const callToAction = busy ? 'Opening practice…' : snapshot.current || stats.learning > 0 ? 'Continue practice' : available ? 'Start practice' : 'Nothing due right now';
  main.innerHTML = `${noticeHTML()}
    <section class="intro"><span class="eyebrow">YOUR FRENCH, A LITTLE CLOSER</span><h1>Make room for<br><em>a few new words.</em></h1><p>A quiet moment to recall, repeat, and remember.</p></section>
    <div class="home-layout"><section class="practice-panel" aria-label="Your practice">
      <div class="panel-heading"><span class="eyebrow">TODAY’S PRACTICE</span><span class="category-label">${stats.total.toLocaleString()} words</span></div>
      <div class="direction-switch" role="group" aria-label="Practice direction"><button data-direction="fr-en" aria-pressed="${direction === 'fr-en'}" ${busy ? 'disabled' : ''}>French → English</button><button data-direction="en-fr" aria-pressed="${direction === 'en-fr'}" ${busy ? 'disabled' : ''}>English → French</button></div>
      <label class="select-label" for="deck-select">Your vocabulary</label><div class="select-wrap"><select id="deck-select" ${busy ? 'disabled' : ''}>${optionsHTML(deck)}</select></div>
      <div class="stats" aria-label="Today’s progress"><div class="stat"><span class="stat-number">${stats.due}</span><span class="stat-label">Due reviews</span></div><div class="stat"><span class="stat-number">${stats.newAvailable}</span><span class="stat-label">New available</span></div><div class="stat"><span class="stat-number">${stats.completedToday}</span><span class="stat-label">Cycles finished</span></div></div>
      <button class="primary-button" data-action="start" ${busy || loading || !available ? 'disabled' : ''}><span class="button-text">${callToAction}</span><span class="button-arrow" aria-hidden="true">↗</span></button>
      <p class="panel-footnote">${stats.learning ? `${stats.learning} words in progress. ` : ''}${available ? 'Two successful recalls. One word closer.' : availabilityCopy()}</p>
    </section><div class="side-stack"><button class="browse-link" data-action="browse" ${busy ? 'disabled' : ''}><span class="eyebrow">THE COLLECTION</span><h3>Your growing vocabulary.</h3><p>Every word, its meaning, and a voice to bring it to life.</p><span class="link-end"><span>Browse vocabulary</span><span aria-hidden="true">↗</span></span></button>
      <section class="goal-panel" aria-labelledby="goal-heading"><h3 id="goal-heading">Your daily rhythm</h3><form id="goal-form" novalidate><div class="goal-row"><input id="daily-goal" name="newPerDay" type="number" inputmode="numeric" min="0" max="${totalWords()}" step="1" value="${snapshot.settings.newPerDay}" aria-label="New words per day, in each direction" aria-describedby="goal-help goal-feedback" ${busy ? 'disabled' : ''}><label for="daily-goal">new words / day<br>in each direction</label><button type="submit" ${busy ? 'disabled' : ''}>Save</button></div><p id="goal-help">Shared across categories. Resets at 04:00 on your Mac. Reviews keep their own rhythm.</p><div id="goal-feedback" role="status"></div></form></section>
    </div></div>`;
}
function availabilityCopy() {
  const parts = [];
  if (snapshot.nextDue) parts.push(`Next review: ${esc(dateLabel(snapshot.nextDue))}.`);
  if (snapshot.stats.unseen > 0 && snapshot.stats.newAvailable === 0) parts.push(snapshot.settings.newPerDay === 0 ? 'New words are paused with your daily goal at 0.' : 'New words return with your next daily allowance at 04:00 on your Mac.');
  return parts.join(' ') || 'You’re up to date in this vocabulary selection.';
}
function renderPractice() {
  if (!snapshot) return;
  const card = snapshot.current;
  const header = `<div class="practice-header"><button class="back-button" data-action="home" ${busy ? 'disabled' : ''}><span aria-hidden="true">←</span> Home</button><div class="practice-meta"><strong>${esc(directionLabel())}</strong><br>${esc(deckTitle())}</div></div>`;
  if (!card) {
    main.innerHTML = `${noticeHTML()}${header}<section class="completion"><img src="icon.svg" alt="" width="74" height="74"><span class="eyebrow">A LITTLE FURTHER THAN BEFORE</span><h1>Let it settle.</h1><p>${snapshot.stats.completedToday} ${snapshot.stats.completedToday === 1 ? 'cycle' : 'cycles'} finished today in this selection.<br>${availabilityCopy()}</p><button class="secondary-button" data-action="home" ${busy ? 'disabled' : ''}>Back to your vocabulary <span aria-hidden="true">↗</span></button>${snapshot.undoId ? `<button class="undo-button" data-action="undo" ${busy ? 'disabled' : ''}>↶ Undo last answer</button>` : ''}</section>`;
    return;
  }
  const reverse = direction === 'en-fr';
  const prompt = reverse ? card.en : card.fr;
  const answer = reverse ? card.fr : card.en;
  const audioAllowed = !reverse || revealed;
  const successes = Math.max(0, Math.min(2, card.successes));
  main.innerHTML = `${noticeHTML()}${header}<section class="practice-area" aria-label="Flashcard practice"><div class="recall-header"><span class="category-label">${esc(categoryTitle(card.category))} · ${card.stage === 'new' ? 'New word' : card.stage === 'learning' ? 'In progress' : 'Review'}</span><div class="recall-progress" aria-label="${successes} of 2 consecutive successful recalls"><span class="dot ${successes >= 1 ? 'filled' : ''}" aria-hidden="true"></span><span class="dot ${successes >= 2 ? 'filled' : ''}" aria-hidden="true"></span><span class="count" aria-hidden="true">${successes} / 2</span></div></div>
    <div class="flashcard ${revealed ? 'revealed' : ''}" id="flashcard" role="${revealed ? 'group' : 'button'}" tabindex="${revealed ? '-1' : '0'}" aria-label="${revealed ? 'Revealed flashcard. Left: didn’t know. Right: knew it.' : 'Flashcard. Tap or press Space to reveal the answer.'}" aria-busy="${busy}"><div class="prompt-language">${reverse ? 'English' : 'French'}</div><h1 class="word-prompt" lang="${reverse ? 'en' : 'fr'}">${esc(prompt)}</h1>
      ${revealed ? `<div class="answer-block"><p class="word-answer" lang="${reverse ? 'fr' : 'en'}">${esc(answer)}</p>${card.note ? `<p class="word-note">${esc(card.note)}</p>` : ''}</div>` : '<p class="reveal-hint"><span aria-hidden="true">↳</span> Recall it. Then tap to reveal.</p>'}
      ${revealed ? `<button class="card-zone" data-action="again" aria-label="Didn’t know. Reset recall count." ${busy || retryAction ? 'disabled' : ''}><span>← Didn’t know</span></button><button class="card-zone known" data-action="known" aria-label="Knew it. ${successes === 1 ? 'Finish this review cycle.' : 'One step toward remembering.'}" ${busy || retryAction ? 'disabled' : ''}><span>${busy ? 'Saving…' : 'Knew it →'}</span></button>` : ''}
    </div>
    <div class="practice-bottom"><div class="audio-controls">${audioAllowed ? `<button class="audio-button" data-action="play-card" aria-label="Play French pronunciation" title="Play French pronunciation">${speaker}</button><select class="speed-select" aria-label="Pronunciation playback speed"><option value="1" ${speed === 1 ? 'selected' : ''}>1×</option><option value="0.8" ${speed === 0.8 ? 'selected' : ''}>0.8×</option></select>` : ''}</div>${snapshot.undoId ? `<button class="undo-button" data-action="undo" ${busy || retryAction ? 'disabled' : ''}>↶ Undo</button>` : ''}</div>
  </section>`;
}
function renderBrowse() {
  main.innerHTML = `${noticeHTML()}<button class="back-button" data-action="home"><span aria-hidden="true">←</span> Home</button><div class="browse-title-row"><div><span class="eyebrow">THE COLLECTION</span><h1>A world of words.</h1><p>Memory status for ${esc(directionLabel())}.</p></div></div><div class="browse-tools"><label class="sr-only" for="vocab-search">Search French or English vocabulary</label><input class="search-input" type="search" id="vocab-search" placeholder="Search in French or English…" value="${esc(search)}" autocomplete="off"><div class="select-wrap"><label class="sr-only" for="browse-category">Vocabulary category</label><select id="browse-category">${optionsHTML(browseCategory)}</select></div></div><div id="browse-results"></div>`;
  renderBrowseResults();
}
function normalized(value) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase(); }
function renderBrowseResults() {
  const container = document.querySelector('#browse-results');
  if (!container) return;
  if (browseLoading) { container.innerHTML = '<div class="loading-state" role="status">Finding your words…</div>'; return; }
  if (browseError) { container.innerHTML = `<div class="notice" role="alert"><span>${esc(browseError)}</span><button data-action="retry-browse">Retry</button></div>`; return; }
  const query = normalized(search.trim());
  const filtered = (words || []).filter((word) => (browseCategory === 'all' || word.category === browseCategory) && (!query || normalized(`${word.fr} ${word.en}`).includes(query)));
  container.innerHTML = `<p class="browse-count" role="status">${filtered.length} ${filtered.length === 1 ? 'word' : 'words'}</p><div class="vocab-list">${filtered.length ? filtered.map((word) => `<article class="vocab-row"><div><h2 class="vocab-fr" lang="fr">${esc(word.fr)}</h2><p class="vocab-en">${esc(word.en)}</p><p class="vocab-meta">${esc(categoryTitle(word.category))}${word.due && word.status === 'scheduled' ? ` · Review ${esc(dateLabel(word.due))}` : ''}${word.note ? ` · ${esc(word.note)}` : ''}</p></div><div class="vocab-right"><span class="status-pill ${word.status}">${({ new: 'New', learning: 'Learning', due: 'Due', scheduled: 'Scheduled' })[word.status]}</span><button class="audio-button" data-play-word="${esc(word.id)}" aria-label="Play pronunciation of ${esc(word.fr)}">${speaker}</button></div></article>`).join('') : '<div class="empty-list">No words match this search.<br>Try another spelling or category.</div>'}</div>`;
}
async function fetchState(message = '') {
  const token = ++generation;
  loading = true;
  notice = message ? { kind: 'info', message } : null;
  retryAction = null;
  snapshot = null;
  render();
  try {
    const result = await api(`api/state?direction=${encodeURIComponent(direction)}&deck=${encodeURIComponent(deck)}`);
    if (token !== generation) return;
    applySnapshot(result);
    loading = false;
    render();
  } catch (error) {
    if (token !== generation) return;
    loading = false;
    notice = { message: error.message };
    retryAction = { type: 'state', message };
    render();
  }
}
async function runMutation(action) {
  if (busy) return;
  busy = true;
  const token = ++generation;
  notice = null;
  retryAction = null;
  render();
  const paths = { start: 'api/session', grade: 'api/grade', undo: 'api/undo' };
  try {
    const result = await api(paths[action.type], { method: 'POST', body: JSON.stringify(action.body) });
    if (token !== generation) return;
    applySnapshot(result);
    busy = false;
    screen = 'practice';
    render();
    main.focus({ preventScroll: true });
    announce(result.current ? `${action.type === 'undo' ? 'Last answer undone. ' : ''}Next card. ${direction === 'en-fr' ? result.current.en : result.current.fr}` : 'Practice complete. Your progress is saved.');
  } catch (error) {
    if (token !== generation) return;
    busy = false;
    if (error.status === 409) {
      await fetchState(`${error.message} Your progress was refreshed from your Mac. Reveal the current card again before answering.`);
    } else {
      notice = { message: error.message };
      retryAction = action;
      render();
    }
  }
}
function startPractice() { if (!snapshot || loading || busy) return; stopAudio(); runMutation({ type: 'start', body: { direction, deck } }); }
function reveal() {
  if (screen !== 'practice' || !snapshot?.current || revealed || busy || loading) return;
  revealed = true;
  renderPractice();
  document.querySelector('#flashcard')?.focus({ preventScroll: true });
  announce(`Answer: ${direction === 'en-fr' ? snapshot.current.fr : snapshot.current.en}. Did you know it?`);
}
function requestId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function grade(known) {
  if (!revealed || busy || loading || retryAction || screen !== 'practice' || !snapshot?.current) return;
  const card = snapshot.current;
  stopAudio();
  runMutation({ type: 'grade', body: { direction, deck, wordId: card.id, version: card.version, known, requestId: requestId() } });
}
function undo() {
  if (!snapshot?.undoId || busy || retryAction) return;
  runMutation({ type: 'undo', body: { direction, deck, undoId: snapshot.undoId } });
}
async function goHome() {
  if (busy) return;
  stopAudio();
  screen = 'home';
  revealed = false;
  browseGeneration++;
  await fetchState();
  main.focus({ preventScroll: true });
}
async function browseWords() {
  if (busy || !snapshot) return;
  stopAudio();
  screen = 'browse';
  search = '';
  browseCategory = deck;
  words = null;
  await loadBrowse();
}
async function loadBrowse() {
  const token = ++browseGeneration;
  browseLoading = true;
  browseError = '';
  renderBrowse();
  try {
    const result = await api(`api/words?direction=${encodeURIComponent(direction)}&deck=all`);
    if (token !== browseGeneration || screen !== 'browse') return;
    words = result.words;
    browseLoading = false;
    renderBrowseResults();
  } catch (error) {
    if (token !== browseGeneration || screen !== 'browse') return;
    browseLoading = false;
    browseError = error.message;
    renderBrowseResults();
  }
}
async function saveGoal(event) {
  event.preventDefault();
  if (busy || !snapshot) return;
  const input = document.querySelector('#daily-goal');
  const feedback = document.querySelector('#goal-feedback');
  const raw = input.value.trim();
  const value = Number(raw);
  if (raw === '' || !Number.isInteger(value) || value < 0 || value > totalWords()) {
    input.setAttribute('aria-invalid', 'true');
    feedback.className = 'inline-error';
    feedback.textContent = `Choose a whole number from 0 to ${totalWords()}. Use 0 to pause new words; reviews remain available.`;
    input.focus();
    return;
  }
  input.removeAttribute('aria-invalid');
  busy = true;
  homeButton.disabled = true;
  const controlStates = Array.from(main.querySelectorAll('button,input,select'), (control) => [control, control.disabled]);
  for (const [control] of controlStates) control.disabled = true;
  feedback.className = 'inline-success';
  feedback.textContent = 'Saving…';
  const token = generation;
  try {
    await api('api/settings', { method: 'PUT', body: JSON.stringify({ newPerDay: value }) });
    if (token !== generation || screen !== 'home') return;
    busy = false;
    await fetchState(`Daily goal saved: ${value} new words per day, in each direction. Words already introduced today still count toward today’s allowance.`);
  } catch (error) {
    if (token !== generation || screen !== 'home') return;
    feedback.className = 'inline-error';
    feedback.textContent = error.message + ' Press Save to retry.';
    busy = false;
    homeButton.disabled = false;
    for (const [control, wasDisabled] of controlStates) control.disabled = wasDisabled;
  }
}
main.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button?.disabled) return;
  if (button?.dataset.direction) {
    if (busy || button.dataset.direction === direction) return;
    direction = button.dataset.direction;
    savePreference('echo.direction', direction);
    fetchState();
    return;
  }
  if (button?.dataset.playWord) {
    const word = words?.find((entry) => entry.id === button.dataset.playWord);
    if (word) playFrench(`audio/${encodeURIComponent(word.id)}.mp3`);
    return;
  }
  const action = button?.dataset.action;
  if (action) {
    if (action === 'home') goHome();
    else if (action === 'start') startPractice();
    else if (action === 'browse') browseWords();
    else if (action === 'again') grade(false);
    else if (action === 'known') grade(true);
    else if (action === 'undo') undo();
    else if (action === 'retry-browse') loadBrowse();
    else if (action === 'retry' && retryAction) { const retry = retryAction; retry.type === 'state' ? fetchState(retry.message) : runMutation(retry); }
    else if (action === 'play-card' && snapshot?.current && (direction === 'fr-en' || revealed)) playFrench(snapshot.current.audioUrl);
    return;
  }
  const card = event.target.closest('#flashcard');
  if (!card || event.target.closest('button,select,input,a,.audio-controls') || busy || retryAction) return;
  if (!revealed) reveal();
});
main.addEventListener('change', (event) => {
  if (event.target.id === 'deck-select' && !busy) { deck = event.target.value; savePreference('echo.deck', deck); fetchState(); }
  else if (event.target.id === 'browse-category') { browseCategory = event.target.value; renderBrowseResults(); }
  else if (event.target.matches('.speed-select')) { speed = event.target.value === '0.8' ? 0.8 : 1; savePreference('echo.speed', String(speed)); audio.playbackRate = speed; }
});
main.addEventListener('input', (event) => { if (event.target.id === 'vocab-search') { search = event.target.value; renderBrowseResults(); } });
main.addEventListener('submit', (event) => { if (event.target.id === 'goal-form') saveGoal(event); });
document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey || aboutDialog.open || screen !== 'practice' || busy || loading || retryAction || !snapshot?.current) return;
  if (event.target.closest('input,select,textarea,dialog,[contenteditable="true"]')) return;
  if (!revealed && (event.key === ' ' || event.key === 'Enter')) {
    if (event.target.closest('button,a')) return;
    event.preventDefault(); reveal();
  } else if (revealed && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    if (event.target.closest('button,a') && !event.target.closest('.card-zone')) return;
    event.preventDefault(); grade(event.key === 'ArrowRight');
  }
});
homeButton.addEventListener('click', goHome);
document.querySelector('#about-button').addEventListener('click', () => { stopAudio(); aboutDialog.showModal(); });
document.querySelector('#close-about').addEventListener('click', () => aboutDialog.close());
aboutDialog.addEventListener('click', (event) => { if (event.target === aboutDialog) { const box = aboutDialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) aboutDialog.close(); } });
fetchState();
