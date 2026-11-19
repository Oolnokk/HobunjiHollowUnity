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
    technique:       { order: 260, color: '#00F5D4', rgb: '0,245,212',   label: 'Combat Lessons' },
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
  const FIXED_HEADING_ID = 'itemArchFixedCategoryHeading'; // The single fixed Potion Select-style category label.
  const ITEM_RADIUS_INSET_PX = 6; // Item Select alone sits six pixels inside the common selector ring.
  const FIXED_HEADING_MID_DEG = 135; // Stable centre of the category title's quadratic arc.
  const FIXED_HEADING_SWEEP_DEG = 40; // Constant title arc prevents desktop jitter.
  const FALLBACK_LABEL_OUTSET_PX = 17; // Used before QuickPotionArcUI exposes its measured text outset.
  const GEOMETRY_EPSILON_PX = 0.35; // Avoid pointless geometry refreshes from rounding alone.

  let itemDeps = {}; // Used to merge ITEM_DEFS/inventoryItems/inventory helpers supplied by existing game modules.
  let observer = null; // Used to recolor/relabel when the transient selection arc is built or removed.
  let refreshQueued = false; // Used to coalesce DOM/input bursts into one pre-paint category pass.
  let lastSnapshot = []; // Used by the mobile-friendly debug API to report what the player can currently see.
  let frameRunning = false; // The sole bounded animation owner while the item selector is open.
  let lastCategoryLabel = ''; // Retains the last real selection through mobile edge sentinels.
  let lastSelected = null; // Previous real category, used by the mobile debug view and edge scrolling.
  let lastGeometryRequest = null; // Suppresses repeated requests when potion geometry cannot yet change.
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

    if (definition.masteryUnlock || definition.techniqueScrollTier || definition.combatManualAbilityId || hasTag(tags, 'technique scroll', 'combat manual')) return 'technique';
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
    const style = document.createElement('style'); // The only item-arch style owner; loaded before the wheel and scoped to its slots.
    style.id = 'itemArchCategoryColorStyles';
    style.textContent = `
      /* Keep the category treatment bold without changing Potion Select's
         authoritative icon dimensions. The earlier 1.72em disc enlarged the
         item glyph and made the wheel read as a different radius. */
      .arc-slot[data-item-category] .arc-icon,
      .arc-slot[data-item-category].arc-active .arc-icon {
        min-width:0 !important;
        min-height:0 !important;
        width:auto !important;
        height:auto !important;
        display:inline-block !important;
        box-sizing:content-box !important;
        border-radius:0 !important;
        box-shadow:none !important;
        font-size:.78em !important;
        filter:
          drop-shadow(0 0 2px rgba(var(--item-cat-rgb), 1))
          drop-shadow(0 0 5px rgba(var(--item-cat-rgb), .78)) !important;
        z-index:1;
      }
      /* Emoji reset must not erase item sprites installed as background images. */
      .arc-slot[data-item-category] .arc-icon:not(.sprited-icon) { background:none !important; }
      .arc-slot[data-item-category] .arc-icon img,
      .arc-slot[data-item-category] .arc-icon canvas,
      .arc-slot[data-item-category] .arc-icon svg {
        max-width:18px !important;
        max-height:18px !important;
      }

      /* Category colour now lives around the potion-sized slot rather than
         enlarging the icon itself. Pseudo-element decoration never affects
         layout, hit testing, slot diameter, or selector radius. */
      .arc-slot[data-item-category]::before {
        content:'';
        position:absolute;
        inset:-1px;
        border:2px solid rgba(var(--item-cat-rgb), .96);
        border-radius:50%;
        background:radial-gradient(circle, rgba(var(--item-cat-rgb), .24) 0 58%, rgba(var(--item-cat-rgb), .06) 72%, transparent 76%);
        box-shadow:0 0 9px rgba(var(--item-cat-rgb), .72), inset 0 0 7px rgba(var(--item-cat-rgb), .28);
        pointer-events:none;
        z-index:0;
      }
      .arc-slot[data-item-category] .arc-label { z-index:1; }
      .arc-slot.shared-selection-slot[data-item-category].arc-active:not(.arc-arrow):not(.shared-selection-exit-ghost)::before {
        border-color:#fff;
        box-shadow:
          0 0 0 3px rgba(var(--item-cat-rgb), .98),
          0 0 13px 4px rgba(var(--item-cat-rgb), .78),
          inset 0 0 8px rgba(var(--item-cat-rgb), .34);
      }

      
      .arc-slot[data-item-category] .arc-label {
        color:var(--item-cat-color) !important;
        text-shadow:0 1px 2px #000, 0 0 7px rgba(var(--item-cat-rgb), .92);
        font-weight:800;
      }
      @media (prefers-reduced-motion:reduce) {
        .arc-slot[data-item-category] .arc-icon { transition:none !important; }
      }

      /* Restore the item icon box to its pre-category-feature state. Deliberately
         do NOT set font-size or media max-size here: the game's existing selector
         CSS remains authoritative for the actual icon size. */
      html body .arc-slot.shared-selection-slot[data-item-category] .arc-icon,
      html body .arc-slot.shared-selection-slot[data-item-category].arc-active .arc-icon {
        display:inline !important;
        place-items:normal !important;
        width:auto !important;
        height:auto !important;
        min-width:auto !important;
        min-height:auto !important;
        box-sizing:border-box !important;
        border-radius:0 !important;
        box-shadow:none !important;
        filter:none !important;
        z-index:auto !important;
      }

      /* Leave actual item sprite backgrounds intact while keeping plain glyphs undecorated. */
      html body .arc-slot.shared-selection-slot[data-item-category] .arc-icon:not(.sprited-icon) { background:none !important; }
      html body .arc-slot.shared-selection-slot[data-item-category] .arc-icon.sprited-icon {
        display:inline-block !important;
        width:1.25em !important;
        height:1.25em !important;
        background-size:contain !important;
        background-position:center !important;
        background-repeat:no-repeat !important;
      }
      /* Translate is independent from the shared selector's left/top/scale
         animation, so this changes only Item Select's visual radius. */
      html body .arc-slot.item-select-radius-inset[data-item-category] {
        translate:var(--item-select-inset-x, 0px) var(--item-select-inset-y, 0px) !important;
      }

      /* Visually identical to Potion Select's sharply legible category text. */
      html #${FIXED_HEADING_ID} .quick-potion-curved-category {
        fill:#f9e28a !important;
        stroke:rgba(0,0,0,.82) !important;
        stroke-width:3px !important;
        paint-order:stroke fill !important;
        font-family:'KhymeryyanRomanLetters+Numbers','Pixelify Sans',sans-serif !important;
        font-size:clamp(16px,2.5vmin,24px) !important;
        letter-spacing:.08em !important;
        text-shadow:0 2px 5px rgba(0,0,0,.8) !important;
        filter:none !important;
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
    if (slot.dataset.itemCategory !== undefined) delete slot.dataset.itemCategory;
    if (slot.dataset.itemKey !== undefined) delete slot.dataset.itemKey;
    if (slot.dataset.itemCategoryLabel !== undefined) delete slot.dataset.itemCategoryLabel;
    const icon = slot.querySelector('.arc-icon');
    for (const target of [slot, icon]) {
      if (target?.style.getPropertyValue('--item-cat-color')) target.style.removeProperty('--item-cat-color');
      if (target?.style.getPropertyValue('--item-cat-rgb')) target.style.removeProperty('--item-cat-rgb');
    }
    if (slot.classList.contains('item-select-radius-inset')) {
      slot.classList.remove('item-select-radius-inset');
      slot.style.removeProperty('--item-select-inset-x');
      slot.style.removeProperty('--item-select-inset-y');
    }
  }

  function fallbackGeometry() {
    const anchorRect = document.getElementById('toolSelect')?.getBoundingClientRect?.();
    const center = anchorRect
      ? { x: anchorRect.left + anchorRect.width / 2, y: anchorRect.top + anchorRect.height / 2 }
      : { x: innerWidth, y: innerHeight };
    const toolRect = document.getElementById('toolBtn')?.getBoundingClientRect?.();
    const toolCenter = toolRect ? { x: toolRect.left + toolRect.width / 2, y: toolRect.top + toolRect.height / 2 } : null;
    const radius = toolCenter ? Math.hypot(toolCenter.x - center.x, toolCenter.y - center.y) : innerWidth / 32 * 10;
    return { center, radius, labelOutsetPx: FALLBACK_LABEL_OUTSET_PX };
  }

  function sharedGeometry() {
    const diagnostics = window.QuickPotionArcUI?.diagnostics?.();
    const center = diagnostics?.outerRingGeometry?.center;
    const radius = Number(diagnostics?.outerRingGeometry?.radius);
    const labelOutsetPx = Number(diagnostics?.labelOutsetPx);
    const measuredCenter = center && Number.isFinite(center.x) && Number.isFinite(center.y); // Only unsupported/missing diagnostics need synchronous DOM geometry reads.
    const measuredRadius = Number.isFinite(radius) && radius > 1;
    const measuredOutset = Number.isFinite(labelOutsetPx);
    const fallback = measuredCenter && measuredRadius && measuredOutset ? null : fallbackGeometry(); // Avoid two getBoundingClientRect calls on every open-arch frame.
    return {
      center: measuredCenter ? { x: center.x, y: center.y } : fallback.center,
      radius: measuredRadius ? radius : fallback.radius,
      labelOutsetPx: measuredOutset ? labelOutsetPx : fallback.labelOutsetPx,
    };
  }

  function realItemSlots() {
    return [...document.querySelectorAll('.arc-slot[data-item-category]:not(.arc-arrow):not(.shared-selection-exit-ghost)')]
      .filter(slot => {
        const style = getComputedStyle(slot);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      });
  }

  function slotAngleDeg(slot, center) {
    const authored = Number.parseFloat(slot?.dataset?.sharedSelectionAngle || '');
    if (Number.isFinite(authored)) return authored;
    const x = Number.parseFloat(slot?.dataset?.sharedSelectionTargetX || '');
    const y = Number.parseFloat(slot?.dataset?.sharedSelectionTargetY || '');
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return Math.atan2(-(y - center.y), x - center.x) * 180 / Math.PI;
  }

  function applyTinyRadiusInset(slots, center) {
    slots.forEach(slot => {
      const angleDeg = slotAngleDeg(slot, center);
      if (!Number.isFinite(angleDeg)) return;
      const angle = angleDeg * Math.PI / 180;
      // Shared arc uses x = cx + cos(a)r, y = cy - sin(a)r; the opposite vector moves inward.
      const dx = -Math.cos(angle) * ITEM_RADIUS_INSET_PX;
      const dy = Math.sin(angle) * ITEM_RADIUS_INSET_PX;
      // Compare before writing: the single UI-open RAF may see identical slot geometry across many frames.
      if (!slot.classList.contains('item-select-radius-inset')) slot.classList.add('item-select-radius-inset');
      const insetX = `${dx.toFixed(3)}px`, insetY = `${dy.toFixed(3)}px`;
      if (slot.style.getPropertyValue('--item-select-inset-x') !== insetX) slot.style.setProperty('--item-select-inset-x', insetX);
      if (slot.style.getPropertyValue('--item-select-inset-y') !== insetY) slot.style.setProperty('--item-select-inset-y', insetY);
    });
  }

  function clearRadiusInsets() {
    document.querySelectorAll('.arc-slot.item-select-radius-inset').forEach(slot => {
      slot.classList.remove('item-select-radius-inset');
      slot.style.removeProperty('--item-select-inset-x');
      slot.style.removeProperty('--item-select-inset-y');
    });
  }

  function pointOnArc(angleDeg, center, radius) {
    const angle = angleDeg * Math.PI / 180;
    return { x: center.x + Math.cos(angle) * radius, y: center.y - Math.sin(angle) * radius };
  }

  function fixedHeadingPathData(geometry) {
    const radius = Math.max(1, geometry.radius - ITEM_RADIUS_INSET_PX + geometry.labelOutsetPx);
    const halfSweep = FIXED_HEADING_SWEEP_DEG / 2;
    const start = pointOnArc(FIXED_HEADING_MID_DEG + halfSweep, geometry.center, radius);
    const middle = pointOnArc(FIXED_HEADING_MID_DEG, geometry.center, radius);
    const end = pointOnArc(FIXED_HEADING_MID_DEG - halfSweep, geometry.center, radius);
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    const control = { x: 2 * middle.x - mx, y: 2 * middle.y - my }; // Same quadratic construction used by Potion Select, but from fixed screen-space points.
    return `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
  }

  function ensureFixedHeading() {
    let svg = document.getElementById(FIXED_HEADING_ID);
    if (svg) return svg;
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = FIXED_HEADING_ID;
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:204;overflow:visible;';

    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.id = `${FIXED_HEADING_ID}Path`;
    path.setAttribute('fill', 'none');

    const text = document.createElementNS(svg.namespaceURI, 'text');
    text.setAttribute('class', 'quick-potion-curved-category');
    const textPath = document.createElementNS(svg.namespaceURI, 'textPath');
    textPath.setAttribute('href', `#${FIXED_HEADING_ID}Path`);
    textPath.setAttribute('startOffset', '50%');
    textPath.setAttribute('text-anchor', 'middle');
    text.appendChild(textPath);
    svg.append(path, text);
    document.documentElement.appendChild(svg);
    return svg;
  }

  function removeFixedHeading() {
    document.getElementById(FIXED_HEADING_ID)?.remove();
  }

  function selectedCategoryLabel(slots) {
    const active = slots.find(slot => slot.classList.contains('arc-active'));
    if (active?.dataset?.itemCategoryLabel) {
      lastCategoryLabel = active.dataset.itemCategoryLabel;
      const category = active.dataset.itemCategory; // Saved for the edge-scroll debug view.
      lastSelected = { key: active.dataset.itemKey || null, category, categoryLabel: lastCategoryLabel,
        color: CATEGORY_STYLES[category]?.color || CATEGORY_STYLES.other.color };
    }
    return lastCategoryLabel;
  }

  function updateFixedHeading(slots, geometry) {
    const label = selectedCategoryLabel(slots);
    if (!label) { removeFixedHeading(); return; }
    const svg = ensureFixedHeading();
    // Same every-frame cost as applyTinyRadiusInset above: innerWidth/innerHeight
    // and the path geometry rarely change mid-interaction, so guard both writes.
    const viewBox = `0 0 ${innerWidth} ${innerHeight}`;
    if (svg.getAttribute('viewBox') !== viewBox) svg.setAttribute('viewBox', viewBox);
    const pathEl = svg.querySelector('path');
    const d = fixedHeadingPathData(geometry);
    if (pathEl && pathEl.getAttribute('d') !== d) pathEl.setAttribute('d', d);
    const textPath = svg.querySelector('textPath');
    if (textPath && textPath.textContent !== label) textPath.textContent = label;
  }

  function selectionRadiusMatchesPotion(slots, geometry = sharedGeometry()) {
    if (!Number.isFinite(geometry.radius) || !slots.length) return true;
    return slots.every(slot => {
      const actual = Number.parseFloat(slot.dataset.sharedSelectionRadius || '');
      return !Number.isFinite(actual) || Math.abs(actual - geometry.radius) <= GEOMETRY_EPSILON_PX;
    });
  }

  function requestExactSharedGeometry(slots, geometry) {
    if (selectionRadiusMatchesPotion(slots, geometry)) { lastGeometryRequest = null; return; }
    if (typeof window.QuickPotionArcUI?.refresh !== 'function') return;
    const signature = geometry.radius + ':' + slots.map(slot => slot.dataset.sharedSelectionRadius || '').join('|'); // One attempt per mismatch until the underlying geometry changes.
    if (lastGeometryRequest === signature) return;
    lastGeometryRequest = signature;
    window.QuickPotionArcUI.refresh();
    queueRefresh(); // Re-read selector-owned positions after its refresh; never manually move its hit targets.
  }

  function updateOpenPresentation() {
    if (!itemArcIsOpen()) {
      lastCategoryLabel = '';
      lastSelected = null;
      lastGeometryRequest = null;
      clearRadiusInsets();
      removeFixedHeading();
      return false;
    }
    const geometry = sharedGeometry();
    const slots = realItemSlots();
    requestExactSharedGeometry(slots, geometry); // The shared selector remains the sole owner of actual slot coordinates.
    applyTinyRadiusInset(slots, geometry.center);
    updateFixedHeading(slots, geometry);
    return true;
  }

  function startFrameLoop() {
    if (frameRunning) return;
    frameRunning = true;
    const frame = () => {
      if (!updateOpenPresentation()) {
        frameRunning = false;
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function mutationTouchesArc(mutation) {
    // A recycled slot may update only its label's text children; its own arc node need not be reinserted.
    if (mutation.target?.nodeType === 1 && mutation.target.closest?.('.arc-slot')) return true;
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.some(node => node?.nodeType === 1
      && (node.matches?.('.arc-slot') || node.querySelector?.('.arc-slot')));
  }

  function colorItemSlots() {
    if (!itemArcIsOpen()) {
      document.querySelectorAll('.arc-slot[data-item-category]').forEach(clearSlot);
      lastSnapshot = [];
      updateOpenPresentation(); // Clears the inset and fixed heading as soon as the wheel closes.
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

      // dataset writes go through setAttribute under the hood, which queues a
      // mutation record even for an unchanged value -- guarding these avoids
      // needlessly feeding any other attribute-watching MutationObserver on
      // the page every time this (already frequently-called) pass runs.
      if (slot.dataset.itemCategory !== category) slot.dataset.itemCategory = category;
      if (slot.dataset.itemKey !== item.key) slot.dataset.itemKey = item.key;
      if (slot.dataset.itemCategoryLabel !== style.label) slot.dataset.itemCategoryLabel = style.label;
      if (icon.style.getPropertyValue('--item-cat-color') !== style.color) icon.style.setProperty('--item-cat-color', style.color);
      if (icon.style.getPropertyValue('--item-cat-rgb') !== style.rgb) icon.style.setProperty('--item-cat-rgb', style.rgb);
      // The non-layout halo belongs to the slot, while old icon consumers still read their existing variables.
      if (slot.style.getPropertyValue('--item-cat-color') !== style.color) slot.style.setProperty('--item-cat-color', style.color);
      if (slot.style.getPropertyValue('--item-cat-rgb') !== style.rgb) slot.style.setProperty('--item-cat-rgb', style.rgb);
      snapshot.push({ key: item.key, label, category, categoryLabel: style.label, color: style.color, active: slot.classList.contains('arc-active') });
    });
    lastSnapshot = snapshot;
    updateOpenPresentation(); // Same owner handles category state, six-pixel inset and the only visible heading.
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

  // Returns the first selectable item of the adjacent category in grouped, cyclic inventory order.
  // Going backward lands at the beginning of the previous group, rather than on its final item.
  function nextCategoryIndex(stacks, activeIndex, direction) {
    const count = Array.isArray(stacks) ? stacks.length : 0; // Bounds category jumps to currently owned, wheel-eligible stacks only.
    const step = Math.sign(Number(direction) || 0); // Selects the requested previous/next group without changing ordinary item scrolling.
    const start = Number(activeIndex); // Used to reject stale indices when an inventory stack was just consumed.
    if (count < 2 || !Number.isInteger(start) || start < 0 || start >= count || !step) return -1;
    const defs = itemDeps.ITEM_DEFS || {}; // Uses the same live classifier as item grouping and halo colors.
    const categoryAt = index => categoryForDefinition(stacks[index]?.key, defs[stacks[index]?.key] || {}); // Looks up real item keys, not potentially duplicated display labels.
    const currentCategory = categoryAt(start); // Prevents moving within the current group when the shortcut is pressed.
    let index = start; // Scans across category boundaries in either direction, including the cyclic seam.
    for (let scanned = 0; scanned < count - 1; scanned++) {
      index = (index + step + count) % count;
      if (categoryAt(index) === currentCategory) continue;
      if (step < 0) {
        const targetCategory = categoryAt(index); // Used to land on the previous group's first item.
        let previous = (index - 1 + count) % count; // Advances backward through that entire group's contiguous segment.
        while (previous !== start && categoryAt(previous) === targetCategory) {
          index = previous;
          previous = (index - 1 + count) % count;
        }
      }
      return index;
    }
    return -1; // One category or no other eligible item: keep the current selection unchanged.
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
        icon: itemDeps.itemIconForKey?.(key) || definition.icon || '📦',
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
      if (itemArcIsOpen()) startFrameLoop(); // One existing bounded loop, no parallel sticky/original presenters.
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
    if (itemArcIsOpen()) startFrameLoop();
    observer = new MutationObserver(mutations => {
      if (mutations.some(mutationTouchesArc)) queueRefresh(); // Unrelated HUD/heading mutations no longer rebuild the wheel.
    });
    observer.observe(document.body, { subtree: true, childList: true });

    // Active selection changes do not rebuild the arc. These events update the
    // curved category heading and active halo without observing every HUD class.
    addEventListener('pointermove', () => { if (!frameRunning) queueRefresh(); }, { capture: true, passive: true }); // Active UI-open loop already tracks selection without recataloging every item on pointer movement.
    addEventListener('pointerdown', queueRefresh, { capture: true, passive: true });
    addEventListener('pointerup', queueRefresh, { capture: true, passive: true });
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
    document.getElementById('itemArchCategoryHeading')?.remove(); // Clean up retired duplicate headings if a previous bootstrap ran.
    document.getElementById('itemArchStickyCategoryHeading')?.remove();
    injectStyles();
    hookInit(window.CookingSystem);
    hookInit(window.FarmCrates);
    hookInit(window.AlchemySystem);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installObserver, { once: true });
    else installObserver();
  }

  function presentationDebugSnapshot() {
    const activeIcon = document.querySelector('.arc-slot[data-item-category].arc-active .arc-icon')
      || document.querySelector('.arc-slot[data-item-category] .arc-icon');
    const iconStyle = activeIcon ? getComputedStyle(activeIcon) : null;
    const geometry = sharedGeometry();
    const heading = document.querySelector(`#${FIXED_HEADING_ID} .quick-potion-curved-category`);
    const headingStyle = heading ? getComputedStyle(heading) : null;
    return {
      installed: true,
      styleInstalled: Boolean(document.getElementById('itemArchCategoryColorStyles')),
      itemArcOpen: itemArcIsOpen(),
      itemRadiusInsetPx: ITEM_RADIUS_INSET_PX,
      sharedSelectionRadius: geometry.radius,
      visualItemSelectionRadius: geometry.radius - ITEM_RADIUS_INSET_PX,
      fixedHeadingRadius: geometry.radius - ITEM_RADIUS_INSET_PX + geometry.labelOutsetPx,
      fixedHeadingSweepDeg: FIXED_HEADING_SWEEP_DEG,
      lastSelected: lastSelected ? { ...lastSelected } : null,
      activeEdge: Boolean(document.querySelector('.arc-slot.arc-arrow.arc-active')),
      selectionRadiusMatchesPotion: selectionRadiusMatchesPotion(realItemSlots(), geometry),
      singlePresenter: true,
      frameRunning,
      fixedHeadingText: document.querySelector(`#${FIXED_HEADING_ID} textPath`)?.textContent || null,
      icon: iconStyle ? { fontSize: iconStyle.fontSize, display: iconStyle.display, width: iconStyle.width, height: iconStyle.height, filter: iconStyle.filter } : null,
      heading: headingStyle ? { fill: headingStyle.fill, stroke: headingStyle.stroke, fontFamily: headingStyle.fontFamily, fontSize: headingStyle.fontSize, filter: headingStyle.filter } : null,
    };
  }

  window.ItemArchCategoryColors = {
    installed: true,
    colors: CATEGORY_STYLES,
    categoryFor: key => categoryForDefinition(key, itemDeps.ITEM_DEFS?.[key] || {}),
    nextCategoryIndex, // Used by the shared item wheel's desktop, controller, and touch category shortcuts.
    regroup: groupInventoryItems,
    refresh: queueRefresh,
    debugSnapshot: () => {
      colorItemSlots();
      return {
        ready: Boolean(itemDeps.ITEM_DEFS && itemDeps.inventoryItems && itemDeps.inventory),
        observing: Boolean(observer),
        sharedArcHooked: hookedSharedArc,
        curvedCategory: document.querySelector(`#${FIXED_HEADING_ID} textPath`)?.textContent || null,
        presentation: presentationDebugSnapshot(),
        visibleSlots: lastSnapshot.map(entry => ({ ...entry })),
        groupedAt: lastGroupedAt || null,
        groupedOrder: lastGroupedOrder.map(entry => ({ ...entry })),
        categories: Object.fromEntries(Object.entries(CATEGORY_STYLES).map(([key, value]) => [key, { ...value }])),
      };
    },
  };

  // Old public debug hooks survive, but their modules have no separate observers, CSS or animation loops.
  window.ItemArchStickyCategoryHeading = { installed: true, refresh: queueRefresh,
    debugSnapshot: () => ({ ...presentationDebugSnapshot(),
      stickyVisible: itemArcIsOpen() && Boolean(lastSelected) && Boolean(document.querySelector('.arc-slot.arc-arrow.arc-active')),
      lastSelected: lastSelected ? { ...lastSelected } : null }) };
  window.ItemArchOriginalPresentation = { installed: true, refresh: queueRefresh,
    debugSnapshot: presentationDebugSnapshot };

  bootstrap();
})();
