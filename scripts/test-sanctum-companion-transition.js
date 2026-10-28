'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
let composer,success=true;
const player={x:0,y:0};
const animal={master:player,stableRole:'companion',areaId:'map_i_dev_random_ruin',health:30,x:1,y:2,vx:100,vy:100,groundLift:.4,avatarRef:{group:{position:{x:1,y:0,z:2}}}};
const downed={...animal,_downed:true,x:9};
const enemy={...animal,banditCompanion:true,x:8};
const mount={...animal,stableRole:'mount',x:7};
const otherMaster={...animal,master:{},x:6};
let cancelled=0;
const window={THREE:{},DynamicSurfaces:{},
  DevRandomRuinSimplePuzzles:{registerComposer(c){composer=c;}},
  Combat:{animalAttacks:{cancel(){cancelled++;}}},
  DevRandomRuin:{setPlayerWorldPoint(point){if(!success)return false;player.x=point.x*64;player.y=point.z*64;return true;},getGroundSupportYAt(){return -2;}}
};
// Expose only the existing lexical transition for this isolated test.
const source=fs.readFileSync('docs/js/dev-random-ruin-sanctum.js','utf8').replace(/\}\)\(\);\s*$/, 'window.testTeleport=teleport;})();');
vm.runInNewContext(source,{window,console});
composer.buildRooms({deps:{player,TILE:64,companionObjects:new Set([animal,downed,enemy,mount,otherMaster])}}, {},null,null,{sanctum:false});
for(const point of [{x:80,z:20},{x:5,z:7}]){
  window.testTeleport(point);
  assert.equal(animal.x,player.x);assert.equal(animal.y,player.y);
  assert.equal(animal.vx,0);assert.equal(animal.vy,0);
  assert.equal(animal.avatarRef.group.position.x,point.x);
  assert.equal(animal.avatarRef.group.position.z,point.z);
  assert.equal(animal.avatarRef.group.position.y,-1.6);
  assert.equal(animal.surfaceYOverride(),-2);
}
assert.equal(cancelled,2);
assert.equal(downed.x,9);assert.equal(enemy.x,8);assert.equal(mount.x,7);assert.equal(otherMaster.x,6);
success=false;window.testTeleport({x:999,z:999});
assert.equal(animal.x,5*64,'Failed player transition must not move the companion');
animal.areaId='farm';
assert.equal(animal.surfaceYOverride(),undefined,'Ruin support cannot override exterior terrain after departure');
console.log('Sanctum companion entry/return transition checks passed');
