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
// Pixel Probe source verifies mobile-visible diagnostics for asynchronous recolor failures.
const pixelProbe = fs.readFileSync(path.join(root, 'docs/js/pixel-probe.js'), 'utf8');

assert.match(recolorSource, /CreatureGeneticsRender\?\.recolorPixels[\s\S]*?CreatureGeneticsRender\.recolorPixels/,
  'direct whole-sprite fills still delegate to the animal shade-fill recolorer');
assert.match(recolorSource, /img\.crossOrigin = 'anonymous';[\s\S]*?img\.src = spritePath/,
  'item sprites use the animal loader CORS mode before canvas pixel readback');

const recolorContext = { window: {} };
vm.runInNewContext(recolorSource, recolorContext);
const { recolorImageData } = recolorContext.window.SpriteRecolor;
const keyedPixels = new Uint8ClampedArray([
  0x9E, 0xD7, 0x75, 137, // Authored bright placeholder green.
  0x69, 0x8F, 0x4E, 91,  // Authored dark shaded placeholder green.
  0x44, 0x4B, 0x6F, 203, // Blue-gray bottle detail that must remain unchanged.
]);
recolorImageData(keyedPixels, 0xF0D15A, 'keyed');
assert.deepEqual(Array.from(keyedPixels), [
  215, 187, 81, 137,
  143, 125, 54, 91,
  0x44, 0x4B, 0x6F, 203,
], 'keyed bottles recolor bright and dark green hues while preserving each pixel value and alpha');
assert.equal(Math.max(...keyedPixels.slice(0, 3)), 0xD7,
  'the bright recolored fill retains its source HSV value');
assert.equal(Math.max(...keyedPixels.slice(4, 7)), 0x8F,
  'the dark recolored fill retains its source HSV value');

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
  /function refreshItemScroll[\s\S]*?applyItemSpriteIcon\(itemIcon, ITEM_DEFS\[curr\.key\], curr\.key\)[\s\S]*?applyItemSpriteIcon\(iBtnEl, ITEM_DEFS\[curr\.key\], curr\.key\)/,
  'the current-item HUD and item button upgrade alcohol emoji to the bottle sprite');
assert.match(game,
  /style\.backgroundImage = `url\("\$\{spritePath\}"\)`;[\s\S]*?if \(!window\.SpriteRecolor\)/,
  'authored item icons show their source PNG even if procedural recoloring is unavailable');
const iconRenderer = game.slice(game.indexOf('function applyItemSpriteIcon'), game.indexOf('// ── Inventory panel state'));
const newRequestReset = iconRenderer.indexOf("clearItemSpriteIcon(el);\n        el.dataset.itemSpriteRequest");
assert(iconRenderer.indexOf("el.dataset.itemSpriteState === 'pending'") < newRequestReset,
  'identical pending item-icon recolors survive the per-frame HUD refresh');
assert(iconRenderer.indexOf("el.dataset.itemSpriteState === 'ready'") < newRequestReset,
  'finished item-icon recolors are not reset to their green source PNG each frame');
assert.match(iconRenderer, /getRecoloredCanvas\(spritePath, targetColor, spriteMode\)[\s\S]*?itemSpriteState = 'ready'/,
  'item icons record when the recolored canvas has replaced the source sprite');
assert.match(iconRenderer, /itemSpriteState = 'fallback'[\s\S]*?itemSpriteError = String/,
  'failed mobile icon recolors retain their exact Pixel Probe diagnostic');
assert.match(pixelProbe, /Item sprite recolor error:/,
  'Pixel Probe prints the captured item-sprite failure on mobile');
assert.match(game,
  /kh-item-icon[\s\S]*?applyItemSpriteIcon\(keyHudEl\.querySelector\('\.kh-item-icon'\), ITEM_DEFS\[item\.key\], item\.key\)/,
  'the desktop keyboard HUD upgrades alcohol emoji to the bottle sprite');
assert.match(game,
  /slots\.push\(\{ type:'item',[^\n]*key:stacks\[[^\n]*[\s\S]*?applyItemSpriteIcon\(iconEl, ITEM_DEFS\[s\.key\], s\.key\)/,
  'the item-selection arc upgrades alcohol emoji to the bottle sprite');
assert.match(game,
  /const fallbackTexture = spritePath[\s\S]*?_toolTexLoader\.load\(spritePath/,
  'held authored items start with their PNG rather than an emoji while recoloring');

for (const term of ['beer', 'ale', 'mead', 'cider']) {
  assert(game.includes(`'${term}'`), `${term} is recognized by the visual alcohol classifier`);
  assert(combatCore.includes(`"${term}"`), `${term} is recognized by the drinking alcohol classifier`);
}

console.log('Alcohol bottle color and held-pose checks passed.');
