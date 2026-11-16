'use strict';
const assert = require('node:assert/strict'); // Verifies the production player preference and tap/hold state transitions.
const fs = require('node:fs'); // Loads actual runtime sources and Settings markup.
const vm = require('node:vm'); // Runs real modules with a deterministic clock rather than a browser.
const markup = fs.readFileSync('docs/index.html','utf8'); // The entrypoint contains no tap/hold implementation or settings markup.
const timingSource = fs.readFileSync('docs/js/input-hold-timing.js','utf8'); // Standalone timing preference and player Input row owner.
const combatManifest = fs.readFileSync('docs/js/bootstrap/classic-groups/combat-main.js','utf8'); // Parser-time integration without new index.html registrations.
assert.doesNotMatch(markup,/input-hold-timing\.js|settingTapHoldExtraDelay|Tap \/ Hold Timing/);
assert.match(combatManifest,/input-hold-timing\.js\?v=/);
assert(combatManifest.indexOf('input-hold-timing.js') < combatManifest.indexOf('combat-input.js'),'timing preference initializes before combat input');
const callbacks = {}; // Captures touch/keyboard slider listeners.
const saved = new Map(); // Simulates durable browser preferences across sessions.
const slider = {value:'30',dataset:{},addEventListener(type,fn){callbacks[type]=fn;}}; // Player range control.
const readout = {textContent:''}; // Live value label visible on mobile.
const rows = []; // Tracks dynamically inserted rows and prevents duplicate controls on remount.
const heading = {after(row){rows.push(row);}}; // The standard player Input section heading.
const inputSection = {querySelector: selector => selector === '.settings-section-title' ? heading : null,prepend(row){rows.unshift(row);}}; // Player Input tab fixture.
let clock=0,holdCount=0,armCount=0,cancelCount=0; // Deterministic real-time and gesture results.
const ability = {category:'defensiveHold',onTap(){},onHoldStart(){holdCount++;},onHoldEnd(){}}; // Attack callbacks exercised by the combat input state machine.
const win = {
  localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,v)=>saved.set(key,v)},
  SCRATCHBONES_CONFIG:{game:{desktopControls:{tapWindowMs:350}}},
  Combat:{loadout:{getSlot:()=> 'test'},abilities:{get:()=>ability},deps:{player:{}},isStaggered:()=>false,update(){}},
  matchMedia:()=>({matches:true}),addEventListener(){},dispatchEvent(){}
};
const doc = {
  readyState:'complete',
  getElementById(id) {
    if (id === 'settingsSection7') return inputSection;
    if (id === 'settingTapHoldTimingRow') return rows[0] || null;
    if (!rows.length) return null;
    return id === 'settingTapHoldExtraDelay' ? slider : id === 'settingTapHoldExtraDelayValue' ? readout : null;
  },
  createElement(tag) {
    assert.equal(tag,'label');
    return {className:'',id:'',innerHTML:'',querySelector(id) {
      return id === '#settingTapHoldExtraDelay' ? slider : id === '#settingTapHoldExtraDelayValue' ? readout : null;
    }}; // Exercises the real row insertion code without a browser.
  },
  addEventListener(){}
};
const context = {window:win,document:doc,performance:{now:()=>clock},CustomEvent:function(){},console};
vm.runInNewContext(timingSource,context);
assert.equal(rows.length,1,'creates one player-visible Input row');
assert.match(rows[0].innerHTML,/min="-80" max="200" step="10"/);
assert.equal(rows[0].className,'settings-row');
assert.equal(win.InputHoldTiming.mountSetting(),true,'supports remount when Settings updates');
assert.equal(rows.length,1,'does not duplicate the Input row');
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
let resumeCount=0,abortCount=0,blocked=false; // Observe missed-frame hold commits, canceled taps and input-lock aborts.
held.init({isBlocked:()=>blocked});
held.begin('missed-frame',{startVisual(){},onArm(){armCount++;},resumeVisual(){resumeCount++;},cancelVisual(){cancelCount++;},abortVisual(){abortCount++;}});
clock+=320;
held.release(); // No update() before release: the player's real 320 ms hold must still arm.
assert.equal(armCount,2,'a stalled update does not turn a complete hold into a tap');
assert.equal(resumeCount,1,'a late-released hold resumes its animation exactly once');
assert.equal(cancelCount,1,'a late-released hold never cancels the visual');
assert.equal(held.isActive(),false,'late release clears the active item');
held.begin('short-release',{startVisual(){},resumeVisual(){resumeCount++;},cancelVisual(){cancelCount++;}});
clock+=319;
held.release();
assert.equal(resumeCount,1,'319 ms release without update is still a tap');
assert.equal(cancelCount,2,'short release cancels the visual');
held.begin('blocked-release',{startVisual(){},resumeVisual(){resumeCount++;},abortVisual(){abortCount++;}});
clock+=320;
blocked=true;held.release();blocked=false;
assert.equal(resumeCount,1,'blocked release never resumes held-item consumption');
assert.equal(abortCount,1,'blocked release aborts safely without a frame update');
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
