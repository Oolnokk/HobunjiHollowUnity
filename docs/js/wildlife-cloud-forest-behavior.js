// Southern Cloud Forest schedule AI: gar-wolf dawn/dusk hunting shifts,
// drenkirra fruit foraging, and drenkirra night sleeping — plus a small
// distance-from-player LOD gate so an off-screen encounter resolves as a
// cheap dice roll instead of a fully simulated chase.
//
// Extracted as its own window.<Namespace> + init(deps) module, patched onto
// WildlifeSpawn exactly like js/wildlife-territorial.js — this file is
// loaded by combat-config-loader.js's module list, which runs (and
// document.writes its scripts) before index.html's own wildlife-spawn.js
// <script> tag, so window.WildlifeSpawn doesn't exist yet when this file's
// top level runs. Intercept the later global assignment the same way
// wildlife-territorial.js does, rather than js/wildlife-drenkirra-grazing.js's
// simpler `const api = window.WildlifeSpawn` (that module is only safe
// because something else has already forced WildlifeSpawn to exist by the
// time it runs; this one can't assume that). Reuses the existing
// 'return'/'patrol-chase'/'at-station-grazing' AI states in game.js's
// updateHostiles wherever possible rather than reimplementing movement/
// collision/combat locally, since this module has no access to those
// private per-frame helpers — only to what WildlifeSpawn's own deps object
// exposes.
(() => {
  'use strict';

  const CLOUD_FOREST_ZONE_ID = 'map_southern_cloud_forest';

  // ── Gar-wolf shift tuning ──────────────────────────────────────────
  const GARWOLF_SPECIES = new Set(['gar-wolf', 'gar-wolf-alpha']);
  const DAWN_CENTER_HOUR = 6;   // sunrise — matches game.js's MORNING_HOUR
  const DUSK_CENTER_HOUR = 19;  // sunset — matches Music.isNightTime's night-begins hour
  const SHIFT_HALF_WIDTH_HOURS = 1.5; // each shift is a 3-hour window centered on the hour above
  const GARWOLF_HUNT_SIGHT_RANGE_TILES = 7;
  const SETTLE_RADIUS_TILES = 0.6; // mirrors game.js's own DEN_SETTLE_RADIUS_PX-style threshold

  // ── Drenkirra forage/sleep tuning ──────────────────────────────────
  const FRUIT_MAX_PER_ZONE = 10;
  const FRUIT_SEEK_RANGE_TILES = 10;
  const FRUIT_EAT_T = 0.82; // how far out along a branch fruit hangs / a drenkirra perches to eat it
  const FRUIT_EAT_DURATION_HOURS = 0.5; // "a solid 30 in-game minutes" to eat one in place
  const FRUIT_RESPAWN_HOURS = 18;
  const FORAGE_CHECK_INTERVAL_HOURS = 0.25; // how often an idle drenkirra re-rolls for a nearby fruit
  // A tree's single climbable branch (foliage-generator.js's
  // climbBranchChance) attaches at a fixed ~42% up ITS OWN trunk, not a
  // fixed world height — a short-generated tree's branch can end up only
  // barely above the ground, which reads on screen as "sitting at the
  // roots" rather than perched in the tree. Both fruit-eating and sleep
  // branch selection require a branch to clear this far above its own
  // local ground before it's eligible, so a drenkirra never gets parked
  // somewhere that doesn't actually look like a branch.
  const MIN_PERCH_HEIGHT_WORLD = 1.5;

  // ── LOD ─────────────────────────────────────────────────────────────
  const LOD_NEAR_RANGE_TILES = 14;

  const BEHAVIOR_STEP_S = 0.5; // schedule/shift/forage logic only needs a 2 Hz tick; branch position locking still runs every render frame (see updateBranchDweller).

  let deps = null;
  let behaviorAccumS = 0;

  function rnd() { return deps?.rnd ? deps.rnd() : Math.random(); }

  function nowHours() {
    const day = deps?.calendar?.day ?? 1;
    const hour = window.CalendarSystem?.getHour?.() ?? 12;
    return (day - 1) * 24 + hour;
  }

  function isNearPlayer(entity) {
    const p = deps?.player;
    if (!p || !Number.isFinite(entity?.x) || !Number.isFinite(entity?.y)) return true; // fail open to full simulation
    return Math.hypot(entity.x - p.x, entity.y - p.y) <= LOD_NEAR_RANGE_TILES * deps.TILE;
  }

  // ── Gar-wolf shift AI ───────────────────────────────────────────────
  function hourDelta(hour, center) {
    const d = Math.abs(hour - center);
    return Math.min(d, 24 - d);
  }
  function inShiftWindow(hour) {
    return hourDelta(hour, DAWN_CENTER_HOUR) <= SHIFT_HALF_WIDTH_HOURS
        || hourDelta(hour, DUSK_CENTER_HOUR) <= SHIFT_HALF_WIDTH_HOURS;
  }

  function ensureGarWolfState(creature) {
    let state = creature._cfGarWolf;
    if (!state) { state = { baseDef: creature.def, overlayed: false }; creature._cfGarWolf = state; }
    return state;
  }

  // Off-shift, a gar-wolf must not pick a fresh player-aggro fight (the
  // "go home and rest" branch this unlocks in game.js's updateHostiles —
  // see the isPackOffShift-extended denKey/isNightTime condition there —
  // only stops it from continuing to patrol; the separate aggro-pickup
  // check above it in the same function only looks at def.hostile). A
  // per-creature prototype overlay (same technique as
  // wildlife-territorial.js's ensurePerCreatureDef) flips that off without
  // touching the shared CREATURE_DB entry every other gar-wolf reads too.
  function setOffShiftOverlay(creature, state, on) {
    if (on === state.overlayed) return;
    if (on) {
      const overlay = Object.create(state.baseDef);
      overlay.hostile = false;
      creature.def = overlay;
    } else {
      creature.def = state.baseDef;
    }
    state.overlayed = on;
  }

  function findNearestGroundDrenkirra(creature) {
    const rangePx = GARWOLF_HUNT_SIGHT_RANGE_TILES * deps.TILE;
    let best = null, bestD = rangePx;
    for (const other of deps.hostileObjects) {
      if (other === creature || other.health <= 0 || other.areaId !== creature.areaId) continue;
      if (!String(other.creatureKey || '').startsWith('drenkirra') || other.onBranch) continue; // can't climb up after them
      const d = Math.hypot(other.x - creature.x, other.y - creature.y);
      if (d < bestD) { bestD = d; best = other; }
    }
    return best;
  }

  // Instant, non-lethal outcome for an encounter neither participant is
  // near the player for — "rolling a die to see who wins in a fight"
  // instead of paying for a real chase/attack simulation. Reuses
  // WildlifeSpawn's own non-lethal skirmish damage path (never actually
  // kills, forces the loser to flee) rather than a second damage formula.
  function resolveAbstractSkirmish(attacker, prey) {
    const aPower = (attacker.def?.attackDamage || 10) + (attacker.maxHealth || 30) * 0.15;
    const pPower = (prey.def?.attackDamage || 8) + (prey.maxHealth || 30) * 0.15;
    const total = aPower + pPower || 1;
    const attackerWins = rnd() * total < aPower;
    const winner = attackerWins ? attacker : prey;
    const loser = attackerWins ? prey : attacker;
    const dmg = loser.maxHealth * (0.4 + rnd() * 0.3);
    window.WildlifeSpawn?.applyWildlifeSkirmishDamage?.(winner, loser, dmg);
    loser.state = 'fleeing-low-health';
    loser.targetCreature = null;
    attacker.state = 'idle';
    attacker.targetCreature = null;
  }

  function updateGarWolfPack(creature, hour) {
    if (!creature.denKey || !GARWOLF_SPECIES.has(creature.creatureKey)) return;
    const state = ensureGarWolfState(creature);
    const onShift = inShiftWindow(hour);
    setOffShiftOverlay(creature, state, !onShift);
    if (!onShift) return; // game.js's own off-shift branch (see isPackOffShift) already walks it home and settles it there

    const busy = creature.state === 'chase' || creature.state === 'patrol-chase'
      || creature.state === 'return' || creature.state === 'fleeing-low-health';
    if (busy) return;
    const prey = findNearestGroundDrenkirra(creature);
    if (!prey) return;
    if (isNearPlayer(creature) || isNearPlayer(prey)) {
      creature.state = 'patrol-chase';
      creature.targetCreature = prey;
    } else {
      resolveAbstractSkirmish(creature, prey);
    }
  }

  function isPackOffShift(creature) {
    if (!deps || !creature?.denKey || !GARWOLF_SPECIES.has(creature.creatureKey)) return false;
    return !inShiftWindow(window.CalendarSystem?.getHour?.() ?? 12);
  }

  // ── Drenkirra branch anchoring (foraging + sleeping share this) ─────
  // Called every render frame (see game.js's updateHostiles, right after
  // ClimbSystem.updateBranchDefender) for any onBranch creature — pins it
  // at its fixed spot on the branch and reports "handled" so none of the
  // ordinary ground movement/aggro branches (which have no idea a branch
  // even has a height) get a chance to drag it back onto the ground plane.
  // Gated on the _cfForage marker this module sets itself, so it never
  // touches the Nestmother (who has her own always-on onBranch placement
  // from spawnNestAtBranch, unrelated to this schedule AI).
  function updateBranchDweller(creature) {
    const forage = creature._cfForage;
    const branch = creature.onBranch;
    if (!forage || !branch) return false;
    const t = forage.t;
    creature.branchT = t;
    creature.x = branch.baseX + (branch.tipX - branch.baseX) * t;
    creature.y = branch.baseY + (branch.tipY - branch.baseY) * t;
    creature.branchSurfaceY = branch.baseWorldY + (branch.tipWorldY - branch.baseWorldY) * t;
    creature.facing = Math.atan2(branch.tipY - branch.baseY, branch.tipX - branch.baseX);
    creature.vx = 0; creature.vy = 0;
    return true;
  }

  // ── Fruit: selection, meshes, respawn ────────────────────────────────
  function branchKey(b) { return `${b.col},${b.row}`; }

  function isPerchWorthy(branch) {
    const groundY = window.ClimbSystem?.groundYAt?.(branch.baseX, branch.baseY) ?? 0;
    return (branch.baseWorldY - groundY) >= MIN_PERCH_HEIGHT_WORLD;
  }

  const _fruitSelectionCache = new Map(); // zoneId -> [branchKey,...]
  function eligibleFruitBranches(zoneId) {
    const all = (window.ClimbSystem?.debugBranchesFor?.(zoneId) || []).filter(b => !b.felled && !b.nest && isPerchWorthy(b));
    const liveByKey = new Map(all.map(b => [branchKey(b), b]));
    let selectedKeys = _fruitSelectionCache.get(zoneId);
    // A Tothal Shift regenerates the zone's trees under new tile keys — if
    // every cached key has gone stale (chunk streaming alone only ever
    // invalidates a few at once, see wildlife-spawn.js's nest-tree rebind),
    // treat the cache as stale and reselect rather than silently returning
    // zero fruit for the rest of the session.
    if (selectedKeys && all.length && !selectedKeys.some(key => liveByKey.has(key))) selectedKeys = null;
    if (!selectedKeys) {
      const scored = all.map(b => {
        const rng = window.WildernessMapGenerator?.makeRng?.(`${zoneId}_fruitbranch_${b.col}_${b.row}`);
        return { key: branchKey(b), score: rng ? rng() : rnd() };
      });
      scored.sort((a, b) => a.score - b.score);
      selectedKeys = scored.slice(0, FRUIT_MAX_PER_ZONE).map(s => s.key);
      _fruitSelectionCache.set(zoneId, selectedKeys);
    }
    const live = [];
    for (const key of selectedKeys) { const b = liveByKey.get(key); if (b) live.push(b); }
    return live;
  }

  let _fruitGeo = null, _fruitMat = null;
  function fruitGeoMat() {
    if (!_fruitGeo) {
      _fruitGeo = new THREE.SphereGeometry(0.15, 8, 6);
      _fruitMat = new THREE.MeshStandardMaterial({ color: 0xd9542b, roughness: 0.6, metalness: 0.05 });
    }
    return { geo: _fruitGeo, mat: _fruitMat };
  }

  const _fruitMeshes = new Map(); // zoneId -> Map(branchKey -> THREE.Mesh)
  function fruitWorldPos(branch) {
    return {
      x: (branch.baseX + (branch.tipX - branch.baseX) * FRUIT_EAT_T) / deps.TILE,
      z: (branch.baseY + (branch.tipY - branch.baseY) * FRUIT_EAT_T) / deps.TILE,
      y: branch.baseWorldY + (branch.tipWorldY - branch.baseWorldY) * FRUIT_EAT_T - 0.2,
    };
  }

  function ensureZoneFruit(zoneId, branches) {
    const zi = deps.zoneScenes?.get(zoneId);
    if (!zi?.scene) return;
    let meshMap = _fruitMeshes.get(zoneId);
    if (!meshMap) { meshMap = new Map(); _fruitMeshes.set(zoneId, meshMap); }
    for (const branch of branches || eligibleFruitBranches(zoneId)) {
      const key = branchKey(branch);
      if (!branch.fruit) branch.fruit = { available: true, reserved: false, eatenAtHours: -Infinity };
      if (branch.fruit.available && !meshMap.has(key)) {
        const { geo, mat } = fruitGeoMat();
        const pos = fruitWorldPos(branch);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(pos.x, pos.y, pos.z);
        zi.scene.add(mesh);
        meshMap.set(key, mesh);
      } else if (!branch.fruit.available && meshMap.has(key)) {
        // Respawned bookkeeping cleared the mesh from under us (e.g. a
        // reload mid-session) — drop the stale map entry so the next
        // available pass above rebuilds it instead of leaking a mismatch.
        meshMap.delete(key);
      }
    }
  }

  function removeFruitMesh(branch) {
    const key = branchKey(branch);
    for (const [zoneId, meshMap] of _fruitMeshes) {
      const mesh = meshMap.get(key);
      if (mesh) {
        deps.zoneScenes?.get(zoneId)?.scene?.remove(mesh);
        meshMap.delete(key);
      }
    }
  }

  function updateFruitRespawns(zoneId, branches) {
    const now = nowHours();
    for (const branch of branches || eligibleFruitBranches(zoneId)) {
      if (branch.fruit && !branch.fruit.available && now - branch.fruit.eatenAtHours >= FRUIT_RESPAWN_HOURS) {
        branch.fruit.available = true;
      }
    }
  }

  // ── Fruit: instant player pickup ─────────────────────────────────────
  // Registered into game.js's getWorldObjectAt zone-object chain — same
  // { getButtons(), onAction() } pickable contract js/reagent-plants.js
  // uses, keyed by the ground tile beneath where the fruit hangs (fruit is
  // deliberately grab-from-the-ground-below, not a full climb interaction).
  function makeFruitPickable(branch) {
    return {
      id: 'cfFruit_' + branchKey(branch), type: 'cloud_forest_fruit',
      label: '🍈 Cloud Forest Fruit',
      getButtons() {
        return [{ icon: '🍈', label: 'Pick Fruit', action: 'obj_pick_cf_fruit', style: 'primary', allowed: true }];
      },
      onAction(action) {
        if (action !== 'obj_pick_cf_fruit') return { ok: false, message: 'Unknown action.' };
        if (!branch.fruit?.available) return { ok: false, message: 'Already picked.' };
        branch.fruit.available = false;
        branch.fruit.reserved = false;
        branch.fruit.eatenAtHours = nowHours();
        removeFruitMesh(branch);
        deps.showToast?.('🍈 Grabbed a cloud forest fruit.', false);
        window.AudioSystem?.playObjectSfx?.(window.AudioSystem?.objectSfxConfig?.().harvest);
        return { ok: true, message: 'Picked a cloud forest fruit.' };
      },
    };
  }

  function fruitObjectAt(zoneId, col, row) {
    if (zoneId !== CLOUD_FOREST_ZONE_ID || !deps) return null;
    for (const branch of eligibleFruitBranches(zoneId)) {
      if (!branch.fruit?.available) continue;
      const pos = fruitWorldPos(branch);
      if (Math.floor(pos.x) === col && Math.floor(pos.z) === row) return makeFruitPickable(branch);
    }
    return null;
  }

  // ── Drenkirra day foraging / night sleeping ──────────────────────────
  function ensureDrenkirraState(creature) {
    let state = creature._cfDrenkirra;
    if (!state) { state = { mode: 'ground', nextForageRollAt: 0 }; creature._cfDrenkirra = state; }
    return state;
  }

  function findNearestAvailableFruitBranch(creature, zoneId) {
    let best = null, bestD = FRUIT_SEEK_RANGE_TILES * deps.TILE;
    for (const branch of eligibleFruitBranches(zoneId)) {
      if (!branch.fruit?.available || branch.fruit.reserved) continue;
      const d = Math.hypot(branch.baseX - creature.x, branch.baseY - creature.y);
      if (d < bestD) { bestD = d; best = branch; }
    }
    return best;
  }

  function maybeStartFruitSeek(creature, state, zoneId) {
    if (creature.state === 'chase' || creature.state === 'patrol-chase'
      || creature.state === 'fleeing-low-health' || creature.state === 'return') return;
    const now = nowHours();
    if (state.nextForageRollAt && now < state.nextForageRollAt) return;
    state.nextForageRollAt = now + FORAGE_CHECK_INTERVAL_HOURS;
    const branch = findNearestAvailableFruitBranch(creature, zoneId);
    if (!branch) return;
    branch.fruit.reserved = true;
    state.mode = 'seekingFruit';
    state.fruitBranch = branch;
    state.savedGrazingTile = creature.grazingTile ? { ...creature.grazingTile } : null;
    // Piggybacks on the existing herbivore "travel to grazingTile, settle
    // into 'at-station-grazing'" schedule AI already in game.js's
    // updateHostiles instead of reimplementing pathing/collision here —
    // this module only has WildlifeSpawn's deps, not game.js's private
    // travelCreatureToward/creatureCanEnterTile.
    creature.grazingTile = { x: Math.floor(branch.baseX / deps.TILE), y: Math.floor(branch.baseY / deps.TILE) };
    creature.state = 'idle';
  }

  function cancelFruitSeek(creature, state) {
    if (state.fruitBranch?.fruit) state.fruitBranch.fruit.reserved = false;
    creature.grazingTile = state.savedGrazingTile || null;
    state.mode = 'ground';
    state.fruitBranch = null;
  }

  function beginEating(creature, state) {
    const branch = state.fruitBranch;
    creature.onBranch = branch;
    creature._cfForage = { t: FRUIT_EAT_T };
    creature.state = 'idle';
    state.mode = 'eating';
    state.eatStartHours = nowHours();
  }

  function updateSeekingFruit(creature, state) {
    if (!state.fruitBranch?.fruit?.available) { cancelFruitSeek(creature, state); return; }
    if (creature.state === 'at-station-grazing') beginEating(creature, state);
  }

  function finishEating(creature, state, consumed) {
    const branch = state.fruitBranch;
    if (branch?.fruit) {
      branch.fruit.reserved = false;
      if (consumed) {
        branch.fruit.available = false;
        branch.fruit.eatenAtHours = nowHours();
        removeFruitMesh(branch);
      }
    }
    creature.onBranch = null; creature.branchT = 0; creature.branchSurfaceY = 0;
    creature._cfForage = null;
    creature.grazingTile = state.savedGrazingTile || null;
    state.mode = 'ground';
    state.fruitBranch = null;
  }

  function updateEating(creature, state) {
    if (!state.fruitBranch) { state.mode = 'ground'; return; }
    if (nowHours() - state.eatStartHours >= FRUIT_EAT_DURATION_HOURS) finishEating(creature, state, true);
  }

  // Two sleepers per branch, on whichever climbable branches sit nearest
  // this drenkirra's own Nestmother's branch — never the Nestmother's own
  // branch (branch.nest), so she stays alone at her nest as asked. Slot
  // occupancy lives directly on the branch object (same convention
  // wildlife-spawn.js already uses for branch.nest), since these branch
  // objects persist for the zone's session lifetime.
  function assignSleepSlot(creature, zoneId) {
    const nestKey = creature.nestTreeKey;
    if (!nestKey) return null;
    const branches = (window.ClimbSystem?.debugBranchesFor?.(zoneId) || []).filter(b => !b.felled);
    const nestBranch = branches.find(b => b.nest?.id === nestKey);
    if (!nestBranch) return null;
    for (const b of branches) {
      if (b === nestBranch || !b._cfSleepSlots?.includes(creature)) continue;
      return { branch: b, t: b._cfSleepSlotT?.get(creature) ?? 0.5 };
    }
    const candidates = branches
      .filter(b => b !== nestBranch && !b.nest && isPerchWorthy(b) && (!b._cfSleepSlots || b._cfSleepSlots.length < 2))
      .map(b => ({ b, d: Math.hypot(b.baseX - nestBranch.baseX, b.baseY - nestBranch.baseY) }))
      .sort((a, b) => a.d - b.d);
    const pick = candidates[0]?.b;
    if (!pick) return null;
    pick._cfSleepSlots = pick._cfSleepSlots || [];
    pick._cfSleepSlots.push(creature);
    pick._cfSleepSlotT = pick._cfSleepSlotT || new Map();
    const t = pick._cfSleepSlots.length === 1 ? 0.35 : 0.75;
    pick._cfSleepSlotT.set(creature, t);
    return { branch: pick, t };
  }

  function beginGoToSleep(creature, state, zoneId) {
    if (state.mode === 'eating' || state.mode === 'seekingFruit') finishEating(creature, state, false);
    const slot = assignSleepSlot(creature, zoneId);
    if (!slot) return; // no tree found for this pack — stays on the ground overnight rather than error
    state.mode = 'sleeping';
    state.sleepBranch = slot.branch;
    creature.onBranch = slot.branch;
    creature._cfForage = { t: slot.t };
    creature.scaleY = 0.5; // "lie animation is just scaling down y by 50%"
    creature.state = 'idle';
  }

  function endSleep(creature, state) {
    const branch = state.sleepBranch;
    if (branch?._cfSleepSlots) {
      const i = branch._cfSleepSlots.indexOf(creature);
      if (i >= 0) branch._cfSleepSlots.splice(i, 1);
      branch._cfSleepSlotT?.delete(creature);
    }
    creature.onBranch = null; creature.branchT = 0; creature.branchSurfaceY = 0;
    creature._cfForage = null;
    creature.scaleY = 1;
    state.mode = 'ground';
    state.sleepBranch = null;
  }

  // Attacking a drenkirra mid-forage or asleep needs to actually knock it
  // off whatever branch it's currently pinned to before 'fleeing-low-
  // health' can do anything at all — game.js's updateHostiles skips a
  // branch-pinned creature's entire per-frame state machine every tick
  // via its own "if (c.onBranch && updateBranchDweller(c, dt)) continue"
  // early-out (updateBranchDweller re-pins creature.x/y to the branch's
  // fixed t position and reports "handled" unconditionally whenever
  // onBranch + _cfForage are both still set). A creature attacked while
  // eating/sleeping had 'fleeing-low-health' set on it by damageCreature,
  // but stayed onBranch — so it just sat there pinned in place forever,
  // "trying" to flee but never actually reaching the movement branch that
  // would do it. Called from game.js's damageCreature right before it
  // sets that state; a no-op for a drenkirra that's already on the ground.
  function interruptForFlee(creature) {
    const state = creature._cfDrenkirra;
    if (!state) return;
    if (state.mode === 'eating' || state.mode === 'seekingFruit') finishEating(creature, state, false);
    else if (state.mode === 'sleeping') endSleep(creature, state);
  }

  function updateDrenkirraSchedule(creature, night, zoneId) {
    if (creature.isDenMother || !String(creature.creatureKey || '').startsWith('drenkirra')) return;
    // wildlife-territorial.js owns this creature's state/movement entirely
    // while it's actively warning or fighting off a threat — it runs
    // before this module each tick (see combat-config-loader.js's module
    // order), so without this check, a nighttime creature it just woke
    // from sleep (mode reset to 'ground') would get sent straight back to
    // sleep by the "if (night)" branch below on the very same tick,
    // undoing the wake-up before it ever moved.
    const territorialPhase = creature._territorialBehavior?.phase;
    if (territorialPhase === 'warning' || territorialPhase === 'fight') return;
    const state = ensureDrenkirraState(creature);

    if (night) {
      if (state.mode !== 'sleeping') beginGoToSleep(creature, state, zoneId);
      return;
    }
    if (state.mode === 'sleeping') { endSleep(creature, state); return; }
    if (state.mode === 'eating') { updateEating(creature, state); return; }
    if (state.mode === 'seekingFruit') { updateSeekingFruit(creature, state); return; }
    if (!isNearPlayer(creature)) return; // far from the player: skip the fruit-seek scan, default grazing/wander stands in for it
    maybeStartFruitSeek(creature, state, zoneId);
  }

  // ── Main tick ─────────────────────────────────────────────────────
  function updateCloudForestBehavior(dt) {
    if (!deps?.hostileObjects || !deps.getCurrentArea || !deps.TILE) return;
    behaviorAccumS += dt;
    if (behaviorAccumS < BEHAVIOR_STEP_S) return;
    behaviorAccumS = 0;

    const zoneId = deps.getCurrentArea();
    if (zoneId !== CLOUD_FOREST_ZONE_ID) return;

    // Computed once and shared — both of these otherwise independently
    // re-filter and re-copy every registered branch in the zone via
    // eligibleFruitBranches/ClimbSystem.debugBranchesFor.
    const fruitBranches = eligibleFruitBranches(zoneId);
    ensureZoneFruit(zoneId, fruitBranches);
    updateFruitRespawns(zoneId, fruitBranches);
    const hour = window.CalendarSystem?.getHour?.() ?? 12;
    const night = !!window.Music?.isNightTime?.();
    for (const c of deps.hostileObjects) {
      if (c.health <= 0 || c.areaId !== zoneId) continue;
      if (GARWOLF_SPECIES.has(c.creatureKey)) updateGarWolfPack(c, hour);
      else updateDrenkirraSchedule(c, night, zoneId);
    }
  }

  function patchWildlifeSpawn(api) {
    if (!api || api.__hobunjiCloudForestPatched) return api;
    const originalInit = api.init?.bind(api);
    const originalUpdate = api.updateHostileSpawning?.bind(api);
    if (originalInit) {
      api.init = function cloudForestAwareInit(injectedDeps) {
        deps = injectedDeps;
        return originalInit(injectedDeps);
      };
    }
    if (originalUpdate) {
      api.updateHostileSpawning = function cloudForestAwareHostileSpawning(dt) {
        const result = originalUpdate(dt);
        updateCloudForestBehavior(dt);
        return result;
      };
    }
    api.__hobunjiCloudForestPatched = true;
    return api;
  }

  // This module loads (via combat-config-loader.js's module list) before
  // wildlife-spawn.js's own <script> tag assigns window.WildlifeSpawn —
  // same ordering problem js/wildlife-territorial.js already solves this
  // exact way: intercept the later global assignment once, patch its
  // narrow init/updateHostileSpawning boundary, then restore a normal
  // writable property.
  // js/wildlife-territorial.js and js/wildlife-grehlr-foraging.js install
  // this exact same kind of trap for the same reason. A naive `else`
  // branch that unconditionally calls Object.defineProperty would
  // silently clobber whichever of those traps got here first — only one
  // property descriptor can occupy window.WildlifeSpawn at a time, so the
  // earlier trap's setter would simply never fire, and that module's
  // deps/init hook would stay uninitialized forever (this was a real,
  // live bug: territorial and this module's deps never got set, so none
  // of gar-wolf shift hunting or drenkirra foraging/sleeping ever ran —
  // only whichever of the three modules happened to load last actually
  // worked). Chain onto an existing trap's setter instead of replacing
  // it, so every module patched this way still applies once the real
  // assignment lands, regardless of load order.
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

  window.HobunjiCloudForestWildlife = {
    isPackOffShift,
    updateBranchDweller,
    fruitObjectAt,
    interruptForFlee,
    // Read by js/wildlife-behavior-map.js's LOD near/far ring — exported
    // rather than duplicated so retuning this constant here keeps the
    // debug map honest about where the real boundary actually is.
    get LOD_NEAR_RANGE_TILES() { return LOD_NEAR_RANGE_TILES; },
  };
})();
