(() => {
  'use strict';
  const tools = new Map([['torch', {id:'torch', label:'Torch', icon:'🔥'}]]); // Registry for later unlockable adventuring tools.
  const unlocked = new Set(['torch']); // Current character unlocks; the starter torch is always present.
  let lastStrike = null; // Copied by Pixel Probe on mobile when checking reach and ignition.
  let deps = null, lit = false, lastEvent = 'ready'; // Hand-held torch state is session-only, unlike future tool unlocks.
  function init(injected) {
    deps = injected; lit = false; lastStrike = null; lastEvent = 'ready'; unlocked.clear(); unlocked.add('torch');
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
  function isLit() { return lit; }
  function isHoldingTorch() { return deps?.getActiveTool?.()==='adventuring' && deps?.getHeldMode?.()==='tool' && deps?.getEquippedTool?.()==='torch'; }
  function canThrow() { return lit && isHoldingTorch(); }
  function stow() { if (!lit) return; lit = false; lastEvent='stowed: extinguished'; deps?.refreshActionBar?.(); }
  function light() {
    if (lit || !isHoldingTorch()) return false;
    lit=true; lastEvent='lit from fire-hazard furniture'; deps?.refreshActionBar?.(); return true;
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
    return root => {
      if (!root || !scene) return null;
      let parent = root;
      while (parent && parent !== scene && parent.visible !== false) parent = parent.parent;
      if (parent !== scene) return null;
      root.updateWorldMatrix?.(true, true);
      box.setFromObject(root);
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
    if (!lit) {
      if (ruinPuzzles?.touchesIgnitionSource?.(contact)) source = 'ruin brazier';
      else {
        const furniture = findFireSource(scene, contact);
        if (furniture) source = furniture.userData.authoredFurnitureKey || furniture.name || 'furniture';
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
        base.knockbackPxS * step.knockbackMul, { abilityId: 'torch_swing', tag: 'blunt' });
      if (landed === false) continue;
      hits++;
      api.playWeaponHitSfx?.('blunt', target.x, target.y, area);
    }
    lastStrike = { area, source, hits, rangeTiles: cone.rangePx / api.TILE, halfConeDeg: cone.halfConeRad * 180 / Math.PI };
    lastEvent = source ? 'lit from ' + source : 'torch strike: ' + hits + ' creature hits';
    return { ok: true, message: '' };
  }
  function throwLit() {
    if (!canThrow()) return {ok:false,message:'The torch must be lit before you throw it.'};
    if (!window.RangedWeapons?.throwAdventuringTorch?.()) return {ok:false,message:'Cannot throw the torch here.'};
    lit=false; lastEvent='thrown: unlit torch replaced'; deps?.refreshActionBar?.();
    return {ok:true,message:''};
  }
  window.AdventuringTools=Object.freeze({
    init,register,unlock,entries,isLit,isHoldingTorch,canThrow,stow,light,forehandSwingVisual,swingAtAim,throwLit,
    get debug() {
      const held = isHoldingTorch(); // Pixel Probe only samples the stance renderer when the adventuring torch is actually equipped.
      const stance = held ? window.WeaponToolStances?.debugSnapshot?.() : null; // Existing mobile diagnostics can confirm world-up correction and idle ownership.
      return {
        lit, held, unlocked: [...unlocked], lastEvent, lastStrike,
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
