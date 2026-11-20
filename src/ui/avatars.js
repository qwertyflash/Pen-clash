import { rr } from './draw.js';

// Built-in cartoon avatars, drawn once at startup.
export function presetAvatar(i){
 const c=document.createElement('canvas');c.width=c.height=160;const x=c.getContext('2d'),K='#0b0b14';
 const bgs=['#ff4d8d','#ffe23d','#22e1c6','#ff7a1a','#9b8cff','#ffffff'],skins=['#f6c9a8','#d9a07a','#a8714f','#7a4a2e','#ffd9bd','#c58c63'];
 x.fillStyle=bgs[i];x.fillRect(0,0,160,160);
 x.fillStyle=K;x.beginPath();x.arc(80,82,54,Math.PI,0);x.fill();
 x.fillStyle=skins[i];x.beginPath();x.ellipse(80,92,42,46,0,0,7);x.fill();x.lineWidth=5;x.strokeStyle=K;x.stroke();
 x.fillStyle=K;
 if(i%3===0){x.beginPath();x.moveTo(36,84);x.quadraticCurveTo(58,34,124,74);x.quadraticCurveTo(98,54,80,56);x.quadraticCurveTo(52,56,36,84);x.fill()}
 else if(i%3===1){for(let k=0;k<5;k++){x.beginPath();x.arc(46+k*17,56,13,0,7);x.fill()}}
 else{rr(x,38,44,84,20,8);x.fill()}
 if(i===4){x.fillRect(46,84,32,15);x.fillRect(82,84,32,15);x.fillRect(76,88,8,4)}
 else if(i%2===0){[[63,92],[97,92]].forEach(([a,b])=>{x.beginPath();x.arc(a,b,6,0,7);x.fill()})}
 else{x.lineWidth=5;x.lineCap='round';[[63,92],[97,92]].forEach(([a,b])=>{x.beginPath();x.moveTo(a-7,b);x.lineTo(a+7,b);x.stroke()})}
 x.lineWidth=5;x.lineCap='round';x.beginPath();if(i%3===2){x.arc(80,114,6,0,7)}else{x.arc(80,106,15,.2*Math.PI,.8*Math.PI)}x.stroke();
 x.fillStyle='rgba(255,77,141,.35)';[54,106].forEach(cx=>{x.beginPath();x.arc(cx,110,8,0,7);x.fill()});
 return c.toDataURL('image/png');
}
export function botAvatar(){
 const c=document.createElement('canvas');c.width=c.height=160;const x=c.getContext('2d'),K='#0b0b14';
 x.fillStyle='#1631b4';x.fillRect(0,0,160,160);
 x.strokeStyle=K;x.lineWidth=5;x.beginPath();x.moveTo(80,40);x.lineTo(80,22);x.stroke();x.fillStyle='#ff4d8d';x.beginPath();x.arc(80,20,9,0,7);x.fill();x.stroke();
 rr(x,32,40,96,86,22);x.fillStyle='#22e1c6';x.fill();x.stroke();
 rr(x,44,58,72,36,12);x.fillStyle=K;x.fill();
 x.fillStyle='#ffe23d';x.beginPath();x.arc(64,76,8,0,7);x.arc(96,76,8,0,7);x.fill();
 x.fillStyle=K;for(let k=0;k<4;k++)x.fillRect(56+k*13,104,8,10);
 return c.toDataURL('image/png');
}

export const PRE = Array.from({ length: 6 }, (_, i) => presetAvatar(i));
export const BOTAV = botAvatar();

/** Accept only small inline images from untrusted peers; anything else falls back to d. */
export const safeAv = (u, d = PRE[2]) =>
  typeof u === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(u) && u.length < 200000 ? u : d;

/** Downscale an image URL to an n x n JPEG data URL (for sending avatars online). */
export function shrink(u, n, q) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = n;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, n, n); x.drawImage(im, 0, 0, n, n);
      res(c.toDataURL('image/jpeg', q));
    };
    im.onerror = () => res('');
    im.src = u;
  });
}
