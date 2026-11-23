#!/usr/bin/env node
'use strict';
// Verify the real wildlife owner restores only its temporary den metadata, even
// if the LOD system had already hidden a creature or an animal died in the storm.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const zone='map_southern_cloud_forest'; // Wilderness area containing the storm's temporary shelter den.
const otherZone='map_eastern_mire'; // Player may enter a different wilderness map before the weather clears.
let activeZone=zone; // The shared wildlife tick follows the player's current region, not every previously visited region.
let storm=true; // Shared Tothal event status, toggled without an extra update owner.
let scans=0; // Counts hostile roster traversals, including ordinary off-storm frames.
const distant={areaId:zone,health:10,x:4,y:7,denKey:null,state:'wander',
  _denHidden:false,avatarRef:{group:{visible:false}},groundShadow:{visible:false}};
const nearby={areaId:zone,health:10,x:8,y:9,denKey:null,state:'patrol',
  _denHidden:false,avatarRef:{group:{visible:true}},groundShadow:{visible:true}};
const dead={areaId:zone,health:10,x:11,y:12,denKey:null,state:'idle',
  _denHidden:false,avatarRef:{group:{visible:true}},groundShadow:{visible:true}};
const moved={areaId:zone,health:10,x:13,y:14,denKey:null,state:'patrol',
  _denHidden:false,avatarRef:{group:{visible:true}}};
const reassigned={areaId:zone,health:10,x:14,y:15,denKey:null,state:'patrol',
  _denHidden:false,avatarRef:{group:{visible:true}}};
const native={areaId:zone,health:10,x:5,y:6,denKey:zone+':native',state:'idle',
  _denHidden:true,avatarRef:{group:{visible:false}}};
const nativeOutside={areaId:zone,health:10,x:19,y:22,denKey:zone+':native',state:'hunt',
  denEntranceX:3.5,denEntranceY:4.5,_denHidden:false,avatarRef:{group:{visible:true}},groundShadow:{visible:true}};
const animals=[distant,nearby,dead,moved,reassigned,native,nativeOutside]; // Existing animals; no storm-created actor population.
const roster={*[Symbol.iterator](){scans++;yield* animals;}};
const win={TothalBlizzard:{isShelteringFor:()=>storm}};
vm.runInNewContext(fs.readFileSync('docs/js/wildlife-spawn.js','utf8'),{window:win,console},
  {filename:'wildlife-spawn.js'});
win.WildlifeSpawn.init({hostileObjects:roster,TILE:1,_isZoneArea:()=>true,
  getCurrentArea:()=>activeZone,getCutscenePreviewActive:()=>false,buildZoneScene:()=>false,
  zoneLayouts:new Map([[zone,{dens:[{id:'den1',x:2,y:3,w:2,h:2}]}]])});
const update=()=>win.WildlifeSpawn.updateTothalWildlifeShelter(zone);
assert.equal(update(),true);
assert.equal(native.denKey,zone+':native','native den resident must not be rehomed');
assert.equal(native._tothalStormShelter,undefined);
assert.equal(nativeOutside.state,'return','a native-den hunter must shelter even in daytime');
assert.equal(nativeOutside.denKey,zone+':native','native residents retain their own den entrance');
assert.equal(nativeOutside._tothalStormShelter?.nativeDen,true);
nativeOutside.state='chase';update();
assert.equal(nativeOutside.state,'return','daytime chase AI cannot undo the storm return-home obligation');
for(const c of [distant,nearby,dead,moved,reassigned])assert(c._tothalStormShelter,'outdoor wildlife redirected to the existing den');
for(const c of [distant,nearby,dead,moved])c._denHidden=true; // Ordinary den-arrival actor physics hides them after they arrive.
distant.avatarRef.group.visible=false;nearby.avatarRef.group.visible=false;
distant.groundShadow.visible=false;nearby.groundShadow.visible=false;
nativeOutside._denHidden=true;nativeOutside.avatarRef.group.visible=false;nativeOutside.groundShadow.visible=false;
dead.health=0; // A body must not leave a persistent temporary shelter reference.
moved.areaId='map_i_other_cave'; // A captured/migrated actor must keep its new area unchanged.
reassigned.areaId='map_i_other_cave';
reassigned.denKey='map_i_other_cave:native'; // A new authored den overrides the borrowed storm den.
storm=false;
assert.equal(update(),false);
assert.equal(distant.avatarRef.group.visible,false,'off-screen avatar must stay invisible after the storm');
assert.equal(distant.groundShadow.visible,false,'off-screen shadow must stay invisible after the storm');
assert.equal(nearby.avatarRef.group.visible,true,'an originally visible avatar may reappear');
assert.equal(nearby.groundShadow.visible,true,'original shadow visibility is restored');
assert.equal(distant.denKey,null);
assert.equal(nearby.denKey,null);
assert.equal(dead._tothalStormShelter,undefined,'dead actor snapshot must be released');
assert.equal(moved._tothalStormShelter,undefined,'changed-area actor snapshot must be released');
assert.equal(moved.areaId,'map_i_other_cave','changed-area actor must not teleport back');
assert.equal(moved.denKey,null,'moved actors must not retain an unrelated storm-only den key');
assert.equal(reassigned.denKey,'map_i_other_cave:native','a legitimate new den must survive storm cleanup');
assert.equal(native._denHidden,true);
assert.equal(nativeOutside.state,'hunt','native hunter schedule resumes after the storm');
assert.equal(nativeOutside.denKey,zone+':native');
assert.equal(nativeOutside._denHidden,false);
assert.equal(nativeOutside.avatarRef.group.visible,true);
assert.equal(nativeOutside.groundShadow.visible,true);
const afterClear=scans; // The ordinary next 2-second wildlife check cannot scan the hostile roster.
for(let i=0;i<400;i++)assert.equal(update(),false);
assert.equal(scans,afterClear,'ordinary weather remains free of full-roster shelter scans');
const travelling = {areaId:zone,health:10,x:18,y:22,denKey:null,state:'wander',
  _denHidden:false,avatarRef:{group:{visible:true}}}; // Animal left behind in the first area.
animals.push(travelling);
storm=true; activeZone=zone;
assert.equal(update(),true);
assert(travelling._tothalStormShelter,'storm redirects the animal into a real den before the player leaves');
activeZone=otherZone; storm=false;
win.WildlifeSpawn.updateHostileSpawning(3);
assert.equal(travelling._tothalStormShelter,undefined,'remote storm shelter is released even without revisiting its map');
assert.equal(travelling.denKey,null,'remote animal regains its original roaming identity');
const afterTravelCleanup=scans; // Later ordinary-weather ticks must stay dormant, including after a remote-zone release.
for(let i=0;i<10;i++)win.WildlifeSpawn.updateHostileSpawning(3);
assert.equal(scans,afterTravelCleanup,'remote cleanup happens once rather than scanning on every later wildlife tick');
console.log('Tothal wildlife LOD, shadows, death/movement cleanup, and dormant CPU cost passed.');
