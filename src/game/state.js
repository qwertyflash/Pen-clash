// Shared mutable state. Modules read S.G (the current match) and S.net (online session).
import { clamp, store } from '../core/util.js';
import { PRE, safeAv } from '../ui/avatars.js';

export const S = {
  /** Current match, or null on menus. */
  G: null,
  /** Online session, or null when offline. */
  net: null,
  /** 'bot' | 'local' | 'online' */
  mode: 'bot',
  diff: store.get('diff', 1),
  botPen: (Math.random() * 6) | 0,
  /** Recent uncaught errors, shown in the debug panel. */
  errors: [],
  /** Fighter setup for player 1 and 2 (player 2 only used in pass & play). */
  cfg: [0, 1].map((i) => ({
    name: store.get('n' + i, 'Player ' + (i + 1)),
    pen: clamp(store.get('p' + i, i ? 3 : 0) | 0, 0, 5),
    av: safeAv(store.get('a' + i, null), PRE[i]),
  })),
};

export const saveCfg = () => S.cfg.forEach((c, i) => { store.set('n' + i, c.name); store.set('p' + i, c.pen); store.set('a' + i, c.av); });

/** True when this device runs the real physics and rules (offline, or the online host). */
export const isAuth = () => !!S.G && (S.G.mode !== 'online' || (!!S.net && S.net.role === 'host'));

/** Can this device aim for player i right now? */
export function canCtl(i) {
  const G = S.G;
  if (!G) return false;
  const p = G.pl[i];
  if (p.bot || !p.local) return false;
  return G.mode !== 'online' || i === G.me;
}
