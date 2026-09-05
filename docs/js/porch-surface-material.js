// Applies the authored porch wood treatments while preserving the existing
// HousePieceGen geometry and walkable-elevation behavior. Porch decks/stairs use
// boards.png; railings/fences use carved_smooth.png. Adjacent smooth faces are
// detected as connected surface islands so UVs continue across map-tile seams.
(() => {
  'use strict';

  const THREE = window.THREE;
  const housePieces = window.HousePieceGen;
  if (!THREE || !housePieces?.buildGroupFromPiece || window.HobunjiPorchSurfaceMaterial?.installed) return;

  const DECK_TEXTURE_PATH = 'assets/textures/boards.png'; // Used by porch decks and porch stairs.
  const FENCE_TEXTURE_PATH = 'assets/textures/carved_smooth.png'; // Used by porch railings/fences.
  const WOOD_TINT = '#8b6540'; // Shared Furniture + Avatar Author wood tint used by both porch materials.
  const WOOD_TINT_HEX = 0x8b6540; // Immediate fallback while the tinted PNG is loading.
  const PORCH_TAGS = new Set(['porch', 'porchStair', 'railing']); // Limits the module to the porch assembly.
  const MATCH_EPSILON = 1e-4; // Used to match authored quads to HousePieceGen's rendered meshes.
  const SURFACE_SPLIT_ANGLE_DEG = 24; // Same smooth-edge split threshold used by the furniture surface workflow.
  const DEBUG_ENABLED = new URLSearchParams(location.search).get('porchMatDebug') === '1';

  const materialCache = new Map(); // Texture path -> shared tinted material used by every matching porch face.
  const textureStatus = new Map(); // Texture path -> diagnostic load state.
  let lastBuild = null;
  let totalConvertedFaces = 0;
  let totalSurfaceIslands = 0;

  function log(message, level = 'info') {
    if (!DEBUG_ENABLED) return;
    const text = `[porch-material] ${message}`;
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level, 'render');
    else if (level === 'warn') console.warn(text);
    else console.debug(text);
  }

  function surfaceClassForTag(tag) {
    return tag === 'railing' ? 'fence' : 'deck';
  }

  function texturePathForTag(tag) {
    return surfaceClassForTag(tag) === 'fence' ? FENCE_TEXTURE_PATH : DECK_TEXTURE_PATH;
  }

  function materialForTag(tag) {
    const texturePath = texturePathForTag(tag);
    const cached = materialCache.get(texturePath);
    if (cached) return cached;

    const material = new THREE.MeshLambertMaterial({ color: WOOD_TINT_HEX, side: THREE.DoubleSide });
    materialCache.set(texturePath, material);
    textureStatus.set(texturePath, 'loading');

    new THREE.TextureLoader().load(texturePath, texture => {
      let finalTexture = texture;
      const parse = window.parseHexColor;
      const shadeFill = window.getShadeFillCanvas;
      const tintConfig = window.getPortraitTintingConfig;
      const rgb = typeof parse === 'function' ? parse(WOOD_TINT) : null;

      if (rgb && typeof shadeFill === 'function' && typeof tintConfig === 'function') {
        const canvas = shadeFill(texture.image, `${texturePath}|porch|${WOOD_TINT}`, {
          mode: 'shadeFill',
          rgb: [rgb.r, rgb.g, rgb.b],
          options: tintConfig(),
        });
        finalTexture = new THREE.CanvasTexture(canvas);
        material.color.setHex(0xffffff);
        textureStatus.set(texturePath, 'loaded-shade-fill');
      } else {
        material.color.setHex(WOOD_TINT_HEX);
        textureStatus.set(texturePath, 'loaded-color-multiply-fallback');
      }

      finalTexture.wrapS = finalTexture.wrapT = THREE.ClampToEdgeWrapping;
      finalTexture.needsUpdate = true;
      material.map = finalTexture;
      material.needsUpdate = true;
      log(`loaded ${texturePath} with ${WOOD_TINT} (${textureStatus.get(texturePath)})`);
    }, undefined, error => {
      textureStatus.set(texturePath, 'load-failed');
      log(`texture load failed: ${error?.message || error || texturePath}`, 'warn');
    });

    return material;
  }

  function normalizePiece(pieceData) {
    return pieceData?.currentPiece && typeof pieceData.currentPiece === 'object'
      ? pieceData.currentPiece
      : pieceData;
  }

  function transformedFaceVertices(pieceData, face, gridX, gridZ, options = {}) {
    const piece = normalizePiece(pieceData) || {};
    const cells = Array.isArray(piece?.footprint?.cells) ? piece.footprint.cells : [];
    const gridCenter = Math.floor((Number(piece.gridSize) || 18) / 2);
    const minCellX = cells.length ? Math.min(...cells.map(cell => Number(cell.x) || 0)) : gridCenter;
    const minCellZ = cells.length ? Math.min(...cells.map(cell => Number(cell.y) || 0)) : gridCenter;
    const offsetX = (Number(gridX) || 0) + (gridCenter - minCellX);
    const offsetZ = (Number(gridZ) || 0) + (gridCenter - minCellZ);
    const offsetY = Number(options.elevationY) || 0;
    const rotationDeg = Number(options.rotationDeg) || 0;
    const rotationRad = -rotationDeg * Math.PI / 180;
    const cos = rotationDeg ? Math.cos(rotationRad) : 1;
    const sin = rotationDeg ? Math.sin(rotationRad) : 0;
    let pivotX = 0;
    let pivotZ = 0;
    let translateX = 0;
    let translateZ = 0;

    if (rotationDeg) {
      const maxCellX = cells.length ? Math.max(...cells.map(cell => Number(cell.x) || 0)) : gridCenter + 3;
      const maxCellZ = cells.length ? Math.max(...cells.map(cell => Number(cell.y) || 0)) : gridCenter + 3;
      const footprintWidth = maxCellX - minCellX + 1;
      const footprintDepth = maxCellZ - minCellZ + 1;
      pivotX = (Number(gridX) || 0) + footprintWidth / 2;
      pivotZ = (Number(gridZ) || 0) + footprintDepth / 2;
      if (rotationDeg === 90 || rotationDeg === 270) {
        translateX = (footprintDepth - footprintWidth) / 2;
        translateZ = (footprintWidth - footprintDepth) / 2;
      }
    }

    return (face?.v || []).map(point => {
      let x = Number(point?.[0]) + offsetX;
      let z = Number(point?.[2]) + offsetZ;
      if (rotationDeg) {
        const px = x - pivotX;
        const pz = z - pivotZ;
        x = px * cos - pz * sin + pivotX + translateX;
        z = px * sin + pz * cos + pivotZ + translateZ;
      }
      return [x, Number(point?.[1]) + offsetY, z];
    });
  }

  function triangulatedPositions(vertices) {
    if (!Array.isArray(vertices) || vertices.length !== 4) return null;
    return [vertices[0], vertices[1], vertices[2], vertices[0], vertices[2], vertices[3]].flat();
  }

  function meshMatchesPositions(mesh, expected) {
    const position = mesh?.geometry?.getAttribute?.('position');
    if (!position || position.count !== 6 || !expected || expected.length !== 18) return false;
    for (let index = 0; index < 6; index += 1) {
      const offset = index * 3;
      if (Math.abs(position.getX(index) - expected[offset]) > MATCH_EPSILON
          || Math.abs(position.getY(index) - expected[offset + 1]) > MATCH_EPSILON
          || Math.abs(position.getZ(index) - expected[offset + 2]) > MATCH_EPSILON) return false;
    }
    return true;
  }

  function vertexKey(point) {
    const inv = 1 / MATCH_EPSILON;
    return `${Math.round(point[0] * inv)},${Math.round(point[1] * inv)},${Math.round(point[2] * inv)}`;
  }

  function edgeKey(a, b) {
    const ka = vertexKey(a);
    const kb = vertexKey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  }

  function faceNormalAndArea(vertices) {
    const a = new THREE.Vector3().fromArray(vertices[0]);
    const b = new THREE.Vector3().fromArray(vertices[1]);
    const c = new THREE.Vector3().fromArray(vertices[2]);
    const cross = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    const twiceArea = cross.length();
    if (twiceArea < 1e-10) return { normal: new THREE.Vector3(0, 1, 0), area: 0 };
    return { normal: cross.multiplyScalar(1 / twiceArea), area: twiceArea * 0.5 };
  }

  // Topology-first surface recognition. Faces only join when they share an
  // authored edge, remain within the smooth-angle threshold, AND use the same
  // porch material family. This lets deck boards flow across tiles without a
  // fence face enlarging or rotating the deck's UV frame.
  function detectConnectedSurfaceIslands(records) {
    const edgeOwners = new Map();
    const neighbors = Array.from({ length: records.length }, () => new Set());
    const cosThreshold = Math.cos(SURFACE_SPLIT_ANGLE_DEG * Math.PI / 180);

    records.forEach((record, index) => {
      for (let edge = 0; edge < 4; edge += 1) {
        const key = edgeKey(record.vertices[edge], record.vertices[(edge + 1) % 4]);
        const owners = edgeOwners.get(key) || [];
        owners.push(index);
        edgeOwners.set(key, owners);
      }
    });

    for (const owners of edgeOwners.values()) {
      for (let a = 0; a < owners.length; a += 1) {
        for (let b = a + 1; b < owners.length; b += 1) {
          const ia = owners[a];
          const ib = owners[b];
          const classA = records[ia].surfaceClass || surfaceClassForTag(records[ia].tag);
          const classB = records[ib].surfaceClass || surfaceClassForTag(records[ib].tag);
          if (classA !== classB) continue;
          if (records[ia].normal.dot(records[ib].normal) + 1e-7 < cosThreshold) continue;
          neighbors[ia].add(ib);
          neighbors[ib].add(ia);
        }
      }
    }

    const visited = new Uint8Array(records.length);
    const islands = [];
    for (let start = 0; start < records.length; start += 1) {
      if (visited[start]) continue;
      visited[start] = 1;
      const stack = [start];
      const island = [];
      while (stack.length) {
        const index = stack.pop();
        island.push(records[index]);
        for (const neighbor of neighbors[index]) {
          if (visited[neighbor]) continue;
          visited[neighbor] = 1;
          stack.push(neighbor);
        }
      }
      islands.push(island);
    }
    return islands;
  }

  function projectionBasis(normal) {
    const candidates = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1, 0),
    ];
    let u = null;
    for (const candidate of candidates) {
      const projected = candidate.clone().addScaledVector(normal, -candidate.dot(normal));
      if (projected.lengthSq() > 1e-6) {
        u = projected.normalize();
        break;
      }
    }
    if (!u) u = new THREE.Vector3(1, 0, 0);
    return { u, v: new THREE.Vector3().crossVectors(normal, u).normalize() };
  }

  // Computes one UV frame for an entire connected island, so neighboring
  // map-tile quads sample adjacent portions of the same texture square.
  function applyIslandUvs(island, islandIndex) {
    const normal = new THREE.Vector3();
    for (const record of island) normal.addScaledVector(record.normal, Math.max(record.area, 1e-8));
    if (normal.lengthSq() < 1e-10) normal.set(0, 1, 0);
    else normal.normalize();
    const basis = projectionBasis(normal);

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const record of island) {
      for (const point of record.vertices) {
        const p = new THREE.Vector3().fromArray(point);
        const u = p.dot(basis.u);
        const v = p.dot(basis.v);
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
      }
    }
    const spanU = Math.max(1e-6, maxU - minU);
    const spanV = Math.max(1e-6, maxV - minV);

    for (const record of island) {
      const geometry = record.mesh?.geometry;
      const position = geometry?.getAttribute?.('position');
      if (!position) continue;
      const uv = new Float32Array(position.count * 2);
      const p = new THREE.Vector3();
      for (let index = 0; index < position.count; index += 1) {
        p.set(position.getX(index), position.getY(index), position.getZ(index));
        uv[index * 2] = (p.dot(basis.u) - minU) / spanU;
        uv[index * 2 + 1] = (p.dot(basis.v) - minV) / spanV;
      }
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      record.mesh.material = materialForTag(record.tag);
      record.mesh.userData = record.mesh.userData || {};
      record.mesh.userData.hobunjiPorchSurfaceMaterial = {
        tag: record.tag,
        surfaceClass: record.surfaceClass,
        texture: texturePathForTag(record.tag),
        tint: WOOD_TINT,
        mapping: 'stretch-to-connected-surface-island',
        islandIndex,
        islandFaceCount: island.length,
        splitAngleDeg: SURFACE_SPLIT_ANGLE_DEG,
      };
    }
  }

  function applyToBuiltGroup(group, pieceData, gridX, gridZ, options = {}) {
    const piece = normalizePiece(pieceData);
    const faces = Array.isArray(piece?.base?.faces) ? piece.base.faces : [];
    const candidates = [];
    group?.traverse?.(node => { if (node?.isMesh && node.geometry) candidates.push(node); });
    const used = new Set();
    const records = [];
    let missing = 0;

    for (const face of faces) {
      const tag = String(face?.tag || '');
      if (!PORCH_TAGS.has(tag) || face?.extensionFace === 'floor') continue;
      const vertices = transformedFaceVertices(piece, face, gridX, gridZ, options);
      const expected = triangulatedPositions(vertices);
      const mesh = candidates.find(candidate => !used.has(candidate) && meshMatchesPositions(candidate, expected));
      if (!mesh) {
        missing += 1;
        continue;
      }
      used.add(mesh);
      const { normal, area } = faceNormalAndArea(vertices);
      records.push({
        face,
        tag,
        surfaceClass: surfaceClassForTag(tag),
        mesh,
        vertices,
        normal,
        area,
      });
    }

    const islands = detectConnectedSurfaceIslands(records);
    islands.forEach((island, index) => applyIslandUvs(island, index));
    const converted = records.length;
    const largestIslandFaces = islands.reduce((max, island) => Math.max(max, island.length), 0);
    const deckFaces = records.filter(record => record.surfaceClass === 'deck').length;
    const fenceFaces = records.filter(record => record.surfaceClass === 'fence').length;

    totalConvertedFaces += converted;
    totalSurfaceIslands += islands.length;
    lastBuild = {
      pieceId: piece?.id || piece?.name || null,
      gridX: Number(gridX) || 0,
      gridZ: Number(gridZ) || 0,
      rotationDeg: Number(options.rotationDeg) || 0,
      converted,
      missing,
      deckFaces,
      fenceFaces,
      surfaceIslands: islands.length,
      largestIslandFaces,
    };
    if (converted || missing) {
      log(`${lastBuild.pieceId || 'piece'}: ${deckFaces} board face(s), ${fenceFaces} carved fence face(s), ${islands.length} island(s), ${missing} unmatched`);
    }
    return { converted, missing, deckFaces, fenceFaces, surfaceIslands: islands.length, largestIslandFaces };
  }

  function installPatch() {
    const originalBuild = housePieces.buildGroupFromPiece;
    if (typeof originalBuild !== 'function' || originalBuild.__porchSurfaceMaterialPatched) return false;
    const wrappedBuild = function porchSurfaceMaterialBuild(...args) {
      const group = originalBuild.apply(this, args);
      try { applyToBuiltGroup(group, args[1], args[2], args[3], args[4] || {}); }
      catch (error) { log(`surface replacement failed: ${error?.message || error}`, 'warn'); }
      return group;
    };
    Object.assign(wrappedBuild, originalBuild);
    wrappedBuild.__porchSurfaceMaterialPatched = true;
    wrappedBuild.__originalPorchSurfaceMaterialBuild = originalBuild;
    housePieces.buildGroupFromPiece = wrappedBuild;
    return true;
  }

  installPatch();

  function debugSnapshot() {
    return {
      installed: true,
      deckTexturePath: DECK_TEXTURE_PATH,
      fenceTexturePath: FENCE_TEXTURE_PATH,
      woodTint: WOOD_TINT,
      textureStatus: {
        deck: textureStatus.get(DECK_TEXTURE_PATH) || 'not-requested',
        fence: textureStatus.get(FENCE_TEXTURE_PATH) || 'not-requested',
      },
      mapping: 'stretch-to-connected-surface-island',
      surfaceSplitAngleDeg: SURFACE_SPLIT_ANGLE_DEG,
      tags: [...PORCH_TAGS],
      totalConvertedFaces,
      totalSurfaceIslands,
      lastBuild: lastBuild ? { ...lastBuild } : null,
      patchInstalled: !!housePieces.buildGroupFromPiece?.__porchSurfaceMaterialPatched,
      elevationPatchPreserved: !!housePieces.buildGroupFromPiece?.__walkableElevationPatched,
    };
  }

  window.HobunjiPorchSurfaceMaterial = Object.freeze({
    installed: true,
    deckTexturePath: DECK_TEXTURE_PATH,
    fenceTexturePath: FENCE_TEXTURE_PATH,
    woodTint: WOOD_TINT,
    surfaceSplitAngleDeg: SURFACE_SPLIT_ANGLE_DEG,
    surfaceClassForTag,
    texturePathForTag,
    applyToBuiltGroup,
    detectConnectedSurfaceIslands,
    debugSnapshot,
  });
  window.__porchSurfaceMaterialDebug = debugSnapshot;
})();
