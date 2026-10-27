// Soursap branch harvesting and Sticky/Disorient regressions.
// Exercises the Cloud Forest's actual behavior API, not an alternative fruit implementation.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

const behaviorCode = fs.readFileSync(path.join(root, 'docs/js/wildlife-cloud-forest-behavior.js'), 'utf8');
const rangedCode = fs.readFileSync(path.join(root, 'docs/js/combat/ranged-weapons.js'), 'utf8');
const gameCode = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8');
const burdenCode = fs.readFileSync(path.join(root, 'docs/js/shattercasks.js'), 'utf8');
const climbCode = fs.readFileSync(path.join(root, 'docs/js/climb-system.js'), 'utf8');

const zone = 'map_southern_cloud_forest';
const branch = { col: 3, row: 4, baseX: 3.5 * 64, baseY: 4.5 * 64,
  tipX: 4.5 * 64, tipY: 4.5 * 64, baseWorldY: 2, tipWorldY: 2.8 };
const player = { x: 4 * 64, y: 4.5 * 64, onBranch: null };
let activeBranch = branch; // Simulates streaming replacement of the tree branch without rebuilding its fruit.
const worldMeshes = new Set(); // Live test fruit meshes as kept by the Cloud Forest scene.
const scene = {
  add(mesh) { worldMeshes.add(mesh); mesh.parent = scene; },
  remove(mesh) { worldMeshes.delete(mesh); mesh.parent = null; },
};
const pos = () => ({ x:0, y:0, z:0, set(x,y,z) { this.x=x; this.y=y; this.z=z; } });
class FruitMesh { constructor() { this.position = pos(); } }
const THREE = { SphereGeometry: class {}, MeshStandardMaterial: class {}, Mesh: FruitMesh };
let registeredFruit = 0, liftedFruit = 0, reboundFruit = 0; // Counts physical fruit registrations, pickups, and streaming reattachments.
const game = {
  THREE, console, performance, Math,
  WildlifeSpawn: { init() {}, updateHostileSpawning() {} },
  ClimbSystem: { debugBranchesFor: () => [activeBranch], groundYAt: () => 0 },
  WildernessMapGenerator: { makeRng: () => () => .4 },
  CalendarSystem: { getHour: () => 12 },
  Music: { isNightTime: () => false },
  Shattercasks: {
    registerFruit(_zone, source, mesh) {
      assert.strictEqual(source, branch);
      registeredFruit++;
      scene.add(mesh);
      return mesh;
    },
    rebindFruitBranch(source, mapId, position) {
      assert.strictEqual(source, activeBranch);
      assert.equal(mapId,zone);
      assert(Number.isFinite(position.y));
      reboundFruit++;
      return true;
    },
    pickUpFruit(source) {
      assert.strictEqual(source, activeBranch);
      liftedFruit++;
      game.HobunjiCloudForestWildlife.markFruitHarvested(source);
      return true;
    },
  },
};
game.window = game;
vm.createContext(game);
vm.runInContext(behaviorCode, game, { filename: 'wildlife-cloud-forest-behavior.js' });
game.WildlifeSpawn.init({
  TILE:64, player, calendar: { day: 4 }, hostileObjects: [],
  zoneScenes: new Map([[zone,{scene}]]), rnd:()=>.4,
  getCurrentArea:()=>zone, showToast(){},
});
game.WildlifeSpawn.updateHostileSpawning(.6);
assert.equal(registeredFruit, 1, 'one physical burden is registered per hanging fruit');
assert.equal(worldMeshes.size, 1, 'fruit is rendered in the cloud forest');

const fruitCol = Math.floor((branch.baseX + (branch.tipX - branch.baseX) * .82)/64);
const fruitRow = Math.floor((branch.baseY + (branch.tipY - branch.baseY) * .82)/64);
assert.equal(game.HobunjiCloudForestWildlife.fruitObjectAt(zone,fruitCol,fruitRow),null,
  'standing underneath the fruit no longer makes the branch fruit lootable');

const replacement = { ...branch, fruit: branch.fruit }; // A new branch instance retains the existing hanging fruit's state.
activeBranch = replacement;
game.WildlifeSpawn.updateHostileSpawning(.6);
assert.equal(registeredFruit, 1, 'chunk reload must not register a duplicate Soursap burden');
assert.equal(reboundFruit,1,'chunk reload rebinds the existing physical fruit to the new branch');
player.onBranch = replacement;
const pickable = game.HobunjiCloudForestWildlife.fruitObjectAt(zone,fruitCol,fruitRow);
assert(pickable && pickable.label.includes('Soursap Fruit'),
  'climbing the fruit-bearing branch grants the correctly named interaction');
assert.equal(pickable.onAction('obj_pick_cf_fruit').ok,true,
  'climber can lift the real fruit burden, not an invisible inventory stack');
assert.equal(liftedFruit,1);
assert.equal(branch.fruit.available,false);
assert.equal(game.HobunjiCloudForestWildlife.fruitObjectAt(zone,fruitCol,fruitRow),null,
  'a fruit cannot be grabbed twice once lifted');
assert.equal(pickable.onAction('obj_pick_cf_fruit').ok,false,
  'stale UI objects may not duplicate lifted fruit');
assert.equal(worldMeshes.size,1,
  'lifting hands the original physical fruit to its burden owner rather than deleting its scene model');

// Execute production ammo status functions with an isolated monotonic clock.
// These functions are deliberately extracted together, preserving their direct calls.
const begin = rangedCode.indexOf('  function applySpecialAmmoDebuff(entity, ammoId) {');
const end = rangedCode.indexOf('  function updateEntityAmmoDebuffs(entity) {', begin);
assert(begin > 0 && end > begin, 'ranged ammo exposes the canonical status implementation');
let now = 1000;
const statuses = vm.runInNewContext(rangedCode.slice(begin,end) +
  '\n({applySpecialAmmoDebuff,applySticky,movementDirectionMultiplier,movementSpeedMultiplier})',
  {performance:{now:()=>now},DISORIENT_DURATION_MS:3000,SHRAPNEL_DURATION_MS:5000});
const actor = {x:0,y:0,health:100};
statuses.applySpecialAmmoDebuff(actor,'concussive');
statuses.applySticky(actor,2200);
assert.equal(statuses.movementDirectionMultiplier(actor),-1,
  'fruit concussion uses the actual Concussive Ammo reversed-movement behavior');
assert.equal(statuses.movementSpeedMultiplier(actor),.2,
  'Sticky slows both player and creature movement to twenty percent');
now = 3300;
assert.equal(statuses.movementSpeedMultiplier(actor),1,
  'Sticky expires naturally after 2.2 seconds');
assert.equal(statuses.movementDirectionMultiplier(actor),-1,
  'the 3-second Concussive disorientation outlasts Sticky');
now = 4100;
assert.equal(statuses.movementDirectionMultiplier(actor),1,
  'Disorient also expires naturally');

assert(gameCode.includes('soursapFruitFlesh: { icon:') &&
  gameCode.includes("label: 'Soursap Fruit Flesh'"),
  'impact flesh is a real inventory definition, not a toast-only reward');
assert(gameCode.includes('window.RangedWeapons?.movementSpeedMultiplier?.(player)') &&
  gameCode.includes('window.RangedWeapons?.movementSpeedMultiplier?.(c)'),
  'native player and creature locomotion both consume Sticky slowdown');
assert(burdenCode.includes('class Burden') && burdenCode.includes('rebindFruitBranch') && burdenCode.includes('registerFruit') &&
  burdenCode.includes('releaseFruitFromTree') && burdenCode.includes('fruitBurstVisual'),
  'Shattercasks and Soursap use the same physical Burden pipeline');
assert(climbCode.includes('window.Shattercasks?.releaseFruitFromTree?.(area, col, row)'),
  'felling the tree uses the safe physical-fruit release path');
console.log('PASS soursap: branch-only harvest, burden registration, flesh metadata, and timed Sticky/Disorient');
