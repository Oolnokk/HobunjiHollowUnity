// Procedural leg/foot animation for non-creature (PNG-plane) avatars: attaches
// a pair of feet under an avatar's floor-anchored parent (the same `root`
// buildSinglePlaneAvatarModel returns, or playerMesh for the player — both
// place Y=0 at the actual floor, with the billboard plane itself offset up
// by modelHeight/2, see docs/js/png-plane-avatar.js) and steps them through a
// simple planted/swing gait driven by the avatar's own current movement
// speed. Species with a configured GLB (proceduralFeet.species in
// scratchbones-config.js) get that mesh, recolored per its materialRoles;
// everything else (kenkari/rakako'an, or any future species without an
// entry) gets a generated primitive foot instead.
(function () {
  'use strict';

  function cfg() {
    return window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet || {};
  }

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // Mirrors png-plane-avatar.js's own species->parentSpecies chain walk, so a
  // species without its own proceduralFeet entry inherits its parent's
  // (matching how portraitVerticalPlacement/portraitScaleBySpecies fall back).
  function configuredParentSpecies(species) {
    const speciesConfig = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species || {};
    return normalizeKey(speciesConfig[species]?.parentSpecies);
  }

  function speciesChain(species) {
    const chain = [];
    const seen = new Set();
    let current = normalizeKey(species);
    while (current && !seen.has(current)) {
      chain.push(current);
      seen.add(current);
      current = configuredParentSpecies(current);
    }
    return chain;
  }

  function footConfigForSpecies(species) {
    const bySpecies = cfg().species || {};
    for (const key of speciesChain(species)) {
      if (bySpecies[key]) return bySpecies[key];
    }
    return null;
  }

  const KENKARI_FAMILY = new Set(['kenkari', 'rakakoan']);

  function bodyColorHex(bodyColors, speciesId) {
    const referenceHex = (typeof window._dyeReferenceHexForSlot === 'function')
      ? window._dyeReferenceHexForSlot('A', speciesId)
      : '#7dc89a';
    const descriptor = bodyColors?.A || null;
    if (descriptor && typeof window._resolveTargetRgbColor === 'function') {
      const rgb = window._resolveTargetRgbColor(descriptor, referenceHex);
      if (Array.isArray(rgb)) return rgbToHex(rgb);
    }
    if (descriptor?.hex) return descriptor.hex;
    return referenceHex;
  }

  function rgbToHex(rgb) {
    return '#' + rgb.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }

  function smoothstep01(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  // Frame-rate-independent exponential damping toward `target` at rate
  // `lambda` (higher = snappier), matching the reference authoring tool's
  // own dampNumber helper.
  function damp(current, target, lambda, dt) {
    return current + (target - current) * (1 - Math.exp(-Math.max(0, lambda) * Math.max(0, dt)));
  }

  // Splits one foot's cycle into a long planted phase (the body travels over
  // a stationary foot) and a shorter lifted swing phase (the foot recovers
  // to the front) — ported from the reference procedural-movement tool's
  // stridePoseAtPhase.
  function stridePoseAtPhase(phase, strideLength, liftHeight, stanceFraction) {
    const cycle = ((phase % 1) + 1) % 1;
    if (cycle < stanceFraction) {
      const stanceT = cycle / stanceFraction;
      return { travel: strideLength * (0.5 - stanceT), lift: 0, planted: true };
    }
    const swingT = (cycle - stanceFraction) / Math.max(0.0001, 1 - stanceFraction);
    const eased = smoothstep01(swingT);
    return {
      travel: -strideLength / 2 + strideLength * eased,
      lift: Math.pow(Math.max(0, Math.sin(Math.PI * swingT)), 1.35) * liftHeight,
      planted: false,
    };
  }

  function disposeObjectResources(root) {
    if (!root) return;
    root.traverse?.(child => {
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : (child.material ? [child.material] : []);
      for (const material of materials) {
        material.map?.dispose?.();
        material.dispose?.();
      }
    });
  }

  // A generated fallback foot: a flattened sphere pad, plus (for the Kenkari
  // family only) a pair of forward/backward teardrop-toe "V"s, mirroring the
  // reference tool's primitive anatomy. Used for any species without a
  // configured GLB (today: kenkari, rakako'an).
  function buildFallbackFoot(THREE, options) {
    const { speciesId, radius, sphereScaleXZ, sphereScaleY, color } = options;
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material);
    sphere.scale.set(sphereScaleXZ, sphereScaleY, sphereScaleXZ);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    group.add(sphere);
    if (KENKARI_FAMILY.has(speciesId)) {
      const toeLength = radius * 2.2;
      const toeRadius = radius * 0.17;
      const toeGeometry = new THREE.ConeGeometry(toeRadius, toeLength, 10);
      const sets = [{ z: radius * 0.18, facing: 0 }, { z: -radius * 0.18, facing: Math.PI }];
      for (const set of sets) {
        for (const side of [-1, 1]) {
          const toe = new THREE.Mesh(toeGeometry, material);
          // Cones point along +Y by default; lay them flat along local Z (the
          // gait's forward/back travel axis) and fan the pair outward.
          toe.rotation.x = Math.PI / 2;
          toe.rotation.z = set.facing + side * 0.42;
          toe.position.set(0, -radius + toeRadius * 0.6, set.z);
          toe.castShadow = true;
          group.add(toe);
        }
      }
    }
    group.userData.contactRadiusY = radius * sphereScaleY;
    return group;
  }

  const _glbSceneCache = new Map(); // glb path -> Promise<THREE.Object3D>

  function loadGlbScene(THREE, path) {
    if (_glbSceneCache.has(path)) return _glbSceneCache.get(path);
    const promise = new Promise((resolve, reject) => {
      if (!THREE.GLTFLoader) { reject(new Error('THREE.GLTFLoader is not available.')); return; }
      new THREE.GLTFLoader().load(path, gltf => resolve(gltf.scene), undefined, reject);
    });
    _glbSceneCache.set(path, promise);
    return promise;
  }

  // Builds one recolored, auto-fit clone of a species' configured foot GLB.
  // The bundled foot GLBs carry flat (untextured) per-material base colors
  // named "Mat 1"/"Mat 2" — materialRoles maps those names to a role ('body'
  // uses the avatar's own body color 1, 'bone' uses the shared bone tint)
  // rather than assuming array order, since glTF material array order isn't
  // guaranteed to match the authored material names.
  async function buildGlbFoot(THREE, footConfig, options) {
    const { speciesId, bodyColors, targetHeight } = options;
    const scene = await loadGlbScene(THREE, footConfig.glb);
    const clone = scene.clone(true);
    const roles = footConfig.materialRoles || {};
    const roleHex = {
      body: bodyColorHex(bodyColors, speciesId),
      bone: cfg().boneColorHex || '#D8C7A3',
    };
    const remapped = new Map();
    clone.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const applyOne = material => {
        if (remapped.has(material)) return remapped.get(material);
        const cloned = material.clone();
        const role = roles[material.name] || 'body';
        cloned.color.set(roleHex[role] || roleHex.body);
        remapped.set(material, cloned);
        return cloned;
      };
      child.material = Array.isArray(child.material) ? child.material.map(applyOne) : applyOne(child.material);
    });
    clone.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(clone);
    const size = bounds.getSize(new THREE.Vector3());
    if (size.y > 0.000001 && targetHeight > 0) {
      clone.scale.multiplyScalar(targetHeight / size.y);
      clone.updateMatrixWorld(true);
    }
    const fitted = new THREE.Box3().setFromObject(clone);
    const center = fitted.getCenter(new THREE.Vector3());
    clone.position.x -= center.x;
    clone.position.z -= center.z;
    clone.position.y -= fitted.min.y; // sits the model's own bottom at local Y=0
    const group = new THREE.Group();
    group.add(clone);
    group.userData.contactRadiusY = 0;
    return group;
  }

  const STANCE_FRACTION = 0.62;

  // Attaches a procedural feet pair under `parent` (the avatar's own
  // floor-anchored root/playerMesh — NOT the billboard plane child, which
  // sits modelHeight/2 above it). Returns a handle with update()/dispose(),
  // or null if procedural feet are disabled or no species could be resolved.
  function attach(THREE, parent, options = {}) {
    if (!THREE || !parent) return null;
    const c = cfg();
    if (c.enabled === false) return null;
    const speciesId = normalizeKey(options.speciesId);
    if (!speciesId) return null;
    const modelWidth = Number(options.modelWidth) || 0.9;
    const modelHeight = Number(options.modelHeight) || modelWidth;
    const stanceWidthFraction = Number(c.stanceWidthFraction) || 0.16;
    const footHeightFraction = Number(c.footHeightFraction) || 0.11;
    const radius = modelHeight * footHeightFraction * 0.5;
    const isKenkariFamily = KENKARI_FAMILY.has(speciesId);
    const sphereScaleXZ = isKenkariFamily ? 0.6 : 1;
    const sphereScaleY = isKenkariFamily ? 1 : 0.75;
    const idleX = stanceWidthFraction * modelWidth * 0.5;

    const root = new THREE.Group();
    root.name = `${options.name || 'avatar'}_procedural_feet`;

    const state = {
      phase: 0,
      gaitStrength: 0,
      left: null,
      right: null,
      leftContactY: radius * sphereScaleY,
      rightContactY: radius * sphereScaleY,
      disposed: false,
    };

    function placeIdle(mesh, sign, contactY) {
      mesh.position.set(sign * idleX, contactY, 0);
    }

    const fallbackColor = isKenkariFamily ? (c.keratinColorHex || '#44484D') : bodyColorHex(options.bodyColors, speciesId);
    const leftFallback = buildFallbackFoot(THREE, { speciesId, radius, sphereScaleXZ, sphereScaleY, color: fallbackColor });
    const rightFallback = buildFallbackFoot(THREE, { speciesId, radius, sphereScaleXZ, sphereScaleY, color: fallbackColor });
    leftFallback.name = 'left_foot';
    rightFallback.name = 'right_foot';
    placeIdle(leftFallback, -1, leftFallback.userData.contactRadiusY);
    placeIdle(rightFallback, 1, rightFallback.userData.contactRadiusY);
    root.add(leftFallback, rightFallback);
    state.left = leftFallback;
    state.right = rightFallback;
    state.leftContactY = leftFallback.userData.contactRadiusY;
    state.rightContactY = rightFallback.userData.contactRadiusY;

    const footConfig = footConfigForSpecies(speciesId);
    if (footConfig?.glb) {
      const targetHeight = radius * 2 * (Number(c.autofitMultiplier) || 1);
      Promise.all([
        buildGlbFoot(THREE, footConfig, { speciesId, bodyColors: options.bodyColors, targetHeight }),
        buildGlbFoot(THREE, footConfig, { speciesId, bodyColors: options.bodyColors, targetHeight }),
      ]).then(([leftMesh, rightMesh]) => {
        if (state.disposed) { disposeObjectResources(leftMesh); disposeObjectResources(rightMesh); return; }
        leftMesh.name = 'left_foot';
        rightMesh.name = 'right_foot';
        leftMesh.scale.x *= -1; // mirrors handedness for the left foot from a single authored mesh
        root.remove(state.left);
        root.remove(state.right);
        disposeObjectResources(state.left);
        disposeObjectResources(state.right);
        placeIdle(leftMesh, -1, leftMesh.userData.contactRadiusY);
        placeIdle(rightMesh, 1, rightMesh.userData.contactRadiusY);
        root.add(leftMesh, rightMesh);
        state.left = leftMesh;
        state.right = rightMesh;
        state.leftContactY = leftMesh.userData.contactRadiusY;
        state.rightContactY = rightMesh.userData.contactRadiusY;
      }).catch(error => {
        console.warn(`[ProceduralLegAnimation] foot GLB load failed for "${speciesId}" (${footConfig.glb}):`, error);
      });
    }

    parent.add(root);

    function applyPose(mesh, contactY, pose, response, dt) {
      if (!mesh) return;
      const targetZ = pose.travel;
      mesh.position.z = damp(mesh.position.z, targetZ, response, dt);
      const rollAmount = pose.travel / Math.max(radius, 0.001) * 0.32;
      mesh.rotation.x = damp(mesh.rotation.x, -rollAmount, response, dt);
      if (pose.planted && state.gaitStrength > 0.04) {
        mesh.position.y = contactY;
      } else {
        mesh.position.y = damp(mesh.position.y, contactY + pose.lift, response, dt);
      }
    }

    // speedWorldUnitsPerSecond: current movement speed in the same world
    // units as modelWidth/modelHeight (i.e. Three.js scene units, not
    // pixels/tiles — callers convert their own speed units before calling).
    // suppressed: true while a multi-avatar animation (mount, milking, …)
    // is driving this avatar's whole-body transform and this avatar is not
    // the anchor — the feet are hidden rather than animated, since there's
    // no meaningful "standing on the ground" pose while e.g. seated on a
    // mount. A shoulder pet riding along never sets this: the host avatar
    // stays the anchor and keeps walking normally underneath it.
    function update(dt, speedWorldUnitsPerSecond, suppressed) {
      if (state.disposed) return;
      root.visible = !suppressed;
      if (suppressed) {
        state.gaitStrength = damp(state.gaitStrength, 0, 12, dt);
        return;
      }
      const speed = Math.max(0, Number(speedWorldUnitsPerSecond) || 0);
      const referenceSpeed = Number(c.referenceSpeedWorldUnitsPerSecond) || 4.3;
      const speedRatio = Math.max(0, Math.min(1.25, speed / Math.max(0.1, referenceSpeed)));
      const gaitTarget = speed > 0.02 ? Math.sqrt(speedRatio) : 0;
      state.gaitStrength = damp(state.gaitStrength, gaitTarget, gaitTarget > state.gaitStrength ? 8 : 12, dt);

      const fullStride = modelHeight * (0.24 + 0.34 * Math.sqrt(speedRatio));
      const strideLength = fullStride * state.gaitStrength;
      const cadenceHz = speed > 0.02 && fullStride > 0.001
        ? Math.max(0.55, Math.min(3.2, (speed * STANCE_FRACTION) / fullStride))
        : 0;
      const liftHeight = (radius * (0.35 + 1.35 * Math.sqrt(speedRatio)) + modelHeight * 0.012 * speedRatio) * state.gaitStrength;
      if (cadenceHz > 0.001) state.phase = (state.phase + dt * cadenceHz) % 1;

      const leftPose = stridePoseAtPhase(state.phase, strideLength, liftHeight, STANCE_FRACTION);
      const rightPose = stridePoseAtPhase(state.phase + 0.5, strideLength, liftHeight, STANCE_FRACTION);
      const response = speed > 0.02 ? 18 + cadenceHz * 3 : 11;
      applyPose(state.left, state.leftContactY, leftPose, response, dt);
      applyPose(state.right, state.rightContactY, rightPose, response, dt);
    }

    function dispose() {
      if (state.disposed) return;
      state.disposed = true;
      parent.remove(root);
      disposeObjectResources(root);
    }

    return { group: root, update, dispose };
  }

  window.ProceduralLegAnimation = { attach };
})();
