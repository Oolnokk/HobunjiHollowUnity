// Shared age-rig authoring bridge. The family walker uses independently authored phase width/height and
// PNGPlaneAvatar.childScaleFor; the Animation Author reads these same values.
// Editing a draft does not affect gameplay until the author explicitly applies
// it on this device. No world/save mutations or per-frame hooks are installed.
(() => {
  'use strict';
  if (window.HobunjiCharacterAgeRigConfig) return;

  const SCHEMA = 'hobunji.character-age-rig-modifiers.v1'; // Validates the editor's export and the applied browser override.
  const APPLIED_KEY = 'hobunji.character-age-rig-active.v1'; // Only an explicit Apply action writes this game-facing preference.
  const AXES = ['width', 'height', 'head', 'hand', 'foot', 'widthConvergence', 'heightConvergence']; // Independent body axes plus head and GLB limb sizes for every growth stage.
  const MODES = ['baby', 'toddler', 'child']; // Adult reference never receives a size override.
  const family = window.HobunjiRomanceConfig?.family;
  const png = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar;
  if (!family || !png) {
    console.warn('[age-rig] family or portrait configuration unavailable; leaving gameplay defaults unchanged');
    return;
  }
  const positive = (v, fallback) => {
    const n = Number(v); // Shared input normalization for repository, imported, and applied percentages.
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const isConvergence = axis => axis === 'widthConvergence' || axis === 'heightConvergence'; // Unitless 0–1 strength, unlike the size multipliers.
  const convergence = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
  const stage = (source, fallback) => Object.fromEntries(AXES.map(axis => [
    axis, isConvergence(axis) ? convergence(source?.[axis]) : positive(source?.[axis] ?? (axis === 'width' || axis === 'height' ? source?.body : null),
      fallback[axis] ?? fallback.body),
  ])); // Old body-only authoring maps to BOTH width and height; never discard existing saved stages.
  const defaults = {
    baby: stage(family.phaseScales?.basket, { width: .32, height: .32, head: .50, hand: 1.2, foot: 1.2 }),
    toddler: stage(family.phaseScales?.toddler, { width: .4, height: .4, head: .66, hand: 1, foot: 1 }),
    child: {
      width: positive(png.childWidthScaleMultiplier, positive(png.childScaleMultiplier, .5)), // Old child size was uniform; new config may override width independently.
      height: positive(png.childScaleMultiplier, .5),
      head: positive(png.childHeadScaleMultiplier, .72),
      widthConvergence: convergence(png.childWidthConvergence), // Stage-specific authored strength.
      heightConvergence: convergence(png.childHeightConvergence),
      hand: positive(family.childLimbModifiers?.hand, 1),
      foot: positive(family.childLimbModifiers?.foot, 1),
    },
  }; // Captured BEFORE a browser-local override, so Reset always means the checked-in repo configuration.
  const clone = value => JSON.parse(JSON.stringify(value)); // Snapshot only tiny plain numeric maps; never share mutable config with callers.
  const bounds = axis => axis === 'hand' || axis === 'foot' ? [.5, 2] : [.1, 2];
  const valid = (value, axis, fallback) => {
    if (value == null || value === '') return fallback;
    const n = Number(value); // Ignore malformed autosaves, Infinity, NaN, missing fields, and negative sizes.
    if (isConvergence(axis)) return Number.isFinite(n) ? convergence(n) : fallback;
    if (!Number.isFinite(n) || n <= 0) return fallback;
    const [min, max] = bounds(axis);
    return Math.max(min, Math.min(max, n));
  };

  function sanitize(modifiers) {
    const result = clone(defaults); // Isolated all-stage value map consumed by both export and runtime.
    for (const mode of MODES) for (const axis of AXES)
      result[mode][axis] = valid(modifiers?.[mode]?.[axis] ?? (axis === 'width' || axis === 'height' ? modifiers?.[mode]?.body : null), axis, defaults[mode][axis]); // Migrate old v1 body autosaves for both axes independently.
    return result;
  }

  const identityKey = (species, gender) => `${String(species || '').toLowerCase().replace(/[’']/g, '').replace(/_/g, '-')}::${String(gender).toLowerCase() === 'female' || String(gender).toLowerCase() === 'f' ? 'female' : 'male'}`; // Shared editor/runtime identity, including distinct genders.
  const sanitizeBasis = source => Object.fromEntries(Object.entries(source || {}).filter(([key, row]) => /^[a-z0-9-]+::(male|female)$/.test(key) && Number.isFinite(row?.width) && row.width > 0 && Number.isFinite(row?.height) && row.height > 0).map(([key, row]) => [key, { width: Math.max(.02, Math.min(50, row.width)), height: Math.max(.02, Math.min(50, row.height)) }])); // Portable dimension ratios, never pixels or cosmetics.
  const repositoryBasis = sanitizeBasis(png.ageConvergenceBasis); // Freeze the deployed reference before local override restoration.

  function buildConvergenceBasis(profiles = []) {
    const dimensions = window.HobunjiCharacterDimensions; // Cached bare-art alpha bounds: never scan pixels in the slider or spawn path.
    const rig = window.HobunjiCharacterRigScale;
    const rows = new Map(); // One measurement per distinct species/gender, including both sexes.
    for (const profile of profiles) {
      const { species, gender } = profile;
      const key = identityKey(species, gender);
      if (rows.has(key)) continue;
      const authored = rig?.scaleFor?.(species, gender, profile.profile) || window.HobunjiCharacterRigScaleDefaults?.scaleFor?.(species, gender);
      if (!authored) continue;
      const measured = dimensions?.dimensionsFor?.(species, gender, { rigScale: authored, age: 0 });
      const width = positive(measured?.body?.width, 0); // Body only: head size stays independently controllable.
      const nominalHeight = positive(rig?.heightBeltlineFor?.(authored)?.height, positive(authored.y, 1));
      const legDelta = (nominalHeight - positive(authored.y, 1)) * positive(measured?.factors?.modelHeight, 0); // Estimate the independent leg reach beyond the portrait-only crown metric.
      const height = positive(Number(measured?.height) + legDelta, 0);
      if (width > 0 && height > 0) rows.set(key, { width, height });
    }
    if (!rows.size) return {};
    const reference = axis => Math.exp([...rows.values()].reduce((sum, row) => sum + Math.log(row[axis]), 0) / rows.size); // Geometric mean is the neutral midpoint for multiplicative scaling across the complete lineup.
    const width = reference('width'), height = reference('height');
    return sanitizeBasis(Object.fromEntries([...rows].map(([key, row]) => [key, { width: row.width / width, height: row.height / height }])));
  }

  function resolveStageAxes(authored, phase, identity = null, basis = null) {
    const p = phase || {}; // Physical cross-lineup dimensions supersede the old per-rig factors when a measured reference is available.
    const base = authored || {};
    const key = identity && identityKey(identity.species, identity.gender); // Exact art identity first, donor alias only if necessary.
    const map = basis || png.ageConvergenceBasis || repositoryBasis;
    const measured = key && (map[key] || map[identityKey(window.hobunjiTransformSpeciesId?.(identity.species) || identity.species, identity.gender)]);
    const adultWidth = positive(measured?.width, positive(base.x, 1));
    const adultHeight = positive(measured?.height, positive(window.HobunjiCharacterRigScale?.heightBeltlineFor?.(base)?.height,
      (positive(base.y, 1) + positive(base.legLength, positive(base.y, 1))) / 2)); // Unmeasured identities retain the nominal fallback.
    return {
      width: positive(p.width, positive(p.body, 1)) * Math.pow(adultWidth, -convergence(p.widthConvergence)),
      height: positive(p.height, positive(p.body, 1)) * Math.pow(adultHeight, -convergence(p.heightConvergence)),
    }; // At zero the previous behavior is exact; at full strength measured adult-axis differences converge toward the shared reference.
  }

  function composePreviewScale(authored, phase, identity = null, basis = null) {
    const p = phase || { width: 1, height: 1, head: 1 }; // Runtime already bakes independently scaled X/Y into its child portrait.
    const base = authored || { x: 1, y: 1, head: 1, offsetY: 0 };
    const axes = resolveStageAxes(base, p, identity, basis); // Same correction used by the live child portrait builder.
    return {
      x: positive(base.x, 1) * axes.width,
      y: positive(base.y, 1) * axes.height,
      head: positive(base.head, 1) * positive(p.head, 1),
      offsetY: Number.isFinite(Number(base.offsetY)) ? Number(base.offsetY) : 0,
    }; // Equivalent final body/head proportions: runtime child head bone = head/body, then the already-shrunken portrait supplies body.
  }

  function applyToConfig(modifiers, basis = repositoryBasis) {
    const values = sanitize(modifiers); // Reused for load, Apply and Reset so the live runtime never sees unvalidated values.
    family.phaseScales ||= {};
    for (const [mode, phase] of [['baby', 'basket'], ['toddler', 'toddler']])
      family.phaseScales[phase] = { ...(family.phaseScales[phase] || {}), ...values[mode], body: values[mode].height }; // Legacy consumers still receive the vertical body scale; new portrait builder reads width separately.
    family.childLimbModifiers = { ...(family.childLimbModifiers || {}), hand: values.child.hand, foot: values.child.foot };
    png.childScaleMultiplier = values.child.height; // Existing child scale remains the vertical size for legacy gameplay readers.
    png.childWidthScaleMultiplier = values.child.width; // New independent child width, used only by the portrait builder.
    png.childHeadScaleMultiplier = values.child.head;
    png.childWidthConvergence = values.child.widthConvergence; // Ordinary child portraits read these; family stages carry their own values.
    png.childHeightConvergence = values.child.heightConvergence;
    png.ageConvergenceBasis = sanitizeBasis(basis); // Both family and ordinary children share this frozen deployment reference, even before the game scans art.
    return values;
  }

  function readApplied() {
    try {
      const data = JSON.parse(localStorage.getItem(APPLIED_KEY) || 'null');
      return data?.schema === SCHEMA && data.modifiers && typeof data.modifiers === 'object'
        ? { modifiers: sanitize(data.modifiers), basis: sanitizeBasis(data.convergenceBasis || repositoryBasis) } : null;
    } catch (error) {
      console.warn('[age-rig] invalid applied authoring data, using repository proportions', error);
      return null;
    }
  }

  const stored = readApplied(); // Saved device override is activated once, before family world/spawn initialization.
  let applied = stored ? applyToConfig(stored.modifiers, stored.basis) : null;

  function applyOnThisDevice(modifiers, basis = repositoryBasis) {
    const values = sanitize(modifiers); // Explicit editor action only; never triggered by a draft slider or autosave.
    const reference = sanitizeBasis(basis); // Persist measured identity ratios atomically with stage settings for game/editor parity on reload.
    localStorage.setItem(APPLIED_KEY, JSON.stringify({ schema: SCHEMA, modifiers: values, convergenceBasis: reference }));
    applied = applyToConfig(values, reference);
    return clone(applied);
  }

  function restoreRepositoryOnThisDevice() {
    localStorage.removeItem(APPLIED_KEY); // Does not touch drafts or permanent game saves.
    applied = null;
    applyToConfig(defaults);
    return clone(defaults);
  }

  function nonFamilyChildLimbsFor(npc) {
    const record = npc || {}; // Only independent child NPCs need the generic attach-time hook; family stages retain FamilyBabyLimbs ownership.
    const tags = Array.isArray(record.tags) ? record.tags.map(tag => String(tag).toLowerCase()) : [];
    const child = record.isChild === true || String(record.role || '').toLowerCase() === 'child' || tags.includes('child');
    if (!child || tags.includes('family') || record.homeId === 'farmhouse') return null;
    const current = applied || defaults; // Follows the same active child proportion used by PNGPlaneAvatar and the family config.
    return { hand: current.child.hand, foot: current.child.foot, phase: 'child', owner: 'generic-child-visuals' };
  }

  window.HobunjiCharacterAgeRigConfig = Object.freeze({
    schema: SCHEMA,
    appliedStorageKey: APPLIED_KEY,
    repositoryDefaults: () => clone(defaults),
    effectiveValues: () => clone(applied || defaults),
    sanitize,
    composePreviewScale,
    resolveStageAxes,
    buildConvergenceBasis,
    nonFamilyChildLimbsFor,
    applyOnThisDevice,
    restoreRepositoryOnThisDevice,
    snapshot: () => ({ applied: !!applied, values: clone(applied || defaults), convergenceBasis: clone(png.ageConvergenceBasis || repositoryBasis) }),
  }); // Also exposed to existing mobile debug panels; no devtools required.
})();
