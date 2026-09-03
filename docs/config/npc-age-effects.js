// Shared authored NPC aging configuration consumed by gameplay and the visual Age Effect tool.
(function (global) {
  'use strict';

  const SCHEMA = 'hobunji.npc-age-effects.v2';

  const CONTROLS = Object.freeze({
    amount: Object.freeze({ min: 0, max: 100, step: 1, rangeMin: 0, rangeMax: 100 }),
    desaturation: Object.freeze({ min: 0, max: 100, step: 1, rangeMin: 0, rangeMax: 100 }),
    brightening: Object.freeze({ min: 0, max: 100, step: 1, rangeMin: 0, rangeMax: 100 }),
    headDropPx: Object.freeze({ min: 0, max: 40, step: 1, rangeMin: 0, rangeMax: 24 }),
    torsoPitchDeg: Object.freeze({ min: -45, max: 45, step: 0.5, rangeMin: -30, rangeMax: 30 }),
    verticalOffsetReductionPct: Object.freeze({ min: 0, max: 100, step: 0.5, rangeMin: 0, rangeMax: 50 }),
  });

  const RENDERING = Object.freeze({
    biologicalColorSlots: Object.freeze(['A', 'B', 'C']),
    preserveExactColors: Object.freeze(['#000000']),
    headContributionMaskGain: 5,
  });

  const COMPOSITION = Object.freeze({
    bodyChannel: 'age-posture',
    bodyPriority: 90,
    standingLiftFraction: 0.5,
    percentScale: 100,
    neckCounterPitchMultiplier: -1,
    posteriorFallbackHeightPercent: -18,
  });

  const PRESETS = Object.freeze({
    old: Object.freeze({
      id: 'old',
      label: 'Old',
      color: Object.freeze({ amount: 70, desaturation: 65, brightening: 30 }),
      headDropPx: 10,
      torsoPitchDeg: 4,
      verticalOffsetReductionPct: 1.5,
    }),
    veryOld: Object.freeze({
      id: 'veryOld',
      label: 'Very Old',
      color: Object.freeze({ amount: 100, desaturation: 88, brightening: 48 }),
      headDropPx: 19,
      torsoPitchDeg: 9,
      verticalOffsetReductionPct: 3,
    }),
  });

  const ASSIGNMENTS = Object.freeze([
    Object.freeze({ ids: Object.freeze(['teacup_unumanuk']), names: Object.freeze(['Eldress Teacup', 'Teacup Unumanuk']), preset: 'old' }),
    Object.freeze({ ids: Object.freeze(['father_hunundi_hodu']), names: Object.freeze(['Father Hunundi', 'Father Hunundi Hodu']), preset: 'old' }),
    Object.freeze({ ids: Object.freeze(['kinami_kunji']), names: Object.freeze(['Kinami Kunji']), preset: 'veryOld' }),
    Object.freeze({ ids: Object.freeze(['kaboku_kunji']), names: Object.freeze(['Kaboku Kunji']), preset: 'veryOld' }),
    Object.freeze({ ids: Object.freeze(['leaf']), names: Object.freeze(['Leaf']), preset: 'veryOld' }),
    Object.freeze({ ids: Object.freeze(['pahu']), names: Object.freeze(['Pahu']), preset: 'veryOld' }),
  ]);

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

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clampControl(key, value, fallback = 0) {
    const spec = CONTROLS[key];
    if (!spec) return finite(value, fallback);
    return Math.max(spec.min, Math.min(spec.max, finite(value, fallback)));
  }

  function effectFromPreset(presetId, overrides = null) {
    const preset = PRESETS[presetId] || PRESETS.old;
    const colorOverrides = overrides?.color || overrides || {};
    return Object.freeze({
      presetId: preset.id,
      presetLabel: preset.label,
      amount: clampControl('amount', colorOverrides.amount, preset.color.amount),
      desaturation: clampControl('desaturation', colorOverrides.desaturation, preset.color.desaturation),
      brightening: clampControl('brightening', colorOverrides.brightening, preset.color.brightening),
      headDropPx: clampControl('headDropPx', overrides?.headDropPx, preset.headDropPx),
      torsoPitchDeg: clampControl('torsoPitchDeg', overrides?.torsoPitchDeg, preset.torsoPitchDeg),
      verticalOffsetReductionPct: clampControl('verticalOffsetReductionPct', overrides?.verticalOffsetReductionPct, preset.verticalOffsetReductionPct),
    });
  }

  function resolveAssignment(npc) {
    const idKey = normalizeNpcKey(npc?.id);
    const nameKey = normalizeNpcKey(npc?.name);
    return ASSIGNMENTS.find(assignment => {
      const idMatch = idKey && assignment.ids.some(id => normalizeNpcKey(id) === idKey);
      const nameMatch = nameKey && assignment.names.some(name => normalizeNpcKey(name) === nameKey);
      return idMatch || nameMatch;
    }) || null;
  }

  function resolveNpcEffect(npc, overrides = null) {
    const assignment = resolveAssignment(npc);
    if (!assignment) return null;
    const effect = effectFromPreset(assignment.preset, overrides);
    return Object.freeze({
      ...effect,
      npcId: npc?.id || null,
      npcName: npc?.name || null,
    });
  }

  function exportPreset(presetId, overrides = null) {
    const effect = effectFromPreset(presetId, overrides);
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
    controls: CONTROLS,
    rendering: RENDERING,
    composition: COMPOSITION,
    presets: PRESETS,
    assignments: ASSIGNMENTS,
    normalizeNpcKey,
    clampControl,
    effectFromPreset,
    resolveAssignment,
    resolveNpcEffect,
    exportPreset,
  });
})(window);
