// The "Rankings" side panel: poker hands from best to worst, with example cards.
// DOM only; the hand list itself is in handRankings.js. Called once from ui.init().
import { HAND_RANKINGS, RANKING_NOTES } from './handRankings.js';

const RANK_TEXT = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SUIT_TEXT = { s: '♠︎', h: '♥︎', d: '♦︎', c: '♣︎' };
const RANK_NAME = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
const SUIT_NAME = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const SLIDE_MS = 220;

let panel = null;
let openBtn = null;
let closeTimer = null;

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function miniCard(card, counts) {
  const red = card.suit === 'h' || card.suit === 'd';
  const node = el('span', `mini-card${red ? ' red' : ''}${counts ? '' : ' is-dim'}`);
  node.append(el('span', 'mini-rank', RANK_TEXT[card.rank] ?? String(card.rank)));
  node.append(el('span', 'mini-suit', SUIT_TEXT[card.suit]));
  return node;
}

function cardsLabel(hand) {
  const names = hand.cards.map((c) => `${RANK_NAME[c.rank] ?? c.rank} of ${SUIT_NAME[c.suit]}`);
  const unused = hand.cards.filter((_, i) => !hand.counts[i]).length;
  return `Example: ${names.join(', ')}` + (unused ? `. The last ${unused === 1 ? 'card does' : `${unused} cards do`} not count.` : '.');
}

function renderList(list) {
  HAND_RANKINGS.forEach((hand, i) => {
    const item = el('li', 'rank-row');
    const text = el('div', 'rank-text');
    const title = el('h3', 'rank-name');
    title.append(el('span', 'rank-num', `${i + 1}`), document.createTextNode(hand.name));
    text.append(title, el('p', 'rank-desc', hand.description));

    const cards = el('div', 'rank-cards');
    cards.setAttribute('role', 'img');
    cards.setAttribute('aria-label', cardsLabel(hand));
    hand.cards.forEach((c, j) => cards.append(miniCard(c, hand.counts[j])));

    item.append(text, cards);
    list.append(item);
  });
}

function isOpen() {
  return panel && panel.classList.contains('is-open');
}

export function openRankings() {
  if (!panel || isOpen()) return;
  clearTimeout(closeTimer);
  panel.hidden = false;
  void panel.offsetWidth; // let the browser draw the closed state first, so it slides in
  panel.classList.add('is-open');
  openBtn.setAttribute('aria-expanded', 'true');
  panel.querySelector('.rankings-close').focus({ preventScroll: true });
}

export function closeRankings({ returnFocus = true } = {}) {
  if (!isOpen()) return;
  panel.classList.remove('is-open');
  openBtn.setAttribute('aria-expanded', 'false');
  closeTimer = setTimeout(() => { panel.hidden = true; }, reducedMotion() ? 0 : SLIDE_MS);
  if (returnFocus) openBtn.focus({ preventScroll: true });
}

// True if a key event came from the panel or its button, so game shortcuts (Enter = lock in)
// don't fire while someone is using the panel with the keyboard.
export function isRankingsTarget(target) {
  return Boolean(target && (panel?.contains(target) || openBtn?.contains(target)));
}

export function initRankingsPanel() {
  panel = document.getElementById('rankings-panel');
  openBtn = document.getElementById('rankings-open');
  if (!panel || !openBtn) return;

  const list = panel.querySelector('.rank-list');
  renderList(list);
  const notes = panel.querySelector('.rank-notes');
  RANKING_NOTES.forEach((t) => notes.append(el('li', null, t)));

  openBtn.addEventListener('click', () => (isOpen() ? closeRankings() : openRankings()));
  panel.querySelector('.rankings-close').addEventListener('click', () => closeRankings());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      closeRankings({ returnFocus: panel.contains(document.activeElement) });
    }
  });
}
