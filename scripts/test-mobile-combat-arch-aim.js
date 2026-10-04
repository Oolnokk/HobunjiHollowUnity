'use strict';

// Static regression guard for the mobile action-arch combat aim/release contract.
// Run with: node scripts/test-mobile-combat-arch-aim.js
const fs = require('fs');
const path = require('path');

const gamePath = path.join(__dirname, '..', 'docs', 'game.js');
const source = fs.readFileSync(gamePath, 'utf8');

function assertIncludes(fragment, message) {
  if (!source.includes(fragment)) throw new Error(message + ` (missing: ${fragment})`);
}
function assertExcludes(fragment, message) {
  if (source.includes(fragment)) throw new Error(message + ` (unexpected: ${fragment})`);
}

assertIncludes('let mobileArchCombatAim = null;', 'mobile combat aim state must exist');
assertIncludes("_combatAimRelease = Boolean(_pressSlot || (activeTool === 'ranged' && act === 'shoot'));", 'ranged shoot and melee slots must opt into release-owned aiming');
assertIncludes('setMobileArchCombatAim(ev.pointerId, ang, el.dataset.action, _pressSlot);', 'combat drags must feed the existing action-arch stick vector into shared aim');
assertIncludes('window.Combat.input.pressEnd(_pressSlot);', 'melee press/hold state must survive drag and release normally');
assertExcludes('window.Combat.input.cancelPress(_pressSlot);', 'combat arch drag must never cancel the live melee press/hold state');
assertIncludes('commitMeleeAttackFacing(mobileArchCombatAim.angle);', 'dragged melee release must latch the chosen direction through its strike');
assertIncludes('if (Number.isFinite(mobileArchCombatAim?.angle)) return mobileArchCombatAim.angle;', 'live stick yaw must override an older auto-target facing commit while a melee hold is still being aimed');
assertIncludes('if (Number.isFinite(manualArchFacing)) commitMeleeAttackFacing(manualArchFacing);', 'auto-target fallback must preserve the manual release heading when no target is acquired');
assertIncludes('else if (!_drag || combatAimOwned)', 'dragged ranged input must fire on release instead of threshold-cross');
assertIncludes("clearMobileArchCombatAim(ev.pointerId, 'pointer-cancel');", 'pointer cancellation must not commit an attack');
assertIncludes('updateMobileArchCombatAimLifecycle();', 'released ranged aim must stay latched through the authored fire animation');
assertExcludes('With a weapon equipped, action buttons are tap/hold only', 'legacy weapon drag suppression must stay removed');

console.log('mobile combat arch aim/release regression checks passed');

const assert = require('node:assert/strict'); // Checks production aim and cancellation behavior below.
const vm = require('node:vm'); // Executes browser helpers with minimal runtime dependencies.
const rayContext = {
  mobileArchCombatAim: null,
  activeCameraMode: 'orbit', SHOULDER_SURF_MODE: 'shoulder',
  heldMode: 'tool', activeTool: 'weapon', equipmentSlots: {},
  camera: { updateMatrixWorld() {} }, _screenCenterNDC: {},
  _shoulderSurfReticleRaycaster: { setFromCamera() {}, ray: { origin: {x:1,y:2,z:3}, direction: {x:0,y:0,z:-1} } },
  window: { FormatUtils: { clamp: (v,a,b) => Math.max(a,Math.min(b,v)) } },
}; // Supplies only the real camera-ray helper's dependencies.
vm.createContext(rayContext);
vm.runInContext(source.slice(source.indexOf('      function currentPlayerAimRay()'), source.indexOf('      function currentPlayerInteractionRay()')), rayContext);
assert.equal(rayContext.currentPlayerAimRay(), null, 'idle arch leaves ordinary melee camera behavior unchanged');
rayContext.activeCameraMode = 'shoulder';
assert.equal(rayContext.currentPlayerAimRay().direction.z, -1, 'idle arch retains shoulder camera direction');
rayContext.mobileArchCombatAim = {angle:0};
assert.equal(rayContext.currentPlayerAimRay().direction.x, 1, 'explicit zero yaw is a valid manual aim');
rayContext.mobileArchCombatAim = {angle:Math.PI/2};
assert.equal(rayContext.currentPlayerAimRay().direction.z, 1, 'drag yaw reaches the production aim ray');

const inputSource = fs.readFileSync('docs/js/combat/combat-input.js', 'utf8'); // Real hold termination state machine under test.
let releases = 0, cancellations = 0, alignmentCancels = 0; // Counters distinguish a normal release from a canceled input.
const makeHeldSlot = () => ({down:true,holding:true,holdStarted:true,holdAbility:{onHoldEnd(){releases++;},onHoldCancel(){cancellations++;}}}); // Started charge-like ability with separate cancellation cleanup.
const holdContext = {slots:{1:makeHeldSlot()},emitState(){}}; // Minimal shared-input slot state.
vm.createContext(holdContext);
vm.runInContext(inputSource.slice(inputSource.indexOf('  function endHold('), inputSource.indexOf('  // Call on pointerdown')), holdContext);
vm.runInContext(inputSource.slice(inputSource.indexOf('  function abortPress('), inputSource.indexOf('  function abortAllPresses(')), holdContext);
holdContext.abortPress(1);
assert.equal(cancellations, 1, 'canceled started hold calls cancellation cleanup');
assert.equal(releases, 0, 'canceled started hold never calls the release attack');
assert.equal(holdContext.slots[1].down, false, 'cancellation releases input ownership');
holdContext.slots[1] = makeHeldSlot();
holdContext.endHold(1);
assert.equal(releases, 1, 'ordinary finger-up keeps normal release behavior');
holdContext.slots[1] = {down:true,holding:true,holdStarted:false,alignmentRequest:{cancel(){alignmentCancels++;}}};
holdContext.abortPress(1);
assert.equal(alignmentCancels, 1, 'pending alignment is canceled without starting an attack');
assert.equal(holdContext.slots[1].releaseQueued, false, 'canceled pending alignment cannot release later');

const breakerSource = fs.readFileSync('docs/js/combat/combat-charged-breaker.js', 'utf8'); // Real charge cleanup function under test.
let visualCancels = 0, glowClears = 0; // Counts cleanup paths that must run instead of strike resolution.
const breakerContext = {startedAt:1,debugState:{active:true},FURIOUS_PROGRESS_OWNER:'charge',clearGlow(){glowClears++;},window:{Combat:{setWindupProgressTransform(owner,value){assert.equal(value,null);},deps:{cancelWeaponSwingHold(){visualCancels++;}}}}}; // Minimal Charged Breaker ownership dependencies.
vm.createContext(breakerContext);
vm.runInContext(breakerSource.slice(breakerSource.indexOf('    function onHoldCancel('), breakerSource.indexOf('    function onHoldEnd(')), breakerContext);
breakerContext.onHoldCancel();
breakerContext.onHoldCancel();
assert.equal(visualCancels, 1, 'charge cancellation cleans up exactly once');
assert.equal(glowClears, 1, 'charge cancellation clears its glow');
assert.equal(breakerContext.startedAt, -1, 'charge cancellation stops the hold clock');
assert.equal(breakerContext.debugState.active, false, 'mobile diagnostics stop reporting an active charge');
console.log('Executed mobile aim and held-attack cancellation checks passed.');
