(() => {
  'use strict';

  if (window.HobunjiMenuTabIcons?.version >= 3) return;

  const TAB_SELECTOR = '.mp-tabs .mp-tab[data-mpanel]'; // Used to target only the main menu's navigation tabs.
  const RELATIONSHIPS_PANEL_ID = 'relationships'; // Used to preserve the PNG heart authored by generic-hud-icons.js.
  const LOADOUT_PANEL_ID = 'loadout'; // Used to render the melee-over-ranged composite tab icon.
  const STYLE_ID = 'hobunjiMenuTabIconOnlyStyles'; // Used to keep the presentation rules idempotent.
  const GENERIC_ICON_BASE = new URL('assets/hud/generic_icons/', document.baseURI).href; // Used by generic menu-tab artwork and the temporary wallet currency icon.
  const ACTION_ICON_BASE = new URL('assets/hud/action_icons/', document.baseURI).href; // Used by gameplay action artwork reused by menu tabs.
  const WALLET_SUFFIX_SELECTOR = '#mpInventory .inv-wallet-suffix'; // Used to replace the mis-metric Tankanscript currency glyph with temporary PNG artwork.
  const CURRENCY_ICON_FILE = 'icon_tbu.png'; // Used by applyWalletCurrencyIcon() as the temporary gananji currency symbol.
  const LOADOUT_ICON_SIZE = 128; // Used as the raster resolution for the outlined loadout composite.
  const LOADOUT_OUTLINE_RADIUS = 4; // Used to punch a readable halo around melee before it covers ranged.
  const LOADOUT_COLORS = Object.freeze({
    melee: '#e67f73',
    ranged: '#78aee8',
  });
  const TAB_ART = Object.freeze({
    inventory: { base: 'action', file: 'item_select.png', color: '#e3ae61' },
    farm: { base: 'generic', file: 'icon_wheat.png', color: '#6bc36f' },
    stable: { base: 'generic', file: 'icon_horseshoe.png', color: '#c89461' },
    tasks: { base: 'generic', file: 'icon_journal.png', color: '#e0c56b' },
    progress: { base: 'generic', file: 'icon_writing_stack.png', color: '#b38bdd' },
    map: { base: 'generic', file: 'icon_map.png', color: '#67aee8' },
  });
  const debugState = {
    transformed: 0,
    lastPanel: null,
    loadoutRasterReady: false,
    loadoutRasterError: null,
    walletCurrencyIconApplied: false,
  }; // Used by the mobile-safe debug snapshot below.
  let loadoutRasterUrl = null; // Used after the two action icons have been composited once.

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Used to keep the tab-only presentation out of the broader stylesheet.
    style.id = STYLE_ID;
    style.textContent = `
      ${TAB_SELECTOR} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 34px;
        gap: 0;
      }
      ${TAB_SELECTOR} .menu-tab-glyph {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        font-size: 1.05em;
        pointer-events: none;
      }
      ${TAB_SELECTOR} .menu-tab-art {
        display: inline-block;
        width: 1.35em;
        height: 1.35em;
        flex: 0 0 1.35em;
        background: var(--menu-tab-icon-color, currentColor);
        -webkit-mask: var(--menu-tab-icon-url) center / contain no-repeat;
        mask: var(--menu-tab-icon-url) center / contain no-repeat;
        pointer-events: none;
      }
      ${TAB_SELECTOR} .menu-tab-loadout {
        position: relative;
        display: inline-block;
        width: 1.48em;
        height: 1.48em;
        flex: 0 0 1.48em;
        pointer-events: none;
      }
      ${TAB_SELECTOR} .menu-tab-loadout-piece {
        position: absolute;
        display: block;
        width: 1.03em;
        height: 1.03em;
        background: var(--menu-tab-icon-color, currentColor);
        -webkit-mask: var(--menu-tab-icon-url) center / contain no-repeat;
        mask: var(--menu-tab-icon-url) center / contain no-repeat;
      }
      ${TAB_SELECTOR} .menu-tab-loadout-ranged {
        right: .02em;
        bottom: .01em;
      }
      ${TAB_SELECTOR} .menu-tab-loadout-melee {
        left: .02em;
        top: .01em;
        filter:
          drop-shadow(1px 0 0 rgba(5, 8, 12, .96))
          drop-shadow(-1px 0 0 rgba(5, 8, 12, .96))
          drop-shadow(0 1px 0 rgba(5, 8, 12, .96))
          drop-shadow(0 -1px 0 rgba(5, 8, 12, .96));
      }
      ${TAB_SELECTOR} .menu-tab-loadout-raster {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        pointer-events: none;
      }
      ${WALLET_SUFFIX_SELECTOR} {
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        width: 1em !important;
        height: 1em !important;
        padding: 0 !important;
        line-height: 1 !important;
      }
      ${WALLET_SUFFIX_SELECTOR} .wallet-currency-icon {
        display: block;
        width: 1em;
        height: 1em;
        object-fit: contain;
        object-position: center;
        pointer-events: none;
      }
      ${TAB_SELECTOR}[data-mpanel="relationships"] .relationships-tab-heart {
        filter:
          drop-shadow(0 0 2px rgba(255, 113, 143, .76))
          drop-shadow(0 0 6px rgba(255, 113, 143, .34));
      }
    `;
    document.head?.appendChild(style);
  }

  function firstGrapheme(text) {
    const value = String(text || '').trim(); // Used as the source for preserving each tab's existing emoji/symbol.
    if (!value) return '';
    if (typeof Intl?.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' }); // Used to keep variation selectors/ZWJ emoji intact.
      return segmenter.segment(value)[Symbol.iterator]().next().value?.segment || '';
    }
    return Array.from(value)[0] || ''; // Used as the compatibility fallback for simple single-codepoint tab emoji.
  }

  function visibleLabel(tab) {
    const explicit = tab.getAttribute('aria-label') || tab.title; // Used to preserve an existing accessibility label when one already exists.
    if (explicit) return explicit.trim();
    const text = String(tab.textContent || '').trim(); // Used to derive the former visible label before removing it.
    const glyph = firstGrapheme(text);
    const remainder = glyph ? text.slice(glyph.length).trim() : text;
    if (remainder) return remainder === 'Relations' ? 'Relationships' : remainder;
    const panelId = String(tab.dataset.mpanel || '').trim();
    return panelId ? panelId.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()) : 'Menu';
  }

  function iconUrl(base, file) {
    const root = base === 'action' ? ACTION_ICON_BASE : GENERIC_ICON_BASE; // Used to resolve requested assets without duplicating path logic.
    return new URL(file, root).href;
  }

  function applyWalletCurrencyIcon() {
    const suffix = document.querySelector(WALLET_SUFFIX_SELECTOR); // Used as the existing wallet currency-symbol host; keeps the wallet DOM/layout contract intact.
    if (!suffix) return false;
    if (suffix.dataset.walletCurrencyIcon === 'tbu' && suffix.querySelector('.wallet-currency-icon')) {
      debugState.walletCurrencyIconApplied = true;
      return false;
    }
    const image = document.createElement('img'); // Used instead of the Tankanscript g until that font glyph's authored metrics are corrected.
    image.className = 'wallet-currency-icon';
    image.src = iconUrl('generic', CURRENCY_ICON_FILE);
    image.alt = '';
    image.draggable = false;
    image.setAttribute('aria-hidden', 'true');
    suffix.replaceChildren(image);
    suffix.dataset.walletCurrencyIcon = 'tbu';
    suffix.setAttribute('aria-label', 'Gananji');
    suffix.title = 'Gananji';
    debugState.walletCurrencyIconApplied = true;
    return true;
  }

  function applyMask(span, url, color) {
    span.style.setProperty('--menu-tab-icon-url', `url("${url}")`);
    span.style.setProperty('--menu-tab-icon-color', color);
  }

  function makeGlyphNode(glyph) {
    const span = document.createElement('span'); // Used as the retained icon-only content for emoji-backed tabs.
    span.className = 'menu-tab-glyph';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = glyph;
    return span;
  }

  function makeArtNode(config) {
    const span = document.createElement('span'); // Used as the color-tintable icon-only content for PNG-backed tabs.
    span.className = 'menu-tab-art';
    span.setAttribute('aria-hidden', 'true');
    applyMask(span, iconUrl(config.base, config.file), config.color);
    return span;
  }

  function makeLoadoutFallback() {
    const host = document.createElement('span'); // Used until the canvas composite finishes loading.
    host.className = 'menu-tab-loadout';
    host.setAttribute('aria-hidden', 'true');

    const ranged = document.createElement('span'); // Used as the lower, steel-blue ranged layer.
    ranged.className = 'menu-tab-loadout-piece menu-tab-loadout-ranged';
    applyMask(ranged, iconUrl('action', 'draw_ranged.png'), LOADOUT_COLORS.ranged);

    const melee = document.createElement('span'); // Used as the upper, warm-red melee layer.
    melee.className = 'menu-tab-loadout-piece menu-tab-loadout-melee';
    applyMask(melee, iconUrl('action', 'draw_melee.png'), LOADOUT_COLORS.melee);

    host.append(ranged, melee);
    return host;
  }

  function makeLoadoutNode() {
    const host = document.createElement('span'); // Used as the stable DOM host whether the raster is ready yet or not.
    host.className = 'menu-tab-loadout';
    host.setAttribute('aria-hidden', 'true');
    if (!loadoutRasterUrl) {
      const fallback = makeLoadoutFallback();
      host.append(...fallback.childNodes);
      return host;
    }
    const image = document.createElement('img'); // Used for the finished destination-out melee/ranged composite.
    image.className = 'menu-tab-loadout-raster';
    image.src = loadoutRasterUrl;
    image.alt = '';
    image.draggable = false;
    host.appendChild(image);
    return host;
  }

  function imageRect(image, maxSide, centerX, centerY) {
    const width = Math.max(1, Number(image?.naturalWidth) || 1); // Used to preserve each authored action icon's aspect ratio.
    const height = Math.max(1, Number(image?.naturalHeight) || 1);
    const scale = Math.min(maxSide / width, maxSide / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    return {
      x: centerX - drawWidth / 2,
      y: centerY - drawHeight / 2,
      width: drawWidth,
      height: drawHeight,
    };
  }

  function tintedLayer(image, rect, color) {
    const layer = document.createElement('canvas'); // Used to recolor one source icon without affecting already-composited layers.
    layer.width = LOADOUT_ICON_SIZE;
    layer.height = LOADOUT_ICON_SIZE;
    const context = layer.getContext('2d');
    if (!context) return null;
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = color;
    context.fillRect(0, 0, layer.width, layer.height);
    context.globalCompositeOperation = 'source-over';
    return layer;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image(); // Used to preload exact action-icon alpha before canvas compositing.
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load ${url}`));
      image.src = url;
    });
  }

  function buildLoadoutRaster(rangedImage, meleeImage) {
    const canvas = document.createElement('canvas'); // Used to reproduce the combo-number destination-out masking technique.
    canvas.width = LOADOUT_ICON_SIZE;
    canvas.height = LOADOUT_ICON_SIZE;
    const context = canvas.getContext('2d');
    if (!context) return null;

    const rangedRect = imageRect(rangedImage, 82, 76, 73); // Used to leave both weapon-type silhouettes readable in the stack.
    const meleeRect = imageRect(meleeImage, 88, 53, 51);
    const rangedLayer = tintedLayer(rangedImage, rangedRect, LOADOUT_COLORS.ranged);
    const meleeLayer = tintedLayer(meleeImage, meleeRect, LOADOUT_COLORS.melee);
    if (!rangedLayer || !meleeLayer) return null;

    context.drawImage(rangedLayer, 0, 0);

    // Match the changing combo-number icon's separation idea: erase an expanded
    // copy of the upper icon from the lower icon before painting the upper icon.
    context.globalCompositeOperation = 'destination-out';
    for (let y = -LOADOUT_OUTLINE_RADIUS; y <= LOADOUT_OUTLINE_RADIUS; y += 2) {
      for (let x = -LOADOUT_OUTLINE_RADIUS; x <= LOADOUT_OUTLINE_RADIUS; x += 2) {
        if (x * x + y * y > LOADOUT_OUTLINE_RADIUS * LOADOUT_OUTLINE_RADIUS) continue;
        context.drawImage(meleeImage, meleeRect.x + x, meleeRect.y + y, meleeRect.width, meleeRect.height);
      }
    }
    context.drawImage(meleeImage, meleeRect.x, meleeRect.y, meleeRect.width, meleeRect.height);

    context.globalCompositeOperation = 'source-over';
    context.drawImage(meleeLayer, 0, 0);

    try {
      return canvas.toDataURL('image/png');
    } catch (_) {
      return null;
    }
  }

  function refreshLoadoutTabs() {
    if (!loadoutRasterUrl) return;
    document.querySelectorAll(`${TAB_SELECTOR}[data-mpanel="${LOADOUT_PANEL_ID}"] .menu-tab-loadout`).forEach(host => {
      const image = document.createElement('img'); // Used to replace the temporary CSS stack with the punched-raster final icon.
      image.className = 'menu-tab-loadout-raster';
      image.src = loadoutRasterUrl;
      image.alt = '';
      image.draggable = false;
      host.replaceChildren(image);
    });
  }

  function preloadLoadoutComposite() {
    Promise.all([
      loadImage(iconUrl('action', 'draw_ranged.png')),
      loadImage(iconUrl('action', 'draw_melee.png')),
    ]).then(([rangedImage, meleeImage]) => {
      loadoutRasterUrl = buildLoadoutRaster(rangedImage, meleeImage);
      debugState.loadoutRasterReady = Boolean(loadoutRasterUrl);
      if (!loadoutRasterUrl) debugState.loadoutRasterError = 'Canvas compositing returned no image.';
      refreshLoadoutTabs();
    }).catch(error => {
      debugState.loadoutRasterError = String(error?.message || error || 'Unknown loadout icon error');
      if (typeof window.__farmLog === 'function') window.__farmLog(`[menu-tab-icons] ${debugState.loadoutRasterError}`, 'error');
    });
  }

  function transformTab(tab) {
    if (!(tab instanceof Element) || tab.dataset.menuTabIconOnly === '2') return false;
    const panelId = String(tab.dataset.mpanel || ''); // Used to select a dedicated PNG, loadout composite, or the existing emoji fallback.
    const label = visibleLabel(tab); // Used after the visible words are removed so keyboard/screen-reader navigation remains clear.

    if (panelId === RELATIONSHIPS_PANEL_ID) {
      window.HobunjiGenericHudIcons?.scan?.(); // Used to ensure the relationships tab has its PNG heart before we finalize it.
      const heart = tab.querySelector('.relationships-tab-heart');
      if (!heart) return false;
      for (const child of [...tab.childNodes]) if (child !== heart) child.remove();
    } else if (panelId === LOADOUT_PANEL_ID) {
      tab.replaceChildren(makeLoadoutNode());
    } else if (TAB_ART[panelId]) {
      tab.replaceChildren(makeArtNode(TAB_ART[panelId]));
    } else {
      const glyph = firstGrapheme(tab.textContent); // Used to retain exactly the tab's existing leading emoji/symbol for untouched tabs.
      if (!glyph) return false;
      tab.replaceChildren(makeGlyphNode(glyph));
    }

    tab.setAttribute('aria-label', label);
    tab.title = label;
    tab.dataset.menuTabIconOnly = '2';
    debugState.transformed += 1;
    debugState.lastPanel = panelId || null;
    return true;
  }

  function transformAll() {
    document.querySelectorAll(TAB_SELECTOR).forEach(transformTab);
    applyWalletCurrencyIcon();
  }

  function debugSnapshot() {
    const tabs = [...document.querySelectorAll(TAB_SELECTOR)]; // Used to inspect all icon-only tab state without devtools.
    return {
      version: 3,
      transformed: debugState.transformed,
      lastPanel: debugState.lastPanel,
      totalTabs: tabs.length,
      iconOnlyTabs: tabs.filter(tab => tab.dataset.menuTabIconOnly === '2').length,
      labels: Object.fromEntries(tabs.map(tab => [tab.dataset.mpanel || '', tab.getAttribute('aria-label') || ''])),
      customArtPanels: tabs.filter(tab => tab.querySelector('.menu-tab-art')).map(tab => tab.dataset.mpanel || ''),
      relationshipHeartGlowing: !!document.querySelector(`${TAB_SELECTOR}[data-mpanel="relationships"] .relationships-tab-heart`),
      loadoutRasterReady: debugState.loadoutRasterReady,
      loadoutRasterError: debugState.loadoutRasterError,
      loadoutCompositePresent: !!document.querySelector(`${TAB_SELECTOR}[data-mpanel="loadout"] .menu-tab-loadout`),
      walletCurrencyIconApplied: debugState.walletCurrencyIconApplied,
      walletCurrencyIconPresent: !!document.querySelector(`${WALLET_SUFFIX_SELECTOR} .wallet-currency-icon`),
    };
  }

  injectStyles();
  preloadLoadoutComposite();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', transformAll, { once: true });
  else transformAll();

  window.HobunjiMenuTabIcons = Object.freeze({ version: 3, refresh: transformAll, debugSnapshot });
  window.__menuTabIconsDebug = debugSnapshot;
})();