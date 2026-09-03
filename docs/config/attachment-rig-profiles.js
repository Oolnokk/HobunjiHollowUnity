// Canonical attachment-rig master assembled field-by-field from the latest
// clearly intentional authoring pass for each coordinate family. Runtime and
// authoring tools both consume this file; later bulk exports must not be
// allowed to replace unrelated authored fields with stale/default values.
(() => {
  'use strict';

  const MASTER_VERSION = 'hobunji-attachment-rig-master-2026-09-03-v2'; // Used to isolate corrected rig autosaves from the bad v1 shoulder baseline.
  const MASTER_SCHEMA = 'hobunji.attachment-rig-profiles.v10';
  const GAME_AVATAR_WIDTH = 0.9; // Used by provenance/diagnostics to document the coordinate space the v9 author actually rendered.
  const BAD_V1_SHOULDER_SCALE = 0.9; // Used only to recognize and repair shoulders double-scaled by the v1 forensic master.
  const V9_SHOULDERS_EXPORTED_AT = '2026-08-26T03:30:34.506Z'; // Used by shoulder provenance and diagnostics.
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const deepFreeze = value => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  };
  const identityAnchor = ([x, y, z], yaw = 0) => ({
    position: { x, y, z },
    rotationDeg: { x: 0, y: yaw, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const sameNumber = (a, b, epsilon = 1e-9) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= epsilon;
  const samePosition = (a, b, epsilon = 1e-9) => ['x', 'y', 'z'].every(axis => sameNumber(a?.[axis], b?.[axis], epsilon));
  const validPosition = value => ['x', 'y', 'z'].every(axis => Number.isFinite(Number(value?.[axis])));
  const zeroPosition = value => validPosition(value) && ['x', 'y', 'z'].every(axis => Math.abs(Number(value[axis])) <= 1e-12);

  const characterTransformAliases = Object.freeze({ rakakoan: 'kenkari', ghoul: 'mao-ao' });
  const transformSpeciesId = value => {
    const species = String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-');
    return characterTransformAliases[species] || species;
  };
  window.HOBUNJI_TRANSFORM_SPECIES_ALIASES = Object.freeze({ ...(window.HOBUNJI_TRANSFORM_SPECIES_ALIASES || {}), ...characterTransformAliases });
  window.hobunjiTransformSpeciesId = transformSpeciesId;

  const appearanceSpeciesConfig = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species;
  if (appearanceSpeciesConfig) {
    appearanceSpeciesConfig.ghoul = {
      label: 'Ghoul', parentSpecies: 'mao-ao', genders: ['male', 'female'],
      swatchBase: '#efd7d8', npcOnly: true, playerSelectable: false,
    };
  }
  const behindHeadUrls = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.behindView?.headUrls;
  if (behindHeadUrls) behindHeadUrls.ghoul = {
    male: 'fightersprites/special_cases/head-behind_ghoul_m.png',
    female: 'fightersprites/special_cases/head-behind_ghoul_f.png',
  };

  // Tuple fields:
  // key, legacyPosteriorOffset, floorPosteriorPercent, shoulderPerch,
  // leftHandShoulder, rightHandShoulder, shoulderPerchSourcePixel,
  // portraitModelHeight, portraitPlacement, portraitScale, handScale,
  // footScale, armLengthHeightPercentOffset.
  //
  // Hand shoulders are the exact v9 Rig Coordinates tuples. V15.36+ already
  // built the author avatar at gameplay width (0.9), so applying another 0.9
  // conversion here would double-scale values that were authored in game space.
  const characterRecords = [
    ['tletingan::male', -17.000000000000004, 24.829594593937666, [-0.1769199293575374,0.3839625600994886,0], [0.22770354382724423,0.42663710735156957,0], [-0.2448354156580218,0.4465232083661127,0], [59.09264957264957,108.5], 0.85,0.645,0.85,0.9,1,6],
    ['engh-sho::male', -52.49999999999999, 40.46344209891254, [-0.2115295187159422,0.6813045758748404,0], [0.2721813782445264,0.6838406837818225,0], [-0.28930388062923146,0.7000103424366998,0], [53.60656565656566,128.5], 0.95,1.005,0.95,1.15,1.275,0],
    ['mao-ao::male', -47, 37.31351872723915, [-0.2006533796199832,0.6234902368619534,0], [0.19067248465844266,0.6947557240731601,0], [-0.28087406205430004,0.6455541403639915,0], [62.551070840197696,125.5], null,0.95,1,1.1,1.05,0],
    ['mao-ao::female', -44.50000000000001, 40.198007305794635, [-0.14923510597360837,0.4721927183587378,0], [0.1771042396564939,0.6511546407522855,0], [-0.23898599170593354,0.646996571654354,0], [76.5545073375262,114.5], 1,0.925,0.8,1,1.025,0],
    ['kenkari::male', -5.500000000000004, 13.133738099540614, [-0.18055321970300925,0.27150559815116515,0], [0.17819817802695415,0.27810760526210354,0], [-0.18055321970300925,0.37969897363327487,0], [79.65683229813665,77.5], 0.75,0.51,0.75,1,1,0],
    ['kenkari::female', -4.0000000000000036, 18.49675435046502, [-0.12331214301269552,0.2212216457140902,0], [0.1629792650553279,0.29929878500014695,0], [-0.16564616738866406,0.25011972083640993,0], [87.90841750841751,82.5], 0.75,0.51,0.75,0.925,1,0],
    ['tletingan::female', -23.00000000000001, 21.62644067848934, [-0.15767922666458786,0.36829341919016667,0], [0.19339659287777322,0.38426858848533485,0], [-0.19326419458235525,0.38220450093854685,0], [67.36241610738254,99.5], 0.85,0.62,0.85,0.925,1.025,5],
    ['mashtzarr::male', -27.499999999999993, 28.18802021075617, [-0.3150161025604807,0.504441432761613,0], [0.2938287377558306,0.471474644548211,0], [-0.3481292844745114,0.5072329547240978,0], [63.960809102402024,87.5], 1,0.755,1.18,0.925,1.175,0],
    ['mashtzarr::female', -31.000000000000007, 29.459673223780613, [-0.20671639379279255,0.5521654715130626,0], [0.30553153725919435,0.39823082948935073,0], [-0.2938000697183753,0.37168801102709437,0], [72.13592233009709,97.5], 1,0.79,1.18,0.9,1.125,0],
    ['engh-sho::female', -49.500000000000014, 41.16182006615896, [-0.1857404318972175,0.5885050529830135,0], [0.20505349784094706,0.4967497459859368,0], [-0.24815066240089945,0.46042886220274515,0], [71.9398595258999,112.5], 0.95,0.975,0.95,1.225,1.325,0],
  ];

  // v1-master shoulder fingerprints are used only by reconcileProfiles() when
  // importing/migrating a draft that received the erroneous second x0.9 scale.
  const badV1HandShoulders = Object.freeze(Object.fromEntries(characterRecords.map(record => {
    const key = record[0];
    const left = record[4].map(value => value * BAD_V1_SHOULDER_SCALE);
    const right = record[5].map(value => value * BAD_V1_SHOULDER_SCALE);
    return [key, { left, right }];
  })));

  // Shoulder-perch fingerprints from the v9 bulk export. They are not master
  // values: the August 28 intentional perch pass below supersedes them.
  const v9StaleShoulderPerches = Object.freeze({
    'tletingan::male': [-0.1843306031478747,0.40261734325974574,0],
    'engh-sho::male': [-0.2312125102618596,0.7572702600778939,0],
    'mao-ao::male': [-0.29650716367602115,0.6473130571424927,0],
    'mao-ao::female': [-0.15362033651500306,0.5560865301833835,0],
    'kenkari::male': [-0.18055321970300925,0.27150559815116515,0],
    'kenkari::female': [-0.13819980616286182,0.2567143592120438,0],
    'tletingan::female': [-0.18362271672504038,0.40412748358854156,0],
    'mashtzarr::male': [-0.3080816783597182,0.6479187307531316,0],
    'mashtzarr::female': [-0.21765356423931137,0.603016367899253,0],
    'engh-sho::female': [-0.18678622648700421,0.69825,0],
  });

  // Tuple fields: kind, saddle, saddle source, saddle offset, saddle pixel,
  // midline radius, latest intentional shoulderGrip, size scales, optional
  // grehlr scale-default version.
  const creatureRecords = [
    ['drenkirra',[0,0.09289353489875796,0.02],'built-in-approved-rig-json-v1524',null,null,null,[0.01,-0.11914729549653388,-0.001096892109713506],[[4,4],[2,2],[0.9,0.9]],null],
    ['grehlr',[0,0.12393333333333335,0],'highest-opaque-pixel-along-idle-sprite-midline',-5,[1499.5,843.5],0,[0.01,-0.3719770036140037,0],[[1,1],[0.5,0.5],[0.2,0.2]],2],
    ['gar-wolf',[0,0.14184834174882754,0.2761841625577698],'built-in-approved-rig-json-v1524',null,null,null,[0.01,-0.26545210788556156,0.07486897921502367],[[1.5,1.5],[1,1],[0.35,0.35]],null],
    ['dabinggi-hound',[0,0.12212625800404886,0.6091387381509006],'highest-opaque-pixel-along-idle-sprite-midline',-5,[687.5,210.5],0,[0.01,-0.20203700498816118,0.09104867302389968],[[2,2],[1,1],[0.35,0.35]],null],
    ['uumkaoii',[0,0.26595632314682005,0.02],'built-in-approved-rig-json-v1524',null,null,null,[0.01,-0.3636087789187775,-0.18395679109723],[[1.5,1.5],[1,1],[0.2,0.2]],null],
  ];
  const staleCreatureShoulderGrips = Object.freeze({
    // V15.24's embedded Drenkirra differs slightly from the later v9 stale export in Z;
    // both share the same obsolete Y and must converge on the August 28 authored grip.
    drenkirra: Object.freeze([
      Object.freeze([0.01,-0.1636307385658067,0.0009131708735385657]),
      Object.freeze([0.01,-0.1636307385658067,0.003984738737597559]),
    ]),
    uumkaoii: Object.freeze([
      Object.freeze([0.01,-0.5363283597840667,-0.012886930890300352]),
    ]),
  });
  const staleCreatureSizeScales = Object.freeze({
    drenkirra: Object.freeze({ small: Object.freeze({ x: 1, y: 1 }) }),
  });

  const creatureGroundOffsets = Object.freeze({
    drenkirra: Object.freeze({ large: 0.79, medium: 0.40, small: 0.17 }),
    grehlr: Object.freeze({ large: 0.50, medium: 0.26, small: 0.10 }),
    'gar-wolf': Object.freeze({ large: 0.50, medium: 0.33, small: 0.11 }),
    'dabinggi-hound': Object.freeze({ large: 0.50, medium: 0.27, small: 0.09 }),
    uumkaoii: Object.freeze({ large: 0.69, medium: 0.48, small: 0.09 }),
  });
  const creatureChatheadFrames = Object.freeze({
    grehlr: Object.freeze({ x: 0.12899040207823892, y: 0.38396704728631864, width: 0.24202339114154608, height: 0.3445860779359126, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),
    'gar-wolf': Object.freeze({ x: 0, y: 0.2575, width: 0.25, height: 0.3575, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),
    'dabinggi-hound': Object.freeze({ x: 0.05321196485715341, y: 0.2621006265961596, width: 0.17863723264419087, height: 0.350903183334192, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),
    drenkirra: Object.freeze({ x: 0.1925, y: 0.3575, width: 0.2078, height: 0.305, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),
    uumkaoii: Object.freeze({ x: 0.009564166583519832, y: 0.2923510947804583, width: 0.4656387672084861, height: 0.47038721094834346, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),
  });

  const masterCharacters = {};
  for (const [key, heightPercentOffset, heightPercentFromFloor, perch, left, right, pixel, portraitModelHeight, placement, portraitScale, handScale, footScale, armLength] of characterRecords) {
    const [species, gender] = key.split('::');
    const shoulderPerchRule = {
      source: 'authored-2026-08-28-rig-export', heightPercentOffset: 0,
      defaultRuleVersion: 4, sourcePixel: { x: pixel[0], y: pixel[1] },
      ...(portraitModelHeight == null ? {} : { portraitModelHeight }),
      portraitVerticalPlacementRatio: placement, recalculateOnPreview: false,
      authoredDefaultVersion: 7, authoredFixed: true,
      appearanceSpeciesId: species, appearanceGender: gender,
      coordinateSpace: 'appearance-species-floor-relative',
    };
    masterCharacters[key] = {
      species, gender,
      posteriorRule: {
        xMode: 'center', ySource: 'portraitModelHeight-from-floor', offsetBasis: 'portraitModelHeight',
        heightPercentOffset, heightPercentFromFloor, defaultRuleVersion: 5,
        masterSource: 'recovered-pre-v9-floor-calibration-confirmed-2026-08-29',
      },
      anchors: {
        posterior: identityAnchor([0,0,0]),
        shoulderPerch: { ...identityAnchor(perch), sourcePixel: { ...shoulderPerchRule.sourcePixel } },
        leftHandShoulder: identityAnchor(left),
        rightHandShoulder: identityAnchor(right),
      },
      shoulderPerchRule,
      handShoulderRule: {
        source: 'rig-anchor-gizmo-v9-exact-supplied',
        coordinateSpace: 'character-visual-local', version: 4,
        authoredPreviewBaseWidth: GAME_AVATAR_WIDTH,
        runtimeBaseWidth: GAME_AVATAR_WIDTH,
        positionScaleApplied: 1,
        v9ExportedAt: V9_SHOULDERS_EXPORTED_AT,
      },
      anatomy: {
        portraitVerticalPlacementRatio: placement, portraitScale, handScale, footScale,
        armLengthHeightPercentOffset: armLength, version: 2,
      },
      characterAttachZDefaultVersion: 1,
    };
  }

  const masterCreatures = {};
  for (const [kind, saddle, saddleSource, saddleOffset, saddlePixel, midlineSearchRadiusPx, shoulderGrip, scales, grehlrSizeScaleDefaultVersion] of creatureRecords) {
    const saddleRule = saddleSource === 'highest-opaque-pixel-along-idle-sprite-midline'
      ? { source: saddleSource, heightPercentOffset: saddleOffset, defaultRuleVersion: 3, sourcePixel: { x: saddlePixel[0], y: saddlePixel[1] }, midlineSearchRadiusPx, authoredDefaultVersion: 6, authoredFixed: true, recalculateOnPreview: false }
      : { source: saddleSource, defaultRuleVersion: 3, authoredDefaultVersion: 6, authoredFixed: true, recalculateOnPreview: false };
    const sizeScales = {
      large: { x: scales[0][0], y: scales[0][1] },
      medium: { x: scales[1][0], y: scales[1][1] },
      small: { x: scales[2][0], y: scales[2][1] },
    };
    masterCreatures[kind] = {
      kind, chatheadFrame: { ...creatureChatheadFrames[kind] },
      anchors: { saddle: identityAnchor(saddle), shoulderGrip: identityAnchor(shoulderGrip, -61) },
      saddleRule,
      shoulderGripRule: { source: 'authored-2026-08-28-attachpointsv1', coordinateSpace: 'unscaled-idle-png-plane-local', defaultRuleVersion: 5, authoredDefaultVersion: 7, authoredFixed: true, recalculateOnPreview: false },
      sizeScales, groundOffsets: { ...(creatureGroundOffsets[kind] || { large:0, medium:0, small:0 }) },
      sizeScaleRule: { version:1, axes:'png-plane-local-x-y', zScale:1, applicationOrder:'before-outer-prism-and-world-bounds', authoredDefaultVersion:6, authoredFixed:true },
      shoulderGripRotationDefaultVersion: 2,
      creatureShoulderGripDefaultVersion: 5,
      sizeScalePercentages: {
        large: { x: sizeScales.large.x * 100, y: sizeScales.large.y * 100 },
        medium: { x: sizeScales.medium.x * 100, y: sizeScales.medium.y * 100 },
        small: { x: sizeScales.small.x * 100, y: sizeScales.small.y * 100 },
      },
      ...(grehlrSizeScaleDefaultVersion == null ? {} : { grehlrSizeScaleDefaultVersion }),
    };
  }

  const MASTER_PROVENANCE = Object.freeze({
    handShoulder: Object.freeze({
      source: 'exact supplied v9 Rig Coordinates hand-shoulder tuples authored after Animation Author adopted gameplay width 0.9',
      authoredCommit: 'bbd8c0ed2934b8f76e0e85986cd191ab548f9945',
      exportedAt: V9_SHOULDERS_EXPORTED_AT,
      correction: 'v2 removes the v1 forensic master extra x0.9 scale; exact v9 values are already runtime-space values',
    }),
    posterior: Object.freeze({
      source: 'floor-relative posterior authoring; calibrated values recovered after v9 serialized the floor field as zero',
      coordinateChangeCommit: 'ec3594dd8db7350349e2ab7b179317bcd2a826f9',
      recoveryCommit: 'f0a176ec7e90802d3a6107b04aa4125621c44b5b',
    }),
    portraitScale: Object.freeze({
      source: 'latest authored species/gender anatomy portraitScale values, made authoritative for preview/runtime',
      authorityCommit: '79057667a678bde6d62c1ce929a354c18cd40f73',
    }),
    shoulderPerch: Object.freeze({
      source: 'supplied 2026-08-28 rig export retained by the avatar-regression recovery pass',
      recoveryCommit: 'f0a176ec7e90802d3a6107b04aa4125621c44b5b',
      authoredAt: '2026-08-28T03:24:15.652Z',
    }),
    shoulderGrip: Object.freeze({
      source: 'supplied 2026-08-28 creature rig export retained by the avatar-regression recovery pass',
      recoveryCommit: 'f0a176ec7e90802d3a6107b04aa4125621c44b5b',
      authoredAt: '2026-08-28T03:24:15.652Z',
    }),
    saddle: Object.freeze({
      source: 'last clearly intentional approved/v9 saddle coordinates; no later pass intentionally reauthored saddles',
      baselineCommit: 'bbd8c0ed2934b8f76e0e85986cd191ab548f9945',
    }),
  });

  const masterProfiles = { characters: clone(masterCharacters), creatures: clone(masterCreatures) };
  const master = {
    version: MASTER_VERSION,
    schema: MASTER_SCHEMA,
    assembledAt: '2026-09-03',
    provenance: MASTER_PROVENANCE,
    transformSpeciesAliases: characterTransformAliases,
    profiles: masterProfiles,
  };
  window.HOBUNJI_ATTACHMENT_RIG_MASTER = deepFreeze(master);

  function runtimeProfilesFromMaster() {
    const characters = clone(masterCharacters);
    const creatures = clone(masterCreatures);
    for (const [aliasSpecies, sourceSpecies] of Object.entries(characterTransformAliases)) {
      for (const gender of ['male','female']) {
        const sourceKey = `${sourceSpecies}::${gender}`;
        const aliasKey = `${aliasSpecies}::${gender}`;
        if (characters[sourceKey]) characters[aliasKey] = characters[sourceKey];
      }
    }
    const creatureShoulderGripDefaults = Object.fromEntries(Object.entries(creatures).map(([kind, profile]) => [kind, { ...profile.anchors.shoulderGrip.position }]));
    return {
      characters, creatures, characterTransformAliases,
      masterConfigVersion: MASTER_VERSION,
      defaultRuleVersion: 3,
      posteriorFloorRuleVersion: 5,
      shoulderPerchDefaultRuleVersion: 4,
      creatureShoulderGripDefaults,
      creatureShoulderGripDefaultRuleVersion: 5,
      creatureGroundOffsetSemantics: {
        profileField: 'profiles.creatures.<kind>.groundOffsets.<small|medium|large>',
        coordinateSpace: 'absolute world/gameplay floor-to-creature-origin lift replacing automatic half-height terrain placement',
        runtimeUnit: 'world units',
      },
      creatureChatheadFrameSemantics: {
        coordinateSpace: 'sprite-normalized-top-left', sourceFrame: 'idle creature sprite before size-class scaling',
        use: 'ambient dialogue chatheads, livestock full dialogue, and animal-looking full-dialogue portraits',
        specialNpcSpecies: { banubu: 'grehlr', hiki_hiki: 'drenkirra' },
      },
      creatureSizeScaleSemantics: {
        profileField: 'profiles.creatures.<kind>.sizeScales.<small|medium|large>.{x,y}',
        axes: 'png-plane-local-x-y', zScale: 1,
        applicationOrder: 'direct rendered animal mesh local X/Y; rig-anchor positions share an anchor-only scale root; before world bounds',
        runtimeUnit: 'multiplier', displayUnit: 'percent', conversion: 'multiplier = percent / 100',
      },
      characterAttachPointDefaultZ: 0,
      characterSpeciesSource: 'avatarEditor.rawExport/profile/npc appearance only; NPC info-form species excluded',
      characterShoulderPerchVerticalPlacement: 'PNGPlaneAvatar.avatarPlacementRatioFor(appearance)',
      anatomySemantics: {
        profileField: 'character.anatomy', portraitYOffsetFormula: '(portraitVerticalPlacementRatio - 0.5) * 100',
        portraitScale: 'portraitScale is an independent species/gender multiplier; legacy species-only numbers remain supported',
        scales: 'handScale and footScale are independent species/gender multipliers',
        armLength: 'positive armLengthHeightPercentOffset moves unowned fallback hands downward by portraitModelHeight * percent / 100',
        aliases: 'Rakakoan resolves to Kenkari and Ghoul resolves to Mao-ao; alias species own no independent transform values.',
      },
    };
  }

  window.HOBUNJI_ATTACHMENT_RIG_PROFILES = runtimeProfilesFromMaster();
  window.HOBUNJI_ATTACHMENT_RIG_EXPORT_META = Object.freeze({
    schema: MASTER_SCHEMA,
    exportedAt: '2026-09-03T00:00:00.000Z',
    masterConfigVersion: MASTER_VERSION,
    coordinateSpace: 'Characters: floor-relative 0.9-wide runtime avatar space. Creature coordinates: unscaled idle-sprite local space.',
    transformSpeciesAliases: characterTransformAliases,
    fieldProvenance: MASTER_PROVENANCE,
    derivedCoordinates: {
      characterPosterior: { source:'posteriorRule.heightPercentFromFloor', formula:'portraitModelHeight * heightPercentFromFloor / 100', legacyFallback:'handAttachY + portraitModelHeight * heightPercentOffset / 100' },
      characterShoulderPerch: { source:'authored 2026-08-28 rig coordinates', offsetPercent:0 },
      characterHandShoulders: { source:'exact v9 Rig Coordinates export', positionScaleApplied:1, runtimeBaseWidth:GAME_AVATAR_WIDTH, exportedAt:V9_SHOULDERS_EXPORTED_AT },
      creatureSaddle: { source:'approved/v9 authored saddle coordinates' },
      creatureShoulderGrip: { source:'authored 2026-08-28 creature rig coordinates', defaultRuleVersion:5 },
      idleHands: { x:'matching leftHandShoulder/rightHandShoulder anchor X', y:'derived character posterior Y plus procedural idle/walk Y offset', aimTarget:'matching full hand-shoulder anchor transform' },
    },
    attachmentSemantics: {
      mount: { carrierAnchor:'creature.saddle', riderAnchor:'character.posterior', keyedObject:'intermediateParent' },
      shoulderPet: { carrierAnchor:'character.shoulderPerch', riderAnchor:'creature.shoulderGrip', keyedObject:'intermediateParent' },
    },
  });

  window.HOBUNJI_ATTACHMENT_RIG_MATH = Object.freeze({
    characterPosteriorY(posteriorRule, modelHeight, legacyHandAttachY) {
      const height = Number(modelHeight);
      const safeHeight = Number.isFinite(height) && height > 0 ? height : 0.9;
      const floorPercent = Number(posteriorRule?.heightPercentFromFloor);
      if (Number.isFinite(floorPercent)) return safeHeight * floorPercent / 100;
      const legacyOffset = Number(posteriorRule?.heightPercentOffset);
      const legacyBase = Number(legacyHandAttachY);
      return (Number.isFinite(legacyBase) ? legacyBase : safeHeight / 2)
        + safeHeight * (Number.isFinite(legacyOffset) ? legacyOffset : -18) / 100;
    },
  });

  window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS = {
    schema: MASTER_SCHEMA, exportedAt: window.HOBUNJI_ATTACHMENT_RIG_EXPORT_META.exportedAt,
    masterConfigVersion: MASTER_VERSION,
    shoulderAnchorsExportedAt: V9_SHOULDERS_EXPORTED_AT,
    anatomyProfiles: 'pending', authoredCharacterProfiles: 10, suppliedCharacterProfiles: 14,
    sharedCharacterProfiles: 4, exactSuppliedProfiles: 10, authoredCreatureProfiles: 5,
    parrotSharedProfiles: 2, rakakoanTransforms: 'always-aliased-to-kenkari',
    ghoulTransforms: 'always-aliased-to-mao-ao',
    handShoulderCalibration: 'v9-exact-post-calibration-no-extra-scale',
    anchorPositionScale: 1, posteriorCoordinateSpace: 'floor-relative',
    posteriorPixelDependency: 'removed', posteriorFloorValues: 'master-recovered-from-pre-v9-floor-calibration',
    exporterGuard: 'master-reconcile-and-versioned-rig-autosave',
    animationAuthorCreatureSync: { state: 'not-needed-yet', repairs: 0, lastReason: null },
  };

  const applyAttachmentRigProfileCorrections = () => {
    const pngAvatarConfig = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar;
    if (!pngAvatarConfig?.portraitScaleBySpecies || !pngAvatarConfig?.portraitVerticalPlacement) return false;
    pngAvatarConfig.proceduralFeet ||= {};
    pngAvatarConfig.proceduralFeet.footScale ||= { default: 1 };
    for (const aliasSpecies of Object.keys(characterTransformAliases)) {
      delete pngAvatarConfig.portraitVerticalPlacement[aliasSpecies];
      delete pngAvatarConfig.portraitScaleBySpecies[aliasSpecies];
      delete pngAvatarConfig.proceduralFeet.footScale?.[aliasSpecies];
      delete pngAvatarConfig.proceduralFeet.legBend?.[aliasSpecies];
    }
    const handScaleUpdates = [];
    const appliedProfiles = new Set();
    for (const profile of Object.values(window.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters)) {
      if (!profile || appliedProfiles.has(profile)) continue;
      appliedProfiles.add(profile);
      const species = String(profile.species || '').trim().toLowerCase();
      const gender = String(profile.gender || '').trim().toLowerCase();
      const anatomy = profile.anatomy || {};
      if (!species || !gender) continue;
      const placement = Number(anatomy.portraitVerticalPlacementRatio);
      const portraitScale = Number(anatomy.portraitScale);
      const handScale = Number(anatomy.handScale);
      const footScale = Number(anatomy.footScale);
      if (Number.isFinite(placement)) {
        pngAvatarConfig.portraitVerticalPlacement[species] ||= {};
        pngAvatarConfig.portraitVerticalPlacement[species][gender] = placement;
      }
      if (Number.isFinite(portraitScale) && portraitScale > 0) {
        const legacyScale = Number(pngAvatarConfig.portraitScaleBySpecies[species]);
        const scaleProfile = typeof pngAvatarConfig.portraitScaleBySpecies[species] === 'object'
          ? pngAvatarConfig.portraitScaleBySpecies[species]
          : { default: Number.isFinite(legacyScale) && legacyScale > 0 ? legacyScale : 1 };
        scaleProfile[gender] = portraitScale;
        pngAvatarConfig.portraitScaleBySpecies[species] = scaleProfile;
      }
      if (Number.isFinite(footScale) && footScale > 0) {
        pngAvatarConfig.proceduralFeet.footScale[species] ||= {};
        pngAvatarConfig.proceduralFeet.footScale[species][gender] = footScale;
      }
      if (Number.isFinite(handScale) && handScale > 0) handScaleUpdates.push({ species, gender, handScale });
    }
    const handProfiles = window.HobunjiHandModelProfiles;
    if (handProfiles?.mutate) {
      const aliasOverridesPresent = Object.keys(characterTransformAliases).some(aliasSpecies => handProfiles.data?.speciesScaleOverrides?.[aliasSpecies]);
      const needsMutation = aliasOverridesPresent || handScaleUpdates.some(update => Number(handProfiles.data?.speciesScaleOverrides?.[update.species]?.[update.gender]) !== update.handScale);
      if (needsMutation) handProfiles.mutate(profileData => {
        profileData.speciesScaleOverrides ||= {};
        for (const aliasSpecies of Object.keys(characterTransformAliases)) delete profileData.speciesScaleOverrides[aliasSpecies];
        for (const update of handScaleUpdates) {
          profileData.speciesScaleOverrides[update.species] ||= {};
          profileData.speciesScaleOverrides[update.species][update.gender] = update.handScale;
        }
      });
    }
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.anatomyProfiles = handProfiles?.mutate ? 'applied' : 'config-applied; hand-runtime-pending';
    return true;
  };
  window.applyHobunjiAttachmentRigProfileCorrections = applyAttachmentRigProfileCorrections;
  applyAttachmentRigProfileCorrections();

  function masterCharacter(key) { return masterCharacters[key] || null; }
  function masterCreature(kind) { return masterCreatures[kind] || null; }
  function normalizeStalePositions(value) {
    if (!value) return [];
    if (Array.isArray(value) && Array.isArray(value[0])) return value.map(position => ({ x:position[0], y:position[1], z:position[2] }));
    if (Array.isArray(value)) return [{ x:value[0], y:value[1], z:value[2] }];
    return [value];
  }
  function reconcileAnchor(candidate, canonical, stalePositions = null) {
    const source = clone(candidate || canonical);
    const sourcePosition = source?.position;
    const canonicalPosition = canonical?.position;
    const matchesKnownStale = normalizeStalePositions(stalePositions).some(position => samePosition(sourcePosition, position));
    if (!validPosition(sourcePosition) || (zeroPosition(sourcePosition) && !zeroPosition(canonicalPosition)) || matchesKnownStale) {
      return clone(canonical);
    }
    return source;
  }
  function repairKnownCreatureSizeScale(kind, merged, canonical) {
    const staleByClass = staleCreatureSizeScales[kind];
    if (!staleByClass) return false;
    let repaired = false;
    merged.sizeScales ||= clone(canonical.sizeScales || {});
    merged.sizeScalePercentages ||= clone(canonical.sizeScalePercentages || {});
    for (const [sizeClass, stale] of Object.entries(staleByClass)) {
      const current = merged.sizeScales?.[sizeClass];
      if (!sameNumber(current?.x, stale.x) || !sameNumber(current?.y, stale.y)) continue;
      merged.sizeScales[sizeClass] = clone(canonical.sizeScales[sizeClass]);
      if (canonical.sizeScalePercentages?.[sizeClass]) merged.sizeScalePercentages[sizeClass] = clone(canonical.sizeScalePercentages[sizeClass]);
      repaired = true;
    }
    return repaired;
  }

  function reconcileProfiles(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const output = { ...clone(source), characters: clone(source.characters || {}), creatures: clone(source.creatures || {}) };
    for (const key of Object.keys(masterCharacters)) {
      const canonical = masterCharacter(key);
      const candidate = output.characters[key] || {};
      const merged = { ...clone(canonical), ...candidate, anchors: { ...clone(canonical.anchors), ...(candidate.anchors || {}) }, anatomy: { ...clone(canonical.anatomy), ...(candidate.anatomy || {}) }, posteriorRule: { ...clone(canonical.posteriorRule), ...(candidate.posteriorRule || {}) } };
      const floorPercent = Number(merged.posteriorRule.heightPercentFromFloor);
      if (!Number.isFinite(floorPercent) || Math.abs(floorPercent) <= 1e-12) merged.posteriorRule.heightPercentFromFloor = canonical.posteriorRule.heightPercentFromFloor;
      if (!(Number(merged.anatomy.portraitScale) > 0)) merged.anatomy.portraitScale = canonical.anatomy.portraitScale;
      const badV1 = badV1HandShoulders[key];
      merged.anchors.leftHandShoulder = reconcileAnchor(merged.anchors.leftHandShoulder, canonical.anchors.leftHandShoulder, badV1?.left);
      merged.anchors.rightHandShoulder = reconcileAnchor(merged.anchors.rightHandShoulder, canonical.anchors.rightHandShoulder, badV1?.right);
      merged.anchors.shoulderPerch = reconcileAnchor(merged.anchors.shoulderPerch, canonical.anchors.shoulderPerch, v9StaleShoulderPerches[key]);
      output.characters[key] = merged;
    }
    for (const [aliasSpecies, sourceSpecies] of Object.entries(characterTransformAliases)) {
      for (const gender of ['male','female']) {
        const sourceKey = `${sourceSpecies}::${gender}`;
        const aliasKey = `${aliasSpecies}::${gender}`;
        if (output.characters[sourceKey]) output.characters[aliasKey] = output.characters[sourceKey];
      }
    }
    for (const kind of Object.keys(masterCreatures)) {
      const canonical = masterCreature(kind);
      const candidate = output.creatures[kind] || {};
      const merged = { ...clone(canonical), ...candidate, anchors: { ...clone(canonical.anchors), ...(candidate.anchors || {}) } };
      const oldGrip = merged.anchors.shoulderGrip;
      merged.anchors.shoulderGrip = reconcileAnchor(oldGrip, canonical.anchors.shoulderGrip, staleCreatureShoulderGrips[kind]);
      if (oldGrip && !samePosition(oldGrip.position, merged.anchors.shoulderGrip.position)) merged.shoulderGripRule = clone(canonical.shoulderGripRule);
      merged.anchors.saddle = reconcileAnchor(merged.anchors.saddle, canonical.anchors.saddle);
      if (repairKnownCreatureSizeScale(kind, merged, canonical)) merged.sizeScaleRule = clone(canonical.sizeScaleRule);
      output.creatures[kind] = merged;
    }
    output.characterTransformAliases = characterTransformAliases;
    output.masterConfigVersion = MASTER_VERSION;
    output.creatureShoulderGripDefaults = Object.fromEntries(Object.entries(output.creatures).filter(([kind]) => masterCreatures[kind]).map(([kind, profile]) => [kind, { ...profile.anchors.shoulderGrip.position }]));
    return output;
  }

  function reconcileRigExport(data) {
    const output = clone(data || {});
    output.schema = MASTER_SCHEMA;
    output.masterConfigVersion = MASTER_VERSION;
    output.masterAssembledAt = master.assembledAt;
    output.masterFieldProvenance = clone(MASTER_PROVENANCE);
    output.profiles = reconcileProfiles(output.profiles || output.attachmentRigProfiles || {});
    delete output.attachmentRigProfiles;
    output.exportGuard = {
      version: 2,
      behavior: 'canonical master baseline + current intentional edits; known v1/v9/default corruption fingerprints are repaired before persistence/export',
    };
    return output;
  }

  const masterGuard = {
    version: 2,
    masterConfigVersion: MASTER_VERSION,
    legacyStorageKey: 'hobunjiAttachmentRigProfiles.v2',
    storageKey: `hobunjiAttachmentRigProfiles.master.${MASTER_VERSION}`,
    reconcileProfiles,
    reconcileRigExport,
    getMasterProfiles: () => clone(masterProfiles),
    provenance: MASTER_PROVENANCE,
  };
  window.HOBUNJI_ATTACHMENT_RIG_MASTER_GUARD = Object.freeze(masterGuard);

  // Migration sources are checked once before the redirect wrapper is installed.
  // This preserves a real draft without letting hidden origin-wide state mutate
  // the committed runtime library outside the editor's normal autosave path.
  const previousRigStorageKeys = Object.freeze([
    'hobunjiAttachmentRigProfiles.master.hobunji-attachment-rig-master-2026-09-03-v1',
    masterGuard.legacyStorageKey,
  ]); // Used only by the one-time migration below.
  const normalizeRigAutosavePayload = value => {
    if (!value || typeof value !== 'object') return null;
    if (value.profiles || value.attachmentRigProfiles) return value;
    if (value.characters && value.creatures) return { schema: MASTER_SCHEMA, profiles: value };
    return null;
  };
  const isAnimationAuthor = typeof location !== 'undefined' && /\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname || '');
  if (isAnimationAuthor && typeof localStorage !== 'undefined' && typeof Storage !== 'undefined') {
    const proto = Storage.prototype;
    const marker = '__hobunjiAttachmentRigMasterStorageGuardV2';
    if (!proto[marker]) {
      const originalGetItem = proto.getItem;
      const originalSetItem = proto.setItem;
      const originalRemoveItem = proto.removeItem;
      let migrationStatus = { migrated: false, sourceKey: null, reason: 'current-v2-autosave-missing' };
      try {
        if (originalGetItem.call(localStorage, masterGuard.storageKey)) {
          migrationStatus = { migrated: false, sourceKey: masterGuard.storageKey, reason: 'current-v2-autosave-present' };
        } else {
          for (const sourceKey of previousRigStorageKeys) {
            const raw = originalGetItem.call(localStorage, sourceKey);
            if (!raw) continue;
            const normalized = normalizeRigAutosavePayload(JSON.parse(raw));
            if (!normalized) continue;
            originalSetItem.call(localStorage, masterGuard.storageKey, JSON.stringify(reconcileRigExport(normalized)));
            migrationStatus = { migrated: true, sourceKey, reason: 'reconciled-into-v2-versioned-autosave' };
            break;
          }
        }
      } catch (error) {
        migrationStatus = { migrated: false, sourceKey: null, reason: `migration-error:${error?.message || error}` };
      }
      window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.autosaveMigration = migrationStatus;
      Object.defineProperty(proto, marker, { value: true, configurable: false });
      proto.getItem = function(key) {
        if (this === localStorage && key === masterGuard.legacyStorageKey) return originalGetItem.call(this, masterGuard.storageKey);
        return originalGetItem.call(this, key);
      };
      proto.setItem = function(key, value) {
        if (this === localStorage && key === masterGuard.legacyStorageKey) {
          let nextValue = String(value);
          try {
            const normalized = normalizeRigAutosavePayload(JSON.parse(nextValue));
            if (normalized) nextValue = JSON.stringify(reconcileRigExport(normalized));
          } catch (_) {}
          return originalSetItem.call(this, masterGuard.storageKey, nextValue);
        }
        return originalSetItem.call(this, key, value);
      };
      proto.removeItem = function(key) {
        if (this === localStorage && key === masterGuard.legacyStorageKey) return originalRemoveItem.call(this, masterGuard.storageKey);
        return originalRemoveItem.call(this, key);
      };
    }
  }

  // Patch the public API and the visible Export JSON button without modifying
  // the giant inline editor. The editor's normal serializer still supplies all
  // non-rig metadata; this guard only reconciles the rig profile payload.
  if (isAnimationAuthor && typeof document !== 'undefined') {
    const installExporterGuard = () => {
      const api = window.MultiAvatarAnimationAuthor;
      if (!api?.exportProject || !api?.getAttachmentRigProfiles || api.__hobunjiMasterExporterGuard) return false;
      const baseExportProject = api.exportProject.bind(api);
      api.exportProject = () => {
        const data = baseExportProject();
        return document.body?.dataset?.animationAuthorMode === 'rig' ? reconcileRigExport(data) : data;
      };
      Object.defineProperty(api, '__hobunjiMasterExporterGuard', { value: true });
      document.addEventListener('click', event => {
        const button = event.target?.closest?.('#maaExportBtn');
        if (!button || document.body?.dataset?.animationAuthorMode !== 'rig') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const data = api.exportProject();
        const text = JSON.stringify(data);
        const blob = new Blob([text], { type: 'application/json' });
        const anchor = document.createElement('a');
        anchor.href = URL.createObjectURL(blob);
        anchor.download = 'hobunji_attachment_rig_profiles.json';
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
        window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.lastMasterSafeExportAt = new Date().toISOString();
      }, true);
      window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.exporterGuard = 'installed-v2';
      return true;
    };
    if (!installExporterGuard()) {
      let attempts = 0;
      const timer = setInterval(() => {
        if (installExporterGuard() || ++attempts >= 200) clearInterval(timer);
      }, 50);
    }

    // V15.24 still replaces the live creature library with an embedded snapshot,
    // while V15.37 restores only characters from this shared master. Reuse the
    // editor's own Import control to migrate only exact stale creature fingerprints
    // after the user opens/resets/imports Rig Coordinates. This preserves custom
    // authoring and runs every existing import wrapper/preview refresh path.
    let creatureSyncQueued = false;
    const animationAuthorCreatureSyncStatus = window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.animationAuthorCreatureSync;
    const staleCreatureFields = live => {
      const stale = [];
      for (const [kind, positions] of Object.entries(staleCreatureShoulderGrips)) {
        const position = live?.creatures?.[kind]?.anchors?.shoulderGrip?.position;
        if (normalizeStalePositions(positions).some(candidate => samePosition(position, candidate))) stale.push(`${kind}.shoulderGrip`);
      }
      const drenkirraSmall = live?.creatures?.drenkirra?.sizeScales?.small;
      const staleSmall = staleCreatureSizeScales.drenkirra.small;
      if (sameNumber(drenkirraSmall?.x, staleSmall.x) && sameNumber(drenkirraSmall?.y, staleSmall.y)) stale.push('drenkirra.sizeScales.small');
      return stale;
    };
    const attachSyntheticImportFile = (input, file) => {
      try {
        if (typeof DataTransfer === 'function') {
          const transfer = new DataTransfer();
          transfer.items.add(file);
          input.files = transfer.files;
          return true;
        }
      } catch (_) {}
      try {
        Object.defineProperty(input, 'files', { configurable: true, value: [file] });
        return true;
      } catch (_) { return false; }
    };
    const repairAnimationAuthorCreatureDefaults = reason => {
      creatureSyncQueued = false;
      const api = window.MultiAvatarAnimationAuthor;
      const input = document.getElementById('maaImportInput');
      if (!api?.getAttachmentRigProfiles || !input || typeof File !== 'function') return false;
      const live = api.getAttachmentRigProfiles();
      const stale = staleCreatureFields(live);
      if (!stale.length) {
        animationAuthorCreatureSyncStatus.state = 'clean';
        animationAuthorCreatureSyncStatus.lastReason = reason;
        return false;
      }
      const repaired = reconcileProfiles(live);
      const payload = reconcileRigExport({ schema: MASTER_SCHEMA, profiles: repaired });
      const file = new File([JSON.stringify(payload)], 'hobunji_attachment_rig_master_sync.json', { type: 'application/json' });
      if (!attachSyntheticImportFile(input, file)) {
        animationAuthorCreatureSyncStatus.state = 'file-bridge-unavailable';
        animationAuthorCreatureSyncStatus.lastReason = reason;
        return false;
      }
      animationAuthorCreatureSyncStatus.state = 'repair-dispatched';
      animationAuthorCreatureSyncStatus.repairs += 1;
      animationAuthorCreatureSyncStatus.lastReason = `${reason}: ${stale.join(', ')}`;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const queueAnimationAuthorCreatureRepair = reason => {
      if (creatureSyncQueued) return;
      creatureSyncQueued = true;
      setTimeout(() => repairAnimationAuthorCreatureDefaults(reason), 0);
    };
    document.addEventListener('click', event => {
      const target = event.target?.closest?.('#maaRigTab, #maaNewBtn');
      if (!target) return;
      if (target.id === 'maaRigTab' || (target.id === 'maaNewBtn' && document.body?.dataset?.animationAuthorMode === 'rig')) {
        queueAnimationAuthorCreatureRepair(target.id === 'maaRigTab' ? 'rig-tab-open' : 'rig-new-reset');
      }
    }, true);
    document.addEventListener('change', event => {
      if (event.target?.id === 'maaImportInput') queueAnimationAuthorCreatureRepair('rig-import');
    });
    window.HobunjiAnimationAuthorRigMasterSync = Object.freeze({
      repairNow: () => repairAnimationAuthorCreatureDefaults('manual-debug'),
      staleFields: () => staleCreatureFields(window.MultiAvatarAnimationAuthor?.getAttachmentRigProfiles?.() || {}),
      getStatus: () => ({ ...animationAuthorCreatureSyncStatus }),
    });
  }

  // Shoulder-pet observation behavior retained from the prior shared config.
  const shoulderPetObservationFlipRuntime = {
    instrumentedStates: new WeakSet(), instrumentedCount: 0,
    activePetCount: 0, flipCount: 0, lastFlip: null,
  };
  const applyShoulderPetObservationMirror = (pet, flipped) => {
    if (!pet) return false;
    pet.__hobunjiShoulderObservationFlipped = !!flipped;
    const avatar = pet.avatarRef;
    if (!avatar?.frontPlane?.scale || !avatar?.backPlane?.scale) return false;
    avatar.__hobunjiShoulderObservationFlipped = !!flipped;
    if (!avatar.__hobunjiShoulderObservationScaleSyncWrapped && typeof avatar.syncMirroredPlaneScale === 'function') {
      const originalSync = avatar.syncMirroredPlaneScale;
      avatar.syncMirroredPlaneScale = function(...args) {
        const result = originalSync.apply(this, args);
        const sign = this.__hobunjiShoulderObservationFlipped ? -1 : 1;
        for (const plane of [this.frontPlane, this.backPlane]) {
          if (!plane?.scale) continue;
          const magnitude = Math.abs(Number(plane.scale.x));
          plane.scale.x = (Number.isFinite(magnitude) && magnitude > 0 ? magnitude : 1) * sign;
        }
        return result;
      };
      avatar.__hobunjiShoulderObservationScaleSyncWrapped = true;
    }
    const sign = flipped ? -1 : 1;
    for (const plane of [avatar.frontPlane, avatar.backPlane]) {
      const magnitude = Math.abs(Number(plane.scale.x));
      plane.scale.x = (Number.isFinite(magnitude) && magnitude > 0 ? magnitude : 1) * sign;
    }
    return true;
  };
  const instrumentShoulderPetObservationState = pet => {
    const state = pet?.shoulderCuriosity;
    if (!state || shoulderPetObservationFlipRuntime.instrumentedStates.has(state)) return false;
    let phase = state.phase;
    Object.defineProperty(state, 'phase', {
      configurable: true, enumerable: true, get: () => phase,
      set: nextPhase => {
        if (phase === 'wait' && nextPhase === 'look') {
          const flipped = !pet.__hobunjiShoulderObservationFlipped;
          applyShoulderPetObservationMirror(pet, flipped);
          shoulderPetObservationFlipRuntime.flipCount += 1;
          shoulderPetObservationFlipRuntime.lastFlip = {
            creatureKey: pet.creatureKey || pet.kind || 'unknown', flipped,
            atMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
          };
        }
        phase = nextPhase;
      },
    });
    shoulderPetObservationFlipRuntime.instrumentedStates.add(state);
    shoulderPetObservationFlipRuntime.instrumentedCount += 1;
    return true;
  };
  const scanShoulderPetsForObservationFlip = () => {
    const companions = window.__climbDebug?.companionObjects;
    if (!companions || typeof companions[Symbol.iterator] !== 'function') return;
    let activePetCount = 0;
    for (const pet of companions) {
      if (!pet) continue;
      if (pet.stableRole !== 'shoulderPet') {
        if (pet.__hobunjiShoulderObservationTrackingActive) {
          applyShoulderPetObservationMirror(pet, false);
          pet.__hobunjiShoulderObservationTrackingActive = false;
        }
        continue;
      }
      activePetCount += 1;
      pet.__hobunjiShoulderObservationTrackingActive = true;
      applyShoulderPetObservationMirror(pet, !!pet.__hobunjiShoulderObservationFlipped);
      instrumentShoulderPetObservationState(pet);
    }
    shoulderPetObservationFlipRuntime.activePetCount = activePetCount;
  };
  window.ShoulderPetObservationFlip = Object.freeze({
    getDebug: () => ({
      activePetCount: shoulderPetObservationFlipRuntime.activePetCount,
      instrumentedCount: shoulderPetObservationFlipRuntime.instrumentedCount,
      flipCount: shoulderPetObservationFlipRuntime.flipCount,
      lastFlip: shoulderPetObservationFlipRuntime.lastFlip ? { ...shoulderPetObservationFlipRuntime.lastFlip } : null,
    }),
    formatDebug: () => {
      const d = window.ShoulderPetObservationFlip.getDebug();
      const last = d.lastFlip ? `${d.lastFlip.creatureKey}:${d.lastFlip.flipped ? 'mirrored' : 'normal'}` : 'none';
      return `Shoulder pet observation flip: active=${d.activePetCount} instrumented=${d.instrumentedCount} flips=${d.flipCount} last=${last}`;
    },
    scanNow: scanShoulderPetsForObservationFlip,
  });
  scanShoulderPetsForObservationFlip();
  if (typeof window.setInterval === 'function') window.setInterval(scanShoulderPetsForObservationFlip, 250);
})();