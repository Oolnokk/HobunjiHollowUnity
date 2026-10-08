#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const game = fs.readFileSync('docs/game.js', 'utf8');
const config = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');

assert.match(config, /"smithyButton": \{[\s\S]{0,400}"npcIds": \["kzubug", "sloomi"\][\s\S]{0,120}"areaId": "map_i_smithy"/,
  'the Smithy action is limited to Kzubug and Sloomi in the Bronzeworks');
{
  // Runtime availability checks both the active building and the faced NPC
  // identity (js/npc-shop-buttons.js, aliased into game.js).
  const vm = require('node:vm');
  const window = { SCRATCHBONES_CONFIG: { game: { mobileControls: { smithyButton: { npcIds: ['kzubug', 'sloomi'], areaId: 'map_i_smithy' } } } } };
  window.window = window;
  vm.runInNewContext(fs.readFileSync('docs/js/npc-shop-buttons.js', 'utf8'), { window });
  let area = 'map_i_smithy';
  window.NpcShopButtons.init({ getCurrentArea: () => area, getNearbyNpcWalker: () => ({ rec: { name: 'Kzubug' } }) });
  assert.equal(window.NpcShopButtons.isSmithyNpcInBronzeworks({ rec: { id: 'kzubug' } }), true, 'Kzubug in the Bronzeworks offers the Smithy');
  assert.equal(window.NpcShopButtons.isSmithyNpcInBronzeworks({ rec: { id: 'jubmir' } }), false, 'other NPCs do not');
  area = 'town';
  assert.equal(window.NpcShopButtons.isSmithyNpcInBronzeworks({ rec: { id: 'kzubug' } }), false, 'not outside the Bronzeworks');
  assert.equal(window.NpcShopButtons.smithyButton().label, 'Smithy: Kzubug');
  assert.match(game, /const \{[^}]*isSmithyNpcInBronzeworks[^}]*\} = window\.NpcShopButtons;/, 'game.js aliases the extracted shop buttons');
  assert.match(index, /js\/npc-shop-buttons\.js\?v=[A-Za-z0-9_-]+/, 'the shop-button module is loaded');
}
assert.match(game, /const btns = (?:nearbyNpcWalker\.isPorakanekiHunter \? \[\] : )?\[npcDialogueButton\(\)\];[\s\S]{0,240}if \(isSmithyNpcInBronzeworks\(nearbyNpcWalker\)\) btns\.push\(smithyButton\(\)\);/,
  'Smithy is inserted directly after Talk and therefore occupies Action 2');
assert.match(game, /if \(activeAction === smithyAction\(\)\) \{[\s\S]{0,260}openMenu\('metalCraftShop'\); return;/,
  'using the action opens the existing metal craft shop menu');
assert.match(game, /button\?\.action === npcDialogueAction\(\)[\s\S]{0,100}button\?\.action === smithyAction\(\)/,
  'the Smithy action participates in world interaction prompt rendering');
assert.match(game, /activeTool === 'ranged'[\s\S]{0,100}actionButtonForPhysicalSlot\(2\)\?\.action === 'ammo_select'/,
  'ranged ammo selection cannot intercept Smithy when Smithy occupies Action 2');
assert.match(game, /const isNavAction = act === npcDialogueAction\(\) \|\| act === smithyAction\(\)/,
  'a stale tool cooldown cannot swallow a Smithy action-arch press');
assert.match(index, /config\/scratchbones-config\.js\?v=\d+\w*/,
  'the Smithy action configuration is cache-busted');
assert.match(index, /game\.js\?v=\d+\w*/,
  'the Smithy runtime is cache-busted');

console.log('Bronzeworks Smithy action contracts: 9 checks passed');
