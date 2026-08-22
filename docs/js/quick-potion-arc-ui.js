// Shared toggled-selection arch presentation.
// Tool, item, ammo, and potion selectors all reuse the permanent outer HUD
// ring's exact center/radius, half-size buttons, and Khymeryyan labels.
(() => {
  'use strict';

  const ARC_SPAN_SCALE = 0.42; // Used by every toggled selector to keep its choices clustered like the approved potion selector.
  const BUTTON_DIAMETER_SCALE = 0.50; // Used by every toggled selector so all selector buttons match the approved half-size potion buttons.
  const LABEL_OUTSET_PX = 17; // Used by the large curved potion-category title to preserve its current button-to-title gap.
  const POTION_MARKER_SELECTOR = '.arc-slot.potion-branch, .arc-slot.potion-category, .arc-slot.potion-cancel';
  const OUTER_ARCH_ID = 'toolSelect'; // Permanent tool/weapon/item/mount ring whose live geometry is the selector-ring source of truth.
  const LABEL_ID = 'quickPotionArcCategoryLabel';

  let installed = false; // Guards against duplicate observers if the module is cache-busted/reloaded.
  let currentBranchLabel = ''; // Medicine/Utility heading retained while the concrete child category is open.
  let currentLeafLabel = ''; // Healing/Cures/Buffs/Flasks heading retained while concrete potions are open.
  let refreshQueued = false; // Coalesces selection-arc DOM mutations into one animation-frame layout pass.
  let lastGeometry = null; // Mobile-visible diagnostic snapshot of the actual outer-ring geometry used by selectors.

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

  function slotCenter(slot) {
    const rect = slot.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function outerRingGeometry() {
    const anchor = document.getElementById(OUTER_ARCH_ID); // Zero-size bottom-right anchor shared by the permanent outer HUD ring.
    const rect = anchor?.getBoundingClientRect?.();
    const center = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: innerWidth, y: innerHeight };
    const ringButtons = ['btnUnequipHeld', 'btnWeaponSwitch', 'toolBtn', 'itemBtn', 'btnCallMount']
      .map(id => document.getElementById(id)).filter(Boolean);
    const measuredRadii = ringButtons.map(button => {
      const point = slotCenter(button);
      return Math.hypot(point.x - center.x, point.y - center.y);
    }).filter(radius => radius > 8);
    const fallbackRadius = innerWidth / 32 * 10; // Mirrors #toolSelect --ar2: calc(10 * var(--col)) when child geometry is unavailable.
    const radius = median(measuredRadii) || fallbackRadius;
    lastGeometry = { center, radius, measuredButtons: measuredRadii.length };
    return lastGeometry;
  }

  function unwrapAngles(records) {
    if (!records.length) return records;
    let previous = records[0].angle;
    records[0].unwrappedAngle = previous;
    for (let index = 1; index < records.length; index++) {
      let angle = records[index].angle;
      while (angle - previous > Math.PI) angle -= Math.PI * 2;
      while (angle - previous < -Math.PI) angle += Math.PI * 2;
      records[index].unwrappedAngle = angle;
      previous = angle;
    }
    return records;
  }

  function layoutSharedSelector(slots) {
    if (!slots.length) return;
    const { center, radius } = outerRingGeometry(); // Exact permanent-ring geometry, even while visibility:hidden keeps it out of view.
    const records = unwrapAngles(slots.map(slot => {
      const point = slotCenter(slot);
      return {
        slot,
        angle: Math.atan2(point.y - center.y, point.x - center.x),
        unwrappedAngle: 0,
      };
    }));
    const midpoint = records.length > 1
      ? (records[0].unwrappedAngle + records[records.length - 1].unwrappedAngle) / 2
      : records[0]?.unwrappedAngle || -Math.PI * 3 / 4;

    records.forEach(record => {
      const slot = record.slot;
      slot.classList.add('shared-selection-slot');
      if (slot.dataset.sharedSelectionPositioned === '1') return;
      const angle = midpoint + (record.unwrappedAngle - midpoint) * ARC_SPAN_SCALE;
      slot.style.left = `${center.x + Math.cos(angle) * radius}px`;
      slot.style.top = `${center.y + Math.sin(angle) * radius}px`;
      slot.dataset.sharedSelectionPositioned = '1';
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
    const points = slots.map(slot => outwardLabelPoint(slotCenter(slot), center)); // Same 17px relative spacing after snapping the selector to the outer ring.
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

  function refresh() {
    refreshQueued = false;
    const slots = [...document.querySelectorAll('.arc-slot')];
    if (!slots.length) {
      setOuterArchHidden(false);
      removeCurvedLabel();
      return;
    }

    setOuterArchHidden(true); // Every toggled selector temporarily replaces the permanent outer ring visually.
    const potionOpen = Boolean(document.querySelector(POTION_MARKER_SELECTOR));
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
        width:clamp(22px,4.25vmin,30px) !important;
        height:clamp(22px,4.25vmin,30px) !important;
        border-width:1px !important;
        gap:1px !important;
        overflow:visible !important;
        box-shadow:0 2px 7px rgba(0,0,0,.42) !important;
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
    addEventListener('resize', () => {
      document.querySelectorAll('.arc-slot').forEach(slot => delete slot.dataset.sharedSelectionPositioned);
      queueRefresh();
    }, { passive:true });
    queueRefresh();
    window.QuickPotionArcUI = Object.freeze({
      diagnostics: () => ({
        installed,
        currentBranchLabel,
        currentLeafLabel,
        outerRingGeometry:lastGeometry,
        arcSpanScale:ARC_SPAN_SCALE,
        buttonDiameterScale:BUTTON_DIAMETER_SCALE,
        labelOutsetPx:LABEL_OUTSET_PX,
        outerArchHidden:document.body.classList.contains('shared-selection-arc-open'),
        selectorCount:document.querySelectorAll('.arc-slot').length,
      }),
      refresh: () => {
        document.querySelectorAll('.arc-slot').forEach(slot => delete slot.dataset.sharedSelectionPositioned);
        queueRefresh();
      },
    });
    log('installed', { arcSpanScale:ARC_SPAN_SCALE, buttonDiameterScale:BUTTON_DIAMETER_SCALE, labelOutsetPx:LABEL_OUTSET_PX });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();