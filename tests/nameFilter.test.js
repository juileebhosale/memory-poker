import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNameBlocked, normalizeName } from '../memory-poker/js/nameFilter.js';

test('normal names are allowed', () => {
  for (const name of ['Juilee', 'Sam', 'Ana Maria', 'Cassandra', 'Hancock', 'Essex', 'Dickens', 'Scunthorpe',
    'Matt', 'Titus', 'Benedict Cumberbatch', 'Sussex', 'Glasshouse', 'Peacock', 'Grape', 'Therapist', '<b>Ana</b>', 'José', 'Bea 2',
    'Shi Tao', 'Grapefruit', 'Documentary', 'Cucumber', 'Accumulator', 'Cummings', 'Cockburn', 'A B', 'J. R. R. Tolkien']) {
    assert.equal(isNameBlocked(name), false, name);
  }
});

test('obvious bad words are blocked, including simple disguises', () => {
  for (const name of ['fuck', 'FUCK you', 'f.u.c.k', 'f u c k', 'sh1t', 'b!tch', 'Big Dick', 'a$$', 'ass', 'n1gger', 'hitler fan', 'rape', 'cum', 's h i t']) {
    assert.equal(isNameBlocked(name), true, name);
  }
});

test('normalizeName lowercases, removes accents and maps look-alike symbols', () => {
  assert.equal(normalizeName('JoSé'), 'jose');
  assert.equal(normalizeName('5h1t'), 'shit');
});
