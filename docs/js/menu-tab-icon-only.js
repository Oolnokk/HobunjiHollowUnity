(() => {
  'use strict';

  if (window.HobunjiMenuTabIcons?.version >= 10) return;

  const TAB_SELECTOR = '.mp-tabs .mp-tab[data-mpanel]'; // Used to target only the main menu's navigation tabs.
  const RELATIONSHIPS_PANEL_ID = 'relationships'; // Used to preserve the PNG heart authored by generic-hud-icons.js.
  const LOADOUT_PANEL_ID = 'loadout'; // Used to render the melee-over-ranged composite tab icon.
  const STYLE_ID = 'hobunjiMenuTabIconOnlyStyles'; // Used to keep the presentation rules idempotent.
  const GENERIC_ICON_BASE = new URL('assets/hud/generic_icons/', document.baseURI).href; // Used by generic menu-tab artwork and the ganang currency icon.
  const ACTION_ICON_BASE = new URL('assets/hud/action_icons/', document.baseURI).href; // Used by gameplay action artwork reused by menu tabs.
  const WALLET_SUFFIX_SELECTOR = '#mpInventory .inv-wallet-suffix'; // Used as the inventory wallet's currency-symbol character space.
  const HUD_GOLD_SELECTOR = '#spGold'; // Used as the persistent gameplay HUD's ganang readout host.
  const HUD_GOLD_AMOUNT_SELECTOR = '#spGoldAmount'; // Used to preserve the live amount node that hud-update.js already updates.
  const HUD_SUFFIX_SELECTOR = '#spGold .sb-gold-suffix'; // Used as the gameplay HUD's currency-symbol character space.
  const CURRENCY_ICON_FILE = 'icon_bronzecurrency.png'; // Used as the shared ganang currency symbol artwork.
  const CURRENCY_ICON_CLASS = 'ganang-currency-icon'; // Used to share one presentation rule between menu and gameplay HUD currency symbols.
  const CURRENCY_VERDIGRIS_COLOR = '#6fae9b'; // Used as the shared bronze-verdigris tint for ganang amounts and symbols.
  const CURRENCY_VERDIGRIS_GLOW = '#70ebc6'; // Used as the brighter saturated glow while preserving the base verdigris hue.
  const CURRENCY_ICON_SCALE = 0.7667; // Used to render the symbol 15% larger than the previous two-thirds scale.
  const LOADOUT_ICON_SIZE = 128; // Used as the raster resolution for the outlined loadout composite.
  const LOADOUT_OUTLINE_RADIUS = 4; // Used to punch a readable halo around melee before it covers ranged.
  const LOADOUT_COLORS = Object.freeze({
    melee: '#e67f73',
    ranged: '#78aee8',
  });
  const TAB_ART = Object.freeze({
    inventory: { base: 'action', file: 'item_select.png', color: '#e3ae61' },
    crafting: { base: 'generic', file: 'icon_axe.png', color: '#c98a56' },
    farm: { base: 'generic', file: 'icon_wheat.png', color: '#6bc36f' },
    stable: { base: 'generic', file: 'icon_horseshoe.png', color: '#c89461' },
    tasks: { base: 'generic', file: 'icon_journal.png', color: '#e0c56b' },
    compendium: { base: 'generic', file: 'icon_writing_stack.png', color: '#f3e7bd', showLabel: true },
    progress: { base: 'action', file: 'tool_select.png', color: '#b38bdd' },
    map: { base: 'generic', file: 'icon_map.png', color: '#67aee8' },
  });
  const MENU_PAGES = Object.freeze({
    inventory: ['Character', 'Items you carry, clothing, equipment and money.'],
    loadout: ['Character', 'Choose your weapons and combat setup.'],
    progress: ['Character', 'Review skills, mastery and perks.'],
    crafting: ['Character', 'Make items using your known recipes.'],
    map: ['World', 'Find places and plan where to go next.'],
    tasks: ['World', 'Track quests, requests and rumors.'],
    calendar: ['World', 'Check upcoming events and important dates.'],
    compendium: ['World', 'Look up discoveries and information about the world.'],
    farm: ['Home', 'Check your farm, buildings, storage and layout.'],
    stable: ['Home', 'Manage animals, companions and the nursery.'],
    relationships: ['Home', 'Review friendships, romance and family.'],
    settings: ['System', 'Adjust controls, sound, display and game preferences.'],
    debug: ['Developer', 'Inspect developer tools and diagnostics.'],
    wildlife: ['Developer', 'Inspect wildlife developer tools.'],
  }); // Shared destination order, category labels and explanations for the menu header.
  let menuContext = null; // Retains the visible location and purpose below the main navigation.
  const debugState = {
    transformed: 0,
    lastPanel: null,
    dynamicTabTransforms: 0,
    loadoutRasterReady: false,
    loadoutRasterError: null,
    walletCurrencyIconApplied: false,
    hudCurrencyIconApplied: false,
    hudCurrencyRepairs: 0,
  }; // Used by the mobile-safe debug snapshot below.
  let loadoutRasterUrl = null; // Used after the two action icons have been composited once.
  let hudGoldAmountNode = null; // Used to preserve the original live HUD amount node if another system rewrites #spGold textContent.
  let hudGoldObserver = null; // Used to repair only event-driven DOM rewrites of the HUD currency readout; no frame loop is added.
  let menuTabsObserver = null; // Used to transform menu tabs that are inserted after the initial menu icon pass.

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Used to keep the tab-only presentation out of the broader stylesheet.
    style.id = STYLE_ID;
    style.textContent = `
      ${TAB_SELECTOR} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        position: relative;
        flex: 0 0 auto;
        min-width: 80px;
        min-height: 44px;
        gap: .4em;
        padding: 18px 9px 6px;
        overflow: visible;
      }
      #menuPanel .mp-header { height: auto; min-height: 54px; }
      #menuPanel .mp-tabs { overflow-x: auto; overflow-y: hidden; height: auto; align-self: stretch; scrollbar-width: thin; }
      ${TAB_SELECTOR}[data-menu-group-start] { margin-left: 10px; border-left: 1px solid var(--border); }
      ${TAB_SELECTOR}[data-menu-group-start]::before {
        content: attr(data-menu-group-start);
        position: absolute; top: 3px; left: 9px;
        font-size: 9px; color: var(--muted); letter-spacing: .08em;
      }
      ${TAB_SELECTOR} .menu-tab-label { pointer-events: none; font-size: 11px; }
      .menu-page-context { flex: 0 0 auto; padding: 7px 12px; border-bottom: 1px solid var(--border); background: #0002; }
      .menu-page-context strong { display: block; color: var(--accent); font-size: 12px; }
      .menu-page-context p { margin: 3px 0 0; color: var(--muted); font-size: 11px; }
      @media (max-height: 500px) {
        .menu-page-context { padding-block: 4px; display: flex; align-items: baseline; gap: 10px; }
        .menu-page-context strong { flex: 0 0 auto; }
        .menu-page-context p { margin: 0; font-size: 10px; }
      }
      ${TAB_SELECTOR}[data-mpanel="compendium"] {
        gap: .35em;
        padding-inline: 10px;
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
      #mpInventory .inv-wallet-amount,
      .wallet-amount,
      .wallet-unit,
      ${HUD_GOLD_AMOUNT_SELECTOR} {
        color: ${CURRENCY_VERDIGRIS_COLOR} !important;
        text-shadow:
          -1px 0 0 #000,
          1px 0 0 #000,
          0 -1px 0 #000,
          0 1px 0 #000,
          -1px -1px 0 #000,
          1px -1px 0 #000,
          -1px 1px 0 #000,
          1px 1px 0 #000,
          0 0 4px ${CURRENCY_VERDIGRIS_GLOW},
          0 0 8px rgba(112, 235, 198, .72);
      }
      .wallet-icon {
        font-size: 28px;
        line-height: 1;
        flex: 0 0 auto;
      }
      ${HUD_GOLD_SELECTOR} {
        display: inline-flex;
        align-items: center;
        gap: 0;
      }
      ${HUD_GOLD_SELECTOR} .sb-gold-icon {
        display: none !important;
      }
      ${WALLET_SUFFIX_SELECTOR},
      ${HUD_SUFFIX_SELECTOR} {
        display: inline-flex !important;
        align-items: flex-end;
        justify-content: flex-start;
        width: 1em !important;
        height: 1em !important;
        flex: 0 0 1em;
        padding: 0 !important;
        line-height: 1 !important;
      }
      ${WALLET_SUFFIX_SELECTOR} .${CURRENCY_ICON_CLASS},
      ${HUD_SUFFIX_SELECTOR} .${CURRENCY_ICON_CLASS} {
        display: block;
        width: ${CURRENCY_ICON_SCALE}em;
        height: ${CURRENCY_ICON_SCALE}em;
        object-fit: contain;
        object-position: left bottom;
        filter:
          brightness(0) saturate(100%) invert(81%) sepia(24%) saturate(1092%) hue-rotate(111deg) brightness(117%) contrast(25%)
          drop-shadow(1px 0 0 #000)
          drop-shadow(-1px 0 0 #000)
          drop-shadow(0 1px 0 #000)
          drop-shadow(0 -1px 0 #000)
          drop-shadow(0 0 3px ${CURRENCY_VERDIGRIS_GLOW})
          drop-shadow(0 0 6px rgba(112, 235, 198, .72));
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

  function makeCurrencyImage() {
    const image = document.createElement('img'); // Used by both currency readouts so their symbol source and accessibility behavior stay identical.
    image.className = CURRENCY_ICON_CLASS;
    image.src = iconUrl('generic', CURRENCY_ICON_FILE);
    image.alt = '';
    image.draggable = false;
    image.setAttribute('aria-hidden', 'true');
    return image;
  }

  function applyCurrencyIcon(host, marker) {
    if (!host) return false;
    if (host.dataset.ganangCurrencyIcon === marker && host.querySelector(`.${CURRENCY_ICON_CLASS}`)) return false;
    host.replaceChildren(makeCurrencyImage());
    host.dataset.ganangCurrencyIcon = marker;
    host.setAttribute('aria-label', 'Ganang');
    host.title = 'Ganang';
    return true;
  }

  function applyWalletCurrencyIcon() {
    const suffix = document.querySelector(WALLET_SUFFIX_SELECTOR); // Used as the existing wallet currency-symbol host; keeps the wallet DOM/layout contract intact.
    if (!suffix) return false;
    const changed = applyCurrencyIcon(suffix, 'wallet');
    debugState.walletCurrencyIconApplied = true;
    return changed;
  }

  function hudAmountFromText(text) {
    const match = String(text || '').match(/-?\d[\d,]*/); // Used only when legacy code has flattened #spGold back into plain text.
    return match ? match[0].replace(/,/g, '') : null;
  }

  function applyHudCurrencyPresentation() {
    const hud = document.querySelector(HUD_GOLD_SELECTOR); // Used as the persistent gameplay money readout.
    if (!hud) return false;

    if (!hudGoldAmountNode) {
      hudGoldAmountNode = hud.querySelector(HUD_GOLD_AMOUNT_SELECTOR); // Used to retain the exact node hud-update.js already holds and updates.
      if (!hudGoldAmountNode) {
        hudGoldAmountNode = document.createElement('span'); // Used only as a fallback for malformed/legacy markup.
        hudGoldAmountNode.className = 'sb-gold-amount';
        hudGoldAmountNode.id = 'spGoldAmount';
        hudGoldAmountNode.textContent = hudAmountFromText(hud.textContent) || '0';
      }
    }

    const amountWasDetached = hudGoldAmountNode.parentNode !== hud; // Used to detect a textContent rewrite without polling.
    if (amountWasDetached) {
      const flattenedAmount = hudAmountFromText(hud.textContent);
      if (flattenedAmount !== null) hudGoldAmountNode.textContent = flattenedAmount;
    }

    let suffix = hud.querySelector('.sb-gold-suffix'); // Used as the HUD's 1em currency-symbol character space.
    if (!suffix) {
      suffix = document.createElement('span'); // Used to restore the authored suffix host after a legacy full-text rewrite.
      suffix.className = 'sb-gold-suffix';
    }
    const iconChanged = applyCurrencyIcon(suffix, 'hud');
    const structureChanged = hud.childNodes.length !== 2 || hud.firstChild !== hudGoldAmountNode || hud.lastChild !== suffix;
    if (structureChanged) hud.replaceChildren(hudGoldAmountNode, suffix);
    if (amountWasDetached) debugState.hudCurrencyRepairs += 1;
    debugState.hudCurrencyIconApplied = true;
    return iconChanged || structureChanged;
  }

  function installHudCurrencyRepair() {
    if (hudGoldObserver) return;
    const hud = document.querySelector(HUD_GOLD_SELECTOR); // Used as the narrow observation target; this does not watch the whole document.
    if (!hud || typeof MutationObserver !== 'function') return;
    hudGoldObserver = new MutationObserver(() => applyHudCurrencyPresentation()); // Used only when child content changes, such as farm-panel's legacy textContent refresh.
    hudGoldObserver.observe(hud, { childList: true });
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
      image.crossOrigin = 'anonymous';
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
    if (!(tab instanceof Element) || tab.dataset.menuTabIconOnly === '4') return false;
    const panelId = String(tab.dataset.mpanel || ''); // Used to select a dedicated PNG, loadout composite, or the existing emoji fallback.
    const label = visibleLabel(tab); // Shared visible and accessible destination name.

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

    const textLabel = document.createElement('span'); // Keeps destination names visible alongside their existing artwork.
    textLabel.className = 'menu-tab-label';
    textLabel.textContent = label;
    tab.appendChild(textLabel);
    tab.setAttribute('aria-label', label);
    tab.title = label;
    tab.dataset.menuTabIconOnly = '4';
    debugState.transformed += 1;
    debugState.lastPanel = panelId || null;
    return true;
  }

  function updateMenuContext() {
    const active = document.querySelector(`${TAB_SELECTOR}.active`); // Active destination remains owned by the existing menu implementation.
    if (!active || !menuContext) return;
    const page = MENU_PAGES[active.dataset.mpanel] || ['Menu', '']; // Future plugin destinations retain their authored names.
    const label = active.getAttribute('aria-label') || visibleLabel(active); // Reads the same label shown on the destination button.
    const heading = menuContext.querySelector('strong'); // Reuses context nodes so tab changes do not rebuild a panel.
    const description = menuContext.querySelector('p'); // Explains the selected destination in plain language.
    const location = `${page[0]} › ${label}`; // Visible location helps players distinguish the main page from local sections.
    if (heading.textContent !== location) heading.textContent = location;
    if (description.textContent !== page[1]) description.textContent = page[1];
    for (const tab of document.querySelectorAll(TAB_SELECTOR)) {
      const selected = String(tab === active); // Keeps screen-reader selection synchronized with the menu's active class.
      if (tab.getAttribute('aria-selected') !== selected) tab.setAttribute('aria-selected', selected);
    }
    if (menuContext.dataset.panel !== active.dataset.mpanel) {
      menuContext.dataset.panel = active.dataset.mpanel;
      active.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }

  function organizeMenuTabs() {
    const tabs = document.querySelector('#menuPanel .mp-tabs'); // Keeps all buttons as direct siblings for the controller's existing tab navigator.
    if (!tabs) return;
    const buttons = [...tabs.querySelectorAll('.mp-tab[data-mpanel]')]; // Existing DOM nodes preserve game-owned click handlers and state.
    const order = Object.keys(MENU_PAGES); // Uses one ordering authority for static and late-inserted destinations.
    const sorted = buttons.slice().sort((a, b) => {
      return (order.indexOf(a.dataset.mpanel) < 0 ? order.length : order.indexOf(a.dataset.mpanel))
        - (order.indexOf(b.dataset.mpanel) < 0 ? order.length : order.indexOf(b.dataset.mpanel));
    }); // Unknown destinations retain their relative order at the end.
    if (sorted.some((tab, index) => tab !== buttons[index])) sorted.forEach(tab => tabs.appendChild(tab));
    let previous = null; // Marks each contiguous category boundary without adding extra controller stops.
    for (const tab of sorted) {
      const group = MENU_PAGES[tab.dataset.mpanel]?.[0] || 'Other'; // New destinations receive a neutral category.
      if (group !== previous) {
        if (tab.dataset.menuGroupStart !== group) tab.dataset.menuGroupStart = group;
      } else if (tab.hasAttribute('data-menu-group-start')) tab.removeAttribute('data-menu-group-start');
      previous = group;
    }
    if (!menuContext) {
      menuContext = document.createElement('div');
      menuContext.className = 'menu-page-context';
      menuContext.innerHTML = '<strong></strong><p></p>';
      tabs.closest('.mp-header').after(menuContext);
    }
    updateMenuContext();
  }

  function installDynamicTabObserver() {
    if (menuTabsObserver || typeof MutationObserver !== 'function') return;
    const tabs = document.querySelector('#menuPanel .mp-tabs'); // Only destination insertion and active-class changes need observation.
    if (!tabs) return;
    menuTabsObserver = new MutationObserver(mutations => {
      let added = false; // Reorganizes late destinations once; the stable-order check prevents observer feedback.
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (!(node instanceof Element) || !node.matches(TAB_SELECTOR)) continue;
          if (transformTab(node)) debugState.dynamicTabTransforms += 1;
          added = true;
        }
      }
      if (added) organizeMenuTabs();
      updateMenuContext();
    });
    menuTabsObserver.observe(tabs, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  function transformAll() {
    document.querySelectorAll(TAB_SELECTOR).forEach(transformTab);
    organizeMenuTabs();
    applyWalletCurrencyIcon();
    applyHudCurrencyPresentation();
    installHudCurrencyRepair();
    installDynamicTabObserver();
  }

  function debugSnapshot() {
    const tabs = [...document.querySelectorAll(TAB_SELECTOR)]; // Used to inspect all icon-only tab state without devtools.
    return {
      version: 10,
      transformed: debugState.transformed,
      lastPanel: debugState.lastPanel,
      dynamicTabTransforms: debugState.dynamicTabTransforms,
      dynamicTabObserverInstalled: Boolean(menuTabsObserver),
      totalTabs: tabs.length,
      labeledTabs: tabs.filter(tab => tab.querySelector('.menu-tab-label')).length,
      location: menuContext?.querySelector('strong')?.textContent || '',
      groups: tabs.filter(tab => tab.dataset.menuGroupStart).map(tab => tab.dataset.menuGroupStart),
      labels: Object.fromEntries(tabs.map(tab => [tab.dataset.mpanel || '', tab.getAttribute('aria-label') || ''])),
      customArtPanels: tabs.filter(tab => tab.querySelector('.menu-tab-art')).map(tab => tab.dataset.mpanel || ''),
      relationshipHeartGlowing: !!document.querySelector(`${TAB_SELECTOR}[data-mpanel="relationships"] .relationships-tab-heart`),
      loadoutRasterReady: debugState.loadoutRasterReady,
      loadoutRasterError: debugState.loadoutRasterError,
      loadoutCompositePresent: !!document.querySelector(`${TAB_SELECTOR}[data-mpanel="loadout"] .menu-tab-loadout`),
      walletCurrencyIconApplied: debugState.walletCurrencyIconApplied,
      walletCurrencyIconPresent: !!document.querySelector(`${WALLET_SUFFIX_SELECTOR} .${CURRENCY_ICON_CLASS}`),
      hudCurrencyIconApplied: debugState.hudCurrencyIconApplied,
      hudCurrencyIconPresent: !!document.querySelector(`${HUD_SUFFIX_SELECTOR} .${CURRENCY_ICON_CLASS}`),
      hudCurrencyAmountPreserved: !!hudGoldAmountNode && hudGoldAmountNode.parentNode === document.querySelector(HUD_GOLD_SELECTOR),
      hudCurrencyRepairs: debugState.hudCurrencyRepairs,
      currencyColor: CURRENCY_VERDIGRIS_COLOR,
      currencyGlowColor: CURRENCY_VERDIGRIS_GLOW,
      currencyOutlined: true,
      latestChange: 'Menu destinations now show names, purpose groups and a visible location with a plain-language explanation.',
      currencyIconScale: CURRENCY_ICON_SCALE,
      currencyIconAnchor: 'bottom-left',
    };
  }

  injectStyles();
  preloadLoadoutComposite();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', transformAll, { once: true });
  else transformAll();

  window.HobunjiMenuTabIcons = Object.freeze({ version: 10, refresh: transformAll, debugSnapshot });
  window.__menuTabIconsDebug = debugSnapshot;
})();
