from pathlib import Path
import subprocess

path = Path('docs/js/procedural-hand-outline-parity.js')
text = path.read_text()
start = text.index('  function installMeshHook(mesh, rigState, side) {')
end = text.index('\n  function scanVisual(root, rigState, side) {', start)

replacement = r'''  function installMeshHook(mesh, rigState, side) {
    if (!mesh?.isMesh) return false;
    if (mesh.userData?.noOutline !== true) mesh.layers.enable(1); // Visual replacement/x-ray routing must never drop either hand from the shell layer.
    markHeldXray(mesh, rigState, side);
    if (mesh.userData?.__hobunjiHandOutlineParity) return false;

    const previousBefore = typeof mesh.onBeforeRender === 'function' ? mesh.onBeforeRender : null;
    const previousAfter = typeof mesh.onAfterRender === 'function' ? mesh.onAfterRender : null;
    const state = {
      visibleMatrixWorld: new THREE.Matrix4(), // Reconstructed from the exact modelViewMatrix used by the visible GPU draw.
      visibleCapturedAt: -Infinity,
      drawStack: [], // One entry per renderer callback; supports visible/shell/material-ID replay without leaking state.
    };

    mesh.onBeforeRender = function handOutlineParityBefore(...args) {
      previousBefore?.apply(this, args);
      const scene = args[1];
      const material = args[4];
      const now = performance.now();
      const visibleDraw = isVisibleHandDraw(scene, material);
      const passKind = visibleDraw ? 'visible' : outlinePassKind(scene, material);
      const draw = { kind: passKind || 'other', restoreMatrix: null, thicknessRestore: null };

      // Do NOT call updateWorldMatrix/updateMatrixWorld here. WeaponToolStances and
      // the direct-hand sentinel deliberately bake a final render-only transform and
      // then restore local values; recomputing the hierarchy during the outline pass
      // discards that baked stance and is exactly what separated shell from hand.
      if (passKind === 'shell' || passKind === 'material-id') {
        const thicknessUniform = passKind === 'shell' ? material?.uniforms?.uThickness : null;
        const previousThickness = Number(thicknessUniform?.value);
        if (thicknessUniform && Number.isFinite(previousThickness)) {
          draw.thicknessRestore = { uniform: thicknessUniform, value: previousThickness };
          thicknessUniform.value = previousThickness * OUTLINE_THICKNESS_MULTIPLIER;
          material.uniformsNeedUpdate = true;
        }

        const ageMs = now - state.visibleCapturedAt;
        if (ageMs >= 0 && ageMs <= MAX_SNAPSHOT_AGE_MS) {
          draw.restoreMatrix = this.matrixWorld.clone();
          this.matrixWorld.copy(state.visibleMatrixWorld);
          if (passKind === 'shell') {
            rigState.lockedShellDraws++;
            lockedShellDraws++;
          } else {
            rigState.lockedMaterialIdDraws++;
            lockedMaterialIdDraws++;
          }
        } else {
          rigState.missedOutlineSnapshots++;
          missedOutlineSnapshots++;
        }
      }

      state.drawStack.push(draw);
    };

    mesh.onAfterRender = function handOutlineParityAfter(...args) {
      const draw = state.drawStack.pop() || { kind: 'other', restoreMatrix: null, thicknessRestore: null };

      // Capture AFTER the visible draw. At this point Three.js has already derived
      // modelViewMatrix from the exact matrixWorld that reached the GPU. Rebuild the
      // corresponding world matrix from camera.matrixWorld * modelViewMatrix so late
      // render-time stance/mirror transforms cannot be lost to local-state restoration.
      if (draw.kind === 'visible') {
        const camera = args[2];
        if (camera?.matrixWorld && this.modelViewMatrix) {
          state.visibleMatrixWorld.multiplyMatrices(camera.matrixWorld, this.modelViewMatrix);
        } else {
          state.visibleMatrixWorld.copy(this.matrixWorld);
        }
        state.visibleCapturedAt = performance.now();
        rigState.baseMatrixCaptures++;
        baseMatrixCaptures++;
      }

      // Capture/restore our parity state before delegating to an older after-render
      // callback: an older callback is allowed to restore its own temporary state,
      // but the exact visible GPU matrix above must survive as our snapshot.
      previousAfter?.apply(this, args);

      if (draw.restoreMatrix) this.matrixWorld.copy(draw.restoreMatrix);
      if (draw.thicknessRestore) {
        draw.thicknessRestore.uniform.value = draw.thicknessRestore.value;
        const material = args[4];
        if (material?.isShaderMaterial) material.uniformsNeedUpdate = true;
      }
    };

    mesh.userData.__hobunjiHandOutlineParity = true;
    mesh.userData.hobunjiOutlineMatrixSource = 'visible-gpu-modelview';
    rigState.hookedMeshes++;
    return true;
  }
'''

text = text[:start] + replacement + text[end:]
text = text.replace("outlineMatrixSource: 'live-hand-hierarchy'", "outlineMatrixSource: 'visible-gpu-modelview'")
path.write_text(text)

# Guard the texture/UV behavior the user already confirmed working.
hand = Path('docs/js/procedural-hand-attachments.js').read_text()
feet = Path('docs/js/procedural-leg-animation.js').read_text()
assert "assets/textures/wavy_surface.png" in hand
assert "assets/textures/wavy_surface.png" in feet
assert 'hobunjiStretchFitUvAxes' in hand
assert 'hobunjiStretchFitUvAxes' in feet
assert 'this.updateWorldMatrix?.(true, false);' not in text
assert "visible-gpu-modelview" in text

subprocess.run(['node', '--check', str(path)], check=True)
print('locked hand shell to exact visible GPU model-view transform; preserved wavy stretch-fit surfaces')
