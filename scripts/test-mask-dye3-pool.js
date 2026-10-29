'use strict';
// Dye 3 of the Hachutu mask defaults to a random hue from an oil-slick (gasoline iridescence) palette, stable per wearer,
// while an explicitly applied dye still wins.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = p => fs.readFileSync(p, 'utf8');

const mask = JSON.parse(read('docs/config/cosmetics/clothes/masks/hachutu_binding_mask_ii.json'));
const blocks = [];
const walk = o => { if (o && typeof o === 'object') { if (o.pixelDye) blocks.push(o.pixelDye); Object.values(o).forEach(walk); } };
walk(mask);
assert.equal(blocks.length, 3, 'all three species variants carry the pixel dye');
const hue = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
};
for (const dye of blocks) {
  assert.equal(dye.paletteColorKey, 'C', 'still dye 3');
  assert.ok(Array.isArray(dye.defaultHexPool) && dye.defaultHexPool.length >= 6, 'a pool of oil-slick hues');
  assert.ok(dye.defaultHexPool.every(hex => /^#[0-9A-F]{6}$/i.test(hex)), 'valid colours');
  const sectors = new Set(dye.defaultHexPool.map(hex => Math.floor(hue(hex) / 45)));
  assert.ok(sectors.size >= 6, 'the pool spans the spectrum like thin-film iridescence (violet, blue, cyan, green, yellow, orange, pink), sectors: ' + sectors.size);
  assert.ok(dye.defaultHexPool.every(hex => { const h = hue(hex); return Math.max(...[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))) >= 200; }), 'bright, luminous hues');
}

const portrait = read('docs/js/portrait-utils.js');
assert.match(portrait, /bodyColors\[dyeSlot\][^\n]*\n\s*\|\| pixelDyeDefaultRgb\(layer\.pixelDye, dyeSlot\)/, 'an applied dye wins; the pool is only the fallback');
assert.match(portrait, /profile\.pixelDyeSeed \|\|=/, 'the choice is stored on the profile so every render of one character agrees');
assert.match(read('docs/js/npc-avatar-preview-utils.js'), /profile\.pixelDyeSeed = npc\.pixelDyeSeed \|\| profileSeed;/, 'NPCs/players get a stable per-character seed, records may supply their own');
assert.match(read('docs/js/combat/combat-maskbound-guardian.js'), /roster\.pixelDyeSeed = 'maskbound:'/, 'each spawned guardian rolls its own hue');

// Behaviour of the pick itself (same FNV hash as the renderer): deterministic per seed, varied across seeds.
const pick = (seed, pool) => { let h = 2166136261; for (const ch of seed + '|MASK_C') h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return pool[(h >>> 0) % pool.length]; };
const pool = blocks[0].defaultHexPool;
assert.equal(pick('a', pool), pick('a', pool), 'stable for one wearer');
assert.ok(new Set(Array.from({ length: 64 }, (_, i) => pick('seed' + i, pool))).size >= 6, 'varied across wearers');

console.log('Mask dye 3: oil-slick pool, stable per wearer, applied dye still wins');
