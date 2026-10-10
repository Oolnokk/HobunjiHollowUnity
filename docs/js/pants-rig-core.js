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

  const MIN_VERTICAL_SCALE_RATIO = 0.7; // Vertical scale of the belt fit relative to its horizontal scale.
  const MAX_VERTICAL_SCALE_RATIO = 1.5;

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
    let a = xCoefficients[0], c = xCoefficients[1], tx = xCoefficients[2];
    let b = yCoefficients[0], d = yCoefficients[1], ty = yCoefficients[2];
    // Five nearly-straight belt points barely constrain the vertical axis: the least-squares fit then reads a tiny
    // difference in belt curvature as a huge vertical scale, collapsing (or exploding) everything below the belt. Keep the
    // vertical scale within a sane band of the horizontal scale, re-anchored so the belt's centre stays put.
    const scaleX = Math.hypot(a, b);
    let scaleY = Math.hypot(c, d);
    if (scaleX > 1e-9) {
      let rebuilt = false;
      if (scaleY < 1e-9) { c = -b; d = a; scaleY = scaleX; rebuilt = true; } // Fully collapsed vertically: fall back to a uniform (similarity) vertical axis.
      const clampedY = Math.max(MIN_VERTICAL_SCALE_RATIO * scaleX, Math.min(MAX_VERTICAL_SCALE_RATIO * scaleX, scaleY));
      if (clampedY !== scaleY || rebuilt) {
        const k = clampedY / scaleY;
        const sourceCenter = sourcePoints.reduce((sum, point) => ({ x: sum.x + point.x / sourcePoints.length, y: sum.y + point.y / sourcePoints.length }), { x: 0, y: 0 });
        const targetCenter = targetPoints.reduce((sum, point) => ({ x: sum.x + point.x / targetPoints.length, y: sum.y + point.y / targetPoints.length }), { x: 0, y: 0 });
        c *= k; d *= k;
        tx = targetCenter.x - (a * sourceCenter.x + c * sourceCenter.y);
        ty = targetCenter.y - (b * sourceCenter.x + d * sourceCenter.y);
      }
    }
    return { a, c, tx, b, d, ty, kind: 'affine' };
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

  // Portrait-canvas (0..1, y down) <-> avatar-local mapping of the portrait plane, from the avatar-local positions of three
  // canvas corners: origin (0,0), x-end (1,0), y-end (0,1). Returns {ox, oy, inv:[a,b,c,d]} where canvas = inv * (local - origin).
  function portraitMapping(origin, xEnd, yEnd) {
    const m00 = xEnd.x - origin.x, m01 = yEnd.x - origin.x, m10 = xEnd.y - origin.y, m11 = yEnd.y - origin.y;
    const det = m00 * m11 - m01 * m10 || 1e-9;
    return { ox: origin.x, oy: origin.y, inv: [m11 / det, -m01 / det, -m10 / det, m00 / det] };
  }
  function portraitPointForLocal(mapping, x, y) {
    const dx = x - mapping.ox, dy = y - mapping.oy;
    return { x: mapping.inv[0] * dx + mapping.inv[1] * dy, y: mapping.inv[2] * dx + mapping.inv[3] * dy };
  }
  // The default portrait beltline for a species whose beltline has not been authored: a level line at the species'
  // posterior (hip pivot) height, given as a portrait y (0..1). Below the bottom of the image it rests on the image edge.
  // It has the same curve as the garment's own belt (its y offsets from the centre point), so the garment maps onto the
  // portrait at natural scale instead of being squashed by a curvature mismatch.
  const DEFAULT_BELT_SHAPE = [0.015, 0.005, 0, 0.005, 0.015]; // y offsets of the default garment's belt points from its centre point.
  function defaultBeltAtPosterior(portraitY, shape = DEFAULT_BELT_SHAPE) {
    const room = Math.max(...shape);
    const y = clamp(Number.isFinite(portraitY) ? portraitY : 0.86, 0.05, 1 - room);
    return [0.34, 0.42, 0.5, 0.58, 0.66].map((x, index) => ({ x, y: clamp(y + (Number(shape[index]) || 0), 0, 1) }));
  }

  // Hardens painted weights so a vertex mostly follows its dominant bone: each weight is raised to `power` and the cell is
  // renormalized (power 1 = as painted). Smooth auto-seeded/painted gradients leave vertices ON a leg bone only ~50%
  // bone-weighted, which dilutes the garment's initial 2D->3D rotation so the leg openings do not end up centered on
  // the 3D bone; sharpening makes that alignment dominate. In place; `weights` is `channelCount` floats per vertex.
  function sharpenWeights(weights, power, channelCount = WEIGHT_CHANNELS.length) {
    const p = Number.isFinite(power) && power > 1 ? power : 1;
    if (p === 1) return weights;
    const vertexCount = Math.floor(weights.length / channelCount);
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const base = vertex * channelCount;
      let sum = 0;
      for (let channel = 0; channel < channelCount; channel++) { const value = Math.pow(Math.max(0, weights[base + channel]), p); weights[base + channel] = value; sum += value; }
      if (!(sum > 0)) { weights[base] = 1; continue; }
      for (let channel = 0; channel < channelCount; channel++) weights[base + channel] /= sum;
    }
    return weights;
  }

  // Exaggerates how far a live 3D leg splays sideways (the swing you see face-on) so the garment's legs visibly follow it,
  // WITHOUT touching its pitch (forward/back tilt about x). Each bone is split into a lateral angle (how far it leans out
  // of the yz plane) and a direction within the yz plane (its pitch); only the lateral angle is multiplied by `gain`, so
  // the pitch ratio vz:vy and the bone length are exactly the live bone's. The chain is re-hung hip first, so thigh and
  // calf still share one knee. gain 1 returns the live bones exactly. `out` ({hip, knee, ankle} of {x,y,z}) is written in place.
  function amplifyLegRoll(leg, gain, out) {
    const g = Number.isFinite(gain) && gain > 0 ? gain : 1;
    out.hip.x = leg.hip.x; out.hip.y = leg.hip.y; out.hip.z = leg.hip.z;
    let ax = out.hip.x, ay = out.hip.y, az = out.hip.z;
    const limit = Math.PI / 2 - 0.05; // Never amplify a leg all the way out of its pitch plane.
    const joints = [['knee', leg.hip, leg.knee], ['ankle', leg.knee, leg.ankle]];
    for (const [name, from, to] of joints) {
      const vx = to.x - from.x, vy = to.y - from.y, vz = to.z - from.z;
      const length = Math.hypot(vx, vy, vz);
      const inPlane = Math.hypot(vy, vz); // Length of the bone's projection onto its pitch plane (yz).
      if (length > 1e-9 && inPlane > 1e-9) {
        const lateral = Math.atan2(vx, inPlane); // Signed angle out of the yz plane.
        const amplified = Math.max(-limit, Math.min(limit, g * lateral));
        const along = length * Math.cos(amplified) / inPlane; // Scales (vy, vz) so pitch is unchanged.
        ax += length * Math.sin(amplified); ay += vy * along; az += vz * along;
      } else {
        ax += vx; ay += vy; az += vz;
      }
      out[name].x = ax; out[name].y = ay; out[name].z = az;
    }
    return out;
  }

  // Two-stage alignment used by the live garment: (1) the one-time INITIAL warp maps the garment's 2D bone onto the rest
  // pose of the 3D bone using a purely planar (x/y) deformation, so at rest the garment is flat, parallel to and at the
  // same depth as the portrait plane, an extension of the portrait itself; (2) procedural animation then moves it by
  // the bone's motion since rest: the shortest-arc 3D rotation (pitch included) from the rest direction to the live
  // direction plus the change in bone length. Points are {x,y,z}; `rest*` must be flattened to the garment's depth and
  // `live*` expressed relative to rest at that same depth (the caller adds the per-joint depth correction), so at rest the
  // result is exactly the planar alignment. Returns {m: [9 row-major], tx, ty, tz, stretch, rotation}.
  function alignBoneWithMotion(fromStart, fromEnd, restStart, restEnd, liveStart, liveEnd, { perpendicularScale = 1 } = {}) {
    const planar = alignBoneSegment(fromStart, fromEnd, restStart, restEnd, { perpendicularScale });
    const num = value => Number(value) || 0;
    const rs = [num(restStart?.x), num(restStart?.y), num(restStart?.z)];
    const ls = [num(liveStart?.x), num(liveStart?.y), num(liveStart?.z)];
    const dr = [num(restEnd?.x) - rs[0], num(restEnd?.y) - rs[1], num(restEnd?.z) - rs[2]];
    const dl = [num(liveEnd?.x) - ls[0], num(liveEnd?.y) - ls[1], num(liveEnd?.z) - ls[2]];
    const restLength = Math.hypot(dr[0], dr[1], dr[2]), liveLength = Math.hypot(dl[0], dl[1], dl[2]);
    // Planar alignment as a 3x3 (depth passes through) plus its translation.
    const A = [planar.a, planar.c, 0, planar.b, planar.d, 0, 0, 0, 1];
    const t2 = [planar.tx, planar.ty, 0];
    let Rs = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    let rotation = 0;
    if (restLength >= MIN_BONE_LENGTH && liveLength >= MIN_BONE_LENGTH) {
      const ur = dr.map(v => v / restLength), ul = dl.map(v => v / liveLength);
      const cosine = Math.max(-1, Math.min(1, ur[0] * ul[0] + ur[1] * ul[1] + ur[2] * ul[2]));
      rotation = Math.acos(cosine);
      let R;
      if (cosine < -0.999999) { // End for end: half turn about any axis across the bone.
        const axis = Math.abs(ur[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const dotAxis = axis[0] * ur[0] + axis[1] * ur[1] + axis[2] * ur[2];
        let p = [axis[0] - dotAxis * ur[0], axis[1] - dotAxis * ur[1], axis[2] - dotAxis * ur[2]];
        const pl = Math.hypot(p[0], p[1], p[2]) || 1; p = p.map(v => v / pl);
        R = [2 * p[0] * p[0] - 1, 2 * p[0] * p[1], 2 * p[0] * p[2], 2 * p[1] * p[0], 2 * p[1] * p[1] - 1, 2 * p[1] * p[2], 2 * p[2] * p[0], 2 * p[2] * p[1], 2 * p[2] * p[2] - 1];
      } else { // Rodrigues: shortest rotation taking the rest direction onto the live direction.
        const v = [ur[1] * ul[2] - ur[2] * ul[1], ur[2] * ul[0] - ur[0] * ul[2], ur[0] * ul[1] - ur[1] * ul[0]], k = 1 / (1 + cosine);
        R = [
          1 - k * (v[1] * v[1] + v[2] * v[2]), -v[2] + k * v[0] * v[1], v[1] + k * v[0] * v[2],
          v[2] + k * v[0] * v[1], 1 - k * (v[0] * v[0] + v[2] * v[2]), -v[0] + k * v[1] * v[2],
          -v[1] + k * v[0] * v[2], v[0] + k * v[1] * v[2], 1 - k * (v[0] * v[0] + v[1] * v[1]),
        ];
      }
      const sm = Math.max(0.4, Math.min(2.5, liveLength / restLength)); // How much the bone has lengthened/shortened since rest.
      const S = new Array(9);
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) S[row * 3 + col] = (row === col ? 1 : 0) + (sm - 1) * ur[row] * ur[col];
      Rs = new Array(9);
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) Rs[row * 3 + col] = R[row * 3] * S[col] + R[row * 3 + 1] * S[3 + col] + R[row * 3 + 2] * S[6 + col];
    } else { // Degenerate bone: translate with the joint only.
      Rs = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    }
    const m = new Array(9);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) m[row * 3 + col] = Rs[row * 3] * A[col] + Rs[row * 3 + 1] * A[3 + col] + Rs[row * 3 + 2] * A[6 + col];
    const q = [t2[0] - rs[0], t2[1] - rs[1], t2[2] - rs[2]];
    return {
      m,
      tx: ls[0] + Rs[0] * q[0] + Rs[1] * q[1] + Rs[2] * q[2],
      ty: ls[1] + Rs[3] * q[0] + Rs[4] * q[1] + Rs[5] * q[2],
      tz: ls[2] + Rs[6] * q[0] + Rs[7] * q[1] + Rs[8] * q[2],
      stretch: planar.stretch,
      rotation,
    };
  }

  // Full 3D version of alignBoneSegment: carries the garment's bone onto a live bone that can point anywhere in space, so
  // a leg that swings forward or back (rotation about the x axis) tilts the garment with it instead of just shrinking in
  // the flat picture. Points are {x,y,z}. `normal` is the garment plane's normal (default +z). The garment rotates by the
  // shortest turn from its bone direction to the live one, then stretches along the bone to the live length and widens
  // across it by `perpendicularScale` (the plane normal is left at 1 so the garment keeps its thickness).
  // Returns {m: [9 row-major], tx, ty, tz, stretch, rotation}: p' = m * p + t.
  function alignBoneSegment3D(fromStart, fromEnd, toStart, toEnd, { perpendicularScale = 1, normal = null } = {}) {
    const f = [Number(fromStart?.x) || 0, Number(fromStart?.y) || 0, Number(fromStart?.z) || 0];
    const t0 = [Number(toStart?.x) || 0, Number(toStart?.y) || 0, Number(toStart?.z) || 0];
    const d2 = [(Number(fromEnd?.x) || 0) - f[0], (Number(fromEnd?.y) || 0) - f[1], (Number(fromEnd?.z) || 0) - f[2]];
    const d3 = [(Number(toEnd?.x) || 0) - t0[0], (Number(toEnd?.y) || 0) - t0[1], (Number(toEnd?.z) || 0) - t0[2]];
    const length2 = Math.hypot(d2[0], d2[1], d2[2]), length3 = Math.hypot(d3[0], d3[1], d3[2]);
    if (length2 < MIN_BONE_LENGTH || length3 < MIN_BONE_LENGTH) {
      return { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], tx: t0[0] - f[0], ty: t0[1] - f[1], tz: t0[2] - f[2], stretch: 1, rotation: 0 };
    }
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    const unit = p => { const l = Math.hypot(p[0], p[1], p[2]) || 1; return [p[0] / l, p[1] / l, p[2] / l]; };
    const u2 = unit(d2), u3 = unit(d3);
    let n2 = normal ? [Number(normal.x) || 0, Number(normal.y) || 0, Number(normal.z) || 0] : [0, 0, 1];
    const along = dot(n2, u2);
    n2 = [n2[0] - along * u2[0], n2[1] - along * u2[1], n2[2] - along * u2[2]];
    if (Math.hypot(n2[0], n2[1], n2[2]) < 1e-6) n2 = Math.abs(u2[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], n2 = [n2[0] - dot(n2, u2) * u2[0], n2[1] - dot(n2, u2) * u2[1], n2[2] - dot(n2, u2) * u2[2]];
    n2 = unit(n2);
    const p2 = cross(n2, u2); // In-plane direction across the bone.
    const stretch = Math.max(MIN_STRETCH, Math.min(MAX_STRETCH, length3 / length2));
    const across = perpendicularScale === 'balanced'
      ? Math.sqrt(stretch)
      : (Number.isFinite(perpendicularScale) && perpendicularScale > 0 ? perpendicularScale : 1);
    const cosine = Math.max(-1, Math.min(1, dot(u2, u3)));
    let R;
    if (cosine < -0.999999) { // Bone flipped end for end: half turn about the across axis.
      R = [2 * p2[0] * p2[0] - 1, 2 * p2[0] * p2[1], 2 * p2[0] * p2[2], 2 * p2[1] * p2[0], 2 * p2[1] * p2[1] - 1, 2 * p2[1] * p2[2], 2 * p2[2] * p2[0], 2 * p2[2] * p2[1], 2 * p2[2] * p2[2] - 1];
    } else { // Rodrigues: shortest rotation taking u2 onto u3.
      const v = cross(u2, u3), k = 1 / (1 + cosine);
      R = [
        1 - k * (v[1] * v[1] + v[2] * v[2]), -v[2] + k * v[0] * v[1], v[1] + k * v[0] * v[2],
        v[2] + k * v[0] * v[1], 1 - k * (v[0] * v[0] + v[2] * v[2]), -v[0] + k * v[1] * v[2],
        -v[1] + k * v[0] * v[2], v[0] + k * v[1] * v[2], 1 - k * (v[0] * v[0] + v[1] * v[1]),
      ];
    }
    const S = new Array(9);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) S[row * 3 + col] = stretch * u2[row] * u2[col] + across * p2[row] * p2[col] + n2[row] * n2[col];
    const m = new Array(9);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) m[row * 3 + col] = R[row * 3] * S[col] + R[row * 3 + 1] * S[3 + col] + R[row * 3 + 2] * S[6 + col];
    return {
      m,
      tx: t0[0] - (m[0] * f[0] + m[1] * f[1] + m[2] * f[2]),
      ty: t0[1] - (m[3] * f[0] + m[4] * f[1] + m[5] * f[2]),
      tz: t0[2] - (m[6] * f[0] + m[7] * f[1] + m[8] * f[2]),
      stretch,
      rotation: Math.acos(cosine),
    };
  }

  // Linear-blend skinning of a flat vertex array in place. base/out: Float32Array xyz triples. weights:
  // Float32Array of `channelCount` normalized weights per vertex, in WEIGHT_CHANNELS order. transforms: one entry per
  // channel, an {a,b,c,d,tx,ty} affine or null for "stays rigid" (the belt). Depth (z) is carried through unchanged so
  // the garment keeps its place in front of the portrait plane.
  function skinWeightedPositions(base, weights, transforms, out, channelCount = WEIGHT_CHANNELS.length) {
    const vertexCount = Math.floor(base.length / 3);
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const x = base[vertex * 3], y = base[vertex * 3 + 1], z = base[vertex * 3 + 2];
      let ox = 0, oy = 0, oz = 0;
      for (let channel = 0; channel < channelCount; channel++) {
        const weight = weights[vertex * channelCount + channel];
        if (!(weight > 0)) continue;
        const transform = transforms[channel];
        if (transform && transform.m) { // Full 3D bone transform from alignBoneSegment3D.
          const m = transform.m;
          ox += weight * (m[0] * x + m[1] * y + m[2] * z + transform.tx);
          oy += weight * (m[3] * x + m[4] * y + m[5] * z + transform.ty);
          oz += weight * (m[6] * x + m[7] * y + m[8] * z + transform.tz);
        } else if (transform) { // Planar affine: depth carried through.
          ox += weight * (transform.a * x + transform.c * y + transform.tx);
          oy += weight * (transform.b * x + transform.d * y + transform.ty);
          oz += weight * z;
        } else {
          ox += weight * x;
          oy += weight * y;
          oz += weight * z;
        }
      }
      out[vertex * 3] = ox;
      out[vertex * 3 + 1] = oy;
      out[vertex * 3 + 2] = oz;
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
    alignBoneSegment3D,
    alignBoneWithMotion,
    amplifyLegRoll,
    sharpenWeights,
    portraitMapping,
    portraitPointForLocal,
    defaultBeltAtPosterior,
    skinWeightedPositions,
    validateProject,
  });
})(typeof window !== 'undefined' ? window : globalThis);
