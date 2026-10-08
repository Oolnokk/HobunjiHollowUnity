'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/hand-tool-grip-authored-overrides.js', 'utf8');
const data = {
  schema: 'hobunji_hand_tool_grips.v1',
  tools: {
    bshuakauitl: { primaryGrip: { position: { x: -0.04, y: -0.04, z: -0.0006 } }, toolScale: 1.3 },
    fishingspear: { primaryGrip: { position: { x: -0.04, y: -0.04, z: 0.01 } }, toolScale: 1.15 },
  },
};
let listener = null;
const api = {
  data,
  mutate(mutator) { mutator(data); listener?.(); return data; },
  subscribe(next) { listener = next; return () => { listener = null; }; },
};
Object.defineProperty(api, 'defaultData', { configurable: true, enumerable: true, get: () => JSON.parse(JSON.stringify(data)) });
const context = { window: { HobunjiHandToolGrips: api } };
vm.runInNewContext(source, context);

assert.equal(data.tools.bshuakauitl.primaryGrip.position.z, 0.05);
assert.deepEqual(JSON.parse(JSON.stringify(data.tools.bshuakauitl.primaryGripSpan)), { enabled: true, startZ: 0.0394, endZ: 0.1594 });
assert.deepEqual(JSON.parse(JSON.stringify(data.tools.bshuakauitl.secondaryGripSpan)), { enabled: true, startZ: -0.1606, endZ: -0.0406 });
assert.deepEqual(JSON.parse(JSON.stringify(data.tools.bshuakauitl.rangedPrimaryGrip.position)), { x: -0.04, y: -0.04, z: -0.0006 });
assert.deepEqual(JSON.parse(JSON.stringify(data.tools.fishingspear.primaryGrip.position)), { x: -0.04, y: -0.04, z: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(data.tools.fishingspear.primaryGripSpan)), { enabled: true, startZ: -0.3522, endZ: -0.2322 });
assert.deepEqual(JSON.parse(JSON.stringify(data.tools.fishingspear.secondaryGripSpan)), { enabled: true, startZ: -0.0722, endZ: 0.0478 });
assert.deepEqual(JSON.parse(JSON.stringify(data.tools.fishingspear.rangedPrimaryGrip.position)), { x: 0.04, y: -0.04, z: 0.1522 });
assert.equal(data.authoredGripRevision, 'spear-bshuakauitl-authored-20261007-v2');

// Once migrated, later artist edits remain editable while the revision marker is current.
data.tools.bshuakauitl.primaryGrip.position.z = 0.123;
listener?.();
assert.equal(data.tools.bshuakauitl.primaryGrip.position.z, 0.123);

// Loading an older export without the marker reapplies the canonical authored revision.
delete data.authoredGripRevision;
data.tools.bshuakauitl.primaryGrip.position.z = -9;
listener?.();
assert.equal(data.tools.bshuakauitl.primaryGrip.position.z, 0.05);

// The runtime/editor hand-script loader must actually load the migration, after the grip module it patches.
const loader = fs.readFileSync('docs/js/held-action-animations.js', 'utf8');
const gripsAt = loader.search(/js\/hand-tool-grips\.js\?v=[A-Za-z0-9_-]+/);
const overridesAt = loader.search(/js\/hand-tool-grip-authored-overrides\.js\?v=[A-Za-z0-9_-]+/);
assert(gripsAt >= 0 && overridesAt > gripsAt, 'held-action-animations.js must load the authored grip overrides after hand-tool-grips.js');

// Exercise the production normalizer, subscriptions, save/load, and resolved hand target.
const saved = new Map(); // Local drafts used to verify reloads preserve later artist edits.
const runtimeWindow = { // Minimal browser state for the real grip module, without a render loop.
  location: { pathname: '/index.html' },
  RuntimeFrameScheduler: { register() {} },
};
const runtimeContext = vm.createContext({ // Both production modules share this browser realm.
  window: runtimeWindow,
  document: { getElementById() { return null; } },
  localStorage: { getItem(key) { return saved.get(key) ?? null; }, setItem(key, value) { saved.set(key, value); }, removeItem(key) { saved.delete(key); } },
  performance: { now() { return 0; } },
});
vm.runInContext(fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8'), runtimeContext);
const realGrips = runtimeWindow.HobunjiHandToolGrips; // Actual runtime API, including normalization and change notifications.
const oldDraft = realGrips.clone(); // Represents a saved draft with the previous shipped correction marker.
oldDraft.authoredGripRevision = 'spear-bshuakauitl-authored-20261006-v1';
oldDraft.tools.fishingspear.primaryGrip.position.z = -0.1522;
oldDraft.tools.bshuakauitl.primaryGrip.position.z = 0.123;
oldDraft.tools.fishingspear.primaryGripSpan.endZ = -0.21;
oldDraft.tools.fishingspear.rangedPrimaryGrip.position.z = 0.19;
realGrips.replace(oldDraft);
vm.runInContext(source, runtimeContext);
assert.equal(realGrips.primaryGripForTool('fishingspear', 'melee').position.z, 0, 'live fixed hand target receives the exported melee grip');
assert.equal(realGrips.primaryGripForTool('fishingspear-tinbronze', 'melee').position.z, 0, 'crafted spear variants use the same shape grip');
assert.equal(realGrips.data.tools.bshuakauitl.primaryGrip.position.z, 0.123, 'v1 upgrade preserves other weapon edits');
assert.equal(realGrips.data.tools.fishingspear.primaryGripSpan.endZ, -0.21, 'v1 upgrade preserves authored attack ranges');
assert.equal(realGrips.data.tools.fishingspear.rangedPrimaryGrip.position.z, 0.19, 'v1 upgrade preserves independently authored ranged grip');
realGrips.mutate(draft => { draft.tools.fishingspear.primaryGrip.position.z = 0.04; });
realGrips.saveLocal();
const editedSave = saved.get('hobunji.handToolGrips.v1'); // Saved v2 draft used to check reload after resetting.
realGrips.clearLocal();
assert.equal(realGrips.data.tools.fishingspear.primaryGrip.position.z, 0, 'reset restores corrected defaults');
saved.set('hobunji.handToolGrips.v1', editedSave);
assert(realGrips.loadLocal());
assert.equal(realGrips.data.tools.fishingspear.primaryGrip.position.z, 0.04, 'later author edits survive local reload');
realGrips.replace(oldDraft);
assert.equal(realGrips.data.tools.fishingspear.primaryGrip.position.z, 0, 'later import carrying the v1 marker migrates too');
assert.equal(realGrips.defaultData.tools.fishingspear.primaryGrip.position.z, 0);
assert.equal(runtimeWindow.HobunjiAuthoredGripOverrides.debugSnapshot().applied, true);

console.log('authored spear/bshuakauitl grip migration PASS');
