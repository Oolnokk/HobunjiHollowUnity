// Mobile-only guard for the hierarchical Potion Select wheel.
// Category stages require a true outside-to-inside drag onto the actual button;
// concrete potion lists keep the selector's normal nearest-angle behavior.
(() => {
  'use strict';

  const DRAG_ARM_PX = 10; // Thumb jitter around Action 3 must not count as an intentional category drag.
  const HIT_RADIUS_SCALE = 0.72; // Uses an inner activation core so Action 3 cannot overlap a category's effective hit radius.
  const RECENT_POINTER_MS = 900; // Associates openPotions() with the touch that actually pressed Action 3.

  let installed = false; // Prevents wrapping the shared selector more than once.
  let lastPointerDown = null; // {x,y,pointerId,at} used as the first category-stage drag origin.
  let stageOrigin = null; // Reset at each hierarchy transition so every category tier needs a fresh drag.
  let stageGate = null; // {key,sawOutside}; category buttons trigger only after an outside-to-inside crossing.
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
    stageGate = null;
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
      const key = `category:${categories.map(slotName).sort().join('|')}`;
      return { type:'category', key, slots:categories, cancel };
    }

    const branches = liveSlots('.arc-slot.potion-branch:not(.potion-cancel):not(.arc-arrow)');
    if (branches.length) {
      const key = `root:${branches.map(slotName).sort().join('|')}`;
      return { type:'root', key, slots:branches, cancel:null };
    }

    const finalItems = liveSlots('.arc-slot.potion-cancel:not(.potion-branch):not(.arc-arrow)');
    if (finalItems.length) return { type:'items', key:'items', slots:[], cancel:null };
    return { type:'other', key:'other', slots:[], cancel:null };
  }

  function slotCenter(slot) {
    // Prefer the new wheel's final authored target rather than an in-flight animation
    // position. This keeps the touch core stable while the wheel fans or scrolls.
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
      const center = slotCenter(slot);
      const visualRadius = Math.max(rect.width, rect.height) / 2;
      const radius = Math.max(7, visualRadius * HIT_RADIUS_SCALE); // Intentional inner core, never an expanded overlapping halo.
      const distance = Math.hypot(x - center.x, y - center.y);
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

  function ensureStageGate(stage) {
    if (!stageGate || stageGate.key !== stage.key) {
      stageGate = { key:stage.key, sawOutside:false }; // A newly populated tier begins deliberately unarmed.
    }
    return stageGate;
  }

  function categoryEntryArmed(stage, x, y) {
    const gate = ensureStageGate(stage);
    const inside = Boolean(hitSlot(stage.slots, x, y));
    if (!gate.sawOutside) {
      if (!inside && movedFarEnough(x, y)) {
        gate.sawOutside = true; // The thumb has genuinely cleared every category activation core.
        stageOrigin = { x, y }; // Subsequent entry is measured from this neutral point, not Action 3.
      }
      return false; // The same event that leaves the overlap can never also select a category.
    }
    return inside;
  }

  function resetForNextTier(x, y) {
    stageOrigin = { x, y };
    stageGate = null; // Next potionStage() call creates a fresh outside-to-inside requirement.
  }

  function routeMobilePotionPointer(x, y, originalMovePointer, originalScrollEntries) {
    if (!mobilePointerMode()) return false;
    const stage = potionStage();
    if (stage.type === 'items' || stage.type === 'other') return false; // Final potion list keeps normal nearest-angle selection.

    if (stage.type === 'root') {
      if (!categoryEntryArmed(stage, x, y)) return true;
      const hit = hitSlot(stage.slots, x, y);
      if (!hit) return true;
      const direction = branchDirection(hit);
      if (!direction) return true;
      originalScrollEntries(direction); // Opens Medicine/Utility without game.js's recursive nearest-pointer re-evaluation.
      resetForNextTier(x, y); // Healing/Cures/Buffs/Flasks must also be entered from outside.
      return true;
    }

    // Cancel retains its special replacement behavior: if the branch button becomes
    // Cancel under the held finger, releasing there may still close the selector.
    if (stage.cancel && hitSlot([stage.cancel], x, y)) {
      originalMovePointer(x, y);
      return true;
    }

    if (!categoryEntryArmed(stage, x, y)) return true;
    const hit = hitSlot(stage.slots, x, y);
    if (!hit) return true;
    const direction = categoryDirection(hit);
    if (!direction) return true;
    originalScrollEntries(direction); // Opens Healing/Cures/Buffs/Flasks only after a true circle entry.

    // If enabled, scrollEntries synchronously opens the final concrete list. From
    // here onward the user's requested normal nearest-item behavior is restored.
    if (potionStage().type === 'items') {
      stageOrigin = null;
      stageGate = null;
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
        const result = originalOpenPotions(...args);
        if (mobilePointerMode()) {
          const recent = lastPointerDown && nowMs() - lastPointerDown.at <= RECENT_POINTER_MS;
          stageOrigin = recent ? { x:lastPointerDown.x, y:lastPointerDown.y } : null;
          stageGate = null; // Root never starts armed, even if Utility overlaps Action 3's touch point.
        }
        return result;
      },
      close(...args) {
        stageOrigin = null;
        stageGate = null;
        return originalClose?.(...args);
      },
      releaseSelection(...args) {
        const result = originalReleaseSelection?.(...args);
        stageOrigin = null;
        stageGate = null;
        return result;
      },
      endHeldSelection(...args) {
        const result = originalEndHeldSelection?.(...args);
        stageOrigin = null;
        stageGate = null;
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
        stageGate:stageGate ? { ...stageGate } : null,
        lastPointerDown:lastPointerDown ? { ...lastPointerDown } : null,
        dragArmPx:DRAG_ARM_PX,
        hitRadiusScale:HIT_RADIUS_SCALE,
      }),
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();