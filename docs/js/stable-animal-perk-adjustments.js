(() => {
  'use strict';

  const progression = window.StableAnimalProgression;
  if (!progression || window.StableAnimalPerkAdjustments?.installed) return;

  const PET_GREETING_RAPPORT = 10; // Used when an NPC successfully greets a rapport-trained companion or perched shoulder pet; active rapport multipliers apply through NpcRapport.adjust.
  const MOUNT_SPEED_PER_RANK = 0.04;
  const MOUNT_ACCEL_PER_RANK = 0.10;
  const MOUNT_MANEUVER_PER_RANK = 0.08;
  const MOUNT_CLIMB_PER_RANK = 0.10;

  let mountDeps = null; // Captured from Mounts.init; temporarily scales only the existing riding inputs during mounted movement.
  let greetedDay = null;
  const greetedToday = new Set(); // Keys NPC + individual animal so each NPC can reward each greeted rapport-trained pet once per game day.
  const genotypeComposeInflight = new Map(); // Shares only currently-running genotype canvas builds so per-frame companion retries cannot multiply the same allocation-heavy work.
  let genotypeComposeRequests = 0; // Mobile-readable count of genotype compose requests routed through the guard.
  let genotypeComposeDedupHits = 0; // Mobile-readable count of simultaneous duplicate requests that reused an existing in-flight promise.

  function replaceTree(role, definitions) {
    const tree = progression.trees?.[role];
    if (!Array.isArray(tree)) return;
    tree.splice(0, tree.length, ...definitions);
  }

  // Remove every XP multiplier perk. normalizeEntry() uses these same arrays as
  // its allow-list, so old Field/Road/Perch Lessons ranks are deleted and their
  // spent training points are automatically refunded on the next normalization.
  replaceTree('companion', [
    { id: 'rapportBond', name: 'Trusted Company', maxRank: 5, desc: '+6% positive NPC rapport per rank while this companion is out with you.' },
    { id: 'keenSenses', name: 'Keen Senses', maxRank: 5, desc: '+10% camp/den discovery range per rank. Companion-only.' },
  ]);
  replaceTree('mount', [
    { id: 'mountSpeed', name: 'Fleet Stride', maxRank: 5, desc: '+4% base riding speed per rank.' },
    { id: 'mountAcceleration', name: 'Quick Start', maxRank: 5, desc: '+10% riding acceleration per rank.' },
    { id: 'mountManeuverability', name: 'Sure Turning', maxRank: 5, desc: '+8% mounted turning rate per rank.' },
    { id: 'mountCliffClimb', name: 'Cliff Runner', maxRank: 5, desc: '+10% mounted cliff-climb speed per rank.' },
  ]);
  replaceTree('shoulderPet', [
    { id: 'rapportBond', name: 'Social Perch', maxRank: 5, desc: '+4% positive NPC rapport per rank while this pet is perched.' },
    { id: 'heavyWindupAlert', name: 'Heavy Warning', maxRank: 1, desc: 'Warns when a nearby enemy is winding up a heavy attack. Red aura.' },
    { id: 'quickOpportunityAlert', name: 'Opening Call', maxRank: 1, desc: 'Warns when a nearby melee enemy fulfills your equipped Quick Attack bonus. Green aura.' },
    { id: 'rangedFocusAlert', name: 'Marksman Warning', maxRank: 1, desc: 'Warns when a nearby enemy is focusing you with a ranged weapon. Blue aura.' },
  ]);

  function activeMountEntry() {
    return progression.activeEntryForRole?.('mount') || null;
  }

  function mountRidingModifiers(entry = activeMountEntry()) {
    return {
      baseSpeed: 1 + progression.perkRank(entry, 'mountSpeed') * MOUNT_SPEED_PER_RANK,
      acceleration: 1 + progression.perkRank(entry, 'mountAcceleration') * MOUNT_ACCEL_PER_RANK,
      maneuverability: 1 + progression.perkRank(entry, 'mountManeuverability') * MOUNT_MANEUVER_PER_RANK,
      cliffClimbSpeed: 1 + progression.perkRank(entry, 'mountCliffClimb') * MOUNT_CLIMB_PER_RANK,
    };
  }

  progression.mountRidingModifiers = mountRidingModifiers;

  function patchCreatureGeneticsRender(api) {
    if (!api || api.__stableAnimalComposeDedupeWrapped || typeof api.composeFrame !== 'function' || typeof api.genotypeSignature !== 'function') return api;
    const originalComposeFrame = api.composeFrame.bind(api); // Preserves the compositor as the single authority for actual canvas generation.
    api.composeFrame = function stableAnimalComposeFrame(kind, frame, genotype, blinkShut = false) {
      if (!genotype) return originalComposeFrame(kind, frame, genotype, blinkShut);
      const signature = api.genotypeSignature(kind, genotype);
      if (!signature || signature === 'none') return originalComposeFrame(kind, frame, genotype, blinkShut);
      genotypeComposeRequests++;
      const key = `${kind}|${frame}|${signature}|${blinkShut ? 'b' : 'o'}`; // Exact final-composite identity, matching the existing farm texture-cache dimensions.
      const existing = genotypeComposeInflight.get(key);
      if (existing) {
        genotypeComposeDedupHits++;
        return existing;
      }
      const promise = Promise.resolve().then(() => originalComposeFrame(kind, frame, genotype, blinkShut));
      genotypeComposeInflight.set(key, promise);
      const release = () => {
        if (genotypeComposeInflight.get(key) === promise) genotypeComposeInflight.delete(key);
      };
      promise.then(release, release); // In-flight only: successful/failed composites are immediately released so existing renderer/texture caches retain normal lifetime ownership.
      return promise;
    };
    api.__stableAnimalComposeDedupeWrapped = true;
    return api;
  }

  function patchMounts(api) {
    if (!api || api.__stableAnimalRidingPerksWrapped) return api;

    if (typeof api.init === 'function') {
      const originalInit = api.init.bind(api);
      api.init = function stableAnimalRidingInit(injectedDeps) {
        mountDeps = injectedDeps;
        return originalInit(injectedDeps);
      };
    }

    if (typeof api.updateMountedMovement === 'function') {
      const originalMovement = api.updateMountedMovement.bind(api);
      api.updateMountedMovement = function stableAnimalRidingMovement(dt, ...rest) {
        const entry = activeMountEntry();
        const ride = api.rideEntity;
        if (!entry || !ride || !mountDeps) return originalMovement(dt, ...rest);
        const modifiers = mountRidingModifiers(entry);
        const oldAccel = mountDeps.ACCEL;
        const oldClamp = mountDeps.clamp;
        const oldDef = ride.def;
        const baseSpeed = Number(oldDef?.mountSpeed);
        if (Number.isFinite(baseSpeed) && baseSpeed > 0) {
          // Temporary per-rider definition avoids mutating the shared CREATURE_DB species definition.
          ride.def = { ...oldDef, mountSpeed: baseSpeed * modifiers.baseSpeed };
        }
        if (Number.isFinite(Number(oldAccel))) mountDeps.ACCEL = Number(oldAccel) * modifiers.acceleration;
        if (typeof oldClamp === 'function' && modifiers.maneuverability !== 1) {
          mountDeps.clamp = function stableAnimalManeuverClamp(value, min, max) {
            const lo = Number(min), hi = Number(max);
            // Mount heading uses the only small symmetric +/- clamp in updateMountedMovement.
            // Position/input clamps are positive ranges and pass through untouched.
            if (lo < 0 && hi > 0 && Math.abs(lo + hi) < 1e-9 && Math.abs(hi) <= 2) {
              return oldClamp(value, lo * modifiers.maneuverability, hi * modifiers.maneuverability);
            }
            return oldClamp(value, min, max);
          };
        }
        try { return originalMovement(dt, ...rest); }
        finally {
          mountDeps.ACCEL = oldAccel;
          mountDeps.clamp = oldClamp;
          ride.def = oldDef;
        }
      };
    }

    if (typeof api.updateMountRide === 'function') {
      const originalRideUpdate = api.updateMountRide.bind(api);
      api.updateMountRide = function stableAnimalCliffSpeedUpdate(dt, ...rest) {
        const modifiers = mountRidingModifiers();
        const scaledDt = api.rideState === 'climbLeap'
          ? Number(dt) * modifiers.cliffClimbSpeed
          : dt;
        return originalRideUpdate(scaledDt, ...rest);
      };
    }

    try {
      Object.defineProperty(api, 'stableTrainingModifiers', {
        configurable: true,
        enumerable: true,
        get: () => mountRidingModifiers(),
      });
    } catch (_) {}
    api.__stableAnimalRidingPerksWrapped = true;
    return api;
  }

  function roleActor(role) {
    const combat = window.Combat?.deps;
    const player = combat?.player;
    const area = combat?.getCurrentArea?.();
    if (!player) return null;
    for (const actor of combat.companionObjects || []) {
      if (!actor || actor.health <= 0 || actor.stableRole !== role) continue;
      if ((actor.master || player) !== player) continue;
      if (area && actor.areaId && actor.areaId !== area) continue;
      if (actor.avatarRef?.group?.visible === false) continue;
      return actor;
    }
    return null;
  }

  function currentSocialDay() {
    const rapportDay = Number(window.NpcRapport?.currentGameDay?.());
    if (Number.isFinite(rapportDay)) return Math.floor(rapportDay);
    const calendarDay = Number(window.CalendarSystem?.timeDebugSnapshot?.()?.rawDay ?? window.calendar?.day);
    return Number.isFinite(calendarDay) ? Math.floor(calendarDay) : 0;
  }

  function rapportAnimalForGreeting(options) {
    const targetRoot = options?.faceTarget?.root;
    if (!targetRoot) return null;
    for (const role of ['companion', 'shoulderPet']) {
      const entry = progression.activeEntryForRole?.(role);
      const actor = roleActor(role);
      if (!entry || !actor || actor.avatarRef?.group !== targetRoot) continue;
      if (progression.perkRank(entry, 'rapportBond') <= 0) continue;
      return { role, entry, actor };
    }
    return null;
  }

  function greetingRapportReason(animalId) {
    return `pet_greeting:${animalId}`;
  }

  function greetingAlreadyRecorded(npcId, animalId, day) {
    const memory = window.DialogueContent?.getNpcDlgState?.(npcId)?.memory || [];
    const reason = greetingRapportReason(animalId);
    return memory.some(item => item?.type === 'rapport'
      && Math.floor(Number(item.day)) === day
      && item?.reason === reason);
  }

  function awardGreetingRapport(options, animal) {
    const npcId = String(options?.speakerId || '');
    if (!npcId || !animal) return 0;
    const day = currentSocialDay();
    if (greetedDay !== day) {
      greetedDay = day;
      greetedToday.clear();
    }
    const key = `${npcId}:${animal.entry.id}`;
    if (greetedToday.has(key) || greetingAlreadyRecorded(npcId, animal.entry.id, day)) return 0;
    greetedToday.add(key);
    return window.NpcRapport?.adjust?.(npcId, PET_GREETING_RAPPORT, greetingRapportReason(animal.entry.id)) || 0;
  }

  function patchAmbientDialogue(api) {
    if (!api || api.__stableAnimalGreetingRapportWrapped || typeof api.show !== 'function') return api;
    const originalShow = api.show.bind(api);
    api.show = function stableAnimalGreetingRapportShow(target, text, options = {}) {
      const animal = rapportAnimalForGreeting(options);
      const result = originalShow(target, text, options);
      // Only a line that actually rendered counts as the animal being greeted.
      if (result && animal) awardGreetingRapport(options, animal);
      return result;
    };
    api.__stableAnimalGreetingRapportWrapped = true;
    return api;
  }

  function hookFutureGlobal(name, patcher) {
    const current = window[name];
    if (current) patcher(current);
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && !descriptor.configurable) return;
    let stored = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : current;
    const oldGet = descriptor?.get;
    const oldSet = descriptor?.set;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() { return oldGet ? oldGet.call(window) : stored; },
        set(value) {
          if (oldSet) oldSet.call(window, value);
          else stored = value;
          const resolved = oldGet ? oldGet.call(window) : stored;
          if (resolved) patcher(resolved);
        },
      });
    } catch (_) {}
  }

  hookFutureGlobal('CreatureGeneticsRender', patchCreatureGeneticsRender);
  hookFutureGlobal('Mounts', patchMounts);
  hookFutureGlobal('AmbientDialogue', patchAmbientDialogue);

  window.StableAnimalPerkAdjustments = Object.freeze({
    installed: true,
    mountRidingModifiers,
    awardGreetingRapport,
    getDebug() {
      return {
        greetingRapport: PET_GREETING_RAPPORT,
        greetingDay: greetedDay,
        greetedToday: [...greetedToday],
        mountDepsReady: !!mountDeps,
        genotypeCompose: {
          inFlight: genotypeComposeInflight.size,
          requests: genotypeComposeRequests,
          dedupHits: genotypeComposeDedupHits,
        },
        mount: mountRidingModifiers(),
      };
    },
  });
})();
