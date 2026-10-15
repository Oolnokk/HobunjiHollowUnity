'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const adapterSource = fs.readFileSync('docs/js/projectile-cover-pixel-probe.js', 'utf8'); // Production adapter under test.
const bootstrapSource = fs.readFileSync('docs/js/dev-random-ruin-bootstrap.js', 'utf8'); // Confirms normal ruin runtime loads the adapter before game.js init.
assert(/projectile-cover-pixel-probe\.js\?v=[A-Za-z0-9_-]+/.test(bootstrapSource), 'runtime bootstrap loads versioned semantic cover Pixel Probe adapter');

const platform = { key:'floating-platform', kind:'furniture', source:'authored-parts', shape:'aabb', x:5, z:0, halfX:2, halfZ:2, bottomY:2, topY:3 }; // Deliberately has no mesh/material; models the reported floating ruin platform volume.
const highCircle = { key:'circle-cover', kind:'furniture', source:'explicit-metadata', shape:'circle', x:9, z:0, radius:1, bottomY:2, topY:4 }; // Second semantic collider verifies ordered multi-hit reporting.
const lowMiss = { key:'low-table', kind:'furniture', source:'explicit-metadata', shape:'circle', x:6, z:0, radius:1, bottomY:0, topY:1 }; // Same X/Z ray but below camera height; must not be reported.
const resultEl = { textContent:'No probe yet' }; // Minimal Pixel Probe report target.
const observers = []; // Captures the production MutationObserver so the report append can be exercised synchronously.
class MutationObserver {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe() {}
}
class Raycaster {
  constructor() { this.ray = { origin:{x:0,y:2.5,z:0}, direction:{x:1,y:0,z:0} }; }
  setFromCamera() {} // Deterministic fixture ray; screen coordinates do not matter to this unit test.
}
let pointerHandler = null; // Installed production capture-phase Pixel Probe click hook.
const canvas = {
  addEventListener(type, handler, capture) { if (type === 'pointerdown') { pointerHandler = handler; this.capture = capture; } },
  getBoundingClientRect() { return { left:0, top:0, width:100, height:100 }; },
};
const window = {
  NearbyVolumeCollision:{ debugVolumes:()=>[highCircle, lowMiss, platform] },
  PixelProbe:{ armed:true, init(){ return 'initialized'; } },
};
const document = { getElementById:id => id === 'debugProbeResult' ? resultEl : null };
const context = { window, document, performance, MutationObserver, THREE:{ Raycaster } };
vm.runInNewContext(adapterSource, context);

const hits = window.ProjectileCoverPixelProbe.debugRayHits({x:0,y:2.5,z:0}, {x:1,y:0,z:0}, 20);
assert.equal(hits.map(hit => hit.key).join(','), 'floating-platform,circle-cover', 'semantic cover hits stay nearest-first and do not require render meshes');
assert.ok(Math.abs(hits[0].distanceWorld - 3) < 1e-9, 'AABB entry uses the actual near face');
assert.ok(Math.abs(hits[1].distanceWorld - 8) < 1e-9, 'circle entry uses the actual near arc');
assert.equal(hits.some(hit => hit.key === 'low-table'), false, 'vertical span rejects semantic cover below the clicked camera ray');

assert.equal(window.PixelProbe.init({ renderer:{domElement:canvas}, camera:{} }), 'initialized');
assert.equal(typeof pointerHandler, 'function', 'Pixel Probe init installs semantic-cover click capture');
assert.equal(canvas.capture, true, 'semantic cover capture runs before Pixel Probe stops pointer propagation');
pointerHandler({ clientX:50, clientY:50 });
assert.equal(window.ProjectileCoverPixelProbe.latest.hits[0].key, 'floating-platform', 'armed click records the collider that the camera ray actually enters first');

resultEl.textContent = 'Pixel Probe report\nRay meshes: 0';
assert.equal(observers.length, 1, 'report observer installs exactly once');
observers[0].callback();
assert.match(resultEl.textContent, /=== Semantic projectile-cover ray hits ===/);
assert.match(resultEl.textContent, /mesh\/material not required/);
assert.match(resultEl.textContent, /furniture:floating-platform/);
assert.match(resultEl.textContent, /source=authored-parts shape=aabb dist=3\.000u/);
assert.match(resultEl.textContent, /y=2\.000\.\.3\.000 half=\(2\.000,2\.000\)/);
const once = resultEl.textContent;
observers[0].callback();
assert.equal(resultEl.textContent, once, 'observer replaces instead of duplicating the semantic collider section');
console.log('Pixel Probe semantic projectile-cover ray regression passed.');
