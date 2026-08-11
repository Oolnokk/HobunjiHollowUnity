#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const loader = read('docs/js/combat/combat-config-loader.js');
const composer = read('docs/js/player-body-transform-composer.js');
const attachments = read('docs/js/player-body-attachment-bridge.js');
const impact = read('docs/js/combat/impact-ragdoll-playback.js');
const drunk = read('docs/js/drunk-locomotion.js');
const alcohol = read('docs/js/alcohol-gameplay-bridge.js');

for (const modulePath of [
  'js/player-body-transform-composer.js',
  'js/player-body-attachment-bridge.js',
  'js/drunk-locomotion.js',
  'js/alcohol-gameplay-bridge.js',
]) {
  assert.ok(loader.includes(modulePath), `${modulePath} is bootstrapped before game.js`);
}

// three.js r128 assigns render() directly to each renderer instance. A
// prototype-only composer hook is therefore invisible unless the compatibility
// bootstrap captures that own method and removes the shadow before game.js
// constructs its renderer.
assert.ok(loader.includes('makeRendererPrototypeHookable'), 'bootstrap adapts r128 renderer instances for the composer hook');
assert.ok(loader.includes('__hobunjiBaseRendererRender'), 'bootstrap preserves the real instance render implementation');
assert.ok(loader.includes('delete instance.render'), 'renderer instances no longer shadow the composer prototype hook');
assert.ok(
  loader.indexOf('makeRendererPrototypeHookable();') < loader.indexOf("'js/player-body-transform-composer.js"),
  'renderer compatibility is installed before player-body-transform-composer executes'
);

assert.ok(composer.includes('setChannel'), 'composer exposes named transform channels');
assert.ok(composer.includes('registerExternalRootProvider'), 'composer exposes body-bound attachment providers');
assert.ok(composer.includes('currentOwnedRoots'), 'composer rediscovers current visual roots instead of pinning stale avatar objects');
assert.ok(composer.includes('discoverAvatarBodyRoots'), 'composer recursively discovers nested player PNG visual roots');
assert.ok(composer.includes('isDescendantOf'), 'composer can dedupe nested visual branches before applying a body delta');
assert.ok(composer.includes("mode === 'override'"), 'composer supports physical-state override channels');
assert.ok(composer.includes('hierarchyWorldQuaternion'), 'composer derives facing orientation from quaternion hierarchy only');
assert.ok(composer.includes('target.multiply(chain[i].quaternion)'), 'hierarchy orientation is composed parent-first without matrix decomposition');
assert.doesNotMatch(composer, /\.\s*getWorldQuaternion\s*\(/, 'mirrored matrix scale cannot be interpreted as a body-facing rotation');
assert.ok(composer.includes('preserveSkinnedPortraitFacingSide'), 'composer can preserve the pre-delta front/back portrait choice');
assert.ok(composer.includes('selectedMaterial.side = THREE.DoubleSide'), 'selected portrait remains renderable through additive tilt');
assert.ok(composer.includes('frontMaterial.visible = showFront'), 'mirrored rear portrait cannot render over the selected front side');
assert.ok(composer.includes('lastRenderDebug'), 'composer preserves temporary render state for post-render diagnostics');
assert.ok(composer.includes('portraitSelections'), 'composer diagnostics expose the selected portrait side and boundary dot');
assert.ok(composer.includes('quaternionFacingDot'), 'composer diagnostics compare matrix and scale-free quaternion facing bases');
assert.ok(composer.includes('worldMatrixDeterminant'), 'composer diagnostics expose mirrored world matrices');
assert.ok(composer.includes('basisDisagrees'), 'composer diagnostics identify reflected-basis side disagreement directly');
assert.ok(composer.includes('baseWorldEulerDeg'), 'composer diagnostics expose the pre-delta quaternion-only orientation');
assert.ok(composer.includes('composedWorldEulerDeg'), 'composer diagnostics expose orientation while the channel delta is applied');

assert.ok(attachments.includes("registerExternalRootProvider('equippedTool'"), 'tool visuals register in the attachment adapter');
assert.ok(attachments.includes("registerExternalRootProvider('shoulderPets'"), 'shoulder pets register in the attachment adapter');
assert.doesNotMatch(attachments, /drunkenFooting|drunkenHealth/, 'body attachment inheritance is independent of alcohol state');

assert.ok(impact.includes("BODY_CHANNEL = 'ragdoll'"), 'impact publishes a ragdoll body channel');
assert.ok(impact.includes('PlayerBodyTransformComposer?.setChannel'), 'impact uses the composer');
assert.ok(impact.includes('PlayerBodyTransformComposer?.clearChannel'), 'impact clears ownership instead of zeroing shared rotation');
assert.doesNotMatch(impact, /playerMeshRef\s*\.\s*rotation/, 'impact never writes playerMesh rotation');
assert.doesNotMatch(impact, /playerMeshRef\s*\.\s*position/, 'impact never writes playerMesh position');

assert.ok(drunk.includes("BODY_CHANNEL = 'drunk'"), 'drunk gait publishes a drunk body channel');
assert.ok(drunk.includes("DRUNK_FOOTING_ID = 'drunkenFooting'"), 'drunk gait keys off the alcohol affliction, not generic Footing loss');
assert.ok(drunk.includes('removeTrackedFootTwist'), 'drunk gait removes its previous foot delta before the base solver runs');
assert.ok(drunk.includes('applyTrackedFootTwist'), 'drunk gait composes one tracked foot delta onto the resolved base pose');
assert.ok(drunk.includes('FOOT_TWIST_LIMIT'), 'drunk foot twist has a hard shortest-arc bound below 180 degrees');
assert.doesNotMatch(drunk, /foot\.rotation\.[yz]\s*\+=/, 'drunk foot yaw/roll cannot accumulate frame over frame');
assert.doesNotMatch(drunk, /__drunkBaseRotation/, 'drunk feet do not cache and restore stale base rotations');
assert.doesNotMatch(drunk, /yaw:\s*state\.yaw/, 'drunk body channel never competes with the player facing yaw');
assert.doesNotMatch(drunk, /DRUNK_MAX_YAW_DEG|yawTarget/, 'drunk gait does not synthesize a second whole-body yaw target');
assert.ok(drunk.includes('bodyYawOwnedByFacing: true'), 'debug output exposes that facing exclusively owns body yaw');
assert.ok(drunk.includes('preserveFacingSide: true'), 'drunk tilt preserves the front/back side selected by ordinary facing');

assert.doesNotMatch(alcohol, /registerExternalRootProvider/, 'alcohol integration does not own body attachments');
assert.doesNotMatch(alcohol, /WebGLRenderer\.prototype/, 'alcohol integration no longer owns renderer transforms');
assert.doesNotMatch(alcohol, /__hobunjiDrunkBridgeDevDeps/, 'alcohol integration keeps its dependency adapter private');

console.log('Player body transform composer ownership checks passed.');
