// Shared span-driven stacked-log wall renderer.
//
// This is intentionally NOT a WallBuilder/GLB scaler. Every course asks the
// real FoliageGenerator for a log whose authored spine length already matches
// the horizontal space available at that height. Trapezoid walls and gables
// therefore get progressively shorter generated geometry instead of a stretched
// or squashed baked asset.
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({ // Fallback settings used when no serialized logWall payload exists.
    seed: 'cabin-log-1',
    logDiameter: 0.34,
    trunkTaper: 0.99,
    trunkWonk: 0.18,
    trunkWonkScale: 1.35,
    trunkTwist: 0.08,
    trunkNoise: 0.35,
    trunkNoiseScale: 2.2,
    trunkNoiseOctaves: 3,
    radialSegments: 8,
    ringSegments: 12,
    barkColor: '#372f18',
    overhang: 0.12,
    courseGap: -0.03,
    rowRollDeg: 1.5,
    rowDepthJitter: 0.012,
  });
  const prototypeCaches = new WeakMap(); // THREE namespace -> exact-length generated-log prototypes reused by matching wall courses.
  const materialCaches = new WeakMap(); // THREE namespace -> bark color -> shared PNG atlas material, avoiding one canvas texture per course length.
  const EPS = 1e-6; // Geometry tolerance shared by horizontal polygon intersection and point dedupe.
  const EDGE_SPAN_RECLAIM = 0.8; // Reclaims most of the old full-diameter gable inset so round courses visually reach sloped edges while retaining a small clipping guard.
  const HORIZONTAL_FACE_NORMAL_Y = 0.92; // Faces this close to world-up/down are filled across their plane instead of being treated as zero-height vertical walls.

  function finite(value, fallback) {
    const number = Number(value); // Normalized numeric setting used by every generated course.
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeHex(value, fallback) {
    const text = String(value || '').trim(); // Serialized bark tint kept stable across editor/runtime builds.
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
  }

  function normalizeOptions(raw) {
    const value = raw && typeof raw === 'object' ? raw : {}; // Authored logWall payload supplied by house/interior definitions.
    return {
      seed: String(value.seed ?? DEFAULTS.seed),
      logDiameter: Math.max(0.04, finite(value.logDiameter ?? value.width, DEFAULTS.logDiameter)),
      trunkTaper: clamp(finite(value.trunkTaper, DEFAULTS.trunkTaper), 0.5, 1.2),
      trunkWonk: clamp(finite(value.trunkWonk ?? value.wonkiness, DEFAULTS.trunkWonk), 0, 3),
      trunkWonkScale: Math.max(0.01, finite(value.trunkWonkScale ?? value.wonkScale, DEFAULTS.trunkWonkScale)),
      trunkTwist: finite(value.trunkTwist, DEFAULTS.trunkTwist),
      trunkNoise: clamp(finite(value.trunkNoise ?? value.surfaceNoise, DEFAULTS.trunkNoise), 0, 3),
      trunkNoiseScale: Math.max(0.01, finite(value.trunkNoiseScale ?? value.surfaceNoiseScale, DEFAULTS.trunkNoiseScale)),
      trunkNoiseOctaves: Math.max(1, Math.min(6, Math.round(finite(value.trunkNoiseOctaves, DEFAULTS.trunkNoiseOctaves)))),
      radialSegments: Math.max(5, Math.min(32, Math.round(finite(value.radialSegments, DEFAULTS.radialSegments)))),
      ringSegments: Math.max(4, Math.min(64, Math.round(finite(value.ringSegments, DEFAULTS.ringSegments)))),
      barkColor: normalizeHex(value.barkColor || value.woodColorHex, DEFAULTS.barkColor),
      overhang: Math.max(0, finite(value.overhang, DEFAULTS.overhang)),
      courseGap: finite(value.courseGap, DEFAULTS.courseGap),
      rowRollDeg: Math.max(0, finite(value.rowRollDeg, DEFAULTS.rowRollDeg)),
      rowDepthJitter: Math.max(0, finite(value.rowDepthJitter, DEFAULTS.rowDepthJitter)),
    };
  }

  function hashUnit(text) {
    let hash = 2166136261 >>> 0; // FNV-1a state used only for deterministic row roll/depth variation.
    const source = String(text ?? ''); // Stable seed text built from wall/panel/course identity.
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 1274126177) >>> 0;
    return (hash >>> 0) / 4294967296;
  }

  function dedupePoints(points) {
    const out = []; // Unique horizontal-plane intersections used to find the longest polygon chord.
    for (const point of points) {
      if (!out.some(existing => Math.hypot(existing[0] - point[0], existing[1] - point[1], existing[2] - point[2]) <= EPS)) out.push(point);
    }
    return out;
  }

  // Pure helper exposed for regression tests. corners are cyclic [x,y,z]
  // polygon points; the return value is the farthest XZ chord at world Y.
  function horizontalSpanAtY(cornersInput, yInput) {
    const corners = Array.isArray(cornersInput) ? cornersInput.filter(point => Array.isArray(point) && point.length >= 3) : []; // Cyclic wall polygon being sliced horizontally.
    const y = Number(yInput); // Horizontal slice height used by one stacked-log course.
    if (corners.length < 3 || !Number.isFinite(y)) return null;
    const hits = []; // Edge/plane intersections before duplicate polygon vertices are welded.
    for (let index = 0; index < corners.length; index++) {
      const a = corners[index]; // Current polygon edge start.
      const b = corners[(index + 1) % corners.length]; // Current polygon edge end.
      const ay = Number(a[1]), by = Number(b[1]); // Vertical edge endpoints used to test the slice.
      if (!Number.isFinite(ay) || !Number.isFinite(by)) continue;
      const dy = by - ay; // Edge vertical delta used for interpolation.
      if (Math.abs(dy) <= EPS) {
        if (Math.abs(y - ay) <= EPS) { hits.push([Number(a[0]), y, Number(a[2])], [Number(b[0]), y, Number(b[2])]); }
        continue;
      }
      const t = (y - ay) / dy; // Fraction along this edge where the horizontal slice lands.
      if (t < -EPS || t > 1 + EPS) continue;
      const clamped = Math.max(0, Math.min(1, t)); // Numeric guard keeps near-vertex hits inside the authored segment.
      hits.push([
        Number(a[0]) + (Number(b[0]) - Number(a[0])) * clamped,
        y,
        Number(a[2]) + (Number(b[2]) - Number(a[2])) * clamped,
      ]);
    }
    const points = dedupePoints(hits); // Unique chord candidates after adjacent edges meet at the same vertex.
    if (points.length < 2) return null;
    let bestA = null; // First endpoint of the longest horizontal chord.
    let bestB = null; // Second endpoint of the longest horizontal chord.
    let bestLength = -1; // XZ length used to choose the wall's actual available horizontal span.
    for (let aIndex = 0; aIndex < points.length; aIndex++) {
      for (let bIndex = aIndex + 1; bIndex < points.length; bIndex++) {
        const a = points[aIndex]; // Candidate chord start.
        const b = points[bIndex]; // Candidate chord end.
        const length = Math.hypot(b[0] - a[0], b[2] - a[2]); // Horizontal distance only; both points share the same Y.
        if (length > bestLength) { bestLength = length; bestA = a; bestB = b; }
      }
    }
    return bestLength > EPS ? { a: bestA, b: bestB, length: bestLength } : null;
  }

  function exclusionIntervalsAtCourse(quads, centerY, lowerY, upperY, midpoint, direction, halfSafeSpan) {
    const intervals = []; // Signed course-axis intervals occupied by windows/doors at any sampled height through this round log.
    for (const quad of quads) {
      let minAlong = Infinity; // Lowest projected opening edge across center/lower/upper samples.
      let maxAlong = -Infinity; // Highest projected opening edge across center/lower/upper samples.
      for (const sampleY of [centerY, lowerY, upperY]) {
        const span = horizontalSpanAtY(quad, sampleY); // Opening chord at this vertical sample; null means the opening does not overlap the course here.
        if (!span) continue;
        for (const point of [span.a, span.b]) {
          const along = (point[0] - midpoint.x) * direction.x + (point[2] - midpoint.z) * direction.z; // Opening endpoint projected onto the wall course axis.
          minAlong = Math.min(minAlong, along);
          maxAlong = Math.max(maxAlong, along);
        }
      }
      if (!Number.isFinite(minAlong) || !Number.isFinite(maxAlong)) continue;
      const start = Math.max(-halfSafeSpan, minAlong); // Opening clipped to this course's safe horizontal wall span.
      const end = Math.min(halfSafeSpan, maxAlong); // Opening clipped to this course's safe horizontal wall span.
      if (end - start > EPS) intervals.push({ start, end });
    }
    intervals.sort((a, b) => a.start - b.start);
    const merged = []; // Overlapping window/door cuts merged before visible log segments are derived.
    for (const interval of intervals) {
      const previous = merged[merged.length - 1]; // Last merged cut checked for overlap with the next opening.
      if (previous && interval.start <= previous.end + EPS) previous.end = Math.max(previous.end, interval.end);
      else merged.push({ start: interval.start, end: interval.end });
    }
    return merged;
  }

  function visibleSegmentsAroundOpenings(halfSafeSpan, exclusions) {
    const segments = []; // Remaining source-log axis ranges after windows/doors are removed.
    let cursor = -halfSafeSpan; // Leftmost unconsumed position on the safe wall course.
    for (const exclusion of exclusions) {
      if (exclusion.start > cursor + EPS) segments.push({ start: cursor, end: exclusion.start });
      cursor = Math.max(cursor, exclusion.end);
    }
    if (cursor < halfSafeSpan - EPS) segments.push({ start: cursor, end: halfSafeSpan });
    return segments;
  }

  function panelCorners(THREE, panel) {
    if (Array.isArray(panel?.corners) && panel.corners.length >= 3) return panel.corners.map(point => [Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0]);
    const width = Math.max(0.001, Number(panel?.width) || 0.001); // Canonical rectangular panel width used when no explicit polygon is supplied.
    const height = Math.max(0.001, Number(panel?.height) || 0.001); // Canonical rectangular panel height used when no explicit polygon is supplied.
    const position = Array.isArray(panel?.position) ? panel.position : [0, 0, 0]; // Floor-referenced panel transform shared with WallBuilder/InteriorSceneBuilder.
    const rotation = Array.isArray(panel?.rotationDeg) ? panel.rotationDeg : [0, 0, 0]; // Authored XYZ Euler degrees for a rectangular panel.
    const euler = new THREE.Euler(THREE.MathUtils.degToRad(rotation[0] || 0), THREE.MathUtils.degToRad(rotation[1] || 0), THREE.MathUtils.degToRad(rotation[2] || 0), 'XYZ'); // Rotation applied to local rectangle corners.
    const origin = new THREE.Vector3(Number(position[0]) || 0, Number(position[1]) || 0, Number(position[2]) || 0); // World-space bottom-center of the panel.
    const local = [[-width / 2, 0, 0], [width / 2, 0, 0], [width / 2, height, 0], [-width / 2, height, 0]]; // Cyclic rectangle in panel local space.
    return local.map(point => {
      const vector = new THREE.Vector3(point[0], point[1], point[2]).applyEuler(euler).add(origin); // Rotated/transformed wall corner used by horizontal slicing.
      return [vector.x, vector.y, vector.z];
    });
  }

  function panelNormal(THREE, corners) {
    const origin = new THREE.Vector3().fromArray(corners[0]); // First polygon point used as the normal origin.
    for (let index = 1; index < corners.length - 1; index++) {
      const edgeA = new THREE.Vector3().fromArray(corners[index]).sub(origin); // First candidate polygon edge.
      const edgeB = new THREE.Vector3().fromArray(corners[index + 1]).sub(origin); // Second candidate polygon edge.
      const normal = edgeA.cross(edgeB); // Candidate face normal used for tiny row-depth variation.
      if (normal.lengthSq() > EPS * EPS) return normal.normalize();
    }
    return new THREE.Vector3(0, 0, 1);
  }

  function planarSpanAtOffset(corners, origin, direction, across, offset) {
    const projected = corners.map(point => { // Horizontal face polygon projected into local along/across coordinates.
      const dx = Number(point[0]) - origin.x; // World-X delta from the face centroid used for local projection.
      const dz = Number(point[2]) - origin.z; // World-Z delta from the face centroid used for local projection.
      return { along: dx * direction.x + dz * direction.z, across: dx * across.x + dz * across.z };
    });
    const hits = []; // Along-axis intersections where this across-offset strip crosses polygon edges.
    for (let index = 0; index < projected.length; index++) {
      const a = projected[index]; // Current projected polygon edge start.
      const b = projected[(index + 1) % projected.length]; // Current projected polygon edge end.
      const deltaAcross = b.across - a.across; // Across-axis edge delta used to intersect this strip.
      if (Math.abs(deltaAcross) <= EPS) {
        if (Math.abs(offset - a.across) <= EPS) hits.push(a.along, b.along);
        continue;
      }
      const t = (offset - a.across) / deltaAcross; // Fraction along the edge where the strip intersects.
      if (t < -EPS || t > 1 + EPS) continue;
      const clamped = Math.max(0, Math.min(1, t)); // Numeric guard keeps near-vertex hits on the edge.
      hits.push(a.along + (b.along - a.along) * clamped);
    }
    const unique = []; // Deduped along-axis intersections after adjacent edges meet at one vertex.
    for (const value of hits) {
      if (!unique.some(existing => Math.abs(existing - value) <= EPS)) unique.push(value);
    }
    if (unique.length < 2) return null;
    const start = Math.min(...unique); // Leftmost usable point on this horizontal-face strip.
    const end = Math.max(...unique); // Rightmost usable point on this horizontal-face strip.
    return end - start > EPS ? { start, end, length: end - start } : null;
  }

  function horizontalWallCourses(THREE, corners, meta, nominalPitch) {
    const points = corners.map(point => new THREE.Vector3().fromArray(point)); // World-space horizontal face vertices used to derive a stable local basis.
    const origin = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length); // Face centroid used as the local strip origin.
    let direction = new THREE.Vector3(1, 0, 0); // In-plane log axis; replaced by the face's longest horizontal edge below.
    let longestEdge = 0; // Longest XZ edge length used to choose the most natural log direction.
    for (let index = 0; index < points.length; index++) {
      const edge = points[(index + 1) % points.length].clone().sub(points[index]); // Candidate polygon edge projected onto the horizontal plane.
      edge.y = 0;
      const edgeLength = edge.length(); // Candidate horizontal edge length used to select the log axis.
      if (edgeLength > longestEdge + EPS) {
        longestEdge = edgeLength;
        direction.copy(edge).normalize();
      }
    }
    if (longestEdge <= EPS) return { rows: [], pitch: 0 };
    const across = new THREE.Vector3(-direction.z, 0, direction.x).normalize(); // Perpendicular in-plane axis used to place side-by-side log rows.
    const offsets = corners.map(point => (Number(point[0]) - origin.x) * across.x + (Number(point[2]) - origin.z) * across.z); // Face extents along the row-stacking direction.
    const minAcross = Math.min(...offsets); // First polygon boundary across the chosen log direction.
    const maxAcross = Math.max(...offsets); // Opposite polygon boundary across the chosen log direction.
    const faceWidth = Math.max(0, maxAcross - minAcross); // Total in-plane width to cover with parallel log rows.
    if (faceWidth <= EPS) return { rows: [], pitch: 0 };
    const rowCount = Math.max(1, Math.ceil(faceWidth / nominalPitch)); // Enough rows that horizontal faces never have gaps wider than the authored course pitch.
    const pitch = faceWidth / rowCount; // Even side-by-side spacing across the horizontal face.
    const rows = []; // Exact source spans requested from FoliageGenerator for this horizontal wall face.
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const offset = minAcross + pitch * (rowIndex + 0.5); // Center of this side-by-side row within the face.
      const span = planarSpanAtOffset(corners, origin, direction, across, offset); // Exact polygon chord available to this row.
      if (!span || span.length < Math.max(0.04, meta.logDiameter * 0.2)) continue;
      const midpoint = origin.clone().addScaledVector(across, offset).addScaledVector(direction, (span.start + span.end) * 0.5); // World-space center of this exact in-plane chord.
      midpoint.y = origin.y;
      rows.push({ rowIndex, direction: direction.clone(), midpoint, length: span.length });
    }
    return { rows, pitch };
  }

  function sharedMaterial(THREE, meta) {
    const wood = root.WoodCutSurfaces; // Shared tree PNG/cut-face material authority when loaded by game/tools.
    if (!wood?.makeLogAtlasMaterial) return null;
    let byColor = materialCaches.get(THREE); // Per-THREE material cache prevents cross-realm Three.js objects from mixing.
    if (!byColor) { byColor = new Map(); materialCaches.set(THREE, byColor); }
    if (!byColor.has(meta.barkColor)) byColor.set(meta.barkColor, wood.makeLogAtlasMaterial(THREE, meta.barkColor));
    return byColor.get(meta.barkColor);
  }

  function prototypeFor(THREE, length, meta, seed) {
    const foliage = root.FoliageGenerator; // Actual foliage geometry authority; no GLB scaling fallback is allowed on the stacked-log path.
    if (typeof foliage?.buildLogMesh !== 'function') throw new Error('StackedLogWalls requires FoliageGenerator.buildLogMesh().');
    let cache = prototypeCaches.get(THREE); // Per-THREE exact-length prototype cache shared by every structure/interior rebuild in this page.
    if (!cache) { cache = new Map(); prototypeCaches.set(THREE, cache); }
    const lengthKey = Math.round(length * 10000) / 10000; // 0.1 mm quantization dedupes numerically-identical spans without visibly rescaling anything.
    const key = [lengthKey, seed, meta.logDiameter, meta.trunkTaper, meta.trunkWonk, meta.trunkWonkScale, meta.trunkTwist, meta.trunkNoise, meta.trunkNoiseScale, meta.trunkNoiseOctaves, meta.radialSegments, meta.ringSegments, meta.barkColor].join('|'); // Exact generated geometry/material identity.
    if (!cache.has(key)) {
      const material = sharedMaterial(THREE, meta); // Shared one-atlas bark/cut material reused across different generated lengths.
      const mesh = foliage.buildLogMesh({ // Real foliage log generated at its final requested world length.
        length: lengthKey,
        seed,
        logDiameter: meta.logDiameter,
        trunkTaper: meta.trunkTaper,
        trunkWonk: meta.trunkWonk,
        trunkWonkScale: meta.trunkWonkScale,
        trunkTwist: meta.trunkTwist,
        trunkNoise: meta.trunkNoise,
        trunkNoiseScale: meta.trunkNoiseScale,
        trunkNoiseOctaves: meta.trunkNoiseOctaves,
        radialSegments: meta.radialSegments,
        ringSegments: meta.ringSegments,
        barkColor: meta.barkColor,
        material,
        useWoodAtlas: true,
      });
      mesh.name = `StackedLogPrototype_${lengthKey}`;
      cache.set(key, mesh);
    }
    return cache.get(key);
  }

  function buildGroup(THREE, panelsInput, rawOptions) {
    const group = new THREE.Group(); // Final wall group containing one generated log mesh per visible course.
    group.name = 'StackedGeneratedLogWalls';
    const panels = Array.isArray(panelsInput) ? panelsInput.filter(Boolean) : []; // Wall polygons/rectangles supplied by house or interior renderers.
    const meta = normalizeOptions(rawOptions); // Canonical authored log settings shared by every panel in this wall group.
    const exclusionQuads = Array.isArray(rawOptions?.excludeQuads) ? rawOptions.excludeQuads.filter(quad => Array.isArray(quad) && quad.length >= 3) : []; // Same world-space window/door cut polygons used by WallBuilder bricks.
    const nominalPitch = Math.max(meta.logDiameter * 0.35, meta.logDiameter + meta.courseGap); // Maximum requested center-to-center spacing; each panel may tighten it slightly so short gables do not lose a whole course.
    let courseCount = 0; // Diagnostic count of generated visible log courses.
    let uniqueSpanCount = 0; // Diagnostic count of prototype keys actually requested by this build.
    const usedKeys = new Set(); // Build-local exact-length/variant keys used only for diagnostics.

    panels.forEach((panel, panelIndex) => {
      const corners = panelCorners(THREE, panel); // Actual world-space wall polygon, including taper/gable shape when authored corners exist.
      const ys = corners.map(point => point[1]); // Polygon heights used to bound stacked course centers.
      const minY = Math.min(...ys); // Lowest point of this wall polygon.
      const maxY = Math.max(...ys); // Highest point of this wall polygon.
      const normal = panelNormal(THREE, corners); // Face normal used only for small deterministic depth jitter.
      const horizontalWallFace = Math.abs(normal.y) >= HORIZONTAL_FACE_NORMAL_Y; // Outpost top/bottom wall faces need in-plane rows because their world-Y height is zero.
      if (horizontalWallFace) {
        const horizontalLayout = horizontalWallCourses(THREE, corners, meta, nominalPitch); // Side-by-side exact-span foliage rows covering this flat wall plane.
        horizontalLayout.rows.forEach(row => {
          const generatedLength = row.length + meta.overhang * 2; // Final source length including the same physical end overhang used by upright cabin walls.
          const courseSeed = `${meta.seed}|${panel?.id || panelIndex}|horizontal|${row.rowIndex}`; // Stable seed for each flat-face row.
          const prototype = prototypeFor(THREE, generatedLength, meta, courseSeed); // Exact-length foliage log; no post-generation axial scale.
          const mesh = prototype.clone(); // Object clone shares immutable generated geometry/material buffers.
          const midpoint = row.midpoint.clone(); // Flat-face chord center before the small normal-direction depth variation.
          const depthShift = (hashUnit(`${courseSeed}|depth`) * 2 - 1) * meta.rowDepthJitter; // Tiny deterministic offset above/below the authored plane.
          midpoint.addScaledVector(normal, depthShift);
          const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), row.direction); // Rotates foliage +X onto the selected in-plane log axis.
          const roll = (hashUnit(`${courseSeed}|roll`) * 2 - 1) * meta.rowRollDeg * Math.PI / 180; // Deterministic variation around the log's own axis.
          if (Math.abs(roll) > EPS) orientation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll));
          mesh.position.copy(midpoint);
          mesh.quaternion.copy(orientation);
          mesh.scale.set(1, 1, 1); // Flat faces still use final-length generated geometry instead of stretching a GLB/prototype.
          mesh.name = `StackedLog_${panel?.id || panelIndex}_horizontal_${row.rowIndex}`;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.layers?.enable?.(1);
          mesh.userData = Object.assign({}, mesh.userData, {
            stackedLogWall: true,
            horizontalWallFace: true,
            generatedLength,
            safeWallSpan: row.length,
            strictWallSpan: row.length,
            edgeSpanReclaim: 0,
            panelCoursePitch: horizontalLayout.pitch,
            panelId: panel?.id || null,
            courseIndex: row.rowIndex,
            segmentIndex: 0,
            splitAroundOpening: false,
            farmMaterialRole: 'wood',
            source: 'FoliageGenerator.buildLogMesh',
          });
          group.add(mesh);
          courseCount++;
          const diagnosticKey = `${Math.round(generatedLength * 10000) / 10000}|horizontal|${row.rowIndex % 4}`; // Build-local key exposing horizontal-face source-span variety.
          if (!usedKeys.has(diagnosticKey)) { usedKeys.add(diagnosticKey); uniqueSpanCount++; }
        });
        return;
      }
      const panelHeight = Math.max(EPS, maxY - minY); // Full vertical extent used to choose a dense course count before any radius inset can discard a row.
      const rowCount = Math.max(1, Math.ceil(panelHeight / nominalPitch)); // Guarantees actual spacing is never looser than the authored pitch, especially on short gables.
      const pitch = panelHeight / rowCount; // Even per-panel spacing centers the first/last round logs symmetrically inside the full wall/gable height.

      for (let courseIndex = 0; courseIndex < rowCount; courseIndex++) {
        const centerY = minY + pitch * (courseIndex + 0.5); // Dense center distribution prevents small triangular planes from losing an entire top/bottom course.
        const centerSpan = horizontalSpanAtY(corners, centerY); // Placement chord at the actual center of this course.
        if (!centerSpan) continue;
        const lowerY = Math.max(minY + EPS, centerY - meta.logDiameter * 0.45); // Lower silhouette sample used to keep thick logs inside sloped polygons.
        const upperY = Math.min(maxY - EPS, centerY + meta.logDiameter * 0.45); // Upper silhouette sample; usually the limiting width on gables/tapered walls.
        const lowerSpan = horizontalSpanAtY(corners, lowerY); // Available horizontal width near the bottom of the circular log.
        const upperSpan = horizontalSpanAtY(corners, upperY); // Available horizontal width near the top of the circular log.
        const strictSpan = Math.min(centerSpan.length, lowerSpan?.length ?? centerSpan.length, upperSpan?.length ?? centerSpan.length); // Old full-diameter containment width retained as the conservative reference.
        const safeSpan = strictSpan + (centerSpan.length - strictSpan) * EDGE_SPAN_RECLAIM; // Keep only a small portion of that inset; end overhang can now visually meet the roof slope instead of leaving large triangular gaps.
        if (safeSpan < Math.max(0.04, meta.logDiameter * 0.2)) continue; // Allow short ridge courses instead of dropping them solely because the gable is narrow.

        const direction = new THREE.Vector3(centerSpan.b[0] - centerSpan.a[0], 0, centerSpan.b[2] - centerSpan.a[2]); // Horizontal course direction derived from the center slice.
        if (direction.lengthSq() <= EPS * EPS) continue;
        direction.normalize();
        const baseMidpoint = new THREE.Vector3((centerSpan.a[0] + centerSpan.b[0]) * 0.5, centerY, (centerSpan.a[2] + centerSpan.b[2]) * 0.5); // Unswayed world-space center used as the projection origin for opening cuts.
        const halfSafeSpan = safeSpan * 0.5; // Symmetric safe wall extent around the center chord after gable/thickness clipping.
        const exclusions = exclusionIntervalsAtCourse(exclusionQuads, centerY, lowerY, upperY, baseMidpoint, direction, halfSafeSpan); // Window/door intervals overlapping this round log's vertical thickness.
        const visibleSegments = visibleSegmentsAroundOpenings(halfSafeSpan, exclusions); // One or more real source-log pieces remaining around those openings.
        const seedVariant = courseIndex % 4; // Four repeating shapes keep straight walls varied while allowing same-length geometry reuse.

        visibleSegments.forEach((segment, segmentIndex) => {
          const touchesLeftWallEnd = Math.abs(segment.start + halfSafeSpan) <= EPS * 10; // True only for the physical outside end of the whole wall chord.
          const touchesRightWallEnd = Math.abs(segment.end - halfSafeSpan) <= EPS * 10; // True only for the physical outside end of the whole wall chord.
          const leftOverhang = touchesLeftWallEnd ? meta.overhang : 0; // Cabin overhang is allowed outside the wall, never inward across a window/door cut.
          const rightOverhang = touchesRightWallEnd ? meta.overhang : 0; // Cabin overhang is allowed outside the wall, never inward across a window/door cut.
          const generatedLength = Math.max(0, segment.end - segment.start + leftOverhang + rightOverhang); // Final foliage source length for this visible piece; no post-generation X scale.
          if (generatedLength < Math.max(0.04, meta.logDiameter * 0.2)) return;
          const segmentCenterAlong = (segment.start + segment.end) * 0.5 + (rightOverhang - leftOverhang) * 0.5; // Axis offset including asymmetric outside-wall overhang.
          const courseSeed = `${meta.seed}|${panel?.id || panelIndex}|${seedVariant}|${segmentIndex}`; // Stable source seed differentiates pieces split around openings.
          const prototype = prototypeFor(THREE, generatedLength, meta, courseSeed); // Exact-length foliage prototype, possibly reused from cache.
          const mesh = prototype.clone(); // Cheap Object3D clone shares immutable generated geometry/material buffers.
          const midpoint = baseMidpoint.clone().addScaledVector(direction, segmentCenterAlong); // Visible piece center shifted along the course around openings.
          const depthShift = (hashUnit(`${courseSeed}|depth`) * 2 - 1) * meta.rowDepthJitter; // Tiny deterministic in/out variation preventing machine-flat rows.
          midpoint.addScaledVector(normal, depthShift);
          const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction); // Rotates foliage generator's +X spine onto this wall chord.
          const roll = (hashUnit(`${courseSeed}|roll`) * 2 - 1) * meta.rowRollDeg * Math.PI / 180; // Deterministic per-piece roll around the log's own axis.
          if (Math.abs(roll) > EPS) orientation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll));
          mesh.position.copy(midpoint);
          mesh.quaternion.copy(orientation);
          mesh.scale.set(1, 1, 1); // Deliberate: length already exists in generated geometry; never stretch a GLB/prototype to fit the wall.
          mesh.name = `StackedLog_${panel?.id || panelIndex}_${courseIndex}_${segmentIndex}`;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.layers?.enable?.(1);
          mesh.userData = Object.assign({}, mesh.userData, {
            stackedLogWall: true,
            generatedLength,
            safeWallSpan: safeSpan,
            strictWallSpan: strictSpan,
            edgeSpanReclaim: EDGE_SPAN_RECLAIM,
            panelCoursePitch: pitch,
            panelId: panel?.id || null,
            courseIndex,
            segmentIndex,
            splitAroundOpening: exclusions.length > 0,
            farmMaterialRole: 'wood',
            source: 'FoliageGenerator.buildLogMesh',
          });
          group.add(mesh);
          courseCount++;
          const diagnosticKey = `${Math.round(generatedLength * 10000) / 10000}|${seedVariant}|${segmentIndex}`; // Build-local prototype variety key reported to debug UI.
          if (!usedKeys.has(diagnosticKey)) { usedKeys.add(diagnosticKey); uniqueSpanCount++; }
        });
      }
    });

    group.userData = Object.assign({}, group.userData, {
      stackedLogWalls: true,
      panelCount: panels.length,
      courseCount,
      uniqueSpanCount,
      logWall: meta,
      source: 'FoliageGenerator.buildLogMesh',
      noGlbLengthScaling: true,
      openingCutCount: exclusionQuads.length,
      defaultLogColorHex: DEFAULTS.barkColor,
      gableEdgeSpanReclaim: EDGE_SPAN_RECLAIM,
      latestChange: 'Flat wall-tagged faces now fill with side-by-side exact-length foliage logs; upright walls and gables keep dense horizontal courses and slope-aware shortening.',
    });
    return group;
  }

  root.StackedLogWalls = Object.freeze({
    DEFAULTS,
    normalizeOptions,
    horizontalSpanAtY,
    buildGroup,
    latestChange: 'Stacked logs regenerate at exact spans on upright, gabled, and horizontal wall-tagged faces; flat faces use side-by-side in-plane rows.',
  });
})(typeof window !== 'undefined' ? window : globalThis);
