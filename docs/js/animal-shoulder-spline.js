// Seven-point shoulder-pet body spline for side-view animal planes.
//
// v7 makes the rig explicitly two-stage:
//   BEFORE points = bind line fitted to the undeformed PNG.
//   AFTER points  = shoulder pose for those same seven bind locations.
// Every source vertex is measured in the local frame of the BEFORE spline and
// reconstructed in the matching local frame of the AFTER spline. The complete
// rectangular strip participates regardless of sprite alpha. Head Influence
// still fights shoulder deformation as (1 - headInfluence).
//
// Older shoulderRest exports remain one-way compatible. Straight A/B bind guides
// and the retired bend/rotation/falloff controls are sampled into BEFORE/AFTER.
(() => {
  'use strict';

  const POINT_COUNT = 7;
  const DEFAULT_GUIDE = Object.freeze({
    a: Object.freeze({ x: 0.52, y: 0.56 }),
    b: Object.freeze({ x: 1.00, y: 0.57 }),
  });
  const DEFAULT_FRAME_SHIFT_X = 0.52;
  const DEG = Math.PI / 180;

  function finite(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function clonePoint(point, fallback = { x: 0, y: 0 }) {
    return { x: finite(point?.x, fallback.x), y: finite(point?.y, fallback.y) };
  }
  function cloneGuide(guide = DEFAULT_GUIDE) {
    return { a: clonePoint(guide?.a, DEFAULT_GUIDE.a), b: clonePoint(guide?.b, DEFAULT_GUIDE.b) };
  }
  function linearPointsForGuide(guide = DEFAULT_GUIDE) {
    const g = cloneGuide(guide);
    return Array.from({ length: POINT_COUNT }, (_, index) => {
      const t = index / (POINT_COUNT - 1);
      return { x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t };
    });
  }
  function clonePoints(points, fallbackPoints) {
    return Array.from({ length: POINT_COUNT }, (_, index) => clonePoint(points?.[index], fallbackPoints[index]));
  }

  function legacyRotations(raw) {
    if (Number.isFinite(Number(raw?.fullRotationDeg)) || Number.isFinite(Number(raw?.interVertexRotationDeg))) {
      return { full: finite(raw?.fullRotationDeg, 0) * DEG, inter: finite(raw?.interVertexRotationDeg, 0) * DEG };
    }
    const bend = finite(raw?.bend, 0);
    const full = Math.atan(4 * bend);
    return { full, inter: -2 * full };
  }
  function legacyCurveCenter(guide, t, rotations) {
    const a = guide.a, b = guide.b;
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 1e-7) return clonePoint(a);
    const tx = dx / length, ty = dy / length, nx = -ty, ny = tx;
    const q = clamp(t, 0, 1), s = q * length, full = rotations.full, inter = rotations.inter;
    let centerAlong, centerNormal;
    if (Math.abs(inter) < 1e-7) {
      centerAlong = s * Math.cos(full); centerNormal = s * Math.sin(full);
    } else {
      const curvature = inter / length, angle = full + inter * q;
      centerAlong = (Math.sin(angle) - Math.sin(full)) / curvature;
      centerNormal = (-Math.cos(angle) + Math.cos(full)) / curvature;
    }
    return { x: a.x + tx * centerAlong + nx * centerNormal, y: a.y + ty * centerAlong + ny * centerNormal };
  }

  function migrateLegacyRest(raw) {
    const frameShiftX = clamp(finite(raw?.frameShiftX, DEFAULT_FRAME_SHIFT_X), 0, 1);
    const followFrameShiftX = raw?.followFrameShiftX !== false;
    const guide = cloneGuide(raw?.restGuide || raw?.guide || DEFAULT_GUIDE);
    const authoredReference = finite(raw?.guideFrameShiftX, frameShiftX);
    if (followFrameShiftX && Number.isFinite(authoredReference)) {
      const dx = frameShiftX - authoredReference;
      guide.a.x += dx; guide.b.x += dx;
    }

    const beforePoints = Array.isArray(raw?.beforePoints) && raw.beforePoints.length === POINT_COUNT
      ? clonePoints(raw.beforePoints, linearPointsForGuide(guide))
      : linearPointsForGuide(guide);

    let afterPoints;
    if (Array.isArray(raw?.afterPoints) && raw.afterPoints.length === POINT_COUNT) {
      afterPoints = clonePoints(raw.afterPoints, beforePoints);
    } else if (Array.isArray(raw?.splinePoints) && raw.splinePoints.length === POINT_COUNT) {
      // v6 already stored the destination pose; its bind shape was the straight restGuide.
      afterPoints = clonePoints(raw.splinePoints, beforePoints);
    } else {
      const rotations = legacyRotations(raw);
      const falloff = clamp(finite(raw?.weightFalloff ?? raw?.curveFalloff, 0), 0, 1);
      afterPoints = Array.from({ length: POINT_COUNT }, (_, index) => {
        const t = index / (POINT_COUNT - 1);
        const source = beforePoints[index];
        const target = legacyCurveCenter(guide, t, rotations);
        const legacyWeight = 1 - falloff * (1 - t);
        return { x: source.x + (target.x - source.x) * legacyWeight, y: source.y + (target.y - source.y) * legacyWeight };
      });
    }

    return {
      enabled: raw?.enabled !== false,
      useSpline: raw?.useSpline !== undefined ? !!raw.useSpline : raw?.enabled === true,
      useRun1: !!raw?.useRun1,
      splitFrame: !!raw?.splitFrame,
      splitRightUsesIdle: !!raw?.splitRightUsesIdle,
      frameShiftX,
      followFrameShiftX,
      beforePoints,
      afterPoints,
      migratedFromLegacy: true,
    };
  }

  function normalizeRest(rawRig) {
    const raw = rawRig?.shoulderRest ?? rawRig;
    if (!raw || raw.enabled === false) return null;
    if (!Array.isArray(raw.beforePoints) || raw.beforePoints.length !== POINT_COUNT
      || !Array.isArray(raw.afterPoints) || raw.afterPoints.length !== POINT_COUNT) {
      return migrateLegacyRest(raw);
    }
    const fallback = linearPointsForGuide(DEFAULT_GUIDE);
    const beforePoints = clonePoints(raw.beforePoints, fallback);
    const afterPoints = clonePoints(raw.afterPoints, beforePoints);
    return {
      enabled: true,
      useSpline: !!raw.useSpline,
      useRun1: !!raw.useRun1,
      splitFrame: !!raw.splitFrame,
      splitRightUsesIdle: !!raw.splitRightUsesIdle,
      frameShiftX: clamp(finite(raw.frameShiftX, DEFAULT_FRAME_SHIFT_X), 0, 1),
      followFrameShiftX: raw.followFrameShiftX !== false,
      beforePoints,
      afterPoints,
      migratedFromLegacy: false,
    };
  }

  function catmullRomComponent(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function splinePoint(points, t) {
    const q = clamp(finite(t, 0), 0, 1) * (POINT_COUNT - 1);
    const segment = Math.min(POINT_COUNT - 2, Math.floor(q)), localT = q - segment;
    const i0 = Math.max(0, segment - 1), i1 = segment, i2 = Math.min(POINT_COUNT - 1, segment + 1), i3 = Math.min(POINT_COUNT - 1, segment + 2);
    const p0 = points[i0], p1 = points[i1], p2 = points[i2], p3 = points[i3];
    return { x: catmullRomComponent(p0.x, p1.x, p2.x, p3.x, localT), y: catmullRomComponent(p0.y, p1.y, p2.y, p3.y, localT) };
  }
  function splineTangent(points, t) {
    const epsilon = 1 / 4096;
    const a = splinePoint(points, Math.max(0, t - epsilon)), b = splinePoint(points, Math.min(1, t + epsilon));
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  }
  function dot(ax, ay, bx, by) { return ax * bx + ay * by; }
  function distanceSquared(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

  // Measure a PNG point in the curved BEFORE/bind frame. This is the missing
  // first stage that v6 approximated as one straight A→B line.
  function bindFrameForPoint(beforePoints, point) {
    const p = { x: finite(point?.x, 0), y: finite(point?.y, 0) };
    const start = splinePoint(beforePoints, 0), end = splinePoint(beforePoints, 1);
    const startTangent = splineTangent(beforePoints, 0), endTangent = splineTangent(beforePoints, 1);
    if (dot(p.x - start.x, p.y - start.y, startTangent.x, startTangent.y) < 0) return null;
    if (dot(p.x - end.x, p.y - end.y, endTangent.x, endTangent.y) > 0) return null;

    const samples = 96;
    let bestT = 0, bestD = Infinity;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples, center = splinePoint(beforePoints, t), d = distanceSquared(center, p);
      if (d < bestD) { bestD = d; bestT = t; }
    }
    let lo = Math.max(0, bestT - 1 / samples), hi = Math.min(1, bestT + 1 / samples);
    for (let i = 0; i < 9; i++) {
      const t1 = lo + (hi - lo) / 3, t2 = hi - (hi - lo) / 3;
      const d1 = distanceSquared(splinePoint(beforePoints, t1), p), d2 = distanceSquared(splinePoint(beforePoints, t2), p);
      if (d1 <= d2) hi = t2; else lo = t1;
    }
    const t = (lo + hi) / 2, center = splinePoint(beforePoints, t), tangent = splineTangent(beforePoints, t);
    const normal = { x: -tangent.y, y: tangent.x };
    return { t, center, tangent, normal, signedOffset: dot(p.x - center.x, p.y - center.y, normal.x, normal.y) };
  }

  function deformNormalizedPoint(point, restLike) {
    const rest = restLike?.beforePoints && restLike?.afterPoints ? restLike : normalizeRest(restLike);
    const source = { x: finite(point?.x, 0), y: finite(point?.y, 0) };
    if (!rest || rest.beforePoints?.length !== POINT_COUNT || rest.afterPoints?.length !== POINT_COUNT) return source;
    const bind = bindFrameForPoint(rest.beforePoints, source);
    if (!bind) return source;
    const center = splinePoint(rest.afterPoints, bind.t), tangent = splineTangent(rest.afterPoints, bind.t), normal = { x: -tangent.y, y: tangent.x };
    return { x: center.x + normal.x * bind.signedOffset, y: center.y + normal.y * bind.signedOffset };
  }
  function deformWeightedPoint(point, headInfluence, restLike) {
    const source = { x: finite(point?.x, 0), y: finite(point?.y, 0) };
    const rest = restLike?.beforePoints && restLike?.afterPoints ? restLike : normalizeRest(restLike);
    if (!rest?.useSpline) return source;
    const target = deformNormalizedPoint(source, rest), bodyWeight = 1 - clamp(finite(headInfluence, 0), 0, 1);
    return { x: source.x + (target.x - source.x) * bodyWeight, y: source.y + (target.y - source.y) * bodyWeight };
  }

  function sampleHeadInfluence(normalizedRig, u, topV) {
    const map = normalizedRig?.weightMap;
    if (map?.values) {
      const fx = clamp(u, 0, 1) * Math.max(0, map.width - 1), fy = clamp(topV, 0, 1) * Math.max(0, map.height - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(map.width - 1, x0 + 1), y1 = Math.min(map.height - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      const unset = window.AnimalHeadRigRuntime?.UNSET_WEIGHT ?? 256;
      const at = (x, y) => { const value = map.values[y * map.width + x]; return value === unset ? 0 : clamp(value, 0, 255) / 255; };
      const row0 = at(x0, y0) * (1 - tx) + at(x1, y0) * tx, row1 = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
      return clamp(row0 * (1 - ty) + row1 * ty, 0, 1);
    }
    const region = normalizedRig?.legacyRegion;
    if (!region) return 0;
    return u >= region.x && u <= region.x + region.width && topV >= region.y && topV <= region.y + region.height ? 1 : 0;
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
    width = Math.abs(finite(box?.max?.x, 0) - finite(box?.min?.x, 0)); height = Math.abs(finite(box?.max?.y, 0) - finite(box?.min?.y, 0));
    return { width: Math.max(width, 1e-6), height: Math.max(height, 1e-6) };
  }
  function buildMeshState(mesh, normalizedRig, rest, mirrorX) {
    const geometry = mesh?.geometry, position = geometry?.getAttribute?.('position'), uv = geometry?.getAttribute?.('uv');
    if (!position || !uv || position.count !== uv.count) return null;
    const dimensions = dimensionsForGeometry(geometry), basePositions = new Float32Array(position.array), headInfluences = new Float32Array(position.count), canonicalPoints = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
      const sourceU = mirrorX ? 1 - uv.getX(i) : uv.getX(i), sourceTopV = 1 - uv.getY(i);
      canonicalPoints[i * 2] = sourceU; canonicalPoints[i * 2 + 1] = sourceTopV; headInfluences[i] = sampleHeadInfluence(normalizedRig, sourceU, sourceTopV);
    }
    return { mesh, position, basePositions, headInfluences, canonicalPoints, dimensions, rest, mirrorX };
  }
  function applyMeshState(meshState, enabled) {
    if (!meshState) return false;
    const { position, basePositions, headInfluences, canonicalPoints, dimensions, rest, mirrorX, mesh } = meshState;
    for (let i = 0; i < position.count; i++) {
      const offset = i * position.itemSize, baseX = basePositions[offset], baseY = basePositions[offset + 1];
      let x = baseX, y = baseY;
      if (enabled && rest.useSpline) {
        const source = { x: canonicalPoints[i * 2], y: canonicalPoints[i * 2 + 1] }, target = deformWeightedPoint(source, headInfluences[i], rest), targetLocalU = mirrorX ? 1 - target.x : target.x;
        x = (targetLocalU - 0.5) * dimensions.width; y = (0.5 - target.y) * dimensions.height;
      }
      position.array[offset] = x; position.array[offset + 1] = y; if (position.itemSize > 2) position.array[offset + 2] = basePositions[offset + 2];
    }
    position.needsUpdate = true; mesh.geometry.computeBoundingBox?.(); mesh.geometry.computeBoundingSphere?.(); return true;
  }

  function cloneMaterialForOverlay(material) {
    const clone = material?.clone?.() || material;
    if (!clone) return clone;
    clone.transparent = true; clone.needsUpdate = true; return clone;
  }
  function cloneOverlayMesh(THREE, source, suffix) {
    if (!source?.geometry || !source?.skeleton || !source?.parent) return null;
    const geometry = source.geometry.clone(), sharedSkinWeight = source.geometry.getAttribute?.('skinWeight'), sharedSkinIndex = source.geometry.getAttribute?.('skinIndex');
    if (sharedSkinWeight) geometry.setAttribute('skinWeight', sharedSkinWeight); if (sharedSkinIndex) geometry.setAttribute('skinIndex', sharedSkinIndex);
    const material = Array.isArray(source.material) ? source.material.map(cloneMaterialForOverlay) : cloneMaterialForOverlay(source.material);
    const overlay = new THREE.SkinnedMesh(geometry, material);
    overlay.name = `${source.name || 'animal'}_${suffix}`; overlay.position.copy(source.position); overlay.quaternion.copy(source.quaternion); overlay.scale.copy(source.scale); overlay.renderOrder = source.renderOrder || 0; overlay.frustumCulled = source.frustumCulled;
    overlay.userData = { ...source.userData, hobunjiShoulderSplitOverlay: true }; overlay.onBeforeRender = source.onBeforeRender; overlay.bindMode = source.bindMode; overlay.bind(source.skeleton, source.bindMatrix?.clone?.() || source.bindMatrix); overlay.visible = false; source.parent.add(overlay);
    return { mesh: overlay, geometry, material, textures: [] };
  }
  function materialsFor(layer) { if (!layer?.material) return []; return Array.isArray(layer.material) ? layer.material : [layer.material]; }
  function copyTextureTransform(texture, template) {
    if (!texture || !template) return texture;
    texture.wrapS = template.wrapS; texture.wrapT = template.wrapT; texture.magFilter = template.magFilter; texture.minFilter = template.minFilter; texture.flipY = template.flipY; texture.premultiplyAlpha = template.premultiplyAlpha; texture.generateMipmaps = template.generateMipmaps; texture.anisotropy = template.anisotropy; texture.rotation = template.rotation || 0; texture.repeat?.copy?.(template.repeat); texture.offset?.copy?.(template.offset); texture.center?.copy?.(template.center); if ('colorSpace' in template) texture.colorSpace = template.colorSpace; if ('encoding' in template) texture.encoding = template.encoding; texture.needsUpdate = true; return texture;
  }
  function setLayerCanvas(THREE, layer, canvas) {
    if (!layer || !canvas) return false;
    for (const old of layer.textures) old?.dispose?.(); layer.textures.length = 0;
    for (const material of materialsFor(layer)) { const texture = copyTextureTransform(new THREE.CanvasTexture(canvas), material?.map); material.map = texture; material.needsUpdate = true; layer.textures.push(texture); }
    return true;
  }
  function disposeLayer(layer) { if (!layer) return; layer.mesh?.parent?.remove?.(layer.mesh); for (const texture of layer.textures || []) texture?.dispose?.(); for (const material of materialsFor(layer)) material?.dispose?.(); layer.geometry?.dispose?.(); }

  function decorateAvatar(THREE, avatarRef, rawRig) {
    const rest = normalizeRest(rawRig);
    if (!rest || !avatarRef?.headRig || avatarRef.shoulderRest?.version === 7) return avatarRef;
    const normalizedRig = window.AnimalHeadRigRuntime?.normalizeRig?.(rawRig) || null;
    if (!normalizedRig) return avatarRef;
    const rigState = avatarRef.headRig, frontMesh = rest.useSpline || rest.splitFrame ? findRiggedMeshForBone(avatarRef.group, rigState.frontHeadBone) : null, backMesh = rest.useSpline || rest.splitFrame ? findRiggedMeshForBone(avatarRef.group, rigState.backHeadBone) : null;
    const front = rest.useSpline ? buildMeshState(frontMesh, normalizedRig, rest, false) : null, back = rest.useSpline ? buildMeshState(backMesh, normalizedRig, rest, true) : null;
    const frontOverlay = rest.splitFrame ? cloneOverlayMesh(THREE, frontMesh, 'split_left_front') : null, backOverlay = rest.splitFrame ? cloneOverlayMesh(THREE, backMesh, 'split_left_back') : null;
    const debug = { version: 7, authored: true, enabled: false, useSpline: rest.useSpline, useRun1: rest.useRun1, splitFrame: rest.splitFrame, splitRightUsesIdle: rest.splitRightUsesIdle, frameShiftX: rest.frameShiftX, followFrameShiftX: rest.followFrameShiftX, beforePoints: rest.beforePoints, afterPoints: rest.afterPoints, migratedFromLegacy: rest.migratedFromLegacy, fullRectangularStrip: true, layeredSplitFrame: !!(frontOverlay && backOverlay), frontVertices: front?.position?.count || 0, backVertices: back?.position?.count || 0 };

    avatarRef.setShoulderRestEnabled = enabled => {
      const next = !!enabled && rest.useSpline && !!front && !!back;
      if (debug.enabled !== next) { applyMeshState(front, next); applyMeshState(back, next); debug.enabled = next; avatarRef.group.userData.hobunjiShoulderRest = debug; }
      if (!enabled) avatarRef.setShoulderSplitOverlayEnabled?.(false); return next;
    };
    avatarRef.setShoulderSplitOverlayCanvas = (canvas, visible = true) => {
      const appliedFront = setLayerCanvas(THREE, frontOverlay, canvas), appliedBack = setLayerCanvas(THREE, backOverlay, canvas), next = !!visible && !!canvas && appliedFront && appliedBack;
      if (frontOverlay?.mesh) frontOverlay.mesh.visible = next; if (backOverlay?.mesh) backOverlay.mesh.visible = next; debug.splitOverlayVisible = next; return next;
    };
    avatarRef.setShoulderSplitOverlayEnabled = enabled => {
      const next = !!enabled && !!frontOverlay && !!backOverlay;
      if (frontOverlay?.mesh) frontOverlay.mesh.visible = next; if (backOverlay?.mesh) backOverlay.mesh.visible = next; debug.splitOverlayVisible = next; return next;
    };
    const previousDispose = typeof avatarRef.dispose === 'function' ? avatarRef.dispose.bind(avatarRef) : null;
    avatarRef.dispose = () => { disposeLayer(frontOverlay); disposeLayer(backOverlay); if (previousDispose) previousDispose(); };
    avatarRef.shoulderRest = debug; avatarRef.group.userData.hobunjiShoulderRest = debug; return avatarRef;
  }

  function install() {
    const api = window.PNGPlaneAvatar;
    if (!api?.buildAnimalPlaneAvatarModel || api.__animalShoulderSplineInstalledV7) return false;
    const priorBuild = api.buildAnimalPlaneAvatarModel.bind(api);
    api.buildAnimalPlaneAvatarModel = function shoulderSplineAwareAnimalBuild(THREE, spriteUrl, options = {}) {
      const profiles = window.HobunjiShoulderSplineProfiles, resolvedRig = profiles?.resolveForOptions?.(options, spriteUrl) || options?.headRig || null;
      const buildOptions = resolvedRig && resolvedRig !== options?.headRig ? { ...options, headRig: resolvedRig } : options;
      const avatarRef = priorBuild(THREE, spriteUrl, buildOptions), rawRig = buildOptions?.headRig || profiles?.resolveForOptions?.(buildOptions, spriteUrl) || null;
      return rawRig?.shoulderRest?.enabled ? decorateAvatar(THREE, avatarRef, rawRig) : avatarRef;
    };
    api.__animalShoulderSplineInstalledV7 = true; return true;
  }

  window.AnimalShoulderSpline = { version: 7, POINT_COUNT, normalizeRest, migrateLegacyRest, linearPointsForGuide, splinePoint, splineTangent, bindFrameForPoint, deformNormalizedPoint, deformWeightedPoint, sampleHeadInfluence, install };
  window.AnimalShoulderRest = window.AnimalShoulderSpline;
  install();
})();
