'use strict';
// Regression: hidden locales must not remain pre-discovered on a regenerated Tothal landscape.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
let cycle=7; // Simulated Tothal year used by the wilderness map's persisted discovery keys.
let currentArea='map_southern_cloud_forest'; // Active zone whose fog tick reveals nearby secrets.
let saved=JSON.stringify({worlds:[{id:'test-shift-world'}]}); // Local world save backing the map's normal discovery store.
const zone='map_southern_cloud_forest'; // Zone holding a relocated, Shift-generated hidden shrine.
const shrine={localeId:'locale_hikihiki_shrine',name:"Hiki-hiki's Shrine",category:'great_fey_shrine',
  x:10,y:10,shiftGeneratedSecret:true,alwaysVisible:false};
const layout={cols:50,rows:50,localeInstances:[shrine],tiles:[]}; // Normal generator workspace shape.
const player={x:10,y:10}; // WildernessMap uses this world-space position for proximity discovery.
const ctx={ console,Map,Set,Math,Uint8Array,Array,Object,Number,
  btoa:v=>Buffer.from(v,'binary').toString('base64'),
  atob:v=>Buffer.from(v,'base64').toString('binary'),
  localStorage:{getItem:k=>k==='hobunjiSaveMeta'?saved:null,setItem(k,v){if(k==='hobunjiSaveMeta')saved=v;}},
  document:{getElementById:()=>null},
};
ctx.window=ctx;
ctx.WildernessMapGenerator={zoneMapIds:()=>[zone]};
ctx.BanditCamps={perceivedThreats:new Map()};
ctx.BountyBoard={markers:new Map()};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('docs/js/wilderness-map.js','utf8'),ctx,{filename:'docs/js/wilderness-map.js'});
ctx.WildernessMap.init({_zoneLayouts:new Map([[zone,layout]]),tothalWorldId:()=> 'test-shift-world',
  currentTothalYear:()=>cycle,showToast:()=>{},_isZoneArea:area=>area===zone,
  getCurrentArea:()=>currentArea,player,TILE:1,npcWalkers:[],WMAP_ZONE_LABELS:{}});
assert.equal(ctx.WildernessMap._test.visibleLandmarks(zone).length,0,'new secret is not automatically exposed');
ctx.WildernessMap.updateFogAroundPlayer();
assert(ctx.WildernessMap._test.visibleLandmarks(zone).some(item=>item.localeId===shrine.localeId),
  'approaching the current Shift shrine records a discovery');
assert(JSON.parse(saved).worlds[0].discoveredLocales['locale_hikihiki_shrine:tothal:7'],
  'a found secret is recorded against the Shift year');
cycle=8;
shrine.x=31;shrine.y=32; // Tothal Shift destroys the old shrine footprint and rerolls the new position.
assert.equal(ctx.WildernessMap._test.visibleLandmarks(zone).length,0,
  'the old discovery cannot automatically reveal the next Shift shrine');
player.x=31;player.y=32; // Find the newly generated shrine again rather than teleporting the old one.
ctx.WildernessMap.updateFogAroundPlayer();
assert(ctx.WildernessMap._test.visibleLandmarks(zone).some(item=>item.localeId===shrine.localeId&&item.col===31.5),
  'the new shrine becomes discoverable independently at its new location');
assert(JSON.parse(saved).worlds[0].discoveredLocales['locale_hikihiki_shrine:tothal:8'],
  'new Shift has a separate discovery record');

// A saved discovery made in the current Shift must survive installing the
// year-qualified map code; only the next genuine Shift should hide it.
const migratedSave=JSON.parse(saved); // Existing world metadata from before this PR's map-marker upgrade.
delete migratedSave.worlds[0].discoveredLocales['locale_hikihiki_shrine:tothal:8'];
migratedSave.worlds[0].discoveredLocales['locale_hikihiki_shrine']={
  name:"Hiki-hiki's Shrine",category:'great_fey_shrine',firstDiscoveredYear:8,
};
saved=JSON.stringify(migratedSave);
assert.equal(ctx.WildernessMap._test.visibleLandmarks(zone).length,1,
  'same-cycle legacy map discovery survives the upgrade');
cycle=9;
assert.equal(ctx.WildernessMap._test.visibleLandmarks(zone).length,0,
  'legacy map discovery expires on the following Tothal Shift');

// Author-authored persistent/visible locales must not be forced into Shift turnover merely
// because their category is a shrine or ruin entrance.
const persistent={localeId:'locale_stable_altar',name:'Permanent Altar',category:'great_fey_shrine',
  x:20,y:20,shiftGeneratedSecret:false,alwaysVisible:false}; // This authored opt-out is intentionally explicit.
layout.localeInstances.push(persistent);
player.x=20;player.y=20;
ctx.WildernessMap.updateFogAroundPlayer();
assert(ctx.WildernessMap._test.visibleLandmarks(zone).some(item=>item.localeId===persistent.localeId),
  'persistent authored shrine can be discovered');
cycle=10;
assert(ctx.WildernessMap._test.visibleLandmarks(zone).some(item=>item.localeId===persistent.localeId),
  'explicit permanent shrine discovery survives the next Shift');

const publicShrine={localeId:'locale_public_shrine',name:'Public Shrine',category:'great_fey_shrine',
  x:26,y:26,shiftGeneratedSecret:true,alwaysVisible:true}; // Always-visible setting takes precedence over incidental secret metadata.
layout.localeInstances.push(publicShrine);
const publicMarker=ctx.WildernessMap._test.visibleLandmarks(zone).find(item=>item.localeId===publicShrine.localeId);
assert(publicMarker,'always-visible location must be on the map immediately');
ctx.WildernessMap.setWaypoint(publicMarker);
assert.equal(ctx.WildernessMap.getCompassWaypoint()?.localeId,publicShrine.localeId,
  'always-visible waypoint must not require secret discovery');
cycle=11;
publicShrine.x=27;publicShrine.y=29;
const publicWaypoint=ctx.WildernessMap.getCompassWaypoint();
assert(publicWaypoint?.localeId===publicShrine.localeId && publicWaypoint.col===27.5 && publicWaypoint.row===29.5,
  'always-visible authored waypoint follows its live location after a Shift');

console.log('Tothal secret map rediscovery tests passed');
