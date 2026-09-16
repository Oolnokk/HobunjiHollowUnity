(() => {
  'use strict';
  if (window.OutdoorLivestockWelfare) return;

  // Outdoor adult livestock remain world-present, sleep in the field, and
  // accumulate visible neglect each midnight. One barn night clears the
  // production lock and starts easing their appearance back toward normal.
  const OUTDOOR_VISUAL_FULL_NIGHTS = 5; // Used to turn five outside midnights into the full visual penalty.
  const OUTDOOR_AWAKE_MIN_SCALE_Y = 0.8; // Used by live outdoor adults after the fifth neglected night.
  const OUTDOOR_MAX_LIGHTEN = 0.25; // Used by the sprite shader at maximum outdoor neglect.
  const OUTDOOR_MAX_DESATURATION = 0.5; // Used by the sprite shader at maximum outdoor neglect.
  const OUTDOOR_SLEEP_SCALE_Y = 0.5; // Used at night; mirrors FarmTroughs' existing simple livestock sleep pose.
  const VISUAL_LERP_RATE = 4; // Used by live avatars to ease between midnight visual steps instead of snapping.
  const BLOCKED_BARN_ID = ''; // Used only while the resource tick runs: falsy to core, non-null to Nursery's sentinel wrapper.

  let deps = null; // Captures FarmAnimals' existing world/save/render dependency seam.
  const statusByLivestockId = new Map(); // Read by live animal tick/update wrappers without parsing livestock saves every frame.
  let installed = false; // Prevents duplicate wrappers if the parser-time bridge runs more than once.
  let lastNightlyChanges = []; // Exposed in mobile-friendly diagnostics after each midnight livestock upkeep tick.

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

  function isAdult(entry) {
    if (!entry || entry.lifeStage === 'baby') return false;
    if (entry.lifeStage === 'adult') return true;
    // Mirrors Nursery migration semantics before its init wrapper has had a
    // chance to stamp lifeStage: explicit null housing was old stasis/baby,
    // while records with no barnId property at all were legacy roaming adults.
    return !Object.prototype.hasOwnProperty.call(entry, 'barnId') || entry.barnId != null;
  }

  function builtBarnIds() {
    const buildings = deps?.getFarmBuildings?.() || []; // Reused below to build the current set of real shelter IDs.
    return new Set(buildings.filter(entry => entry?.kind === 'barn' && entry.stage === 'built' && !entry.nursery && entry.tier !== 'nursery').map(entry => entry.id));
  }

  function isActuallyOutdoor(entry, barnIds = builtBarnIds()) {
    return isAdult(entry) && !barnIds.has(entry?.barnId);
  }

  function neglectStress(entry) {
    return clamp01((Number(entry?.outdoorNeglectNights) || 0) / OUTDOOR_VISUAL_FULL_NIGHTS);
  }

  function refreshStatuses(list = deps?.loadWorldLivestock?.() || []) {
    const barnIds = builtBarnIds(); // Reused for the whole refresh so no per-record building scans occur.
    const liveIds = new Set(); // Used to remove statuses for sold/deleted livestock records.
    for (const entry of list) {
      if (!entry?.id || !isAdult(entry)) continue;
      const outdoors = isActuallyOutdoor(entry, barnIds); // Drives field sleep and daytime neglect visuals.
      const status = {
        outdoors,
        neglectNights: Number(entry.outdoorNeglectNights) || 0,
        stress: neglectStress(entry),
        productionLocked: entry.outdoorProductionLocked === true,
      }; // Cached per animal; live wrappers only read this tiny object each frame.
      statusByLivestockId.set(entry.id, status);
      liveIds.add(entry.id);
    }
    for (const id of [...statusByLivestockId.keys()]) if (!liveIds.has(id)) statusByLivestockId.delete(id);
    return statusByLivestockId;
  }

  function materialWelfareState(material) {
    if (!material) return null;
    material.userData ||= {};
    if (material.userData.outdoorLivestockWelfare) return material.userData.outdoorLivestockWelfare;
    const state = {
      lighten: 0,
      desaturation: 0,
      shader: null,
    }; // Stores current values before and after Three compiles the material shader.
    material.userData.outdoorLivestockWelfare = state;
    const originalOnBeforeCompile = material.onBeforeCompile; // Preserves any existing material shader customization.
    const originalProgramCacheKey = typeof material.customProgramCacheKey === 'function'
      ? material.customProgramCacheKey.bind(material)
      : null; // Keeps pre-existing cache-key behavior while distinguishing the welfare shader variant.
    material.onBeforeCompile = (shader, renderer) => {
      originalOnBeforeCompile?.call(material, shader, renderer);
      shader.uniforms.outdoorLivestockLighten = { value: state.lighten };
      shader.uniforms.outdoorLivestockDesaturation = { value: state.desaturation };
      const mapChunk = '#include <map_fragment>'; // Existing Three.js map sample point where sprite RGB is available in diffuseColor.
      const welfareUniforms = 'uniform float outdoorLivestockLighten;\nuniform float outdoorLivestockDesaturation;\n'; // Declared globally so the injected map-fragment expressions compile in real GLSL.
      if (!shader.fragmentShader.includes('uniform float outdoorLivestockLighten;')) {
        const versionLine = shader.fragmentShader.match(/^\s*#version[^\n]*\n/); // Keeps a GLSL #version directive first when a future material supplies one.
        shader.fragmentShader = versionLine
          ? shader.fragmentShader.replace(versionLine[0], versionLine[0] + welfareUniforms)
          : welfareUniforms + shader.fragmentShader;
      }
      if (shader.fragmentShader.includes(mapChunk)) {
        shader.fragmentShader = shader.fragmentShader.replace(mapChunk, `${mapChunk}\n          float outdoorLivestockGray = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));\n          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(outdoorLivestockGray), outdoorLivestockDesaturation);\n          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), outdoorLivestockLighten);`);
      }
      state.shader = shader;
    };
    material.customProgramCacheKey = () => `${originalProgramCacheKey ? originalProgramCacheKey() : ''}|outdoor-livestock-welfare-v2`;
    material.needsUpdate = true;
    return state;
  }

  function installMaterialHooks(animal) {
    const group = animal?.avatarRef?.group; // Source hierarchy scanned once when this live animal is first patched.
    if (!group?.traverse) return [];
    const materials = []; // Cached on the animal so per-frame color easing never traverses the avatar hierarchy.
    const seen = new Set(); // Prevents duplicate writes if multiple meshes share one material.
    group.traverse(child => {
      const childMaterials = child?.material ? (Array.isArray(child.material) ? child.material : [child.material]) : []; // Material list from this one traversed node.
      for (const material of childMaterials) {
        if (!material || seen.has(material)) continue;
        seen.add(material);
        materialWelfareState(material);
        materials.push(material);
      }
    });
    animal._outdoorWelfareMaterials = materials;
    return materials;
  }

  function setMaterialWelfare(animal, lighten, desaturation) {
    if (!animal) return;
    if (Math.abs((Number(animal._outdoorLastLighten) || 0) - lighten) < 0.00001
      && Math.abs((Number(animal._outdoorLastDesaturation) || 0) - desaturation) < 0.00001
      && animal._outdoorWelfareMaterials) return;
    const materials = animal._outdoorWelfareMaterials || installMaterialHooks(animal); // Reuses the two plane materials instead of traversing every frame.
    animal._outdoorLastLighten = lighten;
    animal._outdoorLastDesaturation = desaturation;
    for (const material of materials) {
      const state = materialWelfareState(material); // State owns the live uniforms after Three compiles this material.
      if (!state) continue;
      state.lighten = lighten;
      state.desaturation = desaturation;
      if (state.shader) {
        state.shader.uniforms.outdoorLivestockLighten.value = lighten;
        state.shader.uniforms.outdoorLivestockDesaturation.value = desaturation;
      }
    }
  }

  function nightNow() {
    return !!window.Music?.isNightTime?.();
  }

  function patchLiveAnimal(animal) {
    if (!animal || animal.__outdoorLivestockWelfarePatched) return animal;
    animal.__outdoorLivestockWelfarePatched = true;
    animal._outdoorVisualStress = 0; // Smoothed neglect amount used by update() for size/color interpolation.
    animal._outdoorSleepBlend = 0; // Smoothed field-sleep pose amount used by update().
    animal._outdoorAppliedScaleY = 1; // Tracks the post-update welfare scale so early-returning base updates cannot accumulate it frame over frame.
    installMaterialHooks(animal);

    const originalTick = typeof animal.tick === 'function' ? animal.tick : null; // Preserved so daytime/barn AI remains authoritative.
    if (originalTick) {
      animal.tick = function outdoorLivestockTick(dt) {
        const status = statusByLivestockId.get(this.livestockId); // Cached welfare state used to bypass only outdoor night wandering.
        if (status?.outdoors && nightNow()) {
          this.targetCol = this.col;
          this.targetRow = this.row;
          this.wanderTargetCol = null;
          this.wanderTargetRow = null;
          this.wanderPhase = 'pick';
          this.wanderWaitT = 0;
          return;
        }
        return originalTick.call(this, dt);
      };
    }

    const originalUpdate = typeof animal.update === 'function' ? animal.update : null; // Preserved so base movement, breathing, blinking, and billboard facing run first.
    if (originalUpdate) {
      animal.update = function outdoorLivestockUpdate(dt) {
        const group = this.avatarRef?.group; // Restored before the base update, then receives exactly one fresh welfare transform afterward.
        const previousScaleY = Number(this._outdoorAppliedScaleY) || 1; // Removes last frame's post-scale when dialogue/vat updates return before resetting the group.
        const groundLift = Number(this.groundLift ?? this.halfHeight) || 0; // Used for both removal and application of the ground-preserving Y correction.
        if (group && previousScaleY !== 1) {
          group.scale.y /= previousScaleY;
          group.position.y += groundLift * (1 - previousScaleY);
        }
        const result = originalUpdate.call(this, dt);
        const status = statusByLivestockId.get(this.livestockId); // Retains saved neglect after rehousing until the recovery-night tick clears it.
        const targetStress = Number(status?.stress) || 0; // Outdoor appearance persists through rehousing and only heals after one completed barn night.
        const targetSleep = status?.outdoors && nightNow() ? 1 : 0; // Outdoor adults stay visible but settle into the field-sleep pose at night.
        const lerp = 1 - Math.exp(-Math.max(0, Number(dt) || 0) * VISUAL_LERP_RATE); // Frame-rate-independent easing between midnight/day-night targets.
        this._outdoorVisualStress += (targetStress - this._outdoorVisualStress) * lerp;
        this._outdoorSleepBlend += (targetSleep - this._outdoorSleepBlend) * lerp;

        const awakeScaleY = 1 - (1 - OUTDOOR_AWAKE_MIN_SCALE_Y) * this._outdoorVisualStress; // Reaches 0.8 only after the full neglect ramp.
        const sleepScaleY = 1 - (1 - OUTDOOR_SLEEP_SCALE_Y) * this._outdoorSleepBlend; // Reuses the game's existing 50%-height sleep language.
        const finalScaleY = awakeScaleY * sleepScaleY; // Applied after FarmAnimals' own genetic/breathing scale so those systems stay intact.
        if (group) {
          group.scale.y *= finalScaleY;
          group.position.y -= groundLift * (1 - finalScaleY); // Same center-lowering principle used by FarmTroughs sleepers.
        }
        this._outdoorAppliedScaleY = finalScaleY;
        setMaterialWelfare(
          this,
          OUTDOOR_MAX_LIGHTEN * this._outdoorVisualStress,
          OUTDOOR_MAX_DESATURATION * this._outdoorVisualStress,
        );
        return result;
      };
    }
    return animal;
  }

  function patchAllLiveAnimals() {
    for (const animal of deps?.animalObjects || []) patchLiveAnimal(animal);
  }

  function clearArmedOutdoorDew(entry) {
    if (entry?.kind !== 'uumkaoii' || !entry.dewReady) return false;
    entry.dewReady = false;
    entry.dewDaysUntil = Number(deps?.UUMKAOII_DEW_COOLDOWN_DAYS) || Number(entry.dewDaysUntil) || 1;
    entry.dewReadyStaleDays = 0;
    return true;
  }

  function applyNightlyWelfare() {
    const list = deps?.loadWorldLivestock?.() || []; // Authoritative saved livestock array mutated and saved by this midnight transition.
    const barnIds = builtBarnIds(); // Used once to distinguish real shelter from Nursery's temporary resource/heart sentinel.
    const recovering = []; // Housed locked adults clear their lock only after the underlying nightly barn upkeep completes.
    const changes = []; // Captured for diagnostics so mobile testing does not require a console.

    for (const entry of list) {
      if (!isAdult(entry)) continue;
      if (isActuallyOutdoor(entry, barnIds)) {
        entry.outdoorNeglectNights = Math.max(0, Number(entry.outdoorNeglectNights) || 0) + 1;
        entry.outdoorProductionLocked = true;
        const dewCleared = clearArmedOutdoorDew(entry); // Prevents a pre-armed Uumkao'ii drop from firing after the first outside night.
        changes.push({ id: entry.id, name: entry.name, event: 'outdoor-night', nights: entry.outdoorNeglectNights, dewCleared });
      } else if (entry.outdoorProductionLocked === true) {
        recovering.push(entry);
      } else if ((Number(entry.outdoorNeglectNights) || 0) !== 0) {
        entry.outdoorNeglectNights = 0; // Migrates any stale visual-only state that predates the production lock.
      }
    }
    return { list, recovering, changes };
  }

  function completeBarnRecovery(recovering, changes) {
    for (const entry of recovering) {
      entry.outdoorProductionLocked = false;
      entry.outdoorNeglectNights = 0;
      changes.push({ id: entry.id, name: entry.name, event: 'barn-recovery' });
    }
  }

  function withProductionBlocks(original, context, args) {
    const list = deps?.loadWorldLivestock?.() || []; // Shared array whose temporary barn IDs are guarded from persistence below.
    const barnIds = builtBarnIds(); // Lets a private Nursery sentinel count as outdoors without duplicating its sentinel string here.
    const blocked = []; // Saves each blocked adult and its real housing ID while core production sees a falsy one.
    for (const entry of list) {
      if (!isAdult(entry)) continue;
      if (!isActuallyOutdoor(entry, barnIds) && entry.outdoorProductionLocked !== true) continue;
      blocked.push({ entry, barnId: entry.barnId });
      entry.barnId = BLOCKED_BARN_ID;
    }
    if (!blocked.length) return original.apply(context, args);

    const savedSave = deps.saveWorldLivestock; // Guarded below so the temporary falsy barn id can never enter a save blob.
    const restoreBarnIds = () => blocked.forEach(({ entry, barnId }) => { entry.barnId = barnId; }); // Restores real housing for persistence and after the tick.
    const applyBlockedIds = () => blocked.forEach(({ entry }) => { entry.barnId = BLOCKED_BARN_ID; }); // Reapplies the production gate if core saves mid-tick.
    deps.saveWorldLivestock = candidate => {
      restoreBarnIds();
      try { return savedSave?.(candidate); }
      finally { applyBlockedIds(); }
    };
    try {
      return original.apply(context, args);
    } finally {
      restoreBarnIds();
      deps.saveWorldLivestock = savedSave;
      savedSave?.(list);
      refreshStatuses(list);
      patchAllLiveAnimals();
    }
  }

  function removeDuplicateOutdoorBodies(before, livestockId) {
    const live = [...(deps?.animalObjects || [])].filter(animal => animal?.livestockId === livestockId); // Compared with the pre-assignment set to identify the old outdoor body.
    if (live.length <= 1) return;
    const spawned = live.find(animal => !before.has(animal)) || live[live.length - 1]; // Keeps the body core assignToBarn just created beside the target barn.
    for (const animal of live) {
      if (animal === spawned) continue;
      const worldKey = animal.col + ',' + animal.row; // Checked before deletion so an overlapping newly spawned body cannot lose its map entry.
      if (deps.worldObjects?.get?.(worldKey) === animal) deps.worldObjects.delete(worldKey);
      deps.animalObjects?.delete?.(animal);
      try { animal.reset?.(); } catch (_) {}
    }
  }

  function install() {
    const animals = window.FarmAnimals; // Public livestock API wrapped below before Nursery adds its own outer integration layer.
    if (installed || !animals) return installed;
    installed = true;

    const originalInit = animals.init; // Captures FarmAnimals deps before any daily/live wrapper needs them.
    animals.init = function outdoorWelfareInit(injectedDeps, ...rest) {
      deps = injectedDeps;
      const result = originalInit.call(this, injectedDeps, ...rest);
      refreshStatuses();
      patchAllLiveAnimals();
      return result;
    };

    const originalTickResources = animals.tickResources; // Production/dew advancement is blocked for outdoors and not-yet-recovered adults.
    animals.tickResources = function outdoorWelfareTickResources(...args) {
      if (!deps) return originalTickResources.apply(this, args);
      return withProductionBlocks(originalTickResources, this, args);
    };

    const originalTickHearts = animals.tickHearts; // Existing once-per-day upkeep is the authoritative midnight/slept-night clock.
    animals.tickHearts = function outdoorWelfareTickHearts(...args) {
      if (!deps) return originalTickHearts.apply(this, args);
      const { list, recovering, changes } = applyNightlyWelfare(); // State transition is computed before upkeep so outdoor adults count this night.
      const result = originalTickHearts.apply(this, args);
      completeBarnRecovery(recovering, changes);
      deps.saveWorldLivestock?.(list);
      lastNightlyChanges = changes;
      refreshStatuses(list);
      patchAllLiveAnimals();
      return result;
    };

    const originalRespawn = animals.respawnWorldLivestock; // Nursery's outdoor-adult respawn path flows through this seam too.
    animals.respawnWorldLivestock = function outdoorWelfareRespawn(...args) {
      const result = originalRespawn.apply(this, args);
      refreshStatuses();
      patchAllLiveAnimals();
      return result;
    };

    const originalAssignToBarn = animals.assignToBarn; // Rehousing can otherwise leave the old outdoor body beside the newly spawned barn body.
    animals.assignToBarn = function outdoorWelfareAssignToBarn(livestockId, barnId, ...args) {
      const before = new Set([...(deps?.animalObjects || [])].filter(animal => animal?.livestockId === livestockId)); // Used only after a successful assignment to remove the previous outdoor representation.
      const result = originalAssignToBarn.call(this, livestockId, barnId, ...args);
      if (result?.ok) removeDuplicateOutdoorBodies(before, livestockId);
      refreshStatuses();
      patchAllLiveAnimals();
      return result;
    };

    refreshStatuses();
    patchAllLiveAnimals();
    return true;
  }

  function debugSnapshot() {
    const list = deps?.loadWorldLivestock?.() || []; // Current persisted records summarized for mobile-visible diagnostics.
    const liveById = new Map(); // Lets the snapshot expose field-sleep/visual state without requiring desktop devtools.
    for (const animal of deps?.animalObjects || []) liveById.set(animal.livestockId, animal);
    refreshStatuses(list);
    return {
      mostRecentChange: 'Outdoor adults remain visible and sleep in the field; neglect visuals now use compile-safe cached sprite uniforms and remain until the recovery barn night.',
      constants: {
        fullNeglectNights: OUTDOOR_VISUAL_FULL_NIGHTS,
        awakeMinScaleY: OUTDOOR_AWAKE_MIN_SCALE_Y,
        maxLighten: OUTDOOR_MAX_LIGHTEN,
        maxDesaturation: OUTDOOR_MAX_DESATURATION,
        sleepScaleY: OUTDOOR_SLEEP_SCALE_Y,
      },
      lastNightlyChanges: [...lastNightlyChanges],
      adults: list.filter(isAdult).map(entry => {
        const status = statusByLivestockId.get(entry.id) || null; // Mirrors the exact cached state read by live wrappers.
        const live = liveById.get(entry.id); // Supplies current rendered sleep/lerp values when this adult is spawned.
        return {
          id: entry.id,
          name: entry.name,
          kind: entry.kind,
          barnId: entry.barnId ?? null,
          outdoors: status?.outdoors ?? null,
          outdoorNeglectNights: Number(entry.outdoorNeglectNights) || 0,
          productionLocked: entry.outdoorProductionLocked === true,
          live: !!live,
          sleepingOutside: !!(live && status?.outdoors && nightNow()),
          visualStress: live ? Number(live._outdoorVisualStress) || 0 : null,
          sleepBlend: live ? Number(live._outdoorSleepBlend) || 0 : null,
          cachedMaterialCount: live?._outdoorWelfareMaterials?.length ?? null,
        };
      }),
    };
  }

  window.OutdoorLivestockWelfare = {
    install,
    debugSnapshot,
    refreshStatuses,
    patchAllLiveAnimals,
    constants: {
      OUTDOOR_VISUAL_FULL_NIGHTS,
      OUTDOOR_AWAKE_MIN_SCALE_Y,
      OUTDOOR_MAX_LIGHTEN,
      OUTDOOR_MAX_DESATURATION,
      OUTDOOR_SLEEP_SCALE_Y,
    },
  };
  window.__outdoorLivestockDebug = { snapshot: debugSnapshot };

  install();
})();
