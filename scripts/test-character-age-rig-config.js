'use strict';
const assert = require('node:assert/strict'); // Checks actual shipped age bridge, editor and family config parity.
const fs = require('node:fs'); // Reads production scripts without mocking their authored proportion math.
const vm = require('node:vm'); // Executes the browser-only bridge in isolated, persisted/reloaded settings.
const source = fs.readFileSync('docs/js/character-age-rig-config.js', 'utf8'); // The production shared config module under test.
const authorSource = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // The real Animation Author stage and RAF paths.
const familySource = fs.readFileSync('docs/js/romance-family.js', 'utf8'); // Checks the runtime's consumers of configured body/head and limb sizes.
const pngSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
const headRuntime = fs.readFileSync('docs/js/character-rig-scale-avatar-runtime.js', 'utf8'); // Non-family children expose stage data at avatar build time.
const handDriver = fs.readFileSync('docs/js/procedural-hand-frame-driver.js', 'utf8'); // One-time hand GLB swaps use generic child sizing.
const feetRuntime = fs.readFileSync('docs/js/procedural-leg-animation.js', 'utf8'); // Final imported foot GLBs honor the same factor and ground contact. // Checks the runtime head/body factor and geometry-sizing contract.
const html = fs.readFileSync('docs/index.html', 'utf8'); // Ensures configuration is activated before family walkers/game initialization.
const bootstrap = fs.readFileSync('docs/js/attachment-rig-latest-authored-snapshot.js', 'utf8'); // Ensures the editor loads the SAME bridge.
const storage = new Map(); // Local storage models the same-origin persistence boundary.
const repositoryFamily = () => ({ phaseScales: {
  basket: { body: .32, head: .50, hand: 1.2, foot: 1.2 },
  toddler: { body: .4, head: .66, hand: 1, foot: 1 },
  child: null,
}, childLimbModifiers: { hand: 1, foot: 1 } });
const repositoryPng = () => ({ childScaleMultiplier: .5, childHeadScaleMultiplier: .72 });
function start(overrides = {}) {
  const family = repositoryFamily(); // Every new browser context starts with checked-in proportions.
  const png = repositoryPng(); // Separate object ensures changing one stage cannot rewrite repository defaults.
  const window = { HobunjiRomanceConfig: { family }, SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: png } } } };
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  };
  vm.runInNewContext(source, { window, localStorage, console, ...overrides });
  return { family, png, api: window.HobunjiCharacterAgeRigConfig, window, localStorage };
}
const initial = start();
assert(initial.api, 'the shared age-rig API must initialize when family and PNG settings are available');
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(initial.api.repositoryDefaults()), {
  baby: { width: .32, height: .32, head: .50, hand: 1.2, foot: 1.2, widthConvergence: 0, heightConvergence: 0 },
  toddler: { width: .4, height: .4, head: .66, hand: 1, foot: 1, widthConvergence: 0, heightConvergence: 0 },
  child: { width: .5, height: .5, head: .72, hand: 1, foot: 1, widthConvergence: 0, heightConvergence: 0 },
});
assert.equal(initial.api.snapshot().applied, false, 'drafts never change the game before explicit Apply');
const draftKey = 'hobunjiFullCharacterScale.ageModes.v1'; // Editor drafts must not silently become gameplay overrides.
storage.set(draftKey, 'untouched draft');
const override = {
  baby: { width: .36, height: .42, head: .51, hand: 1.4, foot: 1.25 },
  toddler: { width: .45, height: .47, head: .68, hand: 1.1, foot: 1.05 },
  child: { width: .57, height: .63, head: .76, hand: 1.15, foot: 1.13 },
};
const oldAppliedKey = initial.api.appliedStorageKey; // Simulate an earlier saved gameplay override.
storage.set(oldAppliedKey, JSON.stringify({ schema: initial.api.schema, presetVersion: 1, modifiers: override }));
const migrated = start();
assert.equal(migrated.family.phaseScales.basket.height, .32, 'old applied baby fallback must migrate with the new individual preset');
assert.equal(migrated.family.phaseScales.toddler.height, .4, 'old applied toddler fallback must migrate too');
assert.equal(migrated.png.childScaleMultiplier, .63, 'independent child override survives the preset upgrade');
assert.equal(JSON.parse(storage.get(oldAppliedKey)).presetVersion, initial.api.presetVersion, 'migration persists its new version');
migrated.api.restoreRepositoryOnThisDevice();
const applied = plain(initial.api.applyOnThisDevice(override));
assert.deepEqual(applied, Object.fromEntries(Object.entries(override).map(([mode, values]) => [mode, { ...values, widthConvergence: 0, heightConvergence: 0 }])), 'valid global authoring values must be persisted unchanged');
assert.equal(initial.family.phaseScales.basket.width, .36, 'baby width reaches the family record');
assert.equal(initial.family.phaseScales.basket.height, .42, 'baby height is independent of width');
assert.equal(initial.family.phaseScales.basket.body, .42, 'older family readers receive Height through legacy Body');
assert.equal(initial.family.phaseScales.toddler.head, .68, 'toddler head is consumed by the same family record fields');
assert.equal(initial.family.phaseScales.toddler.hand, 1.1, 'toddler hand sizes reach the live family limb controller');
assert.equal(initial.family.childLimbModifiers.foot, 1.13, 'child foot sizes reach the live family limb controller');
assert.deepEqual(plain(initial.api.nonFamilyChildLimbsFor({ role: 'child', tags: ['child'] })),
  { hand: 1.15, foot: 1.13, phase: 'child', owner: 'generic-child-visuals' },
  'ordinary authored child NPCs must use the same global extremity modifiers');
assert.equal(initial.api.nonFamilyChildLimbsFor({ role: 'child', tags: ['child', 'family'] }), null,
  'family child GLBs must not receive both generic and FamilyBabyLimbs multipliers');
assert.equal(initial.api.nonFamilyChildLimbsFor({ role: 'villager', tags: [] }), null,
  'adult NPCs must never inherit child limb scaling');
assert.equal(initial.png.childScaleMultiplier, .63, 'child Height reaches PNGPlaneAvatar childScaleFor');
assert.equal(initial.png.childWidthScaleMultiplier, .57, 'child Width reaches PNGPlaneAvatar independently');
assert.equal(initial.png.childHeadScaleMultiplier, .76, 'child final head size reaches PNGPlaneAvatar childScaleFor');
assert.equal(storage.get(draftKey), 'untouched draft', 'applying a runtime override must preserve editor drafts and game saves');
const adult = { x: 1.2, y: 1.5, head: 1.1, offsetY: .05 }; // Distinct axis scales exercise non-uniform body compensation.
for (const mode of ['baby', 'toddler', 'child']) {
  const worldWidth = mode === 'child' ? initial.png.childWidthScaleMultiplier : initial.family.phaseScales[mode === 'baby' ? 'basket' : 'toddler'].width;
  const worldHeight = mode === 'child' ? initial.png.childScaleMultiplier : initial.family.phaseScales[mode === 'baby' ? 'basket' : 'toddler'].height;
  const worldHead = mode === 'child' ? initial.png.childHeadScaleMultiplier : initial.family.phaseScales[mode === 'baby' ? 'basket' : 'toddler'].head;
  const preview = plain(initial.api.composePreviewScale(adult, applied[mode]));
  assert.equal(preview.x, adult.x * worldWidth, mode + ': preview Width matches child modelWidth geometry');
  assert.equal(preview.y, adult.y * worldHeight, mode + ': preview Height matches child modelHeight geometry');
  assert.equal(preview.head, adult.head * worldHead, mode + ': preview final head must match adult head × childHeadFactor × child body');
  assert.equal(preview.offsetY, adult.offsetY, mode + ': rig head offset is the same fraction of its pre-scaled model height');
  assert(Math.abs((worldHead / worldHeight) * worldHeight - worldHead) < 1e-10, 'head/height ratio preserves vertical head size');
  assert(Math.abs((worldHead / worldWidth) * worldWidth - worldHead) < 1e-10, 'head/width ratio preserves horizontal head size');
}
assert.equal(initial.api.composePreviewScale(adult, null).x, adult.x, 'adult reference must remain unaffected');
const loadedAgain = start();
assert.equal(loadedAgain.family.phaseScales.basket.width, .36, 'same-origin game reload recovers applied baby width');
assert.equal(loadedAgain.family.phaseScales.basket.body, .42, 'same-origin game reload recovers applied baby height');
assert.equal(loadedAgain.png.childWidthScaleMultiplier, .57, 'same-origin game reload recovers independent child width');
assert.equal(loadedAgain.png.childHeadScaleMultiplier, .76, 'applied child head settings survive a same-site reload');
assert.equal(loadedAgain.api.snapshot().applied, true);
loadedAgain.api.restoreRepositoryOnThisDevice();
assert.equal(loadedAgain.family.phaseScales.basket.body, .32, 'restoring the device resets the actual game config');
assert.equal(loadedAgain.png.childHeadScaleMultiplier, .72, 'restoring child defaults must also reset the PNG runtime');
assert.equal(storage.get(draftKey), 'untouched draft', 'restoring game defaults does not erase editor drafts');
assert.equal(start().api.snapshot().applied, false, 'repository restore survives a browser reload');
initial.api.applyOnThisDevice({ baby: { body: Infinity, head: -1, hand: 999, foot: null },
  toddler: { body: .25, head: .4, hand: .8, foot: .9 }, child: { body: .5, head: .7, hand: .9, foot: .99 } });
assert.equal(initial.family.phaseScales.basket.body, .32, 'nonfinite values fall back to repository defaults');
assert.equal(initial.family.phaseScales.basket.head, .5, 'negative values fall back to repository defaults');
assert.equal(initial.family.phaseScales.basket.hand, 2, 'extreme hand proportions are safely clamped');
assert.equal(initial.family.phaseScales.basket.foot, 1.2, 'missing foot values fall back to repository defaults');
storage.set(initial.api.appliedStorageKey, 'not-json');
assert.equal(start().api.snapshot().applied, false, 'corrupt local storage must not corrupt gameplay');

assert.match(pngSource, /const child = childScaleFor\(options\);[\s\S]{0,45}if \(child\) scale \*= child\.body;/,
  'PNGPlaneAvatar must actually build the child body size into its dimensions');
assert.match(pngSource, /headFactor: head \/ height, headFactorX: head \/ width/, 'runtime head bone must compensate child width and height independently');
assert.match(familySource, /function phaseScaleFields\(phase\) \{[\s\S]{0,320}childBodyHeightScale: scales\.height[\s\S]{0,120}childBodyWidthScale: scales\.width/,
  'live family records must consume the exact phase body/head configuration');
assert.match(familySource, /FamilyBabyLimbs\?\.balanceWalker\?\./, 'the family runtime must consume phase GLB size settings');
assert(headRuntime.includes('hobunjiChildLimbVisualModifiers'), 'world child avatars must publish independent child sizes');
assert(handDriver.includes('avatarRoot.userData?.hobunjiChildLimbVisualModifiers?.hand'), 'hand driver must scale both fallback and async GLB replacements');
assert(feetRuntime.includes('childFootFactor'), 'foot runtime must scale fallback and replacement GLBs');
assert(feetRuntime.includes('foot.userData.contactRadiusY *= childFootFactor'), 'foot contact must adjust with child foot sizes');
assert(feetRuntime.includes('options.onFootVisualsReplaced({ left: leftMesh, right: rightMesh, root })'),
  'one-shot final foot GLB callback must exist for editor parity');
assert(html.indexOf('character-age-rig-config.js?v=') > html.indexOf('romance-config.js?v=') &&
  html.indexOf('character-age-rig-config.js?v=') < html.indexOf('romance-family.js?v=') &&
  html.indexOf('character-age-rig-config.js?v=') < html.indexOf('<script src="game.js?v='),
  'the game must activate the bridge before family gameplay and its initial world actors');
assert(bootstrap.indexOf('character-age-rig-config.js?v=') < bootstrap.indexOf('character-scale-comparison.js?v='),
  'Animation Author must use the same shared bridge before building its lineup');
assert.match(authorSource, /HobunjiCharacterAgeRigConfig\?\.composePreviewScale/, 'preview composition must reuse shared gameplay age math');
assert.match(authorSource, /HobunjiCharacterAgeRigConfig\?\.applyOnThisDevice/, 'the Apply action must actually activate shared runtime values');
assert.match(authorSource, /HobunjiCharacterAgeRigConfig\?\.restoreRepositoryOnThisDevice/, 'Reset must reach the live config, not just local preview');

console.log('PASS age rig parity: default and applied config, game child records, hand/foot modifiers, same-site reload, malformed data, and preview composition');
