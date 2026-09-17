// Seven-point shoulder-pet body spline for side-view animal planes.
//
// v9 keeps the explicit BEFORE/AFTER body rig and shoulder material maps, and
// upgrades the frame separator from a vertical X cut to a saved 2D line with
// Z rotation. The same line owns split pixels and the implicit shoulder-paint
// region so editor/runtime cannot disagree about which half is deforming.
(() => {
  'use strict';

  const POINT_COUNT = 7;
  const UNSET_WEIGHT = 256;
  const RESPONSE_EPSILON = 1e-4;
  const DEFAULT_FRAME_SHIFT_X = 0.52;
  const DEFAULT_SEPARATOR_ROTATION_DEG = 0;
  const DEG = Math.PI / 180;
  const DEFAULT_GUIDE = Object.freeze({
    a: Object.freeze({ x: 0.52, y: 0.56 }),
    b: Object.freeze({ x: 1.00, y: 0.57 }),
  });

  function finite(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function clonePoint(point, fallback = { x: 0, y: 0 }) {
    return { x: finite(point?.x, fallback.x), y: finite(point?.y, fallback.y) };
  }
  function cloneGuide(guide = DEFAULT_GUIDE) {
    return { a: clonePoint(guide?.a, DEFAULT_GUIDE.a), b: clonePoint(guide?.b, DEFAULT_GUIDE.b) };
  }
  function linearPointsForGuide(guide = DEFAULT_GUIDE) {
    const g = cloneGuide(guide);
    return Array.from({ length: POINT_COUNT }, (_, index) => {
      const t = index / (POINT_COUNT - 1);
      return { x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t };
    });
  }
  function clonePoints(points, fallbackPoints) {
    return Array.from({ length: POINT_COUNT }, (_, index) => clonePoint(points?.[index], fallbackPoints[index]));
  }

  function separatorConfig(restLike, aspectOverride) {
    const raw = restLike?.shoulderRest ?? restLike ?? {};
    return {
      frameShiftX: clamp(finite(raw?.frameShiftX, DEFAULT_FRAME_SHIFT_X), 0, 1),
      rotationDeg: clamp(finite(raw?.separatorRotationDeg, DEFAULT_SEPARATOR_ROTATION_DEG), -180, 180),
      aspect: Math.max(1e-6, finite(aspectOverride, finite(raw?.separatorAspect, 1))),
    };
  }

  // Positive means the point belongs to the deforming/right side. Coordinates
  // use top-left sprite space. Multiplying normalized X by source aspect makes
  // the authored degree value a real image-plane Z rotation rather than a
  // resolution/aspect-dependent normalized-coordinate slope.
  function separatorSignedSide(u, topV, restLike, aspectOverride) {
    const cfg = separatorConfig(restLike, aspectOverride);
    const radians = cfg.rotationDeg * DEG;
    const dx = (finite(u, 0) - cfg.frameShiftX) * cfg.aspect;
    const dy = finite(topV, 0.5) - 0.5;
    return dx * Math.cos(radians) - dy * Math.sin(radians);
  }
  function separatorPointIsRight(u, topV, restLike, aspectOverride) {
    return separatorSignedSide(u, topV, restLike, aspectOverride) >= -RESPONSE_EPSILON;
  }

  // Rectangle clipped against one side of the separator. Used by both the game
  // frame compositor and the rigger so diagonal ownership is pixel-identical.
  function separatorPolygon(width, height, restLike, keepRight = true) {
    const w = Math.max(1e-6, finite(width, 1)), h = Math.max(1e-6, finite(height, 1));
    const aspect = w / h;
    const signed = point => separatorSignedSide(point.x / w, point.y / h, restLike, aspect) * (keepRight ? 1 : -1);
    let polygon = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    const output = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const sa = signed(a), sb = signed(b), aIn = sa >= -RESPONSE_EPSILON, bIn = sb >= -RESPONSE_EPSILON;
      if (aIn) output.push(a);
      if (aIn !== bIn) {
        const denominator = sa - sb;
        const t = Math.abs(denominator) < 1e-9 ? 0 : clamp(sa / denominator, 0, 1);
        output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return output;
  }

  function decodeWeightMap(raw) {
    if (!raw || !Number.isFinite(Number(raw.width)) || !Number.isFinite(Number(raw.height))) return null;
    const width = Math.max(1, Math.round(Number(raw.width)));
    const height = Math.max(1, Math.round(Number(raw.height)));
    const values = new Uint16Array(width * height);
    values.fill(UNSET_WEIGHT);
    if (raw.encoding === 'rle-u9' && Array.isArray(raw.data)) {
      let cursor = 0;
      for (let i = 0; i + 1 < raw.data.length && cursor < values.length; i += 2) {
        const run = Math.max(0, Math.round(finite(raw.data[i], 0)));
        const value = clamp(Math.round(finite(raw.data[i + 1], UNSET_WEIGHT)), 0, UNSET_WEIGHT);
        const end = Math.min(values.length, cursor + run);
        values.fill(value, cursor, end);
        cursor = end;
      }
    } else if (Array.isArray(raw.data)) {
      for (let i = 0; i < values.length && i < raw.data.length; i++) values[i] = clamp(Math.round(finite(raw.data[i], UNSET_WEIGHT)), 0, UNSET_WEIGHT);
    } else return null;
    return { width, height, values };
  }

  function shoulderDefaultInfluence(u, topV, restLike, aspectOverride) {
    return separatorPointIsRight(u, topV, restLike, aspectOverride) ? 1 : 0;
  }

  function sampleShoulderInfluence(map, u, topV, restLike) {
    const authoredAspect = finite(restLike?.separatorAspect, 0);
    const aspect = authoredAspect > 0 ? authoredAspect : (map?.width && map?.height ? map.width / map.height : undefined);
    const owned = shoulderDefaultInfluence(u, topV, restLike, aspect);
    if (owned <= 0) return 0;
    if (!map) return owned;
    const fx = clamp(u, 0, 1) * Math.max(0, map.width - 1);
    const fy = clamp(topV, 0, 1) * Math.max(0, map.height - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(map.width - 1, x0 + 1), y1 = Math.min(map.height - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const at = (x, y) => {
      const raw = map.values[y * map.width + x];
      const cornerU = map.width <= 1 ? 0 : x / (map.width - 1);
      const cornerV = map.height <= 1 ? 0 : y / (map.height - 1);
      return raw === UNSET_WEIGHT ? shoulderDefaultInfluence(cornerU, cornerV, restLike, aspect) : clamp(raw, 0, 255) / 255;
    };
    const a = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
    const b = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
    return clamp(a * (1 - ty) + b * ty, 0, 1);
  }

  function sampleShoulderMaterial(map, influenceMap, u, topV, restLike, fallbackInfluence) {
    const fallback = clamp(finite(fallbackInfluence, shoulderDefaultInfluence(u, topV, restLike)), 0, 1);
    if (!map) return fallback;
    const fx = clamp(u, 0, 1) * Math.max(0, map.width - 1);
    const fy = clamp(topV, 0, 1) * Math.max(0, map.height - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(map.width - 1, x0 + 1), y1 = Math.min(map.height - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const at = (x, y) => {
      const raw = map.values[y * map.width + x];
      const cornerU = map.width <= 1 ? 0 : x / (map.width - 1);
      const cornerV = map.height <= 1 ? 0 : y / (map.height - 1);
      const base = sampleShoulderInfluence(influenceMap, cornerU, cornerV, restLike);
      return raw === UNSET_WEIGHT ? base : Math.min(base, clamp(raw, 0, 255) / 255);
    };
    const a = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
    const b = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
    return clamp(Math.min(fallback, a * (1 - ty) + b * ty), 0, 1);
  }

  function attachShoulderMaps(result, raw) {
    result.weightMap = raw?.weightMap || null;
    result.compressibilityMap = raw?.compressibilityMap || null;
    result.stretchabilityMap = raw?.stretchabilityMap || null;
    result._shoulderMaps = {
      influence: decodeWeightMap(result.weightMap),
      compressibility: decodeWeightMap(result.compressibilityMap),
      stretchability: decodeWeightMap(result.stretchabilityMap),
    };
    return result;
  }

  function legacyRotations(raw) {
    if (Number.isFinite(Number(raw?.fullRotationDeg)) || Number.isFinite(Number(raw?.interVertexRotationDeg))) {
      return { full: finite(raw?.fullRotationDeg, 0) * DEG, inter: finite(raw?.interVertexRotationDeg, 0) * DEG };
    }
    const bend = finite(raw?.bend, 0);
    const full = Math.atan(4 * bend);
    return { full, inter: -2 * full };
  }
  function legacyCurveCenter(guide, t, rotations) {
    const a = guide.a, b = guide.b;
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 1e-7) return clonePoint(a);
    const tx = dx / length, ty = dy / length, nx = -ty, ny = tx;
    const q = clamp(t, 0, 1), s = q * length, full = rotations.full, inter = rotations.inter;
    let centerAlong, centerNormal;
    if (Math.abs(inter) < 1e-7) {
      centerAlong = s * Math.cos(full); centerNormal = s * Math.sin(full);
    } else {
      const curvature = inter / length, angle = full + inter * q;
      centerAlong = (Math.sin(angle) - Math.sin(full)) / curvature;
      centerNormal = (-Math.cos(angle) + Math.cos(full)) / curvature;
    }
    return { x: a.x + tx * centerAlong + nx * centerNormal, y: a.y + ty * centerAlong + ny * centerNormal };
  }

  function migrateLegacyRest(raw) {
    const frameShiftX = clamp(finite(raw?.frameShiftX, DEFAULT_FRAME_SHIFT_X), 0, 1);
    const followFrameShiftX = raw?.followFrameShiftX !== false;
    const guide = cloneGuide(raw?.restGuide || raw?.guide || DEFAULT_GUIDE);
    const authoredReference = finite(raw?.guideFrameShiftX, frameShiftX);
    if (followFrameShiftX && Number.isFinite(authoredReference)) {
      const dx = frameShiftX - authoredReference;
      guide.a.x += dx; guide.b.x += dx;
    }
    const beforePoints = Array.isArray(raw?.beforePoints) && raw.beforePoints.length === POINT_COUNT
      ? clonePoints(raw.beforePoints, linearPointsForGuide(guide))
      : linearPointsForGuide(guide);
    let afterPoints;
    if (Array.isArray(raw?.afterPoints) && raw.afterPoints.length === POINT_COUNT) afterPoints = clonePoints(raw.afterPoints, beforePoints);
    else if (Array.isArray(raw?.splinePoints) && raw.splinePoints.length === POINT_COUNT) afterPoints = clonePoints(raw.splinePoints, beforePoints);
    else {
      const rotations = legacyRotations(raw);
      const falloff = clamp(finite(raw?.weightFalloff ?? raw?.curveFalloff, 0), 0, 1);
      afterPoints = Array.from({ length: POINT_COUNT }, (_, index) => {
        const t = index / (POINT_COUNT - 1), source = beforePoints[index], target = legacyCurveCenter(guide, t, rotations), legacyWeight = 1 - falloff * (1 - t);
        return { x: source.x + (target.x - source.x) * legacyWeight, y: source.y + (target.y - source.y) * legacyWeight };
      });
    }
    return attachShoulderMaps({
      enabled: raw?.enabled !== false,
      useSpline: raw?.useSpline !== undefined ? !!raw.useSpline : raw?.enabled === true,
      useRun1: !!raw?.useRun1,
      splitFrame: !!raw?.splitFrame,
      splitRightUsesIdle: !!raw?.splitRightUsesIdle,
      frameShiftX,
      separatorRotationDeg: clamp(finite(raw?.separatorRotationDeg, 0), -180, 180),
      separatorAspect: Math.max(1e-6, finite(raw?.separatorAspect, 1)),
      followFrameShiftX,
      beforePoints,
      afterPoints,
      migratedFromLegacy: true,
    }, raw);
  }

  function normalizeRest(rawRig) {
    const raw = rawRig?.shoulderRest ?? rawRig;
    if (!raw || raw.enabled === false) return null;
    if (!Array.isArray(raw.beforePoints) || raw.beforePoints.length !== POINT_COUNT || !Array.isArray(raw.afterPoints) || raw.afterPoints.length !== POINT_COUNT) return migrateLegacyRest(raw);
    const fallback = linearPointsForGuide(DEFAULT_GUIDE), beforePoints = clonePoints(raw.beforePoints, fallback), afterPoints = clonePoints(raw.afterPoints, beforePoints);
    return attachShoulderMaps({
      enabled: true,
      useSpline: !!raw.useSpline,
      useRun1: !!raw.useRun1,
      splitFrame: !!raw.splitFrame,
      splitRightUsesIdle: !!raw.splitRightUsesIdle,
      frameShiftX: clamp(finite(raw.frameShiftX, DEFAULT_FRAME_SHIFT_X), 0, 1),
      separatorRotationDeg: clamp(finite(raw.separatorRotationDeg, 0), -180, 180),
      separatorAspect: Math.max(1e-6, finite(raw.separatorAspect, 1)),
      followFrameShiftX: raw.followFrameShiftX !== false,
      beforePoints,
      afterPoints,
      migratedFromLegacy: false,
    }, raw);
  }

  function catmullRomComponent(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function splinePoint(points, t) {
    const q = clamp(finite(t, 0), 0, 1) * (POINT_COUNT - 1);
    const segment = Math.min(POINT_COUNT - 2, Math.floor(q)), localT = q - segment;
    const i0 = Math.max(0, segment - 1), i1 = segment, i2 = Math.min(POINT_COUNT - 1, segment + 1), i3 = Math.min(POINT_COUNT - 1, segment + 2);
    const p0 = points[i0], p1 = points[i1], p2 = points[i2], p3 = points[i3];
    return { x: catmullRomComponent(p0.x, p1.x, p2.x, p3.x, localT), y: catmullRomComponent(p0.y, p1.y, p2.y, p3.y, localT) };
  }
  function splineTangent(points, t) {
    const epsilon = 1 / 4096;
    const a = splinePoint(points, Math.max(0, t - epsilon)), b = splinePoint(points, Math.min(1, t + epsilon));
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  }
  function imageAspect(value) { return Math.max(1e-6, finite(value, 1)); }
  function splinePointMetric(points, t, aspect) {
    const p = splinePoint(points, t), a = imageAspect(aspect);
    return { x: p.x * a, y: p.y };
  }
  function splineTangentMetric(points, t, aspect) {
    const epsilon = 1 / 4096;
    const a = splinePointMetric(points, Math.max(0, t - epsilon), aspect), b = splinePointMetric(points, Math.min(1, t + epsilon), aspect);
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  }
  function dot(ax, ay, bx, by) { return ax * bx + ay * by; }
  function distanceSquared(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

  function bindFrameForPoint(beforePoints, point, aspectOverride = 1) {
    const aspect = imageAspect(aspectOverride);
    const p = { x: finite(point?.x, 0) * aspect, y: finite(point?.y, 0) };
    const start = splinePointMetric(beforePoints, 0, aspect), end = splinePointMetric(beforePoints, 1, aspect);
    const startTangent = splineTangentMetric(beforePoints, 0, aspect), endTangent = splineTangentMetric(beforePoints, 1, aspect);
    const startNormal = { x: -startTangent.y, y: startTangent.x }, endNormal = { x: -endTangent.y, y: endTangent.x };
    const startAlong = dot(p.x - start.x, p.y - start.y, startTangent.x, startTangent.y);
    if (startAlong < 0) {
      return {
        t: 0, center: start, tangent: startTangent, normal: startNormal, aspect,
        alongOffset: startAlong,
        signedOffset: dot(p.x - start.x, p.y - start.y, startNormal.x, startNormal.y),
      };
    }
    const endAlong = dot(p.x - end.x, p.y - end.y, endTangent.x, endTangent.y);
    if (endAlong > 0) {
      return {
        t: 1, center: end, tangent: endTangent, normal: endNormal, aspect,
        alongOffset: endAlong,
        signedOffset: dot(p.x - end.x, p.y - end.y, endNormal.x, endNormal.y),
      };
    }
    const samples = 96;
    let bestT = 0, bestD = Infinity;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples, center = splinePointMetric(beforePoints, t, aspect), d = distanceSquared(center, p);
      if (d < bestD) { bestD = d; bestT = t; }
    }
    let lo = Math.max(0, bestT - 1 / samples), hi = Math.min(1, bestT + 1 / samples);
    for (let i = 0; i < 9; i++) {
      const t1 = lo + (hi - lo) / 3, t2 = hi - (hi - lo) / 3;
      const d1 = distanceSquared(splinePointMetric(beforePoints, t1, aspect), p), d2 = distanceSquared(splinePointMetric(beforePoints, t2, aspect), p);
      if (d1 <= d2) hi = t2; else lo = t1;
    }
    const t = (lo + hi) / 2, center = splinePointMetric(beforePoints, t, aspect), tangent = splineTangentMetric(beforePoints, t, aspect), normal = { x: -tangent.y, y: tangent.x };
    return { t, center, tangent, normal, aspect, alongOffset: 0, signedOffset: dot(p.x - center.x, p.y - center.y, normal.x, normal.y) };
  }

  function metricPointAtBind(points, bind, aspectOverride = 1) {
    const aspect = imageAspect(aspectOverride);
    const center = splinePointMetric(points, bind.t, aspect), tangent = splineTangentMetric(points, bind.t, aspect), normal = { x: -tangent.y, y: tangent.x };
    const along = finite(bind.alongOffset, 0), signedOffset = finite(bind.signedOffset, 0);
    return {
      x: center.x + tangent.x * along + normal.x * signedOffset,
      y: center.y + tangent.y * along + normal.y * signedOffset,
    };
  }
  function pointAtBind(points, bind, aspectOverride = 1) {
    const aspect = imageAspect(aspectOverride), p = metricPointAtBind(points, bind, aspect);
    return { x: p.x / aspect, y: p.y };
  }
  function metricPointAtOffset(points, t, signedOffset, aspectOverride = 1) {
    const aspect = imageAspect(aspectOverride), center = splinePointMetric(points, t, aspect), tangent = splineTangentMetric(points, t, aspect), normal = { x: -tangent.y, y: tangent.x };
    return { x: center.x + normal.x * signedOffset, y: center.y + normal.y * signedOffset };
  }
  function pointAtOffset(points, t, signedOffset, aspectOverride = 1) {
    const aspect = imageAspect(aspectOverride), p = metricPointAtOffset(points, t, signedOffset, aspect);
    return { x: p.x / aspect, y: p.y };
  }

  function shoulderResponseKind(rest, bind) {
    if (!rest || !bind) return 'neutral';
    const aspect = imageAspect(rest.separatorAspect);
    const epsilon = 1 / 1024, t0 = Math.max(0, bind.t - epsilon), t1 = Math.min(1, bind.t + epsilon);
    if (t1 - t0 < 1e-7) return 'neutral';
    const before0 = metricPointAtOffset(rest.beforePoints, t0, bind.signedOffset, aspect), before1 = metricPointAtOffset(rest.beforePoints, t1, bind.signedOffset, aspect);
    const after0 = metricPointAtOffset(rest.afterPoints, t0, bind.signedOffset, aspect), after1 = metricPointAtOffset(rest.afterPoints, t1, bind.signedOffset, aspect);
    const beforeSpan = Math.hypot(before1.x - before0.x, before1.y - before0.y), afterSpan = Math.hypot(after1.x - after0.x, after1.y - after0.y);
    if (beforeSpan < 1e-8) return 'neutral';
    const ratio = afterSpan / beforeSpan;
    if (ratio > 1 + RESPONSE_EPSILON) return 'stretch';
    if (ratio < 1 - RESPONSE_EPSILON) return 'compress';
    return 'neutral';
  }

  function deformationDetails(point, restLike) {
    const rest = restLike?._shoulderMaps ? restLike : normalizeRest(restLike), source = { x: finite(point?.x, 0), y: finite(point?.y, 0) };
    if (!rest || rest.beforePoints?.length !== POINT_COUNT || rest.afterPoints?.length !== POINT_COUNT) return { source, target: source, bind: null, kind: 'neutral', rest };
    const aspect = imageAspect(rest.separatorAspect);
    const bind = bindFrameForPoint(rest.beforePoints, source, aspect);
    if (!bind) return { source, target: source, bind: null, kind: 'neutral', rest };
    const target = pointAtBind(rest.afterPoints, bind, aspect);
    return { source, target, bind, kind: shoulderResponseKind(rest, bind), rest };
  }
  function deformNormalizedPoint(point, restLike) { return deformationDetails(point, restLike).target; }
  function deformWeightedPoint(point, headInfluence, restLike) {
    const details = deformationDetails(point, restLike), { source, target, kind, rest } = details;
    if (!rest?.useSpline || !details.bind) return source;
    const maps = rest._shoulderMaps || {};
    const shoulderInfluence = sampleShoulderInfluence(maps.influence, source.x, source.y, rest);
    const compressibility = sampleShoulderMaterial(maps.compressibility, maps.influence, source.x, source.y, rest, shoulderInfluence);
    const stretchability = sampleShoulderMaterial(maps.stretchability, maps.influence, source.x, source.y, rest, shoulderInfluence);
    const responseWeight = kind === 'compress' ? compressibility : kind === 'stretch' ? stretchability : shoulderInfluence;
    const bodyWeight = Math.min(shoulderInfluence, responseWeight) * (1 - clamp(finite(headInfluence, 0), 0, 1));
    return { x: source.x + (target.x - source.x) * bodyWeight, y: source.y + (target.y - source.y) * bodyWeight };
  }

  function sampleHeadInfluence(normalizedRig, u, topV) {
    const map = normalizedRig?.weightMap;
    if (map?.values) {
      const fx = clamp(u, 0, 1) * Math.max(0, map.width - 1), fy = clamp(topV, 0, 1) * Math.max(0, map.height - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(map.width - 1, x0 + 1), y1 = Math.min(map.height - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      const unset = window.AnimalHeadRigRuntime?.UNSET_WEIGHT ?? UNSET_WEIGHT;
      const at = (x, y) => { const value = map.values[y * map.width + x]; return value === unset ? 0 : clamp(value, 0, 255) / 255; };
      const row0 = at(x0, y0) * (1 - tx) + at(x1, y0) * tx, row1 = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
      return clamp(row0 * (1 - ty) + row1 * ty, 0, 1);
    }
    const region = normalizedRig?.legacyRegion;
    if (!region) return 0;
    return u >= region.x && u <= region.x + region.width && topV >= region.y && topV <= region.y + region.height ? 1 : 0;
  }

  function findRiggedMeshForBone(group, bone) {
    if (!group || !bone) return null;
    return (group.children || []).find(child => child?.isSkinnedMesh && child.skeleton?.bones?.includes?.(bone) && !child.userData?.hobunjiShoulderSplitOverlay) || null;
  }
  function dimensionsForGeometry(geometry) {
    const params = geometry?.parameters || {};
    let width = finite(params.width, 0), height = finite(params.height, 0);
    if (width > 0 && height > 0) return { width, height };
    geometry?.computeBoundingBox?.();
    const box = geometry?.boundingBox;
    width = Math.abs(finite(box?.max?.x, 0) - finite(box?.min?.x, 0)); height = Math.abs(finite(box?.max?.y, 0) - finite(box?.min?.y, 0));
    return { width: Math.max(width, 1e-6), height: Math.max(height, 1e-6) };
  }
  function buildMeshState(mesh, normalizedRig, rest, mirrorX) {
    const geometry = mesh?.geometry, position = geometry?.getAttribute?.('position'), uv = geometry?.getAttribute?.('uv');
    if (!position || !uv || position.count !== uv.count) return null;
    const dimensions = dimensionsForGeometry(geometry), basePositions = new Float32Array(position.array), headInfluences = new Float32Array(position.count), canonicalPoints = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
      const sourceU = mirrorX ? 1 - uv.getX(i) : uv.getX(i), sourceTopV = 1 - uv.getY(i);
      canonicalPoints[i * 2] = sourceU; canonicalPoints[i * 2 + 1] = sourceTopV; headInfluences[i] = sampleHeadInfluence(normalizedRig, sourceU, sourceTopV);
    }
    return { mesh, position, basePositions, headInfluences, canonicalPoints, dimensions, rest, mirrorX };
  }
  function applyMeshState(meshState, enabled) {
    if (!meshState) return false;
    const { position, basePositions, headInfluences, canonicalPoints, dimensions, rest, mirrorX, mesh } = meshState;
    for (let i = 0; i < position.count; i++) {
      const offset = i * position.itemSize, baseX = basePositions[offset], baseY = basePositions[offset + 1];
      let x = baseX, y = baseY;
      if (enabled && rest.useSpline) {
        const source = { x: canonicalPoints[i * 2], y: canonicalPoints[i * 2 + 1] }, target = deformWeightedPoint(source, headInfluences[i], rest), targetLocalU = mirrorX ? 1 - target.x : target.x;
        x = (targetLocalU - 0.5) * dimensions.width; y = (0.5 - target.y) * dimensions.height;
      }
      position.array[offset] = x; position.array[offset + 1] = y; if (position.itemSize > 2) position.array[offset + 2] = basePositions[offset + 2];
    }
    position.needsUpdate = true; mesh.geometry.computeBoundingBox?.(); mesh.geometry.computeBoundingSphere?.(); return true;
  }

  function cloneMaterialForOverlay(material) {
    const clone = material?.clone?.() || material;
    if (!clone) return clone;
    clone.transparent = true; clone.needsUpdate = true; return clone;
  }
  function cloneOverlayMesh(THREE, source, suffix) {
    if (!source?.geometry || !source?.skeleton || !source?.parent) return null;
    const geometry = source.geometry.clone(), sharedSkinWeight = source.geometry.getAttribute?.('skinWeight'), sharedSkinIndex = source.geometry.getAttribute?.('skinIndex');
    if (sharedSkinWeight) geometry.setAttribute('skinWeight', sharedSkinWeight); if (sharedSkinIndex) geometry.setAttribute('skinIndex', sharedSkinIndex);
    const material = Array.isArray(source.material) ? source.material.map(cloneMaterialForOverlay) : cloneMaterialForOverlay(source.material), overlay = new THREE.SkinnedMesh(geometry, material);
    overlay.name = `${source.name || 'animal'}_${suffix}`; overlay.position.copy(source.position); overlay.quaternion.copy(source.quaternion); overlay.scale.copy(source.scale); overlay.renderOrder = source.renderOrder || 0; overlay.frustumCulled = source.frustumCulled;
    overlay.userData = { ...source.userData, hobunjiShoulderSplitOverlay: true }; overlay.onBeforeRender = source.onBeforeRender; overlay.bindMode = source.bindMode; overlay.bind(source.skeleton, source.bindMatrix?.clone?.() || source.bindMatrix); overlay.visible = false; source.parent.add(overlay);
    return { mesh: overlay, geometry, material, textures: [] };
  }
  function materialsFor(layer) { if (!layer?.material) return []; return Array.isArray(layer.material) ? layer.material : [layer.material]; }
  function copyTextureTransform(texture, template) {
    if (!texture || !template) return texture;
    texture.wrapS = template.wrapS; texture.wrapT = template.wrapT; texture.magFilter = template.magFilter; texture.minFilter = template.minFilter; texture.flipY = template.flipY; texture.premultiplyAlpha = template.premultiplyAlpha; texture.generateMipmaps = template.generateMipmaps; texture.anisotropy = template.anisotropy; texture.rotation = template.rotation || 0; texture.repeat?.copy?.(template.repeat); texture.offset?.copy?.(template.offset); texture.center?.copy?.(template.center); if ('colorSpace' in template) texture.colorSpace = template.colorSpace; if ('encoding' in template) texture.encoding = template.encoding; texture.needsUpdate = true; return texture;
  }
  function setLayerCanvas(THREE, layer, canvas) {
    if (!layer || !canvas) return false;
    for (const old of layer.textures) old?.dispose?.(); layer.textures.length = 0;
    for (const material of materialsFor(layer)) { const texture = copyTextureTransform(new THREE.CanvasTexture(canvas), material?.map); material.map = texture; material.needsUpdate = true; layer.textures.push(texture); }
    return true;
  }
  function disposeLayer(layer) { if (!layer) return; layer.mesh?.parent?.remove?.(layer.mesh); for (const texture of layer.textures || []) texture?.dispose?.(); for (const material of materialsFor(layer)) material?.dispose?.(); layer.geometry?.dispose?.(); }

  function decorateAvatar(THREE, avatarRef, rawRig) {
    const rest = normalizeRest(rawRig);
    if (!rest || !avatarRef?.headRig || avatarRef.shoulderRest?.version === 9) return avatarRef;
    const normalizedRig = window.AnimalHeadRigRuntime?.normalizeRig?.(rawRig) || null;
    if (!normalizedRig) return avatarRef;
    const rigState = avatarRef.headRig, frontMesh = rest.useSpline || rest.splitFrame ? findRiggedMeshForBone(avatarRef.group, rigState.frontHeadBone) : null, backMesh = rest.useSpline || rest.splitFrame ? findRiggedMeshForBone(avatarRef.group, rigState.backHeadBone) : null;
    const front = rest.useSpline ? buildMeshState(frontMesh, normalizedRig, rest, false) : null, back = rest.useSpline ? buildMeshState(backMesh, normalizedRig, rest, true) : null;
    const frontOverlay = rest.splitFrame ? cloneOverlayMesh(THREE, frontMesh, 'split_left_front') : null, backOverlay = rest.splitFrame ? cloneOverlayMesh(THREE, backMesh, 'split_left_back') : null;
    const debug = { version: 10, authored: true, enabled: false, useSpline: rest.useSpline, useRun1: rest.useRun1, splitFrame: rest.splitFrame, splitRightUsesIdle: rest.splitRightUsesIdle, frameShiftX: rest.frameShiftX, separatorRotationDeg: rest.separatorRotationDeg, separatorAspect: rest.separatorAspect, followFrameShiftX: rest.followFrameShiftX, beforePoints: rest.beforePoints, afterPoints: rest.afterPoints, shoulderMaps: { influence: !!rest._shoulderMaps?.influence, compressibility: !!rest._shoulderMaps?.compressibility, stretchability: !!rest._shoulderMaps?.stretchability }, migratedFromLegacy: rest.migratedFromLegacy, fullRectangularStrip: true, layeredSplitFrame: !!(frontOverlay && backOverlay), frontVertices: front?.position?.count || 0, backVertices: back?.position?.count || 0 };

    avatarRef.setShoulderRestEnabled = enabled => {
      const next = !!enabled && rest.useSpline && !!front && !!back;
      if (debug.enabled !== next) { applyMeshState(front, next); applyMeshState(back, next); debug.enabled = next; avatarRef.group.userData.hobunjiShoulderRest = debug; }
      if (!enabled) avatarRef.setShoulderSplitOverlayEnabled?.(false); return next;
    };
    avatarRef.setShoulderSplitOverlayCanvas = (canvas, visible = true) => {
      const appliedFront = setLayerCanvas(THREE, frontOverlay, canvas), appliedBack = setLayerCanvas(THREE, backOverlay, canvas), next = !!visible && !!canvas && appliedFront && appliedBack;
      if (frontOverlay?.mesh) frontOverlay.mesh.visible = next; if (backOverlay?.mesh) backOverlay.mesh.visible = next; debug.splitOverlayVisible = next; return next;
    };
    avatarRef.setShoulderSplitOverlayEnabled = enabled => {
      const next = !!enabled && !!frontOverlay && !!backOverlay;
      if (frontOverlay?.mesh) frontOverlay.mesh.visible = next; if (backOverlay?.mesh) backOverlay.mesh.visible = next; debug.splitOverlayVisible = next; return next;
    };
    const previousDispose = typeof avatarRef.dispose === 'function' ? avatarRef.dispose.bind(avatarRef) : null;
    avatarRef.dispose = () => { disposeLayer(frontOverlay); disposeLayer(backOverlay); if (previousDispose) previousDispose(); };
    avatarRef.shoulderRest = debug; avatarRef.group.userData.hobunjiShoulderRest = debug; return avatarRef;
  }

  function install() {
    const api = window.PNGPlaneAvatar;
    if (!api?.buildAnimalPlaneAvatarModel || api.__animalShoulderSplineInstalledV10) return false;
    const priorBuild = api.buildAnimalPlaneAvatarModel.bind(api);
    api.buildAnimalPlaneAvatarModel = function shoulderSplineAwareAnimalBuild(THREE, spriteUrl, options = {}) {
      const profiles = window.HobunjiShoulderSplineProfiles, resolvedRig = profiles?.resolveForOptions?.(options, spriteUrl) || options?.headRig || null;
      const buildOptions = resolvedRig && resolvedRig !== options?.headRig ? { ...options, headRig: resolvedRig } : options;
      const avatarRef = priorBuild(THREE, spriteUrl, buildOptions), rawRig = buildOptions?.headRig || profiles?.resolveForOptions?.(buildOptions, spriteUrl) || null;
      return rawRig?.shoulderRest?.enabled ? decorateAvatar(THREE, avatarRef, rawRig) : avatarRef;
    };
    api.__animalShoulderSplineInstalledV10 = true; return true;
  }

  window.AnimalShoulderSpline = {
    version: 10,
    POINT_COUNT,
    UNSET_WEIGHT,
    normalizeRest,
    migrateLegacyRest,
    linearPointsForGuide,
    splinePoint,
    splineTangent,
    bindFrameForPoint,
    shoulderResponseKind,
    deformationDetails,
    deformNormalizedPoint,
    deformWeightedPoint,
    decodeWeightMap,
    shoulderDefaultInfluence,
    sampleShoulderInfluence,
    sampleShoulderMaterial,
    separatorSignedSide,
    separatorPointIsRight,
    separatorPolygon,
    sampleHeadInfluence,
    install,
  };
  window.AnimalShoulderRest = window.AnimalShoulderSpline;
  install();
})();
