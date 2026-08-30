// Mobile item-wheel category heading continuity + Potion Select presentation parity.
// When an end-of-arch scroll sentinel owns the active pointer, the base item
// category presenter has no active real item slot to read. This adapter keeps
// the last real item category visible, while also making item icon/arc geometry
// use the shared Potion Select presentation as its literal source of truth.
(() => {
  'use strict';
  if (window.ItemArchStickyCategoryHeading?.installed) return;

  const BASE_LABEL_ID = 'itemArchCategoryHeading'; // Used to retarget the normal item-category SVG onto Potion Select's exact heading radius.
  const STICKY_LABEL_ID = 'itemArchStickyCategoryHeading'; // Used for the sentinel-only SVG so the base presenter can keep owning its normal heading ID.
  const PARITY_STYLE_ID = 'itemArchPotionParityStyles'; // Used to install exact Potion Select icon sizing after the shared selector stylesheet exists.
  const FALLBACK_LABEL_OUTSET_PX = 17; // Used only before QuickPotionArcUI publishes its authoritative labelOutsetPx value.
  const GEOMETRY_EPSILON_PX = 0.35; // Used to distinguish real radius drift from harmless dataset rounding.

  let lastSelected = null; // Used only while the item wheel is open to remember the last real item highlighted before an edge sentinel takes focus.
  let observer = null; // Watches transient item-wheel slot recycling while a mobile thumb remains stationary on an edge sentinel.
  let refreshQueued = false; // Coalesces pointer/mutation bursts into one post-layout sticky-heading pass.
  let retryQueued = false; // Allows one follow-up frame when freshly recycled slots have not yet received category/shared-arc metadata.
  let parityStyleInstalled = false; // Prevents duplicate Potion Select parity CSS after the shared selector stylesheet appears.
  let geometryRefreshPending = false; // Prevents repeated shared-arc refresh calls while one exact-radius correction is already queued.

  function itemArcIsOpen() {
    const toolBtn = document.getElementById('toolBtn');
    const itemBtn = document.getElementById('itemBtn');
    if (!toolBtn || !itemBtn) return false;
    if (toolBtn.style.visibility === 'hidden' && itemBtn.style.visibility !== 'hidden') return true;
    return Boolean(document.querySelector('.arc-slot.arc-arrow'))
      && !itemBtn.style.visibility.includes('hidden');
  }

  function potionDiagnostics() {
    return window.QuickPotionArcUI?.diagnostics?.() || null;
  }

  function fallbackOuterRingCenter() {
    const rect = document.getElementById('toolSelect')?.getBoundingClientRect?.();
    return rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: innerWidth, y: innerHeight };
  }

  function potionGeometry() {
    const diagnostics = potionDiagnostics(); // Used as the authoritative center/radius/outset whenever Potion Select is installed.
    const measuredCenter = diagnostics?.outerRingGeometry?.center;
    const radius = Number(diagnostics?.outerRingGeometry?.radius);
    const labelOutsetPx = Number(diagnostics?.labelOutsetPx);
    return {
      center: measuredCenter && Number.isFinite(measuredCenter.x) && Number.isFinite(measuredCenter.y)
        ? { x: measuredCenter.x, y: measuredCenter.y }
        : fallbackOuterRingCenter(),
      radius: Number.isFinite(radius) ? radius : null,
      labelOutsetPx: Number.isFinite(labelOutsetPx) ? labelOutsetPx : FALLBACK_LABEL_OUTSET_PX,
      buttonSize: diagnostics?.buttonSize || 'clamp(22px,4.25vmin,30px)',
    };
  }

  function ensureParityStyles() {
    if (parityStyleInstalled || document.getElementById(PARITY_STYLE_ID)) {
      parityStyleInstalled = true;
      return true;
    }
    if (!document.getElementById('sharedSelectionArcUiStyles')) return false;

    const style = document.createElement('style'); // Loaded after sharedSelectionArcUiStyles so these item-only resets win without altering Potion Select itself.
    style.id = PARITY_STYLE_ID;
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
        background:none !important;
        box-shadow:none !important;
        font-size:.78em !important;
        filter:
          drop-shadow(0 0 2px rgba(var(--item-cat-rgb), 1))
          drop-shadow(0 0 5px rgba(var(--item-cat-rgb), .78)) !important;
        z-index:1;
      }
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

      /* Restore the item category heading treatment from before the parity
         pass: category-coloured fill/glow, but retain the Potion Select font,
         outline, size, and curved-text rendering. */
      #${BASE_LABEL_ID} .quick-potion-curved-category,
      #${STICKY_LABEL_ID} .quick-potion-curved-category {
        fill:var(--item-category-heading-color, #f9e28a) !important;
        stroke:rgba(0,0,0,.82) !important;
        stroke-width:3px !important;
        paint-order:stroke fill !important;
        font-family:'KhymeryyanRomanLetters+Numbers','Pixelify Sans',sans-serif !important;
        font-size:clamp(16px,2.5vmin,24px) !important;
        letter-spacing:.08em !important;
        text-shadow:0 2px 5px rgba(0,0,0,.8) !important;
        filter:drop-shadow(0 0 5px var(--item-category-heading-color, #f9e28a)) !important;
      }
    `;
    document.head.appendChild(style);
    parityStyleInstalled = true;
    return true;
  }

  function sharedTargetCenter(slot) {
    const x = Number.parseFloat(slot?.dataset?.sharedSelectionTargetX || '');
    const y = Number.parseFloat(slot?.dataset?.sharedSelectionTargetY || '');
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    const rect = slot?.getBoundingClientRect?.();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  }

  function outwardLabelPoint(point, center, labelOutsetPx) {
    if (!point) return null;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    return { x: point.x + dx / length * labelOutsetPx, y: point.y + dy / length * labelOutsetPx };
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
        if (Number.isFinite(aa) && Number.isFinite(ba)) return ba - aa;
        return (sharedTargetCenter(a)?.x || 0) - (sharedTargetCenter(b)?.x || 0);
      });
  }

  function syncSlotCategoryVars(slots) {
    slots.forEach(slot => {
      const icon = slot.querySelector('.arc-icon'); // Base category module stores colour vars on the icon; parity decoration needs the exact same values on the slot pseudo-element.
      const color = icon?.style.getPropertyValue('--item-cat-color')?.trim();
      const rgb = icon?.style.getPropertyValue('--item-cat-rgb')?.trim();
      if (color) slot.style.setProperty('--item-cat-color', color);
      if (rgb) slot.style.setProperty('--item-cat-rgb', rgb);
    });
  }

  function removeStickyHeading() {
    document.getElementById(STICKY_LABEL_ID)?.remove();
  }

  function rememberRealSelection(slot) {
    const category = slot?.dataset?.itemCategory;
    const style = window.ItemArchCategoryColors?.colors?.[category];
    if (!slot || !category || !style) return false;
    lastSelected = {
      key: slot.dataset.itemKey || null,
      category,
      categoryLabel: style.label,
      color: style.color,
    };
    return true;
  }

  function categoryCurvePoints(slots, center, labelOutsetPx) {
    let points = slots.map(slot => outwardLabelPoint(sharedTargetCenter(slot), center, labelOutsetPx)).filter(Boolean);
    if (points.length !== 1) return points;

    const slot = slots[0];
    const point = sharedTargetCenter(slot);
    const sharedRadius = Number.parseFloat(slot.dataset.sharedSelectionRadius || ''); // Uses the exact selector radius written by QuickPotionArcUI.
    const radius = Number.isFinite(sharedRadius)
      ? sharedRadius
      : point ? Math.hypot(point.x - center.x, point.y - center.y) : 0;
    const angle = Number.parseFloat(slot.dataset.sharedSelectionAngle || '');
    if (!(radius > 1) || !Number.isFinite(angle)) return [];
    points = [angle + 12, angle - 12].map(deg => {
      const rad = deg * Math.PI / 180;
      return outwardLabelPoint({ x: center.x + Math.cos(rad) * radius, y: center.y - Math.sin(rad) * radius }, center, labelOutsetPx);
    });
    return points;
  }

  function curvePathData(points, center) {
    if (points.length < 2) return null;
    const start = points[0];
    const end = points[points.length - 1];
    const middle = points[Math.floor(points.length / 2)];
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    let control; // Used as the quadratic Bezier control point; formula is copied from quick-potion-arc-ui.js.
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
    return `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
  }

  function retargetHeadingToPotionRadius(svgId, slots) {
    const svg = document.getElementById(svgId);
    const path = svg?.querySelector('path');
    if (!svg || !path || !slots.length) return false;
    const geometry = potionGeometry(); // Exact Potion Select center + category-name arch outset.
    const points = categoryCurvePoints(slots, geometry.center, geometry.labelOutsetPx);
    const d = curvePathData(points, geometry.center);
    if (!d) return false;
    path.setAttribute('d', d);
    return true;
  }

  function selectionRadiusMatchesPotion(slots) {
    const expected = potionGeometry().radius;
    if (!Number.isFinite(expected) || !slots.length) return true;
    return slots.every(slot => {
      const actual = Number.parseFloat(slot.dataset.sharedSelectionRadius || '');
      return !Number.isFinite(actual) || Math.abs(actual - expected) <= GEOMETRY_EPSILON_PX;
    });
  }

  function requestExactSharedGeometry(slots) {
    if (selectionRadiusMatchesPotion(slots) || geometryRefreshPending || !window.QuickPotionArcUI?.refresh) return;
    geometryRefreshPending = true;
    window.QuickPotionArcUI.refresh(); // Shared selector owns slot coordinates; never duplicate or overwrite them here.
    requestAnimationFrame(() => {
      geometryRefreshPending = false;
      queueRefresh();
    });
  }

  function renderStickyHeading(slots) {
    removeStickyHeading();
    if (!lastSelected || !slots.length) return false;

    const geometry = potionGeometry();
    const points = categoryCurvePoints(slots, geometry.center, geometry.labelOutsetPx);
    const d = curvePathData(points, geometry.center);
    if (!d) return false;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); // Kept outside body so the base module's body MutationObserver does not see its own fallback heading as wheel churn.
    svg.id = STICKY_LABEL_ID;
    svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = `position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:203;overflow:visible;--item-category-heading-color:${lastSelected.color};`;

    const pathId = `${STICKY_LABEL_ID}Path`;
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.id = pathId;
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');

    const textNode = document.createElementNS(svg.namespaceURI, 'text');
    textNode.setAttribute('class', 'quick-potion-curved-category');
    const textPath = document.createElementNS(svg.namespaceURI, 'textPath');
    textPath.setAttribute('href', `#${pathId}`);
    textPath.setAttribute('startOffset', '50%');
    textPath.setAttribute('text-anchor', 'middle');
    textPath.textContent = lastSelected.categoryLabel;
    textNode.appendChild(textPath);
    svg.append(path, textNode);
    document.documentElement.appendChild(svg);
    return true;
  }

  function refresh() {
    refreshQueued = false;
    ensureParityStyles();
    if (!itemArcIsOpen()) {
      lastSelected = null;
      removeStickyHeading();
      return;
    }

    const slots = visibleItemSlots();
    syncSlotCategoryVars(slots);
    requestExactSharedGeometry(slots);

    const activeReal = slots.find(slot => slot.classList.contains('arc-active'));
    if (activeReal) {
      rememberRealSelection(activeReal);
      removeStickyHeading();
      retargetHeadingToPotionRadius(BASE_LABEL_ID, slots);
      return;
    }

    const activeEdge = document.querySelector('.arc-slot.arc-arrow.arc-active');
    if (!activeEdge || !lastSelected) {
      removeStickyHeading();
      if (!slots.length && !retryQueued) {
        retryQueued = true;
        requestAnimationFrame(() => { retryQueued = false; queueRefresh(); });
      }
      return;
    }

    renderStickyHeading(slots);
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(refresh);
  }

  function mutationTouchesArc(mutation) {
    if (mutation.target?.nodeType === 1 && mutation.target.closest?.('.arc-slot')) return true;
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes]; // Used to ignore unrelated HUD/body changes while still following recycled item-wheel slots.
    return nodes.some(node => node?.nodeType === 1
      && (node.matches?.('.arc-slot') || node.querySelector?.('.arc-slot')));
  }

  function install() {
    if (observer || !document.body) return;
    observer = new MutationObserver(mutations => {
      if (mutations.some(mutationTouchesArc)) queueRefresh();
    });
    observer.observe(document.body, { subtree: true, childList: true });

    addEventListener('pointermove', queueRefresh, { capture: true, passive: true });
    addEventListener('pointerdown', queueRefresh, { capture: true, passive: true });
    addEventListener('pointerup', queueRefresh, { capture: true, passive: true });
    addEventListener('wheel', queueRefresh, { capture: true, passive: true });
    addEventListener('keydown', queueRefresh, { capture: true, passive: true });
    addEventListener('resize', queueRefresh, { passive: true });
    queueRefresh();
  }

  window.ItemArchStickyCategoryHeading = {
    installed: true,
    refresh: queueRefresh,
    debugSnapshot: () => {
      const slots = visibleItemSlots(); // Used to expose exact parity numbers on mobile without requiring devtools inspection.
      const geometry = potionGeometry();
      const itemSelectionRadii = slots.map(slot => Number.parseFloat(slot.dataset.sharedSelectionRadius || '')).filter(Number.isFinite); // Used to compare the live item-wheel radius against Potion Select's live measured radius.
      const labelRadius = Number.isFinite(geometry.radius) ? geometry.radius + geometry.labelOutsetPx : null; // Used to expose the exact category-name radius implied by Potion Select.
      return {
        itemArcOpen: itemArcIsOpen(),
        stickyVisible: Boolean(document.getElementById(STICKY_LABEL_ID)),
        lastSelected: lastSelected ? { ...lastSelected } : null,
        activeEdge: Boolean(document.querySelector('.arc-slot.arc-arrow.arc-active')),
        potionGeometry: geometry,
        itemSelectionRadii,
        itemCategoryLabelRadius: labelRadius,
        potionCategoryLabelRadius: labelRadius,
        selectionRadiusMatchesPotion: selectionRadiusMatchesPotion(slots),
        potionIconCss: { fontSize: '.78em', mediaMaxPx: 18 },
        parityStyleInstalled,
      };
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
