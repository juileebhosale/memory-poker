// One round on screen: (countdown) -> memorize -> flip -> place -> locked in / timed out.
// Used by solo mode (game.js) and live rooms (live.js). Holds round state; ui.js draws it.
//
// All times are on one clock, given by `now()`:
//   solo: Date.now
//   live: Date.now() + server offset, so every device flips at the same moment.
import * as ui from './ui.js';

export const MEMORIZE_MS = 60_000;
export const URGENT_SECONDS = 10;
const LETTERS = 'ABCDEFGHIJKLMNOP'.split('');
const LATE_JOIN_MS = 1_500; // joined/refreshed this long after the flip: skip the animations

// ---------- Pure helpers (tested in Node) ----------

// Toggle a marker on grid index i. Max 2. Returns a new array.
export function toggleMarker(markers, i, max = 2) {
  if (markers.includes(i)) return markers.filter((m) => m !== i);
  if (markers.length >= max) return markers;
  return [...markers, i];
}

// Whole seconds left, rounded up, never below 0.
export function secondsLeft(endAt, now) {
  return Math.max(0, Math.ceil((endAt - now) / 1000));
}

// Map a key press to a grid index (0-based), or -1. 'a'/'A' -> 0.
export function letterToIndex(key, n) {
  if (typeof key !== 'string' || key.length !== 1) return -1;
  const i = key.toUpperCase().charCodeAt(0) - 65;
  return i >= 0 && i < n ? i : -1;
}

export function lettersFor(n) {
  return LETTERS.slice(0, n);
}

// ---------- The round ----------

class Round {
  // opts:
  //   grid, open      cards from deal()
  //   startAt         when memorizing starts (clock of now()); before it, a "starting in" countdown shows
  //   now             clock function
  //   placeMs         time limit to lock in after the flip, or null for no limit (solo)
  //   alreadyLocked   { markers } if this player already locked in (e.g. page refreshed)
  //   onLocked        ({ markers, lockInMs }) => void
  //   onTimeout       () => void   (only with placeMs)
  constructor(opts) {
    this.grid = opts.grid;
    this.open = opts.open;
    this.n = opts.grid.length;
    this.letters = lettersFor(this.n);
    this.now = opts.now ?? Date.now;
    this.startAt = opts.startAt;
    this.flipAt = opts.startAt + MEMORIZE_MS;
    this.deadline = opts.placeMs == null ? null : this.flipAt + opts.placeMs;
    this.onLocked = opts.onLocked ?? (() => {});
    this.onTimeout = opts.onTimeout ?? (() => {});
    this.markers = opts.alreadyLocked ? [...opts.alreadyLocked.markers] : [];
    this.phase = 'countdown';
    this.locked = Boolean(opts.alreadyLocked);
    this.warned = false;
    this.timers = new Set();

    ui.showPlay();
    ui.clearGrid();
    this.tick();
    this.interval = setInterval(() => this.tick(), 200);
  }

  later(fn, ms) {
    const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
  }

  cancel() {
    this.phase = 'cancelled';
    clearInterval(this.interval);
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }

  // Called every 200 ms. Everything is worked out from now(), so a lagging tab catches up.
  tick() {
    if (this.phase === 'cancelled') return;
    const t = this.now();

    if (t < this.startAt) {
      ui.setCountdown(secondsLeft(this.startAt, t), false);
      ui.setStatus('Get ready — memorizing starts in');
      return;
    }

    if (this.phase === 'countdown') {
      this.phase = 'memorize';
      ui.renderGrid(this.grid, this.letters);
      ui.renderMarkers([]);
      ui.setStatus('Memorize the cards');
    }

    if (this.phase === 'memorize') {
      if (t < this.flipAt) {
        const left = secondsLeft(this.flipAt, t);
        const urgent = left <= URGENT_SECONDS;
        ui.setCountdown(left, urgent);
        if (urgent && !this.warned) {
          this.warned = true;
          ui.setStatus(`${URGENT_SECONDS} seconds left`);
        }
        return;
      }
      this.flip(t - this.flipAt > LATE_JOIN_MS);
    }

    if (this.deadline !== null && (this.phase === 'place' || this.phase === 'flipping' || this.phase === 'locked')) {
      const left = secondsLeft(this.deadline, t);
      if (this.phase !== 'flipping') ui.setCountdown(left, left <= URGENT_SECONDS && !this.locked);
      if (t >= this.deadline && !this.locked && this.phase === 'place') this.timeout();
    }
  }

  flip(skipAnimation) {
    this.phase = 'flipping';
    ui.setCountdown(null, false);
    ui.flipGrid(false, this.grid, this.letters);
    const flipMs = skipAnimation ? 0 : ui.flipDurationMs();
    const slideMs = skipAnimation ? 0 : ui.slideDurationMs();
    if (!skipAnimation) ui.setStatus('Cards flipped');
    this.later(() => {
      ui.renderOpenCards(this.open, { animate: !skipAnimation });
      this.later(() => this.enterPlace(), slideMs);
    }, flipMs);
  }

  enterPlace() {
    if (this.phase !== 'flipping') return;
    if (this.locked) {
      this.phase = 'locked';
      ui.renderMarkers(this.markers);
      this.tick();
      return;
    }
    if (this.deadline !== null && this.now() >= this.deadline) {
      this.phase = 'place';
      this.timeout();
      return;
    }
    this.phase = 'place';
    ui.setGridClickable(true);
    ui.renderMarkers(this.markers);
    ui.setStatus('Pick 2 cards for your hand');
    ui.showLockIn(this.markers.length === 2);
    this.tick();
  }

  cardClick(i) {
    if (this.phase !== 'place') return;
    this.markers = toggleMarker(this.markers, i);
    ui.renderMarkers(this.markers);
    ui.showLockIn(this.markers.length === 2);
    const left = 2 - this.markers.length;
    ui.setStatus(left === 0 ? 'Ready — lock in when sure' : `Pick ${left} more card${left === 1 ? '' : 's'}`);
  }

  letterKey(key) {
    if (this.phase !== 'place') return false;
    const i = letterToIndex(key, this.n);
    if (i === -1) return false;
    this.cardClick(i);
    return true;
  }

  enterKey() {
    if (this.phase !== 'place' || this.markers.length !== 2) return false;
    this.lockIn();
    return true;
  }

  lockIn() {
    if (this.phase !== 'place' || this.markers.length !== 2) return;
    const lockInMs = Math.max(0, Math.round(this.now() - this.flipAt));
    this.phase = 'locked';
    this.locked = true;
    ui.setGridClickable(false);
    ui.hideLockIn();
    if (this.deadline === null) clearInterval(this.interval); // solo: nothing left to count
    else ui.setCountdown(null, false);
    this.onLocked({ markers: [...this.markers], lockInMs });
  }

  timeout() {
    this.phase = 'timeout';
    clearInterval(this.interval);
    ui.setCountdown(0, false);
    ui.setGridClickable(false);
    ui.hideLockIn();
    ui.setStatus("Time's up — no hand this round");
    this.onTimeout();
  }
}

// Only one round is on screen at a time. Keyboard and clicks go to it.
let current = null;

export function startRound(opts) {
  stopRound();
  current = new Round(opts);
  return current;
}

export function stopRound() {
  if (current) current.cancel();
  current = null;
}

export function currentRound() {
  return current;
}

export const input = {
  cardClick: (i) => current?.cardClick(i),
  letterKey: (key) => current?.letterKey(key) ?? false,
  enterKey: () => current?.enterKey() ?? false,
  lockIn: () => current?.lockIn(),
};
