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

/* The board is generated exactly the way the real game shakes its tray (and
   the way a faithful adaptation like Netflix's simulates it): the official
   dice are shuffled into the grid — each die lands in one cell — and each
   shows a uniformly random face. Nothing is curated or re-rolled; vowel
   droughts and letter clumps are part of real Boggle. Deterministic in the
   seed, so every phone in a party shows the identical grid. */
function genBoard(seed, n){
  const rnd = rngFromSeed(seed);
  const dice = DICE_FOR[n].slice();
  for (let i=dice.length-1;i>0;i--){ const j = Math.floor(rnd()*(i+1)); [dice[i],dice[j]]=[dice[j],dice[i]]; }
  // Every face is one letter; Q is the sole exception and always comes up "QU".
  return dice.map(d => {
    const f = d[Math.floor(rnd()*6)];
    return f === 'Q' ? 'QU' : f.toUpperCase();
  });
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
const RAW_WORDS = "__DICT__";
let DICT = null, WORDLIST = null;
function ensureDict(){
  if (!DICT){ WORDLIST = RAW_WORDS.split(' '); DICT = new Set(WORDLIST); }
}
function solveBoard(board, n, minLen){
  ensureDict();
  const counts = {};
  for (const cell of board) for (const ch of cell.toLowerCase()) counts[ch] = (counts[ch]||0) + 1;
  const cand = [];
  for (const w of WORDLIST){
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
// Real Boggle's table: 3–4 letters = 1, 5 = 2, 6 = 3, 7 = 5, 8+ = 11.
// Super Big Boggle (6×6) additionally pays 2 points per letter at 9+.
function scoreFor(w){
  const L = w.length;
  if (L >= 9 && G.cfg.g === 6) return L * 2;
  return L >= 8 ? 11 : L === 7 ? 5 : L === 6 ? 3 : L === 5 ? 2 : 1;
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
document.addEventListener('visibilitychange', () => {
  if (document.hidden) Music.stop(); else if (inRound()) Music.start();
});

/* ---------------- global state ---------------- */
const AVATARS = ['🦊','🐼','🦄','🐸','🐯','🐙','🦁','🐨','🐷','🐵','🦖','🐳'];
const COLORS = ['#FF5757','#FF9F1C','#F5C400','#3DDC5A','#00B8A0','#3B82F6','#8B5CF6','#FF6BD6'];
const P = {   // me + app prefs
  name: store.get('name', ''),
  emoji: store.get('emoji', ''),
  sound: store.get('sound', true)
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
  specTimer: 0,        // spectator watch interval
  gossipTimer: 0,      // periodic roster/score broadcast
  sweepTimer: 0,       // drops gossiped peers nobody reports any more
  seq: 0               // my own broadcast counter — proves my news is new
};
const GOSSIP_MS = 3000;   // re-announce cadence
const GOSSIP_TTL = 14000; // forget an indirect peer nobody has mentioned this long
const DEV = /[?#&]dev\b/.test(location.href);

/* ---------------- screens / toast / overlay ---------------- */
const SCREENS = ['name','home','join','lobby','game','standings','reveal','podium'];
function show(name){
  SCREENS.forEach(s => $('scr-'+s).classList.toggle('active', s === name));
  $('confirm-exit').hidden = true; // never let a dialog outlive its screen
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
  refreshHome();
  if (pendingRoom){ const c = pendingRoom; pendingRoom = null; joinParty(c); }
  else show('home');
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
  $('me-name').textContent = P.name || 'Player';
  $('me-face').textContent = P.emoji || '🦊';
  applySoundUI();
  const daily = store.get('daily-' + todayKey(), null);
  $('daily-done').hidden = daily === null;
  if (daily !== null) $('daily-done').textContent = daily + ' PTS ✓';
  const best = store.get('best', 0), games = store.get('games', 0);
  $('home-stats').textContent = games
    ? `Best round: ${best} pts · ${games} game${games===1?'':'s'} played`
    : 'Find words. Longer = more points!';
}
$('btn-sound').addEventListener('click', toggleSound);
$('btn-game-sound').addEventListener('click', toggleSound);
$('btn-host').addEventListener('click', () => hostParty());
$('btn-join').addEventListener('click', () => { $('code-input').value = ''; show('join'); setTimeout(()=>$('code-input').focus(), 80); });
$('btn-join-back').addEventListener('click', () => show('home'));
$('btn-solo').addEventListener('click', () => startLocal('solo'));
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
function myProfile(){
  return {n: P.name, e: P.emoji, h: G.isHost, j: G.joinedAt};
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
  players[Trystero.selfId] = {n: P.name, e: P.emoji, j: G.joinedAt, h: G.isHost, q: G.seq, sc: scSelf(), fin: G.finsSelf};
  for (const [id, p] of G.peers){
    if (p.gone) continue;
    const relayed = {n: p.name, e: p.emoji, j: p.joinedAt, h: !!p.host, sc: p.sc || {}, fin: p.fin || {}};
    if (Number.isFinite(p.seq)) relayed.q = p.seq;
    players[id] = relayed;
  }
  return players;
}
/* live: first-hand proof this peer is alive right now (a message from them).
   self: `inc` is their own account of themselves, so it wins on name/avatar. */
function mergePlayer(id, inc, {live = false, self = false} = {}){
  let cur = G.peers.get(id), isNew = false;
  if (!cur){
    cur = {name:'Player', emoji:'🙂', joinedAt: Date.now(), host:false, gone:false,
           sc:{}, fin:{}, seq:-Infinity, seen:0, direct:false};
    G.peers.set(id, cur);
    isNew = true;
  }
  // Scores only grow within a round and finals never change, so merging these
  // is safe from any source and in any order.
  for (const r in inc.sc||{}) cur.sc[r] = Math.max(cur.sc[r]||0, inc.sc[r]||0);
  for (const r in inc.fin||{}) if (!cur.fin[r]) cur.fin[r] = inc.fin[r];

  const q = typeof inc.q === 'number' ? inc.q : null;
  const fresh = live || isNew || (q !== null && q > cur.seq);
  if (fresh){
    if (q !== null && q > cur.seq) cur.seq = q;
    cur.seen = Date.now();
    cur.gone = false; cur.gone2 = false; // back with us — let a future exit announce again
    if (inc.n !== undefined) cur.name = String(inc.n||'Player').slice(0,14);
    if (inc.e !== undefined) cur.emoji = inc.e || '🙂';
    if (inc.j !== undefined) cur.joinedAt = inc.j;
    if (inc.h !== undefined) cur.host = !!inc.h;
  }
  if (self) cur.direct = true;
  return isNew;
}
function connect(code, asHost){
  leaveNet();
  G.mode = 'party'; G.code = code; G.isHost = asHost; G.joinedAt = Date.now();
  G.peers = new Map(); G.finsSelf = {}; G.round = 0; G.seeds = [];
  G.spectating = false; G.seq = 0;
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
    again: room.makeAction('again')
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
    if (p){ p.direct = false; p.gone = true; }
    electHost();
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
    mergePlayer(peerId, {sc: {[d.r]: d.s}}, {live: true, self: true});
    renderRivals();
  };
  A.fin.onMessage = (d, {peerId}) => {
    mergePlayer(peerId, {sc: {[d.r]: d.s}, fin: {[d.r]: d}}, {live: true, self: true});
    maybeFinishCollection(); // refreshes whichever results screen is up
  };
  A.again.onMessage = () => { if (!G.isHost) resetToLobby(); };

  clearInterval(G.gossipTimer);
  G.gossipTimer = setInterval(() => {
    if (!G.net) return;
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
window.addEventListener('pagehide', leaveNet);

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
function scSelf(){ const o = {}; for (const r in G.finsSelf) o[r] = G.finsSelf[r].s; if (G.playing) o[G.round] = G.score; return o; }
function colorOf(id){
  const idx = activePlayers().findIndex(([pid]) => pid === id);
  return COLORS[(idx >= 0 ? idx : 0) % COLORS.length];
}
function electHost(){
  const act = activePlayers();
  if (!act.length) return;
  // Whoever opened the room claims host, and everyone honours the claim. Phones
  // disagree about the wall clock, so joinedAt must never decide this: if the
  // host leaves (or a split brain leaves two claiming it), fall back to the
  // lowest peer id, which every phone computes the same way.
  const claimers = act.filter(([, p]) => p.host);
  const [hostId] = (claimers.length ? claimers : act).map(([id]) => id).sort();
  const wasHost = G.isHost;
  G.isHost = hostId === Trystero.selfId;
  for (const [id,p] of G.peers) p.host = id === hostId;
  if (G.isHost !== wasHost){
    if (G.isHost) toast("You're the host now! 👑");
    renderSettings(); renderLobbyCtas(); renderStandingsCtas();
  }
}

/* ---------------- lobby ---------------- */
let pendingRoom = null;
function hostParty(){ connect(makeCode(), true); }
function joinParty(code){ connect(code, false); }

function openLobby(){
  renderRoomCode();
  renderSettings();
  renderLobbyPlayers();
  renderLobbyCtas();
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
  G.peers = new Map(); G.finsSelf = {};
  refreshHome();
  show('home');
}
$('btn-lobby-leave').addEventListener('click', quitToHome);

function renderLobbyPlayers(){
  if (G.mode !== 'party') return;
  const wrap = $('lobby-players'); wrap.replaceChildren();
  const act = everyone();
  for (const [id, p] of act){
    if (p.gone) continue;
    const blob = el('div','pl-blob');
    const face = el('span','face', p.emoji); face.style.setProperty('--c', colorOf(id));
    blob.appendChild(face);
    blob.appendChild(el('b','', p.me ? p.name + ' (you)' : p.name));
    const isHost = p.me ? G.isHost : p.host;
    if (isHost) blob.appendChild(el('span','tag','HOST'));
    wrap.appendChild(blob);
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
const SEGS = [['seg-grid','g'],['seg-timer','t'],['seg-min','m'],['seg-rounds','r']];
function renderSettings(){
  for (const [segId, key] of SEGS){
    const seg = $(segId);
    seg.classList.toggle('locked', G.mode === 'party' && !G.isHost);
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.v === G.cfg[key]));
  }
  $('settings-owner').textContent = (G.mode !== 'party' || G.isHost)
    ? "you're the host — you decide!"
    : 'the host picks these';
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
  // The host re-broadcasts this every few seconds so a phone that missed the
  // one-shot start (backgrounded, a dropped packet, joined a moment late) still
  // gets pulled into the round. Ignore a repeat of a round we're already in, or
  // it would restart the board and wipe the words we've found.
  const key = (d.gid || '?') + ':' + (d.round || 0);
  if (key === G.beganKey) return;
  G.gameId = d.gid || G.gameId;
  G.seeds = d.seeds || [];
  G.cfg = sanitizeCfg(d.cfg || {});
  G.round = d.round || 0;
  G.clockOffset = (d.hostNow || Date.now()) - Date.now();
  G.startAt = (d.startAt || Date.now()) - G.clockOffset;
  G.finsSelf = {};
  // A fresh game: drop any scores merged from a previous one, or they would
  // bleed into the new totals (scores merge by max, so they never shrink).
  for (const [,p] of G.peers){ p.sc = {}; p.fin = {}; }
  beginRound();
}
function hostNextRound(){
  G.round++;
  G.startAt = Date.now() + 4200;
  if (G.net) G.net.A.nxt.send({round: G.round, startAt: G.startAt, hostNow: Date.now()});
  beginRound();
}
function handleNext(d){
  G.round = d.round;
  G.clockOffset = (d.hostNow || Date.now()) - Date.now();
  G.startAt = (d.startAt || Date.now()) - G.clockOffset;
  beginRound();
}
function resetToLobby(){
  clearReveal();
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
    G.cfg = {g:4, t:180, m:3, r:1};
    G.seeds = ['bfp-daily-' + todayKey()];
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
  ensureDict();
  clearReveal();
  $('scr-game').classList.remove('final-countdown');  // clear any leftover pulse
  G.beganKey = (G.gameId || '?') + ':' + G.round;  // ignore host's re-broadcasts of this round
  G.spectating = G.mode === 'party' && Date.now() > G.startAt + 3000;
  G.n = G.cfg.g;
  G.adj = adjacency(G.n);
  G.board = genBoard(G.seeds[G.round], G.n);
  G.path = []; G.found = new Map(); G.score = 0; G.possible = null;
  G.playing = false;
  G.warned = false;
  G.totalMs = DEV ? 25000 : G.cfg.t * 1000;

  renderBoard();
  $('round-pill').textContent = 'R' + (G.round+1) + '/' + G.cfg.r;
  $('my-score').textContent = '0';
  $('found-row').replaceChildren($('found-empty')); $('found-empty').style.display = '';
  $('found-count').textContent = '0 WORDS';
  $('btn-finish').hidden = G.mode === 'party';
  pill.className = 'word-pill'; pill.textContent = ' ';
  $('timer-fill').style.width = '100%'; $('timer-fill').className = 'timer-fill';
  $('timer-num').textContent = fmtTime(G.totalMs);
  renderRivals();
  show('game');
  fitTiles(); // now the board has a size, so the letters can be scaled to it
  requestWake();
  if (!G.spectating) Music.start(); // the song belongs to the round only
  // One game = one seed set, so count it once — on round 1, and only if
  // actually playing (a mid-round joiner spectates this round).
  if (G.round === 0 && !G.spectating) store.set('games', store.get('games',0) + 1);

  // background solve for results
  setTimeout(() => { if (!G.possible) G.possible = solveBoard(G.board, G.n, G.cfg.m); }, 1200);

  if (G.spectating){
    overlay('👀', 'Round in progress — you join the next one!', 'word');
    setTimeout(hideOverlay, 2200);
    // watch live, then results arrive via fins
    clearInterval(G.specTimer);
    G.specTimer = setInterval(() => {
      if (!G.seeds.length){ clearInterval(G.specTimer); G.specTimer = 0; return; }
      const left = G.startAt + G.totalMs - Date.now();
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
function wordFromPath(){ return G.path.map(i => G.board[i]).join(''); }
const SVG_NS = 'http://www.w3.org/2000/svg';
function drawPath(){
  const g = geom();
  pathSvg.setAttribute('viewBox', '0 0 ' + g.r.width + ' ' + g.r.height);
  pathSvg.replaceChildren();
  if (!G.path.length) return;
  const pts = G.path.map(i => { const c = cellCentre(i, g); return c.x + ',' + c.y; }).join(' ');
  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', pts);
  line.setAttribute('fill','none');
  line.setAttribute('stroke','#FF2E63');
  line.setAttribute('stroke-width', g.size*.17);
  line.setAttribute('stroke-linecap','round');
  line.setAttribute('stroke-linejoin','round');
  pathSvg.appendChild(line);
}
function clearSel(){
  tileEls.forEach(t => t.classList.remove('sel'));
  drawPath();
}
function setSel(){
  tileEls.forEach((t,i) => t.classList.toggle('sel', G.path.includes(i)));
  drawPath();
  const w = wordFromPath();
  if (!w){ pill.className = 'word-pill'; pill.textContent = ' '; return; }
  pill.textContent = w;
  const lw = w.toLowerCase();
  const isValid = lw.length >= G.cfg.m && DICT.has(lw) && !G.found.has(lw);
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
  const w = wordFromPath(), lw = w.toLowerCase(), tiles = G.path.slice();
  G.path = [];
  if (lw.length < G.cfg.m){
    if (lw.length >= 3) flashPill('bad', w + ' — too short!');
    setSel(); return;
  }
  if (G.found.has(lw)){ flashPill('dupe', w); snd.dupe(); clearSel(); return; }
  if (!DICT.has(lw)){
    flashPill('bad', w); snd.bad(); buzz([18,40,18]);
    boardEl.classList.remove('shake'); void boardEl.offsetWidth; boardEl.classList.add('shake');
    clearSel(); return;
  }
  const pts = scoreFor(lw);
  G.found.set(lw, pts); G.score += pts;
  $('my-score').textContent = G.score;
  $('my-score').classList.remove('bump'); void $('my-score').offsetWidth; $('my-score').classList.add('bump');
  flashPill('good', w + '  +' + pts);
  snd.good(); buzz(24);
  tiles.forEach(i => { tileEls[i].classList.add('flash-good'); setTimeout(() => tileEls[i].classList.remove('flash-good'), 380); });
  floatPop(tiles[tiles.length-1], '+' + pts);
  $('found-empty').style.display = 'none';
  const chip = el('span','fchip', w); chip.appendChild(el('b','','+'+pts));
  $('found-row').prepend(chip);
  $('found-count').textContent = G.found.size + (G.found.size === 1 ? ' WORD' : ' WORDS');
  clearSel();
  if (G.net) G.net.A.sc.send({r: G.round, s: G.score});
  renderRivals();
}
function flashPill(cls, text){
  pill.textContent = text; pill.className = 'word-pill ' + cls;
  clearTimeout(flashPill.t);
  flashPill.t = setTimeout(() => { if (!G.path.length){ pill.className = 'word-pill'; pill.textContent = ' '; } }, 900);
}
function floatPop(tileIdx, text){
  const g = geom();
  const d = el('div','float-pop', text);
  d.style.left = cellCentre(tileIdx, g).x + 'px';
  d.style.top = (Math.floor(tileIdx/G.n) * g.pitch) + 'px';
  boardEl.appendChild(d);
  setTimeout(() => d.remove(), 850);
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
window.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('confirm-exit').hidden) closeExitConfirm(); });

/* live rivals rail */
function renderRivals(){
  const rail = $('rivals');
  if (G.mode !== 'party'){ rail.replaceChildren(); return; }
  const rows = everyone().map(([id,p]) => ({
    id, p, score: (p.me ? G.score : (p.sc && p.sc[G.round]) || 0)
  })).sort((a,b) => b.score - a.score);
  rail.replaceChildren();
  rows.forEach((r, i) => {
    const d = el('div','rival' + (i === 0 && r.score > 0 ? ' first' : '') + (r.p.gone ? ' gone' : ''));
    const face = el('span','face', r.p.emoji); face.style.setProperty('--c', colorOf(r.id));
    d.appendChild(face);
    d.appendChild(el('b','', String(r.score)));
    d.appendChild(el('small','', r.p.me ? 'you' : r.p.name));
    rail.appendChild(d);
  });
}

/* ---------------- round over / standings ---------------- */
function requestWake(){
  try { navigator.wakeLock && navigator.wakeLock.request('screen').then(l => G.lock = l).catch(()=>{}); } catch(e){}
}
function releaseWake(){ try { if (G.lock){ G.lock.release(); G.lock = null; } } catch(e){} }

function roundOver(wasSpectating){
  G.playing = false;
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
    if (G.score > store.get('best',0)) store.set('best', G.score);
    if (G.mode === 'daily'){
      const k = 'daily-' + todayKey();
      if (G.score > (store.get(k, -1))) store.set(k, G.score);
    }
    if (G.net) G.net.A.fin.send(fin);
  }
  clearTimeout(G.finTimer);
  G.finTimer = setTimeout(() => { hideOverlay(); routeAfterRound(); }, wasSpectating ? 800 : 1400);
}
/* Every round ends the way Boggle does: the words are revealed one at a time,
   paying whoever found them (unique finds pay double), and then the podium goes
   up — mid-game it shows the running standings with a "next round" button, and
   after the last round it's the final result. */
function routeAfterRound(){
  if (G.mode !== 'party'){ renderLocalResults(); show('standings'); return; }
  const last = G.round >= G.cfg.r - 1;
  runReveal(() => {
    renderPodium(); show('podium');
    confettiBurst();
    last ? snd.fanfare() : snd.up();
  });
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
  const possible = G.possible || new Set();
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
  const text = '📅 Boggleflix Daily ' + prettyToday() + ' — ' + G.score + ' pts, ' + G.found.size + ' words! Beat me: ' + location.origin + location.pathname;
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
  function showWord(e2){
    stage.replaceChildren();
    const card = el('div','rv-word' + (e2.unique ? ' unique' : ''));
    const word = e2.w.toUpperCase();
    const tiles = el('div','rv-tiles');
    // letter tiles sized so even ANACONDAS fits a phone screen
    tiles.style.setProperty('--ts', Math.max(14, Math.min(32, Math.floor((Math.min(innerWidth, 520) - 80) / word.length * .58))) + 'px');
    [...word].forEach((ch, i) => {
      const s = el('span','', ch);
      s.style.animationDelay = (i * 35) + 'ms';
      tiles.appendChild(s);
    });
    card.appendChild(tiles);
    const row = el('div','rv-finders');
    e2.finders.forEach((id, i) => {
      const r = rows.find(x => x.id === id);
      const chip = el('span','rv-finder');
      chip.style.animationDelay = (120 + i * 60) + 'ms';
      const face = el('span','face', r ? r.p.emoji : '🙂'); face.style.setProperty('--c', colorOf(id));
      chip.appendChild(face);
      chip.appendChild(el('b','','+' + e2.pts));
      row.appendChild(chip);
    });
    card.appendChild(row);
    if (e2.unique) card.appendChild(el('div','rv-x2','UNIQUE — DOUBLE POINTS!'));
    else if (e2.finders.length > 1) card.appendChild(el('div','rv-shared', e2.finders.length + ' of you found it'));
    stage.appendChild(card);
    const lc = el('span','rv-logchip' + (e2.unique ? ' u' : ''), word);
    log.appendChild(lc);
    log.scrollLeft = log.scrollWidth;
  }
  // Everyone's final number is already known — the show just performs it.
  function snapTotals(){
    rows.forEach(r => {
      const b = bubbles.get(r.id);
      if (b && b.score !== r.total){ b.score = r.total; b.sc.textContent = String(r.total); }
    });
    reorder();
  }

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

  let t = 700, tickN = 0;
  if (shared.length){
    at(t, () => setPhase('🤝 WORDS YOU SHARED', 'everyone who found it scores!'));
    t += 1100;
    // pace each phase to its word count — snappy for a big haul, savoured for a few
    const iv = Math.max(560, Math.min(1000, Math.round(26000 / shared.length)));
    shared.forEach(e2 => {
      at(t, () => { showWord(e2); e2.finders.forEach(id => award(id, e2.pts)); reorder(); snd.tick(tickN++ % 8); });
      t += iv;
    });
    t += 400;
  }
  if (uniq.length){
    at(t, () => { stage.replaceChildren(); setPhase('✨ UNIQUE WORDS', 'nobody else found these — DOUBLE points!'); snd.spark(); });
    t += 1600;
    const iv = Math.max(760, Math.min(1300, Math.round(22000 / uniq.length)));
    uniq.forEach(e2 => {
      at(t, () => { showWord(e2); award(e2.finders[0], e2.pts); reorder(); snd.spark(); });
      t += iv;
    });
  }
  t += 400;
  at(t, () => {
    stage.replaceChildren(); snapTotals();
    setPhase(last ? '🏆 AND THE WINNER IS…' : '📈 WHO’S AHEAD?',
             last ? '' : 'after round ' + (G.round+1) + ' of ' + G.cfg.r);
    snd.up();
  });
  at(t + 1700, done);
}

function renderPodium(){
  if (G.mode !== 'party') return;
  const last = G.round >= G.cfg.r - 1;
  const multi = G.cfg.r > 1;
  const rows = everyone().map(([id,p]) => ({id, p, total: totalsFor(id,p), rd: roundScoreOf(p, G.round)}))
    .sort((a,b) => b.total - a.total);
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
    if (multi) info.appendChild(el('small','', '+' + r.rd + ' this round'));
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
refreshHome();
(function boot(){
  const m = (location.search + location.hash).match(/room=([A-Za-z]{4})/);
  if (m) pendingRoom = m[1].toUpperCase();
  if (!P.name){ openName(); return; }
  if (pendingRoom){ const c = pendingRoom; pendingRoom = null; joinParty(c); return; }
  show('home');
})();
