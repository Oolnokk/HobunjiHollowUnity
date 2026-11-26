'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/config/attachment-rig-profiles.js'), 'utf8');
const handShoulderSource = fs.readFileSync(path.join(root, 'docs/config/hand-shoulder-points.js'), 'utf8');
const storageValues = new Map(); // Used by the real hand-shoulder config load below without introducing browser-only globals.
const localStorage = {
  getItem(key) { return storageValues.has(key) ? storageValues.get(key) : null; },
  setItem(key, value) { storageValues.set(key, String(value)); },
  removeItem(key) { storageValues.delete(key); },
};
const sandbox = {
  localStorage,
  window: {
    localStorage,
    SCRATCHBONES_CONFIG: {
      game: {
        appearanceEditor: { species: {} },
        assets: {
          pngPlaneAvatar: {
            behindView: { headUrls: {} },
            portraitScaleBySpecies: {},
            portraitVerticalPlacement: {},
            proceduralFeet: { footScale: { default: 1 } },
          },
        },
      },
    },
  },
};
vm.runInNewContext(source, sandbox, { filename: 'attachment-rig-profiles.js' });

const w = sandbox.window;
const profiles = w.HOBUNJI_ATTACHMENT_RIG_PROFILES;
const master = w.HOBUNJI_ATTACHMENT_RIG_MASTER;
const guard = w.HOBUNJI_ATTACHMENT_RIG_MASTER_GUARD;
assert(master && profiles && guard, 'master config, runtime profiles, and export guard must install');
assert.strictEqual(master.version, 'hobunji-attachment-rig-master-2026-09-03-v2', 'corrected shoulder baseline must use a new versioned autosave namespace');
assert.strictEqual(profiles.characters['rakakoan::male'], profiles.characters['kenkari::male'], 'Rakakoan must remain a live Kenkari alias');
assert.strictEqual(profiles.characters['ghoul::female'], profiles.characters['mao-ao::female'], 'Ghoul must remain a live Mao-ao alias');

// Latest intentional character field families.
assert(Math.abs(profiles.characters['mao-ao::male'].anchors.leftHandShoulder.position.x - 0.19067248465844266) < 1e-12, 'Mao-ao male left shoulder must retain the exact post-calibration v9 authoring');
assert(Math.abs(profiles.characters['mao-ao::male'].anchors.leftHandShoulder.position.y - 0.6947557240731601) < 1e-12, 'Mao-ao male shoulder Y must retain the exact post-calibration v9 authoring');
assert.strictEqual(profiles.characters['mao-ao::male'].handShoulderRule.positionScaleApplied, 1, 'v9 shoulders must not receive a second 0.9 scale');
assert.strictEqual(profiles.characters['mao-ao::male'].posteriorRule.heightPercentFromFloor, 25, 'Mao-ao male posterior must sit 20% of portrait height below its portrait-plane bottom');
assert.strictEqual(profiles.characters['mao-ao::female'].anatomy.portraitScale, 0.8, 'latest authored Mao-ao female body scale must remain authoritative');
assert.strictEqual(profiles.characters['mashtzarr::male'].anatomy.portraitScale, 1.18, 'latest authored Mashtzarr male body scale must remain authoritative');
assert.strictEqual(profiles.characters['engh-sho::male'].anchors.shoulderPerch.position.y, 0.7000103424366998, 'November 14 authored Engh-sho perch matches the right-hand shoulder target');

// Shoulder-pet scales are fixed values based ONLY on the final adult world-space
// portrait-plane dimensions. They must not inherit the unrelated attack-orbit scale.
const authoredPerchScales = { // Fixed canonical per-gender scales from the Mao-ao male world-portrait reference.
  'tletingan::male': 0.957582, 'tletingan::female': 1.016629,
  'engh-sho::male': 0.896974, 'engh-sho::female': 0.950541,
  'mao-ao::male': 1, 'mao-ao::female': 0.972531,
  'kenkari::male': 1.217687, 'kenkari::female': 1.093433,
  'mashtzarr::male': 1.712158, 'mashtzarr::female': 1.563862,
};
const snapshotSource = fs.readFileSync(path.join(root, 'docs/js/attachment-rig-latest-authored-snapshot-core.js'), 'utf8'); // Latest authored portraitScale values override the older master.
const serializedSnapshot = snapshotSource.match(/const OVERRIDES = (\{.*?\});\s*const ALIASES/s); // Parses only the literal authored JSON, not browser code.
assert(serializedSnapshot, 'latest portrait authoring must be readable');
const latestSnapshot = JSON.parse(serializedSnapshot[1]); // Per-gender production portrait-plane multipliers.
vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/config/character-rig-scale-defaults.js'), 'utf8'), sandbox); // Loads actual static rig X/Y defaults.
const rigDefaults = w.HobunjiCharacterRigScaleDefaults; // Used ONLY in regression calculations, never in a runtime perch getter.
const reference = rigDefaults.scaleFor('mao-ao', 'male'); // Mao-ao male retains its original 1x perch as the reference.
const referencePortraitScale = Number(latestSnapshot['mao-ao::male'].anatomy.portraitScale); // Reference portrait multiplier used to form world width/height.
const referenceArea = (0.9 * referencePortraitScale) ** 2 * reference.x * reference.y; // World-portrait plane width × height of the reference.
for (const [key, authored] of Object.entries(authoredPerchScales)) {
  const profile = profiles.characters[key]; // Real canonical profile whose perch was reauthored without moving the hand target.
  const [species, gender] = key.split('::'); // Looks up the correct two-axis world-space parent size.
  const rig = rigDefaults.scaleFor(species, gender); // World-space portrait X/Y factors, excluding head/hands/feet/orbit.
  const portraitScale = Number(latestSnapshot[key]?.anatomy?.portraitScale ?? profile.anatomy.portraitScale); // Actual configured portrait-plane size.
  const worldArea = (0.9 * portraitScale) ** 2 * rig.x * rig.y; // Same plane width × height reported by CharacterDimensions.portraitPlane.
  const predicted = Math.sqrt(worldArea / referenceArea); // Test-only authoring formula (not a runtime resizing rule).
  assert(Math.abs(predicted - authored) < 0.000001, `${key} perch scale must be authored solely from portrait world dimensions`);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(profile.anchors.shoulderPerch.position)),
    JSON.parse(JSON.stringify(profile.anchors.rightHandShoulder.position)), `${key} shoulder perch must match the right-hand shoulder XYZ`);
  for (const axis of ['x', 'y', 'z']) {
    assert.strictEqual(profile.anchors.shoulderPerch.scale[axis], authored, `${key} ${axis} must use the world-portrait-authored perch scale`);
  }
}

// Nohuknuk has an independent male bipedal-monster rig and a native 1x attack orbit.
const nohuknukRig = profiles.characters['nohuknuk::male'];
assert.deepStrictEqual(JSON.parse(JSON.stringify(nohuknukRig.anchors.shoulderPerch.position)), JSON.parse(JSON.stringify(nohuknukRig.anchors.rightHandShoulder.position)), 'Nohuknuk shoulder pet grip must match his own right shoulder');
assert.deepStrictEqual(JSON.parse(JSON.stringify(nohuknukRig.anchors.shoulderPerch.scale)), { x: 1, y: 1, z: 1 }, 'Nohuknuk must not inherit the Engh-sho 0.7x grip scale');

const expectedPosteriorFloorPercents = {
  'tletingan::male': -5.5,
  'engh-sho::male': 30.5,
  'mao-ao::male': 25,
  'mao-ao::female': 22.5,
  'kenkari::male': -19,
  'kenkari::female': -19,
  'tletingan::female': -8,
  'mashtzarr::male': 5.5,
  'mashtzarr::female': 9,
  'engh-sho::female': 27.5,
};
for (const [key, expected] of Object.entries(expectedPosteriorFloorPercents)) {
  const profile = profiles.characters[key];
  assert.strictEqual(profile.posteriorRule.heightPercentFromFloor, expected, `${key} posterior floor percent must match the manually-calculated preview value`);
  assert(Math.abs(expected - (((profile.anatomy.portraitVerticalPlacementRatio - 0.5) * 100) - 20)) < 1e-12,
    `${key} posterior must be exactly 20% of portrait height below the live portrait-plane bottom`);
}

const rigMath = w.HOBUNJI_ATTACHMENT_RIG_MATH;
const maoMale = profiles.characters['mao-ao::male'];
const maoPosteriorY = rigMath.characterPosteriorY(maoMale.posteriorRule, 0.9, 0.45);
const maoLeftReach = rigMath.characterArmLength(maoMale, 0.9, 0.45, 'left');
const expectedMaoLeftReach = Math.hypot(maoPosteriorY - maoMale.anchors.leftHandShoulder.position.y, maoMale.anchors.leftHandShoulder.position.z);
assert(Math.abs(maoLeftReach - expectedMaoLeftReach) < 1e-12, 'character arm reach must be derived from the authored shoulder to resting-wrist rig geometry');
assert.notStrictEqual(maoLeftReach, 0.558, 'character arm reach must remain geometry-derived rather than returning the copied legacy constant verbatim');
const maoChildLeftReach = rigMath.characterArmLength(
  maoMale, 0.45, 0.225, 'left', 0.5, maoMale.anatomy.portraitVerticalPlacementRatio,
);
assert(Math.abs(maoChildLeftReach - maoLeftReach * 0.5) < 1e-12,
  'child portrait scaling must shrink shoulder and wrist together instead of making the cached arm reach longer');
assert.strictEqual(
  rigMath.characterArmLength(profiles.characters['rakakoan::male'], 0.9 * profiles.characters['kenkari::male'].anatomy.portraitScale, 0.4, 'left'),
  rigMath.characterArmLength(profiles.characters['kenkari::male'], 0.9 * profiles.characters['kenkari::male'].anatomy.portraitScale, 0.4, 'left'),
  'Rakakoan must currently share Kenkari arm geometry exactly',
);

// Latest intentional creature field families and the duplicate defaults table must agree.
assert.strictEqual(profiles.creatures.drenkirra.anchors.shoulderGrip.position.y, -0.11914729549653388, 'August 28 Drenkirra shoulder grip must remain authoritative');
assert.strictEqual(profiles.creatures.drenkirra.anchors.shoulderGrip.rotationDeg.y, 61, 'Drenkirra authored grip must reverse the whole-pet Y angle');
assert.strictEqual(profiles.creatures.puktuk.anchors.shoulderGrip.rotationDeg.y, -61, 'Puktuk retains its original grip Y rotation');
assert.strictEqual(profiles.creatures.uumkaoii.anchors.shoulderGrip.rotationDeg.y, 0, 'Uumkaoii still has a neutral authored grip Y');
assert.strictEqual(-profiles.creatures.drenkirra.anchors.shoulderGrip.rotationDeg.y, -61, 'the attachment solver inverse yields negative 61 degree root yaw before player head rotation');
assert.strictEqual(profiles.creatureShoulderGripDefaults.drenkirra.y, -0.11914729549653388, 'shoulderGrip defaults must not retain the older stale coordinate');
assert.strictEqual(profiles.creatures.drenkirra.sizeScales.small.x, 0.9, 'current Drenkirra small scale must remain 0.9');
assert.deepStrictEqual(JSON.parse(JSON.stringify(profiles.creatures.drenkirra.anchors.saddle.position)), { x: 0, y: 0.030605877381859603, z: 0.02 }, 'October 17 Drenkirra saddle must remain authoritative');
assert.deepStrictEqual(JSON.parse(JSON.stringify(profiles.creatures.grehlr.anchors.saddle.position)), { x: 0, y: 0.1224031140623686, z: 0 }, 'October 17 Grehlr saddle must remain authoritative');
assert.deepStrictEqual(JSON.parse(JSON.stringify(profiles.creatures['gar-wolf'].anchors.saddle.position)), { x: 0, y: 0.15973815894365057, z: 0.3293044388176616 }, 'October 17 Gar-wolf saddle must remain authoritative');
assert.deepStrictEqual(JSON.parse(JSON.stringify(profiles.creatures['dabinggi-hound'].anchors.saddle.position)), { x: 0, y: 0.17901245841201874, z: 0.6091387381509006 }, 'October 17 Dabinggi-hound saddle must remain authoritative');
assert.deepStrictEqual(JSON.parse(JSON.stringify(profiles.creatures.uumkaoii.anchors.saddle.position)), { x: 0, y: 0.2575246358178592, z: 0.005623701988496838 }, 'October 22 Uumkaoii saddle is the latest approved calibration');
assert.deepStrictEqual(JSON.parse(JSON.stringify(profiles.creatures.puktuk.anchors.saddle.position)), { x: 0, y: 0.1830394938019193, z: -0.012420318741466083 }, 'October 17 Puktuk saddle must remain authoritative');
assert.deepStrictEqual(JSON.parse(JSON.stringify(profiles.creatures['voorg-ass'].anchors.saddle.position)), { x: -0.0016655977917167481, y: 0.18328943170147868, z: 0.043832914384796626 }, 'October 17 Voorg-Ass saddle must remain authoritative');
assert.match(source, /Object\.entries\(staleCreatureSaddles\)[\s\S]*?stale\.push\(`\$\{kind\}\.saddle`\)/, 'Animation Author stale-profile repair must recognize the superseded saddle defaults');

// Reconcile the exact corruption patterns introduced by v1 and the older v9 bulk export.
const old = JSON.parse(JSON.stringify(profiles));
const oldDrenkirraYaw = JSON.parse(JSON.stringify(profiles)); // Simulates an existing editor autosave authored before the Y-direction correction.
oldDrenkirraYaw.creatures.drenkirra.anchors.shoulderGrip.rotationDeg.y = -61;
const migratedYaw = guard.reconcileProfiles(oldDrenkirraYaw); // The exact old stock grip yaw is upgraded without touching its XYZ, scale, or other species.
assert.strictEqual(migratedYaw.creatures.drenkirra.anchors.shoulderGrip.rotationDeg.y, 61, 'stale Drenkirra -61 degree yaw migrates to +61 degree');
assert.deepStrictEqual(migratedYaw.creatures.drenkirra.anchors.shoulderGrip.position, profiles.creatures.drenkirra.anchors.shoulderGrip.position, 'yaw migration never changes the grip socket position');
assert.strictEqual(migratedYaw.creatures.puktuk.anchors.shoulderGrip.rotationDeg.y, -61, 'reconciliation preserves other species yaw');
const customDrenkirraYaw = JSON.parse(JSON.stringify(oldDrenkirraYaw)); // Validates that a deliberately moved grip retains its independent rotation.
customDrenkirraYaw.creatures.drenkirra.anchors.shoulderGrip.position.x += 0.013;
const preservedCustomYaw = guard.reconcileProfiles(customDrenkirraYaw);
assert.strictEqual(preservedCustomYaw.creatures.drenkirra.anchors.shoulderGrip.rotationDeg.y, -61, 'custom Drenkirra grip may retain its intentional negative Y authoring');
const legacyDrenkirraEditedRotation = JSON.parse(JSON.stringify(profiles)); // Regression: stale stock grip position and intentional custom rotation must coexist safely.
const oldSocket = legacyDrenkirraEditedRotation.creatures.drenkirra.anchors.shoulderGrip;
oldSocket.position = { x: 0.01, y: -0.1636307385658067, z: 0.0009131708735385657 };
oldSocket.rotationDeg = { x: 9, y: 17, z: -4 };
oldSocket.scale = { x: 0.8, y: 0.9, z: 1 };
const preservedOldSocket = guard.reconcileProfiles(legacyDrenkirraEditedRotation).creatures.drenkirra.anchors.shoulderGrip;
assert.deepStrictEqual(preservedOldSocket.position, profiles.creatures.drenkirra.anchors.shoulderGrip.position, 'outdated stock XYZ migrates to current approved Drenkirra grip');
assert.deepStrictEqual(JSON.parse(JSON.stringify(preservedOldSocket.rotationDeg)), { x: 9, y: 17, z: -4 }, 'custom Y/X/Z rotation survives even when legacy XYZ needs migration');
assert.deepStrictEqual(JSON.parse(JSON.stringify(preservedOldSocket.scale)), { x: 0.8, y: 0.9, z: 1 }, 'custom grip scale survives legacy XYZ migration');
const oldSocketWithStockYaw = JSON.parse(JSON.stringify(legacyDrenkirraEditedRotation));
oldSocketWithStockYaw.creatures.drenkirra.anchors.shoulderGrip.rotationDeg.y = -61;
const correctedOldSocket = guard.reconcileProfiles(oldSocketWithStockYaw).creatures.drenkirra.anchors.shoulderGrip;
assert.deepStrictEqual(JSON.parse(JSON.stringify(correctedOldSocket.rotationDeg)), { x: 9, y: 61, z: -4 }, 'only the obsolete stock -61 yaw is upgraded, without erasing custom X/Z');
const newDrenkirraYaw = JSON.parse(JSON.stringify(profiles)); // Checks that previously corrected +61 degree values remain stable under repeated reconciliation.
assert.strictEqual(guard.reconcileProfiles(newDrenkirraYaw).creatures.drenkirra.anchors.shoulderGrip.rotationDeg.y, 61, 'canonical Y rotation must not migrate twice');
old.characters['mao-ao::male'].posteriorRule.heightPercentFromFloor = 0;
old.characters['mao-ao::male'].anchors.leftHandShoulder.position = { x: 0.1716052361925984, y: 0.6252801516658442, z: 0 };
old.characters['mao-ao::male'].anchors.shoulderPerch.position = { x: -0.29650716367602115, y: 0.6473130571424927, z: 0 };
old.creatures.drenkirra.anchors.shoulderGrip.position = { x: 0.01, y: -0.1636307385658067, z: 0.003984738737597559 };
old.creatures.drenkirra.anchors.saddle.position = { x: 0, y: 0.09289353489875796, z: 0.02 };
old.creatures.grehlr.anchors.saddle.position = { x: 0, y: 0.12393333333333335, z: 0 };
old.creatures['gar-wolf'].anchors.saddle.position = { x: 0, y: 0.14184834174882754, z: 0.2761841625577698 };
old.creatures['dabinggi-hound'].anchors.saddle.position = { x: 0, y: 0.12212625800404886, z: 0.6091387381509006 };
old.creatures.uumkaoii.anchors.saddle.position = { x: 0, y: 0.26595632314682005, z: 0.02 };
old.creatures.puktuk.anchors.saddle.position = { x: 0, y: 0.16937859550590686, z: -0.012420318741466083 };
old.creatures['voorg-ass'].anchors.saddle.position = { x: -0.0016655977917167481, y: 0.12286908956931555, z: 0.043832914384796626 };
const repaired = guard.reconcileProfiles(old);
assert.strictEqual(repaired.characters['mao-ao::male'].posteriorRule.heightPercentFromFloor, 25, 'zero v9 posterior must repair to the 20%-below-portrait calibration');
assert(Math.abs(repaired.characters['mao-ao::male'].anchors.leftHandShoulder.position.x - 0.19067248465844266) < 1e-12, 'double-scaled v1 shoulder must be repaired to exact v9 authoring');
assert.strictEqual(repaired.characters['mao-ao::male'].anchors.shoulderPerch.position.x, -0.28087406205430004, 'stale v9 perch must be repaired to the master right-hand shoulder target');
assert.strictEqual(repaired.creatures.drenkirra.anchors.shoulderGrip.position.y, -0.11914729549653388, 'stale v9 grip must be repaired');
for (const kind of ['drenkirra', 'grehlr', 'gar-wolf', 'dabinggi-hound', 'uumkaoii', 'puktuk', 'voorg-ass']) {
  assert.deepStrictEqual(repaired.creatures[kind].anchors.saddle.position, profiles.creatures[kind].anchors.saddle.position, `${kind} superseded default saddle must migrate to the October 17 authoring`);
}


// November 16 export and November 24 Voorg-ass grip-only update: animal-only updates. Character/NPC anatomy and posterior data from the same export are deliberately excluded.
const novemberAnimalAuthoring = {"gar-wolf":{"grip":{"x":0.01,"y":-0.14097888312228624,"z":0.07486897921502367},"small":{"x":0.28,"y":0.34}},"dabinggi-hound":{"grip":{"x":-0.16036566987282258,"y":-0.12636677592420467,"z":0.12410100452746164},"small":{"x":0.35,"y":0.35}},"drenkirra":{"grip":{"x":-0.0036970156287619823,"y":-0.11914729549653388,"z":0.09707381568917758},"small":{"x":0.9,"y":0.9}},"puktuk":{"grip":{"x":0,"y":-0.257,"z":0.034273761545456985},"small":{"x":0.28,"y":0.28}},"voorg-ass":{"grip":{"x":0,"y":-0.27834423457602814,"z":0.051543592657975104},"small":{"x":0.34,"y":0.34}},"nelk":{"grip":{"x":0.05838103969211583,"y":-0.06616055534830413,"z":0.05330590874914502},"small":{"x":0.44,"y":0.44}},"nazgraku":{"grip":{"x":-0.010120303229480966,"y":-0.112,"z":0.04704726667943677},"small":{"x":0.5,"y":0.5}},"uumkaoii":{"grip":{"x":0,"y":-0.2057328849409156,"z":-0.004605298975405354},"small":{"x":0.24,"y":0.24}},"moot":{"grip":{"x":0,"y":-0.09985368986154525,"z":0.1},"small":{"x":0.35,"y":0.35},"saddle":{"x":0,"y":0.1892393302917481,"z":0.02},"large":{"x":1,"y":1},"medium":{"x":0.75,"y":0.75}}}; // Exact approved creature shoulders and Small sizes from the supplied rig JSON.
for (const [kind, expected] of Object.entries(novemberAnimalAuthoring)) {
  const animal = profiles.creatures[kind]; // Checks shared gameplay defaults used by Animation Author, without replacing any character fields.
  assert(animal, kind + ' must be present in canonical runtime rig profiles');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(animal.anchors.shoulderGrip.position)), expected.grip, kind + ' November 16 shoulder grip');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(animal.sizeScales.small)), expected.small, kind + ' November 16 Small size');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(animal.sizeScalePercentages.small)), {
    x: expected.small.x * 100, y: expected.small.y * 100,
  }, kind + ' Small percent controls match the numeric size');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(profiles.creatureShoulderGripDefaults[kind])), expected.grip, kind + ' duplicated grip defaults follow the master');
  if (kind === 'moot') {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(animal.anchors.saddle.position)), expected.saddle, 'Moot uses its own authored saddle');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(animal.sizeScales.large)), expected.large, 'Moot Large scale is not inherited from Voorg-ass');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(animal.sizeScales.medium)), expected.medium, 'Moot Medium scale is independent');
  }
}
// New November 16 Rig Coordinates import: use exact species-authored data, not the older Pingdort 1x floor/scale fallback.
const plainAnimalRig = value => JSON.parse(JSON.stringify(value)); // Normalizes cross-realm VM objects for these strict data-only assertions.
const expectedSkeeriChathead = { x: 0.6611149088541667, y: 0.24899449865398673, width: 0.04, height: 0.04, coordinateSpace: 'sprite-normalized-top-left', version: 1 }; // Canonical crop shared by all three Skeeri kinds.
const expectedMootChathead = { x: 0.10526108108108108, y: 0.0923913043478261, width: 0.3246486486486486, height: 0.4021739130434782, coordinateSpace: 'sprite-normalized-top-left', version: 1 }; // Newly approved Moot idle-sprite crop.
const pingdort = profiles.creatures.pingdort; // Check the independent bird baseline instead of the old native-foot scaled default.
assert.deepStrictEqual(plainAnimalRig(pingdort.anchors.saddle), { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, 'Pingdort uses the authored neutral saddle anchor');
assert.deepStrictEqual(plainAnimalRig(pingdort.anchors.shoulderGrip.position), { x: 0, y: -0.05596633162050327, z: 0.06962064405051654 }, 'Pingdort shoulder grip XYZ matches export');
assert.deepStrictEqual(plainAnimalRig(pingdort.groundOffsets), { large: 0.14842300556586271, medium: 0.218, small: 0.07 }, 'Pingdort floor lifts are independently authored by size');
assert.deepStrictEqual(plainAnimalRig(pingdort.sizeScales), { large: { x: 3.5, y: 3.5 }, medium: { x: 1.75, y: 1.75 }, small: { x: 1, y: 1 } }, 'Pingdort scale table matches new export');
assert.deepStrictEqual(plainAnimalRig(pingdort.sizeScalePercentages), { large: { x: 350, y: 350 }, medium: { x: 175, y: 175 }, small: { x: 100, y: 100 } }, 'Pingdort percentage controls mirror its authored size classes');
assert.deepStrictEqual(plainAnimalRig(pingdort.saddleRule), {}, 'Pingdort neutral saddle rule is preserved from export');
assert.strictEqual(pingdort.chatheadFrame, null, 'Pingdort has no authored chathead crop');
assert.strictEqual(pingdort.shoulderGripRule.authoredFixed, true, 'Pingdort fixed shoulder metadata remains intact');
assert.strictEqual(pingdort.creatureShoulderGripDefaultVersion, 4, 'Pingdort latest exported grip-version metadata wins');
assert.deepStrictEqual(plainAnimalRig(profiles.creatureShoulderGripDefaults.pingdort), plainAnimalRig(pingdort.anchors.shoulderGrip.position), 'runtime shoulder grip default matches Pingdort canonical rig');

const skeeriSizeScales = { large: { x: 1.5, y: 1.5 }, medium: { x: 1, y: 1 }, small: { x: 0.35, y: 0.35 } }; // The Medium Skeeri's independent authored size multipliers are unchanged.
const skeeriNativeWidths = { small: 0.65, medium: 1.15, large: 2.2 }; // Native model widths define the correct ratio for ground Y rather than Pingdort's unrelated size scales.
const skeeriSmallGroundY = pingdort.groundOffsets.small; // Approved Pingdort Small ground Y is the common baseline for all Skeeri.
const expectedSkeeriGround = { // Verifies the source Small Y is scaled to Medium/Large by Skeeri's native widths.
  large: skeeriSmallGroundY * (skeeriNativeWidths.large / skeeriNativeWidths.small),
  medium: skeeriSmallGroundY * (skeeriNativeWidths.medium / skeeriNativeWidths.small),
  small: skeeriSmallGroundY,
};
const expectedMediumSkeeriGround = { large: 0.375, medium: 0.26, small: 0.1 }; // The Medium sprite has independent floor calibrations from the November 22 export.
const neutralSkeeriSizeScales = { large: { x: 1, y: 1 }, medium: { x: 1, y: 1 }, small: { x: 1, y: 1 } }; // Fixed-width ruin varieties remain unscaled.
const domesticSkeeriSizeScales = { // A domestic Small sprite must grow into Medium/Large in step with the exact floor-lift ratio.
  large: { x: skeeriNativeWidths.large / skeeriNativeWidths.small, y: skeeriNativeWidths.large / skeeriNativeWidths.small },
  medium: { x: skeeriNativeWidths.medium / skeeriNativeWidths.small, y: skeeriNativeWidths.medium / skeeriNativeWidths.small },
  small: { x: 1, y: 1 },
};
for (const kind of ['skeeri', 'skeeri-small', 'skeeri-medium', 'skeeri-large']) {
  const skeeri = profiles.creatures[kind]; // The domestic and three ruin kinds must have independent canonical attachment profiles.
  assert(skeeri, kind + ' has a canonical rig profile');
  assert.strictEqual(skeeri.kind, kind, kind + ' retains its own species key');
  assert.deepStrictEqual(plainAnimalRig(skeeri.chatheadFrame), expectedSkeeriChathead, kind + ' shares the approved idle-frame chathead crop');
  assert.deepStrictEqual(plainAnimalRig(skeeri.anchors.shoulderGrip), plainAnimalRig(pingdort.anchors.shoulderGrip), kind + ' copies Pingdort\'s full grip, including yaw and scale');
  assert.deepStrictEqual(plainAnimalRig(skeeri.groundOffsets), kind === 'skeeri-medium' ? expectedMediumSkeeriGround : expectedSkeeriGround, kind + ' uses its own authored ground calibration');
  assert.deepStrictEqual(plainAnimalRig(profiles.creatureShoulderGripDefaults[kind]), plainAnimalRig(pingdort.anchors.shoulderGrip.position), kind + ' runtime duplicate defaults use the new grip');
  assert.deepStrictEqual(plainAnimalRig(skeeri.sizeScales), kind === 'skeeri-medium' ? skeeriSizeScales : kind === 'skeeri' ? domesticSkeeriSizeScales : neutralSkeeriSizeScales, kind + ' keeps native ruin sizes while scaling domestic inherited size with ground Y');
  assert.deepStrictEqual(plainAnimalRig(skeeri.saddleRule), {}, kind + ' retains its empty saddle rule');
  assert.deepStrictEqual(plainAnimalRig(skeeri.shoulderGripRule), {}, kind + ' retains its empty shoulder rule');
  const percentSizes = Object.fromEntries(Object.entries(skeeri.sizeScales).map(([size, scale]) => [size, { x: scale.x * 100, y: scale.y * 100 }])); // Mirror the uploaded size percentages from each independent Skeeri profile.
  assert.deepStrictEqual(plainAnimalRig(skeeri.sizeScalePercentages), percentSizes, kind + ' percent controls mirror its own size scales');
  assert.strictEqual(skeeri.creatureShoulderGripDefaultVersion, 4, kind + ' retains the exported grip-default version');
  if (kind === 'skeeri-medium') {
    assert.deepStrictEqual(plainAnimalRig(skeeri.anchors.saddle.position), { x: 0, y: 0.12801484107971195, z: 0.02 }, 'Medium Skeeri keeps its independent saddle coordinates');
  } else {
    assert.deepStrictEqual(plainAnimalRig(skeeri.anchors.saddle.position), { x: 0, y: 0, z: 0 }, kind + ' does not copy Medium Skeeri\'s saddle');
  }
}
const importedSkeeriVariants = guard.reconcileProfiles({ creatures: {
  'skeeri-small': { kind: 'skeeri-small', chatheadFrame: null, sizeScales: { small: { x: .22, y: .24 } }, marker: 'unchanged-small' },
  'skeeri-large': { kind: 'skeeri-large', chatheadFrame: null, sizeScales: { large: { x: 1.9, y: 2.2 } }, marker: 'unchanged-large' },
} }).creatures; // Older independent editor rig rows retain their own custom scale fields while gaining the approved grip and floor calibration.
for (const kind of ['skeeri-small', 'skeeri-large']) {
  assert.deepStrictEqual(plainAnimalRig(importedSkeeriVariants[kind].chatheadFrame), expectedSkeeriChathead, kind + ' null legacy head frame repairs to the shared crop');
  assert.strictEqual(importedSkeeriVariants[kind].marker, 'unchanged-' + kind.split('-')[1], kind + ' unknown custom fields survive authoring');
  assert.deepStrictEqual(plainAnimalRig(importedSkeeriVariants[kind].anchors.shoulderGrip.position), plainAnimalRig(pingdort.anchors.shoulderGrip.position), kind + ' missing legacy grip receives canonical Pingdort values');
  assert.deepStrictEqual(plainAnimalRig(importedSkeeriVariants[kind].groundOffsets), expectedSkeeriGround, kind + ' missing floor table receives the calibrated values');
}
assert.deepStrictEqual(plainAnimalRig(importedSkeeriVariants['skeeri-small'].sizeScales), { small: { x: .22, y: .24 } }, 'Small Skeeri keeps an independently authored size row');
assert.deepStrictEqual(plainAnimalRig(importedSkeeriVariants['skeeri-large'].sizeScales), { large: { x: 1.9, y: 2.2 } }, 'Large Skeeri keeps an independently authored size row');
for (const kind of ['skeeri', 'skeeri-small', 'skeeri-medium', 'skeeri-large']) {
  const legacy = plainAnimalRig(profiles.creatures[kind]); // Old stock floor zeros can be present even when the editor has other valid authored fields.
  legacy.groundOffsets = { large: 0, medium: 0, small: 0 };
  if (kind === 'skeeri-medium') legacy.anchors.shoulderGrip.position = { x: 0, y: -0.16357451915740964, z: 0 }; // Exact retired Medium Skeeri grip only.
  const migrated = guard.reconcileProfiles({ creatures: { [kind]: legacy } }).creatures[kind];
  assert.deepStrictEqual(plainAnimalRig(migrated.groundOffsets), kind === 'skeeri-medium' ? expectedMediumSkeeriGround : expectedSkeeriGround, kind + ' obsolete zero floor table migrates');
  assert.deepStrictEqual(plainAnimalRig(migrated.anchors.shoulderGrip.position), plainAnimalRig(pingdort.anchors.shoulderGrip.position), kind + ' old grip receives approved coordinates');
  const custom = plainAnimalRig(legacy); // A later hand-authored grip or positive floor table must not be mistaken for an obsolete stock value.
  custom.groundOffsets.small = 0.123;
  custom.anchors.shoulderGrip.position = { x: 0.01, y: -0.13, z: 0.03 };
  const retained = guard.reconcileProfiles({ creatures: { [kind]: custom } }).creatures[kind];
  assert.deepStrictEqual(plainAnimalRig(retained.groundOffsets), custom.groundOffsets, kind + ' preserves a custom floor offset table');
  assert.deepStrictEqual(plainAnimalRig(retained.anchors.shoulderGrip.position), custom.anchors.shoulderGrip.position, kind + ' preserves a custom shoulder grip');
}
assert.deepStrictEqual(plainAnimalRig(profiles.creatures.moot.chatheadFrame), expectedMootChathead, 'Moot chathead frame is authored, not borrowed from another animal');
const roundTripAnimalRig = guard.reconcileProfiles({ characters: {}, creatures: {} }).creatures; // Checks authoring imports with no prior animal profiles get the approved defaults.
for (const kind of ['pingdort', 'skeeri', 'skeeri-small', 'skeeri-medium', 'skeeri-large', 'moot']) {
  assert.deepStrictEqual(plainAnimalRig(roundTripAnimalRig[kind]), plainAnimalRig(profiles.creatures[kind]), kind + ' master guard preserves the exact newly approved profile');
}
vm.runInNewContext(fs.readFileSync(path.join(root, 'docs/js/animal-chathead-frame.js'), 'utf8'), sandbox, { filename: 'animal-chathead-frame.js' });
for (const kind of ['skeeri-small', 'skeeri-medium', 'skeeri-large', 'moot']) {
  const resolved = sandbox.window.AnimalChatheadFrame.frameForKind(kind); // Uses the real dialogue crop resolver rather than only master metadata.
  assert.strictEqual(resolved.source, 'attachment-rig-profile', kind + ' dialogue reads the canonical chathead frame');
  assert.deepStrictEqual(plainAnimalRig(resolved.frame), kind === 'moot' ? expectedMootChathead : expectedSkeeriChathead, kind + ' dialogue crop matches the rig data');
}

// Prior static Pingdort defaults must not silently replace the November 16 user export when an old Rig Coordinates autosave is imported.
const oldPingdort = plainAnimalRig(pingdort); // Exact previous built-in profile used for the migration fixture.
oldPingdort.anchors.saddle = null;
oldPingdort.anchors.shoulderGrip.position = { x: 0, y: -0.14842300556586271, z: 0 };
oldPingdort.groundOffsets = { large: 0.14842300556586271, medium: 0.14842300556586271, small: 0.14842300556586271 };
oldPingdort.sizeScales = { large: { x: 1, y: 1 }, medium: { x: 1, y: 1 }, small: { x: 1, y: 1 } };
oldPingdort.sizeScalePercentages = { large: { x: 100, y: 100 }, medium: { x: 100, y: 100 }, small: { x: 100, y: 100 } };
oldPingdort.creatureShoulderGripDefaultVersion = 5;
const migratedPingdort = guard.reconcileProfiles({ creatures: { pingdort: oldPingdort } }).creatures.pingdort; // Editor/game import path for retained browser data.
for (const field of ['anchors', 'sizeScales', 'groundOffsets', 'sizeScalePercentages', 'creatureShoulderGripDefaultVersion']) {
  assert.deepStrictEqual(plainAnimalRig(migratedPingdort[field]), plainAnimalRig(pingdort[field]), 'old Pingdort ' + field + ' migrates without changing the approved export');
}
const customPingdort = plainAnimalRig(oldPingdort); // Independent edits must survive instead of being mistaken for retired defaults.
customPingdort.anchors.shoulderGrip.position.z = 0.017;
customPingdort.sizeScales.large = { x: 1.18, y: 1.2 };
customPingdort.groundOffsets.small = 0.163;
const retainedPingdort = guard.reconcileProfiles({ creatures: { pingdort: customPingdort } }).creatures.pingdort;
assert.deepStrictEqual(plainAnimalRig(retainedPingdort.anchors.shoulderGrip.position), customPingdort.anchors.shoulderGrip.position, 'custom Pingdort grip survives old-default repair');
assert.deepStrictEqual(plainAnimalRig(retainedPingdort.sizeScales.large), customPingdort.sizeScales.large, 'custom Pingdort Large size survives old-default repair');
assert.deepStrictEqual(plainAnimalRig(retainedPingdort.groundOffsets), customPingdort.groundOffsets, 'partially edited Pingdort floor table survives old-default repair');

for (const kind of ['moot', 'skeeri-medium']) {
  const oldProfile = plainAnimalRig(profiles.creatures[kind]); // Old Moot or early Skeeri editors may have a null dialogue crop.
  oldProfile.chatheadFrame = null;
  const repairedProfile = guard.reconcileProfiles({ creatures: { [kind]: oldProfile } }).creatures[kind];
  assert.deepStrictEqual(plainAnimalRig(repairedProfile.chatheadFrame), plainAnimalRig(profiles.creatures[kind].chatheadFrame), kind + ' null legacy chathead is repaired');
  const customProfile = plainAnimalRig(oldProfile); // Preserve user-edited frames.
  customProfile.chatheadFrame = { x: .18, y: .23, width: .22, height: .26, coordinateSpace: 'sprite-normalized-top-left', version: 1 };
  assert.deepStrictEqual(plainAnimalRig(guard.reconcileProfiles({ creatures: { [kind]: customProfile } }).creatures[kind].chatheadFrame), customProfile.chatheadFrame, kind + ' custom chathead survives master import');
}
// Export (31): upgrade both previous stock grips without touching other rig fields.
const previousVoorg = JSON.parse(JSON.stringify(profiles.creatures['voorg-ass']));
previousVoorg.anchors.shoulderGrip.position = { x: 0, y: -0.11122461401165312, z: 0.05961047587703741 };
const updatedVoorg = guard.reconcileProfiles({ creatures: { 'voorg-ass': previousVoorg } }).creatures['voorg-ass'];
assert.deepStrictEqual(plainAnimalRig(updatedVoorg), plainAnimalRig(profiles.creatures['voorg-ass']), 'Voorg-ass previous stock grip migrates without unrelated changes');
previousVoorg.anchors.shoulderGrip.position = { x: 0, y: -0.29318061503235254, z: 0.051543592657975104 };
assert.deepStrictEqual(plainAnimalRig(guard.reconcileProfiles({ creatures: { 'voorg-ass': previousVoorg } }).creatures['voorg-ass']), plainAnimalRig(profiles.creatures['voorg-ass']), 'Voorg-ass export (29) stock grip migrates to export (31)');
previousVoorg.anchors.shoulderGrip.rotationDeg.y = -42;
previousVoorg.anchors.shoulderGrip.scale.x = 0.9;
const editedVoorg = guard.reconcileProfiles({ creatures: { 'voorg-ass': previousVoorg } }).creatures['voorg-ass'];
assert.equal(editedVoorg.anchors.shoulderGrip.rotationDeg.y, -42, 'custom Voorg-ass yaw survives stock position migration');
assert.equal(editedVoorg.anchors.shoulderGrip.scale.x, 0.9, 'custom Voorg-ass grip scale survives stock position migration');
previousVoorg.anchors.shoulderGrip.position.x = 0.02;
assert.deepStrictEqual(plainAnimalRig(guard.reconcileProfiles({ creatures: { 'voorg-ass': previousVoorg } }).creatures['voorg-ass'].anchors.shoulderGrip), previousVoorg.anchors.shoulderGrip, 'custom Voorg-ass position is not overwritten');

const retiredAnimalGrips = {"gar-wolf":{"x":0.01,"y":-0.26545210788556156,"z":0.07486897921502367},"dabinggi-hound":{"x":0.01,"y":-0.20203700498816118,"z":0.09104867302389968},"drenkirra":{"x":0.01,"y":-0.11914729549653388,"z":-0.001096892109713506},"puktuk":{"x":0.01,"y":-0.29715994741785007,"z":-0.0010889163404909086},"voorg-ass":{"x":0.01,"y":-0.33453636625016553,"z":0.0181046276028018},"nelk":{"x":0.030176488041515424,"y":-0.11264054358274966,"z":0.028253979555520257},"nazgraku":{"x":0.011498553593554665,"y":-0.14241261412989242,"z":0.000946211786312177}}; // Exact pre-November 16 canonical grip fingerprints, not broad bounds or guesses.
for (const [kind, position] of Object.entries(retiredAnimalGrips)) {
  const imported = JSON.parse(JSON.stringify(profiles)); // Simulates an existing browser autosave still holding the old grip.
  imported.creatures[kind].anchors.shoulderGrip.position = position;
  const migrated = guard.reconcileProfiles(imported).creatures[kind];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(migrated.anchors.shoulderGrip.position)),
    novemberAnimalAuthoring[kind].grip, kind + ' old stock grip must migrate');
  const custom = JSON.parse(JSON.stringify(imported)); // Deliberately moved positions must remain user-authored.
  custom.creatures[kind].anchors.shoulderGrip.position.x += 0.007;
  assert.strictEqual(guard.reconcileProfiles(custom).creatures[kind].anchors.shoulderGrip.position.x,
    position.x + 0.007, kind + ' customized shoulder grip survives stock migration');
}
const retiredAnimalSmallSizes = {"gar-wolf":{"x":0.35,"y":0.35},"uumkaoii":{"x":0.2,"y":0.2},"puktuk":{"x":0.3,"y":0.3},"voorg-ass":{"x":0.27,"y":0.27},"nelk":{"x":0.35,"y":0.35},"nazgraku":{"x":0.35,"y":0.35}}; // Exact previous canonical Small X/Y, used for narrowly scoped old-autosave repair.
for (const [kind, small] of Object.entries(retiredAnimalSmallSizes)) {
  const imported = JSON.parse(JSON.stringify(profiles)); // Simulates the older editor's unmodified Small-size defaults.
  imported.creatures[kind].sizeScales.small = small;
  imported.creatures[kind].sizeScalePercentages.small = { x: small.x * 100, y: small.y * 100 };
  const migrated = guard.reconcileProfiles(imported).creatures[kind];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(migrated.sizeScales.small)), novemberAnimalAuthoring[kind].small, kind + ' exact old Small size must migrate');
  const custom = JSON.parse(JSON.stringify(imported)); // Only an exact fingerprint can trigger the migration.
  custom.creatures[kind].sizeScales.small.x += 0.013;
  assert.strictEqual(guard.reconcileProfiles(custom).creatures[kind].sizeScales.small.x,
    small.x + 0.013, kind + ' custom creature Small scale survives migration');
}
assert.deepStrictEqual(JSON.parse(JSON.stringify(profiles.creatures['omgurku-lower'].sizeScales.small)), { x: 1, y: 1 },
  'the independent hybrid lower-half rig is not part of the animal-only import');

const stalePosteriorDefaults = JSON.parse(JSON.stringify(profiles));
const supersededPosteriorFloors = {
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
};
for (const [key, value] of Object.entries(supersededPosteriorFloors)) stalePosteriorDefaults.characters[key].posteriorRule.heightPercentFromFloor = value;
const repairedPosteriorDefaults = guard.reconcileProfiles(stalePosteriorDefaults);
for (const key of Object.keys(supersededPosteriorFloors)) {
  assert.strictEqual(repairedPosteriorDefaults.characters[key].posteriorRule.heightPercentFromFloor, profiles.characters[key].posteriorRule.heightPercentFromFloor,
    `${key} exact superseded posterior must migrate to the new preview calibration`);
}

// Reconcile the V15.24 hard-coded creature defaults that run after the shared
// config in Animation Author V15.45. Characters are restored later; creatures
// were not, so these exact fingerprints could otherwise survive into preview.
const v1524 = JSON.parse(JSON.stringify(profiles));
v1524.creatures.drenkirra.anchors.shoulderGrip.position = { x: 0.01, y: -0.1636307385658067, z: 0.0009131708735385657 };
v1524.creatures.drenkirra.sizeScales.small = { x: 1, y: 1 };
v1524.creatures.drenkirra.sizeScalePercentages.small = { x: 100, y: 100 };
v1524.creatures.uumkaoii.anchors.shoulderGrip.position = { x: 0.01, y: -0.5363283597840667, z: -0.012886930890300352 };
const repairedV1524 = guard.reconcileProfiles(v1524);
assert.deepStrictEqual(repairedV1524.creatures.drenkirra.anchors.shoulderGrip.position, profiles.creatures.drenkirra.anchors.shoulderGrip.position, 'V15.24 Drenkirra grip must repair to the shared master');
assert.strictEqual(repairedV1524.creatures.drenkirra.sizeScales.small.x, 0.9, 'V15.24 Drenkirra small scale must repair to 0.9');
assert.strictEqual(repairedV1524.creatures.drenkirra.sizeScalePercentages.small.x, 90, 'repaired Drenkirra small percentage must stay in sync with its multiplier');
assert.deepStrictEqual(repairedV1524.creatures.uumkaoii.anchors.shoulderGrip.position, profiles.creatures.uumkaoii.anchors.shoulderGrip.position, 'V15.24 Uumkaoii grip must repair to the shared master');

// A later, non-fingerprint edit must survive the guard instead of being reset to master.
const edited = JSON.parse(JSON.stringify(profiles));
edited.characters['mao-ao::male'].anchors.leftHandShoulder.position.x += 0.0123;
edited.characters['mao-ao::female'].anatomy.portraitScale = 0.83;
edited.characters['mao-ao::male'].posteriorRule.heightPercentFromFloor = 26.234;
edited.creatures.drenkirra.anchors.saddle.position.y += 0.02;
edited.creatures.drenkirra.sizeScales.small = { x: 0.95, y: 0.95 };
const preserved = guard.reconcileProfiles(edited);
assert(Math.abs(preserved.characters['mao-ao::male'].anchors.leftHandShoulder.position.x - (0.19067248465844266 + 0.0123)) < 1e-12, 'new shoulder authoring must survive master reconciliation');
assert.strictEqual(preserved.characters['mao-ao::female'].anatomy.portraitScale, 0.83, 'new body-scale authoring must survive master reconciliation');
assert.strictEqual(preserved.characters['mao-ao::male'].posteriorRule.heightPercentFromFloor, 26.234, 'non-fingerprint posterior authoring must survive master reconciliation');
assert(Math.abs(preserved.creatures.drenkirra.anchors.saddle.position.y - 0.05060587738185961) < 1e-12, 'new saddle authoring must survive master reconciliation');
assert.strictEqual(preserved.creatures.drenkirra.sizeScales.small.x, 0.95, 'non-fingerprint creature size authoring must survive master reconciliation');

const exported = guard.reconcileRigExport({ schema: 'hobunji.attachment-rig-profiles.v9', profiles: old });
assert.strictEqual(exported.schema, 'hobunji.attachment-rig-profiles.v10', 'master-safe export must use the current rig schema');
assert.strictEqual(exported.masterConfigVersion, master.version, 'master-safe export must record its canonical base version');
assert.strictEqual(exported.profiles.characters['mao-ao::male'].posteriorRule.heightPercentFromFloor, 25, 'export must repair the v9 posterior to the 20%-below-portrait calibration before writing JSON');
assert(Math.abs(exported.profiles.characters['mao-ao::male'].anchors.leftHandShoulder.position.x - 0.19067248465844266) < 1e-12, 'export must repair a v1 double-scaled shoulder');

// Reproduce the actual game/editor load order: attachment master first, then the
// hand-shoulder config loaded by held-action-animations.js. The latter must not
// rewrite attachment coordinates or install another rig recovery/storage layer.
const shoulderBeforeHandBootstrap = JSON.stringify(profiles.characters['mao-ao::male'].anchors.leftHandShoulder.position);
vm.runInNewContext(handShoulderSource, sandbox, { filename: 'hand-shoulder-points.js' });
const shoulderAfterHandBootstrap = JSON.stringify(profiles.characters['mao-ao::male'].anchors.leftHandShoulder.position);
assert.strictEqual(shoulderAfterHandBootstrap, shoulderBeforeHandBootstrap, 'hand-shoulder bootstrap must not mutate the canonical attachment-rig shoulder');
assert.strictEqual(w.HobunjiHandShoulderPoints.keyFor('ghoul', 'female'), 'mao-ao::female', 'Ghoul hand shoulder points must share Mao-ao transforms');
assert.strictEqual(w.HobunjiHandShoulderPoints.keyFor('rakakoan', 'male'), 'kenkari::male', 'Rakakoan hand shoulder points must share Kenkari transforms');
assert.strictEqual(w.HobunjiAttachmentRigRecovery, undefined, 'hand-shoulder config must not own attachment-rig recovery anymore');

const newRigs = {
  nelk: { saddle:[0,0.12365496943656872,0.09343178888117182], grip:[0.05838103969211583,-0.06616055534830413,0.05330590874914502], ground:[0.45,0.25,0.065] },
  nazgraku: { saddle:[0,0.07886458733711826,-0.0022188537422596633], grip:[-0.010120303229480966,-0.112,0.04704726667943677], ground:[0.31,0.2,0.07] },
}; // Regression fixtures preserve October 22 sockets while using the November 22 floor calibrations.
for (const [kind, expected] of Object.entries(newRigs)) {
  const profile = profiles.creatures[kind]; // Runtime rig must contain the authored values without an editor import.
  for (const [anchor, coordinates] of [['saddle',expected.saddle],['shoulderGrip',expected.grip]]) {
    assert.deepStrictEqual(['x','y','z'].map(axis => profile.anchors[anchor].position[axis]), coordinates, kind + ' authored ' + anchor);
  }
  assert.deepStrictEqual(['large','medium','small'].map(size => profile.groundOffsets[size]), expected.ground, kind + ' authored floor offsets');
  const migrated = guard.reconcileProfiles({ creatures: { [kind]: {
    anchors: { saddle: {position:{x:0,y:0,z:0}}, shoulderGrip: {position:{x:0.01,y:0,z:0}} },
    groundOffsets: {large:0,medium:0,small:0}, chatheadFrame:{x:0,y:0,width:0.04,height:0.04},
  } } }).creatures[kind]; // Old browser autosave placeholders must not erase newer authoring.
  assert.deepStrictEqual(['x','y','z'].map(axis => migrated.anchors.saddle.position[axis]), expected.saddle, kind + ' saddle recovery');
  assert.deepStrictEqual(['x','y','z'].map(axis => migrated.anchors.shoulderGrip.position[axis]), expected.grip, kind + ' grip recovery');
  assert.deepStrictEqual(['large','medium','small'].map(size => migrated.groundOffsets[size]), expected.ground, kind + ' floor recovery');
  const custom = guard.reconcileProfiles({ creatures: { [kind]: {groundOffsets:{large:0.41,medium:0.23,small:0.077}} } }).creatures[kind];
  assert.deepStrictEqual(['large','medium','small'].map(size => custom.groundOffsets[size]), [0.41,0.23,0.077], kind + ' preserves newer authored offsets');
}
assert.strictEqual(profiles.creatures.nelk.chatheadFrame.width, 0.3448695403032319, 'Nelk authored head framing');
assert.deepStrictEqual([profiles.creatures.nazgraku.chatheadFrame.x, profiles.creatures.nazgraku.chatheadFrame.y, profiles.creatures.nazgraku.chatheadFrame.width, profiles.creatures.nazgraku.chatheadFrame.height], [0.23705208817610238,0.0587346014031421,0.22574006332431554,0.5112796374724654], 'Nazgraku retains new export (23) framing');
assert.strictEqual(guard.reconcileProfiles({creatures:{nelk:{chatheadFrame:{x:0,y:0,width:0.04,height:0.04}}}}).creatures.nelk.chatheadFrame.width,0.3448695403032319);
assert.strictEqual(guard.reconcileProfiles({creatures:{nazgraku:{chatheadFrame:{x:0,y:0,width:0.04,height:0.04}}}}).creatures.nazgraku.chatheadFrame.width,0.22574006332431554);
const authoredUum = profiles.creatures.uumkaoii; // Compares every newly calibrated Uumkao'ii field with export (23).
assert.deepStrictEqual(['x','y','z'].map(axis => authoredUum.anchors.shoulderGrip.position[axis]), [0,-0.2057328849409156,-0.004605298975405354]);
assert.strictEqual(authoredUum.anchors.shoulderGrip.rotationDeg.y, 0, 'new Uumkaoii grip uses neutral yaw');
assert.deepStrictEqual(['large','medium','small'].map(size => authoredUum.groundOffsets[size]), [0.75,0.25,0.05]);
assert.deepStrictEqual(['x','y','width','height'].map(key => authoredUum.chatheadFrame[key]), [0.022018283422815435,0.180707251642218,0.4241864686175028,0.6442119462386413]);
assert.deepStrictEqual(['x','y'].map(axis => authoredUum.sizeScales.large[axis]), [1.5,1.5], 'Large size stays uniform after fixing the source aspect');
const previousUum = { // Exact former master fingerprints must upgrade on old browser autosaves.
  anchors: {
    saddle: { position: {x:0,y:0.6408071738820479,z:0.02}, rotationDeg:{x:0,y:0,z:0} },
    shoulderGrip: { position: {x:0.01,y:-0.3636087789187775,z:-0.18395679109723}, rotationDeg:{x:0,y:-61,z:0} },
  },
  groundOffsets: {large:0.69,medium:0.48,small:0.09},
  chatheadFrame: {x:0.009564166583519832,y:0.2923510947804583,width:0.4656387672084861,height:0.47038721094834346},
};
const recoveredUum = guard.reconcileProfiles({creatures:{uumkaoii:previousUum}}).creatures.uumkaoii; // Checks per-field migration without modifying unrelated species.
assert.deepStrictEqual(recoveredUum.anchors.saddle.position, authoredUum.anchors.saddle.position);
assert.deepStrictEqual(recoveredUum.anchors.shoulderGrip.position, authoredUum.anchors.shoulderGrip.position);
assert.strictEqual(recoveredUum.anchors.shoulderGrip.rotationDeg.y,0);
assert.deepStrictEqual(recoveredUum.groundOffsets,authoredUum.groundOffsets);
assert.deepStrictEqual(recoveredUum.chatheadFrame,authoredUum.chatheadFrame);
const bespokeUum = guard.reconcileProfiles({creatures:{uumkaoii:{groundOffsets:{large:0.4,medium:0.21,small:0.08},chatheadFrame:{x:0.12,y:0.22,width:0.3,height:0.4}}}}).creatures.uumkaoii; // Never replace future independently authored offsets/crops.
assert.deepStrictEqual(['large','medium','small'].map(size => bespokeUum.groundOffsets[size]),[0.4,0.21,0.08]);
assert.strictEqual(bespokeUum.chatheadFrame.x,0.12);
console.log('attachment rig master tests passed');
