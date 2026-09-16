#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm'); // Used to exercise visible-alpha PNG grounding through the real render wrapper without a browser.

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const presentation = source('docs/js/crop-billboard-presentation.js'); // Used to pin shared farm-crop soil anchoring and PNG visible-pixel grounding.
const loader = source('docs/js/combat/combat-config-loader.js'); // Used to ensure the presentation wrapper installs after crop sprite/heftroot bridges.
const game = source('docs/game.js'); // Used to pin the exact water lift this presentation cancels.
const cropRendering = source('docs/js/vegetation-crop-rendering.js'); // Crop draw positioning now lives here rather than inline in game.js.

assert.match(game, /const WATER_UNIT = SLAB_H \/ MAX_WATER/,
  'game.js still computes crop water lift from the shared water-depth conversion');
assert.match(cropRendering, /const surfY\s*= deps\.tileSurfaceY\(tile\.type\) \+ tile\.water \* deps\.WATER_UNIT/,
  'crop rendering still supplies water-raised crop positions that the presentation layer must counter at draw time');
assert.match(presentation, /const WATER_UNIT = 0\.5 \/ 3\.0/,
  'presentation mirrors the current 0.5/3 water-depth-to-world-Y conversion');
assert.match(presentation, /waterLift = waterDepth \* WATER_UNIT/,
  'live tile water depth is converted into the exact crop Y correction');
assert.match(presentation, /root\.position\.y -= waterLift \+ centerLift \+ pngGroundLift/,
  'crop roots combine flood, former-cube-center, and visible-PNG grounding corrections at draw time');
assert.match(presentation, /scanOpaqueVerticalBoundsOfImage/,
  'PNG crop grounding reuses the shared opaque-pixel scanner instead of treating transparent canvas padding as plant height');
assert.match(presentation, /bottomLocalY \+ PNG_SOIL_EMBED_LOCAL/,
  'PNG crop bottoms receive a small growth-scaled soil embed after alpha grounding');
assert.match(presentation, /Math\.max\(0, bottomLocalY \+ PNG_SOIL_EMBED_LOCAL\)/,
  'PNG grounding never raises artwork that is already embedded deeply enough');
assert.match(presentation, /hobunjiCropSpriteKey/,
  'visible-alpha grounding is keyed to generic authored PNG crop planes rather than a hard-coded crop species list');
assert.match(presentation, /hobunjiCropRootKey \|\| object\?\.userData\?\.hobunjiCropSpriteKey/,
  'the shared soil correction discovers procedural, clustered, and generic crop-root tags');
assert.match(presentation, /cropKey === 'garlink' \|\| cropKey === 'ongyums'/,
  'only converted garlink/ongyums clusters also remove the old generic cube center lift');
assert.match(presentation, /root\.userData\?\.hobunjiCropClusterCount === 3/,
  'cube-center correction waits until garlink/ongyums have actually converted into three-member billboard clusters');
assert.doesNotMatch(presentation, /root\.scale\.set|mesh\.scale\.set/,
  'the presentation layer never mutates crop growth scale while grounding the art');
assert.match(presentation, /try \{[\s\S]*?previousRender\.call[\s\S]*?finally \{[\s\S]*?restoreTransforms/,
  'temporary soil anchoring is restored after rendering so crop simulation remains owned by game.js');

const artIndex = loader.indexOf('crop-sprite-art.js?v=20260915cropscan1'); // Used to verify authored generic PNG crops initialize before the shared presentation layer.
const heftrootIndex = loader.indexOf('heftroot-billboard-bridge.js'); // Used to verify the independently authored heftroot PNG bridge also initializes before shared grounding.
const presentationIndex = loader.indexOf('crop-billboard-presentation.js?v=20260814a'); // Used as the final shared grounding wrapper ordering boundary.
assert.ok(artIndex >= 0 && heftrootIndex > artIndex && presentationIndex > heftrootIndex,
  'shared crop presentation loads after both authored crop conversion bridges');

function makeNode(props = {}) {
  const node = {
    position: { x: 0, y: 0, z: 0, ...(props.position || {}) },
    scale: { x: 1, y: 1, z: 1, ...(props.scale || {}) },
    userData: props.userData || {},
    material: props.material || null,
    children: [],
    parent: null,
    traverse(callback) {
      callback(this);
      for (const child of this.children) child.traverse(callback);
    },
  }; // Minimal Three-like node used to exercise hierarchy-relative visible-bottom math.
  node.add = child => {
    child.parent = node;
    node.children.push(child);
  };
  return node;
}

let renderObservedY = null; // Captures the temporary draw-time root height before the presentation wrapper restores simulation state.
function FakeWebGLRenderer() {}
FakeWebGLRenderer.prototype.render = function render() {
  renderObservedY = cropRoot.position.y;
  return 'rendered';
};

const scene = makeNode(); // Farm scene stand-in used by directSceneRoot and the shared scene traversal.
const cropRoot = makeNode({
  position: { x: 0.5, y: 0.52, z: 0.5 },
  userData: { hobunjiCropRootKey: 'ongyums', hobunjiCropClusterCount: 3 },
}); // Mirrors a full-scale converted generic crop cube before its center lift is removed.
const cropPlane = makeNode({
  scale: { x: 0.25, y: 0.25, z: 0.25 },
  userData: { hobunjiCropSpriteKey: 'ongyums' },
  material: { map: { image: { naturalHeight: 100, height: 100 } } },
}); // Visible crop plane whose lowest opaque pixel sits above its centered plane origin because of transparent PNG padding.
scene.add(cropRoot);
cropRoot.add(cropPlane);

const fakeFarmPanel = { init(deps) { return deps; } }; // Receives the real module's dependency-capture wrapper before the test render.
const sandboxWindow = {
  FarmPanel: fakeFarmPanel,
  THREE: { WebGLRenderer: FakeWebGLRenderer },
  PNGPlaneAvatar: {
    scanOpaqueVerticalBoundsOfImage() { return { top: 4, bottom: 40 }; },
  },
}; // Supplies only the browser globals the presentation module needs for deterministic alpha grounding.
vm.runInNewContext(presentation, { window: sandboxWindow });
sandboxWindow.FarmPanel.init({
  getGrid: () => [[{ crop: 'ongyums', water: 0 }]],
  scene,
});

const renderer = new sandboxWindow.THREE.WebGLRenderer(); // Exercises the installed render wrapper with a real tagged PNG crop hierarchy.
assert.equal(renderer.render(scene, {}), 'rendered', 'PNG grounding preserves the underlying renderer return value');
assert.ok(Math.abs(renderObservedY - (-0.0425)) < 1e-9,
  'ongyums visible bottom is lowered to 0.02 root-local units below soil after removing the old cube-center lift');
assert.equal(cropRoot.position.y, 0.52,
  'temporary PNG soil grounding restores the simulation-owned crop root immediately after rendering');
assert.equal(sandboxWindow.HobunjiCropBillboardPresentation.getDebug().lastPngGroundedRoots, 1,
  'mobile-readable crop diagnostics report a PNG root corrected on the last farm render');
assert.equal(sandboxWindow.HobunjiCropBillboardPresentation.getDebug().pngOpaqueScanCount, 1,
  'the PNG alpha scan is cached instead of repeating for every render');
renderer.render(scene, {});
assert.equal(sandboxWindow.HobunjiCropBillboardPresentation.getDebug().pngOpaqueScanCount, 1,
  're-rendering the same decoded PNG reuses its cached opaque-bottom measurement');

console.log('crop soil-anchor presentation tests passed');
