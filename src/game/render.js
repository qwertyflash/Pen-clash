import { CX, CY, VIEW_R, KJ, MAXJ, COL } from '../core/constants.js';
import { $ } from '../core/util.js';
import { arenaPath } from '../core/arenas.js';
import { BOOSTERS } from '../core/boosters.js';
import { SEGS } from '../core/physics.js';
import { drawPen, drawBadge, drawGlyph, rr } from '../ui/draw.js';
import { arenaCanvas, inkC, trail } from '../ui/arena.js';
import { S } from './state.js';

export const cv = $('#cv');
const cx = cv.getContext('2d');
let dpr = 1;
let view = { s: 1, ox: 0, oy: 0 }, box = { w: 0, h: 0 };

/** Fit the current arena (plus its rim) to the canvas as large as possible. */
function fit() {
  const fitR = (S.G && S.G.arena ? S.G.arena.r : VIEW_R) + 28;
  const s = Math.min(box.w, box.h) / (2 * fitR);
  view = { s, ox: box.w / 2 - CX * s, oy: box.h / 2 - CY * s };
}

export function resize() {
  const r = cv.parentElement.getBoundingClientRect();
  if (!r.width) return;
  dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  box = { w: r.width, h: r.height };
  fit();
}
new ResizeObserver(resize).observe(cv.parentElement);

/** Convert a pointer event to arena coordinates. */
export function toWorld(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left - view.ox) / view.s, y: (e.clientY - r.top - view.oy) / view.s };
}

/** Arena coordinates to page (client) coordinates. Used by automated tests. */
export function toClient(x, y) {
  const r = cv.getBoundingClientRect();
  return { x: r.left + view.ox + x * view.s, y: r.top + view.oy + y * view.s };
}

export function sparks(x, y, n, cols, sp = 420) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * 7, v = sp * (0.3 + Math.random());
    S.G.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, l: 0.5 + Math.random() * 0.4, m: 0.9, c: cols[k % cols.length], s: 3 + Math.random() * 4 });
  }
}

function drawAim(c, a) {
  const p = S.G.pens[a.i];
  if (!p) return;
  const gx = p.x + Math.cos(p.a) * a.t * p.L, gy = p.y + Math.sin(p.a) * a.t * p.L, m = Math.hypot(a.jx, a.jy);
  if (m < 5) return;
  const k = m / MAXJ, ux = a.jx / m, uy = a.jy / m, pl = m / KJ;
  c.save(); c.lineCap = 'round'; c.setLineDash([8, 8]); c.strokeStyle = 'rgba(11,11,20,.55)'; c.lineWidth = 4;
  c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx - ux * pl, gy - uy * pl); c.stroke(); c.setLineDash([]);
  c.fillStyle = '#0b0b14'; c.beginPath(); c.arc(gx - ux * pl, gy - uy * pl, 9, 0, 7); c.fill();
  const len = 70 + k * 260, ex = gx + ux * len, ey = gy + uy * len, col = k > 0.75 ? '#ff4d8d' : k > 0.4 ? '#ff7a1a' : '#ffd000';
  c.strokeStyle = '#0b0b14'; c.lineWidth = 16; c.beginPath(); c.moveTo(gx, gy); c.lineTo(ex, ey); c.stroke(); c.strokeStyle = col; c.lineWidth = 10; c.stroke();
  c.fillStyle = col; c.strokeStyle = '#0b0b14'; c.lineWidth = 4; c.beginPath();
  c.moveTo(ex + ux * 30, ey + uy * 30); c.lineTo(ex - uy * 20, ey + ux * 20); c.lineTo(ex + uy * 20, ey - ux * 20); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = '#fff'; c.beginPath(); c.arc(gx, gy, 8, 0, 7); c.fill(); c.stroke();
  c.font = '26px Bungee, Impact, sans-serif'; c.textAlign = 'center'; c.lineWidth = 6;
  c.strokeText(Math.round(k * 100) + '%', ex + ux * 62, ey + uy * 62 + 9); c.fillStyle = col; c.fillText(Math.round(k * 100) + '%', ex + ux * 62, ey + uy * 62 + 9);
  c.restore();
}

/** Ink flood after a PEN BREAK: spreads out from the break, then stays for the round. */
function drawFlood(c, G) {
  const f = G.env.flood;
  if (!f) return;
  const t = G.floodAt ? (performance.now() - G.floodAt) / 1000 : 9;
  const rad = Math.min(1400, 60 + t * 900);
  c.save(); arenaPath(c, G.arena, 12); c.clip();
  c.globalAlpha = 0.26; c.fillStyle = f.col;
  c.beginPath(); c.arc(f.x, f.y, rad, 0, 7); c.fill();
  c.globalAlpha = 0.18;
  for (let k = 0; k < 7; k++) { const a = k * 0.9 + 0.3, d = Math.min(rad, 120 + k * 40); c.beginPath(); c.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 30 + (k % 3) * 14, 0, 7); c.fill(); }
  c.restore();
}

function drawBoosters(c, G, ts) {
  for (const b of G.env.boosters) {
    if (b.taken) continue;
    const B = BOOSTERS[b.k], bob = Math.sin(ts / 260 + b.id) * 3, r = 19 + Math.sin(ts / 180 + b.id) * 1.5;
    c.save();
    c.globalAlpha = 0.35; c.fillStyle = B.col; c.beginPath(); c.arc(b.x, b.y + bob, r + 9, 0, 7); c.fill();
    c.globalAlpha = 1; c.fillStyle = 'rgba(6,10,60,.25)'; c.beginPath(); c.arc(b.x + 3, b.y + 6, r, 0, 7); c.fill();
    c.fillStyle = B.col; c.strokeStyle = '#0b0b14'; c.lineWidth = 3; c.beginPath(); c.arc(b.x, b.y + bob, r, 0, 7); c.fill(); c.stroke();
    drawGlyph(c, b.k, b.x, b.y + bob, 22);
    c.restore();
  }
}

/** A pen plus everything that has happened to it: dents, cracks, ice, ink stains, a snap. */
function drawFighter(c, G, p, ts) {
  const sc = 1 - 0.55 * p.fall, al = 1 - p.fall;
  if (al <= 0) return;
  if (p.broken >= 0) {
    // Draw the two pieces slightly apart at the spot that snapped.
    const cut = (-0.5 + (p.broken + 0.5) / SEGS) * p.L;
    for (const side of [-1, 1]) {
      c.save(); c.translate(p.x, p.y); c.rotate(p.a);
      c.beginPath();
      if (side < 0) c.rect(-p.L, -60, p.L + cut, 120); else c.rect(cut, -60, p.L, 120);
      c.clip();
      c.translate(cut + side * 9, side * 4); c.rotate(side * 0.16); c.translate(-cut, 0);
      drawPen(c, p.d, 0, 0, 0, sc, al);
      // jagged snapped end with an ink drip
      c.fillStyle = '#0b0b14'; c.beginPath();
      const r = p.r * sc;
      c.moveTo(cut, -r); for (let k = 0; k <= 6; k++) c.lineTo(cut + side * (k % 2 ? 5 : 1), -r + (k * 2 * r) / 6); c.lineTo(cut, r); c.closePath(); c.fill();
      c.fillStyle = p.d.ink; c.beginPath(); c.arc(cut + side * 4, r + 4, 4, 0, 7); c.fill();
      c.restore();
    }
  } else drawPen(c, p.d, p.x, p.y, p.a, sc, al);

  c.save(); c.translate(p.x, p.y); c.rotate(p.a); c.scale(sc, sc); c.globalAlpha = al;
  // Dents where it was hit hard, cracks growing with damage.
  for (let s = 0; s < SEGS; s++) {
    const n = Math.min(p.segs[s], 4);
    if (!n) continue;
    const x = (-0.5 + (s + 0.5) / SEGS) * p.L;
    c.strokeStyle = '#0b0b14'; c.lineWidth = 1.6;
    for (let k = 0; k < n; k++) {
      c.beginPath(); c.moveTo(x - 6 + k * 5, -p.r * 0.9); c.lineTo(x - 2 + k * 5, -p.r * 0.2); c.lineTo(x - 5 + k * 5, p.r * 0.3); c.lineTo(x - 1 + k * 5, p.r * 0.9); c.stroke();
    }
    if (n >= 3) { c.fillStyle = 'rgba(255,77,141,.55)'; c.beginPath(); c.arc(x, 0, 4 + n * 2, 0, 7); c.fill(); }
  }
  if (p.stain > 0.03 && G.env.flood) {
    c.fillStyle = G.env.flood.col; c.globalAlpha = al * Math.min(0.75, p.stain);
    for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(((k * 37) % 100) / 100 * p.L - p.L / 2, ((k * 13) % 7 - 3) * p.r * 0.25, 3 + (k % 3) * 2, 0, 7); c.fill(); }
    c.globalAlpha = al;
  }
  if (p.frozen) {
    c.fillStyle = 'rgba(160,235,255,.45)'; c.strokeStyle = '#ffffff'; c.lineWidth = 3;
    rr(c, -p.L / 2 - 9, -p.r - 9, p.L + 18, 2 * p.r + 18, 10); c.fill(); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-p.L / 2 + 4, -p.r - 3); c.lineTo(-p.L / 2 + 26, -p.r - 3); c.moveTo(p.L / 2 - 30, p.r + 3); c.lineTo(p.L / 2 - 8, p.r + 3); c.stroke();
  }
  c.restore();

  c.globalAlpha = al;
  // A broken pen carries its badge on the bigger piece so the snap stays visible.
  let bx = p.x, by = p.y;
  if (p.broken >= 0) {
    const cut = (-0.5 + (p.broken + 0.5) / SEGS) * p.L, mid = cut >= 0 ? (-p.L / 2 + cut) / 2 : (cut + p.L / 2) / 2;
    bx += Math.cos(p.a) * mid * sc; by += Math.sin(p.a) * mid * sc;
  }
  drawBadge(c, bx, by, G.pl[p.i].av, COL[p.i], sc);
  // Status icons by the badge: armed booster, or frozen.
  const icon = p.frozen ? 'freeze' : p.arm || (p.fiery ? 'fire' : p.speedy ? 'speed' : '');
  if (icon && p.alive) {
    const ix = bx + 22 * sc, iy = by - 22 * sc, pulse = 1 + 0.12 * Math.sin(ts / 140);
    c.fillStyle = BOOSTERS[icon].col; c.strokeStyle = '#0b0b14'; c.lineWidth = 2.5;
    c.beginPath(); c.arc(ix, iy, 12 * pulse, 0, 7); c.fill(); c.stroke();
    drawGlyph(c, icon, ix, iy, 13);
  }
  // Damage readout under the badge.
  if (p.alive && p.dmg >= 1) {
    const t = Math.round(p.dmg) + '%', y = by + 34 * sc;
    c.font = '800 15px Outfit, system-ui, sans-serif'; c.textAlign = 'center';
    c.lineWidth = 4; c.strokeStyle = '#0b0b14'; c.strokeText(t, bx, y);
    c.fillStyle = p.dmg > 66 ? '#ff4d8d' : p.dmg > 33 ? '#ffb02e' : '#ffffff'; c.fillText(t, bx, y);
  }
  c.globalAlpha = 1;
  // Live effects while it moves.
  if (p.alive && (p.fiery || p.speedy) && Math.hypot(p.vx, p.vy) > 40 && Math.random() < 0.8) {
    const k = Math.random() - 0.5;
    G.parts.push({ x: p.x + Math.cos(p.a) * k * p.L, y: p.y + Math.sin(p.a) * k * p.L, vx: -p.vx * 0.15 + (Math.random() - 0.5) * 60, vy: -p.vy * 0.15 + (Math.random() - 0.5) * 60, l: 0.35, m: 0.35, c: p.fiery ? (Math.random() < 0.5 ? '#ff7a1a' : '#ffe23d') : '#ffffff', s: p.fiery ? 5 + Math.random() * 4 : 3 });
  }
}

export function render(ts) {
  const G = S.G;
  if (G.arena !== view.ar) { view.ar = G.arena; fit(); }
  const w = cv.width / dpr, h = cv.height / dpr;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, w, h);
  const sh = G.shake > 0.3 ? G.shake : 0;
  cx.translate(view.ox + (Math.random() - 0.5) * sh * view.s, view.oy + (Math.random() - 0.5) * sh * view.s);
  cx.scale(view.s, view.s);
  cx.drawImage(arenaCanvas(G.arena), -30, -30);
  G.pens.forEach(trail);
  cx.drawImage(inkC, 0, 0);
  drawFlood(cx, G);
  drawBoosters(cx, G, ts);
  if (G.phase === 'aim') {
    const p = G.pens[G.turn], pulse = 0.5 + 0.5 * Math.sin(ts / 220);
    cx.save(); cx.translate(p.x, p.y); cx.rotate(p.a); cx.strokeStyle = COL[G.turn]; cx.globalAlpha = 0.35 + 0.35 * pulse; cx.lineWidth = 12;
    rr(cx, -p.L / 2 - 10, -p.r - 10, p.L + 20, 2 * p.r + 20, p.r + 10); cx.stroke(); cx.restore();
  }
  for (const p of G.pens) drawFighter(cx, G, p, ts);
  const a = G.aim || G.raim;
  if (a && G.phase === 'aim') drawAim(cx, a);
  for (const q of G.parts) { cx.globalAlpha = Math.max(0, q.l / q.m); cx.fillStyle = q.c; cx.beginPath(); cx.arc(q.x, q.y, q.s, 0, 7); cx.fill(); }
  // Shockwave rings from boosted shots and hits.
  for (const r of G.rings || []) {
    const k = 1 - r.l / r.m;
    cx.globalAlpha = Math.max(0, r.l / r.m); cx.strokeStyle = r.c; cx.lineWidth = r.w * (1 - k * 0.7);
    cx.beginPath(); cx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * k, 0, 7); cx.stroke();
    if (r.bolt) { // lightning spokes for Speed
      cx.lineWidth = 3;
      for (let n = 0; n < 6; n++) {
        const a = n * 1.05 + r.seed, d0 = 14 + 40 * k, d1 = d0 + 30;
        cx.beginPath(); cx.moveTo(r.x + Math.cos(a) * d0, r.y + Math.sin(a) * d0);
        cx.lineTo(r.x + Math.cos(a + 0.18) * (d0 + d1) / 2, r.y + Math.sin(a + 0.18) * (d0 + d1) / 2);
        cx.lineTo(r.x + Math.cos(a) * d1, r.y + Math.sin(a) * d1); cx.stroke();
      }
    }
  }
  cx.globalAlpha = 1;
  // Full-screen colour flash.
  if (G.flash && G.flash.l > 0) {
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.globalAlpha = 0.32 * (G.flash.l / G.flash.m); cx.fillStyle = G.flash.c; cx.fillRect(0, 0, w, h);
    cx.globalAlpha = 1;
  }
}
