// Score chips, round label, hint line, connection label and debug panel.
import { PENS } from '../core/constants.js';
import { $, esc } from '../core/util.js';
import { safeAv } from '../ui/avatars.js';
import { S, isAuth, canCtl } from './state.js';
import { connLabel, debugText } from './online.js';

let debugOn = /[?&]debug\b/.test(location.search);
export function toggleDebug() { debugOn = !debugOn; lastSlow = 0; }

let lastSlow = 0;

export function updHud() {
  const G = S.G, net = S.net;
  const now = performance.now();

  // Things that change over time: refresh twice a second.
  if (now - lastSlow > 500) {
    lastSlow = now;
    const c = connLabel(), lbl = $('#netLbl');
    lbl.hidden = !c;
    if (c) { lbl.textContent = c.text; lbl.classList.toggle('bad', c.bad); }
    const dbg = $('#debug');
    dbg.hidden = !debugOn;
    if (debugOn) dbg.textContent = debugText();
    G.sig = ''; // re-evaluate the hint too
  }

  const lostHost = G.mode === 'online' && !isAuth() && net && now - net.hostAt > 4000;
  const s = JSON.stringify([lostHost, G.pl.map((p) => [p.name, p.pen, p.av.length]), G.sc, G.turn, G.phase, G.rd, G.me]);
  if (s === G.sig) return;
  G.sig = s;
  [0, 1].forEach((i) => {
    const p = G.pl[i], e = $('#c' + i);
    const you = G.me === i || (G.mode === 'bot' && i === 0) ? ' (you)' : '';
    e.innerHTML = `<img src="${safeAv(p.av)}" alt=""><div class="ci"><b>${esc(p.name)}${you}</b><small>${esc(PENS[p.pen].name)}</small><div class="pips">${[0, 1, 2].map((k) => `<i class="${k < G.sc[i] ? 'on' : ''}"></i>`).join('')}</div></div>`;
    e.classList.toggle('act', (G.phase === 'aim' || G.phase === 'moving') && G.turn === i);
  });
  $('#rdLbl').textContent = G.phase === 'over' ? 'Final' : 'Round ' + G.rd;
  const t = G.turn;
  const ht = lostHost
    ? 'Lost contact with ' + G.pl[0].name + '’s game. Reconnecting…'
    : G.phase !== 'aim'
      ? G.phase === 'moving' ? 'Watch it fly…' : G.phase === 'over' ? 'Match over' : 'Get ready…'
      : canCtl(t) ? 'Press anywhere, drag back, release to flick. Press near an end for spin.'
        : G.pl[t].bot ? 'Inkbot is lining up a shot…' : 'Waiting for ' + G.pl[t].name + '…';
  $('#hint').textContent = (G.me < 0 && G.mode === 'online' ? 'Spectating · ' : '') + ht;
}
