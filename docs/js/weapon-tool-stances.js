(() => {
  'use strict';

  // Centralizes the visual language for tools that can also occupy the weapon slot.
  // game.js remains authoritative for attack playback; this module supplies the
  // slot-specific Neutral pose and fixes the sprite-plane basis at render time.
  let deps = null;
  let holderHookInstalled = false;
  let combatHooksInstalled = false;
  let lastRelativeHolderQuaternion = null;
  let holderMotionBusyUntil = 0;
  let combatHoldActive = false;
  let combatVisualState = null;
  let lastDebugSignature = '';
  let stanceApplied = false;
  let stanceConfigLoadStarted = false;
  let stanceConfigSource = 'built-in-defaults';

  const STANCE_CONFIG_URL = 'config/combat/weapon-idle-stances.json?v=20260814b';
  const STANCE_LOCAL_STORAGE_KEY = 'hobunji.weaponIdleStances.v1';
  const POSE_KEYS = Object.freeze(['x', 'y', 'z', 'pitch', 'yaw', 'bodyYaw', 'roll']);
  const MIRRORED_POSE_KEYS = new Set(['x', 'yaw', 'bodyYaw', 'roll']);
  const RAD_TO_DEG = 180 / Math.PI;

  // game.js's legacy rest poses. These remain the source basis for ordinary tool
  // mode and for converting old procedural combat arcs into pose-driven attacks.
  const ENGINE_NEUTRAL_POSES = Object.freeze({
    thrust: Object.freeze({ x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, bodyYaw: 0, roll: 0 }),
    sweep: Object.freeze({ x: 0, y: 0, z: 0.16, pitch: 0, yaw: 0, bodyYaw: 0, roll: 0 }),
    chop: Object.freeze({ x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: 2, roll: -82 }),
  });

  // Mirrors docs/config/combat/weapon-idle-stances.json so a missing fetch never
  // makes the stance system disappear. The attack editor authors the same schema.
  const DEFAULT_IDLE_STANCES = Object.freeze({
    tool: Object.freeze({ x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, bodyYaw: 0, roll: 0 }),
    hoeTool: Object.freeze({ x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, bodyYaw: 0, roll: -95 }),
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

  function normalizePose(raw, fallback) {
    const pose = {};
    for (const key of POSE_KEYS) {
      const value = Number(raw?.[key]);
      pose[key] = Number.isFinite(value) ? value : Number(fallback?.[key]) || 0;
    }
    return pose;
  }

  function clonePose(pose) {
    return normalizePose(pose, {});
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

  function activeState() {
    const activeSlot = deps?.getActiveTool?.() || null;
    const itemKey = activeSlot ? deps?.equipmentSlots?.[activeSlot] : null;
    const def = itemKey ? deps?.TOOL_ITEM_DEFS?.[itemKey] : null;
    const mesh = activeSlot ? deps?.toolMeshMap?.[activeSlot] : null;
    return { activeSlot, itemKey, def, mesh };
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

  function currentCombatNeutral() {
    const state = activeState();
    if (state.activeSlot !== 'weapon') return null;
    const pose = targetPoseFor(state.activeSlot, state.itemKey, state.def);
    return pose ? clonePose(pose) : null;
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

  // Bake game.js's old procedural attack endpoints into the generic pose schema.
  // Once an attack has a pose object, game.js's own fourPhaseLerp() can use the
  // active Heavy/Light stance as Neutral for the real Neutral→Windup→Strike→Neutral cycle.
  function legacyProceduralEndpoints(anim, power) {
    const p = Number.isFinite(Number(power)) ? Number(power) : 1;
    if (anim === 'chop') {
      const neutral = ENGINE_NEUTRAL_POSES.chop;
      const rawWindup = { x: -0.18, y: 0.41, z: -0.15, pitch: -165, yaw: 13, bodyYaw: -29, roll: -112 };
      const rawStrike = { x: 0, y: 0, z: 0.12, pitch: 13, yaw: -28, bodyYaw: 29, roll: -91 };
      const scaleFromNeutral = raw => {
        const out = {};
        for (const key of POSE_KEYS) out[key] = neutral[key] + (raw[key] - neutral[key]) * p;
        return out;
      };
      return { windup: scaleFromNeutral(rawWindup), strike: scaleFromNeutral(rawStrike) };
    }
    if (anim === 'sweep') {
      return {
        windup: { x: 0, y: 0, z: 0.16, pitch: 0, yaw: 0, bodyYaw: -2.20 * RAD_TO_DEG * p, roll: 0 },
        strike: { x: 0, y: 0, z: 0.16, pitch: 0, yaw: 0, bodyYaw: 2.12 * RAD_TO_DEG * p, roll: 0 },
      };
    }
    // Thrust's pitch is intentionally not power-scaled in game.js; the reach,
    // lateral offset, tool yaw and body yaw are.
    return {
      windup: { x: 0, y: 0, z: -0.40 * p, pitch: 10.31, yaw: 0, bodyYaw: -45 * p, roll: 0 },
      strike: { x: -0.23 * p, y: 0, z: 0.32 * p, pitch: 1, yaw: -45 * p, bodyYaw: 46 * p, roll: 0 },
    };
  }

  function bakeAuthoredEndpoint(raw, sourceNeutral, power) {
    const out = {};
    for (const key of POSE_KEYS) {
      const rawValue = Number(raw?.[key]);
      const endpoint = Number.isFinite(rawValue) ? rawValue : sourceNeutral[key];
      out[key] = sourceNeutral[key] + (endpoint - sourceNeutral[key]) * power;
    }
    return out;
  }

  // game.js mirrors x/yaw/roll/bodyYaw after interpolating them whenever dirSign
  // is -1. Pre-unmirror Neutral so both forehand and backhand attacks still start
  // and end on the exact same combat idle stance visible before the attack.
  function neutralInputForSign(targetNeutral, sign) {
    const out = {};
    for (const key of POSE_KEYS) {
      out[key] = MIRRORED_POSE_KEYS.has(key) ? targetNeutral[key] * sign : targetNeutral[key];
    }
    return out;
  }

  function prepareCombatOptions(rawOpts = {}) {
    const state = activeState();
    const targetNeutral = currentCombatNeutral();
    if (!targetNeutral || state.activeSlot !== 'weapon') return rawOpts || {};

    const anim = rawOpts.anim || state.def?.animStyle || 'thrust';
    const authoredPose = rawOpts.pose && typeof rawOpts.pose === 'object' ? rawOpts.pose : null;
    const requestedSign = rawOpts.dirSign === -1 ? -1 : 1;
    // Legacy procedural thrust/chop never used combatSwingSign; preserve that.
    const effectiveSign = authoredPose || anim === 'sweep' ? requestedSign : 1;
    const powerValue = Number(rawOpts.power);
    const power = Number.isFinite(powerValue) ? powerValue : 1;
    let windup;
    let strike;

    if (authoredPose) {
      const styleNeutral = ENGINE_NEUTRAL_POSES[anim] || ENGINE_NEUTRAL_POSES.thrust;
      const sourceNeutral = normalizePose(authoredPose.neutral, styleNeutral);
      windup = bakeAuthoredEndpoint(authoredPose.windup, sourceNeutral, power);
      strike = bakeAuthoredEndpoint(authoredPose.strike, sourceNeutral, power);
    } else {
      ({ windup, strike } = legacyProceduralEndpoints(anim, power));
    }

    return {
      ...rawOpts,
      anim,
      dirSign: effectiveSign,
      // Windup/strike are already baked to the exact endpoints the old animation
      // would have reached. power=1 prevents a changed Neutral from rescaling them.
      power: 1,
      pose: {
        neutral: neutralInputForSign(targetNeutral, effectiveSign),
        windup,
        strike,
      },
    };
  }

  function beginCombatVisual(durationS, opts, held) {
    const duration = Math.max(0, Number(durationS) || 0);
    const windupFrac = Number.isFinite(Number(opts?.windupFrac)) ? Number(opts.windupFrac) : 0.16;
    const strikeFrac = Number.isFinite(Number(opts?.strikeFrac)) ? Number(opts.strikeFrac) : 0.28;
    const returnTailS = strikeFrac < 0.999 ? 0 : Math.max(0.12, duration * 0.35);
    const holdS = Math.max(0, Number(opts?.holdS) || 0);
    const totalS = Math.max(0.05, duration + returnTailS + holdS);
    const wf = Math.max(0, Math.min(0.99, windupFrac * duration / totalS));
    const sf = Math.max(wf, Math.min(0.99, strikeFrac * duration / totalS));
    const hf = holdS > 0
      ? Math.min(0.99, sf + holdS / totalS)
      : Math.min(0.99, sf + (1 - sf) * 0.3);
    combatVisualState = {
      anim: opts?.anim || activeState().def?.animStyle || 'thrust',
      totalS,
      wf,
      sf,
      hf,
      elapsedS: 0,
      lastNow: performance.now(),
      held: !!held,
      progress: 0,
      completedAt: 0,
      clearQueued: false,
    };
    combatHoldActive = !!held;
    holderMotionBusyUntil = 0;
  }

  function advanceCombatVisual(now) {
    const state = combatVisualState;
    if (!state) return null;
    const dt = Math.max(0, (now - state.lastNow) / 1000);
    state.lastNow = now;
    const windupEndS = state.wf * state.totalS;
    if (state.held) state.elapsedS = Math.min(windupEndS, state.elapsedS + dt);
    else state.elapsedS = Math.min(state.totalS, state.elapsedS + dt);
    state.progress = Math.max(0, Math.min(1, state.elapsedS / state.totalS));
    if (!state.held && state.progress >= 1 && !state.clearQueued) {
      state.completedAt = now;
      state.clearQueued = true;
      // Clear after the current synchronous render finishes. That keeps every
      // render pass in this frame on the exact attack Neutral, then lets the
      // next updateToolMesh write its ordinary rest transform for the idle hook.
      setTimeout(() => {
        if (combatVisualState === state && state.clearQueued) combatVisualState = null;
      }, 0);
    }
    return state;
  }

  function neutralWeightForVisual(state) {
    if (!state) return 1;
    const p = state.progress;
    if (p <= state.wf) return state.wf > 1e-6 ? 1 - p / state.wf : 0;
    if (p <= state.hf) return 0;
    return Math.max(0, Math.min(1, (p - state.hf) / Math.max(1e-6, 1 - state.hf)));
  }

  function installCombatVisualHooks() {
    const combatDeps = window.Combat?.deps;
    if (!combatDeps || combatHooksInstalled || combatDeps.__weaponToolStanceVisualHooks) return;

    const originalSwing = combatDeps.triggerWeaponSwingVisual;
    if (typeof originalSwing === 'function') {
      combatDeps.triggerWeaponSwingVisual = function weaponToolStanceAwareSwing(durationS, opts = {}) {
        const prepared = prepareCombatOptions(opts);
        beginCombatVisual(durationS, prepared, false);
        return originalSwing.call(this, durationS, prepared);
      };
    }

    const originalHold = combatDeps.triggerWeaponHoldVisual;
    if (typeof originalHold === 'function') {
      combatDeps.triggerWeaponHoldVisual = function weaponToolStanceAwareHold(durationS, opts = {}) {
        const prepared = prepareCombatOptions(opts);
        beginCombatVisual(durationS, prepared, true);
        return originalHold.call(this, durationS, prepared);
      };
    }

    const originalRelease = combatDeps.releaseWeaponSwingHold;
    if (typeof originalRelease === 'function') {
      combatDeps.releaseWeaponSwingHold = function weaponToolStanceAwareRelease(...args) {
        if (combatVisualState) {
          advanceCombatVisual(performance.now());
          combatVisualState.held = false;
          combatVisualState.lastNow = performance.now();
        }
        combatHoldActive = false;
        return originalRelease.apply(this, args);
      };
    }

    const originalCancel = combatDeps.cancelWeaponSwingHold;
    if (typeof originalCancel === 'function') {
      combatDeps.cancelWeaponSwingHold = function weaponToolStanceAwareCancel(...args) {
        combatVisualState = null;
        combatHoldActive = false;
        holderMotionBusyUntil = 0;
        return originalCancel.apply(this, args);
      };
    }

    Object.defineProperty(combatDeps, '__weaponToolStanceVisualHooks', { value: true, configurable: true });
    combatHooksInstalled = true;
  }

  // updateToolMesh writes its ordinary rest pose to toolHolder. Recover that
  // holder basis, remove the legacy rest pose, and rebuild it with the selected
  // idle stance. Attacks do not use this path: their Neutral is injected directly
  // into game.js's own pose-driven four-phase interpolation above.
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
      const visual = advanceCombatVisual(now);
      const { activeSlot, itemKey, def, mesh } = activeState();
      const attackInProgress = activeSlot === 'weapon' && !!visual;
      // Weapon attacks are explicitly tracked by the combat wrappers, so never let
      // their real holder rotation poison the tool-motion idle suppression timer.
      const holderMoving = activeSlot === 'weapon' ? false : holderIsMoving(now);
      const targetPose = targetPoseFor(activeSlot, itemKey, def);
      const sourcePose = ENGINE_NEUTRAL_POSES[def?.animStyle] || ENGINE_NEUTRAL_POSES.thrust;
      let savedPosition = null;
      let savedQuaternion = null;
      let savedPlaneRotationZ = null;
      const toolPlane = mesh?.userData?.toolPlane || null;

      if (mesh && targetPose && !holderMoving && !attackInProgress) {
        savedPosition = this.position.clone();
        savedQuaternion = this.quaternion.clone();
        try {
          applyRelativeHolderPose(this, sourcePose, targetPose);
          stanceApplied = true;
        } catch (error) {
          window.__farmLog?.(`[weapon-stance] holder pose failed: ${error.message}`, 'warn');
        }
      }

      // game.js writes a -90° local-Z twist into the child plane whenever the
      // active animation is sweep. That twist belongs to the sweep motion, not
      // to the shared Heavy/Light Neutral stance. Cancel it at Neutral itself
      // (fully while idle, fading out by windup, fading back in on return)
      // directly on the child plane's own local axis instead of guessing a
      // compensating holder/global Euler rotation.
      if (toolPlane && activeSlot === 'weapon') {
        const idleSweep = !visual && def?.animStyle === 'sweep';
        const attackSweep = visual?.anim === 'sweep';
        const neutralWeight = attackSweep ? neutralWeightForVisual(visual) : (idleSweep ? 1 : 0);
        if (neutralWeight > 0) {
          savedPlaneRotationZ = toolPlane.rotation.z;
          toolPlane.rotation.z += Math.PI / 2 * neutralWeight;
        }
      }

      const stateLabel = attackInProgress
        ? `attack-neutral=${visual?.progress?.toFixed?.(2) ?? '0'}`
        : stanceApplied ? 'idle-holder' : holderMoving ? 'tool-motion' : 'default';
      logState(activeSlot, itemKey, def, stateLabel);

      let result;
      try {
        result = originalUpdateMatrixWorld.call(this, force);
      } finally {
        if (savedPlaneRotationZ != null && toolPlane) {
          toolPlane.rotation.z = savedPlaneRotationZ;
          toolPlane.updateMatrix?.();
        }
        if (savedPosition && savedQuaternion) {
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
    const visual = combatVisualState;
    return {
      activeSlot: state.activeSlot,
      itemKey: state.itemKey,
      shape: shapeFor(state.itemKey, state.def),
      weaponIdleClass: weaponIdleClass(state.itemKey, state.def),
      sourceAnimStyle: state.def?.animStyle || null,
      stanceApplied,
      hook: holderHookInstalled ? 'toolHolder.updateMatrixWorld' : 'missing',
      holderMotionBasis: playerMesh ? 'player-body-relative' : 'composer-body-missing',
      holderMotionBusyMs: Math.max(0, Math.round(holderMotionBusyUntil - performance.now())),
      combatHoldActive,
      combatNeutralInjected: !!visual,
      combatAnim: visual?.anim || null,
      combatProgress: visual?.progress ?? null,
      combatNeutralWeight: visual ? neutralWeightForVisual(visual) : null,
      sweepPlaneNeutralCompensationDeg: visual?.anim === 'sweep'
        ? Math.round(90 * neutralWeightForVisual(visual))
        : (state.activeSlot === 'weapon' && state.def?.animStyle === 'sweep' ? 90 : 0),
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
    window.__farmLog?.(
      `[weapon-stance] initialized hook=${holderHookInstalled ? 'holder-matrix' : 'missing'} neutral=attack-cycle sweep-plane=local hoes=weapon/blunt heavy=hoe+axe light=spear+mace+pick-shovel`,
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
    combatNeutralPose: currentCombatNeutral,
    prepareCombatOptions,
    debugSnapshot,
    poses: idleStances,
  };
})();
