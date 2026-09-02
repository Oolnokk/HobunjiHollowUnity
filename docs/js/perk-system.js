(() => {
  'use strict';

  // Perk trees for Combat, Alchemy, Foraging, Fishing, and Mining. Point entitlement
  // is derived from the current tree itself rather than stored as a separate
  // balance: at max skill level, a character can buy about half of that
  // tree's total purchasable ranks. The entitlement is distributed across
  // the skill's 20 levels, so adding/removing perk ranks automatically changes
  // how many points that skill awards over its level curve. Because earned
  // points are derived from current skill level, existing characters also
  // receive any newly-earned points automatically when a tree grows — no save
  // migration or one-time grant is required.
  //
  // This is intentionally a bridge while the smaller trees are built out.
  // Combat currently has 80 purchasable ranks, so its 50% target is 40 points
  // at level 20 — exactly 2 per level. The intended end state is for the other
  // trees to grow to similar breadth, naturally converging on that same pacing.
  //
  // Points are spent only within that same skill's tree — a Fishing point can
  // only buy a Fishing perk, etc. Every perk's actual gameplay effect is read
  // directly by the system it affects (combat/resource-system.js,
  // combat-progression.js, alchemy-system.js, reagent-plants.js,
  // fishing-minigame.js, fishing-events.js, cooking-system.js/game.js's
  // campfire flow, skill-system.js) via rank(skillKey, perkId) — this module
  // only owns the tree data, point/tier bookkeeping, save/load, and the UI.
  //
  // Each perk carries a `tier` (1 = most generic/broadly useful, rising to
  // the tree's most specific/niche perks). A perk in tier N> 1 can't take
  // its first rank until the player has already spent at least
  // TIER_THRESHOLDS[skillKey][N-2] points elsewhere in that same tree —
  // see canAllocateTier()/tierLocked() and TIER_THRESHOLDS below. Once
  // unlocked a perk stays allocatable even if points are later refunded
  // out of an earlier tier.
  const TEMP_TARGET_TREE_FRACTION = 0.5; // Used to derive current max-level perk entitlement from the total number of ranks that can actually be purchased.

  // Indexed by tier-2 (tier 1 is always unlocked, so it has no threshold):
  // tier 2 needs TIER_THRESHOLDS[skillKey][0] points already spent in the
  // tree, tier 3 needs [1], tier 4 (combat only) needs [2].
  const TIER_THRESHOLDS = {
    combat: [10, 20, 30],
    alchemy: [4, 7],
    foraging: [6, 10],
    fishing: [6, 12],
  };

  const TREES = {
    // Tier 1: broad survivability/power everyone wants. Tier 2: mechanical
    // modifiers (footing, range, stamina economy). Tier 3: attack-type-
    // specific empowerment. Tier 4: affliction-family-specific empowerment
    // — the most specialized, build-defining perks in the tree.
    combat: [
      { id: 'increaseHealth', name: 'Increase Health', tier: 1, maxRank: 5, desc: r => `Maximum Health is increased ${r * 8}%.` },
      { id: 'increaseStamina', name: 'Increase Stamina', tier: 1, maxRank: 5, desc: r => `Maximum Stamina is increased ${r * 8}%.` },
      { id: 'empowerRawDamage', name: 'Empower Raw Damage', tier: 1, maxRank: 5, desc: r => `All outgoing damage is increased ${r * 8}%.` },
      { id: 'increaseLootQuality', name: 'Increase Loot Quality', tier: 1, maxRank: 5, desc: r => `Meat and other combat loot is noticeably higher quality (rank ${r}/5).` },
      { id: 'reduceStaminaUse', name: 'Reduce Stamina Use', tier: 2, maxRank: 5, desc: r => `Stamina costs are reduced ${r * 8}%.` },
      { id: 'increaseFootingDamage', name: 'Increase Footing Damage', tier: 2, maxRank: 5, desc: r => `Outgoing Footing damage is increased ${r * 10}%.` },
      { id: 'increaseFootingResistance', name: 'Increase Footing Resistance', tier: 2, maxRank: 5, desc: r => `Incoming Footing damage is reduced ${r * 8}%.` },
      { id: 'increaseLungeDistance', name: 'Increase Lunge Distance', tier: 2, maxRank: 5, desc: r => `Attack lunge distance is increased ${r * 12}%.` },
      { id: 'increaseAoe', name: 'Increase AoE', tier: 2, maxRank: 5, desc: r => `Attack range/area is increased ${r * 10}%.` },
      { id: 'empowerQuickAttacks', name: 'Empower Quick Attacks', tier: 3, maxRank: 5, desc: r => `Quick Attack damage is increased ${r * 8}%.` },
      { id: 'empowerDefensiveAttacks', name: 'Empower Defensive Attacks', tier: 3, maxRank: 5, desc: r => `Defensive (Counter Shield) attack damage is increased ${r * 8}%.` },
      { id: 'empowerHeavyAttacks', name: 'Empower Heavy Attacks', tier: 3, maxRank: 5, desc: r => `Heavy attack damage is increased ${r * 8}%.` },
      { id: 'empowerControlEffects', name: 'Empower Control Effects', tier: 4, maxRank: 5, desc: r => `Control-family effects (stagger/wind) are ${r * 12}% stronger.` },
      { id: 'empowerDamageEffects', name: 'Empower Damage Effects', tier: 4, maxRank: 5, desc: r => `Damage-family effects (bleed, poison, ...) are ${r * 12}% stronger.` },
      { id: 'empowerOffensiveDebuffs', name: 'Empower Offensive Debuffs', tier: 4, maxRank: 5, desc: r => `Offensive-debuff effects are ${r * 12}% stronger.` },
      { id: 'empowerDefensiveDebuffs', name: 'Empower Defensive Debuffs', tier: 4, maxRank: 5, desc: r => `Defensive-debuff effects are ${r * 12}% stronger.` },
    ],
    // Tier 1: broad brewing reliability. Tier 2: Herbalist's new campfire
    // location unlock. Tier 3: category-specific empowerment (only touches
    // one kind of potion/flask) — the most specialized.
    alchemy: [
      { id: 'increasePrecision', name: 'Increase Precision', tier: 1, maxRank: 3, desc: r => `Odds of brewing a specifically targeted potion are increased ${r * 3}%.` },
      { id: 'increasePotionDuration', name: 'Increase Potion Duration', tier: 1, maxRank: 3, desc: r => `Timed potion/flask effects last ${r * 15}% longer.` },
      { id: 'herbalist', name: 'Herbalist', tier: 2, maxRank: 5, desc: r => `You can mix potions at any campfire, at ${r * 20}% of your precision level.` },
      { id: 'empowerFlasks', name: 'Empower Flasks', tier: 3, maxRank: 2, desc: r => `Flasks are ${r * 15}% stronger, splash ${r * 10}% wider, and each brew yields ${r === 1 ? 'double' : 'triple'} the flasks.` },
      { id: 'empowerHealingCures', name: 'Empower Healing Potions and Cures', tier: 3, maxRank: 2, desc: r => `Healing potions and cures are ${r * 15}% stronger, and each brew yields ${r === 1 ? 'double' : 'triple'} the potions.` },
      { id: 'empowerBuffPotions', name: 'Empower Buff Potions', tier: 3, maxRank: 3, desc: r => `Buff potions are ${r * 15}% stronger.` },
    ],
    // Tier 1: broad gathering improvements. Tier 2: Double Forageables'
    // strong flat proc. Tier 3: Survivalist's situational campfire-cooking
    // unlock — the most niche.
    foraging: [
      { id: 'increaseYieldChance', name: 'Increase Yield Chance', tier: 1, maxRank: 5, desc: r => `Chance of an extra herb/log per gather is increased (rank ${r}/5).` },
      { id: 'increaseForagingSpeed', name: 'Increase Foraging Speed', tier: 1, maxRank: 5, desc: r => `Axe swing speed while foraging is increased ${r * 10}%.` },
      { id: 'increaseForagingQuality', name: 'Increase Foraging Quality', tier: 1, maxRank: 5, desc: r => `Foraged wood/herb quality is noticeably higher (rank ${r}/5).` },
      { id: 'doubleForageables', name: 'Double Forageables', tier: 2, maxRank: 1, desc: () => 'Picking a wild forageable plant yields double.' },
      { id: 'survivalist', name: 'Survivalist', tier: 3, maxRank: 5, desc: r => `You can cook recipes with up to ${r} ingredient${r === 1 ? '' : 's'} at any campfire.` },
    ],
    // Tier 1: broad fishing improvements. Tier 2: reel-in mechanics. Tier 3:
    // Gullet Fish and Footing-cost specifics — the most situational.
    fishing: [
      { id: 'increaseBiteRate', name: 'Increased Bite Rate', tier: 1, maxRank: 3, desc: r => `Fish bite ${r * 12}% sooner after casting.` },
      { id: 'increaseFishQuality', name: 'Increase Fish Quality', tier: 1, maxRank: 5, desc: r => `Caught fish are noticeably higher quality (rank ${r}/5).` },
      { id: 'increaseRareFishChance', name: 'Increased Chance of Rare Fish', tier: 1, maxRank: 5, desc: r => `Uncommon and rare fish are noticeably more likely (rank ${r}/5).` },
      { id: 'extraHarpoonTries', name: 'Extra Harpoon Tries', tier: 2, maxRank: 5, desc: r => `Gain ${r} extra harpoon ${r === 1 ? 'try' : 'tries'} before a catch escapes.` },
      { id: 'doubleCatchChance', name: 'Chance to Get Double Catches', tier: 2, maxRank: 3, desc: r => `${Math.min(50, r * 12)}% chance to land two catches at once.` },
      { id: 'decreaseGulletDriftSpeed', name: 'Decrease Gullet Fish Drift Speed', tier: 3, maxRank: 3, desc: r => `Gullet Fish drift ${r * 12}% slower.` },
      { id: 'increaseGulletSpawnRate', name: 'Increase Gullet Fish Spawn Rate', tier: 3, maxRank: 3, desc: r => `Gullet Fish spawn chance is increased ${r * 35}%.` },
      { id: 'amphibiousFish', name: 'Amphibious Fish', tier: 3, maxRank: 4, desc: r => `Reeling in a catch only costs ${[80, 60, 40, 20][Math.min(3, r - 1)]}% as much Footing.` },
    ],
    mining: [
      { id: 'weakRockSense', name: 'Weak Rock Sense', tier: 1, maxRank: 5, desc: r => `Breaking a mine rock has an additional ${r * 1.5}% chance to reveal the way down.` },
      { id: 'collapsingBlows', name: 'Collapsing Blows', tier: 1, maxRank: 5, desc: r => `Killing a mine enemy has an additional ${r * 3}% chance to expose weak rock beneath it.` },
    ],
  };

  let deps = null;
  const ranks = { combat: {}, alchemy: {}, foraging: {}, fishing: {}, mining: {} }; // skillKey -> perkId -> rank

  function init(injectedDeps = {}) { deps = injectedDeps; render(); }

  function findPerk(skillKey, perkId) { return (TREES[skillKey] || []).find(p => p.id === perkId) || null; }

  function rank(skillKey, perkId) { return ranks[skillKey]?.[perkId] || 0; }

  function totalRankCapacity(skillKey) {
    return (TREES[skillKey] || []).reduce((sum, perk) => sum + Math.max(0, Math.floor(Number(perk.maxRank) || 0)), 0);
  }

  function maxPointsForSkill(skillKey) {
    return Math.ceil(totalRankCapacity(skillKey) * TEMP_TARGET_TREE_FRACTION);
  }

  function pointEntitlementAtLevel(skillKey, level) {
    const maxLevel = Math.max(1, Number(window.SkillSystem?.MAX_LEVEL) || 20); // Used to distribute this tree's current max-point entitlement across the full skill progression.
    const safeLevel = Math.max(0, Math.min(maxLevel, Math.floor(Number(level) || 0))); // Used to keep entitlement queries inside the real skill-level range.
    const maxPoints = maxPointsForSkill(skillKey); // Used so any tree-data change immediately alters both future and retroactive point entitlement.
    return Math.min(maxPoints, Math.round((safeLevel / maxLevel) * maxPoints));
  }

  function pointsEarned(skillKey) {
    return pointEntitlementAtLevel(skillKey, window.SkillSystem?.level?.(skillKey) || 0);
  }

  function pointsGrantedAtLevel(skillKey, level) {
    const safeLevel = Math.max(0, Math.floor(Number(level) || 0)); // Used to report the exact number of perk points a particular skill level contributes under the current tree shape.
    if (!safeLevel) return 0;
    return Math.max(0, pointEntitlementAtLevel(skillKey, safeLevel) - pointEntitlementAtLevel(skillKey, safeLevel - 1));
  }

  function pointsSpent(skillKey) { return Object.values(ranks[skillKey] || {}).reduce((sum, r) => sum + r, 0); }

  function pointsAvailable(skillKey) { return Math.max(0, pointsEarned(skillKey) - pointsSpent(skillKey)); }

  // A tier > 1 perk needs the tree's cumulative spent points to have
  // already reached that tier's threshold (spent anywhere in the tree —
  // typically in earlier, more generic tiers) before its first rank can be
  // bought. Tier 1 is always open.
  function tierThreshold(skillKey, tier) { return (TIER_THRESHOLDS[skillKey] || [0])[Math.max(0, tier - 2)] ?? Infinity; }

  function tierLocked(skillKey, tier) { return tier > 1 && pointsSpent(skillKey) < tierThreshold(skillKey, tier); }

  function increase(skillKey, perkId) {
    const perk = findPerk(skillKey, perkId);
    if (!perk || pointsAvailable(skillKey) <= 0 || rank(skillKey, perkId) >= perk.maxRank) return false;
    if (rank(skillKey, perkId) === 0 && tierLocked(skillKey, perk.tier)) return false;
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
    let mul = 1 + rank('combat', 'empowerRawDamage') * 0.08;
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
    mining: { label: 'Mining', icon: '⛏️' },
  };
  const openTrees = new Set();

  function render() {
    const container = document.getElementById('perkTrees');
    if (!container) return;
    container.innerHTML = Object.keys(TREES).map(skillKey => {
      const meta = TREE_META[skillKey];
      const earned = pointsEarned(skillKey), spent = pointsSpent(skillKey), available = pointsAvailable(skillKey);
      const isOpen = openTrees.has(skillKey);
      const tiers = [...new Set(TREES[skillKey].map(p => p.tier))].sort((a, b) => a - b);
      const body = tiers.map(tier => {
        const locked = tierLocked(skillKey, tier);
        const perkRows = TREES[skillKey].filter(p => p.tier === tier).map(perk => {
          const current = rank(skillKey, perk.id);
          const maxed = current >= perk.maxRank;
          const rowLocked = locked && current === 0;
          return `<div class="perk-row${maxed ? ' maxed' : ''}${rowLocked ? ' locked' : ''}" data-perk="${perk.id}">
            <div class="perk-copy"><div class="perk-name">${perk.name}</div><div class="perk-desc">${current > 0 ? perk.desc(current) : `Rank 1: ${perk.desc(1)}`}</div></div>
            <button type="button" class="perk-btn" data-perk-action="dec" data-skill="${skillKey}" data-perk-id="${perk.id}" ${current <= 0 ? 'disabled' : ''}>−</button>
            <span class="perk-rank">${current}/${perk.maxRank}</span>
            <button type="button" class="perk-btn" data-perk-action="inc" data-skill="${skillKey}" data-perk-id="${perk.id}" ${(maxed || available <= 0 || rowLocked) ? 'disabled' : ''}>+</button>
          </div>`;
        }).join('');
        const tierLabel = tier === 1 ? 'Tier 1 — Foundations' : `Tier ${tier}${locked ? ` — locked (spend ${tierThreshold(skillKey, tier)} points in this tree)` : ''}`;
        return `<div class="perk-tier${locked ? ' locked' : ''}"><div class="perk-tier-label">${tierLabel}</div>${perkRows}</div>`;
      }).join('');
      return `<div class="perk-tree${isOpen ? ' open' : ''}" data-tree="${skillKey}">
        <button type="button" class="perk-tree-head" data-perk-toggle="${skillKey}">
          <span class="skill-icon">${meta.icon}</span>
          <span class="perk-tree-title">${meta.label} Perks</span>
          <span class="perk-tree-points">${available} pt${available === 1 ? '' : 's'} available (${spent}/${earned} spent)</span>
          <span class="perk-tree-caret">▶</span>
        </button>
        <div class="perk-tree-body">${body}<button type="button" class="perk-tree-reset" data-perk-reset="${skillKey}">Reset ${meta.label} perks</button></div>
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
    rank, totalRankCapacity, maxPointsForSkill, pointEntitlementAtLevel, pointsGrantedAtLevel,
    pointsEarned, pointsSpent, pointsAvailable,
    increase, decrease, resetTree,
    combatDamageMultiplier,
    render,
  };
})();
