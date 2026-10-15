from pathlib import Path

stacked_path = Path('docs/js/stacked-log-walls.js')
source = stacked_path.read_text()

constant_anchor = "  const EDGE_SPAN_RECLAIM = 0.8; // Reclaims most of the old full-diameter gable inset so round courses visually reach sloped edges while retaining a small clipping guard.\n"
constant_insert = constant_anchor + "  const HORIZONTAL_FACE_NORMAL_Y = 0.92; // Faces this close to world-up/down are filled across their plane instead of being treated as zero-height vertical walls.\n"
if 'HORIZONTAL_FACE_NORMAL_Y' not in source:
    if constant_anchor not in source:
        raise SystemExit('missing stacked-log constant anchor')
    source = source.replace(constant_anchor, constant_insert, 1)

helper_anchor = "  function sharedMaterial(THREE, meta) {\n"
helper_block = '''  function planarSpanAtOffset(corners, origin, direction, across, offset) {
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

'''
if 'function horizontalWallCourses(' not in source:
    if helper_anchor not in source:
        raise SystemExit('missing sharedMaterial anchor')
    source = source.replace(helper_anchor, helper_block + helper_anchor, 1)

normal_anchor = """      const normal = panelNormal(THREE, corners); // Face normal used only for small deterministic depth jitter.
      const panelHeight = Math.max(EPS, maxY - minY); // Full vertical extent used to choose a dense course count before any radius inset can discard a row.
"""
horizontal_branch = """      const normal = panelNormal(THREE, corners); // Face normal used only for small deterministic depth jitter.
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
"""
if 'horizontalWallFace = Math.abs(normal.y)' not in source:
    if normal_anchor not in source:
        raise SystemExit('missing panel-normal branch anchor')
    source = source.replace(normal_anchor, horizontal_branch, 1)

source = source.replace(
    "      latestChange: 'Short gables now keep dense evenly distributed courses and reclaim conservative slope inset so logs fill near roof edges; every visible piece is still foliage-generated at its final source length.',",
    "      latestChange: 'Flat wall-tagged faces now fill with side-by-side exact-length foliage logs; upright walls and gables keep dense horizontal courses and slope-aware shortening.',",
    1,
)
source = source.replace(
    "    latestChange: 'Stacked logs regenerate at exact per-course spans; short gables use dense row packing and fuller slope coverage while openings still split source geometry.',",
    "    latestChange: 'Stacked logs regenerate at exact spans on upright, gabled, and horizontal wall-tagged faces; flat faces use side-by-side in-plane rows.',",
    1,
)

stacked_path.write_text(source)

test_path = Path('scripts/test-stacked-log-walls.js')
test_source = test_path.read_text()
test_anchor = "assert.doesNotMatch(stackedSource, /GLTFLoader|loadGlb|glbName/, 'stacked architecture has no baked-GLB dependency');\n"
test_insert = test_anchor + """assert.match(stackedSource, /HORIZONTAL_FACE_NORMAL_Y = 0\\.92/, 'near-horizontal wall-tagged faces have an explicit flat-face rendering path');
assert.match(stackedSource, /horizontalWallCourses\\(THREE, corners, meta, nominalPitch\\)/, 'flat wall faces are packed with side-by-side in-plane foliage rows');
assert.match(stackedSource, /Math\\.abs\\(normal\\.y\\) >= HORIZONTAL_FACE_NORMAL_Y/, 'flat top and bottom faces bypass world-Y wall slicing');
assert.match(stackedSource, /horizontalWallFace: true/, 'generated flat-face logs expose diagnostics identifying the horizontal-wall path');
"""
if 'near-horizontal wall-tagged faces have an explicit flat-face rendering path' not in test_source:
    if test_anchor not in test_source:
        raise SystemExit('missing stacked regression anchor')
    test_source = test_source.replace(test_anchor, test_insert, 1)
test_path.write_text(test_source)

old_token = 'stacked-log-walls.js?v=20261015stackedlogs1'
new_token = 'stacked-log-walls.js?v=20261015stackedlogs2'
replaced = 0
for path in Path('docs').rglob('*'):
    if not path.is_file():
        continue
    try:
        text = path.read_text()
    except UnicodeDecodeError:
        continue
    if old_token in text:
        path.write_text(text.replace(old_token, new_token))
        replaced += 1
if replaced == 0:
    raise SystemExit('no stacked-log cache token references updated')
print(f'patched horizontal wall faces; cache references updated in {replaced} file(s)')
