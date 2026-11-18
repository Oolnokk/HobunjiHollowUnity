// One-shot corpse-only pants rasterization. The source garment is authored in a
// jumping-jack pose: copy its FINAL skinned vertices, not its source PNG shape.
// Never changes the living character budgets, source rigs, or texture artwork.
(() => {
  'use strict';

  const CAPTURE_TRIANGLE_FRACTION = 0.20; // Controls how many posed triangles are sampled into a corpse-only texture.
  const diagnostics = { captured: 0, skipped: 0, triangles: 0, last: null }; // Read by the mobile Pixel Probe and corpse retirement debug.

  function portraitMeshFor(rig) {
    let chosen = null; // The visible front portrait defines how the cloth projects into its static canvas.
    rig?.frontPlane?.traverse?.(node => {
      if (chosen || !node?.isMesh || node.userData?.hobunjiPantsGarment) return;
      const face = String(node.userData?.hobunjiPlaneFace || '').toLowerCase();
      const name = String(node.name || '').toLowerCase();
      if (face === 'front' || /front.*plane|plane.*front/.test(name)) chosen = node;
    });
    return chosen;
  }

  function triangle(ctx, source, points, uvs, indices) {
    const [a, b, c] = indices;
    const p = points[a], q = points[b], r = points[c];
    const u = uvs[a], v = uvs[b], w = uvs[c];
    if (!p || !q || !r || !u || !v || !w) return false;
    const imageWidth = Number(source.naturalWidth || source.width);
    const imageHeight = Number(source.naturalHeight || source.height);
    if (!(imageWidth > 0 && imageHeight > 0)) return false;
    const s0 = u.x * imageWidth, t0 = (1 - u.y) * imageHeight;
    const s1 = v.x * imageWidth, t1 = (1 - v.y) * imageHeight;
    const s2 = w.x * imageWidth, t2 = (1 - w.y) * imageHeight;
    const denominator = s0 * (t1 - t2) + s1 * (t2 - t0) + s2 * (t0 - t1);
    const destArea = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    if (!Number.isFinite(denominator) || !Number.isFinite(destArea) || Math.abs(denominator) < 1e-7 || Math.abs(destArea) < 1e-5) return false;

    const m00 = (p.x * (t1 - t2) + q.x * (t2 - t0) + r.x * (t0 - t1)) / denominator;
    const m10 = (p.y * (t1 - t2) + q.y * (t2 - t0) + r.y * (t0 - t1)) / denominator;
    const m01 = (p.x * (s2 - s1) + q.x * (s0 - s2) + r.x * (s1 - s0)) / denominator;
    const m11 = (p.y * (s2 - s1) + q.y * (s0 - s2) + r.y * (s1 - s0)) / denominator;
    const tx = p.x - m00 * s0 - m01 * t0, ty = p.y - m10 * s0 - m11 * t0;
    if (![m00, m10, m01, m11, tx, ty].every(Number.isFinite)) return false;
    ctx.save();
    try {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.lineTo(r.x, r.y);
      ctx.closePath();
      ctx.clip();
      ctx.transform(m00, m10, m01, m11, tx, ty);
      ctx.drawImage(source, 0, 0);
      return true;
    } finally {
      ctx.restore();
    }
  }

  // One garment's original grid is already posed at death. Sample a smaller,
  // split-in-two grid so the right leg still paints over the left when crossing.
  function rasterize(ctx, source, points, uv, segments) {
    const reduced = Math.max(2, Math.min(segments, 2 * Math.floor(segments * Math.sqrt(CAPTURE_TRIANGLE_FRACTION) / 2)));
    const target = Math.max(2, reduced - (reduced % 2)); // Even width keeps the authored left/right overlap seam intact.
    const stride = segments + 1; // Maps the reduced sample positions to the ORIGINAL skinned garment grid.
    const sampleRow = row => Math.round(row * segments / target);
    const sampleCol = col => Math.round(col * segments / target);
    const at = (row, col) => sampleRow(row) * stride + sampleCol(col);
    let triangles = 0; // One-time diagnostic count of actual canvas-mapped triangles.
    for (const [start, end] of [[0, target / 2], [target / 2, target]]) {
      for (let row = 0; row < target; row++) {
        for (let col = start; col < end; col++) {
          const a = at(row, col), b = at(row, col + 1), c = at(row + 1, col), d = at(row + 1, col + 1);
          if (triangle(ctx, source, points, uv, [a, c, b])) triangles++;
          if (triangle(ctx, source, points, uv, [b, c, d])) triangles++;
        }
      }
    }
    return { triangles, segments: target, originalTriangles: segments * segments * 2 };
  }

  function capture(destination, rig) {
    const THREE = window.THREE;
    const pants = rig?.legs?.pants; // The existing attachToLegs integration owns the actual cloth handle.
    const mesh = pants?.mesh;
    const portrait = portraitMeshFor(rig);
    const image = pants?.texture?.image || pants?.material?.map?.image;
    const geometry = pants?.geometry;
    const positions = geometry?.getAttribute?.('position');
    const uvAttribute = geometry?.getAttribute?.('uv');
    const width = Number(destination?.width), height = Number(destination?.height);
    const segments = Number(pants?.segments);
    if (!pants || pants.disposed || !pants.ready || !mesh || !portrait || !image || !positions?.array || !uvAttribute?.array
      || !Number.isInteger(segments) || segments < 4 || !(width > 0 && height > 0)
      || !THREE?.Vector3 || !THREE?.Matrix4 || typeof document === 'undefined') {
      diagnostics.skipped++;
      diagnostics.last = 'no-ready-posed-pants';
      return { ok: false, reason: 'no-ready-posed-pants' };
    }

    const imageWidth = Number(image.naturalWidth || image.width), imageHeight = Number(image.naturalHeight || image.height);
    if (!(imageWidth > 0 && imageHeight > 0)) return { ok: false, reason: 'pants-texture-not-ready' };
    const originalGpu = pants.gpuSkinOption; // Restored after capture so the helper never changes a surviving rig.
    const originalDirty = pants.dirty; // Restored after capture when a caller retains the handle.
    let result = { ok: false, reason: 'pose-unavailable' };
    try {
      // The live garment usually skins in its vertex shader. On a settled
      // corpse only, ask the SAME existing update to write its CPU-equivalent
      // skinned positions, including cuff-ring and spine corrections.
      pants.gpuSkinOption = false;
      pants.dirty = true;
      pants.update(true);
      if (pants.gpuSkinActive) return result;
      mesh.updateWorldMatrix?.(true, false);
      portrait.updateWorldMatrix?.(true, false);
      if (!mesh.matrixWorld || !portrait.matrixWorld) return result;
      const toPortrait = new THREE.Matrix4().copy(portrait.matrixWorld).invert().multiply(mesh.matrixWorld); // Mesh-local to visible portrait-local coordinates.
      const modelWidth = Number(rig.modelWidth) || Number(portrait.geometry?.parameters?.width) || 1; // Original model width that the portrait canvas covers.
      const modelHeight = Number(rig.modelHeight) || Number(portrait.geometry?.parameters?.height) || modelWidth; // Original model height for vertical projection.
      if (!(modelWidth > 0 && modelHeight > 0)) return result;
      const point = new THREE.Vector3(); // Reused projection vector; no per-triangle Three allocations.
      const flipped = window.PNGPlaneAvatar?.getPortraitsFlipped?.() === true; // Match the live character texture's optional X mirror.
      const transformed = []; // Indexed projected vertex points for the compact capture grid.
      const uvs = []; // Indexed UVs remain authored jumping-jack art coordinates, while positions are final posed coordinates.
      const xyz = positions.array, uv = uvAttribute.array;
      for (let i = 0; i < xyz.length / 3; i++) {
        point.set(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]).applyMatrix4(toPortrait);
        // Capture into the ORIGINAL portrait canvas coordinates. The corpse plane
        // mirrors the finished texture only at render time, just like live PNGPlaneAvatar.
        transformed.push({ x: width * (0.5 + (flipped ? -point.x : point.x) / modelWidth), y: height * (0.5 - point.y / modelHeight) });
        uvs.push({ x: uv[i * 2], y: uv[i * 2 + 1] });
      }
      const layer = document.createElement('canvas'); // Isolates the garment until every triangle has painted successfully.
      layer.width = width; layer.height = height;
      const ctx = layer.getContext('2d');
      const dest = destination.getContext?.('2d');
      if (!ctx || !dest || !ctx.save || !ctx.transform || !ctx.clip || !ctx.drawImage) return result;
      const count = rasterize(ctx, image, transformed, uvs, segments);
      if (!count.triangles) return result;
      const overpassMask = pants.maskTexture?.image; // The same authored torso/arms/hood mask used by the live pants fragment shader.
      if (overpassMask && typeof ctx.globalCompositeOperation === 'string') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(overpassMask, 0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      }
      dest.drawImage(layer, 0, 0);
      result = { ok: true, ...count };
      diagnostics.captured++;
      diagnostics.triangles += count.triangles;
      diagnostics.last = result;
      return result;
    } catch (error) {
      diagnostics.skipped++;
      diagnostics.last = String(error?.message || error).slice(0, 180);
      return { ok: false, reason: diagnostics.last };
    } finally {
      pants.gpuSkinOption = originalGpu;
      pants.dirty = true;
      try { pants.update(true); } catch (_) { pants.dirty = originalDirty; } // A failed capture must not strand a surviving corpse in CPU mode.
    }
  }

  window.CorpsePosedPantsSnapshot = Object.freeze({
    capture, rasterize,
    debug: () => ({ ...diagnostics }),
  });
})();
