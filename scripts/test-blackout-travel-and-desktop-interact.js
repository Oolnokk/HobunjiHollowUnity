#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Verifies desktop E and town-scene dependency wiring below.
const alcoholSource = fs.readFileSync('docs/js/alcohol-gameplay-bridge.js', 'utf8'); // Verifies which keys may consume held items.
const combatSource = fs.readFileSync('docs/js/combat/combat-core.js', 'utf8'); // Verifies blackout destination setup order.

assert.match(alcoholSource,
  /!\['Space', 'Enter'\]\.includes\(event\.code\) \|\| !consumeHeldItem\(\)/,
  'held consumables use primary-action keys');
assert.doesNotMatch(alcoholSource,
  /\['Space', 'Enter', 'KeyE'\]/,
  'desktop Interact cannot consume a held item');

assert.match(gameSource,
  /function runInteractAction\(\) \{[\s\S]{0,700}action === 'harvest'[\s\S]{0,200}action\.startsWith\('plant_'\)[\s\S]{0,300}!isItemAction\(b\.action\)/,
  'Interact filters held-item actions out of the context buttons');
assert.match(gameSource,
  /if \(key === 'e' && isDesktop\) \{[\s\S]{0,220}if \(!wasHeld\) runInteractAction\(\);/,
  'a desktop E tap runs world interaction rather than the active item action');

assert.match(gameSource,
  /EXTERIOR_ZONES,\s+buildTownScene,\s+buildZoneScene,/,
  'blackout travel receives both lazy exterior scene builders');
assert.match(combatSource,
  /setCurrentArea\(targetArea\);[\s\S]{0,400}targetArea === "town"\) devDeps\.buildTownScene\?\.\(\);[\s\S]{0,300}getActiveGrid/,
  'farm-to-town blackout builds the town scene before reading its grid or scene');

console.log('blackout travel and desktop Interact checks passed');
