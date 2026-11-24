// Burning Hachutu Torch-Flail brazier heads at the lower end of traversable ruin ropes.
// Uses the authored four-layer head and the weapon's marker-fuel fire emitter; the
// warm halo is a cheap transparent sprite, never a real per-rope light source.
(() => {
  'use strict';
  if (window.RuinRopeTorch || !window.THREE) return;

  const THREE = window.THREE;
  const HEAD_UNIT = 0.001; // Converts the Torch-Flail's authored head pixels to the ruin rope's ~0.3-world-unit grip.
  const AURA_DIAMETER = 0.95; // Soft local glow around the grip, without a dynamic light/shadow pass.
  const AURA_OPACITY = 0.27; // Halo is deliberately subtle beside the shared full-strength fuel flames.
  const MAX_CAMERA_DISTANCE_SQ = 24 * 24; // Far-off rope fire stops spawning particles on mobile.
  const active = new Set(); // Active rope-end visuals; exposed in the in-game diagnostic badge.
  const activeLights=[]; // The shared darkness compositor reads these cached rope-end sources without traversing scene meshes.
  const cameraLocal = new THREE.Vector3(); // Reused to billboard the head and distance-cull emission.
  const lightPosition = new THREE.Vector3(); // Reused world point tracks the swinging rope head's localized Kanthic light.
  const facing = new THREE.Vector3(); // Billboard forward axis (horizontal so flames remain upright).
  const right = new THREE.Vector3(); // Billboard side axis for the authored layered PNGs.
  const up = new THREE.Vector3(0, 1, 0); // Upright brazier orientation, independent of pendulum pitch.
  const basis = new THREE.Matrix4(); // Reused orientation matrix, no allocations in the rope update loop.
  const noRaycast = () => {}; // Fire art and its halo never steal the existing rope grip's interaction hit.
  let texturesPromise = null; // Shares one asynchronous asset load across every rope and ruin reroll.
  let auraTexture = null; // One small procedural radial sprite is reused by all rope-end halos.
  let lastError = null; // Visible in debugSnapshot when an authored head layer fails to load.

  function recipe() {
    return window.WEAPON_SPRITE_ASSEMBLY_CONFIG?.weapons?.hachutuTorchFlail?.flail?.head || null;
  }

  function texturesFor(spec) {
    if (!texturesPromise) {
      texturesPromise = Promise.all(spec.layers.map(layer => new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(layer.sprite, texture => {
          const surface = window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit;
          if (surface?.configureTexture) surface.configureTexture(THREE, texture, layer.sprite);
          else texture.magFilter = texture.minFilter = THREE.NearestFilter;
          resolve(texture);
        }, undefined, reject);
      }))).catch(error => {
        texturesPromise = null; // Allow a subsequent ruin to retry a temporarily unavailable asset.
        throw error;
      });
    }
    return texturesPromise;
  }

  function glowMap() {
    if (auraTexture) return auraTexture;
    const canvas = document.createElement('canvas'); // Tiny precomputed light illusion, not a dynamic point light.
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(0.32, 'rgba(255,255,255,0.34)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    auraTexture = new THREE.CanvasTexture(canvas);
    auraTexture.needsUpdate = true;
    return auraTexture;
  }

  function attach(marker) {
    const spec = recipe();
    const effects = window.HobunjiLayeredWeaponEffects;
    if (!marker?.add || !spec?.layers?.length || !effects?.activateHead) return null;
    const root = new THREE.Group(); // Owned by the invisible grip: it follows the same moving bob, including on layered floors.
    root.name = 'ruin_rope_torch_brazier';
    root.visible = false; // A pending PNG load must not display a false, headless glow before the fuel can burn.
    root.userData.devRuinFootprintIgnore = true;
    marker.add(root);
    const aura = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowMap(), color: 0xffa652, transparent: true, opacity: AURA_OPACITY,
      depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    }));
    aura.name = 'ruin_rope_fake_light';
    aura.scale.set(AURA_DIAMETER, AURA_DIAMETER, 1);
    aura.position.y = 0.065;
    aura.renderOrder = 1.98; // Behind the brazier layers and their interleaved flame motes.
    aura.raycast = noRaycast;
    root.add(aura);
    const facingRoot = new THREE.Group(); // Camera-facing but world-up, unlike the diagonal rope plane.
    facingRoot.name = 'ruin_rope_torch_facing';
    root.add(facingRoot);
    const headRoot = new THREE.Group(); // Carries the authored 2.5x Torch-Flail layers and shared fire effects.
    facingRoot.add(headRoot);
    const state = {
      THREE, headRoot, headParts: [], itemKey: 'ruinRopeTorch', materialLayers: [],
      resolveAsset: path => path, masteryLevel: () => 5,
    }; // The existing fire runtime only needs these fields; no tool inventory or combat assembly is created.
    const light={x:0,y:0,z:0,floorY:0,floorTolerance:2,radius:0.78,strength:0.32,color:[255,154,82],active:false}; // The head illuminates its own grip, never the whole shaft.
    activeLights.push(light);
    const torch = { root, marker, aura, facingRoot, headRoot, state, light, ready: false, disposed: false, wasVisible: false, phase: Math.random() * Math.PI * 2 };
    active.add(torch);

    texturesFor(spec).then(textures => {
      if (torch.disposed) return; // An abandoned ruin may disappear while its first four PNGs are loading.
      const scale = Math.max(0.1, Number(spec.scale) || 1);
      const anchorIndex = Math.max(0, spec.layers.findIndex(layer => layer.id === spec.anchorLayer));
      const anchorImage = textures[anchorIndex].image;
      const anchorLayer = spec.layers[anchorIndex];
      const width = anchorImage.naturalWidth || anchorImage.width, height = anchorImage.naturalHeight || anchorImage.height;
      const point = spec.anchor || { x: width / 2, y: height / 2 };
      const offset = anchorLayer.offsetPx || { x: 0, y: 0 };
      // The authored flail's chain-contact pixel, not the PNG centre, sits at the rope's physical bob.
      headRoot.position.set(
        -(point.x + 0.5 - width / 2 + (Number(offset.x) || 0)) * HEAD_UNIT * scale,
        -(height / 2 - point.y - 0.5 - (Number(offset.y) || 0)) * HEAD_UNIT * scale,
        0,
      );
      headRoot.scale.setScalar(scale);
      for (let index = 0; index < spec.layers.length; index++) {
        const layer = spec.layers[index], original = textures[index];
        const image = original.image;
        const imageWidth = image.naturalWidth || image.width, imageHeight = image.naturalHeight || image.height;
        const map = original.clone(); // Fuel recolor must never overwrite the shared cached source texture.
        map.needsUpdate = true;
        const surface = window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit; // Same authored cutout/colour policy as the held Torch-Flail artwork.
        const material = surface?.makeMaterial
          ? surface.makeMaterial(THREE, map, 'ruin-rope-torch-' + layer.id, {
              side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
            })
          : new THREE.MeshBasicMaterial({
              map, transparent: true, alphaTest: 0.08, side: THREE.DoubleSide,
              depthWrite: false, depthTest: true, toneMapped: false,
            }); // Defensive fallback for isolated test/tool runtimes without the PNG pipeline.
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(imageWidth * HEAD_UNIT, imageHeight * HEAD_UNIT), material);
        mesh.position.set((Number(layer.offsetPx?.x) || 0) * HEAD_UNIT,
          -(Number(layer.offsetPx?.y) || 0) * HEAD_UNIT, 0);
        mesh.renderOrder = 2 + index * 0.001; // Back, handle, fuel, fire, front: identical ordering to the weapon.
        mesh.name = 'ruin_rope_torch_' + layer.id;
        mesh.userData.devRuinFootprintIgnore = true;
        mesh.userData.noOutline = true;
        mesh.raycast = noRaycast;
        headRoot.add(mesh);
        state.headParts.push(mesh);
        effects.registerLayer(state, mesh, layer, image); // Recolors the source marker fuel exactly like the held Torch-Flail.
      }
      effects.activateHead(state, spec, textures.map(texture => ({ image: texture.image })), HEAD_UNIT);
      effects.refreshMetal?.(state, performance.now() + 1200); // Preserve the weapon's ordinary bronze/verdigris surface treatment when available.
      torch.ready = true;
      lastError = null;
    }).catch(error => {
      if (torch.disposed) return;
      lastError = String(error?.message || error);
      console.warn('[RuinRopeTorch] Unable to assemble Torch-Flail head:', error);
      dispose(torch); // Do not leave a misleading unlit halo at a rope with missing assets.
    });
    return torch;
  }

  function tick(torch, dt, camera) {
    if (!torch || torch.disposed) return;
    let visible = true;
    for (let parent = torch.marker; parent; parent = parent.parent) {
      if (parent.visible === false) { visible = false; break; } // Hidden upper floors do not keep burning invisibly.
    }
    if (visible && camera?.getWorldPosition) {
      camera.getWorldPosition(cameraLocal);
      torch.marker.parent?.worldToLocal?.(cameraLocal);
      visible = cameraLocal.distanceToSquared(torch.marker.position) <= MAX_CAMERA_DISTANCE_SQ;
      if (visible) {
        facing.copy(cameraLocal).sub(torch.marker.position);
        facing.y = 0; // Head stays upright instead of inheriting rope pitch or camera elevation.
        if (facing.lengthSq() > 0.000001) {
          facing.normalize();
          right.crossVectors(up, facing).normalize();
          basis.makeBasis(right, up, facing);
          torch.facingRoot.quaternion.setFromRotationMatrix(basis);
        }
      }
    }
    torch.root.visible = visible && torch.ready; // Never show a floating halo until the authored brazier and its fire emitter are ready.
    torch.light.active=torch.root.visible && !!torch.marker.getWorldPosition;
    if(torch.light.active){
      torch.marker.getWorldPosition(lightPosition);
      torch.light.x=lightPosition.x;torch.light.y=lightPosition.y;torch.light.z=lightPosition.z;
      torch.light.floorY=lightPosition.y; // The small light follows the actual rope end in all three axes.
    }
    if (!visible || !torch.ready) { torch.wasVisible = false; return; }
    if (!torch.wasVisible) window.HobunjiLayeredWeaponEffects?.stepFire?.(torch.state, 0.4); // Kill stale flames when a previously culled rope returns to view.
    torch.wasVisible = true;
    torch.aura.material.opacity = AURA_OPACITY * (0.94 + 0.06 * Math.sin(performance.now() * 0.006 + torch.phase));
    window.HobunjiLayeredWeaponEffects?.stepFire?.(torch.state, Math.max(0, Math.min(0.05, dt)));
  }

  function dispose(torch) {
    if (!torch || torch.disposed) return;
    torch.disposed = true;
    torch.state.dead = true; // Late bronze recolor/image promises cannot reattach materials after a ruin reroll.
    active.delete(torch);
    torch.light.active=false;
    const lightIndex=activeLights.indexOf(torch.light);if(lightIndex!==-1)activeLights.splice(lightIndex,1);
    window.HobunjiLayeredWeaponEffects?.dispose?.(torch.state); // Retires pooled and live flame sprite materials.
    torch.headRoot.traverse(node => {
      node.geometry?.dispose?.();
      node.material?.map?.dispose?.(); // Each layer has its own cloned texture; the shared source textures remain cached.
      node.material?.dispose?.();
    });
    torch.aura.material?.dispose?.(); // Aura's single shared procedural texture is intentionally kept for future ropes.
    torch.root.parent?.remove(torch.root);
    torch.state.headParts.length = 0;
    torch.state.materialLayers.length = 0;
  }

  function debugSnapshot() {
    let ready = 0, emitting = 0, liveParticles = 0;
    for (const torch of active) {
      if (torch.ready) ready++;
      if (torch.root.visible && torch.ready) emitting++;
      for (const fx of torch.state.fireEmitters || []) liveParticles += fx.particles.length;
    }
    return { total: active.size, ready, emitting, liveParticles, lastError };
  }

  window.RuinRopeTorch = Object.freeze({ attach, tick, dispose, lightSources:()=>activeLights, debugSnapshot });
})();
