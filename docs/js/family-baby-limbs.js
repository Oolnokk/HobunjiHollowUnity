// Kicking arms and feet for a carried family baby (window.FamilyBabyLimbs).
//
// The carried infant proxy (js/family-baby-burdens.js) is a baked head-and-shoulders
// PNG bust. While a parent holds, back-stows or tosses it, the baby's own NPC walker
// is hidden, and with it the walker's species-correct procedural 3D hands and feet.
// This module clones exactly those limb meshes (shared geometry, cloned materials:
// same GLB, colour and baby size) onto the proxy and waves/kicks them.
//
// Visual-authoring classification (docs/architecture/visual-authoring.md §1/§3):
// hands and feet are curved 3D geometry, so they keep the generated shell outline
// (layer 1). Nothing here touches the PNG bust's authored ink.
//
// Rendering: the limbs are ordinary opaque meshes with real depth, so they occlude
// and are occluded correctly from either side of the carrier. They are marked
// `shattercaskKeepsOwnDepth` so the back-stow PNG sandwich (Shattercasks) never
// turns them into depth-less transparents, and they are attached AFTER Burden
// registration so they never become hit colliders.
//
// Motion is presentation-only: one RenderHooks 'frame' hook rotates the limb
// pivots for the frame and restores their rest pose afterwards (no allocation).
(() => {
  'use strict';
  if (window.FamilyBabyLimbs) return;

  const LIMB_ROOT = 'family_baby_kicking_limbs';
  const REFERENCE_HEIGHT = .2304; // Newborn Mao'ao bust the offsets were tuned on (screenshot-verified).
  const SIDES = ['left', 'right'];
  const DEG = Math.PI / 180;
  const groups = new Set(); // Proxy groups that currently own limbs; the hook only visits these.
  const sourcesByGroup = new WeakMap(); // Original limb meshes used by each proxy; detect late GLB replacements.
  const balancedParts = new WeakMap(); // Applied newborn visual multipliers; no compounding after reload/update.
  const walkerRevisions = new WeakMap(); // Newborn visual changes invalidate cached proxy clones even if mesh identity stays the same.
  const debug = { attached: 0, refreshed: 0, balanced: 0, lastMissing: null, frames: 0 };

  // Find the walker's visible hand/foot GLB meshes by their rig node names.
  function sourceLimbs(walker) {
    const found = { hand: {}, foot: {} };
    walker?.root?.traverse?.(node => {
      if (!node?.isMesh || node.visible === false || !node.geometry?.attributes?.position?.count) return;
      let side = null, kind = null;
      for (let cursor = node.parent; cursor && cursor !== walker.root && !(side && kind); cursor = cursor.parent) {
        const name = String(cursor.name || '');
        if (!kind && /_hand_visual$/.test(name)) { kind = 'hand'; side = name.startsWith('left') ? 'left' : name.startsWith('right') ? 'right' : null; }
        if (!kind && /^(left|right)_foot$/.test(name)) { kind = 'foot'; side = name.slice(0, name.indexOf('_')); }
      }
      if (kind && side && !found[kind][side]) found[kind][side] = node;
    });
    return found;
  }

  // Baby-local anatomy (proxy-group frame): shoulders and hips from the same
  // posterior/neck pivots used by the hand grips, so every species lines up.
  function anatomy(group) {
    const data = group.userData || {};
    const h = Math.max(.05, Number(data.familyBabyHeight) || REFERENCE_HEIGHT);
    const w = Math.max(.05, Number(data.familyBabyWidth) || h);
    const k = h / REFERENCE_HEIGHT;
    const anchors = data.familyBabyGripAnchors || {};
    const post = anchors.posterior || { x: 0, y: h * .486, z: 0 };
    const neck = anchors.neck || { x: 0, y: h * .885, z: 0 };
    const torso = Math.max(.02, neck.y - post.y); // Posterior -> head pivot span of this particular baby.
    const cx = (post.x + neck.x) / 2, cz = post.z;
    return {
      k,
      shoulder: side => ({ x: cx + (side === 'left' ? 1 : -1) * w * .16, y: post.y + torso * .42, z: cz + .012 * k }),
      hip: side => ({ x: post.x + (side === 'left' ? 1 : -1) * w * .1, y: post.y + torso * .04, z: cz + .006 * k }),
      handReach: { out: torso * .2, up: torso * .12, z: .018 * k }, // Fists stay against the shirt: the bust has no drawn arms.
      footReach: { down: torso * .2, z: .012 * k }, // Feet tuck up under the bust's lower edge: no drawn legs to bridge a gap.
    };
  }

  // Resizes the newborn NPC's own extremities at the visual only, not the
  // shoulders, hips, leg lengths, authored species profiles or carried grips.
  // Proxy limbs clone these same visuals, so in-world and carried sizes agree.
  function balanceWalker(walker, proportions = {}) {
    const root = walker?.root;
    if (!root?.getObjectByName) return 0;
    let changed = 0; // Counts resized limbs for mobile debugging.
    for (const kind of ['hand', 'foot']) {
      const configured = Number(proportions[kind]);
      const factor = Number.isFinite(configured) && configured > 0
        ? Math.min(2, Math.max(.5, configured)) : 1; // Invalid configuration cannot cause extreme limb scaling.
      for (const side of SIDES) {
        const visual = root.getObjectByName(`${side}_${kind === 'hand' ? 'hand_visual' : 'foot'}`);
        if (!visual?.scale?.set) continue; // A GLB may still be loading.
        const previous = balancedParts.get(visual) || 1;
        if (Math.abs(previous - factor) < 1e-6) continue;
        const ratio = factor / previous; // Preserve any authored/species-specific original scale.
        visual.scale.set(visual.scale.x * ratio, visual.scale.y * ratio, visual.scale.z * ratio);
        visual.updateMatrix?.();
        balancedParts.set(visual, factor);
        changed++;
      }
    }
    if (changed) walkerRevisions.set(root, (walkerRevisions.get(root) || 0) + 1); // The same source mesh now has different world scale.
    debug.balanced += changed;
    return changed;
  }

  function visualRootFor(source, kind, side) {
    // The full hand GLB may have separate palm/claw primitives; feet likewise
    // contain independent pad/nail meshes. Copy their shared authored hierarchy.
    const expected = `${side}_${kind === 'hand' ? 'hand_visual' : 'foot'}`;
    for (let node = source; node; node = node.parent) if (node.name === expected) return node;
    return source; // Defensive fallback for older single-mesh rigs.
  }

  function captureSources(walker, limbs) {
    // Snapshot every primitive, not just the first Mesh: GLB loading can replace
    // a claw/pad geometry while the original visible Mesh identity stays stable.
    const state = { revision: walkerRevisions.get(walker.root) || 0, hand: {}, foot: {} };
    for (const kind of ['hand', 'foot']) for (const side of SIDES) {
      const visual = visualRootFor(limbs[kind][side], kind, side);
      const parts = []; // Frozen source mesh/geometry/material identities used only for refresh decisions.
      visual.traverse?.(node => {
        if (!node.isMesh || node.visible === false) return; // Hidden foot fallback is not part of the rendered clone.
        for (let ancestor = node.parent; ancestor && ancestor !== visual; ancestor = ancestor.parent)
          if (ancestor.visible === false) return; // A hidden GLB group is not a visible limb part.
        parts.push({ mesh: node, geometry: node.geometry, material: node.material });
      });
      state[kind][side] = { visual, parts };
    }
    return state;
  }

  function sameSources(previous, current) {
    return !!previous && previous.revision === current.revision && SIDES.every(side =>
      ['hand', 'foot'].every(kind => {
        const before = previous[kind][side], now = current[kind][side];
        return before.visual === now.visual && before.parts.length === now.parts.length
          && before.parts.every((part, index) => {
            const next = now.parts[index];
            return part.mesh === next.mesh && part.geometry === next.geometry && part.material === next.material;
          });
      }));
  }

  function cloneRenderableLimb(node, isRoot = false) {
    // A lean copy of the GLB hierarchy: Object3D.clone(true) also serializes
    // arbitrary userData (some parrot hands store large outline index buffers).
    // The baby needs only the visible 3D transforms, geometry and render materials.
    if (!node || (node.visible === false && !isRoot)) return null;
    let copy;
    if (node.isMesh) {
      if (!node.geometry?.attributes?.position?.count) return null;
      const materials = Array.isArray(node.material)
        ? node.material.map(material => material?.clone?.() || material)
        : node.material?.clone?.() || node.material; // Independent from the live walker's x-ray/material state.
      copy = new THREE.Mesh(node.geometry, materials); // Shared GLB geometry: never dispose it when removing baby limbs.
      copy.layers.mask = 0;
      copy.layers.enable(0); copy.layers.enable(1); // Only world and generated-shell passes.
      copy.userData.noOutline = false;
      copy.userData.shattercaskKeepsOwnDepth = true;
      copy.userData.familyBabyLimbPart = true; // Allows mobile rig probes to distinguish cloned GLB surfaces.
    } else {
      copy = new THREE.Group(); // Preserve glTF primitive-local rotations and offsets through lightweight parents.
    }
    copy.name = node.name;
    copy.position.set(node.position?.x || 0, node.position?.y || 0, node.position?.z || 0);
    if (copy.quaternion?.copy && node.quaternion) copy.quaternion.copy(node.quaternion);
    else copy.rotation.set(node.rotation?.x || 0, node.rotation?.y || 0, node.rotation?.z || 0);
    copy.scale.set(node.scale?.x ?? 1, node.scale?.y ?? 1, node.scale?.z ?? 1);
    for (const child of node.children || []) {
      const childCopy = cloneRenderableLimb(child);
      if (childCopy) copy.add(childCopy);
    }
    if (!node.isMesh && !copy.children.length) return null; // Omit GLB helpers and non-rendering subgroups.
    return copy;
  }

  function cloneLimb(source, kind, side, root, pivotAt, offset) {
    // Reconstruct every visible body/claw/nail primitive, keeping the exact
    // imported local hierarchy but no walker placement, collider or animation.
    const visual = visualRootFor(source, kind, side);
    visual.updateWorldMatrix(true, false);
    const scale = visual.getWorldScale(new THREE.Vector3());
    const parentScale = root.getWorldScale(new THREE.Vector3());
    const sign = Math.sign(visual.matrixWorld.determinant()) || 1;
    const model = cloneRenderableLimb(visual, true);
    if (!model) return null; // Missing 3D assets are retried by the existing family sync.
    model.name = `family_baby_${side}_${kind}`;
    model.visible = true; // NPC culling and hidden walker state never hide the separate physical infant.
    const x = Math.abs(scale.x) / (Math.abs(parentScale.x) || 1);
    model.scale.set(x * (sign < 0 ? -1 : 1),
      Math.abs(scale.y) / (Math.abs(parentScale.y) || 1),
      Math.abs(scale.z) / (Math.abs(parentScale.z) || 1));
    if (kind === 'foot') model.rotation.set(0, -90 * DEG, 0); // Neutral toe-forward yaw rather than the walker's animated gait.
    else model.rotation.set(0, 0, side === 'left' ? -20 * DEG : 20 * DEG); // Fists angled up and outward.
    model.position.set(offset.x, offset.y, offset.z);
    model.userData.shattercaskKeepsOwnDepth = true;
    model.userData.familyBabyLimb = kind;
    const pivot = new THREE.Group();
    pivot.name = `family_baby_${side}_${kind}_pivot`;
    pivot.position.set(pivotAt.x, pivotAt.y, pivotAt.z);
    pivot.userData.familyBabyLimb = { kind, side, phase: (kind === 'foot' ? 1.7 : 0) + (side === 'left' ? 0 : Math.PI * .83) };
    pivot.add(model);
    root.add(pivot);
    return pivot;
  }

  function attach(group, walker) {
    if (!group || !window.THREE?.Group) return false;
    const existing = group.getObjectByName?.(LIMB_ROOT); // Keep a healthy carried proxy when the source is unchanged.
    if (existing && !walker?.root) return true;
    const limbs = sourceLimbs(walker);
    const missing = SIDES.flatMap(side => ['hand', 'foot'].filter(kind => !limbs[kind][side]).map(kind => side + ' ' + kind));
    if (missing.length) { debug.lastMissing = missing.join(', '); return !!existing; } // Don't drop already-visible limbs during a GLB load.
    const current = captureSources(walker, limbs); // The baby may already be held when an async GLB or size change occurs.
    if (existing && sameSources(sourcesByGroup.get(group), current)) return true;
    if (existing) { detach(group); debug.refreshed++; } // Replace cloned materials, never the source geometry.
    const a = anatomy(group);
    const root = new THREE.Group();
    root.name = LIMB_ROOT;
    root.userData.shattercaskKeepsOwnDepth = true;
    group.add(root);
    group.updateWorldMatrix(true, false);
    for (const side of SIDES) {
      const dir = side === 'left' ? 1 : -1;
      cloneLimb(limbs.hand[side], 'hand', side, root, a.shoulder(side),
        { x: dir * a.handReach.out, y: a.handReach.up, z: a.handReach.z });
      cloneLimb(limbs.foot[side], 'foot', side, root, a.hip(side),
        { x: 0, y: -a.footReach.down, z: a.footReach.z });
    }
    groups.add(group);
    sourcesByGroup.set(group, current); // Snapshot includes the resizing revision and live GLB resource identities.
    debug.attached++;
    debug.lastMissing = null;
    return true;
  }

  function detach(group) {
    const root = group?.getObjectByName?.(LIMB_ROOT);
    groups.delete(group);
    sourcesByGroup.delete(group); // Do not retain the disposed proxy's source meshes.
    if (!root) return;
    root.traverse(node => { // Dispose only the cloned materials; the walker still owns the GLB geometry.
      if (node.isMesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) material?.dispose?.();
    });
    root.parent?.remove(root);
  }

  // Bursty, desynchronised infant motion: arms wave about the shoulder, legs
  // bicycle-kick about the hip. A thrown baby flails faster and wider.
  function poseLimbs(group, seconds) {
    const root = group.getObjectByName(LIMB_ROOT);
    if (!root) return;
    const flying = group.userData.familyBabyFlying === true;
    const speed = flying ? 2.2 : 1;
    const burst = flying ? 1 : .55 + .45 * Math.max(0, Math.sin(seconds * .9 + group.id)); // Kicks come in fits, never a metronome.
    for (const pivot of root.children) {
      const info = pivot.userData.familyBabyLimb;
      if (!info) continue;
      const t = seconds * speed + info.phase;
      if (info.kind === 'hand') {
        const dir = info.side === 'left' ? 1 : -1;
        pivot.rotation.set(Math.sin(t * 5.3) * 22 * DEG * burst,
          0,
          dir * (12 * DEG + Math.sin(t * 6.1) * 34 * DEG * burst));
      } else {
        pivot.rotation.set(-25 * DEG + Math.sin(t * 7.4) * 38 * DEG * burst,
          0,
          Math.sin(t * 3.7) * 10 * DEG * burst);
      }
    }
  }

  function restLimbs(group) {
    const root = group.getObjectByName(LIMB_ROOT);
    if (root) for (const pivot of root.children) pivot.rotation.set(0, 0, 0);
  }

  const active = []; // Reused list of groups posed this frame (restored in after()).
  function before() {
    active.length = 0;
    if (!groups.size) return active;
    const seconds = performance.now() / 1000;
    for (const group of groups) {
      if (!group.visible || !group.parent) continue;
      poseLimbs(group, seconds);
      active.push(group);
    }
    if (active.length) debug.frames++;
    return active;
  }
  function after(_ctx, posed) { for (const group of posed || []) restLimbs(group); }

  if (window.RenderHooks?.register) window.RenderHooks.register({
    id: 'family-baby-limbs',
    owner: 'family-baby-limbs.js',
    order: window.RenderHooks.ORDER?.FAMILY_BABY_LIMBS ?? 950,
    scope: 'frame',
    before,
    after,
  });

  window.FamilyBabyLimbs = Object.freeze({
    attach, detach, sourceLimbs, anatomy, balanceWalker,
    isAttached: group => !!group?.getObjectByName?.(LIMB_ROOT),
    debugSnapshot: () => ({ ...debug, groups: groups.size }),
    _poseForTest: poseLimbs, _restForTest: restLimbs,
  });
})();
