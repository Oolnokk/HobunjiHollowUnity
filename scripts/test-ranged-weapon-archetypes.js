const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let now = 1000; // Deterministic clock used to verify thrown hold/release duration.
let activeTool = 'weapon'; // Used by the dual-role animStyle getter to emulate weapon/ranged slot changes.
let equippedRanged = 'kylie_copper'; // Current ranged-slot item used by the slot-aware style bridge and profile-aware mastery options.
const loaded = new Map(); // Captures synthetic loaded-state changes made by the ranged archetype bridge.
const baseStarts = []; // Captures calls that reach the original ranged action state machine.
const intervalCallbacks = []; // Defers bootstrap intervals until both modules have been evaluated.
const baseEffectSelections = []; // Captures mastery selections that pass the archetype-specific validation wrapper.
const addedAfflictions = []; // Captures final affliction ids/amounts after Blowgun scaling aliases are resolved.
const rangedVisuals = []; // Captures thrown charge/release presentation options so authored Weapon Throw (Spin) poses can be checked.
let gripClears = 0; // Confirms interrupted thrown holds release the temporary authored hand-grip mode.
let visibleCharge = 0.45; // Synthetic live Neutral→Windup interpolation reported by the ranged visual owner at input release.
const releasedHolds = []; // Captures partial-pose release options passed into the shared game animation seam.
let cancelledHolds = 0; // Confirms lost releases cancel the held ranged animation, not only the archetype input state.

const toolDefs = {
  kylie_copper: { label: 'Copper Kylie', sprite: 'assets/toolsprites/kylie.png', slots: ['weapon'], animStyle: 'sweep', shapeKey: 'kylie' },
  bshuakauitl_copper: { label: "Copper B'shuakauitl", sprite: "assets/toolsprites/b'shuakauitl.png", slots: ['weapon'], animStyle: 'sweep', shapeKey: 'bshuakauitl' },
  dagger_copper: { label: 'Copper Dagger', sprite: 'assets/toolsprites/dagger.png', slots: ['weapon'], animStyle: 'thrust', shapeKey: 'dagger' },
  fishingspear_copper: { label: 'Copper Fishing Spear', sprite: 'assets/toolsprites/harpoon_fishingspear.png', slots: ['weapon'], animStyle: 'sweep', shapeKey: 'fishingspear' },
  hatchet_copper: { label: 'Copper Hatchet', sprite: 'assets/toolsprites/axe_hatchet.png', slots: ['weapon'], animStyle: 'sweep', shapeKey: 'hatchet' },
  daggerSword_copper: { label: 'Copper Dagger-Sword', sprite: 'assets/toolsprites/dagger-sword.png', slots: ['weapon'], animStyle: 'thrust', shapeKey: 'daggerSword', rangedType: 'thrown' },
};

const afflictionIds = [
  'bleedingHealth', 'woundedStamina', 'congealedHealth', 'infectedStamina',
  'windedStamina', 'bruisedHealth', 'shatteredStamina', 'poisonedHealth',
];
const baseBasicEffects = [
  ...afflictionIds.map(id => ({ id, label: id, desc: `base ${id}`, afflictionId: id })),
  { id: 'knockback', label: 'Knockback Boost', desc: 'base knockback', knockbackMul: 0.25 },
];
const gear = { rangedAmmoLoadouts: {} };

const windowObject = {
  HeldActionAnimations: {
    throwFlask: {
      durationS: 0.62, windupFrac: 0.44, strikeFrac: 0.62, holdFrac: 0.68, releaseFrac: 0.62,
      poses: { neutral: { x: 0 }, windup: { x: 0.12 }, strike: { x: 0.18 } },
    },
    weaponThrowSpin: {
      name: 'Weapon Throw (Spin)', style: 'chop', sequence: 'attack', gripMode: 'palm-parallel',
      durationS: 1.04, windupFrac: 0.49, strikeFrac: 0.57, holdFrac: 0.82,
      poses: {
        neutral: { x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: 2, roll: -82, shoulderAim: { pitch: true, yaw: false, roll: true } },
        windup: { x: 0.41, y: 0.37, z: 0.42, pitch: -180, yaw: 139, bodyYaw: -152, roll: -92, shoulderAim: { pitch: false, yaw: false, roll: false } },
        strike: { x: -0.57, y: 0.33, z: 0.17, pitch: -25, yaw: -65, bodyYaw: 63, roll: -88, shoulderAim: { pitch: true, yaw: false, roll: false } },
      },
    },
    drink: { poses: { strike: { x: 0.4, y: 0.4, z: 0.22, pitch: -180, yaw: 21, roll: 4, bodyYaw: 0 } } },
  },
  Combat: {
    deps: {
      TOOL_ITEM_DEFS: toolDefs,
      getActiveTool: () => activeTool,
      getGearInventory: () => gear,
      saveGearInventory: () => {},
      triggerRangedWeaponVisual: (durationS, options) => { rangedVisuals.push({ durationS, options }); },
      refreshActionBar: () => {},
    },
  },
  ResourceSystem: {
    AFFLICTIONS: Object.fromEntries(afflictionIds.map(id => [id, { name: id, resource: id.includes('Stamina') ? 'stamina' : 'health' }])),
    addAffliction(entity, id, amount) { addedAfflictions.push({ entity, id, amount }); return amount; },
  },
  ResourceRings: { AFFLICTION_COLORS: Object.fromEntries(afflictionIds.map((id, index) => [id, index + 1])) },
  RangedWeapons: {
    config: {
      crossbow: { projectileCount: 1, spreadDeg: 0, damage: 16, speedPxS: 720, rangeTiles: 9, projectileRadiusPx: 7, knockbackPxS: 130, staminaCost: 10 },
    },
    BASIC_AMMO_EFFECTS: baseBasicEffects,
    setBasicEffect(itemKey, rank, effectId) { baseEffectSelections.push({ itemKey, rank, effectId }); return true; },
    setLoaded: (itemKey, value) => loaded.set(itemKey, !!value),
    startPlayerAction(itemKey, options = {}) { baseStarts.push({ itemKey, loaded: loaded.get(itemKey), options }); return true; },
    playerActionLabel: itemKey => `Base ${itemKey}`,
    cancelPlayerAction: () => {},
    triggerPlayerVisual: (durationS, options) => { rangedVisuals.push({ durationS, options }); },
    playerWindupPoseProgress: () => visibleCharge,
    releasePlayerHold: options => { releasedHolds.push(options); return true; },
    cancelPlayerHold: () => { cancelledHolds++; },
    equippedRangedKey: () => equippedRanged,
  },
  WeaponToolStances: { refreshDefinitions: () => {} },
  ProceduralHandGripRuntime: { clear: () => { gripClears++; } },
  InputBindings: { getCurrentBindings: () => ({ desktop: { action1: 'KeyF' }, controller: { action1: 'Button0' } }) },
  __farmLog: () => {},
};
const windowListeners = {}; // Captures window-level listeners (e.g. 'blur') so the test can fire them directly.
windowObject.addEventListener = (type, listener) => { windowListeners[type] = listener; };
const documentListeners = {}; // Captures document-level listeners (e.g. 'visibilitychange') so the test can fire them directly.

const context = {
  window: windowObject,
  document: { readyState: 'complete', addEventListener: (type, listener) => { documentListeners[type] = listener; } },
  navigator: { getGamepads: () => [] },
  performance: { now: () => now },
  Date,
  console,
  requestAnimationFrame: () => 0,
  setInterval: callback => { intervalCallbacks.push(callback); return intervalCallbacks.length; },
  clearInterval: () => {},
};
vm.createContext(context);

for (const relative of [
  '../docs/js/combat/ranged-weapon-archetypes.js',
  '../docs/js/combat/ranged-dual-role-anim-style.js',
]) {
  const source = fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
  vm.runInContext(source, context, { filename: relative });
}
for (const callback of [...intervalCallbacks]) callback();

const rangedWeaponsSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/combat/ranged-weapons.js'), 'utf8'); // Pins the actual projectile-plane/spin implementation used by runtime.
const rangedArchetypeSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/combat/ranged-weapon-archetypes.js'), 'utf8'); // Pins cross-input thrown hold/release ownership so mouse cannot be released by controller state.
const fishingSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/fishing-minigame.js'), 'utf8'); // Pins the shared fishing-mace outbound spin source.
const heldActionSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/held-action-animations.js'), 'utf8'); // Pins the user-authored shared throw animation source.
const gripRuntimeSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/procedural-hand-grip-runtime.js'), 'utf8'); // Pins ranged visual support for authored gripMode metadata.
const gameSource = fs.readFileSync(path.resolve(__dirname, '../docs/game.js'), 'utf8'); // Pins the minimal Charged-Breaker-style partial-release seam used by thrown weapons.
const scratchbonesConfigSource = fs.readFileSync(path.resolve(__dirname, '../docs/config/scratchbones-config.js'), 'utf8'); // Pins the exact fixed thrown-release recording.
const attackEditorSource = fs.readFileSync(path.resolve(__dirname, '../docs/tools/attack-animation-editor/index.html'), 'utf8'); // Pins the pick-mining end-flip authoring control/export contract.
assert.match(gameSource, /function getWeaponSwingWindupPoseProgress\(\)/, 'game runtime must expose visible linear held-windup progress.');
assert.match(gameSource, /function partialCombatPoseAtCharge\(pose, poseProgress\)/, 'game runtime must support releasing from the currently visible partial pose.');
assert.match(gameSource, /getHeldRangedTexture:[\s\S]*material\?\.map/, 'ranged projectile appearance must source the exact held tool texture.');
assert.match(gameSource, /setHeldRangedVisible:[\s\S]*toolMeshMap\.ranged\.visible/, 'game runtime must expose exact in-hand ranged visibility handoff.');
assert.match(gameSource, /getHeldRangedWorldTransform:[\s\S]*getWorldPosition[\s\S]*getWorldQuaternion[\s\S]*matrixWorld:\s*plane\.matrixWorld\.clone\(\)[\s\S]*planeWidth[\s\S]*planeHeight[\s\S]*directionSwap/, 'projectiles must sample the rendered held plane transform, geometry and direction-swap state at Strike.');
assert.ok(gameSource.indexOf('updateToolMesh(dt);') < gameSource.indexOf('window.RangedWeapons?.update(dt);'),
  'held tool animation must advance to the Strike frame before ranged projectile spawning samples its world transform.');
assert.match(gameSource, /combatSwingAlignToReticle[\s\S]*currentPlayerAimAngle\(\)[\s\S]*currentPlayerAimPitch\(\)/, 'ranged throw/fire animation frames must align to the live reticle yaw and pitch.');
assert.match(gameSource, /combatSwingOrbitRigCentroid[\s\S]*activeCameraMode === SHOULDER_SURF_MODE[\s\S]*currentPlayerPerspectiveDirection\(\)[\s\S]*currentPlayerAimAngle\(\)[\s\S]*currentPlayerAimPitch\(\)[\s\S]*avatarCentroidWorld\?\.\(playerMesh\)[\s\S]*unpitchedHandX[\s\S]*centroidToHandSide[\s\S]*centroidToHandForward/, 'thrown playback must orbit the exact centroid-to-held-pose vector; shoulder-surf shares the head perspective ray, normal desktop preserves its established aim frame, and zero pitch does not assume centroid X/Z equals player root X/Z.');
assert.match(gameSource, /rangedStanceEndFlip[\s\S]*playerDirectionSwap\?\.\(spinItemKey\)[\s\S]*setToolPlaneDirectionSwap\(spinPlane, desiredEndFlip\)/, 'ranged Neutral must use the same configured direction swap as held throw phases.');
assert.match(gameSource, /activeThrownChargeItemKey\?\.\(\)[\s\S]*releaseThrownCharge\?\.\('input-action-release'\)/, 'keyboard/controller Action 1 release must finish the active thrown charge through the shared input path.');
assert.match(gameSource, /desktopHeldItemMousePresses\.delete\(e\.button\)[\s\S]*activeTool === 'ranged'[\s\S]*runInputAction\('action1', 'release'\)/, 'desktop mouse release must route a ranged thrown hold through the same shared release path.');
assert.doesNotMatch(rangedArchetypeSource, /pollControllerRelease|controllerBindingFor\('action1'\)/, 'controller state must never poll-release a charge that may have been started by mouse or keyboard.');
assert.strictEqual((rangedArchetypeSource.match(/function bootstrap\(\)/g) || []).length, 1, 'ranged archetype bootstrap must have exactly one implementation.');
assert.match(rangedArchetypeSource, /pointerId == null\) return[\s\S]*event\.pointerId === thrownCharge\.pointerId/, 'the archetype-level pointer release bridge is reserved for the pointer-owned on-screen Shoot button.');
assert.match(gameSource, /function setToolPlaneDirectionSwap[\s\S]*uv\.setY\(i, 1 - uv\.getY\(i\)\)/, 'runtime weapon direction swap must reflect PNG local Y through the plane UVs.');
assert.match(gameSource, /plane\.rotation\.x = -Math\.PI \/ 2;[\s\S]*setToolPlaneDirectionSwap\(plane, opts\.flip === true\)/, 'base pick direction swap must keep the 3D plane basis fixed and mirror only the PNG direction.');
assert.doesNotMatch(gameSource, /spinPlane\.rotation\.x = \(baseEndFlip !== actionEndFlip\)/, 'animation direction swap must not rotate the held plane around the old wrong X axis.');
assert.match(attackEditorSource, /id="toolEndFlipBtn"[\s\S]*Weapon Direction Swap/, 'Attack Animation Editor must expose the corrected Weapon Direction Swap control directly.');
assert.match(attackEditorSource, /function setToolPlaneDirectionSwap[\s\S]*uv\.setY\(i, 1 - uv\.getY\(i\)\)/, 'Attack Animation Editor preview must use the same PNG-local-Y reflection as runtime.');
assert.match(attackEditorSource, /toolEndFlip:\s*anim\.toolEndFlip === true/, 'Attack Animation Editor exports the Tool End Flip bit.');
assert.match(attackEditorSource, /anim\.toolEndFlip = data\.toolEndFlip === true/, 'Attack Animation Editor imports the Tool End Flip bit.');
assert.match(heldActionSource, /name:\s*'Weapon Throw \(Spin\)'/, 'Shared held-action library must expose Weapon Throw (Spin).');
assert.match(heldActionSource, /durationS:\s*1\.04[\s\S]*windupFrac:\s*0\.49[\s\S]*strikeFrac:\s*0\.57[\s\S]*holdFrac:\s*0\.82/, 'Weapon Throw (Spin) must retain the supplied authored timing.');
assert.match(heldActionSource, /gripMode:\s*'palm-parallel'/, 'Weapon Throw (Spin) must retain the supplied palm-parallel grip mode.');
assert.match(rangedWeaponsSource, /gripMode:\s*def\.gripMode\s*\|\|\s*null/, 'Ranged action playback must forward authored grip mode metadata.');
assert.match(gripRuntimeSource, /beginHeld:\s*beginHeldMode/, 'Procedural hand grip runtime must expose the held-grip lifecycle to ranged visuals.');
assert.match(rangedWeaponsSource, /grip\?\.beginHeld\?\.\(options\.gripMode\)/, 'Ranged visuals must activate the authored held grip through the shared grip runtime.');
assert.match(fishingSource, /projectileVisuals:\s*FISHING_PROJECTILE_VISUALS/, 'Fishing must expose its projectile visual tuning for combat reuse.');
assert.match(rangedWeaponsSource, /Fishing\?\.projectileVisuals\?\.maceSpinRateDeg/, 'Thrown spin must read Fishing\'s authored mace spin rate instead of inventing a separate rate.');
assert.match(rangedWeaponsSource, /textureSource\?\.clone[\s\S]*texture = textureSource\.clone\(\)/, 'Thrown projectiles must clone the exact held texture so metal and verdigris pattern match pixel-for-pixel.');
assert.match(rangedWeaponsSource, /hasExactSourcePlane[\s\S]*new THREE\.PlaneGeometry\(projectilePlaneWidth, projectilePlaneHeight\)/, 'Thrown projectile geometry must use the sampled held plane dimensions instead of an independently guessed size.');
assert.match(rangedWeaponsSource, /def\.rangedType === 'thrown'[\s\S]*def\.toolEndFlip === true[\s\S]*uv\.setY\(i, 1 - uv\.getY\(i\)\)/, 'Thrown projectile copy must use the stance-wide configured direction reflection so spear/knife cannot reverse during handoff.');
assert.match(rangedWeaponsSource, /playerDirectionSwap:\s*itemKey\s*=>\s*directionSwapFor\(itemKey\)/, 'Ranged runtime must expose the stance-wide direction lookup used by Neutral playback.');
assert.match(rangedWeaponsSource, /sourceTransform:\s*heldTransform/, 'Player ranged projectiles must launch from the held plane transform sampled at Strike.');
assert.match(rangedWeaponsSource, /launchTransformMode[^\n]*'held-strike-plane'/, 'Thrown projectile debug state must identify exact held-strike launches.');
assert.match(rangedWeaponsSource, /const swingIndex = 2/, 'Thrown release must select melee swing variant 3 exactly, not a random swing.');
assert.match(rangedWeaponsSource, /combatSfxConfig\?\.\(\)\.weaponSwing3/, 'Thrown release must resolve the weaponSwing3 cue specifically.');
assert.match(rangedWeaponsSource, /playWeaponSlashSfx\?\.\(2, swingIndex\)/, 'Thrown player attacks must play swing 3 at 2x pitch instead of ranged-fire SFX.');
assert.match(scratchbonesConfigSource, /"weaponSwing3"\s*:\s*\{\s*"url"\s*:\s*"assets\/audio\/sfx\/combat\/sfx_swing_3\.mp3"/, 'weaponSwing3 must remain docs/assets/audio/sfx/combat/sfx_swing_3.mp3.');
assert.match(rangedWeaponsSource, /const PROJECTILE_PERP_DEAD_DEG = 15/, 'Non-spinning projectile readability must retain the requested 15-degree camera-facing deadzone.');
assert.match(rangedWeaponsSource, /setHeldRangedVisible\?\.\(action\.itemKey, false\)/, 'Held weapon must hide on the projectile-spawn frame.');
assert.match(rangedWeaponsSource, /restoreHeldThrownWeapon\(action\)/, 'Held weapon must return only when the release action completes back at Neutral.');
assert.match(rangedWeaponsSource, /p\.def\.damage \* falloff \* \(Number\.isFinite\(p\.damageScale\)/, 'Thrown projectile raw damage must multiply by released visible windup percentage.');
assert.doesNotMatch(rangedWeaponsSource, /cameraPitchAxisWorld|fixedPitchAxisWorld/, 'Thrown spin must not derive any axis from the camera or world launch frame.');
assert.match(rangedWeaponsSource, /p\.facePivot\.rotation\.z = p\.spinRad/, 'Thrown spin must rotate the PNG plane child around its own local Z axis.');
assert.match(rangedWeaponsSource, /p\.facePivot\.rotation\.y = 0;[\s\S]*p\.facePivot\.rotation\.z = p\.spinRad;[\s\S]*return;/, 'Spinning thrown weapons must not layer camera-facing twist onto the local-Z spin.');
assert.match(rangedWeaponsSource, /p\.facePivot\.rotation\.y = p\.faceTwistRad/, 'Non-spinning projectile readability remains isolated to the child long-axis twist.');
assert.match(rangedWeaponsSource, /Math\.abs\(diff\) > PROJECTILE_PERP_DEAD_RAD/, 'Projectile sprite camera-facing must retain the 15-degree deadzone instead of perfect billboarding.');
assert.doesNotMatch(rangedWeaponsSource, /p\.visual\.rotation\.y = p\.pngRot/, 'Legacy whole-projectile camera yaw billboarding must stay removed.');

assert.ok(toolDefs.kylie_copper.slots.includes('ranged'), 'Kylie should be equippable in the ranged slot.');
assert.ok(toolDefs.bshuakauitl_copper.slots.includes('ranged'), "B'shuakauitl should be equippable in the ranged slot.");
for (const key of ['dagger_copper', 'fishingspear_copper', 'hatchet_copper']) {
  assert.ok(toolDefs[key].slots.includes('ranged'), `${key} should be equippable in the ranged slot.`);
  assert.strictEqual(windowObject.RangedWeapons.config[key]?.rangedType, 'thrown', `${key} should use the shared thrown archetype.`);
}
for (const key of ['dagger_copper', 'hatchet_copper', 'kylie_copper']) {
  assert.strictEqual(windowObject.RangedWeapons.config[key]?.projectileVisualStyle, 'spinningWeapon', `${key} should use the spinning weapon projectile presentation.`);
  assert.strictEqual(windowObject.RangedWeapons.config[key]?.projectileSpinSource, 'fishingMace', `${key} should reuse the fishing-mace spin source.`);
  assert.strictEqual(windowObject.RangedWeapons.config[key]?.projectileSprite, toolDefs[key].sprite, `${key} projectile should use its actual weapon sprite.`);
}
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear_copper?.projectileVisualStyle, 'weapon', 'Fishing spear should use its real weapon sprite/material while staying non-spinning.');
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear_copper?.projectileSpinSource, null, 'Fishing spear must remain non-spinning until its dedicated throw is authored.');
for (const key of ['kylie_copper', 'dagger_copper', 'fishingspear_copper', 'hatchet_copper']) {
  const cfg = windowObject.RangedWeapons.config[key];
  assert.ok(Math.abs(cfg.chargeWindupS - 0.5096) < 1e-9, `${key} must use Weapon Throw (Spin)'s 1.04s × 0.49 authored windup.`);
  assert.ok(Math.abs(cfg.fireDurationS - 0.5304) < 1e-9, `${key} release must use the remainder of Weapon Throw (Spin)'s authored duration.`);
  assert.strictEqual(cfg.gripMode, 'palm-parallel', `${key} must use Weapon Throw (Spin)'s authored palm-parallel grip.`);
}
assert.strictEqual(windowObject.RangedWeapons.config.dagger_copper.toolEndFlip, true, 'Knife ranged Neutral must keep its configured direction swap.');
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear_copper.toolEndFlip, true, 'Fishing Spear ranged Neutral must keep its configured direction swap.');
assert.strictEqual(windowObject.RangedWeapons.config.hatchet_copper.toolEndFlip, false, 'Hatchet ranged Neutral keeps the unswapped authored direction.');
assert.strictEqual(windowObject.RangedWeapons.config.hatchet_copper.chargePose.neutral.roll, -82, 'Hatchet uses Weapon Throw (Spin) exactly as authored.');
assert.strictEqual(windowObject.RangedWeapons.config.kylie_copper.firePose.strike.roll, -88, 'Kylie uses Weapon Throw (Spin) exactly as authored.');
assert.strictEqual(windowObject.RangedWeapons.config.kylie_copper.chargePose.strike.roll, -88, 'held throw timeline must retain the real authored Strike endpoint behind the Windup hold.');
assert.notStrictEqual(windowObject.RangedWeapons.config.kylie_copper.chargePose.strike.roll, windowObject.RangedWeapons.config.kylie_copper.chargePose.windup.roll, 'Windup and Strike must not collapse to the same pose or the release lerp becomes visually empty.');
for (const key of ['dagger_copper', 'fishingspear_copper']) {
  const cfg = windowObject.RangedWeapons.config[key];
  assert.strictEqual(cfg.toolEndFlip, true, `${key} must use the exact pick-mining end-for-end sprite basis.`);
  assert.strictEqual(cfg.chargePose.neutral.roll, -82, `${key} must not fake end flipping by modifying Neutral Roll.`);
  assert.strictEqual(cfg.chargePose.windup.roll, -92, `${key} must not fake end flipping by modifying Windup Roll.`);
  assert.strictEqual(cfg.firePose.strike.roll, -88, `${key} must not fake end flipping by modifying Strike Roll.`);
}
assert.strictEqual(windowObject.RangedWeapons.config.hatchet_copper.toolEndFlip, false, 'Hatchet keeps the authored normal sprite end orientation.');
assert.strictEqual(windowObject.RangedWeapons.config.kylie_copper.toolEndFlip, false, 'Kylie keeps the authored normal sprite end orientation.');
assert.ok(!toolDefs.daggerSword_copper.slots.includes('ranged'), 'Dagger-swords must remain melee-only even if a stale definition claims rangedType=thrown.');
assert.strictEqual(windowObject.RangedWeapons.config.daggerSword_copper, undefined, 'Dagger-swords must never receive ranged projectile configuration.');
assert.strictEqual(windowObject.RangedWeapons.config.kylie_copper.rangedType, 'thrown');
assert.strictEqual(windowObject.RangedWeapons.config.bshuakauitl_copper.rangedType, 'blowgun');
assert.strictEqual(windowObject.RangedWeapons.config.bshuakauitl_copper.damage, 2, 'Blowgun should use deliberately tiny raw damage.');
assert.strictEqual(windowObject.RangedWeapons.config.bshuakauitl_copper.basicAfflictionScale, 40, 'Blowgun should heavily amplify mastery affliction buildup.');
assert.strictEqual(windowObject.RangedWeapons.config.bshuakauitl_copper.firePose.neutral.pitch, -180, 'Blowgun stance should copy Drink strike pitch.');

const kylieChoices = windowObject.RangedWeapons.basicAmmoEffectsFor('kylie_copper').map(effect => effect.id);
assert.deepStrictEqual(kylieChoices, ['congealedHealth', 'windedStamina', 'bruisedHealth', 'shatteredStamina', 'knockback'], 'Kylie ranged mastery should expose only blunt-family buildup plus knockback, preserving source ordering.');
const blowgunChoices = windowObject.RangedWeapons.basicAmmoEffectsFor('bshuakauitl_copper').map(effect => effect.id);
assert.deepStrictEqual(blowgunChoices, afflictionIds, 'Blowgun ranged mastery should expose the full affliction set.');
assert.strictEqual(windowObject.RangedWeapons.setBasicEffect('kylie_copper', 1, 'bleedingHealth'), false, 'Kylie should reject sharp-style Bleeding Health mastery.');
assert.strictEqual(windowObject.RangedWeapons.setBasicEffect('kylie_copper', 1, 'bruisedHealth'), true, 'Kylie should accept Bruised Health mastery.');
assert.strictEqual(windowObject.RangedWeapons.setBasicEffect('bshuakauitl_copper', 1, 'poisonedHealth'), true, 'Blowgun should accept Poisoned Health mastery.');
assert.deepStrictEqual(baseEffectSelections.map(entry => entry.effectId), ['bruisedHealth', 'poisonedHealth']);

// The closure-private ranged payload builder still sees the original effect objects.
// While a Blowgun is equipped, their afflictionId getter emits a projectile-carried
// alias. ResourceSystem resolves that alias at impact and multiplies the normal 0.15
// amount by 40 without increasing the dart's raw damage.
equippedRanged = 'bshuakauitl_copper';
const poisonAlias = baseBasicEffects.find(effect => effect.id === 'poisonedHealth').afflictionId;
assert.match(poisonAlias, /^__ranged_blowgun_40x_poisonedHealth$/);
windowObject.ResourceSystem.addAffliction({}, poisonAlias, 0.3); // 2 raw damage × the ranged system's normal 0.15 mastery multiplier.
assert.strictEqual(addedAfflictions.at(-1).id, 'poisonedHealth');
assert.strictEqual(addedAfflictions.at(-1).amount, 12, 'A 2-damage Blowgun dart should build 12 affliction per selected mastery rank (effective 6.0x).');

equippedRanged = 'kylie_copper';
assert.strictEqual(baseBasicEffects.find(effect => effect.id === 'bruisedHealth').afflictionId, 'bruisedHealth', 'Kylie should use normal ranged buildup multipliers rather than Blowgun scaling aliases.');

assert.strictEqual(toolDefs.kylie_copper.animStyle, 'sweep', 'Kylie must keep its melee sweep style in the weapon slot.');
assert.strictEqual(toolDefs.dagger_copper.animStyle, 'thrust', 'Dagger must keep thrust style in the weapon slot.');
assert.strictEqual(toolDefs.fishingspear_copper.animStyle, 'sweep', 'Fishing spear must keep sweep style in the weapon slot.');
assert.strictEqual(toolDefs.hatchet_copper.animStyle, 'sweep', 'Hatchet must keep sweep style in the weapon slot.');
activeTool = 'ranged';
for (const key of ['kylie_copper', 'dagger_copper', 'fishingspear_copper', 'hatchet_copper']) {
  equippedRanged = key;
  assert.strictEqual(toolDefs[key].animStyle, 'ranged', `${key} must report ranged style while active in the ranged slot.`);
}
activeTool = 'weapon';
assert.strictEqual(toolDefs.kylie_copper.animStyle, 'sweep', 'Returning to melee must restore Kylie sweep style.');
assert.strictEqual(toolDefs.dagger_copper.animStyle, 'thrust', 'Returning to melee must restore Dagger thrust style.');
assert.strictEqual(toolDefs.fishingspear_copper.animStyle, 'sweep', 'Returning to melee must restore Fishing Spear sweep style.');
assert.strictEqual(toolDefs.hatchet_copper.animStyle, 'sweep', 'Returning to melee must restore Hatchet sweep style.');
equippedRanged = 'kylie_copper';

assert.strictEqual(windowObject.RangedWeapons.startPlayerAction('kylie_copper'), true, 'Kylie press should begin a thrown hold.');
assert.match(windowObject.RangedWeapons.playerActionLabel('kylie_copper'), /^Release /);
assert.strictEqual(rangedVisuals.at(-1).durationS, 1.04, 'Thrown hold must use the real authored animation duration, not a synthetic hours-long timer.');
assert.strictEqual(rangedVisuals.at(-1).options.held, true, 'Thrown press must hold the real ranged animation at Windup.');
assert.strictEqual(rangedVisuals.at(-1).options.pose.windup.roll, -92, 'Thrown hold visual must use Weapon Throw (Spin) Windup rather than the old flask throw.');
assert.strictEqual(rangedVisuals.at(-1).options.pose.strike.roll, -88, 'Thrown hold visual must carry the real Strike endpoint even though playback is clamped at Windup until release.');
assert.strictEqual(rangedVisuals.at(-1).options.gripMode, 'palm-parallel', 'Thrown hold visual must carry the authored palm-parallel grip mode.');
assert.strictEqual(rangedVisuals.at(-1).options.alignToReticle, true, 'Entire thrown animation must use the live reticle frame.');
assert.strictEqual(rangedVisuals.at(-1).options.orbitRigCentroid, true, 'Thrown animation must rotate its complete pose frame around the character rig centroid.');
assert.strictEqual(rangedVisuals.at(-1).options.toolEndFlip, false, 'Kylie hold uses the normal tool-end basis.');
now += 450;
visibleCharge = 0.45;
assert.strictEqual(windowObject.HobunjiRangedWeaponArchetypes.releaseThrownCharge('test'), true, 'Kylie release should enter the existing ranged fire state machine.');
assert.strictEqual(releasedHolds.length, 1, 'release must invoke the shared partial-pose seam exactly once.');
assert.strictEqual(releasedHolds[0].poseProgress, 0.45, 'release must hand the exact visible Neutral→Windup interpolation into the shared partial-pose release seam.');
assert.strictEqual(baseStarts.length, 1, 'throw release must start exactly one projectile action.');
assert.strictEqual(baseStarts[0].itemKey, 'kylie_copper');
assert.strictEqual(baseStarts[0].loaded, true);
assert.strictEqual(baseStarts[0].options.damageScale, 0.45, 'projectile action must use visible windup percent as raw damage scale.');
assert.strictEqual(baseStarts[0].options.suppressVisual, true, 'projectile action must not restart the release animation.');

assert.strictEqual(windowObject.RangedWeapons.startPlayerAction('bshuakauitl_copper'), true, 'Blowgun should retain ordinary load/fire start behavior.');
assert.strictEqual(baseStarts.at(-1).itemKey, 'bshuakauitl_copper');

// A lost release (alt-tab, app switch) must not leave the player parked in the
// charging windup pose forever -- regression guard for a missing blur/visibilitychange
// handler that could otherwise strand thrownCharge indefinitely (see combat-input.js's
// own abortAllPresses convention for the same class of bug on melee holds).
assert.ok(windowListeners.blur, 'installInputBridge must register a window blur handler for thrown charges.');
assert.ok(documentListeners.visibilitychange, 'installInputBridge must register a document visibilitychange handler for thrown charges.');
assert.strictEqual(windowObject.RangedWeapons.startPlayerAction('kylie_copper'), true, 'Kylie press should begin a thrown hold.');
assert.ok(windowObject.HobunjiRangedWeaponArchetypes.debugSnapshot().thrownCharge, 'a charge must be active before simulating focus loss.');
windowListeners.blur();
let snapshot = windowObject.HobunjiRangedWeaponArchetypes.debugSnapshot();
assert.strictEqual(snapshot.thrownCharge, null, 'window blur must cancel an in-progress thrown charge.');
assert.strictEqual(snapshot.lastRelease.type, 'cancelled', 'window blur must report the charge as cancelled, not released.');
assert.strictEqual(cancelledHolds, 1, 'cancelling a thrown hold must cancel the held ranged visual exactly once.');

assert.strictEqual(windowObject.RangedWeapons.startPlayerAction('kylie_copper'), true, 'Kylie press should begin another thrown hold.');
context.document.hidden = true;
documentListeners.visibilitychange();
snapshot = windowObject.HobunjiRangedWeaponArchetypes.debugSnapshot();
assert.strictEqual(snapshot.thrownCharge, null, 'tab hide (document.hidden) must cancel an in-progress thrown charge.');
assert.strictEqual(snapshot.lastRelease.type, 'cancelled', 'tab hide must report the charge as cancelled, not released.');
assert.strictEqual(cancelledHolds, 2, 'each interrupted thrown hold must cancel the held ranged visual exactly once.');

console.log('PASS ranged weapon archetypes');