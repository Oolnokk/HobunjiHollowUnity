'use strict';
// Named Lich ruins retain world-scoped dungeon state while Tothal relocates their dig spots.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../docs/js/ruin-sites.js'), 'utf8');

function hashString(text) {
  let hash = 2166136261 >>> 0;
  for (const char of String(text)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

function harness({ oldSite, oldProgress, enableHeart = false } = {}) {
  const zone = 'map_western_slope';
  const world = 'test-world';
  const storage = new Map();
  if (oldSite) storage.set('hobunjiRuinSites.v1', JSON.stringify({[world]:{
    cycle:1,entrances:{},bossSites:{tothal:oldSite},holes:{[oldSite]:{zoneId:zone,state:'open',col:10,row:11}},
  }}));
  const localStorage = {
    getItem:key=>storage.get(key)||null,
    setItem:(key,value)=>storage.set(key,String(value)),
  };
  const savedWorlds = new Map([[world,oldProgress || null]]);
  let writable=true; // Toggle to prove completion never clears a checkpoint when world persistence is unavailable.
  let exitsAvailable=true; // Toggle to prove missing return destinations cannot complete a ruin.
  const meta = {
    loadRuinProgress:key=>JSON.parse(JSON.stringify(savedWorlds.get(key)||null)),
    saveRuinProgress:(key,value)=>{
      if(!savedWorlds.has(key)||!writable)return false;
      savedWorlds.set(key,JSON.parse(JSON.stringify(value)));
      return true;
    },
  };
  class Group {
    constructor() {
      this.type='Scene';this.parent=null;this.children=[];this.userData={};
      this.position={set(){}};
    }
    add(child){this.children.push(child);child.parent=this;}
    remove(child){this.children=this.children.filter(x=>x!==child);child.parent=null;}
  }
  const THREE={Group};
  const makeGrid=()=>Array.from({length:60},()=>Array.from({length:60},()=>({type:'grass',water:0})));
  const makeZone=()=>({grid:makeGrid(),cols:60,rows:60,scene:new Group()});
  const makeLayout=()=>({cols:60,rows:60,dens:[],buildings:[],localeInstances:[],
    tiles:Array.from({length:60*60},(_,i)=>({c:i%60,r:Math.floor(i/60),type:'grass'}))}); // Available immediately after Tothal even without a zone scene.
  let currentCycle=oldSite?2:1;
  let currentWorld=world;
  let zi=makeZone();
  const zones=new Map([[zone,zi]]);
  const layouts=new Map([[zone,makeLayout()]]);
  const generated=[];
  const ownedHearts = new Set(); // Simulates the current character's saved relic ownership independently of the world's completed ruins.
  const window={
    THREE,WorldMetaStore:meta,
    RuinSiteLocales:{CATEGORY:'ruin_entrance',hashString},
    AuthoredFurniture:{load:()=>Promise.resolve({}),peek:()=>null,buildGroup:()=>new Group()},
    DelversGuild:{hasStone:()=>true,vaultPhase:()=>null},
    WildernessMapGenerator:{zoneMapIds:()=>[zone]},
    WildTreasure:{syncZoneInteractivity(){}},
    DevRandomRuin:{
      generate:(seed,opts)=>{generated.push({seed,opts});return Promise.resolve(true);},
      exitTo:callback=>callback(),
      getRuntimeContext:()=>({}),
    },
  };
  if(enableHeart)window.LichHeartSystem={
    forType:theme=>['hronal','tothal','kanthic'].includes(theme)?{itemId:theme+'_lich_heart'}:null,
    has:theme=>ownedHearts.has(theme),
  }; // The production site logic only needs the character's KeyItemSystem-backed entitlement API.
  const ctx=vm.createContext({window,localStorage,THREE,console,setTimeout:()=>{}});
  vm.runInContext(source,ctx);
  const deps={
    _zoneScenes:zones,_zoneLayouts:layouts,
    tothalWorldId:()=>currentWorld,currentTothalYear:()=>currentCycle,
    TileType:{TRENCH:'trench',GRASS:'grass',PATH:'path',RIVER:'river',STREAM:'stream',WATERFALL:'waterfall',RAMP:'ramp',ROCK:'rock'},
    TRENCH_TOP:1,TILE:32,calendar:{day:12},getCurrentArea:()=>zone,
    findZoneFlatEmptyTiles:()=>exitsAvailable ? [{col:currentCycle>=3?32:25,row:currentCycle>=3?35:26}] : [],
    buildZoneScene:()=>zi,enterZone:()=>Promise.resolve(true),
    showToast(){},refreshActionBar(){},recordWildernessChunkTileDelta(){},
  };
  window.RuinSites.init(deps);
  return {
    zone,world,window,meta,generated,layouts,
    saved:()=>savedWorlds.get(world),
    shift:()=>{currentCycle++;zi=makeZone();zones.set(zone,zi);return zi;},
    setWritable:value=>{writable=value;},
    setExitsAvailable:value=>{exitsAvailable=value;},
    dropZoneScene:()=>{zones.delete(zone);}, // Simulates opening the Map tab before visiting this wilderness zone.
    restoreZoneScene:()=>{zones.set(zone,zi);},
    newWorld:()=>{currentWorld='another-world';savedWorlds.set(currentWorld,null);},
    grid:()=>zi.grid,
    claimHeart:theme=>ownedHearts.add(theme),
    releaseHeart:theme=>ownedHearts.delete(theme),
  };
}

async function main() {
  const h=harness();
  const ruins=h.window.RuinSites;
  const first=Array.from({length:20},(_,i)=>'initial-ruin-'+i)
    .find(id=>hashString(`${h.world}|1|${id}`)%3===0);
  const second=Array.from({length:20},(_,i)=>'duplicate-ruin-'+i)
    .find(id=>hashString(`${h.world}|1|${id}`)%3===0);
  assert(first&&second);
  assert.equal(ruins.debugEnterVisit({kind:'entrance',id:first,zoneId:h.zone,returnAt:{x:10,z:12}}),true);
  await Promise.resolve();
  assert.equal(h.generated[0].opts.specialBoss,true);
  const seed=h.generated[0].seed;
  assert.equal(ruins.saveActiveRuinProgress({version:1,seed,travel:{activeCheckpoint:'wing-east'},openedChests:['chest-1']}),true);
  assert.equal(ruins.markActiveRuinBossDefeated(seed),true);
  ruins.onRuinLeft();
  assert.equal(ruins.debugEnterVisit({kind:'entrance',id:first,zoneId:h.zone,returnAt:{x:10,z:12}}),true);
  await Promise.resolve();
  assert.equal(h.generated[1].opts.specialBoss,true,'re-entering the original named tomb must keep its guardian');
  assert.equal(h.generated[1].opts.tier,'lich','same-cycle re-entry cannot downgrade the named tomb to a generic ruin');
  assert.equal(ruins.activeRuinProgress().travel.activeCheckpoint,'wing-east');
  ruins.onRuinLeft();
  assert.equal(ruins.debugEnterVisit({kind:'entrance',id:second,zoneId:h.zone,returnAt:{x:12,z:12}}),true);
  await Promise.resolve();
  assert.equal(h.generated[2].opts.specialBoss,false,'do not create a second Nanahi tomb in one cycle');
  ruins.onRuinLeft();

  h.shift();
  const buried=ruins.authoredBuriedSites(h.zone);
  assert.equal(buried.length,1,'only one unfinished named tomb is relocated');
  assert.equal(buried[0].siteId,first);
  assert.equal(buried[0].seed,seed);
  assert.equal(buried[0].dug,false);
  assert.equal(ruins.authoredDigSpots(h.zone).length,1);
  ruins.syncMapMarkers();
  assert(h.layouts.get(h.zone).localeInstances.some(marker=>
    marker.name.includes('Nanahi')&&marker.name.includes('Buried Entrance')&&marker.alwaysVisible));
  h.grid()[buried[0].row][buried[0].col].type='trench';
  h.window.WildTreasure.syncZoneInteractivity(h.zone);
  assert.equal(ruins.authoredBuriedSites(h.zone)[0].dug,true,'ordinary post-dig refresh reveals the ladder');
  assert.equal(ruins.authoredDigSpots(h.zone).length,0);

  assert.equal(ruins.debugEnterVisit({kind:'authored',theme:'tothal',id:first,zoneId:h.zone,
    returnAt:{x:buried[0].col+.5,z:buried[0].row+1.5}}),true);
  await Promise.resolve();
  assert.equal(h.generated[3].seed,seed,'same interior seed after a shift');
  assert.equal(h.generated[3].opts.specialBoss,true,'same named lich, not a new guardian assignment');
  assert.equal(ruins.activeRuinProgress().travel.activeCheckpoint,'wing-east');
  assert.equal(ruins.isActiveRuinChestOpened('chest-1',seed),true);
  assert.equal(ruins.isActiveRuinBossDefeated(seed),true);
  // Shift again while still inside: leaving by the ordinary entrance should surface at the NEW ladder.
  h.shift();
  const secondLocation=ruins.authoredBuriedSites(h.zone)[0]; // The current Tothal layout chooses the new tile, not the old scene's coordinates.
  assert.notEqual(secondLocation.col+','+secondLocation.row,buried[0].col+','+buried[0].row,
    'a shifted tomb must relocate rather than reuse the last entrance');
  const shiftedExit=ruins.relocatedReturnAnchor();
  assert.equal(shiftedExit.area,h.zone);
  assert.equal(shiftedExit.x,(secondLocation.col+.5)*32);
  assert.equal(shiftedExit.y,(secondLocation.row+1.5)*32);
  assert.equal(h.saved().authored.tothal.dug,true,'leaving from below exposes the new burrow');
  assert.equal(h.grid()[secondLocation.row][secondLocation.col].type,'trench');
  assert.equal(ruins.activeRuinProgress().travel.activeCheckpoint,'wing-east','second shift retains progress');

  h.setWritable(false);
  assert.equal(ruins.completeActiveRuin(),false,'failed world save does not complete the tomb');
  assert.equal(h.saved().authored.tothal.completed,false);
  assert.equal(ruins.activeRuinProgress().travel.activeCheckpoint,'wing-east');
  h.setWritable(true);
  h.setExitsAvailable(false); // No random tile should fall back to the zone's safe entry, not consume progression early.
  assert.equal(ruins.completeActiveRuin(),true);
  assert.equal(h.saved().authored.tothal.completed,true,'completion retires the unique tomb');
  assert.equal(h.saved().authored.tothal.progress,undefined);
  assert.equal(h.layouts.get(h.zone).localeInstances.some(marker=>marker.localeId==='authored_tomb_tothal'),false);
  const third=Array.from({length:20},(_,i)=>'post-completion-'+i)
    .find(id=>hashString(`${h.world}|3|${id}`)%3===0);
  assert.equal(ruins.debugEnterVisit({kind:'entrance',id:third,zoneId:h.zone,returnAt:{x:12,z:12}}),true);
  await Promise.resolve();
  assert.equal(h.generated.at(-1).opts.specialBoss,false,'completed named tombs do not respawn on new sites');
  ruins.onRuinLeft();

  h.newWorld();
  assert.equal(ruins.authoredBuriedSites(h.zone).length,0,'a different world cannot inherit named tombs');

  const legacyId='hole:map_western_slope:10,11';
  const older=harness({oldSite:legacyId,oldProgress:{
    version:1,cycle:1,sites:{[legacyId]:{version:1,seed:1234,travel:{activeCheckpoint:'shaft'}}},
  }});
  older.dropZoneScene(); // The layout exists but buildZoneScene has not run, as on most Tothal shifts.
  const migrated=older.window.RuinSites.authoredBuriedSites(older.zone);
  assert.equal(migrated.length,1,'pre-update assigned guardians migrate on world load');
  assert(Number.isInteger(migrated[0].col)&&Number.isInteger(migrated[0].row),
    'unvisited wilderness receives a concrete diggable coordinate from the map layout');
  older.window.RuinSites.syncMapMarkers();
  assert(older.layouts.get(older.zone).localeInstances.some(marker=>marker.localeId==='authored_tomb_tothal'),
    'the map contains the new buried tomb before a wilderness scene is loaded');
  older.restoreZoneScene();
  assert.equal(migrated[0].seed,1234,'migration preserves the existing layout seed');
  assert.equal(older.saved().authored.tothal.progress.travel.activeCheckpoint,'shaft');
  assert(fs.readFileSync(path.join(__dirname,'../docs/js/dev-random-ruin-interior-map.js'),'utf8').includes('window.RuinSites?.relocatedReturnAnchor?.()'),
    'ordinary exit must consult the shifted named tomb, not only the story vault');
  // A world completed before Lich-hearts were introduced must still offer the missing personal relic.
  const clearedId='legacy-completed-nanahi';
  const cleared=harness({enableHeart:true,oldProgress:{
    version:1,cycle:1,sites:{},authored:{tothal:{
      siteId:clearedId,zoneId:'map_western_slope',seed:77,cycle:1,
      buried:false,dug:false,completed:true,
    }},
  }});
  const recovery=cleared.window.RuinSites;
  const recovered=recovery.authoredBuriedSites(cleared.zone);
  assert.equal(recovered.length,1,'a cleared pre-heart tomb reappears only when its character has not claimed the heart');
  assert.equal(recovered[0].siteId,clearedId,'the recovered entrance must retain the original tomb identity');
  assert.equal(recovered[0].buried,true,'previously retired non-buried entrances become a new dig spot');
  assert.equal(recovered[0].dug,false,'the recovery dig spot is not automatically opened');
  cleared.grid()[recovered[0].row][recovered[0].col].type='trench';
  cleared.window.WildTreasure.syncZoneInteractivity(cleared.zone); // The production dig hook exposes the original burrow ladder.
  assert.equal(recovery.authoredBuriedSites(cleared.zone)[0].dug,true);
  const visit={kind:'authored',theme:'tothal',id:clearedId,zoneId:cleared.zone,
    returnAt:{x:recovered[0].col+.5,z:recovered[0].row+1.5}};
  assert.equal(recovery.debugEnterVisit(visit),true);
  await Promise.resolve();
  assert.equal(cleared.generated.at(-1).opts.specialBoss,true,'recovery uses the original named sanctum, not a random ordinary ruin');
  assert.equal(cleared.generated.at(-1).seed,77,'recovery uses the original generated dungeon seed');
  assert.equal(recovery.activeRuinProgress().bossDefeated,true,'recovery must not resurrect an already defeated boss');
  assert.equal(recovery.isActiveRuinBossDefeated(77),true);
  assert.equal(recovery.isActiveRuinChestOpened('any-chest',77),true,'every completed chest is treated as looted on relic-only visits');
  assert.equal(recovery.markActiveRuinChestOpened('any-chest',77),false,'chest persistence rejects duplicate loot from completed tombs');
  assert.equal(recovery.saveActiveRuinProgress({version:1,seed:77,bossDefeated:false}),true,'recovery plays without overwriting completed progress');
  assert.equal(recovery.activeRuinProgress().bossDefeated,true,'failed puzzle progress cannot resurrect the lich');
  cleared.shift();
  const oldHeartExit=recovery.relocatedReturnAnchor(); // A Tothal Shift cannot strand a returning character inside the previously completed tomb.
  assert.equal(oldHeartExit.area,cleared.zone);
  assert(Number.isFinite(oldHeartExit.x)&&Number.isFinite(oldHeartExit.y));
  assert.equal(cleared.saved().authored.tothal.completed,true,'relocating a relic-only return preserves world completion');
  assert.equal(recovery.completeActiveRuin(),true,'leaving without claiming cannot retire the last chance for a heart');
  assert.equal(cleared.saved().authored.tothal.completed,true,'the original world completion marker remains intact');
  assert.equal(recovery.authoredBuriedSites(cleared.zone).length,1,'an unclaimed relic remains accessible after a return to the surface');
  assert.equal(recovery.debugEnterVisit(visit),true,'the player can revisit the cleared sanctum to collect the missing heart');
  await Promise.resolve();
  cleared.claimHeart('tothal');
  cleared.shift(); // The shift can also occur immediately after picking up the heart but before using the ordinary return ladder.
  const claimedHeartExit=recovery.relocatedReturnAnchor();
  assert.equal(claimedHeartExit.area,cleared.zone,'a newly claimed relic must not invalidate the current shift-exit route');
  assert(Number.isFinite(claimedHeartExit.x)&&Number.isFinite(claimedHeartExit.y));
  assert.equal(recovery.completeActiveRuin(),true,'claiming a missing heart allows normal exit without rewriting the completed tomb');
  assert.equal(recovery.authoredBuriedSites(cleared.zone).length,0,'a character who owns the heart no longer sees the retired tomb');
  cleared.releaseHeart('tothal'); // A second character in the same world has not collected the personal reward.
  assert.equal(recovery.authoredBuriedSites(cleared.zone).length,1,'a different character can still recover their own heart from the completed world');
  assert.equal(cleared.saved().authored.tothal.completed,true,'switching characters does not roll back world completion');

  console.log('Persistent authored Lich ruins and legacy heart recovery: PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
