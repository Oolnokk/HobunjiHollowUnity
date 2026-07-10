// Combat ability progression — each of the 10 weapon-tool abilities has 5
// levels; at each one the player picks ONE of 2+ upgrade options, and that
// choice is permanent (no respec) and additive with every other level's
// choice on that same ability. No ability applies any affliction damage on
// its own — every affliction an attack can inflict comes from a level
// chosen here (see resource-system.js's applyDamage, which now takes an
// explicit opts.afflictionBonuses map instead of guessing from a damage
// tag). Level N only opens up once level N-1 has been chosen (level 1 is
// always available) — "the amount of options tends to open up at each
// level" per the design brief, and a level can't be skipped past.
//
// Every ability except Blink Dodge (which deals no damage of its own) is
// "weapon-typed": which set of options it offers at a given level depends
// on the currently equipped weapon's dmgType (see game.js's
// currentWeaponDamageType() — 'sharp' or 'blunt', TOOL_ITEM_DEFS). Only the
// chosen SLOT (level -> option index) is stored — not which type was
// active when it was picked — so the whole build always resolves through
// whichever weapon type is equipped right now: swap weapon types and every
// already-chosen level's effect reinterprets to that type's option at the
// same slot, rather than staying stuck on whatever type happened to be
// equipped when each individual level was picked (which would let a single
// ability accumulate a mix of both sharp and blunt effects at once).
// Progression levels themselves are entirely global — shared across every
// weapon (see combat-loadout.js for what IS per-weapon: which ability
// occupies each loadout slot) — and persist as character save data.
//
// Ability modules read their unlocked bonuses via getEffects(abilityId),
// which merges every chosen level's afflictions (summed per-affliction-id,
// each value a multiplier against the hit's own damage — same convention
// resource-system.js's old tag-based sharpBleedMul/bluntBruiseMul/etc. used)
// and stat bonuses (summed per stat key; each ability module interprets
// only the stat keys relevant to it and ignores the rest).
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

  // meta[abilityId] = { 1: optionIndex, 2: optionIndex, ... } — only
  // sequentially-chosen levels are present; level 1 is always choosable.
  // Only the INDEX is stored, not which weapon type was active when it was
  // picked — every level's actual effect always resolves through whichever
  // weapon type is equipped right now (see getChosenOption/getEffects
  // below), so the whole build stays internally consistent with a single
  // damage type at all times. Swapping weapon type reinterprets every
  // already-chosen level's effect to that type's option at the same slot,
  // rather than letting different levels permanently lock to whatever type
  // happened to be equipped when each one was picked (which let a build
  // accumulate a mix of both sharp and blunt effects on the same ability).
  let meta = {};

  function getUnlockedLevel(abilityId) {
    const m = meta[abilityId];
    if (!m) return 0;
    let lvl = 0;
    while (m[lvl + 1] !== undefined) lvl++;
    return lvl;
  }

  function isLevelAvailable(abilityId, level) {
    if (!TREES[abilityId] || level < 1 || level > 5) return false;
    return level <= getUnlockedLevel(abilityId) + 1;
  }

  function currentWeaponType() {
    return window.Combat.deps?.currentWeaponDamageType?.() || 'sharp';
  }

  // Returns the actual chosen option object ({label, desc, afflictions?,
  // stat?}) for the CURRENTLY equipped weapon's type. null if nothing's
  // been chosen at that level yet.
  function getChosenOption(abilityId, level) {
    const idx = meta[abilityId]?.[level];
    if (idx === undefined) return null;
    const weaponType = isWeaponTyped(abilityId) ? currentWeaponType() : null;
    return getTree(abilityId, weaponType)?.[level - 1]?.[idx] || null;
  }

  function choose(abilityId, level, optionIndex) {
    if (!TREES[abilityId] || !isLevelAvailable(abilityId, level)) return false;
    const weaponType = isWeaponTyped(abilityId) ? currentWeaponType() : null;
    const options = getTree(abilityId, weaponType)?.[level - 1];
    if (!options || optionIndex < 0 || optionIndex >= options.length) return false;
    if (!meta[abilityId]) meta[abilityId] = {};
    meta[abilityId][level] = optionIndex;
    persist();
    return true;
  }

  // Merges every chosen level's afflictions (summed per id) and stat
  // bonuses (summed per key) for one ability into a single flat object.
  function getEffects(abilityId) {
    const afflictions = {};
    const stats = {};
    const m = meta[abilityId] || {};
    for (const levelStr of Object.keys(m)) {
      const option = getChosenOption(abilityId, Number(levelStr));
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
    return { afflictions, stats };
  }

  function serialize() { return JSON.parse(JSON.stringify(meta)); }

  function load(saved) {
    meta = {};
    if (!saved || typeof saved !== 'object') return;
    for (const abilityId of Object.keys(TREES)) {
      const savedLevels = saved[abilityId];
      if (!savedLevels || typeof savedLevels !== 'object') continue;
      const clean = {};
      // Re-validate sequentially rather than trusting the save blindly, so
      // a hand-edited or corrupted save can't skip straight to level 5.
      // Every weapon-type variant of a given ability's tree has the same
      // option count per level (see the tree factories above), so bounds-
      // checking against either variant is equivalent here.
      let lvl = 1;
      while (lvl <= 5 && savedLevels[lvl] !== undefined) {
        const idx = Number(savedLevels[lvl]);
        const options = getTree(abilityId, 'sharp')?.[lvl - 1];
        if (!Number.isInteger(idx) || idx < 0 || !options || idx >= options.length) break;
        clean[lvl] = idx;
        lvl++;
      }
      if (Object.keys(clean).length) meta[abilityId] = clean;
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
    isLevelAvailable,
    getChosenOption,
    choose,
    getEffects,
  };
})();
