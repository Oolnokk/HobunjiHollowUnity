#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const coreSource = read('docs/js/pants-rig-core.js');
const appLoaderSource = read('docs/tools/pants-rig-author/app.js');
const appBaseSource = read('docs/tools/pants-rig-author/app-base.js');
const enhancementsSource = read('docs/tools/pants-rig-author/enhancements.js');
const hostBridgeSource = read('docs/tools/pants-rig-author/host-bridge.js');
const htmlSource = read('docs/tools/pants-rig-author/index.html');
const configSource = read('docs/config/pants-rigs.js');
const runtimeSource = read('docs/js/pants-rig-runtime.js');
const proceduralLoaderSource = read('docs/js/procedural-impact-tabs.js');
const proceduralBaseSource = read('docs/js/procedural-impact-tabs-base.js');
const proceduralPantsSource = read('docs/js/procedural-pants-rig-author.js');

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
    pants_basic: {
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

assert.match(appLoaderSource, /app-base\.js/);
assert.match(appLoaderSource, /enhancements\.js/);
assert.match(appLoaderSource, /host-bridge\.js/);
assert.match(appBaseSource, /window\.getPortraitFighters/);
assert.match(appBaseSource, /NpcAvatarPreview\.renderProfileToCanvas/);
assert.match(appBaseSource, /Core\.buildLegOpeningFitControls/);
assert.match(appBaseSource, /Core\.encodeWeightGridRle/);
assert.match(appBaseSource, /window\.__pantsRigAuthorDebug/);
assert.match(enhancementsSource, /pants_basic\.png/);
assert.match(enhancementsSource, /assets\/cosmetics\/clothes\/legs\/pants_basic\.png/);
assert.match(enhancementsSource, /pantsWeightPaintOverlay/);
assert.match(enhancementsSource, /setCharacter/);
assert.match(enhancementsSource, /weight > 0 \? Math\.max\(42/);
assert.match(hostBridgeSource, /hobunji-pants-rig-changed/);
assert.match(hostBridgeSource, /pointerup/);
assert(fs.existsSync(path.join(root, 'docs/assets/cosmetics/clothes/legs/pants_basic.png')), 'repository pants_basic.png should exist on this branch');

assert.match(configSource, /HOBUNJI_PANTS_RIGS/);
assert.match(runtimeSource, /resolveSkinnedPixelWorldPosition/);
assert.match(runtimeSource, /leftThigh/);
assert.match(runtimeSource, /staticFitImageData/);
assert.match(runtimeSource, /__pantsRigRuntimeDebug/);

assert.match(proceduralLoaderSource, /procedural-impact-tabs-base\.js/);
assert.match(proceduralLoaderSource, /procedural-pants-rig-author\.js/);
assert.match(proceduralBaseSource, /installEditorLegBoneGuideBridge/);
assert.match(proceduralPantsSource, /HobunjiGameplayBackdrop/);
assert.match(proceduralPantsSource, /getAvatarModel/);
assert.match(proceduralPantsSource, /left_thigh/);
assert.match(proceduralPantsSource, /right_calf/);
assert.match(proceduralPantsSource, /Live 3D/);
assert.match(proceduralPantsSource, /authorApi\(\)\?\.setCharacter/);
assert.match(proceduralPantsSource, /Core\.sampleWeights/);
assert.match(proceduralPantsSource, /Core\.buildLegOpeningFitControls/);
assert.match(proceduralPantsSource, /constructorNamed/);
assert.match(proceduralPantsSource, /sourceTexture\.clone/);
assert.match(proceduralPantsSource, /globalThreeRequired: false/);
assert.doesNotMatch(proceduralPantsSource, /const THREE = window\.THREE/);
assert.match(proceduralPantsSource, /hobunji-pants-rig-changed/);
assert.match(proceduralPantsSource, /ProceduralPantsRigAuthor/);

console.log('Pants rig author regression: PASS');
