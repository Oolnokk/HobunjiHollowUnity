'use strict';
const assert = require('node:assert/strict'); // Verifies integration-level invariants across portrait skinning, age authoring and leg handle indexing.
const fs = require('node:fs'); // Reads the actual shipped modules instead of shadow runtime implementations.
const vm = require('node:vm'); // Executes the production leg registry functions with lightweight Object3D substitutes.

const png = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'); // Ensures the newer portrait bake survives the short-neck merge.
const legs = fs.readFileSync('docs/js/procedural-leg-animation.js', 'utf8'); // Exercises fast parent-indexed scale notifications.
const author = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // Validates adult/child lineup and independent authored leg length.
const startup = fs.readFileSync('docs/js/attachment-rig-latest-authored-snapshot.js', 'utf8'); // Confirms family defaults precede the age authoring workspace.
const game = fs.readFileSync('docs/index.html', 'utf8'); // Confirms main gameplay still initializes family age config.

assert.match(png, /const frozenPortraits = new WeakMap\(\)/, 'preserve main frozen portrait render cache');
assert.match(png, /function bakePortrait\(/, 'preserve posed portrait baking');
assert.match(png, /freeze: fallbackDimensions\.freezePortrait === true/, 'hostile frozen portrait registration survives ten-bone merge');
assert.match(png, /headOffsetJoint\.add\(neckJoint\)/, 'head rotation inherits nonrotating placement');
assert.match(png, /new THREE\.Skeleton\(\[\.\.\.splineNodes, headOffsetJoint, neckJoint, headScaleJoint\]\)/, 'gameplay character uses the ten-bone neck hierarchy');
assert.match(author, /function applyPreviewProportions\(/, 'global age proportions recompose character previews');
assert.match(author, /composed\.legLength = /, 'age composition preserves independent authored legs');
assert.match(author, /attachPreviewPants\(entry, avatar\.front\)/, 'full-body author retains gameplay pants');
assert.match(author, /spineGuide\?\.sync\(showSpineGuides/, 'live spine guide still follows authored hunch');
assert.doesNotMatch(author, /function pickAt\(/, 'viewport click selection remains disabled');
assert.match(author, /visibility:visible!important/, 'mobile selector panel stays open');
assert.ok(startup.indexOf("romance-config.js") < startup.indexOf("character-scale-comparison.js"), 'editor loads family defaults before age author');
assert.ok(game.indexOf('romance-config.js') < game.indexOf('character-age-rig-config.js'), 'game initializes family settings before custom age scales');
assert.doesNotMatch(legs, /for \(const handle of activeLegHandles\)/, 'scale edits never walk every NPC leg handle');

const registryStart = legs.indexOf('  const legHandlesByScaleParent = new WeakMap()');
const alignStart = legs.indexOf('  function alignPortraitWithLegs(', registryStart);
const syncStart = legs.indexOf('  function syncScaleForParent(', alignStart);
const syncEnd = legs.indexOf('\n  // Attaches a procedural feet pair', syncStart);
assert.ok(registryStart >= 0 && alignStart > registryStart && syncStart > alignStart && syncEnd > syncStart,
  'production fast leg index functions are present in expected order');
const registry = legs.slice(registryStart, alignStart); // Actual helper implementations, including register and dispose logic.
const notification = legs.slice(syncStart, syncEnd); // Production parent-selective notification logic.
const context = vm.createContext({ WeakMap, Set }); // A pure mock world, no WebGL or developer console necessary.
vm.runInContext(registry + '\nfunction alignPortraitWithLegs(parent, handle) { handle.aligned.push(parent.name); }\n'
  + notification + '\nthis.api = { registerScaleHandle, unregisterScaleHandle, syncScaleForParent, legHandlesByScaleParent };', context);
const api = context.api;
const root = { name: 'town' }; // One common ancestor of a populated town scene.
const a = { name: 'one-parent', parent: root }; // The only NPC whose size changes first.
const b = { name: 'other-parent', parent: root }; // Unrelated NPC must never be scanned or modified.
function handle(parent) {
  return {
    group: { parent }, aligned: [], scales: [],
    setLegLengthMultiplier(value) { this.scales.push(value); },
  };
}
const h1 = handle(a), h2 = handle(b);
api.registerScaleHandle(h1);
api.registerScaleHandle(h2);
assert.equal(api.legHandlesByScaleParent.get(a).size, 1, 'one matching handle by its direct floor parent');
assert.equal(api.legHandlesByScaleParent.get(root).size, 2, 'shared ancestor supports world-owner scaling');
api.syncScaleForParent(a, 1.4);
assert.deepEqual(h1.scales, [1.4], 'matching character updates once');
assert.deepEqual(h2.scales, [], 'unrelated NPC is skipped entirely');
assert.deepEqual(h1.aligned, ['one-parent'], 're-anchor uses exactly the requested scale parent');
api.syncScaleForParent(root, .75);
assert.deepEqual(h1.scales, [1.4, .75], 'ancestor scale reaches descendant handle');
assert.deepEqual(h2.scales, [.75], 'ancestor scale reaches both registered handles');
api.unregisterScaleHandle(h1);
api.syncScaleForParent(root, 1.3);
assert.deepEqual(h1.scales, [1.4, .75], 'disposed legs cannot receive scale updates');
assert.deepEqual(h2.scales, [.75, 1.3], 'remaining NPC still receives notifications');
assert.equal(api.legHandlesByScaleParent.get(a), undefined, 'orphaned child index is discarded');
api.unregisterScaleHandle(h2);
assert.equal(api.legHandlesByScaleParent.get(root), undefined, 'the final ancestor index is discarded');
console.log('Short neck + age lineup + frozen portrait compatibility and O(affected legs) scale index PASS');
