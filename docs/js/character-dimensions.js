// Species+gender character dimensions: read-only height/width/head numbers
// that REFLECT the body's transform stack instead of driving it.
//
// A character's rendered size is the product of several independent layers,
// none of which is "the height" on its own:
//   1. PNG art: where the opaque body and the base head actually sit inside
//      the square portrait canvas (per species+gender art).
//   2. portraitScale (PNGPlaneAvatar.avatarScaleMultiplierFor, incl. child
//      multiplier) -> modelWidth/modelHeight of the portrait plane.
//   3. portrait Y offset (portraitVerticalPlacementRatio) -> assemblyY.
//   4. whole-character rig scale x/y around floor Y=0 (HobunjiCharacterRigScale).
//   5. head scale + head Y offset (+ per-NPC age hunch) at the neck bone.
//
// This module measures (1) ONCE per session by rendering an undecorated base
// portrait (no hair/hats/hoods/clothing cosmetics) for
// every species+gender through the canonical portrait renderer (body without
// its head, and the base head alone), then composes
// (2)-(5) on demand from the live config, so an editor tweak to any of those
// is reflected immediately without re-scanning pixels.
//
// All outputs are floor-relative world units in the character's own frame
// (Y=0 is the floor, X=0 is the portrait centre, +X = viewer's right). Use
// lengthForHeightPercent() to size things (e.g. weapons) as a percentage of a
// character's height.
(() => {
  'use strict';

  const COSMETIC_KEYS = ['hair', 'hairFront', 'hairBack', 'hairSide', 'hairSideL', 'hood', 'hat', 'facialHair', 'pauldron', 'torsoCosmetic', 'armCosmetic'];
  const DEFAULT_ALPHA_THRESHOLD = 8;
  // Rest-pose stand-in for the breathing composer: no deform, neutral mouth, so
  // measurements never depend on where a breath cycle happened to be.
  const STILL_COMPOSER = Object.freeze({
    getInterpolatedPoints: () => null,
    getOverlayOnlyPoints: () => null,
    getAnimData: () => null,
    getExpression: () => 'neutral',
  });
  const measurements = new Map(); // "species::gender" (portrait art species, not transform alias) -> normalized pixel fractions.
  const listeners = new Set();
  let readyPromise = null;
  let status = 'idle';

  const normalizeSpecies = value => String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-');
  const normalizeGender = value => {
    const g = String(value || '').trim().toLowerCase();
    return g === 'female' || g === 'f' ? 'female' : 'male';
  };
  const keyFor = (species, gender) => `${normalizeSpecies(species)}::${normalizeGender(gender)}`;
  const positive = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const avatarCfg = () => window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {};
  const transformSpecies = species => (typeof window.hobunjiTransformSpeciesId === 'function'
    ? normalizeSpecies(window.hobunjiTransformSpeciesId(species))
    : normalizeSpecies(species));

  // Opaque-pixel AABB + alpha-weighted centroid, in normalized [0,1] canvas
  // fractions (u = x / width, v = y / height, v=0 is the top row).
  function scanAlpha(canvas, threshold = DEFAULT_ALPHA_THRESHOLD) {
    const w = canvas?.width, h = canvas?.height;
    if (!w || !h) return null;
    let data;
    try { data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data; } catch { return null; }
    let top = -1, bottom = -1, left = w, right = -1, sx = 0, sy = 0, sw = 0;
    const rowCounts = new Uint32Array(h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = data[(y * w + x) * 4 + 3];
        if (a <= threshold) continue;
        if (top < 0) top = y;
        bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
        rowCounts[y] += 1;
        sx += x * a; sy += y * a; sw += a;
      }
    }
    if (top < 0) return null;
    return {
      w, h, rowCounts,
      top: top / h, bottom: (bottom + 1) / h, left: left / w, right: (right + 1) / w,
      centroidU: sw ? (sx / sw + 0.5) / w : 0.5, centroidV: sw ? (sy / sw + 0.5) / h : 0.5,
      bottomRow: bottom, topRow: top,
    };
  }

  // Head pivot mirrors png-plane-avatar.js detectHeadRigPixels: the head
  // sprite's alpha centroid X, and its coherent bottom edge (ignoring a few
  // stray low rows) as the neck hinge that head scale/offset act around.
  function headFromScan(scan) {
    if (!scan) return null;
    const minimumRowPixels = Math.max(2, Math.round(scan.w * .012));
    let coherentBottom = scan.bottomRow;
    while (coherentBottom > scan.topRow && scan.rowCounts[coherentBottom] < minimumRowPixels) coherentBottom--;
    return {
      top: scan.top, bottom: (coherentBottom + 1) / scan.h, left: scan.left, right: scan.right,
      centroidU: scan.centroidU, centroidV: scan.centroidV,
      pivotU: scan.centroidU, pivotV: (coherentBottom + 0.5) / scan.h,
    };
  }

  function stripCosmetics(profile) {
    const bare = { ...profile };
    for (const key of COSMETIC_KEYS) bare[key] = null;
    bare.bodyDeform = null;
    return bare;
  }

  function identities() {
    const out = new Map();
    const add = (species, gender) => {
      const s = normalizeSpecies(species);
      if (s) out.set(keyFor(s, gender), { species: s, gender: normalizeGender(gender) });
    };
    for (const key of Object.keys(window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {})) add(...key.split('::'));
    for (const key of Object.keys(window.HobunjiCharacterRigScaleDefaults?.values || {})) add(...key.split('::'));
    for (const fighter of window.getPortraitFighters?.() || []) {
      const gender = fighter.gender ?? (fighter.id === 'M' ? 'male' : fighter.id === 'F' ? 'female' : null);
      if (fighter.speciesId && gender) add(fighter.speciesId, gender);
    }
    return [...out.values()];
  }

  function fighterMatches(profile, species) {
    const id = normalizeSpecies(profile?.fighter?.speciesId);
    return !!id && id === species;
  }

  async function measureIdentity(identity, size) {
    const preview = window.NpcAvatarPreview;
    const profile = preview?.randomProfile?.(`character-dimensions:${identity.species}:${identity.gender}`, { speciesId: identity.species, gender: identity.gender });
    if (!profile || !fighterMatches(profile, identity.species)) return null; // selectFighter falls back to fighters[0]; never record another species' art under this key.
    const options = { forceEyesOpen: true, breathingComposer: STILL_COMPOSER, seatId: 'character-dimensions' };
    const body = Object.assign(document.createElement('canvas'), { width: size, height: size });
    const head = Object.assign(document.createElement('canvas'), { width: size, height: size });
    await preview.renderProfileToCanvas(body, stripCosmetics(profile), { ...options, omitHeadSpriteAndCosmetics: true }); // Head is measured separately because head scale/offset move it independently of the body.
    await preview.renderProfileToCanvas(head, profile, { ...options, onlyHeadSprite: true });
    const threshold = avatarCfg().handAttachAlphaThreshold ?? DEFAULT_ALPHA_THRESHOLD;
    const bodyScan = scanAlpha(body, threshold);
    const headScan = headFromScan(scanAlpha(head, threshold));
    if (!bodyScan || !headScan) return null;
    return {
      species: identity.species, gender: identity.gender, canvasSize: size,
      body: { top: bodyScan.top, bottom: bodyScan.bottom, left: bodyScan.left, right: bodyScan.right, centroidU: bodyScan.centroidU, centroidV: bodyScan.centroidV },
      head: headScan,
    };
  }

  function scriptRelativeBase(dir) {
    const src = document.currentScript?.src || '';
    try { return src ? new URL(`../${dir}/`, src).href : `./${dir}/`; } catch { return `./${dir}/`; }
  }
  const ASSET_BASE = typeof document !== 'undefined' ? scriptRelativeBase('assets') : './assets/';
  const CONFIG_BASE = typeof document !== 'undefined' ? scriptRelativeBase('config') : './config/';

  // Runs the one-per-session pixel measurement. Safe to call repeatedly: the
  // first call's promise is shared unless { force: true } is passed.
  function measureAll(options = {}) {
    if (readyPromise && !options.force) return readyPromise;
    status = 'measuring';
    readyPromise = (async () => {
      const preview = window.NpcAvatarPreview;
      if (!preview?.renderProfileToCanvas || !preview?.randomProfile) throw new Error('NpcAvatarPreview is not loaded.');
      await preview.ensurePortraitCosmetics?.({ assetBase: options.assetBase || ASSET_BASE, configBase: options.configBase || CONFIG_BASE });
      const size = positive(options.canvasSize, positive(avatarCfg().previewPortraitCanvasSize, 200));
      for (const identity of identities()) {
        try {
          const measured = await measureIdentity(identity, size);
          if (measured) measurements.set(keyFor(identity.species, identity.gender), Object.freeze(measured));
        } catch (error) {
          console.warn?.('[character-dimensions] measurement failed', identity, error);
        }
      }
      status = 'ready';
      for (const listener of listeners) { try { listener(snapshot()); } catch {} }
      return snapshot();
    })().catch(error => {
      status = 'failed';
      console.warn?.('[character-dimensions] could not measure portraits', error);
      return snapshot();
    });
    return readyPromise;
  }

  function measurementFor(species, gender) {
    const g = normalizeGender(gender);
    return measurements.get(keyFor(species, g))
      || measurements.get(keyFor(transformSpecies(species), g))
      || null;
  }

  // Composes every transform layer into floor-relative world numbers.
  // options: { child, age | npcRecord | profile, rigScale: {x,y,head,offsetY}, portraitScale, placementRatio }
  // (explicit values override the live config; otherwise everything is read live).
  function dimensionsFor(species, gender, options = {}) {
    const s = normalizeSpecies(species);
    const g = normalizeGender(gender);
    const m = measurementFor(s, g);
    if (!m) return null;
    const cfg = avatarCfg();
    const png = window.PNGPlaneAvatar;
    const avatarOptions = { speciesId: s, gender: g, ...(options.child ? { npcRecord: { role: 'child', tags: ['child'] } } : {}) };
    let portraitScale = positive(options.portraitScale, positive(png?.avatarScaleMultiplierFor?.(avatarOptions), 1));
    if (options.child && !(Number(options.portraitScale) > 0) && !png?.isChildAvatar?.(avatarOptions)) portraitScale *= positive(cfg.childScaleMultiplier, 1); // Child markers are config-driven; apply the multiplier directly when the synthetic record does not match them.
    const placementNumber = Number(options.placementRatio);
    const placement = Number.isFinite(placementNumber) ? placementNumber : (Number(png?.avatarPlacementRatioFor?.(avatarOptions)) || 0.5);
    const baseWidth = positive(cfg.worldModelWidth, 0.9);
    const modelWidth = baseWidth * portraitScale;
    const modelHeight = baseWidth * portraitScale; // Game/tools pass modelHeight = worldModelWidth for the square portrait canvas.
    const rigApi = window.HobunjiCharacterRigScale;
    const resolvedRig = rigApi?.scaleFor?.(s, g) || window.HobunjiCharacterRigScaleDefaults?.scaleFor?.(s, g) || { x: 1, y: 1, head: 1, offsetY: 0 };
    const rig = { ...resolvedRig, ...(options.rigScale || {}) };
    const rx = positive(rig.x, 1), ry = positive(rig.y, 1), head = positive(rig.head, 1);
    const age = rigApi?.ageFor ? rigApi.ageFor(options) : (Number(options.age) || 0); // Explicit age, else an NPC's authored appearance.aging.hunch (pass { npcRecord } or { profile }).
    const hunch = rigApi?.ageHunchFraction?.(age) || 0;
    const headOffset = (Number(rig.offsetY) || 0) + hunch;

    // PNG row v -> floor-relative Y (png-plane-avatar.js handAttachY formula), then rig Y around floor.
    const rowY = v => modelHeight * (0.5 + placement - v);
    const colX = u => modelWidth * (u - 0.5);
    const bodyY = v => ry * rowY(v);
    const bodyX = u => rx * colX(u);
    const pivotY = ry * (rowY(m.head.pivotV) + headOffset * modelHeight);
    const pivotX = bodyX(m.head.pivotU);
    // Head vertices scale around the neck bone by exactly `head` in world space (compensated against rig x/y).
    const headY = v => pivotY + head * (rowY(v) - rowY(m.head.pivotV));
    const headX = u => pivotX + head * (colX(u) - colX(m.head.pivotU));

    const headBox = {
      top: headY(m.head.top), bottom: headY(m.head.bottom),
      left: headX(m.head.left), right: headX(m.head.right),
      centerX: headX(m.head.centroidU), centerY: headY(m.head.centroidV),
      neckX: pivotX, neckY: pivotY,
    };
    headBox.height = headBox.top - headBox.bottom;
    headBox.width = headBox.right - headBox.left;
    const bodyBox = {
      top: bodyY(m.body.top), bottom: bodyY(m.body.bottom),
      left: bodyX(m.body.left), right: bodyX(m.body.right),
      centerX: bodyX(m.body.centroidU), centerY: bodyY(m.body.centroidV),
    };
    bodyBox.width = bodyBox.right - bodyBox.left;
    const height = Math.max(headBox.top, bodyBox.top); // Floor to crown of the undecorated character.
    const left = Math.min(headBox.left, bodyBox.left);
    const right = Math.max(headBox.right, bodyBox.right);
    return {
      species: s, gender: g,
      height, // floor (Y=0) to top of the base head/body, world units
      width: right - left, // widest undecorated silhouette extent, world units
      left, right,
      head: headBox,
      body: bodyBox,
      portraitPlane: {
        width: modelWidth * rx, height: modelHeight * ry,
        bottom: bodyY(1), top: bodyY(0), centerY: bodyY(0.5),
      },
      factors: {
        portraitScale, placementRatio: placement, portraitYOffsetPercent: (placement - 0.5) * 100,
        baseModelWidth: baseWidth, modelWidth, modelHeight,
        rigScaleX: rx, rigScaleY: ry, headScale: head, headOffsetY: Number(rig.offsetY) || 0, age, ageHunch: hunch,
        child: !!options.child,
      },
      pixels: m,
    };
  }

  function lengthForHeightPercent(species, gender, percent, options = {}) {
    const dims = dimensionsFor(species, gender, options);
    const p = Number(percent);
    return dims && Number.isFinite(p) ? dims.height * p / 100 : null;
  }
  function heightPercentForLength(species, gender, length, options = {}) {
    const dims = dimensionsFor(species, gender, options);
    const l = Number(length);
    return dims && dims.height > 0 && Number.isFinite(l) ? l / dims.height * 100 : null;
  }

  function snapshot(options = {}) {
    const out = {};
    for (const m of measurements.values()) out[`${m.species}::${m.gender}`] = dimensionsFor(m.species, m.gender, options);
    return out;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  window.HobunjiCharacterDimensions = Object.freeze({
    get ready() { return readyPromise || measureAll(); },
    get status() { return status; },
    measureAll,
    isMeasured: (species, gender) => !!measurementFor(species, gender),
    measurementFor,
    dimensionsFor,
    lengthForHeightPercent,
    heightPercentForLength,
    snapshot,
    subscribe,
    // Pure helpers exposed for tests/tools.
    _scanAlpha: scanAlpha,
    _headFromScan: headFromScan,
    _setMeasurement(species, gender, value) { measurements.set(keyFor(species, gender), Object.freeze({ species: normalizeSpecies(species), gender: normalizeGender(gender), ...value })); },
  });

  // Once per session, after the page's own startup work has settled.
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__hobunjiCharacterDimensionsNoAutoMeasure) {
    const start = () => {
      const idle = window.requestIdleCallback || (cb => setTimeout(cb, 1500));
      idle(() => { measureAll(); }, { timeout: 5000 });
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  }
})();
