// Run with node scripts/test-adventuring-tools.js
// Covers state, save migration, fire gating and the cross-system wiring without a browser.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

class Vector3 {
  copy(other) { return Object.assign(this, other); }
}
class Box3 {
  setFromObject(object) { this.object = object; return this; }
  isEmpty() { return false; }
}

let activeTool = 'adventuring', heldMode = 'tool', area = 'farm';
let fireContacts = 0, tentContacts = 0, ruinContacts = 0, throws = 0, persisted = [];
let covered = false;
let throwBeginCount = 0, throwCancelCount = 0, throwReleasePose = null; // Track press/release/cancel against the shared held pose.
let heldTorchVisible = true; // Test the hatchet's hide-at-strike and restore-at-recovery ownership.
let heldTorchMeshAvailable = true; // Exercises the throw recovery path before a torch PNG has loaded.
let lastThrowOptions = null; // Confirms that a real release provides its tool-plane sample to the projectile owner.
const torchVisual = { textureSource: {key:'torch-png'}, sourceTransform: {position:{x:1,y:2,z:3},quaternion:{},planeWidth:.5,planeHeight:1} }; // Test-only held torch visual passed through unchanged.
const player = { x: 0, y: 0 };
const scene = { children: [] };
const campProps = { children: [], parent: scene };
const campfire = { name: 'bandit campfire', userData: { fireHazard: true }, parent: campProps, inCone: true };
campProps.children.push(campfire);
const brazier = { name: 'ruin brazier', parent: scene, inCone: true };
const nearEnemy = { health: 8, areaId: 'farm', inCone: true };
const sideEnemy = { health: 8, areaId: 'farm', inCone: true };
const farEnemy = { health: 8, areaId: 'farm', inCone: false };
const hits = [];
const forehandStep = { anim: 'sweep', dirSign: 1, windupS: .345, strikeS: .07, holdS: .43,
  rangeMul: 1, halfConeDeg: 26, damageMul: 1, knockbackMul: .45 };
const world = {
  Combat: {
    deps: {
      player, TILE: 64, hostileObjects: [nearEnemy, sideEnemy, farEnemy],
      weaponAbility: () => ({ rangePx: 128, damage: 6, knockbackPxS: 360 }),
      damageCreature: target => { hits.push(target); },
    },
    comboData: { swingCombo: [forehandStep], RANGE_SCALE: .6 },
    comboStepPose: () => world.AttackPoseTemplates.poseFor('hatchet_swing'),
    isStaggered: () => false,
    meleeHit(attacker, target, options) {
      assert.equal(attacker, player);
      const object = target || options.targetBox.object;
      return object.inCone && (!options.acceptPoint || options.acceptPoint({}, {}));
    },
  },
  NearbyVolumeCollision: { segmentHit: () => covered ? { t: .25, object: {} } : null },
  DungeonFire: { contactMelee() { fireContacts++; } },
  BanditCamps: { igniteTorchMelee() { if (area === 'farm') tentContacts++; } },
  DevRandomRuinHitPuzzles: {
    touchesIgnitionSource(matches) { return area === 'ruin' && matches(brazier); },
    contactTorchMelee() { if (area === 'ruin') ruinContacts++; },
  },
  RangedWeapons: { throwAdventuringTorch(visual) { lastThrowOptions=visual; throws++; return { itemKey:'torch' }; } },
  HeldActionAnimations: { weaponThrowSpin: { durationS: 1.04, windupFrac: .49, strikeFrac: .57, holdFrac: .82, poses: { neutral:{}, windup:{}, strike:{} } } },
  CharacterMetaSave: { update(callback) { const ch = {}; callback(ch); persisted = ch.adventuringToolUnlocks; } },
};
const context = vm.createContext({ window: world, performance: { now: () => 1000 } });
for (const script of ['docs/js/combat/attack-pose-templates.js', 'docs/js/combat/weapon-shape-stats.js', 'docs/js/adventuring-tools.js']) {
  vm.runInContext(read(script), context);
}
const torch = world.AdventuringTools;
const deps = {
  THREE: { Vector3, Box3 },
  getActiveTool: () => activeTool, getHeldMode: () => heldMode,
  getEquippedTool: () => 'torch', getUnlocked: () => [], getCurrentArea: () => area,
  getActiveScene: () => scene, getMeleeAimDirection: () => ({ x: 1, y: 0, z: 0 }),
  refreshActionBar() {}, selectTorch() { activeTool = 'adventuring'; },
  beginThrowVisual(duration, opts) { throwBeginCount++; assert.equal(duration, 1.04); assert.equal(opts.held, true); return true; },
  getThrowPoseProgress: () => 0.65,
  getTorchProjectileVisual: () => torchVisual, // Mirrors the game-owned visual snapshot at actual release.
  releaseThrowVisual(opts) { throwReleasePose = opts.poseProgress; },
  cancelThrowVisual() { throwCancelCount++; },
  setHeldTorchVisible(visible) { if (!heldTorchMeshAvailable) return false; heldTorchVisible=visible;return true; }, // Same runtime toolMeshMap visibility toggle; absent sprite is a supported fallback.
};
torch.init(deps);
const forehand = world.AttackPoseTemplates.poseFor('hatchet_swing');
const visual = torch.forehandSwingVisual();
assert.equal(visual.options.toolSlot, 'adventuring');
assert.equal(visual.options.anim, 'sweep');
assert.equal(visual.durationS, (.345 + .07) / 1.05, 'torch uses longsword forehand speed');
assert.equal(visual.options.strikeFrac, 1);
assert.deepEqual(visual.options.pose, forehand, 'the shared stance hook receives the same pose as weapon Forehand');
assert.equal(visual.options.lungeMul, undefined, 'torch does not inherit the combat lunge');
assert.equal(visual.options.coneRangePx, 128 * .6 * 1.2);
const cone = { rangePx: visual.options.coneRangePx, halfConeRad: visual.options.coneHalfConeRad,
  angle: visual.options.coneAngle, pitch: visual.options.conePitch };
assert.deepEqual(Array.from(torch.entries(), entry => entry.id), ['torch']);
assert.equal(torch.isLit(), false);
assert.equal(torch.canThrow(), false);
assert.equal(torch.swingAtAim(cone).ok, true);
assert.equal(torch.isLit(), false);
assert.deepEqual(hits, [nearEnemy, sideEnemy], 'a single impact can hit multiple hostiles within the melee cone');
scene.children.push(campProps);
campfire.inCone = false;
torch.swingAtAim(cone);
assert.equal(torch.isLit(), false, 'a fire hazard outside melee reach cannot light the torch');
campfire.inCone = true;
covered = true;
torch.swingAtAim(cone);
assert.equal(torch.isLit(), false, 'cover blocks contact with a fire hazard');
covered = false;
campProps.visible = false;
torch.swingAtAim(cone);
assert.equal(torch.isLit(), false, 'hidden camps are not ignition sources');
campProps.visible = true;
assert.equal(torch.swingAtAim(cone).ok, true);
assert.equal(torch.isLit(), true, 'a tagged wilderness fire lights the torch even with no interaction object');
assert.equal(fireContacts, 1);
assert.equal(tentContacts, 1);
assert.equal(torch.canThrow(), true);
assert.equal(torch.beginThrow('test-action2'), true, 'press starts the held throw windup');
assert.equal(torch.debug.throwCharging, true);
assert.equal(torch.beginThrow('test-duplicate'), false, 'duplicate press cannot create an extra charge');
assert.equal(throws, 0, 'no projectile launches during the hold');
assert.equal(torch.isLit(), true, 'the flame stays lit while charging');
assert.equal(torch.releaseThrow('test-release').ok, true, 'input release enters the strike without immediately launching');
assert.equal(throwBeginCount, 1);
assert.equal(throwReleasePose, 0.65, 'strike begins at the actual authored held pose amplitude');
assert.equal(torch.debug.throwCharging, false);
assert.equal(torch.debug.throwPending, true);
assert.equal(torch.releaseThrow('duplicate').ok, false, 'duplicate input release is ignored');
assert.equal(throws, 0, 'a torch must never spawn before the authored Strike pose');
assert.equal(torch.isLit(), true, 'the held torch remains lit through its visible strike');
torch.updateThrow({active:true,progress:.55,strikeFrac:.57});
assert.equal(throws, 0, 'sweeping through windup cannot launch early');
torch.updateThrow({active:true,progress:.57,strikeFrac:.57});
assert.equal(throws, 1, 'the real Strike boundary launches exactly one projectile');
assert.equal(lastThrowOptions, torchVisual, 'the strike forwards the exact held-plane sprite and world transform');
assert.equal(torch.debug.throwLaunchOrigin, 'held-plane', 'mobile diagnostics identify the release-frame transform');
assert.equal(torch.debug.throwRecovering, true);
assert.equal(heldTorchVisible, false, 'spent held torch is hidden while the thrown copy exists');
assert.equal(torch.isLit(), false);
torch.updateThrow({active:true,progress:.74,strikeFrac:.57});
assert.equal(throws, 1, 'subsequent strike frames do not duplicate the throw');
torch.updateThrow({active:true,progress:1,strikeFrac:.57});
assert.equal(heldTorchVisible,true,'the unlit replacement reappears after returning to neutral');
assert.equal(torch.isThrowSequenceActive(),false);
assert.equal(torch.throwLit().ok, false);
area = 'ruin';
scene.children.length = 0;
brazier.inCone = false;
torch.swingAtAim(cone);
assert.equal(torch.isLit(), false, 'ruin source must intersect the melee volume');
brazier.inCone = true;
torch.swingAtAim(cone);
assert.equal(torch.isLit(), true);
assert.equal(ruinContacts, 1, 'lit melee contact reaches the ruin puzzle owner');
assert.equal(torch.beginThrow('test-cancel'), true);
torch.stow();
assert.equal(throwCancelCount, 1, 'stowing cancels a charged throw');
assert.equal(torch.releaseThrow('stowed').ok, false);
assert.equal(throws, 1, 'canceling a held throw does not launch a projectile');
assert.equal(torch.isLit(), true, 'a charged throw cancels on stow but the flame survives on the belt');
assert.equal(torch.light(), false, 'stowing does not allow a duplicate relight or reset the clock');
assert.equal(torch.beginThrow('test-cancel-pending'), true);
assert.equal(torch.releaseThrow('test-pending-release').ok, true);
assert.equal(torch.debug.throwPending, true);
torch.stow();
torch.updateThrow({active:true,progress:.7,strikeFrac:.57});
assert.equal(throws, 1, 'stowing after input release but before strike cancels the deferred projectile');
assert.equal(torch.isThrowSequenceActive(), false);
assert.equal(heldTorchVisible,true);
heldTorchMeshAvailable=false;
torch.light();
assert.equal(torch.beginThrow('test-no-held-sprite'),true);
assert.equal(torch.releaseThrow('test-sprite-release').ok,true);
torch.updateThrow({active:true,progress:.57,strikeFrac:.57});
assert.equal(throws,2,'projectile still launches without a loaded held torch mesh');
assert.equal(torch.debug.throwRecovering,true,'an unavailable sprite must not prematurely end the throw sequence');
assert.equal(torch.debug.throwHeldHidden,false,'the missing sprite is not marked as hidden');
torch.updateThrow({active:true,progress:1,strikeFrac:.57});
assert.equal(torch.debug.throwRecovering,false);
heldTorchMeshAvailable=true;
assert.equal(torch.register({ id:'lantern',label:'Lantern',onSelect() {} }), true);
assert.equal(torch.entries().length, 1); // Registered is not synonymous with unlocked.
assert.equal(torch.unlock('lantern'), true);
assert.deepEqual(Array.from(persisted), ['lantern']); // Normalize VM-origin arrays before asserting.
assert.equal(torch.entries().length, 2);
torch.init({ ...deps, getUnlocked: () => ['lantern'] });
assert.equal(torch.entries().length, 2);
assert.equal(torch.isLit(), false);
heldMode = 'item';
assert.equal(torch.canThrow(), false);

const game = read('docs/game.js');
const rangedCode = read('docs/js/combat/ranged-weapons.js'); // Static integration checks accompany the independent state-machine mock.
const damageStart = game.indexOf('      function damageCreature('); // Execute the real ingress checks before constructing the unrelated damage dependencies.
const damageGateEnd = game.indexOf('        const damageSource =', damageStart);
assert(damageStart >= 0 && damageGateEnd > damageStart);
const damageGate = vm.createContext({
  window: { RangedWeapons: { meleeReachCheck: (attacker, target) => ({
    reachable: target.verticalGap <= 0.4, verticalGap: target.verticalGap, allowance: 0.4,
  }) } },
  performance: { now: () => 100 }, player, TILE: 64, heldMode: 'tool',
  activeTool: 'adventuring', lastMeleeHeightBlock: null,
});
vm.runInContext(game.slice(damageStart, damageGateEnd) + 'return true; } return true; }', damageGate);
const torchHit = { abilityId: 'torch_swing' };
assert.equal(damageGate.damageCreature({ verticalGap: 0.8 }, 6, 0, 0, 0, torchHit), false,
  'torch contact honors the same final vertical reach gate as a melee weapon');
assert.equal(damageGate.lastMeleeHeightBlock.verticalGap, 0.8);
assert.equal(damageGate.damageCreature({ verticalGap: 0.4 }, 6, 0, 0, 0, torchHit), true,
  'a height gap at the weapon reach tolerance still allows a torch hit');
assert.equal(damageGate.damageCreature({ verticalGap: 0.8 }, 6, 0, 0, 0, { ranged: true }), true,
  'the held torch cannot impose melee reach on a projectile hit');
const torchActionStart = game.indexOf("const torchVisual = activeTool === 'adventuring'"); // The central action dispatch must start the forehand before queuing the physical contact.
const torchActionQueued = game.indexOf('pendingAction = { col: reticle.col, row: reticle.row, action: activeAction, tool: activeTool };', torchActionStart);
assert(torchActionStart >= 0 && torchActionQueued > torchActionStart, 'torch action queues contact after selecting its visual');
const torchDispatch = game.slice(torchActionStart, torchActionQueued);
assert(torchDispatch.includes('synchronizedSwing.call(window.Combat.deps, torchVisual.durationS, torchVisual.options)'), 'torch uses the shared hand-grip/visual clock when available');
assert(torchDispatch.includes('else triggerWeaponSwingVisual(torchVisual.durationS, torchVisual.options)'), 'fallback is present before combat hooks initialize');
assert(game.includes("authoredToolActionActive = activeTool !== 'weapon' && toolSwingT > 0"), 'all tool strokes, including torch, suppress idle stance while active');
assert(game.includes("opts.toolSlot === 'adventuring'"), 'visual trigger only permits explicitly tagged adventuring poses');
const arc = read('docs/js/action-arc-ui.js');
const ranged = read('docs/js/combat/ranged-weapons.js');
const bandits = read('docs/js/bandit-camps.js');
const assets = read('docs/config/weapon-sprite-assemblies.js');
const effects = read('docs/js/weapon-layer-effects.js');
const stances = read('docs/js/weapon-tool-stances.js');
const editor = read('docs/tools/attack-animation-editor/index.html');
const index = read('docs/index.html');
const grip = read('docs/js/hand-tool-grips.js');
const neutral = JSON.parse(read('docs/config/combat/weapon-idle-stances.json'));
assert.match(game, /adventuring: \['torch_swing', 'torch_throw'\]/);
assert.match(game, /getTorchProjectileVisual: \(\) =>/, 'game supplies the actual held torch texture and world transform');
assert.match(rangedCode, /projectileSprite:'assets\/toolsprites\/torch\.png', projectileVisualStyle:'spinningWeapon'/,
  'torch uses the thrown hatchet end-over-end spin');
assert.match(rangedCode, /textureSource, sourceTransform, visualScale: authoredScale, preserveSourceOrientation: false, dungeonFire: true/,
  'torch keeps its burning projectile payload while using bounded idle scale and direction-aligned artwork');
assert.match(rangedCode, /const sourceTransform = heldTransform\?\.position \? \{ position: heldTransform\.position \} : null/,
  'torch uses the held release point without copying the oversized held orientation or geometry');
assert.match(rangedCode, /heldSpin:true,heldSpinRevolutions:2\.5/, 'torch now shares the thrown hatchet in-hand spin');
assert.match(rangedCode, /invalidateAimTarget\?\.\('torch-strike-release', true\)/, 'torch samples a fresh strike-frame reticle like the hatchet');
assert.match(game, /AdventuringTools\.updateThrow\(\{/, "torch projectile commits only from the active pose's strike frame");
assert.match(game, /holdTorchAim/, 'touch keeps its throw aim after input release through the actual strike');
assert.match(game, /torchThrowActionPresses\.delete\(actionId\)/, 'controller and keyboard release preserve throw input ownership');
assert.match(game, /_torchThrowPress = act === 'torch_throw'/, 'touch pointer starts a held throw');
assert.match(game, /AdventuringTools\?\.releaseThrow\?\.\('touch-arch-release'\)/, 'mobile releases commit');
assert.match(game, /AdventuringTools\?\.cancelThrow\?\.\('touch-pointer-cancel'\)/, 'touch cancellation never fires');
assert.match(game, /beginThrowVisual: \(durationS, options\)/, 'torch reuses the common held visual timeline');
assert.match(game, /window\.AdventuringTools\?\.swingAtAim\(combatSwingCone\)/);
assert.match(game, /equipmentSlots\.adventuring = 'torch'/);
assert.match(game, /adventuringToolActionButtons\(\)/);
assert.match(arc, /\['adventuringGateway',\.\.\.deps\.WHEEL_SLOTS/);
assert.match(arc, /_openAdventuringArc\(\)/);
assert.match(ranged, /function throwAdventuringTorch\(visual = null\)/, 'torch accepts the held sprite snapshot for the hatchet launch path');
assert.match(ranged, /projectileSprite:'assets\/toolsprites\/torch\.png', projectileVisualStyle:'spinningWeapon'/, 'torch uses the hatchet projectile tumble');
assert.match(ranged, /dungeonFire:\s*true/, 'torch remains a permanent burning projectile independent of its aim/visual transform');
assert.match(ranged, /DevRandomRuinHitPuzzles\?\.contactAdventuringTorchSegment/);
assert.match(bandits, /igniteTorchSegment\(/);
assert.match(bandits, /igniteAimedTentWithTorch\(/);
assert.match(assets, /torch: \{[\s\S]*?litOnly: true/);
assert.match(effects, /fx\.config\.litOnly/);
const recipeWindow = {};
vm.runInNewContext(assets, { window: recipeWindow });
const recipes = recipeWindow.WEAPON_SPRITE_ASSEMBLY_CONFIG.weapons;
assert.equal(recipes.torch.base.targetHex, recipes.hachutuTorchStaff.base.targetHex);
const torchFire = recipes.torch.base.vfx;
const staffFire = recipes.hachutuTorchStaff.base.vfx;
assert.equal(torchFire.fixedMasteryRank, 5);
assert.equal(torchFire.masteryClusters, 1);
assert.equal(torchFire.rate, staffFire.rate / staffFire.masteryClusters);
for (const key of ['size', 'life', 'speed', 'worldRise', 'visualScale', 'masteryFocus', 'blendMode', 'opacity']) {
  assert.equal(torchFire[key], staffFire[key], `torch shares staff tip's ${key}`);
}
assert.match(read('docs/js/weapon-sprite-assemblies.js'), /if \(modularShaft && modularShaft\.fireAssembly === def\?\.shapeKey/,
  'a rigid torch without a shape or modular shaft must reach base-sprite recolor and fire setup');
assert.match(grip, /key === 'torch' \|\| key === 'harlyaolongsword'/);
assert.equal(neutral.stances.torchHold.worldUpright, true);
assert.match(stances, /ToolWorldUpright\?\.apply/);
assert.match(editor, /id="worldUpright"/);
assert.match(editor, /torch_idle/);
assert.match(index, /js\/adventuring-tools\.js/);
assert.match(index, /js\/tool-world-upright\.js/);
assert.match(read('docs/js/pixel-probe.js'), /Adventuring Tools:/);
const nativeHit = read('docs/js/dev-random-ruin-hit-puzzles.js');
assert.match(nativeHit, /source\.userData\.fireHazard = true/);
assert.match(nativeHit, /isIgnitionSourceAlongSegment/);
assert.match(nativeHit, /contactAdventuringTorchSegment/);
assert.match(nativeHit, /temporaryTorchPickupsDisabled:true/);
assert.match(nativeHit, /debugPickupTorch:\(\)=>false/);
assert.doesNotMatch(nativeHit, /function (?:spawnSourceTorch|pickupDroppedTorch|forceTorchWeaponMode|beginTorchSwing|updateTorchTimers)\(/, 'obsolete temporary torch subsystem must be physically removed');
assert.doesNotMatch(nativeHit, /loadout\.getSlot\s*=/, 'V50 must not monkey-patch combat loadout for retired torch');
assert.match(game, /getCurrentArea:\s*\(\) => currentArea, \/\/ Adventuring Tools/);
assert.doesNotMatch(read('docs/js/dev-random-ruin-solvability.js'), /torch route exceeds burn duration/);
console.log('Adventuring Tools integration/state assertions passed.');
