#!/usr/bin/env python3
"""Generate assets/common.txt — the words an ordinary family actually knows.

Why this exists
---------------
The game accepts the full ENABLE list (assets/dict.txt, ~172k words), because
telling someone MITTEN is not a word is the most infuriating thing a word game
can do. But ENABLE is a Scrabble list: most of it is words nobody has ever
seen. Showing "words you missed: FADDIER, QUONDAM, OGHAMS, GADID" makes the
round feel arbitrary and unwinnable, and picking boards by how many ENABLE
words they hide optimises for exactly the wrong thing.

So there are two lists with two jobs:
  dict.txt    — what the game will ACCEPT. Generous on purpose.
  common.txt  — what the game will SHOW you, and what it aims a board at.

Source: Norvig's count_1w.txt, word frequencies over Google's trillion-word
web corpus (https://norvig.com/ngrams/count_1w.txt, from the Google Web
Trillion Word Corpus, released for research use). Place a copy next to this
script, then run:  python3 assets/make_common.py

A word is "common" if it is in ENABLE and either
  * ranks in the top 50,000 words by frequency, or
  * is a regular inflection (-s/-es/-ed/-ing/-er/-est, and the -y -> -ies
    family) of a word ranking in the top 30,000, AND is itself attested in the
    top 200,000.
The inflection rule matters: people find plurals and past tenses constantly,
and those forms sit far lower in a web corpus than their stems. The second half
of it matters just as much — without it the rule manufactures forms nobody
says (LAZIES, MIDSTS, TALONED) out of perfectly common stems.

Tuning: 92 everyday household words were checked against the result — 88 are
in. Raising the cutoff pulls obscure Scrabble words back in faster than it
pulls real ones, so if a genuinely known word is missing it is better to leave
the cutoff alone: the word is still accepted, it just is not advertised.
"""
from pathlib import Path

here = Path(__file__).parent
CUTOFF = 50_000       # direct frequency rank
BASE_CUTOFF = 30_000  # rank a stem needs for its inflections to count
INFL_CUTOFF = 200_000 # ...and the inflected form must itself be attested this well

freq = here / 'count_1w.txt'
if not freq.exists():
    raise SystemExit('missing assets/count_1w.txt — see the docstring for the source')

rank = {}
for i, line in enumerate(freq.open(encoding='utf-8', errors='ignore')):
    w = line.split('\t')[0].strip().lower()
    if w and w.isalpha() and w not in rank:
        rank[w] = i + 1

enable = set((here / 'dict.txt').read_text().split())


def stems(w):
    """Plausible base forms of a regular inflection of w."""
    out = []
    for suf, repl in (('s', ''), ('es', ''), ('ed', ''), ('ing', ''), ('er', ''),
                      ('est', ''), ('ies', 'y'), ('ied', 'y'), ('ier', 'y'), ('iest', 'y')):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            stem = w[:len(w) - len(suf)] + repl
            out.append(stem)
            # hopped -> hop, biggest -> big
            if suf in ('ed', 'ing', 'er', 'est') and len(stem) > 1 and stem[-1] == stem[-2]:
                out.append(stem[:-1])
            # baked -> bake, nicer -> nice
            if suf in ('ing', 'ed', 'er', 'est'):
                out.append(stem + 'e')
    return out


direct = {w for w in enable if rank.get(w, 10 ** 9) <= CUTOFF}
inflected = {w for w in enable
             if w not in direct and rank.get(w, 10 ** 9) <= INFL_CUTOFF
             and any(rank.get(b, 10 ** 9) <= BASE_CUTOFF for b in stems(w))}
common = sorted(direct | inflected)

(here / 'common.txt').write_text(' '.join(common) + '\n')
print(f'common.txt {len(common):,} words '
      f'({len(direct):,} by frequency + {len(inflected):,} inflections) '
      f'of {len(enable):,} in ENABLE')
