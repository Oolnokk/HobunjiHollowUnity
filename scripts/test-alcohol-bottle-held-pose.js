#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
// Game source is inspected below to guard the integrated renderer and recipe seams.
const game = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8');
// Combat source is inspected below to keep drinking and visual alcohol classification aligned.
const combatCore = fs.readFileSync(path.join(root, 'docs/js/combat/combat-core.js'), 'utf8');
const recolorSource = fs.readFileSync(path.join(root, 'docs/js/sprite-recolor.js'), 'utf8');

assert.match(recolorSource, /CreatureGeneticsRender\?\.recolorPixels[\s\S]*?CreatureGeneticsRender\.recolorPixels/,
  'bottle fills delegate to the exact animal-color recolorer in the main game');

const recolorContext = { window: {} };
vm.runInNewContext(recolorSource, recolorContext);
const { recolorImageData, relativeLuminance } = recolorContext.window.SpriteRecolor;
const sourcePixel = new Uint8ClampedArray([0x9E, 0xD7, 0x75, 137]);
const sourceLuminance = relativeLuminance(sourcePixel[0], sourcePixel[1], sourcePixel[2]);
recolorImageData(sourcePixel, 0xF0D15A, 'keyed');
const sourceShade = Math.max(0.18, Math.min(1.18, sourceLuminance / 0.55));
assert.deepEqual(Array.from(sourcePixel.slice(0, 3)), [
  Math.max(0, Math.min(255, Math.round(0xF0 * sourceShade))),
  Math.max(0, Math.min(255, Math.round(0xD1 * sourceShade))),
  Math.max(0, Math.min(255, Math.round(0x5A * sourceShade))),
], 'bottle fill uses the same luminance-scaled target RGB as animal colors');
assert.equal(sourcePixel[3], 137, 'bottle fill retains the source pixel transparency');

assert.match(game,
  /function normalizeAlcoholItemDef[\s\S]*?def\.spriteIcon = 'bottle_wine\.png';[\s\S]*?def\.spriteColor = mixedIngredientColor/,
  'all alcohol definitions normalize to an ingredient-colored wine bottle');
assert.match(game, /heftroot: 0xF0D15A/,
  'heftroot vodka uses the ripe heftroot gold as its ingredient color');
assert.match(combatCore, /heftrootVodka[\s\S]*?spriteColor: 0xF0D15A/,
  'the canonical combat vodka fallback uses the same ripe heftroot gold');

for (const ingredient of ['berryKey', 'inputKey']) {
  assert.match(game, new RegExp(`ingredientKeys: \\[${ingredient}\\]`),
    `alcohol recipes retain their ${ingredient} source for color mixing`);
}

assert.match(game,
  /function usesThrustHeldPose[\s\S]*?startsWith\('potion_'\)[\s\S]*?isAlcoholItemDef\(def\)/,
  'potions and alcohol share the thrust-held-pose classifier');
assert.match(game,
  /heldItemHolder\.position\.set\(playerToolBaseX, playerToolBaseY, 0\)[\s\S]*?degToRad\(10\.31\)[\s\S]*?scale\.setScalar\(0\.5\)[\s\S]*?_heldItemPlane\.rotation\.x = Math\.PI \/ 2/,
  'thrust-held consumables keep the weapon hand pivot while rendering half-size and flipped end-for-end');
assert.match(game,
  /else \{[\s\S]*?heldItemHolder\.scale\.setScalar\(1\)[\s\S]*?_heldItemPlane\.rotation\.x = 0/,
  'ordinary held items restore their full-size chest pose');
assert.match(game,
  /SpriteRecolor\.getRecoloredCanvas\(spritePath,[\s\S]*?plane\.scale\.y = canvas\.height/,
  'held authored item sprites preserve their recolor and source aspect ratio');
assert.match(game,
  /function refreshItemScroll[\s\S]*?applyItemSpriteIcon\(itemIcon, ITEM_DEFS\[curr\.key\]\)[\s\S]*?applyItemSpriteIcon\(iBtnEl, ITEM_DEFS\[curr\.key\]\)/,
  'the current-item HUD and item button upgrade alcohol emoji to the bottle sprite');
assert.match(game,
  /style\.backgroundImage = `url\("\$\{spritePath\}"\)`;[\s\S]*?if \(!window\.SpriteRecolor\) return;/,
  'authored item icons show their source PNG even if procedural recoloring is unavailable');
assert.match(game,
  /kh-item-icon[\s\S]*?applyItemSpriteIcon\(keyHudEl\.querySelector\('\.kh-item-icon'\), ITEM_DEFS\[item\.key\]\)/,
  'the desktop keyboard HUD upgrades alcohol emoji to the bottle sprite');
assert.match(game,
  /slots\.push\(\{ type:'item',[^\n]*key:stacks\[[^\n]*[\s\S]*?applyItemSpriteIcon\(iconEl, ITEM_DEFS\[s\.key\]\)/,
  'the item-selection arc upgrades alcohol emoji to the bottle sprite');
assert.match(game,
  /const fallbackTexture = spritePath[\s\S]*?_toolTexLoader\.load\(spritePath/,
  'held authored items start with their PNG rather than an emoji while recoloring');

for (const term of ['beer', 'ale', 'mead', 'cider']) {
  assert(game.includes(`'${term}'`), `${term} is recognized by the visual alcohol classifier`);
  assert(combatCore.includes(`"${term}"`), `${term} is recognized by the drinking alcohol classifier`);
}

console.log('Alcohol bottle color and held-pose checks passed.');
