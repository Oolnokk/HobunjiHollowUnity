(() => {
  'use strict';

  // Bandits and ghouls already reuse the player's attack-pose math through
  // BanditCombat. This adapter changes only the neutral fed into that math so
  // their equipped melee weapon uses the exact same authored Light/Heavy stance
  // as the player. Attack endpoints, timing, damage, AI, ranged mode, and the
  // post-strike settle window remain owned by BanditCombat.

  const banditApi = window.BanditCombat; // Public BanditCombat surface wrapped below before game.js injects its runtime dependencies.
  if (!banditApi || banditApi.__enemyWeaponStancesInstalled) return;

  let deps = null; // BanditCombat's injected dependencies; used for shared tool definitions and legacy neutral pose data.
  let lastMissingRuntimeLogAt = 0; // Throttles missing WeaponToolStances warnings in the in-game/mobile debug log.
  const MIRRORED_POSE_KEYS = new Set(['x', 'yaw', 'bodyYaw', 'roll']); // Pose channels mirrored by BanditCombat for authored backhand/sweep attacks.
  const POSE_KEYS = Object.freeze(['x', 'y', 'z', 'pitch', 'yaw', 'bodyYaw', 'roll']); // Complete pose schema shared with weapon-tool-stances.js.
  const RAD_TO_DEG = 180 / Math.PI; // Converts the legacy procedural sweep body-yaw radians into authored pose degrees.

  function normalizePose(raw, fallback = {}) {
    const pose = {}; // Numeric complete pose consumed by the synthetic authored-pose bridge below.
    for (const key of POSE_KEYS) {
      const value = Number(raw?.[key]);
      pose[key] = Number.isFinite(value) ? value : (Number(fallback?.[key]) || 0);
    }
    return pose;
  }

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

  function stancePoseFor(entity) {
    const stanceClass = stanceClassFor(entity); // Selects which stable authored player stance object the enemy should use.
    const poses = window.WeaponToolStances?.poses; // Shared Light/Heavy pose objects updated in place when stance config/local overrides load.
    if (!stanceClass || !poses) return null;
    return normalizePose(stanceClass === 'heavy' ? poses.heavyWeapon : poses.lightWeapon);
  }

  function sourceNeutralFor(anim, authoredPose) {
    const stylePoses = deps?.STYLE_NEUTRAL_POSE || {}; // Same legacy player neutral table BanditCombat already uses internally.
    const styleNeutral = normalizePose(stylePoses[anim] || stylePoses.thrust || {}); // Base source neutral for the attack's original animation style.
    return normalizePose(authoredPose?.neutral, styleNeutral);
  }

  function bakeAuthoredEndpoint(raw, sourceNeutral, power) {
    const endpoint = {}; // Power-scaled attack endpoint preserved independently from the replacement Light/Heavy neutral.
    for (const key of POSE_KEYS) {
      const rawValue = Number(raw?.[key]);
      const authoredValue = Number.isFinite(rawValue) ? rawValue : sourceNeutral[key];
      endpoint[key] = sourceNeutral[key] + (authoredValue - sourceNeutral[key]) * power;
    }
    return endpoint;
  }

  function legacyProceduralEndpoints(anim, power) {
    const p = Number.isFinite(Number(power)) ? Number(power) : 1; // Existing BanditCombat attack-power multiplier baked into the endpoint once.
    if (anim === 'sweep') {
      return {
        windup: { x: 0, y: 0, z: 0.16, pitch: 0, yaw: 0, bodyYaw: -2.20 * RAD_TO_DEG * p, roll: 0 },
        strike: { x: 0, y: 0, z: 0.16, pitch: 0, yaw: 0, bodyYaw: 2.12 * RAD_TO_DEG * p, roll: 0 },
      };
    }
    if (anim === 'chop') {
      const neutral = normalizePose(deps?.STYLE_NEUTRAL_POSE?.chop || { x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: 2, roll: -82 }); // Existing chop source neutral used only if a future enemy weapon selects that legacy animation.
      const rawWindup = { x: -0.18, y: 0.41, z: -0.15, pitch: -165, yaw: 13, bodyYaw: -29, roll: -112 }; // Legacy chop windup already used by the player stance bridge.
      const rawStrike = { x: 0, y: 0, z: 0.12, pitch: 13, yaw: -28, bodyYaw: 29, roll: -91 }; // Legacy chop strike already used by the player stance bridge.
      return {
        windup: bakeAuthoredEndpoint(rawWindup, neutral, p),
        strike: bakeAuthoredEndpoint(rawStrike, neutral, p),
      };
    }
    return {
      windup: { x: 0, y: 0, z: -0.40 * p, pitch: 10.31, yaw: 0, bodyYaw: -45 * p, roll: 0 },
      strike: { x: -0.23 * p, y: 0, z: 0.32 * p, pitch: 1, yaw: -45 * p, bodyYaw: 46 * p, roll: 0 },
    };
  }

  function neutralInputForSign(targetNeutral, sign) {
    const neutral = {}; // Pre-unmirrored neutral so BanditCombat's own mirror step still lands on the same stance for forehand/backhand attacks.
    for (const key of POSE_KEYS) {
      neutral[key] = MIRRORED_POSE_KEYS.has(key) ? targetNeutral[key] * sign : targetNeutral[key];
    }
    return neutral;
  }

  function preparedEnemyPose(entity) {
    const targetNeutral = stancePoseFor(entity); // Authored Light/Heavy neutral shared with the player; null leaves legacy BanditCombat behavior untouched.
    if (!targetNeutral) return null;

    const originalAnim = entity?._banditSwingAnim || 'thrust'; // Attack/rest animation selected by BanditCombat before this adapter intervenes.
    const originalPose = entity?._banditSwingPose && typeof entity._banditSwingPose === 'object' ? entity._banditSwingPose : null; // Optional authored attack pose used by combos/charged attacks.
    const requestedSign = entity?._banditSwingDirSign === -1 ? -1 : 1; // Existing forehand/backhand direction requested by the current bandit ability.
    const effectiveSign = originalPose || originalAnim === 'sweep' ? requestedSign : 1; // Matches WeaponToolStances: legacy thrust/chop do not mirror, authored/sweep attacks do.
    const powerValue = Number(entity?._banditSwingPower); // Current bandit ability power baked into windup/strike endpoints below.
    const power = Number.isFinite(powerValue) ? powerValue : 1;
    let windup; // Replacement synthetic pose windup endpoint; used by BanditCombat's generic authored-pose branch.
    let strike; // Replacement synthetic pose strike endpoint; used by BanditCombat's generic authored-pose branch.

    if (originalPose) {
      const sourceNeutral = sourceNeutralFor(originalAnim, originalPose); // Original attack neutral used only as the basis for power-scaling its endpoints.
      windup = bakeAuthoredEndpoint(originalPose.windup, sourceNeutral, power);
      strike = bakeAuthoredEndpoint(originalPose.strike, sourceNeutral, power);
    } else {
      ({ windup, strike } = legacyProceduralEndpoints(originalAnim, power));
    }

    return {
      originalAnim,
      requestedSign,
      effectiveSign,
      pose: {
        neutral: neutralInputForSign(targetNeutral, effectiveSign),
        windup,
        strike,
      },
    };
  }

  function attackNeutralWeight(entity) {
    const action = entity?._banditAction; // Current staged action whose windup defines how quickly the neutral-plane compensation fades.
    if (!action) return 1;
    const totalS = Math.max(0.0001, (Number(action.windupS) || 0) + (Number(action.strikeS) || 0)); // Safe duration matching BanditCombat's own progress calculation.
    const progress = Math.max(0, Math.min(1, (Number(action.t) || 0) / totalS)); // Current normalized staged-action progress.
    const windupFrac = Math.max(0, Math.min(1, (Number(action.windupS) || 0) / totalS)); // Fraction at which the authored windup endpoint fully takes over.
    if (windupFrac <= 0 || progress >= windupFrac) return 0;
    return 1 - progress / windupFrac;
  }

  function shouldApply(entity, nowMs) {
    if (!entity?.isBandit || (Number(entity.health) || 0) <= 0 || entity._rangedMode) return false;
    if (entity._banditAction) return true;
    const settleUntil = Number(entity._banditToolSettleUntil) || 0; // Existing frozen strike-pose tail that must finish before idle stance resumes.
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
        entity._banditSwingAnim = originalAnim;
        entity._banditSwingPose = originalPose;
        entity._banditSwingDirSign = originalDirSign;
        entity._banditSwingPower = originalPower;
      }

      const toolPlane = entity?._banditToolHolder?.children?.[0]?.userData?.toolPlane || null; // Weapon sprite plane whose spin/mirror must reflect the ORIGINAL attack style, not the temporary generic branch.
      const neutralWeight = attackNeutralWeight(entity); // Shared neutral contribution used to cancel sweep's legacy -90° plane twist at idle/start and fade it back by windup.
      if (toolPlane) {
        if (prepared.originalAnim === 'sweep') {
          toolPlane.rotation.z = -Math.PI / 2 + Math.PI / 2 * neutralWeight;
          toolPlane.scale.x = prepared.effectiveSign;
        } else {
          toolPlane.rotation.z = 0;
          toolPlane.scale.x = 1;
        }
        toolPlane.updateMatrix?.();
      }

      const stanceClass = stanceClassFor(entity); // Debug value stored directly on the entity for mobile/headless inspection without devtools.
      entity._enemyWeaponStanceDebug = {
        applied: true,
        stanceClass,
        weaponKey: entity.def?.weaponKey || null,
        speciesId: entity.avatarRef?.profile?.speciesId || entity.avatarRef?.profile?.species || null,
        neutralWeight,
        sourceAnim: prepared.originalAnim,
        effectiveSign: prepared.effectiveSign,
      };
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
