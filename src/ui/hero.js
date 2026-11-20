// Animated pen fight on the main menu.
import { CX, CY, COL, PENS } from '../core/constants.js';
import { $ } from '../core/util.js';
import { drawPen, drawBadge } from './draw.js';
import { arenaC } from './arena.js';
import { PRE } from './avatars.js';

const hc = $('#hero'), hx = hc.getContext('2d');

export function drawHero(ts) {
  const w = hc.clientWidth, h = hc.clientHeight;
  if (!w) return;
  const d = Math.min(2, devicePixelRatio || 1);
  if (hc.width !== Math.round(w * d)) { hc.width = Math.round(w * d); hc.height = Math.round(h * d); }
  hx.setTransform(d, 0, 0, d, 0, 0); hx.clearRect(0, 0, w, h);
  const s = Math.max(w / 640, h / 440), t = ts / 1000;
  hx.save(); hx.translate(w / 2, h / 2); hx.scale(s, s); hx.translate(-CX, -CY - 30); hx.drawImage(arenaC, -30, -30);
  const cyc = (t % 2.4) / 2.4, hit = Math.max(0, 1 - cyc * 6), off = Math.sin(cyc * Math.PI * 2) * 6;
  const A = { x: CX - 100 - off, y: CY + 40, a: -0.42 + Math.sin(t * 1.3) * 0.05 };
  const B = { x: CX + 100 + off, y: CY + 10, a: 0.55 + Math.sin(t * 1.1 + 1) * 0.05 };
  hx.strokeStyle = 'rgba(39,71,216,.25)'; hx.lineWidth = 2.4; hx.beginPath(); hx.moveTo(CX - 330, CY + 190);
  hx.bezierCurveTo(CX - 260, CY + 120, CX - 200, CY + 170, CX - 120, CY + 100); hx.stroke();
  drawPen(hx, PENS[0], A.x, A.y, A.a, 1.25); drawPen(hx, PENS[3], B.x, B.y, B.a, 1.25);
  drawBadge(hx, A.x, A.y, PRE[0], COL[0], 1.2); drawBadge(hx, B.x, B.y, PRE[3], COL[1], 1.2);
  if (hit > 0) {
    hx.save(); hx.translate(CX, CY + 10); hx.rotate(t); hx.fillStyle = '#ffe23d'; hx.strokeStyle = '#0b0b14'; hx.lineWidth = 4; hx.beginPath();
    for (let k = 0; k < 16; k++) { const r = k % 2 ? 18 : 48 * (0.6 + hit * 0.6); hx.lineTo(Math.cos((k * Math.PI) / 8) * r, Math.sin((k * Math.PI) / 8) * r); }
    hx.closePath(); hx.globalAlpha = hit; hx.fill(); hx.stroke(); hx.restore();
  }
  hx.restore();
}
