'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/character-rig-scale.js', 'utf8');
const hands = { attach(_THREE, parent) { return { parent }; } };
const profile = { anatomy: { rigScale: 0.8 } };
const windowObject = {
  ProceduralHandAttachments: hands,
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: { 'mao-ao::male': profile } },
  location: { pathname: '/game/' },
  setInterval(fn) { fn(); return 1; },
  clearInterval() {},
};
windowObject.window = windowObject;
const context = vm.createContext(windowObject);
vm.runInContext(source, context, { filename: 'character-rig-scale.js' });

const api = context.HobunjiCharacterRigScale;
assert(api, 'whole-rig scale API must install');
assert.strictEqual(api.scaleFor('mao-ao', 'male'), 0.8);

const parent = {
  isObject3D: true,
  scale: {
    x: 1, y: 1, z: 1,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; },
  },
  userData: {},
  updateMatrix() {},
  updateMatrixWorld() {},
};
api.applyToParent(parent, 'mao-ao', 'male');
assert.deepStrictEqual([parent.scale.x, parent.scale.y, parent.scale.z], [0.8, 0.8, 0.8]);

// Changing the value must preserve the unscaled local assembly rather than
// multiplying the previous result cumulatively.
profile.anatomy.rigScale = 0.5;
api.applyToParent(parent, 'mao-ao', 'male');
assert.deepStrictEqual([parent.scale.x, parent.scale.y, parent.scale.z], [0.5, 0.5, 0.5]);

// If another system recomputes the parent scale (body-scale preview), treat that
// as the new assembled base and reapply whole-rig scale exactly once.
parent.scale.set(1.2, 1.2, 1.2);
api.applyToParent(parent, 'mao-ao', 'male');
assert.deepStrictEqual([parent.scale.x, parent.scale.y, parent.scale.z], [0.6, 0.6, 0.6]);

assert.match(source, /coordinateSpace: 'character-floor-parent'/);
assert.match(source, /Whole rig scale \(%\)/);
assert.match(source, /profile\.anatomy\.rigScale/);
assert.match(source, /runtime: true/);
assert.doesNotMatch(source, /anchor\.position\s*=|anchors\[[^\]]+\]\.position\s*=/,
  'whole-rig scale must not rewrite individual anchor positions');

// Full Character Scale is outside Animation Author's private IIFE. It must use
// the supported public editor API / backdrop scene instead of pretending those
// private bindings are globally reachable and then recursively wrapping itself.
const scaleHostSource = fs.readFileSync('docs/js/character-scale-comparison-host-bridge.js', 'utf8');
const scaleComparisonSource = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8');
const scaleBootstrapSource = fs.readFileSync('docs/js/attachment-rig-latest-authored-snapshot.js', 'utf8');
assert.match(scaleHostSource, /HobunjiAnimationAuthorScaleHost/,
  'Full Character Scale must expose a dedicated host API');
assert.match(scaleHostSource, /publicApi\(\)/,
  'Full Character Scale host must route editor operations through the public Animation Author API');
assert.match(scaleHostSource, /HobunjiGameplayBackdrop/,
  'Full Character Scale host must use the public backdrop scene/camera');
for (const globalName of [
  'setAnimationAuthorMode',
  'addNpcAnimationActor',
  'selectedAnimationActor',
  'attachmentRigProfileForActor',
  'clearAnimationActors',
  'selectAnimationActor',
  'serializeAttachmentRigLibrary',
  'frameAllAnimationActors',
  'strictNpcAppearanceV1514',
]) {
  assert.doesNotMatch(scaleHostSource, new RegExp(`window\\.${globalName}\\s*=`),
    `Full Character Scale host must not directly overwrite window.${globalName}`);
}
assert.match(scaleHostSource, /privateEditorStateRequired: false/,
  'mobile diagnostics must confirm the scale host has no private-IIFE dependency');

// rigScale is authored outside the editor IIFE, while V15.30's private anatomy
// normalizer reconstructs a fixed field set. The host therefore owns round-trip
// persistence and injects only rigScale into the native v10 JSON download.
assert.match(scaleHostSource, /hobunjiFullCharacterRigScales\.v1/,
  'whole-character scales need an independent reload-safe persistence key');
assert.match(scaleHostSource, /getAttachmentRigProfiles/,
  'rig export must start from the editor public rig-profile snapshot, preserving native rig fields');
assert.match(scaleHostSource, /profile\.anatomy\.rigScale = value/,
  'shared species profiles must receive restored/imported rigScale values');
assert.match(scaleHostSource, /profile\.anatomy\.rigScale = scale/,
  'serialized character profiles must contain rigScale');
assert.match(scaleHostSource, /RigScaleAwareBlob/,
  'native attachment-rig downloads must be patched without replacing their metadata payload');
assert.match(scaleHostSource, /maaImportInput/,
  'native Rig imports must recover rigScale from the selected JSON');
assert.match(scaleHostSource, /fullCharacterScaleRoundTripVersion = 1/,
  'patched v10 exports must identify the rigScale round-trip extension');
assert.match(scaleBootstrapSource, /character-scale-comparison-host-bridge\.js\?v=20260904g/,
  'bootstrap must cache-bust the rigScale round-trip host');

// The lineup itself must never become Animation Author actors. It should use the
// exact public preview contracts already proven by Rig Coordinates reference NPCs:
// proceduralHandParent for normal free hands and ProceduralLegAnimation for feet.
assert.match(scaleComparisonSource, /FullCharacterScalePreviewRoot/,
  'Full Character Scale must own a preview-only scene root');
assert.match(scaleComparisonSource, /model\.userData\.proceduralHandParent = group/,
  'comparison avatars must use the normal free-hand parent contract');
assert.match(scaleComparisonSource, /ProceduralLegAnimation\?\.attach\?/,
  'comparison avatars must attach the gameplay procedural feet runtime');
assert.match(scaleComparisonSource, /raycaster\.intersectObject\(entry\.group, true\)/,
  'selection must raycast each preview group directly');
assert.match(scaleComparisonSource, /select\(best\.entry\)/,
  'a tapped preview must directly update the comparison selection');
assert.doesNotMatch(scaleComparisonSource, /addNpcAnimationActor/,
  'comparison lineup must not create Animation Author actors');
assert.doesNotMatch(scaleComparisonSource, /selectedAnimationActor/,
  'comparison slider selection must not depend on Animation Author selection state');
assert.doesNotMatch(scaleBootstrapSource, /character-scale-comparison-camera\.js/,
  'obsolete private-state camera/picking wrapper must not load with the isolated comparison');
assert.match(scaleBootstrapSource, /character-scale-comparison\.js\?v=20260904d/,
  'bootstrap must cache-bust the isolated Full Character Scale comparison');

console.log('Ground-relative whole character rig scale guards passed');
