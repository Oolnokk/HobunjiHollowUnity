// Shared toggled-selection arch presentation.
// Tool, item, ammo, and potion selectors all reuse the permanent outer HUD
// ring's exact center/radius, half-size buttons, and Khymeryyan labels.
(() => {
  'use strict';

  const SELECTOR_MID_DEG = 135; // Keeps every toggled selector centered on the permanent outer-ring quadrant.
  const COMPACT_SWEEP_DEG = 40; // Short selectors retain the approved tight potion spacing.
  const MAX_SWEEP_DEG = 90; // Dense selectors may use the whole 9-to-12-o'clock outer-ring quadrant.
  const TARGET_SLOT_GAP_PX = 58; // Desired center-to-center spacing for dense selector choices.
  const BUTTON_SIZE = 'clamp(22px,4.25vmin,30px)'; // Authoritative diameter for every toggled selector button.
  const BUTTON_DIAMETER_SCALE = 0.50; // Diagnostic/documentation value for the half-size selector rule.
  const LABEL_OUTSET_PX = 17; // Large curved potion-category title keeps its approved button-to-title gap.
  const POTION_MARKER_SELECTOR = '.arc-slot.potion-branch, .arc-slot.potion-category, .arc-slot.potion-cancel';
  const OUTER_ARCH_ID = 'toolSelect'; // Permanent tool/weapon/item/mount ring whose geometry is the selector source of truth.
  const OUTER_RADIUS_REFERENCE_ID = 'toolBtn'; // Canonical outer-ring button used to measure one shared radius.
  const LABEL_ID = 'quickPotionArcCategoryLabel';

  let installed = false; // Guards against duplicate observers/listeners if this module is reloaded.
  let refreshing = false; // Prevents nested structural refreshes while a potion breadcrumb is rewritten as Cancel.
  let frameRunning = false; // One lightweight RAF enforcer runs only while a selector is actually visible.
  let refreshQueued = false; // Coalesces post-input refresh requests into one microtask.
  let currentBranchLabel = ''; // Medicine/Utility heading retained while child categories are open.
  let currentLeafLabel = ''; // Healing/Cures/Buffs/Flasks heading retained while concrete potions are open.
  let lastGeometry = null; // Diagnostic snapshot of the exact center/radius used by every selector button.
  let lastSweepDeg = COMPACT_SWEEP_DEG; // Diagnostic snapshot of the capacity-aware sweep currently in use.

  function log(message, detail) {
    const text = `[selection-arc-ui] ${message}`;
    if (typeof window.__farmLog === 'function') window.__farmLog(detail ? `${text} ${JSON.stringify(detail)}` : text, 'items');
    else if (detail) console.debug(text, detail);
    else console.debug(text);
  }

  function slotLabel(slot) {
    return String(slot?.getAttribute?.('aria-label') || slot?.title || slot?.querySelector?.('.arc-label')?.textContent || slot?.textContent || '')
      .replace(/\s+/g, ' ').trim();
  }

  function elementCenter(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function setImportantStyle(element, property, value) {
    if (!element) return;
    if (element.style.getPropertyValue(property) === value && element.style.getPropertyPriority(property) === 'important') return;
    element.style.setProperty(property, value, 'important'); // Inline authority survives slot recycling/restyling during wheel scroll.
  }

  function outerRingGeometry() {
    const anchor = document.getElementById(OUTER_ARCH_ID); // Zero-size bottom-right anchor shared by the permanent outer HUD ring.
    const anchorRect = anchor?.getBoundingClientRect?.();
    const center = anchorRect
      ? { x: anchorRect.left + anchorRect.width / 2, y: anchorRect.top + anchorRect.height / 2 }
      : { x: innerWidth, y: innerHeight };

    const referenceCenter = elementCenter(document.getElementById(OUTER_RADIUS_REFERENCE_ID)); // Tool button is authored directly on --ar2.
    const measuredRadius = referenceCenter ? Math.hypot(referenceCenter.x - center.x, referenceCenter.y - center.y) : 0;
    const fallbackRadius = innerWidth / 32 * 10; // Mirrors #toolSelect --ar2: calc(10 * var(--col)).
    const radius = measuredRadius > 8 ? measuredRadius : fallbackRadius;
    lastGeometry = { center, radius, referenceButton:OUTER_RADIUS_REFERENCE_ID, measured:measuredRadius > 8 };
    return lastGeometry;
  }

  function selectorSweepDeg(count, radius) {
    if (count <= 4) return COMPACT_SWEEP_DEG;
    const ratio = Math.min(0.95, TARGET_SLOT_GAP_PX / (2 * Math.max(1, radius)));
    const stepDeg = 2 * Math.asin(ratio) * 180 / Math.PI; // Converts desired chord spacing to angular spacing at this exact radius.
    return Math.min(MAX_SWEEP_DEG, Math.max(COMPACT_SWEEP_DEG, stepDeg * Math.max(1, count - 1)));
  }

  function selectorAngleRad(index, count, sweepDeg) {
    const t = count <= 1 ? 0.5 : index / (count - 1); // One-entry selectors remain centered rather than sticking to one end.
    const start = SELECTOR_MID_DEG + sweepDeg / 2;
    const end = SELECTOR_MID_DEG - sweepDeg / 2;
    return (start + (end - start) * t) * Math.PI / 180;
  }

  function activeSelectionSlots() {
    return [...document.querySelectorAll('.arc-slot')].filter(slot => {
      const style = getComputedStyle(slot); // Retired hierarchy slots can briefly coexist while a category repopulates.
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05;
    });
  }

  function enforceSlotPresentation(slot, dense) {
    slot.classList.add('shared-selection-slot');
    slot.classList.toggle('shared-selection-dense', dense);
    setImportantStyle(slot, 'position', 'fixed');
    setImportantStyle(slot, 'width', BUTTON_SIZE);
    setImportantStyle(slot, 'height', BUTTON_SIZE);
    setImportantStyle(slot, 'border-width', '1px');
    setImportantStyle(slot, 'gap', '1px');
    setImportantStyle(slot, 'overflow', 'visible');
    setImportantStyle(slot, 'box-shadow', '0 2px 7px rgba(0,0,0,.42)');
    setImportantStyle(slot, 'transition', 'transform .08s, background .08s, border-color .08s, opacity .12s');
  }

  function layoutSharedSelector(slots) {
    if (!slots.length) return;
    const { center, radius } = outerRingGeometry(); // One center + one scalar radius for every button, every frame.
    const sweepDeg = selectorSweepDeg(slots.length, radius);
    const dense = slots.length >= 6;
    lastSweepDeg = sweepDeg;

    slots.forEach((slot, index) => {
      enforceSlotPresentation(slot, dense);
      const angle = selectorAngleRad(index, slots.length, sweepDeg); // Slot order, never current rendered geometry, determines angular placement.
      const left = center.x + Math.cos(angle) * radius;
      const top = center.y - Math.sin(angle) * radius; // Screen Y grows downward while authored ring angles grow upward.
      setImportantStyle(slot, 'left', `${left}px`);
      setImportantStyle(slot, 'top', `${top}px`);
      slot.dataset.sharedSelectionRadius = radius.toFixed(2);
      slot.dataset.sharedSelectionAngle = (angle * 180 / Math.PI).toFixed(2);
    });
  }

  function makeBranchCancel(slot) {
    if (!slot || slot.dataset.quickPotionCancel === '1') return;
    slot.dataset.quickPotionCancel = '1';
    slot.classList.add('potion-cancel', 'quick-potion-category-cancel');
    slot.setAttribute('aria-label', 'Cancel');
    slot.title = 'Cancel';
    slot.innerHTML = '<span class="quick-potion-cancel-icon" aria-hidden="true">✕</span><span class="arc-label">Cancel</span>';
  }

  function setOuterArchHidden(hidden) {
    document.body.classList.toggle('shared-selection-arc-open', Boolean(hidden)); // visibility:hidden preserves measurable outer-ring geometry.
  }

  function removeCurvedLabel() {
    document.getElementById(LABEL_ID)?.remove();
  }

  function curvedLabelText(slots) {
    const hasConcreteItems = slots.some(slot => slot.classList.contains('potion-cancel'))
      && !slots.some(slot => slot.classList.contains('potion-category'));
    if (hasConcreteItems) return currentLeafLabel || currentBranchLabel;

    const branch = slots.find(slot => slot.classList.contains('potion-branch'));
    const hasChildCategories = slots.some(slot => slot.classList.contains('potion-category'));
    if (branch && hasChildCategories) {
      const branchName = branch.classList.contains('medicine') ? 'Medicine'
        : branch.classList.contains('utility') ? 'Utility' : slotLabel(branch);
      currentBranchLabel = branchName;
      return branchName;
    }
    return '';
  }

  function outwardLabelPoint(point, center) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    return { x:point.x + dx / length * LABEL_OUTSET_PX, y:point.y + dy / length * LABEL_OUTSET_PX };
  }

  function renderCurvedPotionLabel(slots) {
    removeCurvedLabel();
    const text = curvedLabelText(slots);
    if (!text || slots.length < 2) return;

    const { center } = outerRingGeometry();
    const points = slots.map(slot => outwardLabelPoint(elementCenter(slot), center));
    const start = points[0];
    const end = points[points.length - 1];
    const middle = points[Math.floor(points.length / 2)];
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    let control;
    if (points.length >= 3) {
      control = { x:2 * middle.x - mx, y:2 * middle.y - my };
    } else {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      let nx = -dy / length;
      let ny = dx / length;
      if ((center.x - mx) * nx + (center.y - my) * ny > 0) { nx *= -1; ny *= -1; }
      const span = Math.hypot(dx, dy);
      control = { x:mx + nx * Math.min(30, span * 0.16), y:my + ny * Math.min(30, span * 0.16) };
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = LABEL_ID;
    svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:203;overflow:visible;';
    const pathId = `${LABEL_ID}Path`;
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.id = pathId;
    path.setAttribute('d', `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`);
    path.setAttribute('fill', 'none');
    const textNode = document.createElementNS(svg.namespaceURI, 'text');
    textNode.setAttribute('class', 'quick-potion-curved-category');
    const textPath = document.createElementNS(svg.namespaceURI, 'textPath');
    textPath.setAttribute('href', `#${pathId}`);
    textPath.setAttribute('startOffset', '50%');
    textPath.setAttribute('text-anchor', 'middle');
    textPath.textContent = text;
    textNode.appendChild(textPath);
    svg.append(path, textNode);
    document.body.appendChild(svg);
  }

  function rememberRemovedPotionSelection(records) {
    for (const record of records) {
      for (const node of record.removedNodes || []) {
        if (!(node instanceof Element)) continue;
        const removed = node.matches?.('.arc-slot') ? [node] : [...node.querySelectorAll?.('.arc-slot') || []];
        const activeLeaf = removed.find(slot => slot.classList.contains('arc-active') && slot.classList.contains('potion-category'));
        if (activeLeaf) currentLeafLabel = slotLabel(activeLeaf).replace(/^[^A-Za-z0-9]+/, '').trim();
        const activeBranch = removed.find(slot => slot.classList.contains('arc-active') && slot.classList.contains('potion-branch'));
        if (activeBranch) currentBranchLabel = activeBranch.classList.contains('medicine') ? 'Medicine'
          : activeBranch.classList.contains('utility') ? 'Utility' : slotLabel(activeBranch);
      }
    }
  }

  function recordTouchesSelectionArc(record) {
    if (record.target instanceof Element && record.target.closest('.arc-slot')) return true;
    return [...record.addedNodes, ...record.removedNodes].some(node =>
      node instanceof Element && (node.matches?.('.arc-slot') || node.querySelector?.('.arc-slot'))
    );
  }

  function startFrameEnforcer() {
    if (frameRunning) return;
    frameRunning = true;
    const frame = () => {
      const slots = activeSelectionSlots();
      if (!slots.length) {
        frameRunning = false;
        setOuterArchHidden(false);
        return;
      }
      // This intentionally does only geometry/size. It does not rebuild labels or
      // touch observer configuration, so recycled scroll slots are corrected before
      // paint without creating a MutationObserver feedback loop.
      setOuterArchHidden(true);
      layoutSharedSelector(slots);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const slots = activeSelectionSlots();
      if (!slots.length) {
        setOuterArchHidden(false);
        removeCurvedLabel();
        return;
      }

      setOuterArchHidden(true);
      const potionOpen = slots.some(slot => slot.matches(POTION_MARKER_SELECTOR));
      if (potionOpen) {
        const branchSlot = slots.find(slot => slot.classList.contains('potion-branch'));
        const hasChildCategories = slots.some(slot => slot.classList.contains('potion-category'));
        if (branchSlot && hasChildCategories) makeBranchCancel(branchSlot);
      }

      layoutSharedSelector(slots);
      if (potionOpen) renderCurvedPotionLabel(slots);
      else removeCurvedLabel();
      startFrameEnforcer();
    } finally {
      refreshing = false;
    }
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      refresh(); // Runs after the current wheel/key event has finished mutating/recycling selector slots.
    });
  }

  function install() {
    if (installed) return;
    installed = true;

    const style = document.createElement('style');
    style.id = 'sharedSelectionArcUiStyles';
    style.textContent = `
      body.shared-selection-arc-open #${OUTER_ARCH_ID} {
        visibility:hidden !important;
        pointer-events:none !important;
      }
      .arc-slot {
        position:fixed !important;
        width:${BUTTON_SIZE} !important;
        height:${BUTTON_SIZE} !important;
        border-width:1px !important;
        gap:1px !important;
        overflow:visible !important;
        box-shadow:0 2px 7px rgba(0,0,0,.42) !important;
        transition:transform .08s, background .08s, border-color .08s, opacity .12s !important;
      }
      .arc-slot .arc-icon { font-size:.78em !important; }
      .arc-slot .arc-icon img,
      .arc-slot .arc-icon canvas,
      .arc-slot .arc-icon svg { max-width:18px !important; max-height:18px !important; }
      .arc-slot .category-x { inset:-3px !important; font-size:1.15em !important; }
      .arc-slot .cure-family-grid { width:16px !important; height:16px !important; }
      .arc-slot .cure-family { font-size:4px !important; }
      .arc-slot .cure-family.active { font-size:6px !important; }
      .arc-slot .cure-family.severe { font-size:8px !important; }
      .arc-slot .cure-family-x { font-size:.9em !important; }
      .arc-slot .arc-label {
        position:absolute;
        left:50%; top:calc(100% + 3px);
        transform:translateX(-50%);
        width:max-content;
        max-width:110px;
        color:#f9e28a;
        font-family:'KhymeryyanRomanLetters+Numbers','Pixelify Sans',sans-serif;
        font-size:clamp(9px,1.25vmin,11px);
        line-height:1;
        letter-spacing:.04em;
        text-transform:none;
        text-align:center;
        white-space:nowrap;
        pointer-events:none;
        text-shadow:-1px -1px 0 rgba(0,0,0,.9), 1px -1px 0 rgba(0,0,0,.9), -1px 1px 0 rgba(0,0,0,.9), 1px 1px 0 rgba(0,0,0,.9), 0 2px 4px rgba(0,0,0,.9);
      }
      .arc-slot.shared-selection-dense .arc-label {
        width:72px;
        max-width:72px;
        white-space:normal;
        line-height:.92;
        text-wrap:balance;
      }
      .quick-potion-category-cancel .quick-potion-cancel-icon { font-size:.82em; line-height:1; }
      .quick-potion-curved-category {
        fill:#f9e28a; stroke:rgba(0,0,0,.82); stroke-width:3px; paint-order:stroke fill;
        font-family:'KhymeryyanRomanLetters+Numbers','Pixelify Sans',sans-serif;
        font-size:clamp(16px,2.5vmin,24px); letter-spacing:.08em;
        text-shadow:0 2px 5px rgba(0,0,0,.8);
      }
    `;
    document.head.appendChild(style);

    // Structural changes are safe to observe. Attribute observation was removed:
    // reacting to the selector's own style/class rewrites could recursively starve
    // the event loop when the item wheel recycled slots during scrolling.
    new MutationObserver(records => {
      const relevantRecords = records.filter(recordTouchesSelectionArc);
      if (!relevantRecords.length) return;
      rememberRemovedPotionSelection(relevantRecords);
      scheduleRefresh();
    }).observe(document.body, { childList:true, subtree:true });

    // Scroll/key navigation can recycle existing slot nodes without adding/removing
    // DOM children. A post-event microtask refresh catches that path without watching
    // attributes, and the RAF enforcer keeps geometry authoritative before paint.
    addEventListener('wheel', scheduleRefresh, { capture:true, passive:true });
    addEventListener('keydown', scheduleRefresh, { capture:true, passive:true });
    addEventListener('resize', scheduleRefresh, { passive:true });

    refresh();
    window.QuickPotionArcUI = Object.freeze({
      diagnostics: () => ({
        installed,
        currentBranchLabel,
        currentLeafLabel,
        outerRingGeometry:lastGeometry,
        selectorMidDeg:SELECTOR_MID_DEG,
        selectorSweepDeg:lastSweepDeg,
        buttonDiameterScale:BUTTON_DIAMETER_SCALE,
        buttonSize:BUTTON_SIZE,
        labelOutsetPx:LABEL_OUTSET_PX,
        outerArchHidden:document.body.classList.contains('shared-selection-arc-open'),
        selectorRadii:[...document.querySelectorAll('.arc-slot')].map(slot => Number(slot.dataset.sharedSelectionRadius)),
        frameEnforcerRunning:frameRunning,
      }),
      refresh:scheduleRefresh,
    });
    log('installed', { selectorMidDeg:SELECTOR_MID_DEG, buttonDiameterScale:BUTTON_DIAMETER_SCALE, labelOutsetPx:LABEL_OUTSET_PX });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
