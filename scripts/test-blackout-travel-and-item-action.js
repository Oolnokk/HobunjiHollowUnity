#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const game = source('docs/game.js');
const alcohol = source('docs/js/alcohol-gameplay-bridge.js');
const combat = source('docs/js/combat/combat-core.js');
const loader = source('docs/js/combat/combat-config-loader.js');

assert.doesNotMatch(alcohol, /\['Space', 'Enter', 'KeyE'\]/,
  'consumption must not intercept literal desktop keys');
assert.doesNotMatch(alcohol, /btn\(\?:Item\)\?Action\[1-5\][\s\S]{0,200}consumeHeldItem/,
  'consumption must not intercept action-button pointer events outside normal dispatch');
assert.match(alcohol, /getHeldItemAction[\s\S]*?action: 'consume_held_item'/,
  'the alcohol bridge exposes a semantic consumable action');

assert.match(game, /getHeldItemAction\?\.\(\);\s*if \(consumeAction\) btns\.unshift\(consumeAction\);/,
  'a held consumable occupies item action slot 1');
assert.match(game, /activeAction === 'consume_held_item'[\s\S]*?consumeHeldItem\?\.\(\)/,
  'normal action dispatch consumes the selected item');
assert.match(game, /\^action\(\\d\+\)\$[\s\S]*?runActionButtonAtSlot/,
  'configurable action bindings continue to route by semantic slot');
assert.match(game, /function runInteractAction\(\)[\s\S]*?action === 'consume_held_item'[\s\S]*?!isItemAction\(b\.action\)/,
  'Interact excludes consume, plant, place, and harvest item actions');
assert.match(game, /if \(key === 'e' && isDesktop\)[\s\S]*?if \(!wasHeld\) runInteractAction\(\);/,
  'a desktop E tap uses world Interact after the tool-wheel hold check');

const areaSet = combat.indexOf('devDeps.setCurrentArea(targetArea);');
const townBuild = combat.indexOf('devDeps.buildTownScene?.();', areaSet);
const gridRead = combat.indexOf('devDeps.getActiveGrid?.();', townBuild);
assert.ok(areaSet >= 0 && townBuild > areaSet && gridRead > townBuild,
  'blackout travel builds town before reading its grid and attaching scene objects');
assert.match(game, /window\.DevSpawner\?\.init\(\{[\s\S]*?buildTownScene,[\s\S]*?buildZoneScene,/,
  'blackout travel receives the town-scene builder');

const elevationBridge = loader.indexOf('town-player-body-elevation-bridge.js');
const alcoholBridge = loader.indexOf('alcohol-gameplay-bridge.js?v=20260811b');
assert.ok(elevationBridge >= 0 && alcoholBridge > elevationBridge,
  'the latest town body-elevation bridge remains loaded before alcohol gameplay');

console.log('blackout travel and item action tests passed');
