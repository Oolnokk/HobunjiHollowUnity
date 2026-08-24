from pathlib import Path


def replace_once(path, old, new):
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:100]!r}')
    path.write_text(text.replace(old, new), encoding='utf-8')

leg = Path('docs/js/procedural-leg-animation.js')
hand = Path('docs/js/procedural-hand-attachments.js')
natural = Path('docs/js/natural-surface-materials.js')
probe = Path('docs/js/pixel-probe.js')

# --- Shared local emergency patterned tint helper for feet ---
old = """  function flatColorCanvas(hex) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = hex || '#808080';
    ctx.fillRect(0, 0, 4, 4);
    return canvas;
  }

  // Opts every real mesh under `obj` into the game's inverted-shell outline
"""
new = """  function flatColorCanvas(hex) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = hex || '#808080';
    ctx.fillRect(0, 0, 4, 4);
    return canvas;
  }

  // Emergency fallback used only if the shared portrait surface-tint helper
  // is unavailable or throws AFTER the authored PNG itself loaded. Never
  // collapse a successfully loaded texture to a 4x4 flat color: preserve its
  // luminance pattern and recolor it toward the requested body color locally.
  function localPatternTintCanvas(img, targetHex) {
    try {
      const raw = String(targetHex || '#808080').replace(/^#/, '');
      if (!/^[0-9a-f]{6}$/i.test(raw)) return img;
      const tr = parseInt(raw.slice(0, 2), 16), tg = parseInt(raw.slice(2, 4), 16), tb = parseInt(raw.slice(4, 6), 16);
      const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
      if (!width || !height) return img;
      const canvas = Object.assign(document.createElement('canvas'), { width, height });
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const values = [];
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] <= 8) continue;
        const l = lum(data[i], data[i + 1], data[i + 2]);
        if (l > 0.08) values.push(l);
      }
      if (values.length < 8) return img;
      values.sort((a, b) => a - b);
      const at = q => values[Math.max(0, Math.min(values.length - 1, Math.round((values.length - 1) * q)))];
      const low = at(0.10), high = at(0.90), span = high - low;
      if (!(span > 0.015)) return img;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        const l = lum(data[i], data[i + 1], data[i + 2]);
        if (l <= 0.08) continue;
        const t = Math.max(0, Math.min(1, (l - low) / span));
        const targetLum = 0.22 + 0.66 * t;
        const shade = Math.max(0.18, Math.min(1.18, targetLum / 0.55));
        data[i] = Math.max(0, Math.min(255, Math.round(tr * shade)));
        data[i + 1] = Math.max(0, Math.min(255, Math.round(tg * shade)));
        data[i + 2] = Math.max(0, Math.min(255, Math.round(tb * shade)));
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas;
    } catch (error) {
      console.warn('[ProceduralFeet] local patterned tint fallback failed; using authored PNG unchanged:', error);
      return img;
    }
  }

  // Opts every real mesh under `obj` into the game's inverted-shell outline
"""
replace_once(leg, old, new)

old = """  async function buildSurfaceTexture(THREE, sourcePath, colorDescriptor, referenceHex, repeatX, debugName, tintSpeciesId = '') {
    let source = null;
    try {
      const img = await loadSurfaceImage(sourcePath);
      const spritePng = window.HobunjiSpritePngSurface;
      const tintSurfaceCanvas = spritePng?.tintSurfaceCanvas || spritePng?.tintBodyCanvas || window.getBodyTintedCanvas;
      if (typeof tintSurfaceCanvas === 'function') {
        // Normalize the complete texture swatch to body-sprite tonal range,
        // then use the exact descriptor -> species tint-mode -> _imageForTint path.
        // Fixed bone/keratin descriptors keep the default shade-fill mode.
        source = tintSurfaceCanvas(img, sourcePath, colorDescriptor, tintSpeciesId, 'A') || null;
      } else if (typeof window.shadeFillTintForBodyColor === 'function' && typeof window.getShadeFillCanvas === 'function') {
        const tint = window.shadeFillTintForBodyColor(colorDescriptor, referenceHex);
        source = tint?.mode === 'shadeFill' ? window.getShadeFillCanvas(img, sourcePath, tint) : null;
      }
    } catch (error) {
      source = null;
    }
    if (!source) source = flatColorCanvas(resolveFlatColorHex(colorDescriptor, referenceHex));
    const textureName = debugName || sourcePath;
    const spritePngSurface = window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit;
    const texture = spritePngSurface?.configureTexture
      ? spritePngSurface.configureTexture(THREE, new THREE.CanvasTexture(source), textureName)
      : new THREE.CanvasTexture(source);
    if (!spritePngSurface?.configureTexture) {
      texture.name = textureName;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
    }
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX || 1.25, 1);
    return texture;
  }
"""
new = """  async function buildSurfaceTexture(THREE, sourcePath, colorDescriptor, referenceHex, repeatX, debugName, tintSpeciesId = '') {
    let source = null;
    let loadedImage = null;
    let sourceState = 'flat-load-failure';
    let sourceError = null;
    const resolvedHex = resolveFlatColorHex(colorDescriptor, referenceHex);
    try {
      loadedImage = await loadSurfaceImage(sourcePath);
      const spritePng = window.HobunjiSpritePngSurface;
      const tintSurfaceCanvas = spritePng?.tintSurfaceCanvas || spritePng?.tintBodyCanvas || window.getBodyTintedCanvas;
      if (typeof tintSurfaceCanvas === 'function') {
        try {
          // Preferred path: exactly the same authored-PNG tint pipeline as body art.
          source = tintSurfaceCanvas(loadedImage, sourcePath, colorDescriptor, tintSpeciesId, 'A') || null;
          if (source) sourceState = 'authored-png-tinted';
        } catch (error) {
          sourceError = error;
        }
      }
      if (!source && typeof window.shadeFillTintForBodyColor === 'function' && typeof window.getShadeFillCanvas === 'function') {
        try {
          const tint = window.shadeFillTintForBodyColor(colorDescriptor, referenceHex);
          source = tint?.mode === 'shadeFill' ? window.getShadeFillCanvas(loadedImage, `${sourcePath}|legacy-fallback`, tint) : null;
          if (source) sourceState = 'authored-png-legacy-tint';
        } catch (error) {
          sourceError ||= error;
        }
      }
      // Critical invariant: once the PNG loaded, never replace its artwork with
      // a flat 4x4 color just because a tint helper was missing or threw.
      if (!source) {
        source = localPatternTintCanvas(loadedImage, resolvedHex);
        sourceState = source === loadedImage ? 'authored-png-raw-fallback' : 'authored-png-local-tint';
      }
    } catch (error) {
      sourceError = error;
    }
    if (!source) source = flatColorCanvas(resolvedHex);
    const textureName = debugName || sourcePath;
    const spritePngSurface = window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit;
    const texture = spritePngSurface?.configureTexture
      ? spritePngSurface.configureTexture(THREE, new THREE.CanvasTexture(source), textureName)
      : new THREE.CanvasTexture(source);
    if (!spritePngSurface?.configureTexture) {
      texture.name = textureName;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
    }
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX || 1.25, 1);
    texture.userData = Object.assign({}, texture.userData, {
      hobunjiAuthoredSurfacePath: sourcePath,
      hobunjiAuthoredSurfaceState: sourceState,
      hobunjiAuthoredSurfaceImageSize: loadedImage ? `${loadedImage.naturalWidth || loadedImage.width}x${loadedImage.naturalHeight || loadedImage.height}` : 'none',
      hobunjiAuthoredSurfaceError: sourceError ? String(sourceError?.message || sourceError) : null,
    });
    if (sourceState === 'flat-load-failure') console.warn('[ProceduralFeet] authored surface PNG failed to load; flat fallback is visible:', sourcePath, sourceError);
    return texture;
  }
"""
replace_once(leg, old, new)

# --- Hand emergency patterned tint + state tags ---
old = """  function flatTintCanvas(hex) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = hex || '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function loadHandWavySource() {
"""
new = """  function flatTintCanvas(hex) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = hex || '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function localHandPatternTintCanvas(img, targetHex) {
    try {
      const raw = String(targetHex || '#808080').replace(/^#/, '');
      if (!/^[0-9a-f]{6}$/i.test(raw)) return img;
      const tr = parseInt(raw.slice(0, 2), 16), tg = parseInt(raw.slice(2, 4), 16), tb = parseInt(raw.slice(4, 6), 16);
      const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
      const canvas = Object.assign(document.createElement('canvas'), { width, height });
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height), data = imageData.data;
      const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const values = [];
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 8) { const l = lum(data[i], data[i + 1], data[i + 2]); if (l > 0.08) values.push(l); }
      if (values.length < 8) return img;
      values.sort((a, b) => a - b);
      const at = q => values[Math.max(0, Math.min(values.length - 1, Math.round((values.length - 1) * q)))];
      const low = at(0.10), high = at(0.90), span = high - low;
      if (!(span > 0.015)) return img;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        const l = lum(data[i], data[i + 1], data[i + 2]);
        if (l <= 0.08) continue;
        const t = Math.max(0, Math.min(1, (l - low) / span));
        const shade = Math.max(0.18, Math.min(1.18, (0.22 + 0.66 * t) / 0.55));
        data[i] = Math.max(0, Math.min(255, Math.round(tr * shade)));
        data[i + 1] = Math.max(0, Math.min(255, Math.round(tg * shade)));
        data[i + 2] = Math.max(0, Math.min(255, Math.round(tb * shade)));
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas;
    } catch (error) {
      console.warn('[ProceduralHandAttachments] local patterned tint fallback failed; using authored PNG unchanged:', error);
      return img;
    }
  }

  function loadHandWavySource() {
"""
replace_once(hand, old, new)

old = """    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.25, 1);
    handBodyTextureCache.set(cacheKey, texture);

    loadHandWavySource().then(image => {
      let source = image;
      const spritePng = global.HobunjiSpritePngSurface;
      if (typeof spritePng?.tintSurfaceCanvas === 'function' || typeof spritePng?.tintBodyCanvas === 'function' || typeof global.getBodyTintedCanvas === 'function') {
        // Expand this full-swatch PNG into the body sprite's tonal envelope,
        // then run the exact same species-aware body recolor stage.
        const tintSurfaceCanvas = spritePng?.tintSurfaceCanvas || spritePng?.tintBodyCanvas || global.getBodyTintedCanvas;
        source = tintSurfaceCanvas(image, 'assets/textures/wavy_surface.png', descriptor, speciesId, 'A') || image;
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
      console.warn('[ProceduralHandAttachments] wavy body surface failed; keeping correctly tinted fallback:', error);
    });
"""
new = """    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.25, 1);
    texture.userData = Object.assign({}, texture.userData, {
      hobunjiAuthoredSurfacePath: 'assets/textures/wavy_surface.png',
      hobunjiAuthoredSurfaceState: 'flat-loading',
      hobunjiAuthoredSurfaceImageSize: 'none',
      hobunjiAuthoredSurfaceError: null,
    });
    handBodyTextureCache.set(cacheKey, texture);

    loadHandWavySource().then(image => {
      let source = null;
      let sourceState = 'authored-png-raw-fallback';
      let sourceError = null;
      const spritePng = global.HobunjiSpritePngSurface;
      const tintSurfaceCanvas = spritePng?.tintSurfaceCanvas || spritePng?.tintBodyCanvas || global.getBodyTintedCanvas;
      if (typeof tintSurfaceCanvas === 'function') {
        try {
          source = tintSurfaceCanvas(image, 'assets/textures/wavy_surface.png', descriptor, speciesId, 'A') || null;
          if (source) sourceState = 'authored-png-tinted';
        } catch (error) { sourceError = error; }
      }
      if (!source) {
        source = localHandPatternTintCanvas(image, resolvedHex);
        sourceState = source === image ? 'authored-png-raw-fallback' : 'authored-png-local-tint';
      }
      texture.image = source;
      texture.userData = Object.assign({}, texture.userData, {
        hobunjiAuthoredSurfaceState: sourceState,
        hobunjiAuthoredSurfaceImageSize: `${image.naturalWidth || image.width}x${image.naturalHeight || image.height}`,
        hobunjiAuthoredSurfaceError: sourceError ? String(sourceError?.message || sourceError) : null,
      });
      texture.needsUpdate = true;
    }).catch(error => {
      texture.userData = Object.assign({}, texture.userData, {
        hobunjiAuthoredSurfaceState: 'flat-load-failure',
        hobunjiAuthoredSurfaceError: String(error?.message || error),
      });
      console.warn('[ProceduralHandAttachments] wavy body surface PNG failed to load; flat fallback remains visible:', error);
    });
"""
replace_once(hand, old, new)

# --- Natural surfaces: loaded carved PNG may never silently remain flat ---
old = """  function flatTintCanvas(hex) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = isHexTint(hex) ? hex : '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function shouldUseBodySpriteTint(surfaceCfg, tint) {
"""
new = """  function flatTintCanvas(hex) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = isHexTint(hex) ? hex : '#808080';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function localNaturalPatternTintCanvas(img, targetHex) {
    try {
      const raw = String(targetHex || '#808080').replace(/^#/, '');
      if (!/^[0-9a-f]{6}$/i.test(raw)) return img;
      const tr = parseInt(raw.slice(0, 2), 16), tg = parseInt(raw.slice(2, 4), 16), tb = parseInt(raw.slice(4, 6), 16);
      const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
      const canvas = Object.assign(document.createElement('canvas'), { width, height });
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height), data = imageData.data;
      const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const values = [];
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 8) { const l = lum(data[i], data[i + 1], data[i + 2]); if (l > 0.08) values.push(l); }
      if (values.length < 8) return img;
      values.sort((a, b) => a - b);
      const at = q => values[Math.max(0, Math.min(values.length - 1, Math.round((values.length - 1) * q)))];
      const low = at(0.10), high = at(0.90), span = high - low;
      if (!(span > 0.015)) return img;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        const l = lum(data[i], data[i + 1], data[i + 2]);
        if (l <= 0.08) continue;
        const t = Math.max(0, Math.min(1, (l - low) / span));
        const shade = Math.max(0.18, Math.min(1.18, (0.22 + 0.66 * t) / 0.55));
        data[i] = Math.max(0, Math.min(255, Math.round(tr * shade)));
        data[i + 1] = Math.max(0, Math.min(255, Math.round(tg * shade)));
        data[i + 2] = Math.max(0, Math.min(255, Math.round(tb * shade)));
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas;
    } catch (error) {
      console.warn('[natural-surface] local patterned tint fallback failed; using authored PNG unchanged:', error);
      return img;
    }
  }

  function shouldUseBodySpriteTint(surfaceCfg, tint) {
"""
replace_once(natural, old, new)

old = """    tex.userData = Object.assign({}, tex.userData, {
      naturalSurfaceBodySpriteTint: true,
      naturalSurfaceBodySpriteTintTarget: String(tint).toLowerCase(),
    });
    textureCache.set(cacheKey, tex);

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
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
      if (!canvas) return;
      tex.image = canvas;
      tex.needsUpdate = true;
    };
    image.onerror = () => console.warn('[natural-surface] failed to load body-tinted surface texture', path);
"""
new = """    tex.userData = Object.assign({}, tex.userData, {
      naturalSurfaceBodySpriteTint: true,
      naturalSurfaceBodySpriteTintTarget: String(tint).toLowerCase(),
      hobunjiAuthoredSurfacePath: path,
      hobunjiAuthoredSurfaceState: 'flat-loading',
      hobunjiAuthoredSurfaceImageSize: 'none',
      hobunjiAuthoredSurfaceError: null,
    });
    textureCache.set(cacheKey, tex);

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      let canvas = null;
      let state = 'authored-png-raw-fallback';
      let surfaceError = null;
      const spritePng = window.HobunjiSpritePngSurface;
      const tintSurfaceCanvas = spritePng?.tintSurfaceCanvas || spritePng?.tintBodyCanvas || window.getBodyTintedCanvas;
      if (typeof tintSurfaceCanvas === 'function') {
        try {
          canvas = tintSurfaceCanvas(image, cacheKey, { hex: tint }, '', 'A') || null;
          if (canvas) state = 'authored-png-tinted';
        } catch (error) { surfaceError = error; }
      }
      if (!canvas) {
        canvas = localNaturalPatternTintCanvas(image, tint);
        state = canvas === image ? 'authored-png-raw-fallback' : 'authored-png-local-tint';
      }
      tex.image = canvas;
      tex.userData = Object.assign({}, tex.userData, {
        hobunjiAuthoredSurfaceState: state,
        hobunjiAuthoredSurfaceImageSize: `${image.naturalWidth || image.width}x${image.naturalHeight || image.height}`,
        hobunjiAuthoredSurfaceError: surfaceError ? String(surfaceError?.message || surfaceError) : null,
      });
      tex.needsUpdate = true;
    };
    image.onerror = (error) => {
      tex.userData = Object.assign({}, tex.userData, {
        hobunjiAuthoredSurfaceState: 'flat-load-failure',
        hobunjiAuthoredSurfaceError: String(error?.message || 'image load failed'),
      });
      console.warn('[natural-surface] failed to load body-tinted surface texture', path);
    };
"""
replace_once(natural, old, new)

# --- Pixel Probe: make authored texture state + neighborhood variation explicit ---
old = """  function _pixelProbeTextureSampleAtUv(mat, uv) {
    const tex = mat?.map;
    if (!tex?.image || !uv) return null;
    try {
      const img = tex.image;
      const w = img.width || img.naturalWidth || 0, h = img.height || img.naturalHeight || 0;
      if (!w || !h) return null;
      let u = uv.x * (tex.repeat?.x ?? 1) + (tex.offset?.x ?? 0);
      let v = uv.y * (tex.repeat?.y ?? 1) + (tex.offset?.y ?? 0);
      u = ((u % 1) + 1) % 1;
      v = ((v % 1) + 1) % 1;
      const flipY = tex.flipY !== false; // THREE default: row 0 of the image is v=1
      const px = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
      const py = Math.min(h - 1, Math.max(0, Math.floor((flipY ? 1 - v : v) * h)));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(px, py, 1, 1).data;
      return { rgba: [d[0], d[1], d[2], d[3]], uv: [uv.x, uv.y] };
    } catch (e) { return null; }
  }

  // Walks up from a raycast hit to find which avatar (if any) owns it —
"""
new = """  function _pixelProbeTextureSampleAtUv(mat, uv) {
    const tex = mat?.map;
    if (!tex?.image || !uv) return null;
    try {
      const img = tex.image;
      const w = img.width || img.naturalWidth || 0, h = img.height || img.naturalHeight || 0;
      if (!w || !h) return null;
      let u = uv.x * (tex.repeat?.x ?? 1) + (tex.offset?.x ?? 0);
      let v = uv.y * (tex.repeat?.y ?? 1) + (tex.offset?.y ?? 0);
      u = ((u % 1) + 1) % 1;
      v = ((v % 1) + 1) % 1;
      const flipY = tex.flipY !== false; // THREE default: row 0 of the image is v=1
      const px = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
      const py = Math.min(h - 1, Math.max(0, Math.floor((flipY ? 1 - v : v) * h)));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(px, py, 1, 1).data;
      return { rgba: [d[0], d[1], d[2], d[3]], uv: [uv.x, uv.y] };
    } catch (e) { return null; }
  }

  function _pixelProbeTextureMeta(mat) {
    const tex = mat?.map;
    if (!tex?.image) return null;
    const img = tex.image;
    const w = img.width || img.naturalWidth || 0, h = img.height || img.naturalHeight || 0;
    const ud = tex.userData || {};
    return {
      size: `${w || '?'}x${h || '?'}`,
      repeat: `${Number(tex.repeat?.x ?? 1).toFixed(2)}x${Number(tex.repeat?.y ?? 1).toFixed(2)}`,
      flipY: tex.flipY !== false,
      state: ud.hobunjiAuthoredSurfaceState || '-',
      path: ud.hobunjiAuthoredSurfacePath || '-',
      sourceSize: ud.hobunjiAuthoredSurfaceImageSize || '-',
      error: ud.hobunjiAuthoredSurfaceError || null,
    };
  }

  function _pixelProbeTextureNeighborhood(mat, uv) {
    if (!mat?.map?.image || !uv) return null;
    const offsets = [[0, 0], [-0.035, 0], [0.035, 0], [0, -0.035], [0, 0.035], [-0.025, -0.025], [0.025, 0.025]];
    const samples = offsets.map(([du, dv]) => _pixelProbeTextureSampleAtUv(mat, { x: uv.x + du, y: uv.y + dv })).filter(Boolean);
    if (samples.length < 2) return null;
    const colors = samples.map(sample => sample.rgba);
    const mins = [0, 1, 2].map(channel => Math.min(...colors.map(color => color[channel])));
    const maxs = [0, 1, 2].map(channel => Math.max(...colors.map(color => color[channel])));
    const unique = new Set(colors.map(color => color.join(','))).size;
    return { unique, mins, maxs, samples: colors.length };
  }

  // Walks up from a raycast hit to find which avatar (if any) owns it —
"""
replace_once(probe, old, new)

old = """        const sample = _pixelProbeTextureSampleAtUv(m, hit.uv);
        if (sample) lines.push(`     texture sample at this mesh's own UV (${sample.uv[0].toFixed(3)},${sample.uv[1].toFixed(3)}) — occlusion-independent: rgba(${sample.rgba.join(',')})`);
        else if (m.map) lines.push(`     texture sample: unavailable (no UV on this hit)`);
"""
new = """        const sample = _pixelProbeTextureSampleAtUv(m, hit.uv);
        if (sample) lines.push(`     texture sample at this mesh's own UV (${sample.uv[0].toFixed(3)},${sample.uv[1].toFixed(3)}) — occlusion-independent: rgba(${sample.rgba.join(',')})`);
        else if (m.map) lines.push(`     texture sample: unavailable (no UV on this hit)`);
        const texMeta = _pixelProbeTextureMeta(m);
        if (texMeta) lines.push(`     texture meta: image=${texMeta.size} repeat=${texMeta.repeat} flipY=${texMeta.flipY} state=${texMeta.state} source=${texMeta.path} sourceImage=${texMeta.sourceSize}${texMeta.error ? ` error=${texMeta.error}` : ''}`);
        const neighborhood = _pixelProbeTextureNeighborhood(m, hit.uv);
        if (neighborhood) lines.push(`     texture neighborhood: ${neighborhood.samples} samples unique=${neighborhood.unique} rgbRange=R${neighborhood.mins[0]}-${neighborhood.maxs[0]} G${neighborhood.mins[1]}-${neighborhood.maxs[1]} B${neighborhood.mins[2]}-${neighborhood.maxs[2]}`);
"""
replace_once(probe, old, new)

print('patched authored-surface runtime fallbacks and Pixel Probe diagnostics')
