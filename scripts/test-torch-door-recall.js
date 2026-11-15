'use strict';
const assert = require('node:assert/strict'); // Checks production recall, torch stow and door dispatch behavior.
const fs = require('node:fs'); // Reads the actual shipped game/editor files.
const vm = require('node:vm'); // Runs focused production functions without booting the whole 3D world.
const read = path => fs.readFileSync(path, 'utf8'); // Shares one file reader across the integration probes.
const game = read('docs/game.js'); // Authoritative equipment and action-bar source.
const arch = read('docs/js/action-arc-ui.js'); // Shared keyboard/controller/touch tool recall presenter.
const ruin = read('docs/js/dev-random-ruin-interactions.js'); // World interaction owner for native transit doors.
const sourceBetween = (source, start, end) => { // Extracts whole existing function bodies from their real source.
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, 'missing integration seam: ' + start);
  return source.slice(from, to);
};

let lit = false, stows = 0, holsters = 0; // Verifies flame lifetime across temporary selections.
const equipment = {
  activeTool: 'shovel', heldMode: 'tool', activeAction: 'dig', lastHeldFarmTool: 'shovel',
}; // Mutable game state used by the production setActiveTool closure.
const toolActions = { shovel: ['dig'], adventuring: ['torch_swing', 'torch_throw'], weapon: ['slash'] }; // Action validation fixture mirrors real tool slot IDs.
const equipmentSlots = { shovel: 'shovel', adventuring: 'torch', weapon: 'plainssword' }; // Equipment slots are never cleared by a temporary switch.
const buttonListeners = {}; // Touch events captured from ActionArcUI, not rewritten gesture logic.
const toolBtn = {
  style: {}, setPointerCapture() {},
  addEventListener(name, callback) { buttonListeners[name] = callback; },
}; // Minimal tool button to exercise an actual pointer tap.
const win = {
  AdventuringTools: { stow() { lit = false; stows++; } },
  Spyglass: { stow() {} },
  HudUpdate: { refreshItemScroll() {} },
  SCRATCHBONES_CONFIG: { game: { mobileControls: {} } },
}; // Shared browser namespace for both real integration functions.
const gameContext = vm.createContext({
  window: win, WHEEL_SLOTS: ['shovel'], equipmentSlots, toolActions,
  TOOL_ITEM_DEFS: { shovel: { label: 'Shovel' }, torch: { label: 'Torch' }, plainssword: { label: 'Sword' } },
  activeTool: equipment.activeTool, heldMode: equipment.heldMode, activeAction: equipment.activeAction,
  lastHeldFarmTool: equipment.lastHeldFarmTool, pendingAction: null,
  combatSwingAnim: null, combatSwingPose: null, combatSwingCone: null, toolSwingT: 0,
  toolBtnIcon: {}, toolBtnLabel: {}, toolMeshMap: {},
  toolHolder: { remove() {}, add() {} },
  toolSelectIconHTML() { return ''; }, refreshActionBar() {}, refreshWeaponSwitchBtn() {},
  saveEquipmentSlots() {}, showToast() {}, cancelWeaponSwingHold() {},
}); // Supplies only dependencies actually read by game.js's existing selector.
const activeToolSource = sourceBetween(game, '      function setActiveTool(tool, opts = {}) {', '\n      // Weapon quick-switch icon');
const setActiveTool = vm.runInContext(activeToolSource + '\nsetActiveTool', gameContext); // Executes production switching, including stow and selected-tool memory.

const doc = {
  getElementById() { return null; },
  addEventListener() {},
}; // The test calls the tool button directly; unrelated item/utility controls are absent.
const touchContext = vm.createContext({
  window: win, document: doc, setTimeout: () => 17, clearTimeout() {},
  performance: { now: () => 0 },
}); // Timer stub prevents a tap from accidentally becoming a long selector hold.
vm.runInContext(arch, touchContext);
win.ActionArcUI.init({
  toolBtn, WHEEL_SLOTS: ['shovel'], equipmentSlots,
  getActiveTool: () => gameContext.activeTool,
  getHeldMode: () => gameContext.heldMode,
  setHeldMode: mode => { if (mode !== 'tool') win.AdventuringTools.stow(); gameContext.heldMode = mode; },
  getLastHeldFarmTool: () => gameContext.lastHeldFarmTool,
  setLastHeldFarmTool: value => { gameContext.lastHeldFarmTool = value; },
  setActiveTool,
  putAwayHeldEquipment: () => { holsters++; gameContext.heldMode = 'none'; win.AdventuringTools.stow(); },
  refreshActionBar() {}, toolSelectIconHTML() { return ''; },
}); // Uses the real shared ActionArcUI and the real setActiveTool callback.
const tapTool = () => {
  const event = { pointerId: 11, clientX: 5, clientY: 5, preventDefault() {} }; // Stable pointer identity exercises tap-not-hold.
  buttonListeners.pointerdown(event);
  buttonListeners.pointerup(event);
}; // Routes the mobile touch button through production listeners.

setActiveTool('adventuring', { silent: true }); // Selecting Torch in the adventuring gateway sets the recall target.
assert.equal(gameContext.lastHeldFarmTool, 'adventuring');
lit = true;
setActiveTool('weapon', { silent: true }); // Quick weapon draw must extinguish the torch, not replace tool recall.
assert.equal(lit, false);
assert.equal(gameContext.lastHeldFarmTool, 'adventuring');
const stowsBeforeRecall = stows; // Re-equipping an unlit torch must not trigger another stow.
tapTool();
assert.equal(gameContext.activeTool, 'adventuring', 'tap while holding a temporary sword draws the selected torch');
assert.equal(gameContext.heldMode, 'tool');
assert.equal(stows, stowsBeforeRecall);
assert.equal(lit, false, 'restored torch is unlit');
lit = true;
tapTool();
assert.equal(gameContext.heldMode, 'none', 'tapping the selected torch again holsters it');
assert.equal(lit, false, 'holstering extinguishes the flame');
assert.equal(holsters, 1);
setActiveTool('adventuring', { silent: true });
lit = true;
win.AdventuringTools.stow();
gameContext.heldMode = 'item'; // Mirrors ActionArcUI's real setHeldMode('item') bridge; no re-ignition on recall.
tapTool();
assert.equal(gameContext.activeTool, 'adventuring');
assert.equal(gameContext.heldMode, 'tool', 'tool tap recalls after an inventory item was held');
assert.equal(lit, false);
setActiveTool('shovel', { silent: true });
assert.equal(gameContext.lastHeldFarmTool, 'shovel', 'explicitly changing the selected farm tool replaces torch recall');
setActiveTool('weapon', { silent: true });
assert.equal(win._desktopSelectionArc.recallLastTool(), 'shovel');
assert.equal(gameContext.activeTool, 'shovel');
assert.match(arch, /if \(deps\.WHEEL_SLOTS\.includes\(slot\.data\)\) deps\.setLastHeldFarmTool\(slot\.data\)/, 'wheel-selected weapons cannot clobber selected tools');

const doorFunction = sourceBetween(game, '      function adventuringToolActionButtons() {', '\n      function computeActionButtonsImpl()'); // The canonical action-provider function, including its reticle context.
const wood = { getButtons: () => [
  { action: 'obj_door_toggle', label: 'Open Door', allowed: true },
  { action: 'obj_process_furnace', label: 'Cook', allowed: true },
] }; // A real door action next to an unrelated furniture action.
const doorContext = vm.createContext({
  window: {
    GridTileAccessors: { getActiveGrid: () => [[{}]] },
    HudUpdate: { contextualActionLabel: action => action },
    FurnitureTableSystem: { objectAt: () => wood },
    DevRandomRuinInteractions: { getDoorActionButtons: () => [{ action: 'dev_ruin_world_0', label: 'Open Ruin Door', inputAction: 'interact' }] },
  },
  currentArea: 'farm', toolActions, getReticleTile: () => ({ col: 0, row: 0 }),
  actionLabels: { torch_swing: ['🔥'], torch_throw: ['🔥'] },
  attackActionIconHTML: (tool, action) => action,
  canUseAction: () => true,
  getInteriorInteractableAt: () => wood,
  _isBuildingArea: id => id === 'map_i_dev_random_ruin' || id === 'building',
  _buildingInteractables: new Map(),
}); // One actual action provider tested across outdoor, farmhouse and V50 settings.
const doorButtons = vm.runInContext(doorFunction + '\nadventuringToolActionButtons', doorContext);
const farmActions = doorButtons();
assert.deepEqual(Array.from(farmActions, x => x.action), ['torch_swing', 'torch_throw', 'obj_door_toggle']);
assert.equal(farmActions[2].inputAction, 'interact', 'wooden door has separate Interact instead of replacing Torch Swing');
assert.equal(farmActions[2].worldInteraction, true);
doorContext.currentArea = 'interior';
assert.equal(doorButtons()[2].action, 'obj_door_toggle', 'house doors stay usable with a torch');
doorContext.currentArea = 'map_i_dev_random_ruin';
assert.deepEqual(Array.from(doorButtons(), x => x.action), ['torch_swing', 'torch_throw', 'dev_ruin_world_0'], 'native ruin door is an additional context action');
doorContext.window.DevRandomRuinInteractions.getDoorActionButtons = () => [];
assert.deepEqual(Array.from(doorButtons(), x => x.action), ['torch_swing', 'torch_throw'], 'unrelated world prompts cannot suppress Swing/Throw');

const methods = sourceBetween(ruin, '    getDoorActionButtons() {', '    invoke(index = 0) {'); // Tests native-door filtering and exact onPress ownership.
let opens = 0;
const nativeRows = [
  { kind: 'transitdoor', action: 'dev_ruin_world_0', onPress: () => { opens++; }, label: 'Open' },
  { kind: 'interactive', action: 'dev_ruin_world_1', onPress: () => { throw Error('Unrelated mechanism fired'); } },
  { kind: 'v50nativetransitdoor', action: 'dev_ruin_world_2', onPress: () => { opens++; } },
]; // Native door and unrelated control rows from one cached discovery snapshot.
const nativeContext = vm.createContext({
  inRuin: () => true, performance: { now: () => 100 }, lastRowsAt: 100,
  lastRows: nativeRows,
  refreshRows: () => nativeRows,
  PROXIMITY_DOOR_KINDS: new Set(['transitdoor', 'v50nativetransitdoor']),
  actionButtonsFromRows: rows => rows.map(row => ({ action: row.action, label: row.label, inputAction: 'action1' })),
}); // The real provider methods run against a controlled list of existing interaction rows.
const native = vm.runInContext('({' + methods + '})', nativeContext);
assert.deepEqual(Array.from(native.getDoorActionButtons(), x => x.action), ['dev_ruin_world_0', 'dev_ruin_world_2']);
assert(native.getDoorActionButtons().every(x => x.inputAction === 'interact' && x.style === 'secondary'));
assert.equal(native.invokeDoorAction('dev_ruin_world_1'), false, 'torch interaction cannot fire an unrelated mechanism');
assert.equal(native.invokeDoorAction('dev_ruin_world_2'), true);
assert.equal(opens, 1);

const floatingPopup = sourceBetween(ruin, '  function syncWorldPopup(rows) {', '  function refreshRows('); // The actual world popup must advertise Interact when Torch Swing owns Action 1.
let heldTorchForPopup = true, lastPopup = null; // Toggles the door glyph without changing its saved/owned action.
const floatingContext = vm.createContext({
  window: {
    AdventuringTools: { isHoldingTorch: () => heldTorchForPopup },
    WorldPopupText: { syncInteractionPrompts(value) { lastPopup = value; } },
  },
  actionButtonsFromRows: rows => rows.map(row => ({ action: row.action, inputAction: 'action1', worldInteraction: true })),
  PROXIMITY_DOOR_KINDS: new Set(['transitdoor', 'v50nativetransitdoor']),
  promptAnchor: { parent: true }, lastAnchor: null, ruinRoot: () => null,
  currentDevice: () => 'keyboard', bindingLabel: id => id, inputColor: id => id,
  inRuin: () => true, activeScene: () => ({}),
}); // Reuses the same mapped popup helper as the live V50 provider.
const syncDoorPopup = vm.runInContext(floatingPopup + '\nsyncWorldPopup', floatingContext);
syncDoorPopup(nativeRows);
assert.equal(lastPopup.promptInputs[0].actionId, 'interact', 'torch-held ruin door advertises Interact, not its now-suppressed Action 1');
assert.equal(lastPopup.promptInputs[1].actionId, 'action1', 'unrelated world-control binding is unchanged');
assert.equal(lastPopup.promptInputs[2].actionId, 'interact');
heldTorchForPopup = false;
syncDoorPopup(nativeRows);
assert.equal(lastPopup.promptInputs[0].actionId, 'action1', 'ordinary door action binding is retained without torch');

const doorDispatch = sourceBetween(game, "        if (activeAction === 'obj_door_toggle') {", "        if (activeTool === 'shovel') {"); // Immediate door actions must bypass the shared torch swing clock.
let worldSaves = 0, notifications = 0, refreshes = 0;
const dispatchContext = vm.createContext({
  activeAction: 'obj_door_toggle', activeTool: 'adventuring',
  resolveObjActionTarget: () => ({ onAction: () => { opens++; return { ok: true, message: 'Opened the door.' }; } }),
  showToast() { notifications++; }, saveMemberWorldData() { worldSaves++; },
  refreshActionBar() { refreshes++; }, window: {
    DevRandomRuinInteractions: { invokeDoorAction: id => id === 'dev_ruin_world_2' && (++opens > 0) },
  },
}); // Counts real world-action dispatch calls without executing unrelated movement/gameplay.
const fireDoor = vm.runInContext('(function () { ' + doorDispatch + ' })', dispatchContext);
fireDoor();
assert.equal(opens, 2);
assert.equal(worldSaves, 1);
assert.equal(notifications, 1);
dispatchContext.activeAction = 'dev_ruin_world_2';
fireDoor();
assert.equal(opens, 3);
assert.equal(refreshes, 2);
assert.match(game, /act\.startsWith\('dev_ruin_world_'\)/, 'touch door buttons bypass torch swing cooldown');
assert.match(ruin, /torchHeld && PROXIMITY_DOOR_KINDS\.has\(row\.kind\)/, 'native door claim cannot steal Torch Swing on Action 1');
assert.match(game, /window\.AdventuringTools\?\.stow\?\.\(\)/, 'holster/weapon/item paths retain torch extinguish callback');
console.log('torch recall and door use: tool, weapon/item, wooden door, native transit door, touch, world-action dispatch PASS');
