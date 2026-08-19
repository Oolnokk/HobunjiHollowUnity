// Semantic coordinate frames shared by hand/tool authoring and runtime presentation.
//
// Tool basis is authored from three points on the raw PNG: haft butt, head/top,
// and blade/working side. Hand basis maps semantic Fingers/Thumb/Palm directions
// onto signed local axes of each reusable GLB profile. Approved authoring results
// live here as fallbacks; explicit editor/profile data can override them later.
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

  // First visually approved semantic basis. These exact raw-PNG marker coordinates
  // are the source of truth for the hatchet until the author explicitly overrides it.
  const APPROVED_TOOL_BASES = Object.freeze({
    hatchet: Object.freeze({
      version: TOOL_BASIS_VERSION,
      markers: Object.freeze({
        butt: Object.freeze({ u: 0.3612074435865743, v: 0.31670838948802604 }),
        head: Object.freeze({ u: 0.4270044884741022, v: 0.8571504134000086 }),
        working: Object.freeze({ u: 0.7559960381062183, v: 0.8049483838056785 }),
      }),
    }),
  });

  // First visually approved hand-model semantic basis. Feline raw local -Y points
  // toward the fingers, +X toward the thumb, and -Z outward from the palm.
  const APPROVED_HAND_BASES = Object.freeze({
    feline: Object.freeze({
      version: HAND_BASIS_VERSION,
      axes: Object.freeze({ fingers: '-y', thumb: '+x', palm: '-z' }),
    }),
  });

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

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

  function rawToolBasis(key) {
    const authored = toolGrips.data?.tools?.[key]?.semanticBasis || null;
    if (authored) return { raw: authored, source: 'authored' };
    const approved = APPROVED_TOOL_BASES[key] || null;
    return { raw: approved, source: approved ? 'approved-default' : 'none' };
  }

  function toolBasisFor(value) {
    const key = toolBasisKeyFor(value);
    const selected = rawToolBasis(key);
    const derived = deriveToolBasis(selected.raw?.markers || selected.raw);
    return {
      key,
      version: TOOL_BASIS_VERSION,
      source: selected.source,
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
      const startingMarkers = entry.semanticBasis?.markers
        || APPROVED_TOOL_BASES[key]?.markers
        || {};
      const markers = {
        ...clone(startingMarkers),
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

  function negateVector3(vector) {
    if (!vector) return null;
    return { x: -(Number(vector.x) || 0), y: -(Number(vector.y) || 0), z: -(Number(vector.z) || 0) };
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
    const handedness = determinant >= 0 ? 'right-handed' : 'left-handed';
    return {
      complete: true,
      valid: true,
      error: null,
      axes: { fingers, thumb, palm },
      vectors: { fingers: fv, thumb: tv, palm: pv },
      handedness,
      // A quaternion can only represent a proper/right-handed orthonormal basis.
      // Left-handed authoring is preserved as metadata and previewable, but callers
      // must not silently pretend a reflection is a rotation.
      rotationSupported: handedness === 'right-handed',
    };
  }

  function handBasisForModel(modelKey) {
    const model = profiles.data?.models?.[modelKey] || null;
    const authored = model?.semanticBasis || null;
    const approved = APPROVED_HAND_BASES[modelKey] || null;
    const raw = authored || approved || {};
    const validated = validateHandAxes(raw?.axes || raw);
    return {
      modelKey: modelKey || null,
      version: HAND_BASIS_VERSION,
      source: authored ? 'authored' : approved ? 'approved-default' : 'none',
      ...validated,
      canonical: { x: 'thumb-side', y: 'wrist-to-fingers', z: 'palm-facing' },
    };
  }

  function handBasisForSpecies(speciesId) {
    return handBasisForModel(profiles.modelKeyForSpecies?.(speciesId));
  }

  function semanticHandVectorForModel(modelKey, semanticName) {
    const basis = handBasisForModel(modelKey);
    return basis?.valid ? clone(basis.vectors?.[semanticName] || null) : null;
  }

  function handWristVectorForModel(modelKey) {
    return negateVector3(semanticHandVectorForModel(modelKey, 'fingers'));
  }

  function handWristVectorForSpecies(speciesId) {
    return handWristVectorForModel(profiles.modelKeyForSpecies?.(speciesId));
  }

  // Hand visual normalization should measure along the fingers/wrist anatomical
  // axis, not blindly along raw Y. Missing semantic data deliberately retains Y.
  function handFitAxisForModel(modelKey) {
    const basis = handBasisForModel(modelKey);
    return basis?.valid ? (axisLetter(basis.axes?.fingers) || 'y') : 'y';
  }

  // Converting a source left/right hand into the opposite side must reflect the
  // anatomical thumb axis. Before semantic authoring existed this was assumed X.
  function handSourceMirrorAxisForModel(modelKey) {
    const basis = handBasisForModel(modelKey);
    return basis?.valid ? (axisLetter(basis.axes?.thumb) || 'x') : 'x';
  }

  function handTransformAuditForModel(modelKey) {
    const basis = handBasisForModel(modelKey);
    return {
      modelKey: modelKey || null,
      source: basis?.source || 'none',
      valid: basis?.valid === true,
      handedness: basis?.handedness || null,
      rotationSupported: basis?.rotationSupported === true,
      axes: basis?.axes ? { ...basis.axes } : null,
      fitAxis: handFitAxisForModel(modelKey),
      sourceMirrorAxis: handSourceMirrorAxisForModel(modelKey),
      wristVector: handWristVectorForModel(modelKey),
    };
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
        vectors: clone(validated.vectors),
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

  function normalizeQuaternion(raw) {
    const x = Number(raw?.x) || 0;
    const y = Number(raw?.y) || 0;
    const z = Number(raw?.z) || 0;
    const w = Number.isFinite(Number(raw?.w)) ? Number(raw.w) : 1;
    const length = Math.hypot(x, y, z, w) || 1;
    return { x: x / length, y: y / length, z: z / length, w: w / length };
  }

  function multiplyQuaternion(a, b) {
    return normalizeQuaternion({
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    });
  }

  // Converts a row-major proper 3x3 rotation matrix into a plain quaternion.
  // Keeping this Three-independent lets editor ESM Three and gameplay r128 consume
  // exactly the same semantic correction without sharing Object3D instances.
  function quaternionFromMatrix3(m) {
    const m11 = Number(m?.[0]) || 0;
    const m12 = Number(m?.[1]) || 0;
    const m13 = Number(m?.[2]) || 0;
    const m21 = Number(m?.[3]) || 0;
    const m22 = Number(m?.[4]) || 0;
    const m23 = Number(m?.[5]) || 0;
    const m31 = Number(m?.[6]) || 0;
    const m32 = Number(m?.[7]) || 0;
    const m33 = Number(m?.[8]) || 0;
    const trace = m11 + m22 + m33;
    let x;
    let y;
    let z;
    let w;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      w = 0.25 / s;
      x = (m32 - m23) * s;
      y = (m13 - m31) * s;
      z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2 * Math.sqrt(Math.max(EPSILON, 1 + m11 - m22 - m33));
      w = (m32 - m23) / s;
      x = 0.25 * s;
      y = (m12 + m21) / s;
      z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2 * Math.sqrt(Math.max(EPSILON, 1 + m22 - m11 - m33));
      w = (m13 - m31) / s;
      x = (m12 + m21) / s;
      y = 0.25 * s;
      z = (m23 + m32) / s;
    } else {
      const s = 2 * Math.sqrt(Math.max(EPSILON, 1 + m33 - m11 - m22));
      w = (m21 - m12) / s;
      x = (m13 + m31) / s;
      y = (m23 + m32) / s;
      z = 0.25 * s;
    }
    return normalizeQuaternion({ x, y, z, w });
  }

  function toolRawToCanonicalQuaternionFor(value) {
    const basis = toolBasisFor(value);
    if (!basis.complete || !basis.axes) return null;
    const x = basis.axes.x;
    const y = basis.axes.y;
    const z = basis.axes.zSign;
    return quaternionFromMatrix3([
      x.x, x.y, 0,
      y.x, y.y, 0,
      0, 0, z,
    ]);
  }

  // Tool holders historically expect a normal vertical sprite to be laid flat
  // with its semantic +Y/head direction toward engine -Z. Keep that established
  // holder convention, but derive the correction from authored semantics instead
  // of assuming the raw PNG itself was vertical/top-up.
  function toolEngineQuaternionFor(value) {
    const rawToCanonical = toolRawToCanonicalQuaternionFor(value);
    if (!rawToCanonical) return null;
    const half = -Math.PI / 4;
    const layFlat = { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) };
    return multiplyQuaternion(layFlat, rawToCanonical);
  }

  function handRawToCanonicalQuaternionForModel(modelKey) {
    const basis = handBasisForModel(modelKey);
    if (!basis.valid || !basis.vectors || basis.rotationSupported !== true) return null;
    const x = basis.vectors.thumb;
    const y = basis.vectors.fingers;
    const z = basis.vectors.palm;
    return quaternionFromMatrix3([
      x.x, x.y, x.z,
      y.x, y.y, y.z,
      z.x, z.y, z.z,
    ]);
  }

  function handRawToCanonicalQuaternionForSpecies(speciesId) {
    return handRawToCanonicalQuaternionForModel(profiles.modelKeyForSpecies?.(speciesId));
  }

  global.HobunjiHandToolSemanticBasis = Object.freeze({
    signedAxes: SIGNED_AXES,
    approvedDefaults: Object.freeze({ tools: APPROVED_TOOL_BASES, hands: APPROVED_HAND_BASES }),
    toolBasisKeyFor,
    deriveToolBasis,
    toolBasisFor,
    setToolMarker,
    clearToolBasis,
    signedAxisVector,
    axisLetter,
    validateHandAxes,
    handBasisForModel,
    handBasisForSpecies,
    semanticHandVectorForModel,
    handWristVectorForModel,
    handWristVectorForSpecies,
    handFitAxisForModel,
    handSourceMirrorAxisForModel,
    handTransformAuditForModel,
    setHandAxesForModel,
    clearHandBasisForModel,
    toolRawToCanonicalQuaternionFor,
    toolEngineQuaternionFor,
    handRawToCanonicalQuaternionForModel,
    handRawToCanonicalQuaternionForSpecies,
  });
})(window);
