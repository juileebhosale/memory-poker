// All DOM reading and writing lives here. game.js calls these functions.
import { cardLabel } from './deck.js';

const $ = (id) => document.getElementById(id);

const RANK_TEXT = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
// \uFE0E asks for the plain text glyph, so iOS doesn't swap in a coloured emoji.
const SUIT_TEXT = { s: '♠\uFE0E', h: '♥\uFE0E', d: '♦\uFE0E', c: '♣\uFE0E' };
const RANK_NAME = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
const SUIT_NAME = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };

// Screen-reader name, e.g. "Queen of hearts".
export function cardName(card) {
  return `${RANK_NAME[card.rank] ?? card.rank} of ${SUIT_NAME[card.suit]}`;
}

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isRed = (card) => card.suit === 'h' || card.suit === 'd';

let els = null;
const SHARE_LABEL = 'Share result';
let shareTimer = null;

// Wire up DOM events once.
// handlers: { onStart({ n, name }), onCardClick(index), onLockIn(), onShare(), onPlayAgain(), onNewDeal(),
//             onLetterKey(key) -> bool, onEnterKey() -> bool }
export function init(handlers) {
  els = {
    setup: $('screen-setup'),
    play: $('screen-play'),
    form: $('setup-form'),
    countdown: $('countdown'),
    fromBanner: $('from-banner'),
    status: $('status'),
    grid: $('grid'),
    openRow: $('open-row'),
    openCards: $('open-cards'),
    lockIn: $('lock-in'),
    result: $('result'),
    badge: $('result-badge'),
    yourHand: $('your-hand'),
    yourCards: $('your-cards'),
    bestHand: $('best-hand'),
    bestLetters: $('best-letters'),
    lockTime: $('lock-time'),
    revealActions: $('reveal-actions'),
    share: $('share'),
    playAgain: $('play-again'),
    newDeal: $('new-deal'),
  };

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(els.form);
    handlers.onStart({
      n: Number(data.get('n')),
      name: String(data.get('name') ?? '').trim(),
    });
  });

  // One listener for all grid cards.
  els.grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.card');
    if (!btn || !els.grid.contains(btn)) return;
    handlers.onCardClick(Number(btn.dataset.index));
  });

  els.lockIn.addEventListener('click', () => handlers.onLockIn());

  // Keyboard: letter keys toggle markers, Enter locks in.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'Enter') {
      if (handlers.onEnterKey()) e.preventDefault();
      return;
    }
    if (handlers.onLetterKey(e.key)) e.preventDefault();
  });
  els.share.addEventListener('click', () => handlers.onShare());
  els.playAgain.addEventListener('click', () => handlers.onPlayAgain());
  els.newDeal.addEventListener('click', () => handlers.onNewDeal());
}

// ---------- Screens ----------

export function showSetup({ n, name }) {
  els.setup.hidden = false;
  els.play.hidden = true;
  const radio = els.form.querySelector(`input[name="n"][value="${n}"]`);
  if (radio) radio.checked = true;
  if (name) els.form.elements.name.value = name;
}

export function showPlay() {
  els.setup.hidden = true;
  els.play.hidden = false;
  els.openRow.hidden = true;
  els.openCards.replaceChildren();
  els.lockIn.hidden = true;
  els.lockIn.disabled = true;
  els.result.hidden = true;
  els.revealActions.hidden = true;
  els.share.textContent = SHARE_LABEL;
  setStatus('');
}

// ---------- Cards ----------

function buildCard(card, letter, { faceDown = false, index = null } = {}) {
  const btn = document.createElement(index === null ? 'div' : 'button');
  btn.className = 'card' + (faceDown ? ' is-down' : '');
  if (index !== null) {
    btn.type = 'button';
    btn.dataset.index = String(index);
  }

  const rank = RANK_TEXT[card.rank] ?? String(card.rank);
  const suit = SUIT_TEXT[card.suit];
  const posHtml = letter ? `<span class="pos">${letter}</span>` : '';

  btn.innerHTML = `
    <span class="marker" aria-hidden="true"></span>
    <span class="card-inner">
      <span class="card-face${isRed(card) ? ' red' : ''}">
        <span class="card-corner">${rank}<span class="suit">${suit}</span></span>
        <span class="card-pip">${suit}</span>
        ${posHtml}
      </span>
      <span class="card-back">${posHtml}</span>
    </span>`;
  return btn;
}

export function renderGrid(grid, letters) {
  els.grid.classList.toggle('n-16', grid.length === 16);
  els.grid.replaceChildren(
    ...grid.map((card, i) => buildCard(card, letters[i], { index: i })),
  );
  setGridClickable(false);
  updateGridLabels(grid, letters, true);
  renderBestPair([]);
}

// Accessible names: the card when face up, only the letter when face down.
function updateGridLabels(grid, letters, faceUp) {
  els.grid.querySelectorAll('.card').forEach((el, i) => {
    el.setAttribute(
      'aria-label',
      faceUp ? `${letters[i]}: ${cardName(grid[i])}` : `Card ${letters[i]}, face down`,
    );
  });
}

// After reveal: name each card and say whether it was your pick and/or the best pair.
export function labelRevealed(grid, letters, markers, bestIndices) {
  els.grid.querySelectorAll('.card').forEach((el, i) => {
    const tags = [];
    if (markers.includes(i)) tags.push('your pick');
    if (bestIndices.includes(i)) tags.push('best pair');
    el.setAttribute('aria-label', `${letters[i]}: ${cardName(grid[i])}${tags.length ? ', ' + tags.join(', ') : ''}`);
    el.removeAttribute('aria-pressed');
  });
}

export function flipGrid(faceUp, grid, letters) {
  els.grid.querySelectorAll('.card').forEach((el) => el.classList.toggle('is-down', !faceUp));
  if (grid && letters) updateGridLabels(grid, letters, faceUp);
}

export function setGridClickable(on) {
  els.grid.querySelectorAll('.card').forEach((el) => {
    el.classList.toggle('is-clickable', on);
    el.disabled = !on;
  });
}

export function renderOpenCards(open) {
  els.openCards.replaceChildren(
    ...open.map((card) => {
      const el = buildCard(card, null);
      el.classList.add('slide-in');
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', `Open card: ${cardName(card)}`);
      return el;
    }),
  );
  els.openRow.hidden = false;
}

// markers: array of grid indices, in the order they were placed.
export function renderMarkers(markers) {
  els.grid.querySelectorAll('.card').forEach((el, i) => {
    const pos = markers.indexOf(i);
    el.classList.toggle('is-marked', pos !== -1);
    el.setAttribute('aria-pressed', String(pos !== -1));
    el.querySelector('.marker').textContent = pos === -1 ? '' : String(pos + 1);
  });
}

// ---------- Status, timer, buttons ----------

export function setCountdown(seconds, urgent = false) {
  els.countdown.textContent = seconds === null ? '' : String(seconds);
  els.countdown.classList.toggle('is-urgent', Boolean(urgent));
}

// "You're playing <name>'s deal" banner. Empty name hides it.
export function setFrom(name) {
  els.fromBanner.textContent = name ? `You're playing ${name}'s deal` : '';
  els.fromBanner.hidden = !name;
}

export function setStatus(text) {
  els.status.textContent = text;
}

export function showLockIn(enabled) {
  els.lockIn.hidden = false;
  els.lockIn.disabled = !enabled;
}

export function hideLockIn() {
  els.lockIn.hidden = true;
}

// ---------- Reveal ----------

export function renderBestPair(indices) {
  els.grid.querySelectorAll('.card').forEach((el, i) => {
    el.classList.toggle('is-best', indices.includes(i));
  });
}

export function renderResult({ perfect, yourName, bestName, yourCards, bestLetters, lockInSeconds }) {
  els.badge.textContent = perfect ? '✅ Perfect' : '❌ Not quite';
  els.badge.className = 'badge ' + (perfect ? 'badge-perfect' : 'badge-miss');
  els.yourHand.textContent = yourName;
  els.yourCards.textContent = `(${yourCards.map(cardLabel).join(' ')})`;
  els.bestHand.textContent = bestName;
  els.bestLetters.textContent = bestLetters.join(' + ');
  els.lockTime.textContent = `${lockInSeconds}s`;
  els.result.hidden = false;
  els.revealActions.hidden = false;
}

// Copy text to the clipboard. Returns true on success.
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall back below
  }
  // Older browsers / non-https pages.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

// Briefly swap the Share button label, e.g. to "Copied".
export function flashShareStatus(text) {
  els.share.textContent = text;
  clearTimeout(shareTimer);
  shareTimer = setTimeout(() => { els.share.textContent = SHARE_LABEL; }, 2000);
}

// How long the CSS flip + slide-in take, so game.js can wait for them.
// Both are 0 when the player prefers reduced motion.
export function flipDurationMs() {
  if (reducedMotion()) return 0;
  const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--flip-ms'));
  return Number.isFinite(ms) ? ms : 600;
}

export function slideDurationMs() {
  return reducedMotion() ? 0 : 700; // 450ms slide + 240ms stagger
}

// Move focus to the result so keyboard and screen-reader users land on it.
export function focusResult() {
  els.badge.focus({ preventScroll: false });
}
