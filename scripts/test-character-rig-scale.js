'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const defaultsSource = fs.readFileSync('docs/config/character-rig-scale-defaults.js', 'utf8');
const source = fs.readFileSync('docs/js/character-rig-scale.js', 'utf8');
const hands = { attach(_THREE, parent) { return { parent }; } };
const profile = { species: 'mao-ao', gender: 'male', anatomy: {} };
const windowObject = {
  ProceduralHandAttachments: hands,
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: { 'mao-ao::male': profile } },
  HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS: {},
  location: { pathname: '/game/' },
  setInterval(fn) { fn(); return 1; },
  clearInterval() {},
};
windowObject.window = windowObject;
const context = vm.createContext(windowObject);
vm.runInContext(defaultsSource, context, { filename: 'character-rig-scale-defaults.js' });
vm.runInContext(source, context, { filename: 'character-rig-scale.js' });

// Objects returned across the vm context boundary have a different
// Object.prototype than object literals in this file, which trips
// assert.deepStrictEqual's prototype check even when every field matches.
// Rebuild a plain object in the current realm before comparing.
const plain = v => ({ x: v.x, y: v.y, head: v.head, offsetY: v.offsetY });

// Hand-authored via Full Character Scale itself (an exported
// hobunji_full_character_scales.json), each axis genuinely independent now —
// no longer x === y === head per species/gender.
const authoredDefaults = {
  'tletingan::male': { x: 0.85, y: 0.85, head: 0.85, offsetY: 0 },
  'tletingan::female': { x: 1.01, y: 0.89, head: 0.92, offsetY: 0 },
  'engh-sho::male': { x: 0.8, y: 0.845, head: 0.94, offsetY: 0 },
  'engh-sho::female': { x: 0.795, y: 0.765, head: 0.86, offsetY: 0 },
  'mao-ao::male': { x: 1.125, y: 1.125, head: 1.085, offsetY: 0 },
  'mao-ao::female': { x: 1.045, y: 1.045, head: 1.045, offsetY: 0 },
  'kenkari::male': { x: 1.225, y: 1.225, head: 1.085, offsetY: 0 },
  'kenkari::female': { x: 1.1, y: 1.1, head: 1.1, offsetY: 0 },
  'mashtzarr::male': { x: 0.95, y: 1.255, head: 1.01, offsetY: -0.065 },
  'mashtzarr::female': { x: 1.01, y: 1.095, head: 0.91, offsetY: -0.06 },
};
for (const [key, expected] of Object.entries(authoredDefaults)) {
  const [species, gender] = key.split('::');
  assert.deepStrictEqual(plain(context.HobunjiCharacterRigScaleDefaults.scaleFor(species, gender)), expected,
    `${key} must use the hand-authored Full Character Scale default`);
  assert.strictEqual(context.HobunjiCharacterRigScaleDefaults.uniformScaleFor(species, gender), expected.x,
    `${key} uniform back-compat accessor must still expose x`);
}
assert.deepStrictEqual(plain(context.HobunjiCharacterRigScaleDefaults.scaleFor('ghoul', 'male')), authoredDefaults['mao-ao::male'],
  'Ghoul must inherit Mao-ao male transform scale');
assert.deepStrictEqual(plain(context.HobunjiCharacterRigScaleDefaults.scaleFor('rakakoan', 'female')), authoredDefaults['kenkari::female'],
  'Rakakoan must inherit Kenkari female transform scale');

const api = context.HobunjiCharacterRigScale;
assert(api, 'whole-rig scale API must install');
assert.strictEqual(profile.anatomy.rigScaleX, 1.125, 'live shared rig profiles must receive the authored x default when no override exists');
assert.strictEqual(profile.anatomy.rigScaleY, 1.125, 'live shared rig profiles must receive the authored y default when no override exists');
assert.strictEqual(profile.anatomy.headScale, 1.085, 'live shared rig profiles must receive the authored head default when no override exists');
assert.strictEqual(profile.anatomy.headOffsetY, 0, 'live shared rig profiles must receive the authored offsetY default when no override exists');
assert.deepStrictEqual(plain(api.scaleFor('mao-ao', 'male')), authoredDefaults['mao-ao::male']);

function makeBone() {
  return {
    scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    position: { x: 0, y: 0.4, z: 0 }, // Nonzero baseline Y, matching a real authored neck pivot — proves offset composes with the baseline instead of overwriting it.
    userData: {},
    updateMatrix() {},
  };
}
function makeParent(neckJoint = null, modelHeight = null) {
  return {
    isObject3D: true,
    scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    userData: neckJoint ? { neckRig: { available: true, neckJoint }, portraitModelHeight: modelHeight } : {},
    children: [],
    updateMatrix() {},
    updateMatrixWorld() {},
    traverse(visit) { visit(this); },
  };
}

const parent = makeParent();
api.applyToParent(parent, 'mao-ao', 'male');
assert.deepStrictEqual([parent.scale.x, parent.scale.y, parent.scale.z], [1.125, 1.125, 1.125]);

// Changing an explicit authored/imported legacy value must override the default without
// multiplying the previous result cumulatively, and still resolves uniformly on every axis.
profile.anatomy.rigScaleX = undefined;
profile.anatomy.rigScaleY = undefined;
profile.anatomy.headScale = undefined;
profile.anatomy.rigScale = 0.5;
api.applyToParent(parent, 'mao-ao', 'male');
assert.deepStrictEqual([parent.scale.x, parent.scale.y, parent.scale.z], [0.5, 0.5, 0.5]);

// If another system recomputes the parent scale (body-scale preview), treat that
// as the new assembled base and reapply whole-rig scale exactly once.
parent.scale.set(1.2, 1.2, 1.2);
api.applyToParent(parent, 'mao-ao', 'male');
assert.deepStrictEqual([parent.scale.x, parent.scale.y, parent.scale.z], [0.6, 0.6, 0.6]);

// Body width and height must be independently settable — z (depth) tracks x, since these
// are camera-facing planes with no independently authored depth.
const nonUniformParent = makeParent();
api.applyToParent(nonUniformParent, 'mao-ao', 'male', { x: 1.3, y: 0.9, head: 1 });
assert.deepStrictEqual([nonUniformParent.scale.x, nonUniformParent.scale.y, nonUniformParent.scale.z], [1.3, 0.9, 1.3]);
// Reapplying with a different y-only change must not cumulatively multiply x.
api.applyToParent(nonUniformParent, 'mao-ao', 'male', { x: 1.3, y: 1.5, head: 1 });
assert.deepStrictEqual([nonUniformParent.scale.x, nonUniformParent.scale.y, nonUniformParent.scale.z], [1.3, 1.5, 1.3]);

// Head must be compensated at the neck rig bone so a distorted body aspect ratio never
// distorts the meticulously authored head/head-cosmetic/expression proportions: the neck
// bone's own local scale, composed with the inherited non-uniform body scale, must land
// on exactly the authored head factor.
const neckJoint = makeBone();
const headParent = makeParent(neckJoint);
api.applyToParent(headParent, 'mao-ao', 'male', { x: 1.3, y: 0.7, head: 1.1 });
assert.strictEqual(headParent.scale.x, 1.3);
assert.strictEqual(headParent.scale.y, 0.7);
assert.ok(Math.abs(neckJoint.scale.x - (1.1 / 1.3)) < 1e-9, 'neck bone must cancel body width stretch and land on the authored head scale');
assert.ok(Math.abs(neckJoint.scale.y - (1.1 / 0.7)) < 1e-9, 'neck bone must cancel body height stretch and land on the authored head scale');
assert.strictEqual(neckJoint.scale.z, 1);
// An avatar with no neck rig (most world creatures/NPCs) must be entirely unaffected.
assert.strictEqual(api.applyHeadCompensation(makeParent(), 'mao-ao', 'male', { x: 1.3, y: 0.7, head: 1.1 }), false,
  'avatars without a neck rig have no head to protect and must be a safe no-op');

// Animation Author's own Full Character Scale editor builds its neck rig through a
// separate two-sided-plane implementation that never sets an `available` flag at all
// (unlike the shared png-plane-avatar.js shape used by the real game) — regression
// guard for a bug where the editor's own preview silently never found its neck bone
// and so never protected head proportions, exactly the "at least in the scale editor"
// symptom this was authored to fix.
const toolNeckJoint = makeBone();
const toolStyleParent = {
  isObject3D: true,
  scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
  userData: { neckRig: { torsoBone: {}, neckJoint: toolNeckJoint, eyeMarker: {}, detected: {} } }, // No `available` field — matches the Animation Author tool's own rig object shape.
  children: [],
  updateMatrix() {},
  updateMatrixWorld() {},
  traverse(visit) { visit(this); },
};
api.applyToParent(toolStyleParent, 'mao-ao', 'male', { x: 1.3, y: 0.7, head: 1.1 });
assert.ok(Math.abs(toolNeckJoint.scale.x - (1.1 / 1.3)) < 1e-9,
  'the editor-shaped neck rig (no `available` flag) must still be found and compensated');
assert.ok(Math.abs(toolNeckJoint.scale.y - (1.1 / 0.7)) < 1e-9,
  'the editor-shaped neck rig (no `available` flag) must still be found and compensated');

// When a headScaleJoint exists (the shared png-plane-avatar.js rig — only vertices
// actually classified as head pixels are weighted to it), it must be preferred over
// neckJoint for scale/offset, and neckJoint itself must be left completely alone —
// otherwise head-turn rotation's broad shoulder-follow blend would get dragged by
// scale/offset too, exactly the "affects parts of torso and overwear clothing near
// the head" bug this bone split exists to fix.
const splitNeckJoint = makeBone();
const splitHeadScaleJoint = makeBone();
const splitParent = {
  isObject3D: true,
  scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
  userData: { neckRig: { available: true, neckJoint: splitNeckJoint, headScaleJoint: splitHeadScaleJoint } },
  children: [],
  updateMatrix() {},
  updateMatrixWorld() {},
  traverse(visit) { visit(this); },
};
const splitBaselineY = splitNeckJoint.position.y;
api.applyToParent(splitParent, 'mao-ao', 'male', { x: 1.3, y: 0.7, head: 1.1, offsetY: 0.2 });
assert.deepStrictEqual([splitNeckJoint.scale.x, splitNeckJoint.scale.y, splitNeckJoint.scale.z], [1, 1, 1],
  'neckJoint (head-turn rotation) must be untouched by scale when a headScaleJoint exists');
assert.strictEqual(splitNeckJoint.position.y, splitBaselineY,
  'neckJoint (head-turn rotation) must be untouched by Y offset when a headScaleJoint exists');
assert.ok(Math.abs(splitHeadScaleJoint.scale.x - (1.1 / 1.3)) < 1e-9,
  'headScaleJoint must receive the head-scale compensation instead');
assert.ok(Math.abs(splitHeadScaleJoint.scale.y - (1.1 / 0.7)) < 1e-9,
  'headScaleJoint must receive the head-scale compensation instead');
api.clearFromParent(splitParent);
assert.deepStrictEqual([splitHeadScaleJoint.scale.x, splitHeadScaleJoint.scale.y, splitHeadScaleJoint.scale.z], [1, 1, 1],
  'clearFromParent must reset headScaleJoint, not (only) neckJoint, when a headScaleJoint exists');

// Head Y offset is authored per species/gender as a fraction of the avatar's own
// model height, and composes additively with a separate per-NPC age-hunch factor —
// neither one is baked into shared profile data, both are supplied by the caller.
const offsetNeckJoint = makeBone();
const offsetParent = makeParent(offsetNeckJoint, 2); // modelHeight = 2, so a 0.1 fraction is a 0.2 world-unit move.
const baselineY = offsetNeckJoint.position.y;
api.applyToParent(offsetParent, 'mao-ao', 'male', { x: 1, y: 1, head: 1, offsetY: 0.1 });
assert.ok(Math.abs(offsetNeckJoint.position.y - (baselineY + 0.2)) < 1e-9,
  'headOffsetY must move the neck bone by that fraction of the avatar\'s own model height');
// Reapplying with age must ADD the age-hunch amount on top of the same authored
// offset, and must never drift from the original baseline on repeated calls.
api.applyToParent(offsetParent, 'mao-ao', 'male', { x: 1, y: 1, head: 1, offsetY: 0.1 }, 1);
const expectedWithAge = baselineY + (0.1 + api.ageHunchFraction(1)) * 2;
assert.ok(Math.abs(offsetNeckJoint.position.y - expectedWithAge) < 1e-9,
  'a fully-aged (age=1) NPC must compose the max age-hunch fraction on top of the authored offset');
assert.ok(api.ageHunchFraction(1) < 0, 'age must only ever lower the head, never raise it');
assert.strictEqual(api.ageHunchFraction(0), 0, 'age 0 must add no hunch at all');
// Reapplying with age back at 0 must return to exactly the authored offset — no leftover drift.
api.applyToParent(offsetParent, 'mao-ao', 'male', { x: 1, y: 1, head: 1, offsetY: 0.1 }, 0);
assert.ok(Math.abs(offsetNeckJoint.position.y - (baselineY + 0.2)) < 1e-9,
  'clearing age back to 0 must return exactly to the authored offset, not leave residual drift');

// clearFromParent must also reset any head compensation (scale and Y offset) back to identity.
api.clearFromParent(headParent);
assert.deepStrictEqual([neckJoint.scale.x, neckJoint.scale.y, neckJoint.scale.z], [1, 1, 1]);
api.clearFromParent(offsetParent);
assert.ok(Math.abs(offsetNeckJoint.position.y - baselineY) < 1e-9, 'clearFromParent must restore the neck bone\'s original authored Y position');

// The real game hook is the procedural-hand floor parent. Avatar body, hands and
// feet share/inherit this assembled parent, so the runtime must apply the default
// there before the hand rig is attached.
const runtimeParent = {
  isObject3D: true,
  scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
  userData: {},
  children: [],
  updateMatrix() {},
  updateMatrixWorld() {},
  traverse(visit) { visit(this); },
};
hands.attach(null, runtimeParent, { speciesId: 'engh-sho', gender: 'male' });
assert.deepStrictEqual([runtimeParent.scale.x, runtimeParent.scale.y, runtimeParent.scale.z], [0.8, 0.845, 0.8]);
assert.strictEqual(runtimeParent.userData.hobunjiCharacterRigScaleState.coordinateSpace, 'character-floor-parent');

assert.match(source, /coordinateSpace: 'character-floor-parent'/);
assert.match(source, /Body width \(%\)/);
assert.match(source, /Body height \(%\)/);
assert.match(source, /Head scale \(%\)/);
assert.match(source, /Head Y offset \(%\)/);
assert.match(source, /anatomy\.rigScale\b/, 'the legacy pre-split rigScale field must still be read as a fallback');
assert.match(source, /profile\.anatomy\.rigScaleX/);
assert.match(source, /profile\.anatomy\.rigScaleY/);
assert.match(source, /profile\.anatomy\.headScale/);
assert.match(source, /profile\.anatomy\.headOffsetY/);
assert.match(source, /ageHunchFraction/);
assert.match(source, /characterRigScaleRuntimeHook = 'ProceduralHandAttachments\.floor-parent'/,
  'runtime diagnostics must identify the real assembled-character hook');
assert.doesNotMatch(source, /anchor\.position\s*=|anchors\[[^\]]+\]\.position\s*=/,
  'whole-rig scale must not rewrite individual anchor positions');

// Full Character Scale is outside Animation Author's private IIFE. It must use
// the supported public editor API / backdrop scene instead of pretending those
// private bindings are globally reachable and then recursively wrapping itself.
const scaleHostSource = fs.readFileSync('docs/js/character-scale-comparison-host-bridge.js', 'utf8');
const scaleComparisonSource = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8');
const scaleBootstrapSource = fs.readFileSync('docs/js/attachment-rig-latest-authored-snapshot.js', 'utf8');
const heldActionSource = fs.readFileSync('docs/js/held-action-animations.js', 'utf8');
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
// persistence and injects only rigScaleX/rigScaleY/headScale into the native v10 JSON download.
assert.match(scaleHostSource, /hobunjiFullCharacterRigScales\.v2/,
  'whole-character x/y/head scales need an independent reload-safe persistence key');
assert.match(scaleHostSource, /hobunjiFullCharacterRigScales\.v1/,
  'the pre-split single-number storage key must still be read once, to migrate existing tuning forward');
assert.match(scaleHostSource, /getAttachmentRigProfiles/,
  'rig export must start from the editor public rig-profile snapshot, preserving native rig fields');
assert.match(scaleHostSource, /profile\.anatomy\.rigScaleX = value\.x/,
  'shared species profiles must receive restored/imported rigScaleX values');
assert.match(scaleHostSource, /profile\.anatomy\.rigScaleX = scale\.x/,
  'serialized character profiles must contain rigScaleX');
assert.match(scaleHostSource, /profile\.anatomy\.headScale = scale\.head/,
  'serialized character profiles must contain headScale');
assert.match(scaleHostSource, /RigScaleAwareBlob/,
  'native attachment-rig downloads must be patched without replacing their metadata payload');
assert.match(scaleHostSource, /maaImportInput/,
  'native Rig imports must recover rigScale from the selected JSON');
assert.match(scaleHostSource, /fullCharacterScaleRoundTripVersion = 3/,
  'patched v10 exports must identify the x/y/head/offsetY round-trip extension');
assert.match(scaleHostSource, /profile\.anatomy\.headOffsetY = value\.offsetY/,
  'shared species profiles must receive restored/imported headOffsetY values');
assert.match(scaleHostSource, /profile\.anatomy\.headOffsetY = scale\.offsetY/,
  'serialized character profiles must contain headOffsetY');
assert.match(scaleHostSource, /NPC_AGE_STORAGE_KEY/,
  'per-NPC age must have its own dedicated persistence key, separate from the species/gender rigScale round-trip');
assert.match(scaleHostSource, /function setNpcAge/);
assert.match(scaleHostSource, /function npcAgeFor/);
assert.match(scaleHostSource, /resetNpcAges\(\)/,
  'resetting to repo defaults must also clear per-NPC age overrides');

// The ordinary game loads this same bootstrap through held-action-animations,
// so the default config and runtime scale module are not editor-only features.
assert.match(heldActionSource, /attachment-rig-latest-authored-snapshot\.js/,
  'game held-hand bootstrap must load the shared attachment-rig bootstrap');
assert.match(scaleBootstrapSource, /character-rig-scale-defaults\.js\?v=20260904h/,
  'shared bootstrap must load authored full-character defaults');
assert.ok(scaleBootstrapSource.indexOf('character-rig-scale-defaults.js') < scaleBootstrapSource.indexOf('character-rig-scale.js'),
  'defaults must load before the runtime scale module');
assert.match(scaleBootstrapSource, /character-rig-scale\.js\?v=20260904i/,
  'bootstrap must cache-bust the runtime default hook');
assert.match(scaleBootstrapSource, /character-scale-comparison-host-bridge\.js\?v=20260904j/,
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
assert.match(scaleBootstrapSource, /character-scale-comparison\.js\?v=20260904k/,
  'bootstrap must cache-bust the isolated Full Character Scale comparison');
// The five slider rows are rendered through one small scaleRow(axis, ...) template
// helper (id="maaFullScaleRange${axis}"/"maaFullScaleNum${axis}") rather than five
// near-identical literal blocks, so these check the call sites, not the interpolated
// ids — still fails if any of the five controls is dropped or renamed.
for (const axis of ['X', 'Y', 'Head', 'OffsetY', 'Age']) {
  assert.match(scaleComparisonSource, new RegExp(`scaleRow\\('${axis}'`),
    `the comparison tab must expose a ${axis} slider row`);
}
assert.match(scaleComparisonSource, /maaFullScaleNum\$\{axis\}/,
  'each slider must be paired with an editable exact-value entry box, not just a range input');
assert.match(scaleComparisonSource, /host\(\)\?\.setNpcAge\?\./,
  'the age slider must persist through the host, not just mutate local UI state');
assert.match(scaleComparisonSource, /host\(\)\?\.npcAgeFor\?\./,
  'selecting a character must recover its own persisted age, not reset to 0');

// Regression guard: the comparison lineup builds its own preview avatars directly
// (deliberately not through Animation Author actors — see the doesNotMatch guards
// above), which means it must opt into a neck rig itself. Without `neckRig: true`
// and a rendered head-only canvas, buildSinglePlaneAvatarModel never builds a neck
// bone at all, so applyHeadCompensation has nothing to act on and the Head slider
// silently does nothing — the exact bug this test guards against regressing.
assert.match(scaleComparisonSource, /neckRig:\s*true/,
  'comparison avatars must opt into a neck rig or the Head slider has no bone to drive');
assert.match(scaleComparisonSource, /headCanvas:\s*avatar\.head/,
  'comparison avatars must supply a head-only render so the neck rig can locate head pixels');
assert.match(scaleComparisonSource, /onlyHeadSprite:\s*true/,
  'buildPortrait must render a head-only canvas alongside front/back, matching the real game’s neckRig setup');

// "Reset all to repo defaults" must discard every local override — in-memory and both
// persistence keys — not just visually snap the current selection back for one session.
assert.match(scaleHostSource, /function resetToRepositoryDefaults/,
  'the host must own clearing local overrides and re-deriving x/y/head from the authored defaults');
assert.match(scaleHostSource, /rigScaleOverrides\.clear\(\)/,
  'reset must clear the in-memory override map, not just localStorage');
assert.match(scaleHostSource, /localStorage\.removeItem\(RIG_SCALE_STORAGE_KEY\)/,
  'reset must clear the current-format persistence key');
assert.match(scaleHostSource, /localStorage\.removeItem\(LEGACY_SCALE_STORAGE_KEY_V1\)/,
  'reset must also clear the legacy pre-split persistence key, or it would resurrect old values on next load');
assert.match(scaleComparisonSource, /maaFullScaleReset/,
  'the comparison tab must expose a reset-to-repo-defaults control');
assert.match(scaleComparisonSource, /resetToRepositoryDefaults/,
  'the reset button must call through to the host\'s reset, not just clear local UI state');

console.log('Ground-relative whole character rig scale guards passed (independent x/y body scale, neck-rig-compensated head scale)');
