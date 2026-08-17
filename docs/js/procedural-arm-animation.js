// Procedural fixed-length arm/hand rig for PNG-plane characters.
//
// The painted arms remain part of the portrait. Invisible two-bone chains carry
// 3D hand meshes. Each hand model owns a reusable tool-grip socket profile;
// species/gender hand scale is a second multiplier applied on top of that model
// scale. Gameplay and the Attack Animation Editor both consume this same layer.
(function (global) {
  'use strict';

  const profileApi = global.HobunjiHandModelProfiles; // Supplies model sockets and the model×species scale stack.
  const activeRigs = new Set(); // Refreshes live rigs after model-profile edits and exposes mobile-friendly diagnostics.
  const pendingAvatars = new Set(); // Defers hand attachment until a newly built avatar has been inserted under its real body root.
  const glbCache = new Map(); // Reuses one decoded GLB scene per resolved model path.
  const rawArmImageCache = new Map(); // Reuses anatomy-layer images for raw opacity shoulder scans.
  const rendererPatchFlag = Symbol.for('hobunji.proceduralHands.rendererPatch'); // Prevents wrapping one Three.js renderer prototype more than once.
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null; // Resolves docs/assets from either game or nested editor pages.
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('./', location.href); // Used for model and raw portrait source URLs.
  let showArmBoneGuides = false; // Toggles invisible-bone helpers in the Attack Animation Editor/debug view.
  let showGripGuides = false; // Toggles the model-local tool socket axes in the configurator.
  let gameDeps = null; // Captured from DevSpawner through player-body-attachment-bridge for live tool-following.

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) {
    return String(value || '').trim().toLowerCase() === 'female' ? 'female' : 'male';
  }

  function speciesAndGender(options = {}) {
    const source = options.appearance || options.profile?.appearance || options.profile?.fighter || {};
    return {
      speciesId: normalizeKey(options.speciesId || source.speciesId || source.species),
      gender: normalizeGender(options.gender || source.gender),
    };
  }

  function modelProfileForSpecies(speciesId) {
    const modelKey = profileApi?.modelKeyForSpecies?.(speciesId) || null; // Identifies which reusable GLB profile the species references.
    const model = modelKey ? profileApi?.data?.models?.[modelKey] || null : null; // Supplies scale, grip, material roles and GLB path.
    return { modelKey, model };
  }

  function resolveAssetPath(path) {
    const raw = String(path || '');
    if (!raw) return raw;
    if (/^(?:https?:|data:|blob:|file:)/i.test(raw)) return raw;
    if (raw.startsWith('/')) return raw;
    if (raw.startsWith('assets/')) return new URL(raw, docsBase).href;
    return new URL(`assets/${raw.replace(/^\.\//, '')}`, docsBase).href;
  }

  function bodyColorHex(speciesId, bodyColors) {
    const reference = typeof global._dyeReferenceHexForSlot === 'function'
      ? global._dyeReferenceHexForSlot('A', speciesId)
      : '#7dc89a';
    const descriptor = bodyColors?.A;
    if (descriptor?.hex) return descriptor.hex;
    if (typeof global._resolveTargetRgbColor === 'function') {
      const rgb = global._resolveTargetRgbColor(descriptor, reference);
      if (Array.isArray(rgb)) {
        return '#' + rgb.slice(0, 3).map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('');
      }
    }
    return reference;
  }

  function roleColor(role, speciesId, bodyColors) {
    const colors = profileApi?.data?.colors || {}; // Supplies globally-authored non-body material colors.
    if (role === 'bone') return colors.bone || '#D8C7A3';
    if (role === 'keratin') return colors.keratin || '#44484D';
    return bodyColorHex(speciesId, bodyColors);
  }

  function markOutline(root) {
    root?.traverse?.(child => { if (child.isMesh) child.layers.enable(1); });
    global.HobunjiOutlines?.markMaterialSeamId?.(root);
  }

  function disposeObjectResources(root) {
    if (!root) return;
    root.traverse?.(child => {
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : (child.material ? [child.material] : []);
      for (const material of materials) material.dispose?.();
    });
  }

  function cloneSceneWithOwnedResources(THREE, source, model, speciesId, bodyColors) {
    const clone = source.clone(true); // Gives each hand its own transforms while sharing only the decoded source scene.
    const remapped = new Map(); // Reuses one new unlit material for meshes that shared an original material.
    clone.traverse(child => {
      if (!child.isMesh) return;
      if (child.geometry) child.geometry = child.geometry.clone();
      const replaceMaterial = material => {
        if (remapped.has(material)) return remapped.get(material);
        const role = model?.materialRoles?.[material?.name] || 'body';
        const next = new THREE.MeshBasicMaterial({ color: roleColor(role, speciesId, bodyColors) });
        next.name = material?.name || `${role}_hand_material`;
        remapped.set(material, next);
        return next;
      };
      child.material = Array.isArray(child.material) ? child.material.map(replaceMaterial) : replaceMaterial(child.material);
      child.castShadow = true;
      child.receiveShadow = true;
    });
    return clone;
  }

  function loaderForThree(THREE) {
    if (typeof THREE?.GLTFLoader === 'function') return Promise.resolve(new THREE.GLTFLoader());
    // The Attack Animation Editor imports Three.js through an import map, so a
    // dynamic addon import resolves to the exact same module instance there.
    return import('three/addons/loaders/GLTFLoader.js').then(module => new module.GLTFLoader());
  }

  function loadGlbScene(THREE, path) {
    const resolvedPath = resolveAssetPath(path); // Becomes the cache key and the URL handed to the matching Three.js loader.
    if (glbCache.has(resolvedPath)) return glbCache.get(resolvedPath);
    const promise = loaderForThree(THREE).then(loader => new Promise((resolve, reject) => {
      loader.load(resolvedPath, gltf => resolve(gltf?.scene || gltf), undefined, reject);
    })).catch(error => {
      glbCache.delete(resolvedPath); // Allows a temporarily missing/failed model to retry after the user fixes the asset and refreshes the profile.
      throw error;
    });
    glbCache.set(resolvedPath, promise);
    return promise;
  }

  function gripTransform(THREE, model, baseTargetHeight, effectiveScale) {
    const grip = model?.toolGrip || {}; // Supplies the reusable model-local socket authored in the configurator.
    const position = grip.position || {};
    const rotation = grip.rotationDeg || {};
    const socketOffset = new THREE.Vector3(
      Number(position.x) || 0,
      Number(position.y) || 0,
      Number(position.z) || 0,
    ).multiplyScalar(baseTargetHeight * effectiveScale); // Grip positions are stored in canonical one-hand-height units and scale with the model.
    const socketQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(Number(rotation.pitch) || 0),
      THREE.MathUtils.degToRad(Number(rotation.yaw) || 0),
      THREE.MathUtils.degToRad(Number(rotation.roll) || 0),
      'YXZ',
    )); // Defines the orientation the tool should have at this point on the model.
    return { socketOffset, socketQuaternion };
  }

  async function buildGlbHand(THREE, modelKey, model, options) {
    const source = await loadGlbScene(THREE, model.glb); // Supplies the decoded model shared by both sides and every character.
    if (!source) throw new Error(`Hand GLB had no scene: ${model.glb}`);
    const clone = cloneSceneWithOwnedResources(THREE, source, model, options.speciesId, options.bodyColors); // Becomes this hand's colored geometry copy.
    clone.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(clone); // Measures raw model dimensions before the reusable profile scale is applied.
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const rawHeight = Math.max(0.000001, size.y);
    const canonicalFit = options.baseTargetHeight / rawHeight; // Normalizes every source GLB to the same one-hand-height reference before authored scale.
    const modelScale = Number(model.scale) > 0 ? Number(model.scale) : 1; // Corrects this GLB's intrinsic authored size.
    const speciesScale = Number(options.speciesScale) > 0 ? Number(options.speciesScale) : 1; // Applies anatomy scaling on top of the model correction.
    const effectiveScale = modelScale * speciesScale; // Explicitly implements final = model profile × species/gender multiplier.
    const finalRawScale = canonicalFit * effectiveScale; // Converts raw GLB units into final character-world units.
    const { socketOffset, socketQuaternion } = gripTransform(THREE, model, options.baseTargetHeight, effectiveScale);

    const centered = new THREE.Group(); // Re-centers arbitrary GLB origins so reusable grip coordinates are stable across imported models.
    clone.position.sub(center);
    centered.add(clone);
    centered.scale.setScalar(finalRawScale);

    const visual = new THREE.Group(); // Inverts the authored socket transform so visual.toolGrip lands exactly on the IK hand node.
    const inverseGrip = socketQuaternion.clone().invert();
    visual.quaternion.copy(inverseGrip);
    visual.position.copy(socketOffset).applyQuaternion(inverseGrip).multiplyScalar(-1);
    visual.add(centered);
    visual.userData.handModelKey = modelKey;
    visual.userData.modelScale = modelScale;
    visual.userData.speciesScale = speciesScale;
    visual.userData.effectiveScale = effectiveScale;
    visual.userData.canonicalFit = canonicalFit;
    visual.userData.gripPosition = { ...(model.toolGrip?.position || {}) };
    visual.userData.gripRotationDeg = { ...(model.toolGrip?.rotationDeg || {}) };
    markOutline(visual);
    return visual;
  }

  function buildFallbackHand(THREE, baseTargetHeight, effectiveScale, color) {
    const finalHeight = baseTargetHeight * effectiveScale; // Keeps fallback geometry on the exact same model×species scale stack as GLBs.
    const geometry = new THREE.SphereGeometry(finalHeight * 0.42, 14, 10);
    geometry.scale(0.72, 1, 0.55);
    const material = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geometry, material);
    const group = new THREE.Group();
    group.add(mesh);
    markOutline(group);
    return group;
  }

  function makeBoneGuide(THREE, color) {
    const guide = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.012, 1, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82, depthTest: false, depthWrite: false }),
    ); // Visualizes an otherwise-invisible arm segment in authoring/debug mode.
    guide.renderOrder = 44;
    guide.frustumCulled = false;
    return guide;
  }

  function makeJointGuide(THREE, color, radius) {
    const guide = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88, depthTest: false, depthWrite: false }),
    ); // Marks shoulder/elbow locations when bone guides are enabled.
    guide.renderOrder = 45;
    guide.frustumCulled = false;
    return guide;
  }

  function makeGripGuide(THREE, size) {
    const guide = new THREE.AxesHelper(size); // Shows the actual tool socket frame used by the selected model profile.
    guide.renderOrder = 60;
    guide.traverse?.(child => { child.material && (child.material.depthTest = false); });
    return guide;
  }

  function attach(THREE, parent, options = {}) {
    if (!THREE || !parent || !global.ArmBones || !profileApi) return null;
    const speciesId = normalizeKey(options.speciesId);
    if (!speciesId) return null;
    const gender = normalizeGender(options.gender);
    const modelHeight = Number(options.modelHeight) || 0.9;
    const anatomy = options.armAttachments || {};
    const fallbackLength = modelHeight * 0.32;
    const root = new THREE.Group(); // Owns both invisible arm chains while inheriting body/root transforms from parent.
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
          Number(source.shoulder?.z) || 0,
        ),
        idleHand: new THREE.Vector3(
          Number.isFinite(Number(source.idleHand?.x)) ? Number(source.idleHand.x) : fallbackX,
          Number.isFinite(Number(source.idleHand?.y)) ? Number(source.idleHand.y) : fallbackY,
          Number(source.idleHand?.z) || 0,
        ),
        armLength: Math.max(modelHeight * 0.05, Number(source.armLength) || fallbackLength),
      };
    }

    function buildChain(side) {
      const measurements = anatomyFor(side); // Supplies this side's fixed shoulder/idle target/reach measurements.
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
      return { side, measurements, shoulder, upper, forearm, shoulderGuide, upperGuide, elbowGuide, forearmGuide, hand: null, gripGuide: null };
    }

    const chains = { left: buildChain('left'), right: buildChain('right') }; // Holds both side-specific IK graph references.
    const state = {
      disposed: false,
      loadGeneration: 0,
      rightTarget: chains.right.measurements.idleHand.clone(),
      rightQuaternion: null,
      rightClamped: false,
      lastRequestedDistance: 0,
      lastConstrainedDistance: 0,
      modelKey: null,
      modelScale: 1,
      speciesScale: 1,
      effectiveScale: 1,
      glb: null,
      loadError: null,
    }; // Tracks live target/profile diagnostics and rejects stale async model loads.

    function applyGuides(chain, upperLength, forearmLength) {
      for (const guide of [chain.shoulderGuide, chain.upperGuide, chain.elbowGuide, chain.forearmGuide]) guide.visible = showArmBoneGuides;
      chain.upperGuide.scale.set(1, upperLength, 1);
      chain.upperGuide.position.y = -upperLength * 0.5;
      chain.forearmGuide.scale.set(1, forearmLength, 1);
      chain.forearmGuide.position.y = -forearmLength * 0.5;
      if (chain.gripGuide) chain.gripGuide.visible = showGripGuides;
    }

    function applySide(side, requestedTarget, desiredHandQuaternion) {
      const chain = chains[side];
      const target = requestedTarget || chain.measurements.idleHand;
      const solved = global.ArmBones.solveTwoBoneArm(THREE, {
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
          const forearmWorldInRoot = solved.upperQuaternion.clone().multiply(solved.forearmLocalQuaternion); // Converts requested socket orientation into this forearm's local frame.
          chain.hand.quaternion.copy(forearmWorldInRoot.invert().multiply(desiredHandQuaternion));
        } else {
          chain.hand.quaternion.identity();
        }
      }
      applyGuides(chain, solved.upperLength, solved.forearmLength);
      if (side === 'right') {
        state.rightTarget.copy(solved.target);
        state.rightQuaternion = desiredHandQuaternion?.clone?.() || null;
        state.rightClamped = solved.clamped;
        state.lastRequestedDistance = solved.requestedDistance;
        state.lastConstrainedDistance = solved.constrainedDistance;
      }
      return solved;
    }

    function installHand(side, hand) {
      const chain = chains[side];
      if (chain.hand) {
        chain.forearm.remove(chain.hand);
        disposeObjectResources(chain.hand);
      }
      hand.name = `${side}_hand_socket`;
      if (side === 'left') hand.scale.x *= -1; // Mirrors the reusable right-hand model for the opposite side.
      const gripGuide = makeGripGuide(THREE, Math.max(0.04, modelHeight * 0.12));
      gripGuide.visible = showGripGuides;
      hand.add(gripGuide);
      chain.gripGuide = gripGuide;
      chain.forearm.add(hand);
      chain.hand = hand;
      applySide(side, side === 'right' ? state.rightTarget : chain.measurements.idleHand, side === 'right' ? state.rightQuaternion : null);
    }

    function fallbackProfileValues() {
      const { modelKey, model } = modelProfileForSpecies(speciesId);
      const modelScale = Number(model?.scale) > 0 ? Number(model.scale) : 1;
      const speciesScale = Number(profileApi.speciesScaleFor(speciesId, gender)) || 1;
      return { modelKey, model, modelScale, speciesScale, effectiveScale: modelScale * speciesScale };
    }

    function installFallbackHands(values) {
      const baseTargetHeight = modelHeight * (Number(profileApi.data?.handHeightFraction) || 0.12);
      const color = bodyColorHex(speciesId, options.bodyColors);
      for (const side of ['left', 'right']) installHand(side, buildFallbackHand(THREE, baseTargetHeight, values.effectiveScale, color));
    }

    async function refreshModelProfile() {
      const generation = ++state.loadGeneration; // Invalidates any earlier GLB load that finishes after a newer profile edit.
      const values = fallbackProfileValues();
      state.modelKey = values.modelKey;
      state.modelScale = values.modelScale;
      state.speciesScale = values.speciesScale;
      state.effectiveScale = values.effectiveScale;
      state.glb = values.model?.glb || null;
      state.loadError = null;
      installFallbackHands(values);
      if (!values.model?.glb) return;
      const baseTargetHeight = modelHeight * (Number(profileApi.data?.handHeightFraction) || 0.12);
      try {
        const results = await Promise.all(['left', 'right'].map(async side => [side, await buildGlbHand(THREE, values.modelKey, values.model, {
          speciesId,
          gender,
          bodyColors: options.bodyColors,
          baseTargetHeight,
          speciesScale: values.speciesScale,
        })]));
        if (state.disposed || generation !== state.loadGeneration) {
          for (const [, hand] of results) disposeObjectResources(hand);
          return;
        }
        for (const [side, hand] of results) installHand(side, hand);
      } catch (error) {
        if (generation !== state.loadGeneration || state.disposed) return;
        state.loadError = error?.message || String(error);
        console.warn(`[ProceduralArmAnimation] hand GLB load failed for "${speciesId}" (${values.model.glb}):`, error);
      }
    }

    installFallbackHands(fallbackProfileValues());
    refreshModelProfile();

    function followLocalTarget(localTarget, localQuaternion) {
      const solved = applySide('right', localTarget, localQuaternion);
      return {
        target: solved.target.clone(),
        clamped: solved.clamped,
        requestedDistance: solved.requestedDistance,
        constrainedDistance: solved.constrainedDistance,
      };
    }

    const tempWorldTarget = new THREE.Vector3(); // Reused by the per-frame world-target bridge to avoid one allocation before IK.
    const tempParentQuaternion = new THREE.Quaternion(); // Reused to convert world tool orientation into the body root's local space.
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
      const adjustedWorldTarget = result.target.clone(); // Returns the reachable grip point so the caller can keep tool and palm coincident.
      parent.localToWorld(adjustedWorldTarget);
      return { ...result, target: adjustedWorldTarget };
    }

    function useIdlePose() {
      applySide('left', chains.left.measurements.idleHand);
      return applySide('right', chains.right.measurements.idleHand);
    }

    function dispose() {
      if (state.disposed) return;
      state.disposed = true;
      state.loadGeneration++;
      activeRigs.delete(api);
      parent.remove(root);
      disposeObjectResources(root);
    }

    const api = {
      group: root,
      avatarRoot: options.avatarRoot || null,
      parent,
      speciesId,
      gender,
      followLocalTarget,
      followWorldTarget,
      useIdlePose,
      refreshModelProfile,
      dispose,
      getDebug: () => ({
        speciesId,
        gender,
        scanSucceeded: anatomy.scanSucceeded !== false,
        scanRule: anatomy.rule || 'fallback shoulder directly above tool attach',
        armLength: chains.right.measurements.armLength,
        shoulder: chains.right.measurements.shoulder.toArray(),
        requestedDistance: state.lastRequestedDistance,
        constrainedDistance: state.lastConstrainedDistance,
        clamped: state.rightClamped,
        modelKey: state.modelKey,
        modelScale: state.modelScale,
        speciesScale: state.speciesScale,
        effectiveScale: state.effectiveScale,
        glb: state.glb,
        toolGrip: profileApi?.data?.models?.[state.modelKey]?.toolGrip || null,
        loadError: state.loadError,
      }),
    }; // Public rig handle stored on the avatar for game/editor discovery and visible diagnostics.
    activeRigs.add(api);
    return api;
  }

  function portraitPointToLocal(point, modelWidth, modelHeight, placementRatio, anchorZ) {
    if (!point || !Number.isFinite(Number(point.xRatio)) || !Number.isFinite(Number(point.yRatio))) return null;
    return {
      x: -modelWidth / 2 + Number(point.xRatio) * modelWidth,
      y: modelHeight * (0.5 + placementRatio - Number(point.yRatio)),
      z: anchorZ,
    };
  }

  function armAttachmentsFromCanvas(sourceCanvas, avatarRoot) {
    const modelWidth = Number(avatarRoot?.userData?.portraitModelWidth) || 0.9;
    const modelHeight = Number(avatarRoot?.userData?.portraitModelHeight) || 0.9;
    const placementRatio = Number(avatarRoot?.userData?.portraitVerticalPlacementRatio) || 0.5;
    const handAttachX = Number(avatarRoot?.userData?.handAttachX) || -modelWidth / 2;
    const handAttachY = Number(avatarRoot?.userData?.handAttachY) || modelHeight * 0.45;
    const anchorZ = 0;
    const scan = sourceCanvas?.hobunjiArmAttachmentScan || null; // Prefers the raw anatomy-layer scan installed below.
    const fallbackLength = modelHeight * 0.32;
    const rightShoulder = portraitPointToLocal(scan?.right?.shoulder, modelWidth, modelHeight, placementRatio, anchorZ)
      || { x: handAttachX, y: handAttachY + fallbackLength, z: anchorZ };
    const leftShoulder = portraitPointToLocal(scan?.left?.shoulder, modelWidth, modelHeight, placementRatio, anchorZ)
      || { x: -handAttachX, y: handAttachY + fallbackLength, z: anchorZ };
    const leftHand = portraitPointToLocal(scan?.left?.hand, modelWidth, modelHeight, placementRatio, anchorZ)
      || { x: -handAttachX, y: handAttachY, z: anchorZ };
    const armLength = Math.max(modelHeight * 0.05, rightShoulder.y - handAttachY); // Implements the requested shoulder-Y minus canonical tool-attach-Y reach.
    return {
      left: { shoulder: leftShoulder, idleHand: leftHand, armLength },
      right: { shoulder: rightShoulder, idleHand: { x: handAttachX, y: handAttachY, z: anchorZ }, armLength },
      scanSucceeded: !!(scan?.left && scan?.right),
      rule: scan?.rule || 'fallback shoulder directly above tool attach',
      source: scan,
    };
  }

  function rawLayerXform(layer) {
    // Base arm layers normally carry explicit ax/ay/sx/sy. If a future layer
    // only names a preset, preserve neutral defaults instead of guessing a
    // private portrait-utils preset table from outside the canonical renderer.
    return {
      ax: Number(layer?.ax) || 0,
      ay: Number(layer?.ay) || 0,
      sx: Number.isFinite(Number(layer?.sx)) ? Number(layer.sx) : 1,
      sy: Number.isFinite(Number(layer?.sy)) ? Number(layer.sy) : 1,
    };
  }

  function loadRawArmImage(layerUrl) {
    const raw = String(layerUrl || '');
    if (!raw) return Promise.resolve(null);
    const url = /^(?:https?:|data:|blob:|file:)/i.test(raw)
      ? raw
      : raw.startsWith('assets/')
        ? new URL(raw, docsBase).href
        : new URL(`assets/${raw.replace(/^\.\//, '')}`, docsBase).href;
    if (rawArmImageCache.has(url)) return rawArmImageCache.get(url);
    const promise = new Promise(resolve => {
      const image = new Image(); // Reads only the raw arm sprite, so clothing/hair/head pixels can never move the shoulder scan.
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    rawArmImageCache.set(url, promise);
    return promise;
  }

  function scanArmLayerAttachment(img, xform, alphaThreshold = 8) {
    if (!img?.naturalWidth || !img?.naturalHeight) return null;
    const scratch = document.createElement('canvas'); // Provides a readable alpha buffer for this one raw anatomy layer.
    scratch.width = img.naturalWidth;
    scratch.height = img.naturalHeight;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    let pixels;
    try { pixels = ctx.getImageData(0, 0, scratch.width, scratch.height).data; }
    catch (_) { return null; }
    const rowCenter = y => {
      let alphaSum = 0;
      let weightedX = 0;
      const rowOffset = y * scratch.width * 4;
      for (let x = 0; x < scratch.width; x++) {
        const alpha = pixels[rowOffset + x * 4 + 3];
        if (alpha <= alphaThreshold) continue;
        alphaSum += alpha;
        weightedX += (x + 0.5) * alpha;
      }
      return alphaSum > 0 ? weightedX / alphaSum : null;
    };
    let topY = null, topX = null, bottomY = null, bottomX = null;
    for (let y = 0; y < scratch.height; y++) {
      const x = rowCenter(y);
      if (x == null) continue;
      topY = y + 0.5; topX = x; break;
    }
    for (let y = scratch.height - 1; y >= 0; y--) {
      const x = rowCenter(y);
      if (x == null) continue;
      bottomY = y + 0.5; bottomX = x; break;
    }
    if (topY == null || bottomY == null) return null;
    const portraitW = 200; // Matches portrait-utils' logical PORTRAIT_CW used by all source-layer transforms.
    const portraitH = 200; // Matches portrait-utils' logical PORTRAIT_CH used by all source-layer transforms.
    const portraitL = 200; // Matches portrait-utils' logical PORTRAIT_L scale for source layers.
    const { ax, ay, sx, sy } = xform;
    const layerH = portraitL * sy;
    const layerW = (img.naturalWidth / img.naturalHeight) * portraitL * sx;
    const layerCenterX = portraitW / 2 + ay * portraitL;
    const layerCenterY = portraitH / 2 - ax * portraitL;
    const toPortraitPoint = (sourceX, sourceY) => ({
      xRatio: (layerCenterX - layerW / 2 + sourceX / img.naturalWidth * layerW) / portraitW,
      yRatio: (layerCenterY - layerH / 2 + sourceY / img.naturalHeight * layerH) / portraitH,
    });
    return {
      firstOpaque: toPortraitPoint(topX, topY),
      lastOpaque: toPortraitPoint(bottomX, bottomY),
      sourcePixels: { first: { x: topX, y: topY }, last: { x: bottomX, y: bottomY } },
    };
  }

  async function attachRawArmScan(canvas, profile, renderOptions = {}) {
    if (!canvas || renderOptions.onlyHeadSprite === true || renderOptions.portraitView === 'behind' || renderOptions.view === 'behind') return;
    const bodyLayers = profile?.fighter?.bodyLayers || []; // Supplies uncomposited left/right anatomy sprites for the exact requested scan.
    const leftLayers = bodyLayers.filter(layer => String(layer?.id || '').toLowerCase().includes('arml'));
    const rightLayers = bodyLayers.filter(layer => String(layer?.id || '').toLowerCase().includes('armr'));
    const scanSide = async entries => {
      for (const layer of entries) {
        const image = await loadRawArmImage(layer.url);
        const scan = scanArmLayerAttachment(image, rawLayerXform(layer), 8);
        if (!scan) continue;
        return {
          shoulder: { xRatio: scan.firstOpaque.xRatio, yRatio: scan.firstOpaque.yRatio + 0.10 }, // Moves first opaque pixel down by 10% of portrait height per the authored arm rule.
          hand: scan.lastOpaque,
          sourcePixels: scan.sourcePixels,
          sourceUrl: layer.url,
        };
      }
      return null;
    };
    const [left, right] = await Promise.all([scanSide(leftLayers), scanSide(rightLayers)]);
    canvas.hobunjiArmAttachmentScan = {
      left,
      right,
      rule: 'downward raw-arm opacity scan; shoulder = first opaque pixel + 10% portrait height',
    };
  }

  function patchPortraitRenderer() {
    const preview = global.NpcAvatarPreview;
    if (!preview?.renderProfileToCanvas || preview.renderProfileToCanvas.__hobunjiHandScanWrapped) return;
    const original = preview.renderProfileToCanvas.bind(preview); // Preserves the canonical ranged/neck-era portrait renderer untouched.
    const wrapped = async function handScanAwareRender(canvas, profile, renderOptions) {
      const result = await original(canvas, profile, renderOptions);
      try { await attachRawArmScan(canvas, profile, renderOptions || {}); }
      catch (error) { console.warn('[ProceduralArmAnimation] raw arm scan failed:', error); }
      return result;
    };
    wrapped.__hobunjiHandScanWrapped = true;
    preview.renderProfileToCanvas = wrapped;
  }

  function ensureAvatarRig(avatarRoot, pending) {
    if (!avatarRoot || !pending || !avatarRoot.parent || avatarRoot.userData?.proceduralArmRig) return avatarRoot?.userData?.proceduralArmRig || null;
    const anatomy = armAttachmentsFromCanvas(pending.sourceCanvas, avatarRoot); // Converts raw scan metadata into the floor-anchored frame shared by toolBase and gameplay.
    avatarRoot.userData.armAttachments = anatomy;
    const bodyParent = avatarRoot.parent; // Matches the old direct integrations: playerMesh/NPC root/editor rig, not the offset avatar child itself.
    const rig = attach(pending.THREE, bodyParent, {
      speciesId: pending.speciesId,
      gender: pending.gender,
      bodyColors: pending.bodyColors,
      modelHeight: avatarRoot.userData?.portraitModelHeight,
      handAttachX: avatarRoot.userData?.handAttachX,
      handAttachY: avatarRoot.userData?.handAttachY,
      armAttachments: anatomy,
      name: avatarRoot.name || pending.name || 'avatar',
      avatarRoot,
    });
    if (rig) avatarRoot.userData.proceduralArmRig = rig;
    return rig;
  }

  function processPendingAvatars(THREE) {
    for (const avatarRoot of [...pendingAvatars]) {
      const pending = avatarRoot?.userData?.proceduralHandPending;
      if (!avatarRoot || !pending) { pendingAvatars.delete(avatarRoot); continue; }
      if (pending.THREE !== THREE) continue;
      if (!avatarRoot.parent) continue;
      ensureAvatarRig(avatarRoot, pending);
      pendingAvatars.delete(avatarRoot);
    }
  }

  function patchAvatarBuilder() {
    const api = global.PNGPlaneAvatar;
    if (!api?.buildSinglePlaneAvatarModel || api.buildSinglePlaneAvatarModel.__hobunjiHandsWrapped) return;
    const originalBuild = api.buildSinglePlaneAvatarModel.bind(api); // Keeps the current neck/ranged avatar implementation as the authoritative builder.
    const wrappedBuild = function handAwareAvatarBuild(THREE, sourceCanvas, options = {}) {
      const avatarRoot = originalBuild(THREE, sourceCanvas, options);
      const identity = speciesAndGender(options);
      if (!avatarRoot || !identity.speciesId || !profileApi?.modelKeyForSpecies?.(identity.speciesId)) return avatarRoot;
      avatarRoot.userData.proceduralHandPending = {
        THREE,
        sourceCanvas,
        speciesId: identity.speciesId,
        gender: identity.gender,
        bodyColors: options.profile?.bodyColors || options.appearance?.bodyColors || options.bodyColors,
        name: options.name,
      }; // Defers attachment until caller places avatarRoot under player/NPC/editor body root.
      pendingAvatars.add(avatarRoot);
      patchRenderer(THREE);
      return avatarRoot;
    };
    wrappedBuild.__hobunjiHandsWrapped = true;
    api.buildSinglePlaneAvatarModel = wrappedBuild;

    if (api.disposeAvatarModel && !api.disposeAvatarModel.__hobunjiHandsWrapped) {
      const originalDispose = api.disposeAvatarModel.bind(api); // Preserves existing material/texture cleanup after removing the external hand sibling rig.
      const wrappedDispose = function handAwareAvatarDispose(avatarRoot) {
        pendingAvatars.delete(avatarRoot);
        avatarRoot?.userData?.proceduralArmRig?.dispose?.();
        if (avatarRoot?.userData) avatarRoot.userData.proceduralArmRig = null;
        return originalDispose(avatarRoot);
      };
      wrappedDispose.__hobunjiHandsWrapped = true;
      api.disposeAvatarModel = wrappedDispose;
    }
  }

  function findEditorToolHolder(rig) {
    const avatarRoot = rig?.avatarRoot;
    const bodyRoot = avatarRoot?.parent;
    if (!bodyRoot) return null;
    // The editor's toolBase is the sibling Object3D that owns a tiny blue
    // Sphere anchor plus toolHolder. Avoid depending on module-scoped names.
    for (const child of bodyRoot.children || []) {
      if (child === avatarRoot || child === rig.group) continue;
      const hasAnchorSphere = (child.children || []).some(candidate => candidate?.isMesh && candidate.geometry?.type === 'SphereGeometry');
      if (!hasAnchorSphere) continue;
      const holder = (child.children || []).find(candidate => !candidate?.isMesh && candidate?.isObject3D);
      if (holder) return holder;
    }
    return null;
  }

  function followRigToTool(rig, toolHolder) {
    if (!rig || !toolHolder?.visible || !toolHolder.parent) {
      rig?.useIdlePose?.();
      return;
    }
    // Use the rig's parent's world-space helpers rather than assuming any one
    // editor/runtime hierarchy shape. Vector/Quaternion constructors come from
    // the live tool holder instance to stay compatible with r128/r165 callers.
    const worldPosition = toolHolder.getWorldPosition(new toolHolder.position.constructor()); // Supplies the requested palm/tool grip point.
    const QuaternionCtor = toolHolder.quaternion.constructor; // Supplies the matching Three.js Quaternion class for this scene.
    const worldQuaternion = toolHolder.getWorldQuaternion(new QuaternionCtor());
    const result = rig.followWorldTarget(worldPosition, worldQuaternion);
    if (!result?.clamped) return;
    const adjustedLocal = result.target.clone(); // Converts the reach-constrained socket back into toolHolder.parent local coordinates.
    toolHolder.parent.worldToLocal(adjustedLocal);
    toolHolder.position.copy(adjustedLocal);
  }

  function updateEditorRigs() {
    if (!/\/tools\/attack-animation-editor\//.test(location.pathname)) return;
    for (const rig of activeRigs) {
      if (!rig?.avatarRoot?.isObject3D || !rig.avatarRoot.parent) continue;
      const toolHolder = findEditorToolHolder(rig);
      if (toolHolder) followRigToTool(rig, toolHolder);
    }
  }

  function findPlayerRig() {
    const playerMesh = gameDeps?.playerMesh;
    if (!playerMesh) return null;
    let found = null;
    playerMesh.traverse?.(node => {
      if (!found && node?.userData?.proceduralArmRig) found = node.userData.proceduralArmRig;
    });
    return found;
  }

  function updateGamePlayerRig() {
    if (!gameDeps) return;
    const rig = findPlayerRig();
    if (!rig) return;
    const toolHolder = gameDeps.toolHolder;
    followRigToTool(rig, toolHolder);
  }

  function patchRenderer(THREE) {
    const proto = THREE?.WebGLRenderer?.prototype;
    if (!proto || proto[rendererPatchFlag]) return;
    const originalRender = proto.render; // Preserves the exact current renderer while adding one pre-render hand synchronization pass.
    Object.defineProperty(proto, rendererPatchFlag, { value: true, configurable: false });
    proto.render = function handAwareRender(scene, camera) {
      processPendingAvatars(THREE);
      updateGamePlayerRig();
      updateEditorRigs();
      return originalRender.call(this, scene, camera);
    };
  }

  function installGameRuntime(injectedDeps) {
    gameDeps = injectedDeps || null;
    const THREE = gameDeps?.toolHolder?.position?.constructor ? global.THREE : null; // Used only to opportunistically patch classic Three.js before the first avatar build does it itself.
    if (THREE) patchRenderer(THREE);
  }

  function refreshAllProfiles() {
    for (const rig of [...activeRigs]) rig.refreshModelProfile?.();
  }

  profileApi?.subscribe?.(refreshAllProfiles);
  patchPortraitRenderer();
  patchAvatarBuilder();

  global.ProceduralArmAnimation = {
    attach,
    installGameRuntime,
    refreshAllProfiles,
    setShowBones(visible) { showArmBoneGuides = !!visible; },
    setShowGripGuides(visible) { showGripGuides = !!visible; },
    get showBones() { return showArmBoneGuides; },
    get showGripGuides() { return showGripGuides; },
    getActiveDebug() { return [...activeRigs].map(rig => rig.getDebug?.()).filter(Boolean); },
    getRigForAvatar(avatarRoot) { return avatarRoot?.userData?.proceduralArmRig || null; },
  };
})(window);
