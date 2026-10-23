// Regression for Shattercask pickup across TWO independent controller input consumers:
// ControllerSelectionUI's shared frame and game.js's physical-button dispatcher.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // All source reads use the checkout under test.
const read = file => fs.readFileSync(path.join(root, file), 'utf8'); // Keeps the fixture pinned to shipped source, not a copied handler.
const gameCode = read('docs/game.js'); // Extracts the actual canonical Tool Select branch below.
const selectorCode = read('docs/js/controller-selection-ui.js'); // Runs the real controller tap/hold adapter in a small VM.
const shatterCode = read('docs/js/shattercasks.js'); // Verifies there is no third pickup dispatcher.
const loaderCode = read('docs/js/character-action-locks.js'); // The lazy loader must fetch the updated selector.
const indexCode = read('docs/index.html'); // The lazy loader's own cache version must also change.

assert(!shatterCode.includes("'shattercask-context-actions'"),
  'Shattercasks no longer subscribe independently and trigger a second controller pickup');
assert(loaderCode.includes('controller-selection-ui.js?v=20261022shattercaskguard1'),
  'the lazy loader requests the revised controller selector');
assert(indexCode.includes('character-action-locks.js?v=20261022shattercaskguard1'),
  'shipped HTML invalidates the cached lazy loader');

const toolStart = gameCode.indexOf("if (actionId === 'toolSelect') {", gameCode.indexOf('function runInputAction('));
const toolEnd = gameCode.indexOf('if (window._desktopSelectionArc?.toolMenuOpen?.())', toolStart);
assert(toolStart > 0 && toolEnd > toolStart, 'test finds game.js\'s canonical Tool Select route');
const toolBranch = gameCode.slice(toolStart, toolEnd); // Executed, rather than reimplementing the controller pickup logic.

const toolSelectPress = { down:false, held:false, timer:null, lastScrollAt:0, contextPickup:false }; // Emulates game.js's live Tool Select gesture state.
let pickupNearby = true; // Simulates facing an intact Shattercask in range.
let heldCask = false; // Emulates the carried flag that removes the pickup prompt.
let pickups = 0; // Counts real game.js pickup dispatches.
let recalls = 0; // Must stay zero on every release belonging to a pickup.
let opened = 0; // Must stay zero for a held pickup that outlives the selector threshold.
let timerCount = 0; // Detects whether pickup accidentally starts the normal tool-select timer.
let now = 1000; // Drives the selector's tap/hold thresholds with deterministic frames.
const binding = { toolSelect:'Button5', itemSelect:null, utilityMenu:null, socialWheel:null }; // Remaps to Button9 in the second scenario.

const windowMock = {
  addEventListener() {},
  Shattercasks: {
    toolArchAction: () => pickupNearby ? 'pickup' : null,
    toolArchTap: () => {
      if (!pickupNearby) return false;
      pickupNearby = false;
      heldCask = true;
      pickups++;
      return true;
    },
  },
  InputBindings: { getCurrentBindings: () => ({ controller:binding }) },
  ControllerUI: { isActive: () => false },
  ControllerInput: {
    PRIORITY: { selection:20 },
    subscribe(name, callback) { this.selectorCallback = callback; return () => {}; },
    setOwner() {},
  },
  _desktopSelectionArc: {
    recallLastTool() { recalls++; },
    openTool() { opened++; },
    releaseSelection() {},
    toolMenuOpen() { return false; },
  },
}; // One production-like shared global for both controller consumers.
const timers = new Map(); // Identifies any ordinary selection hold timer incorrectly armed during pickup.
const toolContext = {
  window:windowMock,
  toolSelectPress,
  desktopTapWindowMs: () => 350,
  setTimeout(callback) { const id = ++timerCount; timers.set(id,callback); return id; },
  clearTimeout(id) { timers.delete(id); },
}; // Only the dependencies read by the production Tool Select branch.
const runToolSelect = vm.runInNewContext(
  '(function(actionId, phase) { ' + toolBranch + ' })', toolContext,
  { filename:'game-tool-select-branch.js' },
); // Ensures changes to the real game branch are exercised here.

const selectorContext = {
  window:windowMock,
  performance:{ now:() => now },
  console,
}; // Supplies the minimal browser globals read by ControllerSelectionUI.
vm.createContext(selectorContext);
vm.runInContext(selectorCode, selectorContext, { filename:'controller-selection-ui.js' });
const select = windowMock.ControllerInput.selectorCallback; // Shared-frame callback captured from production subscribe().
assert.equal(typeof select,'function','controller selector installs its shared-frame callback');

function frame(code, down, fresh, time) {
  now = time;
  return {
    pad:{index:0,axes:[0,0,0,0]},
    now,
    pressed:new Set(fresh ? [code] : []),
    isDown: name => down && name === code,
  };
} // Simulates the independent ControllerInput frame that runs before gameplay polling.

function pickupGesture(code, startTime, holdDuration) {
  assert.equal(binding.toolSelect,code,'fixture uses the configured Tool Select input');
  const before = pickups;
  select(frame(code,true,true,startTime)); // ControllerSelectionUI runs before game.js.
  assert.equal(windowMock.ControllerSelectionUI.getDebug().suppressedCarryToolSelectCode,code,
    'the controller selector reserves the complete pickup press');
  runToolSelect('toolSelect','press'); // The real physical button route performs pickup.
  assert(heldCask,'the canonical game controller handler picked up the Shattercask');
  assert.equal(pickups,before+1,'one physical press causes exactly one pickup');
  assert.equal(toolSelectPress.contextPickup,true,'native handler reserves its corresponding release');
  assert.equal(timerCount,0,'pickup never starts the ordinary tool-selector hold timer');
  select(frame(code,true,false,startTime+holdDuration)); // May exceed the normal 350ms selection threshold.
  assert.equal(windowMock.ControllerSelectionUI.getDebug().pendingAction,null,
    'no tap recall remains pending after pickup');
  assert.equal(windowMock.ControllerSelectionUI.getDebug().activeAction,null,
    'holding the pickup does not open the tool selector');
  select(frame(code,false,false,startTime+holdDuration+10));
  runToolSelect('toolSelect','release');
  assert.equal(toolSelectPress.contextPickup,false,'the pickup guard clears on the matched release');
  assert.equal(toolSelectPress.down,false,'the canonical tool input returns to idle');
  assert.equal(windowMock.ControllerSelectionUI.getDebug().suppressedCarryToolSelectCode,null,
    'the selector guard returns to idle on release');
  assert.equal(recalls,0,'releasing a Shattercask pickup never equips/replaces a tool');
  assert.equal(opened,0,'a long Shattercask pickup does not open the selector');
}

pickupGesture('Button5',1000,100); // Quick tap.
pickupNearby = true; heldCask = false;
binding.toolSelect = 'Button9'; // Current controller remapping must remain authoritative.
pickupGesture('Button9',2000,600); // Long hold.

const normalBefore = recalls;
runToolSelect('toolSelect','press'); // No Shattercask is in pickup range now.
assert.equal(timers.size,1,'ordinary Tool Select still starts its tap/hold timer');
runToolSelect('toolSelect','release');
assert.equal(recalls,normalBefore+1,'ordinary Tool Select still recalls the remembered tool');
assert.equal(timers.size,0,'normal Tool Select release cleans up its timer');
console.log('PASS shattercask controller: single pickup, no selector recall on tap/hold, remap and normal tool selection');
