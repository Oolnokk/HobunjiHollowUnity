#!/usr/bin/env node
'use strict';

// The farm's fixed sun shadow map is refreshed every 250 ms or when the scene
// changes, not on every frame. Runs the real module against a fake renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = rel => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
let callback = null, registration = null;
const shadowMap = { enabled: true, autoUpdate: true, needsUpdate: false };
const scene = { children: [1, 2, 3] };
let activeScene = scene;
const window = {
  __hobunjiGameRenderer: { shadowMap },
  GridTileAccessors: { getActiveScene: () => activeScene },
  RuntimeFrameScheduler: { register(id, fn, opts) { callback = fn; registration = { id, ...opts }; } },
};
vm.runInContext(read('docs/js/shadow-map-refresh-throttle.js'), vm.createContext({ window, performance: { now: () => 0 } }), { filename: 'shadow-map-refresh-throttle.js' });
assert.equal(registration?.phase, 'pre-render', 'runs right before the world render');

const frame = t => { shadowMap.needsUpdate = false; callback({ timestamp: t }); return shadowMap.needsUpdate; }; // The world render consumes needsUpdate each frame.
assert.equal(frame(0), false, 'default skips all real-time shadow work');
assert.equal(shadowMap.enabled,false);
assert.equal(window.ShadowMapRefreshThrottle.snapshot().shadowRenderingEnabled,false);
window.ShadowMapRefreshThrottle.setShadowRenderingEnabled(true);
assert.equal(shadowMap.enabled,true,'opt-in restores shadow maps');
assert.equal(frame(0), false, 'the immediate opt-in tick already requests the first map');
assert.equal(frame(250), true, 'next interval refreshes');
assert.equal(shadowMap.autoUpdate, false, 'per-frame automatic updates are handed to the throttle');
const refreshed = [];
for (let t = 266; t <= 1250; t += 16) if (frame(t)) refreshed.push(t);
assert.ok(refreshed.length >= 3 && refreshed.length <= 4, 'about four refreshes per second at 60 FPS: ' + refreshed);
scene.children.push(4);
assert.equal(frame(1260), true, 'a scene child added or removed refreshes at once');
activeScene = { children: [] };
assert.equal(frame(1270), true, 'entering another scene refreshes at once');
assert.equal(frame(1280), false);

window.ShadowMapRefreshThrottle.setEnabled(false);
assert.equal(shadowMap.autoUpdate, true, 'disabling restores per-frame updates');
window.ShadowMapRefreshThrottle.setShadowRenderingEnabled(false); window.ShadowMapRefreshThrottle.setEnabled(true);
assert.equal(frame(2000), false, 'no shadow map, nothing to do');
const replacement = {enabled:true, autoUpdate:true, needsUpdate:true};
window.__hobunjiGameRenderer = {shadowMap:replacement};
callback({timestamp:2010});
assert.equal(replacement.enabled,false,'new renderer also uses the disabled policy');
assert.equal(replacement.needsUpdate,false);
window.ShadowMapRefreshThrottle.setShadowRenderingEnabled(true);
assert.equal(replacement.enabled,true);
assert.equal(replacement.autoUpdate,false);
assert.equal(replacement.needsUpdate,true,'restoring shadows requests a fresh map immediately');

const { expandClassicScriptGroups } = require('./classic-script-group-index.js');
const page = expandClassicScriptGroups();
assert.ok(page.search(/js\/shadow-map-refresh-throttle\.js\?v=[A-Za-z0-9_-]+/) > 0 && page.search(/js\/shadow-map-refresh-throttle\.js/) < page.search(/src="game\.js\?v=/), 'loaded before game.js');
console.log('ok - shadow map refreshes 4x per second or on scene changes, not every frame');
