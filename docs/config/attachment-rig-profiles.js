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

  const characterTransformAliases = Object.freeze({ rakakoan: 'kenkari', ghoul: 'mao-ao', mammakhbuur: 'mashtzarr' });
  const creatureTransformAliases = Object.freeze({
    'gar-wolf-alpha': 'gar-wolf', 'gar-wolf-den-mother': 'gar-wolf',
    'dabinggi-hound-den-mother': 'dabinggi-hound',
    'uumkaoii-wild': 'uumkaoii', 'uumkaoii-wild-den-mother': 'uumkaoii',
    'grehlr-den-mother': 'grehlr', 'drenkirra-den-mother': 'drenkirra',
    'voorg-ass-herd-mother': 'voorg-ass', 'moot-herd-mother': 'moot',
  }); // Only fallbacks: a variant with its own authored profile remains independent.
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

  // Each character perch stores x, y, z and a uniform shoulder-pet multiplier.
  // Authored only from adult world-space portrait plane width and height:
  // 1 × sqrt((portraitWidth × portraitHeight) / (Mao-ao male width × height)).
  // Plane width/height = 0.9 × anatomy.portraitScale × whole-rig X/Y.
  // Head, feet, hands, pose orbit, vertical placement and opaque bounds excluded.
  // Mao-ao male retains his originally authored 1x perch; no runtime derivation.
  const characterRecords = [
    ['tletingan::male', -17.000000000000004, -5.5, [-0.2448354156580218,0.4465232083661127,0,0.957582], [0.22770354382724423,0.42663710735156957,0], [-0.2448354156580218,0.4465232083661127,0], [59.09264957264957,108.5], 0.85,0.645,0.85,0.9,1,6],
    ['engh-sho::male', -52.49999999999999, 30.5, [-0.28930388062923146,0.7000103424366998,0,0.896974], [0.2721813782445264,0.6838406837818225,0], [-0.28930388062923146,0.7000103424366998,0], [53.60656565656566,128.5], 0.95,1.005,0.95,1.15,1.275,0],
    ['mao-ao::male', -47, 25, [-0.28087406205430004,0.6455541403639915,0,1], [0.19067248465844266,0.6947557240731601,0], [-0.28087406205430004,0.6455541403639915,0], [62.551070840197696,125.5], null,0.95,1,1.1,1.05,0],
    ['mao-ao::female', -44.50000000000001, 22.5, [-0.23898599170593354,0.646996571654354,0,0.972531], [0.1771042396564939,0.6511546407522855,0], [-0.23898599170593354,0.646996571654354,0], [76.5545073375262,114.5], 1,0.925,0.8,1,1.025,0],
    ['kenkari::male', -5.500000000000004, -19, [-0.18055321970300925,0.37969897363327487,0,1.217687], [0.17819817802695415,0.27810760526210354,0], [-0.18055321970300925,0.37969897363327487,0], [79.65683229813665,77.5], 0.75,0.51,0.75,1,1,0],
    ['kenkari::female', -4.0000000000000036, -19, [-0.16564616738866406,0.25011972083640993,0,1.093433], [0.1629792650553279,0.29929878500014695,0], [-0.16564616738866406,0.25011972083640993,0], [87.90841750841751,82.5], 0.75,0.51,0.75,0.925,1,0],
    ['tletingan::female', -23.00000000000001, -8, [-0.19326419458235525,0.38220450093854685,0,1.016629], [0.19339659287777322,0.38426858848533485,0], [-0.19326419458235525,0.38220450093854685,0], [67.36241610738254,99.5], 0.85,0.62,0.85,0.925,1.025,5],
    ['mashtzarr::male', -27.499999999999993, 5.5, [-0.3481292844745114,0.5072329547240978,0,1.712158], [0.2938287377558306,0.471474644548211,0], [-0.3481292844745114,0.5072329547240978,0], [63.960809102402024,87.5], 1,0.755,1.18,0.925,1.175,0],
    ['mashtzarr::female', -31.000000000000007, 9, [-0.2938000697183753,0.37168801102709437,0,1.563862], [0.30553153725919435,0.39823082948935073,0], [-0.2938000697183753,0.37168801102709437,0], [72.13592233009709,97.5], 1,0.79,1.18,0.9,1.125,0],
    ['engh-sho::female', -49.500000000000014, 27.5, [-0.24815066240089945,0.46042886220274515,0,0.950541], [0.20505349784094706,0.4967497459859368,0], [-0.24815066240089945,0.46042886220274515,0], [71.9398595258999,112.5], 0.95,0.975,0.95,1.225,1.325,0],
  ];

  const staleCharacterPosteriorFloors = Object.freeze({ // Exact pre-preview posterior defaults; arbitrary later authoring remains untouched.
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
  });

  const badV1HandShoulders = Object.freeze(Object.fromEntries(characterRecords.map(record => {
    const key = record[0];
    const left = record[4].map(value => value * BAD_V1_SHOULDER_SCALE);
    const right = record[5].map(value => value * BAD_V1_SHOULDER_SCALE);
    return [key, { left, right }];
  })));
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

  const DRENKIRRA_SHOULDER_GRIP_YAW_DEG = 61; // The shoulder solver inverts grip yaw; Drenkirra needs the reverse signed full-plane offset.
  const creatureRecords = [
    ['drenkirra',[0,0.030605877381859603,0.02],'built-in-approved-rig-json-v1524',null,null,null,[-0.0036970156287619823,-0.11914729549653388,0.09707381568917758],[[2,2],[2,2],[0.9,0.9]],null],
    ['grehlr',[0,0.1224031140623686,0],'highest-opaque-pixel-along-idle-sprite-midline',-5,[511.5,287.9],0,[0.01,-0.25802842155776196,0.09111564500894845],[[1,1],[0.5,0.5],[0.3,0.3]],2],
    ['gar-wolf',[0,0.15973815894365057,0.3293044388176616],'built-in-approved-rig-json-v1524',null,null,null,[0.01,-0.14097888312228624,0.07486897921502367],[[1.5,1.5],[1,1],[0.28,0.34]],null],
    ['dabinggi-hound',[0,0.17901245841201874,0.6091387381509006],'highest-opaque-pixel-along-idle-sprite-midline',-5,[687.5,210.5],0,[-0.16036566987282258,-0.12636677592420467,0.12410100452746164],[[2,2],[1,1],[0.35,0.35]],null],
    ['uumkaoii',[0,0.2575246358178592,0.005623701988496838],'animation-author-export-2026-10-22',null,null,null,[0,-0.2057328849409156,-0.004605298975405354],[[1.5,1.5],[1,1],[0.24,0.24]],null],
    ['puktuk',[0,0.1830394938019193,-0.012420318741466083],'animation-author-export-2026-09-15',null,null,null,[0,-0.257,0.034273761545456985],[[0.75,0.75],[0.45,0.45],[0.28,0.28]],null],
    ['voorg-ass',[-0.0016655977917167481,0.18328943170147868,0.043832914384796626],'animation-author-export-2026-09-15',null,null,null,[0,-0.29318061503235254,0.051543592657975104],[[1,1],[0.75,0.75],[0.34,0.34]],null], // Shoulder grip only from Rig Coordinates export (29); sizes and saddle unchanged.
    // Recovered saddle and shoulder-grip authoring from the October 22 exports (19), (20), and (21).
    ['nelk',[0,0.12365496943656872,0.09343178888117182],'animation-author-export-2026-10-22',null,null,null,[0.05838103969211583,-0.06616055534830413,0.05330590874914502],[[1.75,1.75],[1,1],[0.44,0.44]],null],
    ['nazgraku',[0,0.07886458733711826,-0.0022188537422596633],'animation-author-export-2026-10-22',null,null,null,[-0.010120303229480966,-0.112,0.04704726667943677],[[1.5,1.5],[1,1],[0.5,0.5]],null],
    // New November 16 authoring: independently maintained Moot creature shoulder and size profile.
    ['moot',[0,0.1892393302917481,0.02],'animation-author-export-2026-11-16',null,null,null,[0,-0.09985368986154525,0.1],[[1,1],[0.75,0.75],[0.35,0.35]],null],
  ];
  const staleCreatureSaddles = Object.freeze({ // Used by reconcileProfiles and the Animation Author repair bridge to migrate only exact superseded defaults.
    drenkirra: Object.freeze([Object.freeze([0,0.09289353489875796,0.02])]),
    grehlr: Object.freeze([Object.freeze([0,0.12393333333333335,0])]),
    'gar-wolf': Object.freeze([Object.freeze([0,0.14184834174882754,0.2761841625577698])]),
    'dabinggi-hound': Object.freeze([Object.freeze([0,0.12212625800404886,0.6091387381509006])]),
    uumkaoii: Object.freeze([Object.freeze([0,0.26595632314682005,0.02]), Object.freeze([0,0.6408071738820479,0.02])]),
    puktuk: Object.freeze([Object.freeze([0,0.16937859550590686,-0.012420318741466083])]),
    'voorg-ass': Object.freeze([Object.freeze([-0.0016655977917167481,0.12286908956931555,0.043832914384796626])]),
    nelk: Object.freeze([Object.freeze([0,0,0])]), // Pre-calibration saddle placeholders.
    nazgraku: Object.freeze([Object.freeze([0,0,0])]),
  });
  const staleCreatureShoulderGrips = Object.freeze({
    pingdort: Object.freeze([Object.freeze([0, -0.14842300556586271, 0])]), // Previous native-foot grip; replace this exact old default, not independently authored grip positions.
    'skeeri-medium': Object.freeze([Object.freeze([0, -0.16357451915740964, 0])]), // Retired Medium Skeeri stock grip; never replace a separately authored socket.
    'gar-wolf': Object.freeze([Object.freeze([0.01,-0.26545210788556156,0.07486897921502367])]), // Exact old master grip; user-authored positions remain untouched.
    'dabinggi-hound': Object.freeze([Object.freeze([0.01,-0.20203700498816118,0.09104867302389968])]), // Exact old master grip; user-authored positions remain untouched.
    'puktuk': Object.freeze([Object.freeze([0.01,-0.29715994741785007,-0.0010889163404909086])]), // Exact old master grip; user-authored positions remain untouched.
    'voorg-ass': Object.freeze([Object.freeze([0.01,-0.33453636625016553,0.0181046276028018]), Object.freeze([0,-0.11122461401165312,0.05961047587703741])]), // Exact old master grip; user-authored positions remain untouched.
    nelk: Object.freeze([Object.freeze([0.030176488041515424,-0.11264054358274966,0.028253979555520257]), Object.freeze([0,0,0]), Object.freeze([0.01,0,0])]), // November 16 plus earlier exact stale defaults.
    nazgraku: Object.freeze([Object.freeze([0.011498553593554665,-0.14241261412989242,0.000946211786312177]), Object.freeze([0,0,0]), Object.freeze([0.01,0,0])]), // November 16 plus earlier exact stale defaults.
    grehlr: Object.freeze([Object.freeze([0.01,-0.3719770036140037,0])]),
    drenkirra: Object.freeze([
      Object.freeze([0.01,-0.11914729549653388,-0.001096892109713506]), // November 16: former canonical grip; migrate only its exact old XYZ.
      Object.freeze([0.01,-0.1636307385658067,0.0009131708735385657]),
      Object.freeze([0.01,-0.1636307385658067,0.003984738737597559]),
    ]),
    uumkaoii: Object.freeze([Object.freeze([0.01,-0.5363283597840667,-0.012886930890300352]), Object.freeze([0.01,-0.3636087789187775,-0.18395679109723])]),
  });
  const staleCreatureSizeScales = Object.freeze({
    pingdort: Object.freeze({ large: Object.freeze({ x: 1, y: 1 }), medium: Object.freeze({ x: 1, y: 1 }) }), // November 16 Pingdort export replaces only the two older 1x size rows.
    'gar-wolf': Object.freeze({ small: Object.freeze({ x: 0.35, y: 0.35 }) }), // Migrate only the previous default Small-scale tuple.
    'uumkaoii': Object.freeze({ small: Object.freeze({ x: 0.2, y: 0.2 }) }), // Migrate only the previous default Small-scale tuple.
    'puktuk': Object.freeze({ small: Object.freeze({ x: 0.3, y: 0.3 }) }), // Migrate only the previous default Small-scale tuple.
    'voorg-ass': Object.freeze({ small: Object.freeze({ x: 0.27, y: 0.27 }) }), // Migrate only the previous default Small-scale tuple.
    'nelk': Object.freeze({ small: Object.freeze({ x: 0.35, y: 0.35 }) }), // Migrate only the previous default Small-scale tuple.
    'nazgraku': Object.freeze({ small: Object.freeze({ x: 0.35, y: 0.35 }) }), // Migrate only the previous default Small-scale tuple.
    grehlr: Object.freeze({ small: Object.freeze({ x: 0.2, y: 0.2 }) }),
    drenkirra: Object.freeze({ small: Object.freeze({ x: 1, y: 1 }) }),
  });
  const staleCreatureGroundOffsets = Object.freeze({
    pingdort: Object.freeze({ large: 0.14842300556586271, medium: 0.14842300556586271, small: 0.14842300556586271 }), // Exact previous floor table; the newly authored Small offset is 0.07.
    skeeri: Object.freeze({ large: 0, medium: 0, small: 0 }), // Old automatic floor sentinel from uncalibrated domestic Skeeri editor data.
    'skeeri-small': Object.freeze({ large: 0, medium: 0, small: 0 }), // Old automatic floor sentinel from the Small variant.
    'skeeri-medium': Object.freeze({ large: 0, medium: 0, small: 0 }), // Exact previous Medium Skeeri export.
    'skeeri-large': Object.freeze({ large: 0, medium: 0, small: 0 }), // Old automatic floor sentinel from the Large variant.
    uumkaoii: Object.freeze({ large: 0.69, medium: 0.48, small: 0.09 }), // Old master defaults; used for narrowly scoped autosave migration.
    nelk: Object.freeze({ large: 0, medium: 0, small: 0 }),
    nazgraku: Object.freeze({ large: 0, medium: 0, small: 0 }),
  });
  const supersededCreatureSizeScales = Object.freeze({ "drenkirra": Object.freeze({ large: Object.freeze({"x":4,"y":4}) }), "puktuk": Object.freeze({ large: Object.freeze({"x":1,"y":1}), medium: Object.freeze({"x":0.6,"y":0.6}) }), "voorg-ass": Object.freeze({ large: Object.freeze({"x":1.1,"y":1.1}) }), "nelk": Object.freeze({ large: Object.freeze({"x":1.5,"y":1.5}) }), "moot": Object.freeze({ large: Object.freeze({"x":1.5,"y":1.5}), medium: Object.freeze({"x":1,"y":1}) }) }); // Old canonical class fingerprints only.
  const supersededCreatureGroundOffsets = Object.freeze({ "drenkirra": Object.freeze({ large: 0.79, medium: 0.4, small: 0.17 }), "grehlr": Object.freeze({ large: 0.5, medium: 0.26, small: 0.13 }), "gar-wolf": Object.freeze({ large: 0.5, medium: 0.33, small: 0.11 }), "dabinggi-hound": Object.freeze({ large: 0.5, medium: 0.27, small: 0.09 }), "uumkaoii": Object.freeze({ large: 0.35, medium: 0.25, small: 0.05 }), "puktuk": Object.freeze({ large: 0.4, medium: 0.24, small: 0.12 }), "voorg-ass": Object.freeze({ large: 0.462, medium: 0.325, small: 0.11 }), "nelk": Object.freeze({ large: 0.28, medium: 0.18, small: 0.065 }), "moot": Object.freeze({ large: 0, medium: 0, small: 0 }), "pingdort": Object.freeze({ large: 0.14842300556586271, medium: 0.14842300556586271, small: 0.07 }) }); // Old canonical full-row fingerprints only.
  const staleCreatureChatheadFrames = Object.freeze({
    uumkaoii: Object.freeze({ x: 0.009564166583519832, y: 0.2923510947804583, width: 0.4656387672084861, height: 0.47038721094834346 }),
    nelk: Object.freeze({ x: 0, y: 0, width: 0.04, height: 0.04 }),
    nazgraku: Object.freeze({ x: 0, y: 0, width: 0.04, height: 0.04 }),
  }); // Exact obsolete crop fingerprints; changing animals must not resurrect an old editor crop.
  const isStaleCreatureFrame = (kind, frame) => !!frame && !!staleCreatureChatheadFrames[kind]
    && ['x','y','width','height'].every(key => sameNumber(frame[key], staleCreatureChatheadFrames[kind][key]));
  const isStaleGroundOffsets = (kind, offsets) => !!offsets
    && [staleCreatureGroundOffsets[kind], supersededCreatureGroundOffsets[kind]].some(row => row
      && ['large','medium','small'].every(size => sameNumber(offsets[size], row[size])));
  const creatureGroundOffsets = Object.freeze({
    drenkirra: Object.freeze({ large: 0.45, medium: 0.4, small: 0.17 }),
    grehlr: Object.freeze({ large: 0.625, medium: 0.325, small: 0.13 }),
    'gar-wolf': Object.freeze({ large: 0.525, medium: 0.35, small: 0.11 }),
    'dabinggi-hound': Object.freeze({ large: 0.7, medium: 0.35, small: 0.09 }),
    uumkaoii: Object.freeze({ large: 0.75, medium: 0.25, small: 0.05 }),
    puktuk: Object.freeze({ large: 0.3, medium: 0.175, small: 0.12 }),
    'voorg-ass': Object.freeze({ large: 0.39, medium: 0.3, small: 0.11 }), // October 25 Rig Coordinates export.
    nelk: Object.freeze({ large: 0.45, medium: 0.25, small: 0.065 }),
    nazgraku: Object.freeze({ large: 0.31, medium: 0.2, small: 0.07 }),
    moot: Object.freeze({ large: -300, medium: -0.3, small: 0 }), // Nonpositive authored values retain Auto-ground fallback.
  });
  const skeeriChatheadFrame = Object.freeze({ x: 0.6611149088541667, y: 0.24899449865398673, width: 0.04, height: 0.04, coordinateSpace: 'sprite-normalized-top-left', version: 1 }); // Shared idle-sprite chathead crop for every Skeeri size variant.
  const creatureChatheadFrames = Object.freeze({
    'skeeri-medium': skeeriChatheadFrame,
    moot: Object.freeze({ x: 0.10526108108108108, y: 0.0923913043478261, width: 0.3246486486486486, height: 0.4021739130434782, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),
    grehlr: Object.freeze({ x: 0.10721275741258315, y: 0.349719408702988, width: 0.2558259151491218, height: 0.35439898228896183, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),
    'gar-wolf': Object.freeze({ x: 0, y: 0.2575, width: 0.25, height: 0.3575, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),
    'dabinggi-hound': Object.freeze({ x: 0.05321196485715341, y: 0.2621006265961596, width: 0.17863723264419087, height: 0.350903183334192, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),
    drenkirra: Object.freeze({ x: 0.1925, y: 0.3575, width: 0.2078, height: 0.305, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),
    uumkaoii: Object.freeze({ x: 0.022018283422815435, y: 0.180707251642218, width: 0.4241864686175028, height: 0.6442119462386413, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),
    puktuk: Object.freeze({ x: 0.17142091899942474, y: 0.11029044613093768, width: 0.27636019798104444, height: 0.601013493102534, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),
    'voorg-ass': Object.freeze({ x: 0.1235, y: 0.14, width: 0.3074, height: 0.3325, coordinateSpace: 'sprite-normalized-top-left', version: 1 }),
    nelk: Object.freeze({ x: 0.062069514805476525, y: 0.1705371019361113, width: 0.3448695403032319, height: 0.5212549290693803, coordinateSpace: 'sprite-normalized-top-left', version: 1 }), // Preserve export (21) despite stale Nelk frame in (23).
    nazgraku: Object.freeze({ x: 0.23705208817610238, y: 0.0587346014031421, width: 0.22574006332431554, height: 0.5112796374724654, coordinateSpace: 'sprite-normalized-top-left', version: 1 }), // New authored crop from export (23).
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
        shoulderPerch: { ...identityAnchor(perch), scale: { x: perch[3], y: perch[3], z: perch[3] }, sourcePixel: { ...shoulderPerchRule.sourcePixel } },
        leftHandShoulder: identityAnchor(left),
        rightHandShoulder: identityAnchor(right),
      },
      shoulderPerchRule,
      handShoulderRule: {
        source: 'rig-anchor-gizmo-v9-exact-supplied', coordinateSpace: 'character-visual-local', version: 4,
        authoredPreviewBaseWidth: GAME_AVATAR_WIDTH, runtimeBaseWidth: GAME_AVATAR_WIDTH,
        positionScaleApplied: 1, v9ExportedAt: V9_SHOULDERS_EXPORTED_AT,
      },
      anatomy: { portraitVerticalPlacementRatio: placement, portraitScale, handScale, footScale, armLengthHeightPercentOffset: armLength, version: 2 },
      characterAttachZDefaultVersion: 1,
    };
  }

  // Old Man Nohuknuk's bipedal-monster limb anchors are independent of Engh-sho.
  // Rig Coordinates can subsequently author his hands, feet and posterior without editing the donor.
  const nohuknukCharacterRig = clone(masterCharacters['engh-sho::male']); // Separate NPC anatomy used by the hybrid assembler and GLB solvers.
  nohuknukCharacterRig.species = 'nohuknuk';
  nohuknukCharacterRig.gender = 'male';
  nohuknukCharacterRig.anchors.leftHandShoulder = identityAnchor([0.35, 0.70, 0]); // Nohuknuk's left-hand socket, adjustable in Rig Coordinates.
  nohuknukCharacterRig.anchors.rightHandShoulder = identityAnchor([-0.35, 0.70, 0]); // Nohuknuk's right-hand socket, adjustable in Rig Coordinates.
  const nohuknukPerchPixel = { x: 100, y: 110 }; // Approximate shoulder reference in the 200px portrait preview; later Rig Coordinates authoring may refine it.
  nohuknukCharacterRig.anchors.shoulderPerch = {
    ...identityAnchor([-0.35, 0.70, 0]), sourcePixel: { ...nohuknukPerchPixel },
  }; // Nohuknuk's own right-hand shoulder location; his bipedal monster's authored attack orbit is 1x, not the Engh-sho donor's 0.7x.
  nohuknukCharacterRig.posteriorRule = {
    ...nohuknukCharacterRig.posteriorRule,
    heightPercentOffset: 0, heightPercentFromFloor: 32,
  }; // Creature body's hip/leg reference is floor-relative, not inherited from Engh-sho art.
  nohuknukCharacterRig.anatomy = {
    ...nohuknukCharacterRig.anatomy, portraitScale: 1, handScale: 1, footScale: 1, portraitVerticalPlacementRatio: 0.5,
  }; // No Engh-sho portrait-scale distortion should reach the creature sprite or primate limbs.
  nohuknukCharacterRig.shoulderPerchRule = {
    ...nohuknukCharacterRig.shoulderPerchRule,
    appearanceSpeciesId: 'nohuknuk', portraitModelHeight: 1.19, portraitVerticalPlacementRatio: 0.5,
    sourcePixel: { ...nohuknukPerchPixel },
  }; // Creature-sprite dimensions supply Nohuknuk's authored shoulder frame.
  masterCharacters['nohuknuk::male'] = nohuknukCharacterRig;

  const masterCreatures = {};
  for (const [kind, saddle, saddleSource, saddleOffset, saddlePixel, midlineSearchRadiusPx, shoulderGrip, scales, grehlrSizeScaleDefaultVersion] of creatureRecords) {
    const creatureAuthoredSource = kind === 'moot' ? 'animation-author-export-2026-11-16' : kind === 'grehlr'
      ? 'animation-author-export-2026-09-16'
      : ((kind === 'puktuk' || kind === 'voorg-ass') ? 'animation-author-export-2026-09-15'
        : ((kind === 'nelk' || kind === 'nazgraku' || kind === 'uumkaoii') ? 'animation-author-export-2026-10-22' : 'authored-2026-08-28-attachpointsv1')); // New/current creature grip coordinates keep their actual authored pass instead of inheriting an older baseline label.
    const saddleRule = saddleSource === 'highest-opaque-pixel-along-idle-sprite-midline'
      ? { source: saddleSource, heightPercentOffset: saddleOffset, defaultRuleVersion: 3, sourcePixel: { x: saddlePixel[0], y: saddlePixel[1] }, midlineSearchRadiusPx, authoredDefaultVersion: 6, authoredFixed: true, recalculateOnPreview: false }
      : { source: saddleSource, defaultRuleVersion: 3, authoredDefaultVersion: 6, authoredFixed: true, recalculateOnPreview: false };
    const sizeScales = {
      large: { x: scales[0][0], y: scales[0][1] }, medium: { x: scales[1][0], y: scales[1][1] }, small: { x: scales[2][0], y: scales[2][1] },
    };
    masterCreatures[kind] = {
      kind, chatheadFrame: creatureChatheadFrames[kind] ? { ...creatureChatheadFrames[kind] } : null,
      anchors: { saddle: identityAnchor(saddle), shoulderGrip: identityAnchor(shoulderGrip, kind === 'drenkirra' ? DRENKIRRA_SHOULDER_GRIP_YAW_DEG : (kind === 'uumkaoii' ? 0 : -61)) }, // Reverse Drenkirra's whole-pet Y rotation; Uumkao'ii remains neutral and other authored grips remain unchanged.
      saddleRule,
      shoulderGripRule: { source: kind === 'voorg-ass' ? 'animation-author-export-2026-11-24' : creatureAuthoredSource, coordinateSpace: 'unscaled-idle-png-plane-local', defaultRuleVersion: 5, authoredDefaultVersion: 7, authoredFixed: true, recalculateOnPreview: false },
      sizeScales, groundOffsets: { ...(creatureGroundOffsets[kind] || { large:0, medium:0, small:0 }) },
      sizeScaleRule: { version:1, axes:'png-plane-local-x-y', zScale:1, applicationOrder:'before-outer-prism-and-world-bounds', authoredDefaultVersion:6, authoredFixed:true, ...((kind === 'puktuk' || kind === 'voorg-ass') ? { source: creatureAuthoredSource } : {}) },
      shoulderGripRotationDefaultVersion: 2, creatureShoulderGripDefaultVersion: 5,
      sizeScalePercentages: {
        large: { x: sizeScales.large.x * 100, y: sizeScales.large.y * 100 },
        medium: { x: sizeScales.medium.x * 100, y: sizeScales.medium.y * 100 },
        small: { x: sizeScales.small.x * 100, y: sizeScales.small.y * 100 },
      },
      ...(grehlrSizeScaleDefaultVersion == null ? {} : { grehlrSizeScaleDefaultVersion }),
    };
  }

  const sizeScalePercentages = sizes => Object.fromEntries(['large','medium','small'].map(size => [
    size, { x: sizes[size].x * 100, y: sizes[size].y * 100 },
  ])); // Shared export/UI mirror derived from each species' canonical local PNG-plane scales.

  // Pingdort's latest authored floor lifts keep the native flying-foot baseline for Large/Medium,
  // while Medium uses 0.218 and Small uses 0.07; its shoulder grip is authored separately.
  const pingdortFootLift = 0.14842300556586271; // Used to retain the exact Large/Medium ground offsets in the exported rig.
  masterCreatures.pingdort = {
    kind: 'pingdort',
    chatheadFrame: null,
    anchors: { saddle: identityAnchor([0, 0, 0]), shoulderGrip: identityAnchor([0, -0.05596633162050327, 0.06962064405051654]) },
    shoulderGripRule: { source: 'native-flying-sprite-foot', coordinateSpace: 'unscaled-idle-png-plane-local', defaultRuleVersion: 5, authoredDefaultVersion: 7, authoredFixed: true, recalculateOnPreview: false },
    sizeScales: { large: { x: 3.5, y: 3.5 }, medium: { x: 1.75, y: 1.75 }, small: { x: 1, y: 1 } },
    groundOffsets: { large: pingdortFootLift, medium: 0.218, small: 0.07 },
    sizeScalePercentages: sizeScalePercentages({ large: { x: 3.5, y: 3.5 }, medium: { x: 1.75, y: 1.75 }, small: { x: 1, y: 1 } }),
    saddleRule: {},
    sizeScaleRule: { version: 1, axes: 'png-plane-local-x-y', zScale: 1, applicationOrder: 'before-outer-prism-and-world-bounds', authoredDefaultVersion: 6, authoredFixed: true },
    shoulderGripRotationDefaultVersion: 2, creatureShoulderGripDefaultVersion: 4,
  };

  const skeeriSmallGroundY = masterCreatures.pingdort.groundOffsets.small; // Pingdort's approved Small 0.07 floor calibration is the shared Skeeri baseline.
  const skeeriGroundOffsets = { // Scale the source floor Y by the actual native Skeeri widths: Small .65, Medium 1.15, Large 2.2.
    large: skeeriSmallGroundY * (2.2 / 0.65), medium: skeeriSmallGroundY * (1.15 / 0.65), small: skeeriSmallGroundY,
  };
  const skeeriShoulderGrip = clone(masterCreatures.pingdort.anchors.shoulderGrip); // All Skeeri variants inherit only Pingdort's approved grip, not its saddle or size scales.
  const skeeriMediumGroundOffsets = { large: 0.375, medium: 0.26, small: 0.1 }; // Distinct, fully authored Medium Skeeri floors from November 22; the other variants retain their native-width-derived values.
  const skeeriMediumRig = { // Preserve Medium Skeeri's independent saddle, size scales and floor rig.
    kind: 'skeeri-medium',
    anchors: { saddle: identityAnchor([0, 0.12801484107971195, 0.02]), shoulderGrip: clone(skeeriShoulderGrip) },
    groundOffsets: { ...skeeriMediumGroundOffsets },
    saddleRule: {},
    shoulderGripRule: {},
    sizeScales: { large: { x: 1.5, y: 1.5 }, medium: { x: 1, y: 1 }, small: { x: 0.35, y: 0.35 } },
    sizeScaleRule: { version: 1, axes: 'png-plane-local-x-y', zScale: 1, applicationOrder: 'before-outer-prism-and-world-bounds' },
    shoulderGripRotationDefaultVersion: 2, creatureShoulderGripDefaultVersion: 4,
    sizeScalePercentages: sizeScalePercentages({ large: { x: 1.5, y: 1.5 }, medium: { x: 1, y: 1 }, small: { x: 0.35, y: 0.35 } }),
  };
  masterCreatures['skeeri-medium'] = { ...skeeriMediumRig, chatheadFrame: { ...creatureChatheadFrames['skeeri-medium'] } };
  const skeeriUnscaledSizeClasses = { // Native-width ruin varieties must not also apply Medium Skeeri's unrelated size multipliers.
    large: { x: 1, y: 1 }, medium: { x: 1, y: 1 }, small: { x: 1, y: 1 },
  };
  const skeeriDomesticSizeClasses = { // Domestic Skeeri use the Small native .65-width body, so inherited Medium/Large Size must grow with its ground lift.
    large: { x: 2.2 / 0.65, y: 2.2 / 0.65 }, medium: { x: 1.15 / 0.65, y: 1.15 / 0.65 }, small: { x: 1, y: 1 },
  };
  for (const kind of ['skeeri', 'skeeri-small', 'skeeri-large']) {
    masterCreatures[kind] = { // Domestic Skeeri and the other two ruin varieties get independent grip/floor data without borrowing Medium's saddle.
      kind,
      chatheadFrame: { ...creatureChatheadFrames['skeeri-medium'] },
      anchors: { saddle: identityAnchor([0, 0, 0]), shoulderGrip: clone(skeeriShoulderGrip) },
      groundOffsets: { ...skeeriGroundOffsets },
      saddleRule: {}, shoulderGripRule: {},
      sizeScales: clone(kind === 'skeeri' ? skeeriDomesticSizeClasses : skeeriUnscaledSizeClasses),
      sizeScaleRule: { ...skeeriMediumRig.sizeScaleRule },
      shoulderGripRotationDefaultVersion: 2, creatureShoulderGripDefaultVersion: 4,
      sizeScalePercentages: sizeScalePercentages(kind === 'skeeri' ? skeeriDomesticSizeClasses : skeeriUnscaledSizeClasses),
    };
  }

  // One NPC lower half, not a wildlife species: standalone animal-style rig data.
  const isStaleDrenkirraShoulderGripYaw = (kind, grip) => kind === 'drenkirra'
    && sameNumber(grip?.rotationDeg?.y, -61)
    && samePosition(grip?.position, masterCreatures.drenkirra.anchors.shoulderGrip.position); // Detects only the old stock Drenkirra yaw at its unchanged authored grip position.

  const omgurkuLowerRig = clone(masterCreatures['voorg-ass']); // Independent floor profile; preserve Voorg-ass genotypes and rig values.
  omgurkuLowerRig.kind = 'omgurku-lower';
  omgurkuLowerRig.groundOffsets = { large: 0, medium: 0.3, small: 0 }; // Fixed adult hybrid lower half sits 0.3 world units above its gameplay floor.
  omgurkuLowerRig.sizeScales = { large: { x: 1, y: 1 }, medium: { x: 1, y: 1 }, small: { x: 1, y: 1 } }; // Fixed size regardless of animal preview class.
  omgurkuLowerRig.sizeScalePercentages = { large: { x: 100, y: 100 }, medium: { x: 100, y: 100 }, small: { x: 100, y: 100 } }; // Mirrors fixed scales in exports.
  omgurkuLowerRig.anchors = { saddle: identityAnchor([0, 0, 0]), shoulderGrip: identityAnchor([0, 0, 0]) }; // The hybrid join remains owned by hybridPlacement.
  omgurkuLowerRig.shoulderGripRule.source = 'animation-author-export-2026-09-15'; // Preserve the independent hybrid socket's existing provenance.
  masterCreatures['omgurku-lower'] = omgurkuLowerRig;


  // Tzatzul hatchlings have separate authored sockets and a smaller native body; never mirror the adult rig.
  for (const [kind, saddleY, gripY, mediumLift] of [
    ['tzatzul', 0.24489795684814464, -0.3129251670837402, 0.5],
    ['tzatzul-hatchling', 0.1530612230300904, -0.19557822942733763, 0.3],
  ]) {
    masterCreatures[kind] = {
      kind, anchors: { saddle: identityAnchor([0, saddleY, 0.02]), shoulderGrip: identityAnchor([0, gripY, 0]) },
      sizeScales: { large: { x: 1.5, y: 1.5 }, medium: { x: 1, y: 1 }, small: { x: 0.35, y: 0.35 } },
      groundOffsets: { large: 0, medium: mediumLift, small: 0 }, saddleRule: {}, shoulderGripRule: {},
      sizeScaleRule: { version: 1, axes: 'png-plane-local-x-y', zScale: 1, applicationOrder: 'before-outer-prism-and-world-bounds' },
      sizeScalePercentages: { large: { x: 150, y: 150 }, medium: { x: 100, y: 100 }, small: { x: 35, y: 35 } },
    };
  }
  const MASTER_PROVENANCE = Object.freeze({
    creatureTransforms: Object.freeze({ source: 'hobunji_attachment_rig_profiles (28).json', exportedAt: '2026-11-22T19:41:51.233Z' }),
    handShoulder: Object.freeze({ source: 'exact supplied v9 Rig Coordinates hand-shoulder tuples authored after Animation Author adopted gameplay width 0.9', authoredCommit: 'bbd8c0ed2934b8f76e0e85986cd191ab548f9945', exportedAt: V9_SHOULDERS_EXPORTED_AT, correction: 'v2 removes the v1 forensic master extra x0.9 scale; exact v9 values are already runtime-space values' }),
    posterior: Object.freeze({ source: 'preview calibration: posterior is 20% of portrait height below the live portrait-plane bottom edge', coordinateSpace: 'floor-relative portrait-height percent', authoredAt: '2026-10-17' }),
    portraitScale: Object.freeze({ source: 'latest authored species/gender anatomy portraitScale values, made authoritative for preview/runtime', authorityCommit: '79057667a678bde6d62c1ce929a354c18cd40f73' }),
    shoulderPerch: Object.freeze({ source: 'supplied 2026-08-28 rig export retained by the avatar-regression recovery pass', recoveryCommit: 'f0a176ec7e90802d3a6107b04aa4125621c44b5b', authoredAt: '2026-08-28T03:24:15.652Z' }),
    shoulderGrip: Object.freeze({ source: 'supplied 2026-08-28 creature rig export retained by the avatar-regression recovery pass', recoveryCommit: 'f0a176ec7e90802d3a6107b04aa4125621c44b5b', authoredAt: '2026-08-28T03:24:15.652Z' }),
    saddle: Object.freeze({ source: '2026-10-17 Rig Coordinates export', authoredAt: '2026-10-17T01:03:29.187Z', replacesBaselineCommit: 'bbd8c0ed2934b8f76e0e85986cd191ab548f9945' }),
  });

  const masterProfiles = { characters: clone(masterCharacters), creatures: clone(masterCreatures), creatureTransformAliases };
  const master = { version: MASTER_VERSION, schema: MASTER_SCHEMA, assembledAt: '2026-09-03', provenance: MASTER_PROVENANCE, transformSpeciesAliases: characterTransformAliases, profiles: masterProfiles };
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
      characters, creatures, characterTransformAliases, creatureTransformAliases, masterConfigVersion: MASTER_VERSION,
      defaultRuleVersion: 3, posteriorFloorRuleVersion: 5, shoulderPerchDefaultRuleVersion: 4,
      creatureShoulderGripDefaults, creatureShoulderGripDefaultRuleVersion: 5,
      creatureGroundOffsetSemantics: { profileField: 'profiles.creatures.<kind>.groundOffsets.<small|medium|large>', coordinateSpace: 'absolute world/gameplay floor-to-creature-origin lift replacing automatic half-height terrain placement', runtimeUnit: 'world units' },
      creatureChatheadFrameSemantics: { coordinateSpace: 'sprite-normalized-top-left', sourceFrame: 'idle creature sprite before size-class scaling', use: 'ambient dialogue chatheads, livestock full dialogue, and animal-looking full-dialogue portraits', specialNpcSpecies: { banubu: 'grehlr', hiki_hiki: 'drenkirra' } },
      creatureSizeScaleSemantics: { profileField: 'profiles.creatures.<kind>.sizeScales.<small|medium|large>.{x,y}', axes: 'png-plane-local-x-y', zScale: 1, applicationOrder: 'direct rendered animal mesh local X/Y; rig-anchor positions share an anchor-only scale root; before world bounds', runtimeUnit: 'multiplier', displayUnit: 'percent', conversion: 'multiplier = percent / 100' },
      characterAttachPointDefaultZ: 0,
      characterSpeciesSource: 'avatarEditor.rawExport/profile/npc appearance only; NPC info-form species excluded',
      characterShoulderPerchVerticalPlacement: 'PNGPlaneAvatar.avatarPlacementRatioFor(appearance)',
      anatomySemantics: {
        profileField: 'character.anatomy', portraitYOffsetFormula: '(portraitVerticalPlacementRatio - 0.5) * 100',
        portraitScale: 'portraitScale is an independent species/gender multiplier; legacy species-only numbers remain supported',
        scales: 'handScale and footScale are independent species/gender multipliers', armLength: 'positive armLengthHeightPercentOffset moves unowned fallback hands downward by portraitModelHeight * percent / 100',
        aliases: 'Rakakoan resolves to Kenkari and Ghoul resolves to Mao-ao; alias species own no independent transform values.',
      },
    };
  }

  window.HOBUNJI_ATTACHMENT_RIG_PROFILES = runtimeProfilesFromMaster();
  window.HOBUNJI_ATTACHMENT_RIG_EXPORT_META = Object.freeze({
    schema: MASTER_SCHEMA, exportedAt: '2026-10-17T01:03:29.187Z', masterConfigVersion: MASTER_VERSION,
    coordinateSpace: 'Characters: floor-relative 0.9-wide runtime avatar space. Creature coordinates: unscaled idle-sprite local space.',
    transformSpeciesAliases: characterTransformAliases, fieldProvenance: MASTER_PROVENANCE,
    derivedCoordinates: {
      characterPosterior: { source:'posteriorRule.heightPercentFromFloor', formula:'portraitModelHeight * heightPercentFromFloor / 100', legacyFallback:'handAttachY + portraitModelHeight * heightPercentOffset / 100' },
      characterShoulderPerch: { source:'authored 2026-08-28 rig coordinates', offsetPercent:0 },
      characterHandShoulders: { source:'exact v9 Rig Coordinates export', positionScaleApplied:1, runtimeBaseWidth:GAME_AVATAR_WIDTH, exportedAt:V9_SHOULDERS_EXPORTED_AT },
      creatureSaddle: { source:'2026-10-17 Rig Coordinates export' }, creatureShoulderGrip: { source:'authored 2026-08-28 creature rig coordinates', defaultRuleVersion:5 },
      idleHands: { x:'matching leftHandShoulder/rightHandShoulder anchor X', y:'derived character posterior Y plus procedural idle/walk Y offset', aimTarget:'matching full hand-shoulder anchor transform' },
    },
    attachmentSemantics: { mount: { carrierAnchor:'creature.saddle', riderAnchor:'character.posterior', keyedObject:'intermediateParent' }, shoulderPet: { carrierAnchor:'character.shoulderPerch', riderAnchor:'creature.shoulderGrip', keyedObject:'intermediateParent' } },
  });
  window.HOBUNJI_ATTACHMENT_RIG_MATH = Object.freeze({
    characterPosteriorY(posteriorRule, modelHeight, legacyHandAttachY) {
      const height = Number(modelHeight);
      const safeHeight = Number.isFinite(height) && height > 0 ? height : 0.9;
      const floorPercent = Number(posteriorRule?.heightPercentFromFloor);
      if (Number.isFinite(floorPercent)) return safeHeight * floorPercent / 100;
      const legacyOffset = Number(posteriorRule?.heightPercentOffset);
      const legacyBase = Number(legacyHandAttachY);
      return (Number.isFinite(legacyBase) ? legacyBase : safeHeight / 2) + safeHeight * (Number.isFinite(legacyOffset) ? legacyOffset : -18) / 100;
    },
    characterArmLength(profile, modelHeight, legacyHandAttachY, side = null, currentPortraitScale = null, currentPlacementRatio = null) {
      const height = Number(modelHeight);
      const safeHeight = Number.isFinite(height) && height > 0 ? height : 0.9;
      const posteriorY = this.characterPosteriorY(profile?.posteriorRule, safeHeight, legacyHandAttachY);
      const authoredOffset = Number(profile?.anatomy?.armLengthHeightPercentOffset);
      const wristY = posteriorY - safeHeight * (Number.isFinite(authoredOffset) ? authoredOffset : 0) / 100; // Matches the runtime free-hand resting-height rule exactly.
      const authoredPortraitScale = Number(profile?.anatomy?.portraitScale);
      const livePortraitScale = currentPortraitScale == null ? NaN : Number(currentPortraitScale);
      const portraitFactor = Number.isFinite(authoredPortraitScale) && authoredPortraitScale > 0 && Number.isFinite(livePortraitScale) && livePortraitScale > 0
        ? livePortraitScale / authoredPortraitScale
        : 1;
      const authoredPlacement = Number(profile?.anatomy?.portraitVerticalPlacementRatio);
      const livePlacement = currentPlacementRatio == null ? NaN : Number(currentPlacementRatio);
      const placementDelta = Number.isFinite(authoredPlacement) && Number.isFinite(livePlacement)
        ? livePlacement - authoredPlacement
        : 0;
      const reachFor = key => {
        const shoulder = profile?.anchors?.[key]?.position;
        if (![shoulder?.x, shoulder?.y, shoulder?.z].every(value => Number.isFinite(Number(value)))) return null;
        // Match procedural-hand-scale-free-world's portrait-binding transform:
        // child/other live portrait scales shrink the adult shoulder anchor, and
        // placement changes shift its Y by the current model height.
        const shoulderY = Number(shoulder.y) * portraitFactor + safeHeight * placementDelta;
        const shoulderZ = Number(shoulder.z) * portraitFactor;
        // Free-hand X is aligned to its shoulder and idle Z is zero, so this
        // measures the actual displayed shoulder-to-resting-wrist reach.
        const reach = Math.hypot(wristY - shoulderY, 0 - shoulderZ);
        return Number.isFinite(reach) && reach > 1e-6 ? reach : null;
      };
      if (side === 'left') return reachFor('leftHandShoulder');
      if (side === 'right') return reachFor('rightHandShoulder');
      const values = [reachFor('leftHandShoulder'), reachFor('rightHandShoulder')].filter(Number.isFinite);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    },
  });
  window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS = {
    schema: MASTER_SCHEMA, exportedAt: window.HOBUNJI_ATTACHMENT_RIG_EXPORT_META.exportedAt, masterConfigVersion: MASTER_VERSION,
    shoulderAnchorsExportedAt: V9_SHOULDERS_EXPORTED_AT, anatomyProfiles: 'pending', authoredCharacterProfiles: 10, suppliedCharacterProfiles: 14,
    sharedCharacterProfiles: 4, exactSuppliedProfiles: 10, authoredCreatureProfiles: 5, parrotSharedProfiles: 2,
    rakakoanTransforms: 'always-aliased-to-kenkari', ghoulTransforms: 'always-aliased-to-mao-ao', handShoulderCalibration: 'v9-exact-post-calibration-no-extra-scale',
    anchorPositionScale: 1, posteriorCoordinateSpace: 'floor-relative', posteriorPixelDependency: 'removed', posteriorFloorValues: 'portrait-bottom-minus-20-percent-preview-calibration',
    exporterGuard: 'master-reconcile-and-versioned-rig-autosave', animationAuthorCreatureSync: { state: 'not-needed-yet', repairs: 0, lastReason: null },
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
        const scaleProfile = typeof pngAvatarConfig.portraitScaleBySpecies[species] === 'object' ? pngAvatarConfig.portraitScaleBySpecies[species] : { default: Number.isFinite(legacyScale) && legacyScale > 0 ? legacyScale : 1 };
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
    if (!validPosition(sourcePosition) || (zeroPosition(sourcePosition) && !zeroPosition(canonicalPosition)) || matchesKnownStale) return clone(canonical);
    return source;
  }
  function repairKnownCreatureSizeScale(kind, merged, canonical) {
    const staleRows = [staleCreatureSizeScales[kind], supersededCreatureSizeScales[kind]].filter(Boolean); // Preserve custom class edits while upgrading old stock values.
    if (!staleRows.length) return false;
    let repaired = false;
    merged.sizeScales ||= clone(canonical.sizeScales || {});
    merged.sizeScalePercentages ||= clone(canonical.sizeScalePercentages || {});
    for (const staleByClass of staleRows) for (const [sizeClass, stale] of Object.entries(staleByClass)) {
      const current = merged.sizeScales?.[sizeClass];
      if (!sameNumber(current?.x, stale.x) || !sameNumber(current?.y, stale.y)) continue;
      merged.sizeScales[sizeClass] = clone(canonical.sizeScales[sizeClass]);
      if (canonical.sizeScalePercentages?.[sizeClass]) merged.sizeScalePercentages[sizeClass] = clone(canonical.sizeScalePercentages[sizeClass]);
      else delete merged.sizeScalePercentages[sizeClass]; // The new Pingdort master intentionally has no duplicate percent rows for reauthored classes.
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
      const stalePosteriorFloor = Number(staleCharacterPosteriorFloors[key]); // Migrates only the exact superseded stock posterior, preserving later hand-authored values.
      if (!Number.isFinite(floorPercent) || Math.abs(floorPercent) <= 1e-12 || sameNumber(floorPercent, stalePosteriorFloor)) merged.posteriorRule.heightPercentFromFloor = canonical.posteriorRule.heightPercentFromFloor;
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
      if (Object.keys(canonical.sizeScalePercentages || {}).length && !Object.keys(candidate.sizeScalePercentages || {}).length) {
        merged.sizeScalePercentages = clone(canonical.sizeScalePercentages); // Migrate old no-percentage Pingdort/Skeeri exports without rewriting authored percentage controls.
      }
      const oldGrip = merged.anchors.shoulderGrip;
      const drenkirraOldPosition = kind === 'drenkirra' && normalizeStalePositions(staleCreatureShoulderGrips.drenkirra)
        .some(position => samePosition(oldGrip?.position, position)); // Detects a known obsolete socket XYZ independently from any hand-authored rotation.
      merged.anchors.shoulderGrip = reconcileAnchor(oldGrip, canonical.anchors.shoulderGrip, staleCreatureShoulderGrips[kind]);
      if (kind === 'voorg-ass' && normalizeStalePositions(staleCreatureShoulderGrips[kind]).some(position => samePosition(oldGrip?.position, position))) {
        // Only an exact retired stock position migrates; keep valid independent rotation and scale.
        if (oldGrip.rotationDeg) for (const axis of ['x', 'y', 'z']) {
          if (Number.isFinite(oldGrip.rotationDeg[axis])) merged.anchors.shoulderGrip.rotationDeg[axis] = oldGrip.rotationDeg[axis];
        }
        if (oldGrip.scale && ['x', 'y', 'z'].every(axis => Number.isFinite(oldGrip.scale[axis]) && oldGrip.scale[axis] > 0)) {
          merged.anchors.shoulderGrip.scale = clone(oldGrip.scale);
        }
      }
      if (drenkirraOldPosition && oldGrip?.rotationDeg) {
        const canonicalRotation = canonical.anchors.shoulderGrip.rotationDeg; // Keeps unchanged components while correcting the known obsolete stock Y.
        const authoredRotation = oldGrip.rotationDeg; // Preserves custom yaw/pitch/roll even when its old grip POSITION needs migrating.
        const restoredRotation = { ...canonicalRotation };
        for (const axis of ['x', 'y', 'z']) {
          const value = Number(authoredRotation[axis]);
          if (Number.isFinite(value)) restoredRotation[axis] = axis === 'y' && sameNumber(value, -61) ? canonicalRotation.y : value;
        }
        merged.anchors.shoulderGrip.rotationDeg = restoredRotation;
        if (oldGrip.scale && ['x', 'y', 'z'].every(axis => Number.isFinite(Number(oldGrip.scale[axis])) && Number(oldGrip.scale[axis]) > 0)) {
          merged.anchors.shoulderGrip.scale = { ...oldGrip.scale }; // A deliberately scaled old grip must not lose its independent user-authored scale.
        }
      }
      if (isStaleDrenkirraShoulderGripYaw(kind, merged.anchors.shoulderGrip)) {
        merged.anchors.shoulderGrip.rotationDeg = { ...merged.anchors.shoulderGrip.rotationDeg, y: canonical.anchors.shoulderGrip.rotationDeg.y }; // Migrate only obsolete stock Drenkirra Y; never rewrite grip position or custom pose.
      }
      if (oldGrip && !samePosition(oldGrip.position, merged.anchors.shoulderGrip.position)) {
        merged.shoulderGripRule = clone(canonical.shoulderGripRule);
        if (kind === 'pingdort' && Number(candidate.creatureShoulderGripDefaultVersion) === 5) {
          merged.creatureShoulderGripDefaultVersion = canonical.creatureShoulderGripDefaultVersion; // Retire only the old stock Pingdort version when its native-foot anchor migrates.
        }
      }
      const oldSaddle = merged.anchors.saddle; // Used to restore canonical rule metadata only when an exact superseded default is migrated.
      merged.anchors.saddle = reconcileAnchor(oldSaddle, canonical.anchors.saddle, staleCreatureSaddles[kind]);
      if (oldSaddle && !samePosition(oldSaddle.position, merged.anchors.saddle.position)) merged.saddleRule = clone(canonical.saddleRule);
      if (repairKnownCreatureSizeScale(kind, merged, canonical)) merged.sizeScaleRule = clone(canonical.sizeScaleRule);
      if (isStaleGroundOffsets(kind, candidate.groundOffsets)) merged.groundOffsets = clone(canonical.groundOffsets); // Only known legacy rows are replaced; custom size classes remain untouched.
      if (isStaleCreatureFrame(kind, candidate.chatheadFrame)
          || ((kind === 'moot' || kind === 'skeeri-medium') && candidate.chatheadFrame == null)) {
        merged.chatheadFrame = clone(canonical.chatheadFrame); // Old Moot profiles exported a null frame; supply the newly authored crop on import.
      }
      if ((kind === 'nelk' || kind === 'nazgraku') && merged.saddleRule?.source === 'uncalibrated-defaults'
          && samePosition(merged.anchors.saddle.position, canonical.anchors.saddle.position)) merged.saddleRule = clone(canonical.saddleRule);
      if ((kind === 'nelk' || kind === 'nazgraku' || kind === 'uumkaoii') && merged.shoulderGripRule?.source === 'authored-2026-08-28-attachpointsv1'
          && samePosition(merged.anchors.shoulderGrip.position, canonical.anchors.shoulderGrip.position)) merged.shoulderGripRule = clone(canonical.shoulderGripRule);
      output.creatures[kind] = merged;
    }
    for (const kind of ['skeeri-small', 'skeeri-large']) {
      const variant = output.creatures[kind]; // Do not manufacture an unrelated rig profile or override fixed-size creature geometry.
      if (variant && variant.chatheadFrame == null) {
        variant.chatheadFrame = clone(output.creatures['skeeri-medium']?.chatheadFrame || masterCreatures['skeeri-medium'].chatheadFrame); // Persist the same authored crop in any variant row that an editor already created.
      }
    }
    output.characterTransformAliases = characterTransformAliases;
    output.creatureTransformAliases = creatureTransformAliases;
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
    output.exportGuard = { version: 2, behavior: 'canonical master baseline + current intentional edits; known v1/v9/default corruption fingerprints are repaired before persistence/export' };
    return output;
  }

  const masterGuard = {
    version: 2, masterConfigVersion: MASTER_VERSION, legacyStorageKey: 'hobunjiAttachmentRigProfiles.v2',
    storageKey: `hobunjiAttachmentRigProfiles.master.${MASTER_VERSION}`,
    reconcileProfiles, reconcileRigExport, getMasterProfiles: () => clone(masterProfiles), provenance: MASTER_PROVENANCE,
  };
  window.HOBUNJI_ATTACHMENT_RIG_MASTER_GUARD = Object.freeze(masterGuard);

  const previousRigStorageKeys = Object.freeze(['hobunjiAttachmentRigProfiles.master.hobunji-attachment-rig-master-2026-09-03-v1', masterGuard.legacyStorageKey]);
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
        if (originalGetItem.call(localStorage, masterGuard.storageKey)) migrationStatus = { migrated: false, sourceKey: masterGuard.storageKey, reason: 'current-v2-autosave-present' };
        else {
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
      } catch (error) { migrationStatus = { migrated: false, sourceKey: null, reason: `migration-error:${error?.message || error}` }; }
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
      const timer = setInterval(() => { if (installExporterGuard() || ++attempts >= 200) clearInterval(timer); }, 50);
    }

    // V15.24 replaces the live creature library with an embedded snapshot and
    // V15.37 restores only characters. On Rig open/reset, repair only exact old
    // creature fingerprints through the editor's own latest Import pipeline.
    let creatureSyncQueued = false;
    const animationAuthorCreatureSyncStatus = window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.animationAuthorCreatureSync;
    const staleCreatureFields = live => {
      const stale = [];
      if (!live?.creatures?.['skeeri-medium']) stale.push('skeeri-medium.profile'); // Older Rig Coordinates autosaves predate this newly authored creature.
      for (const kind of ['moot', 'skeeri-medium', 'skeeri-small', 'skeeri-large']) {
        if (live?.creatures?.[kind] && live.creatures[kind].chatheadFrame == null) stale.push(`${kind}.chatheadFrame`); // Repair absent first-time shared frames without changing existing authored rectangles.
      }
      for (const [kind, positions] of Object.entries(staleCreatureSaddles)) {
        const position = live?.creatures?.[kind]?.anchors?.saddle?.position; // Used to repair old stock saddle coordinates without overwriting later custom authoring.
        if (normalizeStalePositions(positions).some(candidate => samePosition(position, candidate))) stale.push(`${kind}.saddle`);
      }
      for (const [kind, positions] of Object.entries(staleCreatureShoulderGrips)) {
        const grip = live?.creatures?.[kind]?.anchors?.shoulderGrip;
        if (normalizeStalePositions(positions).some(candidate => samePosition(grip?.position, candidate))) stale.push(`${kind}.shoulderGrip`);
        if (isStaleDrenkirraShoulderGripYaw(kind, grip)) stale.push(`${kind}.shoulderGrip.rotationDeg.y`); // Let Animation Author repair its cached stock Y direction on Rig open.
      }
      for (const kind of Object.keys({ ...staleCreatureGroundOffsets, ...supersededCreatureGroundOffsets })) {
        const candidate = live?.creatures?.[kind]; // Checks known old editor rows for exactly matching obsolete values.
        if (!candidate) continue;
        if (isStaleGroundOffsets(kind, candidate.groundOffsets)) stale.push(`${kind}.groundOffsets`);
        if (isStaleCreatureFrame(kind, candidate.chatheadFrame)) stale.push(`${kind}.chatheadFrame`);
      }
      for (const [kind, staleByClass] of [...Object.entries(staleCreatureSizeScales), ...Object.entries(supersededCreatureSizeScales)]) {
        for (const [sizeClass, staleScale] of Object.entries(staleByClass)) {
          const liveScale = live?.creatures?.[kind]?.sizeScales?.[sizeClass];
          if (sameNumber(liveScale?.x, staleScale.x) && sameNumber(liveScale?.y, staleScale.y)) stale.push(`${kind}.sizeScales.${sizeClass}`);
        }
      }
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
      input.dispatchEvent(new Event('change', { bubbles: false }));
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
    window.HobunjiAnimationAuthorRigMasterSync = Object.freeze({
      repairNow: () => repairAnimationAuthorCreatureDefaults('manual-debug'),
      staleFields: () => staleCreatureFields(window.MultiAvatarAnimationAuthor?.getAttachmentRigProfiles?.() || {}),
      getStatus: () => ({ ...animationAuthorCreatureSyncStatus }),
    });
  }

  const shoulderPetObservationFlipRuntime = { poseRollCount: 0, lastPose: null };
  const shoulderObservationMeshes = avatar => {
    const meshes = []; // Live animal face cards and split overlays transformed together by the shoulder-grip pivot solve.
    const seen = new Set(); // Prevents fallback references from duplicating meshes already discovered through the live hierarchy.
    const add = plane => {
      if (!plane?.scale || !plane?.position || !plane?.parent || seen.has(plane)) return;
      seen.add(plane);
      meshes.push(plane);
    };
    avatar?.group?.traverse?.(node => {
      const face = node?.userData?.hobunjiPlaneFace; // Identifies head-rig replacements as well as the original animal cards.
      if (face === 'front' || face === 'back' || node?.userData?.hobunjiShoulderSplitOverlay) add(node);
    });
    if (!meshes.length) {
      add(avatar?.frontPlane);
      add(avatar?.backPlane);
    }
    return meshes;
  };
  const canonicalShoulderObservationPlaneState = plane => {
    if (!plane?.position || !plane?.scale) return null;
    plane.userData = plane.userData || {};
    let state = plane.userData.hobunjiShoulderGripMirrorPivot; // Canonical local transform retained so every frame starts from the same unmirrored authored card placement.
    if (!state) {
      const magnitude = Math.abs(Number(plane.scale.x)); // Canonical face X scale before observation mirroring.
      state = {
        basePosition: [plane.position.x, plane.position.y, plane.position.z],
        baseScaleX: Number.isFinite(magnitude) && magnitude > 0 ? magnitude : 1,
        lastError: null,
      };
      plane.userData.hobunjiShoulderGripMirrorPivot = state;
    }
    return state;
  };
  const restoreShoulderObservationPlane = plane => {
    const state = canonicalShoulderObservationPlaneState(plane); // Used when a pet leaves shoulder mode so no mirrored transform leaks into ordinary companion rendering.
    if (!state) return false;
    plane.matrixAutoUpdate = true;
    plane.position.set(state.basePosition[0], state.basePosition[1], state.basePosition[2]);
    plane.scale.x = state.baseScaleX;
    plane.updateMatrix?.();
    plane.matrixWorldNeedsUpdate = true;
    return true;
  };
  const applyShoulderPetObservationAtPinnedPerch = (pet, worldPivot) => {
    const avatar = pet?.avatarRef;
    if (!avatar?.group || !worldPivot) return false;
    const meshes = shoulderObservationMeshes(avatar); // Used below to guarantee every shoulder card is restored to its canonical unmirrored transform.
    const restoredCount = meshes.reduce((count, plane) => count + (restoreShoulderObservationPlane(plane) ? 1 : 0), 0);
    avatar.__hobunjiShoulderObservationPivotDebug = {
      mode: 'canonical-no-sprite-mirror',
      mirrored: false,
      meshCount: restoredCount,
      worldPivot: [Number(worldPivot.x) || 0, Number(worldPivot.y) || 0, Number(worldPivot.z) || 0],
      maxError: null,
    };
    if (shoulderPetObservationFlipRuntime.lastPose
        && shoulderPetObservationFlipRuntime.lastPose.pet === pet) {
      shoulderPetObservationFlipRuntime.lastPose.applied = restoredCount > 0;
      shoulderPetObservationFlipRuntime.lastPose.spriteMode = 'canonical-no-sprite-mirror';
    }
    return restoredCount > 0;
  };
  const recordShoulderPetPose = (pet, details = {}) => {
    if (!pet) return false;
    const facingInward = details.facingInward === true;
    pet.__hobunjiShoulderFacingInward = facingInward;
    shoulderPetObservationFlipRuntime.poseRollCount += 1;
    shoulderPetObservationFlipRuntime.lastPose = {
      pet, // Internal identity only; removed from the public debug snapshot below.
      creatureKey: pet.creatureKey || pet.kind || 'unknown',
      facingInward,
      inwardChance: Number(details.inwardChance),
      holdSeconds: Number(details.holdSeconds),
      applied: false,
      spriteMode: 'pending-one-time-canonical-restore',
      atMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    };
    return true;
  };
  window.ShoulderPetObservationFlip = Object.freeze({
    applyAtPinnedPerch: applyShoulderPetObservationAtPinnedPerch, // One-time compatibility cleanup for avatars created by an older hot-reloaded mirrored build.
    recordPose: recordShoulderPetPose, // Called only when a multi-second sustained pose hold is selected; replaces the old 250ms scan/property instrumentation.
    getDebug: () => {
      const lastPose = shoulderPetObservationFlipRuntime.lastPose ? { ...shoulderPetObservationFlipRuntime.lastPose } : null;
      if (lastPose) delete lastPose.pet;
      return { poseRollCount: shoulderPetObservationFlipRuntime.poseRollCount, lastPose };
    },
    formatDebug: () => {
      const d = window.ShoulderPetObservationFlip.getDebug();
      const pose = d.lastPose
        ? `${d.lastPose.creatureKey}:${d.lastPose.facingInward ? 'inward/front-foreground' : 'outward/back-foreground'}`
        : 'none';
      const chance = d.lastPose ? `${Math.round((Number(d.lastPose.inwardChance) || 0) * 100)}%inward` : 'none';
      const hold = Number.isFinite(d.lastPose?.holdSeconds) ? d.lastPose.holdSeconds.toFixed(1) + 's' : '-';
      return `Shoulder pet sustained pose: rolls=${d.poseRollCount} last=${pose} chance=${chance} hold=${hold}`;
    },
  });

})();
