// Seven-node headband/crown centreline warp. Pure sprite math; no DOM or 3D dependency.
(function (global) {
  'use strict';
  const NODES = 7; // The author edits seven control points per source/target curve.
  const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
  function valid(nodes) {
    if (!Array.isArray(nodes) || nodes.length !== NODES) return false;
    return nodes.every((p, i) => p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
      p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 &&
      (!i || p.x > nodes[i - 1].x + 0.0001));
  }
  function trace(rgba, width, height) {
    if (!rgba || rgba.length !== width * height * 4 || width < 8 || height < 8) return null;
    const counts = new Uint16Array(width); // Per-column opaque pixel weights locate the source band's horizontal span.
    let count = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] >= 64) { counts[x]++; count++; }
    }
    if (count < 8) return null;
    // Trim only rare isolated outliers; the band endpoints are otherwise preserved.
    let acc = 0, left = 0, right = width - 1;
    for (let x = 0; x < width; x++) { acc += counts[x]; if (acc >= count * .012) { left = x; break; } }
    acc = 0;
    for (let x = width - 1; x >= 0; x--) { acc += counts[x]; if (acc >= count * .012) { right = x; break; } }
    if (right - left < 12) return null;
    const nodes = [];
    for (let k = 0; k < NODES; k++) {
      const x = Math.round(left + (right - left) * k / (NODES - 1));
      let ys = [];
      for (let radius = 2; radius <= 6; radius += 2) {
        ys = [];
        for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx++) {
          for (let y = 0; y < height; y++) {
            if (rgba[(y * width + xx) * 4 + 3] >= 64) ys.push(y);
          }
        }
        if (ys.length >= 3) break;
      }
      if (!ys.length) return null;
      ys.sort((a, b) => a - b);
      nodes.push({ x: x / (width - 1), y: ys[Math.floor(ys.length / 2)] / (height - 1) });
    }
    return valid(nodes) ? nodes : null;
  }
  function smoothPoint(nodes, i, t) {
    const a = nodes[i], b = nodes[i + 1], p = nodes[Math.max(0, i - 1)], q = nodes[Math.min(NODES - 1, i + 2)];
    const m0 = i === 0 ? b.y - a.y : (b.y - p.y) * .5;
    const m1 = i === NODES - 2 ? b.y - a.y : (q.y - a.y) * .5;
    const t2 = t * t, t3 = t2 * t;
    return {
      x: a.x + (b.x - a.x) * t, // Linear x prevents foldovers, even with unevenly spaced nodes.
      y: clamp((2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * m0 +
        (-2 * t3 + 3 * t2) * b.y + (t3 - t2) * m1, 0, 1)
    };
  }
  function curveAt(nodes, u) {
    if (!valid(nodes)) throw new Error('A headband spline needs seven ordered, normalized points.');
    const t = clamp(u, 0, NODES - 1), i = Math.min(NODES - 2, Math.floor(t));
    return smoothPoint(nodes, i, t - i);
  }
  function dragNode(nodes, index, x, y, width, height) {
    if (!valid(nodes) || !Number.isInteger(index) || index < 0 || index >= NODES ||
      !Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid headband control point.');
    const gap = Math.max(1.5 / Math.max(2, width - 1), .002);
    const low = index ? nodes[index - 1].x + gap : 0;
    const high = index < NODES - 1 ? nodes[index + 1].x - gap : 1;
    const copy = nodes.map(p => ({ ...p })); // Drag editing never aliases the prior saved/undo snapshot.
    copy[index] = { x: clamp(x, Math.min(low, high), Math.max(low, high)), y: clamp(y, 0, 1) };
    return valid(copy) ? copy : nodes.map(p => ({ ...p }));
  }
  function flipNodes(nodes, axis) {
    if (!valid(nodes) || !['horizontal', 'vertical'].includes(axis))
      throw new Error('Flip requires seven ordered nodes and a horizontal or vertical axis.');
    // Reflect around the curve's own bounding box, not the full portrait.
    const minX = nodes[0].x, maxX = nodes[NODES - 1].x;
    const ys = nodes.map(p => p.y), minY = Math.min(...ys), maxY = Math.max(...ys);
    const result = axis === 'horizontal'
      ? nodes.slice().reverse().map(p => ({ x: minX + maxX - p.x, y: p.y }))
      : nodes.map(p => ({ x: p.x, y: minY + maxY - p.y }));
    return valid(result) ? result : nodes.map(p => ({ ...p }));
  }
  function warp(rgba, width, height, source, target) {
    if (!rgba || rgba.length !== width * height * 4 || width < 2 || height < 2 ||
      !valid(source) || !valid(target)) throw new Error('Invalid headband image or seven-point curves.');
    const out = new Uint8ClampedArray(rgba.length);
    let identical = true;
    for (let i = 0; i < NODES; i++) {
      if (Math.abs(source[i].x - target[i].x) > 1e-9 ||
          Math.abs(source[i].y - target[i].y) > 1e-9) { identical = false; break; }
    }
    if (identical) { out.set(rgba); return out; }
    const srcX = new Float32Array(width), shiftY = new Float32Array(width); // Per-column inverse mapping, computed once for all output rows.
    for (let x = 0; x < width; x++) {
      const destX = x / (width - 1);
      let original, targetY, i = 0, t = 0;
      if (destX < target[0].x) {
        original = destX + source[0].x - target[0].x;
        targetY = source[0].y - target[0].y;
      } else if (destX > target[NODES - 1].x) {
        original = destX + source[NODES - 1].x - target[NODES - 1].x;
        targetY = source[NODES - 1].y - target[NODES - 1].y;
      } else {
        while (i < NODES - 2 && destX > target[i + 1].x) i++;
        t = clamp((destX - target[i].x) / (target[i + 1].x - target[i].x), 0, 1);
        original = source[i].x + (source[i + 1].x - source[i].x) * t;
        targetY = smoothPoint(source, i, t).y - smoothPoint(target, i, t).y;
      }
      srcX[x] = Math.round(original * (width - 1));
      shiftY[x] = targetY * (height - 1);
    }
    for (let x = 0; x < width; x++) {
      const sx = srcX[x];
      if (sx < 0 || sx >= width) continue;
      for (let y = 0; y < height; y++) {
        const sy = Math.round(y + shiftY[x]);
        if (sy < 0 || sy >= height) continue;
        const from = (sy * width + sx) * 4, to = (y * width + x) * 4;
        out[to] = rgba[from]; out[to + 1] = rgba[from + 1];
        out[to + 2] = rgba[from + 2]; out[to + 3] = rgba[from + 3];
      }
    }
    return out; // Nearest-neighbour sampling preserves the authored pixel art and alpha exactly.
  }
  global.ClothingHeadbandSpline = Object.freeze({ NODES, valid, trace, curveAt, dragNode, flipNodes, warp });
})(typeof window !== 'undefined' ? window : globalThis);
