// Mobile-only tap navigation for Potion Select.
// Mobile: Potion Select -> branch -> category -> concrete potion is taps only.
// Desktop/controller keep the original shared-selector behavior.
(() => {
  'use strict';
  const TAP_SLOP_PX = 12;
  const HIT_PAD_PX = 5;
  let installed = false;
  let tapGesture = null;
  let pressedSlot = null;

  const mobile = () => !window.matchMedia('(pointer: fine)').matches;
  const touchLike = ev => !ev.pointerType || ev.pointerType === 'touch' || ev.pointerType === 'pen';
  const slotName = slot => String(slot?.getAttribute?.('aria-label') || slot?.title || slot?.querySelector?.('.arc-label')?.textContent || slot?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  function live(selector) {
    return [...document.querySelectorAll(selector)].filter(slot => {
      if (slot.classList.contains('shared-selection-exit-ghost') || slot.classList.contains('shared-selection-retired-original')) return false;
      const style = getComputedStyle(slot);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }
  function currentStage() {
    const categories = live('.arc-slot.potion-category:not(.arc-arrow)');
    if (categories.length) return { type:'category', key:`category:${categories.map(slotName).sort().join('|')}`, slots:categories, cancel:live('.arc-slot.potion-branch.potion-cancel:not(.arc-arrow)')[0] || null };
    const branches = live('.arc-slot.potion-branch:not(.potion-cancel):not(.arc-arrow)');
    if (branches.length) return { type:'root', key:`root:${branches.map(slotName).sort().join('|')}`, slots:branches, cancel:null };
    if (live('.arc-slot.potion-cancel:not(.potion-branch):not(.arc-arrow)').length) {
      const slots = live('.arc-slot:not(.arc-arrow)').filter(slot => !slot.classList.contains('potion-branch') && !slot.classList.contains('potion-category'));
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
    let best = null, bestDistance = Infinity;
    for (const slot of slots) {
      const rect = slot.getBoundingClientRect();
      const c = visualCenter(slot);
      const d = Math.hypot(x - c.x, y - c.y);
      if (d <= Math.max(rect.width, rect.height) / 2 + HIT_PAD_PX && d < bestDistance) { best = slot; bestDistance = d; }
    }
    return best;
  }
  function logicalCenter(slot) {
    const x = Number.parseFloat(slot?.style?.left || '');
    const y = Number.parseFloat(slot?.style?.top || '');
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : visualCenter(slot);
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
  function swallow(ev) { ev.preventDefault(); ev.stopImmediatePropagation(); }

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
      movePointer(x, y) { if (mobile() && currentStage().type !== 'other') return; return movePointer(x, y); },
      openPotions(...args) { return openPotions(...args); },
      releaseSelection(...args) {
        const stage = currentStage();
        if (mobile() && (stage.type === 'root' || stage.type === 'category')) return false;
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
      if (!mobile() || !touchLike(ev)) return;
      const stage = currentStage();
      if (stage.type === 'other') return;
      tapGesture = { pointerId:ev.pointerId, x:ev.clientX, y:ev.clientY, moved:false, stageKey:stage.key };
      press(hit(stage.type === 'category' && stage.cancel ? [...stage.slots, stage.cancel] : stage.slots, ev.clientX, ev.clientY));
      swallow(ev);
    }, { capture:true, passive:false });
    document.addEventListener('pointermove', ev => {
      if (!tapGesture || ev.pointerId !== tapGesture.pointerId) return;
      if (Math.hypot(ev.clientX - tapGesture.x, ev.clientY - tapGesture.y) > TAP_SLOP_PX) { tapGesture.moved = true; clearPressed(); }
      swallow(ev);
    }, { capture:true, passive:false });
    document.addEventListener('pointerup', ev => {
      if (!tapGesture || ev.pointerId !== tapGesture.pointerId) return;
      const gesture = tapGesture; tapGesture = null; clearPressed(); swallow(ev);
      if (gesture.moved) return;
      const stage = currentStage();
      if (stage.key !== gesture.stageKey) return;
      if (stage.type === 'root') {
        const slot = hit(stage.slots, ev.clientX, ev.clientY), dir = branchDir(slot);
        if (slot && dir) scrollEntries(dir);
      } else if (stage.type === 'category') {
        if (stage.cancel && hit([stage.cancel], ev.clientX, ev.clientY)) close?.();
        else { const slot = hit(stage.slots, ev.clientX, ev.clientY), dir = categoryDir(slot); if (slot && dir) scrollEntries(dir); }
      } else if (stage.type === 'items') {
        const slot = hit(stage.slots, ev.clientX, ev.clientY);
        if (slot) { const p = logicalCenter(slot); movePointer(p.x, p.y); releaseSelection(); }
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
    window.MobilePotionTapNavigation = Object.freeze({ diagnostics:() => ({ installed, mode:'tap-only', mobilePointerMode:mobile(), stage:currentStage().type, tapSlopPx:TAP_SLOP_PX, hitPadPx:HIT_PAD_PX }) });
    window.MobilePotionCategoryDrag = window.MobilePotionTapNavigation;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
