// Static shoulder-pet rest deformation for painted animal head rigs.
//
// This borrows only the useful core of the standalone spline PNG rigger: an
// authored A/B guide defines the body's longitudinal axis and a single midpoint
// bend curves that axis. The guide is independent of the head pivot. Existing
// Head Influence remains the authority for how much each vertex resists the
// body-rest deformation: restWeight = 1 - headInfluence.
(() => {
  'use strict';

  const MAX_BEND = 0.75; // Maximum midpoint displacement as a fraction of authored A/B guide length.
  const DEFAULT_GUIDE = Object.freeze({ a: Object.freeze({ x: 0.14, y: 0.46 }), b: Object.freeze({ x: 0.86, y: 0.46 }) });

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

  function normalizeRest(rawRig) {
    const raw = rawRig?.shoulderRest; // Optional authored shoulder-only presentation descriptor stored beside the head rig.
    if (!raw || raw.enabled !== true) return null;
    const legacyCenterV = clamp(finite(raw.centerV, DEFAULT_GUIDE.a.y), 0, 1); // Migrates the first one-pivot shoulder-rest draft without losing browser-local rigs.
    const fallbackGuide = { a: { x: DEFAULT_GUIDE.a.x, y: legacyCenterV }, b: { x: DEFAULT_GUIDE.b.x, y: legacyCenterV } };
    const guide = raw.guide || fallbackGuide;
    const hasNewFlags = Object.prototype.hasOwnProperty.call(raw, 'useSpline')
      || Object.prototype.hasOwnProperty.call(raw, 'useRun1')
      || Object.prototype.hasOwnProperty.call(raw, 'splitFrame');
    return {
      enabled: true,
      useSpline: hasNewFlags ? !!raw.useSpline : true,
      useRun1: hasNewFlags ? !!raw.useRun1 : true, // Old draft coupled run1 to the spline checkbox; preserve that only for old saved rigs.
      splitFrame: !!raw.splitFrame,
      frameShiftX: clamp(finite(raw.frameShiftX, 0.5), 0, 1),
      guide: {
        a: normalizedPoint(guide.a, fallbackGuide.a),
        b: normalizedPoint(guide.b, fallbackGuide.b),
      },
      bend: clamp(finite(raw.bend, 0), -MAX_BEND, MAX_BEND),
    };
  }

  // Deforms one canonical sprite-normalized top-left point through the authored
  // A/B guide. Points outside the longitudinal A..B span are intentionally left
  // alone. At bend=0 this is mathematically the identity transform even when the
  // guide is angled or offset, because each point is reconstructed from its
  // projection plus signed normal offset.
  function deformNormalizedPoint(point, restLike) {
    const rest = restLike?.guide ? restLike : normalizeRest({ shoulderRest: restLike });
    if (!rest?.guide) return { x: finite(point?.x, 0), y: finite(point?.y, 0) };
    const px = finite(point?.x, 0), py = finite(point?.y, 0);
    const a = rest.guide.a, b = rest.guide.b;
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) return { x: px, y: py };
    const lengthSq = length * length;
    const t = ((px - a.x) * dx + (py - a.y) * dy) / lengthSq;
    if (t < 0 || t > 1) return { x: px, y: py };

    const tangentX = dx / length, tangentY = dy / length;
    const normalX = -tangentY, normalY = tangentX;
    const lineX = a.x + dx * t, lineY = a.y + dy * t;
    const signedOffset = (px - lineX) * normalX + (py - lineY) * normalY;
    const bend = clamp(finite(rest.bend, 0), -MAX_BEND, MAX_BEND);
    const centerOffset = 4 * (1 - t) * t * bend * length;
    const curvedCenterX = lineX + normalX * centerOffset;
    const curvedCenterY = lineY + normalY * centerOffset;

    // Rotate each cross-section to the curved path tangent, matching the simple
    // slice orientation used by the standalone spline PNG preview.
    const derivativeNormal = 4 * bend * length * (1 - 2 * t);
    const derivativeX = dx + normalX * derivativeNormal;
    const derivativeY = dy + normalY * derivativeNormal;
    const derivativeLength = Math.hypot(derivativeX, derivativeY) || 1;
    const curvedNormalX = -derivativeY / derivativeLength;
    const curvedNormalY = derivativeX / derivativeLength;
    return {
      x: curvedCenterX + curvedNormalX * signedOffset,
      y: curvedCenterY + curvedNormalY * signedOffset,
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
    return u >= region.x && u <= region.x + region.width && topV >= region.y && topV <= region.y + region.height ? 1 : 0;
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
    const basePositions = new Float32Array(position.array); // Immutable bind/rest positions so toggling never accumulates deformation.
    const bodyWeights = new Float32Array(position.count); // Complement of Head Influence; exactly the requested competing body/rest share.
    const canonicalPoints = new Float32Array(position.count * 2); // Canonical top-left sprite UVs keep front/back deformation visually identical.
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
    for (let i = 0; i < position.count; i++) {
      const offset = i * position.itemSize;
      const baseX = basePositions[offset], baseY = basePositions[offset + 1];
      let x = baseX, y = baseY;
      if (enabled && rest.useSpline && Math.abs(rest.bend) > 1e-7) {
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
    if (!rest || !avatarRef?.headRig || avatarRef.shoulderRest?.authored) return avatarRef;
    const normalizedRig = decodedInfluenceFor(rawRig);
    if (!normalizedRig) return avatarRef;
    const rigState = avatarRef.headRig;
    const frontMesh = rest.useSpline ? findRiggedMeshForBone(avatarRef.group, rigState.frontHeadBone) : null;
    const backMesh = rest.useSpline ? findRiggedMeshForBone(avatarRef.group, rigState.backHeadBone) : null;
    const front = rest.useSpline ? buildMeshState(frontMesh, normalizedRig, rest, false) : null;
    const back = rest.useSpline ? buildMeshState(backMesh, normalizedRig, rest, true) : null;

    const debug = {
      authored: true,
      enabled: false,
      useSpline: rest.useSpline,
      useRun1: rest.useRun1,
      splitFrame: rest.splitFrame,
      frameShiftX: rest.frameShiftX,
      guide: rest.guide,
      bend: rest.bend,
      frontVertices: front?.position?.count || 0,
      backVertices: back?.position?.count || 0,
    }; // Mobile/debug-readable proof of the authored presentation and which shoulder-only pieces are active.

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
    if (!api?.buildAnimalPlaneAvatarModel || api.__animalShoulderRestInstalled) return false;
    const priorBuild = api.buildAnimalPlaneAvatarModel.bind(api); // Preserves base plane + head-rig + material-response wrappers already installed earlier.
    api.buildAnimalPlaneAvatarModel = function shoulderRestAwareAnimalBuild(THREE, spriteUrl, options = {}) {
      const avatarRef = priorBuild(THREE, spriteUrl, options);
      const rawRig = options?.headRig || window.HobunjiAnimalHeadRigSpecies?.resolveForOptions?.(options) || null;
      return rawRig?.shoulderRest?.enabled ? decorateAvatar(avatarRef, rawRig) : avatarRef;
    };
    api.__animalShoulderRestInstalled = true;
    return true;
  }

  window.AnimalShoulderRest = {
    version: 2,
    DEFAULT_GUIDE,
    normalizeRest,
    deformNormalizedPoint,
    sampleHeadInfluence,
    decorateAvatar,
    install,
  };
  install();
})();
