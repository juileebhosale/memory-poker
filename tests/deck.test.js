import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeck, cardLabel, deal } from '../memory-poker/js/deck.js';

const key = (card) => `${card.rank}${card.suit}`;

test('createDeck has 52 unique cards', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map(key)).size, 52);
});

test('cardLabel formats ranks and suits', () => {
  assert.equal(cardLabel({ rank: 14, suit: 's' }), 'A♠');
  assert.equal(cardLabel({ rank: 10, suit: 'h' }), '10♥');
  assert.equal(cardLabel({ rank: 12, suit: 'd' }), 'Q♦');
  assert.equal(cardLabel({ rank: 2, suit: 'c' }), '2♣');
});

test('same seed gives the same deal', () => {
  for (const n of [8, 16]) {
    assert.deepEqual(deal('k3f9', n), deal('k3f9', n));
  }
});

test('different seeds usually give different deals', () => {
  const deals = ['a', 'b', 'c', 'd', 'e'].map((s) => JSON.stringify(deal(s, 16)));
  assert.equal(new Set(deals).size, deals.length);
});

test('deal sizes are right and grid + open never share a card', () => {
  for (const n of [8, 16]) {
    for (let s = 0; s < 200; s++) {
      const { grid, open } = deal(`seed-${s}`, n);
      assert.equal(grid.length, n);
      assert.equal(open.length, 3);
      const all = [...grid, ...open].map(key);
      assert.equal(new Set(all).size, n + 3);
    }
  }
});

test('deal rejects n other than 8 or 16', () => {
  assert.throws(() => deal('x', 10));
});
