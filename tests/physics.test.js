import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PENS, CX, CY } from '../src/core/constants.js';
import { mkPen, step, moving, flickPen } from '../src/core/physics.js';

function run(jx, jy) {
  const P = [mkPen(0, PENS[0], CX - 175, CY, Math.PI / 2), mkPen(1, PENS[3], CX + 175, CY, Math.PI / 2)];
  flickPen(P[0], 0.1, jx, jy);
  let n = 0;
  while ((moving(P) || n < 10) && n < 240 * 20) { step(P, 1 / 240, []); n++; }
  return P;
}

test('a flick moves the pen and it comes to rest', () => {
  const P = run(500, 0);
  assert.ok(P[0].x > CX - 175, 'pen should move right');
  assert.equal(moving(P), false);
});

test('the same shot gives the same result (guests replay shots locally)', () => {
  const a = run(900, 40), b = run(900, 40);
  assert.deepEqual(a.map((p) => [p.x, p.y, p.a, p.alive]), b.map((p) => [p.x, p.y, p.a, p.alive]));
});

test('hitting the other pen pushes it away', () => {
  const P = run(1104, 0);
  assert.ok(!P[1].alive || P[1].x > CX + 175 + 20, 'the other pen should be knocked back or off');
});
