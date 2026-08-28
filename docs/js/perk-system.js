(() => {
  'use strict';

  // Perk trees for Combat, Alchemy, Foraging, and Fishing. Each skill earns
  // one perk point per level (see SkillSystem.level, MAX_LEVEL 20), spent on
  // ranks within that same skill's own tree — a Fishing point can only buy a
  // Fishing perk, etc. Every perk's actual gameplay effect is read directly
  // by the system it affects (combat/resource-system.js, combat-progression.js,
  // alchemy-system.js, reagent-plants.js, fishing-minigame.js, fishing-events.js,
  // cooking-system.js/game.js's campfire flow) via rank(skillKey, perkId) — this
  // module only owns the tree data, point bookkeeping, save/load, and the UI.
  const POINTS_PER_LEVEL = 1;

  const TREES = {
    combat: [
      { id: 'empowerControlEffects', name: 'Empower Control Effects', maxRank: 3, per: 12, desc: r => `Control-family effects (stagger/wind) are ${r * 12}% stronger.` },
      { id: 'empowerDamageEffects', name: 'Empower Damage Effects', maxRank: 3, per: 12, desc: r => `Damage-family effects (bleed, poison, ...) are ${r * 12}% stronger.` },
      { id: 'empowerOffensiveDebuffs', name: 'Empower Offensive Debuffs', maxRank: 3, per: 12, desc: r => `Offensive-debuff effects are ${r * 12}% stronger.` },
      { id: 'empowerDefensiveDebuffs', name: 'Empower Defensive Debuffs', maxRank: 3, per: 12, desc: r => `Defensive-debuff effects are ${r * 12}% stronger.` },
      { id: 'empowerRawDamage', name: 'Empower Raw Damage', maxRank: 3, per: 5, desc: r => `All outgoing damage is increased ${r * 5}%.` },
      { id: 'empowerQuickAttacks', name: 'Empower Quick Attacks', maxRank: 3, per: 8, desc: r => `Quick Attack damage is increased ${r * 8}%.` },
      { id: 'empowerDefensiveAttacks', name: 'Empower Defensive Attacks', maxRank: 3, per: 8, desc: r => `Defensive (Counter Shield) attack damage is increased ${r * 8}%.` },
      { id: 'empowerHeavyAttacks', name: 'Empower Heavy Attacks', maxRank: 3, per: 8, desc: r => `Heavy attack damage is increased ${r * 8}%.` },
      { id: 'increaseStamina', name: 'Increase Stamina', maxRank: 3, per: 8, desc: r => `Maximum Stamina is increased ${r * 8}%.` },
      { id: 'increaseHealth', name: 'Increase Health', maxRank: 3, per: 8, desc: r => `Maximum Health is increased ${r * 8}%.` },
      { id: 'increaseFootingDamage', name: 'Increase Footing Damage', maxRank: 3, per: 10, desc: r => `Outgoing Footing damage is increased ${r * 10}%.` },
      { id: 'increaseFootingResistance', name: 'Increase Footing Resistance', maxRank: 3, per: 8, desc: r => `Incoming Footing damage is reduced ${r * 8}%.` },
      { id: 'increaseLungeDistance', name: 'Increase Lunge Distance', maxRank: 3, per: 12, desc: r => `Attack lunge distance is increased ${r * 12}%.` },
      { id: 'increaseAoe', name: 'Increase AoE', maxRank: 3, per: 10, desc: r => `Attack range/area is increased ${r * 10}%.` },
      { id: 'reduceStaminaUse', name: 'Reduce Stamina Use', maxRank: 3, per: 8, desc: r => `Stamina costs are reduced ${r * 8}%.` },
    ],
    alchemy: [
      { id: 'herbalist', name: 'Herbalist', maxRank: 5, per: 20, desc: r => `You can mix potions at any campfire, at ${r * 20}% of your precision level.` },
      { id: 'increasePrecision', name: 'Increase Precision', maxRank: 3, per: 3, desc: r => `Odds of brewing a specifically targeted potion are increased ${r * 3}%.` },
      { id: 'increasePotionDuration', name: 'Increase Potion Duration', maxRank: 3, per: 15, desc: r => `Timed potion/flask effects last ${r * 15}% longer.` },
      { id: 'empowerFlasks', name: 'Empower Flasks', maxRank: 2, per: 15, desc: r => `Flasks are ${r * 15}% stronger, splash ${r * 10}% wider, and each brew yields ${r === 1 ? 'double' : r === 2 ? 'triple' : 'the base'} the flasks.` },
      { id: 'empowerHealingCures', name: 'Empower Healing Potions and Cures', maxRank: 2, per: 15, desc: r => `Healing potions and cures are ${r * 15}% stronger, and each brew yields ${r === 1 ? 'double' : r === 2 ? 'triple' : 'the base'} the potions.` },
      { id: 'empowerBuffPotions', name: 'Empower Buff Potions', maxRank: 3, per: 15, desc: r => `Buff potions are ${r * 15}% stronger.` },
    ],
    foraging: [
      { id: 'survivalist', name: 'Survivalist', maxRank: 5, per: 1, desc: r => `You can cook recipes with up to ${r} ingredient${r === 1 ? '' : 's'} at any campfire.` },
      { id: 'doubleForageables', name: 'Double Forageables', maxRank: 1, per: 0, desc: () => 'Picking a wild forageable plant yields double.' },
    ],
    fishing: [
      { id: 'increaseBiteRate', name: 'Increased Bite Rate', maxRank: 3, per: 12, desc: r => `Fish bite ${r * 12}% sooner after casting.` },
      { id: 'increaseRareFishChance', name: 'Increased Chance of Rare Fish', maxRank: 3, per: 0, desc: r => `Uncommon and rare fish are noticeably more likely (rank ${r}/3).` },
      { id: 'extraHarpoonTries', name: 'Extra Harpoon Tries', maxRank: 5, per: 1, desc: r => `Gain ${r} extra harpoon ${r === 1 ? 'try' : 'tries'} before a catch escapes.` },
      { id: 'decreaseGulletDriftSpeed', name: 'Decrease Gullet Fish Drift Speed', maxRank: 3, per: 12, desc: r => `Gullet Fish drift ${r * 12}% slower.` },
      { id: 'increaseGulletSpawnRate', name: 'Increase Gullet Fish Spawn Rate', maxRank: 3, per: 35, desc: r => `Gullet Fish spawn chance is increased ${r * 35}%.` },
      { id: 'doubleCatchChance', name: 'Chance to Get Double Catches', maxRank: 3, per: 12, desc: r => `${Math.min(50, r * 12)}% chance to land two catches at once.` },
      { id: 'amphibiousFish', name: 'Amphibious Fish', maxRank: 4, per: 0, desc: r => `Reeling in a catch only costs ${[80, 60, 40, 20][Math.min(3, r - 1)]}% as much Footing.` },
    ],
  };

  let deps = null;
  const ranks = { combat: {}, alchemy: {}, foraging: {}, fishing: {} }; // skillKey -> perkId -> rank

  function init(injectedDeps = {}) { deps = injectedDeps; render(); }

  function findPerk(skillKey, perkId) { return (TREES[skillKey] || []).find(p => p.id === perkId) || null; }

  function rank(skillKey, perkId) { return ranks[skillKey]?.[perkId] || 0; }

  function pointsEarned(skillKey) { return (window.SkillSystem?.level?.(skillKey) || 0) * POINTS_PER_LEVEL; }

  function pointsSpent(skillKey) { return Object.values(ranks[skillKey] || {}).reduce((sum, r) => sum + r, 0); }

  function pointsAvailable(skillKey) { return Math.max(0, pointsEarned(skillKey) - pointsSpent(skillKey)); }

  function increase(skillKey, perkId) {
    const perk = findPerk(skillKey, perkId);
    if (!perk || pointsAvailable(skillKey) <= 0 || rank(skillKey, perkId) >= perk.maxRank) return false;
    ranks[skillKey][perkId] = rank(skillKey, perkId) + 1;
    persist();
    render();
    return true;
  }

  function decrease(skillKey, perkId) {
    if (rank(skillKey, perkId) <= 0) return false;
    ranks[skillKey][perkId] -= 1;
    persist();
    render();
    return true;
  }

  function resetTree(skillKey) {
    if (!ranks[skillKey]) return;
    ranks[skillKey] = {};
    persist();
    render();
  }

  // ── Combat helper consumed directly by game.js's damageCreature ──────
  function combatDamageMultiplier(dmgOpts = {}) {
    let mul = 1 + rank('combat', 'empowerRawDamage') * 0.05;
    if (dmgOpts?.category === 'quickAttack') mul *= 1 + rank('combat', 'empowerQuickAttacks') * 0.08;
    if (dmgOpts?.category === 'defensiveHold') mul *= 1 + rank('combat', 'empowerDefensiveAttacks') * 0.08;
    if (dmgOpts?.heavy) mul *= 1 + rank('combat', 'empowerHeavyAttacks') * 0.08;
    return mul;
  }

  // ── Save/load — perks are character-scoped, same as skill levels/XP ──
  function persist() { deps?.savePerkProgress?.(serialize()); }

  function serialize() { return JSON.parse(JSON.stringify(ranks)); }

  function restore(playerData = {}) {
    const saved = playerData.perkRanks && typeof playerData.perkRanks === 'object' ? playerData.perkRanks : {};
    for (const skillKey of Object.keys(TREES)) {
      ranks[skillKey] = {};
      const savedSkill = saved[skillKey] && typeof saved[skillKey] === 'object' ? saved[skillKey] : {};
      TREES[skillKey].forEach(perk => {
        const value = Math.max(0, Math.min(perk.maxRank, Math.floor(Number(savedSkill[perk.id]) || 0)));
        if (value > 0) ranks[skillKey][perk.id] = value;
      });
    }
    render(); // Not persisted here — the caller's own load already has the authoritative save.
  }

  // ── UI ─────────────────────────────────────────────────────────────
  const TREE_META = {
    combat: { label: 'Combat', icon: '⚔️' },
    alchemy: { label: 'Alchemy', icon: '⚗️' },
    foraging: { label: 'Foraging', icon: '🌿' },
    fishing: { label: 'Fishing', icon: '🎣' },
  };
  const openTrees = new Set();

  function render() {
    const container = document.getElementById('perkTrees');
    if (!container) return;
    container.innerHTML = Object.keys(TREES).map(skillKey => {
      const meta = TREE_META[skillKey];
      const earned = pointsEarned(skillKey), spent = pointsSpent(skillKey), available = pointsAvailable(skillKey);
      const isOpen = openTrees.has(skillKey);
      const rows = TREES[skillKey].map(perk => {
        const current = rank(skillKey, perk.id);
        const maxed = current >= perk.maxRank;
        return `<div class="perk-row${maxed ? ' maxed' : ''}" data-perk="${perk.id}">
          <div class="perk-copy"><div class="perk-name">${perk.name}</div><div class="perk-desc">${current > 0 ? perk.desc(current) : `Rank 1: ${perk.desc(1)}`}</div></div>
          <button type="button" class="perk-btn" data-perk-action="dec" data-skill="${skillKey}" data-perk-id="${perk.id}" ${current <= 0 ? 'disabled' : ''}>−</button>
          <span class="perk-rank">${current}/${perk.maxRank}</span>
          <button type="button" class="perk-btn" data-perk-action="inc" data-skill="${skillKey}" data-perk-id="${perk.id}" ${(maxed || available <= 0) ? 'disabled' : ''}>+</button>
        </div>`;
      }).join('');
      return `<div class="perk-tree${isOpen ? ' open' : ''}" data-tree="${skillKey}">
        <button type="button" class="perk-tree-head" data-perk-toggle="${skillKey}">
          <span class="skill-icon">${meta.icon}</span>
          <span class="perk-tree-title">${meta.label} Perks</span>
          <span class="perk-tree-points">${available} pt${available === 1 ? '' : 's'} available (${spent}/${earned} spent)</span>
          <span class="perk-tree-caret">▶</span>
        </button>
        <div class="perk-tree-body">${rows}<button type="button" class="perk-tree-reset" data-perk-reset="${skillKey}">Reset ${meta.label} perks</button></div>
      </div>`;
    }).join('');
    container.querySelectorAll('[data-perk-toggle]').forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.perkToggle;
      openTrees.has(key) ? openTrees.delete(key) : openTrees.add(key);
      render();
    }));
    container.querySelectorAll('[data-perk-action]').forEach(button => button.addEventListener('click', () => {
      const { perkAction, skill, perkId } = button.dataset;
      if (perkAction === 'inc') increase(skill, perkId); else decrease(skill, perkId);
    }));
    container.querySelectorAll('[data-perk-reset]').forEach(button => button.addEventListener('click', () => resetTree(button.dataset.perkReset)));
  }

  window.PerkSystem = {
    TREES,
    init, restore, serialize,
    rank, pointsEarned, pointsSpent, pointsAvailable,
    increase, decrease, resetTree,
    combatDamageMultiplier,
    render,
  };
})();
