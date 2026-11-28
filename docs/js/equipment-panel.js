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
  let playerReadyListenerInstalled = false; // Ensures a repeated EquipmentPanel.init() cannot accumulate character-load handlers.
  let archivedToolsCollapsed = true; // Controls the optional long-term tool drawer in Gear.
  let archivedClothingCollapsed = true; // Controls the optional long-term clothing drawer in Gear.
  const CLOTHING_SLOTS = ['hat', 'hood', 'mask', 'pauldron', 'torso', 'overwear', 'pants']; // Used anywhere gear clothing must be normalized or rendered by slot; pauldrons persist independently from torso/overwear.
  const clothingIconTintUrlCache = new Map(); // Used to reuse SpriteRecolor output instead of re-encoding the same dyed icon every panel rebuild.

  const toolIconFrames = new Map(); // Reuses one opaque-pixel scan and square thumbnail per resolved metal/pattern source.
  const toolIconDebug = { ready: 0, failed: 0, lastFrame: null, lastTrimMs: 0, slowestTrimMs: 0, latestChange: 'Tool icons trim transparent margins and square from the bottom edge.' }; // Readable through EquipmentPanel on mobile.

  function squareToolIcon(source, options = {}) {
    // This function is also extracted standalone by framing tests and tools;
    // keep profiling self-contained without depending on global performance.
    const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now() : Date.now();
    const startedAt = now(); // Cold-path timing only, never a per-frame profiler.
    function finishToolIcon(output) {
      const url = output.toDataURL('image/png');
      const elapsedMs = Math.round((now() - startedAt) * 10) / 10; // Includes PNG encoding.
      toolIconDebug.lastTrimMs = elapsedMs;
      toolIconDebug.slowestTrimMs = Math.max(toolIconDebug.slowestTrimMs || 0, elapsedMs);
      return url;
    }
    const image = options.flute ? (window.KurrayaInstrument?.prepareFluteCanvas?.(source) || source) : source; // Nonmetal flute art uses the same matte-free pixels as its world mesh.
    const width = image.width; // Source dimensions bound the alpha scan.
    const height = image.height; // Source dimensions bound the alpha scan.
    const canvas = document.createElement('canvas'); // Reads the already loaded sprite without changing held/world art.
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d'); // Used only once for each cached sprite source.
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data; // Alpha bytes identify the visible frame.
    let left = width, right = -1, top = height, bottom = -1; // Inclusive bounds of all nontransparent pixels.
    for (let y = 0; y < height; y++) {
      let rowLeft = width, rowRight = -1; // Track bounds once per occupied row, not with four Math.min/max calls per opaque pixel.
      const alphaStart = y * width * 4 + 3; // Alpha-byte offset into this row of the existing 4-channel image buffer.
      for (let x = 0; x < width; x++) {
        if (!pixels[alphaStart + x * 4]) continue;
        if (x < rowLeft) rowLeft = x;
        rowRight = x;
      }
      if (rowRight < 0) continue;
      if (rowLeft < left) left = rowLeft;
      if (rowRight > right) right = rowRight;
      if (y < top) top = y;
      bottom = y;
    }
    if (right < left) throw new Error('Tool sprite contains no opaque pixels');
    const side = right - left + 1; // Opaque width determines the square; tall sprites crop above its bottom edge.
    const visibleHeight = Math.min(side, bottom - top + 1); // Short sprites receive transparent padding above.
    const output = document.createElement('canvas'); // A small square limits retained thumbnail memory.
    output.width = output.height = 128;
    const outputContext = output.getContext('2d'); // Draws an undistorted crop anchored to the opaque bottom edge.
    if (options.flute) {
      const inkWidth = right - left + 1, inkHeight = bottom - top + 1; // Keep the entire slender flute, unlike a bottom-cropped melee-weapon thumbnail.
      const scale = 112 / Math.max(inkWidth, inkHeight); // Leave eight transparent pixels around the long instrument on every side.
      const drawWidth = inkWidth * scale, drawHeight = inkHeight * scale;
      outputContext.drawImage(canvas, left, top, inkWidth, inkHeight, (128-drawWidth)/2, (128-drawHeight)/2, drawWidth, drawHeight);
      return finishToolIcon(output);
    }
    outputContext.drawImage(canvas, left, bottom - visibleHeight + 1, side, visibleHeight,
      0, (side - visibleHeight) * 128 / side, 128, visibleHeight * 128 / side);
    toolIconDebug.lastFrame = { left, top, right, bottom, side };
    return finishToolIcon(output);
  }

  function renderToolIcon(parent, def) {
    const isFlute = def?.sprite === 'assets/toolsprites/flute.png'; // Routes only this slender, matte-backed PNG through the special full-height icon renderer.
    const source = isFlute ? def.sprite : (deps.metalToolImgSrc?.(def) || def?.sprite); // Metal tools keep their authored finish.
    const image = document.createElement('img'); // Preserves existing inventory sizing and accessibility.
    image.className = 'ies-sprite'; image.alt = def.label;
    image.crossOrigin = 'anonymous';
    parent.appendChild(image);
    if (!source) { image.replaceWith(document.createTextNode(def.icon || '🔧')); return; }
    let pending = toolIconFrames.get(source); // Shares in-flight work across equipped and owned-tool cells.
    if (!pending) {
      pending = new Promise(resolve => {
        const loader = new Image(); // Separate loader prevents thumbnail src updates from retriggering the scan.
        loader.crossOrigin = 'anonymous';
        loader.onload = () => {
          try { const url = squareToolIcon(loader,{flute:isFlute}); toolIconDebug.ready++; resolve(url); }
          catch (error) { toolIconDebug.failed++; window.__farmLog?.(`[inventory-icon] ${def.label}: ${error.message}`, 'warn'); resolve(source); }
        };
        loader.onerror = () => { toolIconDebug.failed++; resolve(null); };
        loader.src = source;
      });
      toolIconFrames.set(source, pending);
      if (toolIconFrames.size > 128) toolIconFrames.delete(toolIconFrames.keys().next().value);
    }
    pending.then(url => {
      if (url) image.src = url;
      else image.replaceWith(document.createTextNode(def.icon || '🔧'));
    });
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    registerFluteDefinition();
    // Existing characters receive the starter instrument only after saved
    // character data loads. Repeated init must not multiply load reconciliations.
    if (!playerReadyListenerInstalled && typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('hobunjiPlayerReady', onPlayerReady);
      playerReadyListenerInstalled = true;
    }
    window.DevCompanion?.registerCheatPanel?.({
      id: 'tool-mastery', title: 'Tool mastery', order: 31,
      render: () => ({ actions: Object.keys(deps.getGearInventory()?.tools || {})
        .filter(key => deps.getGearInventory().tools[key] && deps.TOOL_ITEM_DEFS[key] && deps.toolMasteryLevel(key) < 5)
        .map(key => ({ id: 'mastery', label: `+1 ${deps.TOOL_ITEM_DEFS[key].label} (${deps.toolMasteryLevel(key)}/5)`, args: { key } })) }),
      onAction: (action, { key }) => {
        if (action !== 'mastery' || !deps.getGearInventory()?.tools?.[key] || !deps.TOOL_ITEM_DEFS[key]) return { ok: false };
        deps.devBumpToolMasteryLevel(key);
        buildEquipmentSlots();
        window.CombatLoadoutUI?.render?.();
        return { ok: true };
      },
    });
    installInventorySelectionBridge();
    loadInventoryUi();
  }

  function onPlayerReady() {
    closeClothingNests(); // Never carry an expanded inventory path across character sessions.
    ensureStarterFlute();
    reconcileArchivedGear();
  }

  function registerFluteDefinition() {
    if (!deps?.TOOL_ITEM_DEFS) return false;
    deps.TOOL_ITEM_DEFS.flute ||= {
      label:'Flute', icon:'🎶', sprite:'assets/toolsprites/flute.png', slots:['instrument'],
      isInstrument:true, heldAnimationKey:'flutePlayNote', // The note action now owns its own head-relative pose, rather than borrowing the loaded blowgun.
      description:'A simple mouth-played flute. Its eight notes can echo melodies heard in ancient ruins.',
    }; // The canonical item registry drives equipment/ownership and the existing tool sprite renderer.
    return true;
  }

  function ensureStarterFlute() {
    const gear = deps?.getGearInventory?.(); // Current character-owned gear, never a global once-per-browser entitlement.
    if (!gear || !registerFluteDefinition()) return false;
    if (gear.starterFluteGranted) return false; // Never reassign after the player deliberately unequips or replaces it.
    gear.tools ||= {};
    gear.tools.flute = true;
    gear.starterFluteGranted = true;
    deps.saveGearInventory?.();
    if (!deps.equipmentSlots?.instrument) {
      deps.equipmentSlots.instrument = 'flute';
      deps.saveEquipmentSlots?.();
    }
    deps.rebuildToolMeshes?.(); // A migrated flute becomes available to the live held-tool renderer, not just the Inventory UI.
    window.__farmLog?.('[starter-flute] granted once to current character; instrument=' + deps.equipmentSlots?.instrument,'input');
    return true;
  }

  function installInventorySelectionBridge() {
    if (inventorySelectionBridgeInstalled || typeof document === 'undefined') return;
    inventorySelectionBridgeInstalled = true;
    // The mastery panel stores its last rendered key for debug output only. Clear it before every inventory
    // click so the post-click presentation pass resolves the current detail item instead of reusing an old tool.
    document.addEventListener('click', (event) => {
      if (!event.target?.closest?.('#mpInventory')) return;
      if (!event.target.closest('.clothing-nest') && event.target.closest('.inv-cat, #invTabPack, #invTabGear, .inv-item-box, .inv-equip-slot, [data-ctrl-group-open]')) closeClothingNests(); // Unrelated selection closes the previous clothing branch.
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
    script.src = 'js/inventory-ui.js?v=20261127lessonGlow1';
    script.async = false;
    script.onload = () => window.InventoryUI?.init?.(inventoryUiDeps());
    script.onerror = () => {
      inventoryUiLoadStarted = false;
      if (deps.isDevMode?.()) deps.showToast?.('Inventory UI polish module failed to load.', false);
    };
    document.head.appendChild(script);
  }

  function setEquipmentSlot(slot, itemKeyOrNull) {
    const instrumentChanged = slot === 'instrument' && deps.equipmentSlots[slot] !== itemKeyOrNull; // Signals the loadout picker when its authoritative equipped instrument changes.
    if (instrumentChanged) window.MusicMinigame?.close?.();
    deps.equipmentSlots[slot] = itemKeyOrNull;
    deps.saveEquipmentSlots();
    if (instrumentChanged && typeof window.dispatchEvent === 'function' && typeof Event === 'function') window.dispatchEvent(new Event('hobunji-instrument-equipped')); // Browser-only notification; headless equipment tests still persist normally.
  }

  function isToolArchived(key, gear = deps?.getGearInventory?.()) {
    return gear?.archivedTools?.[key] === true; // The character-owned Gear record tracks tool storage without losing mastery or ownership.
  }

  function isClothingArchived(item) {
    return item?.archived === true; // Each physical garment carries its own optional storage state.
  }

  function refreshToolAssignments() {
    deps.rebuildToolMeshes?.(); // Reload the currently equipped tool after archiving an assigned one.
    for (const mesh of Object.values(deps.toolMeshMap || {})) if (mesh) deps.toolHolder?.remove?.(mesh);
    const activeMesh = deps.toolMeshMap?.[deps.getActiveTool?.()]; // Restores only the still-equipped active slot's mesh.
    if (activeMesh) deps.toolHolder?.add?.(activeMesh);
    deps.refreshActionBar?.();
    deps.buildInventoryGrid?.();
  }

  function clearArchivedToolAssignments(shouldClear) {
    let changed = false; // Multiple slots may hold the same tool; persist one coherent slot update instead of N full saves.
    for (const [slot, key] of Object.entries(deps.equipmentSlots || {})) {
      if (!key || !shouldClear(key)) continue;
      if (slot === 'instrument') window.MusicMinigame?.close?.(); // Preserve the existing instrument slot's performance cleanup.
      deps.equipmentSlots[slot] = null;
      changed = true;
    }
    if (changed) deps.saveEquipmentSlots?.();
    return changed;
  }

  function reconcileArchivedGear() {
    const gear = deps?.getGearInventory?.();
    if (!gear) return false;
    const toolsChanged = clearArchivedToolAssignments(key => isToolArchived(key, gear)); // One save reconciles all invalid tool assignments.
    let clothingChanged = false; // Tracks worn garments that should have been removed when they were stowed.
    for (const slot of CLOTHING_SLOTS) {
      if (!isClothingArchived(gear.clothing?.[slot])) continue;
      gear.clothing[slot] = null;
      clothingChanged = true;
    }
    if (toolsChanged) refreshToolAssignments();
    if (clothingChanged) { deps.saveGearInventory?.(); deps.refreshPlayerAvatar?.(); }
    return toolsChanged || clothingChanged;
  }

  function setToolArchived(key, archived) {
    const gear = deps?.getGearInventory?.();
    if (!gear?.tools?.[key] || !deps.TOOL_ITEM_DEFS?.[key]) return false;
    if (isToolArchived(key, gear) === !!archived) return false;
    gear.archivedTools ||= {}; // Lives beside tools in the existing character-scoped Gear save.
    if (archived) {
      gear.archivedTools[key] = true;
      if (clearArchivedToolAssignments(equippedKey => equippedKey === key)) refreshToolAssignments();
      archivedToolsCollapsed = false;
    } else delete gear.archivedTools[key];
    deps.saveGearInventory?.();
    deps.showToast?.(`${deps.TOOL_ITEM_DEFS[key].label} ${archived ? 'stowed' : 'returned to available Gear'}.`, true);
    buildEquipmentSlots();
    deps.clearInventoryDetail?.();
    return true;
  }

  function setClothingArchived(uid, archived) {
    ensureGearClothingCollection();
    const gear = deps?.getGearInventory?.();
    const item = gear?.clothingItems?.find(entry => entry?.uid === uid); // UID preserves independent storage of patterned pieces.
    if (!item || isClothingArchived(item) === !!archived) return false;
    if (archived) {
      item.archived = true;
      archivedClothingCollapsed = false;
    } else delete item.archived;
    let wasWorn = false; // Triggers one avatar rebuild only if a worn garment was just stowed.
    if (archived) for (const slot of CLOTHING_SLOTS) {
      if (gear.clothing?.[slot]?.uid !== uid) continue;
      gear.clothing[slot] = null;
      wasWorn = true;
    }
    deps.saveGearInventory?.();
    if (wasWorn) deps.refreshPlayerAvatar?.();
    deps.showToast?.(`${clothingArticleLabel(item)} ${archived ? 'stowed' : 'returned to available Gear'}.`, true);
    buildEquipmentSlots();
    deps.clearInventoryDetail?.();
    return true;
  }

  function appendArchiveToggle(sec, label, count, collapsed, onToggle) {
    const toggle = document.createElement('button'); // Touch/controller-accessible drawer instead of adding archived items to the ordinary Pack.
    toggle.type = 'button';
    toggle.className = 'settings-small-btn gear-archive-toggle';
    toggle.textContent = `${collapsed ? '▸' : '▾'} ${label} · ${count}`;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.addEventListener('click', onToggle);
    sec.appendChild(toggle);
  }

  // Assign a tool item to a slot (tool must be in gear inventory)
  function equipItem(itemKey, slot) {
    const toolDef = deps.TOOL_ITEM_DEFS[itemKey];
    if (!toolDef || !toolDef.slots.includes(slot)) { deps.showToast('Cannot assign that item to that slot.', false); return; }
    const gearInventory = deps.getGearInventory();
    if (!gearInventory?.tools?.[itemKey]) { deps.showToast((deps.TOOL_ITEM_DEFS[itemKey]?.label || itemKey) + ' is not in your gear. Transfer it first.', false); return; }
    if (isToolArchived(itemKey, gearInventory)) { deps.showToast('Take this tool out of Gear storage before assigning it.', false); return; }
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
    if (gearInventory.tools[itemKey]) { deps.showToast(toolDef.label + (isToolArchived(itemKey, gearInventory) ? ' is stowed in your Gear archive.' : ' is already in your gear.'), false); return; }
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

  function normalizedClothingQualityStars(value) {
    if (value == null) return null;
    const stars = Number(value); // Used by Pack presentation and Gear valuation metadata without coercing null into a fake 1★ rating.
    return Number.isFinite(stars) ? Math.max(1, Math.min(5, Math.round(stars))) : null;
  }

  function clothingValuationQualityStars(item) {
    return normalizedClothingQualityStars(item?.valuationQualityStars ?? item?.qualityStars); // Pack uses visible qualityStars; Gear persists only this valuation-specific copy for gifts.
  }

  function migrateGearClothingQuality(item) {
    if (!item || typeof item !== 'object') return false;
    const stars = clothingValuationQualityStars(item); // Used to migrate the first implementation's visible Gear quality into internal valuation metadata.
    let changed = false; // Used to save only when a legacy/feature-branch Gear record actually changes.
    if (stars != null && item.valuationQualityStars !== stars) {
      item.valuationQualityStars = stars;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(item, 'qualityStars')) {
      delete item.qualityStars;
      changed = true;
    }
    return changed;
  }

  // Only provenance differs between copies of the same physical garment. Keep all dyes,
  // quality, patterns, material, pricing, Temper and unknown future attributes in the comparison.
  const CLOTHING_STACK_IGNORED_FIELDS = new Set(['uid', 'craftedAt']); // Used solely by visual stack grouping, never by item storage.

  function clothingStackSignature(item) {
    if (!item || typeof item !== 'object') return null;
    const sortedValue = (value) => { // Stable nested ordering allows old/new saves with different property insertion order to stack.
      if (Array.isArray(value)) return value.map(sortedValue);
      if (value && typeof value === 'object') {
        const ordered = {}; // Used only to produce a deterministic display fingerprint.
        for (const key of Object.keys(value).sort()) ordered[key] = sortedValue(value[key]);
        return ordered;
      }
      return value;
    };
    const properties = {}; // A display-only view of this article: no item IDs or timestamps are modified.
    for (const key of Object.keys(item).sort()) {
      if (CLOTHING_STACK_IGNORED_FIELDS.has(key)) continue;
      let value = item[key]; // Used to normalize generated cosmetic IDs for otherwise identical loom/smith copies.
      if (key === 'cosmeticId' && typeof value === 'string' && typeof item.baseCosmeticId === 'string'
          && (value.startsWith(item.baseCosmeticId + '#loom:') || value.startsWith(item.baseCosmeticId + '#smith:'))) {
        value = item.baseCosmeticId;
      }
      properties[key] = sortedValue(value);
    }
    return JSON.stringify(properties);
  }

  function groupClothingForDisplay(items) {
    const groups = []; // Ordered by first appearance, so stacks don't jump around as quantities change.
    const bySignature = new Map(); // Used only for the current render; every saved item remains individual.
    const maxPerTile = Math.max(1, Math.floor(Number(window.InventoryStacks?.STACK_SIZE) || 999)); // Reuses normal Pack's limit of 999 per box.
    for (const item of (items || [])) {
      if (!item || typeof item !== 'object') continue;
      const signature = clothingStackSignature(item); // The complete gameplay/appearance data (apart from provenance) determines identity.
      let group = bySignature.get(signature);
      if (!group || group.count >= maxPerTile) {
        group = { item, count: 0, uids: [] }; // Representative receives actions; all underlying records remain available.
        bySignature.set(signature, group);
        groups.push(group);
      }
      group.count++;
      group.uids.push(item.uid);
    }
    return groups;
  }

  // Display hierarchy only: never combine the actual UID, dye, quality or saved pattern records.
  function clothingNameGroups(items) {
    const groups = new Map(); // Stable first-occurrence order; item order within each group follows acquisition order.
    for (const item of items || []) {
      if (!item || !item.uid) continue;
      const label = clothingArticleLabel(item);
      const key = label.toLowerCase();
      let group = groups.get(key);
      if (!group) groups.set(key, group = { key, label, items: [], plain: [], patterned: [] });
      group.items.push(item);
      const patterned = hasIndividualClothingPattern(item);
      (patterned ? group.patterned : group.plain).push(item);
    }
    return [...groups.values()];
  }

  let openClothingPath = []; // At most one name nest and its plain child stay open across grid rebuilds.
  let packClothingRevision = 0; // Incremented by the existing Pack build; the visible UI uses it to avoid rerender loops.

  function closeClothingNests() {
    if (!openClothingPath.length) return;
    openClothingPath = [];
    if (typeof document !== 'undefined') for (const nest of document.querySelectorAll('.clothing-nest')) nest.refreshClothingNest?.();
  }

  function clothingPathOpen(path) {
    return path.every((key, index) => openClothingPath[index] === key);
  }

  function renderClothingStackIcon(parent, items, limit, iconClass) {
    const stack = document.createElement('span'); // Each thumbnail is independently tinted/composited by the existing icon renderer.
    stack.className = 'clothing-stack-art';
    const recent = items.slice(-limit); // Acquisition order is the owning inventory's append order; newest appears on top.
    recent.forEach((item, index) => {
      const icon = renderClothingIcon(stack, item, iconClass);
      const offset = index - (recent.length - 1) / 2;
      icon.style.setProperty('--clothing-stack-x', (offset * 8) + '%');
      icon.style.setProperty('--clothing-stack-y', (offset * 5) + '%');
    });
    parent.appendChild(stack);
  }

  function buildClothingNest(path, label, items, limit, createChildren, gear = false) {
    const node = document.createElement('div'); // A real controller group, with a compact opener and lazily rendered children.
    node.className = 'clothing-nest' + (gear ? ' clothing-nest-gear' : ' clothing-nest-pack');
    node.setAttribute('data-ctrl-group', '');
    node.setAttribute('data-ctrl-collapse-on-back', '');
    node.setAttribute('data-key', JSON.stringify(path));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = gear ? 'inv-equip-slot occupied clothing-nest-toggle' : 'inv-item-box pack-clothing-tile clothing-nest-toggle';
    button.setAttribute('data-ctrl-group-open', '');
    button.setAttribute('aria-label', label + ', ' + items.length + ' articles');
    button.title = label;
    renderClothingStackIcon(button, items, limit, gear ? 'ies-cloth-sprite' : 'ipc-sprite');
    const name = document.createElement('span');
    name.className = 'clothing-stack-name';
    name.textContent = label;
    button.appendChild(name);
    const count = document.createElement('span');
    count.className = 'iib-count ipc-stack-count';
    count.textContent = '×' + items.length;
    button.appendChild(count);
    const body = document.createElement('div'); // Transparent so the controller enters the actual child stack or individual article.
    body.className = 'clothing-nest-body';
    body.setAttribute('data-ctrl-transparent', '');
    node.append(button, body);
    let populated = false;
    node.refreshClothingNest = () => {
      const opened = clothingPathOpen(path);
      node.classList.toggle('clothing-nest-open', opened);
      button.setAttribute('aria-expanded', String(opened));
      body.hidden = !opened;
      if (opened && !populated) {
        populated = true;
        createChildren(body);
      }
    };
    button.addEventListener('click', () => {
      openClothingPath = clothingPathOpen(path) ? path.slice(0, -1) : path.slice();
      deps?.clearInvSelection?.();
      deps?.clearInventoryDetail?.();
      // Ancestors remain open, all sibling and unrelated nests close. No item action fires on a stack.
      for (const nest of document.querySelectorAll('.clothing-nest')) nest.refreshClothingNest?.();
    });
    node.refreshClothingNest();
    return node;
  }

  function buildClothingNameNests(items, scope, renderLeaf, gear = false) {
    const groups = clothingNameGroups(items); // Prune stale paths when the last article in an expanded stack is removed.
    if (openClothingPath[0]?.startsWith(scope + ':')) {
      const openGroup = groups.find(group => scope + ':' + group.key === openClothingPath[0]);
      if (!openGroup) openClothingPath = [];
      else if (!openGroup.plain.length && openClothingPath[1] === 'plain') openClothingPath = openClothingPath.slice(0, 1);
    }
    return groups.map(group => {
      const path = [scope + ':' + group.key];
      const root = buildClothingNest(path, group.label, group.items, 5, body => {
        if (group.plain.length) body.appendChild(buildClothingNest([...path, 'plain'], 'Unpatterned', group.plain, 3, plainBody => {
          for (const item of group.plain.slice().reverse()) plainBody.appendChild(renderLeaf(item));
        }, gear));
        for (const item of group.patterned.slice().reverse()) body.appendChild(renderLeaf(item));
      }, gear);
      root.clothingSearchLabels = [group.label, ...group.items.map(item => item.label || group.label)]; // Used by Pack search without expanding every nest.
      return root;
    });
  }

  function renderPackClothingLeaf(item) {
    const tile = document.createElement('button'); // Only a concrete UID enters the existing detail/action panel.
    tile.type = 'button';
    tile.className = 'inv-item-box pack-clothing-tile';
    tile.setAttribute('data-key', item.uid);
    tile.setAttribute('data-ctrl-detail', 'invInfo');
    tile.title = [packClothingStarText(item), item.label].filter(Boolean).join(' ');
    renderClothingIcon(tile, item, 'ipc-sprite');
    tile.addEventListener('click', () => {
      selectPackClothingItem(item.uid, false, true);
      for (const other of document.querySelectorAll('#invGrid .pack-clothing-tile.selected')) other.classList.remove('selected');
      tile.classList.add('selected');
    });
    return tile;
  }

  function ensureUniquePackClothingUids(items) {
    const seen = new Set(); // Protects single-item actions and manually held references in legacy saves with repeated shop UIDs.
    let changed = false; // Caller persists the repaired list only once when needed.
    let nextId = 0; // Additional monotonic component ensures uniqueness even when two random/time values collide.
    for (const item of (items || [])) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.uid === 'string' && item.uid && !seen.has(item.uid)) {
        seen.add(item.uid);
        continue;
      }
      let replacement; // Only duplicate or missing IDs are reassigned; the first copy keeps any held reference.
      do {
        replacement = 'citem_fixed_' + Date.now().toString(36) + '_' + (++nextId).toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      } while (seen.has(replacement));
      item.uid = replacement;
      seen.add(replacement);
      changed = true;
    }
    return changed;
  }

  function packClothingQualityStars(item) {
    return normalizedClothingQualityStars(item?.qualityStars); // Only Pack clothing exposes star quality as an inventory-item property.
  }

  function packClothingStarText(item) {
    const stars = packClothingQualityStars(item); // Used by Pack rows and the Pack detail panel, never Gear presentation.
    if (stars == null) return '';
    return window.SkillSystem?.starRatingText?.(stars) || (String(stars) + '★');
  }

  function packClothingSalePrice(item) {
    const basePrice = Math.max(0, Math.floor(Number(item?.sellPrice) || 0)); // Star-neutral clothing value authored/stored on the literal Pack item.
    const stars = packClothingQualityStars(item); // Used only while the clothing remains an inventory item.
    if (!basePrice || stars == null) return basePrice;
    const multiplier = Number(window.CookingSystem?.valueMultiplierForStars?.(stars)); // Reuses the game's canonical 1★–5★ economy curve instead of inventing a clothing-only scale.
    return Math.max(1, Math.round(basePrice * (Number.isFinite(multiplier) ? multiplier : 1)));
  }

  function makeClothingGearEntry(item) {
    if (!item) return null;
    const entry = { // Used as the persistent canonical gear record for one clothing article.
      uid: item.uid || 'gcloth_' + Math.random().toString(36).slice(2, 10),
      cosmeticId: item.cosmeticId,
      baseCosmeticId: item.baseCosmeticId || null,
      slot: window.isPortraitMaskCosmeticId?.(item.cosmeticId) ? 'mask' : item.slot,
      label: item.label,
      baseLabel: clothingArticleLabel(item),
      description: item.description || null,
      colorA: item.colorA,
      colorB: item.colorB,
      colorC: item.colorC || null,
      articleDyeIds: Array.isArray(item.articleDyeIds) ? [...item.articleDyeIds] : [],
      sprite: item.sprite || clothingSpriteForCosmetic(item.cosmeticId),
      sellPrice: item.sellPrice || 0,
      valuationQualityStars: clothingValuationQualityStars(item), // Internal valuation metadata only; Gear presentation intentionally has no visible star-quality stat.
      // A loom-crafted article (see ClothingWeavingSystem.craftFromLoom) carries these — preserved here so
      // transferring it from the pack into permanent gear doesn't silently drop its weight/armor math or its
      // woven pattern(s).
      weaveMaterial: item.weaveMaterial || null,
      weightUnits: Number.isFinite(Number(item.weightUnits)) ? Number(item.weightUnits) : null,
      weaving: item.weaving || null,
      furTrimColorName: item.furTrimColorName || null, // Preserve only the named genotype-base fur color when a lined hood moves from Pack to Gear.
      furHood: item.furHood ? JSON.parse(JSON.stringify(item.furHood)) : null, // The exact physical hide survives Pack → Gear and subsequent save/load cycles.
      craftedAt: item.craftedAt || null,
      // Smith-crafted metal clothing carries its own material/use-history state;
      // unlike cloth dyes these fields belong to the literal article.
      materialKind: item.materialKind || null, // Used by MetalArmorSystem so material behavior is item-specific rather than inferred from the clothing slot.
      metalKey: item.metalKey || null,
      temperXp: Number.isFinite(Number(item.temperXp)) ? Number(item.temperXp) : 0,
      smithTreatment: item.smithTreatment || null,
      physicalMassKg: Number.isFinite(Number(item.physicalMassKg)) ? Number(item.physicalMassKg) : null,
      dyeable: item.dyeable === false ? false : undefined,
      exorcised: item.exorcised === true ? true : undefined, // A freed mask stays quiet once it moves into gear.
    };
    window.MetalArmorSystem?.normalizeItem?.(entry);
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

  // A patterned or decorated garment is a physical collectible, not just another dye swatch of its base clothing.
  // Plain dyed copies still intentionally merge and teach the owned garment additional dye colors.
  function hasIndividualClothingPattern(item) {
    if (item?.smithTreatment?.mode === 'pattern' || item?.smithTreatment?.pattern) return true; // Smithy patterns are physical collectibles too, including library-backed snapshots.
    if (item?.furTrimColorName) return true; // Each naturally trimmed garment remains a distinct physical article across Pack → Gear.
    if (item?.furHood) return true; // A crafted hide is always a unique physical garment even with no optional dyed weaving.
    const weaving = item?.weaving; // Reads saved visual state without relying on when the renderer initializes.
    if (!weaving || typeof weaving !== 'object') return false;
    if (weaving.forcedOverpassPattern || weaving.pattern || weaving.patternLibraryId || weaving.trim?.enabled) return true;
    if (Array.isArray(weaving.patterns) && weaving.patterns.some(Boolean)) return true;
    return Object.values(weaving.layers || {}).some(layer =>
      !!(layer?.pattern || layer?.patternLibraryId || (Array.isArray(layer?.patterns) && layer.patterns.some(Boolean))));
  }

  function clothingGearCollectionKey(item) {
    const cosmeticId = item?.cosmeticId; // The original cosmetic type remains the grouping key for unpatterned dyes.
    if (!cosmeticId) return null;
    if (item?.prizeCosmeticId === FIVE_BLOSSOM_CROWN_ID && item?.uid) return 'annual-prize:' + item.uid; // Each year's earned crown must survive clothing save migration independently.
    return hasIndividualClothingPattern(item) && item.uid
      ? 'woven:' + item.uid : 'cosmetic:' + cosmeticId; // Bandit pattern frames are individual collectibles across saves and equip swaps.
  }

  function normalizeGearClothingItems(gearInventory) {
    if (!gearInventory || !Array.isArray(gearInventory.clothingItems)) return false;
    let changed = false; // Used to persist legacy duplicate cleanup only when the save actually changes.
    const sourceItems = gearInventory.clothingItems.filter(Boolean); // Used as the migration input before duplicate articles are collapsed.
    const groupsByCollectionKey = new Map(); // Groups plain dye variants together while preserving individually patterned garments.
    const wornUidByCollectionKey = new Map(); // Keeps each retained article's equipped copy when migrating saves.

    for (const item of sourceItems) {
      if (normalizeFiveBlossomCrownArt(item)) changed = true; // Migrate saved headband placeholders before grouping by cosmetic identity.
      if (migrateGearClothingQuality(item)) changed = true;
      if (window.MetalArmorSystem?.normalizeItem?.(item)) changed = true;
      const articleLabel = clothingArticleLabel(item); // Used to clean stale dye prefixes from legacy baseLabel fields while migrating.
      if (articleLabel && item.baseLabel !== articleLabel) {
        item.baseLabel = articleLabel;
        changed = true;
      }
      if (ensureArticleDyeIds(item)) changed = true;
      const collectionKey = clothingGearCollectionKey(item); // Each woven article has an individual key, plain dye variants share theirs.
      if (!collectionKey) continue;
      if (!groupsByCollectionKey.has(collectionKey)) groupsByCollectionKey.set(collectionKey, []);
      groupsByCollectionKey.get(collectionKey).push(item);
    }
    for (const slot of CLOTHING_SLOTS) {
      const worn = gearInventory.clothing?.[slot]; // Used to choose the visible copy as canonical when an old save has duplicates.
      const collectionKey = clothingGearCollectionKey(worn); // Matches the saved equipped article's physical weave identity.
      if (collectionKey && worn?.uid) wornUidByCollectionKey.set(collectionKey, worn.uid);
    }

    const canonicalByCollectionKey = new Map(); // Maps ordinary duplicates without collapsing patterned pieces.
    for (const [collectionKey, variants] of groupsByCollectionKey) {
      const wornUid = wornUidByCollectionKey.get(collectionKey); // Used to avoid changing the player's currently visible dye during migration.
      const canonical = variants.find(item => item.uid === wornUid) || variants[0]; // Used as the one retained owned-clothing record.
      for (const variant of variants) {
        if (variant === canonical) continue;
        if (mergeArticleDyes(canonical, variant) > 0) changed = true;
      }
      canonicalByCollectionKey.set(collectionKey, canonical);
      if (variants.length > 1) changed = true;
    }

    const normalizedItems = []; // Preserves ordering with one item per collection identity.
    const emittedCollectionKeys = new Set(); // One tile per plain article or individually patterned piece.
    for (const item of sourceItems) {
      const collectionKey = clothingGearCollectionKey(item); // Uses the same key as transfer and collection migration.
      if (!collectionKey) {
        normalizedItems.push(item);
        continue;
      }
      if (emittedCollectionKeys.has(collectionKey)) continue;
      emittedCollectionKeys.add(collectionKey);
      normalizedItems.push(canonicalByCollectionKey.get(collectionKey) || item);
    }
    const listChanged = normalizedItems.length !== gearInventory.clothingItems.length || normalizedItems.some((item, index) => gearInventory.clothingItems[index] !== item); // Used to avoid replacing the array when no migration is needed.
    if (listChanged) {
      gearInventory.clothingItems = normalizedItems;
      changed = true;
    }

    for (const slot of CLOTHING_SLOTS) {
      const worn = gearInventory.clothing?.[slot]; // Used to reconnect equipped slots to their retained canonical clothing record.
      if (!worn?.cosmeticId) continue;
      const canonical = (worn.uid && gearInventory.clothingItems.find(item => item?.uid === worn.uid))
        || canonicalByCollectionKey.get(clothingGearCollectionKey(worn)); // Prefer exact UID when a legacy worn snapshot lacks its article's weaving metadata.
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
    if (slot === 'mask') return ['MASK', 'MASK_B'];
    if (slot === 'pauldron') return ['PAULDRON'];
    if (slot === 'torso') return ['TORSO'];
    if (slot === 'overwear') return ['CLOTH', 'CLOTH_B'];
    if (slot === 'pants') return ['PANTS', 'PANTS_B'];
    return [];
  }

  function applyGearClothingToPlayerData(playerData) {
    const gearInventory = deps.getGearInventory();
    const wornHat = gearInventory?.clothing?.hat; // First avatar rebuild can precede opening Gear; old earned crowns must resolve now.
    if (normalizeFiveBlossomCrownArt(wornHat)) {
      const ownedCrown = gearInventory?.clothingItems?.find(item => wornHat.uid && item?.uid === wornHat.uid); // Saves can deserialize worn and owned snapshots into different objects.
      if (ownedCrown && ownedCrown !== wornHat) normalizeFiveBlossomCrownArt(ownedCrown);
      deps.saveGearInventory?.(); // One migration write, never on subsequent portrait refreshes.
    }
    const shopCatalog = window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [];
    const equippedCosmetics = new Set(Array.isArray(playerData?.equippedCosmetics) ? playerData.equippedCosmetics : []);
    const bodyColors = { ...(playerData?.appearance?.bodyColors || {}) };
    for (const slot of CLOTHING_SLOTS) {
      if (slot === 'hat') {
        equippedCosmetics.delete(FIVE_BLOSSOM_CROWN_ID);
        if (window.canonicalRiverlandKasaId) {
          for (const id of [...equippedCosmetics]) {
            if (window.canonicalRiverlandKasaId(id) !== id) equippedCosmetics.delete(id); // Clear retired hat aliases before the worn item is reapplied.
          }
        }
      } // Quest-only hats aren't in the shop catalog; remove an old equipped crown on hat swaps.
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
      if (!item || isClothingArchived(item)) continue;
      const originalCosmeticId = item.baseCosmeticId || item.cosmeticId; // Loom/smith instances have unique ids; portrait config is keyed by their authored base id.
      const portraitCosmeticId = window.canonicalRiverlandKasaId?.(originalCosmeticId) || originalCosmeticId; // Retain old purchases while using the normal Riverland art resolver.
      if (portraitCosmeticId) equippedCosmetics.add(portraitCosmeticId);
      const [primaryTintKey, secondaryTintKey] = clothingTintKeysForSlot(slot);
      if (primaryTintKey && item.colorA) bodyColors[primaryTintKey] = { ...item.colorA };
      if (secondaryTintKey && item.colorB) bodyColors[secondaryTintKey] = { ...item.colorB };
    }
    const equippedArticles = Object.values(gearInventory?.clothing || {}).filter(item => item && !isClothingArchived(item)); // Used by the generic metal-armor portrait bridge; any slot may contain metal or non-metal clothing.
    const decoratedBodyColors = window.MetalArmorSystem?.decorateBodyColorsWithMetalArmor
      ? window.MetalArmorSystem.decorateBodyColorsWithMetalArmor(bodyColors, equippedArticles)
      : bodyColors;
    return {
      ...playerData,
      equippedCosmetics: [...equippedCosmetics],
      appearance: {
        ...(playerData?.appearance || {}),
        bodyColors: decoratedBodyColors,
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
    if (window.MetalArmorSystem?.applyImageVisual?.(img, sprite, item)) return; // Any smith-forged metal article uses the shared tool verdigris/plating renderer; same-slot non-metal clothing keeps the ordinary dye path.
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

  // Swaps in ClothingWeavingSystem's composited multi-layer icon (base +
  // trim/wrap) once it resolves, replacing whatever renderClothingIcon
  // painted synchronously from the flat clothingSprites lookup (or the
  // emoji fallback when that lookup had nothing at all — see
  // config/scratchbones-config.js's clothingSprites, which only names one
  // file per cosmetic and is missing many articles entirely). Operates on
  // the icon element itself (never its parent) so it can't clobber sibling
  // elements a caller appended next to it (e.g. the owned-clothing name
  // label, or the sizing overrides a caller applies to the returned icon —
  // see buildEquipmentSlots' "Owned Clothing" row). Async because
  // compositing fetches the cosmetic's layer config; token-guarded the same
  // way tintClothingIcon guards its own late recolor.
  function upgradeClothingIconWithComposite(iconEl, item, className, fallbackSprite) {
    const resolveIcon = window.ClothingWeavingSystem?.iconSpriteForCosmetic;
    if (typeof resolveIcon !== 'function' || !iconEl) return;
    const renderToken = Math.random().toString(36).slice(2, 8);
    const compositeIncludesFinalDyes = !!item?.furHood || !!item?.furTrimColorName || !!window.ClothingWeavingSystem?.hasWovenPattern?.(item) || !!window.ClothingWeavingSystem?.isReweavableClothComponent?.(item); // Hybrid icon already contains final cap dye and faceguard finish. // Woven icon sprites already contain per-layer dyes + motif pixels; running the legacy single-color tint afterward would erase the visible weave.
    iconEl.dataset.clothingIconToken = renderToken;
    resolveIcon(item, fallbackSprite).then(sprite => {
      if (!sprite || sprite === fallbackSprite) return;
      if (iconEl.dataset.clothingIconToken !== renderToken || !iconEl.isConnected) return;
      if (iconEl.tagName === 'IMG') {
        delete iconEl.dataset.clothingTintToken; // Invalidates the initial flat-sprite tint before installing the final composite.
        iconEl.src = sprite;
        if (!compositeIncludesFinalDyes) tintClothingIcon(iconEl, sprite, item);
        return;
      }
      // Was the emoji-fallback <span> — morph it into an <img>, carrying over
      // any classes/inline sizing a caller already applied to it.
      const img = document.createElement('img');
      img.className = (iconEl.className || className).replace(/\bies-cloth-fallback\b\s*/, '').trim();
      img.style.cssText = iconEl.style.cssText;
      img.alt = clothingArticleLabel(item);
      img.src = sprite;
      iconEl.replaceWith(img);
      if (!compositeIncludesFinalDyes) tintClothingIcon(img, sprite, item);
    }).catch(() => { /* Keep whichever sprite/fallback already rendered. */ });
  }

  function renderClothingIcon(parent, item, className = 'ies-cloth-sprite') {
    const sprite = item?.sprite || clothingSpriteForCosmetic(item?.cosmeticId);
    let result;
    if (sprite) {
      const img = document.createElement('img');
      img.src = sprite;
      img.className = className;
      img.alt = clothingArticleLabel(item);
      parent.appendChild(img);
      tintClothingIcon(img, sprite, item);
      result = img;
    } else {
      const icon = document.createElement('span');
      icon.className = className + ' ies-cloth-fallback';
      icon.textContent = '👘';
      parent.appendChild(icon);
      result = icon;
    }
    upgradeClothingIconWithComposite(result, item, className, sprite);
    return result;
  }

  function setInventoryDetailClothingIcon(item) {
    const iconEl = document.getElementById('iiIcon');
    if (!iconEl) return;
    iconEl.innerHTML = '';
    renderClothingIcon(iconEl, item, 'ii-cloth-sprite');
  }

  // Every character gets one free pair of Basic Pants, exactly once (new characters and existing saves alike). The flag
  // lives on the gear record so selling or unequipping the pants never grants a second pair.
  function ensureStarterPants(gearInventory) {
    if (gearInventory.starterPantsGranted) return false;
    const catalogEntry = (window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || []).find(entry => entry?.id === 'pants_basic');
    if (!catalogEntry) return false; // Config not loaded yet: try again next time instead of burning the one-time grant.
    gearInventory.starterPantsGranted = true;
    if (gearInventory.clothing?.pants || gearInventory.clothingItems.some(item => item?.cosmeticId === 'pants_basic')) return true;
    // The starter pants match the player's overwear dye (the one picked in character creation, or the worn overwear's colour);
    // with no overwear they are brown.
    const dyeSystem = window.DyeSystem;
    const overwearDye = gearInventory.clothing?.overwear?.colorA || dyeSystem?.toClothingColor?.(dyeSystem.getById?.(window.__hobunjiPlayerProfile?.appliedDyes?.CLOTH)) || null;
    const brown = dyeSystem?.toClothingColor?.(dyeSystem.getById?.('dye:CLOTH:brown'));
    const colorA = overwearDye ? { ...overwearDye } : brown || { h: -113, s: -0.45, v: -0.45, label: 'Brown' };
    const entry = makeClothingGearEntry({ cosmeticId: 'pants_basic', slot: 'pants', label: `${colorA.label} ${catalogEntry.label}`, baseLabel: catalogEntry.label, description: catalogEntry.description, colorA, colorB: null });
    gearInventory.clothing.pants = entry;
    gearInventory.clothingItems.push(entry);
    return true;
  }

  function ensureGearClothingCollection() {
    const gearInventory = deps.getGearInventory();
    if (!gearInventory) return false;
    let changed = false; // Used to make legacy clothing migration save itself exactly when needed.
    if (!gearInventory.clothing) {
      gearInventory.clothing = { hat: null, hood: null, mask: null, pauldron: null, torso: null, overwear: null, pants: null };
      changed = true;
    }
    if (!Array.isArray(gearInventory.clothingItems)) {
      gearInventory.clothingItems = [];
      changed = true;
    }
    const isMask = item => window.isPortraitMaskCosmeticId?.(item?.cosmeticId);
    for (const item of gearInventory.clothingItems) if (isMask(item) && item.slot !== 'mask') {item.slot='mask';changed=true;}
    if (isMask(gearInventory.clothing.hood)) {
      const mask = gearInventory.clothing.hood;
      mask.slot='mask';
      if (!gearInventory.clothing.mask) gearInventory.clothing.mask=mask;
      else if (!gearInventory.clothingItems.some(item=>item.uid===mask.uid)) gearInventory.clothingItems.push(mask);
      gearInventory.clothing.hood=null;
      changed=true;
    }
    if (ensureStarterPants(gearInventory)) changed = true;
    for (const slot of CLOTHING_SLOTS) {
      const worn = gearInventory.clothing[slot];
      if (!worn) continue;
      if (normalizeFiveBlossomCrownArt(worn)) changed = true; // Worn-only legacy crown saves also need the actual crown cosmetic.
      if (migrateGearClothingQuality(worn)) changed = true;
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
        if (window.MetalArmorSystem?.normalizeItem?.(worn)) changed = true;
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

  function cursedMessage(item) {
    if (item?.cursed?.dispelBy === 'garanki') return 'Cursed: it cannot be worn until Garanki Gabu dispels the curse.';
    if (item?.cursed?.kind === 'mask') return 'Cursed: someone’s soul is bound inside this mask. It cannot be worn until a priest frees it; a mage cannot.';
    return 'Cursed: it cannot be worn until the curse is lifted.';
  }
  // Single owner of lifting a curse (Garanki's circlet dispel today, Father Hunundi's exorcism of masks later). A freed mask is flagged
  // `exorcised`, which silences its glowing eyes for whoever wears it; a dispelled circlet carries nothing that could emit fire (lich flames
  // come only from the lich's own hidden headband).
  function dispelCurse(item) {
    if (!item?.cursed) return false;
    const kind = item.cursed.kind;
    item.label = item.cursed.originalLabel || item.label;
    delete item.cursed;
    if (kind === 'mask') item.exorcised = true;
    return true;
  }

  // Grant a physical quest/NPC garment through the Pack collection used by
  // treasure, merchants, and Gear transfer; cosmetic: keys are editor metadata.
  function grantPackClothing(article) {
    const pack = deps?.getPackClothing?.(); // One authoritative world-scoped clothing list.
    const cosmeticId = typeof article?.cosmeticId === 'string' ? article.cosmeticId.trim() : '';
    const slot = typeof article?.slot === 'string' ? article.slot.trim() : '';
    if (!Array.isArray(pack) || !cosmeticId || !CLOTHING_SLOTS.includes(slot)) return null;
    const uid = String(article.uid || ('citem_reward_' + Date.now().toString(36)
      + '_' + Math.random().toString(36).slice(2, 10))); // Stable instance identity for persistence.
    if (pack.some(item => item?.uid === uid)) return null; // Reentrant grants cannot duplicate a UID.
    const item = { ...article, uid, cosmeticId, slot,
      label: String(article.label || cosmeticId),
      baseLabel: String(article.baseLabel || article.label || cosmeticId),
      sprite: article.sprite || clothingSpriteForCosmetic(cosmeticId) };
    pack.push(item);
    deps.saveMemberWorldData?.();
    deps.buildInventoryGrid?.();
    return item;
  }

  function transferClothingToGear(uid) {
    const packClothing = deps.getPackClothing();
    const idx = packClothing.findIndex(c => c.uid === uid);
    if (idx < 0) return;
    if (packClothing[idx]?.cursed) { deps.showToast(cursedMessage(packClothing[idx]), false); return; } // A cursed article never reaches gear, so it can never be equipped.
    const item = makeClothingGearEntry(packClothing[idx]);
    ensureGearClothingCollection();
    const gearInventory = deps.getGearInventory();
    const collectionKey = clothingGearCollectionKey(item); // Distinguishes woven loot from plain garments with the same authored cosmetic.
    const existingItem = collectionKey ? gearInventory.clothingItems.find(c => clothingGearCollectionKey(c) === collectionKey) : null; // Plain dye variants still merge into one owned article.
    let equippedItem = item; // Used so duplicate transfers equip the retained canonical article rather than a second copy.
    let learnedDyeCount = 0; // Used to tell the player whether the duplicate taught this article any new shades.
    if (existingItem) {
      learnedDyeCount = mergeArticleDyes(existingItem, item);
      equippedItem = existingItem;
    } else {
      gearInventory.clothingItems.push(item);
    }
    delete equippedItem.archived; // Explicit Pack-to-Gear transfer makes an already collected archived article available again.
    gearInventory.clothing[equippedItem.slot] = equippedItem;
    packClothing.splice(idx, 1);
    if (deps.getManualHeldItem?.()?.kind === 'clothing' && deps.getManualHeldItem().uid === uid) deps.setManualHeldItem?.(null);
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
    if (!def || !deps.getGearInventory()?.tools?.[key]) return;
    const archived = isToolArchived(key); // The same detail panel manages available and long-term stored tools.
    deps.clearInvSelection();
    const emptyEl  = document.getElementById('iiEmpty');
    const detailEl = document.getElementById('iiDetail');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (detailEl) { detailEl.style.display = ''; detailEl.dataset.gearToolKey = key; } // Canonical selected tool survives duplicate visible labels in the mastery panel.
    const set = (id, val) => { const el = document.getElementById(id); if (el) el[typeof val === 'string' ? 'textContent' : 'innerHTML'] = val; };
    set('iiIcon',  def.icon);
    const iiIconEl2 = document.getElementById('iiIcon');
    if (iiIconEl2) { iiIconEl2.style.backgroundImage = ''; iiIconEl2.classList.remove('sprited-icon'); }
    set('iiName',  def.label + ' — Mastery ' + deps.toolMasteryLevel(key) + '/5 (Gear' + (archived ? ' Storage' : '') + ')');
    set('iiPrice', 'Permanent — not sellable');
    set('iiTags',  '');
    set('iiDesc',  archived ? 'Stowed for long-term storage. Take it out to assign it; mastery and ownership are preserved.' : 'This tool is in your gear inventory. Assign it to an equipment slot to use it.');
    const actEl = document.getElementById('iiActions');
    if (actEl) {
      actEl.innerHTML = '';
      const mkBtn = (label, cls, fn) => {
        const b = document.createElement('button'); b.className = 'ii-btn' + (cls ? ' ' + cls : ''); b.textContent = label; b.onclick = fn; actEl.appendChild(b);
      };
      for (const slot of (archived ? [] : def.slots)) {
        const isAssigned = deps.equipmentSlots[slot] === key;
        mkBtn(isAssigned ? 'Unassign from ' + slot : 'Assign as ' + slot, 'equip', () => {
          if (isAssigned) unequipItem(slot); else equipItem(key, slot);
          buildEquipmentSlots(); selectGearTool(key);
        });
      }
      mkBtn(archived ? 'Take Out of Storage' : 'Stow Tool', 'equip', () => setToolArchived(key, !archived));
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
      .filter(k => gearInventory.tools[k] && !isToolArchived(k, gearInventory) && deps.TOOL_ITEM_DEFS[k]?.slots.includes(slot));
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
    }
  }

  function selectPackClothingItem(uid, previewOnly = false, individual = false) {
    const packClothing = deps.getPackClothing();
    const item = packClothing.find(c => c.uid === uid);
    if (!item) return;
    const displayGroup = individual ? null : groupClothingForDisplay(packClothing).find(group => group.uids.includes(uid)); // Detail quantity reflects the same stack selected in the grid.
    const stackCount = individual ? 1 : displayGroup?.count || 1; // Used for quantity labeling without changing single-item action targets.
    const starText = packClothingStarText(item); // Used to keep quality visible while this garment is still a Pack/inventory item.
    const salePrice = packClothingSalePrice(item); // Used by both the displayed value and the actual sale transaction.
    if (!previewOnly) deps.clearInvSelection(); // Controller highlight inspects clothing without clearing the active selected stack.
    const emptyEl  = document.getElementById('iiEmpty');
    const detailEl = document.getElementById('iiDetail');
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (detailEl) detailEl.style.display  = '';
    const set = (id, val) => { const el = document.getElementById(id); if (el) el[typeof val === 'string' ? 'textContent' : 'innerHTML'] = val; };
    if (detailEl) { delete detailEl.dataset.itemKey; detailEl.dataset.itemKind = 'clothing'; } // Clothing previews never inherit bag-item actions.
    setInventoryDetailClothingIcon(item);
    set('iiQuality', starText || '');
    set('iiName',  (starText ? starText + ' ' : '') + item.label + (stackCount > 1 ? ' ×' + stackCount : ''));
    set('iiPrice', salePrice ? salePrice + 'g' : '');
    set('iiTags',  starText ? ('Quality ' + starText) : '');
    set('iiDesc',  [item.description, stackCount > 1 ? 'Stack of ' + stackCount + ' identical articles. Actions affect one piece at a time.' : '', item.cursed ? cursedMessage(item) : 'Transfer to gear to wear it (permanent). Can sell while in pack.'].filter(Boolean).join(' '));
    const actEl = document.getElementById('iiActions');
    if (actEl) {
      actEl.innerHTML = '';
      const mkBtn = (label, cls, fn) => {
        const b = document.createElement('button'); b.className = 'ii-btn' + (cls ? ' ' + cls : ''); b.textContent = label; b.onclick = fn; actEl.appendChild(b);
      };
      if (item.cursed) {
        mkBtn('Cursed — cannot be worn', 'secondary', () => deps.showToast(cursedMessage(item), false));
        actEl.lastChild.disabled = true;
      } else {
        mkBtn('Transfer to Gear (permanent)', 'equip', () => transferClothingToGear(uid));
        const spouseWardrobe = window.NpcWardrobe?.getActiveSpouseWardrobeTarget?.(); // Only a currently open, assigned spouse wardrobe exposes this direct Pack action.
        if (spouseWardrobe) mkBtn(`Move to ${spouseWardrobe.name}'s Wardrobe`, 'equip', () => transferPackClothingToNpcWardrobe(spouseWardrobe.npcId, uid));
      }
      if (salePrice > 0) {
        mkBtn('Sell (' + salePrice + 'g)', 'sell', () => {
          const owned = deps.getPackClothing(); // Read the current saved articles, not a stale detail-panel snapshot.
          const saleIndex = owned.findIndex(c => c?.uid === uid); // A sale removes one physical garment even in an unmigrated duplicate-ID save.
          if (saleIndex < 0) return;
          const remaining = owned.slice(); // Preserve the pack's setter contract while keeping all other articles.
          remaining.splice(saleIndex, 1);
          deps.setPackClothing(remaining);
          if (deps.getManualHeldItem?.()?.kind === 'clothing' && deps.getManualHeldItem().uid === uid) {
            deps.setManualHeldItem?.(null); // Never leave the handheld/gift target pointing at a garment just sold.
          }
          deps.inventory.gold = (deps.inventory.gold || 0) + salePrice;
          deps.showToast('Sold ' + item.label + ' for ' + salePrice + 'g', true);
          buildPackClothingSection(); deps.buildInventoryGrid(); deps.clearInventoryDetail();
          deps.saveMemberWorldData();
        });
      }
      // Giftable straight from the pack too — see getHeldGiftItem in
      // game.js, which resolves only clothing still in the pack.
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
    if (item.cursed) { deps.showToast(cursedMessage(item), false); return; } // Defends old saves or other routes that put a cursed piece in gear.
    if (isClothingArchived(item)) { deps.showToast('Take this garment out of Gear storage before equipping it.', false); return; }
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
    set('iiPrice', 'Permanent gear — cannot sell or give away');
    set('iiTags',  '');
    const gearInventory = deps.getGearInventory();
    const isWorn = gearInventory?.clothing?.[slot]?.uid === item.uid;
    const metalArmorDetail = window.MetalArmorSystem?.detailText?.(item) || ''; // Mobile-visible material/Temper/weight diagnostics for any smith-crafted metal clothing.
    const weaveDetail = hasIndividualClothingPattern(item) ? 'Patterned garment — its unique woven design is saved with this article.' : ''; // Mobile-visible confirmation for inspected bandit loot.
    set('iiDesc',  [item.description, metalArmorDetail, weaveDetail, isClothingArchived(item) ? 'Stowed for long-term storage; take it out to wear or redye it.' : isWorn ? 'Currently worn. Select another collected piece below to swap.' : 'Collected clothing in gear. Equip it to wear it.'].filter(Boolean).join(' '));
    const actEl = document.getElementById('iiActions');
    if (actEl) {
      actEl.innerHTML = '';
      if (isClothingArchived(item)) {
        const takeOutBtn = document.createElement('button'); // Archived clothing cannot be accidentally equipped through its detail panel.
        takeOutBtn.className = 'ii-btn equip';
        takeOutBtn.textContent = 'Take Out of Storage';
        takeOutBtn.onclick = () => setClothingArchived(item.uid, false);
        actEl.appendChild(takeOutBtn);
      } else if (!isWorn) {
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
      const canRedye = item?.dyeable !== false && !window.MetalArmorSystem?.isMetalArmor?.(item); // Dyeability follows the literal item; the slot itself can still contain ordinary dyeable clothing.
      if (canRedye && !isClothingArchived(item)) {
        const redyeBtn = document.createElement('button');
        redyeBtn.className = 'ii-btn redye';
        redyeBtn.textContent = '🎨 Redye';
        redyeBtn.onclick = () => openRedyePanel(slot, item);
        actEl.appendChild(redyeBtn);
      }
      if (!isClothingArchived(item)) {
        const stowBtn = document.createElement('button'); // One-click indefinite storage even for presently worn clothing.
        stowBtn.className = 'ii-btn';
        stowBtn.textContent = 'Stow Clothing';
        stowBtn.onclick = () => setClothingArchived(item.uid, true);
        actEl.appendChild(stowBtn);
      }
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

  async function openRedyePanel(slot, item) {
    if (item?.dyeable === false || window.MetalArmorSystem?.isMetalArmor?.(item)) {
      deps.showToast?.('Smith-forged metal clothing takes the color of its metal and cannot be dyed.', false);
      return;
    }
    window.DyeSystem.ensureCollection();
    ensureArticleDyeIds(item);
    const weaving = window.ClothingWeavingSystem;
    if (await weaving?.hasPixelDyeForItem?.(item)) {
      return weaving.openExtendedRedyePanel(item); // Reuse the existing persisted colorC dye editor.
    }
    const panel = document.getElementById('dyePanel');
    const titleEl = document.getElementById('dyePanelTitle');
    const subslotsEl = document.getElementById('dyePanelSubslots');
    const groupsEl = document.getElementById('dyePanelGroups');
    const previewEl = document.getElementById('dyePanelPreview');
    if (!panel || !titleEl || !subslotsEl || !groupsEl || !previewEl) return;

    const gearInventory = deps.getGearInventory();
    const tintKeys = clothingTintKeysForSlot(slot); // Fallback preserves legacy slot behavior if cosmetic palette metadata is temporarily unavailable.
    const secondaryResolver = window.ClothingWeavingSystem?.hasSecondaryDyeForItem; // Shared palette-aware resolver prevents one-color hoods from exposing a fake Trim channel.
    let hasSecondary = tintKeys.length > 1; // Used by the dye controls and label builder after the optional cosmetic-specific lookup below.
    if (typeof secondaryResolver === 'function') {
      try { hasSecondary = await secondaryResolver(item); } catch (_) { /* Keep the slot fallback if cosmetic metadata cannot be loaded. */ }
    }
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
    if (ensureUniquePackClothingUids(packClothing)) deps.saveMemberWorldData?.(); // One-time save migration prevents one sale from deleting same-UID copies.
    packClothingRevision++; // Existing hidden source is retained for compatibility; visible rendering uses the individual record list.
    if (window.InventoryUI?.usesClothingNests) {
      if (sec.innerHTML) sec.innerHTML = ''; // Modern grid renders directly from records, including when the last article is removed.
      window.InventoryUI.refreshPackClothing?.();
      return;
    }
    if (!packClothing.length) {
      sec.innerHTML = '<div class="inv-pcloth-empty">No clothing in pack.</div>';
      return;
    }
    sec.innerHTML = '';
    for (const group of groupClothingForDisplay(packClothing)) {
      const item = group.item; // One tile per identical group; the backing inventory still contains every article.
      const btn = document.createElement('button');
      btn.className = 'inv-pcloth-item';
      btn.setAttribute('data-ctrl-detail', 'invInfo');
      btn.setAttribute('data-key', item.uid);
      renderClothingIcon(btn, item, 'ipc-sprite');
      const name = document.createElement('span');
      name.className = 'ipc-name';
      const starText = packClothingStarText(item); // Used to expose woven quality directly in the Pack clothing list.
      name.textContent = starText ? (starText + ' ' + item.label) : item.label;
      btn.appendChild(name);
      if (group.count > 1) {
        const badge = document.createElement('span'); // Cloned by InventoryUI into the visible Pack grid tile.
        badge.className = 'iib-count ipc-stack-count';
        badge.textContent = '×' + group.count;
        badge.style.top = '3px'; // Avoid overlapping the grid's bottom-aligned CLOTHING category caption.
        badge.style.bottom = 'auto';
        btn.appendChild(badge);
      }
      btn.addEventListener('click', () => selectPackClothingItem(item.uid));
      sec.appendChild(btn);
    }
  }

  // Build the equipment slots panel inside #invEquipSection
  function buildEquipmentSlots() {
    const sec = document.getElementById('invEquipSection'); // Rendering must never grant gear or write a save; migration happens at character load.
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
    const TOOL_SLOTS = ['hoe', 'shovel', 'axe', 'pick', 'harpoon', 'weapon', 'ranged', 'instrument']; // Instrument uses the permanent gear collection and saved slot assignments.
    for (const slot of TOOL_SLOTS) {
      const itemKey = deps.equipmentSlots[slot];
      const def = itemKey && !isToolArchived(itemKey, gearInventory) ? deps.TOOL_ITEM_DEFS[itemKey] : null;
      const cell = document.createElement('div');
      cell.className = 'inv-equip-slot' + (activeTool === slot ? ' active-slot' : '') + (def ? ' occupied' : '');
      cell.setAttribute('title', slot + (def ? ': ' + def.label : ' (empty)'));
      cell.setAttribute('role', 'button');
      cell.setAttribute('data-ctrl-detail', 'invInfo');
      cell.tabIndex = 0;
      cell.setAttribute('data-key', slot); // Restores the same tool slot after its card rebuilds.
      if (def) {
        renderToolIcon(cell, def);
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
      cell.addEventListener('click', () => { if (slot !== 'instrument') deps.setActiveTool(slot); buildEquipmentSlots(); selectEquipSlot(slot); });
      toolRow.appendChild(cell);
    }
    sec.appendChild(toolRow);

    // ── Owned Tools (gear inventory) ──────────────────────
    const ownedHdr = document.createElement('div');
    ownedHdr.className = 'inv-equip-label';
    ownedHdr.textContent = 'Owned Tools';
    sec.appendChild(ownedHdr);

    const allGearTools = Object.keys(gearInventory?.tools || {}).filter(k => gearInventory.tools[k] && deps.TOOL_ITEM_DEFS[k]); // Existing owned flags remain authoritative for both drawers.
    const gearTools = allGearTools.filter(key => !isToolArchived(key, gearInventory)); // Available tools alone appear in ordinary Gear assignment UI.
    const archivedGearTools = allGearTools.filter(key => isToolArchived(key, gearInventory)); // Stowed tools retain individual mastery and ownership.

    const renderOwnedToolRow = (keys, archived) => {
      const gearRow = document.createElement('div'); // Reused by the available and archived tool lists.
      gearRow.className = 'inv-equip-row';
      for (const key of keys) {
        const def = deps.TOOL_ITEM_DEFS[key];
        const cell = document.createElement('div');
        cell.className = 'inv-equip-slot gear-archiveable-cell';
        cell.setAttribute('title', def.label + ' (Mastery ' + deps.toolMasteryLevel(key) + '/5)' + (archived ? ' — stored' : ' — click to assign'));
        cell.setAttribute('role', 'button');
        cell.setAttribute('data-ctrl-detail', 'invInfo');
        cell.tabIndex = 0;
        cell.setAttribute('data-item-key', key);
        renderToolIcon(cell, def);
        const lbl = document.createElement('span');
        lbl.className = 'ies-label';
        lbl.textContent = def.label.split(' ')[0] + ' Lv' + deps.toolMasteryLevel(key);
        cell.appendChild(lbl);
        const stowBtn = document.createElement('button'); // Direct mobile/controller storage action in addition to item details.
        stowBtn.className = 'settings-small-btn gear-archive-action';
        stowBtn.textContent = archived ? 'Take Out' : 'Stow';
        stowBtn.addEventListener('click', event => { event.stopPropagation(); setToolArchived(key, !archived); });
        cell.appendChild(stowBtn);
        cell.addEventListener('click', () => selectGearTool(key));
        gearRow.appendChild(cell);
      }
      return gearRow;
    };
    if (gearTools.length) sec.appendChild(renderOwnedToolRow(gearTools, false));
    else {
      const empty = document.createElement('div');
      empty.className = 'inv-equip-empty';
      empty.textContent = 'No available tools in gear.';
      sec.appendChild(empty);
    }
    if (archivedGearTools.length) {
      const archiveSection = document.createElement('div'); // InventoryUI moves this whole drawer into the Owned Tools group.
      archiveSection.className = 'gear-archive-section gear-tools-archive';
      appendArchiveToggle(archiveSection, 'Stowed Tools', archivedGearTools.length, archivedToolsCollapsed, () => {
        archivedToolsCollapsed = !archivedToolsCollapsed;
        buildEquipmentSlots();
      });
      if (!archivedToolsCollapsed) archiveSection.appendChild(renderOwnedToolRow(archivedGearTools, true));
      sec.appendChild(archiveSection);
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
      const selected = gearInventory?.clothing?.[slot]; // A stored article is never shown as equipped, including older saved snapshots.
      const item = isClothingArchived(selected) ? null : selected;
      const cell = document.createElement('div');
      cell.className = 'inv-equip-slot clothing-slot' + (item ? ' occupied' : '');
      cell.dataset.clothingSlot = slot; // ClothingWeavingSystem maps worn cells back to items by slot.
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
      if (item) {
        cell.setAttribute('role', 'button');
        cell.setAttribute('data-ctrl-detail', 'invInfo');
        cell.tabIndex = 0;
        cell.setAttribute('data-key', item.uid);
      }
      clothRow.appendChild(cell);
    }
    sec.appendChild(clothRow);

    const ownedClothing = (gearInventory?.clothingItems || []).filter(item => item && !isClothingArchived(item)); // Only available garments appear in ordinary Gear.
    const archivedClothing = (gearInventory?.clothingItems || []).filter(isClothingArchived); // Individual physical garments retain all crafting and dye metadata.
    const ownedClothHdr = document.createElement('div');
    ownedClothHdr.className = 'inv-equip-label';
    ownedClothHdr.textContent = 'Owned Clothing';
    sec.appendChild(ownedClothHdr);
    const renderOwnedClothingRow = (items, archived) => {
      const ownedClothRow = document.createElement('div'); // Shared renderer preserves thumbnails, dyes and labels in both lists.
      ownedClothRow.className = 'inv-equip-row inv-owned-clothing-row';
      const renderLeaf = item => {
        const worn = !archived && gearInventory?.clothing?.[item.slot]?.uid === item.uid;
        const articleLabel = clothingArticleLabel(item);
        const cell = document.createElement('div');
        cell.className = 'inv-equip-slot clothing-owned-slot gear-archiveable-cell occupied' + (worn ? ' active-slot' : '');
        cell.setAttribute('title', articleLabel + (archived ? ' — stored' : worn ? ' — currently worn' : ' — click to equip'));
        cell.setAttribute('role', 'button');
        cell.setAttribute('data-ctrl-detail', 'invInfo');
        cell.tabIndex = 0;
        cell.setAttribute('data-key', item.uid);
        const ownedIcon = renderClothingIcon(cell, item);
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
        const stowBtn = document.createElement('button'); // A single click archives or restores one specific garment.
        stowBtn.className = 'settings-small-btn gear-archive-action';
        stowBtn.textContent = archived ? 'Take Out' : 'Stow';
        stowBtn.addEventListener('click', event => { event.stopPropagation(); setClothingArchived(item.uid, !archived); });
        cell.appendChild(stowBtn);
        cell.addEventListener('click', () => selectGearClothing(item.slot, item));
        return cell;
      };
      for (const nest of buildClothingNameNests(items, archived ? 'stowed-gear' : 'gear', renderLeaf, true)) ownedClothRow.appendChild(nest);
      return ownedClothRow;
    };
    if (ownedClothing.length) sec.appendChild(renderOwnedClothingRow(ownedClothing, false));
    else {
      const empty = document.createElement('div');
      empty.className = 'inv-equip-empty';
      empty.textContent = 'No available clothing in gear.';
      sec.appendChild(empty);
    }
    if (archivedClothing.length) {
      const archiveSection = document.createElement('div'); // Owns all garments kept away from the regular worn/available collection.
      archiveSection.className = 'gear-archive-section gear-clothing-archive';
      appendArchiveToggle(archiveSection, 'Stowed Clothing', archivedClothing.length, archivedClothingCollapsed, () => {
        archivedClothingCollapsed = !archivedClothingCollapsed;
        buildEquipmentSlots();
      });
      if (!archivedClothingCollapsed) archiveSection.appendChild(renderOwnedClothingRow(archivedClothing, true));
      sec.appendChild(archiveSection);
    }
    window.WhistleEquip.build();
    window.TrinketSystem?.renderEquipmentSection?.(sec); // Attunement-budget trinkets (js/trinket-system.js).
  }

  function getPackClothingForWardrobe() {
    return (deps?.getPackClothing?.() || []).filter(Boolean).map(item => ({
      uid: item.uid, label: item.label || item.cosmeticId || 'Clothing', cursed: !!item.cursed,
    })); // Only the small display fields cross into the wardrobe panel; the inventory remains owned here.
  }

  function transferPackClothingToNpcWardrobe(npcId, uid) {
    const target = window.NpcWardrobe?.getActiveSpouseWardrobeTarget?.();
    if (!target || target.npcId !== npcId) return false;
    const pack = deps?.getPackClothing?.();
    const index = pack?.findIndex(item => item?.uid === uid) ?? -1;
    const item = index >= 0 ? pack[index] : null;
    if (!item || item.cursed || !window.NpcWardrobe?.storePackItem?.(npcId, item)) return false;
    pack.splice(index, 1);
    if (deps.getManualHeldItem?.()?.kind === 'clothing' && deps.getManualHeldItem().uid === uid) deps.setManualHeldItem?.(null);
    deps.saveMemberWorldData?.(); // One save commits the Pack removal and spouse wardrobe addition together.
    deps.showToast?.(`${item.label || 'Clothing'} moved to ${target.name}'s Wardrobe.`, true);
    buildPackClothingSection(); deps.buildInventoryGrid?.(); deps.clearInventoryDetail?.();
    window.NpcWardrobe?.refreshOpenPanel?.();
    return true;
  }

  function ownsCachedToolRoot(root) {
    // EquipmentPanel holds the real tool mesh map, including holstered roots.
    // Combat/hand dependencies may intentionally expose only the current holder,
    // so assembly diagnostics consult this owner without making slot maps determine lifetime.
    const map = deps?.toolMeshMap; // Source of truth for cached player equipment, exposed to assembly diagnostics.
    if (!root || !map) return false;
    const values = typeof map.values === 'function' ? map.values() : Object.values(map);
    for (const visual of values) if (visual === root) return true;
    return false;
  }

  // Read-only bridge for the Loadout's 3D viewport. The equipment panel
  // already owns the complete map, including meshes that are currently holstered.
  function getEquippedWeaponPreviewPlane(itemKey) {
    const mesh = deps?.toolMeshMap?.weapon; // Same cached weapon mesh used by the real player, even when another slot is active.
    return mesh?.userData?.itemKey === itemKey ? mesh.userData.toolPlane || null : null;
  }

  const FIVE_BLOSSOM_CROWN_ID = 'appearance::hat::five_blossom_crown'; // Non-shop quest cosmetic distinct from any purchased headband.
  const FIVE_BLOSSOM_CROWN_ART = Object.freeze({
    defaultMale:'assets/cosmetics/clothes/hat/flowercrown_m.png',
    defaultFemale:'assets/cosmetics/clothes/hat/flowercrown_f.png',
    kenkari:'assets/cosmetics/clothes/hat/kenk_flowercrown_m.png',
    mashtzarr:'assets/cosmetics/clothes/hat/mashtz_flowercrown_m.png',
    tletingan:'assets/cosmetics/clothes/hat/tl_flowercrown_m.png'
  }); // Canonical authored assets; config/cosmetics/five_blossom_crown.json chooses the appropriate head shape.
  function normalizeFiveBlossomCrownArt(item) {
    if (!item || (item.prizeCosmeticId !== FIVE_BLOSSOM_CROWN_ID && item.cosmeticId !== FIVE_BLOSSOM_CROWN_ID)) return false;
    let changed = false; // Persist migration only when an older saved crown still points to headband/unfinished art.
    for (const [key,value] of [['cosmeticId',FIVE_BLOSSOM_CROWN_ID],['baseCosmeticId',FIVE_BLOSSOM_CROWN_ID],
      ['slot','hat'],['sprite',FIVE_BLOSSOM_CROWN_ART.defaultMale],['dyeable',false]]) {
      if (item[key] !== value) { item[key] = value; changed = true; }
    }
    for (const oldKey of ['artCandidates','fallbackSprite']) {
      if (Object.prototype.hasOwnProperty.call(item,oldKey)) {
        delete item[oldKey]; // These obsolete paths never drove portrait rendering and needn't bloat saved rewards.
        changed = true;
      }
    }
    return changed;
  }
  function beginFiveBlossomCrowning() {
    const gear = deps?.getGearInventory?.();
    if (!gear) return null;
    gear.clothing ||= {};
    gear.clothingItems ||= [];
    let oldHat = gear.clothing.hat || null;
    const oldHood = gear.clothing.hood || null;
    if (oldHat && !gear.clothingItems.some(item => item === oldHat || (oldHat.uid && item?.uid === oldHat.uid))) {
      oldHat = oldHat.uid ? oldHat : makeClothingGearEntry({...oldHat,slot:'hat'});
      if (oldHat) gear.clothingItems.push(oldHat); // Even legacy worn-only hats remain owned when the crown replaces them.
    }
    const facewrap = /(?:^|::|_)facewrap(?:$|_)/i.test(String(oldHood?.baseCosmeticId || oldHood?.cosmeticId || ''));
    gear.clothing.hat = null; // Cosmetic visibility only; the old physical hat remains in the character's gear collection.
    if (!facewrap) gear.clothing.hood = null; // A facewrap is part of the character's face and stays on.
    deps.refreshPlayerAvatar?.();
    return {gear,oldHat,oldHood,facewrap,crowned:false}; // The ceremony completes this transient outfit transaction or rolls it back.
  }
  function ownsFiveBlossomCrown(civilYear) {
    const owned = deps?.getGearInventory?.()?.clothingItems || []; // The persisted Gear collection determines whether a failed quest-save retry needs to replay the stage scene.
    return Number.isSafeInteger(Number(civilYear)) && owned.some(item =>
      item?.prizeCosmeticId === FIVE_BLOSSOM_CROWN_ID && item?.awardYear === Number(civilYear));
  }
  function awardFiveBlossomCrown(civilYear, ceremony = null) {
    const gear = deps?.getGearInventory?.();
    if (!gear || !Number.isSafeInteger(Number(civilYear))) return null;
    gear.clothing ||= {}; gear.clothingItems ||= [];
    const oldHat = gear.clothing.hat; // Quiet awards also replace a hat, so protect legacy worn-only clothing just as the stage ceremony does.
    if (oldHat && !gear.clothingItems.some(item => item === oldHat || (oldHat.uid && item?.uid === oldHat.uid))) {
      const savedHat = oldHat.uid ? oldHat : makeClothingGearEntry({...oldHat,slot:'hat'}); // Preserve a stable physical garment before the replacement occurs.
      if (savedHat) gear.clothingItems.push(savedHat);
    }
    const uid = 'five_blossom_crown:' + String(civilYear); // Stable per-character/per-year award identity prevents duplicate gear on retries.
    let item = gear.clothingItems.find(entry => entry?.uid === uid || (entry?.prizeCosmeticId === FIVE_BLOSSOM_CROWN_ID && entry?.awardYear === Number(civilYear)));
    if (!item) {
      item = {
        uid,slot:'hat',cosmeticId:FIVE_BLOSSOM_CROWN_ID,baseCosmeticId:FIVE_BLOSSOM_CROWN_ID,
        prizeCosmeticId:FIVE_BLOSSOM_CROWN_ID,awardYear:Number(civilYear),label:'Five Blossom Crown',
        description:'The crown bestowed by Father Hunundi upon a Finder of the Five Blossoms.',
        sprite:FIVE_BLOSSOM_CROWN_ART.defaultMale,dyeable:false,sellPrice:0
      }; // The portrait and species-aware Gear icon resolve the five authored variants from the crown's cosmetic config.
      gear.clothingItems.push(item);
    }
    normalizeFiveBlossomCrownArt(item); // A resumed/previously saved award must use the new crown sprites too.
    gear.clothing.hat = item; // Instant on-stage replacement; the previous hat remains owned in the wardrobe.
    if (ceremony) ceremony.crowned = true;
    else deps.saveGearInventory?.(); // During the ceremony, finishFiveBlossomCrowning first restores the temporarily hidden hood before saving.
    deps.refreshPlayerAvatar?.();
    if (typeof document !== 'undefined') buildEquipmentSlots();
    return item;
  }
  function finishFiveBlossomCrowning(ceremony, crowned = false) {
    if (!ceremony?.gear) return;
    if (!crowned && !ceremony.crowned) ceremony.gear.clothing.hat = ceremony.oldHat; // Failed/skipped scenes cannot steal the original hat.
    if (!ceremony.facewrap) ceremony.gear.clothing.hood = ceremony.oldHood; // Original non-facewrap hood returns after the announcement.
    deps.refreshPlayerAvatar?.();
    if (crowned || ceremony.crowned) deps.saveGearInventory?.(); // Persist the crown and normal hood once, never a temporary bare-headed wardrobe.
    if (typeof document !== 'undefined') buildEquipmentSlots();
  }

  window.EquipmentPanel = {
    init,
    ensureStarterFlute,
    dispelCurse,
    getEquippedWeaponPreviewPlane,
    ownsCachedToolRoot, // Read-only equipment ownership visibility for assembly diagnostics, not a disposal guard.
    refreshPlayerAvatar: () => deps?.refreshPlayerAvatar?.(), // Dev Companion uses the game's existing complete in-place portrait/rig rebuild.
    devWornClothing: () => deps?.getGearInventory?.()?.clothing || null, // Appearance inspector edits only visual fields on the actual currently equipped gear objects.
    squareToolIcon,
    getIconDebug: () => ({ ...toolIconDebug, cached: toolIconFrames.size }),
    setEquipmentSlot,
    equipItem,
    unequipItem,
    transferToolToGear,
    isToolArchived, // Read-only hook for other gear/loadout views to respect long-term storage.
    isClothingArchived,
    setToolArchived,
    setClothingArchived,
    reconcileArchivedGear,
    getArchiveDebug: () => { // Mobile-visible state for the saved character without devtools.
      const gear = deps?.getGearInventory?.() || {};
      const tools = Object.keys(gear.tools || {}).filter(key => gear.tools[key] && deps?.TOOL_ITEM_DEFS?.[key]);
      const clothing = (gear.clothingItems || []).filter(Boolean);
      return { availableTools: tools.filter(key => !isToolArchived(key, gear)).length,
        stowedTools: tools.filter(key => isToolArchived(key, gear)).length,
        availableClothing: clothing.filter(item => !isClothingArchived(item)).length,
        stowedClothing: clothing.filter(isClothingArchived).length,
        assignedStowedTools: Object.values(deps?.equipmentSlots || {}).filter(key => key && isToolArchived(key, gear)).length,
        wornStowedClothing: Object.values(gear.clothing || {}).filter(isClothingArchived).length };
    },
    applyGearClothingToPlayerData,
    clothingSpriteForCosmetic,
    ensureGearClothingCollection,
    buildPackClothingSection,
    getPackClothingForWardrobe,
    grantPackClothing, // Quest clothing uses the canonical Pack-to-Gear lifecycle.
    beginFiveBlossomCrowning, awardFiveBlossomCrown, finishFiveBlossomCrowning, ownsFiveBlossomCrown, FIVE_BLOSSOM_CROWN_ART, FIVE_BLOSSOM_CROWN_ID,
    transferPackClothingToNpcWardrobe,
    getPackClothingRevision: () => packClothingRevision,
    closeClothingNests, // The visible Pack filter closes any expanded path that becomes hidden.
    buildPackClothingNests: () => buildClothingNameNests(deps?.getPackClothing?.() || [], 'pack', renderPackClothingLeaf),
    previewPackClothingItem: (uid, individual = false) => selectPackClothingItem(uid, true, individual), // Clothing detail-only path used by controller focus.
    buildEquipmentSlots,
    getClothingStackDebug: () => { // Compact diagnostic usable on mobile without developer tools.
      const items = deps?.getPackClothing?.() || []; // Current saved pack entries are the authority.
      const groups = groupClothingForDisplay(items); // Reports only display counts, not private UID metadata.
      return { articles: items.length, visibleTiles: groups.length, stackedTiles: groups.filter(g => g.count > 1).length };
    },
    getClothingNestDebug: () => ({ nameNests: clothingNameGroups(deps?.getPackClothing?.() || []).length, openClothingPath: openClothingPath.slice(), revision: packClothingRevision, latestChange: 'Name stacks with five recent icons; plain stacks with three; individual UID actions.' }),
    __test: { clothingNameGroups, clothingStackSignature,groupClothingForDisplay,ensureUniquePackClothingUids,hasIndividualClothingPattern,clothingGearCollectionKey,normalizeGearClothingItems,
      setCrownTestDeps: value => { deps = value; } }, // Headless annual award tests use the actual equipment owner without installing a second UI runtime.
  };
})();
