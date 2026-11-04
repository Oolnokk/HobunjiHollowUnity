#!/usr/bin/env node
'use strict';
// Executes the shipped group-standing implementation, including world-scoped save/load and overnight adjustments.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/favor-heart-balance.js', 'utf8');
const records = [
  { id:'alice', homeId:'unumanuk_household', scheduleHooks:{workBuildingId:'inn'} },
  { id:'bob', homeId:'unumanuk_household', scheduleHooks:{workBuildingId:'smithy'} },
  { id:'cora', homeId:'other_household', scheduleHooks:{workBuildingId:'inn'} },
];
const states = new Map(); // Runtime relationship ledger for all assertions.
const favor = id => { if(!states.has(id))states.set(id,{favor:0,memory:[]}); return states.get(id); };
const dialogue = {
  init() {},
  getNpcDlgState: favor,
  adjustNpcFavor(id,points) { favor(id).favor += points; },
  loadNpcRelationships(playerData) {
    states.clear();
    for (const [id, entry] of Object.entries(playerData?.npcRelationships || {})) {
      if (id === '__factions') continue;
      states.set(id,{favor:Number(entry.favor) || 0,memory:entry.memory || []});
    }
  },
  npcRelationshipsSnapshot() {
    return Object.fromEntries([...states].map(([id,st])=>[id,{favor:st.favor,memory:st.memory}]));
  },
  recordNpcMemory(id, reason) { favor(id).memory.push({event:reason}); },
  renderRelationshipHearts() { return ''; },
};
const window = { DialogueContent:dialogue, NpcGifting:{init(){},offerGift(){}}, WorldPopupText:{queueReward(){}},
  SCRATCHBONES_CONFIG:{game:{socialRelationships:{}}} };
vm.runInNewContext(source,{window,Map,Set,Math,Number,Object,String,Array,console,Date});
dialogue.init({getNpcRecords:()=>records});
const balance = window.NpcFavorBalance;
assert(balance, 'shipped Favor module installs');
const home = 'home:unumanuk_household', inn = 'work:inn', smithy = 'work:smithy'; // Independent social groups under test.
dialogue.adjustNpcFavor('alice',40,'gift_loved');
assert.equal(favor('alice').favor,40);
assert.equal(favor('bob').favor,0,'housemates no longer inherit anyone else’s Favor');
assert.equal(favor('cora').favor,0,'coworkers no longer inherit anyone else’s Favor');
assert.equal(balance.factionPoints(home),40);
assert.equal(balance.factionPoints(inn),40);
assert.equal(balance.factionRank(home),1);
assert.equal(balance.gainMultiplierForNpc('alice'),1.21,'two ranked affiliations multiply positive personal gains');
dialogue.adjustNpcFavor('bob',10,'gift_liked');
assert.equal(favor('bob').favor,11,'household rank multiplies Bob’s own earned Favor');
assert.equal(balance.factionPoints(home),51);
assert.equal(balance.factionPoints(smithy),11);
dialogue.adjustNpcFavor('cora',10,'gift_liked');
assert.equal(favor('cora').favor,11,'inn rank multiplies Cora’s Favor without changing Alice');
assert.equal(favor('alice').favor,40);
assert.equal(balance.factionPoints(inn),51);
dialogue.adjustNpcFavor('alice',-100,'gift_hated');
assert.equal(favor('alice').favor,-60,'losses are applied to the direct recipient, not amplified');
assert.equal(favor('bob').favor,11,'a reputational setback does not damage another member’s personal Favor');
assert.equal(balance.factionPoints(home),-49);
assert.equal(balance.factionRank(home),-1,'bad standing has actual negative ranks');
assert.equal(balance.gainMultiplierForNpc('bob'),.9,'negative rank slows positive gains');
const saved = {npcRelationships: dialogue.npcRelationshipsSnapshot()}; // Existing member-scoped save boundary.
assert.equal(saved.npcRelationships.__factions[home],-49,'independent group reputation is serialized in the world-member snapshot');
dialogue.loadNpcRelationships(saved);
assert.equal(balance.factionPoints(home),-49,'same member restores their faction reputation');
assert.equal(favor('bob').favor,11,'personal NPC Favor survives the same reload');
assert(!states.has('__factions'),'saved standing never creates a fake NPC');
dialogue.loadNpcRelationships({npcRelationships:{}});
assert.equal(balance.factionPoints(home),0,'different member/world starts with neutral group reputation');
assert.equal(balance.factionStandings().length,0,'no stale discovered groups remain after switching character/world');
console.log('Faction rank multipliers, negative standing, no favor duplication, and persistent world-scoped group reputation passed.');
