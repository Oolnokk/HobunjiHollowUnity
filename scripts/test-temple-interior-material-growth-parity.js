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
const townBuildingRuntime = read('docs/js/town-zone-buildings.js'); // Provides the actual town-roof tint and shared shingle variant.
const houseEditor = read('docs/tools/house-piece-author/index.html'); // Checks author preview support.
const liveRootAuthor=read('docs/tools/live-root-growth/tool.js'); // Identifies the root palette used by the live growth author.

assert.deepEqual(templeInterior.floorStyle, {
  texture: 'carved_smooth.png', tint: '#8c8c8c', tilesPerTile: 0.75,
}, 'temple floor must retain the chosen in-game finish');
const iRugs = templeInterior.furniture.filter(piece => piece.itemKey === 'rugFurniture'); // Finds the original aisle rug without altering its motifs.
assert(iRugs.length > 0 && iRugs.some(piece => Object.keys(piece.patternOverrides || {}).length > 0),
  'the original authored rug/overpass color settings must survive');
const exteriorWalls=templeExterior.surfaceGrowth.filter(recipe=>recipe.target==='walls');
const interiorWalls=templeInterior.surfaceGrowth.filter(recipe=>recipe.target==='walls');
assert.equal(templeExterior.surfaceGrowth.length,4,'Latest Temple exterior has three wall layers plus the shingle layer');
assert.deepEqual(interiorWalls,exteriorWalls.map(recipe=>({...recipe,inset:recipe.inset === 0 ? 0 : -recipe.inset})),
  'Temple interior mirrors exterior wall layers except for their inverted signed insets');
assert.deepEqual(interiorWalls.map(recipe=>[recipe.kind,recipe.style,recipe.density,recipe.strandLimit]),[
  ['roots','cornerFill',.45,80],['vines','wrap',.1,40],['roots','wrap',.4,12]
], 'Temple foliage matches the newest authored wall roots and edge-to-edge vines');
assert(interiorWalls.every(recipe=>recipe.perSurface&&recipe.length>=12&&recipe.radius>=.075),
  'Temple interior layers must preserve independent surface budgets and current tube sizes');
assert.equal(templeExterior.base.faces.length,67,'Supplied temple layout must retain its authored cross-gable, entry and wall sections');
assert.equal(templeExterior.wallFixtures.length,4,'All four stained-glass windows must survive the growth updates');
assert.equal(templeExterior.roof.flipY,true,'Latest temple flips the first shingle layer on Y');
assert.equal(templeExterior.roof.shingleScaleY,1,'Latest first shingle layer has authored Y scale');
assert.equal(templeExterior.roof.secondLayerWallOriginReach,true,'Latest second-layer shingles reach wall origin');
assert.equal(templeExterior.roof.secondLayerShingleScaleY,1.5,'Latest second shingle layer has authored Y scale');
assert.equal(interiorWalls[0].seed,'surface-2','Latest Corner Fill root seed must survive');
assert.equal(interiorWalls[0].count,48,'Latest Corner Fill root count must survive');
assert.equal(interiorWalls[0].radius,.2,'Latest Corner Fill root thickness must survive');
assert.equal(interiorWalls[0].curl,1.4,'Latest Corner Fill root curl must survive');
assert.equal(interiorWalls[0].inset,.25,'Temple interior Corner Fill roots must invert the exterior inset');
assert.equal(interiorWalls[2].radius,.175,'Latest Wrap root thickness must survive');
assert.equal(interiorWalls[2].inset,.1,'Temple interior Wrap roots must invert the exterior inset');
assert(interiorWalls.every(recipe => recipe.shrinkwrapFinal && recipe.tunnelAsOpening),
  'Both Temple wall vegetation contexts must retain shrinkwrap and entrance-opening settings');
const townShingleFill=townBuildingRuntime.match(/const TOWN_SHINGLE_FILL = '(#[0-9a-f]{6})'/i)?.[1];
assert.equal(townShingleFill,'#0e0d06','The actual town/zone roof tint must remain the near-black brown');
assert.match(townBuildingRuntime, /tintShingleMaterial\('assets\/textures\/carved_smooth\.png', TOWN_SHINGLE_FILL, 'town'\)/,
  'Town houses must use carved-smooth shingles in their own standard shared variant');
assert.match(townBuildingRuntime, /shingleVariant: 'town'/,
  'Town-building geometry must select the shared town shingle variant');
assert.equal(Object.hasOwn(templeExterior.roof,'shingleMaterial'),false,
  'Temple must inherit the standard town-house roof finish instead of overriding it');
const authorRootColor=liveRootAuthor.match(/rootColor:'(#[0-9a-f]{6})'/i)?.[1]; // Root swatch is the tint authority for both Temple wall recipes.
assert.equal(authorRootColor,'#24211d','Live-root author must retain the selected Temple bark tint');
assert.notEqual(authorRootColor,townShingleFill,'Temple wall roots no longer inherit the town roof tint');
assert.equal(interiorWalls.filter(recipe=>recipe.kind==='roots').length,2);
for (const recipe of [...templeExterior.surfaceGrowth,...templeInterior.surfaceGrowth].filter(recipe=>recipe.kind==='roots')) {
  assert.equal(recipe.color,authorRootColor,'Interior and exterior Temple wall roots must use the live-root author tint');
  assert.equal(recipe.texture,'assets/textures/wibbly_surface.png',
    'Temple roots must keep the wibbly root texture instead of using the town shingle PNG');
}
assert(templeExterior.surfaceGrowth.filter(recipe=>recipe.kind==='vines').every(recipe=>recipe.color==='#406040'),
  'Retinting roots must not modify the Temple vine colors');
assert(shingleBuilder.includes("painter.naturalizeMesh(proxy,'trunks','strand-stretch'"),
  'Gameplay roof finishes must use the same unlit body-sprite-tint material path as roots');
assert(shingleBuilder.includes("tintTreatment:'body-sprite-tint'"),
  'Gameplay roof finishes must recolor PNG pixels rather than multiplying GLB material colors');
assert(houseEditor.includes("painter.naturalizeMesh(proxy,'trunks','strand-stretch'"),
  'House Editor must preview the same roots/shingles tint method as gameplay');
assert(houseEditor.includes("const TOWN_ROOF_DEFAULT={texture:'assets/textures/carved_smooth.png',color:'#0e0d06'}"),
  'House Editor must have the same town roof PNG and tint as the runtime');
assert(houseEditor.includes("townDefault=!config.shingleMaterial&&state.piece?.id===TEMPLE_ROOF_PIECE_ID"),
  'Temple must preview town shingles without saving an override');
assert(houseEditor.includes("mode:'shadeFill',rgb:[rgb.r,rgb.g,rgb.b],options:window.getPortraitTintingConfig()"),
  'Temple town-roof preview must use the actual town adaptive shade-fill recoloring');
assert(houseEditor.includes("shingleVariant:'town'"),
  'The Temple Game Preview must use the production town variant');
assert(houseEditor.includes("const templeUsesTownShingles=piece.id===TEMPLE_ROOF_PIECE_ID&&!piece.roof?.shingleMaterial"),
  'Per-piece custom roofs must still take precedence in the Temple Game Preview');
const shingleVines = templeExterior.surfaceGrowth.find(recipe => recipe.seed === 'temple-highland-shingle-weave'); // The author's newest shingle weave intentionally includes all house surfaces.
assert.equal(shingleVines?.target, 'all','The latest weave targets all architectural surfaces, including shingles');
assert.equal(shingleVines?.kind, 'vines');
assert.equal(shingleVines?.style,'wrap');
assert.equal(shingleVines?.density,.35);
assert.equal(shingleVines?.strandLimit,20);
assert.equal(shingleVines?.radius,.1);
assert.equal(shingleVines?.shrinkwrapFinal,true);
assert.equal(shingleVines?.perSurface,true);
assert(!interiorWalls.some(recipe => recipe.seed === shingleVines.seed),
  'The all-surface exterior shingle weave must not be duplicated inside the temple');
assert(foliage.includes("'shingles', 'selected'"), 'growth normalization must retain dedicated roof-target support');
assert(foliage.includes("settings.target === 'shingles'"), 'dedicated shingle growth must still follow only eligible roof triangles');
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
