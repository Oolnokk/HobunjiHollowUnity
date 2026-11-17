// Four incremental reinforcement grades per structural metal. Shared by gameplay and smith UI.
(function (global) {
  'use strict';

  const GRADES_PER_METAL = 4; // Used to expand the six-metal ladder into 24 power steps.
  const GRADE_LABELS = Object.freeze(['I', 'II', 'III', 'IV']); // Displayed by the smith for each reinforcing metal.
  const INTRA_METAL_BAR_COSTS = Object.freeze([0, 1, 2, 2]); // Bars spent on grades II-IV of one metal.
  const TRANSITION_BAR_COST = 4; // Bars spent to enter grade I of the next metal.
  const FORGE_SURCHARGE_PER_TIER = 3; // Extra bars required to forge directly in a more advanced metal.
  const MIN_REINFORCEMENT_POWER = 0.75; // Grade I copper is the intended starting weapon and work efficacy.
  const MAX_REINFORCEMENT_POWER = 1.50; // Grade IV leaded bronze is the intentionally higher endgame ceiling.
  const LEGACY_EPSILON = 1e-9; // Avoids floating-point rounding falsely granting an extra legacy step.

  function multiplierAtRank(rank, metalDefs, metalKeys) {
    const maxRank = metalKeys.length * GRADES_PER_METAL - 1; // Final grade is the original strongest metal's strength.
    if (maxRank < 1 || !metalDefs?.[metalKeys[0]] || !metalDefs?.[metalKeys[metalKeys.length - 1]]) return 1;
    const minPower = MIN_REINFORCEMENT_POWER; // Shared start for smithing, tools, and enemy-grade tuning.
    const maxPower = MAX_REINFORCEMENT_POWER; // Shared finish for every structural metal.
    return minPower + (maxPower - minPower) * Math.max(0, Math.min(maxRank, rank)) / maxRank;
  }

  function forgeBarCost(baseBars, metalKey, metalDefs) {
    const metalTier = Number(metalDefs?.[metalKey]?.tier); // Existing numbered metal hierarchy controls the high-metal forging surcharge.
    if (!Number.isInteger(metalTier) || metalTier < 1) return Infinity;
    return Math.max(0, Math.ceil(Number(baseBars) || 0)) + (metalTier - 1) * FORGE_SURCHARGE_PER_TIER;
  }

  function status(baseMetalKey, saved, metalDefs, metalKeys) {
    if (!Array.isArray(metalKeys) || !metalDefs || metalKeys.length < 2) return null;
    const baseIndex = metalKeys.indexOf(baseMetalKey); // The metal the actual item was forged from, never changed by reinforcement.
    if (baseIndex < 0) return null;
    const savedIndex = metalKeys.indexOf(saved?.metalKey);
    const savedGrade = Number(saved?.grade); // New saves store explicit grade; old saves only store metalKey.
    const hasGrade = saved != null && saved.grade != null;
    const validGrade = hasGrade && Number.isInteger(savedGrade) && savedGrade >= 0 && savedGrade < GRADES_PER_METAL;
    const maxRank = metalKeys.length * GRADES_PER_METAL - 1;

    let rank, metalIndex, grade, legacy = false, multiplier;
    if (savedIndex >= baseIndex && validGrade) {
      metalIndex = savedIndex;
      grade = savedGrade;
      rank = metalIndex * GRADES_PER_METAL + grade;
      multiplier = multiplierAtRank(rank, metalDefs, metalKeys);
    } else if ((!hasGrade && (savedIndex >= baseIndex || !saved)) || (!saved && baseIndex > 0)) {
      // Older gear used the full original power of its forged/reinforcing metal, with no grade field.
      // Keep its exact old multiplier and move to the next STRICTLY stronger step on its next upgrade.
      metalIndex = savedIndex >= baseIndex ? savedIndex : baseIndex;
      const oldTier = Number(metalDefs[metalKeys[metalIndex]]?.tier);
      multiplier = 0.85 + oldTier * 0.05;
      const minPower = multiplierAtRank(0, metalDefs, metalKeys);
      const maxPower = multiplierAtRank(maxRank, metalDefs, metalKeys);
      rank = Math.max(metalIndex * GRADES_PER_METAL, Math.min(maxRank, Math.ceil((multiplier - minPower) / (maxPower - minPower) * maxRank - LEGACY_EPSILON)));
      grade = null;
      legacy = true;
    } else {
      // A malformed or lower-tier save cannot downgrade the actual forged metal or grant free progress.
      metalIndex = baseIndex;
      grade = 0;
      rank = metalIndex * GRADES_PER_METAL;
      multiplier = multiplierAtRank(rank, metalDefs, metalKeys);
    }
    const metalKey = metalKeys[metalIndex];
    const label = metalDefs[metalKey].label + (legacy ? ' (existing strength)' : ' ' + GRADE_LABELS[grade]);
    return { metalKey, grade, rank, maxRank, multiplier, label, legacy };
  }

  function next(current, metalDefs, metalKeys) {
    if (!current || !Array.isArray(metalKeys) || !metalDefs) return null;
    const maxRank = metalKeys.length * GRADES_PER_METAL - 1;
    if (!Number.isInteger(current.rank) || current.rank < 0 || current.rank >= maxRank) return null;
    const rank = current.rank + 1; // Advancing is strictly one stage, never an arbitrary stronger metal.
    const grade = rank % GRADES_PER_METAL;
    const metalKey = metalKeys[Math.floor(rank / GRADES_PER_METAL)];
    if (!metalDefs[metalKey]) return null;
    const bars = grade === 0 ? TRANSITION_BAR_COST : INTRA_METAL_BAR_COSTS[grade];
    const gold = grade === 0 ? 30 : 15 + (grade - 1) * 5;
    return { metalKey, grade, rank, bars, gold, multiplier: multiplierAtRank(rank, metalDefs, metalKeys), label: metalDefs[metalKey].label + ' ' + GRADE_LABELS[grade] };
  }

  global.MetalReinforcement = Object.freeze({ GRADES_PER_METAL, MIN_REINFORCEMENT_POWER, MAX_REINFORCEMENT_POWER, multiplierAtRank, forgeBarCost, status, next });
})(window);
