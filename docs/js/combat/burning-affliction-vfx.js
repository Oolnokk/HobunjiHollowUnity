(() => {
  'use strict';

  if (window.BurningAfflictionVfx?.installed) return;

  const SCHEDULER_ID = 'burning-affliction-vfx'; // Stable RuntimeFrameScheduler owner for the shared Burning Health particle update.
  const DETACHED_GRACE_MS = 1200; // Lets normal scene reparenting complete without destroying and recreating an active flame.
  const records = new Set(); // Live entity/emitter records updated by the single shared scheduler callback.
  const recordByEntity = new WeakMap(); // O(1) lookup used by game.js's player/creature visual sync calls.
  const pendingGroupByEntity = new WeakMap(); // Prevents one Promise callback allocation per render frame while campfire data is still loading.
  let fireTemplate = null; // Cached authored campfire fire-emitter definition reused for every Burning Health target.
  let fireTemplatePromise = null; // Deduplicates the one asynchronous authored campfire load.
  let lastEvent = null; // Mobile-readable diagnostic surfaced through Pixel Probe.

  function resourceAmount(entity) {
    return Math.max(0, Number(window.ResourceSystem?.getAffliction?.(entity, 'burningHealth')) || 0);
  }

  function entityLabel(entity) {
    return entity?.id || entity?.name || entity?.creatureKey || (entity === window.Combat?.deps?.player ? 'player' : 'entity');
  }

  function cloneEmitter(source) {
    if (!source) return null;
    const emitter = JSON.parse(JSON.stringify(source)); // Keeps each target's override-safe emitter independent from cached furniture data.
    delete emitter.attachedPartId; // Character roots do not contain the campfire's authored ash mesh.
    emitter.id = 'burning_health_fire';
    emitter.name = 'Burning Health Flames';
    emitter.position = { x: 0, y: Number(source.position?.y) || 0.17, z: 0 }; // Reuses the furniture flame's local rise while centering it on the afflicted avatar.
    return emitter;
  }

  function selectFireEmitter(data) {
    return Array.isArray(data?.particleEmitters)
      ? data.particleEmitters.find(emitter => emitter?.enabled !== false && String(emitter?.type || '').toLowerCase() === 'fire') || null
      : null;
  }

  function ensureFireTemplate() {
    if (fireTemplate) return Promise.resolve(fireTemplate);
    const authored = window.AuthoredFurniture;
    const cached = selectFireEmitter(authored?.peek?.('campfire'));
    if (cached) {
      fireTemplate = cloneEmitter(cached);
      return Promise.resolve(fireTemplate);
    }
    if (!fireTemplatePromise && authored?.load) {
      fireTemplatePromise = Promise.resolve(authored.load('campfire'))
        .then(data => {
          fireTemplate = cloneEmitter(selectFireEmitter(data));
          return fireTemplate;
        })
        .catch(error => {
          lastEvent = { at: Date.now(), phase: 'load-error', error: String(error?.message || error || 'campfire emitter load failed') };
          return null;
        });
    }
    return fireTemplatePromise || Promise.resolve(null);
  }

  function disposeRecord(record, phase = 'removed') {
    if (!record) return;
    record.visual?.dispose?.();
    records.delete(record);
    if (record.entity) recordByEntity.delete(record.entity);
    if (record.group?.userData) record.group.userData.hobunjiBurningHealthVfx = false;
    lastEvent = { at: Date.now(), phase, entity: entityLabel(record.entity), active: records.size };
    if (!records.size) window.RuntimeFrameScheduler?.setEnabled?.(SCHEDULER_ID, false);
  }

  function createRecord(entity, group) {
    if (!entity || !group || !fireTemplate || !window.AuthoredFurniture?.createEmitterVisual) return null;
    group.userData = group.userData || {};
    const emitter = cloneEmitter(fireTemplate); // Each visual gets a fresh mutable emitter record for AuthoredFurniture.createEmitterVisual.
    const visual = window.AuthoredFurniture.createEmitterVisual(group, emitter, 40);
    if (!visual) return null;
    const record = { entity, group, visual, emitter, detachedAt: 0 }; // Tracks one affliction presentation until extinguished/despawned.
    records.add(record);
    recordByEntity.set(entity, record);
    group.userData.hobunjiBurningHealthVfx = true;
    lastEvent = { at: Date.now(), phase: 'attached', entity: entityLabel(entity), active: records.size };
    window.RuntimeFrameScheduler?.setEnabled?.(SCHEDULER_ID, true);
    return record;
  }

  function syncEntity(entity, group) {
    if (!entity || !group) return false;
    const burning = resourceAmount(entity);
    let record = recordByEntity.get(entity) || null;
    if (!(burning > 0)) {
      pendingGroupByEntity.delete(entity);
      if (record) disposeRecord(record, 'extinguished');
      return false;
    }
    if (record && record.group !== group) {
      disposeRecord(record, 'reparented');
      record = null;
    }
    if (record) {
      record.detachedAt = 0;
      return true;
    }
    if (fireTemplate) return !!createRecord(entity, group);
    if (pendingGroupByEntity.get(entity) !== group) {
      pendingGroupByEntity.set(entity, group);
      ensureFireTemplate().then(template => {
        if (pendingGroupByEntity.get(entity) !== group) return;
        pendingGroupByEntity.delete(entity);
        if (!template || !(resourceAmount(entity) > 0) || recordByEntity.has(entity)) return;
        createRecord(entity, group);
      });
    }
    return false;
  }

  function disposeEntity(entity) {
    if (entity) pendingGroupByEntity.delete(entity);
    const record = entity ? recordByEntity.get(entity) : null;
    if (record) disposeRecord(record, 'disposed');
  }

  function tick({ timestamp, deltaMs }) {
    const now = Number(timestamp) || performance.now();
    const step = Math.min(0.05, Math.max(0, (Number(deltaMs) || 16.667) / 1000)); // Caps particle catch-up after stalls while preserving scheduler cadence.
    for (const record of [...records]) {
      if (!(resourceAmount(record.entity) > 0)) {
        disposeRecord(record, 'extinguished');
        continue;
      }
      if (!record.group?.parent) {
        if (!record.detachedAt) record.detachedAt = now;
        if (now - record.detachedAt >= DETACHED_GRACE_MS) disposeRecord(record, 'detached');
        continue;
      }
      record.detachedAt = 0;
      record.visual?.update?.(step, true); // Presentation only; Burning Health damage remains exclusively in ResourceSystem.
    }
  }

  function debugSnapshot() {
    return {
      installed: true,
      templateReady: !!fireTemplate,
      loading: !!fireTemplatePromise && !fireTemplate,
      activeEntities: records.size,
      lastEvent: lastEvent ? { ...lastEvent } : null,
    };
  }

  if (window.RuntimeFrameScheduler?.register) {
    window.RuntimeFrameScheduler.register(SCHEDULER_ID, tick, {
      phase: 'post-game',
      owner: 'BurningAfflictionVfx',
      description: 'Updates one authored furniture fire emitter on each entity with Burning Health.',
      enabled: false,
    });
  }

  ensureFireTemplate();
  window.BurningAfflictionVfx = Object.freeze({
    installed: true,
    syncEntity,
    disposeEntity,
    debugSnapshot,
  });
})();
