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
  const debug = { attached: 0, lastMissing: null, frames: 0 };

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

  function cloneLimb(source, kind, side, root, pivotAt, offset) {
    // Keep the walker's species-specific scale/orientation (incl. mirrored side),
    // but none of its world placement: the walker may be asleep in another scene.
    source.updateWorldMatrix(true, false);
    const scale = source.getWorldScale(new THREE.Vector3());
    const parentScale = root.getWorldScale(new THREE.Vector3());
    const sign = Math.sign(source.matrixWorld.determinant()) || 1;
    const mesh = new THREE.Mesh(source.geometry, (Array.isArray(source.material) ? source.material : [source.material])
      .map(material => material.clone())); // Own materials: Shattercasks/x-ray may tune them; geometry stays shared.
    if (mesh.material.length === 1) mesh.material = mesh.material[0];
    mesh.name = `family_baby_${side}_${kind}`;
    const s = Math.abs(scale.x) / (parentScale.x || 1);
    mesh.scale.set(s * (sign < 0 ? -1 : 1), Math.abs(scale.y) / (parentScale.y || 1), Math.abs(scale.z) / (parentScale.z || 1));
    if (kind === 'foot') mesh.rotation.set(0, -90 * DEG, 0); // Same toe-forward rest yaw the leg rig gives the foot GLB.
    else mesh.rotation.set(0, 0, side === 'left' ? -20 * DEG : 20 * DEG); // Little fists angled up and outward.
    mesh.position.set(offset.x, offset.y, offset.z);
    mesh.layers.mask = 0; mesh.layers.enable(0); mesh.layers.enable(1); // World + generated shell outline only: never the player's hand/foot replay layers.
    mesh.userData.noOutline = false;
    mesh.userData.shattercaskKeepsOwnDepth = true;
    mesh.userData.familyBabyLimb = kind;
    const pivot = new THREE.Group();
    pivot.name = `family_baby_${side}_${kind}_pivot`;
    pivot.position.set(pivotAt.x, pivotAt.y, pivotAt.z);
    pivot.userData.familyBabyLimb = { kind, side, phase: (kind === 'foot' ? 1.7 : 0) + (side === 'left' ? 0 : Math.PI * .83) };
    pivot.add(mesh);
    root.add(pivot);
    return pivot;
  }

  function attach(group, walker) {
    if (!group || !window.THREE?.Group) return false;
    if (group.getObjectByName?.(LIMB_ROOT)) return true;
    const limbs = sourceLimbs(walker);
    const missing = SIDES.flatMap(side => ['hand', 'foot'].filter(kind => !limbs[kind][side]).map(kind => side + ' ' + kind));
    if (missing.length) { debug.lastMissing = missing.join(', '); return false; } // GLBs load asynchronously; family sync retries.
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
    debug.attached++;
    debug.lastMissing = null;
    return true;
  }

  function detach(group) {
    const root = group?.getObjectByName?.(LIMB_ROOT);
    groups.delete(group);
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
    attach, detach, sourceLimbs, anatomy,
    isAttached: group => !!group?.getObjectByName?.(LIMB_ROOT),
    debugSnapshot: () => ({ ...debug, groups: groups.size }),
    _poseForTest: poseLimbs, _restForTest: restLimbs,
  });
})();
