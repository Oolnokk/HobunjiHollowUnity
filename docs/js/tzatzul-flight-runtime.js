// Cliff-roosted Tzatzul behavior. WildlifeSpawn supplies the existing update
// tick and population lifecycle; the shared perch system owns 3D elevation.
(() => {
  'use strict';
  if (window.TzatzulFlightRuntime) return;

  const ALLOWED_AREAS = new Set(['map_northern_cliffs', 'map_western_slope']); // Real cliff environments.
  const HUNT_RANGE_TILES = 12; // A scouting hunter must approach this close before a body-first swoop.
  const TERRITORY_TILES = 40; // Prey search stays within the home spire's territory.
  const SCOUT_RADIUS_TILES = 20; // Empty hunts sweep broad circuits instead of waiting on a perch.
  const NEST_STAY_HOURS = .5; // Successful deliveries keep the parent in its cave for thirty in-game minutes.
  const REST_SECONDS = 5; // Initial roost warm-up and a fallback for dev worlds without a clock.
  const SPEED_TILES_PER_SECOND = 7; // Flight travel across world tiles.
  const TERRAIN_CLEARANCE_WORLD = 1.3; // Exterior body clearance above real plateau tops.
  const TERRAIN_SAMPLE_TILES = .5; // Cache half-tile terrain height samples before each flight leg.
  const BODY_WIDTH_FRACTION = .30; // Damaging torso/core is narrower than the full articulated wing-span portrait.
  const BODY_HEIGHT_FRACTION = .34; // Half-height of the headfirst body box, based on the existing creature hitbox.
  const NOSE_LEAD_FRACTION = .33; // Moves the body toward the head/beak along its actual 3D flight direction.
  const captured = new Map(); // Actual captured players/creatures, preserving original actor objects and movement state.
  const spawnedThisDay = new Set(); // Prevents post-death immediate respawning.
  const actors = new Set(); // Only Tzatzul, not all hostile creatures, are animated each tick.
  const stats = { spawned: 0, flights: 0, swoops: 0, hits: 0, misses: 0,
    retreats: 0, captures: 0, releases: 0, scouts: 0, nestStays: 0, fleeDrops: 0, nestEntries: 0, failedNestEntries: 0, lastCapture: null, last: null, lastBodyContact: null }; // Mobile-readable diagnostics, no live object references.
  let deps = null; // WildlifeSpawn injected authoritative gameplay world contract.
  let flightSerial = 0; // Unique ephemeral line-perch IDs for traveling birds.

  const n = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const tile = () => Math.max(1, n(deps?.TILE, 64));
  const surface = (x, y) => n(deps?.worldSurfaceY?.(x, y));
  const distance = (a, b) => Math.hypot(n(a.x) - n(b.x), n(a.y) - n(b.y));
  function clockHours() {
    const clock = deps?.calendar; // The authoritative saved calendar survives area changes and skipped time.
    return Number.isFinite(Number(clock?.day)) && Number.isFinite(Number(clock?.time01))
      ? (Number(clock.day) - 1 + Number(clock.time01)) * 24 : null;
  }
  function enterNest(bird) {
    const state = bird?._tzFlight; // A single exterior parent shelters in its existing authored cave.
    if (!state) return;
    state.phase = 'in-nest'; state.segment = null; state.target = null; state.elapsed = 0;
    const now = clockHours(); // The deadline uses in-game time, not real seconds.
    state.nestUntil = now === null ? null : now + NEST_STAY_HOURS;
    state.nestFallbackS = REST_SECONDS; // Standalone test worlds without a clock can still progress.
    bird.tzatzulInNest = true; bird._denHidden = true; bird.tzatzulFlightPose = 'perched';
    if (bird.avatarRef?.group) bird.avatarRef.group.visible = false;
    if (bird.groundShadow) bird.groundShadow.visible = false;
    stats.nestStays++; mark(bird, 'entered cave for 30 game minutes');
  }
  function leaveNest(bird) {
    const state = bird._tzFlight;
    bird.tzatzulInNest = false; bird._denHidden = false;
    if (bird.avatarRef?.group) bird.avatarRef.group.visible = !bird._wildlifeVisualLodHidden;
    if (bird.groundShadow) bird.groundShadow.visible = !bird._wildlifeVisualLodHidden;
    state.phase = 'perched'; state.elapsed = 0; state.rest = 0; state.nestUntil = null;
    bird.tzatzulFlightPose = 'perched';
    mark(bird, 'left nest to provision hatchlings');
  }
  function mark(bird, event) {
    stats.last = { time: Date.now(), event, bird: bird?._tzFlight?.identity?.id || null,
      area: bird?.areaId || null };
    window.__farmLog?.('[tzatzul] ' + event, 'wildlife');
  }
  function roosts(area) {
    // Existing mini-cliff caps are player-reachable; do not use them as nests.
    // The dedicated Spire owner adds physically separate bird-only point
    // perches without modifying player climb paths or walking surfaces.
    return window.TzatzulCliffSites?.ensure?.(area, {
      zoneScenes: deps?.zoneScenes, TILE: tile(),
    }) || [];
  }
  function init(injected) {
    deps = injected; // No second creature factory, map store, camera loop, or independent timers.
    lastArea = null;
    for (const prey of [...captured.keys()]) releaseCaptive(prey, 'reset');
    actors.clear();
    spawnedThisDay.clear();
    return !!deps?.makeCreatureEntity;
  }
  function ensureZone(area) {
    if (!deps || !ALLOWED_AREAS.has(area) || deps.getCurrentArea?.() !== area) return 0;
    let count = 0;
    const available = roosts(area);
    const supports = new Map(available.map(r => [r.id, r])); // Retain the actual spire's caveMapId across scene streaming.
    for (const bird of actors) {
      if (bird.areaId !== area || !(bird.health > 0)) continue;
      const state = bird._tzFlight, roost = supports.get(state?.roostId);
      if (!roost) continue;
      const support = roost.support;
      const changed = state.roost !== support; // Only rebuilt scenes reset a resting bird's hunt clock.
      state.roost = support; bird.tzatzulNestMapId = roost.caveMapId; // Streamed spire always refreshes cave identity.
      if (!bird.prone && !bird._knockbackLedgeFall && !bird._knockbackLedgeAir && !(bird.knockbackT > 0) && (state.phase === 'await-roost' || changed && state.phase === 'perched')) {
        if (state.phase === 'await-roost' && !bird.onPerch) { returnHome(bird); continue; } // Fly back after a real knock-off instead of teleporting to the high spire.
        if (window.PerchSupport?.attach?.(bird, support)) {
          state.phase = 'perched'; state.elapsed = 0; state.rest = REST_SECONDS;
          state.target = null; bird.tzatzulFlightPose = 'perched'; bird.tzatzulDivePitchRad = 0;
        }
      } // A regenerated roost can rescue a bird stranded by scene replacement.
    }
    for (const [slot, roost] of available.entries()) {
      if (spawnedThisDay.has(roost.id)) continue;
      const identity = window.TzatzulRegistration?.identityFor?.(area, slot);
      if (!identity) continue;
      const bird = deps.makeCreatureEntity('tzatzul', roost.support.x, roost.support.y, {
        homeX: roost.support.x, homeY: roost.support.y, state: 'idle',
        streamVisuals: true, wildlifeRole: 'predator', tzatzulRoostId: roost.id,
      });
      if (!bird || !window.PerchSupport?.attach?.(bird, roost.support)) continue;
      bird.tzatzulIdentity = identity; // Live wing renderer uses this exact stable per-map coloring.
      bird.tzatzulNestMapId = roost.caveMapId; // Only real authored spires grant player-abduction access.
      bird.tzatzulFlightPose = 'perched'; // Reuses TzatzulLiveVisuals; no duplicate renderer.
      bird._tzFlight = { identity, roostId: roost.id, roost: roost.support,
        phase: 'perched', elapsed: 0, rest: REST_SECONDS + slot, target: null,
        segment: null, struck: false, captive: null, scoutIndex: slot * 3,
        delivered: false, nestUntil: null, retreating: false }; // Persistent hunt/cave phases per parent. // Independent phase per animal.
      deps.hostileObjects.add(bird);
      actors.add(bird);
      spawnedThisDay.add(roost.id);
      stats.spawned++; count++;
      mark(bird, 'roosted on bird-only cliff spire ' + roost.id);
    }
    return count;
  }
  function viable(bird, other) {
    return other && other !== bird && other.health > 0 && other.areaId === bird.areaId
      && (other.isBandit === true || other.isTribeHunter === true || other.isPorakanekiHunter === true)
      && !other.onBranch && !other.onPerch && !other.tzatzulCapturedBy && !other._denHidden
      && !other._downed && other.state !== 'dying' && canCarry(other);
  }
  function choosePrey(bird, rangeTiles = HUNT_RANGE_TILES) {
    let target = null, best = tile() * rangeTiles;
    const roost = bird?._tzFlight?.roost || bird; // Do not chase indefinitely into neighboring territories.
    const player = deps.player;
    if (canAbductPlayer(bird) && player?.health > 0 && !player.tzatzulCapturedBy
      && deps.getCurrentArea?.() === bird.areaId && distance(player, roost) <= TERRITORY_TILES * tile()) {
      const d = distance(player, bird);
      if (d < best) { best = d; target = player; }
    }
    for (const other of deps.hostileObjects || []) {
      if (!viable(bird, other) || distance(other, roost) > TERRITORY_TILES * tile()) continue;
      const d = distance(other, bird);
      if (d < best) { best = d; target = other; }
    } // Only the player, bandits and barbarian/tribal hunters count as food for the cave.
    return target;
  }
  function hitboxSize(bird) {
    const box = window.RangedWeapons?.actorHitbox?.(bird); // Shared combat geometry, not the wing/rider/talon rig.
    const width = Math.max(.5, n(box?.width, n(bird.def?.modelWidth, 1.6)));
    const height = Math.max(.5, n(box?.height, n(bird.halfHeight, width / 2) * 2));
    const depth = Math.max(.5, n(box?.depth, width));
    return {
      x: Math.max(.24, Math.min(1.05, width * BODY_WIDTH_FRACTION)),
      y: Math.max(.24, Math.min(.85, height * BODY_HEIGHT_FRACTION)),
      z: Math.max(.24, Math.min(1.05, depth * BODY_WIDTH_FRACTION)),
    }; // Only the torso/body is damaging; the wings and carried talons are not.
  }
  function targetBox(target) {
    const hitbox = window.RangedWeapons?.actorHitbox?.(target); // Same authoritative 3D target body volume used by ranged and melee combat.
    if (hitbox?.box?.min && hitbox?.box?.max) {
      const offsetX = n(target.x) / tile() - n(hitbox.center?.x, n(target.x) / tile());
      const offsetZ = n(target.y) / tile() - n(hitbox.center?.z, n(target.y) / tile());
      return {
        min: { x: hitbox.box.min.x + offsetX, y: hitbox.box.min.y, z: hitbox.box.min.z + offsetZ },
        max: { x: hitbox.box.max.x + offsetX, y: hitbox.box.max.y, z: hitbox.box.max.z + offsetZ },
      }; // Correct a same-frame cached hitbox for actual X/Z movement (a last-second dodge).
    }
    const width = Math.max(.35, n(target.def?.modelWidth, target === deps.player ? .72 : .8));
    const height = Math.max(.55, n(target.halfHeight, target === deps.player ? .58 : width / 2) * 2);
    const foot = Number.isFinite(target.branchSurfaceY) && target.onBranch ? target.branchSurfaceY
      : Number.isFinite(target.climbSurfaceY) && target.climbing ? target.climbSurfaceY
      : surface(target.x, target.y);
    const x = n(target.x) / tile(), z = n(target.y) / tile();
    return { min: { x: x - width / 2, y: foot, z: z - width / 2 },
      max: { x: x + width / 2, y: foot + height, z: z + width / 2 } };
  }
  function bodyCenter(bird, segment) {
    const half = segment.half; // Collision box is transported with the bird's body throughout the dive.
    const lead = Math.min(.28, Math.min(half.x, half.z) * NOSE_LEAD_FRACTION);
    return { x: n(bird.x) / tile() + segment.heading.x * lead,
      y: n(bird.branchSurfaceY, surface(bird.x, bird.y)) + half.y + segment.heading.y * lead,
      z: n(bird.y) / tile() + segment.heading.z * lead };
  }
  function sweptBodyHit(start, end, half, box) {
    // Continuous AABB sweep in world units: a large dt can never tunnel the headfirst body through prey.
    let entry = 0, exit = 1;
    for (const axis of ['x', 'y', 'z']) {
      const delta = end[axis] - start[axis];
      const min = box.min[axis] - half[axis], max = box.max[axis] + half[axis];
      if (Math.abs(delta) < 1e-8) {
        if (start[axis] < min || start[axis] > max) return null;
        continue;
      }
      let a = (min - start[axis]) / delta, b = (max - start[axis]) / delta;
      if (a > b) [a, b] = [b, a];
      entry = Math.max(entry, a);
      exit = Math.min(exit, b);
      if (entry > exit) return null;
    }
    return entry <= 1 && exit >= 0 ? entry : null;
  }
  function canAbductPlayer(bird) {
    const mapId = bird?.tzatzulNestMapId;
    return !!mapId && typeof deps?.enterBuilding === 'function'
      && window.TzatzulNestInterior?.isNestMap?.(mapId) === true
      && deps.getCurrentArea?.() === bird.areaId; // Never abduct the player into a missing cave or via a dev-spawned bird.
  }
  function safeExteriorReturn(prey, record) {
    const pickup = { x: n(record.pickupX, n(prey.x)), y: n(record.pickupY, n(prey.y)) }; // Original capture point is an emergency walkable exit.
    const roost = record.bird?._tzFlight?.roost;
    if (!roost || typeof deps?.canPlayerOccupy !== 'function') return pickup;
    const dx = pickup.x - n(roost.x), dy = pickup.y - n(roost.y);
    const len = Math.max(1, Math.hypot(dx, dy)); // Pick nearest groundward side, not the inaccessible upper spire.
    for (const distanceTiles of [3, 5, 7, 9, 12]) {
      const x = n(roost.x) + dx / len * distanceTiles * tile();
      const y = n(roost.y) + dy / len * distanceTiles * tile();
      if (deps.canPlayerOccupy(x, y)) return { x, y }; // Five probes once on return, not recurring ecology scans.
    }
    return pickup;
  }
  function releaseCaptive(prey, reason) {
    const record = captured.get(prey);
    if (!record) return false;
    captured.delete(prey);
    for (const hook of record.renderHooks || []) {
      if (hook.mesh.onAfterRender === hook.after) hook.mesh.onAfterRender = hook.previous;
    } // Restore only this capture's hooks, preserving other rendering owners.
    const bird = record.bird;
    if (bird?._tzFlight) bird._tzFlight.delivered = false; // Completion is set only by the actual cave transition or victim store.
    if (bird?._tzFlight?.captive === prey) bird._tzFlight.captive = null;
    if (bird) bird.tzatzulCarrying = false;
    const fellFromTalons = reason === 'fled carrying prey' || reason === 'carrier knocked from perch'
      || reason === 'carrier died'; // A killed carrier drops its actual prey; unloaded scenes still use the safe pickup.
    prey.tzatzulCapturedBy = null; // End talon attachment before native fall/knockback runs.
    if (fellFromTalons) window.PerchSupport?.release?.(prey, 'dropped by Tzatzul'); // Existing elevated-perch fall injury and footing, exactly once.
    window.PerchSupport?.forget?.(prey); // Restore native ground movement, never leave a dangling synthetic branch.
    prey.onBranch = null; prey.branchT = 0; prey.branchSurfaceY = 0;
    window.TzatzulLiveVisuals?.restoreCaptive?.(prey); // Repair rotation AFTER the fall can mutate native actor pose.
    if (prey.health > 0) prey.state = record.state; // Death already owns the dying/corpse state; releasing cannot revive its AI.
    if (record.player) {
      prey.vx = 0; prey.vy = 0; // Native cave entry needs a grounded, stationary exterior exit record.
      if (reason === 'returned to roost' && canAbductPlayer(bird)
        && record.nestMapId === bird.tzatzulNestMapId) {
        const landing = safeExteriorReturn(prey, record);
        prey.x = landing.x; prey.y = landing.y;
        try {
          deps.enterBuilding(record.nestMapId, undefined, undefined, 'tzatzul_delivery'); // The game's native async loader owns scene and safe exit.
          stats.nestEntries++;
          if (bird?._tzFlight) bird._tzFlight.delivered = true;
          stats.lastCapture = { event: 'nest-entered', reason, mapId: record.nestMapId, prey: 'player' };
        } catch (error) {
          prey.x = n(record.pickupX); prey.y = n(record.pickupY);
          stats.failedNestEntries++;
          stats.lastCapture = { event: 'entry-failed', reason, prey: 'player', error: String(error) };
          window.__farmLog?.('[tzatzul] Nest entry failed: ' + String(error), 'warn', 'wildlife');
        }
      } else if (!fellFromTalons) {
        prey.x = n(record.pickupX, prey.x); prey.y = n(record.pickupY, prey.y); // Missing carrier/scene uses the known safe pickup location.
      }
    } else if (prey.health > 0 && reason === 'returned to roost' && record.areaId === deps?.getCurrentArea?.()) {
      prey.x = n(record.pickupX, prey.x); prey.y = n(record.pickupY, prey.y);
      const stored = window.TzatzulNestEncounter?.storeVictim?.(prey, bird, record.rendered === true);
      if (bird?._tzFlight) bird._tzFlight.delivered = stored === true; // Never claim unseen or rejected prey reached hatchlings.
    } else if (!record.player && prey.health > 0 && !fellFromTalons) {
      prey.x = n(record.pickupX, prey.x); prey.y = n(record.pickupY, prey.y);
    } // A genuine aerial drop uses its live position; all other interrupted carries use the known safe ground.
    stats.releases++;
    if (!record.player) stats.lastCapture = { event: 'released', reason, prey: prey.creatureKey || prey.name || 'npc' };
    return true;
  }
  function carryCaptive(bird) {
    const prey = bird?._tzFlight?.captive;
    if (!prey) return false;
    if (!(bird.health > 0) || !(prey.health > 0)
      || (prey === deps.player ? deps.getCurrentArea?.() !== bird.areaId : prey.areaId !== bird.areaId)
      || !deps.hostileObjects.has(bird) || captured.get(prey)?.bird !== bird) {
      releaseCaptive(prey, !(bird.health > 0) ? 'carrier died' : 'owner or prey unavailable'); return false;
    }
    if (!bird.onPerch || !window.PerchSupport?.attach?.(prey, bird.onPerch, bird.branchT)) {
      releaseCaptive(prey, 'flight support lost'); return false;
    }
    observeCarry(prey, captured.get(prey));
    prey.tzatzulCapturedBy = bird._tzFlight.identity.id;
    prey.state = 'tzatzul-carried';
    prey.branchSurfaceY = Math.max(surface(prey.x, prey.y) + .1, n(bird.branchSurfaceY) - .46); // Body hangs from authored talon socket below the parent.
    return true;
  }
  function observeCarry(prey, record) {
    if (!record || record.player || record.rendered) return;
    const ref = prey.avatarRef; // Hooks must follow visual promotion of the original live actor.
    if (!ref || prey._wildlifeVisualsReleased) return;
    record.renderHooks ||= [];
    for (const mesh of [ref.frontPlane, ref.backPlane]) {
      if (!mesh || record.renderHooks.some(hook => hook.mesh === mesh)) continue;
      const previous = mesh.onAfterRender; // Respect PNG rendering and diagnostic hooks already on the actor.
      const after = function (...args) {
        previous?.apply(this, args);
        const image = mesh.material?.map?.image; // A blank or still-loading portrait does not prove that the prey was visible.
        if (captured.get(prey) === record && prey.tzatzulCapturedBy && mesh.visible !== false
          && Number(image?.width || image?.naturalWidth) > 0) record.rendered = true;
      };
      mesh.onAfterRender = after;
      record.renderHooks.push({ mesh, previous, after });
    }
  }
  function canCarry(prey) {
    if (prey?.avatarRef?.riderMount) return false; // The rider and a large mount are one visible load, not medium prey.
    const size = String(prey?.genotype?.sizeClass || prey?.sizeClass || prey?.def?.defaultSizeClass || 'medium').toLowerCase();
    return size === 'small' || size === 'medium'; // Attacks can hit large creatures, but talons cannot lift them.
  }
  function capture(bird, prey) {
    const isPlayer = prey === deps?.player; // Only the actual player can use native nest entry, not an arbitrary isPlayer actor.
    if (!prey || (!isPlayer && prey.isPlayer) || !(prey.health > 0)
      || (isPlayer ? !canAbductPlayer(bird) || window.PlayerDowned?.isDowned?.() : !canCarry(prey))
      || prey.tzatzulCapturedBy || captured.has(prey) || !bird?._tzFlight
      || bird._tzFlight.captive || !bird.onPerch) return false;
    const pickupX = n(prey.x), pickupY = n(prey.y); // Capture the original ground position BEFORE native perch attachment moves the prey.
    if (!window.PerchSupport?.attach?.(prey, bird.onPerch, bird.branchT)) return false;
    window.TzatzulLiveVisuals?.rememberCaptive?.(prey); // Snapshot the real player/NPC/animal rotation before the first talon alignment.
    captured.set(prey, { bird, player: isPlayer, nestMapId: bird.tzatzulNestMapId,
      pickupX, pickupY, state: prey.state,
      areaId: isPlayer ? bird.areaId : prey.areaId }); // Preserve original actor identity, clothing and safe exterior return position.
    bird._tzFlight.captive = prey; bird.tzatzulCarrying = true; // Select authored grip pose on real bird.
    if (isPlayer) {
      prey.knockbackT = 0; prey.dodging = false; prey.lunging = false;
      window.KnockbackCollisionImpact?.cancel?.(prey); // A successful grab replaces the attack's original knockback movement.
    }
    prey.tzatzulCapturedBy = bird._tzFlight.identity.id; prey.state = 'tzatzul-carried';
    observeCarry(prey, captured.get(prey));
    stats.captures++;
    stats.lastCapture = { event: 'captured', prey: prey.creatureKey || prey.name || 'npc' };
    mark(bird, 'captured visible prey');
    return true;
  }
  function scoutPosition(area, x, y) {
    const network = window.CliffRouteNetwork?.forArea?.(area); // Use the active area's authored grid dimensions; never scout beyond the map boundary.
    const edge = (coordinate, cells) => Number.isFinite(Number(cells)) && Number(cells) > 4
      ? Math.max(2 * tile(), Math.min((Number(cells) - 2) * tile(), coordinate))
      : Math.max(2 * tile(), coordinate); // Dev/preview worlds without a cliff graph retain their safe lower bound.
    return { x: edge(x, network?.cols), y: edge(y, network?.rows) };
  }
  function seekFood(bird) {
    const state = bird?._tzFlight;
    if (!state || state.captive || state.phase === 'in-nest') return false;
    const nearby = choosePrey(bird);
    if (nearby && swoop(bird, nearby)) return true;
    const distant = choosePrey(bird, TERRITORY_TILES);
    if (distant) {
      const dx = distant.x - bird.x, dy = distant.y - bird.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const approach = Math.max(0, length - 7 * tile()); // Fly to a staging point above prey, then dive.
      const position = scoutPosition(bird.areaId,
        bird.x + dx / length * approach, bird.y + dy / length * approach); // Map boundaries constrain pursuit waypoints, too.
      if (startLeg(bird, { ...position, worldY: Math.max(n(state.roost?.worldY), surface(position.x, position.y) + 5) }, 'search', distant)) {
        stats.scouts++; return true;
      }
    }
    const index = state.scoutIndex++; // Stable golden-angle circuits sample new hunting ground after each empty leg.
    const angle = index * 2.399963229728653; // Separates successive scouting spokes.
    const radius = SCOUT_RADIUS_TILES * (.65 + index % 3 * .2);
    const position = scoutPosition(bird.areaId,
      n(state.roost.x) + Math.cos(angle) * radius * tile(),
      n(state.roost.y) + Math.sin(angle) * radius * tile());
    if (startLeg(bird, { ...position,
      worldY: Math.max(n(state.roost.worldY), surface(position.x, position.y) + 5) }, 'search')) {
      stats.scouts++; return true;
    }
    return false;
  }
  function terrainFlightProfile(start, end, half) {
    if (typeof deps?.worldSurfaceY !== 'function') return null;
    const horizontalTiles = distance(start, end) / tile(); // Measure actual horizontal path, including elevated cliffs.
    const count = Math.max(1, Math.min(240, Math.ceil(horizontalTiles / TERRAIN_SAMPLE_TILES)));
    const samples = Array.from({ length: count + 1 }, (_, index) => {
      const fraction = index / count;
      return surface(start.x + (end.x - start.x) * fraction, start.y + (end.y - start.y) * fraction);
    }); // Bounded single planning pass, never a per-frame scene traversal.
    return { samples, count, horizontalTiles, clearance: Math.max(TERRAIN_CLEARANCE_WORLD, half.y + .65) };
  }
  function flightHeightAt(leg, fraction) {
    const t = Math.max(0, Math.min(1, fraction));
    const linear = leg.from.worldY + (leg.to.worldY - leg.from.worldY) * t;
    const profile = leg.terrain;
    if (!profile) return linear; // Indoor boss uses native cave obstruction collisions.
    const index = Math.min(profile.count, Math.floor(t * profile.count));
    const ahead = Math.max(1, Math.ceil(2.5 * profile.count / Math.max(1, profile.horizontalTiles)));
    let highest = -Infinity;
    for (let sample = Math.max(0, index - 1); sample <= Math.min(profile.count, index + ahead); sample++) {
      highest = Math.max(highest, profile.samples[sample]); // Climb BEFORE reaching a plateau wall.
    }
    const remainingTiles = (1 - t) * profile.horizontalTiles;
    const descent = leg.mode === 'swoop' ? Math.min(1, remainingTiles / 1.2) : 1;
    return Math.max(linear, highest + profile.clearance * descent); // Last strike can descend to actual ground-level prey.
  }
  function startLeg(bird, endpoint, phase, target = null) {
    const state = bird._tzFlight, perch = window.PerchSupport;
    if (!state || !perch) return false;
    const start = { x: n(bird.x), y: n(bird.y),
      worldY: bird.onBranch || bird.onPerch ? n(bird.branchSurfaceY, surface(bird.x, bird.y)) : surface(bird.x, bird.y) };
    const end = { x: n(endpoint.x), y: n(endpoint.y), worldY: n(endpoint.worldY, start.worldY) };
    const support = perch.line('tzatzul:flight:' + ++flightSerial + ':' + state.identity.id, start, end);
    if (!perch.attach(bird, support, 0)) return false;
    const horizontal = Math.hypot(end.x - start.x, end.y - start.y) / tile();
    const vertical = end.worldY - start.worldY;
    const length = Math.max(1e-6, Math.hypot(horizontal, vertical));
    const heading = { x: (end.x - start.x) / (tile() * length), y: vertical / length,
      z: (end.y - start.y) / (tile() * length) }; // 3D beak-first facing follows the dive, not the talon pose.
    const half = hitboxSize(bird); // Freeze body dimensions for this leg; no expensive mesh reads each frame.
    state.segment = { duration: Math.max(.55, Math.min(5, distance(start, end) / (tile() * SPEED_TILES_PER_SECOND))),
      half, heading, from: start, to: end, mode: phase,
      terrain: bird._tzNestMother ? null : terrainFlightProfile(start, end, half),
      diveAimFraction: endpoint.diveAimFraction || 1, lastBody: null }; // World-space travel powers cave wall impact's unused-distance calculation.
    state.segment.lastBody = bodyCenter(bird, state.segment); // Swept-body starting frame includes elevated roost height.
    state.elapsed = 0; state.phase = phase; state.target = target; state.struck = false;
    bird.tzatzulDivePitchRad = phase === 'swoop' ? Math.atan2(vertical, horizontal) : 0; // Rig pitches with the nose-first body on descent.
    bird.tzatzulFlightPose = 'flap';
    bird.state = 'idle'; // Avoid an additional ground-pathfinding owner for aerial movement.
    bird.facing = Math.atan2(end.y - start.y, end.x - start.x);
    stats.flights++;
    mark(bird, phase);
    return true;
  }
  function swoop(bird, target) {
    if (!target || !(target.health > 0)) return false;
    const box = targetBox(target); // Aim once at the prey's BODY, including its real elevation and size.
    const half = hitboxSize(bird);
    const aim = Math.max(box.min.y, (box.min.y + box.max.y) / 2 - half.y);
    const endpoint = { x: target.x, y: target.y, worldY: aim }; // Outdoor dives stop at prey; arena dives commit through to the far wall.
    if (bird._tzNestMother) {
      const plan = window.TzatzulNestInterior?.getArena?.(bird.areaId);
      const dx = n(target.x) - n(bird.x), dy = n(target.y) - n(bird.y);
      const length = Math.hypot(dx, dy); // A zero-distance target keeps the ordinary safe endpoint.
      if (plan && length > 1) {
        const travel = (Math.max(3, n(plan.arenaRadiusTiles, 10)) * 2 + 4) * tile();
        endpoint.x = bird.x + dx / length * travel; endpoint.y = bird.y + dy / length * travel;
        // The descent reaches prey height at the committed target, then levels off.
        endpoint.diveAimFraction = Math.min(1, length / travel);
      }
    }
    const ok = startLeg(bird, endpoint, 'swoop', target);
    if (ok) stats.swoops++;
    return ok;
  }
  function returnHome(bird) {
    const state = bird._tzFlight;
    return startLeg(bird, state.roost, 'return');
  }
  function hit(bird, previous, current) {
    const state = bird._tzFlight;
    if (state.struck) return false;
    const target = state.target;
    if (!(target?.health > 0) || target.areaId && target.areaId !== bird.areaId
      || target.creatureKey === 'tzatzul' || target.creatureKey === 'tzatzul-hatchling'
      || target._denHidden || target.state === 'dying') return false;
    const entry = sweptBodyHit(previous, current, state.segment.half, targetBox(target));
    if (entry === null) return false; // No pre-timed hit: only actual 3D torso/body overlap can deal damage.
    state.struck = true; // One collision/attack per committed swoop, even across long frames.
    const combat = window.Combat?.deps;
    const beforeHealth = target.health; // Invulnerability/dodge rejection must also reject talon capture.
    const damage = Math.max(1, n(bird.def?.attackDamage, 24));
    const opts = { attacker: bird, tag: 'sharp', aerialSwoop: true, impactCollider: 'body' };
    let applied = false;
    if (target === deps.player && typeof combat?.damagePlayer === 'function') {
      combat.damagePlayer(damage, bird.x, bird.y, bird._tzNestMother ? 250 : 75, opts); applied = true; // Cave boss blasts the player across the arena; the existing wall knockback path owns any secondary collision.
    } else if (typeof combat?.damageCreature === 'function') {
      combat.damageCreature(target, damage, bird.x, bird.y, 75, opts); applied = true;
    } else if (target !== deps.player && window.WildlifeSpawn?.applyWildlifeSkirmishDamage) {
      window.WildlifeSpawn.applyWildlifeSkirmishDamage(bird, target, damage); applied = true;
    }
    stats.lastBodyContact = { at: Date.now(), id: state.identity.id,
      target: target === deps.player ? 'player' : target.creatureKey || 'creature',
      sweptFraction: +entry.toFixed(3), phase: state.phase, collider: 'body' };
    if (applied) { stats.hits++; mark(bird, 'headfirst body dive hit');
      if (!bird._tzNestMother && target.health > 0 && target.health < beforeHealth) capture(bird, target); } // Exterior birds abduct; boss mother attacks without restarting the cave transition.
    else { stats.misses++; mark(bird, 'body contact (damage unavailable)'); }
    return applied;
  }
  function advance(bird, dt) {
    const state = bird._tzFlight;
    if (!state.segment) return;
    state.elapsed = Math.min(state.segment.duration, state.elapsed + dt);
    const t = Math.max(0, Math.min(1, state.elapsed / state.segment.duration));
    bird.branchT = t;
    window.PerchSupport?.constrain?.(bird); // Reuses native onBranch and branchSurfaceY movement/portrait height.
    if (!bird._tzNestMother) bird.branchSurfaceY = flightHeightAt(state.segment, t); // Avoid straight-line tunnelling through plateau rock.
    if (state.phase === 'swoop' && state.segment.diveAimFraction < 1) {
      const leg = state.segment; // Follow the frozen descending line to prey height, then continue level toward the far wall.
      const descent = Math.min(1, t / leg.diveAimFraction);
      bird.branchSurfaceY = leg.from.worldY + (leg.to.worldY - leg.from.worldY) * descent;
    }
    carryCaptive(bird); // Prey uses the same elevated support as the flying body.
    bird.tzatzulFlightPose = t < .15 || t > .85 ? 'flap' : 'glide';
    if (state.phase === 'swoop') {
      const previous = state.segment.lastBody;
      const current = bodyCenter(bird, state.segment);
      state.segment.lastBody = current;
      const contactedPrey = hit(bird, previous, current); // The complete torso is swept from last frame to this frame; no talon point or fixed attack timestamp.
      if (contactedPrey && bird._tzNestMother) { returnHome(bird); return; } // Continue toward the opposite perch immediately after body contact.
      if (!state.struck && bird._tzNestMother
        && window.TzatzulNestEncounter?.resolveTerrainImpact?.(bird,previous,current,state.segment)) {
        state.struck = true; // Missed a player but hit a cave obstacle; never resolve another impact on this leg.
        returnHome(bird); return; // Follow through to the opposite rock perch with genuine injury.
      }
    }
    if (t < 1) return;
    if (state.phase === 'swoop' && !state.struck) {
      state.struck = true; stats.misses++; mark(bird, 'body missed committed dive');
    }
    state.segment = null;
    if (state.phase === 'swoop') { if (state.captive) returnHome(bird); else seekFood(bird); return; }
    if (state.phase === 'search') { seekFood(bird); return; }
    if (state.phase === 'return') {
      const arrived = !!window.PerchSupport?.attach?.(bird, state.roost);
      if (state.captive) releaseCaptive(state.captive, arrived ? 'returned to roost' : 'roost lost');
      state.phase = arrived ? 'perched' : 'await-roost';
      state.elapsed = 0; state.rest = 0; state.target = null;
      bird.tzatzulFlightPose = arrived ? 'perched' : 'glide';
      if (arrived) {
        bird.tzatzulDivePitchRad = 0;
        if (state.delivered || state.retreating) { state.delivered = false; enterNest(bird); }
        else seekFood(bird); // An unseen/rejected victim doesn't feed the hatchlings.
      } else mark(bird, 'lost roost; released prey and awaiting replacement');
    }
  }
  let lastArea = null; // Changed-zone detection disposes only old spire scene roots.
  function update(dt) {
    if (!deps?.hostileObjects) return;
    const step = Math.max(0, Math.min(.1, n(dt))); // Mobile tab resume cannot skip several seconds of flight.
    const area = deps.getCurrentArea?.();
    if (area !== lastArea) {
      window.TzatzulCliffSites?.releaseInactive?.(area);
      lastArea = area;
    }
    for (const bird of actors) {
      if (!deps.hostileObjects.has(bird) || !(bird.health > 0)) {
        if (bird._tzFlight?.captive) releaseCaptive(bird._tzFlight.captive,
          !(bird.health > 0) ? 'carrier died' : 'owner or prey unavailable');
        actors.delete(bird); window.TzatzulLiveVisuals?.release?.(bird, 'dead or unloaded'); continue;
      }
      if (bird.areaId !== area) {
        if (bird._tzFlight?.captive) releaseCaptive(bird._tzFlight.captive, 'area transition');
        continue; // No physics or path scanning on inactive maps.
      }
      const state = bird._tzFlight;
      if (!state) continue;
      if (state.phase === 'in-nest') {
        const now = clockHours(); // Thirty in-game minutes still elapse during a cave visit or clock skip.
        if (state.nestUntil === null ? (state.nestFallbackS -= step) > 0 : now === null || now < state.nestUntil) continue;
        leaveNest(bird);
      }
      const wounded = bird.health <= n(bird.maxHealth, 1) * .3;
      if (wounded && !state.retreating) {
        state.retreating = true; stats.retreats++;
        if (state.captive) { releaseCaptive(state.captive, 'fled carrying prey'); stats.fleeDrops++; }
        if (bird.onPerch && state.phase !== 'perched') returnHome(bird); // Retreat begins at the same health threshold as the old bird AI.
      }
      if (!bird.onPerch || bird.prone || (bird.knockbackT > 0 && !state.captive)) {
        if (state.captive) releaseCaptive(state.captive, 'carrier knocked from perch');
        state.phase = 'await-roost';
        continue;
      }
      if (state.phase === 'await-roost') continue;
      if (state.phase !== 'perched') { advance(bird, step); continue; }
      state.elapsed += step;
      if (state.elapsed < state.rest) continue;
      if (wounded) { enterNest(bird); continue; } // Flee to shelter instead of renewing the attack.
      state.retreating = false;
      if (!seekFood(bird)) { state.elapsed = 0; state.rest = REST_SECONDS; }
    }
  }
  function onDayAdvance() {
    const living = new Set([...actors].filter(c => c.health > 0).map(c => c._tzFlight?.roostId));
    for (const key of spawnedThisDay) if (!living.has(key)) spawnedThisDay.delete(key);
  }
  function debugSnapshot() {
    const now = clockHours(); // Mobile diagnostics show the real remaining cave time, not a frame-count estimate.
    return { ...stats, active: actors.size, populationKeys: spawnedThisDay.size,
      roosts: (window.TzatzulCliffSites?.snapshot?.().areas || []).map(({ area, count }) => ({ area, count })), // The mobile panel counts real spires, not abandoned reachable-balcony entries.
      birds: [...actors].map(c => ({ id: c._tzFlight?.identity?.id, area: c.areaId,
        phase: c._tzFlight?.phase, pose: c.tzatzulFlightPose,
        nestMinutesLeft: c._tzFlight?.phase === 'in-nest' && now !== null
          && Number.isFinite(c._tzFlight.nestUntil) ? Math.max(0, Math.ceil((c._tzFlight.nestUntil - now) * 60)) : null,
        target: c._tzFlight?.target === deps.player ? 'player' : c._tzFlight?.target?.creatureKey || null,
        captive: c._tzFlight?.captive?.creatureKey || null })) };
  }
  window.TzatzulFlightRuntime = Object.freeze({
    init, ensureZone, update, onDayAdvance, debugSnapshot,
    owns: bird => !!(actors.has(bird) || window.TzatzulNestEncounter?.owns?.(bird)) && !!bird._tzFlight && bird.health > 0 && !!bird.onPerch && !bird.prone && (!(bird.knockbackT > 0) || (bird._tzFlight.captive && bird.health > n(bird.maxHealth, 1) * .3)), // Indoor mothers share the canonical flight/body owner; no competing ground movement.
    resistsCarryKnockback: bird => !!bird?._tzFlight?.captive && bird.health > n(bird.maxHealth, 1) * .3 && !bird.prone, // Small hits do not drop a carried victim until the bird flees.
    sweptBodyHit, // Nest obstacles use the exact same continuous body sweep as prey contact.
    returnToRoost: returnHome, // Recovery uses the normal flight path after a genuine perch knock-off.
    beginNestDive: (bird,target) => bird?._tzNestMother === true && swoop(bird,target),
    advanceNestFlight: (bird,dt) => bird?._tzNestMother === true && advance(bird,Math.max(0,Math.min(.1,n(dt)))),
    __test: Object.freeze({ roosts, choosePrey, seekFood, swoop, returnHome, capture, carryCaptive, releaseCaptive, terrainFlightProfile, flightHeightAt }),
  });
})();