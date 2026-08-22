// Mobile-only guard for the hierarchical Potion Select wheel.
// Category stages require an intentional drag onto the actual category button;
// concrete potion lists keep the selector's normal nearest-angle behavior.
(() => {
  'use strict';

  const DRAG_ARM_PX = 10; // Thumb jitter around Action 3 must not count as an intentional category drag.
  const HIT_PAD_PX = 5; // Small touch forgiveness around the half-size visual category circles.
  const RECENT_POINTER_MS = 900; // Associates openPotions() with the touch that actually pressed Action 3.

  let installed = false; // Prevents wrapping the shared selector more than once.
  let lastPointerDown = null; // {x,y,pointerId,at} used as the first category-stage drag origin.
  let stageOrigin = null; // Reset at each category hierarchy transition so every stage needs a fresh drag.
  let activePointerId = null; // Keeps unrelated touches from arming the potion hierarchy.
  let originalArc = null; // Authoritative shared selector object created by game.js.
  let wrappedArc = null; // Proxy that intercepts only mobile potion hierarchy pointer movement.

  function mobilePointerMode() {
    return !window.matchMedia('(pointer: fine)').matches; // Mirrors game.js's own desktop/mobile split.
  }

  function nowMs() {
    return performance.now();
  }

  function rememberPointerDown(ev) {
    if (!mobilePointerMode()) return;
    if (ev.pointerType && ev.pointerType !== 'touch' && ev.pointerType !== 'pen') return;
    lastPointerDown = { x:ev.clientX, y:ev.clientY, pointerId:ev.pointerId, at:nowMs() };
    activePointerId = ev.pointerId;
  }

  function clearPointer(ev) {
    if (activePointerId !== null && ev?.pointerId !== undefined && ev.pointerId !== activePointerId) return;
    activePointerId = null;
    lastPointerDown = null;
    stageOrigin = null;
  }

  function liveSlots(selector) {
    return [...document.querySelectorAll(selector)].filter(slot => {
      if (slot.classList.contains('shared-selection-exit-ghost')) return false;
      const style = getComputedStyle(slot);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05;
    });
  }

  function potionStage() {
    const categories = liveSlots('.arc-slot.potion-category:not(.arc-arrow)');
    if (categories.length) {
      const cancel = liveSlots('.arc-slot.potion-branch.potion-cancel:not(.arc-arrow)')[0] || null;
      return { type:'category', slots:categories, cancel };
    }

    const branches = liveSlots('.arc-slot.potion-branch:not(.potion-cancel):not(.arc-arrow)');
    if (branches.length) return { type:'root', slots:branches, cancel:null };

    const finalItems = liveSlots('.arc-slot.potion-cancel:not(.potion-branch):not(.arc-arrow)');
    if (finalItems.length) return { type:'items', slots:[], cancel:null };
    return { type:'other', slots:[], cancel:null };
  }

  function hitSlot(slots, x, y) {
    let best = null;
    let bestDistance = Infinity;
    for (const slot of slots) {
      const rect = slot.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const radius = Math.max(rect.width, rect.height) / 2 + HIT_PAD_PX;
      const distance = Math.hypot(x - cx, y - cy);
      if (distance <= radius && distance < bestDistance) {
        best = slot;
        bestDistance = distance;
      }
    }
    return best;
  }

  function movedFarEnough(x, y) {
    const origin = stageOrigin || (lastPointerDown && nowMs() - lastPointerDown.at <= RECENT_POINTER_MS ? lastPointerDown : null);
    if (!origin) return true;
    return Math.hypot(x - origin.x, y - origin.y) >= DRAG_ARM_PX;
  }

  function slotName(slot) {
    return String(slot?.getAttribute?.('aria-label') || slot?.title || slot?.querySelector?.('.arc-label')?.textContent || slot?.textContent || '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
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

  function routeMobilePotionPointer(x, y, originalMovePointer, originalScrollEntries) {
    if (!mobilePointerMode()) return false;
    const stage = potionStage();
    if (stage.type === 'items' || stage.type === 'other') return false; // Final potion list keeps normal nearest-angle selection.

    if (!movedFarEnough(x, y)) return true; // Swallow thumb jitter while still near the button/stage entry point.

    if (stage.type === 'root') {
      const hit = hitSlot(stage.slots, x, y);
      if (!hit) return true; // Nearest branch is never enough on mobile; the finger must actually enter its circle.
      const direction = branchDirection(hit);
      if (!direction) return true;
      originalScrollEntries(direction); // Opens Medicine/Utility without invoking game.js's recursive nearest-pointer re-evaluation.
      stageOrigin = { x, y }; // The next category tier now needs another intentional drag from this point.
      return true;
    }

    if (stage.cancel && hitSlot([stage.cancel], x, y)) {
      originalMovePointer(x, y); // Preserve the branch-level Cancel highlight/release behavior.
      return true;
    }

    const hit = hitSlot(stage.slots, x, y);
    if (!hit) return true;
    const direction = categoryDirection(hit);
    if (!direction) return true;
    originalScrollEntries(direction); // Opens Healing/Cures/Buffs/Flasks only after an actual button hit.

    // If that category was enabled, scrollEntries synchronously opened the final potion list.
    // Re-apply the same pointer there so concrete potions retain the existing nearest-item behavior.
    if (potionStage().type === 'items') {
      stageOrigin = null;
      originalMovePointer(x, y);
    }
    return true;
  }

  function install() {
    if (installed) return;
    const arc = window._desktopSelectionArc;
    if (!arc?.movePointer || !arc?.scrollEntries || !arc?.openPotions) return;
    installed = true;
    originalArc = arc;

    const originalMovePointer = arc.movePointer.bind(arc);
    const originalScrollEntries = arc.scrollEntries.bind(arc);
    const originalOpenPotions = arc.openPotions.bind(arc);
    const originalClose = arc.close?.bind(arc);
    const originalReleaseSelection = arc.releaseSelection?.bind(arc);
    const originalEndHeldSelection = arc.endHeldSelection?.bind(arc);

    const overrides = {
      movePointer(x, y) {
        if (routeMobilePotionPointer(x, y, originalMovePointer, originalScrollEntries)) return;
        return originalMovePointer(x, y);
      },
      openPotions(...args) {
        if (mobilePointerMode()) {
          const recent = lastPointerDown && nowMs() - lastPointerDown.at <= RECENT_POINTER_MS;
          stageOrigin = recent ? { x:lastPointerDown.x, y:lastPointerDown.y } : null;
        }
        return originalOpenPotions(...args);
      },
      close(...args) {
        stageOrigin = null;
        return originalClose?.(...args);
      },
      releaseSelection(...args) {
        const result = originalReleaseSelection?.(...args);
        stageOrigin = null;
        return result;
      },
      endHeldSelection(...args) {
        const result = originalEndHeldSelection?.(...args);
        stageOrigin = null;
        return result;
      },
    };

    const boundMethods = new Map(); // Keeps non-overridden shared-selector methods bound to the original closure-owning object.
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

    document.addEventListener('pointerdown', rememberPointerDown, { capture:true, passive:true });
    document.addEventListener('pointerup', clearPointer, { capture:true, passive:true });
    document.addEventListener('pointercancel', clearPointer, { capture:true, passive:true });

    window.MobilePotionCategoryDrag = Object.freeze({
      diagnostics: () => ({
        installed,
        mobilePointerMode:mobilePointerMode(),
        stage:potionStage().type,
        stageOrigin:stageOrigin ? { ...stageOrigin } : null,
        lastPointerDown:lastPointerDown ? { ...lastPointerDown } : null,
        dragArmPx:DRAG_ARM_PX,
        hitPadPx:HIT_PAD_PX,
      }),
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
