// Gives non-humanoid world actors the same authored terrain/support lift used
// by the player and NPCs without taking ownership of their movement Y. It also
// owns the render-only water-depth correction shared by humanoid and creature
// rigs, plus the prone-in-water resource hazard.
(() => {
  'use strict';

  if (window.HobunjiAnimalSubtleElevation) return;

  const terrain = window.HobunjiTownSubtleElevation;
  const walkable = window.HobunjiWalkableElevation;
  if (!terrain?.sampleHeightAt || !walkable?.surfaceLiftAt) return;

  const EPSILON = 1e-8;
  const WATER_WORLD_Y_PER_DEPTH = 0.5 / 3.0; // Used by waterSurfaceYAtRaw; mirrors game.js SLAB_H / MAX_WATER.
  const PRONE_WATER_HEALTH_FRACTION_PER_SECOND = 0.035; // Used by applyProneWaterHazard to drain Health while a prone actor is in a river/stream.
  const PRONE_WATER_WINDED_FRACTION_PER_SECOND = 0.08; // Used by applyProneWaterHazard to build Winded Stamina while a prone actor is in a river/stream.
  const NON_RIG_NAME = /(ground[_ -]?shadow|shadow|resource[_ -]?ring|reticle|popup|debug|hitbox|target[_ -]?ring|torch)/i; // Used by rigCentroidWorldY to keep helpers out of the body centroid.
  const liftedRoots = []; // Reused each render so temporary animal/water Y offsets can be restored without per-frame pair allocations.
  const liftedBaseYs = []; // Parallel to liftedRoots; stores each root's movement-owned Y for restoration after rendering.
  const seenActors = new Set(); // Reused each render to dedupe actors exposed through overlapping runtime dependency sets.
  const seenRoots = new Set(); // Reused each render to avoid recording an avatar/shadow root twice through aliases.
  const waterSeenRoots = new Set(); // Reused each render so actor registries + scene discovery cannot sink the same character twice.

  let runtimeDeps = null; // Captured from PixelProbe.init; supplies renderer/current-area and creature registries when available.
  let combatDeps = null; // Captured from Combat.init; supplies player, wild creatures, companions, mounts, and creature corpses.
  let farmDeps = null; // Captured from FarmAnimals.init; supplies live livestock that do not live in Combat registries.
  let renderDepth = 0; // Prevents accidental nested renderer wrappers from stacking the same temporary lift twice.
  let rigBox = null; // Lazily allocated THREE.Box3 used by rigCentroidWorldY without per-frame object churn.
  let meshBox = null; // Lazily allocated THREE.Box3 used to accumulate one visible rig mesh at a time.
  let portraitCenter = null; // Lazily allocated THREE.Vector3 used by the portrait-root centroid fallback.
  let hazardTicks = 0; // Cumulative mobile-debug counter for successful prone-water hazard ticks.
  let lastHazardActor = null; // Mobile-debug label for the most recent prone actor harmed by water.
  let lastHazardDamage = 0; // Mobile-debug amount of Health damage requested by the most recent hazard tick.
  let lastHazardWinded = 0; // Mobile-debug amount of Winded Stamina requested by the most recent hazard tick.
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
    waterActors: 0,
    maxWaterSink: 0,
    lastWaterActor: null,
    lastWaterSurfaceY: null,
    lastRigCentroidY: null,
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
      || 'actor';
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

  function offsetRoot(root, deltaY) {
    if (!root?.position || root.visible === false || !(Math.abs(deltaY) > EPSILON)) return false;
    const baseY = finite(root.position.y, NaN);
    if (!Number.isFinite(baseY)) return false;
    if (!seenRoots.has(root)) {
      seenRoots.add(root);
      liftedRoots.push(root);
      liftedBaseYs.push(baseY);
    }
    root.position.y += deltaY;
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
    if (offsetRoot(group, lift)) roots++;
    // Creature ground shadows are scene siblings rather than avatar children;
    // move them by the same temporary lift so they remain on the raised ground.
    if (actor.groundShadow && offsetRoot(actor.groundShadow, lift)) roots++;
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

  function tileSize() {
    return Math.max(0, finite(combatDeps?.TILE, 0));
  }

  function activeWaterTileAtRaw(rawX, rawY) {
    const tile = tileSize();
    if (!(tile > 0) || !Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;
    const col = Math.floor(rawX / tile);
    const row = Math.floor(rawY / tile);
    const candidate = window.GridTileAccessors?.getActiveTileAt?.(col, row)
      || window.GridTileAccessors?.getActiveGrid?.()?.[row]?.[col]
      || null;
    return candidate && (candidate.type === 'river' || candidate.type === 'stream') ? candidate : null;
  }

  function waterSurfaceYAtRaw(rawX, rawY) {
    const tile = activeWaterTileAtRaw(rawX, rawY);
    if (!tile) return null;
    const groundY = finite(combatDeps?.worldSurfaceY?.(rawX, rawY), NaN);
    if (!Number.isFinite(groundY)) return null;
    return groundY + Math.max(0, finite(tile.water, 0)) * WATER_WORLD_Y_PER_DEPTH;
  }

  function shouldExcludeRigBranch(object) {
    return NON_RIG_NAME.test(String(object?.name || ''));
  }

  function rigCentroidWorldY(root) {
    if (!root?.position) return NaN;
    const THREE_NS = window.THREE || globalThis.THREE;
    if (THREE_NS?.Box3 && THREE_NS?.Vector3 && root.updateMatrixWorld) {
      rigBox ||= new THREE_NS.Box3();
      meshBox ||= new THREE_NS.Box3();
      rigBox.makeEmpty();
      root.updateMatrixWorld(true);

      const visit = (object, excluded) => {
        if (!object || object.visible === false) return;
        const blocked = excluded || shouldExcludeRigBranch(object);
        if (!blocked && object.isMesh && object.geometry) {
          const geometry = object.geometry; // Bounding box is reused so each rig mesh contributes once without recursively rescanning its children.
          if (!geometry.boundingBox && typeof geometry.computeBoundingBox === 'function') geometry.computeBoundingBox();
          if (geometry.boundingBox && object.matrixWorld) {
            meshBox.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld);
            if (!meshBox.isEmpty()) rigBox.union(meshBox);
          }
        }
        for (const child of (object.children || [])) visit(child, blocked);
      };
      visit(root, false);
      if (!rigBox.isEmpty()) return (rigBox.min.y + rigBox.max.y) * 0.5;
    }

    // Fallback for stripped test harnesses or an avatar still building: use
    // the portrait-tagged child center before falling back to the root itself.
    let portrait = null;
    root.traverse?.(child => {
      if (!portrait && Number.isFinite(child?.userData?.portraitModelHeight)) portrait = child;
    });
    if (portrait?.getWorldPosition) {
      const THREE_NS = window.THREE || globalThis.THREE;
      if (THREE_NS?.Vector3) {
        portraitCenter ||= new THREE_NS.Vector3();
        portrait.getWorldPosition(portraitCenter);
        return portraitCenter.y;
      }
    }
    return finite(root.position.y, NaN);
  }

  function applyWaterCentroidSink(root, rawX, rawY, label) {
    if (!root?.position || root.visible === false || waterSeenRoots.has(root)) return false;
    const waterSurfaceY = waterSurfaceYAtRaw(rawX, rawY);
    if (!Number.isFinite(waterSurfaceY)) return false;
    const centroidY = rigCentroidWorldY(root);
    if (!Number.isFinite(centroidY)) return false;
    waterSeenRoots.add(root);

    // A swimmer must be at least half-submerged: if its total visible rig
    // centroid sits above the surface, sink only the rendered root until the
    // surface reaches that centroid. Deeper rigs are left untouched.
    const sink = waterSurfaceY - centroidY;
    if (!(sink < -EPSILON) || !offsetRoot(root, sink)) return false;
    lastDebug.waterActors++;
    lastDebug.maxWaterSink = Math.max(lastDebug.maxWaterSink, Math.abs(sink));
    lastDebug.lastWaterActor = label || root.name || 'character';
    lastDebug.lastWaterSurfaceY = waterSurfaceY;
    lastDebug.lastRigCentroidY = centroidY;
    return true;
  }

  function actorRawPosition(actor) {
    const x = finite(actor?.x, NaN);
    const y = finite(actor?.y, NaN);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function applyActorWaterSink(actor, area) {
    if (!actor || (actor.areaId && area && actor.areaId !== area) || actor.def?.canSwim || isShoulderPet(actor)) return false;
    const root = actor.avatarRef?.group;
    const raw = actorRawPosition(actor);
    if (!root || !raw) return false;
    return applyWaterCentroidSink(root, raw.x, raw.y, actorLabel(actor));
  }

  function eachActorWaterSink(setLike, area) {
    if (!setLike || typeof setLike[Symbol.iterator] !== 'function') return;
    for (const actor of setLike) applyActorWaterSink(actor, area);
  }

  function applyPlayerWaterSink(area) {
    const player = combatDeps?.player;
    const raw = actorRawPosition(player);
    if (!raw) return false;
    const root = window.PlayerBodyTransformComposer?.getPlayerMesh?.()
      || window.PlayerSocialPoses?.getPlayerMesh?.()
      || null;
    if (!root) return false;
    return applyWaterCentroidSink(root, raw.x, raw.y, 'player');
  }

  function applyNpcWalkerWaterSinks(renderScene) {
    const tile = tileSize();
    if (!(tile > 0) || !renderScene?.traverse) return;
    renderScene.traverse(object => {
      if (!object?.name?.startsWith?.('npc_walker_') || waterSeenRoots.has(object)) return;
      const rawX = finite(object.position?.x, NaN) * tile;
      const rawY = finite(object.position?.z, NaN) * tile;
      if (Number.isFinite(rawX) && Number.isFinite(rawY)) applyWaterCentroidSink(object, rawX, rawY, object.name);
    });
  }

  function applyRenderLift(renderScene) {
    const area = activeArea();
    liftedRoots.length = 0;
    liftedBaseYs.length = 0;
    seenActors.clear();
    seenRoots.clear();
    waterSeenRoots.clear();
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
      waterActors: 0,
      maxWaterSink: 0,
      lastWaterActor: null,
      lastWaterSurfaceY: null,
      lastRigCentroidY: null,
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

    // Water depth is a render-only correction, just like subtle elevation:
    // movement/pathing keep their existing Y authority while every visible
    // swimming rig is guaranteed to meet the same centroid rule.
    applyPlayerWaterSink(area);
    eachActorWaterSink(hostileObjects, area);
    eachActorWaterSink(companionObjects, area);
    applyNpcWalkerWaterSinks(renderScene);

    if (lastDebug.appliedActors || lastDebug.waterActors) lastDebug.reason = 'temporary-render-lift';
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
    waterSeenRoots.clear();
  }

  function applyProneWaterHazard(entity, dt, resourceSystem) {
    if (!entity?.prone || entity.health <= 0) return;
    const area = activeArea();
    if (entity.areaId && area && entity.areaId !== area) return;
    const raw = actorRawPosition(entity);
    if (!raw || !activeWaterTileAtRaw(raw.x, raw.y)) return;
    const seconds = Math.max(0, finite(dt, 0));
    if (!(seconds > 0)) return;

    const healthDamage = Math.max(0, finite(entity.maxHealth, 0) * PRONE_WATER_HEALTH_FRACTION_PER_SECOND * seconds);
    const winded = Math.max(0, finite(entity.maxStamina, 0) * PRONE_WATER_WINDED_FRACTION_PER_SECOND * seconds);
    if (healthDamage > 0) resourceSystem.applyDamage?.(entity, healthDamage, { reason: 'prone in water', environmental: true });
    if (winded > 0) resourceSystem.addAffliction?.(entity, 'windedStamina', winded);
    resourceSystem.enforceCaps?.(entity);

    hazardTicks++;
    lastHazardActor = entity === combatDeps?.player ? 'player' : actorLabel(entity);
    lastHazardDamage = healthDamage;
    lastHazardWinded = winded;
  }

  function patchResourceSystem(api) {
    if (!api || api.__hobunjiProneWaterHazard || typeof api.tick !== 'function') return;
    const originalTick = api.tick;
    api.tick = function proneWaterAwareTick(entity, dt, options) {
      const result = originalTick.apply(this, arguments);
      applyProneWaterHazard(entity, dt, api);
      return result;
    };
    api.__hobunjiProneWaterHazard = true;
  }

  function patchRenderer(renderer) {
    if (!renderer || typeof renderer.render !== 'function' || renderer.__hobunjiAnimalSubtleElevationRenderHook) return;
    const baseRender = renderer.render;
    renderer.render = function animalSubtleElevationRender(...args) {
      const outermost = renderDepth++ === 0;
      if (outermost) applyRenderLift(args[0]);
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
    return {
      ...lastDebug,
      renderDepth,
      proneWaterHazard: {
        ticks: hazardTicks,
        lastActor: lastHazardActor,
        lastDamage: lastHazardDamage,
        lastWinded: lastHazardWinded,
        healthFractionPerSecond: PRONE_WATER_HEALTH_FRACTION_PER_SECOND,
        windedFractionPerSecond: PRONE_WATER_WINDED_FRACTION_PER_SECOND,
      },
    };
  }

  function installMobileDebugButton() {
    if (!/[?&]walkElevDebug=1(?:&|$)/.test(location.search) || document.getElementById('animalElevationDebugButton')) return;
    const button = document.createElement('button'); // Mobile-safe diagnostics; no console/devtools required.
    button.id = 'animalElevationDebugButton';
    button.type = 'button';
    button.textContent = 'Surface Debug';
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
  chainFutureGlobal('ResourceSystem', patchResourceSystem);
  installPixelProbeHook();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMobileDebugButton, { once: true });
  else installMobileDebugButton();

  window.HobunjiAnimalSubtleElevation = Object.freeze({
    terrainLiftAt,
    supportLiftAt,
    totalLiftAt,
    waterSurfaceYAtRaw,
    rigCentroidWorldY,
    isInSwimWater(entity) {
      const raw = actorRawPosition(entity);
      return !!raw && !!activeWaterTileAtRaw(raw.x, raw.y);
    },
    getDebug: debugSnapshot,
  });
  window.__animalSubtleElevationDebug = debugSnapshot;
})();
