'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let clock = 0; // Drives the cache's working-set window deterministically.
const context = { window: {}, performance: { now: () => clock } };
vm.runInNewContext(fs.readFileSync('docs/js/creature-texture-cache.js', 'utf8'), context);
const manager = context.window.CreatureTextureCache;
const mirrors = { front: new Map(), back: new Map() };
const cache = manager.create('stress', mirrors);
function pair(size = 512) {
  const image = { width: size, height: size };
  const texture = () => ({ image, disposals: 0, dispose() { this.disposals++; } });
  return { front: texture(), back: texture() };
}
const live = pair();
cache.put('live', live);
const first = {}, second = {};
cache.retain(first, 'live');
cache.retain(second, 'live');
for (let i = 0; i < 1000; i++) cache.put('frame-' + i, pair());
assert.equal(cache.snapshot().livePairs, 1);
assert.ok(cache.snapshot().unusedEstimatedBytes <= cache.snapshot().unusedBudgetBytes);
assert.equal(live.front.disposals, 0, 'memory pressure never evicts a bound texture');
cache.release(first);
cache.release(first);
assert.equal(cache.snapshot().livePairs, 1, 'repeated release does not decrement another owner');
manager.releaseOwner(second);
for (let i = 0; i < 10; i++) cache.put('new-' + i, pair());
assert.equal(live.front.disposals, 1);
assert.equal(live.back.disposals, 1);
assert.equal(mirrors.front.has('live'), false);
assert.equal(cache.retain(second, 'new-9'), false, 'removed avatars reject late loads');
const preload = {}, preloaded = pair();
cache.retain(preload, 'preload');
cache.put('preload', preloaded);
for (let i = 0; i < 10; i++) cache.put('pressure-' + i, pair());
assert.equal(preloaded.front.disposals, 0, 'preloading pins work before async composition completes');
cache.release(preload);
for (let i = 0; i < 10; i++) cache.put('after-' + i, pair());
assert.equal(preloaded.front.disposals, 1);
const tiny = manager.create('tiny');
for (let i = 0; i < 1000; i++) tiny.put(String(i), pair(1));
assert.equal(tiny.snapshot().unusedPairs, 64, 'small textures cannot grow the key cache forever');
const duplicate = pair(1);
const canonical = tiny.get('999');
assert.equal(tiny.put('999', duplicate), canonical);
assert.equal(duplicate.front.disposals, 1, 'overlapping uploads dispose the redundant pair');

// A walking/blinking animal cycles through every frame of its genotype. Each
// composite is ~12MB (1375x600 sprites), so pinning only the bound frame let
// the 24MB idle budget evict the frames it had just left, and every frame
// swap recomposed colors/patterns/eyes from scratch.
assert.equal(manager.genotypeFrameSetKey('gar-wolf|run1|#aa|colorpoint:#22||paint:x|o'), 'gar-wolf|#aa|colorpoint:#22||paint:x');
assert.equal(manager.genotypeFrameSetKey('plain-key'), 'plain-key');
{
  const sets = manager.create('frame-sets', { front: new Map(), back: new Map() }, new Map(), { frameSetOf: manager.genotypeFrameSetKey });
  const sig = '#884422|colorpoint:#222222|foxtail:';
  const frames = ['idle|' + sig + '|o', 'run1|' + sig + '|o', 'run2|' + sig + '|o', 'idle|' + sig + '|b'].map(rest => 'gar-wolf|' + rest);
  const pairs = frames.map(() => pair(1375));
  const wolf = {};
  sets.retain(wolf, frames[0]); // The animal binds its first frame (still composing); siblings compose while it is on screen.
  frames.forEach((key, i) => sets.put(key, pairs[i]));
  for (let step = 0; step < 20; step++) {
    sets.retain(wolf, frames[step % frames.length]); // Walk + blink cycle.
    for (let i = 0; i < 3; i++) sets.put(`other|idle|noise${step}-${i}|o`, pair(1375)); // Unrelated idle pressure.
  }
  assert.ok(pairs.every(p => p.front.disposals === 0), 'an on-screen animal keeps every frame of its genotype resident');
  assert.ok(frames.every(key => sets.get(key)), 'each walk/blink frame is still a cache hit');
  assert.equal(sets.snapshot().pinnedFrameSets, 1);
  const boundKey = frames[19 % frames.length];
  assert.equal(sets.keyFor(wolf), boundKey);

  // The animal stands still on one frame for longer than the working-set
  // window: its other frames become ordinary evictable entries again, so
  // memory tracks what animals are actually cycling through.
  clock += 31000;
  for (let i = 0; i < 6; i++) sets.put(`still|idle|n${i}|o`, pair(1375));
  assert.ok(frames.filter(key => key !== boundKey).every(key => !sets.get(key)), 'frames unused for the working-set window can be evicted');
  assert.ok(sets.get(boundKey), 'the frame on screen is never evicted');

  manager.releaseOwner(wolf);
  assert.equal(sets.snapshot().pinnedFrameSets, 0);
  for (let i = 0; i < 6; i++) sets.put(`later|idle|n${i}|o`, pair(1375));
  assert.ok(pairs.every(p => p.front.disposals === 1), 'once the animal is gone its frames are ordinary evictable idle entries');
}
console.log('Animal texture residency, shared lifetime, preload pins, and memory pressure passed.');
