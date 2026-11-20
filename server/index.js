// Pen Clash server: serves the built game (dist/) and runs a WebSocket relay for
// online matches at /ws. Run `npm run build` first, then `npm start`.
//
// The relay is deliberately dumb: it forwards each message to everyone else in the
// same room (the 4-letter match code) and announces when someone disconnects. All game
// rules run in the players' browsers.
import { createServer } from 'node:http';
import { readFile, stat, writeFile, mkdir, rename } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { emptyBoard, recordMatch, recordTournament, rankBoard, sanitizeBoard } from '../src/core/leaderboard.js';

const PORT = Number(process.env.PORT) || 3000;
const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
// Testing only: drop this share of relayed messages to simulate a bad network.
const DROP = Math.min(0.9, Number(process.env.RELAY_DROP_RATE) || 0);
const MAX_MSG = 64 * 1024, MAX_PER_ROOM = 8, MAX_ROOMS = 5000, MSGS_PER_SEC = 60;
// Shared leaderboard, saved as JSON. On hosts with a temporary disk, point DATA_DIR at a persistent volume.
const DATA_DIR = resolve(process.env.DATA_DIR || fileURLToPath(new URL('../data', import.meta.url)));
const BOARD_FILE = join(DATA_DIR, 'leaderboard.json');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(DIST, path));
  if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
  let target = file;
  try { if (!(await stat(target)).isFile()) throw 0; } catch { target = join(DIST, 'index.html'); }
  try {
    const body = await readFile(target);
    const isAsset = target.includes(sep + 'assets' + sep);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] || 'application/octet-stream',
      // Hashed assets never change; the page itself must always be re-checked so
      // players never get stuck on an old version.
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not built yet. Run "npm run build".');
  }
}

/* ---------- shared leaderboard ---------- */
let board = emptyBoard(), saveTimer = 0;
readFile(BOARD_FILE, 'utf8').then((t) => { board = sanitizeBoard(JSON.parse(t)); }).catch(() => {});
function saveBoard() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(BOARD_FILE + '.tmp', JSON.stringify(board));
      await rename(BOARD_FILE + '.tmp', BOARD_FILE);
    } catch (e) { console.error('Could not save leaderboard:', e.message); }
  }, 1000);
}

// Results are sent by players' browsers, so keep each address to a sane rate.
const posts = new Map();
const allowPost = (ip) => {
  const now = Date.now(), list = (posts.get(ip) || []).filter((t) => now - t < 60000);
  if (list.length >= 30) return false;
  list.push(now); posts.set(ip, list);
  return true;
};

function readJson(req) {
  return new Promise((res, rej) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8192) { req.destroy(); rej(new Error('too big')); } });
    req.on('end', () => { try { res(JSON.parse(body)); } catch (e) { rej(e); } });
    req.on('error', rej);
  });
}

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

async function handleResults(req, res) {
  if (!allowPost(req.socket.remoteAddress || '?')) return json(res, 429, { ok: false });
  let b;
  try { b = await readJson(req); } catch { return json(res, 400, { ok: false }); }
  if (b && b.kind === 'match' && Array.isArray(b.players) && b.players.length >= 1 && b.players.length <= 8) {
    recordMatch(board, { players: b.players.map((p) => ({ name: String((p && p.name) || ''), won: !!(p && p.won), rounds: (p && p.rounds) | 0 })) });
  } else if (b && b.kind === 'tournament' && typeof b.champ === 'string') {
    recordTournament(board, b.champ);
  } else return json(res, 400, { ok: false });
  saveBoard();
  json(res, 200, { ok: true });
}

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const rooms = new Map();

const server = createServer((req, res) => {
  if (req.url.startsWith('/api/health')) return json(res, 200, { ok: true, relay: true, board: true, rooms: rooms.size });
  if (req.url.startsWith('/api/leaderboard') && req.method === 'GET') return json(res, 200, { players: rankBoard(board, 100) });
  if (req.url.startsWith('/api/results') && req.method === 'POST') { handleResults(req, res).catch(() => json(res, 500, { ok: false })); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  serveStatic(req, res).catch(() => res.writeHead(500).end());
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const room = (url.searchParams.get('room') || '').toLowerCase();
  const id = url.searchParams.get('id') || '';
  if (url.pathname !== '/ws' || !/^[a-z0-9]{4}$/.test(room) || !/^[a-z0-9]{4,40}$/i.test(id)) { socket.destroy(); return; }
  const peers = rooms.get(room);
  if ((peers && peers.size >= MAX_PER_ROOM) || (!peers && rooms.size >= MAX_ROOMS)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => joinRoom(ws, room, id));
});

function joinRoom(ws, room, id) {
  let peers = rooms.get(room);
  if (!peers) { peers = new Set(); rooms.set(room, peers); }
  // Same id reconnecting: drop the stale socket.
  for (const p of peers) if (p.peerId === id) { peers.delete(p); p.terminate(); }
  ws.peerId = id; ws.alive = true; ws.budget = MSGS_PER_SEC; ws.budgetAt = Date.now();
  peers.add(ws);

  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const now = Date.now();
    ws.budget = Math.min(MSGS_PER_SEC, ws.budget + ((now - ws.budgetAt) / 1000) * MSGS_PER_SEC);
    ws.budgetAt = now;
    if (ws.budget < 1) return; // flooding: drop
    ws.budget -= 1;
    const s = data.toString();
    for (const p of peers) if (p !== ws && p.readyState === 1 && !(DROP && Math.random() < DROP)) p.send(s);
  });
  ws.on('close', () => {
    if (!peers.delete(ws)) return;
    const bye = JSON.stringify({ k: 'x', id });
    for (const p of peers) if (p.readyState === 1) p.send(bye);
    if (!peers.size) rooms.delete(room);
  });
}

// Drop connections that stopped answering pings.
const sweep = setInterval(() => {
  for (const peers of rooms.values()) for (const ws of peers) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 15000);

server.listen(PORT, () => console.log(`Pen Clash running on http://localhost:${PORT}`));

const shutdown = () => { clearInterval(sweep); wss.clients.forEach((c) => c.close()); server.close(() => process.exit(0)); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { server };
