// Match rules for 2-4 players: turns go round the table, a pen that falls off is out
// for the round, the last pen standing wins the round, first to WIN_ROUNDS wins.
import { CX, CY, PENS, WIN_ROUNDS } from '../core/constants.js';
import { $, clamp } from '../core/util.js';
import { arenaById, spawnPoints } from '../core/arenas.js';
import { mkPen, step, moving, flickPen } from '../core/physics.js';
import { botPlan } from '../core/bot.js';
import { sfx } from '../ui/audio.js';
import { BOTAV, safeAv } from '../ui/avatars.js';
import { resetInk, splat } from '../ui/arena.js';
import { show, banner } from '../ui/screens.js';
import { sparks } from './render.js';
import { S, isAuth } from './state.js';
import { netTick } from './online.js';

const nm = (i) => S.G.pl[i].name;
const BOT_NAMES = ['Inkbot', 'Blotbot', 'Smudgebot'];

export function newGame(mode, pl, arenaId) {
  clearTimers();
  const arena = arenaById(arenaId);
  S.G = {
    mode, pl, arena, pens: [], turn: 0, first: 0, phase: 'idle', sc: pl.map(() => 0), rd: 1, mover: 0,
    aim: null, raim: null, slow: 0, shake: 0, parts: [],
    mid: (Math.random() * 1e9) | 0, msgId: 0, msg: null, me: -1, winner: -1, dirty: true, sig: '',
    // online: the host's last shot, and a guest's local replay of it
    shotN: 0, shot: null, sim: false, simEnd: 0, pred: 0, lastShot: -1, auth: null,
  };
  resetInk(arena);
  $('#result').hidden = true;
}

export function clearTimers() {
  const G = S.G;
  if (G) { clearTimeout(G.tm); clearTimeout(G.tm2); }
}

/** Players still in the match (not disconnected). */
export const activeIdx = () => S.G.pl.map((p, i) => (p.gone ? -1 : i)).filter((i) => i >= 0);
const aliveIdx = () => activeIdx().filter((i) => S.G.pens[i].alive);

/** Next seat after `from` (cyclic) that passes `ok`. */
function nextSeat(from, ok) {
  const n = S.G.pl.length;
  for (let k = 1; k <= n; k++) { const j = (from + k) % n; if (ok(j)) return j; }
  return from;
}
const nextAlive = (from) => nextSeat(from, (j) => !S.G.pl[j].gone && S.G.pens[j].alive);

export function placePens() {
  const G = S.G, sp = spawnPoints(G.pl.length);
  G.pens = G.pl.map((pl, i) => {
    const p = mkPen(i, PENS[pl.pen], sp[i][0], sp[i][1], sp[i][2]);
    p.tip = null;
    if (pl.gone) { p.alive = false; p.fall = 1; }
    return p;
  });
}

const turnLine = () => (S.G.mode === 'bot' && S.G.turn === 0 ? 'Your turn' : nm(S.G.turn) + "'s turn");

function say(t, ms = 1200) {
  const G = S.G;
  G.msgId++; G.msg = [G.msgId, t]; banner(t, ms); G.dirty = true;
}

export function startMatch() {
  const G = S.G;
  G.sc = G.pl.map(() => 0); G.rd = 1; G.winner = -1; G.mid = (Math.random() * 1e9) | 0;
  G.first = activeIdx()[0] ?? 0;
  resetInk(G.arena); $('#result').hidden = true;
  startRound();
}

function startRound() {
  const G = S.G;
  placePens(); G.turn = G.first; G.phase = 'between'; G.aim = G.raim = null; G.shot = null;
  say('Round ' + G.rd, 1100);
  clearTimeout(G.tm);
  G.tm = setTimeout(() => { G.phase = 'aim'; say(turnLine(), 900); maybeBot(); }, 1300);
}

/** Authoritative flick (offline, or on the online host). fl = the guest's flick id, if any. */
export function doFlick(i, t, jx, jy, fl = 0) {
  const G = S.G;
  if (!G || G.phase !== 'aim' || G.turn !== i) return false;
  t = clamp(t, -0.45, 0.45);
  // Remember where everything started so guests can replay this shot locally.
  G.shot = { n: ++G.shotN, i, t, jx, jy, fl, s: G.pens.map((p) => [p.x, p.y, p.a, p.alive ? 1 : 0]) };
  flickPen(G.pens[i], t, jx, jy);
  G.mover = i; G.phase = 'moving'; G.aim = null; G.raim = null; G.dirty = true;
  sfx.flick();
  return true;
}

// Round positions to 1/1000 at rest so the host and guests hold identical numbers.
const q3 = (v) => Math.round(v * 1000) / 1000;

function onSettle() {
  const G = S.G;
  G.pens.forEach((p) => { p.vx = p.vy = p.w = 0; p.x = q3(p.x); p.y = q3(p.y); p.a = q3(p.a); });
  const alive = aliveIdx();
  if (alive.length >= 2) {
    G.turn = nextAlive(G.mover); G.phase = 'aim'; say(turnLine(), 800); maybeBot();
    return;
  }
  let w = -1, msg;
  const two = G.pl.length === 2;
  if (alive.length === 1) {
    w = alive[0];
    msg = two ? (w === G.mover ? 'Knockout!' : nm(G.mover) + ' fell off!') : nm(w) + ' wins the round!';
  } else {
    // Everyone left fell in the same shot: the point goes to the one other pen that fell with the shooter.
    const fellNow = activeIdx().filter((i) => i !== G.mover && G.shot && G.shot.s[i][3] && !G.pens[i].alive);
    if (fellNow.length === 1) { w = fellNow[0]; msg = 'Double KO! Point ' + nm(w); }
  }
  endRound(w, msg);
}

/** Award the round to w (or replay it when w < 0), then start the next round or end the match. */
function endRound(w, msg) {
  const G = S.G;
  G.phase = 'between'; G.aim = G.raim = null;
  if (w >= 0) G.sc[w]++;
  say(w >= 0 ? msg : 'Everyone fell! Replay the round', 1500);
  clearTimeout(G.tm); clearTimeout(G.tm2);
  G.tm = setTimeout(() => {
    if (w >= 0 && G.sc[w] >= WIN_ROUNDS) { G.phase = 'over'; G.winner = w; G.dirty = true; showResult(); return; }
    if (w >= 0) { G.rd++; G.first = nextSeat(G.first, (j) => !G.pl[j].gone); }
    startRound();
  }, 1700);
}

/** An online player disconnected mid-match: take their pen out and carry on. */
export function removePlayer(i) {
  const G = S.G;
  if (!G || !G.pl[i] || G.pl[i].gone) return;
  G.pl[i].gone = true;
  const p = G.pens[i];
  if (p && p.alive) { p.alive = false; p.fall = 1; }
  G.dirty = true;
  if (G.first === i) G.first = nextSeat(i, (j) => !G.pl[j].gone);
  if (G.phase === 'aim' || G.phase === 'moving') {
    const alive = aliveIdx();
    if (alive.length === 1 && G.phase === 'aim') endRound(alive[0], nm(alive[0]) + ' wins the round!');
    else if (G.phase === 'aim' && G.turn === i) { G.turn = nextAlive(i); G.aim = G.raim = null; say(turnLine(), 800); }
  }
}

function maybeBot() {
  const G = S.G;
  if (!G || G.phase !== 'aim') return;
  const i = G.turn, pl = G.pl[i];
  if (!pl.bot) return;
  clearTimeout(G.tm2);
  G.tm2 = setTimeout(() => {
    if (S.G !== G || G.phase !== 'aim' || G.turn !== i) return;
    const b = botPlan(G.pens, G.arena, i, pl.diff), t0 = performance.now();
    const an = () => {
      if (S.G !== G || G.phase !== 'aim' || G.turn !== i) return;
      const k = Math.min(1, (performance.now() - t0) / 700);
      G.aim = { i, t: b.t, jx: b.jx * k, jy: b.jy * k };
      if (k < 1) requestAnimationFrame(an); else setTimeout(() => doFlick(i, b.t, b.jx, b.jy), 120);
    };
    an();
  }, 650);
}

/** Visual + sound feedback for hits and falls. */
export function onEvent(e) {
  const G = S.G;
  if (e.t === 'hit') {
    if (e.j < 40) return;
    sparks(e.x, e.y, Math.min(22, 6 + e.j / 50), [...new Set(G.pens.map((p) => p.d.ink)), '#ffe23d', '#0b0b14']);
    G.shake = Math.min(16, G.shake + e.j / 70);
    sfx.hit(e.j);
  } else {
    const p = G.pens[e.i];
    splat(e.x, e.y, p.d.ink);
    sparks(e.x, e.y, 18, [p.d.ink, '#0b0b14'], 300);
    G.shake = 12; sfx.fall();
    if (e.sim) G.slow = 0.6;
  }
}

export function startOffline() {
  const { cfg, mode } = S;
  let pl;
  if (mode === 'bot') {
    pl = [{ ...cfg[0], local: true }];
    for (let k = 0; k < S.bots; k++) pl.push({ name: BOT_NAMES[k], pen: (Math.random() * PENS.length) | 0, av: BOTAV, bot: true, diff: S.diff, local: true });
  } else pl = cfg.slice(0, S.locals).map((c) => ({ ...c, local: true }));
  newGame(mode, pl, S.arena);
  show('game');
  startMatch();
}

export function showResult() {
  const G = S.G, w = G.winner, p = G.pl[w];
  $('#rAv').src = safeAv(p.av);
  $('#rTitle').textContent = (G.mode === 'bot' && w === 0) || G.me === w ? 'You win!' : p.name + ' wins!';
  $('#rScore').textContent = G.sc.join(' – ');
  $('#rNote').textContent = '';
  $('#rAgain').hidden = G.mode === 'online' && G.me < 0;
  $('#result').hidden = false;
  sfx.win();
  sparks(CX, CY, 40, ['#ff4d8d', '#ffe23d', '#22e1c6', '#1631b4'], 700);
}

/* ---------- simulation clock ----------
   Physics runs at a fixed 240 Hz on a Web Worker timer, which browsers don't pause for
   background tabs, so an online host keeps the match going even when hidden.
   The host simulates for real; guests replay each shot locally (G.sim). */
let acc = 0, simLast = 0;
export const resetSimClock = () => { acc = 0; };

function simTick() {
  const now = performance.now(), dt = Math.min(0.1, simLast ? (now - simLast) / 1000 : 0);
  simLast = now;
  const G = S.G;
  const auth = isAuth();
  if (G && G.pens.length && (auth ? G.phase !== 'idle' : G.sim)) {
    const sdt = dt * (G.slow > 0 ? 0.3 : 1);
    G.slow = Math.max(0, G.slow - dt);
    acc += sdt;
    const ev = [];
    let n = 0;
    while (acc >= 1 / 240 && n < 120) { step(G.pens, 1 / 240, ev, G.arena); acc -= 1 / 240; n++; }
    ev.forEach((e) => { e.sim = true; onEvent(e); });
    if (auth) G.pens.forEach((p) => { if (!p.alive) p.fall = Math.min(1, p.fall + dt * 1.7); });
    const settled = !moving(G.pens) && G.pens.every((p) => p.alive || p.fall >= 1);
    if (auth) { if (G.phase === 'moving' && settled) onSettle(); }
    else if (settled || (G.simEnd && now > G.simEnd)) {
      // Replay finished (or ran too long): hold here until the host's final positions arrive.
      G.sim = false; G.simEnd = 0;
      G.pens.forEach((p) => { p.vx = p.vy = p.w = 0; p.tx = p.x; p.ty = p.y; p.ta = p.a; });
    }
  }
  if (G && G.mode === 'online') netTick(dt);
  if (S.net && S.net.nr && S.net.nr.pulse) S.net.nr.pulse();
}

export function startSimClock() {
  try {
    const wk = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},16)'], { type: 'text/javascript' })));
    wk.onmessage = simTick;
    wk.onerror = () => setInterval(simTick, 16);
  } catch { setInterval(simTick, 16); }
}
