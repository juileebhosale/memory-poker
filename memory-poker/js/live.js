// Live rooms: create/join, lobby, synced rounds, leaderboard, next round.
// Game rules stay in the pure modules (deck, handEvaluator, liveRules).
// The backend (Supabase, or local test mode) is behind one small interface.
import { deal, cardLabel } from './deck.js';
import { evaluate, bestPair, CATEGORY_NAMES } from './handEvaluator.js';
import * as ui from './ui.js';
import { startRound as startRoundUi, stopRound, lettersFor } from './round.js';
import {
  PLACE_MS, MIN_PLAYERS, roundTimeline, clockOffset, roomCodeFromBytes,
  rankRound, playersInRound, allLockedIn, hasResult,
} from './liveRules.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { newSeed, roomLink, setUrlParams, saveName, savedName, NAME_MAX } from './game.js';

const FINISH_AFTER_DEADLINE_MS = 2_500; // server allows 2s grace; ask just after it
const FINISH_RETRY_MS = 2_000;
const RESYNC_MS = 15_000;                // safety net in case a realtime message is missed

const S = {
  backend: null,
  onExit: null,
  setup: null,          // { mode: 'create' | 'join', n }
  code: '',
  room: null,
  players: [],
  me: null,
  online: new Set(),
  offset: 0,            // server clock - this device's clock, ms
  unsubscribe: null,
  view: '',             // 'lobby' | 'play' | 'reveal'
  shownRound: 0,
  deal: null,
  locked: false,
  timedOut: false,
  finishing: false,
  timers: new Set(),
  syncTimer: null,
  syncing: false,
  syncAgain: false,
};

const serverNow = () => Date.now() + S.offset;

function later(fn, ms) {
  const id = setTimeout(() => { S.timers.delete(id); fn(); }, Math.max(0, ms));
  S.timers.add(id);
}

function clearTimers() {
  for (const id of S.timers) { clearTimeout(id); clearInterval(id); }
  S.timers.clear();
}

// ---------- Backend ----------

function wantLocal() {
  const forced = new URLSearchParams(window.location.search).get('backend') === 'local';
  return forced || !SUPABASE_URL || !SUPABASE_KEY;
}

async function ensureBackend() {
  if (S.backend) return S.backend;
  if (wantLocal()) {
    const { createLocalBackend } = await import('./localBackend.js');
    S.backend = await createLocalBackend();
    ui.setModeBanner('Local test mode: rooms only exist in this browser. Open more tabs to add players.');
  } else {
    const { createSupabaseBackend } = await import('./supabaseBackend.js');
    S.backend = await createSupabaseBackend({ url: SUPABASE_URL, key: SUPABASE_KEY });
    ui.setModeBanner('');
  }
  // Clock sync: ask the server for the time 3 times, keep the fastest answer.
  const samples = [];
  for (let i = 0; i < 3; i++) samples.push(await S.backend.serverNowSample());
  S.offset = clockOffset(samples);
  return S.backend;
}

function keepUrl() {
  const params = { room: S.code };
  if (new URLSearchParams(window.location.search).get('backend') === 'local') params.backend = 'local';
  setUrlParams(params);
}

// ---------- Entry points (called from game.js) ----------

// opts: { mode: 'create' | 'join', code, n, name, onExit(error) }
export async function open(opts) {
  await leave({ quiet: true });
  S.onExit = opts.onExit;
  S.setup = { mode: opts.mode, n: opts.n ?? 8 };
  const name = opts.name || savedName();

  if (opts.mode === 'create') {
    ui.showLiveSetup({ mode: 'create', n: S.setup.n, name });
    return;
  }

  // Join: check the room exists, and rejoin straight away if this browser is already in it.
  S.code = opts.code;
  keepUrl();
  ui.showLiveSetup({ mode: 'join', code: S.code, name });
  ui.setLiveBusy(true, 'Connecting…');
  try {
    await ensureBackend();
    const room = await S.backend.getRoom(S.code);
    if (!room) {
      exit(`Room ${S.code} wasn't found. It may have expired (rooms last 24 hours).`);
      return;
    }
    const players = await S.backend.listPlayers(S.code);
    const mine = players.find((p) => p.userId === S.backend.userId);
    if (mine) {
      await enterRoom(mine);
      return;
    }
    ui.setLiveBusy(false, 'Join');
  } catch (err) {
    console.error(err);
    ui.setLiveBusy(false, 'Try again');
    ui.setLiveError(err.message);
  }
}

export async function submitSetup({ n, name }) {
  const clean = name.trim().slice(0, NAME_MAX);
  if (!clean) {
    ui.setLiveError('Please enter your name.');
    return;
  }
  saveName(clean);
  ui.setLiveError('');
  try {
    if (S.setup.mode === 'create') {
      ui.setLiveBusy(true, 'Creating room…');
      await ensureBackend();
      let room = null;
      for (let i = 0; i < 6 && !room; i++) {
        const bytes = new Uint8Array(5);
        crypto.getRandomValues(bytes);
        room = await S.backend.createRoom({ id: roomCodeFromBytes(bytes), seed: newSeed(), n });
      }
      if (!room) throw new Error("Couldn't create a room. Please try again.");
      S.code = room.id;
      keepUrl();
      const me = await S.backend.joinRoom(S.code, clean);
      await enterRoom(me);
    } else {
      ui.setLiveBusy(true, 'Joining…');
      await ensureBackend();
      const me = await S.backend.joinRoom(S.code, clean);
      await enterRoom(me);
    }
  } catch (err) {
    console.error(err);
    ui.setLiveBusy(false, S.setup.mode === 'create' ? 'Create room' : 'Join');
    ui.setLiveError(err.message);
  }
}

export async function copyLink() {
  const link = roomLink(window.location.origin, S.code);
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: 'Memory Poker', text: `Join my Memory Poker room ${S.code}`, url: link });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  const ok = await ui.copyText(link);
  ui.flashCopyStatus(ok ? 'Copied' : 'Copy failed');
}

export async function startRound() {
  if (!isHost()) return;
  try {
    await S.backend.startRound(S.code, newSeed());
    scheduleSync();
  } catch (err) {
    renderLobby(err.message);
  }
}

export async function nextRound() {
  if (!isHost()) return;
  ui.setNextRoundBusy(true);
  try {
    await S.backend.startRound(S.code, newSeed());
    scheduleSync();
  } catch (err) {
    ui.setNextRoundBusy(false);
    ui.setStatus(err.message);
  }
}

// Leave the room (deletes this player's row). quiet: don't call onExit.
export async function leave({ quiet = false } = {}) {
  clearTimers();
  clearInterval(S.syncTimer);
  stopRound();
  if (S.unsubscribe) S.unsubscribe();
  const { backend, me } = S;
  Object.assign(S, {
    unsubscribe: null, room: null, players: [], me: null, online: new Set(), code: '',
    view: '', shownRound: 0, deal: null, locked: false, timedOut: false, syncTimer: null,
  });
  document.removeEventListener('visibilitychange', onVisible);
  if (backend && me) {
    try { await backend.leaveRoom(me.id); } catch (err) { console.warn(err); }
  }
  ui.setLiveBar('');
  if (!quiet && S.onExit) S.onExit('');
}

function exit(message) {
  const onExit = S.onExit;
  leave({ quiet: true }).then(() => onExit?.(message));
}

// ---------- Room loop ----------

function isHost() {
  return Boolean(S.room && S.backend && S.room.hostUserId === S.backend.userId);
}

function onVisible() {
  if (document.visibilityState === 'visible') scheduleSync();
}

async function enterRoom(me) {
  S.me = me;
  S.unsubscribe = S.backend.subscribe(S.code, { name: me.name }, {
    onChange: scheduleSync,
    onPresence: (set) => {
      S.online = set;
      if (S.view === 'lobby') renderLobby();
    },
  });
  S.syncTimer = setInterval(scheduleSync, RESYNC_MS);
  document.addEventListener('visibilitychange', onVisible);
  await sync();
}

let syncDebounce = null;
function scheduleSync() {
  clearTimeout(syncDebounce);
  syncDebounce = setTimeout(sync, 60);
}

async function sync() {
  if (!S.code || !S.backend) return;
  if (S.syncing) { S.syncAgain = true; return; }
  S.syncing = true;
  try {
    const [room, players] = await Promise.all([S.backend.getRoom(S.code), S.backend.listPlayers(S.code)]);
    if (!S.code) return; // left while loading
    if (!room) { exit('This room has closed.'); return; }
    const me = players.find((p) => p.userId === S.backend.userId);
    if (!me) { exit('You are no longer in this room.'); return; }
    S.room = room;
    S.players = players;
    S.me = me;
    render();
  } catch (err) {
    console.warn('sync failed', err);
  } finally {
    S.syncing = false;
    if (S.syncAgain) { S.syncAgain = false; scheduleSync(); }
  }
}

function render() {
  const { room, me } = S;
  const sittingOut = me.joinedRound > room.round;
  if (room.status === 'lobby' || sittingOut) {
    renderLobby();
  } else if (room.status === 'playing') {
    renderPlaying();
  } else {
    renderReveal();
  }
}

// ---------- Lobby ----------

function renderLobby(error = '') {
  if (S.view !== 'lobby') {
    stopRound();
    clearTimers();
    S.view = 'lobby';
  }
  const { room, players, me } = S;
  const host = isHost();
  const online = players.filter((p) => S.online.has(p.userId));
  const canStart = host && room.status !== 'playing' && players.length >= MIN_PLAYERS && online.length >= MIN_PLAYERS;
  const sittingOut = me.joinedRound > room.round && room.round > 0;

  let wait;
  if (error) wait = error;
  else if (sittingOut && room.status === 'playing') wait = `Round ${room.round} is being played. You'll join from the next round.`;
  else if (sittingOut) wait = host ? '' : 'Waiting for the host to start the next round…';
  else if (host) wait = canStart ? '' : 'Waiting for at least one more player…';
  else wait = 'Waiting for the host to start…';

  ui.setLiveBar('');
  ui.showLobby({
    code: room.id,
    link: roomLink(window.location.origin, room.id),
    players: players.map((p) => ({
      name: p.name,
      isHost: p.userId === room.hostUserId,
      isMe: p.id === me.id,
      online: S.online.has(p.userId),
    })),
    isHost: host,
    canStart,
    note: `Send the link or the code to your friends. ${room.n} cards, 60 seconds to memorize, 30 seconds to lock in.`,
    wait,
  });
}

// ---------- Playing ----------

function renderPlaying() {
  const { room, me, players } = S;
  ui.setLiveBar(`Room ${room.id} · Round ${room.round} · ${room.n} cards`);

  if (S.view !== 'play' || S.shownRound !== room.round) {
    clearTimers();
    S.view = 'play';
    S.shownRound = room.round;
    S.deal = deal(room.seed, room.n);
    S.locked = hasResult(me, room.round);
    S.timedOut = false;
    startRoundUi({
      grid: S.deal.grid,
      open: S.deal.open,
      startAt: room.startAt,
      now: serverNow,
      placeMs: PLACE_MS,
      alreadyLocked: S.locked ? { markers: [me.markerA, me.markerB] } : null,
      onLocked,
      onTimeout,
    });
    // After the deadline, ask the server to finish the round (repeat until it does).
    const { deadline } = roundTimeline(room.startAt);
    later(function tryFinish() {
      callFinish();
      if (S.view === 'play') later(tryFinish, FINISH_RETRY_MS);
    }, deadline + FINISH_AFTER_DEADLINE_MS - serverNow());
  }

  if (S.locked || S.timedOut) {
    const waiting = playersInRound(players, room.round).filter((p) => !hasResult(p, room.round)).length;
    const head = S.locked ? 'Locked in ✓' : "Time's up";
    ui.setStatus(waiting > 0
      ? `${head} — waiting for ${waiting} more player${waiting === 1 ? '' : 's'}`
      : `${head} — revealing…`);
  }

  if (allLockedIn(players, room.round)) callFinish();
}

async function onLocked({ markers, lockInMs }) {
  S.locked = true;
  const [a, b] = markers;
  const { grid, open } = S.deal;
  const hand = evaluate([grid[a], grid[b], ...open]);
  ui.setStatus('Locking in…');
  try {
    await S.backend.submitResult(S.me.id, {
      round: S.room.round,
      markerA: a,
      markerB: b,
      handCategory: hand.category,
      handTiebreak: hand.tiebreak,
      lockInMs,
    });
    scheduleSync();
  } catch (err) {
    console.error(err);
    ui.setStatus(`Couldn't lock in: ${err.message}`);
  }
}

function onTimeout() {
  S.timedOut = true;
  if (S.room) renderPlaying();
  callFinish();
}

async function callFinish() {
  if (S.finishing || !S.backend || !S.code || S.room?.status !== 'playing') return;
  S.finishing = true;
  try {
    const status = await S.backend.finishRound(S.code);
    if (status === 'reveal') scheduleSync();
  } catch (err) {
    console.warn('finish_round', err);
  } finally {
    S.finishing = false;
  }
}

// ---------- Reveal + leaderboard ----------

function renderReveal() {
  const { room, me, players } = S;
  const first = S.view !== 'reveal' || S.shownRound !== room.round;
  const { grid, open } = first || !S.deal ? deal(room.seed, room.n) : S.deal;
  const letters = lettersFor(room.n);
  const best = bestPair(grid, open);
  const mine = hasResult(me, room.round) ? [me.markerA, me.markerB] : [];

  if (first) {
    stopRound();
    clearTimers();
    S.view = 'reveal';
    S.shownRound = room.round;
    S.deal = { grid, open };
    ui.showPlay();
    ui.renderGrid(grid, letters);
    ui.renderOpenCards(open, { animate: false });
    ui.renderMarkers(mine);
    ui.renderBestPair(best.indices);
    ui.labelRevealed(grid, letters, mine, best.indices);
    ui.setCountdown(null, false);
    ui.setStatus('');
  }
  ui.setLiveBar(`Room ${room.id} · Round ${room.round} · ${room.n} cards`);

  const rows = rankRound(players, room.round).map(({ player: p, rank, roundPoints }) => {
    const played = hasResult(p, room.round);
    return {
      rank,
      name: p.name,
      isMe: p.id === me.id,
      handName: played ? CATEGORY_NAMES[p.handCategory] : null,
      cards: played
        ? `${letters[p.markerA]} ${cardLabel(grid[p.markerA])} + ${letters[p.markerB]} ${cardLabel(grid[p.markerB])}`
        : '',
      seconds: played ? (p.lockInMs / 1000).toFixed(1) : null,
      roundPoints,
      total: p.points,
    };
  });

  const myHand = mine.length ? evaluate([grid[mine[0]], grid[mine[1]], ...open]) : null;
  const perfect = myHand && myHand.category === best.hand.category
    && myHand.tiebreak.join() === best.hand.tiebreak.join();
  const host = isHost();
  const notes = [];
  if (perfect) notes.push('✅ You found the best possible hand.');
  else if (myHand) notes.push('❌ Not quite the best hand this time.');
  else notes.push("You didn't lock in this round.");
  if (!host) notes.push('Waiting for the host to start the next round…');

  ui.renderLeaderboard({
    title: `Round ${room.round} results`,
    best: `Best possible: ${best.hand.name} (${letters[best.indices[0]]} + ${letters[best.indices[1]]})`,
    rows,
    note: notes.join(' '),
    isHost: host,
  });
  if (first) ui.focusLeaderboard();
}
