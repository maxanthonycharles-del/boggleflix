# Boggleflix Party 🎉

A bright, phone-first family word game inspired by Boggle party games: swipe
words on a letter grid, race the clock, and play **together** — everyone on
their own phone, no apps, no logins.

**Play it:** open the GitHub Pages URL for this repo, type your name, and
either **Host a party** (share the 4-letter code) or **Join with a code**.

## Modes
- **Party Mode** — up to 8 players. The host picks grid size (4×4 / 5×5 / 6×6),
  round timer (30s–3m), minimum word length (3/4/5/6) and rounds (1/3/5).
  Minimum 6 wants a big board — a 4×4 often holds no 6-letter word at all, so
  the lobby says so when you pick that pair.
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

Words are checked against the public-domain ENABLE list (3+ letters, no upper
cap — real Boggle has none, and 8+ letter words are the jackpots),
family-filtered with word-boundary awareness (~172k words), embedded in the
page — validation is instant and offline. Regenerate with
`python3 assets/make_dict.py` (reads `assets/enable1.txt`).

Dice follow the real sets, with one deliberate exception: the 6×6 Super Big
Boggle set has a cube reading QU/AN/IN/TH/ER/HE, and those two-letter tiles read
as a bug to players, so that cube is a plain six-letter one here. `Qu` is the
only tile that is ever two characters — every set has it, and a bare Q is a dead
tile without it.

Boards are generated exactly the way the real game shakes its tray: the dice
are shuffled into the grid and each shows a uniformly random face — no
curation, no re-rolls. Vowel droughts and letter clumps are part of Boggle.
Deterministic per seed, so every phone in a party sees the identical grid.

Signalling is pinned to a fixed list of major public nostr relays (every phone
uses the same list, so hosts and joiners always share relays), and a public
TURN server carries the game traffic when two phones' networks won't allow a
direct link (e.g. carrier NAT). Joining is one step: typing the 4th letter of
the code joins immediately, and the lobby says plainly whether it's still
connecting or the code should be double-checked.

## Scoring
Real Boggle's table: 3–4 letters = 1 point, 5 = 2, 6 = 3, 7 = 5, 8+ = 11. On
the 6×6 board, words of 9+ letters score 2 points per letter (Super Big Boggle
rule). No bonus for speed, no penalty for a rejected word (rejected words just
don't score).

Party Mode also plays real Boggle's duplicate rule: a word that two or more
players found is crossed out and scores nothing for anyone — only words nobody
else found count. That needs to see everyone's word list, so in-round scores
are provisional and settle once round results are in (just like comparing
lists in the paper game); every phone computes it from the same reported lists
and lands on the same total without a scorekeeper. Solo and Daily have no one
to clash with — every valid word counts.

Defaults follow the real game too: 3-minute rounds, minimum word length 3 on
4×4 and 4 on the bigger boards (picking a grid size resets the minimum to that
board's rule; the host can still override it).

## Music
A short original loop, synthesized live in the browser (same technique as the
tap/word sound effects, just longer) — not a recording, so nothing to license.
It plays **only while a round is being played**: it starts with the round and
stops the moment time is up, so menus, the lobby, standings and the podium are
music-free. It follows the SOUND toggle (home screen and in-game HUD) like
every other sound. The first tap on the page silently primes audio so a round
started by the host (a network message, not a tap) may legally start the song
under mobile autoplay rules.

iOS silences Web Audio when the phone's ring/silent switch is on. To play
through that, a tiny silent looping clip (`assets/silence.b64`) holds the audio
session open in "playback" mode while sound is enabled. Even so, a phone with
the switch on or the volume down may still be quiet — that's the OS, not the
game.

## Development
- `party.src.html` — markup + styles (placeholders for fonts/vendor/app)
- `party.app.js` — all game logic
- `assets/` — dictionary, fonts (base64 woff2), Trystero bundle
- `python3 build.py` → regenerates `index.html` (the deployed page)
- `p2ptest.html` — tiny standalone page to sanity-check P2P connectivity
- Add `?dev` to the URL for 25-second rounds; `window.__end()` force-ends a round

`game.src.html` is the original v1 (dark, single-phone) kept for reference.
