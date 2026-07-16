#!/usr/bin/env python3
"""Build Boggleflix Party: inject fonts, dictionary, vendor bundle, and app
code into party.src.html -> index.html (complete standalone page, deployed
to GitHub Pages).

Sources:
  party.src.html  — markup + styles, with __BALOO__/__FREDOKA__/__VENDOR__/__APP__
  party.app.js    — game logic, with __DICT__
  assets/         — dict.txt, baloo2.b64, fredoka.b64, trystero-nostr.bundle.js
"""
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
vendor = read('assets/trystero-nostr.bundle.js')
baloo = read('assets/baloo2.b64').replace('\n', '').strip()
fredoka = read('assets/fredoka.b64').replace('\n', '').strip()

assert '__DICT__' in app, 'dict placeholder missing from app js'
app = app.replace('__DICT__', words)

for ph in ('__BALOO__', '__FREDOKA__', '__VENDOR__', '__APP__'):
    assert ph in src, f'{ph} missing from party.src.html'
out = (src
       .replace('__BALOO__', baloo)
       .replace('__FREDOKA__', fredoka)
       .replace('__VENDOR__', js_safe(vendor))
       .replace('__APP__', js_safe(app)))

(root / 'index.html').write_text(out)
print(f'index.html {len(out.encode()):,} bytes')
