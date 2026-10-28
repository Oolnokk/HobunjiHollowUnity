// Regression guard for the temple's authored rug, floor style, and surface growth.
'use strict';
const assert = require('node:assert/strict'); // Used by each parity invariant below.
const fs = require('node:fs'); // Reads checked-in editor/runtime/map files.
const read = path => fs.readFileSync(path, 'utf8'); // Resolves repository-relative files for the assertions.
const templeInterior = JSON.parse(read('docs/config/maps/map_i_temple.json')); // Interior floor and root recipe authority.
const templeExterior = JSON.parse(read('docs/config/pieces/temple.json')); // Exterior authored growth and shingle-vine recipe authority.
const editor = read('docs/tools/building-interior-author/index.html'); // Verifies the editor shares the game furniture runtime.
const floorControls = read('docs/js/interior-fire-floor-integration.js'); // Ensures floor selection and authoring are active.
const foliage = read('docs/js/foliage-generator.js'); // Checks shingle-target normalization and surface following.
const shingleBuilder = read('docs/js/HousePieceGen.js'); // Checks roof mesh tagging in both build paths.
const houseEditor = read('docs/tools/house-piece-author/index.html'); // Checks author preview support.

assert.deepEqual(templeInterior.floorStyle, {
  texture: 'carved_smooth.png', tint: '#8c8c8c', tilesPerTile: 0.75,
}, 'temple floor must retain the chosen in-game finish');
const iRugs = templeInterior.furniture.filter(piece => piece.itemKey === 'rugFurniture'); // Finds the original aisle rug without altering its motifs.
assert(iRugs.length > 0 && iRugs.some(piece => Object.keys(piece.patternOverrides || {}).length > 0),
  'the original authored rug/overpass color settings must survive');
const exteriorRoots=templeExterior.surfaceGrowth.find(recipe=>recipe.kind==='roots'&&recipe.target==='walls');
const exteriorVines=templeExterior.surfaceGrowth.find(recipe=>recipe.kind==='vines'&&recipe.target==='walls');
const roots=templeInterior.surfaceGrowth.find(recipe=>recipe.kind==='roots'&&recipe.target==='walls');
const vines=templeInterior.surfaceGrowth.find(recipe=>recipe.kind==='vines'&&recipe.target==='walls');
assert.deepEqual(roots,exteriorRoots,'Temple interior must use the exact exterior wall-root recipe');
assert.deepEqual(vines,exteriorVines,'Temple interior must use the exact exterior wall-vine recipe');
assert.equal(roots.style,'cornerFill');
assert.equal(vines.style,'natural');
for(const recipe of [roots,vines]){
  assert.equal(recipe.count,80);
  assert.equal(recipe.strandLimit,80);
  assert.equal(recipe.perSurface,true);
  assert.equal(recipe.length,12);
  assert.equal(recipe.radius,.1);
}
assert.equal(templeExterior.base.faces.length,67,'Supplied temple layout must retain its authored cross-gable, entry and wall sections');
assert.equal(templeExterior.wallFixtures.length,4,'All four stained-glass windows must survive the growth updates');
const shingleVines = templeExterior.surfaceGrowth.find(recipe => recipe.target === 'shingles'); // Keeps fine vines distinct from thick roots.
assert.equal(shingleVines?.kind, 'vines');
assert(shingleVines.count > 0 && shingleVines.radius < 0.15);
assert(foliage.includes("'shingles', 'selected'"), 'growth normalization must accept shingle targets');
assert(foliage.includes("settings.target === 'shingles'"), 'shingle growth must follow only eligible roof triangles');
assert.equal(shingleBuilder.split("shingleLayer.userData.surfaceFoliageRole = 'shingles'").length - 1, 2,
  'both house-generation paths must tag their real roof geometry');
assert(houseEditor.includes("['shingles','Highland roof shingles']"), 'the House Editor must expose the new growth target');
for (const name of ['authored-furniture-runtime.js', 'furniture-vessel-runtime.js']) {
  assert(editor.includes(name), `the interior editor must load ${name} to match the game`);
}
assert(editor.indexOf('authored-furniture-runtime.js') < editor.indexOf('furniture-vessel-runtime.js'),
  'authored mesh loading must precede the live upgrade bridge');
assert(floorControls.includes('Carved stone (temple)') && floorControls.includes('id="biaFloorTexture"'),
  'the floor picker must expose the temple material');
assert(floorControls.includes('interior.floorStyle = style'), 'the selected floor must export with the map');
// Drive the actual shared floor builder with controlled asynchronous texture callbacks.
// A late default board/mine texture must never replace an authored floor PNG.
const vm = require('node:vm'); // Runs the production floor builder without a browser or WebGL.
const pending = []; // Captures pending default PNG callbacks so tests can reverse their arrival order.
class TestColor {
  constructor(value) { this.value = value; }
  set(value) { this.value = value; }
}
class TestMaterial {
  constructor(options) { this.color = new TestColor(options.color); this.userData = {}; this.map = null; }
}
class TestLoader {
  load(url, complete) { pending.push({ url, complete }); }
}
const fakeThree = { MeshLambertMaterial: TestMaterial, TextureLoader: TestLoader,
  RepeatWrapping: 'repeat', SRGBColorSpace: 'srgb' }; // Supplies exactly the floor-material dependencies.
const mockWindow = { THREE: fakeThree }; // Receives the real exported InteriorSceneBuilder module.
vm.runInNewContext(read('docs/js/interior-scene-builder.js'), {
  window: mockWindow, console, URL, document: { currentScript: { src: 'https://example.test/docs/js/interior-scene-builder.js' } },
});
for (const wallStyle of ['', 'mine']) {
  const before = pending.length;
  const mat = mockWindow.InteriorSceneBuilder.buildFloorMaterial(fakeThree, wallStyle, 'assets/');
  assert.equal(pending.length, before + 1, 'base floor must still request its normal texture');
  const originalAuthored = { id: 'custom-temple-floor' }; // Models an authored floor texture applied while the base PNG is loading.
  mat.map = originalAuthored;
  mat.userData.hobunjiFloorStyleSignature = 'authored-style-signature';
  let disposed = false; // Verifies an ignored late default texture doesn't leak GPU ownership.
  pending[before].complete({ dispose() { disposed = true; } });
  assert.strictEqual(mat.map, originalAuthored, 'late base texture must not overwrite an authored floor');
  assert.equal(disposed, true);
  assert.equal(mat.userData.floorDefaultTextureSkipped, true);
}
const normal = mockWindow.InteriorSceneBuilder.buildFloorMaterial(fakeThree, '', 'assets/');
const fresh = { wrapS: '', wrapT: '' }; // Base floors without authored styles must still load normally.
pending[pending.length - 1].complete(fresh);
assert.strictEqual(normal.map, fresh);
assert.equal(normal.color.value, 0xffffff);
console.log('Temple editor and materials: floor texture race, growth, and shared rendering-path tests passed.');
