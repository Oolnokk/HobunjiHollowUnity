'use strict';
const assert = require('node:assert/strict'); // Guards against reintroducing owner-backplane masking for head-anchored held tools.
const fs = require('node:fs'); // Reads the actual game and editor integration points.
const read = path => fs.readFileSync(path, 'utf8'); // Shared source reader for this regression test.
const compositor = read('docs/js/held-object-render-order.js'); // The held overlay must not defer head-relative weapons into a special pass.
const editor = read('docs/tools/attack-animation-editor/index.html'); // Editor preview must match game layering.
const ranged = read('docs/js/combat/ranged-weapons.js'); // Ranged head poses still bind to their normal holder.
const loader = read('docs/js/held-action-animations.js'); // No masking helper should load at startup.
const architecture = read('docs/architecture/held-object-water-depth-compositing.md'); // Documents the currently enabled layering contract.

assert.doesNotMatch(compositor, /HeadRelativeWeaponOcclusion|headGroups|headHidden|headRelativeHeld/, 'the game has no owner-backplane stencil pass or special head-relative render path');
const selectiveStart = compositor.indexOf('function replaySelectiveHeldOverlay(');
const selectiveEnd = compositor.indexOf('function isShellOutlinePass(', selectiveStart);
const selectiveReplay = compositor.slice(selectiveStart, selectiveEnd);
assert.match(selectiveReplay, /for \(const group of groups\)[\s\S]*?const overlayStates = tintOverlay \? prepareSubmergedOverlayStencilMaterials\(group\.meshes\) : null;/, 'held tools share the overlay and water-tint path within each actor-elevation group');
assert.match(compositor, /if \(!ground\.length && !topFaceGround\.length && !\(tintCovers\.length && \(held\.length \|\| feet\.length\)\)\) return originalRender/, 'interiors without replay requirements take the ordinary render path');
assert.doesNotMatch(editor, /HeadRelativeWeaponOcclusion|headOcclusion|weapon\.visible = false/, 'the attack editor cannot mask or temporarily hide head-anchored tools');
const animationStart = editor.indexOf('function animate()'); // Inspect the actual editor preview loop rather than assuming no weapon animation call can appear between controls and render.
const animationBody = editor.slice(animationStart, editor.indexOf('\nanimate();', animationStart));
assert(animationStart >= 0 && animationBody.includes('controls.update();'), 'preview controls update in the animation loop');
assert.equal((animationBody.match(/renderer\.render\(scene, camera\);/g) || []).length, 1, 'preview tools render exactly once through the regular renderer');
assert(animationBody.indexOf('controls.update();') < animationBody.indexOf('renderer.render(scene, camera);'), 'controls update before the regular render');
assert.doesNotMatch(ranged, /headRelativeBackPlane/, 'ranged poses no longer tag the owner rear silhouette');
assert.match(ranged, /if \(pose\.headRelative && attach && c\.avatarRef\?\.group\)/, 'mouth-relative attachment remains supported');
assert.doesNotMatch(loader, /head-relative-weapon-occlusion/, 'the retired rear-mask module is not loaded');
assert.match(architecture, /without any owner-backplane stencil mask/, 'render architecture describes the new layer behavior');
console.log('head-relative tools use the ordinary held overlay and editor preview: PASS');
