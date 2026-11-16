// Card model, deck and deal. Pure functions, no DOM.
import { hashSeed, mulberry32, shuffle } from './rng.js';

export const SUITS = ['s', 'h', 'd', 'c'];
export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 14 = Ace

const RANK_LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
  return deck;
}

export function cardLabel(card) {
  return `${RANK_LABELS[card.rank] ?? String(card.rank)}${SUIT_SYMBOLS[card.suit]}`;
}

// Same seed + same n always gives the same deal.
// Grid = first n shuffled cards; open = the next 3. They can never overlap.
export function deal(seed, n) {
  if (n !== 8 && n !== 16) throw new Error(`n must be 8 or 16, got ${n}`);
  const rand = mulberry32(hashSeed(String(seed)));
  const deck = shuffle(createDeck(), rand);
  return {
    grid: deck.slice(0, n),
    open: deck.slice(n, n + 3),
  };
}
