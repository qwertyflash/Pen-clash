// Match rules: rounds, turns, scoring, the bot, and the fixed-step simulation clock.
import { CX, CY, PENS, WIN_ROUNDS } from '../core/constants.js';
import { $, clamp } from '../core/util.js';
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

export function newGame(mode, pl) {
  clearTimers();
  S.G = {
    mode, pl, pens: [], turn: 0, first: 0, phase: 'idle', sc: [0, 0], rd: 1, mover: 0,
    aim: null, raim: null, slow: 0, shake: 0, parts: [],
    mid: (Math.random() * 1e9) | 0, msgId: 0, msg: null, me: -1, winner: -1, dirty: true, sig: '',
    // online: the host's last shot, and a guest's local replay of it
    shotN: 0, shot: null, sim: false, simEnd: 0, pred: 0, lastShot: -1, auth: null,
  };
  resetInk();
  $('#result').hidden = true;
}

export function clearTimers() {
  const G = S.G;
  if (G) { clearTimeout(G.tm); clearTimeout(G.tm2); }
}

export function placePens() {
  const G = S.G;
  G.pens = [mkPen(0, PENS[G.pl[0].pen], CX - 175, CY, Math.PI / 2), mkPen(1, PENS[G.pl[1].pen], CX + 175, CY, Math.PI / 2)];
  G.pens.forEach((p) => { p.tip = null; });
}

const turnLine = () => (S.G.mode === 'bot' && S.G.turn === 0 ? 'Your turn' : nm(S.G.turn) + "'s turn");

function say(t, ms = 1200) {
  const G = S.G;
  G.msgId++; G.msg = [G.msgId, t]; banner(t, ms); G.dirty = true;
}

export function startMatch() {
  const G = S.G;
  G.sc = [0, 0]; G.rd = 1; G.first = 0; G.winner = -1; G.mid = (Math.random() * 1e9) | 0;
  resetInk(); $('#result').hidden = true;
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
  const d0 = !G.pens[0].alive, d1 = !G.pens[1].alive;
  G.pens.forEach((p) => { p.vx = p.vy = p.w = 0; p.x = q3(p.x); p.y = q3(p.y); p.a = q3(p.a); });
  if (!d0 && !d1) { G.turn = 1 - G.turn; G.phase = 'aim'; say(turnLine(), 800); maybeBot(); return; }
  const w = d0 && d1 ? 1 - G.mover : d0 ? 1 : 0;
  G.sc[w]++; G.phase = 'between';
  say(d0 && d1 ? 'Double KO! Point ' + nm(w) : w !== G.mover ? nm(G.mover) + ' fell off!' : 'Knockout!', 1500);
  clearTimeout(G.tm);
  G.tm = setTimeout(() => {
    if (G.sc[w] >= WIN_ROUNDS) { G.phase = 'over'; G.winner = w; G.dirty = true; showResult(); }
    else { G.rd++; G.first = 1 - G.first; startRound(); }
  }, 1700);
}

function maybeBot() {
  const G = S.G;
  if (!G || G.phase !== 'aim') return;
  const i = G.turn, pl = G.pl[i];
  if (!pl.bot) return;
  clearTimeout(G.tm2);
  G.tm2 = setTimeout(() => {
    if (G.phase !== 'aim' || G.turn !== i) return;
    const b = botPlan(G.pens, i, pl.diff), t0 = performance.now();
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
    sparks(e.x, e.y, Math.min(22, 6 + e.j / 50), [G.pens[0].d.ink, G.pens[1].d.ink, '#ffe23d', '#0b0b14']);
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
  const pl = [{ ...cfg[0], local: true }];
  pl.push(mode === 'bot' ? { name: 'Inkbot', pen: S.botPen, av: BOTAV, bot: true, diff: S.diff, local: true } : { ...cfg[1], local: true });
  newGame(mode, pl);
  show('game');
  startMatch();
}

export function showResult() {
  const G = S.G, w = G.winner, p = G.pl[w];
  $('#rAv').src = safeAv(p.av);
  $('#rTitle').textContent = (G.mode === 'bot' && w === 0) || G.me === w ? 'You win!' : p.name + ' wins!';
  $('#rScore').textContent = G.sc[0] + ' – ' + G.sc[1];
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
    while (acc >= 1 / 240 && n < 120) { step(G.pens, 1 / 240, ev); acc -= 1 / 240; n++; }
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
