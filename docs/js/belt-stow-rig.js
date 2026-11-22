// Shared attachment-rig coordinates and lightweight artwork for belt-stowed equipment.
// Animation Author and gameplay both consume this module; no independent frame driver.
(function (global) {
  'use strict';
  if (global.HobunjiBeltStowRig) return;

  const TORCH_WIDTH = 0.5; // Same base plane width as game.js makeToolPlaneMesh / the Attack Animation Editor.
  const TORCH_HEIGHT = TORCH_WIDTH * (1204 / 450); // Actual torch.png 450×1204 baseline; a loaded PNG or held-plane geometry can override this aspect.
  const TORCH_SPRITE = 'assets/toolsprites/torch.png'; // First supported item in this extensible belt slot.
  const RAD = Math.PI / 180; // Converts exported rig rotation degrees to Three.js radians.
  const AXES = ['x', 'y', 'z']; // The JSON coordinate format shared with other attachment anchors.

  function defaultSnapshot(modelHeight = .9) {
    const height = Number.isFinite(Number(modelHeight)) && Number(modelHeight) > 0
      ? Number(modelHeight) : .9; // Fallback only; saved profiles use literal local-world coordinates.
    return {
      position: { x: 0, y: .5 * height, z: -.04 * height },
      rotationDeg: { x: 0, y: 0, z: -45 },
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

  function createTorchDisplay(THREE, { previewFlame = true } = {}) {
    if (!THREE?.Group || !THREE?.Mesh) return null;
    const root = new THREE.Group(); // A render-only attachment that may be parented to a game body or authoring gizmo.
    root.name = 'adventuring_torch_belt';
    root.userData.adventuringTorchBelt = true;
    root.userData.nonInteractive = true;
    const art = new THREE.Mesh(new THREE.PlaneGeometry(TORCH_WIDTH, TORCH_HEIGHT),
      new THREE.MeshBasicMaterial({ transparent:true, depthTest:true, depthWrite:false, side:THREE.DoubleSide }));
    art.name = 'stowed_torch_png';
    art.rotation.z = Math.PI; // The existing torch.png's burning end points along image -Y.
    art.renderOrder = 2.16; // Between the rear and front portrait passes, like other back-stowed gear.
    art.userData.noOutline = true; // The PNG already contains its own ink.
    art.raycast = () => {}; // Never intercept item selection, editor actor picking, or world interactions.
    root.add(art);

    let flame = null; // A single tiny billboard instead of gameplay fire emitters or point lights.
    const fireMap = previewFlame ? createFlameTexture(THREE) : null; // Gameplay instead attaches the actual layered-weapon fire emitter.
    if (fireMap && THREE.Sprite && THREE.SpriteMaterial) {
      flame = new THREE.Sprite(new THREE.SpriteMaterial({
        map:fireMap, transparent:true, depthTest:true, depthWrite:false,
        blending:THREE.AdditiveBlending, color:0xffffff,
      }));
      flame.name = 'stowed_torch_flame';
      flame.position.set(0, .24, .035);
      flame.scale.set(.13, .23, 1);
      flame.renderOrder = 2.17;
      flame.raycast = () => {};
      root.add(flame);
    }

    let idleScale = 1; // Authored Neutral multiplier shared with the held tool and projectile.
    let sourceWidth = TORCH_WIDTH; // Live held-plane width, used to size the belt without a miniature surrogate.
    let sourceHeight = TORCH_HEIGHT; // Live held-plane height, used to preserve the PNG aspect and handle-end position.
    let emitterSourcePoint = null; // Normalized original-PNG marker centroid; gameplay supplies the exact particle emission location.
    function applyDimensions() {
      art.scale.set(sourceWidth / TORCH_WIDTH * idleScale, sourceHeight / TORCH_HEIGHT * idleScale, 1);
      const gripX = 0, gripY = sourceHeight * idleScale * .5; // The original PNG's +Y handle end is the grip reference, before its 180° display flip.
      const emitterX = emitterSourcePoint ? (emitterSourcePoint.x - .5) * sourceWidth * idleScale : 0;
      const emitterY = emitterSourcePoint ? (.5 - emitterSourcePoint.y) * sourceHeight * idleScale
        : -sourceHeight * idleScale * .5 - .05 * idleScale; // The preview has a conservative tip fallback until real marker pixels are available.
      art.position.set((gripX + emitterX) / 2, (gripY + emitterY) / 2, 0); // The PI sprite flip negates both endpoints: their midpoint is now exactly root (0,0).
      if (flame) {
        flame.position.set((gripX - emitterX) / 2, (gripY - emitterY) / 2, .035); // Preview flame is mounted at the actual emitter end of the centered lever.
        flame.scale.set(.13 * idleScale, .23 * idleScale, 1);
      }
    }
    function setSourceDimensions(width, height) {
      const w = Number(width), h = Number(height); // Real geometry from the equipped tool or decoded asset dimensions.
      if (![w, h].every(Number.isFinite) || w < .05 || w > 3 || h < .05 || h > 6) return false;
      if (Math.abs(w - sourceWidth) < 1e-5 && Math.abs(h - sourceHeight) < 1e-5) return false;
      sourceWidth = w; sourceHeight = h;
      applyDimensions(); // Scale the existing mesh, avoiding runtime geometry/texture allocation.
      return true;
    }
    function setEmitterSourcePoint(x, y, width, height) {
      const px = Number(x), py = Number(y), w = Number(width), h = Number(height); // Pixel centroid and original PNG dimensions from the authoritative fire emitter.
      if (![px, py, w, h].every(Number.isFinite) || !(w > 0 && h > 0)) return false;
      const next = { x: Math.max(0, Math.min(1, (px + .5) / w)), y: Math.max(0, Math.min(1, (py + .5) / h)) };
      if (emitterSourcePoint && Math.abs(next.x - emitterSourcePoint.x) < 1e-6 && Math.abs(next.y - emitterSourcePoint.y) < 1e-6) return false;
      emitterSourcePoint = next; applyDimensions(); // Applied once per source PNG; subsequent stance scaling reuses this fraction.
      return true;
    }
    function setIdleScale(value) {
      const numeric = Number(value); // Current authored torch Neutral scale from WeaponToolStances, including editor overrides.
      const next = Number.isFinite(numeric) && numeric > 0 ? Math.min(3, Math.max(.1, numeric)) : 1;
      if (next === idleScale) return;
      idleScale = next;
      applyDimensions();
    }
    applyDimensions(); // The midpoint between the handle grip and the image-space emitter remains the root pivot.
    setIdleScale(Number(global.WeaponToolStances?.poses?.torchHold?.scale ?? global.HeldActionAnimations?.torchIdle?.poses?.neutral?.scale) || 1);
    return {
      root, art, flame, setIdleScale, setSourceDimensions, setEmitterSourcePoint,
      get emitterSourcePoint() { return emitterSourcePoint; },
      get idleScale() { return idleScale; },
      get sourceDimensions() { return { width: sourceWidth, height: sourceHeight }; }, // On-demand author/mobile preview, never sampled by the render loop.
      setTexture(texture) {
        if (!texture || art.material.map === texture) return false;
        art.material.map = texture; art.material.needsUpdate = true;
        const imageWidth = Number(texture.image?.naturalWidth || texture.image?.width); // Decoded PNG ratio can update preview geometry when the source artwork changes.
        const imageHeight = Number(texture.image?.naturalHeight || texture.image?.height);
        if (imageWidth > 0 && imageHeight > 0) setSourceDimensions(TORCH_WIDTH, TORCH_WIDTH * imageHeight / imageWidth);
        return true;
      },
      setBurning(burning, timeMs = 0) {
        if (!flame) return;
        flame.visible = !!burning;
        if (burning) {
          const seconds = Number(timeMs || 0) / 1000;
          flame.scale.set(.13 * idleScale * (1 + .07 * Math.sin(seconds * 13)),
            .23 * idleScale * (1 + .08 * Math.sin(seconds * 11)), 1);
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
