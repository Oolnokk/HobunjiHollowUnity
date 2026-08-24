from pathlib import Path


def replace_exact(path, old, new, expected=1):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{path}: expected {expected} occurrences, found {count}: {old!r}')
    p.write_text(text.replace(old, new), encoding='utf-8')


# Config: medium gray is a shade-fill target, not a GPU color multiplier.
config_path = 'docs/config/natural-surface-materials.js'
replace_exact(config_path, "tintTreatment: 'grass-luminance'", "tintTreatment: 'ground-shade-fill'", expected=2)


path = Path('docs/js/natural-surface-materials.js')
text = path.read_text(encoding='utf-8')

replace_pairs = [
    (
        "      rocks:  { enabled: true, tint: '#808080', mapping: 'planar-stretch' },\n",
        "      rocks:  { enabled: true, tint: '#808080', tintTreatment: 'ground-shade-fill', mapping: 'planar-stretch' },\n",
    ),
    (
        "      cliffs: { enabled: true, tint: '#808080', mapping: 'world-stretch' },\n",
        "      cliffs: { enabled: true, tint: '#808080', tintTreatment: 'ground-shade-fill', mapping: 'world-stretch' },\n",
    ),
]
for old, new in replace_pairs:
    if text.count(old) != 1:
        raise SystemExit(f'natural-surface defaults changed: {old!r}')
    text = text.replace(old, new)

source_tint_marker = "  function sourceTint(material) {\n"
if text.count(source_tint_marker) != 1:
    raise SystemExit('sourceTint insertion marker changed')
shade_helpers = r'''  function parseHexRgb(hex) {
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

'''
text = text.replace(source_tint_marker, shade_helpers + source_tint_marker)

old_texture_for_surface = r'''  function textureForSurface(surface, wrapMode = 'clamp') {
    return loadBaseTexture(texturePath(cfgFor(surface)), wrapMode);
  }
'''
new_texture_for_surface = r'''  function textureForSurface(surface, wrapMode = 'clamp', resolvedTint = null) {
    const surfaceCfg = cfgFor(surface);
    const tint = resolvedTint || surfaceCfg.tint;
    return shouldBakeTint(surfaceCfg, tint)
      ? loadShadeFillTexture(texturePath(surfaceCfg), tint, wrapMode)
      : loadBaseTexture(texturePath(surfaceCfg), wrapMode);
  }
'''
if text.count(old_texture_for_surface) != 1:
    raise SystemExit('textureForSurface block changed')
text = text.replace(old_texture_for_surface, new_texture_for_surface)

old_naturalize_mesh = r'''    prepareUv(mesh.geometry, mapping);
    const tex = textureForSurface(surface);
    const tint = resolveTint(surfaceCfg, sourceMaterial);
    mesh.material = basicMaterial(surface, sourceMaterial, tex, tint);
'''
new_naturalize_mesh = r'''    prepareUv(mesh.geometry, mapping);
    const tint = resolveTint(surfaceCfg, sourceMaterial);
    const bakeTint = shouldBakeTint(surfaceCfg, tint); // Uses shade-fill so #808080 is the texture's target color instead of a second dark multiplier.
    const tex = textureForSurface(surface, 'clamp', tint);
    mesh.material = basicMaterial(surface, sourceMaterial, tex, bakeTint ? '#ffffff' : tint);
'''
if text.count(old_naturalize_mesh) != 1:
    raise SystemExit('naturalizeMesh material block changed')
text = text.replace(old_naturalize_mesh, new_naturalize_mesh)

old_slot_block = r'''    // A multi-material plateau shares ONE uv attribute between its grass top
    // and stone cliff group. Normalizing that geometry for the cliff slot
    // would also remap the grass material. Preserve the authored world UVs
    // here and reuse the source texture when it already exists; otherwise use
    // one shared repeating fallback texture. Single-material cliff meshes still
    // use assignWorldStretchUv() through naturalizeMesh(), where changing the
    // sole UV channel is safe.
    let tex;
    if (mapping === 'world-stretch') {
      tex = sourceMaterial.map || textureForSurface(surface, 'repeat');
    } else {
      prepareUv(mesh.geometry, mapping);
      tex = textureForSurface(surface);
    }

    const tint = resolveTint(surfaceCfg, sourceMaterial);
    const materials = mesh.material.slice();
    materials[slot] = basicMaterial(surface, sourceMaterial, tex, tint);
'''
new_slot_block = r'''    // A multi-material plateau shares ONE uv attribute between its grass top
    // and stone cliff group. Normalizing that geometry for the cliff slot
    // would also remap the grass material, so preserve the authored world UVs.
    // The MATERIAL map is still forced to this surface's configured texture;
    // otherwise an old source map can silently bypass carved_smooth.png.
    const tint = resolveTint(surfaceCfg, sourceMaterial);
    const bakeTint = shouldBakeTint(surfaceCfg, tint); // Baked target color keeps carved_smooth shading without multiplying it dark again.
    let tex;
    if (mapping === 'world-stretch') {
      tex = textureForSurface(surface, 'repeat', tint);
    } else {
      prepareUv(mesh.geometry, mapping);
      tex = textureForSurface(surface, 'clamp', tint);
    }

    const materials = mesh.material.slice();
    materials[slot] = basicMaterial(surface, sourceMaterial, tex, bakeTint ? '#ffffff' : tint);
'''
if text.count(old_slot_block) != 1:
    raise SystemExit('naturalizeMaterialSlot block changed')
text = text.replace(old_slot_block, new_slot_block)

old_candidate_header = r'''    const cliffCfg = cfgFor('cliffs');
    const basename = texturePath(cliffCfg).split('/').pop();
    const tintHex = String(cliffCfg.tint || '').replace('#', '').toLowerCase();
'''
new_candidate_header = r'''    const cliffCfg = cfgFor('cliffs');
    const basename = texturePath(cliffCfg).split('/').pop();
    const tintHex = String(cliffCfg.tint || '').replace('#', '').toLowerCase();
    const knownCliffTints = new Set([tintHex, '5f5a56', '6a6460', '808080']); // Lets legacy border-cliff materials be upgraded even when they do not already carry carved_smooth.png.
'''
if text.count(old_candidate_header) != 1:
    raise SystemExit('cliff candidate header changed')
text = text.replace(old_candidate_header, new_candidate_header)

old_candidate_test = "        if (!String(src).includes(basename) && (!tintHex || colorHex !== tintHex)) continue;\n"
new_candidate_test = "        if (!String(src).includes(basename) && !knownCliffTints.has(colorHex)) continue;\n"
if text.count(old_candidate_test) != 1:
    raise SystemExit('cliff candidate test changed')
text = text.replace(old_candidate_test, new_candidate_test)

path.write_text(text, encoding='utf-8')
