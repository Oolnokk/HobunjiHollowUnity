// One physical infant proxy shared with the existing Shattercasks hands/back-stow system.
// The family NPC remains the authoritative character; this module only owns the carry presentation.
(() => {
  'use strict';
  if (window.FamilyBabyBurdens) return;
  const entries = new Map(); // child ID -> shared burden + live NPC and persistence callback.
  const areas = new Set(['interior', 'farm', 'town']); // Baby carry is confined to the settlement.
  const debug = { latestChange: 'Babies use one safe Burden for player and spouse carry', lastError: null }; // Mobile-facing failures.

  function isAllowedArea(value) {
    const area = String(value || ''); // Farmhouse and barn interior maps share the home policy.
    return areas.has(area) || /^map_i_(?:farmhouse|barn)(?:_|$)/.test(area);
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
  function createProxy(child, walker) {
    const THREE = window.THREE, model = walker?.avatarGroup; // Reuse the actual rendered child sprite and baby scale.
    const front = model?.userData?.frontTexture;
    if (!THREE?.Group || !THREE?.Mesh || !THREE?.PlaneGeometry || !front) return null;
    const width = Math.max(.05, Number(model.userData.portraitModelWidth) || .3);
    const height = Math.max(.05, Number(model.userData.portraitModelHeight) || width);
    const group = new THREE.Group();
    group.name = 'family_baby_' + child.id;
    group.userData.familyBabyId = child.id;
    const geometry = new THREE.PlaneGeometry(width, height); // Shared front/back geometry, reused during arms, back and flight.
    for (const [texture, rear] of [[front, false], [model.userData.backTexture || front, true]]) {
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .05,
        side: THREE.FrontSide, depthWrite: true }); // Texture is owned by the live avatar; dispose material only.
      const plane = new THREE.Mesh(geometry, material);
      plane.position.y = height / 2;
      plane.position.z = rear ? -.002 : .002;
      plane.rotation.y = rear ? Math.PI : 0;
      plane.userData.noOutline = true;
      group.add(plane);
    }
    group.visible = false; // Real baby NPC alone is visible while in the basket.
    return group;
  }
  function moveToWalker(entry) {
    const root = entry.walker?.root, burden = entry.burden;
    if (!root?.parent || burden.carried || burden.flying) return;
    root.parent.add(burden.group);
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
    child.carryBy = null; child.carryPose = null;
    child.carrySpot = basket || !isAllowedArea(item.mapId)
      ? null : { area: item.mapId, c: item.col, r: item.row }; // Dropped baby stays where it landed, across save/reload.
    item.carried = false; item.flying = false;
    item.group.visible = false;
    showWalker(entry, true);
    const root = entry.walker?.root;
    if (!basket && root && entry.walker.area === item.mapId) {
      root.position.x = item.col + .5; root.position.z = item.row + .5;
    }
    moveToWalker(entry);
    entry.persist?.();
    debug.lastError = null;
  }
  function ensure(child, walker, persist) {
    if (!child?.id) return null;
    let entry = entries.get(child.id);
    if (entry) {
      entry.child = child;
      entry.walker = walker || entry.walker;
      entry.persist = persist;
      return entry;
    }
    const api = window.Shattercasks, area = currentArea(); // Shared Burden owns real hands, stowing, throws and safe landing.
    if (!api?.registerBurden || !walker?.root?.parent || walker.area !== area || !isAllowedArea(area)) return null;
    const group = createProxy(child, walker);
    if (!group) { debug.lastError = 'infant portrait not ready'; return null; }
    walker.root.parent.add(group);
    group.position.copy(walker.root.position);
    entry = { child, walker, persist, burden: null, hiddenRoot: null, previousVisibility: true, disposing: false };
    const burden = api.registerBurden({
      id: 'family_baby_' + child.id, mapId: area, scene: walker.root.parent,
      group, kind: 'familyBaby', displayName: child.name || 'Baby',
      hanging: false, invulnerable: true, noHang: true,
      onPickup: () => {
        child.carryBy = 'player'; child.carryPose = 'arms'; child.carrySpot = null;
        group.visible = true; showWalker(entry, false);
        entry.persist?.();
      },
      onDrop: item => settle(entry, item),
      onThrow: () => { group.visible = true; showWalker(entry, false); },
      onImpact: item => {
        item.col = Math.floor(item.group.position.x); item.row = Math.floor(item.group.position.z);
        settle(entry, item);
        return true; // A living child lands unharmed; no pottery effect is invoked.
      },
      onLost: item => {
        if (entry.disposing) return;
        settle(entry, item, true); // Out-of-settlement transitions always return the infant to the basket.
        entries.delete(child.id);
      },
    });
    if (!burden) { group.parent?.remove(group); debug.lastError = 'burden registration failed'; return null; }
    entry.burden = burden;
    entries.set(child.id, entry);
    return entry;
  }
  function sync(child, walker, phase, persist) {
    if (phase !== 'basket') { discard(child?.id); return null; } // Toddler transitions clean up the baby-only proxy.
    const entry = ensure(child, walker, persist);
    if (!entry) return null;
    const api = window.Shattercasks;
    const held = api?.heldBurdenInfo?.()?.id === entry.burden.id;
    const back = api?.backCarriedInfo?.()?.id === entry.burden.id;
    if (held || back) {
      child.carryBy = 'player';
      child.carryPose = back ? 'back' : 'arms';
      entry.burden.group.visible = true;
      showWalker(entry, false);
    } else if (child.carryBy === 'player') {
      child.carryBy = null; child.carryPose = null; child.carrySpot = null;
      entry.persist?.(); // Restore cannot invent an unsaved held-burden slot.
      showWalker(entry, true);
      moveToWalker(entry);
    } else if (child.carryBy === 'spouse' && entry.burden.carried) showWalker(entry, false);
    else { showWalker(entry, true); moveToWalker(entry); }
    return entry;
  }
  function takeIntoArms(child, walker, persist) {
    const entry = ensure(child, walker, persist), api = window.Shattercasks;
    if (!entry || !api?.pickUp || entry.burden.flying) return false;
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
  function spouseCarry(child, walker, spouse, pose, persist) {
    const entry = ensure(child, walker, persist);
    if (!entry || !spouse?.root?.parent || entry.burden.flying || child.carryBy === 'player') return false;
    const api = window.Shattercasks;
    if (api?.heldBurdenInfo?.()?.id === entry.burden.id
        || api?.backCarriedInfo?.()?.id === entry.burden.id) return false;
    const portrait = spouse.avatarGroup || spouse.root; // The NPC's real moving body frame, not a detached sprite clone.
    const height = Math.max(.3, Number(spouse.avatarGroup?.userData?.portraitModelHeight) || .9);
    const back = pose === 'back', centered = portrait === spouse.avatarGroup;
    entry.burden.carried = true;
    if (entry.burden.mapId !== spouse.area && spouse.area === currentArea())
      api?.transferCarriedBurdenToArea?.(spouse.area, entry.burden);
    portrait.add(entry.burden.group);
    entry.burden.group.position.set(back ? 0 : height * .13,
      centered ? height * (back ? .04 : -.10) : height * (back ? .60 : .48),
      height * (back ? -.22 : .23));
    entry.burden.group.rotation.set(0, back ? Math.PI : 0, back ? 0 : -.16);
    entry.burden.group.scale.set(1, 1, 1);
    entry.burden.group.visible = true;
    showWalker(entry, false);
    const next = back ? 'back' : 'arms';
    const changed = child.carryBy !== 'spouse' || child.carryPose !== next;
    child.carryBy = 'spouse'; child.carryPose = next; child.carrySpot = null;
    if (changed) entry.persist?.();
    return true;
  }
  function returnToBasket(child) {
    const entry = entries.get(child?.id);
    if (!entry || child.carryBy === 'player') return false;
    if (child.carryBy !== 'spouse') return true;
    settle(entry, entry.burden, true);
    return true;
  }
  function discard(id) {
    const entry = entries.get(id);
    if (!entry) return;
    entry.disposing = true;
    showWalker(entry, true);
    window.Shattercasks?.discardBurden?.(entry.burden); // Shared registry cleans the actor's real physical burden.
    const geometry = entry.burden.group.children[0]?.geometry;
    entry.burden.group.traverse?.(node => node.material?.dispose?.());
    geometry?.dispose?.(); // Only materials/geometry owned by this small proxy; portrait textures remain live.
    entries.delete(id);
  }
  function clear() { for (const id of [...entries.keys()]) discard(id); }
  window.FamilyBabyBurdens = Object.freeze({
    isAllowedArea, sync, takeIntoArms, spouseCarry, returnToBasket, discard, clear,
    snapshot: () => ({ ...debug, babies: [...entries].map(([id, e]) => ({
      id, by: e.child.carryBy || 'basket', pose: e.child.carryPose || null,
      area: e.burden.mapId, parent: e.burden.group.parent?.name || null,
    })) }),
  });
})();
