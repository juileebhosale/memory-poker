// Game state machine: SETUP -> MEMORIZE -> PLACE -> REVEAL.
// Holds state and calls ui.js. No direct DOM access here.
import { deal } from './deck.js';
import { evaluate, compare, bestPair } from './handEvaluator.js';
import * as ui from './ui.js';

export const PHASE = Object.freeze({
  SETUP: 'SETUP',
  MEMORIZE: 'MEMORIZE',
  PLACE: 'PLACE',
  REVEAL: 'REVEAL',
});

export const MEMORIZE_MS = 60_000;
export const URGENT_SECONDS = 10;
export const NAME_MAX = 20;

const LETTERS = 'ABCDEFGHIJKLMNOP'.split('');

// ---------- Pure helpers (tested in Node) ----------

// Toggle a marker on grid index i. Max 2. Returns a new array.
export function toggleMarker(markers, i, max = 2) {
  if (markers.includes(i)) return markers.filter((m) => m !== i);
  if (markers.length >= max) return markers;
  return [...markers, i];
}

// Whole seconds left, rounded up, never below 0.
export function secondsLeft(endAt, now) {
  return Math.max(0, Math.ceil((endAt - now) / 1000));
}

// Read ?seed=&n=&from= from a query string. n is null if missing or invalid.
export function parseParams(search) {
  const p = new URLSearchParams(search);
  const n = Number(p.get('n'));
  return {
    seed: p.get('seed') || null,
    n: n === 8 || n === 16 ? n : null,
    from: (p.get('from') ?? '').trim().slice(0, NAME_MAX),
  };
}

// Short random seed like "k3f9x". The only non-seeded randomness allowed.
export function newSeed(length = 5) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// Score a finished round. If the player's pair ties the best hand, their pair
// is shown as the best pair (it is one), so the result never looks contradictory.
export function scoreRound(grid, open, markers) {
  const [a, b] = [...markers].sort((x, y) => x - y);
  const yours = evaluate([grid[a], grid[b], ...open]);
  const best = bestPair(grid, open);
  const perfect = compare(yours, best.hand) === 0;
  return {
    yours,
    best: best.hand,
    bestIndices: perfect ? [a, b] : best.indices,
    perfect,
  };
}

// Where the game lives on any host. Never hard-code the domain.
export const BASE_PATH = '/memory-poker/';

// Link that reproduces this deal for anyone who opens it:
// origin + "/memory-poker/?seed=...&n=...". Pass window.location.origin.
// from = the sharer's name, shown to friends as "You're playing <from>'s deal".
export function shareLink(origin, seed, n, from = '') {
  const url = new URL(BASE_PATH, origin);
  url.searchParams.set('seed', seed);
  url.searchParams.set('n', String(n));
  if (from) url.searchParams.set('from', from);
  return url.toString();
}

// Map a key press to a grid index (0-based), or -1. 'a'/'A' -> 0.
export function letterToIndex(key, n) {
  if (typeof key !== 'string' || key.length !== 1) return -1;
  const i = key.toUpperCase().charCodeAt(0) - 65;
  return i >= 0 && i < n ? i : -1;
}

// "Memory Poker 16 #k3f9 — Flush (best: Flush) ✅ 14.2s" + newline + link
export function shareText({ n, seed, yourName, bestName, perfect, lockInMs, link }) {
  const secs = (lockInMs / 1000).toFixed(1);
  return `Memory Poker ${n} #${seed} — ${yourName} (best: ${bestName}) ${perfect ? '✅' : '❌'} ${secs}s\n${link}`;
}

// ---------- State ----------

const state = {
  phase: PHASE.SETUP,
  seed: null,
  n: 8,
  name: '',
  from: '',
  grid: [],
  open: [],
  letters: [],
  markers: [],
  memorizeEndAt: 0,
  flippedAt: 0,
  lockInMs: null,
  result: null,
  timerId: null,
};

function writeUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', state.seed);
    url.searchParams.set('n', String(state.n));
    if (state.from) url.searchParams.set('from', state.from);
    else url.searchParams.delete('from');
    window.history.replaceState(null, '', url);
  } catch {
    // Some embedded/sandboxed pages block history changes. The game still works.
  }
}

function stopTimer() {
  if (state.timerId !== null) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

// ---------- Phases ----------

function enterSetup() {
  stopTimer();
  state.phase = PHASE.SETUP;
  ui.setFrom(state.from);
  ui.showSetup({ n: state.n, name: state.name });
}

function startGame({ n, name }) {
  state.n = n;
  state.name = name.slice(0, NAME_MAX);
  if (!state.seed) state.seed = newSeed();
  writeUrl();

  const { grid, open } = deal(state.seed, state.n);
  state.grid = grid;
  state.open = open;
  state.letters = LETTERS.slice(0, n);
  state.markers = [];
  state.lockInMs = null;
  state.result = null;

  ui.setFrom(state.from);
  enterMemorize();
}

function enterMemorize() {
  state.phase = PHASE.MEMORIZE;
  ui.showPlay();
  ui.renderGrid(state.grid, state.letters);
  ui.renderMarkers([]);
  ui.setStatus('Memorize the cards');

  state.memorizeEndAt = Date.now() + MEMORIZE_MS;
  let warned = false;
  const tick = () => {
    const left = secondsLeft(state.memorizeEndAt, Date.now());
    const urgent = left > 0 && left <= URGENT_SECONDS;
    ui.setCountdown(left, urgent);
    if (urgent && !warned) {
      warned = true;
      ui.setStatus(`${URGENT_SECONDS} seconds left`);
    }
    if (left === 0) {
      stopTimer();
      flipDown();
    }
  };
  tick();
  // Poll often; the display is always computed from Date.now(), so a lagging tab stays correct.
  state.timerId = setInterval(tick, 200);
}

function flipDown() {
  state.flippedAt = Date.now();
  ui.setCountdown(null, false);
  ui.setStatus('Cards flipped');
  ui.flipGrid(false, state.grid, state.letters);

  // After the flip, slide in the open cards, then allow marker placement.
  // Both waits are 0 when the player prefers reduced motion.
  setTimeout(() => {
    if (state.phase !== PHASE.MEMORIZE) return;
    ui.renderOpenCards(state.open);
    setTimeout(enterPlace, ui.slideDurationMs());
  }, ui.flipDurationMs());
}

function enterPlace() {
  if (state.phase !== PHASE.MEMORIZE) return;
  state.phase = PHASE.PLACE;
  ui.setGridClickable(true);
  ui.setStatus('Pick 2 cards for your hand');
  ui.showLockIn(false);
}

function onCardClick(i) {
  if (state.phase !== PHASE.PLACE) return;
  state.markers = toggleMarker(state.markers, i);
  ui.renderMarkers(state.markers);
  ui.showLockIn(state.markers.length === 2);
  const left = 2 - state.markers.length;
  ui.setStatus(left === 0 ? 'Ready — lock in when sure' : `Pick ${left} more card${left === 1 ? '' : 's'}`);
}

function onLetterKey(key) {
  if (state.phase !== PHASE.PLACE) return false;
  const i = letterToIndex(key, state.n);
  if (i === -1) return false;
  onCardClick(i);
  return true;
}

// Enter locks in when 2 markers are placed. Otherwise let Enter do its normal job
// (e.g. toggle the focused card).
function onEnterKey() {
  if (state.phase !== PHASE.PLACE || state.markers.length !== 2) return false;
  onLockIn();
  return true;
}

function onLockIn() {
  if (state.phase !== PHASE.PLACE || state.markers.length !== 2) return;
  state.lockInMs = Date.now() - state.flippedAt;
  enterReveal();
}

function enterReveal() {
  stopTimer();
  state.phase = PHASE.REVEAL;
  state.result = scoreRound(state.grid, state.open, state.markers);

  ui.setGridClickable(false);
  ui.hideLockIn();
  ui.flipGrid(true, state.grid, state.letters);
  ui.renderMarkers(state.markers);
  ui.renderBestPair(state.result.bestIndices);
  ui.labelRevealed(state.grid, state.letters, state.markers, state.result.bestIndices);
  ui.setStatus('');
  ui.renderResult({
    perfect: state.result.perfect,
    yourName: state.result.yours.name,
    bestName: state.result.best.name,
    yourCards: [...state.markers].sort((x, y) => x - y).map((i) => state.grid[i]).concat(state.open),
    bestLetters: state.result.bestIndices.map((i) => state.letters[i]),
    lockInSeconds: (state.lockInMs / 1000).toFixed(1),
  });
  ui.focusResult();
}

async function onShare() {
  if (state.phase !== PHASE.REVEAL) return;
  const link = shareLink(window.location.origin, state.seed, state.n, state.name);
  const text = shareText({
    n: state.n,
    seed: state.seed,
    yourName: state.result.yours.name,
    bestName: state.result.best.name,
    perfect: state.result.perfect,
    lockInMs: state.lockInMs,
    link,
  });

  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user closed the share sheet
      // Any other failure: fall through to copying.
    }
  }
  const ok = await ui.copyText(text);
  ui.flashShareStatus(ok ? 'Copied' : 'Copy failed');
}

function onPlayAgain() {
  startGame({ n: state.n, name: state.name });
}

function onNewDeal() {
  state.seed = newSeed();
  state.from = ''; // a fresh deal is the player's own, not a friend's
  startGame({ n: state.n, name: state.name });
}

// ---------- Boot ----------

function boot() {
  const params = parseParams(window.location.search);
  state.seed = params.seed ?? newSeed();
  if (params.n) state.n = params.n;
  state.from = params.seed ? params.from : ''; // "from" only means something with a shared seed
  writeUrl();

  ui.init({
    onStart: startGame, onCardClick, onLockIn, onShare, onPlayAgain, onNewDeal, onLetterKey, onEnterKey,
  });
  enterSetup();
}

// Only boot in a browser; lets Node tests import the pure helpers.
if (typeof document !== 'undefined') boot();
