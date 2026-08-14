(() => {
  'use strict';

  // Centralizes the visual language for tools that can also occupy the weapon slot.
  // The game still owns the authoritative tool definitions and animation timing;
  // this module only augments those live definitions and applies an idle-only mesh
  // offset immediately before Three.js renders the frame.
  let deps = null;
  let rendererHookInstalled = false;
  let lastHolderQuaternion = null;
  let holderMotionBusyUntil = 0;
  let lastDebugSignature = '';
  let stanceApplied = false;
  const meshBaselines = new WeakMap();

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
    const shape = shapeFor(itemKey, def);
    if (shape === 'hoe' || shape === 'hatchet') return 'heavy';
    if (shape === 'fishingmace' || shape === 'fishingspear' || shape === 'pickshovel') return 'light';
    return null;
  }

  function augmentToolDefinitions() {
    if (!deps?.TOOL_ITEM_DEFS) return;
    for (const [itemKey, def] of Object.entries(deps.TOOL_ITEM_DEFS)) {
      if (!def) continue;
      const shape = shapeFor(itemKey, def);
      if (shape === 'hoe') {
        // Hoe weapon eligibility is consumed by EquipmentPanel's slot picker and combat's live tool definitions.
        if (!Array.isArray(def.slots)) def.slots = ['hoe'];
        if (!def.slots.includes('weapon')) def.slots.push('weapon');
        def.dmgType = 'blunt';
      }
      const idleClass = weaponIdleClass(itemKey, def);
      if (idleClass) def.weaponIdleClass = idleClass;
      if (shape === 'hoe') def.toolIdleStyle = 'thrust';
    }
  }

  function deg(value) {
    return (Number(value) || 0) * Math.PI / 180;
  }

  function poseQuaternion(pose) {
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deg(pose.yaw));
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg(pose.pitch));
    const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), deg(pose.roll));
    return qYaw.multiply(qPitch).multiply(qRoll);
  }

  function captureBaseline(mesh) {
    let baseline = meshBaselines.get(mesh);
    if (baseline) return baseline;
    // Stored once per live slot mesh so render-time stance offsets can always return to the engine-authored transform.
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
    const baseline = captureBaseline(mesh);
    mesh.position.copy(baseline.position);
    mesh.quaternion.copy(baseline.quaternion);
    mesh.scale.copy(baseline.scale);
  }

  function restoreAllMeshes() {
    const meshes = deps?.toolMeshMap;
    if (!meshes) return;
    for (const mesh of Object.values(meshes)) if (mesh) restoreMesh(mesh);
  }

  function holderIsMoving(now) {
    const holder = deps?.toolHolder;
    if (!holder?.quaternion) return false;
    if (!lastHolderQuaternion) {
      lastHolderQuaternion = holder.quaternion.clone();
      return false;
    }
    const dot = Math.min(1, Math.abs(lastHolderQuaternion.dot(holder.quaternion)));
    const angularStep = 2 * Math.acos(dot);
    lastHolderQuaternion.copy(holder.quaternion);
    // A tool swing always rotates the holder; keeping this grace window longer
    // than a normal hoe swing prevents the idle offset from reappearing mid-hit.
    if (angularStep > 0.004) holderMotionBusyUntil = Math.max(holderMotionBusyUntil, now + 650);
    return now < holderMotionBusyUntil;
  }

  function targetPoseFor(activeSlot, itemKey, def) {
    const shape = shapeFor(itemKey, def);
    if (activeSlot === 'hoe' && shape === 'hoe') return ENGINE_NEUTRAL_POSES.thrust;
    if (activeSlot !== 'weapon') return null;
    const idleClass = weaponIdleClass(itemKey, def);
    if (idleClass === 'heavy') return ENGINE_NEUTRAL_POSES.chop;
    if (idleClass === 'light') return LIGHT_WEAPON_POSE;
    return null;
  }

  function applyRelativePose(mesh, sourcePose, targetPose) {
    const baseline = captureBaseline(mesh);
    const sourceQ = poseQuaternion(sourcePose);
    const targetQ = poseQuaternion(targetPose);
    const deltaQ = sourceQ.clone().invert().multiply(targetQ);

    // Pose positions are expressed in the player's right/up/forward frame.
    // Convert that delta into the source holder's local frame before applying it to the slot mesh.
    const deltaPosition = new THREE.Vector3(
      (targetPose.x || 0) - (sourcePose.x || 0),
      (targetPose.y || 0) - (sourcePose.y || 0),
      (targetPose.z || 0) - (sourcePose.z || 0),
    ).applyQuaternion(sourceQ.clone().invert());

    mesh.position.copy(baseline.position).add(deltaPosition);
    mesh.quaternion.copy(baseline.quaternion).multiply(deltaQ);
  }

  function activeState() {
    const activeSlot = deps?.getActiveTool?.() || null;
    const itemKey = activeSlot ? deps?.equipmentSlots?.[activeSlot] : null;
    const def = itemKey ? deps?.TOOL_ITEM_DEFS?.[itemKey] : null;
    const mesh = activeSlot ? deps?.toolMeshMap?.[activeSlot] : null;
    return { activeSlot, itemKey, def, mesh };
  }

  function applyBeforeRender() {
    if (!deps) return;
    restoreAllMeshes();
    stanceApplied = false;

    const now = performance.now();
    const moving = holderIsMoving(now);
    const { activeSlot, itemKey, def, mesh } = activeState();
    const targetPose = targetPoseFor(activeSlot, itemKey, def);
    const sourcePose = ENGINE_NEUTRAL_POSES[def?.animStyle] || ENGINE_NEUTRAL_POSES.thrust;

    if (mesh && targetPose && !moving) {
      applyRelativePose(mesh, sourcePose, targetPose);
      stanceApplied = true;
    }

    const signature = `${activeSlot || '-'}|${itemKey || '-'}|${weaponIdleClass(itemKey, def) || '-'}|${stanceApplied ? 'idle' : moving ? 'moving' : 'default'}`;
    if (signature !== lastDebugSignature) {
      lastDebugSignature = signature;
      window.__farmLog?.(`[weapon-stance] ${signature}`, 'combat');
    }
  }

  function installRendererHook() {
    if (rendererHookInstalled || !window.THREE?.WebGLRenderer?.prototype) return;
    rendererHookInstalled = true;
    const proto = THREE.WebGLRenderer.prototype;
    const originalRender = proto.render;
    // The render seam runs after game.js updates updateToolMesh, so stance offsets affect the visible frame without replacing that engine code.
    proto.render = function weaponToolStanceRender(scene, camera) {
      try { applyBeforeRender(); }
      catch (error) { window.__farmLog?.(`[weapon-stance] render hook failed: ${error.message}`, 'warn'); }
      return originalRender.call(this, scene, camera);
    };
  }

  function debugSnapshot() {
    const state = activeState();
    return {
      activeSlot: state.activeSlot,
      itemKey: state.itemKey,
      shape: shapeFor(state.itemKey, state.def),
      weaponIdleClass: weaponIdleClass(state.itemKey, state.def),
      sourceAnimStyle: state.def?.animStyle || null,
      stanceApplied,
      holderMotionBusyMs: Math.max(0, Math.round(holderMotionBusyUntil - performance.now())),
      hoeWeaponEligible: !!deps?.TOOL_ITEM_DEFS?.bronzehoe?.slots?.includes('weapon'),
      hoeDamageType: deps?.TOOL_ITEM_DEFS?.bronzehoe?.dmgType || null,
      lightWeaponPose: { ...LIGHT_WEAPON_POSE },
    };
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    augmentToolDefinitions();
    installRendererHook();
    deps?.buildInventoryGrid?.();
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
