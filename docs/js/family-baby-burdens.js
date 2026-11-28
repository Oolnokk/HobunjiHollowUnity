// One physical infant proxy shared with the existing Shattercasks hands/back-stow system.
// The family NPC remains the authoritative character; this module only owns the carry presentation.
(() => {
  'use strict';
  if (window.FamilyBabyBurdens) return;
  const entries = new Map(); // child ID -> shared burden + live NPC and persistence callback.
  const proxySources = new WeakMap(); // Proxy group -> source model/geometry, kept OUT of serializable Object3D.userData.
  const areas = new Set(['interior', 'farm', 'town']); // Settlement maps plus the real exterior zone registry.
  const debug = { latestChange: 'Carried baby portraits replay alpha-tested outline depth at their visible pose', lastError: null }; // Mobile-facing failures.

  function isAllowedArea(value) {
    const area = String(value || ''); // Farmhouse and barn interior maps share the home policy.
    return areas.has(area) || /^map_i_(?:farmhouse|barn)(?:_|$)/.test(area) || window.FamilyBabyFollow?.isWilderness?.(area) === true;
  }
  function currentArea() {
    return window.RomanceSystem?.helpers?.deps?.()?.getCurrentArea?.() || null; // The normal world adapter, not a second area tracker.
  }
  function showWalker(entry, show) {
    const root = entry.walker?.root;
    if (!root) return;
    if (!show && entry.hiddenRoot !== root) {
      if (entry.hiddenRoot) entry.hiddenRoot.visible = entry.previousVisibility;
      entry.hiddenRoot = root;
      entry.previousVisibility = root.visible !== false; // Preserve visibility rules owned by scene culling.
    }
    if (!show) root.visible = false;
    else if (entry.hiddenRoot) {
      entry.hiddenRoot.visible = entry.previousVisibility;
      entry.hiddenRoot = null;
    }
  }
  function portraitArt(walker) {
    const model = walker?.avatarGroup, data = model?.userData;
    const front = data?.frontTexture;
    // The ordinary NPC can use a black silhouette for its rear face. That is
    // useful for world occlusion, but not an acceptable visible baby in arms.
    const back = !data?.backTextureUsesSilhouette && data?.backTexture || front;
    return { model, data, front, back };
  }
  function makeFaceMaterial(THREE, texture, label) {
    const options = { transparent: true, depthTest: true, depthWrite: true, side: THREE.FrontSide };
    return window.HobunjiSpritePngSurface?.makeMaterial?.(THREE, texture, label, options)
      || new THREE.MeshBasicMaterial({ ...options, name: label, map: texture, alphaTest: .35 });
  }
  function headPoseOf(data) {
    const joint = data?.neckRig?.headScaleJoint; // Both the scale and position affect the one-time baked head.
    const scale = joint?.scale, offset = joint?.position;
    return { x: Number(scale?.x) || 1, y: Number(scale?.y) || 1, z: Number(scale?.z) || 1,
      offsetX: Number(offset?.x) || 0, offsetY: Number(offset?.y) || 0, offsetZ: Number(offset?.z) || 0 };
  }
  function createProxy(child, walker) {
    const THREE = window.THREE, { model, data, front, back } = portraitArt(walker);
    if (!THREE?.Group || !THREE?.Mesh || !THREE?.PlaneGeometry || !front) return null;
    const width = Math.max(.05, Number(data.portraitModelWidth) || .3);
    const height = Math.max(.05, Number(data.portraitModelHeight) || width);
    const centroidY = Number(data.visualCentroidLocalY) || 0; // Reuse the avatar's own floor-to-portrait placement.
    const centroidZ = Number(data.visualCentroidLocalZ) || 0;
    const skinned = data.neckRig?.skinnedPlane; // The adult/infant head-scale bone is part of this mesh, not the texture.
    let baked = null;
    if (skinned?.isSkinnedMesh) {
      try { baked = window.PNGPlaneAvatar?.meshBudget?.bakeStaticPortraitForCarry?.(THREE, skinned) || null; }
      catch (error) { debug.lastError = 'baby pose bake failed: ' + (error?.message || error); }
    }
    const group = new THREE.Group();
    group.name = 'family_baby_' + child.id;
    group.userData.familyBabyId = child.id;
    group.userData.hobunjiFamilyBabyPhysicalCarry = true; // Renderer identifies only this physical infant, not its parent portrait.
    if (baked?.geometry) {
      // Bake the real small-body / enlarged-head skin ONCE; carry uses one rigid mesh,
      // never a second active skeleton or another per-frame animation task.
      const mesh = new THREE.Mesh(baked.geometry, [
        makeFaceMaterial(THREE, front, 'baby_carry_front'),
        makeFaceMaterial(THREE, back, 'baby_carry_back'),
      ]);
      mesh.name = 'baby_carried_posed_portrait';
      mesh.position.set(Number(skinned.position?.x) || 0,
        height / 2 + centroidY + (Number(skinned.position?.y) || 0),
        Number(skinned.position?.z ?? centroidZ) || 0);
      mesh.userData.noOutline = true; // Source PNG already contains its own black ink.
      mesh.userData.hobunjiFamilyBabyPhysicalCarry = true; // Protect the infant from the legacy held-weapon replay.
      group.add(mesh);
      // Color layering disables stowed depth writes; use the existing PNG depth-only replay and visible-pose adapter.
      window.PngPlaneOutlineOccluder?.registerDepthMesh?.(mesh);
      window.HobunjiPortraitOutlineParity?.installMeshHook?.(mesh);
    } else {
      const geometry = new THREE.PlaneGeometry(width, height); // Simple fallback for rigid or not-yet-rigged NPCs.
      for (const [texture, rear] of [[front, false], [back, true]]) {
        const plane = new THREE.Mesh(geometry, makeFaceMaterial(THREE, texture, rear ? 'baby_carry_back' : 'baby_carry_front'));
        plane.position.y = height / 2 + centroidY;
        plane.position.z = centroidZ + (rear ? -.002 : .002);
        plane.rotation.y = rear ? Math.PI : 0;
        plane.userData.noOutline = true;
        plane.userData.hobunjiFamilyBabyPhysicalCarry = true; // Fallback faces obey the same physical baby rule.
        group.add(plane);
        window.PngPlaneOutlineOccluder?.registerDepthMesh?.(plane);
        window.HobunjiPortraitOutlineParity?.installMeshHook?.(plane); // Same protection for fallback faces.
      }
    }
    group.visible = false; // The real baby NPC is visible until a parent picks them up.
    const bounds = baked?.geometry?.boundingBox;
    const posedWidth = bounds ? Math.max(width, bounds.max.x - bounds.min.x) : width;
    const posedHeight = bounds ? Math.max(height, bounds.max.y - bounds.min.y) : height;
    const headPose = headPoseOf(data);
    Object.assign(group.userData, {
      familyBabyWidth: width, familyBabyHeight: height, // Full original portrait size; anatomy anchors are resolved separately.
      familyBabyGripAnchors: window.FamilyBabyCarryPose?.anchorsForAvatar?.(data, width, height) || null, // Baby-local posterior and neck pivot; no head-bounds scaling.
      familyBabyPosedWidth: posedWidth, familyBabyPosedHeight: posedHeight, // For diagnostics only: head deformation may expand the visible silhouette.
      familyBabyArtMode: baked?.geometry ? 'posed-rig' : 'flat-portrait',
      familyBabyRearArt: data.backTextureUsesSilhouette ? 'colored-front-fallback' : 'authored-back',
    });
    proxySources.set(group, { model, geometry: skinned?.geometry || null, headPose }); // Bone offset changes must also refresh rigid carry art. // Reference-only invalidation never pollutes save/debug serialization.
    return group;
  }
  function disposeVisual(group) {
    window.FamilyBabyLimbs?.detach?.(group); // Cloned limb materials only; the walker owns the shared hand/foot GLB geometry.
    const geometries = new Set(); // One owned geometry may be shared by both fallback portrait faces.
    group?.traverse?.(node => {
      if (node.geometry) geometries.add(node.geometry);
      for (const material of (Array.isArray(node.material) ? node.material : [node.material]))
        material?.dispose?.(); // The underlying NPC still owns the shared portrait textures.
    });
    for (const geometry of geometries) geometry?.dispose?.();
  }
  function refreshProxyArt(entry, walker) {
    const { model, data, front, back } = portraitArt(walker);
    const group = entry.burden?.group;
    if (!group || !front) return;
    const width = Math.max(.05, Number(data.portraitModelWidth) || .3);
    const height = Math.max(.05, Number(data.portraitModelHeight) || width);
    const head = headPoseOf(data), source = data.neckRig?.skinnedPlane?.geometry || null;
    const original = proxySources.get(group);
    const rebuilt = original?.model !== model || original?.geometry !== source
      || original?.headPose.x !== head.x || original?.headPose.y !== head.y
      || original?.headPose.z !== head.z
      || original?.headPose.offsetX !== head.offsetX || original?.headPose.offsetY !== head.offsetY
      || original?.headPose.offsetZ !== head.offsetZ
      || Math.abs(width - (group.userData.familyBabyModelWidth || width)) > .0001
      || Math.abs(height - (group.userData.familyBabyModelHeight || height)) > .0001;
    if (rebuilt) {
      const replacement = createProxy(entry.child, walker);
      if (!replacement) return; // Preserve the visible old carry while the new NPC loads.
      disposeVisual(group);
      for (const node of [...group.children]) group.remove(node);
      for (const node of [...replacement.children]) group.add(node);
      Object.assign(group.userData, replacement.userData);
      proxySources.set(group, proxySources.get(replacement));
      entry.burden.meshColliders = group.children.filter(node => node.isMesh); // Keep shared Shattercasks hits and draw-order tracking on the NEW geometry.
      window.Shattercasks?.refreshBurdenBounds?.(entry.burden);
      window.FamilyBabyLimbs?.attach?.(group, walker); // After colliders: kicking limbs are presentation, never hit targets.
    } else {
      window.FamilyBabyLimbs?.attach?.(group, walker); // Shared refresh checks late-loaded GLBs AND newborn size revisions without rebuilding unchanged proxies.
      // WorldPortraitLife may replace canvas textures without rebuilding the avatar.
      const textures = [front, back];
      if (group.userData.familyBabyArtMode === 'posed-rig') {
        for (const [index, material] of (group.children[0]?.material || []).entries()) {
          if (material.map !== textures[index]) { material.map = textures[index]; material.needsUpdate = true; }
        }
      } else {
        group.children.slice(0, 2).forEach((plane, index) => {
          if (plane.material.map !== textures[index]) { plane.material.map = textures[index]; plane.material.needsUpdate = true; }
        });
      }
    }
    group.userData.familyBabyModelWidth = width; group.userData.familyBabyModelHeight = height;
    group.userData.familyBabyRearArt = data.backTextureUsesSilhouette ? 'colored-front-fallback' : 'authored-back';
    const carryable = entry.burden.data?.carryable;
    if (carryable) {
      const w = width, h = height; // Stay in portrait-plane coordinates even when a newborn's head animation changes the posed bounds.
      if (window.FamilyBabyCarryPose?.applyTo) window.FamilyBabyCarryPose.applyTo(
        carryable, w, h, group.userData.familyBabyGripAnchors); // Stable baby-local grip anchors; preserve hand socket object identities.
      else { // Missing optional profile script: preserve the original usable hand positions.
        carryable.handTargets.left.x = w * .40; carryable.handTargets.left.y = h * .5;
        carryable.handTargets.right.x = -w * .40; carryable.handTargets.right.y = h * .5;
        carryable.billboardAnchor.position.y = h * .06; carryable.billboardAnchor.position.z = -h * .48;
        carryable.backCarry.position.y = h * .16; carryable.backCarry.position.z = -h * .48;
      }
    }
  }
  function moveToWalker(entry) {
    const root = entry.walker?.root, burden = entry.burden;
    if (!root?.parent || burden.flying || (burden.carried && entry.child.carryBy)) return;
    if (burden.mapId !== entry.walker.area) {
      // The real NPC can move through a portal before the player's scene switches.
      // Treat the old area record as unavailable so the player cannot pick up an invisible duplicate.
      burden.carried = true;
      if (entry.walker.area === currentArea() && window.Shattercasks?.transferCarriedBurdenToArea?.(entry.walker.area, burden))
        burden.carried = false; // The live NPC and the real physical burden now occupy the same active area.
    } else burden.carried = false;
    if (burden.group.parent !== root.parent) root.parent.add(burden.group); // Do not reorder scene nodes every family tick.
    burden.group.position.copy(root.position);
    burden.group.rotation.set(0, 0, 0);
    burden.group.scale.set(1, 1, 1);
    burden.group.visible = false;
    burden.col = Math.floor(root.position.x);
    burden.row = Math.floor(root.position.z);
  }
  function settle(entry, item, basket = false) {
    if (entry.disposing) return;
    const child = entry.child;
    const follow = window.FamilyBabyFollow;
    if (!basket && follow?.canFollowIn?.(item.mapId) && item.mapId === currentArea()) {
      const landing = follow.safeLanding?.(item.mapId, item.col, item.row);
      if (landing) { item.col = landing.c; item.row = landing.r; }
      else if (follow.safeLanding) basket = true; // No valid ground: return safely instead of occupying water or solid terrain.
    }
    const wasPlayer = child.carryBy === 'player'; // Capture ownership before releasing the shared burden.
    child.carryBy = null; child.carryPose = null;
    clearNpcGrip(entry); entry.npcCarryPose = null; // Release NPC hands before transferring ownership to crawl.
    child.followPlayer = !basket && isAllowedArea(item.mapId) && (wasPlayer || child.followPlayer) && window.FamilyBabyFollow?.canFollowIn?.(item.mapId) === true;
    window.FamilyBabyFollow?.clearWalker?.(entry.walker);
    item.group.userData.familyBabyFlying = false;
    child.carrySpot = basket || !isAllowedArea(item.mapId)
      ? null : { area: item.mapId, c: item.col, r: item.row }; // Dropped baby stays where it landed, across save/reload.
    item.carried = false; item.flying = false;
    item.group.visible = false;
    showWalker(entry, true);
    const root = entry.walker?.root;
    if (basket && root) {
      const ctx = window.RomanceFamily?.careContext?.();
      const target = ctx?.basketObject?.(child) || ctx?.helpers?.bedSpot?.();
      const c = target?.col ?? target?.c, r = target?.row ?? target?.r;
      if (Number.isFinite(c) && Number.isFinite(r)) {
        if (entry.walker.area !== 'interior') entry.walker.transferToArea?.('interior', { c, r });
        if (entry.walker.area === 'interior') { root.position.x = c + .5; root.position.z = r + .5; }
      }
    }
    if (!basket && root) {
      if (entry.walker.area !== item.mapId) entry.walker.transferToArea?.(item.mapId, { c: item.col, r: item.row }); // The existing NPC zone mover relocates the authoritative baby after farm/town landings.
      if (entry.walker.area === item.mapId) {
        root.position.x = item.col + .5; root.position.z = item.row + .5;
        if (item.mapId === currentArea() && Number.isFinite(item.group.position.y)) root.position.y = item.group.position.y; // Initial grounded height; follower settles to terrain on the next frame.
      }
    }
    moveToWalker(entry);
    if (child.followPlayer) window.FamilyBabyFollow?.bind?.(child, entry.walker, entry.walker?._childPhase || 'basket');
    entry.persist?.();
    debug.lastError = null;
  }
  function disposeProxy(entry) {
    disposeVisual(entry.burden?.group);
    entry.burden?.group?.parent?.remove?.(entry.burden.group);
  }
  function ensure(child, walker, persist) {
    if (!child?.id) return null;
    let entry = entries.get(child.id);
    if (entry) {
      entry.child = child;
      if (walker?.root && walker.root !== entry.walker?.root) showWalker(entry, true); // Restore the old NPC visibility before adopting a newly spawned walker.
      entry.walker = walker || entry.walker;
      entry.persist = persist;
      refreshProxyArt(entry, entry.walker);
      if (entry.burden.mapId === currentArea() && !window.Shattercasks?.rebindRegisteredBurden?.(entry.burden))
        debug.lastError = 'infant burden scene registry needs recovery'; // A rebuilt farmhouse scene must retain the SAME physical baby.
      return entry;
    }
    const api = window.Shattercasks, area = currentArea(); // Shared Burden owns real hands, stowing, throws and safe landing.
    if (!api?.registerBurden || !walker?.root?.parent || walker.area !== area || !isAllowedArea(area)) return null;
    const group = createProxy(child, walker);
    if (!group) { debug.lastError = 'infant portrait not ready'; return null; }
    walker.root.parent.add(group);
    group.position.copy(walker.root.position);
    entry = { child, walker, persist, burden: null, hiddenRoot: null, previousVisibility: true, disposing: false };
    const infantWidth = Math.max(.06, Number(walker.avatarGroup?.userData?.portraitModelWidth) || .3); // Reuses the already age-scaled portrait for both hand contacts.
    const infantHeight = Math.max(.06, Number(walker.avatarGroup?.userData?.portraitModelHeight) || infantWidth);
    const defaultCarry = window.FamilyBabyCarryPose?.forSize?.(
      infantWidth, infantHeight, group.userData.familyBabyGripAnchors); // Same real newborn posterior/neck pivots used after a proxy rebuild.
    const burden = api.registerBurden({
      id: 'family_baby_' + child.id, mapId: area, // Let Shattercasks pick the canonical active world scene; an NPC sub-group would reset zone burden records.
      group, kind: 'familyBaby', displayName: child.name || 'Baby',
      hanging: false, invulnerable: true, noHang: true,
      data: { carryable: defaultCarry || {
        enabled: true,
        billboardAnchor: { coordinateSpace: 'posterior-relative',
          position: { x: 0, y: infantHeight * .06, z: -infantHeight * .48 },
          rotation: { x: 0, y: 0, z: 0 }, size: 1 }, // Shared Burden held-pose owner locates the baby at the parent's torso.
        handTargets: { // Standard grip solver places both player's hands around the actual infant, not at the posterior anchor.
          left: { x: infantWidth * .40, y: infantHeight * .5, z: .015, rotation: { x: 180, y: 0, z: -90 } },
          right: { x: -infantWidth * .40, y: infantHeight * .5, z: .015, rotation: { x: 0, y: 0, z: 90 } },
        },
        backCarry: { position: { x: 0, y: infantHeight * .16, z: -infantHeight * .48 },
          rotation: { x: 0, y: 180, z: 0 }, size: 1,
          portraitAnchor: { x: 0, y: 0, z: 0 } }, // Same species-adjusted back-stow rig as other carryables.
      } },
      onPickup: () => {
        clearNpcGrip(entry); entry.npcCarryPose = null; // Spouse hands the baby over: its hand rig lets go.
        entry.child.carryBy = 'player'; entry.child.carryPose = 'arms'; entry.child.carrySpot = null; entry.child.followPlayer = false;
        window.FamilyBabyFollow?.clearWalker?.(entry.walker);
        window.NpcFollowing?.releaseForCarry?.(entry.child.id); // Retire any ordinary follower session before the burden owns movement.
        if (entry.child.vatId) window.RomanceFamily?.clearVatWorkerPose?.(entry.child.vatId);
        group.visible = true; showWalker(entry, false);
        entry.persist?.();
      },
      onDrop: item => settle(entry, item),
      onThrow: () => { group.visible = true; group.userData.familyBabyFlying = true; showWalker(entry, false); }, // Limbs flail while airborne.
      onImpact: item => {
        item.col = Math.floor(item.group.position.x); item.row = Math.floor(item.group.position.z);
        settle(entry, item);
        return true; // A living child lands unharmed; no pottery effect is invoked.
      },
      onLost: item => {
        if (entry.disposing) return;
        settle(entry, item, true); // Unsupported maps retain the existing safe basket fallback.
        disposeProxy(entry); // The registry already removed this burden; do not strand an invisible mesh in the old scene.
        entries.delete(child.id);
      },
    });
    if (!burden) { group.parent?.remove(group); debug.lastError = 'burden registration failed'; return null; }
    entry.burden = burden;
    window.FamilyBabyLimbs?.attach?.(group, walker); // Attached after registerBurden so limbs are not collected as colliders.
    group.userData.familyBabyModelWidth = infantWidth;
    group.userData.familyBabyModelHeight = infantHeight;
    refreshProxyArt(entry, walker); // Grip bounds include the posed head, not only the unscaled body.
    entries.set(child.id, entry);
    if (child.carryBy === 'spouse') {
      child.carryBy = null; child.carryPose = null; child.carrySpot = null;
      entry.persist?.(); // Spouse carry is a live attachment: after reload, walk to the cradle again rather than teleport the baby.
    }
    return entry;
  }
  function sync(child, walker, phase, persist) {
    if (phase !== 'basket' && phase !== 'toddler') { discard(child?.id); return null; } // Both young stages use the same carry registry.
    const entry = ensure(child, walker, persist);
    if (!entry) return null;
    const api = window.Shattercasks;
    const held = api?.heldBurdenInfo?.()?.id === entry.burden.id;
    const back = api?.backCarriedInfo?.()?.id === entry.burden.id;
    if (entry.burden.flying) {
      entry.burden.group.visible = true;
      showWalker(entry, false); // Release-to-impact remains a SINGLE airborne baby, not a second NPC walking out of the crib.
      return entry;
    }
    if (held || back) {
      child.carryBy = 'player';
      child.carryPose = back ? 'back' : 'arms';
      child.followPlayer = false;
      entry.burden.group.visible = true;
      showWalker(entry, false);
    } else if (child.carryBy === 'player') {
      child.carryBy = null; child.carryPose = null; child.carrySpot = null; child.followPlayer = false;
      entry.persist?.(); // Restore cannot invent an unsaved held-burden slot.
      showWalker(entry, true);
      moveToWalker(entry);
    } else if (child.carryBy === 'spouse' && entry.burden.carried) showWalker(entry, false);
    else { showWalker(entry, true); moveToWalker(entry); }
    return entry;
  }
  function takeIntoArms(child, walker, persist) {
    const entry = ensure(child, walker, persist), api = window.Shattercasks;
    if (!entry || !api?.pickUp || entry.burden.flying
        || (child.carryBy !== 'spouse' && entry.walker?.area !== currentArea())) return false; // The child must be present, unless the visible spouse is handing them over.
    if (api.heldBurdenInfo?.()?.id === entry.burden.id) return true;
    if (api.backCarriedInfo?.()?.id === entry.burden.id) return api.takeFromBack?.() === true;
    if (api.heldBurdenInfo?.()) { debug.lastError = 'hands occupied'; return false; }
    const area = currentArea();
    if (child.carryBy === 'spouse') {
      entry.burden.carried = true;
      if (entry.burden.mapId !== area) api.transferCarriedBurdenToArea?.(area, entry.burden);
      if (entry.burden.mapId !== area) return false;
      entry.burden.carried = false;
      const root = entry.walker?.root, spouse = window.RomanceSystem?.helpers?.findWalker?.(child.otherParentId);
      const parent = spouse?.root?.parent || root?.parent;
      if (!parent) return false;
      parent.add(entry.burden.group);
      entry.burden.group.position.copy(spouse?.root?.position || root.position);
    }
    if (entry.burden.mapId !== area) return false;
    return api.pickUp(entry.burden) === true; // The normal Tool Select/Action 1/2 carry system takes ownership.
  }
  // NPC carriers use the PLAYER's carry: one authored cradle/back-stow pose solved by
  // Shattercasks.solveCarryMount on the carrier's own posterior. Stowed babies remain
  // children of that body frame, rather than the independently rotating portrait.
  // The existing two-hand grips/elbows still use proceduralHeldItemTarget.
  const npcScratch = { posterior: null }; // Reused per tick; no per-call allocation.
  function clearNpcGrip(entry) {
    const root = entry?.npcGripRoot;
    if (root?.userData?.proceduralHeldItemTarget?.familyBabyId === entry.child?.id) root.userData.proceduralHeldItemTarget = null;
    if (entry) entry.npcGripRoot = null;
  }
  function solveNpcCarry(entry, spouse, back) {
    const api = window.Shattercasks, THREE = window.THREE, group = entry.burden.group;
    const body = spouse._npcCharacterRigRoot || spouse.root; // Facing frame that owns the legs/posterior, like playerMesh for the player.
    if (!api?.solveCarryMount || !api.carrierPosteriorLocal || !body || !THREE?.Vector3) return false;
    const ud = spouse.avatarGroup?.userData || {};
    const rawY = Number(spouse.legs?.standingPosteriorY), liveY = Number.isFinite(rawY) ? rawY : null;
    const revision = Number(entry.burden.data?.carryable?._backCarryRevision) || 0; // Shared profile increments only on a changed authored mount.
    const mounted = entry.npcCarryMount; // Avoid rebuilding an unchanged pose every family/AI tick.
    if (back && group.parent === body && entry.npcCarryPose === 'back'
        && mounted?.body === body && mounted.revision === revision
        && mounted.liveY === liveY && mounted.modelHeight === ud.portraitModelHeight
        && mounted.handAttachY === ud.handAttachY && mounted.speciesId === ud.speciesId
        && mounted.gender === ud.gender) return true;
    npcScratch.posterior ||= new THREE.Vector3();
    api.carrierPosteriorLocal(npcScratch.posterior, { speciesId: ud.speciesId, gender: ud.gender,
      modelHeight: ud.portraitModelHeight, handAttachY: ud.handAttachY, liveY });
    if (group.parent !== body) body.add(group);
    // Identical to the player: authored offsets are body-LOCAL units, and the rig root carries the
    // same species scale playerMesh does (a Mao'ao NPC and Mao'ao player resolve to the same pose).
    api.solveCarryMount(group, entry.burden.data?.carryable || {}, back, npcScratch.posterior);
    entry.npcCarryPose = back ? 'back' : 'arms'; // The parent stays the body for back-stowed infants and their 3D limbs.
    entry.npcCarryMount = back ? { body, revision, liveY, modelHeight: ud.portraitModelHeight,
      handAttachY: ud.handAttachY, speciesId: ud.speciesId, gender: ud.gender } : null; // Switching to arms forgets the rear mount.
    return true;
  }
  function spouseCarry(child, walker, spouse, pose, persist) {
    const entry = ensure(child, walker, persist);
    if (!entry || !spouse?.root?.parent || spouse.area !== currentArea()
        || entry.burden.flying || child.carryBy === 'player') return false; // An off-scene spouse cannot steal the newborn or attach its mesh across zone scenes.
    const api = window.Shattercasks;
    if (api?.heldBurdenInfo?.()?.id === entry.burden.id
        || api?.backCarriedInfo?.()?.id === entry.burden.id) return false;
    const back = pose === 'back';
    entry.burden.carried = true;
    if (entry.burden.mapId !== spouse.area && spouse.area === currentArea())
      api?.transferCarriedBurdenToArea?.(spouse.area, entry.burden);
    if (!solveNpcCarry(entry, spouse, back)) { // Shattercasks without the shared solver: keep the old fixed placement.
      const body = spouse._npcCharacterRigRoot || spouse.root; // Fallback also follows the carrier rather than neck/portrait yaw.
      const height = Math.max(.3, Number(spouse.avatarGroup?.userData?.portraitModelHeight) || .9);
      if (entry.burden.group.parent !== body) body.add(entry.burden.group);
      entry.burden.group.position.set(back ? 0 : height * .13,
        height * (back ? .60 : .48), height * (back ? -.22 : .23));
      entry.burden.group.rotation.set(0, back ? Math.PI : 0, back ? 0 : -.16);
      entry.burden.group.scale.set(1, 1, 1);
    }
    const carryable = entry.burden.data?.carryable;
    const gripRoot = spouse.avatarGroup; // The NPC's procedural hand rig root.
    if (!back && gripRoot?.userData && carryable) {
      if (entry.npcGripRoot && entry.npcGripRoot !== gripRoot) clearNpcGrip(entry);
      gripRoot.userData.proceduralHeldItemTarget = { holder: entry.burden.group, mode: 'authored-world',
        handTargets: carryable.handTargets || {}, elbows: carryable.elbows || null, familyBabyId: child.id }; // Same grips/elbows as the player.
      entry.npcGripRoot = gripRoot;
    } else clearNpcGrip(entry); // Back stow frees the hands, exactly like the player's.
    entry.burden.group.visible = true;
    showWalker(entry, false);
    const next = back ? 'back' : 'arms';
    const changed = child.carryBy !== 'spouse' || child.carryPose !== next;
    child.carryBy = 'spouse'; child.carryPose = next; child.carrySpot = null; child.followPlayer = false;
    window.FamilyBabyFollow?.clearWalker?.(walker);
    if (changed) entry.persist?.();
    return true;
  }
  function returnToBasket(child, basket = null) {
    const entry = entries.get(child?.id);
    if (!entry || child.carryBy === 'player') return false;
    if (child.carryBy !== 'spouse') return true;
    const ctx = window.RomanceFamily?.careContext?.(); // Existing family basket location, never a parallel furniture lookup.
    const target = basket || ctx?.basketObject?.(child) || ctx?.helpers?.bedSpot?.();
    const root = entry.walker?.root;
    if (root && Number.isFinite(target?.col ?? target?.c) && Number.isFinite(target?.row ?? target?.r)) {
      const c = Number(target.col ?? target.c), r = Number(target.row ?? target.r); // Reuse the actual family furniture tile.
      if (entry.walker.area !== 'interior') entry.walker.transferToArea?.('interior', { c, r }); // Same native NPC portal mover as weddings and schedules.
      root.position.x = c + .5; root.position.z = r + .5; // Put the REAL child inside the cup, not at a previous landing.
    }
    settle(entry, entry.burden, true);
    return true;
  }
  function discard(id, preserveFollow = false) {
    const entry = entries.get(id);
    if (!entry) return;
    entry.disposing = true;
    clearNpcGrip(entry);
    showWalker(entry, true);
    window.Shattercasks?.discardBurden?.(entry.burden); // Shared registry cleans the actor's real physical burden.
    disposeProxy(entry); // Remove one shared mesh and its two materials, leaving the portrait texture alive.
    entry.child.carryBy = null; entry.child.carryPose = null;
    if (!preserveFollow) entry.child.followPlayer = false; // Growth can rebuild a walking follower without forgetting its destination.
    window.FamilyBabyFollow?.clearWalker?.(entry.walker);
    entries.delete(id);
  }
  function clear() { for (const id of [...entries.keys()]) discard(id); }
  window.FamilyBabyBurdens = Object.freeze({
    isAllowedArea, sync, takeIntoArms, spouseCarry, returnToBasket, discard, clear,
    syncFollowingWalker: id => { const entry = entries.get(id); if (entry && !entry.child.carryBy && !entry.burden.flying) moveToWalker(entry); },
    carrying: id => ['player', 'spouse'].includes(entries.get(id)?.child?.carryBy), // Dev Companion knows either parent is holding the infant.
    isProxyActive: id => { // The NPC command wheel must never target the original invisible baby while a proxy is carried or flying.
      const entry = entries.get(id);
      return !!entry && (entry.burden.flying || ['player', 'spouse'].includes(entry.child.carryBy));
    },
    snapshot: () => ({ ...debug, babies: [...entries].map(([id, e]) => ({
      id, by: e.child.carryBy || 'basket', pose: e.child.carryPose || null,
      area: e.burden.mapId, parent: e.burden.group.parent?.name || null,
      visible: e.burden.group.visible, artMode: e.burden.group.userData.familyBabyArtMode,
      rearArt: e.burden.group.userData.familyBabyRearArt,
      dimensions: { width: e.burden.group.userData.familyBabyWidth, height: e.burden.group.userData.familyBabyHeight }, // Source-portrait coordinate basis used for hand grips.
      posedDimensions: { width: e.burden.group.userData.familyBabyPosedWidth, height: e.burden.group.userData.familyBabyPosedHeight }, // Expanded head is visual only.
      gripAnchors: e.burden.group.userData.familyBabyGripAnchors, // Mobile diagnostic for left/posterior and right/neck grip origins.
      kickingLimbs: window.FamilyBabyLimbs?.isAttached?.(e.burden.group) ? 'attached'
        : (window.FamilyBabyLimbs?.debugSnapshot?.().lastMissing ? 'waiting for ' + window.FamilyBabyLimbs.debugSnapshot().lastMissing : 'none'), // Mobile: cloned 3D hands/feet state.
      meshes: e.burden.group.children.length,
    })) }),
  });
})();
