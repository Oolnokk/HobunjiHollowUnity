(() => {
  'use strict';

  // Gives BanditCombat-driven humanoid enemies (including ghouls) the same
  // authored Light/Heavy idle stances as the player without touching their
  // existing attack animation state machine. BanditCombat remains authoritative
  // for attack timing/poses; this adapter only replaces the true idle neutral.

  const banditApi = window.BanditCombat; // Public bandit API wrapped below so game.js keeps using the same integration points.
  if (!banditApi || banditApi.__enemyWeaponStancesInstalled) return;

  let deps = null; // BanditCombat's injected game dependencies; used for tool definitions, TILE, and live hostile diagnostics.
  let lastMissingRuntimeLogAt = 0; // Throttles missing-runtime warnings so a late stance-module load does not spam the mobile debug log.
  const DEG = Math.PI / 180; // Converts authored stance degrees into Three.js radians during idle-pose application.

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

  function banditToolBaseXY(avatarRef) {
    const width = Number(avatarRef?.modelWidth) || 0.9; // Fallback portrait width used only when the scanned hand attach point is absent.
    const height = Number(avatarRef?.modelHeight) || 0.9; // Fallback portrait height used only when the scanned hand attach point is absent.
    return {
      x: avatarRef?.handAttachX ?? (-width / 2),
      y: avatarRef?.handAttachY ?? (height / 2),
    };
  }

  function isTrueIdle(entity, nowMs) {
    const settleUntil = Number(entity?._banditToolSettleUntil) || 0; // Existing post-strike freeze deadline; stance must not interrupt it.
    return !!entity?.isBandit
      && (Number(entity.health) || 0) > 0
      && !entity._rangedMode
      && !entity._banditAction
      && nowMs >= settleUntil;
  }

  function applyIdleStance(entity) {
    const THREE = window.THREE; // Runtime Three.js namespace used to build the same quaternion order as BanditCombat's weapon visual code.
    const holder = entity?._banditToolHolder; // World-space melee holder already positioned once this frame by BanditCombat.updateToolMesh().
    const avatarGroup = entity?.avatarRef?.group; // Humanoid portrait root leaned by bodyYaw so body and weapon remain visually connected.
    const pose = stancePoseFor(entity); // Shared authored Light/Heavy neutral pose selected from the equipped weapon definition.
    if (!THREE || !holder || !avatarGroup || !pose) return false;

    const tile = Number(deps?.TILE) || 64; // World-pixel to Three.js-unit conversion used by the existing bandit holder math.
    const theta = -(Number(entity.facing) || 0) + Math.PI / 2; // Player-tool facing convention already mirrored by BanditCombat's holder code.
    const bodyYawRad = (Number(pose.bodyYaw) || 0) * DEG; // Authored stance body lean applied to both avatar and holder facing.
    const visualTheta = theta + bodyYawRad; // Final holder yaw after the stance's bodyYaw contribution.
    const aimOffset = Number(entity.def?.aimAngleOffset) || 0; // Portrait-rig-only axis correction removed from the world-space tool holder.
    const groupYaw = visualTheta - aimOffset; // Avatar-space yaw matching BanditCombat's own attack-body composition convention.
    const base = banditToolBaseXY(entity.avatarRef); // Species/gender hand attach point used as the stance position origin.
    const feetY = avatarGroup.position.y - (Number(entity.halfHeight) || 0); // Feet-level Y origin matching playerToolBaseY semantics.
    const x = Number(pose.x) || 0; // Authored lateral weapon offset used in the final world-space holder position.
    const y = Number(pose.y) || 0; // Authored vertical weapon offset used in the final world-space holder position.
    const z = Number(pose.z) || 0; // Authored forward weapon offset used in the final world-space holder position.
    const rightX = Math.cos(visualTheta); // X component of the stance-relative right vector used for lateral placement.
    const rightZ = -Math.sin(visualTheta); // Z component of the stance-relative right vector used for lateral placement.
    const forwardX = Math.sin(visualTheta); // X component of the stance-relative forward vector used for depth placement.
    const forwardZ = Math.cos(visualTheta); // Z component of the stance-relative forward vector used for depth placement.
    const yawRad = (Number(pose.yaw) || 0) * DEG; // Authored weapon yaw composed after actor/body facing.
    const pitchRad = (Number(pose.pitch) || 0) * DEG; // Authored weapon pitch composed after weapon yaw.
    const rollRad = (Number(pose.roll) || 0) * DEG; // Authored weapon roll composed last, matching BanditCombat's sweep branch.
    const upAxis = new THREE.Vector3(0, 1, 0); // Local vertical axis used by actor/body and weapon-yaw quaternions below.
    const xAxis = new THREE.Vector3(1, 0, 0); // Local pitch axis used by the authored stance quaternion below.
    const zAxis = new THREE.Vector3(0, 0, 1); // Local roll axis used by the authored stance quaternion below.
    const facingQ = new THREE.Quaternion().setFromAxisAngle(upAxis, visualTheta); // Actor/body-facing quaternion used as the holder's world basis.
    const yawQ = new THREE.Quaternion().setFromAxisAngle(upAxis, yawRad); // Authored weapon-yaw quaternion composed after facingQ.
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(xAxis, pitchRad); // Authored weapon-pitch quaternion composed after yawQ.
    const rollQ = new THREE.Quaternion().setFromAxisAngle(zAxis, rollRad); // Authored weapon-roll quaternion composed last.

    avatarGroup.rotation.y = groupYaw;
    entity.groupRot = groupYaw;
    entity._banditToolLastVθ = groupYaw;

    holder.quaternion.copy(facingQ).multiply(yawQ).multiply(pitchQ).multiply(rollQ);
    holder.position.set(
      entity.x / tile + rightX * (base.x + x) + forwardX * z,
      feetY + base.y + y,
      entity.y / tile + rightZ * (base.x + x) + forwardZ * z,
    );

    const toolPlane = holder.children?.[0]?.userData?.toolPlane || null; // Child sprite plane whose legacy sweep twist must be neutralized at authored idle.
    if (toolPlane) {
      toolPlane.rotation.z = 0;
      toolPlane.scale.x = 1;
      toolPlane.updateMatrix?.();
    }

    const stanceClass = stanceClassFor(entity); // Debug label retained on the entity for mobile/headless inspection without console access.
    entity._enemyWeaponStanceDebug = {
      applied: true,
      stanceClass,
      weaponKey: entity.def?.weaponKey || null,
      speciesId: entity.avatarRef?.profile?.speciesId || entity.avatarRef?.profile?.species || null,
      bodyYawDeg: Number(pose.bodyYaw) || 0,
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

  const originalUpdateToolMesh = typeof banditApi.updateToolMesh === 'function' ? banditApi.updateToolMesh.bind(banditApi) : null; // Original per-frame NPC weapon visual update run before idle stance replacement.
  if (originalUpdateToolMesh) {
    banditApi.updateToolMesh = function enemyWeaponStanceAwareToolMesh(entity) {
      const result = originalUpdateToolMesh(entity);
      const nowMs = performance.now(); // Current render/update time used to respect BanditCombat's existing post-strike settle window.
      if (!isTrueIdle(entity, nowMs)) {
        if (entity?._enemyWeaponStanceDebug) entity._enemyWeaponStanceDebug.applied = false;
        return result;
      }

      if (!applyIdleStance(entity)) {
        const shouldLog = nowMs - lastMissingRuntimeLogAt > 5000; // Five-second throttle keeps a missing dependency visible without flooding debug output.
        if (shouldLog) {
          lastMissingRuntimeLogAt = nowMs;
          window.__farmLog?.('[enemy-weapon-stance] idle stance unavailable; waiting for WeaponToolStances/tool definition', 'warn');
        }
      }
      return result;
    };
  }

  function debugSnapshot(entity = null) {
    const candidates = entity
      ? [entity]
      : Array.from(deps?.hostileObjects || []).filter(candidate => candidate?.isBandit); // Live bandit/ghoul entities shown by the in-game diagnostics helper.
    return candidates.map(candidate => ({
      id: candidate.id || null,
      name: candidate.name || null,
      weaponKey: candidate.def?.weaponKey || null,
      stanceClass: stanceClassFor(candidate),
      trueIdle: isTrueIdle(candidate, performance.now()),
      applied: candidate._enemyWeaponStanceDebug?.applied === true,
      rangedMode: !!candidate._rangedMode,
      actionActive: !!candidate._banditAction,
      settleMs: Math.max(0, Math.round((Number(candidate._banditToolSettleUntil) || 0) - performance.now())),
    }));
  }

  Object.defineProperty(banditApi, '__enemyWeaponStancesInstalled', { value: true, configurable: true });
  window.EnemyWeaponStances = {
    applyToEntity: applyIdleStance,
    stanceClassFor,
    debugSnapshot,
  };

  window.__farmLog?.('[enemy-weapon-stance] BanditCombat Light/Heavy idle stance adapter installed (ghouls share this path)', 'combat');
})();
