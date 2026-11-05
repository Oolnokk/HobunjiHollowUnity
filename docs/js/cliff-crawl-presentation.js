// Render-only cliff crawl for the player's authored outdoor handhold routes.
// No inventory state, collision, saved route data, or other climb types are changed.
(() => {
  'use strict';

  const system = window.ClimbSystem;
  const THREE = window.THREE;
  if (!system || !THREE) return;

  const OWNER = 'cliff-crawl'; // Procedural-hand ownership while the player is gripping a cliff face.
  const worldUp = new THREE.Vector3(0, 1, 0); // Reference vector for pitching the torso toward the cliff surface.
  let installed = false; // Guards the one composer render-hook registration.
  let activeHandRig = null; // The current player's rig; invalidated on appearance rebuild or climb exit.
  let lastDebug = { active: false, hiddenHeldVisuals: 0 }; // Mobile-readable snapshot of the most recent rendered crawl.

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  // Alternating planted/reaching limbs. A stationary climber keeps four
  // contacts, rather than running the ordinary walking animation in place.
  function sampleStride(phase, moving, side) {
    const wave = moving ? Math.sin((Number(phase) || 0) + (side === 'left' ? 0 : Math.PI)) : 0;
    return {
      lift: Math.max(0, wave), // Positive half-cycle lifts/reaches; negative half-cycle remains planted.
      drive: moving ? -wave : 0, // Opposite contact shifts weight while the other limb reaches.
    };
  }

  function currentHandRig(mesh) {
    let rig = null; // The avatar's existing procedural-hand rig, not an independently authored arm set.
    mesh?.traverse?.(node => {
      if (!rig && node.userData?.proceduralHandRig) rig = node.userData.proceduralHandRig;
    });
    return rig;
  }

  function handsOnCliff(rig) {
    const state = system.getCrawlState?.();
    if (!state || !rig) return;
    const h = Math.max(0.2, Number(window.PlayerBodyTransformComposer?.getPlayerLegHandle?.()?.modelHeight) || 1);
    for (const side of ['left', 'right']) {
      const sign = side === 'left' ? -1 : 1;
      const step = sampleStride(state.phase, state.moving, side);
      const reach = Math.min(rig.armLengthForSide?.(side) || h * 0.29, h * 0.4);
      rig.setSideIdle?.(side, {
        position: {
          x: sign * h * 0.075 + step.drive * h * 0.018,
          y: reach * (0.46 + step.lift * 0.37),
          z: -h * (0.09 + step.lift * 0.035),
        }, // Offset from authored free-hand anchor toward the wall and next hold.
        rotationDeg: { pitch: -38 - step.lift * 24, yaw: sign * 15, roll: -sign * (16 + step.lift * 18) },
      });
    }
  }

  function claimHandRig(mesh, active) {
    const rig = active ? currentHandRig(mesh) : null;
    if (activeHandRig && activeHandRig !== rig) {
      activeHandRig.setPoseProvider?.(OWNER, null);
      activeHandRig.useIdlePose?.(); // Release both hands to the original tool/idle driver.
      activeHandRig = null;
    }
    if (!rig) return null;
    if (rig !== activeHandRig) {
      const owner = rig.getDebug?.().poseOwner;
      if (owner && owner !== OWNER) return null; // Never steal a higher-priority paired-action pose.
      rig.setPoseProvider?.(OWNER, () => handsOnCliff(rig));
      activeHandRig = rig;
    }
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
    });
  }

  function poseFeet(mesh, legHandle, state, outward, undo) {
    if (!legHandle?.applyWorldFootTargets || !legHandle.group) return false;
    saveLegPose(legHandle, undo);
    const h = Math.max(0.2, Number(legHandle.modelHeight) || 1);
    const base = mesh.getWorldPosition(new THREE.Vector3()); // Already shifted and pitched by the render-only crawl pose.
    const tangent = new THREE.Vector3(-outward.z, 0, outward.x); // Across the face; sideways holds work without world-vertical feet.
    const movement = state.moving
      ? new THREE.Vector3(
        ((state.player.climbEndX || 0) - (state.player.climbStartX || 0)),
        ((state.player.climbSurfaceEndY || 0) - (state.player.climbSurfaceStartY || 0)) * 64,
        ((state.player.climbEndY || 0) - (state.player.climbStartY || 0))
      ).normalize()
      : new THREE.Vector3(0, 1, 0); // Foot steps follow actual route displacement; still hands/feet when hanging.
    const targets = {};
    for (const side of ['left', 'right']) {
      const sign = side === 'left' ? -1 : 1;
      const step = sampleStride(state.phase + Math.PI, state.moving, side); // Feet alternate opposite the reaching hand.
      targets[side] = base.clone()
        .addScaledVector(outward, -h * 0.22)
        .addScaledVector(tangent, sign * h * 0.105)
        .addScaledVector(movement, h * (0.12 + step.lift * 0.075 + step.drive * 0.018));
    }
    return legHandle.applyWorldFootTargets(targets, null, false) === true;
  }

  function renderCrawl(undo, renderDebug) {
    const state = system.getCrawlState?.();
    const composer = window.PlayerBodyTransformComposer;
    const mesh = composer?.getPlayerMesh?.();
    if (!state || !mesh?.isObject3D || mesh.visible === false) {
      claimHandRig(null, false);
      lastDebug = { active: false, hiddenHeldVisuals: 0 };
      return;
    }
    const normal = state.route?.normal;
    if (!normal || !Number.isFinite(normal.x) || !Number.isFinite(normal.z)) return;
    const outward = new THREE.Vector3(normal.x, 0, normal.z).normalize();
    if (outward.lengthSq() < 1e-8) return;
    const h = Math.max(0.2, Number(composer.getPlayerLegHandle?.()?.modelHeight) || 1);

    // Interpret the rock face as the support surface: pitch the torso *into*
    // the normal instead of bobbing vertically above world ground. The extra
    // outward clearance keeps the face from being buried in the cliff mesh.
    const blend = 1; // All normal-driven pose transforms are render-only and scoped to a live route.
    const inward = outward.clone().negate();
    const posedUp = worldUp.clone().multiplyScalar(Math.cos(1.04 * blend))
      .addScaledVector(inward, Math.sin(1.04 * blend)).normalize();
    const tilt = new THREE.Quaternion().setFromUnitVectors(worldUp, posedUp);
    const parentQ = mesh.parent?.getWorldQuaternion?.(new THREE.Quaternion()) || new THREE.Quaternion();
    const localTilt = parentQ.clone().invert().multiply(tilt).multiply(parentQ);
    const oldPosition = mesh.position.clone(), oldQuaternion = mesh.quaternion.clone();
    const shifted = mesh.getWorldPosition(new THREE.Vector3()).addScaledVector(outward, h * 0.27);
    mesh.position.copy(mesh.parent?.worldToLocal ? mesh.parent.worldToLocal(shifted) : shifted);
    mesh.quaternion.premultiply(localTilt);
    mesh.updateWorldMatrix?.(true, true);
    undo.push(() => { mesh.position.copy(oldPosition); mesh.quaternion.copy(oldQuaternion); });
    const rig = claimHandRig(mesh, true);
    const legHandle = composer.getPlayerLegHandle?.();
    const feetPosed = poseFeet(mesh, legHandle, state, outward, undo);
    const hiddenHeldVisuals = hideHeldEquipment(mesh, undo);
    lastDebug = {
      active: true, moving: !!state.moving, phase: Number(state.phase) || 0,
      routeId: state.route.id, supportNormal: { x: outward.x, z: outward.z },
      handRigOwned: !!rig, feetPosed, hiddenHeldVisuals,
    };
    renderDebug.cliffCrawl = lastDebug; // Also visible through the existing composer mobile render diagnostics.
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
  window.CliffCrawlPresentation = { sampleStride, getDebug: () => ({ ...lastDebug, hookInstalled: installed }) };
})();
