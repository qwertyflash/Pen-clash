// Shared mutable state. Modules read S.G (the current match) and S.net (online session).
import { MAX_PLAYERS } from '../core/constants.js';
import { clamp, store } from '../core/util.js';
import { arenaById } from '../core/arenas.js';
import { PRE, safeAv } from '../ui/avatars.js';

export const S = {
  /** Current match, or null on menus. */
  G: null,
  /** Online session, or null when offline. */
  net: null,
  /** 'bot' | 'local' | 'online' */
  mode: 'bot',
  diff: store.get('diff', 1),
  /** Chosen arena id (the online host's choice applies to everyone). */
  arena: arenaById(store.get('arena', 'classic')).id,
  /** Vs Bot: how many bots (1-3). Pass & play: how many players (2-4). */
  bots: clamp(store.get('bots', 1) | 0, 1, MAX_PLAYERS - 1),
  locals: clamp(store.get('locals', 2) | 0, 2, MAX_PLAYERS),
  /** Recent uncaught errors, shown in the debug panel. */
  errors: [],
  /** Fighter setup per seat. Seat 0 is also your online fighter. */
  cfg: Array.from({ length: MAX_PLAYERS }, (_, i) => ({
    name: store.get('n' + i, 'Player ' + (i + 1)),
    pen: clamp(store.get('p' + i, [0, 3, 2, 5][i]) | 0, 0, 5),
    av: safeAv(store.get('a' + i, null), PRE[i]),
  })),
};

export const saveCfg = () => {
  S.cfg.forEach((c, i) => { store.set('n' + i, c.name); store.set('p' + i, c.pen); store.set('a' + i, c.av); });
  store.set('arena', S.arena); store.set('bots', S.bots); store.set('locals', S.locals);
};

/** True when this device runs the real physics and rules (offline, or the online host). */
export const isAuth = () => !!S.G && (S.G.mode !== 'online' || (!!S.net && S.net.role === 'host'));

/** Can this device aim for player i right now? */
export function canCtl(i) {
  const G = S.G;
  if (!G || !G.pl[i]) return false;
  const p = G.pl[i];
  if (p.bot || !p.local || p.gone) return false;
  return G.mode !== 'online' || i === G.me;
}
