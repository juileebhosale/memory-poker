import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HAND_RANKINGS } from '../memory-poker/js/handRankings.js';
import { evaluate, compare, CATEGORY_NAMES } from '../memory-poker/js/handEvaluator.js';

test('rankings panel lists every hand category, best first', () => {
  const cats = HAND_RANKINGS.map((h) => h.category);
  assert.deepEqual([...new Set(cats)], [8, 7, 6, 5, 4, 3, 2, 1, 0]);
});

test('each example hand evaluates to its stated category', () => {
  for (const h of HAND_RANKINGS) {
    assert.equal(h.cards.length, 5, h.name);
    assert.equal(h.counts.length, 5, h.name);
    assert.equal(evaluate(h.cards).category, h.category, h.name);
  }
});

test('names match the game, except Royal flush', () => {
  for (const h of HAND_RANKINGS) {
    if (h.name === 'Royal flush') continue;
    assert.equal(h.name, CATEGORY_NAMES[h.category]);
  }
});

test('examples are in strictly descending strength', () => {
  for (let i = 1; i < HAND_RANKINGS.length; i++) {
    const a = evaluate(HAND_RANKINGS[i - 1].cards);
    const b = evaluate(HAND_RANKINGS[i].cards);
    assert.equal(compare(a, b), 1, `${HAND_RANKINGS[i - 1].name} > ${HAND_RANKINGS[i].name}`);
  }
});

test('no example repeats a card', () => {
  for (const h of HAND_RANKINGS) {
    const keys = h.cards.map((c) => `${c.rank}${c.suit}`);
    assert.equal(new Set(keys).size, 5, h.name);
  }
});
