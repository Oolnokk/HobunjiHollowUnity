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
  const ACTION_BUTTON_IDS = Object.freeze(['btnAction1', 'btnAction2', 'btnAction3', 'btnItemAction1', 'btnItemAction2']);
  const CLOTHING_SLOTS = Object.freeze(['hat', 'hood', 'torso', 'overwear']);

  let equipmentDeps = null; // Captured from EquipmentPanel.init; used for gear, inventory, saves, and player refresh.
  let furnitureDeps = null; // Captured from FurniturePlacer.init; used for player-placed loom discovery.
  let activeClothingUid = null; // Updated before EquipmentPanel's private detail click handler runs; used to extend redye for woven gear.
  let loomOverlay = null; // Current floating loom UI root; null while closed.
  let loomTarget = null; // Most recently resolved aimed loom, exposed in mobile debug output.
  let lastError = null; // Most recent recoverable integration/rendering error for mobile diagnostics.
  let armorHooksInstalled = false; // Prevents duplicate ResourceSystem/Combat wrapping.
  let portraitHooksInstalled = false; // Prevents duplicate render/tint wrapping.
  let interactionHooksInstalled = false; // Prevents duplicate loom action listeners/observer/timer.
  let stylesInjected = false; // Prevents duplicate loom modal CSS.
  let wasDodging = false; // Rising-edge tracker used to apply weight to an ordinary dodge exactly once.
  let cosmeticsIndexPromise = null; // Shared fetch for cosmetic id -> JSON path lookup.
  const cosmeticConfigPromises = new Map(); // Reuses per-article cosmetic JSON fetches for pattern layer lookup.
  const patternedCanvasCache = new Map(); // Reuses expensive pattern composites across repeated portrait renders.
  const pendingPatternCanvasKeys = new Set(); // Prevents repeated async builds while a synchronous portrait frame uses the unpatterned fallback.
  const authoredLoomPromiseByArea = new Map(); // Caches static interior loom scans so aiming never refetches the same map every poll.
  let targetResolveToken = 0; // Rejects stale async target scans after the player/area has already changed.
  let lastLoomPointerOpenAt = 0; // Prevents the click following a handled pointerup from opening the loom a second time.
  let activePortraitPatternMap = null; // URL -> woven descriptor map, scoped to a player render call only.

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, Number(value) || 0));
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function baseCosmeticId(item) {
    if (!item) return null;
    if (item.baseCosmeticId) return String(item.baseCosmeticId);
    const id = String(item.cosmeticId || '');
    const marker = id.indexOf(CRAFT_ID_MARKER);
    return marker >= 0 ? id.slice(0, marker) : id || null;
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
        const ids = new Set(Array.isArray(out?.equippedCosmetics) ? out.equippedCosmetics : []);
        const colors = { ...(out?.appearance?.bodyColors || {}) };
        const wovenDescriptors = [];
        for (const item of equipped) {
          const baseId = baseCosmeticId(item);
          if (item?.baseCosmeticId && item.cosmeticId) {
            ids.delete(item.cosmeticId);
            if (baseId) ids.add(baseId);
          }
          const cKey = thirdTintKey(item.slot);
          if (cKey && item.colorC) colors[cKey] = { ...item.colorC };
          if (item?.weaving?.pattern && baseId) {
            wovenDescriptors.push({
              uid: item.uid,
              slot: item.slot,
              baseCosmeticId: baseId,
              pattern: clone(item.weaving.pattern),
              colorC: clone(item.colorC),
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

  function patchFurniturePlacer(api) {
    if (!api || api.__clothingWeavingPatched || typeof api.init !== 'function') return;
    const originalInit = api.init.bind(api); // Captures the placed-furniture accessors without changing placement itself.
    api.init = function clothingWeavingFurnitureInit(injected, ...rest) {
      furnitureDeps = injected;
      return originalInit(injected, ...rest);
    };
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
    const candidates = [
      ...(gear.clothingItems || []),
      ...CLOTHING_SLOTS.map(slot => gear.clothing?.[slot]).filter(Boolean),
      ...packClothing(),
    ];
    let changed = false;
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
      changed = true;
    }
    if (changed) equipmentDeps?.saveGearInventory?.();
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
      if (!item?.weaving?.pattern) return;
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
      patternedCanvasCache.clear();
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
      .loomcraft-card{border:1px solid #2c443c;background:rgba(255,255,255,.035);border-radius:12px;padding:11px;margin-bottom:10px}.loomcraft-card h3{font-size:12px;text-transform:uppercase;letter-spacing:.4px;margin:0 0 8px;color:#b9d5cc}
      .loomcraft-field{display:grid;gap:5px;margin-bottom:9px}.loomcraft-field label{font-size:11px;font-weight:800;color:#a9c0b9}.loomcraft-field select,.loomcraft-field button{min-height:38px;border-radius:9px;border:1px solid #3a564d;background:#17232a;color:#eef8f5;padding:7px 9px}
      .loomcraft-row{display:flex;gap:7px;flex-wrap:wrap}.loomcraft-row>*{flex:1 1 130px}.loomcraft-material{cursor:pointer}.loomcraft-material.active{outline:2px solid #7fc7bc;background:#1a3432}.loomcraft-note{font-size:11px;line-height:1.4;color:#9eb6ae}.loomcraft-preview{display:grid;place-items:center;min-height:190px;background:#0a0f12;border:1px solid #294139;border-radius:12px}.loomcraft-preview img{max-width:190px;max-height:190px;image-rendering:pixelated}.loomcraft-stats{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#cde2dc;white-space:pre-line}.loomcraft-craft{width:100%;min-height:44px;border:1px solid #70bcae;background:#173b36;color:#f2fffc;border-radius:11px;font-weight:900}.loomcraft-craft:disabled{opacity:.45}.loomcraft-pattern-actions{display:flex;gap:7px}.loomcraft-pattern-actions button{flex:1}.loomcraft-empty{padding:20px;text-align:center;color:#adc2bc}
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

  async function openLoom() {
    injectStyles();
    closeLoom();
    const blueprints = currentBlueprints();
    if (!blueprints.length) {
      equipmentDeps?.showToast?.('Obtain a cloth garment before using it as a loom template.', false);
      return false;
    }
    const dyes = ownedGlobalDyes();
    if (!dyes.length) {
      equipmentDeps?.showToast?.('No unlocked dyes are available.', false);
      return false;
    }
    const state = {
      blueprintId: blueprints[0].baseCosmeticId, // Used by all loom controls to resolve the currently selected obtained article.
      materialId: 'light', // Used to choose wool key, crafted weight multiplier, and resulting label.
      dyeA: dyes[0].id, // Used as the crafted garment's primary dye.
      dyeB: dyes[Math.min(1, dyes.length - 1)].id, // Used as trim dye on articles whose existing redye workflow has a second channel.
      dyeC: dyes[Math.min(2, dyes.length - 1)].id, // Used only by the baked weaving pattern and later exposed as the third redye channel.
      pattern: null, // Baked into the specific crafted item; null means plain cloth.
      patternId: '', // Used by the library dropdown to identify a collected/saved motif.
      patternLabel: 'None', // Used in the preview/debug copy.
    };

    const overlay = document.createElement('div');
    overlay.className = 'loomcraft-overlay';
    overlay.innerHTML = `
      <div class="loomcraft-panel" role="dialog" aria-modal="true">
        <div class="loomcraft-head"><h2>🧶 Loom</h2><button class="loomcraft-close" type="button" aria-label="Close">✕</button></div>
        <div class="loomcraft-body">
          <div>
            <div class="loomcraft-card"><h3>Garment template</h3><div class="loomcraft-field"><label>Obtained cloth article</label><select data-field="blueprint"></select></div><div class="loomcraft-note">Obtaining an eligible article permanently teaches its loom template. The original article is never consumed.</div></div>
            <div class="loomcraft-card"><h3>Wool weight</h3><div class="loomcraft-row"><button type="button" class="loomcraft-material active" data-material="light">Light Wool</button><button type="button" class="loomcraft-material" data-material="heavy">Heavy Wool</button></div><div class="loomcraft-note" data-material-note></div></div>
            <div class="loomcraft-card"><h3>Default dyes</h3><div class="loomcraft-field"><label>Primary</label><select data-field="dyeA">${dyeOptionHtml(dyes, state.dyeA)}</select></div><div class="loomcraft-field" data-trim-field><label>Trim</label><select data-field="dyeB">${dyeOptionHtml(dyes, state.dyeB)}</select></div><div class="loomcraft-field" data-pattern-dye-field><label>Pattern (third dye slot)</label><select data-field="dyeC">${dyeOptionHtml(dyes, state.dyeC)}</select></div></div>
            <div class="loomcraft-card"><h3>Weaving pattern</h3><div class="loomcraft-field"><label>Pattern library</label><select data-field="pattern"></select></div><div class="loomcraft-pattern-actions"><button type="button" data-act="author">Author custom pattern…</button><button type="button" data-act="clearPattern">Plain cloth</button></div><div class="loomcraft-note">Uses the same saved/unlocked pattern library and authoring workflow as mastered-tool verdigris removal. The motif is baked into this crafted item; only its third dye color remains freely changeable afterward.</div></div>
          </div>
          <div><div class="loomcraft-card"><h3>Preview</h3><div class="loomcraft-preview" data-preview><span class="loomcraft-note">Loading preview…</span></div><div class="loomcraft-stats" data-stats></div></div><button class="loomcraft-craft" type="button" data-act="craft">Craft</button></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    loomOverlay = overlay;

    const blueprintSelect = overlay.querySelector('[data-field="blueprint"]');
    const patternSelect = overlay.querySelector('[data-field="pattern"]');
    for (const bp of blueprints) {
      const option = document.createElement('option');
      option.value = bp.baseCosmeticId;
      option.textContent = bp.label || bp.baseLabel || bp.baseCosmeticId;
      blueprintSelect.appendChild(option);
    }

    function rebuildPatternOptions() {
      patternSelect.innerHTML = '<option value="">None</option>';
      for (const entry of patternLibraryEntries()) {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.label;
        patternSelect.appendChild(option);
      }
      patternSelect.value = state.patternId;
    }

    const selectedBlueprint = () => blueprints.find(bp => bp.baseCosmeticId === state.blueprintId) || blueprints[0];
    const selectedMaterial = () => MATERIALS[state.materialId] || MATERIALS.light;
    const hasSecondary = () => ['hood', 'overwear'].includes(selectedBlueprint()?.slot);
    const dyeById = id => window.DyeSystem?.getById?.(id) || dyes.find(dye => dye.id === id) || dyes[0];

    async function refreshPreview() {
      const bp = selectedBlueprint();
      const material = selectedMaterial();
      const cost = WOOL_COST_BY_SLOT[bp.slot] || 1;
      const owned = Number(equipmentDeps?.inventory?.[material.itemKey]) || 0;
      const weight = standardWeightFor(bp) * material.weightMul;
      overlay.querySelector('[data-trim-field]').style.display = hasSecondary() ? '' : 'none';
      overlay.querySelector('[data-pattern-dye-field]').style.display = state.pattern ? '' : 'none';
      overlay.querySelector('[data-material-note]').textContent = `${material.label}: ${owned} owned · ${cost} required.`;
      overlay.querySelector('[data-stats]').textContent = `Weight: ${weight.toFixed(1)} units\nDefense: +${Math.round(weight * TUNING.defensePerUnit * 100)}%\nFooting resistance: +${Math.round(weight * TUNING.footingResistancePerUnit * 100)}%\nDodge efficacy: −${Math.round(weight * TUNING.dodgePenaltyPerUnit * 100)}%\nCombat movement: −${Math.round(weight * TUNING.combatMovePenaltyPerUnit * 100)}%\nPattern: ${state.patternLabel}`;
      const craft = overlay.querySelector('[data-act="craft"]');
      craft.disabled = owned < cost;
      const preview = overlay.querySelector('[data-preview]');
      preview.innerHTML = '<span class="loomcraft-note">Rendering…</span>';
      try {
        const canvas = await renderPatternedSprite(bp.sprite, state.pattern, dyeById(state.dyeC)?.hex, dyeById(state.dyeA)?.hex);
        if (!loomOverlay || !preview.isConnected) return;
        if (!canvas) { preview.innerHTML = '<span class="loomcraft-note">No sprite preview is mapped for this article.</span>'; return; }
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.alt = `${bp.label || bp.baseCosmeticId} loom preview`;
        preview.innerHTML = '';
        preview.appendChild(img);
      } catch (error) {
        lastError = String(error?.message || error);
        preview.innerHTML = '<span class="loomcraft-note">Preview unavailable; crafting still uses the selected settings.</span>';
      }
    }

    blueprintSelect.onchange = () => { state.blueprintId = blueprintSelect.value; refreshPreview(); };
    overlay.querySelectorAll('[data-material]').forEach(button => {
      button.onclick = () => {
        state.materialId = button.dataset.material;
        overlay.querySelectorAll('[data-material]').forEach(b => b.classList.toggle('active', b === button));
        refreshPreview();
      };
    });
    for (const key of ['dyeA', 'dyeB', 'dyeC']) overlay.querySelector(`[data-field="${key}"]`).onchange = event => { state[key] = event.target.value; refreshPreview(); };
    patternSelect.onchange = () => {
      state.patternId = patternSelect.value;
      state.pattern = state.patternId ? clone(window.PatternLibrary?.getById?.(state.patternId)) : null;
      state.patternLabel = patternSelect.selectedOptions[0]?.textContent || 'None';
      refreshPreview();
    };
    overlay.querySelector('[data-act="clearPattern"]').onclick = () => {
      state.patternId = '';
      state.pattern = null;
      state.patternLabel = 'None';
      rebuildPatternOptions();
      refreshPreview();
    };
    overlay.querySelector('[data-act="author"]').onclick = () => {
      const bp = selectedBlueprint();
      window.PatternAuthoring?.openEditor?.({
        title: `Weave pattern — ${bp.label || bp.baseCosmeticId}`,
        motifHint: 'Draw the motif to weave onto this garment. It will use the garment\'s third dye slot.',
        initialPattern: state.pattern,
        library: window.PatternLibrary ? {
          list: () => window.PatternLibrary.listAvailable(),
          get: id => window.PatternLibrary.getById(id),
          save: (label, patternData) => window.PatternLibrary.saveToLibrary(label, patternData),
          remove: id => window.PatternLibrary.removeSaved(id),
        } : null,
        renderPreview: patternData => renderPatternedSprite(bp.sprite, patternData, dyeById(state.dyeC)?.hex, dyeById(state.dyeA)?.hex),
        onSave: patternData => {
          state.pattern = clone(patternData);
          state.patternId = '';
          state.patternLabel = 'Custom';
          rebuildPatternOptions();
          refreshPreview();
          return true;
        },
      });
    };
    overlay.querySelector('[data-act="craft"]').onclick = () => craftFromLoom(state, selectedBlueprint(), selectedMaterial(), dyeById, hasSecondary());
    overlay.querySelector('.loomcraft-close').onclick = closeLoom;
    overlay.addEventListener('pointerdown', event => { if (event.target === overlay) closeLoom(); });
    rebuildPatternOptions();
    refreshPreview();
    return true;
  }

  function craftFromLoom(state, bp, material, dyeById, hasSecondary) {
    const gear = gearInventory();
    if (!gear || !bp || !material) return false;
    const cost = WOOL_COST_BY_SLOT[bp.slot] || 1;
    const inventory = equipmentDeps?.inventory;
    if (!inventory || Number(inventory[material.itemKey]) < cost) {
      equipmentDeps?.showToast?.(`Need ${cost} ${material.label}.`, false);
      return false;
    }
    const dyeA = dyeById(state.dyeA);
    const dyeB = hasSecondary ? dyeById(state.dyeB) : null;
    const dyeC = state.pattern ? dyeById(state.dyeC) : null;
    if (!dyeA || (hasSecondary && !dyeB) || (state.pattern && !dyeC)) {
      equipmentDeps?.showToast?.('Choose all required dyes.', false);
      return false;
    }
    inventory[material.itemKey] -= cost;
    equipmentDeps?.clampInventoryStack?.(material.itemKey);
    const uid = 'gcloth_loom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); // Unique instance id keeps weight/pattern/dyes bound to this literal garment.
    const baseLabel = bp.label || bp.baseLabel || bp.baseCosmeticId;
    const entry = {
      uid,
      cosmeticId: uniqueCraftCosmeticId(bp.baseCosmeticId, uid),
      baseCosmeticId: bp.baseCosmeticId,
      slot: bp.slot,
      label: `${dyeA.label}${dyeB ? ' & ' + dyeB.label : ''} ${baseLabel}`,
      baseLabel,
      colorA: window.DyeSystem.toClothingColor(dyeA),
      colorB: dyeB ? window.DyeSystem.toClothingColor(dyeB) : null,
      colorC: dyeC ? window.DyeSystem.toClothingColor(dyeC) : null,
      articleDyeIds: [...new Set([state.dyeA, hasSecondary ? state.dyeB : null, state.pattern ? state.dyeC : null].filter(Boolean))],
      sprite: bp.sprite || window.EquipmentPanel?.clothingSpriteForCosmetic?.(bp.baseCosmeticId) || null,
      sellPrice: 0,
      weaveMaterial: material.id,
      weightUnits: Math.round(standardWeightFor(bp) * material.weightMul * 100) / 100,
      weaving: state.pattern ? { pattern: clone(state.pattern), patternLibraryId: state.patternId || null, patternLabel: state.patternLabel || 'Custom' } : null,
      craftedAt: Date.now(),
    }; // Stored in ordinary gear clothingItems so equip/save/gifting remain one system, not a parallel crafted inventory.
    if (!Array.isArray(gear.clothingItems)) gear.clothingItems = [];
    gear.clothingItems.push(entry);
    equipmentDeps?.saveGearInventory?.();
    equipmentDeps?.saveMemberWorldData?.();
    equipmentDeps?.buildInventoryGrid?.();
    window.EquipmentPanel?.buildEquipmentSlots?.();
    patternedCanvasCache.clear();
    equipmentDeps?.showToast?.(`Wove ${material.label} ${baseLabel} (${entry.weightUnits.toFixed(1)} weight).`, true);
    openLoom();
    return true;
  }

  function normalizeAssetPath(url) {
    let value = String(url || '').replace(/\\/g, '/').split('?')[0].split('#')[0];
    try { if (/^[a-z]+:\/\//i.test(value)) value = new URL(value).pathname; } catch (_) {}
    value = value.replace(/^\.?\//, '').replace(/^docs\//, '').replace(/^assets\//, '');
    return value;
  }

  async function cosmeticsIndex() {
    if (!cosmeticsIndexPromise) {
      cosmeticsIndexPromise = fetch('config/cosmetics/index.json').then(response => {
        if (!response.ok) throw new Error(`Cosmetics index HTTP ${response.status}`);
        return response.json();
      });
    }
    return cosmeticsIndexPromise;
  }

  function collectPatternImageUrls(value, into = new Set(), paletteLayerMap = null) {
    if (!value || typeof value !== 'object') return into;
    const localPaletteMap = value.paletteLayerMap && typeof value.paletteLayerMap === 'object' ? value.paletteLayerMap : paletteLayerMap; // Used to avoid weaving over authored skin/tusk bypass layers.
    const role = value.layerRole || null; // Used with the cosmetic's palette map to identify BODY/NONE overlays.
    const mappedRole = role && localPaletteMap ? localPaletteMap[role] : null; // BODY/NONE are the portrait pipeline's explicit non-cloth tint routes.
    const skipImage = mappedRole === 'BODY' || mappedRole === 'NONE' || value.paletteColorKey === 'BODY' || value.paletteColorKey === 'NONE';
    if (!skipImage && typeof value.url === 'string' && /\.(png|webp|jpe?g)(?:$|[?#])/i.test(value.url)) into.add(normalizeAssetPath(value.url));
    if (Array.isArray(value)) value.forEach(child => collectPatternImageUrls(child, into, localPaletteMap));
    else for (const child of Object.values(value)) collectPatternImageUrls(child, into, localPaletteMap);
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
        const path = 'config/cosmetics/' + String(entry.path).replace(/^\.\//, '');
        const response = await fetch(path);
        if (!response.ok) throw new Error(`${id} cosmetic config HTTP ${response.status}`);
        return response.json();
      })());
    }
    return cosmeticConfigPromises.get(id);
  }

  async function buildPortraitPatternMap(descriptors) {
    const map = new Map();
    for (const descriptor of descriptors || []) {
      if (!descriptor?.pattern || !descriptor?.baseCosmeticId) continue;
      try {
        const cfg = await cosmeticConfig(descriptor.baseCosmeticId);
        for (const url of collectPatternImageUrls(cfg)) map.set(url, descriptor);
      } catch (error) {
        lastError = String(error?.message || error);
      }
    }
    return map;
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

  function findOpaqueBounds(mask, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { count++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return count ? { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
  }
  function convexHull(points) {
    if (points.length <= 1) return points.map(p => ({ ...p }));
    const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y), cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [], upper = [];
    for (const point of pts) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop(); lower.push(point); }
    for (let i = pts.length - 1; i >= 0; i--) { const point = pts[i]; while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop(); upper.push(point); }
    lower.pop(); upper.pop(); return lower.concat(upper);
  }
  function opaqueEnvelopeHull(mask, w, h, bbox) {
    const points = [];
    for (let y = bbox.y0; y <= bbox.y1; y++) {
      let left = Infinity, right = -Infinity;
      for (let x = bbox.x0; x <= bbox.x1; x++) if (mask[y * w + x]) { left = Math.min(left, x); right = Math.max(right, x); }
      if (!Number.isFinite(left)) continue;
      const ly = y - bbox.y0, lx = left - bbox.x0, rx = right - bbox.x0 + 1;
      points.push({ x: lx, y: ly }, { x: rx, y: ly }, { x: lx, y: ly + 1 }, { x: rx, y: ly + 1 });
    }
    return convexHull(points);
  }
  const vecDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function lineIntersection(n1, c1, n2, c2) { const det = n1.x * n2.y - n1.y * n2.x; return Math.abs(det) < 1e-8 ? null : { x: (c1 * n2.y - n1.y * c2) / det, y: (n1.x * c2 - c1 * n2.x) / det }; }
  function polygonArea(points) { let area = 0; for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; area += a.x * b.y - b.x * a.y; } return Math.abs(area) * 0.5; }
  const rotate180 = (point, mid) => ({ x: 2 * mid.x - point.x, y: 2 * mid.y - point.y });

  function fitGuaranteedTriangle(mask, w, h, padding) {
    const bbox = findOpaqueBounds(mask, w, h);
    if (!bbox) return null;
    const hull = opaqueEnvelopeHull(mask, w, h, bbox);
    if (hull.length < 3) hull.push({ x: Math.max(1, bbox.w), y: 0 }, { x: 0, y: Math.max(1, bbox.h) });
    const pad = Math.max(0, Number(padding) || 0), samples = 48, twopi = Math.PI * 2, normals = [];
    for (let i = 0; i < samples; i++) {
      const angle = twopi * i / samples, n = { x: Math.cos(angle), y: Math.sin(angle) };
      let support = -Infinity;
      for (const point of hull) support = Math.max(support, n.x * point.x + n.y * point.y);
      normals.push({ a: angle, n, c: support + pad });
    }
    let best = null;
    for (let i = 0; i < samples - 2; i++) for (let j = i + 1; j < samples - 1; j++) for (let k = j + 1; k < samples; k++) {
      const gaps = [normals[j].a - normals[i].a, normals[k].a - normals[j].a, normals[i].a + twopi - normals[k].a];
      if (Math.max(...gaps) >= Math.PI - 1e-6) continue;
      const a = lineIntersection(normals[i].n, normals[i].c, normals[j].n, normals[j].c), b = lineIntersection(normals[j].n, normals[j].c, normals[k].n, normals[k].c), c = lineIntersection(normals[k].n, normals[k].c, normals[i].n, normals[i].c);
      if (!a || !b || !c) continue;
      const verts = [a, b, c];
      if (!verts.every(v => [normals[i], normals[j], normals[k]].every(side => side.n.x * v.x + side.n.y * v.y <= side.c + 1e-5))) continue;
      const area = polygonArea(verts);
      if (Number.isFinite(area) && area > 1e-6 && (!best || area < best.area)) best = { verts, area };
    }
    if (!best) { const bw = bbox.w + pad * 2, bh = bbox.h + pad * 2; best = { verts: [{ x: 0, y: 0 }, { x: bw * 2, y: 0 }, { x: 0, y: bh * 2 }] }; }
    const edge = [[0,1,2],[1,2,0],[2,0,1]].map(([ai,bi,ci]) => ({ ai,bi,ci,d:vecDist(best.verts[ai],best.verts[bi]) })).sort((a,b) => b.d-a.d)[0];
    let A = best.verts[edge.ai], B = best.verts[edge.bi], C = best.verts[edge.ci];
    const shift = { x: -Math.min(A.x,B.x,C.x,0)+1, y: -Math.min(A.y,B.y,C.y,0)+1 };
    A = { x:A.x+shift.x,y:A.y+shift.y }; B = { x:B.x+shift.x,y:B.y+shift.y }; C = { x:C.x+shift.x,y:C.y+shift.y };
    const midpoint = { x:(A.x+B.x)/2,y:(A.y+B.y)/2 }, partnerC = rotate180(C, midpoint);
    return { bbox,A,B,C,partnerC,midpoint,basisU:{x:A.x-C.x,y:A.y-C.y},basisV:{x:B.x-C.x,y:B.y-C.y},motifPlacement:{x:shift.x,y:shift.y,w:bbox.w,h:bbox.h} };
  }

  function buildPatternMask(width, height, patternDef, motifImg) {
    const canvas = Object.assign(document.createElement('canvas'), { width, height }), ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const motifScale = Math.max(.05, Number(patternDef?.motifScale ?? patternDef?.scale) || 1), fieldScale = Math.max(.05, Number(patternDef?.patternScale) || 1);
    const motifRad = (Number(patternDef?.motifRotationDeg) || 0) * Math.PI / 180, fieldRad = (Number(patternDef?.patternRotationDeg) || 0) * Math.PI / 180;
    const repeatMode = patternDef?.repeatMode === 'grid' ? 'grid' : 'triangle', naturalW = motifImg.naturalWidth || motifImg.width || 1, naturalH = motifImg.naturalHeight || motifImg.height || 1;
    function prepare(scale) {
      const mw = Math.max(1, naturalW * scale), mh = Math.max(1, naturalH * scale), size = Math.max(2, Math.ceil(Math.hypot(mw,mh))+2), c = Object.assign(document.createElement('canvas'),{width:size,height:size}), cctx = c.getContext('2d');
      cctx.imageSmoothingEnabled=false; cctx.translate(size/2,size/2); cctx.rotate(motifRad); cctx.drawImage(motifImg,-mw/2,-mh/2,mw,mh); return {canvas:c,ctx:cctx,size};
    }
    const draw = prepare(motifScale);
    ctx.save(); ctx.translate(width/2+(Number(patternDef?.translateX)||0),height/2+(Number(patternDef?.translateY)||0)); ctx.rotate(fieldRad); ctx.scale(fieldScale,fieldScale);
    if (patternDef?.tiling !== false) {
      const ref = prepare(1), data = ref.ctx.getImageData(0,0,ref.size,ref.size).data, mask = new Uint8Array(ref.size*ref.size);
      for (let p=0,i=0;i<data.length;i+=4,p++) if (data[i+3]>16) mask[p]=1;
      const bbox = findOpaqueBounds(mask,ref.size,ref.size);
      if (bbox && repeatMode === 'grid') {
        const centerX=bbox.x0+bbox.w/2,centerY=bbox.y0+bbox.h/2,dx=centerX-draw.size/2,dy=centerY-draw.size/2,gap=Math.max(0,Number(patternDef?.gridSpacing)??6),stepX=bbox.w+gap,stepY=bbox.h+gap,reach=Math.hypot(width,height)/fieldScale,cols=Math.ceil(reach/stepX)+2,rows=Math.ceil(reach/stepY)+2;
        for(let y=-rows;y<=rows;y++)for(let x=-cols;x<=cols;x++){ctx.save();ctx.translate(x*stepX,y*stepY);ctx.drawImage(draw.canvas,dx,dy);ctx.restore();}
      } else if (bbox) {
        const fit=fitGuaranteedTriangle(mask,ref.size,ref.size,Math.max(0,Number(patternDef?.trianglePadding ?? patternDef?.spacing)??.5));
        if(fit){
          const outputCenterX=fit.motifPlacement.x+fit.bbox.w/2,outputCenterY=fit.motifPlacement.y+fit.bbox.h/2,dx=outputCenterX-draw.size/2,dy=outputCenterY-draw.size/2;
          const stamp=(ox,oy)=>{ctx.save();ctx.translate(ox,oy);ctx.drawImage(draw.canvas,dx,dy);ctx.restore();ctx.save();ctx.translate(ox+fit.midpoint.x,oy+fit.midpoint.y);ctx.rotate(Math.PI);ctx.translate(-fit.midpoint.x,-fit.midpoint.y);ctx.drawImage(draw.canvas,dx,dy);ctx.restore();};
          const reach=Math.hypot(width,height)/fieldScale/2+draw.size,det=fit.basisU.x*fit.basisV.y-fit.basisU.y*fit.basisV.x;let maxI=8,maxJ=8;
          if(Math.abs(det)>1e-6){const ia=fit.basisV.y/det,ib=-fit.basisV.x/det,ic=-fit.basisU.y/det,id=fit.basisU.x/det;maxI=maxJ=0;for(const [x,y] of [[reach,reach],[reach,-reach],[-reach,reach],[-reach,-reach]]){maxI=Math.max(maxI,Math.abs(ia*x+ib*y));maxJ=Math.max(maxJ,Math.abs(ic*x+id*y));}maxI=Math.min(300,Math.ceil(maxI)+2);maxJ=Math.min(300,Math.ceil(maxJ)+2);}
          for(let j=-maxJ;j<=maxJ;j++)for(let i=-maxI;i<=maxI;i++)stamp(i*fit.basisU.x+j*fit.basisV.x,i*fit.basisU.y+j*fit.basisV.y);
        }
      }
    } else ctx.drawImage(draw.canvas,-draw.size/2,-draw.size/2);
    ctx.restore();
    if(patternDef?.invert){const image=ctx.getImageData(0,0,width,height),data=image.data;for(let i=0;i<data.length;i+=4)data[i+3]=255-data[i+3];ctx.putImageData(image,0,0);}
    return canvas;
  }

  function loadImageUrl(url) {
    if (!url) return Promise.resolve(null);
    if (typeof window.loadImg === 'function' && !String(url).startsWith('data:')) return window.loadImg(normalizeAssetPath(url));
    return new Promise((resolve, reject) => { const image = new Image(); image.crossOrigin = 'anonymous'; image.onload = () => resolve(image); image.onerror = reject; image.src = url; });
  }

  function patternCanvasKey(imageOrCanvas, pattern, colorHex, cachePrefix = '') {
    const width = imageOrCanvas?.naturalWidth || imageOrCanvas?.width || 1; // Used to keep species/gender sprite-size variants from sharing a composite.
    const height = imageOrCanvas?.naturalHeight || imageOrCanvas?.height || 1; // Used with width in the deterministic pattern cache key.
    return `${cachePrefix}|${width}x${height}|${colorHex}|${JSON.stringify(pattern || null)}`;
  }

  async function applyPatternToTintedImage(imageOrCanvas, pattern, colorHex, cachePrefix = '') {
    if (!imageOrCanvas || !pattern?.motifDataUrl) return imageOrCanvas;
    const width = imageOrCanvas.naturalWidth || imageOrCanvas.width || 1, height = imageOrCanvas.naturalHeight || imageOrCanvas.height || 1;
    const key = patternCanvasKey(imageOrCanvas, pattern, colorHex, cachePrefix);
    if (patternedCanvasCache.has(key)) return patternedCanvasCache.get(key);
    const motif = await loadImageUrl(pattern.motifDataUrl);
    if (!motif) return imageOrCanvas;
    const patternMask = buildPatternMask(width, height, pattern, motif);
    const out = Object.assign(document.createElement('canvas'), { width, height });
    const ctx = out.getContext('2d');
    ctx.drawImage(imageOrCanvas, 0, 0, width, height);
    const base = ctx.getImageData(0, 0, width, height), mask = patternMask.getContext('2d').getImageData(0, 0, width, height).data, [r, g, b] = hexRgb(colorHex);
    for (let i = 0; i < base.data.length; i += 4) {
      const maxChannel = Math.max(base.data[i], base.data[i + 1], base.data[i + 2]); // Used to preserve authored near-black garment outlines under the weave overlay.
      if (base.data[i + 3] <= 8 || mask[i + 3] <= 16 || maxChannel <= 28) continue;
      base.data[i] = r; base.data[i + 1] = g; base.data[i + 2] = b;
    }
    ctx.putImageData(base, 0, 0);
    patternedCanvasCache.set(key, out);
    return out;
  }

  async function renderPatternedSprite(sprite, pattern, patternHex, primaryHex) {
    if (!sprite) return null;
    let base = await loadImageUrl(sprite);
    if (!base) return null;
    const primaryValue = parseInt(String(primaryHex || '').replace('#', ''), 16);
    if (Number.isFinite(primaryValue) && window.SpriteRecolor?.getRecoloredCanvas) {
      try { base = await window.SpriteRecolor.getRecoloredCanvas(sprite, primaryValue, 'direct') || base; } catch (_) {}
    }
    return pattern ? applyPatternToTintedImage(base, pattern, patternHex || '#ffffff', `preview:${sprite}`) : base;
  }

  async function patternedCanvasForItem(item) {
    return renderPatternedSprite(item?.sprite, item?.weaving?.pattern, resolvePatternHex(item?.colorC), item?.colorA?.hex);
  }

  function installPortraitHooks() {
    if (portraitHooksInstalled) return true;
    const originalTint = window._imageForTint;
    const originalRender = window.renderProfile;
    if (typeof originalTint !== 'function' || typeof originalRender !== 'function') return false;

    window._imageForTint = function clothingPatternImageForTint(img, sourceKey, tint) {
      const tinted = originalTint(img, sourceKey, tint);
      const descriptor = activePortraitPatternMap?.get(normalizeAssetPath(sourceKey));
      if (!descriptor?.pattern) return tinted;
      // _imageForTint is synchronous. Return cached patterned output when available;
      // otherwise schedule a player-avatar refresh after generating it and use this
      // one unpatterned frame as a safe fallback.
      const prefix = `runtime:${normalizeAssetPath(sourceKey)}`; // Used to keep the same source layer's async/cached composite stable across frames.
      const colorHex = resolvePatternHex(descriptor.colorC); // Third dye slot is the sole color source for woven ink.
      const fullKey = patternCanvasKey(tinted, descriptor.pattern, colorHex, prefix);
      const cached = patternedCanvasCache.get(fullKey);
      if (cached) return cached;
      if (!pendingPatternCanvasKeys.has(fullKey)) {
        pendingPatternCanvasKeys.add(fullKey);
        applyPatternToTintedImage(tinted, descriptor.pattern, colorHex, prefix).then(() => {
          equipmentDeps?.refreshPlayerAvatar?.();
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

  function currentArea() { return window.__hobunjiFurnitureDebug?.getCurrentArea?.() || furnitureDeps?.getCurrentArea?.() || null; }
  function targetPoint() {
    const debug = window.__hobunjiFurnitureDebug;
    const player = debug?.playerState;
    const angleDeg = finite(debug?.targetAimAngleDeg, NaN);
    if (![player?.x, player?.y, angleDeg].every(Number.isFinite)) return null;
    const tile = 64, orbit = finite(window.SCRATCHBONES_CONFIG?.game?.input?.targeting?.orbitRadiusTiles, 0.62), angle = angleDeg * Math.PI / 180;
    return { col: (player.x + Math.cos(angle) * tile * orbit) / tile, row: (player.y + Math.sin(angle) * tile * orbit) / tile };
  }

  async function authoredLooms(area) {
    const areaKey = String(area || ''); // Used as the static-interior loom cache key.
    if (!/^map_i_/.test(areaKey)) return [];
    if (!authoredLoomPromiseByArea.has(areaKey)) {
      authoredLoomPromiseByArea.set(areaKey, (async () => {
        try {
          const response = await fetch(`config/maps/${encodeURIComponent(areaKey)}.json`);
          if (!response.ok) return [];
          const map = await response.json();
          return (map?.furniture || []).filter(piece => {
            const key = String(piece?.itemKey || '').toLowerCase(); // Used to accept both map-authored `loom` and furniture-runtime `loomFurniture`.
            return key === 'loom' || key === 'loomfurniture';
          }).map(piece => ({ id: piece.id || null, key: 'loom', col: finite(piece.col), row: finite(piece.row), source: 'authored' }));
        } catch (error) {
          lastError = String(error?.message || error);
          return [];
        }
      })());
    }
    return authoredLoomPromiseByArea.get(areaKey);
  }

  function placedLooms() {
    const placed = furnitureDeps?.getPlacedFurniture?.() || [];
    return placed.filter(obj => String(obj?.key || '').toLowerCase() === 'loom' || String(obj?.itemKey || '').toLowerCase() === 'loomfurniture')
      .map(obj => ({ id: obj.id || null, key: 'loom', col: finite(obj.col), row: finite(obj.row), source: 'placed' }));
  }

  async function targetedLoom() {
    const point = targetPoint();
    if (!point) return null;
    const area = currentArea();
    const candidates = [...placedLooms(), ...(await authoredLooms(area))];
    const match = candidates.map(loom => ({ loom, distance: Math.hypot(point.col - (loom.col + 0.5), point.row - (loom.row + 0.5)) }))
      .filter(entry => entry.distance <= 0.95).sort((a, b) => a.distance - b.distance)[0];
    loomTarget = match ? { ...match.loom, distance: match.distance, area } : null;
    return loomTarget;
  }

  function actionButtonHtml() {
    const touch = window.ActionPromptUI?.getLastInputDevice?.() === 'touch';
    return touch ? '<span class="abt-icon">🧶</span><span class="abt-label">Loom</span>' : '<span class="abt-icon">🧶</span><span class="abt-label">Use Loom</span>';
  }

  async function syncLoomActionButton() {
    if (typeof document === 'undefined') return;
    const token = ++targetResolveToken; // Used to prevent a slower old-area map fetch from overwriting the newest targeting result.
    const target = await targetedLoom();
    if (token !== targetResolveToken) return;
    const buttons = ACTION_BUTTON_IDS.map(id => document.getElementById(id)).filter(Boolean);
    const existing = buttons.find(button => button.dataset.clothingLoomInjected === '1');
    if (!target) {
      if (existing) {
        existing.classList.add('abt-hidden');
        existing.removeAttribute('data-action');
        existing.innerHTML = '';
        delete existing.dataset.clothingLoomInjected;
      }
      return;
    }
    const host = existing || buttons.find(button => button.classList.contains('abt-hidden') && button.dataset.npcFurnitureWardrobeInjected !== '1');
    if (!host) return;
    host.dataset.clothingLoomInjected = '1';
    host.dataset.action = 'clothing_loom_open';
    host.classList.remove('abt-hidden', 'blocked');
    host.removeAttribute('aria-hidden');
    host.innerHTML = actionButtonHtml();
    host.title = 'Use Loom';
  }

  function installInteractionHooks() {
    if (interactionHooksInstalled || typeof document === 'undefined') return;
    interactionHooksInstalled = true;
    const interceptLoomAction = event => {
      const button = event.target?.closest?.('button[data-clothing-loom-injected="1"]');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'pointerup') {
        lastLoomPointerOpenAt = performance.now();
        openLoom();
      } else if (event.type === 'click' && (event.detail === 0 || performance.now() - lastLoomPointerOpenAt > 180)) {
        openLoom(); // Keyboard/controller-generated click has no preceding pointerup; pointer clicks are de-duped above.
      }
    };
    document.addEventListener('pointerdown', interceptLoomAction, true);
    document.addEventListener('pointerup', interceptLoomAction, true);
    document.addEventListener('click', interceptLoomAction, true);
    const root = document.getElementById('actionStack') || document.body;
    if (typeof MutationObserver === 'function' && root) {
      const observer = new MutationObserver(() => syncLoomActionButton());
      observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-action'] });
    }
    window.setInterval?.(() => { syncLoomActionButton(); installArmorHooks(); installPortraitHooks(); }, 250);
    syncLoomActionButton();
  }

  function debugSnapshot() {
    const stats = armorStats();
    return {
      version: VERSION,
      equipmentReady: !!equipmentDeps,
      furnitureReady: !!furnitureDeps,
      armorHooksInstalled,
      portraitHooksInstalled,
      loomOpen: !!loomOverlay?.isConnected,
      loomTarget: loomTarget ? { ...loomTarget } : null,
      combatActive: combatActive(),
      mounted: mounted(),
      equippedWeight: stats.weightUnits,
      stats,
      equipped: equippedClothItems().map(item => ({ uid: item.uid, article: articleLabel(item), slot: item.slot, material: item.weaveMaterial || 'standard', weightUnits: itemWeightUnits(item), woven: !!item.weaving?.pattern })),
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
    renderPatternedSprite,
    debugSnapshot,
    __test: Object.freeze({ baseCosmeticId, uniqueCraftCosmeticId, thirdTintKey, buildPatternMask }),
  });
  window.__clothingWeavingDebug = debugSnapshot;

  futureGlobal('EquipmentPanel', patchEquipmentPanel);
  futureGlobal('FurniturePlacer', patchFurniturePlacer);
  installClothingDetailTracking();
  installInteractionHooks();
  installArmorHooks();
  installPortraitHooks();
})();
