// Loading-screen bronze lettering treatment.
// Khymeryyan Roman uses plain white for readability.
// TankanScript keeps the item-category-inspired shiny bronze presentation.
// The Tankan verdigris raster overlay is disabled for now.
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
          #E0A36C 0%,
          #F0BC82 20%,
          #FBE0AF 41%,
          #FFF7E4 48%,
          #F2BE86 57%,
          #F9D59A 72%,
          #E7A96F 100%
        );
      }

      /* Khymeryyan Roman is now plain white for readability, while keeping a
         thin dark outline and shadow so it still reads cleanly on the loading
         screen background. */
      #hobunjiLoadScreen #hlsLoreHeader,
      #hobunjiLoadScreen #hlsLore,
      #hobunjiLoadScreen #hlsLore *,
      #hobunjiLoadScreen #hlsPercent {
        color:#fff !important;
        background:none !important;
        -webkit-background-clip:border-box;
        background-clip:border-box;
        -webkit-text-fill-color:#fff !important;
        -webkit-text-stroke:1px var(--hls-bronze-stroke);
        paint-order:stroke fill;
        text-shadow:0 2px 5px ${CATEGORY_SHADOW} !important;
        filter:none;
      }

      /* TankanScript stays as the live font. The bronze ramp has been lifted
         substantially overall, especially in the darker bands. */
      #hobunjiLoadScreen .hlsVerticalWord {
        color:var(--hls-bronze-metal) !important;
        background:var(--hls-metal-ramp);
        -webkit-background-clip:text;
        background-clip:text;
        -webkit-text-fill-color:transparent;
        -webkit-text-stroke:3px var(--hls-bronze-stroke);
        paint-order:stroke fill;
        text-shadow:0 2px 5px ${CATEGORY_SHADOW} !important;
        filter:drop-shadow(0 0 8px rgba(250,213,154,.58));
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
      loreTextMode: 'white',
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
      `metalText roman=${snapshot.loreTextMode} tankan=bronze`,
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
