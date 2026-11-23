// Dynamic surfaces / blockers — generic runtime registry for animated playable
// geometry. The first consumer is the dev Random Test Ruin, but this module is
// intentionally ruin-agnostic so bridges, lifts, moving floors, collapsing
// stairs, doors, boats, etc. can share the same support/collision vocabulary.
(() => {
  'use strict';

  const surfaces = new Map();
  const platesByArea = new Map(); // Small area-local index for plate support on ordinary terrain and voxel floors.
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

  function unindexPlate(record) {
    if (!record?.plateArea) return;
    const plates = platesByArea.get(record.plateArea);
    plates?.delete(record.id);
    if (!plates?.size) platesByArea.delete(record.plateArea);
  }

  function registerSurface(definition) {
    const previous = surfaces.get(definition?.id);
    const record = register('surface', surfaces, definition);
    unindexPlate(previous);
    if (record.plateArea) {
      if (!platesByArea.has(record.plateArea)) platesByArea.set(record.plateArea, new Map());
      platesByArea.get(record.plateArea).set(record.id, record);
    }
    return record;
  }

  // Use only the slab's own geometry. Engravings, glow and payload meshes
  // attached to it must never raise the standing height.
  function pressurePlateSurface(mesh, options) {
    const geometry = mesh?.geometry;
    if (!geometry) return null;
    mesh.userData.walkableElevation = true;
    if (!geometry.boundingBox) geometry.computeBoundingBox?.();
    const box = geometry.boundingBox;
    if (!box || box.isEmpty?.() || !mesh.updateWorldMatrix) return null;
    const bounds = {}; // Reused as the slab moves or depresses.
    const centerX = (box.min.x + box.max.x) * .5;
    const centerZ = (box.min.z + box.max.z) * .5;
    const radius = geometry.parameters?.radiusTop;
    const halfX = radius ?? (box.max.x - box.min.x) * .5;
    const halfZ = radius ?? (box.max.z - box.min.z) * .5;
    let supportedY; // Computed with the footprint test for the same underfoot query.
    const refresh = () => {
      mesh.updateWorldMatrix(true, false);
      const m = mesh.matrixWorld.elements;
      const x = m[0]*centerX + m[4]*box.max.y + m[8]*centerZ + m[12];
      const z = m[2]*centerX + m[6]*box.max.y + m[10]*centerZ + m[14];
      const dx = Math.abs(m[0])*halfX + Math.abs(m[8])*halfZ;
      const dz = Math.abs(m[2])*halfX + Math.abs(m[10])*halfZ;
      bounds.minX = x-dx; bounds.maxX = x+dx;
      bounds.minZ = z-dz; bounds.maxZ = z+dz;
      return bounds;
    };
    return {
      priority: 15,
      ...options,
      walkableElevation: true,
      bounds: refresh,
      supports: (x, z) => {
        const m = mesh.matrixWorld.elements;
        const dx = x - (bounds.minX + bounds.maxX) * .5;
        const dz = z - (bounds.minZ + bounds.maxZ) * .5;
        const det = m[0]*m[10] - m[2]*m[8];
        if (Math.abs(det) < 1e-8) return false;
        const localX = (m[10]*dx - m[8]*dz) / det;
        const localZ = (m[0]*dz - m[2]*dx) / det;
        supportedY = m[1]*(centerX + localX) + m[5]*box.max.y + m[9]*(centerZ + localZ) + m[13];
        return radius != null ? localX*localX + localZ*localZ <= radius*radius
          : Math.abs(localX) <= halfX && Math.abs(localZ) <= halfZ;
      },
      topY: () => supportedY,
    };
  }
  const registerBlocker = definition => register('blocker', blockers, definition);
  const registerPit = definition => register('pit', pits, definition);

  function remove(id) {
    unindexPlate(surfaces.get(id));
    return surfaces.delete(id) || blockers.delete(id) || pits.delete(id);
  }

  function clearScope(scope) {
    for (const store of [surfaces, blockers, pits]) {
      for (const [id, record] of store) if (record.scope === scope) {
        if (store === surfaces) unindexPlate(record);
        store.delete(id);
      }
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

  function sampleFrom(records, x, z, options) {
    const minY = number(options.minY, -Infinity);
    const maxY = number(options.maxY, Infinity);
    const pad = number(options.pad, 0);
    const scope = options.scope == null ? null : String(options.scope); // Optional exact scope filter used by pre-entry generated-map audits.
    let best = null;
    const area = options.area ?? (scope == null ? window.GridTileAccessors?.getCurrentArea?.() : null);
    for (const record of records) {
      if (scope != null && String(record.scope ?? '') !== scope) continue;
      if (record.plateArea && area && record.plateArea !== area) continue;
      if (!recordEnabled(record)) continue;
      const bounds = recordBounds(record);
      if (!contains(bounds, x, z, pad)) continue;
      if (typeof record.supports === 'function' && !record.supports(x, z, record)) continue;
      const y = record.sampleTopY ? record.sampleTopY(x, z) : surfaceTopY(record, x, z);
      if (!Number.isFinite(y) || y < minY || y > maxY) continue;
      if (!best || y > best.y || (y === best.y && number(record.priority) > number(best.record.priority))) {
        best = { id: record.id, y, bounds, record };
      }
    }
    return best;
  }

  function sampleSupport(x, z, options = {}) {
    return sampleFrom(surfaces.values(), x, z, options);
  }

  function samplePressurePlate(area, x, z, minY, maxY) {
    const records = platesByArea.get(area);
    return records ? sampleFrom(records.values(), x, z, { area, minY, maxY }) : null;
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
    const scope = options.scope == null ? null : String(options.scope); // Optional exact map/subsystem scope, matching sampleSupport's authoritative area filtering.
    for (const record of blockers.values()) {
      if (scope != null && record.scope !== scope) continue; // A cliff door in one wilderness area cannot obstruct another area's balcony.
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
    registerSurface, pressurePlateSurface, samplePressurePlate, registerBlocker, registerPit,
    remove, clearScope, sampleSupport, pointInPit, blockerAt,
    addBlockerFilter, addBeforeRenderClient, debugSnapshot,
  });

  installRendererHook();
})();
