#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Verifies gift policy decisions without starting game.js or WebGL.
const fs = require('node:fs'); // Loads the production policy module.
const vm = require('node:vm'); // Runs its browser export in isolation.
const window = {}; // Host for the shipped HeldGiftPolicy API.
vm.runInNewContext(fs.readFileSync('docs/js/held-gift-policy.js', 'utf8'), { window }, { filename: 'held-gift-policy.js' });
const policy = window.HeldGiftPolicy; // Actual shared policy used by the game.
const inventory = { apple: 2, ore: 1 }; // Owned quantities tested by both selection paths.
const itemDefs = { apple: { label: 'Apple' }, ore: { label: 'Ore' } }; // Item definitions returned on valid gifts.
const base = { heldMode: 'item', inventory, itemDefs, visibleItem: { key: 'apple' }, packClothing: [] }; // Wheel item shown in hands.
assert.equal(policy.resolve(base).key, 'apple');
for (const mode of ['none', 'tool']) assert.equal(policy.resolve({ ...base, heldMode: mode }), null);
for (const flag of ['burdenHeld', 'festivalHeld', 'instrumentHeld']) assert.equal(policy.resolve({ ...base, [flag]: true }), null);
assert.equal(policy.resolve({ ...base, manualHeldItem: { kind: 'bagItem', key: 'ore' } }), null, 'off-wheel Hold must be shown before gifting');
assert.equal(policy.resolve({ ...base, manualHeldItem: { kind: 'bagItem', key: 'ore' }, visibleItem: { key: 'ore' } }).key, 'ore');
assert.equal(policy.resolve({ ...base, manualHeldItem: { kind: 'bagItem', key: 'missing' } }), policy.STALE_HOLD);
const article = { uid: 'cloak-1', cosmeticId: 'cloak', label: 'Cloak' }; // Owned physical garment used in the visual hand test.
let finishComposite; // Deferred image completion simulates asynchronous dye/weave rendering.
let currentVisual; // Identifies the current held item when a pending image finishes.
const visual = policy.createClothingVisual(article, {
  getSprite: () => 'front.png',
  compose: () => new Promise(resolve => { finishComposite = resolve; }),
  isCurrent: candidate => candidate === currentVisual,
});
currentVisual = visual;
assert.equal(visual.key, 'pack-clothing:cloak-1');
assert.equal(visual.heldSpritePath, 'front.png');
const clothing = { ...base, manualHeldItem: { kind: 'clothing', uid: article.uid },
  clothingVisual: visual, visibleItem: visual, packClothing: [article], isClothingGiftable: () => true };
assert.equal(policy.resolve(clothing).instance.uid, 'cloak-1');
assert.equal(policy.resolve({ ...clothing, isClothingGiftable: () => false }), policy.STALE_HOLD);
assert.equal(policy.resolve({ ...clothing, packClothing: [] }), policy.STALE_HOLD);
assert.equal(policy.resolve({ ...clothing, visibleItem: { key: 'apple' } }), null);
assert.equal(policy.inspect(clothing).giftKey, 'cloak-1', 'mobile-facing diagnostic reports the exact gift');
finishComposite('woven.png');
Promise.resolve().then(() => {
  assert.equal(visual.heldSpritePath, 'woven.png');
  assert.equal(visual.heldSpriteVersion, 1);
  const oldVisual = policy.createClothingVisual(article, {
    getSprite: () => 'base.png', compose: () => Promise.resolve('late.png'),
    isCurrent: candidate => candidate === currentVisual,
  }); // Tests an old composite after a newer selection has taken control.
  return Promise.resolve().then(() => {
    assert.equal(oldVisual.heldSpritePath, 'base.png', 'stale completion cannot overwrite the current hand slot');
    assert.equal(oldVisual.heldSpriteVersion, 0);
    console.log('Held-gift policy and async garment-presentation tests passed.');
  });
}).catch(error => { console.error(error); process.exitCode = 1; });
