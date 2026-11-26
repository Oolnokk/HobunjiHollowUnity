// Schedule-driven humanoid NPC mattress poses and scoped bed depth overrides.
// Presentation only: CalendarSystem exclusively owns player sleep and time passage.
(() => {
  'use strict';

  const XRAY_ORDER = 900; // Draw sleepers after the occupied bed, retaining wall depth tests.
  let deps = null; // Three.js adapter used by NPC body transforms.
  const coverOverrides = new WeakMap(); // Shared depth overrides survive until the last sleeper leaves a bed.

  const clamp01 = number => Math.max(0, Math.min(1, Number(number) || 0));
  const smooth = number => { const t = clamp01(number); return t * t * (3 - 2 * t); };

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

  // Scheduled humanoid NPCs rotate the body/feet rig without moving the navigation root.
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
    const step = Math.max(0, Math.min(0.10, Number(dt) || 0)); // Bound the frame integration like other procedural-leg animations.
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
      const contact = new THREE.Vector3(mattress.x, mattress.y + 0.035, mattress.z); // Physical mattress contact, not a guessed Y-only offset.
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
  window.BedLiePose = { init, syncNpc, releaseNpc, npcDebug };
})();
