(() => {
  'use strict';
  const tools = new Map([['torch', {id:'torch', label:'Torch', icon:'🔥'}]]); // Registry for later unlockable adventuring tools.
  const unlocked = new Set(['torch']); // Current character unlocks; the starter torch is always present.
  let deps = null, lit = false, lastEvent = 'ready'; // Hand-held torch state is session-only, unlike future tool unlocks.
  function init(injected) {
    deps = injected; lit = false; unlocked.clear(); unlocked.add('torch');
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
    const pose = window.AttackPoseTemplates?.torchForehandPose?.(window.WeaponToolStances?.poses?.torchHold); // Shared with the editor: exact Forehand deltas from the active torch rest, grip untouched.
    if (!pose) { lastEvent='forehand pose missing'; return null; }
    const durationS = 0.345 + 0.07; // Forehand windup/strike timing, without entering the combat lunge system.
    lastEvent='stationary torch forehand'; // Existing Pixel Probe exposes which swing was selected.
    return {
      durationS,
      options: {
        toolSlot: 'adventuring', anim: 'sweep', dirSign: 1, power: 1,
        windupFrac: 0.345 / durationS, strikeFrac: 1, holdS: 0.43,
        pose,
      },
    };
  }
  function swingAtAim(col,row) {
    if (!isHoldingTorch()) return {ok:false,message:'No torch equipped.'};
    const ray=deps?.getAimRay?.(), THREE=deps?.THREE, holder=deps?.getToolHolder?.();
    let start=null, end=null; // Shared physical strike segment drives all ruin/fire contacts and prevents remote lighting.
    if (THREE && holder) {
      start=holder.getWorldPosition(new THREE.Vector3());
      const aimedDirection=deps?.getPerspectiveDirection?.(start) || ray?.direction; // Melee-style hand-to-reticle convergence, falling back to the raw camera ray in isolated scenes.
      if (aimedDirection) {
        const direction=new THREE.Vector3(aimedDirection.x,aimedDirection.y,aimedDirection.z); // Shared segment checks source ignition, target contact and solid cover.
        if (direction.lengthSq()>1e-8) end=start.clone().addScaledVector(direction.normalize(),2.4);
      }
    }
    const block = start && end ? window.NearbyVolumeCollision?.segmentHit?.(start,end,.12) : null;
    const maxT = Number.isFinite(block?.t) ? Math.min(1,Math.max(0,block.t)) : 1; // Keep melee fire on the visible side of solid ruin cover.
    const ruinSource=!lit && start && end
      && window.DevRandomRuinHitPuzzles?.isIgnitionSourceAlongSegment?.(start,end,maxT,.18);
    const inRuin = deps?.getCurrentArea?.() === 'map_i_dev_random_ruin'; // Ruin sources must pass 3D collision and floor checks rather than a 2D tile shortcut.
    const tileSource = !inRuin && deps?.isAimedFireHazard?.(col,row);
    if (!lit && (ruinSource || tileSource)) {
      if (light() && ruinSource) window.RuinInteractionAudio?.igniteTorch?.();
    }
    if (lit) {
      if (start && end) {
        window.DungeonFire?.contactProjectile?.({team:'player',dungeonFire:true},start,end,maxT,.20);
        window.DevRandomRuinHitPuzzles?.contactAdventuringTorchSegment?.(start,end,maxT,.12,true);
      }
      window.BanditCamps?.igniteAimedTentWithTorch?.();
    }
    return {ok:true,message:''};
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
        lit, held, unlocked: [...unlocked], lastEvent,
        torchStance: stance ? {
          idleApplied: stance.stanceApplied, uprightApplied: stance.worldUprightApplied,
          motionCooldownMs: stance.holderMotionBusyMs, configSource: stance.stanceConfigSource,
        } : null,
      };
    }
  });
})();
