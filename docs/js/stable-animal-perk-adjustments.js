(() => {
  'use strict';

  const progression = window.StableAnimalProgression;
  if (!progression || window.StableAnimalPerkAdjustments?.installed) return;

  const PET_GREETING_RAPPORT = 10; // Used when an NPC successfully greets a rapport-trained companion or perched shoulder pet; active rapport multipliers apply through NpcRapport.adjust.
  const MOUNT_SPEED_PER_RANK = 0.04;
  const MOUNT_ACCEL_PER_RANK = 0.10;
  const MOUNT_MANEUVER_PER_RANK = 0.08;
  const MOUNT_CLIMB_PER_RANK = 0.10;
  const AMBIENT_REACTION_AFTER_GREETING_MS = 450; // Used to leave a short conversational beat after the greeting fully fades before one animal reaction is shown.
  const AMBIENT_REACTION_GREETING_GRACE_MS = 700; // Used to briefly hold animal reactions that arrive before their paired player greeting in the same proximity update.
  const AMBIENT_SEQUENCE_TRACE_LIMIT = 16;

  let mountDeps = null; // Captured from Mounts.init; temporarily scales only the existing riding inputs during mounted movement.
  let greetedDay = null;
  const greetedToday = new Set(); // Keys NPC + individual animal so each NPC can reward each greeted rapport-trained pet once per game day.
  const pendingAnimalReactions = new Map(); // Used to combine same-NPC mount/companion/shoulder-pet reactions into one random follow-up.
  const recentPlayerGreetings = new Map(); // Used to anchor an animal follow-up after the greeting that actually rendered for that NPC.
  const ambientSequenceTrace = []; // Used by getDebug() so mobile testing can verify greeting -> queued candidates -> one rendered follow-up without a console.

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
    if (role === 'mount') {
      const ride = window.Mounts?.rideEntity;
      if (!ride || ride.health <= 0 || ride.avatarRef?.group?.visible === false) return null;
      return ride;
    }
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

  function animalForAmbientTarget(options) {
    const targetRoot = options?.faceTarget?.root;
    if (!targetRoot) return null;
    for (const role of ['companion', 'mount', 'shoulderPet']) {
      const entry = progression.activeEntryForRole?.(role);
      const actor = roleActor(role);
      if (!entry || !actor || actor.avatarRef?.group !== targetRoot) continue;
      return { role, entry, actor };
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
    const animal = animalForAmbientTarget(options);
    if (!animal || animal.role === 'mount') return null;
    if (progression.perkRank(animal.entry, 'rapportBond') <= 0) return null;
    return animal;
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

  function sequenceNow() {
    return Number(globalThis.performance?.now?.()) || Date.now();
  }

  function traceAmbientSequence(type, details = {}) {
    ambientSequenceTrace.push({ type, at: Math.round(sequenceNow()), ...details });
    if (ambientSequenceTrace.length > AMBIENT_SEQUENCE_TRACE_LIMIT) {
      ambientSequenceTrace.splice(0, ambientSequenceTrace.length - AMBIENT_SEQUENCE_TRACE_LIMIT);
    }
  }

  function patchAmbientDialogue(api) {
    if (!api || api.__stableAnimalGreetingRapportWrapped || typeof api.show !== 'function') return api;
    const originalShow = api.show.bind(api);

    function clearPendingTimer(pending) {
      if (!pending?.timer) return;
      clearTimeout(pending.timer);
      pending.timer = null;
    }

    function liveGreetingFor(npcId, now = sequenceNow()) {
      const greeting = recentPlayerGreetings.get(npcId) || null;
      if (!greeting) return null;
      if (now <= greeting.endAt + 1500) return greeting;
      recentPlayerGreetings.delete(npcId);
      return null;
    }

    function flushAnimalReaction(npcId) {
      const pending = pendingAnimalReactions.get(npcId);
      if (!pending) return null;
      pending.timer = null;
      const now = sequenceNow();
      const greeting = liveGreetingFor(npcId, now);
      if (greeting && now < greeting.endAt + AMBIENT_REACTION_AFTER_GREETING_MS) {
        scheduleAnimalReaction(npcId, greeting.endAt + AMBIENT_REACTION_AFTER_GREETING_MS - now);
        return null;
      }
      const candidates = [...pending.candidates.values()];
      pendingAnimalReactions.delete(npcId);
      if (!candidates.length) return null;
      const chosen = candidates[Math.floor(Math.random() * candidates.length)] || candidates[0];
      const animal = rapportAnimalForGreeting(chosen.options);
      const result = originalShow(chosen.target, chosen.text, chosen.options);
      if (result && animal) awardGreetingRapport(chosen.options, animal);
      traceAmbientSequence('reaction-shown', {
        npcId,
        animalId: chosen.animal.entry.id,
        role: chosen.animal.role,
        candidateCount: candidates.length,
      });
      return result;
    }

    function scheduleAnimalReaction(npcId, delayMs) {
      const pending = pendingAnimalReactions.get(npcId);
      if (!pending) return;
      clearPendingTimer(pending);
      pending.timer = setTimeout(() => flushAnimalReaction(npcId), Math.max(0, Number(delayMs) || 0));
    }

    function queueAnimalReaction(target, text, options, animal) {
      const npcId = String(options?.speakerId || '');
      if (!npcId) return null;
      let pending = pendingAnimalReactions.get(npcId);
      if (!pending) {
        pending = { candidates: new Map(), timer: null };
        pendingAnimalReactions.set(npcId, pending);
      }
      pending.candidates.set(animal.entry.id, { target, text, options: { ...options }, animal });
      const now = sequenceNow();
      const greeting = liveGreetingFor(npcId, now);
      const delay = greeting
        ? Math.max(0, greeting.endAt + AMBIENT_REACTION_AFTER_GREETING_MS - now)
        : AMBIENT_REACTION_GREETING_GRACE_MS;
      scheduleAnimalReaction(npcId, delay);
      traceAmbientSequence('reaction-queued', {
        npcId,
        animalId: animal.entry.id,
        role: animal.role,
        candidateCount: pending.candidates.size,
        waitingForGreeting: !greeting,
      });
      return { queued: true, speakerId: npcId, animalId: animal.entry.id, role: animal.role };
    }

    api.show = function stableAnimalGreetingRapportShow(target, text, options = {}) {
      const npcId = String(options?.speakerId || '');
      const playerGreeting = !!(npcId && options.greeting === true && options.directedAtPlayer === true);
      if (playerGreeting) {
        const result = originalShow(target, text, options);
        if (result) {
          const startedAt = Number(result.startedAt);
          const durationMs = Number(result.durationMs);
          const now = sequenceNow();
          const endAt = (Number.isFinite(startedAt) ? startedAt : now)
            + (Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 4200);
          recentPlayerGreetings.set(npcId, { startedAt: Number.isFinite(startedAt) ? startedAt : now, endAt });
          traceAmbientSequence('greeting-shown', { npcId, endAt: Math.round(endAt) });
          if (pendingAnimalReactions.has(npcId)) {
            scheduleAnimalReaction(npcId, Math.max(0, endAt + AMBIENT_REACTION_AFTER_GREETING_MS - now));
          }
        }
        return result;
      }

      const ambientAnimal = animalForAmbientTarget(options);
      if (npcId && ambientAnimal && options.directedAtPlayer === true) {
        return queueAnimalReaction(target, text, options, ambientAnimal);
      }

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
        mount: mountRidingModifiers(),
        ambientReactionTiming: {
          afterGreetingMs: AMBIENT_REACTION_AFTER_GREETING_MS,
          greetingGraceMs: AMBIENT_REACTION_GREETING_GRACE_MS,
        },
        pendingAmbientReactions: [...pendingAnimalReactions.entries()].map(([npcId, pending]) => ({
          npcId,
          candidates: [...pending.candidates.values()].map(candidate => ({
            animalId: candidate.animal.entry.id,
            role: candidate.animal.role,
          })),
        })),
        recentPlayerGreetings: [...recentPlayerGreetings.entries()].map(([npcId, greeting]) => ({ npcId, ...greeting })),
        ambientSequenceTrace: ambientSequenceTrace.map(entry => ({ ...entry })),
      };
    },
  });
})();