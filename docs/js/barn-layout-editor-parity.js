(() => {
  'use strict';
  if (window.BarnLayoutEditorParity) return;

  let installed = false; // Prevents duplicate observers/listeners when the farm feature bridge re-runs.
  let observer = null; // Watches for the lazily-created Barn Layout modal so it can be upgraded immediately.
  let activeDrag = null; // Tracks the currently dragged installed barn addition and its preview candidate.
  let suppressClickUntil = 0; // Prevents the legacy click-to-select handler from firing after a completed drag.
  let lastDebugChange = 'Barn layout parity helper loaded.'; // Exposed to the in-game/mobile debug surface.

  const api = () => window.BarnIncubator; // Uses the existing incubator placement/move authority instead of duplicating persistence rules.
  const modal = () => document.getElementById('barnIncubatorLayoutModal'); // Resolves the lazy editor overlay only when it exists.
  const canvas = () => document.getElementById('barnIncubatorLayoutCanvas'); // Direct-manipulation surface shared with the existing Barn Layout renderer.

  function additionState(barnId, additionId) {
    return api()?.getState?.().barns?.[barnId]?.additions?.find(entry => entry.id === additionId) || null;
  }

  function pointerToFarm(target, event) {
    const view = target?.__incubatorView; // Existing Barn Layout draw transform; keeps pointer math exactly aligned with what the player sees.
    if (!view) return null;
    const rect = target.getBoundingClientRect();
    return {
      col: view.minCol + ((event.clientX - rect.left) - view.ox) / view.cell,
      row: view.minRow + ((event.clientY - rect.top) - view.oy) / view.cell,
    };
  }

  function additionAt(barn, point) {
    if (!barn || !point) return null;
    return (barn.additions || []).find(addition => {
      const col = barn.col + addition.localCol;
      const row = barn.row + addition.localRow;
      return point.col >= col && point.col < col + addition.w && point.row >= row && point.row < row + addition.h;
    }) || null;
  }

  function nearestCandidate(barn, addition, point) {
    const tier = additionState(barn.id, addition.id)?.tier; // Moving a saved addition keeps its own authored footprint tier, regardless of the placement picker.
    const candidates = api()?.candidatePlacementsForBarn?.(barn, tier) || [];
    let best = null; // Holds the wall slot whose center is nearest the drag pointer.
    let bestDistance = Infinity; // Used to rank candidate wall slots without mutating game state during preview.
    for (const candidate of candidates) {
      const col = barn.col + candidate.localCol + candidate.w / 2;
      const row = barn.row + candidate.localRow + candidate.h / 2;
      const distance = Math.hypot(point.col - col, point.row - row);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  }

  function restoreDragCanvas() {
    const drag = activeDrag;
    if (!drag?.baseImage || !drag.target?.isConnected) return;
    const ctx = drag.target.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(drag.baseImage, 0, 0);
  }

  function drawDragPreview(candidate) {
    const drag = activeDrag;
    const target = drag?.target;
    const view = target?.__incubatorView;
    if (!drag || !candidate || !view) return;
    restoreDragCanvas();
    const rect = target.getBoundingClientRect();
    const dpr = target.width / Math.max(1, rect.width); // Matches the existing high-DPI backing-store scale.
    const ctx = target.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = view.ox + (drag.barn.col + candidate.localCol - view.minCol) * view.cell;
    const y = view.oy + (drag.barn.row + candidate.localRow - view.minRow) * view.cell;
    ctx.save();
    ctx.fillStyle = 'rgba(249,226,138,.34)';
    ctx.strokeStyle = '#ffe2a7';
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 5]);
    ctx.fillRect(x, y, candidate.w * view.cell, candidate.h * view.cell);
    ctx.strokeRect(x, y, candidate.w * view.cell, candidate.h * view.cell);
    ctx.restore();
  }

  function refreshEditor(barnId, message = null) {
    api()?.openBarnEditor?.(barnId); // Reuses the editor's own authoritative redraw/list refresh after a direct drag move.
    enhanceModal();
    if (message) {
      const hint = document.getElementById('barnIncubatorEditorHint');
      if (hint) hint.textContent = message;
    }
  }

  function endDrag(event, cancelled = false) {
    const drag = activeDrag;
    if (!drag) return;
    restoreDragCanvas();
    activeDrag = null;
    drag.target.classList.remove('barn-layout-dragging');
    try { drag.target.releasePointerCapture?.(event.pointerId); } catch (_) {}
    if (cancelled || !drag.moved || !drag.candidate) return;

    suppressClickUntil = performance.now() + 250;
    const result = api()?.moveIncubator?.(drag.addition.id, drag.candidate) || { ok: false, message: 'Barn addition move API unavailable.' };
    lastDebugChange = result.ok
      ? `Dragged ${drag.addition.id} to ${drag.candidate.side} wall (${drag.candidate.localCol},${drag.candidate.localRow}).`
      : `Barn layout drag rejected: ${result.message || 'unknown placement error'}`;
    refreshEditor(drag.barn.id, result.ok
      ? 'Moved. Drag any installed addition directly to another clear barn wall.'
      : (result.message || 'That barn position is blocked.'));
  }

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    const target = event.currentTarget;
    const currentModal = modal();
    if (!currentModal?.classList.contains('open')) return;
    const snapshot = api()?.debugSnapshot?.();
    const point = pointerToFarm(target, event);
    const owningBarn = (snapshot?.barns || []).find(entry => additionAt(entry, point)) || null; // Farm-space hit testing uniquely identifies the barn whose installed addition was grabbed.
    const addition = owningBarn ? additionAt(owningBarn, point) : null;
    if (!owningBarn || !addition) return; // Plain taps and Place mode remain owned by the legacy editor exactly as before.
    const stateAddition = additionState(owningBarn.id, addition.id);
    if (stateAddition?.slots?.some(slot => slot.baby)) return; // Matches the existing Move Selected disabled state for active incubators.

    const ctx = target.getContext('2d');
    activeDrag = {
      target,
      barn: owningBarn,
      addition,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      candidate: null,
      baseImage: ctx.getImageData(0, 0, target.width, target.height),
    };
    target.setPointerCapture?.(event.pointerId);
    target.classList.add('barn-layout-dragging');
  }

  function onPointerMove(event) {
    const drag = activeDrag;
    if (!drag || drag.target !== event.currentTarget) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    drag.moved = true;
    const point = pointerToFarm(drag.target, event);
    drag.candidate = point ? nearestCandidate(drag.barn, drag.addition, point) : null;
    if (drag.candidate) drawDragPreview(drag.candidate);
    event.preventDefault();
  }

  function onClickCapture(event) {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function requestClose() {
    const close = document.getElementById('barnIncubatorEditorClose'); // Calls the original closeBarnEditor so its internal editorMode is also cleared.
    if (close) close.click();
    else modal()?.classList.remove('open');
    activeDrag = null;
    lastDebugChange = 'Closed Barn Layout editor through farmhouse-style exit control.';
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !modal()?.classList.contains('open')) return;
    event.preventDefault();
    requestClose();
  }

  function enhanceModal() {
    const currentModal = modal();
    const target = canvas();
    if (!currentModal || !target) return false;

    currentModal.setAttribute('role', 'dialog');
    currentModal.setAttribute('aria-modal', 'true');
    const moveButton = document.getElementById('barnIncubatorMoveBtn');
    if (moveButton) moveButton.hidden = true; // Direct dragging now owns ordinary moves, matching farmhouse layout editing.

    if (!currentModal.querySelector('.barn-layout-parity-close')) {
      const close = document.createElement('button'); // Always-visible close control avoids trapping mobile users at the bottom of a scrolling sidebar.
      close.type = 'button';
      close.className = 'settings-small-btn barn-layout-parity-close';
      close.textContent = 'Close';
      close.setAttribute('aria-label', 'Close Barn Layout');
      close.addEventListener('click', requestClose);
      currentModal.appendChild(close);
    }

    if (!target.dataset.houseStyleDragBound) {
      target.dataset.houseStyleDragBound = '1';
      target.addEventListener('pointerdown', onPointerDown);
      target.addEventListener('pointermove', onPointerMove);
      target.addEventListener('pointerup', event => endDrag(event, false));
      target.addEventListener('pointercancel', event => endDrag(event, true));
      target.addEventListener('click', onClickCapture, true);
    }

    if (!currentModal.dataset.houseStyleExitBound) {
      currentModal.dataset.houseStyleExitBound = '1';
      currentModal.addEventListener('pointerdown', event => {
        if (event.target === currentModal) requestClose(); // Same familiar modal backdrop exit expected by the farmhouse editor.
      });
    }

    const hint = document.getElementById('barnIncubatorEditorHint');
    if (hint && !/Drag any installed addition directly/i.test(hint.textContent || '')) {
      hint.textContent = 'Drag any installed addition directly to another barn wall. Use Place Incubator for a new plan; Close, Escape, or the dark backdrop exits.';
    }
    return true;
  }

  function ensureStyles() {
    if (document.getElementById('barnLayoutEditorParityStyles')) return;
    const style = document.createElement('style'); // Keeps the barn editor controls reachable and visually consistent with direct farmhouse manipulation.
    style.id = 'barnLayoutEditorParityStyles';
    style.textContent = `
      #barnIncubatorLayoutCanvas{cursor:grab}
      #barnIncubatorLayoutCanvas.barn-layout-dragging{cursor:grabbing}
      #barnIncubatorLayoutModal{overscroll-behavior:contain}
      .barn-layout-parity-close{position:fixed;top:max(12px,env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));z-index:10083;min-width:74px}
      @media(max-width:720px){.barn-layout-parity-close{top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right))}}
    `;
    document.head.appendChild(style);
  }

  function install() {
    if (installed) return true;
    installed = true;
    ensureStyles();
    window.addEventListener('keydown', onKeyDown, true);
    observer = new MutationObserver(() => enhanceModal());
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    enhanceModal();
    window.__barnLayoutEditorDebug = () => ({
      mostRecentChange: lastDebugChange,
      installed,
      modalOpen: !!modal()?.classList.contains('open'),
      directDragBound: canvas()?.dataset.houseStyleDragBound === '1',
      draggingAdditionId: activeDrag?.addition?.id || null,
      previewCandidate: activeDrag?.candidate || null,
    });
    return true;
  }

  window.BarnLayoutEditorParity = { install, debugSnapshot: () => window.__barnLayoutEditorDebug?.() || null };
})();
