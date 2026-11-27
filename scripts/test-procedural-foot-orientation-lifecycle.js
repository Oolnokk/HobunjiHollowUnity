#!/usr/bin/env node
'use strict';
// Regression: a reflected portrait must not make both feet acquire a 180-degree
// half-turn, and a temporary camera/stance yaw must undo the entire leg pose.
const assert = require('node:assert/strict');
const fs = require('node:fs');

const legsSource = fs.readFileSync('docs/js/procedural-leg-animation.js', 'utf8');
const composerSource = fs.readFileSync('docs/js/player-body-transform-composer.js', 'utf8');

function between(source, from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert(start >= 0 && end > start, 'real runtime helper exists: ' + from);
  return source.slice(start, end);
}
class Q {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  clone() { return new Q(this.x, this.y, this.z, this.w); }
  copy(q) { Object.assign(this, { x: q.x, y: q.y, z: q.z, w: q.w }); return this; }
  identity() { return this.copy(new Q()); }
  multiply(q) {
    const a = this.clone();
    return this.copy(new Q(
      a.x * q.w + a.w * q.x + a.y * q.z - a.z * q.y,
      a.y * q.w + a.w * q.y + a.z * q.x - a.x * q.z,
      a.z * q.w + a.w * q.z + a.x * q.y - a.y * q.x,
      a.w * q.w - a.x * q.x - a.y * q.y - a.z * q.z
    ));
  }
  premultiply(q) { return this.copy(q.clone().multiply(this)); }
  invert() { this.x *= -1; this.y *= -1; this.z *= -1; return this.normalize(); }
  normalize() {
    const d = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    this.x /= d; this.y /= d; this.z /= d; this.w /= d; return this;
  }
  setFromAxisAngle(axis, radians) {
    const s = Math.sin(radians / 2);
    return this.copy(new Q(axis.x * s, axis.y * s, axis.z * s, Math.cos(radians / 2)));
  }
}
const AXIS_Y = { x: 0, y: 1, z: 0 }, AXIS_X = { x: 1, y: 0, z: 0 };
const yaw = angle => new Q().setFromAxisAngle(AXIS_Y, angle);
const pitch = angle => new Q().setFromAxisAngle(AXIS_X, angle);
const equalOrientation = (a, b) => Math.abs(Math.abs(
  a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
) - 1) < 1e-8;

const worldHelperSource = between(legsSource,
  '  function worldQuaternionWithoutScale(node, out) {', '\n  function normalizeKey(value) {');
const worldWithoutScale = new Function(worldHelperSource + '\nreturn worldQuaternionWithoutScale;')();
const sceneRoot = { isObject3D: true, quaternion: pitch(0.16), parent: null };
const reflectedAvatar = { isObject3D: true, quaternion: yaw(0.72), parent: sceneRoot, scale: { x: -1, y: 1, z: 1 } };
const thigh = { isObject3D: true, quaternion: pitch(-0.21), parent: reflectedAvatar };
const calf = { isObject3D: true, quaternion: yaw(-0.34), parent: thigh };
const correct = sceneRoot.quaternion.clone().multiply(reflectedAvatar.quaternion)
  .multiply(thigh.quaternion).multiply(calf.quaternion);
calf.getWorldQuaternion = out => out.copy(yaw(Math.PI).multiply(correct)); // Three's matrix decomposition can reflect the facing basis.
assert(!equalOrientation(calf.getWorldQuaternion(new Q()), correct), 'fixture models a genuine reflected 180-degree error');
assert(equalOrientation(worldWithoutScale(calf, new Q()), correct), 'foot contact ignores mirrored matrix orientation');

const rollHelperSource = between(legsSource,
  '    function applyFootRollOnly(mesh, roll) {', '\n    function applyLegChain(side) {');
const setRoll = new Function('footAxisX', rollHelperSource + '\nreturn applyFootRollOnly;')(AXIS_X);
const foot = { quaternion: yaw(Math.PI) }; // A contact/cliff pose with the half-turn still present.
setRoll(foot, 0);
assert(equalOrientation(foot.quaternion, new Q()), 'walking/idle ownership clears complete previous foot rotation');
setRoll(foot, 0.27);
assert(equalOrientation(foot.quaternion, pitch(0.27)), 'foot roll remains authored when clearing stale yaw');
assert(legsSource.includes('worldQuaternionWithoutScale(chain.calf, pairedFootRotation)'),
  'the real paired/climbing contact solver uses scale-free world orientation');
assert(legsSource.includes('applyFootRollOnly(mesh, Number(record.roll) || 0)'),
  'recorded poses also reclaim complete foot orientation');

const hierarchySource = between(composerSource,
  '  function hierarchyWorldQuaternion(node, target = new THREE.Quaternion()) {',
  '\n  function quaternionEulerDegrees(quaternion) {');
const composerWorldQ = new Function('THREE', hierarchySource + '\nreturn hierarchyWorldQuaternion;')({ Quaternion: Q });
// The camera-facing body adjustment must carry the entire leg rig, not add
// an independent inverse yaw that points the knees behind the portrait.
assert(!composerSource.includes('counterRotateLegRootForRender'), 'no inverse leg-only facing correction');
for (const correction of [-Math.PI * 0.85, 0.7, Math.PI * 0.95]) {
  const world = {isObject3D:true, quaternion:pitch(-0.31), parent:null};
  const body = {isObject3D:true, quaternion:yaw(1.2), parent:world, scale:{x:-1,y:1,z:1}};
  const leg = {isObject3D:true, quaternion:pitch(0.22).multiply(yaw(-0.15)), parent:body};
  const initialBody = body.quaternion.clone(), initialLeg = leg.quaternion.clone();
  const initialWorldLeg = composerWorldQ(leg, new Q()).clone();
  const visualDelta = yaw(correction);
  const parentWorld = composerWorldQ(body.parent, new Q());
  const localDelta = parentWorld.clone().invert().multiply(visualDelta).multiply(parentWorld);
  body.quaternion.premultiply(localDelta);
  assert(equalOrientation(composerWorldQ(leg, new Q()), visualDelta.clone().multiply(initialWorldLeg)), 'legs inherit the exact body world turn');
  assert(equalOrientation(leg.quaternion, initialLeg), 'no additive local half-turn');
  body.quaternion.copy(initialBody);
  assert(equalOrientation(composerWorldQ(leg, new Q()), initialWorldLeg), 'rollback preserves the whole original rig');
}

// Exercise the production render wrapper, including the case where pose composition
// fails BEFORE WebGLRenderer.render (which used to bypass the late finally guard).
// The shipped compose/restore helpers plus the per-render wrapper built from
// them (used when js/render-hooks.js is absent; with it the same helpers run as
// a once-per-world-frame hook, see scripts/test-render-hooks.js).
const wrapperSource = between(composerSource,
  '  function playerBodyRenderApplies(scene) {',
  '  // ── end of render-time composition ──'); // The actual render owner, not a reimplementation.
let temporaryYaw = 0; // Represents a render-scoped visual rotation that must never persist.
let failDuringPose = false; // Deliberately throws after the visual correction has registered its undo.
let failDuringDraw = false; // Also checks the existing WebGL error path.
let failDuringRollback = false; // Simulates a stale attachment whose undo throws before the feet can be restored.
let drawCalls = 0; // Ensures a pre-render failure never reaches the GPU.
const wrappedPlayer = {}; // Mutable fixture: unrelated scenes can be tested as real Object3D scenes without changing normal rollback tests.
const pantsCalls = []; // Captures visible skinning updates and their rollback in the test renderer.
const poseHooks = []; // Test-only hook list that can introduce a temporary real knee change between compose and draw.
let kneeOffset = 0; // Mutable leg-joint deformation observed by the garment during render/undo.
const renderWrapper = new Function(
  'originalRender', 'playerMesh', 'applyRenderedFacingDeadzone',
  'applyPlayerHeadAim', 'applyPlayerNeckYawLimit', 'window', 'performance', 'expireStaleChannels', 'postHeadAimHooks', 'isDescendantOf', 'pantsCalls', 'readYaw', 'readKnee',
  'let renderSequence = 0, unrelatedSceneSkips = 0, lastRenderDebug = null, pendingCapture = null; const playerLegHandle = { pants: { update(renderOnly) { pantsCalls.push({ renderOnly, yaw: readYaw(), knee: readKnee() }); } } }; const proto = {};'
    + wrapperSource + '\nproto.render = makeLegacyComposerRender(originalRender); proto.render.getDebug = () => lastRenderDebug; proto.render.getSkipCount = () => unrelatedSceneSkips; return proto.render;'
)(
  () => { drawCalls++; if (failDuringDraw) throw new Error('synthetic render failure'); return 'drawn'; },
  wrappedPlayer, (_camera, undo) => {
    temporaryYaw += 1;
    undo.push(() => { temporaryYaw -= 1; });
    undo.push(() => { if (failDuringRollback) throw new Error('synthetic undo failure'); }); // Runs first during reverse-order rollback.
    if (failDuringPose) throw new Error('synthetic pose failure');
  },
  () => {}, () => {}, { CharacterActionLocks: { isLocked: () => true } },
  { now: () => 1000 }, () => 0, poseHooks, () => false, pantsCalls, () => temporaryYaw, () => kneeOffset // The offscreen fixture uses a separate scene not containing the live player.
);
assert.equal(renderWrapper({}, {}), 'drawn', 'normal render completes');
assert.equal(temporaryYaw, 0, 'normal render restores the temporary orientation');
assert.deepEqual(pantsCalls.slice(0,2), [{renderOnly:true,yaw:1,knee:0},{renderOnly:true,yaw:0,knee:0}], 'garment skins final turn and restores the base');
failDuringPose = true;
assert.throws(() => renderWrapper({}, {}), /synthetic pose failure/);
assert.equal(temporaryYaw, 0, 'pre-render pose failure rolls back temporary orientation');
assert.equal(pantsCalls.at(-1).yaw, 0, 'pose error restores clean garment');
assert.equal(drawCalls, 1, 'render was never reached after the pose failure');
failDuringPose = false;
failDuringDraw = true;
assert.throws(() => renderWrapper({}, {}), /synthetic render failure/);
assert.equal(temporaryYaw, 0, 'renderer failure rolls back temporary orientation');
assert.equal(pantsCalls.at(-1).yaw, 0, 'renderer error restores clean garment');
assert.equal(drawCalls, 2, 'renderer was reached before the draw failure');
assert.match(renderWrapper.getDebug().renderError, /synthetic render failure/,
  'mobile composer diagnostics retain a render-stage exception');
failDuringDraw = false;
failDuringRollback = true;
assert.equal(renderWrapper({}, {}), 'drawn', 'a failing rollback does not break the frame');
assert.equal(temporaryYaw, 0, 'a failed attachment undo cannot prevent the later foot/body undo');
assert.match(renderWrapper.getDebug().rollbackErrors[0], /synthetic undo failure/,
  'mobile composer diagnostics record which rollback failed');
failDuringRollback = false;
assert.equal(renderWrapper({}, {}), 'drawn', 'normal rendering recovers after the interrupted rollback');
assert.equal(temporaryYaw, 0, 'no stale rotation survives the recovery frame');
// A cliff/paired presenter can change a thigh/knee AFTER normal body composition.
// The pants must see that authored bend before draw and the original pose after its undo.
poseHooks.push(undo => { kneeOffset = 0.35; undo.push(() => { kneeOffset = 0; }); });
assert.equal(renderWrapper({}, {}), 'drawn', 'render hook can author a late knee pose');
assert.equal(pantsCalls.at(-2).knee, 0.35, 'pants are skinned to the late-rendered knee pose');
assert.equal(pantsCalls.at(-1).knee, 0, 'pants restore the previous knee pose in the same render finally');
assert.equal(kneeOffset, 0, 'the authored knee cannot accumulate into later frames');
poseHooks.length = 0;

// A secondary editor/preview scene with its own camera must never advance
// the player's camera deadzone or consume the first subsequent world pose.
const renderedBeforePreview = renderWrapper.getDebug(); // Stable post-world snapshot used to detect an unrelated-scene overwrite.
const drawsBeforePreview = drawCalls; // Unrelated renders still invoke the original renderer exactly once.
wrappedPlayer.isObject3D = true;
assert.equal(renderWrapper({ isScene: true }, {}), 'drawn',
  'unrelated editor scene is rendered by the unmodified renderer');
wrappedPlayer.isObject3D = false;
assert.equal(renderWrapper.getSkipCount(), 1, 'offscreen preview is excluded from player composition');
assert.equal(renderWrapper.getDebug(), renderedBeforePreview, 'unrelated camera does not overwrite the last player render debug');
assert.equal(drawCalls, drawsBeforePreview + 1, 'skipping player pose does not skip the real preview draw');

// Execute the actual render-facing clamp AND the real PerpRotation deadzone
// code. A body test that only verifies equal correction calls can miss a final
// edge-on portrait when an idle weapon's -40° yaw is added after clamping.
const vm = require('node:vm'); // Runs the shipped deadzone with real hysteresis and movement-priority state.
const perpSource = fs.readFileSync('docs/js/perp-rotation.js', 'utf8');
const deg = angle => angle * Math.PI / 180; // Used by authored idle Light Weapon yaw and camera-facing fixtures.
const signed = angle => Math.atan2(Math.sin(angle), Math.cos(angle)); // Same shortest-arc angular error convention as gameplay.
const perpWindow = { SCRATCHBONES_CONFIG: { game: { movement: { perpRotDeadzoneDeg: 40 } } } }; // Default player portrait safety radius.
vm.runInNewContext(perpSource, {
  window: perpWindow, THREE: { MathUtils: { degToRad: deg } }, performance: { now: () => 1000 },
}, { filename: 'perp-rotation.js' });
perpWindow.PerpRotation.init({ angleDiff: (a, b) => signed(a - b) }); // Real two-angle API: compare heading against each camera perpendicular.
const turnApi = perpWindow.PerpRotation; // Production clamp, not a synthetic edge-selector.
const turnState = {}; // Persistent private player deadzone state across successive render passes.
const renderWindow = { PerpRotation: turnApi, Combat: { deps: { player: { perpState: null } } } }; // Existing game-owned directional authority; injected below without copying the algorithm.
const facingSource = between(composerSource,
  '  function applyRenderedFacingDeadzone(camera, undo, renderDebug) {',
  '\n  const absoluteLegsParentQuaternion =');
let composedYaw = 0; // Root yaw after weapon stance and before the final camera correction.
const turnDelta = { angle: 0, setFromAxisAngle(_axis, radians) { this.angle = radians; return this; } }; // Captures the one world-yaw correction for all owned visuals.
const turnForward = {
  x: 0, z: 1,
  set(x, _y, z) { this.x = x; this.z = z; return this; },
  applyQuaternion(q) { this.x = Math.sin(q.yaw); this.z = Math.cos(q.yaw); return this; },
}; // Samples the actual scale-independent heading computation using a minimal world-quaternion fixture.
const turnPivot = { set() { return this; } }; // Fixed posterior pivot in the independent render fixture.
const turnPlayer = { visible: true, position: { x: 0, z: 0 }, localToWorld: p => p }; // Player root drawn with the active weapon.
const turnPet = { name: 'shoulder-pet' }; // Scene-sibling shoulder attachment.
const turnApplied = []; // Records correction distribution across the player and its owned attachments.
const applyTurnClamp = new Function(
  'window', 'playerMesh', 'renderFacingForward', 'hierarchyWorldQuaternion',
  'renderFacingState', 'wrapSignedAngle', 'renderFacingRotation', 'renderFacingUp',
  'renderFacingPivot', 'playerPosteriorY', 'currentOwnedRootEntries',
  'applyWorldDelta', 'renderFacingTranslation', 'currentPlayerNeckJoint',
  facingSource + '\nreturn applyRenderedFacingDeadzone;'
)(
  renderWindow, turnPlayer, turnForward, () => ({ yaw: composedYaw }),
  turnState, signed, turnDelta, AXIS_Y,
  turnPivot, 0, () => [{ root: turnPlayer }, { root: turnPet }],
  root => { turnApplied.push({ root: root.name || 'player', angle: turnDelta.angle }); },
  {}, () => null
);
const camera = { position: { x: 0, z: 10 } }; // World camera normal; edge-on player planes lie at +/-90°.
const perps = turnApi.cameraRelativePerpsAtWorldPosition(turnPlayer.position, camera.position);
function assertPortraitIsNotEdgeOn(yaw, label) {
  const gap = Math.min(...perps.map(perp => Math.abs(signed(yaw - perp)))); // Nearest unsafe edge-on axis.
  assert(gap + 1e-9 >= turnApi.PERP_DEAD_RAD,
    label + ': final composed yaw is within the 40° forbidden deadzone');
}
for (const stanceYaw of [-1.1, -0.2, 0, 0.2, 1.1]) {
  composedYaw = 0.1 + stanceYaw;
  turnApplied.length = 0;
  const debug = { baseFacingYaw: 0.1, authoredAbsoluteYaw: false };
  applyTurnClamp(camera, [], debug);
  assert(Math.abs(debug.bodyDeadzone.rawYaw - composedYaw) < 1e-9,
    'the composed weapon/body yaw, not the pre-stance facing, is actually clamped');
  assert.equal(turnState.lastMovementYaw, 0.1,
    'logical gameplay facing supplies a consistent low-priority deadzone side hint');
  assertPortraitIsNotEdgeOn(debug.bodyDeadzone.composedYaw + debug.bodyDeadzone.correction,
    'weapon stance yaw ' + stanceYaw);
  assert(Math.abs(signed(debug.bodyDeadzone.renderedYaw - (composedYaw + debug.bodyDeadzone.correction))) < 1e-9,
    'correction exactly resolves to the rendered yaw, not a stale baseline');
  if (Math.abs(debug.bodyDeadzone.correction) > 1e-8) {
    assert.deepEqual(turnApplied.map(entry => entry.root), ['player', 'shoulder-pet'], 'legs inherit visual yaw from the body');
    assert(turnApplied.every(entry => Math.abs(entry.angle - debug.bodyDeadzone.correction) < 1e-9), 'pet shares body turn');
    assert.equal(debug.bodyDeadzone.legFacing, 'follows-body', 'mobile reports inherited leg facing');
  }
}
// A 40-degree idle Light Weapon yaw exactly cancels the old base-only clamp
// at one camera perpendicular. This is the regression found on review.
composedYaw = deg(90);
const lightStance = { baseFacingYaw: deg(130), authoredAbsoluteYaw: false };
applyTurnClamp(camera, [], lightStance);
assertPortraitIsNotEdgeOn(lightStance.bodyDeadzone.renderedYaw,
  'default -40° light-weapon yaw at the camera perpendicular');
assert(Math.abs(signed(lightStance.bodyDeadzone.rawYaw - deg(90))) < 1e-9,
  'the same dangerous raw edge-on case is actually exercised');
composedYaw = -0.8;
const authoredTurn = { baseFacingYaw: 0.1, authoredAbsoluteYaw: true };
applyTurnClamp(camera, [], authoredTurn);
assert(Math.abs(authoredTurn.bodyDeadzone.rawYaw + 0.8) < 1e-9,
  'authored absolute crawl/bed heading remains the clamp input');
assert.equal(turnState.lastMovementYaw, null,
  'authored absolute crawl/bed pose never inherits the prior gameplay-facing side hint');

// The actual player simulation already owns the movement/headtrack priority
// hints. Render composition may READ but must not mutate that authoritative state.
const gameplayHint = {
  movementYaw: deg(50), lastMovementYaw: deg(130),
  headtrackYaw: deg(130), headtrackAtMs: 1000,
}; // In the center band, movement (50°) must beat headtrack and last movement (130°).
renderWindow.Combat.deps.player.perpState = gameplayHint;
const hintsBefore = JSON.stringify(gameplayHint); // Detect any accidental render-time simulation mutation.
composedYaw = deg(90);
const realMovementTurn = { baseFacingYaw: deg(130), authoredAbsoluteYaw: false };
applyTurnClamp(camera, [], realMovementTurn);
assert(Math.abs(signed(realMovementTurn.bodyDeadzone.renderedYaw - deg(50))) < 1e-9,
  'gameplay movement hint wins against independently sampled render/body yaw');
assert.equal(realMovementTurn.bodyDeadzone.correctiveSource, 'movement',
  'mobile compositor diagnostics expose the actual winning hint source');
assert.equal(realMovementTurn.bodyDeadzone.gameplayFacingHints, true,
  'mobile compositor diagnostics distinguish game movement ownership from an editor fallback');
assert.equal(JSON.stringify(gameplayHint), hintsBefore,
  'temporary render passes never mutate the gameplay facing state');
gameplayHint.movementYaw = null;
const realHeadTurn = { baseFacingYaw: deg(50), authoredAbsoluteYaw: false };
applyTurnClamp(camera, [], realHeadTurn);
assert(Math.abs(signed(realHeadTurn.bodyDeadzone.renderedYaw - deg(130))) < 1e-9,
  'fresh headtrack direction wins when the actual movement hint is absent');
assert.equal(realHeadTurn.bodyDeadzone.correctiveSource, 'headtrack',
  'the headtrack priority is preserved from gameplay');
renderWindow.Combat.deps.player.perpState = null;

// Rapid reversals, wrapped ±180° turns, both authored weapon yaw signs and
// moving the camera around the player must never leave the *final* painted
// portrait inside the 40° forbidden angle around either camera perpendicular.
const turnCameraPositions = [
  { x: 0, z: 10 }, { x: 10, z: 0 }, { x: 0, z: -10 }, { x: -10, z: 0 },
]; // Different camera quadrants stress the shared camera-relative perpendicular calculation.
for (const rotationDirection of [1, -1]) {
  for (let headingDeg = -180; headingDeg <= 180; headingDeg += 15) {
    for (const visualOffsetDeg of [-40, -15, 0, 15, 40]) {
      const baseYaw = deg(headingDeg * rotationDirection);
      composedYaw = baseYaw + deg(visualOffsetDeg);
      const cameraPosition = turnCameraPositions[Math.abs(Math.floor((headingDeg + 180) / 45)) % turnCameraPositions.length];
      const liveCamera = { position: cameraPosition };
      renderWindow.Combat.deps.player.perpState = {
        movementYaw: baseYaw, lastMovementYaw: baseYaw,
      };
      const debug = { baseFacingYaw: baseYaw, authoredAbsoluteYaw: false };
      applyTurnClamp(liveCamera, [], debug);
      const currentPerps = turnApi.cameraRelativePerpsAtWorldPosition(turnPlayer.position, cameraPosition);
      const gap = Math.min(...currentPerps.map(perp => Math.abs(signed(debug.bodyDeadzone.renderedYaw - perp))));
      assert(gap + 1e-9 >= turnApi.PERP_DEAD_RAD,
        'camera-dependent deadzone excludes edge-on after turn=' + headingDeg + ', visual yaw=' + visualOffsetDeg);
      assert(Math.abs(signed(debug.bodyDeadzone.renderedYaw - (composedYaw + debug.bodyDeadzone.correction))) < 1e-9,
        'whole-body correction matches the composed portrait through wrapped sharp-turn boundaries');
    }
  }
}
renderWindow.Combat.deps.player.perpState = null;

// Check the shoulder-pet solver's actual rotation resolver, not a copied
// implementation, under a negative-scale portrait parent.
const petRuntimeSource = fs.readFileSync('docs/js/shoulder-pet-attachment-runtime.js', 'utf8');
const petOrientationSource = between(petRuntimeSource,
  '    function worldQuaternionWithoutReflection(node, out = new THREE.Quaternion()) {',
  '    const SHOULDER_PET_HALF_TURN_QUATERNION =');
const shoulderOrientation = new Function('THREE', 'window',
  petOrientationSource + '\nreturn worldQuaternionWithoutReflection;'
)({ Quaternion: Q }, { ProceduralLegAnimation: { worldQuaternionWithoutScale: worldWithoutScale } });
const mirrorParent = { isObject3D: true, parent: null, quaternion: yaw(0.71), scale: { x: -1, y: 1, z: 1 } }; // Real portraits can have reflected X scale.
const mirroredNeck = { isObject3D: true, parent: mirrorParent, quaternion: pitch(0.27),
  getWorldQuaternion() { throw new Error('reflected matrix decomposition cannot own shoulder orientation'); } };
const expectedPetOrientation = mirrorParent.quaternion.clone().multiply(mirroredNeck.quaternion);
assert(equalOrientation(shoulderOrientation(mirroredNeck), expectedPetOrientation),
  'shoulder perch follows the physical reflected-neck orientation without a false half-turn');
const shoulderWithoutLegApi = new Function('THREE', 'window',
  petOrientationSource + '\nreturn worldQuaternionWithoutReflection;'
)({ Quaternion: Q }, {});
assert(equalOrientation(shoulderWithoutLegApi(mirroredNeck), expectedPetOrientation),
  'independent attachment editor composes the same physical orientation without the leg runtime');

console.log('PASS: mirrored leg facing, pants render sync, and interrupted-frame recovery');
