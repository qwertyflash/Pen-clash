import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom } from '../src/net/room.js';

/** In-memory broadcast bus with optional message loss. */
function makeHub(drop = 0) {
  const members = new Set();
  return (name) => {
    const me = { onMsg: () => {}, onRe: () => {} };
    members.add(me);
    return {
      name,
      host: 'test',
      send(s) { for (const m of members) if (m !== me && Math.random() >= drop) setTimeout(() => m.onMsg(s), 1); },
      onMessage(fn) { me.onMsg = fn; },
      onReconnect(fn) { me.onRe = fn; },
      close(lastWords) { if (lastWords) this.send(lastWords); members.delete(me); },
    };
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(20); }
  return false;
}
const peerOf = (room, id) => room.peers().find((p) => p.peer === id);

test('peers see each other and presence updates', async () => {
  const bus = makeHub();
  const a = createRoom(bus('relay'), 'aaaa1'), b = createRoom(bus('relay'), 'bbbb2');
  await a.presence({ role: 'host', name: 'Ann' });
  await b.presence({ role: 'guest', name: 'Bo' });
  assert.ok(await until(() => peerOf(a, 'bbbb2')?.presence.name === 'Bo'));
  assert.ok(await until(() => peerOf(b, 'aaaa1')?.presence.name === 'Ann'));
  await a.presence({ st: { turn: 1 } });
  assert.ok(await until(() => peerOf(b, 'aaaa1')?.presence.st?.turn === 1));
  await a.presence({ st: null });
  assert.ok(await until(() => !('st' in peerOf(b, 'aaaa1').presence)));
  a.leave(); b.leave();
});

test('state converges even when half the messages are lost', async () => {
  const bus = makeHub(0.5);
  const a = createRoom(bus('relay'), 'aaaa1'), b = createRoom(bus('relay'), 'bbbb2');
  for (let i = 1; i <= 20; i++) { await a.presence({ n: i }); await wait(10); }
  // Deltas may be lost; a resync request returns a full snapshot.
  const ok = await until(() => { if (peerOf(b, 'aaaa1')?.presence.n === 20) return true; b.resync(); return false; }, 8000);
  assert.ok(ok, 'guest never saw the latest state');
  a.leave(); b.leave();
});

test('leaving removes the peer', async () => {
  const bus = makeHub();
  const a = createRoom(bus('relay'), 'aaaa1'), b = createRoom(bus('relay'), 'bbbb2');
  assert.ok(await until(() => !!peerOf(a, 'bbbb2')));
  b.leave();
  assert.ok(await until(() => !peerOf(a, 'bbbb2')));
  a.leave();
});

test('duplicate and stale copies are ignored', async () => {
  const sent = [];
  const fake = { name: 'relay', send: (s) => sent.push(s), onMessage(fn) { this.rx = fn; }, onReconnect() {}, close() {} };
  const a = createRoom(fake, 'aaaa1');
  fake.rx(JSON.stringify({ k: 'f', id: 'bbbb2', s: 5, p: { v: 'new' } }));
  fake.rx(JSON.stringify({ k: 'u', id: 'bbbb2', s: 4, p: { v: 'old' } }));
  fake.rx(JSON.stringify({ k: 'u', id: 'bbbb2', s: 5, p: { v: 'dup' } }));
  await wait(5);
  assert.equal(peerOf(a, 'bbbb2').presence.v, 'new');
  a.leave();
});
