// Shoulder-rest v5: weight falloff + explicit split-frame layering.
// Loaded after animal-shoulder-rest.js v4 so old authored rigs keep their
// parser/runtime compatibility while the final avatar decorator owns the newer
// hanging-pose semantics.
(() => {
  'use strict';

  const baseApi = window.AnimalShoulderRest;
  if (!baseApi || Number(baseApi.version) < 4 || window.AnimalShoulderRestV5) return;

  const baseNormalizeRest = baseApi.normalizeRest.bind(baseApi); // Captured before the public API is upgraded below.
  const baseSampleHeadInfluence = baseApi.sampleHeadInfluence.bind(baseApi); // Reuses the already-tested Influence sampler.
  const DEG = Math.PI / 180;
  const MAX_ROTATION_DEG = 180;

  function finite(value, fallback) {
    const parsed = Number(value); // Used for authored JSON plus debug-safe runtime values.
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value)); // Shared bounds helper for UVs, weights, and authored angles.
  }

  function normalizeRest(rawRig) {
    const normalized = baseNormalizeRest(rawRig); // Keeps all v4 flags/guide migration while replacing only falloff semantics.
    if (!normalized) return null;
    const raw = rawRig?.shoulderRest || {};
    const migratedFalloff = raw.weightFalloff ?? raw.curveFalloff ?? 0; // The short-lived curveFalloff field migrates as the user's intended weight falloff.
    return {
      ...normalized,
      weightFalloff: clamp(finite(migratedFalloff, 0), 0, 1),
    };
  }

  function guideMetrics(rest, point) {
    const a = rest.guide.a;
    const b = rest.guide.b;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) return null;
    const tx = dx / length;
    const ty = dy / length;
    const nx = -ty;
    const ny = tx;
    const rx = finite(point?.x, 0) - a.x;
    const ry = finite(point?.y, 0) - a.y;
    return {
      a, b, length, tx, ty, nx, ny, rx, ry,
      t: (rx * tx + ry * ty) / length,
      signedOffset: rx * nx + ry * ny,
    };
  }

  // Pure spline geometry. Weight falloff deliberately does NOT alter this path:
  // it only changes how strongly pixels follow the path below.
  function deformNormalizedPoint(point, restLike) {
    const rest = restLike?.guide ? restLike : normalizeRest({ shoulderRest: restLike });
    if (!rest?.guide) return { x: finite(point?.x, 0), y: finite(point?.y, 0) };
    const metrics = guideMetrics(rest, point);
    if (!metrics || metrics.t < 0 || metrics.t > 1) return { x: finite(point?.x, 0), y: finite(point?.y, 0) };

    const full = clamp(finite(rest.fullRotationDeg, 0), -MAX_ROTATION_DEG, MAX_ROTATION_DEG) * DEG;
    const inter = clamp(finite(rest.interVertexRotationDeg, 0), -MAX_ROTATION_DEG, MAX_ROTATION_DEG) * DEG;
    const s = metrics.t * metrics.length;
    let centerAlong;
    let centerNormal;
    let angle;
    if (Math.abs(inter) < 1e-7) {
      angle = full;
      centerAlong = s * Math.cos(full);
      centerNormal = s * Math.sin(full);
    } else {
      const curvature = inter / metrics.length; // Constant curvature: falloff no longer redistributes the curve itself.
      angle = full + inter * metrics.t;
      centerAlong = (Math.sin(angle) - Math.sin(full)) / curvature;
      centerNormal = (-Math.cos(angle) + Math.cos(full)) / curvature;
    }

    const centerX = metrics.a.x + metrics.tx * centerAlong + metrics.nx * centerNormal;
    const centerY = metrics.a.y + metrics.ty * centerAlong + metrics.ny * centerNormal;
    const rotatedNormalAlong = -Math.sin(angle);
    const rotatedNormalNormal = Math.cos(angle);
    const deformedNormalX = metrics.tx * rotatedNormalAlong + metrics.nx * rotatedNormalNormal;
    const deformedNormalY = metrics.ty * rotatedNormalAlong + metrics.ny * rotatedNormalNormal;
    return {
      x: centerX + deformedNormalX * metrics.signedOffset,
      y: centerY + deformedNormalY * metrics.signedOffset,
    };
  }

  function splineWeightForT(t, weightFalloff) {
    const clampedT = clamp(finite(t, 0), 0, 1); // A=0, B=1 along the independently authored guide.
    const falloff = clamp(finite(weightFalloff, 0), 0, 1);
    return clamp(1 - falloff * (1 - clampedT), 0, 1); // 0%=uniform; 100%=zero at A, linear ramp to full at B.
  }

  function deformWeightedPoint(point, headInfluence, restLike) {
    const rest = restLike?.guide ? restLike : normalizeRest({ shoulderRest: restLike });
    if (!rest?.guide) return { x: finite(point?.x, 0), y: finite(point?.y, 0) };
    const metrics = guideMetrics(rest, point);
    if (!metrics || metrics.t < 0 || metrics.t > 1) return { x: finite(point?.x, 0), y: finite(point?.y, 0) };
    const source = { x: finite(point?.x, 0), y: finite(point?.y, 0) };
    const target = deformNormalizedPoint(source, rest);
    const bodyWeight = 1 - clamp(finite(headInfluence, 0), 0, 1); // Existing Head Influence still fights shoulder-rest deformation.
    const weight = bodyWeight * splineWeightForT(metrics.t, rest.weightFalloff);
    return {
      x: source.x + (target.x - source.x) * weight,
      y: source.y + (target.y - source.y) * weight,
    };
  }

  function findRiggedMeshForBone(group, bone) {
    if (!group || !bone) return null;
    return (group.children || []).find(child => child?.isSkinnedMesh && child.skeleton?.bones?.includes?.(bone) && !child.userData?.hobunjiShoulderSplitOverlay) || null;
  }

  function dimensionsForGeometry(geometry) {
    const params = geometry?.parameters || {};
    let width = finite(params.width, 0), height = finite(params.height, 0);
    if (width > 0 && height > 0) return { width, height };
    geometry?.computeBoundingBox?.();
    const box = geometry?.boundingBox;
    width = Math.abs(finite(box?.max?.x, 0) - finite(box?.min?.x, 0));
    height = Math.abs(finite(box?.max?.y, 0) - finite(box?.min?.y, 0));
    return { width: Math.max(width, 1e-6), height: Math.max(height, 1e-6) };
  }

  function buildMeshState(mesh, normalizedRig, rest, mirrorX) {
    const geometry = mesh?.geometry;
    const position = geometry?.getAttribute?.('position');
    const uv = geometry?.getAttribute?.('uv');
    if (!position || !uv || position.count !== uv.count) return null;
    const dimensions = dimensionsForGeometry(geometry); // Converts normalized authored deformation back into plane-local units.
    const basePositions = new Float32Array(position.array); // Immutable bind positions prevent cumulative shoulder-rest drift.
    const headInfluences = new Float32Array(position.count); // Head paint competes directly with the shoulder spline.
    const canonicalPoints = new Float32Array(position.count * 2); // Full rectangular plane; sprite alpha is intentionally irrelevant.
    for (let i = 0; i < position.count; i++) {
      const sourceU = mirrorX ? 1 - uv.getX(i) : uv.getX(i);
      const sourceTopV = 1 - uv.getY(i);
      canonicalPoints[i * 2] = sourceU;
      canonicalPoints[i * 2 + 1] = sourceTopV;
      headInfluences[i] = baseSampleHeadInfluence(normalizedRig, sourceU, sourceTopV);
    }
    return { mesh, position, basePositions, headInfluences, canonicalPoints, dimensions, rest, mirrorX };
  }

  function applyMeshState(meshState, enabled) {
    if (!meshState) return false;
    const { position, basePositions, headInfluences, canonicalPoints, dimensions, rest, mirrorX, mesh } = meshState;
    const hasPose = Math.abs(rest.fullRotationDeg) > 1e-7 || Math.abs(rest.interVertexRotationDeg) > 1e-7;
    for (let i = 0; i < position.count; i++) {
      const offset = i * position.itemSize;
      const baseX = basePositions[offset], baseY = basePositions[offset + 1];
      let x = baseX, y = baseY;
      if (enabled && rest.useSpline && hasPose) {
        const source = { x: canonicalPoints[i * 2], y: canonicalPoints[i * 2 + 1] };
        const target = deformWeightedPoint(source, headInfluences[i], rest);
        const targetLocalU = mirrorX ? 1 - target.x : target.x;
        x = (targetLocalU - 0.5) * dimensions.width;
        y = (0.5 - target.y) * dimensions.height;
      }
      position.array[offset] = x;
      position.array[offset + 1] = y;
      if (position.itemSize > 2) position.array[offset + 2] = basePositions[offset + 2];
    }
    position.needsUpdate = true;
    mesh.geometry.computeBoundingBox?.();
    mesh.geometry.computeBoundingSphere?.();
    return true;
  }

  function cloneMaterialForOverlay(material) {
    const clone = material?.clone?.() || material;
    if (!clone) return clone;
    clone.transparent = true;
    clone.depthWrite = false; // Base/right writes depth first; overlay/left is explicitly drawn afterward.
    clone.polygonOffset = true;
    clone.polygonOffsetFactor = -2;
    clone.polygonOffsetUnits = -2;
    clone.needsUpdate = true;
    return clone;
  }

  function cloneOverlayMesh(THREE, source, suffix) {
    if (!source?.geometry || !source?.skeleton || !source?.parent) return null;
    const geometry = source.geometry.clone(); // Separate positions stay undeformed while skin weights can remain shared with the live head response.
    const sharedSkinWeight = source.geometry.getAttribute?.('skinWeight');
    const sharedSkinIndex = source.geometry.getAttribute?.('skinIndex');
    if (sharedSkinWeight) geometry.setAttribute('skinWeight', sharedSkinWeight);
    if (sharedSkinIndex) geometry.setAttribute('skinIndex', sharedSkinIndex);
    const material = Array.isArray(source.material)
      ? source.material.map(cloneMaterialForOverlay)
      : cloneMaterialForOverlay(source.material);
    const overlay = new THREE.SkinnedMesh(geometry, material);
    overlay.name = `${source.name || 'animal'}_${suffix}`;
    overlay.position.copy(source.position);
    overlay.quaternion.copy(source.quaternion);
    overlay.scale.copy(source.scale);
    overlay.renderOrder = (source.renderOrder || 0) + 20;
    overlay.frustumCulled = false;
    overlay.userData = { ...source.userData, hobunjiShoulderSplitOverlay: true };
    overlay.onBeforeRender = source.onBeforeRender; // Preserves shoulder-pet world-yaw compensation on both visible cards.
    overlay.bindMode = source.bindMode;
    overlay.bind(source.skeleton, source.bindMatrix?.clone?.() || source.bindMatrix);
    overlay.visible = false;
    source.parent.add(overlay);
    return { mesh: overlay, geometry, material, textures: [] };
  }

  function materialsFor(layer) {
    if (!layer?.material) return [];
    return Array.isArray(layer.material) ? layer.material : [layer.material];
  }

  function copyTextureTransform(texture, template) {
    if (!texture || !template) return texture;
    texture.wrapS = template.wrapS;
    texture.wrapT = template.wrapT;
    texture.magFilter = template.magFilter;
    texture.minFilter = template.minFilter;
    texture.flipY = template.flipY;
    texture.premultiplyAlpha = template.premultiplyAlpha;
    texture.generateMipmaps = template.generateMipmaps;
    texture.anisotropy = template.anisotropy;
    texture.rotation = template.rotation || 0;
    texture.repeat?.copy?.(template.repeat);
    texture.offset?.copy?.(template.offset);
    texture.center?.copy?.(template.center);
    if ('colorSpace' in template) texture.colorSpace = template.colorSpace;
    if ('encoding' in template) texture.encoding = template.encoding;
    texture.needsUpdate = true;
    return texture;
  }

  function setLayerCanvas(THREE, layer, canvas) {
    if (!layer || !canvas) return false;
    for (const old of layer.textures) old?.dispose?.();
    layer.textures.length = 0;
    for (const material of materialsFor(layer)) {
      const template = material?.map;
      const texture = copyTextureTransform(new THREE.CanvasTexture(canvas), template);
      material.map = texture;
      material.needsUpdate = true;
      layer.textures.push(texture);
    }
    return true;
  }

  function disposeLayer(layer) {
    if (!layer) return;
    layer.mesh?.parent?.remove?.(layer.mesh);
    for (const texture of layer.textures || []) texture?.dispose?.();
    for (const material of materialsFor(layer)) material?.dispose?.();
    layer.geometry?.dispose?.();
  }

  function decorateAvatar(THREE, avatarRef, rawRig) {
    const rest = normalizeRest(rawRig);
    if (!rest || !avatarRef?.headRig || avatarRef.shoulderRest?.version === 5) return avatarRef;
    const normalizedRig = window.AnimalHeadRigRuntime?.normalizeRig?.(rawRig) || null;
    if (!normalizedRig) return avatarRef;

    const rigState = avatarRef.headRig;
    const frontMesh = rest.useSpline || rest.splitFrame ? findRiggedMeshForBone(avatarRef.group, rigState.frontHeadBone) : null;
    const backMesh = rest.useSpline || rest.splitFrame ? findRiggedMeshForBone(avatarRef.group, rigState.backHeadBone) : null;
    const front = rest.useSpline ? buildMeshState(frontMesh, normalizedRig, rest, false) : null;
    const back = rest.useSpline ? buildMeshState(backMesh, normalizedRig, rest, true) : null;
    const frontOverlay = rest.splitFrame ? cloneOverlayMesh(THREE, frontMesh, 'split_left_front') : null;
    const backOverlay = rest.splitFrame ? cloneOverlayMesh(THREE, backMesh, 'split_left_back') : null;

    const debug = {
      version: 5,
      authored: true,
      enabled: false,
      useSpline: rest.useSpline,
      useRun1: rest.useRun1,
      splitFrame: rest.splitFrame,
      frameShiftX: rest.frameShiftX,
      guide: rest.guide,
      fullRotationDeg: rest.fullRotationDeg,
      interVertexRotationDeg: rest.interVertexRotationDeg,
      weightFalloff: rest.weightFalloff,
      fullRectangularStrip: true,
      layeredSplitFrame: !!(frontOverlay && backOverlay),
      frontVertices: front?.position?.count || 0,
      backVertices: back?.position?.count || 0,
    }; // Mobile/debug-readable proof of the final shoulder-only presentation state.

    avatarRef.setShoulderRestEnabled = enabled => {
      const next = !!enabled && rest.useSpline && !!front && !!back;
      if (debug.enabled !== next) {
        applyMeshState(front, next);
        applyMeshState(back, next);
        debug.enabled = next;
        avatarRef.group.userData.hobunjiShoulderRest = debug;
      }
      if (!enabled) avatarRef.setShoulderSplitOverlayEnabled?.(false);
      return next;
    };

    avatarRef.setShoulderSplitOverlayCanvas = (canvas, visible = true) => {
      if (!rest.splitFrame || !frontOverlay || !backOverlay || !canvas) return false;
      setLayerCanvas(THREE, frontOverlay, canvas);
      setLayerCanvas(THREE, backOverlay, canvas);
      frontOverlay.mesh.visible = !!visible;
      backOverlay.mesh.visible = !!visible;
      debug.splitOverlayVisible = !!visible;
      return true;
    };

    avatarRef.setShoulderSplitOverlayEnabled = enabled => {
      const visible = !!enabled && rest.splitFrame && !!frontOverlay && !!backOverlay;
      if (frontOverlay) frontOverlay.mesh.visible = visible;
      if (backOverlay) backOverlay.mesh.visible = visible;
      debug.splitOverlayVisible = visible;
      return visible;
    };

    const priorDispose = typeof avatarRef.dispose === 'function' ? avatarRef.dispose.bind(avatarRef) : null;
    avatarRef.dispose = function shoulderRestV5Dispose() {
      disposeLayer(frontOverlay);
      disposeLayer(backOverlay);
      return priorDispose?.();
    };

    avatarRef.shoulderRest = debug;
    avatarRef.group.userData.hobunjiShoulderRest = debug;
    return avatarRef;
  }

  function install() {
    const api = window.PNGPlaneAvatar;
    if (!api?.buildAnimalPlaneAvatarModel || api.__animalShoulderRestInstalledV5) return false;
    const priorBuild = api.buildAnimalPlaneAvatarModel.bind(api); // v4 remains inside this chain for old data compatibility; v5 overrides the final avatar methods.
    api.buildAnimalPlaneAvatarModel = function shoulderRestV5AwareAnimalBuild(THREE, spriteUrl, options = {}) {
      const avatarRef = priorBuild(THREE, spriteUrl, options);
      const rawRig = options?.headRig || window.HobunjiAnimalHeadRigSpecies?.resolveForOptions?.(options) || null;
      return rawRig?.shoulderRest?.enabled ? decorateAvatar(THREE, avatarRef, rawRig) : avatarRef;
    };
    api.__animalShoulderRestInstalledV5 = true;
    return true;
  }

  const api = {
    version: 5,
    normalizeRest,
    deformNormalizedPoint,
    splineWeightForT,
    deformWeightedPoint,
    decorateAvatar,
    install,
  };
  window.AnimalShoulderRestV5 = api;
  Object.assign(baseApi, api); // Rigger/debug callers see the corrected weight-falloff semantics through the familiar API.
  install();
})();
