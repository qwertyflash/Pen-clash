// Arenas: where pens fight. Each has an edge shape (fall off past it), a friction
// multiplier, optional fixed obstacles, and colours for drawing.
import { CX, CY } from './constants.js';

const ring = (n, rad, r, start = Math.PI / 4) =>
  Array.from({ length: n }, (_, k) => ({ x: CX + Math.cos(start + (k * 2 * Math.PI) / n) * rad, y: CY + Math.sin(start + (k * 2 * Math.PI) / n) * rad, r }));

export const ARENAS = [
  {
    id: 'classic', name: 'Classic Paper', desc: 'The original graph-paper circle.',
    shape: 'circle', r: 370, fric: 1, obstacles: [],
    theme: { paper: '#fbf8ef', grid: '22,49,180', edge: '#ff4d8d', glow: '255,77,141' },
  },
  {
    id: 'ice', name: 'Ice Rink', desc: 'Slippery! Pens glide much further.',
    shape: 'circle', r: 370, fric: 0.42, obstacles: [],
    theme: { paper: '#eaf6ff', grid: '40,130,210', edge: '#1aa3e8', glow: '26,163,232' },
  },
  {
    id: 'tiny', name: 'Tiny Desk', desc: 'Small arena. Quick knockouts.',
    shape: 'circle', r: 285, fric: 1, obstacles: [],
    theme: { paper: '#fff4dc', grid: '170,100,20', edge: '#ff7a1a', glow: '255,122,26' },
  },
  {
    id: 'square', name: 'Square Notebook', desc: 'Straight edges, deadly corners.',
    shape: 'square', r: 330, fric: 1, obstacles: [],
    theme: { paper: '#fbf8ef', grid: '22,49,180', edge: '#9b5cff', glow: '155,92,255' },
  },
  {
    id: 'erasers', name: 'Eraser Field', desc: 'Fixed erasers to bank shots off.',
    shape: 'circle', r: 370, fric: 1, obstacles: [{ x: CX, y: CY, r: 42 }, ...ring(4, 255, 24)],
    theme: { paper: '#fdf3f6', grid: '150,40,90', edge: '#ff4d8d', glow: '255,77,141' },
  },
];

export const arenaById = (id) => ARENAS.find((a) => a.id === id) || ARENAS[0];

/** Is (x, y) still on the arena? */
export function inside(ar, x, y) {
  const dx = x - CX, dy = y - CY;
  return ar.shape === 'square' ? Math.abs(dx) <= ar.r && Math.abs(dy) <= ar.r : Math.hypot(dx, dy) <= ar.r;
}

/** Distance from (x, y) to the arena edge (positive inside). */
export function edgeDist(ar, x, y) {
  const dx = x - CX, dy = y - CY;
  return ar.shape === 'square' ? ar.r - Math.max(Math.abs(dx), Math.abs(dy)) : ar.r - Math.hypot(dx, dy);
}

/** The point on the edge nearest to (x, y), pulled in by `inset`. */
export function edgePoint(ar, x, y, inset = 0) {
  const dx = x - CX, dy = y - CY, e = ar.r - inset;
  if (ar.shape === 'square') {
    if (Math.abs(dx) > Math.abs(dy)) return [CX + Math.sign(dx || 1) * e, CY + Math.max(-e, Math.min(e, dy))];
    return [CX + Math.max(-e, Math.min(e, dx)), CY + Math.sign(dy || 1) * e];
  }
  const an = Math.atan2(dy, dx);
  return [CX + Math.cos(an) * e, CY + Math.sin(an) * e];
}

/** Trace the arena outline (grown by `grow`) as the current canvas path. */
export function arenaPath(c, ar, grow = 0) {
  c.beginPath();
  const r = ar.r + grow;
  if (ar.shape === 'square') { if (c.roundRect) c.roundRect(CX - r, CY - r, 2 * r, 2 * r, Math.max(0, grow * 1.5)); else c.rect(CX - r, CY - r, 2 * r, 2 * r); }
  else c.arc(CX, CY, r, 0, 7);
}

/** Starting spots for n pens, evenly around the centre. */
export function spawnPoints(n) {
  if (n === 2) return [[CX - 175, CY, Math.PI / 2], [CX + 175, CY, Math.PI / 2]];
  return Array.from({ length: n }, (_, i) => {
    const th = Math.PI + (i * 2 * Math.PI) / n;
    return [CX + Math.cos(th) * 175, CY + Math.sin(th) * 175, th + Math.PI / 2];
  });
}
