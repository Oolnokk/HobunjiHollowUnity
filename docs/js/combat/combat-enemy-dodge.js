// Enemy dodge reactions and outfit-weight combat integration.
(() => {
  'use strict';

  if (Number(window.EnemyDodge?.version) >= 1 || !window.BanditCombat) return;

  const VERSION = 1;
  const DEFAULTS = Object.freeze({
    chanceByRank: Object.freeze({ grunt: 0.34, lieutenant: 0.52, captain: 0.70 }),
    reactionDelayS: 0.055,
    cooldownS: 1.15,
    staminaCost: 18,
    speedPxS: 600,
    durationS: 0.22,
    iframeMs: 380,
    lungeThreatFraction: 0.72,
    reachPaddingTiles: 0.18,
  });

  let deps = null; // Captured from BanditCombat.init and used by swept movement, stamina, and deterministic AI rolls.
  let tuning = { ...DEFAULTS, chanceByRank: { ...DEFAULTS.chanceByRank } }; // Mutable authored dodge tuning replaced atomically by attack-values.json.
  let lastEvent = null; // Latest dodge decision exposed in-page for mobile testing without DevTools.
  let dodgeCount = 0; // Session counter used by diagnostics to confirm enemies are actually reacting.

  const originalInit = window.BanditCombat.init.bind(window.BanditCombat); // Preserves the existing combat dependency initialization.
  const originalMakeEntity = window.BanditCombat.makeEntity.bind(window.BanditCombat); // Preserves roster/avatar/stat construction beneath outfit profiling.
  const originalUpdateCombatAI = window.BanditCombat.updateCombatAI.bind(window.BanditCombat); // Preserves the existing melee/ranged behavior beneath dodge interception.

  function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }

  function signedAngleDelta(target, current) {
    let delta = (Number(target) || 0) - (Number(current) || 0); // Normalized below for stable cone checks around the ±PI seam.
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  function applyConfig(config = {}) {
    const next = { ...tuning, chanceByRank: { ...tuning.chanceByRank } }; // Keeps readers from observing a partially applied config.
    for (const key of ['reactionDelayS', 'cooldownS', 'staminaCost', 'speedPxS', 'durationS', 'iframeMs', 'lungeThreatFraction', 'reachPaddingTiles']) {
      const value = Number(config[key]); // Candidate authored number validated before it can replace a safe fallback.
      if (Number.isFinite(value) && value >= 0) next[key] = value;
    }
    for (const rank of ['grunt', 'lieutenant', 'captain']) {
      const value = Number(config.chanceByRank?.[rank]); // Rank-specific reaction chance preserves the intended gang hierarchy.
      if (Number.isFinite(value)) next.chanceByRank[rank] = clamp01(value);
    }
    tuning = next;
  }

  function profileOutfit(entity) {
    const clothing = window.ClothingWeavingSystem; // Shared authority for player and NPC weight/unit tradeoffs.
    const items = clothing?.outfitItemsFromRoster?.(entity?.rosterRecord) || []; // NPC cosmetics translated into ordinary clothing descriptors.
    const existingWeight = Number(entity?.outfitWeightUnits); // Explicit caller override remains valid for authored/test combatants.
    const weight = Number.isFinite(existingWeight) && existingWeight >= 0
      ? existingWeight
      : (clothing?.totalOutfitWeight?.(items) || 0);
    entity.outfitWeightUnits = weight;
    entity._usesOutfitWeight = true;
    entity.outfitArmorStats = clothing?.armorStats?.(weight) || {
      weightUnits: weight,
      damageTakenMul: 1,
      footingTakenMul: 1,
      dodgeEfficacy: 1,
      combatMoveMul: 1,
    };
    entity._enemyDodgeCooldownT = Math.max(0, Number(entity._enemyDodgeCooldownT) || 0);
    return entity.outfitArmorStats;
  }

  function armorStats(entity) {
    return window.ClothingWeavingSystem?.armorStatsForEntity?.(entity)
      || entity?.outfitArmorStats
      || profileOutfit(entity);
  }

  function combatMoveMultiplier(entity) {
    return Math.max(0, Number(armorStats(entity)?.combatMoveMul) || 1);
  }

  function threatStatus(entity, threat) {
    const attacker = threat?.attacker;
    if (!entity || !attacker || entity.health <= 0) return { exposed: false, reason: 'no-threat' };
    const dx = entity.x - attacker.x; // Horizontal threat vector used for range and bearing.
    const dy = entity.y - attacker.y; // Horizontal threat vector used for range and bearing.
    const distancePx = Math.hypot(dx, dy);
    const yaw = Number.isFinite(Number(threat.yaw)) ? Number(threat.yaw) : (Number(attacker.angle) || 0); // Windup-locked attack direction.
    const angleToEnemy = Math.atan2(dy, dx); // Enemy bearing compared with the authored attack cone.
    const reachPx = Math.max(0, Number(threat.rangePx) || 0)
      + Math.max(0, Number(threat.lungePx) || 0) * tuning.lungeThreatFraction
      + tuning.reachPaddingTiles * (deps?.TILE || 64);
    const insideCone = Math.abs(signedAngleDelta(angleToEnemy, yaw)) <= Math.max(0, Number(threat.halfConeRad) || 0);
    return { exposed: insideCone && distancePx <= reachPx, insideCone, distancePx, reachPx, yaw, angleToEnemy };
  }

  function chooseDodgeDirection(entity, threat) {
    const attacker = threat.attacker; // Player origin used to derive two perpendicular escape directions.
    const dx = entity.x - attacker.x; // Attack-to-enemy axis normalized below.
    const dy = entity.y - attacker.y; // Attack-to-enemy axis normalized below.
    const length = Math.max(0.001, Math.hypot(dx, dy));
    const efficacy = Math.max(0, Number(armorStats(entity)?.dodgeEfficacy) || 1); // Same weight-derived duration/travel effectiveness as the player.
    const travelPx = tuning.speedPxS * tuning.durationS * efficacy; // Endpoint probe distance for choosing a side with usable terrain.
    const preferredSign = ((String(entity.id || '').length + (Number(threat.id) || 0)) & 1) ? 1 : -1; // Deterministic left/right variety without an extra random roll.
    const candidates = [preferredSign, -preferredSign].map(sign => ({ x: -dy / length * sign, y: dx / length * sign, sign }));
    candidates.push({ x: dx / length, y: dy / length, sign: 0 }); // Backward escape is the fallback when both lateral lanes are obstructed.
    let best = null; // Furthest collision-safe candidate wins, favoring a full lateral dodge when available.
    for (const candidate of candidates) {
      const swept = deps.sweptMove(
        entity.x, entity.y,
        entity.x + candidate.x * travelPx,
        entity.y + candidate.y * travelPx,
        (x, y) => deps.canOccupyAt(x, y, deps.TILE * 0.32),
      );
      const clearDistance = Math.hypot(swept.x - entity.x, swept.y - entity.y); // Measures real terrain clearance for this direction.
      if (!best || clearDistance > best.clearDistance) best = { ...candidate, clearDistance };
    }
    return best && best.clearDistance >= Math.min(deps.TILE * 0.18, travelPx * 0.35) ? best : null;
  }

  function beginDodge(entity, threat) {
    const direction = chooseDodgeDirection(entity, threat); // Chosen immediately before movement so current obstructions are authoritative.
    if (!direction) {
      lastEvent = { at: Date.now(), enemy: entity.id, threat: threat.source, result: 'blocked' };
      return false;
    }
    const efficacy = Math.max(0, Number(armorStats(entity)?.dodgeEfficacy) || 1); // Outfit weight shortens travel and invulnerability together.
    const durationS = tuning.durationS * efficacy; // Remaining movement time consumed by updateActiveDodge.
    window.ResourceSystem?.spendStamina?.(entity, tuning.staminaCost, 'enemy dodge');
    window.KnockbackCollisionImpact?.coolBurningOnDodge?.(entity);
    entity.dodging = true;
    entity.dodgeT = durationS;
    entity.dodgeDirX = direction.x;
    entity.dodgeDirY = direction.y;
    entity.invulnUntil = performance.now() + tuning.iframeMs * efficacy;
    entity._enemyDodgeCooldownT = tuning.cooldownS;
    entity._enemyDodge = { threatId: threat.id, durationS, remainingS: durationS, spinSign: direction.sign || 1, source: threat.source };
    entity._enemyDodgePending = null;
    dodgeCount += 1;
    lastEvent = {
      at: Date.now(), enemy: entity.id, rank: entity.banditRank, threat: threat.source, result: 'dodged',
      weightUnits: armorStats(entity).weightUnits, efficacy, durationS, iframeMs: tuning.iframeMs * efficacy,
    };
    return true;
  }

  function finishDodge(entity) {
    entity.dodging = false;
    entity.dodgeT = 0;
    entity.vx = 0;
    entity.vy = 0;
    entity._enemyDodge = null;
    if (entity.avatarRef?.group?.rotation) entity.avatarRef.group.rotation.z = 0;
  }

  function updateActiveDodge(entity, dt, targetPlayer) {
    const state = entity._enemyDodge;
    if (!state) return null;
    state.remainingS = Math.max(0, state.remainingS - dt);
    entity.dodgeT = state.remainingS;
    const desiredX = entity.x + entity.dodgeDirX * tuning.speedPxS * dt; // Per-frame dodge endpoint resolved through the normal creature terrain sweep.
    const desiredY = entity.y + entity.dodgeDirY * tuning.speedPxS * dt; // Per-frame dodge endpoint resolved through the normal creature terrain sweep.
    const swept = deps.sweptMove(entity.x, entity.y, desiredX, desiredY, (x, y) => deps.canOccupyAt(x, y, deps.TILE * 0.32));
    const stepPx = Math.hypot(swept.x - entity.x, swept.y - entity.y); // Actual traveled distance drives the existing creature footstep cadence.
    entity.x = swept.x;
    entity.y = swept.y;
    entity.vx = entity.dodgeDirX * tuning.speedPxS;
    entity.vy = entity.dodgeDirY * tuning.speedPxS;
    deps.tickCreatureFootsteps?.(entity, stepPx);
    const progress = state.durationS > 0 ? 1 - state.remainingS / state.durationS : 1; // Full-body roll progress for the readable dodge animation.
    if (entity.avatarRef?.group?.rotation) entity.avatarRef.group.rotation.z = progress * Math.PI * 2 * state.spinSign;
    if (state.remainingS <= 0 || stepPx < 0.01) finishDodge(entity);
    return { handled: true, moving: !!entity._enemyDodge, aimAngle: Math.atan2(targetPlayer.y - entity.y, targetPlayer.x - entity.x) };
  }

  function maybeReact(entity, dt, targetPlayer) {
    entity._enemyDodgeCooldownT = Math.max(0, (Number(entity._enemyDodgeCooldownT) || 0) - dt);
    const active = updateActiveDodge(entity, dt, targetPlayer);
    if (active) return active;

    const pending = entity._enemyDodgePending; // A short committed delay makes the response readable instead of instantaneous.
    if (pending) {
      pending.remainingS = Math.max(0, pending.remainingS - dt);
      if (pending.remainingS <= 0) beginDodge(entity, pending.threat);
      return { handled: true, moving: !!entity._enemyDodge, aimAngle: entity.facing || 0 };
    }

    if (entity._enemyDodgeCooldownT > 0 || entity.prone || entity._banditAction || entity._banditLunging || entity._rangedAction || entity.retreatT > 0) return null;
    const threat = window.Combat?.currentPlayerMeleeThreat?.(); // Shared player windup metadata; absent outside a real authored melee attack.
    if (!threat || threat.id === entity._enemyDodgeLastThreatId) return null;
    const status = threatStatus(entity, threat); // Range+cone gate prevents off-axis or distant enemies reacting psychically.
    if (!status.exposed) return null;
    entity._enemyDodgeLastThreatId = threat.id;
    const chance = clamp01(tuning.chanceByRank[entity.banditRank] ?? tuning.chanceByRank.grunt); // Rank controls decision quality; outfit weight controls efficacy.
    if ((deps.rnd?.() ?? Math.random()) >= chance) {
      lastEvent = { at: Date.now(), enemy: entity.id, rank: entity.banditRank, threat: threat.source, result: 'declined', chance };
      return null;
    }
    const delayS = Math.min(tuning.reactionDelayS, Math.max(0, threat.timeToImpactS) * 0.45); // Never spends most of a short windup merely waiting to react.
    entity._enemyDodgePending = { threat, remainingS: delayS };
    if (delayS <= 0) beginDodge(entity, threat);
    return { handled: true, moving: !!entity._enemyDodge, aimAngle: entity.facing || 0 };
  }

  window.BanditCombat.init = function enemyDodgeBanditInit(injectedDeps, ...rest) {
    deps = injectedDeps;
    return originalInit(injectedDeps, ...rest);
  };

  window.BanditCombat.makeEntity = async function enemyDodgeBanditEntity(...args) {
    const entity = await originalMakeEntity(...args); // Fully built roster data is required before shared outfit weight can be calculated.
    if (entity) profileOutfit(entity);
    return entity;
  };

  window.BanditCombat.updateCombatAI = function enemyDodgeBanditCombatAI(entity, dt, targetPlayer, ...rest) {
    if (!entity?.outfitArmorStats) profileOutfit(entity);
    const dodgeResult = maybeReact(entity, dt, targetPlayer);
    if (dodgeResult?.handled) return dodgeResult;
    const moveMultiplier = combatMoveMultiplier(entity); // Shared weight penalty applied to every melee and ranged movement path inside the wrapped AI.
    const originalMoveSpeed = entity.def.moveSpeed; // Restored after this frame so authored base stats never drift through repeated multiplication.
    const originalChaseSpeed = entity.def.chaseSpeed; // Restored after this frame so return/patrol code outside combat keeps its original speed.
    entity.def.moveSpeed = originalMoveSpeed * moveMultiplier;
    entity.def.chaseSpeed = originalChaseSpeed * moveMultiplier;
    try {
      return originalUpdateCombatAI(entity, dt, targetPlayer, ...rest);
    } finally {
      entity.def.moveSpeed = originalMoveSpeed;
      entity.def.chaseSpeed = originalChaseSpeed;
    }
  };

  function debugSnapshot() {
    const enemies = deps?.hostileObjects ? [...deps.hostileObjects].filter(entity => entity?.isBandit).map(entity => ({
      id: entity.id,
      rank: entity.banditRank,
      weightUnits: armorStats(entity).weightUnits,
      armor: { ...armorStats(entity) },
      dodging: !!entity.dodging,
      dodgeRemainingS: Number(entity.dodgeT) || 0,
      cooldownS: Number(entity._enemyDodgeCooldownT) || 0,
    })) : [];
    return { version: VERSION, ready: !!deps, tuning: { ...tuning, chanceByRank: { ...tuning.chanceByRank } }, dodgeCount, lastEvent, enemies };
  }

  window.EnemyDodge = Object.freeze({ version: VERSION, applyConfig, profileOutfit, armorStats, combatMoveMultiplier, threatStatus, debugSnapshot });
  window.__enemyDodgeDebug = debugSnapshot;
})();
