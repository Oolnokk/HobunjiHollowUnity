(() => {
  'use strict';
  const tools = new Map([['torch', {id:'torch', label:'Torch', icon:'🔥'}]]); // Registry for later unlockable adventuring tools.
  const unlocked = new Set(['torch']); // Current character unlocks; the starter torch is always present.
  let lastStrike = null; // Copied by Pixel Probe on mobile when checking reach and ignition.
  const TORCH_BURN_MS = 30_000; // One real-time flame lifetime shared by the held torch and belt copy.
  let deps = null, lit = false, lastEvent = 'ready'; // The portable torch's flame is session-only; stowing never creates a second flame.
  let litUntilMs = null; // Monotonic expiry timestamp, used by actions, mobile debug, and the belt presenter.
  let torchThrowHold = null; // The input owner that pairs exactly one held press with its release or cancellation.
  let torchThrowPending = null; // Released throws wait for the real Strike pose before spawning a projectile.
  let torchThrowRecovering = false; // Keeps the authored Strike/Return sequence alive even if the held mesh was temporarily unavailable.
  let torchThrowHeldHidden = false; // Only restore the previously hidden in-hand copy when its visibility toggle succeeded.
  let lastThrowOrigin='none'; // Pixel Probe/mobile debug identifies whether a launch sampled the held torch plane.
  function init(injected) {
    deps = injected; lit = false; litUntilMs = null; torchThrowHold = null; torchThrowPending = null; torchThrowRecovering = false; torchThrowHeldHidden = false; lastThrowOrigin = 'none'; lastStrike = null; lastEvent = 'ready'; unlocked.clear(); unlocked.add('torch');
    for (const key of (deps.getUnlocked?.() || [])) if (tools.has(key)) unlocked.add(key);
  }
  function register(def) { if (!def?.id || !def.label || typeof def.onSelect !== 'function') return false; tools.set(def.id,def); return true; }
  function unlock(key) {
    if (!tools.has(key)) return false;
    unlocked.add(key);
    window.CharacterMetaSave?.update?.(ch => { ch.adventuringToolUnlocks = [...unlocked].filter(id => id !== 'torch'); });
    return true;
  }
  function entries() {
    return [...tools.values()].filter(t=>unlocked.has(t.id)).map(t=>({
      id:t.id, icon:t.icon, label:t.label, active:deps?.getActiveTool?.()==='adventuring' && deps?.getEquippedTool?.()===t.id,
      onSelect:()=>t.id==='torch'?deps?.selectTorch?.():t.onSelect?.()
    }));
  }
  function nowMs() { return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now(); }
  function updateBurn() {
    if (!lit || litUntilMs === null || nowMs() < litUntilMs) return false;
    lit = false; litUntilMs = null;
    cancelThrow('burned-out'); // A 30-second timeout during a charged throw cannot launch an unlit projectile.
    lastEvent = 'torch burned out after 30 seconds';
    deps?.refreshActionBar?.();
    return true;
  }
  function isLit() { updateBurn(); return lit; }
  function isHoldingTorch() { return deps?.getActiveTool?.()==='adventuring' && deps?.getHeldMode?.()==='tool' && deps?.getEquippedTool?.()==='torch'; }
  function canThrow() { return isLit() && isHoldingTorch(); }
  function stow() {
    cancelThrow('stow'); // Put away the held pose, not the flame; the same clock continues on the belt.
    updateBurn();
    lastEvent = lit ? 'stowed on belt: still burning' : 'stowed: unlit torch hidden';
  }
  function light(renew = false) {
    updateBurn();
    if ((lit && !renew) || !isHoldingTorch()) return false;
    lit = true; litUntilMs = nowMs() + TORCH_BURN_MS;
    lastEvent='lit from fire-hazard furniture'; deps?.refreshActionBar?.(); return true;
  }
  function forehandSwingVisual() {
    if (!isHoldingTorch()) return null;
    const combat = window.Combat;
    const combo = combat?.comboData;
    const step = combo?.swingCombo?.[0]; // Uses the same authored forehand as an unmastered Harlyao longsword.
    const base = combat?.deps?.weaponAbility?.('cut', 'torch');
    const shape = window.WeaponShapeStats?.forShape?.('harlyaoLongsword');
    const aim = deps.getMeleeAimDirection();
    if (!step || !base || !shape || !aim || combat.isStaggered(combat.deps.player)) return null;
    const tempo = shape.speed * (window.DoubleEdgedCombatTrinkets?.attackSpeed?.() || 1);
    const exhaustion = window.ResourceSystem?.getExhaustionSpeed?.(combat.deps.player) ?? 1;
    const durationS = (step.windupS + step.strikeS) / (tempo * exhaustion);
    const geometry = window.WeaponShapeStats.geometry(base.rangePx * step.rangeMul * combo.RANGE_SCALE,
      step.halfConeDeg * Math.PI / 180, shape);
    lastEvent = 'stationary torch forehand';
    return {
      durationS,
      options: {
        toolSlot: 'adventuring', anim: step.anim, dirSign: step.dirSign, power: 1,
        windupFrac: step.windupS / (step.windupS + step.strikeS),
        strikeFrac: 1, holdS: step.holdS / tempo,
        pose: combat.comboStepPose('swingCombo', step),
        coneRangePx: geometry.rangePx, coneHalfConeRad: geometry.halfConeRad,
        coneAngle: Math.atan2(aim.z, aim.x),
        conePitch: Math.asin(Math.max(-1, Math.min(1, aim.y))),
      },
    };
  }

  function meleeFireContact(combat, player, hitOptions, scene) {
    const box = new deps.THREE.Box3(); // Shared by furniture, ruin and tent contact checks for a single strike.
    const contact = new deps.THREE.Vector3(); // Returned to the fire receiver synchronously for its feedback.
    return (root, actorBox = null) => {
      if (!root || !scene) return null;
      let parent = root;
      while (parent && parent !== scene && parent.visible !== false) parent = parent.parent;
      if (parent !== scene) return null;
      root.updateWorldMatrix?.(true, true);
      if (actorBox) box.copy(actorBox); // Actor hitboxes exclude decorative fire particles and use the same portrait geometry as melee attacks.
      else box.setFromObject(root);
      if (box.isEmpty()) return null;
      const acceptPoint = (origin, point) => {
        // Sight-mode cover is available even outside combat. Hitting the fixture's own surface counts.
        const cover = window.NearbyVolumeCollision?.segmentHit?.(origin, point, 0, true);
        if (cover && cover.t < 1 - 1e-6) {
          let node = cover.object;
          while (node && node !== root) node = node.parent;
          if (!node) return false;
        }
        contact.copy(point);
        return true;
      };
      return combat.meleeHit(player, null, { ...hitOptions, targetBox: box, acceptPoint, debug: false }) ? contact : null;
    };
  }

  function findFireSource(root, contact) {
    if (!root || root.visible === false) return null;
    if (root.userData?.fireHazard === true && contact(root)) return root;
    for (const child of root.children || []) {
      const source = findFireSource(child, contact); // Furniture mounted under another piece still owns its individual hitbox.
      if (source) return source;
    }
    return null;
  }

  function swingAtAim(cone) {
    updateBurn(); // Swing ignition and melee contact must observe the same held/belt expiry.
    if (!isHoldingTorch()) return { ok: false, message: 'No torch equipped.' };
    const combat = window.Combat;
    const api = combat?.deps;
    if (!cone || !api || combat.isStaggered(api.player)) return { ok: false, message: '' };
    const { player } = api;
    const area = deps.getCurrentArea();
    const hitOptions = { rangePx: cone.rangePx, halfConeRad: cone.halfConeRad, yaw: cone.angle, pitch: cone.pitch };
    const scene = deps.getActiveScene();
    const contact = meleeFireContact(combat, player, hitOptions, scene);
    const ruinPuzzles = window.DevRandomRuinHitPuzzles;
    let source = null;
    if (lit && area==='map_i_dev_random_ruin' && window.DevRandomRuinLichThemes?.activeTheme?.()==='kanthic') {
      // Renew only on actual ordinary corner flame contact; never rescan all dungeon furniture on every lit swing.
      for(const fixture of window.DevRandomRuinSanctum?.litOrdinaryFireObjects?.()||[]){
        if(contact(fixture)){if(light(true))window.RuinInteractionAudio?.igniteTorch?.();break;}
      }
    } else if (!lit) {
      if (ruinPuzzles?.touchesIgnitionSource?.(contact)) source = 'ruin brazier';
      else {
        const burning = window.BurningEntityHazards?.findTorchSource?.(contact, {
          area, player, hostileObjects: api.hostileObjects, companionObjects: api.companionObjects,
          corpseObjects: window.CreatureDeath?.getCorpseObjects?.(),
        }); // Shares the real 3D/contact-cover test with furniture; allies and corpses are not attack targets.
        if (burning) source = 'burning ' + (burning.name || burning.def?.label || burning.creatureKey || 'character');
        else {
          const furniture = findFireSource(scene, contact);
          if (furniture) source = furniture.userData.authoredFurnitureKey || furniture.name || 'furniture';
        }
      }
      if (source && light()) window.RuinInteractionAudio?.igniteTorch?.();
    }
    if (lit) {
      window.DungeonFire?.contactMelee?.(contact);
      ruinPuzzles?.contactTorchMelee?.(contact);
      window.BanditCamps?.igniteTorchMelee?.(area, contact);
    }

    const step = combat.comboData.swingCombo[0];
    const base = api.weaponAbility('cut', 'torch');
    let hits = 0;
    for (const target of api.hostileObjects) {
      if (target.health <= 0 || target.areaId !== area || !combat.meleeHit(player, target, hitOptions)) continue;
      const landed = api.damageCreature(target, Math.round(base.damage * step.damageMul), player.x, player.y,
        base.knockbackPxS * step.knockbackMul, { abilityId: 'torch_swing', tag: 'blunt', attacker: player });
      if (landed === false) continue;
      hits++;
      api.playWeaponHitSfx?.('blunt', target.x, target.y, area);
    }
    lastStrike = { area, source, hits, rangeTiles: cone.rangePx / api.TILE, halfConeDeg: cone.halfConeRad * 180 / Math.PI };
    lastEvent = source ? 'lit from ' + source : 'torch strike: ' + hits + ' creature hits';
    return { ok: true, message: '' };
  }
  function beginThrow(source = 'input', pointerId = null) {
    if (isThrowSequenceActive() || !canThrow() || window.GameplayInputRouter?.isAttackBlocked?.()) return false;
    window.BandageSystem?.cancel?.('action', { action:'torch_throw' }); // Direct torch input frees both hands before unrelated lock checks.
    if (window.CharacterActionLocks?.isLocked?.('player', 'actions') || window.CharacterActionLocks?.isLocked?.('player', 'tools')) return false;
    const animation = window.HeldActionAnimations?.weaponThrowSpin; // The same authored throw gestures as ordinary thrown weapons.
    const poses = animation?.poses || window.HobunjiRangedWeaponArchetypes?.animations?.thrown?.();
    if (!poses) return false;
    const durationS = Math.max(0.05, Number(animation?.durationS) || 1.04);
    const options = {
      pose: poses, sequence: 'attack', alignToReticle: true, held: true,
      windupFrac: animation?.windupFrac ?? 0.49,
      strikeFrac: animation?.strikeFrac ?? 0.57,
      holdFrac: animation?.holdFrac ?? 0.82,
    };
    if (deps?.beginThrowVisual?.(durationS, options) !== true) return false;
    window.ProceduralHandGripRuntime?.beginHeld?.('palm-parallel'); // Match the thrown hatchet's grip for the full held Windup and Strike.
    torchThrowHold = { source, pointerId, startedAt: performance.now() };
    lastEvent = 'torch throw: windup held';
    deps?.refreshActionBar?.();
    return true;
  }

  function isThrowSequenceActive() {
    return !!torchThrowHold || !!torchThrowPending || torchThrowRecovering;
  }
  function restoreThrownTorch() {
    if (!torchThrowRecovering) return;
    torchThrowRecovering = false;
    if (torchThrowHeldHidden) deps?.setHeldTorchVisible?.(true); // Restore only after a successful hide, like a ranged hatchet.
    torchThrowHeldHidden = false;
    window.ProceduralHandGripRuntime?.clear?.();
  }
  function cancelThrow(reason = 'cancel') {
    if (!isThrowSequenceActive()) return false;
    const hadWindup = !!torchThrowHold || !!torchThrowPending; // Only unlaunched throws need to cancel their animation.
    torchThrowHold = null;torchThrowPending = null;
    if (hadWindup) deps?.cancelThrowVisual?.();
    restoreThrownTorch();
    window.ProceduralHandGripRuntime?.clear?.();
    lastEvent = 'torch throw canceled: ' + reason;
    deps?.refreshActionBar?.();
    return true;
  }
  function releaseThrow(source = 'release') {
    if (!torchThrowHold) return {ok:false,message:''};
    torchThrowHold = null;
    if (!canThrow() || window.GameplayInputRouter?.isAttackBlocked?.()) {
      deps?.cancelThrowVisual?.();
      window.ProceduralHandGripRuntime?.clear?.();
      lastEvent = 'torch throw blocked: ' + source;
      return {ok:false,message:''};
    }
    const progress = Number(deps?.getThrowPoseProgress?.()); // The held partial windup is preserved by the shared animation compositor.
    const poseProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    torchThrowPending = { source, area: deps?.getCurrentArea?.() }; // Input-release only schedules the hit; the first actual Strike frame launches it.
    deps?.releaseThrowVisual?.({ poseProgress });
    lastEvent = 'torch throw entering strike at ' + Math.round(poseProgress * 100) + '%: ' + source;
    return {ok:true,message:''};
  }
  function updateThrow({active=false,progress=0,strikeFrac=1}={}) {
    if (!torchThrowPending && !torchThrowRecovering) return;
    if (!active || !isHoldingTorch() ||
        window.CharacterActionLocks?.isLocked?.('player','actions') ||
        window.CharacterActionLocks?.isLocked?.('player','tools') ||
        (torchThrowPending && (deps?.getCurrentArea?.() !== torchThrowPending.area ||
          window.GameplayInputRouter?.isAttackBlocked?.()))) {
      cancelThrow('strike-interrupted');
      return;
    }
    const poseProgress = Math.max(0,Math.min(1,Number(progress)||0)); // The same normalized animation clock used to place the held torch mesh.
    const releaseFrac = Math.max(0,Math.min(1,Number(strikeFrac)||0)); // Shared Strike event boundary, not the initial button-up time.
    if (torchThrowPending && poseProgress >= releaseFrac) {
      const result=throwLit(deps?.getTorchProjectileVisual?.() || null);
      if (!result.ok) { cancelThrow('projectile-unavailable');return; }
      torchThrowPending=null;
      torchThrowHeldHidden = deps?.setHeldTorchVisible?.(false) === true; // Hide the held sprite at projectile launch, not at input release.
      torchThrowRecovering = true; // Even if no mesh loaded, the pose and mobile aim must persist through recovery.
      lastEvent = 'torch thrown from strike at ' + Math.round(poseProgress*100) + '%';
    }
    if (poseProgress >= 1 - 1e-6) restoreThrownTorch(); // An animation completed on this frame; never leave the replacement invisible.
  }

  function throwLit(projectileVisual = null) {
    if (!canThrow()) return {ok:false,message:'The torch must be lit before you throw it.'};
    const sampled = projectileVisual || deps?.getTorchProjectileVisual?.() || null; // Direct/dev throws use the same release-frame sample.
    if (!window.RangedWeapons?.throwAdventuringTorch?.(sampled)) return {ok:false,message:'Cannot throw the torch here.'};
    lastThrowOrigin = sampled?.sourceTransform?.position ? 'held-plane' : 'fallback';
    lit=false; litUntilMs=null; lastEvent='thrown: unlit torch replaced'; deps?.refreshActionBar?.();
    return {ok:true,message:''};
  }
  window.AdventuringTools=Object.freeze({
    init,register,unlock,entries,isLit,isHoldingTorch,canThrow,stow,light,updateBurn,forehandSwingVisual,swingAtAim,
    beginThrow,releaseThrow,cancelThrow,throwLit,updateThrow,isThrowSequenceActive,
    get debug() {
      updateBurn(); // Pixel Probe reports the true clock even on a slow or resumed frame.
      const held = isHoldingTorch(); // Pixel Probe only samples the stance renderer when the adventuring torch is actually equipped.
      const stance = held ? window.WeaponToolStances?.debugSnapshot?.() : null; // Existing mobile diagnostics can confirm world-up correction and idle ownership.
      return {
        lit, held, onBelt: !held && lit, burnDurationMs: TORCH_BURN_MS,
        burnRemainingMs: lit ? Math.max(0, litUntilMs - nowMs()) : 0,
        throwCharging: !!torchThrowHold, throwPending:!!torchThrowPending, throwRecovering:torchThrowRecovering, throwHeldHidden:torchThrowHeldHidden, throwSource: torchThrowHold?.source || torchThrowPending?.source || null, throwLaunchOrigin:lastThrowOrigin,
        unlocked: [...unlocked], lastEvent, lastStrike,
        belt: window.AdventuringTorchBelt?.debug || null, // Pixel Probe includes actual belt attachment, texture and flame visibility on mobile.
        lastProjectile: window.RangedWeapons?.lastTorchThrow || null, // Expose the actual reticle target, converged launch vector and sprite scale in the existing mobile Pixel Probe torch section.
        torchFire: held ? window.HobunjiWeaponSpriteAssemblies?.debugSnapshot?.()
          .find(entry => entry.itemKey === 'torch' && entry.attached)?.fire?.[0] || null : null,
        torchStance: stance ? {
          idleApplied: stance.stanceApplied, uprightApplied: stance.worldUprightApplied,
          motionCooldownMs: stance.holderMotionBusyMs, configSource: stance.stanceConfigSource,
        } : null,
      };
    }
  });
})();
