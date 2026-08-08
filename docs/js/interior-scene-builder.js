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
  function buildCavernWalls(THREE, wallPanels) {
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
    const mat = new THREE.MeshLambertMaterial({ color: 0x5f5a56, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.userData.cameraObstacle = true;
    group.add(mesh);
    return group;
  }

  // Flat cloth-colored wall panels for a canvas tent interior, tinted to
  // match the exterior tent piece's canvas material (HousePieceGen's
  // matCanvas, 0xcbb489). Exact port of game.js's buildCanvasWalls.
  function buildCanvasWalls(THREE, wallPanels) {
    return buildCanvasWallsWithColor(THREE, wallPanels, 0xcbb489);
  }

  function buildCanvasWallsWithColor(THREE, wallPanels, color) {
    const group = new THREE.Group();
    if (!wallPanels.length) return group;
    const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    const pos = [], idx = []; let vi = 0;
    for (const panel of wallPanels) {
      const [bl, br, tr, tl] = panelCornersFor(THREE, panel);
      pos.push(bl.x, bl.y, bl.z, br.x, br.y, br.z, tr.x, tr.y, tr.z, tl.x, tl.y, tl.z);
      idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.userData.cameraObstacle = true;
    group.add(mesh);
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

  // wallStyle dispatch — brick (default, via WallBuilder) / cavern / canvas.
  // wbOpts defaults match game.js's INTERIOR_WALL_PANELS build() call exactly
  // (50% brick size, 4x density via rockScale, 60% depth, micro-jitter).
  const DEFAULT_WB_OPTS = { unitMult: 0.5, rockScale: 1.5, preScale: [1, 1, 0.6], brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };

  function buildWallGroup(THREE, wallBuilder, wallPanels, wallStyle, wbOpts) {
    if (!wallPanels || !wallPanels.length) return new THREE.Group();
    if (wallStyle === 'cavern') return buildCavernWalls(THREE, wallPanels);
    if (wallStyle === 'canvas') return buildCanvasWalls(THREE, wallPanels);
    if (wallBuilder) {
      try { return wallBuilder.build(wallPanels, Object.assign({}, DEFAULT_WB_OPTS, wbOpts)); }
      catch (e) { console.warn('InteriorSceneBuilder.buildWallGroup: WallBuilder error, using fallback boxes: ' + e.message); }
    }
    return buildFallbackBoxWalls(THREE, wallPanels);
  }

  // wallStyle-aware floor material — boards.png-textured plank floor by
  // default, flat bare-color floors for cavern (dirt/stone) and canvas
  // (packed dirt under a groundsheet). texturesBasePath should point at the
  // directory containing textures/boards.png (e.g. 'assets/' from game.js,
  // '../../assets/' from a docs/tools/<tool>/ page).
  function buildFloorMaterial(THREE, wallStyle, texturesBasePath) {
    const mat = wallStyle === 'cavern'
      ? new THREE.MeshLambertMaterial({ color: 0x4a463f })
      : wallStyle === 'canvas'
      ? new THREE.MeshLambertMaterial({ color: 0x8a7a5c })
      : new THREE.MeshLambertMaterial({ color: 0x8b6914 });
    if (wallStyle !== 'cavern' && wallStyle !== 'canvas') {
      const base = texturesBasePath || 'assets/';
      new THREE.TextureLoader().load(base + 'textures/boards.png', (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
      }, undefined, () => {});
    }
    return mat;
  }

  root.InteriorSceneBuilder = {
    buildWallPanels, buildWallGroup, buildFloorMaterial,
    buildCavernWalls, buildCanvasWalls, buildFallbackBoxWalls, panelCornersFor,
  };
})(window);
