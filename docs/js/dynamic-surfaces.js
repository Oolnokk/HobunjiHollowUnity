// Dynamic surfaces / blockers — generic runtime registry for animated playable
// geometry. The first consumer is the dev Random Test Ruin, but this module is
// intentionally ruin-agnostic so bridges, lifts, moving floors, collapsing
// stairs, doors, boats, etc. can share the same support/collision vocabulary.
(() => {
  'use strict';

  const surfaces = new Map();
  const blockers = new Map();
  const pits = new Map();
  const beforeRenderClients = new Set();
  const blockerFilters = new Set();

  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const evalValue = (value, ...args) => typeof value === 'function' ? value(...args) : value;

  function normalizeBounds(raw) {
    const b = raw || {};
    const minX = number(b.minX, -Infinity);
    const maxX = number(b.maxX, Infinity);
    const minZ = number(b.minZ, -Infinity);
    const maxZ = number(b.maxZ, Infinity);
    return {
      minX: Math.min(minX, maxX), maxX: Math.max(minX, maxX),
      minZ: Math.min(minZ, maxZ), maxZ: Math.max(minZ, maxZ),
    };
  }

  function contains(bounds, x, z, pad = 0) {
    return x >= bounds.minX - pad && x <= bounds.maxX + pad
      && z >= bounds.minZ - pad && z <= bounds.maxZ + pad;
  }

  function register(kind, store, definition) {
    if (!definition?.id) throw new Error(`DynamicSurfaces ${kind} requires an id`);
    const record = { scope: 'global', enabled: true, ...definition, kind };
    store.set(record.id, record);
    return record;
  }

  const registerSurface = definition => register('surface', surfaces, definition);
  const registerBlocker = definition => register('blocker', blockers, definition);
  const registerPit = definition => register('pit', pits, definition);

  function remove(id) {
    return surfaces.delete(id) || blockers.delete(id) || pits.delete(id);
  }

  function clearScope(scope) {
    for (const store of [surfaces, blockers, pits]) {
      for (const [id, record] of store) if (record.scope === scope) store.delete(id);
    }
  }

  function recordEnabled(record) {
    return evalValue(record.enabled, record) !== false;
  }

  function recordBounds(record) {
    return normalizeBounds(evalValue(record.bounds, record));
  }

  function surfaceTopY(record, x, z) {
    return number(evalValue(record.topY, x, z, record), 0);
  }

  function sampleSupport(x, z, options = {}) {
    const minY = number(options.minY, -Infinity);
    const maxY = number(options.maxY, Infinity);
    const pad = number(options.pad, 0);
    let best = null;
    for (const record of surfaces.values()) {
      if (!recordEnabled(record)) continue;
      const bounds = recordBounds(record);
      if (!contains(bounds, x, z, pad)) continue;
      if (typeof record.supports === 'function' && !record.supports(x, z, record)) continue;
      const y = surfaceTopY(record, x, z);
      if (y < minY || y > maxY) continue;
      if (!best || y > best.y || (y === best.y && number(record.priority) > number(best.record.priority))) {
        best = { id: record.id, y, bounds, record };
      }
    }
    return best;
  }

  function pointInPit(x, z, pad = 0) {
    for (const record of pits.values()) {
      if (!recordEnabled(record)) continue;
      const bounds = recordBounds(record);
      if (contains(bounds, x, z, pad)) return { id: record.id, bounds, record };
    }
    return null;
  }

  function addBlockerFilter(fn) {
    if (typeof fn !== 'function') return () => {};
    blockerFilters.add(fn);
    return () => blockerFilters.delete(fn);
  }

  function passesBlockerFilters(record, x, z, context) {
    for (const filter of [...blockerFilters]) {
      try {
        if (filter(record, x, z, context) === false) return false;
      } catch (err) {
        console.warn('[DynamicSurfaces] blocker filter failed', err);
      }
    }
    return true;
  }

  function blockerAt(x, z, options = {}) {
    const radius = number(options.radius, 0);
    const actorHeight = number(options.actorHeight, 1.25);
    for (const record of blockers.values()) {
      if (!recordEnabled(record)) continue;
      const bounds = recordBounds(record);
      if (!contains(bounds, x, z, radius)) continue;
      if (typeof record.blocksAt === 'function' && !record.blocksAt(x, z, actorHeight, record, radius, options)) continue;
      const context = { radius, actorHeight, bounds, options };
      if (!passesBlockerFilters(record, x, z, context)) continue;
      return { id: record.id, bounds, record };
    }
    return null;
  }

  function addBeforeRenderClient(fn) {
    if (typeof fn === 'function') beforeRenderClients.add(fn);
    return () => beforeRenderClients.delete(fn);
  }

  function runBeforeRender(scene, camera) {
    for (const fn of [...beforeRenderClients]) {
      try { fn(scene, camera); }
      catch (err) { console.warn('[DynamicSurfaces] frame client failed', err); }
    }
  }

  function debugSnapshot() {
    return {
      surfaces: [...surfaces.values()].map(record => ({ id: record.id, scope: record.scope, enabled: recordEnabled(record), bounds: recordBounds(record) })),
      blockers: [...blockers.values()].map(record => ({ id: record.id, scope: record.scope, enabled: recordEnabled(record), bounds: recordBounds(record) })),
      pits: [...pits.values()].map(record => ({ id: record.id, scope: record.scope, enabled: recordEnabled(record), bounds: recordBounds(record) })),
      frameClients: beforeRenderClients.size,
      blockerFilters: blockerFilters.size,
    };
  }

  function installRendererHook() {
    const OriginalRenderer = window.THREE?.WebGLRenderer;
    if (!OriginalRenderer || OriginalRenderer.__hobunjiDynamicSurfaceWrapped) return;
    const WrappedRenderer = function (...args) {
      const instance = new OriginalRenderer(...args);
      const originalRender = instance.render.bind(instance);
      instance.render = function (scene, camera) {
        runBeforeRender(scene, camera);
        return originalRender(scene, camera);
      };
      return instance;
    };
    WrappedRenderer.prototype = OriginalRenderer.prototype;
    try { Object.setPrototypeOf(WrappedRenderer, OriginalRenderer); } catch (_) {}
    WrappedRenderer.__hobunjiDynamicSurfaceWrapped = true;
    window.THREE.WebGLRenderer = WrappedRenderer;
  }

  window.DynamicSurfaces = Object.freeze({
    registerSurface, registerBlocker, registerPit,
    remove, clearScope, sampleSupport, pointInPit, blockerAt,
    addBlockerFilter, addBeforeRenderClient, debugSnapshot,
  });

  installRendererHook();
})();
