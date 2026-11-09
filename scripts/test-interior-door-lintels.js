'use strict';
const assert = require('node:assert/strict'); // Verifies shared game/editor wall panels remain aligned with authored doors.
const fs = require('node:fs'); // Reads the live wall generator and door geometry rather than duplicated test implementations.
const vm = require('node:vm'); // Exercises the production browser module without WebGL.
const source = fs.readFileSync('docs/js/interior-scene-builder.js', 'utf8'); // Same shared builder used by game, Interior Editor, and cutscene previews.
const door = JSON.parse(fs.readFileSync('docs/config/furniture-authored/woodenDoor.json', 'utf8')); // Authoritative physical doorway header.
const host = { THREE: {} }; // The generation methods use no Three.js geometry at panel-list time.
vm.runInNewContext(source, { window: host, console });
const builder = host.InteriorSceneBuilder; // Shared renderer API under test.
assert(builder?.buildWallPanels && builder?.buildRoomWallPanels);
const header = door.parts.find(part => part.name === 'Doorway Header'); // Header's quarter-turn puts its local X thickness vertically.
assert(header);
assert(Math.abs(Math.abs(header.transform.rz) - 90) < .1);
const headerTop = header.transform.y + header.transform.sx / 2; // Detects authored changes that invalidate the common door/lintel seam.
assert(builder.DOORWAY_TOP_Y >= headerTop);
assert(builder.DOORWAY_TOP_Y - headerTop < .02);
const floor = (width, height) => new Set(Array.from({ length: width * height }, (_, index) => `${index % width},${Math.floor(index / width)}`)); // Produces a filled footprint with known boundary edges.
const eps = 1e-8;
const close = (actual, expected) => assert(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);
const comparePanel = (panel, {width, height, x, y, z}) => { // Asserts actual wall dimensions and base positions; not just a naming convention.
  close(panel.width, width); close(panel.height, height); close(panel.position[0], x); close(panel.position[1], y); close(panel.position[2], z);
};

const noExit = builder.buildWallPanels(floor(3, 3), new Set(), 3.5); // Ordinary walls must stay full-height and run-merged.
assert.equal(noExit.length, 4);
assert(noExit.every(panel => panel.height === 3.5 && panel.position[1] === 0));

const single = builder.buildWallPanels(floor(3, 3), new Set(['1,0']), 3.5); // North exit opens only through the physical frame height.
const northLintel = single.filter(panel => panel.id.startsWith('wn_lintel_'));
assert.equal(northLintel.length, 1);
comparePanel(northLintel[0], {width: 1, height: 3.5 - builder.DOORWAY_TOP_Y, x: 1.5, y: builder.DOORWAY_TOP_Y, z: 0});
assert.equal(single.filter(panel => panel.id.startsWith('wn_') && !panel.id.includes('lintel')).length, 2);
assert(single.some(panel => panel.id.startsWith('ws_') && panel.width === 3 && panel.height === 3.5));

const paired = builder.buildWallPanels(floor(4, 3), new Set(['1,0', '2,0']), 3.5); // A two-tile doorway shares one uninterrupted overhead panel.
const pairedLintel = paired.filter(panel => panel.id.startsWith('wn_lintel_'));
assert.equal(pairedLintel.length, 1);
comparePanel(pairedLintel[0], {width: 2, height: 3.5 - builder.DOORWAY_TOP_Y, x: 2, y: builder.DOORWAY_TOP_Y, z: 0});
assert.equal(paired.filter(panel => panel.id.startsWith('wn_') && !panel.id.includes('lintel')).length, 2);

const east = builder.buildWallPanels(floor(3, 4), new Set(['2,1', '2,2']), 3.5); // Rotated doorway lintels must use the wall's Z span and orientation.
const eastLintel = east.filter(panel => panel.id.startsWith('we_lintel_'));
assert.equal(eastLintel.length, 1);
comparePanel(eastLintel[0], {width: 2, height: 3.5 - builder.DOORWAY_TOP_Y, x: 3, y: builder.DOORWAY_TOP_Y, z: 2});
assert.equal(eastLintel[0].rotationDeg[1], -90);

const internal = builder.buildWallPanels(floor(3, 3), new Set(['1,1']), 3.5); // An interior exit trigger does not punch a wall.
assert.equal(internal.length, noExit.length);
const shortRoom = builder.buildWallPanels(floor(3, 3), new Set(['1,0']), 1.1); // Low ceilings leave existing door gaps unfilled.
assert.equal(shortRoom.filter(panel => panel.id.includes('lintel')).length, 0);
const normalHeight = builder.buildWallPanels(floor(3, 3), new Set(['1,0']), 1.75);
assert.equal(normalHeight.filter(panel => panel.id.includes('lintel')).length, 1);
close(normalHeight.find(panel => panel.id.includes('lintel')).position[1] + normalHeight.find(panel => panel.id.includes('lintel')).height, 1.75);

for (const transition of [{ col: 2, row: 4 }, { col: 4, row: 2 }]) { // Legacy rectangular rooms also retain overhead wall above south/east exits.
  const panels = builder.buildRoomWallPanels(5, 5, 3.5, transition);
  const lintel = panels.find(panel => panel.id.endsWith('_lintel'));
  assert(lintel, 'rectangular room exit must receive an overhead panel');
  close(lintel.width, 2);
  close(lintel.position[1], builder.DOORWAY_TOP_Y);
  close(lintel.position[1] + lintel.height, 3.5);
}
assert(!builder.buildRoomWallPanels(5, 5, 1.1, {col:2,row:4}).some(panel => panel.id.endsWith('_lintel')));
console.log('Doorway lintels: height matches authored woodenDoor, all orientations and room formats passed.');
