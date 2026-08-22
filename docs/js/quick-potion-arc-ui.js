// Shared toggled-selection arch presentation.
// Tool, item, ammo, and potion selectors all reuse the permanent outer HUD
// ring's exact center/radius, half-size buttons, and Khymeryyan labels.
(() => {
  'use strict';

  const SELECTOR_START_DEG = 155; // Used by every toggled selector as the left/top end of one stable compact sweep.
  const SELECTOR_END_DEG = 115; // Used by every toggled selector as the right/bottom end of the same sweep.
  const BUTTON_DIAMETER_SCALE = 0.50; // Used by every toggled selector so all selector buttons match the approved half-size potion buttons.
  const LABEL_OUTSET_PX = 17; // Used by the large curved potion-category title to preserve its approved button-to-title gap.
  const POTION_MARKER_SELECTOR = '.arc-slot.potion-branch, .arc-slot.potion-category, .arc-slot.potion-cancel';
  const OUTER_ARCH_ID = 'toolSelect'; // Permanent tool/weapon/item/mount ring whose live geometry is the selector-ring source of truth.
  const OUTER_RADIUS_REFERENCE_ID = 'toolBtn'; // One canonical outer-ring button; using one radius prevents mixed-size/transition measurements from producing a zigzag.
  const LABEL_ID = 'quickPotionArcCategoryLabel';

  let installed = false; // Guards against duplicate observers if the module is cache-busted/reloaded.
  let currentBranchLabel = ''; // Medicine/Utility heading retained while the concrete child category is open.
  let currentLeafLabel = ''; // Healing/Cures/Buffs/Flasks heading retained while concrete potions are open.
  let refreshQueued = false; // Coalesces selection-arc DOM mutations into one animation-frame layout pass.
  let lastGeometry = null; // Mobile-visible diagnostic snapshot of the exact center/radius used by every selector button.

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

  function outerRingGeometry() {
    const anchor = document.getElementById(OUTER_ARCH_ID); // Zero-size bottom-right anchor shared by the permanent outer HUD ring.
    const anchorRect = anchor?.getBoundingClientRect?.();
    const center = anchorRect
      ? { x: anchorRect.left + anchorRect.width / 2, y: anchorRect.top + anchorRect.height / 2 }
      : { x: innerWidth, y: innerHeight };

    const referenceButton = document.getElementById(OUTER_RADIUS_REFERENCE_ID); // Tool button is always authored directly on --ar2.
    const referenceCenter = elementCenter(referenceButton);
    const measuredRadius = referenceCenter ? Math.hypot(referenceCenter.x - center.x, referenceCenter.y - center.y) : 0;
    const fallbackRadius = innerWidth / 32 * 10; // Mirrors #toolSelect --ar2: calc(10 * var(--col)) if the live reference cannot be measured.
    const radius = measuredRadius > 8 ? measuredRadius : fallbackRadius;

    lastGeometry = {
      center,
      radius,
      referenceButton: OUTER_RADIUS_REFERENCE_ID,
      measured: measuredRadius > 8,
    };
    return lastGeometry;
  }

  function selectorAngleRad(index, count) {
    const t = count <= 1 ? 0.5 : index / (count - 1); // Keeps a one-entry selector centered instead of pinning it to an edge.
    const degrees = SELECTOR_START_DEG + (SELECTOR_END_DEG - SELECTOR_START_DEG) * t;
    return degrees * Math.PI / 180;
  }

  function layoutSharedSelector(slots) {
    if (!slots.length) return;
    const { center, radius } = outerRingGeometry(); // One center + one radius for the whole selector; no per-button radius measurement is allowed.

    slots.forEach((slot, index) => {
      slot.classList.add('shared-selection-slot');
      const angle = selectorAngleRad(index, slots.length); // Stable slot order prevents geometry feedback from left/top transitions.
      const left = center.x + Math.cos(angle) * radius;
      const top = center.y - Math.sin(angle) * radius; // Screen Y grows downward while the authored outer-ring angles grow upward.
      slot.style.setProperty('left', `${left}px`, 'important');
      slot.style.setProperty('top', `${top}px`, 'important');
      slot.dataset.sharedSelectionRadius = radius.toFixed(2); // Visible through mobile diagnostics/DOM inspection when debugging a bad layout.
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
    document.body.classList.toggle('shared-selection-arc-open', Boolean(hidden)); // visibility:hidden preserves the permanent ring's measurable geometry.
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
    return { x: point.x + dx / length * LABEL_OUTSET_PX, y: point.y + dy / length * LABEL_OUTSET_PX };
  }

  function renderCurvedPotionLabel(slots) {
    removeCurvedLabel();
    const text = curvedLabelText(slots);
    if (!text || slots.length < 2) return;

    const { center } = outerRingGeometry();
    const points = slots.map(slot => outwardLabelPoint(elementCenter(slot), center)); // Same 17px relative spacing after every slot is locked to the one outer-ring radius.
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

  function activeSelectionSlots() {
    // Selection slots are appended directly to the page by the shared presenter.
    // Fading/retired slots can coexist briefly during hierarchy transitions, so
    // ignore elements that are no longer participating in layout/hit-testing.
    return [...document.querySelectorAll('.arc-slot')].filter(slot => {
      const style = getComputedStyle(slot);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05;
    });
  }

  function refresh() {
    refreshQueued = false;
    const slots = activeSelectionSlots();
    if (!slots.length) {
      setOuterArchHidden(false);
      removeCurvedLabel();
      return;
    }

    setOuterArchHidden(true); // Every toggled selector temporarily replaces the permanent outer ring visually.
    const potionOpen = slots.some(slot => slot.matches(POTION_MARKER_SELECTOR));
    if (potionOpen) {
      const branchSlot = slots.find(slot => slot.classList.contains('potion-branch'));
      const hasChildCategories = slots.some(slot => slot.classList.contains('potion-category'));
      if (branchSlot && hasChildCategories) makeBranchCancel(branchSlot); // Callback remains the original back-to-root behavior.
    }

    layoutSharedSelector(slots);
    if (potionOpen) renderCurvedPotionLabel(slots);
    else removeCurvedLabel();
  }

  function queueRefresh(records = []) {
    rememberRemovedPotionSelection(records);
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(refresh);
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
      .arc-slot.shared-selection-slot {
        position:fixed !important;
        width:clamp(22px,4.25vmin,30px) !important;
        height:clamp(22px,4.25vmin,30px) !important;
        border-width:1px !important;
        gap:1px !important;
        overflow:visible !important;
        box-shadow:0 2px 7px rgba(0,0,0,.42) !important;
        transition:transform .08s, background .08s, border-color .08s, opacity .12s !important;
      }
      .arc-slot.shared-selection-slot .arc-icon { font-size:.78em; }
      .arc-slot.shared-selection-slot .arc-icon img,
      .arc-slot.shared-selection-slot .arc-icon canvas,
      .arc-slot.shared-selection-slot .arc-icon svg { max-width:18px; max-height:18px; }
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
      .arc-slot.shared-selection-slot .category-x { inset:-3px; font-size:1.15em; }
      .arc-slot.shared-selection-slot .cure-family-grid { width:16px; height:16px; }
      .arc-slot.shared-selection-slot .cure-family { font-size:4px; }
      .arc-slot.shared-selection-slot .cure-family.active { font-size:6px; }
      .arc-slot.shared-selection-slot .cure-family.severe { font-size:8px; }
      .arc-slot.shared-selection-slot .cure-family-x { font-size:.9em; }
      .quick-potion-category-cancel .quick-potion-cancel-icon { font-size:.82em; line-height:1; }
      .quick-potion-curved-category {
        fill:#f9e28a; stroke:rgba(0,0,0,.82); stroke-width:3px; paint-order:stroke fill;
        font-family:'KhymeryyanRomanLetters+Numbers','Pixelify Sans',sans-serif;
        font-size:clamp(16px,2.5vmin,24px); letter-spacing:.08em;
        text-shadow:0 2px 5px rgba(0,0,0,.8);
      }
    `;
    document.head.appendChild(style);

    new MutationObserver(records => {
      const relevantRecords = records.filter(recordTouchesSelectionArc); // Ignores the curved SVG label's own add/remove mutations.
      if (relevantRecords.length) queueRefresh(relevantRecords);
    }).observe(document.body, { childList:true, subtree:true });
    addEventListener('resize', () => queueRefresh(), { passive:true });
    queueRefresh();

    window.QuickPotionArcUI = Object.freeze({
      diagnostics: () => ({
        installed,
        currentBranchLabel,
        currentLeafLabel,
        outerRingGeometry:lastGeometry,
        selectorStartDeg:SELECTOR_START_DEG,
        selectorEndDeg:SELECTOR_END_DEG,
        buttonDiameterScale:BUTTON_DIAMETER_SCALE,
        labelOutsetPx:LABEL_OUTSET_PX,
        outerArchHidden:document.body.classList.contains('shared-selection-arc-open'),
        selectorRadii:[...document.querySelectorAll('.arc-slot.shared-selection-slot')].map(slot => Number(slot.dataset.sharedSelectionRadius)),
      }),
      refresh: () => queueRefresh(),
    });
    log('installed', { selectorStartDeg:SELECTOR_START_DEG, selectorEndDeg:SELECTOR_END_DEG, buttonDiameterScale:BUTTON_DIAMETER_SCALE, labelOutsetPx:LABEL_OUTSET_PX });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
