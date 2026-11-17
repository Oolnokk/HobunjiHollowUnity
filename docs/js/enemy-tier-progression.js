// Shared eight-step humanoid danger progression. Existing role-specific combat stays in CombatBandit.
(function (global) {
  'use strict';

  const MAX_TIER = 7; // Used by wilderness camps, bounty ratings, editor/arena selection, and shared humanoid combat.
  const DANGER_LABELS = Object.freeze(['Petty', 'Brazen', 'Notorious', 'Ruthless', 'Hardened', 'Deadly', 'Infamous', 'Dreaded']); // Eight distinct displayed camp/bounty dangers.
  const TIER_STEP_DIVISOR = 2; // Two danger tiers per new mastery rank, weapon-metal advance, and reinforcement grade.

  function clampTier(value) {
    const parsed = Number(value); // Sanitizes saved and editor-provided tier values before combat multipliers.
    return Number.isFinite(parsed) ? Math.max(0, Math.min(MAX_TIER, Math.floor(parsed))) : 0;
  }
  function progressionStep(tier) { return Math.floor(clampTier(tier) / TIER_STEP_DIVISOR); }
  function dangerBand(tier) { return clampTier(tier) <= 3 ? 'easy' : 'hard'; }
  function weaponMultiplier(metalKey, tier, metalDefs, orderedMetalKeys) {
    const metalIndex = orderedMetalKeys?.indexOf?.(metalKey) ?? -1; // Weapon's actual metal still determines its place within the six-metal progression.
    if (metalIndex < 0 || !metalDefs?.[metalKey]) return null;
    const gradesPerMetal = global.MetalReinforcement?.GRADES_PER_METAL; // Reuses the player's actual four-grade policy.
    if (!Number.isInteger(gradesPerMetal) || gradesPerMetal < 1) return null;
    const grade = Math.min(gradesPerMetal - 1, progressionStep(tier)); // Tier 0/1=grade I, 2/3=II, 4/5=III, 6/7=IV.
    return global.MetalReinforcement.multiplierAtRank(metalIndex * gradesPerMetal + grade, metalDefs, orderedMetalKeys);
  }
  global.EnemyTierProgression = Object.freeze({ MAX_TIER, DANGER_LABELS, clampTier, progressionStep, dangerBand, weaponMultiplier });
})(window);
