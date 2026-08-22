// Shared toggled-selection arch presentation.
// Tool, item, ammo, and potion selectors all reuse the permanent outer HUD
// ring's exact center/radius, half-size buttons, and Khymeryyan labels.
(() => {
  'use strict';

  const SELECTOR_MID_DEG = 135; // Centers every toggled selector on the permanent outer-ring quadrant.
  const COMPACT_SWEEP_DEG = 40; // Short selectors retain the tight potion spacing.
  const MAX_SWEEP_DEG = 90; // Dense selectors may use the whole 9-to-12-o'clock quadrant.
  const TARGET_SLOT_GAP_PX = 58; // Desired center-to-center spacing when several real choices are visible.
  const BUTTON_SIZE = 'clamp(22px,4.25vmin,30px)'; // One authoritative diameter for every toggled selector button.
  const BUTTON_DIAMETER_SCALE = 0.50; // Diagnostic value documenting the half-size rule.
  const LABEL_OUTSET_PX = 17; // Curved potion heading stays this far outside button centers.
  const SLOT_MOVE_MS = 135; // Actual choices glide only between positions on the shared radius.
  const POTION_MARKER_SELECTOR = '.arc-slot.potion-branch, .arc-slot.potion-category, .arc-slot.potion-cancel';
  const LEGACY_ARROW_SELECTOR = '.arc-slot.arc-arrow'; // Old item-wheel edge controls remain internal sentinels, never visual choices.
  const OUTER_ARCH_ID = 'toolSelect'; // Permanent tool/weapon/item/mount ring used as the geometry source of truth.
  const OUTER_RADIUS_REFERENCE_ID = 'toolBtn'; // Canonical permanent-ring button used to measure radius.
  const LABEL_ID = 'quickPotionArcCategoryLabel';

  let installed = false; // Prevents duplicate observers/listeners if the script is loaded twice.
  let refreshing = false; // Prevents nested presentation refreshes while a potion breadcrumb is rewritten.
  let frameRunning = false; // One geometry-only RAF runs while a selector is visible.
  let refreshQueued = false; // Coalesces same-event refresh requests.
  let currentBranchLabel = ''; // Medicine/Utility heading retained while child categories are open.
  let currentLeafLabel = ''; // Healing/Cures/Buffs/Flasks heading retained while concrete potions are open.
  let lastGeometry = null; // Diagnostic snapshot of center/radius currently in use.
  let lastSweepDeg = COMPACT_SWEEP_DEG; // Diagnostic snapshot of current visible-choice sweep.

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
    element.style.setProperty(property, value, 'important'); // Keeps size/shape authoritative when legacy wheel code recycles nodes.
  }

  function setSharedCoordinate(slot, property, value) {
    if (slot.style.getPropertyValue(property) === value) return;
    slot.style.setProperty(property, value); // CSS consumes these vars; legacy inline left/top cannot render.
  }

  function outerRingGeometry() {
    const anchor = document.getElementById(OUTER_ARCH_ID); // Zero-size bottom-right anchor shared by the permanent outer ring.
    const anchorRect = anchor?.getBoundingClientRect?.();
    const center = anchorRect
      ? { x: anchorRect.left + anchorRect.width / 2, y: anchorRect.top + anchorRect.height / 2 }
      : { x: innerWidth, y: innerHeight };

    const referenceCenter = elementCenter(document.getElementById(OUTER_RADIUS_REFERENCE_ID));
    const measuredRadius = referenceCenter ? Math.hypot(referenceCenter.x - center.x, referenceCenter.y - center.y) : 0;
    const fallbackRadius = innerWidth / 32 * 10; // Mirrors the authored #toolSelect --ar2 radius.
    const radius = measuredRadius > 8 ? measuredRadius : fallbackRadius;
    lastGeometry = { center, radius, referenceButton:OUTER_RADIUS_REFERENCE_ID, measured:measuredRadius > 8 };
    return lastGeometry;
  }

  function selectorSweepDeg(count, radius) {
    if (count <= 4) return COMPACT_SWEEP_DEG;
    const ratio = Math.min(0.95, TARGET_SLOT_GAP_PX / (2 * Math.max(1, radius)));
    const stepDeg = 2 * Math.asin(ratio) * 180 / Math.PI; // Converts desired chord spacing to angular spacing on this exact radius.
    return Math.min(MAX_SWEEP_DEG, Math.max(COMPACT_SWEEP_DEG, stepDeg * Math.max(1, count - 1)));
  }

  function selectorAngleRad(index, count, sweepDeg) {
    const t = count <= 1 ? 0.5 : index / (count - 1);
    const start = SELECTOR_MID_DEG + sweepDeg / 2;
    const end = SELECTOR_MID_DEG - sweepDeg / 2;
    return (start + (end - start) * t) * Math.PI / 180;
  }

  function legacyInlineLeft(slot) {
    const value = Number.parseFloat(slot?.style?.left || ''); // game.js still writes the old arc target here even though CSS no longer renders it.
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  }

  function itemWheelSentinelsPresent() {
    return Boolean(document.querySelector(LEGACY_ARROW_SELECTOR)); // A scrollable legacy item wheel always owns at least one edge arrow.
  }

  function activeSelectionSlots() {
    const itemWheel = itemWheelSentinelsPresent();
    const slots = [...document.querySelectorAll('.arc-slot')].filter(slot => {
      if (slot.matches(LEGACY_ARROW_SELECTOR)) return false; // Arrows are control sentinels, never entries in the shared visual wheel.
      const style = getComputedStyle(slot);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      // The legacy scroll animation keeps outgoing item nodes for 150ms at opacity 0.
      // Exclude them immediately, but keep brand-new opacity-0 nodes so their first
      // visible frame is already on the correct shared-radius edge.
      if (slot.style.opacity === '0' && slot.dataset.sharedSelectionPresented === '1') return false;
      return true;
    });

    if (itemWheel) {
      // Legacy item scrolling reuses DOM nodes and does NOT reorder the DOM. Its
      // inline left value does still describe each entry's intended logical slot,
      // so sort by that hidden bookkeeping coordinate before assigning shared slots.
      // This makes all retained items advance together instead of only whichever
      // subset happens to be in DOM order.
      slots.sort((a, b) => legacyInlineLeft(a) - legacyInlineLeft(b));
    }
    return slots;
  }

  function armSharedMotion(slot) {
    if (slot.dataset.sharedSelectionPresented === '1') {
      slot.classList.add('shared-selection-motion'); // Recycled choices may glide to an adjacent shared-radius position.
      return;
    }
    slot.classList.remove('shared-selection-motion'); // New choices first snap invisibly to their real destination.
    slot.dataset.sharedSelectionPresented = '1';
    requestAnimationFrame(() => {
      if (slot.isConnected && slot.dataset.sharedSelectionPresented === '1') slot.classList.add('shared-selection-motion');
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
  }

  function neutralizeLegacyArrows() {
    document.querySelectorAll(LEGACY_ARROW_SELECTOR).forEach(slot => {
      slot.classList.add('shared-selection-sentinel'); // Keeps game.js references alive while making the DOM role explicit.
      slot.setAttribute('aria-hidden', 'true');
      slot.dataset.sharedSelectionSentinel = '1';
    });
  }

  function layoutSharedSelector(slots) {
    if (!slots.length) return;
    neutralizeLegacyArrows();
    const { center, radius } = outerRingGeometry();
    const sweepDeg = selectorSweepDeg(slots.length, radius);
    const dense = slots.length >= 5; // Five long item names benefit from wrapped labels even though arrows no longer inflate the count.
    lastSweepDeg = sweepDeg;

    slots.forEach((slot, index) => {
      enforceSlotPresentation(slot, dense);
      armSharedMotion(slot);
      const angle = selectorAngleRad(index, slots.length, sweepDeg);
      const left = center.x + Math.cos(angle) * radius;
      const top = center.y - Math.sin(angle) * radius;
      setSharedCoordinate(slot, '--shared-selection-left', `${left}px`);
      setSharedCoordinate(slot, '--shared-selection-top', `${top}px`);
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
    document.body.classList.toggle('shared-selection-arc-open', Boolean(hidden)); // visibility:hidden preserves permanent-ring geometry for measurement.
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
    if (!point) return center;
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
      neutralizeLegacyArrows();
      const slots = activeSelectionSlots();
      if (!slots.length) {
        frameRunning = false;
        setOuterArchHidden(false);
        return;
      }
      setOuterArchHidden(true);
      layoutSharedSelector(slots); // Timer-driven item scrolling can recycle nodes without inserting anything.
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      neutralizeLegacyArrows();
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
      refresh();
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

      /* Legacy item-scroll arrows are still kept alive as invisible internal
         sentinels so the old pointer-hover scroll state machine keeps working.
         They never count as visible choices and never receive shared positions. */
      ${LEGACY_ARROW_SELECTOR} {
        visibility:hidden !important;
        opacity:0 !important;
        pointer-events:none !important;
        transition:none !important;
      }

      /* Rendered selector position comes only from shared-radius variables.
         game.js may keep writing its old _arcPt inline left/top values for item
         recycling/order bookkeeping, but those coordinates cannot render. */
      .arc-slot:not(.arc-arrow) {
        position:fixed !important;
        left:var(--shared-selection-left, -10000px) !important;
        top:var(--shared-selection-top, -10000px) !important;
        width:${BUTTON_SIZE} !important;
        height:${BUTTON_SIZE} !important;
        border-width:1px !important;
        gap:1px !important;
        overflow:visible !important;
        box-shadow:0 2px 7px rgba(0,0,0,.42) !important;
        transition:transform .08s, background .08s, border-color .08s, opacity .12s !important;
      }

      .arc-slot:not(.arc-arrow).shared-selection-motion {
        transition:
          transform .08s,
          background .08s,
          border-color .08s,
          opacity .12s,
          left ${SLOT_MOVE_MS}ms ease,
          top ${SLOT_MOVE_MS}ms ease !important;
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

    // Observe only structural changes. Style/class observation caused the old
    // item-wheel recycler and the presenter to recursively trigger one another.
    new MutationObserver(records => {
      const relevantRecords = records.filter(recordTouchesSelectionArc);
      if (!relevantRecords.length) return;
      rememberRemovedPotionSelection(relevantRecords);
      scheduleRefresh();
    }).observe(document.body, { childList:true, subtree:true });

    // Wheel/key navigation can recycle the same node set. The microtask refresh
    // plus geometry-only RAF covers those paths without mutation feedback.
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
        hiddenLegacyArrowCount:document.querySelectorAll(LEGACY_ARROW_SELECTOR).length,
        visibleChoiceCount:activeSelectionSlots().length,
        outerArchHidden:document.body.classList.contains('shared-selection-arc-open'),
        selectorRadii:activeSelectionSlots().map(slot => Number(slot.dataset.sharedSelectionRadius)),
        frameEnforcerRunning:frameRunning,
      }),
      refresh:scheduleRefresh,
    });
    log('installed', { selectorMidDeg:SELECTOR_MID_DEG, buttonDiameterScale:BUTTON_DIAMETER_SCALE, labelOutsetPx:LABEL_OUTSET_PX });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
