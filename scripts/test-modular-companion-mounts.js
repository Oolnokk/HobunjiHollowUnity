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
const eyeLocations = [
  ['bshuakauitl', 0], ['bshuakauitl', 1],
  ['fishing-mace', 0], ['warhammer', 0], ['bgungku', 0],
  ['hatchet', 0], ['hoe', 0], ['kylie', 0], ['pick-shovel', 0]
]; // All nine manually authored eye locations, including the two-ended and mixed-mount weapons.
let totalEye = 0, totalTang = 0;
for (const [shaftKey, shaft] of Object.entries(committed.shafts)) {
  const eyes = shaft.mounts.filter(m => m.type === 'eye');
  const tangs = shaft.mounts.filter(m => m.type === 'tang');
  totalEye += eyes.length; totalTang += tangs.length;
  assert(shaft.mounts.length <= (shaft.maxAttachments || 8), shaftKey + ': exceeds mount limit');
  for (const eye of eyes) {
    if (shaftKey === 'kylie') {
      // This is an explicit editor export: Kylie mounts were independently moved/rotated after companion creation.
      assert.equal(eyes.length, 1);
      assert.equal(tangs.length, 1);
      assert.deepEqual(plain(eye.start), { x: 253.96693099224976, y: 955.1734838398783 }, 'Keep edited Kylie sleeve start exactly.');
      assert.deepEqual(plain(eye.end), { x: 311.3429622335276, y: 953.3378664626867 }, 'Keep edited Kylie sleeve end exactly.');
      assert.deepEqual(plain(tangs[0].start), { x: 378.31953952612565, y: 945.0718928356596 }, 'Keep independently positioned Kylie tang.');
      assert.deepEqual(plain(tangs[0].end), { x: 346.68046047387435, y: 972.9281071643404 });
      continue; // Do not forcibly re-center a user's intentional post-generation calibration.
    }
    const mx = (eye.start.x + eye.end.x) / 2, my = (eye.start.y + eye.end.y) / 2;
    const dx = eye.end.x - eye.start.x, dy = eye.end.y - eye.start.y;
    const length = Math.hypot(dx, dy);
    const matches = tangs.filter(t => Math.hypot((t.start.x + t.end.x) / 2 - mx, (t.start.y + t.end.y) / 2 - my) < 0.001);
    assert.equal(matches.length, 1, shaftKey + ': every eye has exactly one overlapping companion tang');
    const cross = matches[0];
    const tx = cross.end.x - cross.start.x, ty = cross.end.y - cross.start.y;
    assert(Math.abs(dx * tx + dy * ty) < 1e-8, shaftKey + ': mount axes must be perpendicular');
    assert(Math.abs(Math.hypot(tx, ty) - length / 2) < 1e-8, shaftKey + ': tang is half eye length');
  }
  for (const [headKey, head] of Object.entries(committed.heads)) {
    const pair = shaft.overrides[headKey];
    assert(pair, shaftKey + '/' + headKey + ': every pair explicitly authored');
    const manualHeadAbove = shaftKey === 'kylie' && ['harlyao-broadsword', 'harlyao-longsword'].includes(headKey);
    assert.equal(pair.layerOrder, manualHeadAbove || head.mount.type === 'weight' ? 'head-over-haft' : 'haft-over-head',
      shaftKey + '/' + headKey + ': preserve explicit pair layer order, including two Kylie exceptions.');
    assert.equal(api.settings(shaftKey, headKey).layerOrder, pair.layerOrder);
  }
}
assert.equal(totalEye, eyeLocations.length);
assert.equal(totalTang, 17, 'Nine additional tang lines plus eight previously authored tangs');
assert.equal(Object.keys(committed.shafts).length * Object.keys(committed.heads).length, 255);
assert.deepEqual(plain(committed.heads['pick-shovel-pick'].mount), { type: 'weight',
  start: { x: 207, y: 319 }, end: { x: 207, y: 239 } }, 'Pick arrow stays straight and unrotated');

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
assert.equal(warhammer.overrides.dagger.x, 83);
assert.equal(upgraded.api.settings('warhammer', 'warhammer').layerOrder, 'head-over-haft');
assert.equal(upgraded.api.settings('dagger', 'dagger').layerOrder, 'haft-over-head');
assert.deepEqual(plain(upgraded.api.getConfig().heads['pick-shovel-pick'].mount),
  plain(committed.heads['pick-shovel-pick'].mount), 'Previous manual pick-line rotation is reverted');

// Current v5 drafts must remain the exact user edit, even if they intentionally remove a companion.
const current = plain(upgraded.api.getConfig());
current.shafts.warhammer.mounts = current.shafts.warhammer.mounts.filter(m => m.type !== 'tang');
storage['hobunji.modularWeapons.v5'] = JSON.stringify(current);
const reloaded = boot(storage);
assert.equal(reloaded.api.getConfig().shafts.warhammer.mounts.filter(m => m.type === 'tang').length, 0,
  'Do not repeatedly re-create manually removed tangs on current-version drafts');
console.log('Companion mounts: 8 centered companions, manually adjusted Kylie lines, 255 explicit layer choices, pick unrotation, v4->v5 draft migration passed.');
