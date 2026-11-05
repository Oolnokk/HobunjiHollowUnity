#!/usr/bin/env node
'use strict';

// Creature sprites authored far larger than they are shown (grehlr is
// 3000x2250, ~36 MB of mipmapped GPU memory per frame) are scaled down once at
// load. Smaller art must be returned untouched.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/creature-texture-cache.js'), 'utf8');

const drawn = [];
const document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    return {
      width: 0, height: 0,
      getContext: () => ({ imageSmoothingEnabled: false, imageSmoothingQuality: '', drawImage: (...args) => drawn.push(args) }),
    };
  },
};
const context = { window: {}, document, performance: { now: () => 0 } };
vm.runInNewContext(source, context, { filename: 'creature-texture-cache.js' });
const cache = context.window.CreatureTextureCache;

const grehlr = { naturalWidth: 3000, naturalHeight: 2250 };
const capped = cache.capSourceImage(grehlr);
assert.notEqual(capped, grehlr, 'an oversized sprite is replaced');
assert.equal(capped.width, 1536, 'long edge is capped');
assert.equal(capped.height, 1152, 'aspect ratio is preserved (3000x2250 -> 1536x1152)');
assert.equal(drawn.length, 1);
assert.deepEqual(drawn[0].slice(1), [0, 0, 1536, 1152], 'the whole image is drawn into the capped canvas');

const tall = cache.capSourceImage({ naturalWidth: 900, naturalHeight: 3600 });
assert.equal(tall.height, 1536);
assert.equal(tall.width, 384, 'a tall sprite is capped on its height');

for (const size of [[1375, 600], [800, 525], [1536, 1000], [256, 256]]) {
  const small = { naturalWidth: size[0], naturalHeight: size[1] };
  assert.equal(cache.capSourceImage(small), small, `${size.join('x')} is within the cap and returned untouched`);
}
assert.equal(cache.capSourceImage(null), null, 'missing images pass through');

// The loader callback swaps the texture image and marks it for upload.
const texture = { image: grehlr, needsUpdate: false };
assert.equal(cache.capLoadedTexture(texture), texture);
assert.equal(texture.image.width, 1536);
assert.equal(texture.needsUpdate, true, 'a replaced image is re-uploaded');
const smallTexture = { image: { naturalWidth: 640, naturalHeight: 480 }, needsUpdate: false };
cache.capLoadedTexture(smallTexture);
assert.equal(smallTexture.needsUpdate, false, 'an in-bound texture is left alone');

// Config override.
context.window.SCRATCHBONES_CONFIG = { game: { assets: { pngPlaneAvatar: { maxSourceEdge: 1024 } } } };
assert.equal(cache.capSourceImage({ naturalWidth: 1375, naturalHeight: 600 }).width, 1024, 'maxSourceEdge config is honored');

// Wiring: all three sprite loaders use the cap.
const game = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8');
assert.equal((game.match(/\.load\(url, window\.CreatureTextureCache\?\.capLoadedTexture\)/g) || []).length, 2, 'front and back plain-frame textures are capped');
const avatar = fs.readFileSync(path.join(root, 'docs/js/png-plane-avatar.js'), 'utf8');
assert.match(avatar, /CreatureTextureCache\?\.capLoadedTexture\?\.\(loaded\)/, 'shared animal source textures are capped');

console.log('creature sprite cap regression passed');
