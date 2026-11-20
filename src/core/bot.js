// Inkbot: tries random shots in a copy of the world and keeps the best one.
import { MAXJ } from './constants.js';
import { edgeDist } from './arenas.js';
import { step, moving, flickPen, armShot, envOf } from './physics.js';

function scoreSim(pens, env, i, t, jx, jy) {
  // Simulate on copies so the real pens, boosters and flood are untouched.
  const P = pens.map((p) => ({ ...p, segs: p.segs.slice() }));
  const E = { arena: env.arena, flood: env.flood, boosters: env.boosters.map((b) => ({ ...b })) };
  const ar = env.arena;
  armShot(P[i]);
  flickPen(P[i], t, jx, jy);
  for (let k = 0; k < 720; k++) { step(P, 1 / 120, null, E); if (k % 30 === 29 && !moving(P)) break; }
  const me = P[i];
  let s = me.alive ? edgeDist(ar, me.x, me.y) / 5 + (me.got ? 25 : 0) : -170;
  for (const op of P) {
    if (op === me || !pens[op.i].alive) continue;
    s += op.alive ? -edgeDist(ar, op.x, op.y) / 8 : 100;
  }
  return s;
}

/** Plan a shot for pen i at difficulty df (0 easy, 1 pro, 2 insane). env = { arena, boosters, flood }. */
export function botPlan(pens, envIn, i, df) {
  const env = envOf(envIn), ar = env.arena;
  const me = pens[i], N = [16, 45, 90][df];
  const foes = pens.filter((p) => p !== me && p.alive);
  // Prefer the opponent closest to falling off.
  foes.sort((a, b) => edgeDist(ar, a.x, a.y) - edgeDist(ar, b.x, b.y));
  let best = null;
  for (let k = 0; k < N; k++) {
    const op = foes[Math.random() < 0.6 ? 0 : (Math.random() * foes.length) | 0] || me;
    const t = (Math.random() - 0.5) * 0.8, u = (Math.random() - 0.5) * 0.8;
    const tx = op.x + Math.cos(op.a) * u * op.L, ty = op.y + Math.sin(op.a) * u * op.L;
    const gx = me.x + Math.cos(me.a) * t * me.L, gy = me.y + Math.sin(me.a) * t * me.L;
    const an = Math.atan2(ty - gy, tx - gx) + (Math.random() - 0.5) * (k < N * 0.6 ? 0.3 : 2.4);
    const pw = MAXJ * (0.3 + Math.random() * 0.7), jx = Math.cos(an) * pw, jy = Math.sin(an) * pw;
    const s = scoreSim(pens, env, i, t, jx, jy);
    if (!best || s > best.s) best = { t, jx, jy, s };
  }
  const nz = [0.2, 0.06, 0.012][df];
  const a = Math.atan2(best.jy, best.jx) + (Math.random() - 0.5) * 2 * nz;
  const m = Math.hypot(best.jx, best.jy) * (1 + (Math.random() - 0.5) * nz * 1.5);
  return { t: best.t, jx: Math.cos(a) * m, jy: Math.sin(a) * m };
}
