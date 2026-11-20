// End-to-end online test: starts the server, opens two browsers (host + guest),
// creates a match with real clicks and plays it with real mouse drags, checking after
// every shot that both screens agree and nobody gets stuck.
//
//   npm run build && npm run test:e2e
//   E2E_DROP=0.3 npm run test:e2e        # relay drops 30% of messages
//   E2E_P2P=0 npm run test:e2e           # relay only, no direct link
//   E2E_MQTT=ws://localhost:8899/mqtt npm run test:e2e   # use an MQTT broker instead of the server relay
//
// Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4100 + ((Math.random() * 800) | 0);
const DROP = process.env.E2E_DROP || '0';
const P2P = process.env.E2E_P2P !== '0';
const SHOTS = Number(process.env.E2E_SHOTS) || 14;
const MQTT = process.env.E2E_MQTT || '';
const BASE = `http://localhost:${PORT}/?test${P2P ? '' : '&nop2p'}${MQTT ? '&relay=mqtt' : ''}`;

const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), RELAY_DROP_RATE: DROP }, stdio: ['ignore', 'pipe', 'inherit'] });
process.on('exit', () => srv.kill());
process.on('SIGTERM', () => process.exit(1));
process.on('unhandledRejection', (e) => { console.error('FAIL:', e && e.message); process.exit(1); });
await new Promise((res) => srv.stdout.on('data', (d) => String(d).includes('running') && res()));

const browser = await chromium.launch({ args: ['--no-proxy-server'] });
const fail = async (msg) => {
  console.error('FAIL:', msg);
  for (const [n, p] of [['host', host], ['guest', guest]]) console.error(n, JSON.stringify(await view(p)));
  await browser.close(); srv.kill(); process.exit(1);
};

async function open() {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  if (MQTT) await page.addInitScript((u) => { window.MQTT_BROKERS = [u]; }, MQTT);
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.goto(BASE);
  await page.click('[data-mode="online"]');
  await page.click('#goBtn');
  return page;
}

const view = (p) => p.evaluate(() => {
  const { S } = window.__penclash, G = S.G;
  if (!G) return null;
  return {
    phase: G.phase, turn: G.turn, rd: G.rd, sc: G.sc.join('-'), sim: G.sim, me: G.me,
    pens: G.pens.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, p.alive]),
    path: S.net && (S.net.opp || S.net.hostId) ? S.net.nr.route(S.net.opp || S.net.hostId).path : null,
    errors: S.errors,
  };
});

async function until(p, pred, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await view(p); if (v && pred(v)) return v; await p.waitForTimeout(80); }
  await fail('timed out waiting for ' + what);
}

/** Drag back from pen i towards the other pen with a real mouse. */
async function flick(p, i) {
  const pt = await p.evaluate((i) => {
    const { S, toClient } = window.__penclash, G = S.G, me = G.pens[i], op = G.pens[1 - i];
    const ang = Math.atan2(op.y - me.y, op.x - me.x) + (Math.random() - 0.5) * 0.6, pull = 90 + Math.random() * 120;
    const a = toClient(me.x, me.y), b = toClient(me.x - Math.cos(ang) * pull, me.y - Math.sin(ang) * pull);
    return { a, b };
  }, i);
  await p.mouse.move(pt.a.x, pt.a.y);
  await p.mouse.down();
  for (let k = 1; k <= 8; k++) await p.mouse.move(pt.a.x + ((pt.b.x - pt.a.x) * k) / 8, pt.a.y + ((pt.b.y - pt.a.y) * k) / 8);
  await p.mouse.up();
}

const host = await open(), guest = await open();
await host.click('#mkRoom');
await host.waitForFunction(() => document.querySelector('#codeBig').textContent.length === 4);
const code = await host.textContent('#codeBig');
await guest.fill('#codeIn', code);
await guest.click('#joinForm button');
await until(guest, (v) => v.me === 1, 15000, 'guest to enter the match');

let shots = 0;
while (shots < SHOTS) {
  const h = await until(host, (v) => v.phase === 'aim' || v.phase === 'over', 20000, 'host to be ready for a shot');
  if (h.phase === 'over') break;
  const shooter = h.turn === 0 ? host : guest;
  // The shooter's own screen must agree it is their turn, and pens must match the host's.
  const s = await until(shooter, (v) => v.phase === 'aim' && v.turn === h.turn && !v.sim, 15000, (h.turn ? 'guest' : 'host') + ' to see its turn');
  // The guest's pens must end up where the host's are (they ease into place).
  const off = (g) => Math.max(...g.pens.map((q, k) => (q[2] && h.pens[k][2] ? Math.hypot(q[0] - h.pens[k][0], q[1] - h.pens[k][1]) : 0)));
  await until(guest, (v) => !v.sim && v.phase === h.phase && off(v) < 3, 8000, 'guest pens to match the host');
  await flick(shooter, h.turn);
  await until(host, (v) => v.phase !== 'aim' || v.turn !== h.turn, 15000, 'host to receive the shot (turn ' + h.turn + ')');
  shots++;
  console.log(`shot ${shots} by ${h.turn ? 'guest' : 'host'} ok  round ${h.rd}  score ${h.sc}  path ${s.path}`);
}
const end = await view(guest);
if (end.errors.length || (await view(host)).errors.length) await fail('errors were reported');
console.log(`PASS: ${shots} shots, drop=${DROP}, p2p=${P2P}, final path ${end.path}`);
await browser.close();
srv.kill();
