#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');

const appLoader = fs.readFileSync('docs/tools/pants-rig-author/app.js', 'utf8');
const embeddedLayout = fs.readFileSync('docs/tools/pants-rig-author/embedded-layout.js', 'utf8');
const proceduralLoader = fs.readFileSync('docs/js/procedural-impact-tabs.js', 'utf8');
const apply = fs.readFileSync('docs/js/procedural-pants-rig-apply.js', 'utf8');

assert(appLoader.includes("loadScript('embedded-layout.js'"), 'embedded Pants author does not load its containment correction');
assert(appLoader.indexOf("loadScript('embedded-layout.js'") < appLoader.indexOf("loadScript('app-base.js'"), 'embedded containment correction should install before app-base boots');
assert(embeddedLayout.includes("params.has('embedded')"), 'standalone Pants author should not receive iframe-only layout overrides');
assert(embeddedLayout.includes('grid-template-rows:minmax(280px,1fr) minmax(220px,.72fr)'), 'embedded canvas rows should replace the standalone fixed 520/360 mobile rows');
assert(embeddedLayout.includes('const scale = Math.min(maxWidth / intrinsicWidth, maxHeight / intrinsicHeight)'), 'canvas fitting must use one contain scale for both axes');
assert(embeddedLayout.includes("canvas.style.setProperty('width'"), 'embedded fitter does not explicitly preserve canvas CSS width');
assert(embeddedLayout.includes("canvas.style.setProperty('height'"), 'embedded fitter does not explicitly preserve canvas CSS height');
assert(embeddedLayout.includes('ResizeObserver'), 'embedded canvas fitting should respond to panel/window resizing');

assert(proceduralLoader.includes('procedural-pants-rig-apply.js'), 'Procedural Animation does not load the explicit Apply-to-NPC module');
assert(apply.includes("const BUTTON_ID = 'proceduralPantsApplyToNpc'"), 'Apply-to-NPC action id is missing');
assert(apply.includes("button.textContent = 'Apply to NPC'"), 'Apply-to-NPC action is not visible in the Pants host');
assert(apply.includes('Core.solveAffine'), 'static Pants apply does not establish garment-to-portrait belt mapping');
assert(apply.includes('character.portraitBeltSpline'), 'static Pants apply does not consume the authored species/gender beltline');
assert(apply.includes('Core.buildLegOpeningFitControls'), 'static Pants apply does not preserve the authored one-time leg-thickness fit');
assert(apply.includes('resolveSkinnedPixelWorldPosition'), 'static Pants apply does not use the canonical live portrait pixel resolver when available');
assert(apply.includes('model.add(mesh)'), 'static Pants apply never attaches the garment to the current NPC model');
assert(apply.includes("live.dispatchEvent(new Event('change'"), 'static Pants apply should disable the competing live garment before attachment');
assert(apply.includes('clearEdgeDarkBackground'), 'applied repository pants should mirror the author edge-black transparency behavior');
assert(!apply.includes("getObjectByName('left_thigh')"), 'beltline-only Apply must not require the procedural leg chain');

console.log('embedded Pants containment + Apply-to-NPC: PASS');
