'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/outline-render-performance.js'), 'utf8'); // Guards layer-2 solid shells plus billboard-style alpha-cutout target fills.
const foliage = fs.readFileSync(path.join(root, 'docs/js/foliage-generator.js'), 'utf8'); // Confirms procedural leaf cards remain explicitly tagged as flat/no-shell geometry.
const loader = fs.readFileSync(path.join(root, 'docs/js/house-pieces.js'), 'utf8'); // Guards the cache-busted runtime include so browsers actually receive the corrected target renderer.

assert.match(source, /const MASK_TARGET = \(1 << 2\) >>> 0;/, 'target-outline layer 2 must be classified explicitly');
assert.match(source, /mask === MASK_TARGET[\s\S]{0,260}return 'target';/, 'layer-2 red\/green override renders must be recognized as target passes');
assert.match(source, /uniform sampler2D uTargetAlphaMap;/, 'target shaders must accept an alpha-cutout source texture');
assert.match(source, /float sourceAlpha = texture2D\(uTargetAlphaMap, vTargetUv\)\.a;/, 'target shaders must sample the source texture alpha');
assert.match(source, /if \(sourceAlpha < uTargetAlphaCutoff\) discard;/, 'transparent source pixels must be discarded from the target highlight');
assert.match(source, /const alphaCutoff = Number\(sourceMaterial\?\.alphaTest\);/, 'each target mesh must reuse its own authored alpha-test cutoff');
assert.match(source, /if \(alphaMap\.matrixAutoUpdate !== false\) alphaMap\.updateMatrix\?\.\(\);/, 'target alpha sampling must honor live texture transforms');
assert.match(source, /uniforms\.uTargetUsesAlphaMap\.value = 0;/, 'alpha masking must be reset after each draw so solid target meshes stay solid');
assert.match(source, /const TARGET_ALPHA_FILL_LAYER = 30;/, 'flat alpha-cutout targets need an isolated temporary fill layer');
assert.match(source, /object\.userData\?\.noOutline === true[\s\S]{0,180}fillEntries\.push/, 'flat no-shell alpha cards must be routed into the billboard-style fill pass');
assert.match(source, /suppressTargetAlphaFillFromShell[\s\S]{0,180}layers\?\.disable\?\.\(2\)/, 'leaf cards must be removed from the volumetric target-shell draw');
assert.match(source, /depthFunc: THREE\.LessEqualDepth[\s\S]{0,120}blending: THREE\.AdditiveBlending[\s\S]{0,80}side: THREE\.DoubleSide/, 'leaf target fill must match weed-billboard depth, additive blending, and double-sided rendering');
assert.match(source, /gl_FragColor = vec4\(uColor, uAlpha \* sourceAlpha\);/, 'leaf target fill must tint only the opaque source pixels instead of drawing a rectangular card');
assert.match(source, /drawTargetAlphaFill\(renderer, scene, camera, targetAlphaFillEntries, targetMaterial\);/, 'the billboard-style leaf fill must run after the ordinary solid target shell');
assert.match(source, /targetAlphaBillboardFill: true/, 'mobile-visible outline performance debug state must report billboard-style alpha target filling');
assert.match(foliage, /leafMesh\.userData\.noOutline = true;/, 'procedural foliage leaf cards must keep the flat-card marker consumed by the target fill pass');
assert.match(loader, /outline-render-performance\.js\?v=20260909targetalpha2/, 'runtime loader must cache-bust the foliage target-fill renderer');

console.log('target outline alpha-cutout + billboard-fill regression checks passed');
