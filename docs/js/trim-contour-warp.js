// Cross-species garment trim transfer for the Pattern Editor.
//
// A finished source trim mask is carried onto a differently drawn target
// garment through contour coordinates instead of by replaying brush strokes:
// every garment pixel gets (cloth region, position along one of that region's
// traced contour loops, signed depth from that contour), the source and target
// loops are aligned by arc length (cyclic shift + banded DTW), and each target
// pixel copies the source mask value found at the matching coordinate.
// Reading the finished pixels means authoring errors cannot compound the way
// stroke replay (erase -> expand 7px -> ...) does across mismatched shapes.
//
// Pure typed-array API so node regression scripts can execute it directly.
(function (root) {
  'use strict';

  const STRUCTURAL_ALPHA_MIN = 128; // Same solid-cloth threshold as the editor's structural outline tools.
  const STRUCTURAL_DARK_MAX = 28; // Same near-black line-art cutoff as production woven cloth.
  const OPAQUE_ALPHA_MIN = 17; // Same visible-pixel threshold as Direct Paint (alpha > 16).
  const MIN_REGION_FRACTION = 0.01; // Anti-aliased specks below 1% of structural cloth behave like line art.
  const MIN_HOLE_FRACTION = 0.03; // Holes smaller than 3% of their region (dark shading flecks) are not contours.
  const LOOP_SAMPLES = 160;
  const DTW_BAND_FRACTION = 0.25;
  const DEPTH_RATIO_MIN = 0.67, DEPTH_RATIO_MAX = 1.5; // Bands keep roughly their pixel width; only local thickness differences rescale them.
  const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]; // Clockwise in screen space (y down).

  function garmentGeometry(rgba, width, height) {
    const count = width * height, mask = new Uint8Array(count), opaque = new Uint8Array(count);
    for (let p = 0; p < count; p++) {
      const o = p * 4, alpha = rgba[o + 3];
      opaque[p] = alpha >= OPAQUE_ALPHA_MIN ? 1 : 0;
      mask[p] = alpha >= STRUCTURAL_ALPHA_MIN && Math.max(rgba[o], rgba[o + 1], rgba[o + 2]) > STRUCTURAL_DARK_MAX ? 1 : 0;
    }
    return { width, height, mask, opaque };
  }

  function labelRegions(geometry) {
    const { width, height, mask } = geometry, raw = new Int32Array(width * height).fill(-1), found = [];
    let total = 0;
    for (let p = 0; p < mask.length; p++) total += mask[p];
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || raw[start] !== -1) continue;
      const id = found.length, pixels = [start], stack = [start];
      raw[start] = id;
      while (stack.length) {
        const index = stack.pop(), x = index % width, y = (index / width) | 0;
        for (const [ox, oy] of N8) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && raw[next] === -1) { raw[next] = id; stack.push(next); pixels.push(next); }
        }
      }
      found.push({ pixels });
    }
    const labels = new Int32Array(width * height).fill(-1);
    const regions = found.filter(region => region.pixels.length >= Math.max(2, total * MIN_REGION_FRACTION));
    regions.forEach((region, id) => {
      region.id = id;
      let sumX = 0, sumY = 0, minX = width, minY = height, maxX = -1, maxY = -1;
      for (const p of region.pixels) {
        labels[p] = id;
        const x = p % width, y = (p / width) | 0;
        sumX += x; sumY += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      region.area = region.pixels.length;
      region.cx = sumX / region.area; region.cy = sumY / region.area;
      region.bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
      region.scale = Math.sqrt(region.area);
    });
    return { labels, regions };
  }

  // Moore-neighbour trace of the region pixels bordering one outside component.
  function traceLoop(labels, id, width, height, start, backX, backY) {
    const inRegion = (x, y) => x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === id;
    const loop = [start];
    let cx = start % width, cy = (start / width) | 0, bx = backX, by = backY, firstNext = -1;
    const limit = width * height * 4;
    for (let step = 0; step < limit; step++) {
      let k0 = 0;
      for (let k = 0; k < 8; k++) if (N8[k][0] === bx - cx && N8[k][1] === by - cy) { k0 = k; break; }
      let next = -1, nextX = 0, nextY = 0, prevX = bx, prevY = by;
      for (let i = 1; i <= 8; i++) {
        const d = (k0 + i) % 8, nx = cx + N8[d][0], ny = cy + N8[d][1];
        if (inRegion(nx, ny)) { next = ny * width + nx; nextX = nx; nextY = ny; break; }
        prevX = nx; prevY = ny;
      }
      if (next < 0) break; // Single-pixel region.
      const current = cy * width + cx;
      if (current === start) {
        if (firstNext === -1) firstNext = next;
        else if (next === firstNext) break; // Back at the start heading the same way: loop closed.
      }
      cx = nextX; cy = nextY; bx = prevX; by = prevY;
      if (next !== start) loop.push(next);
    }
    return loop;
  }

  function regionLoops(layout, geometry) {
    const { width, height } = geometry, { labels } = layout;
    for (const region of layout.regions) {
      let top = region.pixels[0];
      for (const p of region.pixels) if (p < top) top = p;
      const outer = { kind: 'outer', pixels: traceLoop(labels, region.id, width, height, top, (top % width) - 1, (top / width) | 0) };
      outer.cx = region.cx; outer.cy = region.cy; outer.area = region.area;
      region.loops = [outer];

      // Holes: 4-connected non-region components inside the bounds that never reach the bounds' edge.
      const b = region.bounds, bw = b.width, bh = b.height, seen = new Uint8Array(bw * bh);
      const local = (x, y) => (y - b.y) * bw + (x - b.x);
      const isOther = (x, y) => labels[y * width + x] !== region.id;
      const flood = (sx, sy) => {
        const pixels = [], stack = [[sx, sy]];
        let touchesEdge = false;
        seen[local(sx, sy)] = 1;
        while (stack.length) {
          const [x, y] = stack.pop();
          pixels.push(y * width + x);
          if (x === b.x || y === b.y || x === b.x + bw - 1 || y === b.y + bh - 1) touchesEdge = true;
          for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + ox, ny = y + oy;
            if (nx < b.x || ny < b.y || nx >= b.x + bw || ny >= b.y + bh) continue;
            if (seen[local(nx, ny)] || !isOther(nx, ny)) continue;
            seen[local(nx, ny)] = 1;
            stack.push([nx, ny]);
          }
        }
        return { pixels, touchesEdge };
      };
      for (let y = b.y; y < b.y + bh; y++) for (let x = b.x; x < b.x + bw; x++) {
        if (seen[local(x, y)] || !isOther(x, y)) continue;
        const hole = flood(x, y);
        if (hole.touchesEdge || hole.pixels.length < region.area * MIN_HOLE_FRACTION) continue;
        let first = hole.pixels[0];
        for (const p of hole.pixels) if (p < first) first = p;
        const hx = first % width, hy = (first / width) | 0;
        const start = (hy - 1) * width + hx; // Pixel above the hole's first pixel is necessarily this region.
        let sx = 0, sy = 0;
        for (const p of hole.pixels) { sx += p % width; sy += (p / width) | 0; }
        region.loops.push({ kind: 'hole', pixels: traceLoop(labels, region.id, width, height, start, hx, hy), cx: sx / hole.pixels.length, cy: sy / hole.pixels.length, area: hole.pixels.length });
      }
    }
  }

  function garmentBox(geometry) {
    let minX = geometry.width, minY = geometry.height, maxX = -1, maxY = -1;
    for (let p = 0; p < geometry.mask.length; p++) {
      if (!geometry.mask[p]) continue;
      const x = p % geometry.width, y = (p / geometry.width) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  function regionCost(a, b, boxA, boxB) {
    const ax = (a.cx - boxA.x) / boxA.width, ay = (a.cy - boxA.y) / boxA.height;
    const bx = (b.cx - boxB.x) / boxB.width, by = (b.cy - boxB.y) / boxB.height;
    const areaA = a.area / (boxA.width * boxA.height), areaB = b.area / (boxB.width * boxB.height);
    return 6 * ((ax - bx) ** 2 + (ay - by) ** 2) + 0.3 * Math.log(areaA / areaB) ** 2;
  }

  // Returns Map(sourceRegionId -> targetRegionId). Exhaustive for the handful of
  // cloth pieces real garments have; greedy beyond that.
  function matchRegions(source, target, boxA, boxB) {
    const a = [...source.regions].sort((p, q) => q.area - p.area), b = target.regions;
    const cost = a.map(ra => b.map(rb => regionCost(ra, rb, boxA, boxB)));
    const UNMATCHED = 4; // Leaving a piece unmatched must cost more than any plausible repositioning of it.
    let best = null, bestCost = Infinity;
    if (a.length <= 8 && b.length <= 8) {
      const used = new Uint8Array(b.length), pick = [];
      const search = (i, total) => {
        if (total >= bestCost) return;
        if (i === a.length) { bestCost = total; best = pick.slice(); return; }
        for (let j = 0; j < b.length; j++) {
          if (used[j]) continue;
          used[j] = 1; pick.push(j);
          search(i + 1, total + cost[i][j]);
          pick.pop(); used[j] = 0;
        }
        pick.push(-1); search(i + 1, total + UNMATCHED); pick.pop();
      };
      search(0, 0);
    } else {
      const pairs = [];
      a.forEach((_, i) => b.forEach((__, j) => pairs.push([cost[i][j], i, j])));
      pairs.sort((p, q) => p[0] - q[0]);
      best = new Array(a.length).fill(-1);
      const usedB = new Set();
      for (const [c, i, j] of pairs) if (c < UNMATCHED && best[i] === -1 && !usedB.has(j)) { best[i] = j; usedB.add(j); }
    }
    const matches = new Map();
    (best || []).forEach((j, i) => { if (j >= 0) matches.set(a[i].id, b[j].id); });
    return matches;
  }

  // Outer loop always pairs with outer loop; holes pair greedily by their region-relative position and size.
  function matchLoops(ra, rb) {
    const pairs = [[0, 0]];
    const holeA = ra.loops.map((loop, i) => [loop, i]).filter(([loop]) => loop.kind === 'hole');
    const holeB = rb.loops.map((loop, i) => [loop, i]).filter(([loop]) => loop.kind === 'hole');
    const candidates = [];
    for (const [la, i] of holeA) for (const [lb, j] of holeB) {
      const dx = (la.cx - ra.cx) / ra.scale - (lb.cx - rb.cx) / rb.scale;
      const dy = (la.cy - ra.cy) / ra.scale - (lb.cy - rb.cy) / rb.scale;
      const size = Math.log((la.area / ra.area) / (lb.area / rb.area));
      candidates.push([dx * dx + dy * dy + 0.1 * size * size, i, j]);
    }
    candidates.sort((p, q) => p[0] - q[0]);
    const usedA = new Set(), usedB = new Set();
    for (const [c, i, j] of candidates) {
      if (c > 0.5 || usedA.has(i) || usedB.has(j)) continue;
      usedA.add(i); usedB.add(j); pairs.push([i, j]);
    }
    return pairs;
  }

  // Maps a target loop position to the corresponding source loop position.
  function loopCorrespondence(sourceLoop, sourceRegion, sourceWidth, targetLoop, targetRegion, targetWidth) {
    const normalize = (loop, region, width) => loop.pixels.map(p => [((p % width) - region.cx) / region.scale, (((p / width) | 0) - region.cy) / region.scale]);
    const A = normalize(sourceLoop, sourceRegion, sourceWidth), B = normalize(targetLoop, targetRegion, targetWidth);
    const M = LOOP_SAMPLES;
    const resample = points => Array.from({ length: M }, (_, i) => points[Math.floor(i * points.length / M)]);
    const a = resample(A), b = resample(B);
    const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    let shift = 0, bestShift = Infinity;
    for (let k = 0; k < M; k++) {
      let total = 0;
      for (let i = 0; i < M; i++) total += d2(a[i], b[(i + k) % M]);
      if (total < bestShift) { bestShift = total; shift = k; }
    }
    const shifted = b.map((_, i) => b[(i + shift) % M]);
    const band = Math.ceil(M * DTW_BAND_FRACTION), stride = M + 1;
    const D = new Float64Array(stride * stride).fill(Infinity);
    D[0] = 0;
    for (let i = 1; i <= M; i++) {
      for (let j = Math.max(1, i - band); j <= Math.min(M, i + band); j++) {
        D[i * stride + j] = d2(a[i - 1], shifted[j - 1]) + Math.min(D[(i - 1) * stride + j], D[i * stride + j - 1], D[(i - 1) * stride + j - 1]);
      }
    }
    const sum = new Float64Array(M), hits = new Float64Array(M);
    for (let i = M, j = M; i > 0 && j > 0;) {
      sum[j - 1] += i - 1; hits[j - 1]++; // A target sample warped onto several source samples maps to their mean.
      const diag = D[(i - 1) * stride + j - 1], up = D[(i - 1) * stride + j], left = D[i * stride + j - 1];
      if (diag <= up && diag <= left) { i--; j--; } else if (up <= left) i--; else j--;
    }
    const targetToSource = Array.from(sum, (value, j) => (hits[j] ? value / hits[j] : j));
    const sourceLength = sourceLoop.pixels.length, targetLength = targetLoop.pixels.length;
    return targetPosition => {
      const sample = targetPosition * M / targetLength; // Fractional sample keeps the map pixel-exact instead of quantizing to LOOP_SAMPLES steps.
      const unshifted = ((sample - shift) % M + M) % M;
      const j0 = Math.floor(unshifted), j1 = (j0 + 1) % M, t = unshifted - j0;
      let s0 = targetToSource[j0], s1 = targetToSource[j1];
      if (j1 === 0) s1 += M; // Wrap the cyclic sample so interpolation never runs backwards across the seam.
      const sourceSample = s0 + (s1 - s0) * t;
      return ((Math.round(sourceSample * sourceLength / M) % sourceLength) + sourceLength) % sourceLength;
    };
  }

  function dijkstra(width, height, seeds, passable) {
    const count = width * height, distance = new Float32Array(count).fill(Infinity), owner = new Int32Array(count).fill(-1);
    const heapIndex = [], heapValue = [];
    const push = (index, value) => {
      let at = heapIndex.length;
      heapIndex.push(index); heapValue.push(value);
      while (at > 0) {
        const parent = (at - 1) >> 1;
        if (heapValue[parent] <= value) break;
        heapIndex[at] = heapIndex[parent]; heapValue[at] = heapValue[parent];
        at = parent;
      }
      heapIndex[at] = index; heapValue[at] = value;
    };
    const pop = () => {
      const index = heapIndex[0], value = heapValue[0];
      const lastIndex = heapIndex.pop(), lastValue = heapValue.pop();
      if (heapIndex.length) {
        let at = 0;
        for (;;) {
          const left = at * 2 + 1, right = left + 1;
          if (left >= heapIndex.length) break;
          let child = left;
          if (right < heapIndex.length && heapValue[right] < heapValue[left]) child = right;
          if (heapValue[child] >= lastValue) break;
          heapIndex[at] = heapIndex[child]; heapValue[at] = heapValue[child];
          at = child;
        }
        heapIndex[at] = lastIndex; heapValue[at] = lastValue;
      }
      return [index, value];
    };
    for (const seed of seeds) { distance[seed] = 0; owner[seed] = seed; push(seed, 0); }
    while (heapIndex.length) {
      const [index, value] = pop();
      if (value > distance[index] + 1e-4) continue;
      const x = index % width, y = (index / width) | 0;
      for (const [ox, oy] of N8) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (!passable(next, owner[index])) continue;
        const candidate = value + (ox && oy ? Math.SQRT2 : 1);
        if (candidate + 1e-4 < distance[next]) { distance[next] = candidate; owner[next] = owner[index]; push(next, candidate); }
      }
    }
    return { distance, owner };
  }

  // Per-pixel (region, loop, position, signed depth) for the loops in `activeLoops`
  // (Map regionId -> Set(loopIndex)). Depth is positive inside cloth and negative
  // on adjacent line art / fringe, so edits outside the cloth never flip inward.
  function contourCoordinates(geometry, layout, activeLoops) {
    const { width, height } = geometry, count = width * height;
    const seedLoop = new Int32Array(count).fill(-1), seedPosition = new Int32Array(count).fill(-1), seeds = [];
    for (const region of layout.regions) {
      const active = activeLoops.get(region.id);
      if (!active) continue;
      region.loops.forEach((loop, loopIndex) => {
        if (!active.has(loopIndex)) return;
        loop.pixels.forEach((pixel, position) => {
          if (seedLoop[pixel] !== -1) return;
          seedLoop[pixel] = loopIndex; seedPosition[pixel] = position; seeds.push(pixel);
        });
      });
    }
    const { labels } = layout;
    const inside = dijkstra(width, height, seeds, (next, owner) => labels[next] >= 0 && labels[next] === labels[owner]);
    const outside = dijkstra(width, height, seeds, next => geometry.opaque[next] && labels[next] < 0);
    const region = new Int32Array(count).fill(-1), loop = new Int32Array(count).fill(-1), position = new Int32Array(count).fill(-1), depth = new Float32Array(count);
    for (let p = 0; p < count; p++) {
      let owner = -1, d = 0;
      if (labels[p] >= 0 && inside.owner[p] >= 0) { owner = inside.owner[p]; d = inside.distance[p]; }
      else if (labels[p] < 0 && geometry.opaque[p] && outside.owner[p] >= 0) { owner = outside.owner[p]; d = -outside.distance[p]; }
      if (owner < 0) continue;
      region[p] = labels[owner]; loop[p] = seedLoop[owner]; position[p] = seedPosition[owner]; depth[p] = d;
    }
    // Local cloth thickness per loop position (smoothed) lets depth rescale where one species' piece is thicker.
    const thickness = new Map();
    for (const r of layout.regions) r.loops.forEach((l, li) => thickness.set(`${r.id}:${li}`, new Float32Array(l.pixels.length)));
    for (let p = 0; p < count; p++) {
      if (loop[p] < 0 || depth[p] <= 0) continue;
      const row = thickness.get(`${region[p]}:${loop[p]}`);
      if (depth[p] > row[position[p]]) row[position[p]] = depth[p];
    }
    for (const [key, row] of thickness) {
      const smoothed = new Float32Array(row.length);
      for (let i = 0; i < row.length; i++) {
        let best = 0;
        for (let k = -3; k <= 3; k++) best = Math.max(best, row[((i + k) % row.length + row.length) % row.length]);
        smoothed[i] = Math.max(1, best);
      }
      thickness.set(key, smoothed);
    }
    return { region, loop, position, depth, thickness };
  }

  function despeckle(mask, opaque, width, height) {
    const out = mask.slice();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!opaque[p]) continue;
      let neighbours = 0, painted = 0;
      for (const [ox, oy] of N8) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || !opaque[ny * width + nx]) continue;
        neighbours++; painted += mask[ny * width + nx];
      }
      if (neighbours < 5) continue;
      if (mask[p] && painted <= 1) out[p] = 0;
      else if (!mask[p] && painted >= neighbours - 1) out[p] = 1;
    }
    return out;
  }

  // sourceRgba/targetRgba: garment RGBA bytes; sourceMask: Uint8Array (1 = trim) in source pixel space.
  // Returns { mask, report } with mask in target pixel space, clipped to visible target garment pixels.
  function warpTrimMask({ sourceRgba, sourceMask, sourceWidth, sourceHeight, targetRgba, targetWidth, targetHeight }) {
    const sourceGeometry = garmentGeometry(sourceRgba, sourceWidth, sourceHeight);
    const targetGeometry = garmentGeometry(targetRgba, targetWidth, targetHeight);
    const sourceBox = garmentBox(sourceGeometry), targetBox = garmentBox(targetGeometry);
    if (!sourceBox || !targetBox) throw new Error('Could not find non-black garment cloth for trim transfer.');
    const source = labelRegions(sourceGeometry), target = labelRegions(targetGeometry);
    regionLoops(source, sourceGeometry); regionLoops(target, targetGeometry);
    const regionMatches = matchRegions(source, target, sourceBox, targetBox);

    const sourceActive = new Map(), targetActive = new Map(), loopPairs = new Map(); // targetRegionId -> { sourceRegion, byTargetLoop: Map(targetLoop -> { sourceLoop, map }) }
    for (const [sourceId, targetId] of regionMatches) {
      const ra = source.regions[sourceId], rb = target.regions[targetId];
      const byTargetLoop = new Map(), sa = new Set(), tb = new Set();
      for (const [i, j] of matchLoops(ra, rb)) {
        sa.add(i); tb.add(j);
        byTargetLoop.set(j, { sourceLoop: i, map: loopCorrespondence(ra.loops[i], ra, sourceWidth, rb.loops[j], rb, targetWidth) });
      }
      sourceActive.set(sourceId, sa); targetActive.set(targetId, tb);
      loopPairs.set(targetId, { sourceRegion: ra, byTargetLoop });
    }
    const sc = contourCoordinates(sourceGeometry, source, sourceActive);
    const tc = contourCoordinates(targetGeometry, target, targetActive);

    // Source lookup: (region, loop, position) -> flat [depth, value, depth, value, ...].
    const table = new Map();
    for (let p = 0; p < sourceMask.length; p++) {
      if (sc.loop[p] < 0) continue;
      const key = `${sc.region[p]}:${sc.loop[p]}:${sc.position[p]}`;
      let row = table.get(key);
      if (!row) table.set(key, row = []);
      row.push(sc.depth[p], sourceMask[p] ? 1 : 0);
    }

    const out = new Uint8Array(targetWidth * targetHeight);
    let mapped = 0, unmapped = 0;
    for (let p = 0; p < out.length; p++) {
      if (!targetGeometry.opaque[p]) continue;
      const pair = tc.region[p] >= 0 ? loopPairs.get(tc.region[p]) : null;
      const entry = pair?.byTargetLoop.get(tc.loop[p]);
      if (!entry) { unmapped++; continue; }
      const ra = pair.sourceRegion, sourceLoopLength = ra.loops[entry.sourceLoop].pixels.length;
      const sourcePosition = entry.map(tc.position[p]);
      let sourceDepth = tc.depth[p];
      if (sourceDepth > 0) {
        const thickT = tc.thickness.get(`${tc.region[p]}:${tc.loop[p]}`)[tc.position[p]];
        const thickS = sc.thickness.get(`${ra.id}:${entry.sourceLoop}`)[sourcePosition];
        sourceDepth *= Math.min(DEPTH_RATIO_MAX, Math.max(DEPTH_RATIO_MIN, thickS / thickT));
      }
      let bestGap = Infinity, on = 0, total = 0;
      for (let radius = 1; radius <= 4 && !total; radius++) {
        bestGap = Infinity;
        const candidates = [];
        for (let k = -radius; k <= radius; k++) {
          const row = table.get(`${ra.id}:${entry.sourceLoop}:${((sourcePosition + k) % sourceLoopLength + sourceLoopLength) % sourceLoopLength}`);
          if (!row) continue;
          for (let i = 0; i < row.length; i += 2) {
            const gap = Math.abs(row[i] - sourceDepth);
            candidates.push(gap, row[i + 1]);
            if (gap < bestGap) bestGap = gap;
          }
        }
        if (sourceDepth < 0 && bestGap > 1) break; // Line art / halo deeper than anything beside the source contour stays untrimmed instead of smearing outward.
        for (let i = 0; i < candidates.length; i += 2) if (candidates[i] <= bestGap + 0.01) { total++; on += candidates[i + 1]; }
      }
      if (!total) { unmapped++; continue; }
      mapped++;
      out[p] = on * 2 >= total ? 1 : 0;
    }
    return {
      mask: despeckle(out, targetGeometry.opaque, targetWidth, targetHeight),
      report: { sourceRegions: source.regions.length, targetRegions: target.regions.length, matchedRegions: regionMatches.size, mappedPixels: mapped, unmappedPixels: unmapped },
    };
  }

  // Run-length mask encoding for the 'baseMask' journal operation: alternating
  // run lengths starting with an unpainted run. Keeps replicated variants small
  // in clothing-trims.json and makes their journal replay pixel-exact.
  function encodeMaskRuns(mask) {
    const runs = [];
    let value = 0, length = 0;
    for (let p = 0; p < mask.length; p++) {
      const bit = mask[p] ? 1 : 0;
      if (bit === value) { length++; continue; }
      runs.push(length); value = bit; length = 1;
    }
    runs.push(length);
    return runs;
  }

  function decodeMaskRuns(runs, length) {
    const mask = new Uint8Array(length);
    let at = 0, value = 0;
    for (const run of Array.isArray(runs) ? runs : []) {
      const end = Math.min(length, at + Math.max(0, Number(run) || 0));
      if (value) mask.fill(1, at, end);
      at = end; value ^= 1;
    }
    return mask;
  }

  const api = { warpTrimMask, encodeMaskRuns, decodeMaskRuns, __test: { garmentGeometry, labelRegions, regionLoops, matchRegions, contourCoordinates } };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TrimContourWarp = api;
})(typeof window !== 'undefined' ? window : null);
