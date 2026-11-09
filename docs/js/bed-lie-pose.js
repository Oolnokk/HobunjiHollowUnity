// Shared player sleep pose: flatten the live portrait across the authored mattress, then advance the normal day.
// The gameplay owner injects its player transform/calendar callbacks; this module owns only presentation.
(() => {
  'use strict';

  const CHANNEL = 'bed-lie-pose'; // Composer channel reserved for the sleep animation, cleared before waking.
  const LIE_DURATION = 1.9; // Seconds to reach the bed before the existing sleep/day transition runs.
  const HOLD_DURATION = 0.55; // Brief fully-flat hold lets the pose read before the next morning.
  const XRAY_ORDER = 900; // Draw the sleeper after the occupied bed while retaining normal depth tests against walls.
  let deps = null; // Live game adapters for the player, avatar, calendar and bed scene.
  let active = null; // Current sleep's immutable start/target points and mutable elapsed time.
  let xray = []; // Temporary portrait material overrides to restore in all exit paths.
  let bedDepth = []; // Only the exact occupied bed stops writing depth while its sleeper is drawn.
  const diagnostics = { begins: 0, completed: 0, cancelled: 0, last: null }; // Mobile/Pixel Probe-style sleep-pose telemetry.

  const clamp01 = number => Math.max(0, Math.min(1, Number(number) || 0));
  const smooth = number => { const t = clamp01(number); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  function restoreBedDepth(entries) {
    for (const entry of entries) {
      if (entry.node?.material === entry.cloned) entry.node.material = entry.material;
      for (const material of entry.clonedMaterials) material.dispose?.();
    }
    entries.length = 0;
  }

  function allowSleeperThroughBed(root, entries) {
    if (!root?.traverse) return;
    root.traverse(node => {
      if (!node?.isMesh || !node.material) return;
      const original = node.material;
      const source = Array.isArray(original) ? original : [original];
      const clonedMaterials = [];
      let changed = false;
      const replacement = source.map(material => {
        if (!material?.clone || material.depthWrite === false) return material;
        const clone = material.clone(); // Keep depth testing enabled; only this bed stops contributing occlusion depth.
        clone.depthWrite = false;
        clone.needsUpdate = true;
        clonedMaterials.push(clone);
        changed = true;
        return clone;
      });
      if (!changed) return;
      const cloned = Array.isArray(original) ? replacement : replacement[0];
      node.material = cloned;
      entries.push({ node, material: original, cloned, clonedMaterials });
    });
  }

  function clearFrontXray() {
    for (const entry of xray) {
      if (entry.node?.material === entry.cloned || (Array.isArray(entry.node?.material) && entry.node.material[0] === entry.cloned)) {
        entry.node.material = entry.material;
        entry.node.renderOrder = entry.order;
      }
      entry.cloned.dispose?.();
    }
    xray = [];
    restoreBedDepth(bedDepth);
  }

  function applyFrontXray() {
    allowSleeperThroughBed(active?.mattressMesh, bedDepth);
    const avatar = deps?.playerRoot?.()?.children?.find(node => node.name === 'player_avatar'); // Avoid touching tools, garments or NPC portraits.
    if (!avatar) return;
    if (xray.length) { // Other game systems sometimes refresh the portrait render order; the sleeping overlay must win.
      for (const entry of xray) entry.node.renderOrder = XRAY_ORDER;
      return;
    }
    avatar.traverse(node => {
      const isSkinnedFront = node === avatar.userData?.neckRig?.skinnedPlane && Array.isArray(node.material) && node.material.length >= 2; // Never x-ray unrelated skinned garments.
      const isRigidFront = node.name === 'npc_avatar_front_plane' && !!node.material?.clone;
      if (!isSkinnedFront && !isRigidFront) return;
      const previous = node.material; // Restored once the morning/day rollover completes.
      const front = isSkinnedFront ? previous[0] : previous;
      if (!front?.clone) return;
      const overlay = front.clone(); // Per-mesh clone prevents changing shared portrait materials elsewhere.
      overlay.depthTest = true; overlay.depthWrite = false; overlay.transparent = true; // The exact bed is depth-transparent; subdivision walls and every other occluder still hide the sleeper.
      node.material = isSkinnedFront ? [overlay, ...previous.slice(1)] : overlay;
      xray.push({ node, material: previous, order: node.renderOrder, cloned: overlay }); // Complete cleanup across both rigid and skinned paths.
      node.renderOrder = XRAY_ORDER;
    });
  }

  function clear(reason, restorePosition = true) {
    const prior = active; // Original tile coordinates ensure waking never leaves the player stuck inside the bed collider.
    if (!prior) return;
    window.PlayerBodyTransformComposer?.clearChannel?.(CHANNEL);
    clearFrontXray();
    if (restorePosition) {
      const player = deps?.player?.();
      if (player) { player.x = prior.startX; player.y = prior.startY; player.vx = 0; player.vy = 0; }
      const root = deps?.playerRoot?.(); // Waking snaps the visual root back to its safe standing tile instead of drifting through the bed collider.
      const size = Number(deps?.tileSize?.());
      if (root && size > 0) { root.position.x = prior.startX / size; root.position.z = prior.startY / size; }
    }
    active = null;
    diagnostics.last = { ...diagnostics.last, reason }; // Last reported state stays available after the animation ends.
  }

  function begin(furniture) {
    if (active) return { ok: false, message: 'Already getting into bed.' };
    if (!deps?.player?.() || !deps.playerRoot?.() || !deps?.sleep || !window.PlayerBodyTransformComposer?.setChannel)
      return { ok: false, message: 'The bed animation is not ready.' };
    if (!furniture?.mesh?.parent || !/^(basicBed|doubleBed|bedroll)$/.test(furniture.key))
      return { ok: false, message: 'This bed is not available.' };
    const THREE = deps.THREE; // Uses Three's actual furniture-local-to-world transform, including room placement and rotation.
    const authored = window.AuthoredFurniture?.peek?.(furniture.key);
    const height = window.AuthoredFurniture?.sleepSurfaceHeight?.(authored);
    const mattressPart = window.AuthoredFurniture?.sleepSurfacePart?.(authored);
    const mattressMesh = mattressPart ? furniture.mesh.userData?.meshById?.get(mattressPart.id) : null;
    if (!THREE || !Number.isFinite(height) || !mattressMesh?.isMesh) return { ok: false, message: 'Cannot find the mattress surface.' };
    furniture.mesh.updateWorldMatrix(true, false);
    const contact = furniture.mesh.localToWorld(new THREE.Vector3(0, height, 0)); // Mattress top; child guide geometry never controls placement.
    if (![contact.x, contact.y, contact.z].every(Number.isFinite)) return { ok: false, message: 'Invalid mattress position.' };
    const player = deps.player();
    const tileSize = Number(deps.tileSize()); // Game coordinates use pixels while the avatar/furniture scene uses world tiles.
    if (!Number.isFinite(tileSize) || tileSize <= 0) return { ok: false, message: 'Bed position scale is unavailable.' };
    active = {
      furniture, mattressMesh, area: deps.area(), elapsed: 0,
      startX: player.x, startY: player.y,
      targetX: contact.x * tileSize, targetY: contact.z * tileSize,
      surfaceY: contact.y, yaw: furniture.mesh.rotation.y,
    }; // Keeps the exact original standing position for safe restoration.
    // The furniture is tile-aligned and currently rotated around the world-up Y axis.
    diagnostics.begins++;
    diagnostics.last = { key: furniture.key, surfaceY: contact.y, elapsed: 0, phase: 'approach' };
    return { ok: true, message: 'You lie down on the bed.' };
  }

  function update(dt) {
    if (!active) return;
    if (deps.area() !== active.area || !active.furniture.mesh.parent || !deps.playerRoot()) {
      diagnostics.cancelled++;
      clear('area-changed', false); // An area transition already assigned a new spawn; never teleport back to the old room.
      return;
    }
    if (deps.isPaused?.()) return;
    const elapsed = active.elapsed = Math.min(LIE_DURATION + HOLD_DURATION, active.elapsed + Math.max(0, Math.min(0.1, Number(dt) || 0)));
    const approach = smooth(elapsed / 1.25); // Travel to the center of the bed before rotating the portrait.
    const flatten = smooth((elapsed - 0.35) / (LIE_DURATION - 0.35)); // Whole avatar rotates upright->flat around the posterior, not scaled down.
    const player = deps.player();
    const root = deps.playerRoot();
    player.x = lerp(active.startX, active.targetX, approach);
    player.y = lerp(active.startY, active.targetY, approach);
    player.vx = player.vy = 0;
    const hips = Number(deps.playerLegs?.()?.standingPosteriorY); // Anatomical fallback for a rig that has not yet exposed its composer pivot.
    const pivot = Number(window.PlayerBodyTransformComposer?.getPosteriorY?.()); // This is the ACTUAL pivot around which PlayerBodyTransformComposer rotates the portrait.
    const posterior = Number.isFinite(pivot) ? pivot : (Number.isFinite(hips) ? hips : 0.3);
    const rigScaleY = Number(root.scale?.y); // The player's full portrait/legs rig can be taller or shorter than its authored model units.
    const scaledPosterior = posterior * (Number.isFinite(rigScaleY) && rigScaleY > 0 ? rigScaleY : 1); // World-space posterior used by the body transform composer's pivot.
    const surfaceLift = active.surfaceY + 0.035 - root.position.y - scaledPosterior; // Keep the flattened portrait just above the actual mattress.
    window.PlayerBodyTransformComposer.setChannel(CHANNEL, {
      priority: 950, absoluteYaw: active.yaw, rotation: { pitch: -Math.PI / 2 * flatten },
      translation: { y: surfaceLift * flatten }, includeExternal: false,
    }); // Render-time pose leaves physics, weapon and original movement transforms untouched.
    if (flatten > 0.35) applyFrontXray();
    diagnostics.last = { key: active.furniture.key, surfaceY: active.surfaceY, elapsed, phase: elapsed < LIE_DURATION ? 'flattening' : 'lying-flat', flatten, xrayMeshes: xray.length };
    if (elapsed >= LIE_DURATION + HOLD_DURATION) {
      clear('slept');
      diagnostics.completed++;
      const result = deps.sleep(); // Existing day-rollover, crops, health/stamina and save behavior stay authoritative.
      deps.showToast?.(result.message, result.ok);
    }
  }


  // Scheduled humanoid NPCs reuse the same mattress lookup and front-plane
  // x-ray rule as the player. The actor's movement root stays untouched; only
  // its real body/feet rig rotates, preserving pathing, collisions and schedule state.
  const npcStates = new WeakMap(); // Per-walker visual tween and cloned front material, retained only while its walker exists.
  function npcFrontXray(walker, state, enable, bedRoot) {
    if (enable && state.xray && state.xray.bedRoot === bedRoot) { state.xray.node.renderOrder = XRAY_ORDER; return; }
    if (state.xray) {
      const rec = state.xray;
      if (rec.node.material === rec.clone || (Array.isArray(rec.node.material) && rec.node.material[0] === rec.clone)) rec.node.material = rec.material;
      rec.node.renderOrder = rec.order;
      rec.clone.dispose?.();
      restoreBedDepth(rec.bedDepth);
      state.xray = null;
    }
    if (!enable || !bedRoot?.traverse) return; // No resolved bed means no sleep x-ray exception.
    const avatar = walker.avatarGroup;
    let front = avatar?.userData?.neckRig?.skinnedPlane || null; // The skinned portrait has independent front/back materials.
    if (!front) avatar?.traverse?.(node => { if (!front && node.name === 'npc_avatar_front_plane') front = node; });
    if (!front?.material) return;
    const original = front.material;
    const array = Array.isArray(original);
    const material = array ? original[0] : original;
    if (!material?.clone) return;
    const clone = material.clone(); // Never mutate the standing NPC's shared portrait material.
    clone.depthTest = true; clone.depthWrite = false; clone.transparent = true; // Only the assigned bed is depth-transparent; walls remain real occluders.
    front.material = array ? [clone, ...original.slice(1)] : clone;
    const bedDepth = []; // Scoped to this sleeper's resolved mattress, never the room or subdivision walls.
    allowSleeperThroughBed(bedRoot, bedDepth);
    state.xray = { node: front, material: original, clone, order: front.renderOrder, bedRoot, bedDepth }; // Fully restored on schedule changes.
    front.renderOrder = XRAY_ORDER;
  }

  function syncNpc(walker, target, dt, mattress) {
    if (!walker || walker.animalDef) return;
    const rig = walker._npcCharacterRigRoot;
    const root = walker.root;
    if (!rig?.isObject3D || !root?.isObject3D) return;
    const sameArea = target?.area == null || target.area === walker.area; // Legacy spouse/activity sleep targets omit area; mattress lookup is already scoped to this walker's live area.
    const arrivalTolerance = target?.bedCenter ? 1.8 : 0.35; // A 2x2 double bed can leave the nearest walkable tile 1.5+ world units from its center; accept that arrival, then place only the visual rig on the resolved mattress.
    const activeLie = target?.pose === 'lie' && sameArea && mattress
      && Math.hypot(root.position.x - mattress.x, root.position.z - mattress.z) < arrivalTolerance; // Bed-center targets are still constrained to a known, resolved mattress.
    let state = npcStates.get(walker);
    if (!activeLie && !state) return; // Idle walkers pay zero sleep-pose cost.
    if (!state) {
      state = { blend: 0, xray: null };
      npcStates.set(walker, state);
    }
    const step = Math.max(0, Math.min(0.10, Number(dt) || 0)); // Same bounded frame integration as player and procedural-leg animations.
    state.blend = clamp01(state.blend + (activeLie ? 1 : -1) * step * 1.3); // Ease down on arrival, stand when the schedule changes.
    const fraction = smooth(state.blend);
    const rot = activeLie ? mattress.facingRad : (state.bedYaw ?? root.rotation.y);
    if (activeLie) state.bedYaw = rot; // Preserve the sleep heading while rising.
    const posterior = Number(walker.legs?.standingPosteriorY);
    const hip = Number.isFinite(posterior) ? posterior : (Number(walker.avatarHeight) || 0.9) * .35;
    const THREE = deps?.THREE;
    if (!THREE) return;
    const desiredQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 * fraction, (rot - root.rotation.y) * fraction, 0, 'YXZ'));
    rig.quaternion.copy(desiredQuaternion);
    const posteriorPivot = new THREE.Vector3(0, hip, 0).multiply(rig.scale).applyQuaternion(rig.quaternion); // Species-scale first, then pitch: the unscaled hip caused large/small NPCs to clip into mattresses.
    if (activeLie) {
      rig.parent.updateWorldMatrix?.(true, false);
      const contact = new THREE.Vector3(mattress.x, mattress.y + 0.035, mattress.z); // The same physical mattress point used by the player, not a guessed Y-only offset.
      const localContact = rig.parent.worldToLocal(contact); // Respect room elevation, NPC root yaw and scaled parent rigs.
      state.lastLocalTranslation = localContact.sub(posteriorPivot); // Saved in the rig parent's frame for a clean wake-up when its station changes.
      state.lastSurfaceY = mattress.y; // On-device surface diagnostic.
    }
    const correction = state.lastLocalTranslation; // Correctly settles the posterior on the bed, even for stretched/tiny species.
    if (correction) rig.position.set(correction.x * fraction, correction.y * fraction, correction.z * fraction);
    else rig.position.set(0, 0, 0);
    if (walker._npcRunLeanPivot && fraction > 0.001) walker._npcRunLeanPivot.quaternion.identity(); // Running and lying body rotations must not stack.
    npcFrontXray(walker, state, fraction > 0.25, mattress?.mattressMesh);
    walker._bedLieActive = fraction > 0.001;
    if (state.blend <= 0 && !activeLie) {
      npcFrontXray(walker, state, false);
      rig.position.set(0, 0, 0); rig.quaternion.identity(); // Restore exact neutral pose before normal NPC movement resumes.
      walker._bedLieActive = false;
      npcStates.delete(walker);
    }
  }

  function npcDebug(walkers = []) {
    return walkers.filter(w => npcStates.has(w)).map(w => {
      const state = npcStates.get(w);
      return { id: w.rec?.id || '?', area: w.area, blend: state.blend, surfaceY: state.lastSurfaceY, frontXray: !!state.xray };
    }); // Existing mobile Pixel Probe can report all visually sleeping NPCs without a console.
  }

  function init(adapters) { deps = adapters; }
  function cancel(reason = 'cancelled') { if (active) { diagnostics.cancelled++; clear(reason); } }
  function debug() {
    return { active: !!active, elapsed: active?.elapsed || 0, xrayMeshes: xray.length, ...diagnostics };
  }
  window.BedLiePose = { init, begin, update, syncNpc, npcDebug, cancel, isActive: () => !!active, debug };
})();
