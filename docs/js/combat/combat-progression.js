// Combat ability progression — each of the 10 weapon-tool abilities has 5
// levels; at each one the player picks ONE of 2+ upgrade options. No
// ability applies any affliction damage on its own — every affliction an
// attack can inflict comes from a level chosen here (see resource-
// system.js's applyDamage, which takes an explicit opts.afflictionBonuses
// map instead of guessing from a damage tag).
//
// Progression is scoped to the literal TOOL INSTANCE an ability is
// equipped on (game.js's currentWeaponKey() — "your trusty axe"), not
// shared globally across every weapon: a tool has its own Mastery level
// (0-5, game.js's toolMasteryLevel() — built up through both combat and
// ordinary tool use), and that mastery gates how many of ITS OWN equipped
// abilities' 5 levels can be chosen. Level N only opens up once level N-1
// has been chosen AND the tool's mastery has reached N (level 1 is always
// choosable once mastery reaches 1) — "the amount of options tends to open
// up at each level" per the design brief, and a level can't be skipped
// past. Actually making (or later changing) a level's choice costs Motes
// of Prowess — N motes for level N, earned from combat and other sources
// (game.js's awardMotesOfProwess/spendMotesOfProwess).
//
// Every ability except Blink Dodge (which deals no damage of its own) is
// "weapon-typed": which set of options it offers at a given level depends
// on ITS OWNING TOOL's fixed dmgType (see game.js's
// weaponDamageTypeForTool() — 'sharp' or 'blunt', TOOL_ITEM_DEFS). Since a
// tool's dmgType never changes and its progression is scoped to that one
// tool instance, a single tool's build can never end up a mix of both
// sharp and blunt effects — unlike a shared-across-weapons design would.
//
// Ability modules read their unlocked bonuses via getEffects(toolKey,
// abilityId), which merges every chosen level's afflictions (summed per-
// affliction-id, each value a multiplier against the hit's own damage —
// same convention resource-system.js's old tag-based sharpBleedMul/
// bluntBruiseMul/etc. used) and stat bonuses (summed per stat key; each
// ability module interprets only the stat keys relevant to it and ignores
// the rest).
(() => {
  "use strict";
  if (!window.Combat) { console.error('combat-progression.js requires combat-core.js to load first'); return; }

  function aff(id, mul, label, desc) { return { label, desc, afflictions: { [id]: mul } }; }
  function stat(key, val, label, desc) { return { label, desc, stat: { [key]: val } }; }

  // Per-hit affliction multipliers, same order of magnitude as the flat
  // tag-based rates this replaced (resource-system.js's old sharpBleedMul
  // 0.35 / bluntBruiseMul 0.55 / etc.) so a fully-leveled ability feels
  // about as strong as the old always-on system did, but only once earned.
  const BLEED = 0.35, WOUND = 0.42, BRUISE = 0.5, WIND = 0.4, POISON = 0.28, INFECT = 0.38, SHATTER = 0.32, CONGEAL = 0.36;

  // Generic blunt (bludgeoning) tree: bruise/wind flavor early, branching
  // into the heavier stamina-debt afflictions and a couple of plain stat
  // picks once there's enough going on to make a stat bonus worth choosing
  // over another affliction. Shared verbatim by most weapon-typed abilities.
  function bluntTree() {
    return [
      [aff('bruisedHealth', BRUISE, 'Heavy Fists', 'Adds Bruised Health on every landed hit.'),
       aff('windedStamina', WIND, 'Winding Blows', 'Adds Winded Stamina on every landed hit.')],
      [aff('bruisedHealth', BRUISE * 0.6, 'Battering', 'More Bruised Health per hit.'),
       stat('knockbackMul', 0.15, 'Forceful Swings', '+15% knockback.')],
      [aff('windedStamina', WIND * 0.7, 'Relentless Pressure', 'More Winded Stamina per hit.'),
       aff('congealedHealth', CONGEAL, 'Concussive Blows', 'Adds Congealed Health on every landed hit.'),
       stat('damageMul', 0.10, 'Heavier Blade', '+10% damage.')],
      [aff('shatteredStamina', SHATTER, 'Crippling Strikes', 'Adds Shattered Stamina on every landed hit.'),
       stat('staminaCostMul', -0.15, 'Economical Form', '-15% stamina cost.'),
       aff('bruisedHealth', BRUISE * 0.5, 'Bone-Deep Bruising', 'More Bruised Health per hit.')],
      [aff('bruisedHealth', BRUISE * 0.65, 'Crushing Finish', 'Even more Bruised Health per hit.'),
       aff('windedStamina', WIND * 0.6, 'Exhausting Barrage', 'More Winded Stamina per hit.'),
       stat('damageMul', 0.15, 'Masterwork Swings', '+15% damage.')],
    ];
  }

  // Generic sharp (edged) tree: bleed/wound flavor early, branching into
  // poison/infection and reach/speed stat picks. Shared verbatim by most
  // weapon-typed abilities.
  function sharpTree() {
    return [
      [aff('bleedingHealth', BLEED, 'Opened Wound', 'Adds Bleeding Health on every landed hit.'),
       aff('woundedStamina', WOUND, 'Wounding Point', 'Adds Wounded Stamina on every landed hit.')],
      [aff('bleedingHealth', BLEED * 0.6, 'Deeper Cut', 'More Bleeding Health per hit.'),
       stat('rangeMul', 0.12, 'Extended Reach', '+12% range.')],
      [aff('woundedStamina', WOUND * 0.7, 'Sapping Point', 'More Wounded Stamina per hit.'),
       aff('poisonedHealth', POISON, 'Envenomed Edge', 'Adds Poisoned Health on every landed hit.'),
       stat('lungeMul', 0.2, 'Lunging Form', '+20% lunge distance.')],
      [aff('infectedStamina', INFECT, 'Festering Wound', 'Adds Infected Stamina on every landed hit.'),
       stat('staminaCostMul', -0.15, 'Economical Form', '-15% stamina cost.'),
       aff('bleedingHealth', BLEED * 0.5, 'Precision Cut', 'More Bleeding Health per hit.')],
      [aff('bleedingHealth', BLEED * 0.65, 'Arterial Strike', 'Even more Bleeding Health per hit.'),
       aff('poisonedHealth', POISON * 0.75, 'Toxic Follow-Through', 'More Poisoned Health per hit.'),
       stat('damageMul', 0.15, 'Masterwork Point', '+15% damage.')],
    ];
  }

  // Exhaust Cutter is themed around a target's spent stamina — its sharp
  // tree leans harder into the stamina-side afflictions (Infected/
  // Shattered) than the generic sharp tree; its blunt tree is the generic
  // one (a bludgeoning Exhaust Cutter has no special theme of its own).
  function exhaustCutterSharpTree() {
    return [
      [aff('bleedingHealth', BLEED, 'Opened Wound', 'Adds Bleeding Health on every landed hit.'),
       aff('woundedStamina', WOUND, 'Wounding Point', 'Adds Wounded Stamina on every landed hit.')],
      [aff('infectedStamina', INFECT * 0.8, 'Fevered Cut', 'Adds Infected Stamina on every landed hit.'),
       stat('rangeMul', 0.12, 'Extended Reach', '+12% range.')],
      [aff('shatteredStamina', SHATTER * 0.85, 'Sundering Point', 'Adds Shattered Stamina on every landed hit.'),
       aff('woundedStamina', WOUND * 0.7, 'Sapping Point', 'More Wounded Stamina per hit.'),
       stat('lungeMul', 0.2, 'Lunging Form', '+20% lunge distance.')],
      [aff('infectedStamina', INFECT * 0.6, 'Rotting Wound', 'More Infected Stamina per hit.'),
       stat('staminaCostMul', -0.15, 'Economical Form', '-15% stamina cost.'),
       aff('bleedingHealth', BLEED * 0.5, 'Precision Cut', 'More Bleeding Health per hit.')],
      [aff('shatteredStamina', SHATTER * 0.7, 'Ruinous Point', 'Even more Shattered Stamina per hit.'),
       aff('bleedingHealth', BLEED * 0.5, 'Arterial Strike', 'More Bleeding Health per hit.'),
       stat('damageMul', 0.15, 'Masterwork Point', '+15% damage.')],
    ];
  }

  // Mercy Spike is a finishing strike against low-health targets — its
  // sharp tree's higher levels open into Poisoned Health rather than
  // Infected Stamina, a more lethal (non-recovering) flavor to match "mercy
  // kill"; its blunt tree is the generic one.
  function mercySpikeSharpTree() {
    return [
      [aff('bleedingHealth', BLEED, 'Opened Wound', 'Adds Bleeding Health on every landed hit.'),
       aff('woundedStamina', WOUND, 'Wounding Point', 'Adds Wounded Stamina on every landed hit.')],
      [aff('bleedingHealth', BLEED * 0.6, 'Deeper Cut', 'More Bleeding Health per hit.'),
       stat('rangeMul', 0.12, 'Extended Reach', '+12% range.')],
      [aff('poisonedHealth', POISON, 'Envenomed Edge', 'Adds Poisoned Health on every landed hit.'),
       aff('woundedStamina', WOUND * 0.7, 'Sapping Point', 'More Wounded Stamina per hit.'),
       stat('lungeMul', 0.2, 'Lunging Form', '+20% lunge distance.')],
      [aff('poisonedHealth', POISON * 0.75, 'Lethal Dose', 'More Poisoned Health per hit.'),
       stat('staminaCostMul', -0.15, 'Economical Form', '-15% stamina cost.'),
       aff('bleedingHealth', BLEED * 0.5, 'Precision Cut', 'More Bleeding Health per hit.')],
      [aff('poisonedHealth', POISON * 0.9, 'Coup de Grâce', 'Even more Poisoned Health per hit.'),
       aff('bleedingHealth', BLEED * 0.5, 'Arterial Strike', 'More Bleeding Health per hit.'),
       stat('damageMul', 0.15, 'Masterwork Point', '+15% damage.')],
    ];
  }

  // Counter Shield's riposte swings whatever weapon is equipped, so its
  // affliction picks are weapon-typed like everything else; its stance-side
  // utility picks (drain/cooldown/absorb) stay the same in both trees.
  function counterShieldTree(afflictionA, afflictionB, afflictionC, afflictionD, afflictionE, mulA, mulB, mulC, mulD, mulE, riposteWord) {
    return [
      [aff(afflictionA, mulA, `Punishing ${riposteWord}`, `The ${riposteWord.toLowerCase()} adds ${AFFLICTION_LABEL[afflictionA]}.`),
       aff(afflictionB, mulB, `Wounding ${riposteWord}`, `The ${riposteWord.toLowerCase()} adds ${AFFLICTION_LABEL[afflictionB]}.`)],
      [stat('drainMul', -0.2, 'Braced Stance', '-20% stamina drain while held.'),
       stat('damageMul', 0.12, `Harder ${riposteWord}`, `+12% ${riposteWord.toLowerCase()} damage.`)],
      [aff(afflictionC, mulC, `Envenomed ${riposteWord}`, `The ${riposteWord.toLowerCase()} adds ${AFFLICTION_LABEL[afflictionC]}.`),
       stat('cooldownMul', -0.25, 'Quick Recovery', `-25% ${riposteWord.toLowerCase()} cooldown.`),
       stat('absorbMul', -0.15, 'Efficient Guard', '-15% stamina cost to absorb a hit.')],
      [aff(afflictionA, mulA * 0.6, `Deeper ${riposteWord}`, `More ${AFFLICTION_LABEL[afflictionA]} on the ${riposteWord.toLowerCase()}.`),
       stat('drainMul', -0.2, 'Fortified Stance', '-20% stamina drain while held.'),
       stat('damageMul', 0.13, `Piercing ${riposteWord}`, `+13% ${riposteWord.toLowerCase()} damage.`)],
      [aff(afflictionB, mulB * 0.6, `Debilitating ${riposteWord}`, `More ${AFFLICTION_LABEL[afflictionB]} on the ${riposteWord.toLowerCase()}.`),
       aff(afflictionD, mulD, `Lethal ${riposteWord}`, `The ${riposteWord.toLowerCase()} adds ${AFFLICTION_LABEL[afflictionD]}.`),
       stat('cooldownMul', -0.25, 'Instant Recovery', `-25% ${riposteWord.toLowerCase()} cooldown.`)],
    ];
  }

  const AFFLICTION_LABEL = {
    bleedingHealth: 'Bleeding Health', woundedStamina: 'Wounded Stamina', poisonedHealth: 'Poisoned Health', infectedStamina: 'Infected Stamina',
    bruisedHealth: 'Bruised Health', windedStamina: 'Winded Stamina', congealedHealth: 'Congealed Health', shatteredStamina: 'Shattered Stamina',
  };

  // Ability id -> { sharp: levels, blunt: levels } for weapon-typed
  // abilities, or a flat levels array for the one that isn't (Blink Dodge).
  const TREES = {
    swingCombo: { sharp: sharpTree(), blunt: bluntTree() },
    pokeCombo: { sharp: sharpTree(), blunt: bluntTree() },
    opportunistJab: { sharp: sharpTree(), blunt: bluntTree() },
    exhaustCutter: { sharp: exhaustCutterSharpTree(), blunt: bluntTree() },
    backstabFlick: { sharp: sharpTree(), blunt: bluntTree() },
    mercySpike: { sharp: mercySpikeSharpTree(), blunt: bluntTree() },
    chargedBreaker: { sharp: sharpTree(), blunt: bluntTree() },
    acceleratingFlurry: { sharp: sharpTree(), blunt: bluntTree() },
    counterShield: {
      sharp: counterShieldTree('bleedingHealth', 'woundedStamina', 'poisonedHealth', 'poisonedHealth', null, BLEED, WOUND, POISON * 0.8, POISON * 0.6, null, 'Riposte'),
      blunt: counterShieldTree('bruisedHealth', 'windedStamina', 'congealedHealth', 'shatteredStamina', null, BRUISE, WIND, CONGEAL * 0.8, SHATTER * 0.6, null, 'Riposte'),
    },

    // Blink Dodge deals no damage of its own — its whole tree is movement/
    // stamina utility instead of afflictions, so it isn't weapon-typed.
    blinkDodge: [
      [stat('zipDistanceMul', 0.18, 'Longer Zip', '+18% zip distance.'),
       stat('zipCostMul', -0.15, 'Efficient Zip', '-15% stamina cost per zip.')],
      [stat('idleDrainMul', -0.25, 'Patient Stance', '-25% idle stamina drain while held.'),
       stat('invulnMul', 0.2, 'Lingering Blur', '+20% invulnerability window per zip.')],
      [stat('zipCooldownMul', -0.2, 'Rapid Zips', '-20% cooldown between zips.'),
       stat('zipDistanceMul', 0.15, 'Farther Blur', '+15% zip distance.'),
       stat('walkSpeedMul', 0.1, 'Brisk Footwork', '+10% walk speed while held.')],
      [stat('zipCostMul', -0.15, 'Frugal Zip', '-15% stamina cost per zip.'),
       stat('invulnMul', 0.2, 'Extended Blur', '+20% invulnerability window per zip.'),
       stat('idleDrainMul', -0.2, 'Steady Stance', '-20% idle stamina drain while held.')],
      [stat('zipCooldownMul', -0.2, 'Flicker Step', '-20% cooldown between zips.'),
       stat('zipDistanceMul', 0.2, 'Long Blur', '+20% zip distance.'),
       stat('invulnMul', 0.25, 'Afterimage', '+25% invulnerability window per zip.')],
    ],
  };

  function isWeaponTyped(abilityId) {
    const t = TREES[abilityId];
    return !!(t && !Array.isArray(t));
  }

  // weaponType is ignored for non-weapon-typed abilities (Blink Dodge).
  function getTree(abilityId, weaponType) {
    const t = TREES[abilityId];
    if (!t) return null;
    if (Array.isArray(t)) return t;
    return t[weaponType] || t.sharp;
  }

  // meta[toolKey][abilityId] = { 1: optionIndex, 2: optionIndex, ... } —
  // progression is scoped to the literal tool instance an ability was
  // leveled on (game.js's currentWeaponKey()/equipmentSlots.weapon —
  // "your trusty axe", not just "combos in general"), not shared globally
  // across every weapon. A tool's own dmgType is fixed for its whole
  // lifetime (see game.js's weaponDamageTypeForTool()), so a single tool
  // instance's choices can never end up a mix of sharp and blunt effects —
  // only sequentially-chosen levels are present; level 1 is always
  // choosable (gated by that tool's own mastery — see getLevelState below).
  let meta = {};

  function getUnlockedLevel(toolKey, abilityId) {
    const m = meta[toolKey]?.[abilityId];
    if (!m) return 0;
    let lvl = 0;
    while (m[lvl + 1] !== undefined) lvl++;
    return lvl;
  }

  function masteryLevel(toolKey) {
    return window.Combat.deps?.toolMasteryLevel?.(toolKey) ?? 0;
  }

  function weaponTypeForTool(toolKey) {
    return window.Combat.deps?.weaponDamageTypeForTool?.(toolKey) || 'sharp';
  }

  // 'chosen': already picked — clicking it again lets the player change it
  // (same mote cost as picking it fresh). 'available': not picked yet, but
  // this tool's mastery is high enough and every earlier level is already
  // chosen, so it can be picked right now. 'mastery-locked': it's next in
  // line but this tool hasn't reached that mastery level yet. 'locked':
  // unreachable (a level further out than the very next one).
  function getLevelState(toolKey, abilityId, level) {
    if (!TREES[abilityId] || level < 1 || level > 5) return 'locked';
    const unlocked = getUnlockedLevel(toolKey, abilityId);
    if (level <= unlocked) return 'chosen';
    if (level !== unlocked + 1) return 'locked';
    return level <= masteryLevel(toolKey) ? 'available' : 'mastery-locked';
  }

  function isLevelAvailable(toolKey, abilityId, level) {
    return getLevelState(toolKey, abilityId, level) === 'available';
  }

  // Motes of Prowess cost to pick (or change) a level's choice — level N
  // costs N motes, whether it's being picked for the first time or changed.
  function moteCostForLevel(level) { return level; }

  // Returns the actual chosen option object ({label, desc, afflictions?,
  // stat?}) for this tool instance. null if nothing's been chosen at that
  // level yet.
  function getChosenOption(toolKey, abilityId, level) {
    const idx = meta[toolKey]?.[abilityId]?.[level];
    if (idx === undefined) return null;
    const weaponType = isWeaponTyped(abilityId) ? weaponTypeForTool(toolKey) : null;
    return getTree(abilityId, weaponType)?.[level - 1]?.[idx] || null;
  }

  // Spends moteCostForLevel(level) Motes of Prowess — fails without
  // spending anything if the level isn't choosable (wrong mastery/sequence)
  // or the player can't afford it.
  function choose(toolKey, abilityId, level, optionIndex) {
    const state = getLevelState(toolKey, abilityId, level);
    if (state !== 'chosen' && state !== 'available') return false;
    const weaponType = isWeaponTyped(abilityId) ? weaponTypeForTool(toolKey) : null;
    const options = getTree(abilityId, weaponType)?.[level - 1];
    if (!options || optionIndex < 0 || optionIndex >= options.length) return false;
    if (!window.Combat.deps?.spendMotesOfProwess?.(moteCostForLevel(level))) return false;
    if (!meta[toolKey]) meta[toolKey] = {};
    if (!meta[toolKey][abilityId]) meta[toolKey][abilityId] = {};
    meta[toolKey][abilityId][level] = optionIndex;
    persist();
    return true;
  }

  // Merges every chosen level's afflictions (summed per id) and stat
  // bonuses (summed per key) for one ability *on this tool* into a single
  // flat object.
  function getEffects(toolKey, abilityId) {
    const afflictions = {};
    const stats = {};
    const m = meta[toolKey]?.[abilityId] || {};
    for (const levelStr of Object.keys(m)) {
      const option = getChosenOption(toolKey, abilityId, Number(levelStr));
      if (!option) continue;
      if (option.afflictions) {
        for (const [id, mul] of Object.entries(option.afflictions)) {
          afflictions[id] = (afflictions[id] || 0) + mul;
        }
      }
      if (option.stat) {
        for (const [key, val] of Object.entries(option.stat)) {
          stats[key] = (stats[key] || 0) + val;
        }
      }
    }
    // Increase AoE / Increase Lunge Distance perks apply here so every
    // ability (which already reads stats.rangeMul/lungeMul off this same
    // returned object) picks them up uniformly.
    stats.rangeMul = (stats.rangeMul || 0) + (window.PerkSystem?.rank('combat', 'increaseAoe') || 0) * 0.1;
    stats.lungeMul = (stats.lungeMul || 0) + (window.PerkSystem?.rank('combat', 'increaseLungeDistance') || 0) * 0.12;
    return { afflictions, stats };
  }

  function serialize() { return JSON.parse(JSON.stringify(meta)); }

  function load(saved) {
    meta = {};
    if (!saved || typeof saved !== 'object') return;
    for (const [toolKey, abilityMap] of Object.entries(saved)) {
      if (!abilityMap || typeof abilityMap !== 'object') continue;
      const weaponType = weaponTypeForTool(toolKey);
      for (const abilityId of Object.keys(TREES)) {
        const savedLevels = abilityMap[abilityId];
        if (!savedLevels || typeof savedLevels !== 'object') continue;
        const treeType = isWeaponTyped(abilityId) ? weaponType : null;
        const clean = {};
        // Re-validate sequentially rather than trusting the save blindly,
        // so a hand-edited or corrupted save can't skip straight to level 5.
        let lvl = 1;
        while (lvl <= 5 && savedLevels[lvl] !== undefined) {
          const idx = Number(savedLevels[lvl]);
          const options = getTree(abilityId, treeType)?.[lvl - 1];
          if (!Number.isInteger(idx) || idx < 0 || !options || idx >= options.length) break;
          clean[lvl] = idx;
          lvl++;
        }
        if (Object.keys(clean).length) {
          if (!meta[toolKey]) meta[toolKey] = {};
          meta[toolKey][abilityId] = clean;
        }
      }
    }
  }

  function persist() {
    try {
      const saveMeta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      if (!saveMeta || !window.__hobunjiPlayerProfile?.characterId) return;
      const ch = (saveMeta.characters || []).find(c => c.id === window.__hobunjiPlayerProfile.characterId);
      if (ch) {
        ch.abilityProgression = serialize();
        localStorage.setItem('hobunjiSaveMeta', JSON.stringify(saveMeta));
      }
    } catch {}
  }

  function loadFromProfile(playerData) {
    load(playerData?.abilityProgression);
  }

  document.addEventListener('hobunjiPlayerReady', (e) => loadFromProfile(e.detail));
  if (window.__hobunjiPlayerProfile) loadFromProfile(window.__hobunjiPlayerProfile);

  window.CombatProgression = {
    isWeaponTyped,
    getTree,
    getUnlockedLevel,
    getLevelState,
    isLevelAvailable,
    moteCostForLevel,
    getChosenOption,
    choose,
    getEffects,
  };
})();
