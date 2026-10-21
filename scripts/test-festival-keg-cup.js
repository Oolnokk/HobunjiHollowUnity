#!/usr/bin/env node
'use strict';
// The player's keg cup runs through the real alcohol bridge and festival system: a temporary, ungiftable, free-refill
// cup that drinks and shares swigs exactly like a bottle (offered swigs also earn Festival Fun).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let nowMs = 1000;
const toasts = [], window = { addEventListener(){} };
const document = { readyState:'loading', addEventListener(){}, getElementById:()=>null };
const context = vm.createContext({ window, document, console, performance:{ now:()=>nowMs }, requestAnimationFrame(){}, setTimeout, clearTimeout });
const load = file => vm.runInContext(fs.readFileSync(file,'utf8'),context,{ filename:file });
let drinks = 0;
window.ResourceSystem = {};
window.FarmCrates = { init(){} }; // The bridge captures its item deps from the real init call.
load('docs/js/alcohol-gameplay-bridge.js');
const bridge = window.HobunjiDrunkGameplayBridge;
window.FarmCrates.init({ inventory:{}, ITEM_DEFS:{}, getHeldMode:()=> 'item', getActiveInventoryItem:()=>null, calendar:{ day:1, time01:.5 },
  canPlayNpcDrinkInteraction:()=>true, playNpcDrinkInteraction:(walker,key,apply)=>{ apply(); return 10; },
  beginHeldDrinkAnimation:(key,commit)=>{ commit(); return true; }, // Strike frame fires immediately in this fixture.
  showToast:(text)=>toasts.push(text), refreshItemScroll(){}, buildInventoryGrid(){}, refreshActionBar(){}, saveMemberWorldData(){}, refreshItemScroll(){} });
window.HobunjiAlcohol = { profileForDef:()=>({ footing:16, health:7 }), profileForItem:()=>null,
  drinkDef:(def,stars,key)=>{ drinks++; return { ok:true, message:`🍺 Drank a swig of ${def.label}.`, profile:{ footing:16 } }; } };
window.AmbientDialogue = { resolveAlcoholOffer:()=>({ accepted:true }), showAlcoholOfferResponse(){} };
load('docs/js/festival-calendar.js');
Object.assign(window, { CalendarSystem:{ getHour:()=>17, isInitialized:()=>true, monthNumber:()=>5, dayOfMonth:()=>8, aotYearNumber:()=>1155 } });
load('docs/js/festival-system.js');
let equips = 0;
window.FestivalSystem.init({ getTownMap:()=>null, getNpcs:()=>[], getWalkers:()=>[], equipFestivalBowl:()=>{ equips++; }, refresh(){}, save(){}, toast(){},
  getActiveItemKey:()=> 'wheel-item', getArea:()=> 'town', getHeldMode:()=> 'item', isBlocked:()=>false });
const FS = window.FestivalSystem;

assert(!bridge.getHeldItemAction(),'no cup, no inventory item: nothing to drink');
const taken = FS.takeOrRefillCup();
assert(taken.ok,'the keg hands over a cup'); assert.equal(equips,1,'the cup is equipped as the held item');
assert.deepEqual({ ...FS.festivalCup() },{ swigs:4, capacity:4, selectedItemKey:'wheel-item' });
assert.equal(FS.heldVessel().key,'festival_cup'); assert.equal(FS.vesselDef('festival_cup').spriteIcon,'festival-cup.png');
assert.equal(FS.festivalBowl(),null,'a cup is not a bowl');
let action = bridge.getHeldItemAction();
assert.equal(action.action,'consume_held_item'); assert.equal(action.swigFraction,'4/4'); assert(action.holdToCommit,'drinks like a bottle: press, hold, release');
assert.match(action.label,/Drink Festival Airag/);

assert(bridge.beginHeldItemAction(),'drinking begins through the ordinary held-item action'); assert.equal(drinks,1);
assert.equal(FS.festivalCup().swigs,3); assert.equal(bridge.getHeldItemAction().swigFraction,'3/4');
assert.equal(bridge.virtualSwigSerial(),1,'a served swig is visible to wrappers that watch bottles');

// Offering a swig to an NPC: sobriety drops by the keg strength and the festival rewards the shared round.
const walker = { rec:{ id:'pahu', name:'Pahu' } };
const offer = bridge.getNpcSwigOfferAction(walker); assert(offer && offer.swigFraction === '3/4','the swig offer shows the cup');
nowMs += 5000;
assert(bridge.offerNpcSwig(walker),'the NPC accepts a swig');
assert.equal(FS.festivalCup().swigs,2); assert(Math.abs(bridge.npcDrunkFraction('pahu') - .16) < 1e-9,'the swig changes real NPC sobriety');
assert.equal(FS.diagnostics().festivalFun.pahu,20,'offered swigs bestow Festival Fun');
assert.equal(bridge.virtualSwigSerial(),2);

// The keg is free and refills any time, even a full cup.
assert(FS.takeOrRefillCup().ok); assert.equal(FS.festivalCup().swigs,4); assert.equal(equips,2);
for (let i = 0; i < 4; i++) { nowMs += 5000; assert(bridge.beginHeldItemAction()); }
assert.equal(FS.festivalCup().swigs,0); assert.equal(drinks,5);
nowMs += 5000; bridge.beginHeldItemAction();
assert.equal(drinks,5,'an empty cup serves nothing'); assert(/empty/i.test(toasts.at(-1)),'and says why');
assert.equal(bridge.getNpcSwigOfferAction(walker),null,'an empty cup cannot be offered');
assert.equal(FS.festivalCup().swigs,0,'the empty cup is still in hand for refilling');
assert(FS.takeOrRefillCup().ok); assert.equal(FS.festivalCup().swigs,4);

// Putting the cup away (selecting another item, leaving) returns the hand to ordinary inventory items; nothing was stowed.
assert(FS.discardFestivalBowl('selected-another-item')); assert.equal(FS.festivalCup(),null); assert.equal(FS.heldVessel(),null);
assert(!bridge.getHeldItemAction());
// The festival ending removes a held cup too.
FS.takeOrRefillCup(); window.CalendarSystem.monthNumber = () => 6; FS.update(); assert.equal(FS.festivalCup(),null,'the cup does not outlive the festival');
console.log('Festival keg cup: free temporary cup, bottle-identical drinking and swig offers, Festival Fun, refills and cleanup passed.');
