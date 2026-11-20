// "Make your avatar" modal: live selfie with filters, or crop an uploaded photo.
import { $, $$, clamp } from '../core/util.js';
import { sfx } from './audio.js';

let onPicked = () => {};
/** Register what happens when the player confirms an avatar: (playerIndex, dataUrl). */
export function onAvatarPicked(fn) { onPicked = fn; }

let camI=0,stream=null,filt='none';const raw=document.createElement('canvas');raw.width=raw.height=256;
const snap=$('#snap'),vid=$('#vid'),FILTERS=[['none','Original'],['toon','Toon'],['pop','Pop'],['mono','Mono']];
$('#filters').innerHTML=FILTERS.map(([k,n])=>`<button class="chipb" data-f="${k}" aria-pressed="${k==='none'}">${n}</button>`).join('');
$('#filters').onclick=e=>{const b=e.target.closest('[data-f]');if(!b)return;filt=b.dataset.f;$$('#filters .chipb').forEach(c=>c.setAttribute('aria-pressed',c===b));applyFilter()};
function setCam(st){vid.hidden=st!=='live';snap.hidden=st!=='shot';$('#camMsg').hidden=st!=='blocked';$('#filters').hidden=st!=='shot';
 $('#camSnap').hidden=st!=='live';$('#camFile').hidden=st!=='blocked';$('#camRetake').hidden=st!=='shot';$('#camUse').hidden=st!=='shot'}
function stopCam(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}}
export async function openCam(i,upload){camI=i;$('#cam').hidden=false;$('#camMsg').textContent='Choose a photo to crop into your avatar.';setCam('blocked');
 if(upload){$('#fileUp').click();return}
 if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){$('#camMsg').textContent='Live preview isn’t available here. Tap “Open camera” — on a phone it opens your front camera.';return}
 $('#camMsg').textContent='Starting camera…';
 try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:720},height:{ideal:720}},audio:false});vid.srcObject=stream;await vid.play();setCam('live')}
 catch(e){stopCam();$('#camMsg').textContent='This view blocks the live camera. Tap “Open camera” — on a phone it opens your front camera; on a computer pick a photo.'}}
function cropFrom(src,w,h,mirror){const x=raw.getContext('2d'),s=Math.min(w,h);x.save();x.clearRect(0,0,256,256);if(mirror){x.translate(256,0);x.scale(-1,1)}x.drawImage(src,(w-s)/2,(h-s)/2*.8,s,s,0,0,256,256);x.restore();filt='none';$$('#filters .chipb').forEach(c=>c.setAttribute('aria-pressed',c.dataset.f==='none'));applyFilter();setCam('shot')}
function applyFilter(){const x=snap.getContext('2d');x.drawImage(raw,0,0);if(filt==='none')return;const im=x.getImageData(0,0,256,256),d=im.data;
 const st=[[22,49,180],[255,77,141],[255,226,61]];
 for(let i=0;i<d.length;i+=4){let r=d[i],g=d[i+1],b=d[i+2];const l=.299*r+.587*g+.114*b;
  if(filt==='toon'){const m=(r+g+b)/3;r=m+(r-m)*1.4;g=m+(g-m)*1.4;b=m+(b-m)*1.4;r=Math.round(clamp(r,0,255)/64)*64;g=Math.round(clamp(g,0,255)/64)*64;b=Math.round(clamp(b,0,255)/64)*64}
  else if(filt==='pop'){const t=clamp((l/255-.5)*1.5+.5,0,1)*2,k=t<1?0:1,f=t-k,A=st[k],B=st[k+1];r=A[0]+(B[0]-A[0])*f;g=A[1]+(B[1]-A[1])*f;b=A[2]+(B[2]-A[2])*f}
  else{const v=clamp((l-128)*1.6+128,0,255);r=g=b=v}
  d[i]=r;d[i+1]=g;d[i+2]=b}
 x.putImageData(im,0,0)}
$('#camSnap').onclick=()=>{if(!vid.videoWidth)return;cropFrom(vid,vid.videoWidth,vid.videoHeight,true);stopCam();sfx.tick()};
$('#camFile').onclick=()=>$('#fileCam').click();
$('#camRetake').onclick=()=>openCam(camI,false);
$('#camClose').onclick=()=>{stopCam();$('#cam').hidden=true};
$('#camUse').onclick=()=>{const c=document.createElement('canvas');c.width=c.height=160;c.getContext('2d').drawImage(snap,0,0,160,160);const url=c.toDataURL('image/jpeg',.85);stopCam();$('#cam').hidden=true;onPicked(camI,url)};
['#fileCam','#fileUp'].forEach(id=>$(id).onchange=e=>{const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;const u=URL.createObjectURL(f),im=new Image();
 im.onload=()=>{cropFrom(im,im.naturalWidth,im.naturalHeight,false);URL.revokeObjectURL(u)};im.onerror=()=>{$('#camMsg').textContent='That file could not be opened as an image.'};im.src=u});

