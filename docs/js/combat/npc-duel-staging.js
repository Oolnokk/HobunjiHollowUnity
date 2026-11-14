(() => {
  'use strict';

  // NPC-vs-NPC duel staging (window.NpcDuelStaging).
  //
  // Ecology fights (bandits vs tribe hunters vs predators, see
  // porakaneki-camps-runtime.js's updateChunkEcology) used to run the same
  // player-grade pipeline as a bandit fighting the player: attack-slot and
  // queue-ring spacing buckets, quick-attack condition scans, a per-frame 3D
  // meleeHit probe through every lunge, a 3D strike cone, afflictions, and so
  // on. None of that precision matters when the player is not in the fight,
  // so a fight the player is not part of only has to LOOK like normal combat.
  //
  // While a duel is staged:
  //  - the fighter approaches and circles its opponent on a cheap sway ring
  //    (no slot/queue/personal-space bookkeeping);
  //  - its swings are still real BanditCombat combo steps (same authored
  //    poses, lunge, trail, vocal/impact audio), but the lunge has no per-frame
  //    cone probe and the strike resolves with a 2D reach/cone test and no
  //    afflictions (combat-bandit.js's fireBanditComboStep `staged` option);
  //  - the defender sometimes plays a real EnemyDodge roll during the windup,
  //    which then makes that swing miss, because ordinary dodges only react to
  //    the player's attacks and duels otherwise never showed one;
  //  - when BOTH fighters are offscreen (OffscreenRigLod put their rigs to
  //    sleep, or they are hidden) nothing is drawn at all, so the exchange is
  //    resolved abstractly: stamina, cooldown and a damage roll, no swing.
  //
  // The fighter returns to the full simulation (with hysteresis) as soon as
  // the player is involved: within INVOLVE_TILES of either fighter, or the
  // player/companion recently hit either of them (PlayerDowned.noteTeamHit's
  // _teamHitAt). Staged swings already in flight finish normally.
  //
  // Ranged troops (ranged-weapons.js's updateBanditAI) and Flaskers
  // (combat-bandit.js's updateBanditFlaskAI) use engage() too: real shots and
  // throws while visible, but sight checks refresh on a slow timer instead of
  // whenever either fighter moves, aim pitch comes from the ground heights,
  // and a staged arrow only tests its intended target and the player instead
  // of every hostile; offscreen, volleys and throws are abstract rolls.
  //
  // Melee is wired from combat-bandit.js's updateBanditCombatAI, after the
  // special ranged/flask/witch AIs and the lunge/retreat/action holds, so only
  // the ordinary melee decision step is replaced. setEnabled(false) is the A/B
  // switch; snapshot() exposes counters for Pixel Probe/headless checks.

  const VERSION = 1;
  const INVOLVE_TILES = 6; // Player this close to either fighter -> full simulation.
  const RELEASE_TILES = 7.5; // Must be this far again before a fighter goes back to staged.
  const TEAM_HIT_HOLD_MS = 6000; // Matches porakaneki-camps-runtime's PLAYER_ENGAGEMENT_HOLD_MS.
  const REACH_REFRESH_S = 0.5; // Engagement reach only changes with combo step/def; no need to rebuild it every frame.
  const ALIGN_TOLERANCE_RAD = 0.35; // Swing once roughly facing the opponent.
  const TURN_RATE_RAD_S = Math.PI * 2.5;
  const HOLD_RADIUS_FRAC = 0.85; // Circling distance while waiting on cooldown/stamina, as a fraction of reach.
  const SWAY_AMPLITUDE_RAD = 0.45;
  const SWAY_HZ = 0.12;
  const STRAFE_SPEED_PX_S = 55; // Same gentle sway speed the full AI uses near its ring point.
  const STRIKE_CONE_SLACK_RAD = 0.25; // The 2D test has no target box width; a little angular slack stands in for it.
  const DUEL_DODGE_CHANCE_MUL = 0.55; // Fraction of the rank's dodge chance used against NPC swings.
  const ABSTRACT_HIT_CHANCE = 0.62;

  let deps = null; // { TILE, player, rnd, now }
  let enabled = true;
  const stats = { stagedFrames: 0, fullFrames: 0, stagedSwings: 0, abstractExchanges: 0, stagedHits: 0, stagedMisses: 0, stagedDodges: 0, promotions: 0, stagedShots: 0 };

  function init(injectedDeps) { deps = injectedDeps || null; }
  function nowMs() { return deps?.now ? deps.now() : performance.now(); }
  function rnd() { return deps?.rnd ? deps.rnd() : Math.random(); }

  // Same actor test as combat-bandit.js's damageBanditCombatTarget: the player,
  // ruin statue proxies and other non-actors are never staged.
  function isActor(target) {
    return !!target && target.isEncounterProxy !== true && ( // Ruin-encounter statue stand-ins carry a creatureKey but are scripted objectives.
      target.isBandit === true
      || target.isPorakanekiHunter === true
      || target.banditCompanion === true
      || typeof target.creatureKey === 'string'
    );
  }

  // Bosses, scripted attackers and tutorial dummies keep their own AI.
  function isSpecial(c) {
    return !!(c.maskboundTroop || c.mineWyrmWitchType || c.hachutuTitanTuning || c.isHarlyaoLich
      || c.specialLichId || c.combatTutorialTarget || c._attachment);
  }

  function recentlyHitByTeam(entity, now) {
    const at = Number(entity?._teamHitAt);
    return Number.isFinite(at) && now - at <= TEAM_HIT_HOLD_MS;
  }

  function playerNear(entity, tiles) {
    const player = deps?.player;
    if (!player || !deps?.TILE) return false;
    const limit = tiles * deps.TILE;
    const dx = entity.x - player.x, dy = entity.y - player.y;
    return dx * dx + dy * dy <= limit * limit;
  }

  // Player involvement with hysteresis: a staged fighter goes full at
  // INVOLVE_TILES, a full one only goes back to staged beyond RELEASE_TILES.
  function playerInvolved(c, target) {
    const now = nowMs();
    if (recentlyHitByTeam(c, now) || recentlyHitByTeam(target, now)) return true;
    if (target === deps?.player) return true;
    const tiles = c._npcDuel ? INVOLVE_TILES : RELEASE_TILES;
    return playerNear(c, tiles) || playerNear(target, tiles);
  }

  function isStageable(c, target) {
    if (!enabled || !deps || !c || !isActor(target) || isSpecial(c)) return false;
    if (!(Number(target.health) > 0) || c.prone) return false;
    return !playerInvolved(c, target);
  }

  // Hidden = avatar not drawn, or outside this frame's camera frustum (checked
  // directly; an actor's _rigOffscreenAsleep flag can be stale when its mesh
  // update was skipped). Unknown -> visible, so the fallback is a real swing.
  function isHidden(entity) {
    const group = entity?.avatarRef?.group;
    if (!group) return false;
    if (group.visible === false) return true;
    const pos = group.position;
    const lod = window.OffscreenRigLod;
    if (!pos || typeof lod?.inView !== 'function') return false;
    return !lod.inView(pos.x, pos.y, pos.z);
  }

  function turnToward(c, angle, dt) {
    const facing = Number(c.facing) || 0;
    const delta = Math.atan2(Math.sin(angle - facing), Math.cos(angle - facing));
    const step = TURN_RATE_RAD_S * Math.max(0, dt);
    c.facing = facing + Math.sign(delta) * Math.min(Math.abs(delta), step);
    return Math.abs(delta) <= ALIGN_TOLERANCE_RAD;
  }

  // Abstract exchange for a fight nobody can see: same stamina/cooldown
  // rhythm as a swing, plain damage roll, no pose/lunge/trail/audio.
  function resolveAbstractExchange(c, target, api) {
    const def = c.def;
    window.ResourceSystem?.spendStamina?.(c, def.attackStaminaCost, 'bandit attack');
    c.attackCooldownT = def.attackCooldownS || 1;
    c._banditComboIndex = 0;
    stats.abstractExchanges++;
    if (rnd() >= ABSTRACT_HIT_CHANCE || target.dodging) { stats.stagedMisses++; return; }
    stats.stagedHits++;
    api.damage(c, target, Math.max(1, Math.round(def.attackDamage || 1)), 0);
  }

  // Called by combat-bandit.js once per frame for an ordinary melee fighter
  // that is free to make a decision. Returns null to fall through to the
  // full AI, or the frame's { aimAngle, moving } when the duel is staged.
  // Shared per-frame gate for every staged AI (melee here, ranged in
  // ranged-weapons.js, flask throws in combat-bandit.js): keeps the
  // _npcDuel marker that drives the hysteresis, and the frame counters.
  function engage(c, target) {
    if (!isStageable(c, target)) {
      if (c?._npcDuel) { c._npcDuel = null; stats.promotions++; }
      stats.fullFrames++;
      return null;
    }
    stats.stagedFrames++;
    return c._npcDuel || (c._npcDuel = { reachPx: 0, reachAgeS: Infinity, phase: rnd() * Math.PI * 2 });
  }

  function bothHidden(c, target) { return isHidden(c) && isHidden(target); }

  // Abstract exchanges outside melee (ranged volleys, flask throws) share the
  // same hit roll and counters.
  function rollAbstractHit(target) {
    stats.abstractExchanges++;
    const hit = rnd() < ABSTRACT_HIT_CHANCE && !target?.dodging;
    if (hit) stats.stagedHits++; else stats.stagedMisses++;
    return hit;
  }
  function noteStagedShot() { stats.stagedShots++; }

  function update(c, dt, target, distPx, towardAngle, api) {
    const s = engage(c, target);
    if (!s) return null;
    s.reachAgeS += dt;
    if (s.reachAgeS >= REACH_REFRESH_S || !(s.reachPx > 0)) {
      s.reachPx = Math.max(deps.TILE * 0.5, Number(api.comboReachPx(c)) || 0);
      s.reachAgeS = 0;
    }
    const def = c.def;
    const reach = s.reachPx;
    const aligned = turnToward(c, towardAngle, dt);
    const staminaOk = (c._banditComboIndex || 0) > 0 || c.stamina >= def.attackStaminaCost;
    const canStrike = distPx <= reach && c.attackCooldownT <= 0 && staminaOk;
    if (canStrike && aligned) {
      if (isHidden(c) && isHidden(target)) resolveAbstractExchange(c, target, api);
      else if (api.fireStagedSwing(c, target, dt)) stats.stagedSwings++;
      return { aimAngle: c.facing, moving: false };
    }
    if (canStrike) return { aimAngle: c.facing, moving: false }; // Finishing the turn-in.

    // Approach to reach, or circle just inside it while waiting.
    const sway = Math.sin(nowMs() / 1000 * SWAY_HZ * Math.PI * 2 + s.phase) * SWAY_AMPLITUDE_RAD;
    const radius = distPx > reach ? reach * 0.8 : reach * HOLD_RADIUS_FRAC;
    const ringAngle = towardAngle + Math.PI + sway;
    const px = target.x + Math.cos(ringAngle) * radius;
    const py = target.y + Math.sin(ringAngle) * radius;
    const away = Math.hypot(px - c.x, py - c.y);
    const speed = away > deps.TILE * 1.5 ? def.chaseSpeed : STRAFE_SPEED_PX_S;
    const moving = away > 1 ? !!api.moveToward(c, px, py, speed, dt) : false;
    return { aimAngle: towardAngle, moving };
  }

  // Called when a staged swing starts: maybe have the defender roll out of it.
  // The roll itself is the ordinary EnemyDodge state machine, so it looks the
  // same as a dodge of the player's attack.
  function maybeStageDodge(defender, attacker, timeToImpactS) {
    if (!defender?.isBandit || !window.EnemyDodge?.stageDodge) return false;
    const chance = (window.EnemyDodge.dodgeChance?.(defender) ?? 0.34) * DUEL_DODGE_CHANCE_MUL;
    if (rnd() >= chance) return false;
    const started = window.EnemyDodge.stageDodge(defender, attacker, timeToImpactS);
    if (started) stats.stagedDodges++;
    return started;
  }

  // 2D reach/cone strike test used instead of the 3D pie-prism hit test.
  function strikeLands(attacker, target, rangePx, halfConeRad) {
    if (!target || !(Number(target.health) > 0) || target.dodging) { stats.stagedMisses++; return false; }
    if (Number(target.invulnUntil) > performance.now()) { stats.stagedMisses++; return false; }
    const dx = target.x - attacker.x, dy = target.y - attacker.y;
    const bodyPx = (deps?.TILE || 64) * 0.32; // Same body radius creatures use for terrain occupancy.
    const inRange = Math.hypot(dx, dy) <= rangePx + bodyPx;
    const yaw = Math.atan2(dy, dx);
    const delta = Math.abs(Math.atan2(Math.sin(yaw - (attacker.facing || 0)), Math.cos(yaw - (attacker.facing || 0))));
    const hit = inRange && delta <= halfConeRad + STRIKE_CONE_SLACK_RAD;
    if (hit) stats.stagedHits++; else stats.stagedMisses++;
    return hit;
  }

  function isStaged(c) { return !!c?._npcDuel; }

  window.NpcDuelStaging = Object.freeze({
    version: VERSION,
    init,
    update,
    engage,
    bothHidden,
    rollAbstractHit,
    noteStagedShot,
    isStaged,
    isStageable,
    isHidden,
    maybeStageDodge,
    strikeLands,
    setEnabled(value) { enabled = value !== false; return enabled; },
    get enabled() { return enabled; },
    snapshot() { return { version: VERSION, enabled, ...stats }; },
    resetStats() { for (const key of Object.keys(stats)) stats[key] = 0; },
    constants: Object.freeze({ INVOLVE_TILES, RELEASE_TILES, TEAM_HIT_HOLD_MS, ABSTRACT_HIT_CHANCE }),
  });
})();
