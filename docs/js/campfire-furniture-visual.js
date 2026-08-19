// Replaces CampfireSystem's temporary placeholder mesh with the normalized
// furniture database's canonical campfire and runs its authored emitters.
// Loaded before campfire-system.js so every player_campfire added to a scene is
// upgraded immediately, while CampfireSystem keeps ownership of lifecycle,
// sleep/checkpoint, light and fireplace ambience.
(() => {
  'use strict';
  if (window.CampfireFurnitureVisual) return;

  const SOURCE = 'Hobunji normalized furniture#campfire';
  const runtimes = new Set();

  function disposeObjectTree(root) {
    if (!root) return;
    root.traverse?.(object => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
      else object.material?.dispose?.();
    });
  }

  function clearPlaceholder(group) {
    const oldChildren = [...(group.children || [])];
    for (const child of oldChildren) {
      group.remove(child);
      disposeObjectTree(child);
    }
  }

  function markFurniture(group) {
    group.traverse?.(object => {
      if (!object?.isMesh) return;
      object.layers?.enable?.(1);
      object.castShadow = true;
      object.receiveShadow = true;
    });
  }

  function upgrade(group) {
    if (!group || group.name !== 'player_campfire' || group.userData?.normalizedCampfireSource === SOURCE) return false;
    const database = window.HobunjiNormalizedFurnitureDatabase;
    const authored = window.AuthoredFurnitureRuntime;
    const data = database?.get?.('campfire');
    if (!data || typeof authored?.buildGroup !== 'function' || typeof authored?.createEmitterVisual !== 'function') {
      console.warn('[campfire] normalized campfire visual unavailable; leaving placeholder mesh.', {
        database: !!database,
        authoredFurnitureRuntime: !!authored,
      });
      return false;
    }

    clearPlaceholder(group);
    const furniture = authored.buildGroup(data);
    furniture.name = 'normalized_campfire_furniture';
    furniture.position.set(0, 0, 0);
    markFurniture(furniture);
    group.add(furniture);

    const emitters = [];
    for (const emitter of data.particleEmitters || []) {
      const estimatedLive = Math.ceil((Number(emitter.rate) || 0) * (Number(emitter.lifetime) || 1) * 1.35);
      const maxParticles = Math.max(40, Math.min(180, estimatedLive));
      const runtime = authored.createEmitterVisual(furniture, emitter, maxParticles);
      if (runtime) emitters.push(runtime);
    }

    group.userData.normalizedCampfireSource = SOURCE;
    group.userData.normalizedCampfireEmitterCount = emitters.length;
    const runtimeRecord = {
      group,
      emitters,
      lastMs: performance.now(),
      disposed: false,
    };
    runtimes.add(runtimeRecord);
    return true;
  }

  function disposeRuntime(record) {
    if (!record || record.disposed) return;
    record.disposed = true;
    for (const emitter of record.emitters || []) {
      try { emitter?.dispose?.(); } catch (_) {}
    }
    record.emitters = [];
    runtimes.delete(record);
  }

  function tick(nowMs) {
    for (const record of [...runtimes]) {
      if (!record.group?.parent) {
        disposeRuntime(record);
        continue;
      }
      const dt = Math.max(0, Math.min(0.1, (nowMs - record.lastMs) / 1000 || 1 / 60));
      record.lastMs = nowMs;
      for (const emitter of record.emitters) emitter?.update?.(dt, true);
    }
    requestAnimationFrame(tick);
  }

  // CampfireSystem calls scene.add(group) after it has assembled its old
  // placeholder. Intercept that one named group and swap its contents before
  // the next frame; all other scene additions are untouched.
  const rawSceneAdd = THREE?.Scene?.prototype?.add;
  if (typeof rawSceneAdd === 'function' && !rawSceneAdd.__campfireNormalizedPatched) {
    const patched = function normalizedCampfireSceneAdd(...objects) {
      const result = rawSceneAdd.apply(this, objects);
      for (const object of objects) if (object?.name === 'player_campfire') upgrade(object);
      return result;
    };
    patched.__campfireNormalizedPatched = true;
    THREE.Scene.prototype.add = patched;
  }

  window.CampfireFurnitureVisual = Object.freeze({
    SOURCE,
    upgrade,
    snapshot: () => ({
      source: SOURCE,
      liveCampfires: runtimes.size,
      emitterCounts: [...runtimes].map(record => record.emitters.length),
    }),
  });

  requestAnimationFrame(tick);
})();
