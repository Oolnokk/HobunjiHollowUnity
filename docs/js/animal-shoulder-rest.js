// Static shoulder-pet rest deformation for painted animal head rigs.
//
// Shoulder presentation is authored separately from ordinary head pitch.
// The rest spline owns its own A/B guide. Every mesh vertex whose projection
// lies inside A..B participates regardless of sprite alpha, so transparent PNG
// space and opaque pixels follow one continuous rectangular strip. Head
// Influence still fights that strip directly: restWeight = 1 - headInfluence.
//
// Version 4 is retained as a compatibility layer for older shoulderRest data.
// animal-shoulder-rest-v5.js installs immediately afterward in gameplay/rigger
// contexts and owns the corrected `weightFalloff` semantics plus split layering.
(() => {
  'use strict';

  const DEG = Math.PI / 180;
  const MAX_ROTATION_DEG = 180;
  const DEFAULT_GUIDE = Object.freeze({
    a: Object.freeze({ x: 0.14, y: 0.46 }),
    b: Object.freeze({ x: 0.86, y: 0.46 }),
  });

  function finite(value, fallback) {
    const parsed = Number(value); // Used for hand-edited JSON and debug-safe authored values.
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value)); // Shared bounds helper for normalized sprite coordinates and weights.
  }

  function normalizedPoint(raw, fallback) {
    return {
      x: clamp(finite(raw?.x, fallback.x), 0, 1),
      y: clamp(finite(raw?.y, fallback.y), 0, 1),
    };
  }

  function legacyBendRotations(bendLike) {
    const bend = finite(bendLike, 0); // Migrates the discarded midpoint-peak model into approximately matching endpoint tangents.
    const fullRotationDeg = Math.atan(4 * bend) / DEG;
    return {
      fullRotationDeg: clamp(fullRotationDeg, -MAX_ROTATION_DEG, MAX_ROTATION_DEG),
      interVertexRotationDeg: clamp(-2 * fullRotationDeg, -MAX_ROTATION_DEG, MAX_ROTATION_DEG),
    };
  }

  function normalizeRest(rawRig) {
    const raw = rawRig?.shoulderRest; // Optional authored shoulder-only presentation descriptor stored beside the head rig.
    if (!raw || raw.enabled !== true) return null;

    const legacyCenterV = clamp(finite(raw.centerV, DEFAULT_GUIDE.a.y), 0, 1);
    const fallbackGuide = {
      a: { x: DEFAULT_GUIDE.a.x, y: legacyCenterV },
      b: { x: DEFAULT_GUIDE.b.x, y: legacyCenterV },
    };
    const guide = raw.guide || fallbackGuide;
    const hasNewFlags = Object.prototype.hasOwnProperty.call(raw, 'useSpline')
      || Object.prototype.hasOwnProperty.call(raw, 'useRun1')
      || Object.prototype.hasOwnProperty.call(raw, 'splitFrame');
    const legacyRotations = legacyBendRotations(raw.bend);

    return {
      enabled: true,
      useSpline: hasNewFlags ? !!raw.useSpline : true,
      useRun1: hasNewFlags ? !!raw.useRun1 : true,
      splitFrame: !!raw.splitFrame,
      frameShiftX: clamp(finite(raw.frameShiftX, 0.5), 0, 1),
      guide: {
        a: normalizedPoint(guide.a, fallbackGuide.a),
        b: normalizedPoint(guide.b, fallbackGuide.b),
      },
      fullRotationDeg: clamp(
        finite(raw.fullRotationDeg, legacyRotations.fullRotationDeg),
        -MAX_ROTATION_DEG,
        MAX_ROTATION_DEG,
      ),
      interVertexRotationDeg: clamp(
        finite(raw.interVertexRotationDeg, legacyRotations.interVertexRotationDeg),
        -MAX_ROTATION_DEG,
        MAX_ROTATION_DEG,
      ),
      curveFalloff: clamp(finite(raw.curveFalloff, 0), 0, 1), // Legacy v4-only field; v5 migrates this value to weightFalloff.
    };
  }

  function centerlineForCurl(t, length, full, inter, curveFalloff) {
    const clampedT = clamp(finite(t, 0), 0, 1); // Longitudinal fraction along guide A→B.
    if (clampedT <= 0) return { centerAlong: 0, centerNormal: 0, angle: full };
    if (Math.abs(inter) < 1e-7) {
      const s = clampedT * length;
      return { centerAlong: s * Math.cos(full), centerNormal: s * Math.sin(full), angle: full };
    }

    const falloff = clamp(finite(curveFalloff, 0), 0, 1);
    if (falloff <= 1e-7) {
      const curvature = inter / length; // Exact constant-curvature path retained for legacy rigs/default 0 falloff.
      const angle = full + inter * clampedT;
      return {
        centerAlong: (Math.sin(angle) - Math.sin(full)) / curvature,
        centerNormal: (-Math.cos(angle) + Math.cos(full)) / curvature,
        angle,
      };
    }

    const exponent = 1 + falloff * 4; // Legacy v4 distribution only; v5 no longer uses this as final shoulder semantics.
    const steps = 16; // Static shoulder pose only; midpoint integration is smooth enough while remaining cheap for live authoring.
    const dt = clampedT / steps;
    let sumAlong = 0;
    let sumNormal = 0;
    for (let i = 0; i < steps; i++) {
      const q = (i + 0.5) * dt;
      const theta = full + inter * Math.pow(q, exponent);
      sumAlong += Math.cos(theta);
      sumNormal += Math.sin(theta);
    }
    const scale = length * dt;
    return {
      centerAlong: sumAlong * scale,
      centerNormal: sumNormal * scale,
      angle: full + inter * Math.pow(clampedT, exponent),
    };
  }

  // Returns the deformed point for the full rectangular A..B strip.
  function deformNormalizedPoint(point, restLike) {
    const rest = restLike?.guide ? restLike : normalizeRest({ shoulderRest: restLike });
    if (!rest?.guide) return { x: finite(point?.x, 0), y: finite(point?.y, 0) };

    const px = finite(point?.x, 0);
    const py = finite(point?.y, 0);
    const a = rest.guide.a;
    const b = rest.guide.b;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) return { x: px, y: py };

    const tangentX = dx / length;
    const tangentY = dy / length;
    const normalX = -tangentY;
    const normalY = tangentX;
    const relX = px - a.x;
    const relY = py - a.y;
    const along = relX * tangentX + relY * tangentY;
    const t = along / length;
    if (t < 0 || t > 1) return { x: px, y: py };

    const signedOffset = relX * normalX + relY * normalY;
    const full = clamp(finite(rest.fullRotationDeg, 0), -MAX_ROTATION_DEG, MAX_ROTATION_DEG) * DEG;
    const inter = clamp(finite(rest.interVertexRotationDeg, 0), -MAX_ROTATION_DEG, MAX_ROTATION_DEG) * DEG;
    const curve = centerlineForCurl(t, length, full, inter, rest.curveFalloff);

    const centerX = a.x + tangentX * curve.centerAlong + normalX * curve.centerNormal;
    const centerY = a.y + tangentY * curve.centerAlong + normalY * curve.centerNormal;
    const rotatedNormalAlong = -Math.sin(curve.angle);
    const rotatedNormalNormal = Math.cos(curve.angle);
    const deformedNormalX = tangentX * rotatedNormalAlong + normalX * rotatedNormalNormal;
    const deformedNormalY = tangentY * rotatedNormalAlong + normalY * rotatedNormalNormal;

    return {
      x: centerX + deformedNormalX * signedOffset,
      y: centerY + deformedNormalY * signedOffset,
    };
  }

  function decodedInfluenceFor(rawRig) {
    return window.AnimalHeadRigRuntime?.normalizeRig?.(rawRig) || null; // Reuses the existing decoder instead of creating another weight-map format.
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
    return (group.children || []).find(child => child?.isSkinnedMesh && child.skeleton?.bones?.includes?.(bone)) || null;
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

    const dimensions = dimensionsForGeometry(geometry); // Converts normalized guide results back into the mesh's local plane units.
    const basePositions = new Float32Array(position.array); // Immutable bind positions so toggling never accumulates deformation.
    const bodyWeights = new Float32Array(position.count); // Head Influence competes with the full-strip rest deformation.
    const canonicalPoints = new Float32Array(position.count * 2); // Full plane UVs: alpha/opacity is intentionally never consulted.
    for (let i = 0; i < position.count; i++) {
      const sourceU = mirrorX ? 1 - uv.getX(i) : uv.getX(i);
      const sourceTopV = 1 - uv.getY(i);
      canonicalPoints[i * 2] = sourceU;
      canonicalPoints[i * 2 + 1] = sourceTopV;
      bodyWeights[i] = 1 - sampleHeadInfluence(normalizedRig, sourceU, sourceTopV);
    }
    return { mesh, position, basePositions, bodyWeights, canonicalPoints, dimensions, rest, mirrorX };
  }

  function applyMeshState(meshState, enabled) {
    if (!meshState) return false;
    const { position, basePositions, bodyWeights, canonicalPoints, dimensions, rest, mirrorX, mesh } = meshState;
    const hasCurl = Math.abs(rest.fullRotationDeg) > 1e-7 || Math.abs(rest.interVertexRotationDeg) > 1e-7;
    for (let i = 0; i < position.count; i++) {
      const offset = i * position.itemSize;
      const baseX = basePositions[offset], baseY = basePositions[offset + 1];
      let x = baseX, y = baseY;
      if (enabled && rest.useSpline && hasCurl) {
        const source = { x: canonicalPoints[i * 2], y: canonicalPoints[i * 2 + 1] };
        const target = deformNormalizedPoint(source, rest);
        const targetLocalU = mirrorX ? 1 - target.x : target.x;
        const targetX = (targetLocalU - 0.5) * dimensions.width;
        const targetY = (0.5 - target.y) * dimensions.height;
        const bodyWeight = clamp(bodyWeights[i], 0, 1);
        x += (targetX - baseX) * bodyWeight;
        y += (targetY - baseY) * bodyWeight;
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

  function decorateAvatar(avatarRef, rawRig) {
    const rest = normalizeRest(rawRig);
    if (!rest || !avatarRef?.headRig || avatarRef.shoulderRest?.version === 4) return avatarRef;
    const normalizedRig = decodedInfluenceFor(rawRig);
    if (!normalizedRig) return avatarRef;

    const rigState = avatarRef.headRig;
    const frontMesh = rest.useSpline ? findRiggedMeshForBone(avatarRef.group, rigState.frontHeadBone) : null;
    const backMesh = rest.useSpline ? findRiggedMeshForBone(avatarRef.group, rigState.backHeadBone) : null;
    const front = rest.useSpline ? buildMeshState(frontMesh, normalizedRig, rest, false) : null;
    const back = rest.useSpline ? buildMeshState(backMesh, normalizedRig, rest, true) : null;

    const debug = {
      version: 4,
      authored: true,
      enabled: false,
      useSpline: rest.useSpline,
      useRun1: rest.useRun1,
      splitFrame: rest.splitFrame,
      frameShiftX: rest.frameShiftX,
      guide: rest.guide,
      fullRotationDeg: rest.fullRotationDeg,
      interVertexRotationDeg: rest.interVertexRotationDeg,
      curveFalloff: rest.curveFalloff,
      fullRectangularStrip: true,
      frontVertices: front?.position?.count || 0,
      backVertices: back?.position?.count || 0,
    }; // Mobile/debug-readable proof of every authored shoulder-only presentation value.

    avatarRef.setShoulderRestEnabled = enabled => {
      const next = !!enabled && rest.useSpline && !!front && !!back;
      if (debug.enabled === next) return next;
      applyMeshState(front, next);
      applyMeshState(back, next);
      debug.enabled = next;
      avatarRef.group.userData.hobunjiShoulderRest = debug;
      return next;
    };
    avatarRef.shoulderRest = debug;
    avatarRef.group.userData.hobunjiShoulderRest = debug;
    return avatarRef;
  }

  function install() {
    const api = window.PNGPlaneAvatar;
    if (!api?.buildAnimalPlaneAvatarModel || api.__animalShoulderRestInstalledV4) return false;
    const priorBuild = api.buildAnimalPlaneAvatarModel.bind(api); // Preserves base plane + head-rig + material-response wrappers already installed earlier.
    api.buildAnimalPlaneAvatarModel = function shoulderRestAwareAnimalBuild(THREE, spriteUrl, options = {}) {
      const avatarRef = priorBuild(THREE, spriteUrl, options);
      const rawRig = options?.headRig || window.HobunjiAnimalHeadRigSpecies?.resolveForOptions?.(options) || null;
      return rawRig?.shoulderRest?.enabled ? decorateAvatar(avatarRef, rawRig) : avatarRef;
    };
    api.__animalShoulderRestInstalledV4 = true;
    return true;
  }

  window.AnimalShoulderRest = {
    version: 4,
    DEFAULT_GUIDE,
    normalizeRest,
    legacyBendRotations,
    centerlineForCurl,
    deformNormalizedPoint,
    sampleHeadInfluence,
    decorateAvatar,
    install,
  };
  install();
})();