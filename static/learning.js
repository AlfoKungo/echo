'use strict';

const main = document.querySelector('#learning-main');
const notice = document.querySelector('#learning-notice');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const requestId = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
const active = (job) => job && ['queued', 'loading', 'working', 'releasing'].includes(job.status);
const terminal = (job) => job && !active(job);
const storageKey = 'echo.learning.v1';
const recordSections = ['attempts', 'conversations', 'drafts', 'jobs', 'tutorPending', 'saved', 'exposures'];
const valueSections = ['speed', 'reviewPending'];
function restore() {
  const value = {};
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const name = localStorage.key(index);
      if (!name?.startsWith(`${storageKey}:`)) continue;
      try {
        const [section, key] = name.slice(storageKey.length + 1).split(':');
        const entry = JSON.parse(localStorage.getItem(name));
        if (recordSections.includes(section) && key !== undefined) (value[section] ||= {})[decodeURIComponent(key)] = entry;
        else if (valueSections.includes(section) && key === undefined) value[section] = entry;
      } catch {}
    }
  } catch {}
  return value;
}
const stored = restore();
const state = { attempts: stored.attempts || {}, conversations: stored.conversations || {}, drafts: stored.drafts || {}, jobs: stored.jobs || {}, tutorPending: stored.tutorPending || {}, reviewPending: stored.reviewPending || null, saved: stored.saved || {}, exposures: stored.exposures || {}, speed: stored.speed === 0.8 ? 0.8 : 1 };
let savedState = structuredClone(state);
let catalog = null;
let materials = [];
const imported = new Map();
let overview = null;
let route = parseRoute();
let busy = false;
let loading = false;
let retryAction = null;
let navigation = 0;
let audioGeneration = 0;
let audioURL = '';
let phraseIndex = null;
let translationOpen = false;
let modelOpen = false;
let reviewRevealed = false;
let reviewRequest = state.reviewPending;
let tutorStatus = null;
let tutorStatusError = '';
let submittingTutor = false;
let leaving = false;
let polling = false;
const jobs = new Map();
const stoppingJobs = new Set();
const stoppedRequests = new Set();
const ownedRequests = (() => {
  try { return new Set(JSON.parse(sessionStorage.getItem('echo.learning.owned-requests') || '[]')); } catch { return new Set(); }
})();
function saveOwnedRequests() {
  try { sessionStorage.setItem('echo.learning.owned-requests', JSON.stringify([...ownedRequests])); } catch {}
}
const audio = new Audio();
audio.preload = 'none';

function save() {
  try {
    const persist = (name, value, previous) => {
      const serialized = JSON.stringify(value);
      if (serialized === JSON.stringify(previous)) return;
      if (serialized === undefined) localStorage.removeItem(name);
      else localStorage.setItem(name, serialized);
    };
    for (const section of recordSections) {
      for (const key of new Set([...Object.keys(savedState[section]), ...Object.keys(state[section])])) {
        persist(`${storageKey}:${section}:${encodeURIComponent(key)}`, state[section][key], savedState[section][key]);
      }
    }
    for (const key of valueSections) persist(`${storageKey}:${key}`, state[key], savedState[key]);
    savedState = structuredClone(state);
  } catch { showNotice('This browser could not save your place or unsent draft. Keep a copy of your text; checked practice still saves on your Mac.'); }
}
function announce(text) { document.querySelector('#learning-announcer').textContent = text; }
function showNotice(text, retry = null) {
  retryAction = retry;
  notice.hidden = !text;
  notice.innerHTML = text ? `<span>${esc(text)}</span>${retry ? '<button class="quiet" data-action="retry-request">Retry</button>' : ''}` : '';
}
function parseRoute() {
  const [section, query = ''] = location.hash.slice(1).split('?');
  const params = new URLSearchParams(query);
  return { section: ['listening', 'reading', 'conversations', 'review'].includes(section) ? section : 'listening', lesson: params.get('lesson'), mode: params.get('mode') || 'meaning', index: Math.max(0, Number.parseInt(params.get('index') || '0', 10) || 0), due: params.get('due') };
}
function href(section, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null));
  return `learn/#${section}${query.size ? `?${query}` : ''}`;
}
async function api(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(`api/learning/${path}`, { method: body ? 'POST' : 'GET', headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: controller.signal });
    let data;
    try { data = await response.json(); } catch { throw new Error('Echo returned an unreadable response. Please retry.'); }
    if (!response.ok) throw new Error(data.error || `Echo could not finish this request (${response.status}). Please retry.`);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The request timed out. Retry to safely finish the same action. Your text is preserved.');
    if (error instanceof TypeError) throw new Error('Cannot reach your Mac. Check that Echo is running and your connection is available, then retry.');
    throw error;
  } finally { clearTimeout(timer); }
}
function title(heading, copy) { return `<header class="learning-title"><h1>${esc(heading)}</h1><p>${esc(copy)}</p></header>`; }
function back(section, label) { return `<a class="learning-back" href="${href(section)}">← ${esc(label)}</a>`; }
function button(action, text, primary = false, extra = '') { return `<button type="button" class="${primary ? 'primary' : 'secondary'}" data-action="${action}" ${busy ? 'disabled' : ''} ${extra}>${text}</button>`; }
function lessonCards(entries, section, description) {
  return `<div class="lesson-grid">${entries.map((lesson) => `<a class="lesson-link" href="${href(section, { lesson: lesson.id })}"><small>${esc(lesson.kind || 'Scenario')}</small><h2>${esc(lesson.title)}</h2>${description ? `<p>${esc(lesson[description])}</p>` : ''}</a>`).join('')}</div>`;
}
function getAttempt(kind, itemId, mode, index = 0) {
  const key = `${kind}:${itemId}:${mode}:${index}`;
  if (!state.attempts[key]) state.attempts[key] = { requestId: requestId(), answer: '', assisted: false, transcript: false, translation: false, feedback: null };
  if (state.exposures[`${kind}:${itemId}`] && !state.attempts[key].feedback && !state.attempts[key].pending) state.attempts[key].assisted = true;
  return { key, value: state.attempts[key] };
}
function markSourceExposure() {
  const kind = route.section === 'listening' ? 'listening' : route.section === 'reading' ? 'material' : null;
  if (!kind || !route.lesson) return;
  const key = `${kind}:${route.lesson}`;
  if (!state.exposures[key]) { state.exposures[key] = true; save(); }
}
function currentReading() { return catalog?.reading.find((item) => item.id === route.lesson) || imported.get(route.lesson); }
function currentAttempt() {
  if (route.section === 'listening' && route.lesson) return getAttempt('listening', route.lesson, ['meaning', 'gap', 'dictation'].includes(route.mode) ? route.mode : 'meaning');
  if (route.section === 'conversations' && route.lesson) return getAttempt('conversation', route.lesson, 'reply', conversationPosition(route.lesson).index);
  if (route.section === 'reading' && route.mode === 'practice' && currentReading()?.practice?.[route.index]) return getAttempt('material', route.lesson, 'practice', route.index);
  return null;
}
function feedbackHTML(feedback) {
  if (!feedback) return '';
  const labels = { correct: 'That works.', incorrect: 'Something to revisit.', spelling: 'Close — check the written form.' };
  const outcomes = { independent: 'Independent prepared practice', helped: 'With help / recent rehearsal', revisit: 'Marked to revisit' };
  return `<div class="learning-feedback ${esc(feedback.kind)}" role="status"><h3>${labels[feedback.kind] || 'Your result'}</h3><p class="answer" lang="fr">${esc(feedback.answer)}</p><p>${esc(feedback.explanation)}</p><p class="learning-note">${outcomes[feedback.outcome] || esc(feedback.outcome)} · Saved on your Mac.</p></div>`;
}
function choiceHTML(choices, attempt) {
  return `<div class="learning-choices" role="group" aria-label="Choose a response">${choices.map((choice, index) => `<button class="learning-choice" type="button" data-choice="${index}" aria-pressed="${attempt.answer === choice}" ${busy || attempt.feedback || attempt.pending ? 'disabled' : ''}><span class="choice-number">${index + 1}</span><span>${esc(choice)}</span></button>`).join('')}</div>`;
}
function audioHTML(audioId) {
  return `<div class="audio-controls">${button('play-audio', 'Play / replay', false, `data-audio-id="${esc(audioId)}"`)}<button type="button" class="quiet" data-action="stop-audio">Stop audio</button><label>Speed <select id="learning-speed"><option value="1" ${state.speed === 1 ? 'selected' : ''}>Normal</option><option value="0.8" ${state.speed === 0.8 ? 'selected' : ''}>Slower</option></select></label></div>`;
}
function attemptActions(attempt, extra = '') {
  return `${feedbackHTML(attempt.feedback)}<div class="learning-actions">${attempt.feedback ? button('retry-attempt', 'Try again') : button('check-attempt', attempt.pending ? 'Retry check' : 'Check answer', true)}${extra}</div><p class="learning-note">${attempt.assisted ? 'Help has been used in this attempt. A correct answer will be recorded with help / recent rehearsal, not independent.' : 'A fresh, unaided answer can be independent. Immediate retries and early repeats are recent rehearsal, not independent recall.'}</p>`;
}
function renderListening() {
  if (!route.lesson) return `${title('Listening', 'Listen first. Work out the meaning, catch the missing word, or write what you hear.')}${lessonCards(catalog.listening, 'listening', 'description')}`;
  const lesson = catalog.listening.find((entry) => entry.id === route.lesson);
  if (!lesson) return missing('listening');
  const mode = ['meaning', 'gap', 'dictation'].includes(route.mode) ? route.mode : 'meaning';
  const attempt = getAttempt('listening', lesson.id, mode).value;
  return `${back('listening', 'All listening')}${title(lesson.title, lesson.description)}<nav class="learning-modes" aria-label="Listening practice type">${[['meaning', 'Understand'], ['gap', 'Missing word'], ['dictation', 'Dictation']].map(([id, label]) => `<a href="${href('listening', { lesson: lesson.id, mode: id })}" aria-current="${mode === id}">${label}</a>`).join('')}</nav><section class="learning-panel">${audioHTML(lesson.audioId)}<div class="learning-actions">${button('reveal-transcript', attempt.transcript ? 'Hide transcript' : 'Reveal transcript', false, `aria-expanded="${attempt.transcript}"`)}${button('reveal-translation', attempt.translation ? 'Hide translation' : 'Reveal translation', false, `aria-expanded="${attempt.translation}"`)}</div>${attempt.transcript ? `<p class="learning-text" lang="fr">${esc(lesson.fr)}</p>` : ''}${attempt.translation ? `<p class="learning-translation">${esc(lesson.en)}</p>` : ''}</section><section class="learning-panel"><p class="learning-question">${esc(mode === 'meaning' ? lesson.meaning.question : mode === 'gap' ? lesson.gap.prompt : 'Write the French you hear. Replay as often as you need.')}</p>${mode === 'meaning' ? choiceHTML(lesson.meaning.choices, attempt) : `<label class="learning-label" for="attempt-answer">${mode === 'gap' ? 'Missing French word or phrase' : 'Your dictation'}</label>${mode === 'gap' ? `<input class="learning-input" id="attempt-answer" lang="fr" autocomplete="off" value="${esc(attempt.answer)}" ${busy || attempt.feedback || attempt.pending ? 'disabled' : ''}>` : `<textarea id="attempt-answer" lang="fr" spellcheck="false" ${busy || attempt.feedback || attempt.pending ? 'disabled' : ''}>${esc(attempt.answer)}</textarea>`}`}${attemptActions(attempt)}</section>`;
}
function annotatedText(lesson) {
  const matches = [];
  lesson.annotations.forEach((annotation, index) => {
    if (!annotation.phrase) return;
    let start = 0;
    while ((start = lesson.fr.indexOf(annotation.phrase, start)) !== -1) { matches.push({ start, end: start + annotation.phrase.length, index }); start += annotation.phrase.length; }
  });
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  let cursor = 0;
  let html = '';
  for (const match of matches) {
    if (match.start < cursor) continue;
    html += esc(lesson.fr.slice(cursor, match.start));
    html += `<button class="phrase-token" data-phrase="${match.index}" aria-expanded="${phraseIndex === match.index}">${esc(lesson.fr.slice(match.start, match.end))}</button>`;
    cursor = match.end;
  }
  return html + esc(lesson.fr.slice(cursor));
}
function phraseDetail(lesson) {
  if (phraseIndex === null || !lesson.annotations[phraseIndex]) return '';
  const phrase = lesson.annotations[phraseIndex];
  const saved = state.saved[`${lesson.id}:${phrase.phrase}`];
  return `<aside class="phrase-detail" aria-label="Phrase explanation"><h3 lang="fr">${esc(phrase.phrase)}</h3><p>${esc(phrase.translation)}</p><p>${esc(phrase.explanation)}</p><div class="learning-actions">${saved ? '<span class="save-state" role="status">Saved to Review</span>' : button('save-phrase', 'Save to Review')}${button('close-phrase', 'Close')}</div></aside>`;
}
const draftKey = (kind, source) => `${kind}:${source}`;
function draftFor(kind, source) {
  const key = draftKey(kind, source);
  if (Object.hasOwn(state.drafts, key)) return state.drafts[key];
  try {
    const persisted = JSON.parse(localStorage.getItem(`${storageKey}:drafts:${encodeURIComponent(key)}`));
    if (typeof persisted === 'string') return persisted;
  } catch {}
  // Recovered submission text is a display fallback, never an automatic draft write.
  return displayedJob(kind, source)?.input.text || '';
}
function jobKey(kind, source) { return `${kind}:${source}`; }
function displayedJob(kind, source) { return jobs.get(state.jobs[jobKey(kind, source)]); }
function feedbackGroup(label, entries, empty) {
  return `<section class="feedback-group"><h3>${label}</h3>${entries.length ? `<ol>${entries.map((entry) => `<li><del lang="fr">${esc(entry.original)}</del> → <ins lang="fr">${esc(entry.replacement)}</ins><p>${esc(entry.explanation)}</p></li>`).join('')}</ol>` : `<p class="learning-note">${empty}</p>`}</section>`;
}
function jobHTML(job) {
  if (!job) return '';
  const label = { queued: 'Queued — waiting for the local tutor', loading: 'Starting the local model', working: 'Local tutor is working', releasing: 'Releasing the local model', complete: 'Local tutor finished', cancelled: 'Stopped — your text is preserved', error: 'Could not finish — your text is preserved' }[job.status];
  let result = '';
  if (job.status === 'complete' && job.result?.kind === 'writing') {
    const feedback = job.result.feedback;
    result = `<p class="tutor-advice">Local-model advice, not a certified grade. It can be wrong. This feedback does not count as mastery.</p><p>${esc(feedback.summary)}</p><h3>Suggested corrected text</h3><p class="learning-text" lang="fr">${esc(feedback.corrected)}</p>${feedbackGroup('Actual errors', feedback.errors, 'The tutor reported no actual errors; this is not a guarantee of correctness.')}${feedbackGroup('Optional style', feedback.suggestions, 'No optional style changes suggested.')}`;
  } else if (job.status === 'complete' && job.result?.kind === 'material') {
    result = `<div class="learning-actions"><a class="primary" href="${href('reading', { lesson: job.result.material.id })}">Open saved material →</a></div><p class="tutor-advice">The translation and annotations are local-model advice. Check anything that seems uncertain.</p>`;
  }
  return `<div class="tutor-job"><h3>${esc(label)}</h3><p>${esc(job.progress)}</p>${job.error ? `<p role="alert">${esc(job.error)}</p>` : ''}${active(job) ? `<div class="learning-actions"><button type="button" class="secondary" data-action="stop-tutor" data-job="${esc(job.id)}" ${stoppingJobs.has(job.id) ? 'disabled' : ''}>${stoppingJobs.has(job.id) ? 'Stopping…' : 'Stop local tutor'}</button></div>` : ''}<details class="submitted" data-submission="${esc(job.input.requestId)}"><summary>Submitted text — preserved on your Mac</summary><p lang="fr">${esc(job.input.text)}</p></details>${result}</div>`;
}
function tutorSlotHTML(kind, source) {
  const pending = state.tutorPending[jobKey(kind, source)];
  return `${pending ? `<div class="tutor-job"><h3>${submittingTutor ? 'Submitting your request…' : 'Submission not yet confirmed'}</h3><p>${submittingTutor ? 'Saving the text and requesting the local tutor.' : 'Use the check button to safely retry this same submission. Your current draft remains separate if you have edited it.'}</p><div class="learning-actions"><button type="button" class="secondary" data-action="stop-pending" data-request="${esc(pending.requestId)}" ${stoppingJobs.has(pending.requestId) ? 'disabled' : ''}>${stoppingJobs.has(pending.requestId) ? 'Stopping…' : 'Stop this request'}</button></div><details data-submission="${esc(pending.requestId)}"><summary>Text in this submission</summary><p lang="fr">${esc(pending.text)}</p></details></div>` : ''}${jobHTML(displayedJob(kind, source))}`;
}
function writingHTML(lesson) {
  const job = displayedJob('writing', lesson.id);
  return `<section class="reading-section"><h2>Write in French</h2><div class="learning-panel"><p class="learning-question">${esc(lesson.writingPrompt)}</p><label class="learning-label" for="writing-draft">Your response</label><textarea id="writing-draft" data-draft="writing" data-source="${esc(lesson.id)}" lang="fr" ${busy || active(job) ? 'disabled' : ''}>${esc(draftFor('writing', lesson.id))}</textarea><div class="learning-actions">${button('submit-writing', state.tutorPending[jobKey('writing', lesson.id)] ? 'Retry tutor submission' : terminal(job) ? 'Check another attempt with local tutor' : 'Check with local tutor', true, active(job) ? 'disabled' : '')}${lesson.modelAnswer ? button('model-answer', modelOpen ? 'Hide model answer' : 'Show optional model answer', false, `aria-expanded="${modelOpen}"`) : ''}</div>${modelOpen ? `<p class="learning-text" lang="fr">${esc(lesson.modelAnswer)}</p><p class="learning-note">One possible response, not the only correct answer.</p>` : ''}<p class="learning-note">Only this button starts the local tutor. Your submitted text is saved before checking. Leaving the learning page stops its active request.</p><div data-job-slot="writing">${tutorSlotHTML('writing', lesson.id)}</div></div></section>`;
}
function practiceHTML(lesson) {
  if (!lesson.practice?.length) return '';
  const index = Math.min(route.index, lesson.practice.length - 1);
  const exercise = lesson.practice[index];
  const attempt = getAttempt('material', lesson.id, 'practice', index).value;
  return `<section class="reading-section"><h2>Practise your material</h2><div class="learning-panel"><p class="learning-note">Prepared cloze ${index + 1} of ${lesson.practice.length}. This uses the saved explanation, not a running model.</p><p class="learning-question" lang="fr">${esc(exercise.prompt)}</p><label class="learning-label" for="attempt-answer">Missing French word or phrase</label><input class="learning-input" id="attempt-answer" lang="fr" autocomplete="off" value="${esc(attempt.answer)}" ${busy || attempt.feedback || attempt.pending ? 'disabled' : ''}>${attemptActions(attempt, lesson.practice.length > 1 ? `<a class="secondary" href="${href('reading', { lesson: lesson.id, mode: 'practice', index: (index + 1) % lesson.practice.length })}">Next cloze →</a>` : '')}<p class="learning-note">The source text is available above. Reading it or its annotations counts as help for this cloze.</p></div></section>`;
}
function ownMaterialHTML() {
  const job = displayedJob('material', 'own-material');
  return `${back('reading', 'All reading & writing')}${title('Bring your own French', 'Paste an article, a message, or a phrase. Ask the local tutor to explain it, then keep it here for reading and review.')}<section class="learning-panel"><label class="learning-label" for="material-title">Title (optional)</label><input class="learning-input" id="material-title" data-draft="title" data-source="own-material" value="${esc(draftFor('title', 'own-material'))}" ${busy || active(job) ? 'disabled' : ''}><label class="learning-label reading-section" for="material-draft">Your French text</label><textarea id="material-draft" data-draft="material" data-source="own-material" lang="fr" ${busy || active(job) ? 'disabled' : ''}>${esc(draftFor('material', 'own-material'))}</textarea><div class="learning-actions">${button('submit-material', state.tutorPending[jobKey('material', 'own-material')] ? 'Retry tutor submission' : terminal(job) ? 'Explain again with local tutor' : 'Explain with local tutor', true, active(job) ? 'disabled' : '')}</div><p class="learning-note">This explicit request starts the local model. The result is saved as your reading material, with translation, phrase explanations and cloze practice. It is advice, not a certified translation.</p><div data-job-slot="material">${tutorSlotHTML('material', 'own-material')}</div></section>`;
}
function renderReading() {
  if (route.lesson === 'own-material') return ownMaterialHTML();
  if (!route.lesson) return `${title('Reading & writing', 'Read something useful, explore its phrases, then put your own French into words.')}${lessonCards(catalog.reading, 'reading')}<section class="reading-section"><h2>Your own material</h2><p class="learning-note">Saved explanations stay available without starting the tutor.</p><div class="learning-actions"><a class="secondary" href="${href('reading', { lesson: 'own-material' })}">Paste French to explain →</a></div>${materials.length ? `<div class="lesson-grid reading-section">${materials.map((item) => `<a class="lesson-link" href="${href('reading', { lesson: item.id })}"><small>Imported</small><h2>${esc(item.title)}</h2></a>`).join('')}</div>` : '<p class="learning-note">No imported reading yet.</p>'}</section>`;
  const lesson = currentReading();
  if (!lesson) return missing('reading');
  const practicing = route.mode === 'practice' && !!lesson.practice?.length;
  const attempt = practicing ? getAttempt('material', lesson.id, 'practice', Math.min(route.index, lesson.practice.length - 1)).value : null;
  const sourceOpen = !practicing || attempt.transcript;
  if (sourceOpen) markSourceExposure();
  return `${back('reading', 'All reading & writing')}${title(lesson.title, lesson.kind === 'imported' ? 'Your saved French, explained by the local tutor.' : 'Tap an underlined phrase to explore it and save it for later review.')}${lesson.practice?.length ? `<nav class="learning-modes" aria-label="Reading activity"><a href="${href('reading', { lesson: lesson.id })}" aria-current="${!practicing}">Read & write</a><a href="${href('reading', { lesson: lesson.id, mode: 'practice' })}" aria-current="${practicing}">Practise phrases</a></nav>` : ''}<section class="learning-panel">${practicing ? button('reveal-source', sourceOpen ? 'Hide source text' : 'Reveal source text (help)', false, `aria-expanded="${sourceOpen}"`) : ''}${sourceOpen ? `<div class="learning-text" lang="fr">${annotatedText(lesson)}</div>${phraseDetail(lesson)}` : '<p class="learning-note">The source starts hidden so you can try the cloze independently.</p>'}<div class="learning-actions">${button('reading-translation', translationOpen ? 'Hide translation' : 'Reveal translation', false, `aria-expanded="${translationOpen}"`)}</div>${translationOpen ? `<p class="learning-translation">${esc(lesson.en)}</p>${lesson.explanation ? `<p class="learning-note">${esc(lesson.explanation)}</p>` : ''}` : ''}</section>${practicing ? practiceHTML(lesson) : writingHTML(lesson)}`;
}
function conversationPosition(id) {
  if (!state.conversations[id]) state.conversations[id] = { index: 0, complete: false };
  return state.conversations[id];
}
function renderConversations() {
  if (!route.lesson) return `${title('Conversations', 'Four everyday situations. Listen, choose the response that fits your task, and see why it works.')}${lessonCards(catalog.conversations, 'conversations', 'goal')}<p class="learning-note">Prepared response choices practise understanding and appropriateness, not measured spoken fluency.</p>`;
  const lesson = catalog.conversations.find((entry) => entry.id === route.lesson);
  if (!lesson) return missing('conversations');
  const position = conversationPosition(lesson.id);
  if (position.complete) {
    return `${back('conversations', 'All conversations')}${title(lesson.title, 'Your exchange, turn by turn.')}<p class="learning-note">Prepared response practice. This is not a speaking score.</p><ol class="conversation-recap">${lesson.turns.map((turn, index) => {
      const attempt = getAttempt('conversation', lesson.id, 'reply', index).value;
      return `<li><small>Turn ${index + 1} · ${esc(turn.speaker)}</small><p lang="fr">${esc(turn.fr)}</p><p>${esc(turn.prompt)}</p><p lang="fr">Your response: ${esc(attempt.answer || 'Not answered')}</p>${feedbackHTML(attempt.feedback)}</li>`;
    }).join('')}</ol><div class="learning-actions">${button('restart-conversation', 'Try the conversation again', true)}<a class="secondary" href="${href('review')}">Review & progress</a></div>`;
  }
  const index = Math.min(position.index, lesson.turns.length - 1);
  const turn = lesson.turns[index];
  const attempt = getAttempt('conversation', lesson.id, 'reply', index).value;
  return `${back('conversations', 'All conversations')}${title(lesson.title, lesson.goal)}<section class="learning-panel"><p class="conversation-progress">Turn ${index + 1} of ${lesson.turns.length} · ${esc(turn.speaker)}</p>${audioHTML(turn.audioId)}<p class="learning-text" lang="fr">${esc(turn.fr)}</p><div class="learning-actions">${button('reveal-translation', attempt.translation ? 'Hide translation' : 'Reveal translation', false, `aria-expanded="${attempt.translation}"`)}</div>${attempt.translation ? `<p class="learning-translation">${esc(turn.en)}</p>` : ''}</section><section class="learning-panel"><p class="learning-question">${esc(turn.prompt)}</p>${choiceHTML(turn.choices, attempt)}${attemptActions(attempt, attempt.feedback ? button('next-turn', index + 1 === lesson.turns.length ? 'See recap' : 'Next turn →', true) : '')}</section>`;
}
function reviewHref(item) {
  const section = item.kind === 'conversation' ? 'conversations' : item.kind === 'material' ? 'reading' : 'listening';
  return href(section, { lesson: item.itemId, mode: item.mode, index: item.exerciseIndex, due: item.id });
}
function evidenceHTML(entries, good) {
  return entries.length ? `<ol class="evidence-list">${entries.map((entry) => `<li>${esc(entry.title)}<small>${esc(skillLabel(entry.skill))} · ${good ? entry.successes : entry.misses} ${good ? 'successful' : 'to revisit'} / ${entry.attempts} attempts · ${esc(entry.source)}</small></li>`).join('')}</ol>` : `<p class="learning-note">${good ? 'No consistent strengths to report yet. More practice will give useful examples.' : 'No recurring difficulties recorded yet. This is not proof of mastery.'}</p>`;
}
function skillLabel(skill) { return { recognition: 'Recognition', listening: 'Listening', production: 'Written production' }[skill] || skill; }
function renderReview() {
  if (!overview) return '<div class="loading-state" role="status">Loading your saved practice…</div>';
  const phrases = overview.due.filter((item) => item.kind === 'phrase');
  const activities = overview.due.filter((item) => item.kind !== 'phrase');
  const card = phrases[0];
  const cardHTML = card ? `<section class="learning-panel review-card"><p class="learning-note">${phrases.length} saved-phrase ${phrases.length === 1 ? 'card' : 'cards'} due · ${card.mode === 'en-fr' ? 'English → French' : 'French → English'} · self-rated</p><p class="learning-text" lang="${card.mode === 'en-fr' ? 'en' : 'fr'}">${esc(card.mode === 'en-fr' ? card.en : card.fr)}</p>${reviewRevealed ? `<p class="learning-text" lang="${card.mode === 'en-fr' ? 'fr' : 'en'}">${esc(card.mode === 'en-fr' ? card.fr : card.en)}</p><p class="learning-note">${esc(card.explanation)}</p><div class="learning-actions">${button('review-again', 'Again')}${button('review-known', 'Knew it', true)}</div><p class="learning-note">Your own recall judgment, not an independently checked result.</p>` : `<div class="learning-actions">${button('review-reveal', 'Reveal answer', true)}</div><p class="learning-note">Recall first. Space reveals; ← Again and → Knew it after reveal.</p>`}</section>` : '<p class="empty-progress">No saved phrases due. Tap a phrase while reading to add it to Review.</p>';
  return `${title('Review & progress', 'A useful next step, and an honest picture of the practice you have done.')}
    <section class="review-section"><h2>Saved phrases</h2>${cardHTML}</section>
    <section class="review-section"><h2>Activities to revisit</h2>
      ${activities.length ? `<div class="review-list">${activities.map((item) => `<a class="review-link" href="${reviewHref(item)}"><span>${esc(item.title)}<small>${esc(skillLabel(item.skill))} · prepared · ${esc(item.mode)}${item.exerciseIndex !== undefined ? ` · part ${item.exerciseIndex + 1}` : ''}</small></span><span aria-hidden="true">→</span></a>`).join('')}</div>` : '<p class="learning-note">No learning-room activities due right now. Try a prepared lesson to start building a practice history.</p>'}
      <div class="learning-actions"><a class="secondary" href="learn/#listening">Practise listening</a><a class="secondary" href="learn/#conversations">Try a conversation</a><a class="secondary" href="learn/#reading">Read & write</a></div>
    </section>
    <section class="review-section"><h2>Your practice by skill</h2>
      <p class="learning-note">Attempt counts, not a fluency percentage. Totals include prepared answers and self-rated phrase recall. Repeats are included; "with help / recent rehearsal" includes early repeats and attempts after a miss. Local-tutor advice never adds mastery. Due counts here cover learning-room activities and saved phrases only; vocabulary is listed separately below.</p>
      ${overview.skills.map((skill) => `<div class="skill-summary"><h3>${esc(skillLabel(skill.id))}</h3>${skill.attempts ? `<p><span class="learning-count">${skill.attempts}</span> attempts · ${skill.independent} independent · ${skill.helped} with help / recent rehearsal · ${skill.revisit} to revisit · ${skill.due} learning-room items due</p>` : '<p>No recorded attempts yet.</p>'}</div>`).join('')}
    </section>
    <section class="review-section"><h2>Going well</h2>${evidenceHTML(overview.goingWell, true)}</section>
    <section class="review-section"><h2>Needs practice</h2>${evidenceHTML(overview.needsPractice, false)}</section>
    <section class="review-section"><h2>Vocabulary</h2>
      ${overview.vocabulary.length ? overview.vocabulary.map((entry) => `<a class="review-link" data-home="practice" data-direction="${esc(entry.direction)}" href="./"><span>${entry.direction === 'fr-en' ? 'French → English' : 'English → French'}<small>${entry.unseenActive} unseen · ${entry.seenActive} seen and unfinished · self-rated recall</small></span><span aria-hidden="true">→</span></a>`).join('') : '<a href="./" data-home="practice">Open vocabulary practice →</a>'}
    </section>
    <section class="review-section"><h2>Grammar & sentences</h2>
      ${overview.grammar.length ? overview.grammar.map((entry) => `<div class="grammar-summary"><strong>${esc(entry.title)}</strong><p>${entry.independent} independent · ${entry.helped} helped · ${entry.revisit} to revisit · prepared</p></div>`).join('') : '<p class="learning-note">No grammar rounds recorded yet.</p>'}
      <div class="learning-actions"><a class="secondary" href="./" data-home="grammar">Open grammar practice →</a></div>
    </section>`;
}
function missing(section) { return `${title('That lesson is not available', 'It may have moved, or this link may be incomplete.')}${back(section, 'Choose another lesson')}`; }
function render() {
  document.querySelectorAll('[data-section]').forEach((link) => { if (link.dataset.section === route.section) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  if (loading || !catalog) main.innerHTML = '<div class="loading-state" role="status">Loading your saved practice…</div>';
  else main.innerHTML = ({ listening: renderListening, reading: renderReading, conversations: renderConversations, review: renderReview })[route.section]();
}

async function loadPage() {
  const token = ++navigation;
  loading = true; render(); showNotice('');
  try {
    if (!catalog) catalog = await api('catalog');
    if (route.section === 'reading') {
      materials = (await api('materials')).materials.filter(item => item.kind === 'imported');
      if (route.lesson && route.lesson !== 'own-material' && !catalog.reading.some((item) => item.id === route.lesson) && !imported.has(route.lesson)) imported.set(route.lesson, await api(`materials/${encodeURIComponent(route.lesson)}`));
      if (route.lesson) {
        const kind = route.lesson === 'own-material' ? 'material' : 'writing';
        const source = route.lesson;
        const result = await api(`tutor/last?sourceId=${encodeURIComponent(source)}&kind=${kind}`);
        if (result.job && token === navigation) adoptJob(result.job);
      }
    }
    if (route.section === 'review') { overview = await api('progress'); reviewRevealed = false; reviewRequest = state.reviewPending; }
    if (token !== navigation) return;
    const reading = route.section === 'reading' ? currentReading() : null;
    if (reading?.practice?.length) route.index = Math.min(route.index, reading.practice.length - 1);
    if (route.due) {
      const kind = route.section === 'listening' ? 'listening' : route.section === 'reading' ? 'material' : null;
      if (kind) delete state.exposures[`${kind}:${route.lesson}`];
      if (route.section === 'conversations' && catalog.conversations.some((item) => item.id === route.lesson)) {
        const position = conversationPosition(route.lesson); position.index = Math.min(route.index, catalog.conversations.find((item) => item.id === route.lesson).turns.length - 1); position.complete = false;
      }
      const attempt = currentAttempt();
      if (attempt?.value.feedback) state.attempts[attempt.key] = { requestId: requestId(), answer: '', assisted: false, transcript: false, translation: false, feedback: null };
      route.due = null;
      history.replaceState(null, '', href(route.section, { lesson: route.lesson, mode: route.mode, index: route.index }));
      save();
    }
    loading = false; render();
    if (route.section === 'review' && reviewRequest) showNotice('A previous recall update has not been confirmed. Retry safely to finish that same rating.', finishReview);
  } catch (error) {
    if (token !== navigation) return;
    loading = false;
    main.innerHTML = '<p class="empty-progress">Your saved work is still on your Mac. Retry to open this room.</p>';
    showNotice(error.message, loadPage);
  }
}
async function mutation(work) {
  if (busy) return;
  busy = true; showNotice(''); render();
  try { await work(); }
  catch (error) { showNotice(error.message, () => mutation(work)); }
  finally { busy = false; if (route.section === 'review' && !overview && !loading) loadPage(); else render(); }
}
function selectedChoices() {
  if (route.section === 'listening') return catalog.listening.find((entry) => entry.id === route.lesson)?.meaning.choices;
  if (route.section === 'conversations') return catalog.conversations.find((entry) => entry.id === route.lesson)?.turns[conversationPosition(route.lesson).index]?.choices;
  return null;
}
function checkAttempt() {
  const current = currentAttempt();
  if (!current || current.value.feedback || busy) return;
  const attempt = current.value;
  if (!attempt.answer.trim()) { showNotice('Choose or write an answer before checking.'); document.querySelector('#attempt-answer')?.focus(); return; }
  if (!attempt.pending) {
    attempt.pending = { requestId: attempt.requestId, kind: route.section === 'conversations' ? 'conversation' : route.section === 'reading' ? 'material' : 'listening', itemId: route.lesson, mode: route.section === 'conversations' ? 'reply' : route.section === 'reading' ? 'practice' : ['gap', 'dictation'].includes(route.mode) ? route.mode : 'meaning', answer: attempt.answer, exerciseIndex: route.section === 'conversations' ? conversationPosition(route.lesson).index : route.section === 'reading' ? route.index : undefined, assisted: attempt.assisted };
    save();
  }
  mutation(async () => {
    attempt.feedback = await api('attempt', attempt.pending); delete attempt.pending; save(); overview = null; announce('Answer checked. Your progress is saved.');
  });
}
function markHelp(field) {
  const current = currentAttempt();
  if (!current || busy || current.value.pending) return;
  current.value[field] = !current.value[field];
  if (current.value[field]) markSourceExposure();
  if (current.value[field] && !current.value.feedback) current.value.assisted = true;
  save(); render();
}
function retryAttempt() {
  const current = currentAttempt();
  if (!current || busy || current.value.pending) return;
  const keepHelp = !!current.value.transcript || !!current.value.translation || route.section === 'reading' && translationOpen;
  state.attempts[current.key] = { requestId: requestId(), answer: '', assisted: keepHelp, transcript: !!current.value.transcript, translation: !!current.value.translation, feedback: null };
  save(); render(); document.querySelector('#attempt-answer')?.focus();
}
function savePhrase() {
  const lesson = currentReading();
  const phrase = lesson?.annotations[phraseIndex];
  if (!phrase || state.saved[`${lesson.id}:${phrase.phrase}`]) return;
  const body = { requestId: requestId(), fr: phrase.phrase, en: phrase.translation, explanation: phrase.explanation, sourceId: lesson.id };
  mutation(async () => { await api('phrases', body); state.saved[`${lesson.id}:${phrase.phrase}`] = true; save(); overview = null; announce('Phrase saved to Review.'); });
}
function finishReview() {
  if (!reviewRequest || busy) return;
  const body = reviewRequest;
  mutation(async () => {
    overview = await api('review', body); reviewRequest = null; state.reviewPending = null; save(); reviewRevealed = false; announce('Recall saved.');
  });
}
function reviewPhrase(known) {
  const card = overview?.due.find((item) => item.kind === 'phrase');
  if (!card || !reviewRevealed || busy) return;
  if (reviewRequest) { showNotice('Finish the previous recall update before choosing another rating.', finishReview); return; }
  reviewRequest = { requestId: requestId(), reviewId: card.id, known };
  state.reviewPending = reviewRequest; save(); finishReview();
}
function adoptJob(job) {
  const previous = jobs.get(job.id);
  if (previous && previous.updatedAt > job.updatedAt) return;
  jobs.set(job.id, job);
  state.jobs[jobKey(job.input.kind, job.input.sourceId)] = job.id;
  if (state.tutorPending[jobKey(job.input.kind, job.input.sourceId)]?.requestId === job.input.requestId) delete state.tutorPending[jobKey(job.input.kind, job.input.sourceId)];
  if (job.result?.kind === 'material') {
    imported.set(job.result.material.id, job.result.material);
    if (!materials.some((entry) => entry.id === job.result.material.id)) materials.push({ id: job.result.material.id, title: job.result.material.title, kind: 'imported' });
  }
  job.owned = ownedRequests.has(job.input.requestId);
  if (terminal(job)) { ownedRequests.delete(job.input.requestId); saveOwnedRequests(); }
  save();
}
function updateJobUI() {
  if (route.section !== 'reading' || !route.lesson) return;
  const kind = route.lesson === 'own-material' ? 'material' : 'writing';
  const slot = document.querySelector(`[data-job-slot="${kind}"]`);
  if (slot) {
    const html = tutorSlotHTML(kind, route.lesson);
    if (slot.renderedHTML !== html) {
      const opened = [...slot.querySelectorAll('details[open]')].map(element => element.dataset.submission);
      const focused = slot.contains(document.activeElement) ? document.activeElement : null;
      const action = focused?.dataset.action;
      const submission = focused?.closest('details')?.dataset.submission;
      slot.innerHTML = html;
      slot.renderedHTML = html;
      for (const details of slot.querySelectorAll('details')) details.open = opened.includes(details.dataset.submission);
      if (focused) {
        const replacement = submission
          ? [...slot.querySelectorAll('details')].find(element => element.dataset.submission === submission)?.querySelector('summary')
          : [...slot.querySelectorAll('button')].find(element => element.dataset.action === action && element.dataset.job === focused.dataset.job && element.dataset.request === focused.dataset.request);
        if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
        else { slot.tabIndex = -1; slot.focus({ preventScroll: true }); }
      }
    }
  }
  const running = active(displayedJob(kind, route.lesson));
  main.querySelectorAll('[data-draft], [data-action="submit-writing"], [data-action="submit-material"]').forEach((element) => { element.disabled = busy || running; });
}
function renderTutorStatus() {
  const target = document.querySelector('#tutor-status');
  if (tutorStatusError) { target.textContent = `Tutor status unknown — ${tutorStatusError}`; return; }
  if (!tutorStatus) { target.textContent = 'Checking local tutor status…'; return; }
  const states = { off: 'Local tutor off — no Echo model process is loaded.', loading: 'Local tutor is starting its model.', working: 'Local tutor is working.', releasing: 'Local tutor is releasing its model — not off yet.' };
  target.textContent = `${states[tutorStatus.state] || 'Tutor status unknown.'}${tutorStatus.queued ? ` ${tutorStatus.queued} request${tutorStatus.queued === 1 ? '' : 's'} queued.` : ''}`;
}
async function refreshTutorStatus() {
  try { tutorStatus = await api('tutor/status'); tutorStatusError = ''; }
  catch (error) { tutorStatusError = error.message; }
  renderTutorStatus();
}
async function submitTutor(kind) {
  if (busy || submittingTutor) return;
  const source = kind === 'material' ? 'own-material' : route.lesson;
  if (active(displayedJob(kind, source))) return;
  const text = draftFor(kind, source);
  if (!text.trim()) { showNotice('Write or paste some French before asking the tutor.'); document.querySelector(kind === 'writing' ? '#writing-draft' : '#material-draft')?.focus(); return; }
  const key = jobKey(kind, source);
  const body = state.tutorPending[key] || { requestId: requestId(), kind, sourceId: source, text, ...(kind === 'material' ? { title: draftFor('title', source) } : { prompt: currentReading().writingPrompt }) };
  state.tutorPending[key] = body; save();
  ownedRequests.add(body.requestId); saveOwnedRequests();
  const execute = async () => {
    submittingTutor = true; updateJobUI();
    try {
      let job;
      try { job = await api('tutor', body); }
      catch (error) {
        // A lost POST response must not turn a retry into a second model run.
        try {
          const last = await api(`tutor/last?sourceId=${encodeURIComponent(source)}&kind=${kind}`);
          if (last.job?.input.requestId === body.requestId) job = last.job;
        } catch {}
        if (!job) throw error;
      }
      if (stoppedRequests.has(body.requestId) || leaving || route.section !== 'reading' || route.lesson !== source) {
        if (active(job)) job = await api(`tutor/${encodeURIComponent(job.id)}/stop`, {});
      }
      adoptJob(job);
      updateJobUI();
      await refreshTutorStatus();
    } finally { submittingTutor = false; }
  };
  await mutation(execute);
}
async function stopJob(id) {
  if (stoppingJobs.has(id)) return;
  stoppingJobs.add(id); updateJobUI();
  try { adoptJob(await api(`tutor/${encodeURIComponent(id)}/stop`, {})); await refreshTutorStatus(); }
  catch (error) { showNotice(error.message, () => stopJob(id)); }
  finally { stoppingJobs.delete(id); updateJobUI(); }
}
async function pollTutor() {
  if (polling || leaving) return;
  polling = true;
  try {
    const pending = [...jobs.values()].filter(active);
    for (const previous of pending) {
      try {
        const next = await api(`tutor/${encodeURIComponent(previous.id)}`);
        adoptJob(next); updateJobUI();
        if (terminal(next)) announce(next.status === 'complete' ? 'Local tutor finished. Its advice is ready.' : 'Local tutor stopped. Your submitted text is preserved.');
      } catch (error) { showNotice(`Cannot refresh the tutor request. ${error.message}`, pollTutor); }
    }
    await refreshTutorStatus();
  } finally { polling = false; }
}
async function stopPending(request, keepalive = false) {
  if (stoppingJobs.has(request)) return;
  stoppingJobs.add(request); stoppedRequests.add(request); updateJobUI();
  try {
    const response = await fetch(`api/learning/tutor/request/${encodeURIComponent(request)}/stop`, { method: 'POST', keepalive });
    if (!response.ok) throw new Error('Could not confirm the stop request. Please retry.');
    for (const [key, input] of Object.entries(state.tutorPending)) if (input.requestId === request) delete state.tutorPending[key];
    ownedRequests.delete(request); saveOwnedRequests(); save();
    if (!leaving) { showNotice('Stop requested. Your draft is preserved. The status above confirms when the model is actually off.'); await refreshTutorStatus(); }
  } catch (error) {
    if (!leaving) showNotice(error.message, () => stopPending(request));
  } finally { stoppingJobs.delete(request); updateJobUI(); }
}
function stopOwnedJobs(keepalive = false) {
  const pending = [...jobs.values()].filter((job) => active(job) && job.owned);
  for (const job of pending) {
    fetch(`api/learning/tutor/${encodeURIComponent(job.id)}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive }).then(async (response) => {
      if (!response.ok) throw new Error('Echo could not stop the tutor.');
      const result = await response.json(); adoptJob(result); updateJobUI(); await refreshTutorStatus();
    }).catch(() => { if (!leaving) showNotice('Could not confirm that the local tutor stopped. Use Stop again or refresh its status.', () => stopOwnedJobs()); });
  }
  for (const input of Object.values(state.tutorPending)) if (ownedRequests.has(input.requestId)) stopPending(input.requestId, keepalive);
}
function stopAudio() {
  audioGeneration++; audio.pause(); audio.removeAttribute('src'); audio.load();
  document.querySelector('#learning-audio').hidden = true;
}
function audioNotice(text) {
  const element = document.querySelector('#learning-audio'); element.hidden = false;
  element.innerHTML = `<span>${esc(text)}</span><button type="button" class="quiet" data-action="retry-audio">Retry audio</button><button type="button" class="quiet" data-action="stop-audio">Dismiss</button>`;
}
async function playAudio(url) {
  const token = ++audioGeneration;
  audioURL = url; audio.pause(); audio.src = url; audio.playbackRate = state.speed; audio.preservesPitch = true;
  try { await audio.play(); if (token === audioGeneration) document.querySelector('#learning-audio').hidden = true; }
  catch (error) { if (token === audioGeneration) audioNotice(error.name === 'NotAllowedError' ? 'Playback was blocked. Tap Retry audio.' : 'This prepared recording could not play. Check your connection or retry.'); }
}
audio.addEventListener('error', () => { if (audio.getAttribute('src')) audioNotice('This prepared recording is unavailable. No model was started. Retry audio after checking your connection.'); });

document.addEventListener('input', (event) => {
  const field = event.target;
  if (field.id === 'attempt-answer') {
    const current = currentAttempt(); if (current && !current.value.feedback && !current.value.pending) { current.value.answer = field.value; save(); }
  }
  if (field.dataset.draft) { state.drafts[draftKey(field.dataset.draft, field.dataset.source)] = field.value; save(); }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'learning-speed') { state.speed = Number(event.target.value) === 0.8 ? 0.8 : 1; audio.playbackRate = state.speed; save(); }
});
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-home]');
  if (link) {
    try { localStorage.setItem('echo.section', link.dataset.home); if (link.dataset.direction) localStorage.setItem('echo.direction', link.dataset.direction); } catch {}
    stopOwnedJobs(true); return;
  }
  const target = event.target.closest('button');
  if (!target || target.disabled) return;
  if (target.dataset.choice !== undefined) {
    const current = currentAttempt(); const choices = selectedChoices();
    if (!busy && current && !current.value.feedback && !current.value.pending && choices?.[Number(target.dataset.choice)] !== undefined) {
      const index = Number(target.dataset.choice);
      current.value.answer = choices[index]; save(); render();
      main.querySelector(`[data-choice="${index}"]`)?.focus({ preventScroll: true });
    }
    return;
  }
  if (target.dataset.phrase !== undefined) {
    phraseIndex = Number(target.dataset.phrase);
    markSourceExposure();
    const current = currentAttempt(); if (current && !current.value.feedback && !current.value.pending) { current.value.assisted = true; save(); }
    render(); return;
  }
  const action = target.dataset.action;
  if (action === 'retry-request') { const retry = retryAction; showNotice(''); retry?.(); }
  else if (action === 'play-audio') playAudio(`audio/learning/${encodeURIComponent(target.dataset.audioId)}.mp3`);
  else if (action === 'stop-audio') stopAudio();
  else if (action === 'retry-audio' && audioURL) playAudio(audioURL);
  else if (action === 'check-attempt') checkAttempt();
  else if (action === 'retry-attempt') retryAttempt();
  else if (action === 'reveal-transcript' || action === 'reveal-source') markHelp('transcript');
  else if (action === 'reveal-translation') markHelp('translation');
  else if (action === 'reading-translation') {
    translationOpen = !translationOpen;
    if (translationOpen) markSourceExposure();
    const current = currentAttempt(); if (translationOpen && current && !current.value.feedback && !current.value.pending) { current.value.assisted = true; save(); }
    render();
  }
  else if (action === 'close-phrase') { phraseIndex = null; render(); }
  else if (action === 'save-phrase') savePhrase();
  else if (action === 'model-answer') { modelOpen = !modelOpen; render(); }
  else if (action === 'submit-writing') submitTutor('writing');
  else if (action === 'submit-material') submitTutor('material');
  else if (action === 'stop-tutor') stopJob(target.dataset.job);
  else if (action === 'stop-pending') stopPending(target.dataset.request);
  else if (action === 'next-turn') {
    const lesson = catalog.conversations.find((entry) => entry.id === route.lesson); const position = conversationPosition(lesson.id);
    if (!currentAttempt()?.value.feedback) return;
    if (position.index + 1 >= lesson.turns.length) position.complete = true; else position.index++;
    stopAudio(); save(); render(); main.focus({ preventScroll: true });
  }
  else if (action === 'restart-conversation') {
    const lesson = catalog.conversations.find((entry) => entry.id === route.lesson);
    lesson.turns.forEach((_, index) => { delete state.attempts[`conversation:${lesson.id}:reply:${index}`]; });
    state.conversations[lesson.id] = { index: 0, complete: false }; save(); render();
  }
  else if (action === 'review-reveal') { reviewRevealed = true; render(); }
  else if (action === 'review-again') reviewPhrase(false);
  else if (action === 'review-known') reviewPhrase(true);
});
document.addEventListener('keydown', (event) => {
  if (event.repeat || busy || loading || event.defaultPrevented) return;
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && event.target.id === 'attempt-answer') { event.preventDefault(); checkAttempt(); return; }
  if (event.target.closest('input,textarea,select,button,a') || event.metaKey || event.ctrlKey || event.altKey) return;
  if (route.section === 'review' && overview?.due.some((entry) => entry.kind === 'phrase')) {
    if (!reviewRevealed && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); reviewRevealed = true; render(); }
    else if (reviewRevealed && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); reviewPhrase(event.key === 'ArrowRight'); }
  }
});
document.querySelector('#refresh-tutor').addEventListener('click', refreshTutorStatus);
window.addEventListener('hashchange', () => {
  stopOwnedJobs(); stopAudio(); route = parseRoute(); phraseIndex = null; translationOpen = false; modelOpen = false;
  loadPage(); window.scrollTo(0, 0); main.focus({ preventScroll: true });
});
window.addEventListener('pagehide', () => { leaving = true; stopAudio(); stopOwnedJobs(true); });
window.addEventListener('pageshow', (event) => { leaving = false; if (event.persisted) { loadPage(); refreshTutorStatus(); } });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopAudio(); stopOwnedJobs(true); }
  else { refreshTutorStatus(); pollTutor(); }
});
setInterval(pollTutor, 1500);
loadPage();
refreshTutorStatus();
