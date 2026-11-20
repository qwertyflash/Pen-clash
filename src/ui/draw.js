// Canvas drawing helpers shared by the arena, the menu hero and the pen picker.
function mix(h, t, k) {
  const n = parseInt(h.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255, T = t ? 255 : 0;
  return `rgb(${Math.round(r + (T - r) * k)},${Math.round(g + (T - g) * k)},${Math.round(b + (T - b) * k)})`;
}
const shade = (h) => mix(h, 0, 0.38), light = (h) => mix(h, 1, 0.5);

export function rr(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
}

export function drawPen(c, d, x, y, a, sc = 1, al = 1) {
  const L = d.len, r = d.r, tipL = r * 2.3, capL = L * 0.34, K = '#0b0b14', bx = L / 2 - tipL;
  c.save(); c.globalAlpha = al;
  c.save(); c.translate(x + 6 * sc, y + 9 * sc); c.rotate(a); c.scale(sc, sc); c.fillStyle = 'rgba(6,10,60,.25)'; rr(c, -L / 2, -r, L, 2 * r, r); c.fill(); c.restore();
  c.translate(x, y); c.rotate(a); c.scale(sc, sc); c.lineWidth = 2.2; c.strokeStyle = K; c.lineJoin = 'round';
  const gt = c.createLinearGradient(0, -r, 0, r); gt.addColorStop(0, '#fff'); gt.addColorStop(0.35, d.tip); gt.addColorStop(1, shade(d.tip));
  c.beginPath(); c.moveTo(bx - 2, -r * 0.82); c.lineTo(L / 2 - 2.5, -1.8); c.quadraticCurveTo(L / 2 + 1, 0, L / 2 - 2.5, 1.8); c.lineTo(bx - 2, r * 0.82); c.closePath(); c.fillStyle = gt; c.fill(); c.stroke();
  if (d.kind === 'fount') { c.strokeStyle = '#5a4210'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(bx + 2, 0); c.lineTo(L / 2 - 3, 0); c.stroke(); c.lineWidth = 2.2; c.strokeStyle = K; }
  c.fillStyle = d.ink; c.beginPath(); c.arc(L / 2 - 1.5, 0, 2, 0, 7); c.fill();
  const gb = c.createLinearGradient(0, -r, 0, r); gb.addColorStop(0, d.acc); gb.addColorStop(0.3, d.body); gb.addColorStop(1, d.body2);
  const b0 = -L / 2 + capL - r; rr(c, b0, -r, bx - b0, 2 * r, [0, r * 0.5, r * 0.5, 0]); c.fillStyle = gb; c.fill(); c.stroke();
  if (d.clear) { c.fillStyle = d.ink; rr(c, -L / 2 + capL, -r * 0.2, bx - (-L / 2 + capL) + 2, r * 0.4, 2); c.fill(); }
  if (d.kind !== 'hl' && d.kind !== 'metal') { c.fillStyle = 'rgba(11,11,20,.2)'; for (let k = 0; k < 5; k++) c.fillRect(bx - r * 3.4 + k * r * 0.62, -r + 1.6, r * 0.28, 2 * r - 3.2); }
  c.fillStyle = 'rgba(255,255,255,.4)'; rr(c, -L / 2 + capL + 4, -r * 0.64, bx - (-L / 2 + capL) - 18, r * 0.28, r * 0.14); c.fill();
  const gc = c.createLinearGradient(0, -r, 0, r); gc.addColorStop(0, light(d.cap)); gc.addColorStop(0.35, d.cap); gc.addColorStop(1, shade(d.cap));
  rr(c, -L / 2, -r * 1.05, capL, 2 * r * 1.05, [r, r * 0.3, r * 0.3, r]); c.fillStyle = gc; c.fill(); c.stroke();
  c.fillStyle = d.acc; c.fillRect(-L / 2 + capL - 7, -r * 1.05 + 1, 4, 2 * r * 1.05 - 2);
  if (d.kind === 'hl') { c.fillStyle = 'rgba(255,255,255,.45)'; rr(c, -L / 2 + 8, -r * 0.72, capL - 22, r * 0.34, r * 0.17); c.fill(); }
  else { c.fillStyle = d.kind === 'fount' ? d.acc : '#eef1f7'; rr(c, -L / 2 + 9, -r * 0.33, capL * 0.93, r * 0.66, r * 0.33); c.fill(); c.stroke(); }
  if (d.kind === 'click') { c.fillStyle = d.cap; rr(c, -L / 2 - 7, -r * 0.5, 9, r, 3); c.fill(); c.stroke(); }
  c.restore();
}

const imgCache = new Map();
function img(u) {
  if (!u) return null;
  let i = imgCache.get(u);
  if (!i) { i = new Image(); i.src = u; imgCache.set(u, i); }
  return i.complete && i.naturalWidth ? i : null;
}

/** Round avatar badge drawn on top of a pen. */
export function drawBadge(c, x, y, avatarUrl, col, sc) {
  const im = img(avatarUrl), r = 20 * sc;
  c.save();
  c.fillStyle = '#0b0b14'; c.beginPath(); c.arc(x, y, r + 5, 0, 7); c.fill();
  c.fillStyle = col; c.beginPath(); c.arc(x, y, r + 2.5, 0, 7); c.fill();
  c.beginPath(); c.arc(x, y, r - 1, 0, 7); c.clip();
  if (im) c.drawImage(im, x - r, y - r, 2 * r, 2 * r); else { c.fillStyle = '#fff'; c.fill(); }
  c.restore();
}
