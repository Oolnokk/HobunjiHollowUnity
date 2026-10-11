'use strict';
const assert = require('node:assert/strict'); // Exercises terrain policy and interrupted input against their real owners.
const fs = require('node:fs'); // Reads the current implementation.
const vm = require('node:vm'); // Runs gameplay functions without WebGL.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Shared outdoor/cave action policy.
const start = game.indexOf('      function canUseAction('); // Isolate the real terrain gate.
const end = game.indexOf('\n      // plantCrop/harvestCrop', start); // Next owner boundary.
const terrain = {window:{GridTileAccessors:{getActiveGrid:()=>[[{type:'rock'}]],isHouseFootprint:()=>true}},TileType:{ROCK:'rock'},currentArea:'map_i_den_test',isMineableRockTile:()=>false}; // Aimed cave wall; missing rows exercise map edges.
vm.createContext(terrain);
vm.runInContext(game.slice(start,end),terrain);
for (const area of ['map_i_den_test','map_western_slope','farm']) {
  terrain.currentArea=area;
  for (const [tool,actions] of [['weapon',['cut','slash','potion_select']],['ranged',['shoot','ammo_select','potion_select']]]) {
    for (const action of actions) {
      assert.equal(terrain.canUseAction(tool,action,0,0),true,`${area}: ${action} on rock`);
      assert.equal(terrain.canUseAction(tool,action,50,50),true,`${area}: ${action} beyond grid`);
    }
  }
  assert.equal(terrain.canUseAction('pick','mine',0,0),false,'solid wall remains unmineable');
  assert.equal(terrain.canUseAction('shovel','dig',50,50),false,'terrain actions need a tile');
}
const inputSource = fs.readFileSync('docs/js/combat/combat-input.js','utf8'); // Real tap/hold owner.
let clock=0, holdActive=false, throwsOnEnd=false, throwsOnCancel=false, tapCount=0, canceledAlignment=false, alignment=null; // Observable callbacks and deterministic hold clock.
const ability = {category:'offensiveHold',onTap(){tapCount++;if(throwsOnEnd)throw Error('tap failed');},onHoldStart(){holdActive=true;},onHoldEnd(){holdActive=false;if(throwsOnEnd)throw Error('release failed');},onHoldCancel(){holdActive=false;if(throwsOnCancel)throw Error('cancel failed');}}; // Holds expose the visual lock state that cancellation must clear.
const context = {window:{Combat:{loadout:{getSlot:()=> 'test'},abilities:{get:()=>ability},isStaggered:()=>false,deps:{player:{},requestMeleeAttackAlignment(callback){alignment={runAttack:callback,cancel(){canceledAlignment=true;}};return alignment;}},update(){}},matchMedia:()=>({matches:false}),addEventListener(){},dispatchEvent(){}},document:{readyState:'loading',addEventListener(){}},performance:{now:()=>clock},requestAnimationFrame:fn=>fn(),CustomEvent:function(){},localStorage:{setItem(){}},console}; // Minimal browser input surface.
vm.runInNewContext(inputSource,context);
const input=context.window.Combat.input; // Public input API used by mobile and desktop.
function hold(slot=1){input.pressStart(slot);clock+=200;input.update(0.2);}
hold();assert(holdActive);input.cancelPress(1);assert(!holdActive,'holster/cancel releases ability windup');assert(!input.getState(1).down);
hold();throwsOnEnd=true;assert.throws(()=>input.pressEnd(1),/release failed/);assert(!input.getState(1).down,'throwing hold release cannot keep a slot down');assert(!holdActive);
input.pressStart(1);assert.throws(()=>input.pressEnd(1),/tap failed/);assert(!input.getState(1).down,'throwing tap cannot lock the next press');
throwsOnEnd=false;input.pressStart(1);input.pressEnd(1);assert.equal(tapCount,2,'next tap works after an exception');
hold(1);hold(2);throwsOnCancel=true;assert.throws(()=>input.abortAllPresses(),/cancel failed/);assert(!input.getState(1).down && !input.getState(2).down,'both slots reset even when cancellation throws');
throwsOnCancel=false;input.setAutoTargetEnabled(true,{persist:false});hold();input.pressEnd(1);assert(alignment && !holdActive,'release can be queued while alignment is pending');input.abortPress(1);assert(canceledAlignment,'cancellation cleans a released-but-pending alignment');alignment.runAttack();assert(!holdActive,'canceled alignment cannot start a delayed windup');
console.log('combat terrain policy and interrupted input recovery checks passed');
