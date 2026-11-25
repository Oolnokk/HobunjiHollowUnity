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
  const bedDepth = []; // Player leases for the occupied mattress and pillow.
  const coverOverrides = new WeakMap(); // Shared depth overrides survive until the last sleeper leaves a bed.
  const diagnostics = { begins: 0, completed: 0, cancelled: 0, last: null }; // Mobile/Pixel Probe-style sleep-pose telemetry.

  const clamp01 = number => Math.max(0, Math.min(1, Number(number) || 0));
  const smooth = number => { const t = clamp01(number); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  function restoreBedDepth(entries) {
    for (const entry of entries) {
      if (--entry.users > 0) continue;
      if (entry.node.material === entry.replacement) entry.node.material = entry.original;
      for (const material of entry.clones) material.dispose?.();
      if (coverOverrides.get(entry.node) === entry) coverOverrides.delete(entry.node);
    }
    entries.length = 0;
  }

  function allowSleeperThroughBed(surface, entries) {
    for (const node of [surface.mattressMesh, ...(surface.pillowMeshes || [])]) {
      if (!node?.isMesh || !node.material) continue;
      const existing = coverOverrides.get(node);
      if (existing?.replacement === node.material) {
        existing.users++;
        entries.push(existing);
        continue;
      }
      const original = node.material;
      const source = Array.isArray(original) ? original : [original];
      const clones = [];
      const materials = source.map(material => {
        if (!material?.clone || material.depthWrite === false) return material;
        const clone = material.clone(); // Walls and the bed frame keep normal depth.
        clone.depthWrite = false;
        clones.push(clone);
        return clone;
      });
      if (!clones.length) continue;
      const replacement = Array.isArray(original) ? materials : materials[0];
      const entry = { node, original, replacement, clones, users: 1 };
      node.material = replacement;
      coverOverrides.set(node, entry);
      entries.push(entry);
    }
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
    const avatar = deps?.playerRoot?.()?.children?.find(node => node.name === 'player_avatar'); // Avoid touching tools, garments or NPC portraits.
    if (!avatar) return;
    if (xray.length) { // Other game systems sometimes refresh the portrait render order; the sleeping overlay must win.
      for (const entry of xray) entry.node.renderOrder = XRAY_ORDER;
      return;
    }
    if (!bedDepth.length) allowSleeperThroughBed(active.surface, bedDepth);
    avatar.traverse(node => {
      const isSkinnedFront = node === avatar.userData?.neckRig?.skinnedPlane && Array.isArray(node.material) && node.material.length >= 2; // Never x-ray unrelated skinned garments.
      const isRigidFront = (node.name === 'player_avatar_front_plane' || node.name === 'npc_avatar_front_plane') && !!node.material?.clone;
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
    window.FurnitureTableSystem?.releaseLieSlot?.(prior.player);
    if (restorePosition) {
      const player = deps?.player?.();
      if (player) { player.x = prior.startX; player.y = prior.startY; player.vx = 0; player.vy = 0; }
      const root = deps?.playerRoot?.(); // Waking snaps the visual root back to its safe standing tile instead of drifting through the bed collider.
      const size = Number(deps?.tileSize?.());
      if (root && size > 0) { root.position.x = prior.startX / size; root.position.z = prior.startY / size; }
    }
    if (reason !== 'slept') deps?.sleepCancel?.(); // Getting up (or leaving the area) withdraws this player's vote to sleep.
    active = null;
    diagnostics.last = { ...diagnostics.last, reason }; // Last reported state stays available after the animation ends.
  }

  function begin(furniture) {
    if (active) return { ok: false, message: 'Already getting into bed.' };
    if (window.CharacterActionLocks?.isLocked?.('player', 'pose')) return { ok: false, message: 'Cannot lie down during another full-body animation.' }; // Paired choreography owns the player root and must not be displaced by a bed approach.
    if (!deps?.player?.() || !deps.playerRoot?.() || !deps?.sleep || !window.PlayerBodyTransformComposer?.setChannel)
      return { ok: false, message: 'The bed animation is not ready.' };
    if (!furniture?.mesh?.parent || !/^(basicBed|doubleBed|bedroll)$/.test(furniture.key))
      return { ok: false, message: 'This bed is not available.' };
    const player = deps.player();
    const tileSize = Number(deps.tileSize()); // Game coordinates use pixels while the avatar/furniture scene uses world tiles.
    if (!Number.isFinite(tileSize) || tileSize <= 0) return { ok: false, message: 'Bed position scale is unavailable.' };
    const area = deps.area();
    const surface = window.FurnitureTableSystem?.lieTransform?.(area, {
      pose: 'lie', furnitureId: furniture.id, bedMesh: furniture.mesh,
    }, player); // The player and NPCs claim sides through the same placed-furniture registry.
    if (surface?.occupied) return { ok: false, message: 'This bed is occupied.' };
    if (!surface) return { ok: false, message: 'Cannot find the mattress surface.' };
    active = {
      furniture, surface, player, area, elapsed: 0,
      startX: player.x, startY: player.y,
      targetX: surface.x * tileSize, targetY: surface.z * tileSize,
      surfaceY: surface.y, yaw: surface.facingRad,
    }; // Keeps the exact original standing position for safe restoration.
    // The furniture is tile-aligned and currently rotated around the world-up Y axis.
    diagnostics.begins++;
    diagnostics.last = { key: furniture.key, surfaceY: surface.y, slot: surface.slot, elapsed: 0, phase: 'approach' };
    return { ok: true, message: 'You lie down on the bed.' };
  }

  function update(dt) {
    if (!active) return;
    if (window.CharacterActionLocks?.isLocked?.('player', 'pose')) return; // A paired action may start during a bed approach; freeze this presentation instead of overwriting its authored root/tile position.
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
    diagnostics.last = { key: active.furniture.key, surfaceY: active.surfaceY, slot: active.surface.slot, elapsed, phase: elapsed < LIE_DURATION ? 'flattening' : 'lying-flat', flatten, xrayMeshes: xray.length };
    if (elapsed >= LIE_DURATION + HOLD_DURATION) {
      // Co-op: stay lying until every player is resting (js/time-consensus.js). Null = single player, original path.
      const gate = deps.sleepGate?.() || null;
      if (gate?.state === 'waiting') {
        if (!active.waitingToastShown) { active.waitingToastShown = true; deps.showToast?.('💤 Waiting for the others to sleep…', true); }
        return;
      }
      clear('slept');
      diagnostics.completed++;
      const beforeSleepHour = window.CalendarSystem?.getAbsoluteGameHour?.(); // Captures actual represented sleep duration before the legacy bed jumps to the next 06:00.
      const result = gate ? { ok: true, message: gate.message } : deps.sleep(); // A resolved consensus already applied the skip; never sleep twice.
      const afterSleepHour = window.CalendarSystem?.getAbsoluteGameHour?.(); // The continuous 24h clock measures elapsed hours across midnight.
      const sleepHours = gate ? Number(gate.hours) : Number(afterSleepHour) - Number(beforeSleepHour); // Used to distinguish short sleep from eight-hour Well Rested sleep.
      if (result?.ok && Number.isFinite(sleepHours) && sleepHours > 0) {
        window.dispatchEvent?.(new CustomEvent('hobunji-time-passage', {
          detail: { kind: 'sleep', hours: sleepHours, source: 'legacy-bed' },
        })); // Reuse the existing Rested/Well Rested authority; no parallel buff or second world-day advance.
      }
      deps.showToast?.(result.message, result.ok);
    }
  }


  // Scheduled humanoid NPCs reuse the same mattress lookup and front-plane
  // x-ray rule as the player. The actor's movement root stays untouched; only
  // its real body/feet rig rotates, preserving pathing, collisions and schedule state.
  const npcStates = new WeakMap(); // Per-walker visual tween and cloned front material, retained only while its walker exists.
  function npcFrontXray(walker, state, surface) {
    const avatar = walker.avatarGroup;
    const prior = state.xray; // Keep the lease across frames while this avatar and furniture instance are unchanged.
    if (prior && surface?.mattressMesh === prior.mattressMesh && avatar === prior.avatar) {
      prior.node.renderOrder = XRAY_ORDER;
      return;
    }
    if (prior) {
      if (prior.node.material === prior.clone || (Array.isArray(prior.node.material) && prior.node.material[0] === prior.clone)) {
        prior.node.material = prior.material;
        prior.node.renderOrder = prior.order;
      }
      prior.clone.dispose?.();
      restoreBedDepth(prior.bedDepth);
      state.xray = null;
    }
    if (!surface?.mattressMesh) return;
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
    allowSleeperThroughBed(surface, bedDepth);
    state.xray = { avatar, node: front, material: original, clone, order: front.renderOrder, mattressMesh: surface.mattressMesh, bedDepth };
    front.renderOrder = XRAY_ORDER;
  }

  function syncNpc(walker, target, dt, mattress) {
    if (!walker || walker.animalDef) return;
    const participantId = window.NpcCharacterState?.participantId?.(walker.rec?.id)
      || 'npc:' + String(walker.rec?.id || 'unknown'); // Identical NPC lock participant used by spouse-kiss and festival paired choreography.
    if (window.CharacterActionLocks?.isLocked?.(participantId, 'pose')) return; // Preserve a claimed run-lean/torso frame; background bed settling must not rotate or relocate a kissing/dancing partner.
    const rig = walker._npcCharacterRigRoot;
    const root = walker.root;
    if (!rig?.isObject3D || !root?.isObject3D) return;
    const sameArea = target?.area == null || target.area === walker.area; // Legacy spouse/activity sleep targets omit area; mattress lookup is already scoped to this walker's live area.
    const approachX = mattress?.furnitureId != null ? Number(target?.c) + 0.5 : mattress?.x; // Bed slots position the rig, while NPCs navigate to their station tile.
    const approachZ = mattress?.furnitureId != null ? Number(target?.r) + 0.5 : mattress?.z;
    const activeLie = target?.pose === 'lie' && sameArea && mattress
      && Math.hypot(root.position.x - approachX, root.position.z - approachZ) < 0.35;
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
    if (activeLie) {
      state.bedYaw = rot;
      state.surface = mattress; // Keep the same bed and slot throughout the wake blend.
    }
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
    npcFrontXray(walker, state, fraction > 0.25 && sameArea ? state.surface : null);
    walker._bedLieActive = fraction > 0.001;
    if (state.blend <= 0 && !activeLie) {
      rig.position.set(0, 0, 0); rig.quaternion.identity(); // Restore exact neutral pose before normal NPC movement resumes.
      walker._bedLieActive = false;
      npcStates.delete(walker);
    }
  }

  function npcDebug(walkers = []) {
    return walkers.filter(w => npcStates.has(w)).map(w => {
      const state = npcStates.get(w);
      return { id: w.rec?.id || '?', area: w.area, blend: state.blend, surfaceY: state.lastSurfaceY, slot: state.surface?.slot, frontXray: !!state.xray };
    }); // Existing mobile Pixel Probe can report all visually sleeping NPCs without a console.
  }

  function releaseNpc(walker) {
    const state = npcStates.get(walker); // Despawn can bypass the wake animation entirely.
    if (state) npcFrontXray(walker, state, null);
    npcStates.delete(walker);
    window.FurnitureTableSystem?.releaseLieSlot?.(walker);
  }

  function init(adapters) { deps = adapters; }
  function cancel(reason = 'cancelled') { if (active) { diagnostics.cancelled++; clear(reason); } }
  function debug() {
    return { active: !!active, elapsed: active?.elapsed || 0, xrayMeshes: xray.length, ...diagnostics };
  }
  window.BedLiePose = { init, begin, update, syncNpc, releaseNpc, npcDebug, cancel, isActive: () => !!active, debug };
})();
