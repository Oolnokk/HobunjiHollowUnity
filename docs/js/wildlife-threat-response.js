// Shared, throttled threat reactions: maternal nest defense, open-air herd
// self-defense, and predator/prey pursuit. WildlifeFoodWeb delegates to these
// decisions; the original game update still owns collision, combat and motion.
(() => {
  'use strict';
  if (window.WildlifeThreatResponse) return;

  const HERD_SPECIES = new Set(['moot', 'voorg-ass']); // Only wild northern roaming herds use the close-approach and predator panic rules.
  const PREDATOR_SIGHT_TILES = 12; // Wild adults notice an approaching predator before its melee reach.
  const PREDATOR_SCAN_S = 0.22; // Each herd member checks the existing actor roster at about 4.5 Hz, staggered.
  const PANIC_GRACE_MS = 1650; // A fleeing herd keeps running briefly after the predator disappears behind cover.
  const PANIC_SPEED_TILES_S = 9.5; // Fast escape uses the existing moveCreatureToward terrain/collision path.
  const THREAT_APPROACH_TILES = Object.freeze({ moot: 3.1, 'voorg-ass': 2.45 }); // Moot faces a visitor; Voorg-Ass turns its back to deliver a kick.
  const THREAT_RELEASE_TILES = 5.5; // Approachers who retreat this far no longer trigger an endless pursuit.
  const NEST_DEFENSE_TILES = 11; // Every nearby adult of the stolen species hears/sees a nest being raided.
  const NEST_DEFENSE_MS = 14000; // Temporary defensive hostility, restored when the intruder leaves or time expires.
  const PREDATOR_PURSUIT_SPEED_TILES_S = 10.2; // Hunting predators are slightly faster than panicked 9.5-tile/s prey, so pursuit remains dangerous.
  const WILDLIFE_FLIGHT_SPEED_TILES_S = 8.8; // Injured wildlife sprints instead of slowly walking home while pursued.
  const POST_KICK_ESCAPE_MS = 2300; // A Voorg-Ass runs away from its kicker's target after the rear-kick pose finishes.
  const debug = { panic: 0, approaches: 0, postKickEscapes: 0, nestAlerts: 0, nestDefenders: 0, predatorSprints: 0, preySprints: 0, last: '' }; // Lightweight wildlife panel/console-free diagnostics.

  const nowMs = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  function speciesOf(entity) {
    const raw = String(window.CreatureGenetics?.SPECIES_ALIAS?.[entity?.creatureKey] || entity?.creatureKey || entity?.kind || '');
    return raw.replace(/-(?:den-mother|herd-mother)$/, '').replace(/-wild$/, '');
  }
  function herdSpecies(entity) { const kind = speciesOf(entity); return HERD_SPECIES.has(kind) ? kind : null; }
  function isPredator(entity) {
    if (!entity || entity.isBandit || entity.health <= 0 ||
        entity._denHidden || entity._deathTransitionStarted || entity.wildlifeRole === 'prey' || herdSpecies(entity)) return false;
    const def = entity.def || {};
    return entity.wildlifeRole === 'predator' ||
      !!window.WildlifeFoodWeb?.profile?.(entity)?.hunts?.length ||
      def.diet === 'carnivore' || def.diet === 'predator' ||
      (def.hostile === true && def.diet !== 'herbivore' && def.diet !== 'prey');
  }
  function herdState(c) {
    return c._herdThreat || (c._herdThreat = {
      nextScanS: (Math.abs((Number(c.x) || 0) + (Number(c.y) || 0)) % 7) * PREDATOR_SCAN_S / 7,
      predatorX: 0, predatorY: 0, panicUntilMs: 0, engaged: false, engagedAtMs: 0,
      kickArmed: false, kickThreatX: 0, kickThreatY: 0,
    }); // Per-animal scan phase and short-lived panic/approach state; no per-frame allocated maps.
  }
  function closestPredator(c, actors, tile) {
    const maxD2 = (PREDATOR_SIGHT_TILES * tile) ** 2;
    let nearest = null, distanceSq = maxD2;
    for (const other of actors || []) {
      if (other === c || other.areaId !== c.areaId || !isPredator(other)) continue;
      const dx = c.x - other.x, dy = c.y - other.y, d2 = dx * dx + dy * dy;
      if (d2 < distanceSq) { nearest = other; distanceSq = d2; }
    }
    return nearest;
  }
  function beginPanic(c, state, predator, tile) {
    if (c.state !== 'herd-panic') {
      window.Combat?.animalAttacks?.cancel?.(c); // A predator sighting interrupts even a telegraphed kick/charge.
      window.Combat?.telegraph?.cancel?.(c);
      c._animalSleeping = false; c.scaleY = 1;
      c.state = 'herd-panic';
      c.targetPlayer = null; c.targetCreature = null;
      c._voorgRearKickThreat = null;
      state.engaged = false;
      state.kickArmed = false; // Predator panic replaces, rather than queues, the visitor's defensive rear kick.
      debug.panic++;
      debug.last = speciesOf(c) + ' fled ' + speciesOf(predator);
      window.__farmLog?.('[wildlife-threat] ' + debug.last, 'wildlife');
    }
    state.predatorX = predator.x; state.predatorY = predator.y;
    state.panicUntilMs = nowMs() + PANIC_GRACE_MS;
  }
  function restoreNestDefense(c) {
    const defense = c._nestDefense; // Restores the shared species definition and home after a temporary nest response.
    if (!defense) return;
    c.def = defense.originalDef;
    c.homeX = defense.originalHomeX; c.homeY = defense.originalHomeY;
    c._nestDefense = null;
    if (c.state === 'chase' || c.state === 'searching' || c.state === 'patrol-chase') {
      c.state = 'return'; c.targetPlayer = null; c.targetCreature = null;
    }
  }
  function updateNestDefense(c) {
    const defense = c._nestDefense;
    if (!defense) return false;
    if (c.health <= 0 || c.areaId !== defense.areaId || !defense.target || defense.target.health <= 0 ||
        nowMs() >= defense.expiresAt ||
        Math.hypot(c.x - defense.target.x, c.y - defense.target.y) > defense.releasePx) {
      restoreNestDefense(c);
      return false;
    }
    if (c.state !== 'herd-panic' && c.state !== 'fleeing-low-health' && !c.prone && !(c.knockbackT > 0)) {
      c.state = 'chase'; c.targetPlayer = defense.target; c.targetCreature = null;
    }
    return true;
  }
  function speedUpWildMovement(c, tile) {
    const predator = isPredator(c);
    const pursuing = predator && (c.state === 'chase' ||
      (c.state === 'patrol-chase' && c.targetCreature?.health > 0 && c.targetCreature.areaId === c.areaId));
    const fleeing = c.state === 'fleeing-low-health';
    const speed = fleeing ? WILDLIFE_FLIGHT_SPEED_TILES_S
      : pursuing ? PREDATOR_PURSUIT_SPEED_TILES_S : 0; // Ordinary grazing/patrolling and resting remain at authored speeds.
    if (speed > 0 && !c._wildPursuitOriginalDef) {
      c._wildPursuitOriginalDef = c.def; // Nonpersistent actor overlay: restores authored move/chase values after the sprint.
      c.def = { ...c.def, chaseSpeed: Math.max(Number(c.def?.chaseSpeed) || 0, tile * speed) };
      if (predator) debug.predatorSprints++;
      else debug.preySprints++;
    } else if (!speed && c._wildPursuitOriginalDef) {
      c.def = c._wildPursuitOriginalDef;
      c._wildPursuitOriginalDef = null;
    }
  }
  function update(c, dt, actors, players, ctx) {
    if (!c || c.health <= 0 || c.isCompanion || !ctx?.tile) return;
    const kind = herdSpecies(c);
    if (!kind) {
      if (!c._nestDefense) speedUpWildMovement(c, ctx.tile); // Temporary maternal stat changes never nest under movement speed overlays.
      else if (c._wildPursuitOriginalDef) {
        c.def = c._wildPursuitOriginalDef;
        c._wildPursuitOriginalDef = null;
      }
      updateNestDefense(c);
      return;
    }
    const state = herdState(c);
    if (kind === 'voorg-ass' && c._voorgRearKickThreat) {
      state.kickArmed = true; // Capture the attacker before rearKick.finish clears its combat target.
      state.kickThreatX = c._voorgRearKickThreat.x;
      state.kickThreatY = c._voorgRearKickThreat.y;
    }
    state.nextScanS -= Math.max(0, Number(dt) || 0);
    if (state.nextScanS <= 0) {
      state.nextScanS = PREDATOR_SCAN_S;
      const predator = closestPredator(c, actors, ctx.tile);
      if (predator) beginPanic(c, state, predator, ctx.tile);
    }
    if (kind === 'voorg-ass' && c.state === 'fleeing-low-health' && c._voorgRearKickSpent && state.kickArmed) {
      state.kickArmed = false;
      state.engaged = false;
      state.predatorX = state.kickThreatX; state.predatorY = state.kickThreatY;
      state.panicUntilMs = nowMs() + POST_KICK_ESCAPE_MS;
      c.state = 'herd-panic'; // Reuse collision-safe high-speed away movement, rather than retreating toward a possibly dangerous home tile.
      c.targetPlayer = null; c.targetCreature = null;
      debug.postKickEscapes++;
      debug.last = 'voorg-ass fled after rear kick';
      window.__farmLog?.('[wildlife-threat] ' + debug.last, 'wildlife');
    }
    if (c.state === 'herd-panic') {
      if (nowMs() < state.panicUntilMs) return;
      c.state = 'return'; // Ordinary herd movement takes over after the danger has passed.
      c._fleeCooldownUntil = nowMs() + 1400;
      c._voorgRearKickSpent = false;
      return;
    }
    if (updateNestDefense(c)) return; // Maternal defense outranks ordinary visitor wariness, but never predator flight.
    if (c._denHidden || c.prone || c.knockbackT > 0 || c.state === 'fleeing-low-health' ||
        c.state === 'return' || c._fleeCooldownUntil > nowMs()) return;

    const target = (players || []).find(p => p && p.health > 0 && (!p.areaId || p.areaId === c.areaId) &&
      Math.hypot(p.x - c.x, p.y - c.y) <= THREAT_APPROACH_TILES[kind] * ctx.tile);
    if (state.engaged) {
      const old = c.targetPlayer;
      if (c.state !== 'chase' || !old || old.health <= 0 ||
          nowMs() - state.engagedAtMs > 7500 ||
          Math.hypot(old.x - c.x, old.y - c.y) > THREAT_RELEASE_TILES * ctx.tile) {
        state.engaged = false;
        if (c.state === 'chase') { c.state = 'return'; c.targetPlayer = null; }
      }
      return;
    }
    if (!target || (kind === 'voorg-ass' && c._voorgRearKickSpent)) return;
    c._animalSleeping = false; c.scaleY = 1;
    state.engaged = true; state.engagedAtMs = nowMs();
    c.state = 'chase'; c.targetPlayer = target; c.targetCreature = null;
    if (kind === 'voorg-ass') c._voorgRearKickThreat = target; // The existing rear-kick finish transitions directly into flight.
    c.attackCooldownT = 0;
    debug.approaches++;
    debug.last = kind + (kind === 'moot' ? ' charged approaching player' : ' prepared defensive rear kick');
    window.__farmLog?.('[wildlife-threat] ' + debug.last, 'wildlife');
  }
  function tickPanic(c, dt, ctx) {
    if (c?.state !== 'herd-panic' || !herdSpecies(c)) return null;
    const state = herdState(c), tile = ctx.tile;
    const awayAngle = Math.atan2(c.y - state.predatorY, c.x - state.predatorX); // Run directly away from the last seen predator, not toward the herd's sleeping tile.
    const directions = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI]; // Nearby fallback bearings avoid running straight into a cliff or map edge.
    let moving = false, angle = awayAngle;
    for (const offset of directions) {
      angle = awayAngle + offset;
      const vx = Math.cos(angle), vy = Math.sin(angle); // One bearing drives both the nearby terrain check and the distant escape goal.
      const x = c.x + vx * tile * 3, y = c.y + vy * tile * 3;
      if (ctx.canOccupyAt && !ctx.canOccupyAt(c.x + vx * tile * 0.7, c.y + vy * tile * 0.7, tile * 0.32)) continue; // Check the first step, not a remote tile that may be blocked beyond reachable open ground.
      moving = !!ctx.moveCreatureToward?.(c, x, y, Math.max(tile * PANIC_SPEED_TILES_S, Number(c.def?.chaseSpeed) || 0), dt);
      if (moving) break;
    }
    return { handled: true, moving, aimAngle: moving ? angle : (c.facing || 0) };
  }
  function onNestStolen(event) {
    if (!event || event.type !== 'nest_stolen') return 0;
    const combat = window.Combat?.deps, target = combat?.player;
    const species = speciesOf({ creatureKey: event.speciesKind ||
      window.SCRATCHBONES_CONFIG?.game?.livestock?.itemKinds?.[event.itemKey] });
    if (!species || !target || !combat?.hostileObjects || !combat.TILE) return 0;
    const area = event.areaId || target.areaId;
    const nestX = Number.isFinite(event.x) ? event.x : target.x;
    const nestY = Number.isFinite(event.y) ? event.y : target.y;
    let awakened = 0;
    for (const c of combat.hostileObjects) {
      if (!c || c.health <= 0 || c.isCompanion || c.areaId !== area ||
          speciesOf(c) !== species || (c._nestDefense?.originalDef || c.def)?.hostile !== false ||
          c.genotype?.sizeClass === 'small' || c.isBaby || c.isJuvenile ||
          Math.hypot(c.x - nestX, c.y - nestY) > NEST_DEFENSE_TILES * combat.TILE) continue;
      if (c._wildPursuitOriginalDef) {
        c.def = c._wildPursuitOriginalDef;
        c._wildPursuitOriginalDef = null; // Remove any prior fleeing-speed overlay before storing the maternal baseline.
      }
      const prior = c._nestDefense; // Repeated theft extends the same encounter without nesting temporary definition overlays.
      c._nestDefense = {
        originalDef: prior?.originalDef || c.def,
        originalHomeX: prior?.originalHomeX ?? c.homeX,
        originalHomeY: prior?.originalHomeY ?? c.homeY,
        target, areaId: area, expiresAt: nowMs() + NEST_DEFENSE_MS,
        releasePx: NEST_DEFENSE_TILES * combat.TILE * 1.5,
      };
      c.def = {
        ...c.def, hostile: true,
        chaseSpeed: Math.max(Number(c.def?.chaseSpeed) || 0, combat.TILE * 7),
        aggroRangePx: combat.TILE * NEST_DEFENSE_TILES,
        leashRangePx: combat.TILE * NEST_DEFENSE_TILES * 1.5,
        attackRangePx: Math.max(Number(c.def?.attackRangePx) || 0, combat.TILE * 1.1),
        attackDamage: Math.max(Number(c.def?.attackDamage) || 0, 10),
        attackStaminaCost: Math.max(1, Number(c.def?.attackStaminaCost) || 8),
        attackCooldownS: Number(c.def?.attackCooldownS) || 1.2,
        attackTag: c.def?.attackTag || 'blunt',
        attacks: c.def?.attacks?.length ? c.def.attacks : ['guardCharge'],
        guardChargeDamage: Math.max(Number(c.def?.guardChargeDamage) || 0, 10),
      };
      c.homeX = nestX; c.homeY = nestY;
      c._animalSleeping = false; c._denHidden = false; c.scaleY = 1;
      if (c.avatarRef?.group) c.avatarRef.group.visible = true;
      c.state = 'chase'; c.targetPlayer = target; c.targetCreature = null; c.attackCooldownT = 0;
      awakened++;
    }
    if (awakened) {
      debug.nestAlerts++; debug.nestDefenders += awakened;
      debug.last = species + ' nest theft alerted ' + awakened + ' adults';
      window.__farmLog?.('[wildlife-threat] ' + debug.last, 'wildlife');
    }
    return awakened;
  }
  window.HobunjiActivityEvents?.on?.(onNestStolen); // Subscribe once, rather than searching for nest theft on every wildlife frame.
  window.WildlifeThreatResponse = Object.freeze({
    update, tickPanic, onNestStolen, isPredator, speciesOf,
    getDebug: () => ({ ...debug }),
    tuning: Object.freeze({ PREDATOR_SIGHT_TILES, PANIC_SPEED_TILES_S, NEST_DEFENSE_TILES, NEST_DEFENSE_MS }),
  });
})();
