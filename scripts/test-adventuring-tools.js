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
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const length = Math.sqrt(this.lengthSq()); this.x /= length; this.y /= length; this.z /= length; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  addScaledVector(vec, scale) { this.x += vec.x * scale; this.y += vec.y * scale; this.z += vec.z * scale; return this; }
}

let activeTool = 'adventuring', heldMode = 'tool', fireHazard = false, ruinHazard = false, area = 'farm'; // Distinguishes farm tile hazards from physical ruin sources.
let fireContacts = 0, tentContacts = 0, ruinContacts = 0, throws = 0, persisted = [];
const world = {
  DungeonFire: { contactProjectile(projectile, start, end) {
    assert.equal(projectile.team, 'player'); assert.equal(projectile.dungeonFire, true);
    assert.ok(end.x > start.x); fireContacts++;
  } },
  BanditCamps: { igniteAimedTentWithTorch() { tentContacts++; } },
  DevRandomRuinHitPuzzles: {
    isIgnitionSourceAlongSegment(start,end) { assert.ok(end.x > start.x); return ruinHazard; },
    contactAdventuringTorchSegment(start,end) { assert.ok(end.x > start.x); ruinContacts++; return true; },
  },
  RangedWeapons: { throwAdventuringTorch() { throws++; return { itemKey:'torch' }; } },
  CharacterMetaSave: { update(callback) { const ch = {}; callback(ch); persisted = ch.adventuringToolUnlocks; } },
};
vm.runInNewContext(read('docs/js/adventuring-tools.js'), { window: world });
const torch = world.AdventuringTools;
const deps = {
  THREE: { Vector3 },
  getActiveTool: () => activeTool, getHeldMode: () => heldMode,
  getEquippedTool: () => 'torch', getUnlocked: () => [], getCurrentArea: () => area,
  getAimRay: () => ({ direction: { x:1, y:0, z:0 } }),
  getToolHolder: () => ({ getWorldPosition: out => out }),
  isAimedFireHazard: () => fireHazard,
  refreshActionBar() {}, selectTorch() { activeTool = 'adventuring'; },
};
torch.init(deps);
assert.deepEqual(Array.from(torch.entries(), entry => entry.id), ['torch']);
assert.equal(torch.isLit(), false);
assert.equal(torch.canThrow(), false);
assert.equal(torch.swingAtAim(1,1).ok, true);
assert.equal(torch.isLit(), false);
fireHazard = true;
assert.equal(torch.swingAtAim(1,1).ok, true);
assert.equal(torch.isLit(), true);
assert.equal(fireContacts, 1);
assert.equal(tentContacts, 1);
assert.equal(ruinContacts, 1);
assert.equal(torch.canThrow(), true);
assert.equal(torch.throwLit().ok, true);
assert.equal(throws, 1);
assert.equal(torch.isLit(), false);
assert.equal(torch.throwLit().ok, false);
assert.equal(throws, 1);
area = 'map_i_dev_random_ruin';
fireHazard = true; ruinHazard = false;
assert.equal(torch.swingAtAim(1,1).ok, true);
assert.equal(torch.isLit(), false, '2D furniture tile lookups never bypass ruin floor/contact checks');
fireHazard = false; ruinHazard = true;
assert.equal(torch.swingAtAim(1,1).ok, true);
assert.equal(torch.isLit(), true, 'V50 fire-hazard source lights the permanent torch without a pickup');
assert.equal(ruinContacts, 2, 'lit swing contacts real V50 torch puzzle targets');
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
assert.match(game, /if \(tool === 'adventuring'\) return action === 'torch_swing'/);
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
assert.match(assets, /torch: \{[\s\S]*?litOnly:true/);
assert.match(effects, /fx\.config\.litOnly/);
assert.match(grip, /data\.tools\.torch = clone\(ensureTool\('harlyaolongsword'\)\)/);
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
