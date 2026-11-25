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
const actorXrayDefaults = { animals: true, enemies: false, player: true }; // Shipped renderer defaults.
const actorXray = { ...actorXrayDefaults }; // Mock owner state for the regular Performance controls.
for (const group of Object.keys(actorXray)) {
  const control = new El('input');
  control.id = 'settingActorXray-' + group;
  performanceSection.appendChild(control);
}
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
let denMemo = true, wheelCross = true, leanSync = true, propOn = true, gearOnce = true, ownerLink = true, weaponLimit = 0, frameScope = true, treeOn = false, faceted = true;
let staticWallMatrices = false; // Independent experimental matrix branch owner.
let localRing = true, realTimeShadows = false; // Owner state for the two new performance policies.
const registered = [];
const storage = new Map([['hobunjiRenderOptimizations', JSON.stringify({ propBatches: false, gearParticlesOnce: false, rainSheets: false, 'xray-enemies': true, unknownSwitch: false })]]);
const rain = { name: 'world_rain_planes', visible: true, parent: null };
const scene = { isScene: true, getObjectByName: name => (name === 'world_rain_planes' ? rain : null) };
rain.parent = scene;
let outlineMode = 'screen'; // Fake pipeline owner for the experimental selector.
const win = {
  WorldRenderPipeline:{defaultGeneratedOutlineMode:'screen',getGeneratedOutlineMode:()=>outlineMode,setGeneratedOutlineMode:v=>outlineMode=v},
  DenseForestWallBatches: { staticMatrixSnapshot:()=>({enabled:staticWallMatrices}), setStaticMatrixEnabled:v=>{staticWallMatrices=log('staticWallMatrices',v===true);return staticWallMatrices;} },
  ZonePropRenderBatches: { snapshot: () => ({ enabled: propOn }), setEnabled: v => { propOn = log('prop', v !== false); return propOn; } },
  HeldObjectRenderOrder: {
    snapshot: () => ({ localReplayRingEnabled: localRing, gearParticlesOnceEnabled: gearOnce, heldOwnerLinkEnabled: ownerLink, otherWeaponXrayLimit: weaponLimit, replayScissorEnabled: true }),
    setLocalReplayRingEnabled: v => { localRing = log('localRing', v !== false); },
    setGearParticlesOnceEnabled: v => { gearOnce = log('gear', v !== false); return gearOnce; },
    setHeldOwnerLinkEnabled: v => { ownerLink = log('link', v !== false); return ownerLink; },
    setOtherWeaponXrayLimit: n => { weaponLimit = log('limit', n); return weaponLimit; },
    setReplayScissorEnabled: v => log('scissor', v),
    actorXrayDefaults,
    getActorXrayEnabled: group => actorXray[group],
    setActorXrayEnabled: (group, on) => { actorXray[group] = on; },
  },
  ShadowMapRefreshThrottle: { snapshot: () => ({ shadowRenderingEnabled:realTimeShadows }), setShadowRenderingEnabled: v => { realTimeShadows = log('shadows', v === true); } },
  RenderHooks: {
    register: hook => { registered.push(hook); return () => registered.splice(registered.indexOf(hook), 1); },
    getDebug: () => ({ frameScopeEnabled: frameScope }),
    setFrameScopeEnabled: v => { frameScope = log('frameScope', v !== false); },
  },
  WildernessTreeInstancer: { enabled: () => treeOn, setEnabled: (v, opts) => { treeOn = log('tree', v !== false); calls.push('treePersist:' + !!opts?.persist); return treeOn; } },
  InventoryWheelList: { crossFrameEnabled: () => wheelCross, setCrossFrameEnabled: v => { wheelCross = log('wheelCross', v !== false); return wheelCross; } },
  HobunjiDualWieldWeaponVisuals: { leanSyncEnabled: () => leanSync, setLeanSyncEnabled: v => { leanSync = log('leanSync', v !== false); return leanSync; } },
  FacetedRocks: { enabled: () => faceted, setEnabled: v => { faceted = log('faceted', v !== false); return faceted; } },
  GridTileAccessors: { getActiveScene: () => scene, denStateMemoEnabled: () => denMemo, setDenStateMemoEnabled: v => { denMemo = log('denMemo', v !== false); return denMemo; } },
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
const outlineSelect = document.getElementById('settingRenderOpt_generatedOutlineMode');
assert.equal(outlineSelect.value,'screen');
outlineSelect.value='shell'; outlineSelect.dispatch('change');
assert.equal(outlineMode,'shell');
assert.equal(JSON.parse(storage.get('hobunjiRenderOptimizations')).generatedOutlineMode,'shell');
outlineSelect.value='none'; outlineSelect.dispatch('change');
assert.equal(outlineMode,'none');

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
for (const id of ['propBatches', 'denStateMemo', 'wheelListCrossFrame', 'leanDualWieldSync', 'gearParticlesOnce', 'npcWeaponsBasePass', 'replayScissor', 'frameScopedHooks', 'treeInstancing', 'facetedRocks', 'rainSheets', 'skyClouds']) assert.ok(input(id), id + ' has a toggle');
for (const id of ['farmTileBatches', 'grassChunks', 'wildernessDistanceCull', 'hideFadedTrees', 'replayCull']) assert.equal(input(id), null, id + ': no owner here, no row');
assert.equal(input('propBatches').checked, false, 'reflects the applied stored value');
assert.equal(input('replayScissor').checked, true);
assert.equal(input('treeInstancing').checked, false, 'tree instancing is off by default');
assert.equal(input('staticWallMatrices').checked,false,'static wall experiment is off by default');
input('staticWallMatrices').checked=true; input('staticWallMatrices').dispatch('change');
assert.equal(staticWallMatrices,true);
assert.equal(JSON.parse(storage.get('hobunjiRenderOptimizations')).staticWallMatrices,true);
assert.equal(input('npcWeaponsBasePass').checked, true, 'NPC weapons in the base pass by default');

assert.equal(input('localReplayRing').checked,true);
assert.equal(input('realTimeShadows').checked,false);
input('localReplayRing').checked = false; input('localReplayRing').dispatch('change');
input('realTimeShadows').checked = true; input('realTimeShadows').dispatch('change');
assert.equal(localRing,false); assert.equal(realTimeShadows,true);
assert.equal(JSON.parse(storage.get('hobunjiRenderOptimizations')).localReplayRing,false);
assert.equal(JSON.parse(storage.get('hobunjiRenderOptimizations')).realTimeShadows,true);

// Regular Performance controls apply the stored choice and persist independently.
const animalXray = document.getElementById('settingActorXray-animals');
const enemyXray = document.getElementById('settingActorXray-enemies');
const playerXray = document.getElementById('settingActorXray-player');
assert.deepEqual([animalXray.checked, enemyXray.checked, playerXray.checked], [true, true, true]);
assert.ok([animalXray, enemyXray, playerXray].every(control => control.parentElement === performanceSection));
animalXray.checked = false;
animalXray.dispatch('change');
assert.deepEqual(actorXray, { animals: false, enemies: true, player: true });
assert.equal(JSON.parse(storage.get('hobunjiRenderOptimizations'))['xray-animals'], false);

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

input('denStateMemo').checked = false; input('denStateMemo').dispatch('change');
assert.equal(denMemo, false, 'den collision can go back to a per-tile lookup');
input('wheelListCrossFrame').checked = false; input('wheelListCrossFrame').dispatch('change');
assert.equal(wheelCross, false, 'the item wheel list can go back to a per-frame rebuild');
input('leanDualWieldSync').checked = false; input('leanDualWieldSync').dispatch('change');
assert.equal(leanSync, false, 'lean dual-wield sync can be switched off');
assert.equal(JSON.parse(storage.get('hobunjiRenderOptimizations')).leanDualWieldSync, false);

// Live values: a console/benchmark change shows up on refresh.
gearOnce = true;
S.refresh();
assert.equal(input('gearParticlesOnce').checked, true);

// Set to Defaults: every switch at its shipped value, storage cleared.
document.getElementById('settingRenderOptResetDefaults').dispatch('click');
assert.deepEqual([propOn, gearOnce, ownerLink, weaponLimit, frameScope, treeOn, faceted, registered.length, leanSync, wheelCross, denMemo], [true, true, true, 0, true, false, true, 0, true, true, true]);
assert.equal(storage.has('hobunjiRenderOptimizations'), false);
assert.equal(outlineMode,'screen');
assert.equal(outlineSelect.value,'screen');
assert.equal(localRing,true); assert.equal(realTimeShadows,false);
assert.equal(staticWallMatrices,false,'reset disables static wall experiment');
assert.deepEqual(actorXray, actorXrayDefaults);
assert.deepEqual([animalXray.checked, enemyXray.checked, playerXray.checked], [true, false, true]);
const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8'); // Verify defaults before the settings script starts.
for (const [key, value] of Object.entries(actorXrayDefaults)) {
  const input = html.match(new RegExp('<input[^>]+id="settingActorXray-' + key + '"[^>]*>'));
  assert.ok(input, key + ' ships a Performance toggle');
  assert.equal(/\bchecked\b/.test(input[0]), value, key + ' has the same HTML and renderer defaults');
}
assert.ok(S.list().every(t => t.value === t.default), 'list() reports defaults');

// Wiring: last script of the render group (after every owner), before game.js.
const group = fs.readFileSync(path.join(__dirname, '../docs/js/bootstrap/classic-groups/render.js'), 'utf8');
const urls = [...group.matchAll(/"(js\/[^"?]+)\?v=/g)].map(m => m[1]);
assert.equal(urls.at(-1), 'js/render-optimization-settings.js', 'loaded last in the render group');
console.log('render optimization settings: stored choices applied, section after Performance, live toggles, self-persisting owners, draw-only hiders, defaults');
