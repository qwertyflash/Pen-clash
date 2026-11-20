import { $, $$ } from '../core/util.js';
import { resize } from '../game/render.js';

/** Show one full-screen section (menu, setup, online, game). */
export function show(id) {
  $$('.screen').forEach((s) => { s.hidden = s.id !== id; });
  if (id === 'game') resize();
}

let bT = 0;
export function banner(t, ms) {
  const b = $('#banner');
  b.textContent = t;
  b.classList.add('on');
  clearTimeout(bT);
  bT = setTimeout(() => b.classList.remove('on'), ms);
}
