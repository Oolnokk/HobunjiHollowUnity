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

# Persistent regression coverage in the existing skill/cooking integration test.
test = 'scripts/test-skill-and-hearth-cooking.js'
replace_once(
    test,
    "assert(context.window.SkillSystem.actionSpeedMultiplier('mining') >= 1, 'Mining exposes a hold-speed multiplier');\n",
    "assert(context.window.SkillSystem.actionSpeedMultiplier('mining') >= 1, 'Mining exposes a hold-speed multiplier');\n"
    "context.window.AlchemySystem = { getWorkSpeedMultiplier: () => 1.75 };\n"
    "assert.equal(context.window.SkillSystem.actionSpeedMultiplier('foraging'), 1.75, 'Strength work speed multiplies axe holds');\n"
    "assert.equal(context.window.SkillSystem.actionSpeedMultiplier('mining'), 1.75, 'Strength work speed multiplies pick holds');\n"
    "assert.equal(context.window.SkillSystem.actionSpeedMultiplier('farming'), 1.75, 'Strength work speed multiplies digging');\n"
)
replace_once(
    test,
    "const alchemySource = fs.readFileSync('docs/js/alchemy-system.js', 'utf8');\n",
    "const alchemySource = fs.readFileSync('docs/js/alchemy-system.js', 'utf8');\n"
    "const fishCatalogSource = fs.readFileSync('docs/js/fish-catalog.js', 'utf8');\n"
)
replace_once(
    test,
    "assert.match(alchemySource, /registerProvider\\('alchemy'/, 'alchemy contributes to the shared effect HUD');\n",
    "assert.match(alchemySource, /registerProvider\\('alchemy'/, 'alchemy contributes to the shared effect HUD');\n"
    "assert.match(alchemySource, /potionOfStrength[\\s\\S]{0,240}magnitude: 0\\.5/, 'Strength grants half of Fury base outgoing-damage bonus');\n"
    "assert.match(alchemySource, /STRENGTH_FOOTING_DAMAGE_RATIO = 1\\.5/, 'Strength grants +75% base Footing damage through its secondary ratio');\n"
    "assert.match(alchemySource, /STRENGTH_WORK_SPEED_RATIO = 1\\.5/, 'Strength grants +75% base chop, dig, and mine speed through its secondary ratio');\n"
    "assert.match(fishCatalogSource, /gurumahi: 'strength'[\\s\\S]{0,80}rockscale: 'fortitude'[\\s\\S]{0,80}sixfin: 'speed'/, 'fish species carry distinct authored cooking buffs');\n"
    "assert.match(fishCatalogSource, /cookingPrimaryEffect:COOKING_EFFECT_BY_SPECIES\\[f\\.species\\]/, 'live fish item definitions expose their species cooking buff');\n"
)

print('Applied Strength and fish cooking buff changes.')