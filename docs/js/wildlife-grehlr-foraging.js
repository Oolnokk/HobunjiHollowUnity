// Grehlr foraging: "split up and forage individually" behavior for grehlr,
// extending js/wildlife-cloud-forest-behavior.js's established patterns
// (patch WildlifeSpawn's init/updateHostileSpawning, a per-creature
// prototype-overlay trick, reusing the existing herbivore "travel to
// station, settle into 'at-station-grazing'" schedule AI instead of
// reimplementing movement) to a second predator species. Not zone-gated —
// grehlr is Northern Cliffs' primary pack species today, but this is keyed
// on the species itself so it works wherever a grehlr pack exists; it
// naturally no-ops in a zone with no berry bushes or water tiles nearby.
//
// Two forage kinds: eating a wild berry bush (ground-level, mirrors
// drenkirra's fruit-branch system in wildlife-cloud-forest-behavior.js —
// walk to it, settle, eat for a while, consume it), or fishing (stand in
// the water and repeat a scripted lunge + look-down-and-eat pantomime on a
// slow cycle, with no world object consumed).
(() => {
  'use strict';

  const GREHLR_SPECIES = 'grehlr';
  const BERRY_SEARCH_RANGE_TILES = 10;
  const WATER_SEARCH_RANGE_TILES = 10;
  const FORAGE_CHECK_INTERVAL_HOURS = 0.25; // how often an idle grehlr re-rolls for nearby food
  const SEEK_TIMEOUT_HOURS = 2; // safety net — releases a reservation if travel never actually arrives (e.g. denKey/night takes priority over the herbivore-branch reuse — see maybeStartForaging)
  const BERRY_EAT_DURATION_HOURS = 0.25; // a quick snack, much smaller than drenkirra's whole climbed-up fruit
  const FISH_SESSION_DURATION_HOURS = 0.4;
  // Positive — this rig's own convention is negative degrees = up,
  // positive = down (confirmed via the vocalization head-nod, see
  // png-plane-avatar.js's applyDegrees), the opposite of what the name
  // suggests at a glance.
  const BERRY_LOOKDOWN_PITCH_DEG = 25;

  // Fishing pantomime phase durations, real seconds — "attack an empty
  // tile, then look down on the ground as if eating it, on a slow paced
  // cycle." Deliberately NOT the real Combat.animalAttacks/pounce system:
  // that's tightly coupled to 'chase' state and a live player/creature
  // target (aim solutions, telegraph cancellation, bandit branches, health
  // checks on the target), and forcing a synthetic {x,y} "target" through
  // it risks breaking real combat logic elsewhere that assumes a genuine
  // actor shape. A scripted scaleY lunge + head-pitch reuses the same
  // squash-crouch and look-at-target primitives the game already uses
  // elsewhere (pounce's CROUCH_SCALE_Y, the livestock/companion head-look
  // rig), without any of that coupling.
  const FISH_STRIKE_S = 0.6;
  const FISH_SETTLE_S = 0.8;
  const FISH_LOOKDOWN_S = 3.2;
  const FISH_RESTORE_S = 0.6;
  // Positive — see BERRY_LOOKDOWN_PITCH_DEG above.
  const FISH_LOOKDOWN_PITCH_DEG = 42;
  const FISH_STRIKE_SCALE_Y = 0.72;

  const BEHAVIOR_STEP_S = 0.5;

  let deps = null;
  let behaviorAccumS = 0;

  function nowHours() {
    const day = deps?.calendar?.day ?? 1;
    const hour = window.CalendarSystem?.getHour?.() ?? 12;
    return (day - 1) * 24 + hour;
  }

  function ensureGrehlrState(creature) {
    let state = creature._grehlrForage;
    if (!state) { state = { mode: 'ground', nextForageRollAt: 0 }; creature._grehlrForage = state; }
    return state;
  }

  // Grehlr isn't a herbivore (no diet field at all — predatorAvailable's
  // own def.diet !== 'herbivore' check is what normally makes it a
  // predator), so unlike cloud-forest drenkirra this same reuse trick
  // needs an explicit temporary overlay rather than already having the
  // right diet. Same per-creature Object.create(baseDef) technique
  // wildlife-territorial.js/wildlife-cloud-forest-behavior.js already use
  // for their own transient def overrides.
  function ensureDietOverlayState(creature) {
    let ov = creature._grehlrDietOverlay;
    if (!ov) { ov = { baseDef: creature.def, applied: false }; creature._grehlrDietOverlay = ov; }
    return ov;
  }
  function setForagingDietOverlay(creature, on) {
    const ov = ensureDietOverlayState(creature);
    if (on === ov.applied) return;
    if (on) {
      const overlay = Object.create(ov.baseDef);
      overlay.diet = 'herbivore';
      creature.def = overlay;
    } else {
      creature.def = ov.baseDef;
    }
    ov.applied = on;
  }

  // Mirrors wildlife-spawn.js's own nearestWaterTile (used there for
  // herbivore drinking spots) — reimplemented locally rather than
  // exported, since this module only has WildlifeSpawn's own deps
  // (zoneLayouts/TileType/TILE, all already injected there), not access to
  // wildlife-spawn.js's private functions. Range-capped, unlike the
  // original: a forage roll should only ever consider genuinely nearby
  // water, not the globally closest tile across a 200x200 zone.
  //
  // _waterTileCache holds just the RIVER/STREAM subset per zone (usually a
  // thin ribbon, a tiny fraction of the zone) so a forage roll never walks
  // every tile in a large zone (up to tens of thousands) just to find the
  // handful that are actually water. Keyed off the zone's own tiles array
  // reference, not zoneId alone — a Tothal Shift regenerates a zone under
  // a brand-new tiles array (see game.js's _zoneLayouts.set), so a stale
  // reference is exactly what invalidates this automatically.
  const _waterTileCache = new Map(); // zoneId -> { tilesRef, waterTiles }
  function waterTilesFor(zoneId) {
    const tiles = deps.zoneLayouts.get(zoneId)?.tiles;
    if (!tiles?.length) return null;
    const cached = _waterTileCache.get(zoneId);
    if (cached && cached.tilesRef === tiles) return cached.waterTiles;
    const waterTiles = tiles.filter(t => t.type === deps.TileType.RIVER || t.type === deps.TileType.STREAM);
    _waterTileCache.set(zoneId, { tilesRef: tiles, waterTiles });
    return waterTiles;
  }
  function nearestWaterTile(zoneId, col, row) {
    const waterTiles = waterTilesFor(zoneId);
    if (!waterTiles?.length) return null;
    let best = null, bestD = WATER_SEARCH_RANGE_TILES;
    for (const t of waterTiles) {
      const d = Math.hypot(t.c - col, t.r - row);
      if (d < bestD) { bestD = d; best = { x: t.c, y: t.r }; }
    }
    return best;
  }

  function findForageTarget(creature, zoneId) {
    const col = creature.x / deps.TILE, row = creature.y / deps.TILE;
    const berry = window.WildBerries?.nearestAvailableBerry?.(zoneId, col, row) || null;
    const berryDist = berry ? Math.hypot(berry.col - col, berry.row - row) : Infinity;
    const water = nearestWaterTile(zoneId, col, row);
    const waterDist = water ? Math.hypot(water.x - col, water.y - row) : Infinity;
    const berryInRange = berry && berryDist <= BERRY_SEARCH_RANGE_TILES;
    const waterInRange = water && waterDist <= WATER_SEARCH_RANGE_TILES;
    if (!berryInRange && !waterInRange) return null;
    if (berryInRange && (!waterInRange || berryDist <= waterDist)) return { kind: 'berry', berry };
    return { kind: 'water', water };
  }

  function endForaging(creature, state) {
    if (state.berry) state.berry.reserved = false;
    setForagingDietOverlay(creature, false);
    creature.grazingTile = null;
    creature.scaleY = 1;
    const restDeg = creature.avatarRef?.headRig?.rig?.restDeg ?? 0;
    creature.avatarRef?.updateHeadRotation?.(restDeg, 1);
    state.mode = 'ground';
    state.berry = null; state.water = null;
    state.fishPhase = null; state.fishPhaseS = 0;
  }

  function maybeStartForaging(creature, state, zoneId) {
    if (creature.state === 'chase' || creature.state === 'patrol-chase'
      || creature.state === 'fleeing-low-health' || creature.state === 'return') return;
    const now = nowHours();
    if (state.nextForageRollAt && now < state.nextForageRollAt) return;
    state.nextForageRollAt = now + FORAGE_CHECK_INTERVAL_HOURS;
    const target = findForageTarget(creature, zoneId);
    if (!target) return;
    state.zoneId = zoneId;
    state.seekStartHours = now;
    setForagingDietOverlay(creature, true);
    if (target.kind === 'berry') {
      target.berry.reserved = true;
      state.berry = target.berry;
      state.mode = 'seekingBerry';
      creature.grazingTile = { x: Math.round(target.berry.col), y: Math.round(target.berry.row) };
    } else {
      state.water = target.water;
      state.mode = 'seekingWater';
      creature.grazingTile = { x: target.water.x, y: target.water.y };
    }
    // Piggybacks on the existing herbivore "travel to grazingTile, settle
    // into 'at-station-grazing'" schedule AI already in game.js's
    // updateHostiles (unlocked by the diet overlay above) instead of
    // reimplementing pathing/collision here — this module only has
    // WildlifeSpawn's deps, not game.js's private travelCreatureToward/
    // creatureCanEnterTile. Note the denKey+night branch still outranks
    // the herbivore branch (see game.js's updateHostiles), so a roll made
    // right before nightfall just won't be walked to until the SEEK_TIMEOUT
    // safety net below releases it — acceptable, matches every denned
    // creature already prioritizing "go home at night" over anything else.
    creature.state = 'idle';
  }

  function beginEatingBerry(creature, state) {
    state.mode = 'eatingBerry';
    state.eatStartHours = nowHours();
  }
  function updateEatingBerry(creature, state) {
    if (nowHours() - state.eatStartHours < BERRY_EAT_DURATION_HOURS) return;
    if (state.berry) window.WildBerries?.removeBerryBush?.(state.zoneId, state.berry.col, state.berry.row);
    endForaging(creature, state);
  }

  function beginFishing(creature, state) {
    state.mode = 'fishing';
    state.fishSessionStartHours = nowHours();
    state.fishPhase = 'strike';
    state.fishPhaseS = 0;
    state.waterFacingX = (state.water.x + 0.5) * deps.TILE;
    state.waterFacingY = (state.water.y + 0.5) * deps.TILE;
  }
  function updateFishingSession(creature, state) {
    if (nowHours() - state.fishSessionStartHours >= FISH_SESSION_DURATION_HOURS) endForaging(creature, state);
  }

  function updateSeeking(creature, state) {
    if (nowHours() - state.seekStartHours > SEEK_TIMEOUT_HOURS) { endForaging(creature, state); return; }
    if (creature.state !== 'at-station-grazing') return;
    if (state.mode === 'seekingBerry') beginEatingBerry(creature, state);
    else beginFishing(creature, state);
  }

  function updateGrehlrForage(creature, zoneId) {
    if (creature.isDenMother || creature.creatureKey !== GREHLR_SPECIES) return;
    const state = ensureGrehlrState(creature);
    if (state.mode === 'ground') { maybeStartForaging(creature, state, zoneId); return; }
    if (state.mode === 'seekingBerry' || state.mode === 'seekingWater') { updateSeeking(creature, state); return; }
    if (state.mode === 'eatingBerry') { updateEatingBerry(creature, state); return; }
    if (state.mode === 'fishing') { updateFishingSession(creature, state); return; }
  }

  // ── Main throttled tick ──────────────────────────────────────────────
  function updateGrehlrForaging(dt) {
    if (!deps?.hostileObjects || !deps.getCurrentArea || !deps.TILE) return;
    behaviorAccumS += dt;
    if (behaviorAccumS < BEHAVIOR_STEP_S) return;
    behaviorAccumS = 0;
    const zoneId = deps.getCurrentArea();
    for (const c of deps.hostileObjects) {
      if (c.health <= 0 || c.areaId !== zoneId || c.creatureKey !== GREHLR_SPECIES) continue;
      updateGrehlrForage(c, zoneId);
    }
  }

  // ── Per-frame pose (eating dip / fishing pantomime) ──────────────────
  // Called every render frame from game.js's updateHostiles, right after
  // c.facing = aimAngle is assigned (see that file's own edit) — deliberately
  // AFTER the vanilla livestock-look/combat-head-nod block runs its own
  // _restoreCompanionHead, so this pose wins that frame's head-rotation
  // interpolation target instead of being immediately smoothed back to
  // rest by that unconditional per-frame call.
  function applyForagingPose(creature, dt) {
    const state = creature._grehlrForage;
    if (!state) return false;
    if (state.mode === 'eatingBerry') {
      creature.avatarRef?.updateHeadRotation?.(BERRY_LOOKDOWN_PITCH_DEG, dt);
      return true;
    }
    if (state.mode === 'fishing') {
      updateFishPhase(creature, state, dt);
      return true;
    }
    return false;
  }

  function updateFishPhase(creature, state, dt) {
    state.fishPhase = state.fishPhase || 'strike';
    state.fishPhaseS = (state.fishPhaseS || 0) + dt;
    switch (state.fishPhase) {
      case 'strike': {
        const t = Math.min(1, state.fishPhaseS / FISH_STRIKE_S);
        creature.scaleY = 1 - (1 - FISH_STRIKE_SCALE_Y) * Math.sin(t * Math.PI);
        if (Number.isFinite(state.waterFacingX)) creature.facing = Math.atan2(state.waterFacingY - creature.y, state.waterFacingX - creature.x);
        if (state.fishPhaseS >= FISH_STRIKE_S) { creature.scaleY = 1; state.fishPhase = 'settle'; state.fishPhaseS = 0; }
        break;
      }
      case 'settle': {
        if (state.fishPhaseS >= FISH_SETTLE_S) { state.fishPhase = 'lookdown'; state.fishPhaseS = 0; }
        break;
      }
      case 'lookdown': {
        creature.avatarRef?.updateHeadRotation?.(FISH_LOOKDOWN_PITCH_DEG, dt);
        if (state.fishPhaseS >= FISH_LOOKDOWN_S) { state.fishPhase = 'restore'; state.fishPhaseS = 0; }
        break;
      }
      case 'restore': {
        const restDeg = creature.avatarRef?.headRig?.rig?.restDeg ?? 0;
        creature.avatarRef?.updateHeadRotation?.(restDeg, dt);
        if (state.fishPhaseS >= FISH_RESTORE_S) { state.fishPhase = 'strike'; state.fishPhaseS = 0; }
        break;
      }
    }
  }

  function patchWildlifeSpawn(api) {
    if (!api || api.__hobunjiGrehlrForagingPatched) return api;
    const originalInit = api.init?.bind(api);
    const originalUpdate = api.updateHostileSpawning?.bind(api);
    if (originalInit) {
      api.init = function grehlrForagingAwareInit(injectedDeps) {
        deps = injectedDeps;
        return originalInit(injectedDeps);
      };
    }
    if (originalUpdate) {
      api.updateHostileSpawning = function grehlrForagingAwareHostileSpawning(dt) {
        const result = originalUpdate(dt);
        updateGrehlrForaging(dt);
        return result;
      };
    }
    api.__hobunjiGrehlrForagingPatched = true;
    return api;
  }

  // Same load-order problem as wildlife-cloud-forest-behavior.js: this file
  // is loaded by combat-config-loader.js's module list, which runs (and
  // document.writes its scripts) before index.html's own wildlife-spawn.js
  // <script> tag, so window.WildlifeSpawn doesn't exist yet when this file's
  // top level runs. Intercept the later global assignment the same way.
  // js/wildlife-territorial.js and js/wildlife-cloud-forest-behavior.js
  // install this exact same kind of trap for the same reason. A naive
  // `else` branch that unconditionally calls Object.defineProperty would
  // silently clobber whichever of those traps got here first — only one
  // property descriptor can occupy window.WildlifeSpawn at a time, so the
  // earlier trap's setter would simply never fire, and that module's
  // deps/init hook would stay uninitialized forever. Chain onto an
  // existing trap's setter instead of replacing it, so every module
  // patched this way still applies once the real assignment lands,
  // regardless of load order.
  if (window.WildlifeSpawn) {
    patchWildlifeSpawn(window.WildlifeSpawn);
  } else {
    const existingTrap = Object.getOwnPropertyDescriptor(window, 'WildlifeSpawn');
    if (existingTrap && typeof existingTrap.set === 'function') {
      const chainedSet = existingTrap.set;
      Object.defineProperty(window, 'WildlifeSpawn', {
        configurable: true,
        get: existingTrap.get,
        set(value) {
          chainedSet.call(window, value);
          patchWildlifeSpawn(window.WildlifeSpawn);
        },
      });
    } else {
      Object.defineProperty(window, 'WildlifeSpawn', {
        configurable: true,
        get() { return undefined; },
        set(value) {
          const patched = patchWildlifeSpawn(value);
          Object.defineProperty(window, 'WildlifeSpawn', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: patched,
          });
        },
      });
    }
  }

  window.HobunjiGrehlrForaging = { applyForagingPose };
})();
