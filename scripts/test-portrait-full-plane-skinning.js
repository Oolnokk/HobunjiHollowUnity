#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const sharedSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'); // Guards gameplay and attack-editor portrait rigs.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Guards the player's post-rig hat/hood overlap overlay.
const authorSource = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8'); // Guards the standalone multi-avatar author rig.
const attackEditorSource = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8'); // Guards the mobile-visible rig diagnostic.

const sharedGeometryStart = sharedSource.indexOf('function buildSkinnedPlaneGeometry'); // Used below to isolate the shared geometry builder from unrelated alpha landmark scans.
const sharedGeometryEnd = sharedSource.indexOf('function buildSkinnedSinglePlaneAssembly', sharedGeometryStart);
assert.ok(sharedGeometryStart >= 0 && sharedGeometryEnd > sharedGeometryStart, 'shared skin geometry builder is present');
const sharedGeometry = sharedSource.slice(sharedGeometryStart, sharedGeometryEnd); // Used below to enforce opacity-independent mesh coverage.

assert.doesNotMatch(sharedGeometry, /opaqueMask|cellHasOpaquePixel|visibleCells|alphaThreshold/,
  'shared skin geometry never crops or weights the plane from texel opacity');
assert.match(sharedGeometry, /for \(let row = 0; row < segmentsY; row\+\+\)[\s\S]{0,140}for \(let column = 0; column < segmentsX; column\+\+\) appendCell\(\{ column, row \}, 1\);/,
  'every front-face cell in the rectangular PNG plane is emitted');
assert.match(sharedGeometry, /const frontVertexCount = positions\.length \/ 3;[\s\S]{0,180}appendCell\(\{ column, row \}, -1\);/,
  'every rear-face cell in the rectangular PNG plane is emitted');
assert.match(sharedGeometry, /coverageMode: 'full-png-plane'/,
  'shared rig publishes its whole-plane coverage mode for visible diagnostics');
assert.match(sharedSource, /buildSkinnedPlaneGeometry\(THREE, modelWidth, modelHeight, neckLocal, \{\s*pixelWidth: pxW,\s*pixelHeight: pxH/,
  'shared rig maps the skin grid to the complete source-canvas dimensions');
assert.doesNotMatch(sharedSource, /const opaqueMask = scanOpaquePixelMask\(config\.sourceCanvas/,
  'the composed portrait alpha mask is not used as the skin mesh topology');

const authorGeometryStart = authorSource.indexOf('function buildTwoSidedSkinnedPlaneGeometry'); // Used below to isolate the animation-author plane builder.
const authorGeometryEnd = authorSource.indexOf('async function buildNpcNeckRig', authorGeometryStart);
assert.ok(authorGeometryStart >= 0 && authorGeometryEnd > authorGeometryStart, 'animation-author skin geometry builder is present');
const authorGeometry = authorSource.slice(authorGeometryStart, authorGeometryEnd); // Used below to keep author/runtime rig coverage in parity.
assert.match(authorGeometry, /new THREE\.PlaneGeometry\(modelWidth, modelHeight, segmentsX, segmentsY\)/,
  'animation author skins one complete rectangular source plane');
assert.doesNotMatch(authorGeometry, /scanOpaque|alphaThreshold|cellHasOpaquePixel/,
  'animation-author mesh coverage is independent of portrait opacity');
assert.match(attackEditorSource, /whole-plane grid cells · \$\{coverageMode\}/,
  'attack editor exposes whole-plane skin coverage without requiring developer tools');

const gameHatOverlayStart = gameSource.indexOf('async function buildPlayerHatXrayOverlay'); // Used below to isolate the gameplay overlay builder.
const gameHatOverlayEnd = gameSource.indexOf('async function refreshPlayerAvatar', gameHatOverlayStart);
assert.ok(gameHatOverlayStart >= 0 && gameHatOverlayEnd > gameHatOverlayStart, 'gameplay hat overlay builder is present');
const gameHatOverlay = gameSource.slice(gameHatOverlayStart, gameHatOverlayEnd); // Used below to prevent post-rig cosmetics returning to rigid planes.
assert.match(gameHatOverlay, /new THREE\.SkinnedMesh\(overlayGeometry, material\)/,
  'gameplay hat overlap pixels use a skinned overlay when the portrait has a neck rig');
assert.match(gameHatOverlay, /mesh\.bind\(skinnedSource\.skeleton, skinnedSource\.bindMatrix\)/,
  'gameplay overlay shares the portrait skeleton and bind space');
assert.match(gameHatOverlay, /material\.skinning = true/,
  'gameplay overlay enables the legacy Three.js skinning shader path');

const authorHatOverlayStart = authorSource.indexOf('async function buildLazyHatOverlayV1521'); // Used below to isolate the Animation Author overlay builder.
const authorHatOverlayEnd = authorSource.indexOf('function restoreMeshRenderOrderV1521', authorHatOverlayStart);
assert.ok(authorHatOverlayStart >= 0 && authorHatOverlayEnd > authorHatOverlayStart, 'animation-author hat overlay builder is present');
const authorHatOverlay = authorSource.slice(authorHatOverlayStart, authorHatOverlayEnd); // Used below to keep x-ray pixels on the weighted portrait surface.
assert.match(authorHatOverlay, /new THREE\.SkinnedMesh\(overlayGeometry, material\)/,
  'animation-author overlap pixels use the portrait skin topology');
assert.match(authorHatOverlay, /mesh\.bind\(rig\.skeleton, rig\.skinnedPlane\.bindMatrix\)/,
  'animation-author overlay shares the portrait skeleton and bind space');
assert.match(authorHatOverlay, /rig\.rigRoot\.add\(group\)/,
  'animation-author overlay lives beside the skinned portrait instead of rigidly beneath the neck bone');
assert.doesNotMatch(authorHatOverlay, /rig\.neckJoint\.add\(group\)/,
  'animation-author no longer attaches a rigid cosmetic card under the neck bone');

console.log('portrait full-plane skinning tests passed');
