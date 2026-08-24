from pathlib import Path
import subprocess

# 1) Hand shell parity: depth-only PNG occluder replays must never overwrite
# the real visible hand transform. Also permit one shell draw per genuine
# visible capture, so auxiliary/duplicate outline renders cannot reuse a stale
# hand matrix and leave a detached black shell behind.
path = Path('docs/js/procedural-hand-outline-parity.js')
text = path.read_text()
old_visible = '''  function isVisibleHandDraw(scene, material) {
    // Any ordinary draw with the mesh's own material is a valid source matrix.
    // This includes the held-object selective overlay, which is the actual visible
    // hand draw once ground x-ray registration is active.
    return !scene?.overrideMaterial && !isShellMaterial(material) && !isMaterialIdMaterial(material);
  }'''
new_visible = '''  function isVisibleHandDraw(scene, material) {
    // Only a real COLOR-WRITING hand draw may become the outline transform source.
    // game.js replays PNG-plane materials with colorWrite=false immediately before
    // the shell pass to rebuild occluder depth. Treating that depth-only replay as
    // visible overwrote the correctly gripped hand matrix with a hierarchy-only one,
    // which produced a separate black hand-shaped shell.
    return !scene?.overrideMaterial
      && material?.colorWrite !== false
      && !isShellMaterial(material)
      && !isMaterialIdMaterial(material);
  }'''
assert old_visible in text, 'visible-hand classifier changed unexpectedly'
text = text.replace(old_visible, new_visible, 1)

old_state = '''    const state = {
      visibleMatrixWorld: new THREE.Matrix4(), // Reconstructed from the exact modelViewMatrix used by the visible GPU draw.
      visibleCapturedAt: -Infinity,
      drawStack: [], // One entry per renderer callback; supports visible/shell/material-ID replay without leaking state.
    };'''
new_state = '''    const state = {
      visibleMatrixWorld: new THREE.Matrix4(), // Reconstructed from the exact modelViewMatrix used by the visible GPU draw.
      visibleCapturedAt: -Infinity,
      visibleCaptureSerial: 0, // Increments only for genuine color-writing hand draws.
      lastShellCaptureSerial: 0, // Prevents a second shell render from reusing an older visible-frame transform.
      drawStack: [], // One entry per renderer callback; supports visible/shell/material-ID replay without leaking state.
    };'''
assert old_state in text, 'hand parity state changed unexpectedly'
text = text.replace(old_state, new_state, 1)

old_draw = "      const draw = { kind: passKind || 'other', restoreMatrix: null, thicknessRestore: null };"
new_draw = "      const draw = { kind: passKind || 'other', restoreMatrix: null, thicknessRestore: null, captureSerial: 0 };"
assert old_draw in text
text = text.replace(old_draw, new_draw, 1)

old_age = '''        const ageMs = now - state.visibleCapturedAt;
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
        }'''
new_age = '''        const ageMs = now - state.visibleCapturedAt;
        const captureIsFresh = passKind !== 'shell'
          || state.visibleCaptureSerial !== state.lastShellCaptureSerial;
        if (ageMs >= 0 && ageMs <= MAX_SNAPSHOT_AGE_MS && captureIsFresh) {
          draw.restoreMatrix = this.matrixWorld.clone();
          draw.captureSerial = state.visibleCaptureSerial;
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
        }'''
assert old_age in text, 'shell snapshot gate changed unexpectedly'
text = text.replace(old_age, new_age, 1)

old_capture = '''        state.visibleCapturedAt = performance.now();
        rigState.baseMatrixCaptures++;
        baseMatrixCaptures++;'''
new_capture = '''        state.visibleCapturedAt = performance.now();
        state.visibleCaptureSerial++;
        rigState.baseMatrixCaptures++;
        baseMatrixCaptures++;'''
assert old_capture in text
text = text.replace(old_capture, new_capture, 1)

old_restore = '''      previousAfter?.apply(this, args);

      if (draw.restoreMatrix) this.matrixWorld.copy(draw.restoreMatrix);
      if (draw.thicknessRestore) {'''
new_restore = '''      previousAfter?.apply(this, args);

      if (draw.kind === 'shell' && draw.captureSerial) {
        state.lastShellCaptureSerial = draw.captureSerial;
      }
      if (draw.restoreMatrix) this.matrixWorld.copy(draw.restoreMatrix);
      if (draw.thicknessRestore) {'''
assert old_restore in text
text = text.replace(old_restore, new_restore, 1)
path.write_text(text)

# 2) Natural surface config: tree/stump/bush wood gets wavy_surface; vines get
# carved_smooth. Both use the same body-sprite shade/fill canvas path as rocks,
# preserving each generator material's original bark/vine color as the target.
cfg_path = Path('docs/config/natural-surface-materials.js')
cfg = cfg_path.read_text()
old_trunks = '''      trunks: {
        enabled: true,
        tint: 'source',
        tintTreatment: 'ground-shade-fill',
        mapping: 'cylindrical-stretch'
      },'''
new_trunks = '''      trunks: {
        enabled: true,
        texture: 'assets/textures/wavy_surface.png',
        tint: 'source',
        tintTreatment: 'body-sprite-tint',
        mapping: 'cylindrical-stretch'
      },'''
assert old_trunks in cfg, 'trunk surface config changed unexpectedly'
cfg = cfg.replace(old_trunks, new_trunks, 1)
old_vines = '''      vines: {
        enabled: true,
        tint: 'source',
        tintTreatment: 'ground-shade-fill',
        mapping: 'cylindrical-stretch'
      },'''
new_vines = '''      vines: {
        enabled: true,
        texture: 'assets/textures/carved_smooth.png',
        tint: 'source',
        tintTreatment: 'body-sprite-tint',
        mapping: 'cylindrical-stretch'
      },'''
assert old_vines in cfg, 'vine surface config changed unexpectedly'
cfg = cfg.replace(old_vines, new_vines, 1)
cfg = cfg.replace(
"  // tint: 'source' preserves the generator's authored color family; '#rrggbb'\n  // supplies a fixed family. ground-shade-fill is the same PNG recolor path as\n  // textured terrain grass: getShadeFillCanvas() bakes the target color into a\n  // CanvasTexture while preserving the PNG's grain/shading, then the unlit\n  // material renders white so there is no second color multiplication.\n",
"  // tint: 'source' preserves the generator's authored color family; '#rrggbb'\n  // supplies a fixed family. body-sprite-tint sends the authored PNG through\n  // the same per-pixel body fill path used by character art and the rock/cliff\n  // surfaces, then renders it unlit/white so there is no second multiplication.\n"
)
cfg_path.write_text(cfg)

# 3) Runtime defaults/wrapper mirror the config and make the legacy generic
# shrub API participate in exactly the same non-leaf surface treatment.
nat_path = Path('docs/js/natural-surface-materials.js')
nat = nat_path.read_text()
old_defaults = '''      trunks: { enabled: true, tint: 'source', mapping: 'cylindrical-stretch' },
      vines:  { enabled: true, tint: 'source', mapping: 'cylindrical-stretch' },'''
new_defaults = '''      trunks: { enabled: true, texture: 'assets/textures/wavy_surface.png', tint: 'source', tintTreatment: 'body-sprite-tint', mapping: 'cylindrical-stretch' },
      vines:  { enabled: true, texture: 'assets/textures/carved_smooth.png', tint: 'source', tintTreatment: 'body-sprite-tint', mapping: 'cylindrical-stretch' },'''
assert old_defaults in nat, 'natural-surface defaults changed unexpectedly'
nat = nat.replace(old_defaults, new_defaults, 1)
old_specs = '''      buildJungleTreeMesh: true,
      buildCrownedPineMesh: false,
      buildShadewoodMesh: false,
      buildWildernessBushMesh: false,
      buildStumpMesh: false,'''
new_specs = '''      buildJungleTreeMesh: true,
      buildCrownedPineMesh: false,
      buildShadewoodMesh: false,
      buildShrubMesh: false,
      buildWildernessBushMesh: false,
      buildStumpMesh: false,'''
assert old_specs in nat, 'foliage wrapper list changed unexpectedly'
nat = nat.replace(old_specs, new_specs, 1)
nat_path.write_text(nat)

# 4) The farm/town/border generic SHRUB visual was still the old custom shrub.
# Reuse the foliage generator's proper Bush preset instead; existing call-site
# scaling/placement stays unchanged so this is a shape/material swap, not a map
# layout change.
fol_path = Path('docs/js/foliage-generator.js')
fol = fol_path.read_text()
old_shrub = '''    buildShrubMesh(col, row) {
      const seedU32 = xfnv1a(`sh_${col}_${row}`);
      return buildShrubGroup(seedU32);
    },'''
new_shrub = '''    buildShrubMesh(col, row) {
      const seedU32 = xfnv1a(`sh_${col}_${row}`);
      // Legacy farm/town SHRUB tiles now use the foliage-generator's proper
      // Bush preset. Callers retain their existing placement and scale rules.
      return buildConiferTreeGroup(TREE_PRESETS.bush, seedU32);
    },'''
assert old_shrub in fol, 'generic shrub API changed unexpectedly'
fol = fol.replace(old_shrub, new_shrub, 1)
fol_path.write_text(fol)

# Validation: syntax + key behavioral guards. Do not let this follow-up regress
# the already-confirmed limb textures/stretch mapping or accidentally texture leaves.
for js in [
    'docs/js/procedural-hand-outline-parity.js',
    'docs/js/natural-surface-materials.js',
    'docs/js/foliage-generator.js',
    'docs/js/procedural-hand-attachments.js',
    'docs/js/procedural-leg-animation.js',
]:
    subprocess.run(['node', '--check', js], check=True)

hand = Path('docs/js/procedural-hand-attachments.js').read_text()
feet = Path('docs/js/procedural-leg-animation.js').read_text()
assert "assets/textures/wavy_surface.png" in hand and 'hobunjiStretchFitUvAxes' in hand
assert "assets/textures/wavy_surface.png" in feet and 'hobunjiStretchFitUvAxes' in feet
assert 'material?.colorWrite !== false' in text
assert 'visibleCaptureSerial' in text and 'lastShellCaptureSerial' in text
assert "texture: 'assets/textures/wavy_surface.png'" in cfg
assert "texture: 'assets/textures/carved_smooth.png'" in cfg
assert "tintTreatment: 'body-sprite-tint'" in cfg
assert 'buildShrubMesh: false' in nat
assert 'return buildConiferTreeGroup(TREE_PRESETS.bush, seedU32);' in fol
assert 'leafMesh.userData.noOutline = true' in fol  # leaf mesh remains a distinct untouched material path
subprocess.run(['git', 'diff', '--check'], check=True)
print('fixed hand depth-replay shell capture; applied authored surfaces to wood/vines; replaced generic shrub with Bush preset')
