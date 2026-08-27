const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const questTargets = [
  { id:'quest:1', areaId:'zone', col:8, row:5, label:'Quest: Furu' },
  { id:'quest:2', areaId:'town', col:2, row:2, label:'Quest: Away' },
];
const context = {
  console, Math, Number, Object, Array, Map,
  performance: { now: () => 100 },
  requestAnimationFrame() { return 1; },
  document: { createElement() { return {}; }, getElementById() { return null; } },
  window: null,
};
context.window = context;
context.ProceduralTasks = { compassTargets: () => questTargets };
context.BountyBoard = { markers: new Map([['b1',{zoneId:'zone',col:10,row:5,label:'Captain'}]]) };
context.BanditCamps = { perceivedThreats: new Map([
  ['camp:1',{kind:'camp',zoneId:'zone',col:10.2,row:5,label:'Bandit Camp'}],
  ['den:1',{kind:'den',zoneId:'zone',col:3,row:5,label:'Animal Den'}],
]) };

vm.createContext(context);
const sourcePath = path.join(__dirname, '..', 'docs', 'js', 'navigation-compass.js'); // Used to test the repository copy rather than an inline fixture.
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });

const test = context.NavigationCompass._test;
assert.equal(test.markerSize(0), 25, 'nearest target should use maximum marker size');
assert(test.markerSize(80) < test.markerSize(8), 'marker size must decrease with distance');
assert(Math.abs(test.angleDiff(-Math.PI + 0.1, Math.PI - 0.1) - 0.2) < 1e-9, 'bearing delta should wrap across ±PI');

const collected = test.collectTargets('zone');
assert.equal(collected.offAreaQuestTargets, 1, 'off-area quests should be counted for diagnostics');
assert(collected.targets.some(target => target.source === 'quest'), 'same-area quest NPC should be tracked');
assert(collected.targets.some(target => target.source === 'bounty'), 'located bounty should be tracked');
assert(collected.targets.some(target => target.source === 'den'), 'companion-sensed den should be tracked');
assert(!collected.targets.some(target => target.source === 'camp'), 'perceived camp duplicate should yield to nearby bounty marker');

console.log('navigation-compass tests passed');
