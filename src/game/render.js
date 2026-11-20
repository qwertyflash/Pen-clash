import { CX, CY, R, KJ, MAXJ, COL } from '../core/constants.js';
import { $ } from '../core/util.js';
import { drawPen, drawBadge, rr } from '../ui/draw.js';
import { arenaC, inkC, trail } from '../ui/arena.js';
import { S } from './state.js';

export const cv = $('#cv');
const cx = cv.getContext('2d');
let dpr = 1;
let view = { s: 1, ox: 0, oy: 0 };

export function resize() {
  const r = cv.parentElement.getBoundingClientRect();
  if (!r.width) return;
  dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const s = Math.min(r.width, r.height) / (2 * R + 70);
  view = { s, ox: r.width / 2 - CX * s, oy: r.height / 2 - CY * s };
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

export function render(ts) {
  const G = S.G;
  const w = cv.width / dpr, h = cv.height / dpr;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, w, h);
  const sh = G.shake > 0.3 ? G.shake : 0;
  cx.translate(view.ox + (Math.random() - 0.5) * sh * view.s, view.oy + (Math.random() - 0.5) * sh * view.s);
  cx.scale(view.s, view.s);
  cx.drawImage(arenaC, -30, -30);
  G.pens.forEach(trail);
  cx.drawImage(inkC, 0, 0);
  if (G.phase === 'aim') {
    const p = G.pens[G.turn], pulse = 0.5 + 0.5 * Math.sin(ts / 220);
    cx.save(); cx.translate(p.x, p.y); cx.rotate(p.a); cx.strokeStyle = COL[G.turn]; cx.globalAlpha = 0.35 + 0.35 * pulse; cx.lineWidth = 12;
    rr(cx, -p.L / 2 - 10, -p.r - 10, p.L + 20, 2 * p.r + 20, p.r + 10); cx.stroke(); cx.restore();
  }
  for (const p of G.pens) {
    const sc = 1 - 0.55 * p.fall, al = 1 - p.fall;
    if (al <= 0) continue;
    drawPen(cx, p.d, p.x, p.y, p.a, sc, al);
    cx.globalAlpha = al; drawBadge(cx, p.x, p.y, G.pl[p.i].av, COL[p.i], sc); cx.globalAlpha = 1;
  }
  const a = G.aim || G.raim;
  if (a && G.phase === 'aim') drawAim(cx, a);
  for (const q of G.parts) { cx.globalAlpha = Math.max(0, q.l / q.m); cx.fillStyle = q.c; cx.beginPath(); cx.arc(q.x, q.y, q.s, 0, 7); cx.fill(); }
  cx.globalAlpha = 1;
}
