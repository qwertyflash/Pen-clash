// Online play.
//
// The host runs the real match. It publishes a small state object `st` whenever
// something changes (and at least once a second), including the last shot: where the
// pens started and the flick that was applied. Guests replay that shot with the same
// physics code, so motion is smooth on every screen without streaming positions, and
// then snap to the host's final positions when the shot ends.
//
// A guest sends its own flick as `fl` and keeps re-sending it until the host
// acknowledges it (`st.fa`). It also predicts its own shot immediately.
import { PROTOCOL, MAXJ } from '../core/constants.js';
import { $, clamp, num } from '../core/util.js';
import { flickPen } from '../core/physics.js';
import { sfx } from '../ui/audio.js';
import { safeAv, shrink } from '../ui/avatars.js';
import { show, banner } from '../ui/screens.js';
import { joinNetRoom } from '../net/index.js';
import { S, isAuth } from './state.js';
import { newGame, placePens, startMatch, doFlick, showResult, onEvent, clearTimers, resetSimClock } from './match.js';

const VERSION_MSG = 'Your friend is on a different version of Pen Clash. Both of you: refresh the page (Ctrl+Shift+R or pull down to reload), then try again.';
const HOST_KEEPALIVE = 1, HOST_MIN_GAP = 0.1, FLICK_RESEND_MS = 800, RESYNC_MS = 2500;

export const stat = (t) => { $('#netStatus').textContent = t; };

/* ---------- screen wake lock ---------- */
let wl = null;
function wake() {
  try {
    if (navigator.wakeLock && !wl && document.visibilityState === 'visible')
      navigator.wakeLock.request('screen').then((l) => { wl = l; l.addEventListener('release', () => { wl = null; }); }).catch(() => {});
  } catch { /* */ }
}
document.addEventListener('visibilitychange', () => { if (S.net && S.net.started) wake(); });

/* ---------- lobby ---------- */
let joinToken = 0;

export function leaveNet() {
  joinToken++;
  try { wl && wl.release(); } catch { /* */ }
  wl = null;
  const net = S.net;
  if (net) {
    try { net.un && net.un(); } catch { /* */ }
    net.nr.leave().catch(() => {});
    clearTimeout(net.to);
    S.net = null;
  }
}

export function lobbyReset() {
  leaveNet();
  $('#lobbyStart').hidden = false; $('#lobbyWait').hidden = true; stat('');
}

export async function joinRoom(code, role) {
  leaveNet();
  const tok = ++joinToken;
  stat('Connecting…');
  try {
    const nr = await joinNetRoom(code, role, (t) => { if (tok === joinToken) stat(t); });
    if (tok !== joinToken) { nr.leave(); return; }
    S.net = {
      nr, role, code, flN: Date.now(), rmN: Date.now(), lastFl: 0, lastRm: 0, opp: null, hostId: null,
      started: false, acc: 0, keep: 0, me: null, pf: null, pfAt: 0, hostAt: 0, lastSt: null, rsAt: 0, aimAt: 0,
    };
    const cfg = S.cfg[0];
    let av = await shrink(cfg.av, 44, 0.6);
    const base = { role, name: cfg.name, pen: cfg.pen, v: PROTOCOL };
    try { await nr.presence({ ...base, av }); }
    catch { av = await shrink(cfg.av, 28, 0.5); await nr.presence({ ...base, av }).catch(() => nr.presence(base)); }
    if (tok !== joinToken) return;
    $('#lobbyStart').hidden = true; $('#lobbyWait').hidden = false; $('#codeBig').textContent = code;
    const via = nr.transport === 'server' ? 'the game server' : 'the relay';
    stat(role === 'host' ? 'Connected to ' + via + '. Waiting for your opponent to join with this code…' : 'Connected to ' + via + '. Looking for the host of ' + code + '…');
    if (role === 'guest') S.net.to = setTimeout(() => {
      if (S.net && !S.net.started) stat('No host found for ' + code + '. Make sure you both opened the same link, and the host’s screen is still showing this code.');
    }, 12000);
    S.net.un = nr.onPeers(onPeers);
  } catch (e) {
    if (tok !== joinToken) return;
    leaveNet();
    stat(e && e.message ? e.message : 'Could not join: unknown error');
  }
}

function oppLeft(msg) {
  const net = S.net;
  if (!net) return;
  net.started = false; net.opp = null; net.hostId = null;
  clearTimers();
  S.G = null;
  $('#result').hidden = true;
  show('online');
  $('#lobbyStart').hidden = true; $('#lobbyWait').hidden = false;
  stat(msg);
}

function onPeers(ch) {
  const net = S.net;
  if (!net) return;
  const P = ch.peers;
  const me = P.find((p) => p.sameTab);
  if (me) net.me = me.peer;
  if (net.role === 'host') {
    const g = net.opp && P.find((p) => p.peer === net.opp);
    if (!g) {
      if (net.opp) oppLeft('Your opponent left. Waiting for someone to join with the code…');
      const cand = P.filter((p) => !p.sameTab && p.presence && p.presence.role === 'guest');
      const ok = cand.find((p) => p.presence.v === PROTOCOL);
      if (ok) hostStart(ok); else if (cand.length) stat(VERSION_MSG);
      return;
    }
    hostRead(g);
  } else {
    // Keep following the same host even while its presence is being re-sent.
    const h = (net.hostId && P.find((p) => p.peer === net.hostId)) || P.find((p) => !p.sameTab && p.presence && p.presence.role === 'host');
    if (!h) { if (net.started) oppLeft('The host left the match.'); return; }
    clearTimeout(net.to);
    if (h.presence.role && h.presence.v !== PROTOCOL) {
      if (net.started) oppLeft(VERSION_MSG); else stat(VERSION_MSG);
      return;
    }
    net.hostId = h.peer;
    guestRead(h, P);
  }
}

const remotePl = (pr, local) => ({ name: String(pr.name || 'Player').slice(0, 14), pen: clamp(pr.pen | 0, 0, 5), av: safeAv(pr.av), local });

/* ---------- host ---------- */
function hostStart(g) {
  const net = S.net, gp = g.presence;
  net.opp = g.peer; net.started = true;
  net.lastFl = num(gp.fl && gp.fl.n, 0, 1e15);
  net.lastRm = num(gp.rm, 0, 1e15);
  newGame('online', [{ ...S.cfg[0], local: true }, remotePl(gp, false)]);
  S.G.me = 0;
  wake(); show('game'); stat('');
  startMatch();
}

function hostRead(g) {
  const net = S.net, G = S.G, gp = g.presence || {};
  if (!G) return;
  const rp = remotePl(gp, false);
  if (G.phase === 'over' || (G.rd === 1 && G.phase === 'between')) { G.pl[1].name = rp.name; G.pl[1].av = rp.av; }
  const fl = gp.fl;
  if (fl && typeof fl.n === 'number' && fl.n > net.lastFl) {
    // Acknowledge every new flick (st.fa), even one that arrives too late to use.
    net.lastFl = fl.n; G.dirty = true;
    if (G.phase === 'aim' && G.turn === 1)
      doFlick(1, num(fl.t, -0.45, 0.45), num(fl.jx, -MAXJ, MAXJ), num(fl.jy, -MAXJ, MAXJ), fl.n);
  }
  if (typeof gp.rm === 'number' && gp.rm > net.lastRm) { net.lastRm = gp.rm; if (G.phase === 'over') startMatch(); }
  const a = gp.aim;
  G.raim = Array.isArray(a) && G.phase === 'aim' && G.turn === 1 ? { i: 1, t: num(a[0], -0.45, 0.45), jx: num(a[1], -MAXJ, MAXJ), jy: num(a[2], -MAXJ, MAXJ) } : null;
}

const q3 = (v) => Math.round(v * 1000) / 1000;
function hostState() {
  const G = S.G, net = S.net;
  return {
    m: G.mid, ph: G.phase, t: G.turn, sc: G.sc, rd: G.rd, g: net.opp, w: G.winner, b: G.msg || null, fa: net.lastFl,
    p: G.pens.map((p) => [q3(p.x), q3(p.y), q3(p.a), p.alive ? 1 : 0]),
    sh: G.phase === 'moving' ? G.shot : null,
    a: G.aim && G.phase === 'aim' ? [+G.aim.t.toFixed(3), Math.round(G.aim.jx), Math.round(G.aim.jy)] : null,
  };
}

/** Called every sim tick while an online match exists. */
export function netTick(dt) {
  const net = S.net, G = S.G;
  if (!net) return;
  if (net.role !== 'host') { guestNet(); return; }
  net.acc += dt; net.keep += dt;
  if (!net.started || !G) return;
  if ((G.dirty && net.acc >= HOST_MIN_GAP) || net.keep >= HOST_KEEPALIVE) {
    net.acc = 0; net.keep = 0; G.dirty = false;
    net.nr.presence({ st: hostState() }).catch(() => {});
  }
}

/* ---------- guest ---------- */
function guestNet() {
  const net = S.net;
  if (!net || !net.started) return;
  const now = performance.now();
  if (net.pf && now - net.pfAt > FLICK_RESEND_MS) { net.pfAt = now; net.nr.presence({ fl: { ...net.pf } }).catch(() => {}); }
  if (now - (net.hostAt || now) > RESYNC_MS && now - net.rsAt > RESYNC_MS) { net.rsAt = now; net.nr.resync(); }
}

/** Put every pen exactly where the host last said it is. */
function snapToAuth() {
  const G = S.G;
  if (!G.auth) return;
  G.pens.forEach((p, i) => {
    const q = G.auth[i];
    if (!q) return;
    p.x = p.tx = q.x; p.y = p.ty = q.y; p.a = p.ta = q.a; p.vx = p.vy = p.w = 0;
  });
}

/** Replay a host shot from its recorded start positions. */
function startReplay(sh) {
  const G = S.G;
  if (!Array.isArray(sh.s)) return;
  sh.s.slice(0, 2).forEach((q, i) => {
    const p = G.pens[i];
    if (!Array.isArray(q)) return;
    const x = num(q[0], -2000, 3000), y = num(q[1], -2000, 3000);
    if (Math.hypot(x - p.x, y - p.y) > 2) p.tip = null; // don't draw an ink line for the jump
    p.x = p.tx = x; p.y = p.ty = y; p.a = p.ta = num(q[2], -1e7, 1e7); p.vx = p.vy = p.w = 0;
    const al = !!q[3];
    if (!al && p.alive) { p.alive = false; p.fall = 1; } else if (al && !p.alive) { p.alive = true; p.fall = 0; }
  });
  flickPen(G.pens[sh.i ? 1 : 0], num(sh.t, -0.45, 0.45), num(sh.jx, -MAXJ, MAXJ), num(sh.jy, -MAXJ, MAXJ));
  G.sim = true; G.simEnd = 0; resetSimClock();
  sfx.flick();
}

/** The guest flicks: tell the host, and start simulating our own shot right away. */
export function guestFlick(a) {
  const net = S.net, G = S.G;
  net.flN++;
  const pf = { n: net.flN, t: +a.t.toFixed(3), jx: Math.round(a.jx), jy: Math.round(a.jy) };
  net.pf = pf; net.pfAt = performance.now();
  net.nr.presence({ fl: pf, aim: null }).catch(() => {});
  G.aim = null;
  snapToAuth();
  flickPen(G.pens[a.i], clamp(pf.t, -0.45, 0.45), pf.jx, pf.jy);
  G.sim = true; G.simEnd = 0; G.pred = pf.n; G.phase = 'moving'; resetSimClock();
  sfx.flick();
}

/** Throttled live aim preview for the host's screen. */
export function guestAim(aim) {
  const net = S.net, now = performance.now();
  if (!net || now - net.aimAt < 90) return;
  net.aimAt = now;
  net.nr.presence({ aim }).catch(() => {});
}

function guestRead(h, P) {
  const net = S.net;
  const st = h.presence.st;
  if (!st || typeof st !== 'object' || !Array.isArray(st.p)) { if (!S.G) stat('Connected. Waiting for the host to start…'); return; }
  if (st !== net.lastSt) { net.lastSt = st; net.hostAt = performance.now(); }
  const spec = st.g !== net.me;
  if (net.pf && typeof st.fa === 'number' && st.fa >= net.pf.n) net.pf = null;

  let G = S.G;
  if (!G || G.mid !== st.m) {
    const other = spec ? P.find((p) => p.peer === st.g) : null;
    newGame('online', [remotePl(h.presence, false), spec ? remotePl((other && other.presence) || {}, false) : { ...S.cfg[0], local: true }]);
    G = S.G; G.mid = st.m; G.me = spec ? -1 : 1; G.lastRd = -1;
    wake(); placePens(); net.started = true; show('game'); stat('');
  }
  G.pl[0].name = remotePl(h.presence).name; G.pl[0].av = safeAv(h.presence.av);
  if (st.rd !== G.lastRd) { G.lastRd = st.rd; placePens(); G.sim = false; G.pred = 0; }

  const ph = ['aim', 'moving', 'between', 'over', 'idle'].includes(st.ph) ? st.ph : 'idle';
  G.turn = st.t ? 1 : 0;
  G.sc = [num(st.sc && st.sc[0], 0, 3), num(st.sc && st.sc[1], 0, 3)];
  G.rd = num(st.rd, 1, 99, 1);
  G.auth = st.p.slice(0, 2).map((q) => (Array.isArray(q) ? { x: num(q[0], -2000, 3000), y: num(q[1], -2000, 3000), a: num(q[2], -1e7, 1e7), alive: !!q[3] } : null));

  // A new shot: replay it, unless it is the one we already predicted.
  const sh = st.sh;
  if (sh && typeof sh === 'object' && typeof sh.n === 'number' && sh.n !== G.lastShot && ph === 'moving') {
    G.lastShot = sh.n;
    if (!(G.pred && sh.fl === G.pred)) startReplay(sh);
    G.pred = 0;
  }
  // Host acknowledged our flick but did not use it: drop the prediction.
  if (G.pred && !net.pf && ph !== 'moving') { G.pred = 0; G.sim = false; }

  let phase = ph;
  if (phase === 'aim' && G.turn === 1 && !spec && net.pf) phase = 'moving'; // our shot is on its way
  G.phase = phase;
  if (G.sim && ph !== 'moving' && !G.simEnd) G.simEnd = performance.now() + 1500;

  if (Array.isArray(st.b) && st.b[0] !== G.lastB) { G.lastB = st.b[0]; banner(String(st.b[1]).slice(0, 60), 1300); }
  G.raim = Array.isArray(st.a) && G.phase === 'aim' && G.turn === 0 ? { i: 0, t: num(st.a[0], -0.45, 0.45), jx: num(st.a[1], -MAXJ, MAXJ), jy: num(st.a[2], -MAXJ, MAXJ) } : null;
  if (G.phase === 'over' && $('#result').hidden) { G.winner = st.w ? 1 : 0; showResult(); }
  else if (G.phase !== 'over') $('#result').hidden = true;
}

/** Per-frame guest update: ease pens to the host's positions when no replay is running. */
export function guestTick(dt) {
  const G = S.G;
  if (!G.sim && G.phase !== 'moving' && G.auth) {
    G.pens.forEach((p, i) => {
      const q = G.auth[i];
      if (!q) return;
      p.tx = q.x; p.ty = q.y; p.ta = q.a;
      if (p.alive && !q.alive) { p.alive = false; onEvent({ t: 'fall', i, x: p.x, y: p.y }); }
      else if (!p.alive && q.alive) { p.alive = true; p.fall = 0; p.x = q.x; p.y = q.y; p.a = q.a; p.tip = null; }
    });
  }
  const k = 1 - Math.exp(-dt * 16);
  for (const p of G.pens) {
    if (!G.sim) { p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; p.a += (p.ta - p.a) * k; }
    if (!p.alive) p.fall = Math.min(1, p.fall + dt * 1.7);
  }
}

/* ---------- rematch ---------- */
export function requestRematch() {
  const net = S.net;
  net.rmN++;
  net.nr.presence({ rm: net.rmN }).catch(() => {});
  $('#rNote').textContent = 'Rematch requested. Starting when the host’s page picks it up…';
}

/* ---------- connection status ---------- */
/** { text, bad } for the little label under the hint, or null offline. */
export function connLabel() {
  const net = S.net, G = S.G;
  if (!net || !G || G.mode !== 'online') return null;
  const peer = net.role === 'host' ? net.opp : net.hostId;
  if (!peer) return null;
  const r = net.nr.route(peer), seen = net.nr.lastSeen(peer);
  const lost = seen > 5000 || (!isAuth() && performance.now() - net.hostAt > 4000);
  const path = r.path === 'direct' ? 'Direct link' : r.path === 'server' ? 'Game server' : 'Relay';
  return { text: lost ? 'Connection lost, reconnecting…' : path + (r.rtt != null ? ' · ' + r.rtt + ' ms' : ''), bad: lost };
}

export function debugText() {
  const net = S.net, G = S.G;
  const lines = ['Pen Clash protocol v' + PROTOCOL];
  if (net) {
    const peer = net.role === 'host' ? net.opp : net.hostId;
    const r = peer ? net.nr.route(peer) : {};
    lines.push(
      'role: ' + net.role + '  code: ' + net.code + '  transport: ' + net.nr.transport + (r.host ? ' (' + r.host + ')' : ''),
      'me: ' + net.me + '  peer: ' + (peer || '-') + '  path: ' + (r.path || '-') + '  rtt: ' + (r.rtt ?? '-') + ' ms',
      'peer last heard: ' + (peer ? Math.round(net.nr.lastSeen(peer)) + ' ms ago' : '-'),
    );
    if (net.role === 'host') lines.push('last guest flick: ' + net.lastFl);
    else lines.push('host state age: ' + (net.hostAt ? Math.round(performance.now() - net.hostAt) : '-') + ' ms  pending flick: ' + (net.pf ? net.pf.n : 'none'));
  } else lines.push('offline');
  if (G) lines.push('phase: ' + G.phase + '  turn: ' + G.turn + '  round: ' + G.rd + '  score: ' + G.sc.join('-') + '  shot: ' + (G.shot ? G.shot.n : G.lastShot) + '  replaying: ' + G.sim);
  if (S.errors.length) lines.push('errors:', ...S.errors.slice(-5));
  return lines.join('\n');
}
