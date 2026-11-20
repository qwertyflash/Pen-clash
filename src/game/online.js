// Online play for 2-4 players.
//
// The host runs the real match. It publishes a small state object `st` whenever
// something changes (and at least once a second), including the last shot: where the
// pens started and the flick that was applied. Guests replay that shot with the same
// physics, so motion is smooth on every screen without streaming positions, and then
// snap to the host's final positions when the shot ends.
//
// A guest sends its own flick as `fl` and keeps re-sending it until the host
// acknowledges it (`st.fa[guestId]`). It also predicts its own shot immediately.
import { PROTOCOL, MAXJ, MAX_PLAYERS, WIN_ROUNDS } from '../core/constants.js';
import { $, clamp, esc, num } from '../core/util.js';
import { arenaById } from '../core/arenas.js';
import { flickPen, armShot, packPen, unpackExtras } from '../core/physics.js';
import { packBoosters, unpackBoosters } from '../core/boosters.js';
import { PENS } from '../core/constants.js';
import { sfx } from '../ui/audio.js';
import { PRE, safeAv, shrink } from '../ui/avatars.js';
import { show, banner } from '../ui/screens.js';
import { joinNetRoom } from '../net/index.js';
import { S, isAuth } from './state.js';
import { newGame, placePens, startMatch, doFlick, showResult, onEvent, clearTimers, resetSimClock, removePlayer, activeIdx, choosePen } from './match.js';

const VERSION_MSG = 'Someone is on a different version of Pen Clash. Everyone: refresh the page (Ctrl+Shift+R or pull down to reload), then try again.';
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
  $('#startBtn').hidden = true;
  $('#lobbyList').innerHTML = '';
  $('#lobbyArena').textContent = '';
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
      nr, role, code, flN: Date.now(), rmN: Date.now(), lastFl: {}, lastRm: {}, ids: [], hostId: null,
      started: false, acc: 0, keep: 0, me: null, pf: null, pfAt: 0, hostAt: 0, lastSt: null, rsAt: 0, aimAt: 0, lobbySig: '',
    };
    const cfg = S.cfg[0];
    let av = await shrink(cfg.av, 44, 0.6);
    const base = { role, name: cfg.name, pen: cfg.pen, v: PROTOCOL, ...(role === 'host' ? { ar: S.arena } : {}) };
    try { await nr.presence({ ...base, av }); }
    catch { av = await shrink(cfg.av, 28, 0.5); await nr.presence({ ...base, av }).catch(() => nr.presence(base)); }
    if (tok !== joinToken) return;
    $('#lobbyStart').hidden = true; $('#lobbyWait').hidden = false; $('#codeBig').textContent = code;
    const via = nr.transport === 'server' ? 'the game server' : 'the relay';
    stat(role === 'host' ? 'Connected to ' + via + '. Waiting for players to join with this code…' : 'Connected to ' + via + '. Looking for the host of ' + code + '…');
    if (role === 'guest') S.net.to = setTimeout(() => {
      if (S.net && !S.net.hostId) stat('No host found for ' + code + '. Make sure you all opened the same link, and the host’s screen is still showing this code.');
    }, 12000);
    S.net.un = nr.onPeers(onPeers);
    renderLobby([]);
  } catch (e) {
    if (tok !== joinToken) return;
    leaveNet();
    stat(e && e.message ? e.message : 'Could not join: unknown error');
  }
}

/** Back to the lobby after the match ended for us. */
function backToLobby(msg) {
  const net = S.net;
  if (!net) return;
  net.started = false; net.ids = []; net.hostId = null; net.lobbySig = '';
  clearTimers();
  S.G = null;
  $('#result').hidden = true;
  show('online');
  $('#lobbyStart').hidden = true; $('#lobbyWait').hidden = false;
  stat(msg);
  renderLobby(lastPeers);
  if (net.role === 'host' && /Waiting|left/.test(msg)) stat(msg);
}

/** Players waiting in the room, in the order they arrived. Host first. */
function lobbyPlayers(P) {
  const host = P.find((p) => p.presence && p.presence.role === 'host');
  const guests = P.filter((p) => p.presence && p.presence.role === 'guest');
  return host ? [host, ...guests] : guests;
}

function renderLobby(P) {
  const net = S.net;
  if (!net || net.started) return;
  const list = lobbyPlayers(P);
  const host = list[0] && list[0].presence.role === 'host' ? list[0] : null;
  const sig = JSON.stringify(list.map((p) => [p.peer, p.presence.name, p.presence.v, p.presence.ar]));
  if (sig === net.lobbySig) return;
  net.lobbySig = sig;
  $('#lobbyList').innerHTML = list.map((p, k) => {
    const pr = p.presence, old = pr.v !== PROTOCOL, seat = k < MAX_PLAYERS ? '' : ' · will watch';
    return `<li><img src="${safeAv(pr.av, PRE[k % PRE.length])}" alt=""><span>${esc(String(pr.name || 'Player').slice(0, 14))}${p.sameTab ? ' (you)' : ''}${pr.role === 'host' ? ' · host' : ''}${old ? ' · needs refresh' : seat}</span></li>`;
  }).join('');
  if (host) $('#lobbyArena').textContent = 'Arena: ' + arenaById(host.presence.ar).name;
  if (net.role === 'host') {
    const ready = list.filter((p) => !p.sameTab && p.presence.v === PROTOCOL).length;
    $('#startBtn').hidden = false;
    $('#startBtn').disabled = ready < 1;
    $('#startBtn').textContent = ready < 1 ? 'Waiting for players…' : `Start match (${Math.min(ready + 1, MAX_PLAYERS)} players)`;
    if (list.some((p) => p.presence.v !== PROTOCOL)) stat(VERSION_MSG);
  } else if (host) {
    stat(host.presence.v !== PROTOCOL ? VERSION_MSG : 'Connected. Waiting for the host to start the match…');
  }
}

let lastPeers = [];
function onPeers(ch) {
  const net = S.net;
  if (!net) return;
  const P = ch.peers;
  lastPeers = P;
  const me = P.find((p) => p.sameTab);
  if (me) net.me = me.peer;
  if (net.role === 'host') {
    if (!net.started) { renderLobby(P); return; }
    hostPeers(P);
  } else {
    // Keep following the same host even while its presence is being re-sent.
    const h = (net.hostId && P.find((p) => p.peer === net.hostId)) || P.find((p) => !p.sameTab && p.presence && p.presence.role === 'host');
    if (!h) { if (net.started) backToLobby('The host left the match.'); else renderLobby(P); return; }
    clearTimeout(net.to);
    net.hostId = h.peer;
    if (h.presence.role && h.presence.v !== PROTOCOL) { if (net.started) backToLobby(VERSION_MSG); else renderLobby(P); return; }
    if (!net.started) renderLobby(P);
    guestRead(h, P);
  }
}

const remotePl = (pr, local) => ({ name: String(pr.name || 'Player').slice(0, 14), pen: clamp(pr.pen | 0, 0, 5), av: safeAv(pr.av), local });

/* ---------- host ---------- */
export function hostStartMatch() {
  const net = S.net;
  if (!net || net.role !== 'host' || net.started) return;
  const guests = lobbyPlayers(lastPeers).filter((p) => !p.sameTab && p.presence.role === 'guest' && p.presence.v === PROTOCOL).slice(0, MAX_PLAYERS - 1);
  if (!guests.length) return;
  net.ids = [net.me, ...guests.map((g) => g.peer)];
  net.started = true;
  for (const g of guests) { net.lastFl[g.peer] = num(g.presence.fl && g.presence.fl.n, 0, 1e15); net.lastRm[g.peer] = num(g.presence.rm, 0, 1e15); }
  newGame('online', [{ ...S.cfg[0], local: true }, ...guests.map((g) => remotePl(g.presence, false))], S.arena);
  S.G.me = 0;
  $('#startBtn').hidden = true;
  wake(); show('game'); stat('');
  startMatch();
}

function hostPeers(P) {
  const net = S.net, G = S.G;
  if (!G) return;
  for (let k = 1; k < net.ids.length; k++) {
    if (G.pl[k].gone) continue;
    const g = P.find((p) => p.peer === net.ids[k]);
    if (!g) {
      banner(G.pl[k].name + ' left', 1500);
      removePlayer(k);
      if (activeIdx().length < 2) { backToLobby('Everyone else left. Waiting for players to join with the code…'); return; }
      continue;
    }
    hostRead(k, g);
  }
}

function hostRead(k, g) {
  const net = S.net, G = S.G, gp = g.presence || {}, id = g.peer;
  const rp = remotePl(gp, false);
  if (G.phase === 'over' || (G.rd === 1 && G.phase === 'between')) { G.pl[k].name = rp.name; G.pl[k].av = rp.av; }
  const fl = gp.fl;
  if (fl && typeof fl.n === 'number' && fl.n > (net.lastFl[id] || 0)) {
    // Acknowledge every new flick (st.fa), even one that arrives too late to use.
    net.lastFl[id] = fl.n; G.dirty = true;
    if (G.phase === 'aim' && G.turn === k)
      doFlick(k, num(fl.t, -0.45, 0.45), num(fl.jx, -MAXJ, MAXJ), num(fl.jy, -MAXJ, MAXJ), fl.n);
  }
  if (gp.pick && typeof gp.pick === 'object' && G.phase === 'pick') choosePen(k, gp.pick.pen, gp.pick.rd);
  if (typeof gp.rm === 'number' && gp.rm > (net.lastRm[id] || 0)) { net.lastRm[id] = gp.rm; if (G.phase === 'over') startMatch(); }
  if (G.turn === k) {
    const a = gp.aim;
    const next = Array.isArray(a) && G.phase === 'aim' ? { i: k, t: num(a[0], -0.45, 0.45), jx: num(a[1], -MAXJ, MAXJ), jy: num(a[2], -MAXJ, MAXJ) } : null;
    if (JSON.stringify(next) !== JSON.stringify(G.raim)) { G.raim = next; G.dirty = true; }
  }
}

function hostState() {
  const G = S.G, net = S.net;
  const aim = G.phase === 'aim' ? G.aim || G.raim : null;
  return {
    m: G.mid, ar: G.arena.id, ids: net.ids, pl: G.pl.map((p) => [p.name, p.pen]), gone: G.pl.map((p) => (p.gone ? 1 : 0)),
    ph: G.phase, t: G.turn, sc: G.sc, rd: G.rd, w: G.winner, b: G.msg || null, fa: net.lastFl,
    p: G.pens.map(packPen), bo: packBoosters(G.env), ink: G.env.flood,
    pk: G.pick ? { rd: G.pick.rd, last: G.pick.last, picks: G.pick.picks, left: Math.max(0, G.pick.until - Date.now()) } : null,
    sh: G.phase === 'moving' ? G.shot : null,
    a: aim ? [aim.i, +aim.t.toFixed(3), Math.round(aim.jx), Math.round(aim.jy)] : null,
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
    unpackExtras(p, q.raw);
  });
  if (G.authEnv) { G.env.boosters = G.authEnv.bo.map((b) => ({ ...b })); G.env.flood = G.authEnv.ink; }
}

const readFlood = (f) => (f && typeof f === 'object' && typeof f.col === 'string' && /^#[0-9a-f]{6}$/i.test(f.col) ? { col: f.col, i: f.i | 0, x: +f.x || 500, y: +f.y || 500 } : null);

/** Replay a host shot from its recorded start positions. */
function startReplay(sh) {
  const G = S.G;
  if (!Array.isArray(sh.s)) return;
  sh.s.slice(0, G.pens.length).forEach((q, i) => {
    const p = G.pens[i];
    if (!Array.isArray(q)) return;
    const x = num(q[0], -2000, 3000), y = num(q[1], -2000, 3000);
    if (Math.hypot(x - p.x, y - p.y) > 2) p.tip = null; // don't draw an ink line for the jump
    p.x = p.tx = x; p.y = p.ty = y; p.a = p.ta = num(q[2], -1e7, 1e7); p.vx = p.vy = p.w = 0;
    const al = !!q[3];
    if (!al && p.alive) { p.alive = false; p.fall = 1; } else if (al && !p.alive) { p.alive = true; p.fall = 0; }
    unpackExtras(p, q);
  });
  G.env.boosters = unpackBoosters(sh.bo);
  G.env.flood = readFlood(sh.ink);
  const i = clamp(sh.i | 0, 0, G.pens.length - 1);
  armShot(G.pens[i]);
  flickPen(G.pens[i], num(sh.t, -0.45, 0.45), num(sh.jx, -MAXJ, MAXJ), num(sh.jy, -MAXJ, MAXJ));
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
  armShot(G.pens[a.i]);
  flickPen(G.pens[a.i], clamp(pf.t, -0.45, 0.45), pf.jx, pf.jy);
  G.sim = true; G.simEnd = 0; G.pred = pf.n; G.phase = 'moving'; resetSimClock();
  sfx.flick();
}

/** The guest chose a pen for the coming round. */
export function guestPick(pen) {
  const net = S.net, G = S.G;
  if (!net || !G || !G.pick) return;
  net.myPick = { rd: G.pick.rd, pen };
  G.pick.picks[G.me] = pen;
  net.nr.presence({ pick: { rd: G.pick.rd, pen } }).catch(() => {});
}

/** Throttled live aim preview for everyone else's screen. */
export function guestAim(aim) {
  const net = S.net, now = performance.now();
  if (!net || now - net.aimAt < 90) return;
  net.aimAt = now;
  net.nr.presence({ aim }).catch(() => {});
}

function guestRead(h, P) {
  const net = S.net;
  const st = h.presence.st;
  if (!st || typeof st !== 'object' || !Array.isArray(st.p) || !Array.isArray(st.ids)) return;
  const n = st.ids.length;
  if (n < 2 || n > MAX_PLAYERS || st.p.length !== n || !Array.isArray(st.pl) || st.pl.length !== n) return;
  if (st !== net.lastSt) { net.lastSt = st; net.hostAt = performance.now(); }
  const seat = st.ids.indexOf(net.me);
  const myAck = st.fa && typeof st.fa === 'object' ? st.fa[net.me] : undefined;
  if (net.pf && typeof myAck === 'number' && myAck >= net.pf.n) net.pf = null;

  const avOf = (k) => {
    const pr = k === 0 ? h.presence : (P.find((p) => p.peer === st.ids[k]) || {}).presence;
    return safeAv(pr && pr.av, PRE[k % PRE.length]);
  };
  let G = S.G;
  if (!G || G.mid !== st.m) {
    const pl = st.pl.map((q, k) => ({
      name: String((Array.isArray(q) && q[0]) || 'Player').slice(0, 14), pen: clamp((Array.isArray(q) && q[1]) | 0, 0, 5), av: avOf(k), local: k === seat,
    }));
    if (seat > 0) Object.assign(pl[seat], { ...S.cfg[0], local: true });
    newGame('online', pl, st.ar);
    G = S.G; G.mid = st.m; G.me = seat > 0 ? seat : -1; G.lastRd = -1;
    wake(); placePens(); net.started = true; show('game'); stat('');
  }
  st.pl.forEach((q, k) => {
    if (k === G.me || !Array.isArray(q)) return;
    G.pl[k].name = String(q[0] || 'Player').slice(0, 14); G.pl[k].av = avOf(k);
  });
  if (Array.isArray(st.gone)) st.gone.forEach((g, k) => { if (G.pl[k]) G.pl[k].gone = !!g; });
  // New round (or new pens picked): put fresh pens on their starting spots.
  st.pl.forEach((q, k) => { if (k !== G.me && Array.isArray(q)) G.pl[k].pen = clamp(q[1] | 0, 0, PENS.length - 1); });
  if (G.me > 0 && Array.isArray(st.pl[G.me])) G.pl[G.me].pen = clamp(st.pl[G.me][1] | 0, 0, PENS.length - 1);
  const layout = st.rd + ':' + G.pl.map((p) => p.pen).join(',');
  if (st.ph !== 'pick' && layout !== G.layout) { G.layout = layout; placePens(); G.sim = false; G.pred = 0; }

  const ph = ['aim', 'moving', 'between', 'over', 'idle', 'pick'].includes(st.ph) ? st.ph : 'idle';
  G.turn = clamp(st.t | 0, 0, n - 1);
  G.sc = G.pl.map((_, k) => num(Array.isArray(st.sc) ? st.sc[k] : 0, 0, WIN_ROUNDS));
  G.rd = num(st.rd, 1, 99, 1);
  G.auth = st.p.map((q) => (Array.isArray(q) ? { x: num(q[0], -2000, 3000), y: num(q[1], -2000, 3000), a: num(q[2], -1e7, 1e7), alive: !!q[3], raw: q } : null));
  G.authEnv = { bo: unpackBoosters(st.bo), ink: readFlood(st.ink) };
  // Pen choosing between rounds. Our own choice shows right away, before the host confirms it.
  const pk = st.pk;
  if (ph === 'pick' && pk && Array.isArray(pk.picks) && pk.picks.length === n) {
    const picks = pk.picks.map((v) => (typeof v === 'number' ? v | 0 : -1));
    if (net.myPick && net.myPick.rd === pk.rd && G.me > 0 && picks[G.me] < 0) picks[G.me] = net.myPick.pen;
    G.pick = { rd: pk.rd | 0, last: Array.isArray(pk.last) ? pk.last.map((v) => v | 0) : picks.map(() => -1), picks, until: Date.now() + num(pk.left, 0, 60000) };
  } else G.pick = null;

  // A new shot: replay it, unless it is the one we already predicted.
  const sh = st.sh;
  if (sh && typeof sh === 'object' && typeof sh.n === 'number' && sh.n !== G.lastShot && ph === 'moving') {
    G.lastShot = sh.n;
    if (!(G.pred && sh.fl === G.pred && sh.i === G.me)) startReplay(sh);
    G.pred = 0;
  }
  // Host acknowledged our flick but did not use it: drop the prediction.
  if (G.pred && !net.pf && ph !== 'moving') { G.pred = 0; G.sim = false; }

  let phase = ph;
  if (phase === 'aim' && G.turn === G.me && net.pf) phase = 'moving'; // our shot is on its way
  G.phase = phase;
  if (G.sim && ph !== 'moving' && !G.simEnd) G.simEnd = performance.now() + 1500;

  if (Array.isArray(st.b) && st.b[0] !== G.lastB) { G.lastB = st.b[0]; banner(String(st.b[1]).slice(0, 60), 1300); }
  const a = st.a;
  G.raim = Array.isArray(a) && G.phase === 'aim' && (a[0] | 0) !== G.me && (a[0] | 0) === G.turn
    ? { i: a[0] | 0, t: num(a[1], -0.45, 0.45), jx: num(a[2], -MAXJ, MAXJ), jy: num(a[3], -MAXJ, MAXJ) } : null;
  if (G.phase === 'over' && $('#result').hidden) { G.winner = clamp(st.w | 0, 0, n - 1); showResult(); }
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
      unpackExtras(p, q.raw);
      if (p.alive && !q.alive) { p.alive = false; if (!G.pl[i].gone) onEvent({ t: 'fall', i, x: p.x, y: p.y }); else p.fall = 1; }
      else if (!p.alive && q.alive) { p.alive = true; p.fall = 0; p.x = q.x; p.y = q.y; p.a = q.a; p.tip = null; }
    });
    if (G.authEnv) {
      G.env.boosters = G.authEnv.bo;
      if (!G.env.flood && G.authEnv.ink) G.floodAt = performance.now();
      G.env.flood = G.authEnv.ink;
    }
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
const otherPeers = () => {
  const net = S.net;
  return net.role === 'host' ? net.ids.slice(1).filter((id, k) => S.G && !S.G.pl[k + 1].gone) : net.hostId ? [net.hostId] : [];
};

/** { text, bad } for the little label under the hint, or null offline. */
export function connLabel() {
  const net = S.net, G = S.G;
  if (!net || !G || G.mode !== 'online') return null;
  const peers = otherPeers();
  if (!peers.length) return null;
  const routes = peers.map((id) => net.nr.route(id));
  const lost = peers.some((id) => net.nr.lastSeen(id) > 5000) || (!isAuth() && performance.now() - net.hostAt > 4000);
  const direct = routes.filter((r) => r.path === 'direct').length;
  const path = direct === routes.length ? 'Direct link' : direct ? `Direct link ×${direct}, relay ×${routes.length - direct}` : routes[0].path === 'server' ? 'Game server' : 'Relay';
  const rtts = routes.map((r) => r.rtt).filter((x) => x != null);
  return { text: lost ? 'Connection lost, reconnecting…' : path + (rtts.length ? ' · ' + Math.max(...rtts) + ' ms' : ''), bad: lost };
}

export function debugText() {
  const net = S.net, G = S.G;
  const lines = ['Pen Clash protocol v' + PROTOCOL];
  if (net) {
    lines.push('role: ' + net.role + '  code: ' + net.code + '  transport: ' + net.nr.transport + '  me: ' + net.me);
    for (const id of otherPeers()) {
      const r = net.nr.route(id);
      lines.push(`peer ${id}: ${r.path}${r.host && r.path !== 'direct' ? ' (' + r.host + ')' : ''}  rtt ${r.rtt ?? '-'} ms  heard ${Math.round(net.nr.lastSeen(id))} ms ago` + (net.role === 'host' ? '  last flick ' + (net.lastFl[id] || 0) : ''));
    }
    if (net.role !== 'host') lines.push('host state age: ' + (net.hostAt ? Math.round(performance.now() - net.hostAt) : '-') + ' ms  pending flick: ' + (net.pf ? net.pf.n : 'none'));
  } else lines.push('offline');
  if (G) lines.push('arena: ' + G.arena.id + '  phase: ' + G.phase + '  turn: ' + G.turn + '  round: ' + G.rd + '  score: ' + G.sc.join('-') + '  shot: ' + (G.shot ? G.shot.n : G.lastShot) + '  replaying: ' + G.sim);
  if (S.errors.length) lines.push('errors:', ...S.errors.slice(-5));
  return lines.join('\n');
}
