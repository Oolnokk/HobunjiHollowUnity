#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');

const fineHood = read('docs/js/fine-hood-trim-head-facing.js');
const hats = read('docs/js/front-hat-head-facing.js');
const xray = read('docs/js/hat-xray-head-facing.js');
const loader = read('docs/js/combat/combat-config-loader.js');

for (const [label, source] of [['fine hood', fineHood], ['front hats', hats], ['hat xray', xray]]) {
  assert.doesNotThrow(() => new Function(source), `${label} adapter must parse`);
  assert.ok(source.includes('cameraFacingVisibility: false'), `${label} must explicitly disable camera-facing visibility`);
}

assert.ok(fineHood.includes('uniform.value = 1'), 'Fine Hood legacy trimless shader must be held in the full-trim state');
assert.ok(fineHood.includes('normal portrait front/back renderer'), 'Fine Hood visibility belongs to normal portrait rendering');
assert.doesNotMatch(fineHood, /yawDot\s*>\s*0/, 'Fine Hood must not use camera/head yaw for visibility');
assert.doesNotMatch(fineHood, /TILT_CUTOFF_DEG/, 'Fine Hood must not disappear because the head tilts');

assert.doesNotMatch(hats, /frontHatlessCanvas|hobunjiFrontHatFacingUniform|yawDot\s*>\s*0|onBeforeRender/, 'front hats must not install a camera-facing texture gate');
assert.ok(hats.includes("transition: 'disabled'"), 'front hat compatibility API reports the old gate disabled');

assert.ok(xray.includes('mesh.position.z = source.position.z'), 'hat x-ray stays coplanar with the skinned portrait');
assert.ok(xray.includes('FRONT_XRAY_RENDER_ORDER = 2.5'), 'front x-ray retains deterministic render ordering');
assert.doesNotMatch(xray, /currentMaterial\.opacity\s*=|yawDot\s*>\s*0|TILT_CUTOFF_DEG/, 'hat x-ray must never alter opacity from camera/head facing');

assert.ok(loader.includes('js/fine-hood-trim-head-facing.js'), 'Fine Hood compatibility adapter is still bootstrapped');
assert.ok(loader.includes('js/front-hat-head-facing.js'), 'front-hat compatibility adapter is still bootstrapped');

console.log('Front headwear camera-facing visibility is disabled; x-ray alignment remains enabled.');
