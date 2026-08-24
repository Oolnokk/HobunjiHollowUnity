from pathlib import Path
import re


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'expected block not found in {path}: {old[:160]!r}')
    p.write_text(text.replace(old, new, 1))


def sub_once(path, pattern, replacement, flags=0):
    p = Path(path)
    text = p.read_text()
    new, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'expected exactly one match in {path}, got {count}: {pattern[:120]!r}')
    p.write_text(new)

# ---------------------------------------------------------------------------
# Return body-colored hand/foot surfaces to wavy_surface.png WITHOUT touching
# the newly working one-copy stretch-fit UV projection.
# ---------------------------------------------------------------------------
hand = 'docs/js/procedural-hand-attachments.js'
replace_once(
    hand,
    "    const sourcePath = isBody\n      ? 'assets/textures/canvas.png'\n      : 'assets/textures/carved_smooth.png';\n",
    "    const sourcePath = isBody\n      ? 'assets/textures/wavy_surface.png'\n      : 'assets/textures/carved_smooth.png';\n",
)
replace_once(hand, "          bodySurfaceTexture: 'canvas.png',", "          bodySurfaceTexture: 'wavy_surface.png',")

feet = 'docs/js/procedural-leg-animation.js'
replace_once(
    feet,
    "        promise = buildSurfaceTexture(THREE, 'assets/textures/canvas.png', bodyColorDescriptor(bodyColors), bodyReferenceHex, 1, `${speciesId}_foot_body`, speciesId);\n",
    "        promise = buildSurfaceTexture(THREE, 'assets/textures/wavy_surface.png', bodyColorDescriptor(bodyColors), bodyReferenceHex, 1, `${speciesId}_foot_body`, speciesId);\n",
)

# ---------------------------------------------------------------------------
# Hand outline parity: stop carrying a detached matrix snapshot from the held
# overlay into the later outline pass. Held hands are rendered in a selective
# replay with scene.autoUpdate=false, so explicitly refresh each mesh from its
# CURRENT live socket/GLB hierarchy immediately before EVERY visible/shell/ID
# draw. The shell then uses the exact same current matrixWorld as the GLB.
# ---------------------------------------------------------------------------
outline = 'docs/js/procedural-hand-outline-parity.js'
new_install = r'''  function installMeshHook(mesh, rigState, side) {
    if (!mesh?.isMesh) return false;
    if (mesh.userData?.noOutline !== true) mesh.layers.enable(1); // Visual replacement/x-ray routing must never drop either hand from the shell layer.
    markHeldXray(mesh, rigState, side);
    if (mesh.userData?.__hobunjiHandOutlineParity) return false;

    const previousBefore = typeof mesh.onBeforeRender === 'function' ? mesh.onBeforeRender : null;
    const previousAfter = typeof mesh.onAfterRender === 'function' ? mesh.onAfterRender : null;
    const state = {
      thicknessRestoreStack: [], // Per-draw shell-uniform restore entries; keeps non-limb outlines at the global thickness.
    };

    mesh.onBeforeRender = function handOutlineParityBefore(...args) {
      previousBefore?.apply(this, args);

      // The held-object replay and the outline optimization both intentionally
      // render with scene.autoUpdate=false. Rebuild this hand mesh from its live
      // socket -> visual -> GLB hierarchy here instead of reusing a matrix copied
      // from another render pass. This makes visible GLB, shell and material-ID
      // draws consume the same current transform, including left/right mirroring.
      this.updateWorldMatrix?.(true, false);

      const scene = args[1];
      const material = args[4];

      if (isVisibleHandDraw(scene, material)) {
        state.thicknessRestoreStack.push(null);
        rigState.baseMatrixCaptures++;
        baseMatrixCaptures++;
        return;
      }

      const passKind = outlinePassKind(scene, material);
      if (!passKind) {
        state.thicknessRestoreStack.push(null);
        return;
      }

      const thicknessUniform = passKind === 'shell' ? material?.uniforms?.uThickness : null;
      const previousThickness = Number(thicknessUniform?.value);
      if (thicknessUniform && Number.isFinite(previousThickness)) {
        state.thicknessRestoreStack.push({ uniform: thicknessUniform, value: previousThickness });
        thicknessUniform.value = previousThickness * OUTLINE_THICKNESS_MULTIPLIER;
        material.uniformsNeedUpdate = true;
      } else {
        state.thicknessRestoreStack.push(null);
      }

      if (passKind === 'shell') {
        rigState.lockedShellDraws++;
        lockedShellDraws++;
      } else {
        rigState.lockedMaterialIdDraws++;
        lockedMaterialIdDraws++;
      }
    };

    mesh.onAfterRender = function handOutlineParityAfter(...args) {
      previousAfter?.apply(this, args);
      const thicknessRestore = state.thicknessRestoreStack.pop();
      if (thicknessRestore) {
        thicknessRestore.uniform.value = thicknessRestore.value;
        const material = args[4];
        if (material?.isShaderMaterial) material.uniformsNeedUpdate = true;
      }
    };

    mesh.userData.__hobunjiHandOutlineParity = true;
    mesh.userData.hobunjiOutlineMatrixSource = 'live-hand-hierarchy';
    rigState.hookedMeshes++;
    return true;
  }
'''
sub_once(
    outline,
    r"  function installMeshHook\(mesh, rigState, side\) \{.*?\n  \}\n\n(?=  function scanVisual)",
    new_install + "\n",
    re.S,
)
# Keep diagnostics truthful; the historical field names remain for compatibility.
Path(outline).write_text(
    Path(outline).read_text()
      .replace("outlineMatrixSource: 'visible-hand-draw'", "outlineMatrixSource: 'live-hand-hierarchy'")
)

print('switched stretch-fit body surfaces back to wavy_surface and made hand outlines use live hierarchy matrices')
