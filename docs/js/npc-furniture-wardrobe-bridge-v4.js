(() => {
  'use strict';

  if (Number(window.NpcFurnitureWardrobes?.version) >= 4) return;

  const DEFAULT_CONFIG = Object.freeze({ // Temporary wardrobe registry settings; proper npcWardrobeFor authoring always wins below.
    tileSizePixels: 64,
    targetRadiusTiles: 0.82,
    metadataKey: 'npcWardrobeFor',
    placeholderEnabled: true,
    placeholderRegistryUrl: 'config/npcs/placeholder-wardrobes.json',
    placeholderNpcDatabaseUrl: 'config/npcs/hobunji-starter-npc-database.json',
  });

  const rootConfig = window.SCRATCHBONES_CONFIG = window.SCRATCHBONES_CONFIG || {}; // Reuses the game's existing modular config tree.
  rootConfig.game = rootConfig.game || {};
  const config = rootConfig.game.npcWardrobes = { ...DEFAULT_CONFIG, ...(rootConfig.game.npcWardrobes || {}) };
  const ACTION_BUTTON_IDS = ['btnAction1', 'btnAction2', 'btnAction3', 'btnItemAction1', 'btnItemAction2']; // Existing action-bar slots reused for wardrobe access.

  const mapCache = new Map(); // Interior JSON requests cached by runtime area filename.
  let npcDatabasePromise = null; // Runtime-effective NPC DB, including LocalDBOverrides schedule removals/local source when available.
  let registryPromise = null; // Explicit 1-NPC-to-1-furniture temporary placeholder registry.
  let activeBinding = null; // Currently aimed wardrobe binding.
  let lastArea = null; // Mobile-friendly diagnostics.
  let lastTarget = null; // Mobile-friendly diagnostics.
  let lastError = null; // Mobile-friendly diagnostics.
  let lastPlaceholderSummary = null; // Shows registry entries resolved/skipped in the current interior.
  let syncingButtons = false; // Prevents observer recursion from our own action-bar writes.
  let refreshScheduled = false; // Coalesces bursts from the existing action-bar MutationObserver.
  let originalOpenWardrobePanel = null; // Preserves NpcWardrobe as the single panel implementation.
  let actionObserver = null; // Event-driven action-bar observer; no permanent polling loop.

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function currentArea() {
    return window.__hobunjiFurnitureDebug?.getCurrentArea?.() || null;
  }

  function supportedArea(area) {
    return typeof area === 'string' && /^map_i_/.test(area);
  }

  async function loadMap(area) {
    if (!supportedArea(area)) return null;
    if (!mapCache.has(area)) {
      mapCache.set(area, fetch(`config/maps/${encodeURIComponent(area)}.json`, { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error(`${area}: HTTP ${response.status}`);
          return response.json();
        })
        .catch(error => {
          lastError = String(error?.message || error);
          return null;
        }));
    }
    return mapCache.get(area);
  }

  async function loadNpcDatabase() {
    if (!npcDatabasePromise) {
      const load = window.LocalDBOverrides?.loadDatabase
        ? window.LocalDBOverrides.loadDatabase('npcDatabase')
        : fetch(String(config.placeholderNpcDatabaseUrl || DEFAULT_CONFIG.placeholderNpcDatabaseUrl), { cache: 'no-store' })
          .then(response => {
            if (!response.ok) throw new Error(`NPC wardrobe database: HTTP ${response.status}`);
            return response.json();
          });
      npcDatabasePromise = Promise.resolve(load).catch(error => {
        lastError = String(error?.message || error);
        return null;
      });
    }
    return npcDatabasePromise;
  }

  async function loadPlaceholderRegistry() {
    if (!config.placeholderEnabled) return null;
    if (!registryPromise) {
      registryPromise = fetch(String(config.placeholderRegistryUrl || DEFAULT_CONFIG.placeholderRegistryUrl), { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error(`NPC placeholder wardrobe registry: HTTP ${response.status}`);
          return response.json();
        })
        .catch(error => {
          lastError = String(error?.message || error);
          return null;
        });
    }
    return registryPromise;
  }

  function authoredWardrobeBindings(mapData) {
    const metadataKey = String(config.metadataKey || DEFAULT_CONFIG.metadataKey);
    return (mapData?.furniture || [])
      .filter(piece => piece?.[metadataKey])
      .map(piece => ({
        id: piece.id || null,
        itemKey: piece.itemKey || null,
        col: finite(piece.col, 0),
        row: finite(piece.row, 0),
        npcId: String(piece[metadataKey]),
        interactionRadiusTiles: Math.max(0.1, finite(piece.npcWardrobeInteractionRadiusTiles, config.targetRadiusTiles)),
        source: 'authored',
      }));
  }

  function placeholderWardrobeBindings(mapData, area, npcDatabase, registry) {
    if (!config.placeholderEnabled || !area || !npcDatabase || !registry?.assignments) return [];
    const metadataKey = String(config.metadataKey || DEFAULT_CONFIG.metadataKey);
    const activeNpcIds = new Set((npcDatabase.npcs || []).map(rec => String(rec?.id || '')).filter(Boolean)); // Prevents placeholders resurrecting runtime-removed NPCs.
    const authored = authoredWardrobeBindings(mapData);
    const authoredNpcIds = new Set(authored.map(binding => binding.npcId)); // Explicit authoring in this interior replaces that NPC's placeholder here.
    const furnitureById = new Map((mapData?.furniture || []).filter(piece => piece?.id).map(piece => [String(piece.id), piece]));
    const resolved = [];
    const skipped = [];

    for (const [npcId, assignment] of Object.entries(registry.assignments)) {
      if (String(assignment?.area || '') !== area) continue;
      if (!activeNpcIds.has(npcId)) { skipped.push({ npcId, reason: 'inactive-runtime-npc' }); continue; }
      if (authoredNpcIds.has(npcId)) { skipped.push({ npcId, reason: 'authored-override' }); continue; }
      const piece = furnitureById.get(String(assignment?.furnitureId || ''));
      if (!piece) { skipped.push({ npcId, reason: 'missing-furniture', furnitureId: assignment?.furnitureId || null }); continue; }
      if (piece[metadataKey]) { skipped.push({ npcId, reason: 'furniture-now-authored', furnitureId: piece.id }); continue; }
      resolved.push({
        id: piece.id,
        itemKey: piece.itemKey || assignment.itemKey || null,
        col: finite(piece.col, 0),
        row: finite(piece.row, 0),
        npcId,
        interactionRadiusTiles: Math.max(0.1, finite(piece.npcWardrobeInteractionRadiusTiles, config.targetRadiusTiles)),
        source: 'placeholder-registry',
        placeholderReason: assignment.reason || null,
      });
    }

    lastPlaceholderSummary = { area, resolved: resolved.map(binding => ({ npcId: binding.npcId, furnitureId: binding.id })), skipped };
    return resolved;
  }

  function wardrobeBindings(mapData, area = null, npcDatabase = null, registry = null) {
    const authored = authoredWardrobeBindings(mapData);
    if (!area || !npcDatabase || !registry) return authored;
    return [...authored, ...placeholderWardrobeBindings(mapData, area, npcDatabase, registry)];
  }

  function targetPointTiles(mapData) {
    const debug = window.__hobunjiFurnitureDebug;
    const player = debug?.playerState;
    const angleDeg = finite(debug?.targetAimAngleDeg, NaN);
    if (![player?.x, player?.y, angleDeg].every(Number.isFinite)) return null;
    const configuredOrbit = finite(window.SCRATCHBONES_CONFIG?.game?.input?.targeting?.orbitRadiusTiles, NaN);
    const orbit = Number.isFinite(configuredOrbit) ? configuredOrbit : 0.62;
    const tileSize = Math.max(1, finite(config.tileSizePixels, DEFAULT_CONFIG.tileSizePixels));
    const angle = angleDeg * Math.PI / 180;
    const colFloat = (player.x + Math.cos(angle) * tileSize * orbit) / tileSize;
    const rowFloat = (player.y + Math.sin(angle) * tileSize * orbit) / tileSize;
    const cols = Math.max(1, Math.floor(finite(mapData?.cols, 1)));
    const rows = Math.max(1, Math.floor(finite(mapData?.rows, 1)));
    return {
      colFloat, rowFloat,
      col: Math.max(0, Math.min(cols - 1, Math.floor(colFloat))),
      row: Math.max(0, Math.min(rows - 1, Math.floor(rowFloat))),
    };
  }

  function bindingAtTarget(mapData, area = null, npcDatabase = null, registry = null) {
    const target = targetPointTiles(mapData);
    if (!target) return null;
    const matches = wardrobeBindings(mapData, area, npcDatabase, registry)
      .map(binding => ({ binding, distance: Math.hypot(target.colFloat - (binding.col + 0.5), target.rowFloat - (binding.row + 0.5)) }))
      .filter(entry => entry.distance <= entry.binding.interactionRadiusTiles)
      .sort((a, b) => a.distance - b.distance || (a.binding.source === 'authored' ? -1 : 1));
    const found = matches[0]?.binding || null;
    lastTarget = {
      tile: { col: target.col, row: target.row },
      point: { col: Math.round(target.colFloat * 1000) / 1000, row: Math.round(target.rowFloat * 1000) / 1000 },
      binding: found ? { ...found } : null,
    };
    return found;
  }

  async function refreshActiveBinding() {
    const area = currentArea();
    lastArea = area;
    if (!supportedArea(area)) {
      activeBinding = null;
      lastTarget = null;
      lastPlaceholderSummary = null;
      return null;
    }
    const [mapData, npcDatabase, registry] = await Promise.all([loadMap(area), loadNpcDatabase(), loadPlaceholderRegistry()]);
    activeBinding = mapData ? bindingAtTarget(mapData, area, npcDatabase, registry) : null;
    return activeBinding;
  }

  function inputConfig() { return window.SCRATCHBONES_CONFIG?.game?.input || {}; }
  function savedBindings() {
    const input = inputConfig();
    try { return JSON.parse(localStorage.getItem(input.storageKey || 'scratchbones.inputBindings.v1') || 'null') || {}; }
    catch (_) { return {}; }
  }
  function desktopCodeForSlot(slot) {
    const actionId = `action${slot}`;
    const authored = (inputConfig().actions || []).find(action => action?.id === actionId)?.desktop || null;
    return savedBindings()?.desktop?.[actionId] || authored;
  }
  function keyBadgeLabel(code) {
    if (!code) return '';
    if (code === 'Space') return 'SPACE';
    if (code === 'Enter') return 'ENTER';
    if (code.startsWith('Key')) return code.slice(3).toUpperCase();
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
    return String(code).toUpperCase();
  }
  function buttonSlot(button) { return ACTION_BUTTON_IDS.indexOf(button?.id) + 1; }
  function wardrobeButtonHtml(button) {
    const slot = buttonSlot(button);
    const code = window.matchMedia?.('(pointer: fine)')?.matches ? desktopCodeForSlot(slot) : null;
    const badge = code ? `<span class="abt-key">[${keyBadgeLabel(code)}]</span>` : '';
    return `${badge}<span class="abt-icon">👗</span><span class="abt-label">Wardrobe</span>`;
  }

  function suppressDirectWardrobeButton(button) {
    if (!button) return;
    button.dataset.npcFurnitureWardrobeSuppressed = '1';
    if (button.dataset.action === 'npc_open_wardrobe') delete button.dataset.action; // Removes the semantic action so world prompt readers cannot still see it.
    button.classList.add('abt-hidden');
    button.classList.remove('blocked');
    button.setAttribute('aria-hidden', 'true');
    button.innerHTML = '';
    button.removeAttribute('title');
  }

  function cleanupInjectedButton(button) {
    if (!button || button.dataset.npcFurnitureWardrobeInjected !== '1') return;
    suppressDirectWardrobeButton(button);
    delete button.dataset.npcFurnitureWardrobeInjected;
    delete button.dataset.npcFurnitureWardrobeNpcId;
  }

  function directWardrobeButtons() {
    return ACTION_BUTTON_IDS.map(id => document.getElementById(id))
      .filter(button => button?.dataset?.action === 'npc_open_wardrobe' && button.dataset.npcFurnitureWardrobeInjected !== '1');
  }

  function syncActionButtons() {
    if (syncingButtons) return;
    syncingButtons = true;
    try {
      const buttons = ACTION_BUTTON_IDS.map(id => document.getElementById(id)).filter(Boolean);
      const directButtons = directWardrobeButtons();
      if (!activeBinding) {
        for (const button of buttons) cleanupInjectedButton(button);
        for (const button of directButtons) suppressDirectWardrobeButton(button);
        return;
      }
      const host = buttons.find(button => button.dataset.npcFurnitureWardrobeInjected === '1')
        || directButtons[0]
        || buttons.find(button => button.dataset.npcFurnitureWardrobeSuppressed === '1')
        || buttons.find(button => button.classList.contains('abt-hidden'));
      if (!host) return;
      for (const button of buttons) {
        if (button === host) continue;
        if (button.dataset.npcFurnitureWardrobeInjected === '1') cleanupInjectedButton(button);
        else if (button.dataset.action === 'npc_open_wardrobe') suppressDirectWardrobeButton(button);
      }
      delete host.dataset.npcFurnitureWardrobeSuppressed;
      host.dataset.npcFurnitureWardrobeInjected = '1';
      host.dataset.npcFurnitureWardrobeNpcId = activeBinding.npcId;
      host.dataset.action = 'npc_open_wardrobe';
      host.classList.remove('abt-hidden', 'blocked');
      host.removeAttribute('aria-hidden');
      host.title = `Open ${activeBinding.npcId}'s ${activeBinding.source === 'authored' ? '' : 'placeholder '}wardrobe`;
      const html = wardrobeButtonHtml(host);
      if (host.innerHTML !== html) host.innerHTML = html;
    } finally {
      queueMicrotask(() => { syncingButtons = false; });
    }
  }

  async function refreshFromExistingActionBar() {
    try {
      await refreshActiveBinding();
      syncActionButtons();
    } catch (error) {
      lastError = String(error?.stack || error?.message || error);
    }
  }
  function scheduleActionRefresh() {
    if (syncingButtons || refreshScheduled) return;
    refreshScheduled = true;
    queueMicrotask(() => {
      refreshScheduled = false;
      refreshFromExistingActionBar();
    });
  }
  function installActionObserver() {
    const stack = document.getElementById('actionStack') || document.body;
    if (!stack || stack.dataset.npcFurnitureWardrobeObserved === '1') return false;
    stack.dataset.npcFurnitureWardrobeObserved = '1';
    actionObserver = new MutationObserver(scheduleActionRefresh);
    actionObserver.observe(stack, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-action'] });
    return true;
  }

  function buttonFromEvent(event) {
    const button = event?.target?.closest?.('button');
    return button && ACTION_BUTTON_IDS.includes(button.id) ? button : null;
  }
  function openActiveWardrobe() {
    if (!activeBinding || !originalOpenWardrobePanel) return false;
    originalOpenWardrobePanel(activeBinding.npcId);
    return true;
  }
  function installPointerInterception() {
    if (document.documentElement.dataset.npcFurnitureWardrobePointer === '1') return;
    document.documentElement.dataset.npcFurnitureWardrobePointer = '1';
    const intercept = event => {
      const button = buttonFromEvent(event);
      if (button?.dataset.npcFurnitureWardrobeInjected !== '1' || button.dataset.action !== 'npc_open_wardrobe') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'pointerup') openActiveWardrobe();
    };
    document.addEventListener('pointerdown', intercept, true);
    document.addEventListener('pointerup', intercept, true);
    document.addEventListener('click', intercept, true);
  }

  function patchWardrobeEntryPoint() {
    const wardrobe = window.NpcWardrobe;
    if (!wardrobe?.openWardrobePanel || wardrobe.__furnitureWardrobePatched) return false;
    originalOpenWardrobePanel = wardrobe.openWardrobePanel.bind(wardrobe);
    wardrobe.openWardrobePanel = function furnitureOnlyWardrobePanel() {
      if (!activeBinding) {
        window.__farmLog?.('[npc-wardrobe] blocked direct NPC wardrobe open; target assigned furniture instead.');
        return false;
      }
      return originalOpenWardrobePanel(activeBinding.npcId);
    };
    wardrobe.__furnitureWardrobePatched = true;
    return true;
  }

  function actionId(entry) { return String(entry?.dataset?.action || entry?.action || entry?.actionId || ''); }
  function patchWorldPopupText(api) {
    if (!api?.syncInteractionPrompts || api.__npcWardrobePromptFiltered) return false;
    const original = api.syncInteractionPrompts.bind(api);
    api.syncInteractionPrompts = function syncInteractionPromptsWithoutNpcWardrobe(options = {}) {
      const buttons = Array.isArray(options.buttons) ? options.buttons : [];
      return original({ ...options, buttons: buttons.filter(entry => actionId(entry) !== 'npc_open_wardrobe') });
    };
    api.__npcWardrobePromptFiltered = true;
    return true;
  }
  function chainGlobal(name, patch) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    const current = descriptor?.get ? descriptor.get.call(window) : descriptor?.value;
    if (current) patch(current);
    if (descriptor && descriptor.configurable === false) return;
    if (descriptor?.get || descriptor?.set) {
      Object.defineProperty(window, name, {
        configurable: true, enumerable: descriptor.enumerable,
        get() { return descriptor.get ? descriptor.get.call(window) : current; },
        set(value) { descriptor.set?.call(window, value); patch(descriptor.get ? descriptor.get.call(window) : value); },
      });
      return;
    }
    let value = current;
    Object.defineProperty(window, name, { configurable: true, enumerable: descriptor?.enumerable !== false, get() { return value; }, set(next) { value = next; patch(next); } });
  }

  function installWhenDomReady() {
    installPointerInterception();
    patchWardrobeEntryPoint();
    patchWorldPopupText(window.WorldPopupText);
    installActionObserver();
    refreshFromExistingActionBar();
  }

  function debugSnapshot() {
    return {
      installed: true, version: 4, eventDriven: true, polling: false,
      observerInstalled: !!actionObserver, area: lastArea,
      activeBinding: activeBinding ? { ...activeBinding } : null,
      target: lastTarget ? JSON.parse(JSON.stringify(lastTarget)) : null,
      placeholder: lastPlaceholderSummary ? JSON.parse(JSON.stringify(lastPlaceholderSummary)) : null,
      error: lastError, cachedMaps: [...mapCache.keys()],
      actionButtons: ACTION_BUTTON_IDS.map(id => {
        const button = document.getElementById(id);
        return button ? { id, action: button.dataset.action || null, hidden: button.classList.contains('abt-hidden'), injected: button.dataset.npcFurnitureWardrobeInjected === '1', suppressed: button.dataset.npcFurnitureWardrobeSuppressed === '1', npcId: button.dataset.npcFurnitureWardrobeNpcId || null } : null;
      }).filter(Boolean),
    };
  }

  window.NpcFurnitureWardrobes = Object.freeze({
    installed: true, version: 4, eventDriven: true, config,
    loadMap, loadNpcDatabase, loadPlaceholderRegistry,
    authoredWardrobeBindings, placeholderWardrobeBindings, wardrobeBindings,
    bindingAtTarget, refreshActiveBinding, openActiveWardrobe, debugSnapshot,
  });
  window.__npcFurnitureWardrobeDebug = debugSnapshot;

  chainGlobal('WorldPopupText', patchWorldPopupText);
  if (document.readyState === 'loading') {
    installWhenDomReady();
    if (!document.getElementById('actionStack')) document.addEventListener('DOMContentLoaded', installWhenDomReady, { once: true });
  } else {
    installWhenDomReady();
  }
})();
