// Shared Tankan-script layout and canvas rasterization.
// The loading screen's vertical "Hobunji Hollow" treatment is the visual
// reference: one word per vertical column, rotated/flipped Tankan font,
// .56em glyph advance, and -.55em default spacing between word columns.
(() => {
  'use strict';

  if (window.TankanScriptLayout?.installed) return;

  const SCRIPT_SRC = typeof document !== 'undefined' ? (document.currentScript?.src || '') : ''; // Used to resolve the shared Tankan font from both game and nested editor pages.
  const FONT_FAMILY = 'TankanScript';
  const FONT_PATH = '../assets/hud/tankanscript_rotated_flipped_horiz.otf';
  const FONT_URL = (() => {
    if (!SCRIPT_SRC || typeof URL === 'undefined') return 'assets/hud/tankanscript_rotated_flipped_horiz.otf';
    try { return new URL(FONT_PATH, SCRIPT_SRC).href; }
    catch (_) { return 'assets/hud/tankanscript_rotated_flipped_horiz.otf'; }
  })();
  const DEFAULTS = Object.freeze({
    columnSpacingEm: -0.55,
    glyphAdvanceEm: 0.56,
    fontSizePx: 128,
    paddingEm: 0.28,
    color: '#ffffff',
  });

  let fontPromise = null; // Shared by loading/editor/runtime callers so the OTF is only requested once per page.
  let fontFace = null; // The exact registered Tankan face used by canvas; retaining it also makes diagnostics unambiguous.
  let fontState = 'idle'; // Exposed for mobile/editor diagnostics so fallback-font bugs are visible instead of silent.
  let fontError = null; // Last real Tankan font load failure, if any.

  const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function splitWords(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean);
  }

  function optionsWithDefaults(options = {}) {
    return {
      columnSpacingEm: clamp(finiteOr(options.columnSpacingEm, DEFAULTS.columnSpacingEm), -0.95, 4),
      glyphAdvanceEm: clamp(finiteOr(options.glyphAdvanceEm, DEFAULTS.glyphAdvanceEm), 0.1, 4),
      fontSizePx: clamp(finiteOr(options.fontSizePx, DEFAULTS.fontSizePx), 16, 512),
      paddingEm: clamp(finiteOr(options.paddingEm, DEFAULTS.paddingEm), 0, 4),
      color: String(options.color || DEFAULTS.color),
    };
  }

  function measure(text, options = {}) {
    const settings = optionsWithDefaults(options);
    const words = splitWords(text);
    const columnCount = Math.max(1, words.length);
    const longestWord = Math.max(1, ...words.map(word => Array.from(word).length));
    const glyphAdvancePx = settings.fontSizePx * settings.glyphAdvanceEm;
    const columnAdvancePx = settings.fontSizePx * Math.max(0.05, 1 + settings.columnSpacingEm);
    const paddingPx = settings.fontSizePx * settings.paddingEm;
    const contentWidth = settings.fontSizePx + (columnCount - 1) * columnAdvancePx;
    const contentHeight = longestWord * glyphAdvancePx;
    return {
      ...settings,
      words,
      columnCount,
      longestWord,
      glyphAdvancePx,
      columnAdvancePx,
      paddingPx,
      widthPx: Math.max(1, Math.ceil(contentWidth + paddingPx * 2 - 1e-9)),
      heightPx: Math.max(1, Math.ceil(contentHeight + paddingPx * 2 - 1e-9)),
    };
  }

  function ensureFontLoaded() {
    if (fontPromise) return fontPromise;
    if (typeof FontFace !== 'function' || typeof document === 'undefined' || !document.fonts) {
      fontState = 'unsupported';
      fontError = new Error('This browser cannot register the Tankan FontFace for canvas rendering.');
      fontPromise = Promise.reject(fontError);
      return fontPromise;
    }

    // Do not use document.fonts.check() as a preflight here. A browser may report a
    // family as renderable through fallback even though our custom FontFace was never
    // registered. The loading screen explicitly loads this same OTF, so do the same.
    fontState = 'loading';
    fontFace = new FontFace(FONT_FAMILY, `url('${FONT_URL}') format('opentype')`);
    fontPromise = fontFace.load()
      .then(loadedFace => {
        document.fonts.add(loadedFace);
        fontState = 'loaded';
        fontError = null;
        return true;
      })
      .catch(error => {
        fontState = 'error';
        fontError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[TankanScriptLayout] Tankan font failed to load from ${FONT_URL}.`, fontError);
        throw fontError;
      });
    return fontPromise;
  }

  function renderToCanvas(canvas, text, options = {}) {
    if (!canvas?.getContext) return null;
    // Never silently paint with the browser's fallback face. Callers must await
    // ensureFontLoaded(), and this guard catches any future direct render call.
    if (typeof document !== 'undefined' && document.fonts && fontState !== 'loaded') {
      throw new Error(`Tankan font is ${fontState}; refusing to rasterize with a fallback font.`);
    }
    const layout = measure(text, options);
    canvas.width = layout.widthPx;
    canvas.height = layout.heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = layout.color;
    ctx.font = `${layout.fontSizePx}px "${FONT_FAMILY}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let columnIndex = 0; columnIndex < layout.words.length; columnIndex++) {
      const word = layout.words[columnIndex];
      const x = layout.paddingPx + layout.fontSizePx / 2 + columnIndex * layout.columnAdvancePx;
      const glyphs = Array.from(word);
      for (let glyphIndex = 0; glyphIndex < glyphs.length; glyphIndex++) {
        const y = layout.paddingPx + layout.glyphAdvancePx * (glyphIndex + 0.5);
        ctx.fillText(glyphs[glyphIndex], x, y);
      }
    }
    return layout;
  }

  function createCanvas(text, options = {}) {
    if (typeof document === 'undefined') return { canvas: null, layout: measure(text, options) };
    const canvas = document.createElement('canvas');
    const layout = renderToCanvas(canvas, text, options);
    return { canvas, layout };
  }

  window.TankanScriptLayout = {
    installed: true,
    version: 2,
    fontFamily: FONT_FAMILY,
    fontUrl: FONT_URL,
    defaults: DEFAULTS,
    splitWords,
    measure,
    ensureFontLoaded,
    renderToCanvas,
    createCanvas,
    get fontStatus() { return fontState; },
    get fontLoadError() { return fontError; },
    get registeredFontFace() { return fontFace; },
  };
})();
