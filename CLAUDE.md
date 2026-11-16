# Memory Poker

A browser game. You memorize a grid of cards, they flip face down, then you pick 2 of them to make the best poker hand with 3 open cards.

## Game rules

1. **Setup.** Player picks an 8-card or 16-card game.
2. **Deal.** Shuffle a 52-card deck. Deal that many cards face up into a grid.
   - Positions are labelled A–H (8 cards) or A–P (16 cards).
   - Grid is 4 columns: 2 rows for 8 cards, 4 rows for 16.
3. **Memorize.** A 60-second timer starts.
4. **Flip.** At 0 seconds, every grid card flips face down. Only its letter shows.
5. **Open cards.** Deal 3 cards face up from the rest of the deck. No card can appear twice across grid + open cards.
6. **Place markers.** Player puts 2 markers on 2 different grid cards.
   - Click a card to add a marker. Click again to remove it.
   - Maximum 2 markers. "Lock in" is enabled only when exactly 2 are placed.
   - Record the time from the flip to lock-in.
7. **Final hand.** The 2 marked cards + the 3 open cards = a 5-card hand. Standard 5-card poker rankings.
8. **Reveal.** Flip all grid cards face up. Show:
   - The player's hand and its name.
   - The best possible hand and its name.
   - The 2 grid cards (letters) that make the best hand.

### Hand rankings (low to high)

| Category | Name |
|---|---|
| 0 | High card |
| 1 | Pair |
| 2 | Two pair |
| 3 | Three of a kind |
| 4 | Straight |
| 5 | Flush |
| 6 | Full house |
| 7 | Four of a kind |
| 8 | Straight flush |

- Ace is high (rank 14), but A-2-3-4-5 also counts as a straight (the lowest one, 5-high).
- Ties within a category are broken by card ranks (for example, pair of kings beats pair of queens; same pair compares the remaining cards from high to low).
- No suit ranking. Equal hands are a tie.

### Best possible hand

Try every pair of grid cards with the 3 open cards. That is 28 pairs for 8 cards and 120 pairs for 16. Keep the strongest hand. The player's result is "Perfect" if their hand ties the best hand, otherwise "Not quite".

## Tech rules

- **Static site.** HTML, CSS, plain JavaScript using ES modules. No framework. No build step. No npm dependencies for the game itself.
- **Seeded randomness.** All randomness goes through a seeded random number generator (RNG). The same seed must always give the same deal. Never call `Math.random()` in game logic.
  - The only allowed use of non-seeded randomness is generating a new seed string when none is given.
- **URL parameters.** `?seed=<string>&n=<8|16>`
  - Missing seed: generate one and write it into the URL with `history.replaceState` (no page reload).
  - Missing or invalid `n`: show the setup screen so the player can choose.
- **Pure game logic.** `rng.js`, `deck.js` and `handEvaluator.js` are pure functions. No DOM access, no `window`, no `document`, no timers. They must run in Node.
- **Tests.** Use Node's built-in test runner (`node:test` and `node:assert`). Run with `npm test` (= `node --test`, which finds every `*.test.js` file). No test framework to install.
- **Small single-purpose files.** Keep each file focused on one job.

## File layout

```
memory-poker/                 everything the browser loads (served at /memory-poker/)
  index.html
  styles.css
  favicon.svg                 main icon
  favicon-32.png              fallback icon (generated)
  apple-touch-icon.png        home-screen icon (generated)
  og-image.png                1200x630 link preview (generated)
  js/rng.js                   seeded RNG + shuffle
  js/deck.js                  card model, deck, deal
  js/handEvaluator.js         evaluate a 5-card hand, compare hands, find best pair
  js/game.js                  game state machine + timer
  js/ui.js                    all DOM rendering
tests/                        node --test (imports from ../memory-poker/js/)
tools/make_images.py          generates og-image.png and PNG icons (needs Pillow)
tools/dev-server.mjs          local server that behaves like production
vercel.json                   redirects / to /memory-poker/
package.json                  "type": "module" + npm scripts; no dependencies
```

## Hosting

- **Public URL:** https://juileebhosale.com/memory-poker/
- **Setup:** this repo is its own Vercel project (static, no build step, output directory = repo root). The personal site (a separate Next.js project, `juileebhosale-website`) forwards `/memory-poker` and `/memory-poker/*` to this project with a Next.js rewrite.
- **Why everything is under `memory-poker/`:** the page is served at the same path on every host (this project's `.vercel.app` URL, the personal site, and localhost), so one set of paths works everywhere.
- **Trailing slash:** Next.js strips trailing slashes, so the page is often loaded as `/memory-poker` (no slash). Relative paths like `js/game.js` would then resolve to `/js/game.js` and break. Rules:
  - In `index.html`, every script, stylesheet, icon and image path is **absolute** and starts with `/memory-poker/` (for example `/memory-poker/js/game.js`).
  - Imports *between* JS modules stay relative (`./deck.js`). They resolve against the module's own URL, which is always under `/memory-poker/js/`.
  - Never add a relative asset path to `index.html` or `styles.css`.
- **vercel.json:**
  - Redirects `/` to `/memory-poker/` (temporary redirect) so the bare `.vercel.app` URL opens the game.
  - Rewrites `/memory-poker` (no slash) to `/memory-poker/index.html`, so this project also serves both forms.
- **Share links:** `window.location.origin + "/memory-poker/?seed=...&n=..."` (plus `&from=<name>`), built by `shareLink()` in `game.js`. Never hard-code the domain. This way links from the `.vercel.app` URL and from localhost also work.
- **Link previews:** `index.html` has Open Graph and Twitter card tags. `og:url` is `https://juileebhosale.com/memory-poker/` and `og:image` is the absolute URL `https://juileebhosale.com/memory-poker/og-image.png` (preview crawlers need absolute URLs).
- **Images:** run `python3 tools/make_images.py` (or `npm run images`) to rebuild `og-image.png`, `favicon-32.png` and `apple-touch-icon.png` in the game's colours. Commit the PNGs; the site has no build step. `favicon.svg` is hand-written.
- **Run locally:**
  - `npm run dev` (= `node tools/dev-server.mjs`). Open http://localhost:8000/memory-poker/ and http://localhost:8000/memory-poker. Both must work. The no-slash URL is served without a redirect, like the Next.js rewrite.
  - Or any static server from the repo root, e.g. `python3 -m http.server 8000`. Note: it redirects `/memory-poker` to `/memory-poker/`, so it doesn't test the no-slash case.

## Module contracts

### js/rng.js
- `hashSeed(string) -> number` — turn a seed string into a 32-bit integer.
- `mulberry32(int) -> () => number` — returns a function that gives floats in [0, 1).
- `shuffle(array, rand) -> array` — Fisher–Yates shuffle. Returns a new array. Does not change the input.

### js/deck.js
- Card shape: `{ rank: 2..14, suit: 's' | 'h' | 'd' | 'c' }`. 14 = Ace, 11 = Jack, 12 = Queen, 13 = King.
- `createDeck() -> Card[52]`
- `cardLabel(card) -> string` — for example `"A♠"`, `"10♥"`.
- `deal(seed, n) -> { grid: Card[n], open: Card[3] }` — grid and open cards never overlap.

### js/handEvaluator.js
- `evaluate(cards[5]) -> { category: 0..8, name: string, tiebreak: number[] }`
- `compare(a, b) -> -1 | 0 | 1` — compares two `evaluate` results. Category first, then `tiebreak` left to right.
- `bestPair(grid, open) -> { indices: [i, j], hand }` — tries every pair, returns the strongest. If several pairs tie, return the first one found (lowest indices).

### js/game.js
- Holds game state. Calls `ui.js` to render. Does not touch the DOM directly.
- States: `SETUP -> MEMORIZE -> PLACE -> REVEAL`.
- Timer uses `Date.now()` differences, not counting ticks, so it stays accurate if the browser tab lags.

### js/ui.js
- All DOM reading and writing lives here.
- Cards show rank and suit. Hearts and diamonds are red.
- Must work on a 375px-wide phone screen and on a laptop.

## Testing requirements

- Same seed gives the same deal. Different seeds usually give different deals.
- No duplicate cards across grid + open cards, for both n = 8 and n = 16.
- One test per hand category.
- Ace-low straight (A-2-3-4-5) is detected and ranks below 2-3-4-5-6.
- Tie-breaks: higher pair wins; same pair compares kickers; equal hands return 0.
- `bestPair` returns the true best on a few hand-built grids.

Run all tests after any change to `rng.js`, `deck.js` or `handEvaluator.js`.

## Known limits

- Anyone can open browser developer tools and see the cards. This is fine for a game among friends. Do not try to prevent it.

## Not in scope yet

- Live multiplayer rooms (planned later, using Supabase Realtime).
