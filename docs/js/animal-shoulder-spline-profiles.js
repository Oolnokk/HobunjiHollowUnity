// Shoulder-spline species registration and temporary shared defaults.
//
// Only the five explicitly approved species receive shoulder-body spline support
// for now. Gar-wolf/Dabinggi keep their own head paint. Voorg-Ass/Uumkao'ii get
// a body-only support rig so the same skinned plane can carry the shoulder spline.
(() => {
  'use strict';

  const STORAGE_KEY = window.AnimalHeadRigRuntime?.STORAGE_KEY || 'hobunji_animal_head_rigs_v1';
  const SPECIES = Object.freeze(['grehlr', 'voorg-ass', 'uumkaoii', 'gar-wolf', 'dabinggi-hound']);
  const SPECIES_SET = new Set(SPECIES);
  const GREHLR_BEFORE = Object.freeze([
    Object.freeze({ x: 0.5423902927484727, y: 0.5694472546137244 }),
    Object.freeze({ x: 0.6186585216238391, y: 0.5699873777199718 }),
    Object.freeze({ x: 0.6949267504992058, y: 0.5705275018262192 }),
    Object.freeze({ x: 0.7711949793745724, y: 0.5710676259324666 }),
    Object.freeze({ x: 0.8474632082499391, y: 0.5716077500387129 }),
    Object.freeze({ x: 0.9237314371253056, y: 0.5721478741449592 }),
    Object.freeze({ x: 0.9999996666666666, y: 0.572691993389205 }),
  ]);
  const GREHLR_AFTER = Object.freeze([
    Object.freeze({ x: 0.5423902927484727, y: 0.5694472546137244 }),
    Object.freeze({ x: 0.579994260541451, y: 0.6169784772869725 }),
    Object.freeze({ x: 0.6084907256392884, y: 0.6754227565965308 }),
    Object.freeze({ x: 0.6278317471892272, y: 0.7447892691279848 }),
    Object.freeze({ x: 0.6379693486738414, y: 0.8250870055447984 }),
    Object.freeze({ x: 0.6388555185871044, y: 0.9163247704588463 }),
    Object.freeze({ x: 0.6304422111109205, y: 1.0185111823033606 }),
  ]);
  const FALLBACK_GREHLR_SHOULDER = Object.freeze({
    enabled: true, useSpline: true, useRun1: false, splitFrame: true,
    splitRightUsesIdle: true, frameShiftX: 0.52, followFrameShiftX: true,
    beforePoints: GREHLR_BEFORE, afterPoints: GREHLR_AFTER,
  });

  function normalizeKind(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function canonicalKind(value) {
    const normalized = normalizeKind(value);
    if (normalized === 'uumkao-ii' || normalized === 'uumkaoii') return 'uumkaoii';
    if (normalized === 'dabinggi-hound') return 'dabinggi-hound';
    if (normalized === 'gar-wolf') return 'gar-wolf';
    if (normalized === 'voorg-ass') return 'voorg-ass';
    if (normalized === 'grehlr') return 'grehlr';
    const aliases = window.CreatureGenetics?.SPECIES_ALIAS || {}, aliased = normalizeKind(aliases[normalized]);
    return SPECIES_SET.has(aliased) ? aliased : normalized;
  }
  function deepClone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  function defaultShoulderRest() {
    const authored = window.HobunjiGrehlrHeadRigCorrection?.authored?.shoulderRest;
    const normalized = window.AnimalShoulderSpline?.normalizeRest?.({ shoulderRest: authored });
    if (normalized) {
      return {
        enabled: true, useSpline: true, useRun1: false, splitFrame: true,
        splitRightUsesIdle: true, frameShiftX: normalized.frameShiftX,
        followFrameShiftX: true,
        beforePoints: deepClone(normalized.beforePoints),
        afterPoints: deepClone(normalized.afterPoints),
      };
    }
    return deepClone(FALLBACK_GREHLR_SHOULDER);
  }
  function bodyOnlyRig() {
    return {
      enabled: true, coordinateSpace: 'sprite-normalized-top-left', pivot: { x: 0.5, y: 0.5 },
      weightMap: { width: 2, height: 2, encoding: 'rle-u9', unsetValue: 256, data: [4, 0] },
      minDeg: -30, maxDeg: 30, restDeg: 0, turnSpeedDeg: 120, meshResolution: 48,
      shoulderRest: defaultShoulderRest(),
    };
  }
  function readPreviewRigs() {
    try { const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
    catch (_) { return {}; }
  }
  function kindFromOptions(options = {}, spriteUrl = '') {
    const explicit = canonicalKind(options.creatureId || options.animalId || options.kind);
    if (SPECIES_SET.has(explicit)) return explicit;
    const name = normalizeKind(options.name);
    for (const species of SPECIES) if (name === species || name.startsWith(species + '-')) return species;
    const sprite = normalizeKind(spriteUrl);
    if (sprite.includes('uumkaoii')) return 'uumkaoii';
    for (const species of SPECIES) if (sprite.includes(species)) return species;
    return explicit || '';
  }

  const renderer = window.CreatureGeneticsRender;
  const previousHeadRigForKind = typeof renderer?.headRigForKind === 'function' ? renderer.headRigForKind.bind(renderer) : null;
  function withDefaultShoulder(kind, rawRig) {
    const canonical = canonicalKind(kind);
    if (!SPECIES_SET.has(canonical)) return rawRig || null;
    const rig = deepClone(rawRig || bodyOnlyRig());
    if (!rig.shoulderRest) rig.shoulderRest = defaultShoulderRest();
    return rig;
  }
  function resolveForKind(kind) {
    const canonical = canonicalKind(kind);
    if (!canonical) return null;
    const preview = readPreviewRigs(), previewRig = preview[kind] || preview[canonical];
    if (previewRig) return withDefaultShoulder(canonical, previewRig);
    const committed = previousHeadRigForKind?.(canonical) || renderer?.ANIMAL_HEAD_RIGS?.[canonical] || null;
    if (committed) return withDefaultShoulder(canonical, committed);
    return SPECIES_SET.has(canonical) ? bodyOnlyRig() : null;
  }
  function resolveForOptions(options = {}, spriteUrl = '') {
    const kind = kindFromOptions(options, spriteUrl), direct = options?.headRig || options?.animal?.headRig || null;
    if (direct) return SPECIES_SET.has(kind) ? withDefaultShoulder(kind, direct) : direct;
    return kind ? resolveForKind(kind) : null;
  }
  function install() {
    if (!renderer || renderer.__shoulderSplineProfilesInstalled) return !!renderer;
    renderer.headRigForKind = resolveForKind;
    renderer.__shoulderSplineProfilesInstalled = true;
    for (const kind of ['grehlr', 'gar-wolf', 'dabinggi-hound']) {
      const rig = renderer.ANIMAL_HEAD_RIGS?.[kind];
      if (rig && !rig.shoulderRest) rig.shoulderRest = defaultShoulderRest();
    }
    return true;
  }

  window.HobunjiShoulderSplineProfiles = {
    version: 2, species: SPECIES, allows: kind => SPECIES_SET.has(canonicalKind(kind)), canonicalKind, kindFromOptions,
    defaultShoulderRest, bodyOnlyRig, supportRigFor: resolveForKind, resolveForOptions, install,
  };
  install();
})();
