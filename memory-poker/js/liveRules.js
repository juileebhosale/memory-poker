// Rules for live rooms. Pure functions, no DOM, no network, no timers.
// The same ranking rules are written in SQL in supabase/schema.sql (finish_round);
// keep the two in step.
import { compare } from './handEvaluator.js';

// ---------- Timeline ----------
// Every time below is in SERVER milliseconds (see clock offset).
export const START_DELAY_MS = 5_000;   // host clicks Start -> round starts 5s later
export const MEMORIZE_MS = 60_000;     // cards face up
export const PLACE_MS = 30_000;        // time to lock in, counted from the flip
export const MIN_PLAYERS = 2;

// Phase of a round at server time `now`.
//   countdown: before startAt ("Starting in 3...")
//   memorize:  startAt .. flipAt
//   place:     flipAt .. deadline
//   over:      after the deadline
export function roundTimeline(startAtMs) {
  const flipAt = startAtMs + MEMORIZE_MS;
  return { startAt: startAtMs, flipAt, deadline: flipAt + PLACE_MS };
}

export function phaseAt(startAtMs, nowMs) {
  const t = roundTimeline(startAtMs);
  if (nowMs < t.startAt) return 'countdown';
  if (nowMs < t.flipAt) return 'memorize';
  if (nowMs < t.deadline) return 'place';
  return 'over';
}

// ---------- Room codes ----------
// 5 letters, no I or O (they look like 1 and 0).
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_RE = /^[A-HJ-NP-Z]{5}$/;

// bytes: any 5 numbers 0..255 (from crypto.getRandomValues), so this stays pure.
export function roomCodeFromBytes(bytes) {
  return Array.from(bytes.slice(0, 5), (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}

// Clean up what a person typed or what came from a link. Returns '' if invalid.
export function normalizeRoomCode(input) {
  const code = String(input ?? '').trim().toUpperCase();
  return ROOM_RE.test(code) ? code : '';
}

// ---------- Clock sync ----------
// sample: { sentAt, serverNow, receivedAt } — client ms before/after asking the server for now().
// Offset = how far the server clock is ahead of this device. Server time = Date.now() + offset.
// Uses the sample with the shortest round trip; it has the least uncertainty.
export function clockOffset(samples) {
  if (!samples.length) return 0;
  const best = samples.reduce((a, b) =>
    (b.receivedAt - b.sentAt) < (a.receivedAt - a.sentAt) ? b : a);
  return Math.round(best.serverNow - (best.sentAt + best.receivedAt) / 2);
}

// ---------- Players and ranking ----------
// A player row as the client sees it (camelCase):
// { id, userId, name, joinedRound, round, markerA, markerB, handCategory, handTiebreak,
//   lockInMs, points }

// Players who take part in round r (joined before it started).
export function playersInRound(players, r) {
  return players.filter((p) => p.joinedRound <= r);
}

export function hasResult(p, r) {
  return p.round === r && p.handCategory !== null && p.handCategory !== undefined;
}

export function allLockedIn(players, r) {
  const inRound = playersInRound(players, r);
  return inRound.length > 0 && inRound.every((p) => hasResult(p, r));
}

// Same order as the SQL in finish_round:
// hand category desc, tiebreak desc (left to right), lock-in time asc, then name, then id.
function byResult(a, b) {
  const h = compare(
    { category: b.handCategory, tiebreak: b.handTiebreak },
    { category: a.handCategory, tiebreak: a.handTiebreak },
  );
  if (h !== 0) return h;
  if (a.lockInMs !== b.lockInMs) return a.lockInMs - b.lockInMs;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export const ROUND_POINTS = [3, 2, 1];

// Leaderboard for round r. Players with a hand first (best first), then players
// who didn't lock in (no hand, ranked last). Each row: { player, rank, roundPoints }.
export function rankRound(players, r) {
  const inRound = playersInRound(players, r);
  const withHand = inRound.filter((p) => hasResult(p, r)).sort(byResult);
  const without = inRound.filter((p) => !hasResult(p, r))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return [
    ...withHand.map((player, i) => ({ player, rank: i + 1, roundPoints: ROUND_POINTS[i] ?? 0 })),
    ...without.map((player) => ({ player, rank: null, roundPoints: 0 })),
  ];
}

// Running totals, highest first (ties by name).
export function standings(players) {
  return [...players].sort((a, b) => (b.points - a.points) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
