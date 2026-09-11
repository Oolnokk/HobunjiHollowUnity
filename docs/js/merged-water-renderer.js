(() => {
  'use strict';

  const DEFAULT_JOIN_THRESHOLD = 0.275;
  const DEFAULT_TEXTURE_TILE_SIZE = 4; // Used to repeat the water PNG across world X/Z coordinates.
  const DEFAULT_EXCEPTION_SURFACE_THRESHOLD = 0.01; // Used by inversion to decide when local surface height needs exception geometry.
  const DEFAULT_EXCEPTION_DEPTH_THRESHOLD = 0.04; // Used by inversion when color depth differs despite a near-identical surface height.
  const DEFAULT_EXCEPTION_COVERAGE_THRESHOLD = 0.04; // Used by inversion when opacity differs despite a near-identical surface height.
  const TEXTURE_SCROLL_U = 0.012; // Used by the shared shader to drift the tiled PNG sideways.
  const TEXTURE_SCROLL_V = 0.035; // Used by the shared shader to move the tiled PNG along world Z.
  const stats = Object.create(null); // Used by the in-game Debug panel and mobile bug reports.
  const lastLoggedCounts = new Map(); // Used to suppress duplicate rebuild log messages.

  function cellKey(col, row) { return `${col},${row}`; }

  function normalizeCells(cells) {
    const byKey = new Map(); // Used by classic corner smoothing below.
    for (const source of cells || []) {
      if (!source || !Number.isFinite(source.col) || !Number.isFinite(source.row) || !Number.isFinite(source.surfaceY)) continue;
      const cell = {
        col: source.col,
        row: source.row,
        surfaceY: source.surfaceY,
        depth: Math.max(0, Math.min(1, Number.isFinite(source.depth) ? source.depth : 1)),
        coverage: Math.max(0, Math.min(1, Number.isFinite(source.coverage)
          ? source.coverage
          : (Number.isFinite(source.depth) ? source.depth : 1))),
        flowX: Number.isFinite(source.flowX) ? source.flowX : 0,
        flowZ: Number.isFinite(source.flowZ) ? source.flowZ : 0,
        visible: source.visible !== false,
      };
      byKey.set(cellKey(cell.col, cell.row), cell);
    }
    return byKey;
  }

  function touchingCells(byKey, vertexX, vertexZ) {
    return [
      byKey.get(cellKey(vertexX, vertexZ)),
      byKey.get(cellKey(vertexX - 1, vertexZ)),
      byKey.get(cellKey(vertexX, vertexZ - 1)),
      byKey.get(cellKey(vertexX - 1, vertexZ - 1)),
    ].filter(cell => cell && cell.visible !== false);
  }

  function areEdgeNeighbors(a, b) {
    return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
  }

  // Returns the surface height for one tile at one of its corners. Tiles only
  // share a corner component when they also share an edge and their water
  // surfaces are close enough to represent one continuous body. This makes
  // small simulation head differences slope cleanly while preserving real
  // steps between raised ground, ordinary ground, and dug trenches.
  function cornerHeightFor(cell, touching, joinThreshold) {
    const component = new Set([cell]); // Used to gather mutually connected water cells at this corner.
    let changed = true; // Used to continue expanding the local connected component until stable.
    while (changed) {
      changed = false;
      for (const candidate of touching) {
        if (component.has(candidate)) continue;
        for (const member of component) {
          if (areEdgeNeighbors(candidate, member)
              && Math.abs(candidate.surfaceY - member.surfaceY) <= joinThreshold) {
            component.add(candidate);
            changed = true;
            break;
          }
        }
      }
    }
    let sum = 0; // Used to average the connected component into one shared corner height.
    for (const member of component) sum += member.surfaceY;
    return sum / component.size;
  }

  function emptySurfaceData(tileCount = 0) {
    return {
      positions: [],
      uvs: [],
      depths: [],
      coverages: [],
      flows: [],
      indices: [],
      tileCount,
      representation: 'tile-merged',
      baselineVisible: false,
      baselineDepth: null,
      baselineCoverage: null,
      baselineSurfaceY: null,
      baselineRectangles: 0,
      exceptionCount: 0,
      maskedCellCount: 0,
      inversionFallback: false,
    };
  }

  function appendCellQuad(data, cell, touchingByKey, joinThreshold, yOffset, textureTileSize) {
    const corners = [ // Used to emit this classic tile's four world-space water corners.
      [cell.col, cell.row],
      [cell.col + 1, cell.row],
      [cell.col, cell.row + 1],
      [cell.col + 1, cell.row + 1],
    ];
    const vertexIndex = data.positions.length / 3; // Used by the two triangles appended after the four vertices.
    for (const [x, z] of corners) {
      const touching = touchingCells(touchingByKey, x, z); // Used to keep gentle water heads continuous across shared corners.
      const y = cornerHeightFor(cell, touching, joinThreshold) + yOffset; // Used as the rendered surface height for this corner.
      data.positions.push(x, y, z);
      data.uvs.push(x / textureTileSize, z / textureTileSize);
      data.depths.push(cell.depth);
      data.coverages.push(cell.coverage);
      data.flows.push(cell.flowX, cell.flowZ);
    }
    data.indices.push(
      vertexIndex, vertexIndex + 2, vertexIndex + 3,
      vertexIndex, vertexIndex + 3, vertexIndex + 1,
    );
  }

  function appendFlatRectangle(data, rectangle, baseline, yOffset, textureTileSize) {
    const x0 = rectangle.col; // Used as the rectangle's west edge in world-tile coordinates.
    const z0 = rectangle.row; // Used as the rectangle's north edge in world-tile coordinates.
    const x1 = x0 + rectangle.width; // Used as the rectangle's east edge after greedy merging.
    const z1 = z0 + rectangle.height; // Used as the rectangle's south edge after greedy merging.
    const vertexIndex = data.positions.length / 3; // Used by the baseline rectangle's two triangles.
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      data.positions.push(x, baseline.surfaceY + yOffset, z);
      data.uvs.push(x / textureTileSize, z / textureTileSize);
      data.depths.push(baseline.depth);
      data.coverages.push(baseline.coverage);
      data.flows.push(baseline.flowX, baseline.flowZ);
    }
    data.indices.push(
      vertexIndex, vertexIndex + 2, vertexIndex + 3,
      vertexIndex, vertexIndex + 3, vertexIndex + 1,
    );
  }

  function buildSurfaceData(cells, options = {}) {
    const byKey = normalizeCells(cells); // Used by classic tile geometry and corner smoothing.
    const joinThreshold = Number.isFinite(options.joinThreshold)
      ? Math.max(0, options.joinThreshold)
      : DEFAULT_JOIN_THRESHOLD;
    const yOffset = Number.isFinite(options.yOffset) ? options.yOffset : 0.015; // Used to prevent water/ground z-fighting.
    const textureTileSize = Math.max(0.001, Number.isFinite(options.textureTileSize)
      ? options.textureTileSize
      : DEFAULT_TEXTURE_TILE_SIZE); // Converts world coordinates into repeating texture-space units.
    let visibleCount = 0; // Used by stats for classic/fallback geometry.
    for (const cell of byKey.values()) if (cell.visible !== false) visibleCount++;
    const data = emptySurfaceData(visibleCount); // Receives the classic per-wet-tile merged geometry.
    for (const cell of byKey.values()) {
      if (cell.visible === false) continue;
      appendCellQuad(data, cell, byKey, joinThreshold, yOffset, textureTileSize);
    }
    return data;
  }

  function normalizeBaseline(options) {
    const source = options.baseline || {}; // Used to normalize WaterSystem's common weather-driven map level.
    const depth = Math.max(0, Math.min(1, Number.isFinite(source.depth) ? source.depth : 0)); // Used for baseline water color.
    const coverage = Math.max(0, Math.min(1, Number.isFinite(source.coverage) ? source.coverage : depth)); // Used for baseline opacity.
    return {
      visible: source.visible !== false && Number.isFinite(source.surfaceY) && coverage > 0,
      surfaceY: Number.isFinite(source.surfaceY) ? source.surfaceY : 0,
      depth,
      coverage,
      flowX: Number.isFinite(source.flowX) ? source.flowX : 0,
      flowZ: Number.isFinite(source.flowZ) ? source.flowZ : 0,
    };
  }

  function normalizeGrid(cells, cols, rows) {
    const grid = new Array(cols * rows); // Used by inversion for numeric O(1) lookup instead of string-key Maps.
    for (const source of cells || []) {
      if (!source || !Number.isFinite(source.col) || !Number.isFinite(source.row) || !Number.isFinite(source.surfaceY)) continue;
      const col = Math.floor(source.col); // Used to address this source cell in the dense inversion grid.
      const row = Math.floor(source.row); // Used to address this source cell in the dense inversion grid.
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
      const depth = Math.max(0, Math.min(1, Number.isFinite(source.depth) ? source.depth : 1)); // Used for local exception color and baseline comparison.
      grid[row * cols + col] = {
        col,
        row,
        surfaceY: source.surfaceY,
        depth,
        coverage: Math.max(0, Math.min(1, Number.isFinite(source.coverage) ? source.coverage : depth)),
        flowX: Number.isFinite(source.flowX) ? source.flowX : 0,
        flowZ: Number.isFinite(source.flowZ) ? source.flowZ : 0,
        visible: source.visible !== false,
      };
    }
    return grid;
  }

  function gridCell(grid, cols, rows, col, row) {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    return grid[row * cols + col] || null;
  }

  function touchingGridCells(grid, cols, rows, vertexX, vertexZ) {
    return [
      gridCell(grid, cols, rows, vertexX, vertexZ),
      gridCell(grid, cols, rows, vertexX - 1, vertexZ),
      gridCell(grid, cols, rows, vertexX, vertexZ - 1),
      gridCell(grid, cols, rows, vertexX - 1, vertexZ - 1),
    ].filter(cell => cell && cell.visible !== false);
  }

  function appendGridCellQuad(data, cell, grid, cols, rows, joinThreshold, yOffset, textureTileSize) {
    const corners = [ // Used to emit a wet exception while sampling only nearby dense-grid neighbors.
      [cell.col, cell.row],
      [cell.col + 1, cell.row],
      [cell.col, cell.row + 1],
      [cell.col + 1, cell.row + 1],
    ];
    const vertexIndex = data.positions.length / 3; // Used by this exception tile's two triangles.
    for (const [x, z] of corners) {
      const touching = touchingGridCells(grid, cols, rows, x, z); // Used to preserve old shared-corner slopes without string-key lookups.
      const y = cornerHeightFor(cell, touching, joinThreshold) + yOffset; // Used as the rendered exception-corner height.
      data.positions.push(x, y, z);
      data.uvs.push(x / textureTileSize, z / textureTileSize);
      data.depths.push(cell.depth);
      data.coverages.push(cell.coverage);
      data.flows.push(cell.flowX, cell.flowZ);
    }
    data.indices.push(
      vertexIndex, vertexIndex + 2, vertexIndex + 3,
      vertexIndex, vertexIndex + 3, vertexIndex + 1,
    );
  }

  function collectBaselineRectangles(coverage, cols, rows) {
    const used = new Uint8Array(coverage.length); // Used to ensure each baseline-compatible tile belongs to exactly one rectangle.
    const rectangles = []; // Used by inversion to emit large baseline quads around holes.
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const start = row * cols + col; // Used to address this candidate baseline cell.
        if (!coverage[start] || used[start]) continue;
        let width = 1; // Used to extend the rectangle east while cells remain baseline-compatible.
        while (col + width < cols) {
          const idx = row * cols + col + width; // Used to test the next eastward cell.
          if (!coverage[idx] || used[idx]) break;
          width++;
        }
        let height = 1; // Used to extend the full rectangle south while every cell across its width stays compatible.
        outer: while (row + height < rows) {
          for (let x = 0; x < width; x++) {
            const idx = (row + height) * cols + col + x; // Used to test the next candidate row.
            if (!coverage[idx] || used[idx]) break outer;
          }
          height++;
        }
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) used[(row + y) * cols + col + x] = 1;
        }
        rectangles.push({ col, row, width, height });
      }
    }
    return rectangles;
  }

  // Inverted representation: cells matching the common weather-driven level
  // become greedily merged flat rectangles in the same BufferGeometry.
  // Dry/solid/different cells are literal geometry holes, so there is no
  // fragment mask texture, discard branch, or extra texture sample. Wet
  // exceptions are appended as local smoothed quads. Every baseline rectangle
  // replaces at least one old tile quad, so this representation can never
  // exceed the classic visible-water quad count while a baseline is active.
  function buildInvertedSurfaceData(cells, options = {}) {
    const cols = Math.max(0, Math.floor(Number(options.cols) || 0)); // Used as the inversion coverage-grid width.
    const rows = Math.max(0, Math.floor(Number(options.rows) || 0)); // Used as the inversion coverage-grid height.
    if (!cols || !rows) return buildSurfaceData(cells, options);

    const baseline = normalizeBaseline(options); // Used to classify common cells versus local exceptions.
    if (!baseline.visible) {
      const classic = buildSurfaceData(cells, options); // Used directly during dry weather because inversion has no baseline to compress.
      classic.inversionFallback = true;
      return classic;
    }

    const grid = normalizeGrid(cells, cols, rows); // Used for numeric classification and exception corner smoothing.
    const joinThreshold = Number.isFinite(options.joinThreshold)
      ? Math.max(0, options.joinThreshold)
      : DEFAULT_JOIN_THRESHOLD;
    const surfaceThreshold = Number.isFinite(options.exceptionSurfaceThreshold)
      ? Math.max(0, options.exceptionSurfaceThreshold)
      : DEFAULT_EXCEPTION_SURFACE_THRESHOLD;
    const depthThreshold = Number.isFinite(options.exceptionDepthThreshold)
      ? Math.max(0, options.exceptionDepthThreshold)
      : DEFAULT_EXCEPTION_DEPTH_THRESHOLD;
    const coverageThreshold = Number.isFinite(options.exceptionCoverageThreshold)
      ? Math.max(0, options.exceptionCoverageThreshold)
      : DEFAULT_EXCEPTION_COVERAGE_THRESHOLD;
    const yOffset = Number.isFinite(options.yOffset) ? options.yOffset : 0.015; // Used to prevent water/ground z-fighting.
    const textureTileSize = Math.max(0.001, Number.isFinite(options.textureTileSize)
      ? options.textureTileSize
      : DEFAULT_TEXTURE_TILE_SIZE); // Used for the same continuous world-space UVs as the classic path.
    const baselineCoverage = new Uint8Array(cols * rows); // Marks cells that the greedily merged weather baseline may cover.
    const wetExceptionIndices = []; // Used to append only locally different wet tiles after baseline rectangles.
    let visibleCount = 0; // Used by stats and the defensive quad-count invariant below.
    let maskedCellCount = 0; // Used by diagnostics to report cells geometrically omitted from the baseline.

    for (let index = 0; index < grid.length; index++) {
      const cell = grid[index]; // Used to compare this actual simulation cell against the weather baseline.
      const cellVisible = !!cell && cell.visible !== false; // Used to distinguish dry/solid holes from wet local exceptions.
      if (cellVisible) visibleCount++;
      let differs = cellVisible !== baseline.visible; // Used as the first exception test for dry/solid versus wet baseline state.
      if (!differs && cellVisible) {
        differs = Math.abs(cell.surfaceY - baseline.surfaceY) > surfaceThreshold
          || Math.abs(cell.depth - baseline.depth) > depthThreshold
          || Math.abs(cell.coverage - baseline.coverage) > coverageThreshold;
      }
      if (differs) {
        maskedCellCount++;
        if (cellVisible) wetExceptionIndices.push(index);
      } else if (cellVisible) {
        baselineCoverage[index] = 1;
        cell.surfaceY = baseline.surfaceY; // Used so neighboring exception corners meet the flat baseline exactly.
      }
    }

    const rectangles = collectBaselineRectangles(baselineCoverage, cols, rows); // Used to replace baseline tile quads with large rectangle quads.
    const invertedQuadCount = rectangles.length + wetExceptionIndices.length; // Used to enforce the structural geometry-cost invariant.
    if (invertedQuadCount > visibleCount) {
      const classic = buildSurfaceData(cells, options); // Defensive fallback for an invariant violation; should be unreachable.
      classic.representation = 'tile-merged-fallback';
      classic.inversionFallback = true;
      return classic;
    }

    const data = emptySurfaceData(visibleCount); // Receives the rectangle-compressed baseline plus wet exception quads.
    data.representation = 'baseline-geometry-exceptions';
    data.baselineVisible = true;
    data.baselineDepth = baseline.depth;
    data.baselineCoverage = baseline.coverage;
    data.baselineSurfaceY = baseline.surfaceY;
    data.baselineRectangles = rectangles.length;
    data.exceptionCount = wetExceptionIndices.length;
    data.maskedCellCount = maskedCellCount;
    for (const rectangle of rectangles) appendFlatRectangle(data, rectangle, baseline, yOffset, textureTileSize);
    for (const index of wetExceptionIndices) {
      const cell = grid[index]; // Used to append this one wet tile whose local level differs from the baseline.
      if (cell) appendGridCellQuad(data, cell, grid, cols, rows, joinThreshold, yOffset, textureTileSize);
    }
    return data;
  }

  function createMaterial(THREE, options = {}) {
    const fallbackPixel = new Uint8Array([172, 190, 184, 255]);
    const fallbackTexture = new THREE.DataTexture(fallbackPixel, 1, 1, THREE.RGBAFormat);
    fallbackTexture.needsUpdate = true;
    const uniforms = {
      uTime: { value: 0 },
      uWaterTexture: { value: fallbackTexture },
      uDeepColor: { value: new THREE.Color(options.deepColor ?? 0x14658e) },
      uShallowColor: { value: new THREE.Color(options.shallowColor ?? 0x75d5df) },
      uOpacity: { value: Math.max(0, Math.min(1, options.opacity ?? 0.8)) },
    };
    const material = new THREE.ShaderMaterial({
      name: 'merged_textured_water_material',
      uniforms,
      vertexShader: `
        attribute float aDepth;
        attribute float aCoverage;
        attribute vec2 aFlow;
        varying vec2 vUv;
        varying float vDepth;
        varying float vCoverage;
        varying vec2 vFlow;
        void main() {
          vUv = uv;
          vDepth = aDepth;
          vCoverage = aCoverage;
          vFlow = aFlow;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform sampler2D uWaterTexture;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vDepth;
        varying float vCoverage;
        varying vec2 vFlow;
        void main() {
          vec2 textureOffset = vec2(uTime * ${TEXTURE_SCROLL_U.toFixed(3)}, uTime * ${TEXTURE_SCROLL_V.toFixed(3)});
          vec2 textureUv = fract(vUv + textureOffset);
          vec3 textureColor = texture2D(uWaterTexture, textureUv).rgb;
          float pattern = dot(textureColor, vec3(0.299, 0.587, 0.114));
          vec3 baseColor = mix(uShallowColor, uDeepColor, clamp(vDepth, 0.0, 1.0));
          vec3 surfaceColor = mix(baseColor * 0.72, baseColor * 1.22, pattern);
          float flowSheen = min(1.0, length(vFlow)) * 0.045
            * (sin((vUv.x + vUv.y) * 28.0 - uTime * 2.0) * 0.5 + 0.5);
          surfaceColor += flowSheen;
          float alpha = uOpacity * mix(0.075, 1.0, smoothstep(0.0, 1.0, vCoverage));
          gl_FragColor = vec4(surfaceColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });

    if (options.textureUrl) {
      new THREE.TextureLoader().load(options.textureUrl, texture => {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        uniforms.uWaterTexture.value = texture;
        material.needsUpdate = true;
        fallbackTexture.dispose();
      }, undefined, error => {
        options.log?.(`[water-render] texture load failed (${options.textureUrl}): ${error?.message || error}`, 'warn');
      });
    }
    return material;
  }

  function createMesh(THREE, material, cells, options = {}) {
    const data = options.inverted
      ? buildInvertedSurfaceData(cells, options)
      : buildSurfaceData(cells, options); // Used to construct one BufferGeometry for either representation.
    if (!data.indices.length) return null;
    const geometry = new THREE.BufferGeometry(); // Used by the one water Mesh/draw call.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(data.depths, 1));
    geometry.setAttribute('aCoverage', new THREE.Float32BufferAttribute(data.coverages, 1));
    geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(data.flows, 2));
    const IndexArray = data.indices.length > 65535 ? Uint32Array : Uint16Array; // Used to keep small maps on the narrower index format.
    geometry.setIndex(new THREE.BufferAttribute(new IndexArray(data.indices), 1));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material); // Used as the single runtime water object for this area.
    mesh.name = options.name || 'merged_water_surface';
    mesh.receiveShadow = false;

    const statKey = options.statKey || mesh.name; // Used to expose this area's representation cost to mobile/in-game diagnostics.
    mesh.userData.mergedWaterStatKey = statKey;
    stats[statKey] = {
      tiles: data.tileCount,
      vertices: data.positions.length / 3,
      triangles: data.indices.length / 3,
      drawCalls: 1,
      representation: data.representation,
      baselineVisible: !!data.baselineVisible,
      baselineDepth: Number.isFinite(data.baselineDepth) ? data.baselineDepth : null,
      baselineCoverage: Number.isFinite(data.baselineCoverage) ? data.baselineCoverage : null,
      baselineRectangles: data.baselineRectangles || 0,
      exceptionTiles: data.exceptionCount || 0,
      maskedCells: data.maskedCellCount || 0,
      inversionFallback: !!data.inversionFallback,
      textureTileSize: Number.isFinite(options.textureTileSize)
        ? options.textureTileSize
        : DEFAULT_TEXTURE_TILE_SIZE,
      textureScrollUvPerSecond: [TEXTURE_SCROLL_U, TEXTURE_SCROLL_V],
    };
    const logCount = `${data.representation}/${data.baselineRectangles || 0}/${data.exceptionCount || 0}/${data.maskedCellCount || 0}`; // Used to suppress unchanged representation logs.
    if (lastLoggedCounts.get(statKey) !== logCount) {
      lastLoggedCounts.set(statKey, logCount);
      if (options.inverted) {
        options.log?.(`[water-render] ${statKey}: ${data.representation}; ${data.baselineRectangles || 0} baseline rectangle(s), ${data.maskedCellCount || 0} omitted cell(s), ${data.exceptionCount || 0} wet exception tile(s), ${data.positions.length / 3} vertices -> 1 draw call`, 'info');
      } else {
        options.log?.(`[water-render] ${statKey}: ${data.tileCount} tile(s) -> 1 merged draw call`, 'info');
      }
    }
    return mesh;
  }

  function clearStats(statKey) {
    if (statKey) delete stats[statKey];
  }

  const api = {
    DEFAULT_JOIN_THRESHOLD,
    DEFAULT_TEXTURE_TILE_SIZE,
    DEFAULT_EXCEPTION_SURFACE_THRESHOLD,
    DEFAULT_EXCEPTION_DEPTH_THRESHOLD,
    DEFAULT_EXCEPTION_COVERAGE_THRESHOLD,
    TEXTURE_SCROLL_U,
    TEXTURE_SCROLL_V,
    buildSurfaceData,
    buildInvertedSurfaceData,
    collectBaselineRectangles,
    createMaterial,
    createMesh,
    clearStats,
    stats,
  };
  if (typeof window !== 'undefined') {
    window.MergedWaterRenderer = api;
    window.__waterRenderStats = stats;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
