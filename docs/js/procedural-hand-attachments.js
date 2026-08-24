// Direct 3D hand attachments for PNG-plane characters.
//
// There is deliberately NO arm skeleton, IK, shoulder tracking, elbow, reach clamp,
// forearm solve, or portrait arm weighting here. Each GLB keeps its authored origin.
// The right hand is placed directly from the held tool's primary grip frame; the
// left hand either rests at the avatar hand attachment or follows an optional
// tool-authored secondary grip frame supplied by hand-tool-grips.js.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  if (!profiles) return;

  const activeRigs = new Set();
  const glbCache = new Map();
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('./', location.href);
  const IDLE_MEDIAL_YAW_DEG = 90;
  const RIGHT_SHOULDER_AXIS_TWIST_DEG = 180; // Applied to the right visual around local +Y, the wrist-to-shoulder axis used below.
  let showGripGuides = false;
  let gameDeps = null;

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) {
    const gender = String(value || '').trim().toLowerCase();
    return gender === 'female' || gender === 'f' ? 'female' : 'male';
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
    const colors = profiles.data?.colors || {};
    if (role === 'bone') return colors.bone || '#D8C7A3';
    if (role === 'keratin') return colors.keratin || '#44484D';
    return bodyColorHex(speciesId, bodyColors);
  }

  const handSurfaceTextureCache = new Map(); // role/species/color -> shared authored CanvasTexture
  const handSurfaceSourcePromises = new Map(); // resolved PNG URL -> Promise<HTMLImageElement>

  function bodyReferenceHex(speciesId) {
    return typeof global._dyeReferenceHexForSlot === 'function'
      ? global._dyeReferenceHexForSlot('A', speciesId)
      : '#7dc89a';
  }

  function flatTintCanvas(hex) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = hex || '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function localHandPatternTintCanvas(img, targetHex) {
    try {
      const raw = String(targetHex || '#808080').replace(/^#/, '');
      if (!/^[0-9a-f]{6}$/i.test(raw)) return img;
      const tr = parseInt(raw.slice(0, 2), 16), tg = parseInt(raw.slice(2, 4), 16), tb = parseInt(raw.slice(4, 6), 16);
      const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
      const canvas = Object.assign(document.createElement('canvas'), { width, height });
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height), data = imageData.data;
      const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const values = [];
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 8) { const l = lum(data[i], data[i + 1], data[i + 2]); if (l > 0.08) values.push(l); }
      if (values.length < 8) return img;
      values.sort((a, b) => a - b);
      const at = q => values[Math.max(0, Math.min(values.length - 1, Math.round((values.length - 1) * q)))];
      const low = at(0.10), high = at(0.90), span = high - low;
      if (!(span > 0.015)) return img;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        const l = lum(data[i], data[i + 1], data[i + 2]);
        if (l <= 0.08) continue;
        const shade = Math.max(0.72, Math.min(1.18, l / 0.55));
        data[i] = Math.max(0, Math.min(255, Math.round(tr * shade)));
        data[i + 1] = Math.max(0, Math.min(255, Math.round(tg * shade)));
        data[i + 2] = Math.max(0, Math.min(255, Math.round(tb * shade)));
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas;
    } catch (error) {
      console.warn('[ProceduralHandAttachments] local patterned tint fallback failed; using authored PNG unchanged:', error);
      return img;
    }
  }

  function loadHandSurfaceSource(sourcePath) {
    const resolvedPath = resolveAssetPath(sourcePath);
    if (handSurfaceSourcePromises.has(resolvedPath)) return handSurfaceSourcePromises.get(resolvedPath);
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      // Must be set before src: tinting reads the decoded PNG through getImageData().
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load ${sourcePath} for procedural hands`));
      image.src = resolvedPath;
    }).catch(error => {
      handSurfaceSourcePromises.delete(resolvedPath);
      throw error;
    });
    handSurfaceSourcePromises.set(resolvedPath, promise);
    return promise;
  }

  function handSurfaceTexture(THREE, role, speciesId, bodyColors) {
    if (role !== 'body' && role !== 'bone') return null;
    const referenceHex = bodyReferenceHex(speciesId);
    const isBody = role === 'body';
    const sourcePath = isBody
      ? 'assets/textures/canvas.png'
      : 'assets/textures/carved_smooth.png';
    const descriptor = isBody
      ? (bodyColors?.A || { hex: referenceHex })
      : { hex: profiles.data?.colors?.bone || '#D8C7A3' };
    const resolvedHex = isBody ? bodyColorHex(speciesId, bodyColors) : descriptor.hex;
    const tintSpeciesId = isBody ? speciesId : '';
    const spriteTintMode = isBody && typeof global.bodyTintModeForSpecies === 'function'
      ? global.bodyTintModeForSpecies(speciesId)
      : 'shadeFill';
    const cacheKey = `${role}:${normalizeKey(speciesId)}:${spriteTintMode}:${String(resolvedHex).toLowerCase()}`;
    if (handSurfaceTextureCache.has(cacheKey)) return handSurfaceTextureCache.get(cacheKey);

    const textureName = `${normalizeKey(speciesId) || 'avatar'}_hand_${role}_${sourcePath.split('/').pop().replace(/\.png$/i, '')}`;
    const spritePngSurface = global.HobunjiSpritePngSurface || global.HobunjiPngPlaneUnlit;
    const texture = spritePngSurface?.configureTexture
      ? spritePngSurface.configureTexture(THREE, new THREE.CanvasTexture(flatTintCanvas(resolvedHex)), textureName)
      : new THREE.CanvasTexture(flatTintCanvas(resolvedHex));
    if (!spritePngSurface?.configureTexture) {
      texture.name = textureName;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
    }
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1, 1);
    texture.userData = Object.assign({}, texture.userData, {
      hobunjiAuthoredSurfacePath: sourcePath,
      hobunjiAuthoredSurfaceState: 'flat-loading',
      hobunjiAuthoredSurfaceImageSize: 'none',
      hobunjiAuthoredSurfaceError: null,
    });
    handSurfaceTextureCache.set(cacheKey, texture);

    loadHandSurfaceSource(sourcePath).then(image => {
      let source = null;
      let sourceState = 'authored-png-raw-fallback';
      let sourceError = null;
      const spritePng = global.HobunjiSpritePngSurface;
      const tintSurfaceCanvas = spritePng?.tintSurfaceCanvas || spritePng?.tintBodyCanvas || global.getBodyTintedCanvas;
      if (typeof tintSurfaceCanvas === 'function') {
        try {
          source = tintSurfaceCanvas(image, sourcePath, descriptor, tintSpeciesId, 'A') || null;
          if (source) sourceState = 'authored-png-tinted';
        } catch (error) { sourceError = error; }
      }
      if (!source) {
        source = localHandPatternTintCanvas(image, resolvedHex);
        sourceState = source === image ? 'authored-png-raw-fallback' : 'authored-png-local-tint';
      }
      texture.image = source;
      texture.userData = Object.assign({}, texture.userData, {
        hobunjiAuthoredSurfaceState: sourceState,
        hobunjiAuthoredSurfaceImageSize: `${image.naturalWidth || image.width}x${image.naturalHeight || image.height}`,
        hobunjiAuthoredSurfaceError: sourceError ? String(sourceError?.message || sourceError) : null,
      });
      texture.needsUpdate = true;
    }).catch(error => {
      texture.userData = Object.assign({}, texture.userData, {
        hobunjiAuthoredSurfaceState: 'flat-load-failure',
        hobunjiAuthoredSurfaceError: String(error?.message || error),
      });
      console.warn('[ProceduralHandAttachments] authored hand surface PNG failed to load; flat fallback remains visible:', sourcePath, error);
    });
    return texture;
  }
  function markOutline(root) {
    root?.traverse?.(child => {
      if (!child.isMesh) return;
      if (child.userData?.noOutline === true) return;
      child.layers.enable(1);
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) continue;
        material.side = child.material?.constructor?.DoubleSide || material.side;
      }
      global.HobunjiOutlines?.markMaterialSeamId?.(child);
    });
  }

  function disposeObjectResources(root) {
    root?.traverse?.(child => {
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : (child.material ? [child.material] : []);
      for (const material of materials) material?.dispose?.();
    });
  }

  function loaderForThree(THREE) {
    if (typeof THREE?.GLTFLoader === 'function') return Promise.resolve(new THREE.GLTFLoader());
    if (/\/tools\/animation-author\//.test(location.pathname)) {
      const configuredThreeUrl = global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.threeModuleUrl || 'https://esm.sh/three@0.165.0'; // Keeps the author's GLTF loader on the exact Three.js module version used by its preview scene.
      const version = configuredThreeUrl.match(/three@([0-9.]+)/)?.[1] || '0.165.0';
      return import(`https://esm.sh/three@${version}/examples/jsm/loaders/GLTFLoader.js?deps=three@${version}`)
        .then(module => new module.GLTFLoader());
    }
    return import('three/addons/loaders/GLTFLoader.js').then(module => new module.GLTFLoader());
  }

  function loadGlbScene(THREE, path) {
    const resolved = resolveAssetPath(path);
    if (glbCache.has(resolved)) return glbCache.get(resolved);
    const promise = loaderForThree(THREE).then(loader => new Promise((resolve, reject) => {
      loader.load(resolved, gltf => resolve(gltf?.scene || gltf), undefined, reject);
    })).catch(error => {
      glbCache.delete(resolved);
      throw error;
    });
    glbCache.set(resolved, promise);
    return promise;
  }

  function cloneSceneWithOwnedResources(THREE, source, modelKey, model, speciesId, bodyColors) {
    const clone = source.clone(true);
    const remapped = new Map();
    clone.traverse(child => {
      if (!child.isMesh) return;
      if (child.geometry) {
        child.geometry = child.geometry.clone();
        ensureHandSurfaceUvs(THREE, child.geometry);
      }
      const replaceMaterial = material => {
        if (remapped.has(material)) return remapped.get(material);
        const role = model?.materialRoles?.[material?.name] || 'body';
        const isParrotWingLayer = modelKey === 'parrot' && role === 'body'; // Lets the portrait's opaque wing/clothing pixels cover the modeled wing continuation.
        const surfaceTexture = (role === 'body' || role === 'bone') ? handSurfaceTexture(THREE, role, speciesId, bodyColors) : null; // Body uses canvas.png; pachyderm/sloth bone-role claws/nails use carved_smooth.png.
        const materialName = material?.name || `${role}_hand_material`;
        const spritePngSurface = global.HobunjiSpritePngSurface || global.HobunjiPngPlaneUnlit;
        const next = spritePngSurface?.makeMaterial
          ? spritePngSurface.makeMaterial(THREE, surfaceTexture, materialName, {
              color: surfaceTexture ? 0xffffff : roleColor(role, speciesId, bodyColors),
              side: THREE.DoubleSide, // closed/turned hand geometry needs both sides; all other plane flags stay canonical
              depthWrite: !isParrotWingLayer,
            })
          : new THREE.MeshBasicMaterial({
              color: surfaceTexture ? 0xffffff : roleColor(role, speciesId, bodyColors),
              map: surfaceTexture,
              transparent: true,
              alphaTest: 0.001,
              side: THREE.DoubleSide,
              depthTest: true,
              depthWrite: !isParrotWingLayer,
              opacity: 1,
            });
        next.name = materialName;
        next.userData.hobunjiHandRole = role;
        next.userData.hobunjiHandSurfaceTexture = surfaceTexture ? (role === 'bone' ? 'carved_smooth.png' : 'canvas.png') : null;
        next.userData.hobunjiPortraitOccludedWingLayer = isParrotWingLayer;
        remapped.set(material, next);
        return next;
      };
      child.material = Array.isArray(child.material) ? child.material.map(replaceMaterial) : replaceMaterial(child.material);
      const ownedMaterials = Array.isArray(child.material) ? child.material : [child.material]; // Used here to tag the already-split GLTFLoader primitive for render-pass routing.
      const isParrotWingMesh = modelKey === 'parrot'
        && ownedMaterials.length > 0
        && ownedMaterials.every(material => material?.userData?.hobunjiHandRole === 'body');
      if (isParrotWingMesh) {
        child.userData = { ...child.userData, hobunjiHandRole: 'body-wing', hobunjiPortraitOccludedWingLayer: true, noOutline: true };
      }
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.userData?.noOutline !== true) child.layers.enable(1);
    });
    return clone;
  }

  async function buildGlbHand(THREE, modelKey, model, options, side) {
    const source = await loadGlbScene(THREE, model.glb);
    if (!source) throw new Error(`Hand GLB had no scene: ${model.glb}`);
    const clone = cloneSceneWithOwnedResources(THREE, source, modelKey, model, options.speciesId, options.bodyColors);

    // Measure only to preserve the existing hand-height normalization. Do NOT
    // recenter the clone: the GLB's own 0,0,0 is the authored grip/origin and is
    // therefore the point that must land on the tool socket.
    clone.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(clone);
    const size = bounds.getSize(new THREE.Vector3());
    const rawHeight = Math.max(0.000001, size.y);
    const modelScale = Number(model.scale) > 0 ? Number(model.scale) : 1;
    const speciesScale = Number(options.speciesScale) > 0 ? Number(options.speciesScale) : 1;
    const canonicalFit = options.baseTargetHeight / rawHeight;
    const finalScale = canonicalFit * modelScale * speciesScale;

    // mirrorX=true means the source is the authored LEFT hand: left keeps the
    // source geometry and right mirrors it across local X. false reverses that.
    const sourceIsLeft = model.mirrorX !== false;
    const mirrorSign = side === 'right'
      ? (sourceIsLeft ? -1 : 1)
      : (sourceIsLeft ? 1 : -1);
    clone.scale.set(finalScale * mirrorSign, finalScale, finalScale);

    const group = new THREE.Group();
    group.name = `${side}_hand_visual`;
    group.add(clone);
    if (side === 'right') group.rotation.y = THREE.MathUtils.degToRad(RIGHT_SHOULDER_AXIS_TWIST_DEG);
    group.userData.handModelKey = modelKey;
    group.userData.modelScale = modelScale;
    group.userData.speciesScale = speciesScale;
    group.userData.canonicalFit = canonicalFit;
    group.userData.authoredOriginPreserved = true;
    group.userData.shoulderAxisTwistDeg = side === 'right' ? RIGHT_SHOULDER_AXIS_TWIST_DEG : 0;
    markOutline(group);
    return group;
  }

  function buildFallbackHand(THREE, size, color, side, sourceIsLeft, speciesId, bodyColors) {
    const geometry = new THREE.SphereGeometry(size * 0.42, 14, 10);
    geometry.scale(0.72, 1, 0.55);
    const bodyTexture = handSurfaceTexture(THREE, 'body', speciesId, bodyColors); // Generated fallback hands use the same canvas.png body surface as GLB hands.
    const materialName = `${normalizeKey(speciesId) || 'avatar'}_hand_body`;
    const spritePngSurface = global.HobunjiSpritePngSurface || global.HobunjiPngPlaneUnlit;
    const material = spritePngSurface?.makeMaterial
      ? spritePngSurface.makeMaterial(THREE, bodyTexture, materialName, {
          color: bodyTexture ? 0xffffff : color,
          side: THREE.DoubleSide,
        })
      : new THREE.MeshBasicMaterial({
          color: bodyTexture ? 0xffffff : color,
          map: bodyTexture,
          transparent: true,
          alphaTest: 0.001,
          side: THREE.DoubleSide,
          depthTest: true,
          depthWrite: true,
          opacity: 1,
        });
    material.name = materialName;
    material.userData.hobunjiHandRole = 'body';
    material.userData.hobunjiHandSurfaceTexture = 'canvas.png';
    const mesh = new THREE.Mesh(geometry, material);
    const sign = side === 'right' ? (sourceIsLeft ? -1 : 1) : (sourceIsLeft ? 1 : -1);
    mesh.scale.x = sign;
    const group = new THREE.Group();
    group.add(mesh);
    markOutline(group);
    return group;
  }

  function attach(THREE, parent, options = {}) {
    if (!THREE || !parent) return null;
    const speciesId = normalizeKey(options.speciesId);
    if (!speciesId || !profiles.modelKeyForSpecies?.(speciesId)) return null;
    const gender = normalizeGender(options.gender);
    const modelHeight = Number(options.modelHeight) || 0.9;
    const handAttachX = Number.isFinite(Number(options.handAttachX)) ? Number(options.handAttachX) : -modelHeight * 0.28;
    const handAttachY = Number.isFinite(Number(options.handAttachY)) ? Number(options.handAttachY) : modelHeight * 0.45;

    const root = new THREE.Group();
    root.name = `${options.name || 'avatar'}_procedural_hands`;
    parent.add(root);

    const sockets = {};
    for (const side of ['left', 'right']) {
      const socket = new THREE.Group();
      socket.name = `${side}_hand_socket`;
      const guide = new THREE.AxesHelper(Math.max(0.035, modelHeight * 0.09));
      guide.name = `${side}_hand_grip_axes`;
      guide.visible = showGripGuides;
      guide.renderOrder = 60;
      guide.traverse?.(child => {
        if (child.material) {
          child.material.depthTest = false;
          child.material.depthWrite = false;
        }
      });
      socket.add(guide);
      root.add(socket);
      sockets[side] = { socket, guide, visual: null };
    }

    const state = {
      disposed: false,
      loadGeneration: 0,
      modelKey: null,
      modelScale: 1,
      speciesScale: 1,
      effectiveScale: 1,
      glb: null,
      loadError: null,
    };

    const idlePositions = { // Reused authored attachment points copied into free-hand sockets every fallback frame.
      left: new THREE.Vector3(-handAttachX, handAttachY, 0),
      right: new THREE.Vector3(handAttachX, handAttachY, 0),
    };
    const idleQuaternion = new THREE.Quaternion().setFromEuler( // Reused authored medial frame composed with each fallback rotation below.
      new THREE.Euler(0, THREE.MathUtils.degToRad(IDLE_MEDIAL_YAW_DEG), 0, 'YXZ'),
    );
    const fallbackOffset = new THREE.Vector3(); // Reused local position offset keeps free-hand animation allocation-free.
    const fallbackEuler = new THREE.Euler(0, 0, 0, 'YXZ'); // Reused temporary Euler converts procedural degrees to a quaternion.
    const fallbackQuaternion = new THREE.Quaternion(); // Reused locomotion rotation composed after idleQuaternion.

    function setSideIdle(side, fallbackPose = null) {
      const rec = sockets[side];
      const position = fallbackPose?.position || {}; // Optional local locomotion offset applied only while this side has no attachment owner.
      const rotation = fallbackPose?.rotationDeg || {}; // Optional idle/walk rotation composed after the authored medial hand frame.
      fallbackOffset.set(
        Number(position.x) || 0,
        Number(position.y) || 0,
        Number(position.z) || 0,
      );
      fallbackEuler.set(
        THREE.MathUtils.degToRad(Number(rotation.pitch) || 0),
        THREE.MathUtils.degToRad(Number(rotation.yaw) || 0),
        THREE.MathUtils.degToRad(Number(rotation.roll) || 0),
        'YXZ',
      );
      fallbackQuaternion.setFromEuler(fallbackEuler);
      rec.socket.position.copy(idlePositions[side]).add(fallbackOffset);
      rec.socket.quaternion.copy(idleQuaternion).multiply(fallbackQuaternion);
      rec.socket.visible = true;
      rec.socket.updateMatrix?.();
      rec.socket.updateMatrixWorld?.(true);
    }

    function useIdlePose(fallbackPoses = null) {
      setSideIdle('left', fallbackPoses?.left || null);
      setSideIdle('right', fallbackPoses?.right || null);
    }

    function installVisual(side, visual) {
      const rec = sockets[side];
      if (rec.visual) {
        rec.socket.remove(rec.visual);
        disposeObjectResources(rec.visual);
      }
      rec.visual = visual;
      rec.socket.add(visual);
      rec.guide.visible = showGripGuides;
    }

    function profileValues() {
      const modelKey = profiles.modelKeyForSpecies(speciesId);
      const model = modelKey ? profiles.data?.models?.[modelKey] || null : null;
      const modelScale = Number(model?.scale) > 0 ? Number(model.scale) : 1;
      const speciesScale = Number(profiles.speciesScaleFor?.(speciesId, gender)) || 1;
      return { modelKey, model, modelScale, speciesScale, effectiveScale: modelScale * speciesScale };
    }

    function installFallback(values) {
      const baseTargetHeight = modelHeight * (Number(profiles.data?.handHeightFraction) || 0.12);
      const sourceIsLeft = values.model?.mirrorX !== false;
      const color = bodyColorHex(speciesId, options.bodyColors);
      for (const side of ['left', 'right']) {
        installVisual(side, buildFallbackHand(THREE, baseTargetHeight * values.effectiveScale, color, side, sourceIsLeft, speciesId, options.bodyColors));
      }
    }

    async function refreshModelProfile() {
      const generation = ++state.loadGeneration;
      const values = profileValues();
      state.modelKey = values.modelKey;
      state.modelScale = values.modelScale;
      state.speciesScale = values.speciesScale;
      state.effectiveScale = values.effectiveScale;
      state.glb = values.model?.glb || null;
      state.loadError = null;
      installFallback(values);
      if (!values.model?.glb) return;

      const baseTargetHeight = modelHeight * (Number(profiles.data?.handHeightFraction) || 0.12);
      try {
        const built = await Promise.all(['left', 'right'].map(async side => [
          side,
          await buildGlbHand(THREE, values.modelKey, values.model, {
            speciesId,
            bodyColors: options.bodyColors,
            baseTargetHeight,
            speciesScale: values.speciesScale,
          }, side),
        ]));
        if (state.disposed || generation !== state.loadGeneration) {
          for (const [, visual] of built) disposeObjectResources(visual);
          return;
        }
        for (const [side, visual] of built) installVisual(side, visual);
      } catch (error) {
        if (state.disposed || generation !== state.loadGeneration) return;
        state.loadError = error?.message || String(error);
        console.warn(`[ProceduralHandAttachments] model load failed for ${speciesId}:`, error);
      }
    }

    const tempParentQuaternion = new THREE.Quaternion();
    function placeHandWorld(side, worldPosition, worldQuaternion) {
      const rec = sockets[side];
      if (!rec || !worldPosition || !worldQuaternion) return false;
      parent.updateWorldMatrix?.(true, false);
      const localPosition = worldPosition.clone();
      parent.worldToLocal(localPosition);
      parent.getWorldQuaternion(tempParentQuaternion);
      const localQuaternion = tempParentQuaternion.clone().invert().multiply(worldQuaternion);
      rec.socket.position.copy(localPosition);
      rec.socket.quaternion.copy(localQuaternion);
      rec.socket.visible = true;
      rec.socket.updateMatrix?.();
      rec.socket.updateMatrixWorld?.(true);
      return true;
    }

    function setSideVisible(side, visible) {
      if (sockets[side]) sockets[side].socket.visible = !!visible;
    }

    useIdlePose();
    installFallback(profileValues());
    refreshModelProfile();

    const unsubscribe = profiles.subscribe?.(() => refreshModelProfile());

    const api = {
      group: root,
      parent,
      avatarRoot: options.avatarRoot || null,
      speciesId,
      gender,
      placeHandWorld,
      setSideIdle,
      setSideVisible,
      useIdlePose,
      refreshModelProfile,
      dispose() {
        if (state.disposed) return;
        state.disposed = true;
        state.loadGeneration++;
        unsubscribe?.();
        activeRigs.delete(api);
        parent.remove(root);
        disposeObjectResources(root);
      },
      getDebug() {
        return {
          speciesId,
          gender,
          mode: 'direct-tool-attachments',
          noArmIK: true,
          authoredGlbOriginPreserved: true,
          modelKey: state.modelKey,
          modelScale: state.modelScale,
          speciesScale: state.speciesScale,
          effectiveScale: state.effectiveScale,
          glb: state.glb,
          loadError: state.loadError,
          fallbackPoseInput: 'per-side-local-offset',
          rightShoulderAxisTwistDeg: RIGHT_SHOULDER_AXIS_TWIST_DEG,
          parrotBodyLayerPortraitOcclusion: 'depthWrite-disabled',
          bodySurfaceTexture: 'wavy_surface.png',
        };
      },
    };
    activeRigs.add(api);
    return api;
  }

  const publicApi = {
    attach,
    installGameRuntime(injectedDeps) { gameDeps = injectedDeps || null; },
    get gameDeps() { return gameDeps; },
    setShowGripGuides(value) {
      showGripGuides = !!value;
      for (const rig of activeRigs) {
        for (const side of ['left', 'right']) {
          const guide = rig.group?.getObjectByName?.(`${side}_hand_grip_axes`);
          if (guide) guide.visible = showGripGuides;
        }
      }
    },
    getActiveDebug() { return [...activeRigs].map(rig => rig.getDebug()); },
    refreshAllProfiles() { for (const rig of activeRigs) rig.refreshModelProfile?.(); },
    idleMedialYawDeg: IDLE_MEDIAL_YAW_DEG,
    rightShoulderAxisTwistDeg: RIGHT_SHOULDER_AXIS_TWIST_DEG,
  };

  global.ProceduralHandAttachments = publicApi;
  // Temporary name bridge for the existing hand authoring adapters. It aliases
  // the direct hand system only; no arm implementation is loaded or retained.
  global.ProceduralArmAnimation = publicApi;
})(window);
