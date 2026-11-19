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
  HobunjiRigPreviewSpecies: { baseSpecies: kind => ({
    'grehlr-den-mother': 'grehlr', 'gar-wolf-alpha': 'gar-wolf',
  })[kind] || kind },
}; // Conflicting frozen master proves the live game profile wins.
const src = fs.readFileSync('docs/js/animation-author-creature-gameplay-parity.js', 'utf8');
vm.runInNewContext(src, { window }, { filename: 'animation-author-creature-gameplay-parity.js' });
const parity = window.AnimationAuthorCreatureGameplayParity;
assert(parity, 'browser helper should export the gameplay parity API');
assert.equal(parity.canonicalCreatures().grehlr.sizeScales.small.x, 0.2, 'live runtime profile beats frozen defaults');
assert.equal(parity.validClass('wrong'), 'medium');
assert.equal(parity.gameplayProfileForKind('grehlr-den-mother'), master.grehlr,
  'den mothers inherit the same size and floor profile as gameplay');
assert.equal(parity.gameplayProfileForKind('unknown'), null, 'unknown animals do not silently borrow an unrelated species');

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
const legacyVariant = { creatures: { 'grehlr-den-mother': { kind: 'grehlr-den-mother', anchors: { shoulderGrip: { position: { x: 0, y: 0.1, z: 0 } } } } } };
const restoredVariant = parity.normalizeImported(JSON.parse(JSON.stringify(legacyVariant)), legacyVariant);
assert.equal(restoredVariant.creatures['grehlr-den-mother'].sizeScales.small.x, 0.2,
  'legacy den-mother imports inherit the actual Grehlr class sizes, not generic editor defaults');
assert.equal(restoredVariant.creatures['grehlr-den-mother'].groundOffsets.small, 0.13,
  'legacy den-mother imports also inherit gameplay floor');
assert.equal(restoredVariant.creatures['grehlr-den-mother'].anchors.shoulderGrip.position.y, 0.1,
  'the variant inherits proportions without replacing independently authored attachment points');
const custom = {
  creatures: { grehlr: { sizeScales: { ...master.grehlr.sizeScales, small: { x: .73, y: 1.1 } },
    groundOffsets: { small: 0, medium: 0.2, large: 0.4 } } },
};
const preserved = parity.normalizeImported(JSON.parse(JSON.stringify(custom)), custom);
assert.equal(preserved.creatures.grehlr.sizeScales.small.x, .73, 'intentional X authoring survives import');
assert.equal(preserved.creatures.grehlr.groundOffsets.small, 0, 'intentional Auto/0 survives import');

// Audit every real gameplay species, not only the representative mock rows above.
const realRuntime = { window: {}, document: {}, localStorage: { getItem: () => null, setItem: () => {} },
  performance: { now: () => 0 } }; // The shared runtime registry can be evaluated without DOM or WebGL.
vm.runInNewContext(fs.readFileSync('docs/config/attachment-rig-profiles.js', 'utf8'), realRuntime);
vm.runInNewContext(src, realRuntime);
const realProfiles = realRuntime.window.HOBUNJI_ATTACHMENT_RIG_PROFILES.creatures;
const realParity = realRuntime.window.AnimationAuthorCreatureGameplayParity;
assert(Object.keys(realProfiles).length >= 16, 'expect at least the current canonical 16 creature rig entries');
for (const [kind, rig] of Object.entries(realProfiles)) {
  for (const cls of ['small', 'medium', 'large']) {
    const expectedScale = rig.sizeScales[cls];
    const expectedGround = rig.groundOffsets[cls];
    const effective = realParity.placement(rig, cls, 1.2);
    assert.equal(effective.widthScale, expectedScale.x, kind + ' ' + cls + ' width');
    assert.equal(effective.heightScale, expectedScale.y, kind + ' ' + cls + ' height');
    assert.equal(effective.groundLift, expectedGround > 0 ? expectedGround : 1.2 * expectedScale.y / 2,
      kind + ' ' + cls + ' absolute vs Auto ground');
  }
}

const pixels = new Uint8ClampedArray(4 * 4 * 4); // A tiny native PNG image with transparent foot padding.
pixels[(2 * 4 + 1) * 4 + 3] = 255;
pixels[(3 * 4 + 1) * 4 + 3] = 200; // Antialiased fringe is deliberately ignored by the game.
const idle = { width: 4, height: 4, getContext: () => ({ getImageData: () => ({ data: pixels }) }) };
assert.equal(parity.opaqueIdleBottomRatio(idle), .75, 'bottommost fully opaque row is the gameplay foot baseline');
for (const size of ['small', 'medium', 'large']) {
  const worldHeight = 1.2;
  const layout = parity.placement(master.grehlr, size, worldHeight);
  const bottomPixel = parity.opaqueIdleBottomRatio(idle);
  const nativePadding = -worldHeight * (1 - bottomPixel);
  const visibleBottom = worldHeight * (0.5 - bottomPixel);
  const editorFoot = layout.groundLift + nativePadding * layout.heightScale + visibleBottom * layout.heightScale;
  const gameFoot = layout.groundLift + (nativePadding + visibleBottom) * layout.heightScale;
  assert.equal(editorFoot, gameFoot, size + ' editor art grounding must match group-scaled gameplay');
}

assert.equal(parity.opaqueIdleBottomRatio({ width: 0, height: 0 }), 1, 'missing idle source remains unshifted');

const index = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8');
assert.match(index, /src="\.\.\/\.\.\/js\/animation-author-creature-gameplay-parity\.js\?v=/, 'editor loads the helper');
assert.match(index, /anchorScaleRoot\.scale\.set\(scale\.x, scale\.y, 1\)/, 'gameplay-authored rig anchors keep PNG-local X/Y size');
assert.match(index, /record\.object\.scale\.set\(record\.baseScale\.x \* scale\.x, record\.baseScale\.y \* scale\.y, record\.baseScale\.z\)/,
  'visible animal faces receive size directly on their own PNG-local X/Y');
assert.doesNotMatch(index, /creaturePlaneScaleRoot\.scale\.set\(1, layout\.heightScale, layout\.widthScale\)/,
  'new parity code must not rescale the retired group hierarchy a second time');
assert.match(index, /Reset all three scales to gameplay/, 'reset scales uses per-species gameplay values, not generic editor fallbacks');
assert.match(index, /const oldImportV1554 = importAnimationProjectData/, 'post-import parity wrapper exists');
assert.match(index, /if \(options.fromAutosave && data\?\.attachmentRigProfiles\?\.creatures\)/,
  'legacy autosaves restore authored class and ground rows after the V15.24 wholesale overwrite');
assert.match(index, /if \(stored\.sizeScales\) target\.sizeScales = structuredCloneSafe\(recovered\.sizeScales\)/,
  'autosave restoration applies guarded user-authored sizes');
assert.match(index, /if \(stored\.groundOffsets\) target\.groundOffsets = structuredCloneSafe\(recovered\.groundOffsets\)/,
  'autosave restoration applies guarded user-authored floor lifts');
assert.match(index, /animationAuthor\.mode === 'rig' \? 0 : layout\.groundLift/, 'rig floor calibrator remains fixed');
assert.match(index, /Auto\/0 uses half the scaled model height/, 'moving blue floor uses the real Auto lift');
assert.match(index, /normalizeImported\(oldNormalizeV1554\(source\), source\)/, 'saved profiles are normalized after legacy migrations');
assert.match(index, /window\.MultiAvatarAnimationAuthor\.creatureGameplayParity = parityReadoutV1554/, 'mobile parity diagnostic is available');
assert.match(index, /parityV1554\.opaqueIdleBottomRatio\(idleCanvas\)/, 'editor actually applies alpha foot scanning');
assert.match(index, /actor\.model\.position\.y = scaledPadding/, 'class-specific height scales the alpha-padding correction without changing the rig root');
assert.match(index, /creatureOpaquePaddingNativeY \* layout\.heightScale/, 'per-size padding uses gameplay Y multiplier');
assert.match(index, /shoulderGripPosePreviewControllerV1549\?\.syncPlaneScale\?\.\(\)/, 'perched pose updates after the size-class ground change');
const shoulderPose = fs.readFileSync('docs/js/animation-author-shoulder-pose-preview.js', 'utf8');
assert.match(shoulderPose, /posedRoot\.position\.copy\(sourceRoot\.position\)/,
  'cached perched avatar copies the scaled padding correction from its source');
assert.match(index, /Use game size and ground values/, 'on-device custom-profile recovery is available');
assert.match(index, /parityV1554\.gameplayProfileForKind\(kind\)/, 'new animal variants receive game species fallback before actor creation');
assert.match(index, /profile\.sizeScales = structuredCloneSafe\(gameProfile\.sizeScales\)/, 'reset uses current game scales and preserves unrelated anchors');
const game = fs.readFileSync('docs/game.js', 'utf8');
assert.match(game, /const groundLift = Number\.isFinite\(authoredGroundOffset\) \? authoredGroundOffset : halfH/, 'real game uses replacement offset');
console.log('animation-author creature gameplay parity: passed size classes, Z width, floor Auto/authored, defaults, imports and mobile diagnostics');
