from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'Expected patch anchor not found in {path}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1))


def insert_before(path, anchor, content):
    p = Path(path)
    text = p.read_text()
    if content in text:
        return
    if anchor not in text:
        raise SystemExit(f'Expected insertion anchor not found in {path}: {anchor[:100]!r}')
    p.write_text(text.replace(anchor, content + anchor, 1))


# ---------------------------------------------------------------------------
# 1) Actual foliage-generator arbitrary-length log primitive.
# ---------------------------------------------------------------------------
foliage_helper = r'''
  // Arbitrary-length generated log used by stacked architecture, fallen logs,
  // and any other system that needs a real foliage spine rather than a scaled
  // baked cylinder. The caller supplies the FINAL world-space length.
  function buildGeneratedLogMesh(options = {}) {
    const length = Math.max(0.04, Number(options.length) || 1); // Final unscaled spine length requested by the wall/furniture caller.
    const diameter = Math.max(0.02, Number(options.logDiameter ?? options.diameter) || 0.34); // Final unscaled log diameter used directly by radiusFn.
    const radialSegments = Math.max(5, Math.min(32, Math.round(Number(options.radialSegments) || 8))); // Circumference resolution shared with wall recipes.
    const ringSegments = Math.max(4, Math.min(64, Math.round(Number(options.ringSegments) || 12))); // Longitudinal foliage-spine resolution shared with wall recipes.
    const seedText = String(options.seed ?? 'generated-log'); // Stable authored seed used by real foliage noise.
    const seedU32 = xfnv1a(seedText); // Real foliage-generator FNV seed, rather than a duplicate wall-only hash implementation.
    const taper = clamp(Number.isFinite(Number(options.trunkTaper)) ? Number(options.trunkTaper) : 0.99, 0.5, 1.2); // End radius multiplier applied continuously along the generated spine.
    const wonk = clamp(Number.isFinite(Number(options.trunkWonk ?? options.wonkiness)) ? Number(options.trunkWonk ?? options.wonkiness) : 0.18, 0, 3); // Centerline organic displacement strength.
    const wonkScale = Math.max(0.01, Number(options.trunkWonkScale ?? options.wonkScale) || 1.35); // Frequency of real foliage centerline noise.
    const twist = Number.isFinite(Number(options.trunkTwist)) ? Number(options.trunkTwist) : 0.08; // Axial twist passed straight to buildWonkyChain.
    const noiseAmt = clamp(Number.isFinite(Number(options.trunkNoise ?? options.surfaceNoise)) ? Number(options.trunkNoise ?? options.surfaceNoise) : 0.35, 0, 3); // Radial bark silhouette noise strength.
    const noiseScale = Math.max(0.01, Number(options.trunkNoiseScale ?? options.surfaceNoiseScale) || 2.2); // Radial bark noise scale.
    const noiseOctaves = Math.max(1, Math.min(6, Math.round(Number(options.trunkNoiseOctaves) || 3))); // Radial bark fBm octave count.
    const baseRadius = diameter * 0.5; // Final world-space radius used by every real generated course.
    const chain = buildWonkyChain({ // Existing foliage spine/tube implementation remains the geometry authority.
      seedU32,
      length,
      ringSegments,
      origin: new T.Vector3(-length * 0.5, 0, 0),
      direction: new T.Vector3(1, 0, 0),
      bend: 0,
      wonk,
      wonkScale,
      gravityDir: new T.Vector3(0, -1, 0),
      curl: 0,
      radiusFn: (t01) => baseRadius * lerp(1, taper, clamp01(t01)),
      radialSegments,
      twist,
      noiseAmt,
      noiseScale,
      noiseOctaves,
    });
    const sourcePosition = chain.geom.getAttribute('position'); // Side-only foliage vertices returned by buildWonkyChain before architectural caps/UVs are added.
    const positions = Array.from(sourcePosition.array); // Mutable side vertex copy used to lock the longitudinal span to the requested final length.

    // buildSpine intentionally lets its noise perturb the centerline in X as
    // well as Y/Z. Architecture needs exact endpoints, so keep the SAME real
    // foliage Y/Z wonk while removing only that axial drift. The two endpoint
    // rings are additionally flattened onto exact X cap planes.
    for (let ring = 0; ring < ringSegments; ring++) {
      const t01 = ringSegments <= 1 ? 0 : ring / (ringSegments - 1); // Normalized ring position used to restore its authored axial center.
      const targetX = -length * 0.5 + length * t01; // Exact final center X of this ring; no post-generation mesh scaling required.
      const sourceCenterX = chain.spine.pts[ring].x; // Foliage spine's noisy axial center before architecture correction.
      const correctionX = targetX - sourceCenterX; // Axial-only correction that leaves foliage lateral wonk untouched.
      for (let side = 0; side < radialSegments; side++) {
        const vertex = (ring * radialSegments + side) * 3; // Position-array offset for this side vertex.
        positions[vertex] += correctionX;
        if (ring === 0 || ring === ringSegments - 1) positions[vertex] = targetX; // Flat end rings guarantee exact cap planes at +/- length/2.
      }
    }

    const uvs = []; // Cylindrical side UVs followed by planar cap UVs, matching WoodCutSurfaces.remapLogAtlasUv's layout contract.
    for (let ring = 0; ring < ringSegments; ring++) {
      const t01 = ringSegments <= 1 ? 0 : ring / (ringSegments - 1); // Side U coordinate running along the actual generated length.
      for (let side = 0; side < radialSegments; side++) uvs.push(t01, side / radialSegments);
    }
    const indices = Array.from(chain.geom.index.array); // Existing real foliage side triangles retained verbatim before caps are appended.
    for (const ring of [0, ringSegments - 1]) {
      const sideStart = ring * radialSegments; // Source perimeter ring used by this exposed cut end.
      const capStart = positions.length / 3; // First duplicated perimeter vertex for this hard-normal cap.
      let centerY = 0; // Average perimeter Y used as the planar cap fan center.
      let centerZ = 0; // Average perimeter Z used as the planar cap fan center.
      const centerX = ring === 0 ? -length * 0.5 : length * 0.5; // Exact architectural end plane for this cut face.
      for (let side = 0; side < radialSegments; side++) {
        const source = (sideStart + side) * 3; // Side-ring vertex offset copied into the independent cap surface.
        positions.push(positions[source], positions[source + 1], positions[source + 2]);
        centerY += positions[source + 1];
        centerZ += positions[source + 2];
        const angle = side / radialSegments * Math.PI * 2; // Disk angle used for log.png planar UVs.
        uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
      }
      centerY /= radialSegments;
      centerZ /= radialSegments;
      const centerIndex = positions.length / 3; // Fan center index shared by every triangle on this cap.
      positions.push(centerX, centerY, centerZ);
      uvs.push(0.5, 0.5);
      for (let side = 0; side < radialSegments; side++) {
        const current = capStart + side; // Current duplicated perimeter vertex.
        const next = capStart + (side + 1) % radialSegments; // Next duplicated perimeter vertex.
        if (ring === 0) indices.push(centerIndex, next, current);
        else indices.push(centerIndex, current, next);
      }
    }

    let geometry = new T.BufferGeometry(); // Complete sides+caps generated geometry returned to architecture/furniture callers.
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.userData = { ...(geometry.userData || {}), foliageGeneratedLog: true, requestedLength: length, ringSegments, radialSegments };

    const barkColor = new T.Color(options.barkColor ?? '#6d472d'); // Canonical bark tint accepted as CSS hex, integer, or THREE.Color-compatible input.
    const barkHex = `#${barkColor.getHexString()}`; // Hex form consumed by shared tree PNG atlas helpers.
    const wood = typeof window !== 'undefined' ? window.WoodCutSurfaces : null; // Optional shared PNG/cap material bridge present in game and architecture editors.
    let material = options.material || null; // Optional caller-shared atlas material avoids one texture canvas per unique course length.
    if (options.useWoodAtlas !== false && wood?.remapLogAtlasUv && wood?.makeLogAtlasMaterial) {
      geometry = wood.remapLogAtlasUv(geometry, { ringSegments, radialSegments });
      if (!material) material = wood.makeLogAtlasMaterial(T, barkHex);
    }
    if (!material) material = hexBarkMat(barkHex);

    const mesh = new T.Mesh(geometry, material); // Final foliage-generated log; callers may rotate/translate but must not length-scale it.
    mesh.name = 'FoliageGeneratedLog';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      ...(mesh.userData || {}),
      foliageGeneratedLog: true,
      generatedLength: length,
      seed: seedText,
      logDiameter: diameter,
      noLongitudinalScaling: true,
      latestChange: 'Real buildWonkyChain foliage geometry generated at final requested length with cut-wood caps.',
    };
    return mesh;
  }

'''
insert_before('docs/js/foliage-generator.js', '  function degToRad(d) { return d * Math.PI / 180; }\n', foliage_helper)
replace_once(
    'docs/js/foliage-generator.js',
    "  return {\n    getClimbBranchWorld,\n    buildNeedlegrainMesh(growth01, col, row) {",
    "  return {\n    getClimbBranchWorld,\n    buildLogMesh(options) {\n      return buildGeneratedLogMesh(options);\n    },\n    buildNeedlegrainMesh(growth01, col, row) {"
)

# LogWallExtension keeps its compatibility fallback, but uses the real foliage
# generator whenever that runtime is present.
replace_once(
    'docs/js/log-wall-extension.js',
    "  function createLogGeometry(THREE, raw) {\n    if (!THREE) throw new Error('LogWallExtension.createLogGeometry requires THREE.');\n    const meta = normalizeLogMeta(raw); // Canonical foliage-style parameters used to generate this reusable log prototype.\n    const seed = hashStringToUint32(meta.seed); // Deterministic integer seed shared with the export path.",
    "  function createLogGeometry(THREE, raw) {\n    if (!THREE) throw new Error('LogWallExtension.createLogGeometry requires THREE.');\n    const meta = normalizeLogMeta(raw); // Canonical foliage-style parameters used to generate this reusable log prototype.\n    const foliage = (typeof window !== 'undefined' ? window.FoliageGenerator : globalThis?.FoliageGenerator); // Real foliage generator preferred whenever the runtime/tool has published it.\n    if (typeof foliage?.buildLogMesh === 'function') {\n      const mesh = foliage.buildLogMesh({ // One-unit compatibility prototype delegates its actual shape to buildWonkyChain rather than the old wall-only duplicate.\n        length: 1, logDiameter: 1, seed: meta.seed, trunkTaper: meta.trunkTaper, trunkWonk: meta.trunkWonk,\n        trunkWonkScale: meta.trunkWonkScale, trunkTwist: meta.trunkTwist, trunkNoise: meta.trunkNoise,\n        trunkNoiseScale: meta.trunkNoiseScale, trunkNoiseOctaves: meta.trunkNoiseOctaves, radialSegments: meta.radialSegments,\n        ringSegments: meta.ringSegments, barkColor: meta.barkColor, useWoodAtlas: false,\n      });\n      if (mesh?.geometry) {\n        const geometry = mesh.geometry; // Generated foliage geometry handed to the existing WallBuilder prototype/material pipeline.\n        mesh.material?.dispose?.();\n        geometry.userData = { ...(geometry.userData || {}), logWallFoliageAuthority: true };\n        return geometry;\n      }\n    }\n    const seed = hashStringToUint32(meta.seed); // Compatibility fallback used only by isolated tools that have not loaded FoliageGenerator."
)

# ---------------------------------------------------------------------------
# 2) Game bootstrap publishes StackedLogWalls before structures are built.
# ---------------------------------------------------------------------------
stack_loader = r'''
  // Stacked architectural log walls are length-generated by FoliageGenerator.
  // This helper can load before foliage itself; it resolves that API only when
  // a house/interior actually asks it to build, after normal game boot.
  (function loadStackedLogWalls() {
    if (typeof document === 'undefined') return;
    const src = 'js/stacked-log-walls.js?v=20261015stackedlogs1'; // Shared exact-span architecture renderer for exterior/interior log walls.
    if (window.StackedLogWalls || document.querySelector('script[data-stacked-log-walls]')) return;
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}" data-stacked-log-walls="1"><\\/script>`);
      return;
    }
    const script = document.createElement('script'); // Late-load fallback for nested game boot paths that import FormatUtils after parsing.
    script.src = src;
    script.dataset.stackedLogWalls = '1';
    document.head.appendChild(script);
  })();

'''
insert_before('docs/js/format-utils.js', '  // Small formatting/math helpers extracted out of game.js following the\n', stack_loader)

# ---------------------------------------------------------------------------
# 3) Exterior HousePieceGen: logs are a first-class wall construction mode.
# ---------------------------------------------------------------------------
replace_once(
    'docs/js/HousePieceGen.js',
    "    var hideWalls = !!opts.wallBuilder;\n",
    "    var logWallStyle = ['log', 'logs', 'stackedlogs', 'stacked-logs'].includes(String(opts.wallStyle || '').toLowerCase()); // Generated-log mode hides the base wall planes just like WallBuilder bricks.\n    var hideWalls = !!opts.wallBuilder || (logWallStyle && !!global.StackedLogWalls?.buildGroup);\n"
)
replace_once(
    'docs/js/HousePieceGen.js',
    "    // WallBuilder bricks on frustum body walls + gable end triangles\n    if (opts.wallBuilder) {\n",
    "    // Brick or generated-log cladding on frustum body walls + gable ends.\n    var generatedLogStyle = ['log', 'logs', 'stackedlogs', 'stacked-logs'].includes(String(opts.wallStyle || '').toLowerCase()); // Exterior construction selector shared with authored pieces.\n    if (opts.wallBuilder || (generatedLogStyle && global.StackedLogWalls?.buildGroup)) {\n"
)
replace_once(
    'docs/js/HousePieceGen.js',
    "      var wbUse   = opts.wbUsePlaceholder !== false;\n      var wbExtra = opts.wbOpts || { unitMult: 0.4375, rockScale: 1.5,\n                                     preScale: [1, 1, 0.6],\n                                     brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };\n\n      var wbGroup = opts.wallBuilder.build(bodyPanels, Object.assign({ usePlaceholder: wbUse, excludeQuads: openingQuads }, wbExtra));\n      wbGroup.userData.isWallBricks = true;\n      _markOutlineLayer(wbGroup);\n      group.add(wbGroup);\n\n      // Gable triangles are smaller — use denser, smaller bricks so they fill properly.\n      var gableExtra = opts.wbGableOpts || Object.assign({}, wbExtra, { unitMult: 0.396, densityMult: 1.5, rockScale: 1.1 });\n      var gableGroup = opts.wallBuilder.build(gablePanels, Object.assign({ usePlaceholder: wbUse }, gableExtra));\n      gableGroup.userData.isWallBricks = true;\n      _markOutlineLayer(gableGroup);\n      group.add(gableGroup);\n",
    "      if (generatedLogStyle && global.StackedLogWalls?.buildGroup) {\n        const logSettings = Object.assign({}, opts.logWall || {}); // Generated foliage settings authored by the structure editor or caller.\n        const logGroup = global.StackedLogWalls.buildGroup(THREE, bodyPanels.concat(gablePanels), logSettings); // One real exact-length foliage mesh per course; gable/taper spans shorten naturally.\n        logGroup.userData.isWallLogs = true;\n        _markOutlineLayer(logGroup);\n        group.add(logGroup);\n      } else if (opts.wallBuilder) {\n        var wbUse   = opts.wbUsePlaceholder !== false;\n        var wbExtra = opts.wbOpts || { unitMult: 0.4375, rockScale: 1.5,\n                                       preScale: [1, 1, 0.6],\n                                       brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };\n\n        var wbGroup = opts.wallBuilder.build(bodyPanels, Object.assign({ usePlaceholder: wbUse, excludeQuads: openingQuads }, wbExtra));\n        wbGroup.userData.isWallBricks = true;\n        _markOutlineLayer(wbGroup);\n        group.add(wbGroup);\n\n        // Gable triangles are smaller — use denser, smaller bricks so they fill properly.\n        var gableExtra = opts.wbGableOpts || Object.assign({}, wbExtra, { unitMult: 0.396, densityMult: 1.5, rockScale: 1.1 });\n        var gableGroup = opts.wallBuilder.build(gablePanels, Object.assign({ usePlaceholder: wbUse }, gableExtra));\n        gableGroup.userData.isWallBricks = true;\n        _markOutlineLayer(gableGroup);\n        group.add(gableGroup);\n      }\n"
)

# Authored piece renderer reads the style/settings from the piece itself, so
# normal game/map/editor callers do not need a new argument.
replace_once(
    'docs/js/HousePieceGen.js',
    "    if (piece && piece.currentPiece) piece = piece.currentPiece;\n    var faces   = (piece.base && piece.base.faces) ? piece.base.faces : [];\n",
    "    if (piece && piece.currentPiece) piece = piece.currentPiece;\n    var authoredWallStyle = String(opts.wallStyle || piece?.wallStyle || piece?.base?.wallStyle || '').toLowerCase(); // Serialized structure wall construction selected in House Editor.\n    var authoredLogSettings = Object.assign({}, piece?.base?.logWall || {}, piece?.logWall || {}, opts.logWall || {}); // Piece-level foliage log settings with caller override support.\n    var generatedLogMode = ['log', 'logs', 'stackedlogs', 'stacked-logs'].includes(authoredWallStyle) && !!global.StackedLogWalls?.buildGroup; // True only when the real generated-log renderer is available.\n    var faces   = (piece.base && piece.base.faces) ? piece.base.faces : [];\n"
)
replace_once(
    'docs/js/HousePieceGen.js',
    "    var hideWalls = !!opts.wallBuilder;\n\n    for (var i = 0; i < faces.length; i++) {",
    "    var hideWalls = !!opts.wallBuilder || generatedLogMode; // Either bricks or generated logs replace authored wall face planes.\n\n    for (var i = 0; i < faces.length; i++) {"
)
replace_once(
    'docs/js/HousePieceGen.js',
    "    // WallBuilder bricks on body walls and gable triangles\n    if (opts.wallBuilder) {\n      var wbUse   = opts.wbUsePlaceholder !== false;\n",
    "    // Authored body/gable walls can use exact-length generated foliage logs instead of bricks.\n    if (generatedLogMode) {\n      var authoredLogGroup = global.StackedLogWalls.buildGroup(THREE, bodyPanels.concat(gablePanels), authoredLogSettings); // Horizontal courses are regenerated to each face's actual span, including gables.\n      authoredLogGroup.userData.isWallLogs = true;\n      _markOutlineLayer(authoredLogGroup);\n      group.add(authoredLogGroup);\n    } else if (opts.wallBuilder) {\n      var wbUse   = opts.wbUsePlaceholder !== false;\n"
)

# ---------------------------------------------------------------------------
# 4) Interior shared renderer + gable renderer.
# ---------------------------------------------------------------------------
replace_once(
    'docs/js/interior-scene-builder.js',
    "  // wallStyle dispatch — brick (default, via WallBuilder) / cavern / canvas.\n",
    "  // wallStyle dispatch — brick (default) / generated stacked logs / cavern / canvas.\n"
)
replace_once(
    'docs/js/interior-scene-builder.js',
    "    const farmColors = buildOptions.farmNaturalColors; // Farm-only finish never leaks into the WallBuilder options or other interiors.\n    delete buildOptions.farmNaturalColors;\n    const finishWalls = group => { // Uses the same semantic stone role and shader as farm exterior bricks.\n      markInteriorWallSurfaceGroup(group);\n      if (farmColors) {\n        group.traverse(mesh => { if (mesh.isMesh) mesh.userData.farmMaterialRole = 'stone'; });\n",
    "    const farmColors = buildOptions.farmNaturalColors; // Farm-only finish never leaks into the WallBuilder options or other interiors.\n    delete buildOptions.farmNaturalColors;\n    const logWall = buildOptions.logWall || {}; // Serialized foliage-log settings consumed only by the generated-log wall style.\n    delete buildOptions.logWall;\n    const generatedLogStyle = ['log', 'logs', 'stackedlogs', 'stacked-logs'].includes(String(wallStyle || '').toLowerCase()); // Interior wall construction selector shared with the editor.\n    const finishWalls = group => { // Uses the same semantic farm material role as the selected wall construction.\n      markInteriorWallSurfaceGroup(group);\n      if (farmColors) {\n        const farmRole = generatedLogStyle ? 'wood' : 'stone'; // Log cabins inherit the farm's natural wood finish; brick walls retain natural stone.\n        group.traverse(mesh => { if (mesh.isMesh) mesh.userData.farmMaterialRole = farmRole; });\n"
)
replace_once(
    'docs/js/interior-scene-builder.js',
    "    if (wallStyle === 'canvas') return markInteriorWallSurfaceGroup(buildCanvasWalls(THREE, renderPanels));\n    if (wallBuilder) {\n",
    "    if (wallStyle === 'canvas') return markInteriorWallSurfaceGroup(buildCanvasWalls(THREE, renderPanels));\n    if (generatedLogStyle && root.StackedLogWalls?.buildGroup) {\n      try { return finishWalls(root.StackedLogWalls.buildGroup(THREE, renderPanels, logWall)); }\n      catch (e) { console.warn('InteriorSceneBuilder.buildWallGroup: generated log build failed, using fallback boxes: ' + e.message); }\n    }\n    if (wallBuilder && !generatedLogStyle) {\n"
)

# Interior gable panels carry explicit triangle corners so the shared slicer
# derives shorter final source lengths as each course approaches the ridge.
gable_log_helper = r'''
  // Explicit triangle polygons for generated-log gable ends. StackedLogWalls
  // slices these at each course Y, so source geometry gets shorter toward the
  // ridge instead of scaling a rectangular GLB and clipping it afterward.
  function gableLogPanels(gables, wallHeight) {
    return gables.map(g => {
      const mid = (g.from + g.to) / 2; // Horizontal ridge coordinate of this triangular gable.
      const horizontal = g.side === 'north' || g.side === 'south'; // Selects X- or Z-running wall coordinates.
      const a = horizontal ? [g.from, wallHeight, g.line] : [g.line, wallHeight, g.from]; // Left/base gable corner.
      const b = horizontal ? [g.to, wallHeight, g.line] : [g.line, wallHeight, g.to]; // Right/base gable corner.
      const peak = horizontal ? [mid, wallHeight + g.rise, g.line] : [g.line, wallHeight + g.rise, mid]; // Gable apex used by horizontal span slicing.
      return {
        id: `gable_log_${g.side}_${g.line}_${g.from}`,
        width: g.to - g.from,
        height: g.rise,
        position: [0, 0, 0],
        rotationDeg: [0, 0, 0],
        corners: [a, b, peak, peak],
      };
    });
  }

'''
insert_before('docs/js/interior-ceilings.js', '  // options: { floor (Set or [[c,r]]), wallHeight, ceiling, wallStyle,\n', gable_log_helper)
replace_once(
    'docs/js/interior-ceilings.js',
    "    // Brick (default-style) rooms get brick gable ends to match the walls\n    // below; canvas tents keep a cloth triangle.\n    const brickGables = !!options.wallBuilder && options.wallStyle !== 'canvas' && data.gables.length > 0;\n",
    "    // Brick rooms get brick gables; generated-log rooms slice the actual triangle into progressively shorter foliage logs.\n    const generatedLogStyle = ['log', 'logs', 'stackedlogs', 'stacked-logs'].includes(String(options.wallStyle || '').toLowerCase()); // Same serialized wall construction selector used below the eave.\n    const logGables = generatedLogStyle && !!root.StackedLogWalls?.buildGroup && data.gables.length > 0; // Generated foliage gable path independent of WallBuilder.\n    const brickGables = !!options.wallBuilder && !generatedLogStyle && options.wallStyle !== 'canvas' && data.gables.length > 0;\n"
)
replace_once(
    'docs/js/interior-ceilings.js',
    "    group.userData.interiorCeiling = { enabled: data.enabled, material: kind, tint, wallHeight: data.wallHeight, maxY: data.maxY, gableCount: data.gableCount, brickGables };\n",
    "    group.userData.interiorCeiling = { enabled: data.enabled, material: kind, tint, wallHeight: data.wallHeight, maxY: data.maxY, gableCount: data.gableCount, brickGables, logGables };\n"
)
replace_once(
    'docs/js/interior-ceilings.js',
    "      const role = brickGables ? 'gable-backing' : 'gable';\n      const mesh = meshFrom(THREE, gable, brickGables\n        ? surfaceMaterial(THREE, 'backing', options.texturesBasePath, role, false, null)\n",
    "      const hasGeneratedCover = brickGables || logGables; // Both brick and circular-log gables retain a dark backing triangle behind tiny material gaps.\n      const role = hasGeneratedCover ? 'gable-backing' : 'gable';\n      const mesh = meshFrom(THREE, gable, hasGeneratedCover\n        ? surfaceMaterial(THREE, 'backing', options.texturesBasePath, role, false, null)\n"
)
insert_before(
    'docs/js/interior-ceilings.js',
    "    if (brickGables) {\n",
    "    if (logGables) {\n      try {\n        const logs = root.StackedLogWalls.buildGroup(THREE, gableLogPanels(data.gables, data.wallHeight), options.logWall || {}); // Exact-length source logs shorten automatically toward every gable apex.\n        logs.name = 'InteriorGableLogs';\n        logs.userData.interiorGableLogs = true;\n        group.add(logs);\n      } catch (error) {\n        console.warn('InteriorCeilings: generated log gable build failed, keeping backing gable ends:', error);\n      }\n    }\n"
)
replace_once(
    'docs/js/interior-ceilings.js',
    "    gableBrickPanels,\n    buildCeilingGroup,\n",
    "    gableBrickPanels,\n    gableLogPanels,\n    buildCeilingGroup,\n"
)

# ---------------------------------------------------------------------------
# 5) House Editor selectable/persisted construction style + log settings.
# ---------------------------------------------------------------------------
house_scripts_old = "<script src=\"../../js/WallBuilder.js\"></script>\n<script src=\"../../js/surface-stretch-uv-furniture.js?v=20261006h24ab7dd\"></script>\n<script src=\"../../js/HousePieceGen.js\"></script>"
house_scripts_new = "<script src=\"../../js/WallBuilder.js\"></script>\n<script src=\"../../js/foliage-generator.js\"></script>\n<script src=\"../../js/wood-cut-surfaces.js\"></script>\n<script src=\"../../js/stacked-log-walls.js\"></script>\n<script src=\"../../js/surface-stretch-uv-furniture.js?v=20261006h24ab7dd\"></script>\n<script src=\"../../js/HousePieceGen.js\"></script>"
replace_once('docs/tools/house-piece-author/index.html', house_scripts_old, house_scripts_new)

house_controls = r'''
      <div class="grid2">
        <div class="field"><label>Wall construction</label><select id="wallStyle"><option value="">Brick (default)</option><option value="logs">Stacked generated logs</option></select></div>
        <div class="field"><label>Log seed</label><input id="logWallSeed" value="cabin-log-1"></div>
      </div>
      <div class="grid3">
        <div class="field"><label>Log diameter</label><input id="logWallDiameter" type="number" min="0.08" step="0.01" value="0.34"></div>
        <div class="field"><label>Wonkiness</label><input id="logWallWonk" type="number" min="0" max="3" step="0.01" value="0.18"></div>
        <div class="field"><label>Course gap / overlap</label><input id="logWallGap" type="number" step="0.01" value="-0.03"></div>
      </div>
      <p class="hint">Stacked logs are generated by the real foliage spine at each course's final horizontal span. Tapered walls and gables therefore use shorter source logs instead of scaling a GLB.</p>
'''
insert_before('docs/tools/house-piece-author/index.html', '      <div class="grid2">\n        <div class="field"><label>Base shape preset</label>', house_controls)
replace_once(
    'docs/tools/house-piece-author/index.html',
    "$('groundY').value=state.piece.base.groundY; state.selectedFaceIds.clear();",
    "$('groundY').value=state.piece.base.groundY; $('wallStyle').value=state.piece.wallStyle||''; const loadedLogWall=state.piece.logWall||{}; $('logWallSeed').value=loadedLogWall.seed||'cabin-log-1'; $('logWallDiameter').value=finite(loadedLogWall.logDiameter,.34); $('logWallWonk').value=finite(loadedLogWall.trunkWonk,.18); $('logWallGap').value=finite(loadedLogWall.courseGap,-.03); state.selectedFaceIds.clear();"
)
replace_once(
    'docs/tools/house-piece-author/index.html',
    "state.piece.base.groundY=finite($('groundY').value,0); syncRoofFromInputs(); syncPieceFromSets(); }",
    "state.piece.base.groundY=finite($('groundY').value,0); state.piece.wallStyle=$('wallStyle').value||undefined; state.piece.logWall={seed:$('logWallSeed').value.trim()||'cabin-log-1',logDiameter:Math.max(.08,finite($('logWallDiameter').value,.34)),trunkWonk:Math.max(0,finite($('logWallWonk').value,.18)),courseGap:finite($('logWallGap').value,-.03)}; syncRoofFromInputs(); syncPieceFromSets(); }"
)
# Live preview reads piece fields itself; inputs still need to trigger rebuild/export.
insert_before(
    'docs/tools/house-piece-author/index.html',
    "$('applyGridBtn').addEventListener",
    "['wallStyle','logWallSeed','logWallDiameter','logWallWonk','logWallGap'].forEach(function(id){ const el=$(id); if(el) el.addEventListener('change',function(){ pushUndo('Change wall construction'); syncPieceFromInputs(); rebuildFaceMeshes(); refreshExport(); }); });\n"
)

# ---------------------------------------------------------------------------
# 6) Building Interior Editor selectable/persisted logs + shared preview path.
# ---------------------------------------------------------------------------
replace_once(
    'docs/tools/building-interior-author/index.html',
    '<option value="">Brick (default)</option>\n            <option value="cavern">',
    '<option value="">Brick (default)</option>\n            <option value="logs">Stacked generated logs</option>\n            <option value="cavern">'
)
interior_controls = r'''
        <div class="field"><label>Log seed</label><input id="logWallSeed" value="cabin-log-1"></div>
        <div class="field"><label>Log diameter</label><input id="logWallDiameter" type="number" min="0.08" step="0.01" value="0.34"></div>
        <div class="field"><label>Log wonkiness</label><input id="logWallWonk" type="number" min="0" max="3" step="0.01" value="0.18"></div>
        <div class="field"><label>Course gap / overlap</label><input id="logWallGap" type="number" step="0.01" value="-0.03"></div>
'''
insert_before('docs/tools/building-interior-author/index.html', '      </div>\n    </div>\n\n    <div class="section">\n      <h2>2. Grid canvas size</h2>', interior_controls + '      </div>\n    </div>\n\n    <div class="section">\n      <h2>2. Grid canvas size</h2>')
# The previous insertion deliberately replaces the closing anchor; remove duplicate generated close if any is handled by exact replacement above.

# Load real foliage + shared PNG/cap + span renderer before interior builders.
replace_once(
    'docs/tools/building-interior-author/index.html',
    '<script src="../../js/WallBuilder.js"></script>\n<script src="../../js/terrain-preview.js"></script>\n<script src="../../js/interior-scene-builder.js?v=20261013h2de9e2d"></script>',
    '<script src="../../js/WallBuilder.js"></script>\n<script src="../../js/foliage-generator.js"></script>\n<script src="../../js/wood-cut-surfaces.js"></script>\n<script src="../../js/stacked-log-walls.js"></script>\n<script src="../../js/terrain-preview.js"></script>\n<script src="../../js/interior-scene-builder.js?v=20261013h2de9e2d"></script>'
)
replace_once(
    'docs/tools/building-interior-author/index.html',
    "var wallGroup=InteriorSceneBuilder.buildWallGroup(THREE, wb, panels, interior.wallStyle, {usePlaceholder:!wbReady,wallOpenings:windowOpenings});",
    "var wallGroup=InteriorSceneBuilder.buildWallGroup(THREE, wb, panels, interior.wallStyle, {usePlaceholder:!wbReady,wallOpenings:windowOpenings,logWall:interior.logWall||{}});"
)
replace_once(
    'docs/tools/building-interior-author/index.html',
    "wallBuilder:wb,wallBuildOptions:{usePlaceholder:!wbReady,excludeQuads:InteriorSceneBuilder.openingExcludeQuads?InteriorSceneBuilder.openingExcludeQuads(windowOpenings):[]}});",
    "wallBuilder:wb,wallBuildOptions:{usePlaceholder:!wbReady,excludeQuads:InteriorSceneBuilder.openingExcludeQuads?InteriorSceneBuilder.openingExcludeQuads(windowOpenings):[]},logWall:interior.logWall||{}});"
)
replace_once(
    'docs/tools/building-interior-author/index.html',
    "if(child.userData.interiorGable||child.userData.interiorGableBricks) child.userData.biaInteriorWallGroup=true;",
    "if(child.userData.interiorGable||child.userData.interiorGableBricks||child.userData.interiorGableLogs) child.userData.biaInteriorWallGroup=true;"
)
replace_once(
    'docs/tools/building-interior-author/index.html',
    "$('wallStyle').addEventListener('change',function(){pushUndo(); state.interior.wallStyle=$('wallStyle').value||undefined; rebuild3D(); refreshExport();});",
    "$('wallStyle').addEventListener('change',function(){pushUndo(); state.interior.wallStyle=$('wallStyle').value||undefined; rebuild3D(); refreshExport();});\n['logWallSeed','logWallDiameter','logWallWonk','logWallGap'].forEach(function(id){ $(id).addEventListener('change',function(){ pushUndo(); state.interior.logWall={seed:$('logWallSeed').value.trim()||'cabin-log-1',logDiameter:Math.max(.08,finite($('logWallDiameter').value,.34)),trunkWonk:Math.max(0,finite($('logWallWonk').value,.18)),courseGap:finite($('logWallGap').value,-.03)}; rebuild3D(); refreshExport(); }); });"
)
replace_once(
    'docs/tools/building-interior-author/index.html',
    "$('wallStyle').value=i.wallStyle||'';\n  syncCeilingControls();",
    "$('wallStyle').value=i.wallStyle||''; const loadedLogWall=i.logWall||{}; $('logWallSeed').value=loadedLogWall.seed||'cabin-log-1'; $('logWallDiameter').value=finite(loadedLogWall.logDiameter,.34); $('logWallWonk').value=finite(loadedLogWall.trunkWonk,.18); $('logWallGap').value=finite(loadedLogWall.courseGap,-.03);\n  syncCeilingControls();"
)

# ---------------------------------------------------------------------------
# 7) Other editors/previews that consume HousePieceGen/InteriorSceneBuilder.
# ---------------------------------------------------------------------------
# Map Editor needs the same globals before HousePieceGen builds an authored log house.
replace_once(
    'docs/tools/map-editor/index.html',
    '<script src="../../js/WallBuilder.js"></script>\n<script src="../../js/surface-stretch-uv-furniture.js?v=20261006h24ab7dd"></script>\n<script src="../../js/HousePieceGen.js"></script>',
    '<script src="../../js/WallBuilder.js"></script>\n<script src="../../js/foliage-generator.js"></script>\n<script src="../../js/wood-cut-surfaces.js"></script>\n<script src="../../js/stacked-log-walls.js"></script>\n<script src="../../js/surface-stretch-uv-furniture.js?v=20261006h24ab7dd"></script>\n<script src="../../js/HousePieceGen.js"></script>'
)
# Cutscene Director already loads foliage; add the shared PNG/cap and stacked renderer immediately after it.
replace_once(
    'docs/tools/cutscene-director/index.html',
    '<script src="../../js/foliage-generator.js?v=20260712l"></script>\n<script src="../../js/terrain-preview.js',
    '<script src="../../js/foliage-generator.js?v=20260712l"></script>\n<script src="../../js/wood-cut-surfaces.js"></script>\n<script src="../../js/stacked-log-walls.js"></script>\n<script src="../../js/terrain-preview.js'
)

# ---------------------------------------------------------------------------
# 8) Regression contract: true foliage source + shrinking gable spans + both editors.
# ---------------------------------------------------------------------------
Path('scripts/test-stacked-log-walls.js').write_text(r'''\
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');
const stackedSource = read('docs/js/stacked-log-walls.js');
const foliageSource = read('docs/js/foliage-generator.js');
const logExtensionSource = read('docs/js/log-wall-extension.js');
const houseSource = read('docs/js/HousePieceGen.js');
const interiorSource = read('docs/js/interior-scene-builder.js');
const ceilingsSource = read('docs/js/interior-ceilings.js');
const houseEditorSource = read('docs/tools/house-piece-author/index.html');
const interiorEditorSource = read('docs/tools/building-interior-author/index.html');
const formatSource = read('docs/js/format-utils.js');

const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(stackedSource, context, { filename: 'stacked-log-walls.js' });
const api = context.StackedLogWalls;
assert(api, 'StackedLogWalls publishes its shared runtime API');

const triangle = [[0, 0, 0], [4, 0, 0], [2, 2, 0], [2, 2, 0]];
assert.equal(api.horizontalSpanAtY(triangle, 0.5).length, 3, 'gable course at y=.5 shortens from 4 to 3 world units');
assert.equal(api.horizontalSpanAtY(triangle, 1).length, 2, 'gable course at y=1 shortens to 2 world units');
assert.equal(api.horizontalSpanAtY(triangle, 1.5).length, 1, 'gable course near the ridge shortens to 1 world unit');

assert.match(foliageSource, /function buildGeneratedLogMesh\(options = \{\}\)/, 'FoliageGenerator owns a public arbitrary-length log builder');
assert.match(foliageSource, /const chain = buildWonkyChain\(/, 'generated architectural logs route through the existing real foliage spine implementation');
assert.match(foliageSource, /buildLogMesh\(options\)/, 'FoliageGenerator publishes buildLogMesh');
assert.match(foliageSource, /targetX = -length \* 0\.5 \+ length \* t01/, 'foliage logs lock their source spine to the requested final axial length');
assert.match(stackedSource, /foliage\.buildLogMesh\(/, 'stacked walls ask FoliageGenerator for each source log');
assert.match(stackedSource, /mesh\.scale\.set\(1, 1, 1\)/, 'stacked wall placement never length-scales generated source geometry');
assert.doesNotMatch(stackedSource, /GLTFLoader|loadGlb|glbName/, 'stacked architecture has no baked-GLB dependency');
assert.match(logExtensionSource, /FoliageGenerator[\s\S]{0,1000}buildLogMesh/, 'legacy live log-wall prototype delegates to FoliageGenerator when available');

assert.match(houseSource, /generatedLogStyle[\s\S]{0,1800}StackedLogWalls\.buildGroup/, 'generated Highland structure walls use stacked foliage logs');
assert.match(houseSource, /authoredWallStyle[\s\S]{0,3000}generatedLogMode/, 'authored house pieces persist/select generated log construction');
assert.match(interiorSource, /generatedLogStyle[\s\S]{0,1600}StackedLogWalls\.buildGroup/, 'interior base walls use the same generated log renderer');
assert.match(ceilingsSource, /function gableLogPanels[\s\S]{0,4000}StackedLogWalls\.buildGroup/, 'interior gables feed explicit triangle spans into the same generated log renderer');

assert.match(houseEditorSource, /<option value="logs">Stacked generated logs<\/option>/, 'House Editor exposes stacked generated logs as a wall construction choice');
assert.match(houseEditorSource, /state\.piece\.wallStyle=.*wallStyle/, 'House Editor serializes the wall construction choice');
assert.match(houseEditorSource, /state\.piece\.logWall=/, 'House Editor serializes log diameter/wonk/gap settings');
assert.match(interiorEditorSource, /<option value="logs">Stacked generated logs<\/option>/, 'Building Interior Editor exposes stacked generated logs');
assert.match(interiorEditorSource, /state\.interior\.logWall=/, 'Building Interior Editor serializes log settings');
assert.match(interiorEditorSource, /logWall:interior\.logWall/, 'Interior preview passes authored log settings through shared runtime builders');
assert.match(formatSource, /stacked-log-walls\.js/, 'main game bootstrap loads the shared exact-span stacked-log renderer');

console.log('stacked log wall integration regression checks passed');
''')

print('Wired foliage-generated stacked logs into structure and interior authoring/runtime paths.')
