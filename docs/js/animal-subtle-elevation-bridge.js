// Gives non-humanoid world actors the same authored terrain/support lift used
// by the player and NPCs without taking ownership of their movement Y.
(() => {
  'use strict';

  if (window.HobunjiAnimalSubtleElevation) return;

  const terrain = window.HobunjiTownSubtleElevation;
  const walkable = window.HobunjiWalkableElevation;
  if (!terrain?.sampleHeightAt || !walkable?.surfaceLiftAt) return;

  const EPSILON = 1e-8;
  const liftedRoots = []; // Reused each render so temporary animal Y offsets can be restored without per-frame pair allocations.
  const liftedBaseYs = []; // Parallel to liftedRoots; stores each root's movement-owned Y for restoration after rendering.
  const seenActors = new Set(); // Reused each render to dedupe actors exposed through overlapping runtime dependency sets.
  const seenRoots = new Set(); // Reused each render to avoid lifting an avatar/shadow root twice through aliases.

  let runtimeDeps = null; // Captured from PixelProbe.init; supplies renderer/current-area and creature registries when available.
  let combatDeps = null; // Captured from Combat.init; supplies wild creatures, companions, mounts, and creature corpses.
  let farmDeps = null; // Captured from FarmAnimals.init; supplies live livestock that do not live in Combat registries.
  let renderDepth = 0; // Prevents accidental nested renderer wrappers from stacking the same temporary lift twice.
  let lastDebug = {
    area: null,
    appliedActors: 0,
    appliedRoots: 0,
    skippedShoulderPets: 0,
    skippedBandits: 0,
    maxLift: 0,
    lastActor: null,
    lastLift: 0,
    lastTerrainLift: 0,
    lastSupportLift: 0,
    reason: 'not-rendered',
  };

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function activeArea() {
    return runtimeDeps?.getCurrentArea?.()
      || combatDeps?.getCurrentArea?.()
      || farmDeps?.getCurrentArea?.()
      || null;
  }

  function terrainLiftAt(worldX, worldZ, area = activeArea()) {
    return area === 'town' ? finite(terrain.sampleHeightAt(worldX, worldZ), 0) : 0;
  }

  function supportLiftAt(worldX, worldZ, area = activeArea()) {
    return finite(walkable.surfaceLiftAt(worldX, worldZ, area), 0);
  }

  function totalLiftAt(worldX, worldZ, area = activeArea()) {
    return terrainLiftAt(worldX, worldZ, area) + supportLiftAt(worldX, worldZ, area);
  }

  function chainFutureGlobal(name, patch) {
    if (window[name]) {
      patch(window[name]);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && typeof descriptor.set === 'function') {
      const priorGet = descriptor.get;
      const priorSet = descriptor.set;
      Object.defineProperty(window, name, {
        configurable: descriptor.configurable !== false,
        enumerable: descriptor.enumerable !== false,
        get() { return priorGet ? priorGet.call(window) : undefined; },
        set(value) {
          priorSet.call(window, value);
          patch(priorGet ? priorGet.call(window) : value);
        },
      });
      return;
    }
    if (descriptor && descriptor.configurable === false) return;
    let value;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(next) {
        value = next;
        patch(next);
      },
    });
  }

  function patchCombat(api) {
    if (!api || api.__hobunjiAnimalSubtleElevation || typeof api.init !== 'function') return;
    combatDeps = api.deps || combatDeps;
    const originalInit = api.init;
    api.init = function animalSubtleElevationCombatInit(injectedDeps) {
      combatDeps = injectedDeps || combatDeps;
      return originalInit.apply(this, arguments);
    };
    api.__hobunjiAnimalSubtleElevation = true;
  }

  function patchFarmAnimals(api) {
    if (!api || api.__hobunjiAnimalSubtleElevation || typeof api.init !== 'function') return;
    const originalInit = api.init;
    api.init = function animalSubtleElevationFarmInit(injectedDeps) {
      farmDeps = injectedDeps || farmDeps;
      return originalInit.apply(this, arguments);
    };
    api.__hobunjiAnimalSubtleElevation = true;
  }

  function actorLabel(actor) {
    return actor?.name
      || actor?.livestockId
      || actor?.id
      || actor?.creatureKey
      || actor?.animalKey
      || actor?.def?.label
      || 'animal';
  }

  function isShoulderPet(actor) {
    return actor?.stableRole === 'shoulderPet' || actor?.role === 'shoulderPet';
  }

  function actorIsActiveHere(actor, area) {
    if (!actor) return false;
    if (actor.areaId && area && actor.areaId !== area) return false;
    const group = actor.avatarRef?.group;
    if (!group?.position || group.visible === false || !group.parent) return false;
    return true;
  }

  function liftRoot(root, lift) {
    if (!root?.position || root.visible === false || seenRoots.has(root)) return false;
    const baseY = finite(root.position.y, NaN);
    if (!Number.isFinite(baseY)) return false;
    seenRoots.add(root);
    liftedRoots.push(root);
    liftedBaseYs.push(baseY);
    root.position.y = baseY + lift;
    return true;
  }

  function liftActor(actor, area, kind) {
    if (!actor || seenActors.has(actor)) return false;
    seenActors.add(actor);

    if (actor.isBandit && !actor.isAmphibiousFishCorpse) {
      // Humanoid bandits already follow the NPC/humanoid elevation path.
      // Amphibious fish corpses reuse isBandit only as a combat-state sentinel,
      // so keep those animal corpses on this render-lift path.
      lastDebug.skippedBandits++;
      return false;
    }
    if (isShoulderPet(actor)) {
      // Shoulder pets are attached to a player visual root by
      // PlayerBodyAttachmentBridge and already inherit the player's composed
      // subtle-elevation transform. Lifting them again here would double it.
      lastDebug.skippedShoulderPets++;
      return false;
    }
    if (!actorIsActiveHere(actor, area)) return false;

    const group = actor.avatarRef.group;
    const worldX = finite(group.position.x, NaN);
    const worldZ = finite(group.position.z, NaN);
    if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return false;

    const terrainLift = terrainLiftAt(worldX, worldZ, area);
    const supportLift = supportLiftAt(worldX, worldZ, area);
    const lift = terrainLift + supportLift;
    if (Math.abs(lift) <= EPSILON) return false;

    let roots = 0;
    if (liftRoot(group, lift)) roots++;
    // Creature ground shadows are scene siblings rather than avatar children;
    // move them by the same temporary lift so they remain on the raised ground.
    if (actor.groundShadow && liftRoot(actor.groundShadow, lift)) roots++;
    if (!roots) return false;

    lastDebug.appliedActors++;
    lastDebug.appliedRoots += roots;
    lastDebug.maxLift = Math.max(lastDebug.maxLift, Math.abs(lift));
    lastDebug.lastActor = actorLabel(actor);
    lastDebug.lastLift = lift;
    lastDebug.lastTerrainLift = terrainLift;
    lastDebug.lastSupportLift = supportLift;
    return true;
  }

  function eachActor(setLike, kind, area) {
    if (!setLike || typeof setLike[Symbol.iterator] !== 'function') return;
    for (const actor of setLike) liftActor(actor, area, kind);
  }

  function applyRenderLift() {
    const area = activeArea();
    liftedRoots.length = 0;
    liftedBaseYs.length = 0;
    seenActors.clear();
    seenRoots.clear();
    lastDebug = {
      area,
      appliedActors: 0,
      appliedRoots: 0,
      skippedShoulderPets: 0,
      skippedBandits: 0,
      maxLift: 0,
      lastActor: null,
      lastLift: 0,
      lastTerrainLift: 0,
      lastSupportLift: 0,
      reason: area ? 'zero-lift' : 'no-active-area',
    };
    if (!area) return;

    const hostileObjects = combatDeps?.hostileObjects || runtimeDeps?.hostileObjects;
    const companionObjects = combatDeps?.companionObjects || runtimeDeps?.companionObjects;
    const corpseObjects = combatDeps?.corpseObjects || runtimeDeps?.corpseObjects;
    const animalObjects = farmDeps?.animalObjects || runtimeDeps?.animalObjects;

    eachActor(hostileObjects, 'hostile', area);
    eachActor(companionObjects, 'companion', area);
    eachActor(corpseObjects, 'corpse', area);
    eachActor(animalObjects, 'farm', area);
    if (lastDebug.appliedActors) lastDebug.reason = 'temporary-render-lift';
  }

  function restoreRenderLift() {
    for (let index = liftedRoots.length - 1; index >= 0; index--) {
      const root = liftedRoots[index];
      if (root?.position) root.position.y = liftedBaseYs[index];
    }
    liftedRoots.length = 0;
    liftedBaseYs.length = 0;
    seenRoots.clear();
    seenActors.clear();
  }

  function patchRenderer(renderer) {
    if (!renderer || typeof renderer.render !== 'function' || renderer.__hobunjiAnimalSubtleElevationRenderHook) return;
    const baseRender = renderer.render;
    renderer.render = function animalSubtleElevationRender(...args) {
      const outermost = renderDepth++ === 0;
      if (outermost) applyRenderLift();
      try {
        return baseRender.apply(this, args);
      } finally {
        renderDepth--;
        if (outermost) restoreRenderLift();
      }
    };
    renderer.__hobunjiAnimalSubtleElevationRenderHook = true;
  }

  function patchPixelProbe(api) {
    if (!api || api.__hobunjiAnimalSubtleElevation || typeof api.init !== 'function') return;
    const originalInit = api.init;
    api.init = function animalSubtleElevationPixelProbeInit(injectedDeps) {
      runtimeDeps = injectedDeps || runtimeDeps;
      const result = originalInit.apply(this, arguments);
      patchRenderer(injectedDeps?.renderer);
      return result;
    };
    api.__hobunjiAnimalSubtleElevation = true;
  }

  function installPixelProbeHook() {
    chainFutureGlobal('PixelProbe', patchPixelProbe);
  }

  function debugSnapshot() {
    return { ...lastDebug, renderDepth };
  }

  function installMobileDebugButton() {
    if (!/[?&]walkElevDebug=1(?:&|$)/.test(location.search) || document.getElementById('animalElevationDebugButton')) return;
    const button = document.createElement('button'); // Mobile-safe diagnostics; no console/devtools required.
    button.id = 'animalElevationDebugButton';
    button.type = 'button';
    button.textContent = 'Animal Elev Debug';
    button.style.cssText = 'position:fixed;right:8px;top:126px;z-index:100000;padding:8px 10px;font:12px monospace';
    button.addEventListener('click', () => {
      const text = JSON.stringify(debugSnapshot(), null, 2);
      navigator.clipboard?.writeText(text).catch(() => {});
      alert(text);
    });
    document.body.appendChild(button);
  }

  chainFutureGlobal('Combat', patchCombat);
  chainFutureGlobal('FarmAnimals', patchFarmAnimals);
  installPixelProbeHook();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMobileDebugButton, { once: true });
  else installMobileDebugButton();

  window.HobunjiAnimalSubtleElevation = Object.freeze({
    terrainLiftAt,
    supportLiftAt,
    totalLiftAt,
    getDebug: debugSnapshot,
  });
  window.__animalSubtleElevationDebug = debugSnapshot;
})();
