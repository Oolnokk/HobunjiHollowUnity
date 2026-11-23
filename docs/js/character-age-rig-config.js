// Shared age-rig authoring bridge. The family walker uses phaseScales and
// PNGPlaneAvatar.childScaleFor; the Animation Author reads these same values.
// Editing a draft does not affect gameplay until the author explicitly applies
// it on this device. No world/save mutations or per-frame hooks are installed.
(() => {
  'use strict';
  if (window.HobunjiCharacterAgeRigConfig) return;

  const SCHEMA = 'hobunji.character-age-rig-modifiers.v1'; // Validates the editor's export and the applied browser override.
  const APPLIED_KEY = 'hobunji.character-age-rig-active.v1'; // Only an explicit Apply action writes this game-facing preference.
  const AXES = ['body', 'head', 'hand', 'foot']; // Same global proportion axes for the editor and family growth stages.
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
  const stage = (source, fallback) => Object.fromEntries(AXES.map(axis => [axis, positive(source?.[axis], fallback[axis])]));
  const defaults = {
    baby: stage(family.phaseScales?.basket, { body: .32, head: .50, hand: 1.2, foot: 1.2 }),
    toddler: stage(family.phaseScales?.toddler, { body: .4, head: .66, hand: 1, foot: 1 }),
    child: {
      body: positive(png.childScaleMultiplier, .5),
      head: positive(png.childHeadScaleMultiplier, .72),
      hand: positive(family.childLimbModifiers?.hand, 1),
      foot: positive(family.childLimbModifiers?.foot, 1),
    },
  }; // Captured BEFORE a browser-local override, so Reset always means the checked-in repo configuration.
  const clone = value => JSON.parse(JSON.stringify(value)); // Snapshot only tiny plain numeric maps; never share mutable config with callers.
  const bounds = axis => axis === 'hand' || axis === 'foot' ? [.5, 2] : [.1, 2];
  const valid = (value, axis, fallback) => {
    if (value == null || value === '') return fallback;
    const n = Number(value); // Ignore malformed autosaves, Infinity, NaN, missing fields, and negative sizes.
    if (!Number.isFinite(n) || n <= 0) return fallback;
    const [min, max] = bounds(axis);
    return Math.max(min, Math.min(max, n));
  };

  function sanitize(modifiers) {
    const result = clone(defaults); // Isolated all-stage value map consumed by both export and runtime.
    for (const mode of MODES) for (const axis of AXES)
      result[mode][axis] = valid(modifiers?.[mode]?.[axis], axis, defaults[mode][axis]);
    return result;
  }

  function composePreviewScale(authored, phase) {
    const p = phase || { body: 1, head: 1 }; // Runtime child body is built into the portrait size; preview instead scales its whole floor parent.
    const base = authored || { x: 1, y: 1, head: 1, offsetY: 0 };
    return {
      x: positive(base.x, 1) * positive(p.body, 1),
      y: positive(base.y, 1) * positive(p.body, 1),
      head: positive(base.head, 1) * positive(p.head, 1),
      offsetY: Number.isFinite(Number(base.offsetY)) ? Number(base.offsetY) : 0,
    }; // Equivalent final body/head proportions: runtime child head bone = head/body, then the already-shrunken portrait supplies body.
  }

  function applyToConfig(modifiers) {
    const values = sanitize(modifiers); // Reused for load, Apply and Reset so the live runtime never sees unvalidated values.
    family.phaseScales ||= {};
    for (const [mode, phase] of [['baby', 'basket'], ['toddler', 'toddler']])
      family.phaseScales[phase] = { ...(family.phaseScales[phase] || {}), ...values[mode] };
    family.childLimbModifiers = { ...(family.childLimbModifiers || {}), hand: values.child.hand, foot: values.child.foot };
    png.childScaleMultiplier = values.child.body;
    png.childHeadScaleMultiplier = values.child.head;
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

  window.HobunjiCharacterAgeRigConfig = Object.freeze({
    schema: SCHEMA,
    appliedStorageKey: APPLIED_KEY,
    repositoryDefaults: () => clone(defaults),
    effectiveValues: () => clone(applied || defaults),
    sanitize,
    composePreviewScale,
    applyOnThisDevice,
    restoreRepositoryOnThisDevice,
    snapshot: () => ({ applied: !!applied, values: clone(applied || defaults) }),
  }); // Also exposed to existing mobile debug panels; no devtools required.
})();
