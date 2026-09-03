// Shared authored NPC aging presets consumed by gameplay and the visual Age Effect tool.
(function (global) {
  'use strict';

  const SCHEMA = 'hobunji.npc-age-effects.v1'; // Used by exports/tests so future preset migrations can be explicit.

  function normalizeNpcKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  const PRESETS = Object.freeze({ // Runtime defaults edited visually by docs/tools/age-effect/.
    old: Object.freeze({
      id: 'old',
      label: 'Old',
      color: Object.freeze({ amount: 70, desaturation: 65, brightening: 30 }),
      headDropPx: 10,
      torsoPitchDeg: 4, // Added by the animation composer/posture bridge as a persistent forward torso rotation offset.
      verticalOffsetReductionPct: 1.5, // Subtle age-related loss: reduce only the normal standing modelHeight/2 body lift, preserving species/gender portrait placement.
    }),
    veryOld: Object.freeze({
      id: 'veryOld',
      label: 'Very Old',
      color: Object.freeze({ amount: 100, desaturation: 88, brightening: 48 }),
      headDropPx: 19,
      torsoPitchDeg: 9, // Stronger default hunch; intentionally independent from the portrait head-drop slider in the authoring tool.
      verticalOffsetReductionPct: 3, // Stronger but still subtle height loss without altering portraitVerticalPlacement or species scale.
    }),
  });

  const ASSIGNMENTS = Object.freeze([ // Exact allowlist; no inferred/generic fantasy NPC names belong here.
    Object.freeze({ ids: Object.freeze(['teacup_unumanuk']), names: Object.freeze(['Eldress Teacup', 'Teacup Unumanuk']), preset: 'old' }),
    Object.freeze({ ids: Object.freeze(['father_hunundi_hodu']), names: Object.freeze(['Father Hunundi', 'Father Hunundi Hodu']), preset: 'old' }),
    Object.freeze({ ids: Object.freeze(['kinami_kunji']), names: Object.freeze(['Kinami Kunji']), preset: 'veryOld' }),
    Object.freeze({ ids: Object.freeze(['kaboku_kunji']), names: Object.freeze(['Kaboku Kunji']), preset: 'veryOld' }),
    Object.freeze({ ids: Object.freeze(['leaf']), names: Object.freeze(['Leaf']), preset: 'veryOld' }),
    Object.freeze({ ids: Object.freeze(['pahu']), names: Object.freeze(['Pahu']), preset: 'veryOld' }),
  ]);

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.max(min, Math.min(max, finite(value, fallback)));
  }

  function effectFromPreset(presetId, overrides = null) {
    const preset = PRESETS[presetId] || PRESETS.old; // Used by the tool for temporary tuned copies without mutating runtime defaults.
    const colorOverrides = overrides?.color || overrides || {};
    return Object.freeze({
      presetId: preset.id,
      presetLabel: preset.label,
      amount: clamp(colorOverrides.amount, 0, 100, preset.color.amount),
      desaturation: clamp(colorOverrides.desaturation, 0, 100, preset.color.desaturation),
      brightening: clamp(colorOverrides.brightening, 0, 100, preset.color.brightening),
      headDropPx: clamp(overrides?.headDropPx, 0, 40, preset.headDropPx),
      torsoPitchDeg: clamp(overrides?.torsoPitchDeg, -45, 45, preset.torsoPitchDeg),
      verticalOffsetReductionPct: clamp(overrides?.verticalOffsetReductionPct, 0, 100, preset.verticalOffsetReductionPct),
    });
  }

  function resolveAssignment(npc) {
    const idKey = normalizeNpcKey(npc?.id); // Matched exactly so similarly named NPCs never inherit age treatment accidentally.
    const nameKey = normalizeNpcKey(npc?.name); // Fallback keeps older/reference records without IDs usable.
    return ASSIGNMENTS.find(assignment => {
      const idMatch = idKey && assignment.ids.some(id => normalizeNpcKey(id) === idKey);
      const nameMatch = nameKey && assignment.names.some(name => normalizeNpcKey(name) === nameKey);
      return idMatch || nameMatch;
    }) || null;
  }

  function resolveNpcEffect(npc, overrides = null) {
    const assignment = resolveAssignment(npc); // Determines the authored age band before optional tool-only overrides are applied.
    if (!assignment) return null;
    const effect = effectFromPreset(assignment.preset, overrides);
    return Object.freeze({
      ...effect,
      npcId: npc?.id || null,
      npcName: npc?.name || null,
    });
  }

  function exportPreset(presetId, overrides = null) {
    const effect = effectFromPreset(presetId, overrides); // Serialized by the visual tool for copy/paste back into this config.
    return {
      schema: SCHEMA,
      preset: effect.presetId,
      label: effect.presetLabel,
      color: {
        amount: effect.amount,
        desaturation: effect.desaturation,
        brightening: effect.brightening,
      },
      headDropPx: effect.headDropPx,
      torsoPitchDeg: effect.torsoPitchDeg,
      verticalOffsetReductionPct: effect.verticalOffsetReductionPct,
    };
  }

  global.HobunjiNpcAgeEffectConfig = Object.freeze({
    schema: SCHEMA,
    presets: PRESETS,
    assignments: ASSIGNMENTS,
    normalizeNpcKey,
    effectFromPreset,
    resolveAssignment,
    resolveNpcEffect,
    exportPreset,
  });
})(window);
