// Follow-up integration for Grehlr/Drenkirra species attacks.
// Keeps the existing companion 3x Guard Charge : 1x real-attack cadence,
// explicitly routes Medium companions to their species attack, and corrects
// Caustic Pellet's authored X-pitch without duplicating either attack module.
(() => {
  'use strict';

  const attacks = window.Combat?.animalAttacks; // Used to wrap the existing modular creature-attack dispatcher in place.
  if (!attacks?.start || !attacks?.update) {
    console.error('combat-grehlr-drenkirra-followup.js requires combat-animal-attacks.js to load first');
    return;
  }
  if (attacks.__hobunjiGrehlrDrenkirraFollowupPatched) return;

  const DEBUG_STEP_MS = 250; // Used to keep the mobile debug card at 4 Hz instead of touching the DOM every attack frame.
  let lastDebugAt = 0; // Used to throttle the optional mobile-visible species-attack diagnostics.
  let lastDebugText = ''; // Used to avoid redundant textContent assignments when the visible state is unchanged.

  function baseSpeciesKey(creature) {
    const key = creature?.creatureKey || ''; // Used to collapse Den-Mother variants onto the base species key.
    if (key === 'grehlr' || key === 'grehlr-den-mother') return 'grehlr';
    if (key === 'drenkirra' || key === 'drenkirra-den-mother') return 'drenkirra';
    return key;
  }

  function isMediumCompanion(creature) {
    if (!creature?.isCompanion) return false;
    const kind = baseSpeciesKey(creature); // Used to resolve the same genotype size family as the Stable/renderer.
    const sizeClass = window.CreatureGenetics?.creatureSizeClass?.(kind, creature.genotype); // Used to enforce the requested Medium-only species-special route.
    // Legacy active companions predate genotype sizeClass. Their role itself
    // is the Medium slot, so absence of the helper/data keeps that established
    // behavior instead of silently disabling combat on migrated saves.
    return !sizeClass || sizeClass === 'medium';
  }

  function ensureDebugElement() {
    const pane = document.getElementById('devWildlifePane'); // Used as the existing mobile-visible wildlife diagnostics host.
    if (!pane) return null;
    let element = document.getElementById('grehlrDrenkirraFollowupDebug'); // Used to reuse one compact diagnostic card.
    if (!element) {
      element = document.createElement('div');
      element.id = 'grehlrDrenkirraFollowupDebug';
      element.className = 'small';
      element.style.cssText = 'margin:6px 0;padding:6px;border:1px solid currentColor;border-radius:6px;white-space:pre-line;';
      pane.prepend(element);
    }
    return element;
  }

  function updateDebug(text, force = false) {
    const now = performance.now(); // Used to enforce the 4 Hz DOM-update ceiling for animation diagnostics.
    if (!force && now - lastDebugAt < DEBUG_STEP_MS) return;
    lastDebugAt = now;
    if (text === lastDebugText) return;
    const element = ensureDebugElement();
    if (!element) return;
    element.textContent = `Grehlr / Drenkirra Follow-up\n${text}`;
    lastDebugText = text;
  }

  const previousStart = attacks.start.bind(attacks); // Used to preserve Grehlr/Drenkirra stale-pounce compatibility wrappers and every other registered attack.
  attacks.start = function grehlrDrenkirraCompanionAwareStart(creature, attackId, context) {
    let resolvedId = attackId; // Used as the attack id handed to the already-established dispatcher.
    const species = baseSpeciesKey(creature); // Used to select only the two requested Medium-companion species.
    if (attackId === 'pounce' && isMediumCompanion(creature)) {
      if (species === 'grehlr') resolvedId = 'grehlrBurrow';
      else if (species === 'drenkirra') resolvedId = 'causticPellet';
    }

    const started = previousStart(creature, resolvedId, context);
    if (started && resolvedId !== attackId) {
      creature._speciesSpecialAttackId = resolvedId; // Used by mobile diagnostics and the Pellet pose correction while this real-attack action is active.
      window.__farmLog?.(`[wildlife] Medium companion ${species} (${creature.id}) used ${resolvedId} on its scheduled real-attack action.`, 'wildlife');
      updateDebug(`Medium companion ${species}: ${resolvedId}\nGuard cadence unchanged (special every 4th action)`, true);
    } else if (started && species === 'drenkirra' && creature?._animalAttack?.state?.projectiles) {
      // Wild/Den-Mother Drenkirra reach Caustic Pellet through the older
      // Drenkirra pounce-compatibility wrapper inside previousStart().
      creature._speciesSpecialAttackId = 'causticPellet';
    }
    return started;
  };

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function pelletPitchAmount(state, tuning) {
    if (state.stage === 'charge') {
      const duration = Math.max(0.01, Number(tuning.CHARGE_DURATION_S) || 1.04); // Used to match the Pellet module's charge progress exactly.
      const progress = clamp01(state.t / duration); // Used to reverse the same initial load tilt without touching accordion X scale.
      const tiltFrac = Math.max(0.0001, Math.min(0.95, Number(tuning.CHARGE_TILT_FRAC) || 0.18)); // Used as the authored tilt-in fraction.
      return progress < tiltFrac ? progress / tiltFrac : 1;
    }

    const duration = Math.max(0.01, Number(tuning.FIRE_DURATION_S) || 1.04); // Used to match the Pellet module's firing progress exactly.
    const progress = clamp01(state.t / duration); // Used to return from reversed load pitch to neutral by strike.
    const windupFrac = Math.max(0, Math.min(0.98, Number(tuning.FIRE_WINDUP_FRAC) || 0.05)); // Used as the start of the neutral-return motion.
    const strikeFrac = Math.max(windupFrac + 0.0001, Math.min(0.99, Number(tuning.FIRE_STRIKE_FRAC) || 0.08)); // Used as the exact neutral-X deadline/projectile release moment.
    if (progress <= windupFrac) return 1;
    if (progress < strikeFrac) return 1 - (progress - windupFrac) / Math.max(0.0001, strikeFrac - windupFrac);
    return 0;
  }

  function applyCorrectedPelletPitch(creature, state) {
    const tuning = window.HobunjiDrenkirraPellet?.tuning; // Used as the single source of authored Pellet timing/tilt values.
    if (!tuning || !state?.basePose || (state.stage !== 'charge' && state.stage !== 'fire')) return;
    const amount = pelletPitchAmount(state, tuning); // Used as reversed load pitch during charge and neutral-return amount during fire.
    const tiltRad = -(Number(tuning.TILT_DEG) || 45) * Math.PI / 180 * amount; // Reverses the old X rotation; zero is exact base X at/after strike.
    const front = creature.avatarRef?.frontPlane; // Used to correct the front sprite plane after the base Pellet update writes its pose.
    const back = creature.avatarRef?.backPlane; // Used to correct the mirrored back sprite plane identically.
    if (front && state.basePose.front) front.rotation.x = state.basePose.front.rotationX + tiltRad;
    if (back && state.basePose.back) back.rotation.x = state.basePose.back.rotationX + tiltRad;

    const progressLabel = state.stage === 'fire'
      ? `${Math.round(clamp01(state.t / Math.max(0.01, Number(tuning.FIRE_DURATION_S) || 1.04)) * 100)}%`
      : `${Math.round(clamp01(state.t / Math.max(0.01, Number(tuning.CHARGE_DURATION_S) || 1.04)) * 100)}%`; // Used only in the throttled mobile diagnostics.
    updateDebug(`Caustic Pellet ${state.stage} ${progressLabel}\nX pitch ${(tiltRad * 180 / Math.PI).toFixed(1)}° (neutral at strike)`);
  }

  const previousUpdate = attacks.update.bind(attacks); // Used to let each registered attack own scale/position/projectiles before the narrowly-scoped X-pitch correction.
  attacks.update = function grehlrDrenkirraFollowupUpdate(creature, dt) {
    const activeBefore = creature?._animalAttack; // Used to retain the Pellet state reference even if the underlying update finishes and clears the dispatcher slot.
    const state = activeBefore?.state; // Used to recognize Caustic Pellet by its private state shape without exposing/duplicating the attack registry.
    const looksLikePellet = baseSpeciesKey(creature) === 'drenkirra'
      && Array.isArray(state?.projectiles)
      && !!state?.basePose;
    const busy = previousUpdate(creature, dt);
    if (busy && looksLikePellet) applyCorrectedPelletPitch(creature, state);
    return busy;
  };

  attacks.__hobunjiGrehlrDrenkirraFollowupPatched = true;
  window.HobunjiGrehlrDrenkirraFollowup = { baseSpeciesKey, isMediumCompanion }; // Used by mobile/manual diagnostics and loader already-loaded checks.
})();
