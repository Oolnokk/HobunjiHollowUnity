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
  const GROUP_MOVE_MS = 190; // One shared duration for retained, incoming, and outgoing boundary motion.
  const MOTION_EASING = 'cubic-bezier(.22,.82,.24,1)'; // Soft acceleration with a controlled settle.
  const POTION_MARKER_SELECTOR = '.arc-slot.potion-branch, .arc-slot.potion-category, .arc-slot.potion-cancel';
  const LEGACY_ARROW_SELECTOR = '.arc-slot.arc-arrow'; // Old edge arrows stay internal sentinels, never visual choices.
  const OUTER_ARCH_ID = 'toolSelect'; // Permanent tool/weapon/item/mount ring used as the geometry source of truth.
  const OUTER_RADIUS_REFERENCE_ID = 'toolBtn'; // Canonical permanent-ring button used to measure radius.
  const LABEL_ID = 'quickPotionArcCategoryLabel';

  let installed = false; // Prevents duplicate observers/listeners if the script is loaded twice.
  let refreshing = false; // Prevents nested structural refreshes while a potion breadcrumb is rewritten.
  let frameRunning = false; // One geometry enforcer runs only while a selector is visible.
  let refreshQueued = false; // Coalesces same-event refresh requests.
  let groupCommitPending = false; // Freezes the enforcer for the one staging frame of an atomic wheel transition.
  let currentBranchLabel = ''; // Medicine/Utility heading retained while child categories are open.
  let currentLeafLabel = ''; // Healing/Cures/Buffs/Flasks heading retained while concrete potions are open.
  let lastGeometry = null; // Diagnostic snapshot of center/radius currently in use.
  let lastSweepDeg = COMPACT_SWEEP_DEG; // Diagnostic snapshot of current visible-choice sweep.
  let lastVisibleChoiceCount = 0; // Used to send outgoing choices one logical slot beyond the current arc edge.

  function log(message, detail) {
    const text = `[selection-arc-ui] ${message}`;
    if (typeof window.__farmLog === 'function') window.__farmLog(detail ? `${text} ${JSON.stringify(detail)}` : text, 'items');
    else if (detail) console.debug(text, detail);
    else console.debug(text);
  }

  function motionAllowed() {
    return !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; // Honors OS accessibility without changing selector behavior.
  }

  function slotLabel(slot) {
    return String(slot?.getAttribute?.('aria-label') || slot?.title || slot?.querySelector?.('.arc-label')?.textContent || slot?.textContent || '')
      .replace(/\s+/g, ' ').trim();
  }

  function elementCenter(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) return null;
    return { x:rect.left + rect.width / 2, y:rect.top + rect.height / 2 };
  }

  function setImportantStyle(element, property, value) {
    if (!element) return;
    if (element.style.getPropertyValue(property) === value && element.style.getPropertyPriority(property) === 'important') return;
    element.style.setProperty(property, value, 'important'); // Keeps shape authoritative when legacy wheel code recycles nodes.
  }

  function setSharedCoordinate(slot, property, value) {
    if (slot.style.getPropertyValue(property) === value) return;
    slot.style.setProperty(property, value); // CSS consumes these vars; legacy inline left/top cannot render.
  }

  function setSharedVisual(slot, opacity, scale) {
    slot.style.setProperty('--shared-selection-opacity', String(opacity));
    slot.style.setProperty('--shared-selection-scale', String(scale));
  }

  function outerRingGeometry() {
    const anchor = document.getElementById(OUTER_ARCH_ID); // Zero-size bottom-right anchor shared by the permanent outer ring.
    const anchorRect = anchor?.getBoundingClientRect?.();
    const center = anchorRect
      ? { x:anchorRect.left + anchorRect.width / 2, y:anchorRect.top + anchorRect.height / 2 }
      : { x:innerWidth, y:innerHeight };
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

  function selectorAngleDeg(index, count, sweepDeg) {
    const t = count <= 1 ? 0.5 : index / (count - 1);
    const start = SELECTOR_MID_DEG + sweepDeg / 2;
    const end = SELECTOR_MID_DEG - sweepDeg / 2;
    return start + (end - start) * t;
  }

  function pointOnSharedArc(angleDeg, center, radius) {
    const angle = angleDeg * Math.PI / 180;
    return { x:center.x + Math.cos(angle) * radius, y:center.y - Math.sin(angle) * radius };
  }

  function angleForPoint(point, center) {
    if (!point) return null;
    return Math.atan2(-(point.y - center.y), point.x - center.x) * 180 / Math.PI;
  }

  function sharedTargetCenter(slot) {
    const x = Number.parseFloat(slot?.dataset?.sharedSelectionTargetX || '');
    const y = Number.parseFloat(slot?.dataset?.sharedSelectionTargetY || '');
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    const styleX = Number.parseFloat(slot?.style?.getPropertyValue('--shared-selection-left') || '');
    const styleY = Number.parseFloat(slot?.style?.getPropertyValue('--shared-selection-top') || '');
    return Number.isFinite(styleX) && Number.isFinite(styleY) ? { x:styleX, y:styleY } : elementCenter(slot);
  }

  function legacyInlineLeft(slot) {
    const value = Number.parseFloat(slot?.style?.left || ''); // Legacy scroll still writes logical slot targets here.
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  }

  function itemWheelSentinelsPresent() {
    return Boolean(document.querySelector(LEGACY_ARROW_SELECTOR)); // Scrollable legacy item wheels own at least one edge arrow.
  }

  function realArcSlots() {
    return [...document.querySelectorAll('.arc-slot:not(.arc-arrow):not(.shared-selection-exit-ghost)')];
  }

  function outgoingLegacySlots() {
    return realArcSlots().filter(slot => slot.style.opacity === '0' && slot.dataset.sharedSelectionPresented === '1');
  }

  function activeSelectionSlots() {
    const itemWheel = itemWheelSentinelsPresent();
    const slots = realArcSlots().filter(slot => {
      const style = getComputedStyle(slot);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (slot.style.opacity === '0' && slot.dataset.sharedSelectionPresented === '1') return false; // Retiring legacy node.
      return true; // Brand-new legacy opacity:0 slots are deliberately included for staging.
    });
    if (itemWheel) slots.sort((a, b) => legacyInlineLeft(a) - legacyInlineLeft(b)); // DOM order is not logical order after recycling.
    return slots;
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
      slot.classList.add('shared-selection-sentinel'); // Keeps old references alive while making the DOM role explicit.
      slot.setAttribute('aria-hidden', 'true');
      slot.dataset.sharedSelectionSentinel = '1';
    });
  }

  function clearExitGhosts() {
    document.querySelectorAll('.shared-selection-exit-ghost').forEach(ghost => ghost.remove());
  }

  function makeExitGhost(slot, center, radius) {
    if (!slot || slot.dataset.sharedSelectionExitGhosted === '1') return null;
    slot.dataset.sharedSelectionExitGhosted = '1';
    slot.classList.add('shared-selection-retired-original'); // The real node remains only for the legacy 150ms retirement timer.

    const currentPoint = elementCenter(slot) || sharedTargetCenter(slot);
    const oldTargetAngle = Number.parseFloat(slot.dataset.sharedSelectionAngle || '');
    const currentAngle = angleForPoint(currentPoint, center);
    const startAngle = Number.isFinite(currentAngle) ? currentAngle : oldTargetAngle;
    if (!currentPoint || !Number.isFinite(startAngle)) return null;

    const ghost = slot.cloneNode(true); // Presentation-only copy is not subject to the legacy retirement timer.
    ghost.classList.remove('arc-active', 'shared-selection-retired-original');
    ghost.classList.add('shared-selection-exit-ghost', 'shared-selection-preparing');
    ghost.removeAttribute('id');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.pointerEvents = 'none';
    ghost.style.removeProperty('opacity');
    ghost.style.setProperty('--shared-selection-motion-ms', `${GROUP_MOVE_MS}ms`);
    setSharedCoordinate(ghost, '--shared-selection-left', `${currentPoint.x}px`);
    setSharedCoordinate(ghost, '--shared-selection-top', `${currentPoint.y}px`);
    setSharedVisual(ghost, 1, 1);
    document.body.appendChild(ghost);

    const step = lastVisibleChoiceCount > 1 ? lastSweepDeg / (lastVisibleChoiceCount - 1) : 10;
    const directionBasis = Number.isFinite(oldTargetAngle) ? oldTargetAngle : startAngle;
    const direction = directionBasis >= SELECTOR_MID_DEG ? 1 : -1;
    const exitAngle = startAngle + direction * Math.min(14, Math.max(7, step * 0.82));
    return { ghost, exitPoint:pointOnSharedArc(exitAngle, center, radius) };
  }

  function scheduleAtomicCommit(actions) {
    if (!motionAllowed()) {
      actions.forEach(action => action());
      groupCommitPending = false;
      return;
    }
    groupCommitPending = true;
    // All staged retained/new/outgoing nodes commit in this one animation frame,
    // so crossing the item-window boundary reads as one conveyor movement.
    requestAnimationFrame(() => {
      actions.forEach(action => action());
      groupCommitPending = false;
    });
  }

  function layoutSharedSelector(slots) {
    if (!slots.length) return;
    neutralizeLegacyArrows();
    const { center, radius } = outerRingGeometry();
    const sweepDeg = selectorSweepDeg(slots.length, radius);
    const dense = slots.length >= 5;
    const outgoing = outgoingLegacySlots();
    const newSlots = slots.filter(slot => slot.dataset.sharedSelectionPresented !== '1');
    const opening = newSlots.length === slots.length && outgoing.length === 0;
    const atomicBoundary = opening || newSlots.length > 0 || outgoing.length > 0;
    const actions = [];
    lastSweepDeg = sweepDeg;

    // Stage outgoing visuals first, but do not start their exit until the same commit
    // that moves retained choices and reveals the incoming edge choice.
    outgoing.forEach(slot => {
      const prepared = makeExitGhost(slot, center, radius);
      if (!prepared) return;
      prepared.ghost.getBoundingClientRect(); // Locks the ghost's current interpolated position as its baseline.
      actions.push(() => {
        if (!prepared.ghost.isConnected) return;
        prepared.ghost.classList.remove('shared-selection-preparing');
        setSharedCoordinate(prepared.ghost, '--shared-selection-left', `${prepared.exitPoint.x}px`);
        setSharedCoordinate(prepared.ghost, '--shared-selection-top', `${prepared.exitPoint.y}px`);
        setSharedVisual(prepared.ghost, 0, 0.76);
        setTimeout(() => prepared.ghost.remove(), GROUP_MOVE_MS + 70);
      });
    });

    slots.forEach((slot, index) => {
      enforceSlotPresentation(slot, dense);
      const targetAngle = selectorAngleDeg(index, slots.length, sweepDeg);
      const targetPoint = pointOnSharedArc(targetAngle, center, radius);
      const wasPresented = slot.dataset.sharedSelectionPresented === '1';
      slot.dataset.sharedSelectionRadius = radius.toFixed(2);
      slot.dataset.sharedSelectionAngle = targetAngle.toFixed(2);
      slot.dataset.sharedSelectionTargetX = targetPoint.x.toFixed(3);
      slot.dataset.sharedSelectionTargetY = targetPoint.y.toFixed(3);
      slot.style.setProperty('--shared-selection-motion-ms', `${GROUP_MOVE_MS}ms`);
      slot.style.setProperty('--shared-selection-delay', '0ms');

      if (!wasPresented) {
        slot.dataset.sharedSelectionPresented = '1';
        slot.classList.add('shared-selection-preparing');
        const step = slots.length > 1 ? sweepDeg / (slots.length - 1) : 10;
        const direction = targetAngle >= SELECTOR_MID_DEG ? 1 : -1;
        const outsideStep = Math.min(14, Math.max(7, step * 0.82));
        const startAngle = opening
          ? SELECTOR_MID_DEG + (targetAngle - SELECTOR_MID_DEG) * 0.14
          : targetAngle + direction * outsideStep;
        const startPoint = pointOnSharedArc(startAngle, center, radius);
        setSharedCoordinate(slot, '--shared-selection-left', `${startPoint.x}px`);
        setSharedCoordinate(slot, '--shared-selection-top', `${startPoint.y}px`);
        setSharedVisual(slot, 0, opening ? 0.82 : 0.78);
        slot.getBoundingClientRect(); // Ensures every new entry has the same pre-transition baseline.
        actions.push(() => {
          if (!slot.isConnected) return;
          slot.classList.remove('shared-selection-preparing');
          setSharedCoordinate(slot, '--shared-selection-left', `${targetPoint.x}px`);
          setSharedCoordinate(slot, '--shared-selection-top', `${targetPoint.y}px`);
          setSharedVisual(slot, 1, 1);
        });
        return;
      }

      if (slot.classList.contains('shared-selection-preparing')) return; // A pending atomic commit owns this node's start position.
      if (atomicBoundary) {
        // Retained choices wait for the same frame as incoming/outgoing choices.
        actions.push(() => {
          if (!slot.isConnected) return;
          setSharedCoordinate(slot, '--shared-selection-left', `${targetPoint.x}px`);
          setSharedCoordinate(slot, '--shared-selection-top', `${targetPoint.y}px`);
          setSharedVisual(slot, 1, 1);
        });
      } else {
        // Non-boundary changes can safely retarget immediately; CSS transitions
        // naturally continue from the current interpolated point if still moving.
        setSharedCoordinate(slot, '--shared-selection-left', `${targetPoint.x}px`);
        setSharedCoordinate(slot, '--shared-selection-top', `${targetPoint.y}px`);
        setSharedVisual(slot, 1, 1);
      }
    });

    if (atomicBoundary && actions.length) scheduleAtomicCommit(actions);
    lastVisibleChoiceCount = slots.length;
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
    const points = slots.map(slot => outwardLabelPoint(sharedTargetCenter(slot), center)); // Tracks final geometry, not transient animation positions.
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

  function nodeContainsRealArcSlot(node) {
    if (!(node instanceof Element)) return false;
    if (node.classList.contains('shared-selection-exit-ghost')) return false;
    if (node.matches?.('.arc-slot')) return true;
    return Boolean(node.querySelector?.('.arc-slot:not(.shared-selection-exit-ghost)'));
  }

  function recordTouchesSelectionArc(record) {
    if (record.target instanceof Element && record.target.closest('.arc-slot:not(.shared-selection-exit-ghost)')) return true;
    return [...record.addedNodes, ...record.removedNodes].some(nodeContainsRealArcSlot);
  }

  function startFrameEnforcer() {
    if (frameRunning) return;
    frameRunning = true;
    const frame = () => {
      neutralizeLegacyArrows();
      if (groupCommitPending) { requestAnimationFrame(frame); return; } // Do not break the staged atomic boundary frame.
      const slots = activeSelectionSlots();
      if (!slots.length) {
        frameRunning = false;
        lastVisibleChoiceCount = 0;
        clearExitGhosts();
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
    if (refreshing || groupCommitPending) return;
    refreshing = true;
    try {
      neutralizeLegacyArrows();
      const slots = activeSelectionSlots();
      if (!slots.length) {
        lastVisibleChoiceCount = 0;
        clearExitGhosts();
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

      ${LEGACY_ARROW_SELECTOR} {
        visibility:hidden !important;
        opacity:0 !important;
        pointer-events:none !important;
        transition:none !important;
      }

      .arc-slot.shared-selection-retired-original {
        visibility:hidden !important;
        pointer-events:none !important;
      }

      /* Legacy inline left/top/opacity remain available as bookkeeping only.
         Rendering comes exclusively from the shared selector variables below. */
      .arc-slot:not(.arc-arrow) {
        position:fixed !important;
        left:var(--shared-selection-left, -10000px) !important;
        top:var(--shared-selection-top, -10000px) !important;
        opacity:var(--shared-selection-opacity, 1) !important;
        scale:var(--shared-selection-scale, 1) !important;
        width:${BUTTON_SIZE} !important;
        height:${BUTTON_SIZE} !important;
        border-width:1px !important;
        gap:1px !important;
        overflow:visible !important;
        box-shadow:0 2px 7px rgba(0,0,0,.42) !important;
        transition:
          left var(--shared-selection-motion-ms, ${GROUP_MOVE_MS}ms) ${MOTION_EASING} var(--shared-selection-delay, 0ms),
          top var(--shared-selection-motion-ms, ${GROUP_MOVE_MS}ms) ${MOTION_EASING} var(--shared-selection-delay, 0ms),
          opacity var(--shared-selection-motion-ms, ${GROUP_MOVE_MS}ms) ease var(--shared-selection-delay, 0ms),
          scale var(--shared-selection-motion-ms, ${GROUP_MOVE_MS}ms) ${MOTION_EASING} var(--shared-selection-delay, 0ms),
          transform .1s ease,
          background .1s ease,
          border-color .1s ease !important;
        will-change:left, top, opacity, scale;
      }

      .arc-slot.shared-selection-preparing { transition:none !important; }
      .arc-slot.shared-selection-exit-ghost { pointer-events:none !important; z-index:202 !important; }
      .arc-slot .arc-icon { font-size:.78em !important; transition:filter .12s ease !important; }
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

      @media (prefers-reduced-motion: reduce) {
        .arc-slot:not(.arc-arrow) { transition:none !important; }
      }
    `;
    document.head.appendChild(style);

    // Observe structure only. Attribute observation previously created a feedback
    // loop with the legacy recycler and froze item-wheel scrolling.
    new MutationObserver(records => {
      const relevantRecords = records.filter(recordTouchesSelectionArc);
      if (!relevantRecords.length) return;
      rememberRemovedPotionSelection(relevantRecords);
      scheduleRefresh();
    }).observe(document.body, { childList:true, subtree:true });

    // Wheel/key navigation may recycle the same nodes, while arrow hover scrolling
    // is timer-driven. The microtask refresh plus enforcer covers both paths.
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
        motion:{ groupMoveMs:GROUP_MOVE_MS, atomicBoundary:true, enabled:motionAllowed() },
        hiddenLegacyArrowCount:document.querySelectorAll(LEGACY_ARROW_SELECTOR).length,
        visibleChoiceCount:activeSelectionSlots().length,
        exitGhostCount:document.querySelectorAll('.shared-selection-exit-ghost').length,
        outerArchHidden:document.body.classList.contains('shared-selection-arc-open'),
        selectorRadii:activeSelectionSlots().map(slot => Number(slot.dataset.sharedSelectionRadius)),
        groupCommitPending,
        frameEnforcerRunning:frameRunning,
      }),
      refresh:scheduleRefresh,
    });
    log('installed', { selectorMidDeg:SELECTOR_MID_DEG, buttonDiameterScale:BUTTON_DIAMETER_SCALE, groupMoveMs:GROUP_MOVE_MS, labelOutsetPx:LABEL_OUTSET_PX });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
