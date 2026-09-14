#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'docs/js/pants-rig-core.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'docs/tools/pants-rig-author/app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'docs/tools/pants-rig-author/index.html'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'docs/config/pants-rigs.js'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(root, 'docs/js/pants-rig-runtime.js'), 'utf8');

const context = { globalThis: {} };
context.globalThis.globalThis = context.globalThis;
vm.createContext(context.globalThis);
vm.runInContext(coreSource, context.globalThis);
const Core = context.globalThis.HobunjiPantsRig;
assert(Core, 'pants rig core should install a public API');

assert.strictEqual(Core.SCHEMA, 'hobunji.pants-rigs.v1');
assert.deepStrictEqual(Array.from(Core.WEIGHT_CHANNELS), ['belt', 'leftThigh', 'leftCalf', 'rightThigh', 'rightCalf']);

const five = [
  { x: .1, y: .2 }, { x: .3, y: .2 }, { x: .5, y: .2 }, { x: .7, y: .2 }, { x: .9, y: .2 },
];
assert(Core.validateFivePointSpline(five), 'exactly five normalized points should validate');
assert(!Core.validateFivePointSpline(five.slice(0, 4)), 'four points must not validate');

const garment = {
  pantsBeltSpline: five,
  legOpenings: {
    left: five.map(point => ({ x: point.x * .4, y: point.y + .5 })),
    right: five.map(point => ({ x: .6 + point.x * .4, y: point.y + .5 })),
  },
};
const fit = Core.buildLegOpeningFitControls(garment, .75);
assert.strictEqual(fit.source.length, 15, 'fit should include 5 pinned belt + 10 opening controls');
for (let index = 0; index < 5; index++) {
  assert.deepStrictEqual(fit.source[index], fit.target[index], 'pants belt controls must stay pinned during static thickness fit');
}
const leftSourceCenter = Core.centroid(garment.legOpenings.left);
const leftTargetCenter = Core.centroid(fit.leftTarget);
assert(Math.abs(leftSourceCenter.x - leftTargetCenter.x) < 1e-9, 'opening scaling should preserve centroid x');
assert(Math.abs(leftSourceCenter.y - leftTargetCenter.y) < 1e-9, 'opening scaling should preserve centroid y');

const affine = Core.solveAffine(five, five.map(point => ({ x: point.x * .5 + .2, y: point.y * .75 + .1 })));
assert(affine, 'five belt pairs should solve a least-squares affine transform');
const mapped = Core.applyAffine(affine, { x: .4, y: .2 });
assert(Math.abs(mapped.x - .4) < 1e-8);
assert(Math.abs(mapped.y - .25) < 1e-8);

const channels = Array.from(Core.WEIGHT_CHANNELS);
const dense = new Uint8Array(4 * 3 * channels.length);
for (let cell = 0; cell < 12; cell++) {
  dense[cell * channels.length] = cell % 2 ? 128 : 255;
  dense[cell * channels.length + 1] = cell % 2 ? 127 : 0;
}
const encoded = Core.encodeWeightGridRle({ width: 4, height: 3, channels, data: dense });
const decoded = Core.decodeWeightGridRle(encoded);
assert.deepStrictEqual(Array.from(decoded.data), Array.from(dense), 'RLE weight map should round-trip exactly');

const validProject = {
  schema: Core.SCHEMA,
  garments: {
    pants_1: {
      pantsBeltSpline: five,
      legOpenings: { left: five, right: five },
      legBones: {
        left: { hip: { x: .3, y: .3 }, knee: { x: .25, y: .5 }, ankle: { x: .2, y: .7 } },
        right: { hip: { x: .7, y: .3 }, knee: { x: .75, y: .5 }, ankle: { x: .8, y: .7 } },
      },
    },
  },
  characters: {
    'mao-ao::male': { portraitBeltSpline: five, legThickness: 1 },
  },
};
assert(Core.validateProject(validProject).ok, 'complete authoring project should validate');

assert.match(htmlSource, /Pants Rig Author/);
assert.match(htmlSource, /workspace guides only/i);
assert.match(htmlSource, /id="pantsCanvas"/);
assert.match(htmlSource, /id="portraitCanvas"/);
assert.match(htmlSource, /id="weightChannel"/);
assert.match(htmlSource, /id="legThickness"/);
assert.match(appSource, /window\.getPortraitFighters/);
assert.match(appSource, /NpcAvatarPreview\.renderProfileToCanvas/);
assert.match(appSource, /Core\.buildLegOpeningFitControls/);
assert.match(appSource, /Core\.encodeWeightGridRle/);
assert.match(appSource, /window\.__pantsRigAuthorDebug/);
assert.match(configSource, /HOBUNJI_PANTS_RIGS/);
assert.match(runtimeSource, /resolveSkinnedPixelWorldPosition/);
assert.match(runtimeSource, /leftThigh/);
assert.match(runtimeSource, /staticFitImageData/);
assert.match(runtimeSource, /__pantsRigRuntimeDebug/);

console.log('Pants rig author regression: PASS');
