import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundRobin, newTournament, standings, readTournament } from '../src/core/tournament.js';
import { emptyBoard, recordMatch, recordTournament, rankBoard, sanitizeBoard } from '../src/core/leaderboard.js';

test('round robin: every pair plays exactly once', () => {
  for (let n = 2; n <= 8; n++) {
    const f = roundRobin(n);
    assert.equal(f.length, (n * (n - 1)) / 2, `n=${n}`);
    const seen = new Set(f.map(([a, b]) => [Math.min(a, b), Math.max(a, b)].join('-')));
    assert.equal(seen.size, f.length, `no repeats for n=${n}`);
    assert.ok(f.every(([a, b]) => a !== b && a < n && b < n));
  }
});

test('standings: 3 points a win, then rounds difference', () => {
  const t = newTournament([{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }, { id: 'c', name: 'Cy' }], 2);
  t.r = [{ a: 0, b: 1, w: 0, sa: 2, sb: 1 }, { a: 1, b: 2, w: 1, sa: 2, sb: 0 }, { a: 0, b: 2, w: 2, sa: 0, sb: 2 }];
  const s = standings(t);
  assert.deepEqual(s.map((r) => r.pts), [3, 3, 3]);
  assert.equal(s[0].name, 'Bo'); // +1 rounds difference beats 0 and -1
  assert.deepEqual(s.map((r) => r.p), [2, 2, 2]);
});

test('tournament objects from the network are checked', () => {
  assert.equal(readTournament({ m: [{ id: 'a', name: 'x' }] }), null);
  const t = readTournament({ id: 'z', m: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], s: [[0, 1], [0, 9]], i: 0, r: [{ a: 0, b: 1, w: 7, sa: 1, sb: 0 }], tg: 9 });
  assert.equal(t.s.length, 1);
  assert.equal(t.r[0].w, -1);
  assert.equal(t.tg, 3);
});

test('leaderboard: wins, streaks, trophies and ranking', () => {
  const b = emptyBoard();
  recordMatch(b, { players: [{ name: 'Ann', won: true, rounds: 3 }, { name: 'Bo', won: false, rounds: 1 }] });
  recordMatch(b, { players: [{ name: 'ann ', won: true, rounds: 3 }, { name: 'Bo', won: false, rounds: 2 }] });
  recordMatch(b, { players: [{ name: 'Ann', won: false, rounds: 0 }, { name: 'Bo', won: true, rounds: 3 }] });
  recordTournament(b, 'Bo');
  const r = rankBoard(b);
  assert.equal(r[0].name, 'Bo'); // trophies first
  const ann = r.find((e) => e.name === 'Ann');
  assert.deepEqual([ann.played, ann.wins, ann.best, ann.streak, ann.rounds], [3, 2, 2, 0, 6]);
  assert.deepEqual(sanitizeBoard(JSON.parse(JSON.stringify(b))), b);
  assert.deepEqual(sanitizeBoard({ players: { x: { name: 5 } } }).players, { 5: { name: '5', played: 0, wins: 0, rounds: 0, tours: 0, streak: 0, best: 0, last: 0 } });
});
