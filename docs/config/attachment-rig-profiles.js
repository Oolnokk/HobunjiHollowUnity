// Shared attachment-rig anchor data — the SINGLE canonical source for mounts,
// shoulder pets, character seat/perch anchors, and procedural hand shoulders.
//
// Source: Animation Author Rig Coordinates export schema v9. Character anchors
// are already floor-relative/runtime-compatible, so do not apply the retired
// V15.28 1.0 -> 0.9 width calibration a second time.
(() => {
  const identityAnchor = ([x, y, z], yaw = 0) => ({ position: { x, y, z }, rotationDeg: { x: 0, y: yaw, z: 0 }, scale: { x: 1, y: 1, z: 1 } }); // Expands compact authored tuples into the anchor shape used by runtime systems.
  const characterTransformAliases = Object.freeze({ rakakoan: 'kenkari' }); // Rakakoans are appearance/content variants of Kenkari and never own independent transform data.
  const transformSpeciesId = value => {
    const species = String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-');
    return characterTransformAliases[species] || species;
  }; // Used by authoring/runtime systems that need the canonical species whose transforms should be read or edited.
  window.HOBUNJI_TRANSFORM_SPECIES_ALIASES = Object.freeze({ ...(window.HOBUNJI_TRANSFORM_SPECIES_ALIASES || {}), ...characterTransformAliases });
  window.hobunjiTransformSpeciesId = transformSpeciesId;

  // Rakakoan rows from the supplied export are deliberately omitted here. Both
  // Rakakoan gender keys are installed below as live aliases of their Kenkari
  // counterparts, so a later export can never accidentally fork their transforms.
  const characterRecords = [["tletingan::male",-17.000000000000004,0,[-0.1843306031478747,0.40261734325974574,0],[0.22770354382724423,0.42663710735156957,0],[-0.2448354156580218,0.4465232083661127,0],[59.09264957264957,108.5],0.85,0.645,0.85,0.9,1,6,false],["engh-sho::male",-52.49999999999999,0,[-0.2312125102618596,0.7572702600778939,0],[0.2721813782445264,0.6838406837818225,0],[-0.28930388062923146,0.7000103424366998,0],[53.60656565656566,128.5],0.95,1.005,0.95,1.15,1.275,0,false],["mao-ao::male",-47,0,[-0.29650716367602115,0.6473130571424927,0],[0.19067248465844266,0.6947557240731601,0],[-0.28087406205430004,0.6455541403639915,0],[62.551070840197696,125.5],null,0.95,1,1.1,1.05,0,false],["mao-ao::female",-44.50000000000001,0,[-0.15362033651500306,0.5560865301833835,0],[0.1771042396564939,0.6511546407522855,0],[-0.23898599170593354,0.646996571654354,0],[76.5545073375262,114.5],1,0.925,0.8,1,1.025,0,false],["kenkari::male",-5.500000000000004,0,[-0.18055321970300925,0.27150559815116515,0],[0.17819817802695415,0.27810760526210354,0],[-0.18055321970300925,0.37969897363327487,0],[79.65683229813665,77.5],0.75,0.51,0.75,1,1,0,false],["kenkari::female",-4.0000000000000036,0,[-0.13819980616286182,0.2567143592120438,0],[0.1629792650553279,0.29929878500014695,0],[-0.16564616738866406,0.25011972083640993,0],[87.90841750841751,82.5],0.75,0.51,0.75,0.925,1,0,false],["tletingan::female",-23.00000000000001,0,[-0.18362271672504038,0.40412748358854156,0],[0.19339659287777322,0.38426858848533485,0],[-0.19326419458235525,0.38220450093854685,0],[67.36241610738254,99.5],0.85,0.62,0.85,0.925,1.025,5,false],["mashtzarr::male",-27.499999999999993,0,[-0.3080816783597182,0.6479187307531316,0],[0.2938287377558306,0.471474644548211,0],[-0.3481292844745114,0.5072329547240978,0],[63.960809102402024,87.5],1,0.755,1.18,0.925,1.175,0,false],["mashtzarr::female",-31.000000000000007,0,[-0.21765356423931137,0.603016367899253,0],[0.30553153725919435,0.39823082948935073,0],[-0.2938000697183753,0.37168801102709437,0],[72.13592233009709,97.5],1,0.79,1.18,0.9,1.125,0,false],["engh-sho::female",-49.500000000000014,0,[-0.18678622648700421,0.69825,0],[0.20505349784094706,0.4967497459859368,0],[-0.24815066240089945,0.46042886220274515,0],[71.9398595258999,112.5],0.95,0.975,0.95,1.225,1.325,0,false]]; // Exact non-Rakakoan character values from the supplied v9 Rig Coordinates export.
  const creatureRecords = [["drenkirra",[0,0.09289353489875796,0.02],"built-in-approved-rig-json-v1524",null,null,null,[0.01,-0.1636307385658067,0.003984738737597559],[[4,4],[2,2],[0.9,0.9]],null],["grehlr",[0,0.12393333333333335,0],"highest-opaque-pixel-along-idle-sprite-midline",-5,[1499.5,843.5],0,[0.01,-0.3719770036140037,0],[[1,1],[0.5,0.5],[0.2,0.2]],2],["gar-wolf",[0,0.14184834174882754,0.2761841625577698],"built-in-approved-rig-json-v1524",null,null,null,[0.01,-0.26545210788556156,0.07486897921502367],[[1.5,1.5],[1,1],[0.35,0.35]],null],["dabinggi-hound",[0,0.12212625800404886,0.6091387381509006],"highest-opaque-pixel-along-idle-sprite-midline",-5,[687.5,210.5],0,[0.01,-0.20203700498816118,0.09104867302389968],[[2,2],[1,1],[0.35,0.35]],null],["uumkaoii",[0,0.26595632314682005,0.02],"built-in-approved-rig-json-v1524",null,null,null,[0.01,-0.5363283597840667,-0.012886930890300352],[[1.5,1.5],[1,1],[0.2,0.2]],null]]; // Exact creature values from the supplied v9 Rig Coordinates export.

  const characters = {}; // Runtime character profile map keyed "<species>::<gender>".
  for (const [key, heightPercentOffset, heightPercentFromFloor, perch, left, right, pixel, portraitModelHeight, placement, portraitScale, handScale, footScale, armLength, derivedHandDefault] of characterRecords) {
    const [species, gender] = key.split('::');
    const legacyPosterior = heightPercentFromFloor == null;
    const posteriorRule = legacyPosterior
      ? { xMode: 'center', ySource: 'png-plane-avatar.handAttachY', offsetBasis: 'portraitModelHeight', heightPercentOffset, defaultRuleVersion: 3 }
      : { xMode: 'center', ySource: 'portraitModelHeight-from-floor', offsetBasis: 'portraitModelHeight', heightPercentOffset, defaultRuleVersion: 4, heightPercentFromFloor };
    const shoulderPerchRule = {
      source: 'imported-authored-rig-json',
      heightPercentOffset: 0,
      defaultRuleVersion: 4,
      sourcePixel: { x: pixel[0], y: pixel[1] },
      ...(portraitModelHeight == null ? {} : { portraitModelHeight }),
      portraitVerticalPlacementRatio: placement,
      recalculateOnPreview: false,
      authoredDefaultVersion: 5,
      authoredFixed: true,
      ...(legacyPosterior ? {} : { appearanceSpeciesId: species, appearanceGender: gender, coordinateSpace: 'appearance-species-floor-relative' }),
    };
    characters[key] = {
      species,
      gender,
      posteriorRule,
      anchors: {
        posterior: identityAnchor([0, 0, 0]),
        shoulderPerch: identityAnchor(perch),
        leftHandShoulder: identityAnchor(left),
        rightHandShoulder: identityAnchor(right),
      },
      shoulderPerchRule,
      handShoulderRule: {
        source: derivedHandDefault ? 'shoulder-perch-derived-default' : 'rig-anchor-gizmo',
        coordinateSpace: 'character-visual-local',
        version: 1,
      },
      anatomy: {
        portraitVerticalPlacementRatio: placement,
        portraitScale,
        handScale,
        footScale,
        armLengthHeightPercentOffset: armLength,
        version: 1,
      },
      ...(legacyPosterior ? {} : { characterAttachZDefaultVersion: 1 }),
    };
  }

  for (const [aliasSpecies, sourceSpecies] of Object.entries(characterTransformAliases)) {
    for (const gender of ['male', 'female']) {
      const sourceKey = `${sourceSpecies}::${gender}`;
      const aliasKey = `${aliasSpecies}::${gender}`;
      if (characters[sourceKey]) characters[aliasKey] = characters[sourceKey];
    }
  } // Shared object identity makes Rakakoan transforms track Kenkari even when authoring tools mutate a profile live.

  const creatures = {}; // Runtime creature profile map keyed by CREATURE_DB kind.
  for (const [kind, saddle, saddleSource, saddleOffset, saddlePixel, midlineSearchRadiusPx, shoulderGrip, scales, grehlrSizeScaleDefaultVersion] of creatureRecords) {
    const saddleRule = saddleSource === 'highest-opaque-pixel-along-idle-sprite-midline'
      ? { source: saddleSource, heightPercentOffset: saddleOffset, defaultRuleVersion: 3, sourcePixel: { x: saddlePixel[0], y: saddlePixel[1] }, midlineSearchRadiusPx, authoredDefaultVersion: 6, authoredFixed: true, recalculateOnPreview: false }
      : { source: saddleSource, defaultRuleVersion: 3, authoredDefaultVersion: 6, authoredFixed: true, recalculateOnPreview: false };
    const sizeScales = {
      large: { x: scales[0][0], y: scales[0][1] },
      medium: { x: scales[1][0], y: scales[1][1] },
      small: { x: scales[2][0], y: scales[2][1] },
    }; // Direct PNG-plane X/Y multipliers consumed before world-bounds calculation.
    creatures[kind] = {
      kind,
      anchors: {
        saddle: identityAnchor(saddle),
        shoulderGrip: identityAnchor(shoulderGrip, -61),
      },
      saddleRule,
      shoulderGripRule: { source: 'authored-attachpointsv1', coordinateSpace: 'unscaled-idle-png-plane-local', defaultRuleVersion: 4, authoredDefaultVersion: 6, authoredFixed: true, recalculateOnPreview: false },
      sizeScales,
      sizeScaleRule: { version: 1, axes: 'png-plane-local-x-y', zScale: 1, applicationOrder: 'before-outer-prism-and-world-bounds', authoredDefaultVersion: 6, authoredFixed: true },
      shoulderGripRotationDefaultVersion: 2,
      creatureShoulderGripDefaultVersion: 4,
      sizeScalePercentages: {
        large: { x: sizeScales.large.x * 100, y: sizeScales.large.y * 100 },
        medium: { x: sizeScales.medium.x * 100, y: sizeScales.medium.y * 100 },
        small: { x: sizeScales.small.x * 100, y: sizeScales.small.y * 100 },
      },
      ...(grehlrSizeScaleDefaultVersion == null ? {} : { grehlrSizeScaleDefaultVersion }),
    };
  }

  window.HOBUNJI_ATTACHMENT_RIG_PROFILES = {
    characters,
    creatures,
    characterTransformAliases,
    defaultRuleVersion: 3,
    posteriorFloorRuleVersion: 4,
    shoulderPerchDefaultRuleVersion: 4,
    creatureShoulderGripDefaults: {
      grehlr: { x: 0, y: -0.3719770036140037, z: 0.1290707615155139 },
      'dabinggi-hound': { x: 0, y: -0.23155745202667363, z: 0.24804851348750512 },
      'gar-wolf': { x: 0, y: -0.2991290072947552, z: 0.21000394928464605 },
      drenkirra: { x: 0, y: -0.1636307385658067, z: 0.0009131708735385657 },
      uumkaoii: { x: 0, y: -0.5363283597840667, z: -0.012886930890300352 },
    },
    creatureShoulderGripDefaultRuleVersion: 4,
    creatureSizeScaleSemantics: {
      profileField: 'profiles.creatures.<kind>.sizeScales.<small|medium|large>.{x,y}',
      axes: 'png-plane-local-x-y',
      zScale: 1,
      applicationOrder: 'direct rendered animal mesh local X/Y; rig-anchor positions share an anchor-only scale root; before world bounds',
      runtimeUnit: 'multiplier',
      displayUnit: 'percent',
      conversion: 'multiplier = percent / 100',
    },
    characterAttachPointDefaultZ: 0,
    characterSpeciesSource: 'avatarEditor.rawExport/profile/npc appearance only; NPC info-form species excluded',
    characterShoulderPerchVerticalPlacement: 'PNGPlaneAvatar.avatarPlacementRatioFor(appearance)',
    anatomySemantics: {
      profileField: 'character.anatomy',
      portraitYOffsetFormula: '(portraitVerticalPlacementRatio - 0.5) * 100',
      portraitScale: 'portraitScale is an independent species/gender multiplier; legacy species-only numbers remain supported',
      scales: 'handScale and footScale are independent species/gender multipliers',
      armLength: 'positive armLengthHeightPercentOffset moves unowned fallback hands downward by portraitModelHeight * percent / 100',
      aliases: 'Rakakoan always resolves to the matching Kenkari transform profile; it owns no independent transform values.',
    },
  };

  window.HOBUNJI_ATTACHMENT_RIG_EXPORT_META = Object.freeze({
    schema: 'hobunji.attachment-rig-profiles.v9',
    exportedAt: '2026-08-26T03:30:34.506Z',
    coordinateSpace: 'Character rig anchors are floor-relative. The visible PNG-plane model receives the same portraitModelHeight/2 runtime lift as game.js, while portraitVerticalPlacementRatio remains inside the model assembly. Creature coordinates remain local to the unscaled idle-sprite plane. Creature sizeScales are local PNG-plane X/Y multipliers applied before outer-prism/world-bounds calculation; Z is always 1.',
    transformSpeciesAliases: characterTransformAliases,
    derivedCoordinates: {
      characterPosterior: { source: 'posteriorRule.heightPercentFromFloor', formula: 'portraitModelHeight * heightPercentFromFloor / 100', legacyFallback: 'handAttachY + portraitModelHeight * heightPercentOffset / 100' },
      characterShoulderPerch: { source: 'highest opaque pixel of species+gender arm-R portrait layer', formula: 'armRTopPixelFloorPoint on Y (no percentile offset)', offsetPercent: 0 },
      creatureSaddle: { source: 'highest opaque pixel along composed idle-sprite midline', formula: 'idleMidlineTopY + idleModelHeight * (-5 / 100)', offsetPercent: -5 },
      creatureShoulderGrip: { source: 'authored attachpointsv1 species coordinates', formula: 'exact local x/y/z coordinate per creature kind', defaultRuleVersion: 4 },
      idleHands: { x: 'matching leftHandShoulder/rightHandShoulder anchor X', y: 'derived character posterior Y plus procedural idle/walk Y offset', aimTarget: 'matching full hand-shoulder anchor transform' },
    },
    attachmentSemantics: {
      mount: { carrierAnchor: 'creature.saddle', riderAnchor: 'character.posterior', keyedObject: 'intermediateParent' },
      shoulderPet: { carrierAnchor: 'character.shoulderPerch', riderAnchor: 'creature.shoulderGrip', keyedObject: 'intermediateParent' },
    },
  }); // Source metadata is exposed for the existing in-page diagnostics.

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
  }); // One posterior formula is shared by gameplay, procedural limbs, and Animation Author; v3 pixel-relative profiles remain readable as a fallback.

  window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS = {
    schema: window.HOBUNJI_ATTACHMENT_RIG_EXPORT_META.schema,
    exportedAt: window.HOBUNJI_ATTACHMENT_RIG_EXPORT_META.exportedAt,
    mashtzarrPortraitCorrection: 'included-in-v9',