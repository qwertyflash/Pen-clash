// Menu, fighter setup, online lobby and result-screen buttons.
import { PENS, MAX_PLAYERS } from '../core/constants.js';
import { ARENAS } from '../core/arenas.js';
import { $, $$, clamp, esc, store } from '../core/util.js';
import { ac, sfx } from './audio.js';
import { drawPen } from './draw.js';
import { arenaCanvas } from './arena.js';
import { PRE, BOTAV } from './avatars.js';
import { openCam, onAvatarPicked } from './camera.js';
import { show } from './screens.js';
import { S, saveCfg, isAuth } from '../game/state.js';
import { startOffline, startMatch, clearTimers } from '../game/match.js';
import { joinRoom, leaveNet, lobbyReset, requestRematch, stat, hostStartMatch } from '../game/online.js';
import { resetHud } from '../game/hud.js';

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
  const names = ['Inkbot', 'Blotbot', 'Smudgebot'].slice(0, S.bots).join(', ');
  return `<section class="pcard botcard" data-i="1"><div class="ptag">${S.bots > 1 ? 'Bots' : 'Bot'}</div>
 <div class="avrow"><img class="avbig" src="${BOTAV}" alt="Inkbot avatar"><div><h3 style="font-size:26px">${S.bots > 1 ? S.bots + ' bots' : 'Inkbot'}</h3><p class="muted" style="color:#4b4f6b;margin:4px 0 0">${esc(names)}. Each picks a random pen.</p></div></div>
 <div class="fl">Difficulty<div class="chips">${['Easy', 'Pro', 'Insane'].map((n, k) => `<button class="chipb" data-act="diff" data-k="${k}" aria-pressed="${k === S.diff}">${n}</button>`).join('')}</div></div></section>`;
}

function settingsHTML() {
  const mode = S.mode;
  const chips = (act, opts, cur) => `<div class="chips">${opts.map((k) => `<button class="chipb" data-act="${act}" data-k="${k}" aria-pressed="${k === cur}">${k}</button>`).join('')}</div>`;
  const count = mode === 'bot' ? `<div class="fl">Bots${chips('bots', [1, 2, 3], S.bots)}</div>`
    : mode === 'local' ? `<div class="fl">Players${chips('locals', [2, 3, 4], S.locals)}</div>`
      : `<p class="hostNote">Up to ${MAX_PLAYERS} players. If you create the match, everyone plays on your arena.</p>`;
  return `<h3>Arena</h3><div class="arenas">${ARENAS.map((a) => `<button class="arenaBtn" data-act="arena" data-k="${a.id}" aria-pressed="${a.id === S.arena}"><canvas data-arena="${a.id}" width="120" height="120"></canvas><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></button>`).join('')}</div>${count}`;
}

function drawArenaPreviews() {
  $$('canvas[data-arena]').forEach((c) => {
    const ar = ARENAS.find((a) => a.id === c.dataset.arena), x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(arenaCanvas(ar), 80, 80, 900, 900, 0, 0, c.width, c.height);
  });
}

function renderSetup() {
  const mode = S.mode;
  $('#setupTitle').textContent = mode === 'bot' ? 'Pick your fighter' : mode === 'local' ? 'Fighters, one desk' : 'Your online fighter';
  $('#goBtn').textContent = mode === 'online' ? 'Continue to lobby' : 'Start fight';
  let h = cardHTML(0);
  if (mode === 'local') for (let i = 1; i < S.locals; i++) h += cardHTML(i);
  if (mode === 'bot') h += botHTML();
  $('#settings').innerHTML = settingsHTML();
  $('#cards').innerHTML = h;
  drawArenaPreviews();
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
  const p = PENS[S.cfg[+c.dataset.i].pen];
  drawPen(x, p, w / 2, h / 2 - 3, -0.06, Math.min((w - 24) / 230, h / 38));
}

const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function initMenu() {
  $$('.mode').forEach((b) => { b.onclick = () => { ac(); S.mode = b.dataset.mode; renderSetup(); show('setup'); }; });
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
  $('#settings').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'arena') S.arena = b.dataset.k;
    else if (a === 'bots') S.bots = +b.dataset.k;
    else if (a === 'locals') S.locals = +b.dataset.k;
    else return;
    sfx.tick(); saveCfg(); renderSetup();
  });
  $('#cards').addEventListener('input', (e) => { if (e.target.classList.contains('name')) S.cfg[+e.target.dataset.i].name = e.target.value.slice(0, 14); });
  onAvatarPicked((i, url) => { S.cfg[i].av = url; saveCfg(); renderSetup(); });

  $('#goBtn').onclick = () => {
    S.cfg.forEach((c, i) => { c.name = c.name.trim() || 'Player ' + (i + 1); });
    saveCfg();
    resetHud();
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
  $('#startBtn').onclick = () => { resetHud(); hostStartMatch(); };
  $('#copyCode').onclick = () => {
    const c = $('#codeBig').textContent;
    try { navigator.clipboard.writeText(c).then(() => stat('Code copied. Send it to your friend.'), () => stat('Copy blocked here. Read the code out instead.')); }
    catch { stat('Copy blocked here. Read the code out instead.'); }
  };

  // Result + quit
  $('#rAgain').onclick = () => { if (S.G.mode !== 'online' || isAuth()) startMatch(); else requestRematch(); };
  $('#rMenu').onclick = $('#quit').onclick = () => { leaveNet(); clearTimers(); S.G = null; $('#result').hidden = true; show('menu'); };
}
