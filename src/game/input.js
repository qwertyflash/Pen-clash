// Slingshot aiming: press, drag back, release.
import { MAXPULL, MAXJ, KJ } from '../core/constants.js';
import { clamp } from '../core/util.js';
import { ac } from '../ui/audio.js';
import { cv, toWorld } from './render.js';
import { S, isAuth, canCtl } from './state.js';
import { doFlick } from './match.js';
import { guestFlick, guestAim } from './online.js';

let drag = null;
const isGuest = () => S.net && S.net.role === 'guest';

cv.addEventListener('pointerdown', (e) => {
  ac();
  const G = S.G;
  if (!G || G.phase !== 'aim' || !canCtl(G.turn)) return;
  const w = toWorld(e), p = G.pens[G.turn];
  const t = clamp(((w.x - p.x) * Math.cos(p.a) + (w.y - p.y) * Math.sin(p.a)) / p.L, -0.45, 0.45);
  drag = { i: G.turn, t, sx: w.x, sy: w.y };
  try { cv.setPointerCapture(e.pointerId); } catch { /* */ }
  G.aim = { i: G.turn, t, jx: 0, jy: 0 };
});

cv.addEventListener('pointermove', (e) => {
  const G = S.G;
  if (!drag || !G || G.phase !== 'aim') return;
  const w = toWorld(e);
  let px = drag.sx - w.x, py = drag.sy - w.y;
  const m = Math.hypot(px, py);
  if (m > MAXPULL) { px *= MAXPULL / m; py *= MAXPULL / m; }
  G.aim = { i: drag.i, t: drag.t, jx: px * KJ, jy: py * KJ };
  G.dirty = true;
  if (isGuest()) guestAim([+drag.t.toFixed(3), Math.round(G.aim.jx), Math.round(G.aim.jy)]);
});

function endDrag() {
  if (!drag) return;
  drag = null;
  const G = S.G;
  if (!G) return;
  const a = G.aim;
  if (a && G.phase === 'aim' && Math.hypot(a.jx, a.jy) > MAXJ * 0.06) {
    if (isAuth()) doFlick(a.i, a.t, a.jx, a.jy);
    else if (isGuest()) guestFlick(a);
  } else {
    G.aim = null; G.dirty = true;
    if (isGuest()) S.net.nr.presence({ aim: null }).catch(() => {});
  }
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
// If the page loses focus mid-drag (alt-tab, notification), don't leave a half-drawn aim.
window.addEventListener('blur', () => {
  if (!drag) return;
  drag = null;
  if (S.G) S.G.aim = null;
  if (isGuest()) S.net.nr.presence({ aim: null }).catch(() => {});
});
