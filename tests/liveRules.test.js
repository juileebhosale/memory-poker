import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  roundTimeline, phaseAt, MEMORIZE_MS, PLACE_MS,
  roomCodeFromBytes, normalizeRoomCode, ROOM_ALPHABET,
  clockOffset, playersInRound, allLockedIn, rankRound, standings,
} from '../memory-poker/js/liveRules.js';
import { evaluate } from '../memory-poker/js/handEvaluator.js';
import { hand } from './helpers.js';

// ---------- Timeline ----------

test('roundTimeline: flip after 60s, deadline 30s after the flip', () => {
  const t = roundTimeline(1_000_000);
  assert.equal(t.flipAt, 1_000_000 + MEMORIZE_MS);
  assert.equal(t.deadline, 1_000_000 + MEMORIZE_MS + PLACE_MS);
});

test('phaseAt walks countdown -> memorize -> place -> over', () => {
  const s = 50_000;
  assert.equal(phaseAt(s, s - 1), 'countdown');
  assert.equal(phaseAt(s, s), 'memorize');
  assert.equal(phaseAt(s, s + MEMORIZE_MS - 1), 'memorize');
  assert.equal(phaseAt(s, s + MEMORIZE_MS), 'place');
  assert.equal(phaseAt(s, s + MEMORIZE_MS + PLACE_MS - 1), 'place');
  assert.equal(phaseAt(s, s + MEMORIZE_MS + PLACE_MS), 'over');
});

// ---------- Room codes ----------

test('room codes are 5 letters from the alphabet without I and O', () => {
  assert.ok(!ROOM_ALPHABET.includes('I') && !ROOM_ALPHABET.includes('O'));
  const code = roomCodeFromBytes([0, 1, 2, 255, 100]);
  assert.match(code, /^[A-HJ-NP-Z]{5}$/);
  assert.equal(roomCodeFromBytes([0, 0, 0, 0, 0]), 'AAAAA');
});

test('normalizeRoomCode trims, uppercases and rejects bad codes', () => {
  assert.equal(normalizeRoomCode(' abcde '), 'ABCDE');
  assert.equal(normalizeRoomCode('ABCD'), '');
  assert.equal(normalizeRoomCode('ABCDEF'), '');
  assert.equal(normalizeRoomCode('ABCD1'), '');
  assert.equal(normalizeRoomCode('ABCDO'), ''); // O not allowed
  assert.equal(normalizeRoomCode(null), '');
});

// ---------- Clock sync ----------

test('clockOffset uses the fastest round trip', () => {
  // Server is 10s ahead. Slow sample has a misleading midpoint.
  const samples = [
    { sentAt: 1000, serverNow: 11_900, receivedAt: 2000 }, // rtt 1000 -> offset 10_400 (noisy)
    { sentAt: 3000, serverNow: 13_050, receivedAt: 3100 }, // rtt 100  -> offset 10_000
  ];
  assert.equal(clockOffset(samples), 10_000);
  assert.equal(clockOffset([]), 0);
});

test('clockOffset handles a device clock that is ahead (negative offset)', () => {
  assert.equal(clockOffset([{ sentAt: 100_000, serverNow: 40_050, receivedAt: 100_100 }]), -60_000);
});

// ---------- Players and ranking ----------

function player(id, name, { joinedRound = 1, round = null, cards = null, lockInMs = null, points = 0 } = {}) {
  const ev = cards ? evaluate(hand(cards)) : null;
  return {
    id, userId: 'u-' + id, name, joinedRound, round, points,
    markerA: cards ? 0 : null, markerB: cards ? 1 : null,
    handCategory: ev ? ev.category : null,
    handTiebreak: ev ? ev.tiebreak : null,
    lockInMs,
  };
}

test('playersInRound skips people who joined after the round started', () => {
  const ps = [player('a', 'Ana'), player('b', 'Ben', { joinedRound: 2 })];
  assert.deepEqual(playersInRound(ps, 1).map((p) => p.id), ['a']);
  assert.deepEqual(playersInRound(ps, 2).map((p) => p.id), ['a', 'b']);
});

test('allLockedIn only counts players in the round, and needs this round\'s result', () => {
  const ps = [
    player('a', 'Ana', { round: 1, cards: 'As Ad 2c 3h 4s', lockInMs: 5000 }),
    player('b', 'Ben', { round: 1, cards: 'Ks Kd 2c 3h 4s', lockInMs: 6000 }),
    player('c', 'Cy', { joinedRound: 2 }), // late joiner: doesn't block round 1
  ];
  assert.equal(allLockedIn(ps, 1), true);
  // Round 2: results from round 1 don't count.
  assert.equal(allLockedIn(ps, 2), false);
});

test('rankRound: better hand first, then faster lock-in, no-hand players last with 0 points', () => {
  const ps = [
    player('a', 'Ana', { round: 1, cards: 'Ks Kd 2c 3h 4s', lockInMs: 4000 }), // pair of kings, fast
    player('b', 'Ben', { round: 1, cards: 'As Ad 2c 3h 4s', lockInMs: 9000 }), // pair of aces, slow
    player('c', 'Cy', { round: 1, cards: 'Ah Ac 2d 3s 4c', lockInMs: 7000 }),  // pair of aces, faster
    player('d', 'Dee', { round: 1, cards: 'Kh Kc 2d 3s 4c', lockInMs: 8000 }), // pair of kings, slower
    player('e', 'Eli'), // didn't lock in
  ];
  const r = rankRound(ps, 1);
  assert.deepEqual(r.map((x) => x.player.id), ['c', 'b', 'a', 'd', 'e']);
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 3, 4, null]);
  assert.deepEqual(r.map((x) => x.roundPoints), [3, 2, 1, 0, 0]);
});

test('rankRound ignores stale results from an earlier round', () => {
  const ps = [
    player('a', 'Ana', { round: 1, cards: 'As Ad Ac 3h 4s', lockInMs: 1000 }), // round 1 result only
    player('b', 'Ben', { round: 2, cards: '2s 2d 5c 3h 4s', lockInMs: 9000 }),
  ];
  const r = rankRound(ps, 2);
  assert.deepEqual(r.map((x) => [x.player.id, x.rank]), [['b', 1], ['a', null]]);
});

test('standings sorts by total points, then name', () => {
  const ps = [player('a', 'Zed', { points: 3 }), player('b', 'Amy', { points: 3 }), player('c', 'Bo', { points: 5 })];
  assert.deepEqual(standings(ps).map((p) => p.name), ['Bo', 'Amy', 'Zed']);
});
