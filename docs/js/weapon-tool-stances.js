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
  let stanceConfigRequest = null; // Shares the in-flight JSON fetch across repeated init/reload calls.
  let stanceConfigLoaded = false; // Prevents repeated fetches after a successful committed-config load.
  let stanceRetryTimer = null; // Retries transient fetch failures without requiring a page reload.
  let stanceConfigFailures = 0; // Powers bounded exponential retry delays and diagnostic snapshots.
  let stanceConfigLastError = null; // Exposes the latest recoverable fetch error to mobile debug UI.
  let localStanceOverride = null; // Reapplied after each successful fetch so local changes keep priority.
  let stanceConfigSource = 'built-in-defaults';
  // toolHolder.matrixWorld as actually baked by the most recent
  // updateMatrixWorld() call below (idle stance included, when one applied).
  // Local position/quaternion are reverted again immediately after that same
  // call (see installHolderMatrixHook), so any consumer that calls Three.js's
  // own world-space accessors (updateWorldMatrix/getWorldPosition/
  // localToWorld) on toolHolder afterward recomputes matrixWorld from the
  // reverted, un-stanced local transform instead. Cached here so a consumer
  // that needs the pose actually rendered this frame (e.g. the procedural
  // hand socket sync) can read it without triggering that recompute.
  let lastBakedHolderMatrixWorld = null;

  const STANCE_CONFIG_URL = 'config/combat/weapon-idle-stances.json?v=20261017toolstance1';
  const STANCE_LOCAL_STORAGE_KEY = 'hobunji.weaponIdleStances.v1';
  // The pose schema, the legacy rest poses and the stance-baking policy (power,
  // spacing, Neutral handedness) are window.SharedAttackPose's, shared with
  // EnemyWeaponStances so the player and every BanditCombat humanoid bake an
  // attack against a Light/Heavy stance identically.
  const SAP = window.SharedAttackPose;
  const POSE_KEYS = SAP.POSE_KEYS;
  const normalizePose = SAP.normalizePose;

  // game.js's legacy rest poses. These remain the source basis for ordinary tool
  // mode (the idle holder pose below).
  const ENGINE_NEUTRAL_POSES = Object.freeze({
    thrust: SAP.STYLE_NEUTRAL_POSE.thrust,
    sweep: SAP.STYLE_NEUTRAL_POSE.sweep,
    chop: SAP.STYLE_NEUTRAL_POSE.chop,
  });

  // Mirrors docs/config/combat/weapon-idle-stances.json so a missing fetch never
  // makes the stance system disappear. The attack editor authors the same schema.
  const DEFAULT_IDLE_STANCES = Object.freeze({
    tool: Object.freeze({ x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, bodyYaw: 0, roll: 0 }),
    hoeTool: Object.freeze({ x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, bodyYaw: 0, roll: -95 }),
    topHeavyTool: Object.freeze({ x: -0.14, y: -0.07, z: -0.18, pitch: -22, yaw: -21, bodyYaw: -8, roll: -99 }),
    longHaftedTool: Object.freeze({ x: 0.21, y: -0.12, z: -0.08, pitch: 17, yaw: -49, bodyYaw: -8, roll: -96 }),
    heavyWeapon: Object.freeze({ x: -0.03, y: 0.27, z: 0.02, pitch: -23, yaw: 104, bodyYaw: -15, roll: 89 }),
    lightWeapon: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),
    dualWieldMain: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 }),
    dualWieldOffhand: Object.freeze({ x: 0.13, y: -0.04, z: 0.1, pitch: 40, yaw: 88, bodyYaw: -40, roll: -73 }),
  });
  const PREVIOUS_LIGHT_WEAPON_STANCE = Object.freeze({ x: -0.09, y: -0.08, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 });

  // Keep these objects stable so external debug/editor references do not go stale
  // when a fetched config or Local Override replaces their values.
  const idleStances = {
    tool: { ...DEFAULT_IDLE_STANCES.tool },
    hoeTool: { ...DEFAULT_IDLE_STANCES.hoeTool },
    topHeavyTool: { ...DEFAULT_IDLE_STANCES.topHeavyTool },
    longHaftedTool: { ...DEFAULT_IDLE_STANCES.longHaftedTool },
    heavyWeapon: { ...DEFAULT_IDLE_STANCES.heavyWeapon },
    lightWeapon: { ...DEFAULT_IDLE_STANCES.lightWeapon },
    dualWieldMain: { ...DEFAULT_IDLE_STANCES.dualWieldMain },
    dualWieldOffhand: { ...DEFAULT_IDLE_STANCES.dualWieldOffhand },
  };

  function clonePose(pose) {
    return normalizePose(pose, {});
  }

  function isPreviousLightWeaponPose(raw) {
    return POSE_KEYS.every(key => Math.abs((Number(raw?.[key]) || 0) - PREVIOUS_LIGHT_WEAPON_STANCE[key]) < 1e-9);
  }

  function applyStanceConfig(raw, sourceLabel) {
    if (!raw || raw.kind !== 'hobunji_weapon_idle_stances' || !raw.stances) return false;
    for (const key of Object.keys(idleStances)) {
      const incoming = raw.stances[key]; // Only explicit local overrides should replace a committed stance.
      if (sourceLabel === 'local-override' && (!incoming || typeof incoming !== 'object')) continue;
      const baseline = sourceLabel === 'local-override' ? idleStances[key] : DEFAULT_IDLE_STANCES[key]; // Missing local channels inherit the actual loaded stance.
      const normalized = normalizePose(incoming, baseline);
      if (key === 'lightWeapon' && isPreviousLightWeaponPose(raw.stances[key])) normalized.y = 0; // Migrate only the exact former committed default; authored local overrides remain intact.
      Object.assign(idleStances[key], normalized);
    }
    stanceConfigSource = sourceLabel;
    return true;
  }

  function hasCompleteCommittedStances(config) {
    return config?.kind === 'hobunji_weapon_idle_stances'
      && config.stances && typeof config.stances === 'object'
      && Object.keys(idleStances).every(key => POSE_KEYS.every(field =>
        typeof config.stances[key]?.[field] === 'number' && Number.isFinite(config.stances[key][field])));
  }

  function loadLocalStanceOverride() {
    try {
      const saved = localStorage.getItem(STANCE_LOCAL_STORAGE_KEY); // Existing saved stance settings, available even if the network is offline.
      localStanceOverride = saved ? JSON.parse(saved) : null;
      if (localStanceOverride && !applyStanceConfig(localStanceOverride, 'local-override')) throw new Error('schema mismatch');
    } catch (error) {
      localStanceOverride = null;
      window.__farmLog?.(`[weapon-stance] ignored invalid local idle override: ${error?.message || error}`, 'warn');
    }
  }

  function loadStanceConfig({ force = false } = {}) {
    if (stanceConfigRequest) return stanceConfigRequest;
    if (stanceConfigLoaded && !force) return Promise.resolve(true);
    if (stanceRetryTimer !== null && !force) return Promise.resolve(false); // Respect scheduled backoff across repeated EquipmentPanel init calls.
    if (stanceRetryTimer !== null) {
      clearTimeout(stanceRetryTimer);
      stanceRetryTimer = null;
    }

    stanceConfigRequest = (async () => {
      const controller = typeof AbortController === 'function' ? new AbortController() : null; // Bounds stalled requests so retries can actually happen.
      const deadline = controller ? setTimeout(() => controller.abort(), 10000) : null; // Ten-second network deadline for each attempt.
      try {
        const response = await fetch(STANCE_CONFIG_URL, { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = await response.json();
        if (!hasCompleteCommittedStances(parsed) || !applyStanceConfig(parsed, 'committed-json')) throw new Error('incomplete stance config');
        if (localStanceOverride) applyStanceConfig(localStanceOverride, 'local-override');
        stanceConfigLoaded = true;
        stanceConfigFailures = 0;
        stanceConfigLastError = null;
        window.__farmLog?.(`[weapon-stance] idle config source=${stanceConfigSource}`, 'combat');
        return true;
      } catch (error) {
        stanceConfigLastError = String(error?.message || error);
        stanceConfigFailures += 1;
        const retryMs = Math.min(30000, 1000 * (2 ** Math.min(stanceConfigFailures - 1, 5))); // Back off up to 30s; keep recovering during long sessions.
        window.__farmLog?.(`[weapon-stance] idle config unavailable (${stanceConfigLastError}); retry in ${retryMs}ms`, 'warn');
        stanceRetryTimer = setTimeout(() => {
          stanceRetryTimer = null;
          void loadStanceConfig();
        }, retryMs);
        return false;
      } finally {
        if (deadline !== null) clearTimeout(deadline);
      }
    })().finally(() => { stanceConfigRequest = null; });
    return stanceConfigRequest;
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
    if (def?.weaponIdleClass === 'heavy' || def?.weaponIdleClass === 'light') return def.weaponIdleClass;
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

  function targetPoseFor(activeSlot, itemKey, def, { dualWield = null } = {}) {
    const shape = shapeFor(itemKey, def);
    if (activeSlot !== 'weapon') {
      if (shape === 'hoe' || shape === 'hatchet' || shape === 'fishingmace') return idleStances.topHeavyTool; // Head-weighted tools share one carried stance.
      if (shape === 'fishingspear' || shape === 'pickshovel') return idleStances.longHaftedTool; // Same carry, pitched up 10° and gripped nearer the haft's middle.
      if (def?.animStyle === 'thrust') return idleStances.tool;
      return null;
    }
    const idleClass = weaponIdleClass(itemKey, def);
    if (dualWield !== false && window.HobunjiHandToolGrips?.isDualWieldWeapon?.(shape || itemKey)) return idleStances.dualWieldMain; // Dual Wield rests in its explicitly authored light-style main-hand stance.
    if (idleClass === 'heavy') return idleStances.heavyWeapon;
    if (idleClass === 'light') return idleStances.lightWeapon;
    return null;
  }

  function currentCombatNeutral(options = {}) {
    const state = activeState();
    if (state.activeSlot !== 'weapon') return null;
    const pose = targetPoseFor(state.activeSlot, state.itemKey, state.def, options);
    return pose ? clonePose(pose) : null;
  }

  function dualWieldIdleRequested(rawOpts = {}) {
    const raw = rawOpts?.pose?.neutral?.dualWield;
    const state = activeState(); // Neutral metadata is used only by a weapon that actually supports a pair.
    return window.HobunjiHandToolGrips?.isDualWieldWeapon?.(shapeFor(state.itemKey, state.def) || state.itemKey) === true
      && (raw == null || raw === true || raw?.enabled === true);
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

  function prepareCombatOptions(rawOpts = {}) {
    const state = activeState();
    const useDualWieldIdle = dualWieldIdleRequested(rawOpts);
    const targetNeutral = currentCombatNeutral({ dualWield: useDualWieldIdle });
    if (!targetNeutral || state.activeSlot !== 'weapon') return rawOpts || {};

    const anim = rawOpts.anim || state.def?.animStyle || 'thrust';
    const authoredPose = rawOpts.pose && typeof rawOpts.pose === 'object' ? rawOpts.pose : null;
    const powerValue = Number(rawOpts.power);
    const power = Number.isFinite(powerValue) ? powerValue : 1;

    // The stance policy (legacy-arc / authored endpoints with power baked in, the shared melee spacing calibration,
    // the sign rule, and Heavy weapons' alternating start/return Neutral) is SharedAttackPose.bakeStanceSequence,
    // the same function every enemy bakes with. Only the hand-flag decoration below is player-side.
    const sequence = SAP.bakeStanceSequence(anim, authoredPose, rawOpts.dirSign === -1 ? -1 : 1, power, targetNeutral, {
      alternatesHeavyNeutral: weaponIdleClass(state.itemKey, state.def) === 'heavy',
      meleeSpacing: rawOpts.meleeSpacing !== false,
    });

    return {
      ...rawOpts,
      anim,
      dirSign: sequence.effectiveSign,
      // Windup/strike are already baked to the exact endpoints the old animation
      // would have reached. power=1 prevents a changed Neutral from rescaling them.
      power: 1,
      pose: {
        neutral: { dualWield: { enabled: true }, ...authoredPose?.neutral, secondaryGrip: { ...authoredPose?.neutral?.secondaryGrip, enabled: false }, ...sequence.neutral },
        returnNeutral: sequence.returnNeutral,
        neutralMirrorSign: sequence.startNeutralSign,
        returnNeutralMirrorSign: sequence.returnNeutralSign,
        windup: { secondaryGrip: { enabled: true, percent: 50, primaryPercent: 50 }, dualWield: { enabled: true }, ...sequence.windup },
        strike: { secondaryGrip: { enabled: true, percent: 50, primaryPercent: 50 }, dualWield: { enabled: true }, ...sequence.strike },
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
    const activeMirrorSign = opts?.dirSign === -1 ? -1 : 1;
    const neutralMirrorSign = Number(opts?.pose?.neutralMirrorSign) === -1 ? -1 : 1;
    const returnNeutralMirrorSign = Number(opts?.pose?.returnNeutralMirrorSign) === -1 ? -1 : 1;
    combatVisualState = {
      anim: opts?.anim || activeState().def?.animStyle || 'thrust',
      dirSign: activeMirrorSign,
      neutralMirrorSign,
      returnNeutralMirrorSign,
      totalS,
      wf,
      sf,
      hf,
      elapsedS: 0,
      lastNow: performance.now(),
      held: !!held,
      windupSlowdown: Math.max(0, Number(opts?.windupSlowdown) || 0),
      poseScale: 1, // Used after a partial held release so stance/shoulder compensation follows the same Neutral→Windup fraction as the weapon pose.
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
    // game.js owns the swing clock and caps its frame dt, so on slow frames the body/tool fall
    // behind wall time. Follow its timeline whenever it is live; a wall-clock step would run the
    // hands, grips and Neutral blend ahead of the pose the editor shows for the same phase.
    const gameRemainingS = Number(window.Combat?.deps?.getWeaponAttackTimeline?.()?.remainingS);
    if (Number.isFinite(gameRemainingS) && gameRemainingS > 0) {
      const gameElapsedS = Math.max(0, state.totalS - gameRemainingS);
      state.elapsedS = Math.min(state.held ? windupEndS : state.totalS, Math.max(state.elapsedS, gameElapsedS));
    } else if (state.held) state.elapsedS = Math.min(windupEndS, state.elapsedS + dt);
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
    const poseScale = Math.max(0, Math.min(1, Number(state.poseScale ?? 1) || 0)); // Used to keep partial-release shoulder/stance influence proportional to the released pose.
    if (p <= state.wf) {
      if (state.wf <= 1e-6) return 1 - poseScale;
      const rawWindupT = p / state.wf;
      const poseT = window.Combat?.windupPoseProgress?.(rawWindupT, state.windupSlowdown) ?? rawWindupT;
      return 1 - poseT * poseScale;
    }
    if (p <= state.hf) return 1 - poseScale;
    const returnT = Math.max(0, Math.min(1, (p - state.hf) / Math.max(1e-6, 1 - state.hf))); // Used to blend the partial active pose back to full Neutral during recovery.
    return (1 - poseScale) + poseScale * returnT;
  }

  // How much of the sweep style's -90° in-plane twist to cancel this frame (1 = fully at Neutral). Weapons fade it
  // with their attack. Tool slots (axe, fishing mace, ...) only cancel it while their idle stance is what is drawn:
  // the Attack Editor cancels it at every sweep-style Neutral, so an axe at rest would otherwise sit turned 90° about
  // its own face while the hands keep the editor's grip frame. Their own swings suppress the stance and keep the twist.
  function sweepTwistCancelWeight(activeSlot, def, visual, stanceApplied) {
    if (activeSlot !== 'weapon' && !stanceApplied) return 0;
    if (activeSlot === 'weapon' && visual?.anim === 'sweep') return neutralWeightForVisual(visual);
    return !visual && def?.animStyle === 'sweep' ? 1 : 0;
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
          const requestedPoseProgress = Number(args?.[0]?.poseProgress);
          if (Number.isFinite(requestedPoseProgress)) {
            // game.js slices the numeric pose to this exact partial endpoint
            // and jumps its raw timeline to Windup. Mirror both the timeline
            // and amplitude so stance/shoulder/grip consumers cannot jump to
            // a 100% Windup while the weapon itself releases from a partial one.
            const requestedPoseScale = Math.max(0, Math.min(1, requestedPoseProgress)); // Used by neutralWeightForVisual and exported runtime state after release.
            combatVisualState.elapsedS = combatVisualState.wf * combatVisualState.totalS;
            combatVisualState.progress = combatVisualState.wf;
            combatVisualState.windupSlowdown = 0;
            combatVisualState.poseScale = requestedPoseScale;
          }
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
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(baseQ); // The pose frame's forward axis: lets per-axis species orbits scale its lateral/forward axes.
    return { yawRad: Math.atan2(facing.x, facing.z) };
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
      const idleDualState = !attackInProgress ? window.HobunjiHandToolGrips?.currentDualWieldAnimationState?.() : null;
      const idleDualWield = !!idleDualState && idleDualState.source === 'dual-wield-idle' && idleDualState.influence > 0.0001;
      const targetPose = targetPoseFor(activeSlot, itemKey, def, { dualWield: idleDualWield });
      const sourcePose = ENGINE_NEUTRAL_POSES[def?.animStyle] || ENGINE_NEUTRAL_POSES.thrust;
      let savedPosition = null;
      let savedQuaternion = null;
      let savedPlaneRotationZ = null;
      const toolPlane = mesh?.userData?.toolPlane || null;

      if (mesh && targetPose && !holderMoving && !attackInProgress) {
        savedPosition = this.position.clone();
        savedQuaternion = this.quaternion.clone();
        try {
          const stanceFrame = applyRelativeHolderPose(this, sourcePose, targetPose);
          if (activeSlot === 'weapon') deps?.scaleToolWorldPointAroundPlayerCentroid?.(this.position, stanceFrame.yawRad); // Weapon idle uses the same finished-point centroid orbit as attacks.
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
      if (toolPlane) {
        const neutralWeight = sweepTwistCancelWeight(activeSlot, def, visual, stanceApplied);
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
        lastBakedHolderMatrixWorld = this.matrixWorld.clone();
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

  const runtimeState = {}; // Reused by hot hand consumers; refreshed from the owner on every read, never from a diagnostic cache.

  function getRuntimeState() {
    const activeSlot = deps?.getActiveTool?.() || null; // Resolves the current equipment slot for the borrowed runtime view.
    const itemKey = activeSlot ? deps?.equipmentSlots?.[activeSlot] : null; // Resolves the current tool without allocating activeState().
    const def = itemKey ? deps?.TOOL_ITEM_DEFS?.[itemKey] : null; // Supplies the authored shape and animation style below.
    const visual = combatVisualState; // Reads the same live animation state as debugSnapshot, without advancing its clock.
    runtimeState.activeSlot = activeSlot;
    runtimeState.itemKey = itemKey;
    runtimeState.shape = shapeFor(itemKey, def);
    runtimeState.sourceAnimStyle = def?.animStyle || null;
    runtimeState.combatNeutralInjected = !!visual;
    runtimeState.combatAnim = visual?.anim || null;
    runtimeState.combatProgress = visual?.progress ?? null;
    runtimeState.combatWindupFrac = visual?.wf ?? null;
    runtimeState.combatStrikeFrac = visual?.sf ?? null;
    runtimeState.combatHoldFrac = visual?.hf ?? null;
    runtimeState.combatPoseScale = visual?.poseScale ?? 1; // Used by hand/shoulder consumers to mirror partial held releases.
    runtimeState.combatDirSign = visual?.dirSign ?? 1;
    runtimeState.combatNeutralMirrorSign = visual?.neutralMirrorSign ?? 1;
    runtimeState.combatReturnNeutralMirrorSign = visual?.returnNeutralMirrorSign ?? 1;
    runtimeState.combatNeutralWeight = visual ? neutralWeightForVisual(visual) : null; // Used by shoulder fallback profiles without allocating a debug snapshot.
    runtimeState.sweepPlaneNeutralCompensationDeg = visual?.anim === 'sweep'
      ? Math.round(90 * neutralWeightForVisual(visual))
      : (activeSlot === 'weapon' && def?.animStyle === 'sweep' ? 90 : 0);
    return runtimeState;
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
      combatWindupFrac: visual?.wf ?? null,
      combatStrikeFrac: visual?.sf ?? null,
      combatHoldFrac: visual?.hf ?? null,
      combatPoseScale: visual?.poseScale ?? 1,
      combatDirSign: visual?.dirSign ?? 1,
      combatNeutralMirrorSign: visual?.neutralMirrorSign ?? 1,
      combatReturnNeutralMirrorSign: visual?.returnNeutralMirrorSign ?? 1,
      combatNeutralWeight: visual ? neutralWeightForVisual(visual) : null,
      sweepPlaneNeutralCompensationDeg: visual?.anim === 'sweep'
        ? Math.round(90 * neutralWeightForVisual(visual))
        : (state.activeSlot === 'weapon' && state.def?.animStyle === 'sweep' ? 90 : 0),
      stanceConfigSource,
      stanceConfigLoaded,
      stanceConfigFailures,
      stanceConfigLastError,
      stanceConfigRetryPending: stanceRetryTimer !== null,
      hoeWeaponEligible: !!deps?.TOOL_ITEM_DEFS?.bronzehoe?.slots?.includes('weapon'),
      hoeDamageType: deps?.TOOL_ITEM_DEFS?.bronzehoe?.dmgType || null,
      poses: {
        tool: { ...idleStances.tool },
        hoeTool: { ...idleStances.hoeTool },
        topHeavyTool: { ...idleStances.topHeavyTool },
        longHaftedTool: { ...idleStances.longHaftedTool },
        heavyWeapon: { ...idleStances.heavyWeapon },
        lightWeapon: { ...idleStances.lightWeapon },
      },
    };
  }

  function idleBodyYawSnapshot(target = {}) {
    if (window.__hobunjiFurnitureDebug?.sitInteraction && window.__hobunjiFurnitureDebug.sitInteraction.phase !== 'out') { target.active = false; target.yawDeg = 0; target.reason = 'seated-body'; return target; }
    const heldMode = deps?.getHeldMode?.(); // EquipmentPanel/game inject this so holstered tools cannot leave an invisible weapon stance rotating the body.
    if (heldMode != null && heldMode !== 'tool') {
      target.active = false;
      target.yawDeg = 0;
      target.reason = 'held-equipment-put-away';
      return target;
    }
    const activeSlot = deps?.getActiveTool?.() || null;
    if (activeSlot !== 'weapon') {
      target.active = false;
      target.yawDeg = 0;
      target.reason = 'not-weapon-slot';
      return target;
    }
    if (combatVisualState) {
      target.active = false;
      target.yawDeg = 0;
      target.reason = 'attack-owns-body-yaw';
      return target;
    }
    const itemKey = deps?.equipmentSlots?.[activeSlot] || null;
    const def = itemKey ? deps?.TOOL_ITEM_DEFS?.[itemKey] : null;
    const idleClass = weaponIdleClass(itemKey, def);
    const pose = idleClass === 'light' ? idleStances.lightWeapon : idleClass === 'heavy' ? idleStances.heavyWeapon : null;
    target.active = !!pose;
    target.yawDeg = pose ? Number(pose.bodyYaw) || 0 : 0;
    target.reason = pose ? `${idleClass}-weapon-idle` : 'no-idle-pose';
    return target;
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    augmentToolDefinitions();
    installCombatVisualHooks();
    installHolderMatrixHook();
    if (!stanceConfigLoaded && !stanceConfigRequest) loadLocalStanceOverride();
    void loadStanceConfig();
    window.__farmLog?.(
      `[weapon-stance] initialized hook=${holderHookInstalled ? 'holder-matrix' : 'missing'} neutral=attack-cycle sweep-plane=local hoes=weapon/blunt heavy=hoe+axe light=spear+mace+pick-shovel`,
      'combat'
    );
  }

  window.WeaponToolStances = {
    init,
    refreshDefinitions: augmentToolDefinitions,
    reloadConfig() {
      loadLocalStanceOverride();
      return loadStanceConfig({ force: true });
    },
    combatNeutralPose: currentCombatNeutral,
    prepareCombatOptions,
    sweepTwistCancelWeight,
    idleBodyYawSnapshot,
    // Borrowed read-only view: consume immediately; use debugSnapshot for retained diagnostics.
    getRuntimeState,
    debugSnapshot,
    lastHolderMatrixWorld: () => lastBakedHolderMatrixWorld ? lastBakedHolderMatrixWorld.clone() : null,
    invalidateHolderMatrixWorld: () => { lastBakedHolderMatrixWorld = null; }, // Map/cinematic handoffs discard world-space sockets from the outgoing scene.
    poses: idleStances,
  };
})();
