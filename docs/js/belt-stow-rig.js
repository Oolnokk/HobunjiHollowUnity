// Shared attachment-rig coordinates and lightweight artwork for belt-stowed equipment.
// Animation Author and gameplay both consume this module; no independent frame driver.
(function (global) {
  'use strict';
  if (global.HobunjiBeltStowRig) return;

  const TORCH_WIDTH = 0.17; // Used by the identical gameplay and Rig Coordinates torch planes.
  const TORCH_HEIGHT = 0.38; // Authored torch's displayed height before any item-specific scale.
  const TORCH_SPRITE = 'assets/toolsprites/torch.png'; // First supported item in this extensible belt slot.
  const RAD = Math.PI / 180; // Converts exported rig rotation degrees to Three.js radians.
  const AXES = ['x', 'y', 'z']; // The JSON coordinate format shared with other attachment anchors.

  function defaultSnapshot(modelHeight = .9) {
    const height = Number.isFinite(Number(modelHeight)) && Number(modelHeight) > 0
      ? Number(modelHeight) : .9; // Fallback only; saved profiles use literal local-world coordinates.
    return {
      position: { x: .22 * height, y: .5 * height, z: .1 * height },
      rotationDeg: { x: 0, y: 0, z: -6.875 },
      scale: { x: 1, y: 1, z: 1 },
    };
  }

  function normalizedSnapshot(input, modelHeight = .9) {
    const initial = defaultSnapshot(modelHeight); // Missing/legacy profile fields get the same neutral belt pose.
    if (!input || typeof input !== 'object' || Array.isArray(input)) return initial;
    const snapshot = { position:{}, rotationDeg:{}, scale:{} };
    for (const group of ['position', 'rotationDeg', 'scale']) {
      for (const axis of AXES) {
        const raw = input[group]?.[axis];
        const value = raw == null || raw === '' ? NaN : Number(raw);
        const permitted = Number.isFinite(value) && (group !== 'scale' || (value >= .1 && value <= 4));
        snapshot[group][axis] = permitted ? value : initial[group][axis]; // Invalid imports cannot explode world geometry.
      }
    }
    return snapshot;
  }

  function characterProfile(library, species, gender) {
    const characters = library?.characters || {};
    const speciesId = String(species || '').trim().toLowerCase().replace(/_/g, '-');
    const sex = String(gender || '').trim().toLowerCase();
    const canonical = global.hobunjiTransformSpeciesId?.(speciesId) || speciesId;
    return characters[`${speciesId}::${sex}`] || characters[`${canonical}::${sex}`] || null;
  }

  function configuredSnapshot(library, species, gender) {
    const snapshot = characterProfile(library, species, gender)?.anchors?.beltStow;
    return snapshot && typeof snapshot === 'object' ? normalizedSnapshot(snapshot) : null;
  }

  function placeRoot(root, snapshot) {
    if (!root || !snapshot) return false;
    const pose = normalizedSnapshot(snapshot);
    root.position?.set?.(pose.position.x, pose.position.y, pose.position.z);
    root.rotation?.set?.(pose.rotationDeg.x * RAD, pose.rotationDeg.y * RAD, pose.rotationDeg.z * RAD);
    root.scale?.set?.(pose.scale.x, pose.scale.y, pose.scale.z);
    return true;
  }

  function createFlameTexture(THREE) {
    if (!THREE?.CanvasTexture || typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas'); // One 32×64 texture, never a per-frame allocation.
    canvas.width = 32; canvas.height = 64;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return null;
    const gradient = ctx.createLinearGradient(0, 6, 0, 59);
    gradient.addColorStop(0, 'rgba(255,238,160,0)');
    gradient.addColorStop(.24, 'rgba(255,239,175,0.9)');
    gradient.addColorStop(.65, 'rgba(255,157,42,0.95)');
    gradient.addColorStop(1, 'rgba(255,71,12,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(16, 2);
    ctx.bezierCurveTo(23, 22, 28, 32, 26, 47);
    ctx.bezierCurveTo(25, 60, 7, 62, 6, 47);
    ctx.bezierCurveTo(5, 32, 13, 22, 16, 2);
    ctx.fill();
    const map = new THREE.CanvasTexture(canvas);
    map.magFilter = map.minFilter = THREE.LinearFilter;
    return map;
  }

  function createTorchDisplay(THREE) {
    if (!THREE?.Group || !THREE?.Mesh) return null;
    const root = new THREE.Group(); // A render-only attachment that may be parented to a game body or authoring gizmo.
    root.name = 'adventuring_torch_belt';
    root.userData.adventuringTorchBelt = true;
    root.userData.nonInteractive = true;
    const art = new THREE.Mesh(new THREE.PlaneGeometry(TORCH_WIDTH, TORCH_HEIGHT),
      new THREE.MeshBasicMaterial({ transparent:true, depthTest:true, depthWrite:false, side:THREE.DoubleSide }));
    art.name = 'stowed_torch_png';
    art.rotation.z = Math.PI; // The existing torch.png's burning end points along image -Y.
    art.renderOrder = 2.32;
    art.raycast = () => {}; // Never intercept item selection, editor actor picking, or world interactions.
    root.add(art);

    let flame = null; // A single tiny billboard instead of gameplay fire emitters or point lights.
    const fireMap = createFlameTexture(THREE);
    if (fireMap && THREE.Sprite && THREE.SpriteMaterial) {
      flame = new THREE.Sprite(new THREE.SpriteMaterial({
        map:fireMap, transparent:true, depthTest:true, depthWrite:false,
        blending:THREE.AdditiveBlending, color:0xffffff,
      }));
      flame.name = 'stowed_torch_flame';
      flame.position.set(0, .24, .035);
      flame.scale.set(.13, .23, 1);
      flame.renderOrder = 2.34;
      flame.raycast = () => {};
      root.add(flame);
    }

    return {
      root, art, flame,
      setTexture(texture) {
        if (!texture || art.material.map === texture) return false;
        art.material.map = texture; art.material.needsUpdate = true;
        return true;
      },
      setBurning(burning, timeMs = 0) {
        if (!flame) return;
        flame.visible = !!burning;
        if (burning) {
          const seconds = Number(timeMs || 0) / 1000;
          flame.scale.set(.13 * (1 + .07 * Math.sin(seconds * 13)),
            .23 * (1 + .08 * Math.sin(seconds * 11)), 1);
        }
      },
      dispose() {
        root.parent?.remove?.(root);
        art.geometry?.dispose?.();
        art.material?.dispose?.(); // Borrowed held PNG texture remains owned by the original tool.
        fireMap?.dispose?.();
        flame?.material?.dispose?.();
      },
    };
  }

  global.HobunjiBeltStowRig = Object.freeze({
    TORCH_WIDTH, TORCH_HEIGHT, TORCH_SPRITE, defaultSnapshot, normalizedSnapshot,
    characterProfile, configuredSnapshot, placeRoot, createTorchDisplay,
  });
})(window);
