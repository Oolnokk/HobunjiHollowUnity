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
assert.match(game, /return \[adventuringToolActionButtons\(\)\[0\], nearbyActions\[0\]\]/,
  'campfire must leave Swing Torch on Action 1');
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
assert.equal(arch.mode,null,'save selection closes the campfire arch');
assert.equal(notices.length,0,'valid choices do not produce warning toasts');

startTouch(17);
assert.equal(camp.beginInteractionHold('touch-arch:17'),true);
startTouch(18, 702, 321); // A second finger pressing before the menu opens cannot replace the original drag origin.
fireHoldTimer();
assert.equal(documentListeners.has('pointermove'),true,'mobile Action 2 captures document-level drag while the HUD owns the pointer');
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
assert.equal(camp.beginInteractionHold('action2'),false,'campfire interaction is blocked during combat');

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
