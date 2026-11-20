// Match rules for 2-4 players: turns go round the table, a pen that falls off is out
// for the round, the last pen standing wins the round, first to WIN_ROUNDS wins.
// From round 2 everyone picks a new pen before the round starts. Boosters pop up on
// the arena; a pen that collects one gets it when the shot ends.
import { CX, CY, PENS, WIN_ROUNDS } from '../core/constants.js';
import { $, clamp } from '../core/util.js';
import { arenaById, spawnPoints } from '../core/arenas.js';
import { mkPen, step, moving, flickPen, armShot, packPen } from '../core/physics.js';
import { spawnBooster, packBoosters, BOOSTERS } from '../core/boosters.js';
import { botPlan } from '../core/bot.js';
import { sfx } from '../ui/audio.js';
import { BOTAV, safeAv } from '../ui/avatars.js';
import { resetInk, splat } from '../ui/arena.js';
import { show, banner } from '../ui/screens.js';
import { saveMatch } from '../ui/board.js';
import { sparks } from './render.js';
import { S, isAuth } from './state.js';
import { netTick } from './online.js';

const nm = (i) => S.G.pl[i].name;

/** Hooks for other modules. end(G) runs once on the authoritative device when a match ends. */
export const hooks = { end: null, result: null };
const BOT_NAMES = ['Inkbot', 'Blotbot', 'Smudgebot'];
export const PICK_MS = 15000;
const BOOSTER_CHANCE = 0.45; // chance a new booster pops up after each shot

export function newGame(mode, pl, arenaId) {
  clearTimers();
  const arena = arenaById(arenaId);
  S.G = {
    mode, pl, arena, env: { arena, boosters: [], flood: null },
    pens: [], turn: 0, first: 0, phase: 'idle', sc: pl.map(() => 0), rd: 1, mover: 0, target: WIN_ROUNDS,
    aim: null, raim: null, slow: 0, shake: 0, parts: [], pick: null,
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
  placePens();
  G.env.boosters = []; G.env.flood = null;
  spawnBooster(G.env, G.pens);
  G.phase = 'between'; G.aim = G.raim = null; G.shot = null; G.pick = null;
  say('Round ' + G.rd, 1100);
  clearTimeout(G.tm);
  G.tm = setTimeout(() => beginTurn(G.first), 1300);
}

/** A turn starts: a frozen pen thaws when its owner gets to play again. */
function beginTurn(i) {
  const G = S.G;
  G.turn = i; G.phase = 'aim';
  if (G.pens[i].frozen) G.pens[i].frozen = false;
  G.dirty = true;
  say(turnLine(), 800);
  maybeBot();
}

/* ---------- choosing a new pen each round ---------- */
const randomPenExcept = (no) => { let k; do k = (Math.random() * PENS.length) | 0; while (k === no); return k; };

function startPick() {
  const G = S.G;
  G.phase = 'pick'; G.aim = G.raim = null;
  G.pick = {
    rd: G.rd,
    last: G.pl.map((p) => p.pen),
    picks: G.pl.map((p) => (p.gone ? p.pen : p.bot ? randomPenExcept(p.pen) : -1)),
    until: Date.now() + PICK_MS,
  };
  say('Round ' + G.rd + ': choose a new pen', 1400);
  clearTimeout(G.tm);
  G.tm = setTimeout(finishPick, PICK_MS);
  checkPicks();
}

/** Player i chose pen `pen` for this round (offline, or the host acting on a guest's choice). */
export function choosePen(i, pen, rd) {
  const G = S.G, pk = G && G.pick;
  if (!pk || G.phase !== 'pick' || (rd !== undefined && rd !== pk.rd)) return false;
  pen = clamp(pen | 0, 0, PENS.length - 1);
  if (pk.picks[i] !== -1 || pen === pk.last[i]) return false;
  pk.picks[i] = pen; G.dirty = true;
  checkPicks();
  return true;
}

function checkPicks() {
  if (S.G.pick.picks.every((p) => p >= 0)) { clearTimeout(S.G.tm); S.G.tm = setTimeout(finishPick, 400); }
}

function finishPick() {
  const G = S.G, pk = G.pick;
  if (!pk || G.phase !== 'pick') return;
  G.pl.forEach((p, i) => { p.pen = pk.picks[i] >= 0 ? pk.picks[i] : randomPenExcept(pk.last[i]); });
  startRound();
}

/** Authoritative flick (offline, or on the online host). fl = the guest's flick id, if any. */
export function doFlick(i, t, jx, jy, fl = 0) {
  const G = S.G;
  if (!G || G.phase !== 'aim' || G.turn !== i) return false;
  t = clamp(t, -0.45, 0.45);
  // Remember the whole starting world so guests can replay this shot exactly.
  G.shot = { n: ++G.shotN, i, t, jx, jy, fl, s: G.pens.map(packPen), bo: packBoosters(G.env), ink: G.env.flood };
  const p = G.pens[i];
  armShot(p);
  flickPen(p, t, jx, jy);
  shotFx(p);
  G.mover = i; G.phase = 'moving'; G.aim = null; G.raim = null; G.dirty = true;
  sfx.flick();
  return true;
}

// Round positions to 1/1000 at rest so the host and guests hold identical numbers.
const q3 = (v) => Math.round(v * 1000) / 1000;

function onSettle() {
  const G = S.G;
  G.pens.forEach((p) => {
    p.vx = p.vy = p.w = 0; p.x = q3(p.x); p.y = q3(p.y); p.a = q3(p.a);
    // Same rounding as the online state, so every screen shows identical numbers.
    p.dmg = Math.round(p.dmg * 10) / 10; p.stain = Math.round(p.stain * 100) / 100;
    p.speedy = p.fiery = false;
    // Boosters collected during the shot take effect now.
    if (p.got && p.alive) { if (p.got === 'freeze') p.frozen = true; else p.arm = p.got; }
    p.got = '';
  });
  G.env.boosters = G.env.boosters.filter((b) => !b.taken);
  if (Math.random() < BOOSTER_CHANCE) spawnBooster(G.env, G.pens);
  G.dirty = true;
  const alive = aliveIdx();
  if (alive.length >= 2) { beginTurn(nextAlive(G.mover)); return; }
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

/** Award the round to w (or replay it when w < 0), then pick pens for the next round or end the match. */
function endRound(w, msg) {
  const G = S.G;
  G.phase = 'between'; G.aim = G.raim = null;
  if (w >= 0) G.sc[w]++;
  say(w >= 0 ? msg : 'Everyone fell! Replay the round', 1500);
  clearTimeout(G.tm); clearTimeout(G.tm2);
  G.tm = setTimeout(() => {
    if (w >= 0 && G.sc[w] >= G.target) { endMatch(w); return; }
    if (w >= 0) { G.rd++; G.first = nextSeat(G.first, (j) => !G.pl[j].gone); startPick(); }
    else startRound();
  }, 1700);
}

function endMatch(w) {
  const G = S.G;
  clearTimeout(G.tm); clearTimeout(G.tm2);
  G.phase = 'over'; G.winner = w; G.aim = G.raim = null; G.pick = null; G.dirty = true;
  showResult();
  if (hooks.end) hooks.end(G);
}

/** End the match now with w as the winner (e.g. everyone else left a tournament match). */
export function forfeitTo(w) {
  const G = S.G;
  if (!G || G.phase === 'over') return;
  G.sc[w] = Math.max(G.sc[w], G.target);
  say(nm(w) + ' wins by forfeit', 1500);
  endMatch(w);
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
  if (G.phase === 'pick' && G.pick) { if (G.pick.picks[i] < 0) G.pick.picks[i] = G.pick.last[i]; checkPicks(); }
  if (G.phase === 'aim' || G.phase === 'moving') {
    const alive = aliveIdx();
    if (alive.length === 1 && G.phase === 'aim') endRound(alive[0], nm(alive[0]) + ' wins the round!');
    else if (G.phase === 'aim' && G.turn === i) { G.aim = G.raim = null; beginTurn(nextAlive(i)); }
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
    const b = botPlan(G.pens, G.env, i, pl.diff), t0 = performance.now();
    const an = () => {
      if (S.G !== G || G.phase !== 'aim' || G.turn !== i) return;
      const k = Math.min(1, (performance.now() - t0) / 700);
      G.aim = { i, t: b.t, jx: b.jx * k, jy: b.jy * k };
      if (k < 1) requestAnimationFrame(an); else setTimeout(() => doFlick(i, b.t, b.jx, b.jy), 120);
    };
    an();
  }, 650);
}

/* ---------- effects ---------- */
const ring = (x, y, c, r1, opts = {}) => (S.G.rings || (S.G.rings = [])).push({ x, y, c, r0: 10, r1, l: opts.l || 0.5, m: opts.l || 0.5, w: opts.w || 8, bolt: !!opts.bolt, seed: Math.random() * 6 });
const flash = (c, l = 0.25) => { S.G.flash = { c, l, m: l }; };

/** A Speed or Fire shot was just fired from pen p (called on every screen). */
export function shotFx(p) {
  const G = S.G;
  if (!p.speedy && !p.fiery) return;
  G.boostHits = 0;
  if (p.fiery) {
    sparks(p.x, p.y, 40, ['#ff7a1a', '#ffe23d', '#ff3b1f'], 520);
    ring(p.x, p.y, '#ff7a1a', 140, { w: 10 }); flash('#ff7a1a', 0.2);
    sfx.roar(); banner('FIRE SHOT!', 900);
  } else {
    sparks(p.x, p.y, 30, ['#ffe23d', '#ffffff'], 600);
    ring(p.x, p.y, '#ffe23d', 120, { bolt: true }); flash('#fff6a8', 0.15);
    sfx.whoosh(); banner('SPEED SHOT!', 900);
  }
}

/** Visual + sound feedback. Runs on every screen from its own simulation or replay. */
export function onEvent(e) {
  const G = S.G;
  if (e.t === 'hit') {
    if (e.j < 40) return;
    // Boosted contact: show it big the first couple of times in a shot.
    if ((e.fire || e.speed || e.ice) && (G.boostHits = (G.boostHits || 0) + 1) <= 2) {
      if (e.ice) {
        sparks(e.x, e.y, 26, ['#bff3ff', '#7fe3ff', '#ffffff'], 460); ring(e.x, e.y, '#bff3ff', 90, { w: 6 });
        sfx.clink(); if (G.boostHits === 1) banner('BLOCKED!', 800);
      } else if (e.fire) {
        sparks(e.x, e.y, 50, ['#ff7a1a', '#ffe23d', '#ff3b1f', '#0b0b14'], 720);
        ring(e.x, e.y, '#ff7a1a', 200, { w: 12, l: 0.6 }); ring(e.x, e.y, '#ffe23d', 120, { w: 6, l: 0.45 });
        flash('#ff7a1a', 0.3); G.shake = Math.min(30, G.shake + 14); sfx.boom();
        if (G.boostHits === 1) banner('BOOM!', 800);
      } else {
        sparks(e.x, e.y, 30, ['#ffe23d', '#ffffff', '#1631b4'], 640);
        ring(e.x, e.y, '#ffe23d', 110, { bolt: true }); flash('#fff6a8', 0.15); sfx.zap();
        if (G.boostHits === 1) banner('ZAP!', 700);
      }
    }
    const cols = e.fire ? ['#ff7a1a', '#ffe23d', '#ff3b1f', '#0b0b14'] : [...new Set(G.pens.map((p) => p.d.ink)), '#ffe23d', '#0b0b14'];
    sparks(e.x, e.y, Math.min(e.fire ? 34 : 22, 6 + e.j / 50), cols, e.fire ? 560 : 420);
    G.shake = Math.min(e.fire ? 22 : 16, G.shake + e.j / (e.fire ? 45 : 70));
    sfx.hit(e.j);
  } else if (e.t === 'pick') {
    const B = BOOSTERS[e.k];
    sparks(e.x, e.y, 24, [B.col, '#ffffff', '#0b0b14'], 380);
    sfx.pickup();
    banner(nm(e.i) + ' got ' + B.name.toUpperCase() + '!', 1300);
  } else if (e.t === 'break') {
    const p = G.pens[e.i];
    sparks(e.x, e.y, 60, [p.d.ink, '#0b0b14', '#ffffff'], 700);
    G.shake = 26; G.slow = Math.max(G.slow, 0.9);
    G.floodAt = performance.now();
    sfx.crack();
    banner('PEN BREAK! ' + nm(e.i) + '’s pen snapped', 1800);
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
  $('#rTable').innerHTML = '';
  $('#rAgain').textContent = 'Rematch';
  $('#rAgain').hidden = G.mode === 'online' && G.me < 0;
  $('#result').hidden = false;
  // Leaderboard: players who took part (not bots). Online, the host also shares it.
  const online = G.mode === 'online', host = online && isAuth();
  if (!online || G.me >= 0 || host) {
    const players = G.pl.map((q, i) => ({ name: q.name, won: i === w, rounds: G.sc[i], bot: q.bot })).filter((q) => !q.bot).map(({ bot, ...q }) => q);
    saveMatch(online ? 'm' + G.mid : 'o' + G.mid + Date.now(), players, !online || host);
  }
  if (hooks.result) hooks.result(G);
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
  if (G && G.pens.length && (auth ? G.phase !== 'idle' && G.phase !== 'pick' : G.sim)) {
    const sdt = dt * (G.slow > 0 ? 0.3 : 1);
    G.slow = Math.max(0, G.slow - dt);
    acc += sdt;
    const ev = [];
    let n = 0;
    while (acc >= 1 / 240 && n < 120) { step(G.pens, 1 / 240, ev, G.env); acc -= 1 / 240; n++; }
    ev.forEach((e) => { e.sim = true; onEvent(e); });
    if (auth) G.pens.forEach((p) => { if (!p.alive) p.fall = Math.min(1, p.fall + dt * 1.7); });
    const settled = !moving(G.pens) && G.pens.every((p) => p.alive || p.fall >= 1);
    if (auth) { if (G.phase === 'moving' && settled) onSettle(); }
    else if (settled || (G.simEnd && now > G.simEnd)) {
      // Replay finished (or ran too long): hold here until the host's final positions arrive.
      G.sim = false; G.simEnd = 0;
      G.pens.forEach((p) => { p.vx = p.vy = p.w = 0; p.tx = p.x; p.ty = p.y; p.ta = p.a; p.speedy = p.fiery = false; });
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
