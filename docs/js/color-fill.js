// Canonical source-art color-fill math shared by clothing/weaving, creatures,
 // tool metal/verdigris, and authored item sprites. Keep pixel-color algorithms
 // here so renderers choose masks/semantics without maintaining private tint math.
(() => {
  'use strict';

  if (Number(window.ColorFill?.version) >= 4) return;

  const VERSION = 4;
  let lastShadeFill = null; // Mobile/debug diagnostics: most recent relative-shading fill.
  const lastShadeFillByLabel = new Map(); // Used by Pixel Probe to retain named renderer passes even when later generic fills overwrite "last".
  let shadeFillSequence = 0; // Monotonic render-pass id used to distinguish a current named fill from an older one in copied diagnostics.
  let lastHsvValueFill = null; // Mobile/debug diagnostics: most recent HSV value-preserving fill.

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  const clampByte = value => Math.max(0, Math.min(255, Math.round(value)));

  function relativeLuminance(r, g, b) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta !== 0) {
      if (max === r) h = ((g - b) / delta) % 6;
      else if (max === g) h = (b - r) / delta + 2;
      else h = (r - g) / delta + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : delta / max, v: max };
  }

  function hsvToRgb(h, s, v) {
    h = ((Number(h) % 360) + 360) % 360;
    s = clamp01(s);
    v = clamp01(v);
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let rp = 0, gp = 0, bp = 0;
    if (h < 60) [rp, gp, bp] = [c, x, 0];
    else if (h < 120) [rp, gp, bp] = [x, c, 0];
    else if (h < 180) [rp, gp, bp] = [0, c, x];
    else if (h < 240) [rp, gp, bp] = [0, x, c];
    else if (h < 300) [rp, gp, bp] = [x, 0, c];
    else [rp, gp, bp] = [c, 0, x];
    return [clampByte((rp + m) * 255), clampByte((gp + m) * 255), clampByte((bp + m) * 255)];
  }

  function hueDistance(a, b) {
    const difference = Math.abs(Number(a) - Number(b)) % 360;
    return Math.min(difference, 360 - difference);
  }

  function shadeFillConfig() {
    const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.tinting || {};
    return {
      shadowFloor: Number.isFinite(Number(cfg.shadowFloor)) ? Number(cfg.shadowFloor) : 0.18,
      highlightBoost: Number.isFinite(Number(cfg.highlightBoost)) ? Number(cfg.highlightBoost) : 1.18,
      neutralLuminance: Number.isFinite(Number(cfg.neutralLuminance)) ? Number(cfg.neutralLuminance) : 0.55,
      gamma: Number.isFinite(Number(cfg.gamma)) && Number(cfg.gamma) > 0 ? Number(cfg.gamma) : 1,
      preserveNearBlackOutlines: cfg.preserveNearBlackOutlines !== false,
      outlineThreshold: Number.isFinite(Number(cfg.outlineThreshold)) ? Number(cfg.outlineThreshold) : 0.08,
    };
  }

  function normalizeShadeOptions(predicateOrOptions) {
    if (typeof predicateOrOptions === 'function') {
      return { applyPredicate: predicateOrOptions, samplePredicate: predicateOrOptions };
    }
    return predicateOrOptions && typeof predicateOrOptions === 'object' ? predicateOrOptions : {};
  }

  // Measure the source art independently from the pixels that will ultimately
  // receive color. The brightest eligible authored pixel is the reference:
  // it maps to the requested target color, while every darker pixel keeps its
  // relative luminance below that peak. Woven/surface motifs therefore sample
  // the whole garment/body region even when the motif itself lands in shadow.
  function createShadeReference(sourceData, predicate = null, options = {}) {
    const cfg = options.config || shadeFillConfig();
    let peakLuminance = 0;
    let count = 0;
    for (let i = 0; i < sourceData.length; i += 4) {
      if (sourceData[i + 3] === 0 || (predicate && !predicate(i))) continue;
      const lum = relativeLuminance(sourceData[i], sourceData[i + 1], sourceData[i + 2]);
      if (cfg.preserveNearBlackOutlines && lum <= cfg.outlineThreshold) continue;
      if (lum > peakLuminance) peakLuminance = lum;
      count++;
    }
    const fallback = Math.max(0.0001, Number(cfg.neutralLuminance) || 0.55); // Legacy config remains only as a no-sample safety fallback.
    return { peakLuminance: Math.max(0.0001, peakLuminance || fallback), count, config: cfg };
  }

  function shadeFillPixels(data, targetRgb, predicateOrOptions = null) {
    const options = normalizeShadeOptions(predicateOrOptions);
    const applyPredicate = options.applyPredicate || null;
    const samplePredicate = options.samplePredicate ?? applyPredicate;
    const sourceData = options.sourceData?.length === data.length ? options.sourceData : data;
    const reference = options.shadeReference || createShadeReference(sourceData, samplePredicate, options);
    const cfg = reference.config || options.config || shadeFillConfig();
    const peakLuminance = Math.max(0.0001, Number(reference.peakLuminance) || Number(reference.neutral) || Number(cfg.neutralLuminance) || 0.55); // reference.neutral keeps externally supplied v2 references compatible.
    const [tr, tg, tb] = targetRgb;
    let appliedCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0 || (applyPredicate && !applyPredicate(i))) continue;
      const lum = relativeLuminance(sourceData[i], sourceData[i + 1], sourceData[i + 2]);
      if (cfg.preserveNearBlackOutlines && lum <= cfg.outlineThreshold) continue;
      // Exact authored-value preservation for the shade hierarchy: the
      // brightest eligible source pixel is 1.0 (the requested target color)
      // and every darker eligible pixel keeps its original luminance ratio.
      const shade = Math.max(0, Math.min(1, lum / peakLuminance));
      data[i] = clampByte(tr * shade);
      data[i + 1] = clampByte(tg * shade);
      data[i + 2] = clampByte(tb * shade);
      appliedCount++;
    }

    lastShadeFill = {
      sequence: ++shadeFillSequence,
      label: options.debugLabel ? String(options.debugLabel) : null,
      sampledCount: Number(reference.count) || 0,
      appliedCount,
      peak: Number(peakLuminance.toFixed(4)),
      separateSampleMask: !!samplePredicate && samplePredicate !== applyPredicate,
      externalSource: sourceData !== data,
    };
    if (lastShadeFill.label) lastShadeFillByLabel.set(lastShadeFill.label, { ...lastShadeFill });
    return reference;
  }

  // Hue/saturation replacement that preserves source HSV value. This remains
  // useful for keyed liquid fills and source-keyed metal regions, but the math
  // lives here rather than in each renderer.
  function hsvValueFillPixels(data, targetRgb, options = {}) {
    const sourceData = options.sourceData?.length === data.length ? options.sourceData : data;
    const applyPredicate = options.applyPredicate || null;
    const target = rgbToHsv(...targetRgb);
    const sourceReferenceSaturation = Number.isFinite(Number(options.sourceReferenceSaturation))
      ? Number(options.sourceReferenceSaturation)
      : target.s;
    const saturationMode = options.saturationMode || 'target';
    let appliedCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0 || (applyPredicate && !applyPredicate(i))) continue;
      const source = rgbToHsv(sourceData[i], sourceData[i + 1], sourceData[i + 2]);
      let saturation = target.s;
      if (saturationMode === 'original') saturation = source.s;
      else if (saturationMode === 'offset') saturation = clamp01(target.s + (source.s - sourceReferenceSaturation));
      const [r, g, b] = hsvToRgb(target.h, saturation, source.v);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      appliedCount++;
    }

    lastHsvValueFill = { appliedCount, saturationMode, externalSource: sourceData !== data };
  }

  function debugSnapshot() {
    return {
      version: VERSION,
      shadeFillSequence,
      lastShadeFill: lastShadeFill ? { ...lastShadeFill } : null,
      shadeFillsByLabel: Object.fromEntries(Array.from(lastShadeFillByLabel, ([label, fill]) => [label, { ...fill }])),
      lastHsvValueFill: lastHsvValueFill ? { ...lastHsvValueFill } : null,
    };
  }

  window.ColorFill = Object.freeze({
    version: VERSION,
    relativeLuminance,
    rgbToHsv,
    hsvToRgb,
    hueDistance,
    shadeFillConfig,
    createShadeReference,
    shadeFillPixels,
    hsvValueFillPixels,
    debugSnapshot,
  });
})();
