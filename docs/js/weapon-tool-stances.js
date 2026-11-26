(() => {
  'use strict';

  // Centralizes the visual language for tools that can also occupy the weapon slot.
  // game.js remains authoritative for attack playback; this module supplies the
  // slot-specific Neutral pose and fixes the sprite-plane basis at render time.
  let deps = null;
  let holderHookInstalled = false;
  let combatHooksInstalled = false;
  let lastHolderPoseOwner = 'waiting'; // Current holder render owner, exposed to the mobile stance debugger.
  let combatHoldActive = false;
  let combatVisualState = null;
  let lastDebugSignature = '';
  let stanceApplied = false;
  let worldUprightApplied = false; // Mobile stance diagnostics: confirms the actual sprite-plane upright correction ran.
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

  const STANCE_CONFIG_URL = 'config/combat/weapon-idle-stances.json?v=20261115torchGripIdle2';
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
    torchHold: Object.freeze({"x":-0.15,"y":0.1472916715500817,"z":0.198510001727785,"pitch":-90,"yaw":0,"bodyYaw":0,"roll":-15,"scale":0.68,"headRelative":false,"bodySink":0,"flailLengthScale":1,"shoulderAim":{"grip":true,"palmNormal":true},"secondaryGrip":{"enabled":false,"percent":50,"primaryPercent":50},"dualWield":{"enabled":false},"offhandIdle":{"enabled":false},"elbows":{"left":{"x":0,"y":-0.10531282069027048,"z":0.04110563392716065},"right":{"x":0.002670316618150828,"y":-0.06015679313571905,"z":0.03473534109483975}},"worldUpright":true}), // Upright artwork, regardless of player yaw.
    topHeavyTool: Object.freeze({ x: 0.21, y: -0.12, z: -0.08, pitch: 17, yaw: -49, bodyYaw: -8, roll: -96 }),
    longHaftedTool: Object.freeze({ x: 0.21, y: -0.12, z: -0.08, pitch: 17, yaw: -49, bodyYaw: -8, roll: -96 }),
    heavyWeapon: Object.freeze({ x: -0.03, y: 0.27, z: 0.02, pitch: -23, yaw: 104, bodyYaw: -15, roll: 89 }),
    lightWeapon: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114, flailLengthScale: 0.6 }),
    dualWieldMain: Object.freeze({ x: -0.09, y: 0, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114, flailLengthScale: 0.6 }),
    dualWieldOffhand: Object.freeze({ x: 0.13, y: -0.04, z: 0.1, pitch: 40, yaw: 88, bodyYaw: -40, roll: -73 }),
  });
  const PREVIOUS_TOP_HEAVY_TOOL_STANCE = Object.freeze({ x: -0.14, y: -0.07, z: -0.18, pitch: -22, yaw: -21, bodyYaw: -8, roll: -99 }); // Recognizes untouched pre-copy browser overrides.
  const PREVIOUS_TORCH_HOLD_STANCES = Object.freeze([0.16, 0].map(y => Object.freeze({ x: 0.13, y, z: 0.03, pitch: 10.31, yaw: 0, bodyYaw: 0, roll: 0 })).concat([Object.freeze({ x: -0.03, y: 0.08, z: 0.17, pitch: 10, yaw: 0, bodyYaw: 0, roll: 0 })])); // The two previously shipped defaults; customized poses keep precedence.
  const PREVIOUS_LIGHT_WEAPON_STANCE = Object.freeze({ x: -0.09, y: -0.08, z: -0.04, pitch: 37, yaw: -68, bodyYaw: -40, roll: -114 });

  // Keep these objects stable so external debug/editor references do not go stale
  // when a fetched config or Local Override replaces their values.
  const idleStances = {
    tool: { ...DEFAULT_IDLE_STANCES.tool },
    hoeTool: { ...DEFAULT_IDLE_STANCES.hoeTool },
    torchHold: { ...DEFAULT_IDLE_STANCES.torchHold }, // Stable editable tool-neutral reference.
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
      const legacyTorch = key === 'torchHold' && sourceLabel === 'local-override' && PREVIOUS_TORCH_HOLD_STANCES.some(old =>
        POSE_KEYS.every(field => Math.abs((Number(incoming?.[field]) || 0) - old[field]) < 1e-9)); // Only untouched old browser defaults adopt the new authored pose.
      const authored = legacyTorch ? DEFAULT_IDLE_STANCES.torchHold : incoming;
      const normalized = normalizePose(authored, baseline);
      if (key === 'lightWeapon' && isPreviousLightWeaponPose(raw.stances[key])) normalized.y = 0; // Migrate only the exact former committed default; authored local overrides remain intact.
      if (key === 'topHeavyTool' && sourceLabel === 'local-override' && POSE_KEYS.every(field =>
        Math.abs((Number(incoming?.[field]) || 0) - PREVIOUS_TOP_HEAVY_TOOL_STANCE[field]) < 1e-9)) {
        Object.assign(normalized, DEFAULT_IDLE_STANCES.topHeavyTool); // An untouched saved default should receive the working Pick-Shovel copy; user edits remain untouched.
      }
      Object.assign(idleStances[key], normalized);
      idleStances[key].worldUpright = typeof authored?.worldUpright === 'boolean' ? authored.worldUpright : !!baseline?.worldUpright; // Preserve authored world-space rotation metadata lost by numeric pose normalization.
      if (key === 'torchHold') {
        const scale = Number(authored?.scale ?? baseline?.scale ?? 1); // Used by the holder matrix hook to match the current authored neutral size.
        idleStances[key].scale = Number.isFinite(scale) && scale > 0 ? scale : 1;
        idleStances[key].shoulderAim = { ...(authored?.shoulderAim || baseline?.shoulderAim || {}) }; // Live procedural hand weights for the resting torch.
        const elbows = authored?.elbows || baseline?.elbows; // Both exported elbow hints remain active in Neutral.
        idleStances[key].elbows = elbows ? { ...elbows, ...(elbows.right ? { right: { ...elbows.right } } : {}) } : {};
      }
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
        stanceConfigLoaded = false;
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
    if (window.HobunjiWeaponSpriteAssemblies?.definitionFor?.(itemKey, def)?.flail) return 'light'; // Previously unclassified standalone flails need a Light Neutral for the authored 60% connector length; explicit Heavy classifications above still win.
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

  const MODULAR_TOOL_IDLE_BY_SLOT = Object.freeze({ axe: 'topHeavyTool', hoe: 'topHeavyTool', shovel: 'longHaftedTool', pick: 'longHaftedTool', harpoon: 'longHaftedTool' }); // Tool-equipped modular weapons borrow the selected tool's Neutral, never their haft donor's weapon Neutral.

  function targetPoseFor(activeSlot, itemKey, def, { dualWield = null } = {}) {
    const shape = shapeFor(itemKey, def);
    if (activeSlot !== 'weapon') {
      if (activeSlot === 'ranged') return null; // game.js/RangedWeapons own the loaded, unloaded, and aim-tracking ranged Neutral, even for dual-role melee shapes.
      if (activeSlot === 'adventuring' && itemKey === 'torch') return idleStances.torchHold; // Dedicated idle state only for a held torch.
      if (def?.modular && MODULAR_TOOL_IDLE_BY_SLOT[activeSlot]) return idleStances[MODULAR_TOOL_IDLE_BY_SLOT[activeSlot]]; // An axe-head spear haft rests as an axe when equipped for woodcutting, for example.
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

  function prepareCombatOptions(rawOpts = {}) {
    const state = activeState();
    const useDualWieldIdle = dualWieldIdleRequested(rawOpts);
    const torchAttack = rawOpts.toolSlot === 'adventuring' && state.activeSlot === 'adventuring' && state.itemKey === 'torch';
    const targetNeutral = torchAttack ? idleStances.lightWeapon : currentCombatNeutral({ dualWield: useDualWieldIdle });
    if (!targetNeutral) return rawOpts;

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

    const idleSink = SAP.idleBodySinkPct(); // The swing eases out of and back into the stance's rest sink (weapon-stance-drop-runtime.js); Windup/Strike may author their own.

    return {
      ...rawOpts,
      anim,
      dirSign: sequence.effectiveSign,
      // Windup/strike are already baked to the exact endpoints the old animation
      // would have reached. power=1 prevents a changed Neutral from rescaling them.
      power: 1,
      pose: {
        neutral: { dualWield: { enabled: true }, ...authoredPose?.neutral, secondaryGrip: { ...authoredPose?.neutral?.secondaryGrip, enabled: false }, ...sequence.neutral, bodySink: idleSink },
        returnNeutral: { ...sequence.returnNeutral, bodySink: idleSink },
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
    const holdS = Math.max(0, Number(opts?.holdS) || 0);
    // The exact clock game.js's triggerWeaponSwingVisual (and every enemy) builds for this swing, so hands, grips and
    // the Neutral blend can't drift from the weapon pose they accompany.
    const { totalS, wf, sf, hf } = SAP.swingTimeline({}, duration, windupFrac, strikeFrac, holdS);
    const activeMirrorSign = opts?.dirSign === -1 ? -1 : 1;
    const neutralMirrorSign = Number(opts?.pose?.neutralMirrorSign) === -1 ? -1 : 1;
    const returnNeutralMirrorSign = Number(opts?.pose?.returnNeutralMirrorSign) === -1 ? -1 : 1;
    combatVisualState = {
      slot: opts.toolSlot || 'weapon', // Only the slot that began this attack can draw its baked neutral.
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
      flailPose: opts?.pose || null, // Reused to sample connector reach from the exact baked swing (no extra per-frame pose allocations).
      flailSequence: opts?.sequence || 'attack', // Used for the same load/fire timing as the existing pose blend.
      completedAt: 0,
      clearQueued: false,
    };
    combatHoldActive = !!held;
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
    const gameRemainingS = Number(window.Combat?.deps?.getWeaponAttackTimeline?.(state.slot === 'adventuring')?.remainingS);
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
    if (activeSlot === visual?.slot && visual.anim === 'sweep') return neutralWeightForVisual(visual);
    return !visual && (stanceApplied || activeSlot === 'weapon') && def?.animStyle === 'sweep' ? 1 : 0;
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
      worldUprightApplied = false;

      const now = performance.now();
      const { activeSlot, itemKey, def, mesh } = activeState();
      const visual = combatVisualState?.slot === activeSlot ? advanceCombatVisual(now) : null;
      const authoredToolActionActive = activeSlot !== 'weapon' && holder.userData?.authoredToolActionActive === true; // game.js owns the full non-weapon swing lifetime, including legacy motions.
      const attackInProgress = !!visual && (activeSlot === 'weapon' || authoredToolActionActive);
      const torchIdle = activeSlot === 'adventuring' && itemKey === 'torch'; // Only an actual torch action overrides its authored upright hold.
      const idleDualState = !attackInProgress ? window.HobunjiHandToolGrips?.currentDualWieldAnimationState?.() : null;
      const idleDualWield = !!idleDualState && idleDualState.source === 'dual-wield-idle' && idleDualState.influence > 0.0001;
      const targetPose = targetPoseFor(activeSlot, itemKey, def, { dualWield: idleDualWield });
      const sourcePose = ENGINE_NEUTRAL_POSES[def?.animStyle] || ENGINE_NEUTRAL_POSES.thrust;
      let savedPosition = null;
      let savedQuaternion = null;
      let savedScale = null; // Restored after each matrix bake so idle scaling never accumulates across frames.
      let savedPlaneRotationZ = null;
      const toolPlane = mesh?.userData?.toolPlane || null;

      if (mesh && targetPose && !authoredToolActionActive && !attackInProgress) {
        savedPosition = this.position.clone();
        savedQuaternion = this.quaternion.clone();
        try {
          const stanceFrame = applyRelativeHolderPose(this, sourcePose, targetPose);
          if (activeSlot === 'weapon' || torchIdle) deps?.scaleToolWorldPointAroundPlayerCentroid?.(this.position, stanceFrame.yawRad); // Apply the shoulder-derived orbit before the torch's grip-pivot correction, just as game.js does for swings.
          if (torchIdle && Number.isFinite(targetPose.scale) && targetPose.scale > 0) {
            savedScale = this.scale.clone();
            this.scale.multiplyScalar(targetPose.scale); // Scale the neutral torch without changing subsequent swing/throw frames.
            const grip = window.HobunjiHandToolGrips?.primaryGripHolderPointForTool?.('torch', 'melee'); // Same grip-anchored scale pivot as the Attack Editor.
            SAP.anchorScaleAtPoint?.(this, grip, targetPose.scale);
          }
          stanceApplied = true;
        } catch (error) {
          window.__farmLog?.(`[weapon-stance] holder pose failed: ${error.message}`, 'warn');
        }
      }
      if (mesh && torchIdle && !savedScale && (authoredToolActionActive || attackInProgress)
          && window.AdventuringTools?.isThrowSequenceActive?.() === true
          && Number.isFinite(targetPose?.scale) && targetPose.scale > 0) {
        // The shared thrown-weapon animation has no torch-specific Neutral scale.
        // Bake the exact idle size into the live Strike matrix, then restore the
        // mutable holder so this never accumulates or resizes other weapon throws.
        savedPosition = this.position.clone();
        savedQuaternion = this.quaternion.clone();
        savedScale = this.scale.clone();
        this.scale.multiplyScalar(targetPose.scale);
        const grip = window.HobunjiHandToolGrips?.primaryGripHolderPointForTool?.('torch', 'melee'); // Current handle pivot for the held throw before it releases.
        SAP.anchorScaleAtPoint?.(this, grip, targetPose.scale);
      }

      const clearance = window.HeldGroundPose; // Use the very same raw grip basis as the hand driver, before transient child-plane twist.
      const assembly=window.HobunjiWeaponSpriteAssemblies?.definitionFor?.(itemKey,def);
      const clearanceContext = clearance?.enabled?.() && activeSlot === 'weapon' && !idleDualWield
        && (!assembly || (assembly.flail && !attackInProgress))
        ? window.ProceduralHandFrameDriver?.groundPoseContext?.(this,itemKey) : null;
      if(clearanceContext) clearanceContext.flexibleHaft=!!assembly?.flail; // Suspension is solved separately by its existing owner.

      // game.js writes a -90° local-Z twist into the child plane whenever the
      // active animation is sweep. That twist belongs to the sweep motion, not
      // to the shared Heavy/Light Neutral stance. Cancel it at Neutral itself
      // (fully while idle, fading out by windup, fading back in on return)
      // directly on the child plane's own local axis instead of guessing a
      // compensating holder/global Euler rotation.
      if (toolPlane) {
        const neutralWeight = sweepTwistCancelWeight(activeSlot, def, attackInProgress ? visual : null, stanceApplied);
        if (neutralWeight > 0) {
          savedPlaneRotationZ = toolPlane.rotation.z;
          toolPlane.rotation.z += Math.PI / 2 * neutralWeight;
        }
      }

      if (stanceApplied && targetPose?.worldUpright) worldUprightApplied = window.ToolWorldUpright?.apply?.(this, toolPlane, THREE, torchIdle ? -1 : 1) === true; // Torch's flame is authored at PNG -Y; correct that end only, without editing grip data.
      const stateLabel = attackInProgress
        ? `attack-neutral=${visual?.progress?.toFixed?.(2) ?? '0'}`
        : stanceApplied ? 'idle-holder' : authoredToolActionActive ? 'authored-tool-action' : 'default';
      lastHolderPoseOwner = stateLabel;
      logState(activeSlot, itemKey, def, stateLabel);

      let result;
      try {
        if (clearanceContext) {
          const beforePosition=this.position.clone(),beforeQuaternion=this.quaternion.clone();
          if(clearance.constrainWeapon(this,mesh,clearanceContext)) {
            savedPosition ||= beforePosition; savedQuaternion ||= beforeQuaternion;
          }
        } else clearance?.clear?.(); // Unequip, unsupported assemblies or A/B disable restore the original geometry.
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
          if (savedScale) this.scale.copy(savedScale);
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
    const visual = combatVisualState?.slot === activeSlot ? combatVisualState : null; // The hands read only their own slot's live animation.
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
    const idlePose = (activeSlot === 'weapon' || (activeSlot === 'adventuring' && itemKey === 'torch')) ? targetPoseFor(activeSlot, itemKey, def) : null; // Live weapon or torch neutral, never the torch swing pose.
    runtimeState.idlePose = !visual && activeSlot === 'adventuring' && itemKey === 'torch' ? idlePose : null; // Procedural right elbow and palm targeting read this without another snapshot allocation.
    runtimeState.flailLengthScale = visual?.flailPose
      ? SAP.flailLengthScaleAt(visual.flailPose, visual.progress, visual.wf, visual.sf, visual.hf, visual.flailSequence, visual.poseScale)
      : SAP.validFlailLength(idlePose?.flailLengthScale); // The flail renderer reads this only for the player's currently equipped cached handle.
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
    const visual = combatVisualState?.slot === state.activeSlot ? combatVisualState : null;
    return {
      activeSlot: state.activeSlot,
      itemKey: state.itemKey,
      shape: shapeFor(state.itemKey, state.def),
      weaponIdleClass: weaponIdleClass(state.itemKey, state.def),
      toolIdlePreset: state.def?.modular && state.activeSlot !== 'weapon' ? (MODULAR_TOOL_IDLE_BY_SLOT[state.activeSlot] || null) : null, // Visible in the existing mobile stance inspector.
      toolWorkStyle: state.def?.modular ? window.ToolActivityStages?.workStyleFor?.(state.activeSlot) || state.def.animStyle : null, // Reports the live head/shaft work style without opening a console.
      sourceAnimStyle: state.def?.animStyle || null,
      stanceApplied,
      worldUprightApplied, // Existing mobile debug inspector can distinguish corrected torch art from an absent sprite plane.
      hook: holderHookInstalled ? 'toolHolder.updateMatrixWorld' : 'missing',
      holderMotionBasis: 'explicit-authored-tool-action', // Movement rotation is never treated as tool work.
      holderMotionBusyMs: 0, // Retain the legacy mobile debug field without a misleading motion cooldown.
      holderPoseOwner: lastHolderPoseOwner, // Shows the render owner in Pixel Probe diagnostics.
      combatHoldActive,
      combatNeutralInjected: !!visual,
      combatAnim: visual?.anim || null,
      combatProgress: visual?.progress ?? null,
      combatWindupFrac: visual?.wf ?? null,
      combatStrikeFrac: visual?.sf ?? null,
      combatHoldFrac: visual?.hf ?? null,
      combatPoseScale: visual?.poseScale ?? 1,
      flailLengthScale: getRuntimeState().flailLengthScale, // Existing debugSnapshot stays in parity with the allocation-free runtime view.
      idlePose: getRuntimeState().idlePose, // Keep diagnostics in exact parity with the borrowed runtime view, including no-torch null.
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
        torchHold: { ...idleStances.torchHold }, // Expose the authored upright mode in mobile stance diagnostics.
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
    if (combatVisualState?.slot === activeSlot) {
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

  // True while the player holds a weapon in its Light/Heavy idle stance or is mid-attack with it: the poses the stance-drop runtime
  // (weapon-stance-drop-runtime.js) lowers the whole body for. Allocation-free; same put-away/seated gates as idleBodyYawSnapshot.
  function stanceEngaged() {
    if (window.__hobunjiFurnitureDebug?.sitInteraction && window.__hobunjiFurnitureDebug.sitInteraction.phase !== 'out') return false;
    const heldMode = deps?.getHeldMode?.();
    if (heldMode != null && heldMode !== 'tool') return false;
    const slot = deps?.getActiveTool?.();
    if (slot === 'adventuring') return deps?.toolHolder?.userData?.authoredToolActionActive === true && combatVisualState?.slot === slot;
    if (slot !== 'weapon') return false;
    if (combatVisualState?.slot === slot) return true;
    const itemKey = deps?.equipmentSlots?.weapon || null;
    const idleClass = itemKey ? weaponIdleClass(itemKey, deps?.TOOL_ITEM_DEFS?.[itemKey]) : null;
    return idleClass === 'light' || idleClass === 'heavy';
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
    toolNeutralPose: (slot, itemKey, def) => slot === 'weapon' ? null : targetPoseFor(slot, itemKey, def), // Shared tool-neutral authority for modular work-stage Neutral→attack blending.
    prepareCombatOptions,
    sweepTwistCancelWeight,
    idleBodyYawSnapshot,
    stanceEngaged,
    // Borrowed read-only view: consume immediately; use debugSnapshot for retained diagnostics.
    getRuntimeState,
    debugSnapshot,
    lastHolderMatrixWorld: () => lastBakedHolderMatrixWorld ? lastBakedHolderMatrixWorld.clone() : null,
    invalidateHolderMatrixWorld: () => { lastBakedHolderMatrixWorld = null; }, // Map/cinematic handoffs discard world-space sockets from the outgoing scene.
    poses: idleStances,
  };
})();
