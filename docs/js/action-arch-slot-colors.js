// Color-code the four melee combat bindings without changing attack logic.
// Loaded after the action-arch artwork/fix modules so it can tint whatever
// symbol each slot currently owns, including rebuilt DOM during movement.
(() => {
  'use strict';
  if (window.ActionArchSlotColors?.installed) return;

  const SLOT_COLORS = Object.freeze({
    tap1:  '#00D9FF', // Bright cyan: primary tap / combo.
    tap2:  '#FFD23F', // Gold: secondary tap / quick attack.
    hold1: '#FF4FD8', // Magenta: primary held attack.
    hold2: '#7CFF4F', // Lime: secondary held/defensive attack.
  });

  // These filters begin by flattening the source to black, so the same tint
  // works for black source PNGs, white canvas composites, and antialiased art.
  const SLOT_FILTERS = Object.freeze({
    tap1:  'brightness(0) saturate(100%) invert(79%) sepia(99%) saturate(3955%) hue-rotate(144deg) brightness(103%) contrast(106%)',
    tap2:  'brightness(0) saturate(100%) invert(86%) sepia(93%) saturate(1157%) hue-rotate(343deg) brightness(105%) contrast(101%)',
    hold1: 'brightness(0) saturate(100%) invert(49%) sepia(97%) saturate(3582%) hue-rotate(287deg) brightness(105%) contrast(104%)',
    hold2: 'brightness(0) saturate(100%) invert(89%) sepia(87%) saturate(1548%) hue-rotate(52deg) brightness(104%) contrast(103%)',
  });

  let observer = null; // Mutation observer that reapplies slot tint before rebuilt HUD content paints.

  function tintRoot(root, slotId) {
    if (!root) return;
    const color = SLOT_COLORS[slotId];
    const filter = SLOT_FILTERS[slotId];
    if (!color || !filter) return;

    root.dataset.combatSlotColor = slotId;
    root.style.setProperty('--combat-slot-color', color);

    // Combo uses a separate white numeral overlay; tint only its symbol image.
    root.querySelectorAll('img.action-arch-png, img.combat-combo-raster, img.action-arch-numbered-raster, .action-arch-combo-fallback > img, .action-arch-combo-layered > img').forEach(image => {
      image.style.filter = filter;
      image.dataset.combatSlotColor = slotId;
    });

    // Keep the combo count white; tint only true empty-slot X text and the
    // legacy fallback numeral path if that path is ever used.
    root.querySelectorAll('.combat-slot-x, .action-arch-combo-fallback > span').forEach(text => {
      text.style.color = color;
      text.dataset.combatSlotColor = slotId;
    });
  }

  function colorCombatButton(slotIndex) {
    const button = document.getElementById(`btnAction${slotIndex}`);
    // Ranged Action 2 can temporarily be the quiver selector; only tint the
    // actual two-sided combat coin, never potion/ammo utility controls.
    const coin = button?.querySelector?.('.combat-coin');
    if (!button?.classList?.contains('combat-dual-input') || !coin) return;

    tintRoot(coin.querySelector('.combat-coin-front .combat-main-symbol'), `tap${slotIndex}`);
    tintRoot(coin.querySelector('.combat-coin-back .combat-main-symbol'), `hold${slotIndex}`);

    // action-arch-icons-fixes.js moves this outside the clipped coin face.
    const exponent = [...button.children].find(child => child.classList?.contains('combat-hold-exponent'))
      || coin.querySelector('.combat-coin-front .combat-hold-exponent');
    tintRoot(exponent, `hold${slotIndex}`);
  }

  function applySlotColors() {
    colorCombatButton(1);
    colorCombatButton(2);
  }

  function install() {
    applySlotColors();

    // Both the game and the arch decorators rebuild button children while the
    // player moves or changes loadout. Mutation observers run before paint, so
    // tinting here keeps those rebuilds from flashing white between frames.
    observer = new MutationObserver(applySlotColors);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    window.addEventListener('hobunji-combat-input-state', applySlotColors);
    window.addEventListener('hobunjiPlayerReady', applySlotColors);
    document.addEventListener('hobunji-technique-unlocks-change', applySlotColors);
  }

  window.ActionArchSlotColors = {
    installed: true,
    colors: SLOT_COLORS,
    refresh: applySlotColors,
    debugSnapshot: () => ({
      colors: { ...SLOT_COLORS },
      observing: Boolean(observer),
      action1Combat: Boolean(document.getElementById('btnAction1')?.querySelector('.combat-coin')),
      action2Combat: Boolean(document.getElementById('btnAction2')?.querySelector('.combat-coin')),
    }),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
