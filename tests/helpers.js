// Test helper: build cards from short strings like "As", "Td", "9h".
const RANK_MAP = { T: 10, J: 11, Q: 12, K: 13, A: 14 };

export function c(str) {
  const r = str.slice(0, -1);
  const suit = str.slice(-1);
  const rank = RANK_MAP[r] ?? Number(r);
  return { rank, suit };
}

export function hand(str) {
  return str.split(/\s+/).map(c);
}
