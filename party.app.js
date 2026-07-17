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
  "BJKQXZ","CCNSTW","CEIILT","CEILPT","CEIPST","DDLNOR","DHHLOR","DHHNOT","DHLNOR",
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
function scoreFor(w){ const L = w.length; return L <= 4 ? 1 : L === 5 ? 2 : L === 6 ? 3 : L === 7 ? 5 : 11; }

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
  fanfare(){ [523,659,784,1047,784,1047,1319].forEach((f,i)=>tone(f,.16,'triangle',.09,i*.11)); }
};
const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch(e){} };

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
  cfg: store.get('cfg', {g:4, t:90, m:3, r:3}),
  seeds: [],
  round: 0,
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
const SCREENS = ['name','home','join','lobby','game','standings','podium'];
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
function refreshHome(){
  $('me-name').textContent = P.name || 'Player';
  $('me-face').textContent = P.emoji || '🦊';
  $('btn-sound').textContent = P.sound ? 'SOUND ON' : 'SOUND OFF';
  const daily = store.get('daily-' + todayKey(), null);
  $('daily-done').hidden = daily === null;
  if (daily !== null) $('daily-done').textContent = daily + ' PTS ✓';
  const best = store.get('best', 0), games = store.get('games', 0);
  $('home-stats').textContent = games
    ? `Best round: ${best} pts · ${games} game${games===1?'':'s'} played`
    : 'Find words. Longer = more points!';
}
$('btn-sound').addEventListener('click', () => { P.sound = !P.sound; store.set('sound', P.sound); refreshHome(); if (P.sound) snd.tick(3); });
$('btn-host').addEventListener('click', () => hostParty());
$('btn-join').addEventListener('click', () => { $('code-input').value = ''; show('join'); setTimeout(()=>$('code-input').focus(), 80); });
$('btn-join-back').addEventListener('click', () => show('home'));
$('btn-solo').addEventListener('click', () => startLocal('solo'));
$('btn-daily').addEventListener('click', () => startLocal('daily'));

/* ---------------- join ---------------- */
$('code-input').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g,'');
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
  if (asHost) G.cfg = store.get('cfg', {g:4, t:90, m:3, r:3});

  // More relays than the default 5 — each one is an extra chance for two phones
  // to find each other, which is what makes joiners show up reliably.
  const room = Trystero.joinRoom({appId:'boggleflix-party-v1', relayConfig:{redundancy: 12}}, 'bfp-' + code.toLowerCase());
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
    maybeFinishCollection();
    if (!G.playing) renderStandings();
  };
  A.again.onMessage = () => { if (!G.isHost) resetToLobby(); };

  clearInterval(G.gossipTimer);
  G.gossipTimer = setInterval(() => { if (G.net) G.net.A.sync.send(syncPayload()); }, GOSSIP_MS);
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
  return {
    g: pick(+d.g, [4,5,6], 4),
    t: pick(+d.t, [30,60,90,120,180], 90),
    m: pick(+d.m, [3,4,5,6], 3),
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
  $('lobby-status').textContent = count <= 1
    ? 'Waiting for players — share the code! (You can also start solo.)'
    : count + ' players in — waiting for the host to start!';
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
  return {seeds: G.seeds, cfg: G.cfg, round: G.round, startAt: G.startAt, hostNow: Date.now()};
}
function hostStartGame(){
  const rnd = Math.random().toString(36).slice(2,8);
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
  G.seeds = d.seeds || [];
  G.cfg = sanitizeCfg(d.cfg || {});
  G.round = d.round || 0;
  G.clockOffset = (d.hostNow || Date.now()) - Date.now();
  G.startAt = (d.startAt || Date.now()) - G.clockOffset;
  G.finsSelf = {};
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
    G.cfg = {g:4, t:90, m:3, r:1};
    G.seeds = ['bfp-daily-' + todayKey()];
  } else {
    G.cfg = sanitizeCfg(store.get('cfg', {g:4, t:90, m:3, r:1}));
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
  const late = Date.now() > G.startAt - 400;
  G.spectating = G.mode === 'party' && Date.now() > G.startAt + 3000;
  G.n = G.cfg.g;
  G.adj = adjacency(G.n);
  G.board = genBoard(G.seeds[G.round], G.n);
  G.path = []; G.found = new Map(); G.score = 0; G.possible = null;
  G.playing = false;
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
  requestWake();
  store.set('games', store.get('games',0) + 1);

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
function fitTiles(){
  const r = boardEl.getBoundingClientRect();
  const ts = r.width / G.n;
  boardEl.style.setProperty('--tilefs', Math.floor(ts * (G.n === 6 ? .44 : .5)) + 'px');
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
  if (left <= 0){ roundOver(false); return; }
  G.raf = requestAnimationFrame(tickTimer);
}

/* input */
function cellFromPoint(x, y, starting){
  const r = boardEl.getBoundingClientRect();
  const ts = r.width / G.n;
  const c = Math.floor((x - r.left) / ts), row = Math.floor((y - r.top) / ts);
  if (c < 0 || c >= G.n || row < 0 || row >= G.n) return -1;
  const cx = r.left + (c + .5) * ts, cy = r.top + (row + .5) * ts;
  if (Math.hypot(x - cx, y - cy) > ts * (starting ? .5 : .37)) return -1;
  return row * G.n + c;
}
function wordFromPath(){ return G.path.map(i => G.board[i]).join(''); }
const SVG_NS = 'http://www.w3.org/2000/svg';
function drawPath(){
  const r = boardEl.getBoundingClientRect();
  pathSvg.setAttribute('viewBox', '0 0 ' + r.width + ' ' + r.height);
  pathSvg.replaceChildren();
  if (!G.path.length) return;
  const ts = r.width / G.n;
  const pts = G.path.map(i => ((i%G.n+.5)*ts) + ',' + ((Math.floor(i/G.n)+.5)*ts)).join(' ');
  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', pts);
  line.setAttribute('fill','none');
  line.setAttribute('stroke','#FF2E63');
  line.setAttribute('stroke-width', ts*.15);
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
boardEl.addEventListener('pointerdown', e => {
  if (!G.playing || G.activePointer !== null) return;
  e.preventDefault();
  const i = cellFromPoint(e.clientX, e.clientY, true);
  if (i < 0) return;
  G.activePointer = e.pointerId;
  try { boardEl.setPointerCapture(e.pointerId); } catch(err){}
  G.path = []; addToPath(i);
});
/* Track and end the stroke on the window rather than the board. A finger that
   lifts past the edge of the tray — or a pointer capture the browser quietly
   drops — never delivers pointerup to the board itself, which used to leave
   activePointer set forever and silently swallow every word after the first. */
window.addEventListener('pointermove', e => {
  if (!G.playing || e.pointerId !== G.activePointer || !G.path.length) return;
  e.preventDefault();
  const i = cellFromPoint(e.clientX, e.clientY, false);
  if (i < 0) return;
  const last = G.path[G.path.length-1];
  if (i === last) return;
  if (G.path.length > 1 && i === G.path[G.path.length-2]){ G.path.pop(); setSel(); return; }
  if (!G.path.includes(i) && G.adj[last].includes(i)) addToPath(i);
}, {passive: false});
function endStroke(e){
  if (e.pointerId !== G.activePointer) return;
  G.activePointer = null;
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
  const r = boardEl.getBoundingClientRect(), ts = r.width/G.n;
  const d = el('div','float-pop', text);
  d.style.left = ((tileIdx%G.n+.5)*ts) + 'px';
  d.style.top = (Math.floor(tileIdx/G.n)*ts) + 'px';
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
  const fin = {r: G.round, s: G.score, w: G.found.size, b: best ? best[0] : '', bp: best ? best[1] : 0};
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
function routeAfterRound(){
  const last = G.round >= G.cfg.r - 1;
  if (G.mode !== 'party'){ renderLocalResults(); show('standings'); return; }
  if (last){ renderPodium(); show('podium'); snd.fanfare(); confettiBurst(); }
  else { renderStandings(); show('standings'); }
}
function maybeFinishCollection(){ // a straggler's report arrived — refresh whichever results screen is up
  if (G.playing) return;
  if ($('scr-standings').classList.contains('active')) renderStandings();
  if ($('scr-podium').classList.contains('active')) renderPodium();
}

function totalsFor(id, p){
  let total = 0;
  const rounds = G.cfg.r;
  for (let r=0;r<rounds;r++){
    const f = p.me ? G.finsSelf[r] : p.fin && p.fin[r];
    if (f) total += f.s;
    else if (p.sc && p.sc[r]) total += p.sc[r];
  }
  return total;
}
function renderStandings(){
  if (G.mode !== 'party') return;
  $('stand-title').textContent = 'Round ' + (G.round+1) + ' results';
  $('local-extras').hidden = true;
  $('btn-share-daily').hidden = true;
  $('btn-stand-again').hidden = true;
  const rows = everyone().map(([id,p]) => {
    const f = p.me ? G.finsSelf[G.round] : p.fin && p.fin[G.round];
    return {id, p, f, score: f ? f.s : (p.sc && p.sc[G.round]) || 0, total: totalsFor(id,p)};
  }).sort((a,b) => b.score - a.score);
  const list = $('stand-list'); list.replaceChildren();
  rows.forEach((r,i) => {
    const row = el('div','stand-row' + (i===0 && r.score>0 ? ' first' : '') + (r.p.me ? ' me' : '') + (!r.f && !r.p.gone && !r.p.me ? ' pending' : ''));
    row.appendChild(el('span','rank', ['🥇','🥈','🥉'][i] || (i+1)+''));
    const face = el('span','face', r.p.emoji); face.style.setProperty('--c', colorOf(r.id));
    row.appendChild(face);
    const info = el('div','info');
    info.appendChild(el('b','', r.p.me ? r.p.name + ' (you)' : r.p.name));
    info.appendChild(el('small','', r.f && r.f.b ? 'best: ' + r.f.b.toUpperCase() + ' +' + r.f.bp + ' · ' + r.f.w + ' words' : (r.p.gone ? 'left the party' : r.f ? r.f.w + ' words' : 'finishing…')));
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
function renderStandingsCtas(){ if ($('scr-standings').classList.contains('active')) renderStandings(); }
$('btn-next-round').addEventListener('click', () => { if (G.isHost) hostNextRound(); });

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
function renderPodium(){
  if (G.mode !== 'party') return;
  const rows = everyone().map(([id,p]) => ({id, p, total: totalsFor(id,p)})).sort((a,b) => b.total - a.total);
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
    row.appendChild(info);
    row.appendChild(el('span','pts', String(r.total)));
    rest.appendChild(row);
  });
  // awards
  const aw = $('awards'); aw.replaceChildren();
  let longest = null, most = null;
  for (const r of rows){
    for (let rd=0; rd<G.cfg.r; rd++){
      const f = r.p.me ? G.finsSelf[rd] : r.p.fin && r.p.fin[rd];
      if (!f) continue;
      if (f.b && (!longest || f.b.length > longest.word.length)) longest = {name:r.p.name, word:f.b};
      if (!most || f.w > most.count){ /* accumulate below */ }
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
  $('btn-again').hidden = !G.isHost;
  $('podium-wait').hidden = G.isHost;
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
