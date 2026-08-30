// Bold category color treatment for the item-selection arc.
// Uses the inventory's existing ITEM_DEFS.cat metadata, so item selection
// stays presentation-only and does not duplicate inventory/category logic.
(() => {
  'use strict';
  if (window.ItemArchCategoryColors?.installed) return;

  const CATEGORY_STYLES = Object.freeze({ // Used to keep the item-arch palette centralized and inspectable.
    seed:      { color: '#7CFF4F', rgb: '124,255,79',  label: 'Seeds' },
    crop:      { color: '#FFD23F', rgb: '255,210,63',  label: 'Crops' },
    material:  { color: '#00D9FF', rgb: '0,217,255',   label: 'Materials' },
    furniture: { color: '#FF8A2A', rgb: '255,138,42',  label: 'Furniture' },
    processed: { color: '#FF4FD8', rgb: '255,79,216',  label: 'Processed' },
    food:      { color: '#FF5A5F', rgb: '255,90,95',   label: 'Food' },
    alchemy:   { color: '#A970FF', rgb: '169,112,255', label: 'Alchemy' },
    special:   { color: '#F4F0FF', rgb: '244,240,255', label: 'Special' },
    other:     { color: '#B9C7D8', rgb: '185,199,216', label: 'Other' },
  });
  const CATEGORY_ALIASES = Object.freeze({ // Used to fold newer/specialized item cats into the visible Pack color families.
    seeds: 'seed',
    crops: 'crop',
    mats: 'material',
    materials: 'material',
    decor: 'furniture',
    crafted: 'processed',
    cooked: 'processed',
    consumable: 'food',
    ingredient: 'food',
    reagent: 'alchemy',
    potion: 'alchemy',
    key: 'special',
    quest: 'special',
  });

  let itemDeps = {}; // Used to merge ITEM_DEFS/inventoryItems supplied by existing game modules without exposing game.js internals.
  let observer = null; // Used to recolor item slots whenever the transient selection arc is rebuilt while dragging/scrolling.
  let refreshQueued = false; // Used to coalesce mutation bursts into one pre-paint category pass.
  let lastSnapshot = []; // Used by the mobile-friendly debug API to report what the player can currently see.

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function injectStyles() {
    if (document.getElementById('itemArchCategoryColorStyles')) return;
    const style = document.createElement('style'); // Used to keep all category presentation decoupled from the shared HUD stylesheet.
    style.id = 'itemArchCategoryColorStyles';
    style.textContent = `
      .arc-slot[data-item-category] .arc-icon {
        --item-cat-color: #B9C7D8;
        --item-cat-rgb: 185,199,216;
        position: relative;
        display: inline-grid !important;
        place-items: center;
        min-width: 1.72em;
        min-height: 1.72em;
        box-sizing: border-box;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(var(--item-cat-rgb), .58) 0 52%, rgba(var(--item-cat-rgb), .20) 67%, rgba(var(--item-cat-rgb), 0) 72%);
        box-shadow:
          0 0 0 3px rgba(var(--item-cat-rgb), .96),
          0 0 15px 5px rgba(var(--item-cat-rgb), .68),
          inset 0 0 10px rgba(var(--item-cat-rgb), .42);
      }
      .arc-slot[data-item-category] .arc-label {
        color: var(--item-cat-color) !important;
        text-shadow: 0 1px 2px #000, 0 0 7px rgba(var(--item-cat-rgb), .92);
        font-weight: 800;
      }
      .arc-slot[data-item-category].arc-active .arc-icon {
        box-shadow:
          0 0 0 3px #fff,
          0 0 0 7px rgba(var(--item-cat-rgb), 1),
          0 0 24px 9px rgba(var(--item-cat-rgb), .90),
          inset 0 0 12px rgba(var(--item-cat-rgb), .55);
      }
      @media (prefers-reduced-motion: reduce) {
        .arc-slot[data-item-category] .arc-icon { transition: none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function categoryFromTags(definition) {
    const tags = Array.isArray(definition?.tags) ? definition.tags.map(normalize) : []; // Used only when an item lacks the canonical ITEM_DEFS.cat field.
    if (tags.some(tag => tag.includes('reagent') || tag.includes('alchemy') || tag.includes('potion'))) return 'alchemy';
    if (tags.some(tag => tag.includes('furniture') || tag.includes('decor'))) return 'furniture';
    if (tags.some(tag => tag.includes('food') || tag.includes('ingredient') || tag.includes('consumable'))) return 'food';
    if (tags.some(tag => tag.includes('seed'))) return 'seed';
    if (tags.some(tag => tag.includes('crop') || tag.includes('produce'))) return 'crop';
    if (tags.some(tag => tag.includes('processed') || tag.includes('crafted'))) return 'processed';
    if (tags.some(tag => tag.includes('quest') || tag.includes('key item') || tag.includes('special'))) return 'special';
    return 'other';
  }

  function categoryForDefinition(definition) {
    const authored = normalize(definition?.cat); // Used as the authoritative category whenever ITEM_DEFS already provides one.
    const category = CATEGORY_ALIASES[authored] || authored;
    if (CATEGORY_STYLES[category]) return category;
    if (definition?.isCookedFood) return 'processed';
    if (definition?.cookingCategories?.length) return 'food';
    return categoryFromTags(definition);
  }

  function itemIndex() {
    const byLabel = new Map(); // Used to resolve transient arc labels back to canonical item keys without modifying game.js's arc builder.
    const defs = itemDeps.ITEM_DEFS || {}; // Used as the canonical source of item category metadata.
    (itemDeps.inventoryItems || []).forEach(entry => {
      const key = entry?.key; // Used to join the inventory display entry to its ITEM_DEFS record.
      if (!key) return;
      const definition = defs[key] || {}; // Used to read the item's existing cat/tags without introducing a parallel category table.
      [entry.label, definition.label].forEach(label => {
        const normalized = normalize(label);
        if (normalized && !byLabel.has(normalized)) byLabel.set(normalized, { key, definition });
      });
    });
    Object.entries(defs).forEach(([key, definition]) => {
      const normalized = normalize(definition?.label);
      if (normalized && !byLabel.has(normalized)) byLabel.set(normalized, { key, definition });
    });
    return byLabel;
  }

  function clearSlot(slot) {
    delete slot.dataset.itemCategory;
    delete slot.dataset.itemKey;
    delete slot.dataset.itemCategoryLabel;
    const icon = slot.querySelector('.arc-icon'); // Used to remove stale CSS variables when a recycled/rebuilt slot stops resolving as an item.
    icon?.style.removeProperty('--item-cat-color');
    icon?.style.removeProperty('--item-cat-rgb');
  }

  function colorItemSlots() {
    const byLabel = itemIndex(); // Used for this one refresh so all visible slots share a single metadata lookup table.
    const snapshot = []; // Used to replace the exported debug snapshot atomically after each recolor pass.
    document.querySelectorAll('.arc-slot:not(.arc-arrow)').forEach(slot => {
      const label = slot.querySelector('.arc-label')?.textContent || ''; // Used to distinguish transient item slots from tool-selection slots sharing .arc-slot.
      const item = byLabel.get(normalize(label));
      if (!item) { clearSlot(slot); return; }
      const category = categoryForDefinition(item.definition); // Used to select the single bold palette entry for this canonical item definition.
      const style = CATEGORY_STYLES[category] || CATEGORY_STYLES.other; // Used as a neutral fallback for future categories that have no authored palette yet.
      const icon = slot.querySelector('.arc-icon'); // Used as the visual host so the label/slot hit behavior remains untouched.
      if (!icon) return;

      slot.dataset.itemCategory = category;
      slot.dataset.itemKey = item.key;
      slot.dataset.itemCategoryLabel = style.label;
      icon.style.setProperty('--item-cat-color', style.color);
      icon.style.setProperty('--item-cat-rgb', style.rgb);
      snapshot.push({ key: item.key, label, category, color: style.color, active: slot.classList.contains('arc-active') });
    });
    lastSnapshot = snapshot;
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      colorItemSlots();
    });
  }

  function captureItemDeps(deps) {
    if (!deps || typeof deps !== 'object') return;
    itemDeps = { ...itemDeps, ...deps };
    queueRefresh();
  }

  function hookInit(api) {
    if (!api?.init || api.__itemArchCategoryColorsHooked) return;
    const originalInit = api.init.bind(api); // Used to preserve each owning module's initialization while observing the same injected inventory metadata.
    api.init = (deps, ...rest) => {
      const result = originalInit(deps, ...rest); // Used to let modules register dynamic item definitions before the first category lookup.
      captureItemDeps(deps);
      return result;
    };
    api.__itemArchCategoryColorsHooked = true;
  }

  function installObserver() {
    if (observer || !document.body) return;
    colorItemSlots();
    observer = new MutationObserver(queueRefresh);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
    });
    window.addEventListener('hobunjiPlayerReady', queueRefresh);
  }

  function bootstrap() {
    injectStyles();
    hookInit(window.CookingSystem);
    hookInit(window.FarmCrates);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installObserver, { once: true });
    else installObserver();
  }

  window.ItemArchCategoryColors = {
    installed: true,
    colors: CATEGORY_STYLES,
    refresh: queueRefresh,
    debugSnapshot: () => {
      colorItemSlots();
      return {
        ready: Boolean(itemDeps.ITEM_DEFS && itemDeps.inventoryItems),
        observing: Boolean(observer),
        visibleSlots: lastSnapshot.map(entry => ({ ...entry })),
        categories: Object.fromEntries(Object.entries(CATEGORY_STYLES).map(([key, value]) => [key, { ...value }])),
      };
    },
  };

  bootstrap();
})();
