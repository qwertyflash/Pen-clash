import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CX, CY } from '../src/core/constants.js';
import { arenaById } from '../src/core/arenas.js';
import { winOdds } from '../src/core/odds.js';

const arena = arenaById('classic');
const pen = (x, y, alive = true) => ({ x, y, alive, m: 1 });
const base = (o) => ({ phase: 'aim', turn: 0, winner: -1, arena, target: 3, ...o });
const sum = (v) => v.reduce((a, b) => a + b, 0);

test('even start is even', () => {
  const o = winOdds(base({ pens: [pen(CX - 175, CY), pen(CX + 175, CY)], inMatch: [true, true], sc: [0, 0], phase: 'between' }));
  assert.ok(Math.abs(o[0] - 0.5) < 1e-9 && Math.abs(sum(o) - 1) < 1e-9);
});

test('a pen near the edge is less likely to win', () => {
  const o = winOdds(base({ pens: [pen(CX, CY), pen(CX + 350, CY)], inMatch: [true, true], sc: [0, 0], turn: 1 }));
  assert.ok(o[0] > o[1]);
});

test('score lead counts, and match point is near certain once the other pen is out', () => {
  const lead = winOdds(base({ pens: [pen(CX - 175, CY), pen(CX + 175, CY)], inMatch: [true, true], sc: [2, 0], phase: 'between' }));
  assert.ok(lead[0] > 0.8);
  const won = winOdds(base({ pens: [pen(CX, CY), pen(CX + 400, CY, false)], inMatch: [true, true], sc: [2, 0], phase: 'moving' }));
  assert.ok(Math.abs(won[0] - 1) < 1e-9);
});

test('four players, one left the match', () => {
  const o = winOdds(base({ pens: [pen(400, 500), pen(600, 500), pen(500, 400), pen(0, 0, false)], inMatch: [true, true, true, false], sc: [0, 0, 0, 0] }));
  assert.equal(o[3], 0);
  assert.ok(Math.abs(sum(o) - 1) < 1e-9);
});

test('match over', () => {
  assert.deepEqual(winOdds(base({ pens: [], inMatch: [true, true, true], sc: [3, 1, 0], phase: 'over', winner: 0 })), [1, 0, 0]);
});
