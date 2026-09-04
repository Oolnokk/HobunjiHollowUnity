'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimePath = path.join(root, 'docs', 'js', 'portrait-arm-cloud-mask.js');
const editorPath = path.join(root, 'docs', 'tools', 'portrait-arm-mask', 'app.js');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const editor = fs.readFileSync(editorPath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(runtime.includes("mode: 'per-arm-draw-clip'"), 'arm mask must report per-arm draw clipping mode');
assert(runtime.includes('activeArmClipsByCanvas'), 'arm mask must scope clip state to the portrait canvas');
assert(runtime.includes('buildClippedArmImage'), 'arm mask must pre-clip the authored arm image');
assert(runtime.includes("globalCompositeOperation = 'destination-out'"), 'arm image clipping must subtract the higher cloud mask');
assert(runtime.includes('state?.clips?.get'), 'draw helpers must substitute only known authored arm source keys');
assert(!runtime.includes('material.alphaMap'), 'arm-only mask must not be applied to the flattened portrait material');
assert(!runtime.includes('buildSinglePlaneAvatarModel'), 'arm-only mask must not patch the finished PNG-plane avatar');
assert(!runtime.includes('hobunjiArmCloudAlphaMap'), 'legacy flattened arm alpha-map state must stay removed');

assert(editor.includes("schema: 'hobunji_portrait_arm_mask.v1'"), 'mask editor must export the focused mask schema');
assert(editor.includes('NpcAvatarPreview.renderProfileToCanvas'), 'mask editor must preview through the real portrait pipeline');
assert(!editor.includes('weightMap'), 'mask editor must not retain weight-paint data');
assert(!editor.includes('calculated-bicep'), 'mask editor must not retain bicep-rig bindings');
assert(!editor.includes('deformPreview'), 'mask editor must not retain deformation preview code');

console.log('portrait arm mask layer-isolation regression checks passed');
