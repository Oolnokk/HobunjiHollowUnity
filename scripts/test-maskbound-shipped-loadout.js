'use strict';
// The shipped Maskbound spawn rules: always a bandolier and a hood slot, facewrap slightly likelier than the ragged hood (fine hood
// included), poncho/bodywrap rare, every clothing dye drawn from the full dusty array plus gray/charcoal/cream; body and mask
// colour 1 are smoky yellow-orange.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = p => fs.readFileSync(p, 'utf8');

const data = JSON.parse(read('docs/config/combat/enemy-loadouts.json'));
const dusty = ['red', 'red_orange', 'orange', 'yellow_orange', 'yellow', 'yellow_green', 'green', 'green_blue', 'blue', 'blue_indigo', 'indigo', 'indigo_violet', 'violet'].map(h => `dye:CLOTH:dusty_${h}`);
const expectedDyes = [...dusty, 'dye:CLOTH:gray', 'dye:CLOTH:charcoal', 'dye:CLOTH:cream'];
const catalog = read('docs/config/colors/config.js');
for (const id of expectedDyes) assert.ok(catalog.includes(`"id": "${id}"`), `${id} exists in the dye catalog`);

for (const troop of ['sentinel', 'bulwark', 'reacher']) {
  const rule = data.rules['maskbound:' + troop];
  assert.ok(rule, troop + ' has shipped rules');
  const { hood, overwear, torso } = rule.clothing;
  assert.equal(torso.chance, 1, 'always a bandolier');
  assert.deepEqual(Object.keys(torso.items), ['bandolier1']);
  assert.equal(hood.chance, 1, 'the hood slot is always filled');
  assert.deepEqual(Object.keys(hood.items).sort(), ['facewrap', 'fine_hood', 'ragged_hood'], 'facewrap, ragged and fine hoods');
  assert.ok(hood.items.facewrap > hood.items.ragged_hood, 'the facewrap is likelier than the ragged hood');
  assert.ok(hood.items.facewrap - hood.items.ragged_hood <= hood.items.ragged_hood * 0.25, '...but only slightly');
  assert.ok(overwear.chance > 0 && overwear.chance <= 0.15, 'overwear is rare');
  assert.deepEqual(Object.keys(overwear.items).sort(), ['rugged_poncho', 'tankan_bodywrap']);
  for (const slot of ['HOOD', 'HOOD_B', 'CLOTH', 'CLOTH_B', 'TORSO', 'TORSO_B', 'PANTS', 'PANTS_B']) {
    assert.deepEqual(Object.keys(rule.dyes[slot]).sort(), [...expectedDyes].sort(), `${slot} uses every dusty dye plus gray, charcoal and cream`);
    assert.ok(Object.values(rule.dyes[slot]).every(w => w === 1), 'equal weights');
  }
  assert.equal(rule.clothing.mask, undefined, 'the mask slot keeps the Hachutu mask');
}

// The rules validate and the species may wear every item the rules pick.
const win = {};
vm.runInNewContext(read('docs/js/combat/enemy-loadout-rules.js'), {
  window: win, console, URL, document: { currentScript: { src: 'https://game.test/docs/js/combat/enemy-loadout-rules.js' }, baseURI: 'https://game.test/docs/' },
  fetch: async () => ({ ok: true, json: async () => data }),
});
win.EnemyLoadoutRules.set(data);
const allowed = JSON.parse(read('docs/config/species/maskbound-guardian.json')).male.allowedCosmetics;
for (const id of ['facewrap', 'ragged_hood', 'fine_hood', 'rugged_poncho', 'tankan_bodywrap', 'bandolier1']) assert.ok(allowed.includes(id), `${id} is allowed for the species`);
assert.match(read('docs/js/maskbound-guardian-species-runtime.js'), /allowedClothingIds: \[MASK_ID, 'ragged_hood', 'fine_hood', 'facewrap', 'rugged_poncho', 'tankan_bodywrap', 'bandolier1'\]/);

// Smoky yellow-orange (dye:CLOTH:smoky_yellow_orange) body + mask colour 1.
const guardian = {}; guardian.window = guardian;
vm.runInNewContext(read('docs/js/combat/combat-maskbound-guardian.js'), guardian);
const api = guardian.MaskboundGuardianCombat;
const hsl = ['46.67', '17.88', '29.61'].map(Number);
const toHex = (h, s, l) => { s /= 100; l /= 100; const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2; const [r, g, b] = h < 60 ? [c, x, 0] : [0, 0, 0]; return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join(''); };
const smoky = toHex(...hsl);
for (const troop of Object.values(api.troopTypes)) {
  const colors = api.woodColors(troop.wood);
  assert.equal(colors.A.hex.toLowerCase(), smoky.toLowerCase(), 'body colour 1');
  assert.equal(colors.MASK.hex.toLowerCase(), smoky.toLowerCase(), 'mask colour 1');
}

console.log('Maskbound shipped loadout: bandolier, hood odds, rare overwear, dusty+neutral dyes, smoky yellow-orange wood and mask');
