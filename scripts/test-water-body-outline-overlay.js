#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const overlaySource = fs.readFileSync('docs/js/water-body-outline-overlay.js', 'utf8');
const loaderSource = fs.readFileSync('docs/js/house-pieces.js', 'utf8');
const waterSystemSource = fs.readFileSync('docs/js/water-system.js', 'utf8');
const zoneSource = fs.readFileSync('docs/js/zone-terrain-features.js', 'utf8');

assert.match(overlaySource, /const OVERLAY_TEXTURE_URL = 'assets\/textures\/canvas\.png'/,
  'overlay should derive its black-only bank mask from canvas.png');
assert.match(overlaySource, /const SOURCE_EDGE_FRACTION = 0\.45/,
  'protected source band should keep the tuned 0.45 width');
assert.match(overlaySource, /const BLACK_EPSILON = 1/,
  'overlay must retain the prior near-exact black-pixel threshold');
assert.match(overlaySource, /mode: 'folded-water-surface-domain'/,
  'horizontal water should use the folded whole-surface domain');
assert.match(overlaySource, /mapping: 'folded-surface-extension'/,
  'waterfall curtains should use the same folded surface mapping');
assert.match(overlaySource, /allCurtainsIncluded: true/,
  'land-facing and water-facing waterfall curtains must both participate');
assert.match(overlaySource, /gridLockedSharedEdges: true/,
  'curtain shared edges must remain topology-locked to the water tile grid');
assert.match(overlaySource, /uWaterBodyOverlayTexture/,
  'water shader should get a separate overlay sampler');
assert.match(overlaySource, /aWaterBodyOverlayFlag/,
  'shared water material should gate the overlay per mesh/vertex');
assert.match(overlaySource, /waterBodyOverlayDoesNotReplaceBaseTexture: true/,
  'adapter must explicitly preserve the base water texture path');
assert.doesNotMatch(overlaySource, /wavy_surface\.png|wibbly_surface\.png/,
  'overlay adapter must not choose or replace the base water texture');
assert.match(waterSystemSource, /textureUrl:\s*'assets\/textures\/wibbly_surface\.png'/,
  'current-main water texture must remain unchanged');
assert.match(zoneSource, /neighborIsWater = nt\.type === deps\.TileType\.RIVER \|\| nt\.type === deps\.TileType\.STREAM \|\| nt\.type === deps\.TileType\.WATERFALL/,
  'current main should still build water-aware waterfall curtains');

const mapperAt = loaderSource.indexOf("['HobunjiSurfaceStretchUV', naturalSurfaceScript('surface-stretch-uv-furniture.js')"); // Used to verify the water overlay still loads after the coherently versioned natural-surface mapper.
const overlayAt = loaderSource.indexOf("['WaterBodyOutlineOverlay', 'water-body-outline-overlay.js");
assert.ok(mapperAt >= 0 && overlayAt > mapperAt,
  'water overlay must load after the shared irregular-surface mapper');
assert.equal((loaderSource.match(/WaterBodyOutlineOverlay/g) || []).length, 1,
  'loader should install exactly one water-body overlay module');

class Attribute {
  constructor(array, itemSize) {
    this.array = array instanceof Float32Array || array instanceof Uint16Array || array instanceof Uint32Array
      ? array : new Float32Array(array);
    this.itemSize = itemSize;
    this.count = this.array.length / itemSize;
    this.needsUpdate = false;
  }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
  setX(i, x) { this.array[i * this.itemSize] = x; return this; }
  setXY(i, x, y) { this.array[i * this.itemSize] = x; this.array[i * this.itemSize + 1] = y; return this; }
  setXYZ(i, x, y, z) {
    this.array[i * this.itemSize] = x;
    this.array[i * this.itemSize + 1] = y;
    this.array[i * this.itemSize + 2] = z;
    return this;
  }
  clone() { return new Attribute(this.array.slice(), this.itemSize); }
}
class BufferGeometry {
  constructor() { this.attributes = {}; this.index = null; this.userData = {}; this.disposed = false; }
  setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
  getAttribute(name) { return this.attributes[name] || null; }
  setIndex(index) { this.index = index; return this; }
  dispose() { this.disposed = true; }
}
class DataTexture {
  constructor() { this.needsUpdate = false; this.disposed = false; }
  dispose() { this.disposed = true; }
}
let textureLoadCount = 0;
class TextureLoader {
  load() { textureLoadCount++; }
}

const THREE = {
  BufferGeometry,
  Float32BufferAttribute: Attribute,
  BufferAttribute: Attribute,
  DataTexture,
  TextureLoader,
  RGBAFormat: 'rgba',
};
const sandboxWindow = {
  THREE,
  // Deliberately fail the expensive mapper in this Node fixture. buildDomain
  // must fall back to its own unfolded bounding-box seed while keeping the
  // exact folded topology/perimeter intact.
  HobunjiSurfaceStretchUV: { mapGeometry() { throw new Error('forced mapper fallback'); } },
};
sandboxWindow.window = sandboxWindow;
const sandbox = {
  window: sandboxWindow,
  console: { debug() {}, warn() {} },
  Map, Set, WeakMap, Float32Array, Uint8Array, Uint16Array, Uint32Array,
  Math, Number, Object, Infinity,
};
vm.runInNewContext(overlaySource, sandbox, { filename: 'water-body-outline-overlay.js' });

function waterShaderMaterial() {
  return {
    isShaderMaterial: true,
    userData: {},
    uniforms: { uWaterTexture: { value: { base: true } } },
    vertexShader:
      '        attribute vec2 aFlow;\n' +
      '        varying vec2 vFlow;\n' +
      '        void main() {\n' +
      '          vFlow = aFlow;\n' +
      '        }\n',
    fragmentShader:
      '        uniform sampler2D uWaterTexture;\n' +
      '        varying vec2 vFlow;\n' +
      '        void main() {\n' +
      '          vec3 textureColor = texture2D(uWaterTexture, vec2(0.0)).rgb;\n' +
      '          vec3 surfaceColor = textureColor;\n' +
      '          float flowSheen = 0.0;\n' +
      '          surfaceColor += flowSheen;\n' +
      '        }\n',
    needsUpdate: false,
  };
}
function oneTileGeometry(displacement = 0) {
  return new BufferGeometry()
    .setAttribute('position', new Attribute([
      0 + displacement, 0, 0 + displacement,
      0 + displacement, 0, 1 + displacement,
      1 + displacement, 0, 1 + displacement,
      1 + displacement, 0, 0 + displacement,
    ], 3))
    .setAttribute('uv', new Attribute([0,0, 0,0.25, 0.25,0.25, 0.25,0], 2))
    .setIndex(new Attribute(new Uint16Array([0,1,2, 0,2,3]), 1));
}
function geometryFromCells(cells, textureTileSize = 4) {
  if (!cells?.length) return oneTileGeometry();
  const positions = [], uvs = [], indices = [];
  let base = 0;
  for (const cell of cells) {
    const c = Number(cell.col), r = Number(cell.row);
    positions.push(c,0,r, c,0,r+1, c+1,0,r+1, c+1,0,r);
    uvs.push(
      c/textureTileSize, r/textureTileSize,
      c/textureTileSize, (r+1)/textureTileSize,
      (c+1)/textureTileSize, (r+1)/textureTileSize,
      (c+1)/textureTileSize, r/textureTileSize
    );
    indices.push(base,base+1,base+2, base,base+2,base+3);
    base += 4;
  }
  return new BufferGeometry()
    .setAttribute('position', new Attribute(positions, 3))
    .setAttribute('uv', new Attribute(uvs, 2))
    .setIndex(new Attribute(new Uint16Array(indices), 1));
}

const fakeRenderer = {
  DEFAULT_TEXTURE_TILE_SIZE: 4,
  stats: {
    dynamic: { textureTileSize: 4 },
    wilderness: { textureTileSize: 4 },
    'town river': { textureTileSize: 4 },
    'town dynamic': { textureTileSize: 4 },
  },
  createMaterial() { return waterShaderMaterial(); },
  createMesh(_three, material, cells, options = {}) {
    return { geometry: geometryFromCells(cells), material, userData: { mergedWaterStatKey: options.statKey || 'dynamic' } };
  },
};
sandboxWindow.MergedWaterRenderer = fakeRenderer;

const sharedMaterial = fakeRenderer.createMaterial();
assert.equal(sharedMaterial.userData.waterBodyOverlayPatched, true,
  'renderer wrapper should patch the shared water shader');
assert.ok(sharedMaterial.uniforms.uWaterTexture,
  'base water sampler must survive shader patching');
assert.ok(sharedMaterial.uniforms.uWaterBodyOverlayTexture,
  'separate overlay sampler must be installed');
assert.match(sharedMaterial.fragmentShader, /texture2D\(uWaterTexture/,
  'base water texture sampling must remain in the shader');
assert.match(sharedMaterial.fragmentShader, /texture2D\(uWaterBodyOverlayTexture/,
  'overlay should be sampled independently after base water shading');
assert.equal(textureLoadCount, 1,
  'first patched material should start exactly one outline-source texture load');

const dynamicCells = [{ col: 0, row: 0 }, { col: 1, row: 0 }];
const dynamicMesh = fakeRenderer.createMesh(THREE, sharedMaterial, dynamicCells, {
  name: 'town_merged_dynamic_water',
  statKey: 'town dynamic',
});
const dynamicFlags = dynamicMesh.geometry.getAttribute('aWaterBodyOverlayFlag');
assert.ok(dynamicFlags, 'all merged-water geometries need a safe overlay flag attribute');
assert.ok(Array.from(dynamicFlags.array).every(value => value === 0),
  'town rain/trench water must remain overlay-disabled');

const townRiverCells = [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 }];
const townRiverMesh = fakeRenderer.createMesh(THREE, sharedMaterial, townRiverCells, {
  name: 'town_merged_river_water',
  statKey: 'town river',
});
const townRiverFlags = Array.from(townRiverMesh.geometry.getAttribute('aWaterBodyOverlayFlag').array);
assert.ok(townRiverFlags.length === 12 && townRiverFlags.every(value => value === 1),
  'permanent town river vertices must receive the protected-band overlay');
assert.equal(townRiverMesh.userData.waterBodyOverlayScope, 'town-river');
assert.equal(townRiverMesh.userData.waterBodyOverlayTownRiver, true);
assert.equal(sandboxWindow.WaterBodyOutlineOverlay.isTownPermanentRiverOptions({
  name: 'town_merged_river_water', statKey: 'town river',
}), true);
assert.equal(sandboxWindow.WaterBodyOutlineOverlay.isTownPermanentRiverOptions({
  name: 'town_merged_dynamic_water', statKey: 'town dynamic',
}), false);

const townProbeLine = sandboxWindow.WaterBodyOutlineOverlay.formatPixelProbeLine(
  'Pixel Probe report\n0. "town_merged_river_water" dist=5.273 visible=true'
);
assert.match(townProbeLine, /sourceEdge=45%/,
  'water-specific diagnostics should expose the real protected-band setting');
assert.match(townProbeLine, /hit=town_merged_river_water/);
assert.match(townProbeLine, /hitScope=town-river-overlay/,
  'town permanent river should be identified as an active overlay target');
assert.doesNotMatch(townProbeLine, /sourceEdge=16%/,
  'water overlay diagnostics must not reuse the unrelated legacy natural-surface frame value');

const TileType = {
  RIVER: 'river',
  STREAM: 'stream',
  WATERFALL: 'waterfall',
  GRASS: 'grass',
};
sandboxWindow.ZoneTerrainFeatures = {
  init() {},
  buildZoneRiverWaterMeshes() { return []; },
  buildWaterfallCurtainMeshes() { return []; },
};
sandboxWindow.ZoneTerrainFeatures.init({ TileType, PLATEAU_UNIT: 2.5 });

const api = sandboxWindow.WaterBodyOutlineOverlay;
assert.equal(api.installed, true);

// A waterfall tile beside lower land is one horizontal water face plus one
// rotated curtain face. Their lip is shared topology, so two quads have six
// exposed perimeter edges rather than eight.
const landCurtainGrid = [[
  { type: TileType.WATERFALL, elevTier: 1 },
  { type: TileType.GRASS, elevTier: 0 },
]];
const landTopology = api.buildFoldedSurfaceTopology(landCurtainGrid, 2, 1);
assert.equal(landTopology.faces.length, 2,
  'land-facing waterfall must add a curtain surface face to the water body');
assert.equal(landTopology.curtainCount, 1);
assert.equal(landTopology.components.length, 1,
  'water tile and its land-facing curtain must be one contiguous folded component');
assert.equal(landTopology.components[0].boundaryEdgeKeys.length, 6,
  'shared waterfall lip must be interior; curtain bottom/sides become the new perimeter');
const landCurtainFaceId = [...landTopology.curtainFaceByGridEdge.values()][0];
const landCurtainFace = landTopology.faceById.get(landCurtainFaceId);
assert.equal(landCurtainFace.meta.neighborIsWater, false);

const landPlacement = api.unfoldComponent(landTopology, landTopology.components[0]);
const curtainPlacement = landPlacement.get(landCurtainFaceId);
const unfoldedCurtainDepth = Math.hypot(
  curtainPlacement[3][0] - curtainPlacement[0][0],
  curtainPlacement[3][1] - curtainPlacement[0][1],
);
assert.ok(Math.abs(unfoldedCurtainDepth - 2.5) < 1e-6,
  'a 2.5-world-unit curtain must count as 2.5 surface units after unfolding');

// Cross-tier water is also one surface, but now the curtain is real surface
// area between the two horizontal faces instead of a zero-thickness logical link.
const bridgedGrid = [[
  { type: TileType.WATERFALL, elevTier: 1 },
  { type: TileType.RIVER, elevTier: 0 },
]];
const bridgedTopology = api.buildFoldedSurfaceTopology(bridgedGrid, 2, 1);
assert.equal(bridgedTopology.faces.length, 3,
  'water-to-water tier transition should contain two horizontal faces plus the curtain face');
assert.equal(bridgedTopology.components.length, 1,
  'upper water, curtain, and lower water must be one folded surface component');
assert.equal(bridgedTopology.curtainCount, 1);

const bridgeConnectivity = api.buildConnectivity(bridgedGrid, 2, 1);
assert.equal(bridgeConnectivity.components.length, 1);
assert.equal(bridgeConnectivity.connectorEdgeKeys.size, 1,
  'water-to-water waterfall edge remains identifiable as a connector');
assert.equal(bridgeConnectivity.curtainEdgeKeys.size, 1,
  'all curtains, not just water-to-water connectors, are first-class surface edges');

const splitGrid = [[
  { type: TileType.RIVER, elevTier: 0 },
  { type: TileType.GRASS, elevTier: 0 },
  { type: TileType.RIVER, elevTier: 0 },
]];
const split = api.buildConnectivity(splitGrid, 3, 1);
assert.equal(split.components.length, 2,
  'land between ordinary waterways must still split the overlay into separate masses');

// Build the full domain through the mapper-fallback route and prove both the
// horizontal face and the land-facing curtain receive UVs from one domain.
const landDomain = api.buildDomain(landCurtainGrid, 2, 1, 'land_curtain_test');
const landWaterFaceId = landDomain.waterFaceByCell.get('0,0');
assert.equal(landDomain.faceUvById.get(landWaterFaceId)?.length, 4);
assert.equal(landDomain.faceUvById.get(landCurtainFaceId)?.length, 4);
assert.equal(landDomain.curtainCount, 1);

// Prove post-generation X/Z displacement cannot make a wilderness water tile
// select the wrong grid cell: base UVs retain the original world coordinates.
const displacedMesh = {
  geometry: oneTileGeometry(0.8),
  userData: { mergedWaterStatKey: 'wilderness' },
};
assert.equal(api.applyDomainToMesh(displacedMesh, landDomain), true,
  'stable base world UVs should map a heavily displaced tile to its authored grid cell');
assert.deepEqual(Array.from(displacedMesh.geometry.getAttribute('aWaterBodyOverlayFlag').array), [1,1,1,1]);
assert.equal(displacedMesh.geometry.userData.waterBodyOverlay.logicalCoordinateSource, 'base-world-uv');

// Apply the same folded-domain curtain UVs to a rendered waterfall quad.
// This case is deliberately land-facing: it must now be INCLUDED.
const curtainFace = landDomain.faceById.get(landCurtainFaceId);
const directed = curtainFace.meta.directedEdge;
const connectorGeometry = new BufferGeometry()
  .setAttribute('position', new Attribute([
    directed[0], 2.4, directed[1],
    directed[2], 2.4, directed[3],
    directed[0], -0.1, directed[1],
    directed[2], -0.1, directed[3],
  ], 3))
  .setIndex(new Attribute(new Uint16Array([0,2,3,0,3,1]), 1));
const connectorMesh = { geometry: connectorGeometry, userData: {} };
assert.equal(api.applyDomainToWaterfallMesh(connectorMesh, landDomain), 1,
  'land-facing waterfall curtain must be mapped as a rotated extension of the water body');
assert.deepEqual(Array.from(connectorGeometry.getAttribute('aWaterBodyOverlayFlag').array), [1,1,1,1]);
assert.equal(connectorGeometry.userData.waterBodyOverlayWaterfall.allCurtainsIncluded, true);

const waterfallMaterial = {
  isShaderMaterial: true,
  userData: {},
  uniforms: { uWaterTexture: { value: { waterfall: true } } },
  vertexShader:
    '        varying vec2 vUv;\n' +
    '        void main() {\n' +
    '          vUv = uv;\n' +
    '        }\n',
  fragmentShader:
    '        uniform sampler2D uWaterTexture;\n' +
    '        varying vec2 vUv;\n' +
    '        void main() {\n' +
    '          vec3 surfaceColor = vec3(1.0);\n' +
    '          gl_FragColor = vec4(surfaceColor, uOpacity);\n' +
    '        }\n',
  needsUpdate: false,
};
api.patchWaterfallMaterial(waterfallMaterial);
assert.equal(waterfallMaterial.userData.waterBodyOverlayWaterfallPatched, true);
assert.match(waterfallMaterial.fragmentShader, /uWaterBodyOverlayTexture/);
assert.equal(textureLoadCount, 1,
  'water and waterfall materials should share the same pending outline texture load');

console.log('Water body folded-surface overlay runtime checks passed.');
