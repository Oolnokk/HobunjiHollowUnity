from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'anchor missing in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))


# Make shared exact-span wall courses respect the same opening quads used by
# WallBuilder bricks. Each intersecting course is physically split into shorter
# foliage-generated source logs; no hidden/scaled geometry crosses the opening.
helper = r'''

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
'''
replace_once(
    'docs/js/stacked-log-walls.js',
    "  function panelCorners(THREE, panel) {",
    helper + "\n  function panelCorners(THREE, panel) {"
)
replace_once(
    'docs/js/stacked-log-walls.js',
    "    const meta = normalizeOptions(rawOptions); // Canonical authored log settings shared by every panel in this wall group.\n",
    "    const meta = normalizeOptions(rawOptions); // Canonical authored log settings shared by every panel in this wall group.\n    const exclusionQuads = Array.isArray(rawOptions?.excludeQuads) ? rawOptions.excludeQuads.filter(quad => Array.isArray(quad) && quad.length >= 3) : []; // Same world-space window/door cut polygons used by WallBuilder bricks.\n"
)
old_block = r'''        const generatedLength = safeSpan + meta.overhang * 2; // Final requested foliage spine length; no post-generation X scaling occurs.
        const seedVariant = courseIndex % 4; // Four repeating shapes keep straight walls varied while allowing same-length geometry reuse.
        const courseSeed = `${meta.seed}|${panel?.id || panelIndex}|${seedVariant}`; // Stable seed shared by runtime/editor for this wall/course variant.
        const prototype = prototypeFor(THREE, generatedLength, meta, courseSeed); // Exact-length foliage prototype, possibly reused from cache.
        const mesh = prototype.clone(); // Cheap Object3D clone shares immutable generated geometry/material buffers.
        const midpoint = new THREE.Vector3((centerSpan.a[0] + centerSpan.b[0]) * 0.5, centerY, (centerSpan.a[2] + centerSpan.b[2]) * 0.5); // World-space course center.
        const depthShift = (hashUnit(`${courseSeed}|depth`) * 2 - 1) * meta.rowDepthJitter; // Tiny deterministic in/out variation preventing machine-flat rows.
        midpoint.addScaledVector(normal, depthShift);
        const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction); // Rotates foliage generator's +X spine onto this wall chord.
        const roll = (hashUnit(`${courseSeed}|roll`) * 2 - 1) * meta.rowRollDeg * Math.PI / 180; // Deterministic per-row roll around the log's own axis.
        if (Math.abs(roll) > EPS) orientation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll));
        mesh.position.copy(midpoint);
        mesh.quaternion.copy(orientation);
        mesh.scale.set(1, 1, 1); // Deliberate: length already exists in generated geometry; never stretch a GLB/prototype to fit the wall.
        mesh.name = `StackedLog_${panel?.id || panelIndex}_${courseIndex}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.layers?.enable?.(1);
        mesh.userData = Object.assign({}, mesh.userData, {
          stackedLogWall: true,
          generatedLength,
          safeWallSpan: safeSpan,
          panelId: panel?.id || null,
          courseIndex,
          farmMaterialRole: 'wood',
          source: 'FoliageGenerator.buildLogMesh',
        });
        group.add(mesh);
        courseCount++;
        const diagnosticKey = `${Math.round(generatedLength * 10000) / 10000}|${seedVariant}`; // Build-local prototype variety key reported to debug UI.
        if (!usedKeys.has(diagnosticKey)) { usedKeys.add(diagnosticKey); uniqueSpanCount++; }
'''
new_block = r'''        const baseMidpoint = new THREE.Vector3((centerSpan.a[0] + centerSpan.b[0]) * 0.5, centerY, (centerSpan.a[2] + centerSpan.b[2]) * 0.5); // Unswayed world-space center used as the projection origin for opening cuts.
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
'''
replace_once('docs/js/stacked-log-walls.js', old_block, new_block)
replace_once(
    'docs/js/stacked-log-walls.js',
    "      latestChange: 'Each course is foliage-generated at its actual horizontal span; tapered walls and gables shorten the source geometry itself.',",
    "      openingCutCount: exclusionQuads.length,\n      latestChange: 'Each course is foliage-generated at its actual horizontal span and physically split around openings; tapered walls and gables shorten the source geometry itself.',"
)
replace_once(
    'docs/js/stacked-log-walls.js',
    "    latestChange: 'Stacked logs now regenerate at exact per-course spans through FoliageGenerator instead of scaling a GLB.',",
    "    latestChange: 'Stacked logs regenerate at exact per-course spans through FoliageGenerator and split into shorter generated pieces around openings instead of scaling/clipping a GLB.',"
)

# Exterior generated Highland houses already compute openingQuads for the brick
# path. Feed that identical geometry to the generated logs.
replace_once(
    'docs/js/HousePieceGen.js',
    "        const logSettings = Object.assign({}, opts.logWall || {}); // Generated foliage settings authored by the structure editor or caller.\n",
    "        const logSettings = Object.assign({}, opts.logWall || {}, { excludeQuads: openingQuads }); // Generated foliage settings plus the exact window/door cuts already used by WallBuilder bricks.\n"
)

# Interior base walls are pre-split by applyWallOpenings. Gable windows instead
# arrive as WallBuilder excludeQuads, so pass those into the log gable slicer.
replace_once(
    'docs/js/interior-ceilings.js',
    "        const logs = root.StackedLogWalls.buildGroup(THREE, gableLogPanels(data.gables, data.wallHeight), options.logWall || {}); // Exact-length source logs shorten automatically toward every gable apex.\n",
    "        const logOptions = Object.assign({}, options.logWall || {}, { excludeQuads: options.wallBuildOptions?.excludeQuads || [] }); // Reuse the same authored window/door cut quads that brick gables receive.\n        const logs = root.StackedLogWalls.buildGroup(THREE, gableLogPanels(data.gables, data.wallHeight), logOptions); // Exact-length source logs shorten automatically toward every gable apex and physically stop at openings.\n"
)

# Strengthen the regression contract for opening-aware source generation.
test_path = Path('scripts/test-stacked-log-walls.js')
test = test_path.read_text()
needle = "assert.doesNotMatch(stackedSource, /GLTFLoader|loadGlb|glbName/, 'stacked architecture has no baked-GLB dependency');\n"
addition = needle + "assert.match(stackedSource, /visibleSegmentsAroundOpenings/, 'stacked logs split real source geometry around wall openings');\nassert.match(stackedSource, /leftOverhang = touchesLeftWallEnd \? meta\.overhang : 0/, 'outside overhang is not allowed to extend a log into a window or door opening');\n"
if addition not in test:
    if needle not in test:
        raise SystemExit('test opening anchor missing')
    test = test.replace(needle, addition, 1)
needle2 = "assert.match(houseSource, /generatedLogStyle[\\s\\S]{0,1800}StackedLogWalls\\.buildGroup/, 'generated Highland structure walls use stacked foliage logs');\n"
addition2 = needle2 + "assert.match(houseSource, /excludeQuads: openingQuads/, 'generated exterior log walls inherit the same window and door cuts as brick walls');\n"
if addition2 not in test:
    test = test.replace(needle2, addition2, 1)
needle3 = "assert.match(ceilingsSource, /StackedLogWalls\\.buildGroup\\(THREE, gableLogPanels\\(data\\.gables, data\\.wallHeight\\), options\\.logWall \\|\\| \\{\\}\\)/, 'interior gable triangles feed the same exact-span generated log renderer');\n"
replacement3 = "assert.match(ceilingsSource, /gableLogPanels\\(data\\.gables, data\\.wallHeight\\)/, 'interior gable triangles feed the same exact-span generated log renderer');\nassert.match(ceilingsSource, /excludeQuads: options\\.wallBuildOptions\\?\\.excludeQuads \\|\\| \\[\\]/, 'interior log gables inherit authored window and door cuts');\n"
if needle3 in test:
    test = test.replace(needle3, replacement3, 1)
test_path.write_text(test)

print('Added opening-aware exact-length source-log splitting and matching regression coverage.')
