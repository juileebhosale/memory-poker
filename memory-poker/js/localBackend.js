// "Local test mode" backend: rooms live in this browser only.
// Open several tabs to play against yourself. Same interface and same rules as
// supabaseBackend.js + supabase/schema.sql, so the game code can't tell the difference.
//
// Storage: localStorage (shared by all tabs of this site), one tab = one player
// (id kept in sessionStorage, so a refreshed tab is still the same player).
// Changes are announced to other tabs with BroadcastChannel.
// navigator.locks makes each change atomic across tabs.
import { roundTimeline, START_DELAY_MS, MIN_PLAYERS, MAX_PLAYERS, MAX_ROOMS_PER_HOUR, ROUND_POINTS, rankRound } from './liveRules.js';
import { isNameBlocked } from './nameFilter.js';

const DB_KEY = 'memory-poker-local-db';
const USER_KEY = 'memory-poker-local-user';
const CHANNEL = 'memory-poker-local';
const GRACE_MS = 2_000;          // same 2s grace as the SQL
const PRESENCE_EVERY_MS = 2_000;
const PRESENCE_TIMEOUT_MS = 6_000;

const uuid = () => globalThis.crypto.randomUUID();

function load() {
  try { return JSON.parse(localStorage.getItem(DB_KEY)) ?? { rooms: {}, players: {} }; } catch { return { rooms: {}, players: {} }; }
}

function save(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

async function tx(fn) {
  const run = () => {
    const db = load();
    const out = fn(db);
    save(db);
    return out;
  };
  return navigator.locks ? navigator.locks.request(DB_KEY, run) : run();
}

function fail(message) {
  throw new Error(message);
}

export async function createLocalBackend() {
  let userId = sessionStorage.getItem(USER_KEY);
  if (!userId) {
    userId = uuid();
    sessionStorage.setItem(USER_KEY, userId);
  }
  const bc = new BroadcastChannel(CHANNEL);
  const listeners = new Set();
  bc.onmessage = (e) => listeners.forEach((fn) => fn(e.data));
  const announce = (roomId) => {
    const msg = { type: 'change', roomId };
    bc.postMessage(msg);
    listeners.forEach((fn) => fn(msg)); // this tab too
  };

  const roomPlayers = (db, roomId) => Object.values(db.players)
    .filter((p) => p.roomId === roomId)
    .sort((a, b) => a.createdAt - b.createdAt);

  return {
    kind: 'local',
    userId,

    async serverNowSample() {
      const t = Date.now();
      return { sentAt: t, serverNow: t, receivedAt: t };
    },

    async createRoom({ id, seed, n }) {
      const room = await tx((db) => {
        if (db.rooms[id]) return null;
        const recent = Object.values(db.rooms)
          .filter((r) => r.hostUserId === userId && r.createdAt > Date.now() - 3_600_000).length;
        if (recent >= MAX_ROOMS_PER_HOUR) fail("You've made a lot of rooms in the last hour. Please try again later.");
        db.rooms[id] = {
          id, seed, n, status: 'lobby', round: 0, startAt: null,
          hostUserId: userId, scoredRound: 0, createdAt: Date.now(),
        };
        return db.rooms[id];
      });
      if (room) announce(id);
      return room;
    },

    async getRoom(id) {
      return load().rooms[id] ?? null;
    },

    async listPlayers(roomId) {
      return roomPlayers(load(), roomId);
    },

    async joinRoom(roomId, name) {
      const player = await tx((db) => {
        const room = db.rooms[roomId];
        if (!room) fail('Room not found');
        if (isNameBlocked(name)) fail('Please choose a different name.');
        const existing = Object.values(db.players).find((p) => p.roomId === roomId && p.userId === userId);
        if (existing) {
          existing.name = name.trim();
          return existing;
        }
        if (roomPlayers(db, roomId).length >= MAX_PLAYERS) fail(`This room is full (${MAX_PLAYERS} players max).`);
        const p = {
          id: uuid(), roomId, userId, name: name.trim(), joinedRound: room.round + 1,
          round: null, markerA: null, markerB: null, handCategory: null, handTiebreak: null,
          lockInMs: null, points: 0, createdAt: Date.now(),
        };
        db.players[p.id] = p;
        return p;
      });
      announce(roomId);
      return player;
    },

    async leaveRoom(playerId) {
      const roomId = await tx((db) => {
        const p = db.players[playerId];
        if (!p || p.userId !== userId) return null;
        delete db.players[playerId];
        return p.roomId;
      });
      if (roomId) announce(roomId);
    },

    async startRound(roomId, seed) {
      const room = await tx((db) => {
        const r = db.rooms[roomId];
        if (!r) fail('Room not found');
        if (r.hostUserId !== userId) fail('Only the host can start a round');
        if (r.status === 'playing') fail('A round is already running');
        if (roomPlayers(db, roomId).length < MIN_PLAYERS) fail('Need at least 2 players');
        Object.assign(r, { seed, round: r.round + 1, status: 'playing', startAt: Date.now() + START_DELAY_MS });
        return r;
      });
      announce(roomId);
      return room;
    },

    async submitResult(playerId, res) {
      const roomId = await tx((db) => {
        const p = db.players[playerId];
        if (!p || p.userId !== userId) fail('Not your player');
        const r = db.rooms[p.roomId];
        if (r.status !== 'playing' || res.round !== r.round) fail('No round is running');
        if (Date.now() > roundTimeline(r.startAt, r.n).deadline + GRACE_MS) fail('Too late to lock in');
        if (res.round < p.joinedRound) fail('You join from the next round');
        Object.assign(p, {
          round: res.round, markerA: res.markerA, markerB: res.markerB,
          handCategory: res.handCategory, handTiebreak: res.handTiebreak, lockInMs: res.lockInMs,
        });
        return p.roomId;
      });
      announce(roomId);
    },

    async finishRound(roomId) {
      const result = await tx((db) => {
        const r = db.rooms[roomId];
        if (!r) fail('Room not found');
        const players = roomPlayers(db, roomId);
        if (!players.some((p) => p.userId === userId)) fail('Not a player in this room');
        if (r.status !== 'playing') return r.status;
        const inRound = players.filter((p) => p.joinedRound <= r.round);
        const allIn = inRound.length > 0 && inRound.every((p) => p.round === r.round && p.handCategory != null);
        if (!allIn && Date.now() < roundTimeline(r.startAt, r.n).deadline + GRACE_MS) return 'waiting';
        for (const row of rankRound(players, r.round)) {
          if (row.rank !== null && row.rank <= ROUND_POINTS.length) db.players[row.player.id].points += row.roundPoints;
        }
        r.status = 'reveal';
        r.scoredRound = r.round;
        return 'reveal';
      });
      if (result === 'reveal') announce(roomId);
      return result;
    },

    subscribe(roomId, me, { onChange, onPresence, onStatus }) {
      const seen = new Map([[userId, Date.now()]]);
      const report = () => {
        const now = Date.now();
        for (const [id, t] of seen) if (now - t > PRESENCE_TIMEOUT_MS && id !== userId) seen.delete(id);
        onPresence(new Set(seen.keys()));
      };
      const listener = (msg) => {
        if (msg.roomId !== roomId) return;
        if (msg.type === 'change') onChange();
        if (msg.type === 'presence') {
          const isNew = !seen.has(msg.userId);
          seen.set(msg.userId, Date.now());
          if (isNew) {
            report();
            bc.postMessage({ type: 'presence', roomId, userId }); // say hi back so they see us at once
          }
        }
        if (msg.type === 'leave') {
          seen.delete(msg.userId);
          report();
        }
      };
      listeners.add(listener);
      const beat = () => { bc.postMessage({ type: 'presence', roomId, userId }); report(); };
      const timer = setInterval(beat, PRESENCE_EVERY_MS);
      const onUnload = () => bc.postMessage({ type: 'leave', roomId, userId });
      window.addEventListener('pagehide', onUnload);
      beat();
      onStatus?.('SUBSCRIBED');
      queueMicrotask(onChange);
      return () => {
        clearInterval(timer);
        listeners.delete(listener);
        window.removeEventListener('pagehide', onUnload);
        onUnload();
      };
    },
  };
}
