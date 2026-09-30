// Copyright (c) 2026 Zack Abrams. All rights reserved. Not licensed for reuse; see LICENSE.
import { puzzles, tutorial } from './puzzles.mjs';
import { checkSwap, tradeAnswer, guessKey, solvedAnswer, hintTargets, revealHint, lightSwap } from './game.mjs';
import { LAUNCH, iso, today, addDays, daysBetween, dayOf, indexOfDay, shortDate, monthDay, monthTitle } from './schedule.mjs';
import { access } from './access.mjs';
import { browserTracker } from './track.mjs';
import { homeScreenKind, GUIDE, carryPayload } from './home.mjs';
import { summarize, TIME_BINS } from './stats.mjs';
import { localDay, freshRecord, STORAGE_KEY, puzzleKey, restoreRecord, readProgress, elapsedMs, formatTime, finishRecord, giveUpRecord, pauseRecord, resumeRecord, shareText } from './progress.mjs';

const $ = id => document.getElementById(id);
const shelf = $('shelf'), mat = $('mat'), tray = $('tray'), clue = $('clue'), message = $('message');
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
// With Reduce Motion on, tiles still slide (briefly, without the bounce) so a move stays readable; the big motion stays off.
const SPRING = RM ? 'ease-out' : 'cubic-bezier(.2,1.35,.45,1)', SNAP = RM ? 200 : 360;
// How far past the mat's edge a letter has to be pulled before its whole word comes along. Letters stop being trade targets
// at the mat's edge, so a short pull is enough; with the mat above the tiles, the message line sits between them, and a
// longer one meant reaching the tiles before the word came off.
const TEAR = 20;
const CLUE_KEY = 'Yellow: Swap this letter. Gray: Leave it.';

// ---------- saved progress ----------
let saved = { records: {}, completionDays: [], current: null };
try { saved = readProgress(localStorage); } catch {}
const keys = puzzles.map(puzzleKey);
let records = puzzles.map((p, i) => restoreRecord(p, saved.records[keys[i]]));
// Today's puzzle is the newest one out; later ones stay hidden until their day.
const latestNow = () => Math.max(0, Math.min(puzzles.length - 1, daysBetween(LAUNCH, today())));
let latest = latestNow();
// Open on today's puzzle, or on an earlier one named in the link (?p=).
const requested = keys.indexOf(new URL(location.href).searchParams.get('p'));
let board = requested >= 0 && requested <= latest ? requested : latest;
// While the practice puzzle is up, it stands in for today's (see startPractice).
let practice = null;
// Anonymous play counts (see track.mjs): nothing is saved on the device, and nothing is sent off spoondle.app or under Do Not Track.
const { track } = browserTracker();
const puzzle = () => practice ? practice.puzzle : puzzles[board], record = () => practice ? practice.record : records[board], state = () => record().state;
function persist() {
  saved.current = keys[board]; records.forEach((r, i) => { saved.records[keys[i]] = r; });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch {}
}

// ---------- start each puzzle deliberately; pause its clock when it is not visible ----------
// The rotate card's message, spelled out in tiles on a mat: a left-column word over a right-column word, like a real pair.
// The tiles can be picked up like any other: drop one on another and they trade places, or let go anywhere else and it settles back.
function buildRotate() {
  const row = (words, col) => { const w = document.createElement('div'); w.className = 'word'; words.forEach((word, i) => { if (i) w.append(makeGap()); [...word].forEach((ch, j) => { const t = makeTile(ch); t.dataset.col = col; t.style.setProperty('--r', `${((j * 7 + i * 3 + col * 5) % 5 - 2) * .9}deg`); w.append(t); }); }); return w; };
  $('rotate-mat').replaceChildren(row(['TURN', 'YOUR'], 0), row(['PHONE', 'UPRIGHT'], 1));
}
buildRotate();
{
  const area = $('rotate-mat');
  let grab = null;
  const under = (x, y, except) => document.elementsFromPoint(x, y).find(el => el !== except && el.classList.contains('tile') && area.contains(el));
  const settle = (el, from) => el.animate([{ transform: from }, { transform: 'none' }], { duration: SNAP, easing: SPRING }).finished.then(() => el.classList.remove('lifted')).catch(() => {});
  area.addEventListener('pointerdown', e => {
    const tile = e.target.closest('.tile');
    if (!tile || grab || e.button > 0) return;
    e.preventDefault(); tile.setPointerCapture(e.pointerId);
    grab = { tile, id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, over: null };
    tile.getAnimations().forEach(a => a.cancel()); tile.classList.add('lifted'); tile.style.transform = 'scale(1.12)'; clack('pick');
  });
  area.addEventListener('pointermove', e => {
    if (!grab || e.pointerId !== grab.id) return;
    grab.dx = e.clientX - grab.x0; grab.dy = e.clientY - grab.y0;
    grab.tile.style.transform = `translate(${grab.dx}px,${grab.dy}px) scale(1.12) rotate(${Math.max(-6, Math.min(6, grab.dx / 12))}deg)`;
    const over = under(e.clientX, e.clientY, grab.tile) ?? null;
    if (over !== grab.over) { grab.over?.classList.remove('previewed'); over?.classList.add('previewed'); grab.over = over; }
  });
  const drop = e => {
    if (!grab || e.pointerId !== grab.id) return;
    const { tile, over, dx, dy } = grab; grab = null;
    over?.classList.remove('previewed');
    const from = `translate(${dx}px,${dy}px) scale(1.12)`, was = tile.getBoundingClientRect();
    tile.style.transform = '';
    if (over) {
      const overWas = over.getBoundingClientRect();
      domSwap(tile, over);
      const now = tile.getBoundingClientRect(), there = over.getBoundingClientRect();
      // Each tile glides from where it was seen to its new spot; the one in hand starts from under the finger.
      settle(tile, `translate(${was.left - now.left}px,${was.top - now.top}px) scale(1.12)`);
      over.animate([{ transform: `translate(${overWas.left - there.left}px,${overWas.top - there.top}px)` }, { transform: 'none' }], { duration: SNAP, easing: SPRING });
    } else settle(tile, from);
    clack('place', .5);
  };
  area.addEventListener('pointerup', drop); area.addEventListener('pointercancel', drop);
}
const sideways = matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)');
sideways.addEventListener('change', () => { document.querySelector('.app').inert = sideways.matches; if (!sideways.matches) buildRotate(); refreshClocks(); });
document.querySelector('.app').inert = sideways.matches;
const PAUSING = ['help-dialog', 'theme-dialog', 'archive-dialog', 'stats-dialog'];
function syncClocks() {
  // The clock waits while How to play, Settings, Archive or Statistics covers the puzzle.
  const showing = !document.hidden && !PAUSING.some(id => $(id).open) && !sideways.matches;
  if (practice) { records.forEach(r => pauseRecord(r)); if (showing) resumeRecord(practice.record); else pauseRecord(practice.record); return; }
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
  record().startedAt = Date.now(); track('start', { p: board + 1 });
  unpile(); showStartGate(); refreshClocks(); focusNext(true);   // the Start button is going away
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
}
function ensureStarted() { if (record().startedAt === null) startPuzzle(); }
function updateStats() {
  const s = state(), plural = (n, word) => `${n} ${word}${n === 1 ? '' : word.endsWith('s') ? 'es' : 's'}`;
  $('timer').textContent = formatTime(elapsedMs(record()));
  // Hints and peeks are counted above the answers; peeks are stored as `misses` (their first name).
  for (const [id, n, word] of [['use-hints', s.hints, 'hint'], ['use-reveals', s.misses, 'peek']]) {
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
const FLIP = icon('<path d="M8 4v15M4.5 7.5 8 4l3.5 3.5M16 20V5M12.5 16.5 16 20l3.5-3.5"/>');
// Relax mode's button shows the mode you're in: a stopwatch while timed, a teacup while relaxed.
const STOPWATCH = icon('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M10 2.5h4M12 2.5V6M18.2 6.8l1.4-1.4"/>');
const TEACUP = icon('<path d="M4 10h12.5v3a6 6 0 0 1-6 6h-.5a6 6 0 0 1-6-6z"/><path d="M16.5 11.2h1.3a2.6 2.6 0 0 1 0 5.2h-1.9"/><path d="M8 3.2c-.9 1.1.9 2.1 0 3.3M12 3.2c-.9 1.1.9 2.1 0 3.3"/><path d="M3 21.5h15"/>');
let relaxed = false;
try { relaxed = localStorage.getItem('spoondle-relax') === 'on'; } catch {}
function showRelax() {
  const b = $('relax'); b.innerHTML = relaxed ? TEACUP : STOPWATCH; b.setAttribute('aria-pressed', String(relaxed));
  b.setAttribute('aria-label', relaxed ? 'Game mode: relax. Switch to timer mode' : 'Game mode: timer. Switch to relax mode'); b.title = relaxed ? 'Relax mode' : 'Timer mode';
  document.documentElement.classList.toggle('relaxed', relaxed);
  $('relax-note').textContent = relaxed ? 'Relax mode: no clock, take your time' : 'Timer mode: The clock runs while you play';
}
const SPEAKER_ON = icon('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>');
const SPEAKER_OFF = icon('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9.5l4 5M21 9.5l-4 5"/>');
const GEAR = icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>');
const TABLE = icon('<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>');
// Mat position: above the tile trays (the default) or below them. Above, the instruction line sits between the mat and the trays.
// The page is reordered (not just restyled) so the Tab order and a screen reader follow what is on screen. It applies to the
// stacked layout; where the mat sits between two columns of tiles (wide windows) or beside them (sideways), it has no effect.
const MAT_BELOW = icon('<rect x="3.5" y="4" width="4.5" height="4.5" rx="1"/><rect x="9.75" y="4" width="4.5" height="4.5" rx="1"/><rect x="16" y="4" width="4.5" height="4.5" rx="1"/><rect x="3.5" y="12.5" width="17" height="7.5" rx="2"/>');
const MAT_ABOVE = icon('<rect x="3.5" y="4" width="17" height="7.5" rx="2"/><rect x="3.5" y="15.5" width="4.5" height="4.5" rx="1"/><rect x="9.75" y="15.5" width="4.5" height="4.5" rx="1"/><rect x="16" y="15.5" width="4.5" height="4.5" rx="1"/>');
let matTop = true;
try { matTop = localStorage.getItem('spoondle-mat') !== 'below'; } catch {}
// Where the mat sits between or beside the tile columns (wide windows, a phone turned sideways) the Mat position setting does not exist,
// and the timer, Hint and Give up bar keeps its own place under the game. Same test as the CSS.
const sideBySide = matchMedia('(min-width:1000px) and (min-height:600px), (orientation:landscape) and (max-height:500px)');
const matSettingShown = () => !sideBySide.matches;
// In the stacked layout the bar follows the last block on screen (the line under the mat, or the tile trays) instead of sitting at the
// bottom of the screen, so Hint is a short reach away. It is moved in the page, not just restyled, so Tab and screen-reader order match.
function placeParts() {
  const side = document.querySelector('.side'), bar = document.querySelector('.bottom');
  if (matTop) shelf.before(side); else shelf.after(side);
  if (sideBySide.matches) $('play-area').after(bar); else (matTop ? shelf : side).after(bar);
}
sideBySide.addEventListener('change', () => { placeParts(); if (shelf.childElementCount) { sizeTiles(); pileUp(); } });
function showMat() {
  const b = $('matpos');
  placeParts();
  document.documentElement.classList.toggle('mat-top', matTop);
  b.innerHTML = matTop ? MAT_ABOVE : MAT_BELOW; b.setAttribute('aria-pressed', String(matTop));
  b.setAttribute('aria-label', matTop ? 'Mat position: above the tiles. Switch to below' : 'Mat position: below the tiles. Switch to above'); b.title = matTop ? 'Mat above the tiles' : 'Mat below the tiles';
  $('mat-note').textContent = matTop ? 'Above the tiles' : 'Below the tiles';
}
$('matpos').addEventListener('click', () => {
  matTop = !matTop; try { localStorage.setItem('spoondle-mat', matTop ? 'top' : 'below'); } catch {}
  showMat(); clack('pick', .6);
  if (shelf.childElementCount) { sizeTiles(); pileUp(); }
});
function showSound() { $('sound-note').textContent = soundOn ? 'Tiles click as you move them' : 'Off'; $('sound').innerHTML = soundOn ? SPEAKER_ON : SPEAKER_OFF; $('sound').setAttribute('aria-pressed', String(soundOn)); $('sound').setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off'); }
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
  if (card) { t.dataset.card = card; t.dataset.index = index; }
  return t;
}
function makeGap() { const g = document.createElement('div'); g.className = 'gap'; return g; }
function makeWord(card) {
  const w = document.createElement('div'); w.className = 'word'; w.dataset.col = card.column; w.dataset.id = card.id;
  [...card.word].forEach((ch, i) => { const t = makeTile(ch, card.id, i); t.dataset.col = card.column; t.style.setProperty('--r', `${(Math.random() * 4.4 - 2.2).toFixed(2)}deg`); w.append(t); });
  return w;
}
// Clues and hints color the original tiles: amber for a letter to swap, gray for one to leave.
function paintFeedback() {
  const feedback = state().feedback, solved = new Set(state().solved.flat());
  for (const t of document.querySelectorAll('.tile[data-card]')) {
    // A solved pair drops its hint and peek colors, so the answer glows evenly.
    const status = solved.has(t.dataset.card) ? null : feedback[t.dataset.card]?.[t.dataset.index];
    if (status) t.dataset.status = status; else delete t.dataset.status;
  }
  for (const word of homeOf.keys()) labelWord(word);
}
// ---------- assistive technology: a word is the unit, its letters are reached with the arrow keys ----------
// On the table a word is ONE button ("PARRY, spelled P A R R Y, left column"), so a screen reader (or the Tab key) meets 8 words
// rather than 37 loose letters. On the mat it becomes a group whose letters are buttons: one tab stop per word, arrows between
// letters, Enter or a tap to pick one, then a letter in the other word to trade. Sighted mouse and touch play is unchanged.
const SIDE = ['left', 'right'];
let usingKeyboard = false;
function labelWord(word) {
  const home = homeOf.get(word), tiles = [...word.children].filter(t => t.classList.contains('tile')), letters = tiles.map(t => t.dataset.letter);
  const clear = el => { el.removeAttribute('role'); el.removeAttribute('tabindex'); el.removeAttribute('aria-label'); el.removeAttribute('aria-pressed'); };
  if (!home || home.classList.contains('done')) { clear(word); tiles.forEach(clear); return; }
  const status = t => t.dataset.status === 'swap' ? ', swap this letter' : t.dataset.status === 'stay' ? ', leave this letter' : '';
  if (word.closest('.slot')) {
    // On the mat: a group of letter buttons, with one of them (the one last used, else the first) in the tab order.
    const current = tiles.find(t => t === document.activeElement) ?? tiles.find(t => t.getAttribute('tabindex') === '0') ?? tiles[0];
    word.setAttribute('role', 'group'); word.removeAttribute('tabindex'); word.setAttribute('aria-label', `${letters.join('')} on the mat`);
    tiles.forEach((t, i) => { t.setAttribute('role', 'button'); t.setAttribute('tabindex', t === current ? '0' : '-1'); t.setAttribute('aria-label', `${t.dataset.letter}, letter ${i + 1} of ${tiles.length}${status(t)}`); });
  } else {
    // On the table: one button. Its letters are presentational inside it, so what they show goes in the label.
    const notes = tiles.flatMap((t, i) => t.dataset.status ? [`${t.dataset.status === 'swap' ? 'swap' : 'leave'} letter ${i + 1}, ${t.dataset.letter}`] : []);
    word.setAttribute('role', 'button'); word.setAttribute('tabindex', '0');
    word.setAttribute('aria-label', `${letters.join('')}, spelled ${letters.join(' ')}, ${SIDE[word.dataset.col]} column${notes.length ? '. Hint: ' + notes.join(', ') : ''}`);
    tiles.forEach(clear);
  }
}
// Moving an element in the DOM drops keyboard focus, so put it back on what had it (or on its word's current letter).
function refocus(had) {
  if (!usingKeyboard || !had || had === document.body || !had.isConnected) return;
  const word = had.classList.contains('word') ? had : had.closest('.word');
  if (!word) return;
  const target = had.getAttribute('tabindex') === '0' ? had : word.closest('.slot') ? word.querySelector('.tile[tabindex="0"]') : word;
  if (target && document.activeElement !== target) target.focus({ preventScroll: true });
}
// After a solve or a start, keyboard focus lands on the next thing to play. It never takes focus from something the player has
// already moved to (the last pair moves onto the mat on a timer, and the player may be navigating by then).
function focusNext(force = false) {
  if (!usingKeyboard) return;
  const at = document.activeElement;
  if (!force && at && at !== document.body && at.isConnected) return;
  (document.querySelector('.slot .tile[tabindex="0"]') ?? document.querySelector('.shelf .word[role="button"]'))?.focus({ preventScroll: true });
}
function rove(tile) { for (const t of tile.parentNode.children) if (t.classList.contains('tile')) t.setAttribute('tabindex', t === tile ? '0' : '-1'); }
document.addEventListener('focusin', e => { if (e.target.matches?.('.slot .tile')) rove(e.target); });
document.addEventListener('pointerdown', () => { usingKeyboard = false; }, true);
// Answers are written the way you'd write them: names and titles capitalized, everything else lowercase.
// (Themes whose answers look like tiles or type set them in capitals anyway.)
const MINOR = new Set(['A', 'AN', 'AND', 'AT', 'FOR', 'IN', 'OF', 'ON', 'THE', 'TO']);
function written(label) {
  if (puzzle().category !== 'Proper nouns') return label.toLowerCase();
  return label.split(' ').map((w, i) => i && MINOR.has(w) ? w.toLowerCase() : w[0] + w.slice(1).toLowerCase()).join(' ');
}
function fillFound(box, label, revealed) {
  const answer = document.createElement('span'); answer.className = 'answer'; answer.style.setProperty('--n', label.length);
  // Each word in its own span, so Card table can show it as one tile.
  for (const word of written(label).split(' ')) {
    if (answer.childElementCount) { const sp = document.createElement('span'); sp.className = 'sp'; sp.textContent = ' '; answer.append(sp); }
    const w = document.createElement('span'); w.className = 'wd'; w.style.setProperty('--len', word.length);
    for (const ch of word) { const c = document.createElement('span'); c.className = 'ch'; c.textContent = ch; w.append(c); }
    answer.append(w);
  }
  box.classList.add('filled'); box.classList.toggle('revealed', revealed); box.setAttribute('role', 'button'); box.tabIndex = 0;
  box.setAttribute('aria-label', revealed ? `${label}, revealed` : label);
  box.replaceChildren(answer);
  return answer;
}
function build(save = true) {
  clearA2hs();
  const p = puzzle(), s = state(), solvedIds = new Set(s.solved.flat());
  busy = false; picked = null; lastSwap = null; lastWrong = null; homeOf.clear();
  syncClocks();
  $('category').textContent = p.category; $('level').hidden = !p.difficulty; $('level').textContent = p.difficulty ?? ''; $('level').dataset.level = (p.difficulty ?? '').toLowerCase();
  $('count').textContent = practice ? 'Practice' : `${monthDay(dayOf(board))}${record().finishedAt !== null && !s.revealed ? ' ✓' : ''}`;
  $('prev').disabled = !!practice || board === 0; $('next').disabled = !!practice || board >= latest;
  // Only an earlier puzzle goes in the link. Today's stays plain, so a reload, a restored tab or a home-screen
  // shortcut opens whatever is today's puzzle by then rather than the day it was first opened.
  if (!practice) { const url = new URL(location.href); if (board === latest) url.searchParams.delete('p'); else url.searchParams.set('p', keys[board]); history.replaceState(null, '', url); }
  shelf.replaceChildren(); tray.replaceChildren(); clue.replaceChildren(); mat.replaceChildren(); mat.className = 'mat'; mat.style.minHeight = '';
  delete shelf.dataset.dim;   // a new board starts with nothing on the mat, so no column is faded
  const columns = [0, 1].map(c => p.cards.filter(card => card.column === c));
  // Each column's words sit in their own shallow tray, so it's clear one word comes from each side.
  // The trays come first, so the words paint over them; every word keeps its row, so they share the trays' rows.
  for (const c of [1, 3]) { const bed = document.createElement('div'); bed.className = 'bed'; bed.style.gridArea = `1 / ${c} / span ${columns[0].length} / span 1`; shelf.append(bed); }
  for (let i = 0; i < columns[0].length; i++) for (const column of columns) {
    const home = document.createElement('div'); home.className = 'home'; home.dataset.col = column[i].column; home.style.gridRow = i + 1; home.style.setProperty('--n', column[i].word.length); const w = makeWord(column[i]);
    home.append(w); homeOf.set(w, home); shelf.append(home);
    if (solvedIds.has(w.dataset.id)) home.classList.add('done');
    // Tapping a word's empty spot on the table calls it back from the mat.
    home.addEventListener('click', () => { if (performance.now() - lastTap < 450) return; if (home.classList.contains('empty') && !busy && w.closest('.slot')) sendHome(w); });
    home.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === home && home.classList.contains('empty')) { e.preventDefault(); sendHome(w); } });
  }
  for (let i = 0; i < p.answers.length; i++) { const f = document.createElement('div'); f.className = 'found'; tray.append(f); }
  s.solved.forEach((ids, i) => fillFound(tray.children[i], solvedAnswer(p, ids).label, i >= s.solved.length - s.revealed));
  slots = [0, 1].map(() => { const slot = document.createElement('div'); slot.className = 'slot'; mat.append(slot); return slot; });
  const turn = document.createElement('button'); turn.type = 'button'; turn.className = 'mat-flip'; turn.setAttribute('aria-label', 'Swap which word is on top');
  turn.innerHTML = FLIP; turn.addEventListener('click', flipMat); mat.append(turn);
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
  const homeApp = document.documentElement.classList.contains('home-app');   // pushed down below iOS's status-bar blur, so the buttons can end up past the room
  const tooTall = () => {
    const bar = document.querySelector('.bottom').getBoundingClientRect(), table = shelf.getBoundingClientRect();
    const hitsBar = r => r.left < bar.right && bar.left < r.right && r.bottom > bar.top - 2;   // with a little air above the buttons
    return app.scrollHeight > app.clientHeight || (between && document.documentElement.scrollHeight > innerHeight) || table.bottom > area.getBoundingClientRect().bottom + .5 || (homeApp && bar.bottom > area.getBoundingClientRect().bottom + .5) || hitsBar(table) || hitsBar(message.getBoundingClientRect());
  };
  const [left, right] = [0, 1].map(c => Math.max(...cards.filter(card => card.column === c).map(card => card.word.length)));
  const longest = Math.max(left, right);
  // On a wide screen the mat sits inside the table's width, between the columns, so leave room for it.
  const t = shelf.getBoundingClientRect(), m = mat.getBoundingClientRect();
  const between = m.left > t.left && m.right < t.right && m.top < t.bottom && m.bottom > t.top;
  // A wide screen gets bigger tiles, growing with the window's height.
  const tall = Math.max(0, innerHeight - 800);
  mat.style.setProperty('--mat-s', `${Math.min(between ? Math.min(72, 60 + Math.floor(tall / 20)) : 50, Math.floor((mat.clientWidth - 30 - 6 * (longest - 1)) / longest))}px`);
  // The trays reach a little past their words, so leave enough over that they sit at least 9px from the screen's edge.
  const colGap = parseFloat(getComputedStyle(shelf).columnGap), reach = -parseFloat(getComputedStyle(shelf.querySelector('.bed')).marginLeft), gutter = parseFloat(getComputedStyle(app).paddingLeft);
  const spare = Math.max(8, 4 * (9 - gutter + reach));
  let size = between
    ? Math.floor(((shelf.clientWidth - m.width - 2 * parseFloat(getComputedStyle(shelf).columnGap)) / 2 - 3 * (longest - 1)) / longest)   // two equal sides around the mat
    : Math.floor((shelf.clientWidth - 2 * colGap - spare - 3 * (left + right - 2)) / (left + right));   // the aisles around the divider, and room for the trays to stay off the screen's edge
  size = Math.max(20, Math.min(between ? Math.min(66, 56 + Math.floor(tall / 25)) : 46, size));
  shelf.style.setProperty('--shelf-s', `${size}px`);
  const widest = size;
  while (size > 20 && tooTall()) shelf.style.setProperty('--shelf-s', `${size -= 2}px`);
  // With the mat between the trays, the mat can be what sets the row's height, and shrinking the trays' tiles then changes nothing.
  // So a still-too-tall window shrinks the mat (down to 28px), and the trays grow back into the room that frees.
  if (between && tooTall()) {
    let matSize = parseFloat(mat.style.getPropertyValue('--mat-s'));
    while (matSize > 28 && tooTall()) mat.style.setProperty('--mat-s', `${matSize -= 2}px`);
    while (size < widest) {
      shelf.style.setProperty('--shelf-s', `${size + 2}px`);
      if (tooTall()) { shelf.style.setProperty('--shelf-s', `${size}px`); break; }
      size += 2;
    }
  }
}
function goTo(index) {
  if (practice) endPractice();
  if (busy || index < 0 || index > latest) return;
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  const direction = Math.sign(index - board);
  board = index; build();
  // The new board slides in from the side you moved toward, like turning to the next page.
  if (!RM && direction) $('play-area').animate([{ transform: `translateX(${direction * 56}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
// When midnight passes with the page open, today's puzzle changes. A player who is between puzzles (finished, or
// not yet started) moves to the new one; someone mid-puzzle keeps theirs, and the next arrow now reaches it.
// Nothing is moved while a dialog, a drag or the tutorial is up; the next check (or the dialog closing) tries again.
function checkNewDay() {
  const fresh = latestNow();
  if (fresh === latest) return;
  const between = board === latest && (records[board].startedAt === null || records[board].finishedAt !== null);
  if (between && (practice || busy || drag || document.querySelector('dialog[open]'))) return;
  latest = fresh;
  if (between) goTo(fresh); else $('next').disabled = !!practice || board >= latest;
}
setInterval(checkNewDay, 5000);
for (const d of document.querySelectorAll('dialog')) d.addEventListener('close', checkNewDay);
for (const id of PAUSING.slice(1)) $(id).addEventListener('close', refreshClocks);
function nextUnfinished() {
  for (let step = 1; step <= latest; step++) { const i = (board + step) % (latest + 1); if (records[i].finishedAt === null) return i; }
  return -1;
}

// ---------- the line under the mat ----------
function pill(label, onClick, primary = false) {
  const b = document.createElement('button'); b.type = 'button'; b.className = primary ? 'pill primary' : 'pill'; b.textContent = label;
  b.addEventListener('click', () => onClick(b)); return b;
}
// Peek wears an eye, as Hint wears a lightbulb (the counters above the answers wear the same two).
const EYE = '<svg class="eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>';
// On a computer, pointing at Peek (or tabbing to it) outlines the two tiles it would color.
function revealPill() {
  const b = pill('Peek', showClue); b.classList.add('soft'); b.insertAdjacentHTML('afterbegin', EYE);
  const preview = on => { if (!lastWrong) return;
    lastWrong.ids.forEach((id, i) => document.querySelector(`.tile[data-card="${id}"][data-index="${lastWrong.positions[i]}"]`)?.classList.toggle('previewed', on)); };
  b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') preview(true); });
  b.addEventListener('pointerleave', () => preview(false));
  b.addEventListener('focus', () => { if (b.matches(':focus-visible')) preview(true); });
  b.addEventListener('blur', () => preview(false));
  return b;
}
// Words on the message line sit on the same soft highlight as a definition, so they read over any table.
function note(text, spoken = '') {
  const n = document.createElement('span'); n.className = 'note'; n.textContent = text;
  if (spoken) { const s = document.createElement('span'); s.className = 'sr-only'; s.textContent = spoken + ' '; n.prepend(s); }   // read aloud, not shown
  return n;
}
function say(parts = null) {
  clearA2hs();
  queueMicrotask(coachUpdate);
  const done = record().finishedAt !== null;
  for (const el of [shelf, mat]) { el.classList.toggle('finished', done); el.classList.toggle('given-up', done && state().revealed > 0); }
  document.querySelectorAll('.tile.previewed').forEach(t => t.classList.remove('previewed'));
  const p = puzzle(), r = record(), s = state();
  message.replaceChildren();
  $('actions').hidden = r.finishedAt !== null;
  // Once solved, the time shows in the solved line, so the bar with the clock steps aside to make room.
  document.querySelector('.bottom').hidden = r.finishedAt !== null;
  document.documentElement.classList.toggle('is-done', r.finishedAt !== null);   // on a wide screen the page re-centers without that bar
  $('hint').disabled = r.startedAt === null || !hintTargets(p, s).length;
  if (r.finishedAt !== null && practice) { message.append(note(s.revealed ? 'Answers shown' : 'Practice puzzle solved!')); return; }
  if (r.finishedAt !== null) {
    const next = nextUnfinished();
    // A daily game: once today's puzzle is done, share it, see how you're doing, or go back to an earlier day.
    const said = s.revealed ? 'Answers shown' : relaxed ? 'Solved!' : `Solved in ${formatTime(elapsedMs(r))}`;
    const done = note(said);
    // No periods on the line, so a dot sets the countdown apart (after "Solved!" the exclamation mark already does).
    const wait = document.createElement('span'); wait.className = 'countdown'; done.append(said.endsWith('!') ? ' ' : ' · ', wait);
    const share = pill('Share', shareResult, true);
    const stats = pill('Stats', openStats); stats.classList.add('soft'); stats.insertAdjacentHTML('afterbegin', CHART);
    const archive = pill('Archive', openArchive); archive.classList.add('soft'); archive.insertAdjacentHTML('afterbegin', CALENDAR);
    const row = document.createElement('span'); row.className = 'done-actions'; row.append(share, stats, archive);
    message.append(done, row);
    showCountdown(wait);   // once it's on the page, so the first count shows at once
    addToHomeNudge();
    return;
  }
  if (parts) { message.append(...parts.map(part => typeof part === 'string' ? note(part) : part)); return; }
  const n = slots.filter(slot => slot.querySelector('.word')).length;
  const onMat = slots.map(slot => slot.querySelector('.word')).filter(Boolean).map(text);
  const spoken = n === 1 ? `${onMat[0]} is on the mat.` : n === 2 ? `${onMat.join(' and ')} are on the mat.` : '';
  // Someone who has solved a daily puzzle knows the moves, so the line stays empty until it has news (a wrong trade, a Hint).
  // A screen reader still hears which words are on the mat.
  if (!practice && records.some(r => r.finishedAt !== null && r.state.revealed === 0)) {
    if (spoken) { const s = document.createElement('span'); s.className = 'sr-only'; s.textContent = spoken; message.replaceChildren(s); }
    return;
  }
  message.replaceChildren(note(n === 0 ? 'Put a word on the mat with a tap or drag' : n === 1 ? 'Now choose one from the other side' : 'Trade a letter by tapping two or dragging', spoken));
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
// The slot, top or bottom as the mat shows them now, nearest a point.
const slotAt = y => slots.reduce((best, slot) => { const r = slot.getBoundingClientRect(), d = Math.abs(y - (r.top + r.height / 2)); return d < best.d ? { slot, d } : best; }, { slot: null, d: Infinity }).slot;
const text = w => [...w.children].map(t => t.dataset.letter).join('');
function syncSlots() {
  slots.forEach(slot => slot.classList.toggle('full', !!slot.querySelector('.word')));
  mat.classList.toggle('pair', slots.every(slot => slot.querySelector('.word')));
  // With one word on the mat, its partner has to come from the other column, so the rest of this column fades back.
  const lone = slots.filter(slot => slot.querySelector('.word'));
  if (lone.length === 1) shelf.dataset.dim = slots.indexOf(lone[0]); else delete shelf.dataset.dim;
}
// The flip button swaps which word sits on top, to read the pair the other way round. Only the view changes.
function flipMat() {
  const tiles = slots.flatMap(slot => [...slot.querySelectorAll('.tile')]);
  flip(tiles, () => mat.classList.toggle('flipped')); clack('pick', .6);
  if (practice) { practice.flipped = true; coachUpdate(); }
}
// Once three answers are found, the last two words are the only pair left: they stay on the mat,
// with no outline to call them back to.
const lastPair = () => record().finishedAt === null && state().solved.length === puzzle().answers.length - 1;
function markHome(word, away) {
  const home = homeOf.get(word), empty = away && !lastPair(); home.classList.toggle('empty', empty);
  if (empty) { home.tabIndex = 0; home.setAttribute('role', 'button'); home.setAttribute('aria-label', `Put ${text(word)} back`); }
  else { home.removeAttribute('tabindex'); home.removeAttribute('role'); home.removeAttribute('aria-label'); }
  labelWord(word);
}

// ---------- the rules: words go to the mat; letters trade between the two words there ----------
// Each column keeps its own slot; a word dropped on the other slot turns the mat, so it lands where it was dropped.
function placeWord(word, lifted = null, at = null) {
  if (!coachAllowsWord(word)) { if (lifted) snapBack(lifted); return coachNudge(); }
  ensureStarted();
  const side = +word.dataset.col, old = wordOn(side), turn = !!at && at !== slots[side];
  if (old === word) { if (lifted) snapBack(lifted); return; }
  const had = document.activeElement;
  flip([word, old, turn && wordOn(1 - side)].filter(Boolean), () => {
    if (old) { homeOf.get(old).append(old); markHome(old, false); }
    slots[side].append(word); markHome(word, true); syncSlots();
    if (turn) mat.classList.toggle('flipped');
  }, { lifted });
  refocus(had);
  clack('place'); lastWrong = null; say();
}
function sendHome(word, lifted = null) {
  if (lastPair()) { if (lifted) snapBack(lifted); return; }
  if (picked) { picked.classList.remove('picked'); picked = null; }
  const had = document.activeElement;
  flip([word], () => { homeOf.get(word).append(word); markHome(word, false); syncSlots(); }, { lifted });
  refocus(had);
  clack('place', .8); lastWrong = null; say();
}
function trade(a, b, lifted = null) {
  if (!coachAllows(a, b)) { b.style.translate = ''; if (lifted) snapBack(lifted); return coachNudge(); }
  ensureStarted();
  const wa = a.parentNode, wb = b.parentNode;
  const ids = [wa.dataset.id, wb.dataset.id], positions = [+a.dataset.index, +b.dataset.index];
  const had = document.activeElement;
  flip([a, b], () => domSwap(a, b), { lifted });
  labelWord(wa); labelWord(wb); refocus(had);
  clack('place'); lastSwap = [a, b]; lastWrong = null;
  const unchanged = a.dataset.letter === b.dataset.letter, hit = unchanged ? null : tradeAnswer(puzzle(), ids, positions);
  busy = true;
  setTimeout(() => {
    if (!hit) return nope({ ids, positions, unchanged });
    checkSwap(puzzle(), state(), ids, positions);
    if (finishRecord(puzzle(), record(), practice ? [] : saved.completionDays)) { if (!practice) justSolved = board; track(practice ? 'tutorial_solved' : 'solve', practice ? {} : { p: board + 1, ms: elapsedMs(record()), h: state().hints, k: state().misses }); }
    persist(); updateStats();
    solve(hit, hit.ids[0] === ids[0] ? [wa, wb] : [wb, wa]);
  }, 380);
}
function nope(wrong) {
  clack('nope', .7);
  slots.forEach(slot => slot.querySelector('.word')?.animate([{ rotate: '0deg' }, { rotate: '-2.5deg' }, { rotate: '2deg' }, { rotate: '-1deg' }, { rotate: '0deg' }], { duration: 460 }));
  setTimeout(() => {
    const [a, b] = lastSwap, had = document.activeElement;
    flip([a, b], () => domSwap(a, b)); labelWord(a.parentNode); labelWord(b.parentNode); refocus(had); clack('place', .5); busy = false;
    // A wrong trade is free, even one of two matching letters. Its clue counts as a peek, and only once per trade.
    // Trading two matching letters needs no words: nothing changed on the mat.
    const clued = state().guesses.includes(guessKey(wrong.ids, wrong.positions));
    lastWrong = clued ? null : wrong;
    const parts = [...(wrong.unchanged ? [] : ['Not an answer']), ...(clued ? [] : [revealPill()])];
    say(parts.length ? parts : null);
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
    setTimeout(() => fuse(merged), RM ? 0 : 560);
    setTimeout(() => flyToTray(merged, hit), RM ? 300 : 1400);
  }, RM ? 100 : 280);
}
// Once the answer is spelled out, its letters close up and each word becomes one smooth tile.
function fuse(merged) {
  const tiles = [...merged.querySelectorAll('.tile')];
  if (RM) { merged.style.setProperty('--gap', '0px'); fuseLetters(merged); return; }
  flip(tiles, () => merged.style.setProperty('--gap', '0px'), { duration: 240 });
  setTimeout(() => fuseLetters(merged), 260);
}
// Swap a row of letter tiles (with a gap between words) for one word tile per word, with a little bounce.
function fuseLetters(row) {
  const words = [[]];
  for (const el of row.children) if (el.classList.contains('gap')) words.push(el, []); else words.at(-1).push(el.dataset.letter);
  row.replaceChildren(...words.map(w => Array.isArray(w) ? wordTile(w.join('')) : w));
  if (!RM) for (const w of row.querySelectorAll('.wordtile')) w.animate([{ scale: 1 }, { scale: 1.07 }, { scale: 1 }], { duration: 320, easing: 'ease-out' });
}
function wordTile(text) {
  const w = document.createElement('div'); w.className = 'wordtile';
  for (const ch of text) { const c = document.createElement('span'); c.textContent = ch; w.append(c); }
  return w;
}
// With three answers found, the last two words are the only pair left, so they move onto the mat by themselves.
function placeLastPair(delay = 0) {
  const r = record();
  if (r.startedAt === null || r.finishedAt !== null || state().solved.length !== puzzle().answers.length - 1) return;
  for (const w of homeOf.keys()) if (w.closest('.slot')) markHome(w, true);   // a word already on the mat loses its outline
  const waiting = [...homeOf.keys()].filter(w => !homeOf.get(w).classList.contains('done') && !w.closest('.slot'));
  // In the practice round the mat may still be turned from the flip step; WELD goes on top so the trade reads WELL DONE.
  const weld = practice && onTable('WELD');
  if (weld && waiting.includes(weld)) mat.classList.toggle('flipped', weld.dataset.col === '1');
  waiting.forEach((w, i) => setTimeout(() => {
    if (busy || drag || !w.isConnected || w.closest('.slot')) return;
    placeWord(w);
  }, delay + i * 160));
  if (waiting.length) setTimeout(focusNext, delay + waiting.length * 160 + 60);
}
// A found answer's definition goes on the line under the answers. Tapping any found answer shows its own.
function define(hit) {
  const label = document.createElement('b'); label.textContent = hit.label;
  const text = document.createElement('span'); text.append(label, hit.clue);
  clue.replaceChildren(text);
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
    if (!practice) $('count').textContent = `${monthDay(dayOf(board))}${done ? ' ✓' : ''}`;
    define(hit); say();
    if (done) { celebrate(); if (usingKeyboard) message.querySelector('.pill.primary')?.focus({ preventScroll: true }); } else { placeLastPair(RM ? 0 : 450); focusNext(); }
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
  // In the practice round, Hint waits for its own lesson, and that first hint always lights BUD's swap tile.
  if (practice && coach.step !== 'hint' && !COACH[coach.step]?.free) return coachNudge();
  const hint = coach.step === 'hint' ? lightSwap(puzzle(), state(), onTable('BUD').dataset.id) : revealHint(puzzle(), state()); if (!hint) return;
  paintFeedback(); persist(); updateStats(); clack('pick');
  const tile = document.querySelector(`.tile[data-card="${hint.id}"][data-index="${hint.index}"]`);
  if (tile && !RM) tile.animate([{ scale: 1 }, { scale: 1.25 }, { scale: 1 }], { duration: 480, easing: 'ease-out' });
  say([`The ${tile?.dataset.letter} in ${puzzle().cards.find(c => c.id === hint.id).word} wants to swap`]);
}
function giveUp() {
  $('give-up-dialog').close();
  if (busy || !giveUpRecord(puzzle(), record())) return;
  track('giveup', { p: board + 1, ms: elapsedMs(record()), h: state().hints, k: state().misses });
  build();
  if (!RM) [...tray.querySelectorAll('.found.revealed')].forEach((box, i) => box.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: i * 90, easing: SPRING, fill: 'backwards' }));
}
function resultText() {
  const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('p', keys[board]);
  return shareText(puzzle(), record(), url.href, { relaxed });
}
async function shareResult(button) {
  track('share', { p: board + 1 });
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
// A tap that moves a word off the table is followed by the browser's own click, aimed at whatever is under the finger by then,
// which can be the word's now-empty spot (that click means "put it back"). Clicks right after a tap are not meant.
let lastTap = 0;
function tap({ word, onMat, tile }) { lastTap = performance.now(); if (onMat) pickLetter(tile); else placeWord(word); }
// Trading without dragging (keys, a tap, a screen reader's activate): pick one letter, then a letter in the other word.
function unpick() { if (picked) { picked.classList.remove('picked'); picked.removeAttribute('aria-pressed'); picked = null; } }
function pick(tile) {
  unpick(); picked = tile; tile.classList.add('picked'); tile.setAttribute('aria-pressed', 'true'); clack('pick');
  const word = tile.closest('.word');
  // One short line on screen (a longer one wraps on small phones and shifts what is below it); the full sentence is for a screen reader.
  const line = note('Now tap a letter to trade with', `${tile.dataset.letter} in ${text(word)} picked.`);
  say(lastWrong ? [line, revealPill()] : [line]);   // a wrong trade's Peek stays on offer
}
function pickLetter(tile) {
  if (!picked) return pick(tile);
  const a = picked;
  if (a === tile) { unpick(); return say(lastWrong ? [revealPill()] : null); }
  if (a.parentNode === tile.parentNode) return pick(tile);
  unpick();
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
    const aimed = over && !drag.fromMat ? slotAt(press.y) : null;
    slots.forEach(slot => slot.classList.toggle('aim', slot === aimed));
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
  const d = drag; mat.classList.remove('ready'); slots.forEach(slot => slot.classList.remove('aim')); d.leaving?.classList.remove('leaving');
  if (cancelled || d.mode !== 'tile') preview(null);
  drag = null; d.target?.classList.remove('target');
  if (cancelled) return snapBack(d);
  if (d.mode === 'word') {
    const onMat = inside(mat.getBoundingClientRect(), p.x, p.y, 16);
    if (d.fromMat) return onMat ? snapBack(d) : sendHome(d.el, d);
    return onMat ? placeWord(d.el, d, slotAt(p.y)) : snapBack(d);
  }
  return d.target ? trade(d.el, d.target, d) : snapBack(d);
}
document.addEventListener('pointerup', e => finish(e, false));
document.addEventListener('pointercancel', e => finish(e, true));
document.addEventListener('keydown', e => {
  usingKeyboard = true;
  if (busy) return;
  const key = e.key, activate = key === 'Enter' || key === ' ';
  // A word on the table is one button: Enter puts it on the mat.
  if (activate && e.target.matches?.('.shelf .word[role="button"]')) { e.preventDefault(); return placeWord(e.target); }
  const tile = e.target.closest?.('.slot .tile');
  if (!tile) return;
  const word = tile.closest('.word'), tiles = [...word.children].filter(t => t.classList.contains('tile')), i = tiles.indexOf(tile);
  if (key === 'Escape' || key === 'Backspace') { e.preventDefault(); return sendHome(word); }
  if (activate) { e.preventDefault(); return pickLetter(tile); }
  // Arrows: along the word, and up or down to the same place in the other word.
  const other = slots.map(slot => slot.querySelector('.word')).find(w => w && w !== word), across = other && [...other.children].filter(t => t.classList.contains('tile'));
  const target = key === 'ArrowRight' ? tiles[Math.min(i + 1, tiles.length - 1)] : key === 'ArrowLeft' ? tiles[Math.max(i - 1, 0)]
    : key === 'Home' ? tiles[0] : key === 'End' ? tiles.at(-1)
    : (key === 'ArrowDown' || key === 'ArrowUp') && across ? across[Math.min(i, across.length - 1)] : null;
  if (target) { e.preventDefault(); target.focus(); }
});

// ---------- header buttons, dialogs, and the page lifecycle ----------
// ---------- tables: the picker ----------
const THEMES = [['oak', 'Kitchen table'], ['linen', 'Linen & cork'], ['blueprint', 'Drafting table'], ['felt', 'Card table'], ['light', 'Simple Light'], ['dark', 'Simple Dark']];
const THEME_COLOR = { oak: '#c68b49', linen: '#e6dfd2', blueprint: '#1b3a67', felt: '#1c5a40', light: '#dfe4ee', dark: '#121827' };
const systemTheme = () => matchMedia('(prefers-color-scheme: dark)').matches ? 'blueprint' : 'oak';
const theme = () => document.documentElement.dataset.theme;
function applyTheme(id, save = false) {
  document.documentElement.dataset.theme = id;
  if (save) try { localStorage.setItem('spoondle-theme', id); } catch {}
  document.querySelector('meta[name="theme-color"]').content = THEME_COLOR[id];
  for (const b of $('swatches').children) b.setAttribute('aria-pressed', String(b.dataset.pick === id));
  // Tables differ in padding and answer-sheet height, so size the tiles again for this one.
  if (shelf.childElementCount) { sizeTiles(); pileUp(); }
}
function buildPicker() {
  $('theme').innerHTML = GEAR;
  $('swatches').replaceChildren(...THEMES.map(([id, name]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'swatch'; b.dataset.pick = id;
    const art = document.createElement('span'); art.className = 'swatch-art'; art.dataset.theme = id;
    const mat = document.createElement('span'); mat.className = 'swatch-mat';
    art.append(mat, makeTile('S')); b.append(art, name);
    b.addEventListener('click', () => { applyTheme(id, true); clack('place', .6); });
    return b;
  }));
}
$('theme').addEventListener('click', () => { track('open', { n: 'settings' }); $('theme-dialog').showModal(); refreshClocks(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  let chosen = null; try { chosen = localStorage.getItem('spoondle-theme'); } catch {}
  if (!chosen) applyTheme(systemTheme());
});
addEventListener('resize', () => { sizeTiles(); pileUp(); });
$('relax').addEventListener('click', () => {
  relaxed = !relaxed; try { localStorage.setItem('spoondle-relax', relaxed ? 'on' : 'off'); } catch {}
  showRelax(); clack('pick', .6);
  if (record().finishedAt === null) say([relaxed ? 'Relax mode: no clock' : 'Timer mode on']); else say();
});
$('sound').addEventListener('click', () => { soundOn = !soundOn; try { localStorage.setItem('spoondle-sound', soundOn ? 'on' : 'off'); } catch {} showSound(); if (soundOn) clack('place'); });
// A menu that runs past the screen shows a fade and arrow at its foot (see the CSS) until you reach the end.
const helpSheet = $('help-dialog');
for (const d of document.querySelectorAll('dialog')) {
  const more = () => d.toggleAttribute('data-more', d.open && d.scrollHeight - d.scrollTop - d.clientHeight > 12);
  let queued = 0; const soon = () => { cancelAnimationFrame(queued); queued = requestAnimationFrame(more); };
  d.addEventListener('scroll', more, { passive: true });
  new MutationObserver(soon).observe(d, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['open', 'hidden'] });
  addEventListener('resize', soon);
}
function openHelp() { track('open', { n: 'help' }); helpSheet.showModal(); refreshClocks(); examples.scrollLeft = 0; exampleDir = 1; exampleWas = 0; startDemo(true); cycleModes(true); }
// How to play: the timer line flips between the two modes, as the header button does.
let modeTimer = 0;
function cycleModes(on) {
  clearInterval(modeTimer); if (!on) return;
  const box = $('mode-demo'), btn = box.firstElementChild, words = box.lastElementChild;
  const modes = [[STOPWATCH, 'Be competitive with timer mode'], [TEACUP, 'Take your time with relax mode']];
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
function flipExample(step) { exampleDir = step; examples.scrollTo({ left: (exampleShown() + step) * examples.clientWidth, behavior: RM ? 'auto' : 'smooth' }); }
let demoTimer = 0;
examples.addEventListener('scroll', () => {
  const i = exampleShown(); $('example-prev').disabled = i === 0; $('example-next').disabled = i === examples.children.length - 1;
  clearTimeout(demoTimer); demoTimer = setTimeout(() => { if (i !== exampleWas) { exampleDir = Math.sign(i - exampleWas) || exampleDir; exampleWas = i; } startDemo(); }, 160);   // once the card settles, play it from the top
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
  const row = (word, col) => { const w = document.createElement('div'); w.className = 'word'; w.style.cssText = `--s:${s}px;--gap:3px`; for (const ch of word) { const t = makeTile(ch); t.dataset.col = col; w.append(t); } return w; };
  const rows = [row(a.word, 0), row(b.word, 1)];
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
  for (let k = 0; k < script.length && alive(); k++) {
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
    // Then, as in the game, the letters close up into one tile per word.
    await demoPause(350); if (!alive()) return;
    await demoMove(tiles, () => answer.style.setProperty('--gap', '0px'), 280);
    fuseLetters(answer);
    if (ex.backwards) { const tag = document.createElement('span'); tag.textContent = 'Backwards!'; card.querySelector('.demo-note').replaceChildren(tag); }
    await demoPause(3000); if (!alive()) return;   // and time to read the answer
    await stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: 'forwards' }).finished.catch(() => {});
    stage.getAnimations().forEach(a => a.cancel());
  }
  if (alive()) advanceExample();   // all three played: on to the next category
}
// The categories play in order (Words & phrases, Proper nouns, Sneaky splits), then back the other way, and so on. Swiping or the
// arrows change the direction to the way you moved; the demo carries on from wherever you leave it.
let exampleDir = 1, exampleWas = 0;
function advanceExample() {
  const last = examples.children.length - 1, at = exampleShown();
  if (at + exampleDir < 0 || at + exampleDir > last) exampleDir = -exampleDir;
  examples.scrollTo({ left: Math.max(0, Math.min(last, at + exampleDir)) * examples.clientWidth, behavior: RM ? 'auto' : 'smooth' });
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
// ---------- archive: every day's puzzle on a calendar ----------
const CALENDAR = icon('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8.5 3v4M15.5 3v4"/>');
const CHART = icon('<path d="M5.5 20v-7M12 20V5M18.5 20v-10"/>');
$('archive').innerHTML = CALENDAR; $('stats').innerHTML = CHART;
function playOf(i) {
  const r = records[i], s = r.state;
  return { started: r.startedAt !== null, done: r.finishedAt !== null, gaveUp: s.revealed > 0, found: s.solved.length - s.revealed, total: puzzles[i].answers.length };
}
let shownMonth = null;
function openArchive() {
  track('open', { n: 'archive' });
  const d = new Date(`${dayOf(board)}T12:00:00`); shownMonth = [d.getFullYear(), d.getMonth()];
  drawArchive(); $('archive-dialog').showModal(); refreshClocks();
}
function drawArchive() {
  const [y, m] = shownMonth, now = today(), cal = $('calendar');
  $('month-title').textContent = monthTitle(y, m);
  const lastDay = dayOf(puzzles.length - 1) < now ? dayOf(puzzles.length - 1) : now;
  const launch = new Date(`${LAUNCH}T12:00:00`), latest = new Date(`${lastDay}T12:00:00`);
  $('month-prev').disabled = y * 12 + m <= launch.getFullYear() * 12 + launch.getMonth();
  $('month-next').disabled = y * 12 + m >= latest.getFullYear() * 12 + latest.getMonth();
  const head = [...'SMTWTFS'].map(ch => { const h = document.createElement('span'); h.className = 'cal-head'; h.textContent = ch; return h; });
  const cells = [], counts = { solved: 0, partial: 0, shown: 0, fresh: 0 };
  for (let i = 0; i < new Date(y, m, 1).getDay(); i++) cells.push(document.createElement('span'));
  for (let n = 1, last = new Date(y, m + 1, 0).getDate(); n <= last; n++) {
    const day = iso(new Date(y, m, n)), index = indexOfDay(day, puzzles.length), open = access(day, now);
    const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'cal-day';
    const num = document.createElement('span'); num.className = 'cal-num'; num.textContent = n; cell.append(num);
    if (day === now) cell.classList.add('today');
    // Only days the access rules open can be played (today that's every day that's out).
    if (index < 0 || open !== 'open') { cell.disabled = true; cell.classList.add('none'); cells.push(cell); continue; }
    const p = playOf(index), state = !p.started ? 'fresh' : !p.done ? 'partial' : p.gaveUp ? 'shown' : 'solved';
    counts[state]++; cell.classList.add(state); if (index === board) cell.classList.add('current');
    {
      const pips = document.createElement('span'); pips.className = 'pips';
      for (let k = 0; k < p.total; k++) { const d = document.createElement('i'); if (k < p.found) d.className = 'on'; pips.append(d); }
      cell.append(pips);
    }
    const words = { solved: 'solved', partial: `${p.found} of ${p.total} found`, shown: 'answers shown', fresh: 'not played yet' }[state];
    cell.setAttribute('aria-label', `${shortDate(day)}, ${puzzles[index].category}: ${words}`);
    cell.addEventListener('click', () => goTo(index));
    cells.push(cell);
  }
  cal.replaceChildren(...head, ...cells);
  const parts = [counts.solved && `${counts.solved} solved`, counts.partial && `${counts.partial} in progress`, counts.shown && `${counts.shown} with answers shown`, counts.fresh && `${counts.fresh} to play`].filter(Boolean);
  $('cal-summary').textContent = parts.join(' · ');
}
$('archive').addEventListener('click', openArchive);
$('month-prev').addEventListener('click', () => { shownMonth = shownMonth[1] ? [shownMonth[0], shownMonth[1] - 1] : [shownMonth[0] - 1, 11]; drawArchive(); });
$('month-next').addEventListener('click', () => { shownMonth = shownMonth[1] < 11 ? [shownMonth[0], shownMonth[1] + 1] : [shownMonth[0] + 1, 0]; drawArchive(); });

// ---------- statistics ----------
const CATEGORIES = [...new Set(puzzles.map(p => p.category))];
function myPlays() {
  return puzzles.flatMap((p, i) => {
    const r = records[i], s = r.state; if (r.startedAt === null) return [];
    return [{ day: dayOf(i), category: p.category, done: r.finishedAt !== null, onTime: r.finishedAt !== null && localDay(r.finishedAt) === dayOf(i), gaveUp: s.revealed > 0, ms: elapsedMs(r), hints: s.hints, reveals: s.misses, found: s.solved.length - s.revealed, total: p.answers.length }];
  });
}
const tiles = text => `<span class="word stat-tiles">${[...String(text)].map(ch => `<span class="tile">${ch}</span>`).join('')}</span>`;
const clock = ms => ms === null ? '–' : formatTime(ms);
function drawStats() {
  const now = today(), plays = myPlays(), st = summarize(plays, now);
  // Days before your first puzzle stay blank rather than counting as missed.
  const first = plays.reduce((min, p) => p.day < min ? p.day : min, now);
  const most = Math.max(1, ...st.timeBins.map(b => b.count)), mine = st.todayTime ?? st.trend.at(-1)?.ms ?? null;
  const mineBin = mine === null ? -1 : TIME_BINS.findIndex(([, max]) => mine < max);
  const timeRows = st.timeBins.map((b, i) => `<div class="hbar${i === mineBin ? ' mine' : ''}"><span>${b.label}</span><span class="track"><span class="fill" style="--w:${b.count / most}"><b>${b.count}</b></span></span></div>`).join('');
  // The trend: each recent solve's time, faster higher up, with the typical time as a dashed line.
  const W = 320, H = 96, pts = st.trend, top = Math.max(60e3, ...pts.map(p => p.ms)) * 1.08;
  const x = i => pts.length < 2 ? W / 2 : 10 + i * (W - 20) / (pts.length - 1), yv = ms => 8 + (ms / top) * (H - 16);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${yv(p.ms).toFixed(1)}`).join(' ');
  const trend = pts.length >= 3 ? `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Your last ${pts.length} solve times">
      ${st.typicalTime ? `<line class="typical" x1="0" x2="${W}" y1="${yv(st.typicalTime)}" y2="${yv(st.typicalTime)}"/>` : ''}
      <text class="faster" x="0" y="9">↑ faster</text><polyline points="${line}"/>${pts.map((p, i) => `<circle cx="${x(i)}" cy="${yv(p.ms)}" r="${i === pts.length - 1 ? 4.5 : 3}"${i === pts.length - 1 ? ' class="last"' : ''}/>`).join('')}
    </svg><div class="axis"><span>${pts.length} solves back</span><span>- - typical ${clock(st.typicalTime)}</span><span>Latest ${clock(pts.at(-1)?.ms ?? null)}</span></div>` : `<p class="empty">Solve ${3 - pts.length === 1 ? 'one more puzzle' : `${3 - pts.length} more puzzles`} to see your trend.</p>`;
  const helpMost = Math.max(1, ...st.helpBins.map(b => b.count));
  const cols = st.helpBins.map(b => `<div class="vcol"><b>${b.count}</b><span class="stack" style="--h:${b.count / helpMost}"></span><span class="lab">${b.label}</span></div>`).join('');
  // Twelve weeks of days, Sunday at the top, like a wall calendar turned on its side.
  const start = addDays(now, -(7 * 11 + new Date(`${now}T12:00:00`).getDay()));
  let grid = '';
  for (let k = 0; k < 84; k++) { const day = addDays(start, k), kind = st.byDay.get(day); grid += `<i class="${day > now || day < first ? 'future' : kind ?? 'none'}${day === now ? ' today' : ''}" title="${shortDate(day)}"></i>`; }
  const catRows = st.categories.map(c => `<div class="cat-row"><span class="name">${c.name}</span><span class="track"><span class="fill" style="--w:${c.played ? c.solved / c.played : 0}"></span></span><span class="num">${c.solved}/${c.played}</span><span class="num">${clock(c.typical)}</span></div>`).join('');
  $('stats-body').innerHTML = `
    <div class="stat-row">
      <div class="stat">${tiles(st.played)}<span>Played</span></div>
      <div class="stat">${tiles(st.winRate)}<span>Solved %</span></div>
      <div class="stat">${tiles(st.streak)}<span>Streak</span></div>
      <div class="stat">${tiles(st.bestStreak)}<span>Best streak</span></div>
    </div>
    <section><h3 class="section-label">Solve time</h3>
      <p class="sub">Best <b>${clock(st.bestTime)}</b> · Typical <b>${clock(st.typicalTime)}</b>${st.todayTime !== null ? ` · Today <b>${clock(st.todayTime)}</b>` : ''}</p>
      <div class="hbars">${timeRows}</div></section>
    <section><h3 class="section-label">Getting faster?</h3>${trend}</section>
    <section><h3 class="section-label">Hints and peeks per solve</h3>
      <p class="sub"><b>${st.clean}</b> of ${st.solved} solved with no help at all.</p>
      <div class="vcols">${cols}</div></section>
    <section><h3 class="section-label">Last 12 weeks</h3>
      ${plays.length ? `<div class="heat">${grid}</div>` : '<p class="empty">Your days fill in here as you play</p>'}
      <div class="heat-legend"><span><i class="clean"></i>Solved</span><span><i class="helped"></i>With help</span><span><i class="gaveup"></i>Answers shown</span><span><i class="none"></i>Missed</span><span><i class="today"></i>Today</span></div></section>
    <section><h3 class="section-label">By category</h3>
      <div class="cat-head"><span></span><span></span><span>Solved</span><span>Typical</span></div>${catRows}</section>`;
}
function openStats() { track('open', { n: 'stats' }); drawStats(); $('stats-dialog').showModal(); refreshClocks(); }
$('stats').addEventListener('click', openStats);
// The wait until tomorrow's puzzle, counting down while it's on screen.
let countdownTimer = 0;
function showCountdown(el) {
  clearInterval(countdownTimer);
  const tick = () => {
    if (!el.isConnected) return clearInterval(countdownTimer);
    const now = new Date(), midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
    el.textContent = `Next puzzle in ${formatTime(midnight - now)}`; checkNewDay();
  };
  tick(); countdownTimer = setInterval(tick, 1000);
}
// A click or tap outside a dialog (on the dimmed page behind it) closes it.
for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', e => {
  if (e.target !== d) return;
  const r = d.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
});
document.addEventListener('visibilitychange', () => { checkNewDay(); refreshClocks(); });
window.addEventListener('pagehide', () => { pauseRecord(record()); persist(); });
window.addEventListener('pageshow', e => { checkNewDay(); if (e.persisted) refreshClocks(); });
// Another tab saved progress: take it, without saving back, so two open tabs don't echo each other.
window.addEventListener('storage', e => {
  if (e.key !== STORAGE_KEY || !e.newValue || busy || drag) return;
  try { saved = readProgress(localStorage); records = puzzles.map((p, i) => restoreRecord(p, saved.records[keys[i]])); build(false); } catch {}
});
setInterval(updateStats, 250);


// ---------- Add to Home Screen ----------
// A card after a puzzle is solved (the next solve, for anyone who has played before), and a row in Settings, on phones that can add a
// Home Screen icon and haven't. The card shows after up to three solves, and never again once it's dismissed or followed.
const A2HS_KEY = 'spoondle-a2hs';   // set once the card is dismissed or followed
const A2HS_SHOWN = 'spoondle-a2hs-shown';   // how many solves have shown it
let justSolved = -1, nudgedFor = -1;   // the board solved in this visit, and the one the card was already counted for
let a2hsWrap = null;   // the card and its link, laid over the empty table once a puzzle is solved
const clearA2hs = () => { a2hsWrap?.remove(); a2hsWrap = null; $('play-area').classList.remove('has-a2hs'); };
const SHARE = icon('<path d="M12 15V3.5M8 7l4-4 4 4M6.5 10H6a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 18 10h-.5"/>');
const ADD = icon('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>');
const homeKind = () => homeScreenKind({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints, standalone: navigator.standalone === true || matchMedia('(display-mode: standalone)').matches });
const MENU_LINES = icon('<path d="M5 7h14M5 12h14M5 17h14"/>');
const RELOAD = icon('<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5"/>');
const DOTS = icon('<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>');
const DOTS_UP = icon('<circle cx="12" cy="5.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="18.5" r="1.3" fill="currentColor"/>');
// A little picture of what to look for at each step, drawn from the page's own pieces (hidden from screen readers: the words say it all).
const artHtml = (art, kind) => ({
  menu: `<span class="art art-icon" aria-hidden="true">${DOTS_UP}</span>`,
  share2: `<span class="art art-icon" aria-hidden="true">${SHARE}<span>Share</span></span><span class="look" aria-hidden="true">Or press and hold this</span><span class="art art-bar" aria-hidden="true">${MENU_LINES}<span>spoondle.app</span>${RELOAD}</span>`,
  row: `<span class="art art-row" aria-hidden="true"><span>${kind === 'ios' ? 'Add to Home Screen' : 'Add to Home screen'}</span>${ADD}</span>`,
  add: `<span class="art art-add" aria-hidden="true"><img src="apple-touch-icon.png" alt=""><span>Spoondle</span><b>Add</b></span>`,
}[art]);
// On an iPhone the icon opens with empty storage, so while the steps are showing the page's link carries the saved puzzles along
// (index.html reads them when the icon opens). It comes off again when the steps close.
const carrying = on => {
  if (homeKind() !== 'ios') return;
  try { history.replaceState(null, '', location.pathname + location.search + (on ? '#carry=' + encodeURIComponent(carryPayload(localStorage, STORAGE_KEY)) : '')); } catch {}
};
const a2hsDone = () => { try { localStorage.setItem(A2HS_KEY, 'no'); } catch {} };
function addToHomeNudge() {
  const kind = homeKind(); let dismissed = null; try { dismissed = localStorage.getItem(A2HS_KEY); } catch {}
  if (!kind || dismissed || practice || justSolved !== board || record().state.revealed > 0 || sideBySide.matches) return;   // the wide layout has the mat where the card would sit
  if (nudgedFor !== board) {
    let shown = 0; try { shown = Number(localStorage.getItem(A2HS_SHOWN)) || 0; } catch {}
    if (shown >= 3) return;
    try { localStorage.setItem(A2HS_SHOWN, String(shown + 1)); } catch {}
    nudgedFor = board;
  }
  const card = document.createElement('div'); card.className = 'a2hs';
  card.innerHTML = `<img class="a2hs-icon" src="apple-touch-icon.png" alt=""><span class="a2hs-text"><strong>Play every day?</strong><span>Add Spoondle to your Home Screen</span></span>`;
  const go = pill('Show me', () => openHomeGuide('nudge'));
  go.classList.add('soft'); card.insertBefore(go, null);
  const no = document.createElement('button'); no.type = 'button'; no.className = 'a2hs-no'; no.textContent = 'Don’t show this again';
  no.addEventListener('click', () => {
    a2hsDone(); track('open', { n: 'a2hs_no' }); card.remove(); no.remove();
    // Say where the instructions went, so dismissing it isn't a dead end.
    const after = document.createElement('span'); after.className = 'note a2hs-after';
    after.innerHTML = `No problem. You can find instructions in Settings ${GEAR} anytime.`;
    a2hsWrap.append(after);
  });
  // The card sits over the empty table where the tiles were: the page has no spare room under the buttons on most phones, and it
  // would only land under the table, out of reach. Where even that is too small, or a button couldn't be tapped, it steps aside.
  const wrap = document.createElement('div'); wrap.className = 'a2hs-wrap'; wrap.append(card, no);
  $('play-area').append(wrap); $('play-area').classList.add('has-a2hs'); a2hsWrap = wrap;   // the big checkmark steps aside while it's up
  const place = () => { wrap.style.top = `${shelf.offsetTop + 6}px`; };
  const tappable = el => { const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && el.contains(top); };
  place();
  const ok = () => wrap.getBoundingClientRect().bottom <= innerHeight - 6 && tappable(go) && tappable(no);
  if (!ok()) { clearA2hs(); return; }
  requestAnimationFrame(() => { if (a2hsWrap !== wrap) return; place(); if (!ok()) clearA2hs(); });
}
function showHomeRow() {
  const kind = homeKind(); $('a2hs-setting').hidden = !kind;
  if (kind) $('a2hs-btn').innerHTML = ADD;
}
// The guide: big numbered steps with a picture of each. While it's open, an iPhone's link carries the saved puzzles along (see `carrying`).
let guideFrom = null;
function openHomeGuide(from) {
  const kind = homeKind(); if (!kind) return;
  guideFrom = from;
  $('a2hs-steps').innerHTML = GUIDE[kind].map((s, i) => `<li><span class="n">${i + 1}</span><span class="what"><strong>${s.title}</strong><span>${s.hint}</span>${s.art === 'share2' ? '<span class="look" aria-hidden="true">Look for this</span>' : ''}${artHtml(s.art, kind)}</span></li>`).join('');
  $('a2hs-dialog').scrollTop = 0; carrying(true); track('open', { n: from === 'nudge' ? 'a2hs_nudge' : 'a2hs_row' });
  $('a2hs-dialog').showModal();
}
$('a2hs-btn').addEventListener('click', () => openHomeGuide('row'));
// However it closes (Got it, the ×, Escape), the link is tidied; from the card it also means the card has done its job.
$('a2hs-dialog').addEventListener('close', () => {
  carrying(false);
  if (guideFrom === 'nudge') { a2hsDone(); document.querySelectorAll('.a2hs, .a2hs-no').forEach(el => el.remove()); }
  guideFrom = null;
});

// ---------- the practice puzzle: a guided first game ----------
// A short board played for real, with a coach card, a spotlight on what to touch next, and a finger that
// shows each drag. It never touches saved progress, stats or streaks, and Skip leaves at any point.
const coach = { card: null, ring: null, finger: null, raf: 0, step: null };
function startPractice() {
  track('tutorial_start');
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  syncClocks(); persist();
  practice = { puzzle: tutorial, record: freshRecord(tutorial), intro: true };
  practice.record.startedAt = Date.now();
  document.documentElement.classList.add('practicing');
  build(false);
}
function endPractice() {
  if (!practice) return;
  practice = null;
  document.documentElement.classList.remove('practicing');
  try { localStorage.setItem('spoondle-practice-seen', '1'); } catch {}
  for (const k of ['card', 'ring', 'finger']) { coach[k]?.remove(); coach[k] = null; }
  document.querySelectorAll('.coach-lift').forEach(el => el.classList.remove('coach-lift'));
  cancelAnimationFrame(coach.raf); coach.step = null; coach.box = null; coach.cardY = coach.cardX = null;
  build(false); refreshClocks();
}
const onTable = text => [...document.querySelectorAll('.word')].find(w => w.textContent === text && !w.classList.contains('merged'));
function tileOf(word, letter) { return word && [...word.children].find(t => t.dataset.letter === letter); }
// Three pairs, each with its lessons. FOOD CART: place one word from each column and trade a letter.
// BED BUG: Hint before any word is picked (a hint can point anywhere), a word that isn't BUD's partner, putting it
// back, and dropping on either spot. FAIR PLAY: the switch-places button, a wrong swap, then Peek. WELL DONE: all
// theirs, with Hint and Peek on hand. Then a tour of the buttons up top.
// The step follows from the board, plus two things the board can't show: the decoy was tried, and the mat was flipped.
function coachStep() {
  if (practice.intro) return 'intro';
  if (record().finishedAt !== null) return 'done';
  const s = state(), on = text => !!onTable(text)?.closest('.slot');
  if (onTable('FOOT')) return !on('FOOT') ? 'left' : !on('CARD') ? 'right' : 'swap';
  if (onTable('BUD')) {
    if (!s.hints) return 'hint';
    if (!on('BUD')) return 'hinted';
    if (on(decoy()?.textContent)) { practice.tried = true; return 'putBack'; }
    return !practice.tried ? 'decoy' : !on('BEG') ? 'partner' : 'swapHint';
  }
  if (onTable('FAIL')) {
    if (!on('FAIL')) return 'third';
    if (!on('PRAY')) return 'fourth';
    if (!practice.flipped) return 'flip';
    return s.misses ? 'finish' : lastWrong && peekPill() ? 'peek' : 'wrong';
  }
  return 'solo';
}
const COACH = {
  intro: { title: 'Let’s play a practice round', text: 'A short puzzle to learn the moves. It won’t count toward your stats.', go: 'Let’s go' },
  left: { text: 'Drag <b>FOOT</b> onto the mat.', from: () => onTable('FOOT'), to: () => mat, place: true },
  right: { text: 'Now let’s find <b>FOOT</b>’s partner. Maybe it’s <b>CARD</b>? Drag it onto the mat.', from: () => onTable('CARD'), to: () => mat, place: true },
  swap: { text: 'Trade one letter between them: Drag the <b>T</b> onto the <b>D</b>.', from: () => tileOf(onTable('FOOT'), 'T'), to: () => tileOf(onTable('CARD'), 'D') },
  hint: { text: '<b>FOOD CART!</b> Whenever you’re stuck, <b>Hint</b> lights up a letter to swap. Try&nbsp;it&nbsp;now.', ring: () => $('hint'), lift: () => $('hint') },
  hinted: { text: 'Hint lit up the <b>U</b> in <b>BUD</b>, so it wants to swap. Drag BUD onto the mat.', from: () => onTable('BUD'), to: () => mat, place: true },
  decoy: { text: () => `Which word goes with BUD? Try <b>${decoy().textContent}</b>.`, from: () => decoy(), to: () => mat, place: true },
  putBack: { text: () => `No swap turns BUD and ${decoy().textContent} into an answer, so they aren’t a pair. Put ${decoy().textContent} back: Drag it off the mat, or tap its empty spot.`, from: () => decoy(), to: () => homeOf.get(decoy()) },
  partner: { text: 'Now try <b>BEG</b>. You can drop a word on either spot on the mat.', from: () => onTable('BEG'), to: () => mat, place: true },
  swapHint: { text: 'Now trade the lit <b>U</b> for the <b>E</b>.', from: () => tileOf(onTable('BUD'), 'U'), to: () => tileOf(onTable('BEG'), 'E') },
  third: { text: '<b>BED BUG!</b> Next, put <b>FAIL</b> back on the mat.', from: () => onTable('FAIL'), to: () => mat, place: true },
  fourth: { text: 'And <b>PRAY</b>, from the other column.', from: () => onTable('PRAY'), to: () => mat, place: true },
  flip: { text: `Tap <span class="icon-btn as-icon">${FLIP}</span> to switch which word is on top. It’s just to help you read: A right answer counts either way.`, ring: () => mat.querySelector('.mat-flip') },
  wrong: { text: 'Now try a swap that won’t work: Drag the <b>L</b> onto the <b>P</b>.', from: () => tileOf(onTable('FAIL'), 'L'), to: () => tileOf(onTable('PRAY'), 'P') },
  peek: { text: 'Wrong swaps are free. Tap <b>Peek</b> to see which of those two letters should move.', ring: () => peekPill(), lift: () => peekPill() },
  finish: { text: 'Peek lit up the <b>L</b>, so it should move. The <b>P</b> went gray, so it stays. Which letter in <b>PRAY</b> should the L trade with?', ring: () => mat, free: true },
  solo: { text: '<b>FAIR PLAY!</b> The last pair moved onto the mat for you, and this one’s all yours. Hint and Peek are here if you need them.', ring: () => mat, free: true },
  done: { title: 'You’re ready', text: () => `Every day brings a new puzzle with four answers.<br>About those buttons on top:<ul class="coach-keys">${[
    ['help', 'Review the rules or replay this tutorial'], ['archive', 'Archive: Access past puzzles'],
    ['stats', 'Stats: Review your prior performance'], ['theme', matSettingShown() ? 'Settings: Change game mode, toggle sound, move the mat, or choose a new table theme' : 'Settings: Change game mode, toggle sound, or choose a new table theme']]
    .map(([id, what]) => `<li><span class="icon-btn as-icon">${$(id).innerHTML}</span>${what}</li>`).join('')}</ul>`,
    ring: () => document.querySelector('.top .tools'), go: 'Play today’s puzzle', alt: 'Pick a table' },
};
function coachUpdate() {
  if (!practice) return;
  const step = coachStep();
  if (step === coach.step) return;
  coach.step = step;
  const c = COACH[step];
  if (!coach.card) {
    coach.card = document.createElement('div'); coach.card.className = 'coach'; coach.card.setAttribute('role', 'status');
    coach.ring = document.createElement('div'); coach.ring.className = 'coach-ring'; coach.ring.hidden = true;
    coach.finger = document.createElement('div'); coach.finger.className = 'coach-finger';
    document.body.append(coach.ring, coach.finger, coach.card);
    coach.raf = requestAnimationFrame(coachFrame);
  }
  coach.card.innerHTML = `${c.title ? `<strong>${c.title}</strong>` : ''}<p>${typeof c.text === 'function' ? c.text() : c.text}</p><div class="coach-actions">${c.alt ? `<button type="button" class="pill soft" data-coach="alt">${c.alt}</button>` : ''}${c.go ? `<button type="button" class="pill primary" data-coach="go">${c.go}</button>` : ''}${step === 'done' ? '' : '<button type="button" class="pill soft" data-coach="skip">Skip tutorial</button>'}</div>`;
  coach.card.querySelector('[data-coach="go"]')?.addEventListener('click', () => {
    if (step === 'intro') { practice.intro = false; coachUpdate(); } else { track('tutorial_done'); endPractice(); }
  });
  coach.card.querySelector('[data-coach="skip"]')?.addEventListener('click', () => { track('tutorial_skip', { n: step }); endPractice(); });
  coach.card.querySelector('[data-coach="alt"]')?.addEventListener('click', () => { track('tutorial_done', { n: 'table' }); endPractice(); $('theme').click(); });
  // Cards with nothing to point at sit in the middle of the screen.
  coach.card.classList.toggle('centered', !c.from && !c.ring);
  // A button the step asks for (Hint, Peek) rises above the dimming too.
  document.querySelectorAll('.coach-lift').forEach(el => el.classList.remove('coach-lift'));
  c.lift?.()?.classList.add('coach-lift');
  if (!RM) coach.card.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
  coach.started = performance.now();
}
const peekPill = () => message.querySelector('.pill.soft');
// The word the coach offers BUD first: whichever of FAIL and PRAY sits in the other column.
const decoy = () => ['PRAY', 'FAIL'].map(onTable).find(w => w && w.dataset.col !== onTable('BUD')?.dataset.col);
// The practice round is on rails: each step takes only the move it shows, so Hint and Peek can't be skipped past.
function coachAllows(a, b) {
  if (!practice) return true;
  const c = COACH[coach.step];
  if (c.free) return true;
  return !c.place && !!c.from && [a, b].includes(c.from()) && [a, b].includes(c.to());
}
function coachAllowsWord(word) {
  if (!practice) return true;
  const c = COACH[coach.step];
  // Only the word the step asks for; the last pair (WELD and LONE) moves onto the mat by itself, in a free step.
  if (c.place) return c.from() === word;
  return !!c.free;
}
function coachNudge() {
  clack('nope', .5);
  if (!RM) coach.card?.animate([{ transform: 'none' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 320 });
}
// Each frame, the spotlight glides after whatever to touch next and the finger acts out the drag from there.
function coachFrame(now) {
  coach.raf = requestAnimationFrame(coachFrame);
  if (!practice || !coach.card) return;
  const c = COACH[coach.step], from = c.from?.(), to = c.to?.(), ringEl = from ?? c.ring?.();
  let r = ringEl?.getBoundingClientRect();
  // A swap lights both tiles: the one to drag and the one to drop it on.
  if (r && to && !c.place) { const t = to.getBoundingClientRect(), left = Math.min(r.left, t.left), top = Math.min(r.top, t.top); r = { left, top, width: Math.max(r.right, t.right) - left, height: Math.max(r.bottom, t.bottom) - top }; }
  coach.ring.hidden = !r;
  if (r) {
    // Ease toward the target rather than restarting a CSS transition every frame, which is what made it shudder.
    const goal = [r.left - 8, r.top - 8, r.width + 16, r.height + 16], box = coach.box;
    coach.box = !box || RM ? goal : box.map((v, i) => Math.abs(goal[i] - v) < .5 ? goal[i] : v + (goal[i] - v) * .22);
    const [x, y, w, h] = coach.box.map(v => Math.round(v));
    coach.ring.style.translate = `${x}px ${y}px`; coach.ring.style.width = `${w}px`; coach.ring.style.height = `${h}px`;
  } else coach.box = null;
  placeCard();
  const show = from && to && !busy && !drag && !RM;
  coach.finger.hidden = !show;
  if (!show) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2, bx = b.left + b.width / 2, by = b.top + b.height / 2;
  // 2.4 seconds a loop: press, glide over, lift, then rest.
  const t = ((now - coach.started) % 2400) / 2400, ease = x => x < .5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
  const move = Math.min(1, Math.max(0, (t - .15) / .5)), k = ease(move);
  coach.finger.style.translate = `${ax + (bx - ax) * k - 16}px ${ay + (by - ay) * k - 16}px`;
  coach.finger.style.opacity = t < .08 ? t / .08 : t > .75 ? Math.max(0, 1 - (t - .75) / .1) : 1;
  coach.finger.style.scale = t > .1 && t < .7 ? '.85' : '1';
}
// The card sits as close to the move as it can (the middle of the screen when the step is a button) without covering
// what matters: what the step points at, where it goes and the way between (so nothing has to be dragged across the
// card), and words on the mat. On the step right after a pair is found, the new answer and its definition stay in view
// too. When the full-width card has no clear spot, a narrower one can sit over the other column of tiles, beside the
// move. It keeps clear of the header and title rows, and covers the least important thing only when nothing else fits.
// The steps that open right after a pair is found, while its answer is new on the sheet.
const JUST_FOUND = ['hint', 'third', 'solo', 'done'];
function placeCard() {
  const card = coach.card;
  if (card.classList.contains('centered')) { card.style.top = card.style.left = card.style.width = ''; coach.cardY = coach.cardX = null; return; }
  if (drag) return;
  const c = COACH[coach.step], m = 12;
  const keep = (el, weight) => { const r = el?.getBoundingClientRect?.() ?? el; return r?.width ? { l: r.left - 8, t: r.top - 8, r: r.left + r.width + 8, b: r.top + r.height + 8, weight } : null; };
  // The way a word or letter travels: its own width, from where it is to the middle of where it goes.
  const a = c.from?.()?.getBoundingClientRect(), b = c.to?.()?.getBoundingClientRect();
  const bx = b && b.left + b.width / 2, by = b && b.top + b.height / 2;
  const path = a && b && { left: Math.min(a.left, bx), top: Math.min(a.top, by), width: Math.max(a.right, bx) - Math.min(a.left, bx), height: Math.max(a.bottom, by) - Math.min(a.top, by) };
  const kept = [
    ...[c.from?.(), c.to?.(), c.ring?.()].map(el => keep(el, 100)),
    keep(path, 50),
    mat.querySelector('.word') && keep(mat, 20),
    ...(JUST_FOUND.includes(coach.step) ? [...tray.querySelectorAll('.found.filled'), clue.textContent.trim() && (clue.firstElementChild ?? clue)] : []).map(el => keep(el, 60)),
    ...[...shelf.querySelectorAll('.word')].map(el => keep(el, 2)),   // the rest of the table, where there's open space instead
    ...[...document.querySelectorAll('.top .brand, .top .tools, .board-bar .cat, .board-bar .nav')].map(el => keep(el, 3)),
  ].filter(Boolean);
  // A drag step keeps the card near the move; a button step keeps it mid-screen.
  const focus = path ? path.top + path.height / 2 : innerHeight / 2;
  const top = Math.max(m, document.querySelector('.top').getBoundingClientRect().top);   // below an iPhone app's status bar
  // Full width (or the card's widest), and on a phone a narrower one the width of a column of tiles.
  const full = Math.min(innerWidth - 2 * m, 400), narrow = Math.round((innerWidth - 3 * m) / 2);
  const sizes = [[full, 0]];
  if (narrow >= 170 && narrow < full - 60) sizes.push([narrow, 300]);
  let best = null;
  for (const [w, cost0] of sizes) {
    const h = cardHeight(w), lo = top, hi = innerHeight - m - h;
    if (hi < lo) continue;
    const covered = (x0, y) => kept.reduce((sum, q) => sum + q.weight * Math.max(0, Math.min(x0 + w, q.r) - Math.max(x0, q.l)) * Math.max(0, Math.min(y + h, q.b) - Math.max(y, q.t)), 0);
    const middle = (innerWidth - w) / 2, xs = w === full ? [[middle, 0], [m, 300], [innerWidth - w - m, 300]] : [[m, 0], [innerWidth - w - m, 0]];
    for (const [x0, side] of xs) for (const y0 of [focus - h / 2, lo, hi, ...kept.flatMap(q => [q.t - 12 - h, q.b + 12])]) {
      const y = Math.min(hi, Math.max(lo, y0)), cost = cost0 + side + Math.abs(y + h / 2 - focus) + covered(x0, y);
      if (!best || cost < best.cost) best = { x0, y, w, cost };
    }
  }
  best ??= { x0: (innerWidth - full) / 2, y: top, w: full };
  if (coach.cardY !== best.y || coach.cardX !== best.x0 || coach.cardW !== best.w) {
    coach.cardY = best.y; coach.cardX = best.x0; coach.cardW = best.w;
    card.style.top = `${Math.round(best.y)}px`; card.style.left = `${Math.round(best.x0 + best.w / 2)}px`;
    card.style.width = best.w === full ? '' : `${best.w}px`;
  }
}
// How tall the card is at a width, measured once per step and width.
function cardHeight(w) {
  const key = `${coach.step} ${w} ${innerHeight}`;
  if (coach.heights?.key !== key) {
    const card = coach.card, was = card.style.width;
    card.style.width = `${w}px`; coach.heights = { key, h: card.offsetHeight }; card.style.width = was;
  }
  return coach.heights.h;
}
$('practice-btn').addEventListener('click', startPractice);

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
buildPicker(); applyTheme(theme()); showSound(); showRelax(); showMat(); showHomeRow(); build();
// A first visit starts with the practice puzzle (How to play is always a tap away); ?practice replays it.
let practiceSeen = true; try { practiceSeen = localStorage.getItem('spoondle-practice-seen') !== null; } catch {}
track('visit', { p: board + 1, r: records.some(r => r.startedAt !== null) ? 1 : 0, ...(navigator.standalone === true || matchMedia('(display-mode: standalone)').matches ? { n: 'app' } : {}) });
// Temporary: one anonymous layout reading from the installed app (is it marked as one, the screen height, the top and bottom padding, the notch insets, the room under the buttons), to see why the status bar push-down isn't showing. Remove once that's settled.
if (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches) setTimeout(() => {
  try {
    const probe = document.createElement('div'); probe.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)'; document.body.append(probe);
    const cs = getComputedStyle(document.querySelector('.app')), ps = getComputedStyle(probe), r = x => Math.max(0, Math.round(parseFloat(x) || 0));
    const gap = innerHeight - document.querySelector('.bottom').getBoundingClientRect().bottom; probe.remove();
    track('open', { n: `L${document.documentElement.classList.contains('home-app') ? 1 : 0}h${r(innerHeight)}t${r(cs.paddingTop)}b${r(cs.paddingBottom)}s${r(ps.paddingTop)}x${r(ps.paddingBottom)}g${r(gap)}` });
  } catch {}
}, 2500);
if (!helpSeen && !practiceSeen) welcome().then(startPractice);
else { welcome(); if (new URLSearchParams(location.search).has('practice')) startPractice(); }   // welcome() only clears the title card if it's up
