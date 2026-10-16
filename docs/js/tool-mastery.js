// Tool mastery ("your trusty axe/shovel/pick/spear") — extracted out of
// game.js. Each literal tool instance's own affinity, stored in
// gearInventory.toolMastery[itemKey] = { xp }. game.js calls
// window.ToolMastery.init(deps) once and keeps local aliases of the exports.
//
// Note: js/mastery-policy.js Proxy-guards gearInventory.toolMastery and
// silently drops direct positive writes once armed, so the actual qualifying
// awards (kills, harvests, treasure, dual-role tool use) go through
// window.HobunjiMasteryPolicy. The direct-write paths below are the
// pre-policy fallback.
(() => {
  'use strict';
  if (window.ToolMastery) return;

  // Cumulative XP needed to reach levels 1-5 — a tool's own affinity,
  // built up through both combat and ordinary tool use, entirely
  // separate from the Motes of Prowess spent on its abilities' upgrade
  // choices (see combat-progression.js). Placeholder tuning; easy to
  // rebalance later without touching the mechanism.
  const MASTERY_XP_THRESHOLDS = [40, 90, 150, 220, 300];
  const MASTERY_XP_PER_COMBAT_HIT = 2;
  const MASTERY_XP_PER_TOOL_USE = 1;

  let deps = null; // { getGearInventory, getEquipmentSlots, TOOL_ITEM_DEFS, saveGearInventory }

  const gear = () => deps?.getGearInventory?.() || null;
  const slots = () => deps?.getEquipmentSlots?.() || {};
  const toolDefs = () => deps?.TOOL_ITEM_DEFS || {};

  function toolMasteryXp(itemKey) {
    return gear()?.toolMastery?.[itemKey]?.xp || 0;
  }

  function toolMasteryLevel(itemKey) {
    if (!itemKey || !toolDefs()[itemKey]) return 0;
    const xp = toolMasteryXp(itemKey);
    let level = 0;
    while (level < MASTERY_XP_THRESHOLDS.length && xp >= MASTERY_XP_THRESHOLDS[level]) level++;
    return level;
  }

  function awardToolMasteryXp(itemKey, amount) {
    const gearInventory = gear();
    if (!itemKey || !toolDefs()[itemKey] || !(amount > 0) || !gearInventory) return;
    if (!gearInventory.toolMastery[itemKey]) gearInventory.toolMastery[itemKey] = { xp: 0 };
    gearInventory.toolMastery[itemKey].xp += amount;
    window.MetalArmorSystem?.awardExperience?.(amount, 'tool/weapon Mastery XP', { save: false }); // "All experience" includes tool/weapon Mastery; every equipped metal armor article receives the same event, and the shared save below persists all gains atomically.
    window.WorldPopupText?.queueReward('masteryXp', `+${amount} ${toolDefs()[itemKey].label} Mastery`);
    deps.saveGearInventory?.();
  }

  // Dev-mode-only test shortcut (see the "+1 Mastery" button in
  // selectGearTool/selectEquipSlot, gated by s_devMode) — jumps straight
  // to the XP threshold for the next level instead of adding an
  // arbitrary XP amount that might not actually cross it.
  function devBumpToolMasteryLevel(itemKey) {
    const gearInventory = gear();
    if (!itemKey || !toolDefs()[itemKey] || !gearInventory) return;
    const level = toolMasteryLevel(itemKey);
    if (level >= MASTERY_XP_THRESHOLDS.length) return; // already maxed
    const targetXp = MASTERY_XP_THRESHOLDS[level];
    if (!gearInventory.toolMastery[itemKey]) gearInventory.toolMastery[itemKey] = { xp: 0 };
    gearInventory.toolMastery[itemKey].xp = Math.max(gearInventory.toolMastery[itemKey].xp, targetXp);
    deps.saveGearInventory?.();
  }

  // Called from every weapon-tool ability's onStrike once it's actually
  // landed a hit (see combat-*.js) — grows whichever tool is currently
  // equipped as the weapon.
  function awardWeaponMasteryXp() {
    if (window.CombatTutorial?.active?.()) return; // Borrowed practice weapons cannot farm item Mastery.
    awardToolMasteryXp(slots().weapon, MASTERY_XP_PER_COMBAT_HIT);
  }

  // Called from a successful hoe/shovel/axe/pick/harpoon action —
  // ordinary tool use also builds a tool's affinity, not just combat.
  // mastery-policy.js Proxy-guards toolMastery and silently drops direct
  // writes, so go through its permitted awardToolUse (tools that double
  // as weapons only; hoe/shovel progress via harvest/treasure worth).
  function awardToolUseMasteryXp(tool) {
    const itemKey = slots()[tool];
    const policy = window.HobunjiMasteryPolicy;
    if (policy?.awardToolUse) { policy.awardToolUse(itemKey, MASTERY_XP_PER_TOOL_USE, tool); return; }
    awardToolMasteryXp(itemKey, MASTERY_XP_PER_TOOL_USE);
  }

  window.ToolMastery = {
    init(injected) { deps = injected || null; },
    MASTERY_XP_THRESHOLDS,
    MASTERY_XP_PER_COMBAT_HIT,
    MASTERY_XP_PER_TOOL_USE,
    toolMasteryXp,
    toolMasteryLevel,
    awardToolMasteryXp,
    devBumpToolMasteryLevel,
    awardWeaponMasteryXp,
    awardToolUseMasteryXp,
  };
})();
