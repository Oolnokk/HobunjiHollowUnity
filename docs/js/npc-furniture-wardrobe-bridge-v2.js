(() => {
  'use strict';

  if (window.NpcFurnitureWardrobes?.installed && window.NpcFurnitureWardrobes?.eventDriven) return;

  const DEFAULT_CONFIG = Object.freeze({
    tileSizePixels: 64,
    targetRadiusTiles: 0.82,
    metadataKey: 'npcWardrobeFor',
  });
  const rootConfig = window.SCRATCHBONES_CONFIG = window.SCRATCHBONES_CONFIG || {};
  rootConfig.game = rootConfig.game || {};
  const authoredConfig = rootConfig.game.npcWardrobes || {};
  const config = rootConfig.game.npcWardrobes = { ...DEFAULT_CONFIG, ...authoredConfig };

  const ACTION_BUTTON_IDS = ['btnAction1', 'btnAction2', 'btnAction3', 'btnItemAction1', 'btnItemAction2'];
  const mapCache = new Map();
  let activeBinding = null;
  let lastArea = null;
  let lastTarget = null;
  let lastError = null;
  let syncingButtons = false;
  let refreshScheduled = false;
  let originalOpenWardrobePanel = null;
  let actionObserver = null;

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

  function mapUrl(area) {
    return `config/maps/${encodeURIComponent(area)}.json`;
  }

  async function loadMap(area) {
    if (!supportedArea(area)) return null;
    if (!mapCache.has(area)) {
      const request = fetch(mapUrl(area), { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error(`${area}: HTTP ${response.status}`);
          return response.json();
        })
        .catch(error => {
          lastError = String(error?.message || error);
          return null;
        });
      mapCache.set(area, request);
    }
    return mapCache.get(area);
  }

  function targetPointTiles(mapData) {
    const debug = window.__hobunjiFurnitureDebug;
    const player = debug?.playerState;
    const angleDeg = finite(debug?.targetAimAngleDeg, NaN);
    if (![player?.x, player?.y, angleDeg].every(Number.isFinite)) return null;
    const inputRadius = finite(window.SCRATCHBONES_CONFIG?.game?.input?.targeting?.orbitRadiusTiles, NaN);
    const orbit = Number.isFinite(inputRadius) ? inputRadius : 0.62;
    const tileSize = Math.max(1, finite(config.tileSizePixels, DEFAULT_CONFIG.tileSizePixels));
    const angle = angleDeg * Math.PI / 180;
    const colFloat = (player.x + Math.cos(angle) * tileSize * orbit) / tileSize;
    const rowFloat = (player.y + Math.sin(angle) * tileSize * orbit) / tileSize;
    const cols = Math.max(1, Math.floor(finite(mapData?.cols, 1)));
    const rows = Math.max(1, Math.floor(finite(mapData?.rows, 1)));
    return {
      colFloat,
      rowFloat,
      col: Math.max(0, Math.min(cols - 1, Math.floor(colFloat))),
      row: Math.max(0, Math.min(rows - 1, Math.floor(rowFloat))),
    };
  }

  function wardrobeBindings(mapData) {
    const metadataKey = String(config.metadataKey || DEFAULT_CONFIG.metadataKey);
    return (mapData?.furniture || [])
      .filter(piece => piece && piece[metadataKey])
      .map(piece => ({
        id: piece.id || null,
        itemKey: piece.itemKey || null,
        col: finite(piece.col, 0),
        row: finite(piece.row, 0),
        npcId: String(piece[metadataKey]),
        interactionRadiusTiles: Math.max(0.1, finite(piece.npcWardrobeInteractionRadiusTiles, config.targetRadiusTiles)),
      }));
  }

  function bindingAtTarget(mapData) {
    const target = targetPointTiles(mapData);
    if (!target) return null;
    const matches = wardrobeBindings(mapData)
      .map(binding => {
        const dx = target.colFloat - (binding.col + 0.5);
        const dz = target.rowFloat - (binding.row + 0.5);
        return { binding, distance: Math.hypot(dx, dz) };
      })
      .filter(entry => entry.distance <= entry.binding.interactionRadiusTiles)
      .sort((a, b) => a.distance - b.distance);
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
      return null;
    }
    const mapData = await loadMap(area);
    activeBinding = mapData ? bindingAtTarget(mapData) : null;
    return activeBinding;
  }

  function inputConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.input || {};
  }

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

  function buttonSlot(button) {
    return ACTION_BUTTON_IDS.indexOf(button?.id) + 1;
  }

  function wardrobeButtonHtml(button) {
    const slot = buttonSlot(button);
    const code = window.matchMedia?.('(pointer: fine)')?.matches ? desktopCodeForSlot(slot) : null;
    const badge = code ? `<span class="abt-key">[${keyBadgeLabel(code)}]</span>` : '';
    return `${badge}<span class="abt-icon">👗</span><span class="abt-label">Wardrobe</span>`;
  }

  function cleanupInjectedButton(button) {
    if (!button || button.dataset.npcFurnitureWardrobeInjected !== '1') return;
    if (button.dataset.action === 'npc_open_wardrobe') {
      button.classList.add('abt-hidden');
      button.classList.remove('blocked');
      delete button.dataset.action;
      button.innerHTML = '';
      button.removeAttribute('title');
    }
    delete button.dataset.npcFurnitureWardrobeInjected;
    delete button.dataset.npcFurnitureWardrobeNpcId;
  }

  function directWardrobeButtons() {
    return ACTION_BUTTON_IDS
      .map(id => document.getElementById(id))
      .filter(button => button?.dataset?.action === 'npc_open_wardrobe' && button.dataset.npcFurnitureWardrobeInjected !== '1');
  }

  function syncActionButtons() {
    if (syncingButtons) return;
    syncingButtons = true;
    try {
      const buttons = ACTION_BUTTON_IDS.map(id => document.getElementById(id)).filter(Boolean);
      for (const button of buttons) {
        if (button.dataset.npcFurnitureWardrobeInjected === '1' && button.dataset.action !== 'npc_open_wardrobe') {
          delete button.dataset.npcFurnitureWardrobeInjected;
          delete button.dataset.npcFurnitureWardrobeNpcId;
        }
      }
      const directButtons = directWardrobeButtons();
      if (!activeBinding) {
        for (const button of buttons) cleanupInjectedButton(button);
        for (const button of directButtons) {
          button.classList.add('abt-hidden');
          button.setAttribute('aria-hidden', 'true');
        }
        return;
      }
      for (const button of directButtons) button.removeAttribute('aria-hidden');
      let host = buttons.find(button => button.dataset.npcFurnitureWardrobeInjected === '1');
      if (!host) host = directButtons[0] || buttons.find(button => button.classList.contains('abt-hidden'));
      if (!host) return;
      for (const button of buttons) if (button !== host && button.dataset.npcFurnitureWardrobeInjected === '1') cleanupInjectedButton(button);
      host.dataset.npcFurnitureWardrobeInjected = '1';
      host.dataset.npcFurnitureWardrobeNpcId = activeBinding.npcId;
      if (host.dataset.action !== 'npc_open_wardrobe') host.dataset.action = 'npc_open_wardrobe';
      host.classList.remove('abt-hidden', 'blocked');
      host.removeAttribute('aria-hidden');
      host.title = `Open ${activeBinding.npcId}'s wardrobe furniture`;
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

  function installWhenDomReady() {
    installPointerInterception();
    patchWardrobeEntryPoint();
    installActionObserver();
    refreshFromExistingActionBar();
  }

  function debugSnapshot() {
    return {
      installed: true,
      eventDriven: true,
      polling: false,
      observerInstalled: !!actionObserver,
      area: lastArea,
      activeBinding: activeBinding ? { ...activeBinding } : null,
      target: lastTarget ? JSON.parse(JSON.stringify(lastTarget)) : null,
      error: lastError,
      cachedMaps: [...mapCache.keys()],
      actionButtons: ACTION_BUTTON_IDS.map(id => {
        const button = document.getElementById(id);
        return button ? {
          id,
          action: button.dataset.action || null,
          hidden: button.classList.contains('abt-hidden'),
          injected: button.dataset.npcFurnitureWardrobeInjected === '1',
          npcId: button.dataset.npcFurnitureWardrobeNpcId || null,
        } : null;
      }).filter(Boolean),
    };
  }

  window.NpcFurnitureWardrobes = Object.freeze({
    installed: true,
    eventDriven: true,
    config,
    loadMap,
    wardrobeBindings,
    bindingAtTarget,
    refreshActiveBinding,
    openActiveWardrobe,
    debugSnapshot,
  });
  window.__npcFurnitureWardrobeDebug = debugSnapshot;

  if (document.readyState === 'loading') {
    installWhenDomReady();
    if (!document.getElementById('actionStack')) document.addEventListener('DOMContentLoaded', installWhenDomReady, { once: true });
  } else {
    installWhenDomReady();
  }
})();
