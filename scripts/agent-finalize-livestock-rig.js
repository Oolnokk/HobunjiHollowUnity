'use strict';

const fs = require('node:fs');

function replaceOnce(path, before, after, label) {
  const source = fs.readFileSync(path, 'utf8');
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: expected source block not found in ${path}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source block is not unique in ${path}`);
  fs.writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length));
}

// 1) Promote the September 15 Puktuk/Vorg-ass authoring export into the immutable
// attachment-rig master so gameplay, fresh Animation Author sessions, import/export
// reconciliation, and diagnostics all start from the same values.
const rigPath = 'docs/config/attachment-rig-profiles.js';
replaceOnce(
  rigPath,
  "    ['uumkaoii',[0,0.26595632314682005,0.02],'built-in-approved-rig-json-v1524',null,null,null,[0.01,-0.3636087789187775,-0.18395679109723],[[1.5,1.5],[1,1],[0.2,0.2]],null],\n  ];",
  "    ['uumkaoii',[0,0.26595632314682005,0.02],'built-in-approved-rig-json-v1524',null,null,null,[0.01,-0.3636087789187775,-0.18395679109723],[[1.5,1.5],[1,1],[0.2,0.2]],null],\n    ['puktuk',[0,0.16937859550590686,-0.012420318741466083],'animation-author-export-2026-09-15',null,null,null,[0.01,-0.29715994741785007,-0.0010889163404909086],[[1,1],[0.6,0.6],[0.3,0.3]],null],\n    ['voorg-ass',[-0.0016655977917167481,0.12286908956931555,0.043832914384796626],'animation-author-export-2026-09-15',null,null,null,[0.01,-0.33453636625016553,0.0181046276028018],[[0.97,0.97],[0.75,0.75],[0.27,0.27]],null],\n  ];",
  'canonical creature records',
);
replaceOnce(
  rigPath,
  "    uumkaoii: Object.freeze({ large: 0.69, medium: 0.48, small: 0.09 }),\n  });",
  "    uumkaoii: Object.freeze({ large: 0.69, medium: 0.48, small: 0.09 }),\n    puktuk: Object.freeze({ large: 0.40, medium: 0.24, small: 0.12 }),\n    'voorg-ass': Object.freeze({ large: 0.26, medium: 0.325, small: 0.11 }),\n  });",
  'canonical creature ground offsets',
);
replaceOnce(
  rigPath,
  "    uumkaoii: Object.freeze({ x: 0.009564166583519832, y: 0.2923510947804583, width: 0.4656387672084861, height: 0.47038721094834346, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),\n  });",
  "    uumkaoii: Object.freeze({ x: 0.009564166583519832, y: 0.2923510947804583, width: 0.4656387672084861, height: 0.47038721094834346, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),\n    puktuk: Object.freeze({ x: 0.17142091899942474, y: 0.11029044613093768, width: 0.27636019798104444, height: 0.601013493102534, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),\n    'voorg-ass': Object.freeze({ x: 0.1235, y: 0.14, width: 0.3074, height: 0.3325, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),\n  });",
  'canonical creature chathead frames',
);
replaceOnce(
  rigPath,
  "  for (const [kind, saddle, saddleSource, saddleOffset, saddlePixel, midlineSearchRadiusPx, shoulderGrip, scales, grehlrSizeScaleDefaultVersion] of creatureRecords) {\n    const saddleRule = saddleSource === 'highest-opaque-pixel-along-idle-sprite-midline'",
  "  for (const [kind, saddle, saddleSource, saddleOffset, saddlePixel, midlineSearchRadiusPx, shoulderGrip, scales, grehlrSizeScaleDefaultVersion] of creatureRecords) {\n    const creatureAuthoredSource = (kind === 'puktuk' || kind === 'voorg-ass') ? 'animation-author-export-2026-09-15' : 'authored-2026-08-28-attachpointsv1'; // New livestock uses the user's final September 15 Rig Coordinates export rather than an older analogue.\n    const saddleRule = saddleSource === 'highest-opaque-pixel-along-idle-sprite-midline'",
  'creature authored source',
);
replaceOnce(
  rigPath,
  "      shoulderGripRule: { source: 'authored-2026-08-28-attachpointsv1', coordinateSpace: 'unscaled-idle-png-plane-local', defaultRuleVersion: 5, authoredDefaultVersion: 7, authoredFixed: true, recalculateOnPreview: false },",
  "      shoulderGripRule: { source: creatureAuthoredSource, coordinateSpace: 'unscaled-idle-png-plane-local', defaultRuleVersion: 5, authoredDefaultVersion: 7, authoredFixed: true, recalculateOnPreview: false },",
  'creature grip provenance',
);
replaceOnce(
  rigPath,
  "      sizeScaleRule: { version:1, axes:'png-plane-local-x-y', zScale:1, applicationOrder:'before-outer-prism-and-world-bounds', authoredDefaultVersion:6, authoredFixed:true },",
  "      sizeScaleRule: { version:1, axes:'png-plane-local-x-y', zScale:1, applicationOrder:'before-outer-prism-and-world-bounds', authoredDefaultVersion:6, authoredFixed:true, ...((kind === 'puktuk' || kind === 'voorg-ass') ? { source: creatureAuthoredSource } : {}) },",
  'creature scale provenance',
);

// 2) Make the genetics/runtime layer prefer a species' own canonical rig profile.
// The old Gar-wolf/Uumkao'ii aliases remain only as compatibility fallbacks for
// stripped fixtures or old saves/configs where the new profile is genuinely absent.
const geneticsPath = 'docs/js/creature-genetics.js';
replaceOnce(
  geneticsPath,
  "  const PUKTUK_VISUAL_SCALE = 0.75; // Applied to Puktuk's borrowed size and ground calibration so every size class stays uniformly 25% smaller.",
  "  const PUKTUK_VISUAL_SCALE = 0.75; // Legacy fallback only: old/stripped configs that lack Puktuk's own authored rig still borrow Gar-wolf at 75% scale.",
  'Puktuk fallback comment',
);
replaceOnce(
  geneticsPath,
  "  const CREATURE_SIZE_PROFILE_ALIAS = {\n    puktuk: 'gar-wolf',\n    'voorg-ass': 'uumkaoii',\n  }; // Used only by size/ground calibration; each species keeps its own sprites/genotype renderer.",
  "  const CREATURE_SIZE_PROFILE_ALIAS = {\n    puktuk: 'gar-wolf',\n    'voorg-ass': 'uumkaoii',\n  }; // Compatibility fallback only; a species' own authored profile always wins when present.",
  'size alias comment',
);
replaceOnce(
  geneticsPath,
  "    const profileKind = CREATURE_SIZE_PROFILE_ALIAS[kind] || GENOTYPE_SPECIES_ALIAS[kind] || kind; // Species may borrow size calibration without becoming a render alias.\n    const authored = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[profileKind]?.sizeScales?.[sizeClass]; // Canonical Animation Author export.\n    const x = Number(authored?.x); // Applied to the creature plane's local width.\n    const y = Number(authored?.y); // Applied to the creature plane's local height and ground lift.\n    const speciesScale = kind === PUKTUK_KIND ? PUKTUK_VISUAL_SCALE : 1; // Used here so Puktuk can borrow Gar-wolf proportions without inheriting Gar-wolf's absolute visual size.",
  "    const ownProfile = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[kind]; // Newly authored species own their calibration directly; aliases are only a legacy fallback.\n    const profileKind = ownProfile ? kind : (CREATURE_SIZE_PROFILE_ALIAS[kind] || GENOTYPE_SPECIES_ALIAS[kind] || kind);\n    const authored = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[profileKind]?.sizeScales?.[sizeClass]; // Canonical Animation Author export.\n    const x = Number(authored?.x); // Applied to the creature plane's local width.\n    const y = Number(authored?.y); // Applied to the creature plane's local height and ground lift.\n    const speciesScale = kind === PUKTUK_KIND && profileKind !== kind ? PUKTUK_VISUAL_SCALE : 1; // Retains the old 75% Gar-wolf fallback without double-scaling Puktuk's own authored values.",
  'direct creature size profile',
);
replaceOnce(
  geneticsPath,
  "    const profileKind = CREATURE_SIZE_PROFILE_ALIAS[kind] || GENOTYPE_SPECIES_ALIAS[kind] || kind; // Size aliases borrow floor calibration while visual aliases keep their own behavior.\n    const authored = Number(window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[profileKind]?.groundOffsets?.[sizeClass]); // Absolute floor-to-creature-origin lift measured by moving the preview ground under a fixed animal.\n    const speciesScale = kind === PUKTUK_KIND ? PUKTUK_VISUAL_SCALE : 1; // Used with Puktuk's visual scale so shrinking the borrowed rig does not leave the sprite floating above the ground.",
  "    const ownProfile = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[kind]; // Uses each species' authored floor calibration whenever it exists.\n    const profileKind = ownProfile ? kind : (CREATURE_SIZE_PROFILE_ALIAS[kind] || GENOTYPE_SPECIES_ALIAS[kind] || kind);\n    const authored = Number(window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[profileKind]?.groundOffsets?.[sizeClass]); // Absolute floor-to-creature-origin lift measured by moving the preview ground under a fixed animal.\n    const speciesScale = kind === PUKTUK_KIND && profileKind !== kind ? PUKTUK_VISUAL_SCALE : 1; // Applies 75% only to the old Gar-wolf fallback, never to Puktuk's authored ground offsets.",
  'direct creature ground profile',
);
replaceOnce(
  geneticsPath,
  "      base: {\n        idle: 'assets/creaturesprites/puktuk_idle.png',\n        run1: 'assets/creaturesprites/puktuk_run1.png',\n        run2: 'assets/creaturesprites/puktuk_run2.png',\n      },\n      patterns: ['belly', 'foxtail'],",
  "      base: {\n        idle: 'assets/creaturesprites/puktuk_idle.png',\n        run1: 'assets/creaturesprites/puktuk_run1.png',\n        run2: 'assets/creaturesprites/puktuk_run2.png',\n      },\n      patterns: ['belly', 'foxtail'],\n      eyes: { open: 'assets/creaturesprites/puktuk_eye.png', blink: 'assets/creaturesprites/puktuk_blink.png' }, // Uses the shared untinted eye/blink overlay path after coat patterns.\n",
  'Puktuk eye overlays',
);
replaceOnce(geneticsPath, 'sizeProfile=gar-wolf belly=always', 'sizeProfile=puktuk belly=always', 'Puktuk runtime diagnostics');
replaceOnce(geneticsPath, 'sizeProfile=uumkaoii belly=always', 'sizeProfile=voorg-ass belly=always', 'Vorg-ass runtime diagnostics');

// 3) A fresh Animation Author session should import the immutable same-kind
// canonical profile first. Analogue seeding remains only as a compatibility
// fallback for an older repository revision that truly lacks these profiles.
const bridgePath = 'docs/js/animal-chathead-frame.js';
replaceOnce(
  bridgePath,
  "// Rig Coordinates predates Puktuk and Vorg-ass. Keep the editor's embedded\n// five-creature snapshot intact, then seed only missing new species through\n// its own import path. These are deliberately editable starting coordinates,\n// not fake human-approved attachment values.",
  "// Rig Coordinates predates Puktuk and Vorg-ass. If an older embedded editor\n// snapshot omits them, restore the repository's same-kind canonical profiles\n// through the editor's own import path. Analogue seeding is retained only as\n// a compatibility fallback for older repository revisions without final data.",
  'Rig bridge description',
);
replaceOnce(
  bridgePath,
  "  function sourceProfile(live, sourceKind) {\n    return live?.creatures?.[sourceKind]\n      || global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[sourceKind]\n      || global.HOBUNJI_ATTACHMENT_RIG_MASTER?.profiles?.creatures?.[sourceKind]\n      || null;\n  }",
  "  function canonicalProfile(kind) {\n    return global.HOBUNJI_ATTACHMENT_RIG_MASTER?.profiles?.creatures?.[kind]\n      || global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[kind]\n      || null;\n  }\n\n  function sourceProfile(live, sourceKind) {\n    return live?.creatures?.[sourceKind]\n      || global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[sourceKind]\n      || global.HOBUNJI_ATTACHMENT_RIG_MASTER?.profiles?.creatures?.[sourceKind]\n      || null;\n  }",
  'canonical new creature profile lookup',
);
replaceOnce(
  bridgePath,
  "    for (const kind of missing) {\n      const seed = seededProfile(kind, SEED_SOURCES[kind], repaired);\n      if (seed) repaired.creatures[kind] = seed;\n      else unresolved.push(kind);\n    }\n    if (unresolved.length) {\n      status.state = 'seed-source-missing';",
  "    for (const kind of missing) {\n      const canonical = canonicalProfile(kind); // September 15 authoring is authoritative once the repository master contains it.\n      const replacement = canonical ? clone(canonical) : seededProfile(kind, SEED_SOURCES[kind], repaired);\n      if (replacement) repaired.creatures[kind] = replacement;\n      else unresolved.push(kind);\n    }\n    if (unresolved.length) {\n      status.state = 'canonical-or-seed-source-missing';",
  'canonical-first Rig repair',
);

// The obsolete post-master runtime sidecar is removed after the master itself
// owns both profiles. Keeping two authorities would make a later edit ambiguous.
for (const obsolete of [
  'docs/config/attachment-rig-livestock-authored.js',
  'scripts/test-authored-livestock-rig-runtime.js',
]) {
  if (fs.existsSync(obsolete)) fs.unlinkSync(obsolete);
}

console.log('Finalized canonical Puktuk/Vorg-ass rig settings and Puktuk eyes.');
