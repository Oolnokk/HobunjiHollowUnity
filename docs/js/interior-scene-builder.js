// InteriorSceneBuilder — shared "what an interior actually looks like in the
// real game" renderer. Ported 1:1 from docs/game.js's loadBuildingScene()
// (the hobunji_building_interior.v1 branch): buildWallPanelsFromFloorSet's
// run-merged panel algorithm, buildCavernWalls (rock-mound-bumped quads for
// a den's cavern), buildCanvasWalls (flat cloth panels for a tent), and the
// wallStyle-aware floor material (boards.png texture vs. flat cavern/canvas
// colors). Single source of truth so the Interior Editor, Cutscene Director,
// and the live game never drift out of visual sync with each other.
//
// Usage:
//   const panels = InteriorSceneBuilder.buildWallPanels(floorSet, exitTileSet, wallHeight);
//   const wallGroup = InteriorSceneBuilder.buildWallGroup(THREE, wallBuilder, panels, wallStyle, wbOpts);
//   const floorMat  = InteriorSceneBuilder.buildFloorMaterial(THREE, wallStyle, texturesBasePath);
(function (root) {
  'use strict';

  const THREE_GLOBAL = root.THREE;
  if (!THREE_GLOBAL) { console.error('InteriorSceneBuilder: window.THREE not found — load three.js first'); return; }

  // Duplicated on purpose, same as terrain-preview.js/game.js each keep their
  // own copy — this constant is small, stable, and keeping it colocated with
  // buildCavernWalls (its only user here) avoids a hard load-order dependency
  // on TerrainPreview for anything except the bump-field math itself.
  const ROCK_MOUND_CELLS_PER_TILE = 6;
  const INTERIOR_CANVAS_TEXTURE_URL = (() => { // Used by every canvas-wall build so game/editor/cutscene resolve the same repo texture from the shared script location.
    try { return new URL('../assets/textures/canvas.png', document.currentScript?.src || location.href).href; }
    catch (_) { return 'assets/textures/canvas.png'; }
  })();
  let _interiorCanvasTexture = null; // Cached by canvasTexture() so all tent wall panels share one decoded/GPU texture while keeping independent UV islands.

  function canvasTexture(THREE) {
    if (_interiorCanvasTexture) return _interiorCanvasTexture;
    const texture = new THREE.TextureLoader().load(INTERIOR_CANVAS_TEXTURE_URL); // Used by buildCanvasWallsWithColor; each panel supplies its own 0..1 UV rectangle.
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    _interiorCanvasTexture = texture;
    return texture;
  }

  function clearSurfaceStretchCache(geometry) {
    if (!geometry) return;
    geometry.userData = Object.assign({}, geometry.userData || {});
    delete geometry.userData.hobunjiSurfaceStretchSignature;
    delete geometry.userData.hobunjiSurfaceStretch;
    delete geometry.userData.naturalSurfaceUvMapping;
  }

  function applyTownCliffMaterial(THREE, mesh, fallbackMaterial, surfacePreset = 'town-cliffs') {
    const natural = root.NaturalSurfaceMaterials; // Used by ordinary mines/dens for the existing cliff material and by opted-in locales for the farm's canonical rock material factory.
    const farmCliffParity = surfacePreset === 'farm-cliff'; // Gates the Banubu-specific material/UV path so unrelated cavern interiors keep their existing appearance.
    if (mesh?.isMesh && typeof natural?.naturalizeMesh === 'function') {
      mesh.material = fallbackMaterial;
      if (farmCliffParity) natural.naturalizeMesh(mesh, 'rocks', 'planar-stretch');
      else natural.naturalizeMesh(mesh, 'cliffs');
      if (farmCliffParity) {
        root.FacetedNaturalSurfaceShellReduction?.suppressMesh?.(mesh, 'rocks');
        const mapper = root.HobunjiSurfaceStretchUV; // Same Furniture + Avatar Author surface detector/stretch-to-fit mapper used by final farm/wilderness cliff passes.
        if (typeof mapper?.mapMesh === 'function') {
          clearSurfaceStretchCache(mesh.geometry); // NaturalSurfaceMaterials may already have run its generic wrapper; invalidate it so the farm-scale pass below is authoritative.
          mapper.mapMesh(mesh, { label: 'interior-cavern:farm-cliff', maxPatchWorldSize: 6 });
        }
      }
      mesh.userData = Object.assign({}, mesh.userData, {
        interiorCavernMaterialParity: farmCliffParity ? 'farm-cliffs' : 'town-cliffs',
        interiorCavernSurfaceMapping: farmCliffParity ? 'farm-connected-surface-stretch' : 'default',
      });
      return mesh.material;
    }
    return fallbackMaterial;
  }

  function buildWallPanels(floorSet, exitTileSet, wallHeight) {
    exitTileSet = exitTileSet || new Set();
    const nMap = {}, sMap = {}, eMap = {}, wMap = {};
    function pushH(map, key, x0, x1) { if (!map[key]) map[key] = []; map[key].push({ x0, x1 }); }
    function pushV(map, key, z0, z1) { if (!map[key]) map[key] = []; map[key].push({ z0, z1 }); }
    function mergeH(segs) {
      segs.sort((a, b) => a.x0 - b.x0);
      const out = [];
      for (const s of segs) {
        if (out.length && out[out.length - 1].x1 >= s.x0) out[out.length - 1].x1 = Math.max(out[out.length - 1].x1, s.x1);
        else out.push({ x0: s.x0, x1: s.x1 });
      }
      return out;
    }
    function mergeV(segs) {
      segs.sort((a, b) => a.z0 - b.z0);
      const out = [];
      for (const s of segs) {
        if (out.length && out[out.length - 1].z1 >= s.z0) out[out.length - 1].z1 = Math.max(out[out.length - 1].z1, s.z1);
        else out.push({ z0: s.z0, z1: s.z1 });
      }
      return out;
    }
    for (const key of floorSet) {
      const parts = key.split(',');
      const c = Number(parts[0]), r = Number(parts[1]);
      const isExit = exitTileSet.has(key);
      if (!floorSet.has(`${c},${r - 1}`) && !isExit) pushH(nMap, r,     c, c + 1);
      if (!floorSet.has(`${c},${r + 1}`) && !isExit) pushH(sMap, r + 1, c, c + 1);
      if (!floorSet.has(`${c + 1},${r}`) && !isExit) pushV(eMap, c + 1, r, r + 1);
      if (!floorSet.has(`${c - 1},${r}`) && !isExit) pushV(wMap, c,     r, r + 1);
    }
    const panels = [];
    let pid = 0;
    for (const [rStr, segs] of Object.entries(nMap)) {
      const z = Number(rStr);
      for (const seg of mergeH(segs)) {
        const w = seg.x1 - seg.x0, cx = (seg.x0 + seg.x1) / 2;
        panels.push({ id: `wn_${pid++}`, width: w, height: wallHeight, position: [cx, 0, z], rotationDeg: [0, 0, 0] });
      }
    }
    for (const [rStr, segs] of Object.entries(sMap)) {
      const z = Number(rStr);
      for (const seg of mergeH(segs)) {
        const w = seg.x1 - seg.x0, cx = (seg.x0 + seg.x1) / 2;
        panels.push({ id: `ws_${pid++}`, width: w, height: wallHeight, position: [cx, 0, z], rotationDeg: [0, 180, 0] });
      }
    }
    for (const [cStr, segs] of Object.entries(eMap)) {
      const x = Number(cStr);
      for (const seg of mergeV(segs)) {
        const d = seg.z1 - seg.z0, cz = (seg.z0 + seg.z1) / 2;
        panels.push({ id: `we_${pid++}`, width: d, height: wallHeight, position: [x, 0, cz], rotationDeg: [0, -90, 0] });
      }
    }
    for (const [cStr, segs] of Object.entries(wMap)) {
      const x = Number(cStr);
      for (const seg of mergeV(segs)) {
        const d = seg.z1 - seg.z0, cz = (seg.z0 + seg.z1) / 2;
        panels.push({ id: `ww_${pid++}`, width: d, height: wallHeight, position: [x, 0, cz], rotationDeg: [0, 90, 0] });
      }
    }
    return panels;
  }

  function panelCornersFor(THREE, p) {
    const w = p.width / 2, h = p.height;
    const base = [
      new THREE.Vector3(-w, 0, 0), new THREE.Vector3(w, 0, 0),
      new THREE.Vector3(w, h, 0),  new THREE.Vector3(-w, h, 0)
    ];
    const rd = p.rotationDeg || [0, 0, 0];
    const euler = new THREE.Euler(THREE.MathUtils.degToRad(rd[0] || 0), THREE.MathUtils.degToRad(rd[1] || 0), THREE.MathUtils.degToRad(rd[2] || 0), 'XYZ');
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(p.position[0], p.position[1], p.position[2]),
      new THREE.Quaternion().setFromEuler(euler),
      new THREE.Vector3(1, 1, 1)
    );
    return base.map(v => v.applyMatrix4(m));
  }

  function buildCavernWalls(THREE, wallPanels, options = {}) {
    const TP = root.TerrainPreview;
    if (!TP || !TP.buildRockMoundBumpField || !TP.sampleRockMoundBump) {
      console.warn('InteriorSceneBuilder.buildCavernWalls: TerrainPreview (with buildRockMoundBumpField) not loaded — falling back to flat rock panels.');
      return buildCanvasWallsWithColor(THREE, wallPanels, 0x5f5a56);
    }
    const pos = [], idx = []; let vi = 0;
    let panelSalt = 0;
    for (const panel of wallPanels) {
      const [bl, br, , tl] = panelCornersFor(THREE, panel);
      const ux = { x: br.x - bl.x, y: br.y - bl.y, z: br.z - bl.z };
      const vx = { x: tl.x - bl.x, y: tl.y - bl.y, z: tl.z - bl.z };
      let nx = ux.y * vx.z - ux.z * vx.y, ny = ux.z * vx.x - ux.x * vx.z, nz = ux.x * vx.y - ux.y * vx.x;
      const nlen = Math.hypot(nx, ny, nz) || 1; nx /= nlen; ny /= nlen; nz /= nlen;
      const segsU = Math.max(4, Math.round(panel.width * ROCK_MOUND_CELLS_PER_TILE)), segsV = Math.max(4, Math.round(panel.height * ROCK_MOUND_CELLS_PER_TILE));
      const bumpField = TP.buildRockMoundBumpField(panel.width, panel.height, bl.x, bl.z, 200 + (panelSalt++));
      const base = vi;
      for (let j = 0; j <= segsV; j++) for (let i = 0; i <= segsU; i++) {
        const u = i / segsU, v = j / segsV;
        const x = bl.x + ux.x * u + vx.x * v, y = bl.y + ux.y * u + vx.y * v, z = bl.z + ux.z * u + vx.z * v;
        const d = TP.sampleRockMoundBump(bumpField, u, v);
        pos.push(x + nx * d, y + ny * d, z + nz * d);
      }
      for (let j = 0; j < segsV; j++) for (let i = 0; i < segsU; i++) {
        const a = base + j * (segsU + 1) + i, b = a + 1, c0 = a + (segsU + 1), d2 = c0 + 1;
        idx.push(a, c0, d2, a, d2, b);
      }
      vi += (segsU + 1) * (segsV + 1);
    }
    const group = new THREE.Group();
    if (!idx.length) return group;
    const texture = options.textureUrl ? new THREE.TextureLoader().load(options.textureUrl) : null;
    if (texture) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(options.textureRepeat || .42, options.textureRepeat || .42);
      if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    }
    const fallbackMat = new THREE.MeshBasicMaterial({ color: options.color ?? 0x5f5a56, map: texture, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (texture) {
      const uv = new Float32Array(pos.length / 3 * 2);
      for (let p = 0, u = 0; p < pos.length; p += 3, u += 2) { uv[u] = pos[p] + pos[p + 2]; uv[u + 1] = pos[p + 1]; }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, fallbackMat);
    applyTownCliffMaterial(THREE, mesh, fallbackMat);
    mesh.receiveShadow = true;
    mesh.userData.cameraObstacle = true;
    group.add(mesh);
    return group;
  }

  function buildCarvedCavernMesh(THREE, meshData, options = {}) {
    if (!meshData || !meshData.positions || !meshData.positions.length) return new THREE.Group();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(meshData.positions, 3));
    if (options.textureUrl) {
      const uv = new Float32Array(meshData.positions.length / 3 * 2);
      const uvScale = options.uvScale || 1;
      for (let p = 0, u = 0; p < meshData.positions.length; p += 3, u += 2) {
        uv[u] = meshData.positions[p] * uvScale;
        uv[u + 1] = meshData.positions[p + 2] * uvScale;
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    const indices = meshData.indices;
    geo.setIndex(new THREE.BufferAttribute(indices.length > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 1));
    geo.computeVertexNormals();
    const texture = options.textureUrl ? new THREE.TextureLoader().load(options.textureUrl) : null;
    if (texture) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(options.textureRepeat || 0.35, options.textureRepeat || 0.35);
      if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    }
    const materialOptions = { color: options.color ?? 0x5f5a56, map: texture, flatShading: !texture, side: THREE.FrontSide };
    const fallbackMat = new THREE.MeshBasicMaterial(materialOptions);
    const mesh = new THREE.Mesh(geo, fallbackMat);
    applyTownCliffMaterial(THREE, mesh, fallbackMat, options.surfaceMaterial || meshData.surfaceMaterial || 'town-cliffs');
    mesh.receiveShadow = true;
    mesh.userData.cameraObstacle = true;
    return mesh;
  }

  const _cavernFloorTextures = new Map();
  function cavernFloorTexture(THREE, url, repeat) {
    const key = url + '|' + repeat;
    let texture = _cavernFloorTextures.get(key);
    if (texture) return texture;
    texture = new THREE.TextureLoader().load(url);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    _cavernFloorTextures.set(key, texture);
    return texture;
  }

  function buildCavernFloorMesh(THREE, floorTiles, floorSurfaceByTile, options = {}) {
    const tiles = Array.isArray(floorTiles) ? floorTiles : [];
    if (!tiles.length) return new THREE.Group();
    const positions = [], uvs = [], indices = [];
    let vertex = 0;
    const defaultY = Number.isFinite(Number(options.defaultY)) ? Number(options.defaultY) : 0;
    const visualLift = Number.isFinite(Number(options.visualLift)) ? Number(options.visualLift) : 0.003;
    for (const tile of tiles) {
      const col = Number(tile?.[0]), row = Number(tile?.[1]);
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      const sampled = Number(floorSurfaceByTile?.[`${col},${row}`]);
      const y = (Number.isFinite(sampled) ? sampled : defaultY) + visualLift;
      positions.push(col, y, row, col + 1, y, row, col + 1, y, row + 1, col, y, row + 1);
      uvs.push(col, row, col + 1, row, col + 1, row + 1, col, row + 1);
      indices.push(vertex, vertex + 2, vertex + 1, vertex, vertex + 3, vertex + 2);
      vertex += 4;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const texture = options.textureUrl ? cavernFloorTexture(THREE, options.textureUrl, Number(options.textureRepeat) || 0.35) : null;
    const farmCliffParity = (options.surfaceMaterial || '') === 'farm-cliff';
    const fallbackMaterial = farmCliffParity
      ? new THREE.MeshBasicMaterial({ color: options.color ?? 0x5f5a56, map: texture, side: THREE.DoubleSide })
      : new THREE.MeshLambertMaterial({ color: options.color ?? 0x5f5a56, map: texture, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, fallbackMaterial);
    mesh.name = options.name || 'cavern_walkable_floor';

    if (farmCliffParity) {
      const natural = root.NaturalSurfaceMaterials;
      if (typeof natural?.naturalizeMesh === 'function') natural.naturalizeMesh(mesh, 'rocks', 'planar-stretch');
      root.FacetedNaturalSurfaceShellReduction?.suppressMesh?.(mesh, 'rocks');
    }

    const mapper = root.HobunjiSurfaceStretchUV;
    if (typeof mapper?.mapMesh === 'function') {
      clearSurfaceStretchCache(mesh.geometry);
      const report = mapper.mapMesh(mesh, {
        label: farmCliffParity ? 'interior-cavern-floor:farm-cliff' : 'interior-cavern-floor:current-surface',
        maxPatchWorldSize: 6,
      });
      if (report) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          const map = material?.map;
          if (!map) continue;
          map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
          map.repeat?.set?.(1, 1);
          map.offset?.set?.(0, 0);
          map.center?.set?.(0, 0);
          map.rotation = 0;
          map.matrixAutoUpdate = true;
          map.needsUpdate = true;
        }
        mesh.userData = Object.assign({}, mesh.userData, {
          terrainJigsawIgnore: true,
          naturalSurfaceUvOwner: 'HobunjiSurfaceStretchUV',
          interiorCavernFloorSurfaceMapping: farmCliffParity ? 'farm-connected-surface-stretch' : 'current-connected-surface-stretch',
        });
      }
    }

    mesh.receiveShadow = true;
    mesh.userData = Object.assign({}, mesh.userData, {
      cavernWalkableFloor: true,
      hobunjiGroundSurface: true,
    });
    return mesh;
  }

  function buildCanvasWalls(THREE, wallPanels) {
    return buildCanvasWallsWithColor(THREE, wallPanels, 0xcbb489);
  }

  function buildCanvasWallsWithColor(THREE, wallPanels, color) {
    const group = new THREE.Group();
    if (!wallPanels.length) return group;
    const texture = canvasTexture(THREE);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: texture, side: THREE.DoubleSide });
    for (const panel of wallPanels) {
      const width = Math.max(0.001, Number(panel?.width) || 0.001);
      const height = Math.max(0.001, Number(panel?.height) || 0.001);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
      const rd = panel.rotationDeg || [0, 0, 0];
      mesh.position.set(Number(panel.position?.[0]) || 0, (Number(panel.position?.[1]) || 0) + height / 2, Number(panel.position?.[2]) || 0);
      mesh.rotation.set(THREE.MathUtils.degToRad(rd[0] || 0), THREE.MathUtils.degToRad(rd[1] || 0), THREE.MathUtils.degToRad(rd[2] || 0));
      mesh.name = `InteriorCanvasWall_${panel.id || group.children.length}`;
      mesh.receiveShadow = true;
      mesh.userData.cameraObstacle = true;
      mesh.userData.canvasSurfaceStretch = 'one-png-per-wall-panel';
      mesh.userData.interiorWallPanelId = panel.id || null;
      mesh.userData.interiorWallPlane = {
        position: Array.isArray(panel.position) ? panel.position.slice(0, 3) : [0, 0, 0],
        rotationDeg: Array.isArray(panel.rotationDeg) ? panel.rotationDeg.slice(0, 3) : [0, 0, 0],
        width,
        height,
      };
      group.add(mesh);
    }
    return group;
  }

  function buildFallbackBoxWalls(THREE, wallPanels, color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: color ?? 0x8a6a4a });
    wallPanels.forEach(p => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(p.width, p.height, 0.18), mat);
      m.position.set(p.position[0], p.position[1] + p.height / 2, p.position[2]);
      const rd = p.rotationDeg || [0, 0, 0];
      m.rotation.set(THREE.MathUtils.degToRad(rd[0] || 0), THREE.MathUtils.degToRad(rd[1] || 0), THREE.MathUtils.degToRad(rd[2] || 0));
      g.add(m);
    });
    return g;
  }

  function splitPanelForOpening(panel, opening, suffix) {
    if (!panel || !opening || !Array.isArray(opening.center) || !Array.isArray(opening.normal)) return [panel];
    const rotationDeg = Array.isArray(panel.rotationDeg) ? panel.rotationDeg : [0, 0, 0];
    const yaw = (Number(rotationDeg[1]) || 0) * Math.PI / 180;
    const tangent = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const normal = [Math.sin(yaw), 0, Math.cos(yaw)];
    const openingNormalLength = Math.hypot(Number(opening.normal[0]) || 0, Number(opening.normal[2]) || 0) || 1;
    const openingNormal = [(Number(opening.normal[0]) || 0) / openingNormalLength, 0, (Number(opening.normal[2]) || 0) / openingNormalLength];
    if (Math.abs(normal[0] * openingNormal[0] + normal[2] * openingNormal[2]) < 0.8) return [panel];

    const panelPosition = Array.isArray(panel.position) ? panel.position : [0, 0, 0];
    const deltaX = (Number(opening.center[0]) || 0) - (Number(panelPosition[0]) || 0);
    const deltaZ = (Number(opening.center[2]) || 0) - (Number(panelPosition[2]) || 0);
    const depth = deltaX * normal[0] + deltaZ * normal[2];
    if (Math.abs(depth) > 0.35) return [panel];

    const panelWidth = Math.max(0, Number(panel.width) || 0);
    const panelHeight = Math.max(0, Number(panel.height) || 0);
    const centerU = deltaX * tangent[0] + deltaZ * tangent[2];
    const centerV = (Number(opening.center[1]) || 0) - (Number(panelPosition[1]) || 0);
    const halfWidth = Math.max(0, Number(opening.width) || 0) * 0.5;
    const halfHeight = Math.max(0, Number(opening.height) || 0) * 0.5;
    const u0 = Math.max(-panelWidth * 0.5, centerU - halfWidth);
    const u1 = Math.min(panelWidth * 0.5, centerU + halfWidth);
    const v0 = Math.max(0, centerV - halfHeight);
    const v1 = Math.min(panelHeight, centerV + halfHeight);
    if (u1 - u0 <= 1e-4 || v1 - v0 <= 1e-4) return [panel];

    const pieces = [];
    const pushPiece = (pieceU0, pieceU1, pieceV0, pieceV1, part) => {
      const width = pieceU1 - pieceU0;
      const height = pieceV1 - pieceV0;
      if (width <= 1e-4 || height <= 1e-4) return;
      const localCenterU = (pieceU0 + pieceU1) * 0.5;
      const localFloorV = pieceV0;
      pieces.push(Object.assign({}, panel, {
        id: `${panel.id || 'wall'}:opening:${suffix}:${part}`,
        width,
        height,
        position: [
          (Number(panelPosition[0]) || 0) + tangent[0] * localCenterU,
          (Number(panelPosition[1]) || 0) + localFloorV,
          (Number(panelPosition[2]) || 0) + tangent[2] * localCenterU,
        ],
      }));
    };
    pushPiece(-panelWidth * 0.5, u0, 0, panelHeight, 'left');
    pushPiece(u1, panelWidth * 0.5, 0, panelHeight, 'right');
    pushPiece(u0, u1, 0, v0, 'bottom');
    pushPiece(u0, u1, v1, panelHeight, 'top');
    return pieces;
  }

  function applyWallOpenings(wallPanels, wallOpenings) {
    let panels = Array.isArray(wallPanels) ? wallPanels.slice() : [];
    const openings = Array.isArray(wallOpenings) ? wallOpenings.filter(Boolean) : [];
    openings.forEach((opening, index) => {
      panels = panels.flatMap(panel => splitPanelForOpening(panel, opening, index));
    });
    return panels;
  }

  const DEFAULT_WB_OPTS = { unitMult: 0.5, rockScale: 1.5, preScale: [1, 1, 0.6], brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };

  function markInteriorWallSurfaceGroup(group) {
    if (group?.userData) group.userData.interiorWallSurfaceGroup = true;
    return group;
  }

  function buildWallGroup(THREE, wallBuilder, wallPanels, wallStyle, wbOpts) {
    if (!wallPanels || !wallPanels.length) return markInteriorWallSurfaceGroup(new THREE.Group());
    const buildOptions = Object.assign({}, DEFAULT_WB_OPTS, wbOpts);
    const renderPanels = applyWallOpenings(wallPanels, buildOptions.wallOpenings);
    delete buildOptions.wallOpenings;
    if (wallStyle === 'cavern') return markInteriorWallSurfaceGroup(buildCavernWalls(THREE, renderPanels));
    if (wallStyle === 'mine') return markInteriorWallSurfaceGroup(buildCavernWalls(THREE, renderPanels, { textureUrl: buildOptions.mineTextureUrl || 'assets/textures/carved_smooth.png', color: 0x8a8d91, textureRepeat: .42 }));
    if (wallStyle === 'canvas') return markInteriorWallSurfaceGroup(buildCanvasWalls(THREE, renderPanels));
    if (wallBuilder) {
      try { return markInteriorWallSurfaceGroup(wallBuilder.build(renderPanels, buildOptions)); }
      catch (e) { console.warn('InteriorSceneBuilder.buildWallGroup: WallBuilder error, using fallback boxes: ' + e.message); }
    }
    return markInteriorWallSurfaceGroup(buildFallbackBoxWalls(THREE, renderPanels));
  }

  function buildFloorMaterial(THREE, wallStyle, texturesBasePath) {
    const mat = wallStyle === 'cavern'
      ? new THREE.MeshLambertMaterial({ color: 0x4a463f })
      : wallStyle === 'mine'
      ? new THREE.MeshLambertMaterial({ color: 0x8a8d91 })
      : wallStyle === 'canvas'
      ? new THREE.MeshLambertMaterial({ color: 0x8a7a5c })
      : new THREE.MeshLambertMaterial({ color: 0x8b6914 });
    if (wallStyle === 'mine') {
      const base = texturesBasePath || 'assets/';
      new THREE.TextureLoader().load(base + 'textures/carved_smooth.png', (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(.42, .42);
        if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex; mat.needsUpdate = true;
      }, undefined, () => {});
    } else if (wallStyle !== 'cavern' && wallStyle !== 'canvas') {
      const base = texturesBasePath || 'assets/';
      new THREE.TextureLoader().load(base + 'textures/boards.png', (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
      }, undefined, () => {});
    }
    return mat;
  }

  root.InteriorSceneBuilder = {
    buildWallPanels, buildWallGroup, buildFloorMaterial, applyWallOpenings,
    buildCavernWalls, buildCanvasWalls, buildFallbackBoxWalls, panelCornersFor,
    buildCarvedCavernMesh, buildCavernFloorMesh,
  };
})(window);

(function loadStackedLogWallIntegration(root) {
  if (!root.document || root.StackedLogWalls) return;
  const current = document.currentScript; // Used to resolve the adapter beside InteriorSceneBuilder for game/editor/cutscene consumers.
  const source = current?.src
    ? new URL('stacked-log-wall-integration.js', current.src).href
    : 'js/stacked-log-wall-integration.js'; // Used as a game-root fallback if currentScript is unavailable.
  if ([...document.scripts].some(script => script.src === source || script.dataset.stackedLogWallIntegration === '1')) return;
  const script = document.createElement('script'); // Loads one shared adapter instead of duplicating log-wall behavior in each consumer.
  script.src = source;
  script.async = false;
  script.dataset.stackedLogWallIntegration = '1';
  script.addEventListener('error', () => console.error('Could not load stacked-log-wall-integration.js'));
  document.head.appendChild(script);
})(window);
