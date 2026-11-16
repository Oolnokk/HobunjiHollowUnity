#!/usr/bin/env node
'use strict';
// The outline occluder's PNG replay is documented as depth-only. Silencing each registered mesh's
// material is not enough: a layer-4 mesh that was never registered (a cloned dual-wield weapon copy
// inherits the layer) still has colorWrite on and used to paint itself over the finished frame, outside
// the owner's portrait stencil and depth. The replay must lock the GL colour mask for its whole render.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const browser = { window: {}, THREE: { LessEqualDepth: 'less-equal' } };
vm.runInNewContext(fs.readFileSync('docs/js/png-plane-outline-occluder.js', 'utf8'), browser, { filename: 'png-plane-outline-occluder.js' });
const occluder = browser.window.PngPlaneOutlineOccluder;

function sceneWithRegisteredMesh() {
  const scene = { isScene: true };
  const mesh = {
    isMesh: true, visible: true, userData: {}, parent: scene,
    material: { colorWrite: true, depthWrite: false, depthTest: false, depthFunc: 0, alphaTest: 0.35 },
    layers: { mask: 1, enable(layer) { this.mask |= 1 << layer; } },
  };
  occluder.registerDepthMesh(mesh);
  return scene;
}

function makeRig({ throwInRender = false } = {}) {
  const log = [];
  const color = { locked: false, mask: true };
  color.setMask = value => { if (!color.locked) color.mask = value; log.push(`mask:${value}${color.locked ? '(ignored)' : ''}`); };
  color.setLocked = value => { color.locked = value; log.push(`lock:${value}`); };
  const camera = { layers: { mask: 1, set(layer) { this.mask = 1 << layer; } } };
  let seenDuringRender = null;
  const renderer = {
    state: { buffers: { color } },
    render() {
      seenDuringRender = { locked: color.locked, mask: color.mask };
      // A stray unregistered layer-4 mesh tries to write colour; the GL state is what decides if it lands.
      color.setMask(true);
      seenDuringRender.maskAfterStrayWrite = color.mask;
      if (throwInRender) throw new Error('boom');
    },
  };
  occluder.init({ renderer, camera });
  return { color, log, camera, get seen() { return seenDuringRender; } };
}

// Colour is locked off while the replay renders, and a late setMask(true) cannot re-enable it.
{
  const rig = makeRig();
  occluder.renderDepth(sceneWithRegisteredMesh());
  assert.deepEqual({ locked: rig.seen.locked, mask: rig.seen.mask }, { locked: true, mask: false }, 'colour is locked off during the depth-only replay');
  assert.equal(rig.seen.maskAfterStrayWrite, false, 'an unregistered layer-4 mesh cannot turn colour writes back on');
  assert.deepEqual({ locked: rig.color.locked, mask: rig.color.mask }, { locked: false, mask: true }, 'normal colour writes are restored afterwards');
  assert.equal(rig.camera.layers.mask, 1, 'camera layer mask is restored');
}

// Restored even when the replay throws, so one failed frame cannot leave the game colourless.
{
  const rig = makeRig({ throwInRender: true });
  assert.throws(() => occluder.renderDepth(sceneWithRegisteredMesh()), /boom/);
  assert.deepEqual({ locked: rig.color.locked, mask: rig.color.mask }, { locked: false, mask: true }, 'colour state restored after a throw');
}

// A renderer without the colour-buffer API (older builds, stubs) still replays without crashing.
{
  let rendered = 0;
  occluder.init({ renderer: { render() { rendered++; } }, camera: { layers: { mask: 1, set(layer) { this.mask = 1 << layer; } } } });
  occluder.renderDepth(sceneWithRegisteredMesh());
  assert.equal(rendered, 1, 'replay still runs when the colour buffer cannot be locked');
}

console.log('png outline occluder colour lock ok');
