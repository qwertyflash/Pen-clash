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
  pickup: () => [660, 990, 1320].forEach((f, i) => setTimeout(() => tone(f, 0.09, 'triangle', 0.1), i * 60)),
  // Booster shots and hits
  whoosh: () => { tone(300, 0.35, 'sawtooth', 0.09, 4); tone(900, 0.25, 'triangle', 0.06, 2.2); },
  roar: () => { tone(110, 0.5, 'sawtooth', 0.16, 1.8); setTimeout(() => tone(220, 0.35, 'square', 0.08, 0.5), 60); },
  boom: () => { tone(70, 0.6, 'square', 0.22, 0.35); tone(180, 0.3, 'sawtooth', 0.14, 0.3); },
  zap: () => { [1600, 2400, 1200].forEach((f, i) => setTimeout(() => tone(f, 0.06, 'square', 0.07, 0.5), i * 35)); },
  clink: () => { tone(2200, 0.18, 'triangle', 0.1, 0.9); setTimeout(() => tone(3100, 0.22, 'sine', 0.08), 50); },
  crack: () => { tone(160, 0.35, 'sawtooth', 0.2, 0.3); setTimeout(() => tone(90, 0.6, 'square', 0.12, 0.4), 80); },
};

export function bindMuteButton(btn) {
  const paint = () => { btn.textContent = muted ? 'Sound off' : 'Sound on'; };
  btn.onclick = () => { muted = !muted; store.set('muted', muted); paint(); ac(); };
  paint();
}
