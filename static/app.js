'use strict';

const main = document.querySelector('#main');
const aboutDialog = document.querySelector('#about-dialog');
const dialog = document.querySelector('#dialog');
const homeButton = document.querySelector('#home-button');
const speaker = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const searchIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const formatCount = new Intl.NumberFormat('en').format;
const readPreference = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const savePreference = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Progress is server-owned; local preferences are optional. */ } };
let direction = readPreference('echo.direction', 'fr-en') === 'en-fr' ? 'en-fr' : 'fr-en';
let deck = readPreference('echo.deck', 'all');
let speed = readPreference('echo.speed', '1') === '0.8' ? 0.8 : 1;
let audioMode = readPreference('echo.audio-mode', 'off') === 'on';
let screen = readPreference('echo.section', 'home');
if (!['home', 'practice', 'browse', 'grammar', 'exercise'].includes(screen)) screen = 'home';
let topicId = readPreference('echo.topic', '');
let snapshot = null;
let grammar = null;
let topics = null;
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
const audio = new Audio();
audio.preload = 'none';
let audioGeneration = 0;
let audioTimer;

function announce(message) { document.querySelector('#announcer').textContent = message; }
function locked() { return busy || !!retryAction?.body; }
function directionLabel() { return direction === 'fr-en' ? 'French → English' : 'English → French'; }
function categoryTitle(category) { return snapshot?.decks.find((entry) => entry.id === category)?.title || category.replace(/[-_]/g, ' ').replace(/^./, (letter) => letter.toUpperCase()); }
function totalWords() { return snapshot?.decks.find((entry) => entry.id === 'all')?.count ?? 0; }
function dateLabel(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date); }
function stopAudio() { audioGeneration++; audio.pause(); audio.removeAttribute('src'); audio.load(); clearTimeout(audioTimer); document.querySelector('#audio-status').hidden = true; }
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
  audio.pause(); audio.src = url; audio.playbackRate = speed; audio.preservesPitch = true; audio.webkitPreservesPitch = true;
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
  draftKey = key; grammar = next; topicId = next.topic.id;
  savePreference('echo.topic', topicId);
}
function noticeHTML() {
  if (!notice) return '';
  return `<div class="notice ${notice.kind === 'info' ? 'info' : ''}" role="${notice.kind === 'info' ? 'status' : 'alert'}"><span>${esc(notice.message)}</span>${retryAction ? `<button class="quiet" data-action="retry" ${busy ? 'disabled' : ''}>Retry</button>` : ''}</div>`;
}
function optionsHTML(selected) { return (snapshot?.decks || []).map((entry) => `<option value="${esc(entry.id)}" ${entry.id === selected ? 'selected' : ''}>${esc(entry.title)} · ${entry.count}</option>`).join(''); }
function back(label, action) { return `<button class="back" data-action="${action}" ${busy ? 'disabled' : ''}><span aria-hidden="true">←</span> ${label}</button>`; }
function rememberScreen() { savePreference('echo.section', screen); }
function dailyCounts(label) {
  const unavailable = !snapshot || retryAction || snapshot.direction !== direction || snapshot.deck !== deck;
  const counts = loading ? '<span class="compact-status" role="status">Loading counts…</span>' : unavailable ? '<span class="compact-status">Counts unavailable</span>' : `<span class="compact-counts"><span class="unseen"><strong>${formatCount(snapshot.stats.unseenToday)}</strong> unseen</span><span class="separator" aria-hidden="true">·</span><span><strong>${formatCount(snapshot.stats.seenToday)}</strong> seen</span></span>`;
  return `<span class="compact-line"><span class="compact-label" title="${esc(label)}">${esc(label)}</span>${counts}</span>`;
}
function renderHome() {
  main.innerHTML = `${noticeHTML()}<section class="home"><h1>Choose your practice.</h1><div class="destinations"><button class="destination" data-action="start" ${locked() ? 'disabled' : ''}><span class="symbol letters" aria-hidden="true">Aa</span><h2>Vocabulary</h2><p>${esc(directionLabel())} · ${esc(categoryTitle(deck))}</p>${dailyCounts('Today')}<span class="end" aria-hidden="true">→</span></button><button class="destination" data-action="grammar" ${busy ? 'disabled' : ''}><span class="symbol" aria-hidden="true">≡</span><h2>Grammar & sentences</h2><p>Build, rewrite and correct sentences.</p><span class="end" aria-hidden="true">→</span></button></div></section>`;
}
function render() {
  homeButton.disabled = busy;
  document.querySelector('#about-button').disabled = busy;
  if (screen === 'practice') renderPractice();
  else if (screen === 'browse') renderBrowse();
  else if (screen === 'grammar') renderTopics();
  else if (screen === 'exercise') renderExercise();
  else renderHome();
}
function availabilityCopy() {
  const parts = [];
  const elsewhere = snapshot.overview.remaining + snapshot.overview.newAvailable;
  if (deck !== 'all' && snapshot.stats.newAvailable === 0 && elsewhere > 0) parts.push(`${formatCount(elsewhere)} ${elsewhere === 1 ? 'word is' : 'words are'} waiting in other categories. Choose All words in vocabulary options to continue.`);
  if (snapshot.nextDue) parts.push(`Next review: ${dateLabel(snapshot.nextDue)}.`);
  if (snapshot.stats.unseen > 0 && snapshot.stats.newAvailable === 0) parts.push(snapshot.settings.newPerDay === 0 ? 'New words are paused with your daily allowance at 0.' : 'New words return with your next daily allowance at 04:00 on your Mac.');
  return parts.join(' ') || 'You’re up to date in this vocabulary selection.';
}
function renderPractice() {
  const header = `<div class="section-top">${back('Home', 'home')}<div><span class="review-direction" aria-label="${esc(directionLabel())}">${direction === 'fr-en' ? 'FR → EN' : 'EN → FR'}</span><button class="icon" data-action="browse" aria-label="Browse vocabulary" ${busy ? 'disabled' : ''}>${searchIcon}</button><button class="icon" data-action="options" aria-label="Vocabulary options" aria-haspopup="dialog" ${busy || !snapshot ? 'disabled' : ''}>•••</button></div></div>`;
  if (!snapshot || loading) { main.innerHTML = `${noticeHTML()}<section class="practice">${header}<div class="loading-state" role="status">${loading ? 'Opening your vocabulary…' : 'Your progress is safe on your Mac.'}</div></section>`; return; }
  const card = snapshot.current;
  if (!card) {
    main.innerHTML = `${noticeHTML()}<section class="practice">${header}${dailyCounts(`${categoryTitle(deck)} · Today`)}<div class="completion"><h1>A good place to pause.</h1><p>${esc(availabilityCopy())}</p><div class="summary-actions">${snapshot.stats.newAvailable > 0 ? `<button class="primary" data-action="start" ${locked() ? 'disabled' : ''}>Continue practice</button>` : ''}<button class="secondary" data-action="grammar" ${busy ? 'disabled' : ''}>Explore grammar</button>${snapshot.undoId ? `<button class="quiet" data-action="undo" ${locked() ? 'disabled' : ''}>Undo last answer</button>` : ''}</div></div></section>`; return;
  }
  const reverse = direction === 'en-fr';
  const prompt = reverse ? card.en : card.fr;
  const answer = reverse ? card.fr : card.en;
  main.innerHTML = `${noticeHTML()}<section class="practice">${header}${dailyCounts(`${categoryTitle(deck)} · Today`)}<div class="study-surface ${revealed ? 'revealed' : ''}" id="flashcard" role="${revealed ? 'group' : 'button'}" tabindex="${revealed ? '-1' : '0'}" aria-label="${revealed ? 'Revealed flashcard. Left: didn’t know. Right: knew it.' : 'Reveal the translation'}" aria-busy="${busy}"><div class="word-content"><h1 class="main-word" lang="${(revealed ? reverse : !reverse) ? 'fr' : 'en'}">${esc(revealed ? answer : prompt)}</h1>${revealed ? `<p class="source-word" lang="${reverse ? 'en' : 'fr'}">${esc(prompt)}</p>${card.note ? `<p class="word-note">${esc(card.note)}</p>` : ''}` : ''}</div>${revealed ? `<button class="card-zone left" data-action="again" aria-label="Didn’t know this word" ${locked() ? 'disabled' : ''}><span aria-hidden="true">←</span></button><button class="card-zone right" data-action="known" aria-label="Knew this word" ${locked() ? 'disabled' : ''}><span aria-hidden="true">→</span></button>` : ''}</div><div class="study-tools"><button class="audio-mode ${audioMode ? 'on' : ''}" data-action="audio-mode" aria-pressed="${audioMode}" aria-label="French audio on reveal: ${audioMode ? 'on' : 'off'}" title="Play French on each reveal">${speaker}<span>Audio ${audioMode ? 'on' : 'off'}</span></button><button class="quiet" data-action="undo" ${!snapshot.undoId || locked() ? 'disabled' : ''}>Undo</button></div></section>`;
}
function renderBrowse() {
  main.innerHTML = `${noticeHTML()}<section class="topics browse"><div class="section-top">${back('Vocabulary', 'vocabulary')}<button class="icon" data-action="options" aria-label="Vocabulary options" ${!snapshot || busy ? 'disabled' : ''}>•••</button></div><h1>Your words</h1><p class="subtitle">${esc(directionLabel())}</p><div class="browse-tools"><label class="sr-only" for="vocab-search">Search French or English vocabulary</label><input type="search" id="vocab-search" placeholder="Find a word…" value="${esc(search)}" autocomplete="off"><label class="sr-only" for="browse-category">Category</label><select id="browse-category">${optionsHTML(browseCategory)}</select></div><div id="browse-results"></div></section>`;
  renderBrowseResults();
}
function normalized(value) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase(); }
function renderBrowseResults() {
  const container = document.querySelector('#browse-results'); if (!container) return;
  if (browseLoading) { container.innerHTML = '<div class="loading-state" role="status">Finding your words…</div>'; return; }
  if (browseError) { container.innerHTML = `<div class="notice" role="alert"><span>${esc(browseError)}</span><button class="quiet" data-action="retry-browse">Retry</button></div>`; return; }
  const query = normalized(search.trim());
  const filtered = (words || []).filter((word) => (browseCategory === 'all' || word.category === browseCategory) && (!query || normalized(`${word.fr} ${word.en}`).includes(query)));
  container.innerHTML = `<p class="browse-count" role="status">${filtered.length} ${filtered.length === 1 ? 'word' : 'words'}</p>${filtered.map((word) => `<article class="word-row"><div><h2 lang="fr">${esc(word.fr)}</h2><p>${esc(word.en)}</p><small>${esc(categoryTitle(word.category))}${word.due && word.status === 'scheduled' ? ` · Review ${esc(dateLabel(word.due))}` : ''}${word.note ? ` · ${esc(word.note)}` : ''}</small></div><div class="word-controls"><small>${esc(({ new: 'New', learning: 'Learning', due: 'Due', scheduled: 'Scheduled' })[word.status])}</small><button class="icon" data-play-word="${esc(word.id)}" aria-label="Pronounce ${esc(word.fr)}">${speaker}</button></div></article>`).join('') || '<p class="empty-list">No words match. Try another spelling or category.</p>'}`;
}
function renderTopics() {
  main.innerHTML = `${noticeHTML()}<section class="topics"><div class="section-top">${back('Home', 'home')}</div><h1>Grammar & sentences</h1><p class="subtitle">Pick something you want to practise.</p>${loading ? '<div class="loading-state" role="status">Opening the workshop…</div>' : `<div class="topic-list">${(topics || []).map((topic) => `<button class="topic-row" data-topic="${esc(topic.id)}" ${locked() ? 'disabled' : ''}><span class="topic-mark" aria-hidden="true">${esc(topic.mark)}</span><span class="copy"><h2>${esc(topic.title)}</h2><p>${esc(topic.description)}</p>${topic.hasActiveSession ? '<small>Continue your round</small>' : ''}</span><span class="arrow" aria-hidden="true">→</span></button>`).join('')}</div>`}</section>`;
}
function renderExercise() {
  if (!grammar || loading) { main.innerHTML = `${noticeHTML()}<section class="exercise"><div class="section-top">${back('Grammar', 'grammar')}</div><div class="loading-state" role="status">${loading ? 'Opening your round…' : 'Your round is saved on your Mac.'}</div></section>`; return; }
  const { topic, session } = grammar;
  if (session?.complete) { renderSummary(); return; }
  if (!session?.current) { main.innerHTML = `${noticeHTML()}<section class="summary"><div class="section-top">${back('Grammar', 'grammar')}</div><h1>${esc(topic.title)}</h1><p class="summary-line">${esc(topic.description)}</p><button class="primary dialog-action" data-action="new-round" ${locked() ? 'disabled' : ''}>Start a round</button></section>`; return; }
  const current = session.current; const exercise = current.exercise;
  const disabled = locked() || current.settled;
  const feedback = current.feedback;
  main.innerHTML = `${noticeHTML()}<section class="exercise"><div class="section-top">${back('Grammar', 'grammar')}<button class="quiet" data-action="rule" aria-haspopup="dialog" ${locked() ? 'disabled' : ''}>The rule</button></div><div class="exercise-head"><h1>${esc(topic.title)}</h1><span class="progress">${session.index + 1} / ${session.total}</span></div><p class="prompt-instruction">${esc(exercise.instruction)}</p><p class="prompt-sentence" lang="fr">${esc(exercise.source)}</p><div class="answer-area"><label class="answer-label" ${exercise.type === 'build' ? '' : 'for="answer"'}>${exercise.type === 'complete' ? 'Missing word' : 'Your answer'}</label>${exercise.type === 'build' ? `<div class="token-answer" role="group" aria-label="Your sentence">${tokenOrder.map((index) => `<button class="token" data-remove-token="${index}" aria-label="Remove ${esc(exercise.tokens[index])}" ${disabled ? 'disabled' : ''}>${esc(exercise.tokens[index])}</button>`).join('')}</div><div class="token-pool" role="group" aria-label="Available words">${exercise.tokens.map((text, index) => `<button class="token" data-token="${index}" ${disabled || tokenOrder.includes(index) ? 'disabled' : ''}>${esc(text)}</button>`).join('')}</div>` : `<textarea id="answer" lang="fr" autocomplete="off" autocapitalize="sentences" spellcheck="false" placeholder="${exercise.type === 'complete' ? 'Type the missing word…' : 'Write your sentence…'}" ${disabled ? 'readonly' : ''}>${esc(draft)}</textarea>`}</div>${feedback ? `<div class="feedback ${feedback.kind === 'incorrect' ? 'warn' : feedback.kind === 'alternative' || feedback.kind === 'shown' ? 'neutral' : ''}" role="status"><strong>${({ correct: current.assisted || current.attempts > 1 ? 'You’ve got it.' : 'That’s right.', incorrect: 'Not quite yet.', alternative: 'Valid French, different form.', shown: 'One correct answer' })[feedback.kind]}</strong>${feedback.kind === 'shown' && feedback.answer ? `<p class="model-answer" lang="fr">${esc(feedback.answer)}</p>` : ''}<p>${esc(feedback.message)}</p>${feedback.spelling && feedback.answer ? `<span class="minor">A spelling detail to review: <span lang="fr">${esc(feedback.answer)}</span></span>` : ''}${feedback.kind === 'shown' ? '<span class="minor">This example stays in your revisit set.</span>' : ''}${!current.settled ? `<button class="quiet" data-action="show-answer" ${locked() ? 'disabled' : ''}>Show one answer instead</button>` : ''}</div>` : ''}${current.hint && hintOpen && !current.settled ? `<div class="rule-hint"><p>${esc(current.hint)}</p><button class="quiet" data-action="show-answer" ${locked() ? 'disabled' : ''}>Show one answer</button></div>` : ''}<div class="exercise-actions">${current.settled ? '<span></span>' : `<button class="quiet accent" data-action="hint" ${locked() ? 'disabled' : ''}>${current.hint && hintOpen ? 'Hide hint' : 'A little help'}</button>`}<button class="primary" data-action="${current.settled ? 'next' : 'check'}" ${locked() ? 'disabled' : ''}>${busy ? 'Saving…' : current.settled ? session.index + 1 === session.total ? 'Finish round' : 'Next sentence' : 'Check answer'}</button></div>${current.assisted && !current.settled ? '<p class="assistance-note">Help used for this example.</p>' : ''}</section>`;
}
function renderSummary() {
  const { topic, session } = grammar;
  const results = session.results.map((result) => {
    const sentence = result.type === 'complete'
      ? result.source.replace(/_{2,}/, result.answer).replace(/(['’‘ʼ])\s+/g, '$1')
      : result.answer;
    return `<div class="result"><span lang="fr">${esc(sentence)}</span><small>${({ independent: 'On your own', helped: 'With help', revisit: 'To revisit' })[result.outcome]}</small></div>`;
  }).join('');
  main.innerHTML = `${noticeHTML()}<section class="summary"><div class="section-top">${back('Grammar', 'grammar')}</div><h1>A good place to pause.</h1><p class="summary-line">${esc(topic.title)}, practised in ${session.results.length} examples.</p><div class="results">${results}</div><div class="summary-actions"><button class="primary" data-action="new-round" ${locked() ? 'disabled' : ''}>Another round</button><button class="secondary" data-action="grammar" ${busy ? 'disabled' : ''}>Choose another topic</button></div></section>`;
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
async function loadGrammar(id = null, message = '', preserveDraft = false) {
  const token = ++generation; loading = true;
  if (!retryAction?.body) { notice = message ? { kind: 'info', message } : null; retryAction = null; }
  render();
  try {
    const result = await api(id ? `api/grammar/state?topic=${encodeURIComponent(id)}` : 'api/grammar');
    if (token !== generation) return false;
    if (id) applyGrammar(result, preserveDraft); else topics = result.topics;
    loading = false; render(); return true;
  } catch (error) {
    if (token !== generation) return false;
    loading = false;
    if (!retryAction?.body) { notice = { message: error.message }; retryAction = { type: 'grammar-state', topicId: id, message, preserveDraft }; }
    render(); return false;
  }
}
async function runMutation(action) {
  if (busy) return;
  stopAudio(); busy = true; loading = false; ++generation;
  notice = null; retryAction = null;
  screen = action.type.startsWith('grammar-') ? 'exercise' : 'practice'; rememberScreen(); render();
  const paths = { start: 'api/session', grade: 'api/grade', undo: 'api/undo', 'grammar-start': 'api/grammar/session', 'grammar-answer': 'api/grammar/answer', 'grammar-help': 'api/grammar/help', 'grammar-next': 'api/grammar/next' };
  try {
    const result = await api(paths[action.type], { method: 'POST', body: JSON.stringify(action.body) });
    if (action.type.startsWith('grammar-')) {
      applyGrammar(result, action.type === 'grammar-help');
      if (action.body.kind === 'hint') hintOpen = true;
    } else applySnapshot(result);
    busy = false; render();
    if (action.body.kind === 'rule') showRule();
    else if (action.type === 'grammar-answer' && !grammar.session.current?.settled) document.querySelector('#answer')?.focus({ preventScroll: true });
    else main.focus({ preventScroll: true });
    announce(action.type.startsWith('grammar-') ? grammar.session?.current?.feedback?.message || (grammar.session?.complete ? 'Round complete. Your progress is saved.' : 'Your round is saved.') : result.current ? `${action.type === 'undo' ? 'Last answer undone. ' : ''}${direction === 'en-fr' ? result.current.en : result.current.fr}` : 'Practice complete. Your progress is saved.');
  } catch (error) {
    busy = false;
    if (error.status === 409) {
      if (action.type.startsWith('grammar-')) await loadGrammar(action.topicId, `${error.message} Your round was refreshed. Review the current example before answering.`, true);
      else await fetchState(`${error.message} Your progress was refreshed. Reveal the current card again before answering.`);
    } else { notice = { message: error.message }; retryAction = action; render(); }
  }
}
function move(next) {
  if (busy) return false;
  stopAudio(); ++generation; ++browseGeneration; loading = false; revealed = false;
  screen = next; rememberScreen(); render(); window.scrollTo(0, 0); main.focus({ preventScroll: true });
  if (next === 'home') fetchState();
  return true;
}
async function startPractice() {
  if (busy) return;
  move('practice');
  if (locked()) return;
  if (!await fetchState()) return;
  if (screen === 'practice') runMutation({ type: 'start', body: { direction, deck } });
}
function reveal() {
  if (screen !== 'practice' || !snapshot?.current || revealed || locked() || loading) return;
  revealed = true; renderPractice(); document.querySelector('#flashcard')?.focus({ preventScroll: true });
  announce(`Answer: ${direction === 'en-fr' ? snapshot.current.fr : snapshot.current.en}.`);
  if (audioMode) playFrench(snapshot.current.audioUrl);
}
function grade(known) {
  if (!revealed || locked() || loading || screen !== 'practice' || !snapshot?.current) return;
  const card = snapshot.current;
  runMutation({ type: 'grade', body: { direction, deck, wordId: card.id, version: card.version, known, requestId: requestId() } });
}
function undo() { if (snapshot?.undoId && !locked()) runMutation({ type: 'undo', body: { direction, deck, undoId: snapshot.undoId } }); }
async function browseWords() {
  if (!move('browse')) return;
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
async function openTopic(id) {
  if (locked()) return;
  topicId = id; savePreference('echo.topic', id); grammar = null; hintOpen = true;
  move('exercise');
  if (await loadGrammar(id) && screen === 'exercise' && !grammar.session) startRound();
}
function startRound() {
  if (!locked() && topicId) runMutation({ type: 'grammar-start', topicId, body: { topicId, requestId: requestId() } });
}
function grammarMutation(type, extra = {}) {
  const session = grammar?.session; const current = session?.current;
  if (locked() || !current || session.complete) return;
  if (type === 'answer' && current.settled || type === 'next' && !current.settled) return;
  runMutation({ type: `grammar-${type}`, topicId, body: { sessionId: session.id, exerciseId: current.exercise.id, version: session.version, requestId: requestId(), ...extra } });
}
function checkAnswer() {
  const current = grammar?.session?.current; if (!current || current.settled) return;
  if (current.exercise.type === 'build' ? !tokenOrder.length : !draft.trim()) { announce('Write an answer first.'); document.querySelector('#answer')?.focus(); return; }
  grammarMutation('answer', { answer: draft, ...(current.exercise.type === 'build' ? { tokenOrder: [...tokenOrder] } : {}) });
}
function openDialog(title, body, kind) {
  stopAudio(); dialog.dataset.kind = kind;
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="icon" data-action="close-dialog" aria-label="Close">×</button></div>${body}`;
  if (!dialog.open) dialog.showModal();
}
function showRule() {
  const topic = grammar.topic;
  openDialog(topic.title, `<div class="dialog-copy"><p>${esc(topic.rule)}</p><div class="rule-example" lang="fr">${esc(topic.example)}</div><p>${esc(topic.aside)}</p></div><button class="primary dialog-action" data-action="close-dialog">Back to the sentence</button>`, 'rule');
}
function openOptions() {
  if (!snapshot) return;
  const disabled = locked() ? 'disabled' : '';
  openDialog('Vocabulary options', `<p class="settings-label">Direction</p><div class="segmented" role="group" aria-label="Practice direction"><button data-direction="fr-en" aria-pressed="${direction === 'fr-en'}" ${disabled}>French → English</button><button data-direction="en-fr" aria-pressed="${direction === 'en-fr'}" ${disabled}>English → French</button></div><div class="dialog-row"><label for="deck-select">Category</label><select id="deck-select" ${disabled}>${optionsHTML(deck)}</select></div><div class="dialog-row"><label for="audio-speed">Pronunciation speed</label><select id="audio-speed"><option value="1" ${speed === 1 ? 'selected' : ''}>Normal</option><option value="0.8" ${speed === 0.8 ? 'selected' : ''}>Slower</option></select></div><form id="goal-form" novalidate><div class="goal-row"><label for="daily-goal">New words / day<br><small>in each direction</small></label><input id="daily-goal" name="newPerDay" type="number" inputmode="numeric" min="0" max="${totalWords()}" step="1" value="${snapshot.settings.newPerDay}" aria-describedby="goal-help goal-feedback" ${disabled}><button class="secondary" type="submit" ${disabled}>Save</button></div><p id="goal-help" class="caption">Shared across categories. Resets at 04:00 on your Mac. Set 0 to pause new words; due reviews are not capped.</p><div id="goal-feedback" class="caption" role="status"></div></form><div class="options-links"><button class="quiet" data-action="about">How it works</button><a href="api/export" download="echo-progress.json">Download my progress ↓</a></div><button class="primary dialog-action" data-action="close-dialog">Back to practice</button>`, 'options');
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
  if (action.body) runMutation(action);
  else if (action.type === 'grammar-state') { if (move(action.topicId ? 'exercise' : 'grammar')) loadGrammar(action.topicId, action.message, action.preserveDraft); }
  else fetchState(action.message);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button'); if (button?.disabled) return;
  const action = button?.dataset.action;
  if (action === 'close-dialog') { if (!busy) dialog.close(); return; }
  if (action === 'audio-mode') { audioMode = !audioMode; savePreference('echo.audio-mode', audioMode ? 'on' : 'off'); if (!audioMode) stopAudio(); renderPractice(); return; }
  if (busy) return;
  if (button?.dataset.direction) {
    if (locked() || direction === button.dataset.direction) return;
    direction = button.dataset.direction; savePreference('echo.direction', direction); dialog.close(); startPractice(); return;
  }
  if (button?.dataset.playWord) { const word = words?.find((entry) => entry.id === button.dataset.playWord); if (word) playFrench(`audio/${encodeURIComponent(word.id)}.mp3`); return; }
  if (button?.dataset.topic) { openTopic(button.dataset.topic); return; }
  if (button?.dataset.token !== undefined || button?.dataset.removeToken !== undefined) {
    if (locked() || grammar?.session?.current?.settled) return;
    if (button.dataset.token !== undefined) tokenOrder.push(Number(button.dataset.token)); else tokenOrder = tokenOrder.filter((index) => index !== Number(button.dataset.removeToken));
    renderExercise();
    const nextToken = main.querySelector('[data-token]:not(:disabled)') || main.querySelector('[data-remove-token]:not(:disabled)');
    nextToken?.focus({ preventScroll: true });
    return;
  }
  if (action === 'home') move('home');
  else if (action === 'start') startPractice();
  else if (action === 'vocabulary') { if (move('practice')) fetchState(); }
  else if (action === 'grammar') { if (move('grammar')) loadGrammar(); }
  else if (action === 'browse') browseWords();
  else if (action === 'options') openOptions();
  else if (action === 'about') { dialog.close(); stopAudio(); aboutDialog.showModal(); }
  else if (action === 'again') grade(false);
  else if (action === 'known') grade(true);
  else if (action === 'undo') undo();
  else if (action === 'retry') retry();
  else if (action === 'retry-browse') loadBrowse();
  else if (action === 'new-round') startRound();
  else if (action === 'check') checkAnswer();
  else if (action === 'next') { hintOpen = true; grammarMutation('next'); }
  else if (action === 'rule') grammarMutation('help', { kind: 'rule' });
  else if (action === 'show-answer') grammarMutation('help', { kind: 'answer' });
  else if (action === 'hint') { if (grammar?.session?.current?.hint) { hintOpen = !hintOpen; renderExercise(); } else grammarMutation('help', { kind: 'hint' }); }
  else if (event.target.closest('#flashcard') && !event.target.closest('button,a,input,select')) reveal();
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'deck-select' && !locked()) { deck = event.target.value; browseCategory = deck; savePreference('echo.deck', deck); dialog.close(); startPractice(); }
  else if (event.target.id === 'browse-category') { browseCategory = event.target.value; renderBrowseResults(); }
  else if (event.target.id === 'audio-speed') { speed = event.target.value === '0.8' ? 0.8 : 1; savePreference('echo.speed', String(speed)); audio.playbackRate = speed; }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'vocab-search') { search = event.target.value; renderBrowseResults(); }
  if (event.target.id === 'answer') draft = event.target.value;
});
document.addEventListener('submit', (event) => { if (event.target.id === 'goal-form') saveGoal(event); });
document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.repeat || aboutDialog.open || dialog.open || busy || loading || locked()) return;
  if (screen === 'exercise' && (event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (grammar?.session?.current?.settled) grammarMutation('next'); else checkAnswer(); return; }
  if (event.ctrlKey || event.altKey || event.metaKey || screen !== 'practice' || !snapshot?.current || event.target.closest('input,select,textarea,[contenteditable="true"]')) return;
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
window.addEventListener('pagehide', stopAudio);
document.addEventListener('visibilitychange', () => { if (!document.hidden && screen === 'home' && !busy && !loading && !dialog.open) fetchState(); });
render();
if (screen === 'exercise' && topicId) loadGrammar(topicId);
else if (screen === 'grammar' || screen === 'exercise') { screen = 'grammar'; rememberScreen(); loadGrammar(); }
else if (screen === 'browse') browseWords();
else fetchState();
