#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const game = fs.readFileSync('docs/game.js', 'utf8'); // Used below to exercise the real keyboard/controller and touch Dodge dispatcher seams.
const downedSource = fs.readFileSync('docs/js/player-downed.js', 'utf8'); // Loaded as-is to test the shipped downed-state owner.
const handlers = new Map(); // Captures focus and touch events without needing a browser.
const makeElement = () => ({
  style: {}, textContent: '', children: [],
  appendChild(child) { this.children.push(child); return child; },
}); // Mimics only the DOM APIs used by the downed HUD.
const document = {
  hidden: false,
  body: makeElement(),
  createElement: makeElement,
  addEventListener(type, handler) { handlers.set('document:' + type, handler); },
};
const player = { health: 0, maxHealth: 100, vx: 0, vy: 0, invulnUntil: 0 }; // The same player object survives voluntary respawn and Second Wind.
const respawns = []; // Captures reasons handed to the canonical death callback.
const crawlChanges = []; // Confirms give-up resets the crawl pose.
let nowMs = 1000; // Monotonic wall-clock fake advanced independently of simulation dt.
let dodgeLabel = 'B'; // Simulates the current controller binding; changed later to test live HUD refresh.
let ordinaryDodges = 0; // Counts standing touch presses so the feature cannot eat normal Dodge.
const context = {
  document, performance: { now: () => nowMs }, Date, console,
  PlayerCrawl: { setActive(active) { crawlChanges.push(active); } },
  ActionPromptUI: { actionPromptGlyph(action, touch) {
    assert.equal(action, 'dodge');
    assert.equal(touch, 'Dodge');
    return dodgeLabel;
  } },
  addEventListener(type, handler) { handlers.set('window:' + type, handler); },
};
context.window = context;
vm.createContext(context);
vm.runInContext(downedSource, context, { filename: 'docs/js/player-downed.js' });
const PD = context.PlayerDowned;
PD.init({
  player,
  showToast() {},
  forceRangedTool: () => true,
  die(reason) { respawns.push(reason); },
});

const tick = (seconds, simulationDt = seconds) => { nowMs += seconds * 1000; PD.update(simulationDt); }; // Separates elapsed real time from simulation-frame time.

assert.equal(PD.CONFIG.giveUpHoldSeconds, 1.5);
assert.equal(PD.setGiveUpHeld(true), false, 'Dodge never starts a hold when standing');
assert.equal(PD.tryDown('combat'), true);
tick(0.01);
const root = document.body.children[0]; // References the existing downed overlay whose bottom child is the prompt.
const promptWrap = root.children[1]; // The visible prompt is separate from the bleed-out panel.
assert.equal(promptWrap.children[0].textContent, 'Hold B to respawn');
assert.match(promptWrap.style.cssText, /KhymeryyanRomanLetters\+Numbers/, 'prompt uses the actual game font');
assert.match(promptWrap.style.cssText, /bottom:/, 'the hint is anchored at the bottom');
assert.equal(PD.setGiveUpHeld(true), true);
tick(0.7);
assert.equal(respawns.length, 0, 'partial hold does not respawn');
assert(PD.debugSnapshot().giveUpHoldS >= 0.7);
PD.setGiveUpHeld(true);
tick(0.3);
assert.equal(respawns.length, 0, 'repeated keydown does not restart or immediately finish a hold');
PD.setGiveUpHeld(false);
assert.equal(PD.debugSnapshot().giveUpHoldS, 0, 'button-up resets hold progress');
tick(0.5);
assert.equal(respawns.length, 0, 'release cancels a would-be give up');
dodgeLabel = 'R';
tick(0.01);
assert.equal(promptWrap.children[0].textContent, 'Hold R to respawn', 'rebinding/device changes refresh the hint');
PD.setGiveUpHeld(true);
tick(1.49, 0.04); // At low FPS only 40 ms of simulation time has elapsed; surrender must use real elapsed time.
assert.equal(respawns.length, 0);
tick(0.01, 0.01);
assert.deepEqual(respawns, ['give-up'], 'completion uses the existing death callback exactly once');
assert.equal(player.health, 0);
assert.equal(PD.isDowned(), false);
assert.equal(root.style.display, 'none', 'respawn clears the entire downed overlay');
assert.equal(crawlChanges.at(-1), false);
assert.equal(PD.debugSnapshot().lastEvent.type, 'give-up', 'mobile diagnostics report voluntary respawn');
tick(10);
assert.equal(respawns.length, 1, 'later frames never repeat the respawn');

player.health = 0;
PD.tryDown('damage');
PD.setGiveUpHeld(true);
tick(0.8);
handlers.get('window:blur')();
assert.equal(PD.debugSnapshot().giveUpHeld, false, 'losing focus cancels hold');
assert.equal(PD.debugSnapshot().giveUpHoldS, 0);
PD.setGiveUpHeld(true);
document.hidden = true;
handlers.get('document:visibilitychange')();
assert.equal(PD.debugSnapshot().giveUpHeld, false, 'hiding the tab cancels hold');
document.hidden = false;
PD.secondWind('test');
assert.equal(PD.isDowned(), false, 'Second Wind remains available after an incomplete hold');
assert.equal(PD.setGiveUpHeld(true), false, 'a key held after revival cannot cause delayed respawn');

player.health = 0;
PD.tryDown('damage');
PD.setGiveUpHeld(true);
tick(1);
PD.reset();
assert.equal(PD.isDowned(), false, 'checkpoint/scripted reset clears surrender progress');
player.health = 0;
PD.tryDown('damage');
tick(1);
assert.equal(PD.debugSnapshot().giveUpHoldS, 0, 'the next downed state starts with an empty hold');
PD.reset();

// Pausing must cancel the hold before the monotonic clock can advance while no game-frame updates run.
const pauseGuard = 'if (paused) window.PlayerDowned?.setGiveUpHeld?.(false);'; // Exact game-loop statement to execute with a paused synthetic frame.
assert(game.includes(pauseGuard), 'the gameplay frame cancels the surrender hold on pause');
player.health = 0;
PD.tryDown('combat');
PD.setGiveUpHeld(true);
vm.runInNewContext(pauseGuard, { paused: true, window: context });
assert.equal(PD.debugSnapshot().giveUpHeld, false, 'pause drops the physical hold');
tick(3, 0.04);
assert.equal(respawns.length, 1, 'a long pause cannot retroactively finish the hold');
PD.reset();

// Execute the opening guard from the real keyboard/controller dispatcher. Its
// normal-action body needs the full game, but the downed guard executes first.
const inputStart = game.indexOf("function runInputAction(actionId, phase = 'press') {");
const inputEnd = game.indexOf("if (actionId === 'perceptionMode')", inputStart);
assert(inputStart >= 0 && inputEnd > inputStart, 'gameplay input has a downed Dodge guard');
const inputContext = {
  window: context,
  HobunjiOnboarding: null,
};
inputContext.window = context;
vm.createContext(inputContext);
vm.runInContext(game.slice(inputStart, inputEnd) + '\n}', inputContext);
player.health = 0;
PD.tryDown('damage');
inputContext.runInputAction('dodge', 'press');
assert.equal(PD.debugSnapshot().giveUpHeld, true, 'remapped keyboard/controller Dodge press starts the same hold');
inputContext.runInputAction('dodge', 'release');
assert.equal(PD.debugSnapshot().giveUpHeld, false, 'keyboard/controller release cancels the same hold');
PD.reset();

// Execute the actual touch listeners rather than duplicating touch behavior
// in a mocked implementation.
const touchStart = game.indexOf('let downedDodgePointerId = null;');
const touchEnd = game.indexOf('// Weapon quick-switch button', touchStart);
assert(touchStart >= 0 && touchEnd > touchStart, 'game includes touch Dodge hold wiring');
const touchHandlers = new Map(); // Captures pointerdown/up/cancel/lostpointercapture from the real touch binding.
const dodgeBtn = {
  addEventListener(type, handler) { touchHandlers.set(type, handler); },
  setPointerCapture() {},
};
const touchContext = { window: context, document, dodgeBtn, performContextAction() { ordinaryDodges++; } };
vm.createContext(touchContext);
vm.runInContext(game.slice(touchStart, touchEnd), touchContext);
const pointer = id => ({ pointerId: id, preventDefault() {} });
touchHandlers.get('pointerdown')(pointer(7));
assert.equal(ordinaryDodges, 1, 'standing touch tap still invokes normal Dodge');
player.health = 0;
PD.tryDown('damage');
touchHandlers.get('pointerdown')(pointer(8));
assert.equal(PD.debugSnapshot().giveUpHeld, true, 'touch Dodge press starts the downed hold');
touchHandlers.get('pointerup')(pointer(9));
assert.equal(PD.debugSnapshot().giveUpHeld, true, 'another pointer cannot cancel it');
touchHandlers.get('pointercancel')(pointer(8));
assert.equal(PD.debugSnapshot().giveUpHeld, false, 'touch cancellation resets hold');
PD.reset();

console.log('ok: downed Dodge give-up, input ownership, HUD and cancellation');
