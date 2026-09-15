(() => {
  'use strict';

  if (Number(window.HudXControlPolish?.version) >= 1) return;

  const VERSION = 1;
  const STYLE_ID = 'hudXControlPolishStyles'; // Prevents duplicate control-icon styling if the bootstrap is re-entered.

  function installStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* generic-hud-icons.js swaps semantic ✕/× controls to icon_x.png. Force that shared asset white everywhere instead of exposing its black source pixels. */
      .generic-hud-icon.generic-hud-icon-x {
        width:.78em;
        height:.78em;
        min-width:.78em;
        margin:0;
        vertical-align:-.04em;
        object-fit:contain;
        object-position:center;
        filter:brightness(0) invert(1);
        opacity:.96;
      }

      /* Symbol-only close/remove controls should use the whole button as their box and keep the X centered rather than inheriting text padding/line-height. */
      :is(
        #mpClose,
        .ies-unequip,
        .fed-close,
        .loomcraft-close,
        .pa-close,
        button[aria-label="Close"],
        button[aria-label="Cancel"],
        button[title^="Close" i],
        button[title^="Unequip" i],
        button[title^="Unassign" i],
        button[title^="Remove" i]
      ) {
        color:#fff !important;
      }

      :is(
        #mpClose,
        .ies-unequip,
        .fed-close,
        .loomcraft-close,
        .pa-close,
        button[aria-label="Close"],
        button[aria-label="Cancel"],
        button[title^="Close" i],
        button[title^="Unequip" i],
        button[title^="Unassign" i],
        button[title^="Remove" i]
      ):has(> .generic-hud-icon-x) {
        box-sizing:border-box;
        display:inline-grid;
        place-items:center;
        padding:0 !important;
        line-height:0 !important;
        text-align:center;
        overflow:hidden;
      }

      :is(
        #mpClose,
        .ies-unequip,
        .fed-close,
        .loomcraft-close,
        .pa-close,
        button[aria-label="Close"],
        button[aria-label="Cancel"],
        button[title^="Close" i],
        button[title^="Unequip" i],
        button[title^="Unassign" i],
        button[title^="Remove" i]
      ) > .generic-hud-icon-x {
        width:.68em;
        height:.68em;
        min-width:.68em;
        vertical-align:0;
      }

      /* The tiny gear unequip button is the tightest X container in the runtime, so give its icon an explicit bounded size rather than depending on inherited font metrics. */
      #mpInventory .ies-unequip > .generic-hud-icon-x {
        width:min(9px,70%);
        height:min(9px,70%);
        min-width:0;
      }
    `;
    document.head?.appendChild(style);
  }

  window.HudXControlPolish = Object.freeze({ version:VERSION, refresh:installStyles });
  if (typeof document !== 'undefined') installStyles();
})();