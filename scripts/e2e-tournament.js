// End-to-end tournament test: N players join a room, the host starts a round-robin
// tournament, and everyone plays their matches with real mouse drags. Checks that
// every screen shows the same final table, and that the leaderboards were updated.
//
//   npm run build && npm run test:e2e:tour          # 3 players
//   E2E_PLAYERS=4 E2E_DROP=0.2 npm run test:e2e:tour
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 4100 + ((Math.random() * 800) | 0);
const PLAYERS = Math.max(2, Math.min(8, Number(process.env.E2E_PLAYERS) || 3));
const DROP = process.env.E2E_DROP || '0';
const BASE = `http://localhost:${PORT}/?test`;
const DATA_DIR = mkdtempSync(join(tmpdir(), 'penclash-'));

const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), RELAY_DROP_RATE: DROP, DATA_DIR }, stdio: ['ignore', 'pipe', 'inherit'] });
process.on('exit', () => srv.kill());
process.on('SIGTERM', () => process.exit(1));
process.on('unhandledRejection', (e) => { console.error('FAIL:', e && e.message); process.exit(1); });
await new Promise((res) => srv.stdout.on('data', (d) => String(d).includes('running') && res()));

const browser = await chromium.launch({ args: ['--no-proxy-server'] });
const pages = [];
const fail = async (msg) => {
  console.error('FAIL:', msg);
  for (const [k, p] of pages.entries()) console.error('player ' + k, JSON.stringify(await view(p)));
  await browser.close(); srv.kill(); process.exit(1);
};

const view = (p) => p.evaluate(() => {
  const { S } = window.__penclash, G = S.G, net = S.net, t = net && (net.tour || net.seenTour);
  return {
    mid: G && G.mid, phase: G && G.phase, turn: G && G.turn, me: G ? G.me : -2, sim: G && G.sim,
    names: G ? G.pl.map((p) => p.name) : [],
    tour: t ? { i: t.i, n: t.s.length, done: t.done, r: t.r.map((r) => [r.a, r.b, r.w]) } : null,
    picker: !document.querySelector('#picker').hidden && !!document.querySelector('#picker .pickPen:not([disabled])'),
    table: document.querySelector('#rTable').innerText,
    errors: S.errors,
  };
});

async function until(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  await fail('timed out waiting for ' + what);
}

async function flick(p, i) {
  const pt = await p.evaluate((i) => {
    const { S, toClient } = window.__penclash, G = S.G, me = G.pens[i];
    const foes = G.pens.filter((q) => q !== me && q.alive), op = foes[0];
    const ang = Math.atan2(op.y - me.y, op.x - me.x) + (Math.random() - 0.5) * 0.3, pull = 150 + Math.random() * 80;
    return { a: toClient(me.x, me.y), b: toClient(me.x - Math.cos(ang) * pull, me.y - Math.sin(ang) * pull) };
  }, i);
  await p.mouse.move(pt.a.x, pt.a.y); await p.mouse.down();
  for (let k = 1; k <= 8; k++) await p.mouse.move(pt.a.x + ((pt.b.x - pt.a.x) * k) / 8, pt.a.y + ((pt.b.y - pt.a.y) * k) / 8);
  await p.mouse.up();
}

for (let k = 0; k < PLAYERS; k++) {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
  page.on('pageerror', (e) => console.error(`page ${k} error:`, e.message));
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.goto(BASE);
  await page.click('[data-mode="online"]');
  await page.fill('.name[data-i="0"]', 'Player' + k);
  await page.click('#goBtn');
  pages.push(page);
}
const host = pages[0];
await host.click('#mkRoom');
await host.waitForFunction(() => document.querySelector('#codeBig').textContent.length === 4);
const code = await host.textContent('#codeBig');
for (const g of pages.slice(1)) { await g.fill('#codeIn', code); await g.click('#joinForm button'); }
await host.waitForFunction((n) => document.querySelectorAll('#lobbyList li').length === n && !document.querySelector('#tourBox').hidden, PLAYERS, { timeout: 30000 });
await host.click('#tourTarget [data-k="1"]');
await host.click('#tourBtn');

const matches = (PLAYERS * (PLAYERS - 1)) / 2;
let shots = 0, lastMid = null, played = 0;
while (true) {
  const h = await until(async () => { const v = await view(host); return v.mid && ['aim', 'over', 'pick'].includes(v.phase) ? v : null; }, 30000, 'host to be ready');
  if (h.tour && h.tour.done) break;
  if (h.mid !== lastMid) { lastMid = h.mid; played++; console.log(`match ${played}/${matches}: ${h.names.join(' vs ')}`); }
  if (h.phase === 'over') { await until(async () => { const v = await view(host); return v.mid !== h.mid || (v.tour && v.tour.done) ? v : null; }, 20000, 'next tournament match'); continue; }
  const views = await Promise.all(pages.map(view));
  if (h.phase === 'pick') {
    for (const [k, v] of views.entries()) if (v.picker) await pages[k].click('#picker .pickPen:not([disabled]) >> nth=0');
    await until(async () => (await view(host)).phase !== 'pick', 20000, 'pen picks');
    continue;
  }
  const k = views.findIndex((v) => v.mid === h.mid && v.me === h.turn);
  if (k < 0) await fail('nobody controls seat ' + h.turn);
  await until(async () => { const v = await view(pages[k]); return v.phase === 'aim' && v.turn === h.turn && !v.sim ? v : null; }, 15000, `player ${k} to see its turn`);
  await flick(pages[k], h.turn);
  await until(async () => { const v = await view(host); return v.mid !== h.mid || v.phase !== 'aim' || v.turn !== h.turn ? v : null; }, 15000, 'host to get the shot');
  if (++shots > 400) await fail('tournament is taking too long');
}

// Everyone ends on the same final table.
for (const [k, p] of pages.entries()) await until(async () => { const v = await view(p); return v.tour && v.tour.done ? v : null; }, 15000, `player ${k} to see the tournament finish`);
const finals = await Promise.all(pages.map(view));
const t0 = JSON.stringify(finals[0].tour);
for (const [k, v] of finals.entries()) {
  if (!v.tour || !v.tour.done) await fail(`player ${k} did not see the tournament finish`);
  if (JSON.stringify(v.tour) !== t0) await fail(`player ${k} has a different table`);
  if (v.errors.length) await fail(`player ${k} reported errors`);
}
if (finals[0].tour.r.length !== matches) await fail('wrong number of results');
console.log(finals[0].table.split('\n').slice(0, PLAYERS + 2).join(' | '));

// Leaderboards: this device's board and the server's shared board.
await host.waitForTimeout(1500);
const local = await host.evaluate(() => JSON.parse(localStorage.getItem('pc_board') || '{}'));
const shared = await (await fetch(`http://localhost:${PORT}/api/leaderboard`)).json();
const trophies = shared.players.reduce((a, e) => a + e.tours, 0);
const games = shared.players.reduce((a, e) => a + e.played, 0);
if (!local.players || !Object.keys(local.players).length) await fail('local leaderboard is empty');
if (trophies !== 1 || games !== matches * 2) await fail(`shared leaderboard: ${trophies} trophies, ${games} player-matches (expected 1 and ${matches * 2})`);
console.log(`PASS: ${PLAYERS}-player tournament, ${matches} matches, ${shots} shots, champion ${shared.players[0].name}, drop=${DROP}`);
await browser.close();
srv.kill();
