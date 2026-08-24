from pathlib import Path


def replace_exact(path, old, new, count=1):
    text = path.read_text(encoding='utf-8')
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f'{path}: expected {count} occurrence(s), found {actual}: {old[:120]!r}')
    path.write_text(text.replace(old, new), encoding='utf-8')


portrait = Path('docs/js/portrait-utils.js')
hand = Path('docs/js/procedural-hand-attachments.js')
natural = Path('docs/js/natural-surface-materials.js')
config = Path('docs/config/natural-surface-materials.js')

# Expose one canonical body-sprite tint helper, built out of the exact functions
# renderProfile already uses. Then make renderProfile itself use the helper so
# hands/terrain cannot drift from character sprites again.
old_image_helper = """function _imageForTint(img, sourceKey, tint) {
  if (tint?.mode === 'hueSatFill') return getHueSatFillCanvas(img, sourceKey, tint);
  if (tint?.mode === 'shadeFill') return getShadeFillCanvas(img, sourceKey, tint);
  return img;
}
"""
new_image_helper = old_image_helper + """
// Canonical body-sprite tint path. renderProfile, procedural hands, rocks, and
// cliffs all call this same helper so species tint-mode selection and per-pixel
// recoloring cannot diverge between 2D character art and 3D surface textures.
function bodySpriteTintForColor(color, speciesId, slot = 'A') {
  const referenceHex = _dyeReferenceHexForSlot(slot, speciesId);
  return bodyTintModeForSpecies(speciesId) === 'shadeFill'
    ? shadeFillTintForBodyColor(color, referenceHex)
    : tintForBodyColor(color, referenceHex);
}

function getBodyTintedCanvas(img, sourceKey, color, speciesId = '', slot = 'A') {
  return _imageForTint(img, sourceKey, bodySpriteTintForColor(color, speciesId, slot));
}

// Explicit exports for classic-script consumers that render Three.js textures.
window.bodySpriteTintForColor = bodySpriteTintForColor;
window.getBodyTintedCanvas = getBodyTintedCanvas;
"""
replace_exact(portrait, old_image_helper, new_image_helper)

old_render_tint = """  const _tintSpeciesId = resolvedFighter?.speciesId || fighter?.speciesId || '';
  const _bodyTintMode = bodyTintModeForSpecies(_tintSpeciesId);
  const _clothingTintMode = clothingTintMode();
  const tintFor = (slot) => {
    if (!slot) return { mode: 'none' };
    const referenceHex = _dyeReferenceHexForSlot(slot, _tintSpeciesId);
    const isBodySlot = slot === 'A' || slot === 'B' || slot === 'C';
    const mode = isBodySlot ? _bodyTintMode : _clothingTintMode;
    return mode === 'shadeFill'
      ? shadeFillTintForBodyColor(bodyColors[slot], referenceHex)
      : tintForBodyColor(bodyColors[slot], referenceHex);
  };
"""
new_render_tint = """  const _tintSpeciesId = resolvedFighter?.speciesId || fighter?.speciesId || '';
  const _clothingTintMode = clothingTintMode();
  const tintFor = (slot) => {
    if (!slot) return { mode: 'none' };
    const isBodySlot = slot === 'A' || slot === 'B' || slot === 'C';
    if (isBodySlot) return bodySpriteTintForColor(bodyColors[slot], _tintSpeciesId, slot);
    const referenceHex = _dyeReferenceHexForSlot(slot, _tintSpeciesId);
    return _clothingTintMode === 'shadeFill'
      ? shadeFillTintForBodyColor(bodyColors[slot], referenceHex)
      : tintForBodyColor(bodyColors[slot], referenceHex);
  };
"""
replace_exact(portrait, old_render_tint, new_render_tint)

# Hands must select the same species tint mode as renderProfile. Include tint
# mode in the cache key so a hueSatFill species never reuses a shadeFill map.
old_hand_cache = """    const resolvedHex = bodyColorHex(speciesId, bodyColors);
    const cacheKey = `${normalizeKey(speciesId)}:${String(resolvedHex).toLowerCase()}`; // Identifies the tint-specific wavy texture shared by both hands of one appearance.
"""
new_hand_cache = """    const resolvedHex = bodyColorHex(speciesId, bodyColors);
    const spriteTintMode = typeof global.bodyTintModeForSpecies === 'function'
      ? global.bodyTintModeForSpecies(speciesId)
      : 'shadeFill';
    const cacheKey = `${normalizeKey(speciesId)}:${spriteTintMode}:${String(resolvedHex).toLowerCase()}`; // Separates the exact sprite tint mode as well as the resolved body color.
"""
replace_exact(hand, old_hand_cache, new_hand_cache)

old_hand_apply = """    loadHandWavySource().then(image => {
      let source = image;
      if (typeof global.shadeFillTintForBodyColor === 'function' && typeof global.getShadeFillCanvas === 'function') {
        const tint = global.shadeFillTintForBodyColor(descriptor, referenceHex);
        if (tint?.mode === 'shadeFill') {
          source = global.getShadeFillCanvas(image, 'assets/textures/wavy_surface.png', tint) || image;
        }
      }
      texture.image = source;
      texture.needsUpdate = true;
    }).catch(error => {
"""
new_hand_apply = """    loadHandWavySource().then(image => {
      let source = image;
      if (typeof global.getBodyTintedCanvas === 'function') {
        // This is the same function renderProfile uses for body sprite layers.
        source = global.getBodyTintedCanvas(image, 'assets/textures/wavy_surface.png', descriptor, speciesId, 'A') || image;
      } else {
        // Standalone-tool fallback mirrors the same renderProfile branch exactly.
        const mode = typeof global.bodyTintModeForSpecies === 'function'
          ? global.bodyTintModeForSpecies(speciesId)
          : 'shadeFill';
        const tint = mode === 'shadeFill'
          ? global.shadeFillTintForBodyColor?.(descriptor, referenceHex)
          : global.tintForBodyColor?.(descriptor, referenceHex);
        if (tint?.mode === 'shadeFill' && typeof global.getShadeFillCanvas === 'function') {
          source = global.getShadeFillCanvas(image, 'assets/textures/wavy_surface.png', tint) || image;
        } else if (tint?.mode === 'hueSatFill' && typeof global.getHueSatFillCanvas === 'function') {
          source = global.getHueSatFillCanvas(image, 'assets/textures/wavy_surface.png', tint) || image;
        }
      }
      texture.image = source;
      texture.needsUpdate = true;
    }).catch(error => {
"""
replace_exact(hand, old_hand_apply, new_hand_apply)

# Replace the custom stone-only tint implementation with the same body-sprite
# canvas helper. A solid #808080 CanvasTexture is installed synchronously so a
# failed/slow PNG can never expose the white MeshBasicMaterial underneath.
old_stone_helpers = """  function parseHexRgb(hex) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!match) return null;
    const value = parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function shouldBakeTint(surfaceCfg, tint) {
    return surfaceCfg?.tintTreatment === 'ground-shade-fill'
      && !!parseHexRgb(tint)
      && typeof window.getShadeFillCanvas === 'function';
  }

  function loadShadeFillTexture(path, tint, wrapMode = 'clamp') {
    const cacheKey = `${path}|${wrapMode}|shade-fill|${String(tint).toLowerCase()}`;
    let tex = textureCache.get(cacheKey);
    if (tex) return tex;
    const rgb = parseHexRgb(tint);
    tex = markTextureSrgb(new THREE.TextureLoader().load(path, loaded => {
      if (!rgb || typeof window.getShadeFillCanvas !== 'function') return;
      const canvas = window.getShadeFillCanvas(loaded.image, cacheKey, {
        mode: 'shadeFill',
        rgb,
        options: typeof window.getPortraitTintingConfig === 'function'
          ? window.getPortraitTintingConfig()
          : undefined,
      });
      if (!canvas) return;
      loaded.image = canvas;
      loaded.needsUpdate = true;
    }));
    const wrapping = wrapMode === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapS = wrapping;
    tex.wrapT = wrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.userData = Object.assign({}, tex.userData, {
      naturalSurfaceShadeFill: true,
      naturalSurfaceShadeFillTarget: String(tint).toLowerCase(),
    });
    textureCache.set(cacheKey, tex);
    return tex;
  }
"""
new_stone_helpers = """  function isHexTint(hex) {
    return /^#?[0-9a-f]{6}$/i.test(String(hex || '').trim());
  }

  function flatTintCanvas(hex) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = isHexTint(hex) ? hex : '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function shouldUseBodySpriteTint(surfaceCfg, tint) {
    return surfaceCfg?.tintTreatment === 'body-sprite-tint' && isHexTint(tint);
  }

  function loadBodySpriteTintTexture(path, tint, wrapMode = 'clamp') {
    const cacheKey = `${path}|${wrapMode}|body-sprite-tint|${String(tint).toLowerCase()}`;
    let tex = textureCache.get(cacheKey);
    if (tex) return tex;

    // Start at the requested medium gray instead of white while carved_smooth
    // loads. The decoded PNG later replaces this with the exact portrait body
    // recolor canvas, using {hex:tint} as the body-color descriptor.
    tex = markTextureSrgb(new THREE.CanvasTexture(flatTintCanvas(tint)));
    const wrapping = wrapMode === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapS = wrapping;
    tex.wrapT = wrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.userData = Object.assign({}, tex.userData, {
      naturalSurfaceBodySpriteTint: true,
      naturalSurfaceBodySpriteTintTarget: String(tint).toLowerCase(),
    });
    textureCache.set(cacheKey, tex);

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (typeof window.getBodyTintedCanvas !== 'function') {
        console.warn('[natural-surface] portrait body tint helper unavailable; keeping flat tint', path, tint);
        return;
      }
      // Empty species id intentionally follows bodyTintModeForSpecies(''), whose
      // default is the same shadeFill mode used by ordinary body sprites. A hex
      // descriptor is already absolute, so no species swatch conversion occurs.
      const canvas = window.getBodyTintedCanvas(image, cacheKey, { hex: tint }, '', 'A');
      if (!canvas) return;
      tex.image = canvas;
      tex.needsUpdate = true;
    };
    image.onerror = () => console.warn('[natural-surface] failed to load body-tinted surface texture', path);
    image.src = path;
    return tex;
  }
"""
replace_exact(natural, old_stone_helpers, new_stone_helpers)

old_texture_for_surface = """  function textureForSurface(surface, wrapMode = 'clamp', resolvedTint = null) {
    const surfaceCfg = cfgFor(surface);
    const tint = resolvedTint || surfaceCfg.tint;
    return shouldBakeTint(surfaceCfg, tint)
      ? loadShadeFillTexture(texturePath(surfaceCfg), tint, wrapMode)
      : loadBaseTexture(texturePath(surfaceCfg), wrapMode);
  }
"""
new_texture_for_surface = """  function textureForSurface(surface, wrapMode = 'clamp', resolvedTint = null) {
    const surfaceCfg = cfgFor(surface);
    const tint = resolvedTint || surfaceCfg.tint;
    return shouldUseBodySpriteTint(surfaceCfg, tint)
      ? loadBodySpriteTintTexture(texturePath(surfaceCfg), tint, wrapMode)
      : loadBaseTexture(texturePath(surfaceCfg), wrapMode);
  }
"""
replace_exact(natural, old_texture_for_surface, new_texture_for_surface)

replace_exact(natural, "const bakeTint = shouldBakeTint(surfaceCfg, tint); // Uses shade-fill so #808080 is the texture's target color instead of a second dark multiplier.", "const bakeTint = shouldUseBodySpriteTint(surfaceCfg, tint); // The PNG is recolored by the exact body-sprite canvas path, so the Three material stays white.")
replace_exact(natural, "const bakeTint = shouldBakeTint(surfaceCfg, tint); // Baked target color keeps carved_smooth shading without multiplying it dark again.", "const bakeTint = shouldUseBodySpriteTint(surfaceCfg, tint); // Same body-sprite tint canvas as character art; material white avoids a second multiplier.")

# Both authored config and runtime defaults name the exact treatment now.
replace_exact(config, "tintTreatment: 'ground-shade-fill'", "tintTreatment: 'body-sprite-tint'", count=2)
replace_exact(natural, "tintTreatment: 'ground-shade-fill'", "tintTreatment: 'body-sprite-tint'", count=2)
