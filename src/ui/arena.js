// Arena backgrounds (drawn once per arena) and the ink layer (trails + splats, per match).
import { CX, CY } from '../core/constants.js';
import { ARENAS, arenaPath, edgePoint } from '../core/arenas.js';

const cache = new Map();

/** 1060x1060 canvas of the arena; draw it at (-30, -30) in world coordinates. */
export function arenaCanvas(ar = ARENAS[0]) {
  let c = cache.get(ar.id);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 1060;
  const a = c.getContext('2d'), th = ar.theme;
  a.translate(30, 30);
  // drop shadow, black rim, paper
  a.save(); a.translate(10, 16); a.fillStyle = 'rgba(4,8,60,.5)'; arenaPath(a, ar, 18); a.fill(); a.restore();
  a.fillStyle = '#0b0b14'; arenaPath(a, ar, 18); a.fill();
  a.fillStyle = th.paper; arenaPath(a, ar, 12); a.fill();
  a.save(); arenaPath(a, ar, 12); a.clip();
  for (let g = 20; g <= 1000; g += 40) {
    const major = (g - 20) % 200 === 0;
    a.strokeStyle = `rgba(${th.grid},${major ? 0.22 : 0.1})`; a.lineWidth = major ? 2 : 1.4;
    a.beginPath(); a.moveTo(g, 0); a.lineTo(g, 1000); a.moveTo(0, g); a.lineTo(1000, g); a.stroke();
  }
  if (ar.id === 'ice') { // frosty streaks
    a.strokeStyle = 'rgba(255,255,255,.7)'; a.lineWidth = 3; a.lineCap = 'round';
    for (let k = 0; k < 26; k++) { const x = 160 + ((k * 97) % 680), y = 160 + ((k * 61) % 680); a.beginPath(); a.moveTo(x, y); a.lineTo(x + 40, y + 12); a.stroke(); }
  }
  const rg = a.createRadialGradient(CX, CY, ar.r * 0.8, CX, CY, ar.r * 1.45);
  rg.addColorStop(0, `rgba(${th.glow},0)`); rg.addColorStop(1, `rgba(${th.glow},.3)`);
  a.fillStyle = rg; a.fillRect(0, 0, 1000, 1000); a.restore();
  a.strokeStyle = th.edge; a.lineWidth = 4; a.setLineDash([16, 12]); arenaPath(a, ar, 0); a.stroke(); a.setLineDash([]);
  a.strokeStyle = 'rgba(11,11,20,.16)'; a.lineWidth = 3;
  if (!ar.obstacles.some((o) => Math.hypot(o.x - CX, o.y - CY) < 60)) {
    a.beginPath(); a.arc(CX, CY, 64, 0, 7); a.stroke();
    a.beginPath(); a.moveTo(CX - 14, CY); a.lineTo(CX + 14, CY); a.moveTo(CX, CY - 14); a.lineTo(CX, CY + 14); a.stroke();
  }
  for (const o of ar.obstacles) drawEraser(a, o);
  cache.set(ar.id, c);
  return c;
}

function drawEraser(a, o) {
  a.save();
  a.fillStyle = 'rgba(6,10,60,.25)'; a.beginPath(); a.arc(o.x + 5, o.y + 8, o.r, 0, 7); a.fill();
  const g = a.createRadialGradient(o.x - o.r * 0.3, o.y - o.r * 0.35, o.r * 0.1, o.x, o.y, o.r);
  g.addColorStop(0, '#ffc2d6'); g.addColorStop(1, '#ff6f9f');
  a.fillStyle = g; a.strokeStyle = '#0b0b14'; a.lineWidth = 3; a.beginPath(); a.arc(o.x, o.y, o.r, 0, 7); a.fill(); a.stroke();
  a.fillStyle = '#5a6fd8'; a.beginPath(); a.arc(o.x, o.y, o.r * 0.55, 0, 7); a.fill(); a.stroke();
  a.restore();
}

/* ---------- ink layer ---------- */
export const inkC = document.createElement('canvas');
inkC.width = inkC.height = 1000;
const ix = inkC.getContext('2d');
let inkArena = ARENAS[0];

/** Clear the ink and remember which arena it is clipped to. */
export function resetInk(ar = inkArena) { inkArena = ar; ix.clearRect(0, 0, 1000, 1000); }

function inkClip(f) { ix.save(); arenaPath(ix, inkArena, 12); ix.clip(); f(); ix.restore(); }

export function splat(x, y, col) {
  const [ex, ey] = edgePoint(inkArena, x, y, 6), an = Math.atan2(y - ey, x - ex);
  inkClip(() => {
    ix.fillStyle = col; ix.globalAlpha = 0.85; ix.beginPath(); ix.arc(ex, ey, 26, 0, 7); ix.fill();
    for (let k = 0; k < 12; k++) {
      const a = an + Math.PI + (Math.random() - 0.5) * 2.2, d = 20 + Math.random() * 60, r = 2 + Math.random() * 9;
      ix.beginPath(); ix.arc(ex + Math.cos(a) * d, ey + Math.sin(a) * d, r, 0, 7); ix.fill();
    }
  });
}

/** Draw the ink line left by a pen tip since the last frame. */
export function trail(p) {
  const tx = p.x + (Math.cos(p.a) * p.L) / 2, ty = p.y + (Math.sin(p.a) * p.L) / 2;
  if (p.tip && p.alive) {
    const dd = Math.hypot(tx - p.tip[0], ty - p.tip[1]);
    if (dd > 1.5 && dd < 120) inkClip(() => {
      ix.strokeStyle = p.d.ink; ix.globalAlpha = 0.22; ix.lineWidth = 2.4; ix.lineCap = 'round';
      ix.beginPath(); ix.moveTo(p.tip[0], p.tip[1]); ix.lineTo(tx, ty); ix.stroke();
    });
  }
  p.tip = [tx, ty];
}
