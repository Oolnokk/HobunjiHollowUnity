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
assert.equal(test.headingFromDirection({ x: 1, z: 0 }), 0, 'camera facing east should center east');
assert(Math.abs(test.headingFromDirection({ x: 0, z: 1 }) - Math.PI / 2) < 1e-9, 'camera facing south should center south');
assert(Math.abs(test.headingFromDirection({ x: 0, z: -1 }) + Math.PI / 2) < 1e-9, 'camera facing north should center north');
assert.equal(test.headingFromDirection({ x: 0, z: 0 }), null, 'vertical/degenerate camera direction should not produce a horizontal heading');

// activeCameraAzimuth is the target-to-camera THREE.js Y rotation used by
// normal farm rendering. Verify its conversion into the opposite camera-look
// bearing consumed by the compass.
assert(Math.abs(test.headingFromCameraAzimuthDeg(0) + Math.PI / 2) < 1e-9, 'camera south of player should look north');
assert(Math.abs(Math.abs(test.headingFromCameraAzimuthDeg(90)) - Math.PI) < 1e-9, 'camera east of player should look west');
assert(Math.abs(test.headingFromCameraAzimuthDeg(-90)) < 1e-9, 'camera west of player should look east');
assert(Math.abs(test.headingFromCameraAzimuthDeg(180) - Math.PI / 2) < 1e-9, 'camera north of player should look south');
assert.equal(test.headingFromCameraAzimuthDeg(undefined), null, 'missing camera azimuth should fall through safely');

// Reproduces the farm bug: the true camera orbit changes while the gameplay
// aim ray and player.angle can still report the character's old facing.
context.__hobunjiFurnitureDebug = { activeCameraAzimuthDeg: -90 };
const farmCameraHeading = test.currentHeading({
  getPlayerAimRay: () => ({ direction: { x: 0, y: -0.4, z: -1 } }),
}, { angle: -Math.PI / 2 });
assert.equal(farmCameraHeading.source, 'camera-azimuth', 'farm compass must prefer true camera orbit over character-relative aim state');
assert(Math.abs(farmCameraHeading.heading) < 1e-9, 'orbiting the farm camera west of the player should make the compass look east even if character facing stays north');

delete context.__hobunjiFurnitureDebug;
const cameraHeading = test.currentHeading({
  getPlayerAimRay: () => ({ direction: { x: 0, y: -0.4, z: 1 } }),
}, { angle: -1.2 });
assert.equal(cameraHeading.source, 'camera-ray', 'compass heading should use the gameplay camera ray when direct camera azimuth is unavailable');
assert(Math.abs(cameraHeading.heading - Math.PI / 2) < 1e-9, 'camera pitch should not affect the horizontal compass heading');
const fallbackHeading = test.currentHeading({ getPlayerAimRay: () => null }, { angle: 0.75 });
assert.equal(fallbackHeading.source, 'player-fallback', 'character rotation should be used only while both camera sources are unavailable');
assert.equal(fallbackHeading.heading, 0.75, 'camera fallback should preserve the prior stable heading behavior');

const collected = test.collectTargets('zone');
assert.equal(collected.offAreaQuestTargets, 1, 'off-area quests should be counted for diagnostics');
assert(collected.targets.some(target => target.source === 'quest'), 'same-area quest NPC should be tracked');
assert(collected.targets.some(target => target.source === 'bounty'), 'located bounty should be tracked');
assert(collected.targets.some(target => target.source === 'den'), 'companion-sensed den should be tracked');
assert(!collected.targets.some(target => target.source === 'camp'), 'perceived camp duplicate should yield to nearby bounty marker');

console.log('navigation-compass tests passed');
