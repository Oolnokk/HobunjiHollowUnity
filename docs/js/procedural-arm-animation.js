// Procedural fixed-length arm/hand rig for PNG-plane characters. The painted
// arms stay in the portrait; invisible shoulder -> upper-arm -> forearm bones
// carry two 3D hands. The right hand follows the live tool target, and the
// shared ArmBones solver projects any overextended attack pose back to the
// closest point the current species can actually reach.
(function () {
  'use strict';

  function cfg() {
    return window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralHands || {};
  }

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) {
    return String(value || '').trim().toLowerCase() === 'female' ? 'female' : 'male';
  }

  function parentSpecies(species) {
    const speciesConfig = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species || {};
    return normalizeKey(speciesConfig[species]?.parentSpecies);
  }

  function handConfigForSpecies(species) {
    const table = cfg().species || {};
    const seen = new Set(); // Used to prevent malformed parent-species cycles.
    let current = normalizeKey(species);
    while (current && !seen.has(current)) {
      if (table[current]) return table[current];
      seen.add(current);
      current = parentSpecies(current);
    }
    return null;
  }

  // Per-species/gender hand-size multiplier (proceduralHands.handScale in
  // scratchbones-config.js), matching the procedural-feet lookup pattern.
  // Missing hand values inherit the corresponding foot scale so the two
  // systems keep the same defaults until a hand-specific value is authored.
  function handScaleMultiplierForSpecies(speciesId, gender) {
    const handTable = cfg().handScale || {}; // Supplies independently configurable hand-size overrides.
    const footTable = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.footScale || {}; // Supplies the initial/fallback species scale.

    function lookupSpecies(table) {
      const seen = new Set(); // Prevents malformed parent-species cycles during scale lookup.
      let current = normalizeKey(speciesId); // Walks the selected species and its configured parents.
      while (current && !seen.has(current)) {
        const entry = table[current]; // Supplies a gender-specific scale for this point in the species chain.
        if (entry && Object.prototype.hasOwnProperty.call(entry, gender)) {
          const value = Number(entry[gender]); // Converts authored JSON values into a usable multiplier.
          if (Number.isFinite(value) && value > 0) return value;
        }
        seen.add(current);
        current = parentSpecies(current);
      }
      return null;
    }

    const handSpeciesValue = lookupSpecies(handTable); // Gives an authored hand override first priority.
    if (handSpeciesValue != null) return handSpeciesValue;
    const footSpeciesValue = lookupSpecies(footTable); // Preserves the matching foot scale when no hand override exists.
    if (footSpeciesValue != null) return footSpeciesValue;
    const handDefault = Number(handTable.default); // Supplies the hand-wide fallback for an unlisted species.
    if (Number.isFinite(handDefault) && handDefault > 0) return handDefault;
    const footDefault = Number(footTable.default); // Preserves the foot-wide fallback if hand defaults are omitted.
    return Number.isFinite(footDefault) && footDefault > 0 ? footDefault : 1;
  }

  function resolveAssetPath(path, assetBase) {
    if (!assetBase || !String(path).startsWith('assets/')) return path;
    return String(assetBase).replace(/\/?$/, '/') + String(path).slice('assets/'.length);
  }

  function bodyColorHex(speciesId, bodyColors) {
    const reference = typeof window._dyeReferenceHexForSlot === 'function'
      ? window._dyeReferenceHexForSlot('A', speciesId)
      : '#7dc89a';
    const descriptor = bodyColors?.A;
    if (descriptor?.hex) return descriptor.hex;
    if (typeof window._resolveTargetRgbColor === 'function') {
      const rgb = window._resolveTargetRgbColor(descriptor, reference);
      if (Array.isArray(rgb)) {
        return '#' + rgb.slice(0, 3).map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('');
      }
    }
    return reference;
  }

  function roleColor(role, speciesId, bodyColors) {
    if (role === 'bone') return cfg().boneColorHex || '#D8C7A3';
    if (role === 'keratin') return cfg().keratinColorHex || '#44484D';
    return bodyColorHex(speciesId, bodyColors);
  }

  function markOutline(root) {
    root?.traverse?.(child => { if (child.isMesh) child.layers.enable(1); });
    window.HobunjiOutlines?.markMaterialSeamId?.(root);
  }

  function disposeObjectResources(root) {
    root?.traverse?.(child => {
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : (child.material ? [child.material] : []);
      for (const material of materials) material.dispose?.();
    });
  }

  const glbCache = new Map(); // Resolved path -> Promise<Object3D>, shared by every character hand pair.
  function loadGlbScene(THREE, path, customLoader) {
    if (glbCache.has(path)) return glbCache.get(path);
    const promise = customLoader
      ? Promise.resolve(customLoader(path)).then(result => result?.scene || result)
      : new Promise((resolve, reject) => {
          if (!THREE.GLTFLoader) {
            reject(new Error('THREE.GLTFLoader is not available.'));
            return;
          }
          new THREE.GLTFLoader().load(path, gltf => resolve(gltf.scene), undefined, reject);
        });
    glbCache.set(path, promise);
    return promise;
  }

  async function buildGlbHand(THREE, handConfig, options) {
    const resolvedPath = resolveAssetPath(handConfig.glb, options.assetBase);
    const source = await loadGlbScene(THREE, resolvedPath, options.loadGlbScene);
    if (!source) throw new Error(`Hand GLB had no scene: ${resolvedPath}`);
    const clone = source.clone(true);
    const remapped = new Map(); // Original material -> hand-owned unlit material.
    clone.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.geometry) child.geometry = child.geometry.clone();
      const replaceMaterial = (material) => {
        if (remapped.has(material)) return remapped.get(material);
        const role = handConfig.materialRoles?.[material?.name] || 'body';
        const next = new THREE.MeshBasicMaterial({ color: roleColor(role, options.speciesId, options.bodyColors) });
        next.name = material?.name || `${role}_hand_material`;
        remapped.set(material, next);
        return next;
      };
      child.material = Array.isArray(child.material) ? child.material.map(replaceMaterial) : replaceMaterial(child.material);
    });
    clone.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(clone);
    const size = bounds.getSize(new THREE.Vector3());
    if (size.y > 0.000001) clone.scale.multiplyScalar(options.targetHeight / size.y);
    clone.updateMatrixWorld(true);
    const fitted = new THREE.Box3().setFromObject(clone);
    const center = fitted.getCenter(new THREE.Vector3());
    clone.position.sub(center); // The tool attach point passes through the palm center.
    const group = new THREE.Group();
    group.add(clone);
    markOutline(group);
    return group;
  }

  function buildFallbackHand(THREE, targetHeight, color) {
    const geometry = new THREE.SphereGeometry(targetHeight * 0.42, 14, 10);
    geometry.scale(0.72, 1, 0.55);
    const material = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geometry, material);
    const group = new THREE.Group();
    group.add(mesh);
    markOutline(group);
    return group;
  }

  let showArmBoneGuides = false;
  function makeBoneGuide(THREE, color) {
    const guide = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.012, 1, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82, depthTest: false, depthWrite: false })
    );
    guide.renderOrder = 44;
    guide.frustumCulled = false;
    return guide;
  }

  function makeJointGuide(THREE, color, radius) {
    const guide = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88, depthTest: false, depthWrite: false })
    );
    guide.renderOrder = 45;
    guide.frustumCulled = false;
    return guide;
  }

  function attach(THREE, parent, options = {}) {
    if (!THREE || !parent || !window.ArmBones || cfg().enabled === false) return null;
    const speciesId = normalizeKey(options.speciesId);
    if (!speciesId) return null;
    const gender = normalizeGender(options.gender);
    const modelHeight = Number(options.modelHeight) || 0.9;
    const handScale = handScaleMultiplierForSpecies(speciesId, gender); // Scales both GLB and fallback hands for this species/gender.
    const targetHeight = modelHeight * (Number(cfg().handHeightFraction) || 0.12) * handScale;
    const anatomy = options.armAttachments || {};
    const fallbackLength = modelHeight * 0.32;
    const root = new THREE.Group();
    root.name = `${options.name || 'avatar'}_procedural_hands`;
    parent.add(root);

    function anatomyFor(side) {
      const source = anatomy[side] || {};
      const mirrorSign = side === 'left' ? -1 : 1;
      const fallbackX = mirrorSign * Math.abs(Number(options.handAttachX) || modelHeight * 0.28);
      const fallbackY = Number(options.handAttachY) || modelHeight * 0.45;
      return {
        shoulder: new THREE.Vector3(
          Number.isFinite(Number(source.shoulder?.x)) ? Number(source.shoulder.x) : fallbackX,
          Number.isFinite(Number(source.shoulder?.y)) ? Number(source.shoulder.y) : fallbackY + fallbackLength,
          Number(source.shoulder?.z) || 0
        ),
        idleHand: new THREE.Vector3(
          Number.isFinite(Number(source.idleHand?.x)) ? Number(source.idleHand.x) : fallbackX,
          Number.isFinite(Number(source.idleHand?.y)) ? Number(source.idleHand.y) : fallbackY,
          Number(source.idleHand?.z) || 0
        ),
        armLength: Math.max(modelHeight * 0.05, Number(source.armLength) || fallbackLength),
      };
    }

    function buildChain(side) {
      const measurements = anatomyFor(side); // Used throughout this side's fixed-length IK chain.
      const shoulder = new THREE.Group();
      shoulder.name = `${side}_shoulder`;
      shoulder.position.copy(measurements.shoulder);
      const upper = new THREE.Group();
      upper.name = `${side}_upper_arm`;
      const forearm = new THREE.Group();
      forearm.name = `${side}_forearm`;
      const shoulderGuide = makeJointGuide(THREE, 0x78d7ff, 0.018);
      const upperGuide = makeBoneGuide(THREE, 0x45b7e8);
      const elbowGuide = makeJointGuide(THREE, 0x8be4ff, 0.017);
      const forearmGuide = makeBoneGuide(THREE, 0x248cb8);
      shoulder.add(shoulderGuide, upper);
      upper.add(upperGuide, forearm);
      forearm.add(elbowGuide, forearmGuide);
      root.add(shoulder);
      return { side, measurements, shoulder, upper, forearm, shoulderGuide, upperGuide, elbowGuide, forearmGuide, hand: null };
    }

    const chains = { left: buildChain('left'), right: buildChain('right') };
    const state = {
      disposed: false,
      rightTarget: chains.right.measurements.idleHand.clone(),
      rightClamped: false,
      lastRequestedDistance: 0,
      lastConstrainedDistance: 0,
    };

    function applyGuides(chain, upperLength, forearmLength) {
      for (const guide of [chain.shoulderGuide, chain.upperGuide, chain.elbowGuide, chain.forearmGuide]) guide.visible = showArmBoneGuides;
      chain.upperGuide.scale.set(1, upperLength, 1);
      chain.upperGuide.position.y = -upperLength * 0.5;
      chain.forearmGuide.scale.set(1, forearmLength, 1);
      chain.forearmGuide.position.y = -forearmLength * 0.5;
    }

    function applySide(side, requestedTarget, desiredHandQuaternion) {
      const chain = chains[side];
      const target = requestedTarget || chain.measurements.idleHand;
      const solved = window.ArmBones.solveTwoBoneArm(THREE, {
        shoulder: chain.measurements.shoulder,
        target,
        armLength: chain.measurements.armLength,
        pole: { x: side === 'left' ? -0.35 : 0.35, y: 0, z: 1 },
      });
      chain.upper.quaternion.copy(solved.upperQuaternion);
      chain.forearm.position.set(0, -solved.upperLength, 0);
      chain.forearm.quaternion.copy(solved.forearmLocalQuaternion);
      if (chain.hand) {
        chain.hand.position.set(0, -solved.forearmLength, 0);
        if (desiredHandQuaternion) {
          const forearmWorldInRoot = solved.upperQuaternion.clone().multiply(solved.forearmLocalQuaternion);
          chain.hand.quaternion.copy(forearmWorldInRoot.invert().multiply(desiredHandQuaternion));
        } else {
          chain.hand.quaternion.identity();
        }
      }
      applyGuides(chain, solved.upperLength, solved.forearmLength);
      if (side === 'right') {
        state.rightTarget.copy(solved.target);
        state.rightClamped = solved.clamped;
        state.lastRequestedDistance = solved.requestedDistance;
        state.lastConstrainedDistance = solved.constrainedDistance;
      }
      return solved;
    }

    const initialColor = bodyColorHex(speciesId, options.bodyColors);
    for (const side of ['left', 'right']) {
      const fallback = buildFallbackHand(THREE, targetHeight, initialColor);
      fallback.name = `${side}_hand`;
      if (side === 'left') fallback.scale.x *= -1;
      chains[side].forearm.add(fallback);
      chains[side].hand = fallback;
      applySide(side, chains[side].measurements.idleHand);
    }

    const handConfig = handConfigForSpecies(speciesId);
    if (handConfig?.glb) {
      Promise.all(['left', 'right'].map(side => buildGlbHand(THREE, handConfig, {
        speciesId,
        gender,
        bodyColors: options.bodyColors,
        targetHeight,
        assetBase: options.assetBase,
        loadGlbScene: options.loadGlbScene,
      }).then(hand => [side, hand]))).then(results => {
        if (state.disposed) {
          results.forEach(([, hand]) => disposeObjectResources(hand));
          return;
        }
        for (const [side, hand] of results) {
          const chain = chains[side];
          chain.forearm.remove(chain.hand);
          disposeObjectResources(chain.hand);
          hand.name = `${side}_hand`;
          if (side === 'left') hand.scale.x *= -1;
          chain.forearm.add(hand);
          chain.hand = hand;
          applySide(side, side === 'right' ? state.rightTarget : chain.measurements.idleHand);
        }
      }).catch(error => {
        console.warn(`[ProceduralArmAnimation] hand GLB load failed for "${speciesId}" (${handConfig.glb}):`, error);
      });
    }

    function followLocalTarget(localTarget, localQuaternion) {
      const solved = applySide('right', localTarget, localQuaternion);
      return {
        target: solved.target.clone(),
        clamped: solved.clamped,
        requestedDistance: solved.requestedDistance,
        constrainedDistance: solved.constrainedDistance,
      };
    }

    const tempWorldTarget = new THREE.Vector3(); // Reused to avoid allocating in the per-frame world-target bridge.
    const tempParentQuaternion = new THREE.Quaternion();
    function followWorldTarget(worldTarget, worldQuaternion) {
      parent.updateWorldMatrix?.(true, false);
      tempWorldTarget.copy(worldTarget);
      parent.worldToLocal(tempWorldTarget);
      let localQuaternion = null;
      if (worldQuaternion) {
        parent.getWorldQuaternion(tempParentQuaternion);
        localQuaternion = tempParentQuaternion.clone().invert().multiply(worldQuaternion);
      }
      const result = followLocalTarget(tempWorldTarget, localQuaternion);
      const adjustedWorldTarget = result.target.clone(); // Returned to the tool holder so weapon and hand remain coincident.
      parent.localToWorld(adjustedWorldTarget);
      return { ...result, target: adjustedWorldTarget };
    }

    function useIdlePose() {
      applySide('left', chains.left.measurements.idleHand);
      return applySide('right', chains.right.measurements.idleHand);
    }

    function dispose() {
      state.disposed = true;
      parent.remove(root);
      disposeObjectResources(root);
    }

    return {
      group: root,
      followLocalTarget,
      followWorldTarget,
      useIdlePose,
      dispose,
      getDebug: () => ({
        speciesId,
        gender,
        scanSucceeded: anatomy.scanSucceeded !== false,
        armLength: chains.right.measurements.armLength,
        shoulder: chains.right.measurements.shoulder.toArray(),
        requestedDistance: state.lastRequestedDistance,
        constrainedDistance: state.lastConstrainedDistance,
        clamped: state.rightClamped,
        handScale,
        glb: handConfig?.glb || null,
      }),
    };
  }

  window.ProceduralArmAnimation = {
    attach,
    handScaleMultiplierForSpecies,
    setShowBones: visible => { showArmBoneGuides = !!visible; },
    get showBones() { return showArmBoneGuides; },
  };
})();
