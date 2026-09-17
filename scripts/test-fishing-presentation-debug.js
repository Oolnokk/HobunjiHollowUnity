#!/usr/bin/env node
'use strict';

// Regression for the Stage 2 RAF-ownership migration: fishing-presentation-debug.js
// used to own a permanent per-frame RAF that both synchronized the Gullet's
// presentation and refreshed the fishing debug panel. It now registers,
// unmodified in behavior, as one 'fishing-presentation' scheduler subscriber
// (see docs/architecture/runtime-frame-scheduler.md) — a follow-up commit is
// expected to later gate it on relevant fishing/Gullet/debug context, not
// this one.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/fishing-presentation-debug.js', 'utf8');
assert(!source.includes('requestAnimationFrame('), 'fishing presentation debug must no longer own a direct requestAnimationFrame( call site');
assert(source.includes('window.RuntimeFrameScheduler.register(SCHEDULER_ID, scheduledFrame'), 'the combined Gullet-sync/debug-panel work must register with the shared scheduler');

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

function buildContext() {
  const registered = new Map();
  const elements = new Map();
  const context = {
    console, Math, Number, String, Array, Object,
    window: null,
    document: {
      createElementNS(ns, tag) { return makeElement(tag); },
      createElement(tag) { return makeElement(tag); },
      getElementById(id) { return elements.get(id) || null; },
    },
  };
  context.window = context;
  context.RuntimeFrameScheduler = {
    register(id, fn, options) { registered.set(id, { fn, options }); },
  };
  context.getComputedStyle = () => ({ filter: 'none' });
  context.FishCatalog = { entries: [] };
  context.AmphibiousFishing = { getDebug: () => ({ playerTile: { type: 'shallow', col: 3, row: 4 }, playerInWater: true }) };

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'fishing-presentation-debug.js' });
  return { context, registered, elements };
}

const { context, registered, elements } = buildContext();

const entry = registered.get('fishing-presentation');
assert(entry, 'registers with the scheduler under a stable id');
assert.equal(entry.options.owner, 'FishingPresentationDebug');
assert.equal(entry.options.phase, 'visual');
// Stage 2 asks for this migration to keep the combined function intact and
// always enabled for now; a later commit is expected to add the context
// gate, not this one.
assert.notEqual(entry.options.enabled, false, 'this migration must not gate the subscriber yet — that is explicitly a follow-up commit');

const scheduledFrame = entry.fn;

// No gulletFishSilhouette/fishingFeatureDebug elements exist -> both halves
// of the combined callback must no-op safely, exactly like the original
// frame() did when the fishing UI wasn't present.
assert.doesNotThrow(() => scheduledFrame(), 'runs safely with no fishing/Gullet DOM present');

// Wire up a Gullet silhouette and the regular fish's deformed image, plus
// the debug panel, and confirm the scheduled callback still drives both.
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

scheduledFrame();
const visual = gulletRoot.children.find(c => c.attrs['data-gullet-regular-fish-visual']);
assert(visual, 'the scheduled callback still builds the Gullet regular-fish visual on first sync');
const image = visual.children[0];
assert.equal(image.getAttribute('href'), 'blob:fish-frame-3', 'copies the live regular fish frame onto the Gullet image');
const debugLine = debugPanel.children.find(c => c.attrs['data-amphibious-water-debug']);
assert(debugLine, 'the scheduled callback still creates/updates the water-check debug line');
assert.equal(debugLine.textContent, 'WATER CHECK: YES | shallow @ 3,4', 'debug line reflects the live amphibious water-check state');

// Move the Gullet and re-run: heading must update from actual motion, same
// as the original per-frame implementation.
gulletRoot.setAttribute('transform', 'translate(40 20)');
scheduledFrame();
assert.equal(gulletRoot.getAttribute('transform'), 'translate(40.00 20.00) rotate(0.00)', 'moving purely along +X yields a 0 degree heading, matching atan2(0, dx)');

console.log('fishing presentation debug scheduler migration passed');
