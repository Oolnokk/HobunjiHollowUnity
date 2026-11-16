'use strict';
const assert = require('node:assert/strict'); // Verifies the production player preference and tap/hold state transitions.
const fs = require('node:fs'); // Loads actual runtime sources and Settings markup.
const vm = require('node:vm'); // Runs real modules with a deterministic clock rather than a browser.
const markup = fs.readFileSync('docs/index.html','utf8'); // Checks ordinary player access to the Input-tab slider.
assert.match(markup,/id="settingTapHoldExtraDelay"/);
assert.match(markup,/js\/input-hold-timing\.js/);
const inputSection = markup.slice(markup.indexOf('id="settingsSection7"'),markup.indexOf('id="settingsSection8"')); // Only the normal Input section.
assert.match(inputSection,/settingTapHoldExtraDelay/);
const callbacks = {}; // Captures touch/keyboard slider listeners.
const saved = new Map(); // Simulates durable browser preferences across sessions.
const slider = {value:'30',dataset:{},addEventListener(type,fn){callbacks[type]=fn;}}; // Player range control.
const readout = {textContent:''}; // Live value label visible on mobile.
let clock=0,holdCount=0,armCount=0,cancelCount=0; // Deterministic real-time and gesture results.
const ability = {category:'defensiveHold',onTap(){},onHoldStart(){holdCount++;},onHoldEnd(){}}; // Attack callbacks exercised by the combat input state machine.
const win = {
  localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,v)=>saved.set(key,v)},
  SCRATCHBONES_CONFIG:{game:{desktopControls:{tapWindowMs:350}}},
  Combat:{loadout:{getSlot:()=> 'test'},abilities:{get:()=>ability},deps:{player:{}},isStaggered:()=>false,update(){}},
  matchMedia:()=>({matches:true}),addEventListener(){},dispatchEvent(){}
};
const doc = {readyState:'complete',getElementById:id=>id==='settingTapHoldExtraDelay'?slider:id==='settingTapHoldExtraDelayValue'?readout:null,addEventListener(){}};
const context = {window:win,document:doc,performance:{now:()=>clock},CustomEvent:function(){},console};
vm.runInNewContext(fs.readFileSync('docs/js/input-hold-timing.js','utf8'),context);
assert.equal(win.InputHoldTiming.getExtraMs(),30);
assert.equal(readout.textContent,'+30 ms');
assert.equal(win.SCRATCHBONES_CONFIG.game.desktopControls.tapWindowMs,380);
vm.runInNewContext(fs.readFileSync('docs/js/combat/combat-input.js','utf8'),context);
const combat=win.Combat.input; // Public runtime API used by attacks and held items.
assert.equal(combat.HOLD_THRESHOLD_S,0.27);
combat.pressStart(1);
clock+=269;combat.update(0.269);
assert.equal(combat.getState(1).holding,false,'269 ms stays a tap');
clock+=1;combat.update(0.001);
assert.equal(combat.getState(1).holding,true,'270 ms arms a hold');
combat.pressEnd(1);
assert.equal(holdCount,1);
vm.runInNewContext(fs.readFileSync('docs/js/held-item-action-input.js','utf8'),context);
const held=win.HeldItemActionInput; // Reuses dynamic combat threshold rather than a second static number.
held.begin('food',{startVisual(){},onArm(){armCount++;},cancelVisual(){cancelCount++;}});
clock+=269;held.update();assert.equal(armCount,0);
held.release();assert.equal(cancelCount,1);
slider.value='80';callbacks.input();
assert.equal(win.InputHoldTiming.getExtraMs(),80);
assert.equal(combat.HOLD_THRESHOLD_S,0.32);
assert.equal(win.SCRATCHBONES_CONFIG.game.desktopControls.tapWindowMs,430);
assert.equal(readout.textContent,'+80 ms');
assert.equal(saved.get('hobunjiTapHoldExtraDelayMs.v1'),'80');
held.begin('food',{startVisual(){},onArm(){armCount++;},cancelVisual(){}});
clock+=319;held.update();assert.equal(armCount,0);
clock+=1;held.update();assert.equal(armCount,1);
held.release();
win.InputHoldTiming.setExtraMs(-80);
assert.equal(combat.HOLD_THRESHOLD_S,0.16);
win.InputHoldTiming.setExtraMs(10000);
assert.equal(win.InputHoldTiming.getExtraMs(),200);
win.InputHoldTiming.setExtraMs(NaN);
assert.equal(win.InputHoldTiming.getExtraMs(),30);
assert.equal(win.InputHoldTiming.getDebug().sliderMounted,true);
for(const path of ['docs/js/controller-selection-ui.js','docs/js/npc-command-wheel.js','docs/js/ruin-checkpoint-travel.js']){
  assert.match(fs.readFileSync(path,'utf8'),/InputHoldTiming/,'contextual selector reads the shared preference: '+path);
}
console.log('player tap/hold timing and input slider checks passed');
