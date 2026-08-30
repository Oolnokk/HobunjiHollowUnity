// Final presentation/geometry pass for the grouped item selector.
// Item icons keep their pre-feature sizing, the category heading is a fixed
// screen-space Potion Select-style label, and the item wheel sits slightly
// inside the shared selector radius without changing Potion Select itself.
(() => {
  'use strict';
  if (window.ItemArchOriginalPresentation?.installed) return;

  const STYLE_ID = 'itemArchOriginalPresentationStyles'; // Keeps this final override idempotent if the HUD bootstrap is re-evaluated.
  const FIXED_HEADING_ID = 'itemArchFixedCategoryHeading'; // Owns the only visible item-category heading; unlike the legacy headings its path never follows moving item nodes.
  const ITEM_RADIUS_INSET_PX = 6; // Pulls only Item Select inward by a deliberately tiny amount.
  const FIXED_HEADING_MID_DEG = 135; // Matches the shared selector quadrant center.
  const FIXED_HEADING_SWEEP_DEG = 40; // Fixed Potion Select-style heading span; remaining constant prevents desktop text jitter.
  const FALLBACK_LABEL_OUTSET_PX = 17; // Mirrors QuickPotionArcUI before its diagnostics are available.

  let frameRunning = false; // Runs only while Item Select is open so recycled/moving slots retain the tiny inward offset.
  let refreshQueued = false; // Coalesces input/mutation bursts into one pre-paint refresh.
  let observer = null; // Notices transient item-wheel creation/removal without watching unrelated attributes.
  let lastCategoryLabel = ''; // Keeps the last real item category visible while an end-scroll sentinel owns selection.

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Higher specificity beats earlier item-only presentation layers without changing shared selector rules.
    style.id = STYLE_ID;
    style.textContent = `
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
        background:none !important;
        box-shadow:none !important;
        filter:none !important;
        z-index:auto !important;
      }

      /* Earlier category modules still maintain their internal headings for
         selection state, but only this fixed screen-space heading is visible. */
      html #itemArchCategoryHeading,
      html #itemArchStickyCategoryHeading {
        visibility:hidden !important;
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

  function itemArcIsOpen() {
    const toolBtn = document.getElementById('toolBtn');
    const itemBtn = document.getElementById('itemBtn');
    if (!toolBtn || !itemBtn) return false;
    if (toolBtn.style.visibility === 'hidden' && itemBtn.style.visibility !== 'hidden') return true;
    return Boolean(document.querySelector('.arc-slot.arc-arrow'))
      && !itemBtn.style.visibility.includes('hidden');
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
    const fallback = fallbackGeometry();
    const center = diagnostics?.outerRingGeometry?.center;
    const radius = Number(diagnostics?.outerRingGeometry?.radius);
    const labelOutsetPx = Number(diagnostics?.labelOutsetPx);
    return {
      center: center && Number.isFinite(center.x) && Number.isFinite(center.y) ? { x: center.x, y: center.y } : fallback.center,
      radius: Number.isFinite(radius) && radius > 1 ? radius : fallback.radius,
      labelOutsetPx: Number.isFinite(labelOutsetPx) ? labelOutsetPx : fallback.labelOutsetPx,
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
      slot.classList.add('item-select-radius-inset');
      slot.style.setProperty('--item-select-inset-x', `${dx.toFixed(3)}px`);
      slot.style.setProperty('--item-select-inset-y', `${dy.toFixed(3)}px`);
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
    if (active?.dataset?.itemCategoryLabel) lastCategoryLabel = active.dataset.itemCategoryLabel;
    return lastCategoryLabel;
  }

  function updateFixedHeading(slots, geometry) {
    const label = selectedCategoryLabel(slots);
    if (!label) { removeFixedHeading(); return; }
    const svg = ensureFixedHeading();
    svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    svg.querySelector('path')?.setAttribute('d', fixedHeadingPathData(geometry));
    const textPath = svg.querySelector('textPath');
    if (textPath && textPath.textContent !== label) textPath.textContent = label;
  }

  function updateOpenPresentation() {
    if (!itemArcIsOpen()) {
      lastCategoryLabel = '';
      clearRadiusInsets();
      removeFixedHeading();
      return false;
    }
    const geometry = sharedGeometry();
    const slots = realItemSlots();
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

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      if (updateOpenPresentation()) startFrameLoop();
    });
  }

  function mutationTouchesArc(mutation) {
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.some(node => node?.nodeType === 1
      && (node.matches?.('.arc-slot') || node.querySelector?.('.arc-slot')));
  }

  function installRuntimeHooks() {
    if (observer || !document.body) return;
    observer = new MutationObserver(mutations => {
      if (mutations.some(mutationTouchesArc)) queueRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    addEventListener('pointermove', queueRefresh, { capture: true, passive: true });
    addEventListener('pointerdown', queueRefresh, { capture: true, passive: true });
    addEventListener('pointerup', queueRefresh, { capture: true, passive: true });
    addEventListener('wheel', queueRefresh, { capture: true, passive: true });
    addEventListener('keydown', queueRefresh, { capture: true, passive: true });
    addEventListener('resize', queueRefresh, { passive: true });
    queueRefresh();
  }

  function debugSnapshot() {
    const activeIcon = document.querySelector('.arc-slot[data-item-category].arc-active .arc-icon')
      || document.querySelector('.arc-slot[data-item-category] .arc-icon');
    const iconStyle = activeIcon ? getComputedStyle(activeIcon) : null;
    const geometry = sharedGeometry();
    const heading = document.querySelector(`#${FIXED_HEADING_ID} .quick-potion-curved-category`);
    const headingStyle = heading ? getComputedStyle(heading) : null;
    return {
      installed: true,
      styleInstalled: Boolean(document.getElementById(STYLE_ID)),
      itemArcOpen: itemArcIsOpen(),
      itemRadiusInsetPx: ITEM_RADIUS_INSET_PX,
      sharedSelectionRadius: geometry.radius,
      visualItemSelectionRadius: geometry.radius - ITEM_RADIUS_INSET_PX,
      fixedHeadingRadius: geometry.radius - ITEM_RADIUS_INSET_PX + geometry.labelOutsetPx,
      fixedHeadingSweepDeg: FIXED_HEADING_SWEEP_DEG,
      fixedHeadingText: document.querySelector(`#${FIXED_HEADING_ID} textPath`)?.textContent || null,
      icon: iconStyle ? { fontSize: iconStyle.fontSize, display: iconStyle.display, width: iconStyle.width, height: iconStyle.height, filter: iconStyle.filter } : null,
      heading: headingStyle ? { fill: headingStyle.fill, stroke: headingStyle.stroke, fontFamily: headingStyle.fontFamily, fontSize: headingStyle.fontSize, filter: headingStyle.filter } : null,
    };
  }

  window.ItemArchOriginalPresentation = {
    installed: true,
    refresh: queueRefresh,
    debugSnapshot,
  };

  installStyles();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installRuntimeHooks, { once: true });
  else installRuntimeHooks();
})();
