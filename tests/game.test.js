import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleMarker, secondsLeft, parseParams, newSeed } from '../memory-poker/js/game.js';

test('toggleMarker adds, removes, and caps at 2', () => {
  let m = [];
  m = toggleMarker(m, 3);
  assert.deepEqual(m, [3]);
  m = toggleMarker(m, 7);
  assert.deepEqual(m, [3, 7]);
  m = toggleMarker(m, 1); // already 2 -> unchanged
  assert.deepEqual(m, [3, 7]);
  m = toggleMarker(m, 3); // remove
  assert.deepEqual(m, [7]);
  m = toggleMarker(m, 7);
  assert.deepEqual(m, []);
});

test('toggleMarker does not change its input', () => {
  const m = [2];
  toggleMarker(m, 5);
  assert.deepEqual(m, [2]);
});

test('secondsLeft rounds up and stops at 0', () => {
  assert.equal(secondsLeft(60_000, 0), 60);
  assert.equal(secondsLeft(60_000, 1), 60);
  assert.equal(secondsLeft(60_000, 59_001), 1);
  assert.equal(secondsLeft(60_000, 60_000), 0);
  assert.equal(secondsLeft(60_000, 75_000), 0); // tab lagged past the end
});

test('parseParams reads seed and only accepts n = 8 or 16', () => {
  assert.deepEqual(parseParams('?seed=k3f9&n=16'), { seed: 'k3f9', n: 16, from: '', room: '' });
  assert.deepEqual(parseParams('?seed=abc&n=8'), { seed: 'abc', n: 8, from: '', room: '' });
  assert.deepEqual(parseParams('?n=10'), { seed: null, n: null, from: '', room: '' });
  assert.deepEqual(parseParams(''), { seed: null, n: null, from: '', room: '' });
});

test('newSeed gives short URL-safe strings', () => {
  const s = newSeed();
  assert.match(s, /^[a-z0-9]{5}$/);
  assert.notEqual(newSeed(), newSeed());
});

// ---------- Reveal: scoring and sharing ----------
import { scoreRound, shareLink, shareText } from '../memory-poker/js/game.js';
import { hand } from './helpers.js';

test('scoreRound: perfect when the player finds the best pair', () => {
  const open = hand('Ah 9h 4h');
  const grid = hand('As Ad 2h 7h Kc Qd 3s 5c');
  const r = scoreRound(grid, open, [3, 2]); // 7h + 2h = flush, order of clicks doesn't matter
  assert.equal(r.perfect, true);
  assert.equal(r.yours.name, 'Flush');
  assert.equal(r.best.name, 'Flush');
  assert.deepEqual(r.bestIndices, [2, 3]);
});

test('scoreRound: not quite when a better pair exists', () => {
  const open = hand('Ah 9h 4h');
  const grid = hand('As Ad 2h 7h Kc Qd 3s 5c');
  const r = scoreRound(grid, open, [0, 1]); // trip aces, but a flush was there
  assert.equal(r.perfect, false);
  assert.equal(r.yours.name, 'Three of a kind');
  assert.equal(r.best.name, 'Flush');
  assert.deepEqual(r.bestIndices, [2, 3]);
});

test('scoreRound: an equally good pair counts as perfect and is shown as the best pair', () => {
  const open = hand('2s 3d 4c');
  const grid = hand('Ah 5h Ad 5d 8s 9s Ts Js'); // A+5 makes a straight, two ways
  const r = scoreRound(grid, open, [2, 3]);
  assert.equal(r.perfect, true);
  assert.deepEqual(r.bestIndices, [2, 3]);
});

test('shareLink is origin + /memory-poker/ with seed and n', () => {
  assert.equal(shareLink('https://juileebhosale.com', 'k3f9', 16), 'https://juileebhosale.com/memory-poker/?seed=k3f9&n=16');
  assert.equal(shareLink('http://localhost:8000', 'ab', 8), 'http://localhost:8000/memory-poker/?seed=ab&n=8');
  // Works the same whatever host serves it (e.g. the .vercel.app URL).
  assert.equal(shareLink('https://memory-poker.vercel.app', 'x', 8), 'https://memory-poker.vercel.app/memory-poker/?seed=x&n=8');
});

test('shareText matches the agreed format', () => {
  const t = shareText({
    n: 16, seed: 'k3f9', yourName: 'Flush', bestName: 'Flush',
    perfect: true, lockInMs: 14_230, link: 'https://x.io/?seed=k3f9&n=16',
  });
  assert.equal(t, 'Memory Poker 16 #k3f9 — Flush (best: Flush) ✅ 14.2s\nhttps://x.io/?seed=k3f9&n=16');
  const miss = shareText({
    n: 8, seed: 'ab', yourName: 'Pair', bestName: 'Straight',
    perfect: false, lockInMs: 9_000, link: 'L',
  });
  assert.match(miss, /— Pair \(best: Straight\) ❌ 9\.0s\nL$/);
});

// ---------- Polish: from param and keyboard ----------
import { letterToIndex } from '../memory-poker/js/game.js';

test('parseParams reads and trims from, capped at 20 chars', () => {
  assert.equal(parseParams('?seed=a&n=8&from=%20Juilee%20').from, 'Juilee');
  assert.equal(parseParams('?seed=a&n=8').from, '');
  assert.equal(parseParams('?from=' + 'x'.repeat(40)).from.length, 20);
});

test('shareLink adds from only when a name exists', () => {
  assert.equal(shareLink('https://x.io/', 'k3f9', 8, 'Juilee'), 'https://x.io/memory-poker/?seed=k3f9&n=8&from=Juilee');
  assert.equal(shareLink('https://x.io/', 'k3f9', 8, ''), 'https://x.io/memory-poker/?seed=k3f9&n=8');
  assert.equal(shareLink('https://x.io/', 'k3f9', 8, 'Ana Maria'), 'https://x.io/memory-poker/?seed=k3f9&n=8&from=Ana+Maria');
});

test('letterToIndex maps letters within the grid only', () => {
  assert.equal(letterToIndex('a', 8), 0);
  assert.equal(letterToIndex('H', 8), 7);
  assert.equal(letterToIndex('i', 8), -1);
  assert.equal(letterToIndex('p', 16), 15);
  assert.equal(letterToIndex('Enter', 16), -1);
  assert.equal(letterToIndex('1', 16), -1);
});

// ---------- Live rooms: links ----------
import { roomLink } from '../memory-poker/js/game.js';

test('parseParams reads a room code and cleans it up', () => {
  assert.equal(parseParams('?room=abcde').room, 'ABCDE');
  assert.equal(parseParams('?room=ABC').room, '');
  assert.equal(parseParams('?room=ABCDO').room, '');
});

test('roomLink is origin + /memory-poker/?room=CODE', () => {
  assert.equal(roomLink('https://juileebhosale.com', 'ABCDE'), 'https://juileebhosale.com/memory-poker/?room=ABCDE');
});
