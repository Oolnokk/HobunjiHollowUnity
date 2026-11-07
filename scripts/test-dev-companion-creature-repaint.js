#!/usr/bin/env node
'use strict';
// Exercises the real FarmAnimals genotype compositor and the Dev Companion's public adapter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
  const source = fs.readFileSync('docs/js/farm-animals.js', 'utf8');
  const start = source.indexOf('  const _farmGenotypeTexCache');
  const end = source.indexOf('  // ── Locomotion frames', start);
  assert(start >= 0 && end > start, 'canonical genotype texture compositor must exist');
  assert.match(source, /refreshGenotypeAvatar:[\s\S]*?_applyGenotypeCompositeTexture\(avatarRef, kind, frame, genotype, blinkShut\)/,
    'the public refresh method must reuse the canonical cache-backed compositor');

  const cache = new Map(); // Real front/back texture pairs are keyed by genotype/frame and reused across animals.
  const owners = new WeakMap(); // Matches the production cache's per-avatar ownership model.
  let uploaded = 0;
  let composed = 0;
  class CanvasTexture {
    constructor(canvas) {
      this.image = canvas;
      this.repeat = { set() {} };
      this.offset = { set() {} };
      uploaded++;
    }
  }
  const window = {
    CreatureTextureCache: {
      genotypeFrameSetKey: key => key,
      create: () => ({
        get: key => cache.get(key) || null,
        put: (key, pair) => { if (!cache.has(key)) cache.set(key, pair); return cache.get(key); },
        retain: (avatar, key) => owners.set(avatar, key),
      }),
      fitGeneratedCanvas: image => image,
      isDisposed: owner => !!owner.disposed,
    },
    CreatureGeneticsRender: {
      genotypeSignature: (_kind, genes) => genes.base.color,
      eyeStateKey: () => 'o',
      composeFrame: async (_kind, _frame, genes) => {
        composed++;
        return { width: 32, height: 24, coat: genes.base.color };
      },
    },
    PNGPlaneAvatar: { backMapFor: (_material, pair) => pair.front },
    HobunjiCacheAudit: { register() {} },
  };
  const ctx = { window, THREE: { CanvasTexture, SRGBColorSpace: 'srgb', RepeatWrapping: 'repeat' } };
  vm.runInNewContext(source.slice(start, end) + '\nwindow.refreshForTest = _applyGenotypeCompositeTexture;', ctx);

  const avatar = () => {
    const front = { name: 'hound_front_plane', material: { map: { id: 'old' } } };
    const back = { name: 'hound_back_plane', material: { map: { id: 'old' } } };
    return { frontPlane: front, backPlane: back, group: { children: [front, back] } };
  };
  const genes = { base: { color: '#aabbcc' } };
  const first = avatar();
  assert.equal(await window.refreshForTest(first, 'dabinggi', 'idle', genes, false), true);
  assert.equal(first.frontPlane.material.map.image.coat, '#aabbcc');
  assert.equal(first.backPlane.material.map, first.frontPlane.material.map,
    'mirror shader reuses the front generated texture instead of a humanoid canvas uploader');
  assert.equal(uploaded, 2, 'one cached genotype pair is allocated');
  assert.equal(composed, 1);

  const other = avatar();
  await window.refreshForTest(other, 'dabinggi', 'idle', genes, false);
  assert.equal(other.frontPlane.material.map, first.frontPlane.material.map, 'matching animals share the same cache entry');
  assert.equal(uploaded, 2, 'shared genotype does not allocate extra GPU textures');

  genes.base.color = '#334455';
  await window.refreshForTest(first, 'dabinggi', 'idle', genes, false);
  assert.equal(first.frontPlane.material.map.image.coat, '#334455', 'live changed genotype visibly replaces the material map');
  assert.equal(composed, 2);
  assert.equal(owners.has(first), true);
  assert.equal(owners.has(other), true);
  const disposed = avatar();
  disposed.disposed = true;
  assert.equal(await window.refreshForTest(disposed, 'dabinggi', 'idle', genes, false), false,
    'disposed entity is never rebound with a late texture');
  console.log('test-dev-companion-creature-repaint: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
