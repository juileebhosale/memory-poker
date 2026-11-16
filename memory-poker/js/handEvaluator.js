// 5-card poker hand evaluation. Pure functions, no DOM.

export const CATEGORY_NAMES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
];

// Returns the high card of a straight, or 0 if the ranks are not a straight.
// Expects 5 ranks sorted high to low. A-2-3-4-5 counts as a 5-high straight.
function straightHigh(ranksDesc) {
  const unique = new Set(ranksDesc);
  if (unique.size !== 5) return 0;
  if (ranksDesc[0] - ranksDesc[4] === 4) return ranksDesc[0];
  if (ranksDesc.join(',') === '14,5,4,3,2') return 5;
  return 0;
}

// evaluate(cards) -> { category, name, tiebreak }
// tiebreak is compared left to right after category.
export function evaluate(cards) {
  if (!Array.isArray(cards) || cards.length !== 5) {
    throw new Error('evaluate needs exactly 5 cards');
  }

  const ranksDesc = cards.map((c) => c.rank).sort((a, b) => b - a);
  const isFlush = cards.every((c) => c.suit === cards[0].suit);
  const high = straightHigh(ranksDesc);

  // Group ranks by how often they appear: bigger groups first, then higher rank.
  const counts = new Map();
  for (const r of ranksDesc) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map(([, n]) => n).join('');
  const groupRanks = groups.map(([r]) => r);

  let category;
  let tiebreak;

  if (high && isFlush) {
    category = 8;
    tiebreak = [high];
  } else if (shape === '41') {
    category = 7;
    tiebreak = groupRanks;
  } else if (shape === '32') {
    category = 6;
    tiebreak = groupRanks;
  } else if (isFlush) {
    category = 5;
    tiebreak = ranksDesc;
  } else if (high) {
    category = 4;
    tiebreak = [high];
  } else if (shape === '311') {
    category = 3;
    tiebreak = groupRanks;
  } else if (shape === '221') {
    category = 2;
    tiebreak = groupRanks;
  } else if (shape === '2111') {
    category = 1;
    tiebreak = groupRanks;
  } else {
    category = 0;
    tiebreak = ranksDesc;
  }

  return { category, name: CATEGORY_NAMES[category], tiebreak };
}

// compare(a, b) -> 1 if a wins, -1 if b wins, 0 if tied.
export function compare(a, b) {
  if (a.category !== b.category) return a.category > b.category ? 1 : -1;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const x = a.tiebreak[i] ?? 0;
    const y = b.tiebreak[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// Try every pair of grid cards with the 3 open cards; return the strongest.
// On a tie, the first pair found (lowest indices) wins.
export function bestPair(grid, open) {
  if (open.length !== 3) throw new Error('bestPair needs exactly 3 open cards');
  if (grid.length < 2) throw new Error('bestPair needs at least 2 grid cards');

  let best = null;
  for (let i = 0; i < grid.length - 1; i++) {
    for (let j = i + 1; j < grid.length; j++) {
      const hand = evaluate([grid[i], grid[j], ...open]);
      if (best === null || compare(hand, best.hand) > 0) {
        best = { indices: [i, j], hand };
      }
    }
  }
  return best;
}
