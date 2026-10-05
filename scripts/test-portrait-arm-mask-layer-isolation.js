'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimePath = path.join(root, 'docs', 'js', 'portrait-arm-cloud-mask.js');
const runtime = fs.readFileSync(runtimePath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(runtime.includes("mode: 'disabled'"), 'portrait arm cloud-mask runtime must report disabled mode');
assert(runtime.includes('__hobunjiCloudMaskDisabled'), 'global mask no-op must expose the disabled marker');
assert(runtime.includes('global.applyPortraitOpacityMask = disabledApplyPortraitOpacityMask'), 'canonical full-portrait mask must be replaced by the no-op');
assert(runtime.includes("__hobunjiCloudMaskYScaled = true"), 'disabled mask must prevent legacy scaling wrappers from reinstalling cloud-mask behavior');
assert(runtime.includes('authoredProfiles: Object.freeze({})'), 'legacy authored arm-mask profiles must not be active at runtime');
assert(!runtime.includes("mode: 'per-arm-hard-cut-black-cap'"), 'legacy per-arm hard-cap behavior must remain disabled');
assert(!runtime.includes('buildClippedArmImage'), 'disabled runtime must not preprocess arm sprites');
assert(!runtime.includes('activeArmClipsByCanvas'), 'disabled runtime must not install per-canvas arm clipping state');

console.log('portrait cloud-mask disabled regression checks passed');
