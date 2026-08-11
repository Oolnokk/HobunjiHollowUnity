#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
// Game source is inspected below to guard the integrated renderer and recipe seams.
const game = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8');
// Combat source is inspected below to keep drinking and visual alcohol classification aligned.
const combatCore = fs.readFileSync(path.join(root, 'docs/js/combat/combat-core.js'), 'utf8');

assert.match(game,
  /function normalizeAlcoholItemDef[\s\S]*?def\.spriteIcon = 'bottle_wine\.png';[\s\S]*?def\.spriteColor = mixedIngredientColor/,
  'all alcohol definitions normalize to an ingredient-colored wine bottle');

for (const ingredient of ['berryKey', 'inputKey']) {
  assert.match(game, new RegExp(`ingredientKeys: \\[${ingredient}\\]`),
    `alcohol recipes retain their ${ingredient} source for color mixing`);
}

assert.match(game,
  /function usesThrustHeldPose[\s\S]*?startsWith\('potion_'\)[\s\S]*?isAlcoholItemDef\(def\)/,
  'potions and alcohol share the thrust-held-pose classifier');
assert.match(game,
  /heldItemHolder\.position\.set\(playerToolBaseX, playerToolBaseY, 0\)[\s\S]*?degToRad\(10\.31\)[\s\S]*?_heldItemPlane\.rotation\.x = -Math\.PI \/ 2/,
  'thrust-held consumables use the weapon hand anchor, idle pitch, and flat sprite orientation');
assert.match(game,
  /SpriteRecolor\.getRecoloredCanvas\(spritePath,[\s\S]*?plane\.scale\.y = canvas\.height/,
  'held authored item sprites preserve their recolor and source aspect ratio');

for (const term of ['beer', 'ale', 'mead', 'cider']) {
  assert(game.includes(`'${term}'`), `${term} is recognized by the visual alcohol classifier`);
  assert(combatCore.includes(`"${term}"`), `${term} is recognized by the drinking alcohol classifier`);
}

console.log('Alcohol bottle color and held-pose checks passed.');
