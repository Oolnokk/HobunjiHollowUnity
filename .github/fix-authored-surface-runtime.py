from pathlib import Path
import re


def sub_once(path, pattern, replacement, flags=0):
    p = Path(path)
    text = p.read_text()
    new, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'expected exactly one match in {path}: {pattern[:100]!r}, got {count}')
    p.write_text(new)


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'expected block not found in {path}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1))

# ---------------------------------------------------------------------------
# Hands: true one-copy stretch fit + make both sockets authoritative for outline
# ---------------------------------------------------------------------------
hand = 'docs/js/procedural-hand-attachments.js'
hand_uv = r'''  function ensureHandSurfaceUvs(THREE, geometry) {
    if (!geometry?.getAttribute) return;
    const position = geometry.getAttribute('position');
    if (!position?.count) return;
    geometry.computeBoundingBox?.();
    const box = geometry.boundingBox;
    if (!box) return;

    // Stretch one copy of the authored PNG over the WHOLE mesh, rather than
    // box-projecting a fresh 0..1 copy onto every face. Pick the two largest
    // object-space dimensions so a thin hand/foot uses its broad silhouette.
    const axes = [
      { key: 'x', min: box.min.x, size: Math.max(1e-6, box.max.x - box.min.x) },
      { key: 'y', min: box.min.y, size: Math.max(1e-6, box.max.y - box.min.y) },
      { key: 'z', min: box.min.z, size: Math.max(1e-6, box.max.z - box.min.z) },
    ].sort((a, b) => b.size - a.size);
    const uAxis = axes[0], vAxis = axes[1];
    const read = (axis, i) => axis.key === 'x' ? position.getX(i) : axis.key === 'y' ? position.getY(i) : position.getZ(i);
    const uvs = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
      uvs[i * 2] = Math.max(0, Math.min(1, (read(uAxis, i) - uAxis.min) / uAxis.size));
      uvs[i * 2 + 1] = Math.max(0, Math.min(1, (read(vAxis, i) - vAxis.min) / vAxis.size));
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.userData = { ...(geometry.userData || {}), hobunjiStretchFitUvAxes: `${uAxis.key}${vAxis.key}` };
  }
'''
sub_once(
    hand,
    r"  function ensureHandSurfaceUvs\(THREE, geometry\) \{.*?\n  \}\n\n(?=  function handSurfaceTexture)",
    hand_uv + "\n",
    re.S,
)
replace_once(
    hand,
    "    const geometry = new THREE.SphereGeometry(size * 0.42, 14, 10);\n    geometry.scale(0.72, 1, 0.55);\n",
    "    const geometry = new THREE.SphereGeometry(size * 0.42, 14, 10);\n    geometry.scale(0.72, 1, 0.55);\n    ensureHandSurfaceUvs(THREE, geometry); // Fallback hands use the same single-copy stretch projection as GLB hands.\n",
)
replace_once(
    hand,
    "      rec.visual = visual;\n      rec.socket.add(visual);\n      rec.guide.visible = showGripGuides;\n",
    "      rec.visual = visual;\n      if (visual) {\n        visual.name = `${side}_hand_visual`; // Fallback and GLB visuals share the same stable name for outline rescans.\n        rec.socket.add(visual);\n        markOutline(visual); // Reassert layer 1 after every visual replacement, including the left hand.\n      }\n      rec.guide.visible = showGripGuides;\n",
)
replace_once(hand, "          bodySurfaceTexture: 'wavy_surface.png',", "          bodySurfaceTexture: 'canvas.png',")

# Outline adapter: inspect both socket contents directly and repair layer 1 each scan.
outline = 'docs/js/procedural-hand-outline-parity.js'
replace_once(
    outline,
    "  function installMeshHook(mesh, rigState, side) {\n    if (!mesh?.isMesh) return false;\n    markHeldXray(mesh, rigState, side);\n",
    "  function installMeshHook(mesh, rigState, side) {\n    if (!mesh?.isMesh) return false;\n    if (mesh.userData?.noOutline !== true) mesh.layers.enable(1); // Visual replacement/x-ray routing must never drop either hand from the shell layer.\n    markHeldXray(mesh, rigState, side);\n",
)
scan_rig = r'''  function scanRig(rig, rigState) {
    let found = false;
    for (const side of ['left', 'right']) {
      const socket = rig?.group?.getObjectByName?.(`${side}_hand_socket`) || null;
      if (!socket) continue;
      found = true;
      // The socket is authoritative. Do not depend on whether a fallback/GLB
      // visual happened to have the expected child name at the instant it was installed.
      for (const child of socket.children || []) {
        if (child?.name === `${side}_hand_grip_axes`) continue;
        scanVisual(child, rigState, side);
      }
    }
    if (!found) rig?.group?.traverse?.(child => installMeshHook(child, rigState, null));
  }
'''
sub_once(outline, r"  function scanRig\(rig, rigState\) \{.*?\n  \}\n\n(?=  function waitForInitialGlbs)", scan_rig + "\n", re.S)

# ---------------------------------------------------------------------------
# Feet: true stretch fit + tint non-body roles from their original GLB hex.
# ---------------------------------------------------------------------------
feet = 'docs/js/procedural-leg-animation.js'

role_resolver = r'''  function makeSurfaceRoleResolver(THREE, speciesId, bodyColors) {
    const bodyReferenceHex = referenceHexForSpecies(speciesId);
    const promises = new Map();
    return (role, originalMaterialHex = null) => {
      const cleanOriginalHex = /^#[0-9a-f]{6}$/i.test(String(originalMaterialHex || ''))
        ? String(originalMaterialHex).toUpperCase()
        : null;
      const cacheKey = role === 'body' ? 'body' : `${role}|${cleanOriginalHex || 'fallback'}`;
      if (promises.has(cacheKey)) return promises.get(cacheKey);
      let promise;
      if (role === 'bone') {
        // The old flat GLB material is the color authority for claws/nails.
        // Run carved_smooth.png through the SAME shade/body-fill method as body
        // sprites, using that original bland material hex as both target and reference.
        const baseHex = cleanOriginalHex || cfg().boneColorHex || '#D8C7A3';
        promise = buildSurfaceTexture(THREE, 'assets/textures/carved_smooth.png', { hex: baseHex }, baseHex, 1, `${speciesId}_foot_bone_${baseHex.slice(1)}`, '');
      } else if (role === 'keratin') {
        const baseHex = cleanOriginalHex || cfg().keratinColorHex || '#44484D';
        promise = buildSurfaceTexture(THREE, 'assets/textures/boards.png', { hex: baseHex }, baseHex, 1, `${speciesId}_foot_keratin_${baseHex.slice(1)}`, '');
      } else {
        promise = buildSurfaceTexture(THREE, 'assets/textures/canvas.png', bodyColorDescriptor(bodyColors), bodyReferenceHex, 1, `${speciesId}_foot_body`, speciesId);
      }
      promises.set(cacheKey, promise);
      return promise;
    };
  }
'''
sub_once(
    feet,
    r"  function makeSurfaceRoleResolver\(THREE, speciesId, bodyColors\) \{.*?\n  \}\n\n(?=  // ── Box-projected UVs)",
    role_resolver + "\n",
    re.S,
)

stretch_foot_uv = r'''  function hasUsableUvs(geometry) {
    const position = geometry?.getAttribute?.('position');
    const uv = geometry?.getAttribute?.('uv');
    return Boolean(position && uv && uv.count === position.count);
  }

  // Historical name retained for callers, but this is now a true ONE-COPY
  // stretch fit rather than a per-face box projection. The two largest object-
  // space axes span 0..1 exactly once across the whole mesh.
  function generateBoxProjectedUvs(THREE, geometry) {
    const position = geometry?.getAttribute?.('position');
    if (!position?.count) return geometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return geometry;
    const axes = [
      { key: 'x', min: box.min.x, size: Math.max(1e-6, box.max.x - box.min.x) },
      { key: 'y', min: box.min.y, size: Math.max(1e-6, box.max.y - box.min.y) },
      { key: 'z', min: box.min.z, size: Math.max(1e-6, box.max.z - box.min.z) },
    ].sort((a, b) => b.size - a.size);
    const uAxis = axes[0], vAxis = axes[1];
    const read = (axis, i) => axis.key === 'x' ? position.getX(i) : axis.key === 'y' ? position.getY(i) : position.getZ(i);
    const uvArray = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
      uvArray[i * 2] = Math.max(0, Math.min(1, (read(uAxis, i) - uAxis.min) / uAxis.size));
      uvArray[i * 2 + 1] = Math.max(0, Math.min(1, (read(vAxis, i) - vAxis.min) / vAxis.size));
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
    geometry.userData = { ...(geometry.userData || {}), hobunjiStretchFitUvAxes: `${uAxis.key}${vAxis.key}` };
    return geometry;
  }
'''
sub_once(
    feet,
    r"  function hasUsableUvs\(geometry\) \{.*?\n  \}\n\n  function generateBoxProjectedUvs\(THREE, geometry\) \{.*?\n  \}\n\n(?=  // ── Placement width)",
    stretch_foot_uv + "\n",
    re.S,
)

replace_once(
    feet,
    "    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material);\n",
    "    const sphereGeometry = generateBoxProjectedUvs(THREE, new THREE.SphereGeometry(radius, 16, 12));\n    const sphere = new THREE.Mesh(sphereGeometry, material);\n",
)
replace_once(
    feet,
    "      const toeGeometry = new THREE.ConeGeometry(toeRadius, toeLength, 10);\n",
    "      const toeGeometry = generateBoxProjectedUvs(THREE, new THREE.ConeGeometry(toeRadius, toeLength, 10));\n",
)

# Capture each original imported material's actual bland hex before replacement,
# then build its non-body authored PNG through the body-fill path with that hex.
old_material_prep = """    const roles = footConfig.materialRoles || {};\n    const roleTextures = new Map();\n    for (const role of new Set(Object.values(roles))) {\n      roleTextures.set(role, await surfaceForRole(role));\n    }\n    const defaultTexture = await surfaceForRole('body');\n    const remapped = new Map();\n"""
new_material_prep = """    const roles = footConfig.materialRoles || {};\n    const sourceMaterials = new Set();\n    clone.traverse(child => {\n      if (!child.isMesh) return;\n      const materials = Array.isArray(child.material) ? child.material : [child.material];\n      for (const material of materials) if (material) sourceMaterials.add(material);\n    });\n    const textureForMaterial = new Map();\n    for (const material of sourceMaterials) {\n      const role = roles[material.name] || 'body';\n      const originalHex = material.color?.isColor ? `#${material.color.getHexString()}` : null;\n      textureForMaterial.set(material, await surfaceForRole(role, originalHex));\n    }\n    const defaultTexture = await surfaceForRole('body');\n    const remapped = new Map();\n"""
replace_once(feet, old_material_prep, new_material_prep)
replace_once(
    feet,
    "        const role = roles[material.name];\n        const texture = roleTextures.get(role) || defaultTexture;\n",
    "        const role = roles[material.name] || 'body';\n        const originalHex = material.color?.isColor ? `#${material.color.getHexString()}` : null;\n        const texture = textureForMaterial.get(material) || defaultTexture;\n",
)
replace_once(
    feet,
    "        cloned.name = material.name;\n        remapped.set(material, cloned);\n",
    "        cloned.name = material.name;\n        cloned.userData = { ...(cloned.userData || {}), hobunjiFootRole: role, hobunjiOriginalMaterialHex: originalHex };\n        remapped.set(material, cloned);\n",
)

print('patched left hand outline rescan, true stretch-fit UVs, and original-hex foot fill tinting')
