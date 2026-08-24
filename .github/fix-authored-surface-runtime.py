from pathlib import Path
import subprocess

path = Path('docs/js/procedural-hand-outline-parity.js')
text = path.read_text()

text = text.replace(
"// Hand placement has a deliberate late pre-render sync: an invisible sentinel updates\n// the hand sockets after toolHolder's render-time stance hook has produced its final\n// matrix. Outline rendering then uses separate shell and material-ID passes, often with\n// scene.autoUpdate=false. Capture each hand mesh's matrixWorld at its visible draw and\n// temporarily reuse that exact matrix for every outline override draw. The same meshes\n",
"// Hand placement has a deliberate late pre-render sync: an invisible sentinel updates\n// the hand sockets after toolHolder's render-time stance hook has produced its final\n// matrix. Outline rendering then uses separate shell and material-ID passes, often with\n// scene.autoUpdate=false. Snapshot each hand mesh's already-final matrixWorld directly\n// in the visible draw's onBeforeRender (the same ordering used by feet), then temporarily\n// reuse that exact matrix for every outline override draw. The same meshes\n",
1)

old_state = '''    const state = {
      visibleMatrixWorld: new THREE.Matrix4(), // Reconstructed from the exact modelViewMatrix used by the visible GPU draw.
      visibleCapturedAt: -Infinity,
      visibleCaptureSerial: 0, // Increments only for genuine color-writing hand draws.
      lastShellCaptureSerial: 0, // Prevents a second shell render from reusing an older visible-frame transform.
      drawStack: [], // One entry per renderer callback; supports visible/shell/material-ID replay without leaking state.
    };'''
new_state = '''    const state = {
      visibleMatrixWorld: new THREE.Matrix4(), // Exact matrixWorld about to be used by the latest genuine color-writing hand draw.
      visibleCapturedAt: -Infinity,
      restoreStack: [], // Per-render temporary matrix restores for shell/material-ID passes.
      thicknessRestoreStack: [], // Per-render shell-thickness restores so the shared uniform cannot leak.
    };'''
assert old_state in text, 'hand parity state block changed unexpectedly'
text = text.replace(old_state, new_state, 1)

start = text.index('    mesh.onBeforeRender = function handOutlineParityBefore(...args) {')
end = text.index('    mesh.userData.__hobunjiHandOutlineParity = true;', start)
new_hooks = '''    mesh.onBeforeRender = function handOutlineParityBefore(...args) {
      // Let any pre-existing hand/tool stance hook finish first. The snapshot below
      // must observe the same final matrixWorld that Three.js is about to use for
      // this color-writing draw — not a transform reconstructed after the fact.
      previousBefore?.apply(this, args);
      const scene = args[1];
      const material = args[4];
      const now = performance.now();

      if (isVisibleHandDraw(scene, material)) {
        state.visibleMatrixWorld.copy(this.matrixWorld);
        state.visibleCapturedAt = now;
        state.restoreStack.push(null);
        state.thicknessRestoreStack.push(null);
        rigState.baseMatrixCaptures++;
        baseMatrixCaptures++;
        return;
      }

      const passKind = outlinePassKind(scene, material);
      if (!passKind) {
        state.restoreStack.push(null);
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

      const ageMs = now - state.visibleCapturedAt;
      if (!(ageMs >= 0 && ageMs <= MAX_SNAPSHOT_AGE_MS)) {
        state.restoreStack.push(null);
        rigState.missedOutlineSnapshots++;
        missedOutlineSnapshots++;
        return;
      }

      // Three r128 calls Object3D.onBeforeRender BEFORE deriving modelViewMatrix
      // and normalMatrix. Copying the visible draw's direct matrixWorld here makes
      // the shell use precisely that pose. Do not call updateMatrixWorld and do not
      // reconstruct from modelViewMatrix after a draw; both alter the intended
      // base->secondary render ordering used by outline-render-performance.js.
      state.restoreStack.push(this.matrixWorld.clone());
      this.matrixWorld.copy(state.visibleMatrixWorld);
      if (passKind === 'shell') {
        rigState.lockedShellDraws++;
        lockedShellDraws++;
      } else {
        rigState.lockedMaterialIdDraws++;
        lockedMaterialIdDraws++;
      }
    };

    mesh.onAfterRender = function handOutlineParityAfter(...args) {
      // Delegate first, matching the feet parity adapter: any older callback gets
      // to clean up its own temporary render state before we restore ours.
      previousAfter?.apply(this, args);
      const restoreMatrix = state.restoreStack.pop();
      if (restoreMatrix) this.matrixWorld.copy(restoreMatrix);
      const thicknessRestore = state.thicknessRestoreStack.pop();
      if (thicknessRestore) {
        thicknessRestore.uniform.value = thicknessRestore.value;
        const material = args[4];
        if (material?.isShaderMaterial) material.uniformsNeedUpdate = true;
      }
    };

'''
text = text[:start] + new_hooks + text[end:]
text = text.replace("mesh.userData.hobunjiOutlineMatrixSource = 'visible-gpu-modelview';", "mesh.userData.hobunjiOutlineMatrixSource = 'visible-hand-pre-render';", 1)
text = text.replace("outlineMatrixSource: 'visible-gpu-modelview',", "outlineMatrixSource: 'visible-hand-pre-render',", 1)

# The old after-render reconstruction/serial machinery must be completely gone.
for forbidden in ['visibleCaptureSerial', 'lastShellCaptureSerial', 'camera.matrixWorld, this.modelViewMatrix', 'multiplyMatrices(camera.matrixWorld, this.modelViewMatrix)']:
    assert forbidden not in text, f'stale hand outline timing machinery remains: {forbidden}'
assert 'state.visibleMatrixWorld.copy(this.matrixWorld);' in text
assert 'material?.colorWrite !== false' in text
assert "hobunjiOutlineMatrixSource = 'visible-hand-pre-render'" in text
assert 'OUTLINE_THICKNESS_MULTIPLIER = 2' in text
path.write_text(text)

# Protect the already-confirmed limb surface work while touching the outline adapter.
hand = Path('docs/js/procedural-hand-attachments.js').read_text()
feet = Path('docs/js/procedural-leg-animation.js').read_text()
assert 'assets/textures/wavy_surface.png' in hand and 'hobunjiStretchFitUvAxes' in hand
assert 'assets/textures/wavy_surface.png' in feet and 'hobunjiStretchFitUvAxes' in feet

subprocess.run(['node', '--check', 'docs/js/procedural-hand-outline-parity.js'], check=True)
subprocess.run(['node', '--check', 'docs/js/procedural-hand-attachments.js'], check=True)
subprocess.run(['node', '--check', 'docs/js/procedural-leg-animation.js'], check=True)
subprocess.run(['git', 'diff', '--check'], check=True)
print('moved hand outline transform capture to visible pre-render ordering; removed post-render reconstruction')
