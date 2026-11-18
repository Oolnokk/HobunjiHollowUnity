'use strict';

const assert = require('node:assert/strict'); // Checks the production category resolver and shared wheel/controller input paths.
const fs = require('node:fs'); // Reads shipped implementations, not duplicate selector logic.
const vm = require('node:vm'); // Executes focused production functions with isolated game-state fixtures.

const categorySource = fs.readFileSync('docs/js/item-arch-category-colors.js', 'utf8'); // One category metadata authority for jump tests.
const actionSource = fs.readFileSync('docs/js/action-arc-ui.js', 'utf8'); // Actual item-wheel input, prompt, and commit helpers.
const controllerSource = fs.readFileSync('docs/js/controller-selection-ui.js', 'utf8'); // Actual A/Y press-edge dispatch.

function between(source, start, end) {
  const from = source.indexOf(start); // Finds a stable source boundary without a copied helper implementation.
  const to = source.indexOf(end, from + start.length); // Keeps the focused VM free of unrelated 3D/game systems.
  assert(from >= 0 && to > from, 'missing production function boundary: ' + start);
  return source.slice(from, to);
}

const classifier = between(categorySource, '  const CATEGORY_STYLES =', '  function injectStyles() {'); // Supplies real category classification plus itemDeps.
const resolver = between(categorySource, '  function nextCategoryIndex(', '  function currentRuntimeOwnedKeys() {'); // Supplies actual cyclic category transition.
const jump = between(actionSource, '  function _jumpItemCategory(', '  function _positionItemCategoryControls() {'); // Applies the new selection to the real arch state.
const definitions = { // Exercises the rotation that preserves the player's active item index.
  seedA:{cat:'seed'}, seedB:{cat:'seed'}, cropA:{cat:'crop'}, cropB:{cat:'crop'}, fishA:{cat:'material',tags:['Fish']},
};
let index = 2; // Initially selects second Crop, then jumps to Seeds/Fish.
let mode = 'tool'; // Confirms a category jump equips the corresponding held item.
let refreshes = 0; // Measures explicit item/action HUD updates from the production jump handler.
let builds = 0; // Confirms that the visible item-wheel slots follow each actual jump.
let cancelledScroll = 0; // Checks that a previous scrolling sentinel cannot race a category jump.
const stacks = ['seedB', 'cropA', 'cropB', 'fishA', 'seedA'].map(key => ({key})); // Grouped wheel with Seeds split across the cyclic seam.

const context = vm.createContext({
  definitions, _arcOpen:'item', _iScroll:0, _iScrollT:17, _iScrollDir:1, _lastItemCategoryJump:null, ITEM_VIS:5,
  clearInterval() { cancelledScroll++; }, _buildItemSlots() { builds++; },
  deps: {
    getInventoryStackItems:()=>stacks,
    getActiveItemIndex:()=>index,
    setActiveItemIndex:value=>{index=value;},
    setHeldMode:value=>{mode=value;},
    refreshActionBar(){refreshes++;},
  },
  window:{HudUpdate:{refreshItemScroll(){refreshes++;}},ItemArchCategoryColors:{refresh(){refreshes++;}}},
}); // Executes the shipping shared arc's jump against an ordinary mutable item-index bag.
vm.runInContext(classifier + '\n' + resolver
  + '\nwindow.ItemArchCategoryColors.nextCategoryIndex = nextCategoryIndex; itemDeps.ITEM_DEFS = definitions;'
  + '\n' + jump, context);
const jumpCategory = vm.runInContext('_jumpItemCategory', context); // Actual function, not a reconstructed algorithm.

assert.equal(jumpCategory(-1), true, 'previous category is reachable from the middle of Crops');
assert.equal(index, 4, 'previous targets the first item in cyclic Seeds');
assert.equal(mode, 'item', 'category switching retains the ordinary held-item semantics');
assert.equal(cancelledScroll, 1, 'category switching stops a pending sentinel scroll');
assert.equal(context._iScrollDir, 0, 'scroll direction is cleared after a category jump');
assert.equal(context._lastItemCategoryJump.to, 'seedA', 'mobile debug exposes the selected key');
assert.equal(jumpCategory(1), true, 'next category wraps over the split Seeds group');
assert.equal(index, 1, 'next category returns to first Crop instead of another Seed item');
assert.equal(jumpCategory(1), true, 'the next category can be entered repeatedly without closing the wheel');
assert.equal(index, 3, 'next advances from Crops to Fish');
assert.equal(jumpCategory(1), true, 'last category wraps to Seeds');
assert.equal(index, 4, 'next from Fish targets the first Seeds item');
assert.equal(builds, 4, 'every category jump refreshes the visible slots');
assert.equal(refreshes, 12, 'each category jump refreshes item HUD, action HUD, and category presentation');
context._arcOpen = null;
assert.equal(jumpCategory(1), false, 'closed arch ignores category shortcuts');
context._arcOpen = 'item';
index = 99;
assert.equal(jumpCategory(1), false, 'invalid active index must not change inventory state');
index = 0;
stacks.splice(0, stacks.length, {key:'cropA'}, {key:'cropB'});
assert.equal(jumpCategory(1), false, 'single-category inventory leaves the item unchanged');

const buttonsSource = between(controllerSource, '  function stepItemCategoryButtons(', '  function updateArch(frame, pad, now) {'); // Real held-controller press-edge owner.
const controllerCalls = []; // Records only navigations that should reach the item-category API.
const controllerState = {kind:'item',openerCode:'Button4',lastArchDirection:1,nextRepeatAt:999,lastInput:''}; // A held default Item Select gesture.
let controllerMode = 'item'; // Simulates another menu or selector replacing the item wheel.
const controllerContext = vm.createContext({
  state:controllerState,
  sharedArch:()=>({currentMode:()=>controllerMode,jumpItemCategory:direction=>{controllerCalls.push(direction);return true;}}),
}); // No polling, bypassed gameplay action, or hardcoded simulated click helpers.
vm.runInContext(buttonsSource, controllerContext);
const stepButton = vm.runInContext('stepItemCategoryButtons', controllerContext);
const pressed = (...keys) => ({ pressed:new Set(keys) }); // ControllerInput publishes newly pressed button codes once per frame.
assert.equal(stepButton(pressed('Button0')), true, 'A selects the previous group');
assert.equal(stepButton(pressed('Button3')), true, 'Y selects the next group');
assert.deepEqual(controllerCalls, [-1, 1], 'A/Y route to the same shared category action');
assert.equal(controllerState.lastArchDirection, 0, 'face-button steps reset stick-repeat state');
assert.equal(stepButton(pressed()), false, 'a held button without a new edge must not auto-repeat');
assert.equal(stepButton(pressed('Button0','Button3')), false, 'simultaneous A+Y is ignored');
controllerMode = 'entries:potion-contextual-flasks';
assert.equal(stepButton(pressed('Button0')), false, 'A/Y cannot hijack Potion Select');
controllerMode = 'item';
controllerState.kind = 'tool';
assert.equal(stepButton(pressed('Button3')), false, 'A/Y cannot hijack Tool Select');
controllerState.kind = 'item';
controllerState.openerCode = 'Button0';
assert.equal(stepButton(pressed('Button0')), false, 'a remapped A opener cannot also navigate');
controllerState.openerCode = 'Button3';
assert.equal(stepButton(pressed('Button3')), false, 'a remapped Y opener cannot also navigate');

const positioningSource = between(actionSource, '  function _positionItemCategoryControls()', '  function _openItemArc() {'); // Actual desktop/mobile prompt builder, plus the common click handlers.
const domElements = new Map(); // Records created on-screen controls without a browser devtools/DOM implementation.
class FakeElement {
  constructor(tag) { this.tag=tag; this.id=''; this.className=''; this.style={}; this.listeners={}; this.children=[]; this.removed=false; }
  setAttribute(key,value) { this[key]=value; }
  addEventListener(event,callback) { this.listeners[event]=callback; }
  appendChild(child) { this.children.push(child); if(child.id) domElements.set(child.id,child); }
  remove() { this.removed=true; if(this.id) domElements.delete(this.id); }
  querySelector(selector) { return this.children.find(child=>child.className.split(/\s+/).includes(selector.slice(1))) || null; }
}
const styleNodes = []; // Ensures a single style is used across reopenings rather than accumulating DOM nodes.
const clicks = []; // Ensures real buttons invoke shared group jumps without committing/closing the arch.
const promptContext = vm.createContext({
  _arcOpen:'item',_itemCategoryControls:null,
  _arcPt:(deg,radius)=>({x:100+deg,y:250+radius}),
  _outerR:()=>150,
  _jumpItemCategory:direction=>clicks.push(direction),
  document:{
    getElementById:id=>domElements.get(id) || null,
    createElement:tag=>new FakeElement(tag),
    head:{appendChild(node){styleNodes.push(node);if(node.id)domElements.set(node.id,node);}},
    body:{appendChild(node){if(node.id)domElements.set(node.id,node);}},
  },
}); // Tests the actual responsive controls and their lifecycle independently of the game renderer.
vm.runInContext(positioningSource, promptContext);
vm.runInContext('_showItemCategoryControls()', promptContext);
const controls = domElements.get('itemCategoryControls'); // Both prompt buttons are children of the one mounted control region.
assert(controls && controls.children.length === 2, 'both category prompts appear while Item Select is open');
assert.match(styleNodes[0].textContent, /@media \(pointer:coarse\)/, 'touch gets its own stacked-button styling');
assert.match(styleNodes[0].textContent, /width:52px;min-width:52px;height:52px/, 'mobile buttons are square and touch-sized');
assert.match(styleNodes[0].textContent, /left:max\(10px,env\(safe-area-inset-left/, 'touch arrows are left-aligned above the gameplay HUD');
assert.match(controls.children[0].innerHTML,/↑/, 'previous category displays the upper arrow');
assert.match(controls.children[1].innerHTML,/↓/, 'next category displays the lower arrow');
const clickEvent = {preventDefault(){},stopPropagation(){}};
controls.children[0].listeners.click(clickEvent);
controls.children[1].listeners.click(clickEvent);
assert.deepEqual(clicks,[-1,1], 'mouse/touch prompts call the real category-jump seam');
assert.match(controls.children[0].style.left,/px$/, 'desktop previous prompt receives an arch-relative location');
assert.match(controls.children[1].style.left,/px$/, 'desktop next prompt receives an arch-relative location');
vm.runInContext('_showItemCategoryControls()', promptContext);
assert.equal(styleNodes.length,1,'reopening does not duplicate the prompt style');
promptContext._arcOpen = null;
vm.runInContext('_positionItemCategoryControls()',promptContext); // A closing animation should never reposition hidden controls.


// Execute document-level mouse event capture against fake foreground/backdrop targets.
// Preventing the original press/release is essential: otherwise category clicks also swing or throw the held item.
const mouseHandlerSource = between(actionSource, "    document.addEventListener('pointerdown', event => {", '    window._desktopSelectionArc = {'); // The actual document capture handlers installed by _bindListeners().
const mouseHandlers = new Map(); // Distinguishes pointerdown/up, compatibility click, and browser contextmenu events.
const backgroundJumps = []; // Proves each mouse button jumps exactly once.
const mouseContext = vm.createContext({
  _arcOpen:'item', _jumpItemCategory:direction=>{backgroundJumps.push(direction);return true;},
  document:{addEventListener(name,listener){mouseHandlers.set(name,listener);}},
}); // The delegated handlers should not require a 3D canvas, menu, or real document.
vm.runInContext(mouseHandlerSource,mouseContext);
function fakeMouseEvent(type,button,targetKind='backdrop',pointerType='mouse') {
  const target = {closest:selector=>targetKind === 'prompt' && selector.includes('#itemCategoryControls') ? {}
    : targetKind === 'itemBtn' && selector.includes('#itemBtn') ? {}
      : targetKind === 'backdrop' && selector.includes('.arc-backdrop') ? {} : null}; // Distinguishes exempt button gestures from the wheel backdrop.
  const event = {target,button,pointerType,prevented:false,stopped:false,
    preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
  mouseHandlers.get(type)(event);
  return event;
}
const priorClick = fakeMouseEvent('pointerdown',0);
const nextClick = fakeMouseEvent('pointerdown',2);
assert.deepEqual(backgroundJumps,[-1,1], 'desktop left/right pointerdown navigates exactly one category in each direction');
assert(priorClick.prevented && priorClick.stopped && nextClick.prevented && nextClick.stopped,
  'category pointerdown cannot also reach gameplay actions');
assert.equal(fakeMouseEvent('pointerup',0).stopped,true, 'matching pointerup is suppressed before gameplay dispatch');
assert.equal(fakeMouseEvent('click',0,'backdrop',null).stopped,true,
  'legacy MouseEvent clicks without pointerType cannot activate gameplay');
assert.equal(fakeMouseEvent('pointerdown',0,'backdrop','touch').stopped,false,
  'touch pointerdown cannot impersonate desktop category clicks');
assert.equal(fakeMouseEvent('pointerdown',0,'prompt').stopped,false,
  'direct mobile/desktop prompt clicks still reach their own click handler');
assert.equal(fakeMouseEvent('pointerdown',0,'itemBtn').stopped,false,
  'the original Item Select opener retains its release-to-commit behavior');
assert.equal(fakeMouseEvent('contextmenu',2).prevented,true,
  'right-clicking the wheel does not display a browser context menu');
mouseContext._arcOpen = 'entries:potion-root';
assert.equal(fakeMouseEvent('pointerdown',0).stopped,false, 'Potion Select cannot be hijacked by item-category mouse controls');
assert.deepEqual(backgroundJumps,[-1,1], 'no unexpected group jump occurred outside Item Select');

console.log('item category jump, controller shortcuts, and mobile/desktop prompt and mouse-event capture tests passed');
