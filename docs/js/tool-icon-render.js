// HUD/tool icon compatibility bridge.
//
// Tool/item sprites used to be rasterized here and injected into gameplay
// buttons. The HUD now has purpose-built action artwork under
// assets/hud/action_icons, so gameplay controls must not derive their icon from
// whichever literal item happens to be equipped. Keep the old public methods
// as no-ops because game.js still calls them while resolving metal variants;
// returning null from getIconHTML makes those callers use their existing
// generic-symbol fallback until ActionArchIcons replaces the relevant arch
// control with a dedicated PNG.
(() => {
  'use strict';

  function getIconHTML() { return null; }
  function warm() {}
  function registerCanvasSource() {}
  function invalidate() {}

  window.ToolIconRender = {
    getIconHTML,
    warm,
    registerCanvasSource,
    invalidate,
    spriteButtonRenderingDisabled: true,
  };
})();

// This file already loads synchronously before game.js. Use that existing
// bootstrap point to load the decoupled held-object/world-layer policy without
// adding another render concern back into game.js or index.html.
(() => {
  'use strict';
  if (window.HeldObjectRenderOrder?.installed) return;
  const src = 'js/held-object-render-order.js?v=20260815a';
  if (document.readyState === 'loading' && document.currentScript) {
    document.write(`<script data-hobunji-held-render-order="1" src="${src}"><\/script>`);
    return;
  }
  if (document.querySelector('script[data-hobunji-held-render-order]')) return;
  const script = document.createElement('script');
  script.dataset.hobunjiHeldRenderOrder = '1';
  script.src = src;
  script.async = false;
  script.onerror = () => window.__farmLog?.('[held-layer] render-order module failed to load', 'error');
  document.head.appendChild(script);
})();

// Dedicated HUD action-icon resolver.
//
// game.js is still authoritative for what every control does and when it is
// visible. This module only replaces the artwork after each HUD/selection-arc
// rebuild. That keeps input, cooldown, selection, and equipment logic intact.
(() => {
  'use strict';

  // Relative to docs/index.html. Do not use a root-leading slash here: GitHack
  // and GitHub Pages serve this game below a repository path, so `/assets/...`
  // incorrectly requests the host root and produces the browser's broken-image
  // marker.
  const ACTION_ICON_BASE = new URL('assets/hud/action_icons/', document.baseURI).href; // Base URL used by every named action PNG.

  // This is deliberately the exact directory inventory. Keeping the list
  // explicit prevents a typo/nonexistent filename from ever being inserted as
  // an <img> and showing a broken-image glyph in the HUD.
  const ACTION_ICON_FILES = Object.freeze([
    'ammo_select.png',
    'draw_melee.png',
    'draw_pick.png',
    'draw_ranged.png',
    'draw_shovel.png',
    'item_select.png',
    'potion_select.png',
    'tool_select.png',
  ]);
  const ACTION_ICON_FILE_SET = new Set(ACTION_ICON_FILES); // Guards resolver output against nonexistent assets.

  const ACTION_ICON_BY_ID = Object.freeze({ // Permanent selector buttons whose meaning never depends on their text.
    btnAmmoSelect: 'ammo_select.png',
    potionBtn: 'potion_select.png',
    toolBtn: 'tool_select.png',
    itemBtn: 'item_select.png',
  });

  const TOOL_SLOT_ICON_BY_LABEL = Object.freeze({ // Tool-selection arc entries that have dedicated Draw artwork.
    shovel: 'draw_shovel.png',
    pick: 'draw_pick.png',
    weapon: 'draw_melee.png',
    melee: 'draw_melee.png',
    'melee weapon': 'draw_melee.png',
    ranged: 'draw_ranged.png',
    'ranged weapon': 'draw_ranged.png',
  });

  const ACTION_ICON_RULES = Object.freeze([ // Dynamic/rebuilt controls resolve from their live accessible label.
    [/(^|\s)(switch to ranged weapon|draw ranged|ranged draw)(\s|$)/i, 'draw_ranged.png'],
    [/(^|\s)(switch to melee weapon|draw melee|melee draw)(\s|$)/i, 'draw_melee.png'],
    [/(^|\s)(ammo select|select ammo)(\s|$)/i, 'ammo_select.png'],
    [/(^|\s)(potion select|select potion)(\s|$)/i, 'potion_select.png'],
    [/(^|\s)(tool select|select tool)(\s|$)/i, 'tool_select.png'],
    [/(^|\s)(item select|select item)(\s|$)/i, 'item_select.png'],
    [/(^|\s)(pick draw|draw pick)(\s|$)/i, 'draw_pick.png'],
    [/(^|\s)(shovel draw|draw shovel)(\s|$)/i, 'draw_shovel.png'],
  ]);

  // .abt covers the permanent ring plus game.js-rebuilt action buttons;
  // .arc-slot covers the held tool/item/potion/ammo selector overlays.
  const ACTION_ICON_SELECTOR = '#arcContainer .abt, #toolBtn, #itemBtn, #btnAmmoSelect, #potionBtn, .arc-slot'; // HUD nodes checked after each rebuild.
  const iconLoadState = new Map(); // filename -> { state: loading|loaded|failed, url }; avoids inserting unloaded/broken images.
  let refreshQueued = false; // Coalesces MutationObserver bursts into one icon pass.
  let observer = null; // Stored so the mobile-visible debug snapshot can report installation state.

  function normalizeDescriptor(value) {
    return String(value || '')
      .replace(/[_&/\\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function archLabel(element) {
    const explicit = [
      element?.dataset?.action,
      element?.dataset?.label,
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
    ].filter(Boolean).join(' ');
    const visibleLabel = element?.querySelector?.('.abt-label, .arc-label, .ts-lbl')?.textContent
      || element?.textContent
      || '';
    return normalizeDescriptor(`${explicit} ${visibleLabel}`);
  }

  function resolveActionIcon(element) {
    const byId = ACTION_ICON_BY_ID[element?.id];
    if (byId) return byId;

    // The combat quick-switch intentionally changes its accessible label in
    // game.js between "Switch to ranged weapon" and "Switch to melee weapon".
    // Resolving that live label makes the button show the weapon it will draw,
    // never the sprite of the weapon currently sitting in that equipment slot.
    const descriptor = archLabel(element);

    if (element?.classList?.contains('arc-slot')) {
      const slotLabel = normalizeDescriptor(element.querySelector('.arc-label')?.textContent).toLowerCase();
      const toolSlotIcon = TOOL_SLOT_ICON_BY_LABEL[slotLabel];
      if (toolSlotIcon) return toolSlotIcon;
    }

    for (const [pattern, file] of ACTION_ICON_RULES) {
      if (pattern.test(descriptor)) return file;
    }
    return null;
  }

  function iconHost(element) {
    if (!element) return null;
    if (element.id === 'toolBtn') return element.querySelector('#toolBtnIcon') || element;
    if (element.id === 'btnWeaponSwitch') return element.querySelector('#btnWeaponSwitchIcon') || element.querySelector('.abt-icon') || element;
    if (element.classList?.contains('arc-slot')) return element.querySelector('.arc-icon') || element;
    return element.querySelector('.abt-icon') || element;
  }

  function report(message, level = 'items') {
    if (typeof window.__farmLog === 'function') window.__farmLog(`[action-arch-icons] ${message}`, level);
  }

  function ensureIconLoaded(file) {
    if (!ACTION_ICON_FILE_SET.has(file)) {
      report(`Resolver rejected nonexistent icon filename: ${file}`, 'error');
      return null;
    }
    const existing = iconLoadState.get(file);
    if (existing) return existing;

    const record = { state: 'loading', url: new URL(file, ACTION_ICON_BASE).href }; // Tracks this file's preload result for all controls that share it.
    iconLoadState.set(file, record);
    const probe = new Image();
    probe.onload = () => {
      record.state = 'loaded';
      queueRefresh();
    };
    probe.onerror = () => {
      record.state = 'failed';
      report(`Failed to load ${record.url}; leaving the control's generic fallback in place.`, 'error');
    };
    probe.src = record.url;
    return record;
  }

  function styleHost(host) {
    if (!host) return;
    host.style.display = 'inline-flex';
    host.style.alignItems = 'center';
    host.style.justifyContent = 'center';
  }

  function applyActionIcon(element) {
    const file = resolveActionIcon(element);
    if (!file) return false;
    const host = iconHost(element);
    if (!host) return false;

    const existing = host.querySelector?.(`img[data-action-arch-icon="${file}"]`);
    if (existing) return true;

    // Preload first. A failed request is never attached to the DOM, so the
    // browser cannot draw its little missing-image symbol.
    const load = ensureIconLoaded(file);
    if (!load || load.state !== 'loaded') return false;

    // The HUD may have changed state while the PNG was loading (especially the
    // melee/ranged switch), so resolve again before committing the image.
    if (resolveActionIcon(element) !== file) return false;

    const image = document.createElement('img');
    image.src = load.url;
    image.alt = archLabel(element) || file.replace(/\.png$/i, '').replace(/_/g, ' ');
    image.className = 'action-arch-png';
    image.dataset.actionArchIcon = file;
    image.draggable = false;
    image.style.cssText = 'width:78%;height:78%;display:block;margin:auto;object-fit:contain;pointer-events:none;';

    host.replaceChildren(image);
    styleHost(host);
    element.dataset.actionArchIcon = file;
    return true;
  }

  function refresh() {
    refreshQueued = false;
    document.querySelectorAll(ACTION_ICON_SELECTOR).forEach(applyActionIcon);
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(refresh);
  }

  function debugSnapshot() {
    return [...document.querySelectorAll(ACTION_ICON_SELECTOR)].map(element => {
      const file = resolveActionIcon(element);
      return {
        id: element.id || null,
        label: archLabel(element),
        resolvedIcon: file,
        loadState: file ? iconLoadState.get(file)?.state || 'not-requested' : null,
        appliedIcon: element.dataset.actionArchIcon || null,
        containsLegacyToolSprite: Boolean(element.querySelector?.('.tool-sprite-icon')),
      };
    });
  }

  function install() {
    if (observer) return;
    ACTION_ICON_FILES.forEach(ensureIconLoaded); // Warm all eight real files so state changes never expose a broken/late icon.
    refresh();
    observer = new MutationObserver(queueRefresh);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-action', 'data-label', 'aria-label', 'title'],
    });
  }

  window.ActionArchIcons = Object.freeze({
    refresh,
    resolve: resolveActionIcon,
    debugSnapshot,
    files: ACTION_ICON_FILES,
    spriteButtonsDisabled: true,
    get installed() { return Boolean(observer); },
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
