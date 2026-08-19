// Semantic coordinate frames shared by hand/tool authoring and runtime diagnostics.
//
// Tool basis is authored from three points on the raw PNG: haft butt, head/top,
// and blade/working side. Hand basis maps semantic Fingers/Thumb/Palm directions
// onto signed local axes of each reusable GLB profile. This module stores metadata
// only; existing grip transforms remain authoritative until a caller deliberately
// chooses to consume the semantic frame.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const toolGrips = global.HobunjiHandToolGrips;
  if (!profiles || !toolGrips) return;
  if (global.HobunjiHandToolSemanticBasis) return;

  const TOOL_BASIS_VERSION = 1;
  const HAND_BASIS_VERSION = 1;
  const EPSILON = 1e-6;
  const SIGNED_AXES = Object.freeze(['+x', '-x', '+y', '-y', '+z', '-z']);

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // Loaded/unloaded ranged sprites share one physical weapon basis.
  function toolBasisKeyFor(value) {
    const key = toolGrips.toolKeyFor?.(value) || normalizeKey(value);
    if (key.includes('crossbow')) return 'crossbow';
    if (key.includes('scatterbow')) return 'scatterbow';
    if (key.includes('pickshovel') || key.includes('pick-shovel')) return 'pickshovel';
    if (key.includes('fishingspear') || key.includes('fishing-spear')) return 'fishingspear';
    if (key.includes('fishingmace') || key.includes('fishing-mace')) return 'fishingmace';
    if (key.includes('hoe')) return 'hoe';
    if (key.includes('hatchet')) return 'hatchet';
    return key;
  }

  function clamp01(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
  }

  function normalizePoint2(raw) {
    return { u: clamp01(raw?.u), v: clamp01(raw?.v) };
  }

  function normalizeVector2(x, y) {
    const length = Math.hypot(x, y);
    if (!Number.isFinite(length) || length < EPSILON) return null;
    return { x: x / length, y: y / length };
  }

  function deriveToolBasis(rawMarkers) {
    const butt = rawMarkers?.butt ? normalizePoint2(rawMarkers.butt) : null;
    const head = rawMarkers?.head ? normalizePoint2(rawMarkers.head) : null;
    const working = rawMarkers?.working ? normalizePoint2(rawMarkers.working) : null;
    const markers = { butt, head, working };
    if (!butt || !head || !working) return { complete: false, markers, axes: null, error: 'Mark butt, head/top, and working side.' };

    // PNG V grows downward, so convert authored UV points to ordinary +Y-up
    // coordinates before deriving the semantic frame.
    const by = 1 - butt.v;
    const hy = 1 - head.v;
    const wy = 1 - working.v;
    const shaft = normalizeVector2(head.u - butt.u, hy - by);
    if (!shaft) return { complete: false, markers, axes: null, error: 'Haft butt and head/top are too close together.' };

    const workFromButt = { x: working.u - butt.u, y: wy - by };
    const along = workFromButt.x * shaft.x + workFromButt.y * shaft.y;
    const lateral = {
      x: workFromButt.x - shaft.x * along,
      y: workFromButt.y - shaft.y * along,
    };
    const blade = normalizeVector2(lateral.x, lateral.y);
    if (!blade) return { complete: false, markers, axes: null, error: 'Working-side point must be off the haft centerline.' };

    // Canonical tool frame: +Y follows butt→head, +X points toward the working
    // edge, and +Z is the corresponding normal of the raw PNG plane.
    const zSign = blade.x * shaft.y - blade.y * shaft.x >= 0 ? 1 : -1;
    return {
      complete: true,
      markers,
      axes: {
        x: { x: blade.x, y: blade.y },
        y: { x: shaft.x, y: shaft.y },
        zSign,
      },
      error: null,
    };
  }

  function ensureToolEntry(data, key) {
    if (!data.tools) data.tools = {};
    if (!data.tools[key]) data.tools[key] = {};
    return data.tools[key];
  }

  function toolBasisFor(value) {
    const key = toolBasisKeyFor(value);
    const raw = toolGrips.data?.tools?.[key]?.semanticBasis || null;
    const derived = deriveToolBasis(raw?.markers || raw);
    return {
      key,
      version: TOOL_BASIS_VERSION,
      ...derived,
      canonical: { x: 'working-side', y: 'haft-butt-to-head', z: 'sprite-plane-normal' },
    };
  }

  function setToolMarker(value, markerName, point) {
    if (!['butt', 'head', 'working'].includes(markerName)) return null;
    const key = toolBasisKeyFor(value);
    if (!key) return null;
    toolGrips.mutate(data => {
      const entry = ensureToolEntry(data, key);
      const markers = {
        ...(entry.semanticBasis?.markers || {}),
        [markerName]: normalizePoint2(point),
      };
      const derived = deriveToolBasis(markers);
      entry.semanticBasis = {
        version: TOOL_BASIS_VERSION,
        markers: derived.markers,
        axes: derived.axes,
        canonical: { x: 'working-side', y: 'haft-butt-to-head', z: 'sprite-plane-normal' },
      };
    });
    return toolBasisFor(key);
  }

  function clearToolBasis(value) {
    const key = toolBasisKeyFor(value);
    if (!key) return false;
    toolGrips.mutate(data => {
      const entry = data.tools?.[key];
      if (entry) delete entry.semanticBasis;
    });
    return true;
  }

  function signedAxisVector(value) {
    const key = String(value || '').trim().toLowerCase();
    if (!SIGNED_AXES.includes(key)) return null;
    const sign = key[0] === '-' ? -1 : 1;
    const axis = key[1];
    return {
      x: axis === 'x' ? sign : 0,
      y: axis === 'y' ? sign : 0,
      z: axis === 'z' ? sign : 0,
    };
  }

  function axisLetter(value) {
    const key = String(value || '').trim().toLowerCase();
    return SIGNED_AXES.includes(key) ? key[1] : null;
  }

  function validateHandAxes(raw = {}) {
    const fingers = String(raw.fingers || '').toLowerCase();
    const thumb = String(raw.thumb || '').toLowerCase();
    const palm = String(raw.palm || '').toLowerCase();
    if (![fingers, thumb, palm].every(value => SIGNED_AXES.includes(value))) {
      return { complete: false, valid: false, error: 'Choose Fingers, Thumb, and Palm axes.' };
    }
    const letters = [axisLetter(fingers), axisLetter(thumb), axisLetter(palm)];
    if (new Set(letters).size !== 3) {
      return { complete: true, valid: false, error: 'Fingers, Thumb, and Palm must use three different local axes.' };
    }
    const fv = signedAxisVector(fingers);
    const tv = signedAxisVector(thumb);
    const pv = signedAxisVector(palm);
    const cross = {
      x: tv.y * fv.z - tv.z * fv.y,
      y: tv.z * fv.x - tv.x * fv.z,
      z: tv.x * fv.y - tv.y * fv.x,
    };
    const determinant = cross.x * pv.x + cross.y * pv.y + cross.z * pv.z;
    return {
      complete: true,
      valid: true,
      error: null,
      axes: { fingers, thumb, palm },
      vectors: { fingers: fv, thumb: tv, palm: pv },
      handedness: determinant >= 0 ? 'right-handed' : 'left-handed',
    };
  }

  function handBasisForModel(modelKey) {
    const model = profiles.data?.models?.[modelKey] || null;
    const raw = model?.semanticBasis?.axes || model?.semanticBasis || {};
    const validated = validateHandAxes(raw);
    return {
      modelKey: modelKey || null,
      version: HAND_BASIS_VERSION,
      ...validated,
      canonical: { x: 'thumb-side', y: 'wrist-to-fingers', z: 'palm-facing' },
    };
  }

  function handBasisForSpecies(speciesId) {
    return handBasisForModel(profiles.modelKeyForSpecies?.(speciesId));
  }

  function setHandAxesForModel(modelKey, rawAxes) {
    const validated = validateHandAxes(rawAxes);
    if (!modelKey || !validated.valid) return validated;
    profiles.mutate(data => {
      const model = data.models?.[modelKey];
      if (!model) return;
      model.semanticBasis = {
        version: HAND_BASIS_VERSION,
        axes: { ...validated.axes },
        vectors: JSON.parse(JSON.stringify(validated.vectors)),
        handedness: validated.handedness,
        canonical: { x: 'thumb-side', y: 'wrist-to-fingers', z: 'palm-facing' },
      };
    });
    return handBasisForModel(modelKey);
  }

  function clearHandBasisForModel(modelKey) {
    const model = profiles.data?.models?.[modelKey];
    if (!model) return false;
    profiles.mutate(data => {
      if (data.models?.[modelKey]) delete data.models[modelKey].semanticBasis;
    });
    return true;
  }

  global.HobunjiHandToolSemanticBasis = Object.freeze({
    signedAxes: SIGNED_AXES,
    toolBasisKeyFor,
    deriveToolBasis,
    toolBasisFor,
    setToolMarker,
    clearToolBasis,
    validateHandAxes,
    handBasisForModel,
    handBasisForSpecies,
    setHandAxesForModel,
    clearHandBasisForModel,
  });
})(window);
