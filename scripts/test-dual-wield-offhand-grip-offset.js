'use strict';
// Dual Wield's offhand holds its own weapon copy from the opposite side, so it takes the authored grip with the main
// hand's palm-side offset (item Y) removed instead of sharing it. Editing the shared grip Y used to be the only way to
// seat the offhand, which unseated the main hand.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {
  location: { pathname: '/index.html' },
  RuntimeFrameScheduler: { register() {} },
  Combat: { deps: {} },
};
const scope = { window, location: window.location, document: { getElementById: () => null }, performance: { now: () => 0 }, localStorage: { getItem: () => null, setItem() {} } };
vm.runInNewContext(fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8'), scope);
const grips = window.HobunjiHandToolGrips;

for (const tool of ['dagger', 'kylie', 'warcleaver', 'daggersword']) {
  const main = grips.primaryGripForTool(tool, 'melee');
  const off = grips.offhandPrimaryGripForTool(tool, 'melee');
  const authored = grips.authoredPrimaryGripForTool(tool, 'melee');
  assert.equal(authored.position.y, -0.04, `${tool}: the shared authored grip is untouched`);

  // The offhand frame must equal the main frame for the same grip with Y moved to 0 (what hand-editing the shared grip did).
  const expected = grips.itemPointToHolder(tool, { ...authored.position, y: 0 }, 'melee');
  for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(off.position[axis] - expected[axis]) < 1e-9, `${tool}: offhand ${axis}`);
  assert.notEqual(JSON.stringify(off.position), JSON.stringify(main.position), `${tool}: offhand no longer shares the main hand's palm-side offset`);
  assert.equal(JSON.stringify(off.rotationDeg), JSON.stringify(main.rotationDeg), `${tool}: grip orientation is shared`);
}

// Whatever grip a tool has, the offset removes exactly the shared hand-on-item frame's Y, and a tool can override it.
grips.mutate(data => { data.tools.dagger.primaryGrip.position.y = -0.1; });
assert.equal(grips.dualWieldOffhandGripOffsetForTool('dagger').y, 0.04);
const shifted = grips.offhandPrimaryGripForTool('dagger', 'melee');
assert.ok(Math.abs(shifted.position.y - grips.itemPointToHolder('dagger', { ...grips.authoredPrimaryGripForTool('dagger', 'melee').position, y: -0.06 }, 'melee').y) < 1e-9);
grips.mutate(data => { data.tools.dagger.dualWieldOffhandGripOffset = { x: 0, y: 0.1, z: 0.02 }; });
assert.equal(JSON.stringify(grips.dualWieldOffhandGripOffsetForTool('dagger')), JSON.stringify({ x: 0, y: 0.1, z: 0.02 }), 'per-tool override survives normalization');
console.log('dual wield offhand grip offset ok');
