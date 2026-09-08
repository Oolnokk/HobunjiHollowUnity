// Loading-screen bronze lettering treatment.
// Khymeryyan Roman and TankanScript keep the item-category-inspired shiny
// bronze presentation. The Tankan verdigris raster overlay is disabled for now.
(() => {
  'use strict';
  if (window.LoadingScreenMetalText?.installed) return;

  const STYLE_ID = 'loadingScreenMetalTextStyles'; // Keeps loading-screen metal presentation idempotent.
  const DEBUG_ID = 'hlsMetalTextDebug'; // Extends the existing five-tap loading diagnostics.
  const BRONZE_HEX = '#CD7F32'; // Repo-authored Tin Bronze base hue.
  const VERDIGRIS_HEX = '#57B38B'; // Retained for future oxidation work; not rendered right now.
  const VERDIGRIS_AMOUNT = 0.25; // Retained for diagnostics/future overlay restoration.
  const CATEGORY_STROKE = 'rgba(0,0,0,.82)'; // Mirrors the item-category heading outline.
  const CATEGORY_SHADOW = 'rgba(0,0,0,.8)'; // Mirrors the item-category heading shadow.

  let rootObserver = null; // Waits for LoadingScreenRuntime to create the loading DOM.

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Keeps this treatment isolated from the loading runtime.
    style.id = STYLE_ID;
    style.textContent = `
      #hobunjiLoadScreen {
        --hls-bronze-metal:${BRONZE_HEX};
        --hls-bronze-stroke:${CATEGORY_STROKE};
        --hls-metal-ramp:linear-gradient(
          180deg,
          #A86432 0%,
          #D0823E 20%,
          #F4C379 41%,
          #FFE7B3 48%,
          #D98B46 57%,
          #F0B66A 72%,
          #AD6B36 100%
        );
      }

      /* Khymeryyan Roman is only ~15-19px on the loading screen, so it needs a
         much thinner outline than the ~89px Tankan script. Apply the metallic
         fill only to actual text-bearing nodes so the gradient occupies the
         glyph interiors instead of being clipped on the parent lore container. */
      #hobunjiLoadScreen #hlsLoreHeader,
      #hobunjiLoadScreen #hlsLore,
      #hobunjiLoadScreen #hlsLore *,
      #hobunjiLoadScreen #hlsPercent {
        color:var(--hls-bronze-metal) !important;
        background:var(--hls-metal-ramp);
        -webkit-background-clip:text;
        background-clip:text;
        -webkit-text-fill-color:transparent;
        -webkit-text-stroke:1px var(--hls-bronze-stroke);
        paint-order:stroke fill;
        text-shadow:0 2px 5px ${CATEGORY_SHADOW} !important;
        filter:drop-shadow(0 0 6px rgba(240,182,106,.42));
      }

      /* TankanScript stays as the live font with the same brightened metallic
         ramp. Its much larger glyphs keep the full 3px category-style outline. */
      #hobunjiLoadScreen .hlsVerticalWord {
        color:var(--hls-bronze-metal) !important;
        background:var(--hls-metal-ramp);
        -webkit-background-clip:text;
        background-clip:text;
        -webkit-text-fill-color:transparent;
        -webkit-text-stroke:3px var(--hls-bronze-stroke);
        paint-order:stroke fill;
        text-shadow:0 2px 5px ${CATEGORY_SHADOW} !important;
        filter:drop-shadow(0 0 6px rgba(240,182,106,.42));
      }

      /* Explicitly suppress any stale overlay nodes left by a hot reload or an
         older cached module evaluation. */
      #hobunjiLoadScreen .hlsBronzeVerdigrisGlyphImage {
        display:none !important;
      }

      #${DEBUG_ID} {
        display:none;
        position:absolute;
        right:max(4vw,24px);
        bottom:max(22vh,150px);
        max-width:min(84vw,440px);
        padding:8px 10px;
        border:1px solid rgba(205,127,50,.48);
        border-radius:7px;
        background:rgba(0,0,0,.82);
        color:#eee;
        font:11px/1.35 monospace;
        white-space:pre-wrap;
        text-align:left;
        text-shadow:none;
      }
      #hlsDebug.visible ~ #${DEBUG_ID} { display:block; }
    `;
    document.head.appendChild(style);
  }

  function debugSnapshot() {
    const root = document.getElementById('hobunjiLoadScreen'); // Reports whether the loading screen has been built.
    const scriptWords = document.getElementById('hlsScriptWords'); // Reports whether the Tankan phrase container exists.
    return {
      installed: true,
      bronzeHex: BRONZE_HEX,
      verdigrisHex: VERDIGRIS_HEX,
      verdigrisAmount: VERDIGRIS_AMOUNT,
      loadingDomReady: Boolean(root && scriptWords),
      overlayEnabled: false,
    };
  }

  function updateDebugPanel() {
    const root = document.getElementById('hobunjiLoadScreen'); // Parent for the loading-screen diagnostics extension.
    if (!root) return;
    let panel = document.getElementById(DEBUG_ID);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = DEBUG_ID;
      root.appendChild(panel);
    }
    const snapshot = debugSnapshot();
    panel.textContent = [
      `metalText bronze=${snapshot.bronzeHex}`,
      `verdigris=${snapshot.verdigrisHex}@${Math.round(snapshot.verdigrisAmount * 100)}% overlay=off`,
      `loadingDom=${snapshot.loadingDomReady ? 'ready' : 'waiting'}`,
    ].join('\n');
  }

  function attachRuntime() {
    const root = document.getElementById('hobunjiLoadScreen');
    const scriptWords = document.getElementById('hlsScriptWords');
    if (!root || !scriptWords) return false;
    updateDebugPanel();
    return true;
  }

  function watchForRuntime() {
    if (attachRuntime()) return;
    if (rootObserver || !document.documentElement) return;
    rootObserver = new MutationObserver(() => {
      if (!attachRuntime()) return;
      rootObserver?.disconnect();
      rootObserver = null;
    });
    rootObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.LoadingScreenMetalText = {
    installed: true,
    refresh: updateDebugPanel,
    debugSnapshot,
    bronzeHex: BRONZE_HEX,
    verdigrisHex: VERDIGRIS_HEX,
    verdigrisAmount: VERDIGRIS_AMOUNT,
    overlayEnabled: false,
  };

  installStyles();
  watchForRuntime();
})();
