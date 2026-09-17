// Asymmetric compression/stretch response for painted animal head rigs.
//
// The base head/body weight map still decides what belongs to the head and how
// the neck seam blends. These optional material maps only change how strongly
// that existing blend yields on the inside (compression) versus outside
// (stretch) of a pitch bend. Fully-body and fully-head vertices stay exactly
// anchored to their original bones, so material painting cannot detach a head.
(() => {
  'use strict';

  const UNSET_WEIGHT = 256; // Response-map eraser value; unset means legacy/full response (1.0).
  const RESPONSE_EPSILON = 1e-5; // Used to treat rest/pivot-line vertices as neutral and skip redundant uploads.

  function finite(value, fallback) {
    const parsed = Number(value); // Used by map decoding and diagnostics to reject NaN/infinite authored values.
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value)); // Shared bounds helper for response values and UV coordinates.
  }

  function decodeResponseMap(raw) {
    if (!raw || !Number.isFinite(Number(raw.width)) || !Number.isFinite(Number(raw.height))) return null;
    const width = Math.max(1, Math.round(Number(raw.width))); // Grid width used for bilinear response sampling.
    const height = Math.max(1, Math.round(Number(raw.height))); // Grid height used for bilinear response sampling.
    const values = new Uint16Array(width * height); // 0..255 authored response; 256 means default 100% response.
    values.fill(UNSET_WEIGHT);
    if (raw.encoding === 'rle-u9' && Array.isArray(raw.data)) {
      let cursor = 0;
      for (let i = 0; i + 1 < raw.data.length && cursor < values.length; i += 2) {
        const run = Math.max(0, Math.round(finite(raw.data[i], 0))); // Number of grid cells in this encoded run.
        const value = clamp(Math.round(finite(raw.data[i + 1], UNSET_WEIGHT)), 0, UNSET_WEIGHT); // Authored response or unset sentinel.
        const end = Math.min(values.length, cursor + run);
        values.fill(value, cursor, end);
        cursor = end;
      }
    } else if (Array.isArray(raw.data)) {
      for (let i = 0; i < values.length && i < raw.data.length; i++) {
        values[i] = clamp(Math.round(finite(raw.data[i], UNSET_WEIGHT)), 0, UNSET_WEIGHT);
      }
    } else {
      return null;
    }
    return { width, height, values };
  }

  function sampleResponseMap(map, u, topV) {
    if (!map) return 1; // Missing response maps preserve the exact pre-feature deformation.
    const fx = clamp(u, 0, 1) * Math.max(0, map.width - 1);
    const fy = clamp(topV, 0, 1) * Math.max(0, map.height - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(map.width - 1, x0 + 1), y1 = Math.min(map.height - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const at = (x, y) => {
      const value = map.values[y * map.width + x];
      return value === UNSET_WEIGHT ? 1 : clamp(value, 0, 255) / 255;
    };
    const a = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
    const b = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
    return clamp(a * (1 - ty) + b * ty, 0, 1);
  }

  function responseKindForVertex(angleDeg, sourceTopV, pivotTopV) {
    const bend = finite(angleDeg, 0); // Positive is the existing animal-rig "down" convention; negative is "up".
    const side = finite(sourceTopV, pivotTopV) - finite(pivotTopV, 0.5); // Positive is below the pivot in top-left sprite coordinates.
    if (Math.abs(bend) <= RESPONSE_EPSILON || Math.abs(side) <= RESPONSE_EPSILON) return 'neutral';
    return bend * side > 0 ? 'compress' : 'stretch'; // Down bends compress below; up bends compress above for the current side-view rigs.
  }

  function effectiveBlendWeight(baseHeadWeight, response) {
    const base = clamp(finite(baseHeadWeight, 0), 0, 1); // Original head-bone share from the existing influence map.
    if (base <= RESPONSE_EPSILON || base >= 1 - RESPONSE_EPSILON) return base;
    const allowed = clamp(finite(response, 1), 0, 1); // 0 = resists that deformation type; 1 = legacy/full deformation.
    const seamGate = 4 * base * (1 - base); // Peaks at the 50/50 seam and smoothly falls to zero at both rigid endpoints.
    return clamp(base * (1 - seamGate * (1 - allowed)), 0, 1);
  }

  function responseMapForRig(rawRig) {
    const compressibility = decodeResponseMap(rawRig?.compressibilityMap); // Optional inside-bend response authored in the Head Rigger.
    const stretchability = decodeResponseMap(rawRig?.stretchabilityMap); // Optional outside-bend response authored in the Head Rigger.
    return compressibility || stretchability ? { compressibility, stretchability } : null;
  }

  function findRiggedMeshForBone(group, bone) {
    if (!group || !bone) return null;
    return (group.children || []).find(child => child?.isSkinnedMesh && child.skeleton?.bones?.includes?.(bone)) || null;
  }

  function buildMeshResponseState(mesh, rawRig, decoded, mirrorX) {
    const geometry = mesh?.geometry;
    const uv = geometry?.getAttribute?.('uv');
    const skinWeight = geometry?.getAttribute?.('skinWeight');
    if (!uv || !skinWeight || skinWeight.itemSize < 2 || uv.count !== skinWeight.count) return null;
    const count = uv.count;
    const baseHeadWeights = new Float32Array(count); // Immutable baseline used every update so response changes never accumulate drift.
    const compressibilities = new Float32Array(count); // Pre-sampled response values avoid bilinear map sampling every animation frame.
    const stretchabilities = new Float32Array(count); // Pre-sampled response values avoid bilinear map sampling every animation frame.
    const sourceTopVs = new Float32Array(count); // Used to decide which side of the bend each vertex occupies.
    for (let i = 0; i < count; i++) {
      const sourceU = mirrorX ? 1 - uv.getX(i) : uv.getX(i); // Reverse-facing plane samples the horizontally mirrored author maps.
      const sourceTopV = 1 - uv.getY(i); // Author maps use top-left origin; Three UVs use bottom-left origin.
      baseHeadWeights[i] = clamp(skinWeight.getY(i), 0, 1);
      compressibilities[i] = sampleResponseMap(decoded.compressibility, sourceU, sourceTopV);
      stretchabilities[i] = sampleResponseMap(decoded.stretchability, sourceU, sourceTopV);
      sourceTopVs[i] = sourceTopV;
    }
    return { mesh, skinWeight, baseHeadWeights, compressibilities, stretchabilities, sourceTopVs, mirrorX, lastAppliedDeg: NaN };
  }

  function applyMeshResponse(meshState, angleDeg, pivotTopV) {
    if (!meshState) return { changed: false, compressed: 0, stretched: 0, neutral: 0 };
    if (Number.isFinite(meshState.lastAppliedDeg) && Math.abs(meshState.lastAppliedDeg - angleDeg) <= RESPONSE_EPSILON) {
      return { changed: false, compressed: 0, stretched: 0, neutral: 0 };
    }
    const weights = meshState.skinWeight.array;
    let compressed = 0, stretched = 0, neutral = 0;
    for (let i = 0; i < meshState.baseHeadWeights.length; i++) {
      const base = meshState.baseHeadWeights[i];
      const kind = responseKindForVertex(angleDeg, meshState.sourceTopVs[i], pivotTopV);
      const response = kind === 'compress'
        ? meshState.compressibilities[i]
        : kind === 'stretch'
          ? meshState.stretchabilities[i]
          : 1;
      const effective = effectiveBlendWeight(base, response);
      const offset = i * meshState.skinWeight.itemSize;
      weights[offset] = 1 - effective;
      weights[offset + 1] = effective;
      for (let component = 2; component < meshState.skinWeight.itemSize; component++) weights[offset + component] = 0;
      if (kind === 'compress') compressed++;
      else if (kind === 'stretch') stretched++;
      else neutral++;
    }
    meshState.skinWeight.needsUpdate = true;
    meshState.lastAppliedDeg = angleDeg;
    return { changed: true, compressed, stretched, neutral };
  }

  function decorateAvatar(avatarRef, rawRig) {
    if (!avatarRef?.headRig || avatarRef.headMaterialResponse?.active) return avatarRef;
    const decoded = responseMapForRig(rawRig);
    if (!decoded) return avatarRef; // Old rigs incur no dynamic skin-weight work at all.
    const state = avatarRef.headRig;
    const group = avatarRef.group;
    const frontMesh = findRiggedMeshForBone(group, state.frontHeadBone); // Front weighted card created by png-plane-avatar.js.
    const backMesh = findRiggedMeshForBone(group, state.backHeadBone); // Mirrored reverse card created by png-plane-avatar.js.
    const front = buildMeshResponseState(frontMesh, rawRig, decoded, false);
    const back = buildMeshResponseState(backMesh, rawRig, decoded, true);
    if (!front || !back) return avatarRef;

    const debug = {
      active: true,
      lastAngleDeg: NaN,
      lastFront: null,
      lastBack: null,
      maps: {
        compressibility: !!decoded.compressibility,
        stretchability: !!decoded.stretchability,
      },
    }; // Mobile-visible avatarRef diagnostic; no console is required to confirm the feature is active.

    const applyCurrentResponse = () => {
      const angleDeg = finite(state.appliedDeg, state.currentDeg || 0); // Includes additive nods because png-plane-avatar stores the composed angle here.
      if (Number.isFinite(debug.lastAngleDeg) && Math.abs(debug.lastAngleDeg - angleDeg) <= RESPONSE_EPSILON) return angleDeg;
      debug.lastFront = applyMeshResponse(front, angleDeg, finite(rawRig?.pivot?.y, state.rig?.pivot?.y ?? 0.5));
      debug.lastBack = applyMeshResponse(back, angleDeg, finite(rawRig?.pivot?.y, state.rig?.pivot?.y ?? 0.5));
      debug.lastAngleDeg = angleDeg;
      return angleDeg;
    };

    const wrapAfter = methodName => {
      const original = avatarRef[methodName]; // Existing public head-rig method retained and called before response weights are refreshed.
      if (typeof original !== 'function') return;
      avatarRef[methodName] = function materialResponsiveHeadMethod(...args) {
        const result = original.apply(this, args);
        applyCurrentResponse();
        return result;
      };
    };
    wrapAfter('setHeadRotation');
    wrapAfter('updateHeadRotation');
    wrapAfter('setHeadAdditiveRotation');
    // Yaw is intentionally untouched in this first pass: the current request only separates compression/stretch response for the existing pitch bend.

    debug.applyNow = applyCurrentResponse; // Used by in-game/debug tooling to force-refresh after live data edits.
    debug.dump = () => ({
      active: debug.active,
      lastAngleDeg: debug.lastAngleDeg,
      maps: { ...debug.maps },
      front: debug.lastFront ? { ...debug.lastFront } : null,
      back: debug.lastBack ? { ...debug.lastBack } : null,
    });
    avatarRef.headMaterialResponse = debug;
    group.userData.hobunjiHeadMaterialResponse = debug;
    applyCurrentResponse();
    return avatarRef;
  }

  function drainPending() {
    const pending = window.__hobunjiPendingAnimalHeadMaterialResponses; // Build calls made before this module finished loading are queued by creature-head-cache.js.
    if (!Array.isArray(pending) || !pending.length) return 0;
    let decorated = 0;
    while (pending.length) {
      const entry = pending.shift();
      if (!entry?.avatarRef || !entry?.rawRig) continue;
      decorateAvatar(entry.avatarRef, entry.rawRig);
      decorated++;
    }
    return decorated;
  }

  window.AnimalHeadMaterialResponse = {
    UNSET_WEIGHT,
    decodeResponseMap,
    sampleResponseMap,
    responseKindForVertex,
    effectiveBlendWeight,
    decorateAvatar,
    drainPending,
  };
  drainPending();
})();
