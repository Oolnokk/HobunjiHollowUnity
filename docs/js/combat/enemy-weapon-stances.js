(() => {
  'use strict';

  // Bandits and ghouls already reuse the player's attack-pose math through
  // BanditCombat. This adapter changes only the neutral fed into that math so
  // their equipped melee weapon uses the exact same authored Light/Heavy stance
  // as the player. Attack endpoints, timing, damage, AI, ranged mode, and the
  // post-strike settle window remain owned by BanditCombat.
  //
  // The stance-baking policy itself (legacy arc endpoints, power baking, melee
  // spacing, handedness of the replacement Neutral) is window.SharedAttackPose's
  // -- the same functions the player's WeaponToolStances.prepareCombatOptions
  // calls -- so the two cannot drift. The baked pose only depends on values that
  // are constant for a whole attack, so it is computed once per attack and
  // reused every frame instead of rebuilding a dozen objects per enemy per frame.

  const banditApi = window.BanditCombat; // Public BanditCombat surface wrapped below before game.js injects its runtime dependencies.
  if (!banditApi || banditApi.__enemyWeaponStancesInstalled) return;

  let deps = null; // BanditCombat's injected dependencies; used for shared tool definitions.
  let lastMissingRuntimeLogAt = 0; // Throttles missing WeaponToolStances warnings in the in-game/mobile debug log.
  const POSE_KEYS = window.SharedAttackPose.POSE_KEYS; // Complete pose schema shared with weapon-tool-stances.js.

  function weaponDefinitionFor(entity) {
    const weaponKey = entity?.def?.weaponKey; // Equipped melee weapon id used to resolve the same TOOL_ITEM_DEFS entry the player uses.
    if (!weaponKey) return null;
    return deps?.TOOL_ITEM_DEFS?.[weaponKey] || null;
  }

  function stanceClassFor(entity) {
    let weaponDef = weaponDefinitionFor(entity); // Shared tool definition whose weaponIdleClass is authored/augmented by WeaponToolStances.
    let stanceClass = weaponDef?.weaponIdleClass; // Light/heavy classification consumed by both player and enemy neutral-pose selection.
    if (stanceClass === 'light' || stanceClass === 'heavy') return stanceClass;

    // Keep classification single-sourced. WeaponToolStances owns the fallback
    // shape policy (including future additions), so ask it to refresh the shared
    // definitions rather than copying shape names into this module.
    window.WeaponToolStances?.refreshDefinitions?.();
    weaponDef = weaponDefinitionFor(entity);
    stanceClass = weaponDef?.weaponIdleClass;
    return stanceClass === 'light' || stanceClass === 'heavy' ? stanceClass : null;
  }

  function holdsDualWieldWeapon(entity) {
    const weaponKey = entity?.def?.weaponKey;
    if (!weaponKey) return false;
    const cached = entity._enemyDualWeapon; // The key test normalizes strings, so it runs once per weapon rather than every frame.
    if (cached && cached.key === weaponKey) return cached.value;
    const test = window.HobunjiHandToolGrips?.isDualWieldWeapon; // Same weapon test the player's stance selection and hand grips use.
    if (typeof test !== 'function') return false; // Grip data not loaded yet: ask again next frame.
    const value = test(weaponKey) === true;
    entity._enemyDualWeapon = { key: weaponKey, value };
    return value;
  }

  // The live stance pose object (updated in place when stance config or a Local Override loads), NOT a copy --
  // callers compare its values against their cache instead of re-normalizing it every frame. A dual-wield weapon
  // rests in its authored main-hand stance, exactly like the player's WeaponToolStances.targetPoseFor.
  function stanceSourceFor(entity) {
    const stanceClass = stanceClassFor(entity); // Selects which stable authored player stance object the enemy should use.
    const poses = window.WeaponToolStances?.poses; // Shared Light/Heavy pose objects updated in place when stance config/local overrides load.
    if (!stanceClass || !poses) return null;
    if (poses.dualWieldMain && holdsDualWieldWeapon(entity)) return poses.dualWieldMain;
    return (stanceClass === 'heavy' ? poses.heavyWeapon : poses.lightWeapon) || null;
  }

  // How much of the sweep style's -90 degree plane twist is cancelled by the weapon's resting stance:
  // 1 at rest, fading out over the windup, 0 through strike and hold, fading back in over the return --
  // the same rule the attack editor applies at Neutral. A partial charge (Charged Breaker's poseScale)
  // only fades it by that fraction, exactly like the player's partial release (WeaponToolStances
  // neutralWeightForVisual). BanditCombat publishes the live swing timeline it just drew (windup progress
  // already eased); the action-only formula below is the fallback for a renderer that does not.
  function attackNeutralWeight(entity) {
    const timeline = entity?._banditToolTimeline; // Fresh: the renderer ran immediately before this read.
    if (timeline) {
      if (!timeline.live) return 1;
      const poseScale = Math.max(0, Math.min(1, Number(timeline.poseScale ?? 1) || 0));
      if (timeline.progress <= timeline.wf) return timeline.wf > 0.000001 ? 1 - (timeline.progress / timeline.wf) * poseScale : 1 - poseScale;
      if (timeline.progress > timeline.hf) return (1 - poseScale) + poseScale * Math.max(0, Math.min(1, (timeline.progress - timeline.hf) / Math.max(0.000001, 1 - timeline.hf)));
      return 1 - poseScale;
    }
    const action = entity?._banditAction; // Current staged action whose windup defines how quickly the neutral-plane compensation fades.
    if (!action) return 1;
    const totalS = Math.max(0.0001, (Number(action.windupS) || 0) + (Number(action.strikeS) || 0)); // Safe duration matching BanditCombat's own progress calculation.
    const progress = Math.max(0, Math.min(1, (Number(action.t) || 0) / totalS)); // Current normalized staged-action progress.
    const windupFrac = Math.max(0, Math.min(1, (Number(action.windupS) || 0) / totalS)); // Fraction at which the authored windup endpoint fully takes over.
    if (windupFrac <= 0 || progress >= windupFrac) return 0;
    return 1 - progress / windupFrac;
  }

  function stanceValuesMatch(cache, source) {
    for (let i = 0; i < POSE_KEYS.length; i += 1) {
      if (cache.stanceValues[i] !== source[POSE_KEYS[i]]) return false;
    }
    return true;
  }

  // Synthetic authored pose that swaps only Neutral while preserving the original
  // attack endpoints; null leaves legacy BanditCombat behavior untouched. Cached
  // on the entity per attack (keyed on everything it is derived from), so the
  // steady state allocates nothing.
  function preparedEnemyPose(entity) {
    const source = stanceSourceFor(entity); // Authored Light/Heavy neutral shared with the player.
    if (!source) return null;

    const originalAnim = entity?._banditSwingAnim || 'thrust'; // Attack/rest animation selected by BanditCombat before this adapter intervenes.
    const originalPose = entity?._banditSwingPose && typeof entity._banditSwingPose === 'object' ? entity._banditSwingPose : null; // Optional authored attack pose used by combos/charged attacks.
    const requestedSign = entity?._banditSwingDirSign === -1 ? -1 : 1; // Existing forehand/backhand direction requested by the current bandit ability.
    const powerValue = Number(entity?._banditSwingPower); // Current bandit ability power baked into windup/strike endpoints below.
    const power = Number.isFinite(powerValue) ? powerValue : 1;
    const action = entity?._banditAction || null; // A new staged action is a new attack: rebake once so edited pose data is picked up.
    const spacing = !!window.MeleePoseSpacing?.adjustEndpoint; // Spacing can finish loading after the first idle frame; rebake when it appears.

    const alternatesHeavyNeutral = stanceClassFor(entity) === 'heavy'; // Heavy swings finish ready on the opposite side (the player's rule).
    const cached = entity._enemyPreparedPose;
    if (cached && cached.source === source && cached.alternatesHeavyNeutral === alternatesHeavyNeutral && cached.action === action && cached.originalAnim === originalAnim
      && cached.originalPose === originalPose && cached.requestedSign === requestedSign && cached.power === power
      && cached.spacing === spacing && cached.idleSink === window.SharedAttackPose.idleBodySinkPct() && stanceValuesMatch(cached, source)) {
      return cached.prepared;
    }

    const SAP = window.SharedAttackPose;
    // The same stance sequence the player bakes (SharedAttackPose.bakeStanceSequence): endpoints with power and the
    // melee spacing baked in, the replacement Neutral pre-unmirrored so BanditCombat's own mirror step lands on the
    // visible stance for forehand/backhand, and the Neutral the swing returns to (Heavy weapons alternate sides).
    const targetNeutral = SAP.normalizePose(source, {}); // Snapshot of the live stance; revalidated against `source` by stanceValuesMatch.
    const sequence = SAP.bakeStanceSequence(originalAnim, originalPose, requestedSign, power, targetNeutral, { alternatesHeavyNeutral });
    const idleSink = SAP.idleBodySinkPct();
    const prepared = {
      originalAnim,
      requestedSign,
      effectiveSign: sequence.effectiveSign,
      stanceClass: stanceClassFor(entity),
      pose: {
        neutral: { ...sequence.neutral, bodySink: idleSink }, // Eases out of and back into the stance's rest sink, like the player's baked swing (weapon-tool-stances.js).
        returnNeutral: { ...sequence.returnNeutral, bodySink: idleSink },
        neutralMirrorSign: sequence.startNeutralSign,
        returnNeutralMirrorSign: sequence.returnNeutralSign,
        windup: sequence.windup,
        strike: sequence.strike,
      },
    };
    entity._enemyPreparedPose = {
      source, alternatesHeavyNeutral, action, originalAnim, originalPose, requestedSign, power, spacing, idleSink,
      stanceValues: POSE_KEYS.map(key => source[key]),
      prepared,
    };
    return prepared;
  }

  function shouldApply(entity, nowMs) {
    if (!entity?.isBandit || (Number(entity.health) || 0) <= 0 || entity._rangedMode) return false;
    if (entity._banditAction || entity._banditToolTail) return true; // The strike/hold/return tail is still the swing: it keeps the stance neutral and endpoints.
    const settleUntil = Number(entity._banditToolSettleUntil) || 0; // Externally set settle window that must finish before idle stance resumes.
    return nowMs >= settleUntil;
  }

  const originalInit = typeof banditApi.init === 'function' ? banditApi.init.bind(banditApi) : null; // Original dependency injector preserved so this module composes with existing BanditCombat setup.
  if (originalInit) {
    banditApi.init = function enemyWeaponStanceAwareBanditInit(injectedDeps) {
      deps = injectedDeps;
      return originalInit(injectedDeps);
    };
  }

  const originalUpdateToolMesh = typeof banditApi.updateToolMesh === 'function' ? banditApi.updateToolMesh.bind(banditApi) : null; // Existing per-frame bandit weapon renderer whose generic authored-pose branch is reused below.
  if (originalUpdateToolMesh) {
    banditApi.updateToolMesh = function enemyWeaponStanceAwareToolMesh(entity) {
      const nowMs = performance.now(); // Current frame time used to preserve BanditCombat's existing post-strike settle window.
      if (!shouldApply(entity, nowMs)) {
        if (entity?._enemyWeaponStanceDebug) entity._enemyWeaponStanceDebug.applied = false;
        return originalUpdateToolMesh(entity);
      }

      const prepared = preparedEnemyPose(entity); // Synthetic authored pose that swaps only Neutral while preserving the original attack endpoints.
      if (!prepared) {
        const result = originalUpdateToolMesh(entity);
        const shouldLog = nowMs - lastMissingRuntimeLogAt > 5000; // Five-second throttle keeps missing shared stance setup visible without log spam.
        if (shouldLog) {
          lastMissingRuntimeLogAt = nowMs;
          window.__farmLog?.('[enemy-weapon-stance] shared Light/Heavy stance unavailable; using legacy enemy neutral', 'warn');
        }
        return result;
      }

      const originalAnim = entity._banditSwingAnim; // Restored after the generic authored-pose renderer has produced this frame's exact transformed holder.
      const originalPose = entity._banditSwingPose; // Restored after rendering so BanditCombat AI/debug state remains authoritative and unchanged.
      const originalDirSign = entity._banditSwingDirSign; // Restored after rendering so attack sequencing keeps its original direction metadata.
      const originalPower = entity._banditSwingPower; // Restored after rendering because power was already baked into the synthetic endpoints.

      // Force the already-existing generic authored-pose branch. Its channel math
      // is the same pose math used for sweep attacks and supports x/y/z/pitch/
      // yaw/bodyYaw/roll, unlike the legacy thrust shortcut. The synthetic pose
      // above has power baked into its endpoints, exactly like the player's
      // WeaponToolStances.prepareCombatOptions output.
      entity._banditSwingAnim = 'sweep';
      entity._banditSwingPose = prepared.pose;
      entity._banditSwingDirSign = prepared.effectiveSign;
      entity._banditSwingPower = 1;

      let result; // Original BanditCombat update result returned unchanged to game.js after temporary visual-state substitution.
      try {
        result = originalUpdateToolMesh(entity);
      } finally {
        if (entity._banditSwingResetDone) entity._banditSwingResetDone = false; // The swing's tail just ended and the renderer restored the rest stance: keep it.
        else {
          entity._banditSwingAnim = originalAnim;
          entity._banditSwingPose = originalPose;
          entity._banditSwingDirSign = originalDirSign;
          entity._banditSwingPower = originalPower;
        }
      }

      const toolPlane = entity?._banditToolHolder?.children?.[0]?.userData?.toolPlane || null; // Weapon sprite plane whose spin/mirror must reflect the ORIGINAL attack style, not the temporary generic branch.
      const neutralWeight = attackNeutralWeight(entity); // Shared neutral contribution used to cancel sweep's legacy -90° plane twist at idle/start and fade it back by windup.
      if (toolPlane) {
        const toolMesh = entity?._banditToolHolder?.children?.[0] || null; // Parent of the plane: Backhand mirrors it across the body midline exactly like the player (see game.js updateToolMesh).
        const planeMirrorSign = entity._banditToolTimeline?.planeMirrorSign; // Set when the pose flips across the midline mid-swing (Heavy weapons): the sprite follows the blend like the player's.
        const mirrored = prepared.originalAnim === 'sweep' && (planeMirrorSign != null ? planeMirrorSign < 0 : prepared.effectiveSign < 0);
        if (prepared.originalAnim === 'sweep') toolPlane.rotation.z = -Math.PI / 2 + Math.PI / 2 * neutralWeight;
        else toolPlane.rotation.z = 0;
        toolPlane.scale.x = 1;
        if (toolMesh) {
          toolMesh.scale.x = Math.abs(toolMesh.scale.x) * (mirrored ? -1 : 1);
          toolMesh.updateMatrix?.();
        }
        toolPlane.updateMatrix?.();
      }

      const debug = entity._enemyWeaponStanceDebug || (entity._enemyWeaponStanceDebug = {}); // Mobile/headless-readable state; one object per entity, updated in place.
      debug.applied = true;
      debug.stanceClass = prepared.stanceClass;
      debug.weaponKey = entity.def?.weaponKey || null;
      debug.speciesId = entity.avatarRef?.profile?.speciesId || entity.avatarRef?.profile?.species || null;
      debug.neutralWeight = neutralWeight;
      debug.sourceAnim = prepared.originalAnim;
      debug.effectiveSign = prepared.effectiveSign;
      return result;
    };
  }

  function debugSnapshot(entity = null) {
    const nowMs = performance.now(); // Single diagnostic timestamp keeps settle-state reporting internally consistent.
    const candidates = entity
      ? [entity]
      : Array.from(deps?.hostileObjects || []).filter(candidate => candidate?.isBandit); // Live BanditCombat humanoids, including ghouls, exposed for in-game/headless debugging.
    return candidates.map(candidate => ({
      id: candidate.id || null,
      name: candidate.name || null,
      speciesId: candidate.avatarRef?.profile?.speciesId || candidate.avatarRef?.profile?.species || null,
      weaponKey: candidate.def?.weaponKey || null,
      stanceClass: stanceClassFor(candidate),
      applicable: shouldApply(candidate, nowMs),
      applied: candidate._enemyWeaponStanceDebug?.applied === true,
      neutralWeight: candidate._enemyWeaponStanceDebug?.neutralWeight ?? null,
      sourceAnim: candidate._banditSwingAnim || 'thrust',
      rangedMode: !!candidate._rangedMode,
      actionActive: !!candidate._banditAction,
      settleMs: Math.max(0, Math.round((Number(candidate._banditToolSettleUntil) || 0) - nowMs)),
    }));
  }

  Object.defineProperty(banditApi, '__enemyWeaponStancesInstalled', { value: true, configurable: true });
  window.EnemyWeaponStances = {
    stanceClassFor,
    preparedEnemyPose,
    debugSnapshot,
  };

  window.__farmLog?.('[enemy-weapon-stance] exact shared Light/Heavy neutral adapter installed for BanditCombat humanoids (including ghouls)', 'combat');
})();
