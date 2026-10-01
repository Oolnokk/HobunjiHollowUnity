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
assert.equal(grips.heightMultiplierForTool('hatchet'), 0.5, 'tools default to half of the calculated-height difference');
assert.equal(grips.characterHeightRatio('engh-sho', 'male'), 2, 'height ratio should use calculated height against Mao-ao male');
assert.equal(grips.effectiveToolScaleForTool('hatchet', 'engh-sho', 'male'), 1.5, 'default multiplier 0.5 follows half of the height ratio');

// Drafts saved while every shape defaulted to 1.0 adopt the 0.5 default once.
const legacyDraft = grips.clone();
delete legacyDraft.heightMultiplierPreset;
legacyDraft.tools.hatchet.heightMultiplier = 1;
grips.replace(legacyDraft);
assert.equal(grips.heightMultiplierForTool('hatchet'), 0.5, 'legacy all-1.0 drafts migrate to 0.5');
grips.mutate(data => { data.tools.hatchet.heightMultiplier = 1; });
assert.equal(grips.heightMultiplierForTool('hatchet'), 1, 'an explicitly authored multiplier survives after migration');
assert.equal(grips.effectiveToolScaleForTool('hatchet', 'engh-sho', 'male'), 2, 'height multiplier 1 should fully follow the height ratio');

grips.mutate(data => {
  data.tools.hatchet.toolScale = 1.2;
  data.tools.hatchet.heightMultiplier = 0.5;
});
assert.ok(Math.abs(grips.effectiveToolScaleForTool('hatchet', 'engh-sho', 'male') - 1.8) < 1e-12, 'height multiplier should blend between fixed and fully proportional size');

// Height scaling pivots on the primary grip: the hand target is base * grip for
// every body, and other item points expand around it.
const tall = { speciesId: 'engh-sho', gender: 'male' };
const primary = grips.primaryGripForTool('hatchet', 'melee', tall);
assert.ok(Math.abs(primary.position.x - (-0.04 * 1.2)) < 1e-12, 'hand target ignores character height (grip is the scaling origin)');
const placement = grips.heldItemPlacementForTool('hatchet', 'melee', tall);
assert.ok(Math.abs(placement.scale - 1.8) < 1e-12, 'visible item uses base x height scale');
const tip = grips.itemPointToHolder('hatchet', { x: 0, y: 0, z: 1 }, 'melee', tall);
const grip = grips.authoredPrimaryGripForTool('hatchet', 'melee').position;
assert.ok(Math.abs(tip.z - 1.2 * ((1 - 1.5) * grip.z + 1.5 * 1)) < 1e-12, 'item points expand about the grip');
const back = grips.holderPointToItem('hatchet', tip, 'melee', tall);
assert.ok(Math.abs(back.z - 1) < 1e-12 && Math.abs(back.x) < 1e-12, 'holder->item inverts item->holder');

grips.mutate(data => {
  data.tools.hatchet.heightMultiplier = 0;
});
assert.equal(grips.effectiveToolScaleForTool('hatchet', 'engh-sho', 'male'), 1.2, 'height multiplier 0 should preserve base scale for every character height');
assert.equal(grips.effectiveToolScaleForTool('hatchet', 'unknown', 'male'), 1.2, 'missing dimensions should safely fall back to the authored base scale');

console.log('hand tool calculated-height scaling: ok');
