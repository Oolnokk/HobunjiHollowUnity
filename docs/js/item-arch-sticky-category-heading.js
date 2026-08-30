// Mobile item-wheel category heading continuity.
// When an end-of-arch scroll sentinel owns the active pointer, the base item
// category presenter has no active real item slot to read. This adapter keeps
// the last real item category visible until another real item is highlighted.
(() => {
  'use strict';
  if (window.ItemArchStickyCategoryHeading?.installed) return;

  const STICKY_LABEL_ID = 'itemArchStickyCategoryHeading'; // Used for the sentinel-only SVG so the base presenter can keep owning its normal heading ID.
  const LABEL_OUTSET_PX = 17; // Matches Potion Select and item-arch-category-colors.js.

  let lastSelected = null; // Used only while the item wheel is open to remember the last real item highlighted before an edge sentinel takes focus.
  let observer = null; // Watches transient item-wheel slot recycling while a mobile thumb remains stationary on an edge sentinel.
  let refreshQueued = false; // Coalesces pointer/mutation bursts into one post-layout sticky-heading pass.
  let retryQueued = false; // Allows one follow-up frame when the base category module has not yet decorated freshly recycled slots.

  function itemArcIsOpen() {
    const toolBtn = document.getElementById('toolBtn');
    const itemBtn = document.getElementById('itemBtn');
    if (!toolBtn || !itemBtn) return false;
    if (toolBtn.style.visibility === 'hidden' && itemBtn.style.visibility !== 'hidden') return true;
    return Boolean(document.querySelector('.arc-slot.arc-arrow'))
      && !itemBtn.style.visibility.includes('hidden');
  }

  function sharedTargetCenter(slot) {
    const x = Number.parseFloat(slot?.dataset?.sharedSelectionTargetX || '');
    const y = Number.parseFloat(slot?.dataset?.sharedSelectionTargetY || '');
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    const rect = slot?.getBoundingClientRect?.();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  }

  function outerRingCenter() {
    const rect = document.getElementById('toolSelect')?.getBoundingClientRect?.();
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
        if (Number.isFinite(aa) && Number.isFinite(ba)) return ba - aa;
        return (sharedTargetCenter(a)?.x || 0) - (sharedTargetCenter(b)?.x || 0);
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

  function categoryCurvePoints(slots, center) {
    let points = slots.map(slot => outwardLabelPoint(sharedTargetCenter(slot), center)).filter(Boolean);
    if (points.length !== 1) return points;

    const slot = slots[0];
    const point = sharedTargetCenter(slot);
    const radius = point ? Math.hypot(point.x - center.x, point.y - center.y) : 0;
    const angle = Number.parseFloat(slot.dataset.sharedSelectionAngle || '');
    if (!(radius > 1) || !Number.isFinite(angle)) return [];
    points = [angle + 12, angle - 12].map(deg => {
      const rad = deg * Math.PI / 180;
      return outwardLabelPoint({ x: center.x + Math.cos(rad) * radius, y: center.y - Math.sin(rad) * radius }, center);
    });
    return points;
  }

  function renderStickyHeading(slots) {
    removeStickyHeading();
    if (!lastSelected || !slots.length) return false;

    const center = outerRingCenter();
    const points = categoryCurvePoints(slots, center);
    if (points.length < 2) return false;

    const start = points[0];
    const end = points[points.length - 1];
    const middle = points[Math.floor(points.length / 2)];
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    let control; // Used as the quadratic Bezier control point for the same arch-aligned text shape as Potion Select.
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

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); // Kept outside body so the base module's body MutationObserver does not see its own fallback heading as wheel churn.
    svg.id = STICKY_LABEL_ID;
    svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = `position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:203;overflow:visible;--item-category-heading-color:${lastSelected.color};`;

    const pathId = `${STICKY_LABEL_ID}Path`;
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.id = pathId;
    path.setAttribute('d', `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`);
    path.setAttribute('fill', 'none');

    const textNode = document.createElementNS(svg.namespaceURI, 'text');
    textNode.setAttribute('class', 'quick-potion-curved-category');
    textNode.setAttribute('fill', lastSelected.color);
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
    if (!itemArcIsOpen()) {
      lastSelected = null;
      removeStickyHeading();
      return;
    }

    const slots = visibleItemSlots();
    const activeReal = slots.find(slot => slot.classList.contains('arc-active'));
    if (activeReal) {
      rememberRealSelection(activeReal);
      removeStickyHeading();
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

  function install() {
    if (observer || !document.body) return;
    observer = new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.type === 'childList')) queueRefresh();
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
    debugSnapshot: () => ({
      itemArcOpen: itemArcIsOpen(),
      stickyVisible: Boolean(document.getElementById(STICKY_LABEL_ID)),
      lastSelected: lastSelected ? { ...lastSelected } : null,
      activeEdge: Boolean(document.querySelector('.arc-slot.arc-arrow.arc-active')),
    }),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
