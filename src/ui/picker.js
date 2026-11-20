// "Choose a new pen" overlay shown between rounds. Offline it asks each human player
// in turn (pass & play); online each player picks on their own device.
import { PENS, COL } from '../core/constants.js';
import { $, esc } from '../core/util.js';
import { drawPen } from './draw.js';
import { sfx } from './audio.js';
import { S, isAuth } from '../game/state.js';
import { choosePen } from '../game/match.js';
import { guestPick } from '../game/online.js';

let sig = '';

/** Which seat this device should be choosing for right now, or -1. */
function seatToAsk(G) {
  const pk = G.pick;
  if (G.mode === 'online') return G.me >= 0 && pk.picks[G.me] < 0 ? G.me : -1;
  return G.pl.findIndex((p, i) => p.local && !p.bot && !p.gone && pk.picks[i] < 0);
}

const stats = (d) => [['Power', d.mass / 1.7], ['Speed', 0.7 / d.mass], ['Reach', d.len / 218], ['Grip', d.fric / 1.45]]
  .map(([n, v]) => `<span>${n}<i><b style="width:${Math.round(Math.min(1, Math.max(0.08, v)) * 100)}%"></b></i></span>`).join('');

export function updPicker() {
  const G = S.G, el = $('#picker');
  if (!G || G.phase !== 'pick' || !G.pick) { if (!el.hidden) { el.hidden = true; sig = ''; } return; }
  const pk = G.pick, i = seatToAsk(G);
  const left = Math.max(0, Math.ceil((pk.until - Date.now()) / 1000));
  $('#pickTimer').textContent = left + 's';
  const s = JSON.stringify([i, pk.rd, pk.picks, pk.last]);
  if (s === sig) return;
  sig = s;
  el.hidden = false;
  if (i < 0) {
    const waiting = G.pl.map((p, k) => (pk.picks[k] < 0 && !p.gone ? esc(p.name) : '')).filter(Boolean);
    $('#pickTitle').textContent = 'Round ' + pk.rd;
    $('#pickNote').textContent = waiting.length ? 'Waiting for ' + waiting.join(', ') + ' to choose…' : 'Starting…';
    $('#pickGrid').innerHTML = '';
    return;
  }
  const humans = G.pl.filter((p) => p.local && !p.bot).length;
  $('#pickTitle').innerHTML = (G.mode === 'local' && humans > 1 ? `<span style="color:${COL[i]}">${esc(G.pl[i].name)}</span>, choose` : 'Choose') + ' a new pen for round ' + pk.rd;
  $('#pickNote').textContent = 'You can’t reuse last round’s pen. If time runs out, one is picked for you.';
  $('#pickGrid').innerHTML = PENS.map((d, k) => {
    const used = k === pk.last[i];
    return `<button class="pickPen" data-pen="${k}" ${used ? 'disabled' : ''}><canvas data-p="${k}"></canvas><b>${esc(d.name)}</b><small>${used ? 'Used last round' : esc(d.tag)}</small><div class="mini">${stats(d)}</div></button>`;
  }).join('');
  requestAnimationFrame(() => {
    el.querySelectorAll('canvas[data-p]').forEach((c) => {
      const w = c.clientWidth, h = c.clientHeight;
      if (!w) return;
      const dp = Math.min(2, devicePixelRatio || 1);
      c.width = w * dp; c.height = h * dp;
      const x = c.getContext('2d'); x.setTransform(dp, 0, 0, dp, 0, 0);
      drawPen(x, PENS[+c.dataset.p], w / 2, h / 2 - 2, -0.06, Math.min((w - 16) / 230, h / 34));
    });
  });
  $('#pickGrid').onclick = (e) => {
    const b = e.target.closest('[data-pen]');
    if (!b || b.disabled) return;
    const pen = +b.dataset.pen;
    sfx.tick();
    if (G.mode === 'online' && !isAuth()) guestPick(pen); else choosePen(i, pen);
    sig = '';
  };
}
