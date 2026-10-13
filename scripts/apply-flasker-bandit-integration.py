#!/usr/bin/env python3
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def read(rel):
    return (ROOT / rel).read_text()


def write(rel, text):
    (ROOT / rel).write_text(text)


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label, flags=0):
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one regex match, found {count}')
    return next_text


# 1) Throwing flask is a real Attack Editor tool and uses the exact shared
# hatchet/weapon spin-throw animation rather than a separate flask pose.
editor_path = 'docs/tools/attack-animation-editor/index.html'
editor = read(editor_path)
editor = replace_once(
    editor,
    "  hatchet:      { label: 'Hatchet (sweep)',       sprite: '../../assets/toolsprites/axe_hatchet.png',          animStyle: 'sweep',  usesWeaponStanceBasis: true },\n",
    "  hatchet:      { label: 'Hatchet (sweep)',       sprite: '../../assets/toolsprites/axe_hatchet.png',          animStyle: 'sweep',  usesWeaponStanceBasis: true },\n"
    "  throwingflask:{ label: 'Throwing Flask (hatchet throw)', sprite: '../../assets/objectsprites/throwing_flask.png', animStyle: 'chop', usesWeaponStanceBasis: true },\n",
    'attack editor throwing flask tool',
)
editor = replace_once(
    editor,
    "  { id: 'flask_throw', group: 'Quick / held attacks', label: 'Flask — Overhead Throw', heldAnimationKey: 'throwFlask', practical: true, toolKey: 'bottle' },",
    "  { id: 'flask_throw', group: 'Quick / held attacks', label: 'Flask — Hatchet Spin Throw', heldAnimationKey: 'throwFlask', practical: true, toolKey: 'throwingflask' },",
    'attack editor flask action',
)
write(editor_path, editor)

animations_path = 'docs/js/held-action-animations.js'
animations = read(animations_path)
animations = regex_once(
    animations,
    r"\n  const throwFlask = \{.*?\n  \};\n(?=\n  // Shared temporary throw animation)",
    "\n",
    'remove bespoke flask throw animation',
    re.S,
)
animations = replace_once(
    animations,
    "  // Fishing spears use the same arm/body path as the ordinary spinning\n",
    "  const throwFlask = weaponThrowSpin; // Throwing-flask necks are handles: every flask throw intentionally reuses the exact hatchet/dagger/Kylie spin throw.\n\n"
    "  // Fishing spears use the same arm/body path as the ordinary spinning\n",
    'alias flask to hatchet throw',
)
write(animations_path, animations)

# Shared gameplay/editor grip authority. Real alchemy stack keys normalize to
# throwingflask too, so the authored neck grip is not editor-only.
grips_path = 'docs/js/hand-tool-grips.js'
grips = read(grips_path)
grips = replace_once(
    grips,
    "      hoe: {\n",
    "      throwingflask: {\n"
    "        toolScale: 0.82, // Used by gameplay and the Attack Editor to keep the squat flask at a one-hand throwing scale.\n"
    "        primaryGrip: { position: { x: -0.04, y: -0.04, z: 0.17 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } }, // Used to put the right hand around the flask's narrow neck/handle.\n"
    "        gripMode: null,\n"
    "        secondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },\n"
    "        rangedPrimaryGrip: { position: { x: -0.04, y: -0.04, z: 0.17 }, rotationDeg: { pitch: 90, yaw: -90, roll: 0 } }, // Same neck grip is used by the hatchet-style throw.\n"
    "        rangedSecondaryGripSpan: { enabled: false, startZ: 0, endZ: 0 },\n"
    "        rangedGripMode: null,\n"
    "      },\n"
    "      hoe: {\n",
    'throwing flask grip data',
)
grips = replace_once(
    grips,
    "    if (key.includes('fishingmace') || key.includes('fishing-mace')) return 'fishingmace';\n",
    "    if (key.includes('fishingmace') || key.includes('fishing-mace')) return 'fishingmace';\n"
    "    if (key.includes('flask')) return 'throwingflask'; // Alchemy recipe stack ids and the Attack Editor tool share one neck-grip profile.\n",
    'normalize flask tool key',
)
grips = replace_once(
    grips,
    "    return key === 'fishingmace' ? 'single' : (isDualWieldWeapon(key) ? 'dual' : 'two-hand');",
    "    return (key === 'fishingmace' || key === 'throwingflask') ? 'single' : (isDualWieldWeapon(key) ? 'dual' : 'two-hand');",
    'flask one-hand mode',
)
write(grips_path, grips)

# NPC flask throws must not inherit the player's Empower Flasks perk.
alchemy_path = 'docs/js/alchemy-system.js'
alchemy = read(alchemy_path)
alchemy = replace_once(
    alchemy,
    "    factor *= empowerFactor(definition); // Empower Flasks/Healing & Cures/Buff Potions.\n",
    "    if (options.skipEmpower !== true) factor *= empowerFactor(definition); // Player-made effects keep perk scaling; NPC/environment flask hits can explicitly bypass the player's perk.\n",
    'alchemy npc perk bypass',
)
write(alchemy_path, alchemy)

# Reuse the existing deterministic flask projectile owner for Flaskers. This
# adds a source-entity launch seam but leaves player inventory consumption alone.
flasks_path = 'docs/js/alchemy-flasks.js'
flasks = read(flasks_path)
flasks = replace_once(
    flasks,
    "  let lastSfxCue = null; // Mobile-accessible proof that a decoupled sound cue fired.\n",
    "  let lastSfxCue = null; // Mobile-accessible proof that a decoupled sound cue fired.\n"
    "  let lastNpcThrow = null; // Used by mobile diagnostics to inspect the most recent infinite-use enemy/NPC flask launch.\n",
    'npc flask diagnostic state',
)
throw_from_entity = r'''  function throwFromEntity(sourceEntity, recipeId, potencyTier = 0, targetX = null, targetY = null) {
    const definition = window.AlchemySystem?.RECIPE_DEFS?.[recipeId]; // Used to reject non-flask recipes before creating any projectile state.
    if (!sourceEntity || definition?.useMode !== 'throw') return false;
    const tile = deps?.TILE || 64; // Shared gameplay-pixel to Three-unit conversion.
    const sourceX = Number(sourceEntity.x); // Used as the independent NPC throw origin instead of the player position.
    const sourceY = Number(sourceEntity.y); // Used as the independent NPC throw origin instead of the player position.
    const requestedX = Number(targetX); // Used to aim at the live combat target without touching player aim state.
    const requestedY = Number(targetY); // Used to aim at the live combat target without touching player aim state.
    if (![sourceX, sourceY, requestedX, requestedY].every(Number.isFinite)) return false;
    const dx = requestedX - sourceX; // Used to preserve direction when clamping an NPC throw to the ordinary flask range.
    const dy = requestedY - sourceY; // Used to preserve direction when clamping an NPC throw to the ordinary flask range.
    const distancePx = Math.hypot(dx, dy); // Used by both range clamping and distance-scaled flight timing.
    const maxDistancePx = MAX_THROW_RADIUS_TILES * tile; // NPC Flaskers intentionally obey the same physical throw ceiling as the player.
    const clampScale = distancePx > maxDistancePx && distancePx > 0 ? maxDistancePx / distancePx : 1; // Used to clamp without changing aim direction.
    const landingX = sourceX + dx * clampScale; // Final gameplay-pixel landing X.
    const landingY = sourceY + dy * clampScale; // Final gameplay-pixel landing Y.
    const sourceGroundY = Number(deps.getGroundY?.(sourceX, sourceY) ?? 0); // Used to launch from a readable chest/hand height above local terrain.
    const origin = { x: sourceX / tile, y: sourceGroundY + 1.05, z: sourceY / tile }; // NPC hand approximation; no player held-item transform is required.
    const target = {
      x: landingX / tile,
      y: deps.getGroundYAtWorld?.(landingX / tile, landingY / tile) ?? deps.getGroundY?.(landingX, landingY) ?? 0.05,
      z: landingY / tile,
    }; // Same terrain-aware landing representation as player throws.
    const distanceTiles = Math.hypot(target.x - origin.x, target.z - origin.z); // Used to share the player's readable flight-time curve.
    const durationS = Math.min(PROJECTILE_MAX_TRAVEL_S, Math.max(PROJECTILE_MIN_TRAVEL_S, PROJECTILE_MIN_TRAVEL_S + distanceTiles * 0.034)); // Same deterministic travel timing as player flasks.
    const safeTier = Math.max(0, Math.min(4, Math.floor(Number(potencyTier) || 0))); // Used to keep enemy potency inside the stored potion-tier range.
    projectiles.push(makeProjectile({
      itemKey: `npc_flask_${recipeId}_p${safeTier}`,
      payload: { recipeId, potencyTier: safeTier },
      definition,
      area: sourceEntity.areaId ?? deps.getCurrentArea?.(),
      sourceEntity,
      playerOwned: false,
      t: 0,
      durationS,
      distanceTiles,
      trailAccumulator: 0,
      origin,
      target,
    }));
    lastNpcThrow = { recipeId, potencyTier: safeTier, sourceId: sourceEntity.id || null, targetX: landingX, targetY: landingY, at: performance.now() }; // Mobile-safe proof of Flasker loadout use.
    emitSfx('release', { itemKey: `npc_flask_${recipeId}_p${safeTier}`, recipeId, x: origin.x, y: origin.y, z: origin.z, npc: true });
    return true;
  }

'''
flasks = replace_once(
    flasks,
    "  function impact(projectile) {\n",
    throw_from_entity + "  function impact(projectile) {\n",
    'npc flask launch function',
)
flasks = replace_once(
    flasks,
    "    const empowerFlasksRank = window.PerkSystem?.rank('alchemy', 'empowerFlasks') || 0; // Widens the splash alongside its magnitude/batch bonuses.\n",
    "    const playerOwned = projectile.playerOwned !== false; // Used to keep enemy Flaskers from borrowing the player's Empower Flasks perk.\n"
    "    const empowerFlasksRank = playerOwned ? (window.PerkSystem?.rank('alchemy', 'empowerFlasks') || 0) : 0; // Only player-owned throws widen from the player's perk.\n",
    'npc radius perk bypass',
)
flasks = replace_once(
    flasks,
    "      const result = window.AlchemySystem.applyRecipeToEntity(projectile.definition.id, window.AlchemySystem.potencyMultiplier(projectile.payload.potencyTier), entity, { splash: true, potencyTier: projectile.payload.potencyTier }); // ResourceSystem-backed gameplay resolution.\n",
    "      const result = window.AlchemySystem.applyRecipeToEntity(projectile.definition.id, window.AlchemySystem.potencyMultiplier(projectile.payload.potencyTier), entity, { splash: true, potencyTier: projectile.payload.potencyTier, skipEmpower: !playerOwned }); // ResourceSystem-backed gameplay resolution; NPC throws never inherit player perk magnitude.\n",
    'npc magnitude perk bypass',
)
flasks = replace_once(
    flasks,
    "  function diagnostics() { return { aiming: !!aimState, phase: aimState?.phase || null, itemKey: aimState?.itemKey || null, target: aimState ? { x: aimState.targetX, y: aimState.targetY } : null, shoulderRayTargeting:!!(aimState && shoulderViewActive()), projectileCount: projectiles.length, trailCount:projectileTrails.length, impactEffectCount:impactEffects.length, lastSfxCue, lastImpact }; }\n",
    "  function diagnostics() { return { aiming: !!aimState, phase: aimState?.phase || null, itemKey: aimState?.itemKey || null, target: aimState ? { x: aimState.targetX, y: aimState.targetY } : null, shoulderRayTargeting:!!(aimState && shoulderViewActive()), projectileCount: projectiles.length, trailCount:projectileTrails.length, impactEffectCount:impactEffects.length, lastNpcThrow, lastSfxCue, lastImpact }; }\n",
    'npc flask diagnostics',
)
flasks = replace_once(
    flasks,
    "  window.AlchemyFlasks = { init, beginAim, setTarget, setTargetFromVector, cancelAim, confirmThrow, primaryAction, heldActions, update, diagnostics, SFX_CUES, get aiming() { return !!aimState; }, MAX_THROW_RADIUS_TILES };\n",
    "  window.AlchemyFlasks = { init, beginAim, setTarget, setTargetFromVector, cancelAim, confirmThrow, throwFromEntity, primaryAction, heldActions, update, diagnostics, SFX_CUES, get aiming() { return !!aimState; }, MAX_THROW_RADIUS_TILES };\n",
    'export npc flask launcher',
)
write(flasks_path, flasks)

# 2) Flasker is a first-class bandit rank. It rolls two distinct authored
# throwable recipes, alternates them forever, and falls back to ordinary melee
# only when a target gets inside its minimum throwing distance.
bandit_path = 'docs/js/combat/combat-bandit.js'
bandit = read(bandit_path)
bandit = replace_once(
    bandit,
    "  const BANDIT_RANK_LABEL = { grunt: 'Bandit', lieutenant: 'Bandit Lieutenant', captain: 'Bandit Captain' };",
    "  const BANDIT_RANK_LABEL = { grunt: 'Bandit', flasker: 'Bandit Flasker', lieutenant: 'Bandit Lieutenant', captain: 'Bandit Captain' };",
    'Flasker rank label',
)
flasker_helpers = r'''  function availableBanditFlaskRecipeIds() {
    return Object.values(window.AlchemySystem?.RECIPE_DEFS || {})
      .filter(definition => definition?.useMode === 'throw')
      .map(definition => definition.id);
  }

  function rollBanditFlaskLoadout(cfg) {
    const available = availableBanditFlaskRecipeIds(); // Used to keep Flaskers automatically in sync with every authored throwable Afflict recipe.
    const requested = Math.max(1, Math.floor(Number(cfg?.flasker?.loadoutSize) || 2)); // Used to author loadout size in the existing bandit config.
    const pool = [...available]; // Per-bandit copy used for sampling without replacement.
    const picked = []; // Used by AI and corpse loot; exactly two entries with the current authored tuning when possible.
    while (picked.length < requested && pool.length) {
      const index = Math.min(pool.length - 1, Math.floor((deps?.rnd?.() ?? Math.random()) * pool.length));
      picked.push(pool.splice(index, 1)[0]);
    }
    return picked;
  }

  function banditFlaskerTuning(cfg) {
    const authored = cfg?.flasker || {}; // Single tuning authority shared by AI and corpse-loot metadata.
    return {
      loadoutSize: Math.max(1, Math.floor(Number(authored.loadoutSize) || 2)),
      minThrowRangeTiles: Math.max(0.5, Number(authored.minThrowRangeTiles) || 2.25),
      maxThrowRangeTiles: Math.max(2, Number(authored.maxThrowRangeTiles) || 10),
      throwCooldownSeconds: Math.max(0.25, Number(authored.throwCooldownSeconds) || 2.35),
      lootMinPerType: Math.max(1, Math.floor(Number(authored.lootMinPerType) || 2)),
      lootMaxPerType: Math.max(1, Math.floor(Number(authored.lootMaxPerType) || 4)),
    };
  }

  function updateBanditFlaskAI(c, dt, targetPlayer, distToPlayer) {
    if (c?.banditRank !== 'flasker') return null;
    const loadout = c.def?.banditFlaskLoadout || []; // Two recipe ids rolled once for this Flasker and never consumed by AI use.
    if (!loadout.length || !window.AlchemyFlasks?.throwFromEntity) return null;
    const tuning = c.def?.banditFlaskerTuning || banditFlaskerTuning(null); // Spawn-authored tuning survives config reloads consistently with other bandit defs.
    const towardAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x); // Used to keep the hostile facing its current flask target while winding up.
    const minRangePx = tuning.minThrowRangeTiles * deps.TILE; // Inside this range Flaskers fall back to their normal melee weapon.
    const maxRangePx = tuning.maxThrowRangeTiles * deps.TILE; // Outside this range ordinary bandit approach logic closes distance first.
    c._banditFlaskCooldownT = Math.max(0, (c._banditFlaskCooldownT || 0) - dt);

    if (c._banditFlaskWindupT > 0) {
      c.facing = towardAngle;
      c._banditFlaskWindupT = Math.max(0, c._banditFlaskWindupT - dt);
      if (c._banditFlaskWindupT <= 0) {
        const recipeId = c._banditFlaskPendingRecipeId; // Captured at windup start so alternating loadout order cannot change mid-throw.
        const launched = window.AlchemyFlasks.throwFromEntity(c, recipeId, c.def?.banditFlaskPotencyTier || 0, targetPlayer.x, targetPlayer.y);
        c._banditFlaskPendingRecipeId = null;
        c._banditFlaskCooldownT = tuning.throwCooldownSeconds;
        c.telegraphState = launched ? 'strike' : null;
      }
      return { handled: true, aimAngle: towardAngle, moving: false, flasker: true };
    }

    if (distToPlayer < minRangePx || distToPlayer > maxRangePx) return null;
    if (c._banditFlaskCooldownT > 0) {
      if (c.telegraphState === 'strike') c.telegraphState = null;
      c.facing = towardAngle;
      return { handled: true, aimAngle: towardAngle, moving: false, flasker: true };
    }

    const recipeId = loadout[c._banditFlaskIndex % loadout.length]; // Alternates the two persistent loadout types instead of randomly starving one.
    c._banditFlaskIndex = (c._banditFlaskIndex + 1) % Math.max(1, loadout.length);
    const throwAnimation = window.HeldActionAnimations?.throwFlask || window.HeldActionAnimations?.weaponThrowSpin; // Exact player/Attack-Editor hatchet throw is the timing authority.
    const windupSeconds = Math.max(0.12, Number(throwAnimation?.durationS || 1.04) * Number(throwAnimation?.windupFrac || 0.49)); // Used to give the player the same readable hatchet-style windup window.
    c._banditFlaskWindupT = windupSeconds;
    c._banditFlaskPendingRecipeId = recipeId;
    c._banditFlaskAnimationKey = 'throwFlask'; // Mobile/debug proof that Flaskers use the shared flask→hatchet animation identity.
    c.telegraphState = 'windup';
    c.facing = towardAngle;
    return { handled: true, aimAngle: towardAngle, moving: false, flasker: true };
  }

'''
bandit = replace_once(
    bandit,
    "  function makeBanditDef(cfg, rank, tier, mastery, modelWidth) {\n",
    flasker_helpers + "  function makeBanditDef(cfg, rank, tier, mastery, modelWidth) {\n",
    'Flasker helpers',
)
bandit = replace_once(
    bandit,
    "    const weapon = banditWeaponFor(cfg, rank, tier);\n    const rangedWeaponKey = banditRangedWeaponFor(cfg, rank);\n",
    "    const weapon = banditWeaponFor(cfg, rank, tier);\n"
    "    const isFlasker = rank === 'flasker'; // Used to reserve this rank's ranged role for its infinite two-flask loadout.\n"
    "    const rangedWeaponKey = isFlasker ? null : banditRangedWeaponFor(cfg, rank);\n"
    "    const banditFlaskLoadout = isFlasker ? rollBanditFlaskLoadout(cfg) : []; // Per-entity definition; uses never decrement it.\n"
    "    const flaskerTuning = isFlasker ? banditFlaskerTuning(cfg) : null; // Shared AI/loot tuning stored with this spawned hostile.\n",
    'Flasker def setup',
)
bandit = replace_once(
    bandit,
    "      rangedWeaponKey,\n      banditAbilityLoadout: banditAbilityLoadout(weapon.shapeKey, held),\n",
    "      rangedWeaponKey,\n"
    "      banditFlaskLoadout,\n"
    "      banditFlaskerTuning: flaskerTuning,\n"
    "      banditFlaskPotencyTier: isFlasker ? Math.max(0, Math.min(4, tier)) : 0, // Used for both infinite AI throws and the matching corpse drops.\n"
    "      banditAbilityLoadout: banditAbilityLoadout(weapon.shapeKey, held),\n",
    'Flasker def metadata',
)
bandit = replace_once(
    bandit,
    "    const rangedResult = window.RangedWeapons?.updateBanditAI?.(c, dt, targetPlayer, distToPlayer);\n    if (rangedResult?.handled) return rangedResult;\n",
    "    const flaskResult = updateBanditFlaskAI(c, dt, targetPlayer, distToPlayer); // Flaskers get first refusal on ranged combat before ordinary crossbow/melee logic.\n"
    "    if (flaskResult?.handled) return flaskResult;\n"
    "    const rangedResult = window.RangedWeapons?.updateBanditAI?.(c, dt, targetPlayer, distToPlayer);\n"
    "    if (rangedResult?.handled) return rangedResult;\n",
    'Flasker AI hook',
)
bandit = replace_once(
    bandit,
    "      _rangedLoaded: true, _rangedMode: false, _rangedAction: null, _rangedCooldownT: 0,\n",
    "      _rangedLoaded: true, _rangedMode: false, _rangedAction: null, _rangedCooldownT: 0,\n"
    "      _banditFlaskIndex: 0, _banditFlaskCooldownT: 0, _banditFlaskWindupT: 0, _banditFlaskPendingRecipeId: null, _banditFlaskAnimationKey: null, // Flasker infinite-loadout AI state; inert on every other rank.\n",
    'Flasker entity state',
)
bandit = replace_once(
    bandit,
    "    makeEntity: makeBanditEntity,\n",
    "    makeEntity: makeBanditEntity,\n"
    "    rollFlaskLoadout: rollBanditFlaskLoadout,\n"
    "    availableFlaskRecipeIds: availableBanditFlaskRecipeIds,\n",
    'Flasker debug/test exports',
)
write(bandit_path, bandit)

# Camp lifecycle recognizes Flaskers as ordinary supporting ranks and corpse
# interaction grants several of the exact two recipe types they used in combat.
camps_path = 'docs/js/bandit-camps.js'
camps = read(camps_path)
camps = replace_once(
    camps,
    "    if ((rec.reserveByRank.lieutenant || 0) > 0) choices.push('lieutenant');\n    if ((rec.reserveByRank.grunt || 0) > 0) choices.push('grunt');\n",
    "    if ((rec.reserveByRank.lieutenant || 0) > 0) choices.push('lieutenant');\n"
    "    if ((rec.reserveByRank.flasker || 0) > 0) choices.push('flasker');\n"
    "    if ((rec.reserveByRank.grunt || 0) > 0) choices.push('grunt');\n",
    'hydra Flasker rank',
)
camps = replace_once(
    camps,
    "      reserveByRank: { grunt: 0, lieutenant: 0, captain: 0 },\n",
    "      reserveByRank: { grunt: 0, flasker: 0, lieutenant: 0, captain: 0 },\n",
    'camp Flasker reserve',
)
camps = replace_once(
    camps,
    "    const lieutenants = (comp.lieutenantsMin ?? 1) + Math.floor(deps.rnd() * Math.max(1, (comp.lieutenantsMax ?? 2) - (comp.lieutenantsMin ?? 1) + 1));\n    rec.reserveByRank.grunt = grunts;\n    rec.reserveByRank.lieutenant = lieutenants;\n",
    "    const lieutenants = (comp.lieutenantsMin ?? 1) + Math.floor(deps.rnd() * Math.max(1, (comp.lieutenantsMax ?? 2) - (comp.lieutenantsMin ?? 1) + 1));\n"
    "    const flaskers = (comp.flaskersMin ?? 1) + Math.floor(deps.rnd() * Math.max(1, (comp.flaskersMax ?? 2) - (comp.flaskersMin ?? 1) + 1)); // Supporting Flaskers are guaranteed in ordinary camps.\n"
    "    rec.reserveByRank.grunt = grunts;\n"
    "    rec.reserveByRank.flasker = flaskers;\n"
    "    rec.reserveByRank.lieutenant = lieutenants;\n",
    'camp Flasker count',
)
camps = replace_once(
    camps,
    "            && (rec.reserveByRank.lieutenant || 0) === 0\n            && livingNonCaptains === 0));\n",
    "            && (rec.reserveByRank.lieutenant || 0) === 0\n"
    "            && (rec.reserveByRank.flasker || 0) === 0\n"
    "            && livingNonCaptains === 0));\n",
    'captain waits for Flaskers',
)
camps = replace_once(
    camps,
    "    const total = grunts + lieutenants + rec.reserveByRank.captain;\n",
    "    const total = grunts + flaskers + lieutenants + rec.reserveByRank.captain;\n",
    'camp total includes Flaskers',
)
flask_loot_helper = r'''  function grantFlaskerLoadoutLoot(c, parts) {
    if (c?.banditRank !== 'flasker') return parts;
    const recipeIds = [...new Set(c.def?.banditFlaskLoadout || [])]; // Exact two combat loadout types become the guaranteed corpse drops.
    const tuning = c.def?.banditFlaskerTuning || {}; // Spawn-time tuning keeps quantity stable even if config hot-reloads before looting.
    const minQty = Math.max(1, Math.floor(Number(tuning.lootMinPerType) || 2)); // Used to make every loadout type drop several flasks.
    const maxQty = Math.max(minQty, Math.floor(Number(tuning.lootMaxPerType) || 4)); // Upper bound for each of the two guaranteed stacks.
    for (const recipeId of recipeIds) {
      const key = window.AlchemySystem?.ensureRecipeItemDef?.(recipeId, c.def?.banditFlaskPotencyTier || 0); // Registers the ordinary inventory item before granting it.
      if (!key) continue;
      const qty = minQty + Math.floor(deps.rnd() * (maxQty - minQty + 1));
      const maxStack = Number(window.InventoryStacks?.MAX_TOTAL) || 999999;
      deps.inventory[key] = Math.min(maxStack, (Number(deps.inventory[key]) || 0) + qty);
      const label = window.AlchemySystem?.RECIPE_DEFS?.[recipeId]?.label || 'Flask';
      parts.push(`🧪 ${label}×${qty}`);
    }
    return parts;
  }

'''
camps = replace_once(
    camps,
    "  function banditWornClothingItems(roster) {\n",
    flask_loot_helper + "  function banditWornClothingItems(roster) {\n",
    'Flasker corpse loot helper',
)
camps = replace_once(
    camps,
    "        const specialAmmo = window.RangedWeapons?.rollSpecialAmmoLoot?.() || 0;\n        if (specialAmmo) parts.push(`🏹 Special Ammo×${specialAmmo}`);\n",
    "        const specialAmmo = window.RangedWeapons?.rollSpecialAmmoLoot?.() || 0;\n"
    "        if (specialAmmo) parts.push(`🏹 Special Ammo×${specialAmmo}`);\n"
    "        grantFlaskerLoadoutLoot(c, parts); // Flaskers always surrender several of both infinite combat loadout types on death.\n",
    'grant Flasker corpse flasks',
)
write(camps_path, camps)

# Data: one or two Flaskers per ordinary camp; middling toughness, melee backup,
# no crossbow roll, two persistent flasks, 2-4 of each on the corpse.
cfg_path = ROOT / 'docs/config/bandits/bandit-gang-config.json'
cfg = json.loads(cfg_path.read_text())
cfg['description'] = cfg.get('description', '').replace('bandit_grunt/bandit_lieutenant/bandit_captain', 'bandit_grunt/bandit_flasker/bandit_lieutenant/bandit_captain')
cfg['clothingPool']['fillProbabilityByRank']['flasker'] = 0.65
cfg['gangComposition']['flaskersMin'] = 1
cfg['gangComposition']['flaskersMax'] = 2
cfg['weaponMetalTierRangeByRank']['flasker'] = [1, 3]
cfg['rangedWeaponChanceByRank']['flasker'] = 0
cfg['rangedWeaponWeightsByRank']['flasker'] = {'crossbow': 0, 'scatterbow': 0}
cfg['culturalRangedWeightByRank']['flasker'] = 0
cfg['masteryBaseByRank']['flasker'] = 1
cfg['heldAbilitiesByRank']['flasker'] = 0
cfg['statWeakenMultiplierByRank']['flasker'] = 0.5
cfg['statMultiplierByRankAndTier']['flasker'] = [0.45, 0.52, 0.59, 0.66]
cfg['flasker'] = {
    '_comment': 'Flaskers roll two distinct authored throwable alchemy recipes once at spawn. AI throws do not consume this loadout; corpse loot guarantees several of the same two types.',
    'loadoutSize': 2,
    'minThrowRangeTiles': 2.25,
    'maxThrowRangeTiles': 10,
    'throwCooldownSeconds': 2.35,
    'lootMinPerType': 2,
    'lootMaxPerType': 4,
}
cfg_path.write_text(json.dumps(cfg, indent=2) + '\n')

loot_path = ROOT / 'docs/config/loot/loot-pools.json'
loot = json.loads(loot_path.read_text())
loot['pools']['bandit_flasker'] = {
    'label': 'Bandit (Flasker)',
    'note': 'Base corpse valuables. The exact two combat flask loadout types are granted separately by bandit-camps.js so death loot always matches what this Flasker was throwing.',
    'entries': [
        {'id': 'gold', 'itemKey': 'gold', 'min': 4, 'max': 12, 'chance': 1, 'conditions': {}},
        {'id': 'scrapMetal', 'itemKey': 'banditScrapMetal', 'min': 0, 'max': 2, 'chance': 1, 'conditions': {}},
    ],
}
loot_path.write_text(json.dumps(loot, indent=2) + '\n')

# Testing Arena + dodge tuning recognize the new rank.
dev_path = 'docs/js/dev-spawner.js'
dev = read(dev_path)
dev = replace_once(dev, "  const DEV_SPAWN_BANDIT_RANKS = ['grunt', 'lieutenant', 'captain'];", "  const DEV_SPAWN_BANDIT_RANKS = ['grunt', 'flasker', 'lieutenant', 'captain'];", 'dev Flasker rank')
write(dev_path, dev)

dodge_path = 'docs/js/combat/combat-enemy-dodge.js'
dodge = read(dodge_path)
dodge = replace_once(dodge, "chanceByRank: Object.freeze({ grunt: 0.34, lieutenant: 0.52, captain: 0.70 })", "chanceByRank: Object.freeze({ grunt: 0.34, flasker: 0.44, lieutenant: 0.52, captain: 0.70 })", 'Flasker dodge default')
write(dodge_path, dodge)

attack_values_path = ROOT / 'docs/config/combat/attack-values.json'
attack_values = json.loads(attack_values_path.read_text())
attack_values.setdefault('bandits', {}).setdefault('enemyDodge', {}).setdefault('chanceByRank', {})['flasker'] = 0.44
attack_values_path.write_text(json.dumps(attack_values, indent=2) + '\n')

# Execute the NPC infinite-use seam in the existing alchemy regression harness.
test_path = 'scripts/test-trait-alchemy-refactor.js'
test = read(test_path)
anchor = "assert.ok(flaskSfxCues.includes('flask_throw_release') && flaskSfxCues.includes('flask_impact'), 'release and impact must emit decoupled semantic SFX placeholders');\n"
npc_test = r'''assert.ok(flaskSfxCues.includes('flask_throw_release') && flaskSfxCues.includes('flask_impact'), 'release and impact must emit decoupled semantic SFX placeholders');
const npcSource = { id:'flasker-test', x:-128, y:0, areaId:'farm' }; // Enemy source proves throwFromEntity does not depend on player inventory.
const inventoryBeforeNpcThrow = inventory[flaskKey] || 0;
const npcPoisonBefore = R.getAffliction(victim, 'poisonedHealth');
assert.ok(window.AlchemyFlasks.throwFromEntity(npcSource, 'venomFlask', 1, 128, 0), 'NPCs can launch authored throwable recipes through the shared flask projectile owner');
window.AlchemyFlasks.update(1.2);
assert.strictEqual(inventory[flaskKey] || 0, inventoryBeforeNpcThrow, 'NPC flask throws are infinite-use and never consume the player inventory stack');
assert.ok(R.getAffliction(victim, 'poisonedHealth') > npcPoisonBefore, 'NPC flask projectiles resolve the same splash affliction gameplay');
assert.strictEqual(window.AlchemyFlasks.diagnostics().lastNpcThrow.recipeId, 'venomFlask', 'NPC throw diagnostics expose the launched loadout type');
'''
test = replace_once(test, anchor, npc_test, 'NPC flask regression')
write(test_path, test)

# Small integration guard for editor/grip/rank wiring. Runtime projectile behavior
# is covered above; this guard catches accidental removal from authored catalogs.
flasker_test = r'''#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const editor = read('docs/tools/attack-animation-editor/index.html');
const grips = read('docs/js/hand-tool-grips.js');
const animations = read('docs/js/held-action-animations.js');
const bandits = read('docs/js/combat/combat-bandit.js');
const camps = read('docs/js/bandit-camps.js');
const cfg = JSON.parse(read('docs/config/bandits/bandit-gang-config.json'));
const loot = JSON.parse(read('docs/config/loot/loot-pools.json'));

assert.match(editor, /throwingflask:\s*\{[^\n]*throwing_flask\.png/, 'Attack Editor tool catalog exposes the authored throwing flask sprite');
assert.match(editor, /id: 'flask_throw'[^\n]*heldAnimationKey: 'throwFlask'[^\n]*toolKey: 'throwingflask'/, 'Flask action selects the throwing-flask tool and shared throw animation');
assert.match(animations, /const throwFlask = weaponThrowSpin;/, 'flasks reuse the exact hatchet spin-throw animation object');
assert.match(grips, /throwingflask:\s*\{[\s\S]*?primaryGrip:[\s\S]*?z: 0\.17/, 'throwing flask has an authored neck grip');
assert.match(grips, /key\.includes\('flask'\).*return 'throwingflask'/, 'real alchemy flask item keys normalize onto the authored grip');
assert.equal(cfg.gangComposition.flaskersMin, 1);
assert.equal(cfg.gangComposition.flaskersMax, 2);
assert.equal(cfg.flasker.loadoutSize, 2, 'Flaskers always carry two distinct flask recipe types');
assert.equal(cfg.rangedWeaponChanceByRank.flasker, 0, 'Flaskers reserve their ranged role for alchemy flasks');
assert.equal(cfg.flasker.lootMinPerType, 2);
assert.ok(loot.pools.bandit_flasker, 'Flasker base corpse pool exists');
assert.match(bandits, /banditRank !== 'flasker'/, 'Bandit AI has a first-class Flasker branch');
assert.match(bandits, /throwFromEntity\(c, recipeId/, 'Flasker AI launches through the shared alchemy flask projectile system');
assert.match(camps, /grantFlaskerLoadoutLoot\(c, parts\)/, 'corpse looting grants the exact Flasker loadout types');
assert.match(camps, /reserveByRank: \{ grunt: 0, flasker: 0, lieutenant: 0, captain: 0 \}/, 'camp lifecycle tracks Flaskers beside the existing ranks');
console.log('ok: throwing flask editor grip + Flasker bandit integration');
'''
(ROOT / 'scripts/test-bandit-flasker.js').write_text(flasker_test)

print('Applied throwing-flask Attack Editor grip/animation and Flasker bandit integration.')
