#!/usr/bin/env node
'use strict';
// Runs js/render-optimization-settings.js (Settings → Render optimizations) against fake render owners and a small DOM:
// stored choices are applied at load, the section lands after Performance with one live toggle per available switch,
// toggling calls the owner and persists only non-default values, owners that persist themselves are left to it,
// draw-only hiders restore what they hide, and Set to Defaults puts everything back.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// --- Minimal DOM -----------------------------------------------------------
const all = [];
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.attributes = {}; this.listeners = {}; this.style = {}; this.className = ''; this.textContent = ''; this.id = ''; this.checked = false; this.type = ''; all.push(this); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  hasAttribute(k) { return k in this.attributes; }
  append(...nodes) { for (const n of nodes) this.appendChild(n); }
  appendChild(n) { n.parentElement = this; this.children.push(n); return n; }
  insertAdjacentElement(where, n) { assert.equal(where, 'afterend'); const p = this.parentElement; n.parentElement = p; p.children.splice(p.children.indexOf(this) + 1, 0, n); return n; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type) { for (const fn of this.listeners[type] || []) fn({ type, target: this, preventDefault() {} }); }
  closest() { return null; }
}
const pane = new El('div'); pane.className = 'settings-pane';
const performanceSection = new El('div'); performanceSection.id = 'settingsSection8';
const painterlySection = new El('div'); painterlySection.id = 'settingsSection9';
pane.append(performanceSection, painterlySection);
const connected = node => { for (let n = node; n; n = n.parentElement) if (n === pane) return true; return false; };
const document = {
  readyState: 'complete',
  createElement: tag => new El(tag),
  getElementById: id => all.find(n => n.id === id && connected(n)) || null,
  querySelector: sel => (sel === '.settings-pane' ? pane : null),
  addEventListener() {},
};

// --- Fake owners -------------------------------------------------------------
const calls = [];
const log = (name, v) => { calls.push(name + ':' + v); return v; };
let propOn = true, gearOnce = true, ownerLink = true, weaponLimit = 0, frameScope = true, treeOn = false, faceted = true;
const registered = [];
const storage = new Map([['hobunjiRenderOptimizations', JSON.stringify({ propBatches: false, gearParticlesOnce: false, rainSheets: false, unknownSwitch: false })]]);
const rain = { name: 'world_rain_planes', visible: true, parent: null };
const scene = { isScene: true, getObjectByName: name => (name === 'world_rain_planes' ? rain : null) };
rain.parent = scene;
const win = {
  ZonePropRenderBatches: { snapshot: () => ({ enabled: propOn }), setEnabled: v => { propOn = log('prop', v !== false); return propOn; } },
  HeldObjectRenderOrder: {
    snapshot: () => ({ gearParticlesOnceEnabled: gearOnce, heldOwnerLinkEnabled: ownerLink, otherWeaponXrayLimit: weaponLimit, replayScissorEnabled: true }),
    setGearParticlesOnceEnabled: v => { gearOnce = log('gear', v !== false); return gearOnce; },
    setHeldOwnerLinkEnabled: v => { ownerLink = log('link', v !== false); return ownerLink; },
    setOtherWeaponXrayLimit: n => { weaponLimit = log('limit', n); return weaponLimit; },
    setReplayScissorEnabled: v => log('scissor', v),
  },
  RenderHooks: {
    register: hook => { registered.push(hook); return () => registered.splice(registered.indexOf(hook), 1); },
    getDebug: () => ({ frameScopeEnabled: frameScope }),
    setFrameScopeEnabled: v => { frameScope = log('frameScope', v !== false); },
  },
  WildernessTreeInstancer: { enabled: () => treeOn, setEnabled: (v, opts) => { treeOn = log('tree', v !== false); calls.push('treePersist:' + !!opts?.persist); return treeOn; } },
  FacetedRocks: { enabled: () => faceted, setEnabled: v => { faceted = log('faceted', v !== false); return faceted; } },
  GridTileAccessors: { getActiveScene: () => scene },
  addEventListener() {},
};
win.window = win;
const context = vm.createContext({
  window: win, globalThis: win, document, console, JSON, Map, Object, Number, String,
  performance: { now: () => 0 },
  localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/js/render-optimization-settings.js'), 'utf8'), context, { filename: 'render-optimization-settings.js' });
const S = win.RenderOptimizationSettings;

// Stored choices were applied at load (unknown ids ignored).
assert.equal(propOn, false, 'stored propBatches:false applied');
assert.equal(gearOnce, false, 'stored gearParticlesOnce:false applied');
assert.equal(registered.length, 1, 'stored rainSheets:false installs the draw-only hider');

// The section sits right after Performance, dev-only, a controller subtab, one row per available switch.
const section = document.getElementById('settingsSectionRenderOptimizations');
assert.ok(section, 'section inserted');
assert.equal(pane.children.indexOf(section), pane.children.indexOf(performanceSection) + 1, 'after Performance');
assert.ok(section.hasAttribute('data-dev-only') && section.hasAttribute('data-ctrl-subtab'));
const input = id => document.getElementById('settingRenderOpt_' + id);
for (const id of ['propBatches', 'gearParticlesOnce', 'npcWeaponsBasePass', 'replayScissor', 'frameScopedHooks', 'treeInstancing', 'facetedRocks', 'rainSheets', 'skyClouds']) assert.ok(input(id), id + ' has a toggle');
for (const id of ['farmTileBatches', 'grassChunks', 'wildernessDistanceCull', 'hideFadedTrees', 'replayCull']) assert.equal(input(id), null, id + ': no owner here, no row');
assert.equal(input('propBatches').checked, false, 'reflects the applied stored value');
assert.equal(input('replayScissor').checked, true);
assert.equal(input('treeInstancing').checked, false, 'tree instancing is off by default');
assert.equal(input('npcWeaponsBasePass').checked, true, 'NPC weapons in the base pass by default');

// Toggling calls the owner and stores only values that differ from the default.
input('propBatches').checked = true; input('propBatches').dispatch('change');
assert.equal(propOn, true);
assert.equal(JSON.parse(storage.get('hobunjiRenderOptimizations')).propBatches, undefined, 'back to default: not pinned');
input('npcWeaponsBasePass').checked = false; input('npcWeaponsBasePass').dispatch('change');
assert.deepEqual([ownerLink, weaponLimit], [false, Infinity], 'off: every weapon x-rays again (no owner link, no budget)');
assert.equal(input('npcWeaponsBasePass').checked, false);
assert.equal(JSON.parse(storage.get('hobunjiRenderOptimizations')).npcWeaponsBasePass, false, 'the non-default choice is remembered');
input('frameScopedHooks').checked = false; input('frameScopedHooks').dispatch('change');
assert.equal(frameScope, false);

// Owners that persist themselves keep doing it; nothing of theirs goes into this module's storage.
input('treeInstancing').checked = true; input('treeInstancing').dispatch('change');
assert.ok(calls.includes('tree:true') && calls.includes('treePersist:true'), 'tree instancer persists its own choice');
input('facetedRocks').checked = false; input('facetedRocks').dispatch('change');
const stored = JSON.parse(storage.get('hobunjiRenderOptimizations'));
assert.equal('treeInstancing' in stored || 'facetedRocks' in stored, false);

// Draw-only hider: hidden inside the frame scope, restored after it.
const hook = registered[0];
assert.equal(hook.scope, 'frame');
const state = hook.before({});
assert.equal(rain.visible, false, 'rain sheets hidden while drawing');
hook.after({}, state);
assert.equal(rain.visible, true, 'and shown again after the frame');
input('rainSheets').checked = true; input('rainSheets').dispatch('change');
assert.equal(registered.length, 0, 'switching back on removes the hook');

// Live values: a console/benchmark change shows up on refresh.
gearOnce = true;
S.refresh();
assert.equal(input('gearParticlesOnce').checked, true);

// Set to Defaults: every switch at its shipped value, storage cleared.
document.getElementById('settingRenderOptResetDefaults').dispatch('click');
assert.deepEqual([propOn, gearOnce, ownerLink, weaponLimit, frameScope, treeOn, faceted, registered.length], [true, true, true, 0, true, false, true, 0]);
assert.equal(storage.has('hobunjiRenderOptimizations'), false);
assert.ok(S.list().every(t => t.value === t.default), 'list() reports defaults');

// Wiring: last script of the render group (after every owner), before game.js.
const group = fs.readFileSync(path.join(__dirname, '../docs/js/bootstrap/classic-groups/render.js'), 'utf8');
const urls = [...group.matchAll(/"(js\/[^"?]+)\?v=/g)].map(m => m[1]);
assert.equal(urls.at(-1), 'js/render-optimization-settings.js', 'loaded last in the render group');
console.log('render optimization settings: stored choices applied, section after Performance, live toggles, self-persisting owners, draw-only hiders, defaults');
