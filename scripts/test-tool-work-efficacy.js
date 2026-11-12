#!/usr/bin/env node
'use strict';

// Executes the production speed/charge functions and real fishing-ring constructor.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const game = fs.readFileSync('docs/game.js', 'utf8'); // Actual game functions under test.
const fishing = fs.readFileSync('docs/js/fishing-minigame.js', 'utf8'); // Actual spear-bridge timing source.

function functionBody(source, name) {
  const start = source.indexOf('function ' + name + '('); // Finds the exact production function.
  assert(start >= 0, `Missing function ${name}`);
  const open = source.indexOf('{', source.indexOf(')', start)); // Finds the function body opening.
  let depth = 0; // Counts balanced JavaScript blocks in these selected functions.
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Unclosed function ${name}`);
}

const effects = { weak: 0.9, strong: 1.15 }; // Mocked values from the real six-tier metal formula.
const speedContext = vm.createContext({
  equipmentSlots: { shovel: 'weak', hoe: 'strong', axe: 'strong', pick: 'weak' },
  player: { digSpeed: 1.4 },
  toolMetalMultiplier: key => effects[key] || 1,
  window: {
    SkillSystem: { actionSpeedMultiplier: skill => ({ farming: 1.2, mining: 1.3, foraging: 1.1 })[skill] || 1 },
    GridTileAccessors: { getActiveGrid: () => [[{ type: 'grass' }]] },
  },
  getReticleTile: () => ({ col: 0, row: 0 }),
  isChoppableTreeTile: () => false,
  isMineableRockTile: () => false,
  canUseAction: (tool, action) => tool === 'hoe' && action === 'till',
  TileType: { GRASS: 'grass', TRENCH: 'trench' },
  resolveDigFillAction: (_tool, action) => action,
  chargeAction: null,
  toolSwingT: 0, toolSwingDur: 0, strikeFired: false, chargeStageSfxFired: false,
  pendingAction: null, chargeAnimOverride: null, combatSwingAnim: null, combatSwingPose: null,
});
vm.runInContext([
  functionBody(game, 'getToolWorkSpeedMultiplier'),
  functionBody(game, 'getDigSpeedMultiplier'),
  functionBody(game, 'wouldStartCharge'),
  functionBody(game, 'beginChargeStage'),
].join('\n'), speedContext);

function near(actual, expected, label) {
  assert(Math.abs(actual - expected) < 1e-8, `${label}: expected ${expected}, got ${actual}`);
}

near(vm.runInContext("getToolWorkSpeedMultiplier('shovel')", speedContext), 1.4 * 1.2 * .9, 'Shovel combines dig, Farming and weak metal');
near(vm.runInContext("getToolWorkSpeedMultiplier('hoe')", speedContext), 1.4 * 1.2 * 1.15, 'Hoe shares shovel modifiers and uses its own metal');
near(vm.runInContext("getToolWorkSpeedMultiplier('axe')", speedContext), 1.1 * 1.15, 'Axe uses Foraging and metal');
near(vm.runInContext("getToolWorkSpeedMultiplier('pick')", speedContext), 1.3 * .9, 'Pick uses Mining and metal');
near(vm.runInContext('getDigSpeedMultiplier()', speedContext), 1.4 * 1.2 * .9, 'Old shovel-speed alias stays accurate');
assert.equal(vm.runInContext("wouldStartCharge('hoe', 'till')", speedContext), true, 'Tilling must be held');
assert.equal(vm.runInContext("wouldStartCharge('hoe', 'smooth')", speedContext), false, 'Smoothing remains a single swing');
speedContext.canUseAction = () => false;
assert.equal(vm.runInContext("wouldStartCharge('hoe', 'till')", speedContext), false, 'Cannot hold a hoe charge on invalid ground');
speedContext.canUseAction = () => true;

// Evaluate the actual hoe stage declaration and actual charge timer, not replicas.
const stageStart = game.indexOf('const TILL_SOIL_STAGES = '); // Locates the production sequence.
assert(stageStart >= 0);
const stageEnd = game.indexOf(';', stageStart);
vm.runInContext(game.slice(stageStart, stageEnd + 1), speedContext);
near(vm.runInContext('TILL_SOIL_STAGES.reduce((total, stage) => total + stage.dur, 0)', speedContext), 2.1, 'Hoe base hold time');
speedContext.chargeAction = { tool: 'hoe', stage: 0, stages: vm.runInContext('TILL_SOIL_STAGES', speedContext) };
vm.runInContext('beginChargeStage()', speedContext);
near(speedContext.toolSwingDur, .8 / (1.4 * 1.2 * 1.15), 'Hoe animation speed respects all work modifiers');
assert.equal(speedContext.chargeAnimOverride, 'chop', 'Hoe uses chopping tool poses');
assert.equal(speedContext.chargeAction.stages.length, 3, 'Tilling has three uninterrupted strokes');

// The fishing module builds per-cast duration fields that its motion code reads.
const ringStart = fishing.indexOf('const FISHING_RING = {'); // Uses real ring tuning constants.
const ringEnd = fishing.indexOf('};', ringStart);
assert(ringStart >= 0 && ringEnd > ringStart);
const constructorStart = fishing.indexOf('function beginFishingRing(fm) {'); // Production ring constructor.
const constructorEnd = fishing.indexOf('// Dispatches the "primary"', constructorStart);
assert(constructorStart >= 0 && constructorEnd > constructorStart);
const fishingContext = vm.createContext({
  deps: null,
  window: { __farmLog() {} },
  fishDiveCooldown: () => .5,
  fishPickTargetVel() {},
  fishingThrowHoldActive: true,
  renderFishingOverlay() {},
  fishingEls: null,
  _fishDeformUrlCache: null, _fishDeformUrlCacheAt: 0,
  _fishDeformCollisionMask: null, _fishCollisionSourceLog: '',
  fishBodySpriteImage: null,
});
vm.runInContext(fishing.slice(ringStart, ringEnd + 2) + '\n' + fishing.slice(constructorStart, constructorEnd), fishingContext);
for (const [itemKey, efficacy] of [['weak', .9], ['strong', 1.15], ['legacy', 1]]) {
  fishingContext.deps = { equipmentSlots: { harpoon: itemKey }, toolMetalMultiplier: key => effects[key] ?? 1 };
  fishingContext.fm = { zoneKey: 'river', fishDef: { key: 'testfish' }, anchorWorld: { x: 0, y: 0, z: 0 } };
  vm.runInContext('beginFishingRing(fm)', fishingContext);
  near(fishingContext.fm.bridge.efficacy, efficacy, `${itemKey} snapshot`);
  near(fishingContext.fm.bridge.shotDuration, .16 / efficacy, `${itemKey} shot`);
  near(fishingContext.fm.bridge.retractDuration, .28 / efficacy, `${itemKey} retraction`);
}
assert.match(fishing, /b\.shotTimer = Math\.min\(b\.shotDuration, b\.shotTimer \+ dt\)/, 'Outbound motion consumes per-throw duration');
assert.match(fishing, /b\.retractTimer = Math\.min\(b\.retractDuration, b\.retractTimer \+ dt\)/, 'Retraction consumes per-throw duration');
console.log('Tool work efficacy, held hoe tilling and harpoon flight/retraction: ok');
