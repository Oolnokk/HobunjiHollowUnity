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
assert.strictEqual(profiles.characters['engh-sho::male'].anchors.shoulderPerch.position.y, 0.6813045758748404, 'August 28 Engh-sho shoulder perch must remain authoritative');

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
assert.strictEqual(repaired.characters['mao-ao::male'].anchors.shoulderPerch.position.x, -0.2006533796199832, 'stale v9 perch must be repaired');
assert.strictEqual(repaired.creatures.drenkirra.anchors.shoulderGrip.position.y, -0.11914729549653388, 'stale v9 grip must be repaired');
for (const kind of ['drenkirra', 'grehlr', 'gar-wolf', 'dabinggi-hound', 'uumkaoii', 'puktuk', 'voorg-ass']) {
  assert.deepStrictEqual(repaired.creatures[kind].anchors.saddle.position, profiles.creatures[kind].anchors.saddle.position, `${kind} superseded default saddle must migrate to the October 17 authoring`);
}


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
  nelk: { saddle:[0,0.12365496943656872,0.09343178888117182], grip:[0.030176488041515424,-0.11264054358274966,0.028253979555520257], ground:[0.28,0.18,0.065] },
  nazgraku: { saddle:[0,0.07886458733711826,-0.0022188537422596633], grip:[0.011498553593554665,-0.14241261412989242,0.000946211786312177], ground:[0.31,0.2,0.07] },
}; // Regression fixtures use the user's October 22 calibration exports, not guessed attachment defaults.
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
assert.deepStrictEqual(['large','medium','small'].map(size => authoredUum.groundOffsets[size]), [0.35,0.25,0.05]);
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
