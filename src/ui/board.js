// Leaderboard screen and result recording.
//  - "This device": stored in localStorage, always available.
//  - "Everyone": stored by the Node server (server/index.js) when the game is served by it.
import { $, $$, esc, store } from '../core/util.js';
import { emptyBoard, recordMatch, recordTournament, rankBoard, sanitizeBoard } from '../core/leaderboard.js';
import { relayAvailable } from '../net/bus-ws.js';
import { show } from './screens.js';

const RELAY_URL = (import.meta.env.VITE_RELAY_URL || '').replace(/\/$/, '');
let serverOk = null; // null = not checked yet
const serverUp = async () => (serverOk === null ? (serverOk = await relayAvailable(RELAY_URL)) : serverOk);

const loadLocal = () => sanitizeBoard(store.get('board', emptyBoard()));
const saveLocal = (b) => store.set('board', b);
const recorded = new Set(store.get('recorded', []));

function post(body) {
  serverUp().then((ok) => {
    if (!ok) return;
    fetch(RELAY_URL + '/api/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  });
}

/**
 * Save a finished match once. players: [{name, won, rounds}] (bots left out by the caller).
 * share: also send it to the server's shared board (offline games, or the online host).
 */
export function saveMatch(id, players, share) {
  if (!players.length || recorded.has(id)) return;
  recorded.add(id);
  store.set('recorded', [...recorded].slice(-200));
  saveLocal(recordMatch(loadLocal(), { players }));
  if (share) post({ kind: 'match', players });
}

export function saveTournament(id, champ, share) {
  const key = 'tour:' + id;
  if (!champ || recorded.has(key)) return;
  recorded.add(key);
  store.set('recorded', [...recorded].slice(-200));
  saveLocal(recordTournament(loadLocal(), champ));
  if (share) post({ kind: 'tournament', champ });
}

let tab = 'local';

function table(rows) {
  if (!rows.length) return '<p class="muted bnote">No matches yet. Finish a match and it shows up here.</p>';
  return `<table class="ttable board"><thead><tr><th>#</th><th>Player</th><th class="n">Played</th><th class="n">Wins</th><th class="n">Win %</th><th class="n">Rounds</th><th class="n">Trophies</th><th class="n">Best streak</th></tr></thead><tbody>${rows
    .map((e, i) => `<tr class="${i === 0 ? 'top' : ''}"><td>${i + 1}</td><td>${esc(e.name)}</td><td class="n">${e.played}</td><td class="n">${e.wins}</td><td class="n">${Math.round(e.rate * 100)}%</td><td class="n">${e.rounds}</td><td class="n">${e.tours ? '🏆 ' + e.tours : '–'}</td><td class="n">${e.best}</td></tr>`)
    .join('')}</tbody></table>`;
}

async function renderBoard() {
  $$('#board [data-tab]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tab === tab));
  $('#boardClear').hidden = tab !== 'local';
  if (tab === 'local') { $('#boardBody').innerHTML = table(rankBoard(loadLocal())); return; }
  $('#boardBody').innerHTML = '<p class="muted bnote">Loading…</p>';
  if (!(await serverUp())) {
    $('#boardBody').innerHTML = '<p class="muted bnote">The shared leaderboard needs the Pen Clash server (see the README: deploy on Render or with Docker). This copy of the game is on static hosting, so only “This device” is available.</p>';
    return;
  }
  try {
    const r = await fetch(RELAY_URL + '/api/leaderboard', { cache: 'no-store' });
    const j = await r.json();
    if (tab === 'server') $('#boardBody').innerHTML = table(Array.isArray(j.players) ? j.players : []);
  } catch {
    $('#boardBody').innerHTML = '<p class="muted bnote">Couldn’t load the shared leaderboard. Try again in a moment.</p>';
  }
}

export function initBoard() {
  $('#boardBtn').onclick = () => { tab = 'local'; renderBoard(); show('board'); };
  $$('#board [data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; renderBoard(); }; });
  $('#boardClear').onclick = () => {
    if (!confirm('Clear the leaderboard on this device?')) return;
    saveLocal(emptyBoard()); renderBoard();
  };
}
