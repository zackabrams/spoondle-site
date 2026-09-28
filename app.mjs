import { puzzles } from './puzzles.mjs';
import { checkSwap, tradeAnswer, guessKey, solvedAnswer, hintTargets, revealHint } from './game.mjs';
import { STORAGE_KEY, puzzleKey, restoreRecord, readProgress, elapsedMs, formatTime, finishRecord, giveUpRecord, pauseRecord, resumeRecord, shareText } from './progress.mjs';

const $ = id => document.getElementById(id);
const shelf = $('shelf'), mat = $('mat'), tray = $('tray'), clue = $('clue'), message = $('message');
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
// With Reduce Motion on, tiles still slide (briefly, without the bounce) so a move stays readable; the big motion stays off.
const SPRING = RM ? 'ease-out' : 'cubic-bezier(.2,1.35,.45,1)', SNAP = RM ? 200 : 360;
// How far past the mat's edge a letter has to be pulled before its whole word comes along.
const TEAR = 56;
const CLUE_KEY = 'Yellow: swap this letter. Gray: leave it.';

// ---------- saved progress ----------
let saved = { records: {}, completionDays: [], current: null };
try { saved = readProgress(localStorage); } catch {}
const keys = puzzles.map(puzzleKey);
let records = puzzles.map((p, i) => restoreRecord(p, saved.records[keys[i]]));
const requestedKey = new URL(location.href).searchParams.get('p');
let board = Math.max(0, keys.indexOf(requestedKey || saved.current));
const puzzle = () => puzzles[board], record = () => records[board], state = () => records[board].state;
function persist() {
  saved.current = keys[board]; records.forEach((r, i) => { saved.records[keys[i]] = r; });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch {}
}

// ---------- start each puzzle deliberately; pause its clock when it is not visible ----------
function syncClocks() {
  const showing = !document.hidden && !$('help-dialog').open;
  records.forEach((r, i) => {
    if (i !== board || !showing || r.startedAt === null) { pauseRecord(r); return; }
    resumeRecord(r);
  });
}
function refreshClocks() { syncClocks(); persist(); updateStats(); }
function showStartGate() {
  const waiting = record().startedAt === null;
  $('play-area').classList.toggle('waiting', waiting);
  $('start-overlay').hidden = !waiting;
  for (const id of ['tray', 'shelf', 'mat', 'message']) $(id).inert = waiting;
  $('hint').disabled = waiting; $('give-up').disabled = waiting;
}
function startPuzzle() {
  if (record().startedAt !== null) return;
  record().startedAt = Date.now();
  unpile(); showStartGate(); refreshClocks();
}
// Before Start, the tiles lie face up in a jumbled heap in the middle of the table.
function pileUp() {
  if (record().startedAt !== null) return;
  const tiles = [...document.querySelectorAll('.shelf .home:not(.done) .tile')];
  tiles.forEach(t => { t.style.transform = ''; });
  const box = shelf.getBoundingClientRect(), cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  const rx = Math.min(box.width * .26, 92), ry = Math.min(box.height * .28, 56);
  for (const t of tiles) {
    const r = t.getBoundingClientRect(), angle = Math.random() * Math.PI * 2, reach = Math.sqrt(Math.random());
    const dx = cx + Math.cos(angle) * rx * reach - (r.left + r.width / 2), dy = cy + Math.sin(angle) * ry * reach - (r.top + r.height / 2);
    const rot = Math.round(Math.random() * 360 - 180);
    Object.assign(t.dataset, { px: dx.toFixed(1), py: dy.toFixed(1), pr: rot });
    t.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) rotate(${rot}deg)`;
    t.style.zIndex = String(1 + Math.floor(Math.random() * 9));   // stays under the Start button's layer
  }
}
// On Start, the heap splits: each tile springs from the pile to its place in the two columns.
function unpile() {
  const tiles = [...document.querySelectorAll('.shelf .tile[data-px]')];
  const order = tiles.map((t, i) => [Math.random(), t, i]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  let last = 0;
  order.forEach((t, i) => {
    const dx = +t.dataset.px, dy = +t.dataset.py, rot = +t.dataset.pr, delay = i * 24, duration = 620;
    t.style.transform = ''; delete t.dataset.px; delete t.dataset.py; delete t.dataset.pr;
    if (RM) { t.style.zIndex = ''; return; }
    t.style.zIndex = '25';   // above the mat the whole way home (on a wide screen the pile sits on it)
    t.animate([
      { transform: `translate(${dx}px,${dy}px) rotate(${rot}deg)` },
      { transform: `translate(${(dx * .45).toFixed(1)}px,${(dy * .45 - 22).toFixed(1)}px) rotate(${Math.round(rot * .3)}deg) scale(1.14)`, offset: .45 },
      { transform: 'none' }
    ], { duration, delay, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'backwards' }).finished.then(() => { t.style.zIndex = ''; }, () => { t.style.zIndex = ''; });
    if (i % 3 === 0) setTimeout(() => clack('place', .35), delay + duration * .9);
    last = delay + duration;
  });
  setTimeout(relight, last + 60);
}
function ensureStarted() { if (record().startedAt === null) startPuzzle(); }
function updateStats() {
  const s = state(), plural = (n, word) => `${n} ${word}${n === 1 ? '' : word.endsWith('s') ? 'es' : 's'}`;
  $('timer').textContent = formatTime(elapsedMs(record()));
  // Hints and reveals are counted above the answers; reveals are stored as `misses` (their old name).
  for (const [id, n, word] of [['use-hints', s.hints, 'hint'], ['use-reveals', s.misses, 'reveal']]) {
    const el = $(id), was = +el.dataset.n;
    el.lastChild.textContent = ` ${word}${n === 1 ? '' : 's'}`; el.querySelector('b').textContent = n; el.dataset.n = n;
    el.classList.toggle('on', n > 0);
    if (n > was && !RM) el.animate([{ scale: 1 }, { scale: 1.18 }, { scale: 1 }], { duration: 420, easing: 'ease-out' });
  }
}

// ---------- sound: a short filtered click, like a plastic tile set down on a table ----------
let audio = null, soundOn = true;
try { soundOn = localStorage.getItem('spoondle-sound') !== 'off'; } catch {}
const icon = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
// Relax mode's button shows the mode you're in: a stopwatch while timed, a teacup while relaxed.
const STOPWATCH = icon('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M10 2.5h4M12 2.5V6M18.2 6.8l1.4-1.4"/>');
const TEACUP = icon('<path d="M4 10h12.5v3a6 6 0 0 1-6 6h-.5a6 6 0 0 1-6-6z"/><path d="M16.5 11.2h1.3a2.6 2.6 0 0 1 0 5.2h-1.9"/><path d="M8 3.2c-.9 1.1.9 2.1 0 3.3M12 3.2c-.9 1.1.9 2.1 0 3.3"/><path d="M3 21.5h15"/>');
let relaxed = false;
try { relaxed = localStorage.getItem('spoondle-relax') === 'on'; } catch {}
function showRelax() {
  const b = $('relax'); b.innerHTML = relaxed ? TEACUP : STOPWATCH; b.setAttribute('aria-pressed', String(relaxed));
  b.setAttribute('aria-label', relaxed ? 'Relax mode on (no timer)' : 'Timer on'); b.title = relaxed ? 'Relax mode: no timer' : 'Timer on';
  document.documentElement.classList.toggle('relaxed', relaxed);
}
const SPEAKER_ON = icon('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>');
const SPEAKER_OFF = icon('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9.5l4 5M21 9.5l-4 5"/>');
const TABLE = icon('<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>');
function showSound() { $('sound').innerHTML = soundOn ? SPEAKER_ON : SPEAKER_OFF; $('sound').setAttribute('aria-pressed', String(soundOn)); $('sound').setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off'); }
// Wake the audio whenever it isn't running: iOS leaves it 'interrupted', not 'suspended', after a call or an app switch.
function ctx() { audio ??= new (window.AudioContext || window.webkitAudioContext)(); if (audio.state !== 'running') audio.resume().catch(() => {}); return audio; }
function clack(kind = 'place', volume = 1) {
  // Phones buzz only once the player has touched the page; before that the browser refuses.
  try { if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(kind === 'pick' ? 4 : 9); } catch {}
  if (!soundOn) return;
  try {
    const a = ctx(), t = a.currentTime, len = kind === 'pick' ? .016 : .03;
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * len), a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
    const src = a.createBufferSource(), filter = a.createBiquadFilter(), gain = a.createGain();
    src.buffer = buf; filter.type = 'bandpass'; filter.frequency.value = kind === 'pick' ? 3400 : 1700 + Math.random() * 400; filter.Q.value = 1.6;
    gain.gain.value = (kind === 'pick' ? .3 : .75) * volume;
    src.connect(filter).connect(gain).connect(a.destination); src.start(t);
    if (kind !== 'pick') {
      const body = a.createOscillator(), bg = a.createGain();
      body.frequency.value = kind === 'nope' ? 170 : 480 + Math.random() * 80;
      bg.gain.setValueAtTime(.14 * volume, t); bg.gain.exponentialRampToValueAtTime(.001, t + (kind === 'nope' ? .16 : .05));
      body.connect(bg).connect(a.destination); body.start(t); body.stop(t + .2);
    }
  } catch {}
}
function chime() {
  if (!soundOn) return;
  try {
    const a = ctx(), t = a.currentTime;
    [660, 990].forEach((f, i) => { const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, t + i * .09); g.gain.linearRampToValueAtTime(.12, t + i * .09 + .01); g.gain.exponentialRampToValueAtTime(.001, t + i * .09 + .35); o.connect(g).connect(a.destination); o.start(t + i * .09); o.stop(t + i * .09 + .4); });
  } catch {}
}

// ---------- building a board ----------
const homeOf = new Map();
let slots = [], busy = false, press = null, drag = null, picked = null, lastSwap = null, lastWrong = null;
function makeTile(ch, card = null, index = 0) {
  const t = document.createElement('div'); t.className = 'tile'; t.textContent = ch; t.dataset.letter = ch;
  if (card) { t.dataset.card = card; t.dataset.index = index; t.setAttribute('role', 'button'); t.tabIndex = 0; t.setAttribute('aria-label', ch); }
  return t;
}
function makeGap() { const g = document.createElement('div'); g.className = 'gap'; return g; }
function makeWord(card) {
  const w = document.createElement('div'); w.className = 'word'; w.dataset.col = card.column; w.dataset.id = card.id;
  [...card.word].forEach((ch, i) => { const t = makeTile(ch, card.id, i); t.style.setProperty('--r', `${(Math.random() * 4.4 - 2.2).toFixed(2)}deg`); w.append(t); });
  return w;
}
// Clues and hints color the original tiles: amber for a letter to swap, gray for one to leave.
function paintFeedback() {
  const feedback = state().feedback, solved = new Set(state().solved.flat());
  for (const t of document.querySelectorAll('.tile[data-card]')) {
    // A solved pair drops its hint and reveal colors, so the answer glows evenly.
    const status = solved.has(t.dataset.card) ? null : feedback[t.dataset.card]?.[t.dataset.index];
    if (status) t.dataset.status = status; else delete t.dataset.status;
    t.setAttribute('aria-label', t.dataset.letter + (status === 'swap' ? ', swap this letter' : status === 'stay' ? ', leave this letter' : ''));
  }
}
// Answers are written the way you'd write them: names and titles capitalized, everything else lowercase.
// (Themes whose answers look like tiles or type set them in capitals anyway.)
const MINOR = new Set(['A', 'AN', 'AND', 'AT', 'FOR', 'IN', 'OF', 'ON', 'THE', 'TO']);
function written(label) {
  if (puzzle().category !== 'Proper nouns') return label.toLowerCase();
  return label.split(' ').map((w, i) => i && MINOR.has(w) ? w.toLowerCase() : w[0] + w.slice(1).toLowerCase()).join(' ');
}
function fillFound(box, label, revealed) {
  const answer = document.createElement('span'); answer.className = 'answer'; answer.style.setProperty('--n', label.length);
  for (const ch of written(label)) { const c = document.createElement('span'); c.className = ch === ' ' ? 'sp' : 'ch'; c.textContent = ch; answer.append(c); }
  box.classList.add('filled'); box.classList.toggle('revealed', revealed); box.setAttribute('role', 'button'); box.tabIndex = 0;
  box.setAttribute('aria-label', revealed ? `${label}, revealed` : label);
  box.replaceChildren(answer);
  return answer;
}
function build(save = true) {
  const p = puzzle(), s = state(), solvedIds = new Set(s.solved.flat());
  busy = false; picked = null; lastSwap = null; lastWrong = null; homeOf.clear();
  syncClocks();
  $('category').textContent = p.category; $('level').hidden = !p.difficulty; $('level').textContent = p.difficulty ?? ''; $('level').dataset.level = (p.difficulty ?? '').toLowerCase();
  $('count').textContent = `${board + 1} / ${puzzles.length}${record().finishedAt !== null && !s.revealed ? ' ✓' : ''}`;
  $('prev').disabled = board === 0; $('next').disabled = board === puzzles.length - 1;
  const url = new URL(location.href); url.searchParams.set('p', keys[board]); history.replaceState(null, '', url);
  shelf.replaceChildren(); tray.replaceChildren(); clue.replaceChildren(); mat.replaceChildren(); mat.className = 'mat'; mat.style.minHeight = '';
  const columns = [0, 1].map(c => p.cards.filter(card => card.column === c));
  for (let i = 0; i < columns[0].length; i++) for (const column of columns) {
    const home = document.createElement('div'); home.className = 'home'; home.style.setProperty('--n', column[i].word.length); const w = makeWord(column[i]);
    home.append(w); homeOf.set(w, home); shelf.append(home);
    if (solvedIds.has(w.dataset.id)) home.classList.add('done');
    // Tapping a word's empty spot on the table calls it back from the mat.
    home.addEventListener('click', () => { if (home.classList.contains('empty') && !busy && w.closest('.slot')) sendHome(w); });
    home.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === home && home.classList.contains('empty')) { e.preventDefault(); sendHome(w); } });
  }
  for (let i = 0; i < p.answers.length; i++) { const f = document.createElement('div'); f.className = 'found'; tray.append(f); }
  s.solved.forEach((ids, i) => fillFound(tray.children[i], solvedAnswer(p, ids).label, i >= s.solved.length - s.revealed));
  slots = [0, 1].map(() => { const slot = document.createElement('div'); slot.className = 'slot'; mat.append(slot); return slot; });
  const turn = document.createElement('button'); turn.type = 'button'; turn.className = 'mat-flip'; turn.setAttribute('aria-label', 'Swap which word is on top');
  turn.innerHTML = icon('<path d="M8 4v15M4.5 7.5 8 4l3.5 3.5M16 20V5M12.5 16.5 16 20l3.5-3.5"/>'); turn.addEventListener('click', flipMat); mat.append(turn);
  paintFeedback(); showStartGate();
  if (save) persist();
  updateStats(); say();
  sizeTiles();   // after the message line, which is taller on a finished board
  if (record().startedAt === null) pileUp();
  placeLastPair(RM ? 0 : 250);
}
// Tiles as big as the room allows: the two table columns are each as wide as their longest word,
// and on a phone, where everything shares one screen, they give back height if the bottom is pushed off
// (or, with the phone sideways, if the table runs past its half of the screen).
function sizeTiles() {
  const cards = puzzle().cards, app = shelf.closest('.app'), area = $('play-area');
  const tooTall = () => {
    const bar = document.querySelector('.bottom').getBoundingClientRect(), table = shelf.getBoundingClientRect();
    const hitsBar = r => r.left < bar.right && bar.left < r.right && r.bottom > bar.top + .5;
    return app.scrollHeight > app.clientHeight || (between && document.documentElement.scrollHeight > innerHeight) || table.bottom > area.getBoundingClientRect().bottom + .5 || hitsBar(table) || hitsBar(message.getBoundingClientRect());
  };
  const [left, right] = [0, 1].map(c => Math.max(...cards.filter(card => card.column === c).map(card => card.word.length)));
  const longest = Math.max(left, right);
  // On a wide screen the mat sits inside the table's width, between the columns, so leave room for it.
  const t = shelf.getBoundingClientRect(), m = mat.getBoundingClientRect();
  const between = m.left > t.left && m.right < t.right && m.top < t.bottom && m.bottom > t.top;
  // A wide screen gets bigger tiles, growing with the window's height.
  const tall = Math.max(0, innerHeight - 800);
  mat.style.setProperty('--mat-s', `${Math.min(between ? Math.min(72, 60 + Math.floor(tall / 20)) : 50, Math.floor((mat.clientWidth - 30 - 6 * (longest - 1)) / longest))}px`);
  let size = between
    ? Math.floor(((shelf.clientWidth - m.width - 2 * parseFloat(getComputedStyle(shelf).columnGap)) / 2 - 3 * (longest - 1)) / longest)   // two equal sides around the mat
    : Math.floor((shelf.clientWidth - 26 - 3 * (left + right - 2)) / (left + right));   // two 12px aisles around the divider
  size = Math.max(20, Math.min(between ? Math.min(66, 56 + Math.floor(tall / 25)) : 46, size));
  shelf.style.setProperty('--shelf-s', `${size}px`);
  while (size > 20 && tooTall()) shelf.style.setProperty('--shelf-s', `${size -= 2}px`);
}
function goTo(index) {
  if (busy || index < 0 || index >= puzzles.length) return;
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  const direction = Math.sign(index - board);
  board = index; build();
  // The new board slides in from the side you moved toward, like turning to the next page.
  if (!RM && direction) $('play-area').animate([{ transform: `translateX(${direction * 56}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
function nextUnfinished() {
  for (let step = 1; step < puzzles.length; step++) { const i = (board + step) % puzzles.length; if (records[i].finishedAt === null) return i; }
  return -1;
}

// ---------- the line under the mat ----------
function pill(label, onClick, primary = false) {
  const b = document.createElement('button'); b.type = 'button'; b.className = primary ? 'pill primary' : 'pill'; b.textContent = label;
  b.addEventListener('click', () => onClick(b)); return b;
}
// Reveal wears an eye, as Hint wears a lightbulb (the counters above the answers wear the same two).
const EYE = '<svg class="eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>';
// On a computer, pointing at Reveal (or tabbing to it) outlines the two tiles it would color.
function revealPill() {
  const b = pill('Reveal', showClue); b.insertAdjacentHTML('afterbegin', EYE);
  const preview = on => { if (!lastWrong) return;
    lastWrong.ids.forEach((id, i) => document.querySelector(`.tile[data-card="${id}"][data-index="${lastWrong.positions[i]}"]`)?.classList.toggle('previewed', on)); };
  b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') preview(true); });
  b.addEventListener('pointerleave', () => preview(false));
  b.addEventListener('focus', () => { if (b.matches(':focus-visible')) preview(true); });
  b.addEventListener('blur', () => preview(false));
  return b;
}
function say(parts = null) {
  const done = record().finishedAt !== null;
  for (const el of [shelf, mat]) { el.classList.toggle('finished', done); el.classList.toggle('given-up', done && state().revealed > 0); }
  document.querySelectorAll('.tile.previewed').forEach(t => t.classList.remove('previewed'));
  const p = puzzle(), r = record(), s = state();
  message.replaceChildren(); relight();
  $('actions').hidden = r.finishedAt !== null;
  $('hint').disabled = r.startedAt === null || !hintTargets(p, s).length;
  if (r.finishedAt !== null) {
    const next = nextUnfinished();
    message.append(s.revealed ? 'Answers shown.' : relaxed ? 'Solved!' : `Solved in ${formatTime(elapsedMs(r))}.`, pill('Share', shareResult));
    message.append(next >= 0 ? pill('Next puzzle', () => goTo(next), true) : 'That’s all nine. Thanks for playing!');
    return;
  }
  if (parts) { message.append(...parts); return; }
  const n = slots.filter(slot => slot.querySelector('.word')).length;
  message.textContent = n === 0 ? 'Drag a word onto the mat.' : n === 1 ? 'Now one from the other side.' : 'Drag a letter onto the other word.';
}

// ---------- motion: move elements in the DOM, then animate each from where it was ----------
function flip(els, mutate, { lifted = null, duration = SNAP } = {}) {
  const before = els.map(el => {
    if (lifted && lifted.el === el) { el.style.transform = ''; return { el, r: el.getBoundingClientRect() }; }
    const r = el.getBoundingClientRect();
    // A tile previewing a trade is measured where it shows, then set down without a second slide.
    if (el.style.translate) { el.style.transition = 'none'; el.style.translate = ''; requestAnimationFrame(() => { el.style.transition = ''; }); }
    return { el, r };
  });
  mutate();
  for (const { el, r } of before) {
    if (!el.isConnected) continue;
    const n = el.getBoundingClientRect(), s = n.width ? r.width / n.width : 1;
    let dx = r.left + r.width / 2 - (n.left + n.width / 2), dy = r.top + r.height / 2 - (n.top + n.height / 2), rot = 0, k = 1;
    if (lifted && lifted.el === el) { dx += lifted.ox; dy += lifted.oy; rot = lifted.rot; k = lifted.k; }
    const anim = el.animate([{ transform: `translate(${dx}px,${dy}px) scale(${s * k}) rotate(${rot}deg)` }, { transform: 'none' }], { duration, easing: SPRING });
    if (lifted && lifted.el === el) anim.finished.then(() => el.classList.remove('lifted')).catch(() => {});
  }
}
function snapBack(d) {
  const el = d.el; el.style.transform = '';
  el.animate([{ transform: `translate(${d.ox}px,${d.oy}px) scale(${d.k}) rotate(${d.rot}deg)` }, { transform: 'none' }], { duration: SNAP, easing: SPRING })
    .finished.then(() => el.classList.remove('lifted')).catch(() => {});
  clack('place', .5);
}
function domSwap(a, b) { const m = document.createComment(''); a.replaceWith(m); b.replaceWith(a); m.replaceWith(b); }
const inside = (r, x, y, pad = 0) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
const wordOn = side => slots[side]?.querySelector('.word') ?? null;
const text = w => [...w.children].map(t => t.dataset.letter).join('');
function syncSlots() {
  slots.forEach(slot => slot.classList.toggle('full', !!slot.querySelector('.word')));
  mat.classList.toggle('pair', slots.every(slot => slot.querySelector('.word')));
}
// The flip button swaps which word sits on top, to read the pair the other way round. Only the view changes.
function flipMat() {
  const tiles = slots.flatMap(slot => [...slot.querySelectorAll('.tile')]);
  flip(tiles, () => mat.classList.toggle('flipped')); clack('pick', .6);
}
// Once three answers are found, the last two words are the only pair left: they stay on the mat,
// with no outline to call them back to.
const lastPair = () => record().finishedAt === null && state().solved.length === puzzle().answers.length - 1;
function markHome(word, away) {
  const home = homeOf.get(word), empty = away && !lastPair(); home.classList.toggle('empty', empty);
  if (empty) { home.tabIndex = 0; home.setAttribute('role', 'button'); home.setAttribute('aria-label', `Put ${text(word)} back`); }
  else { home.removeAttribute('tabindex'); home.removeAttribute('role'); home.removeAttribute('aria-label'); }
}

// ---------- the rules: words go to the mat; letters trade between the two words there ----------
function placeWord(word, lifted = null) {
  ensureStarted();
  const side = +word.dataset.col, old = wordOn(side);
  if (old === word) { if (lifted) snapBack(lifted); return; }
  flip(old ? [word, old] : [word], () => {
    if (old) { homeOf.get(old).append(old); markHome(old, false); }
    slots[side].append(word); markHome(word, true); syncSlots();
  }, { lifted });
  clack('place'); lastWrong = null; say();
}
function sendHome(word, lifted = null) {
  if (lastPair()) { if (lifted) snapBack(lifted); return; }
  if (picked) { picked.classList.remove('picked'); picked = null; }
  flip([word], () => { homeOf.get(word).append(word); markHome(word, false); syncSlots(); }, { lifted });
  clack('place', .8); lastWrong = null; say();
}
function trade(a, b, lifted = null) {
  ensureStarted();
  const wa = a.parentNode, wb = b.parentNode;
  const ids = [wa.dataset.id, wb.dataset.id], positions = [+a.dataset.index, +b.dataset.index];
  flip([a, b], () => domSwap(a, b), { lifted });
  clack('place'); lastSwap = [a, b]; lastWrong = null;
  const unchanged = a.dataset.letter === b.dataset.letter, hit = unchanged ? null : tradeAnswer(puzzle(), ids, positions);
  busy = true;
  setTimeout(() => {
    if (!hit) return nope(unchanged ? null : { ids, positions });
    checkSwap(puzzle(), state(), ids, positions);
    finishRecord(puzzle(), record(), saved.completionDays);
    persist(); updateStats();
    solve(hit, hit.ids[0] === ids[0] ? [wa, wb] : [wb, wa]);
  }, 380);
}
function nope(wrong) {
  clack('nope', .7);
  slots.forEach(slot => slot.querySelector('.word')?.animate([{ rotate: '0deg' }, { rotate: '-2.5deg' }, { rotate: '2deg' }, { rotate: '-1deg' }, { rotate: '0deg' }], { duration: 460 }));
  setTimeout(() => {
    const [a, b] = lastSwap; flip([a, b], () => domSwap(a, b)); clack('place', .5); busy = false;
    if (!wrong) return say(['Those letters match.']);
    // A wrong trade is free. Its clue counts as a reveal, and only once per trade.
    const clued = state().guesses.includes(guessKey(wrong.ids, wrong.positions));
    lastWrong = clued ? null : wrong;
    say(clued ? ['Not an answer.'] : ['Not an answer.', revealPill()]);
  }, 1000);
}
function showClue() {
  if (!lastWrong || busy) return;
  const { ids, positions } = lastWrong; lastWrong = null;
  const result = checkSwap(puzzle(), state(), ids, positions);
  paintFeedback(); persist(); updateStats(); clack('place', .6);
  if (!RM) result.feedback?.forEach((f, i) => document.querySelector(`.tile[data-card="${f.id}"][data-index="${f.index}"]`)?.animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(85deg)' }, { transform: 'rotateX(0deg)' }], { duration: 380, delay: i * 90 }));
  say([CLUE_KEY]);
}
function solve(hit, [first, second]) {
  chime(); first.classList.add('solved'); second.classList.add('solved');
  for (const t of [...first.children, ...second.children]) delete t.dataset.status;
  setTimeout(() => {
    const tiles = [...first.children, ...second.children], merged = document.createElement('div');
    merged.className = 'word merged solved';
    const n = hit.label.length, gap = 4, size = Math.min(50, Math.floor((mat.clientWidth - 30 - gap * (n - 1)) / n));
    merged.style.setProperty('--s', `${size}px`); merged.style.setProperty('--gap', `${gap}px`);
    mat.style.minHeight = `${mat.offsetHeight}px`;
    for (const w of [first, second]) { markHome(w, false); homeOf.get(w).classList.add('done'); }
    flip(tiles, () => {
      merged.append(...first.children); if (hit.label.includes(' ')) merged.append(makeGap()); merged.append(...second.children);
      mat.classList.add('merging'); mat.append(merged); first.remove(); second.remove(); syncSlots();
    }, { duration: RM ? 1 : 440 });
    clack('place', .8);
    setTimeout(() => flyToTray(merged, hit), RM ? 300 : 1000);
  }, RM ? 100 : 280);
}
// With three answers found, the last two words are the only pair left, so they move onto the mat by themselves.
function placeLastPair(delay = 0) {
  const r = record();
  if (r.startedAt === null || r.finishedAt !== null || state().solved.length !== puzzle().answers.length - 1) return;
  for (const w of homeOf.keys()) if (w.closest('.slot')) markHome(w, true);   // a word already on the mat loses its outline
  const waiting = [...homeOf.keys()].filter(w => !homeOf.get(w).classList.contains('done') && !w.closest('.slot'));
  waiting.forEach((w, i) => setTimeout(() => {
    if (busy || drag || !w.isConnected || w.closest('.slot')) return;
    placeWord(w);
  }, delay + i * 160));
}
// A found answer's definition goes on the line under the answers. Tapping any found answer shows its own.
function define(hit) {
  const label = document.createElement('b'); label.textContent = hit.label;
  clue.replaceChildren(label, hit.clue);
}
function defineFound(box) {
  const ids = box && state().solved[[...tray.children].indexOf(box)];
  if (ids) define(solvedAnswer(puzzle(), ids));
}
tray.addEventListener('click', e => defineFound(e.target.closest('.found.filled')));
tray.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); defineFound(e.target.closest('.found.filled')); } });
function flyToTray(merged, hit) {
  const box = tray.children[state().solved.length - 1];
  const a = merged.getBoundingClientRect(), b = box.getBoundingClientRect();
  const dx = b.left + b.width / 2 - a.left - a.width / 2;
  const dy = b.top + b.height / 2 - a.top - a.height / 2;
  const scale = Math.min(b.width / a.width, b.height / a.height, 1);
  const finish = () => {
    merged.remove(); mat.classList.remove('merging'); mat.style.minHeight = '';
    const answer = fillFound(box, hit.label, false);
    if (!RM) answer.animate([{ opacity: 0, scale: .85 }, { opacity: 1, scale: 1 }], { duration: 260, easing: 'ease-out' });
    busy = false; clack('place', .6);
    const done = record().finishedAt !== null;
    $('count').textContent = `${board + 1} / ${puzzles.length}${done ? ' ✓' : ''}`;
    define(hit); say();
    if (done) celebrate(); else placeLastPair(RM ? 0 : 450);
  };
  if (RM) { finish(); return; }
  merged.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0 }
  ], { duration: 480, easing: 'cubic-bezier(.55,0,.25,1)', fill: 'forwards' }).finished.then(finish, finish);
}


// ---------- hints, giving up, sharing ----------
function useHint() {
  if (busy) return;
  ensureStarted();
  const hint = revealHint(puzzle(), state()); if (!hint) return;
  paintFeedback(); persist(); updateStats(); clack('pick');
  const tile = document.querySelector(`.tile[data-card="${hint.id}"][data-index="${hint.index}"]`);
  if (tile && !RM) tile.animate([{ scale: 1 }, { scale: 1.25 }, { scale: 1 }], { duration: 480, easing: 'ease-out' });
  say([`Hint: swap the ${tile?.dataset.letter} in ${puzzle().cards.find(c => c.id === hint.id).word}.`]);
}
function giveUp() {
  $('give-up-dialog').close();
  if (busy || !giveUpRecord(puzzle(), record())) return;
  build();
  if (!RM) [...tray.querySelectorAll('.found.revealed')].forEach((box, i) => box.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: i * 90, easing: SPRING, fill: 'backwards' }));
}
function resultText() {
  const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('p', keys[board]);
  return shareText(puzzle(), record(), url.href, { relaxed });
}
async function shareResult(button) {
  const text = resultText();
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text); button.textContent = 'Copied!'; }
  catch { $('share-text').value = text; $('share-dialog').showModal(); $('share-text').select(); }
}
function celebrate() {
  if (RM) return;
  const canvas = document.createElement('canvas'), c2 = canvas.getContext('2d'), w = innerWidth, h = innerHeight, dpr = devicePixelRatio || 1;
  canvas.className = 'confetti'; canvas.setAttribute('aria-hidden', 'true'); canvas.width = w * dpr; canvas.height = h * dpr; c2.scale(dpr, dpr); document.body.append(canvas);
  const css = getComputedStyle(document.documentElement), colors = ['--accent', '--medium-bg', '--tile-mid', '--line'].map(v => css.getPropertyValue(v).trim());
  const bits = Array.from({ length: 150 }, (_, i) => ({ x: w * (.35 + Math.random() * .3), y: h * .45, vx: (Math.random() - .5) * 13, vy: -5 - Math.random() * 11, size: 6 + Math.random() * 6, angle: Math.random() * 6, spin: (Math.random() - .5) * .3, color: colors[i % colors.length] }));
  const start = performance.now(), length = 1900;
  requestAnimationFrame(function frame(now) {
    const t = now - start; c2.clearRect(0, 0, w, h); c2.globalAlpha = Math.max(0, 1 - Math.max(0, t - 900) / (length - 900));
    for (const b of bits) {
      b.vy += .35; b.vx *= .985; b.x += b.vx; b.y += b.vy; b.angle += b.spin;
      c2.save(); c2.translate(b.x, b.y); c2.rotate(b.angle); c2.fillStyle = b.color; c2.fillRect(-b.size / 2, -b.size / 3, b.size, b.size * .66); c2.restore();
    }
    if (t < length) requestAnimationFrame(frame); else canvas.remove();
  });
}

// ---------- taps: a word on the table hops onto the mat ----------
function tap({ word, onMat }) { if (!onMat) placeWord(word); }
// Keyboard players pick one letter, then another, to trade them.
function pickLetter(tile) {
  if (!picked) { picked = tile; tile.classList.add('picked'); clack('pick'); return; }
  const a = picked; a.classList.remove('picked'); picked = null;
  if (a === tile) return;
  if (a.parentNode === tile.parentNode) { picked = tile; tile.classList.add('picked'); clack('pick'); return; }
  if (wordOn(0) && wordOn(1)) trade(a, tile);
}

// ---------- dragging: words on the table, single letters on the mat ----------
document.addEventListener('pointerdown', e => {
  const tile = e.target.closest('.shelf .tile, .slot .tile');
  if (!tile || busy || press || e.button > 0) return;
  e.preventDefault();
  press = { id: e.pointerId, tile, word: tile.closest('.word'), onMat: !!tile.closest('.slot'), x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
});
document.addEventListener('pointermove', e => {
  if (!press || e.pointerId !== press.id) return;
  press.x = e.clientX; press.y = e.clientY;
  if (!drag) {
    if (Math.hypot(press.x - press.x0, press.y - press.y0) < 6) return;
    if (picked) { picked.classList.remove('picked'); picked = null; }
    ensureStarted();
    drag = { el: press.onMat ? press.tile : press.word, mode: press.onMat ? 'tile' : 'word', ox: 0, oy: 0, rot: 0, k: press.onMat ? 1.14 : 1.05, vx: 0, lastX: press.x, target: null };
    if (press.onMat) {
      // The gap this letter leaves, and where the other word's letters sit before any preview moves them.
      drag.gap = press.tile.getBoundingClientRect();
      const other = wordOn(1 - +press.word.dataset.col);
      drag.spots = other ? [...other.children].map(t => ({ t, r: t.getBoundingClientRect() })) : [];
    }
    drag.el.classList.add('lifted'); clack('pick'); requestAnimationFrame(frame);
  }
  drag.vx += e.clientX - drag.lastX; drag.lastX = e.clientX;
  aim();
});
function frame() {
  if (!drag || !press) return;
  drag.vx *= .78; drag.rot += (Math.max(-14, Math.min(14, drag.vx * 1.6)) - drag.rot) * .25;
  drag.ox = press.x - press.x0; drag.oy = press.y - press.y0;
  drag.el.style.transform = `translate(${drag.ox}px,${drag.oy}px) scale(${drag.k}) rotate(${drag.rot}deg)`;
  if (theme() === 'lamp') { const [dx, dy] = lampOffset(press.x, press.y, 44); drag.el.style.setProperty('--lsx-px', `${dx.toFixed(1)}px`); drag.el.style.setProperty('--lsy-px', `${(dy + 10).toFixed(1)}px`); }
  requestAnimationFrame(frame);
}
function aim() {
  const matRect = mat.getBoundingClientRect();
  if (drag.mode === 'tile' && !inside(matRect, press.x, press.y, TEAR)) {
    // Pulled well past the mat's edge: the whole word comes along, ready to go back to the table.
    preview(null);
    drag.el.style.transform = ''; drag.el.classList.remove('lifted');
    drag.el = press.word; drag.mode = 'word'; drag.k = 1.05; drag.fromMat = true;
    drag.el.classList.add('lifted'); clack('pick');
  }
  if (drag.mode === 'word') {
    const over = inside(matRect, press.x, press.y, 16);
    mat.classList.toggle('ready', over && !drag.fromMat);
    const bumped = drag.fromMat ? null : wordOn(+drag.el.dataset.col);
    if (bumped && bumped !== drag.el) { bumped.classList.toggle('leaving', over); drag.leaving = bumped; }
    return;
  }
  // Nearest letter of the other word, judged by where its letters started, with no dead zones between them.
  let best = null, bestD = Infinity;
  for (const { t, r } of drag.spots) {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (Math.abs(press.y - cy) > r.height * .9 || Math.abs(press.x - cx) > r.width * .85) continue;
    const d = Math.hypot(press.x - cx, press.y - cy); if (d < bestD) { best = { t, cx, cy }; bestD = d; }
  }
  preview(best);
}
// Shows the trade before it happens: the hovered letter slides into the gap the dragged letter left.
function preview(spot) {
  const target = spot?.t ?? null;
  if (target === drag.target) return;
  if (drag.target) { drag.target.style.translate = ''; drag.target.classList.remove('target'); }
  drag.target = target;
  if (!target) return;
  target.classList.add('target');
  target.style.translate = `${drag.gap.left + drag.gap.width / 2 - spot.cx}px ${drag.gap.top + drag.gap.height / 2 - spot.cy}px`;
  clack('pick', .6);
}
function finish(e, cancelled) {
  if (!press || e.pointerId !== press.id) return;
  const p = press; press = null;
  if (!drag) { if (!cancelled) tap(p); return; }
  const d = drag; mat.classList.remove('ready'); d.leaving?.classList.remove('leaving');
  if (cancelled || d.mode !== 'tile') preview(null);
  drag = null; d.target?.classList.remove('target');
  if (cancelled) return snapBack(d);
  if (d.mode === 'word') {
    const onMat = inside(mat.getBoundingClientRect(), p.x, p.y, 16);
    if (d.fromMat) return onMat ? snapBack(d) : sendHome(d.el, d);
    return onMat ? placeWord(d.el, d) : snapBack(d);
  }
  return d.target ? trade(d.el, d.target, d) : snapBack(d);
}
document.addEventListener('pointerup', e => finish(e, false));
document.addEventListener('pointercancel', e => finish(e, true));
document.addEventListener('keydown', e => {
  const tile = e.target.closest?.('.shelf .tile, .slot .tile');
  if (!tile || busy) return;
  const word = tile.closest('.word'), onMat = !!tile.closest('.slot');
  if (onMat && (e.key === 'Escape' || e.key === 'Backspace')) { e.preventDefault(); return sendHome(word); }
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault(); return onMat ? pickLetter(tile) : placeWord(word);
});

// ---------- header buttons, dialogs, and the page lifecycle ----------
// ---------- tables: the picker, and Lamplight's shadows ----------
const THEMES = [['oak', 'Kitchen table'], ['linen', 'Linen & cork'], ['lamp', 'Lamplight'], ['felt', 'Card table'], ['light', 'Light'], ['dark', 'Dark']];
const THEME_COLOR = { oak: '#c68b49', linen: '#e6dfd2', lamp: '#241710', felt: '#1c5a40', light: '#dfe4ee', dark: '#121827' };
const systemTheme = () => matchMedia('(prefers-color-scheme: dark)').matches ? 'lamp' : 'oak';
const theme = () => document.documentElement.dataset.theme;
function applyTheme(id, save = false) {
  document.documentElement.dataset.theme = id;
  if (save) try { localStorage.setItem('spoondle-theme', id); } catch {}
  document.querySelector('meta[name="theme-color"]').content = THEME_COLOR[id];
  for (const b of $('swatches').children) b.setAttribute('aria-pressed', String(b.dataset.pick === id));
  // Tables differ in padding and answer-sheet height, so size the tiles again for this one.
  if (shelf.childElementCount) { sizeTiles(); pileUp(); }
  relight();
}
function buildPicker() {
  $('theme').innerHTML = TABLE;
  $('swatches').replaceChildren(...THEMES.map(([id, name]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'swatch'; b.dataset.pick = id;
    const art = document.createElement('span'); art.className = 'swatch-art'; art.dataset.theme = id;
    const mat = document.createElement('span'); mat.className = 'swatch-mat';
    art.append(mat, makeTile('S')); b.append(art, name);
    b.addEventListener('click', () => { applyTheme(id, true); clack('place', .6); });
    return b;
  }));
}
// Lamplight: each tile's shadow falls away from the lamp hanging over the mat.
let relightTimer = 0;
function relight() { clearTimeout(relightTimer); relightTimer = setTimeout(lightTiles, RM ? 0 : 420); }
function lampOffset(x, y, reach, longest = Infinity) {
  const m = mat.getBoundingClientRect(), span = Math.max(innerWidth, innerHeight, 600) * .5;
  const dx = (x - (m.left + m.width / 2)) / span * reach, dy = (y - (m.top + m.height * .45)) / span * reach;
  const length = Math.hypot(dx, dy), shrink = Math.min(1, longest / (length || 1));
  return [dx * shrink, dy * shrink, length];   // the length before the cap still says which tile is farther
}
function lightTiles() {
  const tiles = document.querySelectorAll('.shelf .tile, .slot .tile');
  if (theme() !== 'lamp') { for (const t of tiles) for (const v of ['--tsx-px', '--tsy-px', '--tz']) t.style.removeProperty(v); return; }
  const words = new Map();
  for (const t of tiles) {
    const r = t.getBoundingClientRect(), [dx, dy, far] = lampOffset(r.left + r.width / 2, r.top + r.height / 2, 16, 12);
    t.style.setProperty('--tsx-px', `${dx.toFixed(1)}px`); t.style.setProperty('--tsy-px', `${(dy + 2).toFixed(1)}px`);
    if (!words.has(t.parentNode)) words.set(t.parentNode, []);
    words.get(t.parentNode).push([far, t]);
  }
  // Each shadow falls away from the lamp, so within a word the tile farther from the lamp sits on top:
  // a neighbor's shadow tucks under it instead of smudging its face.
  for (const list of words.values()) list.sort((a, b) => a[0] - b[0]).forEach(([, t], i) => t.style.setProperty('--tz', i + 1));
}
$('theme').addEventListener('click', () => $('theme-dialog').showModal());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  let chosen = null; try { chosen = localStorage.getItem('spoondle-theme'); } catch {}
  if (!chosen) applyTheme(systemTheme());
});
addEventListener('resize', () => { sizeTiles(); relight(); pileUp(); });
$('relax').addEventListener('click', () => {
  relaxed = !relaxed; try { localStorage.setItem('spoondle-relax', relaxed ? 'on' : 'off'); } catch {}
  showRelax(); clack('pick', .6);
  if (record().finishedAt === null) say([relaxed ? 'Relax mode: no timer.' : 'Timer on.']); else say();
});
$('sound').addEventListener('click', () => { soundOn = !soundOn; try { localStorage.setItem('spoondle-sound', soundOn ? 'on' : 'off'); } catch {} showSound(); if (soundOn) clack('place'); });
function openHelp() { $('help-dialog').showModal(); refreshClocks(); startDemo(true); cycleModes(true); }
// How to play: the timer line flips between the two modes, as the header button does.
let modeTimer = 0;
function cycleModes(on) {
  clearInterval(modeTimer); if (!on) return;
  const box = $('mode-demo'), btn = box.firstElementChild, words = box.lastElementChild;
  const modes = [[STOPWATCH, 'Be competitive with timer mode.'], [TEACUP, 'Take your time with relax mode.']];
  let k = 0; btn.innerHTML = modes[0][0]; words.textContent = modes[0][1];
  modeTimer = setInterval(async () => {
    k ^= 1;
    if (!RM) await Promise.all([btn.animate([{ transform: 'rotateY(0)' }, { transform: 'rotateY(90deg)' }], { duration: 170, easing: 'ease-in' }).finished,
      words.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 170 }).finished]).catch(() => {});
    btn.innerHTML = modes[k][0]; words.textContent = modes[k][1];
    if (!RM) { btn.animate([{ transform: 'rotateY(-90deg)' }, { transform: 'rotateY(0)' }], { duration: 200, easing: 'ease-out' }); words.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 }); }
  }, 2800);
}
$('help').addEventListener('click', openHelp);
$('help-dialog').addEventListener('close', () => { demoRun++; cycleModes(false); try { localStorage.setItem('spoondle-help-seen-v2', '1'); } catch {} refreshClocks(); });
// How to play: three example cards, flipped with a swipe or the arrows.
const examples = $('example-track');
const exampleShown = () => Math.round(examples.scrollLeft / (examples.clientWidth || 1));
function flipExample(step) { examples.scrollTo({ left: (exampleShown() + step) * examples.clientWidth, behavior: RM ? 'auto' : 'smooth' }); }
let demoTimer = 0;
examples.addEventListener('scroll', () => {
  const i = exampleShown(); $('example-prev').disabled = i === 0; $('example-next').disabled = i === examples.children.length - 1;
  clearTimeout(demoTimer); demoTimer = setTimeout(startDemo, 160);   // once the card settles, play it from the top
}, { passive: true });

// Each example card plays its examples on a little mat, in the table's own tiles: the two words,
// the trade, then the answer (read backwards when it is). The written examples are the script.
let demoRun = 0;
const demoPause = ms => new Promise(r => setTimeout(r, ms));
function demoScript(card) {
  return [...card.querySelectorAll('.ex')].map(ex => {
    const [a, b] = ex.firstElementChild.innerHTML.split(' + ').map(w => ({ word: w.replace(/<[^>]+>/g, ''), at: w.indexOf('<b>') }));
    return { a, b, answer: ex.querySelector('strong').textContent, backwards: ex.classList.contains('backwards') };
  });
}
function demoWords(card, { a, b, answer }) {
  const stage = card.querySelector('.demo');
  const s = Math.max(20, Math.min(34, Math.floor((stage.clientWidth - 24 - 3 * answer.length) / (answer.length + 1))));
  const row = word => { const w = document.createElement('div'); w.className = 'word'; w.style.cssText = `--s:${s}px;--gap:3px`; for (const ch of word) w.append(makeTile(ch)); return w; };
  const rows = [row(a.word), row(b.word)];
  stage.replaceChildren(...rows); card.querySelector('.demo-note').textContent = '';
  return { stage, rows, s };
}
function demoMove(tiles, mutate, duration, lift = 0) {
  const before = tiles.map(t => t.getBoundingClientRect());
  mutate();
  return Promise.all(tiles.map((t, i) => {
    const n = t.getBoundingClientRect(), dx = before[i].left - n.left, dy = before[i].top - n.top;
    const mid = lift ? [{ transform: `translate(${dx / 2}px,${dy / 2 - lift}px) scale(1.1)`, offset: .5 }] : [];
    return t.animate([{ transform: `translate(${dx}px,${dy}px)` }, ...mid, { transform: 'none' }], { duration, easing: RM ? 'ease-out' : 'cubic-bezier(.3,.7,.3,1)' }).finished.catch(() => {});
  }));
}
async function playDemo(card, run) {
  const alive = () => run === demoRun && $('help-dialog').open, script = demoScript(card);
  for (let k = 0; alive(); k = (k + 1) % script.length) {
    const ex = script[k], { stage, rows: [top, bottom], s } = demoWords(card, ex);
    stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350 });
    await demoPause(1500); if (!alive()) return;   // time to read the two words
    // Lit like a clue first: the two letters that trade go amber (swappy), the rest go gray (sticky).
    const x = top.children[ex.a.at], y = bottom.children[ex.b.at], all = [...top.children, ...bottom.children];
    for (const t of all) t.dataset.status = t === x || t === y ? 'swap' : 'stay';
    for (const t of [x, y]) t.animate([{ scale: 1 }, { scale: 1.14 }, { scale: 1 }], { duration: 500, easing: 'ease-out' });
    await demoPause(1000); if (!alive()) return;
    await demoMove([x, y], () => { const m = document.createComment(''); x.replaceWith(m); y.replaceWith(x); m.replaceWith(y); }, 850, s * .5);
    for (const t of all) delete t.dataset.status;
    top.classList.add('solved'); bottom.classList.add('solved');
    await demoPause(1000); if (!alive()) return;
    const [first, second] = ex.backwards ? [bottom, top] : [top, bottom], tiles = [...first.children, ...second.children];
    const answer = document.createElement('div'); answer.className = 'word solved'; answer.style.cssText = top.style.cssText;
    await demoMove(tiles, () => { answer.append(...first.children); if (ex.answer.includes(' ')) answer.append(makeGap()); answer.append(...second.children); stage.replaceChildren(answer); }, 850);
    if (ex.backwards) { const tag = document.createElement('span'); tag.textContent = 'Backwards!'; card.querySelector('.demo-note').replaceChildren(tag); }
    await demoPause(3000); if (!alive()) return;   // and time to read the answer
    await stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: 'forwards' }).finished.catch(() => {});
    stage.getAnimations().forEach(a => a.cancel());
  }
}
function startDemo(fresh = false) {
  const run = ++demoRun;
  // Every card shows its first two words right away, so a card never slides in empty.
  if (fresh) for (const card of examples.children) demoWords(card, demoScript(card)[0]);
  playDemo(examples.children[exampleShown()], run);
}
$('example-prev').addEventListener('click', () => flipExample(-1));
$('example-next').addEventListener('click', () => flipExample(1));
$('start').addEventListener('click', startPuzzle);
$('hint').addEventListener('click', useHint);
$('give-up').addEventListener('click', () => { if (!busy) $('give-up-dialog').showModal(); });
$('confirm-give-up').addEventListener('click', giveUp);
$('prev').addEventListener('click', () => goTo(board - 1));
$('next').addEventListener('click', () => goTo(board + 1));
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
// A click or tap outside a dialog (on the dimmed page behind it) closes it.
for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', e => {
  if (e.target !== d) return;
  const r = d.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
});
document.addEventListener('visibilitychange', refreshClocks);
window.addEventListener('pagehide', () => { pauseRecord(record()); persist(); });
window.addEventListener('pageshow', e => { if (e.persisted) refreshClocks(); });
// Another tab saved progress: take it, without saving back, so two open tabs don't echo each other.
window.addEventListener('storage', e => {
  if (e.key !== STORAGE_KEY || !e.newValue || busy || drag) return;
  try { saved = readProgress(localStorage); records = puzzles.map((p, i) => restoreRecord(p, saved.records[keys[i]])); build(false); } catch {}
});
setInterval(updateStats, 250);

let helpSeen = true; try { helpSeen = localStorage.getItem('spoondle-help-seen-v2') !== null; } catch {}
// First visit: the title card holds for a moment (a tap or key skips it), then How to play opens over it as it fades.
function welcome() {
  const splash = $('splash');
  return new Promise(done => {
    if (splash.hidden) { done(); return; }
    let left = false;
    const leave = () => {
      if (left) return;
      left = true; splash.classList.add('leaving'); done();
      setTimeout(() => splash.remove(), RM ? 0 : 450);
    };
    splash.addEventListener('pointerdown', leave);
    addEventListener('keydown', leave, { once: true });
    splash.querySelector('img').decode().then(() => {
      requestAnimationFrame(() => splash.classList.add('shown'));
      setTimeout(leave, RM ? 1400 : 2100);
    }, leave);
    setTimeout(() => { if (!splash.classList.contains('shown')) leave(); }, 2500);   // never wait long on a slow connection
  });
}
if (!helpSeen) welcome().then(openHelp);
buildPicker(); applyTheme(theme()); showSound(); showRelax(); build();
