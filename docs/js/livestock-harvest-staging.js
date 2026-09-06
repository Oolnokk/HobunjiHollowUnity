// Keeps farm livestock aligned with the authored two-actor harvest staging.
//
// FarmAnimals intentionally owns the actual harvest interaction and resource
// award. This bridge only coordinates the livestock participant while that
// existing interaction is active: it suppresses the ordinary nearby-player
// gaze/turn reaction, eases the animal to its stable logical tile anchor, and
// offsets the player by the same animal translation so the already-authored
// handler-to-animal spacing remains intact throughout the animation.
(() => {
  'use strict';

  if (window.LivestockHarvestStaging) return;

  const HARVEST_TRANSITION_S = 0.35; // Mirrors FarmAnimals' in/out transition so both participants reach their anchors together.
  const HARVEST_ACTIVE_DURATION_S = 2; // Mirrors FarmAnimals' authored active hold for phase-synchronous player correction.
  let farmDeps = null; // Captures FarmAnimals' injected world/player seam for staging and debug output.
  const patchedAnimals = new WeakSet(); // Prevents wrapping a livestock instance's update method more than once.
  const harvestStates = new WeakMap(); // Stores one temporary multi-avatar staging state per harvesting livestock instance.
  let activeHarvestAnimal = null; // Points at the currently staged animal for fast lookup and mobile-visible diagnostics.
  const debug = { starts: 0, completes: 0, last: null }; // Exposed through getDebug() so the behavior can be inspected without devtools.

  function finite(value, fallback = 0) {
    const number = Number(value); // Used to normalize runtime coordinates before interpolation.
    return Number.isFinite(number) ? number : fallback;
  }

  function findHarvestAnimal() {
    if (activeHarvestAnimal?._harvestFrozen) return activeHarvestAnimal;
    for (const animal of farmDeps?.animalObjects || []) {
      if (animal?._harvestFrozen) return animal;
    }
    return null;
  }

  function ensureHarvestState(animal) {
    if (!animal) return null;
    const existing = harvestStates.get(animal); // Reuses the same anchor snapshot for every frame of this harvest.
    if (existing) return existing;

    const targetCol = finite(animal.targetCol, finite(animal.col)); // Resolves the logical farm tile the animal was already walking toward.
    const targetRow = finite(animal.targetRow, finite(animal.row)); // Resolves the logical farm row the animal was already walking toward.
    const grid = farmDeps?.getGrid?.(); // Used to align the harvest anchor with the destination tile's real surface height.
    const tile = grid?.[targetRow]?.[targetCol]; // Supplies the terrain type beneath the staged livestock anchor.
    const groundLift = finite(animal.groundLift, finite(animal.halfHeight)); // Keeps the same species/genotype floor offset as ordinary movement.
    const startRotation = finite(animal.groupRot, finite(animal.avatarRef?.group?.rotation?.y)); // Locks the authored harvest frame to the animal's pre-interaction facing.
    const state = {
      animal,
      phase: 'in',
      t: 0,
      startX: finite(animal.wx),
      startY: finite(animal.wy),
      startZ: finite(animal.wz),
      targetX: targetCol + 0.5,
      targetY: tile ? finite(farmDeps?.tileSurfaceY?.(tile.type), finite(animal.wy) - groundLift) + groundLift : finite(animal.wy),
      targetZ: targetRow + 0.5,
      rotation: startRotation,
      renderX: finite(animal.wx),
      renderY: finite(animal.wy),
      renderZ: finite(animal.wz),
      deltaPxX: 0,
      deltaPxY: 0,
    }; // Drives both the livestock transform and the equal player-space correction during this harvest.

    harvestStates.set(animal, state);
    activeHarvestAnimal = animal;
    debug.starts++;
    debug.last = {
      livestockId: animal.livestockId || animal.id || null,
      animalKey: animal.animalKey || null,
      startedAt: Date.now(),
      start: { x: state.startX, y: state.startY, z: state.startZ },
      target: { x: state.targetX, y: state.targetY, z: state.targetZ },
    };
    window.__farmLog?.(`[harvest] staging ${animal.animalKey || animal.id || 'livestock'} to ${state.targetX.toFixed(3)}, ${state.targetZ.toFixed(3)} with approach reaction suppressed`, 'wildlife');
    return state;
  }

  function updateRenderPosition(state, progress) {
    const e = Math.max(0, Math.min(1, finite(progress))); // Used as the synchronized livestock in-transition lerp factor.
    state.renderX = state.startX + (state.targetX - state.startX) * e;
    state.renderY = state.startY + (state.targetY - state.startY) * e;
    state.renderZ = state.startZ + (state.targetZ - state.startZ) * e;
    const tileSize = finite(farmDeps?.TILE, 1) || 1; // Converts livestock tile-space movement into the player's pixel-space staging coordinates.
    state.deltaPxX = (state.renderX - state.startX) * tileSize;
    state.deltaPxY = (state.renderZ - state.startZ) * tileSize;
  }

  function advanceHarvestState(state, dt) {
    if (!state) return;
    const frameDt = Math.max(0, finite(dt)); // Mirrors the same dt consumed by FarmAnimals.updateHarvestInteraction.
    if (state.phase === 'in') {
      state.t = Math.min(1, state.t + frameDt / HARVEST_TRANSITION_S);
      updateRenderPosition(state, state.t);
      if (state.t >= 1) { state.phase = 'active'; state.t = 0; }
      return;
    }
    updateRenderPosition(state, 1);
    if (state.phase === 'active') {
      state.t += frameDt;
      if (state.t >= HARVEST_ACTIVE_DURATION_S) { state.phase = 'out'; state.t = 0; }
      return;
    }
    if (state.phase === 'out') {
      state.t = Math.min(1, state.t + frameDt / HARVEST_TRANSITION_S);
      if (state.t >= 1) state.phase = 'done';
    }
  }

  function playerCorrectionWeight(state) {
    if (!state || state.phase === 'done') return 0;
    return state.phase === 'out' ? Math.max(0, 1 - state.t) : 1;
  }

  function applyPlayerCorrection(state) {
    const player = farmDeps?.player; // Receives the livestock translation so the authored handler offset remains unchanged while both actors lerp.
    if (!player || !state) return;
    const weight = playerCorrectionWeight(state); // Fades the shared translation back out only while the player returns to their pre-harvest position.
    if (weight <= 0) return;
    player.x = finite(player.x) + state.deltaPxX * weight;
    player.y = finite(player.y) + state.deltaPxY * weight;
  }

  function finishHarvestState(animal) {
    const state = animal ? harvestStates.get(animal) : null; // Supplies the completed target for the debug snapshot before cleanup.
    if (!state) return;
    debug.completes++;
    debug.last = {
      ...(debug.last || {}),
      completedAt: Date.now(),
      final: { x: state.renderX, y: state.renderY, z: state.renderZ },
    };
    harvestStates.delete(animal);
    if (activeHarvestAnimal === animal) activeHarvestAnimal = null;
  }

  function patchAnimal(animal) {
    if (!animal || patchedAnimals.has(animal) || typeof animal.update !== 'function') return;
    const originalUpdate = animal.update; // Preserves blink/breath/texture maintenance while harvest staging overrides only pose-facing concerns.
    animal.update = function harvestAwareLivestockUpdate(dt) {
      if (!this._harvestFrozen) {
        if (harvestStates.has(this)) finishHarvestState(this);
        return originalUpdate.call(this, dt);
      }

      const state = ensureHarvestState(this); // Owns the stable multi-avatar anchor for the full harvest interaction.
      if (!state) return originalUpdate.call(this, dt);
      const originalFaceTarget = farmDeps?.getPlayerFaceTarget; // Temporarily disabled so the player's scripted approach cannot trigger normal livestock gaze/turn behavior.
      let faceTargetOverridden = false; // Tracks whether the dependency was writable so it can be restored safely in finally.
      try {
        if (farmDeps && typeof originalFaceTarget === 'function') {
          try {
            farmDeps.getPlayerFaceTarget = () => null;
            faceTargetOverridden = farmDeps.getPlayerFaceTarget !== originalFaceTarget;
          } catch (_) { /* A read-only dependency seam degrades to the original update instead of breaking the interaction. */ }
        }
        originalUpdate.call(this, dt);
      } finally {
        if (faceTargetOverridden) farmDeps.getPlayerFaceTarget = originalFaceTarget;
      }

      this.wx = state.renderX;
      this.wy = state.renderY;
      this.wz = state.renderZ;
      this.groupRot = state.rotation;
      if (this.avatarRef?.group) {
        this.avatarRef.group.position.set(this.wx, this.wy, this.wz);
        this.avatarRef.group.rotation.y = this.groupRot;
      }
    };
    patchedAnimals.add(animal);
  }

  function patchAnimalCollection(deps) {
    const animals = deps?.animalObjects; // Receives wrappers for both livestock already present and every later spawn.
    if (!animals || animals.__hobunjiHarvestStagingPatched) return;
    for (const animal of animals) patchAnimal(animal);
    const originalAdd = animals.add; // Ensures newly spawned/reloaded livestock gets the same harvest-aware update wrapper.
    if (typeof originalAdd === 'function') {
      animals.add = function harvestAwareAnimalAdd(animal) {
        patchAnimal(animal);
        return originalAdd.call(this, animal);
      };
    }
    Object.defineProperty(animals, '__hobunjiHarvestStagingPatched', { value: true, configurable: true });
  }

  function patchFarmAnimals(api) {
    if (!api?.init || api.__hobunjiHarvestStagingPatched) return;
    const originalInit = api.init.bind(api); // Captures FarmAnimals' injected dependencies before forwarding to its own initializer.
    api.init = function harvestStagingFarmAnimalsInit(injectedDeps) {
      farmDeps = injectedDeps;
      patchAnimalCollection(injectedDeps);
      return originalInit(injectedDeps);
    };

    if (typeof api.updateHarvestInteraction === 'function') {
      const originalUpdateHarvestInteraction = api.updateHarvestInteraction.bind(api); // Retains FarmAnimals as the authority for phases, resource award, camera, and player facing.
      api.updateHarvestInteraction = function stagedHarvestInteractionUpdate(dt) {
        const animal = findHarvestAnimal(); // Identifies the single livestock participant frozen by FarmAnimals for this interaction.
        const state = animal ? ensureHarvestState(animal) : null; // Supplies the synchronized animal transform and player correction for this frame.
        if (state) advanceHarvestState(state, dt);
        const result = originalUpdateHarvestInteraction(dt); // Runs the canonical interaction first; correction below only translates its authored arrangement.
        if (state) {
          applyPlayerCorrection(state);
          if (!api.isHarvesting?.() || !animal?._harvestFrozen) finishHarvestState(animal);
        }
        return result;
      };
    }

    api.__hobunjiHarvestStagingPatched = true;
  }

  function chainFutureGlobal(name, afterSet) {
    if (window[name]) { afterSet(window[name]); return; }
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Preserves any earlier late-binding bridge installed for the same global.
    if (descriptor && typeof descriptor.set === 'function') {
      const previousSet = descriptor.set; // Chains our patch after the existing global-assignment observer.
      Object.defineProperty(window, name, {
        configurable: descriptor.configurable !== false,
        enumerable: descriptor.enumerable !== false,
        get: descriptor.get,
        set(value) {
          previousSet.call(window, value);
          afterSet(value);
        },
      });
      return;
    }
    if (descriptor && !descriptor.configurable) return;
    let value; // Holds FarmAnimals until its normal script assigns the real API object.
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(next) {
        value = next;
        afterSet(next);
      },
    });
  }

  function getDebug() {
    const animal = activeHarvestAnimal; // Selects the active participant for an inspectable no-devtools snapshot.
    const state = animal ? harvestStates.get(animal) : null; // Supplies current phase/anchor data without exposing mutable internal state.
    return {
      starts: debug.starts,
      completes: debug.completes,
      last: debug.last ? { ...debug.last } : null,
      active: state ? {
        livestockId: animal.livestockId || animal.id || null,
        animalKey: animal.animalKey || null,
        phase: state.phase,
        t: state.t,
        start: { x: state.startX, y: state.startY, z: state.startZ },
        target: { x: state.targetX, y: state.targetY, z: state.targetZ },
        current: { x: state.renderX, y: state.renderY, z: state.renderZ },
        playerCorrectionPx: { x: state.deltaPxX, y: state.deltaPxY },
        playerApproachSuppressed: true,
      } : null,
    };
  }

  chainFutureGlobal('FarmAnimals', patchFarmAnimals);
  window.LivestockHarvestStaging = Object.freeze({ getDebug });
})();
