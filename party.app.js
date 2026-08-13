'use strict';
/* ================================================================
   BOGGLEFLIX PARTY — app logic
   Screens: name → home → (join) → lobby → game → standings/podium
   Net: Trystero (bundled, global `Trystero`) — host-authoritative-ish mesh
   ================================================================ */

/* ---------------- utils ---------------- */
const $ = id => document.getElementById(id);
function el(tag, cls, text){
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
const store = {
  get(k, d){ try { const v = localStorage.getItem('bfp_'+k); return v === null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem('bfp_'+k, JSON.stringify(v)); } catch(e){} }
};
function fmtTime(ms){
  const s = Math.max(0, Math.ceil(ms/1000));
  return s >= 60 ? Math.floor(s/60) + ':' + String(s%60).padStart(2,'0') : String(s);
}
/* Today's tray for a given grid size, and where that size's best score lives. */
function dailySeed(g){ return 'bfp-daily-' + todayKey() + (g === 4 ? '' : '-' + g); }
function dailyKey(g){ return 'daily-' + todayKey() + (g === 4 ? '' : '-' + g); }
function todayKey(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function prettyToday(){
  return new Date().toLocaleDateString(undefined, {month:'short', day:'numeric'});
}

/* ---------------- rng / boards ---------------- */
function xmur3(str){
  let h = 1779033703 ^ str.length;
  for (let i=0;i<str.length;i++){ h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h<<13 | h>>>19; }
  return function(){ h = Math.imul(h ^ (h>>>16), 2246822507); h = Math.imul(h ^ (h>>>13), 3266489909); return (h ^= h>>>16) >>> 0; };
}
function mulberry32(a){
  return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a>>>15, 1 | a);
    t = t + Math.imul(t ^ t>>>7, 61 | t) ^ t; return ((t ^ t>>>14) >>> 0) / 4294967296; };
}
const rngFromSeed = seed => mulberry32(xmur3(seed)());

const DICE4 = ["AAEEGN","ABBJOO","ACHOPS","AFFKPS","AOOTTW","CIMOTU","DEILRX","DELRVY",
  "DISTTY","EEGHNW","EEINSU","EHRTVW","EIOSST","ELRTTY","HIMNQU","HLNNRZ"];
const DICE5 = ["AAAFRS","AAEEEE","AAFIRS","ADENNN","AEEEEM","AEEGMU","AEGMNN","AFIRSY",
  "BJKQXZ","CCNSTW","CEIILT","CEILPT","CEIPST","DDLNOR","DDHNOT","DHHLOR","DHLNOR",
  "EIIITT","EMOTTT","ENSSSU","FIPRSY","GORRVW","HIPRRY","NOOTUW","OOOTTU"];
// The real 6×6 set (Super Big Boggle) has one cube reading QU/AN/IN/TH/ER/HE.
// Two-letter tiles read as a mistake to players, so that cube is a plain
// six-letter one here — echoing the letters it used to carry. Qu stays: it is on
// every Boggle set, and a lone Q needs a U beside it to be worth anything.
const DICE6 = ["AAAFRS","AAEEEE","AAEEOO","AAFIRS","ABDEIO","ADENNN","AEEEEM","AEEGMU",
  "AEGMNN","AEILMN","AEINOU","AFIRSY","AEHINT","BBJKXZ","CCENST",
  "CDDLNN","CEIITT","CEIPST","CFGNUY","DDHNOT","DHHLOR","DHHNOW","DHRTVW","EHILRS",
  "EIILST","EIMNRS","EIQSSU","EMOTTT","ENSSSU","GORRVW","HIRSTV","HOPRST","IPRSYY",
  "JKQWXZ","NOOTUW","OOOTTU"];
const DICE_FOR = {4: DICE4, 5: DICE5, 6: DICE6};

/* One shake of the tray, exactly as the real game does it: the official dice
   are shuffled into the grid — each die lands in one cell — and each shows a
   uniformly random face. Nothing is invented; every letter here is a face that
   exists on a real Boggle die. */
function shakeTray(rnd, n){
  const dice = DICE_FOR[n].slice();
  for (let i=dice.length-1;i>0;i--){ const j = Math.floor(rnd()*(i+1)); [dice[i],dice[j]]=[dice[j],dice[i]]; }
  // Every face is one letter; Q is the sole exception and always comes up "QU".
  return dice.map(d => {
    const f = d[Math.floor(rnd()*6)];
    return f === 'Q' ? 'QU' : f.toUpperCase();
  });
}
const hasVowel = c => /[AEIOU]/.test(c);   // "QU" carries its own U
/* How bad a tray is to actually play, 0 = fine. A real shake genuinely does
   deal out corners with no vowel within reach and trays swamped by one letter,
   and those rounds are miserable rather than challenging — you stare at letters
   that cannot combine into anything. */
function trayFlaws(board, n){
  const N = n * n;
  let flaws = 0;
  const vowels = board.filter(hasVowel).length;
  const lo = Math.ceil(N * .28), hi = Math.floor(N * .46);   // real trays sit ~36%
  if (vowels < lo) flaws += (lo - vowels) * 2;
  if (vowels > hi) flaws += vowels - hi;
  // every die needs a vowel on it or beside it, or that corner of the tray is dead
  const adj = adjacency(n);
  for (let i=0;i<N;i++){
    if (hasVowel(board[i])) continue;
    if (!adj[i].some(j => hasVowel(board[j]))) flaws += 3;
  }
  // and no single letter should swamp the tray
  const cap = n === 4 ? 3 : n === 5 ? 4 : 5;
  const counts = {};
  for (const c of board) counts[c] = (counts[c] || 0) + 1;
  for (const c in counts) if (counts[c] > cap) flaws += counts[c] - cap;
  return flaws;
}
/* Shake until the tray is one worth playing. The letters are never touched —
   no cell is edited, nothing is substituted — a dud tray is simply shaken again,
   which is what a person does with a real Boggle set. Draws keep coming from the
   one seeded stream, so every phone in the party re-shakes in lockstep and lands
   on the identical grid. If the dice are stubborn, the least-bad tray goes out. */
/* How many words an ordinary person could actually find on this tray before we
   inflict it on the family. The heuristics below (vowels, spread, no letter
   swamping the tray) catch obviously broken trays, but they cannot tell a tray
   with 55 findable words from one with 14 — and a 14-word tray is a miserable
   three minutes for everybody. Measured over 200 boards per size: this lifts
   the WORST 4×4 from 14 findable words to 55 and the median only from 78 to
   90, which is the intent — it deletes the bad trays rather than making every
   tray a bonanza. Counted against the common words only; nobody finds
   FADDIER.
   Nudged up once more (Max: "make it ever so slightly easier") — about a fifth
   higher across the board. Over 300 trays a size the floor is now met every
   time, and it lifts the bottom without touching the top: the worst 4×4 goes
   55 → 65 findable words and the median 84 → 92, the worst 5×5 75 → 90 and the
   median 119 → 127, the worst 6×6 120 → 140 and the median 182 → 190. */
/* The floor has to know the MINIMUM WORD LENGTH, not just the grid. A 5×5 is
   generous at three letters and brutal at five: the same tray goes from ~165
   findable words to ~38. A flat per-grid floor was therefore unreachable on the
   longer minimums — the generator burned every retry and handed over whatever
   it had, which is exactly the setting Max found too hard. Each cell below is
   roughly the 70th percentile of what that combination naturally offers, so a
   tray is always better than average for the rules you chose. */
const TRAY_FLOOR = {
  4: {3: 75,  4: 36,  5: 16, 6: 5},
  5: {3: 190, 4: 105, 5: 50, 6: 18},
  6: {3: 255, 4: 165, 5: 80, 6: 30}
};
const MAX_SOLVES = 14;   // reaching the 70th percentile takes a few goes
function genBoard(seed, n, minLen){
  const rnd = rngFromSeed(seed);
  const need = Math.min(6, Math.max(3, minLen || (n === 4 ? 3 : 4)));
  const byGrid = TRAY_FLOOR[n] || TRAY_FLOOR[5];
  const floor = byGrid[need] || byGrid[4];
  let best = null, bestWords = null, solves = 0;
  for (let attempt = 0; attempt < 60; attempt++){
    const board = shakeTray(rnd, n);
    const flaws = trayFlaws(board, n);
    if (flaws){
      if (!bestWords && (!best || flaws < best.flaws)) best = {board, flaws};
      continue;
    }
    // Passed the cheap gates. Out of solve budget? Take it — it is a sound tray.
    if (solves >= MAX_SOLVES) return bestWords ? bestWords.board : board;
    solves++;
    const words = solveBoard(board, n, need).size;
    if (words >= floor) return board;
    if (!bestWords || words > bestWords.words) bestWords = {board, words};
  }
  return bestWords ? bestWords.board : (best ? best.board : shakeTray(rnd, n));
}
function adjacency(n){
  const adj = [];
  for (let i=0;i<n*n;i++){
    const r = Math.floor(i/n), c = i%n, list = [];
    for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++){
      if (!dr && !dc) continue;
      const rr = r+dr, cc = c+dc;
      if (rr>=0 && rr<n && cc>=0 && cc<n) list.push(rr*n+cc);
    }
    adj.push(list);
  }
  return adj;
}

/* ---------------- dictionary ---------------- */
/* TWO dictionaries, two jobs.
   DICT is the full ENABLE list and decides what the game ACCEPTS — being told
   MITTEN is not a word is the worst thing a word game can do, so it is
   generous on purpose.
   COMMON is the ~43k words an ordinary family actually knows, and decides what
   the game SHOWS you and what a board is aimed at. ENABLE is a Scrabble list:
   "words you missed: FADDIER, QUONDAM, OGHAMS, GADID" made every round look
   arbitrary, and choosing boards by how many ENABLE words they hide optimised
   for exactly the wrong thing. Shipped as one bit per dictionary word (both
   lists are sorted) — 29KB rather than a second 380KB of text.
   See assets/make_common.py. */
const RAW_WORDS = "__DICT__";
const RAW_COMMON = "__COMMON__";
let DICT = null, WORDLIST = null, COMMON = null, COMMONLIST = null;
function ensureDict(){
  if (DICT) return;
  WORDLIST = RAW_WORDS.split(' ');
  DICT = new Set(WORDLIST);
  COMMON = new Set(); COMMONLIST = [];
  const bits = atob(RAW_COMMON);
  for (let i = 0; i < WORDLIST.length; i++){
    if (bits.charCodeAt(i >> 3) & (128 >> (i & 7))){ COMMON.add(WORDLIST[i]); COMMONLIST.push(WORDLIST[i]); }
  }
}
/* `words` picks the list: COMMONLIST for anything a player will read, or that
   decides how good a board is; WORDLIST when we genuinely need everything. */
function solveBoard(board, n, minLen, words){
  ensureDict();
  const counts = {};
  for (const cell of board) for (const ch of cell.toLowerCase()) counts[ch] = (counts[ch]||0) + 1;
  const cand = [];
  for (const w of (words || COMMONLIST)){
    if (w.length < minLen) continue;
    let ok = true; const c = {};
    for (const ch of w){ c[ch] = (c[ch]||0) + 1; if (!counts[ch] || c[ch] > counts[ch]){ ok = false; break; } }
    if (ok) cand.push(w);
  }
  const root = {};
  for (const w of cand){ let node = root; for (const ch of w){ node = node[ch] || (node[ch] = {}); } node.$ = 1; }
  const results = new Set();
  const cells = board.map(x => x.toLowerCase());
  const adj = adjacency(n);
  const used = new Array(n*n).fill(false);
  function walk(i, node, prefix){
    let nd = node;
    for (const ch of cells[i]){ nd = nd[ch]; if (!nd) return; }
    const word = prefix + cells[i];
    if (nd.$ && word.length >= minLen) results.add(word);
    used[i] = true;
    for (const j of adj[i]) if (!used[j]) walk(j, nd, word);
    used[i] = false;
  }
  for (let i=0;i<n*n;i++) walk(i, root, '');
  return results;
}
/* NETFLIX BOGGLE PARTY's table, which is NOT tabletop Boggle's: a word is worth
   its length minus two. 3=1, 4=2, 5=3, 6=4, 7=5, 8=6, and +1 for every letter
   after that. (Tabletop Boggle pays 1/1/2/3/5/11, which is what this used to
   use — it made an 8-letter word worth nearly twice what Netflix pays, so no
   score here matched the real game.) A word only one player found still pays
   DOUBLE on top, which is the party bonus. Every mode — party, daily and solo —
   scores through this one function, so they cannot drift apart.
   Qu counts as the two letters it is: QUIZ is a 4-letter word, 2 points. */
function scoreFor(w){
  return Math.max(0, w.length - 2);
}

/* ---------------- sound / haptics ---------------- */
let AC = null;
function ac(){ if (!AC){ try { AC = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){} } return AC; }
function tone(freq, dur, type, vol, when){
  if (!P.sound) return; const ctx = ac(); if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t0 = ctx.currentTime + (when||0);
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type||'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol||.08, t0+.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
  o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0+dur+.05);
}
const PENTA = [523, 587, 659, 784, 880, 1047, 1175, 1319];
const snd = {
  tick(k){ tone(PENTA[Math.min(k, PENTA.length-1)], .07, 'triangle', .06); },
  good(){ tone(659,.09,'sine',.1); tone(880,.1,'sine',.1,.06); tone(1319,.16,'sine',.09,.12); },
  dupe(){ tone(440,.09,'triangle',.07); },
  bad(){ tone(196,.13,'sawtooth',.06); tone(147,.18,'sawtooth',.06,.08); },
  beep(){ tone(880,.1,'square',.05); },
  go(){ tone(523,.12,'square',.07); tone(1047,.25,'square',.06,.1); },
  up(){ tone(523,.1,'sine',.09); tone(659,.1,'sine',.09,.09); tone(784,.1,'sine',.09,.18); tone(1047,.3,'sine',.09,.27); },
  fanfare(){ [523,659,784,1047,784,1047,1319].forEach((f,i)=>tone(f,.16,'triangle',.09,i*.11)); },
  // the unique-word ×2 flourish — a quick bright glissando
  spark(){ [1047,1319,1568,2093].forEach((f,i)=>tone(f,.09,'triangle',.08,i*.05)); },
  // "10 seconds left" — two urgent beeps, louder than the rest so it cuts through.
  warn(){ tone(988,.13,'square',.12); tone(988,.16,'square',.12,.22); }
};
const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch(e){} };

/* ---------------- background music ---------------- */
/* iOS silences Web Audio when the physical ring/silent switch is on. Holding a
   looping (silent) HTMLAudioElement open promotes the page's audio session to
   "playback", which plays through that switch — the standard fix so a phone on
   silent still gets game sound. Must be kicked off inside a real gesture. */
const SILENCE_SRC = 'data:audio/wav;base64,__SILENCE__';
let sessionAudio = null;
function holdAudioSession(){
  try {
    if (!sessionAudio){
      sessionAudio = new Audio(SILENCE_SRC);
      sessionAudio.loop = true;
      sessionAudio.setAttribute('playsinline', '');
    }
    const p = sessionAudio.play();
    if (p && p.catch) p.catch(() => {});
  } catch(e){}
}
function releaseAudioSession(){ try { if (sessionAudio) sessionAudio.pause(); } catch(e){} }

/* A short original loop, synthesized live with WebAudio — no audio files.
   Styled after Boggle's own table-top bounce: a swung marimba tune over a
   plucked bass, offbeat chord stabs, a shaker and a soft kick. Runs under the
   single SOUND toggle, same as every other sound here. */
const Music = (() => {
  const BPM = 118, BEAT = 60 / BPM, BAR = BEAT * 4, SW = .56; // swung 8ths
  const st = n => 261.63 * Math.pow(2, n / 12);   // semitones from middle C
  /* Eight bars, two four-bar phrases: A (C Am F G) asks, B (F C Dm G) answers.
     b = bass root, c = stab voicing (kept around middle C so the voices barely
     move between chords), m = melody in semitones above C5, one slot per
     eighth note, null = rest. */
  const BARS = [
    {b:-24, c:[0,4,7],  m:[4,7,9,7,   4,2,0,null]},
    {b:-15, c:[-3,0,4], m:[0,4,7,4,   9,7,4,null]},
    {b:-19, c:[0,5,9],  m:[5,9,12,9,  7,4,2,null]},
    {b:-17, c:[-1,2,7], m:[2,4,7,4,   2,0,null,null]},
    {b:-19, c:[0,5,9],  m:[9,12,14,12, 9,7,null,null]},
    {b:-24, c:[0,4,7],  m:[7,12,16,12, 14,12,9,null]},
    {b:-22, c:[2,5,9],  m:[2,5,9,5,   7,9,12,null]},
    {b:-17, c:[-1,2,7], m:[12,11,9,7, 4,2,0,null]},
  ];

  let timer = 0, barIdx = 0, nextBar = 0, playing = false, bus = null, noiseBuf = null;
  const LEVEL = 0.6;

  function getBus(ctx){
    if (!bus){ bus = ctx.createGain(); bus.gain.value = LEVEL; bus.connect(ctx.destination); }
    return bus;
  }
  function noise(ctx){
    if (!noiseBuf){
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * .25), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  function env(ctx, t, vel, dur){
    const g = ctx.createGain();
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    return g;
  }
  // fundamental + a fast-dying 4th partial: the woody "tock" of a mallet bar
  function marimba(ctx, dest, f, t, vel){
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    o.connect(env(ctx, t, vel, .38)).connect(dest); o.start(t); o.stop(t + .45);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 4;
    o2.connect(env(ctx, t, vel * .3, .09)).connect(dest); o2.start(t); o2.stop(t + .15);
  }
  function bass(ctx, dest, f, t){
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    o.connect(env(ctx, t, .2, .3)).connect(dest); o.start(t); o.stop(t + .36);
  }
  function stab(ctx, dest, notes, t, vel){
    for (const n of notes){
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = st(n);
      o.connect(env(ctx, t, vel, .16)).connect(dest); o.start(t); o.stop(t + .22);
    }
  }
  function shaker(ctx, dest, t, vel){
    const src = ctx.createBufferSource(); src.buffer = noise(ctx);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6500;
    src.connect(hp).connect(env(ctx, t, vel, .05)).connect(dest);
    src.start(t); src.stop(t + .08);
  }
  function thump(ctx, dest, t){
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(55, t + .09);
    o.connect(env(ctx, t, .17, .13)).connect(dest); o.start(t); o.stop(t + .17);
  }
  function scheduleBar(ctx, dest, bar, t0){
    // slot i = the i-th eighth note; odd slots land late — that's the swing
    const slot = i => t0 + Math.floor(i / 2) * BEAT + (i % 2 ? BEAT * SW : 0);
    bass(ctx, dest, st(bar.b), slot(0));
    bass(ctx, dest, st(bar.b), slot(4));
    bass(ctx, dest, st(bar.b + 7), slot(7));           // fifth walks into the next bar
    thump(ctx, dest, slot(0)); thump(ctx, dest, slot(4));
    for (let i = 0; i < 8; i++) shaker(ctx, dest, slot(i), i === 2 || i === 6 ? .09 : .04);
    stab(ctx, dest, bar.c, slot(3), .045);             // stabs bounce on the off-beats
    stab(ctx, dest, bar.c, slot(7), .035);
    bar.m.forEach((n, i) => { if (n !== null) marimba(ctx, dest, st(12 + n), slot(i), .11); });
  }
  function tick(){
    if (!playing) return;
    const ctx = ac();
    if (ctx){
      const dest = getBus(ctx);
      if (!nextBar || nextBar < ctx.currentTime) nextBar = ctx.currentTime + .06;
      while (nextBar < ctx.currentTime + .5){
        scheduleBar(ctx, dest, BARS[barIdx % BARS.length], nextBar);
        barIdx++; nextBar += BAR;
      }
    }
    timer = setTimeout(tick, 120);
  }
  return {
    start(){
      if (playing || !P.sound) return;
      const ctx = ac(); if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      holdAudioSession(); // keep sound audible with the phone on silent
      // A stop() may have zeroed the bus — bring it back before scheduling resumes.
      if (bus){ bus.gain.cancelScheduledValues(ctx.currentTime); bus.gain.setValueAtTime(LEVEL, ctx.currentTime); }
      playing = true;
      tick();
    },
    stop(){
      playing = false;
      clearTimeout(timer);
      releaseAudioSession();
      // Silence right now, not whenever whatever's already ringing finishes —
      // a chord pad note can be scheduled up to ~2s out, and "sound off" has
      // to mean instantly off, not "off in a couple of seconds."
      if (bus){ const ctx = ac(); if (ctx){ bus.gain.cancelScheduledValues(ctx.currentTime); bus.gain.setValueAtTime(0.0001, ctx.currentTime); } }
    },
    setEnabled(on){ on ? this.start() : this.stop(); }
  };
})();
/* Music only plays DURING a round — menus, lobby and results stay music-free.
   A round can begin from a network message (the host started the game), which
   is not a user gesture, and autoplay policy wants one. So the first tap
   anywhere primes audio instead of starting music: it resumes the context and
   briefly plays the silent session clip, which marks it gesture-blessed so a
   later, message-triggered play() is allowed. */
document.addEventListener('click', function unlockAudio(){
  document.removeEventListener('click', unlockAudio);
  const ctx = ac();
  if (ctx && ctx.state === 'suspended') ctx.resume();
  holdAudioSession();
  setTimeout(releaseAudioSession, 250);
}, {once: true});
// "In a round" = the game screen is up and I'm actually playing in it —
// spectators watching mid-round get silence too.
function inRound(){ return $('scr-game').classList.contains('active') && !G.spectating; }
/* touch-action is not enough on iOS: the document still pans and bounces. While
   the game screen is up, refuse any touch-move that isn't inside one of the two
   horizontal strips. The board's own tracing uses pointer events, so this
   doesn't touch it. */
document.addEventListener('touchmove', e => {
  if (!$('scr-game').classList.contains('active')) return;
  const t = e.target;
  if (t && t.closest && t.closest('.rivals, .found-row, .chat-log, .modal')) return;
  e.preventDefault();
}, {passive: false});

document.addEventListener('visibilitychange', () => {
  if (document.hidden){ Music.stop(); return; }
  /* Coming back from a sleep, every peer looks silent for as long as we were
     away — and a phone that concludes everyone is gone crowns ITSELF, then
     gossips h:true and fights the real host. Give everyone the benefit of the
     doubt for a few seconds and let the heartbeats prove it either way. */
  for (const [,p] of G.peers) p.seen = Math.max(p.seen || 0, Date.now() - 5000);
  if (inRound()) Music.start();
});

/* ---------------- global state ---------------- */
const AVATARS = ['🦊','🐼','🦄','🐸','🐯','🐙','🦁','🐨','🐷','🐵','🦖','🐳'];
const COLORS = ['#FF5757','#FF9F1C','#F5C400','#3DDC5A','#00B8A0','#3B82F6','#8B5CF6','#FF6BD6'];
const P = {   // me + app prefs
  name: store.get('name', ''),
  emoji: store.get('emoji', ''),
  sound: store.get('sound', true),
  /* The transport mints a NEW selfId on every page load, so a phone that
     reloads — iOS reclaiming the tab, a pull-to-refresh, our own "Rejoin
     party" banner — used to come back as a stranger: the party saw two of
     them, one holding all the points and one on zero, and the ghost could
     even take a medal on the podium. This id survives a reload, so a
     returning player is recognised as themselves. */
  pid: store.get('pid', '') || (() => {
    const v = Math.random().toString(36).slice(2) + Date.now().toString(36);
    store.set('pid', v); return v;
  })()
};
const G = {   // current game context
  mode: null,          // 'party' | 'solo' | 'daily'
  code: null,
  net: null,           // {room, actions...}
  isHost: false,
  peers: new Map(),    // peerId -> {name, emoji, joinedAt, host, gone, sc:{round:score}, fin:{round:{...}}}
  joinedAt: 0,
  cfg: store.get('cfg', {g:4, t:180, m:3, r:3}),
  seeds: [],
  round: 0,
  gameId: null,        // random per game, so re-broadcast starts are recognisable
  beganKey: null,      // gameId:round we've already entered — ignore repeats
  startAt: 0,
  clockOffset: 0,      // hostNow - myNow
  playing: false,
  spectating: false,
  board: [], n: 4, adj: null,
  path: [], found: new Map(), score: 0,
  possible: null,
  totalMs: 0, endAt: 0, raf: 0,
  activePointer: null,
  finsSelf: {},        // round -> fin payload (mine)
  lock: null,
  finTimer: 0,
  chat: [],            // party chat, newest last — lives as long as the room does
  pendingStart: null,  // host moved on while we were still playing — applied at round end
  pendingNext: null,
  pendingAgain: false,
  selOk: false,        // the trace currently spells a real word
  specTimer: 0,        // spectator watch interval
  gossipTimer: 0,      // periodic roster/score broadcast
  sweepTimer: 0,       // drops gossiped peers nobody reports any more
  seq: 0               // my own broadcast counter — proves my news is new
};
const GOSSIP_MS = 3000;   // re-announce cadence
const GOSSIP_TTL = 14000; // forget an indirect peer nobody has mentioned this long
const HOST_GRACE_MS = 6000; // how long a joiner waits to hear a host claim before taking it
const DEV = /[?#&]dev\b/.test(location.href);

/* ---------------- staying up to date ----------------
   The whole game is one big HTML file that phones hold on to — a page opened
   this morning keeps running this morning's code until something makes it
   reload, which is why a deploy can land and nobody sees it. version.txt sits
   next to index.html and says what the server has right now; a few bytes,
   never cached. If it disagrees with the build baked into this page, offer the
   update — never mid-round, and never without asking. */
const BUILD = "__BUILD__";
let updateReady = null;
async function checkForUpdate(){
  if (updateReady || G.playing) return;
  try {
    const r = await fetch('version.txt?t=' + Date.now(), {cache: 'no-store'});
    if (!r.ok) return;
    const v = (await r.text()).trim();
    // Must LOOK like a build stamp. A 404 page, a captive-portal login or any
    // other HTML would otherwise read as "new version" and nag forever.
    if (!/^[0-9a-f]{8,16}$/.test(v) || v === BUILD) return;
    updateReady = v; showUpdateBar();
  } catch(e){}
}
function showUpdateBar(){
  if ($('update-bar')) return;
  const bar = el('div','update-bar');
  bar.appendChild(el('span','', '✨ There\u2019s a newer version'));
  const go = el('button','btn green small','Update');
  go.addEventListener('click', () => {
    // a fresh URL, so the phone fetches rather than serving what it already has
    location.replace(location.pathname + '?v=' + encodeURIComponent(updateReady));
  });
  bar.appendChild(go);
  const no = el('button','update-no','later');
  no.addEventListener('click', () => bar.remove());
  bar.appendChild(no);
  bar.id = 'update-bar';
  document.body.appendChild(bar);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
setTimeout(checkForUpdate, 4000);
setInterval(checkForUpdate, 5 * 60 * 1000);

/* ---------------- playing with no signal ----------------
   Everything the game needs is already in this one file, so Solo Practice and
   the Daily Puzzle work with no connection at all — they only need the page to
   open. The worker keeps a copy so it does. Party mode genuinely can't: the
   phones talk through public brokers. */
if ('serviceWorker' in navigator && location.protocol !== 'file:'){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});   // http:// dev, private mode, etc
  });
}
function online(){ return navigator.onLine !== false; }
function applyOnlineUI(){
  const off = !online();
  $('offline-note').hidden = !off;
  $('btn-host').classList.toggle('dimmed', off);
  $('btn-join').classList.toggle('dimmed', off);
}
window.addEventListener('online', applyOnlineUI);
window.addEventListener('offline', applyOnlineUI);

/* ---------------- screens / toast / overlay ---------------- */
const SCREENS = ['name','home','hof','join','lobby','game','standings','reveal','podium'];
function show(name){
  SCREENS.forEach(s => $('scr-'+s).classList.toggle('active', s === name));
  $('confirm-exit').hidden = true; // never let a dialog outlive its screen
  $('settings-modal').hidden = true;
  $('chat-modal').hidden = true;
  window.scrollTo(0,0);
}
let toastT = 0;
function toast(msg, ms){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms||2200);
}
function overlay(big, sub, cls){
  $('overlay-big').textContent = big;
  $('overlay-big').className = 'overlay-big' + (cls ? ' '+cls : '');
  $('overlay-sub').textContent = sub || '';
  const ob = $('overlay-big');
  ob.style.animation = 'none'; void ob.offsetWidth; ob.style.animation = '';
  $('overlay').classList.add('show');
}
function hideOverlay(){ $('overlay').classList.remove('show'); }

/* ---------------- profile screen ---------------- */
function renderAvatars(){
  const row = $('avatar-row'); row.replaceChildren();
  AVATARS.forEach(e => {
    const b = el('button', 'avatar-pick' + (e === P.emoji ? ' on' : ''), e);
    b.type = 'button'; b.setAttribute('aria-label', 'avatar ' + e);
    b.addEventListener('click', () => { P.emoji = e; renderAvatars(); snd.tick(2); });
    row.appendChild(b);
  });
}
function openName(){
  $('name-input').value = P.name || '';
  if (!P.emoji) P.emoji = AVATARS[Math.floor(Math.random()*AVATARS.length)];
  renderAvatars();
  show('name');
}
$('btn-name-go').addEventListener('click', () => {
  const v = $('name-input').value.trim();
  if (!v){ $('name-input').focus(); toast('Type your name first!'); return; }
  P.name = v.slice(0,14);
  store.set('name', P.name); store.set('emoji', P.emoji);
  snd.up();
  refreshHome();  // surfaces the invite banner if a link brought them here
  show('home');
});
$('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-name-go').click(); });
$('btn-me').addEventListener('click', openName);

/* ---------------- home ---------------- */
// Keep both sound controls (home button + in-game HUD) showing the same state.
function applySoundUI(){
  $('btn-sound').textContent = P.sound ? 'SOUND ON' : 'SOUND OFF';
  $('btn-game-sound').textContent = P.sound ? '🔊' : '🔇';
}
function toggleSound(){
  P.sound = !P.sound;
  store.set('sound', P.sound);
  applySoundUI();
  // Music is a mid-round thing only: toggling sound on from a menu shouldn't
  // start it, but toggling it back on during a round should.
  Music.setEnabled(P.sound && inRound());
  if (P.sound) snd.tick(3);
}
function refreshHome(){
  applyOnlineUI();
  $('me-name').textContent = P.name || 'Player';
  $('me-face').textContent = P.emoji || '🦊';
  applySoundUI();
  renderSettings();   // keeps home's ⚙️ readout honest
  // An invite link's code waits here as one obvious tap instead of joining by
  // itself — see boot(). Once used (or dismissed) the banner is gone.
  $('invite-banner').hidden = !pendingRoom;
  if (pendingRoom){
    $('btn-invite-join').textContent = (pendingIsRejoin ? '🔄\xa0 Rejoin party ' : '🎟️\xa0 Join party ') + pendingRoom;
    document.querySelector('#invite-banner .invite-note').textContent =
      pendingIsRejoin ? 'You were in a party — jump back in!' : 'Someone invited you to their party!';
  }
  const daily = store.get(dailyKey(sanitizeCfg(store.get('cfg', {g:4})).g), null);
  $('daily-done').hidden = daily === null;
  if (daily !== null) $('daily-done').textContent = daily + ' PTS ✓';
  const r = record();
  $('hof-line').textContent = r.games
    ? r.wins + ' win' + (r.wins === 1 ? '' : 's') + ' · ' + r.games + ' game' + (r.games === 1 ? '' : 's') + ' · best round ' + r.pb
    : 'your wins, your best ever';
  $('home-stats').textContent = r.games
    ? `Best round: ${r.pb} pts · ${r.games} game${r.games === 1 ? '' : 's'} played`
    : 'Find words. Longer = more points!';
}
$('btn-sound').addEventListener('click', toggleSound);
$('btn-game-sound').addEventListener('click', toggleSound);
$('btn-invite-join').addEventListener('click', () => {
  const c = pendingRoom; pendingRoom = null; pendingIsRejoin = false;
  refreshHome();
  if (c) joinParty(c);
});
$('btn-invite-no').addEventListener('click', () => {
  pendingRoom = null;
  if (pendingIsRejoin){ pendingIsRejoin = false; store.set('lastparty', null); }  // don't nag again
  refreshHome(); snd.tick(1);
});
$('btn-host').addEventListener('click', () => {
  if (!online()) return toast('No connection — a party needs one. Solo and the Daily still work!', 3200);
  hostParty();
});
$('btn-join').addEventListener('click', () => {
  if (!online()) return toast('No connection — a party needs one. Solo and the Daily still work!', 3200);
  $('code-input').value = ''; show('join'); setTimeout(()=>$('code-input').focus(), 80);
});
$('btn-join-back').addEventListener('click', () => show('home'));
$('btn-solo').addEventListener('click', () => startLocal('solo'));
/* ---------------- hall of fame ---------------- */
function renderHallOfFame(){
  const r = record();
  $('hof-wins').textContent = r.wins;
  $('hof-games').textContent = r.games;
  $('hof-pb').textContent = r.pb;
  $('hof-pbgame').textContent = r.pbGame;
  $('hof-rate').textContent = r.party ? Math.round(r.wins / r.party * 100) + '%' : '—';
  $('hof-partygames').textContent = r.party;
  $('hof-podiums').textContent = r.podiums;
  $('hof-words').textContent = r.words;
  $('hof-bw').textContent = r.bw ? r.bw.toUpperCase() + ' (' + r.bwp + ')' : '—';
  $('hof-foot').textContent = r.wins
    ? (r.wins === 1 ? 'One win on the board. Go again!' : r.wins + ' wins and counting!')
    : 'Win a party game to get on the board!';
  // In a party, everyone's lifetime record rides along with the roster, so the
  // family can see how they stack up against each other, not just this game.
  const crew = G.mode === 'party'
    ? everyone().map(([id,p]) => ({id, p, rec: p.me ? {w:r.wins, g:r.games, p:r.pb} : (p.rec || null)}))
        .filter(x => x.rec)
    : [];
  $('hof-party').hidden = crew.length < 2;
  if (crew.length >= 2){
    crew.sort((a,b) => b.rec.w - a.rec.w || b.rec.p - a.rec.p);
    const list = $('hof-party-list'); list.replaceChildren();
    crew.forEach((x, i) => {
      const row = el('div','stand-row' + (i === 0 && x.rec.w > 0 ? ' first' : '') + (x.p.me ? ' me' : ''));
      row.appendChild(el('span','rank', String(i+1)));
      const face = el('span','face', x.p.emoji); face.style.setProperty('--c', colorOf(x.id));
      row.appendChild(face);
      const info = el('div','info');
      info.appendChild(el('b','', x.p.me ? x.p.name + ' (you)' : x.p.name));
      info.appendChild(el('small','', x.rec.g + ' game' + (x.rec.g === 1 ? '' : 's') + ' · best round ' + x.rec.p));
      row.appendChild(info);
      const pts = el('span','pts', String(x.rec.w));
      pts.appendChild(el('small','', x.rec.w === 1 ? ' win' : ' wins'));
      row.appendChild(pts);
      list.appendChild(row);
    });
  }
}
function openHallOfFame(){ renderHallOfFame(); show('hof'); snd.tick(2); }
$('btn-hof').addEventListener('click', openHallOfFame);
$('btn-hof-back').addEventListener('click', () => show(G.mode === 'party' ? 'lobby' : 'home'));
$('btn-daily').addEventListener('click', () => startLocal('daily'));

/* ---------------- join ---------------- */
$('code-input').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g,'');
  // The 4th letter IS the go — no extra tap to join.
  if (e.target.value.length === 4) $('btn-join-go').click();
});
$('code-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join-go').click(); });
$('btn-join-go').addEventListener('click', () => {
  const code = $('code-input').value.trim().toUpperCase();
  if (code.length !== 4){ $('join-note').textContent = 'The code is 4 letters — ask the host!'; return; }
  joinParty(code);
});

/* ================================================================
   NETWORKING
   ================================================================ */
const CODE_CHARS = 'ABCDEFGHJKMNPRSTUVWXYZ';
function makeCode(){
  let c = '';
  for (let i=0;i<4;i++) c += CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)];
  return c;
}
/* ================================================================
   HALL OF FAME — what this phone has done, ever. Kept locally (there is no
   server) and gossiped with the roster, so a party can also see everyone's
   lifetime record next to each other.
   ================================================================ */
const REC0 = {wins: 0, games: 0, party: 0, pb: 0, pbGame: 0, bw: '', bwp: 0, words: 0, podiums: 0};
function record(){ return Object.assign({}, REC0, store.get('record', {})); }
function saveRecord(r){ store.set('record', r); }
/* One game is counted once, and only when it truly ends: keyed on the game id so
   a re-render, a rejoin, or a second phone's late report can't inflate it. */
/* Every finished game counts — solo and the daily as well as parties. It used
   to bank party games only, so a phone that mostly played solo showed a record
   of almost nothing while the home screen (reading a different, older counter)
   claimed seventeen games. One counter now, and it is this one. */
function gameKey(){
  if (G.mode === 'party') return G.gameId;
  if (G.mode === 'daily') return dailyKey(G.cfg.g);   // once a day per size, however often you replay it
  return G.seeds && G.seeds[0];
}
function alreadyCounted(key){
  const seen = store.get('counted', []);
  return Array.isArray(seen) ? seen.includes(key) : seen === key;
}
function markCounted(key){
  const seen = store.get('counted', []);
  const list = Array.isArray(seen) ? seen : (seen ? [seen] : []);
  list.push(key);
  store.set('counted', list.slice(-30));   // enough to outlive an evening
}
function creditGame(rows){
  const key = gameKey();
  if (!key || alreadyCounted(key)) return;
  if (G.mode === 'party'){
    /* Don't bank a win off a provisional podium. The last straggler's report
       can still reorder it, and once counted the record can never be corrected
       — the phone would claim a win for a game the screen says was lost, and
       gossip that claim to the party leaderboard. Anyone with no evidence of
       playing (a spectator) can't hold this up, and 8s after the buzzer we take
       what we have. */
    const rl = G.cfg.r - 1;
    const played = activePlayers().filter(([,p]) =>
      (p.me ? G.finsSelf[rl] : p.fin && p.fin[rl]) || (p.sc && p.sc[rl] !== undefined));
    const reported = played.filter(([,p]) => p.me ? G.finsSelf[rl] : (p.fin && p.fin[rl]));
    if (reported.length < played.length && Date.now() - (G.finAt || 0) < 8000) return;
  }
  markCounted(key);
  const r = record();
  r.games++;
  if (G.mode === 'party' && rows){
    r.party++;
    const me = rows.findIndex(x => x.p.me);
    if (me === 0 && rows.length > 1) r.wins++;
    if (me >= 0 && me < 3 && rows.length > 2) r.podiums++;
    if (me >= 0 && rows[me].total > r.pbGame) r.pbGame = rows[me].total;
  } else {
    // solo and daily are one round against yourself — no win, but it still counts
    let total = 0;
    for (const rd in G.finsSelf) total += G.finsSelf[rd].s || 0;
    if (total > r.pbGame) r.pbGame = total;
  }
  saveRecord(r);
  renderHallOfFame();
  refreshHome();
}
/* One-time repair for phones that have been playing all along: the old counter
   tallied every game started, in any mode, and the record only knew about
   parties. Take the larger of the two as the true total and keep the party
   count for the win rate. */
(function migrateRecord(){
  if (store.get('recmigrated', false)) return;
  const r = record(), legacy = store.get('games', 0);
  if (!r.party && r.games) r.party = r.games;   // what "games" used to mean
  r.games = Math.max(r.games, legacy);
  saveRecord(r);
  store.set('recmigrated', true);
})();
/* Round-level bests, from any mode. */
function creditRound(fin){
  const r = record();
  if (fin.s > r.pb) r.pb = fin.s;
  if (fin.bp > r.bwp || (fin.bp === r.bwp && (fin.b||'').length > (r.bw||'').length)){
    if (fin.b){ r.bw = fin.b; r.bwp = fin.bp; }
  }
  r.words += fin.w || 0;
  saveRecord(r);
}
function myProfile(){
  const r = record();
  return {n: P.name, e: P.emoji, h: G.isHost, j: G.joinedAt, pid: P.pid,
          rec: {w: r.wins, g: r.games, p: r.pb}};
}
/* Everything we know about the party, re-broadcast on a timer. The mesh is not
   always complete — two phones can both be talking to a third but not to each
   other — so a player is only reliably visible to everyone if the people who
   can see them pass it on. Scores only grow within a round, so merging by max
   converges without a coordinator.

   Each phone stamps its own broadcasts with a counter only it increments, so a
   relayed copy is recognisable as old news. Without that, phones echo each
   other's hearsay forever and someone who left never ages out. */
function syncPayload(){
  const players = {};
  G.seq++;
  const myRec = record();
  players[Trystero.selfId] = {n: P.name, e: P.emoji, j: G.joinedAt, h: G.isHost, q: G.seq,
                              gid: G.gameId, pid: P.pid, sc: scSelf(), wc: wcSelf(), fin: G.finsSelf,
                              rec: {w: myRec.wins, g: myRec.games, p: myRec.pb}};
  for (const [id, p] of G.peers){
    /* A finished round is immutable history — keep relaying it even after that
       player leaves. It used to stop the moment they were marked gone, so any
       phone that was off-net for their one-shot report never learned it,
       computed the unique bonus against one list too few, and paid DOUBLE for
       words that were actually shared — permanently, right into the podium.
       g:1 marks the entry results-only so it can't resurrect them into the
       lobby or the host election. */
    const relayed = {n: p.name, e: p.emoji, j: p.joinedAt, h: !!p.host, gid: p.gid, pid: p.pid,
                     sc: p.sc || {}, wc: p.wc || {}, fin: p.fin || {}};
    if (p.gone) relayed.g = 1;
    if (p.rec) relayed.rec = p.rec;
    if (Number.isFinite(p.seq)) relayed.q = p.seq;
    players[id] = relayed;
  }
  return players;
}
/* live: first-hand proof this peer is alive right now (a message from them).
   self: `inc` is their own account of themselves, so it wins on name/avatar. */
function mergePlayer(id, inc, {live = false, self = false} = {}){
  let cur = G.peers.get(id), isNew = false;
  /* Same person, new transport id (they reloaded): carry their history over to
     the new id instead of leaving a ghost holding all their points. ONLY when
     the old entry has actually fallen silent, though — if two live players ever
     carry the same id (a restored backup, a cloned profile, two tabs sharing
     one localStorage) adopting would delete one of them from the party
     outright, which is far worse than a duplicate. */
  if (!cur && inc.pid){
    for (const [oid, op] of G.peers){
      if (op.pid !== inc.pid || oid === id) continue;
      const silent = op.gone || Date.now() - (op.seen || 0) > 15000;
      if (!silent) break;                 // they're both here — leave both alone
      G.peers.delete(oid); G.peers.set(id, op); cur = op;
      cur.gone = false; cur.gone2 = false;
      break;
    }
  }
  if (!cur){
    cur = {name:'Player', emoji:'🙂', joinedAt: Date.now(), host:false, gone:false,
           sc:{}, wc:{}, fin:{}, seq:-Infinity, seen:0, direct:false};
    G.peers.set(id, cur);
    isNew = true;
  }
  if (inc.pid) cur.pid = inc.pid;
  /* Scores belong to a GAME. Nothing used to say which one, and fin is
     write-once — so one straggler still gossiping the previous game (parked in
     pendingStart, or one that missed the "play again") permanently fixed round
     0's report on every phone that heard it. The real report was then discarded
     for good: the reveal staged words that were never on this board and the ×2
     came out wrong for everyone. Unknown gid (solo, or a phone on the old
     build) is still accepted, so nothing breaks mid-party. */
  const gid = inc.gid === undefined ? null : inc.gid;
  if (gid === null || gid === G.gameId){
    for (const r in inc.sc||{}) cur.sc[r] = Math.max(cur.sc[r]||0, inc.sc[r]||0);
    if (!cur.wc) cur.wc = {};
    for (const r in inc.wc||{}) cur.wc[r] = Math.max(cur.wc[r]||0, inc.wc[r]||0);
    // `self` is their own first-hand report — it must be able to replace hearsay
    for (const r in inc.fin||{}) if (self || !cur.fin[r]) cur.fin[r] = inc.fin[r];
    if (gid !== null) cur.gid = gid;
  } else if (cur.gid !== gid){
    cur.gid = gid; cur.sc = {}; cur.fin = {};   // they moved on to another game
  }

  const q = typeof inc.q === 'number' ? inc.q : null;
  const fresh = live || isNew || (q !== null && q > cur.seq);
  if (fresh){
    if (q !== null && q > cur.seq) cur.seq = q;
    cur.seen = Date.now();
    if (!inc.g){ cur.gone = false; cur.gone2 = false; } // back with us — let a future exit announce again
    if (inc.n !== undefined) cur.name = String(inc.n||'Player').slice(0,14);
    if (inc.e !== undefined) cur.emoji = inc.e || '🙂';
    if (inc.j !== undefined) cur.joinedAt = inc.j;
    if (inc.h !== undefined) cur.host = !!inc.h;
    if (inc.rec) cur.rec = inc.rec;   // their lifetime record, for the party leaderboard
  }
  if (inc.g && isNew){ cur.gone = true; cur.gone2 = true; }  // relayed history, not an arrival
  if (self) cur.direct = true;
  return isNew && !inc.g;   // no join-ding for someone who already left
}
function connect(code, asHost){
  leaveNet();
  G.mode = 'party'; G.code = code; G.isHost = asHost; G.joinedAt = Date.now();
  G.peers = new Map(); G.finsSelf = {}; G.round = 0; G.seeds = [];
  G.spectating = false; G.seq = 0;
  G.pendingStart = null; G.pendingNext = null; G.pendingAgain = false;
  /* Rejoining the party you just left has to re-learn the game from scratch. Left
     set, G.beganKey made every one of the host's start re-broadcasts look like a
     repeat, so the phone sat in the lobby for the rest of the night. */
  G.gameId = null; G.beganKey = null; G.startAt = 0; G.playing = false;
  G.chat = []; chatDrawn = 0; chatUnread = 0; renderChat();   // a new party starts with an empty chat
  lobbySig = null;  // new room — force the roster to rebuild
  if (asHost) G.cfg = store.get('cfg', {g:4, t:180, m:3, r:3});

  // Pin the signalling to major, high-uptime nostr relays. The bundle's own
  // default list is long and full of small or dead relays — a bad draw could
  // leave two phones announcing to disjoint (or dead) relays and never meeting,
  // which looks like "I joined the code but nobody appeared." Every phone uses
  // this same fixed list, so hosts and joiners always share relays.
  const RELAYS = ['relay.damus.io','nos.lol','relay.primal.net','nostr.mom','offchain.pub',
    'nostr.oxtr.dev','nostr21.com','relay.nostr.net','nostr.land'].map(h => 'wss://' + h);
  // TURN relays the actual game traffic when the phones' networks (carrier
  // NAT, strict WiFi) refuse a direct link — without it, the phones can find
  // each other via the relays yet still never connect. turnConfig is appended
  // to the bundle's built-in STUN list.
  const TURN = [{
    urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443',
           'turn:openrelay.metered.ca:443?transport=tcp'],
    username: 'openrelayproject', credential: 'openrelayproject'
  }];
  const room = Trystero.joinRoom({appId:'boggleflix-party-v1', relayConfig:{urls: RELAYS}, turnConfig: TURN}, 'bfp-' + code.toLowerCase());
  const A = {
    who:   room.makeAction('who'),
    sync:  room.makeAction('sync'),
    cfg:   room.makeAction('cfg'),
    start: room.makeAction('start'),
    nxt:   room.makeAction('nxt'),
    sc:    room.makeAction('sc'),
    fin:   room.makeAction('fin'),
    again: room.makeAction('again'),
    chat:  room.makeAction('chat')
  };
  G.net = {room, A};

  room.onPeerJoin = id => {
    const p = G.peers.get(id);
    if (p){ p.direct = true; p.gone = false; p.seen = Date.now(); }
    A.who.send({...myProfile(), ask: 1}, {target: id});
    A.sync.send(syncPayload(), {target: id});
    if (G.isHost){
      A.cfg.send(G.cfg, {target: id});
      if (G.playing || (G.seeds.length && G.round < G.cfg.r)){
        A.start.send(startPayload(), {target: id});
      }
    }
  };
  room.onPeerLeave = id => {
    const p = G.peers.get(id);
    const wasHost = !!(p && p.host);
    if (p){ p.direct = false; p.gone = true; }
    electHost();
    // The grace that protects a blinking host also delays a real handover, so
    // look again once it has expired rather than waiting on a message.
    if (wasHost) setTimeout(electHost, HOST_SILENCE_MS + 500);
    renderLobbyPlayers(); renderRivals();
    maybeFinishCollection();
    // Losing our own link to someone doesn't mean they left the party — someone
    // else may still be relaying them. Give that a moment to land first.
    setTimeout(() => announceGone(id), GOSSIP_MS + 500);
  };
  A.who.onMessage = (d, {peerId}) => {
    const fresh = mergePlayer(peerId, d, {live: true, self: true});
    // Answer once, so a dropped hello still leaves both sides knowing each other.
    if (d.ask) A.who.send({...myProfile(), ask: 0}, {target: peerId});
    electHost();
    renderLobbyPlayers(); renderRivals();
    if (fresh && !G.playing) snd.tick(4);
  };
  A.sync.onMessage = (d, {peerId}) => {
    let fresh = false;
    for (const id in d){
      if (id === Trystero.selfId) continue; // never let anyone else define me
      const own = id === peerId;
      if (mergePlayer(id, d[id], {live: own, self: own})) fresh = true;
    }
    electHost();
    renderLobbyPlayers(); renderRivals();
    maybeFinishCollection();
    if (fresh && !G.playing) snd.tick(4);
  };
  A.cfg.onMessage = d => {
    if (G.isHost) return;
    G.cfg = sanitizeCfg(d);
    renderSettings();
  };
  A.start.onMessage = d => { if (!G.isHost) handleStart(d); };
  A.nxt.onMessage = d => { if (!G.isHost) handleNext(d); };
  A.sc.onMessage = (d, {peerId}) => {
    mergePlayer(peerId, {gid: d.gid, sc: {[d.r]: d.s}, wc: {[d.r]: d.w}}, {live: true, self: true});
    renderRivals();
  };
  A.fin.onMessage = (d, {peerId}) => {
    mergePlayer(peerId, {gid: d.gid, sc: {[d.r]: d.s}, wc: {[d.r]: d.w}, fin: {[d.r]: d}}, {live: true, self: true});
    maybeFinishCollection(); // refreshes whichever results screen is up
  };
  /* Never yank a phone out of a live round. The host can reach the podium and
     tap "play again" while a slower phone is still playing — a straggler who
     started late, or one whose end-of-round timer was throttled in the
     background. Remember the request and honour it when their round is over. */
  A.again.onMessage = () => {
    if (G.isHost) return;
    if (G.playing){ G.pendingAgain = true; return; }
    resetToLobby();
  };
  A.chat.onMessage = (d, {peerId}) => {
    const p = G.peers.get(peerId) || {};
    addChat({id: peerId, n: (d && d.n) || p.name || 'someone', e: (d && d.e) || p.emoji || '🙂', t: d && d.t});
  };

  clearInterval(G.gossipTimer);
  G.gossipTimer = setInterval(() => {
    if (!G.net) return;
    /* Re-check the crown every tick. With two phones, the host leaving cleanly
       used to leave the survivor hostless forever: onPeerLeave elected once
       while the 30s grace still covered the departed host, and nothing ever
       ran the election again — no Start button, no next round, no way out. */
    electHost();
    G.net.A.sync.send(syncPayload());
    // While the host is mid-round, keep re-announcing the round so any phone
    // that missed the one-shot start (backgrounded, dropped packet, joined a
    // beat late) gets pulled in within a few seconds instead of being stranded
    // in the lobby. handleStart ignores it once you're already in the round.
    if (G.isHost && G.playing) G.net.A.start.send(startPayload());
    // Keep the lobby's status line current (it mentions elapsed time when a
    // joiner is still alone) even when no network event triggers a render.
    if ($('scr-lobby').classList.contains('active')) renderLobbyPlayers();
  }, GOSSIP_MS);
  clearInterval(G.sweepTimer);
  G.sweepTimer = setInterval(sweepPeers, GOSSIP_MS);
  openLobby();
}
// An indirect peer is only ever hearsay: once nobody relays them any more, they
// have left. Directly connected peers are handled by onPeerLeave instead.
function sweepPeers(){
  let changed = false;
  for (const [id, p] of G.peers){
    if (p.direct || p.gone) continue;
    if (Date.now() - (p.seen || 0) > GOSSIP_TTL){ p.gone = true; changed = true; announceGone(id); }
  }
  if (changed){ electHost(); renderLobbyPlayers(); renderRivals(); }
}
function announceGone(id){
  const p = G.peers.get(id);
  if (!p || !p.gone || p.gone2) return;
  p.gone2 = true;
  toast((p.name || 'Someone') + ' left');
}
function leaveNet(){
  clearInterval(G.gossipTimer); G.gossipTimer = 0;
  clearInterval(G.sweepTimer); G.sweepTimer = 0;
  if (G.net){ try { G.net.room.leave(); } catch(e){} }
  G.net = null;
}
/* iOS fires pagehide when the app is merely backgrounded or the page enters the
   back/forward cache — and leaveNet() publishes __bye, which drops that phone
   from everyone's party INSTANTLY, bypassing the entire 30s/45s grace. It also
   sets alive=false, so the bus never reconnects. That is a live player being
   thrown out of a running game for switching apps. Only announce a departure
   when the page is really going away. */
window.addEventListener('pagehide', e => { if (!e.persisted) leaveNet(); });

function sanitizeCfg(d){
  const pick = (v, list, dflt) => list.includes(v) ? v : dflt;
  const g = pick(+d.g, [4,5,6], 4);
  return {
    g,
    t: pick(+d.t, [30,60,90,120,180], 180),
    // Real Boggle: 3-letter words count on 4×4, but the bigger boards
    // (Big/Super Big Boggle) require 4 letters.
    m: pick(+d.m, [3,4,5,6], g === 4 ? 3 : 4),
    r: pick(+d.r, [1,3,5], 3)
  };
}
function activePlayers(){ // everyone incl. me, not gone
  const list = [[Trystero.selfId, {name:P.name, emoji:P.emoji, joinedAt:G.joinedAt, host:G.isHost, gone:false, sc:scSelf(), fin:G.finsSelf, me:true}]];
  for (const [id,p] of G.peers) if (!p.gone) list.push([id, p]);
  return list.sort((a,b) => (a[1].joinedAt - b[1].joinedAt) || (a[0] < b[0] ? -1 : 1));
}
function everyone(){ // incl. gone (for results)
  const list = [[Trystero.selfId, {name:P.name, emoji:P.emoji, joinedAt:G.joinedAt, host:G.isHost, gone:false, sc:scSelf(), fin:G.finsSelf, me:true}]];
  for (const [id,p] of G.peers) list.push([id, p]);
  return list.sort((a,b) => (a[1].joinedAt - b[1].joinedAt) || (a[0] < b[0] ? -1 : 1));
}
/* How many words each of us has, per round — the number everyone actually
   compares ("Sandra got 19 and I got 11"), live and afterwards. */
function wcSelf(){ const o = {}; for (const r in G.finsSelf) o[r] = G.finsSelf[r].w; if (G.playing) o[G.round] = G.found.size; return o; }
function wordsOf(p, round){
  const f = p.me ? G.finsSelf[round] : p.fin && p.fin[round];
  if (f) return f.w || 0;
  if (p.me) return G.found.size;
  return (p.wc && p.wc[round]) || 0;
}
function scSelf(){ const o = {}; for (const r in G.finsSelf) o[r] = G.finsSelf[r].s; if (G.playing) o[G.round] = G.score; return o; }
function colorOf(id){
  const idx = activePlayers().findIndex(([pid]) => pid === id);
  return COLORS[(idx >= 0 ? idx : 0) % COLORS.length];
}
/* A phone that goes quiet for a few seconds — screen lock, a notification, a
   cell handover, a backgrounded tab — is NOT gone. Migrating the crown on that
   silence is what let a second phone appoint itself host mid-game and then
   broadcast a round change that reset everyone. The crown only moves after a
   long, confirmed silence. */
const HOST_SILENCE_MS = 30000;
function stillWithUs(id, p){
  if (!p.gone) return true;
  return Date.now() - (p.seen || 0) < HOST_SILENCE_MS;   // recently gone = give them a moment
}
function electHost(){
  // Include anyone who has only just fallen quiet, so a blip can't crown anyone.
  const act = everyone().filter(([id,p]) => stillWithUs(id, p));
  if (!act.length) return;
  // Whoever opened the room claims host, and everyone honours the claim. Phones
  // disagree about the wall clock, so joinedAt must never decide this: if the
  // host leaves (or a split brain leaves two claiming it), fall back to the
  // lowest peer id, which every phone computes the same way.
  const claimers = act.filter(([, p]) => p.host);
  /* Nobody claiming it yet is normal for the first seconds after joining — the
     host's hello simply hasn't landed. Taking the crown on that silence made the
     lobby flap: the settings unlocked, then re-locked the instant the real host
     was heard, throwing away a pick made in between. Wait out a short grace
     period first; a genuinely host-less room still migrates, just a beat later. */
  // (Was also gated on act.length > 1, which meant the LAST phone standing skipped
  //  the anti-flap wait entirely — and, worse, that the crown was only ever
  //  re-evaluated when a message arrived, which for a lone survivor is never.)
  if (!claimers.length && !G.isHost && Date.now() - G.joinedAt < HOST_GRACE_MS) return;
  const pool = (claimers.length ? claimers : act);
  // prefer a phone we're actually hearing from over one that's merely not-yet-timed-out
  const live = pool.filter(([,p]) => !p.gone);
  const [hostId] = (live.length ? live : pool).map(([id]) => id).sort();
  const wasHost = G.isHost;
  G.isHost = hostId === Trystero.selfId;
  for (const [id,p] of G.peers) p.host = id === hostId;
  if (G.isHost !== wasHost){
    if (G.isHost) toast("You're the host now! 👑");
    renderSettings(); renderLobbyCtas(); renderStandingsCtas();
  }
}

/* ================================================================
   PARTY CHAT — one panel, moved between the lobby and the podium the same way
   the settings card is, so the conversation survives the trip from the results
   back to the lobby for the next game. Party mode only: there's nobody to talk
   to in solo or the daily.
   ================================================================ */
const CHAT_MAX = 60;
let chatUnread = 0;
/* The BAR travels between screens; the panel itself lives in a sheet. As a full
   panel parked at the bottom of the podium it sat below the fold — you had to
   already know it was there to find it. */
function mountChat(slotId){
  const bar = $('chat-bar');
  $(slotId).appendChild(bar);
  bar.hidden = G.mode !== 'party';
  renderChatBar();
}
function renderChatBar(){
  const last = G.chat[G.chat.length - 1];
  $('chat-bar-text').textContent = last
    ? (last.me ? 'You: ' : last.n + ': ') + last.t
    : 'Say something to the party!';
  $('chat-badge').hidden = !chatUnread;
  $('chat-badge').textContent = chatUnread > 9 ? '9+' : String(chatUnread);
}
function chatIsOpen(){ return !$('chat-modal').hidden; }
function openChat(){
  $('chat-sheet-slot').appendChild($('chat-panel'));
  chatUnread = 0; renderChatBar();
  $('chat-modal').hidden = false;
  renderChat();
  setTimeout(() => $('chat-input').focus(), 60);
}
function closeChat(){ $('chat-modal').hidden = true; renderChatBar(); }
$('chat-bar').addEventListener('click', openChat);
$('btn-chat-done').addEventListener('click', closeChat);
$('chat-modal').addEventListener('click', e => { if (e.target === $('chat-modal')) closeChat(); });
function addChat(m){
  if (!m || typeof m.t !== 'string') return;
  const text = m.t.trim().slice(0, 120);
  if (!text) return;
  G.chat.push({id: m.id, n: String(m.n || 'someone').slice(0, 14), e: m.e || '🙂', t: text, me: !!m.me});
  if (G.chat.length > CHAT_MAX) G.chat.splice(0, G.chat.length - CHAT_MAX);
  if (!m.me && !chatIsOpen()) chatUnread++;
  renderChat();
  renderChatBar();
  if (!m.me && !G.playing) snd.tick(5);
}
/* Append-only: rebuilding the whole log on every incoming message restarted the
   pop-in animation on every bubble already on screen, so the entire chat
   flashed each time anyone said anything. */
let chatDrawn = 0;
function chatBubble(m){
  const row = el('div','chat-msg' + (m.me ? ' me' : ''));
  const face = el('span','face', m.e);
  face.style.setProperty('--c', colorOf(m.id));
  const bub = el('div','chat-bubble');
  bub.appendChild(el('b','', m.me ? 'you' : m.n));
  bub.appendChild(el('span','', m.t));
  row.appendChild(face); row.appendChild(bub);
  return row;
}
function renderChat(){
  const log = $('chat-log');
  if (!log) return;
  if (!G.chat.length){
    log.replaceChildren(el('div','chat-empty','Say something to the party! 👋'));
    chatDrawn = 0;
    return;
  }
  // The log is append-only until it hits its cap and shifts; anything other than
  // "n new messages on the end" means start over.
  const drawn = log.querySelectorAll('.chat-msg').length;
  // …and clear the "say something" placeholder before the first real message,
  // or it sits above the conversation forever.
  if (!drawn || drawn !== chatDrawn || drawn > G.chat.length){
    log.replaceChildren();
    G.chat.forEach(m => log.appendChild(chatBubble(m)));
  } else {
    for (let i = drawn; i < G.chat.length; i++) log.appendChild(chatBubble(G.chat[i]));
  }
  chatDrawn = log.querySelectorAll('.chat-msg').length;
  log.scrollTop = log.scrollHeight;
}
function sendChat(){
  const input = $('chat-input');
  const text = input.value.trim().slice(0, 120);
  input.value = '';
  if (!text || G.mode !== 'party') return;
  addChat({id: Trystero.selfId, n: P.name, e: P.emoji, t: text, me: true});
  if (G.net) G.net.A.chat.send({t: text, n: P.name, e: P.emoji});
  input.focus();
}
$('chat-send').addEventListener('click', sendChat);
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });


/* ---------------- lobby ---------------- */
let pendingRoom = null, pendingIsRejoin = false;
/* Phones get killed: iOS reclaims a backgrounded tab, someone hits reload, a
   browser crashes. That used to end the party for that player — the app boots
   on the homepage with no idea where they were. Leave a breadcrumb instead. */
function rememberParty(){
  if (G.mode !== 'party' || !G.code) return;
  store.set('lastparty', {code: G.code, at: Date.now()});
}
function recentParty(){
  const p = store.get('lastparty', null);
  if (!p || !p.code) return null;
  return (Date.now() - (p.at || 0) < 20 * 60 * 1000) ? p.code : null;   // 20 min
}
function hostParty(){ connect(makeCode(), true); }
function joinParty(code){ connect(code, false); }

function openLobby(){
  rememberParty();
  renderRoomCode();
  moveSettingsTo('lobby-set-slot');
  renderSettings();
  renderLobbyPlayers();
  renderLobbyCtas();
  mountChat('lobby-chat-slot');
  show('lobby');
}
function renderRoomCode(){
  const wrap = $('room-code'); wrap.replaceChildren();
  for (const ch of (G.code||'????')) wrap.appendChild(el('span','',ch));
}
function inviteURL(){
  return location.origin + location.pathname + '?room=' + G.code;
}
$('btn-copy-code').addEventListener('click', () => copyText(G.code, 'Code copied!'));
$('btn-share-room').addEventListener('click', async () => {
  const url = inviteURL();
  const text = `Join our Boggleflix Party! Code: ${G.code}`;
  try {
    if (navigator.share){ await navigator.share({title:'Boggleflix Party', text, url}); return; }
  } catch(e){ if (e && e.name === 'AbortError') return; }
  copyText(text + '\n' + url, 'Invite link copied!');
});
async function copyText(text, msg){
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch(e){
    try {
      const ta = document.createElement('textarea'); ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta);
      ta.select(); ok = document.execCommand('copy'); ta.remove();
    } catch(e2){}
  }
  toast(ok ? msg : 'Could not copy — code: ' + G.code, 2600);
}
/* Stop everything the round has running — timers, countdown, wake lock — so a
   round that is abandoned mid-flight can't fire roundOver() from under us. */
function stopRound(){
  G.playing = false;
  Music.stop();
  cancelAnimationFrame(G.raf);
  (G.cdTimers || []).forEach(clearTimeout);
  G.cdTimers = [];
  clearTimeout(G.finTimer);
  clearInterval(G.specTimer); G.specTimer = 0;
  G.activePointer = null; G.path = [];
  releaseWake();
  hideOverlay();
}
function quitToHome(){
  stopRound();
  clearReveal();
  clearSel();
  leaveNet();
  G.mode = null; G.code = null; G.seeds = []; G.round = 0;
  G.gameId = null; G.beganKey = null; G.startAt = 0;
  G.peers = new Map(); G.finsSelf = {};
  refreshHome();
  show('home');
}
$('btn-lobby-leave').addEventListener('click', quitToHome);

/* Rebuilding the avatars restarts their pop-in animation AND their idle bob,
   and this runs on every network message plus every gossip tick — so the lobby
   flashed every three seconds, right under the fingers of whoever was trying to
   pick the settings. Only touch the DOM when the roster actually changed. */
let lobbySig = null;
function renderLobbyPlayers(){
  if (G.mode !== 'party') return;
  const act = everyone().filter(([,p]) => !p.gone);
  const sig = act.map(([id,p]) =>
    id + '~' + p.name + '~' + p.emoji + '~' + ((p.me ? G.isHost : p.host) ? 'h' : '')).join('|');
  if (sig !== lobbySig){
    lobbySig = sig;
    const wrap = $('lobby-players'); wrap.replaceChildren();
    for (const [id, p] of act){
      const blob = el('div','pl-blob');
      const face = el('span','face', p.emoji); face.style.setProperty('--c', colorOf(id));
      blob.appendChild(face);
      blob.appendChild(el('b','', p.me ? p.name + ' (you)' : p.name));
      const isHost = p.me ? G.isHost : p.host;
      if (isHost) blob.appendChild(el('span','tag','HOST'));
      wrap.appendChild(blob);
    }
  }
  const count = activePlayers().length;
  let status;
  if (count > 1) status = count + ' players in — waiting for the host to start!';
  else if (G.isHost) status = 'Waiting for players — share the code! (You can also start solo.)';
  // A joiner alone in a room can't tell "still connecting" from "typo'd the
  // code" — the room exists either way. Say what's happening, then nudge.
  else status = Date.now() - G.joinedAt > 15000
    ? "Can't find the party — double-check the code with the host!"
    : 'Joining… hang tight while the phones find each other';
  $('lobby-status').textContent = status;
  renderLobbyCtas(); // the Start button's label counts players too
}
/* One settings card serves both places: it sits in the modal (home taps ⚙️) and
   is lifted into the lobby whenever that screen opens, so the host's controls
   and the home readout can never drift out of sync. */
function moveSettingsTo(slotId){ $(slotId).appendChild($('settings-card')); }
function cfgSummary(){
  const t = G.cfg.t >= 60 ? (G.cfg.t/60) + ' min' : G.cfg.t + 's';
  return G.cfg.g + '×' + G.cfg.g + ' · ' + t + ' · ' + G.cfg.r + ' round' + (G.cfg.r === 1 ? '' : 's') +
    ' · ' + G.cfg.m + '+ letters';
}
function openSettings(){
  moveSettingsTo('settings-slot');
  renderSettings();
  $('settings-modal').hidden = false;
  snd.tick(2);
}
function closeSettings(){ $('settings-modal').hidden = true; refreshHome(); }
$('btn-home-settings').addEventListener('click', openSettings);
$('btn-settings-done').addEventListener('click', closeSettings);
$('settings-modal').addEventListener('click', e => { if (e.target === $('settings-modal')) closeSettings(); });
const SEGS = [['seg-grid','g'],['seg-timer','t'],['seg-min','m'],['seg-rounds','r']];
function renderSettings(){
  for (const [segId, key] of SEGS){
    const seg = $(segId);
    seg.classList.toggle('locked', G.mode === 'party' && !G.isHost);
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.v === G.cfg[key]));
  }
  $('settings-owner').textContent = G.mode !== 'party'
    ? 'for your parties & solo games'
    : (G.isHost ? "you're the host — you decide!" : 'the host picks these');
  $('home-set-sum').textContent = cfgSummary();
  // A 4×4 board frequently holds no 6-letter word at all — roughly one board in
  // four is unwinnable, which is a miserable round to sit through.
  const thin = G.cfg.g === 4 && G.cfg.m === 6;
  $('set-warn').hidden = !thin;
  if (thin) $('set-warn').textContent = '⚠️ 4×4 boards often have no 6-letter words at all — try 5×5 or 6×6 for this one.';
}
SEGS.forEach(([segId, key]) => {
  $(segId).querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    if (G.mode === 'party' && !G.isHost) return;
    G.cfg[key] = +b.dataset.v;
    // Picking a grid resets the word minimum to that board's real Boggle rule
    // (3 letters on 4×4, 4 on the big boards) — still overridable after.
    if (key === 'g') G.cfg.m = G.cfg.g === 4 ? 3 : 4;
    store.set('cfg', G.cfg);
    renderSettings();
    snd.tick(1);
    if (G.net && G.isHost) G.net.A.cfg.send(G.cfg);
  }));
});
function renderLobbyCtas(){
  $('btn-start').hidden = !(G.mode !== 'party' || G.isHost);
  $('btn-start').textContent = activePlayers().length > 1 ? 'Start the game!' : 'Start (waiting is boring)';
}
$('btn-start').addEventListener('click', () => {
  if (G.mode === 'party' && !G.isHost) return;
  hostStartGame();
});

/* ================================================================
   GAME FLOW
   ================================================================ */
function startPayload(){
  return {gid: G.gameId, seeds: G.seeds, cfg: G.cfg, round: G.round, startAt: G.startAt, hostNow: Date.now()};
}
function hostStartGame(){
  const rnd = Math.random().toString(36).slice(2,8);
  G.gameId = rnd;
  G.seeds = [];
  for (let i=0;i<G.cfg.r;i++) G.seeds.push('bfp-' + G.code + '-' + rnd + '-' + i);
  G.round = 0;
  G.startAt = Date.now() + 4200;
  for (const [,p] of G.peers){ p.sc = {}; p.fin = {}; }
  G.finsSelf = {};
  if (G.net) G.net.A.start.send(startPayload());
  beginRound();
}
function handleStart(d){
  /* The host re-broadcasts this every few seconds so a phone that missed the
     one-shot start (backgrounded, a dropped packet, joined a moment late) still
     gets pulled into the round. Ignore a repeat of a round we're already in, or
     it would restart the board and wipe the words we've found. */
  const gid = d.gid || null;
  const key = (gid || '?') + ':' + (d.round || 0);
  if (key === G.beganKey) return;
  // A start for some OTHER game while this phone is mid-round would wipe the
  // words it has found. Hold it until the round is over — see routeAfterRound.
  if (G.playing){ G.pendingStart = d; return; }
  const hadGame = G.gameId;
  const newGame = gid !== G.gameId;
  if (!newGame && (d.round || 0) < G.round) return;   // never go backwards inside a game
  G.gameId = gid || G.gameId;
  G.seeds = d.seeds || G.seeds;        // a start without seeds must never blank the list
  G.cfg = sanitizeCfg(d.cfg || {});
  G.round = d.round || 0;
  G.clockOffset = (d.hostNow || Date.now()) - Date.now();
  G.startAt = (d.startAt || Date.now()) - G.clockOffset;
  /* ONLY a genuinely new game clears history. This used to run on every start
     whose key differed — so missing one "next round" and being rescued by the
     host's re-broadcast silently erased every earlier round you had played, and
     nothing on the network could give it back (sync ignores your own id). Your
     phone then showed a lower total than everyone else's for the rest of the
     game. hadGame guards a rejoin, which has nothing to wipe. */
  if (newGame && hadGame){
    G.finsSelf = {};
    for (const [,p] of G.peers){ p.sc = {}; p.fin = {}; }
  }
  // Reclaim our own reports if this phone was reloaded mid-game (see roundOver).
  const saved = store.get('myfins', null);
  if (saved && saved.gid === G.gameId && !Object.keys(G.finsSelf).length) G.finsSelf = saved.fins || {};
  beginRound();
}
function hostNextRound(){
  G.round++;
  G.startAt = Date.now() + 4200;
  if (G.net) G.net.A.nxt.send({round: G.round, startAt: G.startAt, hostNow: Date.now()});
  beginRound();
}
function handleNext(d){
  /* This used to begin the round unconditionally, which meant ANY stray "next
     round" — a repeat, one from a phone that briefly self-appointed as host
     while the real host's phone was silent, or one that lands while a slower
     phone is still playing — restarted the board and wiped every word that
     player had found. It looked exactly like being booted mid-game. Only ever
     move FORWARD, and never out of a round that is still being played. */
  const round = d.round | 0;
  const key = (G.gameId || '?') + ':' + round;
  if (key === G.beganKey) return;         // already in it
  if (round < G.round) return;            // never go backwards
  if (G.playing && round <= G.round) return;
  if (G.playing){ G.pendingNext = d; return; }   // finish this round first
  G.round = round;
  G.clockOffset = (d.hostNow || Date.now()) - Date.now();
  G.startAt = (d.startAt || Date.now()) - G.clockOffset;
  beginRound();
}
function resetToLobby(){
  clearReveal();
  podiumSig = null;
  G.seeds = []; G.round = 0; G.finsSelf = {};
  for (const [,p] of G.peers){ p.sc = {}; p.fin = {}; }
  G.playing = false;
  openLobby();
}
$('btn-again').addEventListener('click', () => {
  if (G.mode === 'party'){
    if (!G.isHost) return;
    G.net && G.net.A.again.send({t:1});
    resetToLobby();
  } else startLocal(G.mode);
});
$('btn-stand-again').addEventListener('click', () => startLocal(G.mode));
$('btn-podium-home').addEventListener('click', quitToHome);
$('btn-stand-home').addEventListener('click', quitToHome);

/* ---------------- local modes ---------------- */
function startLocal(mode){
  leaveNet();
  G.mode = mode; G.code = null; G.isHost = true; G.peers = new Map(); G.finsSelf = {};
  if (mode === 'daily'){
    /* The daily used to ignore the settings entirely, so picking 5×5 still
       dealt a 4×4 — the settings simply didn't apply here. They do now, and the
       board stays shared by keying the seed to the DATE AND THE SIZE: everyone
       playing today on the same grid gets the same tray, which is what makes
       comparing scores mean anything. One round, always. */
    G.cfg = sanitizeCfg(store.get('cfg', {g:4, t:180, m:3, r:1}));
    G.cfg.r = 1;
    G.seeds = [dailySeed(G.cfg.g)];
  } else {
    G.cfg = sanitizeCfg(store.get('cfg', {g:4, t:180, m:3, r:1}));
    G.cfg.r = 1;
    G.seeds = ['bfp-solo-' + Date.now() + '-' + Math.random()];
  }
  G.round = 0;
  G.startAt = Date.now() + 4200;
  beginRound();
}

/* ---------------- round engine ---------------- */
let tileEls = [];
const boardEl = $('board'), pathSvg = $('path-svg'), pill = $('word-pill');
function beginRound(){
  /* No seed for this round means we don't have this game yet (a rejoin, a start
     we missed). Stop here — running on would stamp G.beganKey and then throw in
     genBoard(undefined), which poisons the key so every later start broadcast is
     discarded too, stranding the phone in the lobby permanently. */
  const seed = G.seeds[G.round];
  if (!seed){ G.playing = false; return; }
  ensureDict();
  rememberParty();   // a phone killed mid-round can find its way back
  clearReveal();
  $('scr-game').classList.remove('final-countdown');  // clear any leftover pulse
  G.beganKey = (G.gameId || '?') + ':' + G.round;  // ignore host's re-broadcasts of this round
  G.spectating = G.mode === 'party' && Date.now() > G.startAt + 3000;
  G.n = G.cfg.g;
  G.adj = adjacency(G.n);
  G.board = genBoard(seed, G.n, G.cfg.m);
  G.path = []; G.found = new Map(); G.score = 0; G.possible = null;
  G.playing = false;
  G.warned = false;
  G.totalMs = DEV ? 25000 : G.cfg.t * 1000;

  renderBoard();
  $('my-score').hidden = G.mode === 'party';   // the rail shows yours in a party
  $('round-pill').textContent = 'R' + (G.round+1) + '/' + G.cfg.r;
  $('my-score').textContent = '0';   // words, not points — see the HUD
  $('found-row').replaceChildren($('found-empty')); $('found-empty').style.display = '';
  $('found-empty').textContent = 'swipe the letters to spell a word!';
  $('found-count').textContent = '0 WORDS';
  $('btn-finish').hidden = G.mode === 'party';
  idleBanner();
  $('timer-fill').style.width = '100%'; $('timer-fill').className = 'timer-fill';
  $('timer-num').textContent = fmtTime(G.totalMs);
  renderRivals();
  show('game');
  fitTiles(); // now the board has a size, so the letters can be scaled to it
  requestWake();
  if (!G.spectating) Music.start(); // the song belongs to the round only
  // One game = one seed set, so count it once — on round 1, and only if
  // actually playing (a mid-round joiner spectates this round).


  // background solve for results
  setTimeout(() => { if (!G.possible) G.possible = solveBoard(G.board, G.n, G.cfg.m); }, 1200);   // common words — see solveBoard

  if (G.spectating){
    overlay('👀', 'Round in progress — you join the next one!', 'word');
    setTimeout(hideOverlay, 2200);
    /* Say so, and keep the clock moving. A full board with a frozen 100% timer
       and "swipe the letters to spell a word!" underneath is indistinguishable
       from an app that has hung — which is exactly what it looked like. */
    pill.className = 'word-pill'; pill.textContent = 'Watching — you play the next round';
    $('found-empty').textContent = 'Watching this round';
    clearInterval(G.specTimer);
    G.specTimer = setInterval(() => {
      if (!G.seeds.length){ clearInterval(G.specTimer); G.specTimer = 0; return; }
      const left = G.startAt + G.totalMs - Date.now();
      const pct = Math.max(0, left / G.totalMs);
      $('timer-fill').style.width = (pct*100) + '%';
      $('timer-fill').className = 'timer-fill' + (pct < .2 ? ' low' : pct < .5 ? ' mid' : '');
      $('timer-num').textContent = fmtTime(Math.max(0, left));
      if (left <= 0){ clearInterval(G.specTimer); G.specTimer = 0; roundOver(true); }
    }, 500);
    return;
  }
  runCountdown();
}
function runCountdown(){
  const stepAt = ms => Math.max(0, ms);
  const seq = [];
  const lead = G.startAt - Date.now();
  overlay(G.round === 0 ? 'READY?' : 'ROUND ' + (G.round+1), modeLine(), 'word');
  const t3 = setTimeout(() => { overlay('3'); snd.beep(); }, stepAt(lead - 3000));
  const t2 = setTimeout(() => { overlay('2'); snd.beep(); }, stepAt(lead - 2000));
  const t1 = setTimeout(() => { overlay('1'); snd.beep(); }, stepAt(lead - 1000));
  const t0 = setTimeout(() => {
    overlay('SPELL!', '', 'word'); snd.go(); buzz(30);
    setTimeout(hideOverlay, 450);
    G.playing = true;
    G.endAt = G.startAt + G.totalMs;
    tickTimer();
  }, stepAt(lead));
  // backstop: rAF freezes in background tabs — make sure the round still ends
  const tEnd = setTimeout(() => {
    if (G.playing && Date.now() >= G.endAt - 100) roundOver(false);
  }, stepAt(lead) + G.totalMs + 600);
  G.cdTimers = [t3,t2,t1,t0,tEnd];
}
function modeLine(){
  return G.cfg.g + '×' + G.cfg.g + ' board · ' + (G.cfg.t >= 60 ? (G.cfg.t/60) + ' min' : G.cfg.t + 's') +
    (G.cfg.m > 3 ? ' · words ≥ ' + G.cfg.m + ' letters' : '');
}
function renderBoard(){
  boardEl.querySelectorAll('.tile').forEach(t => t.remove());
  boardEl.style.gridTemplateColumns = 'repeat(' + G.n + ',1fr)';
  tileEls = G.board.map((L) => {
    const d = el('div','tile');
    const label = L.length > 1 ? L[0] + L.slice(1).toLowerCase() : L;
    d.appendChild(el('span','',label));
    boardEl.appendChild(d);
    return d;
  });
  requestAnimationFrame(fitTiles);
}
/* The tray's proportions are measured off Netflix's board: the channel between
   two dice is 12% of a die, and a die's corner radius is 23% of it. Those are
   ratios, not pixels, so they're solved here from the board's real width rather
   than guessed with clamp() — which drifted at 5×5/6×6 and on wider phones.
   gap = .12 * die  with  W = n*die + (n-1)*gap  →  the expression below. */
function fitTiles(){
  const W = boardEl.getBoundingClientRect().width;
  if (!W) return; // board isn't laid out yet — beginRound sizes it once shown
  const gap = Math.max(3, Math.round(W * .12 / (1.12 * G.n - .12)));
  const size = (W - gap * (G.n - 1)) / G.n;
  boardEl.style.setProperty('--gap', gap + 'px');
  boardEl.style.setProperty('--tilerad', Math.round(size * .23) + 'px');
  // Scale the letter to the tile itself, not to the tile-plus-gap.
  boardEl.style.setProperty('--tilefs', Math.floor(size * (G.n === 6 ? .48 : .52)) + 'px');
  drawPath();
}
window.addEventListener('resize', () => { if (tileEls.length) fitTiles(); });

function tickTimer(){
  if (!G.playing) return;
  const left = G.endAt - Date.now();
  const pct = Math.max(0, left / G.totalMs);
  $('timer-fill').style.width = (pct*100) + '%';
  $('timer-fill').className = 'timer-fill' + (pct < .2 ? ' low' : pct < .5 ? ' mid' : '');
  $('timer-num').textContent = fmtTime(left);
  // One-time heads-up as the clock crosses 10 seconds (skip if the round is
  // barely longer than that to begin with).
  if (!G.warned && left <= 10000 && G.totalMs > 12000){
    G.warned = true;
    snd.warn(); buzz([40,60,40]);
    $('timer-wrap').classList.remove('warn'); void $('timer-wrap').offsetWidth; $('timer-wrap').classList.add('warn');
  }
  // Whole-screen urgency pulse for the final stretch (only worthwhile on rounds
  // long enough to have one). Cleared when the round ends / a new one begins.
  if (G.totalMs > 12000) $('scr-game').classList.toggle('final-countdown', left <= 10000);
  if (left <= 0){ roundOver(false); return; }
  G.raf = requestAnimationFrame(tickTimer);
}

/* input */
/* The board is a grid with gaps between the tiles, so width/n is not the tile
   pitch — assuming it drifted the hit zones a couple of px off the squares you
   can actually see, and the old radius only covered the middle of each tile.
   Measure the real geometry instead and let the whole tile respond. */
function geom(){
  const r = boardEl.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(boardEl).columnGap) || 0;
  // An unmeasured board (width 0, e.g. its screen is still hidden) would make
  // this negative, so clamp: callers treat 0 as "not laid out yet".
  const size = Math.max(0, (r.width - gap * (G.n - 1)) / G.n);
  return {r, gap, size, pitch: size + gap};
}
function cellCentre(i, g){
  return {x: (i % G.n) * g.pitch + g.size/2, y: Math.floor(i / G.n) * g.pitch + g.size/2};
}
function cellFromPoint(x, y, starting){
  const g = geom();
  if (!g.size) return -1;
  // Snap to the nearest tile, then only reject points that are genuinely off it.
  const c = Math.round((x - g.r.left - g.size/2) / g.pitch);
  const row = Math.round((y - g.r.top - g.size/2) / g.pitch);
  if (c < 0 || c >= G.n || row < 0 || row >= G.n) return -1;
  const cx = g.r.left + c * g.pitch + g.size/2;
  const cy = g.r.top + row * g.pitch + g.size/2;
  if (Math.hypot(x - cx, y - cy) > g.size * (starting ? .72 : .58)) return -1;
  return row * G.n + c;
}
/* Where a word actually is on the tray. The reveal shows each word lit up in
   place, the way Boggle Party does, so you can see where you missed it — that
   needs the path back, which we don't keep (nobody else's, anyway). It's a DFS
   over the same adjacency the game traces with, and only ever run on a handful
   of words at reveal time. */
function wordPath(word, board, n, adj){
  const B = board || G.board, N = n || G.n, A = adj || G.adj;
  const W = String(word || '').toUpperCase();
  if (!B || !B.length) return null;
  const used = new Array(B.length).fill(false);
  const walk = (i, pos) => {
    const cell = B[i];
    if (W.slice(pos, pos + cell.length) !== cell) return null;
    pos += cell.length;
    used[i] = true;
    if (pos >= W.length){ used[i] = false; return [i]; }
    for (const j of A[i]){
      if (used[j]) continue;
      const rest = walk(j, pos);
      if (rest){ used[i] = false; return [i].concat(rest); }
    }
    used[i] = false;
    return null;
  };
  for (let i = 0; i < B.length; i++){ const p = walk(i, 0); if (p) return p; }
  return null;
}
function wordFromPath(){ return G.path.map(i => G.board[i]).join(''); }
const SVG_NS = 'http://www.w3.org/2000/svg';
function drawPath(){
  const g = geom();
  pathSvg.setAttribute('viewBox', '0 0 ' + g.r.width + ' ' + g.r.height);
  pathSvg.classList.toggle('ok', G.selOk);
  pathSvg.replaceChildren();
  if (!G.path.length) return;
  const pts = G.path.map(i => { const c = cellCentre(i, g); return c.x + ',' + c.y; }).join(' ');
  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', pts);
  line.setAttribute('fill','none');
  line.setAttribute('stroke', G.selOk ? '#0E9E55' : '#FF2E63');  // green once it spells a real word
  line.setAttribute('stroke-width', g.size*.17);
  line.setAttribute('stroke-linecap','round');
  line.setAttribute('stroke-linejoin','round');
  pathSvg.appendChild(line);
}
function clearSel(){
  G.selOk = false;
  tileEls.forEach(t => t.classList.remove('sel','ok'));
  drawPath();
}
function setSel(){
  // Decide whether the trace already spells something BEFORE painting, so the
  // dice and the line turn green together the instant it does.
  const w = wordFromPath(), lw = w.toLowerCase();
  const isValid = !!w && lw.length >= G.cfg.m && DICT.has(lw) && !G.found.has(lw);
  G.selOk = isValid;
  tileEls.forEach((t,i) => {
    const on = G.path.includes(i);
    t.classList.toggle('sel', on);
    t.classList.toggle('ok', on && isValid);
  });
  drawPath();
  if (!w){ idleBanner(); return; }
  pill.replaceChildren(document.createTextNode(w));
  pill.className = 'word-pill building' + (isValid ? ' valid' : '');
}
function addToPath(i){
  G.path.push(i);
  snd.tick(G.path.length); buzz(8);
  setSel();
}
let lastPt = null; // last pointer sample, so we can fill in the gaps between them
boardEl.addEventListener('pointerdown', e => {
  if (!G.playing || G.activePointer !== null) return;
  e.preventDefault();
  const i = cellFromPoint(e.clientX, e.clientY, true);
  if (i < 0) return;
  G.activePointer = e.pointerId;
  try { boardEl.setPointerCapture(e.pointerId); } catch(err){}
  lastPt = {x: e.clientX, y: e.clientY};
  G.path = []; addToPath(i);
});
/* Track and end the stroke on the window rather than the board. A finger that
   lifts past the edge of the tray — or a pointer capture the browser quietly
   drops — never delivers pointerup to the board itself, which used to leave
   activePointer set forever and silently swallow every word after the first. */
function feedPoint(x, y){
  const i = cellFromPoint(x, y, false);
  if (i < 0) return;
  const last = G.path[G.path.length-1];
  if (i === last) return;
  if (G.path.length > 1 && i === G.path[G.path.length-2]){ G.path.pop(); setSel(); return; }
  if (!G.path.includes(i) && G.adj[last].includes(i)) addToPath(i);
}
window.addEventListener('pointermove', e => {
  if (!G.playing || e.pointerId !== G.activePointer || !G.path.length) return;
  e.preventDefault();
  // Take every sample the browser captured, and walk the line between them: a
  // quick flick otherwise lands either side of a tile and the letter is dropped.
  const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
  const samples = coalesced && coalesced.length ? coalesced : [e];
  for (const s of samples){
    const x = s.clientX, y = s.clientY;
    if (lastPt){
      const dx = x - lastPt.x, dy = y - lastPt.y;
      const steps = Math.min(24, Math.max(1, Math.round(Math.hypot(dx, dy) / 6)));
      for (let k = 1; k <= steps; k++) feedPoint(lastPt.x + dx*k/steps, lastPt.y + dy*k/steps);
    } else feedPoint(x, y);
    lastPt = {x, y};
  }
}, {passive: false});
function endStroke(e){
  if (e.pointerId !== G.activePointer) return;
  G.activePointer = null;
  lastPt = null;
  if (!G.playing){ G.path = []; clearSel(); return; }
  submitPath();
}
window.addEventListener('pointerup', endStroke);
window.addEventListener('pointercancel', endStroke);
boardEl.addEventListener('contextmenu', e => e.preventDefault());

function submitPath(){
  if (!G.playing) { clearSel(); return; }   // the buzzer has gone
  const w = wordFromPath(), lw = w.toLowerCase(), tiles = G.path.slice();
  G.path = [];
  if (lw.length < G.cfg.m){
    // setSel() repaints the pill from the (now empty) path in the same tick, so
    // the message never survived — on a 5×5 the word just silently vanished.
    if (lw.length >= 3){ flashPill('bad', w + ' — too short!'); snd.bad(); clearSel(); }
    else setSel();
    return;
  }
  if (G.found.has(lw)){ flashPill('dupe', w); snd.dupe(); clearSel(); return; }
  if (!DICT.has(lw)){
    flashPill('bad', w); snd.bad(); buzz([18,40,18]);
    boardEl.classList.remove('shake'); void boardEl.offsetWidth; boardEl.classList.add('shake');
    clearSel(); return;
  }
  const pts = scoreFor(lw);
  G.found.set(lw, pts); G.score += pts;
  $('my-score').textContent = G.found.size;
  $('my-score').classList.remove('bump'); void $('my-score').offsetWidth; $('my-score').classList.add('bump');
  flashPill('good', w + '  +' + pts);
  snd.good(); buzz(24);
  tiles.forEach(i => { tileEls[i].classList.add('flash-good'); setTimeout(() => tileEls[i].classList.remove('flash-good'), 380); });
  $('found-empty').style.display = 'none';
  /* The word only ever appears in two places: the pill ABOVE the board while
     you are tracing it, and the row BELOW once it counts. It used to also pop
     up over the dice themselves, which covered the letters you were trying to
     read. */
  const chip = el('span','fchip landed', w); chip.appendChild(el('b','','+'+pts));
  $('found-row').prepend(chip);
  setTimeout(() => chip.classList.remove('landed'), 700);
  $('found-count').textContent = G.found.size + (G.found.size === 1 ? ' WORD' : ' WORDS');
  clearSel();
  if (G.net) G.net.A.sc.send({r: G.round, s: G.score, w: G.found.size, gid: G.gameId});
  renderRivals();
}
/* Idle, the banner states the rule — the real game's "Minimum 5 characters!"
   with its little pink badge — so the space above the board is never dead. */
function idleBanner(){
  pill.className = 'word-pill hint';
  pill.replaceChildren(el('span','minbadge', String(G.cfg.m)),
                       document.createTextNode('Minimum ' + G.cfg.m + ' letters!'));
}
function flashPill(cls, text){
  pill.replaceChildren(document.createTextNode(text));
  pill.className = 'word-pill ' + cls;
  clearTimeout(flashPill.t);
  flashPill.t = setTimeout(() => { if (!G.path.length) idleBanner(); }, 900);
}
$('btn-finish').addEventListener('click', () => { if (G.playing && G.mode !== 'party') roundOver(false); });
window.__end = () => G.playing && roundOver(false);

/* leave a game in progress */
function closeExitConfirm(){ $('confirm-exit').hidden = true; }
$('btn-game-exit').addEventListener('click', () => {
  $('confirm-exit-sub').textContent = G.mode === 'party'
    ? "You'll go back to the menu — the others keep playing."
    : "You'll go back to the menu. This round won't be saved.";
  $('confirm-exit').hidden = false;
});
$('btn-exit-stay').addEventListener('click', closeExitConfirm);
$('btn-exit-go').addEventListener('click', () => { closeExitConfirm(); quitToHome(); });
$('confirm-exit').addEventListener('click', e => { if (e.target === $('confirm-exit')) closeExitConfirm(); });
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('confirm-exit').hidden) closeExitConfirm();
  else if (!$('chat-modal').hidden) closeChat();
  else if (!$('settings-modal').hidden) closeSettings();
});

/* live rivals rail */
/* The rivals rail updates on every score message and every 3s gossip tick — it
   used to tear down and rebuild every chip each time, so during a round the row
   jumped and the numbers flickered while you were mid-swipe. Now the chips are
   built once per roster change and only their numbers and their order change,
   with flex `order` doing the moving so it slides instead of teleporting. */
let rivalEls = new Map(), rivalSig = null;
function renderRivals(){
  const rail = $('rivals');
  if (G.mode !== 'party'){ rail.replaceChildren(); rivalEls = new Map(); rivalSig = null; return; }
  /* Mid-round the number that matters is HOW MANY WORDS, not points — that is
     what everyone shouts across the room. Points are for the results. */
  /* EVERYONE, you included — it is the same little scoreboard on every phone,
     so you and Scarlett both see both counts rather than only each other's. */
  const rows = everyone().map(([id,p]) => ({
    id, p, score: (p.me ? G.score : (p.sc && p.sc[G.round]) || 0), words: wordsOf(p, G.round)
  })).sort((a,b) => b.words - a.words || b.score - a.score);
  const sig = rows.map(r => r.id + (r.p.me?'*':'') + (r.p.gone?'!':'') + r.p.name + r.p.emoji).sort().join(',');
  if (sig !== rivalSig){                 // roster changed — rebuild the chips
    rivalSig = sig;
    rivalEls = new Map();
    rail.replaceChildren();
    rows.forEach(r => {
      // avatar, then who, then how many — read as a scoreboard row
      const d = el('div','rival' + (r.p.me ? ' me' : ''));
      const face = el('span','face', r.p.emoji); face.style.setProperty('--c', colorOf(r.id));
      d.appendChild(face);
      const nm = el('small','', r.p.me ? 'you' : r.p.name);
      d.appendChild(nm);
      const b = el('b','', String(r.words));
      d.appendChild(b);
      rail.appendChild(d);
      rivalEls.set(r.id, {d, b, nm, name: r.p.me ? 'you' : r.p.name});
    });
  }
  rows.forEach((r, i) => {
    const e = rivalEls.get(r.id);
    if (!e) return;
    e.d.style.order = i;
    e.d.classList.toggle('first', i === 0 && r.words > 0);
    e.d.classList.toggle('gone', !!r.p.gone);
    const txt = String(r.words);
    if (e.b.textContent !== txt){
      e.b.textContent = txt;
      // a small kick when someone's count moves, so you notice it happen
      e.b.classList.remove('kick'); void e.b.offsetWidth; e.b.classList.add('kick');
    }
    if (e.nm.textContent !== e.name) e.nm.textContent = e.name;
  });
}

/* ---------------- round over / standings ---------------- */
/* The platform drops a screen lock whenever the page hides, and this was only
   ever taken once at the start of a round — so one glance at a notification
   cost the lock for the rest of the round and the phone slept while its owner
   was still thinking about the board. */
let wantWake = false;
function requestWake(){
  wantWake = true;
  try {
    navigator.wakeLock && navigator.wakeLock.request('screen')
      .then(l => { if (wantWake) G.lock = l; else l.release().catch(()=>{}); })
      .catch(()=>{});
  } catch(e){}
}
function releaseWake(){ wantWake = false; try { if (G.lock){ G.lock.release(); G.lock = null; } } catch(e){} }
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && wantWake){ G.lock = null; requestWake(); }
});

function roundOver(wasSpectating){
  G.playing = false;
  G.finAt = Date.now();   // when this round's reports started arriving (see creditGame)
  $('scr-game').classList.remove('final-countdown');
  Music.stop(); // the song ends with the round — standings and podium are quiet
  cancelAnimationFrame(G.raf);
  (G.cdTimers||[]).forEach(clearTimeout);
  G.activePointer = null; G.path = []; clearSel();
  releaseWake();
  if (!wasSpectating){
    snd.up(); buzz([30,60,30]);
    overlay("TIME'S UP!", '', 'word');
  }
  if (!G.possible) G.possible = solveBoard(G.board, G.n, G.cfg.m);
  // my round summary
  let best = null;
  for (const [w,p] of G.found) if (!best || p > best[1] || (p === best[1] && w.length > best[0].length)) best = [w,p];
  const fin = {r: G.round, s: G.score, w: G.found.size, b: best ? best[0] : '', bp: best ? best[1] : 0, words: [...G.found.keys()]};
  if (!wasSpectating){
    G.finsSelf[G.round] = fin;
    if (G.mode === 'party' && G.gameId) store.set('myfins', {gid: G.gameId, fins: G.finsSelf});
    if (G.score > store.get('best',0)) store.set('best', G.score);
    creditRound(fin);
    if (G.mode === 'daily'){
      const k = dailyKey(G.cfg.g);
      if (G.score > (store.get(k, -1))) store.set(k, G.score);
    }
    if (G.net) G.net.A.fin.send({...fin, gid: G.gameId});
  }
  clearTimeout(G.finTimer);
  G.finTimer = setTimeout(() => { hideOverlay(); routeAfterRound(); }, wasSpectating ? 800 : 1400);
}
/* Every round ends the way Boggle does: the words are revealed one at a time,
   paying whoever found them (unique finds pay double), and then the podium goes
   up — mid-game it shows the running standings with a "next round" button, and
   after the last round it's the final result. */
function routeAfterRound(){
  podiumSig = null;   // a new round's podium always rebuilds
  if (G.mode !== 'party'){ renderLocalResults(); show('standings'); return; }
  /* Anything the round was protecting us from gets honoured now: the host may
     have moved on while this phone was still finishing. */
  if (G.pendingStart){ const d = G.pendingStart; G.pendingStart = null; G.pendingNext = null; G.pendingAgain = false; handleStart(d); return; }
  if (G.pendingNext){ const d = G.pendingNext; G.pendingNext = null; G.pendingAgain = false; handleNext(d); return; }
  if (G.pendingAgain){ G.pendingAgain = false; resetToLobby(); return; }
  const last = G.round >= G.cfg.r - 1;
  const cb = () => {
    renderPodium(); show('podium');
    confettiBurst();
    last ? snd.fanfare() : snd.up();
  };
  /* The show used to be staged from whatever had arrived 1.4s after the buzzer.
     A phone that reported late had its words presented as "NOBODY ELSE FOUND
     IT — DOUBLE!", and then the podium one screen later showed the corrected,
     lower total — the score visibly dropping straight after the family watched
     it counted up. Wait for the reports, but ONLY briefly: a mid-round joiner
     spectates and never reports at all, so "everyone is in" is not a condition
     that always comes true. */
  /* Bounded by the CLOCK, not by a count of ticks: a backgrounded phone has its
     timers throttled to about a second each, so counting ticks would have meant
     waiting ten real seconds there. Never more than 4s under any conditions. */
  let seen = roundReports(G.round).length;
  let deadline = Date.now() + 2500;
  const hardStop = Date.now() + 4000;
  (function waitForReports(){
    const n = roundReports(G.round).length;
    if (n > seen){ seen = n; deadline = Math.min(hardStop, Math.max(deadline, Date.now() + 600)); }
    if (n >= activePlayers().length || Date.now() >= deadline){ runReveal(cb); return; }
    revealTimers.push(setTimeout(waitForReports, 200));
  })();
}
function maybeFinishCollection(){ // a straggler's report arrived — refresh whichever results screen is up
  if (G.playing) return;
  if ($('scr-standings').classList.contains('active')) renderStandings();
  if ($('scr-podium').classList.contains('active')) renderPodium();
}

function roundReports(round){
  const out = [];
  for (const [id, p] of everyone()){
    const f = p.me ? G.finsSelf[round] : p.fin && p.fin[round];
    if (f && f.words) out.push({id, f});
  }
  return out;
}
/* Netflix Boggle Party's duplicate rule (this game's model): every valid word
   scores for every player who found it, and a word NOBODY else submitted
   scores DOUBLE — the unique-word bonus is the whole strategy. The bonus needs
   everyone's word list, so it only ever touches round-end totals, never the
   live in-round score (which stays provisional base points until the lists
   are compared). Every phone runs this over the same reported lists, so it
   lands on the same number everywhere without a scorekeeper, and it updates
   as stragglers report in, same as every other "pending" stat. With nobody to
   compare against (solo, or alone in a party room), there is no bonus — every
   word pays plain base points. `best` is the player's top-scoring word,
   bonus included. */
function roundBreakdown(f, reports){
  if (reports.length < 2){
    return {score: f.s, unique: 0, vs: false, best: f.b ? {w: f.b, p: f.bp} : null};
  }
  const counts = new Map();
  for (const r of reports) for (const w of r.f.words) counts.set(w, (counts.get(w)||0) + 1);
  let score = 0, unique = 0, best = null;
  for (const w of f.words){
    const solo = counts.get(w) === 1;
    if (solo) unique++;
    const p = scoreFor(w) * (solo ? 2 : 1);
    score += p;
    if (!best || p > best.p || (p === best.p && w.length > best.w.length)) best = {w, p};
  }
  return {score, unique, vs: true, best};
}
function roundScore(f, round){ return f.words ? roundBreakdown(f, roundReports(round)).score : f.s; }
// What this player scored in one round: their reported list if it arrived, else
// the last live score we heard gossiped for them.
function roundScoreOf(p, round){
  const f = p.me ? G.finsSelf[round] : p.fin && p.fin[round];
  if (f) return roundScore(f, round);
  return (p.sc && p.sc[round]) || 0;
}
// `upTo` (exclusive) totals only the rounds before it — the running total a
// player carried INTO that round, which is where the reveal's bubbles start.
function totalsFor(id, p, upTo){
  let total = 0;
  const rounds = upTo === undefined ? G.cfg.r : upTo;
  for (let r=0;r<rounds;r++) total += roundScoreOf(p, r);
  return total;
}
function renderStandings(){
  if (G.mode !== 'party') return;
  $('stand-title').textContent = 'Round ' + (G.round+1) + ' results';
  $('local-extras').hidden = true;
  $('btn-share-daily').hidden = true;
  $('btn-stand-again').hidden = true;
  const reports = roundReports(G.round);
  const rows = everyone().map(([id,p]) => {
    const f = p.me ? G.finsSelf[G.round] : p.fin && p.fin[G.round];
    const bd = f && f.words ? roundBreakdown(f, reports) : null;
    const score = bd ? bd.score : (f ? f.s : (p.sc && p.sc[G.round]) || 0);
    return {id, p, f, bd, score, total: totalsFor(id,p)};
  }).sort((a,b) => b.score - a.score);
  const list = $('stand-list'); list.replaceChildren();
  rows.forEach((r,i) => {
    const row = el('div','stand-row' + (i===0 && r.score>0 ? ' first' : '') + (r.p.me ? ' me' : '') + (!r.f && !r.p.gone && !r.p.me ? ' pending' : ''));
    row.appendChild(el('span','rank', ['🥇','🥈','🥉'][i] || (i+1)+''));
    const face = el('span','face', r.p.emoji); face.style.setProperty('--c', colorOf(r.id));
    row.appendChild(face);
    const info = el('div','info');
    info.appendChild(el('b','', r.p.me ? r.p.name + ' (you)' : r.p.name));
    let sub;
    if (!r.f) sub = r.p.gone ? 'left the party' : 'finishing…';
    else if (r.bd && r.bd.vs){
      // Head-to-head round: words nobody else found paid double.
      const wn = r.f.w === 1 ? '1 word' : r.f.w + ' words';
      sub = r.bd.best
        ? 'best: ' + r.bd.best.w.toUpperCase() + ' +' + r.bd.best.p + ' · ' +
          (r.bd.unique ? r.bd.unique + ' unique (×2!) of ' + wn : wn + ', none unique')
        : 'no words this round';
    }
    else sub = r.f.b ? 'best: ' + r.f.b.toUpperCase() + ' +' + r.f.bp + ' · ' + r.f.w + ' words' : r.f.w + ' words';
    info.appendChild(el('small','', sub));
    row.appendChild(info);
    const pts = el('span','pts', String(r.score));
    if (G.cfg.r > 1){ const sm = el('small','',' · total ' + r.total); pts.appendChild(sm); }
    row.appendChild(pts);
    list.appendChild(row);
  });
  const isLast = G.round >= G.cfg.r - 1;
  $('btn-next-round').hidden = !(G.isHost && !isLast);
  $('stand-wait').hidden = G.isHost || isLast;
  $('stand-sub').textContent = 'After round ' + (G.round+1) + ' of ' + G.cfg.r;
}
// Host migration mid-results: whichever results screen is up needs its buttons
// re-decided, since "next round" is the host's to press.
function renderStandingsCtas(){
  if ($('scr-standings').classList.contains('active')) renderStandings();
  if ($('scr-podium').classList.contains('active')) renderPodium();
}
$('btn-next-round').addEventListener('click', () => { if (G.isHost) hostNextRound(); });
$('btn-podium-next').addEventListener('click', () => { if (G.isHost) hostNextRound(); });

/* local (solo/daily) results reuse the standings screen */
function renderLocalResults(){
  creditGame(null);   // solo and daily count towards your record too
  /* Counted over the words people actually know — the old count was every
     ENABLE word on the tray, so "you found 1 of 84" was really "1 of 84,
     seventy of which nobody has ever seen". Your own finds always count, even
     if you knew something obscure. */
  const possible = new Set(G.possible || []);
  for (const w of G.found.keys()) possible.add(w);
  $('stand-title').textContent = G.mode === 'daily' ? '📅 Daily Puzzle — ' + prettyToday() : 'Your round';
  const nWords = G.found.size;
  $('stand-sub').textContent = 'You found ' + nWords + ' of ' + possible.size + ' possible words';
  const list = $('stand-list'); list.replaceChildren();
  const row = el('div','stand-row first');
  row.appendChild(el('span','rank','🎉'));
  const face = el('span','face', P.emoji); face.style.setProperty('--c', COLORS[0]);
  row.appendChild(face);
  const info = el('div','info');
  info.appendChild(el('b','', P.name));
  let best = null;
  for (const [w,p] of G.found) if (!best || p > best[1] || (p === best[1] && w.length > best[0].length)) best = [w,p];
  info.appendChild(el('small','', best ? 'best: ' + best[0].toUpperCase() + ' +' + best[1] : 'the sequel will be better!'));
  row.appendChild(info);
  row.appendChild(el('span','pts', String(G.score)));
  list.appendChild(row);
  // word bags
  $('local-extras').hidden = false;
  const mine = $('bag-mine'); mine.replaceChildren();
  const sorted = [...G.found.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
  if (!sorted.length) mine.appendChild(el('span','found-empty','none this time!'));
  for (const [w,p] of sorted){ const c = el('span','fchip', w.toUpperCase()); c.appendChild(el('b','','+'+p)); mine.appendChild(c); }
  const missedEl = $('bag-missed'); missedEl.replaceChildren();
  const missed = [...possible].filter(w => !G.found.has(w))
    .sort((a,b) => scoreFor(b)-scoreFor(a) || b.length-a.length || a.localeCompare(b)).slice(0, 24);
  for (const w of missed){ const c = el('span','fchip missed', w.toUpperCase()); c.appendChild(el('b','','+'+scoreFor(w))); missedEl.appendChild(c); }
  $('btn-next-round').hidden = true;
  $('stand-wait').hidden = true;
  $('btn-share-daily').hidden = G.mode !== 'daily';
  $('btn-stand-again').hidden = G.mode !== 'solo';
}
$('btn-share-daily').addEventListener('click', async () => {
  const text = '📅 Boggleflix Daily ' + prettyToday() + ' (' + G.cfg.g + '×' + G.cfg.g + ') — ' + G.score + ' pts, ' + G.found.size + ' words! Beat me: ' + location.origin + location.pathname;
  try { if (navigator.share){ await navigator.share({text}); return; } } catch(e){ if (e && e.name==='AbortError') return; }
  copyText(text, 'Score copied — paste it in the family chat!');
});

/* ---------------- podium ---------------- */
/* Every word anyone played in one round: who found it, and what it pays — base
   points to each finder, DOUBLE when the finder was alone on it (Boggle Party's
   unique-word bonus). Deterministic from the synced fin.words, so every phone
   stages the identical show. */
function buildRevealEntries(round){
  const reports = roundReports(round);
  if (!reports.length) return [];
  const multi = reports.length >= 2;
  const byWord = new Map();
  for (const rep of reports) for (const w of rep.f.words){
    if (!byWord.has(w)) byWord.set(w, []);
    byWord.get(w).push(rep.id);
  }
  const entries = [];
  for (const [w, finders] of byWord){
    const unique = multi && finders.length === 1;
    entries.push({w, r: round, finders, unique, pts: scoreFor(w) * (unique ? 2 : 1)});
  }
  return entries;
}
let revealTimers = [];
function clearReveal(){ revealTimers.forEach(clearTimeout); revealTimers = []; }
/* The round's scoring show, staged like Boggle Party's: every player becomes a
   bubble along the top carrying the total they walked in with, then THIS
   round's words take the centre stage ONE AT A TIME — shared words first,
   paying everyone who spotted them, then the unique finds with their ×2
   flourish — while the bubbles swell and trade places live. Runs after every
   round and hands off to the podium. */
function runReveal(done){
  clearReveal();
  const last = G.round >= G.cfg.r - 1;
  const rows = everyone().map(([id,p]) => ({id, p, total: totalsFor(id,p), before: totalsFor(id,p,G.round)}));
  const maxTotal = Math.max(1, ...rows.map(r => r.total));
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const at = (ms, fn) => revealTimers.push(setTimeout(fn, ms));

  // one bubble per player — these grow and reorder as the points land
  const wrap = $('reveal-bubbles'); wrap.replaceChildren();
  const bubbles = new Map();
  // Bubbles open on the standings so far, so a multi-round game visibly
  // continues from where the last round left it.
  const ranked = rows.slice().sort((a,b) => b.before - a.before);
  rows.forEach(r => {
    const b = el('div','rv-bub' + (r.p.me ? ' me' : ''));
    b.style.order = ranked.indexOf(r);
    const ring = el('div','ring');
    const face = el('span','face', r.p.emoji); face.style.setProperty('--c', colorOf(r.id));
    ring.appendChild(face);
    ring.appendChild(el('span','crown','👑'));
    b.appendChild(ring);
    b.appendChild(el('b','', r.p.me ? 'you' : r.p.name));
    b.appendChild(el('span','bub-words', wordsOf(r.p, G.round) + 'w'));
    const sc = el('span','bub-score', String(r.before));
    b.appendChild(sc);
    wrap.appendChild(b);
    const bub = {el: b, face, sc, score: r.before};
    bubbles.set(r.id, bub);
    bub.face.style.setProperty('--grow', (1 + .55 * Math.min(1, r.before / maxTotal)).toFixed(3));
    b.classList.toggle('lead', ranked[0] === r && r.before > 0);
  });
  const stage = $('reveal-stage'); stage.replaceChildren();
  const log = $('reveal-log'); log.replaceChildren();
  setPhase('📊 SCORES!', G.cfg.r > 1 ? 'Round ' + (G.round+1) + ' of ' + G.cfg.r : 'Adding up everyone’s words…');
  show('reveal');

  function setPhase(title, sub){
    const ph = $('reveal-phase');
    ph.textContent = title;
    ph.style.animation = 'none'; void ph.offsetWidth; ph.style.animation = '';
    $('reveal-sub').textContent = sub;
  }
  function award(id, pts){
    const b = bubbles.get(id); if (!b) return;
    b.score += pts;
    b.sc.textContent = String(b.score);
    // the bubble literally grows with the score — the winner ends up biggest
    b.face.style.setProperty('--grow', (1 + .55 * Math.min(1, b.score / maxTotal)).toFixed(3));
    b.sc.classList.remove('bump'); void b.sc.offsetWidth; b.sc.classList.add('bump');
    const fp = el('span','bub-pop','+' + pts);
    b.el.appendChild(fp);
    revealTimers.push(setTimeout(() => fp.remove(), 900));
  }
  function reorder(){
    const sorted = [...bubbles.values()].sort((a,b) => b.score - a.score);
    const before = new Map();
    if (!reduced) bubbles.forEach((b,id) => before.set(id, b.el.getBoundingClientRect()));
    let changed = false;
    sorted.forEach((b,i) => {
      if (+b.el.style.order !== i) changed = true;
      b.el.style.order = i;
      b.el.classList.toggle('lead', i === 0 && b.score > 0);
    });
    if (!changed || reduced || !wrap.animate) return;
    /* FLIP: play each bubble from where it was to where it now is. This runs as
       a Web Animation rather than an inline transform cleared on the next frame
       — a throttled rAF (phone locks, tab backgrounded) would never fire that
       cleanup and the bubble would stay stuck on top of its neighbour. An
       animation touches no inline style, so there is nothing to get stuck. */
    bubbles.forEach((b,id) => {
      const a = before.get(id), z = b.el.getBoundingClientRect();
      const dx = a.left - z.left, dy = a.top - z.top;
      if (!dx && !dy) return;
      b.el.animate(
        [{transform: 'translate(' + dx + 'px,' + dy + 'px)'}, {transform: 'none'}],
        {duration: 450, easing: 'cubic-bezier(.2,1.3,.4,1)'}
      );
    });
  }
  /* The word flies out of the bubble of whoever found it, so you can see at a
     glance whose word it was before you read a single name. A Web Animation,
     not an inline transform — a throttled rAF never fires the cleanup and the
     card would stay parked on top of someone's avatar. Replaces the card's own
     CSS pop, which would otherwise fight it for the transform. */
  function launchFromFinders(card, finders){
    // Light up everyone who found it, for as long as the word is on screen —
    // with several names lit at once, a shared word is obvious at a glance.
    stage.dataset.lit = finders.join(' ');
    finders.forEach(id => { const b = bubbles.get(id); if (b) b.el.classList.add('src'); });
    if (reduced || !card.animate) return;
    // The word JUMPS OUT of the people who found it: from the middle of their
    // avatars when several share it, straight out of the one when it's theirs.
    const pts = finders.map(id => bubbles.get(id)).filter(Boolean).map(b => b.face.getBoundingClientRect());
    if (!pts.length) return;
    const cx = pts.reduce((s,r) => s + r.left + r.width/2, 0) / pts.length;
    const cy = pts.reduce((s,r) => s + r.top + r.height/2, 0) / pts.length;
    const to = card.getBoundingClientRect();
    if (!to.width) return;
    const dx = cx - (to.left + to.width/2), dy = cy - (to.top + to.height/2);
    card.style.animation = 'none';   // the CSS pop would fight this for the transform
    /* It still leaps out of their avatar, but it gets down to its own place
       quickly and stops short of riding back up over the scores on the way —
       at full size it would sit right on top of the numbers. */
    card.animate(
      [{transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.10)', opacity: .2, offset: 0},
       {transform: 'translate(' + (dx*.16) + 'px,' + (dy*.16) + 'px) scale(.72)', opacity: 1, offset: .5},
       {transform: 'none', opacity: 1, offset: 1}],
      {duration: 520, easing: 'cubic-bezier(.22,1.05,.3,1)'}
    );
    pts.forEach((_, k) => {
      const b = bubbles.get(finders[k]);
      if (b) b.face.animate([{transform:'scale(calc(var(--grow,1) * .84))'},{transform:'scale(var(--grow,1))'}],
                            {duration: 420, easing:'cubic-bezier(.2,1.6,.4,1)'});
    });
  }
  function unlight(){
    bubbles.forEach(b => b.el.classList.remove('src'));
    stage.dataset.lit = '';
  }
  function showWord(e2, path){
    unlight();
    stage.replaceChildren();
    const card = el('div','rv-word' + (e2.unique ? ' unique' : ''));
    const word = e2.w.toUpperCase();
    const spell = SPELL;
    /* The word is shown WHERE IT WAS on the tray, picked out a die at a time
       with the trace drawing itself behind it, as though someone were swiping
       it in front of you. If the path can't be found (a board we no longer
       hold), fall back to spelling it out. */
    if (path === undefined) path = wordPath(word);
    if (path){
      const grid = el('div','rv-board');
      grid.style.gridTemplateColumns = 'repeat(' + G.n + ',1fr)';
      const order = new Map(path.map((cell, k) => [cell, k]));
      G.board.forEach((letter, idx) => {
        const cell = el('div','rv-cell' + (order.has(idx) ? ' lit' : ''), letter);
        if (order.has(idx)) cell.style.animationDelay = (order.get(idx) * spell) + 'ms';
        grid.appendChild(cell);
      });
      // the finger: a line that grows from die to die, in step with the letters
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'rv-trace');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      const step = 100 / G.n;
      const line = document.createElementNS(SVG_NS, 'path');
      line.setAttribute('d', path.map((cell, k) => {
        const x = ((cell % G.n) + .5) * step, y = (Math.floor(cell / G.n) + .5) * step;
        return (k ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
      }).join(' '));
      svg.appendChild(line);
      grid.appendChild(svg);
      card.appendChild(grid);
      const label = el('div','rv-wordtext', word);
      label.style.animationDelay = (path.length * spell + BEAT) + 'ms';
      card.appendChild(label);
      // measurable only once it's in the document
      requestAnimationFrame(() => {
        if (!line.isConnected || !line.getTotalLength) return;
        const len = line.getTotalLength() || 1;
        line.style.strokeDasharray = len;
        if (reduced || !line.animate){ line.style.strokeDashoffset = 0; return; }
        line.style.strokeDashoffset = len;
        line.animate([{strokeDashoffset: len}, {strokeDashoffset: 0}],
          {duration: Math.max(1, (path.length - 1) * spell), easing: 'linear', fill: 'forwards'});
      });
    } else {
      const tiles = el('div','rv-tiles');
      tiles.style.setProperty('--ts', Math.max(15, Math.min(36, Math.floor((Math.min(innerWidth, 520) - 70) / word.length * .60))) + 'px');
      [...word].forEach((ch, i) => {
        const sp = el('span','', ch);
        sp.style.animationDelay = (i * spell) + 'ms';
        tiles.appendChild(sp);
      });
      card.appendChild(tiles);
    }
    /* Whose word is it? Every word names its finders — avatar AND name —
       because the batched words used to show no owner at all, which is what
       made the whole reveal unreadable. */
    const lands = (path ? path.length : word.length) * spell + BEAT + 190;   // when the names appear
    const row = el('div','rv-finders');
    e2.finders.forEach((id, i) => {
      const r = rows.find(x => x.id === id);
      const chip = el('span','rv-finder');
      chip.style.animationDelay = (lands + i * 80) + 'ms';
      const face = el('span','face', r ? r.p.emoji : '🙂'); face.style.setProperty('--c', colorOf(id));
      chip.appendChild(face);
      chip.appendChild(el('i','', r ? (r.p.me ? 'you' : r.p.name) : ''));
      chip.appendChild(el('b','','+' + e2.pts));
      row.appendChild(chip);
    });
    card.appendChild(row);
    const ribbon = el('div','rv-x2' + (e2.unique ? '' : ' shared'),
      e2.unique ? 'NOBODY ELSE FOUND IT — DOUBLE!' :
      e2.finders.length > 1 ? '🤝 SHARED BY ' + e2.finders.length + ' OF YOU' : 'FOUND IT');
    ribbon.style.animationDelay = (lands + 100) + 'ms';
    card.appendChild(ribbon);
    stage.appendChild(card);
    launchFromFinders(card, e2.finders);
    const lc = el('span','rv-logchip' + (e2.unique ? ' u' : ''), word);
    log.appendChild(lc);
    log.scrollLeft = log.scrollWidth;
    return lands;
  }
  /* …and then the word physically travels into each person who found it: a copy
     of it flies from the card into their avatar, and only when it lands do their
     points go up. That journey is the answer to "which words go to who". */
  function flyToFinders(e2, after){
    const word = e2.w.toUpperCase();
    let first = true;
    e2.finders.forEach((id, k) => {
      const b = bubbles.get(id);
      if (!b){ award(id, e2.pts); return; }
      const to = b.face.getBoundingClientRect();
      const card = stage.querySelector('.rv-word');
      const from = (card || stage).getBoundingClientRect();
      let landed = false;
      const land = () => {
        if (landed) return;        // onfinish and the stall backstop both call this
        landed = true;
        award(id, e2.pts);
        b.face.animate([{transform:'scale(var(--grow,1))'},{transform:'scale(calc(var(--grow,1) * 1.25))'},
                        {transform:'scale(var(--grow,1))'}], {duration:340, easing:'ease-out'});
        if (first){ first = false; reorder(); }
      };
      if (reduced || !document.body.animate){ land(); return; }
      const fly = el('div','rv-fly' + (e2.unique ? ' u' : ''));
      fly.appendChild(el('span','', word));
      fly.appendChild(el('b','','+' + e2.pts));
      document.body.appendChild(fly);
      const w = fly.getBoundingClientRect();
      const x0 = from.left + from.width/2 - w.width/2, y0 = from.top + from.height/2 - w.height/2;
      const x1 = to.left + to.width/2 - w.width/2,   y1 = to.top + to.height/2 - w.height/2;
      fly.style.transform = 'translate(' + x0 + 'px,' + y0 + 'px)';
      const a = fly.animate([
        {transform: 'translate(' + x0 + 'px,' + y0 + 'px) scale(1)', opacity: 1},
        {transform: 'translate(' + ((x0+x1)/2) + 'px,' + ((y0+y1)/2 - 26) + 'px) scale(.8)', opacity: 1, offset: .55},
        {transform: 'translate(' + x1 + 'px,' + y1 + 'px) scale(.25)', opacity: .15}
      ], {duration: FLY, delay: k * 130, easing: 'cubic-bezier(.4,.05,.35,1)', fill: 'forwards'});
      a.onfinish = () => { fly.remove(); land(); };
      // a backgrounded tab can stall the animation and never fire onfinish
      revealTimers.push(setTimeout(() => { fly.remove(); land(); }, FLY + k*130 + 400));
    });
    if (after) after();
  }
  // Everyone's final number is already known — the show just performs it.
  function snapTotals(){
    // Recompute rather than trusting the totals captured when the show began —
    // a report that landed mid-show would otherwise make the number change
    // again on the podium, one screen later.
    rows.forEach(r => {
      const b = bubbles.get(r.id);
      if (!b) return;
      const t = totalsFor(r.id, r.p);
      if (b.score !== t){ b.score = t; b.sc.textContent = String(t); }
    });
    reorder();
  }

  /* Skip: stop every pending step, put the real totals up, and hand straight
     over to the podium. Local only — it doesn't touch anyone else's phone. */
  $('btn-reveal-skip').onclick = () => {
    revealTimers.forEach(clearTimeout); revealTimers.length = 0;
    document.querySelectorAll('.rv-fly').forEach(f => f.remove());
    unlight();
    stage.replaceChildren(); snapTotals();
    setPhase(last ? '🏆 AND THE WINNER IS…' : '📈 WHO’S AHEAD?', '');
    snd.up();
    revealTimers.push(setTimeout(done, 900));
  };

  const entries = buildRevealEntries(G.round);
  // small scores first so every phase builds to its biggest word
  const shared = entries.filter(e2 => !e2.unique).sort((a,b) => a.pts - b.pts || a.w.localeCompare(b.w));
  const uniq = entries.filter(e2 => e2.unique).sort((a,b) => a.pts - b.pts || a.w.localeCompare(b.w));

  if (reduced || !entries.length){
    snapTotals();
    if (!entries.length) $('reveal-sub').textContent = 'No words that round… the sequel will be better!';
    at(reduced ? 900 : 2000, done);
    return;
  }

  /* Pacing. Scaling the interval to the word count was wrong in both
     directions at once: a big haul squeezed each word down to ~half a second
     (gone before you can read it) while the sequence still dragged past twenty
     seconds. So only the headline words take the centre stage, each held long
     enough to actually read, and the small change sweeps past in batches.
     Slowed by half again on 2026-08-12 (Max: "way too fast") — a word now has
     time to spell itself out die by die before the next one takes the stage. */
  /* Every word is now staged the same way — spelled out, owners named, then
     flown into them — so the pace is simply how long that takes to read. Do
     NOT go back to scaling this by word count; that is the mistake that made
     big rounds unreadable in the first place. A long round is long: the
     tap-to-skip on the reveal screen is the escape hatch, not a faster clock. */
  /* Paced like a finger, not a slideshow. Each letter is picked out at a human
     speed with the trace drawing itself behind it, then the finished word is
     HELD long enough to actually read before it goes to whoever found it —
     "not enough time to see it" was the note. A word therefore takes as long as
     it takes: a four-letter word about 2s, ANACONDAS about 3s. */
  const SPELL = 170;      // per letter, as it is selected on the tray
  const BEAT = 280;       // pause between the last letter and the word appearing
  const FLY_AT = 520;     // how long the word stands alone before it travels
  const HOLD = 700;       // …and how long the whole card is held after that
  const FLY = 520;
  let t = 1050, tickN = 0;
  const at2 = (ms, fn) => revealTimers.push(setTimeout(fn, ms));

  function stagePhase(list, unique, t0){
    let t = t0;
    // smallest first, so each phase builds towards its biggest word
    const asc = list.slice().sort((a,b) => a.pts - b.pts || a.w.localeCompare(b.w));
    asc.forEach(e2 => {
      // trace it once here: it sets both the picture and the pace
      const path = wordPath(e2.w);
      const steps = path ? path.length : e2.w.length;
      const showAt = steps * SPELL + BEAT;      // when the word itself lands
      at(t, () => {
        showWord(e2, path);
        unique ? snd.spark() : snd.tick(tickN++ % 8);
        at2(showAt + FLY_AT, () => flyToFinders(e2));
      });
      t += showAt + FLY_AT + HOLD + (unique ? 200 : 0);
    });
    return t;
  }

  if (shared.length){
    at(t, () => setPhase('🤝 WORDS YOU SHARED', 'everyone who found it scores!'));
    t = stagePhase(shared, false, t + 1200) + 450;
  }
  if (uniq.length){
    at(t, () => { stage.replaceChildren(); setPhase('✨ UNIQUE WORDS', 'nobody else found these — DOUBLE points!'); snd.spark(); });
    t = stagePhase(uniq, true, t + 1650);
  }
  t += 450;
  at(t, () => {
    unlight();
    stage.replaceChildren(); snapTotals();
    setPhase(last ? '🏆 AND THE WINNER IS…' : '📈 WHO’S AHEAD?',
             last ? '' : 'after round ' + (G.round+1) + ' of ' + G.cfg.r);
    snd.up();
  });
  at(t + 2100, done);
}

/* The podium is re-rendered by every arriving message AND by the 3s gossip
   tick, and it used to rebuild the whole stage each time — so the columns
   restarted their rise-up animation every three seconds and the avatars
   flashed, right in front of everyone reading the scores. Rebuild only when
   the standings have actually changed (same fix as the lobby roster). */
let podiumSig = null;
function renderPodium(){
  if (G.mode !== 'party') return;
  const last = G.round >= G.cfg.r - 1;
  const multi = G.cfg.r > 1;
  const rows = everyone().map(([id,p]) => ({id, p, total: totalsFor(id,p), rd: roundScoreOf(p, G.round),
                                            words: wordsOf(p, G.round)}))
    .sort((a,b) => b.total - a.total);
  if (last) creditGame(rows);   // one game, counted once — see creditGame()
  const sig = G.round + '|' + last + '|' + G.isHost + '|' +
    rows.map(r => r.id + ':' + r.total + ':' + r.rd + ':' + r.words + ':' + (r.p.gone?1:0) + ':' + r.p.name + r.p.emoji).join(',');
  if (sig === podiumSig) return;
  podiumSig = sig;
  $('podium-title').textContent = last ? '🏆 Final results!' : '🏆 Round ' + (G.round+1) + ' podium';
  $('podium-sub').hidden = last;
  $('podium-sub').textContent = 'Totals after round ' + (G.round+1) + ' of ' + G.cfg.r;
  const stage = $('podium-stage'); stage.replaceChildren();
  const order = [1,0,2]; // silver, gold, bronze display order
  const podClasses = ['p2','p1','p3'];
  order.forEach((rankIdx, k) => {
    const r = rows[rankIdx];
    if (!r) { stage.appendChild(el('div','pod ' + podClasses[k])); return; }
    const pod = el('div','pod ' + podClasses[k]);
    const face = el('span','face', r.p.emoji); face.style.setProperty('--c', colorOf(r.id));
    pod.appendChild(face);
    pod.appendChild(el('b','', r.p.me ? r.p.name + ' (you)' : r.p.name));
    const block = el('div','block');
    block.appendChild(el('span','medal', ['🥇','🥈','🥉'][rankIdx] || ''));
    block.appendChild(el('span','score', r.total + ' pts'));
    block.appendChild(el('span','delta', r.words + (r.words === 1 ? ' word' : ' words')));
    // mid-game the interesting number is what this round just added
    if (multi) block.appendChild(el('span','delta', '+' + r.rd + ' this round'));
    pod.appendChild(block);
    stage.appendChild(pod);
  });
  const rest = $('podium-rest'); rest.replaceChildren();
  rows.slice(3).forEach((r,i) => {
    const row = el('div','stand-row' + (r.p.me ? ' me' : ''));
    row.appendChild(el('span','rank', (i+4)+''));
    const face = el('span','face', r.p.emoji); face.style.setProperty('--c', colorOf(r.id));
    row.appendChild(face);
    const info = el('div','info'); info.appendChild(el('b','', r.p.me ? r.p.name + ' (you)' : r.p.name));
    info.appendChild(el('small','', r.words + (r.words === 1 ? ' word' : ' words') + (multi ? ' · +' + r.rd + ' this round' : '')));
    row.appendChild(info);
    row.appendChild(el('span','pts', String(r.total)));
    rest.appendChild(row);
  });
  // awards — the whole-game honours, so they wait for the final podium.
  // Mid-game the round's own headline word takes that spot instead.
  const aw = $('awards'); aw.replaceChildren();
  if (!last){
    const top = buildRevealEntries(G.round).sort((a,b) => b.pts - a.pts)[0];
    if (top){
      const who = top.finders.map(id => {
        const r = rows.find(x => x.id === id);
        return r ? (r.p.me ? 'you' : r.p.name) : 'someone';
      }).join(' & ');
      const a = el('div','award'); a.appendChild(el('span','ic', top.unique ? '✨' : '🔤'));
      const t = el('span','txt'); t.append('Word of the round: ');
      t.appendChild(el('b','', top.w.toUpperCase()));
      t.append(' — +' + top.pts + (top.unique ? ' (unique!) to ' : ' to ') + who);
      a.appendChild(t); aw.appendChild(a);
    }
  }
  if (last){
    let longest = null, most = null;
    for (const r of rows){
      for (let rd=0; rd<G.cfg.r; rd++){
        const f = r.p.me ? G.finsSelf[rd] : r.p.fin && r.p.fin[rd];
        if (!f) continue;
        if (f.b && (!longest || f.b.length > longest.word.length)) longest = {name:r.p.name, word:f.b};
      }
      const words = (() => { let s=0; for (let rd=0;rd<G.cfg.r;rd++){ const f = r.p.me ? G.finsSelf[rd] : r.p.fin && r.p.fin[rd]; if (f) s += f.w; } return s; })();
      if (!most || words > most.count) most = {name:r.p.name, count:words};
    }
    if (rows[0] && rows[0].total > 0){
      const a = el('div','award'); a.appendChild(el('span','ic','👑'));
      const t = el('span','txt'); t.append('Word Champion: '); t.appendChild(el('b','', rows[0].p.name)); t.append(' — ' + rows[0].total + ' pts');
      a.appendChild(t); aw.appendChild(a);
    }
    if (longest && longest.word){
      const a = el('div','award'); a.appendChild(el('span','ic','📏'));
      const t = el('span','txt'); t.append('Longest word: '); t.appendChild(el('b','', longest.word.toUpperCase())); t.append(' by ' + longest.name);
      a.appendChild(t); aw.appendChild(a);
    }
    if (most && most.count > 0){
      const a = el('div','award'); a.appendChild(el('span','ic','⚡'));
      const t = el('span','txt'); t.append('Word machine: '); t.appendChild(el('b','', most.name)); t.append(' — ' + most.count + ' words');
      a.appendChild(t); aw.appendChild(a);
    }
  }
  $('btn-podium-next').hidden = !(G.isHost && !last);
  $('btn-again').hidden = !(G.isHost && last);
  $('podium-wait').hidden = G.isHost;
  $('podium-wait').textContent = last
    ? 'Waiting for the host…'
    : 'Waiting for the host to start round ' + (G.round+2) + '…';
  mountChat('podium-chat-slot');   // the bit where everyone talks trash
}

/* ---------------- confetti ---------------- */
function confettiBurst(){
  const cv = $('confetti'), ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const parts = [];
  const cols = ['#FF2E63','#FFD93C','#00C566','#2456E6','#8B5CF6','#FF9F1C','#FFFFFF'];
  for (let i=0;i<140;i++) parts.push({
    x: Math.random()*cv.width, y: -20 - Math.random()*cv.height*.5,
    w: 6+Math.random()*7, h: 8+Math.random()*10,
    vy: 2+Math.random()*3.5, vx: -1.5+Math.random()*3, rot: Math.random()*Math.PI, vr: -.15+Math.random()*.3,
    c: cols[Math.floor(Math.random()*cols.length)]
  });
  let frames = 0;
  (function tick(){
    ctx.clearRect(0,0,cv.width,cv.height);
    for (const p of parts){
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); ctx.restore();
    }
    if (++frames < 260) requestAnimationFrame(tick);
    else ctx.clearRect(0,0,cv.width,cv.height);
  })();
}

/* ---------------- boot ---------------- */
/* Opening the app always lands on the homepage. An invite link's code is kept
   as a one-tap "join" button there rather than joining on its own: these links
   get bookmarked, saved to a home screen and re-tapped out of the family chat
   days later, and auto-joining meant every one of those taps dropped you into a
   dead room as its host, staring at a code you never asked for. */
(function boot(){
  const m = (location.search + location.hash).match(/room=([A-Za-z]{4})/);
  if (m){
    pendingRoom = m[1].toUpperCase();
    // Don't let the code linger in the address bar either — a reload would
    // bring the banner back long after that party ended.
    try { history.replaceState(null, '', location.pathname); } catch(e){}
  }
  if (!pendingRoom){
    // No invite link, but this phone was in a party minutes ago — it was almost
    // certainly killed mid-game. Offer the way back: one tap, never automatic.
    const back = recentParty();
    if (back){ pendingRoom = back; pendingIsRejoin = true; }
  }
  refreshHome();
  if (!P.name){ openName(); return; }
  show('home');
})();
