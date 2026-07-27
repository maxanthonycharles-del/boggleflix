/* ================================================================
   MQTT message bus — a drop-in replacement for the slice of the
   Trystero API this game uses (Trystero.selfId / joinRoom / room.makeAction /
   room.onPeerJoin / onPeerLeave / leave).

   Why: the old transport was WebRTC (phones connecting directly). That needs a
   TURN relay whenever two phones can't reach each other directly — different
   networks, cellular, or a home router with client-isolation on — and every
   free TURN server is now dead, so those players got "can't find the party".

   This routes every (tiny) game message through public MQTT brokers instead:
   each phone just opens an outbound secure WebSocket to a shared broker and
   publishes/subscribes on a topic named after the room code. No NAT traversal,
   no TURN, works on any network incl. cellular. We connect to two brokers for
   redundancy and de-duplicate by message id, so one broker flaking doesn't drop
   the party.
   ================================================================ */
(function (global) {
  'use strict';
  var mqtt = global.mqtt;
  function hex(n){ var s=''; for (var i=0;i<n;i++) s += Math.floor(Math.random()*16).toString(16); return s; }
  var selfId = hex(16);

  // Two independent, reliable public brokers. Both were verified to deliver
  // messages between separate clients in well under a second. Redundancy means
  // a party survives one broker going down or rate-limiting.
  var BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];

  var HEARTBEAT_MS = 3000;   // presence ping cadence
  var PEER_TTL_MS  = 13000;  // silence before we treat a peer as gone

  function joinRoom(config, roomId) {
    var appId = (config && config.appId) || 'app';
    var topic = 'bfx/' + appId + '/' + roomId;      // everyone in this room shares it
    var clients = [];
    var actions = {};                                // name -> { fn }
    var peers = new Map();                           // peerId -> lastSeen ms
    var onJoin = null, onLeave = null;
    var seen = new Set(), seenQ = [];                // msg-id dedup across brokers
    var alive = true;

    function publish(obj) {
      var raw = JSON.stringify(obj);
      for (var i = 0; i < clients.length; i++) {
        var c = clients[i];
        if (c && c.connected) { try { c.publish(topic, raw, { qos: 0 }); } catch (e) {} }
      }
    }
    function handle(payloadStr) {
      var m; try { m = JSON.parse(payloadStr); } catch (e) { return; }
      if (!m || m.s === selfId) return;              // ignore our own echoes
      if (m.i) {                                     // dedup (two brokers deliver each msg twice)
        if (seen.has(m.i)) return;
        seen.add(m.i); seenQ.push(m.i);
        if (seenQ.length > 600) seen.delete(seenQ.shift());
      }
      touch(m.s);
      if (m.c === '__bye') { drop(m.s); return; }
      if (m.c === '__hi') return;                    // presence only
      if (m.to && m.to !== selfId) return;           // targeted at someone else
      var act = actions[m.c];
      if (act && act.fn) act.fn(m.d, { peerId: m.s });
    }
    function touch(id) {
      if (!id || id === selfId) return;
      var isNew = !peers.has(id);
      peers.set(id, Date.now());
      if (isNew && onJoin) { try { onJoin(id); } catch (e) {} }
    }
    function drop(id) {
      if (peers.has(id)) { peers.delete(id); if (onLeave) { try { onLeave(id); } catch (e) {} } }
    }

    BROKERS.forEach(function (url) {
      var c;
      try {
        c = mqtt.connect(url, {
          clientId: 'bfx-' + hex(10),
          clean: true, keepalive: 30, reconnectPeriod: 3000, connectTimeout: 9000
        });
      } catch (e) { return; }
      c.on('connect', function () { try { c.subscribe(topic, { qos: 0 }); publish({ c: '__hi', s: selfId, i: hex(8) }); } catch (e) {} });
      c.on('message', function (_t, payload) { handle(payload.toString()); });
      c.on('error', function () {});                 // reconnectPeriod handles retries
      clients.push(c);
    });

    // Presence: ping regularly, and reap peers we stop hearing from.
    var hb = setInterval(function () { if (alive) publish({ c: '__hi', s: selfId, i: hex(8) }); }, HEARTBEAT_MS);
    // Extra rapid pings right after joining so existing members greet us fast
    // even if a broker connection was still warming up on our first heartbeat.
    var burst = 0, burstT = setInterval(function () { publish({ c: '__hi', s: selfId, i: hex(8) }); if (++burst >= 6) clearInterval(burstT); }, 700);
    var reap = setInterval(function () {
      var now = Date.now();
      peers.forEach(function (ts, id) { if (now - ts > PEER_TTL_MS) drop(id); });
    }, 3000);

    return {
      makeAction: function (name) {
        var act = actions[name] || (actions[name] = { fn: null });
        return {
          send: function (data, opts) {
            publish({ c: name, s: selfId, d: data, to: opts && opts.target, i: hex(8) });
          },
          set onMessage(fn) { act.fn = fn; },
          get onMessage() { return act.fn; }
        };
      },
      set onPeerJoin(fn) { onJoin = fn; },
      get onPeerJoin() { return onJoin; },
      set onPeerLeave(fn) { onLeave = fn; },
      get onPeerLeave() { return onLeave; },
      getPeers: function () { var o = {}; peers.forEach(function (_ts, id) { o[id] = {}; }); return o; },
      leave: function () {
        alive = false;
        publish({ c: '__bye', s: selfId, i: hex(8) });
        clearInterval(hb); clearInterval(reap); clearInterval(burstT);
        setTimeout(function () { clients.forEach(function (c) { try { c.end(true); } catch (e) {} }); }, 200);
      }
    };
  }

  global.Trystero = { selfId: selfId, joinRoom: joinRoom };
})(window);
