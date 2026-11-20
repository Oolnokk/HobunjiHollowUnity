#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const author = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8'); // Reads the real editor's markup and active inline script.
const avatar = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8'); // The editor's pinned script is the game's shared portrait mesh controller.
const scripts = [...author.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]; // All inline editor scripts must still parse when the large page is updated.
assert(scripts.length > 0, 'Animation Author contains executable inline scripts');
for (const [i, script] of scripts.entries()) {
  if (script[1].trim()) new vm.Script(script[1], { filename: 'animation-author:inline-' + i });
}

assert.match(author, /id="maaPortraitMeshDensity"[^>]*type="range"|type="range" id="maaPortraitMeshDensity"/, 'touch-friendly portrait density slider exists');
assert.match(author, /id="maaPortraitMeshWireframe"/, 'the Animation Author exposes an actual wireframe checkbox');
assert.match(author, /id="maaPortraitMeshDensity"[^>]*value="40"/, 'author preview markup starts at production density before runtime boot');
assert.match(author, /id="maaPortraitMeshDensityValue">40%/, 'author density readout starts at the production baseline');
assert.match(author, /AUTHOR_PORTRAIT_RUNTIME_SCRIPT = new URL\('\.\.\/\.\.\/js\/png-plane-avatar\.js\?v=/,
  'the editor pins its own portrait runtime instead of loading an incompatible older repo revision');
assert.match(author, /relativePath === 'js\/png-plane-avatar\.js' \? AUTHOR_PORTRAIT_RUNTIME_SCRIPT/,
  'the repository runtime loader selects the pinned portrait module');
assert.match(author, /densityBudget\?\.portraitGrid\?\.\('full'\)/, 'the editor builds its initial NPC grid from the shared density authority');
assert.match(author, /registerExternalSkinnedPortrait\?\.\(skinnedPlane/, 'the editor registers its own skinned rig with the shared live update controller');
assert.ok(author.includes('buildGeometry: grid => buildTwoSidedSkinnedPlaneGeometry(THREE, modelWidth, modelHeight, neckLocal, { ...grid, pixelHeight: pxH })'),
  'density changes preserve the editor-specific portrait skin weighting function');
assert.match(author, /afterGeometryChange\(nextGeometry\)/, 'editor hat layers receive refreshed face-specific skin geometry');
assert.match(author, /rig\.hatXrayOverlay\?\.meshes/, 'existing lazy hat skin clones are updated');
assert.match(author, /group\.visible = !window\.PNGPlaneAvatar\?\.meshBudget\?\.wireframeEnabled\?\.\(\)/,
  'hats created while wireframe is enabled cannot obscure the diagnostics');
assert.match(author, /setPortraitWireframeEnabled\?\.\(wireframeToggle\.checked\)/,
  'author UI delegates to the same material lifecycle as gameplay');
assert.match(avatar, /registerExternalSkinnedPortrait/, 'production module provides the custom geometry hook');
assert.match(avatar, /setPortraitWireframeEnabled/, 'production module provides reversible wireframe display');

const start = author.indexOf('function smoothstep01(value)');
const end = author.indexOf('async function buildNpcNeckRig(', start);
assert(start >= 0 && end > start, 'extract the real Animation Author geometry builder');
const runtimeWindow = {}; // The editor uses gameplay's exact base-head neck and independent placement helpers.
vm.runInNewContext(avatar, {
  window: runtimeWindow,
  localStorage: { getItem() { return null; } },
  document: { getElementById() { return null; } },
});
assert.ok(runtimeWindow.PNGPlaneAvatar?.headOffsetWeightAt, 'native placement helper is available to the author');
const build = vm.runInNewContext('(() => { ' + author.slice(start, end) + ' return buildTwoSidedSkinnedPlaneGeometry; })()', { window: runtimeWindow });
class Attribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; }
  getX(index) { return this.array[index * this.itemSize]; }
  getY(index) { return this.array[index * this.itemSize + 1]; }
  getZ(index) { return this.array[index * this.itemSize + 2]; }
}
class Plane {
  constructor(width, height, xSegments, ySegments) {
    this.attributes = {};
    const pos = [], uv = [];
    const append = (x, y) => { pos.push(width * (x - .5), height * (.5 - y), 0); uv.push(x, 1-y); };
    for (let r=0;r<ySegments;r++) for(let c=0;c<xSegments;c++) {
      const x0=c/xSegments,x1=(c+1)/xSegments,y0=r/ySegments,y1=(r+1)/ySegments;
      for (const [x,y] of [[x0,y1],[x1,y1],[x0,y0],[x1,y1],[x1,y0],[x0,y0]]) append(x,y);
    }
    this.attributes.position = new Attribute(pos,3);
    this.attributes.uv = new Attribute(uv,2);
  }
  toNonIndexed() { return this; }
  getAttribute(name) { return this.attributes[name]; }
  dispose() { this.disposed = true; }
}
class BufferGeometry {
  constructor() { this.attributes = {}; this.groups = []; this.userData = {}; }
  setAttribute(name, attribute) { this.attributes[name] = attribute; }
  getAttribute(name) { return this.attributes[name]; }
  addGroup(start, count, materialIndex) { this.groups.push({ start, count, materialIndex }); }
  computeBoundingBox() {}
  computeBoundingSphere() {}
}
const THREE = { PlaneGeometry: Plane, BufferGeometry, BufferAttribute: Attribute,
  Uint16BufferAttribute: Attribute, Float32BufferAttribute: Attribute };
for (const [sx,sy] of [[28,36],[14,18],[6,8],[4,6]]) {
  const geometry = build(THREE,1,1,{ x:0, y:0.2, z:0 },{segmentsX:sx,segmentsY:sy});
  assert.equal(geometry.userData.segmentsX, sx);
  assert.equal(geometry.userData.segmentsY, sy);
  assert.equal(geometry.getAttribute('position').count / 3, sx*sy*4, 'two faces with two triangles per cell');
  assert.equal(geometry.groups[0].count, sx*sy*6, 'front material group covers exactly one face');
  assert.equal(geometry.groups[1].start, sx*sy*6, 'rear group starts after front-face vertices');
  assert.equal(geometry.groups[1].count, sx*sy*6, 'rear material group covers exactly one face');
  assert.equal(geometry.getAttribute('skinIndex').count, sx*sy*12, 'every vertex retains three-bone indices');
  const weights = geometry.getAttribute('skinWeight');
  for (let i=0;i<weights.count;i+=Math.max(1,Math.floor(weights.count/17))) {
    const a=weights.array[i*4], b=weights.array[i*4+1], c=weights.array[i*4+2];
    assert(Math.abs(a+b+c-1)<1e-6, 'offset, neck and torso weights remain normalized at all densities');
  }
}
console.log('OK: Animation Author renders sprite-anchored three-bone meshes at every density.');
