(() => {
  'use strict';

  if (Number(window.WeavingSystem?.version) >= 1) return;

  const VERSION = 1;
  const CLOTHING_SLOTS = ['hat', 'hood', 'torso', 'overwear']; // Used for equipped-weight totals and portrait tint routing.
  const BASE_WEIGHT_BY_SLOT = Object.freeze({ hat: 2, hood: 3, torso: 4, overwear: 3 }); // Standard loot/shop clothing is the middle weight.
  const WOOL_TIERS = Object.freeze({
    light: Object.freeze({ itemKey: 'lightWool', label: 'Light Wool', weightDelta: -1 }),
    heavy: Object.freeze({ itemKey: 'puktukWool', label: 'Heavy Wool', weightDelta: 1 }),
  }); // Existing inventory keys used by Vorg-Ass and Puktuk wool.
  const WOOL_COST_BY_SLOT = Object.freeze({ hat: 1, hood: 2, torso: 3, overwear: 2 }); // Loom material costs by garment coverage.
  const BALANCE = Object.freeze({
    defensePerUnit: 0.0225,
    footingResistancePerUnit: 0.025,
    dodgePenaltyPerUnit: 0.02,
    combatMovePenaltyPerUnit: 0.0125,
    maxDefenseReduction: 0.55,
    maxFootingReduction: 0.60,
    minDodgeMultiplier: 0.55,
    minCombatMoveMultiplier: 0.65,
  }); // Single tuning surface: weight is deliberately the only clothing combat stat.
  const BASIC_HEADBAND_ID = 'appearance::hat::basic_headband'; // Only hat allowed by the cloth-only rule.
  const BANDOLIER_ID = 'bandolier1'; // Explicit leather torso exclusion.
  const SYNTHETIC_MARKER = '::woven::'; // Keeps multiple crafted copies distinct from legacy cosmetic-id dedupe.
  const ACTION_BUTTON_IDS = ['btnAction1', 'btnAction2', 'btnAction3', 'btnItemAction1', 'btnItemAction2']; // Existing action-bar slots reused for loom interaction.
  const TILE_SIZE = 64; // Existing world/debug position scale.
  const LOOM_TARGET_RADIUS_TILES = 0.92; // Aim tolerance for placed/authored looms.
  const PATTERN_CACHE_LIMIT = 48; // Caps rendered woven-canvas cache growth.

  let equipmentDeps = null; // Captured from EquipmentPanel.init for live gear/inventory/save/UI access.
  let furnitureDeps = null; // Captured from FurniturePlacer.init for placed-furniture targeting.
  let activeLoom = null; // Current aimed loom shown through the action bar and debug panel.
  let loomOpen = false; // Prevents loom prompt duplication while its floating UI is open.
  let loomState = null; // Current article/wool/dye/pattern draft in the floating loom UI.
  let activeGearUid = null; // Tracks which gear detail owns a woven redye request.
  let targetRefreshScheduled = false; // Coalesces action-bar mutation bursts into one loom target refresh.
  let targetRefreshToken = 0; // Rejects stale async authored-map targeting results.
  let previewToken = 0; // Rejects stale async garment previews after rapid selection changes.
  let lastCraft = null; // Mobile-visible diagnostics for the most recent loom craft.
  let lastDodgePenalty = null; // Mobile-visible diagnostics for the most recent weighted dodge.
  let lastError = null; // Mobile-visible integration/rendering failure detail.
  const mapCache = new Map(); // Caches authored interior JSON for static loom targeting.
  const wovenCanvasCache = new Map(); // Stores completed per-item woven portrait layers.
  const wovenCanvasPending = new Map(); // Deduplicates in-flight woven portrait renders.

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
  function clone(value) {
    if (value == null) return value;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
  }
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function makeUid() { return `gcloth_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`; }
  function nowMs() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
  function cssHex(color, fallback = '#7dc89a') {
    const raw = color?.hex || window.DyeSystem?.getById?.(color?.dyeId)?.hex || fallback;
    return /^#[0-9a-f]{6}$/i.test(String(raw)) ? String(raw) : fallback;
  }
  function hexRgb(hex) {
    const match = String(hex || '').match(/^#?([0-9a-f]{6})$/i);
    const value = parseInt(match?.[1] || '7dc89a', 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function liveGear() { return equipmentDeps?.getGearInventory?.() || null; }
  function baseCosmeticId(item) {
    const explicit = String(item?.baseCosmeticId || item?.craftTemplateCosmeticId || ''); // Crafted entries carry the real article id here.
    if (explicit) return explicit;
    const id = String(item?.cosmeticId || ''); // Legacy/store/loot entries use cosmeticId directly.
    return id.includes(SYNTHETIC_MARKER) ? id.split(SYNTHETIC_MARKER)[0] : id;
  }
  function isWeavableClothing(item) {
    const slot = String(item?.slot || ''); // Slot is the stable cloth-category discriminator already used by EquipmentPanel.
    const id = baseCosmeticId(item);
    if (!CLOTHING_SLOTS.includes(slot) || !id || id === BANDOLIER_ID) return false;
    if (slot === 'hat') return id === BASIC_HEADBAND_ID;
    return slot === 'hood' || slot === 'torso' || slot === 'overwear';
  }
  function standardWeightForSlot(slot) { return Math.max(0, finite(BASE_WEIGHT_BY_SLOT[slot], 0)); }
  function weightForTier(slot, tier) {
    const delta = WOOL_TIERS[tier]?.weightDelta || 0; // Light/Heavy shift Standard by one unit.
    return Math.max(1, standardWeightForSlot(slot) + delta);
  }
  function itemArmorWeight(item) {
    if (!isWeavableClothing(item)) return 0;
    const baked = Number(item?.armorWeight); // Crafted items persist their exact authored weight.
    return Number.isFinite(baked) && baked >= 0 ? baked : standardWeightForSlot(item.slot);
  }
  function equippedItems() {
    const gear = liveGear(); // Authoritative live equipped slots.
    return CLOTHING_SLOTS.map(slot => gear?.clothing?.[slot]).filter(Boolean);
  }
  function equippedArmorWeight() { return equippedItems().reduce((sum, item) => sum + itemArmorWeight(item), 0); }
  function armorEffects(weight = equippedArmorWeight()) {
    const units = Math.max(0, finite(weight, 0)); // Shared unit total drives every allowed combat consequence.
    const defenseReduction = Math.min(BALANCE.maxDefenseReduction, units * BALANCE.defensePerUnit);
    const footingResistance = Math.min(BALANCE.maxFootingReduction, units * BALANCE.footingResistancePerUnit);
    return {
      weight: units,
      defenseReduction,
      damageTakenMultiplier: 1 - defenseReduction,
      footingResistance,
      footingLossMultiplier: 1 - footingResistance,
      dodgeMultiplier: Math.max(BALANCE.minDodgeMultiplier, 1 - units * BALANCE.dodgePenaltyPerUnit),
      combatMoveMultiplier: Math.max(BALANCE.minCombatMoveMultiplier, 1 - units * BALANCE.combatMovePenaltyPerUnit),
    };
  }
  function player() { return window.Combat?.deps?.player || null; }
  function isPlayerInCombat(actor = player()) {
    if (!actor) return false;
    const quietSeconds = finite(window.SCRATCHBONES_CONFIG?.game?.combat?.resourceSystem?.quietSeconds, 3); // Matches ResourceSystem's existing quiet/combat window.
    const last = Math.max(finite(actor.lastAttackAttemptAt, -1e12), finite(actor.lastAttackReceivedAt, -1e12));
    return nowMs() - last <= quietSeconds * 1000;
  }
  function isMounted() {
    const state = String(window.Mounts?.rideState || 'none'); // Avoids applying player clothing slowdown to a mount's locomotion.
    return state !== 'none' && state !== 'rushingOut';
  }

  function patchCombatResources() {
    const resources = window.ResourceSystem; // Existing central damage/Footing authority.
    if (resources && !resources.__weavingArmorWeightPatched) {
      if (typeof resources.applyDamage === 'function') {
        const baseApplyDamage = resources.applyDamage.bind(resources); // Preserves every existing damage/affliction wrapper.
        resources.applyDamage = (entity, amount, opts = {}) => baseApplyDamage(
          entity,
          entity === player() ? finite(amount, 0) * armorEffects().damageTakenMultiplier : amount,
          opts,
        );
      }
      if (typeof resources.spendFooting === 'function') {
        const baseSpendFooting = resources.spendFooting.bind(resources); // Preserves prone/perk/recovery behavior.
        resources.spendFooting = (entity, amount, reason = 'hit') => baseSpendFooting(
          entity,
          entity === player() ? finite(amount, 0) * armorEffects().footingLossMultiplier : amount,
          reason,
        );
      }
      resources.__weavingArmorWeightPatched = true;
    }

    const combat = window.Combat; // Existing central movement/update authority.
    if (combat && !combat.__weavingArmorWeightPatched) {
      if (typeof combat.getMovementSpeedMul === 'function') {
        const baseSpeedMul = combat.getMovementSpeedMul.bind(combat); // Keeps all pre-existing movement modifiers multiplicative.
        combat.getMovementSpeedMul = () => {
          const base = finite(baseSpeedMul(), 1);
          return isPlayerInCombat() && !isMounted() ? base * armorEffects().combatMoveMultiplier : base;
        };
      }
      if (typeof combat.update === 'function') {
        const baseUpdate = combat.update.bind(combat); // Used only to observe the ordinary dodge's rising edge.
        let dodgeWasActive = false; // Ensures one weight penalty per dodge, never every frame.
        combat.update = (...args) => {
          const result = baseUpdate(...args);
          const actor = combat.deps?.player;
          const active = !!actor?.dodging;
          if (active && !dodgeWasActive) applyDodgeWeightPenalty(actor);
          dodgeWasActive = active;
          return result;
        };
      }
      combat.__weavingArmorWeightPatched = true;
    }
  }
  function applyDodgeWeightPenalty(actor) {
    if (!actor || !isPlayerInCombat(actor)) return false;
    const multiplier = armorEffects().dodgeMultiplier; // Reduces travel duration and remaining iframes; does not touch stamina or other stats.
    if (multiplier >= 0.9999) return false;
    const beforeT = finite(actor.dodgeT, 0); // Captured for mobile debug visibility.
    if (beforeT > 0) actor.dodgeT = beforeT * multiplier;
    const now = nowMs();
    const beforeInvuln = finite(actor.invulnUntil, 0); // Captured for mobile debug visibility.
    if (beforeInvuln > now) actor.invulnUntil = now + (beforeInvuln - now) * multiplier;
    lastDodgePenalty = {
      at: Date.now(), weight: equippedArmorWeight(), multiplier,
      dodgeTBefore: beforeT, dodgeTAfter: finite(actor.dodgeT, 0),
      invulnMsBefore: Math.max(0, beforeInvuln - now), invulnMsAfter: Math.max(0, finite(actor.invulnUntil, 0) - now),
    };
    return true;
  }

  function articleLabel(item) {
    const id = baseCosmeticId(item); // Real base id lets synthetic crafted copies retain canonical article naming.
    const catalog = window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [];
    return String(catalog.find(entry => entry?.id === id)?.label || item?.originalArticleLabel || item?.baseArticleLabel || item?.baseLabel || item?.label || 'Clothing');
  }
  function clothingSprite(item) {
    const id = baseCosmeticId(item); // Crafted variants deliberately reuse obtained article art.
    return item?.sprite || window.EquipmentPanel?.clothingSpriteForCosmetic?.(id) || window.SCRATCHBONES_CONFIG?.game?.inventory?.clothingSprites?.[id] || null;
  }
  function hasSecondaryDye(slot) { return slot === 'hood' || slot === 'overwear'; }
  function tintKey(slot, suffix = '') {
    const base = slot === 'hat' ? 'HAT' : slot === 'hood' ? 'HOOD' : slot === 'torso' ? 'TORSO' : slot === 'overwear' ? 'CLOTH' : '';
    return base ? base + suffix : '';
  }
  function isCrafted(item) { return !!item?.craftedClothing && !!item?.baseCosmeticId; }

  function patchEquipmentPanel() {
    const panel = window.EquipmentPanel; // Existing gear/save/redye owner.
    if (!panel || panel.__weavingSystemPatched) return;
    if (typeof panel.init === 'function') {
      const baseInit = panel.init.bind(panel); // Captures the same live dependency bag instead of duplicating state.
      panel.init = (deps, ...rest) => {
        equipmentDeps = deps;
        window.PatternLibrary?.init?.({ getGearInventory: deps?.getGearInventory, saveGearInventory: deps?.saveGearInventory }); // Keeps shared patterns character-scoped through the live gear getter.
        const result = baseInit(deps, ...rest);
        installGearTracking();
        return result;
      };
    }
    if (typeof panel.applyGearClothingToPlayerData === 'function') {
      const baseApply = panel.applyGearClothingToPlayerData.bind(panel); // Retains normal slot/tint behavior while translating synthetic ids after it runs.
      panel.applyGearClothingToPlayerData = playerData => {
        const sanitized = {
          ...playerData,
          equippedCosmetics: (Array.isArray(playerData?.equippedCosmetics) ? playerData.equippedCosmetics : []).filter(id => !String(id).includes(SYNTHETIC_MARKER)),
        }; // Removes stale unique crafted ids before the existing equipment pass.
        const result = baseApply(sanitized);
        const equippedCosmetics = new Set(Array.isArray(result?.equippedCosmetics) ? result.equippedCosmetics : []);
        const bodyColors = { ...(result?.appearance?.bodyColors || {}) };
        const gear = liveGear();
        for (const slot of CLOTHING_SLOTS) {
          const item = gear?.clothing?.[slot];
          if (!isCrafted(item)) continue;
          equippedCosmetics.delete(item.cosmeticId);
          equippedCosmetics.add(item.baseCosmeticId);
          if (item.wovenPattern && item.colorC) bodyColors[tintKey(slot, '_C')] = { ...item.colorC };
        }
        return { ...result, equippedCosmetics: [...equippedCosmetics], appearance: { ...(result?.appearance || {}), bodyColors } };
      };
    }
    panel.__weavingSystemPatched = true;
  }

  function patchFurniturePlacer() {
    const placer = window.FurniturePlacer; // Existing placed-furniture registry owner.
    if (!placer || placer.__weavingSystemPatched || typeof placer.init !== 'function') return;
    const baseInit = placer.init.bind(placer); // Captures placed furniture/defs without creating a second registry.
    placer.init = (deps, ...rest) => {
      furnitureDeps = deps;
      const result = baseInit(deps, ...rest);
      scheduleTargetRefresh();
      return result;
    };
    placer.__weavingSystemPatched = true;
  }

  function dyeChoices() {
    window.DyeSystem?.ensureCollection?.();
    return (window.DyeSystem?.ownedByHue?.() || []).flatMap(group => group.dyes || []); // No article-local extras: crafting uses only starter + globally unlocked dyes.
  }
  function dyeColor(id) { return window.DyeSystem?.toClothingColor?.(window.DyeSystem?.getById?.(id)) || null; }
  function rememberDyes(item) {
    item.articleDyeIds = unique([...(item.articleDyeIds || []), item.colorA?.dyeId, item.colorB?.dyeId, item.colorC?.dyeId]); // Keeps the crafted item's current A/B/C colors in its ordinary redye pool.
  }
  function ownedArticleTemplates() {
    const gear = liveGear();
    const pack = equipmentDeps?.getPackClothing?.() || []; // Pack ownership unlocks a loom template even before transfer to gear.
    const candidates = [...(gear?.clothingItems || []), ...pack, ...CLOTHING_SLOTS.map(slot => gear?.clothing?.[slot]).filter(Boolean)];
    const byId = new Map(); // One recipe row per obtained base article, regardless of how many variants are owned.
    for (const item of candidates) {
      if (!isWeavableClothing(item)) continue;
      const id = baseCosmeticId(item);
      if (!id || byId.has(id)) continue;
      byId.set(id, { cosmeticId: id, slot: item.slot, label: articleLabel(item), sprite: clothingSprite(item) });
    }
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  function craftGarment(options = {}) {
    const template = ownedArticleTemplates().find(entry => entry.cosmeticId === options.cosmeticId); // Revalidates obtained article at the craft click.
    const tier = WOOL_TIERS[options.woolTier];
    const gear = liveGear();
    if (!template || !tier || !gear || !equipmentDeps?.inventory) return { ok: false, message: 'That clothing recipe is not available.' };

    const ownedDyes = new Set(dyeChoices().map(dye => dye.id)); // Enforces starter/global dye ownership.
    if (!ownedDyes.has(options.dyeAId)) return { ok: false, message: 'Choose an unlocked primary dye.' };
    if (hasSecondaryDye(template.slot) && !ownedDyes.has(options.dyeBId)) return { ok: false, message: 'Choose an unlocked trim dye.' };
    if (options.patternData && !ownedDyes.has(options.dyeCId)) return { ok: false, message: 'Choose an unlocked pattern dye.' };

    const cost = WOOL_COST_BY_SLOT[template.slot] || 1; // Material units consumed for this coverage slot.
    const owned = finite(equipmentDeps.inventory[tier.itemKey], 0);
    if (owned < cost) return { ok: false, message: `Need ${cost} ${tier.label} (${owned} owned).` };

    const uid = makeUid(); // Per-item identity prevents same-article crafted variants from being deduplicated.
    const colorA = dyeColor(options.dyeAId);
    const colorB = hasSecondaryDye(template.slot) ? dyeColor(options.dyeBId) : null;
    const colorC = options.patternData ? dyeColor(options.dyeCId) : null;
    const tierLabel = options.woolTier === 'light' ? 'Light' : 'Heavy';
    const item = {
      uid,
      cosmeticId: `${template.cosmeticId}${SYNTHETIC_MARKER}${uid}`,
      baseCosmeticId: template.cosmeticId,
      craftTemplateCosmeticId: template.cosmeticId,
      craftedClothing: true,
      woolTier: options.woolTier,
      woolItemKey: tier.itemKey,
      armorWeight: weightForTier(template.slot, options.woolTier),
      slot: template.slot,
      originalArticleLabel: template.label,
      baseArticleLabel: template.label,
      baseLabel: `${tierLabel} ${template.label}`,
      label: `${tierLabel} ${template.label}`,
      colorA,
      colorB,
      colorC,
      articleDyeIds: unique([colorA?.dyeId, colorB?.dyeId, colorC?.dyeId]),
      sprite: template.sprite,
      sellPrice: 0,
      wovenPatternId: options.patternId || null,
      wovenPatternLabel: options.patternLabel || (options.patternData ? 'Custom pattern' : null),
      wovenPattern: options.patternData ? clone(options.patternData) : null,
      craftedAt: Date.now(),
    }; // Weight + pattern are baked into this exact garment; only dye channels remain mutable.

    equipmentDeps.inventory[tier.itemKey] = owned - cost;
    equipmentDeps.clampInventoryStack?.(tier.itemKey);
    gear.clothingItems ||= [];
    gear.clothingItems.push(item);
    equipmentDeps.saveGearInventory?.();
    equipmentDeps.saveMemberWorldData?.();
    window.EquipmentPanel?.buildEquipmentSlots?.();
    equipmentDeps.buildInventoryGrid?.();
    lastCraft = { ok: true, at: Date.now(), uid, baseCosmeticId: template.cosmeticId, tier: options.woolTier, weight: item.armorWeight, pattern: !!item.wovenPattern };
    return { ok: true, item, message: `Wove ${item.baseLabel} (${item.armorWeight} weight). Added to gear.` };
  }

  function targetPointTiles() {
    const debug = window.__hobunjiFurnitureDebug;
    const actor = debug?.playerState;
    const angleDeg = Number(debug?.targetAimAngleDeg); // Existing aim direction shared by other furniture interaction bridges.
    if (!Number.isFinite(actor?.x) || !Number.isFinite(actor?.y) || !Number.isFinite(angleDeg)) return null;
    const orbit = finite(window.SCRATCHBONES_CONFIG?.game?.input?.targeting?.orbitRadiusTiles, 0.62);
    const angle = angleDeg * Math.PI / 180;
    return { col: (actor.x + Math.cos(angle) * TILE_SIZE * orbit) / TILE_SIZE, row: (actor.y + Math.sin(angle) * TILE_SIZE * orbit) / TILE_SIZE };
  }
  function isLoom(key, def = null) {
    const ids = [key, def?.itemKey, def?.key].map(value => String(value || '')); // Handles placed-furniture and authored-interior naming.
    return ids.some(id => id === 'loomFurniture' || id === 'loom' || /(^|_)loom($|_)/i.test(id)) || /\bloom\b/i.test(String(def?.name || def?.label || ''));
  }
  function placedLoom() {
    const target = targetPointTiles();
    const placed = furnitureDeps?.getPlacedFurniture?.() || [];
    if (!target || !placed.length) return null;
    const decorative = furnitureDeps?.getDecorativeFurnitureDefs?.() || {};
    const processing = furnitureDeps?.getProcessingFurnitureDefs?.() || {};
    const candidates = placed.map(object => {
      const def = object.placementKind === 'processing' ? processing[object.key] : decorative[object.key]; // Existing placement kind chooses the canonical def table.
      if (!isLoom(object.key, def)) return null;
      const distance = Math.hypot(target.col - (finite(object.col) + 0.5), target.row - (finite(object.row) + 0.5));
      return { source: 'placed', id: object.id || null, key: object.key, itemKey: def?.itemKey || null, col: object.col, row: object.row, distance };
    }).filter(Boolean).filter(entry => entry.distance <= LOOM_TARGET_RADIUS_TILES).sort((a, b) => a.distance - b.distance);
    return candidates[0] || null;
  }
  async function authoredLoom() {
    const area = window.__hobunjiFurnitureDebug?.getCurrentArea?.(); // Authored interiors expose map_i_* through this existing debug bridge.
    const target = targetPointTiles();
    if (!target || typeof area !== 'string' || !/^map_i_/.test(area)) return null;
    if (!mapCache.has(area)) {
      mapCache.set(area, fetch(`config/maps/${encodeURIComponent(area)}.json`, { cache: 'no-store' }).then(response => response.ok ? response.json() : null).catch(error => {
        lastError = `loom map: ${error?.message || error}`;
        return null;
      }));
    }
    const map = await mapCache.get(area);
    const candidates = (map?.furniture || []).filter(piece => isLoom(piece?.itemKey || piece?.key, piece)).map(piece => ({
      source: 'authored', area, id: piece.id || null, key: piece.key || null, itemKey: piece.itemKey || null,
      col: finite(piece.col), row: finite(piece.row), distance: Math.hypot(target.col - (finite(piece.col) + 0.5), target.row - (finite(piece.row) + 0.5)),
    })).filter(entry => entry.distance <= LOOM_TARGET_RADIUS_TILES).sort((a, b) => a.distance - b.distance);
    return candidates[0] || null;
  }
  async function refreshLoomTarget() {
    const token = ++targetRefreshToken; // Makes slower authored-map fetches harmless after a newer target refresh.
    const placed = placedLoom();
    const authored = placed ? null : await authoredLoom();
    if (token !== targetRefreshToken) return activeLoom;
    activeLoom = placed || authored || null;
    syncLoomActionButton();
    return activeLoom;
  }
  function scheduleTargetRefresh() {
    if (targetRefreshScheduled) return;
    targetRefreshScheduled = true;
    queueMicrotask(() => {
      targetRefreshScheduled = false;
      refreshLoomTarget().catch(error => { lastError = `loom target: ${error?.message || error}`; });
    });
  }
  function cleanupLoomButton(button) {
    if (!button || button.dataset.weavingLoomInjected !== '1') return;
    delete button.dataset.weavingLoomInjected;
    if (button.dataset.action === 'open_weaving_loom') delete button.dataset.action;
    button.classList.add('abt-hidden');
    button.classList.remove('blocked');
    button.setAttribute('aria-hidden', 'true');
    button.innerHTML = '';
    button.removeAttribute('title');
  }
  function syncLoomActionButton() {
    const buttons = ACTION_BUTTON_IDS.map(id => document.getElementById(id)).filter(Boolean); // Reuses whichever normal action slot is currently free.
    const existing = buttons.find(button => button.dataset.weavingLoomInjected === '1');
    if (!activeLoom || loomOpen) { cleanupLoomButton(existing); return; }
    const host = existing || buttons.find(button => button.classList.contains('abt-hidden') && button.dataset.npcFurnitureWardrobeInjected !== '1');
    if (!host) return;
    const html = '<span class="abt-icon">🧶</span><span class="abt-label">Loom</span>'; // Stable markup comparison avoids MutationObserver churn.
    if (host.dataset.weavingLoomInjected !== '1') host.dataset.weavingLoomInjected = '1';
    if (host.dataset.action !== 'open_weaving_loom') host.dataset.action = 'open_weaving_loom';
    host.classList.remove('abt-hidden', 'blocked');
    host.removeAttribute('aria-hidden');
    if (host.title !== 'Use Loom') host.title = 'Use Loom';
    if (host.innerHTML !== html) host.innerHTML = html;
  }
  function installLoomInteraction() {
    if (document.documentElement.dataset.weavingLoomInstalled === '1') return;
    document.documentElement.dataset.weavingLoomInstalled = '1';
    const intercept = event => {
      const button = event.target?.closest?.('button'); // Capturing listener prevents the underlying generic action from firing too.
      if (!button || button.dataset.action !== 'open_weaving_loom' || button.dataset.weavingLoomInjected !== '1') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'pointerup' || (event.type === 'click' && event.detail === 0)) openLoom(); // Pointer opens once; zero-detail click preserves keyboard activation.
    };
    document.addEventListener('pointerdown', intercept, true);
    document.addEventListener('pointerup', intercept, true);
    document.addEventListener('click', intercept, true);
    const host = document.getElementById('actionStack') || document.body; // Existing action-stack mutations already follow movement/context changes.
    if (host && window.MutationObserver) new MutationObserver(scheduleTargetRefresh).observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-action'] });
    scheduleTargetRefresh();
  }

  function installGearTracking() {
    const annotate = () => {
      const gear = liveGear();
      const ownedCells = [...document.querySelectorAll('#invEquipSection .clothing-owned-slot')]; // EquipmentPanel renders these in clothingItems order.
      (gear?.clothingItems || []).filter(Boolean).forEach((item, index) => { if (ownedCells[index]) ownedCells[index].dataset.weavingClothingUid = item.uid || ''; });
      const slotCells = [...document.querySelectorAll('#invEquipSection .clothing-slot')]; // Slot row is fixed hat/hood/torso/overwear order.
      CLOTHING_SLOTS.forEach((slot, index) => { if (slotCells[index]) slotCells[index].dataset.weavingClothingUid = gear?.clothing?.[slot]?.uid || ''; });
    };
    const section = document.getElementById('invEquipSection');
    if (section && section.dataset.weavingObserved !== '1' && window.MutationObserver) {
      section.dataset.weavingObserved = '1';
      new MutationObserver(annotate).observe(section, { subtree: true, childList: true });
    }
    annotate();
    if (document.documentElement.dataset.weavingGearClicks === '1') return;
    document.documentElement.dataset.weavingGearClicks = '1';
    document.addEventListener('click', event => {
      const cell = event.target?.closest?.('[data-weaving-clothing-uid]');
      if (cell?.dataset.weavingClothingUid) activeGearUid = cell.dataset.weavingClothingUid;
      if (!event.target?.closest?.('.ii-btn.redye')) return;
      const item = (liveGear()?.clothingItems || []).find(entry => entry?.uid === activeGearUid); // Woven copies alone need the extra C channel.
      if (!item?.wovenPattern) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openWovenRedye(item);
    }, true);
  }

  function openWovenRedye(item) {
    const panel = document.getElementById('dyePanel');
    const title = document.getElementById('dyePanelTitle');
    const tabs = document.getElementById('dyePanelSubslots');
    const groups = document.getElementById('dyePanelGroups');
    const preview = document.getElementById('dyePanelPreview');
    const apply = document.getElementById('dyePanelApply');
    const cancel = document.getElementById('dyePanelCancel');
    const close = document.getElementById('dyePanelClose');
    if (!panel || !title || !tabs || !groups || !preview || !apply || !cancel || !close) return false;

    window.DyeSystem?.ensureCollection?.();
    rememberDyes(item);
    const original = { colorA: clone(item.colorA), colorB: clone(item.colorB), colorC: clone(item.colorC), label: item.label, articleDyeIds: [...(item.articleDyeIds || [])] }; // Cancel restores preview mutations completely.
    const subslots = hasSecondaryDye(item.slot) ? ['A', 'B', 'C'] : ['A', 'C']; // C is always the woven pattern color.
    const pending = { A: item.colorA?.dyeId || null, B: item.colorB?.dyeId || null, C: item.colorC?.dyeId || item.colorA?.dyeId || null };
    let active = 'A'; // Current color channel shown in the shared dye picker.
    const isWorn = () => liveGear()?.clothing?.[item.slot]?.uid === item.uid;
    const closePanel = () => { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); };
    const revert = () => {
      item.colorA = original.colorA; item.colorB = original.colorB; item.colorC = original.colorC; item.label = original.label; item.articleDyeIds = [...original.articleDyeIds];
      if (isWorn()) equipmentDeps?.refreshPlayerAvatar?.();
    };
    const livePreview = () => {
      for (const key of subslots) {
        const dye = window.DyeSystem?.getById?.(pending[key]); // Existing catalog entry converted through the normal clothing color shape.
        if (dye) item[`color${key}`] = window.DyeSystem.toClothingColor(dye);
      }
      rememberDyes(item);
      preview.innerHTML = '';
      for (const key of subslots) {
        const dye = window.DyeSystem?.getById?.(pending[key]);
        if (!dye) continue;
        const chip = document.createElement('span');
        chip.className = 'dye-preview-chip'; chip.style.background = dye.hex; chip.title = `${key === 'A' ? 'Primary' : key === 'B' ? 'Trim' : 'Pattern'}: ${dye.label}`;
        preview.appendChild(chip);
      }
      const label = document.createElement('span'); label.className = 'dye-preview-label'; label.textContent = `${item.baseLabel || articleLabel(item)} — pattern uses Dye C`; preview.appendChild(label);
      if (isWorn()) equipmentDeps?.refreshPlayerAvatar?.();
    };
    const renderTabs = () => {
      tabs.innerHTML = '';
      for (const key of subslots) {
        const button = document.createElement('button');
        button.className = `dye-subslot-btn${active === key ? ' active' : ''}`; button.textContent = key === 'A' ? 'Primary' : key === 'B' ? 'Trim' : 'Pattern';
        button.onclick = () => { active = key; renderTabs(); renderGroups(); };
        tabs.appendChild(button);
      }
    };
    const renderGroups = () => {
      groups.innerHTML = '';
      for (const group of window.DyeSystem?.ownedByHue?.(item.articleDyeIds) || []) {
        const section = document.createElement('div'); section.className = 'dye-hue-group';
        const heading = document.createElement('div'); heading.className = 'dye-hue-heading'; heading.textContent = group.label; section.appendChild(heading);
        const row = document.createElement('div'); row.className = 'dye-swatch-row';
        for (const dye of group.dyes || []) {
          const swatch = document.createElement('button'); swatch.className = `dye-swatch${pending[active] === dye.id ? ' selected' : ''}`; swatch.style.background = dye.hex; swatch.title = dye.label;
          swatch.onclick = () => { pending[active] = dye.id; renderGroups(); livePreview(); };
          row.appendChild(swatch);
        }
        section.appendChild(row); groups.appendChild(section);
      }
    };

    title.textContent = `Redye — ${item.baseLabel || articleLabel(item)}`;
    renderTabs(); renderGroups(); livePreview();
    panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false');
    cancel.onclick = () => { revert(); closePanel(); };
    close.onclick = () => { revert(); closePanel(); };
    apply.onclick = () => {
      if (!pending.A || !pending.C || (hasSecondaryDye(item.slot) && !pending.B)) { equipmentDeps?.showToast?.('Choose a dye for each available slot.', false); return; }
      livePreview();
      const dyeA = window.DyeSystem?.getById?.(pending.A); // Used only for the familiar EquipmentPanel item label.
      const dyeB = hasSecondaryDye(item.slot) ? window.DyeSystem?.getById?.(pending.B) : null;
      item.label = `${dyeA?.label || ''}${dyeB ? ` & ${dyeB.label}` : ''} ${item.baseLabel || articleLabel(item)}`.trim();
      rememberDyes(item);
      equipmentDeps?.saveGearInventory?.();
      wovenCanvasCache.clear(); wovenCanvasPending.clear();
      if (isWorn()) equipmentDeps?.refreshPlayerAvatar?.();
      equipmentDeps?.showToast?.(`Redyed ${item.baseLabel || articleLabel(item)}. Pattern color is Dye C.`, true);
      closePanel(); window.EquipmentPanel?.buildEquipmentSlots?.();
    };
    return true;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image(); image.crossOrigin = 'anonymous'; image.onload = () => resolve(image); image.onerror = reject; image.src = src; // Existing sprite/Data-URL pattern loading behavior.
    });
  }
  async function primaryGarmentCanvas(sprite, dyeId) {
    if (!sprite) return null;
    const dye = window.DyeSystem?.getById?.(dyeId); // Loom preview uses the same existing sprite recolorer where available.
    const tint = parseInt(String(dye?.hex || '#7dc89a').replace('#', ''), 16);
    if (typeof window.SpriteRecolor?.getRecoloredCanvas === 'function') return window.SpriteRecolor.getRecoloredCanvas(sprite, tint, 'direct');
    const image = await loadImage(sprite);
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth || image.width; canvas.height = image.naturalHeight || image.height; canvas.getContext('2d').drawImage(image, 0, 0); return canvas;
  }
  function alphaTemplateDataUrl(canvas) {
    const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
    const ctx = out.getContext('2d', { willReadFrequently: true }); ctx.drawImage(canvas, 0, 0);
    const image = ctx.getImageData(0, 0, out.width, out.height); // Converts garment alpha into ToolMetalRecolor's canonical source hue.
    const [r, g, b] = hexRgb(window.ToolMetalRecolor?.SOURCE_HEX || '#5A8480');
    for (let i = 0; i < image.data.length; i += 4) {
      if (image.data[i + 3] <= 16) { image.data[i + 3] = 0; continue; }
      image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b;
    }
    ctx.putImageData(image, 0, 0);
    return out.toDataURL('image/png');
  }
  async function exactPatternMask(baseCanvas, pattern) {
    if (!pattern?.motifDataUrl || !window.ToolMetalRecolor?.getRecoloredCanvas) return null;
    const authored = { ...clone(pattern), invert: !pattern.invert }; // Verdigris authored mode colors the complement of its cleared motif; inversion makes green pixels equal weaving ink.
    const encoded = await window.ToolMetalRecolor.getRecoloredCanvas(alphaTemplateDataUrl(baseCanvas), {
      sourceHex: window.ToolMetalRecolor.SOURCE_HEX || '#5A8480', targetHex: '#ff0000', verdigrisHex: '#00ff00', oxidationAmount: 1,
      outlineWidth: 0, saturationMode: 'target', authoredPattern: authored,
    }); // Reuses the exact triangle/grid motif tessellation engine instead of reimplementing it.
    const pixels = encoded.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, encoded.width, encoded.height).data;
    const mask = new Uint8Array(encoded.width * encoded.height); // Green-dominant pixels are the desired woven motif.
    for (let p = 0, i = 0; i < pixels.length; i += 4, p++) if (pixels[i + 1] > pixels[i] + 8 && pixels[i + 3] > 16) mask[p] = 1;
    return mask;
  }
  async function composePattern(baseCanvas, pattern, patternColor) {
    if (!baseCanvas || !pattern?.motifDataUrl || !patternColor) return baseCanvas;
    const canvas = document.createElement('canvas'); canvas.width = baseCanvas.width; canvas.height = baseCanvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(baseCanvas, 0, 0);
    const mask = await exactPatternMask(baseCanvas, pattern);
    if (!mask) return canvas;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const [tr, tg, tb] = hexRgb(cssHex(patternColor)); // Dye C target RGB painted while preserving garment luminance.
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      if (!mask[p] || image.data[i + 3] <= 16) continue;
      const lum = (0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2]) / 255;
      if (lum < 0.055) continue; // Keeps authored black outlines intact.
      const shade = clamp(lum / 0.55, 0.38, 1.28);
      image.data[i] = clamp(Math.round(tr * shade), 0, 255); image.data[i + 1] = clamp(Math.round(tg * shade), 0, 255); image.data[i + 2] = clamp(Math.round(tb * shade), 0, 255);
    }
    ctx.putImageData(image, 0, 0); return canvas;
  }
  function patchPortraitTint() {
    const original = window.getBodyTintedCanvas; // Existing synchronous clothing/body tint seam in portrait-utils.
    if (typeof original !== 'function' || original.__weavingPatternWrapped) return;
    const wrapped = function weavingPatternTint(img, sourceKey, color, speciesId = '', slot = 'A') {
      const base = original(img, sourceKey, color, speciesId, slot);
      const slotName = slot === 'HAT' ? 'hat' : slot === 'HOOD' ? 'hood' : slot === 'TORSO' ? 'torso' : slot === 'CLOTH' ? 'overwear' : null; // Pattern belongs only on each garment's primary dyed layer.
      const item = slotName ? liveGear()?.clothing?.[slotName] : null;
      if (!isCrafted(item) || !item.wovenPattern || !item.colorC) return base;
      const width = base?.naturalWidth || base?.width || 0, height = base?.naturalHeight || base?.height || 0;
      if (!width || !height) return base;
      const key = [item.uid, slotName, sourceKey || '', width, height, cssHex(item.colorC), JSON.stringify(item.wovenPattern)].join('|'); // Includes every visual input that can change a baked pattern render.
      if (wovenCanvasCache.has(key)) return wovenCanvasCache.get(key);
      if (!wovenCanvasPending.has(key)) {
        const pending = composePattern(base, item.wovenPattern, item.colorC).then(canvas => {
          wovenCanvasPending.delete(key); wovenCanvasCache.set(key, canvas);
          while (wovenCanvasCache.size > PATTERN_CACHE_LIMIT) wovenCanvasCache.delete(wovenCanvasCache.keys().next().value);
          requestAnimationFrame(() => equipmentDeps?.refreshPlayerAvatar?.()); // First pass seeds async mask; next normal avatar pass receives cached synchronous canvas.
          return canvas;
        }).catch(error => { wovenCanvasPending.delete(key); lastError = `woven render: ${error?.message || error}`; return base; });
        wovenCanvasPending.set(key, pending);
      }
      return base;
    };
    wrapped.__weavingPatternWrapped = true;
    wrapped.__weavingPatternOriginal = original;
    window.getBodyTintedCanvas = wrapped;
  }

  function ensureLoomUi() {
    if (document.getElementById('weavingLoomPanel')) return;
    const style = document.createElement('style'); // Self-contained responsive UI avoids another stylesheet dependency.
    style.id = 'weavingLoomStyle';
    style.textContent = `#weavingLoomPanel{position:fixed;z-index:15030;left:50%;top:50%;transform:translate(-50%,-50%);width:min(760px,94vw);max-height:88vh;overflow:auto;display:none;background:rgba(20,17,14,.97);border:1px solid rgba(235,214,176,.42);border-radius:14px;color:#f4ead8;box-shadow:0 18px 70px rgba(0,0,0,.62);font:14px/1.35 system-ui,sans-serif;padding:16px;box-sizing:border-box}#weavingLoomPanel.open{display:block}.weave-head{display:flex;align-items:center;gap:10px}.weave-head h2{margin:0;flex:1;font-size:20px}.weave-btn{border:1px solid rgba(235,214,176,.35);background:#3a3027;color:#fff;border-radius:8px;padding:9px 12px}.weave-btn.primary{background:#6c4f2e}.weave-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(220px,.9fr);gap:14px;margin-top:12px}.weave-card{border:1px solid rgba(235,214,176,.18);border-radius:10px;padding:11px;background:rgba(255,255,255,.035)}.weave-row{display:grid;grid-template-columns:130px 1fr;gap:8px;align-items:center;margin:8px 0}.weave-row select{width:100%;background:#211c18;color:#fff;border:1px solid rgba(235,214,176,.3);border-radius:7px;padding:8px}.weave-note{opacity:.78;font-size:12px}.weave-preview{width:100%;min-height:220px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.22);border-radius:8px;overflow:hidden}.weave-preview canvas{max-width:100%;max-height:300px}.weave-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.weave-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;font-size:12px}.weave-stat{background:rgba(255,255,255,.04);padding:7px;border-radius:7px}.weave-debug{margin-top:10px;font:11px/1.35 ui-monospace,monospace;white-space:pre-wrap;opacity:.8}@media(max-width:700px){#weavingLoomPanel{top:52%;padding:12px}.weave-grid{grid-template-columns:1fr}.weave-row{grid-template-columns:100px 1fr}.weave-preview{min-height:150px}.weave-preview canvas{max-height:210px}}`;
    document.head.appendChild(style);
    const panel = document.createElement('div'); panel.id = 'weavingLoomPanel'; panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = '<div class="weave-head"><h2>🧶 Loom</h2><button class="weave-btn" id="weavingLoomClose">Close</button></div><div id="weavingLoomBody"></div>';
    document.body.appendChild(panel); document.getElementById('weavingLoomClose').onclick = closeLoom;
  }
  async function initialLoomState() {
    window.PatternLibrary?.ensureCollection?.();
    const templates = ownedArticleTemplates(); // Obtained clothing articles available to reproduce.
    const dyes = dyeChoices(); // Starter + global unlocks only.
    return {
      templates, dyes, patterns: window.PatternLibrary?.listAvailable?.() || [],
      cosmeticId: templates[0]?.cosmeticId || null, woolTier: 'light',
      dyeAId: dyes[0]?.id || null, dyeBId: dyes[0]?.id || null, dyeCId: dyes[0]?.id || null,
      patternId: null, patternLabel: null, patternData: null,
    };
  }
  function selectedTemplate() { return loomState?.templates?.find(entry => entry.cosmeticId === loomState.cosmeticId) || null; }
  function selectOptions(items, selected, value, label) {
    return items.map(item => `<option value="${esc(value(item))}"${value(item) === selected ? ' selected' : ''}>${esc(label(item))}</option>`).join('');
  }
  async function renderPreview() {
    const preview = document.querySelector('#weavingLoomBody .weave-preview');
    const template = selectedTemplate();
    if (!preview || !template) return;
    const token = ++previewToken; // Only newest selection may replace the preview.
    preview.innerHTML = '<span class="weave-note">Rendering…</span>';
    try {
      const base = await primaryGarmentCanvas(template.sprite, loomState.dyeAId);
      const finalCanvas = loomState.patternData ? await composePattern(base, loomState.patternData, dyeColor(loomState.dyeCId)) : base;
      if (token !== previewToken) return;
      preview.innerHTML = '';
      if (!finalCanvas) { preview.textContent = 'No sprite preview available.'; return; }
      const canvas = document.createElement('canvas'); canvas.width = finalCanvas.width; canvas.height = finalCanvas.height; canvas.getContext('2d').drawImage(finalCanvas, 0, 0); preview.appendChild(canvas);
    } catch (error) { lastError = `loom preview: ${error?.message || error}`; if (token === previewToken) preview.textContent = 'Preview unavailable.'; }
  }
  function renderLoom() {
    const body = document.getElementById('weavingLoomBody');
    if (!body || !loomState) return;
    if (!loomState.templates.length) { body.innerHTML = '<div class="weave-card" style="margin-top:12px">Obtain a cloth clothing article before reproducing it at the loom.</div>'; return; }
    const template = selectedTemplate() || loomState.templates[0];
    loomState.cosmeticId = template.cosmeticId;
    const tier = WOOL_TIERS[loomState.woolTier]; // Current selected wool controls only weight + material key.
    const cost = WOOL_COST_BY_SLOT[template.slot] || 1;
    const owned = finite(equipmentDeps?.inventory?.[tier.itemKey], 0);
    const pieceEffects = armorEffects(weightForTier(template.slot, loomState.woolTier)); // Shows contribution scale for the selected garment itself.
    const patternChoices = [{ id: '', label: 'No pattern' }, ...loomState.patterns.map(entry => ({ id: entry.id, label: entry.label || entry.id }))];
    if (loomState.patternData && !loomState.patternId) patternChoices.push({ id: '__custom__', label: loomState.patternLabel || 'Custom pattern' });
    const selectedPatternId = loomState.patternData && !loomState.patternId ? '__custom__' : (loomState.patternId || '');
    body.innerHTML = `<div class="weave-grid"><div class="weave-card">
      <div class="weave-row"><label>Article</label><select id="weaveArticle">${selectOptions(loomState.templates, loomState.cosmeticId, item => item.cosmeticId, item => item.label)}</select></div>
      <div class="weave-row"><label>Wool</label><select id="weaveTier"><option value="light"${loomState.woolTier === 'light' ? ' selected' : ''}>Light Wool — ${weightForTier(template.slot, 'light')} weight</option><option value="heavy"${loomState.woolTier === 'heavy' ? ' selected' : ''}>Heavy Wool — ${weightForTier(template.slot, 'heavy')} weight</option></select></div>
      <div class="weave-note">Looted/bought ${esc(template.label)} is Standard at ${standardWeightForSlot(template.slot)} weight. The source article is not consumed.</div>
      <div class="weave-row"><label>Primary dye</label><select id="weaveDyeA">${selectOptions(loomState.dyes, loomState.dyeAId, dye => dye.id, dye => dye.label)}</select></div>
      ${hasSecondaryDye(template.slot) ? `<div class="weave-row"><label>Trim dye</label><select id="weaveDyeB">${selectOptions(loomState.dyes, loomState.dyeBId, dye => dye.id, dye => dye.label)}</select></div>` : ''}
      <div class="weave-row"><label>Pattern</label><select id="weavePattern">${patternChoices.map(entry => `<option value="${esc(entry.id)}"${entry.id === selectedPatternId ? ' selected' : ''}>${esc(entry.label)}</option>`).join('')}</select></div>
      <div class="weave-row"><label>Pattern dye (C)</label><select id="weaveDyeC"${loomState.patternData ? '' : ' disabled'}>${selectOptions(loomState.dyes, loomState.dyeCId, dye => dye.id, dye => dye.label)}</select></div>
      <div class="weave-actions"><button class="weave-btn" id="weaveAuthor">Author / Edit Pattern</button><button class="weave-btn primary" id="weaveCraft">Craft</button></div>
      <div class="weave-note">Requires ${cost} ${esc(tier.label)} — ${owned} owned.</div>
    </div><div class="weave-card"><div class="weave-preview"></div><div class="weave-stats" style="margin-top:10px">
      <div class="weave-stat"><b>${pieceEffects.weight}</b> weight units</div><div class="weave-stat"><b>${Math.round(pieceEffects.defenseReduction * 100)}%</b> Defense contribution</div>
      <div class="weave-stat"><b>${Math.round(pieceEffects.footingResistance * 100)}%</b> Footing resistance</div><div class="weave-stat"><b>${Math.round((1 - pieceEffects.dodgeMultiplier) * 100)}%</b> dodge penalty</div>
      <div class="weave-stat"><b>${Math.round((1 - pieceEffects.combatMoveMultiplier) * 100)}%</b> combat move penalty</div>
    </div><details><summary>Weight / loom debug</summary><div class="weave-debug" id="weaveDebug"></div></details></div></div>`;

    const bind = (id, key) => { const select = document.getElementById(id); if (select) select.onchange = () => { loomState[key] = select.value; renderLoom(); }; };
    bind('weaveArticle', 'cosmeticId'); bind('weaveTier', 'woolTier'); bind('weaveDyeA', 'dyeAId'); bind('weaveDyeB', 'dyeBId'); bind('weaveDyeC', 'dyeCId');
    const patternSelect = document.getElementById('weavePattern');
    if (patternSelect) patternSelect.onchange = () => {
      const id = patternSelect.value; // UI sentinel keeps an unsaved custom authoring draft selected.
      if (id === '__custom__') loomState.patternId = null;
      else if (!id) { loomState.patternId = null; loomState.patternLabel = null; loomState.patternData = null; }
      else { const entry = loomState.patterns.find(row => row.id === id); loomState.patternId = id; loomState.patternLabel = entry?.label || id; loomState.patternData = clone(window.PatternLibrary?.getById?.(id) || null); }
      renderLoom();
    };
    document.getElementById('weaveAuthor').onclick = openPatternAuthoring;
    document.getElementById('weaveCraft').onclick = () => {
      const result = craftGarment(loomState); equipmentDeps?.showToast?.(result.message, result.ok);
      if (result.ok) { loomState.templates = ownedArticleTemplates(); renderLoom(); }
      else { lastCraft = { ok: false, at: Date.now(), message: result.message }; updateDebug(); }
    };
    renderPreview(); updateDebug();
  }
  function openPatternAuthoring() {
    const template = selectedTemplate();
    if (!template || !window.PatternAuthoring?.openEditor) { equipmentDeps?.showToast?.('Pattern authoring is unavailable.', false); return; }
    const library = window.PatternLibrary ? {
      list: () => window.PatternLibrary.listAvailable(), get: id => window.PatternLibrary.getById(id),
      save: (label, data) => window.PatternLibrary.saveToLibrary(label, data), remove: id => window.PatternLibrary.removeSaved(id),
    } : null; // Exact same adapter/workflow used by mastered-tool verdigris authoring.
    window.PatternAuthoring.openEditor({
      title: `Author weaving — ${template.label}`,
      motifHint: 'Paint/import a motif, then use the same triangle/grid tiling, placement, scale and rotation workflow as mastered-tool verdigris removal.',
      initialPattern: loomState.patternData ? clone(loomState.patternData) : null,
      library,
      renderPreview: data => primaryGarmentCanvas(template.sprite, loomState.dyeAId).then(base => composePattern(base, data, dyeColor(loomState.dyeCId))),
      onSave: data => { loomState.patternId = null; loomState.patternLabel = 'Custom pattern'; loomState.patternData = clone(data); renderLoom(); return true; },
    });
  }
  async function openLoom() {
    if (!equipmentDeps) { lastError = 'EquipmentPanel dependencies are not ready.'; return false; }
    ensureLoomUi(); loomState = await initialLoomState(); loomOpen = true;
    const panel = document.getElementById('weavingLoomPanel'); panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false'); syncLoomActionButton(); renderLoom(); return true;
  }
  function closeLoom() {
    const panel = document.getElementById('weavingLoomPanel'); if (panel) { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); }
    loomOpen = false; loomState = null; syncLoomActionButton();
  }
  function updateDebug() {
    const node = document.getElementById('weaveDebug'); if (!node) return;
    const info = debugSnapshot();
    node.textContent = [`target: ${info.activeLoom ? `${info.activeLoom.source} ${info.activeLoom.itemKey || info.activeLoom.key || ''}` : 'none'}`, `wool: Light=${info.materials.lightWool} Heavy=${info.materials.heavyWool}`, `equipped weight: ${info.equipped.weight}`, `effects: defense ${Math.round(info.equipped.defenseReduction * 100)}%, footing ${Math.round(info.equipped.footingResistance * 100)}%, dodge x${info.equipped.dodgeMultiplier.toFixed(3)}, combat move x${info.equipped.combatMoveMultiplier.toFixed(3)}`, `patterns cached/pending: ${info.patternCache.ready}/${info.patternCache.pending}`, `last craft: ${info.lastCraft ? JSON.stringify(info.lastCraft) : 'none'}`, `last dodge: ${info.lastDodgePenalty ? JSON.stringify(info.lastDodgePenalty) : 'none'}`, `error: ${info.error || 'none'}`].join('\n');
  }
  function debugSnapshot() {
    const effects = armorEffects(); // Single snapshot makes mobile diagnostics usable without devtools.
    return {
      installed: true, version: VERSION, equipmentReady: !!equipmentDeps, furnitureReady: !!furnitureDeps, panelOpen: loomOpen,
      activeLoom: activeLoom ? { ...activeLoom } : null,
      materials: { lightWool: finite(equipmentDeps?.inventory?.lightWool), heavyWool: finite(equipmentDeps?.inventory?.puktukWool) },
      equippedItems: equippedItems().map(item => ({ uid: item.uid || null, label: item.baseLabel || articleLabel(item), slot: item.slot, weavable: isWeavableClothing(item), tier: item.woolTier || 'standard', weight: itemArmorWeight(item) })),
      equipped: effects, inCombat: isPlayerInCombat(), mounted: isMounted(),
      templateCount: ownedArticleTemplates().length, lastCraft: lastCraft ? { ...lastCraft } : null, lastDodgePenalty: lastDodgePenalty ? { ...lastDodgePenalty } : null,
      patternCache: { ready: wovenCanvasCache.size, pending: wovenCanvasPending.size }, error: lastError,
    };
  }

  function installDom() {
    ensureLoomUi(); installLoomInteraction(); installGearTracking(); patchPortraitTint();
  }

  window.WeavingSystem = {
    version: VERSION,
    BASE_WEIGHT_BY_SLOT,
    WOOL_TIERS,
    BALANCE,
    isWeavableClothing,
    itemArmorWeight,
    equippedArmorWeight,
    armorEffects,
    isPlayerInCombat,
    applyDodgeWeightPenalty,
    ownedArticleTemplates,
    craftGarment,
    refreshLoomTarget,
    openLoom,
    closeLoom,
    debugSnapshot,
  };
  window.__weavingDebug = debugSnapshot;

  patchCombatResources();
  patchEquipmentPanel();
  patchFurniturePlacer();
  patchPortraitTint();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installDom, { once: true });
  else installDom();
})();