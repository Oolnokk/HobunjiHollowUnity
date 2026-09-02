#!/usr/bin/env python3
from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if text.count(old) != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {text.count(old)} for {old[:80]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


alchemy = 'docs/js/alchemy-system.js'
replace_once(
    alchemy,
    "  const FAMILY_ORDER = Object.freeze(['damage', 'control', 'offensiveDebuff', 'defensiveDebuff']); // Four Cures-button families.\n",
    "  const FAMILY_ORDER = Object.freeze(['damage', 'control', 'offensiveDebuff', 'defensiveDebuff']); // Four Cures-button families.\n"
    "  const STRENGTH_FOOTING_DAMAGE_RATIO = 1.5; // Used to make Strength's damage magnitude grant 1.5x as much Footing damage (+75% at base potency).\n"
    "  const STRENGTH_WORK_SPEED_RATIO = 1.5; // Used to make Strength's damage magnitude grant 1.5x as much chop/dig/mine speed (+75% at base potency).\n"
)
replace_once(
    alchemy,
    "    potionOfStrength: recipe('potionOfStrength', 'flesh', 'greaten', 'earth', { label: 'Potion of Strength', icon: '💪', useMode: 'drink', application: 'buff', stat: 'outgoingDamage', magnitude: 0.35, durationS: 90, desc: 'Increases outgoing damage.' }),",
    "    potionOfStrength: recipe('potionOfStrength', 'flesh', 'greaten', 'earth', { label: 'Potion of Strength', icon: '💪', useMode: 'drink', application: 'buff', stat: 'outgoingDamage', magnitude: 0.5, durationS: 90, desc: 'Increases outgoing damage, Footing damage, and chopping, digging, and mining speed.' }),"
)
replace_once(
    alchemy,
    "  function statMagnitude(stat) { const now = performance.now() / 1000; return activeEffects.filter(effect => effect.expiresAt > now && (effect.stat === stat || effect.secondaryStat === stat)).reduce((sum, effect) => sum + effect.magnitude, 0); } // Central buff query.\n",
    "  function statMagnitude(stat) { const now = performance.now() / 1000; return activeEffects.filter(effect => effect.expiresAt > now && (effect.stat === stat || effect.secondaryStat === stat)).reduce((sum, effect) => sum + effect.magnitude, 0); } // Central buff query.\n"
    "  function recipeMagnitude(recipeId) { const now = performance.now() / 1000; return activeEffects.filter(effect => effect.expiresAt > now && effect.recipeId === recipeId).reduce((sum, effect) => sum + effect.magnitude, 0); } // Used by Strength's recipe-specific secondary effects while preserving stored potency.\n"
)
replace_once(
    alchemy,
    "  const getFootingDamageMultiplier = () => 1 + statMagnitude('footingDamage');\n",
    "  const getFootingDamageMultiplier = () => 1 + statMagnitude('footingDamage') + recipeMagnitude('potionOfStrength') * STRENGTH_FOOTING_DAMAGE_RATIO;\n"
    "  const getWorkSpeedMultiplier = () => 1 + recipeMagnitude('potionOfStrength') * STRENGTH_WORK_SPEED_RATIO;\n"
)
replace_once(
    alchemy,
    "getPositiveFavorMultiplier,getPerceptionMultiplier,getFootingDamageMultiplier,\n",
    "getPositiveFavorMultiplier,getPerceptionMultiplier,getFootingDamageMultiplier,getWorkSpeedMultiplier,\n"
)

skill = 'docs/js/skill-system.js'
replace_once(
    skill,
    "  function actionSpeedMultiplier(skillKey) {\n"
    "    if (skillKey === 'foraging') return 1 + (window.PerkSystem?.rank('foraging', 'increaseForagingSpeed') || 0) * 0.1; // Increase Foraging Speed perk.\n"
    "    if (skillKey === 'mining') return 1 + (window.PerkSystem?.rank('mining', 'increaseMiningSpeed') || 0) * 0.1; // Increase Mining Speed perk; five ranks preserve the former +50% cap.\n"
    "    return 1 + normalizedPower(skillKey) * 0.5; // Used to shorten pick and digging action stages.\n"
    "  }\n",
    "  function actionSpeedMultiplier(skillKey) {\n"
    "    let skillSpeed = 1 + normalizedPower(skillKey) * 0.5; // Used as the skill-owned action baseline before temporary alchemy modifiers.\n"
    "    if (skillKey === 'foraging') skillSpeed = 1 + (window.PerkSystem?.rank('foraging', 'increaseForagingSpeed') || 0) * 0.1; // Increase Foraging Speed perk.\n"
    "    else if (skillKey === 'mining') skillSpeed = 1 + (window.PerkSystem?.rank('mining', 'increaseMiningSpeed') || 0) * 0.1; // Increase Mining Speed perk; five ranks preserve the former +50% cap.\n"
    "    const strengthWorkSpeed = ['foraging', 'mining', 'farming'].includes(skillKey) ? (window.AlchemySystem?.getWorkSpeedMultiplier?.() || 1) : 1; // Used to apply Strength only to chop, mine, and dig actions.\n"
    "    return skillSpeed * strengthWorkSpeed;\n"
    "  }\n"
)

fish = 'docs/js/fish-catalog.js'
replace_once(
    fish,
    "  const AMPHIBIOUS_SELL_MULTIPLIER = 3; // Used to compensate amphibious catches for their post-reel combat/retrieval step.\n",
    "  const AMPHIBIOUS_SELL_MULTIPLIER = 3; // Used to compensate amphibious catches for their post-reel combat/retrieval step.\n"
    "  const COOKING_EFFECT_BY_SPECIES = Object.freeze({ gurumahi: 'strength', rockscale: 'fortitude', sixfin: 'speed' }); // Used to give each live fish species a distinct buff when cooked into food.\n"
)
replace_once(
    fish,
    "        tags, amphibious:f.amphibious,\n",
    "        tags, amphibious:f.amphibious,\n"
    "        cookingPrimaryEffect:COOKING_EFFECT_BY_SPECIES[f.species] || 'fishing',\n"
)

Path('scripts/test-strength-fish-buffs.js').write_text(r'''#!/usr/bin/env node
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
assert.match(fish, /gurumahi: 'strength'[\s\S]{0,80}rockscale: 'fortitude'[\s\S]{0,80}sixfin: 'speed'/, 'fish species have distinct cooking buffs');
assert.match(fish, /cookingPrimaryEffect:COOKING_EFFECT_BY_SPECIES\[f\.species\]/, 'live fish expose species cooking buffs');
assert.match(cooking, /def\.cookingPrimaryEffect \|\| defaultPrimaryEffectForCategories/, 'cooking consumes live item cookingPrimaryEffect metadata');
console.log('Strength and fish buff tests passed');
''', encoding='utf-8')

print('Applied Strength and fish cooking buff changes.')