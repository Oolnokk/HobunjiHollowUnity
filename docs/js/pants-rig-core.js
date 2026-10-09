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
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
      const next = channelIndex === channelCount - 1
        ? 255 - assigned
        : Math.max(0, Math.min(255, Math.round((data[offset + channelIndex] || 0) * 255 / sum)));
      data[offset + channelIndex] = next;
      assigned += next;
    }
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
    sampleWeights,
    validateProject,
  });
})(typeof window !== 'undefined' ? window : globalThis);
