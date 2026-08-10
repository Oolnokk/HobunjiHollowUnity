#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Guards shared outdoor management and NPC seat integration.
const legSource = fs.readFileSync('docs/js/procedural-leg-animation.js', 'utf8'); // Guards the NPC avatar-sink measurement and seated anatomy math.
const dewVatSource = fs.readFileSync('docs/js/dew-vats.js', 'utf8'); // Guards assignment migration when a processor moves.
const inn = JSON.parse(fs.readFileSync('docs/config/maps/map_i_inn.json', 'utf8'));
const generalStore = JSON.parse(fs.readFileSync('docs/config/maps/map_i_general_store.json', 'utf8'));
const kunjiF1 = JSON.parse(fs.readFileSync('docs/config/maps/map_i_kunjis_potions_F1.json', 'utf8'));
const kunjiF2 = JSON.parse(fs.readFileSync('docs/config/maps/map_i_kunjis_potions_F2.json', 'utf8'));
const temple = JSON.parse(fs.readFileSync('docs/config/maps/map_i_temple.json', 'utf8'));
const stationById = (map, id) => map.npcStations.find(station => station.id === id);

assert.match(gameSource,
  /function moveProcessingFurniture[\s\S]{0,900}worldObjects\.delete[\s\S]{0,500}worldObjects\.set[\s\S]{0,300}retargetAssignments[\s\S]{0,200}saveFarmLayout\(\)/,
  'processors can move without rebuilding or losing their active object state');
assert.match(gameSource,
  /function rotateProcessingFurniture[\s\S]{0,500}obj\.mesh\.rotation\.y[\s\S]{0,200}saveFarmLayout\(\)/,
  'processor rotation is applied and persisted');
assert.match(gameSource,
  /function removeProcessingFurniture[\s\S]{0,400}obj\.getJob\?\.\(\)[\s\S]{0,600}returned to inventory/,
  'idle processors can be removed while active aging jobs are protected');
assert.match(dewVatSource,
  /function retargetAssignments[\s\S]{0,500}rec\.assignedVatId = newVatId[\s\S]{0,300}saveWorldLivestock/,
  'moving or removing a squeezing vat updates persistent livestock assignments');
assert.match(gameSource,
  /layout\.furniture\.push\(\{ key: obj\.furnitureKey, col: obj\.col, row: obj\.row, rotYDeg:[\s\S]{0,9000}makeProcessingFurniture\(col, row, key, job, rotYDeg \|\| 0\)/,
  'processor rotation round-trips through farm saves');

const stools = inn.furniture.filter(item => item.itemKey === 'stoolFurniture'); // All eight downstairs inn seats surround the two tables.
assert.equal(stools.length, 8, 'the inn still contains all eight stools');
const expectedRotations = new Map([
  ['fmqj09loev97n', 270], ['fmqj09mimuxmp', 90], ['fmqj09n8jvodq', 0], ['fmqj09nuf46cg', 180],
  ['fmqj09r8s0x0a', 180], ['fmqj09s9gcu2r', 270], ['fmqj09t02hklm', 0], ['fmqj09tmmlrts', 90],
]);
for (const stool of stools) assert.equal(stool.rotY, expectedRotations.get(stool.id), `${stool.id} is turned 180° toward its table`);

const authoredSeatBindings = [
  [generalStore, 'station_p2x4t', 'stoolFurniture', 0],
  [kunjiF1, 'station_0qpky', 'stoolFurniture', 0],
  [kunjiF1, 'station_kaboku_dayoff', 'benchFurniture', 0],
  [kunjiF1, 'station_kinami_dayoff', 'benchFurniture', 1],
  [kunjiF2, 'station_jayis', 'chairSimpleFurniture', 0],
  [kunjiF2, 'station_njyek', 'chairSimpleFurniture', 0],
  [temple, 'station_temple_pew_6', 'benchFurniture', 1],
  [temple, 'station_temple_pew_7', 'benchFurniture', 0],
  [temple, 'station_temple_pew_8', 'benchFurniture', 1],
  [temple, 'station_temple_pew_9', 'benchFurniture', 0],
  [temple, 'station_temple_pew_10', 'benchFurniture', 1],
  [temple, 'station_temple_pew_11', 'benchFurniture', 0],
];
for (const [map, id, furnitureKey, seatIndex] of authoredSeatBindings) {
  const station = stationById(map, id);
  assert(station, `${id} still exists`);
  assert.equal(station.pose, 'sit', `${id} remains a sit station`);
  assert.equal(station.furnitureKey, furnitureKey, `${id} identifies its actual seat furniture`);
  assert.equal(station.seatIndex, seatIndex, `${id} identifies the intended seat anchor`);
}
for (const id of ['station_temple_counsel_teacup', 'station_temple_counsel_ring_1', 'station_temple_counsel_ring_2', 'station_temple_counsel_ring_3', 'station_temple_counsel_ring_4', 'station_temple_counsel_ring_5', 'station_temple_counsel_ring_6']) {
  const station = stationById(temple, id);
  assert(station, `${id} still exists`);
  assert.equal(station.pose, 'sit', `${id} remains a floor-sit pose`);
  assert.equal(station.furnitureKey, undefined, `${id} is not incorrectly snapped onto furniture`);
}

assert.match(gameSource,
  /pose: 'sit', furnitureKey, seatIndex: 0/,
  'chair-propagated stations retain the source furniture needed to resolve an authored seat');
assert.match(gameSource,
  /npcSeatTransformForTarget[\s\S]{0,900}resolveSeatWorldTransform/,
  'NPCs reuse the player seat-anchor resolver');
assert.match(gameSource,
  /this\.legs\.update\(dt, this\._moveSpeedTiles, false, seatedPose\)/,
  'NPC legs receive the same seated-pose data as player legs');
assert.match(gameSource,
  /allowOccupiedTarget[\s\S]{0,500}c === targetC && r === targetR/,
  'NPC pathing allows the occupied chair only as its final destination');
assert.match(gameSource,
  /root\.position\.x = seatTransform\.x[\s\S]{0,500}seatTransform\.y - standingPosteriorY[\s\S]{0,400}seatTransform\.facingRad/,
  'seated NPC bodies align, lower, and face using the authored seat transform');
assert.match(gameSource,
  /root\.rotation\.y = this\.rot;[\s\S]{0,240}this\.legs\?\.group[\s\S]{0,120}rawRot - root\.rotation\.y/,
  'NPC portrait planes use deadzone facing while procedural feet retain exact logical facing');
assert.match(legSource, /standingPosteriorY: posteriorY/,
  'the procedural-leg handle exposes the standing posterior height for NPC chair sinking');
assert.match(legSource,
  /const standingPosteriorY = chain\.hip\.position\.y;[\s\S]{0,700}const fullLegLength = Math\.max\(0\.001, standingPosteriorY - contactY\);/,
  'seated bone lengths stay tied to the character posterior-to-foot anatomy instead of chair height');
assert.match(legSource,
  /planePoint: new THREE\.Vector3\(posteriorX, posteriorY, 0\)/,
  'the seated surface plane is solved in the post-sink avatar-local posterior frame');
assert.doesNotMatch(legSource,
  /const posteriorY = \(Number\.isFinite\(seatY\)[\s\S]{0,250}const fullLegLength/,
  'floor-relative seat height never replaces the character posterior when calculating bone length');

console.log('outdoor furniture management and NPC seating tests passed');
