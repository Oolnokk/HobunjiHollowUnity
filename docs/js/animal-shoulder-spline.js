// Seven-point shoulder-pet body spline for side-view animal planes.
//
// The shoulder pose is authored like the head rig: one source-space influence
// map, but the body's share follows a directly edited spline instead of one
// hinge. The complete rectangular PNG strip between restGuide A..B participates,
// including transparent pixels. Head Influence fights it as (1 - headInfluence).
//
// Older shoulderRest exports are accepted and converted on load:
// A/B + bend/full/inter/falloff data is sampled into seven spline points.
(() => {
  'use strict';

  const POINT_COUNT = 7;
  const STORAGE_KEY = window.AnimalHeadRigRuntime?.STORAGE_KEY || 'hobunji_animal_head_rigs_v1';
  const DEFAULT_REST_GUIDE = Object.freeze({
    a: Object.freeze({ x: 0.52, y: 0.56 }),
    b: Object.freeze({ x: 1.00, y: 0.57 }),
  });
  const DEFAULT_FRAME_SHIFT_X = 0.52;
  const DEG = Math.PI / 180;

  function finite(value, fallback) {
    const parsed = Number(value); // Hand-edited/imported JSON may contain strings or invalid numbers.
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value)); // Shared bounds helper for weights and UI-authored normalized values.
  }

  function clonePoint(point, fallback = { x: 0, y: 0 }) {
    return {
      x: finite(point?.x, fallback.x),
      y: finite(point?.y, fallback.y),
    };
  }

  function cloneGuide(guide = DEFAULT_REST_GUIDE) {
    return {
      a: clonePoint(guide?.a, DEFAULT_REST_GUIDE.a),
      b: clonePoint(guide?.b, DEFAULT_REST_GUIDE.b),
    };
  }

  function linearPointsForGuide(guide) {
    const g = cloneGuide(guide);
    return Array.from({ length: POINT_COUNT }, (_, index) => {
      const t = index / (POINT_COUNT - 1);
      return {
        x: g.a.x + (g.b.x - g.a.x) * t,
        y: g.a.y + (g.b.y - g.a.y) * t,
      };
    });
  }

  function legacyRotations(raw) {
    if (Number.isFinite(Number(raw?.fullRotationDeg)) || Number.isFinite(Number(raw?.interVertexRotationDeg))) {
      return {
        full: finite(raw?.fullRotationDeg, 0) * DEG,
        inter: finite(raw?.interVertexRotationDeg, 0) * DEG,
      };
    }
    const bend = finite(raw?.bend, 0);
    const full = Math.atan(4 * bend);
    return { full, inter: -2 * full };
  }

  function legacyCurveCenter(guide, t, rotations) {
    const a = guide.a, b = guide.b;
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-7) return clonePoint(a);
    const tx = dx / length, ty = dy / length, nx = -ty, ny = tx;
    const s = clamp(t, 0, 1) * length;
    const full = rotations.full, inter = rotations.inter;
    let centerAlong, centerNormal;
    if (Math.abs(inter) < 1e-7) {
      centerAlong = s * Math.cos(full);
      centerNormal = s * Math.sin(full);
    } else {
      const curvature = inter / length;
      const angle = full + inter * clamp(t, 0, 1);
      centerAlong = (Math.sin(angle) - Math.sin(full)) / curvature;
      centerNormal = (-Math.cos(angle) + Math.cos(full)) / curvature;
    }
    return {
      x: a.x + tx * centerAlong + nx * centerNormal,
      y: a.y + ty * centerAlong + ny * centerNormal,
    };
  }

  function migrateLegacyRest(raw) {
    const frameShiftX = clamp(finite(raw?.frameShiftX, DEFAULT_FRAME_SHIFT_X), 0, 1);
    const followFrameShiftX = raw?.followFrameShiftX !== false;
    const sourceGuide = cloneGuide(raw?.restGuide || raw?.guide || DEFAULT_REST_GUIDE);
    const authoredReference = finite(raw?.guideFrameShiftX, frameShiftX);
    if (followFrameShiftX && Number.isFinite(authoredReference)) {
      const dx = frameShiftX - authoredReference;
      sourceGuide.a.x += dx;
      sourceGuide.b.x += dx;
    }

    const rotations = legacyRotations(raw);
    const falloff = clamp(finite(raw?.weightFalloff ?? raw?.curveFalloff, 0), 0, 1);
    const splinePoints = Array.from({ length: POINT_COUNT }, (_, index) => {
      const t = index / (POINT_COUNT - 1);
      const source = {
        x: sourceGuide.a.x + (sourceGuide.b.x - sourceGuide.a.x) * t,
        y: sourceGuide.a.y + (sourceGuide.b.y - sourceGuide.a.y) * t,
      };
      const target = legacyCurveCenter(sourceGuide, t, rotations);
      const legacyWeight = 1 - falloff * (1 - t); // Bakes the retired weight-falloff slider into the actual control points.
      return {
        x: source.x + (target.x - source.x) * legacyWeight,
        y: source.y + (target.y - source.y) * legacyWeight,
      };
    });

    return {
      enabled: raw?.enabled !== false,
      useSpline: raw?.useSpline !== undefined ? !!raw.useSpline : raw?.enabled === true,
      useRun1: !!raw?.useRun1,
      splitFrame: !!raw?.splitFrame,
      splitRightUsesIdle: !!raw?.splitRightUsesIdle,
      frameShiftX,
      followFrameShiftX,
      restGuide: sourceGuide,
      splinePoints,
      migratedFromLegacy: true,
    };
  }

  function normalizeRest(rawRig) {
    const raw = rawRig?.shoulderRest ?? rawRig;
    if (!raw || raw.enabled === false) return null;

    if (!Array.isArray(raw.splinePoints) || raw.splinePoints.length !== POINT_COUNT) {
      return migrateLegacyRest(raw);
    }

    const restGuide = cloneGuide(raw.restGuide || raw.guide || {
      a: raw.splinePoints[0],
      b: raw.splinePoints[POINT_COUNT - 1],
    });
    const points = raw.splinePoints.map((point, index) => {
      const fallback = linearPointsForGuide(restGuide)[index];
      return clonePoint(point, fallback);
    });
    return {
      enabled: true,
      useSpline: !!raw.useSpline,
      useRun1: !!raw.useRun1,
      splitFrame: !!raw.splitFrame,
      splitRightUsesIdle: !!raw.splitRightUsesIdle,
      frameShiftX: clamp(finite(raw.frameShiftX, DEFAULT_FRAME_SHIFT_X), 0, 1),
      followFrameShiftX: raw.followFrameShiftX !== false,
      restGuide,
      splinePoints: points,
      migratedFromLegacy: false,
    };
  }

  function catmullRomComponent(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (
      (2 * p1)
      + (-p0 + p2) * t
      + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
      + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
  }

  function splinePoint(points, t) {
    const q = clamp(finite(t, 0), 0, 1) * (POINT_COUNT - 1);
    const segment = Math.min(POINT_COUNT - 2, Math.floor(q));
    const localT = segment === POINT_COUNT - 1 ? 1 : q - segment;
    const i0 = Math.max(0, segment - 1);
    const i1 = segment;
    const i2 = Math.min(POINT_COUNT - 1, segment + 1);
    const i3 = Math.min(POINT_COUNT - 1, segment + 2);
    const p0 = points[i0], p1 = points[i1], p2 = points[i2], p3 = points[i3];
    return {
      x: catmullRomComponent(p0.x, p1.x, p2.x, p3.x, localT),
      y: catmullRomComponent(p0.y, p1.y, p2.y, p3.y, localT),
    };
  }

  function splineTangent(points, t) {
    const epsilon = 1 / 2048;
    const a = splinePoint(points, Math.max(0, t - epsilon));
    const b = splinePoint(points, Math.min(1, t + epsilon));
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  }

  function restGuideMetrics(rest, point) {
    const a = rest.restGuide.a, b = rest.restGuide.b;
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-7) return null;
    const tx = dx / length, ty = dy / length;
    const nx = -ty, ny = tx;
    const px = finite(point?.x, 0), py = finite(point?.y, 0);
    const rx = px - a.x, ry = py - a.y;
    return {
      a, b, length, tx, ty, nx, ny,
      t: (rx * tx + ry * ty) / length,
      signedOffset: rx * nx + ry * ny,
    };
  }

  function deformNormalizedPoint(point, restLike) {
    const rest = restLike?.splinePoints ? restLike : normalizeRest(restLike);
    if (!rest?.restGuide || rest.splinePoints?.length !== POINT_COUNT) {
      return { x: finite(point?.x, 0), y: finite(point?.y, 0) };
    }
    const metrics = restGuideMetrics(rest, point);
    if (!metrics || metrics.t < 0 || metrics.t > 1) {
      return { x: finite(point?.x, 0), y: finite(point?.y, 0) };
    }
    const center = splinePoint(rest.splinePoints, metrics.t);
    const tangent = splineTangent(rest.splinePoints, metrics.t);
    const normal = { x: -tangent.y, y: tangent.x };
    return {
      x: center.x + normal.x * metrics.signedOffset,
      y: center.y + normal.y * metrics.signedOffset,
    };
  }

  function deformWeightedPoint(point, headInfluence, restLike) {
    const source = { x: finite(point?.x, 0), y: finite(point?.y, 0) };
    const rest = restLike?.splinePoints ? restLike : normalizeRest(restLike);
    if (!rest?.useSpline) return source;
    const target = deformNormalizedPoint(source, rest);
    const bodyWeight = 1 - clamp(finite(headInfluence, 0), 0, 1);
    return {
      x: source.x + (target.x - source.x) * bodyWeight,
      y: source.y + (target.y - source.y) * bodyWeight,
    };
  }

  function sampleHeadInfluence(normalizedRig, u, topV) {
    const map = normalizedRig?.weightMap;
    if (map?.values) {
      const fx = clamp(u, 0, 1) * Math.max(0, map.width - 1);
      const fy = clamp(topV, 0, 1) * Math.max(0, map.height - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(map.width - 1, x0 + 1), y1 = Math.min(map.height - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const unset = window.AnimalHeadRigRuntime?.UNSET_WEIGHT ?? 256;
      const at = (x, y) => {
        const value = map.values[y * map.width + x];
        return value === unset ? 0 : clamp(value, 0, 255) / 255;
      };
      const row0 = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
      const row1 = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
      return clamp(row0 * (1 - ty) + row1 * ty, 0, 1);
    }
    const region = normalizedRig?.legacyRegion;
    if (!region) return 0;
    return u >= region.x && u <= region.x + region.width
      && topV >= region.y && topV <= region.y + region.height ? 1 : 0;
  }

  function findRiggedMeshForBone(group, bone) {
    if (!group || !bone) return null;
    return (group.children || []).find(child =>
      child?.isSkinnedMesh
      && child.skeleton?.bones?.includes?.(bone)
      && !child.userData?.hobunjiShoulderSplitOverlay
    ) || null;
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
    const dimensions = dimensionsForGeometry(geometry);
    const basePositions = new Float32Array(position.array);
    const headInfluences = new Float32Array(position.count);
    const canonicalPoints = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
      const sourceU = mirrorX ? 1 - uv.getX(i) : uv.getX(i);
      const sourceTopV = 1 - uv.getY(i);
      canonicalPoints[i * 2] = sourceU;
      canonicalPoints[i * 2 + 1] = sourceTopV;
      headInfluences[i] = sampleHeadInfluence(normalizedRig, sourceU, sourceTopV);
    }
    return { mesh, position, basePositions, headInfluences, canonicalPoints, dimensions, rest, mirrorX };
  }

  function applyMeshState(meshState, enabled) {
    if (!meshState) return false;
    const { position, basePositions, headInfluences, canonicalPoints, dimensions, rest, mirrorX, mesh } = meshState;
    for (let i = 0; i < position.count; i++) {
      const offset = i * position.itemSize;
      const baseX = basePositions[offset], baseY = basePositions[offset + 1];
      let x = baseX, y = baseY;
      if (enabled && rest.useSpline) {
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
    clone.depthWrite = false;
    clone.polygonOffset = true;
    clone.polygonOffsetFactor = -2;
    clone.polygonOffsetUnits = -2;
    clone.needsUpdate = true;
    return clone;
  }

  function cloneOverlayMesh(THREE, source, suffix) {
    if (!source?.geometry || !source?.skeleton || !source?.parent) return null;
    const geometry = source.geometry.clone();
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
    overlay.onBeforeRender = source.onBeforeRender;
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
    if (!rest || !avatarRef?.headRig || avatarRef.shoulderRest?.version === 6) return avatarRef;
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
      version: 6,
      authored: true,
      enabled: false,
      useSpline: rest.useSpline,
      useRun1: rest.useRun1,
      splitFrame: rest.splitFrame,
      splitRightUsesIdle: rest.splitRightUsesIdle,
      frameShiftX: rest.frameShiftX,
      followFrameShiftX: rest.followFrameShiftX,
      restGuide: rest.restGuide,
      splinePoints: rest.splinePoints,
      migratedFromLegacy: rest.migratedFromLegacy,
      fullRectangularStrip: true,
      layeredSplitFrame: !!(frontOverlay && backOverlay),
      frontVertices: front?.position?.count || 0,
      backVertices: back?.position?.count || 0,
    };

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
      const appliedFront = setLayerCanvas(THREE, frontOverlay, canvas);
      const appliedBack = setLayerCanvas(THREE, backOverlay, canvas);
      const next = !!visible && !!canvas && appliedFront && appliedBack;
      if (frontOverlay?.mesh) frontOverlay.mesh.visible = next;
      if (backOverlay?.mesh) backOverlay.mesh.visible = next;
      debug.splitOverlayVisible = next;
      return next;
    };

    avatarRef.setShoulderSplitOverlayEnabled = enabled => {
      const next = !!enabled && !!frontOverlay && !!backOverlay;
      if (frontOverlay?.mesh) frontOverlay.mesh.visible = next;
      if (backOverlay?.mesh) backOverlay.mesh.visible = next;
      debug.splitOverlayVisible = next;
      return next;
    };

    const previousDispose = typeof avatarRef.dispose === 'function' ? avatarRef.dispose.bind(avatarRef) : null;
    avatarRef.dispose = () => {
      disposeLayer(frontOverlay);
      disposeLayer(backOverlay);
      if (previousDispose) previousDispose();
    };

    avatarRef.shoulderRest = debug;
    avatarRef.group.userData.hobunjiShoulderRest = debug;
    return avatarRef;
  }

  function install() {
    const api = window.PNGPlaneAvatar;
    if (!api?.buildAnimalPlaneAvatarModel || api.__animalShoulderSplineInstalledV6) return false;
    const priorBuild = api.buildAnimalPlaneAvatarModel.bind(api);
    api.buildAnimalPlaneAvatarModel = function shoulderSplineAwareAnimalBuild(THREE, spriteUrl, options = {}) {
      const profiles = window.HobunjiShoulderSplineProfiles;
      const resolvedRig = profiles?.resolveForOptions?.(options, spriteUrl) || options?.headRig || null;
      const buildOptions = resolvedRig && resolvedRig !== options?.headRig
        ? { ...options, headRig: resolvedRig }
        : options;
      const avatarRef = priorBuild(THREE, spriteUrl, buildOptions);
      const rawRig = buildOptions?.headRig || profiles?.resolveForOptions?.(buildOptions, spriteUrl) || null;
      return rawRig?.shoulderRest?.enabled ? decorateAvatar(THREE, avatarRef, rawRig) : avatarRef;
    };
    api.__animalShoulderSplineInstalledV6 = true;
    return true;
  }

  window.AnimalShoulderSpline = {
    version: 6,
    POINT_COUNT,
    normalizeRest,
    migrateLegacyRest,
    linearPointsForGuide,
    splinePoint,
    splineTangent,
    deformNormalizedPoint,
    deformWeightedPoint,
    sampleHeadInfluence,
    install,
  };
  // Compatibility alias for older diagnostics/tools while the branch migrates.
  window.AnimalShoulderRest = window.AnimalShoulderSpline;

  install();
})();
