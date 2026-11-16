import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, compare, bestPair } from '../memory-poker/js/handEvaluator.js';
import { hand } from './helpers.js';

const ev = (s) => evaluate(hand(s));

// ---------- One test per category ----------

test('high card', () => {
  const r = ev('As Jd 8c 5h 3s');
  assert.equal(r.category, 0);
  assert.equal(r.name, 'High card');
  assert.deepEqual(r.tiebreak, [14, 11, 8, 5, 3]);
});

test('pair', () => {
  const r = ev('Ks Kd 9c 5h 3s');
  assert.equal(r.category, 1);
  assert.deepEqual(r.tiebreak, [13, 9, 5, 3]);
});

test('two pair', () => {
  const r = ev('Ks Kd 5c 5h 3s');
  assert.equal(r.category, 2);
  assert.deepEqual(r.tiebreak, [13, 5, 3]);
});

test('three of a kind', () => {
  const r = ev('7s 7d 7c Kh 3s');
  assert.equal(r.category, 3);
  assert.deepEqual(r.tiebreak, [7, 13, 3]);
});

test('straight', () => {
  const r = ev('9s 8d 7c 6h 5s');
  assert.equal(r.category, 4);
  assert.deepEqual(r.tiebreak, [9]);
});

test('flush', () => {
  const r = ev('Ah Jh 8h 5h 3h');
  assert.equal(r.category, 5);
  assert.deepEqual(r.tiebreak, [14, 11, 8, 5, 3]);
});

test('full house', () => {
  const r = ev('4s 4d 4c 9h 9s');
  assert.equal(r.category, 6);
  assert.deepEqual(r.tiebreak, [4, 9]);
});

test('four of a kind', () => {
  const r = ev('Qs Qd Qc Qh 2s');
  assert.equal(r.category, 7);
  assert.deepEqual(r.tiebreak, [12, 2]);
});

test('straight flush (including royal)', () => {
  assert.equal(ev('9c 8c 7c 6c 5c').category, 8);
  const royal = ev('As Ks Qs Js Ts');
  assert.equal(royal.category, 8);
  assert.equal(royal.name, 'Straight flush');
  assert.deepEqual(royal.tiebreak, [14]);
});

// ---------- Straight edge cases ----------

test('ace-low straight counts and is 5-high', () => {
  const r = ev('As 2d 3c 4h 5s');
  assert.equal(r.category, 4);
  assert.deepEqual(r.tiebreak, [5]);
});

test('ace-low straight loses to 6-high straight', () => {
  assert.equal(compare(ev('As 2d 3c 4h 5s'), ev('2s 3d 4c 5h 6s')), -1);
});

test('ace-low straight flush counts', () => {
  const r = ev('Ad 2d 3d 4d 5d');
  assert.equal(r.category, 8);
  assert.deepEqual(r.tiebreak, [5]);
});

test('no wrap-around straight (Q-K-A-2-3)', () => {
  assert.equal(ev('Qs Kd Ac 2h 3s').category, 0);
});

// ---------- Category order ----------

test('categories rank in order from high card to straight flush', () => {
  const ladder = [
    'As Jd 8c 5h 3s',
    'Ks Kd 9c 5h 3s',
    'Ks Kd 5c 5h 3s',
    '7s 7d 7c Kh 3s',
    '9s 8d 7c 6h 5s',
    'Ah Jh 8h 5h 3h',
    '4s 4d 4c 9h 9s',
    'Qs Qd Qc Qh 2s',
    '9c 8c 7c 6c 5c',
  ].map(ev);
  for (let i = 0; i < ladder.length - 1; i++) {
    assert.equal(compare(ladder[i + 1], ladder[i]), 1, `category ${i + 1} should beat ${i}`);
  }
});

// ---------- Tie-breaks ----------

test('pair of kings beats pair of queens', () => {
  assert.equal(compare(ev('Ks Kd 4c 3h 2s'), ev('Qs Qd Ac Jh 9s')), 1);
});

test('same pair compares kickers', () => {
  assert.equal(compare(ev('Ks Kd Ac 3h 2s'), ev('Kh Kc Qc Jh 9s')), 1);
  assert.equal(compare(ev('Ks Kd Ac 9h 2s'), ev('Kh Kc Ad 9c 3s')), -1);
});

test('two pair: higher top pair, then lower pair, then kicker', () => {
  assert.equal(compare(ev('As Ad 2c 2h 3s'), ev('Ks Kd Qc Qh Js')), 1);
  assert.equal(compare(ev('Ks Kd 6c 6h 2s'), ev('Kh Kc 5c 5h As')), 1);
  assert.equal(compare(ev('Ks Kd 6c 6h 2s'), ev('Kh Kc 6d 6s 3s')), -1);
});

test('full house compares trips before pair', () => {
  assert.equal(compare(ev('5s 5d 5c 2h 2s'), ev('4s 4d 4c Ah As')), 1);
});

test('flush compares cards high to low', () => {
  assert.equal(compare(ev('Ah Jh 8h 5h 3h'), ev('As Js 8s 4s 3s')), 1);
});

test('equal hands with different suits tie', () => {
  assert.equal(compare(ev('Ks Kd 9c 5h 3s'), ev('Kh Kc 9d 5s 3c')), 0);
  assert.equal(compare(ev('9s 8d 7c 6h 5s'), ev('9h 8c 7d 6s 5h')), 0);
});

test('evaluate rejects anything but 5 cards', () => {
  assert.throws(() => evaluate(hand('As Kd Qc Jh')));
});

// ---------- bestPair ----------

// Brute-force reference used to check bestPair independently.
function bruteBest(grid, open) {
  let best = null;
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid.length; j++) {
      if (i === j) continue;
      const h = evaluate([grid[i], grid[j], ...open]);
      if (!best || compare(h, best) > 0) best = h;
    }
  }
  return best;
}

test('bestPair finds the hidden flush', () => {
  const open = hand('Ah 9h 4h');
  const grid = hand('As Ad 2h 7h Kc Qd 3s 5c');
  const r = bestPair(grid, open);
  assert.equal(r.hand.name, 'Flush');
  assert.deepEqual(r.indices, [2, 3]); // 2h + 7h
});

test('bestPair prefers four of a kind over a full house', () => {
  const open = hand('8s 8d Kc');
  // 8h + 8c = quads; Ks + Kd = full house (K-K-K-8-8)
  const grid = hand('Ks 8h 2c Kd 8c 3d Js 4h');
  const r = bestPair(grid, open);
  assert.equal(r.hand.name, 'Four of a kind');
  assert.deepEqual(r.indices, [1, 4]);
});

test('bestPair finds a straight flush in a 16-card grid', () => {
  const open = hand('9s Ts Js');
  const grid = hand('2c 3d 4h 5c 6d 7h Qs 8c 9d 2h Ks 3c 4d Jh Jd Jc');
  const r = bestPair(grid, open);
  assert.equal(r.hand.name, 'Straight flush');
  assert.deepEqual(r.indices, [6, 10]); // Qs + Ks -> 9-K straight flush
  assert.deepEqual(r.hand.tiebreak, [13]);
});

test('bestPair picks the stronger of two same-category hands', () => {
  const open = hand('2s 7d 9c');
  // Pairs available: 2s pair, 7s pair, 9s pair, plus Ah Kd kickers
  const grid = hand('2h 7c 9h Ah 3d 4s 5c 6d');
  const r = bestPair(grid, open);
  // 9h + 7c gives two pair, nines and sevens: the best possible
  assert.equal(r.hand.name, 'Two pair');
  assert.deepEqual(r.hand.tiebreak, [9, 7, 2]);
  assert.deepEqual(r.indices, [1, 2]);
});

test('bestPair on ties returns the lowest indices', () => {
  const open = hand('2s 3d 4c');
  // Any A + 5 makes a 5-high straight; first such pair is (0, 1)
  const grid = hand('Ah 5h Ad 5d 8s 9s Ts Js');
  const r = bestPair(grid, open);
  assert.equal(r.hand.name, 'Straight');
  assert.deepEqual(r.indices, [0, 1]);
});

test('bestPair matches brute force on many random deals', async () => {
  const { deal } = await import('../memory-poker/js/deck.js');
  for (let s = 0; s < 300; s++) {
    for (const n of [8, 16]) {
      const { grid, open } = deal(`bp-${s}`, n);
      const r = bestPair(grid, open);
      assert.equal(compare(r.hand, bruteBest(grid, open)), 0);
      const [i, j] = r.indices;
      assert.ok(i < j);
      assert.equal(compare(evaluate([grid[i], grid[j], ...open]), r.hand), 0);
    }
  }
});
