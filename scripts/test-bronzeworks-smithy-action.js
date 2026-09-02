#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const game = fs.readFileSync('docs/game.js', 'utf8');
const config = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');

assert.match(config, /"smithyButton": \{[\s\S]{0,400}"npcIds": \["kzubug", "sloomi"\][\s\S]{0,120}"areaId": "map_i_smithy"/,
  'the Smithy action is limited to Kzubug and Sloomi in the Bronzeworks');
assert.match(game, /function isSmithyNpcInBronzeworks\(walker\) \{[\s\S]{0,320}currentArea === \(cfg\.areaId \|\| 'map_i_smithy'\)[\s\S]{0,100}ids\.includes\(walker\?\.rec\?\.id \|\| ''\)/,
  'runtime availability checks both the active building and the faced NPC identity');
assert.match(game, /const btns = \[npcDialogueButton\(\)\];[\s\S]{0,240}if \(isSmithyNpcInBronzeworks\(nearbyNpcWalker\)\) btns\.push\(smithyButton\(\)\);/,
  'Smithy is inserted directly after Talk and therefore occupies Action 2');
assert.match(game, /if \(activeAction === smithyAction\(\)\) \{[\s\S]{0,260}openMenu\('metalCraftShop'\); return;/,
  'using the action opens the existing metal craft shop menu');
assert.match(game, /button\?\.action === npcDialogueAction\(\)[\s\S]{0,100}button\?\.action === smithyAction\(\)/,
  'the Smithy action participates in world interaction prompt rendering');
assert.match(game, /activeTool === 'ranged'[\s\S]{0,100}actionButtonForPhysicalSlot\(2\)\?\.action === 'ammo_select'/,
  'ranged ammo selection cannot intercept Smithy when Smithy occupies Action 2');
assert.match(game, /const isNavAction = act === npcDialogueAction\(\) \|\| act === smithyAction\(\)/,
  'a stale tool cooldown cannot swallow a Smithy action-arch press');
assert.match(index, /config\/scratchbones-config\.js\?v=20260831smithy1/,
  'the Smithy action configuration is cache-busted');
assert.match(index, /game\.js\?v=20260902ore1/,
  'the Smithy runtime is cache-busted');

console.log('Bronzeworks Smithy action contracts: 9 checks passed');
