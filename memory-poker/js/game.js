// Entry point: home screen + solo mode. Live rooms live in live.js (loaded only when needed).
// Holds state and calls ui.js. No direct DOM access here.
import { deal } from './deck.js';
import { evaluate, compare, bestPair } from './handEvaluator.js';
import * as ui from './ui.js';
import {
  startRound, stopRound, input, lettersFor,
  toggleMarker, secondsLeft, letterToIndex,
} from './round.js';
import { normalizeRoomCode } from './liveRules.js';

// Re-exported so existing tests and callers keep working.
export { toggleMarker, secondsLeft, letterToIndex };
export { MEMORIZE_MS, URGENT_SECONDS } from './round.js';

export const NAME_MAX = 20;
const NAME_KEY = 'memory-poker-name';

// ---------- Pure helpers (tested in Node) ----------

// Read ?seed=&n=&from=&room= from a query string. n is null if missing or invalid.
export function parseParams(search) {
  const p = new URLSearchParams(search);
  const n = Number(p.get('n'));
  return {
    seed: p.get('seed') || null,
    n: n === 8 || n === 16 ? n : null,
    from: (p.get('from') ?? '').trim().slice(0, NAME_MAX),
    room: normalizeRoomCode(p.get('room')),
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

// Link that opens a live room: origin + "/memory-poker/?room=ABCDE".
export function roomLink(origin, code) {
  const url = new URL(BASE_PATH, origin);
  url.searchParams.set('room', code);
  return url.toString();
}

// "Memory Poker 16 #k3f9 — Flush (best: Flush) ✅ 14.2s" + newline + link
export function shareText({ n, seed, yourName, bestName, perfect, lockInMs, link }) {
  const secs = (lockInMs / 1000).toFixed(1);
  return `Memory Poker ${n} #${seed} — ${yourName} (best: ${bestName}) ${perfect ? '✅' : '❌'} ${secs}s\n${link}`;
}

// ---------- Small browser helpers ----------

// Replace the query string. Some embedded/sandboxed pages block this; the game still works.
export function setUrlParams(params) {
  try {
    const url = new URL(window.location.href);
    url.search = '';
    for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) url.searchParams.set(k, String(v));
    window.history.replaceState(null, '', url);
  } catch {
    // ignore
  }
}

export function savedName() {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}

export function saveName(name) {
  try { if (name) localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
}

// ---------- Solo state ----------

const state = {
  mode: 'home',      // 'home' | 'solo' | 'live'
  seed: null,
  n: 8,
  name: '',
  from: '',
  grid: [],
  open: [],
  letters: [],
  markers: [],
  lockInMs: null,
  result: null,
};

let live = null; // live.js module, loaded on first use

function writeSoloUrl() {
  setUrlParams({ seed: state.seed, n: state.n, from: state.from });
}

// ---------- Home ----------

async function leaveLiveIfAny() {
  if (live) await live.leave({ quiet: true });
}

async function goHome(error = '') {
  stopRound();
  await leaveLiveIfAny();
  state.mode = 'home';
  setUrlParams({});
  ui.setModeBanner('');
  ui.setLiveBar('');
  ui.showHome({ error });
}

function onHomeSolo() {
  state.mode = 'solo';
  state.seed = newSeed();
  state.from = '';
  writeSoloUrl();
  enterSetup();
}

async function openLive(opts) {
  stopRound();
  state.mode = 'live';
  try {
    live = live ?? await import('./live.js');
  } catch (err) {
    console.error(err);
    ui.showHome({ error: "Couldn't load live rooms. Check your connection and try again." });
    return;
  }
  live.open({ ...opts, name: opts.name ?? (savedName() || state.name), onExit: (error) => goHome(error) });
}

function onHomeFriends() {
  openLive({ mode: 'create', n: state.n });
}

function onHomeJoin(raw) {
  const code = normalizeRoomCode(raw);
  if (!code) {
    ui.showHome({ error: 'Room codes are 5 letters, like ABCDE.' });
    return;
  }
  openLive({ mode: 'join', code });
}

// ---------- Solo ----------

function enterSetup() {
  stopRound();
  ui.setFrom(state.from);
  ui.showSetup({ n: state.n, name: state.name || savedName() });
}

function startGame({ n, name }) {
  state.mode = 'solo';
  state.n = n;
  state.name = name.slice(0, NAME_MAX);
  saveName(state.name);
  if (!state.seed) state.seed = newSeed();
  writeSoloUrl();

  const { grid, open } = deal(state.seed, state.n);
  state.grid = grid;
  state.open = open;
  state.letters = lettersFor(n);
  state.markers = [];
  state.lockInMs = null;
  state.result = null;

  ui.setFrom(state.from);
  ui.setLiveBar('');
  startRound({
    grid,
    open,
    startAt: Date.now(),
    now: Date.now,
    placeMs: null,
    onLocked: ({ markers, lockInMs }) => {
      state.markers = markers;
      state.lockInMs = lockInMs;
      enterReveal();
    },
  });
}

function enterReveal() {
  stopRound();
  state.result = scoreRound(state.grid, state.open, state.markers);

  ui.setGridClickable(false);
  ui.hideLockIn();
  ui.setCountdown(null, false);
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
  if (state.mode !== 'solo' || !state.result) return;
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

// Live handlers are forwarded to live.js once it's loaded.
const toLive = (fn) => (...args) => (live && state.mode === 'live' ? live[fn](...args) : undefined);

function boot() {
  const params = parseParams(window.location.search);
  if (params.n) state.n = params.n;

  ui.init({
    onHomeSolo,
    onHomeFriends,
    onHomeJoin,
    onHome: () => goHome(),
    onStart: startGame,
    onShare,
    onPlayAgain,
    onNewDeal,
    onCardClick: input.cardClick,
    onLockIn: input.lockIn,
    onLetterKey: input.letterKey,
    onEnterKey: input.enterKey,
    onLiveSubmit: toLive('submitSetup'),
    onCopyLink: toLive('copyLink'),
    onStartRound: toLive('startRound'),
    onNextRound: toLive('nextRound'),
    onLeave: () => goHome(),
  });

  if (params.room) {
    // A room link: join (or rejoin after a refresh).
    openLive({ mode: 'join', code: params.room });
  } else if (params.seed) {
    // A friend's solo deal link: go straight to setup with their seed.
    state.mode = 'solo';
    state.seed = params.seed;
    state.from = params.from;
    writeSoloUrl();
    enterSetup();
  } else {
    goHome();
  }
}

// Only boot in a browser; lets Node tests import the pure helpers.
if (typeof document !== 'undefined') boot();
