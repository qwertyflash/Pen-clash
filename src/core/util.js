export const $ = (s) => document.querySelector(s);
export const $$ = (s) => [...document.querySelectorAll(s)];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Read an untrusted number, clamped to [a, b]; falls back to d. */
export const num = (v, a, b, d = 0) => (typeof v === 'number' && isFinite(v) ? clamp(v, a, b) : d);

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** localStorage wrapper that never throws (private mode, blocked storage...). */
export const store = {
  get(k, d) {
    try { const v = localStorage.getItem('pc_' + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('pc_' + k, JSON.stringify(v)); } catch { /* ignore */ }
  },
};
