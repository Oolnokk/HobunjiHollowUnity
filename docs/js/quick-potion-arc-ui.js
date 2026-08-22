// Quick Potion Select presentation layer.
// Keeps the shared selection-arch input/callback machinery authoritative while
// tightening only potion menus and adding map-style curved category labels.
(() => {
  'use strict';

  const COMPACT_RADIUS_SCALE = 0.68; // Used to pull potion-only arch slots toward the existing arc center.
  const MIN_LABEL_SPAN_PX = 92; // Used to keep short two-button branches readable as curved text.
  const POTION_MARKER_SELECTOR = '.arc-slot.potion-branch, .arc-slot.potion-category, .arc-slot.potion-cancel';
  const LABEL_ID = 'quickPotionArcCategoryLabel';

  let installed = false; // Guards against duplicate observers if this script is cache-busted/reloaded.
  let lastArcCenter = null; // Reused for two-slot potion menus after a 3+ slot menu reveals the exact circle center.
  let currentBranchLabel = ''; // Medicine/Utility label shown while their child categories are visible.
  let currentLeafLabel = ''; // Healing/Cures/Buffs/Flasks label shown while concrete potion items are visible.
  let refreshQueued = false; // Coalesces MutationObserver bursts into one animation-frame layout pass.

  function log(message, detail) {
    const text = `[quick-potion-arc] ${message}`;
    if (typeof window.__farmLog === 'function') window.__farmLog(detail ? `${text} ${JSON.stringify(detail)}` : text, 'items');
    else if (detail) console.debug(text, detail);
    else console.debug(text);
  }

  function slotLabel(slot) {
    return String(slot?.getAttribute?.('aria-label') || slot?.title || slot?.textContent || '')
      .replace(/\s+/g, ' ').trim();
  }

  function slotCenter(slot) {
    const rect = slot.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function circumcenter(a, b, c) {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 0.001) return null;
    const aa = a.x * a.x + a.y * a.y;
    const bb = b.x * b.x + b.y * b.y;
    const cc = c.x * c.x + c.y * c.y;
    return {
      x: (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d,
      y: (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d,
    };
  }

  function fallbackArcCenter() {
    const toolButton = document.getElementById('toolBtn'); // Existing selection-arch anchor; visibility:hidden still retains its rect.
    const rect = toolButton?.getBoundingClientRect?.();
    if (rect?.width || rect?.height) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    return { x: innerWidth / 2, y: innerHeight / 2 };
  }

  function resolveArcCenter(slots) {
    const points = slots.map(slotCenter);
    if (points.length >= 3) {
      const mid = points[Math.floor(points.length / 2)];
      const fit = circumcenter(points[0], mid, points[points.length - 1]);
      if (fit && Number.isFinite(fit.x) && Number.isFinite(fit.y)) lastArcCenter = fit;
    }
    return lastArcCenter || fallbackArcCenter();
  }

  function compactPotionSlots(slots) {
    if (!slots.length) return;
    const center = resolveArcCenter(slots); // Radial scaling preserves every slot's original selection angle.
    slots.forEach(slot => {
      if (slot.dataset.quickPotionCompacted === '1') return;
      const point = slotCenter(slot);
      const x = center.x + (point.x - center.x) * COMPACT_RADIUS_SCALE;
      const y = center.y + (point.y - center.y) * COMPACT_RADIUS_SCALE;
      slot.style.left = `${x}px`;
      slot.style.top = `${y}px`;
      slot.dataset.quickPotionCompacted = '1';
    });
  }

  function makeBranchCancel(slot) {
    if (!slot || slot.dataset.quickPotionCancel === '1') return;
    slot.dataset.quickPotionCancel = '1';
    slot.classList.add('potion-cancel', 'quick-potion-category-cancel');
    slot.setAttribute('aria-label', 'Cancel');
    slot.title = 'Cancel';
    slot.innerHTML = '<span class="quick-potion-cancel-icon" aria-hidden="true">✕</span><span class="quick-potion-cancel-word">Cancel</span>';
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
      const branchName = branch.classList.contains('medicine') ? 'Medicine' : branch.classList.contains('utility') ? 'Utility' : slotLabel(branch);
      currentBranchLabel = branchName;
      return branchName;
    }
    return '';
  }

  function renderCurvedLabel(slots) {
    removeCurvedLabel();
    const text = curvedLabelText(slots);
    if (!text || slots.length < 2) return;

    const points = slots.map(slotCenter);
    const start = points[0];
    const end = points[points.length - 1];
    const middle = points[Math.floor(points.length / 2)];
    const span = Math.max(MIN_LABEL_SPAN_PX, Math.hypot(end.x - start.x, end.y - start.y));
    let control;
    if (points.length >= 3) {
      control = {
        x: 2 * middle.x - (start.x + end.x) / 2,
        y: 2 * middle.y - (start.y + end.y) / 2,
      };
    } else {
      const mx = (start.x + end.x) / 2;
      const my = (start.y + end.y) / 2;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const towardCenter = resolveArcCenter(slots);
      let nx = -dy / length;
      let ny = dx / length;
      if ((towardCenter.x - mx) * nx + (towardCenter.y - my) * ny > 0) { nx *= -1; ny *= -1; }
      control = { x: mx + nx * Math.min(42, span * 0.23), y: my + ny * Math.min(42, span * 0.23) };
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

  function rememberRemovedSelection(records) {
    for (const record of records) {
      for (const node of record.removedNodes || []) {
        if (!(node instanceof Element)) continue;
        const removed = node.matches?.('.arc-slot') ? [node] : [...node.querySelectorAll?.('.arc-slot') || []];
        const activeLeaf = removed.find(slot => slot.classList.contains('arc-active') && slot.classList.contains('potion-category'));
        if (activeLeaf) currentLeafLabel = slotLabel(activeLeaf).replace(/^[^A-Za-z0-9]+/, '').trim();
        const activeBranch = removed.find(slot => slot.classList.contains('arc-active') && slot.classList.contains('potion-branch'));
        if (activeBranch) currentBranchLabel = activeBranch.classList.contains('medicine') ? 'Medicine' : activeBranch.classList.contains('utility') ? 'Utility' : slotLabel(activeBranch);
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
    const marker = document.querySelector(POTION_MARKER_SELECTOR);
    if (!marker) { removeCurvedLabel(); return; }
    const slots = [...document.querySelectorAll('.arc-slot')];
    if (!slots.length) { removeCurvedLabel(); return; }

    const branchSlot = slots.find(slot => slot.classList.contains('potion-branch'));
    const hasChildCategories = slots.some(slot => slot.classList.contains('potion-category'));
    if (branchSlot && hasChildCategories) makeBranchCancel(branchSlot); // Existing callback already returns to the root, so only its presentation changes.

    compactPotionSlots(slots);
    renderCurvedLabel(slots);
  }

  function queueRefresh(records = []) {
    rememberRemovedSelection(records);
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(refresh);
  }

  function install() {
    if (installed) return;
    installed = true;
    const style = document.createElement('style');
    style.id = 'quickPotionArcUiStyles';
    style.textContent = `
      .quick-potion-category-cancel .quick-potion-cancel-icon { font-size:1.45em; line-height:1; }
      .quick-potion-category-cancel .quick-potion-cancel-word { font-size:clamp(8px,1.45vmin,11px); line-height:1; margin-top:1px; }
      .quick-potion-curved-category {
        fill:#f9e28a; stroke:rgba(0,0,0,.82); stroke-width:3px; paint-order:stroke fill;
        font-family:'KhymeryyanRomanLetters+Numbers','Pixelify Sans',sans-serif;
        font-size:clamp(16px,2.5vmin,24px); letter-spacing:.08em;
        text-shadow:0 2px 5px rgba(0,0,0,.8);
      }
    `;
    document.head.appendChild(style);

    new MutationObserver(records => {
      const relevantRecords = records.filter(recordTouchesSelectionArc); // Ignore the SVG label's own add/remove mutations so redraws cannot self-trigger.
      if (relevantRecords.length) queueRefresh(relevantRecords);
    }).observe(document.body, { childList:true, subtree:true });
    addEventListener('resize', () => { lastArcCenter = null; document.querySelectorAll('.arc-slot').forEach(slot => delete slot.dataset.quickPotionCompacted); queueRefresh(); }, { passive:true });
    queueRefresh();
    window.QuickPotionArcUI = Object.freeze({
      diagnostics: () => ({ installed, currentBranchLabel, currentLeafLabel, lastArcCenter, compactRadiusScale:COMPACT_RADIUS_SCALE }),
      refresh: () => queueRefresh(),
    });
    log('installed', { compactRadiusScale: COMPACT_RADIUS_SCALE });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
