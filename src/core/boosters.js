// Boosters that pop up on the arena. Only the device running the real match (offline,
// or the online host) decides when and where; everyone else receives the list.
//   freeze - your pen turns to ice: very heavy and hard to knock off until your next turn
//   speed  - your next shot is 50% stronger and glides further
//   fire   - your next shot sets your pen on fire: pens you hit fly back harder and take double damage
import { edgeDist } from './arenas.js';

export const BOOSTERS = {
  freeze: { name: 'Freeze', col: '#7fe3ff', desc: 'Frozen solid until your next turn' },
  speed: { name: 'Speed', col: '#ffe23d', desc: 'Next shot is 50% stronger' },
  fire: { name: 'Fire', col: '#ff7a1a', desc: 'Next shot hits extra hard' },
};
const KINDS = Object.keys(BOOSTERS);
export const MAX_BOOSTERS = 2;

let nextId = 1;

/** Try to drop one booster somewhere free. Returns it, or null if no room was found. */
export function spawnBooster(env, pens, rnd = Math.random) {
  if (env.boosters.length >= MAX_BOOSTERS) return null;
  const ar = env.arena;
  for (let tries = 0; tries < 40; tries++) {
    const x = 500 + (rnd() * 2 - 1) * ar.r, y = 500 + (rnd() * 2 - 1) * ar.r;
    if (edgeDist(ar, x, y) < 70) continue;
    if (ar.obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + 45)) continue;
    if (pens.some((p) => p.alive && Math.hypot(p.x - x, p.y - y) < p.L / 2 + 40)) continue;
    if (env.boosters.some((b) => Math.hypot(b.x - x, b.y - y) < 120)) continue;
    const b = { id: nextId++, k: KINDS[(rnd() * KINDS.length) | 0], x: Math.round(x), y: Math.round(y) };
    env.boosters.push(b);
    return b;
  }
  return null;
}

/** Compact form for sending online. */
export const packBoosters = (env) => env.boosters.filter((b) => !b.taken).map((b) => [b.id, b.k, b.x, b.y]);

export function unpackBoosters(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, MAX_BOOSTERS + 2)
    .filter((q) => Array.isArray(q) && KINDS.includes(q[1]))
    .map((q) => ({ id: q[0] | 0, k: q[1], x: +q[2] || 500, y: +q[3] || 500 }));
}
