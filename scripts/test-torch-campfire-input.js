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
const arch = { mode:null, entries:null,
  openEntries(mode,entries) { this.mode = mode; this.entries = entries; },
  currentMode() { return this.mode ? 'entries:' + this.mode : null; },
  close() { this.mode = null; this.entries = null; },
}; // Mimics the existing ActionArcUI openEntries contract without rebuilding it.
const windowMock = {
  PerkSystem: { rank: discipline => discipline === 'foraging' ? 1 : 0 },
  GameplayInputRouter: { isInCombat: () => combat },
  _desktopSelectionArc: arch,
  HobunjiSaveCheckpoints: { saveCampfire: async () => { saves++; return {ok:true}; } },
  CookingSystem: { openAtHearth: () => { cooks++; } },
  __farmLog() {}, addEventListener(type,handler) { listeners[type] = handler; },
}; // Supplies only production APIs used by the campfire.
const context = vm.createContext({
  window:windowMock,
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
for(const [id,scheduled] of [...timers]){timers.delete(id);assert.equal(scheduled.ms,530);scheduled.handler();}
assert.equal(arch.mode,'campfire','sustained Action 2 opens the shared selection arch');
assert.equal(arch.entries.length,4);
assert.equal(arch.entries[2].disabled,true,'Herbalist-only brewing stays disabled without the perk');
camp.endInteractionHold('action2');
assert.equal(arch.mode,'campfire','releasing Action 2 leaves its menu open for selection');
arch.entries[1].onSelect();
assert.equal(cooks,1,'nearby Cook Here opens the existing cooking interface');
const saveEntry = arch.entries[0]; // Reuse the same action to test both stale and current proximity.
player.x=20*32;
saveEntry.onSelect();
assert.equal(saves,0,'moving away after opening the arch blocks a stale Save');
player.x=176;
saveEntry.onSelect();
assert.equal(saves,1,'valid nearby Save dispatches the existing guarded checkpoint');
assert(notices.some(message=>message.includes('Move closer')),'invalid menu choices report a player-visible reason');
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
