(() => {
  'use strict';

  const DEFAULT_JOIN_THRESHOLD = 0.275;
  const DEFAULT_TEXTURE_TILE_SIZE = 4; // Used to repeat the water PNG across world X/Z coordinates.
  const DEFAULT_EXCEPTION_SURFACE_THRESHOLD = 0.01; // World-Y difference before a tile stops using the baseline plane.
  const DEFAULT_EXCEPTION_DEPTH_THRESHOLD = 0.04; // Used where color-depth differs even when surface Y is almost identical.
  const DEFAULT_EXCEPTION_COVERAGE_THRESHOLD = 0.04; // Used where opacity differs even when surface Y is almost identical.
  const TEXTURE_SCROLL_U = 0.012; // Used by the shared shader to drift the tiled PNG sideways.
  const TEXTURE_SCROLL_V = 0.035; // Used by the shared shader to move the tiled PNG along world Z.
  const stats = Object.create(null); // Used by the in-game Debug panel and mobile bug reports.
  const lastLoggedCounts = new Map();

  function cellKey(col, row) { return `${col},${row}`; }

  function normalizeCells(cells) {
    const byKey = new Map();
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
    const component = new Set([cell]);
    let changed = true;
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
    let sum = 0;
    for (const member of component) sum += member.surfaceY;
    return sum / component.size;
  }

  function appendCellQuad(data, cell, touchingByKey, joinThreshold, yOffset, textureTileSize, baselineFlag = 0) {
    const corners = [
      [cell.col, cell.row],
      [cell.col + 1, cell.row],
      [cell.col, cell.row + 1],
      [cell.col + 1, cell.row + 1],
    ];
    const vertexIndex = data.positions.length / 3;
    for (const [x, z] of corners) {
      const touching = touchingCells(touchingByKey, x, z);
      const y = cornerHeightFor(cell, touching, joinThreshold) + yOffset;
      data.positions.push(x, y, z);
      data.uvs.push(x / textureTileSize, z / textureTileSize);
      data.depths.push(cell.depth);
      data.coverages.push(cell.coverage);
      data.flows.push(cell.flowX, cell.flowZ);
      data.baselines.push(baselineFlag);
    }
    data.indices.push(
      vertexIndex, vertexIndex + 2, vertexIndex + 3,
      vertexIndex, vertexIndex + 3, vertexIndex + 1,
    );
  }

  function buildSurfaceData(cells, options = {}) {
    const byKey = normalizeCells(cells);
    const joinThreshold = Number.isFinite(options.joinThreshold)
      ? Math.max(0, options.joinThreshold)
      : DEFAULT_JOIN_THRESHOLD;
    const yOffset = Number.isFinite(options.yOffset) ? options.yOffset : 0.015;
    const textureTileSize = Math.max(0.001, Number.isFinite(options.textureTileSize)
      ? options.textureTileSize
      : DEFAULT_TEXTURE_TILE_SIZE); // Converts world coordinates into repeating texture-space units.
    const data = {
      positions: [],
      uvs: [],
      depths: [],
      coverages: [], // Used by the shader to separate visual opacity from water-color depth.
      flows: [],
      baselines: [], // Classic tile-contributed geometry never samples the exception mask.
      indices: [],
      mask: null,
      maskCols: 0,
      maskRows: 0,
      maskOriginX: 0,
      maskOriginZ: 0,
      baselineVisible: false,
      exceptionCount: 0,
      maskedCellCount: 0,
      tileCount: byKey.size,
    };

    for (const cell of byKey.values()) {
      if (cell.visible === false) continue;
      appendCellQuad(data, cell, byKey, joinThreshold, yOffset, textureTileSize, 0);
    }

    return data;
  }

  function normalizeBaseline(options) {
    const source = options.baseline || {};
    const depth = Math.max(0, Math.min(1, Number.isFinite(source.depth) ? source.depth : 0));
    const coverage = Math.max(0, Math.min(1, Number.isFinite(source.coverage) ? source.coverage : depth));
    return {
      visible: source.visible !== false && Number.isFinite(source.surfaceY) && coverage > 0,
      surfaceY: Number.isFinite(source.surfaceY) ? source.surfaceY : 0,
      depth,
      coverage,
      flowX: Number.isFinite(source.flowX) ? source.flowX : 0,
      flowZ: Number.isFinite(source.flowZ) ? source.flowZ : 0,
    };
  }

  // Inverted representation: one full-map baseline quad carries the water
  // level that ordinary weather-exposed ground shares. A tiny nearest-filtered
  // mask punches out cells whose real simulation state differs from that
  // baseline, and only wet exception cells contribute local geometry. The
  // baseline quad and all exception quads remain one BufferGeometry / draw call.
  function buildInvertedSurfaceData(cells, options = {}) {
    const cols = Math.max(0, Math.floor(Number(options.cols) || 0));
    const rows = Math.max(0, Math.floor(Number(options.rows) || 0));
    if (!cols || !rows) return buildSurfaceData(cells, options);

    const byKey = normalizeCells(cells);
    const baseline = normalizeBaseline(options);
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
    const yOffset = Number.isFinite(options.yOffset) ? options.yOffset : 0.015;
    const textureTileSize = Math.max(0.001, Number.isFinite(options.textureTileSize)
      ? options.textureTileSize
      : DEFAULT_TEXTURE_TILE_SIZE);
    const exceptionKeys = new Set();
    const mask = new Uint8Array(cols * rows);
    let visibleCount = 0;
    let maskedCellCount = 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const key = cellKey(col, row);
        const cell = byKey.get(key);
        const cellVisible = !!cell && cell.visible !== false;
        if (cellVisible) visibleCount++;
        let differs = cellVisible !== baseline.visible;
        if (!differs && cellVisible && baseline.visible) {
          differs = Math.abs(cell.surfaceY - baseline.surfaceY) > surfaceThreshold
            || Math.abs(cell.depth - baseline.depth) > depthThreshold
            || Math.abs(cell.coverage - baseline.coverage) > coverageThreshold;
        }
        if (!differs) continue;
        exceptionKeys.add(key);
        mask[row * cols + col] = 255;
        maskedCellCount++;
      }
    }

    // For corner smoothing, cells represented by the baseline plane are made
    // exactly baseline-flat. Exception geometry can therefore meet the plane
    // cleanly at shared corners instead of averaging toward a nearly-baseline
    // simulation value that the plane itself does not render.
    const smoothingByKey = new Map();
    for (const [key, cell] of byKey) {
      if (cell.visible === false) {
        smoothingByKey.set(key, cell);
        continue;
      }
      if (baseline.visible && !exceptionKeys.has(key)) {
        smoothingByKey.set(key, { ...cell, surfaceY: baseline.surfaceY });
      } else {
        smoothingByKey.set(key, cell);
      }
    }

    const data = {
      positions: [],
      uvs: [],
      depths: [],
      coverages: [],
      flows: [],
      baselines: [],
      indices: [],
      mask,
      maskCols: cols,
      maskRows: rows,
      maskOriginX: Number.isFinite(options.originX) ? options.originX : 0,
      maskOriginZ: Number.isFinite(options.originZ) ? options.originZ : 0,
      baselineVisible: baseline.visible,
      baselineDepth: baseline.depth,
      baselineCoverage: baseline.coverage,
      baselineSurfaceY: baseline.surfaceY,
      exceptionCount: 0,
      maskedCellCount,
      tileCount: visibleCount,
    };

    if (baseline.visible) {
      const x0 = data.maskOriginX, z0 = data.maskOriginZ;
      const x1 = x0 + cols, z1 = z0 + rows;
      const vertexIndex = data.positions.length / 3;
      for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
        data.positions.push(x, baseline.surfaceY + yOffset, z);
        data.uvs.push(x / textureTileSize, z / textureTileSize);
        data.depths.push(baseline.depth);
        data.coverages.push(baseline.coverage);
        data.flows.push(baseline.flowX, baseline.flowZ);
        data.baselines.push(1);
      }
      data.indices.push(
        vertexIndex, vertexIndex + 2, vertexIndex + 3,
        vertexIndex, vertexIndex + 3, vertexIndex + 1,
      );
    }

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const key = cellKey(col, row);
        if (!exceptionKeys.has(key)) continue;
        const cell = smoothingByKey.get(key);
        if (!cell || cell.visible === false) continue; // Mask-only hole: dry/solid/skipped permanent water.
        appendCellQuad(data, cell, smoothingByKey, joinThreshold, yOffset, textureTileSize, 0);
        data.exceptionCount++;
      }
    }

    return data;
  }

  function createMaterial(THREE, options = {}) {
    const fallbackPixel = new Uint8Array([172, 190, 184, 255]);
    const fallbackTexture = new THREE.DataTexture(fallbackPixel, 1, 1, THREE.RGBAFormat);
    fallbackTexture.needsUpdate = true;
    const fallbackMaskPixel = new Uint8Array([0, 0, 0, 255]);
    const fallbackMaskTexture = new THREE.DataTexture(fallbackMaskPixel, 1, 1, THREE.RGBAFormat);
    fallbackMaskTexture.needsUpdate = true;
    const uniforms = {
      uTime: { value: 0 },
      uWaterTexture: { value: fallbackTexture },
      uDeepColor: { value: new THREE.Color(options.deepColor ?? 0x14658e) },
      uShallowColor: { value: new THREE.Color(options.shallowColor ?? 0x75d5df) },
      uOpacity: { value: Math.max(0, Math.min(1, options.opacity ?? 0.8)) },
      uExceptionMask: { value: fallbackMaskTexture },
      uMaskEnabled: { value: 0 },
      uMaskOrigin: { value: new THREE.Vector2(0, 0) },
      uMaskSize: { value: new THREE.Vector2(1, 1) },
    };
    const material = new THREE.ShaderMaterial({
      name: 'merged_textured_water_material',
      uniforms,
      vertexShader: `
        attribute float aDepth;
        attribute float aCoverage;
        attribute vec2 aFlow;
        attribute float aBaseline;
        varying vec2 vUv;
        varying float vDepth;
        varying float vCoverage;
        varying vec2 vFlow;
        varying float vBaseline;
        varying vec2 vWorldXZ;
        void main() {
          vUv = uv;
          vDepth = aDepth;
          vCoverage = aCoverage;
          vFlow = aFlow;
          vBaseline = aBaseline;
          vWorldXZ = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform sampler2D uWaterTexture;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform float uOpacity;
        uniform sampler2D uExceptionMask;
        uniform float uMaskEnabled;
        uniform vec2 uMaskOrigin;
        uniform vec2 uMaskSize;
        varying vec2 vUv;
        varying float vDepth;
        varying float vCoverage;
        varying vec2 vFlow;
        varying float vBaseline;
        varying vec2 vWorldXZ;
        void main() {
          // Only the four-vertex map-wide baseline plane samples this mask.
          // Local exception geometry carries vBaseline=0 and therefore draws
          // normally inside the holes punched out of the baseline.
          if (uMaskEnabled > 0.5 && vBaseline > 0.5) {
            vec2 localCell = clamp(floor(vWorldXZ - uMaskOrigin), vec2(0.0), uMaskSize - vec2(1.0));
            vec2 maskUv = (localCell + vec2(0.5)) / uMaskSize;
            if (texture2D(uExceptionMask, maskUv).r > 0.5) discard;
          }

          // The PNG repeats in world X/Z and one continuous offset moves the
          // whole merged surface like the scrolling texture on a rain plane.
          // Per-tile offsets would create seams where flow directions change.
          vec2 textureOffset = vec2(uTime * ${TEXTURE_SCROLL_U.toFixed(3)}, uTime * ${TEXTURE_SCROLL_V.toFixed(3)});
          vec2 textureUv = fract(vUv + textureOffset);
          vec3 textureColor = texture2D(uWaterTexture, textureUv).rgb;
          float pattern = dot(textureColor, vec3(0.299, 0.587, 0.114));
          vec3 baseColor = mix(uShallowColor, uDeepColor, clamp(vDepth, 0.0, 1.0));
          vec3 surfaceColor = mix(baseColor * 0.72, baseColor * 1.22, pattern);
          float flowSheen = min(1.0, length(vFlow)) * 0.045
            * (sin((vUv.x + vUv.y) * 28.0 - uTime * 2.0) * 0.5 + 0.5);
          surfaceColor += flowSheen;
          // uOpacity is the authored maximum (80% in game.js). Coverage is
          // full for permanent waterways, while temporary water supplies its
          // simulated depth so a first drop of rain still fades in gently.
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

  function createMaskTexture(THREE, data) {
    if (!data.mask || !data.maskCols || !data.maskRows || !data.baselineVisible) return null;
    const rgba = new Uint8Array(data.mask.length * 4);
    for (let i = 0; i < data.mask.length; i++) {
      const dst = i * 4;
      rgba[dst] = data.mask[i];
      rgba[dst + 3] = 255;
    }
    const texture = new THREE.DataTexture(rgba, data.maskCols, data.maskRows, THREE.RGBAFormat);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
  }

  function createMesh(THREE, material, cells, options = {}) {
    const data = options.inverted
      ? buildInvertedSurfaceData(cells, options)
      : buildSurfaceData(cells, options);
    if (!data.indices.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(data.depths, 1));
    geometry.setAttribute('aCoverage', new THREE.Float32BufferAttribute(data.coverages, 1));
    geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(data.flows, 2));
    geometry.setAttribute('aBaseline', new THREE.Float32BufferAttribute(data.baselines, 1));
    const IndexArray = data.indices.length > 65535 ? Uint32Array : Uint16Array;
    geometry.setIndex(new THREE.BufferAttribute(new IndexArray(data.indices), 1));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = options.name || 'merged_water_surface';
    mesh.receiveShadow = false;

    const maskTexture = createMaskTexture(THREE, data);
    if (maskTexture) mesh.userData.waterExceptionMask = maskTexture;
    mesh.onBeforeRender = (_renderer, _scene, _camera, _geometry, drawMaterial) => {
      const uniforms = drawMaterial?.uniforms;
      if (!uniforms?.uMaskEnabled) return;
      if (!maskTexture) {
        uniforms.uMaskEnabled.value = 0;
        return;
      }
      uniforms.uExceptionMask.value = maskTexture;
      uniforms.uMaskEnabled.value = 1;
      uniforms.uMaskOrigin.value.set(data.maskOriginX, data.maskOriginZ);
      uniforms.uMaskSize.value.set(data.maskCols, data.maskRows);
    };

    const statKey = options.statKey || mesh.name;
    mesh.userData.mergedWaterStatKey = statKey;
    stats[statKey] = {
      tiles: data.tileCount,
      vertices: data.positions.length / 3,
      triangles: data.indices.length / 3,
      drawCalls: 1,
      representation: options.inverted ? 'baseline-mask-exceptions' : 'tile-merged',
      baselineVisible: !!data.baselineVisible,
      baselineDepth: Number.isFinite(data.baselineDepth) ? data.baselineDepth : null,
      baselineCoverage: Number.isFinite(data.baselineCoverage) ? data.baselineCoverage : null,
      exceptionTiles: data.exceptionCount || 0,
      maskedCells: data.maskedCellCount || 0,
      textureTileSize: Number.isFinite(options.textureTileSize)
        ? options.textureTileSize
        : DEFAULT_TEXTURE_TILE_SIZE,
      textureScrollUvPerSecond: [TEXTURE_SCROLL_U, TEXTURE_SCROLL_V],
    };
    const logCount = options.inverted
      ? `${data.exceptionCount || 0}/${data.maskedCellCount || 0}/${data.baselineVisible ? 1 : 0}`
      : String(data.tileCount);
    if (lastLoggedCounts.get(statKey) !== logCount) {
      lastLoggedCounts.set(statKey, logCount);
      if (options.inverted) {
        options.log?.(`[water-render] ${statKey}: baseline=${data.baselineVisible ? 'on' : 'dry'}; ${data.maskedCellCount || 0} masked cell(s), ${data.exceptionCount || 0} wet exception tile(s) -> 1 draw call`, 'info');
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