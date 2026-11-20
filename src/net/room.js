// A small "room presence" protocol on top of any broadcast bus.
//
// Every client owns a presence object (name, avatar, game state...). Clients send
// deltas ('u'), full snapshots ('f'), heartbeats ('b') and goodbyes ('x'). The game
// only ever reads the merged presence of every peer, so a lost delta is repaired by
// the next snapshot.
//
// When both ends support it, the room also opens a direct WebRTC link to each peer
// and sends presence over that instead of the relay. Every presence message carries a
// per-sender sequence number so copies that arrive twice (relay + direct) or late are
// ignored.
import { createLink, p2pSupported } from './p2p.js';

const HB_MS = 2000, STALE_MS = 12000, LINK_IDLE_MS = 7000, LINK_RETRY_MS = 20000;

export function createRoom(bus, myId, { p2p = true } = {}) {
  const mine = {}, others = new Map(), links = new Map(), linkFailedAt = new Map(), rtt = new Map();
  let handlers = [], nq = 0, pend = null, pt = 0, pendAt = 0, dead = false, seq = 0, lastHb = 0;
  // Presence version: bumped on every change. Deltas say which version they build on, and
  // heartbeats carry the latest, so a peer that missed a delta notices and asks for a snapshot.
  let pv = 0, sentPv = 0;
  const useP2P = p2p && p2pSupported();
  if (useP2P) mine.rtc = 1;

  const list = () => [
    { peer: myId, sameTab: true, presence: mine },
    ...[...others].map(([id, o]) => ({ peer: id, sameTab: false, presence: o.p })),
  ];
  const fire = () => { if (nq) { clearTimeout(nq); nq = 0; } const ps = list(); handlers.forEach((h) => { try { h({ peers: ps }); } catch (e) { console.error(e); } }); };
  const notify = () => { if (!nq) nq = setTimeout(fire, 0); };

  const openLink = (id) => { const l = links.get(id); return l && l.open ? l : null; };

  /** Send a presence message to everyone, over direct links where open, else the relay. */
  const out = (m) => {
    m.id = myId; m.s = ++seq;
    const s = JSON.stringify(m);
    let relay = others.size === 0 || m.k === 'b';
    for (const id of others.keys()) { const l = openLink(id); if (l) l.send(s); else relay = true; }
    if (relay) bus.send(s);
  };
  /** Send a message to one peer only (signalling, pings). */
  const direct = (to, m, viaRelay = false) => {
    m.id = myId; m.to = to;
    const s = JSON.stringify(m), l = !viaRelay && openLink(to);
    if (l) l.send(s); else bus.send(s);
  };
  const full = (hello) => {
    // A snapshot includes any change still waiting to be sent.
    clearTimeout(pt); pt = 0; pend = null; sentPv = pv;
    out({ k: 'f', p: mine, pv, ...(hello ? { hello: 1 } : {}) });
  };
  const merge = (o, q) => {
    if (!q || typeof q !== 'object') return;
    for (const k of Object.keys(q)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue; if (q[k] === null) delete o[k]; else o[k] = q[k]; }
  };
  const flush = () => { clearTimeout(pt); pt = 0; if (!pend) return; const q = pend; pend = null; out({ k: 'u', p: q, pv, pp: sentPv }); sentPv = pv; };

  const dropPeer = (id) => {
    others.delete(id); rtt.delete(id);
    const l = links.get(id); if (l) { links.delete(id); l.close(); }
    notify();
  };

  function maybeLink(id) {
    if (!useP2P || links.has(id) || myId > id) return; // the lower id makes the offer
    const o = others.get(id);
    if (!o || !o.full || !o.p.rtc) return;
    if (performance.now() - (linkFailedAt.get(id) || -1e9) < LINK_RETRY_MS) return;
    links.set(id, newLink(id, true));
  }
  function newLink(id, initiator) {
    const link = createLink(initiator, (d) => direct(id, { k: 'sig', d }, true), {
      onOpen: () => { full(false); notify(); },
      onMessage: (raw) => recv(raw),
      onClose: () => {
        if (links.get(id) === link) links.delete(id);
        linkFailedAt.set(id, performance.now());
        if (!dead) full(true); // resync everything over the relay
        notify();
      },
    });
    return link;
  }

  // We heard from a peer we have no snapshot of (e.g. we reconnected): ask, at most every 2 s.
  const askFull = (o, force) => { if (o.full && !force) return; const now = Date.now(); if (now - (o.asked || 0) > 2000) { o.asked = now; full(true); } };

  function recv(raw) {
    if (dead || typeof raw !== 'string' || raw.length > 300000) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || m.id === myId || m.id.length > 40) return;

    if (m.to !== undefined) {
      if (m.to !== myId) return;
      if (m.k === 'sig' && useP2P && m.d && typeof m.d === 'object') {
        let l = links.get(m.id);
        if (!l && m.d.sdp && m.d.sdp.type === 'offer') { l = newLink(m.id, false); links.set(m.id, l); }
        if (l) l.signal(m.d);
      } else if (m.k === 'ping') direct(m.id, { k: 'pong', t: m.t });
      else if (m.k === 'pong' && typeof m.t === 'number') rtt.set(m.id, Math.round(performance.now() - m.t));
      return;
    }

    let o = others.get(m.id);
    if (m.k === 'x') { if (o) dropPeer(m.id); return; }
    if (!o) { o = { p: {}, seen: 0, full: false, s: 0 }; others.set(m.id, o); }
    o.seen = Date.now();
    if (typeof m.s === 'number') { if (m.s <= o.s) return; o.s = m.s; }
    if (m.k === 'f') { o.p = {}; merge(o.p, m.p); o.full = true; o.pv = m.pv; if (m.hello) full(false); notify(); }
    else if (m.k === 'u') {
      merge(o.p, m.p);
      if (o.full && m.pp !== o.pv) askFull(o, true); // we missed a change in between
      else o.pv = m.pv;
      askFull(o); notify();
    }
    else if (m.k === 'b') askFull(o, o.full && typeof m.pv === 'number' && m.pv !== o.pv);
    maybeLink(m.id);
  }

  const beat = () => {
    const now = Date.now();
    if (now - lastHb < HB_MS) return;
    lastHb = now;
    out({ k: 'b', pv: sentPv });
    for (const [id, o] of others) {
      if (now - o.seen > STALE_MS) { dropPeer(id); continue; }
      const l = links.get(id);
      if (l && l.open && l.idleMs > LINK_IDLE_MS) l.close(); // silent direct link: fall back to relay
      direct(id, { k: 'ping', t: performance.now() });
    }
  };
  const hb = setInterval(beat, 1000);

  bus.onMessage(recv);
  bus.onReconnect(() => full(true));
  full(true);

  return {
    transport: bus.name,
    /** Merge q into my presence and broadcast the change (batched ~50 ms). */
    presence(q) {
      merge(mine, q); pv++;
      if (!pend) pendAt = performance.now();
      pend = Object.assign(pend || {}, q);
      if (!pt) pt = setTimeout(flush, 50);
      notify();
      return Promise.resolve();
    },
    onPeers(h) { handlers.push(h); notify(); return () => { handlers = handlers.filter((x) => x !== h); }; },
    peers: list,
    /** Called every sim tick so sending keeps working when timers are throttled. */
    pulse() { if (pend && performance.now() - pendAt >= 45) flush(); if (nq) fire(); beat(); },
    /** Ask everyone for a full snapshot. */
    resync() { full(true); },
    /** How we reach a peer: 'direct' or the bus name, plus round-trip time in ms. */
    route(id) { return { path: openLink(id) ? 'direct' : bus.name, rtt: rtt.get(id) ?? null, host: bus.host }; },
    /** Milliseconds since we last heard anything from a peer. */
    lastSeen(id) { const o = others.get(id); return o ? Date.now() - o.seen : Infinity; },
    leave() {
      dead = true; clearInterval(hb); clearTimeout(pt);
      for (const l of links.values()) l.close();
      bus.close(JSON.stringify({ k: 'x', id: myId }));
      return Promise.resolve();
    },
  };
}
