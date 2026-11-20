import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PENS, CX, CY } from '../src/core/constants.js';
import { arenaById } from '../src/core/arenas.js';
import { mkPen, step, moving, flickPen, armShot, packPen, unpackExtras, BREAK_HITS } from '../src/core/physics.js';
import { spawnBooster, packBoosters, unpackBoosters } from '../src/core/boosters.js';

const arena = arenaById('classic');
const env = () => ({ arena, boosters: [], flood: null });
function runUntilStill(P, E, max = 240 * 8) {
  const ev = [];
  for (let k = 0; k < max && (k < 5 || moving(P)); k++) step(P, 1 / 240, ev, E);
  return ev;
}
const pair = () => [mkPen(0, PENS[0], CX - 120, CY, Math.PI / 2), mkPen(1, PENS[0], CX + 40, CY, Math.PI / 2)];

test('hits leave damage on both pens', () => {
  const P = pair(), E = env();
  flickPen(P[0], 0, 900, 0);
  runUntilStill(P, E);
  assert.ok(P[0].dmg > 0 && P[1].dmg > 0);
});

test('fire hits harder and does double damage', () => {
  const a = pair(), b = pair();
  b[0].arm = 'fire'; armShot(b[0]);
  flickPen(a[0], 0, 700, 0); flickPen(b[0], 0, 700, 0);
  runUntilStill(a, env()); runUntilStill(b, env());
  assert.ok(b[1].x > a[1].x + 15, 'fire knockback');
  assert.ok(b[1].dmg > a[1].dmg * 1.5, 'fire damage');
});

test('speed makes the next shot stronger', () => {
  const a = [mkPen(0, PENS[0], CX - 200, CY, Math.PI / 2)], b = [mkPen(0, PENS[0], CX - 200, CY, Math.PI / 2)];
  b[0].arm = 'speed'; armShot(b[0]);
  flickPen(a[0], 0, 500, 0); flickPen(b[0], 0, 500, 0);
  runUntilStill(a, env()); runUntilStill(b, env());
  assert.ok(b[0].x > a[0].x + 40);
});

test('a frozen pen barely moves when hit', () => {
  const a = pair(), b = pair();
  b[1].frozen = true;
  flickPen(a[0], 0, 900, 0); flickPen(b[0], 0, 900, 0);
  runUntilStill(a, env()); runUntilStill(b, env());
  assert.ok(b[1].x - (CX + 40) < (a[1].x - (CX + 40)) / 3);
});

test('a pen collects a booster it slides over', () => {
  const P = [mkPen(0, PENS[0], CX - 200, CY, Math.PI / 2)], E = env();
  E.boosters.push({ id: 1, k: 'speed', x: CX - 60, y: CY });
  flickPen(P[0], 0, 700, 0);
  const ev = runUntilStill(P, E);
  assert.equal(P[0].got, 'speed');
  assert.ok(ev.some((e) => e.t === 'pick'));
  assert.equal(packBoosters(E).length, 0);
});

test(`${BREAK_HITS} hard hits on the same spot break a pen and flood the arena`, () => {
  const E = env();
  let target = mkPen(1, PENS[0], CX + 40, CY, Math.PI / 2), broke = null;
  for (let k = 0; k < BREAK_HITS + 2 && !broke; k++) {
    const shooter = mkPen(0, PENS[1], CX - 120, CY, Math.PI / 2);
    target.x = CX + 40; target.y = CY; target.a = Math.PI / 2; target.vx = target.vy = target.w = 0;
    flickPen(shooter, 0, 1104, 0);
    const ev = runUntilStill([shooter, target], E);
    broke = ev.find((e) => e.t === 'break');
  }
  assert.ok(broke, 'pen should break');
  assert.ok(target.broken >= 0 && E.flood && E.flood.col === PENS[0].ink);
  // The flood makes the arena more slippery.
  const dry = [mkPen(0, PENS[0], CX - 200, CY, Math.PI / 2)], wet = [mkPen(0, PENS[0], CX - 200, CY, Math.PI / 2)];
  flickPen(dry[0], 0, 500, 0); flickPen(wet[0], 0, 500, 0);
  runUntilStill(dry, env()); runUntilStill(wet, { arena, boosters: [], flood: E.flood });
  assert.ok(wet[0].x > dry[0].x + 20);
  assert.ok(wet[0].stain > 0, 'pens sliding through ink get stained');
});

test('pen state survives being sent online', () => {
  const p = mkPen(0, PENS[2], 400, 500, 1.2);
  Object.assign(p, { dmg: 42.37, broken: 3, frozen: true, arm: 'fire', stain: 0.456, got: 'speed' });
  p.segs = [0, 1, 0, 3, 2];
  const q = mkPen(0, PENS[2], 0, 0, 0);
  unpackExtras(q, JSON.parse(JSON.stringify(packPen(p))));
  assert.deepEqual([q.dmg, q.segs, q.broken, q.frozen, q.arm, q.stain, q.got], [42.4, [0, 1, 0, 3, 2], 3, true, 'fire', 0.46, 'speed']);
});

test('boosters spawn in free spots and round-trip', () => {
  const E = env(), P = [mkPen(0, PENS[0], CX - 175, CY, Math.PI / 2), mkPen(1, PENS[0], CX + 175, CY, Math.PI / 2)];
  for (let k = 0; k < 5; k++) spawnBooster(E, P);
  assert.equal(E.boosters.length, 2);
  for (const b of E.boosters) for (const p of P) assert.ok(Math.hypot(b.x - p.x, b.y - p.y) > p.L / 2);
  assert.deepEqual(unpackBoosters(JSON.parse(JSON.stringify(packBoosters(E)))).map((b) => b.k), E.boosters.map((b) => b.k));
});
