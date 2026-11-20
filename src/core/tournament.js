// Round-robin tournaments: everyone plays everyone once, 1-on-1.
// A tournament object is small enough to send online as-is:
//   { id, m: [{id, name}], s: [[a, b], ...], i, r: [{a, b, w, sa, sb}], tg, done }
// m = members, s = fixtures (member indexes), i = next fixture, r = results (w = winner
// member index, -1 for a void match), tg = rounds needed to win a match.

export const MAX_TOUR = 8;

/** Fixture list for n members (circle method), spread so nobody plays twice in a row when possible. */
export function roundRobin(n) {
  const ids = [...Array(n).keys()];
  if (n % 2) ids.push(-1);
  const m = ids.length, out = [];
  for (let r = 0; r < m - 1; r++) {
    for (let k = 0; k < m / 2; k++) {
      const a = ids[k], b = ids[m - 1 - k];
      if (a >= 0 && b >= 0) out.push(r % 2 ? [b, a] : [a, b]);
    }
    ids.splice(1, 0, ids.pop());
  }
  return out;
}

export function newTournament(members, target) {
  return { id: Math.random().toString(36).slice(2, 10), m: members, s: roundRobin(members.length), i: 0, r: [], tg: target, done: false };
}

/** Table rows, best first: points (3 per win), then rounds difference, then rounds won. */
export function standings(t) {
  const rows = t.m.map((p, i) => ({ i, name: p.name, p: 0, w: 0, l: 0, rw: 0, rl: 0, pts: 0 }));
  for (const r of t.r) {
    const A = rows[r.a], B = rows[r.b];
    if (!A || !B || r.w < 0) continue;
    A.p++; B.p++;
    A.rw += r.sa; A.rl += r.sb; B.rw += r.sb; B.rl += r.sa;
    const W = r.w === r.a ? A : B, L = W === A ? B : A;
    W.w++; W.pts += 3; L.l++;
  }
  return rows.sort((x, y) => y.pts - x.pts || (y.rw - y.rl) - (x.rw - x.rl) || y.rw - x.rw || x.name.localeCompare(y.name));
}

/** Check a tournament object received from the network. */
export function readTournament(t) {
  if (!t || typeof t !== 'object' || !Array.isArray(t.m) || t.m.length < 2 || t.m.length > MAX_TOUR || !Array.isArray(t.s) || !Array.isArray(t.r)) return null;
  const n = t.m.length, ok = (v) => Number.isInteger(v) && v >= 0 && v < n;
  return {
    id: String(t.id || '').slice(0, 12),
    m: t.m.map((p) => ({ id: String((p && p.id) || '').slice(0, 40), name: String((p && p.name) || 'Player').slice(0, 14) })),
    s: t.s.filter((f) => Array.isArray(f) && ok(f[0]) && ok(f[1])).slice(0, 64),
    i: Math.max(0, t.i | 0),
    r: t.r.filter((r) => r && ok(r.a) && ok(r.b)).map((r) => ({ a: r.a, b: r.b, w: ok(r.w) ? r.w : -1, sa: r.sa | 0, sb: r.sb | 0 })).slice(0, 64),
    tg: Math.min(3, Math.max(1, t.tg | 0)),
    done: !!t.done,
  };
}
