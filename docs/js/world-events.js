// WorldEvents — one small typed event stream so systems react to each other
// through data instead of bespoke cross-calls.
//
// Today's event types (payloads always carry `scope`, the map id the event
// happened in, so listeners ignore other areas):
//
//   'struck' { scope, targetId, targetKind, source, attackerId?, x?, y?, z?, lungeProgress? }
//              something was hit by a melee strike (source 'melee'), projectile, etc.
//   'blast'  { scope, x, z, y?, radius, tag?, sourceId? }
//              an explosion went off; x/z in tile units, radius in tiles.
//
// More types (burden placed, progress, ...) are added by the systems that own
// them. Dispatch is synchronous; a throwing listener is logged and isolated so
// it cannot break the emitter or other listeners. Emitting with no listeners
// costs one Map lookup, so emitters may emit unconditionally.
//
// Pure data; runs under node.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorldEvents = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const TYPES = Object.freeze({ STRUCK: 'struck', BLAST: 'blast' });
  const RING_SIZE = 32;

  const listeners = new Map(); // type -> Set(entry)
  const ring = new Array(RING_SIZE); // last events, for debug snapshots
  let ringHead = 0, emitted = 0;

  // options: { scope, filter, once }. Returns an unsubscribe function.
  function on(type, handler, options = {}) {
    if (typeof handler !== 'function') return () => {};
    const entry = { handler, scope: options.scope ?? null, filter: typeof options.filter === 'function' ? options.filter : null, once: options.once === true };
    const key = String(type);
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(entry);
    return () => { listeners.get(key)?.delete(entry); };
  }

  // Returns the number of listeners that received the event.
  function emit(type, payload = {}) {
    const key = String(type);
    emitted++;
    ring[ringHead] = { type: key, at: typeof performance !== 'undefined' ? performance.now() : Date.now(), scope: payload.scope ?? null };
    ringHead = (ringHead + 1) % RING_SIZE;
    const set = listeners.get(key);
    if (!set || set.size === 0) return 0;
    let delivered = 0;
    for (const entry of [...set]) { // Copy: a handler may unsubscribe itself or others.
      if (entry.scope != null && payload.scope !== entry.scope) continue;
      try {
        if (entry.filter && !entry.filter(payload)) continue;
        if (entry.once) set.delete(entry);
        entry.handler(payload);
        delivered++;
      } catch (error) {
        console.warn(`[WorldEvents] listener for "${key}" threw`, error);
      }
    }
    return delivered;
  }

  const listenerCount = type => listeners.get(String(type))?.size || 0;
  function clear() { listeners.clear(); ringHead = 0; emitted = 0; ring.fill(undefined); }
  function recent() { const out = []; for (let i = 0; i < RING_SIZE; i++) { const e = ring[(ringHead + i) % RING_SIZE]; if (e) out.push(e); } return out; }
  const debugSnapshot = () => ({ emitted, listeners: Object.fromEntries([...listeners].map(([k, v]) => [k, v.size])), recent: recent().slice(-8) });

  return Object.freeze({ TYPES, on, emit, listenerCount, clear, recent, debugSnapshot });
});
