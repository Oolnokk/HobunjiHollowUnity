#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm'); // Runs the real cave-light conversion against representative portrait and deformable pants meshes.
const ghoul = JSON.parse(fs.readFileSync('docs/config/species/ghoul.json', 'utf8'));
const mine = fs.readFileSync('docs/js/town-mine.js', 'utf8');
const music = fs.readFileSync('docs/js/music-system.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
const npcPreview = fs.readFileSync('docs/js/npc-avatar-preview-utils.js', 'utf8');
const bandit = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
const pantsRenderer = fs.readFileSync('docs/js/pants-garment-renderer.js', 'utf8'); // Ensures animated fabric normals remain synchronized with the lit material.

assert.match(mine, /GHOUL_BGM_TRACK = \{[^}]*volumeMultiplier: 2/, 'Ghoul BGM requests 2x base volume');
assert.match(mine, /GHOUL_BGM_TRACK = \{[^}]*exclusiveSoundtrack: true/, 'Just Beyond the Torchlight reuses the existing exclusive soundtrack ownership during combat');
assert.match(music, /exclusiveSoundtrack === true/, 'music scheduler honors the existing exclusive soundtrack metadata generically');
assert.match(music, /baseVol \* trackVolMul/, 'music player consumes per-track volumeMultiplier');

for (const gender of ['male', 'female']) {
  const choices = ghoul[gender].bodyColorRanges.A.choices;
  assert.equal(choices.length, 4, `${gender} keeps four authored skin-tone families`);
  for (const choice of choices) {
    for (const stop of choice.range.stops) {
      assert.ok(stop.sMin > 0, `${gender} Ghoul skin no longer desaturates toward paper white`);
      assert.ok(stop.sMax >= 0.5, `${gender} Ghoul skin retains visible pink saturation`);
      assert.ok(stop.vMax <= 0, `${gender} Ghoul skin no longer receives a brightness boost toward white`);
    }
  }
}

assert.match(game, /randomSeed: `mine-ghoul:\$\{mapData\.mineFloor\}:\$\{spawn\.col\}:\$\{spawn\.row\}`/, 'mine Ghoul spawns use deterministic palette variation');
assert.doesNotMatch(game, /speciesId: 'ghoul'[^\n]*s: -0\.82/, 'old paper-white body-color override is gone');
assert.match(npcPreview, /appearance\.randomSeed \|\| `npc-json:/, 'NPC portrait builder accepts non-visible deterministic appearance seeds');
assert.match(bandit, /function makeGhoulAvatarMineLit/, 'Ghoul-specific mine lighting helper exists');
assert.match(bandit, /new THREE\.MeshLambertMaterial\(/, 'Ghoul mapped sprite planes are converted to lit materials');
assert.match(bandit, /speciesId === 'ghoul'\) makeGhoulAvatarMineLit\(avatarRef\)/, 'only Ghoul bandit-style avatars opt into cave lighting');

const lightingStart = bandit.indexOf('  function makeGhoulAvatarMineLit('); // Extracts the production conversion without loading the whole combat runtime.
const lightingEnd = bandit.indexOf('  function applyRosterDyesToProfile(', lightingStart); // Conversion helper's next sibling is its extraction boundary.
assert(lightingStart >= 0 && lightingEnd > lightingStart, 'Ghoul light conversion is independently testable');
let normalsComputed = 0; // Counts real geometry-normal calculation triggered during a ghoul's initial material conversion.
const baseMaterial = name => ({ isMeshBasicMaterial: true, name, map: { id: name }, color: { clone: () => '#cddff0' },
  onBeforeCompile: () => {}, customProgramCacheKey: () => 'pantsOverlayMask', dispose() {} }); // Models the existing canonical mapped PNG material, including the garment mask hook.
const pantsMesh = { isMesh: true, userData: { hobunjiPantsGarment: true },
  geometry: { computeVertexNormals() { normalsComputed++; } }, material: baseMaterial('ghoul-pants') }; // Dynamic garment deliberately starts without a normal attribute.
const portraitMesh = { isMesh: true, userData: {}, material: baseMaterial('ghoul-portrait') }; // Control portrait already has planar normals.
const group = { userData: {}, traverse: fn => [portraitMesh, pantsMesh].forEach(fn) }; // Production avatar traversal contains both the portrait and separate leg garment.
class Lambert { constructor(props) { Object.assign(this, props); this.isMeshLambertMaterial = true; } } // Only the class/type transition matters in this material-boundary test.
const lightingContext = { THREE: { MeshLambertMaterial: Lambert, Color: class {} } }; // Avoids requiring a WebGL context for lighting pipeline regression tests.
vm.runInNewContext(bandit.slice(lightingStart, lightingEnd) + ';this.makeMineLit=makeGhoulAvatarMineLit;', lightingContext);
assert.equal(lightingContext.makeMineLit({ group }).group, group, 'Ghoul avatar remains the original instance');
assert.equal(normalsComputed, 1, 'Ghoul pants gain vertex normals when changing to Lambert lighting');
assert.equal(pantsMesh.userData.hobunjiPantsLitNormals, true, 'Only the light-reactive pants mesh requests animated normal refresh');
assert.equal(pantsMesh.material.isMeshLambertMaterial, true, 'Pants and portrait now receive the same cave light');
assert.equal(portraitMesh.material.isMeshLambertMaterial, true, 'Portrait keeps cave illumination');
assert.equal(typeof pantsMesh.material.onBeforeCompile, 'function', 'Pants keep their existing portrait-overlap mask shader');
assert.equal(pantsMesh.material.customProgramCacheKey(), 'pantsOverlayMask', 'Ghoul material keeps the pants shader variant');
assert.match(pantsRenderer, /handle\.mesh\.userData\?\.hobunjiPantsLitNormals\) handle\.geometry\.computeVertexNormals\(\)/,
  'Pants rerender surface normals whenever a cave-lit enemy actually bends their legs');

console.log('Ghoul mine visual/audio tests passed');
