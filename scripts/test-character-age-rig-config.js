'use strict';
const assert = require('node:assert/strict'); // Checks actual shipped age bridge, editor and family config parity.
const fs = require('node:fs'); // Reads production scripts without mocking their authored proportion math.
const vm = require('node:vm'); // Executes the browser-only bridge in isolated, persisted/reloaded settings.
const source = fs.readFileSync('docs/js/character-age-rig-config.js', 'utf8'); // The production shared config module under test.
const authorSource = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // The real Animation Author stage and RAF paths.
const familySource = fs.readFileSync('docs/js/romance-family.js', 'utf8'); // Checks the runtime's consumers of configured body/head and limb sizes.
const pngSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'); // Checks the runtime head/body factor and geometry-sizing contract.
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
  baby: { body: .32, head: .50, hand: 1.2, foot: 1.2 },
  toddler: { body: .4, head: .66, hand: 1, foot: 1 },
  child: { body: .5, head: .72, hand: 1, foot: 1 },
});
assert.equal(initial.api.snapshot().applied, false, 'drafts never change the game before explicit Apply');
const draftKey = 'hobunjiFullCharacterScale.ageModes.v1'; // Editor drafts must not silently become gameplay overrides.
storage.set(draftKey, 'untouched draft');
const override = {
  baby: { body: .36, head: .51, hand: 1.4, foot: 1.25 },
  toddler: { body: .45, head: .68, hand: 1.1, foot: 1.05 },
  child: { body: .57, head: .76, hand: 1.15, foot: 1.13 },
};
const applied = plain(initial.api.applyOnThisDevice(override));
assert.deepEqual(applied, override, 'valid global authoring values must be persisted unchanged');
assert.equal(initial.family.phaseScales.basket.body, .36, 'baby body is consumed by runtime phaseScaleFields');
assert.equal(initial.family.phaseScales.toddler.head, .68, 'toddler head is consumed by the same family record fields');
assert.equal(initial.family.phaseScales.toddler.hand, 1.1, 'toddler hand sizes reach the live family limb controller');
assert.equal(initial.family.childLimbModifiers.foot, 1.13, 'child foot sizes reach the live family limb controller');
assert.equal(initial.png.childScaleMultiplier, .57, 'child body size reaches PNGPlaneAvatar childScaleFor');
assert.equal(initial.png.childHeadScaleMultiplier, .76, 'child final head size reaches PNGPlaneAvatar childScaleFor');
assert.equal(storage.get(draftKey), 'untouched draft', 'applying a runtime override must preserve editor drafts and game saves');
const adult = { x: 1.2, y: 1.5, head: 1.1, offsetY: .05 }; // Distinct axis scales exercise non-uniform body compensation.
for (const mode of ['baby', 'toddler', 'child']) {
  const worldBody = mode === 'child' ? initial.png.childScaleMultiplier : initial.family.phaseScales[mode === 'baby' ? 'basket' : 'toddler'].body;
  const worldHead = mode === 'child' ? initial.png.childHeadScaleMultiplier : initial.family.phaseScales[mode === 'baby' ? 'basket' : 'toddler'].head;
  const preview = plain(initial.api.composePreviewScale(adult, applied[mode]));
  assert.equal(preview.x, adult.x * worldBody, mode + ': preview body width must match child modelWidth geometry');
  assert.equal(preview.y, adult.y * worldBody, mode + ': preview body height must match child modelHeight geometry');
  assert.equal(preview.head, adult.head * worldHead, mode + ': preview final head must match adult head × childHeadFactor × child body');
  assert.equal(preview.offsetY, adult.offsetY, mode + ': rig head offset is the same fraction of its pre-scaled model height');
  assert(Math.abs((worldHead / worldBody) * worldBody - worldHead) < 1e-10, 'runtime childHeadFactor equals preview final head/body relationship');
}
assert.equal(initial.api.composePreviewScale(adult, null).x, adult.x, 'adult reference must remain unaffected');
const loadedAgain = start();
assert.equal(loadedAgain.family.phaseScales.basket.body, .36, 'same-origin game reload must recover the applied age settings');
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
assert.match(pngSource, /headFactor: head \/ body/, 'the runtime head bone must compensate by final head divided by body');
assert.match(familySource, /function phaseScaleFields\(phase\) \{[\s\S]{0,160}childBodyScale: scales\.body, childHeadScale: scales\.head/,
  'live family records must consume the exact phase body/head configuration');
assert.match(familySource, /FamilyBabyLimbs\?\.balanceWalker\?\./, 'the family runtime must consume phase GLB size settings');
assert(html.indexOf('character-age-rig-config.js?v=') > html.indexOf('romance-config.js?v=') &&
  html.indexOf('character-age-rig-config.js?v=') < html.indexOf('romance-family.js?v=') &&
  html.indexOf('character-age-rig-config.js?v=') < html.indexOf('game.js?v='),
  'the game must activate the bridge before family gameplay and its initial world actors');
assert(bootstrap.indexOf('character-age-rig-config.js?v=') < bootstrap.indexOf('character-scale-comparison.js?v='),
  'Animation Author must use the same shared bridge before building its lineup');
assert.match(authorSource, /HobunjiCharacterAgeRigConfig\?\.composePreviewScale/, 'preview composition must reuse shared gameplay age math');
assert.match(authorSource, /HobunjiCharacterAgeRigConfig\?\.applyOnThisDevice/, 'the Apply action must actually activate shared runtime values');
assert.match(authorSource, /HobunjiCharacterAgeRigConfig\?\.restoreRepositoryOnThisDevice/, 'Reset must reach the live config, not just local preview');

console.log('PASS age rig parity: default and applied config, game child records, hand/foot modifiers, same-site reload, malformed data, and preview composition');
