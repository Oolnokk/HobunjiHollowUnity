// Bold, grouped category treatment for the item-selection arch.
// Uses canonical ITEM_DEFS/inventoryItems metadata for both color and order,
// while leaving selection/consumption behavior owned by game.js.
(() => {
  'use strict';
  if (window.ItemArchCategoryColors?.installed) return;

  const CATEGORY_STYLES = Object.freeze({ // Used as the one palette/order source for sorting, halos, headings, and diagnostics.
    seed:            { order: 10,  color: '#7CFF4F', rgb: '124,255,79',  label: 'Seeds' },
    berry:           { order: 20,  color: '#FF5AA5', rgb: '255,90,165',  label: 'Berries' },
    crop:            { order: 30,  color: '#FFD23F', rgb: '255,210,63',  label: 'Crops' },
    forage:          { order: 40,  color: '#6EE7A8', rgb: '110,231,168', label: 'Forage' },
    fish:            { order: 50,  color: '#31E6FF', rgb: '49,230,255',  label: 'Fish & Seafood' },
    livestock:       { order: 60,  color: '#FFB86C', rgb: '255,184,108', label: 'Livestock' },
    animalProduct:   { order: 70,  color: '#FFE6A7', rgb: '255,230,167', label: 'Animal Products' },
    feed:            { order: 80,  color: '#A8D96E', rgb: '168,217,110', label: 'Feed' },
    ingredient:      { order: 90,  color: '#FF9F43', rgb: '255,159,67',  label: 'Ingredients' },
    meal:            { order: 100, color: '#FF5A5F', rgb: '255,90,95',   label: 'Prepared Food' },
    drink:           { order: 110, color: '#F4C542', rgb: '244,197,66',  label: 'Drinks' },
    reagent:         { order: 120, color: '#B56DFF', rgb: '181,109,255', label: 'Reagents' },
    restorative:     { order: 130, color: '#4DE7FF', rgb: '77,231,255',  label: 'Restoratives' },
    tonic:           { order: 140, color: '#8F7CFF', rgb: '143,124,255', label: 'Tonics' },
    narcotic:        { order: 150, color: '#E65CFF', rgb: '230,92,255',  label: 'Narcotics' },
    flask:           { order: 160, color: '#FF416C', rgb: '255,65,108',  label: 'Flasks' },
    breedingPotion:  { order: 170, color: '#FF77B7', rgb: '255,119,183', label: 'Livestock Potions' },
    wood:            { order: 180, color: '#C98A4B', rgb: '201,138,75',  label: 'Wood' },
    mineral:         { order: 190, color: '#5CC8FF', rgb: '92,200,255',  label: 'Stone & Ore' },
    organicMaterial: { order: 200, color: '#B7D36B', rgb: '183,211,107', label: 'Organic Materials' },
    material:        { order: 210, color: '#B9C7D8', rgb: '185,199,216', label: 'Materials' },
    processed:       { order: 220, color: '#FF4FD8', rgb: '255,79,216',  label: 'Processed Goods' },
    furniture:       { order: 230, color: '#FF8A2A', rgb: '255,138,42',  label: 'Furniture' },
    tool:            { order: 240, color: '#70A1FF', rgb: '112,161,255', label: 'Tools' },
    recipe:          { order: 250, color: '#F5D98B', rgb: '245,217,139', label: 'Recipes & Blueprints' },
    technique:       { order: 260, color: '#00F5D4', rgb: '0,245,212',   label: 'Technique Scrolls' },
    key:             { order: 270, color: '#F4F0FF', rgb: '244,240,255', label: 'Key & Quest Items' },
    special:         { order: 280, color: '#D7C6FF', rgb: '215,198,255', label: 'Special Items' },
    other:           { order: 999, color: '#A9B4C3', rgb: '169,180,195', label: 'Other' },
  });

  const CATEGORY_ALIASES = Object.freeze({ // Used only as a broad authored-cat fallback after more specific metadata has had first refusal.
    seed: 'seed', seeds: 'seed',
    crop: 'crop', crops: 'crop',
    livestock: 'livestock',
    food: 'ingredient', consumable: 'ingredient', ingredient: 'ingredient',
    processed: 'processed', crafted: 'processed', cooked: 'meal',
    material: 'material', materials: 'material', mats: 'material',
    furniture: 'furniture', decor: 'furniture',
    tool: 'tool', tools: 'tool',
    reagent: 'reagent', alchemy: 'reagent',
    key: 'key', quest: 'key',
  });

  const ALCOHOL_RE = /\b(alcohol|wine|sake|vodka|nectar|airag|liquor|spirits?|beer|ale|mead|cider)\b/;
  const WOOD_RE = /\b(wood|log|lumber|timber|branch|plank)\b/;
  const MINERAL_RE = /\b(stone|rock|ore|mineral|metal|ingot|bar|copper|bronze|iron|verdigris)\b/;
  const ANIMAL_PRODUCT_RE = /\b(milk|curds?|cheese|wool|venom|stink oil|dew|egg|hide|leather|feather)\b/;
  const RECIPE_RE = /\b(recipe|blueprint|plan|schematic)\b/;
  const LABEL_ID = 'itemArchCategoryHeading';
  const LABEL_OUTSET_PX = 17; // Matches quick-potion-arc-ui.js's curved selector heading outset.

  let itemDeps = {}; // Used to merge ITEM_DEFS/inventoryItems/inventory helpers supplied by existing game modules.
  let observer = null; // Used to recolor/relabel when the transient selection arc is built or removed.
  let refreshQueued = false; // Used to coalesce DOM/input bursts into one pre-paint category pass.
  let lastSnapshot = []; // Used by the mobile-friendly debug API to report what the player can currently see.
  let lastGroupedOrder = []; // Used by diagnostics to verify the real canonical selectable order.
  let lastGroupedAt = 0; // Used by diagnostics to distinguish boot grouping from later item-registration regrouping.
  let hookedSharedArc = false; // Prevents wrapping window._desktopSelectionArc.openItem more than once.

  function normalize(value) {
    return String(value || '').replace(/[_/\\-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function tagsFor(definition) {
    return Array.isArray(definition?.tags) ? definition.tags.map(normalize).filter(Boolean) : [];
  }

  function descriptorFor(key, definition) {
    return normalize([key, definition?.label, ...tagsFor(definition)].filter(Boolean).join(' '));
  }

  function hasTag(tags, ...needles) {
    return needles.some(needle => tags.some(tag => tag === needle || tag.includes(needle)));
  }

  function authoredCategory(definition) {
    const explicit = normalize(definition?.itemArchCategory);
    if (CATEGORY_STYLES[explicit]) return explicit;
    const cat = normalize(definition?.cat);
    return CATEGORY_ALIASES[cat] || (CATEGORY_STYLES[cat] ? cat : '');
  }

  function categoryForDefinition(key, definition = {}) {
    const tags = tagsFor(definition); // Used as the richest cross-system metadata source without maintaining item-key lists.
    const descriptor = descriptorFor(key, definition); // Used only as a final compatibility fallback for old/static definitions.
    const authored = authoredCategory(definition); // Broad Inventory cat remains the last-resort structural hint.

    if (definition.techniqueScrollTier || hasTag(tags, 'technique scroll')) return 'technique';
    if (definition.alchemyRecipeScrollId || hasTag(tags, 'recipe', 'blueprint') || RECIPE_RE.test(descriptor)) return 'recipe';

    if (definition.alchemyRecipeId || hasTag(tags, 'potion', 'flask', 'alchemy')) {
      const drive = ['restore', 'greaten', 'lighten', 'afflict'].find(value => tags.includes(value));
      const useMode = normalize(definition.useMode);
      if (useMode === 'throw' || hasTag(tags, 'flask')) return 'flask';
      if (useMode === 'livestock' || hasTag(tags, 'livestock potion')) return 'breedingPotion';
      if (drive === 'restore') return 'restorative';
      if (drive === 'greaten' || drive === 'lighten') return 'tonic';
      if (drive === 'afflict') return 'narcotic';
      if (hasTag(tags, 'reagent')) return 'reagent';
      if (hasTag(tags, 'potion')) return 'tonic';
    }

    if (hasTag(tags, 'reagent')) return 'reagent';
    if (ALCOHOL_RE.test(descriptor)) return 'drink';
    if (definition.isCookedFood) return 'meal';
    if (hasTag(tags, 'seed', 'plantable') || authored === 'seed') return 'seed';
    if (hasTag(tags, 'fish', 'mollusk', 'seafood')) return 'fish';
    if (hasTag(tags, 'berry')) return 'berry';
    if (hasTag(tags, 'fodder', 'feed')) return 'feed';

    if (authored === 'livestock' || hasTag(tags, 'livestock', 'animal crate', 'creature item')) return 'livestock';
    if (hasTag(tags, 'animal product', 'dairy', 'wool') || ANIMAL_PRODUCT_RE.test(descriptor)) return 'animalProduct';

    if (authored === 'crop' || hasTag(tags, 'crop', 'produce')) return 'crop';
    if (hasTag(tags, 'forage', 'forageable', 'wild herb')) return 'forage';

    if (definition.cookingCategories?.length) {
      const tier = normalize(definition.cookingProcessingTier);
      if (tier && tier !== 'raw') return 'processed';
      return 'ingredient';
    }
    if (hasTag(tags, 'meal', 'dish', 'prepared food')) return 'meal';
    if (hasTag(tags, 'ingredient', 'food', 'consumable')) return 'ingredient';

    if (WOOD_RE.test(descriptor)) return 'wood';
    if (MINERAL_RE.test(descriptor)) return 'mineral';
    if (hasTag(tags, 'organic')) return 'organicMaterial';

    if (authored) return authored;
    if (hasTag(tags, 'special')) return 'special';
    return 'other';
  }

  function injectStyles() {
    if (document.getElementById('itemArchCategoryColorStyles')) return;
    const style = document.createElement('style'); // Used to keep all category presentation decoupled from the shared HUD stylesheet.
    style.id = 'itemArchCategoryColorStyles';
    style.textContent = `
      .arc-slot[data-item-category] .arc-icon {
        --item-cat-color: #A9B4C3;
        --item-cat-rgb: 169,180,195;
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
      #${LABEL_ID} .quick-potion-curved-category {
        filter: drop-shadow(0 0 5px var(--item-category-heading-color, #f9e28a));
      }
      @media (prefers-reduced-motion: reduce) {
        .arc-slot[data-item-category] .arc-icon { transition: none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function itemIndex() {
    const byLabel = new Map(); // Used to resolve transient arc labels back to canonical item keys without modifying game.js's arc builder.
    const defs = itemDeps.ITEM_DEFS || {};
    (itemDeps.inventoryItems || []).forEach(entry => {
      const key = entry?.key;
      if (!key) return;
      const definition = defs[key] || {};
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

  function itemArcIsOpen() {
    const toolBtn = document.getElementById('toolBtn');
    const itemBtn = document.getElementById('itemBtn');
    if (!toolBtn || !itemBtn) return false;
    if (toolBtn.style.visibility === 'hidden' && itemBtn.style.visibility !== 'hidden') return true;
    return Boolean(document.querySelector('.arc-slot.arc-arrow'))
      && !itemBtn.style.visibility.includes('hidden');
  }

  function clearSlot(slot) {
    delete slot.dataset.itemCategory;
    delete slot.dataset.itemKey;
    delete slot.dataset.itemCategoryLabel;
    const icon = slot.querySelector('.arc-icon');
    icon?.style.removeProperty('--item-cat-color');
    icon?.style.removeProperty('--item-cat-rgb');
  }

  function removeCurvedCategoryLabel() {
    document.getElementById(LABEL_ID)?.remove();
  }

  function sharedTargetCenter(slot) {
    const x = Number.parseFloat(slot?.dataset?.sharedSelectionTargetX || '');
    const y = Number.parseFloat(slot?.dataset?.sharedSelectionTargetY || '');
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    const rect = slot?.getBoundingClientRect?.();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  }

  function outerRingCenter() {
    const anchor = document.getElementById('toolSelect');
    const rect = anchor?.getBoundingClientRect?.();
    return rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: innerWidth, y: innerHeight };
  }

  function outwardLabelPoint(point, center) {
    if (!point) return null;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    return { x: point.x + dx / length * LABEL_OUTSET_PX, y: point.y + dy / length * LABEL_OUTSET_PX };
  }

  function visibleItemSlots() {
    return [...document.querySelectorAll('.arc-slot[data-item-category]:not(.arc-arrow):not(.shared-selection-exit-ghost)')]
      .filter(slot => {
        const style = getComputedStyle(slot);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      })
      .sort((a, b) => {
        const aa = Number.parseFloat(a.dataset.sharedSelectionAngle || '');
        const ba = Number.parseFloat(b.dataset.sharedSelectionAngle || '');
        if (Number.isFinite(aa) && Number.isFinite(ba)) return ba - aa; // Left-to-right around the 9-to-12 o'clock selector quadrant.
        return (sharedTargetCenter(a)?.x || 0) - (sharedTargetCenter(b)?.x || 0);
      });
  }

  function renderCurvedCategoryLabel() {
    removeCurvedCategoryLabel();
    if (!itemArcIsOpen()) return;
    const slots = visibleItemSlots();
    const active = slots.find(slot => slot.classList.contains('arc-active'));
    const category = active?.dataset?.itemCategory;
    const categoryStyle = CATEGORY_STYLES[category];
    if (!active || !categoryStyle) return;

    const center = outerRingCenter();
    let points = slots.map(slot => outwardLabelPoint(sharedTargetCenter(slot), center)).filter(Boolean);

    // Potion Select normally has 2+ slots. Preserve the same curved treatment for
    // a one-item inventory by synthesizing a short tangent span around that slot.
    if (points.length === 1) {
      const point = sharedTargetCenter(active);
      const radius = point ? Math.hypot(point.x - center.x, point.y - center.y) : 0;
      const angle = Number.parseFloat(active.dataset.sharedSelectionAngle || '');
      if (!(radius > 1) || !Number.isFinite(angle)) return;
      points = [angle + 12, angle - 12].map(deg => {
        const rad = deg * Math.PI / 180;
        return outwardLabelPoint({ x: center.x + Math.cos(rad) * radius, y: center.y - Math.sin(rad) * radius }, center);
      });
    }
    if (points.length < 2) return;

    const start = points[0];
    const end = points[points.length - 1];
    const middle = points[Math.floor(points.length / 2)];
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    let control;
    if (points.length >= 3) {
      control = { x: 2 * middle.x - mx, y: 2 * middle.y - my };
    } else {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      let nx = -dy / length;
      let ny = dx / length;
      if ((center.x - mx) * nx + (center.y - my) * ny > 0) { nx *= -1; ny *= -1; }
      const span = Math.hypot(dx, dy);
      control = { x: mx + nx * Math.min(30, span * 0.16), y: my + ny * Math.min(30, span * 0.16) };
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = LABEL_ID;
    svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = `position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:203;overflow:visible;--item-category-heading-color:${categoryStyle.color};`;

    const pathId = `${LABEL_ID}Path`;
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.id = pathId;
    path.setAttribute('d', `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`);
    path.setAttribute('fill', 'none');

    const textNode = document.createElementNS(svg.namespaceURI, 'text');
    textNode.setAttribute('class', 'quick-potion-curved-category');
    textNode.setAttribute('fill', categoryStyle.color);
    const textPath = document.createElementNS(svg.namespaceURI, 'textPath');
    textPath.setAttribute('href', `#${pathId}`);
    textPath.setAttribute('startOffset', '50%');
    textPath.setAttribute('text-anchor', 'middle');
    textPath.textContent = categoryStyle.label;
    textNode.appendChild(textPath);
    svg.append(path, textNode);
    document.body.appendChild(svg);
  }

  function colorItemSlots() {
    if (!itemArcIsOpen()) {
      document.querySelectorAll('.arc-slot[data-item-category]').forEach(clearSlot);
      lastSnapshot = [];
      removeCurvedCategoryLabel();
      return;
    }

    const byLabel = itemIndex();
    const snapshot = [];
    document.querySelectorAll('.arc-slot:not(.arc-arrow):not(.shared-selection-exit-ghost)').forEach(slot => {
      const label = slot.querySelector('.arc-label')?.textContent || '';
      const item = byLabel.get(normalize(label));
      if (!item) { clearSlot(slot); return; }
      const category = categoryForDefinition(item.key, item.definition);
      const style = CATEGORY_STYLES[category] || CATEGORY_STYLES.other;
      const icon = slot.querySelector('.arc-icon');
      if (!icon) return;

      slot.dataset.itemCategory = category;
      slot.dataset.itemKey = item.key;
      slot.dataset.itemCategoryLabel = style.label;
      icon.style.setProperty('--item-cat-color', style.color);
      icon.style.setProperty('--item-cat-rgb', style.rgb);
      snapshot.push({ key: item.key, label, category, categoryLabel: style.label, color: style.color, active: slot.classList.contains('arc-active') });
    });
    lastSnapshot = snapshot;
    renderCurvedCategoryLabel();
  }

  function compareEntries(a, b) {
    const defs = itemDeps.ITEM_DEFS || {};
    const aDef = defs[a?.key] || {};
    const bDef = defs[b?.key] || {};
    const aCategory = categoryForDefinition(a?.key, aDef);
    const bCategory = categoryForDefinition(b?.key, bDef);
    const aStyle = CATEGORY_STYLES[aCategory] || CATEGORY_STYLES.other;
    const bStyle = CATEGORY_STYLES[bCategory] || CATEGORY_STYLES.other;
    return aStyle.order - bStyle.order
      || String(aDef.label || a?.label || a?.key || '').localeCompare(String(bDef.label || b?.label || b?.key || ''));
  }

  function currentRuntimeOwnedKeys() {
    const defs = itemDeps.ITEM_DEFS || {};
    const inventory = itemDeps.inventory || {};
    const inventoryItems = itemDeps.inventoryItems || [];
    const rank = new Map(inventoryItems.map((entry, index) => [entry?.key, index]));
    return Object.keys(inventory)
      .filter(key => key !== 'gold' && defs[key] && Number(inventory[key]) > 0)
      .sort((a, b) => (rank.get(a) ?? 9999) - (rank.get(b) ?? 9999)
        || String(defs[a]?.label || a).localeCompare(String(defs[b]?.label || b)));
  }

  function ensureOwnedInventoryEntries() {
    const defs = itemDeps.ITEM_DEFS || {};
    const inventory = itemDeps.inventory || {};
    const inventoryItems = itemDeps.inventoryItems;
    if (!Array.isArray(inventoryItems)) return;
    const known = new Set(inventoryItems.map(entry => entry?.key).filter(Boolean));
    Object.keys(inventory).forEach(key => {
      if (key === 'gold' || known.has(key) || !defs[key] || !(Number(inventory[key]) > 0)) return;
      const definition = defs[key];
      inventoryItems.push({
        key,
        icon: definition.icon || '□',
        label: String(definition.label || key).toUpperCase(),
        max: 99,
      });
      known.add(key);
    });
  }

  function rotateOwnedToPreserveIndex(entries, activeKey, targetIndex) {
    if (!entries.length || !activeKey || targetIndex < 0) return entries;
    const currentIndex = entries.findIndex(entry => entry?.key === activeKey);
    if (currentIndex < 0 || currentIndex === targetIndex) return entries;
    const shift = (currentIndex - targetIndex + entries.length) % entries.length;
    return entries.slice(shift).concat(entries.slice(0, shift));
  }

  function groupInventoryItems() {
    const inventoryItems = itemDeps.inventoryItems;
    const defs = itemDeps.ITEM_DEFS;
    const inventory = itemDeps.inventory;
    if (!Array.isArray(inventoryItems) || !defs || !inventory) return false;

    const activeKey = itemDeps.getActiveInventoryItem?.()?.key || null; // Used to preserve game.js's private activeItemIndex across a reorder.
    const beforeOwnedKeys = currentRuntimeOwnedKeys(); // Mirrors game.js's getInventoryStackKeys('all') ordering.
    const targetIndex = activeKey ? beforeOwnedKeys.indexOf(activeKey) : -1;

    ensureOwnedInventoryEntries();

    const ownedEntries = [];
    const unownedEntries = [];
    const seen = new Set();
    inventoryItems.forEach(entry => {
      if (!entry?.key || seen.has(entry.key)) return;
      seen.add(entry.key);
      ((Number(inventory[entry.key]) > 0 && defs[entry.key]) ? ownedEntries : unownedEntries).push(entry);
    });

    ownedEntries.sort(compareEntries);
    unownedEntries.sort(compareEntries);
    const rotatedOwned = rotateOwnedToPreserveIndex(ownedEntries, activeKey, targetIndex);
    inventoryItems.splice(0, inventoryItems.length, ...rotatedOwned, ...unownedEntries);

    lastGroupedOrder = rotatedOwned.map(entry => {
      const definition = defs[entry.key] || {};
      const category = categoryForDefinition(entry.key, definition);
      return { key: entry.key, label: definition.label || entry.label || entry.key, category, categoryLabel: (CATEGORY_STYLES[category] || CATEGORY_STYLES.other).label };
    });
    lastGroupedAt = Date.now();
    return true;
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
    groupInventoryItems();
    queueRefresh();
  }

  function hookInit(api) {
    if (!api?.init || api.__itemArchCategoryColorsHooked) return;
    const originalInit = api.init.bind(api); // Used to preserve each owning module's initialization while observing its injected inventory metadata.
    api.init = (deps, ...rest) => {
      const result = originalInit(deps, ...rest); // Lets modules register dynamic item definitions before the first category/order pass.
      captureItemDeps(deps);
      return result;
    };
    api.__itemArchCategoryColorsHooked = true;
  }

  function hookSharedSelectionArc() {
    const arc = window._desktopSelectionArc;
    if (!arc?.openItem || hookedSharedArc) return false;
    const originalOpenItem = arc.openItem.bind(arc); // Used so every keyboard/controller/touch item-wheel open is grouped before game.js builds slots.
    const originalScrollItem = typeof arc.scrollItem === 'function' ? arc.scrollItem.bind(arc) : null; // Used to refresh the curved heading after controller/keyboard item movement.
    arc.openItem = (...args) => {
      groupInventoryItems();
      const result = originalOpenItem(...args);
      queueRefresh();
      return result;
    };
    if (originalScrollItem) {
      arc.scrollItem = (...args) => {
        const result = originalScrollItem(...args);
        queueRefresh();
        return result;
      };
    }
    hookedSharedArc = true;
    return true;
  }

  function installObserver() {
    if (observer || !document.body) return;
    groupInventoryItems();
    colorItemSlots();
    observer = new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.type === 'childList')) queueRefresh();
    });
    observer.observe(document.body, { subtree: true, childList: true });

    // Active selection changes do not rebuild the arc. These events update the
    // curved category heading and active halo without observing every HUD class.
    addEventListener('pointermove', queueRefresh, { capture: true, passive: true });
    addEventListener('wheel', queueRefresh, { capture: true, passive: true });
    addEventListener('keydown', event => {
      if (event.key === 'Tab') groupInventoryItems(); // Keeps tap/keyboard cycling on the same grouped canonical order.
      queueRefresh();
    }, { capture: true, passive: true });

    const itemBtn = document.getElementById('itemBtn');
    itemBtn?.addEventListener('pointerdown', () => groupInventoryItems(), { capture: true, passive: true });

    document.addEventListener('hobunjiPlayerReady', () => {
      groupInventoryItems();
      hookSharedSelectionArc();
      queueRefresh();
    });
    addEventListener('resize', queueRefresh, { passive: true });

    // _desktopSelectionArc is created inside game.js after this module loads.
    // Retry briefly at DOM-ready/player-ready without introducing a timer loop.
    hookSharedSelectionArc();
    queueMicrotask(hookSharedSelectionArc);
  }

  function bootstrap() {
    injectStyles();
    hookInit(window.CookingSystem);
    hookInit(window.FarmCrates);
    hookInit(window.AlchemySystem);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installObserver, { once: true });
    else installObserver();
  }

  window.ItemArchCategoryColors = {
    installed: true,
    colors: CATEGORY_STYLES,
    categoryFor: key => categoryForDefinition(key, itemDeps.ITEM_DEFS?.[key] || {}),
    regroup: groupInventoryItems,
    refresh: queueRefresh,
    debugSnapshot: () => {
      colorItemSlots();
      return {
        ready: Boolean(itemDeps.ITEM_DEFS && itemDeps.inventoryItems && itemDeps.inventory),
        observing: Boolean(observer),
        sharedArcHooked: hookedSharedArc,
        curvedCategory: document.querySelector(`#${LABEL_ID} textPath`)?.textContent || null,
        visibleSlots: lastSnapshot.map(entry => ({ ...entry })),
        groupedAt: lastGroupedAt || null,
        groupedOrder: lastGroupedOrder.map(entry => ({ ...entry })),
        categories: Object.fromEntries(Object.entries(CATEGORY_STYLES).map(([key, value]) => [key, { ...value }])),
      };
    },
  };

  bootstrap();
})();
