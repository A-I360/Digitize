/**
 * Storage wrapper that never throws.
 *
 * `localStorage` access raises a SecurityError in Safari private mode, in
 * Firefox with strict tracking protection, and inside any cross-origin frame
 * with third-party storage blocked. Unguarded, one of those calls takes the
 * whole script down with it — so every access goes through here.
 */

const PREFIX = 'synq:';

function backend(kind) {
  try {
    const store = kind === 'session' ? window.sessionStorage : window.localStorage;
    const probe = `${PREFIX}__probe`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

/** In-memory fallback so behaviour stays consistent when storage is blocked. */
const memory = new Map();

function resolve(kind) {
  const store = backend(kind);
  if (store) return { get: (k) => store.getItem(PREFIX + k), set: (k, v) => store.setItem(PREFIX + k, v), del: (k) => store.removeItem(PREFIX + k) };
  return {
    get: (k) => (memory.has(k) ? memory.get(k) : null),
    set: (k, v) => void memory.set(k, v),
    del: (k) => void memory.delete(k),
  };
}

const local = resolve('local');
const session = resolve('session');

export const store = {
  get: (key, fallback = null) => {
    const raw = local.get(key);
    return raw === null ? fallback : raw;
  },
  set: (key, value) => local.set(key, String(value)),
  remove: (key) => local.del(key),
};

export const sessionStore = {
  get: (key, fallback = null) => {
    const raw = session.get(key);
    return raw === null ? fallback : raw;
  },
  set: (key, value) => session.set(key, String(value)),
  remove: (key) => session.del(key),
  take: (key) => {
    const value = session.get(key);
    session.del(key);
    return value;
  },
};
