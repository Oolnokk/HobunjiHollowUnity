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
assert.strictEqual(profiles.characters['mao-ao::male'].posteriorRule.heightPercentFromFloor, 37.31351872723915, 'posterior must retain its recovered floor-relative value');
assert.strictEqual(profiles.characters['mao-ao::female'].anatomy.portraitScale, 0.8, 'latest authored Mao-ao female body scale must remain authoritative');
assert.strictEqual(profiles.characters['mashtzarr::male'].anatomy.portraitScale, 1.18, 'latest authored Mashtzarr male body scale must remain authoritative');
assert.strictEqual(profiles.characters['engh-sho::male'].anchors.shoulderPerch.position.y, 0.6813045758748404, 'August 28 Engh-sho shoulder perch must remain authoritative');

// Latest intentional creature field families and the duplicate defaults table must agree.
assert.strictEqual(profiles.creatures.drenkirra.anchors.shoulderGrip.position.y, -0.11914729549653388, 'August 28 Drenkirra shoulder grip must remain authoritative');
assert.strictEqual(profiles.creatureShoulderGripDefaults.drenkirra.y, -0.11914729549653388, 'shoulderGrip defaults must not retain the older stale coordinate');
assert.strictEqual(profiles.creatures.uumkaoii.anchors.saddle.position.y, 0.26595632314682005, 'latest intentional Uumkaoii saddle must remain authoritative');

// Reconcile the exact corruption patterns introduced by v1 and the older v9 bulk export.
const old = JSON.parse(JSON.stringify(profiles));
old.characters['mao-ao::male'].posteriorRule.heightPercentFromFloor = 0;
old.characters['mao-ao::male'].anchors.leftHandShoulder.position = { x: 0.1716052361925984, y: 0.6252801516658442, z: 0 };
old.characters['mao-ao::male'].anchors.shoulderPerch.position = { x: -0.29650716367602115, y: 0.6473130571424927, z: 0 };
old.creatures.drenkirra.anchors.shoulderGrip.position = { x: 0.01, y: -0.1636307385658067, z: 0.003984738737597559 };
const repaired = guard.reconcileProfiles(old);
assert.strictEqual(repaired.characters['mao-ao::male'].posteriorRule.heightPercentFromFloor, 37.31351872723915, 'zero v9 posterior must be repaired');
assert(Math.abs(repaired.characters['mao-ao::male'].anchors.leftHandShoulder.position.x - 0.19067248465844266) < 1e-12, 'double-scaled v1 shoulder must be repaired to exact v9 authoring');
assert.strictEqual(repaired.characters['mao-ao::male'].anchors.shoulderPerch.position.x, -0.2006533796199832, 'stale v9 perch must be repaired');
assert.strictEqual(repaired.creatures.drenkirra.anchors.shoulderGrip.position.y, -0.11914729549653388, 'stale v9 grip must be repaired');

// A later, non-fingerprint edit must survive the guard instead of being reset to master.
const edited = JSON.parse(JSON.stringify(profiles));
edited.characters['mao-ao::male'].anchors.leftHandShoulder.position.x += 0.0123;
edited.characters['mao-ao::female'].anatomy.portraitScale = 0.83;
edited.creatures.drenkirra.anchors.saddle.position.y += 0.02;
const preserved = guard.reconcileProfiles(edited);
assert(Math.abs(preserved.characters['mao-ao::male'].anchors.leftHandShoulder.position.x - (0.19067248465844266 + 0.0123)) < 1e-12, 'new shoulder authoring must survive master reconciliation');
assert.strictEqual(preserved.characters['mao-ao::female'].anatomy.portraitScale, 0.83, 'new body-scale authoring must survive master reconciliation');
assert.strictEqual(preserved.creatures.drenkirra.anchors.saddle.position.y, 0.11289353489875796, 'new saddle authoring must survive master reconciliation');

const exported = guard.reconcileRigExport({ schema: 'hobunji.attachment-rig-profiles.v9', profiles: old });
assert.strictEqual(exported.schema, 'hobunji.attachment-rig-profiles.v10', 'master-safe export must use the current rig schema');
assert.strictEqual(exported.masterConfigVersion, master.version, 'master-safe export must record its canonical base version');
assert.strictEqual(exported.profiles.characters['mao-ao::male'].posteriorRule.heightPercentFromFloor, 37.31351872723915, 'export must repair the v9 posterior before writing JSON');
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

console.log('attachment rig master tests passed');
