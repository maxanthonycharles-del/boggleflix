# Boggleflix Party 🎉

A bright, phone-first family word game inspired by Boggle party games: swipe
words on a letter grid, race the clock, and play **together** — everyone on
their own phone, no apps, no logins.

**Play it:** open the GitHub Pages URL for this repo, type your name, and
either **Host a party** (share the 4-letter code) or **Join with a code**.

## Modes
- **Party Mode** — up to 8 players. The host picks grid size (4×4 / 5×5 / 6×6),
  round timer (30s–3m), minimum word length (3/4/5) and rounds (1/3/5).
  Everyone gets the identical board, a synced countdown, live scores during the
  round, standings between rounds, and a podium with awards at the end.
- **Daily Puzzle** — one shared board per day (seeded from the date). Compare
  scores in the family chat.
- **Solo Practice** — free play.

## How multiplayer works (no server!)
Phones connect directly to each other with WebRTC, using
[Trystero](https://github.com/dmotz/trystero) (nostr strategy) for signalling —
so there is no game server and nothing to run or pay for. Boards are seeded
deterministically per round. Whoever opens the room is the host, and if they
leave the others agree on a replacement by lowest peer id (never by clock —
phones disagree about the time). Works best with everyone on the same WiFi.

The mesh doesn't always connect every phone to every other phone, so presence
and scores are **gossiped**: each phone re-broadcasts the whole roster and
scoreboard every few seconds, and merges what it hears (scores by max, since
they only grow). That way a player still shows up — and still scores — for
people they never connected to directly. Each phone stamps its own broadcasts
with a counter it alone increments, so relayed copies are recognisable as old
news and someone who leaves actually ages out instead of being echoed back
forever.

Words are checked against the public-domain ENABLE list (3–8 letters,
family-filtered, ~79k words), embedded in the page — validation is instant and
offline.

## Development
- `party.src.html` — markup + styles (placeholders for fonts/vendor/app)
- `party.app.js` — all game logic
- `assets/` — dictionary, fonts (base64 woff2), Trystero bundle
- `python3 build.py` → regenerates `index.html` (the deployed page)
- `p2ptest.html` — tiny standalone page to sanity-check P2P connectivity
- Add `?dev` to the URL for 25-second rounds; `window.__end()` force-ends a round

`game.src.html` is the original v1 (dark, single-phone) kept for reference.
