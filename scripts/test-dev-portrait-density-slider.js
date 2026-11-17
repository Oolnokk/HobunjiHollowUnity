#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const portraitSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
const uiSource = fs.readFileSync('docs/js/performance-debug.js', 'utf8');
const devSource = fs.readFileSync('docs/js/input-default-reset-ui.js', 'utf8');
const begin = portraitSource.indexOf('  // Mesh budgets:');
const end = portraitSource.indexOf('  function buildSkinnedPlaneGeometry(', begin);
assert(begin >= 0 && end > begin, 'production portrait budget and density authority can be extracted');

const builds = []; // The fake builder below records the exact requested grid without bringing in renderer dependencies.
function geometry(segmentsX, segmentsY, frontOnly = false) {
  const count = segmentsX * segmentsY * 6 * (frontOnly ? 1 : 2);
  return {
    userData: { segmentsX, segmentsY },
    groups: [{ start: 0, count: segmentsX * segmentsY * 6, materialIndex: 0 }],
    getAttribute(name) { return name === 'position' ? { count } : null; },
    setDrawRange(start, count) { this.drawRange = { start, count }; },
    dispose() { this.disposed = true; },
  };
}
function buildSkinnedPlaneGeometry(THREE, width, height, neckLocal, options) {
  builds.push({ THREE, width, height, neckLocal, options });
  return geometry(options.segmentsX, options.segmentsY, options.frontOnly);
}
class TestWeakRef { constructor(value) { this.value = value; } deref() { return this.value; } }
const events = [];
const windowStub = {
  localStorage: { getItem: () => null, setItem: () => {} },
  dispatchEvent(event) { events.push(event.type); },
};
const { meshBudget, registerSkinnedPortrait } = vm.runInNewContext(
  '(() => { ' + portraitSource.slice(begin, end) + ' return { meshBudget, registerSkinnedPortrait }; })()',
  { window: windowStub, WeakRef: TestWeakRef, Event: class { constructor(type) { this.type = type; } }, buildSkinnedPlaneGeometry },
  { filename: 'png-plane-avatar.js:mesh-budget' },
);

assert.equal(meshBudget.portraitDensityPercent(), 100, 'starts at unchanged production resolution');
assert.equal(meshBudget.portraitGrid('full').segmentsX, 28);
assert.equal(meshBudget.portraitGrid('npc').segmentsY, 26);
assert.equal(meshBudget.resolve('npc').pantsSegments, 32, 'portrait density leaves pants budget intact');
assert.equal(meshBudget.resolve('npc').animalSegments, 30, 'portrait density leaves animal budget intact');

const skeleton = { id: 'live-rig' }; // Shared with mesh to prove no replacement/rebind happens.
const pose = { x: 4, y: 7, z: 0 }; // Existing in-game transform must survive retessellation unchanged.
const THREE = { id: 'renderer' };
const neckLocal = { x: 0, y: 1, z: 0 };
const headBoundsPx = { left: 2, right: 8, top: 3, bottom: 9 };
const player = { geometry: geometry(28, 36), skeleton, position: pose };
const enemy = { geometry: geometry(34, 44, true), skeleton: { id: 'enemy' } };
const previousPlayerGeometry = player.geometry;
const previousEnemyGeometry = enemy.geometry;
registerSkinnedPortrait(player, THREE, 2, 3, neckLocal, { pixelWidth: 120, pixelHeight: 160, headBoundsPx }, 'full');
registerSkinnedPortrait(enemy, THREE, 1, 1, neckLocal, { pixelWidth: 80, pixelHeight: 80, frontOnly: true, headBoundsPx }, 'npc', true);
assert.equal(meshBudget.portraitDensityDebug().tracked, 2);

assert.equal(meshBudget.setPortraitDensityPercent(50), true, 'slider applies a new percentage');
assert.equal(player.geometry.userData.segmentsX, 14, 'full portrait X dimensions scale');
assert.equal(player.geometry.userData.segmentsY, 18, 'full portrait Y dimensions scale');
assert.equal(player.geometry.getAttribute('position').count / 3, 1008, 'two-sided player portrait has quarter as many triangles');
assert.equal(enemy.geometry.userData.segmentsX, 17, 'head-mask special budget scales');
assert.equal(enemy.geometry.userData.segmentsY, 22);
assert.equal(enemy.geometry.getAttribute('position').count / 3, 748, 'enemy front-only grid has 17x22x2 triangles');
assert.deepEqual(enemy.geometry.drawRange, { start: 0, count: 17 * 22 * 6 }, 'front-only draw range updates');
assert.equal(builds[0].options.headBoundsPx, headBoundsPx, 'same original head-scale weight gate reused');
assert.equal(player.skeleton, skeleton, 'live player skeleton is not replaced');
assert.equal(player.position, pose, 'live player position/pose is not reset');
assert.equal(previousPlayerGeometry.disposed, true, 'retired player GPU geometry disposed');
assert.equal(previousEnemyGeometry.disposed, true, 'retired enemy GPU geometry disposed');
assert.equal(meshBudget.portraitDensityDebug().lastRebuilt, 2);
assert.equal(meshBudget.setPortraitDensityPercent(50), false, 'identical slider value does not rebuild');
assert.equal(builds.length, 2);
assert.equal(meshBudget.setPortraitDensityPercent(NaN), false, 'bad input is ignored');
assert.equal(meshBudget.setPortraitDensityPercent(0), true, 'out-of-range value clamps');
assert.equal(meshBudget.portraitDensityPercent(), 20);
assert.equal(meshBudget.portraitGrid('npc').segmentsX, 4, 'minimum still permits a valid weighted grid');
assert.equal(meshBudget.portraitGrid('npc').segmentsY, 6);
assert.equal(meshBudget.setPortraitDensityPercent(100), true, 'original resolution restored without recreating actors');
assert.equal(player.geometry.userData.segmentsX, 28);
assert.equal(player.geometry.userData.segmentsY, 36);
assert.equal(meshBudget.portraitDensityDebug().triangles, 4032 + 2992, 'diagnostics count actual current geometry');
assert.equal(events.filter(event => event === 'hobunji:portrait-density-changed').length, 3);

assert(uiSource.includes("densitySlider.type = 'range'"), 'dev UI has a real range input');
assert(uiSource.includes("densityRow.setAttribute('data-dev-only', '')"), 'slider is hidden outside developer mode');
assert(uiSource.includes('portraitBudget.setPortraitDensityPercent(Number(densitySlider.value))'), 'the UI uses the production budget authority');
assert(devSource.includes('meshBudget?.setPortraitDensityPercent?.(100)'), 'leaving developer mode restores normal portrait detail');

console.log('OK: dev portrait density changes player/enemy skin grids live without pose or skeleton rebuild, while pants/animal budgets stay untouched.');
