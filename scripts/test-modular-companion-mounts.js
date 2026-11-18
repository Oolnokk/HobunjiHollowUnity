'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const plain = x => JSON.parse(JSON.stringify(x));
const filenames = ['docs/config/modular-weapons.js', 'docs/js/modular-weapons.js'];
function boot(storage = {}) {
  const window = { localStorage: { getItem: key => storage[key] || null, setItem: (key, value) => { storage[key] = value; } } };
  const context = vm.createContext({ window, console });
  for (const path of filenames) vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path });
  return { api: window.ModularWeapons, committed: window.MODULAR_WEAPON_CONFIG, storage };
}
const { api, committed } = boot();
const generatedCompanionShafts = ['fishing-mace', 'warhammer', 'bgungku', 'hatchet', 'hoe']; // Five shipped 90-degree tangs whose old start/end were reversed. Pick-Shovel's pick-end companion was removed on purpose: weighted heads now sit opposite the pick pommel and blades only use the scoop-end tang.
for (const key of generatedCompanionShafts) {
  const shaft = committed.shafts[key], eye = shaft.mounts.find(m => m.type === 'eye');
  const center = { x: (eye.start.x + eye.end.x) / 2, y: (eye.start.y + eye.end.y) / 2 }; // Companion tang shares the sleeve center.
  const dx = eye.end.x - eye.start.x, dy = eye.end.y - eye.start.y;
  const tang = shaft.mounts.find(m => m.type === 'tang' &&
    Math.hypot((m.start.x + m.end.x) / 2 - center.x, (m.start.y + m.end.y) / 2 - center.y) < 1e-7);
  assert(tang, key + ': missing companion tang');
  assert(Math.hypot(tang.start.x - center.x + dy / 4, tang.start.y - center.y - dx / 4) < 1e-7,
    key + ': new arrow start must be on the other side of the sleeve midpoint');
  assert(Math.hypot(tang.end.x - center.x - dy / 4, tang.end.y - center.y + dx / 4) < 1e-7,
    key + ': new arrow end must be opposite the old 90-degree generator');
  assert(dx * (tang.end.y - tang.start.y) - dy * (tang.end.x - tang.start.x) < 0,
    key + ': tang direction must have the corrected handedness');
  const head = committed.heads.dagger; // One real rigid blade exercises the production fitting matrix on every corrected shaft.
  const neutral = { scaleX: 1, scaleY: 1, flipX: false, flipY: false, x: 0, y: 0, rotation: 0 }; // Keep authored pair offsets out of the directed-arrow invariant.
  const rig = api.attachmentRig(shaft, head, neutral); // World-fit must agree with the editor and gameplay compositor.
  const mount = rig.children.find(child => child.type === 'tang' &&
    Math.hypot((child.localMount.start.x + child.localMount.end.x) / 2 - center.x,
      (child.localMount.start.y + child.localMount.end.y) / 2 - center.y) < 1e-7);
  assert(mount, key + ': production rig must contain the corrected tang');
  const affine = mount.children[0].worldMatrix;
  const place = p => ({ x: affine.a * p.x + affine.c * p.y + affine.e,
    y: affine.b * p.x + affine.d * p.y + affine.f }); // Evaluate the actual source-to-world renderer transform.
  const fitStart = place(head.mount.start), fitEnd = place(head.mount.end);
  assert(Math.hypot(fitStart.x - mount.worldMount.start.x, fitStart.y - mount.worldMount.start.y) < 1e-6,
    key + ': the head tang base must attach to the corrected haft arrow start');
  assert(Math.hypot(fitEnd.x - mount.worldMount.end.x, fitEnd.y - mount.worldMount.end.y) < 1e-6,
    key + ': the head tang tip must follow the corrected haft arrow end');
}
const eyeLocations = [
  ['bshuakauitl', 0], ['bshuakauitl', 1], ['hachutuTorchStaff', 0], ['hachutuTorchStaff', 1],
  ['fishing-mace', 0], ['warhammer', 0], ['bgungku', 0],
  ['hatchet', 0], ['hoe', 0], ['kylie', 0], ['pick-shovel', 0], ['grapple-flail', 0]
]; // All nine manually authored eye locations, including the two-ended and mixed-mount weapons.
let totalEye = 0, totalTang = 0;
for (const [shaftKey, shaft] of Object.entries(committed.shafts)) {
  const eyes = shaft.mounts.filter(m => m.type === 'eye');
  const tangs = shaft.mounts.filter(m => m.type === 'tang');
  totalEye += eyes.length; totalTang += tangs.length;
  assert(shaft.mounts.length <= (shaft.maxAttachments || 8), shaftKey + ': exceeds mount limit');
  for (const eye of eyes) {
    if (shaftKey === 'bshuakauitl' || shaftKey === 'hachutuTorchStaff') {
      // Torch-Staff intentionally inherits the B'shuakauitl eye/tang rig verbatim,
      // whose tangs are independently offset by the artist rather than center-snapped.
      if (shaftKey === 'hachutuTorchStaff') {
        const donor = committed.shafts.bshuakauitl; // Donor validates copied starts while leaving authored staff tang tips independent.
        const k = shaft.shaftArtTransform.scaleY, sy = y => 602 + k * (y - 602) + (y > 602 ? -140 : 50); // Lengthened donor copy; both ends drawn in toward the middle (bottom -140, top +50 net).
        assert(shaft.shaftArtTransform.enabled === true && k > 1, 'Torch-Staff haft is lengthened');
        const close = (a, b) => Math.abs(a - b) < 1e-6;
        donor.mounts.forEach((m, i) => {
          const t = shaft.mounts[i];
          assert.equal(t.type, m.type, 'Torch-Staff retains donor mount types');
          assert(close(t.start.x, m.start.x) && close(t.start.y, sy(m.start.y)), 'Torch-Staff retains donor mount starts, stretched with the haft');
          if (i < 2) assert(close(t.end.x, m.end.x) && close(t.end.y, sy(m.end.y)), 'Torch-Staff retains both source eye mounts');
        });
        [[941.6863824754939, 221.7599119115615], [303.16373428761597, 158.12411992422858]].forEach(([y, x], i) => {
          const e = shaft.mounts[2 + i].end;
          assert(close(e.x, x) && close(e.y, sy(y)), 'Reauthored staff tang tips are preserved (stretched)');
        });
      }
      continue;
    }
    if (shaftKey === 'grapple-flail') {
      const rope = shaft.mounts.filter(m => m.type === 'rope'); // Dedicated flexible connector mounts intentionally do not require a perpendicular rigid companion tang.
      assert.equal(rope.length, 1, 'Grapple-Flail has one independent rope connector');
      assert(Math.abs(Math.hypot(rope[0].end.x - rope[0].start.x, rope[0].end.y - rope[0].start.y) - 843.75) < 1e-8,
        'Grapple-Flail mount controls original connector reach without resizing the head or rope diameter');
      continue;
    }
    if (shaftKey === 'kylie') {
      // This is an explicit editor export: Kylie mounts were independently moved/rotated after companion creation.
      assert.equal(eyes.length, 1);
      assert.equal(tangs.length, 1);
      assert.deepEqual(plain(eye.start), { x: 253.96693099224976, y: 955.1734838398783 }, 'Keep edited Kylie sleeve start exactly.');
      assert.deepEqual(plain(eye.end), { x: 323.93113469337436, y: 952.9351361306217 }, 'Keep edited Kylie sleeve end exactly.');
      assert.deepEqual(plain(tangs[0].start), { x: 383.5215944260208, y: 957.4694550683187 }, 'Keep independently positioned Kylie tang.');
      assert.deepEqual(plain(tangs[0].end), { x: 333.6535957820315, y: 961.1002554267906 });
      continue; // Do not forcibly re-center a user's intentional post-generation calibration.
    }
    const mx = (eye.start.x + eye.end.x) / 2, my = (eye.start.y + eye.end.y) / 2;
    const dx = eye.end.x - eye.start.x, dy = eye.end.y - eye.start.y;
    const length = Math.hypot(dx, dy);
    if (shaftKey === 'pick-shovel') continue; // Deliberate: eye sits opposite the pick pommel beside the straight scoop tang; no perpendicular companion.
    const matches = tangs.filter(t => Math.hypot((t.start.x + t.end.x) / 2 - mx, (t.start.y + t.end.y) / 2 - my) < 0.001);
    assert.equal(matches.length, 1, shaftKey + ': every eye has exactly one overlapping companion tang');
    const cross = matches[0];
    const tx = cross.end.x - cross.start.x, ty = cross.end.y - cross.start.y;
    assert(Math.abs(dx * tx + dy * ty) < 1e-8, shaftKey + ': mount axes must be perpendicular');
    assert(Math.abs(Math.hypot(tx, ty) - length / 2) < 1e-8, shaftKey + ': tang is half eye length');
  }
  for (const [headKey, head] of Object.entries(committed.heads)) {
    const pair = shaft.overrides[headKey];
    if (!pair && (shaft.flailAssembly || head.flailAssembly)) {
      // Flexible rope recipes reuse one shared pendulum: legacy rigid head/haft layer-order overrides are not required.
      assert(shaft.flailAssembly || head.flailAssembly, 'Flexible combination has a real rope owner');
      continue;
    }
    assert(pair, shaftKey + '/' + headKey + ': every rigid pair explicitly authored');
    // Pair layer order is hand-authored in the editor (collars and tang joins flip it per head), so only its validity is pinned.
    assert(['haft-over-head', 'head-over-haft'].includes(pair.layerOrder), shaftKey + '/' + headKey + ': explicit pair layer order');
    assert.equal(api.settings(shaftKey, headKey).layerOrder, pair.layerOrder);
  }
}
assert.equal(totalEye, eyeLocations.length);
assert.equal(totalTang, 19, 'All original tangs (minus the removed Pick-Shovel pick-end tang) plus the Grapple-Flail legacy rigid tang remain registered');
const rigidShafts = Object.values(committed.shafts).filter(shaft => !shaft.flailAssembly); // Legacy authored pair count stays unchanged when new flexible shafts are registered.
const rigidHeads = Object.values(committed.heads).filter(head => !head.flailAssembly); // Flexible heads do not require a full rigid Cartesian layer-order table.
assert.equal(rigidShafts.length * rigidHeads.length, 272, 'All original 272 explicitly authored rigid pairs remain intact');
assert.deepEqual(plain(committed.heads['pick-shovel-pick'].mount), { type: 'blade',
  start: { x: 193.7686592344786, y: 313.0526330990026 },
  end: { x: 192.22762058461228, y: 248.07090335994735 } },
  'Pick arrow preserves the latest independently authored offset and rotation');

// Preserve other independent artist calibration changes included in the uploaded editor export.
assert.deepEqual(plain(committed.heads['work-hammer'].mount),
  { type: 'weight', start: { x: 210, y: 952 }, end: { x: 210, y: 872 } },
  'Work Hammer head repositioning must survive GitHub import.');
assert.equal(committed.heads['war-cleaver'].editorOnly, false, 'Keep War Cleaver explicitly enabled.');
assert.equal(committed.shafts.kylie.editorOnly, false, 'Keep calibrated Kylie shaft enabled for gameplay.');
assert.equal(committed.shafts.bshuakauitl.overrides['work-hammer'].scaleX, 0.375);
assert.equal(committed.shafts.bshuakauitl.overrides['work-hammer'].scaleY, 2);
assert.equal(committed.shafts.kylie.overrides['work-hammer'].scaleX, 0.5);
assert.equal(committed.shafts.kylie.overrides['work-hammer'].scaleY, 2.5);
assert.equal(committed.shafts.kylie.overrides['fishing-mace'].scaleX, 0.75);
// Upgrade earlier browser drafts once without losing unrelated manual calibration.
const old = plain(committed);
for (const shaft of Object.values(old.shafts)) {
  const eyes = shaft.mounts.filter(m => m.type === 'eye');
  shaft.mounts = shaft.mounts.filter(m => m.type !== 'tang' ||
    !eyes.some(eye => Math.hypot((eye.start.x + eye.end.x - m.start.x - m.end.x) / 2,
      (eye.start.y + eye.end.y - m.start.y - m.end.y) / 2) < 0.01));
  for (const pair of Object.values(shaft.overrides)) delete pair.layerOrder; // Old draft predates authored preferences.
}
old.shafts.warhammer.mounts[0] = { type: 'eye', start: { x: 110, y: 100 }, end: { x: 170, y: 180 } }; // Nonvertical custom authoring.
old.shafts.warhammer.overrides.dagger.x = 83; // Preserve unrelated pair transform edits.
old.heads['pick-shovel-pick'].mount.end = { x: 320, y: 410 }; // Old rotation that should be undone.
const storage = { 'hobunji.modularWeapons.v4': JSON.stringify(old) };
const upgraded = boot(storage);
assert(storage['hobunji.modularWeapons.v5'], 'One-time draft migration is persisted under new key');
const warhammer = upgraded.api.getConfig().shafts.warhammer;
assert.equal(warhammer.mounts.filter(m => m.type === 'tang').length, 1);
const eye = warhammer.mounts.find(m => m.type === 'eye'), tang = warhammer.mounts.find(m => m.type === 'tang');
assert.deepEqual(plain(eye.start), { x: 110, y: 100 }); // Prior source eye placement remains as authored.
assert.equal((tang.start.x + tang.end.x) / 2, 140);
assert.equal((tang.start.y + tang.end.y) / 2, 140);
assert(Math.abs((tang.end.x - tang.start.x) * 60 + (tang.end.y - tang.start.y) * 80) < 1e-8);
assert(Math.abs(Math.hypot(tang.end.x - tang.start.x, tang.end.y - tang.start.y) - 50) < 1e-8);
assert((eye.end.x-eye.start.x)*(tang.end.y-tang.start.y) - (eye.end.y-eye.start.y)*(tang.end.x-tang.start.x) < 0,
  'Older v4 drafts generate correctly directed tangs on an adjusted sleeve.');
for (const key of ['bshuakauitl', 'hachutuTorchStaff', 'kylie']) {
  const shaft = upgraded.api.getConfig().shafts[key], oldEye = shaft.mounts.find(m => m.type === 'eye'); // Hand-authored families are not part of the six reversed-shaft migration.
  const center = { x: (oldEye.start.x + oldEye.end.x) / 2, y: (oldEye.start.y + oldEye.end.y) / 2 }; // Locate a newly generated legacy companion independently of hand-authored tangs.
  const companion = shaft.mounts.find(m => m.type === 'tang' &&
    Math.hypot((m.start.x + m.end.x) / 2 - center.x, (m.start.y + m.end.y) / 2 - center.y) < 1e-7);
  assert(companion, key + ': legacy v4 draft must still acquire a centered companion');
  const ex = oldEye.end.x - oldEye.start.x, ey = oldEye.end.y - oldEye.start.y;
  assert(ex * (companion.end.y - companion.start.y) - ey * (companion.end.x - companion.start.x) > 0,
    key + ': legacy manually authored families retain the original generated orientation');
}
assert.equal(warhammer.overrides.dagger.x, 83);
assert.equal(upgraded.api.settings('warhammer', 'warhammer').layerOrder, 'head-over-haft');
assert.equal(upgraded.api.settings('dagger', 'dagger').layerOrder, 'haft-over-head');
assert.deepEqual(plain(upgraded.api.getConfig().heads['pick-shovel-pick'].mount),
  plain(committed.heads['pick-shovel-pick'].mount), 'Previous manual pick-line rotation is reverted');

// A first load repairs only the six exact previously generated backwards arrows in v5 drafts.
const legacyCurrent = plain(committed); // Simulates the original saved 90-degree companions, before the direction correction.
for (const key of generatedCompanionShafts) {
  const tang = legacyCurrent.shafts[key].mounts.find(m => m.type === 'tang' &&
    Math.abs(m.end.y - m.start.y) < 1e-7);
  assert(tang, key + ': expected horizontal companion');
  [tang.start, tang.end] = [tang.end, tang.start];
}
legacyCurrent.shafts.hoe.mounts[1].start.x += 3; // A manually repositioned tang must not match the old generator's fingerprint.
legacyCurrent.shafts.warhammer.overrides.dagger.x = 83; // A pair correction must survive the migration unchanged.
const directionStorage = {
  'hobunji.modularWeapons.v5': JSON.stringify(legacyCurrent),
  'hobunji.modularWeapons.kylieToolWorthy.v1': '1',
  'hobunji.modularWeapons.pickShovelForgeable.v1': '1',
};
const corrected = boot(directionStorage);
for (const key of generatedCompanionShafts.filter(key => key !== 'hoe')) {
  assert.deepEqual(plain(corrected.api.getConfig().shafts[key].mounts), plain(committed.shafts[key].mounts),
    key + ': exact old companion arrow is repaired without replacing other mounts');
}
assert.deepEqual(plain(corrected.api.getConfig().shafts.hoe.mounts[1]), plain(legacyCurrent.shafts.hoe.mounts[1]),
  'An independently adjusted companion direction remains unchanged');
assert.deepEqual(plain(corrected.api.getConfig().shafts.kylie.mounts), plain(committed.shafts.kylie.mounts),
  'Independently authored Kylie lines are unaffected');
assert.deepEqual(plain(corrected.api.getConfig().shafts.bshuakauitl.mounts), plain(committed.shafts.bshuakauitl.mounts),
  'Independently authored twin-ended lines are unaffected');
assert.equal(corrected.api.settings('warhammer', 'dagger').x, 83, 'Pair corrections survive the mount migration');
assert.equal(directionStorage['hobunji.modularWeapons.companionTangDirection.v1'], '1',
  'Correction marker persists to avoid undoing a later intentional author edit');
const deliberateReversal = plain(corrected.api.getConfig()); // After migration the user may intentionally reverse a tang again.
[deliberateReversal.shafts.hatchet.mounts[1].start, deliberateReversal.shafts.hatchet.mounts[1].end] =
  [deliberateReversal.shafts.hatchet.mounts[1].end, deliberateReversal.shafts.hatchet.mounts[1].start];
directionStorage['hobunji.modularWeapons.v5'] = JSON.stringify(deliberateReversal);
assert.deepEqual(plain(boot(directionStorage).api.getConfig().shafts.hatchet.mounts[1]),
  plain(deliberateReversal.shafts.hatchet.mounts[1]), 'Subsequent authored direction is never repaired again');

// Pair-calibration migration replaces only pristine older visual presets on the two affected hafts.
const oldPairVisuals = {
  "fishing-mace": {
    "dagger": {
      "scaleX": 0.7,
      "scaleY": 0.6,
      "x": 35,
      "y": -15,
      "rotation": -90,
      "layerOrder": "haft-over-head"
    },
    "harlyao-broadsword": {
      "scaleX": 1.05,
      "scaleY": 0.5,
      "x": 35,
      "y": -40,
      "rotation": -90,
      "layerOrder": "haft-over-head"
    },
    "harlyao-longsword": {
      "scaleX": 1.05,
      "scaleY": 0.5,
      "x": 40,
      "y": -35,
      "rotation": -90,
      "layerOrder": "haft-over-head"
    },
    "pick-shovel-pick": {
      "flipX": true,
      "flipY": true,
      "x": 35,
      "y": -25,
      "rotation": -90,
      "layerOrder": "head-over-haft"
    },
    "pickshovel-scoop": {
      "x": 5,
      "y": 30,
      "layerOrder": "haft-over-head"
    },
    "plains-blade": {
      "scaleX": 1.1,
      "scaleY": 0.35,
      "x": -65,
      "y": -30,
      "rotation": -90,
      "layerOrder": "haft-over-head"
    },
    "war-cleaver": {
      "x": 5,
      "y": 30,
      "layerOrder": "haft-over-head"
    }
  },
  "warhammer": {
    "dagger-sword": {
      "x": 12,
      "y": 5,
      "layerOrder": "haft-over-head"
    },
    "dagger": {
      "scaleX": 0.9,
      "scaleY": 0.75,
      "x": 40,
      "y": -90,
      "rotation": -90,
      "layerOrder": "haft-over-head"
    },
    "fishing-spear": {
      "scaleY": 1.2,
      "flipX": true,
      "x": -40,
      "y": -90,
      "rotation": -90,
      "layerOrder": "haft-over-head"
    },
    "harlyao-broadsword": {
      "scaleX": 1.35,
      "scaleY": 0.8,
      "x": 25,
      "y": -100,
      "rotation": -90,
      "layerOrder": "haft-over-head"
    },
    "harlyao-longsword": {
      "scaleX": 1.65,
      "x": 5,
      "layerOrder": "haft-over-head"
    },
    "pick-shovel-pick": {
      "scaleX": 1.05,
      "scaleY": 1.05,
      "flipX": true,
      "flipY": true,
      "x": 40,
      "y": -75,
      "rotation": -90,
      "layerOrder": "head-over-haft"
    },
    "pickshovel-scoop": {
      "x": 5,
      "layerOrder": "haft-over-head"
    },
    "plains-blade": {
      "scaleX": 1.2,
      "scaleY": 0.75,
      "x": 5,
      "layerOrder": "haft-over-head"
    }
  }
}; // Reference fits before the user's new neutral-rotation calibration.
const visualKeys = ['scaleX', 'scaleY', 'flipX', 'flipY', 'x', 'y', 'rotation', 'layerOrder']; // All and only fields governing sprite placement.
const olderFits = plain(committed); // Simulate an actual v5 user draft saved before these fifteen authored corrections.
let expectedFitUpdates = 0; // Matches the number of known outdated shipped presets in the migration.
for (const [shaftKey, pairs] of Object.entries(oldPairVisuals)) {
  for (const [headKey, legacy] of Object.entries(pairs)) {
    const pair = olderFits.shafts[shaftKey].overrides[headKey];
    for (const field of visualKeys) delete pair[field];
    Object.assign(pair, legacy);
    expectedFitUpdates++;
  }
}
const fitStorage = {
  'hobunji.modularWeapons.v5': JSON.stringify(olderFits),
  'hobunji.modularWeapons.kylieToolWorthy.v1': '1',
  'hobunji.modularWeapons.pickShovelForgeable.v1': '1',
  'hobunji.modularWeapons.companionTangDirection.v1': '1',
}; // Isolate the visual migration from the older mount and toolability migrations.
const fitted = boot(fitStorage);
assert.equal(expectedFitUpdates, 15, 'The uploaded calibration changed fifteen rigid head/haft combinations');
for (const [shaftKey, pairs] of Object.entries(oldPairVisuals)) {
  for (const headKey of Object.keys(pairs)) {
    const expected = committed.shafts[shaftKey].overrides[headKey];
    const actual = fitted.api.getConfig().shafts[shaftKey].overrides[headKey];
    assert.deepEqual(plain(actual), plain(expected), shaftKey + '/' + headKey + ': legacy visual preset takes the newly authored fit');
    assert.notEqual(actual.rotation, -90, shaftKey + '/' + headKey + ': obsolete -90 degree rotation is gone');
  }
}
assert.equal(fitted.api.diagnostics('modular:warhammer:dagger:nativeCopper').migratedPairFits, 15,
  'Mobile-accessible modular diagnostics report the number of migrated pair presets');
assert.equal(fitStorage['hobunji.modularWeapons.authoredPerpendicularPairFits.v1'], '1',
  'Visual migration records a one-time completion marker');
assert(fitStorage['hobunji.modularWeapons.v5'], 'Updated visuals are persisted rather than restored from the stale draft');

// Custom old drafts must never lose unrelated artist offsets, bridges, or layer choices.
const customizedFits = plain(olderFits); // A future load with one modified -90 pair and one nonrotated customized pair.
customizedFits.shafts.warhammer.overrides.dagger.x = 123; // Distinguishes it from the pristine legacy preset.
customizedFits.shafts['fishing-mace'].overrides['war-cleaver'].y = 777; // Existing manual calibration must not be overwritten.
const customStorage = {
  'hobunji.modularWeapons.v5': JSON.stringify(customizedFits),
  'hobunji.modularWeapons.kylieToolWorthy.v1': '1',
  'hobunji.modularWeapons.pickShovelForgeable.v1': '1',
  'hobunji.modularWeapons.companionTangDirection.v1': '1',
}; // Both draft sessions are independent and start with the pre-migration pair presets.
const customized = boot(customStorage);
assert.equal(customized.api.settings('warhammer', 'dagger').x, 123, 'Custom X correction must survive');
assert.equal(customized.api.settings('warhammer', 'dagger').rotation, 0, 'Custom old -90 is removed without resetting custom X');
assert.equal(customized.api.settings('fishing-mace', 'war-cleaver').y, 777, 'Custom Y correction must survive');
const afterMigration = plain(customized.api.getConfig()); // Future manual edits must not be changed again after the one-time migration.
afterMigration.shafts.warhammer.overrides.dagger.rotation = -90;
customStorage['hobunji.modularWeapons.v5'] = JSON.stringify(afterMigration);
assert.equal(boot(customStorage).api.settings('warhammer', 'dagger').rotation, -90,
  'An explicit later author edit remains untouched once old drafts have been upgraded');
for (const shaft of Object.values(committed.shafts)) for (const pair of Object.values(shaft.overrides)) {
  assert.notEqual(pair.rotation, -90, 'No shipped pair-specific -90 degree legacy rotation remains');
}

// Current v5 drafts must remain the exact user edit, even if they intentionally remove a companion.
const current = plain(upgraded.api.getConfig());
current.shafts.warhammer.mounts = current.shafts.warhammer.mounts.filter(m => m.type !== 'tang');
storage['hobunji.modularWeapons.v5'] = JSON.stringify(current);
const reloaded = boot(storage);
assert.equal(reloaded.api.getConfig().shafts.warhammer.mounts.filter(m => m.type === 'tang').length, 0,
  'Do not repeatedly re-create manually removed tangs on current-version drafts');
console.log('Companion mounts: original 272 rigid layer choices and calibrated companions retained; independent Grapple-Flail rope mount, Kylie edits and v4->v5 migration passed.');
