(() => {
  'use strict';

  const MAX_LEVEL = 20; // Used as the progression cap and modifier balance denominator.
  const SKILLS = {
    foraging: { label: 'Foraging', icon: '🌿', effect: 'Bonus herbs/wood and faster axe holds.' },
    mining: { label: 'Mining', icon: '⛏️', effect: 'Bonus stone/ore and faster pick holds.' },
    farming: { label: 'Farming', icon: '🌾', effect: 'Better crop/animal goods and faster digging.' },
    fishing: { label: 'Fishing', icon: '🎣', effect: 'Rarer fish encounters and better fish quality.' },
    combat: { label: 'Combat', icon: '⚔️', effect: 'Higher attack power and better meat quality.' },
    cooking: { label: 'Cooking', icon: '🍲', effect: 'Better food and a chance to save ingredients.' },
    alchemy: { label: 'Alchemy', icon: '⚗️', effect: 'More reliable targeted reactions and stronger brewed potency tiers.' },
  }; // Used by progression, food-skill buffs, and the Skills tab.
  const LEGACY_SKILL_MAP = { crafting: 'cooking' }; // Used to preserve pre-rename Crafting saves under the same skill, now called Cooking.
  const XP_GAINS = {
    forage: 4, tree: 8, rock: 8, dig: 1, crop: 6, animalGood: 5,
    fish: 10, combatHit: 1, combatKill: 8, cook: 8,
    alchemyBrew: 8, alchemyDiscovery: 18, alchemyTarget: 5,
  }; // Used by game actions so balance remains centralized.

  let deps = null; // Used to access saving, random rolls, popups, and food stacks.
  const experience = Object.fromEntries(Object.keys(SKILLS).map(key => [key, 0])); // Used as character-scoped cumulative skill XP.

  function xpForLevel(level) {
    const safeLevel = Math.max(0, Math.min(MAX_LEVEL, Math.floor(Number(level) || 0))); // Used to keep thresholds inside the supported level range.
    return 10 * safeLevel * (safeLevel + 1);
  }

  function levelFromXp(xp) {
    const safeXp = Math.max(0, Math.floor(Number(xp) || 0)); // Used to reject malformed saved experience.
    let result = 0; // Used to walk cumulative thresholds up to the cap.
    while (result < MAX_LEVEL && safeXp >= xpForLevel(result + 1)) result++;
    return result;
  }

  function init(injectedDeps = {}) {
    deps = injectedDeps; // Used by every side-effecting operation after game boot.
    render();
  }

  function restore(playerData = {}) {
    const savedXp = playerData.skillExperience && typeof playerData.skillExperience === 'object'
      ? playerData.skillExperience : {}; // Used as the preferred modern save shape.
    const savedLevels = playerData.skillLevels && typeof playerData.skillLevels === 'object'
      ? playerData.skillLevels : {}; // Used for migration from the original stub fields.
    for (const key of Object.keys(SKILLS)) {
      const legacyKeys = Object.entries(LEGACY_SKILL_MAP).filter(([, modern]) => modern === key).map(([legacy]) => legacy); // Used to find this skill's pre-rename save key(s), e.g. 'crafting' -> 'cooking'.
      let value = Number(savedXp[key]); // Used when this character has already saved real XP under the current key.
      if (!Number.isFinite(value)) value = Math.max(0, ...legacyKeys.map(legacy => Number(savedXp[legacy]) || 0)); // Used to preserve real XP saved under a pre-rename key.
      if (!Number.isFinite(value) || !value) {
        const legacyLevels = legacyKeys.map(legacy => Number(savedLevels[legacy]) || 0); // Used to map old creation skills into their modern equivalent.
        const savedLevel = Math.max(Number(savedLevels[key]) || 0, ...legacyLevels, 0); // Used to preserve the highest compatible pre-system level.
        value = Math.max(Number(value) || 0, xpForLevel(savedLevel));
      }
      experience[key] = Math.max(0, Math.floor(value));
    }
    persist(false);
    render();
  }

  function foodStacks(skillKey) {
    return Math.max(0, Number(deps?.getFoodEffectStacks?.(skillKey)) || 0); // Used to add the currently active food skill stacks.
  }

  function level(skillKey) {
    return SKILLS[skillKey] ? levelFromXp(experience[skillKey]) : 0;
  }

  function effectiveLevel(skillKey) {
    return SKILLS[skillKey] ? level(skillKey) + foodStacks(skillKey) : 0;
  }

  function normalizedPower(skillKey) {
    return Math.max(0, Math.min(1.5, effectiveLevel(skillKey) / MAX_LEVEL)); // Used by all percentage-based skill effects.
  }

  function persist(write = true) {
    const levels = Object.fromEntries(Object.keys(SKILLS).map(key => [key, level(key)])); // Used to keep the old level-shaped save field compatible.
    const snapshot = { levels, experience: { ...experience } }; // Used by the injected character-save adapter.
    if (write) deps?.saveSkillProgress?.(snapshot);
    return snapshot;
  }

  function award(skillKey, amount, reason = '') {
    if (!SKILLS[skillKey]) return false;
    const gain = Math.max(0, Math.floor(Number(amount) || 0)); // Used to reject fractional, negative, or invalid XP grants.
    if (!gain) return false;
    const beforeLevel = level(skillKey); // Used to detect level-ups before mutating XP.
    experience[skillKey] += gain;
    const afterLevel = level(skillKey); // Used for level-up messaging after the grant.
    deps?.queueSkillXp?.(`+${gain} ${SKILLS[skillKey].label} XP`);
    if (afterLevel > beforeLevel) deps?.showToast?.(`${SKILLS[skillKey].icon} ${SKILLS[skillKey].label} reached level ${afterLevel}!`, true);
    deps?.debugLog?.(`[skills] ${SKILLS[skillKey].label} +${gain}${reason ? ` (${reason})` : ''}; level ${afterLevel}`);
    persist(true);
    render();
    return true;
  }

  // Foraging, Combat, and Fishing no longer get an automatic bonus purely
  // from leveling up (that used to scale with normalizedPower(skillKey)) —
  // each such bonus now only exists behind its own perk in PerkSystem's
  // tree for that skill (see docs/js/perk-system.js), so leveling those
  // three only grants perk points rather than free passive power. Mining,
  // Farming, and Cooking have no perk tree yet, so they keep the original
  // automatic level-based curve below unchanged.
  function bonusYieldChance(skillKey) {
    if (skillKey === 'foraging') return Math.min(0.6, (window.PerkSystem?.rank('foraging', 'increaseYieldChance') || 0) * 0.1); // Increase Yield Chance perk.
    return Math.min(0.35, normalizedPower(skillKey) * 0.35); // Used by stone and future ore rewards.
  }

  function actionSpeedMultiplier(skillKey) {
    if (skillKey === 'foraging') return 1 + (window.PerkSystem?.rank('foraging', 'increaseForagingSpeed') || 0) * 0.1; // Increase Foraging Speed perk.
    return 1 + normalizedPower(skillKey) * 0.5; // Used to shorten pick and digging action stages.
  }

  function attackMultiplier() {
    const strengthStacks = Math.max(0, Number(deps?.getFoodEffectStacks?.('strength')) || 0); // Used to combine Empower Raw Damage (see PerkSystem.combatDamageMultiplier, applied separately in game.js) with Strength food.
    return 1 + Math.min(0.5, strengthStacks * 0.02);
  }

  function damageTakenMultiplier() {
    const fortitudeStacks = Math.max(0, Number(deps?.getFoodEffectStacks?.('fortitude')) || 0); // Used to reduce incoming damage while Fortitude food is active.
    return Math.max(0.55, 1 - Math.min(0.45, fortitudeStacks * 0.02));
  }

  function rareFishWeightMultiplier(rarity) {
    const perceptionStacks = Math.max(0, Number(deps?.getFoodEffectStacks?.('perception')) || 0); // Used to let Perception food contribute to fish selection.
    const power = Math.min(0.5, perceptionStacks * 0.02); // Used to bias only uncommon and rare entries; the Increased Chance of Rare Fish perk applies its own separate multiplier (see fishing-minigame.js).
    const alchemyPerception = window.AlchemySystem?.getPerceptionMultiplier?.() || 1; // Reuses the existing fishing Perception check.
    if (rarity === 'rare') return (1 + power * 2.5) * alchemyPerception;
    if (rarity === 'uncommon') return (1 + power * 1.1) * alchemyPerception;
    return 1;
  }

  function craftIngredientSaveChance() {
    const clarityStacks = Math.max(0, Number(deps?.getFoodEffectStacks?.('clarity')) || 0); // Used to give Clarity food a small cooking benefit.
    return Math.min(0.25, normalizedPower('cooking') * 0.2 + clarityStacks * 0.003);
  }

  function weightedBaseQuality() {
    const weights = [1, 3, 5, 3, 1]; // Used to preserve the game's original middle-weighted 1–5 star roll.
    const random = deps?.random || Math.random; // Used to make tests able to inject deterministic rolls.
    let roll = random() * weights.reduce((sum, value) => sum + value, 0); // Used to select a weighted quality tier.
    for (let index = 0; index < weights.length; index++) {
      roll -= weights[index];
      if (roll <= 0) return index + 1;
    }
    return 3;
  }

  const QUALITY_PERKS = { combat: 'increaseLootQuality', foraging: 'increaseForagingQuality', fishing: 'increaseFishQuality' }; // Skills whose quality bonus is perk-gated rather than automatic.

  function qualityPower(skillKey) {
    const perkId = QUALITY_PERKS[skillKey];
    return perkId ? Math.min(1, (window.PerkSystem?.rank(skillKey, perkId) || 0) * 0.2) : normalizedPower(skillKey);
  }

  function rollQuality(skillKey) {
    const random = deps?.random || Math.random; // Used for skill-driven quality improvement chances.
    const power = qualityPower(skillKey); // Used to scale two independent one-star improvement rolls.
    let stars = weightedBaseQuality(); // Used as the original quality result before skill improvement.
    if (random() < power * 0.55) stars++;
    if (random() < power * 0.15) stars++;
    return Math.max(1, Math.min(5, stars));
  }

  function starRatingText(stars) {
    const safeStars = Math.max(1, Math.min(5, Math.floor(Number(stars) || 1))); // Used to keep UI stars valid.
    return '★'.repeat(safeStars) + '☆'.repeat(5 - safeStars);
  }

  function render() {
    const container = document.querySelector('#mpProgress .progress-skills'); // Used as the existing Skills-tab list.
    if (!container) return;
    container.innerHTML = Object.entries(SKILLS).map(([key, definition]) => {
      const currentLevel = level(key); // Used to label the persisted base level.
      const effective = effectiveLevel(key); // Used to expose active food-stack additions.
      const currentFloor = xpForLevel(currentLevel); // Used to calculate within-level progress.
      const nextFloor = currentLevel >= MAX_LEVEL ? currentFloor : xpForLevel(currentLevel + 1); // Used as the next XP target.
      const percent = currentLevel >= MAX_LEVEL ? 100 : Math.max(0, Math.min(100, (experience[key] - currentFloor) / Math.max(1, nextFloor - currentFloor) * 100)); // Used by the progress bar.
      const buffText = effective > currentLevel ? ` +${effective - currentLevel} food` : ''; // Used to make temporary skill stacks explicit.
      return `<div class="skill-row" data-skill="${key}" title="${definition.effect}">
        <span class="skill-icon">${definition.icon}</span>
        <div class="skill-copy"><div class="skill-name">${definition.label}</div><div class="skill-effect">${definition.effect}</div></div>
        <div class="skill-bar-wrap"><div class="skill-bar-fill" style="width:${percent.toFixed(2)}%"></div></div>
        <div class="skill-level">Lv ${currentLevel}${buffText}</div>
      </div>`;
    }).join('') + `<details class="skill-diagnostics"><summary>Skill diagnostics</summary><pre>${diagnosticsText()}</pre>${deps?.isDevMode?.() ? debugButtonsHtml() : ''}</details>`;
    if (deps?.isDevMode?.()) {
      container.querySelectorAll('[data-skill-debug]').forEach(button => button.addEventListener('click', () => award(button.dataset.skillDebug, 10, 'debug button')));
    }
  }

  function debugButtonsHtml() {
    return `<div class="skill-debug-actions">${Object.entries(SKILLS).map(([key, definition]) => `<button type="button" data-skill-debug="${key}">+10 ${definition.label} XP</button>`).join('')}</div>`;
  }

  function diagnosticsText() {
    return Object.entries(SKILLS).map(([key, definition]) => {
      const current = level(key); // Used to report base and effective values without desktop developer tools.
      return `${definition.label}: level ${current}, effective ${effectiveLevel(key)}, XP ${experience[key]}${current < MAX_LEVEL ? `/${xpForLevel(current + 1)}` : ' (max)'}`;
    }).join('\n');
  }

  window.SkillSystem = {
    MAX_LEVEL,
    SKILLS,
    XP_GAINS,
    init,
    restore,
    award,
    level,
    effectiveLevel,
    bonusYieldChance,
    actionSpeedMultiplier,
    attackMultiplier,
    damageTakenMultiplier,
    rareFishWeightMultiplier,
    craftIngredientSaveChance,
    rollQuality,
    starRatingText,
    render,
    snapshot: persist,
    diagnosticsText,
  };
})();
