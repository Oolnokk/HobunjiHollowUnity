'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const layoutSource = read('docs/js/tankan-script-layout.js');
const context = vm.createContext({
  window: {},
  document: {
    currentScript: { src: 'https://example.test/js/tankan-script-layout.js' },
    fonts: null,
  },
  URL,
  console,
  Promise,
});
vm.runInContext(layoutSource, context, { filename: 'tankan-script-layout.js' });
const layout = context.window.TankanScriptLayout;
assert(layout?.installed, 'TankanScriptLayout should install');
assert.equal(layout.version, 4, 'independent glyph scaling and axis-specific padding should stay active');
assert.equal(layout.defaults.columnSpacingEm, -0.55, 'loading-screen column spacing should stay canonical');
assert.equal(layout.defaults.glyphAdvanceEm, 0.56, 'loading-screen glyph advance should stay canonical');
assert.equal(layout.defaults.glyphScale, 1, 'shared layout should remain neutral unless the furniture author requests glyph scaling');
assert(layout.fontUrl.includes('tankanscript_rotated_flipped_horiz.otf'), 'must use the rotated/flipped Tankan font');
assert(!layoutSource.includes('document.fonts.check('), 'do not preflight Tankan with FontFaceSet.check; it can silently accept fallback rendering');
assert(layoutSource.includes('refusing to rasterize with a fallback font'), 'canvas renderer must fail closed instead of drawing a fallback font');
assert(layoutSource.includes('document.fonts.add(loadedFace)'), 'the loaded Tankan FontFace must be explicitly registered before canvas rendering');
assert(layoutSource.includes('ctx.scale(layout.glyphScale, layout.glyphScale)'), 'glyph size should scale each glyph inside its already-positioned cell');
assert(layoutSource.includes('paddingXEm') && layoutSource.includes('paddingYEm'), 'shared Tankan layout must support independent horizontal/vertical padding');

const measured = layout.measure('Hobunji Hollow', { fontSizePx: 100, paddingEm: 0 });
assert.equal(measured.columnCount, 2, 'one word should equal one vertical column');
assert.equal(measured.longestWord, 7, 'Hobunji is the longest word');
assert(Math.abs(measured.glyphAdvancePx - 56) < 1e-9, '.56em glyph advance should be preserved');
assert(Math.abs(measured.columnAdvancePx - 45) < 1e-9, '-.55em margin should produce .45em column advance');
assert.equal(measured.widthPx, 145, 'two canonical columns should occupy 1.45em');
assert.equal(measured.heightPx, 392, 'seven glyphs at .56em should occupy 3.92em');
const scaled = layout.measure('Hobunji Hollow', { fontSizePx: 100, paddingEm: 0, glyphScale: 1.8 });
assert.equal(scaled.widthPx, measured.widthPx, 'glyph size must not change column positions or layout width');
assert.equal(scaled.heightPx, measured.heightPx, 'glyph size must not change glyph advance or layout height');
assert.equal(scaled.glyphAdvancePx, measured.glyphAdvancePx, 'glyph size must not alter glyph advance');
assert.equal(scaled.columnAdvancePx, measured.columnAdvancePx, 'glyph size must not alter word-column advance');

// Furniture uses wider horizontal transparent padding so natural plane width can
// track raster width exactly while matching the empirically desired 0.8/1.0 widths.
const furnitureOptions = {
  fontSizePx: 100,
  columnSpacingEm: -0.35,
  glyphAdvanceEm: 0.6,
  glyphScale: 1.2,
  paddingXEm: 0.8,
  paddingYEm: 0.28,
};
const furnitureOne = layout.measure('Hobunji', furnitureOptions);
const furnitureTwo = layout.measure('Hobunji Hollow', furnitureOptions);
const furnitureThree = layout.measure('Hobunji Hollow X', furnitureOptions);
assert.equal(furnitureOne.widthPx, 260, 'one-column furniture Tankan raster should be 2.6em wide');
assert.equal(furnitureTwo.widthPx, 325, 'two-column furniture Tankan raster should be 3.25em wide');
assert.equal(furnitureThree.widthPx, 390, 'three-column furniture Tankan raster should be 3.9em wide');
assert(Math.abs(furnitureOne.widthPx / furnitureTwo.widthPx - 0.8) < 1e-9, 'one column should naturally resolve to normalized width 0.8');
assert(Math.abs(furnitureThree.widthPx / furnitureTwo.widthPx - 1.2) < 1e-9, 'three columns should naturally resolve to normalized width 1.2');
assert.equal(furnitureOne.heightPx, furnitureTwo.heightPx, 'adding a same-height word column must not change natural text height');
assert.equal(furnitureTwo.heightPx, furnitureThree.heightPx, 'adding a short third column must not change natural text height');

const loadingScreen = read('docs/js/loading-screen-runtime.js');
assert(loadingScreen.includes("const TANKAN_FONT_URL = 'assets/hud/tankanscript_rotated_flipped_horiz.otf'"), 'loading screen must still use the rotated/flipped Tankan OTF');
assert(loadingScreen.includes('columnSpacing: -0.55'), 'loading-screen default column spacing changed; update the neutral shared defaults with it');
assert(loadingScreen.includes('height:.56em;line-height:.56em'), 'loading-screen glyph advance changed; update the neutral shared defaults with it');
assert(loadingScreen.includes("split(/\\s+/).filter(Boolean)"), 'loading screen should still split words into separate vertical columns');

const editor = read('docs/tools/furniture-avatar-author/furniture-decals.js');
assert(editor.includes("const TANKAN_SOURCE_TYPE = 'tankanText'"));
assert(editor.includes('addFurnitureTankanText'));
assert(editor.includes('decalTankanColumnSpacing'));
assert(editor.includes('decalTankanGlyphAdvance'));
assert(editor.includes('decalTankanGlyphSize'));
assert(editor.includes('tankanSettingsVersion: TANKAN_SETTINGS_VERSION'));
assert(editor.includes('columnSpacingEm: -0.35'), 'normalized spacing zero must resolve to the supplied authored -0.35em reference');
assert(editor.includes('glyphAdvanceEm: 0.6'), 'normalized advance 1.0 must resolve to the supplied authored .6em reference');
assert(editor.includes('glyphScale: 1.2'), 'normalized glyph size 1.0 must render 20% larger than before');
assert(editor.includes("color: '#000000'"), 'new Tankan text should default to black');
assert(editor.includes('opacity: 0.5'), 'new Tankan text should default to the supplied 0.5 opacity');
assert(editor.includes('TANKAN_PADDING_X_EM = 0.8'), 'editor must use calibrated horizontal Tankan padding');
assert(editor.includes('TANKAN_PADDING_Y_EM = 0.28'), 'editor must preserve the prior vertical Tankan padding');
assert(editor.includes('TANKAN_SINGLE_COLUMN_WIDTH_FACTOR = 0.8'), 'editor must preserve the one-column width calibration');
assert(editor.includes('TANKAN_EXTRA_COLUMN_WIDTH_FACTOR = 0.2'), 'editor must widen naturally by one calibrated column increment');
assert(editor.includes('tankanNaturalWidthFactor'), 'editor must auto-size Tankan width from column count');
assert(editor.includes('tankanNaturalHeightFactor'), 'editor must auto-size Tankan height from row count');
assert(editor.includes('tankanSizing: \'natural-auto-block\''), 'exports must declare natural Tankan auto-sizing');
assert(editor.includes('width: 1') && editor.includes('height: 1'), 'new Tankan text width/height controls should be normalized to 1.0');
assert(editor.includes('normalOffset: 0'), 'new Tankan text lift control should be normalized to zero');
assert(editor.includes('version: 3'));
assert(editor.includes('sourceTypes: [IMAGE_SOURCE_TYPE, TANKAN_SOURCE_TYPE]'));
assert(editor.includes('decalTextureKey'), 'async text edits need a stale-texture guard');
assert(!editor.includes('\u0101') && !editor.includes('\u0100'), 'canonical project spelling is Tankan; do not introduce macrons into the editor');
assert(editor.includes('Add Tankan Text'), 'editor should expose the Tankan text decal action with canonical spelling');

const runtime = read('docs/js/furniture-decal-runtime.js');
assert(runtime.includes('new THREE.CanvasTexture(canvas)'), 'runtime should use generated transparent canvas textures for Tankan text');
assert(runtime.includes('ensureTankanLayout'), 'runtime should self-load the shared layout helper when necessary');
assert(runtime.includes('authoredTankanDecalCount'), 'runtime diagnostics should expose text decal count');
assert(runtime.includes('record.tankanGlyphSize'), 'runtime must honor independent glyph size');
assert(runtime.includes('record.tankanGlyphAdvance'), 'runtime must honor normalized glyph advance');
assert(runtime.includes('record.tankanColumnSpacing'), 'runtime must honor normalized column spacing');
assert(runtime.includes('TANKAN_PADDING_X_EM = 0.8'), 'runtime must use the same calibrated horizontal padding as the editor');
assert(runtime.includes('TANKAN_SINGLE_COLUMN_WIDTH_FACTOR = 0.8'), 'runtime must use the same one-column natural width as the editor');
assert(runtime.includes('tankanNaturalWidthFactor'), 'runtime must auto-size width instead of squeezing wider canvases');
assert(runtime.includes('tankanNaturalHeightFactor'), 'runtime must auto-size height from the Tankan layout');
assert(!runtime.includes('\u0101') && !runtime.includes('\u0100'), 'runtime warnings must keep canonical Tankan spelling');

const loader = read('docs/tools/furniture-avatar-author/foliage-furniture-mode.js');
const layoutLoad = loader.indexOf('tankan-script-layout.js');
const decalsLoad = loader.indexOf('furniture-decals.js');
assert(layoutLoad >= 0 && decalsLoad > layoutLoad, 'editor must load TankanScriptLayout before furniture decals');
assert(loader.includes('tankan-script-layout.js?v=20260915tankan5'), 'editor must cache-bust the axis-padding/no-squeeze layout');
assert(loader.includes('furniture-decals.js?v=20260915tankan5'), 'editor must cache-bust the natural Tankan sizing author');

console.log('furniture Tankan decal checks passed');
