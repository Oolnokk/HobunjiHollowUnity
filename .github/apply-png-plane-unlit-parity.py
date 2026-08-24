from pathlib import Path


def replace_once(path, old, new):
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:100]!r}')
    path.write_text(text.replace(old, new), encoding='utf-8')


png = Path('docs/js/png-plane-avatar.js')
hand = Path('docs/js/procedural-hand-attachments.js')
feet = Path('docs/js/procedural-leg-animation.js')
natural = Path('docs/js/natural-surface-materials.js')

# 1) Make the PNG plane itself own one canonical unlit texture/material path.
old = """  function makeTextureFromCanvas(THREE, canvasEl, debugName) {
    const texture = new THREE.CanvasTexture(canvasEl);
    texture.name = debugName;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function makeSpriteMaterial(THREE, texture, debugName) {
    return new THREE.MeshBasicMaterial({
      name: debugName,
      map: texture,
      transparent: true,
      alphaTest: cfg().alphaTest ?? 0.001,
      side: THREE.FrontSide,
      // alphaTest already discards fully-transparent texels, so the opaque
      // sprite silhouette can safely write depth — without this, the depth
      // buffer behind the sprite still holds whatever was rendered before it
      // (e.g. a building wall), so later passes that re-test depth (like the
      // shell outline pass) draw straight through the sprite as if it weren't
      // there.
      depthWrite: true,
    });
  }
"""
new = """  // Canonical unlit appearance path for the PNG-plane avatar and any 3D
  // surface that must visually match it. Keep the texture color-management
  // behavior EXACTLY the same as the plane's long-standing CanvasTexture path:
  // assign colorSpace directly (no separate r128 encoding fallback), leave the
  // CanvasTexture's filter/mipmap defaults alone, and use MeshBasicMaterial.
  function configurePngPlaneUnlitTexture(THREE, texture, debugName) {
    if (!texture) return texture;
    if (debugName) texture.name = debugName;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function pngPlaneUnlitMaterialOptions(THREE, texture, debugName, overrides = {}) {
    return Object.assign({
      name: debugName,
      map: texture || null,
      transparent: true,
      alphaTest: cfg().alphaTest ?? 0.001,
      side: THREE.FrontSide,
      depthTest: true,
      // alphaTest already discards fully-transparent texels, so the opaque
      // sprite silhouette can safely write depth — without this, the depth
      // buffer behind the sprite still holds whatever was rendered before it
      // (e.g. a building wall), so later passes that re-test depth (like the
      // shell outline pass) draw straight through the sprite as if it weren't
      // there.
      depthWrite: true,
      opacity: 1,
    }, overrides);
  }

  function makePngPlaneUnlitMaterial(THREE, texture, debugName, overrides = {}) {
    return new THREE.MeshBasicMaterial(pngPlaneUnlitMaterialOptions(THREE, texture, debugName, overrides));
  }

  function makeTextureFromCanvas(THREE, canvasEl, debugName) {
    return configurePngPlaneUnlitTexture(THREE, new THREE.CanvasTexture(canvasEl), debugName);
  }

  function makeSpriteMaterial(THREE, texture, debugName) {
    return makePngPlaneUnlitMaterial(THREE, texture, debugName);
  }

  // Classic-script consumers (procedural hands/feet and natural surfaces) use
  // this exact builder instead of maintaining their own interpretation of
  // "unlit like the portrait plane".
  window.HobunjiPngPlaneUnlit = {
    configureTexture: configurePngPlaneUnlitTexture,
    materialOptions: pngPlaneUnlitMaterialOptions,
    makeMaterial: makePngPlaneUnlitMaterial,
    alphaTest: () => cfg().alphaTest ?? 0.001,
  };
"""
replace_once(png, old, new)

# 2) Hands: use the exact PNG-plane texture color-management path and material
# builder. Only side/depthWrite differ where the 3D hand geometry requires it.
old = """    const texture = new THREE.CanvasTexture(flatTintCanvas(resolvedHex));
    texture.name = `${normalizeKey(speciesId) || 'avatar'}_hand_body_wavy_surface`;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.25, 1);
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else if ('encoding' in texture && THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
    texture.needsUpdate = true;
"""
new = """    const textureName = `${normalizeKey(speciesId) || 'avatar'}_hand_body_wavy_surface`;
    const planeUnlit = global.HobunjiPngPlaneUnlit;
    const texture = planeUnlit?.configureTexture
      ? planeUnlit.configureTexture(THREE, new THREE.CanvasTexture(flatTintCanvas(resolvedHex)), textureName)
      : new THREE.CanvasTexture(flatTintCanvas(resolvedHex));
    if (!planeUnlit?.configureTexture) {
      texture.name = textureName;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
    }
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.25, 1);
"""
replace_once(hand, old, new)

old = """        const next = new THREE.MeshBasicMaterial({
          color: bodyTexture ? 0xffffff : roleColor(role, speciesId, bodyColors),
          map: bodyTexture,
          side: THREE.DoubleSide,
          depthWrite: !isParrotWingLayer,
        });
        next.name = material?.name || `${role}_hand_material`;
"""
new = """        const materialName = material?.name || `${role}_hand_material`;
        const next = global.HobunjiPngPlaneUnlit?.makeMaterial
          ? global.HobunjiPngPlaneUnlit.makeMaterial(THREE, bodyTexture, materialName, {
              color: bodyTexture ? 0xffffff : roleColor(role, speciesId, bodyColors),
              side: THREE.DoubleSide, // closed/turned hand geometry needs both sides; all other plane flags stay canonical
              depthWrite: !isParrotWingLayer,
            })
          : new THREE.MeshBasicMaterial({
              color: bodyTexture ? 0xffffff : roleColor(role, speciesId, bodyColors),
              map: bodyTexture,
              transparent: true,
              alphaTest: 0.001,
              side: THREE.DoubleSide,
              depthTest: true,
              depthWrite: !isParrotWingLayer,
              opacity: 1,
            });
        next.name = materialName;
"""
replace_once(hand, old, new)

old = """    const material = new THREE.MeshBasicMaterial({ color: bodyTexture ? 0xffffff : color, map: bodyTexture, side: THREE.DoubleSide });
    material.name = `${normalizeKey(speciesId) || 'avatar'}_hand_body`;
"""
new = """    const materialName = `${normalizeKey(speciesId) || 'avatar'}_hand_body`;
    const material = global.HobunjiPngPlaneUnlit?.makeMaterial
      ? global.HobunjiPngPlaneUnlit.makeMaterial(THREE, bodyTexture, materialName, {
          color: bodyTexture ? 0xffffff : color,
          side: THREE.DoubleSide,
        })
      : new THREE.MeshBasicMaterial({
          color: bodyTexture ? 0xffffff : color,
          map: bodyTexture,
          transparent: true,
          alphaTest: 0.001,
          side: THREE.DoubleSide,
          depthTest: true,
          depthWrite: true,
          opacity: 1,
        });
    material.name = materialName;
"""
replace_once(hand, old, new)

# 3) Feet: body texture now uses the exact species-aware body-sprite tint helper,
# then the exact PNG-plane CanvasTexture/material configuration.
old = """  async function buildSurfaceTexture(THREE, sourcePath, colorDescriptor, referenceHex, repeatX, debugName) {
    let source = null;
    try {
      const img = await loadSurfaceImage(sourcePath);
      if (typeof window.shadeFillTintForBodyColor === 'function' && typeof window.getShadeFillCanvas === 'function') {
        const tint = window.shadeFillTintForBodyColor(colorDescriptor, referenceHex);
        source = tint?.mode === 'shadeFill' ? window.getShadeFillCanvas(img, sourcePath, tint) : null;
      }
    } catch (error) {
      source = null;
    }
    if (!source) source = flatColorCanvas(resolveFlatColorHex(colorDescriptor, referenceHex));
    const texture = new THREE.CanvasTexture(source);
    // Named so debug tools (e.g. the Pixel Probe's material dump) show
    // something identifiable instead of "(unnamed texture)".
    texture.name = debugName || sourcePath;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX || 1.25, 1);
    texture.needsUpdate = true;
    return texture;
  }
"""
new = """  async function buildSurfaceTexture(THREE, sourcePath, colorDescriptor, referenceHex, repeatX, debugName, tintSpeciesId = '') {
    let source = null;
    try {
      const img = await loadSurfaceImage(sourcePath);
      if (typeof window.getBodyTintedCanvas === 'function') {
        // Same descriptor -> species tint-mode -> _imageForTint path used by
        // the portrait body sprite itself. Fixed bone/keratin hex descriptors
        // pass an empty species id so they retain the default shade-fill mode.
        source = window.getBodyTintedCanvas(img, sourcePath, colorDescriptor, tintSpeciesId, 'A') || null;
      } else if (typeof window.shadeFillTintForBodyColor === 'function' && typeof window.getShadeFillCanvas === 'function') {
        const tint = window.shadeFillTintForBodyColor(colorDescriptor, referenceHex);
        source = tint?.mode === 'shadeFill' ? window.getShadeFillCanvas(img, sourcePath, tint) : null;
      }
    } catch (error) {
      source = null;
    }
    if (!source) source = flatColorCanvas(resolveFlatColorHex(colorDescriptor, referenceHex));
    const textureName = debugName || sourcePath;
    const texture = window.HobunjiPngPlaneUnlit?.configureTexture
      ? window.HobunjiPngPlaneUnlit.configureTexture(THREE, new THREE.CanvasTexture(source), textureName)
      : new THREE.CanvasTexture(source);
    if (!window.HobunjiPngPlaneUnlit?.configureTexture) {
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
replace_once(feet, old, new)

old = """        promise = buildSurfaceTexture(THREE, 'assets/textures/carved_smooth.png', { hex: cfg().boneColorHex || '#D8C7A3' }, referenceHex, 1.25, `${speciesId}_foot_bone`);
      } else if (role === 'keratin') {
        promise = buildSurfaceTexture(THREE, 'assets/textures/boards.png', { hex: cfg().keratinColorHex || '#44484D' }, referenceHex, 1.4, `${speciesId}_foot_keratin`);
      } else {
        promise = buildSurfaceTexture(THREE, 'assets/textures/wavy_surface.png', bodyColorDescriptor(bodyColors), referenceHex, 1.25, `${speciesId}_foot_body`);
"""
new = """        promise = buildSurfaceTexture(THREE, 'assets/textures/carved_smooth.png', { hex: cfg().boneColorHex || '#D8C7A3' }, referenceHex, 1.25, `${speciesId}_foot_bone`, '');
      } else if (role === 'keratin') {
        promise = buildSurfaceTexture(THREE, 'assets/textures/boards.png', { hex: cfg().keratinColorHex || '#44484D' }, referenceHex, 1.4, `${speciesId}_foot_keratin`, '');
      } else {
        promise = buildSurfaceTexture(THREE, 'assets/textures/wavy_surface.png', bodyColorDescriptor(bodyColors), referenceHex, 1.25, `${speciesId}_foot_body`, speciesId);
"""
replace_once(feet, old, new)

old = """    const material = new THREE.MeshBasicMaterial({ color: initialColorHex || 0xffffff });
"""
new = """    const material = window.HobunjiPngPlaneUnlit?.makeMaterial
      ? window.HobunjiPngPlaneUnlit.makeMaterial(THREE, null, `${speciesId}_fallback_foot`, { color: initialColorHex || 0xffffff })
      : new THREE.MeshBasicMaterial({
          color: initialColorHex || 0xffffff,
          transparent: true,
          alphaTest: 0.001,
          side: THREE.FrontSide,
          depthTest: true,
          depthWrite: true,
          opacity: 1,
        });
"""
replace_once(feet, old, new)

old = """        const cloned = new THREE.MeshBasicMaterial({ map: texture, color: 0xffffff });
        cloned.name = material.name;
"""
new = """        const cloned = window.HobunjiPngPlaneUnlit?.makeMaterial
          ? window.HobunjiPngPlaneUnlit.makeMaterial(THREE, texture, material.name, { color: 0xffffff })
          : new THREE.MeshBasicMaterial({
              map: texture,
              color: 0xffffff,
              transparent: true,
              alphaTest: 0.001,
              side: THREE.FrontSide,
              depthTest: true,
              depthWrite: true,
              opacity: 1,
            });
        cloned.name = material.name;
"""
replace_once(feet, old, new)

# 4) Rocks/cliffs: use the PNG-plane texture configuration exactly. Preserve
# only geometry/source state that would be unsafe to force to sprite-plane
# values (side/transparency/polygon offset); the unlit class/color/depth and
# CanvasTexture color-management/filter defaults now come from the same source.
old = """    tex = markTextureSrgb(new THREE.CanvasTexture(flatTintCanvas(tint)));
    const wrapping = wrapMode === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapS = wrapping;
    tex.wrapT = wrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
"""
new = """    const textureName = `natural_${String(tint).toLowerCase()}_${wrapMode}`;
    tex = window.HobunjiPngPlaneUnlit?.configureTexture
      ? window.HobunjiPngPlaneUnlit.configureTexture(THREE, new THREE.CanvasTexture(flatTintCanvas(tint)), textureName)
      : new THREE.CanvasTexture(flatTintCanvas(tint));
    if (!window.HobunjiPngPlaneUnlit?.configureTexture) {
      tex.name = textureName;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    }
    const wrapping = wrapMode === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapS = wrapping;
    tex.wrapT = wrapping;
"""
replace_once(natural, old, new)

old = """    mat = new THREE.MeshBasicMaterial({
      map: texture || null,
      color: new THREE.Color(tint),
      side: sourceMaterial?.side ?? THREE.FrontSide,
      transparent: !!sourceMaterial?.transparent,
      opacity: sourceMaterial?.opacity ?? 1,
      alphaTest: sourceMaterial?.alphaTest || 0,
      depthTest: sourceMaterial?.depthTest !== false,
      depthWrite: sourceMaterial?.depthWrite !== false,
      polygonOffset: !!sourceMaterial?.polygonOffset,
      polygonOffsetFactor: sourceMaterial?.polygonOffsetFactor || 0,
      polygonOffsetUnits: sourceMaterial?.polygonOffsetUnits || 0,
    });
"""
new = """    const overrides = {
      color: new THREE.Color(tint),
      // Geometry-specific state stays inherited so cliffs/rocks do not move
      // into the transparent render queue or cull faces differently just to
      // imitate a 2D sprite. Everything that controls the unlit appearance is
      // provided by the PNG-plane builder.
      side: sourceMaterial?.side ?? THREE.FrontSide,
      transparent: !!sourceMaterial?.transparent,
      opacity: sourceMaterial?.opacity ?? 1,
      alphaTest: sourceMaterial?.alphaTest || 0,
      depthTest: sourceMaterial?.depthTest !== false,
      depthWrite: sourceMaterial?.depthWrite !== false,
      polygonOffset: !!sourceMaterial?.polygonOffset,
      polygonOffsetFactor: sourceMaterial?.polygonOffsetFactor || 0,
      polygonOffsetUnits: sourceMaterial?.polygonOffsetUnits || 0,
    };
    mat = window.HobunjiPngPlaneUnlit?.makeMaterial
      ? window.HobunjiPngPlaneUnlit.makeMaterial(THREE, texture || null, `natural_${surface}_${tint}`, overrides)
      : new THREE.MeshBasicMaterial({ map: texture || null, ...overrides });
"""
replace_once(natural, old, new)

print('Applied PNG-plane unlit parity to portrait, hands, feet, rocks, and cliffs.')
