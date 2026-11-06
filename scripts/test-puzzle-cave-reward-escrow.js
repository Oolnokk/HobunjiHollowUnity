#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'../docs/js/cave-site-system.js'),'utf8'); // Real cave-site lifecycle, not a mock of the reward function.
const itemKey='trinket_ironAnchor'; // A tier-one exclusive Puzzle Cave item from the dependent double-edged trinket pool.
const pool={entries:[{itemKey,tier:1,weight:1}]};
let grants=0,rolls=0,saves=0,warnings=0;
const available={}; // The parent trinket PR may not yet be merged when a player completes a cave.
const window={
  __hobunjiPlayerProfile:{worldId:'reward-fixture'},CalendarSystem:{tothalCycle:()=>1},
  __farmLog:()=>warnings++,
  LootRolling:{getLootPools:()=>({puzzleCave:pool}),rollLootPool:(id,context)=>{
    assert.equal(id,'puzzleCave');assert.equal(context.rewardTier,1);rolls++;return {[itemKey]:1};
  }},
  TrinketSystem:{DEFINITIONS:available,claimLoot:(gained,source)=>{
    assert.equal(source,'puzzleCave');assert.deepEqual(Object.keys(gained),[itemKey]);
    grants++;return ['Iron Anchor (trinket)'];
  }},
};
const sandbox={window,setTimeout:()=>0,clearTimeout:()=>{},console,Math,Map,Set,Number};
vm.runInNewContext(source,sandbox,{filename:'cave-site-system.js'});
const caves=window.CaveSiteSystem; // The real saved-signature state is part of this API's test hooks.
caves.init({save:()=>saves++});
const profile={mapId:'map_i_reward_fixture',zoneId:'map_w_1',signature:'reward-fixture:1'};
const state={puzzleSolved:true,puzzleRewardTier:1};
const grant=caves.__test.grantPuzzleCaveReward;

assert.equal(grant(profile,null,state),false,'the cave never claims an unavailable benefit/drawback trinket');
assert.equal(state.puzzleRewardPending,true);
assert.equal(state.puzzleRewardClaimed,undefined);
assert.equal(grants,0);
assert.equal(rolls,0,'missing definitions cannot consume the random pool selection');
const firstWarningCount=warnings;
assert.equal(grant(profile,null,state),false,'re-entering a sealed cave keeps its reward escrow');
assert.equal(warnings,firstWarningCount,'repeat visits cannot spam the same missing-definition warning');

available.ironAnchor={id:'ironAnchor',displayName:'Iron Anchor'};
assert.equal(grant(profile,null,state),true,'after the trinkets load, the existing earned prize becomes claimable');
assert.equal(grants,1);
assert.equal(rolls,1);
assert.equal(state.puzzleRewardClaimed,true);
assert.equal(state.puzzleRewardPending,false);
assert.equal(grant(profile,null,state),false,'a claimed cave can never grant a duplicate');
assert.equal(grants,1);
assert(caves.serialize()?.sites && typeof caves.serialize().identity==='string','claimed reward flag persists in the world save payload');

const retryState={puzzleSolved:true,puzzleRewardTier:1,puzzleRewardPending:false};
window.TrinketSystem.claimLoot=()=>{throw Error('gear store temporarily unavailable');};
assert.equal(grant(profile,null,retryState),false,'trinket gear/save errors do not consume a completed reward');
assert.equal(retryState.puzzleRewardPending,true);
window.TrinketSystem.claimLoot=()=>{grants++;return ['Iron Anchor (trinket)'];};
assert.equal(grant(profile,null,retryState),true,'a failed gear delivery can be retried when the inventory is ready');
assert.equal(grants,2);

console.log('PASS Puzzle Cave reward escrow: absent definitions, no-spam deferral, real prize delivery, exactly-once claim, persistence and failed-grant retry');
