// Poker hand rankings shown in the "Rankings" panel, best first. Pure data, no DOM.
// Each example is 5 cards; `counts` marks the cards that make the hand (the rest are dimmed).
// tests/handRankings.test.js checks every example against handEvaluator.js.

const c = (rank, suit) => ({ rank, suit });
const ALL = [true, true, true, true, true];

export const HAND_RANKINGS = [
  {
    name: 'Royal flush',
    category: 8,
    description: 'A, K, Q, J, 10, all the same suit. The best straight flush.',
    cards: [c(14, 's'), c(13, 's'), c(12, 's'), c(11, 's'), c(10, 's')],
    counts: ALL,
  },
  {
    name: 'Straight flush',
    category: 8,
    description: '5 cards in a row, all the same suit.',
    cards: [c(9, 'h'), c(8, 'h'), c(7, 'h'), c(6, 'h'), c(5, 'h')],
    counts: ALL,
  },
  {
    name: 'Four of a kind',
    category: 7,
    description: '4 cards of the same rank.',
    cards: [c(12, 's'), c(12, 'h'), c(12, 'd'), c(12, 'c'), c(5, 's')],
    counts: [true, true, true, true, false],
  },
  {
    name: 'Full house',
    category: 6,
    description: 'Three of a kind plus a pair.',
    cards: [c(13, 's'), c(13, 'h'), c(13, 'd'), c(7, 'c'), c(7, 's')],
    counts: ALL,
  },
  {
    name: 'Flush',
    category: 5,
    description: 'Any 5 cards of the same suit.',
    cards: [c(14, 'd'), c(11, 'd'), c(8, 'd'), c(6, 'd'), c(2, 'd')],
    counts: ALL,
  },
  {
    name: 'Straight',
    category: 4,
    description: '5 cards in a row, any suits. Ace can be high or low.',
    cards: [c(10, 'c'), c(9, 'd'), c(8, 's'), c(7, 'h'), c(6, 'c')],
    counts: ALL,
  },
  {
    name: 'Three of a kind',
    category: 3,
    description: '3 cards of the same rank.',
    cards: [c(8, 's'), c(8, 'h'), c(8, 'd'), c(13, 'c'), c(3, 's')],
    counts: [true, true, true, false, false],
  },
  {
    name: 'Two pair',
    category: 2,
    description: '2 different pairs.',
    cards: [c(11, 'h'), c(11, 'c'), c(4, 's'), c(4, 'd'), c(14, 'h')],
    counts: [true, true, true, true, false],
  },
  {
    name: 'Pair',
    category: 1,
    description: '2 cards of the same rank.',
    cards: [c(10, 's'), c(10, 'h'), c(13, 'd'), c(7, 'c'), c(2, 's')],
    counts: [true, true, false, false, false],
  },
  {
    name: 'High card',
    category: 0,
    description: 'None of the above. Your highest card counts.',
    cards: [c(14, 'c'), c(11, 'd'), c(8, 's'), c(6, 'h'), c(3, 'c')],
    counts: [true, false, false, false, false],
  },
];

export const RANKING_NOTES = [
  'Ace is high, but A-2-3-4-5 is also a straight (the lowest one).',
  'If two hands are the same type, the higher cards win: a pair of kings beats a pair of queens.',
  'Suits never break a tie.',
];
