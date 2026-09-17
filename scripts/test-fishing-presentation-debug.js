#!/usr/bin/env node
'use strict';

// Regression for the Stage 8 RAF-ownership follow-up: fishing-presentation-debug.js's
// combined scheduledFrame() (Stage 2) is split into two independently
// context-gated scheduler subscribers, since each half is only ever relevant
// in a different, unrelated context: the Gullet visual sync only matters
// while a Gullet encounter can exist (i.e. main fishing is active), and the
// water-check debug line only matters while the mobile fishing debug panel
// is turned on (?fishingDebug=1 or the persisted localStorage flag). Both
// register disabled and are enabled/disabled by a low-frequency
// setInterval-driven context poll (see docs/architecture/runtime-frame-scheduler.md's
// guidance to conditionally enable subscribers via setEnabled() rather than
// let them run every single browser frame regardless of context).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/fishing-presentation-debug.js', 'utf8');
assert(!source.includes('requestAnimationFrame('), 'fishing presentation debug must no longer own a direct requestAnimationFrame( call site');
assert(source.includes("window.RuntimeFrameScheduler.register(GULLET_SCHEDULER_ID, syncGulletVisual"), 'the Gullet visual sync must register as its own scheduler subscriber');
assert(source.includes("window.RuntimeFrameScheduler.register(WATER_DEBUG_SCHEDULER_ID, updateWaterDebug"), 'the water-check debug line must register as its own scheduler subscriber');
assert(source.includes('window.setInterval(pollContext'), 'a low-frequency timer, not the scheduler itself, must drive the context poll');

function makeElement(tag) {
  const el = {
    tagName: tag,
    attrs: {},
    children: [],
    style: {},
    isConnected: true,
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] ?? null; },
    getAttributeNS(ns, name) { return this.attrs[name] ?? null; },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren() { this.children = []; },
    querySelector(selector) {
      const match = /\[data-([\w-]+)\]/.exec(selector);
      if (!match) return null;
      return this.children.find(c => Object.prototype.hasOwnProperty.call(c.attrs, `data-${match[1]}`)) || null;
    },
    prepend(child) { this.children.unshift(child); },
    insertBefore(child) { this.children.push(child); },
  };
  return el;
}

function buildContext({ search = '' } = {}) {
  const registered = new Map();
  const elements = new Map();
  const intervals = [];
  const context = {
    console, Math, Number, String, Array, Object, URLSearchParams,
    window: null,
    document: {
      createElementNS(ns, tag) { return makeElement(tag); },
      createElement(tag) { return makeElement(tag); },
      getElementById(id) { return elements.get(id) || null; },
    },
  };
  context.window = context;
  context.location = { search };
  context.localStorage = { getItem() { return null; } };
  context.RuntimeFrameScheduler = {
    register(id, fn, options) { registered.set(id, { fn, options, enabled: options.enabled !== false }); },
    setEnabled(id, enabled) { const entry = registered.get(id); if (!entry) return false; entry.enabled = !!enabled; return true; },
  };
  context.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
  context.getComputedStyle = () => ({ filter: 'none' });
  context.FishCatalog = { entries: [] };
  context.AmphibiousFishing = { getDebug: () => ({ playerTile: { type: 'shallow', col: 3, row: 4 }, playerInWater: true }) };

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'fishing-presentation-debug.js' });
  return { context, registered, elements, intervals };
}

// --- Registration shape: both start disabled -------------------------------
{
  const { registered, intervals } = buildContext();
  const gullet = registered.get('fishing-presentation-gullet');
  const waterDebug = registered.get('fishing-presentation-water-debug');
  assert(gullet, 'the Gullet visual sync registers under a stable id');
  assert(waterDebug, 'the water-check debug line registers under a stable id');
  assert.equal(gullet.options.owner, 'FishingPresentationDebug');
  assert.equal(waterDebug.options.owner, 'FishingPresentationDebug');
  assert.equal(gullet.options.phase, 'post-game');
  assert.equal(waterDebug.options.phase, 'post-game');
  assert.equal(gullet.options.enabled, false, 'the Gullet sync registers disabled; the context poll enables it only while fishing');
  assert.equal(waterDebug.options.enabled, false, 'the water-check line registers disabled; the context poll enables it only in fishing-debug mode');
  assert.equal(intervals.length, 1, 'exactly one low-frequency context-poll timer is installed');
  assert(intervals[0].ms >= 100, 'the context poll runs far less often than every browser frame');
}

// --- Context poll: neither fishing nor debug mode active -> both stay off --
{
  const { context, registered, intervals } = buildContext();
  context.Fishing = { state: null };
  intervals[0].fn();
  assert.equal(registered.get('fishing-presentation-gullet').enabled, false);
  assert.equal(registered.get('fishing-presentation-water-debug').enabled, false);
}

// --- Context poll: fishing active -> only the Gullet sync turns on --------
{
  const { context, registered, intervals } = buildContext();
  context.Fishing = { state: { phase: 'active' } };
  intervals[0].fn();
  assert.equal(registered.get('fishing-presentation-gullet').enabled, true, 'fishing active enables the Gullet sync');
  assert.equal(registered.get('fishing-presentation-water-debug').enabled, false, 'fishing active alone does not enable the debug line');
}

// --- Context poll: ?fishingDebug=1 -> only the water-debug line turns on --
{
  const { context, registered, intervals } = buildContext({ search: '?fishingDebug=1' });
  context.Fishing = { state: null };
  intervals[0].fn();
  assert.equal(registered.get('fishing-presentation-gullet').enabled, false, 'debug mode alone does not enable the Gullet sync');
  assert.equal(registered.get('fishing-presentation-water-debug').enabled, true, '?fishingDebug=1 enables the water-check line');
}

// --- Context poll: fishing ends -> the Gullet sync turns back off ---------
{
  const { context, registered, intervals } = buildContext();
  context.Fishing = { state: { phase: 'active' } };
  intervals[0].fn();
  assert.equal(registered.get('fishing-presentation-gullet').enabled, true);
  context.Fishing = { state: null };
  intervals[0].fn();
  assert.equal(registered.get('fishing-presentation-gullet').enabled, false, 'the Gullet sync turns back off once main fishing ends');
}

// --- Behavioral equivalence: each subscriber's callback still does exactly
// what the old combined scheduledFrame() did once actually invoked. --------
{
  const { registered, elements } = buildContext();
  const syncGulletVisual = registered.get('fishing-presentation-gullet').fn;
  const updateWaterDebug = registered.get('fishing-presentation-water-debug').fn;

  assert.doesNotThrow(() => syncGulletVisual(), 'runs safely with no Gullet DOM present');
  assert.doesNotThrow(() => updateWaterDebug(), 'runs safely with no debug panel present');

  const gulletRoot = makeElement('g');
  gulletRoot.setAttribute('transform', 'translate(10 20)');
  elements.set('gulletFishSilhouette', gulletRoot);

  const regularImage = makeElement('image');
  regularImage.setAttribute('href', 'blob:fish-frame-3');
  regularImage.setAttribute('width', '120');
  regularImage.setAttribute('height', '80');
  elements.set('fishDeformedImage', regularImage);

  const debugPanel = makeElement('div');
  elements.set('fishingFeatureDebug', debugPanel);

  syncGulletVisual();
  const visual = gulletRoot.children.find(c => c.attrs['data-gullet-regular-fish-visual']);
  assert(visual, 'the Gullet sync still builds the Gullet regular-fish visual on first sync');
  const image = visual.children[0];
  assert.equal(image.getAttribute('href'), 'blob:fish-frame-3', 'copies the live regular fish frame onto the Gullet image');

  updateWaterDebug();
  const debugLine = debugPanel.children.find(c => c.attrs['data-amphibious-water-debug']);
  assert(debugLine, 'the water-debug callback still creates/updates the water-check line');
  assert.equal(debugLine.textContent, 'WATER CHECK: YES | shallow @ 3,4', 'debug line reflects the live amphibious water-check state');

  gulletRoot.setAttribute('transform', 'translate(40 20)');
  syncGulletVisual();
  assert.equal(gulletRoot.getAttribute('transform'), 'translate(40.00 20.00) rotate(0.00)', 'moving purely along +X yields a 0 degree heading, matching atan2(0, dx)');
}

console.log('fishing presentation debug context-gated scheduler split passed');
