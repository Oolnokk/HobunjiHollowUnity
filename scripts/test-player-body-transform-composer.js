#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const loader = read('docs/js/combat/combat-config-loader.js');
const composer = read('docs/js/player-body-transform-composer.js');
const avatarPreview = read('docs/js/npc-avatar-preview-utils.js');
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
assert.ok(composer.includes('registerPreRenderHook'), 'composer exposes render-boundary attachment hooks');
assert.ok(composer.includes('runPreRenderHooks'), 'composer runs render-boundary hooks independently of body-channel activity');
assert.ok(composer.indexOf('applyPlayerNeckYawLimit(renderDebug);') < composer.indexOf('runPreRenderHooks({ playerMesh, neckJoint, visibleFaceWorldQuaternion, renderDebug }, undo, renderDebug);'), 'pre-render hooks run after the physical face/neck clamp');
assert.ok(composer.indexOf('runPreRenderHooks({ playerMesh, neckJoint, visibleFaceWorldQuaternion, renderDebug }, undo, renderDebug);') < composer.indexOf('const delta = resolveDelta();'), 'pre-render hooks run before shared body deltas so face and attachments inherit later transforms together');
assert.ok(composer.includes('visibleFaceWorldQuaternion = neckJoint ? hierarchyWorldQuaternion(neckJoint) : null'), 'composer publishes the visible face world frame through scale-safe quaternion hierarchy math');
assert.ok(composer.includes('currentOwnedRoots'), 'composer rediscovers current visual roots instead of pinning stale avatar objects');
assert.ok(composer.includes('discoverAvatarBodyRoots'), 'composer recursively discovers nested player PNG visual roots');
assert.ok(composer.includes('isDescendantOf'), 'composer can dedupe nested visual branches before applying a body delta');
assert.ok(composer.includes("mode === 'override'"), 'composer supports physical-state override channels');
assert.ok(composer.includes('hierarchyWorldQuaternion'), 'composer derives facing orientation from quaternion hierarchy only');
assert.ok(composer.includes('target.multiply(chain[i].quaternion)'), 'hierarchy orientation is composed parent-first without matrix decomposition');
assert.doesNotMatch(composer, /\.\s*getWorldQuaternion\s*\(/, 'mirrored matrix scale cannot be interpreted as a body-facing rotation');
assert.ok(composer.includes('const oldRotation = root.rotation.clone()'), 'render restoration preserves the authored Euler representation');
assert.ok(composer.includes('root.rotation.copy(oldRotation)'), 'temporary composition cannot leave equivalent 180-degree X/Z Euler values behind');
assert.doesNotMatch(composer, /root\.quaternion\.copy\(oldQuaternion\)/, 'render restoration cannot rewrite the next frame\'s yaw basis through quaternion decomposition');
assert.doesNotMatch(composer, /preserveSkinnedPortraitFacingSide|preserveFacingSide|THREE\.DoubleSide/, 'composer never overrides normal portrait face culling');
assert.ok(composer.includes("portraitFaceCulling: 'material-frontside'"), 'composer diagnostics state that material backface culling remains authoritative');
assert.ok(composer.includes('forcedPortraitDoubleSide: false'), 'composer diagnostics expose that it never forces two-sided portrait rendering');
assert.ok(composer.includes('lastRenderDebug'), 'composer preserves temporary render state for post-render diagnostics');
assert.ok(composer.includes('baseWorldEulerDeg'), 'composer diagnostics expose the pre-delta quaternion-only orientation');
assert.ok(composer.includes('composedWorldEulerDeg'), 'composer diagnostics expose orientation while the channel delta is applied');

// Fine Hood trim is ordinary authored portrait art. It must not install a
// camera-angle uniform, trimless fallback texture, smooth fade, hard cutoff, or
// any other special facing behavior in the shared avatar renderer.
assert.doesNotMatch(loader, /fine-hood-trim-head-facing\.js/i, 'Fine Hood angle-facing adapter is not bootstrapped');
assert.doesNotMatch(
  avatarPreview,
  /FineHoodTrimHeadOn|fineHoodTrimHeadOn|hobunjiFineHoodTrim|finehood-trim-head-on/i,
  'shared avatar preview contains no Fine Hood angle-gating state'
);
assert.doesNotMatch(
  avatarPreview,
  /hobunjiFineHoodTrimlessMap|renderFineHoodHeadOnPair|fineHoodTrimHeadOnThresholds/i,
  'shared avatar preview contains no trimless Fine Hood render/shader path'
);
assert.match(
  avatarPreview,
  /await window\.renderPortraitProfile\(canvas, profile, renderOptions\);\s*return true;/,
  'shared avatar preview renders the authored portrait directly'
);

assert.ok(attachments.includes("registerExternalRootProvider('equippedTool'"), 'tool visuals register in the attachment adapter');
assert.ok(attachments.includes("registerExternalRootProvider('shoulderPets'"), 'shoulder pets register in the attachment adapter');
assert.ok(attachments.includes("registerPreRenderHook?.('shoulderPetFaceLimit'"), 'shoulder-pet face limiting runs through the unconditional render-boundary hook');
assert.ok(attachments.includes('applyShoulderPetFaceRotationLimit'), 'shoulder-pet adapter applies the visible-face world-rotation limiter');
assert.ok(attachments.includes("attachment.requestedRotationSource !== 'head'"), 'face limiter is scoped to Head / Neck follow mode only');
assert.ok(attachments.includes('renderContext?.visibleFaceWorldQuaternion?.clone?.()'), 'limiter consumes the already-clamped visible face world frame supplied by the composer');
assert.ok(attachments.includes('sampledFrameWorldQuaternion.clone().invert().multiply(sampledFinalWorldQuaternion)'), 'limiter preserves the existing authored perch/grip rotation offset');
assert.ok(attachments.includes('authoredPerchWorldPosition.clone().sub(limitedGripWorldOffset)'), 'limiter re-solves root position around the authored shoulder grip instead of detaching the pet');
assert.ok(attachments.includes('const oldRotation = root.rotation.clone()'), 'face limiting preserves the pre-render shoulder-pet rotation for restoration');
assert.ok(attachments.includes('root.rotation.copy(oldRotation)'), 'face limiting restores the pet after render instead of leaking visual state into gameplay');
assert.ok(attachments.includes('renderFaceRotationLimit'), 'mobile diagnostics expose the latest shoulder-pet face-limit result');
assert.doesNotMatch(attachments, /currentPlayerNeckJoint|cachedPlayerNeckJoint/, 'attachment adapter does not independently rediscover or reinterpret the player neck frame');
assert.doesNotMatch(attachments, /drunkenFooting|drunkenHealth/, 'body attachment inheritance is independent of alcohol state');

assert.ok(impact.includes("BODY_CHANNEL = 'ragdoll'"), 'impact publishes a ragdoll body channel');
assert.ok(impact.includes('PlayerBodyTransformComposer?.setChannel'), 'impact uses the composer');
assert.ok(impact.includes('PlayerBodyTransformComposer?.clearChannel'), 'impact clears ownership instead of zeroing shared rotation');
assert.doesNotMatch(impact, /playerMeshRef\s*\.\s*rotation/, 'impact never writes playerMesh rotation');
assert.doesNotMatch(impact, /playerMeshRef\s*\.\s*position/, 'impact never writes playerMesh position');

assert.ok(drunk.includes("BODY_CHANNEL = 'drunk'"), 'drunk gait publishes a drunk body channel');
assert.ok(drunk.includes('const footing = Math.max(0, Number(player.footing) || 0);'), 'drunk gait derives sway from current Footing loss');
assert.ok(drunk.includes('removeTrackedFootTwist'), 'drunk gait removes its previous foot delta before the base solver runs');
assert.ok(drunk.includes('applyTrackedFootTwist'), 'drunk gait composes one tracked foot delta onto the resolved base pose');
assert.ok(drunk.includes('FOOT_TWIST_LIMIT'), 'drunk foot twist has a hard shortest-arc bound below 180 degrees');
assert.doesNotMatch(drunk, /foot\.rotation\.[yz]\s*\+=/, 'drunk foot yaw/roll cannot accumulate frame over frame');
assert.doesNotMatch(drunk, /__drunkBaseRotation/, 'drunk feet do not cache and restore stale base rotations');
assert.doesNotMatch(drunk, /yaw:\s*state\.yaw/, 'drunk body channel never competes with the player facing yaw');
assert.doesNotMatch(drunk, /DRUNK_MAX_YAW_DEG|yawTarget/, 'drunk gait does not synthesize a second whole-body yaw target');
assert.ok(drunk.includes('bodyYawOwnedByFacing: true'), 'debug output exposes that facing exclusively owns body yaw');
assert.doesNotMatch(drunk, /preserveFacingSide/, 'drunk tilt does not request a culling override');

assert.doesNotMatch(alcohol, /registerExternalRootProvider/, 'alcohol integration does not own body attachments');
assert.doesNotMatch(alcohol, /WebGLRenderer\.prototype/, 'alcohol integration no longer owns renderer transforms');
assert.doesNotMatch(alcohol, /__hobunjiDrunkBridgeDevDeps/, 'alcohol integration keeps its dependency adapter private');

console.log('Player body transform composer ownership checks passed.');
