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

  function applyTownCliffMaterial(THREE, mesh, fallbackMaterial, surfacePreset = 'farm-cliff') {
    const natural = root.NaturalSurfaceMaterials; // Used by ordinary mines/dens for the existing cliff material and by opted-in locales for the farm's canonical rock material factory.
    const farmCliffParity = surfacePreset === 'farm-cliff'; // Every cavern wall now finishes like farm cliffs; data can still opt back out with surfaceMaterial: 'town-cliffs'.
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

  // ── Wall panel derivation — exact port of game.js's buildWallPanelsFromFloorSet ──
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

  // Rectangular-room wall panels (moved out of game.js's
  // buildWallPanelsForRoom): walls always sit at the footprint boundary, with
  // a 2-tile door gap cut in whichever wall the exit transition sits on,
  // centred on the transition column/row.
  function buildRoomWallPanels(cols, rows, wallHeight, exitTransition) {
    const DOOR_W = 2;
    const panels = [];
    // Determine which wall the exit is on (S/N/W/E) by proximity to boundary
    let doorWall = null, doorPos = 0;
    if (exitTransition) {
      const { col: ec, row: er } = exitTransition;
      const dS = rows - 1 - er, dN = er, dE = cols - 1 - ec, dW = ec;
      const minD = Math.min(dS, dN, dE, dW);
      if      (minD === dS) { doorWall = 'S'; doorPos = ec; }
      else if (minD === dN) { doorWall = 'N'; doorPos = ec; }
      else if (minD === dE) { doorWall = 'E'; doorPos = er; }
      else                  { doorWall = 'W'; doorPos = er; }
    }
    const splitH = (wallId, z, rot, along) => {
      if (doorWall === along) {
        const gapStart = Math.max(0, doorPos - Math.floor(DOOR_W / 2));
        const gapEnd   = Math.min(cols, gapStart + DOOR_W);
        if (gapStart > 0)    panels.push({ id: wallId + '_l', width: gapStart,        height: wallHeight, position: [gapStart / 2,            0, z], rotationDeg: rot });
        if (gapEnd < cols)   panels.push({ id: wallId + '_r', width: cols - gapEnd,   height: wallHeight, position: [(gapEnd + cols) / 2,     0, z], rotationDeg: rot });
      } else {
        panels.push({ id: wallId, width: cols, height: wallHeight, position: [cols / 2, 0, z], rotationDeg: rot });
      }
    };
    const splitV = (wallId, x, rot, along) => {
      if (doorWall === along) {
        const gapStart = Math.max(0, doorPos - Math.floor(DOOR_W / 2));
        const gapEnd   = Math.min(rows, gapStart + DOOR_W);
        if (gapStart > 0)    panels.push({ id: wallId + '_l', width: gapStart,        height: wallHeight, position: [x, 0, gapStart / 2],            rotationDeg: rot });
        if (gapEnd < rows)   panels.push({ id: wallId + '_r', width: rows - gapEnd,   height: wallHeight, position: [x, 0, (gapEnd + rows) / 2],     rotationDeg: rot });
      } else {
        panels.push({ id: wallId, width: rows, height: wallHeight, position: [x, 0, rows / 2], rotationDeg: rot });
      }
    };
    splitH('wn', 0,    [0, 0,    0], 'N');
    splitH('ws', rows, [0, 180,  0], 'S');
    splitV('ww', 0,    [0, 90,   0], 'W');
    splitV('we', cols, [0, -90,  0], 'E');
    return panels;
  }

  // Same corner math as WallBuilder.js's panelCorners/panelMatrix (kept
  // duplicated rather than imported — WallBuilder's build() pipeline is built
  // around scattering instanced brick props onto this quad, not exposing the
  // quad itself; cavern/canvas walls need the bare quad instead). Matches
  // game.js's own panelCornersFor exactly.
  function panelCornersFor(THREE, p) {
    const w = p.width / 2, h = p.height;
    const base = [
      new THREE.Vector3(-w, 0, 0), new THREE.Vector3(w, 0, 0),
      new THREE.Vector3(w, h, 0), new THREE.Vector3(-w, h, 0),
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

  // Cavern interior walls: a solid, boulder-mound-bumped rock quad per
  // boundary panel — same buildRockMoundBumpField technique TerrainPreview
  // uses for rock formations/animal dens, so a den's cavern walls read as the
  // same rock as its mouth outside. Exact port of game.js's buildCavernWalls.
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
    const texture = options.textureUrl ? new THREE.TextureLoader().load(options.textureUrl) : null; // Used only as the unlit fallback when NaturalSurfaceMaterials is unavailable in a standalone tool.
    if (texture) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(options.textureRepeat || .42, options.textureRepeat || .42);
      if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    }
    const fallbackMat = new THREE.MeshBasicMaterial({ color: options.color ?? 0x5f5a56, map: texture, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (texture) {
      const uv = new Float32Array(pos.length / 3 * 2); // Used to project the fallback stone texture consistently across every vertical mine wall orientation.
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

  // Carved cavern shell — floor, walls, and ceiling as one organic
  // low-poly rock mesh, produced by CavernSculptor's SDF carve + dual
  // contour extraction (see cavern-sculptor.js / cavern-generator.js's
  // generateCavernFloor). Mines and dens both use the canonical town-cliff
  // natural-surface material so their rock color/PNG/light model cannot drift.
  function buildCarvedCavernMesh(THREE, meshData, options = {}) {
    if (!meshData || !meshData.positions || !meshData.positions.length) return new THREE.Group();
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(meshData.positions); // Scene-local copy keeps height adjustments out of the cached generated shell.
    const heightScale = Math.max(1, Number(meshData.wallHeightScale) || 1); // Ruin caves stretch their walls upward while ordinary caves retain authored height.
    const heightBase = Number(meshData.wallHeightBaseY) || 0; // Highest walkable floor sample anchors wall growth without moving the floor.
    if (heightScale !== 1) for (let i = 1; i < positions.length; i += 3) if (positions[i] > heightBase) positions[i] = heightBase + (positions[i] - heightBase) * heightScale;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    // Keep fallback UVs for standalone tools that do not load the natural-
    // surface stack. In the game, NaturalSurfaceMaterials (and its shared
    // furniture-style surface mapper wrapper) replaces these with the same
    // connected-surface full-PNG mapping used by town cliffs.
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
    const texture = options.textureUrl ? new THREE.TextureLoader().load(options.textureUrl) : null; // Used only as an unlit fallback outside the main game's natural-surface stack.
    if (texture) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(options.textureRepeat || 0.35, options.textureRepeat || 0.35);
      if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    }
    // Dual-contour winding faces the carved air volume, so FrontSide shows
    // the playable tunnel shell while culling reverse faces seen from solid
    // inter-tunnel pockets. DoubleSide made those pockets look like rooms.
    const materialOptions = { color: options.color ?? 0x5f5a56, map: texture, flatShading: !texture, side: THREE.FrontSide };
    const fallbackMat = new THREE.MeshBasicMaterial(materialOptions);
    const mesh = new THREE.Mesh(geo, fallbackMat);
    applyTownCliffMaterial(THREE, mesh, fallbackMat, options.surfaceMaterial || meshData.surfaceMaterial || 'farm-cliff');
    mesh.receiveShadow = true;
    mesh.userData.cameraObstacle = true;
    mesh.userData.hobunjiGroundTopFacesOnly = true; // HeldObjectRenderOrder lets weapons x-ray this shell's floor faces (just under the walkable floor) while its walls still occlude.
    return mesh;
  }

  const _cavernFloorTextures = new Map(); // url|repeat -> texture; every cavern build reuses one decoded/GPU copy instead of reloading it.
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
    const tiles = Array.isArray(floorTiles) ? floorTiles : []; // One merged geometry keeps the authored walkable floor to a single draw call even for a large cave footprint.
    if (!tiles.length) return new THREE.Group();
    const positions = [], uvs = [], indices = [];
    let vertex = 0;
    const defaultY = Number.isFinite(Number(options.defaultY)) ? Number(options.defaultY) : 0;
    const visualLift = Number.isFinite(Number(options.visualLift)) ? Number(options.visualLift) : 0.003; // Tiny render-only separation prevents z-fighting with the carved shell; gameplay remains on the sampled surface itself.
    for (const tile of tiles) {
      const col = Number(tile?.[0]), row = Number(tile?.[1]);
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      const sampled = Number(floorSurfaceByTile?.[`${col},${row}`]);
      const y = (Number.isFinite(sampled) ? sampled : defaultY) + visualLift;
      positions.push(
        col,     y, row,
        col + 1, y, row,
        col + 1, y, row + 1,
        col,     y, row + 1,
      );
      uvs.push(col, row, col + 1, row, col + 1, row + 1, col, row + 1); // Standalone fallback only; the gameplay mapper below replaces these world-tiled UVs with one 0..1 domain per connected floor surface.
      indices.push(vertex, vertex + 2, vertex + 1, vertex, vertex + 3, vertex + 2);
      vertex += 4;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const texture = !options.wallMaterial && options.textureUrl ? cavernFloorTexture(THREE, options.textureUrl, Number(options.textureRepeat) || 0.35) : null; // Gameplay reuses the wall's already-loaded material and PNG.
    const farmCliffParity = (options.surfaceMaterial || 'farm-cliff') === 'farm-cliff'; // Match the shell's default natural-surface preset exactly.
    const fallbackMaterial = options.wallMaterial || new THREE.MeshBasicMaterial({ color: options.color ?? 0x5f5a56, map: texture, side: THREE.FrontSide }); // Upward floor triangles share the shell's unlit material, tint, and lighting model.
    const mesh = new THREE.Mesh(geometry, fallbackMaterial);
    mesh.name = options.name || 'cavern_walkable_floor';

    if (!options.wallMaterial) applyTownCliffMaterial(THREE, mesh, fallbackMaterial, options.surfaceMaterial || 'farm-cliff');

    const mapper = root.HobunjiSurfaceStretchUV; // Shared current 32%-edge mapper used by farm/town natural surfaces; this replaces the floor's old tiled world UVs for mines, dens, Banubu, and Color Pools alike.
    if (typeof mapper?.mapMesh === 'function') {
      clearSurfaceStretchCache(mesh.geometry);
      const report = mapper.mapMesh(mesh, {
        label: farmCliffParity ? 'interior-cavern-floor:farm-cliff' : 'interior-cavern-floor:current-surface',
        maxPatchWorldSize: 6,
      });
      if (report) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; // Mapper owns geometry only; normalize every floor texture to one full source-PNG domain so old RepeatWrapping cannot reintroduce tiling.
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
      hobunjiGroundSurface: true, // HeldObjectRenderOrder removes cavern floors from weapon depth occlusion just like exterior terrain.
    });
    return mesh;
  }

  // Canvas tent interior walls use the same canvas.png as the exterior.
  // Every canonical boundary panel remains its own real PlaneGeometry so wall
  // picking/debugging sees the same surface the player sees. PlaneGeometry's
  // native 0..1 UVs also preserve main's one-full-canvas.png-per-wall stretch.
  function buildCanvasWalls(THREE, wallPanels) {
    return buildCanvasWallsWithColor(THREE, wallPanels, 0xcbb489);
  }

  function buildCanvasWallsWithColor(THREE, wallPanels, color) {
    const group = new THREE.Group();
    if (!wallPanels.length) return group;
    const texture = canvasTexture(THREE); // Shared image; each PlaneGeometry owns a fresh 0..1 UV field.
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

  // Flat box panels — last-resort fallback when neither WallBuilder nor a
  // wallStyle-specific builder is available (e.g. WallBuilder.js failed to
  // load). Not part of any in-game visual, purely an editor safety net.
  // BoxGeometry is center-anchored but panel.position is floor-referenced
  // (same bottom-anchored convention as WallBuilder's panelCorners, y=0 at
  // the floor) — offset by height/2 so the box actually spans [0, height]
  // instead of floating half its own height above the floor.
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
    const rotationDeg = Array.isArray(panel.rotationDeg) ? panel.rotationDeg : [0, 0, 0]; // Used to derive the panel's horizontal tangent/normal from its canonical yaw.
    const yaw = (Number(rotationDeg[1]) || 0) * Math.PI / 180; // Converts canonical panel yaw into scalar X/Z basis math.
    const tangent = [Math.cos(yaw), 0, -Math.sin(yaw)]; // Local panel +X in world space, used for opening horizontal coordinates.
    const normal = [Math.sin(yaw), 0, Math.cos(yaw)]; // Local panel +Z in world space, used to reject openings on other walls.
    const openingNormalLength = Math.hypot(Number(opening.normal[0]) || 0, Number(opening.normal[2]) || 0) || 1; // Prevents invalid imported zero normals.
    const openingNormal = [(Number(opening.normal[0]) || 0) / openingNormalLength, 0, (Number(opening.normal[2]) || 0) / openingNormalLength]; // Normalized once for the wall-facing comparison.
    if (Math.abs(normal[0] * openingNormal[0] + normal[2] * openingNormal[2]) < 0.8) return [panel];

    const panelPosition = Array.isArray(panel.position) ? panel.position : [0, 0, 0]; // Floor-referenced center of the canonical wall panel.
    const deltaX = (Number(opening.center[0]) || 0) - (Number(panelPosition[0]) || 0); // Opening offset used for panel-local U.
    const deltaZ = (Number(opening.center[2]) || 0) - (Number(panelPosition[2]) || 0); // Opening offset used for panel-local U/depth.
    const depth = deltaX * normal[0] + deltaZ * normal[2]; // Distance between opening center and this wall plane.
    if (Math.abs(depth) > 0.35) return [panel];

    const panelWidth = Math.max(0, Number(panel.width) || 0); // Canonical wall width used to clip the opening to this panel.
    const panelHeight = Math.max(0, Number(panel.height) || 0); // Canonical wall height used to clip the opening vertically.
    const centerU = deltaX * tangent[0] + deltaZ * tangent[2]; // Opening center measured from panel center along local +X.
    const centerV = (Number(opening.center[1]) || 0) - (Number(panelPosition[1]) || 0); // Opening center measured from the panel floor.
    const halfWidth = Math.max(0, Number(opening.width) || 0) * 0.5; // Half silhouette width used by the rectangular subtraction.
    const halfHeight = Math.max(0, Number(opening.height) || 0) * 0.5; // Half silhouette height used by the rectangular subtraction.
    const u0 = Math.max(-panelWidth * 0.5, centerU - halfWidth); // Clipped opening left edge in panel-local coordinates.
    const u1 = Math.min(panelWidth * 0.5, centerU + halfWidth); // Clipped opening right edge in panel-local coordinates.
    const v0 = Math.max(0, centerV - halfHeight); // Clipped opening bottom edge above the wall floor.
    const v1 = Math.min(panelHeight, centerV + halfHeight); // Clipped opening top edge below the wall ceiling.
    if (u1 - u0 <= 1e-4 || v1 - v0 <= 1e-4) return [panel];

    const pieces = []; // Surviving wall rectangles around the aperture; these alone are sent to WallBuilder.
    const pushPiece = (pieceU0, pieceU1, pieceV0, pieceV1, part) => {
      const width = pieceU1 - pieceU0; // Sub-panel width used for its WallBuilder panel specification.
      const height = pieceV1 - pieceV0; // Sub-panel height used for its WallBuilder panel specification.
      if (width <= 1e-4 || height <= 1e-4) return;
      const localCenterU = (pieceU0 + pieceU1) * 0.5; // Horizontal sub-panel center offset from the original panel center.
      const localFloorV = pieceV0; // WallBuilder panel positions are floor-referenced, not vertically centered.
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
    let panels = Array.isArray(wallPanels) ? wallPanels.slice() : []; // Working panel list is split once per requested opening without mutating the canonical source.
    const openings = Array.isArray(wallOpenings) ? wallOpenings.filter(Boolean) : []; // Invalid/empty opening lists preserve the old wall path exactly.
    openings.forEach((opening, index) => {
      panels = panels.flatMap(panel => splitPanelForOpening(panel, opening, index)); // Re-splitting surviving rectangles supports multiple windows on one wall.
    });
    return panels;
  }

  // Wall openings (the same { center, normal, width, height } apertures the
  // farmhouse gets from HouseWindowLinkage) for every wall-mounted window in
  // an authored interior. Each opening is the window's visible frame outline
  // under its placed transform — root at (col + fw/2 + postX, floorY + postY,
  // row + fd/2 + postZ), yaw rotY, scale postSX/postSY — projected onto the
  // wall plane its wallAttachment was picked on.
  //   options.footprintOf(record) -> { fw, fd }   (defaults to 1x1)
  //   options.floorY                             (defaults to 0)
  const WINDOW_ORNAMENT_KEYS = { simpleWindowFurniture: 'simpleWindow', crossbarWindowFurniture: 'crossbarWindow', wideWindowFurniture: 'wideWindow' };
  function furnitureFloorElevation(record, sampledFloorY = 0) {
    // Wall attachments already store their authored height in room coordinates;
    // sampling a solid wall tile here would lift only the visual above its hole.
    return record?.wallAttachment ? 0 : (Number(sampledFloorY) || 0);
  }

  function windowWallOpenings(furniture, options = {}) {
    const silhouetteOf = root.DaylightWindowRuntime?.windowSilhouette;
    if (typeof silhouetteOf !== 'function') return [];
    const openings = [];
    for (const f of (Array.isArray(furniture) ? furniture : [])) {
      const key = f?.wallOrnamentKey || WINDOW_ORNAMENT_KEYS[f?.itemKey];
      const attachment = f?.wallAttachment;
      const silhouette = key ? silhouetteOf(key) : null;
      if (!silhouette || !attachment || !Array.isArray(attachment.wallPoint)) continue;
      const nx0 = Number(attachment.wallNormal?.[0]) || 0, nz0 = Number(attachment.wallNormal?.[2]) || 0;
      const nLen = Math.hypot(nx0, nz0);
      if (nLen < 1e-6) continue;
      const nx = nx0 / nLen, nz = nz0 / nLen;
      const gridFootprint = root.InteriorFurnitureGrid?.footprintForItem?.(f.itemKey); // Wide windows use the same footprint as their rendered furniture.
      const fp = options.footprintOf?.(f) || {fw:gridFootprint?.w,fd:gridFootprint?.d};
      const sx = Number.isFinite(Number(f.postSX)) ? Number(f.postSX) : (Number.isFinite(Number(f.postScale)) ? Number(f.postScale) : 1);
      const sy = Number.isFinite(Number(f.postSY)) ? Number(f.postSY) : (Number.isFinite(Number(f.postScale)) ? Number(f.postScale) : 1);
      const rootX = (Number(f.col) || 0) + (Number(fp.fw) || 1) * 0.5 + (Number(f.postX) || 0);
      const rootY = furnitureFloorElevation(f, options.floorY) + (Number(f.postY) || 0);
      const rootZ = (Number(f.row) || 0) + (Number(fp.fd) || 1) * 0.5 + (Number(f.postZ) || 0);
      const yaw = (Number(f.rotY) || 0) * Math.PI / 180;
      const lx = (silhouette.minX + silhouette.maxX) * 0.5 * sx, ly = (silhouette.minY + silhouette.maxY) * 0.5 * sy;
      let cx = rootX + lx * Math.cos(yaw), cz = rootZ - lx * Math.sin(yaw); // THREE yaw: x' = x cos + z sin, z' = -x sin + z cos (local z = 0).
      // Snap onto the wall plane the window was attached to (normalOffset can push the frame well off it).
      const px = Number(attachment.wallPoint[0]) || 0, pz = Number(attachment.wallPoint[2]) || 0;
      const depth = (cx - px) * nx + (cz - pz) * nz;
      cx -= depth * nx; cz -= depth * nz;
      openings.push({ id: f.id || key, center: [cx, rootY + ly, cz], normal: [nx, 0, nz], width: silhouette.width * Math.abs(sx), height: silhouette.height * Math.abs(sy) });
    }
    return openings;
  }

  // WallBuilder excludeQuads ([bottom-left, top-left, top-right, bottom-right])
  // for the same openings, for brick panels that can't be split into
  // rectangles (triangle-clipped gable ends).
  function openingExcludeQuads(openings) {
    return (Array.isArray(openings) ? openings : []).map(o => {
      const nx = Number(o.normal?.[0]) || 0, nz = Number(o.normal?.[2]) || 0;
      const tx = nz, tz = -nx, hw = (Number(o.width) || 0) / 2, hh = (Number(o.height) || 0) / 2;
      const [cx, cy, cz] = o.center;
      return [[cx - tx * hw, cy - hh, cz - tz * hw], [cx - tx * hw, cy + hh, cz - tz * hw], [cx + tx * hw, cy + hh, cz + tz * hw], [cx + tx * hw, cy - hh, cz + tz * hw]];
    });
  }

  // wallStyle dispatch — brick (default) / generated stacked logs / cavern / canvas.
  // wbOpts defaults match game.js's INTERIOR_WALL_PANELS build() call exactly
  // (50% brick size, 4x density via rockScale, 60% depth, micro-jitter).
  const DEFAULT_WB_OPTS = { unitMult: 0.5, rockScale: 1.5, preScale: [1, 1, 0.6], brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };

  function markInteriorWallSurfaceGroup(group) {
    if (group?.userData) { group.userData.surfaceFoliageRole = "walls"; group.userData.interiorWallSurfaceGroup = true; }
    return group;
  }

  // Every wall construction (brick, generated log, fallback box, mine, cavern) must pull the
  // follow camera in; only the canvas style used to carry the tag, so interior booms passed through
  // the other walls. game.js gathers tagged meshes once per building scene (occlusionMeshes).
  function tagCameraObstacles(group) {
    group?.traverse?.(node => { if (node.isMesh) node.userData.cameraObstacle = true; });
    return group;
  }

  function buildWallGroup(THREE, wallBuilder, wallPanels, wallStyle, wbOpts) {
    return tagCameraObstacles(buildWallGroupUntagged(THREE, wallBuilder, wallPanels, wallStyle, wbOpts));
  }

  function buildWallGroupUntagged(THREE, wallBuilder, wallPanels, wallStyle, wbOpts) {
    if (!wallPanels || !wallPanels.length) return markInteriorWallSurfaceGroup(new THREE.Group());
    const buildOptions = Object.assign({}, DEFAULT_WB_OPTS, wbOpts); // Copy keeps house-window-only options from leaking into WallBuilder.
    const renderPanels = applyWallOpenings(wallPanels, buildOptions.wallOpenings); // Silhouette holes are resolved before any brick/canvas/fallback geometry is created.
    const logOpeningQuads = openingExcludeQuads(buildOptions.wallOpenings); // Generated logs cut whole courses at openings instead of treating split strips as separate walls.
    delete buildOptions.wallOpenings;
    const farmColors = buildOptions.farmNaturalColors; // Farm-only finish never leaks into the WallBuilder options or other interiors.
    delete buildOptions.farmNaturalColors;
    const logWall = buildOptions.logWall || {}; // Serialized foliage-log settings consumed only by the generated-log wall style.
    delete buildOptions.logWall;
    const generatedLogStyle = ['log', 'logs', 'stackedlogs', 'stacked-logs'].includes(String(wallStyle || '').toLowerCase()); // Interior wall construction selector shared with the editor.
    const finishWalls = group => { // Uses the same semantic farm material role as the selected wall construction.
      markInteriorWallSurfaceGroup(group);
      if (farmColors) {
        const farmRole = generatedLogStyle ? 'wood' : 'stone'; // Log cabins inherit the farm's natural wood finish; brick walls retain natural stone.
        group.traverse(mesh => { if (mesh.isMesh) mesh.userData.farmMaterialRole = farmRole; });
        root.FarmWorldSettings?.tintInterior?.(group, farmColors);
      }
      return group;
    };
    if (wallStyle === 'cavern') return markInteriorWallSurfaceGroup(buildCavernWalls(THREE, renderPanels));
    if (wallStyle === 'mine') return markInteriorWallSurfaceGroup(buildCavernWalls(THREE, renderPanels, { textureUrl: buildOptions.mineTextureUrl || 'assets/textures/carved_smooth.png', color: 0x8a8d91, textureRepeat: .42 }));
    if (wallStyle === 'canvas') return markInteriorWallSurfaceGroup(buildCanvasWalls(THREE, renderPanels));
    if (generatedLogStyle && root.StackedLogWalls?.buildGroup) {
      try { return finishWalls(root.StackedLogWalls.buildGroup(THREE, wallPanels, Object.assign({}, logWall, { excludeQuads: logOpeningQuads }))); }
      catch (e) { console.warn('InteriorSceneBuilder.buildWallGroup: generated log build failed, using fallback boxes: ' + e.message); }
    }
    if (wallBuilder && !generatedLogStyle) {
      try { return finishWalls(wallBuilder.build(renderPanels, buildOptions)); }
      catch (e) { console.warn('InteriorSceneBuilder.buildWallGroup: WallBuilder error, using fallback boxes: ' + e.message); }
    }
    return finishWalls(buildFallbackBoxWalls(THREE, renderPanels));
  }

  // wallStyle-aware floor material — boards.png-textured plank floor by
  // default, flat bare-color floors for cavern (dirt/stone) and canvas
  // (packed dirt under a groundsheet). texturesBasePath should point at the
  // directory containing textures/boards.png (e.g. 'assets/' from game.js,
  // '../../assets/' from a docs/tools/<tool>/ page).
  function buildFloorMaterial(THREE, wallStyle, texturesBasePath, floorStyle = null, farmNaturalColors = null) {
    const mat = wallStyle === 'cavern'
      ? new THREE.MeshLambertMaterial({ color: 0x4a463f })
      : wallStyle === 'mine'
      ? new THREE.MeshLambertMaterial({ color: 0x8a8d91 })
      : wallStyle === 'canvas'
      ? new THREE.MeshLambertMaterial({ color: 0x8a7a5c })
      : new THREE.MeshLambertMaterial({ color: 0x8b6914 });
    const isFarmWood = !!farmNaturalColors && !['cavern', 'mine', 'canvas'].includes(wallStyle); // Only house and barn floors share the farm's natural wood finish.
    if (isFarmWood) {
      mat.userData = { ...mat.userData, farmInteriorTintOwned: true, farmMaterialRole: 'wood' };
      root.FarmWorldSettings?.tintMaterial?.(mat, 'wood', farmNaturalColors);
    }
    if (wallStyle === 'mine') {
      const base = texturesBasePath || 'assets/'; // Used to resolve the same stone texture from both the game and editor tool paths.
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
        mat.map = tex;
        if (isFarmWood) root.FarmWorldSettings?.tintMaterial?.(mat, 'wood', root.FarmWorldSettings.current());
        else mat.color.set(0xffffff);
        mat.needsUpdate = true;
      }, undefined, () => {});
    }
    return mat;
  }

  root.InteriorSceneBuilder = {
    DEFAULT_WB_OPTS, furnitureFloorElevation, windowWallOpenings, openingExcludeQuads, buildWallPanels, buildRoomWallPanels, buildWallGroup, buildFloorMaterial, applyWallOpenings,
    buildCavernWalls, buildCanvasWalls, buildFallbackBoxWalls, panelCornersFor,
    buildCarvedCavernMesh, buildCavernFloorMesh,
  };
})(window);
