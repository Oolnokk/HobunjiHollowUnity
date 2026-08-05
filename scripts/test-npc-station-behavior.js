'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const corePath = path.resolve(__dirname, '../docs/js/npc-station-behavior-core.js');
const context = { globalThis: {} };
context.globalThis.globalThis = context.globalThis;
vm.runInNewContext(fs.readFileSync(corePath, 'utf8'), context, { filename: corePath });
const core = context.globalThis.NpcStationBehaviorCore;
const plain = value => JSON.parse(JSON.stringify(value));
assert.ok(core, 'core API should be exported');

const station = {
  col: 5,
  row: 5,
  stationBehavior: {
    mode: 'patrol',
    tiles: [[5, 5], [6, 5], [7, 5], [7, 6], [20, 20]],
  },
};
const behavior = core.normalizeStationBehavior(station);
assert.equal(behavior.mode, 'patrol');
assert.deepEqual(plain(core.connectedComponent(behavior.tiles, [5, 5])), [[5, 5], [6, 5], [7, 5], [7, 6]]);
assert.deepEqual(plain(core.disconnectedTiles(behavior.tiles, [5, 5])), [[20, 20]]);
assert.deepEqual(plain(core.bfsPath(behavior.tiles, [5, 5], [7, 6])), [[5, 5], [6, 5], [7, 5], [7, 6]]);
assert.deepEqual(plain(core.bfsPath(behavior.tiles, [5, 5], [20, 20])), []);

const wanderTarget = core.chooseWanderDestination(
  [[0, 0], [1, 0], [2, 0], [3, 0]],
  [0, 0],
  { minPathDistance: 2, maxPathDistance: 2 },
  () => 0,
);
assert.deepEqual(plain(wanderTarget), [2, 0]);

const priorities = core.normalizeAttentionPriorities({
  attentionPriorities: [
    {
      type: 'people-watching',
      expression: 'frown',
      conditions: { notSpecies: 'mao-ao', playerMinHeartsToIgnore: 3 },
    },
    { type: 'person-watching', personIds: ['player', 'kinami_kunji'] },
    { type: 'origin-watching' },
  ],
});
assert.equal(priorities[0].type, 'people');
assert.deepEqual(plain(priorities[0].conditions.notSpecies), ['mao-ao']);
assert.equal(priorities[0].conditions.playerMinHeartsToIgnore, 3);
assert.equal(priorities[1].type, 'person');
assert.deepEqual(plain(priorities[1].targetIds), ['player', 'kinami_kunji']);
assert.equal(priorities[2].type, 'origin');

console.log('NPC station behavior core tests passed.');
