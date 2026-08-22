// Mobile-only tap navigation for the hierarchical Potion Select wheel.
// Potion Select -> branch -> category -> concrete potion is a series of taps;
// desktop/controller retain the shared selector's original held/drag behavior.
(() => {
  'use strict';

  const TAP_SLOP_PX = 12; // Used to reject drags while still forgiving normal thumb movement during a tap.
  const HIT_PAD_PX = 5; // Used to make the half-size visible circles slightly easier to tap without nearest-angle selection.

  let installed = false; // Prevents wrapping the shared selector and capture listeners more than once.
  let originalArc = null; // Authoritative selector object created by game.js and used for actual hierarchy/state changes.
  let wrappedArc = null; // Proxy exposed back to game.js so mobile potion releases cannot close hierarchy stages.
  let tapGesture = null; // {pointerId,startX,startY,moved,stageKey}; only gestures that begin on an already-open potion wheel are captured.
  let pressedSlot = null; // Visual-only tap feedback target; never changes the selector's authoritative active index.

  function mobilePointerMode() {
    return !window.matchMedia('(pointer: fine)').matches; // Mirrors game.js's own desktop/mobile split.
  }

  function isTouchLikePointer(ev) {
    return !ev.pointerType || ev.pointerType === 'touch' || ev.pointerType === 'pen'; // Keeps phone/tablet input tap-only without changing mouse behavior.
  }

  function liveSlots(selector) {
    return [...document.querySelectorAll(selector)].filter(slot => {
      if (slot.classList.contains('shared-selection-exit-ghost') || slot.classList.contains('shared-selection-retired-original')) return false;
      const style = getComputedStyle(slot);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  function slotName(slot) {
    return String(slot?.getAttribute?.('aria-label') || slot?.title || slot?.querySelector?.('.arc-label')?.textContent || slot?.textContent || '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function potionStage() {
    const categories = liveSlots('.arc-slot.potion-category:not(.arc-arrow)');
    if (categories.length) {
      const cancel = liveSlots('.arc-slot.potion-branch.potion-cancel:not(.arc-arrow)')[0] || null;
      return { type:'category', key:`category:${categories.map(slotName).sort().join('|')}`, slots:categories, cancel };
    }
    const branches = liveSlots('.arc-slot.potion-branch:not(.potion-cancel):not(.arc-arrow)');
    if (branches.length) return { type:'root', key:`root:${branches.map(slotName).sort().join('|')}`, slots:branches, cancel:null };
    const finalCancel = liveSlots('.arc-slot.potion-cancel:not(.potion-branch):not(.arc-arrow)');
    if (finalCancel.length) {
      const slots = liveSlots('.arc-slot:not(.arc-arrow)').filter(slot => !slot.classList.contains('potion-branch') && !slot.classList.contains('potion-category'));
      return { type:'items', key:`items:${slots.map(slotName).join('|')}`, slots, cancel:null };
    }
    return { type:'other', key:'other', slots:[], cancel:null };
  }

  function sharedTargetCenter(slot) {
    const targetX = Number.parseFloat(slot?.dataset?.sharedSelectionTargetX || '');
    const targetY = Number.parseFloat(slot?.dataset?.sharedSelectionTargetY || '');
    if (Number.isFinite(targetX) && Number.isFinite(targetY)) return { x:targetX, y:targetY };
    const rect = slot.getBoundingClientRect();
    return { x:rect.left + rect.width / 2, y:rect.top + rect.height / 2 };
  }

  function hitSlot(slots, x, y) {
    let best = null;
    let bestDistance = Infinity;
    for (const slot of slots) {
      const rect = slot.getBoundingClientRect();
      const center = sharedTargetCenter(slot);
      const radius = Math.max(rect.width, rect.height) / 2 + HIT_PAD_PX;
      const distance = Math.hypot(x - center.x, y - center.y);
      if (distance <= radius && distance < bestDistance) { best = slot; bestDistance = distance; }
    }
    return best;
  }

  function logicalPointerForSlot(slot) {
    const x = Number.parseFloat(slot?.style?.left || '');
    const y = Number.parseFloat(slot?.style?.top || '');
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    return sharedTargetCenter(slot);
  }

  function branchDirection(slot) {
    if (slot?.classList.contains('medicine') || slotName(slot).startsWith('medicine')) return -1;
    if (slot?.classList.contains('utility') || slotName(slot).startsWith('utility')) return 1;
    return 0;
  }

  function categoryDirection(slot) {
    const name = slotName(slot);
    if (name.startsWith('healing') || name.startsWith('buffs')) return -1;
    if (name.startsWith('cures') || name.startsWith('flasks')) return 1;
    return 0;
  }

  function clearPressedSlot() {
    pressedSlot?.classList?.remove('mobile-potion-tap-pressed');
    pressedSlot = null;
  }

  function setPressedSlot(slot) {
    clearPressedSlot();
    if (!slot) return;
    pressedSlot = slot;
    slot.classList.add('mobile-potion-tap-pressed');
  }

  function stopBackdropGesture(ev) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }

  function onPointerDown(ev) {
    if (!mobilePointerMode() || !isTouchLikePointer(ev)) return;
    const stage = potionStage();
    if (stage.type === 'other') return;
    tapGesture = { pointerId:ev.pointerId, startX:ev.clientX, startY:ev.clientY, moved:false, stageKey:stage.key };
    const tappable = stage.type === 'category' && stage.cancel ? [...stage.slots, stage.cancel] : stage.slots;
    setPressedSlot(hitSlot(tappable, ev.clientX, ev.clientY));
    stopBackdropGesture(ev);
  }

  function onPointerMove(ev) {
    if (!tapGesture || ev.pointerId !== tapGesture.pointerId) return;
    if (Math.hypot(ev.clientX - tapGesture.startX, ev.clientY - tapGesture.startY) > TAP_SLOP_PX) {
      tapGesture.moved = true;
      clearPressedSlot();
    }
    stopBackdropGesture(ev);
  }

  function commitTap(stage, x, y, originalMovePointer, originalScrollEntries, originalReleaseSelection, originalClose) {
    if (stage.type === 'root') {
      const hit = hitSlot(stage.slots, x, y);
      const direction = branchDirection(hit);
      if (hit && direction) originalScrollEntries(direction);
      return;
    }
    if (stage.type === 'category') {
      if (stage.cancel && hitSlot([stage.cancel], x, y)) { originalClose?.(); return; }
      const hit = hitSlot(stage.slots, x, y);
      const direction = categoryDirection(hit);
      if (hit && direction) originalScrollEntries(direction);
      return;
    }
    if (stage.type === 'items') {
      const hit = hitSlot(stage.slots, x, y);
      if (!hit) return;
      const logical = logicalPointerForSlot(hit);
      originalMovePointer(logical.x, logical.y);
      originalReleaseSelection?.();
    }
  }

  function onPointerUp(ev, handlers) {
    if (!tapGesture || ev.pointerId !== tapGesture.pointerId) return;
    const gesture = tapGesture;
    tapGesture = null;
    clearPressedSlot();
    stopBackdropGesture(ev);
    if (gesture.moved) return;
    const stage = potionStage();
    if (stage.key !== gesture.stageKey) return;
    commitTap(stage, ev.clientX, ev.clientY, handlers.originalMovePointer, handlers.originalScrollEntries, handlers.originalReleaseSelection, handlers.originalClose);
  }

  function onPointerCancel(ev) {
    if (!tapGesture || ev.pointerId !== tapGesture.pointerId) return;
    tapGesture = null;
    clearPressedSlot();
    stopBackdropGesture(ev);
  }

  function install() {
    if (installed) return;
    const arc = window._desktopSelectionArc;
    if (!arc?.movePointer || !arc?.scrollEntries || !arc?.openPotions || !arc?.releaseSelection) return;
    installed = true;
    originalArc = arc;

    const originalMovePointer = arc.movePointer.bind(arc);
    const originalScrollEntries = arc.scrollEntries.bind(arc);
    const originalOpenPotions = arc.openPotions.bind(arc);
    const originalReleaseSelection = arc.releaseSelection.bind(arc);
    const originalClose = arc.close?.bind(arc);
    const originalEndHeldSelection = arc.endHeldSelection?.bind(arc);
    const handlers = { originalMovePointer, originalScrollEntries, originalReleaseSelection, originalClose };

    const overrides = {
      movePointer(x, y) {
        const stage = potionStage();
        if (mobilePointerMode() && stage.type !== 'other') return;
        return originalMovePointer(x, y);
      },
      openPotions(...args) { return originalOpenPotions(...args); },
      releaseSelection(...args) {
        const stage = potionStage();
        if (mobilePointerMode() && (stage.type === 'root' || stage.type === 'category')) return false;
        return originalReleaseSelection(...args);
      },
      endHeldSelection(...args) { return originalEndHeldSelection?.(...args); },
    };

    const boundMethods = new Map();
    wrappedArc = new Proxy(arc, {
      get(target, property) {
        if (Object.prototype.hasOwnProperty.call(overrides, property)) return overrides[property];
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        if (!boundMethods.has(property)) boundMethods.set(property, value.bind(target));
        return boundMethods.get(property);
      },
      set(target, property, value) { return Reflect.set(target, property, value, target); },
    });

    window._desktopSelectionArc = wrappedArc;
    if (window.SharedSelectionArch === arc) window.SharedSelectionArch = wrappedArc;

    document.addEventListener('pointerdown', onPointerDown, { capture:true, passive:false });
    document.addEventListener('pointermove', onPointerMove, { capture:true, passive:false });
    document.addEventListener('pointerup', ev => onPointerUp(ev, handlers), { capture:true, passive:false });
    document.addEventListener('pointercancel', onPointerCancel, { capture:true, passive:false });

    const style = document.createElement('style');
    style.id = 'mobilePotionTapStyles';
    style.textContent = `.arc-slot.mobile-potion-tap-pressed:not(.arc-arrow){filter:brightness(1.24)!important;outline:2px solid rgba(255,255,255,.72);outline-offset:2px;}`;
    document.head.appendChild(style);

    window.MobilePotionCategoryDrag = Object.freeze({
      diagnostics: () => ({ installed, mode:'tap-only', mobilePointerMode:mobilePointerMode(), stage:potionStage().type, tapGesture:tapGesture ? { ...tapGesture } : null, tapSlopPx:TAP_SLOP_PX, hitPadPx:HIT_PAD_PX }),
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
