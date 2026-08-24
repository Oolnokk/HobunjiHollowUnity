from pathlib import Path

path = Path('docs/js/procedural-hand-attachments.js')
text = path.read_text()

if 'function ensureHandSurfaceUvs(THREE, geometry)' not in text:
    marker = "  function handSurfaceTexture(THREE, role, speciesId, bodyColors) {\n"
    helper = r'''  function ensureHandSurfaceUvs(THREE, geometry) {
    if (!geometry?.getAttribute) return;
    const position = geometry.getAttribute('position');
    if (!position?.count) return;

    const existingUv = geometry.getAttribute('uv');
    if (existingUv?.count === position.count) {
      // Normalize authored UV islands to exactly 0..1 so canvas.png is stretched
      // once across the available hand UV extent instead of sampling only a sub-rect.
      let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
      for (let i = 0; i < existingUv.count; i++) {
        const u = existingUv.getX(i), v = existingUv.getY(i);
        if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
        minU = Math.min(minU, u); minV = Math.min(minV, v);
        maxU = Math.max(maxU, u); maxV = Math.max(maxV, v);
      }
      const du = maxU - minU, dv = maxV - minV;
      if (Number.isFinite(du) && Number.isFinite(dv) && du > 1e-6 && dv > 1e-6) {
        const normalized = new Float32Array(existingUv.count * 2);
        for (let i = 0; i < existingUv.count; i++) {
          normalized[i * 2] = Math.max(0, Math.min(1, (existingUv.getX(i) - minU) / du));
          normalized[i * 2 + 1] = Math.max(0, Math.min(1, (existingUv.getY(i) - minV) / dv));
        }
        geometry.setAttribute('uv', new THREE.BufferAttribute(normalized, 2));
      }
      return;
    }

    geometry.computeBoundingBox?.();
    const box = geometry.boundingBox;
    if (!box) return;
    const sx = Math.max(1e-6, box.max.x - box.min.x);
    const sy = Math.max(1e-6, box.max.y - box.min.y);
    const sz = Math.max(1e-6, box.max.z - box.min.z);
    const normal = geometry.getAttribute('normal');
    const uvs = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const nx = Math.abs(normal?.getX?.(i) || 0);
      const ny = Math.abs(normal?.getY?.(i) || 0);
      const nz = Math.abs(normal?.getZ?.(i) || 0);
      let u, v;
      if (nx >= ny && nx >= nz) {
        u = (z - box.min.z) / sz;
        v = (y - box.min.y) / sy;
      } else if (ny >= nz) {
        u = (x - box.min.x) / sx;
        v = (z - box.min.z) / sz;
      } else {
        u = (x - box.min.x) / sx;
        v = (y - box.min.y) / sy;
      }
      uvs[i * 2] = Math.max(0, Math.min(1, u));
      uvs[i * 2 + 1] = Math.max(0, Math.min(1, v));
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }

'''
    if marker not in text:
        raise SystemExit('handSurfaceTexture marker missing')
    text = text.replace(marker, helper + marker, 1)

# Make the stretch-to-fit state explicit, including offset, for cached hand textures.
old = "    texture.wrapS = THREE.ClampToEdgeWrapping;\n    texture.wrapT = THREE.ClampToEdgeWrapping;\n    texture.repeat.set(1, 1);\n"
new = "    texture.wrapS = THREE.ClampToEdgeWrapping;\n    texture.wrapT = THREE.ClampToEdgeWrapping;\n    texture.offset.set(0, 0);\n    texture.repeat.set(1, 1);\n"
if old in text and 'texture.offset.set(0, 0);' not in text:
    text = text.replace(old, new, 1)

path.write_text(text)
print('restored ensureHandSurfaceUvs and enforced canvas stretch-to-fit')