// Shared pants-rig math used by the Pants Rig Author and runtime consumers.
(function (global) {
  'use strict';

  const SCHEMA = 'hobunji.pants-rigs.v1'; // Used to reject incompatible authoring exports.
  const WEIGHT_CHANNELS = Object.freeze(['belt', 'leftThigh', 'leftCalf', 'rightThigh', 'rightCalf']); // Used by painting, export, and runtime skinning.

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function clonePoint(input) {
    return { x: clamp(input?.x), y: clamp(input?.y) };
  }

  function normalizeSpline(points, fallback = []) {
    const source = Array.isArray(points) && points.length ? points : fallback;
    return source.slice(0, 5).map(clonePoint);
  }

  function validateFivePointSpline(points) {
    return Array.isArray(points)
      && points.length === 5
      && points.every(point => Number.isFinite(Number(point?.x))
        && Number.isFinite(Number(point?.y))
        && Number(point.x) >= 0 && Number(point.x) <= 1
        && Number(point.y) >= 0 && Number(point.y) <= 1);
  }

  function centroid(points) {
    if (!Array.isArray(points) || !points.length) return { x: 0.5, y: 0.5 };
    const sum = points.reduce((acc, point) => {
      acc.x += Number(point?.x) || 0;
      acc.y += Number(point?.y) || 0;
      return acc;
    }, { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  }

  function scaleSplineAroundCentroid(points, scale) {
    const center = centroid(points);
    const factor = clamp(scale, 0.25, 2.5);
    return normalizeSpline(points).map(point => ({
      x: clamp(center.x + (point.x - center.x) * factor),
      y: clamp(center.y + (point.y - center.y) * factor),
    }));
  }

  function buildLegOpeningFitControls(garment, thickness = 1) {
    const pantsBelt = normalizeSpline(garment?.pantsBeltSpline);
    const leftSource = normalizeSpline(garment?.legOpenings?.left);
    const rightSource = normalizeSpline(garment?.legOpenings?.right);
    const factor = clamp(thickness, 0.25, 2.5);
    const leftTarget = scaleSplineAroundCentroid(leftSource, factor);
    const rightTarget = scaleSplineAroundCentroid(rightSource, factor);
    const source = [];
    const target = [];
    for (let index = 0; index < pantsBelt.length; index++) {
      source.push(pantsBelt[index]);
      target.push({ ...pantsBelt[index] });
    }
    for (const [from, to] of [...leftSource.map((point, index) => [point, leftTarget[index]]), ...rightSource.map((point, index) => [point, rightTarget[index]])]) {
      source.push(from);
      target.push(to);
    }
    return { factor, source, target, leftTarget, rightTarget };
  }

  function inverseDistanceDisplacement(point, source, target, power = 2, epsilon = 0.00004) {
    if (!Array.isArray(source) || !Array.isArray(target) || source.length !== target.length || !source.length) {
      return { x: 0, y: 0 };
    }
    let totalWeight = 0;
    let dx = 0;
    let dy = 0;
    for (let index = 0; index < source.length; index++) {
      const from = source[index];
      const to = target[index];
      const sx = Number(from?.x) || 0;
      const sy = Number(from?.y) || 0;
      const qx = Number(to?.x) || 0;
      const qy = Number(to?.y) || 0;
      const distanceSquared = (point.x - sx) ** 2 + (point.y - sy) ** 2;
      const weight = 1 / Math.pow(Math.max(epsilon, distanceSquared), power * 0.5);
      totalWeight += weight;
      dx += (qx - sx) * weight;
      dy += (qy - sy) * weight;
    }
    return totalWeight > 0 ? { x: dx / totalWeight, y: dy / totalWeight } : { x: 0, y: 0 };
  }

  function warpRgbaNearest(sourcePixels, width, height, sourceControls, targetControls) {
    const safeWidth = Math.max(1, Math.round(Number(width) || 1));
    const safeHeight = Math.max(1, Math.round(Number(height) || 1));
    const input = sourcePixels instanceof Uint8ClampedArray ? sourcePixels : new Uint8ClampedArray(sourcePixels || []);
    const expected = safeWidth * safeHeight * 4;
    if (input.length !== expected) throw new Error(`RGBA source length ${input.length} does not match ${safeWidth}×${safeHeight}.`);
    const output = new Uint8ClampedArray(expected);
    for (let y = 0; y < safeHeight; y++) {
      const ny = safeHeight > 1 ? y / (safeHeight - 1) : 0;
      for (let x = 0; x < safeWidth; x++) {
        const nx = safeWidth > 1 ? x / (safeWidth - 1) : 0;
        const displacement = inverseDistanceDisplacement({ x: nx, y: ny }, targetControls, sourceControls, 2);
        const sx = Math.max(0, Math.min(safeWidth - 1, Math.round((nx + displacement.x) * (safeWidth - 1))));
        const sy = Math.max(0, Math.min(safeHeight - 1, Math.round((ny + displacement.y) * (safeHeight - 1))));
        const sourceOffset = (sy * safeWidth + sx) * 4;
        const targetOffset = (y * safeWidth + x) * 4;
        output[targetOffset] = input[sourceOffset];
        output[targetOffset + 1] = input[sourceOffset + 1];
        output[targetOffset + 2] = input[sourceOffset + 2];
        output[targetOffset + 3] = input[sourceOffset + 3];
      }
    }
    return output;
  }

  function solve3x3(matrix, vector) {
    const a = matrix.map(row => row.slice());
    const b = vector.slice();
    for (let pivot = 0; pivot < 3; pivot++) {
      let best = pivot;
      for (let row = pivot + 1; row < 3; row++) {
        if (Math.abs(a[row][pivot]) > Math.abs(a[best][pivot])) best = row;
      }
      if (Math.abs(a[best][pivot]) < 1e-9) return null;
      [a[pivot], a[best]] = [a[best], a[pivot]];
      [b[pivot], b[best]] = [b[best], b[pivot]];
      const divisor = a[pivot][pivot];
      for (let col = pivot; col < 3; col++) a[pivot][col] /= divisor;
      b[pivot] /= divisor;
      for (let row = 0; row < 3; row++) {
        if (row === pivot) continue;
        const factor = a[row][pivot];
        for (let col = pivot; col < 3; col++) a[row][col] -= factor * a[pivot][col];
        b[row] -= factor * b[pivot];
      }
    }
    return b;
  }

  function solveBeltSimilarity(sourcePoints, targetPoints) {
    if (!validateFivePointSpline(sourcePoints) || !validateFivePointSpline(targetPoints)) return null;
    const sourceCenter = centroid(sourcePoints);
    const targetCenter = centroid(targetPoints);
    let dot = 0;
    let cross = 0;
    let sourceEnergy = 0;
    for (let index = 0; index < sourcePoints.length; index++) {
      const sx = sourcePoints[index].x - sourceCenter.x;
      const sy = sourcePoints[index].y - sourceCenter.y;
      const tx = targetPoints[index].x - targetCenter.x;
      const ty = targetPoints[index].y - targetCenter.y;
      dot += sx * tx + sy * ty;
      cross += sx * ty - sy * tx;
      sourceEnergy += sx * sx + sy * sy;
    }
    if (sourceEnergy < 1e-9) return null;
    const a = dot / sourceEnergy;
    const b = cross / sourceEnergy;
    return {
      a,
      c: -b,
      b,
      d: a,
      tx: targetCenter.x - a * sourceCenter.x + b * sourceCenter.y,
      ty: targetCenter.y - b * sourceCenter.x - a * sourceCenter.y,
      kind: 'similarity',
    };
  }

  function solveAffine(sourcePoints, targetPoints) {
    if (!validateFivePointSpline(sourcePoints) || !validateFivePointSpline(targetPoints)) return null;
    const normal = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const bx = [0, 0, 0];
    const by = [0, 0, 0];
    for (let index = 0; index < sourcePoints.length; index++) {
      const source = sourcePoints[index];
      const target = targetPoints[index];
      const row = [source.x, source.y, 1];
      for (let r = 0; r < 3; r++) {
        bx[r] += row[r] * target.x;
        by[r] += row[r] * target.y;
        for (let c = 0; c < 3; c++) normal[r][c] += row[r] * row[c];
      }
    }
    const xCoefficients = solve3x3(normal, bx);
    const yCoefficients = solve3x3(normal, by);
    if (!xCoefficients || !yCoefficients) return solveBeltSimilarity(sourcePoints, targetPoints);
    return {
      a: xCoefficients[0], c: xCoefficients[1], tx: xCoefficients[2],
      b: yCoefficients[0], d: yCoefficients[1], ty: yCoefficients[2],
      kind: 'affine',
    };
  }

  function applyAffine(transform, point) {
    if (!transform) return clonePoint(point);
    const x = Number(point?.x) || 0;
    const y = Number(point?.y) || 0;
    return {
      x: transform.a * x + transform.c * y + transform.tx,
      y: transform.b * x + transform.d * y + transform.ty,
    };
  }

  function encodeWeightGridRle(grid) {
    const width = Math.max(1, Math.round(Number(grid?.width) || 64));
    const height = Math.max(1, Math.round(Number(grid?.height) || 64));
    const channels = Array.isArray(grid?.channels) && grid.channels.length ? [...grid.channels] : [...WEIGHT_CHANNELS];
    const data = grid?.data instanceof Uint8Array ? grid.data : Uint8Array.from(grid?.data || []);
    const expected = width * height * channels.length;
    const safeData = data.length === expected ? data : new Uint8Array(expected);
    const encoded = {};
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      const runs = [];
      let previous = safeData[channelIndex] || 0;
      let count = 0;
      for (let cell = 0; cell < width * height; cell++) {
        const value = safeData[cell * channels.length + channelIndex] || 0;
        if (value === previous && count < 65535) {
          count++;
        } else {
          runs.push(previous, count);
          previous = value;
          count = 1;
        }
      }
      if (count) runs.push(previous, count);
      encoded[channels[channelIndex]] = runs;
    }
    return { width, height, channels, encoding: 'rle8', data: encoded };
  }

  function decodeWeightGridRle(record) {
    const width = Math.max(1, Math.round(Number(record?.width) || 64));
    const height = Math.max(1, Math.round(Number(record?.height) || 64));
    const channels = Array.isArray(record?.channels) && record.channels.length ? [...record.channels] : [...WEIGHT_CHANNELS];
    const output = new Uint8Array(width * height * channels.length);
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      const runs = Array.isArray(record?.data?.[channels[channelIndex]]) ? record.data[channels[channelIndex]] : [];
      let cell = 0;
      for (let runIndex = 0; runIndex + 1 < runs.length && cell < width * height; runIndex += 2) {
        const value = Math.max(0, Math.min(255, Math.round(Number(runs[runIndex]) || 0)));
        const count = Math.max(0, Math.round(Number(runs[runIndex + 1]) || 0));
        for (let repeat = 0; repeat < count && cell < width * height; repeat++, cell++) {
          output[cell * channels.length + channelIndex] = value;
        }
      }
    }
    return { width, height, channels, data: output };
  }

  function normalizeWeightCell(data, offset, channelCount, preferredChannel = 0) {
    let sum = 0;
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) sum += data[offset + channelIndex] || 0;
    if (sum <= 0) {
      data[offset + Math.max(0, Math.min(channelCount - 1, preferredChannel))] = 255;
      return;
    }
    let assigned = 0;
    let dominant = 0; // Rounding leftover goes to the strongest channel; dumping it on the last channel left stray 1-2 weights on every cell.
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
      const next = Math.max(0, Math.min(255, Math.round((data[offset + channelIndex] || 0) * 255 / sum)));
      data[offset + channelIndex] = next;
      assigned += next;
      if (next > data[offset + dominant]) dominant = channelIndex;
    }
    data[offset + dominant] = Math.max(0, Math.min(255, data[offset + dominant] + 255 - assigned));
  }

  // Takes `amount` (0..1) of a cell's `selected` channel away. The freed weight goes to the belt (so an erased bone patch
  // goes back to following the body); erasing the belt itself hands it to the other channels in proportion.
  function eraseWeightCell(data, offset, channelCount, selected, amount) {
    const current = data[offset + selected] || 0;
    const removed = Math.min(current, Math.round(current * Math.max(0, Math.min(1, amount))));
    if (!removed) return;
    if (selected !== 0) {
      data[offset + selected] = current - removed;
      data[offset] = Math.min(255, (data[offset] || 0) + removed);
      return;
    }
    let others = 0;
    for (let channelIndex = 1; channelIndex < channelCount; channelIndex++) others += data[offset + channelIndex] || 0;
    if (!others) return; // Nothing to hand the weight to: a pure-belt cell stays pure belt.
    data[offset] = current - removed;
    for (let channelIndex = 1; channelIndex < channelCount; channelIndex++) data[offset + channelIndex] += Math.round(removed * (data[offset + channelIndex] || 0) / others);
    normalizeWeightCell(data, offset, channelCount, 0);
  }

  // After rescaling, rounding can leave a cell off 255 by a point or two. Put it on the strongest channel that is NOT the
  // freshly mirrored one, so the mirrored paint stays exact.
  function settleRounding(data, offset, channelCount, keep) {
    let sum = 0, target = -1;
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
      sum += data[offset + channelIndex];
      if (channelIndex !== keep && (target < 0 || data[offset + channelIndex] > data[offset + target])) target = channelIndex;
    }
    if (sum !== 255 && target >= 0) data[offset + target] = Math.max(0, Math.min(255, data[offset + target] + 255 - sum));
  }

  // Copies `source` onto `dest` mirrored left<->right about the image centre, in place. `region` limits which destination
  // columns are overwritten: 'all', 'left' (columns on the left half) or 'right'. Every overwritten cell still sums to 255:
  // the other leg channels keep their paint (scaled down only if they no longer fit) and the belt takes up the slack, or,
  // when `dest` is the belt itself, the leg channels are scaled to fill what the belt leaves.
  function reflectWeightChannel(grid, source, dest, region = 'all') {
    const { width, height, data } = grid;
    const channelCount = grid.channels.length;
    const from = new Uint8Array(data); // Reads come from a snapshot, so the overwrite never feeds back into itself.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (region === 'left' && x >= width / 2) continue;
        if (region === 'right' && x < width / 2) continue;
        const offset = (y * width + x) * channelCount;
        const mirrored = from[(y * width + (width - 1 - x)) * channelCount + source];
        data[offset + dest] = mirrored;
        if (dest === 0) {
          let legs = 0;
          for (let channelIndex = 1; channelIndex < channelCount; channelIndex++) legs += data[offset + channelIndex];
          if (!legs) { // Nothing to rescale here: the freed weight goes to the mirrored cell's legs, swapped left<->right.
            const mirrorOffset = (y * width + (width - 1 - x)) * channelCount;
            for (let channelIndex = 1; channelIndex < channelCount; channelIndex++) data[offset + channelIndex] = from[mirrorOffset + (channelIndex <= 2 ? channelIndex + 2 : channelIndex - 2)] || 0;
            legs = 0;
            for (let channelIndex = 1; channelIndex < channelCount; channelIndex++) legs += data[offset + channelIndex];
            if (!legs) { data[offset] = 255; continue; }
          }
          const room = 255 - mirrored;
          for (let channelIndex = 1; channelIndex < channelCount; channelIndex++) data[offset + channelIndex] = Math.round(data[offset + channelIndex] * room / legs);
          settleRounding(data, offset, channelCount, 0);
        } else {
          let others = 0;
          for (let channelIndex = 1; channelIndex < channelCount; channelIndex++) if (channelIndex !== dest) others += data[offset + channelIndex];
          const room = 255 - mirrored;
          if (others > room) {
            for (let channelIndex = 1; channelIndex < channelCount; channelIndex++) if (channelIndex !== dest) data[offset + channelIndex] = Math.round(data[offset + channelIndex] * room / others);
            others = room;
          }
          data[offset] = Math.max(0, 255 - mirrored - others);
          settleRounding(data, offset, channelCount, dest);
        }
      }
    }
    return grid;
  }

  function sampleWeights(record, u, v) {
    const grid = record?.encoding === 'rle8' ? decodeWeightGridRle(record) : record;
    if (!grid?.data || !grid.width || !grid.height || !grid.channels?.length) {
      return Object.fromEntries(WEIGHT_CHANNELS.map((channel, index) => [channel, index === 0 ? 1 : 0]));
    }
    const channels = grid.channels;
    const x = clamp(u) * Math.max(0, grid.width - 1);
    const y = clamp(v) * Math.max(0, grid.height - 1);
    const x0 = Math.floor(x), x1 = Math.min(grid.width - 1, x0 + 1);
    const y0 = Math.floor(y), y1 = Math.min(grid.height - 1, y0 + 1);
    const tx = x - x0, ty = y - y0;
    const result = {};
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      const at = (px, py) => grid.data[(py * grid.width + px) * channels.length + channelIndex] / 255;
      const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
      const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
      result[channels[channelIndex]] = top * (1 - ty) + bottom * ty;
    }
    return result;
  }

  // ---- Leg bones: exact-midpoint knee, 2D->3D bone alignment, weighted skinning -------------------------------------
  // A leg is two separate bones: thigh (hip -> knee) and calf (knee -> ankle). The knee is not authored independently:
  // it is the exact midpoint of hip and ankle, which is also where the 3D solver (docs/js/leg-bones.js) puts the
  // knee of an unbent leg (thighLength is exactly half the hip-to-foot distance).
  function kneeAtMidpoint(hip, ankle) {
    return { x: ((Number(hip?.x) || 0) + (Number(ankle?.x) || 0)) / 2, y: ((Number(hip?.y) || 0) + (Number(ankle?.y) || 0)) / 2 };
  }

  function normalizeLegBones(legBones) { // Returns a copy whose knees are the exact midpoint of hip and ankle.
    const result = {};
    for (const side of ['left', 'right']) {
      const hip = clonePoint(legBones?.[side]?.hip);
      const ankle = clonePoint(legBones?.[side]?.ankle);
      result[side] = { hip, knee: kneeAtMidpoint(hip, ankle), ankle };
    }
    return result;
  }

  const MIN_BONE_LENGTH = 1e-6;
  const MAX_STRETCH = 12; // A foot target that pops a long way away must not blow the garment up.
  const MIN_STRETCH = 0.08;

  // 2D transform that carries the 2D bone (fromStart -> fromEnd) onto the 3D bone (toStart -> toEnd): rotate to the
  // new direction, stretch ALONG the bone so its length matches, and scale across it by `perpendicularScale`:
  // a number (1 keeps the authored leg thickness) or 'balanced' (sqrt of the stretch: halfway between stretching only
  // and scaling uniformly, so a leg stretched 4x gets 2x wider and keeps believable proportions whatever the species'
  // leg length). Same {a,b,c,d,tx,ty} layout as solveAffine/applyAffine:
  //   x' = a x + c y + tx,  y' = b x + d y + ty.
  function alignBoneSegment(fromStart, fromEnd, toStart, toEnd, { perpendicularScale = 1 } = {}) {
    const fx = Number(fromStart?.x) || 0, fy = Number(fromStart?.y) || 0;
    const tx0 = Number(toStart?.x) || 0, ty0 = Number(toStart?.y) || 0;
    const dx2 = (Number(fromEnd?.x) || 0) - fx, dy2 = (Number(fromEnd?.y) || 0) - fy;
    const dx3 = (Number(toEnd?.x) || 0) - tx0, dy3 = (Number(toEnd?.y) || 0) - ty0;
    const length2 = Math.hypot(dx2, dy2);
    const length3 = Math.hypot(dx3, dy3);
    if (length2 < MIN_BONE_LENGTH || length3 < MIN_BONE_LENGTH) { // Degenerate bone: follow the joint, keep the shape.
      return { a: 1, b: 0, c: 0, d: 1, tx: tx0 - fx, ty: ty0 - fy, stretch: 1, rotation: 0 };
    }
    const ux = dx2 / length2, uy = dy2 / length2; // Unit 2D bone direction.
    const stretch = Math.max(MIN_STRETCH, Math.min(MAX_STRETCH, length3 / length2));
    const across = perpendicularScale === 'balanced'
      ? Math.sqrt(stretch)
      : (Number.isFinite(perpendicularScale) && perpendicularScale > 0 ? perpendicularScale : 1);
    // S = across * I + (stretch - across) * u u^T
    const k = stretch - across;
    const s00 = across + k * ux * ux, s01 = k * ux * uy, s10 = s01, s11 = across + k * uy * uy;
    const rotation = Math.atan2(dy3, dx3) - Math.atan2(dy2, dx2);
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const a = cos * s00 - sin * s10, c = cos * s01 - sin * s11; // A = R * S
    const b = sin * s00 + cos * s10, d = sin * s01 + cos * s11;
    return { a, b, c, d, tx: tx0 - (a * fx + c * fy), ty: ty0 - (b * fx + d * fy), stretch, rotation };
  }

  // Linear-blend skinning of a flat vertex array in place. base/out: Float32Array xyz triples. weights:
  // Float32Array of `channelCount` normalized weights per vertex, in WEIGHT_CHANNELS order. transforms: one entry per
  // channel, an {a,b,c,d,tx,ty} affine or null for "stays rigid" (the belt). Depth (z) is carried through unchanged so
  // the garment keeps its place in front of the portrait plane.
  function skinWeightedPositions(base, weights, transforms, out, channelCount = WEIGHT_CHANNELS.length) {
    const vertexCount = Math.floor(base.length / 3);
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const x = base[vertex * 3], y = base[vertex * 3 + 1];
      let ox = 0, oy = 0;
      for (let channel = 0; channel < channelCount; channel++) {
        const weight = weights[vertex * channelCount + channel];
        if (!(weight > 0)) continue;
        const transform = transforms[channel];
        if (transform) {
          ox += weight * (transform.a * x + transform.c * y + transform.tx);
          oy += weight * (transform.b * x + transform.d * y + transform.ty);
        } else {
          ox += weight * x;
          oy += weight * y;
        }
      }
      out[vertex * 3] = ox;
      out[vertex * 3 + 1] = oy;
      out[vertex * 3 + 2] = base[vertex * 3 + 2];
    }
    return out;
  }

  function validateProject(project) {
    const errors = [];
    if (!project || project.schema !== SCHEMA) errors.push(`schema must be ${SCHEMA}`);
    for (const [garmentId, garment] of Object.entries(project?.garments || {})) {
      if (!validateFivePointSpline(garment?.pantsBeltSpline)) errors.push(`${garmentId}: pants beltline needs exactly 5 normalized points`);
      if (!validateFivePointSpline(garment?.legOpenings?.left)) errors.push(`${garmentId}: left leg opening needs exactly 5 normalized points`);
      if (!validateFivePointSpline(garment?.legOpenings?.right)) errors.push(`${garmentId}: right leg opening needs exactly 5 normalized points`);
      for (const side of ['left', 'right']) {
        const bone = garment?.legBones?.[side];
        for (const joint of ['hip', 'knee', 'ankle']) {
          if (!Number.isFinite(Number(bone?.[joint]?.x)) || !Number.isFinite(Number(bone?.[joint]?.y))) {
            errors.push(`${garmentId}: ${side} ${joint} is missing`);
          }
        }
      }
    }
    for (const [characterKey, character] of Object.entries(project?.characters || {})) {
      if (!validateFivePointSpline(character?.portraitBeltSpline)) errors.push(`${characterKey}: portrait beltline needs exactly 5 normalized points`);
      if (!(Number(character?.legThickness) > 0)) errors.push(`${characterKey}: legThickness must be > 0`);
    }
    return { ok: errors.length === 0, errors };
  }

  global.HobunjiPantsRig = Object.freeze({
    SCHEMA,
    WEIGHT_CHANNELS,
    clamp,
    clonePoint,
    normalizeSpline,
    validateFivePointSpline,
    centroid,
    scaleSplineAroundCentroid,
    buildLegOpeningFitControls,
    inverseDistanceDisplacement,
    warpRgbaNearest,
    solveBeltSimilarity,
    solveAffine,
    applyAffine,
    encodeWeightGridRle,
    decodeWeightGridRle,
    normalizeWeightCell,
    eraseWeightCell,
    reflectWeightChannel,
    sampleWeights,
    kneeAtMidpoint,
    normalizeLegBones,
    alignBoneSegment,
    skinWeightedPositions,
    validateProject,
  });
})(typeof window !== 'undefined' ? window : globalThis);
