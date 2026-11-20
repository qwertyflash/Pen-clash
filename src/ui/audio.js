import { store } from '../core/util.js';

let actx = null;
let muted = store.get('muted', false);

/** Get (and unlock) the shared AudioContext. Call from a user gesture. */
export function ac() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ } }
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}

function tone(f, d, type, v, slide) {
  const a = ac();
  if (!a || muted) return;
  try {
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + d);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + d);
  } catch { /* ignore */ }
}

export const sfx = {
  flick: () => tone(900, 0.07, 'triangle', 0.12, 0.35),
  hit: (j) => tone(240 + Math.min(700, j * 0.5), 0.09, 'square', Math.min(0.16, 0.03 + j / 9000), 0.5),
  fall: () => tone(520, 0.55, 'sine', 0.16, 0.12),
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle', 0.14), i * 110)),
  tick: () => tone(1300, 0.03, 'triangle', 0.05),
};

export function bindMuteButton(btn) {
  const paint = () => { btn.textContent = muted ? 'Sound off' : 'Sound on'; };
  btn.onclick = () => { muted = !muted; store.set('muted', muted); paint(); ac(); };
  paint();
}
