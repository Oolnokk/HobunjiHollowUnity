// Loading-screen bronze lettering treatment.
// Roman text borrows the item-selector category heading's fill/stroke/shadow
// presentation. TankanScript additionally rasterizes each glyph as a tiny
// sprite and sends it through ToolMetalRecolor at exactly 50% oxidation, so
// its verdigris uses the same seeded spread + black boundary logic as tools.
(() => {
  'use strict';
  if (window.LoadingScreenMetalText?.installed) return;

  const STYLE_ID = 'loadingScreenMetalTextStyles'; // Used to keep the loading-screen metal presentation idempotent.
  const DEBUG_ID = 'hlsMetalTextDebug'; // Used to extend the loading screen's existing five-tap diagnostics with metal-text state.
  const BRONZE_HEX = '#CD7F32'; // Used for clean lettering; matches METAL_DEFS.tinBronze from the tool-metal palette.
  const VERDIGRIS_HEX = '#57B38B'; // Used for Tankan oxidation; matches METAL_DEFS.tinBronze.verdigrisHex.
  const VERDIGRIS_AMOUNT = 0.5; // Used as ToolMetalRecolor.oxidationAmount for an exact 50% verdigris spread.
  const FALLBACK_SOURCE_HEX = '#5A8480'; // Used only if ToolMetalRecolor has not exposed its canonical placeholder source color.
  const CATEGORY_STROKE = 'rgba(0,0,0,.82)'; // Used to mirror the item-category heading's dark SVG stroke.
  const CATEGORY_SHADOW = 'rgba(0,0,0,.8)'; // Used to mirror the item-category heading's 0 2px 5px text shadow.
  const GLYPH_STROKE_PX = 3; // Used when rasterizing Tankan glyph sprites to match the category heading's 3px stroke.
  const GLYPH_CACHE = new Map(); // Used to reuse the same rasterized/recolored Tankan glyph at the same display size.

  let rootObserver = null; // Used until LoadingScreenRuntime creates #hobunjiLoadScreen.
  let scriptObserver = null; // Used after creation to catch every renderScript() replacement of Tankan glyph spans.
  let refreshQueued = false; // Used to collapse mutation/resize bursts into one pre-paint refresh.
  let dependencyRetryTimer = null; // Used when the loading-screen DOM appears before ToolMetalRecolor is ready.
  let processedGlyphs = 0; // Used by the built-in diagnostics panel to report successful verdigris sprites.
  let failedGlyphs = 0; // Used by diagnostics to surface per-glyph raster/recolor failures without a console.
  let lastError = ''; // Used by diagnostics to retain the most recent rendering error on mobile.

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Used to apply the item-category treatment without modifying LoadingScreenRuntime's base CSS.
    style.id = STYLE_ID;
    style.textContent = `
      #hobunjiLoadScreen {
        --hls-bronze-metal:${BRONZE_HEX};
        --hls-bronze-stroke:${CATEGORY_STROKE};
      }

      /* Match Item Select's category heading: metal fill, black stroke,
         paint-order equivalent, and the same 0 2px 5px shadow. Semantic tip
         colors intentionally yield to the requested all-bronze Roman text. */
      #hobunjiLoadScreen #hlsLoreBlock,
      #hobunjiLoadScreen #hlsLoreBlock *,
      #hobunjiLoadScreen #hlsPercent {
        color:var(--hls-bronze-metal) !important;
        -webkit-text-stroke:3px var(--hls-bronze-stroke);
        paint-order:stroke fill;
        text-shadow:0 2px 5px ${CATEGORY_SHADOW} !important;
      }

      /* This is the non-raster fallback. Once the Tankan font and recolorer
         are ready, each glyph becomes a real 50%-verdigris sprite below. */
      #hobunjiLoadScreen .hlsVerticalWord {
        color:var(--hls-bronze-metal) !important;
        -webkit-text-stroke:3px var(--hls-bronze-stroke);
        paint-order:stroke fill;
        text-shadow:0 2px 5px ${CATEGORY_SHADOW} !important;
      }
      #hobunjiLoadScreen .hlsVerticalGlyph.hlsBronzeVerdigrisGlyph {
        position:relative;
        color:transparent !important;
        -webkit-text-stroke:0 transparent;
        text-shadow:none !important;
      }
      #hobunjiLoadScreen .hlsBronzeVerdigrisGlyphImage {
        position:absolute;
        left:50%;
        top:50%;
        max-width:none;
        pointer-events:none;
        user-select:none;
        transform:translate(-50%,-50%);
        filter:drop-shadow(0 2px 5px ${CATEGORY_SHADOW});
      }

      /* The loading screen already exposes diagnostics by tapping the percent
         five times. Piggyback on that state so metal-text failures are visible
         on mobile without requiring DevTools or a console. */
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

  function hexToRgb(hex) {
    const clean = String(hex || '').replace('#', '').trim(); // Used to normalize authored metal hex strings before HSV conversion.
    const full = clean.length === 3 ? clean.split('').map(char => char + char).join('') : clean; // Used to support short hex defensively.
    const value = Number.parseInt(full || '000000', 16); // Used to unpack red/green/blue channels for ToolMetalRecolor's HSV helper.
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function rgbToHex(rgb) {
    const channels = rgb.map(value => Math.max(0, Math.min(255, Math.round(value)))); // Used to clamp the source placeholder shade before drawing to canvas.
    return `#${channels.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }

  function debugSnapshot() {
    const root = document.getElementById('hobunjiLoadScreen'); // Used to report whether LoadingScreenRuntime has painted its DOM yet.
    const scriptWords = document.getElementById('hlsScriptWords'); // Used to count current Tankan glyphs for mobile diagnostics.
    const glyphs = scriptWords ? [...scriptWords.querySelectorAll('.hlsVerticalGlyph')] : []; // Used to compare current glyph count with processed sprites.
    return {
      installed: true,
      bronzeHex: BRONZE_HEX,
      verdigrisHex: VERDIGRIS_HEX,
      verdigrisAmount: VERDIGRIS_AMOUNT,
      toolMetalReady: Boolean(window.ToolMetalRecolor?.getRecoloredCanvas),
      loadingDomReady: Boolean(root && scriptWords),
      tankanFontReady: Boolean(document.fonts?.check?.('32px "TankanScript"')),
      glyphs: glyphs.length,
      decoratedGlyphs: glyphs.filter(glyph => glyph.classList.contains('hlsBronzeVerdigrisGlyph')).length,
      processedGlyphs,
      failedGlyphs,
      cacheEntries: GLYPH_CACHE.size,
      lastError: lastError || null,
    };
  }

  function updateDebugPanel() {
    const root = document.getElementById('hobunjiLoadScreen'); // Used as the insertion parent for the existing loading-screen diagnostics extension.
    if (!root) return;
    let panel = document.getElementById(DEBUG_ID); // Used to reuse one diagnostics panel across repeated loading sessions.
    if (!panel) {
      panel = document.createElement('div');
      panel.id = DEBUG_ID;
      root.appendChild(panel);
    }
    const snapshot = debugSnapshot(); // Used to format the compact no-console status readout below.
    panel.textContent = [
      `metalText bronze=${snapshot.bronzeHex} verdigris=${snapshot.verdigrisHex}@${Math.round(snapshot.verdigrisAmount * 100)}%`,
      `toolMetal=${snapshot.toolMetalReady ? 'ready' : 'waiting'} tankanFont=${snapshot.tankanFontReady ? 'ready' : 'waiting'}`,
      `glyphs=${snapshot.decoratedGlyphs}/${snapshot.glyphs} processed=${snapshot.processedGlyphs} failed=${snapshot.failedGlyphs}`,
      `cache=${snapshot.cacheEntries} lastError=${snapshot.lastError || 'none'}`,
    ].join('\n');
  }

  function sourceFillHex(tool) {
    const sourceHex = tool.SOURCE_HEX || FALLBACK_SOURCE_HEX; // Used as the hue/saturation that ToolMetalRecolor recognizes as metal.
    const sourceRgb = hexToRgb(sourceHex); // Used to recover the canonical source hue/saturation.
    const bronzeRgb = hexToRgb(BRONZE_HEX); // Used only to borrow Tin Bronze's authored value/brightness.
    const sourceHsv = tool.rgbToHsv(...sourceRgb); // Used to keep the placeholder inside the tool recolorer's source-metal mask.
    const bronzeHsv = tool.rgbToHsv(...bronzeRgb); // Used to make a flat source pixel recolor to the authored bronze brightness rather than the darker placeholder value.
    const adjustedRgb = tool.hsvToRgb(sourceHsv.h, sourceHsv.s, bronzeHsv.v); // Used as the canvas fill that becomes exactly Tin Bronze after recoloring.
    return rgbToHex(adjustedRgb);
  }

  function glyphFontSizePx(glyph) {
    const style = getComputedStyle(glyph); // Used to preserve LoadingScreenRuntime's configured Tankan script size.
    const size = Number.parseFloat(style.fontSize); // Used as the display-space font size for raster dimensions.
    return Number.isFinite(size) && size > 1 ? size : 89;
  }

  function glyphCacheKey(character, fontSizePx, scale) {
    return `${character}|${fontSizePx.toFixed(3)}|${scale.toFixed(2)}|${BRONZE_HEX}|${VERDIGRIS_HEX}|${VERDIGRIS_AMOUNT}`;
  }

  function makeGlyphSource(character, fontSizePx, scale, tool) {
    const renderFontPx = fontSizePx * scale; // Used to rasterize above display resolution while preserving final CSS dimensions.
    const measureCanvas = document.createElement('canvas'); // Used only to measure custom-font bounds before allocating the real source sprite.
    const measureContext = measureCanvas.getContext('2d'); // Used to query TankanScript glyph metrics.
    if (!measureContext) throw new Error('Unable to create Tankan glyph measurement context.');
    measureContext.font = `${renderFontPx}px "TankanScript"`;
    measureContext.textBaseline = 'alphabetic';
    const metrics = measureContext.measureText(character); // Used to crop the sprite tightly around this Tankan glyph.
    const left = Math.max(0, Number(metrics.actualBoundingBoxLeft) || 0); // Used to position the glyph so its leftmost stroke stays inside the sprite.
    const right = Math.max(1, Number(metrics.actualBoundingBoxRight) || metrics.width || renderFontPx); // Used to size the sprite to the measured right edge.
    const ascent = Math.max(1, Number(metrics.actualBoundingBoxAscent) || renderFontPx * 0.8); // Used to place the alphabetic baseline without clipping the glyph top.
    const descent = Math.max(1, Number(metrics.actualBoundingBoxDescent) || renderFontPx * 0.2); // Used to retain any descender pixels below the baseline.
    const externalStroke = GLYPH_STROKE_PX * scale; // Used to reproduce Item Select's 3px black category-heading outline at display scale.
    const padding = Math.ceil(externalStroke + 3 * scale); // Used to keep antialiasing/shadow-safe pixels inside the generated source sprite.
    const width = Math.max(1, Math.ceil(left + right + padding * 2)); // Used as the source and recolored Tankan sprite width.
    const height = Math.max(1, Math.ceil(ascent + descent + padding * 2)); // Used as the source and recolored Tankan sprite height.
    const canvas = document.createElement('canvas'); // Used as the #5A8480-keyed source sprite consumed by ToolMetalRecolor.
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); // Used to paint the Tankan glyph with the canonical tool placeholder hue.
    if (!context) throw new Error('Unable to create Tankan glyph render context.');
    context.font = `${renderFontPx}px "TankanScript"`;
    context.textBaseline = 'alphabetic';
    context.textAlign = 'left';
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.lineWidth = externalStroke;
    context.strokeStyle = CATEGORY_STROKE;
    context.fillStyle = sourceFillHex(tool);
    const x = padding + left; // Used as the baseline origin that accounts for actualBoundingBoxLeft.
    const y = padding + ascent; // Used as the alphabetic baseline that retains measured ascent/descent.
    context.strokeText(character, x, y);
    context.fillText(character, x, y);
    return canvas;
  }

  function recoloredGlyph(character, fontSizePx) {
    const tool = window.ToolMetalRecolor; // Used to run the exact tool-sprite verdigris algorithm rather than a loading-screen approximation.
    if (!tool?.getRecoloredCanvas || !tool.rgbToHsv || !tool.hsvToRgb) {
      return Promise.reject(new Error('ToolMetalRecolor is not ready.'));
    }
    const scale = Math.max(2, Math.min(3, Number(window.devicePixelRatio) || 1)); // Used to keep rasterized lettering crisp without unbounded high-DPI cache cost.
    const cacheKey = glyphCacheKey(character, fontSizePx, scale); // Used to deduplicate repeated letters within and across loading-screen phrases.
    const cached = GLYPH_CACHE.get(cacheKey); // Used to avoid rerunning seeded oxidation for an identical glyph sprite.
    if (cached) return cached;
    const promise = Promise.resolve().then(async () => {
      const sourceCanvas = makeGlyphSource(character, fontSizePx, scale, tool); // Used as the placeholder-metal sprite passed into the shared recolorer.
      const sourceUrl = sourceCanvas.toDataURL('image/png'); // Used because ToolMetalRecolor deliberately consumes sprite URLs and already supports data URLs through Image.
      const recoloredCanvas = await tool.getRecoloredCanvas(sourceUrl, {
        sourceHex: tool.SOURCE_HEX || FALLBACK_SOURCE_HEX,
        targetHex: BRONZE_HEX,
        verdigrisHex: VERDIGRIS_HEX,
        oxidationAmount: VERDIGRIS_AMOUNT,
      }); // Used to apply the tool system's exact seeded blotch growth, grain, and black verdigris boundary at 50% coverage.
      return {
        src: recoloredCanvas.toDataURL('image/png'),
        width: recoloredCanvas.width / scale,
        height: recoloredCanvas.height / scale,
      };
    });
    GLYPH_CACHE.set(cacheKey, promise);
    promise.catch(() => GLYPH_CACHE.delete(cacheKey));
    return promise;
  }

  async function decorateGlyph(glyph) {
    const character = String(glyph.dataset.hlsMetalCharacter || glyph.textContent || ''); // Used to retain the original Tankan character after its text becomes visually transparent.
    if (!character) return;
    glyph.dataset.hlsMetalCharacter = character;
    const fontSizePx = glyphFontSizePx(glyph); // Used to regenerate only if the configured loading-screen script size changed.
    const desiredKey = `${character}|${fontSizePx.toFixed(3)}`; // Used to reject stale sprites after a live config/size refresh.
    if (glyph.dataset.hlsMetalAppliedKey === desiredKey && glyph.querySelector('.hlsBronzeVerdigrisGlyphImage')) return;
    if (glyph.dataset.hlsMetalPendingKey === desiredKey) return;
    glyph.dataset.hlsMetalPendingKey = desiredKey;
    try {
      const sprite = await recoloredGlyph(character, fontSizePx); // Used as the final 50%-verdigris Tankan glyph image.
      if (!glyph.isConnected || glyph.dataset.hlsMetalPendingKey !== desiredKey) return;
      const image = document.createElement('img'); // Used as the transparent-background sprite overlay while the original text remains as accessible/fallback content.
      image.className = 'hlsBronzeVerdigrisGlyphImage';
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.src = sprite.src;
      image.style.width = `${sprite.width}px`;
      image.style.height = `${sprite.height}px`;
      glyph.querySelector('.hlsBronzeVerdigrisGlyphImage')?.remove();
      glyph.appendChild(image);
      glyph.classList.add('hlsBronzeVerdigrisGlyph');
      glyph.dataset.hlsMetalAppliedKey = desiredKey;
      processedGlyphs += 1;
      lastError = '';
    } catch (error) {
      failedGlyphs += 1;
      lastError = error?.message || String(error);
      window.__farmLog?.(`[loading-metal-text] ${lastError}`, 'warn');
    } finally {
      if (glyph.dataset.hlsMetalPendingKey === desiredKey) delete glyph.dataset.hlsMetalPendingKey;
      updateDebugPanel();
    }
  }

  function decorateCurrentGlyphs() {
    const scriptWords = document.getElementById('hlsScriptWords'); // Used as the authoritative Tankan glyph container created by LoadingScreenRuntime.renderScript().
    if (!scriptWords) return false;
    const glyphs = [...scriptWords.querySelectorAll('.hlsVerticalGlyph')]; // Used to process every current vertical glyph without touching future/replaced nodes.
    glyphs.forEach(glyph => { void decorateGlyph(glyph); });
    return true;
  }

  function scheduleDependencyRetry() {
    if (dependencyRetryTimer) return;
    dependencyRetryTimer = window.setTimeout(() => {
      dependencyRetryTimer = null;
      queueRefresh();
    }, 120); // Used only during early boot if tool-metal-recolor.js has not executed yet.
  }

  function refresh() {
    installStyles();
    const attached = attachRuntime(); // Used to ensure observers/debug UI exist before processing whichever loading session is active.
    if (!attached) return;
    if (!window.ToolMetalRecolor?.getRecoloredCanvas) scheduleDependencyRetry();
    else decorateCurrentGlyphs();
    updateDebugPanel();
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      refresh();
    });
  }

  function attachRuntime() {
    const root = document.getElementById('hobunjiLoadScreen'); // Used to detect when LoadingScreenRuntime.buildDom() has created its persistent root.
    const scriptWords = document.getElementById('hlsScriptWords'); // Used as the narrow mutation-observer target for Tankan phrase replacements.
    if (!root || !scriptWords) return false;
    if (!scriptObserver) {
      scriptObserver = new MutationObserver(queueRefresh);
      scriptObserver.observe(scriptWords, { childList: true, subtree: true });
      addEventListener('resize', queueRefresh, { passive: true });
      document.fonts?.ready?.then(queueRefresh).catch(() => {});
    }
    updateDebugPanel();
    return true;
  }

  function watchForRuntime() {
    if (attachRuntime()) {
      queueRefresh();
      return;
    }
    if (rootObserver || !document.documentElement) return;
    rootObserver = new MutationObserver(() => {
      if (!attachRuntime()) return;
      rootObserver?.disconnect();
      rootObserver = null;
      queueRefresh();
    });
    rootObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.LoadingScreenMetalText = {
    installed: true,
    refresh: queueRefresh,
    debugSnapshot,
    bronzeHex: BRONZE_HEX,
    verdigrisHex: VERDIGRIS_HEX,
    verdigrisAmount: VERDIGRIS_AMOUNT,
  };

  installStyles();
  watchForRuntime();
})();
