(() => {
  'use strict';

  const DEFAULT_JOIN_THRESHOLD = 0.275;
  const DEFAULT_TEXTURE_TILE_SIZE = 4; // Used to repeat the base water PNG across world X/Z coordinates.
  const DEFAULT_STRETCH_OVERLAY_TEXTURE = 'assets/textures/canvas.png'; // Used by createMaterial() for the fitted second water texture.
  const DEFAULT_STRETCH_OVERLAY_OPACITY = 0.20; // Used by the overlay shader for every non-black canvas pixel.
  const STRETCH_OVERLAY_SPLIT_ANGLE_DEG = 89; // Used after flattening so every edge-connected water tile belongs to one fitted surface.
  const PURE_BLACK_EPSILON = 1.5 / 255; // Used by the shader to preserve source alpha on authored pure-black canvas pixels.
  const TEXTURE_SCROLL_U = 0.012; // Used by the shared shader to drift the tiled PNG sideways.
  const TEXTURE_SCROLL_V = 0.035; // Used by the shared shader to move the tiled PNG along world Z.
  const stats = Object.create(null); // Used by the in-game Debug panel and mobile bug reports.
  const lastLoggedCounts = new Map(); // Used to avoid repeating identical merged-water tile-count logs.

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
    ].filter(Boolean);
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

  function buildSurfaceData(cells, options = {}) {
    const byKey = normalizeCells(cells);
    const joinThreshold = Number.isFinite(options.joinThreshold)
      ? Math.max(0, options.joinThreshold)
      : DEFAULT_JOIN_THRESHOLD;
    const yOffset = Number.isFinite(options.yOffset) ? options.yOffset : 0.015;
    const textureTileSize = Math.max(0.001, Number.isFinite(options.textureTileSize)
      ? options.textureTileSize
      : DEFAULT_TEXTURE_TILE_SIZE); // Converts world coordinates into repeating texture-space units.
    const positions = [];
    const uvs = [];
    const depths = [];
    const coverages = []; // Used by the shader to separate visual opacity from water-color depth.
    const flows = [];
    const indices = [];
    let vertexIndex = 0;

    for (const cell of byKey.values()) {
      const corners = [
        [cell.col, cell.row],
        [cell.col + 1, cell.row],
        [cell.col, cell.row + 1],
        [cell.col + 1, cell.row + 1],
      ];
      for (const [x, z] of corners) {
        const touching = touchingCells(byKey, x, z);
        const y = cornerHeightFor(cell, touching, joinThreshold) + yOffset;
        positions.push(x, y, z);
        uvs.push(x / textureTileSize, z / textureTileSize);
        depths.push(cell.depth);
        coverages.push(cell.coverage);
        flows.push(cell.flowX, cell.flowZ);
      }
      indices.push(
        vertexIndex, vertexIndex + 2, vertexIndex + 3,
        vertexIndex, vertexIndex + 3, vertexIndex + 1,
      );
      vertexIndex += 4;
    }

    return { positions, uvs, depths, coverages, flows, indices, tileCount: byKey.size };
  }

  function normalizedFootprintUvs(THREE, geometry) {
    const position = geometry.getAttribute('position'); // Used to calculate the emergency X/Z bounds when the cliff-style mapper is unavailable.
    if (!position) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity; // Used to normalize the fallback footprint UVs.
    for (let i = 0; i < position.count; i++) {
      minX = Math.min(minX, position.getX(i)); maxX = Math.max(maxX, position.getX(i));
      minZ = Math.min(minZ, position.getZ(i)); maxZ = Math.max(maxZ, position.getZ(i));
    }
    const dx = Math.max(1e-6, maxX - minX); // Used to normalize fallback U across the complete merged-water bounds.
    const dz = Math.max(1e-6, maxZ - minZ); // Used to normalize fallback V across the complete merged-water bounds.
    const uv = new THREE.Float32BufferAttribute(new Float32Array(position.count * 2), 2); // Used only when HobunjiSurfaceStretchUV cannot be reached.
    for (let i = 0; i < position.count; i++) uv.setXY(i, (position.getX(i) - minX) / dx, (position.getZ(i) - minZ) / dz);
    return uv;
  }

  // Reuses the farm-cliff irregular-surface solver exactly, but temporarily
  // flattens water Y so edge-connected authored/procedural water tiles are
  // recognized as ONE continuous surface even when the visible mesh contains
  // a trench/raised-ground step. The mapper then pins that body's literal
  // irregular perimeter to the complete 0..1 texture square and harmonically
  // relaxes the interior, just as it does for the farm's calculated cliffs.
  function applyStretchOverlayUvs(THREE, sourceGeometry, options = {}) {
    const expanded = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone(); // Used so fitted UV seams can be independent without changing the base water triangles.
    const position = expanded.getAttribute('position'); // Used both for temporary flattening and restoring the real water surface afterward.
    const tiledUv = expanded.getAttribute('uv')?.clone() || null; // Used to restore the original world-tiled UVs after the mapper writes its fitted UVs.
    if (!position) return sourceGeometry;
    const originalPositions = position.array.slice(); // Used to restore the authored/procedural water heights after footprint-only UV solving.
    for (let i = 0; i < position.count; i++) position.setY(i, 0);
    position.needsUpdate = true;

    const mapper = options.surfaceStretchMapper || (typeof window !== 'undefined' ? window.HobunjiSurfaceStretchUV : null); // Used to invoke the same perimeter-to-square solver as farm cliffs.
    let mapped = null; // Used as the geometry carrying the cliff-style fitted UV result.
    if (mapper?.mapGeometry) {
      mapped = mapper.mapGeometry(expanded, { angleToleranceDeg: STRETCH_OVERLAY_SPLIT_ANGLE_DEG });
    }
    if (!mapped?.getAttribute?.('position')) {
      mapped = expanded;
      const fallbackUv = normalizedFootprintUvs(THREE, mapped); // Used only as a visible degradation path if the shared mapper failed to load.
      if (fallbackUv) mapped.setAttribute('uv', fallbackUv);
      options.log?.('[water-render] HobunjiSurfaceStretchUV unavailable; canvas overlay fell back to merged X/Z bounds.', 'warn');
    }

    const mappedPosition = mapped.getAttribute('position'); // Used to put the real water Y coordinates back without disturbing mapped topology/UV order.
    if (mappedPosition.count !== originalPositions.length / 3) {
      options.log?.('[water-render] canvas overlay mapper changed the water vertex count unexpectedly; fitted overlay disabled for this mesh.', 'warn');
      if (mapped !== expanded) mapped.dispose?.();
      expanded.dispose?.();
      return sourceGeometry;
    }
    for (let i = 0; i < mappedPosition.count; i++) {
      const base = i * 3; // Used to index this expanded vertex in the saved original position array.
      mappedPosition.setXYZ(i, originalPositions[base], originalPositions[base + 1], originalPositions[base + 2]);
    }
    mappedPosition.needsUpdate = true;

    const stretchUv = mapped.getAttribute('uv')?.clone() || normalizedFootprintUvs(THREE, mapped); // Used as canvas.png's once-per-connected-body UV domain.
    if (stretchUv) mapped.setAttribute('aStretchUv', stretchUv);
    if (tiledUv?.count === mappedPosition.count) mapped.setAttribute('uv', tiledUv); // Keeps wibbly_surface.png on the original scrolling world-tiled coordinates.
    else {
      const tileSize = Math.max(0.001, Number.isFinite(options.textureTileSize) ? options.textureTileSize : DEFAULT_TEXTURE_TILE_SIZE); // Used to rebuild base tiled UVs if a mapper clone dropped the original attribute.
      const rebuiltTiledUv = new THREE.Float32BufferAttribute(new Float32Array(mappedPosition.count * 2), 2); // Used by wibbly_surface.png when tiledUv cannot be copied directly.
      for (let i = 0; i < mappedPosition.count; i++) rebuiltTiledUv.setXY(i, mappedPosition.getX(i) / tileSize, mappedPosition.getZ(i) / tileSize);
      mapped.setAttribute('uv', rebuiltTiledUv);
    }
    mapped.computeVertexNormals();

    const stretchReport = mapped.userData?.hobunjiSurfaceStretch || null; // Used by mobile-visible water renderer stats to confirm connected-body fitting.
    mapped.userData = Object.assign({}, mapped.userData || {}, {
      waterStretchOverlay: {
        mapper: mapper?.mapGeometry ? 'HobunjiSurfaceStretchUV' : 'fallback-xz-bounds',
        flattenedForConnectivity: true,
        patchCount: Number(stretchReport?.patchCount || 0),
        fallbackCount: Number(stretchReport?.fallbackCount || 0),
      },
    });
    if (mapped !== expanded) expanded.dispose?.();
    if (sourceGeometry !== mapped) sourceGeometry.dispose?.();
    return mapped;
  }

  function createMaterial(THREE, options = {}) {
    const fallbackPixel = new Uint8Array([172, 190, 184, 255]); // Used by the base water texture until wibbly_surface.png finishes loading.
    const fallbackTexture = new THREE.DataTexture(fallbackPixel, 1, 1, THREE.RGBAFormat); // Used as a safe synchronous base sampler.
    fallbackTexture.needsUpdate = true;
    const overlayFallbackPixel = new Uint8Array([255, 255, 255, 0]); // Used to make the second layer invisible until canvas.png finishes loading.
    const overlayFallbackTexture = new THREE.DataTexture(overlayFallbackPixel, 1, 1, THREE.RGBAFormat); // Used as a transparent synchronous overlay sampler.
    overlayFallbackTexture.needsUpdate = true;
    const overlayTextureUrl = options.overlayTextureUrl || DEFAULT_STRETCH_OVERLAY_TEXTURE; // Used by TextureLoader for the fitted second PNG layer.
    const overlayOpacity = Math.max(0, Math.min(1, Number.isFinite(options.overlayOpacity) ? options.overlayOpacity : DEFAULT_STRETCH_OVERLAY_OPACITY)); // Used for every non-black overlay pixel.
    const uniforms = {
      uTime: { value: 0 },
      uWaterTexture: { value: fallbackTexture },
      uSurfaceOverlayTexture: { value: overlayFallbackTexture },
      uDeepColor: { value: new THREE.Color(options.deepColor ?? 0x14658e) },
      uShallowColor: { value: new THREE.Color(options.shallowColor ?? 0x75d5df) },
      uOpacity: { value: Math.max(0, Math.min(1, options.opacity ?? 0.8)) },
      uSurfaceOverlayOpacity: { value: overlayOpacity },
    };
    const material = new THREE.ShaderMaterial({
      name: 'merged_textured_water_material',
      uniforms,
      vertexShader: `
        attribute float aDepth;
        attribute float aCoverage;
        attribute vec2 aFlow;
        attribute vec2 aStretchUv;
        varying vec2 vUv;
        varying vec2 vStretchUv;
        varying float vDepth;
        varying float vCoverage;
        varying vec2 vFlow;
        void main() {
          vUv = uv;
          vStretchUv = aStretchUv;
          vDepth = aDepth;
          vCoverage = aCoverage;
          vFlow = aFlow;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform sampler2D uWaterTexture;
        uniform sampler2D uSurfaceOverlayTexture;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform float uOpacity;
        uniform float uSurfaceOverlayOpacity;
        varying vec2 vUv;
        varying vec2 vStretchUv;
        varying float vDepth;
        varying float vCoverage;
        varying vec2 vFlow;
        void main() {
          // The base PNG repeats in world X/Z and one continuous offset moves
          // the whole merged surface like the scrolling texture on a rain plane.
          vec2 textureOffset = vec2(uTime * ${TEXTURE_SCROLL_U.toFixed(3)}, uTime * ${TEXTURE_SCROLL_V.toFixed(3)});
          vec2 textureUv = fract(vUv + textureOffset);
          vec3 textureColor = texture2D(uWaterTexture, textureUv).rgb;
          float pattern = dot(textureColor, vec3(0.299, 0.587, 0.114));
          vec3 baseColor = mix(uShallowColor, uDeepColor, clamp(vDepth, 0.0, 1.0));
          vec3 surfaceColor = mix(baseColor * 0.72, baseColor * 1.22, pattern);
          float flowSheen = min(1.0, length(vFlow)) * 0.045
            * (sin((vUv.x + vUv.y) * 28.0 - uTime * 2.0) * 0.5 + 0.5);
          surfaceColor += flowSheen;

          // canvas.png is sampled ONCE across each connected water body's
          // irregular outline. Multiplying by baseColor makes white/grey
          // canvas pixels inherit the same water shade while authored black
          // remains black. Pure-black pixels keep the PNG's source alpha;
          // every other pixel uses the configurable 0.20 overlay opacity.
          vec4 overlaySample = texture2D(uSurfaceOverlayTexture, clamp(vStretchUv, vec2(0.0), vec2(1.0)));
          float maxOverlayChannel = max(overlaySample.r, max(overlaySample.g, overlaySample.b));
          float pureBlack = 1.0 - step(${PURE_BLACK_EPSILON.toFixed(6)}, maxOverlayChannel);
          float overlayAlpha = overlaySample.a * mix(uSurfaceOverlayOpacity, 1.0, pureBlack);
          vec3 overlayColor = baseColor * overlaySample.rgb;

          // uOpacity is the authored maximum (80% in game.js). Coverage is
          // full for permanent waterways, while temporary water supplies its
          // simulated depth so a first drop of rain still fades in gently.
          float coverageAlpha = mix(0.075, 1.0, smoothstep(0.0, 1.0, vCoverage));
          float baseAlpha = uOpacity * coverageAlpha;
          overlayAlpha *= coverageAlpha;

          // Composite the fitted canvas layer over the existing tiled water
          // in this same draw call. This is visually a second texture layer
          // without duplicating dynamic water geometry or introducing Z-fight.
          float outAlpha = overlayAlpha + baseAlpha * (1.0 - overlayAlpha);
          vec3 outColor = (overlayColor * overlayAlpha + surfaceColor * baseAlpha * (1.0 - overlayAlpha)) / max(outAlpha, 0.00001);
          gl_FragColor = vec4(outColor, outAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    material.userData = Object.assign({}, material.userData || {}, {
      waterStretchOverlay: {
        textureUrl: overlayTextureUrl,
        opacity: overlayOpacity,
        pureBlackOpacity: 'source-alpha',
        tint: 'water-depth-color',
      },
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
    if (overlayTextureUrl) {
      new THREE.TextureLoader().load(overlayTextureUrl, texture => {
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        uniforms.uSurfaceOverlayTexture.value = texture;
        material.needsUpdate = true;
        overlayFallbackTexture.dispose();
      }, undefined, error => {
        options.log?.(`[water-render] stretch overlay texture load failed (${overlayTextureUrl}): ${error?.message || error}`, 'warn');
      });
    }
    return material;
  }

  function createMesh(THREE, material, cells, options = {}) {
    const data = buildSurfaceData(cells, options);
    if (!data.tileCount) return null;
    let geometry = new THREE.BufferGeometry(); // Used first for the canonical merged water surface, then replaced by the fitted-UV clone.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(data.depths, 1));
    geometry.setAttribute('aCoverage', new THREE.Float32BufferAttribute(data.coverages, 1));
    geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(data.flows, 2));
    const IndexArray = data.indices.length > 65535 ? Uint32Array : Uint16Array;
    geometry.setIndex(new THREE.BufferAttribute(new IndexArray(data.indices), 1));
    geometry.computeVertexNormals();
    geometry = applyStretchOverlayUvs(THREE, geometry, options); // Used to add canvas.png's cliff-style once-per-connected-water-body UVs while keeping base tiled UVs.
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = options.name || 'merged_water_surface';
    mesh.receiveShadow = false;

    const statKey = options.statKey || mesh.name;
    const stretchReport = geometry.userData?.waterStretchOverlay || null; // Used by the debug panel to show whether the exact farm-cliff mapper handled this water mesh.
    mesh.userData.mergedWaterStatKey = statKey;
    mesh.userData.waterStretchOverlay = stretchReport;
    stats[statKey] = {
      tiles: data.tileCount,
      vertices: geometry.getAttribute('position')?.count || data.positions.length / 3,
      triangles: geometry.index ? geometry.index.count / 3 : (geometry.getAttribute('position')?.count || 0) / 3,
      drawCalls: 1,
      textureTileSize: Number.isFinite(options.textureTileSize)
        ? options.textureTileSize
        : DEFAULT_TEXTURE_TILE_SIZE,
      textureScrollUvPerSecond: [TEXTURE_SCROLL_U, TEXTURE_SCROLL_V],
      stretchOverlay: {
        texture: material?.userData?.waterStretchOverlay?.textureUrl || DEFAULT_STRETCH_OVERLAY_TEXTURE,
        opacity: material?.userData?.waterStretchOverlay?.opacity ?? DEFAULT_STRETCH_OVERLAY_OPACITY,
        pureBlackOpacity: material?.userData?.waterStretchOverlay?.pureBlackOpacity || 'source-alpha',
        mapper: stretchReport?.mapper || 'unknown',
        connectedSurfaceCount: Number(stretchReport?.patchCount || 0),
        fallbackCount: Number(stretchReport?.fallbackCount || 0),
      },
    };
    if (lastLoggedCounts.get(statKey) !== data.tileCount) {
      lastLoggedCounts.set(statKey, data.tileCount);
      const overlaySummary = stretchReport?.mapper === 'HobunjiSurfaceStretchUV'
        ? `; canvas overlay fitted across ${stretchReport.patchCount || 0} connected surface(s)`
        : '; canvas overlay using fallback footprint UVs'; // Used to make mobile render logs immediately reveal mapper availability.
      options.log?.(`[water-render] ${statKey}: ${data.tileCount} tile(s) -> 1 merged draw call${overlaySummary}`, 'info');
    }
    return mesh;
  }

  function clearStats(statKey) {
    if (statKey) delete stats[statKey];
  }

  const api = {
    DEFAULT_JOIN_THRESHOLD,
    DEFAULT_TEXTURE_TILE_SIZE,
    DEFAULT_STRETCH_OVERLAY_TEXTURE,
    DEFAULT_STRETCH_OVERLAY_OPACITY,
    STRETCH_OVERLAY_SPLIT_ANGLE_DEG,
    TEXTURE_SCROLL_U,
    TEXTURE_SCROLL_V,
    buildSurfaceData,
    applyStretchOverlayUvs,
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
