// Rigid-body pens: capsules that slide with friction, spin, and bounce off each other
// and off the arena's fixed obstacles. Also tracks what the rules need to be
// identical on every screen: damage, repeated hits on the same spot (PEN BREAK),
// booster pickups, and the slippery ink flood a broken pen leaves.
import { MAXJ, ANG, E } from './constants.js';
import { clamp } from './util.js';
import { inside } from './arenas.js';

export const SEGS = 5; // a pen is split into 5 spots for "hit in the same place" tracking
export const BREAK_HITS = 3; // hard hits on one spot that break a pen
const HARD_HIT = 75; // impulse that counts as a hard hit
const HIT_COOLDOWN = 0.2; // one collision is many tiny contacts: count it once
const PICK_R = 20; // booster pickup radius
const FIRE_KNOCK = 0.9; // extra knockback a fiery pen gives (fraction of the hit)
export const SPEED_BOOST = 1.5;

export function mkPen(i, d, x, y, a) {
  return {
    i, d, x, y, a, vx: 0, vy: 0, w: 0, L: d.len, r: d.r, m: d.mass, I: (d.mass * d.len * d.len) / 12,
    alive: true, fall: 0, tx: x, ty: y, ta: a,
    dmg: 0, segs: new Array(SEGS).fill(0), broken: -1, // broken = which spot snapped, -1 if whole
    frozen: false, arm: '', speedy: false, fiery: false, got: '', stain: 0, hitCd: 0,
  };
}

// A frozen pen is a heavy block of ice: hard to push, quick to stop.
const massOf = (p) => p.m * (p.frozen ? 6 : 1);
const inertiaOf = (p) => p.I * (p.frozen ? 6 : 1);

function ends(p) {
  const c = (Math.cos(p.a) * p.L) / 2, s = (Math.sin(p.a) * p.L) / 2;
  return [p.x - c, p.y - s, p.x + c, p.y + s];
}

/** Where along pen p (-0.5..0.5) the world point (x, y) is. */
const along = (p, x, y) => clamp(((x - p.x) * Math.cos(p.a) + (y - p.y) * Math.sin(p.a)) / p.L, -0.5, 0.5);
const segOf = (t) => clamp(Math.floor((t + 0.5) * SEGS), 0, SEGS - 1);

// Closest points between two segments.
function closest(p1x, p1y, q1x, q1y, p2x, p2y, q2x, q2y) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d2x = q2x - p2x, d2y = q2y - p2y, rx = p1x - p2x, ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry, c = d1x * rx + d1y * ry, b = d1x * d2x + d1y * d2y, den = a * e - b * b;
  let s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0, t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
  return [p1x + d1x * s, p1y + d1y * s, p2x + d2x * t, p2y + d2y * t];
}

/** Record a hit of strength j at (x, y) on pen p: damage, dents, maybe a PEN BREAK. */
function wound(p, x, y, j, mult, env, ev) {
  p.dmg = Math.min(100, p.dmg + (j / 28) * mult);
  if (j < HARD_HIT || p.hitCd > 0) return;
  p.hitCd = HIT_COOLDOWN;
  const s = segOf(along(p, x, y));
  p.segs[s]++;
  if (p.segs[s] >= BREAK_HITS && p.broken < 0) {
    p.broken = s;
    if (!env.flood) env.flood = { col: p.d.ink, i: p.i, x: Math.round(p.x), y: Math.round(p.y) };
    if (ev) ev.push({ t: 'break', i: p.i, x: p.x, y: p.y });
  }
}

function collide(a, b, ev, env) {
  const A = ends(a), B = ends(b), c = closest(A[0], A[1], A[2], A[3], B[0], B[1], B[2], B[3]);
  let nx = c[2] - c[0], ny = c[3] - c[1], d = Math.hypot(nx, ny);
  const rs = a.r + b.r;
  if (d >= rs) return;
  if (d < 1e-6) { nx = b.x - a.x; ny = b.y - a.y; const q = Math.hypot(nx, ny) || 1; nx /= q; ny /= q; d = 0; } else { nx /= d; ny /= d; }
  const ma = massOf(a), mb = massOf(b), Ia = inertiaOf(a), Ib = inertiaOf(b);
  const ia = 1 / ma, ib = 1 / mb, pen = rs - d, k = pen / (ia + ib);
  a.x -= nx * k * ia; a.y -= ny * k * ia; b.x += nx * k * ib; b.y += ny * k * ib;
  const px = c[0] + nx * a.r, py = c[1] + ny * a.r, rax = px - a.x, ray = py - a.y, rbx = px - b.x, rby = py - b.y;
  const vn = (b.vx - b.w * rby - (a.vx - a.w * ray)) * nx + (b.vy + b.w * rbx - (a.vy + a.w * rax)) * ny;
  if (vn > 0) return;
  const ran = rax * ny - ray * nx, rbn = rbx * ny - rby * nx, j = (-(1 + E) * vn) / (ia + ib + (ran * ran) / Ia + (rbn * rbn) / Ib);
  a.vx -= j * nx * ia; a.vy -= j * ny * ia; a.w -= ((ANG * ran * j) / Ia) * 2;
  b.vx += j * nx * ib; b.vy += j * ny * ib; b.w += ((ANG * rbn * j) / Ib) * 2;
  // A pen on fire hits extra hard (a frozen pen shrugs it off).
  if (a.fiery && !b.frozen) { b.vx += j * FIRE_KNOCK * nx * ib; b.vy += j * FIRE_KNOCK * ny * ib; }
  if (b.fiery && !a.frozen) { a.vx -= j * FIRE_KNOCK * nx * ia; a.vy -= j * FIRE_KNOCK * ny * ia; }
  if (ev) ev.push({ t: 'hit', x: px, y: py, j, fire: a.fiery || b.fiery });
  wound(a, px, py, j, b.fiery ? 2 : 1, env, ev);
  wound(b, px, py, j, a.fiery ? 2 : 1, env, ev);
}

/** Bounce pen p off a fixed round obstacle o (infinite mass). */
function hitObstacle(p, o, ev, env) {
  const [x1, y1, x2, y2] = ends(p), dx = x2 - x1, dy = y2 - y1;
  const t = clamp(((o.x - x1) * dx + (o.y - y1) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  const cx = x1 + dx * t, cy = y1 + dy * t;
  let nx = cx - o.x, ny = cy - o.y;
  const d = Math.hypot(nx, ny), rs = p.r + o.r;
  if (d >= rs) return;
  if (d < 1e-6) { nx = 1; ny = 0; } else { nx /= d; ny /= d; }
  p.x += nx * (rs - d); p.y += ny * (rs - d);
  const m = massOf(p), I = inertiaOf(p);
  const px = o.x + nx * o.r, py = o.y + ny * o.r, rx = px - p.x, ry = py - p.y;
  const vn = (p.vx - p.w * ry) * nx + (p.vy + p.w * rx) * ny;
  if (vn >= 0) return;
  const rn = rx * ny - ry * nx, j = (-(1 + E) * vn) / (1 / m + (rn * rn) / I);
  p.vx += (j * nx) / m; p.vy += (j * ny) / m; p.w += ((ANG * rn * j) / I) * 2;
  if (ev) ev.push({ t: 'hit', x: px, y: py, j });
  wound(p, px, py, j, 1, env, ev);
}

/** Booster pickup: the first pen whose body touches it collects it (applied when the shot ends). */
function pickups(p, env, ev) {
  if (!env.boosters.length || p.got) return;
  const [x1, y1, x2, y2] = ends(p), dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1;
  for (const b of env.boosters) {
    if (b.taken) continue;
    const t = clamp(((b.x - x1) * dx + (b.y - y1) * dy) / L2, 0, 1);
    if (Math.hypot(x1 + dx * t - b.x, y1 + dy * t - b.y) < p.r + PICK_R) {
      b.taken = true; p.got = b.k;
      if (ev) ev.push({ t: 'pick', i: p.i, k: b.k, x: b.x, y: b.y });
      return;
    }
  }
}

/** A plain arena is accepted too (no boosters, no flood). */
export const envOf = (e) => (e && e.arena ? e : { arena: e, boosters: [], flood: null });

/**
 * Advance the world by dt seconds. env = { arena, boosters, flood }.
 * Pushes 'hit', 'fall', 'pick' and 'break' events into ev.
 */
export function step(P, dt, ev, envIn) {
  const env = envOf(envIn), ar = env.arena, af = ar.fric * (env.flood ? 0.7 : 1);
  for (const p of P) {
    if (!p.alive && p.fall >= 1) continue;
    if (p.hitCd > 0) p.hitCd = Math.max(0, p.hitCd - dt);
    p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.w * dt;
    const sp = Math.hypot(p.vx, p.vy);
    const fr = p.d.fric * af * (p.frozen ? 3 : 1) * (p.speedy ? 0.6 : 1);
    if (sp > 0) { const ns = Math.max(0, sp - (sp * 1.4 * Math.sqrt(af) + 240 * fr) * dt); p.vx *= ns / sp; p.vy *= ns / sp; }
    p.w *= Math.exp(-2.6 * Math.sqrt(af) * (p.frozen ? 3 : 1) * dt);
    const wd = 1.4 * dt * fr;
    p.w = Math.abs(p.w) < wd ? 0 : p.w - Math.sign(p.w) * wd;
    if (env.flood && p.alive && sp > 20) p.stain = Math.min(1, p.stain + (sp * dt) / 700);
    if (p.alive && !inside(ar, p.x, p.y)) { p.alive = false; if (ev) ev.push({ t: 'fall', i: p.i, x: p.x, y: p.y }); }
  }
  for (let a = 0; a < P.length; a++) {
    if (!P[a].alive) continue;
    for (let b = a + 1; b < P.length; b++) if (P[b].alive) collide(P[a], P[b], ev, env);
    for (const o of ar.obstacles) hitObstacle(P[a], o, ev, env);
    if (Math.hypot(P[a].vx, P[a].vy) > 1) pickups(P[a], env, ev);
  }
}

export const moving = (P) => P.some((p) => p.alive && (Math.hypot(p.vx, p.vy) > 4 || Math.abs(p.w) > 0.06));

/** Turn a collected Speed or Fire booster into an active one for this shot. */
export function armShot(p) {
  p.speedy = p.arm === 'speed';
  p.fiery = p.arm === 'fire';
  p.arm = '';
}

/** Strike pen p at offset t (-0.5..0.5 along its length) with impulse (jx, jy). */
export function flickPen(p, t, jx, jy) {
  const boost = p.speedy ? SPEED_BOOST : 1, cap = MAXJ * boost;
  jx *= boost; jy *= boost;
  const m = Math.hypot(jx, jy);
  if (m > cap) { jx *= cap / m; jy *= cap / m; }
  const rx = Math.cos(p.a) * t * p.L, ry = Math.sin(p.a) * t * p.L, mass = massOf(p);
  p.vx += jx / mass; p.vy += jy / mass; p.w += (ANG * (rx * jy - ry * jx)) / inertiaOf(p);
}

/* ---------- compact state for sending online ---------- */
const q3 = (v) => Math.round(v * 1000) / 1000;

/** Everything about a pen that the rules care about, as a small array. */
export function packPen(p) {
  return [q3(p.x), q3(p.y), q3(p.a), p.alive ? 1 : 0, Math.round(p.dmg * 10) / 10, p.segs.join(''), p.broken, p.frozen ? 1 : 0, p.arm, Math.round(p.stain * 100) / 100, p.got];
}

/** Apply the non-position fields of packPen() output. */
export function unpackExtras(p, q) {
  const num = (v, a, b) => (typeof v === 'number' && isFinite(v) ? clamp(v, a, b) : a);
  p.dmg = num(q[4], 0, 100);
  if (typeof q[5] === 'string') p.segs = [...q[5].slice(0, SEGS).padEnd(SEGS, '0')].map((c) => clamp(+c || 0, 0, 9));
  p.broken = typeof q[6] === 'number' ? clamp(q[6] | 0, -1, SEGS - 1) : -1;
  p.frozen = !!q[7];
  p.arm = q[8] === 'speed' || q[8] === 'fire' ? q[8] : '';
  p.stain = num(q[9], 0, 1);
  p.got = q[10] === 'speed' || q[10] === 'fire' || q[10] === 'freeze' ? q[10] : '';
}
