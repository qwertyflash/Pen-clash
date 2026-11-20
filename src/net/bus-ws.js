// Relay through our own server (server/index.js), same origin as the page.
export async function relayAvailable(base = '') {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2000);
    const r = await fetch(base + '/api/health', { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = await r.json();
    return !!(j && j.relay);
  } catch { return false; }
}

export function connectWs(code, myId, onStatus, base = '') {
  const origin = base || location.origin;
  const url = origin.replace(/^http/, 'ws') + '/ws?room=' + encodeURIComponent(code.toLowerCase()) + '&id=' + encodeURIComponent(myId);
  let ws = null, onMsg = () => {}, onRe = () => {}, closed = false, first = true, backoff = 500;

  return new Promise((resolve, reject) => {
    const bus = {
      name: 'server',
      host: new URL(origin).host,
      get connected() { return !!ws && ws.readyState === 1; },
      send(s) { if (ws && ws.readyState === 1) ws.send(s); },
      onMessage(fn) { onMsg = fn; },
      onReconnect(fn) { onRe = fn; },
      close(lastWords) { closed = true; try { if (lastWords && ws.readyState === 1) ws.send(lastWords); ws.close(); } catch { /* */ } },
    };
    const open = () => {
      onStatus?.('Connecting to the game server…');
      ws = new WebSocket(url);
      ws.onopen = () => {
        backoff = 500;
        if (first) { first = false; resolve(bus); } else onRe();
      };
      ws.onmessage = (e) => onMsg(typeof e.data === 'string' ? e.data : '');
      ws.onclose = () => {
        if (closed) return;
        if (first) { first = false; reject(new Error('Could not connect to the game server.')); return; }
        setTimeout(() => { if (!closed) open(); }, backoff);
        backoff = Math.min(5000, backoff * 2);
      };
    };
    open();
  });
}
