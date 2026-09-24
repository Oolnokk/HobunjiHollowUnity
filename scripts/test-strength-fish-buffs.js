#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const alchemy = fs.readFileSync('docs/js/alchemy-system.js', 'utf8');
const skill = fs.readFileSync('docs/js/skill-system.js', 'utf8');
const fish = fs.readFileSync('docs/js/fish-catalog.js', 'utf8');
const cooking = fs.readFileSync('docs/js/cooking-system.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
assert.match(alchemy, /potionOfStrength[\s\S]{0,240}magnitude: 0\.5/, 'Strength is half Fury base damage');
assert.match(alchemy, /STRENGTH_FOOTING_DAMAGE_RATIO = 1\.5/, 'Strength derives +75% base Footing damage');
assert.match(alchemy, /STRENGTH_WORK_SPEED_RATIO = 1\.5/, 'Strength derives +75% base work speed');
assert.match(alchemy, /getFootingDamageMultiplier = \(\) => 1 \+ statMagnitude\('footingDamage'\) \+ recipeMagnitude\('potionOfStrength'\)/, 'Strength feeds the real Footing multiplier');
assert.match(alchemy, /getWorkSpeedMultiplier/, 'Alchemy exports a dedicated Strength work-speed multiplier');
assert.match(skill, /\['foraging', 'mining', 'farming'\]\.includes\(skillKey\)[\s\S]{0,120}getWorkSpeedMultiplier/, 'Strength work speed is limited to chop, mine, and dig skills');
assert.match(game, /actionSpeedMultiplier\?\.\('farming'\)/, 'digging consumes the shared action-speed helper');
assert.match(game, /chargeAction\.tool === 'axe' \? 'foraging' : chargeAction\.tool === 'pick' \? 'mining'/, 'axe and pick holds consume the shared action-speed helper');
assert.match(game, /getOutgoingDamageMultiplier/, 'combat consumes potion outgoing damage');
assert.match(game, /getFootingDamageMultiplier/, 'combat consumes potion Footing damage');
assert.match(fish, /gurumahi_tawny: 'strength'[\s\S]{0,120}gurumahi_charcoal: 'fishing'[\s\S]{0,120}gurumahi_creamback: 'fortitude'[\s\S]{0,120}gurumahi_snowmuzzle: 'speed'/, 'Gurumahi subspecies no longer share one family-wide cooking buff');
assert.match(fish, /rockscale_goldplate: 'fortitude'[\s\S]{0,140}rockscale_giltback: 'strength'[\s\S]{0,140}rockscale_silverplate: 'fishing'[\s\S]{0,220}rockscale_slateplate: 'speed'/, 'Rockscale subspecies split fishing and the other fish-food buffs');
assert.match(fish, /sixfin_honeystripe: 'fishing'[\s\S]{0,140}sixfin_coalbar: 'speed'[\s\S]{0,140}sixfin_redlash: 'strength'[\s\S]{0,360}sixfin_violetreef: 'fortitude'/, 'Sixfin subspecies split fishing and the other fish-food buffs');
assert.match(fish, /mossfin_fernback: 'fishing'[\s\S]{0,140}mossfin_peatbelly: 'fortitude'[\s\S]{0,140}mossfin_silverfrond: 'speed'[\s\S]{0,140}mossfin_coppergill: 'strength'[\s\S]{0,140}mossfin_frostcap: 'speed'/, 'Mossfin variants are live fish with per-subspecies cooking buffs');
assert.match(fish, /\['mossfin_fernback','Mossfin Fernback','mossfin'[\s\S]{0,900}\['mossfin_frostcap','Mossfin Frostcap','mossfin'/, 'Mossfin has a five-variant authored catch catalog');
assert.match(fish, /f\.species === 'mossfin' \? 'fish_mossfin\.png'/, 'Mossfin variants render with the existing Mossfin sprite asset');
assert.match(fish, /if \(species === 'mossfin'\) return \{ x: s \* 0\.92, y: s \* 1\.08 \}/, 'Mossfin has its own minigame silhouette correction');
assert.doesNotMatch(fish, /function guruProfile\(/, 'shared hue recoloring is no longer named as Gurumahi-only now that Mossfin uses it');
for (const [fishKey, effect] of [['gurumahi_charcoal', 'fishing'], ['rockscale_goldplate', 'fortitude'], ['rockscale_giltback', 'strength'], ['rockscale_slateplate', 'speed']]) {
  assert.match(fish, new RegExp(`${fishKey}: '${effect}'`), `${effect} remains obtainable from an any-season fish (${fishKey})`);
}
assert.match(fish, /cookingPrimaryEffect:COOKING_EFFECT_BY_FISH\[f\.key\]/, 'live fish expose per-subspecies cooking buffs');
assert.match(fish, /cookingCategories:\['fish'\][\s\S]{0,180}cookingPrimaryEffect:COOKING_EFFECT_BY_FISH\[f\.key\][\s\S]{0,180}cookingProcessingTier:'raw'[\s\S]{0,120}cookingDefaultStars:3/, 'late-registered fish carry the complete cooking ingredient contract themselves');
assert.match(fish, /function hookShippingItemBridge\(\)[\s\S]{0,900}api\.init = function fishCatalogShippingInit/, 'fish item registration follows ShippingPanel initialization instead of timing out');
assert.doesNotMatch(fish, /n\+\+<40|item bridge unavailable/, 'fish item bridge no longer uses a fixed startup polling deadline');
assert.match(cooking, /definition\.cookingPrimaryEffect \|\|= 'fishing'/, 'cooking preserves fish-specific effects and only falls back to fishing when missing');
assert.match(cooking, /totals\[definition\.cookingPrimaryEffect\]/, 'cooked-food effect totals consume each ingredient cookingPrimaryEffect');
console.log('Strength and fish buff tests passed');
