# Memory Poker

A browser game. Memorize a grid of cards, watch them flip face down, then pick 2 of them to make the best poker hand with 3 open cards.

Inspired by a game from Netflix's *The Devil's Plan*. A fan-made version, not affiliated with or endorsed by Netflix.

**Play:** https://juileebhosale.com/memory-poker/

## How to play

1. Choose 8 or 16 cards and press **Start**.
2. You have **30 seconds** (8 cards) or **60 seconds** (16 cards) to memorize the cards. Each card has a letter (A–H or A–P).
3. The cards flip face down. Only the letters show.
4. **3 open cards** appear face up.
5. Pick **2 face-down cards** (click them, or type their letters). Your hand = those 2 + the 3 open cards. Press **Lock in** (or Enter).
6. Everything flips back up. You see your hand, the best possible hand, and the 2 cards that would have made it.

**Perfect** means you found the best possible hand. Lock-in time breaks ties.

### Play with friends — live room

1. **Play with friends** → pick 8 or 16 → your name → **Create room**.
2. Send the link (or the 5-letter code) to your friends. They enter their names and appear in the lobby.
3. Press **Start**. Everyone gets the same cards and the same timer: 30 seconds to memorize (60 with 16 cards), then 30 seconds to lock in.
4. Results appear when everyone has locked in (or time runs out): best hand first, then fastest. 3 / 2 / 1 points per round.
5. The host presses **Next round** for new cards. Points add up.

Link format: `/memory-poker/?room=ABCDE`

Live rooms use Supabase. See [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md). Without it, they run in **local test mode** (one browser, several tabs).

### Play with friends — same deal, any time

Play solo, then press **Share result**. The link has the same `seed`, so friends get exactly the same cards whenever they play. Compare hands and times.

Link format: `/memory-poker/?seed=<seed>&n=<8|16>&from=<your name>`

## Feedback

Found a bug or have an idea? [Send feedback](https://tally.so/r/vXDN6g). Enjoying it? A ⭐ on this repo is a nice thank-you.

## Run locally

Needs [Node.js](https://nodejs.org/) 18 or newer. No packages to install.

```bash
npm run dev
```

Then open:

- http://localhost:8000/memory-poker/
- http://localhost:8000/memory-poker (no trailing slash — must also work)

`npm run dev` runs `tools/dev-server.mjs`, a small server that behaves like production: `/` redirects to `/memory-poker/`, and `/memory-poker` is served without a redirect, the same way the personal site's rewrite serves it.

Any static server from the repo root also works (for example `python3 -m http.server 8000`), but it redirects `/memory-poker` to `/memory-poker/`, so it can't test the no-slash case.

> Opening `memory-poker/index.html` straight from the file system won't work. Browsers block ES modules on `file://` pages.

## Run tests

```bash
npm test
```

This runs `node --test` with Node's built-in test runner. Tests cover the random number generator, the deck and deal, the poker hand evaluator, and the game helpers (markers, timer, URL params, share links, scoring).

Tests also run on GitHub Actions on every push and pull request (`.github/workflows/test.yml`).

## Rebuild images

`memory-poker/og-image.png` (link preview), `favicon-32.png` and `apple-touch-icon.png` are generated:

```bash
pip install pillow
python3 tools/make_images.py
```

Commit the PNGs. The site has no build step.

## Project layout

```
memory-poker/      everything the browser loads (HTML, CSS, JS, images)
supabase/          schema.sql for live rooms (run once in Supabase)
docs/              Supabase setup + live test plan
tests/             unit tests (node --test)
tools/             dev server + image generator
vercel.json        Vercel routing: / -> /memory-poker/, serve /memory-poker without a slash
CLAUDE.md          full spec and hosting notes
```

## Hosting

- Static site on Vercel (project `memory-poker`). No build step; output directory = repo root.
- The personal site `juileebhosale.com` (a separate Next.js project) forwards `/memory-poker` and `/memory-poker/*` to this project with a rewrite.
- All page asset paths are absolute (`/memory-poker/...`) so the page works with or without a trailing slash. See CLAUDE.md → Hosting.
