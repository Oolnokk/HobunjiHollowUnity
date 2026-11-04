#!/usr/bin/env node
// Full production module with minimal browser stubs: crate pickup, combat and world loot.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
class Vector3 {constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});} set(x,y,z){Object.assign(this,{x,y,z});return this;} copy(v){return this.set(v.x,v.y,v.z);}}
class Group {constructor(){this.isObject3D=true;this.userData={};this.position=new Vector3();this.children=[];this.parent=null;this.scale={set(){}};} add(v){v.parent?.remove?.(v);v.parent=this;this.children.push(v);} remove(v){this.children=this.children.filter(c=>c!==v);v.parent=null;} getWorldPosition(v){return v.copy(this.position);}updateWorldMatrix(){}}
class Mesh extends Group {constructor(g,m){super();this.geometry=g;this.material=m;this.rotation={x:0,y:0,z:0};}}
const THREE={Vector3,Group,Mesh,PlaneGeometry:class{},MeshBasicMaterial:class{},TextureLoader:class{load(p){return{path:p};}},CanvasTexture:class{},DoubleSide:2};
const scene=new Group(),furniture=new Group();scene.add(furniture);furniture.position.set(3.5,0,5.5);
const counts=[],burdens=[],damage=[],loot=[];
const window={THREE,GridTileAccessors:{getCurrentArea:()=>'wild',getActiveScene:()=>scene},
 Combat:{deps:{TILE:64,getCurrentArea:()=>'wild',player:{x:224,y:352},showToast(){}}},
 AuthoredFurniture:{setRuntimeValues:(g,v)=>counts.push(v.crateCount),load:async()=>({key:'looseCrate',carryable:{}}),buildGroup:()=>new Group()},
 Shattercasks:{registerBurden(o){o.scene.add(o.group);const b={...o,exploded:false};burdens.push(b);return b;},
 pickUp:()=>true,discardBurden:b=>{b.exploded=true;b.group.parent?.remove(b.group);return true;},
 applyBlast:(...args)=>damage.push(args),grantBurdenLoot:items=>{loot.push(items);return ['ok'];}},
 LootRolling:{rollLootPool:()=>({needlegrain:2})},AudioSystem:{}};
const document={createElement:()=>({getContext:()=>({clearRect(){},fillText(){}})})};
vm.runInNewContext(read('docs/js/crate-piles.js'),{window,document,console,Math});
const authored=JSON.parse(read('docs/config/furniture-authored/crateStack.json'));
const single=JSON.parse(read('docs/config/furniture-authored/looseCrate.json'));
const bomb=JSON.parse(read('docs/config/furniture-authored/hronalWitchBomb.json'));
const index=JSON.parse(read('docs/config/items/item-index.json'));
const pool=JSON.parse(read('docs/config/loot/loot-pools.json')).pools.crateJunk.entries;
assert.equal(authored.parts.length,3);
assert.deepEqual(authored.runtimeVariants.states.map(s=>s.hiddenPartIds.length),[0,1,2,3]);
assert.deepEqual(single.carryable.handTargets,bomb.carryable.handTargets);
for(const entry of pool)assert.ok(index[entry.itemKey],entry.itemKey);
for(const key of ['puktukWool','uumkaoiiEgg','mireHerbs','heftroot'])
 assert.ok(pool.some(p=>p.itemKey===key));
assert.equal(window.CratePiles.registerPile({mapId:'town',id:'town',group:furniture,scene,lootable:false}),null);
const pile=window.CratePiles.registerPile({mapId:'wild',id:'camp',group:furniture,scene,lootable:true});
(async()=>{
 assert.equal(await window.CratePiles.takeCrate(pile),true);
 assert.equal(pile.count,2);assert.equal(burdens[0].kind,'looseCrate');
 assert.equal(window.CratePiles.shatterBurden(burdens[0],'thrown'),true);
 assert.equal(damage[0][3].footingDamage,90);assert.equal(damage[0][3].radius,1);
 assert.equal(window.CratePiles.debugSnapshot().looseJunk,1);
 window.CratePiles.tick(.016);assert.equal(loot.length,1);
 assert.equal(window.CratePiles.debugSnapshot().looseJunk,0);
 const collider={origin:{x:3,y:.5,z:5.5},yaw:0,horizontalRangeWorld:2,verticalRiseWorld:0,halfConeRad:.5,halfHeightWorld:.8};
 assert.equal(window.CratePiles.sweepMelee(collider),true);
 assert.equal(pile.count,1);
 assert.equal(await window.CratePiles.takeCrate(pile),true);
 assert.equal(pile.count,0);
 assert.equal(window.CratePiles.nearestInteractable('wild',3.5,5.5),null);
 assert.deepEqual(counts,[3,2,1,0]);
 const sh=read('docs/js/shattercasks.js'),camp=read('docs/js/bandit-camps.js'),cave=read('docs/js/cave-site-system.js'),editor=read('docs/tools/furniture-avatar-author/index.html');
 assert.ok(sh.includes('CratePiles?.takeCrate'));
 assert.ok(camp.includes('CratePiles?.registerPile'));
 assert.ok(cave.includes('saved.crateCounts'));
 assert.ok(editor.includes('runtimeVariants:state.runtimeVariants'));
 console.log('PASS crates: triple stack, authoring, pickup, thrown shatter, melee, footing, auto-loot and saves');
})().catch(error=>{console.error(error);process.exitCode=1;});
