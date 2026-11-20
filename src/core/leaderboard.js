// Leaderboard stats, shared by the browser (this device's board) and the server
// (everyone's board). Players are keyed by name, case-insensitive.

export const emptyBoard = () => ({ v: 1, players: {} });

const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 14);
const keyOf = (n) => cleanName(n).toLowerCase();

function entry(board, name) {
  const k = keyOf(name);
  if (!k) return null;
  let e = board.players[k];
  if (!e) e = board.players[k] = { name: cleanName(name), played: 0, wins: 0, rounds: 0, tours: 0, streak: 0, best: 0, last: 0 };
  e.name = cleanName(name); // keep the latest spelling
  return e;
}

/**
 * Add one finished match.
 * @param {{players: {name: string, won: boolean, rounds: number}[], at?: number}} r
 */
export function recordMatch(board, r) {
  if (!r || !Array.isArray(r.players) || r.players.length < 1 || r.players.length > 8) return board;
  const at = typeof r.at === 'number' ? r.at : Date.now();
  for (const p of r.players) {
    const e = entry(board, p && p.name);
    if (!e) continue;
    e.played++;
    e.rounds += Math.max(0, Math.min(9, (p.rounds | 0)));
    if (p.won) { e.wins++; e.streak++; e.best = Math.max(e.best, e.streak); } else e.streak = 0;
    e.last = at;
  }
  return board;
}

/** A tournament was won by `name`. */
export function recordTournament(board, name) {
  const e = entry(board, name);
  if (e) { e.tours++; e.last = Date.now(); }
  return board;
}

/** Players sorted best first: wins, then win rate, then rounds won. */
export function rankBoard(board, limit = 100) {
  return Object.values(board.players || {})
    .filter((e) => e.played > 0 || e.tours > 0)
    .map((e) => ({ ...e, rate: e.played ? e.wins / e.played : 0 }))
    .sort((a, b) => b.tours - a.tours || b.wins - a.wins || b.rate - a.rate || b.rounds - a.rounds || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Make sure something loaded from storage has the right shape. */
export function sanitizeBoard(b) {
  const out = emptyBoard();
  if (!b || typeof b !== 'object' || !b.players || typeof b.players !== 'object') return out;
  for (const e of Object.values(b.players).slice(0, 5000)) {
    if (!e || typeof e !== 'object') continue;
    const k = keyOf(e.name);
    if (!k) continue;
    const n = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    out.players[k] = { name: cleanName(e.name), played: n(e.played), wins: n(e.wins), rounds: n(e.rounds), tours: n(e.tours), streak: n(e.streak), best: n(e.best), last: n(e.last) };
  }
  return out;
}
