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
assert.equal(layout.version, 2, 'font-loading fix should stay active');
assert.equal(layout.defaults.columnSpacingEm, -0.55, 'loading-screen column spacing should stay canonical');
assert.equal(layout.defaults.glyphAdvanceEm, 0.56, 'loading-screen glyph advance should stay canonical');
assert(layout.fontUrl.includes('tankanscript_rotated_flipped_horiz.otf'), 'must use the loading-screen rotated/flipped Tankan font');
assert(!layoutSource.includes('document.fonts.check('), 'do not preflight Tankan with FontFaceSet.check; it can silently accept fallback rendering');
assert(layoutSource.includes('refusing to rasterize with a fallback font'), 'canvas renderer must fail closed instead of drawing a fallback font');
assert(layoutSource.includes('document.fonts.add(loadedFace)'), 'the loaded Tankan FontFace must be explicitly registered before canvas rendering');

const measured = layout.measure('Hobunji Hollow', { fontSizePx: 100, paddingEm: 0 });
assert.equal(measured.columnCount, 2, 'one word should equal one vertical column');
assert.equal(measured.longestWord, 7, 'Hobunji is the longest word');
assert(Math.abs(measured.glyphAdvancePx - 56) < 1e-9, '.56em glyph advance should be preserved');
assert(Math.abs(measured.columnAdvancePx - 45) < 1e-9, '-.55em margin should produce .45em column advance');
assert.equal(measured.widthPx, 145, 'two canonical columns should occupy 1.45em');
assert.equal(measured.heightPx, 392, 'seven glyphs at .56em should occupy 3.92em');

// Guard the shared renderer against drifting away from the loading screen that defines the desired look.
const loadingScreen = read('docs/js/loading-screen-runtime.js');
assert(loadingScreen.includes("const TANKAN_FONT_URL = 'assets/hud/tankanscript_rotated_flipped_horiz.otf'"), 'loading screen must still use the canonical rotated/flipped Tankan OTF');
assert(loadingScreen.includes('columnSpacing: -0.55'), 'loading-screen default column spacing changed; update TankanScriptLayout with it');
assert(loadingScreen.includes('height:.56em;line-height:.56em'), 'loading-screen glyph advance changed; update TankanScriptLayout with it');
assert(loadingScreen.includes("split(/\\s+/).filter(Boolean)"), 'loading screen should still split words into separate vertical columns');

const editor = read('docs/tools/furniture-avatar-author/furniture-decals.js');
assert(editor.includes("const TANKAN_SOURCE_TYPE = 'tankanText'"));
assert(editor.includes('addFurnitureTankanText'));
assert(editor.includes('decalTankanColumnSpacing'));
assert(editor.includes('decalTankanGlyphAdvance'));
assert(editor.includes('version: 2'));
assert(editor.includes('sourceTypes: [IMAGE_SOURCE_TYPE, TANKAN_SOURCE_TYPE]'));
assert(editor.includes('decalTextureKey'), 'async text edits need a stale-texture guard');
assert(!editor.includes('\u0101') && !editor.includes('\u0100'), 'canonical project spelling is Tankan; do not introduce macrons into the editor');
assert(editor.includes('Add Tankan Text'), 'editor should expose the Tankan text decal action with canonical spelling');

const runtime = read('docs/js/furniture-decal-runtime.js');
assert(runtime.includes('new THREE.CanvasTexture(canvas)'), 'runtime should use generated transparent canvas textures for Tankan text');
assert(runtime.includes('ensureTankanLayout'), 'runtime should self-load the shared layout helper when necessary');
assert(runtime.includes('authoredTankanDecalCount'), 'runtime diagnostics should expose text decal count');
assert(runtime.includes('record.tankanGlyphAdvanceEm'));
assert(runtime.includes('record.tankanColumnSpacingEm'));

const loader = read('docs/tools/furniture-avatar-author/foliage-furniture-mode.js');
const layoutLoad = loader.indexOf('tankan-script-layout.js');
const decalsLoad = loader.indexOf('furniture-decals.js');
assert(layoutLoad >= 0 && decalsLoad > layoutLoad, 'editor must load TankanScriptLayout before furniture decals');
assert(loader.includes('tankan-script-layout.js?v=20260915tankan3'), 'editor must cache-bust the fixed Tankan font loader');

console.log('furniture Tankan decal checks passed');
