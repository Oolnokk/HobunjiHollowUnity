// Animation Author only: expose the game's newer wildlife art in Rig Coordinates.
// Gameplay continues to own spawning, genetics, and the authoritative flying rig.
(() => {
  'use strict';

  const SPRITES = 'assets/creaturesprites/'; // Resolves each authored PNG against the repository selected in the Animation Author.
  const FLYING_ASPECT = 1000 / 1617; // Shared authored canvas aspect used by the three native flying species.
  const entries = Object.freeze({ // Rig picker metadata and compositor configuration; not gameplay creature definitions.
    puktuk: {
      label: 'Puktuk', modelWidth: 2.1, spriteAspect: 0.43636,
      prefix: 'puktuk', baseColor: '#99BF99', baseShadeReferenceHex: '#99BF99', fullBaseRecolor: true,
      base: { idle: 'puktuk_idle.png', run1: 'puktuk_run1.png', run2: 'puktuk_run2.png' },
      patterns: ['belly', 'foxtail'], eyes: { open: 'puktuk_eye.png', blink: 'puktuk_blink.png' },
    },
    'voorg-ass': {
      label: 'Voorg-ass', modelWidth: 1.5,
      prefix: 'voorg-ass', baseColor: '#99BF99', baseShadeReferenceHex: '#99BF99',
      baseRecolorKeyHex: '#99BF99', baseRecolorHueTolerance: 20,
      baseRecolorMinSaturationRatio: 0.45, fullBaseRecolor: false,
      base: { idle: 'voorg-ass_idle.png', run1: 'voorg-ass_run1.png', run2: 'voorg-ass_run2.png' },
      patterns: ['belly'], defaultCoatPatterns: [{ id: 'beard1', family: 'beard' }],
    },
    'voorg-ass-herd-mother': { label: 'Voorg-ass Herd-Mother', mirrorOf: 'voorg-ass', modelWidth: 1.5 },
    moot: {
      label: 'Moot', modelWidth: 1.7,
      prefix: 'moot', baseColor: '#9CBD9E', baseShadeReferenceHex: '#9CBD9E',
      baseRecolorKeyHex: '#9CBD9E', baseRecolorHueTolerance: 20,
      baseRecolorMinSaturationRatio: 0.45, fullBaseRecolor: false,
      base: { idle: 'moot_idle.png', run1: 'moot_run1.png', run2: 'moot_run2.png' },
      patterns: [], eyes: { open: 'moot_eyes.png', blink: 'moot_blink.png' },
    },
    tzatzul: {
      label: 'Tzatzul', modelWidth: 2.2, spriteAspect: FLYING_ASPECT, defaultFrame: 'perched',
      prefix: 'tzatzul', base: {
        idle: 'tzatzul_perched.png', perched: 'tzatzul_perched.png',
        flying: 'tzatzul_flying.png', run1: 'tzatzul_flying.png', run2: 'tzatzul_flying.png',
      },
      patterns: [], eyes: { open: 'tzatzul_eyes.png', blink: 'tzatzul_blink.png' },
    },
    'tzatzul-hatchling': {
      label: 'Tzatzul Hatchling', modelWidth: 2.2 * 3 / 8,
      spriteAspect: FLYING_ASPECT * 5 / 3, defaultFrame: 'perched',
      prefix: 'tzatzul-hatchling', base: {
        idle: 'tzatzul_perched.png', perched: 'tzatzul_perched.png',
        run1: 'tzatzul_perched.png', run2: 'tzatzul_perched.png',
      },
      patterns: [], eyes: { open: 'tzatzul_eyes.png', blink: 'tzatzul_blink.png' },
    },
    pingdort: {
      label: 'Pingdort', modelWidth: 0.48, spriteAspect: FLYING_ASPECT, defaultFrame: 'perched',
      prefix: 'pingdort', baseColor: '#9dc09c', baseShadeReferenceHex: '#9dc09c',
      baseRecolorKeyHex: '#9dc09c', baseRecolorHueTolerance: 24,
      baseRecolorMinSaturationRatio: 0.4,
      base: {
        idle: 'pingdort_perched.png', perched: 'pingdort_perched.png',
        flying: 'pingdort_flying.png', run1: 'pingdort_flying.png', run2: 'pingdort_flying.png',
      },
      patterns: [],
    },
    'skeeri-small': {
      label: 'Small Skeeri', modelWidth: 0.65, spriteAspect: FLYING_ASPECT, defaultFrame: 'perched',
      prefix: 'skeeri', base: {
        idle: 'skeeri_planebent_perched.png', perched: 'skeeri_planebent_perched.png',
        flying: 'skeeri_planebent_flying.png',
        run1: 'skeeri_planebent_flying.png', run2: 'skeeri_planebent_flying.png',
      }, patterns: [],
    },
    'skeeri-medium': { label: 'Skeeri', mirrorOf: 'skeeri-small', modelWidth: 1.15, spriteAspect: FLYING_ASPECT, defaultFrame: 'perched' },
    'skeeri-large': { label: 'Large Skeeri', mirrorOf: 'skeeri-small', modelWidth: 2.2, spriteAspect: FLYING_ASPECT, defaultFrame: 'perched' },
    'gar-wolf-alpha': { label: 'Gar-wolf Alpha', mirrorOf: 'gar-wolf', modelWidth: 3.1 },
    'grehlr-den-mother': { label: 'Grehlr Den-Mother', mirrorOf: 'grehlr', modelWidth: 3.1 },
    'drenkirra-den-mother': { label: 'Drenkirra Nestmother', mirrorOf: 'drenkirra', modelWidth: 1.16 },
  });

  function definitionFor(kind) {
    const own = entries[kind]; // Supplies the variant's distinct size and label.
    if (!own) return null;
    return own.mirrorOf ? { ...entries[own.mirrorOf], ...own } : own;
  }

  function install(species, resolveAsset = path => path) {
    if (!species || typeof species !== 'object') return 0;
    let installed = 0; // Used for diagnostics in the Animation Author's built-in log.
    for (const [kind, own] of Object.entries(entries)) {
      const definition = definitionFor(kind); // Reuses canonical art without duplicating base species or genetic overlays.
      const existing = species[kind]; // Gameplay registrations, if already installed, remain authoritative.
      const body = definition.base ? Object.fromEntries(Object.entries(definition.base)
        .map(([frame, filename]) => [frame, resolveAsset(SPRITES + filename)])) : null;
      if (existing) {
        // Existing flying registrations usually expose "idle" but not the explicit "perched" selector.
        if (own.defaultFrame === 'perched' && body?.perched && !existing.base?.perched) {
          existing.base ||= {};
          existing.base.perched = body.perched;
        }
        continue;
      }
      const origin = own.mirrorOf && species[own.mirrorOf] ? species[own.mirrorOf] : null;
      if (!body && !origin) continue;
      species[kind] = origin ? { ...origin, base: { ...origin.base }, patterns: [...(origin.patterns || [])] } : {
        prefix: definition.prefix, base: body, patterns: [...(definition.patterns || [])],
        patternAssetRoot: resolveAsset(SPRITES + 'patterns'),
        ...(definition.eyes ? { eyes: Object.fromEntries(Object.entries(definition.eyes)
          .map(([state, filename]) => [state, resolveAsset(SPRITES + filename)])) } : {}),
        ...(definition.defaultCoatPatterns ? { defaultCoatPatterns: definition.defaultCoatPatterns.map(item => ({ ...item })) } : {}),
        ...Object.fromEntries(['baseShadeReferenceHex', 'baseRecolorKeyHex', 'baseRecolorHueTolerance',
          'baseRecolorMinSaturationRatio', 'fullBaseRecolor'].filter(key => definition[key] !== undefined)
          .map(key => [key, definition[key]])),
      };
      installed++;
    }
    return installed;
  }

  window.HobunjiRigPreviewSpecies = Object.freeze({
    install,
    speciesInfo: kind => definitionFor(kind),
    labelFor: kind => entries[kind]?.label || null,
    baseSpecies: kind => entries[kind]?.mirrorOf || kind, // Allows alpha/den variant previews to reuse the original species' normal coat palette.
    defaultFrame: kind => entries[kind]?.defaultFrame || null,
    genotypeDefaults: kind => {
      const definition = definitionFor(kind);
      return definition ? { base: definition.baseColor || '#808080', patterns: {} } : null;
    },
  });
})();
