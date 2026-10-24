// Per-owner rear-silhouette masking for head-relative held weapons.
// Shares stencil bit 0 with water by reserving only bit 1 for the rear mask.
(() => {
  'use strict';
  const DRAW_LAYER = 24; // One private layer reused sequentially; layer 25 belongs to Perception Mode.
  const REAR_BIT = 2; // Kept separate from the compositor's water-tint bit (1).
  const FIELDS = ['visible', 'colorWrite', 'depthTest', 'depthWrite', 'stencilWrite', 'stencilWriteMask', 'stencilFunc', 'stencilRef', 'stencilFuncMask', 'stencilFail', 'stencilZFail', 'stencilZPass']; // Exact temporary material state restored even on render failure.
  let maskDraws = 0, weaponDraws = 0; // Mobile diagnostics count only actual masked overlay passes.

  function rearMesh(source) {
    if (source?.isMesh) return source;
    return source?.children?.find(child => child.isMesh) || null;
  }

  function collect(meshes) {
    const groups = new Map(); // Existing held registry supplies the tiny candidate list; no scene traversal.
    for (const mesh of meshes) {
      let owner = mesh; // Find the pose owner's current frame tag on the holder.
      while (owner && !owner.userData?.headRelativeBackPlane) owner = owner.parent;
      const rear = rearMesh(owner?.userData?.headRelativeBackPlane); // Rigid bandits expose a one-level back pivot; players expose the skinned mesh itself.
      if (!rear || rear.visible === false) continue;
      let group = groups.get(rear); // Multiple weapon meshes from the same holder share one mask draw.
      if (!group) groups.set(rear, group = { rear, weapons: [] });
      group.weapons.push(mesh);
    }
    return [...groups.values()];
  }

  function save(states, material) {
    if (!material || states.has(material)) return;
    const state = {}; // Saved once per material per pass, including shared material arrays.
    for (const key of FIELDS) state[key] = material[key];
    states.set(material, state);
  }

  function restore(states) {
    for (const [material, state] of states) Object.assign(material, state);
  }

  function materials(mesh) { return Array.isArray(mesh.material) ? mesh.material : [mesh.material]; }

  function draw(renderer, scene, camera, rawRender, groups, THREE, tint = false) {
    if (!groups.length) return;
    const oldMask = camera.layers.mask; // Restored alongside all renderer flags changed for the nested raw draws.
    const oldAutoClear = renderer.autoClear, oldBackground = scene.background, oldAutoUpdate = scene.autoUpdate;
    renderer.autoClear = false;
    scene.background = null;
    scene.autoUpdate = false;
    try {
      for (const { rear, weapons } of groups) {
        const states = new Map(), layers = new Map(); // Scoped to one owner so one actor's back never masks another actor's weapon.
        try {
          renderer.state.buffers.stencil.setMask(REAR_BIT);
          renderer.clearStencil(); // Clears only bit 1; previously drawn water-tint coverage survives.
          layers.set(rear, rear.layers.mask);
          rear.layers.set(DRAW_LAYER);
          const rearMaterials = materials(rear); // Skinned portraits use front/back material groups on one mesh.
          for (let i = 0; i < rearMaterials.length; i++) {
            const material = rearMaterials[i]; // Only the rear-facing material is eligible to stamp the silhouette.
            if (!material) continue;
            save(states, material);
            if (rearMaterials.length > 1 && i !== 1) { material.visible = false; continue; }
            material.colorWrite = false;
            material.depthWrite = false;
            material.depthTest = false; // Ignore weapon/scene depth while recording the exact alpha-cutout rear silhouette.
            material.stencilWrite = true;
            material.stencilWriteMask = REAR_BIT;
            material.stencilFunc = THREE.AlwaysStencilFunc;
            material.stencilRef = REAR_BIT;
            material.stencilFuncMask = REAR_BIT;
            material.stencilFail = material.stencilZFail = material.stencilZPass = THREE.ReplaceStencilOp;
          }
          camera.layers.set(DRAW_LAYER);
          rawRender.call(renderer, scene, camera);
          maskDraws++;
          restore(states); states.clear();
          rear.layers.mask = layers.get(rear) & ~(1 << DRAW_LAYER); // Exclude the mask source from the following weapon-color draw, even for enableAll() sources.
          for (const weapon of weapons) {
            const prepareVisibleWeaponPart = object => {
              if (!object.isMesh && !object.isSprite) return;
              layers.set(object, object.layers.mask);
              object.layers.set(DRAW_LAYER); // Dual-wield children and enchantment sprites follow their masked parent into this pass.
              for (const material of materials(object)) {
                if (!material) continue;
                save(states, material);
                material.depthTest = true; // World geometry still occludes normally.
                material.stencilWrite = true;
                // Transparent sprite corners must never write water stencil
                // or depth; only *read* the owner's rear-silhouette mask.
                material.stencilWriteMask = object.isSprite ? 0 : (tint ? 1 : 0);
                material.stencilFunc = THREE.EqualStencilFunc;
                material.stencilRef = 1; // Compare only rear bit 1, optionally writing water bit 0 for blade meshes.
                material.stencilFuncMask = REAR_BIT;
                material.stencilFail = material.stencilZFail = THREE.KeepStencilOp;
                material.stencilZPass = THREE.ReplaceStencilOp;
                if (tint && !object.isSprite) material.depthWrite = true;
              }
            };
            if (weapon.traverseVisible) weapon.traverseVisible(prepareVisibleWeaponPart);
            else prepareVisibleWeaponPart(weapon); // Lightweight editor/test stand-ins may omit Three's traversal helper.
          }
          camera.layers.set(DRAW_LAYER);
          rawRender.call(renderer, scene, camera);
          weaponDraws++;
        } finally {
          restore(states);
          for (const [mesh, mask] of layers) mesh.layers.mask = mask;
        }
      }
    } finally {
      camera.layers.mask = oldMask;
      renderer.state.buffers.stencil.setMask(0xff); // Leave stencil clears usable for the following water pass and next frame.
      renderer.state.buffers.stencil.setTest(false);
      renderer.autoClear = oldAutoClear;
      scene.background = oldBackground;
      scene.autoUpdate = oldAutoUpdate;
    }
  }

  window.HeadRelativeWeaponOcclusion = Object.freeze({ collect, draw, rearMesh,
    snapshot: () => ({ maskDraws, weaponDraws, mode: 'owner-rear-silhouette', stencilBit: REAR_BIT }),
  });
})();
