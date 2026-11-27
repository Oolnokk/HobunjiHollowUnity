'use strict';
// Regression for the torch's physical action slots, the held campfire selector,
// and the three non-interactive ruin fire-hazard source implementations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8'); // Reads the committed production modules; no test-only substitute logic.
const game = read('docs/game.js'); // Shared keyboard/controller and touch input wiring.
const campfireCode = read('docs/js/wilderness-campfire.js'); // Actual persistent campfire state and action menu.
const composerCode = read('docs/js/dev-random-ruin-dungeon-fire.js'); // Standalone dungeon source braziers.
const layerCode = read('docs/js/ruin-layer-challenges.js'); // Native layered fire-ice rooms.
const checkpointCode = read('docs/js/ruin-checkpoint-travel.js'); // Shaft and jump-platform source braziers.
const findBlocksCode = read('docs/js/dev-ruin-find-blocks.js'); // Four-block room used to retain the obsolete ammo-arming brazier.

assert.match(game, /activeTool === 'adventuring'[\s\S]{0,190}button\.dataset\.action !== toolActions\.adventuring\[slot - 1\]/,
  'equipped torch actions must not be marked as contextual attack blockers');
assert.match(game, /if \(activeTool === 'adventuring'\) return adventuringToolActionButtons\(\)/,
  'campfire must leave both held torch actions reserved');
assert.match(game, /campfireActionPresses\.delete\(actionId\)/,
  'keyboard and controller Action 2 holds must pair with their original release');
assert.match(game, /_campfireMenuPress = act === 'campfire_menu'/,
  'touch arch must begin the same campfire hold on pointer-down');
assert.match(game, /WildernessCampfire\?\.endInteractionHold\?\.\('touch-arch:' \+ ev\.pointerId, pointerCanceled\)/,
  'touch pointer-up and cancel must end the correct hold');
assert.match(game, /AdventuringTools\?\.beginThrow\?\.\(inputActionId\)/,
  'torch throw retains the original hold windup input path');

const timers = new Map(); // Synthetic timeout queue verifies the hold duration deterministically.
let timerId = 0; // Unique key for each scheduled test timeout.
let combat = false; // Flips the live campfire interaction's combat eligibility.
let bandaging = true; // Starts with a bandage in progress to verify the campfire hold interrupts before it owns Action 2.
let bandageInterrupts = 0; // Only valid new holds may end bandaging, never an already-active or combat-blocked attempt.
let saves = 0; // Counts actual selections of Save Game after range checks.
let cooks = 0; // Counts actual selections of Cook Here after perk checks.
const notices = []; // Captures player-visible failure messages for out-of-range menu choices.
const listeners = {}; // Captures blur handler for testing canceled input ownership.
const player = { x:176, y:208 }; // Within reach of the saved campfire at x=5.5,z=6.5 in 32px tiles.
const scene = { add(node) { node.parent = this; }, remove(node) { node.parent = null; } }; // Minimal scene ownership for a real rendered campfire.
const arch = { mode:null, entries:null, active:-1, releaseCount:0, pointerMoves:[],
  openEntries(mode,entries) {
    this.mode = mode; this.entries = entries;
    this.active = entries.findIndex(entry => entry.initial);
  },
  currentMode() { return this.mode ? 'entries:' + this.mode : null; },
  movePointer(x,y) {
    this.pointerMoves.push([x,y]);
    if (Number.isInteger(x) && x >= 0 && x < 4) this.active = x; // Test-only coordinate convention stands in for the real arch hit test.
  },
  releaseSelection() {
    this.releaseCount++;
    const selected = this.entries?.[this.active];
    if (!selected?.disabled) selected?.onSelect?.();
    this.close();
  },
  close() { this.mode = null; this.entries = null; this.active = -1; },
}; // Exercises the existing selection arch's highlighted-choice/release contract.
const documentListeners = new Map(); // Tracks temporary touch-move forwarding and verifies cleanup.
const documentMock = {
  hidden:false,
  addEventListener(type,handler) { documentListeners.set(type,handler); },
  removeEventListener(type,handler) {
    if (documentListeners.get(type) === handler) documentListeners.delete(type);
  },
}; // Only the document-level event methods used by the real campfire input module.
function startTouch(pointerId, x = 700, y = 320) {
  documentListeners.get('pointerdown')?.({ pointerId, clientX:x, clientY:y }); // Dispatch the real capture-phase start before the HUD begins a held action.
}
const windowMock = {
  PerkSystem: { rank: discipline => discipline === 'foraging' ? 1 : 0 },
  GameplayInputRouter: { isInCombat: () => combat },
  BandageSystem: {
    cancel(reason, detail) {
      if (!bandaging) return false;
      assert.equal(reason,'world-interaction');
      assert.equal(detail.action,'campfire_menu');
      bandaging = false;
      bandageInterrupts++;
      return true;
    },
  },
  _desktopSelectionArc: arch,
  HobunjiSaveCheckpoints: { saveCampfire: async () => { saves++; return {ok:true}; } },
  CookingSystem: { openAtHearth: () => { cooks++; } },
  __farmLog() {}, addEventListener(type,handler) { listeners[type] = handler; },
}; // Supplies only production APIs used by the campfire.
const context = vm.createContext({
  window:windowMock, document:documentMock,
  setTimeout(handler,ms) { const id = ++timerId; timers.set(id, {handler,ms}); return id; },
  clearTimeout(id) { timers.delete(id); },
  performance:{now:()=>100},
}); // Controlled clock makes tap, hold and cancellation assertions deterministic.
vm.runInContext(campfireCode, context, {filename:'wilderness-campfire.js'});
const camp = windowMock.WildernessCampfire; // The actual module exported by its IIFE.
camp.init({
  getCurrentArea:()=> 'zone',
  isZoneArea:()=>true,
  isMineArea:()=>false,
  getPlayer:()=>player,
  TILE:32,
  AuthoredFurniture:{
    peek:()=>({particleEmitters:[]}),
    buildGroup:()=>({position:{set(){}},rotation:{y:0},parent:null}),
    createEmitterVisual:()=>null,
  },
  getActiveScene:()=>scene,
  isAreaSceneReady:()=>true,
  surfaceYAt:()=>0,
  showToast:message=>notices.push(message),
  persist() {},
});
camp.restore({mapId:'zone',x:5.5,y:0,z:6.5,ry:0});
camp.updateVfx(0.016);
const actions = camp.getNearbyActions(); // Real live nearby buttons after visual spawn.
assert.equal(actions.length,1,'one held campfire menu replaces three instant interactions');
assert.equal(actions[0].inputAction,'action2');
assert.equal(actions[0].requiresHold,true);
assert.equal(actions[0].holdSeconds,0.5,'without shared settings, the authored 500 ms hold remains available');
assert.equal(camp.beginInteractionHold('action2'),true);
assert.equal(bandaging,false,'starting a campfire hold releases bandaging on keyboard/controller');
assert.equal(bandageInterrupts,1);
bandaging = true;
assert.equal(camp.beginInteractionHold('action2'),false,'a second press cannot replace the active campfire hold');
assert.equal(bandaging,true,'duplicate press must not interrupt bandaging');
bandaging = false;
assert.equal(timers.size,1);
assert.equal([...timers.values()][0].ms,500,'older hosts retain the baseline hold threshold');
camp.endInteractionHold('action2');
assert.equal(timers.size,0,'tap cancels pending menu timer');
assert.equal(arch.mode,null,'tap cannot save, cook or brew');
windowMock.InputHoldTiming = { thresholdMs: ms => ms + 30 }; // Simulates the newly merged player tap/hold timing preference.
assert.equal(camp.getNearbyActions()[0].holdSeconds,0.53,'the campfire Action 2 hint reflects the player setting');
assert.equal(camp.beginInteractionHold('action2'),true);
assert.equal(camp.getDebugState().interactionHold.durationMs,530,'mobile diagnostics show the actual threshold captured on press');
const fireHoldTimer = () => { // Opens a held selector with the actual scheduled callback and verifies the configured threshold.
  assert.equal(timers.size,1,'each input owns a single hold timer');
  for(const [id,scheduled] of [...timers]) { timers.delete(id); assert.equal(scheduled.ms,530); scheduled.handler(); }
};
fireHoldTimer();
assert.equal(arch.mode,'campfire','sustained Action 2 opens the shared selection arch');
assert.equal(arch.entries.length,4);
assert.equal(arch.entries[2].disabled,true,'Herbalist-only brewing stays disabled without the perk');
assert.equal(arch.entries[3].initial,true,'Cancel is highlighted initially so release without steering never cooks or saves');
camp.endInteractionHold('action2');
assert.equal(arch.mode,null,'releasing Action 2 closes its campfire arch');
assert.equal(arch.releaseCount,1,'releasing a valid hold delegates to the shared arch selection commit');
assert.equal(cooks,0,'an untouched release chooses Cancel rather than opening the cooking interface');
assert.equal(saves,0,'an untouched release must not save');

assert.equal(camp.beginInteractionHold('action2'),true);
fireHoldTimer();
arch.active=1; // Simulates a keyboard or controller move to Cook while Action 2 stays held.
assert.equal(cooks,0,'highlighting does not commit before input release');
camp.endInteractionHold('action2');
assert.equal(cooks,1,'releasing a highlighted Cook action opens the existing cooking interface');
assert.equal(arch.mode,null,'the selected action closes the held selector');

assert.equal(camp.beginInteractionHold('action2'),true);
fireHoldTimer();
arch.active=2;
camp.endInteractionHold('action2');
assert.equal(arch.mode,null,'disabled brewing entry does not strand the arch');
assert.equal(saves,0,'a disabled entry does not trigger an unrelated selection');

assert.equal(camp.beginInteractionHold('action2'),true);
fireHoldTimer();
arch.active=0;
player.x=20*32;
camp.endInteractionHold('action2');
assert.equal(saves,0,'moving away before release discards a stale Save choice');
assert.equal(arch.mode,null,'out-of-range release cancels the campfire arch');
player.x=176;
assert.equal(camp.beginInteractionHold('action2'),true);
fireHoldTimer();
arch.active=0;
camp.endInteractionHold('action2');
assert.equal(saves,1,'valid nearby release dispatches the existing guarded campfire checkpoint');
assert(camp.getDebugState().history.some(entry => entry.event === 'campfire-action-selected' && entry.details.action === 'cook'),
  'mobile-visible debug history records the exact cooking menu action');
assert(camp.getDebugState().history.some(entry => entry.event === 'campfire-action-selected' && entry.details.action === 'save'),
  'mobile-visible debug history records the exact save menu action');
assert.equal(arch.mode,null,'save selection closes the campfire arch');
assert.equal(notices.length,0,'valid choices do not produce warning toasts');

startTouch(17);
assert.equal(camp.beginInteractionHold('touch-arch:17'),true);
startTouch(18, 702, 321); // A second finger pressing before the menu opens cannot replace the original drag origin.
fireHoldTimer();
assert.equal(documentListeners.has('pointermove'),true,'mobile Action 2 captures document-level drag while the HUD owns the pointer');
assert.equal(camp.getDebugState().interactionHold.pointerCaptured,true,'mobile diagnostics expose whether the held pointer listener is active');
const initialMoveCount = arch.pointerMoves.length; // Unrelated touch pointers cannot steer this held campfire menu.
documentListeners.get('pointermove')({pointerId:18,clientX:1,clientY:200});
assert.equal(arch.pointerMoves.length,initialMoveCount,'a second finger cannot move the campfire selection');
documentListeners.get('pointermove')({pointerId:17,clientX:704,clientY:318});
assert.equal(arch.active,3,'sub-threshold thumb jitter must leave Cancel highlighted');
assert.equal(arch.pointerMoves.length,initialMoveCount,'small touch jitter does not navigate the campfire arch');
startTouch(18, 702, 321); // A second finger must not alter the active pointer's captured press origin.
documentListeners.get('pointermove')({pointerId:17,clientX:1,clientY:200});
assert.equal(arch.active,1,'dragging the original captured touch pointer highlights Cook');
assert.equal(camp.endInteractionHold('touch-arch:18'),false,'an unrelated pointer cannot release the original hold');
assert.equal(arch.mode,'campfire','mismatched touch release leaves the menu open');
camp.endInteractionHold('touch-arch:17');
assert.equal(cooks,2,'lifting the captured touch pointer commits its dragged-to choice');
assert.equal(documentListeners.has('pointermove'),false,'release removes its document pointer listener');

startTouch(21);
assert.equal(camp.beginInteractionHold('touch-arch:21'),true);
assert.equal(documentListeners.has('pointermove'),true,'touch drag tracking begins at pointerdown, before the menu is displayed');
documentListeners.get('pointermove')({pointerId:21,clientX:1,clientY:200});
assert.equal(arch.mode,null,'dragging before hold threshold does not open the menu early');
fireHoldTimer();
assert.equal(arch.active,1,'a deliberate drag before the menu opens highlights Cook as soon as it appears');
camp.endInteractionHold('touch-arch:21');
assert.equal(cooks,3,'releasing an early pre-menu drag commits the intended option exactly once');
assert.equal(documentListeners.has('pointermove'),false,'early drag listener is released with its original press');

startTouch(24);
assert.equal(camp.beginInteractionHold('touch-arch:24'),true);
documentListeners.get('pointermove')({pointerId:24,clientX:705,clientY:321});
fireHoldTimer();
assert.equal(arch.active,3,'jitter before the timer opens the campfire arch leaves Cancel selected');
camp.endInteractionHold('touch-arch:24');
assert.equal(cooks,3,'small pre-open movement cannot accidentally cook');

documentListeners.get('pointerdown')({pointerId:1,clientX:700,clientY:320,pointerType:'mouse'});
assert.equal(camp.beginInteractionHold('desktop-mouse:0'),true);
fireHoldTimer();
documentListeners.get('pointermove')({pointerId:1,clientX:1,clientY:200});
assert.equal(arch.active,1,'held desktop mouse drag highlights the selected campfire action');
camp.endInteractionHold('desktop-mouse:0');
assert.equal(cooks,4,'desktop mouse release commits its highlighted option exactly once');
assert.equal(documentListeners.has('pointermove'),false,'mouse pointer listener is cleaned up after release');

startTouch(19);
assert.equal(camp.beginInteractionHold('touch-arch:19'),true);
fireHoldTimer();
arch.active=0;
camp.endInteractionHold('touch-arch:19',true);
assert.equal(saves,1,'pointer cancel cannot commit a highlighted action');
assert.equal(arch.mode,null,'canceled touch hold closes its arch');
assert.equal(documentListeners.has('pointermove'),false,'pointer cancel removes the transient listener');

startTouch(20);
assert.equal(camp.beginInteractionHold('touch-arch:20'),true);
fireHoldTimer();
arch.active=0;
listeners.blur();
assert.equal(saves,1,'losing focus cannot commit an open campfire selector');
assert.equal(arch.mode,null,'blur closes the open campfire selector');
assert.equal(documentListeners.has('pointermove'),false,'blur cleans the captured pointer listener');

assert.equal(camp.beginInteractionHold('action2'),true);
fireHoldTimer();
arch.mode='utilities'; // A newer unrelated selector superseded the campfire arch before its release.
const releasesBeforeReplacement = arch.releaseCount; // Verifies a stale campfire hold cannot commit another menu.
camp.endInteractionHold('action2');
assert.equal(arch.releaseCount,releasesBeforeReplacement,'late campfire release cannot commit a replacement selector');
assert.equal(arch.mode,'utilities','late campfire release leaves another selector alone');
arch.close();

assert.equal(camp.beginInteractionHold('action2'),true);
listeners.blur();
assert.equal(timers.size,0,'lost input focus cancels the campfire timer');
assert.equal(camp.getDebugState().interactionHold,null,'mobile debug reports no stale hold');
combat=true;
bandaging = true;
assert.equal(camp.beginInteractionHold('action2'),false,'campfire interaction is blocked during combat');
assert.equal(bandaging,true,'a combat-blocked campfire attempt must not cancel a bandage');
combat=false;
assert.equal(camp.beginInteractionHold('touch-arch:50'),true,'touch begins the same real campfire hold');
assert.equal(bandaging,false,'touch-arch campfire holds must also cancel bandaging');
assert.equal(bandageInterrupts,2);
camp.endInteractionHold('touch-arch:50',true);


// Verify the production shared selection-arch presenter as well as the compact unit-test
// double above. This catches changes to initial selection, slot angles, or releaseSelection.
{
  const realArcCode = read('docs/js/action-arc-ui.js'); // Actual production arch, including pointer-angle navigation and release dispatch.
  const node = () => {
    const element = { className:'', style:{}, listeners:new Map(), parent:null }; // Minimal DOM surface owned by an actual arch slot/backdrop.
    element.classList = {
      add(value) { element.className += ' ' + value; },
      remove(value) { element.className = element.className.split(/\s+/).filter(entry => entry !== value).join(' '); },
    };
    element.addEventListener = (name,callback) => element.listeners.set(name,callback);
    element.appendChild = child => { child.parent = element; return child; };
    element.remove = () => { element.parent = null; };
    return element;
  };
  const docEvents = new Map(); // Captures production document-level touch delegation and its cleanup.
  const doc = {
    body:node(), documentElement:node(), hidden:false,
    getElementById:()=>null, createElement:node,
    addEventListener(name,callback) {
      if (!docEvents.has(name)) docEvents.set(name,[]);
      docEvents.get(name).push(callback);
    },
    removeEventListener(name,callback) {
      docEvents.set(name,(docEvents.get(name)||[]).filter(listener => listener !== callback));
    },
    dispatch(name,event) { for (const callback of docEvents.get(name)||[]) callback(event); },
  };
  let nextId = 0, cooked = 0, saved = 0; // Counts actual invoked actions rather than just arch highlight changes.
  const pending = new Map(); // Deterministic in-game hold callbacks for a real arch/campfire combination.
  const playerAtCamp = { x:176, y:208 }; // Same nearby player position as the unit-test fixture.
  const fakeScene = { add(object){object.parent=this;}, remove(object){object.parent=null;} }; // Only visual membership required by campfire proximity.
  const realWindow = {
    innerWidth:800, innerHeight:600, SCRATCHBONES_CONFIG:{game:{mobileControls:{}}},
    PerkSystem:{rank:(_,perk)=>perk==='survivalist'?1:0},
    GameplayInputRouter:{isInCombat:()=>false},
    HobunjiSaveCheckpoints:{saveCampfire:async()=>{saved++;return {ok:true};}},
    CookingSystem:{openAtHearth:()=>{cooked++;}},
    addEventListener(){}, __farmLog(){},
  };
  const sceneContext = vm.createContext({
    window:realWindow, document:doc,
    getComputedStyle:()=>({getPropertyValue:()=> '30'}), // Arch radius 300px, with exact real pointer-angle hit tests.
    setTimeout(fn,ms){const id=++nextId;pending.set(id,{fn,ms});return id;},
    clearTimeout(id){pending.delete(id);},
    performance:{now:()=>1},
  });
  vm.runInContext(realArcCode,sceneContext,{filename:'action-arc-ui.js'});
  vm.runInContext(campfireCode,sceneContext,{filename:'wilderness-campfire.js'});
  realWindow.ActionArcUI.init({toolBtn:node()});
  const liveCamp = realWindow.WildernessCampfire; // Exercises actual shared openEntries/movePointer/scrollEntries/releaseSelection.
  const liveArc = realWindow._desktopSelectionArc; // Real arch presenter, not the preceding unit test's stub.
  liveCamp.init({
    getCurrentArea:()=> 'zone', isZoneArea:()=>true, isMineArea:()=>false, getPlayer:()=>playerAtCamp, TILE:32,
    AuthoredFurniture:{
      peek:()=>({particleEmitters:[]}),
      buildGroup:()=>({position:{set(){}},rotation:{y:0},parent:null}),
      createEmitterVisual:()=>null,
    },
    getActiveScene:()=>fakeScene, isAreaSceneReady:()=>true, surfaceYAt:()=>0, showToast(){}, persist(){},
  });
  liveCamp.restore({mapId:'zone',x:5.5,y:0,z:6.5,ry:0});
  liveCamp.updateVfx(0.016);
  const open = (owner='action2') => {
    assert.equal(liveCamp.beginInteractionHold(owner),true);
    assert.equal(pending.size,1);
    for(const [id,timeout] of [...pending]){pending.delete(id);timeout.fn();}
    assert.equal(liveArc.currentMode(),'entries:campfire','production arch opens under the campfire owner');
  };
  open();
  liveCamp.endInteractionHold('action2');
  assert.equal(liveArc.currentMode(),null,'real arch closes on untouched release');
  assert.equal(saved,0,'real arch defaults to Cancel, not Save');
  open();
  liveArc.scrollEntries(-1);liveArc.scrollEntries(-1); // Cancel -> disabled Brew -> Cook.
  liveCamp.endInteractionHold('action2');
  assert.equal(cooked,1,'production keyboard/controller scrolling and release commits Cook');
  doc.dispatch('pointerdown',{pointerId:42,clientX:750,clientY:520});
  assert.equal(liveCamp.beginInteractionHold('touch-arch:42'),true);
  const cookAngle = 148.3333 * Math.PI / 180; // Middle-left real shared-arch choice in a four-entry menu.
  doc.dispatch('pointermove',{
    pointerId:42,clientX:800+300*Math.cos(cookAngle),clientY:600-300*Math.sin(cookAngle),
  }); // Move before the hold timer opens to exercise deferred mobile selection.
  for(const [id,timeout] of [...pending]){pending.delete(id);timeout.fn();}
  liveCamp.endInteractionHold('touch-arch:42');
  assert.equal(cooked,2,'production touch hit-testing commits a pre-open dragged choice');
  assert.equal(docEvents.get('pointermove')?.length,0,'real touch listener is removed after release');
  doc.dispatch('pointerdown',{pointerId:43,clientX:750,clientY:520});
  open('touch-arch:43');
  doc.dispatch('pointermove',{pointerId:43,clientX:752,clientY:519});
  liveCamp.endInteractionHold('touch-arch:43');
  assert.equal(cooked,2,'production arch ignores incidental post-open finger jitter');
  assert.equal(saved,0,'production arch never saves on sub-threshold jitter');
  open();
  liveArc.scrollEntries(1); // Cancel wraps to Save.
  playerAtCamp.x=999;
  liveCamp.endInteractionHold('action2');
  assert.equal(saved,0,'actual arch cannot commit Save after losing proximity');
  playerAtCamp.x=176;
  open();
  liveArc.scrollEntries(1);
  liveCamp.endInteractionHold('action2');
  assert.equal(saved,1,'actual arch commits the highlighted Save exactly once');
  doc.dispatch('pointerdown',{pointerId:1,clientX:750,clientY:520,pointerType:'mouse'});
  open('desktop-mouse:0');
  doc.dispatch('pointermove',{
    pointerId:1,clientX:800+300*Math.cos(cookAngle),clientY:600-300*Math.sin(cookAngle),
  });
  liveCamp.endInteractionHold('desktop-mouse:0');
  assert.equal(cooked,3,'production mouse-held drag follows the shared arch and commits Cook');
  assert.equal(docEvents.get('pointermove')?.length,0,'production mouse drag listener is removed after release');

  doc.dispatch('pointerdown',{pointerId:45,clientX:750,clientY:520});
  open('touch-arch:45');
  doc.dispatch('pointermove',{pointerId:45,clientX:800+300*Math.cos(cookAngle),clientY:600-300*Math.sin(cookAngle)});
  doc.dispatch('pointermove',{pointerId:45,clientX:750,clientY:520}); // Return to the starting button after an intentional Cook drag.
  liveCamp.endInteractionHold('touch-arch:45');
  assert.equal(cooked,3,'returning an active drag toward its origin must not leave Cook latched');
  assert.equal(saved,1,'returning to origin does not accidentally save');

  doc.dispatch('pointerdown',{pointerId:46,clientX:750,clientY:520});
  assert.equal(liveCamp.beginInteractionHold('touch-arch:46'),true);
  doc.dispatch('pointermove',{pointerId:46,clientX:800+300*Math.cos(cookAngle),clientY:600-300*Math.sin(cookAngle)});
  doc.dispatch('pointermove',{pointerId:46,clientX:750,clientY:520}); // An early drag that returns home before the menu opens resets to Cancel.
  for(const [id,timeout] of [...pending]){pending.delete(id);timeout.fn();}
  liveCamp.endInteractionHold('touch-arch:46');
  assert.equal(cooked,3,'a pre-open drag back to origin defaults to Cancel');
}

assert.match(composerCode,/dungeon_fire_regular_brazier/,'solo source uses a regular low brazier');
assert.match(composerCode,/group\.userData\.fireHazard = true/,'solo source is torch-lightable');
assert.match(composerCode,/function controls\(kit\) \{\s*return \[\]/,'solo source no longer claims Action 1');
assert.match(layerCode,/contact\.userData\.fireHazard=true/,'layered bowl uses the dedicated flame-height torch ignition collider');
assert.match(layerCode,/authored\('ruinBlueBrazierBowl'/,'layered source is a true low bowl instead of a shrunken tall stand');
assert.match(layerCode,/contact\.userData\.devRuinFootprintIgnore=true/,'the flame contact geometry must not block a dungeon walkway');
assert.match(checkpointCode,/render\(shaftHeat,true\)/,'floor-zero shaft has a permanent lit torch-lighting source');
assert.match(checkpointCode,/render\(source,true\)/,'jump platforms have permanent lit torch-lighting sources');
assert.match(findBlocksCode,/contact\.userData\.fireHazard=true/,'Find the Blocks contains a precise, permanent flame collider for torch swings');
assert.match(findBlocksCode,/attachCampfireFlame/,'Find the Blocks uses the shared campfire particle emitter');
for (const [label, code] of [['solo',composerCode],['layered',layerCode],['checkpoint',checkpointCode],['find-blocks',findBlocksCode]]) {
  assert(!code.includes('Ignite Next Shot'),label+' braziers never show projectile arm interaction');
  assert(!code.includes('armNextProjectile'),label+' braziers never arm ordinary ranged projectiles');
}
console.log('Torch input, campfire hold/menu and ruin fire-hazard regressions: PASS');
