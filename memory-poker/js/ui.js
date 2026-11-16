// All DOM reading and writing lives here. game.js, round.js and live.js call these functions.
// Player names come from other people: always set them with textContent, never innerHTML.
import { cardLabel } from './deck.js';

const $ = (id) => document.getElementById(id);

const RANK_TEXT = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
// ︎ asks for the plain text glyph, so iOS doesn't swap in a coloured emoji.
const SUIT_TEXT = { s: '♠︎', h: '♥︎', d: '♦︎', c: '♣︎' };
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
const COPY_LABEL = 'Copy link';
let shareTimer = null;
let copyTimer = null;

const SCREENS = ['home', 'setup', 'live-setup', 'lobby', 'play'];

// Wire up DOM events once.
// handlers: {
//   onHomeSolo(), onHomeFriends(), onHomeJoin(code), onHome(),
//   onStart({ n, name }), onShare(), onPlayAgain(), onNewDeal(),
//   onCardClick(index), onLockIn(), onLetterKey(key) -> bool, onEnterKey() -> bool,
//   onLiveSubmit({ n, name }), onCopyLink(), onStartRound(), onNextRound(), onLeave(),
// }
export function init(handlers) {
  els = {
    screens: Object.fromEntries(SCREENS.map((s) => [s, $(`screen-${s}`)])),
    homeLink: $('home-link'),
    modeBanner: $('mode-banner'),
    // home
    homeSolo: $('home-solo'),
    homeFriends: $('home-friends'),
    joinForm: $('join-code-form'),
    homeError: $('home-error'),
    // solo setup
    form: $('setup-form'),
    // live setup
    liveForm: $('live-form'),
    liveTitle: $('live-setup-title'),
    liveIntro: $('live-setup-intro'),
    liveSize: $('live-size'),
    liveSubmit: $('live-submit'),
    liveError: $('live-error'),
    // lobby
    lobbyCode: $('lobby-code'),
    lobbyLink: $('lobby-link'),
    copyLink: $('copy-link'),
    lobbyNote: $('lobby-note'),
    lobbyPlayers: $('lobby-players'),
    startRound: $('start-round'),
    lobbyWait: $('lobby-wait'),
    // play
    liveBar: $('live-bar'),
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
    leaderboard: $('leaderboard'),
    lbTitle: $('lb-title'),
    lbBest: $('lb-best'),
    lbRows: $('lb-rows'),
    lbNote: $('lb-note'),
    liveActions: $('live-actions'),
    nextRound: $('next-round'),
  };

  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
  const submit = (form, fn) => on(form, 'submit', (e) => { e.preventDefault(); fn(new FormData(form)); });

  // Home
  on(els.homeSolo, 'click', () => handlers.onHomeSolo());
  on(els.homeFriends, 'click', () => handlers.onHomeFriends());
  submit(els.joinForm, (d) => handlers.onHomeJoin(String(d.get('code') ?? '')));
  on(els.homeLink, 'click', (e) => { e.preventDefault(); handlers.onHome(); });
  document.querySelectorAll('.back-home').forEach((b) => on(b, 'click', () => handlers.onHome()));

  // Solo setup
  submit(els.form, (d) => handlers.onStart({
    n: Number(d.get('n')),
    name: String(d.get('name') ?? '').trim(),
  }));

  // Live setup / lobby
  submit(els.liveForm, (d) => handlers.onLiveSubmit({
    n: Number(d.get('n')),
    name: String(d.get('name') ?? '').trim(),
  }));
  on(els.copyLink, 'click', () => handlers.onCopyLink());
  on(els.startRound, 'click', () => handlers.onStartRound());
  on(els.nextRound, 'click', () => handlers.onNextRound());
  document.querySelectorAll('.leave-room').forEach((b) => on(b, 'click', () => handlers.onLeave()));

  // Play: one listener for all grid cards.
  on(els.grid, 'click', (e) => {
    const btn = e.target.closest('.card');
    if (!btn || !els.grid.contains(btn)) return;
    handlers.onCardClick(Number(btn.dataset.index));
  });
  on(els.lockIn, 'click', () => handlers.onLockIn());

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
  on(els.share, 'click', () => handlers.onShare());
  on(els.playAgain, 'click', () => handlers.onPlayAgain());
  on(els.newDeal, 'click', () => handlers.onNewDeal());
}

// ---------- Screens ----------

function showScreen(name) {
  for (const [key, el] of Object.entries(els.screens)) el.hidden = key !== name;
  els.homeLink.hidden = name === 'home';
}

export function showHome({ error = '' } = {}) {
  showScreen('home');
  setFrom('');
  els.homeError.textContent = error;
}

export function showSetup({ n, name }) {
  showScreen('setup');
  const radio = els.form.querySelector(`input[name="n"][value="${n}"]`);
  if (radio) radio.checked = true;
  if (name) els.form.elements.name.value = name;
}

// mode: 'create' (host picks 8/16 + name) or 'join' (name only)
export function showLiveSetup({ mode, code = '', n = 8, name = '', error = '' }) {
  showScreen('live-setup');
  setFrom('');
  const create = mode === 'create';
  els.liveTitle.textContent = create ? 'Play with friends' : `Join room ${code}`;
  els.liveIntro.textContent = create
    ? "Create a room, then send the link to your friends. Everyone gets the same cards and the same timer."
    : 'Enter your name to join. The host starts the game when everyone is in.';
  els.liveSize.hidden = !create;
  const radio = els.liveForm.querySelector(`input[name="n"][value="${n}"]`);
  if (radio) radio.checked = true;
  els.liveForm.elements.name.value = name;
  els.liveSubmit.textContent = create ? 'Create room' : 'Join';
  els.liveSubmit.disabled = false;
  els.liveError.textContent = error;
}

export function setLiveBusy(busy, label) {
  els.liveSubmit.disabled = busy;
  if (label) els.liveSubmit.textContent = label;
}

export function setLiveError(text) {
  els.liveError.textContent = text;
}

export function showPlay() {
  showScreen('play');
  els.openRow.hidden = true;
  els.openCards.replaceChildren();
  els.lockIn.hidden = true;
  els.lockIn.disabled = true;
  els.result.hidden = true;
  els.revealActions.hidden = true;
  els.leaderboard.hidden = true;
  els.liveActions.hidden = true;
  els.share.textContent = SHARE_LABEL;
  setStatus('');
}

// "Local test mode" or other notices at the top.
export function setModeBanner(text) {
  els.modeBanner.textContent = text;
  els.modeBanner.hidden = !text;
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

export function clearGrid() {
  els.grid.replaceChildren();
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

export function renderOpenCards(open, { animate = true } = {}) {
  els.openCards.replaceChildren(
    ...open.map((card) => {
      const el = buildCard(card, null);
      if (animate) el.classList.add('slide-in');
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

// ---------- Reveal (solo) ----------

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

// ---------- Live: room bar, lobby, leaderboard ----------

// "Room ABCDE · Round 2" bar above the cards. Empty text hides it.
export function setLiveBar(text) {
  els.liveBar.textContent = text;
  els.liveBar.hidden = !text;
}

// players: [{ name, isHost, isMe, online }]
export function showLobby({ code, link, players, isHost, canStart, note = '', wait = '' }) {
  showScreen('lobby');
  els.lobbyCode.textContent = code;
  els.lobbyLink.value = link;
  els.lobbyNote.textContent = note;
  els.lobbyWait.textContent = wait;
  els.lobbyPlayers.replaceChildren(...players.map((p) => {
    const li = document.createElement('li');
    li.className = 'player' + (p.online ? ' is-online' : '');
    const dot = document.createElement('span');
    dot.className = 'online-dot';
    dot.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = p.name;
    const tags = document.createElement('span');
    tags.className = 'player-tags';
    tags.textContent = [p.isHost && 'host', p.isMe && 'you', !p.online && 'offline'].filter(Boolean).join(' · ');
    li.append(dot, name, tags);
    li.setAttribute('aria-label', `${p.name}${p.isHost ? ', host' : ''}${p.isMe ? ', you' : ''}, ${p.online ? 'online' : 'offline'}`);
    return li;
  }));
  els.startRound.hidden = !isHost;
  els.startRound.disabled = !canStart;
}

export function flashCopyStatus(text) {
  els.copyLink.textContent = text;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { els.copyLink.textContent = COPY_LABEL; }, 2000);
}

// rows: [{ rank, name, isMe, handName, cards, seconds, roundPoints, total }]
export function renderLeaderboard({ title, best, rows, note = '', isHost, nextLabel = 'Next round' }) {
  els.lbTitle.textContent = title;
  els.lbBest.textContent = best;
  els.lbRows.replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    if (r.isMe) tr.className = 'is-me';
    const cells = [
      r.rank ?? '–',
      r.name + (r.isMe ? ' (you)' : ''),
      r.handName ?? 'No hand',
      r.seconds == null ? '–' : `${r.seconds}s`,
      r.roundPoints ? `+${r.roundPoints}` : '',
      String(r.total),
    ];
    for (const [i, text] of cells.entries()) {
      const td = document.createElement(i === 1 ? 'th' : 'td');
      if (i === 1) td.scope = 'row';
      td.textContent = text;
      if (i === 2 && r.cards) {
        const small = document.createElement('span');
        small.className = 'hand-cards';
        small.textContent = r.cards;
        td.append(small);
      }
      tr.append(td);
    }
    return tr;
  }));
  els.lbNote.textContent = note;
  els.leaderboard.hidden = false;
  els.liveActions.hidden = false;
  els.nextRound.hidden = !isHost;
  els.nextRound.disabled = false;
  els.nextRound.textContent = nextLabel;
}

export function setNextRoundBusy(busy) {
  els.nextRound.disabled = busy;
}

export function focusLeaderboard() {
  els.lbTitle.focus({ preventScroll: false });
}

// ---------- Clipboard ----------

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

// How long the CSS flip + slide-in take, so round.js can wait for them.
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
