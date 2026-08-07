(() => {
  'use strict';

  // One button dumps every arena entity's internal AI/combat state as dense
  // coded lines, meant to be pasted into a chat with an AI session that has
  // no other way to see a live browser — a static code review can (and did,
  // twice: attachBanditWeaponProp was defined but never called, and the "1
  // hit then retreat" report) miss things that only show up once the AI loop
  // is actually ticking, and this environment's egress policy blocks the CDN
  // this game loads three.js from, so a headless Chromium session can't
  // render it either. The guide string is the interpretation key for
  // whichever Claude session receives it.
  //
  // A single frozen instant wasn't enough to read state actually CHANGING
  // over time (a combo step advancing, a cooldown counting down) --
  // captureBanditCombatSnapshot runs on its own real-time interval (not the
  // game's own dt, so it keeps ticking at a steady rate regardless of
  // framerate) independently of the copy button, pushing into a capped ring
  // buffer; the button only ever copies whatever's currently buffered, it
  // doesn't take a fresh snapshot.
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its sibling systems. _arenaSpawnedCreatures/
  // devGlobalSpeedMul/DEV_ARENA_ZONE_ID are the dev Testing Arena spawner's
  // own state (still in game.js), threaded through as deps — devGlobalSpeedMul
  // as a getter since the speed slider reassigns it.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const BANDIT_COMBAT_LOG_BUFFER_SIZE = 7;
  const BANDIT_COMBAT_LOG_INTERVAL_S = 1;
  const _banditCombatLogBuffer = []; // [{ t, text }], oldest first

  const COMBAT_LOG_GUIDE = `HOBUNJI COMBAT LOG -- interpretation guide for AI review
This is a CONVEYOR BELT of up to ${BANDIT_COMBAT_LOG_BUFFER_SIZE} snapshots, one captured automatically every ${BANDIT_COMBAT_LOG_INTERVAL_S}s in the background (oldest dropped once an extra one would push the buffer past ${BANDIT_COMBAT_LOG_BUFFER_SIZE}) while the Testing Arena is active -- pressing the copy button doesn't take a fresh snapshot, it just copies whatever's currently buffered, oldest first. Read consecutive snapshots together to see state actually CHANGE over ~${BANDIT_COMBAT_LOG_BUFFER_SIZE} real seconds (comboIdx advancing, cdT counting down, retreatT/guarding windows opening and closing, hp dropping) instead of guessing from one frozen instant.
Each ENTITY line is space-separated key=value pairs (multi-word values use _ instead of spaces). Read docs/game.js's updateHostiles()/updateBanditCombatAI() (Bandit Gangs section) for the state machine these fields describe. Bandits fight through the SAME named abilities the player has (Combo/Quick Attack/Charged Breaker/Counter Shield -- real damage/range/cone numbers exposed read-only via window.Combat.comboData/quickAttackData/chargedBreakerData/counterShieldData), executed by a parallel bandit-only AI (updateBanditCombatAI) rather than the player-singleton combat-core/combo/quickattacks/holds modules themselves -- see the long comment above updateBanditCombatAI for why. Wildlife still uses the older plain bite-telegraph/behaviorStage/Pounce system (combat-enemy-telegraph.js/combat-animal-attacks.js) unchanged.
Common fields:
  id            unique entity id (bandit ids look like "bandit_<rank>_<timestamp>_<rand>")
  kind          PLAYER | BANDIT | CREATURE | COMPANION | CORPSE (CORPSE = health<=0, still lootable via the action bar; a dead companion also reports CORPSE)
  state         idle|chase|return|patrol-chase|fleeing-low-health|dying|corpse
  hp/stam       current/max health and stamina
  pos           (col,row) tile position; distPlayer = straight-line px distance to the human player (TILE=55px is 1 tile)
  tState        telegraphState: none|windup|strike -- mid-swing "tell" (bandits set this from their own ability AI, not combat-enemy-telegraph.js); a hit can only land during "strike"
  aaBusy        wildlife only: 1 if a named/modular attack (Pounce etc, combat-animal-attacks.js) is currently playing
  retreatT      seconds left jumping backward after an attack (0 = not retreating); duration scales with how much of the attempt actually landed (see banditRetreatDurationS -- a total whiff gets the full jump-back, a fully-landed combo barely backs off)
  cdT           seconds left before the next attack attempt is allowed (attackCooldownT)
  aggroPx/leashPx/atkRangePx  this entity's own def.aggroRangePx/leashRangePx/attackRangePx, to compare against distPlayer -- NOTE for bandits: atkRangePx is only the flat melee baseline, NOT the real approach/attack-commit threshold (that's engageRangePx, its current combo step's own hit range + lunge distance -- see banditEngagementReachPx and the bandit's own why= text, which reports the real number)
Bandit-only fields:
  rank/tier/mastery   grunt|lieutenant|captain; difficulty tier 0-3 the camp/spawn used; rolled weapon-mastery level 0-5
  species/gender      rolled from speciesWeights in bandit-gang-config.json
  wpn                 def.weaponKey, a crafted "<shape>_<metal>" id (e.g. hatchet_lowTinBronze) -- "none" would mean banditWeaponFor() failed, should never happen
  wpnMeshOK           1 if the weapon's own toolHolder mesh actually built (makeBanditToolHolder) -- 0 means it SHOULD render unarmed even though wpn is set; report as a bug if seen. The weapon is animated (updateBanditToolMesh), not a static prop -- it reuses the player's own fourPhaseLerp/STYLE_NEUTRAL_POSE/SWEEP_POSE swing pose math against the bandit's own facing/position and its own current ability's windup/strike timing.
  atkTag/atkDmg       attackTag (sharp/blunt, from the weapon's own dmgType) and attackDamage after rank/tier/mastery/metal multipliers
  loadout             its banditAbilityLoadout as tap1/tap2/hold1/hold2 ability ids ("-" for a null hold slot) -- tap1/tap2 are on every rank, hold1 only lieutenant+/captain, hold2 only captain (see heldAbilitiesByRank)
  comboIdx            which of tap1's 3 combo steps fires next (0-2); resets to 0 after the 3rd step completes and retreats
  actionBusy          1 if a staged ability (windup or strike) is currently in flight (c._banditAction) -- while 1, the bandit is standing still finishing its swing
  hold1CdT            seconds left before Charged Breaker (hold1) can be re-rolled as an opener (0 = available); lieutenant/captain only
  guarding/guardCdT   captain only: 1 if Counter Shield's guard window is currently active (incoming player hits are reduced ${Math.round(window.BanditCombat.GUARD_DAMAGE_ABSORB * 100)}% and answered with a riposte), and seconds left before the next window opens
  cloth               worn cosmetics as slot:cosmeticId:dyeId, semicolon-separated ("-" = nothing rolled, should be rare -- see fillProbabilityByRank)
  idle/settleT        idle=1 means no staged action is in flight AND the brief post-swing settle window (BANDIT_TOOL_SETTLE_S) has elapsed -- the bandit is truly at rest, not just between windup/strike. settleT is seconds left in that settle window (0 outside it). stanceMatch/bodyLeanDeg below are only meaningful (worth flagging as a bug) once idle=1 -- mid-swing or mid-settle they're expected to differ from their "rest" values.
  stanceAnim/stanceExpected/stanceMatch   stanceAnim is the bandit's CURRENT rest-pose style (c._banditSwingAnim: sweep|thrust); stanceExpected is what its equipped weapon's own animStyle says it should be (banditNaturalSwing(def) -- sweep for hatchet/fishingmace, thrust for the rest); stanceMatch=0 while idle=1 means the idle stance is stuck showing a DIFFERENT ability's style than the one its weapon actually plays at rest (this exact bug happened once already -- Quick Attack/Charged Breaker hardcode their own anim/pose and finishBanditAction has to reset it back afterward).
  facingDeg/groupRotDeg/bodyLeanDeg   facingDeg is c.facing (the bandit's true aim/facing angle, degrees) and groupRotDeg is c.groupRot (its avatar body's actual rendered rotation.y, in the portrait-rig's own reflected+offset space -- see updateCreatureMesh's rawTargetRotY) -- these are NOT the same convention and are not meant to numerically match. bodyLeanDeg is the signed difference between groupRotDeg and where the body SHOULD be sitting at rest for the current facingDeg (0 = body exactly at its rest angle); a large bodyLeanDeg while idle=1 means the avatar body is stuck leaned into a swing that already ended -- the other half of the same class of bug as stanceMatch above (this also happened once already, from the settle window not reasserting the lean on both the weapon and the body together).
why="..."             free-text reasoning computed at snapshot time, referencing the nearest other entity by id where relevant
Companion-only fields (kind=COMPANION -- the player's own active whistle/stable companion, only listed when it's actually in this zone):
  name          the companion's given name (stable) or "-" if whistle-summoned with none set
  master        always "player" today (companions are player-only; the field exists in case that changes)
  perceptionPx  this companion's own _companionPerceptionRangePx(c) -- the radius within which it senses/marks a nearby bandit camp or animal den (see updateCompanionPerception); compare against distances to camps/dens, not distPlayer alone, since perception is centered on the COMPANION, not the player`;

  function _combatLogDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function _combatLogNearestOther(c, all) {
    let best = null, bestDist = Infinity;
    for (const o of all) {
      if (o === c) continue;
      const d = _combatLogDist(c, o);
      if (d < bestDist) { bestDist = d; best = o; }
    }
    return best ? `${best.id || 'player'}@${Math.round(bestDist)}px` : 'none';
  }

  function _combatLogBanditWhy(c, def, targetPlayer, nearestOtherTxt) {
    if (c.health <= 0) return `dead; corpse lootable via action bar (rolled loot table + 100% of worn clothing)`;
    const distP = Math.round(_combatLogDist(c, targetPlayer));
    if (c.state === 'idle') return `idle; distPlayer=${distP}px > aggroRangePx=${Math.round(def.aggroRangePx)}px, not aggro'd yet. nearest=${nearestOtherTxt}`;
    if (c.state === 'return') return `returning home; player out of leashRangePx=${Math.round(def.leashRangePx)}px or too far from its own homeX/Y`;
    if (c.state !== 'chase') return `state=${c.state}, not currently in combat`;
    if (c._banditGuardUntil > performance.now()) return `guarding (Counter Shield window open) while otherwise ${c.retreatT > 0 ? 'retreating' : c._banditAction ? 'mid-swing' : 'approaching/attacking'} -- an incoming hit right now gets reduced and answered with a riposte`;
    if (c.retreatT > 0) return `jumping back (retreatT=${c.retreatT.toFixed(2)}s) after ${c._banditComboIndex === 0 ? 'finishing its 3-step Combo (tap1) or a Quick Attack/Charged Breaker' : 'an unexpected mid-combo retreat -- flag as a possible state bug'}`;
    if (c._banditAction) return `${c.telegraphState === 'windup' ? 'winding up' : 'striking'} an ability swing (tState=${c.telegraphState}); distPlayer=${distP}px`;
    // Non-mutating read of _banditAttackSlots/_banditQueueRings (does NOT
    // call claimBanditAttackSlot/claimBanditQueueRing, which would claim/
    // allocate one as a side effect just from generating a log line) --
    // checked BEFORE the closing-distance branch below, not after: a
    // queued bandit's real target is its assigned standoff ring (see
    // updateBanditCombatAI's !readyToStrike branch), whose radius is
    // deliberately well past engageRangePx (BANDIT_STANDOFF_RANGE_MUL,
    // bumped further per ring for a big gang's outer rings) -- checking
    // distance first would misreport an already-correctly-positioned
    // queued bandit as "closing distance, waiting to enter engageRangePx"
    // forever, since it's never actually trying to reach that number. Only
    // BANDIT_MAX_ATTACK_SLOTS=2 bandits are ever allowed to close in and
    // swing at once.
    if (!window.BanditCombat.attackSlots.some(s => s.bandit === c)) {
      const queueRing = window.BanditCombat.queueRings.find(q => q.bandit === c);
      return queueRing
        ? `queued on standoff ring ${queueRing.ringIndex} (not one of the ${window.BanditCombat.MAX_ATTACK_SLOTS} bandits currently holding an attack slot) -- holding/swaying at its assigned ring, NOT trying to close the distance; distPlayer=${distP}px`
        : `queued, not yet assigned a standoff ring (should self-correct next frame -- flag as a bug if this persists); distPlayer=${distP}px`;
    }
    // The real approach/attack-commit gate is banditEngagementReachPx (its
    // current combo step's own reach, folding in that step's own lunge
    // distance) -- NOT the flat def.attackRangePx shown in the ENTITY
    // line's atkRangePx field, which is only the melee baseline before any
    // per-step range/lunge math. Reporting attackRangePx here instead used
    // to make a bandit committing to (and, before the engagement-reach
    // fix, whiffing) an attack from well outside its real hit cone look
    // like ordinary "still closing" text.
    const engageReach = Math.round(window.BanditCombat.engagementReachPx(c, def, def.banditAbilityLoadout || {}, targetPlayer));
    if (distP > engageReach) return `closing distance, distPlayer=${distP}px, waiting to enter engageRangePx=${engageReach}px (its current combo step's own hit range + lunge; melee baseline atkRangePx=${Math.round(def.attackRangePx)}px)`;
    if (c.attackCooldownT > 0) return `recovering, cdT=${c.attackCooldownT.toFixed(2)}s left before its next tap/hold attempt; distPlayer=${distP}px, engageRangePx=${engageReach}px`;
    // Mid-combo continuation (comboIdx > 0) skips this gate -- see
    // updateBanditCombatAI's continuingCombo comment -- so it's only ever
    // the real block for an opening attack.
    if (c._banditComboIndex === 0 && c.stamina < def.attackStaminaCost) return `in range but stamina=${Math.round(c.stamina)} < attackStaminaCost=${def.attackStaminaCost}, waiting to regen`;
    return `in range and off cooldown, about to pick an ability (chargedBreaker opener chance, then a favorable-condition Quick Attack, else the next Combo step); distPlayer=${distP}px`;
  }

  // Idle REST pose/orientation diagnostic -- deliberately separate from the
  // attack-frame fields above (tState/actionBusy/comboIdx etc, which
  // describe an in-flight swing). Reports what the bandit's stance
  // currently IS and where it SHOULD be at rest, to catch either half of
  // the two bugs already found once each: the idle stance getting stuck
  // showing whichever ability last fired instead of the equipped weapon's
  // own style (see finishBanditAction/banditNaturalSwing), and the avatar
  // body rotating independently of (leaning a different amount than) the
  // weapon it's holding (see updateBanditToolMesh's settle-window
  // reassertion). stanceMatch/bodyLeanDeg are only worth reading as
  // "wrong" once idle=1 -- mid-swing or mid-settle they're supposed to
  // differ from their rest values.
  function _combatLogBanditStance(c, def) {
    const settleT = Math.max(0, ((c._banditToolSettleUntil || 0) - performance.now()) / 1000);
    const idle = !c._banditAction && settleT <= 0;
    const natural = window.BanditCombat.naturalSwing(def);
    const stanceAnim = c._banditSwingAnim || 'thrust';
    // c.groupRot's own rest value for the CURRENT facing (see
    // updateCreatureMesh's rawTargetRotY, the same formula) -- diffed
    // against the actual live c.groupRot via angleDiff (wrap-safe) so a
    // stuck lean shows up as a nonzero bodyLeanDeg regardless of which way
    // c.facing happens to be pointing right now.
    const aimOffset = def.aimAngleOffset || 0;
    const restGroupRot = -((c.facing || 0) + aimOffset) + Math.PI / 2;
    const bodyLeanDeg = Math.round(THREE.MathUtils.radToDeg(deps.angleDiff(c.groupRot || 0, restGroupRot)));
    return [
      `idle=${idle ? 1 : 0}`, `settleT=${settleT.toFixed(2)}`,
      `stanceAnim=${stanceAnim}`, `stanceExpected=${natural.anim}`, `stanceMatch=${stanceAnim === natural.anim ? 1 : 0}`,
      `facingDeg=${Math.round(THREE.MathUtils.radToDeg(c.facing || 0))}`,
      `groupRotDeg=${Math.round(THREE.MathUtils.radToDeg(c.groupRot || 0))}`,
      `bodyLeanDeg=${bodyLeanDeg}`,
    ].join(' ');
  }

  function captureBanditCombatSnapshotText() {
    // companionObjects is a separate tracking Set from
    // _arenaSpawnedCreatures (the dev-spawner's own bookkeeping) -- a
    // whistle/stable companion summoned the normal way was previously
    // invisible to this log entirely, silently omitted even though it's a
    // real participant standing right next to the player.
    const player = deps.player;
    const currentArea = deps.getCurrentArea();
    const companions = [...deps.companionObjects].filter(c => c.areaId === currentArea);
    const all = [player, ...deps.arenaSpawnedCreatures, ...companions];
    const lines = [`--- SNAPSHOT zone=${currentArea} t=${new Date().toISOString()} devGlobalSpeedMul=${deps.getDevGlobalSpeedMul()} ---`,
      `ENTITY kind=PLAYER hp=${Math.round(player.health)}/${player.maxHealth} stam=${Math.round(player.stamina)}/${player.maxStamina} pos=(${Math.floor(player.x / deps.TILE)},${Math.floor(player.y / deps.TILE)})`];
    for (const c of deps.arenaSpawnedCreatures) {
      const def = c.def || {};
      const nearestTxt = _combatLogNearestOther(c, all);
      const kind = c.health <= 0 ? 'CORPSE' : (c.isBandit ? 'BANDIT' : 'CREATURE');
      if (c.isBandit) {
        const r = c.rosterRecord || {};
        const clothTxt = (r.equippedCosmetics || []).length
          ? r.equippedCosmetics.map(id => `${r.cosmeticSlots?.[id] || '?'}:${id}:${r.appliedDyes?.[window.BanditCombat.TINT_SLOT_BY_SLOT[r.cosmeticSlots?.[id]]] || '-'}`).join(';')
          : '-';
        const loadout = def.banditAbilityLoadout || {};
        const loadoutTxt = `${loadout.tap1 || '-'}/${loadout.tap2 || '-'}/${loadout.hold1 || '-'}/${loadout.hold2 || '-'}`;
        lines.push([
          `ENTITY kind=${kind}`, `id=${c.id}`, `rank=${c.banditRank}`, `tier=${c.banditTier}`, `mastery=${c.banditMastery}`,
          `species=${r.appearance?.speciesId}/${r.appearance?.gender}`,
          `hp=${Math.round(c.health)}/${c.maxHealth}`, `stam=${Math.round(c.stamina)}/${c.maxStamina}`,
          `pos=(${Math.floor(c.x / deps.TILE)},${Math.floor(c.y / deps.TILE)})`, `distPlayer=${Math.round(_combatLogDist(c, player))}`,
          `state=${c.state}`, `tState=${c.telegraphState || 'none'}`, `actionBusy=${c._banditAction ? 1 : 0}`,
          `retreatT=${(c.retreatT || 0).toFixed(2)}`, `cdT=${(c.attackCooldownT || 0).toFixed(2)}`,
          `loadout=${loadoutTxt}`, `comboIdx=${c._banditComboIndex || 0}`, `hold1CdT=${(c._banditHold1CdT || 0).toFixed(2)}`,
          `guarding=${c._banditGuardUntil > performance.now() ? 1 : 0}`, `guardCdT=${(c._banditGuardCdT || 0).toFixed(2)}`,
          `wpn=${def.weaponKey || 'none'}`, `wpnMeshOK=${c.banditWeaponMeshAttached ? 1 : 0}`, `atkTag=${def.attackTag}`, `atkDmg=${def.attackDamage}`,
          `aggroPx=${Math.round(def.aggroRangePx || 0)}`, `leashPx=${Math.round(def.leashRangePx || 0)}`, `atkRangePx=${Math.round(def.attackRangePx || 0)}`,
          `cloth=${clothTxt}`, _combatLogBanditStance(c, def), `nearestOther=${nearestTxt}`,
          `why="${_combatLogBanditWhy(c, def, player, nearestTxt)}"`,
        ].join(' '));
      } else {
        lines.push([
          `ENTITY kind=${kind}`, `id=${c.id}`, `species=${c.creatureKey}`,
          `hp=${Math.round(c.health)}/${c.maxHealth}`, `stam=${Math.round(c.stamina)}/${c.maxStamina}`,
          `pos=(${Math.floor(c.x / deps.TILE)},${Math.floor(c.y / deps.TILE)})`, `distPlayer=${Math.round(_combatLogDist(c, player))}`,
          `state=${c.state}`, `tState=${c.telegraphState || 'none'}`, `aaBusy=${window.Combat?.animalAttacks?.isBusy?.(c) ? 1 : 0}`,
          `retreatT=${(c.retreatT || 0).toFixed(2)}`, `cdT=${(c.attackCooldownT || 0).toFixed(2)}`,
          `atkTag=${def.attackTag}`, `atkDmg=${def.attackDamage}`, `nearestOther=${nearestTxt}`,
        ].join(' '));
      }
    }
    for (const c of companions) {
      const def = c.def || {};
      const nearestTxt = _combatLogNearestOther(c, all);
      const kind = c.health <= 0 ? 'CORPSE' : 'COMPANION';
      lines.push([
        `ENTITY kind=${kind}`, `id=${c.id}`, `species=${c.creatureKey}`, `name=${c.name || '-'}`, `master=${c.master === player ? 'player' : (c.master?.id || 'none')}`,
        `hp=${Math.round(c.health)}/${c.maxHealth}`, `stam=${Math.round(c.stamina)}/${c.maxStamina}`,
        `pos=(${Math.floor(c.x / deps.TILE)},${Math.floor(c.y / deps.TILE)})`, `distPlayer=${Math.round(_combatLogDist(c, player))}`,
        `state=${c.state}`, `tState=${c.telegraphState || 'none'}`, `aaBusy=${window.Combat?.animalAttacks?.isBusy?.(c) ? 1 : 0}`,
        `retreatT=${(c.retreatT || 0).toFixed(2)}`, `cdT=${(c.attackCooldownT || 0).toFixed(2)}`,
        `atkTag=${def.attackTag}`, `atkDmg=${def.attackDamage}`, `perceptionPx=${Math.round(window.BanditCamps.companionPerceptionRangePx(c))}`,
        `nearestOther=${nearestTxt}`,
      ].join(' '));
    }
    return lines.join('\n');
  }

  // Runs on its own real-time interval (see the comment above
  // BANDIT_COMBAT_LOG_BUFFER_SIZE) -- pushes one snapshot, then drops the
  // oldest once the buffer would exceed BANDIT_COMBAT_LOG_BUFFER_SIZE.
  function captureBanditCombatSnapshot() {
    if (deps.getCurrentArea() !== deps.DEV_ARENA_ZONE_ID) return;
    _banditCombatLogBuffer.push({ t: Date.now(), text: captureBanditCombatSnapshotText() });
    while (_banditCombatLogBuffer.length > BANDIT_COMBAT_LOG_BUFFER_SIZE) _banditCombatLogBuffer.shift();
  }

  async function copyArenaCombatLog() {
    const body = _banditCombatLogBuffer.length
      ? _banditCombatLogBuffer.map(s => s.text).join('\n\n')
      : '(no buffered snapshots yet -- wait a second and try again; the Testing Arena must be the active zone for the background capture to run)';
    const text = [COMBAT_LOG_GUIDE, '', body].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      deps.showToast(`Combat log copied (${_banditCombatLogBuffer.length} snapshot${_banditCombatLogBuffer.length === 1 ? '' : 's'}).`, true);
    } catch (e) {
      console.log(text);
      deps.showToast('Clipboard blocked — full log printed to console instead (check devtools).', false);
    }
  }

  function initWithBinding(injectedDeps) {
    init(injectedDeps);
    document.getElementById('devCombatLogBtn')?.addEventListener('click', copyArenaCombatLog);
    setInterval(captureBanditCombatSnapshot, BANDIT_COMBAT_LOG_INTERVAL_S * 1000);
  }

  window.BanditCombatLog = {
    init: initWithBinding,
    captureSnapshotText: captureBanditCombatSnapshotText,
  };
})();
