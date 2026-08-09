(() => {
  'use strict';

  const DEFAULT_JOIN_THRESHOLD = 0.275;
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
    const uvMinX = Number.isFinite(options.uvMinX) ? options.uvMinX : 0;
    const uvMinZ = Number.isFinite(options.uvMinZ) ? options.uvMinZ : 0;
    const uvWidth = Math.max(0.001, Number.isFinite(options.uvWidth) ? options.uvWidth : 1);
    const uvHeight = Math.max(0.001, Number.isFinite(options.uvHeight) ? options.uvHeight : 1);
    const positions = [];
    const uvs = [];
    const depths = [];
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
        uvs.push((x - uvMinX) / uvWidth, (z - uvMinZ) / uvHeight);
        depths.push(cell.depth);
        flows.push(cell.flowX, cell.flowZ);
      }
      indices.push(
        vertexIndex, vertexIndex + 2, vertexIndex + 3,
        vertexIndex, vertexIndex + 3, vertexIndex + 1,
      );
      vertexIndex += 4;
    }

    return { positions, uvs, depths, flows, indices, tileCount: byKey.size };
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
        attribute vec2 aFlow;
        varying vec2 vUv;
        varying float vDepth;
        varying vec2 vFlow;
        void main() {
          vUv = uv;
          vDepth = aDepth;
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
        varying vec2 vFlow;
        void main() {
          // Keep the PNG anchored to world X/Z so adjacent tiles and
          // disconnected puddles always sample the same stretched image.
          // Flow adds a moving sheen instead of offsetting UVs per tile,
          // which would reintroduce visible seams at direction changes.
          vec2 textureUv = fract(vUv + vec2(0.0, uTime * 0.0015));
          vec3 textureColor = texture2D(uWaterTexture, textureUv).rgb;
          float pattern = dot(textureColor, vec3(0.299, 0.587, 0.114));
          vec3 baseColor = mix(uShallowColor, uDeepColor, clamp(vDepth, 0.0, 1.0));
          vec3 surfaceColor = mix(baseColor * 0.72, baseColor * 1.22, pattern);
          float flowSheen = min(1.0, length(vFlow)) * 0.045
            * (sin((vUv.x + vUv.y) * 28.0 - uTime * 2.0) * 0.5 + 0.5);
          surfaceColor += flowSheen;
          // uOpacity is the authored maximum (80% in game.js); shallow film
          // still fades with simulated depth instead of appearing suddenly
          // as a fully opaque sheet after the first drop of rain.
          float alpha = uOpacity * mix(0.075, 1.0, smoothstep(0.0, 1.0, vDepth));
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
    const data = buildSurfaceData(cells, options);
    if (!data.tileCount) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(data.depths, 1));
    geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(data.flows, 2));
    const IndexArray = data.indices.length > 65535 ? Uint32Array : Uint16Array;
    geometry.setIndex(new THREE.BufferAttribute(new IndexArray(data.indices), 1));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = options.name || 'merged_water_surface';
    mesh.receiveShadow = false;

    const statKey = options.statKey || mesh.name;
    mesh.userData.mergedWaterStatKey = statKey;
    stats[statKey] = {
      tiles: data.tileCount,
      vertices: data.positions.length / 3,
      triangles: data.indices.length / 3,
      drawCalls: 1,
    };
    if (lastLoggedCounts.get(statKey) !== data.tileCount) {
      lastLoggedCounts.set(statKey, data.tileCount);
      options.log?.(`[water-render] ${statKey}: ${data.tileCount} tile(s) -> 1 merged draw call`, 'info');
    }
    return mesh;
  }

  function clearStats(statKey) {
    if (statKey) delete stats[statKey];
  }

  const api = { DEFAULT_JOIN_THRESHOLD, buildSurfaceData, createMaterial, createMesh, clearStats, stats };
  if (typeof window !== 'undefined') {
    window.MergedWaterRenderer = api;
    window.__waterRenderStats = stats;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
