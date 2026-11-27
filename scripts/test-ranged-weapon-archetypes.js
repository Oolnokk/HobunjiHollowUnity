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
  kylie_copper: { label: 'Copper Kylie', sprite: 'assets/toolsprites/kylie.png', slots: ['weapon'], animStyle: 'sweep', shapeKey: 'kylie', dmgType: 'blunt' },
  bshuakauitl_copper: { label: "Copper B'shuakauitl", sprite: "assets/toolsprites/b'shuakauitl.png", slots: ['weapon'], animStyle: 'sweep', shapeKey: 'bshuakauitl' },
  dagger_copper: {
    label: 'Copper Dagger', sprite: 'assets/toolsprites/dagger.png', slots: ['weapon'], animStyle: 'thrust', shapeKey: 'dagger',
    rangedProjectileSpeedMultiplier: 1.31,
    rangedProjectileDropStartTiles: 4.5,
    rangedProjectileGravityWorldS2: 11,
    rangedProjectileEmbedOnTerrain: true,
    rangedProjectilePersistS: 7,
    rangedProjectileMaxEmbedded: 2,
    rangedProjectileFadeS: 0.4,
  },
  fishingspear: { label: 'Fishing Spear', sprite: 'assets/toolsprites/harpoon_fishingspear.png', slots: ['weapon'], animStyle: 'thrust', dmgType: 'sharp' }, // Legacy Fishing Spear is the exact item key mine ghouls equip as a ranged weapon.
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
      spinBasisDeg: 0, spinRevolutions: 2.5, projectileSpin: true,
      poses: {
        neutral: { x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: 2, roll: -82, shoulderAim: { grip: true, palmNormal: true } },
        windup: { x: 0.41, y: 0.37, z: 0.42, pitch: -180, yaw: 139, bodyYaw: -152, roll: -92, shoulderAim: { grip: false, palmNormal: false } },
        strike: { x: -0.57, y: 0.33, z: 0.17, pitch: -25, yaw: -65, bodyYaw: 63, roll: -88, shoulderAim: { grip: true, palmNormal: false } },
      },
    },
    weaponThrowSpearSpin: {
      name: 'Fishing Spear Throw (Offset Spin)', style: 'chop', sequence: 'attack', gripMode: 'palm-parallel',
      durationS: 1.04, windupFrac: 0.49, strikeFrac: 0.57, holdFrac: 0.82,
      toolEndFlip: true, spinBasisDeg: 90, spinRevolutions: 2.5, projectileSpin: false, projectileLockAlignment: true, projectileBasisDeg: -90,
      poses: {
        neutral: { x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: 2, roll: -82, shoulderAim: { grip: true, palmNormal: true } },
        windup: { x: 0.41, y: 0.37, z: 0.42, pitch: -180, yaw: 139, bodyYaw: -152, roll: -92, shoulderAim: { grip: false, palmNormal: false } },
        strike: { x: -0.57, y: 0.33, z: 0.17, pitch: -25, yaw: -65, bodyYaw: 63, roll: -88, shoulderAim: { grip: true, palmNormal: false } },
      },
    },
    drink: { headRelative: true, poses: { strike: { headRelative: true, x: -0.05, y: 0, z: 0.22, pitch: -180, yaw: 21, roll: 4, bodyYaw: 0 } } },
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
    playerActionState: () => mockPlayerAction,
    update: () => { rangedUpdates++; },
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
let mockPlayerAction = null; // Stands in for RangedWeapons' live playerAction so the held-repeat path can see a throw still animating.
let rangedUpdates = 0;
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
const heldDefaults = { window: {} }; // Run the actual authored definitions before their optional bootstrap dependencies.
const heldDefaultsSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/held-action-animations.js'), 'utf8'); // Reads the production uploaded-pose copy.
vm.runInNewContext(heldDefaultsSource.slice(0, heldDefaultsSource.indexOf('  // Shared direct-hand bootstrap.')) + '\n})();', heldDefaults);
windowObject.HeldActionAnimations.blowgunReady = heldDefaults.window.HeldActionAnimations.blowgunReady;
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
const rangedArchetypeSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/combat/ranged-weapon-archetypes.js'), 'utf8'); // Pins cross-input thrown hold/release ownership without importing old held-pose math.
const fishingSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/fishing-minigame.js'), 'utf8'); // Pins the shared fishing-mace outbound spin source.
const heldActionSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/held-action-animations.js'), 'utf8'); // Pins the user-authored shared throw animation source.
const gripRuntimeSource = fs.readFileSync(path.resolve(__dirname, '../docs/js/procedural-hand-grip-runtime.js'), 'utf8'); // Pins ranged visual support for authored gripMode metadata.
const gameSource = fs.readFileSync(path.resolve(__dirname, '../docs/game.js'), 'utf8'); // Pins the minimal Charged-Breaker-style partial-release seam used by thrown weapons.
const scratchbonesConfigSource = fs.readFileSync(path.resolve(__dirname, '../docs/config/scratchbones-config.js'), 'utf8'); // Pins the exact fixed thrown-release recording.
const attackEditorSource = fs.readFileSync(path.resolve(__dirname, '../docs/tools/attack-animation-editor/index.html'), 'utf8'); // Pins the pick-mining end-flip authoring control/export contract.
const gameIndexSource = fs.readFileSync(path.resolve(__dirname, '../docs/index.html'), 'utf8'); // Pins the game entry-point cache key that must refresh the held-action bootstrap after throw-pivot changes.

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Expected ${name} in runtime source.`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

const loadedVisualEvents = []; // Captures real setLoaded visual dispatch so off-slot weapon state cannot repaint the equipped Dagger.
const loadedStateMap = new Map(); // Mirrors RangedWeapons' per-item loaded map for the isolated setLoaded regression harness.
const setLoadedUnderTest = vm.runInNewContext(
  `(function(deps, playerLoaded) { let lastEvent = null; ${extractNamedFunction(rangedWeaponsSource, 'setLoaded')} return setLoaded; })`,
  {},
)({
  getEquippedRangedKey: () => 'dagger_copper',
  setRangedLoadedVisual: (itemKey, value, owner) => loadedVisualEvents.push({ itemKey, value, owner }),
  refreshActionBar: () => {},
}, loadedStateMap);
setLoadedUnderTest('kylie_copper', false);
assert.strictEqual(loadedStateMap.get('kylie_copper'), false, 'off-slot Kylie loaded state must still be recorded per item.');
assert.strictEqual(loadedVisualEvents.length, 0, 'off-slot Kylie loaded state must not request a visual refresh on the equipped Dagger.');
setLoadedUnderTest('dagger_copper', false);
assert.deepStrictEqual(loadedVisualEvents.map(event => event.itemKey), ['dagger_copper'], 'only the actually equipped Dagger may refresh the player ranged mesh.');

const heldPlane = { material: { map: 'daggerTexture', needsUpdate: false } }; // Synthetic live Dagger plane used to test the game-side item-identity guard.
const heldDaggerMesh = { userData: { itemKey: 'dagger_copper', toolPlane: heldPlane } }; // Synthetic tool mesh mirrors makeToolPlaneMesh's runtime identity metadata.
// setToolMeshLoadedState lives in js/character-held-tools.js (shared by every holder).
const heldToolsWindow = {};
vm.runInNewContext(fs.readFileSync('docs/js/character-held-tools.js', 'utf8'), { window: heldToolsWindow });
Object.assign(heldToolsWindow.CharacterHeldTools.toolTextures, { dagger_copper: 'daggerTexture', kylie_copper: 'kylieTexture' });
const heldVisualHarness = vm.runInNewContext(
  `(function(state) {
    const equipmentSlots = state.equipmentSlots;
    const toolMeshMap = state.toolMeshMap;
    const setToolMeshLoadedState = state.setToolMeshLoadedState;
    ${extractNamedFunction(gameSource, 'setRangedLoadedVisual')}
    return { setRangedLoadedVisual };
  })`,
  {},
)({
  equipmentSlots: { ranged: 'dagger_copper' },
  toolMeshMap: { ranged: heldDaggerMesh },
  setToolMeshLoadedState: heldToolsWindow.CharacterHeldTools.setToolMeshLoadedState,
});
assert.strictEqual(heldVisualHarness.setRangedLoadedVisual('kylie_copper', false), false, 'game-side visual bridge must reject an unequipped Kylie update.');
assert.strictEqual(heldPlane.material.map, 'daggerTexture', 'rejected Kylie update must leave the Dagger texture untouched.');
assert.strictEqual(heldVisualHarness.setRangedLoadedVisual('dagger_copper', false), true, 'matching Dagger loaded-state update must still apply normally.');
assert.strictEqual(heldDaggerMesh.userData.appliedTextureItemKey, 'dagger_copper', 'held mesh debug identity must record the item whose texture was actually applied.');
assert.match(fs.readFileSync('docs/js/character-held-tools.js', 'utf8'), /g\.userData\.itemKey = itemKey/, 'held tool meshes must retain their literal item identity for stale-update rejection and mobile diagnostics.');
assert.match(rangedWeaponsSource, /get heldVisualState\(\) \{ return deps\?\.getHeldRangedVisualState\?\.\(\) \|\| null; \}/, 'ranged debug snapshot must expose equipped\/mesh\/applied texture identity without requiring devtools.');
assert.match(gameSource, /function getWeaponSwingWindupPoseProgress\(\)/, 'game runtime must expose visible linear held-windup progress.');
assert.match(gameSource, /function partialCombatPoseAtCharge\(pose, poseProgress\)/, 'game runtime must support releasing from the currently visible partial pose.');
assert.match(gameSource, /getHeldRangedTexture:[\s\S]*material\?\.map/, 'ranged projectile appearance must source the exact held tool texture.');
assert.match(gameSource, /setHeldRangedVisible:[\s\S]*toolMeshMap\.ranged\.visible/, 'game runtime must expose exact in-hand ranged visibility handoff.');
assert.match(gameSource, /getHeldRangedWorldTransform:[\s\S]*getWorldPosition[\s\S]*getWorldQuaternion[\s\S]*planeWidth[\s\S]*planeHeight/, 'projectiles must sample the rendered held-plane transform and exact geometry at the current release frame.');
assert.match(gameSource, /activeThrownChargeItemKey\?\.\(\)[\s\S]*releaseThrownCharge\?\.\('input-action-release'\)/, 'keyboard/controller Action 1 release must finish the active thrown charge through the shared input path.');
assert.match(gameSource, /desktopHeldItemMousePresses\.delete\(e\.button\)[\s\S]*activeTool === 'ranged'[\s\S]*runInputAction\('action1', 'release', 'mouse:' \+ e\.button\)/, 'desktop mouse release must route a ranged thrown hold through the same shared release path.');
assert.doesNotMatch(rangedArchetypeSource, /pollControllerRelease|controllerBindingFor\('action1'\)|desktopBindingFor\('action1'\)/, 'thrown charges must not have a private controller/keyboard release watcher.');
assert.ok(gameSource.indexOf('updateToolMesh(dt);') < gameSource.indexOf('window.RangedWeapons?.update(dt);'),
  'held tool animation must advance before ranged projectile spawning samples its world transform.');
assert.doesNotMatch(gameSource, /combatSwingOrbitRigCentroid/, 'projectile-only port must not reintroduce the old thrown-pose centroid animation path.');
assert.doesNotMatch(rangedArchetypeSource, /orbitRigCentroid:\s*true/, 'projectile-only port must leave current-main held throw animation ownership intact.');
assert.match(gameSource, /combatSwingAlignToReticle[\s\S]*currentPlayerAimAngle\(\)[\s\S]*currentPlayerAimPitch\(\)/, 'ranged throw/fire animation frames must align to the live reticle yaw and pitch.');
assert.match(gameSource, /const aimPitchRad = -\(reticleFrame\?\.pitchRad \?\? 0\)[\s\S]*_qRangedAimPitch\.setFromAxisAngle\(_xAxis, -aimPitchRad\)/, 'ranged throw visuals must invert only the rendered X-axis pitch so reticle-up tilts the animation up while projectile aim remains unchanged.');
assert.match(gameSource, /const baseEndFlip = spinMesh\?\.userData\?\.toolEndFlipBase === true[\s\S]*const requestedEndFlip = combatSwingAnim \? combatSwingToolEndFlip : \(activeTool === 'ranged'[\s\S]*toolEndFlip === true\)[\s\S]*spinMesh\.rotation\.z = 0[\s\S]*spinPlane\.rotation\.z = \(effectiveEndFlip \? Math\.PI : 0\) \+/, 'runtime Tool End Flip must remain active in the ranged-ready stance and visibly reverse the PNG plane tip-to-handle instead of rolling the parent around weapon length.');
assert.match(attackEditorSource, /const baseEndFlip = toolPlaneMesh\?\.userData\?\.toolEndFlipBase === true[\s\S]*toolPlaneMesh\.rotation\.z = 0[\s\S]*toolPlane\.rotation\.z = \(effectiveEndFlip \? Math\.PI : 0\) \+ sweepBasisZ \+ authoredSpinZ/, 'Attack Editor must preview the same visible in-plane end flip as runtime.');
assert.match(attackEditorSource, /anim\.spinBasisDeg = safeNum\(preset\.spinBasisDeg, 0\)[\s\S]*anim\.spinRevolutions = Math\.max\(0, safeNum\(preset\.spinRevolutions, 0\)\)/, 'Attack Editor action presets must retain held Spin Throw metadata instead of dropping the runtime 360°+ flourish.');
assert.match(attackEditorSource, /toolPlane\.position\.set\(0, 0, 0\)[\s\S]*spinPivotOffsetForTool\?\.\(currentToolKey, authoredSpinZ, 'ranged'\)/, 'Attack Editor must pivot throw spin around the same authored ranged grip as runtime.');
assert.match(heldActionSource, /new URL\('js\/hand-tool-grips\.js\?v=[A-Za-z0-9_-]+', docsBase\)\.href/, 'Held-action bootstrap must cache-bust the shared hand-tool-grips runtime so game/editor receive the current grip/scale contract instead of a stale copy.');
assert.match(gameIndexSource, /held-action-animations\.js\?v=[A-Za-z0-9_-]+/, 'Game entry point must refresh the held-action bootstrap that owns the shared grip helper URL.');
assert.match(attackEditorSource, /held-action-animations\.js\?v=[A-Za-z0-9_-]+/, 'Attack Editor entry point must refresh the same held-action bootstrap before rendering throw spin.');
assert.match(attackEditorSource, /function phasePreviewT\(phase\)[\s\S]*anim\.windupFrac[\s\S]*anim\.strikeFrac[\s\S]*function focusPreviewOnPhase\(phase\)[\s\S]*previewT = phasePreviewT\(phase\)[\s\S]*applyPoseToRig\(anim\.poses\[phase\]\)/, 'Attack Editor Neutral/Windup/Strike selection must place previewT on the exact runtime timeline keyframe before rendering the pose.');
assert.match(attackEditorSource, /anim\.projectileSpin = typeof preset\.projectileSpin === 'boolean'[\s\S]*anim\.projectileLockAlignment = preset\.projectileLockAlignment === true[\s\S]*anim\.projectileBasisDeg = safeNum\(preset\.projectileBasisDeg, 0\)/, 'Attack Editor action presets must preserve fishing-spear projectile alignment metadata alongside held spin metadata.');
assert.match(attackEditorSource, /exported\.spinBasisDeg[\s\S]*exported\.spinRevolutions/, 'Attack Editor exports held spin metadata when present.');
assert.match(attackEditorSource, /anim\.spinBasisDeg = safeNum\(data\.spinBasisDeg,[\s\S]*anim\.spinRevolutions = Math\.max\(0, safeNum\(data\.spinRevolutions,/, 'Attack Editor imports held spin metadata with the selected action as fallback.');
assert.match(attackEditorSource, /id="toolEndFlipBtn"/, 'Attack Animation Editor must expose Tool End Flip directly.');
assert.match(attackEditorSource, /toolEndFlip:\s*anim\.toolEndFlip === true/, 'Attack Animation Editor exports the Tool End Flip bit.');
assert.match(attackEditorSource, /anim\.toolEndFlip = data\.toolEndFlip === true/, 'Attack Animation Editor imports the Tool End Flip bit.');
assert.match(heldActionSource, /name:\s*'Weapon Throw \(Spin\)'/, 'Shared held-action library must expose Weapon Throw (Spin).');
assert.match(heldActionSource, /name:\s*'Fishing Spear Throw \(Offset Spin\)'[\s\S]*toolEndFlip:\s*true[\s\S]*spinBasisDeg:\s*90/, 'Fishing spear shared action must preview the same end-flipped +90-degree held basis that runtime uses.');

assert.match(heldActionSource, /durationS:\s*1\.04[\s\S]*windupFrac:\s*0\.49[\s\S]*strikeFrac:\s*0\.57[\s\S]*holdFrac:\s*0\.82/, 'Weapon Throw (Spin) must retain the supplied authored timing.');
assert.match(heldActionSource, /gripMode:\s*'palm-parallel'/, 'Weapon Throw (Spin) must retain the supplied palm-parallel grip mode.');
assert.match(rangedWeaponsSource, /gripMode:\s*def\.gripMode\s*\|\|\s*null/, 'Ranged action playback must forward authored grip mode metadata.');
assert.match(gripRuntimeSource, /beginHeld:\s*beginHeldMode/, 'Procedural hand grip runtime must expose the held-grip lifecycle to ranged visuals.');
assert.match(rangedWeaponsSource, /grip\?\.beginHeld\?\.\(options\.gripMode\)/, 'Ranged visuals must activate the authored held grip through the shared grip runtime.');
assert.match(rangedWeaponsSource, /function isPlayerThrownFireThroughStrike\(\)[\s\S]*action\?\.kind !== 'fire'[\s\S]*action\.def\?\.rangedType !== 'thrown'[\s\S]*return progress <= strikeBoundary/, 'RangedWeapons must expose a thrown-only Windup\/Strike phase predicate for hand targeting without routing gameplay through __rangedDebug.');
assert.match(rangedWeaponsSource, /playerActionState:\s*\(\) => playerAction/, 'RangedWeapons must expose borrowed live action state for hand interpolation without allocating the __rangedDebug copy.');
assert.match(fishingSource, /projectileVisuals:\s*FISHING_PROJECTILE_VISUALS/, 'Fishing must expose its projectile visual tuning for combat reuse.');
assert.match(rangedWeaponsSource, /Fishing\?\.projectileVisuals\?\.maceSpinRateDeg/, 'Thrown spin must read Fishing\'s authored mace spin rate instead of inventing a separate rate.');
assert.match(rangedWeaponsSource, /textureSource\?\.clone[\s\S]*texture = textureSource\.clone\(\)/, 'Thrown projectiles must clone the exact held texture so metal and verdigris pattern match pixel-for-pixel.');
assert.match(rangedWeaponsSource, /hasExactSourcePlane[\s\S]*new THREE\.PlaneGeometry\(projectilePlaneWidth, projectilePlaneHeight\)/, 'Thrown projectile geometry must use sampled held-plane dimensions when available.');
assert.match(rangedWeaponsSource, /const fallbackEndFlip = !sourceTransform && def\.rangedType === 'thrown' && def\.toolEndFlip === true/, 'Only unsampled fallback thrown projectiles may synthesize the configured visible end flip.');
assert.match(rangedWeaponsSource, /sourceTransform\?\.quaternion\?\.isQuaternion[\s\S]*sourceTransform\.quaternion\.clone\(\)/, 'Sampled player throws must preserve the exact held plane quaternion, including fishing-spear end orientation.');
assert.match(rangedWeaponsSource, /_projectileLocalPlaneZ = new THREE\.Vector3\(0, 0, 1\)[\s\S]*_projectileFallbackEndFlipQuaternion[\s\S]*setFromAxisAngle\(_projectileLocalPlaneZ, Math\.PI\)[\s\S]*baseVisualQuaternion\.multiply\(_projectileFallbackEndFlipQuaternion\)/, 'Unsampled dagger/spear throws must reproduce the held visible tip↔handle reversal around the projectile PNG-plane normal.');
assert.doesNotMatch(rangedWeaponsSource, /uv\.setY\(i, 1 - uv\.getY\(i\)\)/, 'Thrown end flipping must not use a UV mirror; it is a true in-plane rotation consistent with the held weapon.');
assert.match(rangedWeaponsSource, /sourceTransform:\s*heldTransform/, 'Player ranged projectiles must launch from the held plane transform sampled at the current release frame.');
assert.match(rangedWeaponsSource, /projectileVisualWidthWorld:\.5, \/\/ Same 0\.5-unit held-tool plane width/, 'Thrown torch uses the exact held-tool base width, not an unrelated miniature projectile plane.');
assert.match(rangedWeaponsSource, /if \(weaponSprite && !hasExactSourcePlane\) plane\.scale\.y = pendingAspect/, 'Torch height is calculated once from the PNG aspect rather than hard-coded or double applied.');
assert.match(rangedWeaponsSource, /const sourceTransform = heldTransform\?\.position \? \{ position: heldTransform\.position \} : null/, 'Torch retains its hand origin but strips the oversized held transform.');
assert.match(rangedWeaponsSource, /const dir = aim.direction; \/\/ The shared reticle solver converges/, 'Torch uses the reticle solver to converge the camera ray on the held release point.');
assert.match(rangedWeaponsSource, /visualScale: authoredScale, preserveSourceOrientation: false, dungeonFire: true/, 'Torch sprite faces its flight instead of inheriting the held world-facing quaternion.');
assert.match(rangedWeaponsSource, /launchTransformMode[^\n]*'held-strike-plane'/, 'Projectile debug state must identify exact held-plane launch transforms.');
assert.match(rangedWeaponsSource, /facingSource:[^\n]*'sampled-held-plane'/, 'Projectile debug state must report when visible facing came directly from the sampled held weapon.');
assert.match(rangedWeaponsSource, /const swingIndex = 2/, 'Thrown release must select melee swing variant 3 exactly, not a random swing.');
assert.match(rangedWeaponsSource, /combatSfxConfig\?\.\(\)\.weaponSwing3/, 'Thrown release must resolve the weaponSwing3 cue specifically.');
assert.match(rangedWeaponsSource, /playWeaponSlashSfx\?\.\(2, swingIndex\)/, 'Thrown player attacks must play swing 3 at 2x pitch instead of ranged-fire SFX.');
assert.match(scratchbonesConfigSource, /"weaponSwing3"\s*:\s*\{\s*"url"\s*:\s*"assets\/audio\/sfx\/combat\/sfx_swing_3\.mp3"/, 'weaponSwing3 must remain docs/assets/audio/sfx/combat/sfx_swing_3.mp3.');
assert.match(rangedWeaponsSource, /const PROJECTILE_PERP_DEAD_DEG = 15/, 'Thrown weapons and arrows must share the requested 15-degree camera-facing deadzone.');
assert.match(rangedWeaponsSource, /const DEFAULT_PROJECTILE_SPEED_MULTIPLIER = 1\.15/, 'Legacy ranged definitions must retain the existing 15% speed fallback.');
assert.match(rangedWeaponsSource, /const projectileSpeedPxS = def\.speedPxS \* flightStats\.speedMultiplier/, 'Projectile speed must resolve from a generic per-weapon multiplier at launch.');
assert.match(rangedWeaponsSource, /vyWorld: Math\.sin\(pitch\) \* \(projectileSpeedPxS \/ deps\.TILE\)/, 'Initial vertical projectile velocity must use the same authored speed so launch pitch is preserved.');
assert.match(rangedWeaponsSource, /dropStartPx:[\s\S]*projectileGravityWorldS2/, 'Projectile state must cache per-weapon drop-start and downward-acceleration stats.');
assert.match(rangedWeaponsSource, /p\.distancePx > p\.dropStartPx[\s\S]*p\.vyWorld -= p\.projectileGravityWorldS2 \* gravityDt/, 'Downward arc must begin only after the authored straight-line distance and then accelerate continuously.');
assert.match(rangedWeaponsSource, /setFromUnitVectors\(p\.launchDirection, _projectileCurrentFlightDir\)/, 'Projectile visuals must bend with the ballistic path while preserving their sampled held-transform offset.');
assert.match(rangedWeaponsSource, /function embedProjectile\(p, impact\)[\s\S]*p\.embedded = true[\s\S]*disposeProjectileTrails\(p\)/, 'Terrain/cover impacts must convert configured projectiles into stationary embedded visuals instead of destroying them.');
assert.match(rangedWeaponsSource, /DEFAULT_PROJECTILE_EMBED_PERSIST_S = 10/, 'Embedded ranged weapons must persist for ten seconds by default.');
assert.match(rangedWeaponsSource, /DEFAULT_PROJECTILE_MAX_EMBEDDED = 3/, 'Embedded projectile default cap must be three per owner and weapon.');
assert.match(rangedWeaponsSource, /enforceEmbeddedProjectileCap\(p, true\)/, 'Firing a new persistent projectile must reserve a slot immediately so the oldest embedded copy starts fading at the cap.');
assert.match(rangedWeaponsSource, /startProjectileFade\(peers\.shift\(\), 'capacity'\)/, 'The oldest persistent projectile must fade rather than pop when displaced.');
assert.match(rangedWeaponsSource, /projectileHit\(p, sweptTerrainImpact\?\.t \?\? 1\)/, 'Arcing collision must stop actor sweeps at an earlier terrain impact so projectiles cannot hit through the ground.');
assert.match(rangedWeaponsSource, /setHeldRangedVisible\?\.\(action\.itemKey, false\)/, 'Held weapon must hide on the projectile-spawn frame.');
assert.match(rangedWeaponsSource, /restoreHeldThrownWeapon\(action\)/, 'Held weapon must return only when the release action completes back at Neutral.');
assert.match(rangedWeaponsSource, /p\.def\.damage \* falloff \* \(Number\.isFinite\(p\.damageScale\)/, 'Thrown projectile raw damage must multiply by released visible windup percentage.');
assert.doesNotMatch(rangedWeaponsSource, /cameraPitchAxisWorld|fixedPitchAxisWorld/, 'Thrown projectile spin must not derive its axis from the camera or a world-space launch axis.');
assert.match(rangedWeaponsSource, /p\.facePivot\.rotation\.z = p\.spinRad/, 'Spinning thrown weapons must rotate the projectile PNG around its own local Z axis.');
assert.match(gameSource, /const rangedThrowDef = combatSwingAnim === 'ranged'[\s\S]*activeTool === 'ranged'[\s\S]*equipmentSlots\.ranged \|\| spinItemKey[\s\S]*const rangedThrowSpins = rangedThrowDef\?\.rangedType === 'thrown' && rangedThrowDef\?\.heldSpin === true[\s\S]*const rangedThrowDynamicSpinRad =[\s\S]*spinPlane\.rotation\.z = \(effectiveEndFlip \? Math\.PI : 0\) \+ baseRotZ \+ rangedThrowDynamicSpinRad[\s\S]*spinPivotOffsetForTool\?\.\(spinItemKey, rangedThrowDynamicSpinRad, 'ranged'\)/, 'Held Spin Throw must resolve the active ranged definition and pivot its PNG around the authored ranged grip instead of the sprite center.');
assert.match(gameSource, /activeTool === 'adventuring' && equipmentSlots\.adventuring === 'torch'[\s\S]*window\.RangedWeapons\?\.config\?\.torch/, 'adventuring torch Spin Throw shares the ranged animation config rather than duplicating its motion logic');
assert.match(gameSource, /spinPlane\.position\.set\(0, 0, 0\)[\s\S]*rangedThrowSpins/, 'held throw pivot translation must reset every frame so it cannot leak into idle or another action.');
assert.match(rangedWeaponsSource, /p\.facePivot\.rotation\.y = 0;[\s\S]*p\.facePivot\.rotation\.z = p\.spinRad;[\s\S]*return;/, 'Spinning throws must not layer the camera-facing deadzone twist onto local-Z spin.');
assert.match(rangedWeaponsSource, /facePivot\.rotation\.y = p\.faceTwistRad/, 'Non-spinning projectile readability remains isolated to a child long-axis twist.');
assert.match(rangedWeaponsSource, /Math\.abs\(diff\) > PROJECTILE_PERP_DEAD_RAD/, 'Projectile sprite camera-facing must retain the 15-degree deadzone instead of perfect billboarding.');
assert.doesNotMatch(rangedWeaponsSource, /p\.visual\.rotation\.y = p\.pngRot/, 'Legacy whole-projectile camera yaw billboarding must stay removed.');

assert.ok(toolDefs.kylie_copper.slots.includes('ranged'), 'Kylie should be equippable in the ranged slot.');
assert.ok(toolDefs.bshuakauitl_copper.slots.includes('ranged'), "B'shuakauitl should be equippable in the ranged slot.");
for (const key of ['dagger_copper', 'fishingspear_copper', 'hatchet_copper']) {
  assert.ok(toolDefs[key].slots.includes('ranged'), `${key} should be equippable in the ranged slot.`);
  assert.strictEqual(windowObject.RangedWeapons.config[key]?.rangedType, 'thrown', `${key} should use the shared thrown archetype.`);
}
for (const key of ['dagger_copper', 'hatchet_copper', 'kylie_copper']) {
  assert.strictEqual(windowObject.RangedWeapons.config[key]?.projectileVisualStyle, 'spinningWeapon', `${key} should continue the end-over-end Spin Throw tumble in flight.`);
  assert.strictEqual(windowObject.RangedWeapons.config[key]?.projectileSpinSource, 'fishingMace', `${key} should reuse the fishing-mace projectile spin rate.`);
  assert.strictEqual(windowObject.RangedWeapons.config[key]?.projectileSprite, toolDefs[key].sprite, `${key} projectile should use its actual weapon sprite.`);
}
assert.strictEqual(windowObject.RangedWeapons.config.kylie_copper.dmgType, 'blunt', 'Thrown config must carry the weapon\'s melee damage type so its hit sound matches the melee hit.');
assert.strictEqual(windowObject.RangedWeapons.config.dagger_copper.dmgType, 'sharp', 'Thrown weapons without a blunt melee type default to the sharp hit family.');
assert.match(rangedWeaponsSource, /rangedType === 'thrown'\) \{[^}]*playWeaponHitSfx\?\.\(p\.def\.dmgType/, 'Thrown projectile impacts must play the melee weapon-hit sound, not the arrow-hit cue.');
assert.strictEqual(windowObject.RangedWeapons.config.dagger_copper.heldSpin, true, 'Dagger must use the same held Spin Throw twirl as hatchet/Kylie.');
assert.strictEqual(windowObject.RangedWeapons.config.dagger_copper.heldSpinBasisDeg, 0, 'Dagger held spin must use the generic zero-degree spin basis, not the spear offset.');
assert.strictEqual(windowObject.RangedWeapons.config.dagger_copper.heldSpinRevolutions, 2.5, 'Dagger must share the generic 2.5-revolution held throw.');
assert.match(rangedArchetypeSource, /const projectileSpins = animation\?\.projectileSpin !== false[\s\S]*projectileVisualStyle: projectileSpins \? 'spinningWeapon' : 'weapon'[\s\S]*projectileSpinSource: projectileSpins \? 'fishingMace' : null/, 'Generic thrown projectile spin must be driven by the shared Spin Throw animation contract rather than a fragile weapon-name allowlist.');
assert.doesNotMatch(rangedArchetypeSource, /PROJECTILE_SPINNING_THROWN_SHAPES/, 'Thrown projectile spin must not depend on a separate shape allowlist; fishing spear opts out through its dedicated animation.');
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear?.rangedType, 'thrown', 'Mine ghouls must be able to throw the legacy Fishing Spear item, not merely hold it.');
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear?.projectileSprite, toolDefs.fishingspear.sprite, 'Mine spear uses the actual projectile sprite and authored throw animation.');
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear_copper.toolEndFlip, true, 'Fishing spear throw must retain the visible tip-to-handle end flip while using its offset spin.');
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear_copper.projectileVisualStyle, 'weapon', 'Fishing spear must freeze the sampled held alignment after release instead of tumbling in flight.');
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear_copper.projectileSpinSource, null, 'Fishing spear projectile must not receive the generic local-Z tumble.');
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear_copper.projectileLockLaunchAlignment, true, 'Fishing spear projectile must lock the sampled release basis instead of receiving camera readability twist.');
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear_copper.projectileBasisDeg, -90, 'Fishing spear projectile must correct the current 90-degree in-plane mismatch without changing the held throw basis.');
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear_copper.projectileSprite, toolDefs.fishingspear_copper.sprite, 'Fishing spear projectile still uses the real spear sprite.');
assert.strictEqual(windowObject.RangedWeapons.config.kylie_copper.projectileSpeedMultiplier, 1.25, 'Thrown weapons should default slightly faster than the previous 1.15 global pace.');
assert.strictEqual(windowObject.RangedWeapons.config.kylie_copper.projectileDropStartTiles, 6, 'Thrown reticle should remain straight-line accurate for roughly six tiles by default.');
assert.strictEqual(windowObject.RangedWeapons.config.kylie_copper.projectileGravityWorldS2, 8.5, 'Thrown weapons should use the authored default downward acceleration after six tiles.');
assert.strictEqual(windowObject.RangedWeapons.config.kylie_copper.projectileEmbedOnTerrain, true, 'Thrown weapon projectiles should embed in ground/cover by default.');
assert.strictEqual(windowObject.RangedWeapons.config.kylie_copper.projectilePersistS, 10, 'Thrown weapon embeds should live ten seconds including their normal fade.');
assert.strictEqual(windowObject.RangedWeapons.config.kylie_copper.projectileMaxEmbedded, 3, 'Thrown weapon embeds should retain only the newest three by default.');
assert.strictEqual(windowObject.RangedWeapons.config.dagger_copper.projectileSpeedMultiplier, 1.31, 'Per-weapon projectile speed override must flow from TOOL_ITEM_DEFS.');
assert.strictEqual(windowObject.RangedWeapons.config.dagger_copper.projectileDropStartTiles, 4.5, 'Per-weapon reticle-accuracy/drop-start override must flow from TOOL_ITEM_DEFS.');
assert.strictEqual(windowObject.RangedWeapons.config.dagger_copper.projectileGravityWorldS2, 11, 'Per-weapon downward-arc acceleration override must flow from TOOL_ITEM_DEFS.');
assert.strictEqual(windowObject.RangedWeapons.config.dagger_copper.projectilePersistS, 7, 'Per-weapon embedded lifetime override must flow from TOOL_ITEM_DEFS.');
assert.strictEqual(windowObject.RangedWeapons.config.dagger_copper.projectileMaxEmbedded, 2, 'Per-weapon embedded cap override must flow from TOOL_ITEM_DEFS.');
assert.strictEqual(windowObject.RangedWeapons.config.dagger_copper.projectileFadeS, 0.4, 'Per-weapon embedded fade override must flow from TOOL_ITEM_DEFS.');
assert.strictEqual(windowObject.RangedWeapons.config.bshuakauitl_copper.projectileGravityWorldS2, 0, 'Blowguns remain straight-flying unless explicitly authored otherwise.');
assert.strictEqual(windowObject.RangedWeapons.config.bshuakauitl_copper.projectileEmbedOnTerrain, false, 'Blowgun darts do not inherit thrown-weapon terrain embedding by accident.');
for (const key of ['kylie_copper', 'dagger_copper', 'fishingspear_copper', 'hatchet_copper']) {
  const cfg = windowObject.RangedWeapons.config[key];
  assert.ok(Math.abs(cfg.chargeWindupS - 0.5096) < 1e-9, `${key} must use Weapon Throw (Spin)'s 1.04s × 0.49 authored windup.`);
  assert.ok(Math.abs(cfg.fireDurationS - 0.5304) < 1e-9, `${key} release must use the remainder of Weapon Throw (Spin)'s authored duration.`);
  assert.strictEqual(cfg.gripMode, 'palm-parallel', `${key} must use Weapon Throw (Spin)'s authored palm-parallel grip.`);
}
assert.strictEqual(windowObject.RangedWeapons.config.hatchet_copper.chargePose.neutral.roll, -82, 'Hatchet uses Weapon Throw (Spin) exactly as authored.');
assert.strictEqual(windowObject.RangedWeapons.config.kylie_copper.firePose.strike.roll, -88, 'Kylie fire pose uses Weapon Throw (Spin) Strike exactly as authored.');
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear_copper.chargePose.strike.roll, -88, 'Fishing spear release must reach the authored Strike instead of reusing Windup.');
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear_copper.chargePose.strike.pitch, -25, 'Fishing spear holder must perform the authored Windup→Strike pitch rotation on release.');
assert.notStrictEqual(windowObject.RangedWeapons.config.fishingspear_copper.chargePose.strike.yaw, windowObject.RangedWeapons.config.fishingspear_copper.chargePose.windup.yaw, 'Fishing spear Windup and Strike must not collapse to the same holder orientation.');
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear_copper.heldSpin, true, 'Fishing spear must still spin while held during its throw animation.');
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear_copper.heldSpinBasisDeg, 90, 'Fishing spear held spin basis must be 90 degrees counterclockwise from the generic thrown spin.');
assert.strictEqual(windowObject.RangedWeapons.config.fishingspear_copper.heldSpinRevolutions, 2.5, 'Fishing spear should share the generic throw revolution count.');
assert.match(heldActionSource, /weaponThrowSpearSpin[\s\S]*spinBasisDeg:\s*90[\s\S]*projectileSpin:\s*false/, 'Shared held-action library must expose a dedicated 90-degree spear throw whose projectile keeps its release alignment.');
assert.match(heldActionSource, /weaponThrowSpin[\s\S]*windup:[\s\S]*shoulderAim:\s*\{\s*grip:\s*false,\s*palmNormal:\s*true\s*\}[\s\S]*strike:[\s\S]*shoulderAim:\s*\{\s*grip:\s*false,\s*palmNormal:\s*true\s*\}/, 'Thrown Windup and Strike must disable grip-axis targeting while preserving palm-normal targeting in the authored source used by both runtime and editor.');
assert.match(heldActionSource, /weaponThrowSpearSpin[\s\S]*projectileLockAlignment:\s*true[\s\S]*projectileBasisDeg:\s*-90/, 'Fishing spear metadata must keep held alignment locking while applying the projectile-only clockwise quarter-turn correction.');
assert.match(rangedWeaponsSource, /projectileBasisDeg[\s\S]*setFromAxisAngle\(_projectileLocalPlaneZ,[\s\S]*baseVisualQuaternion\.multiply\(_projectileBasisQuaternion\)/, 'Projectile basis correction must rotate the immutable launch frame around the PNG plane normal rather than altering held animation channels.');
assert.match(rangedWeaponsSource, /if \(p\.lockLaunchAlignment\)[\s\S]*p\.facePivot\.rotation\.y = 0;[\s\S]*return;/, 'Locked spear projectiles must bypass the generic camera-readability twist after ballistic frame alignment.');

for (const key of ['dagger_copper', 'fishingspear_copper']) {
  const cfg = windowObject.RangedWeapons.config[key];
  assert.strictEqual(cfg.toolEndFlip, true, `${key} must use the shared 180-degree in-plane tip↔handle reversal.`);
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
assert.strictEqual(windowObject.RangedWeapons.config.bshuakauitl_copper.basicAfflictionScale, 10, 'Blowgun afflictions now scale from independent Attack Power, not two raw damage.');
assert.strictEqual(windowObject.RangedWeapons.config.bshuakauitl_copper.firePose.neutral.pitch, -180, 'Blowgun stance should copy Drink strike pitch.');
const blowgunRest = windowObject.RangedWeapons.config.bshuakauitl_copper.loadPose.neutral; // Unloaded stance is the same thrust rest a shovel idles in outside the weapon slot.
for (const [channel, expected] of Object.entries({ x: 0, y: 0, z: 0, pitch: 10.31, yaw: 0, roll: 0, bodyYaw: 0 })) assert.strictEqual(blowgunRest[channel], expected, `Blowgun unloaded neutral ${channel} should match the shovel's thrust rest.`);
assert.strictEqual(blowgunRest.headRelative, undefined, 'The unloaded rest is hand-relative like a shovel, not head-relative.');

const kylieChoices = windowObject.RangedWeapons.basicAmmoEffectsFor('kylie_copper').map(effect => effect.id);
assert.deepStrictEqual(kylieChoices, ['congealedHealth', 'windedStamina', 'bruisedHealth', 'shatteredStamina', 'knockback'], 'Kylie ranged mastery should expose only blunt-family buildup plus knockback, preserving source ordering.');
for (const phase of ['neutral', 'windup', 'strike']) {
  const pose = windowObject.RangedWeapons.config.bshuakauitl_copper.firePose[phase]; // Loaded idle and firing phases must use their own authored head-relative endpoints.
  assert.equal(pose.headRelative, true);
  for (const key of ['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'bodyYaw']) assert.equal(pose[key], windowObject.HeldActionAnimations.blowgunReady.poses[phase][key]);
}
for (const phase of ['neutral', 'windup', 'strike']) for (const axis of ['x', 'y', 'z']) assert.equal(windowObject.RangedWeapons.config.bshuakauitl_copper.firePose[phase][axis], 0, `the mouthpiece (aperture) sits exactly on the mouth: ${phase}.${axis}`);
assert.equal(windowObject.RangedWeapons.config.bshuakauitl_copper.firePose.windup.yaw, 0);
for (const phase of ['neutral', 'windup', 'strike']) {
  const pose = windowObject.RangedWeapons.config.bshuakauitl_copper.firePose[phase]; // Assert the whole loaded/fire timeline shares the head-directed barrel axis.
  assert.equal(pose.pitch, -180, `Blowgun ${phase} reverses its +Z mouthpiece-end axis to point away from the head`);
  assert.equal(pose.yaw, 0, `Blowgun ${phase} must not aim sideways independently of head rotation`);
  assert.equal(pose.bodyYaw, 0, `Blowgun ${phase} must not turn the body to compensate for misaligned barrel yaw`);
}
assert.equal(windowObject.RangedWeapons.config.bshuakauitl_copper.fireDurationS, 0.475, 'B\'shuakauitl has twice the firing animation speed while keeping its 0.95s authored source untouched.');
assert.equal(windowObject.RangedWeapons.config.bshuakauitl_copper.fireAtFrac, 0.62, 'Blowgun release stays at its authored strike, not ahead of the held pose.');
assert.ok(Math.abs(windowObject.RangedWeapons.config.bshuakauitl_copper.fireDurationS * windowObject.RangedWeapons.config.bshuakauitl_copper.fireAtFrac - 0.2945) < 1e-9, 'Trigger-to-shot latency must be halved from 0.589s.');
assert.equal(windowObject.RangedWeapons.config.bshuakauitl_copper.fireWindupFrac, 0.38);
equippedRanged = 'bshuakauitl_copper';
const blowgunDebug = windowObject.HobunjiRangedWeaponArchetypes.debugSnapshot(); // Verifies the same effective delay is exposed to mobile debugging.
assert.strictEqual(blowgunDebug.blowgunFireSpeedMultiplier, 2);
assert.ok(Math.abs(blowgunDebug.blowgunFireTiming.triggerToShotS - 0.2945) < 1e-9, 'mobile debug must show the actual active trigger-to-shot delay');
assert.equal(blowgunDebug.blowgunFireTiming.reloadDurationS, 1.04, 'loading speed stays unchanged');
equippedRanged = 'kylie_copper'; // Restore the baseline equipped item for the remaining mastery and thrown-weapon tests.
const blowgunChoices = windowObject.RangedWeapons.basicAmmoEffectsFor('bshuakauitl_copper').map(effect => effect.id);
assert.deepStrictEqual(blowgunChoices, afflictionIds, 'Blowgun ranged mastery should expose the full affliction set.');
assert.strictEqual(windowObject.RangedWeapons.setBasicEffect('kylie_copper', 1, 'bleedingHealth'), false, 'Kylie should reject sharp-style Bleeding Health mastery.');
assert.strictEqual(windowObject.RangedWeapons.setBasicEffect('kylie_copper', 1, 'bruisedHealth'), true, 'Kylie should accept Bruised Health mastery.');
assert.strictEqual(windowObject.RangedWeapons.setBasicEffect('bshuakauitl_copper', 1, 'poisonedHealth'), true, 'Blowgun should accept Poisoned Health mastery.');
assert.deepStrictEqual(baseEffectSelections.map(entry => entry.effectId), ['bruisedHealth', 'poisonedHealth']);

// The closure-private ranged payload builder still sees the original effect objects.
// While a Blowgun is equipped, their afflictionId getter emits a projectile-carried
// alias. ResourceSystem resolves that alias at impact and multiplies the normal 0.15
// amount by 10 from the dart's independent 18 Attack Power without increasing Health damage.
equippedRanged = 'bshuakauitl_copper';
const poisonAlias = baseBasicEffects.find(effect => effect.id === 'poisonedHealth').afflictionId;
assert.match(poisonAlias, /^__ranged_blowgun_10x_poisonedHealth$/);
windowObject.ResourceSystem.addAffliction({}, poisonAlias, 2.7); // 18 Attack Power × the ranged system's normal 0.15 mastery coefficient.
assert.strictEqual(addedAfflictions.at(-1).id, 'poisonedHealth');
assert.strictEqual(addedAfflictions.at(-1).amount, 27, 'A low-damage Blowgun dart builds 27 affliction from 18 Attack Power per chosen mastery rank.');

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
assert.strictEqual(rangedVisuals.at(-1).options.pose.strike.roll, -88, 'Thrown hold/release visual must retain the authored Strike endpoint for the post-release rotation.');
assert.strictEqual(rangedVisuals.at(-1).options.gripMode, 'palm-parallel', 'Thrown hold visual must carry the authored palm-parallel grip mode.');
assert.strictEqual(rangedVisuals.at(-1).options.alignToReticle, true, 'Entire thrown animation must use the live reticle frame.');
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

// Holding the input through the end of a throw: a press that lands while the
// previous throw is still animating is queued, and the frame that throw
// returns to Neutral the next held windup begins immediately.
context.document.hidden = false;
mockPlayerAction = { itemKey: 'kylie_copper', kind: 'fire' };
const visualsBeforeRepeat = rangedVisuals.length;
assert.strictEqual(windowObject.RangedWeapons.startPlayerAction('kylie_copper'), false, 'a press during the throw animation cannot start a charge yet.');
assert.strictEqual(windowObject.HobunjiRangedWeaponArchetypes.ownsThrownInput(), true, 'the held press must be queued behind the running throw.');
windowObject.RangedWeapons.update(0.016);
assert.strictEqual(windowObject.HobunjiRangedWeaponArchetypes.debugSnapshot().thrownCharge, null, 'no charge may start while the throw is still animating.');
mockPlayerAction = null; // throw returned to Neutral
windowObject.RangedWeapons.update(0.016);
assert.ok(rangedUpdates >= 2, 'the archetype update wrapper must still run the base ranged update.');
assert.strictEqual(windowObject.HobunjiRangedWeaponArchetypes.activeThrownChargeItemKey(), 'kylie_copper', 'held input must immediately start the next windup on Neutral.');
assert.strictEqual(rangedVisuals.length, visualsBeforeRepeat + 1, 'the repeated hold must start exactly one held windup visual.');
assert.strictEqual(rangedVisuals.at(-1).options.held, true);
windowObject.HobunjiRangedWeaponArchetypes.cancelThrownCharge('test-cleanup');

// Releasing before Neutral drops the queued press instead of starting a charge.
mockPlayerAction = { itemKey: 'kylie_copper', kind: 'fire' };
windowObject.RangedWeapons.startPlayerAction('kylie_copper');
assert.strictEqual(windowObject.HobunjiRangedWeaponArchetypes.releaseThrownCharge('early-release'), false, 'an early release has nothing to throw.');
assert.strictEqual(windowObject.HobunjiRangedWeaponArchetypes.ownsThrownInput(), false, 'an early release must clear the queued hold.');
mockPlayerAction = null;
windowObject.RangedWeapons.update(0.016);
assert.strictEqual(windowObject.HobunjiRangedWeaponArchetypes.activeThrownChargeItemKey(), null, 'a released press must not start a windup on Neutral.');


// NPC registration must not reset an unrelated player's loaded state or repaint their UI.
{
  const archetypes = windowObject.HobunjiRangedWeaponArchetypes;
  const oldConfig = windowObject.RangedWeapons.config.bshuakauitl_copper;
  const oldRefresh = windowObject.Combat.deps.refreshActionBar;
  let refreshes = 0;
  windowObject.Combat.deps.refreshActionBar = () => { refreshes++; };
  loaded.set('bshuakauitl_copper', false);
  loaded.set('kylie_copper', true);
  const before = archetypes.debugSnapshot().reusedNpcRegistrations;
  for (let i=0;i<5;i++) archetypes.patchGeneratedDefinitions({npcOnly:true, keys:['bshuakauitl_copper']});
  assert.strictEqual(windowObject.RangedWeapons.config.bshuakauitl_copper,oldConfig);
  assert.strictEqual(loaded.get('bshuakauitl_copper'),false);
  assert.strictEqual(loaded.get('kylie_copper'),true);
  assert.strictEqual(refreshes,0);
  assert.ok(archetypes.debugSnapshot().reusedNpcRegistrations >= before+5);
  const oldDef=toolDefs.bshuakauitl_copper;
  toolDefs.bshuakauitl_copper={...oldDef,label:'Replacement Blowgun'};
  archetypes.patchGeneratedDefinitions({npcOnly:true,keys:['bshuakauitl_copper']});
  assert.strictEqual(windowObject.RangedWeapons.config.bshuakauitl_copper.label,'Replacement Blowgun');
  assert.strictEqual(loaded.get('bshuakauitl_copper'),false);
  toolDefs.bshuakauitl_copper=oldDef;
  archetypes.patchGeneratedDefinitions();
  assert.strictEqual(loaded.get('bshuakauitl_copper'),false,'explicit authored rebuild also preserves player state');
  windowObject.Combat.deps.refreshActionBar=oldRefresh;
}

// Missing user-authored animation must NOT fall back to Drink's angled pose.
// Run after the NPC idempotence checks; explicit rebuilds honor authored pose changes.
{
  const original = windowObject.HeldActionAnimations.blowgunReady; // Restored below for any subsequent shared test initialization.
  windowObject.HeldActionAnimations.blowgunReady = null;
  windowObject.HobunjiRangedWeaponArchetypes.patchGeneratedDefinitions();
  const fallback = windowObject.RangedWeapons.config.bshuakauitl_copper.firePose; // Direct generated-weapon test, not a copy of the default constant.
  for (const phase of ['neutral', 'windup', 'strike']) {
    assert.strictEqual(fallback[phase].yaw, 0, `missing blowgun animation must never restore Drink's off-axis ${phase} yaw`);
    assert.strictEqual(fallback[phase].pitch, -180, `missing blowgun animation ${phase} keeps its fixed mouthpiece-end reversal`);
    assert.strictEqual(fallback[phase].headRelative, true, `missing blowgun animation ${phase} remains anchored to the mouth`);
  }
  assert.strictEqual(windowObject.HobunjiRangedWeaponArchetypes.debugSnapshot().blowgunStanceSource, 'blowgun-head-forward-fallback');
  windowObject.HeldActionAnimations.blowgunReady = original;
  windowObject.HobunjiRangedWeaponArchetypes.patchGeneratedDefinitions();
  assert.strictEqual(windowObject.HobunjiRangedWeaponArchetypes.debugSnapshot().blowgunStanceSource, 'blowgun-authored-mouth-to-reticle');
}


// Exercise the actual torch release function in isolation: the held world-space quaternion
// must not affect its flight vector, geometry, or scale.
{
  const start = rangedWeaponsSource.indexOf('  function throwAdventuringTorch(visual = null) {');
  const end = rangedWeaponsSource.indexOf('\n  function spawnVolley(', start);
  assert(start >= 0 && end > start, 'shipping torch throw function is extractable');
  const shots = []; // Exact spawn calls made by the real torch code under test.
  let rayDirection = { x: 0, y: 0, z: -1 }; // Camera forward changes independently of the held torch's pose.
  let cameraAvailable = true; // Checks the ordinary controller/camera-less fallback.
  const cameraOrigin = { x: 4.5, y: 1.2, z: 6 }; // Camera lies off the torch's actual muzzle: parallel rays would miss the reticle.
  const muzzle = { x: 3, y: 1.2, z: 4 }; // Shared release origin passed through the normal reticle solver.
  const solvedAim = () => {
    if (!cameraAvailable) return { origin: muzzle, direction: { x: 1, y: 0, z: 0 }, targetPoint: null };
    const point = { x: cameraOrigin.x + rayDirection.x * 10, y: cameraOrigin.y + rayDirection.y * 10, z: cameraOrigin.z + rayDirection.z * 10 }; // The camera-ray reticle target in world coordinates.
    const dx = point.x - muzzle.x, dy = point.y - muzzle.y, dz = point.z - muzzle.z;
    const norm = Math.hypot(dx, dy, dz); // Normalizes the converged muzzle-to-reticle trajectory just as the shared solver does.
    return { origin: muzzle, direction: { x: dx/norm, y:dy/norm, z:dz/norm }, targetPoint: point };
  };
  const torchWorld = {
    WeaponToolStances: { poses: { torchHold: { scale: 0.68 } } },
    HobunjiRangedCameraFocus: { invalidateAimTarget() {} },
  };
  const torchContext = vm.createContext({
    window: torchWorld,
    deps: { player: {}, TILE: 64, getPlayerAimRay: () => cameraAvailable ? { origin: cameraOrigin, direction: rayDirection } : null },
    playerAimSolution: solvedAim,
    spawnProjectile: (...args) => {
      shots.push(args);
      return {
        mesh: { position: { x: 3, y: 1.2, z: 4 },
          userData: { projectilePlane: { geometry: { parameters: { width: .5, height: .5 * 1204 / 450 } } } } },
        visual: { scale: { x: args[8].visualScale } }, launchTransformMode: 'flight-frame',
      };
    },
    playRangedActionSfx() {},
    Math, Number,
  });
  vm.runInContext('let lastTorchThrow = null;\n' + rangedWeaponsSource.slice(start, end), torchContext);
  const held = { textureSource: { id: 'tinted-torch' },
    sourceTransform: { position: { x: 3, y: 1.2, z: 4 }, quaternion: { x: .2, y: .4 },
      planeWidth: 7, planeHeight: 12, scale: { x: 15, y: 15, z: 15 } } };
  torchContext.held = held;
  assert(vm.runInContext('throwAdventuringTorch(held)', torchContext), 'camera-facing throw succeeds');
  assert(Math.abs(shots[0][3] - Math.atan2(-8, 1.5)) < 1e-9, 'torch converges on the reticle from an offset hand, rather than shooting parallel to camera -Z');
  assert.notStrictEqual(shots[0][3], -Math.PI/2, 'parallax correction must not be lost between aiming and launch');
  assert.strictEqual(vm.runInContext('lastTorchThrow.aimSource', torchContext), 'camera-reticle', 'mobile diagnostics identify real reticle convergence');
  assert.strictEqual(vm.runInContext('lastTorchThrow.targetPoint.x', torchContext), 4.5, 'reticle target is retained for on-device debugging');
  assert.strictEqual(shots[0][8].preserveSourceOrientation, false, 'torch flight does not retain world-facing held quaternion');
  assert.strictEqual(shots[0][8].visualScale, .68, 'torch projectile uses the idle Neutral multiplier');
  assert.strictEqual(vm.runInContext('lastTorchThrow.planeWidth', torchContext), .5, 'throw debug records the same base width as game.js held tool art');
  assert.strictEqual(shots[0][8].sourceTransform.position.x, 3, 'launch still begins at the held strike position');
  assert.strictEqual(Object.keys(shots[0][8].sourceTransform).join(','), 'position', 'held scale/rotation/plane dimensions never leak into projectile art');
  assert.strictEqual(shots[0][8].textureSource, held.textureSource, 'colored held torch texture is reused');
  rayDirection = { x: 0, y: .6, z: .8 };
  vm.runInContext('throwAdventuringTorch(held)', torchContext);
  assert(Math.abs(shots[1][7] - Math.atan2(6, Math.hypot(1.5, 10))) < 1e-9, 'height and camera-to-muzzle offset both affect throw pitch');
  cameraAvailable = false;
  vm.runInContext('throwAdventuringTorch(held)', torchContext);
  assert.strictEqual(shots[2][3], 0, 'camera-less fallback uses the existing solver direction');
  assert.strictEqual(vm.runInContext('lastTorchThrow.aimSource', torchContext), 'fallback-facing', 'Pixel Probe records the camera-less fallback source');
  console.log('torch muzzle-to-reticle convergence, elevation, scale isolation, fallback, and mobile debug regression checks passed');
}

// The actual shared aim solver must never inherit a stale ranged-slot ray for an adventuring torch.
// A previous camera wrapper could keep an equipped ranged weapon's -X heading while the live reticle turned.
{
  class TorchVector3 {
    constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
    clone(){return new TorchVector3(this.x,this.y,this.z);}
    addScaledVector(other,scale){this.x+=other.x*scale;this.y+=other.y*scale;this.z+=other.z*scale;return this;}
    sub(other){this.x-=other.x;this.y-=other.y;this.z-=other.z;return this;}
    dot(other){return this.x*other.x+this.y*other.y+this.z*other.z;}
    lengthSq(){return this.dot(this);}
    length(){return Math.sqrt(this.lengthSq());}
    normalize(){const len=this.length()||1;this.x/=len;this.y/=len;this.z/=len;return this;}
  }
  const cameraPosition={x:0,y:1,z:0}; // Camera-center ray stays separate from the hand and from the ranged-slot's old aim.
  let centeredDirection={x:0,y:0,z:1}; // Change this between cardinal directions without changing the stale ranged ray.
  let centeredAvailable=true; // A missing centered ray must still preserve ordinary aim fallback.
  const heldPosition={x:.25,y:1,z:0}; // Off-center launch point tests proper camera-to-hand convergence.
  const aimContext=vm.createContext({
    THREE:{Vector3:TorchVector3,MathUtils:{clamp:(value,min,max)=>Math.max(min,Math.min(max,value))}},
    AIM_EPSILON:1e-6,
    deps:{player:{},hostileObjects:[],getCurrentArea:()=>'cave',getPlayerInteractionRay:()=>centeredAvailable?{
      origin:cameraPosition,direction:centeredDirection,
    }:null,getPlayerAimRay:()=>({origin:cameraPosition,direction:{x:-1,y:0,z:0}}),
    getPlayerAimAngle:()=>Math.PI/2,getPlayerAimPitch:()=>0,TILE:64},
    defFor:()=>({rangeTiles:7}),
    playerProjectileOrigin:(_key,source)=>new TorchVector3(source.x,source.y,source.z),
    projectileAimRadiusWorld:()=>.15,
    segmentHitboxInterval:()=>null,actorHitbox:()=>null,
    Math,Number,
  });
  vm.runInContext(extractNamedFunction(rangedWeaponsSource,'normalizedAimRay')+'\n'
    +extractNamedFunction(rangedWeaponsSource,'playerAimSolution')+'\nthis.solveTorchAim=playerAimSolution;',aimContext);
  const headings=[
    ['east',{x:1,y:0,z:0},'x',1],
    ['west',{x:-1,y:0,z:0},'x',-1],
    ['north',{x:0,y:0,z:-1},'z',-1],
    ['south',{x:0,y:0,z:1},'z',1],
  ];
  for(const [label,heading,axis,sign] of headings){
    centeredDirection=heading;
    const aim=aimContext.solveTorchAim('torch',heldPosition);
    assert.equal(aim.cameraRaySource,'camera-centered-interaction',label+' uses the current reticle camera ray');
    assert(aim.direction[axis]*sign>.95,'thrown torch follows '+label+' instead of a stale west-facing ranged ray');
    assert.equal(aim.origin.x,.25,'launch and convergence use the same actual held position');
    const ordinary=aimContext.solveTorchAim('crossbow',heldPosition);
    assert(ordinary.direction.x<-.95,'other ranged weapons retain the existing ranged-focus callback');
  }
  centeredDirection={x:0,y:.6,z:.8};
  assert(aimContext.solveTorchAim('torch',heldPosition).direction.y>.4,'a raised camera pitch changes the torch elevation');
  centeredAvailable=false;
  const fallback=aimContext.solveTorchAim('torch',heldPosition);
  assert.equal(fallback.cameraRaySource,'facing-fallback','a missing camera ray falls back to player facing, never the stale ranged-slot ray');
  assert(fallback.direction.z>.95,'camera-less torch throws follow player facing instead of the westward equipped ranged ray');
  console.log('torch aim chooses live camera-centered east/west/north/south/pitch rather than stale equipped-ranged slot');
}
