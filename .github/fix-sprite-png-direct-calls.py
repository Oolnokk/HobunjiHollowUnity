from pathlib import Path


def replace_all(path, old, new, expected=None):
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if expected is not None and count != expected:
        raise SystemExit(f'{path}: expected {expected} matches, found {count}: {old!r}')
    if count == 0:
        raise SystemExit(f'{path}: no matches: {old!r}')
    path.write_text(text.replace(old, new), encoding='utf-8')

hand = Path('docs/js/procedural-hand-attachments.js')
feet = Path('docs/js/procedural-leg-animation.js')
natural = Path('docs/js/natural-surface-materials.js')

# Hands: stop entering texture/material setup through the compatibility alias.
replace_all(
    hand,
    """    const planeUnlit = global.HobunjiPngPlaneUnlit;\n    const texture = planeUnlit?.configureTexture\n      ? planeUnlit.configureTexture(THREE, new THREE.CanvasTexture(flatTintCanvas(resolvedHex)), textureName)\n      : new THREE.CanvasTexture(flatTintCanvas(resolvedHex));\n    if (!planeUnlit?.configureTexture) {\n""",
    """    const spritePngSurface = global.HobunjiSpritePngSurface || global.HobunjiPngPlaneUnlit;\n    const texture = spritePngSurface?.configureTexture\n      ? spritePngSurface.configureTexture(THREE, new THREE.CanvasTexture(flatTintCanvas(resolvedHex)), textureName)\n      : new THREE.CanvasTexture(flatTintCanvas(resolvedHex));\n    if (!spritePngSurface?.configureTexture) {\n""",
    expected=1,
)
replace_all(
    hand,
    """        const next = (global.HobunjiSpritePngSurface || global.HobunjiPngPlaneUnlit)?.makeMaterial\n          ? global.HobunjiPngPlaneUnlit.makeMaterial(THREE, bodyTexture, materialName, {\n""",
    """        const spritePngSurface = global.HobunjiSpritePngSurface || global.HobunjiPngPlaneUnlit;\n        const next = spritePngSurface?.makeMaterial\n          ? spritePngSurface.makeMaterial(THREE, bodyTexture, materialName, {\n""",
    expected=1,
)
replace_all(
    hand,
    """    const material = (global.HobunjiSpritePngSurface || global.HobunjiPngPlaneUnlit)?.makeMaterial\n      ? global.HobunjiPngPlaneUnlit.makeMaterial(THREE, bodyTexture, materialName, {\n""",
    """    const spritePngSurface = global.HobunjiSpritePngSurface || global.HobunjiPngPlaneUnlit;\n    const material = spritePngSurface?.makeMaterial\n      ? spritePngSurface.makeMaterial(THREE, bodyTexture, materialName, {\n""",
    expected=1,
)

# Feet: resolve the canonical sprite-PNG surface object once at each creation
# site, instead of testing one object and then calling the old plane alias.
replace_all(
    feet,
    """    const texture = (window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit)?.configureTexture\n      ? window.HobunjiPngPlaneUnlit.configureTexture(THREE, new THREE.CanvasTexture(source), textureName)\n      : new THREE.CanvasTexture(source);\n    if (!(window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit)?.configureTexture) {\n""",
    """    const spritePngSurface = window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit;\n    const texture = spritePngSurface?.configureTexture\n      ? spritePngSurface.configureTexture(THREE, new THREE.CanvasTexture(source), textureName)\n      : new THREE.CanvasTexture(source);\n    if (!spritePngSurface?.configureTexture) {\n""",
    expected=1,
)
replace_all(
    feet,
    """    const material = (window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit)?.makeMaterial\n      ? window.HobunjiPngPlaneUnlit.makeMaterial(THREE, null, `${speciesId}_fallback_foot`, { color: initialColorHex || 0xffffff })\n""",
    """    const spritePngSurface = window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit;\n    const material = spritePngSurface?.makeMaterial\n      ? spritePngSurface.makeMaterial(THREE, null, `${speciesId}_fallback_foot`, { color: initialColorHex || 0xffffff })\n""",
    expected=1,
)
replace_all(
    feet,
    """        const cloned = (window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit)?.makeMaterial\n          ? window.HobunjiPngPlaneUnlit.makeMaterial(THREE, texture, material.name, { color: 0xffffff })\n""",
    """        const spritePngSurface = window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit;\n        const cloned = spritePngSurface?.makeMaterial\n          ? spritePngSurface.makeMaterial(THREE, texture, material.name, { color: 0xffffff })\n""",
    expected=1,
)

# Natural surfaces: same cleanup for both the PNG texture and material paths.
replace_all(
    natural,
    """    tex = (window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit)?.configureTexture\n      ? window.HobunjiPngPlaneUnlit.configureTexture(THREE, new THREE.CanvasTexture(flatTintCanvas(tint)), textureName)\n      : new THREE.CanvasTexture(flatTintCanvas(tint));\n    if (!(window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit)?.configureTexture) {\n""",
    """    const spritePngSurface = window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit;\n    tex = spritePngSurface?.configureTexture\n      ? spritePngSurface.configureTexture(THREE, new THREE.CanvasTexture(flatTintCanvas(tint)), textureName)\n      : new THREE.CanvasTexture(flatTintCanvas(tint));\n    if (!spritePngSurface?.configureTexture) {\n""",
    expected=1,
)
replace_all(
    natural,
    """      // imitate a 2D sprite. Everything that controls the unlit appearance is\n      // provided by the PNG-plane builder.\n""",
    """      // imitate a 2D sprite. Everything that controls the authored-PNG unlit\n      // appearance is provided by the same sprite surface builder as body art.\n""",
    expected=1,
)
replace_all(
    natural,
    """    mat = (window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit)?.makeMaterial\n      ? window.HobunjiPngPlaneUnlit.makeMaterial(THREE, texture || null, `natural_${surface}_${tint}`, overrides)\n""",
    """    const spritePngSurface = window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit;\n    mat = spritePngSurface?.makeMaterial\n      ? spritePngSurface.makeMaterial(THREE, texture || null, `natural_${surface}_${tint}`, overrides)\n""",
    expected=1,
)
