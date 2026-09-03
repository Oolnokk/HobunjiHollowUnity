(() => {
  'use strict';

  // Gives BanditCombat-driven humanoid enemies (including ghouls) the same
  // authored Light/Heavy weapon neutral as the player. BanditCombat remains
  // authoritative for attack timing and attack endpoints; this adapter only
  // adds the shared stance's neutral influence on top of the existing holder
  // transform, fading that influence to zero across the attack windup exactly
  // where the authored attack takes over.

  const banditApi = window.BanditCombat; // Public bandit API wrapped below so game.js keeps using the same integration points.
  if (!banditApi || banditApi.__enemyWeaponStancesInstalled) return;

  let deps = null; // BanditCombat's injected game dependencies; used for tool definitions, TILE, source neutrals, and diagnostics.
  let lastMissingRuntimeLogAt = 0; // Throttles missing-runtime warnings so a late stance-module load does not spam the mobile debug log.
  const DEG = Math.PI / 180; // Converts authored stance degrees into Three.js radians during neutral-pose composition.
  const MIRRORED_POSE_KEYS = new Set(['x', 'yaw', 'bodyYaw', 'roll']); // Channels BanditCombat mirrors for authored sweep/backhand attacks.
  const POSE_KEYS = Object.freeze(['x', 'y', 'z', 'pitch', 'yaw', 'bodyYaw', 'roll']); // Complete authored stance channels normalized below.

  function weaponDefinitionFor(entity) {
    const weaponKey = entity?.def?.weaponKey; // Equipped melee weapon id used to resolve the same TOOL_ITEM_DEFS entry the player uses.
    if (!weaponKey) return null;
    return deps?.TOOL_ITEM_DEFS?.[weaponKey] || null;
  }

  function stanceClassFor(entity) {
    let weaponDef = weaponDefinitionFor(entity); // Shared tool definition whose weaponIdleClass is authored/augmented by WeaponToolStances.
    let stanceClass = weaponDef?.weaponIdleClass; // Light/heavy classification consumed by both player and enemy neutral-pose selection.
    if (stanceClass === 'light' || stanceClass === 'heavy') return stanceClass;

    // WeaponToolStances owns the fallback shape->class policy. Ask it to refresh
    // the shared tool definitions rather than duplicating those shape rules here.
    window.WeaponToolStances?.refreshDefinitions?.();
    weaponDef = weaponDefinitionFor(entity);
    stanceClass = weaponDef?.weaponIdleClass;
    return stanceClass === 'light' || stanceClass === 'heavy' ? stanceClass : null;
  }

  function stancePoseFor(entity) {
    const stanceClass = stanceClassFor(entity); // Determines which authored neutral pose to read from the player's stable pose objects.
    const poses = window.WeaponToolStances?.poses; // Stable pose map updated in place when committed/local stance config finishes loading.
    if (!stanceClass || !poses) return null;
    return stanceClass === 'heavy' ? poses.heavyWeapon : poses.lightWeapon;
  }

  function normalizePose(raw) {
    const pose = {}; // Complete numeric pose used for neutral deltas even when an older source pose omits a channel.
    for (const key of POSE_KEYS) pose[key] = Number(raw?.[key]) || 0;
    return pose;
  }

  function sourceNeutralFor(entity) {
    const anim = entity?._banditSwingAnim || 'thrust'; // Current BanditCombat animation style whose legacy neutral was already applied this frame.
    const stylePoses = deps?.STYLE_NEUTRAL_POSE || {}; // Player-authored legacy style neutrals reused by BanditCombat itself.
    const styleNeutral = stylePoses[anim] || stylePoses.thrust || {}; // Base legacy neutral for the current attack/rest style.
    const authoredNeutral = anim === 'sweep' ? entity?._banditSwingPose?.neutral : null; // Sweep abilities may override the style neutral through authored pose data.
    const source = normalizePose({ ...styleNeutral, ...(authoredNeutral || {}) }); // Actual unmirrored neutral BanditCombat starts the current sweep/thrust from.
    const dirSign = entity?._banditSwingDirSign === -1 ? -1 : 1; // Backhand sign BanditCombat applies to mirrored sweep channels.

    if (anim === 'sweep' && dirSign === -1) {
      for (const key of MIRRORED_POSE_KEYS) source[key] *= dirSign;
    }
    return source;
  }

  function neutralWeightFor(entity, nowMs) {
    if (!entity?.isBandit || (Number(entity.health) || 0) <= 0 || entity._rangedMode) return 0;

    const action = entity._banditAction; // Existing staged melee action whose windup owns the neutral-to-attack transition.
    if (action) {
      const windupS = Math.max(0, Number(action.windupS) || 0); // Current attack windup duration used to fade the stance neutral away.
      const strikeS = Math.max(0, Number(action.strikeS) || 0); // Current attack strike duration used only to normalize action progress.
      const totalS = Math.max(0.0001, windupS + strikeS); // Safe total avoids division by zero for malformed authored attacks.
      const progress = Math.max(0, Math.min(1, (Number(action.t) || 0) / totalS)); // Existing BanditCombat action progress at this frame.
      const windupFrac = Math.max(0, Math.min(1, windupS / totalS)); // Fraction where the stance should hand control to the authored windup endpoint.
      if (windupFrac <= 0 || progress >= windupFrac) return 0;
      return 1 - progress / windupFrac;
    }

    const settleUntil = Number(entity._banditToolSettleUntil) || 0; // Existing post-strike freeze deadline that must remain visually untouched.
    return nowMs >= settleUntil ? 1 : 0;
  }

  function poseQuaternion(THREE, pose) {
    const upAxis = new THREE.Vector3(0, 1, 0); // Local vertical axis used for the authored weapon-yaw quaternion.
    const xAxis = new THREE.Vector3(1, 0, 0); // Local pitch axis used for the authored weapon-pitch quaternion.
    const zAxis = new THREE.Vector3(0, 0, 1); // Local roll axis used for the authored weapon-roll quaternion.
    const yawQ = new THREE.Quaternion().setFromAxisAngle(upAxis, (Number(pose?.yaw) || 0) * DEG); // Authored local yaw component.
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(xAxis, (Number(pose?.pitch) || 0) * DEG); // Authored local pitch component.
    const rollQ = new THREE.Quaternion().setFromAxisAngle(zAxis, (Number(pose?.roll) || 0) * DEG); // Authored local roll component.
    return yawQ.multiply(pitchQ).multiply(rollQ);
  }

  function applyNeutralInfluence(entity, neutralWeight) {
    const THREE = window.THREE; // Runtime Three.js namespace used for world/body and local weapon quaternion deltas.
    const holder = entity?._banditToolHolder; // World-space melee holder already fully posed this frame by BanditCombat.updateToolMesh().
    const avatarGroup = entity?.avatarRef?.group; // Humanoid portrait root leaned by the stance bodyYaw so body and weapon remain connected.
    const targetPose = stancePoseFor(entity); // Shared authored Light/Heavy neutral selected from the equipped weapon's shared tool definition.
    const sourcePose = sourceNeutralFor(entity); // Legacy sweep/thrust neutral already baked into the current BanditCombat holder transform.
    const weight = Math.max(0, Math.min(1, Number(neutralWeight) || 0)); // Neutral contribution: 1 at idle/start, fading to 0 by windup end.
    if (!THREE || !holder || !avatarGroup || !targetPose || weight <= 0) return false;

    const tile = Number(deps?.TILE) || 64; // World-pixel to Three.js-unit conversion used by the existing bandit holder math.
    const aimOffset = Number(entity.def?.aimAngleOffset) || 0; // Portrait-rig-only axis correction separating avatar group yaw from holder world yaw.
    const sourceBodyYaw = Number(sourcePose.bodyYaw) || 0; // Legacy neutral bodyYaw already present in the current holder/body transform.
    const targetBodyYaw = Number(targetPose.bodyYaw) || 0; // Authored Light/Heavy neutral bodyYaw the player already uses.
    const bodyDeltaRad = (targetBodyYaw - sourceBodyYaw) * DEG * weight; // Partial world/body yaw correction faded out during windup.
    const originalVisualTheta = (Number(avatarGroup.rotation.y) || 0) + aimOffset; // Holder-facing yaw reconstructed from BanditCombat's already-composed avatar yaw.
    const correctedVisualTheta = originalVisualTheta + bodyDeltaRad; // Facing basis used for local stance translation after bodyYaw correction.
    const actorX = (Number(entity.x) || 0) / tile; // Actor world X pivot around which bodyYaw rotates the existing holder offset.
    const actorZ = (Number(entity.y) || 0) / tile; // Actor world Z pivot around which bodyYaw rotates the existing holder offset.
    const upAxis = new THREE.Vector3(0, 1, 0); // Shared world-up axis used by body rotation and translation correction.
    const holderOffset = new THREE.Vector3(holder.position.x - actorX, 0, holder.position.z - actorZ); // Existing attack/rest holder offset rotated with the stance body.
    const localDelta = new THREE.Vector3(
      ((Number(targetPose.x) || 0) - sourcePose.x) * weight,
      ((Number(targetPose.y) || 0) - sourcePose.y) * weight,
      ((Number(targetPose.z) || 0) - sourcePose.z) * weight,
    ); // Local x/y/z neutral difference added without replacing BanditCombat's current attack motion.

    holderOffset.applyAxisAngle(upAxis, bodyDeltaRad);
    localDelta.applyAxisAngle(upAxis, correctedVisualTheta);
    holder.position.set(
      actorX + holderOffset.x + localDelta.x,
      holder.position.y + localDelta.y,
      actorZ + holderOffset.z + localDelta.z,
    );

    const sourceQ = poseQuaternion(THREE, sourcePose); // Legacy local neutral orientation factored out of BanditCombat's current weapon orientation.
    const targetQ = poseQuaternion(THREE, targetPose); // Shared Light/Heavy local neutral orientation factored into the current weapon orientation.
    const localDeltaQ = sourceQ.clone().conjugate().multiply(targetQ); // Exact source-neutral -> target-neutral local quaternion delta.
    const blendedLocalDeltaQ = new THREE.Quaternion().identity().slerp(localDeltaQ, weight); // Smooth partial local correction during windup.
    const bodyDeltaQ = new THREE.Quaternion().setFromAxisAngle(upAxis, bodyDeltaRad); // World/body rotation correction applied before the holder's current orientation.
    holder.quaternion.premultiply(bodyDeltaQ).multiply(blendedLocalDeltaQ);

    avatarGroup.rotation.y += bodyDeltaRad;
    entity.groupRot = avatarGroup.rotation.y;
    entity._banditToolLastVθ = avatarGroup.rotation.y;

    const toolPlane = holder.children?.[0]?.userData?.toolPlane || null; // Child sprite plane carrying BanditCombat's legacy -90° sweep-only twist.
    if (toolPlane && entity._banditSwingAnim === 'sweep') {
      toolPlane.rotation.z += Math.PI / 2 * weight;
      toolPlane.updateMatrix?.();
    }

    const stanceClass = stanceClassFor(entity); // Debug label retained on the entity for mobile/headless inspection without console access.
    entity._enemyWeaponStanceDebug = {
      applied: true,
      stanceClass,
      weaponKey: entity.def?.weaponKey || null,
      speciesId: entity.avatarRef?.profile?.speciesId || entity.avatarRef?.profile?.species || null,
      neutralWeight: weight,
      targetBodyYawDeg: targetBodyYaw,
      sourceAnim: entity._banditSwingAnim || 'thrust',
    };
    return true;
  }

  const originalInit = typeof banditApi.init === 'function' ? banditApi.init.bind(banditApi) : null; // Original dependency injector preserved so this adapter composes with existing BanditCombat behavior.
  if (originalInit) {
    banditApi.init = function enemyWeaponStanceAwareBanditInit(injectedDeps) {
      deps = injectedDeps;
      return originalInit(injectedDeps);
    };
  }

  const originalUpdateToolMesh = typeof banditApi.updateToolMesh === 'function' ? banditApi.updateToolMesh.bind(banditApi) : null; // Original per-frame NPC weapon visual update run before neutral correction.
  if (originalUpdateToolMesh) {
    banditApi.updateToolMesh = function enemyWeaponStanceAwareToolMesh(entity) {
      const result = originalUpdateToolMesh(entity);
      const nowMs = performance.now(); // Current render/update time used to respect BanditCombat's existing post-strike settle window.
      const neutralWeight = neutralWeightFor(entity, nowMs); // Shared stance contribution for idle or the opening portion of a melee windup.

      if (neutralWeight <= 0) {
        if (entity?._enemyWeaponStanceDebug) entity._enemyWeaponStanceDebug.applied = false;
        return result;
      }

      if (!applyNeutralInfluence(entity, neutralWeight)) {
        const shouldLog = nowMs - lastMissingRuntimeLogAt > 5000; // Five-second throttle keeps a missing dependency visible without flooding debug output.
        if (shouldLog) {
          lastMissingRuntimeLogAt = nowMs;
          window.__farmLog?.('[enemy-weapon-stance] stance neutral unavailable; waiting for WeaponToolStances/tool definition', 'warn');
        }
      }
      return result;
    };
  }

  function debugSnapshot(entity = null) {
    const nowMs = performance.now(); // Single diagnostic timestamp keeps all reported weights/settle times internally consistent.
    const candidates = entity
      ? [entity]
      : Array.from(deps?.hostileObjects || []).filter(candidate => candidate?.isBandit); // Live bandit/ghoul entities shown by the in-game diagnostics helper.
    return candidates.map(candidate => ({
      id: candidate.id || null,
      name: candidate.name || null,
      weaponKey: candidate.def?.weaponKey || null,
      stanceClass: stanceClassFor(candidate),
      neutralWeight: neutralWeightFor(candidate, nowMs),
      applied: candidate._enemyWeaponStanceDebug?.applied === true,
      rangedMode: !!candidate._rangedMode,
      actionActive: !!candidate._banditAction,
      sourceAnim: candidate._banditSwingAnim || 'thrust',
      settleMs: Math.max(0, Math.round((Number(candidate._banditToolSettleUntil) || 0) - nowMs)),
    }));
  }

  Object.defineProperty(banditApi, '__enemyWeaponStancesInstalled', { value: true, configurable: true });
  window.EnemyWeaponStances = {
    applyToEntity: applyNeutralInfluence,
    stanceClassFor,
    neutralWeightFor,
    debugSnapshot,
  };

  window.__farmLog?.('[enemy-weapon-stance] BanditCombat Light/Heavy stance neutral adapter installed (ghouls share this path)', 'combat');
})();
