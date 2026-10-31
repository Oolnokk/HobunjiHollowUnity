// Central composition point for the local player's rendered body transform.
//
// Gameplay-facing state (player.angle, aim cones, movement direction, mount
// steering, etc.) deliberately stays outside this module. game.js can continue
// resolving its existing base playerMesh transform (dead-zone facing, authored
// attack/tool body yaw, movement bob, and other legacy base-pose writers); this
// composer owns only the FINAL visual-layer delta applied after those systems
// have finished.
//
// New systems should contribute named channels instead of writing shared body
// rotations directly. Channels are ordered by priority and can be additive or
// overriding. External body-bound visuals (tool holder, shoulder pets, future
// attachments) register providers rather than reaching into this renderer.
(() => {
  'use strict';

  const THREE = window.THREE;
  const legApi = window.ProceduralLegAnimation;
  if (!THREE || !legApi?.attach || window.PlayerBodyTransformComposer) return;

  const channels = new Map();
  const externalRootProviders = new Map();
  const PLAYER_HEAD_MAX_YAW_DEG = 65; // Shared body-relative neck limit used by ordinary aim, animation-composed body yaw, and seated camera look.
  const PLAYER_HEAD_MAX_YAW_RAD = THREE.MathUtils.degToRad(PLAYER_HEAD_MAX_YAW_DEG); // Used by applyPlayerNeckYawLimit for range checks and the final hard clamp.
  let playerMesh = null;
  let playerLegRoot = null;
  let playerLegHandle = null; // The live ProceduralLegAnimation handle, so body-lowering channels can ask the legs to fold.
  let playerPosteriorY = 0;
  let playerNeckJointCache = null; // Cached current player neck bone; invalidated when the rig/avatar is replaced so rebuilds retarget automatically.
  let renderSequence = 0; // Incremented for Pixel Probe correlation across real render calls.
  let lastRenderDebug = null; // Read by getDebug() so mobile reports can inspect temporary render state after restoration.
  const headAimTarget = new THREE.Vector3(); // Copied from gameplay's shared interaction/fishing target before render.
  const headAimOrigin = new THREE.Vector3(); // Reused for the neck's position after all body lean has been composed.
  const headAimDirection = new THREE.Vector3(); // Reused to resolve the target in the final neck-parent orientation.
  const headAimParentQuaternion = new THREE.Quaternion(); // Inverts final body yaw/pitch/roll without treating mirrored scale as rotation.
  let headAimEnabled = false; // Dialogue, cutscene, inspection, and ragdoll owners clear this target.
  let headAimSource = null; // Exposed through existing mobile render diagnostics.
  let pendingCapture = null; // One-shot callback fired mid-render, after the temporary delta lands but before it's undone — see captureNextRenderTransforms().

  function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  // Compose orientation strictly from the quaternion hierarchy. Three.js's
  // getWorldQuaternion() decomposes matrixWorld; when any ancestor has a
  // negative scale (the PNG-facing mirror), that reflection can be folded into
  // the returned quaternion as a spurious 180-degree turn. Position conversion
  // should still use matrixWorld so mirrored offsets remain correct, but facing
  // and body-channel rotation must never derive from scale.
  function hierarchyWorldQuaternion(node, target = new THREE.Quaternion()) {
    const chain = []; // Used below to apply local quaternions parent-first.
    let cursor = node; // Walks from the requested node to the scene root.
    while (cursor?.isObject3D) {
      chain.push(cursor);
      cursor = cursor.parent;
    }
    target.identity();
    for (let i = chain.length - 1; i >= 0; i--) target.multiply(chain[i].quaternion);
    return target.normalize();
  }

  function quaternionEulerDegrees(quaternion) {
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ'); // Converted below for compact probe output.
    const degrees = 180 / Math.PI; // Used for all three reported composer axes.
    return { pitch: euler.x * degrees, yaw: euler.y * degrees, roll: euler.z * degrees };
  }

  function hasRenderableDescendant(root) {
    if (!root?.isObject3D) return false;
    if (root.isMesh || root.isSprite || root.isLine || root.isPoints) return true;
    let found = false;
    root.traverse?.(obj => {
      if (!found && obj !== root && (obj.isMesh || obj.isSprite || obj.isLine || obj.isPoints)) found = true;
    });
    return found;
  }

  function isAvatarBodyRoot(child) {
    if (!child?.isObject3D) return false;
    const name = String(child.name || '').toLowerCase();
    const role = String(child.userData?.modelRole || '').toLowerCase();
    const pipeline = String(child.userData?.pngPipelineMode || '').toLowerCase();
    return role === 'temporary-npc-demo-model'
      || role === 'player'
      || role === 'player-avatar'
      || (pipeline === 'single' && role.includes('demo-model'))
      || name.includes('player_avatar')
      || name.includes('player_portrait')
      || name.includes('temporary_npc_portrait_model')
      || name.includes('hat_xray')
      || name.includes('occlusion_ghost');
  }

  function isDescendantOf(node, ancestor) {
    if (!node?.isObject3D || !ancestor?.isObject3D) return false;
    let cursor = node.parent;
    while (cursor) {
      if (cursor === ancestor) return true;
      cursor = cursor.parent;
    }
    return false;
  }

  function wrapSignedAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  function currentPlayerNeckJoint() {
    if (playerNeckJointCache?.isBone && isDescendantOf(playerNeckJointCache, playerMesh)) return playerNeckJointCache;
    playerNeckJointCache = null;
    playerMesh?.traverse?.(object => {
      if (playerNeckJointCache) return;
      const rig = object?.userData?.neckRig; // Used here to find the current rebuilt player portrait without depending on generated bone names.
      if (rig?.available && rig.neckJoint?.isBone) playerNeckJointCache = rig.neckJoint;
    });
    return playerNeckJointCache;
  }

  // game.js authors the player's local neck yaw before render, already
  // subtracting PlayerBodyTransformComposer's pending body-yaw channels. That
  // makes this renderer boundary the one place where the REAL body-relative
  // result can be physically limited after ordinary aiming, combat/idle body
  // animation, and seated free-look have all contributed.
  //
  // Seated free-look is special: game.js's raw yaw points the head TOWARD the
  // camera because the camera sits at activeCameraAzimuthRad(). Once that
  // direction is outside the neck range, adding PI reverses it to the
  // direction the camera itself is FACING. The same ±65° hard limit is then
  // applied to that fallback as well.
  //
  // CAVEAT: shoulder-surf sets hobunjiPerspectiveAimLocked and bypasses the
  // limit entirely so the head stays exactly on the shared perspective point.
  // In steady state game.js's idle body catch-up keeps the residual inside 60°,
  // but that catch-up is rate-limited (SHOULDER_SURF_BODY_CATCHUP_RATE), so a
  // fast idle camera flick CAN show the head past 65° for a few frames before
  // the body squares up. If that transient ever reads as an overtwist on
  // screen, clamp the locked branch here rather than reintroducing a second
  // aim authority upstream.
  function applyPlayerNeckYawLimit(renderDebug, camera) {
    if(window.CharacterActionLocks?.isLocked?.('player','head'))return; // A scoped authored/procedural gaze keeps its own anatomical limits.
    const neckJoint = currentPlayerNeckJoint();
    if (!neckJoint) return;
    if (headAimEnabled && headAimSource === 'fishing-water') {
      renderDebug.neckYaw = { source: 'fishing-water', renderedDeg: THREE.MathUtils.radToDeg(neckJoint.rotation.y), waterTargetLocked: true };
      return; // Fishing's authored torso twist and side camera must not override the solved water gaze.
    }
    const rawYaw = finite(neckJoint.rotation.y); // Game-authored local neck yaw inspected below before the visual physical limit is applied.
    const sitState = window.__hobunjiFurnitureDebug?.sitInteraction; // Used only to distinguish the seated camera-look fallback from normal aim clamping.
    const seated = sitState?.phase === 'active';
    const outsideLookRange = seated && Math.abs(rawYaw) > PLAYER_HEAD_MAX_YAW_RAD; // Used below to switch from looking at the camera to following its facing direction.
    const requestedYaw = outsideLookRange ? wrapSignedAngle(rawYaw + Math.PI) : rawYaw; // Seated out-of-range target is the camera-facing direction, not the camera position.
    const perspectiveAimLocked = neckJoint.userData?.hobunjiPerspectiveAimLocked === true; // Shoulder aim keeps its shared logical endpoint; the rendered head additionally obeys the camera deadzone.
    const renderedYaw = perspectiveAimLocked
      ? requestedYaw
      : THREE.MathUtils.clamp(requestedYaw, -PLAYER_HEAD_MAX_YAW_RAD, PLAYER_HEAD_MAX_YAW_RAD); // Other head-turn sources retain the ordinary physical limit.
    neckJoint.rotation.y = window.PerpRotation?.clampedNeckYaw?.(neckJoint, playerMesh?.position, renderedYaw, perspectiveAimLocked ? Math.PI : PLAYER_HEAD_MAX_YAW_RAD, camera?.position) ?? renderedYaw;
    renderDebug.neckYaw = {
      cameraDeadzone: neckJoint.userData?.cameraDeadzone?.pixelProbeDebug || null, // Mobile probe can compare the independent head clamp with body facing.
      rawDeg: THREE.MathUtils.radToDeg(rawYaw),
      requestedDeg: THREE.MathUtils.radToDeg(requestedYaw),
      renderedDeg: THREE.MathUtils.radToDeg(neckJoint.rotation.y),
      maxDeg: PLAYER_HEAD_MAX_YAW_DEG,
      seated,
      perspectiveAimLocked,
      usedCameraFacingFallback: outsideLookRange,
    };
  }

  function setHeadAimTarget(point, source = 'interaction-ray') {
    headAimEnabled = !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
    headAimSource = headAimEnabled ? source : null;
    if (headAimEnabled) headAimTarget.copy(point);
    return headAimEnabled;
  }

  // Head-anchored attachments (blowgun, held drink) sample the head AFTER the render-time head aim and neck limits, so a tool follows the
  // head that is actually drawn rather than the pre-clamp gameplay head. Each hook may push undo steps for what it moves.
  const postHeadAimHooks = new Set();
  function addPostHeadAimHook(hook) {
    if (typeof hook !== 'function') return () => {};
    postHeadAimHooks.add(hook);
    return () => postHeadAimHooks.delete(hook);
  }

  function applyPlayerHeadAim(undo, renderDebug) {
    if (!headAimEnabled || window.CharacterActionLocks?.isLocked?.('player','head')) return;
    const neck = currentPlayerNeckJoint(); // Uses the current rebuilt rig rather than a second head registry.
    if (!neck?.parent) return;
    neck.updateWorldMatrix(true, false);
    neck.getWorldPosition(headAimOrigin);
    headAimDirection.copy(headAimTarget).sub(headAimOrigin);
    if (headAimDirection.lengthSq() < 1e-12) return;
    hierarchyWorldQuaternion(neck.parent, headAimParentQuaternion).invert();
    headAimDirection.applyQuaternion(headAimParentQuaternion);
    const previousRotation = neck.rotation.clone(); // Restore the authored head pose after each draw, preventing accumulating counter-lean.
    undo.push(() => { neck.rotation.copy(previousRotation); });
    neck.rotation.set(
      -Math.atan2(headAimDirection.y, Math.hypot(headAimDirection.x, headAimDirection.z)),
      Math.atan2(headAimDirection.x, headAimDirection.z), 0, 'YXZ'
    );
    renderDebug.headAim = {
      source: headAimSource, target: { x: headAimTarget.x, y: headAimTarget.y, z: headAimTarget.z },
      pitchDeg: THREE.MathUtils.radToDeg(neck.rotation.x),
    }; // Mobile Pixel Probe can verify both the selected water point and the counter-lean pitch.
  }

  // Diagnostics only. Runtime composition deliberately does not depend on
  // successfully identifying the current PNG child anymore: the player rig
  // root is the same transform that already carries the game's ordinary walk
  // bob/facing, so a render-only delta on that root necessarily reaches the
  // current body PNG, procedural legs, and any in-rig held visuals together.
  function discoverAvatarBodyRoots() {
    if (!playerMesh?.isObject3D) return [];
    const candidates = [];
    playerMesh.traverse?.(obj => {
      if (!obj?.isObject3D || obj === playerMesh || obj === playerLegRoot) return;
      if (playerLegRoot && isDescendantOf(obj, playerLegRoot)) return;
      if (isAvatarBodyRoot(obj) && hasRenderableDescendant(obj)) candidates.push(obj);
    });

    return candidates.filter(candidate => !candidates.some(other =>
      other !== candidate && isDescendantOf(candidate, other)));
  }

  function isHeldVisualRoot(child) {
    if (!child?.isObject3D || child === playerLegRoot || isAvatarBodyRoot(child)) return false;
    return child.type === 'Group'
      && child.userData?.isPngPlane === true // game.js tags the unnamed heldItemHolder via _markPngPlane; do not counter-tilt unrelated rig groups.
      && child.visible !== false
      && !String(child.name || '').trim()
      && hasRenderableDescendant(child);
  }

  // The whole player rig is now the primary owned root. Previously the composer
  // tried to rediscover and rotate individual PNG/leg children. That made the
  // procedural feet visibly react while a rebuilt or differently-named body PNG
  // could remain rigid. Applying the channel to playerMesh itself at the final
  // renderer boundary removes that fragile child-identification dependency.
  //
  // Providers are still needed for visuals that intentionally live OUTSIDE the
  // player rig (for example a shoulder-pet root parented directly to the scene).
  // Descendants of playerMesh are skipped because they already inherit its delta.
  function currentOwnedRootEntries() {
    const entries = [];
    const add = (root, kind = 'external', providerName = null) => {
      if (!root?.isObject3D || root.visible === false || entries.some(entry => entry.root === root)) return;
      if (root !== playerMesh && isDescendantOf(root, playerMesh)) return;
      if (entries.some(existing => isDescendantOf(root, existing.root))) return;
      for (let i = entries.length - 1; i >= 0; i--) {
        if (isDescendantOf(entries[i].root, root)) entries.splice(i, 1);
      }
      entries.push({ root, kind, providerName });
    };

    add(playerMesh, 'player', 'player');
    for (const [providerName, provider] of externalRootProviders) {
      let supplied = null;
      try { supplied = provider?.(); } catch (_) { supplied = null; }
      const list = Array.isArray(supplied) || supplied instanceof Set ? Array.from(supplied) : [supplied];
      for (const root of list) add(root, 'external', providerName);
    }
    return entries;
  }

  function currentOwnedRoots() {
    return currentOwnedRootEntries().map(entry => entry.root);
  }

  function channelQuaternion(channel) {
    if (channel?.quaternion?.isQuaternion) return channel.quaternion.clone();
    const rotation = channel?.rotation || {};
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
      finite(rotation.pitch ?? rotation.x),
      finite(rotation.yaw ?? rotation.y),
      finite(rotation.roll ?? rotation.z),
      channel?.order || 'YXZ'
    ));
  }

  function resolveDelta(targetKind = 'all', space = 'local', providerName = null) {
    const ordered = Array.from(channels.entries())
      .filter(([, channel]) => {
        if (!channel || channel.enabled === false || channel.space !== space) return false;
        if (targetKind === 'player' && channel.includePlayer === false) return false;
        if (targetKind === 'external' && channel.includeExternal === false) return false;
        if (targetKind === 'external' && providerName && channel.excludeExternalProviders?.includes(providerName)) return false; // Exclude individual attachments without dropping shoulder pets.
        return true;
      })
      .sort((a, b) => finite(a[1].priority) - finite(b[1].priority) || a[0].localeCompare(b[0]));

    const rotation = new THREE.Quaternion();
    const translation = new THREE.Vector3();
    const applied = [];
    let absoluteYaw = null;

    for (const [name, channel] of ordered) {
      if (Number.isFinite(channel.absoluteYaw)) absoluteYaw = channel.absoluteYaw;
      const q = channelQuaternion(channel);
      const t = channel.translation || channel.position || null;
      if (channel.mode === 'override') rotation.copy(q);
      else rotation.multiply(q);

      if (t) {
        const next = new THREE.Vector3(finite(t.x), finite(t.y), finite(t.z));
        if (channel.translationMode === 'override') translation.copy(next);
        else translation.add(next);
      }
      applied.push(name);
    }
    return { rotation, translation, applied, absoluteYaw };
  }

  let absoluteYawScratch = null; // Allocated on first use: { euler, axis, quaternion }.
  // Turns an `absoluteYaw` channel into a plain yaw delta for this render by
  // comparing it with the body's actual base yaw, then prepends it to the
  // channel rotation (yaw first, then any lean/roll about the new forward axis).
  function applyAbsoluteYaw(delta, baseWorldQuaternion) {
    if (!Number.isFinite(delta?.absoluteYaw)) return false;
    absoluteYawScratch ||= { euler: new THREE.Euler(0, 0, 0, 'YXZ'), axis: new THREE.Vector3(0, 1, 0), quaternion: new THREE.Quaternion() };
    absoluteYawScratch.euler.setFromQuaternion(baseWorldQuaternion, 'YXZ');
    const yawDelta = wrapSignedAngle(delta.absoluteYaw - absoluteYawScratch.euler.y);
    delta.rotation.premultiply(absoluteYawScratch.quaternion.setFromAxisAngle(absoluteYawScratch.axis, yawDelta));
    return true;
  }

  // Recorded ragdoll/impact leg poses are authored in avatar-local space: the
  // thigh/calf rotations already describe the final limb directions while the
  // hips drop with the body. The legs are children of playerMesh, so a channel
  // that also TILTS the body would rotate them a second time and leave the feet
  // pointing into the air. While any enabled player channel is flagged
  // `absoluteLegs`, the leg group keeps its pre-delta world orientation and
  // takes only the summed TRANSLATION of every channel (body lowering, terrain
  // elevation). Returns null when no such channel is active.
  function resolveAbsoluteLegsTranslation() {
    let active = false, lift = 0;
    for (const channel of channels.values()) {
      if (channel && channel.enabled !== false && channel.space === 'local' && channel.includePlayer !== false && channel.absoluteLegs) { active = true; lift += channel.absoluteLegsLiftY || 0; }
    }
    return active ? resolveDelta('player').translation.add(new THREE.Vector3(0, lift, 0)) : null;
  }

  function hasResolvedDelta(delta) {
    return !!delta && (
      Math.abs(delta.rotation.x) + Math.abs(delta.rotation.y) + Math.abs(delta.rotation.z) > 1e-8
      || delta.translation.lengthSq() > 1e-12
    );
  }

  function applyWorldDelta(root, pivotWorld, worldRotation, worldTranslation, undo) {
    if (!root?.isObject3D || root.visible === false) return;
    root.updateWorldMatrix?.(true, false);

    const oldPosition = root.position.clone();
    const oldRotation = root.rotation.clone(); // Restored after render so Three cannot rewrite a >90° yaw into equivalent 180-degree X/Z Euler angles.
    const worldPosition = root.getWorldPosition(new THREE.Vector3());
    const worldQuaternion = hierarchyWorldQuaternion(root);

    const nextWorldPosition = pivotWorld.clone()
      .add(worldPosition.sub(pivotWorld).applyQuaternion(worldRotation))
      .add(worldTranslation);
    const nextWorldQuaternion = worldRotation.clone().multiply(worldQuaternion);

    if (root.parent?.isObject3D) {
      root.parent.updateWorldMatrix?.(true, false);
      const parentWorldQuaternion = hierarchyWorldQuaternion(root.parent);
      root.position.copy(root.parent.worldToLocal(nextWorldPosition.clone()));
      root.quaternion.copy(parentWorldQuaternion.invert().multiply(nextWorldQuaternion));
    } else {
      root.position.copy(nextWorldPosition);
      root.quaternion.copy(nextWorldQuaternion);
    }

    undo.push(() => {
      root.position.copy(oldPosition);
      root.rotation.copy(oldRotation);
    });
  }

  function setChannel(name, contribution = {}) {
    if (!name) return false;
    const stored = {
      priority: finite(contribution.priority),
      space: contribution.space === 'world' ? 'world' : 'local', // Movement lean is applied after portrait yaw and its camera clamp.
      mode: contribution.mode === 'override' ? 'override' : 'additive',
      translationMode: contribution.translationMode === 'override' ? 'override' : 'additive',
      enabled: contribution.enabled !== false,
      absoluteYaw: Number.isFinite(contribution.absoluteYaw) ? contribution.absoluteYaw : undefined, // Final world yaw (rotation.y convention) of the body; the composer derives the delta from the live base yaw each render.
      absoluteLegs: contribution.absoluteLegs === true, // Recorded/authored leg poses are avatar-local: the leg group ignores this channel's rotation and keeps only its translation (see resolveAbsoluteLegsTranslation).
      absoluteLegsLiftY: finite(contribution.absoluteLegsLiftY), // Raises the legs relative to the body so authored foot centres do not sink the soles into the floor.
      includePlayer: contribution.includePlayer !== false,
      includeExternal: contribution.includeExternal !== false,
      excludeExternalProviders: Array.isArray(contribution.excludeExternalProviders) ? contribution.excludeExternalProviders.filter(name => typeof name === 'string') : [], // Checked for each scene-sibling attachment during render.
      order: contribution.order || 'YXZ',
      rotation: contribution.rotation ? { ...contribution.rotation } : undefined,
      quaternion: contribution.quaternion?.isQuaternion ? contribution.quaternion.clone() : undefined,
      translation: contribution.translation ? { ...contribution.translation } : contribution.position ? { ...contribution.position } : undefined,
    };
    channels.set(String(name), stored);
    return true;
  }

  function clearChannel(name) {
    return channels.delete(String(name));
  }

  function clearAllChannels() {
    channels.clear();
  }

  function registerExternalRootProvider(name, provider) {
    if (!name || typeof provider !== 'function') return () => {};
    externalRootProviders.set(String(name), provider);
    return () => externalRootProviders.delete(String(name));
  }

  let renderFacingState = {}; // Final body deadzone includes weapon/channel yaw after ordinary gameplay facing.
  const renderFacingForward = new THREE.Vector3(); // Reused by final quaternion-to-yaw conversion.
  const renderFacingUp = new THREE.Vector3(0, 1, 0); // World yaw axis for body and owned held visuals.
  const renderFacingTranslation = new THREE.Vector3(); // Zero translation shared by the final yaw correction.
  const renderFacingPivot = new THREE.Vector3(); // Reused posterior pivot for final facing correction.
  const renderFacingRotation = new THREE.Quaternion(); // Reused collision-free billboard yaw delta.
  function applyRenderedFacingDeadzone(camera, undo, renderDebug) {
    if(window.CharacterActionLocks?.isLocked?.('player','facing'))return; // Paired inward-facing choreography must not be counter-rotated by the ordinary billboard clamp.
    const api = window.PerpRotation; // Shared hysteresis/clamp authority; unavailable in isolated editor fixtures.
    if (!api?.perpClamp || !camera?.position || playerMesh?.visible === false) return;
    const perps = api.cameraRelativePerpsAtWorldPosition(playerMesh.position, camera.position);
    if (!perps) return;
    renderFacingForward.set(0, 0, 1).applyQuaternion(hierarchyWorldQuaternion(playerMesh));
    const rawYaw = Math.atan2(renderFacingForward.x, renderFacingForward.z); // Actual composed portrait direction, after every stance/animation channel.
    const solved = api.perpClamp(renderFacingState, rawYaw, perps);
    const correction = wrapSignedAngle(solved.effectiveTarget - rawYaw);
    renderDebug.bodyDeadzone = { rawYaw, renderedYaw: solved.effectiveTarget, correction, latestChange: 'Final body clamp follows stance yaw; seated feet retain chair facing.' };
    if (Math.abs(correction) < 1e-8) return;
    renderFacingRotation.setFromAxisAngle(renderFacingUp, correction);
    const pivot = playerMesh.localToWorld(renderFacingPivot.set(0, playerPosteriorY, 0)); // Same posterior pivot used by all composer-owned attachments.
    for (const entry of currentOwnedRootEntries()) applyWorldDelta(entry.root, pivot, renderFacingRotation, renderFacingTranslation, undo);
    if (playerLegRoot) {
      const feetYaw = playerLegRoot.rotation.y; // Feet keep their logical heading while the flat body avoids an edge-on view.
      playerLegRoot.rotation.y -= correction;
      undo.push(() => { playerLegRoot.rotation.y = feetYaw; });
    }
    const neck = currentPlayerNeckJoint(); // Counter the body correction so physical neck limits operate on the original logical gaze.
    if (neck) { const yaw = neck.rotation.y; neck.rotation.y -= correction; undo.push(() => { neck.rotation.y = yaw; }); }
  }

  const absoluteLegsParentQuaternion = new THREE.Quaternion(); // Reused by restoreAbsoluteLegs.
  function restoreAbsoluteLegs(base, undo, renderDebug) {
    if (!playerLegRoot?.parent) return;
    const oldPosition = playerLegRoot.position.clone();
    const oldQuaternion = playerLegRoot.quaternion.clone();
    playerLegRoot.parent.updateWorldMatrix?.(true, false);
    const worldPosition = base.position.clone().add(base.translation);
    playerLegRoot.position.copy(playerLegRoot.parent.worldToLocal(worldPosition));
    hierarchyWorldQuaternion(playerLegRoot.parent, absoluteLegsParentQuaternion).invert();
    playerLegRoot.quaternion.copy(absoluteLegsParentQuaternion.multiply(base.quaternion));
    undo.push(() => { playerLegRoot.position.copy(oldPosition); playerLegRoot.quaternion.copy(oldQuaternion); });
    renderDebug.absoluteLegs = true;
  }

  const worldChannelPivot = new THREE.Vector3(); // Reused posterior pivot for movement-space contributions at each render.
  function applyWorldChannels(undo, renderDebug) {
    if (!playerMesh) return;
    const bodyDelta = resolveDelta('player', 'world'); // World-aligned movement tilt must survive stance yaw and the final portrait clamp.
    const externalDelta = resolveDelta('external', 'world'); // Early check for any world-space external contributions.
    if (!hasResolvedDelta(bodyDelta) && !hasResolvedDelta(externalDelta)) return;
    const pivot = playerMesh.localToWorld(worldChannelPivot.set(0, playerPosteriorY, 0)); // Uses the final pose's posterior before leaning the whole character.
    const appliedChannels = new Set(); // Records only channels actually rendered on the player or a registered attachment.
    for (const entry of currentOwnedRootEntries()) {
      const delta = entry.kind === 'player' ? bodyDelta : resolveDelta('external', 'world', entry.providerName); // Tools may opt out of movement lean while shoulder pets keep it.
      if (!hasResolvedDelta(delta)) continue;
      applyWorldDelta(entry.root, pivot, delta.rotation, delta.translation, undo);
      for (const name of delta.applied) appliedChannels.add(name);
    }
    // Bag items (including the Kurraya) are children of playerMesh, unlike scene-sibling
    // toolHolder. They inherit the player's lean even when no external provider selected
    // that channel. Counter only the inherited channels excluded for 'heldItem', retaining
    // any world effects explicitly shared with scene-level attachments.
    const heldDelta = resolveDelta('external', 'world', 'heldItem'); // The desired world transform for held inventory items, excluding run-lean.
    const heldCorrectionRotation = heldDelta.rotation.clone().multiply(bodyDelta.rotation.clone().invert()); // Converts the already-inherited body delta to the held-item-specific delta.
    const heldCorrectionTranslation = heldDelta.translation.clone()
      .sub(bodyDelta.translation.clone().applyQuaternion(heldCorrectionRotation)); // Reverses the inherited translation while preserving allowed world-channel offsets.
    let compensatedHeldItems = 0; // Exposed in mobile diagnostics to confirm the in-rig correction ran.
    if (hasResolvedDelta({ rotation: heldCorrectionRotation, translation: heldCorrectionTranslation })) {
      for (const heldRoot of playerMesh.children.filter(isHeldVisualRoot)) {
        applyWorldDelta(heldRoot, pivot, heldCorrectionRotation, heldCorrectionTranslation, undo);
        compensatedHeldItems++;
      }
    }
    renderDebug.heldItemLeanCompensated = compensatedHeldItems;
    renderDebug.appliedOrder.push(...appliedChannels);
    renderDebug.composedWorldEulerDeg = quaternionEulerDegrees(hierarchyWorldQuaternion(playerMesh));
  }

  function registerPlayerRig(parent, handle) {
    playerMesh = parent?.isObject3D ? parent : null;
    playerLegRoot = handle?.group?.isObject3D ? handle.group : null;
    playerLegHandle = playerLegRoot ? handle : null;
    playerPosteriorY = finite(handle?.standingPosteriorY);
    playerNeckJointCache = null;
    renderFacingState = {};
  }

  function unregisterPlayerRig(parent, handle) {
    if (playerMesh !== parent) return;
    if (handle?.group && playerLegRoot !== handle.group) return;
    playerMesh = null;
    playerLegRoot = null;
    playerLegHandle = null;
    playerPosteriorY = 0;
    playerNeckJointCache = null;
    setHeadAimTarget(null);
    clearAllChannels();
  }

  // Observe the existing rig constructor rather than requiring game.js to know
  // about the composer. The render-time transform targets the already-resolved
  // rig root, so appearance/equipment rebuilds do not require retargeting.
  const previousAttach = legApi.attach.bind(legApi);
  legApi.attach = function composerAwareLegAttach(THREEArg, parent, options = {}) {
    const handle = previousAttach(THREEArg, parent, options);
    if (String(options.name || '').toLowerCase() !== 'player' || !handle) return handle;
    registerPlayerRig(parent, handle);
    const originalDispose = typeof handle.dispose === 'function' ? handle.dispose.bind(handle) : null;
    handle.dispose = function composerAwareLegDispose() {
      unregisterPlayerRig(parent, handle);
      return originalDispose?.();
    };
    return handle;
  };
  legApi.__playerBodyTransformComposerWrapped = true;

  if (THREE.WebGLRenderer && !THREE.WebGLRenderer.prototype.__playerBodyTransformComposerRenderHook) {
    const proto = THREE.WebGLRenderer.prototype;
    const originalRender = proto.render;
    proto.render = function composedPlayerBodyRender(scene, camera) {
      const undo = [];
      const renderDebug = {
        sequence: ++renderSequence,
        timestampMs: performance.now(),
        appliedOrder: [],
        portraitFaceCulling: 'material-frontside',
        forcedPortraitDoubleSide: false,
        baseWorldEulerDeg: null,
        composedWorldEulerDeg: null,
        neckYaw: null,
      }; // Persisted below before temporary transforms are restored.
      let absoluteLegsBase = null; // Set when a channel flagged absoluteLegs owns the leg group's world pose this frame.
      const poseLocked=window.CharacterActionLocks?.isLocked?.('player','pose'); // Explicit paired poses already solve limbs against their final roots; ordinary additive sway must not move them afterward.
      if (playerMesh && !poseLocked) {
        const bodyDelta = resolveDelta('player');
        const externalDelta = resolveDelta('external');
        renderDebug.appliedOrder = [...new Set([...bodyDelta.applied, ...externalDelta.applied])];
        if (hasResolvedDelta(bodyDelta) || hasResolvedDelta(externalDelta)) {
          playerMesh.updateWorldMatrix?.(true, false);
          const baseWorldQuaternion = hierarchyWorldQuaternion(playerMesh);
          renderDebug.baseWorldEulerDeg = quaternionEulerDegrees(baseWorldQuaternion);
          applyAbsoluteYaw(bodyDelta, baseWorldQuaternion);
          const pivotWorld = playerMesh.localToWorld(new THREE.Vector3(0, playerPosteriorY, 0));
          const legsTranslation = playerLegRoot ? resolveAbsoluteLegsTranslation() : null;
          if (legsTranslation) {
            playerLegRoot.updateWorldMatrix?.(true, false);
            absoluteLegsBase = {
              position: playerLegRoot.getWorldPosition(new THREE.Vector3()),
              quaternion: hierarchyWorldQuaternion(playerLegRoot),
              translation: legsTranslation.applyQuaternion(baseWorldQuaternion),
            };
          }
          for (const entry of currentOwnedRootEntries()) {
            const delta = entry.kind === 'player' ? bodyDelta : externalDelta;
            if (!hasResolvedDelta(delta)) continue;
            const worldRotation = baseWorldQuaternion.clone()
              .multiply(delta.rotation)
              .multiply(baseWorldQuaternion.clone().invert());
            const worldTranslation = delta.translation.clone().applyQuaternion(baseWorldQuaternion);
            applyWorldDelta(entry.root, pivotWorld, worldRotation, worldTranslation, undo);
          }
          renderDebug.composedWorldEulerDeg = quaternionEulerDegrees(hierarchyWorldQuaternion(playerMesh));
        }
      }

      if (playerMesh) { applyRenderedFacingDeadzone(camera, undo, renderDebug); if(!poseLocked)applyWorldChannels(undo, renderDebug); if (absoluteLegsBase) restoreAbsoluteLegs(absoluteLegsBase, undo, renderDebug); applyPlayerHeadAim(undo, renderDebug); applyPlayerNeckYawLimit(renderDebug, camera); for (const hook of postHeadAimHooks) { try { hook(undo, renderDebug, camera); } catch (_) { /* An attachment hook must never break rendering. */ } } } // Clamp after channels land, using the same live camera as this render; head attachments then follow the drawn head.
      lastRenderDebug = renderDebug;

      try {
        const result = originalRender.call(this, scene, camera);
        // Fires after the real render (so anything that re-syncs itself off
        // playerMesh/toolHolder inside that render, e.g. the procedural hand
        // sockets' onBeforeRender sentinel, has already used THIS frame's
        // composed transform) but before the delta below is undone — the one
        // point where playerMesh, toolHolder, and the hand sockets are all
        // simultaneously in the exact state actually shown on screen.
        if (pendingCapture) {
          const callback = pendingCapture;
          pendingCapture = null;
          try { callback(); } catch (_) { /* diagnostic-only; must never break rendering */ }
        }
        return result;
      }
      finally {
        for (let i = undo.length - 1; i >= 0; i--) undo[i]();
      }
    };
    // held-object-render-order.js's internal depth-replay passes need the
    // TRUE, undecorated render() — no visual-delta wrapper applied — and
    // find it by walking a chain of __hobunji*Original markers left by each
    // wrapper (see its unwrapRendererRender). Without this marker on this
    // wrap specifically, that unwrap stopped one link too early and those
    // replay passes still ran this wrap's full apply-delta/render/undo cycle
    // (with scene.autoUpdate forced false around them, so the freshly-applied
    // delta never propagated into matrixWorld for that one call) instead of
    // the plain pass-through the depth-replay design intends.
    proto.render.__hobunjiPlayerBodyComposerOriginal = originalRender;
    proto.__playerBodyTransformComposerRenderHook = true;
  }

  // One-shot: fires `callback` synchronously mid-render on the next real
  // frame, at the single point where every composer-owned root (playerMesh,
  // toolHolder, shoulder-pet roots, ...) reflects its true as-rendered
  // transform rather than the resting state a caller would see between
  // frames. Intended for diagnostics (e.g. a transform dump) that need a
  // self-consistent snapshot instead of comparing some objects mid-tilt
  // against others already restored. Returns false if a capture is already
  // pending (last-writer-wins would silently drop the earlier caller).
  function captureNextRenderTransforms(callback) {
    if (typeof callback !== 'function' || pendingCapture) return false;
    pendingCapture = callback;
    return true;
  }

  // The extra yaw (radians) the active channels will add to playerMesh at the
  // next render, without waiting for one. Channels like weapon-idle-stance-
  // body-yaw only ever reach playerMesh through this composer's render-time
  // world delta (see the module comment above) — anything that needs to
  // reason about the body's yaw ahead of render (e.g. game.js's
  // updatePlayerHeadAim, which counter-rotates the neck so the head keeps
  // its own world yaw locked to the aim direction) must add this in, or it
  // ends up countering only playerMesh.rotation.y's pre-delta resting yaw
  // and the head renders off-target by whatever yaw a channel contributes.
  function resolvedYawDeltaRad() {
    const delta = resolveDelta('player');
    if (playerMesh && Number.isFinite(delta.absoluteYaw)) applyAbsoluteYaw(delta, hierarchyWorldQuaternion(playerMesh)); // Same base-yaw comparison the render hook makes.
    return new THREE.Euler().setFromQuaternion(delta.rotation, 'YXZ').y;
  }

  window.PlayerBodyTransformComposer = {
    setChannel,
    setHeadAimTarget,
    addPostHeadAimHook,
    clearChannel,
    clearAllChannels,
    registerExternalRootProvider,
    captureNextRenderTransforms,
    resolvedYawDeltaRad,
    getHeadMaxYawDeg: () => PLAYER_HEAD_MAX_YAW_DEG, // Shared physical yaw cap lets NPC greeting neck turns match the player's head limit without duplicating the number.
    getPlayerMesh: () => playerMesh,
    getPlayerLegHandle: () => playerLegHandle,
    getPosteriorY: () => playerPosteriorY, // Exact live player-local posterior pivot shared by holding/camera/composed body transforms.
    getVisualRoots: () => currentOwnedRoots().slice(),
    hasVisibleHeldItem: () => !!playerMesh && Array.from(playerMesh.children || []).some(isHeldVisualRoot),
    getDebug() {
      const delta = resolveDelta('player');
      const neckJoint = currentPlayerNeckJoint(); // Used below so the mobile/debug report can show the currently clamped local neck yaw without console access.
      return {
        playerAttached: !!playerMesh,
        posteriorY: playerPosteriorY,
        headMaxYawDeg: PLAYER_HEAD_MAX_YAW_DEG,
        currentNeckYawDeg: neckJoint ? THREE.MathUtils.radToDeg(neckJoint.rotation.y) : null,
        renderRoot: playerMesh?.name || playerMesh?.type || null,
        avatarBodyRoots: discoverAvatarBodyRoots().map(root => root.name || root.type),
        visualRoots: currentOwnedRoots().map(root => root.name || root.type),
        externalProviders: Array.from(externalRootProviders.keys()),
        portraitFaceCulling: 'material-frontside',
        forcedPortraitDoubleSide: false,
        channels: Array.from(channels.entries()).map(([name, channel]) => ({
          name,
          priority: channel.priority,
          space: channel.space,
          mode: channel.mode,
          enabled: channel.enabled !== false,
          includePlayer: channel.includePlayer !== false,
          includeExternal: channel.includeExternal !== false,
          excludeExternalProviders: channel.excludeExternalProviders.slice(), // Shown by existing mobile composer diagnostics.
          rotation: channel.rotation || null,
          translation: channel.translation || null,
        })),
        appliedOrder: delta.applied,
        lastRender: lastRenderDebug ? {
          ...lastRenderDebug,
          appliedOrder: lastRenderDebug.appliedOrder.slice(),
          baseWorldEulerDeg: lastRenderDebug.baseWorldEulerDeg ? { ...lastRenderDebug.baseWorldEulerDeg } : null,
          composedWorldEulerDeg: lastRenderDebug.composedWorldEulerDeg ? { ...lastRenderDebug.composedWorldEulerDeg } : null,
          neckYaw: lastRenderDebug.neckYaw ? { ...lastRenderDebug.neckYaw } : null,
        } : null,
      };
    },
  };
})();
