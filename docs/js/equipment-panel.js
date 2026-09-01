(() => {
  'use strict';

  // Tool/weapon equipment slots + gear clothing (collection, equip/de-equip,
  // redye) — the "Owned Tools"/"Clothing" sections of the Inventory panel's
  // equipment sidebar, plus the tool-slot assign/unassign plumbing the main
  // inventory grid's item-info panel calls into (Transfer to Gear, Assign as
  // <slot>). Extracted out of game.js following the same window.<Namespace>
  // + init(deps) pattern as its sibling systems. The inventory grid itself
  // (buildInventoryGrid/selectInventoryItem) stays in game.js — this module
  // only owns what's equipped and what's collected in gear.
  let deps = null;
  // This guard prevents duplicate dynamic loads when EquipmentPanel.init() is called more than once.
  let inventoryUiLoadStarted = false;
  // This guard keeps the capture-phase selection reset from being registered twice.
  let inventorySelectionBridgeInstalled = false;
  const CLOTHING_SLOTS = ['hat', 'hood', 'torso', 'overwear']; // Used anywhere gear clothing must be normalized or rendered by slot.
  const clothingIconTintUrlCache = new Map(); // Used to reuse SpriteRecolor output instead of re-encoding the same dyed icon every panel rebuild.

  function init(injectedDeps) {
    deps = injectedDeps;
    installInventorySelectionBridge();
    loadInventoryUi();
  }

  function installInventorySelectionBridge() {
    if (inventorySelectionBridgeInstalled || typeof document === 'undefined') return;
    inventorySelectionBridgeInstalled = true;
    // The mastery panel stores its last rendered key for debug output only. Clear it before every inventory
    // click so the post-click presentation pass resolves the current detail item instead of reusing an old tool.
    document.addEventListener('click', (event) => {
      if (!event.target?.closest?.('#mpInventory')) return;
      const masteryPanel = document.getElementById('iiToolMastery');
      if (masteryPanel) delete masteryPanel.dataset.toolKey;
    }, true);
  }

  function inventoryUiDeps() {
    // Read-only mastery bridge: InventoryUI needs the same canonical per-tool data this panel already renders,
    // but should not own or mutate Gear/mastery state itself.
    const toolMasteryXp = (itemKey) => {
      const xp = Number(deps.getGearInventory?.()?.toolMastery?.[itemKey]?.xp);
      return Number.isFinite(xp) ? Math.max(0, xp) : 0;
    };
    return {
      isDevMode: deps.isDevMode,
      showToast: deps.showToast,
      getGearInventory: deps.getGearInventory,
      toolMasteryLevel: deps.toolMasteryLevel,
      toolMasteryXp,
      TOOL_ITEM_DEFS: deps.TOOL_ITEM_DEFS,
      equipmentSlots: deps.equipmentSlots,
    };
  }

  function exposeInventoryMasteryBridge(uiDeps) {
    // InventoryUI's tool-effects code already reads window.Combat.deps. Extend that existing read-only seam
    // with the EquipmentPanel-owned mastery data rather than widening game.js or duplicating progression state.
    const combatDeps = window.Combat?.deps;
    if (!combatDeps) return;
    combatDeps.TOOL_ITEM_DEFS ||= uiDeps.TOOL_ITEM_DEFS;
    combatDeps.equipmentSlots ||= uiDeps.equipmentSlots;
    combatDeps.gearInventory ||= uiDeps.getGearInventory;
    combatDeps.toolMasteryLevel ||= uiDeps.toolMasteryLevel;
    combatDeps.toolMasteryXp ||= uiDeps.toolMasteryXp;
  }

  function loadInventoryUi() {
    const uiDeps = inventoryUiDeps();
    exposeInventoryMasteryBridge(uiDeps);
    if (window.InventoryUI?.init) {
      window.InventoryUI.init(uiDeps);
      return;
    }
    if (inventoryUiLoadStarted || typeof document === 'undefined') return;
    inventoryUiLoadStarted = true;
    // Versioned source is loaded here so Pack presentation can be decoupled without editing game.js or index.html.
    const script = document.createElement('script');
    script.src = 'js/inventory-ui.js?v=20260812c';
    script.async = false;
    script.onload = () => window.InventoryUI?.init?.(inventoryUiDeps());
    script.onerror = () => {
      inventoryUiLoadStarted = false;
      if (deps.isDevMode?.()) deps.showToast?.('Inventory UI polish module failed to load.', false);
    };
    document.head.appendChild(script);
  }

  function setEquipmentSlot(slot, itemKeyOrNull) {
    deps.equipmentSlots[slot] = itemKeyOrNull;
    deps.saveEquipmentSlots();
  }

  // Assign a tool item to a slot (tool must be in gear inventory)
  function equipItem(itemKey, slot) {
    const toolDef = deps.TOOL_ITEM_DEFS[itemKey];
    if (!toolDef || !toolDef.slots.includes(slot)) { deps.showToast('Cannot assign that item to that slot.', false); return; }
    const gearInventory = deps.getGearInventory();
    if (!gearInventory?.tools?.[itemKey]) { deps.showToast((deps.TOOL_ITEM_DEFS[itemKey]?.label || itemKey) + ' is not in your gear. Transfer it first.', false); return; }
    setEquipmentSlot(slot, itemKey);
    deps.rebuildToolMeshes();
    Object.values(deps.toolMeshMap).forEach(m => { if (m) deps.toolHolder.remove(m); });
    const activeTool = deps.getActiveTool();
    if (deps.toolMeshMap[activeTool]) deps.toolHolder.add(deps.toolMeshMap[activeTool]);
    deps.showToast(`${toolDef.label} assigned as ${slot}.`, true);
    deps.refreshActionBar();
  }

  // Clear a slot assignment (tool remains in gear inventory)
  function unequipItem(slot) {
    const itemKey = deps.equipmentSlots[slot];
    if (!itemKey) return;
    setEquipmentSlot(slot, null);
    deps.rebuildToolMeshes();
    Object.values(deps.toolMeshMap).forEach(m => { if (m) deps.toolHolder.remove(m); });
    const activeTool = deps.getActiveTool();
    if (deps.toolMeshMap[activeTool]) deps.toolHolder.add(deps.toolMeshMap[activeTool]);
    deps.showToast(`${deps.TOOL_ITEM_DEFS[itemKey]?.label || itemKey} unassigned from ${slot}.`, true);
    deps.buildInventoryGrid();
    buildEquipmentSlots();
    deps.refreshActionBar();
  }

  function transferToolToGear(itemKey) {
    const toolDef = deps.TOOL_ITEM_DEFS[itemKey];
    if (!toolDef) return;
    const gearInventory = deps.getGearInventory();
    if (gearInventory.tools[itemKey]) { deps.showToast(toolDef.label + ' is already in your gear.', false); return; }
    if ((deps.inventory[itemKey] || 0) < 1) { deps.showToast('No ' + toolDef.label + ' in pack.', false); return; }
    deps.inventory[itemKey]--;
    deps.clampInventoryStack(itemKey);
    gearInventory.tools[itemKey] = true;
    deps.saveGearInventory();
    deps.showToast(toolDef.label + ' transferred to gear!', true);
    deps.buildInventoryGrid(); buildEquipmentSlots(); deps.clearInventoryDetail();
  }

  function stripClothingDyePrefix(label) {
    const text = String(label || '').trim();
    if (!text) return '';
    const dyeLabels = (window.DyeSystem?.getCatalog?.() || [])
      .map(dye => String(dye?.label || '').trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length); // Longest first so compound shade names win before shorter prefixes.
    for (const first of dyeLabels) {
      const pairPrefix = first + ' & ';
      if (text.startsWith(pairPrefix)) {
        const afterFirst = text.slice(pairPrefix.length);
        for (const second of dyeLabels) {
          const secondPrefix = second + ' ';
          if (afterFirst.startsWith(secondPrefix)) return afterFirst.slice(secondPrefix.length).trim();
        }
      }
      const singlePrefix = first + ' ';
      if (text.startsWith(singlePrefix)) return text.slice(singlePrefix.length).trim();
    }
    return text;
  }

  function clothingArticleLabel(item) {
    const configured = (window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [])
      .find(entry => entry?.id === item?.cosmeticId)?.label;
    if (configured) return String(configured);
    const fromBase = stripClothingDyePrefix(item?.baseLabel);
    if (fromBase) return fromBase;
    return stripClothingDyePrefix(item?.label) || 'Clothing';
  }

  function makeClothingGearEntry(item) {
    if (!item) return null;
    const entry = { // Used as the persistent canonical gear record for one clothing article.
      uid: item.uid || 'gcloth_' + Math.random().toString(36).slice(2, 10),
      cosmeticId: item.cosmeticId,
      slot: item.slot,
      label: item.label,
      baseLabel: clothingArticleLabel(item),
      colorA: item.colorA,
      colorB: item.colorB,
      articleDyeIds: Array.isArray(item.articleDyeIds) ? [...item.articleDyeIds] : [],
      sprite: item.sprite || clothingSpriteForCosmetic(item.cosmeticId),
      sellPrice: item.sellPrice || 0,
    };
    ensureArticleDyeIds(entry);
    return entry;
  }

  function clothingDyeIds(item) {
    const articleDyeIds = []; // Used to return the unique shades learned specifically for this article.
    const seenDyeIds = new Set(); // Used to keep legacy/duplicate dye entries from multiplying in saves.
    const addDyeId = (dyeId) => { // Used for both saved article shades and the article's current primary/trim colors.
      if (!dyeId || seenDyeIds.has(dyeId)) return;
      seenDyeIds.add(dyeId);
      articleDyeIds.push(dyeId);
    };
    for (const dyeId of (Array.isArray(item?.articleDyeIds) ? item.articleDyeIds : [])) addDyeId(dyeId);
    addDyeId(item?.colorA?.dyeId);
    addDyeId(item?.colorB?.dyeId);
    return articleDyeIds;
  }

  function ensureArticleDyeIds(item) {
    if (!item) return false;
    const nextDyeIds = clothingDyeIds(item); // Used as the normalized per-article dye list persisted on the clothing entry.
    const previousDyeIds = Array.isArray(item.articleDyeIds) ? item.articleDyeIds : []; // Used to avoid unnecessary save writes when already normalized.
    const unchanged = previousDyeIds.length === nextDyeIds.length && previousDyeIds.every((dyeId, index) => dyeId === nextDyeIds[index]); // Used to detect one-time migration work.
    if (unchanged) return false;
    item.articleDyeIds = nextDyeIds;
    return true;
  }

  function mergeArticleDyes(target, source) {
    if (!target) return 0;
    ensureArticleDyeIds(target);
    const knownDyeIds = new Set(target.articleDyeIds); // Used to merge a duplicate copy's shades without affecting the global dye collection.
    let addedDyeCount = 0; // Used for transfer feedback when a duplicate teaches this article new shades.
    for (const dyeId of clothingDyeIds(source)) {
      if (knownDyeIds.has(dyeId)) continue;
      knownDyeIds.add(dyeId);
      target.articleDyeIds.push(dyeId);
      addedDyeCount++;
    }
    return addedDyeCount;
  }

  function normalizeGearClothingItems(gearInventory) {
    if (!gearInventory || !Array.isArray(gearInventory.clothingItems)) return false;
    let changed = false; // Used to persist legacy duplicate cleanup only when the save actually changes.
    const sourceItems = gearInventory.clothingItems.filter(Boolean); // Used as the migration input before duplicate articles are collapsed.
    const groupsByCosmeticId = new Map(); // Used to group dye variants of the same authored clothing article.
    const wornUidByCosmeticId = new Map(); // Used to preserve whichever dyed copy is currently visible during migration.

    for (const item of sourceItems) {
      const articleLabel = clothingArticleLabel(item); // Used to clean stale dye prefixes from legacy baseLabel fields while migrating.
      if (articleLabel && item.baseLabel !== articleLabel) {
        item.baseLabel = articleLabel;
        changed = true;
      }
      if (ensureArticleDyeIds(item)) changed = true;
      if (!item?.cosmeticId) continue;
      if (!groupsByCosmeticId.has(item.cosmeticId)) groupsByCosmeticId.set(item.cosmeticId, []);
      groupsByCosmeticId.get(item.cosmeticId).push(item);
    }
    for (const slot of CLOTHING_SLOTS) {
      const worn = gearInventory.clothing?.[slot]; // Used to choose the visible copy as canonical when an old save has duplicates.
      if (worn?.cosmeticId && worn?.uid) wornUidByCosmeticId.set(worn.cosmeticId, worn.uid);
    }

    const canonicalByCosmeticId = new Map(); // Used to map every duplicate article to its single retained gear entry.
    for (const [cosmeticId, variants] of groupsByCosmeticId) {
      const wornUid = wornUidByCosmeticId.get(cosmeticId); // Used to avoid changing the player's currently visible dye during migration.
      const canonical = variants.find(item => item.uid === wornUid) || variants[0]; // Used as the one retained owned-clothing record.
      for (const variant of variants) {
        if (variant === canonical) continue;
        if (mergeArticleDyes(canonical, variant) > 0) changed = true;
      }
      canonicalByCosmeticId.set(cosmeticId, canonical);
      if (variants.length > 1) changed = true;
    }

    const normalizedItems = []; // Used to preserve original ordering while emitting only one item per cosmeticId.
    const emittedCosmeticIds = new Set(); // Used to suppress duplicate dye variants in the Owned Clothing row.
    for (const item of sourceItems) {
      if (!item?.cosmeticId) {
        normalizedItems.push(item);
        continue;
      }
      if (emittedCosmeticIds.has(item.cosmeticId)) continue;
      emittedCosmeticIds.add(item.cosmeticId);
      normalizedItems.push(canonicalByCosmeticId.get(item.cosmeticId) || item);
    }
    const listChanged = normalizedItems.length !== gearInventory.clothingItems.length || normalizedItems.some((item, index) => gearInventory.clothingItems[index] !== item); // Used to avoid replacing the array when no migration is needed.
    if (listChanged) {
      gearInventory.clothingItems = normalizedItems;
      changed = true;
    }

    for (const slot of CLOTHING_SLOTS) {
      const worn = gearInventory.clothing?.[slot]; // Used to reconnect equipped slots to their retained canonical clothing record.
      if (!worn?.cosmeticId) continue;
      const canonical = canonicalByCosmeticId.get(worn.cosmeticId); // Used to keep slot and collection references on the same retained article.
      if (canonical && gearInventory.clothing[slot] !== canonical) {
        gearInventory.clothing[slot] = canonical;
        changed = true;
      }
    }
    return changed;
  }

  function clothingTintKeysForSlot(slot) {
    if (slot === 'hat') return ['HAT'];
    if (slot === 'hood') return ['HOOD', 'HOOD_B'];
    if (slot === 'torso') return ['TORSO'];
    if (slot === 'overwear') return ['CLOTH', 'CLOTH_B'];
    return [];
  }

  function applyGearClothingToPlayerData(playerData) {
    const gearInventory = deps.getGearInventory();
    const shopCatalog = window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [];
    const equippedCosmetics = new Set(Array.isArray(playerData?.equippedCosmetics) ? playerData.equippedCosmetics : []);
    const bodyColors = { ...(playerData?.appearance?.bodyColors || {}) };
    for (const slot of CLOTHING_SLOTS) {
      // Clear out whatever cosmetic previously occupied this category
      // (character-creation's own pick, or a since-unequipped item)
      // before considering the current gearInventory item — this used to
      // only ever ADD an id here and never remove one, so unequipping a
      // clothing slot in-game left the original character-creation
      // cosmetic (and its stale tint) rendering underneath instead of
      // actually clearing the slot.
      for (const catItem of shopCatalog) {
        if (catItem.category === slot) equippedCosmetics.delete(catItem.id);
      }
      const item = gearInventory?.clothing?.[slot];
      if (!item) continue;
      if (item.cosmeticId) equippedCosmetics.add(item.cosmeticId);
      const [primaryTintKey, secondaryTintKey] = clothingTintKeysForSlot(slot);
      if (primaryTintKey && item.colorA) bodyColors[primaryTintKey] = { ...item.colorA };
      if (secondaryTintKey && item.colorB) bodyColors[secondaryTintKey] = { ...item.colorB };
    }
    return {
      ...playerData,
      equippedCosmetics: [...equippedCosmetics],
      appearance: {
        ...(playerData?.appearance || {}),
        bodyColors,
      },
    };
  }

  function clothingSpriteForCosmetic(cosmeticId) {
    return window.SCRATCHBONES_CONFIG?.game?.inventory?.clothingSprites?.[cosmeticId] || null;
  }

  function clothingIconTintValue(item) {
    const rawHex = item?.colorA?.hex || window.DyeSystem?.getById?.(item?.colorA?.dyeId)?.hex || '';
    const match = String(rawHex).trim().match(/^#?([0-9a-fA-F]{6})$/);
    return match ? parseInt(match[1], 16) : null;
  }

  function tintClothingIcon(img, sprite, item) {
    const tintValue = clothingIconTintValue(item);
    const recolor = window.SpriteRecolor?.getRecoloredCanvas;
    if (!img || !sprite || tintValue == null || typeof recolor !== 'function') return;
    const cacheKey = `${sprite}|${tintValue.toString(16).padStart(6, '0')}`; // Used to distinguish each article sprite/current primary dye combination.
    const renderToken = `${cacheKey}|${Math.random().toString(36).slice(2, 8)}`; // Used to prevent a late async recolor from overwriting a reused DOM image.
    img.dataset.clothingTintToken = renderToken;
    const cachedUrl = clothingIconTintUrlCache.get(cacheKey);
    if (cachedUrl) {
      img.src = cachedUrl;
      return;
    }
    recolor(sprite, tintValue, 'direct').then(canvas => {
      if (!canvas) return;
      const dataUrl = canvas.toDataURL('image/png');
      clothingIconTintUrlCache.set(cacheKey, dataUrl);
      if (img.dataset.clothingTintToken === renderToken) img.src = dataUrl;
    }).catch(() => { /* Keep the authored source sprite if recoloring fails. */ });
  }

  function renderClothingIcon(parent, item, className = 'ies-cloth-sprite') {
    const sprite = item?.sprite || clothingSpriteForCosmetic(item?.cosmeticId);
    if (sprite) {
      const img = document.createElement('img');
      img.src = sprite;
      img.className = className;
      img.alt = clothingArticleLabel(item);
      parent.appendChild(img);
      tintClothingIcon(img, sprite, item);
      return img;
    }
    const icon = document.createElement('span');
    icon.className = className + ' ies-cloth-fallback';
    icon.textContent = '👘';
    parent.appendChild(icon);
    return icon;
  }

  function setInventoryDetailClothingIcon(item) {
    const iconEl = document.getElementById('iiIcon');
    if (!iconEl) return;
    const sprite = item?.sprite || clothingSpriteForCosmetic(item?.cosmeticId);
    if (sprite) {
      iconEl.innerHTML = '';
      renderClothingIcon(iconEl, item, 'ii-cloth-sprite');
    } else {
      iconEl.textContent = '👘';
    }
  }

  function ensureGearClothingCollection() {
    const gearInventory = deps.getGearInventory();
    if (!gearInventory) return false;
    let changed = false; // Used to make legacy clothing migration save itself exactly when needed.
    if (!gearInventory.clothing) {
      gearInventory.clothing = { hat: null, hood: null, torso: null, overwear: null };
      changed = true;
    }
    if (!Array.isArray(gearInventory.clothingItems)) {
      gearInventory.clothingItems = [];
      changed = true;
    }
    for (const slot of CLOTHING_SLOTS) {
      const worn = gearInventory.clothing[slot];
      if (!worn) continue;
      const wornEntry = makeClothingGearEntry({ ...worn, slot });
      if (!worn.uid) {
        gearInventory.clothing[slot] = wornEntry;
        changed = true;
      } else {
        const articleLabel = clothingArticleLabel(worn); // Used to clean stale dye prefixes from older equipped-only records too.
        if (articleLabel && worn.baseLabel !== articleLabel) {
          worn.baseLabel = articleLabel;
          changed = true;
        }
        if (ensureArticleDyeIds(worn)) changed = true;
      }
      const storedWorn = gearInventory.clothing[slot]; // Used to seed the owned collection from older saves that only stored equipped clothing.
      const hasItem = gearInventory.clothingItems.some(item => item.uid === storedWorn.uid);
      if (!hasItem) {
        gearInventory.clothingItems.push(storedWorn);
        changed = true;
      }
    }
    if (normalizeGearClothingItems(gearInventory)) changed = true;
    if (changed) deps.saveGearInventory();
    return changed;
  }

  function transferClothingToGear(uid) {
    const packClothing = deps.getPackClothing();
    const idx = packClothing.findIndex(c => c.uid === uid);
    if (idx < 0) return;
    const item = makeClothingGearEntry(packClothing[idx]);
    ensureGearClothingCollection();
    const gearInventory = deps.getGearInventory();
    const existingItem = item.cosmeticId ? gearInventory.clothingItems.find(c => c?.cosmeticId === item.cosmeticId) : null; // Used to collapse a newly acquired dye variant into an already-owned article.
    let equippedItem = item; // Used so duplicate transfers equip the retained canonical article rather than a second copy.
    let learnedDyeCount = 0; // Used to tell the player whether the duplicate taught this article any new shades.
    if (existingItem) {
      learnedDyeCount = mergeArticleDyes(existingItem, item);
      equippedItem = existingItem;
    } else {
      gearInventory.clothingItems.push(item);
    }
    gearInventory.clothing[equippedItem.slot] = equippedItem;
    packClothing.splice(idx, 1);
    deps.saveGearInventory();
    deps.saveMemberWorldData(); // packClothing (world-scoped) lost the item saveGearInventory just persisted to gear
    deps.refreshPlayerAvatar();
    if (existingItem) {
      const articleLabel = clothingArticleLabel(existingItem); // Used for duplicate-transfer feedback without baking the current dye into the article name.
      if (learnedDyeCount > 0) {
        deps.showToast(`${articleLabel}: added ${learnedDyeCount} new redye ${learnedDyeCount === 1 ? 'shade' : 'shades'}.`, true);
      } else {
        deps.showToast(`${articleLabel} is already in gear; those dyes were already available for it.`, true);
      }
    } else {
      deps.showToast(item.label + ' moved to gear and equipped!', true);
    }
    buildPackClothingSection(); buildEquipmentSlots(); deps.clearInventoryDetail();
  }

  function selectGearTool(key) {
    const def = deps.TOOL_ITEM_DEFS[key];
    if (!def) return;
    deps.clearInvSelection();
    const emptyEl  = document.getElementById('iiEmpty');
    const detailEl = document.getElementById('iiDetail');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (detailEl) detailEl.style.display  = '';
    const set = (id, val) => { const el = document.getElementById(id); if (el) el[typeof val === 'string' ? 'textContent' : 'innerHTML'] = val; };
    set('iiIcon',  def.icon);
    const iiIconEl2 = document.getElementById('iiIcon');
    if (iiIconEl2) { iiIconEl2.style.backgroundImage = ''; iiIconEl2.classList.remove('sprited-icon'); }
    set('iiName',  def.label + ' — Mastery ' + deps.toolMasteryLevel(key) + '/5 (Gear)');
    set('iiPrice', 'Permanent — not sellable');
    set('iiTags',  '');
    set('iiDesc',  'This tool is in your gear inventory. Assign it to an equipment slot to use it.');
    const actEl = document.getElementById('iiActions');
    if (actEl) {
      actEl.innerHTML = '';
      const mkBtn = (label, cls, fn) => {
        const b = document.createElement('button'); b.className = 'ii-btn' + (cls ? ' ' + cls : ''); b.textContent = label; b.onclick = fn; actEl.appendChild(b);
      };
      for (const slot of def.slots) {
        const isAssigned = deps.equipmentSlots[slot] === key;
        mkBtn(isAssigned ? 'Unassign from ' + slot : 'Assign as ' + slot, 'equip', () => {
          if (isAssigned) unequipItem(slot); else equipItem(key, slot);
          buildEquipmentSlots(); selectGearTool(key);
        });
      }
      if (deps.isDevMode() && deps.toolMasteryLevel(key) < 5) {
        mkBtn('[Dev] +1 Mastery', '', () => {
          deps.devBumpToolMasteryLevel(key);
          selectGearTool(key);
        });
      }
    }
  }

  // Clicking a Tool Slot cell (instead of an Owned Tools item) shows
  // every gear tool that fits THAT slot as one-click assign buttons —
  // no need to separately pick a slot afterward, since it's already
  // known from context. Shows each tool's own Mastery level too.
  function selectEquipSlot(slot) {
    deps.clearInvSelection();
    const emptyEl  = document.getElementById('iiEmpty');
    const detailEl = document.getElementById('iiDetail');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (detailEl) detailEl.style.display  = '';
    const set = (id, val) => { const el = document.getElementById(id); if (el) el[typeof val === 'string' ? 'textContent' : 'innerHTML'] = val; };
    const currentKey = deps.equipmentSlots[slot];
    const currentDef = currentKey ? deps.TOOL_ITEM_DEFS[currentKey] : null;
    const slotLabel = slot.charAt(0).toUpperCase() + slot.slice(1);
    set('iiIcon', currentDef?.icon || '❔');
    set('iiName', slotLabel + ' Slot');
    set('iiPrice', currentDef ? 'Currently: ' + currentDef.label : 'Currently: empty');
    set('iiTags', '');
    set('iiDesc', 'Click a tool below to assign it to this slot.');
    const actEl = document.getElementById('iiActions');
    if (!actEl) return;
    actEl.innerHTML = '';
    const gearInventory = deps.getGearInventory();
    const eligible = Object.keys(gearInventory?.tools || {})
      .filter(k => gearInventory.tools[k] && deps.TOOL_ITEM_DEFS[k]?.slots.includes(slot));
    if (!eligible.length) {
      const none = document.createElement('div');
      none.className = 'ii-tag';
      none.textContent = 'No tools in gear fit the ' + slotLabel + ' slot.';
      actEl.appendChild(none);
      return;
    }
    for (const key of eligible) {
      const def = deps.TOOL_ITEM_DEFS[key];
      const isAssigned = deps.equipmentSlots[slot] === key;
      const b = document.createElement('button');
      b.className = 'ii-btn equip';
      b.textContent = `${def.label} — Mastery ${deps.toolMasteryLevel(key)}/5` + (isAssigned ? ' (assigned)' : '');
      b.onclick = () => {
        if (isAssigned) unequipItem(slot); else equipItem(key, slot);
        buildEquipmentSlots(); selectEquipSlot(slot);
      };
      actEl.appendChild(b);
      if (deps.isDevMode() && deps.toolMasteryLevel(key) < 5) {
        const devBtn = document.createElement('button');
        devBtn.className = 'ii-btn';
        devBtn.textContent = `[Dev] +1 Mastery (${def.label})`;
        devBtn.onclick = () => {
          deps.devBumpToolMasteryLevel(key);
          selectEquipSlot(slot);
        };
        actEl.appendChild(devBtn);
      }
    }
  }

  function selectPackClothingItem(uid) {
    const packClothing = deps.getPackClothing();
    const item = packClothing.find(c => c.uid === uid);
    if (!item) return;
    deps.clearInvSelection();
    const emptyEl  = document.getElementById('iiEmpty');
    const detailEl = document.getElementById('iiDetail');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (detailEl) detailEl.style.display  = '';
    const set = (id, val) => { const el = document.getElementById(id); if (el) el[typeof val === 'string' ? 'textContent' : 'innerHTML'] = val; };
    setInventoryDetailClothingIcon(item);
    set('iiName',  item.label);
    set('iiPrice', item.sellPrice ? item.sellPrice + 'g' : '');
    set('iiTags',  '');
    set('iiDesc',  'Transfer to gear to wear it (permanent). Can sell while in pack.');
    const actEl = document.getElementById('iiActions');
    if (actEl) {
      actEl.innerHTML = '';
      const mkBtn = (label, cls, fn) => {
        const b = document.createElement('button'); b.className = 'ii-btn' + (cls ? ' ' + cls : ''); b.textContent = label; b.onclick = fn; actEl.appendChild(b);
      };
      mkBtn('Transfer to Gear (permanent)', 'equip', () => transferClothingToGear(uid));
      if (item.sellPrice > 0) {
        mkBtn('Sell (' + item.sellPrice + 'g)', 'sell', () => {
          deps.setPackClothing(deps.getPackClothing().filter(c => c.uid !== uid));
          deps.inventory.gold = (deps.inventory.gold || 0) + item.sellPrice;
          deps.showToast('Sold ' + item.label + ' for ' + item.sellPrice + 'g', true);
          buildPackClothingSection(); deps.buildInventoryGrid(); deps.clearInventoryDetail();
          deps.saveMemberWorldData();
        });
      }
      // Giftable straight from the pack too — see getHeldGiftItem in
      // game.js, which checks packClothing as well as gear.
      const heldNow = deps.getManualHeldItem?.();
      const isHeld = heldNow?.kind === 'clothing' && heldNow?.uid === uid;
      mkBtn(isHeld ? '✋ Holding — Stop' : '✋ Hold', isHeld ? '' : 'secondary', () => {
        deps.setManualHeldItem?.(isHeld ? null : { kind: 'clothing', uid });
        selectPackClothingItem(uid);
      });
    }
  }

  function equipGearClothing(uid) {
    ensureGearClothingCollection();
    const gearInventory = deps.getGearInventory();
    const item = gearInventory.clothingItems.find(c => c.uid === uid);
    if (!item) return;
    gearInventory.clothing[item.slot] = item;
    deps.saveGearInventory();
    deps.refreshPlayerAvatar();
    deps.showToast(clothingArticleLabel(item) + ' equipped!', true);
    buildEquipmentSlots();
    selectGearClothing(item.slot, item);
  }

  function selectGearClothing(slot, item) {
    deps.clearInvSelection();
    const emptyEl  = document.getElementById('iiEmpty');
    const detailEl = document.getElementById('iiDetail');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (detailEl) detailEl.style.display  = '';
    const set = (id, val) => { const el = document.getElementById(id); if (el) el[typeof val === 'string' ? 'textContent' : 'innerHTML'] = val; };
    setInventoryDetailClothingIcon(item);
    set('iiName',  clothingArticleLabel(item));
    set('iiPrice', 'Permanent gear — not sellable');
    set('iiTags',  '');
    const gearInventory = deps.getGearInventory();
    const isWorn = gearInventory?.clothing?.[slot]?.uid === item.uid;
    set('iiDesc',  isWorn ? 'Currently worn. Select another collected piece below to swap.' : 'Collected clothing in gear. Equip it to wear it.');
    const actEl = document.getElementById('iiActions');
    if (actEl) {
      actEl.innerHTML = '';
      if (!isWorn) {
        const equipBtn = document.createElement('button');
        equipBtn.className = 'ii-btn equip';
        equipBtn.textContent = 'Equip';
        equipBtn.onclick = () => equipGearClothing(item.uid);
        actEl.appendChild(equipBtn);
      } else {
        const btn = document.createElement('button');
        btn.className = 'ii-btn';
        btn.textContent = 'De-equip';
        btn.onclick = () => {
          gearInventory.clothing[slot] = null;
          deps.saveGearInventory();
          deps.refreshPlayerAvatar();
          buildEquipmentSlots();
          deps.clearInventoryDetail();
        };
        actEl.appendChild(btn);
      }
      const redyeBtn = document.createElement('button');
      redyeBtn.className = 'ii-btn redye';
      redyeBtn.textContent = '🎨 Redye';
      redyeBtn.onclick = () => openRedyePanel(slot, item);
      actEl.appendChild(redyeBtn);

      // Clothing never enters the item wheel (see getHeldGiftItem in
      // game.js), so this is the only way to hold a piece of it out for an
      // interaction like gifting — worn or not, equip status is unrelated
      // to whether it's currently "held".
      const heldNow = deps.getManualHeldItem?.();
      const isHeld = heldNow?.kind === 'clothing' && heldNow?.uid === item.uid;
      const holdBtn = document.createElement('button');
      holdBtn.className = 'ii-btn' + (isHeld ? '' : ' secondary');
      holdBtn.textContent = isHeld ? '✋ Holding — Stop' : '✋ Hold';
      holdBtn.onclick = () => {
        deps.setManualHeldItem?.(isHeld ? null : { kind: 'clothing', uid: item.uid });
        selectGearClothing(slot, item);
      };
      actEl.appendChild(holdBtn);
    }
  }

  // ── Redye panel ──────────────────────────────────────────────────
  // Opened from a clothing item's info panel (see selectGearClothing's
  // Redye button). It combines globally unlocked dye-item shades with the
  // shades learned specifically by acquiring dyed copies of this article.
  // Redyeing itself is free and never promotes an article-only shade into
  // the global dye collection.
  function closeRedyePanel() {
    const panel = document.getElementById('dyePanel');
    if (!panel) return;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  }

  function openRedyePanel(slot, item) {
    window.DyeSystem.ensureCollection();
    ensureArticleDyeIds(item);
    const panel = document.getElementById('dyePanel');
    const titleEl = document.getElementById('dyePanelTitle');
    const subslotsEl = document.getElementById('dyePanelSubslots');
    const groupsEl = document.getElementById('dyePanelGroups');
    const previewEl = document.getElementById('dyePanelPreview');
    if (!panel || !titleEl || !subslotsEl || !groupsEl || !previewEl) return;

    const gearInventory = deps.getGearInventory();
    const tintKeys = clothingTintKeysForSlot(slot);
    const hasSecondary = tintKeys.length > 1;
    const originalColorA = item.colorA ? { ...item.colorA } : null;
    const originalColorB = item.colorB ? { ...item.colorB } : null;
    const originalLabel = item.label;
    const articleLabel = clothingArticleLabel(item);
    let activeSubslot = 'A';
    let pendingDyeIdA = item.colorA?.dyeId || null;
    let pendingDyeIdB = item.colorB?.dyeId || null;

    const currentPendingId = () => (activeSubslot === 'B' ? pendingDyeIdB : pendingDyeIdA);
    const setPendingId = (id) => { if (activeSubslot === 'B') pendingDyeIdB = id; else pendingDyeIdA = id; };
    const isWorn = () => gearInventory?.clothing?.[slot]?.uid === item.uid;

    function applyPreview() {
      const dyeA = pendingDyeIdA ? window.DyeSystem.getById(pendingDyeIdA) : null;
      const dyeB = hasSecondary && pendingDyeIdB ? window.DyeSystem.getById(pendingDyeIdB) : null;
      if (dyeA) item.colorA = window.DyeSystem.toClothingColor(dyeA);
      if (hasSecondary && dyeB) item.colorB = window.DyeSystem.toClothingColor(dyeB);
      const dyeLbl = hasSecondary && dyeB ? ((dyeA || {}).label + ' & ' + dyeB.label) : (dyeA || {}).label;
      previewEl.innerHTML = '';
      if (dyeA) {
        const chipA = document.createElement('span');
        chipA.className = 'dye-preview-chip';
        chipA.style.background = dyeA.hex;
        chipA.title = dyeA.label;
        previewEl.appendChild(chipA);
      }
      if (hasSecondary && dyeB) {
        const chipB = document.createElement('span');
        chipB.className = 'dye-preview-chip';
        chipB.style.background = dyeB.hex;
        chipB.title = dyeB.label;
        previewEl.appendChild(chipB);
      }
      const label = document.createElement('span');
      label.className = 'dye-preview-label';
      label.textContent = dyeLbl ? (dyeLbl + ' ' + articleLabel) : 'Pick a dye below';
      previewEl.appendChild(label);
      if (isWorn()) deps.refreshPlayerAvatar();
    }

    function renderSubslots() {
      subslotsEl.innerHTML = '';
      if (!hasSecondary) return;
      [['A', 'Primary'], ['B', 'Trim']].forEach(([which, label]) => {
        const b = document.createElement('button');
        b.className = 'dye-subslot-btn' + (activeSubslot === which ? ' active' : '');
        b.textContent = label;
        b.onclick = () => { activeSubslot = which; renderSubslots(); renderGroups(); };
        subslotsEl.appendChild(b);
      });
    }

    function renderGroups() {
      groupsEl.innerHTML = '';
      const groups = window.DyeSystem.ownedByHue(item.articleDyeIds);
      if (!groups.length) {
        groupsEl.innerHTML = '<div class="dye-panel-empty">No dyes available for this article yet.</div>';
        return;
      }
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
          const sw = document.createElement('button');
          sw.className = 'dye-swatch' + (currentPendingId() === dye.id ? ' selected' : '');
          sw.style.background = dye.hex;
          sw.title = dye.label;
          sw.onclick = () => { setPendingId(dye.id); renderGroups(); applyPreview(); };
          row.appendChild(sw);
        }
        section.appendChild(row);
        groupsEl.appendChild(section);
      }
    }

    titleEl.textContent = 'Redye — ' + articleLabel;
    renderSubslots();
    renderGroups();
    applyPreview();
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');

    const revert = () => {
      item.colorA = originalColorA;
      item.colorB = originalColorB;
      item.label = originalLabel;
      if (isWorn()) deps.refreshPlayerAvatar();
    };
    document.getElementById('dyePanelCancel').onclick = () => { revert(); closeRedyePanel(); };
    document.getElementById('dyePanelClose').onclick = () => { revert(); closeRedyePanel(); };
    document.getElementById('dyePanelApply').onclick = () => {
      if (!pendingDyeIdA) { deps.showToast('Pick a dye first.', false); return; }
      const dyeA = window.DyeSystem.getById(pendingDyeIdA);
      const dyeB = hasSecondary && pendingDyeIdB ? window.DyeSystem.getById(pendingDyeIdB) : null;
      const dyeLbl = hasSecondary && dyeB ? (dyeA.label + ' & ' + dyeB.label) : dyeA.label;
      item.label = dyeLbl + ' ' + articleLabel;
      item.baseLabel = articleLabel;
      deps.saveGearInventory();
      if (isWorn()) deps.refreshPlayerAvatar();
      deps.showToast('Redyed ' + articleLabel + '!', true);
      closeRedyePanel();
      buildEquipmentSlots(); // Rebuild immediately so the gear icon takes on the newly selected primary dye.
      selectGearClothing(slot, item);
    };
  }

  function buildPackClothingSection() {
    const sec = document.getElementById('invPackClothing');
    if (!sec) return;
    const packClothing = deps.getPackClothing();
    if (!packClothing.length) {
      sec.innerHTML = '<div class="inv-pcloth-empty">No clothing in pack.</div>';
      return;
    }
    sec.innerHTML = '';
    packClothing.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'inv-pcloth-item';
      renderClothingIcon(btn, item, 'ipc-sprite');
      const name = document.createElement('span');
      name.className = 'ipc-name';
      name.textContent = item.label;
      btn.appendChild(name);
      btn.addEventListener('click', () => selectPackClothingItem(item.uid));
      sec.appendChild(btn);
    });
  }

  // Build the equipment slots panel inside #invEquipSection
  function buildEquipmentSlots() {
    const sec = document.getElementById('invEquipSection');
    if (!sec) return;
    sec.innerHTML = '';
    const gearInventory = deps.getGearInventory();
    const activeTool = deps.getActiveTool();

    // ── Tool Slot Assignments ─────────────────────────────
    const slotHdr = document.createElement('div');
    slotHdr.className = 'inv-equip-label';
    slotHdr.textContent = 'Tool Slots';
    sec.appendChild(slotHdr);

    const toolRow = document.createElement('div');
    toolRow.className = 'inv-equip-row';
    const TOOL_SLOTS = ['hoe', 'shovel', 'axe', 'pick', 'harpoon', 'weapon', 'ranged'];
    for (const slot of TOOL_SLOTS) {
      const itemKey = deps.equipmentSlots[slot];
      const def = itemKey ? deps.TOOL_ITEM_DEFS[itemKey] : null;
      const cell = document.createElement('div');
      cell.className = 'inv-equip-slot' + (activeTool === slot ? ' active-slot' : '') + (def ? ' occupied' : '');
      cell.setAttribute('title', slot + (def ? ': ' + def.label : ' (empty)'));
      if (def) {
        const img = document.createElement('img');
        img.src = deps.metalToolImgSrc(def); img.className = 'ies-sprite'; img.alt = def.label;
        cell.appendChild(img);
        const unBtn = document.createElement('button');
        unBtn.className = 'ies-unequip'; unBtn.textContent = '✕'; unBtn.title = 'Unassign ' + def.label;
        unBtn.addEventListener('click', (e) => { e.stopPropagation(); unequipItem(slot); });
        cell.appendChild(unBtn);
      }
      const lbl = document.createElement('span');
      lbl.className = 'ies-label';
      lbl.textContent = slot.charAt(0).toUpperCase() + slot.slice(1);
      cell.appendChild(lbl);
      // Clicking the slot itself shows every tool that fits it as
      // one-click assign buttons in the item-info panel — you don't
      // need to separately pick an item then a slot for it, the way
      // clicking an Owned Tools item (selectGearTool) still also works.
      cell.addEventListener('click', () => { deps.setActiveTool(slot); buildEquipmentSlots(); selectEquipSlot(slot); });
      toolRow.appendChild(cell);
    }
    sec.appendChild(toolRow);

    // ── Owned Tools (gear inventory) ──────────────────────
    const ownedHdr = document.createElement('div');
    ownedHdr.className = 'inv-equip-label';
    ownedHdr.textContent = 'Owned Tools';
    sec.appendChild(ownedHdr);

    const gearTools = Object.keys(gearInventory?.tools || {}).filter(k => gearInventory.tools[k] && deps.TOOL_ITEM_DEFS[k]);
    if (gearTools.length) {
      const gearRow = document.createElement('div');
      gearRow.className = 'inv-equip-row';
      for (const key of gearTools) {
        const def = deps.TOOL_ITEM_DEFS[key];
        const cell = document.createElement('div');
        cell.className = 'inv-equip-slot';
        cell.setAttribute('title', def.label + ' (Mastery ' + deps.toolMasteryLevel(key) + '/5) — click to assign');
        const img = document.createElement('img');
        img.src = deps.metalToolImgSrc(def); img.className = 'ies-sprite'; img.alt = def.label;
        cell.appendChild(img);
        const lbl = document.createElement('span');
        lbl.className = 'ies-label';
        lbl.textContent = def.label.split(' ')[0] + ' Lv' + deps.toolMasteryLevel(key);
        cell.appendChild(lbl);
        cell.addEventListener('click', () => selectGearTool(key));
        gearRow.appendChild(cell);
      }
      sec.appendChild(gearRow);
    } else {
      const empty = document.createElement('div');
      empty.className = 'inv-equip-empty';
      empty.textContent = 'No tools in gear.';
      sec.appendChild(empty);
    }

    ensureGearClothingCollection();

    // ── Clothing Slots ────────────────────────────────────
    const clothHdr = document.createElement('div');
    clothHdr.className = 'inv-equip-label';
    clothHdr.textContent = 'Clothing';
    sec.appendChild(clothHdr);

    const clothRow = document.createElement('div');
    clothRow.className = 'inv-equip-row';
    for (const slot of CLOTHING_SLOTS) {
      const item = gearInventory?.clothing?.[slot];
      const cell = document.createElement('div');
      cell.className = 'inv-equip-slot clothing-slot' + (item ? ' occupied' : '');
      const articleLabel = item ? clothingArticleLabel(item) : '';
      cell.setAttribute('title', slot + (item ? ': ' + articleLabel : ' (empty)'));
      if (item) {
        renderClothingIcon(cell, item);
        const nameEl = document.createElement('span');
        nameEl.className = 'ies-cloth-name'; nameEl.textContent = articleLabel;
        cell.appendChild(nameEl);
      }
      const lbl = document.createElement('span');
      lbl.className = 'ies-label';
      lbl.textContent = slot.charAt(0).toUpperCase() + slot.slice(1);
      cell.appendChild(lbl);
      if (item) cell.addEventListener('click', () => selectGearClothing(slot, item));
      clothRow.appendChild(cell);
    }
    sec.appendChild(clothRow);

    const ownedClothing = (gearInventory?.clothingItems || []).filter(Boolean);
    const ownedClothHdr = document.createElement('div');
    ownedClothHdr.className = 'inv-equip-label';
    ownedClothHdr.textContent = 'Owned Clothing';
    sec.appendChild(ownedClothHdr);
    if (ownedClothing.length) {
      const ownedClothRow = document.createElement('div');
      ownedClothRow.className = 'inv-equip-row inv-owned-clothing-row';
      for (const item of ownedClothing) {
        const worn = gearInventory?.clothing?.[item.slot]?.uid === item.uid;
        const articleLabel = clothingArticleLabel(item);
        const cell = document.createElement('div');
        cell.className = 'inv-equip-slot clothing-owned-slot occupied' + (worn ? ' active-slot' : '');
        cell.setAttribute('title', articleLabel + (worn ? ' — currently worn' : ' — click to equip'));
        const ownedIcon = renderClothingIcon(cell, item);
        // Owned clothing art should dominate the tile; the normal clothing sprite is too conservative here.
        ownedIcon.style.width = 'calc(2.3 * var(--inv-row))';
        ownedIcon.style.height = 'calc(2.3 * var(--inv-row))';
        ownedIcon.style.maxWidth = '82%';
        ownedIcon.style.maxHeight = '82%';
        const nameEl = document.createElement('span');
        nameEl.className = 'gear-owned-clothing-name';
        nameEl.textContent = articleLabel;
        nameEl.style.fontSize = 'var(--inv-font-xs, 11px)';
        nameEl.style.lineHeight = '1.08';
        nameEl.style.maxWidth = 'calc(100% - 4px)';
        nameEl.style.overflow = 'hidden';
        nameEl.style.textOverflow = 'ellipsis';
        nameEl.style.whiteSpace = 'nowrap';
        cell.appendChild(nameEl);
        const lbl = document.createElement('span');
        lbl.className = 'ies-label';
        lbl.textContent = item.slot.charAt(0).toUpperCase() + item.slot.slice(1);
        cell.appendChild(lbl);
        cell.addEventListener('click', () => selectGearClothing(item.slot, item));
        ownedClothRow.appendChild(cell);
      }
      sec.appendChild(ownedClothRow);
    } else {
      const empty = document.createElement('div');
      empty.className = 'inv-equip-empty';
      empty.textContent = 'No collected clothing in gear.';
      sec.appendChild(empty);
    }
    window.WhistleEquip.build();
  }

  window.EquipmentPanel = {
    init,
    setEquipmentSlot,
    equipItem,
    unequipItem,
    transferToolToGear,
    applyGearClothingToPlayerData,
    clothingSpriteForCosmetic,
    ensureGearClothingCollection,
    buildPackClothingSection,
    buildEquipmentSlots,
  };
})();