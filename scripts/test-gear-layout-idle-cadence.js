#!/usr/bin/env node
'use strict';

// The shipped Gear observer must not turn ordinary gameplay/menu mutations
// into a repeated synchronous layout-measurement loop.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/inventory-gear-compact-effects.js', 'utf8'); // Execute the real shipped module against a minimal mobile-menu DOM.
const queued = []; // Deterministic rAF callbacks; tests drain them explicitly instead of relying on the browser clock.
const observers = []; // Captures the one inventory MutationObserver for synthetic update bursts.
const resizers = []; // Captures resize observers so the test can verify invalidation after a real layout change.
let layoutReads = 0; // Counts item-info bounding-rectangle reads, which should happen only on explicit debug snapshots.
let styleWrites = 0; // Detects the binary font-fit pipeline running while Gear is hidden.
let disconnects = 0; // Verifies hidden Gear stops observing resize changes.
let currentInfoFontPx = 10.5; // Mirrors the CSS variable used by the real detail overflow measurements.
let maxFittingFontPx = 10.5; // Simulates longer descriptions and narrower panels needing smaller fonts.

const pane = {
  nodeType: 1,
  gear: false,
  active: true,
  classList: { contains(name) { return name === 'active' ? pane.active : name === 'inv-mode-gear' && pane.gear; } },
};
const menu = { // CSS-opacity-hidden menu retains layout geometry even after closing, so visibility must be gated by this class.
  nodeType: 1,
  open: true,
  classList: { contains(name) { return name === 'open' && menu.open; } },
};
const detail = {
  offsetParent: {}, clientHeight: 50, clientWidth: 200,
  get scrollHeight() { return currentInfoFontPx > maxFittingFontPx ? 65 : 50; },
  get scrollWidth() { return 200; },
  querySelectorAll() { return []; },
}; // Geometry fixture exercises the real overflow branch and nine-step binary fit.
let summary = {
  nodeType: 1,
  classList: { contains(name) { return name === 'gear-summary-panel'; } },
  scrollHeight: 400, clientHeight: 300,
}; // Existing left summary rail, whose resize should never invalidate right-hand text.
const owned = {
  nodeType: 1,
  classList: { contains(name) { return name === 'gear-middle-inventory'; } },
  clientHeight: 300,
}; // Independently scrolling middle owned-gear panel.
const section = {
  nodeType: 1,
  closest(selector) { return selector.includes('#invEquipSection') ? this : null; },
  querySelector(selector) {
    if (selector === ':scope > .gear-loadout-grid') return summary;
    if (selector === ':scope > .gear-owned-section') return owned;
    if (selector === '.gear-summary-panel') return summary;
    if (selector === '.gear-middle-inventory') return owned;
    return null;
  },
}; // Real workspace shape ensures four ResizeObserver targets are registered.
const info = {
  nodeType: 1,
  style: { setProperty(name, value) { styleWrites++; if (name === '--gear-info-font') currentInfoFontPx = parseFloat(value); } },
  querySelector(selector) { return selector === '.ii-detail' ? detail : null; },
  querySelectorAll() { return []; },
  getBoundingClientRect() { layoutReads++; return { width: 100 }; },
  closest(selector) { return selector.includes('#invInfo') ? this : null; },
};
const document = {
  readyState: 'complete',
  head: { appendChild() {} },
  getElementById(id) { return id === 'mpInventory' ? pane : id === 'invInfo' ? info : id === 'menuPanel' ? menu : id === 'invEquipSection' ? section : null; },
  createElement() { return { id: '', textContent: '' }; },
};
class MutationObserver {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe() {}
  disconnect() {}
  notify(records) { this.callback(records); }
}
class ResizeObserver {
  constructor(callback) { this.callback = callback; this.targets = []; resizers.push(this); }
  observe(node) { this.targets.push(node); }
  disconnect() { disconnects++; }
}
const window = { addEventListener() {}, innerWidth: 900, innerHeight: 500 };
function requestAnimationFrame(callback) { queued.push(callback); return queued.length; }
function flushFrames() {
  while (queued.length) queued.shift()();
}
const context = { window, document, MutationObserver, ResizeObserver, requestAnimationFrame, console };
vm.runInNewContext(source, context, { filename: 'inventory-gear-compact-effects.js' });
assert.equal(observers.length, 1, 'Gear listens for document rebuilds');
const observer = observers[0];
const mutation = (target, type = 'attributes', attributeName = 'class') => ({ target, type, attributeName });
const irrelevant = { nodeType: 1, closest() { return null; } };
flushFrames();
assert.equal(layoutReads, 0, 'startup with Pack active does not read Gear geometry');
assert.equal(styleWrites, 0, 'startup with Pack active does not run Gear font fitting');

observer.notify([mutation(irrelevant), mutation(pane)]);
assert.equal(queued.length, 0, 'unrelated closed-menu class churn schedules no fit');

pane.gear = true;
observer.notify([mutation(pane)]);
assert.equal(queued.length, 1, 'entering Gear schedules a fit');
flushFrames();
assert.equal(layoutReads, 0, 'normal Gear refresh does not run diagnostics-only layout measurements');
assert(styleWrites > 0, 'Gear open applies its own adaptive font metrics');
const initialResizeObserver = resizers.at(-1);
assert.equal(initialResizeObserver.targets.length, 4, 'Gear observes its section, summary, owned gear, and detail');
const firstFitWritesAfterOpen = styleWrites; // Initial ResizeObserver deliveries must not perform a second font fit.
initialResizeObserver.callback([
  { target:section, contentRect:{ width:480, height:300 } },
  { target:summary, contentRect:{ width:180, height:300 } },
  { target:owned, contentRect:{ width:300, height:300 } },
  { target:info, contentRect:{ width:150, height:300 } },
]);
assert.equal(queued.length, 0, 'initial ResizeObserver size delivery does not double-fit the panel');
assert.equal(styleWrites, firstFitWritesAfterOpen);
const firstFitWrites = styleWrites; // A real content update must still rerun the font metrics.

observer.notify([mutation(pane), mutation(irrelevant)]);
assert.equal(queued.length, 0, 'changing unrelated classes while Gear stays open does not refit');
maxFittingFontPx = 6; // Longer selected-item text should shrink to a fitting font on the next content mutation.
observer.notify([mutation(info, 'characterData')]);
assert.equal(queued.length, 1, 'item-detail content changes still refit');
observer.notify([mutation(info, 'childList')]);
assert.equal(queued.length, 1, 'multiple relevant mutations coalesce into one frame');
flushFrames();
assert.equal(layoutReads, 0, 'content changes do not request unrelated diagnostic geometry');
assert(styleWrites > firstFitWrites, 'item-detail content changes trigger a fresh measured font fit');
assert(currentInfoFontPx <= 6 && currentInfoFontPx > 5.9, 'the live binary fitter finds the largest font that fits longer text');
const afterDetailWrites = styleWrites; // Summary changes must not resize the independent right-hand text.

const liveBuffNode = {
  nodeType: 1,
  closest(selector) { return selector.includes('.gear-active-buff-list') || selector.includes('#invEquipSection') ? this : null; },
}; // Models a mutable text node inside the left Gear buff card rather than the right-hand item-detail.
observer.notify([mutation(liveBuffNode, 'characterData'), mutation(liveBuffNode, 'childList'), mutation(liveBuffNode, 'attributes')]);
assert.equal(queued.length, 0, 'one-second buff icon/countdown updates never schedule item-detail refits');
const effectCard = {
  nodeType: 1,
  closest(selector) { return selector.includes('#invEquipSection') ? this : null; },
}; // A whole effects-card replacement must still trigger normal Gear layout measurements.
observer.notify([mutation(effectCard, 'childList')]);
assert.equal(queued.length, 1, 'real effect-section rebuilds still schedule a layout pass');
flushFrames();
assert.equal(styleWrites, afterDetailWrites, 'rebuilding the left effects card reuses the existing item-detail fit');
assert.equal(window.InventoryGearCompactEffects.debugSnapshot().fitStats.reusedDetailFits, 1);
const writesBeforeLeftResize = styleWrites; // A left-only summary resize should not remeasure the right detail.
initialResizeObserver.callback([{ target:summary, contentRect:{ width:170, height:300 } }]);
assert.equal(queued.length, 1, 'left summary resize still schedules presentation maintenance');
flushFrames();
assert.equal(styleWrites, writesBeforeLeftResize, 'left summary resize does not rerun the font fitting');
assert.equal(window.InventoryGearCompactEffects.debugSnapshot().fitStats.reusedDetailFits, 2);
assert.equal(layoutReads, 2, 'each explicit mobile diagnostic snapshot reads the actual detail-panel width');


// The menu panel remains mounted and measurable while it is opacity-hidden.
menu.open = false;
observer.notify([mutation(menu)]);
flushFrames();
assert.equal(layoutReads, 2, 'closing the main menu never reads hidden Gear geometry');
const closedMenuWrites = styleWrites; // Tracks CSS work while Gear is selected but no longer visible.
observer.notify([mutation(info, 'characterData')]);
flushFrames();
assert.equal(styleWrites, closedMenuWrites, 'Gear remains idle while its parent menu is closed');
menu.open = true;
observer.notify([mutation(menu)]);
flushFrames();
assert.equal(layoutReads, 2, 'reopening the menu does not run diagnostics-only geometry');

pane.gear = false;
observer.notify([mutation(pane)]);
flushFrames();
assert.equal(layoutReads, 2, 'leaving Gear does not read the hidden detail panel');
assert(disconnects >= 1, 'leaving Gear disconnects layout resize targets');
const hiddenWrites = styleWrites; // Compares real mutation bursts with hidden Gear to the no-work baseline.
observer.notify([mutation(info, 'characterData'), mutation(irrelevant)]);
flushFrames();
assert.equal(styleWrites, hiddenWrites, 'hidden Gear changes never run CSS font fitting');

pane.gear = true;
observer.notify([mutation(pane)]);
flushFrames();
assert.equal(layoutReads, 2, 'reopening Gear fits without diagnostics-only geometry');
const debug = window.InventoryGearCompactEffects.debugSnapshot();
assert.equal(debug.gearActive, true);
assert.equal(debug.fitStats.passes, 6);
assert.equal(debug.fitStats.detailFits, 4, 'first open, detail change, and both reopens require a real fit');
assert.equal(debug.fitStats.reusedDetailFits, 2, 'left-rail mutation and resize both skip the real fit');
assert.equal(layoutReads, 3, 'on-demand diagnostics retain the measured item-detail width');
assert(debug.fitStats.ignoredMutations >= 2);
assert(debug.fitStats.inactiveSkips >= 3);

const preResizeWrites = styleWrites; // Resize invalidates even when the item-detail text itself is unchanged.
maxFittingFontPx = 4; // A narrower right-hand panel requires another real fit even without a text mutation.
const reopenedObserver = resizers.at(-1); // New observation after reopening starts with clean size baselines.
reopenedObserver.callback([{ target:info, contentRect:{ width:150, height:300 } }]);
assert.equal(queued.length, 0, 'reopened observer initial size notification is not an extra fit');
reopenedObserver.callback([{ target:info, contentRect:{ width:120, height:300 } }]);
flushFrames();
const afterResize = window.InventoryGearCompactEffects.debugSnapshot();
assert(styleWrites > preResizeWrites, 'Gear resize reruns the fit');
assert(currentInfoFontPx <= 4 && currentInfoFontPx > 3.9, 'resize recomputes the fitting font for new geometry');
assert.equal(afterResize.fitStats.detailFits, 5, 'resizing forces fresh content measurements');
assert.equal(afterResize.fitStats.passes, 7);
assert.equal(layoutReads, 4, 'only explicit diagnostics produce layout width reads');

// EquipmentPanel can replace a summary node without changing #invEquipSection.
const previousSummary = summary; // A stale observation should not outlive the replaced inner Gear rail.
summary = { ...previousSummary }; // New node with equivalent dimensions, but a different DOM identity.
observer.notify([mutation(section, 'childList')]);
flushFrames();
const rebuiltObserver = resizers.at(-1);
assert.notEqual(rebuiltObserver, reopenedObserver, 'replacing only the inner summary reattaches ResizeObserver');
assert(rebuiltObserver.targets.includes(summary), 'new summary is watched after the rebuild');
assert(!rebuiltObserver.targets.includes(previousSummary), 'detached summary is no longer watched');
assert.equal(window.InventoryGearCompactEffects.debugSnapshot().fitStats.detailFits, 5, 'inner Gear replacement does not refit the unchanged right panel');
// Exercise a real font-floor release by the fitter and its asynchronous observer notification.
const floor={nodeType:1,dataset:{menuFontFloor:'1'},style:{removeProperty(){}},closest:selector=>selector.includes('#invInfo')?info:null};
info.querySelectorAll=()=>floor.dataset.menuFontFloor==='1'?[floor]:[];
observer.notify([mutation(info,'characterData')]); flushFrames();
assert.equal(floor.dataset.menuFontFloor,undefined);
const afterRelease=styleWrites;
observer.notify([mutation(floor,'attributes','data-menu-font-floor')]);
flushFrames();
assert.equal(styleWrites,afterRelease,'our own completed release must not start a second binary fit');
assert(window.InventoryGearCompactEffects.debugSnapshot().fitStats.ownFloorSkips>0);
floor.dataset.menuFontFloor='1';
observer.notify([mutation(floor,'attributes','data-menu-font-floor')]);
flushFrames();
assert(styleWrites>afterRelease,'external floor reapplication still fits the real content');
console.log('Gear layout idle-cadence tests passed');
