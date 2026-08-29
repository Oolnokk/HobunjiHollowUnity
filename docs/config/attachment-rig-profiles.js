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
  const characterRecords = [["tletingan::male",-17.000000000000004,0,[-0.1769199293575374,0.3839625600994886,0],[0.22770354382724423,0.42663710735156957,0],[-0.2448354156580218,0.4465232083661127,0],[59.09264957264957,108.5],0.85,0.645,0.85,0.9,1,6,false],["engh-sho::male",-52.49999999999999,0,[-0.2115295187159422,0.6813045758748404,0],[0.2721813782445264,0.6838406837818225,0],[-0.28930388062923146,0.7000103424366998,0],[53.60656565656566,128.5],0.95,1.005,0.95,1.15,1.275,0,false],["mao-ao::male",-47,0,[-0.2006533796199832,0.6234902368619534,0],[0.19067248465844266,0.6947557240731601,0],[-0.28087406205430004,0.6455541403639915,0],[62.551070840197696,125.5],null,0.95,1,1.1,1.05,0,false],["mao-ao::female",-44.50000000000001,0,[-0.14923510597360837,0.4721927183587378,0],[0.1771042396564939,0.6511546407522855,0],[-0.23898599170593354,0.646996571654354,0],[76.5545073375262,114.5],1,0.925,0.8,1,1.025,0,false],["kenkari::male",-5.500000000000004,0,[-0.18055321970300925,0.27150559815116515,0],[0.17819817802695415,0.27810760526210354,0],[-0.18055321970300925,0.37969897363327487,0],[79.65683229813665,77.5],0.75,0.51,0.75,1,1,0,false],["kenkari::female",-4.0000000000000036,0,[-0.12331214301269552,0.2212216457140902,0],[0.1629792650553279,0.29929878500014695,0],[-0.16564616738866406,0.25011972083640993,0],[87.90841750841751,82.5],0.75,0.51,0.75,0.925,1,0,false],["tletingan::female",-23.00000000000001,0,[-0.15767922666458786,0.36829341919016667,0],[0.19339659287777322,0.38426858848533485,0],[-0.19326419458235525,0.38220450093854685,0],[67.36241610738254,99.5],0.85,0.62,0.85,0.925,1.025,5,false],["mashtzarr::male",-27.499999999999993,0,[-0.3150161025604807,0.504441432761613,0],[0.2938287377558306,0.471474644548211,0],[-0.3481292844745114,0.5072329547240978,0],[63.960809102402024,87.5],1,0.755,1.18,0.925,1.175,0,false],["mashtzarr::female",-31.000000000000007,0,[-0.20671639379279255,0.5521654715130626,0],[0.30553153725919435,0.39823082948935073,0],[-0.2938000697183753,0.37168801102709437,0],[72.13592233009709,97.5],1,0.79,1.18,0.9,1.125,0,false],["engh-sho::female",-49.500000000000014,0,[-0.1857404318972175,0.5885050529830135,0],[0.20505349784094706,0.4967497459859368,0],[-0.24815066240089945,0.46042886220274515,0],[71.9398595258999,112.5],0.95,0.975,0.95,1.225,1.325,0,false]]; // Character transforms stay on the v9 baseline; shoulderPerch tuples are refreshed from the supplied 2026-08-28 export.
  const characterPosteriorFloorPercents = Object.freeze({
    'tletingan::male': 24.829594593937666,
    'engh-sho::male': 40.46344209891254,
    'mao-ao::male': 37.31351872723915,
    'mao-ao::female': 40.198007305794635,
    'kenkari::male': 13.133738099540614,
    'kenkari::female': 18.49675435046502,
    'tletingan::female': 21.62644067848934,
    'mashtzarr::male': 28.18802021075617,
    'mashtzarr::female': 29.459673223780613,
    'engh-sho::female': 41.16182006615896,
  }); // Restores the calibrated floor-relative posterior heights that the compact v9 export accidentally serialized as zero; used while constructing every character profile below.
  const creatureRecords = [["drenkirra",[0,0.09289353489875796,0.02],"built-in-approved-rig-json-v1524",null,null,null,[0.01,-0.11914729549653388,-0.001096892109713506],[[4,4],[2,2],[0.9,0.9]],null],["grehlr",[0,0.12393333333333335,0],"highest-opaque-pixel-along-idle-sprite-midline",-5,[1499.5,843.5],0,[0.01,-0.3719770036140037,0],[[1,1],[0.5,0.5],[0.2,0.2]],2],["gar-wolf",[0,0.14184834174882754,0.2761841625577698],"built-in-approved-rig-json-v1524",null,null,null,[0.01,-0.26545210788556156,0.07486897921502367],[[1.5,1.5],[1,1],[0.35,0.35]],null],["dabinggi-hound",[0,0.12212625800404886,0.6091387381509006],"highest-opaque-pixel-along-idle-sprite-midline",-5,[687.5,210.5],0,[0.01,-0.20203700498816118,0.09104867302389968],[[2,2],[1,1],[0.35,0.35]],null],["uumkaoii",[0,0.26595632314682005,0.02],"built-in-approved-rig-json-v1524",null,null,null,[0.01,-0.3636087789187775,-0.18395679109723],[[1.5,1.5],[1,1],[0.2,0.2]],null]]; // Creature transforms stay on the v9 baseline; shoulderGrip tuples are refreshed from the supplied 2026-08-28 export.

  const characters = {}; // Runtime character profile map keyed "<species>::<gender>".
  for (const [key, heightPercentOffset, exportedHeightPercentFromFloor, perch, left, right, pixel, portraitModelHeight, placement, portraitScale, handScale, footScale, armLength, derivedHandDefault] of characterRecords) {
    const [species, gender] = key.split('::');
    const recoveredHeightPercentFromFloor = Number(characterPosteriorFloorPercents[key]); // Used here to replace the corrupted all-zero v9 field with its last known calibrated floor height.
    const heightPercentFromFloor = Number.isFinite(recoveredHeightPercentFromFloor)
      ? recoveredHeightPercentFromFloor
      : exportedHeightPercentFromFloor;
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
    shoulderAnchorsExportedAt: '2026-08-28T03:24:15.652Z',
    mashtzarrPortraitCorrection: 'included-in-v9',
    anatomyProfiles: 'pending',
    authoredCharacterProfiles: 10,
    suppliedCharacterProfiles: 12,
    sharedCharacterProfiles: 2,
    exactSuppliedProfiles: 10,
    authoredCreatureProfiles: 5,
    parrotSharedProfiles: 2,
    rakakoanTransforms: 'always-aliased-to-kenkari',
    anchorPositionCalibration: 'not-needed:v9-runtime-space',
    anchorPositionScale: 1,
    posteriorCoordinateSpace: 'floor-relative',
    posteriorPixelDependency: 'removed',
    posteriorFloorValues: 'recovered-from-pre-v9-floor-calibration',
  }; // Mobile-readable import status so this source can be verified without DevTools.

  const applyAttachmentRigProfileCorrections = () => {
    const pngAvatarConfig = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar; // Receives authored anatomy values once shared config exists.
    if (!pngAvatarConfig?.portraitScaleBySpecies || !pngAvatarConfig?.portraitVerticalPlacement) return false;
    pngAvatarConfig.proceduralFeet ||= {};
    pngAvatarConfig.proceduralFeet.footScale ||= { default: 1 };

    // Remove every transform override owned by an alias species before applying
    // canonical data. The existing parentSpecies chain then resolves Rakakoan to
    // Kenkari for body scale/placement, feet, leg bends, and future reads of the
    // same transform tables instead of allowing copied values to drift apart.
    for (const aliasSpecies of Object.keys(characterTransformAliases)) {
      delete pngAvatarConfig.portraitVerticalPlacement[aliasSpecies];
      delete pngAvatarConfig.portraitScaleBySpecies[aliasSpecies];
      delete pngAvatarConfig.proceduralFeet.footScale?.[aliasSpecies];
      delete pngAvatarConfig.proceduralFeet.legBend?.[aliasSpecies];
    }

    const handScaleUpdates = []; // Defers hand-profile mutation until that later-loaded runtime exists.
    const appliedProfiles = new Set(); // Alias keys can reference the same canonical profile; only apply each transform record once.
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
  window.applyHobunjiAttachmentRigProfileCorrections = applyAttachmentRigProfileCorrections; // Called again after deferred config/hand-profile loads.
  applyAttachmentRigProfileCorrections();

  // Shoulder-pet observation sequences are owned by game.js's private curiosity
  // state machine. Instrumenting only its public state object keeps the behavior
  // independent of the rejected experimental yaw/perch stack: wait -> look
  // toggles a literal X mirror before the new phase becomes visible, with no
  // turn phase, no angle interpolation, and no world-space rotation.
  const shoulderPetObservationFlipRuntime = {
    instrumentedStates: new WeakSet(), // Prevents installing a second phase accessor on the same live curiosity state.
    instrumentedCount: 0,
    activePetCount: 0,
    flipCount: 0,
    lastFlip: null,
  };

  const applyShoulderPetObservationMirror = (pet, flipped) => {
    if (!pet) return false;
    pet.__hobunjiShoulderObservationFlipped = !!flipped; // Persists mirror parity if the rendered animal avatar is rebuilt while it remains a shoulder pet.
    const avatar = pet.avatarRef;
    if (!avatar?.frontPlane?.scale || !avatar?.backPlane?.scale) return false;
    avatar.__hobunjiShoulderObservationFlipped = !!flipped; // Used by the wrapped scale sync below after combat/size code restores canonical plane scale.

    if (!avatar.__hobunjiShoulderObservationScaleSyncWrapped && typeof avatar.syncMirroredPlaneScale === 'function') {
      const originalSync = avatar.syncMirroredPlaneScale; // Reused by the wrapper so existing plane-scale ownership remains authoritative.
      avatar.syncMirroredPlaneScale = function (...args) {
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
      configurable: true,
      enumerable: true,
      get: () => phase,
      set: nextPhase => {
        if (phase === 'wait' && nextPhase === 'look') {
          const flipped = !pet.__hobunjiShoulderObservationFlipped;
          applyShoulderPetObservationMirror(pet, flipped); // Runs synchronously before the look phase begins; there is intentionally no lerp.
          shoulderPetObservationFlipRuntime.flipCount += 1;
          shoulderPetObservationFlipRuntime.lastFlip = {
            creatureKey: pet.creatureKey || pet.kind || 'unknown',
            flipped,
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
  }); // Mobile/debug-menu callers can verify the instantaneous mirror without opening DevTools.

  scanShoulderPetsForObservationFlip();
  if (typeof window.setInterval === 'function') window.setInterval(scanShoulderPetsForObservationFlip, 250);
})();
