import './style.css';
import { $ } from './core/util.js';
import { bindMuteButton } from './ui/audio.js';
import { drawHero } from './ui/hero.js';
import { initMenu } from './ui/menu.js';
import { S, isAuth } from './game/state.js';
import { render, toClient } from './game/render.js';
import { startSimClock } from './game/match.js';
import { guestTick, initOnline } from './game/online.js';
import { updHud, toggleDebug } from './game/hud.js';
import { updPicker } from './ui/picker.js';
import './game/input.js';

// Keep the last few errors so the debug panel can show them.
const keepError = (m) => { S.errors.push(new Date().toLocaleTimeString() + ' ' + String(m).slice(0, 200)); if (S.errors.length > 20) S.errors.shift(); };
window.addEventListener('error', (e) => keepError(e.message));
window.addEventListener('unhandledrejection', (e) => keepError(e.reason && e.reason.message ? e.reason.message : e.reason));

bindMuteButton($('#mute'));
initMenu();
initOnline();
startSimClock();

// Debug panel: tap the connection label, or press D during a match.
$('#netLbl').onclick = toggleDebug;
window.addEventListener('keydown', (e) => { if ((e.key === 'd' || e.key === 'D') && S.G && !e.target.closest('input')) toggleDebug(); });

let last = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0);
  last = ts;
  const G = S.G;
  if (G && !$('#game').hidden) {
    if (!isAuth()) guestTick(dt);
    for (const q of G.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.9; q.vy *= 0.9; q.l -= dt; }
    G.parts = G.parts.filter((q) => q.l > 0);
    G.shake *= Math.pow(0.02, dt);
    if (G.rings) { for (const r of G.rings) r.l -= dt; G.rings = G.rings.filter((r) => r.l > 0); }
    if (G.flash) G.flash.l -= dt;
    render(ts);
    updHud();
    updPicker();
  } else if (!$('#menu').hidden) drawHero(ts);
}
requestAnimationFrame(frame);

// Automated tests (scripts/e2e.js) open the page with ?test to read game state.
if (/[?&]test\b/.test(location.search)) window.__penclash = { S, toClient };
