// The paper arena (drawn once) and the ink layer (trails + splats, persists per match).
import { CX, CY, R } from '../core/constants.js';

export const arenaC = document.createElement('canvas');
arenaC.width = arenaC.height = 1060;
{
  const a = arenaC.getContext('2d');
  a.translate(30, 30);
  a.fillStyle = 'rgba(4,8,60,.5)'; a.beginPath(); a.arc(CX + 10, CY + 16, R + 18, 0, 7); a.fill();
  a.fillStyle = '#0b0b14'; a.beginPath(); a.arc(CX, CY, R + 18, 0, 7); a.fill();
  a.fillStyle = '#fbf8ef'; a.beginPath(); a.arc(CX, CY, R + 12, 0, 7); a.fill();
  a.save(); a.beginPath(); a.arc(CX, CY, R + 12, 0, 7); a.clip();
  for (let g = 20; g <= 1000; g += 40) {
    const major = (g - 20) % 200 === 0;
    a.strokeStyle = major ? 'rgba(22,49,180,.22)' : 'rgba(22,49,180,.1)'; a.lineWidth = major ? 2 : 1.4;
    a.beginPath(); a.moveTo(g, 0); a.lineTo(g, 1000); a.moveTo(0, g); a.lineTo(1000, g); a.stroke();
  }
  const rg = a.createRadialGradient(CX, CY, R * 0.82, CX, CY, R + 12);
  rg.addColorStop(0, 'rgba(255,77,141,0)'); rg.addColorStop(1, 'rgba(255,77,141,.2)');
  a.fillStyle = rg; a.fillRect(0, 0, 1000, 1000); a.restore();
  a.strokeStyle = '#ff4d8d'; a.lineWidth = 4; a.setLineDash([16, 12]); a.beginPath(); a.arc(CX, CY, R, 0, 7); a.stroke(); a.setLineDash([]);
  a.strokeStyle = 'rgba(11,11,20,.16)'; a.lineWidth = 3; a.beginPath(); a.arc(CX, CY, 64, 0, 7); a.stroke();
  a.beginPath(); a.moveTo(CX - 14, CY); a.lineTo(CX + 14, CY); a.moveTo(CX, CY - 14); a.lineTo(CX, CY + 14); a.stroke();
}

export const inkC = document.createElement('canvas');
inkC.width = inkC.height = 1000;
const ix = inkC.getContext('2d');

export function resetInk() { ix.clearRect(0, 0, 1000, 1000); }

function inkClip(f) { ix.save(); ix.beginPath(); ix.arc(CX, CY, R + 12, 0, 7); ix.clip(); f(); ix.restore(); }

export function splat(x, y, col) {
  const an = Math.atan2(y - CY, x - CX), ex = CX + Math.cos(an) * (R - 6), ey = CY + Math.sin(an) * (R - 6);
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
