// Static shoulder-pet rest deformation for painted animal head rigs.
//
// This deliberately borrows only the simplest idea from the spline PNG rigger:
// bend longitudinal body slices along one smooth path. There is no animation
// timeline, region-mask system, or second paint map here. The existing Head
// Influence map remains the authority: rest deformation receives exactly the
// complementary body share (1 - headInfluence), so Head fights this rest pose
// by the same amount that it already fights the body bone.
(() => {
  'use strict';

  const MAX_BEND = 0.75; // Maximum midpoint displacement as a fraction of sprite height; author UI uses a narrower practical range.

  function finite(value, fallback) {
    const parsed = Number(value); // Used for hand-edited JSON and debug-safe authored values.
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value)); // Shared bounds helper for UVs, weights, and authored bend.
  }

  function normalizeRest(rawRig) {
    const raw = rawRig?.shoulderRest; // Optional authored shoulder-only rest descriptor stored beside the head rig.
    if (!raw || raw.enabled !== true) return null;
    return {
      enabled: true,
      bend: clamp(finite(raw.bend, 0), -MAX_BEND, MAX_BEND),
      centerV: clamp(finite(raw.centerV, rawRig?.pivot?.y ?? 0.5), 0, 1),
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
      const a = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
      const b = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
      return clamp(a * (1 - ty) + b * ty, 0, 1);
    }
    const region = normalizedRig?.legacyRegion;
    if (!region) return 0;
    return u >= region.x && u <= region.x + region.width && topV >= region.y && topV <= region.y + region.height ? 1 : 0;
  }

  // One quadratic body path. Endpoints remain on the original centerline and
  // `bend` is the visible midpoint displacement, not the Bezier control-point
  // displacement. That makes authoring intuitive: bend=.10 means the middle of
  // the body moves by 10% of sprite height.
  function restPoint(x, y, width, height, centerV, bend) {
    const safeWidth = Math.max(1e-6, Math.abs(width));
    const safeHeight = Math.max(1e-6, Math.abs(height));
    const u = clamp((x + safeWidth * 0.5) / safeWidth, 0, 1);
    const centerY = (0.5 - clamp(centerV, 0, 1)) * safeHeight;
    const mid = clamp(finite(bend, 0), -MAX_BEND, MAX_BEND) * safeHeight;
    const curveY = centerY + 4 * (1 - u) * u * mid;
    const tangentX = safeWidth;
    const tangentY = 4 * mid * (1 - 2 * u);
    const tangentLength = Math.hypot(tangentX, tangentY) || 1;
    const normalX = -tangentY / tangentLength;
    const normalY = tangentX / tangentLength;
    const offsetY = y - centerY;
    return {
      x: -safeWidth * 0.5 + u * safeWidth + normalX * offsetY,
      y: curveY + normalY * offsetY,
    };
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
    const dimensions = dimensionsForGeometry(geometry); // Used by the one-path rest transform below.
    const basePositions = new Float32Array(position.array); // Immutable bind/rest positions so toggling never accumulates deformation.
    const bodyWeights = new Float32Array(position.count); // Complement of Head Influence; exactly the requested competing body/rest share.
    for (let i = 0; i < position.count; i++) {
      const sourceU = mirrorX ? 1 - uv.getX(i) : uv.getX(i);
      const sourceTopV = 1 - uv.getY(i);
      bodyWeights[i] = 1 - sampleHeadInfluence(normalizedRig, sourceU, sourceTopV);
    }
    return { mesh, position, basePositions, bodyWeights, dimensions, rest, mirrorX };
  }

  function applyMeshState(meshState, enabled) {
    if (!meshState) return false;
    const { position, basePositions, bodyWeights, dimensions, rest, mesh } = meshState;
    for (let i = 0; i < position.count; i++) {
      const offset = i * position.itemSize;
      const baseX = basePositions[offset], baseY = basePositions[offset + 1];
      let x = baseX, y = baseY;
      if (enabled && Math.abs(rest.bend) > 1e-7) {
        const target = restPoint(baseX, baseY, dimensions.width, dimensions.height, rest.centerV, rest.bend);
        const bodyWeight = clamp(bodyWeights[i], 0, 1);
        x += (target.x - baseX) * bodyWeight;
        y += (target.y - baseY) * bodyWeight;
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
    const frontMesh = findRiggedMeshForBone(avatarRef.group, rigState.frontHeadBone);
    const backMesh = findRiggedMeshForBone(avatarRef.group, rigState.backHeadBone);
    const front = buildMeshState(frontMesh, normalizedRig, rest, false);
    const back = buildMeshState(backMesh, normalizedRig, rest, true);
    if (!front || !back) return avatarRef;

    const debug = {
      authored: true,
      enabled: false,
      bend: rest.bend,
      centerV: rest.centerV,
      frontVertices: front.position.count,
      backVertices: back.position.count,
    }; // Mobile/debug-readable proof of the authored rest rig and whether the shoulder role currently activates it.

    avatarRef.setShoulderRestEnabled = enabled => {
      const next = !!enabled;
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
    version: 1,
    normalizeRest,
    sampleHeadInfluence,
    restPoint,
    decorateAvatar,
    install,
  };
  install();
})();
