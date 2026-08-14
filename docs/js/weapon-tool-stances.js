(() => {
  'use strict';

  // Centralizes the visual language for tools that can also occupy the weapon slot.
  // game.js remains authoritative for attacks/tool actions; this module augments
  // live definitions and swaps the neutral holder transform while Three builds matrices.
  let deps = null; // Live EquipmentPanel dependencies: slots, defs, active slot, holder, meshes.
  let holderHookInstalled = false; // Guards the toolHolder.updateMatrixWorld render-pose hook.
  let combatHooksInstalled = false; // Guards combat visual wrappers used to protect active attacks.
  let lastRelativeHolderQuaternion = null; // Previous holder orientation relative to the player body.
  let holderMotionBusyUntil = 0; // Grace period keeping idle poses out of active tool swings.
  let combatBusyUntil = 0; // End of current non-held combat visual window.
  let combatHoldActive = false; // True while a charged/held attack is frozen at windup.
  let lastDebugSignature = ''; // Compact in-game debug signature, avoiding frame-by-frame spam.
  let stanceApplied = false; // Diagnostic: whether the most recent matrix build used a stance override.
  let stanceConfigLoadStarted = false;
  let stanceConfigSource = 'built-in-defaults';

  const STANCE_CONFIG_URL = 'config/combat/weapon-idle-stances.json?v=20260814a';
  const STANCE_LOCAL_STORAGE_KEY = 'hobunji.weaponIdleStances.v1';

  // Existing neutral poses from game.js. These are the source poses written by
  // updateToolMesh(); slot-specific idle stances are authored separately below.
  const ENGINE_NEUTRAL_POSES = Object.freeze({
    thrust: Object.freeze({ x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, bodyYaw: 0, roll: 0 }),
    sweep: Object.freeze({ x: 0, y: 0, z: 0.16, pitch: 0, yaw: 0, bodyYaw: 0, roll: 0 }),
    chop: Object.freeze({ x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: 2, roll: -82 }),
  });

  // Mirrors docs/config/combat/weapon-idle-stances.json so a missing fetch never
  // makes the stance system disappear. The attack editor authors the same schema.
  const DEFAULT_IDLE_STANCES = Object.freeze({
    tool: Object.freeze({ x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, bodyYaw: 0, roll: 0 }),
    hoeTool: Object.freeze({ x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, bodyYaw: 0, roll: -90 }),
    heavyWeapon: Object.freeze({ x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: 2, roll: -82 }),
    lightWeapon: Object.freeze({ x: 0.04, y: 0, z: 0, pitch: 20, yaw: -70, bodyYaw: 0, roll: -65 }),
  });

  // Keep these objects stable so external debug/editor references do not go stale
  // when a fetched config or Local Override replaces their values.
  const idleStances = {
    tool: { ...DEFAULT_IDLE_STANCES.tool },
    hoeTool: { ...DEFAULT_IDLE_STANCES.hoeTool },
    heavyWeapon: { ...DEFAULT_IDLE_STANCES.heavyWeapon },
    lightWeapon: { ...DEFAULT_IDLE_STANCES.lightWeapon },
  };

  const POSE_KEYS = Object.freeze(['x', 'y', 'z', 'pitch', 'yaw', 'bodyYaw', 'roll']);

  function normalizePose(raw, fallback) {
    const pose = {};
    for (const key of POSE_KEYS) {
      const value = Number(raw?.[key]);
      pose[key] = Number.isFinite(value) ? value : fallback[key];
    }
    return pose;
  }

  function applyStanceConfig(raw, sourceLabel) {
    if (!raw || raw.kind !== 'hobunji_weapon_idle_stances' || !raw.stances) return false;
    for (const key of Object.keys(idleStances)) {
      Object.assign(idleStances[key], normalizePose(raw.stances[key], DEFAULT_IDLE_STANCES[key]));
    }
    stanceConfigSource = sourceLabel;
    return true;
  }

  async function loadStanceConfig() {
    if (stanceConfigLoadStarted) return;
    stanceConfigLoadStarted = true;

    try {
      const response = await fetch(STANCE_CONFIG_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = await response.json();
      if (!applyStanceConfig(parsed, 'committed-json')) throw new Error('schema mismatch');
    } catch (error) {
      window.__farmLog?.(`[weapon-stance] idle config fallback: ${error?.message || error}`, 'warn');
    }

    try {
      const localRaw = localStorage.getItem(STANCE_LOCAL_STORAGE_KEY);
      if (localRaw) {
        const parsed = JSON.parse(localRaw);
        if (!applyStanceConfig(parsed, 'local-override')) throw new Error('schema mismatch');
      }
    } catch (error) {
      window.__farmLog?.(`[weapon-stance] ignored invalid local idle override: ${error?.message || error}`, 'warn');
    }

    window.__farmLog?.(`[weapon-stance] idle config source=${stanceConfigSource}`, 'combat');
  }

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
        if (!Array.isArray(def.slots)) def.slots = ['hoe'];
        if (!def.slots.includes('weapon')) def.slots.push('weapon');
        def.dmgType = 'blunt';
        def.toolIdleStyle = 'thrust';
      }
      const idleClass = weaponIdleClass(itemKey, def);
      if (idleClass) def.weaponIdleClass = idleClass;
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

  // Compute world orientation from the quaternion hierarchy instead of matrix
  // decomposition. The player rig contains mirrored sprite scales, so the
  // quaternion chain is the safer basis for comparing attachment rotations.
  function hierarchyWorldQuaternion(node) {
    if (!node?.quaternion) return null;
    const chain = [];
    for (let current = node; current; current = current.parent) chain.push(current);
    const worldQ = new THREE.Quaternion();
    worldQ.identity();
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      if (chain[i]?.quaternion) worldQ.multiply(chain[i].quaternion);
    }
    return worldQ.normalize();
  }

  // toolHolder is registered with PlayerBodyTransformComposer as an external
  // root, so facing/composer rotations affect it together with playerMesh.
  // Comparing holder orientation relative to the body cancels those shared
  // rotations while preserving genuine tool-holder animation.
  function relativeHolderQuaternion() {
    const holder = deps?.toolHolder;
    const playerMesh = window.PlayerBodyTransformComposer?.getPlayerMesh?.();
    if (!holder?.quaternion || !playerMesh?.quaternion) return null;

    const holderWorldQ = hierarchyWorldQuaternion(holder);
    const bodyWorldQ = hierarchyWorldQuaternion(playerMesh);
    if (!holderWorldQ || !bodyWorldQ) return null;
    return bodyWorldQ.invert().multiply(holderWorldQ).normalize();
  }

  function holderIsMoving(now) {
    const relativeQ = relativeHolderQuaternion();
    if (!relativeQ) {
      // Do not fall back to raw toolHolder rotation: character facing would
      // then be mistaken for a tool swing, which is the bug this basis avoids.
      lastRelativeHolderQuaternion = null;
      return false;
    }
    if (!lastRelativeHolderQuaternion) {
      lastRelativeHolderQuaternion = relativeQ.clone();
      return false;
    }
    const dot = Math.min(1, Math.abs(lastRelativeHolderQuaternion.dot(relativeQ)));
    const angularStep = 2 * Math.acos(dot);
    lastRelativeHolderQuaternion.copy(relativeQ);
    if (angularStep > 0.004) holderMotionBusyUntil = Math.max(holderMotionBusyUntil, now + 650);
    return now < holderMotionBusyUntil;
  }

  function markCombatVisualBusy(durationS, opts = {}) {
    const baseSeconds = Math.max(0, Number(durationS) || 0);
    const holdSeconds = Math.max(0, Number(opts?.holdS) || 0);
    const safeTailSeconds = 0.75;
    combatBusyUntil = Math.max(
      combatBusyUntil,
      performance.now() + (baseSeconds + holdSeconds + safeTailSeconds) * 1000
    );
  }

  function installCombatVisualHooks() {
    const combatDeps = window.Combat?.deps;
    if (!combatDeps || combatHooksInstalled || combatDeps.__weaponToolStanceVisualHooks) return;

    const wrap = (name, before) => {
      const original = combatDeps[name];
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
    const shape = shapeFor(itemKey, def);
    if (activeSlot !== 'weapon') {
      if (activeSlot === 'hoe' && shape === 'hoe') return idleStances.hoeTool;
      if (def?.animStyle === 'thrust') return idleStances.tool;
      return null;
    }
    const idleClass = weaponIdleClass(itemKey, def);
    if (idleClass === 'heavy') return idleStances.heavyWeapon;
    if (idleClass === 'light') return idleStances.lightWeapon;
    return null;
  }

  // game.js rotates every sweep-style tool's child sprite plane -90 degrees so
  // the same source PNGs line up with sweep animation math. Idle stance poses,
  // however, are authored as the shared visual Neutral pose. Undo that child
  // twist in the holder only while a weapon idle stance is rendered, so axes
  // match hoes in Heavy and fishing maces match spears/pick-shovels in Light.
  function renderedTargetPoseFor(activeSlot, itemKey, def) {
    const targetPose = targetPoseFor(activeSlot, itemKey, def);
    if (!targetPose || activeSlot !== 'weapon' || def?.animStyle !== 'sweep') return targetPose;
    return { ...targetPose, roll: (Number(targetPose.roll) || 0) + 90 };
  }

  function activeState() {
    const activeSlot = deps?.getActiveTool?.() || null;
    const itemKey = activeSlot ? deps?.equipmentSlots?.[activeSlot] : null;
    const def = itemKey ? deps?.TOOL_ITEM_DEFS?.[itemKey] : null;
    const mesh = activeSlot ? deps?.toolMeshMap?.[activeSlot] : null;
    return { activeSlot, itemKey, def, mesh };
  }

  // updateToolMesh writes its pose to toolHolder, not to each tool child.
  // Recover the holder's base orientation by subtracting the normal source
  // neutral, then rebuild it with the target neutral. Position deltas are
  // rotated through that same base so x/y/z remain player-relative.
  function applyRelativeHolderPose(holder, sourcePose, targetPose) {
    const sourceQ = poseQuaternion(sourcePose);
    const targetQ = poseQuaternion(targetPose);
    const baseQ = holder.quaternion.clone().multiply(sourceQ.clone().invert());
    const positionDelta = new THREE.Vector3(
      (targetPose.x || 0) - (sourcePose.x || 0),
      (targetPose.y || 0) - (sourcePose.y || 0),
      (targetPose.z || 0) - (sourcePose.z || 0),
    ).applyQuaternion(baseQ);

    holder.position.add(positionDelta);
    holder.quaternion.copy(baseQ).multiply(targetQ);
  }

  function logState(activeSlot, itemKey, def, stateLabel) {
    const signature = `${activeSlot || '-'}|${itemKey || '-'}|${weaponIdleClass(itemKey, def) || '-'}|${stateLabel}`;
    if (signature === lastDebugSignature) return;
    lastDebugSignature = signature;
    window.__farmLog?.(`[weapon-stance] ${signature}`, 'combat');
  }

  function installHolderMatrixHook() {
    const holder = deps?.toolHolder;
    if (!holder || holderHookInstalled || holder.__weaponToolStanceMatrixHook) return;
    const originalUpdateMatrixWorld = holder.updateMatrixWorld;
    if (typeof originalUpdateMatrixWorld !== 'function') return;

    holder.updateMatrixWorld = function weaponToolStanceUpdateMatrixWorld(force) {
      installCombatVisualHooks();
      stanceApplied = false;

      const now = performance.now();
      const holderMoving = holderIsMoving(now);
      const { activeSlot, itemKey, def, mesh } = activeState();
      const combatBusy = activeSlot === 'weapon' && (combatHoldActive || now < combatBusyUntil);
      const targetPose = renderedTargetPoseFor(activeSlot, itemKey, def);
      const sourcePose = ENGINE_NEUTRAL_POSES[def?.animStyle] || ENGINE_NEUTRAL_POSES.thrust;
      let savedPosition = null;
      let savedQuaternion = null;

      if (mesh && targetPose && !holderMoving && !combatBusy) {
        savedPosition = this.position.clone();
        savedQuaternion = this.quaternion.clone();
        try {
          applyRelativeHolderPose(this, sourcePose, targetPose);
          stanceApplied = true;
        } catch (error) {
          window.__farmLog?.(`[weapon-stance] holder pose failed: ${error.message}`, 'warn');
        }
      }

      const stateLabel = stanceApplied ? 'idle-holder' : combatBusy ? 'combat' : holderMoving ? 'tool-motion' : 'default';
      logState(activeSlot, itemKey, def, stateLabel);

      let result;
      try {
        // Three computes this holder and all descendant tool matrices while the
        // slot-specific stance is temporarily present, so the rendered sprite
        // actually receives the alternate silhouette.
        result = originalUpdateMatrixWorld.call(this, force);
      } finally {
        if (savedPosition && savedQuaternion) {
          // Restore gameplay-local state after descendant matrices are built.
          // matrixWorld intentionally remains the posed render result for this frame.
          this.position.copy(savedPosition);
          this.quaternion.copy(savedQuaternion);
          this.updateMatrix?.();
        }
      }
      return result;
    };

    Object.defineProperty(holder, '__weaponToolStanceMatrixHook', { value: true, configurable: true });
    holderHookInstalled = true;
  }

  function debugSnapshot() {
    const state = activeState();
    const playerMesh = window.PlayerBodyTransformComposer?.getPlayerMesh?.();
    return {
      activeSlot: state.activeSlot,
      itemKey: state.itemKey,
      shape: shapeFor(state.itemKey, state.def),
      weaponIdleClass: weaponIdleClass(state.itemKey, state.def),
      sourceAnimStyle: state.def?.animStyle || null,
      sweepSpriteCompensationDeg: state.activeSlot === 'weapon' && state.def?.animStyle === 'sweep' ? 90 : 0,
      stanceApplied,
      hook: holderHookInstalled ? 'toolHolder.updateMatrixWorld' : 'missing',
      holderMotionBasis: playerMesh ? 'player-body-relative' : 'composer-body-missing',
      holderMotionBusyMs: Math.max(0, Math.round(holderMotionBusyUntil - performance.now())),
      combatBusyMs: Math.max(0, Math.round(combatBusyUntil - performance.now())),
      combatHoldActive,
      stanceConfigSource,
      hoeWeaponEligible: !!deps?.TOOL_ITEM_DEFS?.bronzehoe?.slots?.includes('weapon'),
      hoeDamageType: deps?.TOOL_ITEM_DEFS?.bronzehoe?.dmgType || null,
      poses: {
        tool: { ...idleStances.tool },
        hoeTool: { ...idleStances.hoeTool },
        heavyWeapon: { ...idleStances.heavyWeapon },
        lightWeapon: { ...idleStances.lightWeapon },
      },
    };
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    augmentToolDefinitions();
    installCombatVisualHooks();
    installHolderMatrixHook();
    loadStanceConfig();
    // Do not force inventory/action UI here: sibling systems receive their
    // own init(deps) payloads later in game.js's normal boot sequence.
    window.__farmLog?.(
      `[weapon-stance] initialized hook=${holderHookInstalled ? 'holder-matrix' : 'missing'} motion=player-body-relative hoes=weapon/blunt heavy=hoe+axe light=spear+mace+pick-shovel`,
      'combat'
    );
  }

  window.WeaponToolStances = {
    init,
    refreshDefinitions: augmentToolDefinitions,
    reloadConfig() {
      stanceConfigLoadStarted = false;
      return loadStanceConfig();
    },
    debugSnapshot,
    poses: idleStances,
  };
})();
