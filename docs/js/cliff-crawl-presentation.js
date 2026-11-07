// Render-only cliff crawl for the player's authored outdoor handhold routes.
// No inventory state, collision, saved route data, or other climb types are changed.
(() => {
  'use strict';

  const system = window.ClimbSystem;
  const THREE = window.THREE;
  if (!system || !THREE) return;

  const OWNER = 'cliff-crawl'; // Procedural-hand ownership while the player is gripping a cliff face.
  const worldUp = new THREE.Vector3(0, 1, 0); // Shared upright axis for matching the portrait plane to a cliff face.
  const portraitFront = new THREE.Vector3(0, 0, 1); // The PNG avatar's local face normal; used to derive a tangent-aligned world yaw.
  const BODY_LEAN_RAD = 0.16; // Slight outward weight-bearing lean, not the former near-horizontal 60-degree fold.
  let installed = false; // Guards the one composer render-hook registration.
  let activeHandRig = null; // The current player's rig; invalidated on appearance rebuild or climb exit.
  let activeMesh = null; // Fast path for the current rig without searching every avatar descendant each render.
  let inCrawlRender = false; // Owned hand poses run only in this render scope, never during ordinary pre-render tool sync.
  let lastDebug = { active: false, hiddenHeldVisuals: 0 }; // Mobile-readable snapshot of the most recent rendered crawl.

  function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }

  // Four independently timed grip transfers over each graph edge. A planted
  // hand/foot stays on the FROM hold until its turn, then reaches the TO hold.
  // Lift goes along the rock normal, never world-up, so lateral routes work.
  function sampleContact(progress, moving, delay) {
    if (!moving) return { progress: 1, lift: 0 };
    const t = clamp((clamp(Number(progress) || 0) - delay) / (1 - delay));
    return { progress: t, lift: Math.sin(Math.PI * t) };
  }

  function surfaceContact(state, outward, side, kind, modelHeight) {
    const size = Math.max(1, Number(state.tileSize) || 64); // Shared world-pixel-to-Three conversion with the route runtime.
    const p = state.player; // The live climb session's player; only read here.
    const from = state.moving
      ? new THREE.Vector3(p.climbStartX / size, p.climbSurfaceStartY, p.climbStartY / size)
      : new THREE.Vector3(p.x / size, p.climbSurfaceY, p.y / size);
    const to = state.moving
      ? new THREE.Vector3(p.climbEndX / size, p.climbSurfaceEndY, p.climbEndY / size)
      : from;
    const isLeft = side === 'left';
    const delay = kind === 'hand' ? (isLeft ? 0.07 : 0.38) : (isLeft ? 0.58 : 0.24);
    const reach = sampleContact(state.progress, state.moving, delay);
    const tangent = new THREE.Vector3(outward.z, 0, -outward.x); // Positive side of the generated cliff plane.
    const sideSign = isLeft ? -1 : 1; // Separates left and right grips in face-local tangent coordinates.
    const height = kind === 'hand' ? 0.56 : 0.07; // Feet keep the surface contact height; hands reach above the shoulders.
    return from.lerp(to, reach.progress)
      .addScaledVector(tangent, sideSign * modelHeight * 0.13)
      .addScaledVector(worldUp, modelHeight * height)
      .addScaledVector(outward, modelHeight * ((kind === 'foot' ? 0.095 : 0.085) + reach.lift * 0.10)); // Keep planted limb shells in front of cliff depth, not buried inside stone.
  }

  function currentHandRig(mesh) {
    if (mesh && activeMesh === mesh && activeHandRig?.group?.parent) return activeHandRig;
    let rig = null; // The avatar's existing procedural-hand rig, not an independently authored arm set.
    mesh?.traverse?.(node => {
      if (!rig && node.userData?.proceduralHandRig) rig = node.userData.proceduralHandRig;
    });
    return rig;
  }

  function handsOnCliff(rig) {
    const state = system.getCrawlState?.();
    const normal = state?.route?.normal;
    if (!inCrawlRender || !state || !rig || !normal) return; // The pre-render hand driver may invoke our provider outside the temporary tilted body pose.
    const outward = new THREE.Vector3(normal.x, 0, normal.z).normalize(); // World-space away from the rock face.
    const h = Math.max(0.2, Number(window.PlayerBodyTransformComposer?.getPlayerLegHandle?.()?.modelHeight) || 1);
    const palmQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward); // Orient the hand's grip frame in the same face space as both feet.
    for (const side of ['left', 'right']) {
      const target = surfaceContact(state, outward, side, 'hand', h); // Authored route holds, not avatar-relative swing offsets.
      rig.placeHandWorld?.(side, target, palmQ);
    }
  }


  function saveHandPose(rig, undo) {
    const sockets = []; // Existing two procedural-hand sockets, scoped to one draw only.
    for (const side of ['left', 'right']) {
      const node = rig.group?.getObjectByName?.(side + '_hand_socket');
      if (!node) continue;
      sockets.push({
        node, position: node.position.clone(), quaternion: node.quaternion.clone(),
        scale: node.scale.clone(), visible: node.visible,
      });
    }
    if (!sockets.length) return;
    undo.push(() => {
      for (const item of sockets) {
        item.node.position.copy(item.position);
        item.node.quaternion.copy(item.quaternion);
        item.node.scale.copy(item.scale);
        item.node.visible = item.visible;
      }
      rig.group?.updateWorldMatrix?.(true, true);
    });
  }

  function claimHandRig(mesh, active, undo = null) {
    const rig = active ? currentHandRig(mesh) : null;
    if (activeHandRig && activeHandRig !== rig) {
      if (activeHandRig.getDebug?.().poseOwner === OWNER) {
        activeHandRig.setPoseProvider?.(OWNER, null);
        activeHandRig.useIdlePose?.(); // Restore idle only if no paired/grapple action has taken ownership.
      }
      activeHandRig = null;
      activeMesh = null;
    }
    if (!rig) return null;
    const owner = rig.getDebug?.().poseOwner;
    if (owner && owner !== OWNER) {
      activeHandRig = null; activeMesh = null;
      return null; // Paired actions that started mid-climb retain their hand poses.
    }
    if (rig !== activeHandRig) {
      rig.setPoseProvider?.(OWNER, () => handsOnCliff(rig));
      rig.useIdlePose?.(); // Clear the last tool grip before taking render-scoped snapshots.
      activeHandRig = rig;
      activeMesh = mesh;
    }
    if (undo) saveHandPose(rig, undo);
    rig.applyOwnedPose?.(); // Update this render even if the regular pre-render hand sync already ran.
    return rig;
  }

  function hideForOneRender(node, undo) {
    if (!node?.isObject3D || node.visible === false) return 0;
    node.visible = false;
    undo.push(() => { node.visible = true; }); // Restore visibility even if renderer throws.
    return 1;
  }

  function hideHeldEquipment(mesh, undo) {
    let count = 0; // Counts explicitly held visuals, never stowed back burdens or clothing.
    const toolHolder = window.ProceduralHandAttachments?.gameDeps?.toolHolder;
    count += hideForOneRender(toolHolder, undo); // Melee tools/weapons and equipped ranged visuals.
    const bagHolder = mesh.children?.find(node =>
      node.type === 'Group' && node.userData?.isPngPlane === true && !String(node.name || '').trim()
    ); // game.js's heldItemHolder for food, consumables and ordinary inventory items.
    count += hideForOneRender(bagHolder, undo);
    const carriedBurden = window.Shattercasks?.heldHandTarget?.()?.holder;
    if (carriedBurden !== bagHolder && carriedBurden !== toolHolder) {
      count += hideForOneRender(carriedBurden, undo); // Only a burden carried in the hands, not on the back.
    }
    return count;
  }

  function saveLegPose(legHandle, undo) {
    const nodes = []; // Minimal live bone/socket transforms changed by applyWorldFootTargets.
    for (const side of ['left', 'right']) {
      for (const part of ['hip', 'thigh', 'calf', 'foot']) {
        const node = legHandle.group?.getObjectByName?.(side + '_' + part);
        if (!node) continue;
        nodes.push({
          node, position: node.position.clone(), quaternion: node.quaternion.clone(),
          calfLength: node.userData?.hobunjiCalfLength,
        });
      }
    }
    undo.push(() => {
      for (const item of nodes) {
        item.node.position.copy(item.position);
        item.node.quaternion.copy(item.quaternion);
        if (item.calfLength === undefined) delete item.node.userData.hobunjiCalfLength;
        else item.node.userData.hobunjiCalfLength = item.calfLength;
      }
      legHandle.group?.updateWorldMatrix?.(true, true); // Restore socket/world matrices for subsequent depth-replay renders.
    });
  }

  function poseFeet(legHandle, state, outward, undo) {
    if (!legHandle?.applyWorldFootTargets || !legHandle.group || legHandle.hasExternalFootTargets?.()) return false;
    const motion = legHandle.captureMotionState?.(); // Preserve gait targets and mode as well as the visible joint transforms.
    if (motion) undo.push(() => legHandle.restoreMotionState?.(motion));
    saveLegPose(legHandle, undo);
    const h = Math.max(0.2, Number(legHandle.modelHeight) || 1);
    const targets = { // Contacts follow the actual cliff plane, not the avatar's pitched root frame.
      left: surfaceContact(state, outward, 'left', 'foot', h),
      right: surfaceContact(state, outward, 'right', 'foot', h),
    };
    const rockFootOrientation = new THREE.Quaternion().setFromUnitVectors(worldUp, outward); // Rotate the soles to use the cliff's NORMAL as their floor, never horizontal world-up.
    return legHandle.applyWorldFootTargets(targets, rockFootOrientation, false) === true;
  }

  function applyCrawlPose(undo, renderDebug) {
    const state = system.getCrawlState?.();
    const composer = window.PlayerBodyTransformComposer;
    const mesh = composer?.getPlayerMesh?.();
    const poseLocked = window.CharacterActionLocks?.isLocked?.('player', 'pose') === true; // Paired poses take precedence over the climb presentation.
    if (!state || !mesh?.isObject3D || mesh.visible === false || poseLocked) {
      claimHandRig(null, false);
      lastDebug = { active: false, hiddenHeldVisuals: 0 };
      return;
    }
    const normal = state.route?.normal;
    if (!normal || !Number.isFinite(normal.x) || !Number.isFinite(normal.z)) return;
    const outward = new THREE.Vector3(normal.x, 0, normal.z).normalize();
    if (outward.lengthSq() < 1e-8) return;
    const h = Math.max(0.2, Number(composer.getPlayerLegHandle?.()?.modelHeight) || 1);

    // The avatar is a flat front/back PNG, so its horizontal PLANE NORMAL
    // must match the cliff normal. Using only pitch left it edge-on to many
    // walls; rotating 60 degrees around the tangent also folded it off the
    // rock. Preserve the nearer front/back face to avoid a sudden texture flip.
    const worldFront = portraitFront.clone().applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()));
    worldFront.y = 0;
    if (worldFront.lengthSq() < 1e-8) worldFront.copy(portraitFront); // Degenerate pitch: default to the PNG's authored forward.
    worldFront.normalize();
    const targetFront = outward.clone().multiplyScalar(worldFront.dot(outward) < 0 ? -1 : 1);
    const yawRad = Math.atan2(
      worldFront.z * targetFront.x - worldFront.x * targetFront.z,
      worldFront.x * targetFront.x + worldFront.z * targetFront.z
    ); // Signed world-Y rotation from the current portrait face to the rock face.
    const worldYaw = new THREE.Quaternion().setFromAxisAngle(worldUp, yawRad);
    const posedUp = worldUp.clone().multiplyScalar(Math.cos(BODY_LEAN_RAD))
      .addScaledVector(outward, Math.sin(BODY_LEAN_RAD)).normalize(); // Lean outward just enough for planted hands and feet.
    const worldLean = new THREE.Quaternion().setFromUnitVectors(worldUp, posedUp);
    const parentQ = mesh.parent?.getWorldQuaternion?.(new THREE.Quaternion()) || new THREE.Quaternion();
    const localPose = parentQ.clone().invert().multiply(worldLean).multiply(worldYaw).multiply(parentQ);
    const oldPosition = mesh.position.clone(), oldQuaternion = mesh.quaternion.clone();
    const shifted = mesh.getWorldPosition(new THREE.Vector3()).addScaledVector(outward, h * 0.27);
    mesh.position.copy(mesh.parent?.worldToLocal ? mesh.parent.worldToLocal(shifted) : shifted);
    mesh.quaternion.premultiply(localPose);
    mesh.updateWorldMatrix?.(true, true);
    undo.push(() => { mesh.position.copy(oldPosition); mesh.quaternion.copy(oldQuaternion); mesh.updateWorldMatrix?.(true, true); });
    const previousRenderScope = inCrawlRender; // Nested/auxiliary renders restore the outer hand-pose scope.
    inCrawlRender = true;
    undo.push(() => { inCrawlRender = previousRenderScope; });
    const rig = claimHandRig(mesh, true, undo);
    const legHandle = composer.getPlayerLegHandle?.();
    const feetPosed = poseFeet(legHandle, state, outward, undo);
    const hiddenHeldVisuals = hideHeldEquipment(mesh, undo);
    lastDebug = {
      active: true, moving: !!state.moving, phase: Number(state.phase) || 0,
      routeId: state.route.id, supportNormal: { x: outward.x, z: outward.z },
      handRigOwned: !!rig, feetPosed, hiddenHeldVisuals,
      portraitYawCorrectionDeg: yawRad * 180 / Math.PI, bodyLeanDeg: BODY_LEAN_RAD * 180 / Math.PI,
    };
    renderDebug.cliffCrawl = lastDebug; // Also visible through the existing composer mobile render diagnostics.
  }

  function renderCrawl(undo, renderDebug) {
    const checkpoint = undo.length; // Previous composer channels must never be undone by our failure handler.
    try {
      applyCrawlPose(undo, renderDebug);
    } catch (error) {
      for (let i = undo.length - 1; i >= checkpoint; i--) {
        try { undo[i](); } catch (_) { /* Continue restoring the other transforms. */ }
      }
      undo.length = checkpoint; // The composer will later restore its own preceding transforms.
      claimHandRig(null, false);
      lastDebug = { active: false, hiddenHeldVisuals: 0, error: String(error?.message || error) };
      renderDebug.cliffCrawl = lastDebug; // Mobile testing sees the failure even if the renderer hides hook exceptions.
    }
  }

  function install() {
    if (installed) return true;
    const composer = window.PlayerBodyTransformComposer;
    if (!composer?.addPostHeadAimHook) return false;
    composer.addPostHeadAimHook(renderCrawl);
    installed = true;
    return true;
  }

  const originalInit = system.init.bind(system);
  system.init = function crawlAwareClimbInit(deps) {
    const result = originalInit(deps);
    install(); // Composer may have been lazily loaded by combat-config-loader since parsing this script.
    return result;
  };
  install();
  window.RuntimeFrameScheduler?.register?.('cliff-crawl-hook-install', () => { if (!installed) install(); }, {
    phase: 'pre-render', owner: 'CliffCrawlPresentation',
    description: 'Registers the scoped crawl render hook after delayed composer setup.',
  });
  window.CliffCrawlPresentation = { sampleContact, surfaceContact, getDebug: () => ({ ...lastDebug, hookInstalled: installed }) };
})();
