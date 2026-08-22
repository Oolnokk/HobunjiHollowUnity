// Mobile-only tap navigation for the hierarchical Potion Select wheel.
// Potion Select -> branch -> category -> concrete potion is a series of taps;
// desktop/controller retain the shared selector's original held/drag behavior.
(() => {
  'use strict';

  const TAP_SLOP_PX = 12; // Cancels a tap if the finger meaningfully drags.
  const HIT_PAD_PX = 5; // Small forgiveness around the visible half-size circle.

  let installed = false; // Prevents duplicate proxy/listener installation.
  let tapGesture = null; // Active mobile tap on an already-open potion stage.
  let pressedSlot = null; // Visual-only pressed-circle feedback.

  function mobilePointerMode() { return !window.matchMedia('(pointer: fine)').matches; }
  function touchLike(ev) { return !ev.pointerType || ev.pointerType === 'touch' || ev.pointerType === 'pen'; }
  function slotName(slot) { return String(slot?.getAttribute?.('aria-label') || slot?.title || slot?.querySelector?.('.arc-label')?.textContent || slot?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

  function liveSlots(selector) {
    return [...document.querySelectorAll(selector)].filter(slot => {
      if (slot.classList.contains('shared-selection-exit-ghost') || slot.classList.contains('shared-selection-retired-original')) return false;
      const style = getComputedStyle(slot);
      return style.display !== 'none' && style.visibility !== 'hidden'; // Ignore opacity: new-wheel fan-in starts at zero opacity.
    });
  }

  function stage() {
    const categories = liveSlots('.arc-slot.potion-category:not(.arc-arrow)');
    if (categories.length) {
      const cancel = liveSlots('.arc-slot.potion-branch.potion-cancel:not(.arc-arrow)')[0] || null;
      return { type:'category', key:`category:${categories.map(slotName).sort().join('|')}`, slots:categories, cancel };
    }
    const branches = liveSlots('.arc-slot.potion-branch:not(.potion-cancel):not(.arc-arrow)');
    if (branches.length) return { type:'root', key:`root:${branches.map(slotName).sort().join('|')}`, slots:branches, cancel:null };
    if (liveSlots('.arc-slot.potion-cancel:not(.potion-branch):not(.arc-arrow)').length) {
      const slots = liveSlots('.arc-slot:not(.arc-arrow)').filter(slot => !slot.classList.contains('potion-branch') && !slot.classList.contains('potion-category'));
      return { type:'items', key:`items:${slots.map(slotName).join('|')}`, slots, cancel:null };
    }
    return { type:'other', key:'other', slots:[], cancel:null };
  }

  function visualCenter(slot) {
    const x = Number.parseFloat(slot?.dataset?.sharedSelectionTargetX || '');
    const y = Number.parseFloat(slot?.dataset?.sharedSelectionTargetY || '');
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    const rect = slot.getBoundingClientRect();
    return { x:rect.left + rect.width / 2, y:rect.top + rect.height / 2 };
  }

  function hit(slots, x, y) {
    let best = null, distanceBest = Infinity;
    for (const slot of slots) {
      const rect = slot.getBoundingClientRect();
      const center = visualCenter(slot);
      const radius = Math.max(rect.width, rect.height) / 2 + HIT_PAD_PX;
      const distance = Math.hypot(x - center.x, y - center.y);
      if (distance <= radius && distance < distanceBest) { best = slot; distanceBest = distance; }
    }
    return best;
  }

  function logicalCenter(slot) {
    const x = Number.parseFloat(slot?.style?.left || '');
    const y = Number.parseFloat(slot?.style?.top || '');
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : visualCenter(slot); // game.js's hidden original arc point selects the exact tapped data slot.
  }

  function branchDir(slot) {
    if (slot?.classList.contains('medicine') || slotName(slot).startsWith('medicine')) return -1;
    if (slot?.classList.contains('utility') || slotName(slot).startsWith('utility')) return 1;
    return 0;
  }
  function categoryDir(slot) {
    const name = slotName(slot);
    if (name.startsWith('healing') || name.startsWith('buffs')) return -1;
    if (name.startsWith('cures') || name.startsWith('flasks')) return 1;
    return 0;
  }

  function clearPressed() { pressedSlot?.classList?.remove('mobile-potion-tap-pressed'); pressedSlot = null; }
  function press(slot) { clearPressed(); if (slot) { pressedSlot = slot; slot.classList.add('mobile-potion-tap-pressed'); } }
  function swallow(ev) { ev.preventDefault(); ev.stopImmediatePropagation(); } // Blocks .arc-backdrop nearest-angle drag logic.

  function install() {
    if (installed) return;
    const arc = window._desktopSelectionArc;
    if (!arc?.movePointer || !arc?.scrollEntries || !arc?.openPotions || !arc?.releaseSelection) return;
    installed = true;

    const movePointer = arc.movePointer.bind(arc);
    const scrollEntries = arc.scrollEntries.bind(arc);
    const openPotions = arc.openPotions.bind(arc);
    const releaseSelection = arc.releaseSelection.bind(arc);
    const close = arc.close?.bind(arc);
    const endHeldSelection = arc.endHeldSelection?.bind(arc);

    const overrides = {
      movePointer(x, y) {
        if (mobilePointerMode() && stage().type !== 'other') return; // No potion drag navigation on mobile, including concrete lists.
        return movePointer(x, y);
      },
      openPotions(...args) { return openPotions(...args); },
      releaseSelection(...args) {
        const current = stage();
        if (mobilePointerMode() && (current.type === 'root' || current.type === 'category')) return false; // Initial Potion Select release leaves the tapped hierarchy open.
        return releaseSelection(...args);
      },
      endHeldSelection(...args) { return endHeldSelection?.(...args); },
    };
    const bound = new Map();
    const proxy = new Proxy(arc, {
      get(target, property) {
        if (Object.prototype.hasOwnProperty.call(overrides, property)) return overrides[property];
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        if (!bound.has(property)) bound.set(property, value.bind(target));
        return bound.get(property);
      },
      set(target, property, value) { return Reflect.set(target, property, value, target); },
    });
    window._desktopSelectionArc = proxy;
    if (window.SharedSelectionArch === arc) window.SharedSelectionArch = proxy;

    document.addEventListener('pointerdown', ev => {
      if (!mobilePointerMode() || !touchLike(ev)) return;
      const current = stage();
      if (current.type === 'other') return; // Let the original Action 3 tap open the root.
      tapGesture = { pointerId:ev.pointerId, x:ev.clientX, y:ev.clientY, moved:false, stageKey:current.key };
      const tappable = current.type === 'category' && current.cancel ? [...current.slots, current.cancel] : current.slots;
      press(hit(tappable, ev.clientX, ev.clientY));
      swallow(ev);
    }, { capture:true, passive:false });

    document.addEventListener('pointermove', ev => {
      if (!tapGesture || ev.pointerId !== tapGesture.pointerId) return;
      if (Math.hypot(ev.clientX - tapGesture.x, ev.clientY - tapGesture.y) > TAP_SLOP_PX) { tapGesture.moved = true; clearPressed(); }
      swallow(ev); // Movement never navigates; it can only cancel the pending tap.
    }, { capture:true, passive:false });

    document.addEventListener('pointerup', ev => {
      if (!tapGesture || ev.pointerId !== tapGesture.pointerId) return;
      const gesture = tapGesture; tapGesture = null; clearPressed(); swallow(ev);
      if (gesture.moved) return;
      const current = stage();
      if (current.key !== gesture.stageKey) return;

      if (current.type === 'root') {
        const slot = hit(current.slots, ev.clientX, ev.clientY), direction = branchDir(slot);
        if (slot && direction) scrollEntries(direction);
        return;
      }
      if (current.type === 'category') {
        if (current.cancel && hit([current.cancel], ev.clientX, ev.clientY)) { close?.(); return; }
        const slot = hit(current.slots, ev.clientX, ev.clientY), direction = categoryDir(slot);
        if (slot && direction) scrollEntries(direction);
        return;
      }
      if (current.type === 'items') {
        const slot = hit(current.slots, ev.clientX, ev.clientY);
        if (!slot) return;
        const point = logicalCenter(slot);
        movePointer(point.x, point.y); // Exact tapped slot, not nearest visual angle.
        releaseSelection(); // Concrete potion/final Cancel commits on this tap.
      }
    }, { capture:true, passive:false });

    document.addEventListener('pointercancel', ev => {
      if (!tapGesture || ev.pointerId !== tapGesture.pointerId) return;
      tapGesture = null; clearPressed(); swallow(ev);
    }, { capture:true, passive:false });

    const style = document.createElement('style');
    style.id = 'mobilePotionTapStyles';
    style.textContent = `.arc-slot.mobile-potion-tap-pressed:not(.arc-arrow){filter:brightness(1.24)!important;outline:2px solid rgba(255,255,255,.72);outline-offset:2px;}`;
    document.head.appendChild(style);

    window.MobilePotionTapNavigation = Object.freeze({ diagnostics:() => ({ installed, mode:'tap-only', mobilePointerMode:mobilePointerMode(), stage:stage().type, tapSlopPx:TAP_SLOP_PX, hitPadPx:HIT_PAD_PX }) });
    window.MobilePotionCategoryDrag = window.MobilePotionTapNavigation; // Compatibility alias for the previous diagnostic object name.
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
