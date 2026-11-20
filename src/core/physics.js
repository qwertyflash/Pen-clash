// Rigid-body pens: capsules that slide with friction, spin, and bounce off each other.
import { CX, CY, R, MAXJ, ANG, E } from './constants.js';
import { clamp } from './util.js';

export function mkPen(i, d, x, y, a) {
  return { i, d, x, y, a, vx: 0, vy: 0, w: 0, L: d.len, r: d.r, m: d.mass, I: (d.mass * d.len * d.len) / 12, alive: true, fall: 0, tx: x, ty: y, ta: a };
}

function ends(p) {
  const c = (Math.cos(p.a) * p.L) / 2, s = (Math.sin(p.a) * p.L) / 2;
  return [p.x - c, p.y - s, p.x + c, p.y + s];
}

// Closest points between two segments.
function closest(p1x, p1y, q1x, q1y, p2x, p2y, q2x, q2y) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d2x = q2x - p2x, d2y = q2y - p2y, rx = p1x - p2x, ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry, c = d1x * rx + d1y * ry, b = d1x * d2x + d1y * d2y, den = a * e - b * b;
  let s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0, t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
  return [p1x + d1x * s, p1y + d1y * s, p2x + d2x * t, p2y + d2y * t];
}

function collide(a, b, ev) {
  const A = ends(a), B = ends(b), c = closest(A[0], A[1], A[2], A[3], B[0], B[1], B[2], B[3]);
  let nx = c[2] - c[0], ny = c[3] - c[1], d = Math.hypot(nx, ny);
  const rs = a.r + b.r;
  if (d >= rs) return;
  if (d < 1e-6) { nx = b.x - a.x; ny = b.y - a.y; const q = Math.hypot(nx, ny) || 1; nx /= q; ny /= q; d = 0; } else { nx /= d; ny /= d; }
  const ia = 1 / a.m, ib = 1 / b.m, pen = rs - d, k = pen / (ia + ib);
  a.x -= nx * k * ia; a.y -= ny * k * ia; b.x += nx * k * ib; b.y += ny * k * ib;
  const px = c[0] + nx * a.r, py = c[1] + ny * a.r, rax = px - a.x, ray = py - a.y, rbx = px - b.x, rby = py - b.y;
  const vn = (b.vx - b.w * rby - (a.vx - a.w * ray)) * nx + (b.vy + b.w * rbx - (a.vy + a.w * rax)) * ny;
  if (vn > 0) return;
  const ran = rax * ny - ray * nx, rbn = rbx * ny - rby * nx, j = (-(1 + E) * vn) / (ia + ib + (ran * ran) / a.I + (rbn * rbn) / b.I);
  a.vx -= j * nx * ia; a.vy -= j * ny * ia; a.w -= ((ANG * ran * j) / a.I) * 2;
  b.vx += j * nx * ib; b.vy += j * ny * ib; b.w += ((ANG * rbn * j) / b.I) * 2;
  if (ev) ev.push({ t: 'hit', x: px, y: py, j });
}

export function step(P, dt, ev) {
  for (const p of P) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.w * dt;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 0) { const ns = Math.max(0, sp - (sp * 1.4 + 240 * p.d.fric) * dt); p.vx *= ns / sp; p.vy *= ns / sp; }
    p.w *= Math.exp(-2.6 * dt);
    const wd = 1.4 * dt * p.d.fric;
    p.w = Math.abs(p.w) < wd ? 0 : p.w - Math.sign(p.w) * wd;
    if (p.alive && Math.hypot(p.x - CX, p.y - CY) > R) { p.alive = false; if (ev) ev.push({ t: 'fall', i: p.i, x: p.x, y: p.y }); }
  }
  if (P[0].alive && P[1].alive) collide(P[0], P[1], ev);
}

export const moving = (P) => P.some((p) => p.alive && (Math.hypot(p.vx, p.vy) > 4 || Math.abs(p.w) > 0.06));

/** Strike pen p at offset t (-0.5..0.5 along its length) with impulse (jx, jy). */
export function flickPen(p, t, jx, jy) {
  const m = Math.hypot(jx, jy);
  if (m > MAXJ) { jx *= MAXJ / m; jy *= MAXJ / m; }
  const rx = Math.cos(p.a) * t * p.L, ry = Math.sin(p.a) * t * p.L;
  p.vx += jx / p.m; p.vy += jy / p.m; p.w += (ANG * (rx * jy - ry * jx)) / p.I;
}
