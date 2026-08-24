from pathlib import Path
import re
import subprocess


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'expected block not found in {path}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1))


def regex_once(path, pattern, replacement):
    p = Path(path)
    text = p.read_text()
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'expected exactly one regex match in {path}; got {count}')
    p.write_text(next_text)


# ---------------------------------------------------------------------------
# HAND SURFACES
# Body-colored pachyderm/sloth/feline/parrot hand slots should use canvas.png.
# Pachyderm/sloth non-body slots are already classified as role="bone" by
# procedural-hand-foot-material-roles.js; give those claws/nails carved_smooth.
# Keep the same CORS-safe, sprite-tint, unlit, stretch-to-fit path for both.
# ---------------------------------------------------------------------------
hand_surface_block = r'''  const handSurfaceTextureCache = new Map(); // role/species/color -> shared authored CanvasTexture
  const handSurfaceSourcePromises = new Map(); // resolved PNG URL -> Promise<HTMLImageElement>

  function bodyReferenceHex(speciesId) {
    return typeof global._dyeReferenceHexForSlot === 'function'
      ? global._dyeReferenceHexForSlot('A', speciesId)
      : '#7dc89a';
  }

  function flatTintCanvas(hex) {
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
        const shade = Math.max(0.72, Math.min(1.18, l / 0.55));
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

  function loadHandSurfaceSource(sourcePath) {
    const resolvedPath = resolveAssetPath(sourcePath);
    if (handSurfaceSourcePromises.has(resolvedPath)) return handSurfaceSourcePromises.get(resolvedPath);
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      // Must be set before src: tinting reads the decoded PNG through getImageData().
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load ${sourcePath} for procedural hands`));
      image.src = resolvedPath;
    }).catch(error => {
      handSurfaceSourcePromises.delete(resolvedPath);
      throw error;
    });
    handSurfaceSourcePromises.set(resolvedPath, promise);
    return promise;
  }

  function handSurfaceTexture(THREE, role, speciesId, bodyColors) {
    if (role !== 'body' && role !== 'bone') return null;
    const referenceHex = bodyReferenceHex(speciesId);
    const isBody = role === 'body';
    const sourcePath = isBody
      ? 'assets/textures/canvas.png'
      : 'assets/textures/carved_smooth.png';
    const descriptor = isBody
      ? (bodyColors?.A || { hex: referenceHex })
      : { hex: profiles.data?.colors?.bone || '#D8C7A3' };
    const resolvedHex = isBody ? bodyColorHex(speciesId, bodyColors) : descriptor.hex;
    const tintSpeciesId = isBody ? speciesId : '';
    const spriteTintMode = isBody && typeof global.bodyTintModeForSpecies === 'function'
      ? global.bodyTintModeForSpecies(speciesId)
      : 'shadeFill';
    const cacheKey = `${role}:${normalizeKey(speciesId)}:${spriteTintMode}:${String(resolvedHex).toLowerCase()}`;
    if (handSurfaceTextureCache.has(cacheKey)) return handSurfaceTextureCache.get(cacheKey);

    const textureName = `${normalizeKey(speciesId) || 'avatar'}_hand_${role}_${sourcePath.split('/').pop().replace(/\.png$/i, '')}`;
    const spritePngSurface = global.HobunjiSpritePngSurface || global.HobunjiPngPlaneUnlit;
    const texture = spritePngSurface?.configureTexture
      ? spritePngSurface.configureTexture(THREE, new THREE.CanvasTexture(flatTintCanvas(resolvedHex)), textureName)
      : new THREE.CanvasTexture(flatTintCanvas(resolvedHex));
    if (!spritePngSurface?.configureTexture) {
      texture.name = textureName;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
    }
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1, 1);
    texture.userData = Object.assign({}, texture.userData, {
      hobunjiAuthoredSurfacePath: sourcePath,
      hobunjiAuthoredSurfaceState: 'flat-loading',
      hobunjiAuthoredSurfaceImageSize: 'none',
      hobunjiAuthoredSurfaceError: null,
    });
    handSurfaceTextureCache.set(cacheKey, texture);

    loadHandSurfaceSource(sourcePath).then(image => {
      let source = null;
      let sourceState = 'authored-png-raw-fallback';
      let sourceError = null;
      const spritePng = global.HobunjiSpritePngSurface;
      const tintSurfaceCanvas = spritePng?.tintSurfaceCanvas || spritePng?.tintBodyCanvas || global.getBodyTintedCanvas;
      if (typeof tintSurfaceCanvas === 'function') {
        try {
          source = tintSurfaceCanvas(image, sourcePath, descriptor, tintSpeciesId, 'A') || null;
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
      console.warn('[ProceduralHandAttachments] authored hand surface PNG failed to load; flat fallback remains visible:', sourcePath, error);
    });
    return texture;
  }
'''
regex_once(
    'docs/js/procedural-hand-attachments.js',
    r"  const handBodyTextureCache = new Map\(\);.*?(?=\n  function markOutline\(root\) \{)",
    hand_surface_block.rstrip(),
)

replace_once(
    'docs/js/procedural-hand-attachments.js',
    "        const bodyTexture = role === 'body' ? handBodySurfaceTexture(THREE, speciesId, bodyColors) : null; // Applied only to skin/body slots; bone and keratin retain their authored role colors.\n",
    "        const surfaceTexture = (role === 'body' || role === 'bone') ? handSurfaceTexture(THREE, role, speciesId, bodyColors) : null; // Body uses canvas.png; pachyderm/sloth bone-role claws/nails use carved_smooth.png.\n",
)
replace_once(
    'docs/js/procedural-hand-attachments.js',
    "          ? spritePngSurface.makeMaterial(THREE, bodyTexture, materialName, {\n              color: bodyTexture ? 0xffffff : roleColor(role, speciesId, bodyColors),",
    "          ? spritePngSurface.makeMaterial(THREE, surfaceTexture, materialName, {\n              color: surfaceTexture ? 0xffffff : roleColor(role, speciesId, bodyColors),",
)
replace_once(
    'docs/js/procedural-hand-attachments.js',
    "              color: bodyTexture ? 0xffffff : roleColor(role, speciesId, bodyColors),\n              map: bodyTexture,",
    "              color: surfaceTexture ? 0xffffff : roleColor(role, speciesId, bodyColors),\n              map: surfaceTexture,",
)
replace_once(
    'docs/js/procedural-hand-attachments.js',
    "        next.userData.hobunjiHandSurfaceTexture = bodyTexture ? 'wavy_surface.png' : null;",
    "        next.userData.hobunjiHandSurfaceTexture = surfaceTexture ? (role === 'bone' ? 'carved_smooth.png' : 'canvas.png') : null;",
)


# ---------------------------------------------------------------------------
# FOOT SURFACES
# Body-colored feet switch from wavy_surface.png to canvas.png. Bone-role foot
# slots were already carved_smooth.png; keep that explicit for pachyderm/sloth
# claws/nails. Stretch-to-fit remains ClampToEdge + 1x1.
# ---------------------------------------------------------------------------
replace_once(
    'docs/js/procedural-leg-animation.js',
    "// reference authoring tool uses for its own fallback feet: wavy_surface.png for\n  // ordinary \"body color 1\" skin, carved_smooth.png for the shared bone/claw",
    "// reference authoring tool uses for its own fallback feet: canvas.png for\n  // ordinary \"body color 1\" skin, carved_smooth.png for the shared bone/claw",
)
replace_once(
    'docs/js/procedural-leg-animation.js',
    "        promise = buildSurfaceTexture(THREE, 'assets/textures/wavy_surface.png', bodyColorDescriptor(bodyColors), referenceHex, 1.25, `${speciesId}_foot_body`, speciesId);",
    "        promise = buildSurfaceTexture(THREE, 'assets/textures/canvas.png', bodyColorDescriptor(bodyColors), referenceHex, 1, `${speciesId}_foot_body`, speciesId);",
)


# ---------------------------------------------------------------------------
# DOUBLE HAND/FOOT OUTLINE THICKNESS ONLY
# Both parity adapters already intercept every shell override draw. Temporarily
# multiply the shared shell shader's uThickness for each procedural limb mesh,
# then restore immediately in onAfterRender so all other outlined objects keep
# the global thickness.
# ---------------------------------------------------------------------------
def patch_outline_adapter(path, label, visible_branch_text, wrapper_marker):
    replace_once(
        path,
        "  const MAX_SNAPSHOT_AGE_MS = 160;",
        "  const MAX_SNAPSHOT_AGE_MS = 160;\n  const OUTLINE_THICKNESS_MULTIPLIER = 2; // Hands/feet only; shared shell uniform is restored after each limb mesh draw.",
    )
    replace_once(
        path,
        "      restoreStack: [], // Supports grouped/multiple draw callbacks without leaking a temporary outline matrix.\n",
        "      restoreStack: [], // Supports grouped/multiple draw callbacks without leaking a temporary outline matrix.\n      thicknessRestoreStack: [], // Per-draw shell-uniform restore entries; keeps non-limb outlines at the global thickness.\n",
    )
    replace_once(
        path,
        visible_branch_text,
        visible_branch_text.replace("        state.restoreStack.push(null);\n", "        state.restoreStack.push(null);\n        state.thicknessRestoreStack.push(null);\n"),
    )
    replace_once(
        path,
        "      const passKind = outlinePassKind(scene, material);\n      if (!passKind) {\n        state.restoreStack.push(null);\n        return;\n      }\n\n      const ageMs = now - state.visibleCapturedAt;",
        "      const passKind = outlinePassKind(scene, material);\n      if (!passKind) {\n        state.restoreStack.push(null);\n        state.thicknessRestoreStack.push(null);\n        return;\n      }\n\n      const thicknessUniform = passKind === 'shell' ? material?.uniforms?.uThickness : null;\n      const previousThickness = Number(thicknessUniform?.value);\n      if (thicknessUniform && Number.isFinite(previousThickness)) {\n        state.thicknessRestoreStack.push({ uniform: thicknessUniform, value: previousThickness });\n        thicknessUniform.value = previousThickness * OUTLINE_THICKNESS_MULTIPLIER;\n      } else {\n        state.thicknessRestoreStack.push(null);\n      }\n\n      const ageMs = now - state.visibleCapturedAt;",
    )
    replace_once(
        path,
        "      const restoreMatrix = state.restoreStack.pop();\n      if (restoreMatrix) this.matrixWorld.copy(restoreMatrix);",
        "      const restoreMatrix = state.restoreStack.pop();\n      if (restoreMatrix) this.matrixWorld.copy(restoreMatrix);\n      const thicknessRestore = state.thicknessRestoreStack.pop();\n      if (thicknessRestore) thicknessRestore.uniform.value = thicknessRestore.value;",
    )
    # Add the multiplier to diagnostics so Pixel/console debugging can confirm it.
    if label == 'hand':
        replace_once(
            path,
            "          outlineMissedSnapshots: rigState.missedOutlineSnapshots,\n",
            "          outlineMissedSnapshots: rigState.missedOutlineSnapshots,\n          outlineThicknessMultiplier: OUTLINE_THICKNESS_MULTIPLIER,\n",
        )
        replace_once(
            path,
            "        maxSnapshotAgeMs: MAX_SNAPSHOT_AGE_MS,\n",
            "        maxSnapshotAgeMs: MAX_SNAPSHOT_AGE_MS,\n        outlineThicknessMultiplier: OUTLINE_THICKNESS_MULTIPLIER,\n",
        )
    else:
        replace_once(
            path,
            "        maxSnapshotAgeMs: MAX_SNAPSHOT_AGE_MS,\n",
            "        maxSnapshotAgeMs: MAX_SNAPSHOT_AGE_MS,\n        outlineThicknessMultiplier: OUTLINE_THICKNESS_MULTIPLIER,\n",
        )


patch_outline_adapter(
    'docs/js/procedural-hand-outline-parity.js',
    'hand',
    "      if (isVisibleHandDraw(scene, material)) {\n        state.visibleMatrixWorld.copy(this.matrixWorld);\n        state.visibleCapturedAt = now;\n        state.restoreStack.push(null);\n        rigState.baseMatrixCaptures++;\n        baseMatrixCaptures++;\n        return;\n      }\n",
    '__hobunjiHandOutlineParityWrapped',
)
patch_outline_adapter(
    'docs/js/procedural-feet-outline-parity.js',
    'feet',
    "      if (isVisibleFootDraw(scene, material)) {\n        state.visibleMatrixWorld.copy(this.matrixWorld);\n        state.visibleCapturedAt = now;\n        state.restoreStack.push(null);\n        rigState.baseMatrixCaptures++;\n        baseMatrixCaptures++;\n        return;\n      }\n",
    '__hobunjiFeetOutlineParityWrapped',
)


# Validate all touched runtime files here; the rerun workflow also performs its
# existing surface-state checks after this script exits.
for js in (
    'docs/js/procedural-hand-attachments.js',
    'docs/js/procedural-leg-animation.js',
    'docs/js/procedural-hand-outline-parity.js',
    'docs/js/procedural-feet-outline-parity.js',
):
    subprocess.run(['node', '--check', js], check=True)
subprocess.run(['git', 'diff', '--check'], check=True)

# Guard the exact requested surface-role and outline behavior.
hand = Path('docs/js/procedural-hand-attachments.js').read_text()
feet = Path('docs/js/procedural-leg-animation.js').read_text()
hand_outline = Path('docs/js/procedural-hand-outline-parity.js').read_text()
feet_outline = Path('docs/js/procedural-feet-outline-parity.js').read_text()
assert "assets/textures/canvas.png" in hand
assert "assets/textures/carved_smooth.png" in hand
assert "role === 'body' || role === 'bone'" in hand
assert "assets/textures/canvas.png" in feet
assert "assets/textures/carved_smooth.png" in feet
assert "OUTLINE_THICKNESS_MULTIPLIER = 2" in hand_outline
assert "OUTLINE_THICKNESS_MULTIPLIER = 2" in feet_outline
assert "thicknessUniform.value = previousThickness * OUTLINE_THICKNESS_MULTIPLIER" in hand_outline
assert "thicknessUniform.value = previousThickness * OUTLINE_THICKNESS_MULTIPLIER" in feet_outline

print('patched canvas body surfaces, carved claws/nails, and 2x limb outlines')
