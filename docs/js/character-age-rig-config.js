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

  function resolveStageAxes(authored, phase) {
    const p = phase || {}; // Normalize each species/gender against its own unscaled rig, not the other species' physical height.
    const base = authored || {};
    const adultWidth = positive(base.x, 1);
    const adultHeight = positive(window.HobunjiCharacterRigScale?.heightBeltlineFor?.(base)?.height,
      (positive(base.y, 1) + positive(base.legLength, positive(base.y, 1))) / 2); // Shared nominal stature includes leg reach as well as portrait height.
    return {
      width: positive(p.width, positive(p.body, 1)) * Math.pow(adultWidth, -convergence(p.widthConvergence)),
      height: positive(p.height, positive(p.body, 1)) * Math.pow(adultHeight, -convergence(p.heightConvergence)),
    }; // At zero the previous behavior is exact; at full strength the authored adult-axis deviations converge to the native rig.
  }

  function composePreviewScale(authored, phase) {
    const p = phase || { width: 1, height: 1, head: 1 }; // Runtime already bakes independently scaled X/Y into its child portrait.
    const base = authored || { x: 1, y: 1, head: 1, offsetY: 0 };
    const axes = resolveStageAxes(base, p); // Same correction used by the live child portrait builder.
    return {
      x: positive(base.x, 1) * axes.width,
      y: positive(base.y, 1) * axes.height,
      head: positive(base.head, 1) * positive(p.head, 1),
      offsetY: Number.isFinite(Number(base.offsetY)) ? Number(base.offsetY) : 0,
    }; // Equivalent final body/head proportions: runtime child head bone = head/body, then the already-shrunken portrait supplies body.
  }

  function applyToConfig(modifiers) {
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
    return values;
  }

  function readApplied() {
    try {
      const data = JSON.parse(localStorage.getItem(APPLIED_KEY) || 'null');
      return data?.schema === SCHEMA && data.modifiers && typeof data.modifiers === 'object'
        ? sanitize(data.modifiers) : null;
    } catch (error) {
      console.warn('[age-rig] invalid applied authoring data, using repository proportions', error);
      return null;
    }
  }

  let applied = readApplied(); // Saved device override is activated once, before family world/spawn initialization.
  if (applied) applied = applyToConfig(applied);

  function applyOnThisDevice(modifiers) {
    const values = sanitize(modifiers); // Explicit editor action only; never triggered by a draft slider or autosave.
    localStorage.setItem(APPLIED_KEY, JSON.stringify({ schema: SCHEMA, modifiers: values }));
    applied = applyToConfig(values);
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
    nonFamilyChildLimbsFor,
    applyOnThisDevice,
    restoreRepositoryOnThisDevice,
    snapshot: () => ({ applied: !!applied, values: clone(applied || defaults) }),
  }); // Also exposed to existing mobile debug panels; no devtools required.
})();
