// End-to-end online test: starts the server, opens one browser per player (host +
// guests), creates a match with real clicks and plays it with real mouse drags,
// checking after every shot that every screen agrees and nobody gets stuck.
//
//   npm run build && npm run test:e2e
//   E2E_PLAYERS=4 npm run test:e2e       # 2-4 players (default 3)
//   E2E_ARENA=ice npm run test:e2e       # classic, ice, tiny, square, erasers
//   E2E_DROP=0.3 npm run test:e2e        # relay drops 30% of messages
//   E2E_P2P=0 npm run test:e2e           # relay only, no direct link
//   E2E_MQTT=ws://localhost:8899/mqtt npm run test:e2e   # use an MQTT broker instead of the server relay
//   E2E_LEAVE=1 npm run test:e2e         # the last guest closes their tab after 4 shots
//
// Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4100 + ((Math.random() * 800) | 0);
const DROP = process.env.E2E_DROP || '0';
const P2P = process.env.E2E_P2P !== '0';
const SHOTS = Number(process.env.E2E_SHOTS) || 14;
const PLAYERS = Math.max(2, Math.min(4, Number(process.env.E2E_PLAYERS) || 3));
const ARENA = process.env.E2E_ARENA || 'classic';
const MQTT = process.env.E2E_MQTT || '';
const LEAVE = process.env.E2E_LEAVE === '1' && PLAYERS > 2;
const left = new Set();
const BASE = `http://localhost:${PORT}/?test${P2P ? '' : '&nop2p'}${MQTT ? '&relay=mqtt' : ''}`;

const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), RELAY_DROP_RATE: DROP }, stdio: ['ignore', 'pipe', 'inherit'] });
process.on('exit', () => srv.kill());
process.on('SIGTERM', () => process.exit(1));
process.on('unhandledRejection', (e) => { console.error('FAIL:', e && e.message); process.exit(1); });
await new Promise((res) => srv.stdout.on('data', (d) => String(d).includes('running') && res()));

const browser = await chromium.launch({ args: ['--no-proxy-server'] });
const pages = [];
const fail = async (msg) => {
  console.error('FAIL:', msg);
  for (const [k, p] of pages.entries()) console.error(k ? 'guest ' + k : 'host', JSON.stringify(await view(p)));
  await browser.close(); srv.kill(); process.exit(1);
};

async function open(k) {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
  page.on('pageerror', (e) => console.error(`page ${k} error:`, e.message));
  if (MQTT) await page.addInitScript((u) => { window.MQTT_BROKERS = [u]; }, MQTT);
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.goto(BASE);
  await page.click('[data-mode="online"]');
  if (k === 0) await page.click(`.arenaBtn[data-k="${ARENA}"]`);
  await page.fill('.name[data-i="0"]', k ? 'Guest ' + k : 'Host');
  await page.click('#goBtn');
  return page;
}

const view = (p) => p.evaluate(() => {
  const { S } = window.__penclash, G = S.G;
  if (!G) return null;
  const peer = S.net && (S.net.role === 'host' ? S.net.ids[1] : S.net.hostId);
  return {
    phase: G.phase, turn: G.turn, rd: G.rd, sc: G.sc.join('-'), sim: G.sim, me: G.me, arena: G.arena.id, n: G.pl.length,
    pens: G.pens.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, p.alive]),
    gone: G.pl.map((p) => !!p.gone),
    extra: JSON.stringify([G.pens.map((p) => [Math.round(p.dmg), p.broken, p.frozen, p.arm, p.segs.join('')]), G.env.boosters.filter((b) => !b.taken).map((b) => b.k + b.x + ',' + b.y), !!G.env.flood, G.pl.map((p) => p.pen)]),
    path: peer ? S.net.nr.route(peer).path : null,
    odds: [...document.querySelectorAll('#odds i')].map((e) => e.style.flexGrow),
    errors: S.errors,
  };
});

async function until(p, pred, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await view(p); if (v && pred(v)) return v; await p.waitForTimeout(80); }
  await fail('timed out waiting for ' + what);
}

/** Drag back from pen i towards another pen with a real mouse. */
async function flick(p, i) {
  const pt = await p.evaluate((i) => {
    const { S, toClient } = window.__penclash, G = S.G, me = G.pens[i];
    const foes = G.pens.filter((q) => q !== me && q.alive), op = foes[(Math.random() * foes.length) | 0];
    const ang = Math.atan2(op.y - me.y, op.x - me.x) + (Math.random() - 0.5) * 0.6, pull = 90 + Math.random() * 120;
    const a = toClient(me.x, me.y), b = toClient(me.x - Math.cos(ang) * pull, me.y - Math.sin(ang) * pull);
    return { a, b };
  }, i);
  await p.mouse.move(pt.a.x, pt.a.y);
  await p.mouse.down();
  for (let k = 1; k <= 8; k++) await p.mouse.move(pt.a.x + ((pt.b.x - pt.a.x) * k) / 8, pt.a.y + ((pt.b.y - pt.a.y) * k) / 8);
  await p.mouse.up();
}

for (let k = 0; k < PLAYERS; k++) pages.push(await open(k));
const host = pages[0];
await host.click('#mkRoom');
await host.waitForFunction(() => document.querySelector('#codeBig').textContent.length === 4);
const code = await host.textContent('#codeBig');
for (const g of pages.slice(1)) { await g.fill('#codeIn', code); await g.click('#joinForm button'); }
try {
  await host.waitForFunction((n) => !document.querySelector('#startBtn').disabled && document.querySelectorAll('#lobbyList li').length === n, PLAYERS, { timeout: 20000 });
} catch {
  const lobby = await host.evaluate(() => ({ list: document.querySelector('#lobbyList').innerText, status: document.querySelector('#netStatus').innerText, peers: window.__penclash.S.net.nr.peers().map((p) => [p.peer, JSON.stringify(p.presence).slice(0, 80)]) }));
  await fail('host lobby never showed every player: ' + JSON.stringify(lobby));
}
await host.click('#startBtn');
// Seats follow join order, so guest k should be player k.
for (const [k, g] of pages.entries()) await until(g, (v) => v.me === k && v.n === PLAYERS && v.arena === ARENA, 15000, `player ${k} to enter the match`);

let shots = 0, picks = 0;
while (shots < SHOTS) {
  let h = await until(host, (v) => v.phase === 'aim' || v.phase === 'over' || v.phase === 'pick', 20000, 'host to be ready for a shot');
  if (h.phase === 'over') break;
  if (h.phase === 'pick') {
    // New round: every player picks a pen on their own screen (last round's pen is locked).
    for (const [k, g] of pages.entries()) {
      if (left.has(k)) continue;
      await g.waitForSelector('#picker:not([hidden]) .pickPen:not([disabled])', { timeout: 10000 });
      await g.click('#picker .pickPen:not([disabled]) >> nth=' + ((Math.random() * 5) | 0));
    }
    const pk = await until(host, (v) => v.phase !== 'pick', 15000, 'everyone to finish picking pens');
    picks++;
    console.log(`round ${pk.rd}: everyone picked a new pen`);
    continue;
  }
  const shooter = pages[h.turn];
  // The shooter's screen must agree it is their turn...
  const s = await until(shooter, (v) => v.phase === 'aim' && v.turn === h.turn && !v.sim, 15000, `player ${h.turn} to see its turn`);
  // ...and every guest's pens must end up where the host's are (they ease into place).
  const off = (g) => Math.max(...g.pens.map((q, k) => (q[2] && h.pens[k][2] ? Math.hypot(q[0] - h.pens[k][0], q[1] - h.pens[k][1]) : 0)));
  for (const [k, g] of pages.entries()) if (k && !left.has(k)) await until(g, (v) => !v.sim && v.phase === h.phase && off(v) < 3 && v.extra === h.extra, 8000, `guest ${k} to match the host (positions, damage, boosters, flood, pens)`);
  await flick(shooter, h.turn);
  await until(host, (v) => v.phase !== 'aim' || v.turn !== h.turn, 15000, 'host to receive the shot from player ' + h.turn);
  shots++;
  console.log(`shot ${shots} by player ${h.turn} ok  round ${h.rd}  score ${h.sc}  path ${s.path}`);
  if (LEAVE && shots === 4) {
    const k = PLAYERS - 1;
    await pages[k].context().close();
    left.add(k);
    console.log(`player ${k} closed their tab`);
    await until(host, (v) => v.gone[k], 20000, 'host to notice player ' + k + ' left');
  }
}
for (const [k, p] of pages.entries()) {
  if (left.has(k)) continue;
  const v = await view(p);
  if (v.errors.length) await fail('errors were reported');
  if (v.odds.length !== PLAYERS) await fail('win-chance bar should have one segment per player');
}
console.log(`PASS: ${PLAYERS} players, arena ${ARENA}, ${shots} shots, ${picks} pen picks, drop=${DROP}, p2p=${P2P}, final path ${(await view(pages[1])).path}${LEAVE ? ', one player left mid-match' : ''}`);
await browser.close();
srv.kill();
