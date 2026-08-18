// Territorial wildlife behavior for Grehlr and Drenkirra families.
(() => {
  'use strict';

  const DEFAULTS = Object.freeze({ // Used as safe territorial tuning before/without authored config.
    WARNING_RANGE_TILES: 6.5,
    WARNING_DURATION_S: 4.5,
    TOO_CLOSE_TILES: 1.75,
    FIGHT_LEASH_TILES: 7.0,
    REARM_CLEAR_TILES: 7.5,
    WARNING_UTTERANCE_MIN_S: 1.15,
    WARNING_UTTERANCE_MAX_S: 2.1,
  });
  const DEFAULT_SPECIES = Object.freeze(['grehlr', 'grehlr-den-mother', 'drenkirra', 'drenkirra-den-mother']); // Used until attack-values.json supplies the authored territorial species list.
  const tuning = { ...DEFAULTS }; // Used by every territorial phase and refreshed from authored config.
  let territorialSpecies = new Set(DEFAULT_SPECIES); // Used to identify wild actors whose player encounter is warning-first instead of predator/prey aggro.
  let deps = null; // Captured from WildlifeSpawn.init and used by the per-frame territorial pre-pass.
  let patchedApi = null; // Stores the intercepted WildlifeSpawn API once its later script assigns window.WildlifeSpawn.

  function random01() {
    const random = window.GameRandom?.random; // Used for gameplay-adjacent warning cadence without introducing a separate random source.
    return typeof random === 'function' ? random() : Math.random();
  }

  function isTerritorial(creature) {
    return !!creature && !creature.isCompanion && territorialSpecies.has(creature.creatureKey);
  }

  function ensurePerCreatureDef(creature) {
    const state = creature._territorialBehavior; // Used to reuse the same prototype overlay once this animal has entered the system.
    if (state?.baseDef && creature.def !== state.baseDef) return creature.def;
    const baseDef = creature.def; // Used as the live shared CREATURE_DB prototype so async attack-config mutations still flow through.
    const overlay = Object.create(baseDef || null); // Used for per-animal chase/stamina/leash overrides without mutating every same-species creature.
    creature.def = overlay;
    return overlay;
  }

  function ensureState(creature) {
    if (creature._territorialBehavior) return creature._territorialBehavior;
    const baseDef = creature.def; // Stored so this animal can return to the shared species definition when despawn/debug code inspects it.
    const state = {
      phase: 'idle',
      elapsedS: 0,
      nextUtteranceS: 0,
      anchorX: creature.x,
      anchorY: creature.y,
      originalHomeX: creature.homeX,
      originalHomeY: creature.homeY,
      baseDef,
      rearmBlocked: false,
      warningStartedReceivedAt: Number(creature.lastAttackReceivedAt) || -1e9,
    }; // Used as the complete warning/fight/disengage state for this individual animal.
    creature._territorialBehavior = state;
    const overlay = ensurePerCreatureDef(creature); // Used to stop game.js's ordinary hostile auto-aggro from bypassing the warning phase.
    overlay.behaviorType = 'territorial';
    overlay.hostile = false;
    return state;
  }

  function restoreTransientOverrides(creature) {
    const overlay = creature.def; // Used to remove only per-phase overrides while preserving the prototype-backed species config.
    if (!overlay) return;
    delete overlay.chaseSpeed;
    delete overlay.attackStaminaCost;
    delete overlay.leashRangePx;
    overlay.hostile = false;
    overlay.behaviorType = 'territorial';
  }

  function setAnchorHome(creature, state) {
    creature.homeX = state.anchorX;
    creature.homeY = state.anchorY;
  }

  function restoreOriginalHome(creature, state) {
    creature.homeX = state.originalHomeX;
    creature.homeY = state.originalHomeY;
  }

  function nextUtteranceDelay() {
    const span = Math.max(0, tuning.WARNING_UTTERANCE_MAX_S - tuning.WARNING_UTTERANCE_MIN_S); // Used to keep warning calls from sounding like a metronome.
    return tuning.WARNING_UTTERANCE_MIN_S + random01() * span;
  }

  function utterWarning(creature) {
    window.AudioSystem?.playCreatureBark?.(creature);
  }

  function beginWarning(creature, state, player) {
    state.phase = 'warning';
    state.elapsedS = 0;
    state.anchorX = creature.x;
    state.anchorY = creature.y;
    state.originalHomeX = creature.homeX;
    state.originalHomeY = creature.homeY;
    state.warningStartedReceivedAt = Number(creature.lastAttackReceivedAt) || -1e9;
    state.rearmBlocked = false;
    state.nextUtteranceS = nextUtteranceDelay();
    setAnchorHome(creature, state);

    const overlay = ensurePerCreatureDef(creature); // Used to make chase mean "stand, aim, warn" during this phase.
    overlay.hostile = false;
    overlay.chaseSpeed = 0;
    overlay.attackStaminaCost = Number.POSITIVE_INFINITY;
    overlay.leashRangePx = tuning.WARNING_RANGE_TILES * deps.TILE;
    overlay.behaviorType = 'territorial';
    creature.state = 'chase';
    creature.targetPlayer = player;
    creature.retreatT = 0;
    utterWarning(creature);
  }

  function beginFight(creature, state, player, reason) {
    state.phase = 'fight';
    state.elapsedS = 0;
    restoreTransientOverrides(creature);
    creature.def.leashRangePx = tuning.FIGHT_LEASH_TILES * deps.TILE; // Used as the short territory-centered chase leash instead of ordinary predator pursuit distance.
    creature.state = 'chase';
    creature.targetPlayer = player;
    window.__farmLog?.(`[wildlife] ${creature.creatureKey} (${creature.id}) territorial warning escalated: ${reason}.`, 'wildlife');
  }

  function beginDisengage(creature, state) {
    state.phase = 'disengage';
    state.elapsedS = 0;
    state.rearmBlocked = true;
    restoreTransientOverrides(creature);
    setAnchorHome(creature, state);
    creature.state = 'return';
    creature.targetPlayer = null;
    window.Combat?.telegraph?.cancel?.(creature);
    window.Combat?.animalAttacks?.cancel?.(creature);
  }

  function finishDisengage(creature, state, distanceToPlayer) {
    restoreTransientOverrides(creature);
    restoreOriginalHome(creature, state);
    creature.state = 'idle';
    creature.targetPlayer = null;
    state.phase = 'idle';
    state.elapsedS = 0;
    if (distanceToPlayer > tuning.REARM_CLEAR_TILES * deps.TILE) state.rearmBlocked = false;
  }

  function updateCreature(creature, dt, player) {
    if (!isTerritorial(creature) || creature.health <= 0 || creature.areaId !== deps.getCurrentArea()) return;
    const state = ensureState(creature); // Used to drive this individual's warning-first encounter state.
    const dx = player.x - creature.x, dy = player.y - creature.y; // Used for current player proximity without changing game.js's own nearest-player math.
    const distance = Math.hypot(dx, dy); // Used for warning, proximity escalation, fight leash, and rearm hysteresis.
    const warningRangePx = tuning.WARNING_RANGE_TILES * deps.TILE; // Used as the sight/territory boundary that starts warnings.
    const rearmClearPx = tuning.REARM_CLEAR_TILES * deps.TILE; // Used as the outer hysteresis boundary after a disengage.
    const fightLeashPx = tuning.FIGHT_LEASH_TILES * deps.TILE; // Used to stop a territorial fight after only a short pursuit.

    if (state.rearmBlocked && distance > rearmClearPx) state.rearmBlocked = false;

    if (state.phase === 'idle') {
      restoreTransientOverrides(creature);
      if (!state.rearmBlocked && distance <= warningRangePx) beginWarning(creature, state, player);
      return;
    }

    state.elapsedS += dt;

    if (state.phase === 'warning') {
      if (distance > warningRangePx) {
        beginDisengage(creature, state);
        return;
      }
      creature.state = 'chase';
      creature.targetPlayer = player;
      creature.def.chaseSpeed = 0;
      creature.def.attackStaminaCost = Number.POSITIVE_INFINITY;
      creature.def.leashRangePx = warningRangePx;
      state.nextUtteranceS -= dt;
      if (state.nextUtteranceS <= 0) {
        utterWarning(creature);
        state.nextUtteranceS = nextUtteranceDelay();
      }
      const attackedDuringWarning = Number(creature.lastAttackReceivedAt) > state.warningStartedReceivedAt; // Used to make attacking a warning animal an immediate escalation even from outside the proximity trigger.
      if (attackedDuringWarning) beginFight(creature, state, player, 'attacked during warning');
      else if (distance <= tuning.TOO_CLOSE_TILES * deps.TILE) beginFight(creature, state, player, 'player came too close');
      else if (state.elapsedS >= tuning.WARNING_DURATION_S) beginFight(creature, state, player, 'warning ignored');
      return;
    }

    if (state.phase === 'fight') {
      const distanceFromAnchor = Math.hypot(creature.x - state.anchorX, creature.y - state.anchorY); // Used to prevent a territorial animal itself from being kited far away from where it stood its ground.
      if (distance > fightLeashPx || distanceFromAnchor > fightLeashPx || creature.state === 'return') {
        beginDisengage(creature, state);
        return;
      }
      restoreTransientOverrides(creature);
      creature.def.leashRangePx = fightLeashPx;
      creature.state = 'chase';
      creature.targetPlayer = player;
      return;
    }

    // Disengage keeps the normal return movement but uses the encounter anchor
    // as home. Once back, the original den/grazing/patrol home is restored and
    // the ordinary wildlife schedule can resume.
    setAnchorHome(creature, state);
    const distanceFromAnchor = Math.hypot(creature.x - state.anchorX, creature.y - state.anchorY); // Used to detect when the short retreat has completed.
    if (distanceFromAnchor <= deps.TILE * 0.6) finishDisengage(creature, state, distance);
  }

  function ensureDebugElement() {
    const pane = document.getElementById('devWildlifePane'); // Used as the existing mobile-visible wildlife debug panel host.
    if (!pane) return null;
    let element = document.getElementById('territorialWildlifeDebug'); // Used to reuse one compact multi-animal status card.
    if (!element) {
      element = document.createElement('div');
      element.id = 'territorialWildlifeDebug';
      element.className = 'small';
      element.style.cssText = 'margin:6px 0;padding:6px;border:1px solid currentColor;border-radius:6px;white-space:pre-line;';
      pane.prepend(element);
    }
    return element;
  }

  function updateDebug() {
    const element = ensureDebugElement(); // Used to expose warning/fight/leash state on mobile without devtools.
    if (!element || !deps?.hostileObjects || !deps?.player) return;
    const rows = []; // Used as a compact snapshot of the nearest active territorial creatures.
    for (const creature of deps.hostileObjects) {
      if (!isTerritorial(creature) || creature.health <= 0 || creature.areaId !== deps.getCurrentArea()) continue;
      const state = creature._territorialBehavior;
      const distanceTiles = Math.hypot(deps.player.x - creature.x, deps.player.y - creature.y) / deps.TILE; // Used to diagnose warning/proximity/leash thresholds directly.
      rows.push({
        distanceTiles,
        text: `${creature.creatureKey}: ${state?.phase || 'idle'} ${distanceTiles.toFixed(1)}t${state?.phase === 'warning' ? ` ${Math.max(0, tuning.WARNING_DURATION_S - state.elapsedS).toFixed(1)}s` : ''}`,
      });
    }
    rows.sort((a, b) => a.distanceTiles - b.distanceTiles);
    element.textContent = `Territorial Wildlife\n${rows.length ? rows.slice(0, 6).map(row => row.text).join('\n') : 'none in current area'}`;
  }

  function updateTerritorial(dt) {
    if (!deps?.hostileObjects || !deps.player || !deps.getCurrentArea || !deps.TILE) return;
    for (const creature of deps.hostileObjects) updateCreature(creature, dt, deps.player);
    updateDebug();
  }

  function applyConfig(config) {
    if (!config || typeof config !== 'object') return;
    const incomingSpecies = Array.isArray(config.species) ? config.species.filter(value => typeof value === 'string') : null; // Used to author the behavior family separately from predator/herbivore diet.
    if (incomingSpecies?.length) territorialSpecies = new Set(incomingSpecies);
    for (const key of Object.keys(DEFAULTS)) {
      const value = Number(config[key]); // Used to accept only finite numeric overrides for known territorial tuning keys.
      if (Number.isFinite(value)) tuning[key] = value;
    }
  }

  function patchWildlifeSpawn(api) {
    if (!api || api.__hobunjiTerritorialPatched) return api;
    const originalInit = api.init?.bind(api); // Used to capture the same live player/wildlife deps game.js already injects.
    const originalUpdate = api.updateHostileSpawning?.bind(api); // Used to preserve all den spawning before the territorial pre-pass runs.
    if (originalInit) {
      api.init = function territorialAwareWildlifeInit(injectedDeps) {
        deps = injectedDeps;
        return originalInit(injectedDeps);
      };
    }
    if (originalUpdate) {
      api.updateHostileSpawning = function territorialAwareHostileSpawning(dt) {
        const result = originalUpdate(dt);
        updateTerritorial(dt);
        return result;
      };
    }
    api.__hobunjiTerritorialPatched = true;
    patchedApi = api;
    return api;
  }

  // This module is loaded by combat-config-loader before wildlife-spawn.js's
  // normal script tag. Intercept that later global assignment once, patch its
  // narrow init/update boundary, then restore a normal writable property.
  if (window.WildlifeSpawn) {
    patchWildlifeSpawn(window.WildlifeSpawn);
  } else {
    Object.defineProperty(window, 'WildlifeSpawn', {
      configurable: true,
      get() { return undefined; },
      set(value) {
        const patched = patchWildlifeSpawn(value); // Used as the API stored after wildlife-spawn.js assigns its namespace.
        Object.defineProperty(window, 'WildlifeSpawn', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: patched,
        });
      },
    });
  }

  window.HobunjiTerritorialWildlife = {
    applyConfig,
    tuning,
    get species() { return [...territorialSpecies]; },
    get patchedApi() { return patchedApi; },
  };

  const initialConfig = window.__attackValuesConfig?.creatureBehaviors?.territorial; // Used when authored config resolved before this module executed.
  if (initialConfig) applyConfig(initialConfig);
  window.addEventListener('hobunji-attack-values-loaded', event => {
    const config = event.detail?.creatureBehaviors?.territorial; // Used to refresh behavior tuning/species from the normal combat config loader.
    if (config) applyConfig(config);
  });
})();
