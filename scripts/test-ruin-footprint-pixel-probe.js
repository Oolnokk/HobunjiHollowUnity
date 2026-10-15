'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const adapterSource = fs.readFileSync('docs/js/ruin-footprint-pixel-probe.js', 'utf8'); // Production exact-footprint Pixel Probe adapter.
const footprintSource = fs.readFileSync('docs/js/dev-random-ruin-solid-footprints.js', 'utf8'); // Source geometry liveness must gate scanned footprints.
const bootstrapSource = fs.readFileSync('docs/js/dev-random-ruin-bootstrap.js', 'utf8'); // Runtime loader coverage.
assert(/ruin-footprint-pixel-probe\.js\?v=[A-Za-z0-9_-]+/.test(bootstrapSource), 'runtime bootstrap loads the exact-footprint Pixel Probe adapter');
assert(footprintSource.includes('function stillOwnedByScanRoot(fp)'), 'scanned ruin footprints have a source-geometry liveness gate');
assert(footprintSource.includes('if (!stillOwnedByScanRoot(fp)) return false;'), 'inactive hidden/detached scanned geometry is rejected before collision');
assert(footprintSource.includes('fp.mesh = mesh;'), 'scan retains the source mesh required to invalidate ghost footprints');

const footprint = {
  source:'floating-platform-mesh', tag:'static', meshId:77,
  cx:5, cz:0, ux:1, uz:0, vx:0, vz:1,
  halfU:2, halfV:2, minY:2, maxY:3,
}; // Models the reported thick elevated platform collider with no material dependency in the probe.
const resultEl = { textContent:'No probe yet' };
const observers = [];
class MutationObserver {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe() {}
}
class Raycaster {
  constructor() { this.ray = { origin:{x:0,y:2.5,z:0}, direction:{x:1,y:0,z:0} }; }
  setFromCamera() {}
}
let pointerHandler = null;
const canvas = {
  addEventListener(type, handler, capture) { if (type === 'pointerdown') { pointerHandler = handler; this.capture = capture; } },
  getBoundingClientRect() { return { left:0, top:0, width:100, height:100 }; },
};
const occupancy = {
  solidAt(x, z, _half, y) {
    return x >= 3 && x <= 7 && Math.abs(z) <= 2 && y >= 2 && y <= 3 ? footprint : null;
  },
};
const window = {
  DevRandomRuinTileOccupancy:occupancy,
  PixelProbe:{ armed:true, init(){ return 'initialized'; } },
};
const document = { getElementById:id => id === 'debugProbeResult' ? resultEl : null };
vm.runInNewContext(adapterSource, { window, document, performance, MutationObserver, THREE:{ Raycaster } });

const hits = window.RuinFootprintPixelProbe.debugRayHits({x:0,y:2.5,z:0}, {x:1,y:0,z:0}, 20);
assert.equal(hits.length, 1, 'camera ray finds one exact ruin footprint');
assert.equal(hits[0].source, 'floating-platform-mesh');
assert(Math.abs(hits[0].distanceWorld - 3) < 0.01, 'ray-march refinement reports the platform near face');
assert.equal(hits[0].minY, 2);
assert.equal(hits[0].maxY, 3);
assert.equal(hits[0].halfU, 2);
assert.equal(hits[0].halfV, 2);

assert.equal(window.PixelProbe.init({ renderer:{domElement:canvas}, camera:{} }), 'initialized');
assert.equal(typeof pointerHandler, 'function', 'Pixel Probe init installs exact-footprint click capture');
assert.equal(canvas.capture, true, 'exact-footprint capture runs before the main probe consumes the click');
pointerHandler({ clientX:50, clientY:50 });
assert.equal(window.RuinFootprintPixelProbe.latest.hits[0].source, 'floating-platform-mesh');
resultEl.textContent = 'Pixel Probe report\nRay meshes: 0';
assert.equal(observers.length, 1, 'exact-footprint report observer installs once');
observers[0].callback();
assert.match(resultEl.textContent, /=== Ruin exact-footprint ray hits ===/);
assert.match(resultEl.textContent, /floating-platform-mesh/);
assert.match(resultEl.textContent, /dist=3\.00/);
assert.match(resultEl.textContent, /half=\(2\.000,2\.000\)/);
assert.match(resultEl.textContent, /y=2\.000\.\.3\.000/);
console.log('Ruin exact-footprint Pixel Probe and ghost-footprint liveness regression passed.');
