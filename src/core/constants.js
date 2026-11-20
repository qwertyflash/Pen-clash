// Arena geometry (world units) and flick tuning.
export const CX = 500, CY = 500, R = 370;
export const KJ = 4.8, MAXPULL = 230, MAXJ = KJ * MAXPULL;
export const ANG = 0.38, E = 0.55;
export const WIN_ROUNDS = 3;

// Player colours: P1 pink, P2 yellow.
export const COL = ['#ff4d8d', '#ffe23d'];

// Bump this whenever the online message format changes. Players on different
// versions are told to refresh instead of silently getting stuck.
export const PROTOCOL = 3;

export const PENS = [
  { name: 'Ballpoint Blue', tag: 'All-rounder', len: 190, r: 9, mass: 1, fric: 1, body: '#2f52e0', body2: '#14299a', cap: '#13206b', acc: '#dfe6ff', tip: '#c9ced8', ink: '#2747d8', kind: 'ball' },
  { name: 'Steel Titan', tag: 'Heavy hitter, slow mover', len: 176, r: 10.5, mass: 1.7, fric: 1.25, body: '#c3cad4', body2: '#5d6573', cap: '#30363f', acc: '#ffffff', tip: '#8a929e', ink: '#30363f', kind: 'metal' },
  { name: 'Featherlite Gel', tag: 'Long, light and fast', len: 218, r: 8, mass: 0.7, fric: 0.85, body: '#ffffff', body2: '#c9d1e3', cap: '#ff4d8d', acc: '#ffffff', tip: '#ff4d8d', ink: '#ff4d8d', kind: 'gel', clear: 1 },
  { name: 'Highlighter Brick', tag: 'Wide body, hard to move', len: 150, r: 15, mass: 1.3, fric: 1.45, body: '#ffe23d', body2: '#d6a400', cap: '#1d1d22', acc: '#fff6a8', tip: '#ffd400', ink: '#ffd000', kind: 'hl' },
  { name: 'Fountain Royale', tag: 'Weighted and precise', len: 200, r: 10, mass: 1.2, fric: 0.95, body: '#8a1c38', body2: '#3d0716', cap: '#1a0a10', acc: '#e8c26b', tip: '#e8c26b', ink: '#1e1b4b', kind: 'fount' },
  { name: 'Neon Clicker', tag: 'Slippery and spinny', len: 184, r: 9.5, mass: 0.9, fric: 0.7, body: '#22e1c6', body2: '#0a8e7f', cap: '#ff7a1a', acc: '#e9fffb', tip: '#d0d4dc', ink: '#0a8e7f', kind: 'click' },
];
