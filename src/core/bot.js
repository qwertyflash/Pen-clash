// Inkbot: tries random shots in a copy of the world and keeps the best one.
import { CX, CY, MAXJ } from './constants.js';
import { step, moving, flickPen } from './physics.js';

function scoreSim(pens, i, t, jx, jy) {
  const P = pens.map((p) => ({ ...p }));
  flickPen(P[i], t, jx, jy);
  for (let k = 0; k < 720; k++) { step(P, 1 / 120, null); if (k % 30 === 29 && !moving(P)) break; }
  const me = P[i], op = P[1 - i];
  return (op.alive ? 0 : 100) - (me.alive ? 0 : 170) + Math.hypot(op.x - CX, op.y - CY) / 8 - Math.hypot(me.x - CX, me.y - CY) / 5;
}

/** Plan a shot for pen i at difficulty df (0 easy, 1 pro, 2 insane). */
export function botPlan(pens, i, df) {
  const me = pens[i], op = pens[1 - i], N = [16, 45, 90][df];
  let best = null;
  for (let k = 0; k < N; k++) {
    const t = (Math.random() - 0.5) * 0.8, u = (Math.random() - 0.5) * 0.8;
    const tx = op.x + Math.cos(op.a) * u * op.L, ty = op.y + Math.sin(op.a) * u * op.L;
    const gx = me.x + Math.cos(me.a) * t * me.L, gy = me.y + Math.sin(me.a) * t * me.L;
    const an = Math.atan2(ty - gy, tx - gx) + (Math.random() - 0.5) * (k < N * 0.6 ? 0.3 : 2.4);
    const pw = MAXJ * (0.3 + Math.random() * 0.7), jx = Math.cos(an) * pw, jy = Math.sin(an) * pw;
    const s = scoreSim(pens, i, t, jx, jy);
    if (!best || s > best.s) best = { t, jx, jy, s };
  }
  const nz = [0.2, 0.06, 0.012][df];
  const a = Math.atan2(best.jy, best.jx) + (Math.random() - 0.5) * 2 * nz;
  const m = Math.hypot(best.jx, best.jy) * (1 + (Math.random() - 0.5) * nz * 1.5);
  return { t: best.t, jx: Math.cos(a) * m, jy: Math.sin(a) * m };
}
