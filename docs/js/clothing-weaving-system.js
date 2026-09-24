(() => {
  'use strict';

  if (Number(window.ClothingWeavingSystem?.version) >= 1) return;

  const VERSION = 1;
  const LIGHT_WOOL_KEY = 'lightWool'; // Used by loom recipes for low-weight cloth variants.
  const HEAVY_WOOL_KEY = 'puktukWool'; // Existing save-compatible Puktuk item key; presented in-game as Heavy Wool.
  const COMBAT_GRACE_MS = 6000; // Matches the game's quiet-period notion closely enough to limit movement burden to active combat.
  const STANDARD_WEIGHT_BY_SLOT = Object.freeze({ hat: 1, hood: 2, torso: 3, overwear: 4 }); // Baseline units for ordinary bought/looted cloth.
  const WOOL_COST_BY_SLOT = Object.freeze({ hat: 1, hood: 2, torso: 3, overwear: 4 }); // Used to price loom copies by garment coverage.
  const MATERIALS = Object.freeze({
    light: Object.freeze({ id: 'light', label: 'Light Wool', itemKey: LIGHT_WOOL_KEY, weightMul: 0.60 }),
    heavy: Object.freeze({ id: 'heavy', label: 'Heavy Wool', itemKey: HEAVY_WOOL_KEY, weightMul: 1.50 }),
  });
  const TUNING = Object.freeze({
    defensePerUnit: 0.025,
    footingResistancePerUnit: 0.035,
    dodgePenaltyPerUnit: 0.025,
    combatMovePenaltyPerUnit: 0.018,
    minDamageTakenMul: 0.45,
    minFootingTakenMul: 0.35,
    minDodgeEfficacy: 0.50,
    minCombatMoveMul: 0.65,
  }); // Central armor-weight tuning; all four tradeoffs derive only from total cloth weight.
  const CLOTHING_MARKER_KEY = '__hobunjiWovenClothing'; // Temporary bodyColors metadata passed only through avatar render data.
  const CRAFT_ID_MARKER = '#loom:'; // Makes each crafted article unique to legacy duplicate-collapsing logic.
  const CLOTHING_SLOTS = Object.freeze(['hat', 'hood', 'torso', 'overwear']);
  const PATTERN_SCALE_REFERENCE = 0.25; // Converts normalized whole-pattern scale to the pre-normalization renderer scale; 1.00 now means the old 0.25.
  const PATTERN_SCALE_MIN = 0.4; // Normalized lower clamp used by woven pattern rendering; equivalent to the old physical 0.10.
  const PATTERN_SCALE_MAX = 3.2; // Normalized upper clamp used by woven pattern rendering; equivalent to the old physical 0.80.
  const CLOTHING_WEAVING_SCRIPT_URL = (() => {
    try {
      const direct = document?.currentScript?.src;
      if (direct) return direct;
      const scripts = document?.getElementsByTagName?.('script') || [];
      for (let i = scripts.length - 1; i >= 0; i--) {
        const src = scripts[i]?.src || '';
        if (/\/js\/clothing-weaving-system\.js(?:[?#]|$)/.test(src)) return src;
      }
    } catch (_) {}
    return '';
  })(); // Captured at module evaluation so standalone tools can resolve game-root assets after document.currentScript becomes null.
  const CLOTHING_WEAVING_DOCS_BASE_URL = (() => {
    try { return CLOTHING_WEAVING_SCRIPT_URL ? new URL('../', CLOTHING_WEAVING_SCRIPT_URL).href : ''; } catch (_) { return ''; }
  })();

  let equipmentDeps = null; // Captured from EquipmentPanel.init; used for gear, inventory, saves, and player refresh.
  const AVATAR_REFRESH_RETRY_MS = 200; // Polling interval while waiting for equipmentDeps to become available.
  const AVATAR_REFRESH_RETRY_TIMEOUT_MS = 5000; // ~5s cap: generous for any plausible boot-order race, bounded so a context that never gets equipmentDeps (e.g. a tool page) can't retry forever.
  // The player's world avatar is a one-shot static bake (see refreshPlayerAvatar's
  // forceEyesOpen comment) — it is never re-rendered on its own, so a pattern
  // that finishes building async has exactly one way back onto the model:
  // this call. If equipmentDeps isn't installed yet (character creation /
  // very first avatar bake can race EquipmentPanel.init), a bare
  // `equipmentDeps?.refreshPlayerAvatar?.()` silently no-ops and the
  // fallback plain-cloth bake from _imageForTint's cache miss sticks for the
  // rest of the session, until some unrelated gear change happens to force
  // another rebuild — read by players as "the pattern is just wrong,"
  // intermittently, depending on load timing. Retry instead of giving up,
  // via the shared SceneReadyPoller (see its own header comment) rather
  // than another one-off setTimeout/retry-counter pair.
  function requestPlayerAvatarRefresh() {
    window.SceneReadyPoller.pollUntilReady(() => {
      if (!equipmentDeps?.refreshPlayerAvatar) return false;
      equipmentDeps.refreshPlayerAvatar();
      return true;
    }, AVATAR_REFRESH_RETRY_TIMEOUT_MS, AVATAR_REFRESH_RETRY_MS);
  }
  let activeClothingUid = null; // Updated before EquipmentPanel's private detail click handler runs; used to extend redye for woven gear.
  let loomOverlay = null; // Current floating loom UI root; null while closed.
  let lastError = null; // Most recent recoverable integration/rendering error for mobile diagnostics.
  let armorHooksInstalled = false; // Prevents duplicate ResourceSystem/Combat wrapping.
  let portraitHooksInstalled = false; // Prevents duplicate render/tint wrapping.
  let stylesInjected = false; // Prevents duplicate loom modal CSS.
  let wasDodging = false; // Rising-edge tracker used to apply weight to an ordinary dodge exactly once.
  let cosmeticsIndexPromise = null; // Shared fetch for cosmetic id -> JSON path lookup.
  const cosmeticConfigPromises = new Map(); // Reuses per-article cosmetic JSON fetches for pattern layer lookup.
  const patternedCanvasCache = new Map(); // Reuses expensive pattern composites across repeated portrait renders.
  const wovenIconDataUrlPromises = new Map(); // Caches fully dyed + patterned inventory sprites by their visual state; rebuilt only when dyes/weaving/species/gender change.
  const pendingPatternCanvasKeys = new Set(); // Prevents repeated async builds while a synchronous portrait frame uses the unpatterned fallback.
  let activePortraitPatternMap = null; // URL -> woven descriptor map, scoped to a player render call only.

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, Number(value) || 0));
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function resolvedPatternMeshScale(patternDef) {
    const normalizedScale = clamp(finite(patternDef?.meshScale, 1), PATTERN_SCALE_MIN, PATTERN_SCALE_MAX); // Reusable pattern's authored normalized scale: 1.00 renders at the former physical 0.25.
    const usageScaleMultiplier = clamp(finite(patternDef?.usageScaleMultiplier, 1), 0.1, 20); // Transient purpose-specific multiplier; animal paint currently uses 7–14× while reusable pattern JSON remains unchanged.
    return normalizedScale * PATTERN_SCALE_REFERENCE * usageScaleMultiplier;
  }

  function baseCosmeticId(item) {
    if (!item) return null;
    if (item.baseCosmeticId) return String(item.baseCosmeticId);
    const id = String(item.cosmeticId || '');
    const marker = id.indexOf(CRAFT_ID_MARKER);
    return marker >= 0 ? id.slice(0, marker) : id || null;
  }

  const DEFAULT_LAYER_ROLE = '__default'; // Storage key for a garment layer with no authored layerRole (most single-layer articles).

  function layerLabel(role) {
    const key = role && role !== DEFAULT_LAYER_ROLE ? role : 'Pattern';
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  function weavingEntryForRole(weaving, role) {
    return weaving?.layers?.[role || DEFAULT_LAYER_ROLE] || null; // Used by per-layer pattern lookup and the independent base/trim color-swap flag.
  }

  function weavingSwapsPatternColorsForRole(weaving, role) {
    return !!weavingEntryForRole(weaving, role)?.swapPatternColors; // Used only at garment application time; never mutates the reusable pattern definition.
  }

  // A garment's weaving data can carry one pattern per layer role (new
  // format: { layers: { <role>: { pattern, patternLibraryId?, patternLabel } } })
  // or — from before per-layer authoring existed — a single pattern applied
  // to every layer of the garment (legacy format: { pattern, ... }). Current
  // crafted/reweaved garments embed their own pattern snapshot; an optional
  // patternLibraryId is provenance only. The resolver still accepts the
  // short-lived reference-only shape so those items can be migrated while
  // their source library pattern still exists. Both formats are read here
  // so every consumer (portrait rendering, loom/redye previews, debug
  // snapshots) agrees on what "this item has a pattern" and "what pattern
  // applies to this specific layer" mean.
  function normalizePatternStack(value) {
    const raw = Array.isArray(value) ? value : (Array.isArray(value?.patterns) ? value.patterns : [value]); // Used by every woven/runtime caller so optional second-pattern data has one save-compatible normalization seam.
    return raw.filter(pattern => !!pattern && typeof pattern === 'object').slice(0, 2); // The shared compositor intentionally supports at most primary + overpass.
  }

  function forcedOverpassPatternForWeaving(weaving, role = undefined) {
    const pattern = weaving?.forcedOverpassPattern; // Runtime/NPC policy seam: intentionally outside per-layer authored data so it can replace slot 2 without touching a garment's saved stack.
    if (!pattern || typeof pattern !== 'object') return null;
    const roles = Array.isArray(weaving?.forcedOverpassRoles) ? weaving.forcedOverpassRoles.filter(Boolean).map(String) : [];
    if (role !== undefined && roles.length && !roles.includes(String(role || DEFAULT_LAYER_ROLE))) return null; // Optional role scope lets NPC uniforms stamp the poncho cloth without touching its shoulder-wrap layer.
    return pattern;
  }

  function withForcedOverpass(weaving, patterns, role = undefined) {
    const base = normalizePatternStack(patterns);
    const forced = forcedOverpassPatternForWeaving(weaving, role);
    if (!forced) return base;
    return base[0] ? [base[0], forced] : [forced]; // Preserve garment slot 1; only the scoped role's visual slot 2 is replaced, while the stored garment remains untouched.
  }

  function weavingPatternsForRole(weaving, role) {
    if (!weaving) return [];
    let patterns = [];
    if (weaving.layers) {
      const entry = weavingEntryForRole(weaving, role); // Shared entry also carries the garment-only swapPatternColors flag.
      if (entry) {
        if (Array.isArray(entry.patterns)) patterns = normalizePatternStack(entry.patterns); // Future player unlock writes this; current loom UI still writes only entry.pattern.
        else if (entry.pattern) patterns = [entry.pattern];
        else if (entry.patternLibraryId) {
          const resolved = window.PatternLibrary?.getById?.(entry.patternLibraryId) || null;
          if (resolved) patterns = [resolved];
        }
      }
      return withForcedOverpass(weaving, patterns, role); // Forced NPC overpasses can target one authored clothing layer role without changing the garment's saved patterns.
    }
    if (Array.isArray(weaving.patterns)) patterns = normalizePatternStack(weaving.patterns);
    else if (weaving.pattern) patterns = [weaving.pattern]; // Legacy save: one pattern, applied to every layer.
    return withForcedOverpass(weaving, patterns, role);
  }

  function weavingPatternForRole(weaving, role) {
    return weavingPatternsForRole(weaving, role)[0] || null; // Compatibility helper for callers/tests that still ask for only the primary pattern.
  }

  function weavingHasAnyPattern(weaving) {
    if (!weaving) return false;
    if (forcedOverpassPatternForWeaving(weaving)) return true; // Lets an NPC policy put its mark onto default/unpatterned clothing without fabricating a permanent slot-1 pattern.
    if (weaving.layers) return Object.keys(weaving.layers).some(role => weavingPatternsForRole(weaving, role).length > 0);
    return weavingPatternsForRole(weaving, null).length > 0;
  }

  function materializeWeavingLibrarySnapshots(item) {
    const layers = item?.weaving?.layers; // Mutated in place so an owned reference-only garment becomes self-contained.
    if (!layers || typeof layers !== 'object') return false;
    let changed = false; // Used to persist only when a legacy reference was actually upgraded.
    for (const entry of Object.values(layers)) {
      if (!entry || entry.pattern || !entry.patternLibraryId) continue;
      const resolved = window.PatternLibrary?.getById?.(entry.patternLibraryId); // Source motif for the short-lived reference-only save shape.
      if (!resolved) continue;
      entry.pattern = clone(resolved);
      changed = true;
    }
    return changed;
  }

  // Human-readable summary of a weaving's pattern(s) — "Custom" for a plain
  // single-layer garment (or a legacy pre-per-layer save), "Base: Custom,
  // Trim: Spiral Motif" once more than one layer actually carries a pattern.
  // Used both in the loom's own preview stats and baked into a crafted
  // item's label/description so it's identifiable after crafting instead of
  // looking indistinguishable from a plain-dyed copy of the same garment.
  function summarizeWeavingLabel(weaving) {
    if (!weavingHasAnyPattern(weaving)) return null;
    if (!weaving.layers) return 'Custom';
    const entries = Object.entries(weaving.layers).filter(([role]) => !!weavingPatternForRole(weaving, role));
    if (entries.length === 1) return entries[0][1].patternLabel || 'Custom';
    return entries.map(([role, entry]) => `${layerLabel(role)}: ${entry.patternLabel || 'Custom'}`).join(', ');
  }

  function articleLabel(item) {
    const baseId = baseCosmeticId(item);
    const configured = (window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [])
      .find(entry => entry?.id === baseId)?.label;
    return String(item?.baseLabel || configured || item?.label || baseId || 'Clothing').replace(/^Light Wool\s+|^Heavy Wool\s+/i, '');
  }

  function isCraftableCloth(itemOrBlueprint) {
    const slot = String(itemOrBlueprint?.slot || '');
    const id = String(baseCosmeticId(itemOrBlueprint) || itemOrBlueprint?.baseCosmeticId || itemOrBlueprint?.cosmeticId || '');
    if (!CLOTHING_SLOTS.includes(slot) || !id) return false;
    if (id === 'bandolier1') return false;
    if (slot === 'hat') return /(?:^|::)basic_headband$/.test(id); // Every current hat is excluded except the non-leather basic headband.
    return true;
  }

  function standardWeightFor(itemOrBlueprint) {
    return isCraftableCloth(itemOrBlueprint) ? (STANDARD_WEIGHT_BY_SLOT[itemOrBlueprint.slot] || 0) : 0;
  }

  function itemWeightUnits(item) {
    if (!isCraftableCloth(item)) return 0;
    const explicit = Number(item?.weightUnits);
    return Number.isFinite(explicit) && explicit >= 0 ? explicit : standardWeightFor(item);
  }

  function gearInventory() { return equipmentDeps?.getGearInventory?.() || null; }
  function packClothing() { return equipmentDeps?.getPackClothing?.() || []; }

  function equippedClothItems() {
    const gear = gearInventory();
    return CLOTHING_SLOTS.map(slot => gear?.clothing?.[slot]).filter(item => isCraftableCloth(item));
  }

  function totalEquippedWeight() {
    return equippedClothItems().reduce((sum, item) => sum + itemWeightUnits(item), 0);
  }

  function outfitItemsFromRoster(roster) {
    const slots = roster?.cosmeticSlots || {}; // Maps each NPC cosmetic id back to the same clothing slot used by player gear.
    return (roster?.equippedCosmetics || []).map(cosmeticId => ({ cosmeticId, slot: slots[cosmeticId] || '' }));
  }

  function totalOutfitWeight(items) {
    return (items || []).reduce((sum, item) => sum + itemWeightUnits(item), 0);
  }

  function armorStats(weight = totalEquippedWeight()) {
    const units = Math.max(0, Number(weight) || 0);
    return {
      weightUnits: Math.round(units * 100) / 100,
      defense: clamp(units * TUNING.defensePerUnit, 0, 1 - TUNING.minDamageTakenMul),
      footingResistance: clamp(units * TUNING.footingResistancePerUnit, 0, 1 - TUNING.minFootingTakenMul),
      dodgePenalty: clamp(units * TUNING.dodgePenaltyPerUnit, 0, 1 - TUNING.minDodgeEfficacy),
      combatMovePenalty: clamp(units * TUNING.combatMovePenaltyPerUnit, 0, 1 - TUNING.minCombatMoveMul),
      damageTakenMul: Math.max(TUNING.minDamageTakenMul, 1 - units * TUNING.defensePerUnit),
      footingTakenMul: Math.max(TUNING.minFootingTakenMul, 1 - units * TUNING.footingResistancePerUnit),
      dodgeEfficacy: Math.max(TUNING.minDodgeEfficacy, 1 - units * TUNING.dodgePenaltyPerUnit),
      combatMoveMul: Math.max(TUNING.minCombatMoveMul, 1 - units * TUNING.combatMovePenaltyPerUnit),
    };
  }

  function armorStatsForEntity(entity) {
    if (entity === currentPlayer()) return armorStats();
    const explicitWeight = Number(entity?.outfitWeightUnits); // Spawn-time NPC total avoids rebuilding its immutable roster every damage frame.
    if (Number.isFinite(explicitWeight) && explicitWeight >= 0) return armorStats(explicitWeight);
    return armorStats(totalOutfitWeight(outfitItemsFromRoster(entity?.rosterRecord)));
  }

  function currentPlayer() { return window.Combat?.deps?.player || window.__hobunjiFurnitureDebug?.playerState || null; }
  function combatActive(player = currentPlayer()) {
    if (!player) return false;
    const last = Math.max(finite(player.lastAttackAttemptAt, -1e12), finite(player.lastAttackReceivedAt, -1e12));
    return performance.now() - last < COMBAT_GRACE_MS;
  }

  function mounted() {
    const state = String(window.Mounts?.rideState || '');
    return state === 'mounted' || state === 'mountingUp' || state === 'mountingDown' || state === 'climbLeap';
  }

  function installArmorHooks() {
    if (armorHooksInstalled) return true;
    const RS = window.ResourceSystem;
    const Combat = window.Combat;
    if (!RS?.applyDamage || !RS?.spendFooting || !Combat?.getMovementSpeedMul || !Combat?.update) return false;

    const originalDamage = RS.applyDamage.bind(RS); // Preserves every pre-existing combat/affliction wrapper beneath armor defense.
    RS.applyDamage = function clothingWeightDamage(entity, amount, opts = {}) {
      const usesOutfitWeight = entity === window.Combat?.deps?.player || entity?._usesOutfitWeight; // Player and clothed combat NPCs share one armor calculation.
      if (usesOutfitWeight && !opts?.ignoreArmorWeight) {
        amount *= armorStatsForEntity(entity).damageTakenMul;
      }
      return originalDamage(entity, amount, opts);
    };
    RS.applyDamage.__clothingWeightArmor = true;

    const originalFooting = RS.spendFooting.bind(RS); // Preserves perk resistance and prone handling beneath cloth resistance.
    RS.spendFooting = function clothingWeightFooting(entity, amount, reason = 'hit') {
      if (entity === window.Combat?.deps?.player || entity?._usesOutfitWeight) amount *= armorStatsForEntity(entity).footingTakenMul;
      return originalFooting(entity, amount, reason);
    };
    RS.spendFooting.__clothingWeightArmor = true;

    const originalMoveMul = Combat.getMovementSpeedMul.bind(Combat); // Composes with Blink Dodge, Harlyao Terror, alchemy, and other existing speed sources.
    Combat.getMovementSpeedMul = function clothingWeightMovementMul() {
      const base = originalMoveMul();
      if (!combatActive() || mounted()) return base;
      return base * armorStats().combatMoveMul;
    };
    Combat.getMovementSpeedMul.__clothingWeightArmor = true;

    const originalUpdate = Combat.update.bind(Combat); // Existing combat frame update remains authoritative; this only adjusts a newly-started ordinary dodge.
    Combat.update = function clothingWeightCombatUpdate(dt) {
      const result = originalUpdate(dt);
      const player = window.Combat?.deps?.player;
      const dodging = !!player?.dodging;
      if (player && dodging && !wasDodging && combatActive(player)) {
        const efficacy = armorStats().dodgeEfficacy;
        if (Number.isFinite(Number(player.dodgeT))) player.dodgeT = Math.max(0, Number(player.dodgeT) * efficacy);
        const now = performance.now();
        const iframeRemaining = Math.max(0, finite(player.invulnUntil, 0) - now);
        if (iframeRemaining > 0) player.invulnUntil = now + iframeRemaining * efficacy;
        player._armorWeightDodgeEfficacy = efficacy; // Used by in-file/mobile diagnostics; cleared naturally by the next dodge overwrite.
      }
      wasDodging = dodging;
      return result;
    };
    Combat.update.__clothingWeightArmor = true;
    armorHooksInstalled = true;
    return true;
  }

  function thirdTintKey(slot) {
    return ({ hat: 'HAT_C', hood: 'HOOD_C', torso: 'TORSO_C', overwear: 'CLOTH_C' })[slot] || null;
  }

  function portraitClothingColor(color) {
    if (typeof color === 'string') return { dyeId: color }; // NPC default wardrobe colors are stored as dye-id strings; player garments already carry full color objects.
    return clone(color);
  }

  function decorateAvatarDataWithWovenItems(avatarData, items = []) {
    const out = avatarData && typeof avatarData === 'object' ? avatarData : {};
    const ids = new Set(Array.isArray(out.equippedCosmetics) ? out.equippedCosmetics : []);
    const colors = { ...(out?.appearance?.bodyColors || {}) };
    const wovenDescriptors = [];
    for (const item of (items || []).filter(Boolean)) {
      const baseId = baseCosmeticId(item);
      if (item?.baseCosmeticId && item.cosmeticId) {
        ids.delete(item.cosmeticId);
        if (baseId) ids.add(baseId);
      }
      const colorC = portraitClothingColor(item?.colorC);
      const cKey = thirdTintKey(item?.slot);
      if (cKey && colorC) colors[cKey] = colorC;
      if (baseId && weavingHasAnyPattern(item?.weaving)) {
        wovenDescriptors.push({
          uid: item.uid,
          slot: item.slot,
          baseCosmeticId: baseId,
          weaving: clone(item.weaving),
          colorA: portraitClothingColor(item.colorA), // NPC authored dye-id strings and player color objects converge before runtime swap/color resolution.
          colorB: portraitClothingColor(item.colorB),
          colorC,
        });
      }
    }
    if (wovenDescriptors.length) colors[CLOTHING_MARKER_KEY] = wovenDescriptors;
    else delete colors[CLOTHING_MARKER_KEY];
    return {
      ...out,
      equippedCosmetics: [...ids],
      appearance: { ...(out?.appearance || {}), bodyColors: colors },
    };
  }

  function uniqueCraftCosmeticId(baseId, uid) { return `${baseId}${CRAFT_ID_MARKER}${uid}`; }

  function patchEquipmentPanel(api) {
    if (!api || api.__clothingWeavingPatched) return;
    if (typeof api.init === 'function') {
      const originalInit = api.init.bind(api); // Keeps EquipmentPanel ownership of gear behavior while exposing its existing dependency bag here.
      api.init = function clothingWeavingEquipmentInit(injected, ...rest) {
        equipmentDeps = injected;
        const result = originalInit(injected, ...rest);
        learnOwnedBlueprints();
        installArmorHooks();
        return result;
      };
    }

    if (typeof api.applyGearClothingToPlayerData === 'function') {
      const originalApply = api.applyGearClothingToPlayerData.bind(api); // Existing cosmetic + A/B dye mapping remains the base behavior.
      api.applyGearClothingToPlayerData = function clothingWeavingApplyGear(playerData) {
        const out = originalApply(playerData);
        const gear = gearInventory();
        const equipped = CLOTHING_SLOTS.map(slot => gear?.clothing?.[slot]).filter(Boolean);
        return decorateAvatarDataWithWovenItems(out, equipped); // Shared with NPC wardrobe rendering so default/gifted NPC clothes use the exact same portrait marker and third-dye path as player gear.
      };
    }

    if (typeof api.buildEquipmentSlots === 'function') {
      const originalBuild = api.buildEquipmentSlots.bind(api); // Existing equipment UI builds first; annotations below only expose uid to this bridge.
      api.buildEquipmentSlots = function clothingWeavingBuildEquipment(...args) {
        const result = originalBuild(...args);
        learnOwnedBlueprints();
        annotateClothingCells();
        installArmorHooks();
        return result;
      };
    }
    api.__clothingWeavingPatched = true;
  }

  function futureGlobal(name, patch) {
    if (window[name]) patch(window[name]);
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && descriptor.configurable === false) return;
    const previousGet = descriptor?.get;
    const previousSet = descriptor?.set;
    let value = descriptor?.value;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return previousGet ? previousGet.call(window) : value; },
      set(next) {
        if (previousSet) previousSet.call(window, next); else value = next;
        patch(previousGet ? previousGet.call(window) : (previousSet ? next : value));
      },
    });
  }

  function learnOwnedBlueprints() {
    const gear = gearInventory();
    if (!gear) return [];
    const known = Array.isArray(gear.knownClothingBlueprints) ? gear.knownClothingBlueprints : (gear.knownClothingBlueprints = []); // Permanent article unlocks learned by ever obtaining eligible cloth.
    const knownIds = new Set(known.map(entry => entry?.baseCosmeticId).filter(Boolean));
    const gearCandidates = [ // Gear-owned/currently worn records persist through saveGearInventory.
      ...(gear.clothingItems || []),
      ...CLOTHING_SLOTS.map(slot => gear.clothing?.[slot]).filter(Boolean),
    ];
    const packCandidates = packClothing(); // Pack records are world-scoped and need saveMemberWorldData after migration.
    const candidates = [...gearCandidates, ...packCandidates]; // Combined only for permanent blueprint discovery.
    let gearChanged = false; // Tracks blueprint additions and pattern snapshot migrations in Gear.
    let packChanged = false; // Tracks pattern snapshot migrations in Pack clothing.
    for (const item of gearCandidates) if (materializeWeavingLibrarySnapshots(item)) gearChanged = true;
    for (const item of packCandidates) if (materializeWeavingLibrarySnapshots(item)) packChanged = true;
    for (const item of candidates) {
      const id = baseCosmeticId(item);
      if (!isCraftableCloth(item) || !id || knownIds.has(id)) continue;
      knownIds.add(id);
      known.push({
        baseCosmeticId: id,
        slot: item.slot,
        label: articleLabel(item),
        baseLabel: articleLabel(item),
        sprite: item.sprite || window.EquipmentPanel?.clothingSpriteForCosmetic?.(id) || null,
      });
      gearChanged = true;
    }
    if (gearChanged) equipmentDeps?.saveGearInventory?.();
    if (packChanged) equipmentDeps?.saveMemberWorldData?.();
    return known.filter(isCraftableCloth);
  }

  function annotateClothingCells() {
    if (typeof document === 'undefined') return;
    const gear = gearInventory();
    if (!gear) return;
    const ownedCells = [...document.querySelectorAll('.clothing-owned-slot')];
    const items = (gear.clothingItems || []).filter(Boolean);
    ownedCells.forEach((cell, index) => {
      const item = items[index];
      if (item?.uid) cell.dataset.clothingUid = item.uid;
    });
    const wornCells = [...document.querySelectorAll('.clothing-slot')].slice(0, CLOTHING_SLOTS.length);
    wornCells.forEach((cell, index) => {
      const item = gear.clothing?.[CLOTHING_SLOTS[index]];
      if (item?.uid) cell.dataset.clothingUid = item.uid;
    });
  }

  function itemByUid(uid) {
    const gear = gearInventory();
    return gear?.clothingItems?.find(item => item?.uid === uid)
      || CLOTHING_SLOTS.map(slot => gear?.clothing?.[slot]).find(item => item?.uid === uid)
      || null;
  }

  function installClothingDetailTracking() {
    if (typeof document === 'undefined' || document.documentElement.dataset.clothingWeavingDetailHook === '1') return;
    document.documentElement.dataset.clothingWeavingDetailHook = '1';
    document.addEventListener('click', event => {
      const cell = event.target?.closest?.('[data-clothing-uid]');
      if (cell?.dataset.clothingUid) activeClothingUid = cell.dataset.clothingUid;
      const redye = event.target?.closest?.('.ii-btn.redye');
      if (!redye) return;
      const item = itemByUid(activeClothingUid);
      if (!weavingHasAnyPattern(item?.weaving)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openExtendedRedyePanel(item);
    }, true);
  }

  function openExtendedRedyePanel(item) {
    window.DyeSystem?.ensureCollection?.();
    const panel = document.getElementById('dyePanel');
    const titleEl = document.getElementById('dyePanelTitle');
    const subslotsEl = document.getElementById('dyePanelSubslots');
    const groupsEl = document.getElementById('dyePanelGroups');
    const previewEl = document.getElementById('dyePanelPreview');
    if (!panel || !titleEl || !subslotsEl || !groupsEl || !previewEl) return;

    const gear = gearInventory();
    const hasSecondary = item.slot === 'hood' || item.slot === 'overwear';
    const original = { colorA: clone(item.colorA), colorB: clone(item.colorB), colorC: clone(item.colorC), label: item.label };
    let active = 'A';
    let pendingA = item.colorA?.dyeId || null;
    let pendingB = item.colorB?.dyeId || null;
    let pendingC = item.colorC?.dyeId || pendingA;
    const getPending = () => active === 'A' ? pendingA : active === 'B' ? pendingB : pendingC;
    const setPending = id => { if (active === 'A') pendingA = id; else if (active === 'B') pendingB = id; else pendingC = id; };
    const worn = () => gear?.clothing?.[item.slot]?.uid === item.uid;

    function applyPreview() {
      const dyeA = pendingA ? window.DyeSystem?.getById?.(pendingA) : null;
      const dyeB = hasSecondary && pendingB ? window.DyeSystem?.getById?.(pendingB) : null;
      const dyeC = pendingC ? window.DyeSystem?.getById?.(pendingC) : null;
      if (dyeA) item.colorA = window.DyeSystem.toClothingColor(dyeA);
      if (hasSecondary && dyeB) item.colorB = window.DyeSystem.toClothingColor(dyeB);
      if (dyeC) item.colorC = window.DyeSystem.toClothingColor(dyeC);
      previewEl.innerHTML = '';
      for (const [label, dye] of [['Primary', dyeA], ['Trim', dyeB], ['Pattern', dyeC]]) {
        if (!dye || (label === 'Trim' && !hasSecondary)) continue;
        const chip = document.createElement('span');
        chip.className = 'dye-preview-chip';
        chip.style.background = dye.hex;
        chip.title = `${label}: ${dye.label}`;
        previewEl.appendChild(chip);
      }
      const label = document.createElement('span');
      label.className = 'dye-preview-label';
      label.textContent = `${articleLabel(item)} · ${itemWeightUnits(item).toFixed(1)} weight`;
      previewEl.appendChild(label);
      patternedCanvasForItem(item).then(canvas => {
        if (!canvas || !previewEl.isConnected) return;
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.alt = 'Pattern preview';
        img.style.maxWidth = '96px';
        img.style.maxHeight = '96px';
        img.style.imageRendering = 'pixelated';
        previewEl.prepend(img);
      }).catch(() => {});
      if (worn()) equipmentDeps?.refreshPlayerAvatar?.();
    }

    function renderSubslots() {
      subslotsEl.innerHTML = '';
      const slots = [['A', 'Primary'], ...(hasSecondary ? [['B', 'Trim']] : []), ['C', 'Pattern']];
      for (const [which, label] of slots) {
        const button = document.createElement('button');
        button.className = 'dye-subslot-btn' + (active === which ? ' active' : '');
        button.textContent = label;
        button.onclick = () => { active = which; renderSubslots(); renderGroups(); };
        subslotsEl.appendChild(button);
      }
    }

    function renderGroups() {
      groupsEl.innerHTML = '';
      const groups = window.DyeSystem?.ownedByHue?.(item.articleDyeIds || []) || [];
      for (const group of groups) {
        const section = document.createElement('div');
        section.className = 'dye-hue-group';
        const heading = document.createElement('div');
        heading.className = 'dye-hue-heading';
        heading.textContent = group.label;
        section.appendChild(heading);
        const row = document.createElement('div');
        row.className = 'dye-swatch-row';
        for (const dye of group.dyes) {
          const swatch = document.createElement('button');
          swatch.className = 'dye-swatch' + (getPending() === dye.id ? ' selected' : '');
          swatch.style.background = dye.hex;
          swatch.title = dye.label;
          swatch.onclick = () => { setPending(dye.id); renderGroups(); applyPreview(); };
          row.appendChild(swatch);
        }
        section.appendChild(row);
        groupsEl.appendChild(section);
      }
    }

    function revert() {
      item.colorA = original.colorA;
      item.colorB = original.colorB;
      item.colorC = original.colorC;
      item.label = original.label;
      patternedCanvasCache.clear();
      if (worn()) equipmentDeps?.refreshPlayerAvatar?.();
    }

    titleEl.textContent = 'Redye — ' + articleLabel(item);
    renderSubslots();
    renderGroups();
    applyPreview();
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    const close = () => { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); };
    document.getElementById('dyePanelCancel').onclick = () => { revert(); close(); };
    document.getElementById('dyePanelClose').onclick = () => { revert(); close(); };
    document.getElementById('dyePanelApply').onclick = () => {
      const dyeA = window.DyeSystem?.getById?.(pendingA);
      const dyeB = hasSecondary ? window.DyeSystem?.getById?.(pendingB) : null;
      const dyeC = window.DyeSystem?.getById?.(pendingC);
      if (!dyeA || !dyeC || (hasSecondary && !dyeB)) { equipmentDeps?.showToast?.('Pick every visible dye slot first.', false); return; }
      item.colorA = window.DyeSystem.toClothingColor(dyeA);
      if (dyeB) item.colorB = window.DyeSystem.toClothingColor(dyeB);
      item.colorC = window.DyeSystem.toClothingColor(dyeC);
      item.label = `${dyeA.label}${dyeB ? ' & ' + dyeB.label : ''} ${articleLabel(item)}`;
      item.articleDyeIds = [...new Set([...(item.articleDyeIds || []), pendingA, pendingB, pendingC].filter(Boolean))];
      invalidateClothingVisualCaches();
      equipmentDeps?.saveGearInventory?.();
      if (worn()) equipmentDeps?.refreshPlayerAvatar?.();
      equipmentDeps?.showToast?.('Redyed ' + articleLabel(item) + ' (including pattern).', true);
      close();
      window.EquipmentPanel?.buildEquipmentSlots?.();
    };
  }

  function ownedGlobalDyes() {
    window.DyeSystem?.ensureCollection?.();
    return (window.DyeSystem?.getCatalog?.() || []).filter(dye => window.DyeSystem?.owns?.(dye.id));
  }

  function currentBlueprints() {
    return learnOwnedBlueprints().filter(isCraftableCloth);
  }

  function materialForReweaveItem(item) {
    return MATERIALS[item?.weaveMaterial] || MATERIALS.light; // Legacy/store clothing has no authored wool weight, so Light Wool is its neutral repair-yarn fallback.
  }

  function reweaveMaterialCost(item) {
    const fullCost = WOOL_COST_BY_SLOT[item?.slot] || 1;
    return Math.max(1, Math.ceil(fullCost / 2)); // Wool is an indivisible stack item, so odd half-costs round up instead of introducing fractional inventory counts.
  }

  function clothingColorHex(color, fallback = '#ffffff') {
    const direct = String(color?.hex || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(direct)) return direct;
    const dyeHex = String(window.DyeSystem?.getById?.(color?.dyeId)?.hex || '').trim();
    return /^#[0-9a-f]{6}$/i.test(dyeHex) ? dyeHex : fallback;
  }

  function clothingColorLabel(color) {
    return String(color?.label || window.DyeSystem?.getById?.(color?.dyeId)?.label || '').trim();
  }

  function stripWovenPatternDescription(description) {
    const text = String(description || '').trim();
    const marker = text.lastIndexOf(' Woven pattern:');
    return marker >= 0 ? text.slice(0, marker).trim() : text;
  }

  function invalidateClothingVisualCaches() {
    patternedCanvasCache.clear();
    wovenIconDataUrlPromises.clear();
  }

  function injectStyles() {
    if (stylesInjected || typeof document === 'undefined') return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .loomcraft-overlay{position:fixed;inset:0;z-index:9450;background:rgba(5,9,11,.72);display:flex;align-items:center;justify-content:center;padding:12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
      .loomcraft-panel{width:min(860px,100%);max-height:94vh;overflow:auto;background:#11191e;border:1px solid #355046;border-radius:16px;color:#eef8f5;box-shadow:0 20px 60px rgba(0,0,0,.55)}
      .loomcraft-head{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;border-bottom:1px solid rgba(255,255,255,.1)}
      .loomcraft-head h2{font-size:17px;margin:0}.loomcraft-close{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:inherit;border-radius:9px;width:32px;height:32px}
      .loomcraft-body{display:grid;grid-template-columns:minmax(240px,1fr) minmax(220px,.8fr);gap:14px;padding:14px}@media(max-width:680px){.loomcraft-body{grid-template-columns:1fr}}
      .loomcraft-card{border:1px solid #2c443c;background:rgba(255,255,255,.035);border-radius:12px;padding:11px;margin-bottom:10px}.loomcraft-card h3{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;text-transform:uppercase;letter-spacing:.4px;margin:0 0 8px;color:#b9d5cc}
      .loomcraft-behindToggle{min-height:24px;padding:3px 9px;font-size:10px;text-transform:none;letter-spacing:0;font-weight:700;border-radius:8px;border:1px solid #3a564d;background:#17232a;color:#eef8f5;cursor:pointer}.loomcraft-behindToggle.active{outline:2px solid #7fc7bc;background:#1a3432}
      .loomcraft-field{display:grid;gap:5px;margin-bottom:9px}.loomcraft-field label{font-size:11px;font-weight:800;color:#a9c0b9}.loomcraft-field select,.loomcraft-field button{min-height:38px;border-radius:9px;border:1px solid #3a564d;background:#17232a;color:#eef8f5;padding:7px 9px}
      .loomcraft-row{display:flex;gap:7px;flex-wrap:wrap}.loomcraft-row>*{flex:1 1 130px}.loomcraft-material{cursor:pointer}.loomcraft-material.active{outline:2px solid #7fc7bc;background:#1a3432}.loomcraft-note{font-size:11px;line-height:1.4;color:#9eb6ae}.loomcraft-operation{border-color:#476d61;background:#14231f}.loomcraft-preview{display:grid;place-items:center;min-height:190px;background:#0a0f12;border:1px solid #294139;border-radius:12px}.loomcraft-preview img{max-width:190px;max-height:190px;image-rendering:pixelated}.loomcraft-stats{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#cde2dc;white-space:pre-line}.loomcraft-craft{width:100%;min-height:44px;border:1px solid #70bcae;background:#173b36;color:#f2fffc;border-radius:11px;font-weight:900}.loomcraft-craft:disabled{opacity:.45}.loomcraft-pattern-actions{display:flex;gap:7px}.loomcraft-pattern-actions button{flex:1}.loomcraft-empty{padding:20px;text-align:center;color:#adc2bc}
      .loomcraft-pattern-layer{margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.06)}.loomcraft-pattern-layer:last-child{margin-bottom:0;padding-bottom:0;border-bottom:none}.loomcraft-pattern-layer>label{display:block;font-size:11px;font-weight:800;color:#a9c0b9;margin-bottom:5px}.loomcraft-pattern-layer select{width:100%;margin-bottom:7px}.loomcraft-pattern-swap{display:flex;align-items:center;gap:7px;margin:7px 0;font-size:11px;font-weight:700;color:#b8cec7}.loomcraft-pattern-swap input{accent-color:#7fc7bc}
    `;
    document.head.appendChild(style);
  }

  function closeLoom() {
    loomOverlay?.remove();
    loomOverlay = null;
  }

  function dyeOptionHtml(dyes, selectedId) {
    return dyes.map(dye => `<option value="${String(dye.id).replace(/"/g, '&quot;')}" ${dye.id === selectedId ? 'selected' : ''}>${String(dye.label)}</option>`).join('');
  }

  function patternLibraryEntries() { return window.PatternLibrary?.listAvailable?.() || []; }

  function openLoom(reweaveUid = null) {
    injectStyles();
    closeLoom();
    const blueprints = currentBlueprints();
    const reweaveItems = (gearInventory()?.clothingItems || []).filter(item => item && isCraftableCloth(item)); // Permanent Gear garments are the only reweave targets; Pack clothing remains world-scoped and untouched.
    const reweaveItem = reweaveUid ? reweaveItems.find(item => item.uid === reweaveUid) || null : null;
    const isReweave = !!reweaveItem;
    if (!isReweave && !blueprints.length) {
      equipmentDeps?.showToast?.('Obtain a cloth garment before using it as a loom template.', false);
      return false;
    }
    const dyes = ownedGlobalDyes();
    if (!dyes.length) {
      equipmentDeps?.showToast?.('No unlocked dyes are available.', false);
      return false;
    }
    const initialBlueprint = isReweave
      ? { baseCosmeticId: baseCosmeticId(reweaveItem), slot: reweaveItem.slot, label: articleLabel(reweaveItem), baseLabel: articleLabel(reweaveItem), sprite: reweaveItem.sprite || null }
      : blueprints[0]; // Reweaving edits one literal Gear instance rather than creating a new garment.
    const reweaveMaterial = isReweave ? materialForReweaveItem(reweaveItem) : null;
    const state = {
      blueprintId: initialBlueprint.baseCosmeticId, // Used by all loom controls to resolve the currently selected obtained article.
      materialId: reweaveMaterial?.id || 'light', // Crafting chooses weight; reweaving keeps the garment's existing material class.
      dyeA: reweaveItem?.colorA?.dyeId || dyes[0].id, // Reweaving preserves this channel; crafting authors it.
      dyeB: reweaveItem?.colorB?.dyeId || dyes[Math.min(1, dyes.length - 1)].id, // Reweaving preserves this channel; crafting authors it.
      dyeC: reweaveItem?.colorC?.dyeId || dyes[Math.min(2, dyes.length - 1)].id, // Pattern dye remains editable when reweaving.
      layersReady: false, // Blocks submission until the garment layers and saved weave have been initialized.
      layerRequest: 0, // Rejects stale layer loads after changing templates or reopening the loom.
      previewRevision: 0, // Rejects stale asynchronous preview renders after garment/dye/view changes.
      layers: [], // Resolved [{url, role}] for the currently selected blueprint; refreshed whenever the blueprint changes.
      layerPatterns: {}, // role -> {pattern, patternId, patternLabel, swapPatternColors}. Sticky across blueprint switches; the swap flag belongs to this garment layer, not the reusable pattern.
      reweaveSeededUid: null, // Used to hydrate existing saved patterns exactly once before the player starts editing them.
      previewView: 'front', // 'front' | 'behind' — reset to 'front' on every blueprint switch (see blueprintSelect.onchange) so a garment without behind art never gets stuck showing it.
    };

    // Every layer resolveIconLayers finds for the selected blueprint gets its
    // own pattern control — most garments have exactly one layer, in which
    // case this renders identically to the old single "Weaving pattern"
    // block. Multi-layer garments (a poncho's body + its wrap, a hood's base
    // + its trim) get one row per layer instead of one pattern stamped over
    // the whole merged silhouette.
    function weavingFromState() {
      const layers = {};
      for (const { role } of state.layers) {
        const key = role || DEFAULT_LAYER_ROLE;
        const entry = state.layerPatterns[key];
        if (!entry) continue;
        // Keep the library id as provenance, but snapshot the full pattern
        // into the literal garment so deleting/renaming the library source
        // cannot mutate an already-crafted or reweaved item.
        const pattern = entry.pattern || (entry.patternId ? window.PatternLibrary?.getById?.(entry.patternId) : null);
        if (!pattern) continue;
        const swapPatternColors = !!entry.swapPatternColors; // Stored beside this garment layer so base/trim can swap independently without changing the source pattern.
        layers[key] = {
          pattern: clone(pattern),
          ...(entry.patternId ? { patternLibraryId: entry.patternId } : {}),
          patternLabel: entry.patternLabel || 'Custom',
          ...(swapPatternColors ? { swapPatternColors: true } : {}),
        };
      }
      return Object.keys(layers).length ? { layers } : null;
    }
    const hasAnyLayerPattern = () => !!weavingFromState();
    const summarizePatterns = weaving => summarizeWeavingLabel(weaving) || 'None';

    function seedReweavePatternsFromItem() {
      if (!isReweave || state.reweaveSeededUid === reweaveItem.uid) return;
      state.layerPatterns = {};
      const savedWeaving = reweaveItem.weaving;
      if (savedWeaving) {
        for (const { role } of state.layers) {
          const key = role || DEFAULT_LAYER_ROLE;
          const stored = savedWeaving.layers
            ? weavingEntryForRole(savedWeaving, role)
            : (savedWeaving.pattern ? { pattern: savedWeaving.pattern, patternLabel: 'Custom' } : null);
          if (!stored) continue;
          const patternId = stored.patternLibraryId || '';
          state.layerPatterns[key] = {
            pattern: clone(stored.pattern || (patternId ? window.PatternLibrary?.getById?.(patternId) : null)),
            patternId,
            patternLabel: stored.patternLabel || (patternId ? window.PatternLibrary?.listAvailable?.().find(entry => entry.id === patternId)?.label : null) || 'Custom',
            swapPatternColors: !!stored.swapPatternColors,
          };
        }
      }
      state.reweaveSeededUid = reweaveItem.uid;
    }

    const overlay = document.createElement('div');
    overlay.className = 'loomcraft-overlay';
    overlay.innerHTML = `
      <div class="loomcraft-panel" role="dialog" aria-modal="true">
        <div class="loomcraft-head"><h2>🧶 Loom</h2><button class="loomcraft-close" type="button" aria-label="Close">✕</button></div>
        <div class="loomcraft-body">
          <div>
            <div class="loomcraft-card loomcraft-operation"><h3>Operation</h3><div class="loomcraft-field"><label>Craft new or reweave Gear clothing</label><select data-field="reweaveItem"><option value="">Craft new garment</option></select></div><div class="loomcraft-note">Reweaving edits the selected permanent Gear item in place. You can remove, swap, or custom-edit its woven pattern without replacing the garment.</div></div>
            <div class="loomcraft-card" data-craft-only><h3>Garment template</h3><div class="loomcraft-field"><label>Obtained cloth article</label><select data-field="blueprint"></select></div><div class="loomcraft-note">Obtaining an eligible article permanently teaches its loom template. The original article is never consumed.</div></div>
            <div class="loomcraft-card" data-craft-only><h3>Wool weight</h3><div class="loomcraft-row"><button type="button" class="loomcraft-material active" data-material="light">Light Wool</button><button type="button" class="loomcraft-material" data-material="heavy">Heavy Wool</button></div><div class="loomcraft-note" data-material-note></div></div>
            <div class="loomcraft-card"><h3>${isReweave ? 'Pattern dye' : 'Default dyes'}</h3><div class="loomcraft-field" data-primary-field><label>Primary</label><select data-field="dyeA">${dyeOptionHtml(dyes, state.dyeA)}</select></div><div class="loomcraft-field" data-trim-field><label>Trim</label><select data-field="dyeB">${dyeOptionHtml(dyes, state.dyeB)}</select></div><div class="loomcraft-field" data-pattern-dye-field><label>Pattern (third dye slot)</label><select data-field="dyeC">${dyeOptionHtml(dyes, state.dyeC)}</select></div></div>
            <div class="loomcraft-card"><h3>Weaving pattern</h3><div data-pattern-layers><span class="loomcraft-note">Loading…</span></div><div class="loomcraft-note">Uses the same saved/unlocked pattern library and authoring workflow as mastered-tool verdigris removal. Each layer's motif is baked into this crafted item; only its third dye color remains freely changeable afterward.</div></div>
          </div>
          <div><div class="loomcraft-card"><h3>Preview <button class="loomcraft-behindToggle" type="button" data-act="toggleBehindView" style="display:none">Behind view</button></h3><div class="loomcraft-preview" data-preview><span class="loomcraft-note">Loading preview…</span></div><div class="loomcraft-stats" data-stats></div></div><button class="loomcraft-craft" type="button" data-act="craft">Craft</button></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    loomOverlay = overlay;

    const blueprintSelect = overlay.querySelector('[data-field="blueprint"]');
    const reweaveSelect = overlay.querySelector('[data-field="reweaveItem"]'); // Used to choose the literal Gear instance that will be edited in place.
    const patternLayersEl = overlay.querySelector('[data-pattern-layers]');
    for (const item of reweaveItems) {
      const option = document.createElement('option');
      option.value = item.uid;
      option.textContent = `Reweave — ${articleLabel(item)}${weavingHasAnyPattern(item.weaving) ? ' (Woven)' : ''}`;
      reweaveSelect.appendChild(option);
    }
    reweaveSelect.value = isReweave ? reweaveItem.uid : '';
    overlay.querySelectorAll('[data-craft-only]').forEach(element => { element.style.display = isReweave ? 'none' : ''; });
    for (const bp of blueprints) {
      const option = document.createElement('option');
      option.value = bp.baseCosmeticId;
      option.textContent = bp.label || bp.baseLabel || bp.baseCosmeticId;
      blueprintSelect.appendChild(option);
    }

    function populatePatternSelect(select, selectedId) {
      select.innerHTML = '<option value="">None</option>';
      for (const entry of patternLibraryEntries()) {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.label;
        select.appendChild(option);
      }
      select.value = selectedId || '';
    }

    const selectedBlueprint = () => isReweave
      ? initialBlueprint
      : (blueprints.find(bp => bp.baseCosmeticId === state.blueprintId) || blueprints[0]);
    const selectedMaterial = () => isReweave ? reweaveMaterial : (MATERIALS[state.materialId] || MATERIALS.light);
    const hasSecondary = () => ['hood', 'overwear'].includes(selectedBlueprint()?.slot);
    const dyeById = id => window.DyeSystem?.getById?.(id) || dyes.find(dye => dye.id === id) || dyes[0];
    const selectedPrimaryHex = () => isReweave ? clothingColorHex(reweaveItem.colorA) : dyeById(state.dyeA)?.hex;
    const selectedSecondaryHex = () => isReweave ? clothingColorHex(reweaveItem.colorB, selectedPrimaryHex()) : (hasSecondary() ? dyeById(state.dyeB)?.hex : null);
    const selectedPatternHex = () => dyeById(state.dyeC)?.hex || clothingColorHex(reweaveItem?.colorC);

    async function openLayerPatternAuthor(role, roleKey) {
      const bp = selectedBlueprint();
      const existing = state.layerPatterns[roleKey];
      const swapPatternColors = !!existing?.swapPatternColors; // Preserved while editing the motif because the swap belongs to the garment layer outside PatternAuthoring.
      const initialPattern = await resolvedForEditing(existing?.pattern || (existing?.patternId ? window.PatternLibrary?.getById?.(existing.patternId) : null) || null);
      const supportsBehindView = await hasBehindView(bp.baseCosmeticId);
      const previewFor = view => patternData => {
        const base = weavingFromState() || { layers: {} };
        const weaving = { layers: { ...base.layers, [roleKey]: { pattern: patternData, ...(swapPatternColors ? { swapPatternColors: true } : {}) } } };
        return renderClothingLayers(bp.baseCosmeticId, { primaryHex: selectedPrimaryHex(), secondaryHex: selectedSecondaryHex(), patternHex: selectedPatternHex(), weaving, view }).then(r => r.canvas);
      };
      window.PatternAuthoring?.openEditor?.({
        title: `Weave pattern — ${bp.label || bp.baseCosmeticId}${state.layers.length > 1 ? ' — ' + layerLabel(role) : ''}`,
        motifHint: state.layers.length > 1
          ? `Draw the motif to weave onto this layer (${layerLabel(role)}). It will use the garment's third dye slot.`
          : 'Draw the motif to weave onto this garment. It will use the garment\'s third dye slot.',
        initialPattern,
        initialPatternLibraryId: existing?.patternId || null,
        offloadCustomMotif: false, // A garment owns its custom motif pixels; do not replace them with origin-local storage references.
        library: window.PatternLibrary ? {
          list: () => window.PatternLibrary.listAvailable(),
          get: id => window.PatternLibrary.getById(id),
          save: (label, patternData) => window.PatternLibrary.saveToLibrary(label, patternData),
          remove: id => window.PatternLibrary.removeSaved(id),
        } : null,
        renderPreview: previewFor('front'),
        renderPreviewBehind: supportsBehindView ? previewFor('behind') : undefined,
        onSave: async (patternData, sourceLibraryId) => {
          const patternLabel = sourceLibraryId ? (window.PatternLibrary?.listAvailable?.().find(entry => entry.id === sourceLibraryId)?.label || 'Custom') : 'Custom';
          state.layerPatterns[roleKey] = { pattern: clone(patternData), patternId: sourceLibraryId || '', patternLabel, swapPatternColors };
          await refreshPatternLayerControls(); // This seeds controls and triggers exactly one guarded preview refresh.
          return true;
        },
      });
    }

    async function refreshPatternLayerControls() {
      const request = ++state.layerRequest; // Identifies this asynchronous layer initialization.
      state.layersReady = false;
      overlay.querySelector('[data-act="craft"]').disabled = true;
      const bp = selectedBlueprint();
      let layers;
      try { layers = await resolveIconLayers(bp.baseCosmeticId); } catch (error) { lastError = String(error?.message || error); layers = []; }
      if (loomOverlay !== overlay || !patternLayersEl.isConnected || request !== state.layerRequest) return;
      if (isReweave && !layers.length) {
        patternLayersEl.textContent = 'Garment layers are unavailable. Reweaving is disabled to preserve your saved pattern.';
        return;
      }
      state.layers = layers.length ? layers : [{ url: bp.sprite || null, role: null }]; // Falls back to a single unlabeled slot so pattern authoring still works even if layer resolution comes up empty.
      seedReweavePatternsFromItem();
      patternLayersEl.innerHTML = '';
      for (const { role } of state.layers) {
        const key = role || DEFAULT_LAYER_ROLE;
        const row = document.createElement('div');
        row.className = 'loomcraft-pattern-layer';
        const label = document.createElement('label');
        label.textContent = state.layers.length > 1 ? layerLabel(role) : 'Pattern library';
        row.appendChild(label);
        const select = document.createElement('select');
        populatePatternSelect(select, state.layerPatterns[key]?.patternId);
        row.appendChild(select);
        const swapWrap = document.createElement('label'); // Holds the per-layer cloth/pattern color-swap control outside PatternAuthoring.
        swapWrap.className = 'loomcraft-pattern-swap';
        const swapCheck = document.createElement('input'); // Writes only state.layerPatterns[key].swapPatternColors; base and trim therefore remain independent.
        swapCheck.type = 'checkbox';
        swapCheck.checked = !!state.layerPatterns[key]?.swapPatternColors;
        swapCheck.disabled = !state.layerPatterns[key];
        const swapText = document.createElement('span'); // Labels which resolved garment layer this independent swap applies to.
        swapText.textContent = `Swap ${role ? layerLabel(role).toLowerCase() : 'cloth'} ↔ pattern colors`;
        swapWrap.appendChild(swapCheck);
        swapWrap.appendChild(swapText);
        row.appendChild(swapWrap);
        select.onchange = () => {
          const patternId = select.value;
          const keepSwap = !!swapCheck.checked; // Carries this garment-layer choice across library-pattern changes without touching the pattern data.
          if (!patternId) {
            delete state.layerPatterns[key];
            swapCheck.checked = false;
            swapCheck.disabled = true;
          } else {
            state.layerPatterns[key] = { pattern: clone(window.PatternLibrary?.getById?.(patternId)), patternId, patternLabel: select.selectedOptions[0]?.textContent || 'None', swapPatternColors: keepSwap };
            swapCheck.disabled = false;
          }
          refreshPreview();
        };
        swapCheck.onchange = () => {
          const entry = state.layerPatterns[key]; // Existing selected/custom pattern entry receives only the garment-specific swap flag.
          if (!entry) { swapCheck.checked = false; return; }
          entry.swapPatternColors = !!swapCheck.checked;
          refreshPreview();
        };
        const actions = document.createElement('div');
        actions.className = 'loomcraft-pattern-actions';
        const authorBtn = document.createElement('button');
        authorBtn.type = 'button';
        authorBtn.textContent = 'Author custom pattern…';
        authorBtn.onclick = () => openLayerPatternAuthor(role, key);
        actions.appendChild(authorBtn);
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Plain cloth';
        clearBtn.onclick = () => {
          delete state.layerPatterns[key];
          select.value = '';
          swapCheck.checked = false;
          swapCheck.disabled = true;
          refreshPreview();
        };
        actions.appendChild(clearBtn);
        row.appendChild(actions);
        patternLayersEl.appendChild(row);
      }
      state.layersReady = true;
      refreshPreview(); // Refresh the pattern dye controls and button only after saved patterns are seeded.
    }

    async function refreshPreview() {
      const revision = ++state.previewRevision; // Every awaited stage below validates this before committing UI.
      const bp = selectedBlueprint();
      const blueprintId = bp.baseCosmeticId; // Used to reject a render for a template that is no longer selected.
      const material = selectedMaterial();
      const weaving = weavingFromState(); // One immutable snapshot drives stats, controls, and pixels for this refresh.
      const primaryHex = selectedPrimaryHex(); // Captured before awaits so this render cannot mix dye states.
      const secondaryHex = selectedSecondaryHex(); // Captured with primaryHex for a coherent preview frame.
      const patternHex = selectedPatternHex(); // Captured with the weaving snapshot for a coherent preview frame.
      const cost = isReweave ? reweaveMaterialCost(reweaveItem) : (WOOL_COST_BY_SLOT[bp.slot] || 1);
      const owned = Number(equipmentDeps?.inventory?.[material.itemKey]) || 0;
      const weight = isReweave ? itemWeightUnits(reweaveItem) : standardWeightFor(bp) * material.weightMul;
      overlay.querySelector('[data-primary-field]').style.display = isReweave ? 'none' : '';
      overlay.querySelector('[data-trim-field]').style.display = !isReweave && hasSecondary() ? '' : 'none';
      overlay.querySelector('[data-pattern-dye-field]').style.display = weaving ? '' : 'none';
      overlay.querySelector('[data-material-note]').textContent = `${material.label}: ${owned} owned · ${cost} required${isReweave ? ' to reweave (half craft cost, rounded up)' : ''}.`;
      overlay.querySelector('[data-stats]').textContent = `Weight: ${weight.toFixed(1)} units\nDefense: +${Math.round(weight * TUNING.defensePerUnit * 100)}%\nFooting resistance: +${Math.round(weight * TUNING.footingResistancePerUnit * 100)}%\nDodge efficacy: −${Math.round(weight * TUNING.dodgePenaltyPerUnit * 100)}%\nCombat movement: −${Math.round(weight * TUNING.combatMovePenaltyPerUnit * 100)}%\nPattern: ${summarizePatterns(weaving)}`;
      const craft = overlay.querySelector('[data-act="craft"]');
      craft.textContent = isReweave ? `Reweave · ${cost} ${material.label}` : 'Craft';
      craft.disabled = !state.layersReady || owned < cost;
      const behindToggleBtn = overlay.querySelector('[data-act="toggleBehindView"]');
      const showBehindToggle = await hasBehindView(blueprintId);
      if (!loomOverlay || revision !== state.previewRevision || state.blueprintId !== blueprintId) return; // Closed or superseded while awaiting behind-view metadata.
      if (!showBehindToggle) state.previewView = 'front'; // No behind art for this garment — never leave the toggle stuck on.
      behindToggleBtn.style.display = showBehindToggle ? '' : 'none';
      behindToggleBtn.textContent = state.previewView === 'behind' ? 'Front view' : 'Behind view';
      behindToggleBtn.classList.toggle('active', state.previewView === 'behind');
      const preview = overlay.querySelector('[data-preview]');
      preview.innerHTML = '<span class="loomcraft-note">Rendering…</span>';
      try {
        const { canvas } = await renderClothingLayers(blueprintId, {
          primaryHex,
          secondaryHex,
          patternHex,
          weaving,
          view: state.previewView,
        });
        if (!loomOverlay || revision !== state.previewRevision || state.blueprintId !== blueprintId || !preview.isConnected) return;
        if (!canvas) { preview.innerHTML = '<span class="loomcraft-note">No sprite preview is mapped for this article.</span>'; return; }
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.alt = `${bp.label || bp.baseCosmeticId} loom preview${state.previewView === 'behind' ? ' (behind view)' : ''}`;
        preview.innerHTML = '';
        preview.appendChild(img);
      } catch (error) {
        if (!loomOverlay || revision !== state.previewRevision || state.blueprintId !== blueprintId || !preview.isConnected) return;
        lastError = String(error?.message || error);
        preview.innerHTML = '<span class="loomcraft-note">Preview unavailable; crafting still uses the selected settings.</span>';
      }
    }

    blueprintSelect.onchange = async () => {
      const blueprintId = blueprintSelect.value; // Used after layer resolution to ignore a superseded template selection.
      state.blueprintId = blueprintId;
      state.previewView = 'front';
      await refreshPatternLayerControls(); // Layer initialization owns the follow-up preview refresh.
      if (!loomOverlay || state.blueprintId !== blueprintId) return;
    };
    reweaveSelect.onchange = () => openLoom(reweaveSelect.value || null);
    overlay.querySelector('[data-act="toggleBehindView"]').onclick = () => {
      state.previewView = state.previewView === 'behind' ? 'front' : 'behind';
      refreshPreview();
    };
    overlay.querySelectorAll('[data-material]').forEach(button => {
      button.onclick = () => {
        state.materialId = button.dataset.material;
        overlay.querySelectorAll('[data-material]').forEach(b => b.classList.toggle('active', b === button));
        refreshPreview();
      };
    });
    for (const key of ['dyeA', 'dyeB', 'dyeC']) overlay.querySelector(`[data-field="${key}"]`).onchange = event => { state[key] = event.target.value; refreshPreview(); };
    overlay.querySelector('[data-act="craft"]').onclick = () => {
      if (loomOverlay !== overlay || !state.layersReady) return false;
      if (isReweave) reweaveFromLoom(reweaveItem, selectedMaterial(), dyeById(state.dyeC), weavingFromState());
      else craftFromLoom(state, selectedBlueprint(), selectedMaterial(), dyeById, hasSecondary(), weavingFromState());
    };
    overlay.querySelector('.loomcraft-close').onclick = closeLoom;
    overlay.addEventListener('pointerdown', event => { if (event.target === overlay) closeLoom(); });
    refreshPatternLayerControls(); // Layer initialization triggers the first guarded preview once state.layers is ready.
    return true;
  }

  function craftFromLoom(state, bp, material, dyeById, hasSecondary, weaving) {
    const gear = gearInventory();
    if (!gear || !bp || !material) return false;
    const cost = WOOL_COST_BY_SLOT[bp.slot] || 1;
    const inventory = equipmentDeps?.inventory;
    if (!inventory || Number(inventory[material.itemKey]) < cost) {
      equipmentDeps?.showToast?.(`Need ${cost} ${material.label}.`, false);
      return false;
    }
    const hasPattern = weavingHasAnyPattern(weaving);
    const dyeA = dyeById(state.dyeA);
    const dyeB = hasSecondary ? dyeById(state.dyeB) : null;
    const dyeC = hasPattern ? dyeById(state.dyeC) : null;
    if (!dyeA || (hasSecondary && !dyeB) || (hasPattern && !dyeC)) {
      equipmentDeps?.showToast?.('Choose all required dyes.', false);
      return false;
    }
    inventory[material.itemKey] -= cost;
    equipmentDeps?.clampInventoryStack?.(material.itemKey);
    const uid = 'gcloth_loom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); // Unique instance id keeps weight/pattern/dyes bound to this literal garment.
    const baseLabel = bp.label || bp.baseLabel || bp.baseCosmeticId;
    const patternSummary = summarizeWeavingLabel(weaving); // null for plain cloth.
    const weightUnits = Math.round(standardWeightFor(bp) * material.weightMul * 100) / 100;
    const entry = {
      uid,
      cosmeticId: uniqueCraftCosmeticId(bp.baseCosmeticId, uid),
      baseCosmeticId: bp.baseCosmeticId,
      slot: bp.slot,
      label: `${dyeA.label}${dyeB ? ' & ' + dyeB.label : ''} ${baseLabel}${patternSummary ? ' (Woven)' : ''}`,
      baseLabel,
      description: `Hand-loomed ${material.label.toLowerCase()} ${baseLabel.toLowerCase()}, dyed with ${dyeA.label}${dyeB ? ' and ' + dyeB.label : ''}.`
        + (patternSummary ? ` Woven pattern: ${patternSummary}.` : ''), // Otherwise a crafted copy is indistinguishable from a plain-dyed one once picked up.
      colorA: window.DyeSystem.toClothingColor(dyeA),
      colorB: dyeB ? window.DyeSystem.toClothingColor(dyeB) : null,
      colorC: dyeC ? window.DyeSystem.toClothingColor(dyeC) : null,
      articleDyeIds: [...new Set([state.dyeA, hasSecondary ? state.dyeB : null, hasPattern ? state.dyeC : null].filter(Boolean))],
      sprite: bp.sprite || window.EquipmentPanel?.clothingSpriteForCosmetic?.(bp.baseCosmeticId) || null,
      sellPrice: 0,
      weaveMaterial: material.id,
      weightUnits,
      weaving: hasPattern ? clone(weaving) : null, // { layers: { <role>: { pattern, patternLibraryId, patternLabel } } } — one pattern per layer; see weavingPatternForRole.
      craftedAt: Date.now(),
    };
    // Lands in the pack, not straight into permanent gear — the same place
    // shop-bought clothing starts (see general-store.js's buyGeneralStoreItem)
    // so a crafted garment can be held/gifted to an NPC or sold, not just worn.
    // makeClothingGearEntry (equipment-panel.js) carries baseCosmeticId/colorC/
    // weaving/weaveMaterial/weightUnits/description through once the player
    // transfers it to gear to actually wear it.
    equipmentDeps?.getPackClothing?.()?.push?.(entry);
    equipmentDeps?.saveMemberWorldData?.();
    equipmentDeps?.buildInventoryGrid?.();
    window.EquipmentPanel?.buildPackClothingSection?.();
    invalidateClothingVisualCaches();
    equipmentDeps?.showToast?.(`Wove ${material.label} ${baseLabel} (${weightUnits.toFixed(1)} weight) — added to your pack.`, true);
    openLoom();
    return true;
  }

  function reweaveFromLoom(item, material, patternDye, weaving) {
    const gear = gearInventory();
    if (!gear || !item || !material) return false;
    const cost = reweaveMaterialCost(item);
    const inventory = equipmentDeps?.inventory;
    if (!inventory || Number(inventory[material.itemKey]) < cost) {
      equipmentDeps?.showToast?.(`Need ${cost} ${material.label} to reweave this garment.`, false);
      return false;
    }
    const hasPattern = weavingHasAnyPattern(weaving);
    if (hasPattern && !patternDye) {
      equipmentDeps?.showToast?.('Choose a pattern dye first.', false);
      return false;
    }

    inventory[material.itemKey] -= cost;
    equipmentDeps?.clampInventoryStack?.(material.itemKey);
    item.weaving = hasPattern ? clone(weaving) : null;
    item.colorC = hasPattern ? window.DyeSystem.toClothingColor(patternDye) : null;
    if (hasPattern && patternDye?.id) item.articleDyeIds = [...new Set([...(item.articleDyeIds || []), patternDye.id].filter(Boolean))];

    const baseLabel = articleLabel(item);
    const primaryLabel = clothingColorLabel(item.colorA);
    const secondaryLabel = clothingColorLabel(item.colorB);
    const dyePrefix = [primaryLabel, secondaryLabel].filter(Boolean).join(' & ');
    const patternSummary = summarizeWeavingLabel(item.weaving);
    item.label = `${dyePrefix ? dyePrefix + ' ' : ''}${baseLabel}${patternSummary ? ' (Woven)' : ''}`;
    const baseDescription = stripWovenPatternDescription(item.description);
    item.description = (baseDescription || baseLabel) + (patternSummary ? ` Woven pattern: ${patternSummary}.` : '');

    invalidateClothingVisualCaches();
    equipmentDeps?.saveGearInventory?.();
    equipmentDeps?.saveMemberWorldData?.(); // Reweaving spends world-scoped wool while mutating character-scoped Gear, so both save domains must persist.
    window.EquipmentPanel?.buildEquipmentSlots?.();
    const worn = CLOTHING_SLOTS.some(slot => gear.clothing?.[slot]?.uid === item.uid);
    if (worn) equipmentDeps?.refreshPlayerAvatar?.();
    equipmentDeps?.showToast?.(`Rewove ${baseLabel} for ${cost} ${material.label}.`, true);
    openLoom(item.uid);
    return true;
  }

  function normalizeAssetPath(url) {
    let value = String(url || '').replace(/\\/g, '/').split('?')[0].split('#')[0];
    try { if (/^[a-z]+:\/\//i.test(value)) value = new URL(value).pathname; } catch (_) {}
    value = value.replace(/^\.?\//, '').replace(/^docs\//, '').replace(/^assets\//, '');
    return value;
  }

  function docsRelativeUrl(path) {
    const value = String(path || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^docs\//, '');
    if (!CLOTHING_WEAVING_DOCS_BASE_URL) return value; // Game/test fallback preserves the historical relative URL contract.
    try { return new URL(value, CLOTHING_WEAVING_DOCS_BASE_URL).href; } catch (_) { return value; }
  }

  function standaloneAssetUrl(url) {
    const value = String(url || '');
    if (/^(?:https?:|blob:|data:|\/\/)/i.test(value)) return value;
    const normalizedSlashes = value.replace(/\\/g, '/');
    const assetsAt = normalizedSlashes.indexOf('assets/');
    const docsAssetPath = assetsAt >= 0
      ? normalizedSlashes.slice(assetsAt)
      : 'assets/' + normalizeAssetPath(normalizedSlashes);
    return docsRelativeUrl(docsAssetPath); // Reconstructs docs/assets/... after normalizeAssetPath has intentionally stripped the game loadImg prefix.
  }

  async function cosmeticsIndex() {
    if (!cosmeticsIndexPromise) {
      cosmeticsIndexPromise = fetch(docsRelativeUrl('config/cosmetics/index.json')).then(response => {
        if (!response.ok) throw new Error(`Cosmetics index HTTP ${response.status}`);
        return response.json();
      });
    }
    return cosmeticsIndexPromise;
  }

  // Walks a cosmetic's whole JSON tree (every species/gender variant) looking
  // for layer image URLs, tagging each one with its nearest ancestor layer's
  // layerRole — a layer's own image/spriteStyle sub-objects don't carry
  // layerRole themselves, so it has to be inherited down through the
  // recursion rather than re-read fresh at the node that actually has
  // `.url` (that mismatch previously made the BODY/NONE skip below a no-op
  // for every layer, since the check ran one level too deep to ever see the
  // role that would have triggered it).
  function collectPatternImageUrls(value, into = new Map(), paletteLayerMap = null, inheritedRole = null) {
    if (!value || typeof value !== 'object') return into;
    const localPaletteMap = value.paletteLayerMap && typeof value.paletteLayerMap === 'object' ? value.paletteLayerMap : paletteLayerMap; // Used to avoid weaving over authored skin/tusk bypass layers.
    const role = value.layerRole || inheritedRole;
    const mappedRole = role && localPaletteMap ? localPaletteMap[role] : null; // BODY/NONE are the portrait pipeline's explicit non-cloth tint routes.
    const skipImage = mappedRole === 'BODY' || mappedRole === 'NONE' || value.paletteColorKey === 'BODY' || value.paletteColorKey === 'NONE';
    if (!skipImage && typeof value.url === 'string' && /\.(png|webp|jpe?g)(?:$|[?#])/i.test(value.url)) into.set(normalizeAssetPath(value.url), role);
    if (Array.isArray(value)) value.forEach(child => collectPatternImageUrls(child, into, localPaletteMap, role));
    else for (const child of Object.values(value)) collectPatternImageUrls(child, into, localPaletteMap, role);
    return into;
  }

  async function cosmeticConfig(cosmeticId) {
    const id = String(cosmeticId || '');
    if (!id) return null;
    if (!cosmeticConfigPromises.has(id)) {
      cosmeticConfigPromises.set(id, (async () => {
        const index = await cosmeticsIndex();
        const entry = (index?.entries || []).find(record => record?.id === id);
        if (!entry?.path) return null;
        const path = docsRelativeUrl('config/cosmetics/' + String(entry.path).replace(/^\.\//, ''));
        const response = await fetch(path);
        if (!response.ok) throw new Error(`${id} cosmetic config HTTP ${response.status}`);
        return response.json();
      })());
    }
    return cosmeticConfigPromises.get(id);
  }

  // The 3D avatar's rear-facing texture (docs/js/portrait-utils.js's
  // renderProfile with portraitView:'behind') doesn't reuse a layer's front
  // image at all for some cosmetics — e.g. a hood's face-opening trim is
  // hidden entirely, and its main shape is swapped for a dedicated
  // "-back" sprite that isn't referenced anywhere in the cosmetic's own
  // config/cosmetics/*.json (see window._pngPlaneBehindViewConfig's
  // layerReplacements). Without this, a pattern only ever showed up on the
  // front view: the behind-view sprite's URL was never in the map
  // collectPatternImageUrls built, so _imageForTint's lookup silently found
  // nothing and skipped it. window._getBehindLayerUrl is the same
  // (window-scoped, non-strict top-level script) function the real renderer
  // itself calls to pick that substitute — reused here rather than
  // duplicating its rule table, which would drift out of sync with it.
  function behindViewUrlsFor(url, baseCosmeticId) {
    const getBehindUrl = window._getBehindLayerUrl;
    if (typeof getBehindUrl !== 'function') return [];
    const group = { id: baseCosmeticId, originalId: null, hairSlot: null };
    const found = new Set();
    for (const gender of ['male', 'female']) {
      try {
        const behindUrl = getBehindUrl({ url }, group, gender);
        if (behindUrl && behindUrl !== url) found.add(normalizeAssetPath(behindUrl));
      } catch (_) { /* Best-effort — a mismatched layer/group shape just means no substitute found. */ }
    }
    return [...found];
  }

  // Precise single-gender version of the above, used to actually drive the
  // loom's "Behind view" render rather than just build the pattern-url
  // lookup map: distinguishes "no rule matched, reuse the front image" from
  // "a rule explicitly hides this layer from the back" (changed:true,
  // url:null — e.g. a hood's front-only face trim), which behindViewUrlsFor
  // can't express since it only ever collects real substitute URLs.
  function behindViewResultFor(url, baseCosmeticId, gender) {
    const getBehindUrl = window._getBehindLayerUrl;
    if (typeof getBehindUrl !== 'function') return { url, changed: false };
    const group = { id: baseCosmeticId, originalId: null, hairSlot: null };
    let behindUrl;
    try { behindUrl = getBehindUrl({ url }, group, gender); } catch (_) { return { url, changed: false }; }
    if (!behindUrl) return { url: null, changed: true };
    const normalized = normalizeAssetPath(behindUrl);
    return { url: normalized, changed: normalized !== url };
  }

  async function buildPortraitPatternMap(descriptors) {
    const map = new Map();
    for (const descriptor of descriptors || []) {
      if (!descriptor?.baseCosmeticId || !weavingHasAnyPattern(descriptor.weaving)) continue;
      try {
        const cfg = await cosmeticConfig(descriptor.baseCosmeticId);
        const paletteLayerMap = cfg?.palette?.layers && typeof cfg.palette.layers === 'object' ? cfg.palette.layers : null; // Used by runtime color swapping to choose the exact base-vs-trim dye for each sprite layer.
        for (const [url, role] of collectPatternImageUrls(cfg)) {
          const paletteKey = role && paletteLayerMap ? paletteLayerMap[role] : null; // Stored only in the transient portrait descriptor; it is not garment save data.
          const entry = { ...descriptor, role, paletteKey };
          map.set(url, entry);
          for (const behindUrl of behindViewUrlsFor(url, descriptor.baseCosmeticId)) map.set(behindUrl, entry);
        }
      } catch (error) {
        lastError = String(error?.message || error);
      }
    }
    return map;
  }

  function speciesVariantKeyCandidates(speciesId, gender) {
    const species = String(speciesId || '').trim().toLowerCase();
    const genderKey = String(gender || '').trim().toLowerCase() || 'male';
    if (!species) return [];
    const hyphen = species.replace(/_/g, '-'), under = hyphen.replace(/-/g, '_');
    return [...new Set([hyphen, under, species])].map(form => `${form}_${genderKey}`);
  }

  function collectLayerImageUrls(partsNode, paletteLayerMap, into) {
    if (!partsNode || typeof partsNode !== 'object') return into;
    for (const part of Object.values(partsNode)) {
      const layers = part?.layers;
      if (!layers || typeof layers !== 'object') continue;
      for (const layer of Object.values(layers)) {
        const role = layer?.layerRole || null; // Used with the cosmetic's palette map to identify BODY/NONE overlays, and (below) to key this layer's own pattern separately from its siblings.
        const mappedRole = role && paletteLayerMap ? paletteLayerMap[role] : null;
        const paletteKey = mappedRole || layer?.paletteColorKey || null; // 'A'/'B' — which dye slot this layer recolors with (see renderClothingLayers).
        const skip = mappedRole === 'BODY' || mappedRole === 'NONE' || layer?.paletteColorKey === 'BODY' || layer?.paletteColorKey === 'NONE'; // Same bypass routes collectPatternImageUrls already skips.
        const url = layer?.image?.url;
        if (!skip && typeof url === 'string' && /\.(png|webp|jpe?g)(?:$|[?#])/i.test(url)) into.push({ url: normalizeAssetPath(url), role, paletteKey });
      }
    }
    return into;
  }

  // Resolves every non-skin layer (base + trim/wrap/etc., each tagged with
  // its own layerRole) for one species+gender variant of a cosmetic, in
  // authored order — unlike clothingSprites (config/scratchbones-config.js),
  // which only ever names one flat file per cosmetic and silently drops
  // every other layer. The per-layer role is what lets each layer carry its
  // own weaving pattern instead of one pattern stamped over the whole merged
  // silhouette.
  function resolveIconLayerUrls(cfg, speciesId, gender) {
    const paletteLayerMap = cfg?.palette?.layers && typeof cfg.palette.layers === 'object' ? cfg.palette.layers : null;
    for (const key of speciesVariantKeyCandidates(speciesId, gender)) {
      const layers = collectLayerImageUrls(cfg?.speciesVariants?.[key]?.parts, paletteLayerMap, []);
      if (layers.length) return layers;
    }
    return collectLayerImageUrls(cfg?.parts, paletteLayerMap, []);
  }

  function playerSpeciesGender() {
    const appearance = equipmentDeps?.getPlayerData?.()?.appearance;
    return { speciesId: appearance?.speciesId || 'mao-ao', gender: appearance?.gender || 'male' };
  }

  const iconLayerPromises = new Map(); // Reuses each cosmetic's resolved [{url,role}] layer list — cheap (config only, no pixels) but still worth not re-fetching/re-walking every render.

  // Resolves the current player's own species/gender variant of a cosmetic's
  // layers: [{url, role}]. Shared by the plain (unpatterned) icon compositor
  // below and by renderClothingLayers' patterned per-layer renderer, so the
  // "what layers does this garment have" question is answered exactly once.
  async function resolveIconLayers(baseCosmeticIdValue) {
    const id = String(baseCosmeticIdValue || '');
    if (!id) return [];
    const { speciesId, gender } = playerSpeciesGender();
    const cacheKey = `${id}|${speciesId}|${gender}`;
    if (!iconLayerPromises.has(cacheKey)) {
      iconLayerPromises.set(cacheKey, (async () => {
        try {
          const cfg = await cosmeticConfig(id);
          return resolveIconLayerUrls(cfg, speciesId, gender);
        } catch (error) {
          lastError = String(error?.message || error);
          return [];
        }
      })());
    }
    return iconLayerPromises.get(cacheKey);
  }

  const plainIconCanvasPromises = new Map(); // Reuses composited (unpatterned) icon canvases across the inventory grid and equipment slots.

  // Builds a flat icon by stacking every layer resolveIconLayers finds for
  // the player's own species/gender, instead of the single hand-picked file
  // clothingSprites names. Sibling layers of one cosmetic part share the same
  // xform in every authored cosmetic (see rugged_poncho/fine_hood in
  // config/cosmetics/), so drawing their raw, untransformed images on top of
  // each other already lines them up correctly — no xform math needed for a
  // flat icon.
  async function compositeClothingIcon(baseCosmeticIdValue) {
    const id = String(baseCosmeticIdValue || '');
    if (!id) return null;
    const { speciesId, gender } = playerSpeciesGender();
    const cacheKey = `${id}|${speciesId}|${gender}`;
    if (!plainIconCanvasPromises.has(cacheKey)) {
      plainIconCanvasPromises.set(cacheKey, (async () => {
        const layers = await resolveIconLayers(id);
        if (!layers.length) return null;
        const images = (await Promise.all(layers.map(l => loadImageUrl(l.url).catch(() => null)))).filter(Boolean);
        if (!images.length) return null;
        const width = Math.max(...images.map(img => img.naturalWidth || img.width || 0));
        const height = Math.max(...images.map(img => img.naturalHeight || img.height || 0));
        if (!width || !height) return null;
        const canvas = Object.assign(document.createElement('canvas'), { width, height });
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        for (const img of images) ctx.drawImage(img, 0, 0);
        return canvas;
      })());
    }
    return plainIconCanvasPromises.get(cacheKey);
  }

  function wovenIconVisualKey(item) {
    const { speciesId, gender } = playerSpeciesGender();
    const weaving = item?.weaving;
    const resolvedLayers = {};
    if (weaving?.layers) {
      for (const role of Object.keys(weaving.layers).sort()) {
        const entry = weaving.layers[role] || {};
        resolvedLayers[role] = {
          patterns: weavingPatternsForRole(weaving, role), // Cache key includes both future second-slot data and legacy primary-only data.
          swapPatternColors: !!entry.swapPatternColors,
        };
      }
    }
    const visual = {
      id: baseCosmeticId(item),
      speciesId,
      gender,
      colorA: clothingColorHex(item?.colorA),
      colorB: clothingColorHex(item?.colorB, clothingColorHex(item?.colorA)),
      colorC: clothingColorHex(item?.colorC),
      weaving: weaving?.layers ? resolvedLayers : (weaving?.pattern || null),
    }; // Resolves library-backed motifs into the key so editing a saved pattern invalidates its icon without touching every garment instance.
    return JSON.stringify(visual);
  }

  // Public sprite resolver for inventory/gear rendering. Plain garments keep
  // the inexpensive multi-layer composite path. Woven garments instead cache
  // the fully dyed + patterned result from renderClothingLayers, so inventory
  // rebuilds only reuse a data URL and never composite patterns every frame.
  async function iconSpriteForCosmetic(item, fallbackSprite = null) {
    const id = baseCosmeticId(item);
    if (id && weavingHasAnyPattern(item?.weaving)) {
      const cacheKey = wovenIconVisualKey(item);
      if (!wovenIconDataUrlPromises.has(cacheKey)) {
        wovenIconDataUrlPromises.set(cacheKey, renderClothingLayers(id, {
          primaryHex: clothingColorHex(item?.colorA),
          secondaryHex: clothingColorHex(item?.colorB, clothingColorHex(item?.colorA)),
          patternHex: clothingColorHex(item?.colorC),
          weaving: item.weaving,
          view: 'front',
        }).then(({ canvas }) => {
          if (!canvas) return null;
          try { return canvas.toDataURL('image/png'); } catch (_) { return null; }
        }).catch(error => {
          lastError = String(error?.message || error);
          return null;
        }));
      }
      const wovenUrl = await wovenIconDataUrlPromises.get(cacheKey);
      if (wovenUrl) return wovenUrl;
    }
    if (id) {
      const canvas = await compositeClothingIcon(id);
      if (canvas) { try { return canvas.toDataURL('image/png'); } catch (_) {} }
    }
    return fallbackSprite || null;
  }

  // Patterned/tinted per-layer renderer used by the loom preview, the
  // pattern-authoring live preview, and the redye panel's woven preview.
  // Each layer gets its own primary/trim-dye recolor (by paletteKey — see
  // collectLayerImageUrls) and — via weavingPatternForRole — its own weave
  // pattern, before the (now individually patterned) layers are merged into
  // one flat canvas. This is what actually lets a garment's base and trim
  // carry two different colors/motifs instead of one dye and one pattern
  // stamped uniformly across the whole merged silhouette.
  async function renderClothingLayers(baseCosmeticIdValue, { primaryHex = null, secondaryHex = null, patternHex = '#ffffff', weaving = null, view = 'front' } = {}) {
    const layers = await resolveIconLayers(baseCosmeticIdValue);
    if (!layers.length) return { canvas: null, layers };
    const primaryColorHex = primaryHex || '#ffffff'; // Used as the ordinary base-layer color or, when swapped, as that layer's pattern color.
    const secondaryColorHex = secondaryHex || primaryColorHex; // Used as the ordinary trim-layer color or, when swapped, as that layer's pattern color.
    const gender = view === 'behind' ? playerSpeciesGender().gender : null;
    const rendered = [];
    for (const { url: frontUrl, role, paletteKey } of layers) {
      // Some layers swap to a dedicated "-back" sprite for the rear view,
      // some are hidden entirely from the back (a hood's front-only face
      // trim), and others just reuse their front sprite — same three
      // outcomes the real 3D avatar's rear render picks between.
      let url = frontUrl;
      if (gender) {
        const behind = behindViewResultFor(frontUrl, baseCosmeticIdValue, gender);
        if (behind.changed && behind.url === null) continue; // Hidden from the back entirely.
        url = behind.url || frontUrl;
      }
      let img = await loadImageUrl(url);
      if (!img) continue;
      const shadingSource = img; // Original authored raster; pattern ink samples this light/shadow field even after the base dye is applied.
      const patterns = weavingPatternsForRole(weaving, role); // Determines the primary + optional overpass motifs for this exact base/trim layer.
      const pattern = patterns[0] || null; // Retained as the primary-pattern compatibility name used by color/swap code below.
      const swapPatternColors = patterns.length > 0 && weavingSwapsPatternColorsForRole(weaving, role); // Swaps only this garment layer's cloth and shared pattern dye.
      const clothColorHex = paletteKey === 'B' ? secondaryColorHex : primaryColorHex; // Original sprite dye retained as the pattern dye when swapping.
      const layerBaseHex = swapPatternColors ? patternHex : clothColorHex; // Whole sprite is dyed with the pattern color first when swapping.
      const layerPatternHex = swapPatternColors ? clothColorHex : patternHex; // Motif receives the original cloth dye when swapping.
      const tintValue = parseInt(String(layerBaseHex || '').replace('#', ''), 16);
      // Recolor the image already loaded above rather than asking
      // SpriteRecolor.getRecoloredCanvas to reload it by this same url —
      // that reload uses a plain `new Image().src = url` with no asset-path
      // resolution, so it 404s on exactly the normalizeAssetPath'd paths
      // this module hands it (silently, since the caller here only ever
      // saw the caught/swallowed rejection as "no recolor," i.e. every
      // layer rendering in its original authored placeholder color).
      if (Number.isFinite(tintValue) && window.SpriteRecolor?.recolorImageData) {
        try {
          const tintCanvas = Object.assign(document.createElement('canvas'), { width: img.naturalWidth || img.width || 1, height: img.naturalHeight || img.height || 1 });
          const tintCtx = tintCanvas.getContext('2d');
          tintCtx.drawImage(img, 0, 0);
          const imageData = tintCtx.getImageData(0, 0, tintCanvas.width, tintCanvas.height);
          window.SpriteRecolor.recolorImageData(imageData.data, tintValue, 'direct');
          tintCtx.putImageData(imageData, 0, 0);
          img = tintCanvas;
        } catch (_) {}
      }
      // tintValue folds into the cache prefix for the same reason the runtime
      // hook's tintKey does (see installPortraitHooks) — this layer's `img`
      // pixels, which the pattern's shade-fill reads its light/dark variation
      // from, depend on which dye tinted it, not just its own url.
      if (patterns.length) img = await applyPatternStackToTintedImage(img, patterns, layerPatternHex, `layer:${url}:${tintValue}:swap${swapPatternColors ? 1 : 0}`, shadingSource, 'woven-motif');
      rendered.push(img);
    }
    if (!rendered.length) return { canvas: null, layers };
    const width = Math.max(...rendered.map(img => img.naturalWidth || img.width || 0));
    const height = Math.max(...rendered.map(img => img.naturalHeight || img.height || 0));
    if (!width || !height) return { canvas: null, layers };
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    for (const img of rendered) ctx.drawImage(img, 0, 0);
    return { canvas, layers };
  }

  // Whether this cosmetic has at least one layer whose behind view actually
  // differs from its front — a real substitute sprite, or a layer hidden
  // entirely from the back — used to decide whether the loom's "Behind
  // view" toggle is worth showing at all (most garments have no rear-
  // specific art and would just re-render the same front image, which
  // isn't worth a whole extra button for).
  async function hasBehindView(baseCosmeticIdValue) {
    const layers = await resolveIconLayers(baseCosmeticIdValue);
    const { gender } = playerSpeciesGender();
    return layers.some(({ url }) => behindViewResultFor(url, baseCosmeticIdValue, gender).changed);
  }

  function hexRgb(hex) {
    const match = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
    if (!match) return [255, 255, 255];
    const value = parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function resolvePatternHex(colorC) {
    return colorC?.hex || window.DyeSystem?.getById?.(colorC?.dyeId)?.hex || '#ffffff';
  }

  function portraitTintForHex(tint, hex) {
    const rgb = hexRgb(hex); // Used by runtime swapped layers so the whole sprite can take the pattern dye before its motif receives the cloth dye.
    return { mode: 'shadeFill', rgb, options: tint?.options || window.getPortraitTintingConfig?.() };
  }

  function portraitClothHex(descriptor) {
    const clothColor = descriptor?.paletteKey === 'B' ? (descriptor?.colorB || descriptor?.colorA) : descriptor?.colorA; // Used by runtime swapping to recover the exact original base/trim dye.
    return resolvePatternHex(clothColor);
  }

  function findOpaqueBounds(mask, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { count++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return count ? { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
  }
  // The repeat lattice's shape palette — see pattern-authoring.js's frame
  // tool. Each shape resolves the ink's own tight bbox (w,h) into a pair of
  // basis vectors (the translation between adjacent copies) and an optional
  // `polygon` clip (in the SAME w,h rect, origin at the bbox's own top-left)
  // — a shape with no polygon just draws the whole prepared ink unclipped
  // (square/brick ARE their own full rect, so clipping would be a no-op).
  // `paired: true` stamps the ink a second time, 180°-rotated about the
  // cell's own center — for triangle/trapezoid, clipping BOTH stamps to the
  // *same* polygon still produces two complementary regions, because the
  // second stamp's own rotate transform (translate to the cell midpoint,
  // rotate 180°, translate back) carries the clip path along with it, so it
  // lands as that polygon's own 180° rotation — which for a polygon built
  // symmetrically around the cell's center (as all of these are) is exactly
  // the complementary region, not the same one twice. Two shapes sharing an
  // edge like that always tile a parallelogram seamlessly, whatever their
  // shape — the same reason any triangle or any trapezoid tiles the plane.
  // diamond doesn't need pairing at all: a rhombus with corners at the mid-
  // points of a rectangle's own sides already tiles that rectangle's own
  // grid with no gaps on its own.
  const FRAME_SHAPES = Object.freeze({
    // Every shape (including these two) clips to its own rectangle — the
    // frame is a hard crop boundary, not just a tiling-pitch guide — see
    // buildPatternMask's drawCell polygon clip below.
    square: { label: 'Square', paired: false, basis: (w, h) => ({ u: { x: w, y: 0 }, v: { x: 0, y: h } }), polygon: (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] },
    brick: { label: 'Brick', paired: false, basis: (w, h) => ({ u: { x: w, y: 0 }, v: { x: w / 2, y: h } }), polygon: (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] },
    diamond: {
      label: 'Diamond', paired: false,
      basis: (w, h) => ({ u: { x: w / 2, y: h / 2 }, v: { x: w / 2, y: -h / 2 } }),
      polygon: (w, h) => [{ x: w / 2, y: 0 }, { x: w, y: h / 2 }, { x: w / 2, y: h }, { x: 0, y: h / 2 }],
    },
    triangle: {
      label: 'Triangle', paired: true,
      basis: (w, h) => ({ u: { x: w, y: 0 }, v: { x: 0, y: h } }),
      polygon: (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }],
    },
    trapezoid: {
      label: 'Trapezoid', paired: true,
      basis: (w, h) => ({ u: { x: w, y: 0 }, v: { x: 0, y: h } }),
      // Same construction as triangle (a straight cut corner-to-corner) but
      // the cut's two ends sit partway along the left/right edges instead
      // of exactly at the corners — symmetric about the cell's own center
      // (cutTop = h - cutBottom) so the 180°-rotated partner is still the
      // exact complementary piece. At cutFrac=0 this degenerates to the
      // same cut a triangle uses; trapezoid just keeps a flat top and
      // bottom instead of coming to a point.
      polygon: (w, h) => { const cutFrac = 0.25, cut = h * cutFrac; return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h - cut }, { x: 0, y: cut }]; },
    },
  });
  function frameShapeFor(id) {
    return FRAME_SHAPES[id] || FRAME_SHAPES.square;
  }

  // Patterns saved before the frame tool existed have no frameShape at all —
  // just the old repeatMode/patternScale/patternRotationDeg/translateX/Y
  // fields. Rather than keep the old tight-fit-hull auto-placement algorithm
  // (and its ~50 lines of computational geometry) alive forever just for
  // these, they're remapped onto the equivalent new frame fields: repeatMode
  // 'grid' -> 'square' (unpaired), anything else -> 'triangle' (paired,
  // same 180°-partner look the old triangle mode had) — same overall scale/
  // rotation/position, just using the new bbox-rectangle basis instead of
  // the old custom-fit hull, so an already-authored pattern keeps rendering
  // reasonably instead of vanishing, even if its exact silhouette shifts a
  // little. trianglePadding/gridSpacing (the old numeric gap settings) have
  // no equivalent slot in the new model and are dropped; frameScale is the
  // new one-setting substitute for "how far apart are the copies."
  function legacyFrameFields(patternDef) {
    if (patternDef?.frameShape) return patternDef;
    return {
      ...patternDef,
      frameShape: patternDef?.repeatMode === 'grid' ? 'square' : 'triangle',
      frameScale: patternDef?.patternScale,
      frameRotationDeg: patternDef?.patternRotationDeg,
      frameX: patternDef?.translateX,
      frameY: patternDef?.translateY,
    };
  }

  // Finds a one-pixel watershed between disconnected opaque islands in ONE
  // source motif. The separator is transformed/stamped with each motif instance
  // below, so later thickness/outline growth cannot join two islands that were
  // authored separately inside that instance. Finished motif instances are
  // still unioned normally with one another.
  function buildMotifClusterSeparatorMask(mask, width, height) {
    const labels = new Int32Array(mask.length).fill(-1);
    const stack = [];
    let clusterCount = 0;
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start] !== -1) continue;
      const label = clusterCount++;
      labels[start] = label;
      stack.push(start);
      while (stack.length) {
        const p = stack.pop();
        const x = p % width, y = (p / width) | 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const np = ny * width + nx;
            if (mask[np] && labels[np] === -1) { labels[np] = label; stack.push(np); }
          }
        }
      }
    }
    if (clusterCount < 2) return null;

    // Multi-source flood assigns every transparent pixel to its nearest ink
    // island. Wherever two ownership regions meet becomes the permanent moat
    // for this motif instance. Four-way propagation keeps the watershed stable
    // and deterministic while the source islands themselves use 8-connectivity.
    const owners = new Int32Array(mask.length).fill(-1);
    const queue = new Int32Array(mask.length);
    let head = 0, tail = 0;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      owners[p] = labels[p];
      queue[tail++] = p;
    }
    while (head < tail) {
      const p = queue[head++];
      const x = p % width, y = (p / width) | 0, owner = owners[p];
      const neighbors = [p - 1, p + 1, p - width, p + width];
      const valid = [x > 0, x < width - 1, y > 0, y < height - 1];
      for (let n = 0; n < 4; n++) {
        if (!valid[n]) continue;
        const np = neighbors[n];
        if (owners[np] !== -1) continue;
        owners[np] = owner;
        queue[tail++] = np;
      }
    }

    const separator = new Uint8Array(mask.length);
    for (let p = 0; p < mask.length; p++) {
      if (mask[p]) continue;
      const x = p % width, y = (p / width) | 0, owner = owners[p];
      for (let oy = -1; oy <= 1 && !separator[p]; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const other = owners[ny * width + nx];
          if (other !== -1 && other !== owner) { separator[p] = 1; break; }
        }
      }
    }
    return separator;
  }

  function maskCanvas(mask, width, height) {
    if (!mask) return null;
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      if (!mask[p]) continue;
      image.data[i] = 255; image.data[i + 1] = 255; image.data[i + 2] = 255; image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  function buildPatternMask(width, height, rawPatternDef, motifImg) {
    const patternDef = legacyFrameFields(rawPatternDef);
    const canvas = Object.assign(document.createElement('canvas'), { width, height }), ctx = canvas.getContext('2d');
    const clusterSeparatorCanvas = Object.assign(document.createElement('canvas'), { width, height }); // Per-instance intra-motif watershed sampled alongside the ordinary alpha mask.
    const clusterSeparatorCtx = clusterSeparatorCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    clusterSeparatorCtx.imageSmoothingEnabled = false;
    const motifScale = Math.max(.05, Number(patternDef?.motifScale ?? patternDef?.scale) || 1);
    const frameScale = Math.max(.05, Number(patternDef?.frameScale) || 1);
    const meshScale = resolvedPatternMeshScale(patternDef);
    const motifRad = (Number(patternDef?.motifRotationDeg) || 0) * Math.PI / 180;
    const frameRad = (Number(patternDef?.frameRotationDeg) || 0) * Math.PI / 180;
    const meshRad = (Number(patternDef?.meshRotationDeg) || 0) * Math.PI / 180;
    const shape = frameShapeFor(patternDef?.frameShape), naturalW = motifImg.naturalWidth || motifImg.width || 1, naturalH = motifImg.naturalHeight || motifImg.height || 1;
    // The sole source everything crops from: the authored ink, rotated by
    // motifRotationDeg, at its natural 1x size — motifScale is applied
    // later, per cell, as part of the frame's own crop sampling below, so
    // the frame's own fixed size never has to know about it.
    const srcSize = Math.max(2, Math.ceil(Math.hypot(naturalW, naturalH)) + 2);
    const src = Object.assign(document.createElement('canvas'), { width: srcSize, height: srcSize });
    const srcCtx = src.getContext('2d');
    srcCtx.imageSmoothingEnabled = false;
    srcCtx.translate(srcSize / 2, srcSize / 2);
    srcCtx.rotate(motifRad);
    srcCtx.drawImage(motifImg, -naturalW / 2, -naturalH / 2, naturalW, naturalH);
    const srcData = srcCtx.getImageData(0, 0, srcSize, srcSize).data, srcMask = new Uint8Array(srcSize * srcSize);
    for (let p = 0, i = 0; i < srcData.length; i += 4, p++) if (srcData[i + 3] > 16) srcMask[p] = 1;
    const bbox = findOpaqueBounds(srcMask, srcSize, srcSize); // Frame geometry intentionally stays based on the original authored ink, not the thickness-adjusted ink.
    const sourceClusterSeparatorMask = patternDef?.invert ? null : buildMotifClusterSeparatorMask(srcMask, srcSize, srcSize); // Inverted patterns treat transparency as ink, so source-ink island separation does not apply.
    const sourceAllowedMask = new Uint8Array(srcMask.length); sourceAllowedMask.fill(1); // Source-space thickening may expand anywhere inside the rotated motif work canvas; the frame clip still decides what finally prints.
    const sourceSignedThickness = (patternDef?.invert ? -1 : 1) * (Number(patternDef?.motifThinPx) || 0); // Inversion flips foreground/background, so reverse the source operation to preserve positive=visibly thinner semantics.
    const adjustedSrcMask = adjustMaskThickness(srcMask, sourceAllowedMask, srcSize, srcSize, sourceSignedThickness, sourceClusterSeparatorMask); // Motif thinning/thickening is measured here, before motif/frame/mesh scaling.
    const adjustedSrc = maskCanvas(adjustedSrcMask, srcSize, srcSize);
    const clusterSeparatorSrc = maskCanvas(sourceClusterSeparatorMask, srcSize, srcSize);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(meshRad);
    ctx.scale(meshScale, meshScale);
    if (clusterSeparatorSrc) {
      clusterSeparatorCtx.save();
      clusterSeparatorCtx.translate(width / 2, height / 2);
      clusterSeparatorCtx.rotate(meshRad);
      clusterSeparatorCtx.scale(meshScale, meshScale);
    }

    if (bbox) {
      // The frame is a crop window laid over the source ink: frameX/frameY
      // offset it from the ink's own natural center, frameRotationDeg
      // tilts it, frameScale grows/shrinks it relative to the ink's own
      // tight bounds (frameScale<1 crops in, >1 adds space around the
      // ink) — "make it smaller than the drawn motif to crop, make it
      // larger to create space." Whatever falls inside becomes the single
      // repeating unit; the chosen shape then tessellates copies of
      // exactly that crop. meshScale/meshRotationDeg (applied above, via
      // ctx.scale/ctx.rotate wrapping this whole function body) are a
      // completely separate control — they zoom/rotate the WHOLE resulting
      // mesh of tiles after cropping, never what any one cell contains.
      const cellW = bbox.w * frameScale, cellH = bbox.h * frameScale;
      const winCenterX = bbox.x0 + bbox.w / 2 + (Number(patternDef?.frameX) || 0);
      const winCenterY = bbox.y0 + bbox.h / 2 + (Number(patternDef?.frameY) || 0);
      const polygon = shape.polygon(cellW, cellH);
      const midpoint = { x: cellW / 2, y: cellH / 2 };
      // Draws one cell at the CURRENT origin (the caller has already
      // translated to that cell's own top-left corner). The frame polygon
      // is clipped FIRST and remains active while motifScale zooms the
      // source ink inside it. Pixels transformed outside that polygon are
      // discarded, so motifScale changes what fits inside a fixed cell but
      // never enlarges the crop boundary or the lattice spacing.
      function drawCell(targetCtx, sourceImage) {
        targetCtx.save();
        targetCtx.beginPath();
        polygon.forEach((p, i) => { if (i === 0) targetCtx.moveTo(p.x, p.y); else targetCtx.lineTo(p.x, p.y); });
        targetCtx.closePath();
        targetCtx.clip();
        targetCtx.translate(cellW / 2, cellH / 2);
        targetCtx.rotate(frameRad);
        targetCtx.scale(motifScale, motifScale);
        targetCtx.translate(-winCenterX, -winCenterY);
        targetCtx.drawImage(sourceImage, 0, 0);
        targetCtx.restore();
      }

      function stampCell(targetCtx, sourceImage, ox, oy) {
        targetCtx.save(); targetCtx.translate(ox, oy); drawCell(targetCtx, sourceImage); targetCtx.restore();
        if (!shape.paired) return;
        targetCtx.save();
        targetCtx.translate(ox + midpoint.x, oy + midpoint.y);
        targetCtx.rotate(Math.PI);
        targetCtx.translate(-midpoint.x, -midpoint.y);
        drawCell(targetCtx, sourceImage);
        targetCtx.restore();
      }
      if (patternDef?.tiling !== false) {
        const { u: basisU, v: basisV } = shape.basis(cellW, cellH);
        const stamp = (ox, oy) => {
          stampCell(ctx, adjustedSrc, ox, oy);
          if (clusterSeparatorSrc) stampCell(clusterSeparatorCtx, clusterSeparatorSrc, ox, oy);
        };
        // How far the lattice needs to extend (in basisU/basisV step
        // counts) to cover the whole canvas — inverting the (generally
        // skewed, non-axis-aligned) basis matrix rather than assuming a
        // square grid, since the frame's own rotation can point either
        // basis vector in any direction. Measured in the mesh's own
        // (pre-meshScale) units, since meshScale is applied once via
        // ctx.scale above instead of being multiplied into every offset by
        // hand — dividing the device-pixel canvas half-diagonal by
        // meshScale converts it into those same local units. Lattice
        // placement no longer depends on frameX/frameY at all — those only
        // steer what a cell's own crop samples now, never where cells sit.
        const reach = Math.hypot(width, height) / 2 / meshScale + Math.hypot(cellW, cellH);
        const det = basisU.x*basisV.y-basisU.y*basisV.x; let maxI=8, maxJ=8;
        if (Math.abs(det) > 1e-6) {
          const ia=basisV.y/det, ib=-basisV.x/det, ic=-basisU.y/det, id=basisU.x/det;
          maxI=0; maxJ=0;
          for (const [x,y] of [[reach,reach],[reach,-reach],[-reach,reach],[-reach,-reach]]) {
            maxI=Math.max(maxI,Math.abs(ia*x+ib*y));
            maxJ=Math.max(maxJ,Math.abs(ic*x+id*y));
          }
          maxI=Math.min(300,Math.ceil(maxI)+2); maxJ=Math.min(300,Math.ceil(maxJ)+2);
        }
        for (let j=-maxJ;j<=maxJ;j++) for (let i=-maxI;i<=maxI;i++) {
          const ox = i*basisU.x+j*basisV.x, oy = i*basisU.y+j*basisV.y;
          if (Math.hypot(ox,oy) <= reach) stamp(ox,oy);
        }
      } else {
        stampCell(ctx, adjustedSrc, -cellW / 2, -cellH / 2);
        if (clusterSeparatorSrc) stampCell(clusterSeparatorCtx, clusterSeparatorSrc, -cellW / 2, -cellH / 2);
      }
    }
    ctx.restore();
    if (clusterSeparatorSrc) clusterSeparatorCtx.restore();
    if(patternDef?.invert){const image=ctx.getImageData(0,0,width,height),data=image.data;for(let i=0;i<data.length;i+=4)data[i+3]=255-data[i+3];ctx.putImageData(image,0,0);}
    canvas.__motifClusterSeparatorCanvas = clusterSeparatorSrc ? clusterSeparatorCanvas : null; // Consumed only by the later thickness/outline passes; ordinary callers still receive a Canvas.
    return canvas;
  }

  function loadImageUrl(url) {
    if (!url) return Promise.resolve(null);
    const value = String(url);
    const isAbsoluteOrBlob = /^(?:https?:|blob:|data:|\/\/)/i.test(value); // RepoPatternLibrary emits absolute motifUrl values on raw.githack/CDN builds; never feed those through game-relative loadImg path normalization.
    if (typeof window.loadImg === 'function' && !isAbsoluteOrBlob) return window.loadImg(normalizeAssetPath(value));
    const resolvedValue = isAbsoluteOrBlob ? value : standaloneAssetUrl(value); // Standalone dev tools do not install game.loadImg, so resolve authored ./assets/... and normalized cosmetics/... against docs/.
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load pattern/clothing image ${resolvedValue}`));
      image.src = resolvedValue;
    });
  }

  function patternStackCanvasKey(imageOrCanvas, patterns, colorHex, cachePrefix = '') {
    const width = imageOrCanvas?.naturalWidth || imageOrCanvas?.width || 1; // Used to keep species/gender sprite-size variants from sharing a composite.
    const height = imageOrCanvas?.naturalHeight || imageOrCanvas?.height || 1; // Used with width in the deterministic pattern cache key.
    return `${cachePrefix}|${width}x${height}|${colorHex}|${JSON.stringify(normalizePatternStack(patterns))}`;
  }

  function patternCanvasKey(imageOrCanvas, pattern, colorHex, cachePrefix = '') {
    return patternStackCanvasKey(imageOrCanvas, [pattern], colorHex, cachePrefix); // Legacy single-pattern callers share the exact same cache-key path as the stack compositor.
  }

  const PATTERN_OUTLINE_WIDTH = 1; // Half of ToolMetalRecolor's DEFAULT_OUTLINE_WIDTH (2) — a woven motif's outline reads thinner than verdigris removal's by design.
  const OVERPASS_CLEARANCE_MIN = 3; // Legacy/current knot-gap multiplier, and the authored minimum.
  const OVERPASS_CLEARANCE_MAX = 12; // Player/dev-authored maximum: four times the previous fixed 3× gap.
  function overpassClearanceMultiplier(pattern) {
    return Math.max(OVERPASS_CLEARANCE_MIN, Math.min(OVERPASS_CLEARANCE_MAX, Number(pattern?.overpassClearanceMultiplier) || OVERPASS_CLEARANCE_MIN)); // Slot-2 pattern owns its gap so every caller shares one save-compatible value.
  }

  // Mirrors ToolMetalRecolor's buildOxidationOutlineMask (docs/js/tool-metal-recolor.js):
  // centers a boundary ring across the motif edge: half covers the already-
  // filled motif edge and half extends into the surrounding garment. The
  // outline is still painted after the color fill, so black wins on overlap.
  const outlineDiskOffsetCache = new Map(); // radius -> [{x,y,d2}]; shared by every patterned sprite so large animal outlines never rebuild/hypot-test the same disks.
  function outlineDiskOffsets(radius) {
    const r = Math.max(0, radius | 0);
    if (outlineDiskOffsetCache.has(r)) return outlineDiskOffsetCache.get(r);
    const offsets = [];
    const r2 = r * r;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d2 = x * x + y * y;
      if (d2 <= r2) offsets.push({ x, y, d2 });
    }
    outlineDiskOffsetCache.set(r, offsets);
    return offsets;
  }

  function buildPatternOutlineMask(patternMask, garmentMask, width, height, outlineWidth, clusterSeparatorMask = null) {
    const outline = new Uint8Array(patternMask.length);
    if (!outlineWidth) return outline;
    const boundaryPixels = []; // Expanding from actual motif boundaries is far cheaper than searching a radius around every garment pixel, especially at 7–14× animal scale.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (!patternMask[p]) continue;
        let isEdge = false;
        for (let oy = -1; oy <= 1 && !isEdge; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) { isEdge = true; break; }
            const np = ny * width + nx;
            if (!patternMask[np] && garmentMask[np]) { isEdge = true; break; }
          }
        }
        if (isEdge) boundaryPixels.push(p);
      }
    }
    const totalRadius = Math.max(1, Math.round(Number(outlineWidth || 0) * 5));
    const inwardRadius = Math.floor(totalRadius / 2); // Used to move half of the old outward width onto the motif itself.
    const outwardRadius = totalRadius - inwardRadius; // Keeps the remaining half outside the motif.
    const maxRadius = Math.max(inwardRadius, outwardRadius);
    const offsets = outlineDiskOffsets(maxRadius);
    const inward2 = inwardRadius * inwardRadius, outward2 = outwardRadius * outwardRadius;
    for (const boundaryPixel of boundaryPixels) {
      const bx = boundaryPixel % width, by = (boundaryPixel / width) | 0;
      for (const offset of offsets) {
        const x = bx + offset.x, y = by + offset.y;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const p = y * width + x;
        if (!garmentMask[p]) continue;
        if (patternMask[p]) {
          if (offset.d2 <= inward2) outline[p] = 1;
        } else if (!clusterSeparatorMask?.[p] && offset.d2 <= outward2) {
          outline[p] = 1;
        }
      }
    }
    return outline;
  }

  const CELL_OFFSET_STEP = 5; // Tiny diagonal px shift between separate cells (regions enclosed by transparency or the near-black outline) within one sprite/layer image, so the same pattern doesn't look like one continuous print spanning a seam.
  const CELL_OFFSET_CYCLE = 4; // Keeps the offset bounded/subtle no matter how many disconnected cells a sprite has — cycles back to 0 rather than drifting further with every extra cell.
  const CELL_OFFSET_PAD = CELL_OFFSET_STEP * (CELL_OFFSET_CYCLE - 1);

  // Finds each disconnected "cell" of a garment mask — a region enclosed by
  // transparency or by the near-black authored outline, both of which are
  // already excluded from garmentMask and so act as a flood-fill barrier for
  // free. Used to give the same pattern a slightly different print offset
  // per cell instead of tiling as one continuous surface across what's
  // visually two separate cloth pieces baked into a single sprite.
  function labelPatternCells(mask, width, height) {
    const labels = new Int32Array(mask.length).fill(-1);
    let cellCount = 0;
    const stack = [];
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start] !== -1) continue;
      const label = cellCount++;
      labels[start] = label;
      stack.push(start);
      while (stack.length) {
        const p = stack.pop();
        const x = p % width, y = (p / width) | 0;
        if (x > 0 && mask[p - 1] && labels[p - 1] === -1) { labels[p - 1] = label; stack.push(p - 1); }
        if (x < width - 1 && mask[p + 1] && labels[p + 1] === -1) { labels[p + 1] = label; stack.push(p + 1); }
        if (y > 0 && mask[p - width] && labels[p - width] === -1) { labels[p - width] = label; stack.push(p - width); }
        if (y < height - 1 && mask[p + width] && labels[p + width] === -1) { labels[p + width] = label; stack.push(p + width); }
      }
    }
    return { labels, cellCount };
  }

  // Applies the signed "Motif thinning / thickening" contour offset before
  // color fill and outline generation. Positive values erode inward; negative
  // values dilate outward but stay clipped to the valid garment surface.
  function adjustMaskThickness(mask, allowedMask, width, height, signedPx, clusterSeparatorMask = null) {
    const amount = Math.round(Number(signedPx) || 0);
    if (!amount) return mask;

    const boundary = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (!mask[p]) continue;
        let isEdge = false;
        for (let oy = -1; oy <= 1 && !isEdge; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) { isEdge = true; break; }
          }
        }
        if (isEdge) boundary[p] = 1;
      }
    }

    if (amount > 0) {
      const thinned = new Uint8Array(mask.length); // Used when the signed authoring slider is positive: removes exactly the requested nearest edge layers.
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const p = y * width + x;
          if (!mask[p]) continue;
          let nearBoundary = false;
          for (let oy = -amount; oy <= amount && !nearBoundary; oy++) {
            for (let ox = -amount; ox <= amount; ox++) {
              if (Math.hypot(ox, oy) >= amount - 0.01) continue;
              const nx = x + ox, ny = y + oy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              if (boundary[ny * width + nx]) { nearBoundary = true; break; }
            }
          }
          if (!nearBoundary) thinned[p] = 1;
        }
      }
      return thinned;
    }

    const radius = Math.abs(amount);
    const thickened = new Uint8Array(mask); // Used when the signed authoring slider is negative: grows into nearby valid surface pixels without crossing the garment/metal silhouette.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (mask[p] || !allowedMask[p] || clusterSeparatorMask?.[p]) continue; // Never let outward thickening fill the per-instance moat between separate source ink islands.
        let nearBoundary = false;
        for (let oy = -radius; oy <= radius && !nearBoundary; oy++) {
          for (let ox = -radius; ox <= radius; ox++) {
            if (Math.hypot(ox, oy) > radius + 0.01) continue;
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (boundary[ny * width + nx]) { nearBoundary = true; break; }
          }
        }
        if (nearBoundary) thickened[p] = 1;
      }
    }
    return thickened;
  }

  const ANIMAL_PATTERN_OUTLINE_WIDTH = 6; // Used by the explicit animal surface-paint pass so animal motifs read more strongly than 1px clothing patterns without tying line weight to motif scale.

  // Pattern transforms alter motif geometry only. Clothing keeps its caller-
  // supplied raster-space width, while the explicitly labeled animal surface
  // pass gets a fixed 6px outline. Neither width changes with motif scaling.
  function scaledOutlineWidth(defaultWidth, _rawPattern, debugLabel = 'woven-motif') {
    const baseWidth = Math.max(1, finite(defaultWidth, 1));
    return debugLabel === 'animal-surface-pattern' ? ANIMAL_PATTERN_OUTLINE_WIDTH : baseWidth;
  }

  // A per-item "Custom" pattern's motif may live in MotifStore instead of
  // being embedded directly (see pattern-authoring.js's offloadMotif) —
  // resolve it back to a full motifDataUrl before handing the pattern to
  // the editor to redraw, since pattern-authoring.js itself stays agnostic
  // of any storage scheme beyond motifDataUrl. A no-op for a pattern that
  // already has one (or is null).
  async function resolvedForEditing(pattern) {
    if (!pattern || pattern.motifDataUrl || !pattern.customMotifId) return pattern;
    const motifDataUrl = await window.MotifStore?.loadMotif?.(pattern.customMotifId);
    return motifDataUrl ? { ...pattern, motifDataUrl } : pattern;
  }

  async function applyPatternStackToTintedImage(imageOrCanvas, rawPatterns, colorHex, cachePrefix = '', shadingSource = null, debugLabel = 'woven-motif') {
    const patterns = normalizePatternStack(rawPatterns);
    if (!imageOrCanvas || !patterns.length) return imageOrCanvas;
    const renderable = patterns.filter(pattern => !!(pattern?.motifDataUrl || pattern?.motifUrl || pattern?.customMotifId));
    if (!renderable.length) return imageOrCanvas;
    const width = imageOrCanvas.naturalWidth || imageOrCanvas.width || 1, height = imageOrCanvas.naturalHeight || imageOrCanvas.height || 1;
    const key = patternStackCanvasKey(imageOrCanvas, renderable, colorHex, cachePrefix);
    if (patternedCanvasCache.has(key)) return patternedCanvasCache.get(key);

    const motifUrls = await Promise.all(renderable.map(async pattern =>
      pattern.motifDataUrl || pattern.motifUrl || await window.MotifStore?.loadMotif?.(pattern.customMotifId)
    )); // Used by primary + optional overpass without changing either reusable pattern definition.
    const loaded = await Promise.all(motifUrls.map(url => url ? loadImageUrl(url) : Promise.resolve(null)));
    const active = renderable.map((pattern, index) => ({ pattern, motif: loaded[index] })).filter(entry => !!entry.motif).slice(0, 2);
    if (!active.length) return imageOrCanvas;

    const pad = CELL_OFFSET_PAD;
    const maskWidth = width + pad * 2, maskHeight = height + pad * 2;
    const patternCanvases = active.map(({ pattern, motif }) => buildPatternMask(maskWidth, maskHeight, pattern, motif)); // Each slot keeps its own frame/tiling/scale transform.
    const out = Object.assign(document.createElement('canvas'), { width, height });
    const ctx = out.getContext('2d');
    ctx.drawImage(imageOrCanvas, 0, 0, width, height);
    const base = ctx.getImageData(0, 0, width, height);
    let shadeSourceData = base.data; // Defaults to the visible base for callers that do not have the pre-tint raster.
    if (shadingSource) {
      try {
        const shadeCanvas = Object.assign(document.createElement('canvas'), { width, height });
        const shadeCtx = shadeCanvas.getContext('2d');
        shadeCtx.drawImage(shadingSource, 0, 0, width, height);
        shadeSourceData = shadeCtx.getImageData(0, 0, width, height).data;
      } catch (_) {
        shadeSourceData = base.data;
      }
    }
    const [r, g, b] = hexRgb(colorHex);
    const directShadeFill = window.ColorFill?.shadeFillPixels;
    const pixelCount = width * height;
    const garmentMask = new Uint8Array(pixelCount); // Opaque, non-authored-outline cloth pixels — this pattern's equivalent of the tool's metalMask.
    for (let p = 0, i = 0; i < base.data.length; i += 4, p++) {
      const maxChannel = Math.max(shadeSourceData[i], shadeSourceData[i + 1], shadeSourceData[i + 2]);
      if (shadeSourceData[i + 3] > 8 && maxChannel > 28) garmentMask[p] = 1;
    }

    const { labels: cellLabels } = labelPatternCells(garmentMask, width, height);
    const sampledMasks = []; // Used below to apply the Celtic-knot-style overpass before any visible black outline is generated.
    const sampledSeparators = [];
    for (const patternCanvas of patternCanvases) {
      const paddedMaskData = patternCanvas.getContext('2d').getImageData(0, 0, maskWidth, maskHeight).data;
      const separatorCanvas = patternCanvas.__motifClusterSeparatorCanvas;
      const paddedSeparatorData = separatorCanvas ? separatorCanvas.getContext('2d').getImageData(0, 0, maskWidth, maskHeight).data : null;
      const mask = new Uint8Array(pixelCount);
      const separator = paddedSeparatorData ? new Uint8Array(pixelCount) : null;
      for (let p = 0; p < pixelCount; p++) {
        if (!garmentMask[p]) continue;
        const x = p % width, y = (p / width) | 0;
        const off = (cellLabels[p] % CELL_OFFSET_CYCLE) * CELL_OFFSET_STEP;
        const mx = x + pad - off, my = y + pad - off;
        const mi = (my * maskWidth + mx) * 4;
        if (paddedMaskData[mi + 3] > 16) mask[p] = 1;
        if (separator && paddedSeparatorData[mi + 3] > 16) separator[p] = 1;
      }
      sampledMasks.push(mask);
      sampledSeparators.push(separator);
    }

    const combinedMask = new Uint8Array(sampledMasks[0]); // Primary motif is the under-strand when an overpass exists.
    let combinedSeparator = sampledSeparators[0] ? new Uint8Array(sampledSeparators[0]) : null;
    if (sampledMasks[1]) {
      const overpassMask = sampledMasks[1]; // Slot 2 is always the visually-over strand.
      const overpassOutlineWidth = scaledOutlineWidth(PATTERN_OUTLINE_WIDTH, active[1]?.pattern, debugLabel);
      const clearanceMultiplier = overpassClearanceMultiplier(active[1]?.pattern); // Player/dev-authored slot-2 gap, clamped to 3×..12× normal outline width.
      const clearanceMask = buildPatternOutlineMask(
        overpassMask,
        garmentMask,
        width,
        height,
        overpassOutlineWidth * clearanceMultiplier, // Invisible clearance uses the authored 3×..12× multiple through the exact same raster-outline function as the visible border.
        sampledSeparators[1],
      );
      for (let p = 0; p < pixelCount; p++) {
        if (clearanceMask[p] || overpassMask[p]) combinedMask[p] = 0; // Punch the under-strand before any black outline exists.
      }
      for (let p = 0; p < pixelCount; p++) if (overpassMask[p]) combinedMask[p] = 1; // Then place the over-strand itself back on top.
      const overSeparator = sampledSeparators[1];
      if (combinedSeparator || overSeparator) {
        const nextSeparator = new Uint8Array(pixelCount);
        for (let p = 0; p < pixelCount; p++) {
          const underSeparator = combinedSeparator?.[p] && !clearanceMask[p];
          nextSeparator[p] = underSeparator || overSeparator?.[p] ? 1 : 0;
        }
        combinedSeparator = nextSeparator;
      }
    }

    if (typeof directShadeFill !== 'function') throw new Error('ColorFill unavailable during woven pattern composition');
    directShadeFill(base.data, [r, g, b], {
      sourceData: shadeSourceData,
      debugLabel,
      samplePredicate: i => !!garmentMask[i >> 2],
      applyPredicate: i => {
        const p = i >> 2;
        return !!garmentMask[p] && !!combinedMask[p];
      },
    });

    const outlineWidth = scaledOutlineWidth(PATTERN_OUTLINE_WIDTH, active[0]?.pattern, debugLabel);
    const outlineMask = buildPatternOutlineMask(combinedMask, garmentMask, width, height, outlineWidth, combinedSeparator);
    for (let p = 0, i = 0; i < base.data.length; i += 4, p++) {
      if (!outlineMask[p]) continue;
      base.data[i] = 0; base.data[i + 1] = 0; base.data[i + 2] = 0;
    }

    ctx.putImageData(base, 0, 0);
    patternedCanvasCache.set(key, out);
    return out;
  }

  async function applyPatternToTintedImage(imageOrCanvas, pattern, colorHex, cachePrefix = '', shadingSource = null, debugLabel = 'woven-motif') {
    return applyPatternStackToTintedImage(imageOrCanvas, [pattern], colorHex, cachePrefix, shadingSource, debugLabel); // Existing single-pattern API remains binary/save compatible.
  }

  async function patternedCanvasForItem(item) {
    const id = baseCosmeticId(item);
    if (!id) return null;
    const { canvas } = await renderClothingLayers(id, {
      primaryHex: item?.colorA?.hex,
      secondaryHex: item?.colorB?.hex,
      patternHex: resolvePatternHex(item?.colorC),
      weaving: item?.weaving,
    });
    return canvas;
  }

  function installPortraitHooks() {
    if (portraitHooksInstalled) return true;
    const originalTint = window._imageForTint;
    const originalRender = window.renderProfile;
    if (typeof originalTint !== 'function' || typeof originalRender !== 'function') return false;

    window._imageForTint = function clothingPatternImageForTint(img, sourceKey, tint) {
      const descriptor = activePortraitPatternMap?.get(normalizeAssetPath(sourceKey));
      const patterns = descriptor ? weavingPatternsForRole(descriptor.weaving, descriptor.role) : []; // Per-layer: base and trim can each own an independent primary + optional overpass.
      const pattern = patterns[0] || null; // Compatibility name for the primary motif used by the existing dye-swap path.
      if (!patterns.length) return originalTint(img, sourceKey, tint);
      const swapPatternColors = weavingSwapsPatternColorsForRole(descriptor.weaving, descriptor.role); // Runtime counterpart of the loom's independent base/trim swap checkbox.
      const patternColorHex = resolvePatternHex(descriptor.colorC); // Third dye slot is the ordinary woven-ink color and becomes the sprite color when swapped.
      const clothColorHex = portraitClothHex(descriptor); // Exact saved A/B dye becomes the motif color when this layer is swapped.
      const appliedTint = swapPatternColors ? portraitTintForHex(tint, patternColorHex) : tint; // Recolors the whole sprite before motif compositing, matching loom preview semantics.
      const tinted = originalTint(img, sourceKey, appliedTint);
      // _imageForTint is synchronous. Return cached patterned output when available;
      // otherwise schedule a player-avatar refresh after generating it and use this
      // one unpatterned frame as a safe fallback.
      // tintKey folds in the actual base tint that produced `tinted`'s pixels,
      // including a swapped pattern-color base, so cache entries cannot leak
      // between normal and swapped layer renders.
      const tintKey = appliedTint?.mode === 'shadeFill' ? `shade:${(appliedTint.rgb || []).join(',')}` : appliedTint?.mode === 'hueSatFill' ? `huesat:${appliedTint.hue}:${appliedTint.sat}` : 'none';
      const prefix = `runtime:${normalizeAssetPath(sourceKey)}:${tintKey}:swap${swapPatternColors ? 1 : 0}`; // Separates normal/swapped composites even when their dye values happen to match.
      const colorHex = swapPatternColors ? clothColorHex : patternColorHex; // Motif color is the opposite member of the cloth↔pattern swap.
      const fullKey = patternStackCanvasKey(tinted, patterns, colorHex, prefix);
      const cached = patternedCanvasCache.get(fullKey);
      if (cached) return cached;
      if (!pendingPatternCanvasKeys.has(fullKey)) {
        pendingPatternCanvasKeys.add(fullKey);
        applyPatternStackToTintedImage(tinted, patterns, colorHex, prefix, img, 'woven-motif').then(() => {
          requestPlayerAvatarRefresh();
        }).catch(error => { lastError = String(error?.message || error); }).finally(() => pendingPatternCanvasKeys.delete(fullKey));
      }
      return tinted;
    };
    window._imageForTint.__clothingWeavingPattern = true;

    const wrapRenderer = name => {
      const current = window[name];
      if (typeof current !== 'function' || current.__clothingWeavingPattern) return;
      const wrapped = async function clothingWeavingPortraitRenderer(canvas, profile, options) {
        const descriptors = profile?.bodyColors?.[CLOTHING_MARKER_KEY];
        const previous = activePortraitPatternMap;
        activePortraitPatternMap = Array.isArray(descriptors) && descriptors.length ? await buildPortraitPatternMap(descriptors) : null;
        try { return await current(canvas, profile, options); }
        finally { activePortraitPatternMap = previous; }
      };
      wrapped.__clothingWeavingPattern = true;
      wrapped.__clothingWeavingOriginal = current;
      window[name] = wrapped;
    };
    wrapRenderer('renderProfile');
    wrapRenderer('renderPortraitProfile');
    portraitHooksInstalled = true;
    return true;
  }

  function debugSnapshot() {
    const stats = armorStats();
    return {
      version: VERSION,
      equipmentReady: !!equipmentDeps,
      armorHooksInstalled,
      portraitHooksInstalled,
      loomOpen: !!loomOverlay?.isConnected,
      combatActive: combatActive(),
      mounted: mounted(),
      equippedWeight: stats.weightUnits,
      stats,
      equipped: equippedClothItems().map(item => ({ uid: item.uid, article: articleLabel(item), slot: item.slot, material: item.weaveMaterial || 'standard', weightUnits: itemWeightUnits(item), woven: weavingHasAnyPattern(item.weaving) })),
      blueprints: currentBlueprints().map(bp => ({ id: bp.baseCosmeticId, slot: bp.slot, label: bp.label })),
      wool: { light: Number(equipmentDeps?.inventory?.[LIGHT_WOOL_KEY]) || 0, heavy: Number(equipmentDeps?.inventory?.[HEAVY_WOOL_KEY]) || 0 },
      lastError,
    };
  }

  window.ClothingWeavingSystem = Object.freeze({
    version: VERSION,
    openLoom,
    closeLoom,
    isCraftableCloth,
    standardWeightFor,
    itemWeightUnits,
    totalEquippedWeight,
    outfitItemsFromRoster,
    totalOutfitWeight,
    armorStats,
    armorStatsForEntity,
    combatActive,
    learnOwnedBlueprints,
    renderClothingLayers,
    applyPatternToTintedImage, // Save-compatible single-pattern wrapper.
    applyPatternStackToTintedImage, // Shared primary+overpass compositor; slot 2 punches an authored 3×..12×-outline-width invisible clearance through slot 1 before black outlining.
    decorateAvatarDataWithWovenItems, // Reuses the player's woven portrait marker contract for NPC/default clothing without duplicating renderer internals.
    hasBehindView,
    iconSpriteForCosmetic,
    hasWovenPattern: item => weavingHasAnyPattern(item?.weaving),
    reweaveMaterialCost,
    debugSnapshot,
    __test: Object.freeze({ baseCosmeticId, uniqueCraftCosmeticId, thirdTintKey, buildPatternMask, applyPatternToTintedImage, applyPatternStackToTintedImage, labelPatternCells, behindViewUrlsFor, behindViewResultFor, buildPortraitPatternMap, collectPatternImageUrls, cosmeticConfig, summarizeWeavingLabel, weavingPatternForRole, weavingPatternsForRole, normalizePatternStack, forcedOverpassPatternForWeaving, withForcedOverpass, weavingSwapsPatternColorsForRole, weavingHasAnyPattern, decorateAvatarDataWithWovenItems, materializeWeavingLibrarySnapshots, docsRelativeUrl, standaloneAssetUrl, frameShapeFor, wovenIconVisualKey, reweaveMaterialCost, resolvedPatternMeshScale, buildMotifClusterSeparatorMask, adjustMaskThickness, buildPatternOutlineMask, scaledOutlineWidth, overpassClearanceMultiplier, requestPlayerAvatarRefresh }),
  });
  window.__clothingWeavingDebug = debugSnapshot;

  futureGlobal('EquipmentPanel', patchEquipmentPanel);
  installClothingDetailTracking();
  installArmorHooks();
  installPortraitHooks();
})();

