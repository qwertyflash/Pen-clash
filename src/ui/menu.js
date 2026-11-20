// Menu, fighter setup, online lobby and result-screen buttons.
import { PENS } from '../core/constants.js';
import { $, $$, clamp, esc, store } from '../core/util.js';
import { ac, sfx } from './audio.js';
import { drawPen } from './draw.js';
import { PRE, BOTAV } from './avatars.js';
import { openCam, onAvatarPicked } from './camera.js';
import { show } from './screens.js';
import { S, saveCfg, isAuth } from '../game/state.js';
import { startOffline, startMatch, clearTimers } from '../game/match.js';
import { joinRoom, leaveNet, lobbyReset, requestRematch, stat } from '../game/online.js';

function statRows(d) {
  const s = [['Power', d.mass / 1.7], ['Speed', 0.7 / d.mass], ['Reach', d.len / 218], ['Grip', d.fric / 1.45]];
  return s.map(([n, v]) => `<div class="stat"><span>${n}</span><i><b style="width:${Math.round(clamp(v, 0.08, 1) * 100)}%"></b></i></div>`).join('');
}

function cardHTML(i) {
  const c = S.cfg[i];
  return `<section class="pcard" data-i="${i}"><div class="ptag">P${i + 1}</div>
 <div class="avrow"><img class="avbig" src="${c.av}" alt="Avatar of player ${i + 1}"><div class="avact">
 <button class="btn sm pink" data-act="selfie" data-i="${i}">Take a selfie</button><button class="btn sm ghost" data-act="upload" data-i="${i}">Upload photo</button></div></div>
 <div class="presets">${PRE.map((p, k) => `<button class="pre" data-act="pre" data-i="${i}" data-k="${k}" aria-label="Preset avatar ${k + 1}"><img src="${p}" alt=""></button>`).join('')}</div>
 <label class="fl">Name<input class="name" data-i="${i}" maxlength="14" value="${esc(c.name)}"></label>
 <div class="penpick"><button class="arrow" data-act="prev" data-i="${i}" aria-label="Previous pen">&lsaquo;</button><canvas class="penprev" data-i="${i}"></canvas><button class="arrow" data-act="next" data-i="${i}" aria-label="Next pen">&rsaquo;</button></div>
 <div class="pinfo" data-i="${i}"></div></section>`;
}

function botHTML() {
  const d = PENS[S.botPen];
  return `<section class="pcard botcard" data-i="1"><div class="ptag">Bot</div>
 <div class="avrow"><img class="avbig" src="${BOTAV}" alt="Inkbot avatar"><div><h3 style="font-size:26px">Inkbot</h3><p class="muted" style="color:#4b4f6b;margin:4px 0 0">Plays ${esc(d.name)}</p></div></div>
 <div class="fl">Difficulty<div class="chips">${['Easy', 'Pro', 'Insane'].map((n, k) => `<button class="chipb" data-act="diff" data-k="${k}" aria-pressed="${k === S.diff}">${n}</button>`).join('')}</div></div>
 <div class="penpick" style="grid-template-columns:minmax(0,1fr)"><canvas class="penprev" data-bot="1"></canvas></div><div class="pinfo">${statRows(d)}</div></section>`;
}

function renderSetup() {
  const mode = S.mode;
  $('#setupTitle').textContent = mode === 'bot' ? 'Pick your fighter' : mode === 'local' ? 'Two fighters, one desk' : 'Your online fighter';
  $('#goBtn').textContent = mode === 'online' ? 'Continue to lobby' : 'Start fight';
  let h = cardHTML(0);
  if (mode === 'local') h += cardHTML(1);
  if (mode === 'bot') h += botHTML();
  $('#cards').innerHTML = h;
  requestAnimationFrame(() => { $$('.pinfo[data-i]').forEach((e) => pinfo(+e.dataset.i)); $$('.penprev').forEach(drawPrev); });
}

function pinfo(i) {
  const d = PENS[S.cfg[i].pen], e = $(`.pinfo[data-i="${i}"]`);
  if (e) e.innerHTML = `<h3>${esc(d.name)}</h3><p class="tag">${esc(d.tag)}</p>${statRows(d)}`;
}

function drawPrev(c) {
  const w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  const d = Math.min(2, devicePixelRatio || 1);
  c.width = w * d; c.height = h * d;
  const x = c.getContext('2d');
  x.setTransform(d, 0, 0, d, 0, 0);
  const p = PENS[c.dataset.bot ? S.botPen : S.cfg[+c.dataset.i].pen];
  drawPen(x, p, w / 2, h / 2 - 3, -0.06, Math.min((w - 24) / 230, h / 38));
}

const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function initMenu() {
  $$('.mode').forEach((b) => { b.onclick = () => { ac(); S.mode = b.dataset.mode; S.botPen = (Math.random() * 6) | 0; renderSetup(); show('setup'); }; });
  $$('[data-back]').forEach((b) => { b.onclick = () => show(b.dataset.back); });

  $('#cards').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const i = +b.dataset.i, a = b.dataset.act;
    if (a === 'prev' || a === 'next') { S.cfg[i].pen = (S.cfg[i].pen + (a === 'next' ? 1 : 5)) % 6; pinfo(i); drawPrev($(`.penprev[data-i="${i}"]`)); sfx.tick(); }
    else if (a === 'pre') { S.cfg[i].av = PRE[+b.dataset.k]; $(`.pcard[data-i="${i}"] .avbig`).src = S.cfg[i].av; }
    else if (a === 'diff') { S.diff = +b.dataset.k; store.set('diff', S.diff); $$('.chipb').forEach((c) => c.setAttribute('aria-pressed', c === b)); }
    else if (a === 'selfie') openCam(i, false);
    else if (a === 'upload') openCam(i, true);
  });
  $('#cards').addEventListener('input', (e) => { if (e.target.classList.contains('name')) S.cfg[+e.target.dataset.i].name = e.target.value.slice(0, 14); });
  onAvatarPicked((i, url) => { S.cfg[i].av = url; saveCfg(); renderSetup(); });

  $('#goBtn').onclick = () => {
    S.cfg.forEach((c, i) => { c.name = c.name.trim() || 'Player ' + (i + 1); });
    saveCfg();
    if (S.mode === 'online') { lobbyReset(); show('online'); } else startOffline();
  };

  // Online lobby
  $('#onBack').onclick = () => { lobbyReset(); show('setup'); };
  $('#mkRoom').onclick = () => { ac(); let c = ''; for (let k = 0; k < 4; k++) c += ALPH[(Math.random() * ALPH.length) | 0]; joinRoom(c, 'host'); };
  $('#joinForm').onsubmit = (e) => {
    e.preventDefault(); ac();
    const c = $('#codeIn').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== 4) { stat('Codes are 4 characters.'); return; }
    joinRoom(c, 'guest');
  };
  $('#copyCode').onclick = () => {
    const c = $('#codeBig').textContent;
    try { navigator.clipboard.writeText(c).then(() => stat('Code copied. Send it to your friend.'), () => stat('Copy blocked here. Read the code out instead.')); }
    catch { stat('Copy blocked here. Read the code out instead.'); }
  };

  // Result + quit
  $('#rAgain').onclick = () => { if (S.G.mode !== 'online' || isAuth()) startMatch(); else requestRematch(); };
  $('#rMenu').onclick = $('#quit').onclick = () => { leaveNet(); clearTimers(); S.G = null; $('#result').hidden = true; show('menu'); };
}
