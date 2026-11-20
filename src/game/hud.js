// Score chips, round label, live win-chance bar, hint line, connection label, debug panel.
import { PENS, COL, WIN_ROUNDS } from '../core/constants.js';
import { $, esc } from '../core/util.js';
import { winOdds } from '../core/odds.js';
import { safeAv } from '../ui/avatars.js';
import { S, isAuth, canCtl } from './state.js';
import { connLabel, debugText } from './online.js';

let debugOn = /[?&]debug\b/.test(location.search);
export function toggleDebug() { debugOn = !debugOn; lastSlow = 0; }

let lastSlow = 0, lastOdds = 0, oddsN = 0, shown = [];

/** Smoothly updated win-chance bar (one segment per player). */
function updOdds(G, now) {
  if (now - lastOdds < 150) return;
  lastOdds = now;
  const el = $('#odds'), n = G.pl.length;
  if (oddsN !== n || el.children.length !== n) {
    oddsN = n; shown = G.pl.map(() => 1 / n);
    el.innerHTML = G.pl.map((_, i) => `<i style="background:${COL[i]}"><span></span></i>`).join('');
  }
  const target = winOdds({
    pens: G.pens, inMatch: G.pl.map((p) => !p.gone), sc: G.sc, turn: G.turn, phase: G.phase,
    winner: G.winner, arena: G.arena, target: G.target || WIN_ROUNDS,
  });
  // Ease towards the new estimate so the bar doesn't jitter while pens slide.
  shown = shown.map((v, i) => v + ((target[i] || 0) - v) * 0.35);
  const tot = shown.reduce((a, b) => a + b, 0) || 1;
  [...el.children].forEach((seg, i) => {
    const pct = (shown[i] / tot) * 100;
    seg.style.flexGrow = String(Math.max(pct, 0.001));
    seg.firstChild.textContent = pct >= 9 ? Math.round(pct) + '%' : '';
    seg.title = G.pl[i].name + ': ' + Math.round(pct) + '% chance to win';
  });
  el.setAttribute('aria-label', 'Win chance: ' + G.pl.map((p, i) => p.name + ' ' + Math.round((shown[i] / tot) * 100) + '%').join(', '));
}

export function resetHud() { oddsN = 0; }

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
  updOdds(G, now);

  const lostHost = G.mode === 'online' && !isAuth() && net && now - net.hostAt > 4000;
  const s = JSON.stringify([lostHost, G.pl.map((p) => [p.name, p.pen, p.av.length, !!p.gone]), G.sc, G.turn, G.phase, G.rd, G.me]);
  if (s === G.sig) return;
  G.sig = s;
  const n = G.pl.length, chips = $('#chips');
  chips.style.setProperty('--n', n);
  chips.classList.toggle('many', n > 2);
  chips.innerHTML = G.pl.map((p, i) => {
    const you = G.me === i || (G.mode === 'bot' && i === 0) ? ' (you)' : '';
    const act = (G.phase === 'aim' || G.phase === 'moving') && G.turn === i;
    const out = p.gone || (G.pens[i] && !G.pens[i].alive && G.phase !== 'between');
    const cls = ['chip', n === 2 && i === 1 ? 'r' : '', act ? 'act' : '', out ? 'out' : ''].join(' ');
    const sub = p.gone ? 'Left the match' : PENS[p.pen].name;
    return `<div class="${cls}" style="--pc:${COL[i]}"><img src="${safeAv(p.av)}" alt=""><div class="ci"><b>${esc(p.name)}${you}</b><small>${esc(sub)}</small><div class="pips">${Array.from({ length: G.target || WIN_ROUNDS }, (_, k) => `<i class="${k < G.sc[i] ? 'on' : ''}"></i>`).join('')}</div></div></div>`;
  }).join('');
  $('#rdLbl').textContent = G.phase === 'over' ? 'Final' : 'Round ' + G.rd;
  const t = G.turn;
  const ht = lostHost
    ? 'Lost contact with ' + G.pl[0].name + '’s game. Reconnecting…'
    : G.phase !== 'aim'
      ? G.phase === 'moving' ? 'Watch it fly…' : G.phase === 'over' ? 'Match over' : G.phase === 'pick' ? 'Everyone is choosing a new pen…' : 'Get ready…'
      : canCtl(t) ? (n > 2 && G.mode === 'local' ? G.pl[t].name + ': press anywhere, drag back, release to flick.' : 'Press anywhere, drag back, release to flick. Press near an end for spin.')
        : G.pl[t].bot ? G.pl[t].name + ' is lining up a shot…' : 'Waiting for ' + G.pl[t].name + '…';
  $('#hint').textContent = (G.me < 0 && G.mode === 'online' ? 'Spectating · ' : '') + ht;
}
