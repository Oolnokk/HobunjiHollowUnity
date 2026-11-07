#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const caveSource=fs.readFileSync(path.join(__dirname,'../docs/js/cave-site-system.js'),'utf8'); // Full browser module, not a rewritten judge.
const gameSource=fs.readFileSync(path.join(__dirname,'../docs/game.js'),'utf8'); // Authoritative player frame dispatch checks the dev-only AI bypass.
assert.match(gameSource,/if \(window\.DevTestingSwitchbox\?\.flags\?\.noNpcBehavior\)\s+window\.CaveSiteSystem\?\.tickPuzzleRuntime\?\.\(dt\)/,
  'AI-free test mode must keep exterior and interior cave puzzles running');
let area='map_i_test_cave';
let exteriorTime=0,interiorTime=0,animationTime=0,npcTime=0;
const window={
  PuzzleCaveEntrances:{update:(dt,mapId)=>{assert.equal(mapId,area);exteriorTime+=dt;}},
  WildlifeSpawn:{
    init(deps){this.deps=deps;},
    updateHostileSpawning(dt){npcTime+=dt;},
  },
  CavernGenerator:{synthesizeCavernMapData:()=>({})},
};
vm.runInNewContext(caveSource,{window,console,setTimeout,Math,Map,Set,Number},{filename:'cave-site-system.js'});
window.WildlifeSpawn.init({getCurrentArea:()=>area,_isZoneArea:()=>false});
window.CaveSiteSystem.__test.puzzleChallengesByMapId.set(area,{
  challenge:{tick:dt=>interiorTime+=dt,animate:dt=>animationTime+=dt},
});
window.CaveSiteSystem.tickPuzzleRuntime(.2); // Frame dispatch uses this only when NPC spawning is disabled.
assert.equal(npcTime,0,'NPC ecology is still fully disabled');
assert.equal(exteriorTime,.2);
assert.equal(interiorTime,.2);
assert.equal(animationTime,.2);
window.WildlifeSpawn.updateHostileSpawning(.3); // Ordinary gameplay still uses exactly one wildlife wrapper.
assert.equal(npcTime,.3);
assert.equal(exteriorTime,.5,'normal ecology ticks do not double-update the musical score');
assert.equal(interiorTime,.5);
assert.equal(animationTime,.5);
area='map_i_other_cave';
window.WildlifeSpawn.updateHostileSpawning(.2);
assert.equal(exteriorTime,.7,'area transitions continue the outer puzzle clock');
assert.equal(interiorTime,.5,'cached cave scenes cannot receive gameplay ticks in another area');
console.log('PASS Puzzle Cave gameplay clock: normal AI and AI-free switchbox run exactly one puzzle tick per frame');
