const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/banubu-cave-clouds.js', 'utf8'); // Exercises the cave-only preflight for the reported missing UV matrix.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Confirms the preflight runs before Banubu's scene is registered.
const interiorBuilder = fs.readFileSync('docs/js/interior-scene-builder.js', 'utf8'); // Guards Banubu's opt-in farm-cliff material + surface-stretch path.
const cavernGenerator = fs.readFileSync('docs/js/cavern-generator.js', 'utf8'); // Guards propagation of locale-authored surface material metadata.
const banubuLocale = JSON.parse(fs.readFileSync('docs/config/locales/locale_banubu_cave_interior.json', 'utf8')); // Authoritative cave material selection.
const logs = []; // Captures the existing in-game render diagnostic for a malformed map.
const windowObject = { __farmLog: message => logs.push(message) };
const context = { window: windowObject, Map };
vm.createContext(context);
vm.runInContext(source, context);

const valid = { isTexture: true, matrix: { elements: [1, 0, 0, 0, 1, 0, 0, 0, 1] } }; // A normal Three texture must retain its UV transform.
const missingMatrix = { isTexture: true, matrixAutoUpdate: true }; // Reproduces the attachment's Matrix3.copy(undefined) failure.
const material = { map: missingMatrix, aoMap: valid, lightMap: { bogus: true } }; // Verifies the primary and secondary UV paths independently.
const cave = { traverse: visit => visit({ name: 'cavern', material }) }; // Minimal scene visitor used by the preflight.
const THREE = { Matrix3: class Matrix3 { constructor() { this.elements = [1, 0, 0, 0, 1, 0, 0, 0, 1]; } } };

assert.equal(windowObject.BanubuCaveClouds.validateCaveMaterials({ THREE, scene: cave, mapData: { id: 'other' } }), 0);
assert.equal(missingMatrix.matrix, undefined, 'unrelated interiors are untouched');
assert.equal(windowObject.BanubuCaveClouds.validateCaveMaterials({ THREE, scene: cave, mapData: { id: 'map_i_den_banubu' } }), 2);
assert(missingMatrix.matrix?.elements, 'a texture missing its matrix gets a valid identity UV transform');
assert.equal(missingMatrix.matrixAutoUpdate, false, 'the repaired transform is not sent through incomplete updateMatrix state');
assert.equal(material.aoMap, valid, 'valid textures are preserved');
assert.equal(material.lightMap, null, 'an invalid secondary map is removed before the renderer reads its matrix');
assert.equal(material.needsUpdate, true, 'material recompiles when an invalid map is removed');
assert.equal(logs.length, 2, 'each repair is recorded once through the existing render log');
assert.equal(windowObject.BanubuCaveClouds.validateCaveMaterials({ THREE, scene: cave, mapData: { id: 'map_i_den_banubu' } }), 0);
assert(game.includes('BanubuCaveClouds?.validateCaveMaterials?.({ THREE, scene: bScene, mapData })'));
assert.equal(banubuLocale.cavern.surfaceMaterial, 'farm-cliff', 'Banubu alone opts the carved shell into farm-cliff parity');
assert.match(cavernGenerator, /generated\.mesh\.surfaceMaterial = surfaceMaterial/, 'locale cavern synthesis carries the authored surface preset into the renderer');
assert.match(interiorBuilder, /natural\.naturalizeMesh\(mesh, 'rocks', 'planar-stretch'\)/, 'farm-cliff cave surfaces use the same canonical rock material factory as farm cliffs');
assert.match(interiorBuilder, /HobunjiSurfaceStretchUV/, 'farm-cliff cave surfaces reuse the central connected-surface detector');
assert.match(interiorBuilder, /mapper\.mapMesh\(mesh, \{ label: 'interior-cavern:farm-cliff', maxPatchWorldSize: 6 \}\)/, 'each detected cave surface uses the farm-scale stretch-to-fit mapper');

console.log('Banubu cave texture matrix preflight checks passed.');
