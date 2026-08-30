// Final presentation reset for the grouped item selector.
// Category grouping/rings stay intact, but icon layout returns to the game's
// pre-feature selector styles and category headings use Potion Select text.
(() => {
  'use strict';
  if (window.ItemArchOriginalPresentation?.installed) return;

  const STYLE_ID = 'itemArchOriginalPresentationStyles'; // Used to keep this final reset idempotent if the HUD bootstrap is re-evaluated.

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Loaded once; higher specificity lets it beat earlier item-only overrides regardless of later style insertion.
    style.id = STYLE_ID;
    style.textContent = `
      /* Restore the item icon box to its pre-category-feature state. Deliberately
         do NOT set font-size or media max-size here: the existing game/shared
         selector CSS remains authoritative for the actual icon size. */
      html body .arc-slot.shared-selection-slot[data-item-category] .arc-icon,
      html body .arc-slot.shared-selection-slot[data-item-category].arc-active .arc-icon {
        display:inline !important;
        place-items:normal !important;
        width:auto !important;
        height:auto !important;
        min-width:auto !important;
        min-height:auto !important;
        box-sizing:border-box !important;
        border-radius:0 !important;
        background:none !important;
        box-shadow:none !important;
        filter:none !important;
        z-index:auto !important;
      }

      /* Category heading should be visually identical to Potion Select:
         sharp gold fill, black outline, same Khymeryyan face/size/spacing,
         same ordinary shadow, and no category-colour glow. */
      html #itemArchCategoryHeading .quick-potion-curved-category,
      html #itemArchStickyCategoryHeading .quick-potion-curved-category {
        fill:#f9e28a !important;
        stroke:rgba(0,0,0,.82) !important;
        stroke-width:3px !important;
        paint-order:stroke fill !important;
        font-family:'KhymeryyanRomanLetters+Numbers','Pixelify Sans',sans-serif !important;
        font-size:clamp(16px,2.5vmin,24px) !important;
        letter-spacing:.08em !important;
        text-shadow:0 2px 5px rgba(0,0,0,.8) !important;
        filter:none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function debugSnapshot() {
    const active = document.querySelector('.arc-slot[data-item-category].arc-active .arc-icon')
      || document.querySelector('.arc-slot[data-item-category] .arc-icon'); // Used to expose the currently rendered original-size icon styles on mobile.
    const heading = document.querySelector('#itemArchStickyCategoryHeading .quick-potion-curved-category')
      || document.querySelector('#itemArchCategoryHeading .quick-potion-curved-category'); // Used to verify Potion Select text parity without devtools.
    const iconStyle = active ? getComputedStyle(active) : null;
    const headingStyle = heading ? getComputedStyle(heading) : null;
    return {
      installed: true,
      styleInstalled: Boolean(document.getElementById(STYLE_ID)),
      icon: iconStyle ? {
        fontSize: iconStyle.fontSize,
        display: iconStyle.display,
        width: iconStyle.width,
        height: iconStyle.height,
        filter: iconStyle.filter,
      } : null,
      heading: headingStyle ? {
        fill: headingStyle.fill,
        stroke: headingStyle.stroke,
        fontFamily: headingStyle.fontFamily,
        fontSize: headingStyle.fontSize,
        filter: headingStyle.filter,
      } : null,
    };
  }

  window.ItemArchOriginalPresentation = {
    installed: true,
    refresh: installStyles,
    debugSnapshot,
  };

  installStyles();
})();
