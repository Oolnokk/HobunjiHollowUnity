#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8');
const windowObject = {
  location: { pathname: '/game/' },
  requestAnimationFrame() { return 1; },
  HobunjiCharacterDimensions: {
    dimensionsFor(speciesId, gender) {
      if (speciesId === 'mao-ao' && gender === 'male') return { height: 1 };
      if (speciesId === 'engh-sho' && gender === 'male') return { height: 2 };
      return null;
    },
  },
};
windowObject.window = windowObject;

const context = vm.createContext({
  window: windowObject,
  console,
  Math,
  Number,
  String,
  Object,
  Set,
  WeakMap,
  JSON,
});
vm.runInContext(source, context, { filename: 'hand-tool-grips.js' });

const grips = windowObject.HobunjiHandToolGrips;
assert.ok(grips, 'hand-tool grip API should load');
assert.equal(grips.toolScaleForTool('hatchet'), 1, 'legacy base scale remains unchanged');
assert.equal(grips.heightMultiplierForTool('hatchet'), 1, 'legacy tools normalize to full height influence');
assert.equal(grips.characterHeightRatio('engh-sho', 'male'), 2, 'height ratio should use calculated height against Mao-ao male');
assert.equal(grips.effectiveToolScaleForTool('hatchet', 'engh-sho', 'male'), 2, 'height multiplier 1 should fully follow the height ratio');

grips.mutate(data => {
  data.tools.hatchet.toolScale = 1.2;
  data.tools.hatchet.heightMultiplier = 0.5;
});
assert.ok(Math.abs(grips.effectiveToolScaleForTool('hatchet', 'engh-sho', 'male') - 1.8) < 1e-12, 'height multiplier should blend between fixed and fully proportional size');

const primary = grips.primaryGripForTool('hatchet', 'melee', { speciesId: 'engh-sho', gender: 'male' });
assert.ok(Math.abs(primary.position.x - (-0.04 * 1.8)) < 1e-12, 'primary grip position should expand by the same effective scale as the weapon');

grips.mutate(data => {
  data.tools.hatchet.heightMultiplier = 0;
});
assert.equal(grips.effectiveToolScaleForTool('hatchet', 'engh-sho', 'male'), 1.2, 'height multiplier 0 should preserve base scale for every character height');
assert.equal(grips.effectiveToolScaleForTool('hatchet', 'unknown', 'male'), 1.2, 'missing dimensions should safely fall back to the authored base scale');

console.log('hand tool calculated-height scaling: ok');
