from pathlib import Path


def replace_once(path, old, new):
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 match, found {count}: {old[:120]!r}')
    path.write_text(text.replace(old, new), encoding='utf-8')

portrait = Path('docs/js/portrait-utils.js')
hand = Path('docs/js/procedural-hand-attachments.js')
feet = Path('docs/js/procedural-leg-animation.js')
natural = Path('docs/js/natural-surface-materials.js')

old = """function getBodyTintedCanvas(img, sourceKey, color, speciesId = '', slot = 'A') {
  return _imageForTint(img, sourceKey, bodySpriteTintForColor(color, speciesId, slot));
}

// Canonical authored-PNG appearance path. Character body sprites, the final
"""
new = """function getBodyTintedCanvas(img, sourceKey, color, speciesId = '', slot = 'A') {
  return _imageForTint(img, sourceKey, bodySpriteTintForColor(color, speciesId, slot));
}

// Same-style texture PNGs (wavy_surface/carved_smooth) are authored as complete
// opaque swatches rather than cutout body sprites. Their luminance histogram is
// much narrower: wavy_surface is roughly 0.55..0.73, while a real body sprite
// reaches from black outlines through ~0.71 highlights. Feeding the swatches
// directly into shadeFill therefore makes the texture almost flat, and makes
// carved_smooth much darker than its requested target color. Normalize only
// these surface PNGs into the body's tonal envelope BEFORE the exact same body
// tint stage. The body sprites themselves are untouched.
const _AUTHORED_SURFACE_TONE_CACHE = new Map();
function _surfaceToneConfig() {
  const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.tinting || {};
  return {
    sourceLowPercentile: Number.isFinite(Number(cfg.surfaceSourceLowPercentile)) ? Number(cfg.surfaceSourceLowPercentile) : 0.10,
    sourceHighPercentile: Number.isFinite(Number(cfg.surfaceSourceHighPercentile)) ? Number(cfg.surfaceSourceHighPercentile) : 0.90,
    targetLow: Number.isFinite(Number(cfg.surfaceToneLow)) ? Number(cfg.surfaceToneLow) : 0.18,
    targetHigh: Number.isFinite(Number(cfg.surfaceToneHigh)) ? Number(cfg.surfaceToneHigh) : 0.80,
  };
}

function normalizeAuthoredSurfacePngTone(img, sourceKey) {
  if (!img) return img;
  const tintOptions = getPortraitTintingConfig();
  const tone = _surfaceToneConfig();
  const cacheKey = [
    sourceKey || img.currentSrc || img.src || 'inline-surface',
    tone.sourceLowPercentile, tone.sourceHighPercentile,
    tone.targetLow, tone.targetHigh,
    tintOptions.outlineThreshold,
  ].join('|');
  if (_AUTHORED_SURFACE_TONE_CACHE.has(cacheKey)) return _AUTHORED_SURFACE_TONE_CACHE.get(cacheKey);

  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) return img;
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const luminances = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= 8) continue;
    const lum = relativeLuminance(data[i], data[i + 1], data[i + 2]);
    if (lum > tintOptions.outlineThreshold) luminances.push(lum);
  }
  if (luminances.length < 8) return img;
  luminances.sort((a, b) => a - b);
  const percentile = q => luminances[Math.max(0, Math.min(luminances.length - 1, Math.round((luminances.length - 1) * q)))];
  const sourceLow = percentile(Math.max(0, Math.min(1, tone.sourceLowPercentile)));
  const sourceHigh = percentile(Math.max(0, Math.min(1, tone.sourceHighPercentile)));
  const sourceSpan = sourceHigh - sourceLow;
  if (!(sourceSpan > 0.015)) return img;

  const targetLow = Math.max(tintOptions.outlineThreshold + 0.01, Math.min(0.95, tone.targetLow));
  const targetHigh = Math.max(targetLow + 0.02, Math.min(1, tone.targetHigh));
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = relativeLuminance(r, g, b);
    // Preserve authored near-black outlines exactly, matching the body tint
    // pipeline's own outline-preservation rule.
    if (tintOptions.preserveNearBlackOutlines && lum <= tintOptions.outlineThreshold) continue;
    const t = Math.max(0, Math.min(1, (lum - sourceLow) / sourceSpan));
    const targetLum = targetLow + (targetHigh - targetLow) * t;
    const scale = targetLum / Math.max(0.0001, lum);
    data[i] = clampByte(r * scale);
    data[i + 1] = clampByte(g * scale);
    data[i + 2] = clampByte(b * scale);
  }
  ctx.putImageData(imageData, 0, 0);
  _AUTHORED_SURFACE_TONE_CACHE.set(cacheKey, canvas);
  return canvas;
}

function getSurfaceTintedCanvas(img, sourceKey, color, speciesId = '', slot = 'A') {
  const normalized = normalizeAuthoredSurfacePngTone(img, sourceKey);
  return _imageForTint(normalized, `${sourceKey}|surface-tone`, bodySpriteTintForColor(color, speciesId, slot));
}

// Canonical authored-PNG appearance path. Character body sprites, the final
"""
replace_once(portrait, old, new)

old = """window.HobunjiSpritePngSurface = {
  tintForBodyColor: bodySpriteTintForColor,
  tintBodyCanvas: getBodyTintedCanvas,
  configureTexture: configureSpritePngTexture,
"""
new = """window.HobunjiSpritePngSurface = {
  tintForBodyColor: bodySpriteTintForColor,
  tintBodyCanvas: getBodyTintedCanvas,
  normalizeSurfaceTone: normalizeAuthoredSurfacePngTone,
  tintSurfaceCanvas: getSurfaceTintedCanvas,
  configureTexture: configureSpritePngTexture,
"""
replace_once(portrait, old, new)

old = """      const spritePng = global.HobunjiSpritePngSurface;
      if (typeof spritePng?.tintBodyCanvas === 'function' || typeof global.getBodyTintedCanvas === 'function') {
        // Same authored-PNG recolor entry point used by the character body art.
        const tintBodyCanvas = spritePng?.tintBodyCanvas || global.getBodyTintedCanvas;
        source = tintBodyCanvas(image, 'assets/textures/wavy_surface.png', descriptor, speciesId, 'A') || image;
"""
new = """      const spritePng = global.HobunjiSpritePngSurface;
      if (typeof spritePng?.tintSurfaceCanvas === 'function' || typeof spritePng?.tintBodyCanvas === 'function' || typeof global.getBodyTintedCanvas === 'function') {
        // Expand this full-swatch PNG into the body sprite's tonal envelope,
        // then run the exact same species-aware body recolor stage.
        const tintSurfaceCanvas = spritePng?.tintSurfaceCanvas || spritePng?.tintBodyCanvas || global.getBodyTintedCanvas;
        source = tintSurfaceCanvas(image, 'assets/textures/wavy_surface.png', descriptor, speciesId, 'A') || image;
"""
replace_once(hand, old, new)

old = """      const tintBodyCanvas = window.HobunjiSpritePngSurface?.tintBodyCanvas || window.getBodyTintedCanvas;
      if (typeof tintBodyCanvas === 'function') {
        // Same descriptor -> species tint-mode -> _imageForTint path used by
        // the portrait body sprite itself. Fixed bone/keratin hex descriptors
        // pass an empty species id so they retain the default shade-fill mode.
        source = tintBodyCanvas(img, sourcePath, colorDescriptor, tintSpeciesId, 'A') || null;
"""
new = """      const spritePng = window.HobunjiSpritePngSurface;
      const tintSurfaceCanvas = spritePng?.tintSurfaceCanvas || spritePng?.tintBodyCanvas || window.getBodyTintedCanvas;
      if (typeof tintSurfaceCanvas === 'function') {
        // Normalize the complete texture swatch to body-sprite tonal range,
        // then use the exact descriptor -> species tint-mode -> _imageForTint path.
        // Fixed bone/keratin descriptors keep the default shade-fill mode.
        source = tintSurfaceCanvas(img, sourcePath, colorDescriptor, tintSpeciesId, 'A') || null;
"""
replace_once(feet, old, new)

old = """    image.onload = () => {
      const tintBodyCanvas = window.HobunjiSpritePngSurface?.tintBodyCanvas || window.getBodyTintedCanvas;
      if (typeof tintBodyCanvas !== 'function') {
        console.warn('[natural-surface] portrait body PNG tint helper unavailable; keeping flat tint', path, tint);
        return;
      }
      // Empty species id intentionally follows bodyTintModeForSpecies(''), whose
      // default is the same shadeFill mode used by ordinary body sprites. A hex
      // descriptor is already absolute, so no species swatch conversion occurs.
      const canvas = tintBodyCanvas(image, cacheKey, { hex: tint }, '', 'A');
"""
new = """    image.onload = () => {
      const spritePng = window.HobunjiSpritePngSurface;
      const tintSurfaceCanvas = spritePng?.tintSurfaceCanvas || spritePng?.tintBodyCanvas || window.getBodyTintedCanvas;
      if (typeof tintSurfaceCanvas !== 'function') {
        console.warn('[natural-surface] portrait surface PNG tint helper unavailable; keeping flat tint', path, tint);
        return;
      }
      // carved_smooth is a complete texture swatch, so normalize its authored
      // tonal range to the body-art envelope before the same #808080 shadeFill.
      // This keeps black carving lines while making the body of the stone read
      // as medium gray instead of multiplying the already-dark source twice.
      const canvas = tintSurfaceCanvas(image, cacheKey, { hex: tint }, '', 'A');
"""
replace_once(natural, old, new)

print('patched authored surface PNG tonal visibility')
