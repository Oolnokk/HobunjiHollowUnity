from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'expected block not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))


# The earlier surface-tone normalization was added while low contrast was
# suspected to be the missing-texture problem. Pixel Probe later proved the
# real cause was the CORS-tainted flat fallback. Undo that artificial darkening
# and feed authored surface PNG luminance directly into the same body-sprite
# tint function used by character art.
replace_once(
    'docs/js/portrait-utils.js',
    "function getSurfaceTintedCanvas(img, sourceKey, color, speciesId = '', slot = 'A') {\n  const normalized = normalizeAuthoredSurfacePngTone(img, sourceKey);\n  return _imageForTint(normalized, `${sourceKey}|surface-tone`, bodySpriteTintForColor(color, speciesId, slot));\n}",
    "function getSurfaceTintedCanvas(img, sourceKey, color, speciesId = '', slot = 'A') {\n  // Use the authored PNG's own luminance directly, exactly like ordinary body\n  // sprite art. The previous 0.22->0.88 surface remap was a workaround for a\n  // problem that turned out to be the CORS-tainted flat fallback instead.\n  return _imageForTint(img, sourceKey, bodySpriteTintForColor(color, speciesId, slot));\n}"
)

# Stretch wavy_surface.png once across each hand UV layout instead of repeating
# it 1.25x horizontally. Clamp also prevents authored UVs outside 0..1 from
# tiling another copy at the edges.
replace_once(
    'docs/js/procedural-hand-attachments.js',
    "    texture.wrapS = THREE.RepeatWrapping;\n    texture.wrapT = THREE.RepeatWrapping;\n    texture.repeat.set(1.25, 1);",
    "    texture.wrapS = THREE.ClampToEdgeWrapping;\n    texture.wrapT = THREE.ClampToEdgeWrapping;\n    texture.repeat.set(1, 1);"
)

# If the shared body-tint helper ever fails, keep the local fallback much
# lighter too instead of recreating the old deep 0.22 low-end remap.
replace_once(
    'docs/js/procedural-hand-attachments.js',
    "        const t = Math.max(0, Math.min(1, (l - low) / span));\n        const shade = Math.max(0.18, Math.min(1.18, (0.22 + 0.66 * t) / 0.55));",
    "        const shade = Math.max(0.72, Math.min(1.18, l / 0.55));"
)

# Feet use the same one-copy stretch-to-fit behavior. Keep repeatX in the
# function signature for compatibility with existing callers, but do not tile.
replace_once(
    'docs/js/procedural-leg-animation.js',
    "    texture.wrapS = THREE.RepeatWrapping;\n    texture.wrapT = THREE.RepeatWrapping;\n    texture.repeat.set(repeatX || 1.25, 1);",
    "    texture.wrapS = THREE.ClampToEdgeWrapping;\n    texture.wrapT = THREE.ClampToEdgeWrapping;\n    texture.repeat.set(1, 1);"
)
replace_once(
    'docs/js/procedural-leg-animation.js',
    "        const t = Math.max(0, Math.min(1, (l - low) / span));\n        const targetLum = 0.22 + 0.66 * t;\n        const shade = Math.max(0.18, Math.min(1.18, targetLum / 0.55));",
    "        const shade = Math.max(0.72, Math.min(1.18, l / 0.55));"
)

# Natural-surface emergency fallback should match the lighter behavior too.
# The normal rocks/cliffs path now bypasses the artificial tone normalization
# through HobunjiSpritePngSurface.tintSurfaceCanvas above.
replace_once(
    'docs/js/natural-surface-materials.js',
    "        const t = Math.max(0, Math.min(1, (l - low) / span));\n        const shade = Math.max(0.18, Math.min(1.18, (0.22 + 0.66 * t) / 0.55));",
    "        const shade = Math.max(0.72, Math.min(1.18, l / 0.55));"
)

# Remove the temporary workflow/trigger from the abandoned dispatch attempt;
# the known-good rerun job that executes this script will add all deletions to
# the same source commit.
for temp in (
    '.github/workflows/apply-surface-stretch-lighten.yml',
    '.github/surface-stretch-trigger.txt',
):
    Path(temp).unlink(missing_ok=True)

print('patched stretch-to-fit authored PNGs and removed artificial darkening')
