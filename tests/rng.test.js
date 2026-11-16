import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashSeed, mulberry32, shuffle } from '../memory-poker/js/rng.js';

test('hashSeed is stable and 32-bit unsigned', () => {
  assert.equal(hashSeed('k3f9'), hashSeed('k3f9'));
  assert.notEqual(hashSeed('k3f9'), hashSeed('k3fa'));
  const h = hashSeed('anything');
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
});

test('mulberry32 is repeatable and stays in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
});

test('shuffle returns a new array with the same items and leaves input alone', () => {
  const input = Array.from({ length: 52 }, (_, i) => i);
  const copy = input.slice();
  const out = shuffle(input, mulberry32(7));
  assert.deepEqual(input, copy);
  assert.notEqual(out, input);
  assert.deepEqual([...out].sort((x, y) => x - y), copy);
  assert.notDeepEqual(out, copy);
});
