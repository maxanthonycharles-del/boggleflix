#!/usr/bin/env python3
"""Build Boggleflix Party: inject fonts, dictionary, vendor bundle, and app
code into party.src.html -> index.html (complete standalone page, deployed
to GitHub Pages).

Sources:
  party.src.html  — markup + styles, with __BALOO__/__FREDOKA__/__VENDOR__/__APP__
  party.app.js    — game logic, with __DICT__
  assets/         — dict.txt (accepted words), common.txt (words we show and
                    aim boards at — see make_common.py), baloo2.b64, fredoka.b64,
                    mqtt.bundle.js + mqtt-bus.js (the multiplayer transport:
                    a Trystero-compatible message bus over public MQTT brokers)
"""
from base64 import b64encode
from pathlib import Path

root = Path(__file__).parent

def read(p):
    return (root / p).read_text()

def js_safe(code):
    # a literal "</script" inside inline JS would close the tag mid-script
    return code.replace('</script', '<\\/script')

src = read('party.src.html')
app = read('party.app.js')
words = read('assets/dict.txt').strip()
common = read('assets/common.txt').strip()
vendor = read('assets/mqtt.bundle.js') + '\n' + read('assets/mqtt-bus.js')
baloo = read('assets/baloo2.b64').replace('\n', '').strip()
fredoka = read('assets/fredoka.b64').replace('\n', '').strip()
silence = read('assets/silence.b64').replace('\n', '').strip()

assert '__DICT__' in app, 'dict placeholder missing from app js'
assert '__SILENCE__' in app, 'silence placeholder missing from app js'
assert '__COMMON__' in app, 'common-words placeholder missing from app js'

# The "words people actually know" list is a SUBSET of the dictionary, so ship it
# as one bit per dictionary word instead of a second copy of the words: 172k bits
# is 21KB (29KB base64) against 380KB of repeated text. Both files are sorted, so
# a single walk pairs them up.
def common_bits(all_words, common_words):
    common_set = set(common_words)
    bits = bytearray((len(all_words) + 7) // 8)
    hits = 0
    for i, w in enumerate(all_words):
        if w in common_set:
            bits[i >> 3] |= 128 >> (i & 7)
            hits += 1
    assert hits == len(common_set), (
        f'{len(common_set) - hits} common words are not in dict.txt — regenerate both')
    return b64encode(bytes(bits)).decode()

app = (app.replace('__DICT__', words)
          .replace('__SILENCE__', silence)
          .replace('__COMMON__', common_bits(words.split(), common.split())))

for ph in ('__BALOO__', '__FREDOKA__', '__VENDOR__', '__APP__'):
    assert ph in src, f'{ph} missing from party.src.html'
out = (src
       .replace('__BALOO__', baloo)
       .replace('__FREDOKA__', fredoka)
       .replace('__VENDOR__', js_safe(vendor))
       .replace('__APP__', js_safe(app)))

(root / 'index.html').write_text(out)
print(f'index.html {len(out.encode()):,} bytes')
