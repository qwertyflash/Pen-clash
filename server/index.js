// Pen Clash server: serves the built game (dist/) and runs a WebSocket relay for
// online matches at /ws. Run `npm run build` first, then `npm start`.
//
// The relay is deliberately dumb: it forwards each message to everyone else in the
// same room (the 4-letter match code) and announces when someone disconnects. All game
// rules run in the players' browsers.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 3000;
const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
// Testing only: drop this share of relayed messages to simulate a bad network.
const DROP = Math.min(0.9, Number(process.env.RELAY_DROP_RATE) || 0);
const MAX_MSG = 64 * 1024, MAX_PER_ROOM = 8, MAX_ROOMS = 5000, MSGS_PER_SEC = 60;

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

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const rooms = new Map();

const server = createServer((req, res) => {
  if (req.url.startsWith('/api/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, relay: true, rooms: rooms.size }));
    return;
  }
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
