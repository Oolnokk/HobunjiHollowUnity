// Regression: the Multi-Avatar Animation Author uses live CreatureGenetics proportions and ground lift.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const master = {
  grehlr: {
    kind: 'grehlr',
    anchors: { saddle: { position: { x: 0, y: 0, z: 0 } } },
    sizeScales: { small: { x: 0.2, y: 0.3 }, medium: { x: 0.5, y: 0.75 }, large: { x: 1, y: 1.25 } },
    groundOffsets: { small: 0.13, medium: 0.26, large: 0.5 },
  },
  skeeri: {
    kind: 'skeeri',
    sizeScales: { small: { x: 1, y: 1 }, medium: { x: 1.77, y: 1.77 }, large: { x: 3.38, y: 3.38 } },
    groundOffsets: { small: 0, medium: 0, large: 0 },
  },
}; // Fake but representative runtime source: nonuniform Grehlr scales and zero/Auto Skeeri floors.

const window = {
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { creatures: master },
  HOBUNJI_ATTACHMENT_RIG_MASTER: { profiles: { creatures: { grehlr: { sizeScales: {} } } } },
}; // Conflicting frozen master proves the live game profile wins.
const src = fs.readFileSync('docs/js/animation-author-creature-gameplay-parity.js', 'utf8');
vm.runInNewContext(src, { window }, { filename: 'animation-author-creature-gameplay-parity.js' });
const parity = window.AnimationAuthorCreatureGameplayParity;
assert(parity, 'browser helper should export the gameplay parity API');
assert.equal(parity.canonicalCreatures().grehlr.sizeScales.small.x, 0.2, 'live runtime profile beats frozen defaults');
assert.equal(parity.validClass('wrong'), 'medium');

for (const [sizeClass, expected] of [['small', 0.13], ['medium', 0.26], ['large', 0.5]]) {
  const layout = parity.placement(master.grehlr, sizeClass, 1.2);
  assert.equal(layout.groundMode, 'Authored');
  assert.equal(layout.groundLift, expected, 'authored Y replaces automatic half-height exactly once');
  assert.equal(layout.groupScale.x, 1, 'billboard depth must stay unscaled');
  assert.equal(layout.groupScale.y, master.grehlr.sizeScales[sizeClass].y);
  assert.equal(layout.groupScale.z, master.grehlr.sizeScales[sizeClass].x, 'visible sprite width uses Z');
}
const automatic = parity.placement(master.skeeri, 'large', 1.4);
assert.equal(automatic.groundMode, 'Auto');
assert(Math.abs(automatic.groundLift - 1.4 * 3.38 / 2) < 1e-10, 'Auto floor uses half the class-scaled model height');
assert.equal(parity.placement({ sizeScales: { medium: { x: -2, y: Number.NaN } } }, 'medium', 1).groundLift, .5);
const defaultLibrary = { characters: { 'mao-ao::male': { untouched: true } }, creatures: { grehlr: { sizeScales: {} } } };
assert.equal(parity.installRepositoryDefaults(defaultLibrary), 2);
assert.equal(defaultLibrary.creatures.grehlr.sizeScales.small.x, .2);
assert.equal(defaultLibrary.characters['mao-ao::male'].untouched, true);
defaultLibrary.creatures.grehlr.groundOffsets.small = 8;
assert.equal(master.grehlr.groundOffsets.small, .13, 'editable copy must not alter the frozen game source');
const saved = parity.normalizeImported({ creatures: { grehlr: { sizeScales: { ...master.grehlr.sizeScales } } } },
  { creatures: { grehlr: { sizeScales: master.grehlr.sizeScales } } });
assert.equal(saved.creatures.grehlr.groundOffsets.medium, .26, 'old projects lacking groundOffsets must receive real game values');
const custom = {
  creatures: { grehlr: { sizeScales: { ...master.grehlr.sizeScales, small: { x: .73, y: 1.1 } },
    groundOffsets: { small: 0, medium: 0.2, large: 0.4 } } },
};
const preserved = parity.normalizeImported(JSON.parse(JSON.stringify(custom)), custom);
assert.equal(preserved.creatures.grehlr.sizeScales.small.x, .73, 'intentional X authoring survives import');
assert.equal(preserved.creatures.grehlr.groundOffsets.small, 0, 'intentional Auto/0 survives import');

const index = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8');
assert.match(index, /src="\.\.\/\.\.\/js\/animation-author-creature-gameplay-parity\.js\?v=/, 'editor loads the helper');
assert.match(index, /creaturePlaneScaleRoot\.scale\.set\(1, layout\.heightScale, layout\.widthScale\)/, 'width uses rotated billboard Z');
assert.match(index, /animationAuthor\.mode === 'rig' \? 0 : layout\.groundLift/, 'rig floor calibrator remains fixed');
assert.match(index, /Auto\/0 uses half the scaled model height/, 'moving blue floor uses the real Auto lift');
assert.match(index, /normalizeImported\(oldNormalizeV1554\(source\), source\)/, 'saved profiles are normalized after legacy migrations');
assert.match(index, /window\.MultiAvatarAnimationAuthor\.creatureGameplayParity = parityReadoutV1554/, 'mobile parity diagnostic is available');
assert.match(index, /Use game size and ground values/, 'on-device custom-profile recovery is available');
assert.match(index, /profile\.sizeScales = structuredCloneSafe\(gameProfile\.sizeScales\)/, 'reset uses current game scales and preserves unrelated anchors');
const game = fs.readFileSync('docs/game.js', 'utf8');
assert.match(game, /const groundLift = Number\.isFinite\(authoredGroundOffset\) \? authoredGroundOffset : halfH/, 'real game uses replacement offset');
console.log('animation-author creature gameplay parity: passed size classes, Z width, floor Auto/authored, defaults, imports and mobile diagnostics');
