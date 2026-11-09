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
const vesselAsset = JSON.parse(fs.readFileSync(path.join(root,'docs/config/furniture-authored/shattercaskBlasting.json'),'utf8')); // The authoritative carry anchor, grips and barrel center.
const skinPng = fs.readFileSync(path.join(root,'docs/assets/objectsprites/soursap_fruit_skin.png')); // Verifies the actual shipped texture, not a placeholder URL.
assert.equal(skinPng.subarray(0,8).toString('hex'),'89504e470d0a1a0a','Soursap rind is a real PNG asset');
assert.equal(skinPng.readUInt32BE(16),64,'Soursap UV map has the authored 64px width');
assert.equal(skinPng.readUInt32BE(20),32,'Soursap UV map has the authored 32px height');
const carryStart=burdenCode.indexOf('  function fruitCarryableFromShattercask(');
const carryEnd=burdenCode.indexOf('  function adoptFruitCarryTemplate(',carryStart);
assert(carryStart>=0 && carryEnd>carryStart,'fruit shares the actual Shattercask authored carry rig');
const deriveCarry=vm.runInNewContext(burdenCode.slice(carryStart,carryEnd)+'\nfruitCarryableFromShattercask',
  {FRUIT_CARRY_FALLBACK:vesselAsset,finite:value=>Number(value)||0,Math,Object});
const fruitGrip=deriveCarry(vesselAsset);
const barrel=vesselAsset.parts.find(part=>part.kind==='barrel').transform;
for(const axis of ['x','y','z']) {
  const size=vesselAsset.carryable.billboardAnchor.size;
  assert(Math.abs((barrel[axis]-vesselAsset.carryable.billboardAnchor.position[axis])/size
    -(0-fruitGrip.billboardAnchor.position[axis])/size)<1e-8,
    'Soursap center matches Shattercask barrel carry position on '+axis);
  for(const hand of ['left','right'])
    assert(Math.abs((vesselAsset.carryable.handTargets[hand][axis]-barrel[axis])
      -fruitGrip.handTargets[hand][axis])<1e-8,
      'Soursap uses the same authored '+hand+' hand position on '+axis);
}
assert.equal(fruitGrip.billboardAnchor.coordinateSpace,'posterior-relative');
assert.equal(fruitGrip.billboardAnchor.size,vesselAsset.carryable.billboardAnchor.size);
assert(burdenCode.includes('ensureFruitCarryTemplate()') && burdenCode.includes('beginSharedThrowVisual()') &&
  burdenCode.includes('if(held===burden)alignHeldVase(burden)'), 'live fruit pose follows Shattercask throw animation and authored edits');

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
let skinLoads=0; // Confirms all fruit in a zone reuse the same real PNG texture.
const THREE = { SphereGeometry: class {}, MeshStandardMaterial: class {}, Mesh: FruitMesh,
  sRGBEncoding:3001, NearestFilter:1003,
  TextureLoader: class {load(url) { skinLoads++; assert(url.includes('/soursap_fruit_skin.png')); return {needsUpdate:false}; }},
};
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
assert.equal(skinLoads,1,'only one PNG texture upload is requested across cloud-forest fruit meshes');
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

// Exercise real Burden-stage functions with focused fake scene/physics owners.
// This catches regressions that only checking the Cloud Forest action labels would miss.
function isolateFunction(start, next) {
  const first=burdenCode.indexOf('  function '+start+'('); // Exact source range for this production implementation.
  const plainUntil=burdenCode.indexOf('  function '+next+'(',first); // Function boundaries also include async functions.
  const until=plainUntil>=0?plainUntil:burdenCode.indexOf('  async function '+next+'(',first);
  assert(first>=0&&until>first,'production Burden stage '+start+' is present');
  return burdenCode.slice(first,until);
}
const stage = isolateFunction('startFruitFall','releaseFruitFromTree') +
  isolateFunction('updateFruitFalls','spawnRandomInDevArena');
let fallBursts=0, harvestMarks=0;
const falling = new Map();
const fruitWorld = {x:4.32,y:3.1,z:5.15};
const flightFruit = {id:'soursap_4_5',mapId:zone,kind:'soursap',fruitBranch:{col:4,row:5},flying:false,exploded:false,
  group:{
    position:{...fruitWorld,copy(v){Object.assign(this,{x:v.x,y:v.y,z:v.z});}},
    rotation:{z:0},quaternion:{identity(){}},scale:{setScalar(){}},
    updateWorldMatrix(){},getWorldPosition(out){Object.assign(out,this.position);return out;},
  },
};
const stageScene = {add(){}};
const fallRecords = new Map([[zone,{scene:stageScene,vases:new Map([[flightFruit.id,flightFruit]])}]]);
const runtimeStage = vm.runInNewContext(stage + '\n({startFruitFall,updateFruitFalls})', {
  THREE:{Vector3:class {}}, records:fallRecords,fallingFruits:falling,held:null,
  markFruitHarvested(fruit){fruit.fruitBranch=null;fruit.hanging=false;harvestMarks++;},
  thrownGround:()=>0,area:()=>zone,detonate(fruit,cause){fallBursts++;fruit.exploded=true;assert(cause.includes('ground-impact'));},
  lastEvent:'',Math,Number,Map,
});
assert(runtimeStage.startFruitFall(flightFruit,'projectile'),
  'a shot begins physical free fall, rather than exploding in the air');
assert.equal(fallBursts,0,'a dislodged fruit does not explode immediately');
for(let frame=0;frame<35;frame++)runtimeStage.updateFruitFalls(.1);
assert.equal(fallBursts,1,'gravity triggers one burst when the fruit touches the ground');
assert.equal(falling.size,0,'the falling-fruit state is removed on ground impact');
assert.equal(harvestMarks,1,'a detached fruit is removed from the branch only once');

const fellCode=isolateFunction('releaseFruitFromTree','updateFruitFalls');
let persistedFruit=0, markedOnFell=0;
const felledFruit={
  id:'soursap_tree',kind:'soursap',hanging:true,flying:false,
  fruitBranch:{col:7,row:8},group:{position:{set(x,y,z){this.x=x;this.y=y;this.z=z;}}},
};
const standingFruits=new Map([[felledFruit.id,felledFruit]]);
const looseFruits=new Map();
const felled = vm.runInNewContext(fellCode + '\nreleaseFruitFromTree', {
  records:new Map([[zone,{vases:standingFruits}]]),
  nearestOpen:()=>({col:6,row:8}),grid:()=>[],baseHeight:()=>1,
  markFruitHarvested(obj){obj.hanging=false;obj.fruitBranch=null;markedOnFell++;},
  refreshMeshBounds(){},looseFruitHistory:looseFruits,persistWorld(){persistedFruit++;},
  Math,Map,
});
assert(felled(zone,7,8),'felling a fruit-bearing tree releases the hanging fruit');
assert.equal(felledFruit.group.position.x,6.5,'the intact fruit is placed on adjacent safe ground');
assert.equal(felledFruit.group.position.y,1.16,'the safe fruit lands above the local terrain');
assert.equal(felledFruit.exploded,undefined,'chopping the tree must not burst the fruit');
assert.equal(markedOnFell,1);
assert.equal(persistedFruit,1,'intact fruit is saved after felling the tree');
assert.equal(looseFruits.get(zone).size,1);
assert(!felled(zone,7,8),'a second felling event cannot duplicate the same fruit');

const melee = isolateFunction('sweepMelee','projectileHit');
let meleeBursts=0;
const meleeFruit={kind:'soursap',hanging:true,carried:false,exploded:false};
vm.runInNewContext(melee + '\nsweepMelee({actor:{},rangePx:60})', {
  held:null,deps:()=>({}),allActive:()=>new Map([['fruit',meleeFruit]]),
  window:{Combat:{meleeColliderVolume:()=>({origin:{x:0,y:0,z:0}})}},
  detonate(){meleeBursts++;}, Math,Map,
});
assert.equal(meleeBursts,0,'ground melee cannot explode hanging fruit or bypass climbing/ranged harvesting');

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
