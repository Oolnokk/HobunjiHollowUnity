(() => {
  'use strict';

  // Centralizes the visual language for tools that can also occupy the weapon slot.
  // The game still owns authoritative tool definitions and swing timing; this module
  // only augments those live definitions and applies an idle-only visual offset at render time.
  let deps = null; // Live EquipmentPanel dependencies used to read slots, tool definitions, and meshes.
  let rendererHookInstalled = false; // Guards the one-time WebGLRenderer.render wrapper used for late idle offsets.
  let combatHooksInstalled = false; // Guards the one-time Combat.deps visual wrappers used to protect active attacks.
  let lastHolderQuaternion = null; // Previous tool-holder orientation used to recognize ordinary tool swing motion.
  let holderMotionBusyUntil = 0; // Grace period that keeps an idle stance from returning during a moving tool action.
  let combatBusyUntil = 0; // End of the current non-held combat visual window, used by applyBeforeRender().
  let combatHoldActive = false; // True while a charge/hold attack is frozen at windup, even though the holder stops moving.
  let lastDebugSignature = ''; // Last compact stance state logged to the in-game Debug log, avoiding per-frame spam.
  let stanceApplied = false; // Current-frame diagnostic flag exposed through debugSnapshot().
  const meshBaselines = new WeakMap(); // Original local transforms for meshes this module offsets and later restores.
  const stancedMeshes = new Set(); // Only meshes modified by this module; restored at the beginning of the next render pass.

  // These are the existing neutral pose values from game.js, reused here to
  // calculate a relative transform without duplicating updateToolMesh itself.
  const ENGINE_NEUTRAL_POSES = Object.freeze({
    thrust: Object.freeze({ x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, roll: 0 }),
    sweep: Object.freeze({ x: 0, y: 0, z: 0.16, pitch: 0, yaw: 0, roll: 0 }),
    chop: Object.freeze({ x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, roll: -82 }),
  });

  // Used for fishing spear/mace and pick-shovel weapon idle: starts from the
  // shovel/thrust neutral, tips the working end down, and carries the haft
  // diagonally behind the back for the requested staff/Darth-Maul silhouette.
  const LIGHT_WEAPON_POSE = Object.freeze({
    x: -0.02,
    y: 0.02,
    z: -0.08,
    pitch: -18,
    yaw: -52,
    roll: -18,
  });

  // Tracks which shape family each item belongs to; used by both weapon-slot
  // eligibility and the heavy/light idle routing below.
  function shapeFor(itemKey, def) {
    if (def?.shapeKey) return def.shapeKey;
    if (itemKey === 'bronzehoe') return 'hoe';
    if (itemKey === 'hatchet') return 'hatchet';
    if (itemKey === 'fishingmace') return 'fishingmace';
    if (itemKey === 'fishingspear') return 'fishingspear';
    if (itemKey === 'pickshovel') return 'pickshovel';
    return null;
  }

  function weaponIdleClass(itemKey, def) {
    const shape = shapeFor(itemKey, def); // Shape family selects the reusable combat-idle class.
    if (shape === 'hoe' || shape === 'hatchet') return 'heavy';
    if (shape === 'fishingmace' || shape === 'fishingspear' || shape === 'pickshovel') return 'light';
    return null;
  }

  function augmentToolDefinitions() {
    if (!deps?.TOOL_ITEM_DEFS) return;
    for (const [itemKey, def] of Object.entries(deps.TOOL_ITEM_DEFS)) {
      if (!def) continue;
      const shape = shapeFor(itemKey, def); // Shape identifies starter and smith-crafted hoes uniformly.
      if (shape === 'hoe') {
        // EquipmentPanel consumes slots live, while combat consumes dmgType live from the same object.
        if (!Array.isArray(def.slots)) def.slots = ['hoe'];
        if (!def.slots.includes('weapon')) def.slots.push('weapon');
        def.dmgType = 'blunt';
      }
      const idleClass = weaponIdleClass(itemKey, def); // Metadata also makes stance routing visible to debug/UI readers.
      if (idleClass) def.weaponIdleClass = idleClass;
      if (shape === 'hoe') def.toolIdleStyle = 'thrust';
    }
  }

  function deg(value) {
    return (Number(value) || 0) * Math.PI / 180;
  }

  function poseQuaternion(pose) {
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deg(pose.yaw)); // Local yaw component.
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg(pose.pitch)); // Local pitch component.
    const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), deg(pose.roll)); // Local roll component.
    return qYaw.multiply(qPitch).multiply(qRoll);
  }

  function captureBaseline(mesh) {
    let baseline = meshBaselines.get(mesh); // Baseline is reused for every later render pass of this exact mesh.
    if (baseline) return baseline;
    baseline = {
      position: mesh.position.clone(),
      quaternion: mesh.quaternion.clone(),
      scale: mesh.scale.clone(),
    };
    meshBaselines.set(mesh, baseline);
    return baseline;
  }

  function restoreMesh(mesh) {
    if (!mesh) return;
    const baseline = captureBaseline(mesh); // Restores only local transforms this module is allowed to touch.
    mesh.position.copy(baseline.position);
    mesh.quaternion.copy(baseline.quaternion);
    mesh.scale.copy(baseline.scale);
  }

  function restoreStancedMeshes() {
    for (const mesh of stancedMeshes) restoreMesh(mesh);
    stancedMeshes.clear();
  }

  function holderIsMoving(now) {
    const holder = deps?.toolHolder; // Shared holder rotation changes during tool work and combat swings.
    if (!holder?.quaternion) return false;
    if (!lastHolderQuaternion) {
      lastHolderQuaternion = holder.quaternion.clone();
      return false;
    }
    const dot = Math.min(1, Math.abs(lastHolderQuaternion.dot(holder.quaternion))); // Quaternion similarity for this frame.
    const angularStep = 2 * Math.acos(dot); // Radians moved since the previous rendered frame.
    lastHolderQuaternion.copy(holder.quaternion);
    // A tool swing always rotates the holder; this grace window prevents the idle offset from reappearing mid-hit.
    if (angularStep > 0.004) holderMotionBusyUntil = Math.max(holderMotionBusyUntil, now + 650);
    return now < holderMotionBusyUntil;
  }

  function markCombatVisualBusy(durationS, opts = {}) {
    const baseSeconds = Math.max(0, Number(durationS) || 0); // Caller-authored attack visual duration.
    const holdSeconds = Math.max(0, Number(opts?.holdS) || 0); // Explicit strike-pose hold baked into some combo steps.
    const safeTailSeconds = 0.75; // Covers game.js's automatic return-to-neutral tail after callers' nominal duration.
    combatBusyUntil = Math.max(combatBusyUntil, performance.now() + (baseSeconds + holdSeconds + safeTailSeconds) * 1000);
  }

  function installCombatVisualHooks() {
    const combatDeps = window.Combat?.deps; // Shared combat dependency object used lazily by every ability module.
    if (!combatDeps || combatHooksInstalled || combatDeps.__weaponToolStanceVisualHooks) return;

    const wrap = (name, before) => {
      const original = combatDeps[name]; // Existing game.js callback retained as the authoritative visual implementation.
      if (typeof original !== 'function') return;
      combatDeps[name] = function weaponToolStanceAwareCombatVisual(...args) {
        before(...args);
        return original.apply(this, args);
      };
    };

    wrap('triggerWeaponSwingVisual', (durationS, opts) => markCombatVisualBusy(durationS, opts));
    wrap('triggerWeaponHoldVisual', (durationS, opts) => {
      combatHoldActive = true;
      markCombatVisualBusy(durationS, opts);
    });
    wrap('releaseWeaponSwingHold', () => {
      combatHoldActive = false;
      combatBusyUntil = Math.max(combatBusyUntil, performance.now() + 1200);
    });
    wrap('cancelWeaponSwingHold', () => {
      combatHoldActive = false;
      combatBusyUntil = Math.max(combatBusyUntil, performance.now() + 250);
    });

    Object.defineProperty(combatDeps, '__weaponToolStanceVisualHooks', { value: true, configurable: true });
    combatHooksInstalled = true;
  }

  function targetPoseFor(activeSlot, itemKey, def) {
    const shape = shapeFor(itemKey, def); // Current physical tool shape distinguishes tool-mode hoe from weapon-mode hoe.
    if (activeSlot === 'hoe' && shape === 'hoe') return ENGINE_NEUTRAL_POSES.thrust;
    if (activeSlot !== 'weapon') return null;
    const idleClass = weaponIdleClass(itemKey, def); // Weapon slot selects one of the two reusable combat silhouettes.
    if (idleClass === 'heavy') return ENGINE_NEUTRAL_POSES.chop;
    if (idleClass === 'light') return LIGHT_WEAPON_POSE;
    return null;
  }

  function applyRelativePose(mesh, sourcePose, targetPose) {
    const baseline = captureBaseline(mesh); // Existing sprite/metal-specific local transform remains the starting point.
    const sourceQ = poseQuaternion(sourcePose); // Holder-space neutral currently produced by updateToolMesh.
    const targetQ = poseQuaternion(targetPose); // Holder-space neutral we want the player to see instead.
    const deltaQ = sourceQ.clone().invert().multiply(targetQ); // Child correction satisfying source * delta = target.

    // Pose positions are expressed in the player's right/up/forward frame.
    // Convert that world-facing delta into the current source holder's local frame.
    const deltaPosition = new THREE.Vector3(
      (targetPose.x || 0) - (sourcePose.x || 0),
      (targetPose.y || 0) - (sourcePose.y || 0),
      (targetPose.z || 0) - (sourcePose.z || 0),
    ).applyQuaternion(sourceQ.clone().invert());

    mesh.position.copy(baseline.position).add(deltaPosition);
    mesh.quaternion.copy(deltaQ).multiply(baseline.quaternion);
    stancedMeshes.add(mesh);
  }

  function activeState() {
    const activeSlot = deps?.getActiveTool?.() || null; // Slot, not item key, is what tells tool mode from weapon mode.
    const itemKey = activeSlot ? deps?.equipmentSlots?.[activeSlot] : null; // Live item currently assigned to that active slot.
    const def = itemKey ? deps?.TOOL_ITEM_DEFS?.[itemKey] : null; // Canonical item definition shared with combat/equipment UI.
    const mesh = activeSlot ? deps?.toolMeshMap?.[activeSlot] : null; // Visible slot mesh receiving the late idle correction.
    return { activeSlot, itemKey, def, mesh };
  }

  function applyBeforeRender() {
    if (!deps) return;
    restoreStancedMeshes();
    stanceApplied = false;
    installCombatVisualHooks();

    const now = performance.now(); // Shared timestamp for motion and combat-busy gating this render pass.
    const holderMoving = holderIsMoving(now); // Ordinary farming/tool motion gate.
    const { activeSlot, itemKey, def, mesh } = activeState();
    const combatBusy = activeSlot === 'weapon' && (combatHoldActive || now < combatBusyUntil); // Explicit combat gate, including frozen holds.
    const targetPose = targetPoseFor(activeSlot, itemKey, def); // Desired idle pose for this exact slot/item combination.
    const sourcePose = ENGINE_NEUTRAL_POSES[def?.animStyle] || ENGINE_NEUTRAL_POSES.thrust; // Engine neutral currently underneath the mesh.

    if (mesh && targetPose && !holderMoving && !combatBusy) {
      applyRelativePose(mesh, sourcePose, targetPose);
      stanceApplied = true;
    }

    const stateLabel = stanceApplied ? 'idle' : combatBusy ? 'combat' : holderMoving ? 'moving' : 'default'; // Compact mobile-debug state.
    const signature = `${activeSlot || '-'}|${itemKey || '-'}|${weaponIdleClass(itemKey, def) || '-'}|${stateLabel}`;
    if (signature !== lastDebugSignature) {
      lastDebugSignature = signature;
      window.__farmLog?.(`[weapon-stance] ${signature}`, 'combat');
    }
  }

  function installRendererHook() {
    if (rendererHookInstalled || !window.THREE?.WebGLRenderer?.prototype) return;
    rendererHookInstalled = true;
    const proto = THREE.WebGLRenderer.prototype; // Shared renderer prototype is the post-update seam for every game render pass.
    const originalRender = proto.render; // Authoritative Three.js render implementation called after the stance correction.
    // This runs after game.js updates updateToolMesh, so idle offsets affect only the visible frame without replacing engine logic.
    proto.render = function weaponToolStanceRender(scene, camera) {
      try { applyBeforeRender(); }
      catch (error) { window.__farmLog?.(`[weapon-stance] render hook failed: ${error.message}`, 'warn'); }
      return originalRender.call(this, scene, camera);
    };
  }

  function debugSnapshot() {
    const state = activeState(); // Live state makes the snapshot useful from the game's existing mobile Debug surface.
    return {
      activeSlot: state.activeSlot,
      itemKey: state.itemKey,
      shape: shapeFor(state.itemKey, state.def),
      weaponIdleClass: weaponIdleClass(state.itemKey, state.def),
      sourceAnimStyle: state.def?.animStyle || null,
      stanceApplied,
      holderMotionBusyMs: Math.max(0, Math.round(holderMotionBusyUntil - performance.now())),
      combatBusyMs: Math.max(0, Math.round(combatBusyUntil - performance.now())),
      combatHoldActive,
      hoeWeaponEligible: !!deps?.TOOL_ITEM_DEFS?.bronzehoe?.slots?.includes('weapon'),
      hoeDamageType: deps?.TOOL_ITEM_DEFS?.bronzehoe?.dmgType || null,
      lightWeaponPose: { ...LIGHT_WEAPON_POSE },
    };
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    augmentToolDefinitions();
    installCombatVisualHooks();
    installRendererHook();
    // Do not render inventory/action UI here. EquipmentPanel.init runs before
    // sibling systems such as WhistleEquip and CalendarSystem receive their own
    // init(deps) payloads; forcing those render paths here caused null-dependency
    // boot crashes. Their normal game.js initialization/render flow will see the
    // already-mutated live tool definitions when they render later.
    window.__farmLog?.('[weapon-stance] initialized: hoes=weapon/blunt, heavy=hoe+axe, light=fishing spear+mace+pick-shovel', 'combat');
  }

  window.WeaponToolStances = {
    init,
    refreshDefinitions: augmentToolDefinitions,
    debugSnapshot,
    poses: {
      heavy: ENGINE_NEUTRAL_POSES.chop,
      light: LIGHT_WEAPON_POSE,
      hoeTool: ENGINE_NEUTRAL_POSES.thrust,
    },
  };
})();
