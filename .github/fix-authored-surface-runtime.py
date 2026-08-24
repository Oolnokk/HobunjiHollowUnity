from pathlib import Path
import subprocess

# 1) Farm SHRUB visuals now reuse TREE_PRESETS.bush, whose native size is the
# same size used by buildWildernessBushMesh. Remove only the farm's old x2
# generic-shrub boost; town/border authored scenery keeps its own existing
# composition scale.
game_path = Path('docs/game.js')
game = game_path.read_text()
old_farm = '''          const vegGroup = window.FoliageGenerator.buildShrubMesh(col, row);
          vegGroup._windPhase = (col * 1.7 + row * 2.3) % (Math.PI * 2);
          vegGroup._windAmp   = 0.06;
          vegGroup.scale.set(2, 2, 2);
          vegGroup.position.set(col + 0.5, tileSurfaceY(tile.type), row + 0.5);
          scene.add(vegGroup);'''
new_farm = '''          const vegGroup = window.FoliageGenerator.buildShrubMesh(col, row);
          vegGroup._windPhase = (col * 1.7 + row * 2.3) % (Math.PI * 2);
          vegGroup._windAmp   = 0.06;
          // buildShrubMesh now returns TREE_PRESETS.bush, so its native scale
          // is already the regular wilderness-bush size. Do not apply the old
          // generic shrub x2 farm boost here.
          vegGroup.position.set(col + 0.5, tileSurfaceY(tile.type), row + 0.5);
          scene.add(vegGroup);'''
count = game.count(old_farm)
assert count == 1, f'expected exactly one farm shrub visual block, found {count}'
game = game.replace(old_farm, new_farm, 1)
game_path.write_text(game)

# 2) Natural authored-PNG materials already use the exact character-sprite
# MeshBasicMaterial factory. Make the light/color-management parity explicit
# and future-proof by copying the factory's canonical non-geometry rendering
# flags onto every natural-surface material. Geometry-only state (side,
# transparent/alpha/depth queue and polygon offset) remains source-specific.
nat_path = Path('docs/js/natural-surface-materials.js')
nat = nat_path.read_text()
anchor = '''  function resolveTint(surfaceCfg, sourceMaterial) {
    const tint = surfaceCfg.tint;
    if (!tint || tint === 'source') return sourceTint(sourceMaterial);
    return tint;
  }

  function basicMaterial(surface, sourceMaterial, texture, tint) {'''
replacement = '''  function resolveTint(surfaceCfg, sourceMaterial) {
    const tint = surfaceCfg.tint;
    if (!tint || tint === 'source') return sourceTint(sourceMaterial);
    return tint;
  }

  let _spritePngParityTemplate = null;
  function applySpritePngRenderParity(material, spritePngSurface) {
    if (!material) return material;
    // Natural surfaces and character sprites intentionally differ in geometry-
    // specific state (opaque vs alpha-cutout queue, occasional source-side
    // culling/polygon offset), but NOT in their light/color model. Derive these
    // flags from a real material produced by the canonical character PNG
    // factory instead of hardcoding Three.js defaults, so future changes to the
    // sprite path automatically carry over here too.
    if (!_spritePngParityTemplate && spritePngSurface?.makeMaterial) {
      _spritePngParityTemplate = spritePngSurface.makeMaterial(THREE, null, '__natural_surface_sprite_parity_template');
    }
    const template = _spritePngParityTemplate;
    if (template) {
      for (const key of ['lights', 'fog', 'toneMapped', 'dithering', 'premultipliedAlpha']) {
        if (key in template && key in material) material[key] = template[key];
      }
    } else {
      // Fallback path is still the same unlit material class as the character
      // plane's own fallback; never fall back to Lambert/Phong/PBR lighting.
      if ('lights' in material) material.lights = false;
    }
    material.userData = Object.assign({}, material.userData, {
      naturalSurfaceSpritePngParity: true,
      naturalSurfaceLightModel: 'character-png-unlit',
    });
    return material;
  }

  function basicMaterial(surface, sourceMaterial, texture, tint) {'''
assert anchor in nat, 'natural surface tint/basicMaterial anchor changed unexpectedly'
nat = nat.replace(anchor, replacement, 1)

old_make = '''    mat = spritePngSurface?.makeMaterial
      ? spritePngSurface.makeMaterial(THREE, texture || null, `natural_${surface}_${tint}`, overrides)
      : new THREE.MeshBasicMaterial({ map: texture || null, ...overrides });
    mat.name = `natural_${surface}_${tint}`;
    mat.userData = Object.assign({}, sourceMaterial?.userData, {
      naturalSurface: surface,
      naturalSurfaceUnlit: true,
    });'''
new_make = '''    mat = spritePngSurface?.makeMaterial
      ? spritePngSurface.makeMaterial(THREE, texture || null, `natural_${surface}_${tint}`, overrides)
      : new THREE.MeshBasicMaterial({ map: texture || null, ...overrides });
    applySpritePngRenderParity(mat, spritePngSurface);
    mat.name = `natural_${surface}_${tint}`;
    mat.userData = Object.assign({}, sourceMaterial?.userData, mat.userData, {
      naturalSurface: surface,
      naturalSurfaceUnlit: true,
    });'''
assert old_make in nat, 'natural surface material construction changed unexpectedly'
nat = nat.replace(old_make, new_make, 1)
nat_path.write_text(nat)

# Validation: syntax and guards for both requests plus prior authored-surface
# behavior that must not regress.
for js in [
    'docs/game.js',
    'docs/js/natural-surface-materials.js',
    'docs/js/foliage-generator.js',
    'docs/js/portrait-utils.js',
    'docs/js/procedural-hand-attachments.js',
    'docs/js/procedural-leg-animation.js',
]:
    subprocess.run(['node', '--check', js], check=True)

updated_game = game_path.read_text()
updated_nat = nat_path.read_text()
fol = Path('docs/js/foliage-generator.js').read_text()
portrait = Path('docs/js/portrait-utils.js').read_text()

assert 'buildShrubMesh now returns TREE_PRESETS.bush' in updated_game
assert old_farm not in updated_game
assert 'return buildConiferTreeGroup(TREE_PRESETS.bush, seedU32);' in fol
assert "buildWildernessBushMesh(col, row)" in fol
assert 'applySpritePngRenderParity(mat, spritePngSurface);' in updated_nat
assert "naturalSurfaceLightModel: 'character-png-unlit'" in updated_nat
assert "['lights', 'fog', 'toneMapped', 'dithering', 'premultipliedAlpha']" in updated_nat
assert 'new THREE.MeshBasicMaterial' in updated_nat
assert 'function makeSpritePngUnlitMaterial' in portrait
assert 'new THREE.MeshBasicMaterial(spritePngMaterialOptions' in portrait
assert "texture: 'assets/textures/wavy_surface.png'" in Path('docs/config/natural-surface-materials.js').read_text()
assert "texture: 'assets/textures/carved_smooth.png'" in Path('docs/config/natural-surface-materials.js').read_text()
subprocess.run(['git', 'diff', '--check'], check=True)
print('farm shrubs use native wilderness Bush size; natural PNG surfaces enforce character-sprite light/color parity')
