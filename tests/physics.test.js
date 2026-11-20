import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PENS, CX, CY } from '../src/core/constants.js';
import { ARENAS, arenaById, spawnPoints, inside, edgeDist } from '../src/core/arenas.js';
import { mkPen, step, moving, flickPen } from '../src/core/physics.js';

const classic = arenaById('classic');

function run(jx, jy, ar = classic, n = 2) {
  const P = spawnPoints(n).map(([x, y, a], i) => mkPen(i, PENS[i === 0 ? 0 : 3], x, y, a));
  flickPen(P[0], 0.1, jx, jy);
  let k = 0;
  while ((moving(P) || k < 10) && k < 240 * 20) { step(P, 1 / 240, [], ar); k++; }
  return P;
}

test('a flick moves the pen and it comes to rest', () => {
  const P = run(500, 0);
  assert.ok(P[0].x > CX - 175, 'pen should move right');
  assert.equal(moving(P), false);
});

test('the same shot gives the same result (guests replay shots locally)', () => {
  for (const ar of ARENAS) {
    const a = run(900, 40, ar, 3), b = run(900, 40, ar, 3);
    assert.deepEqual(a.map((p) => [p.x, p.y, p.a, p.alive]), b.map((p) => [p.x, p.y, p.a, p.alive]), ar.id);
  }
});

test('hitting the other pen pushes it away', () => {
  const P = run(1104, 0);
  assert.ok(!P[1].alive || P[1].x > CX + 175 + 20, 'the other pen should be knocked back or off');
});

test('pens glide further on ice', () => {
  const normal = run(400, 0), ice = run(400, 0, arenaById('ice'));
  assert.ok(ice[0].x > normal[0].x + 20 || !ice[0].alive);
});

test('erasers block a straight shot through the middle', () => {
  const P = [mkPen(0, PENS[0], CX - 200, CY, Math.PI / 2)];
  flickPen(P[0], 0, 700, 0);
  for (let k = 0; k < 240 * 5; k++) step(P, 1 / 240, [], arenaById('erasers'));
  assert.ok(P[0].x < CX, 'pen should bounce off the centre eraser');
});

test('every arena has room for 2-4 pens at the start', () => {
  for (const ar of ARENAS) for (let n = 2; n <= 4; n++) {
    const P = spawnPoints(n).map(([x, y, a], i) => mkPen(i, PENS[i % PENS.length], x, y, a));
    step(P, 1 / 240, [], ar);
    for (const p of P) {
      assert.ok(p.alive && inside(ar, p.x, p.y) && edgeDist(ar, p.x, p.y) > 60, `${ar.id} n=${n}`);
      assert.ok(Math.hypot(p.vx, p.vy) < 1e-9, `${ar.id} n=${n}: pens overlap something at the start`);
    }
  }
});
