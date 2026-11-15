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
  RangedWeapons: { throwAdventuringTorch() { throws++; return { itemKey:'torch' }; } },
  CharacterMetaSave: { update(callback) { const ch = {}; callback(ch); persisted = ch.adventuringToolUnlocks; } },
};
const context = vm.createContext({ window: world });
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
assert.equal(torch.throwLit().ok, true);
assert.equal(throws, 1);
assert.equal(torch.isLit(), false);
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
torch.stow();
assert.equal(torch.isLit(), false);
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
const torchActionStart = game.indexOf("const torchVisual = activeTool === 'adventuring'"); // The central action dispatch must start the forehand before queuing the physical contact.
const torchActionQueued = game.indexOf('pendingAction = { col: reticle.col, row: reticle.row, action: activeAction, tool: activeTool };', torchActionStart);
assert(torchActionStart >= 0 && torchActionQueued > torchActionStart, 'torch action queues contact after selecting its visual');
const torchDispatch = game.slice(torchActionStart, torchActionQueued);
assert(torchDispatch.includes('synchronizedSwing.call(window.Combat.deps, torchVisual.durationS, torchVisual.options)'), 'torch uses the shared hand-grip/visual clock when available');
assert(torchDispatch.includes('else triggerWeaponSwingVisual(torchVisual.durationS, torchVisual.options)'), 'fallback is present before combat hooks initialize');
assert(game.includes("toolSwingT > 0 && (!!combatSwingPose || activeTool === 'adventuring')"), 'all torch actions suppress world-upright correction while active');
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
assert.match(game, /window\.AdventuringTools\?\.swingAtAim\(combatSwingCone\)/);
assert.match(game, /equipmentSlots\.adventuring = 'torch'/);
assert.match(game, /adventuringToolActionButtons\(\)/);
assert.match(arc, /\['adventuringGateway',\.\.\.deps\.WHEEL_SLOTS/);
assert.match(arc, /_openAdventuringArc\(\)/);
assert.match(ranged, /throwAdventuringTorch\(\)/);
assert.match(ranged, /projectileVisualStyle:'weapon'/);
assert.match(ranged, /dungeonFire:true/);
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
