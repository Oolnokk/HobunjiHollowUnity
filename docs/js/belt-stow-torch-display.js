// Torch-only stow artwork and optional Animation Author preview flame.
// Rig profile serialization lives in belt-stow-rig.js; game fire motes live in stowed-torch-fire.js.
(function (global) {
  'use strict';
  if (global.HobunjiBeltStowTorchDisplay) return;

  const TORCH_WIDTH = .5; // Matches the existing carried tool-plane width and emitter pixel conversion.
  const TORCH_HEIGHT = TORCH_WIDTH * (1204 / 450); // Original torch PNG aspect before authored stance scaling.
  const TORCH_SPRITE = 'assets/toolsprites/torch.png'; // Canonical authored sprite used for both editor preview and gameplay.

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
      new THREE.MeshBasicMaterial({ transparent:true, alphaTest:0.08, depthTest:true, depthWrite:false, side:THREE.DoubleSide }));
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
    let gripSourcePoint = null; // Normalized held-tool grip, projected from the authored 3D Harlyao/torch item frame onto its original sprite plane.
    function applyDimensions() {
      art.scale.set(sourceWidth / TORCH_WIDTH * idleScale, sourceHeight / TORCH_HEIGHT * idleScale, 1);
      const gripX = gripSourcePoint ? (gripSourcePoint.x - .5) * sourceWidth * idleScale : 0;
      const gripY = gripSourcePoint ? (.5 - gripSourcePoint.y) * sourceHeight * idleScale : sourceHeight * idleScale * .5; // Prefer the real primary grip over the former top-edge fallback.
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
    function setGripItemPoint(point) {
      const x = Number(point?.x), z = Number(point?.z); // In-hand tool plane has -90° X rotation: item Z maps to negative image Y.
      if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 3 || Math.abs(z) > 3) return false;
      const next = { x:.5 + x / TORCH_WIDTH, y:.5 + z / TORCH_HEIGHT }; // Original PNG UV coordinates, independent of neutral scale and species dimensions.
      if (gripSourcePoint && Math.abs(gripSourcePoint.x - next.x) < 1e-6 && Math.abs(gripSourcePoint.y - next.y) < 1e-6) return false;
      gripSourcePoint = next;
      applyDimensions(); // The same source-space grip tracks live torch size changes without resampling pixels.
      return true;
    }
    function setIdleScale(value) {
      const numeric = Number(value); // Current authored torch Neutral scale from WeaponToolStances, including editor overrides.
      const next = Number.isFinite(numeric) && numeric > 0 ? Math.min(3, Math.max(.1, numeric)) : 1;
      if (next === idleScale) return;
      idleScale = next;
      applyDimensions();
    }
    applyDimensions(); // The midpoint between the authored hand grip (when available) and image-space emitter remains the root pivot.
    setGripItemPoint(global.HobunjiHandToolGrips?.authoredPrimaryGripForTool?.('torch', 'melee')?.position); // Gameplay and Rig Coordinates preview share the real existing hand grip when its module is loaded.
    setIdleScale(Number(global.WeaponToolStances?.poses?.torchHold?.scale ?? global.HeldActionAnimations?.torchIdle?.poses?.neutral?.scale) || 1);
    return {
      root, art, flame, setIdleScale, setSourceDimensions, setEmitterSourcePoint, setGripItemPoint,
      get emitterSourcePoint() { return emitterSourcePoint; },
      get gripSourcePoint() { return gripSourcePoint; },
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

  global.HobunjiBeltStowTorchDisplay = Object.freeze({
    TORCH_WIDTH, TORCH_HEIGHT, TORCH_SPRITE, createTorchDisplay,
  });
})(window);
