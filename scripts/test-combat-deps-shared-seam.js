#!/usr/bin/env node
'use strict';

// window.Combat.deps doubles as the shared world-state seam for modules that
// load after game.js. Their own unit tests mock that bag, so a field game.js
// never passes looks fine in CI but silently disables the feature in the real
// game (Banubu's exterior snore, river ambience and rain suppression were all
// dead this way). Guard the real Combat.init wiring for every such reader.

const assert = require('node:assert/strict');
const fs = require('node:fs');

const game = fs.readFileSync('docs/game.js', 'utf8');
const start = game.indexOf('window.Combat?.init({');
assert.ok(start >= 0, 'game.js must call window.Combat.init');
let depth = 0;
let end = start;
for (let i = game.indexOf('{', start); i < game.length; i++) {
  if (game[i] === '{') depth++;
  else if (game[i] === '}' && --depth === 0) { end = i; break; }
}
const combatInit = game.slice(start, end + 1); // The exact deps object Combat.init receives.

const REQUIRED = {
  'docs/js/banubu-snore.js': ['isDialogueOpen', 'zoneLayouts', 'zoneScenes', 'getActiveGrid', 'tileSurfaceYInArea', 'activeSurfaceYAtWorld'],
  'docs/js/combat/melee-hud-reticle.js': ['isDialogueOpen'],
  'docs/js/combat/ranged-hud-reticle.js': ['isDialogueOpen'],
  'docs/js/ambient-biome-audio.js': ['calendar', 'getHour', 'TileType', 'WATERWAY_TYPES', 'npcGridForArea', '_isZoneArea'],
  'docs/js/inventory-ui.js': ['METAL_DEFS', 'MASTERY_XP_THRESHOLDS', 'toolEffectiveMetalKey', 'toolMetalMultiplier', 'toolVerdigrisFraction'],
  'docs/js/combat/ranged-weapon-archetypes.js': ['getGearInventory', 'saveGearInventory', 'refreshActionBar'],
};

for (const [file, fields] of Object.entries(REQUIRED)) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /Combat\??\.deps/, `${file} still reads window.Combat.deps (update this guard if it moved to its own init)`);
  for (const field of fields) {
    assert.ok(source.includes(field), `${file} still reads ${field}`);
    assert.match(combatInit, new RegExp(`(^|[\\s{,])${field.replace('$', '\\$')}\\b`, 'm'),
      `game.js Combat.init must pass ${field} (read by ${file} through window.Combat.deps)`);
  }
}

console.log('Combat.deps shared-seam wiring checks passed.');
