#!/usr/bin/env python3
"""Generate assets/dict.txt from the public-domain ENABLE word list.

Source: enable1.txt (https://norvig.com/ngrams/enable1.txt, public domain).
Place a copy next to this script, then run:  python3 assets/make_dict.py

Words of 3+ letters, any length — real Boggle has no upper cap, and 8+ letter
words are the 11-point jackpots. Family filter is word-boundary aware: it
blocks profane lexemes and their inflections, not every word that happens to
contain one ("hello", "grape", "analyst", "basement" all stay in).
"""
import re
from pathlib import Path

here = Path(__file__).parent

# Block any word CONTAINING these — every embedding is itself offensive
# (compounds like bullshit/motherfucker included), with no innocent hits.
SUB = """
fuck cunt twat shit piss porn slut bitch whore dildo fellat cunniling jism
orgasm incest molest sodom nazi smut nigg fagg kike scrot nipple gonad penis
pedophil masturbat cocksuck prostitut nymphomani asshole blowjob badass
bollock
""".split()

# Block words STARTING with these — the whole ^stem* family is the lexeme.
PREFIX = """
cocain damn goddam spunk testic vagin erot clitor puss ejaculat
""".split()

# Block these exact words only — the stem embeds in innocent words
# (semen/basement, rape/grape, meth/method, hell/hello, turd/sturdy...).
# The tail of this list is slurs and words for disability/ethnicity that a
# family game should not be putting in front of a child as a suggestion. They
# are ordinary entries in ENABLE, which is a Scrabble list, not a style guide.
EXACT = """
anal anally anality analities anus anuses arse arses boob boobs
bugger buggers buggered buggering buggery buggeries
cock cocks crap craps crapped crapping crapper crappers crappy crappier
crappiest dick dicks dyke dykes dykey fart farts farted farting
hell hells hellish hellcat hellcats hellfire hellfires hellhole hellholes
hellbent heroin heroins heroinism heroinisms homo homos hooker hookers horny
lesbo lesbos meth meths pimp pimps pimped pimping
rape rapes raped raping rapist rapists rapeseed rapeseeds
retard retards retarded retarding retardate retardates
semen semens shag shags shagged shagging shithead shitheads
spic spics spick spicks tits tittie titties titty turd turds
wank wanks wanked wanking wanker wankers
squaw squaws squawman squawmen gyp gyps gypped gypping gypper gyppers
coolie coolies mulatto mulattos mulattoes redskin redskins savages
half-breed halfbreed halfbreeds wetback wetbacks quadroon quadroons
octoroon octoroons eskimo eskimos lunatic lunatics imbecile imbeciles
cripple cripples crippled crippling spastic spastics
""".split()

EXACT = set(EXACT)
sub_re = re.compile('|'.join(SUB))
pre_re = re.compile('^(' + '|'.join(PREFIX) + ')')

def blocked(w):
    return w in EXACT or sub_re.search(w) or pre_re.match(w)

enable = [w.strip() for w in (here / 'enable1.txt').read_text().split()]
words = [w for w in enable
         if len(w) >= 3 and w.isalpha() and w.islower() and not blocked(w)]

(here / 'dict.txt').write_text(' '.join(words) + '\n')
longest = max(words, key=len)
print(f'{len(words):,} words, longest: {longest} ({len(longest)})')
