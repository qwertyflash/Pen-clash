// Live "chance to win the match" for each player.
//
// 1. This round: every pen still standing gets a strength from how far it is from the
//    edge (safer = stronger), a bonus if it is their turn, heavy pens a small edge,
//    frozen or booster-armed pens a bonus and damaged pens a small penalty.
//    A pen that is out has strength 0.
// 2. Future rounds are treated as even between the players still in the match.
// 3. A small exact calculation over the scoreboard (first to `target`) combines both.
import { edgeDist } from './arenas.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Probability each player wins the match from score `sc`, if every future round is won by j with probability u[j]. */
function fromScore(sc, u, target, memo) {
  const key = sc.join(',');
  if (memo.has(key)) return memo.get(key);
  const n = sc.length;
  let out;
  const w = sc.findIndex((s) => s >= target);
  if (w >= 0) out = sc.map((_, i) => (i === w ? 1 : 0));
  else {
    out = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      if (!u[j]) continue;
      const next = sc.slice(); next[j]++;
      const r = fromScore(next, u, target, memo);
      for (let i = 0; i < n; i++) out[i] += u[j] * r[i];
    }
  }
  memo.set(key, out);
  return out;
}

const norm = (v) => { const t = v.reduce((a, b) => a + b, 0); return t > 0 ? v.map((x) => x / t) : v; };

/**
 * @param {object} m  { pens, inMatch:boolean[], sc:number[], turn, phase, winner, arena, target }
 * @returns {number[]} win probability per player (sums to 1)
 */
export function winOdds(m) {
  const n = m.sc.length;
  if (m.phase === 'over' && m.winner >= 0) return m.sc.map((_, i) => (i === m.winner ? 1 : 0));
  const u = norm(m.inMatch.map((a) => (a ? 1 : 0)));
  const memo = new Map();
  // Between rounds the point is already on the board.
  if (m.phase !== 'aim' && m.phase !== 'moving') return fromScore(m.sc, u, m.target, memo);

  const str = m.pens.map((p, i) => {
    if (!m.inMatch[i] || !p.alive) return 0;
    const safe = clamp01(edgeDist(m.arena, p.x, p.y) / m.arena.r);
    let s = Math.pow(0.12 + safe, 1.6) * (0.85 + 0.15 * p.m);
    if (p.frozen) s *= 1.4; // hard to knock off until their next turn
    if (p.arm) s *= 1.15; // a Speed or Fire shot is coming
    s *= 1 - (p.dmg || 0) / 400;
    if (m.phase === 'aim' && i === m.turn) s *= 1.3;
    return s;
  });
  const round = norm(str);
  if (!round.some((x) => x > 0)) return fromScore(m.sc, u, m.target, memo);
  const out = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    if (!round[j]) continue;
    const next = m.sc.slice(); next[j]++;
    const r = fromScore(next, u, m.target, memo);
    for (let i = 0; i < n; i++) out[i] += round[j] * r[i];
  }
  return out;
}
