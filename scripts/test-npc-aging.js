'use strict';

// NPC aging: authored appearance.aging drives body-color aging (profile build)
// and the neck-bone age hunch (HobunjiCharacterRigScale.ageFor).

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const windowObject = { location: { pathname: '/game/' }, setInterval() { return 1; }, clearInterval() {}, console };
windowObject.window = windowObject;
const context = vm.createContext(windowObject);
vm.runInContext(fs.readFileSync('docs/js/npc-avatar-preview-utils.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/config/character-rig-scale-defaults.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/character-rig-scale.js', 'utf8'), context);
const preview = windowObject.NpcAvatarPreview;
const rig = windowObject.HobunjiCharacterRigScale;

// Body color: reference tool's linear-light desaturate-then-brighten.
const plain = arr => Array.from(arr);
assert.deepStrictEqual(plain(preview.ageBodyColorRgb([96, 209, 94], { amount: 0, desaturation: 65, brightening: 30 })), [96, 209, 94], 'amount 0 is a no-op');
assert.deepStrictEqual(plain(preview.ageBodyColorRgb([96, 209, 94], 'old')), [176, 212, 176], 'Old preset matches the reference result for Pahu slot B');
const gray = plain(preview.ageBodyColorRgb([200, 40, 40], { amount: 100, desaturation: 100, brightening: 0 }));
assert.ok(gray[0] === gray[1] && gray[1] === gray[2], 'full desaturation lands on a neutral gray');
assert.deepStrictEqual(plain(preview.ageBodyColorRgb([10, 20, 30], { amount: 100, desaturation: 0, brightening: 100 })), [255, 255, 255], 'full brightening reaches white');

// Profile application only touches body slots A/B/C and uses the renderer's resolved RGB.
windowObject._dyeReferenceHexForSlot = () => '#7dc89a';
windowObject._resolveTargetRgbColor = color => (color.hex ? [0x60, 0xd1, 0x5e] : [0x60, 0xd1, 0x5e]);
const profile = { fighter: { speciesId: 'kenkari' }, bodyColors: { A: { h: 10 }, B: { h: 20 }, TORSO: { h: 30 } } };
preview.applyBodyColorAging(profile, { preset: 'old', amount: 70, desaturation: 65, brightening: 30 });
assert.strictEqual(profile.bodyColors.A.hex, '#b0d4b0');
assert.strictEqual(profile.bodyColors.B.hex, '#b0d4b0');
assert.strictEqual(profile.bodyColors.TORSO.h, 30, 'clothing dye slots are untouched');

// ageFor: explicit age wins, then the authored aging block wherever it travels.
assert.strictEqual(rig.ageFor({}), 0);
assert.strictEqual(rig.ageFor({ age: 0.4, profile: { aging: { hunch: 0.1 } } }), 0.4);
assert.strictEqual(rig.ageFor({ profile: { aging: { hunch: 0.3 } } }), 0.3);
assert.strictEqual(rig.ageFor({ npcRecord: { appearance: { aging: { hunch: 0.13 } } } }), 0.13);
assert.strictEqual(rig.ageFor({ avatarRoot: { userData: { hobunjiCharacterRigHeadRuntime: { age: 0.07 } } } }), 0.07, 'hand reattachment keeps the build-time age');
assert.strictEqual(rig.ageFor({ age: 5 }), 1, 'clamped to 0..1');

// The four authored elders carry aging data.
const db = JSON.parse(fs.readFileSync('docs/config/npcs/hobunji-starter-npc-database.json', 'utf8'));
for (const id of ['teacup_unumanuk', 'father_hunundi_hodu', 'pahu', 'leaf']) {
  const aging = db.npcs.find(n => n.id === id)?.appearance?.aging;
  assert.ok(aging && aging.hunch > 0 && aging.bodyColor?.amount > 0, `${id} has authored aging`);
}

console.log('npc-aging: ok');
