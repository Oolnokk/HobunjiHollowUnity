(() => {
  'use strict';

  // Wilderness-zone terrain features that sit alongside js/zone-plateau-mesa.js's
  // elevated mesa tops: ramp surfaces/curtains (buildZoneRampMeshes/
  // buildRampCurtainMeshes), the unioned non-walkable rock layer covering ramp
  // sides and bare tier steps (buildRockFormationMeshes — plain plateau-cliff
  // spans are excluded, since buildPlateauMesa's own mesh already renders
  // those), and waterway meshes (buildWaterfallCurtainMeshes/
  // buildZoneRiverWaterMeshes). Extracted out of game.js following the same
  // window.<Namespace> + init(deps) pattern as its sibling systems. All four
  // are deterministic pure scene-graph generators driven entirely by the zone
  // grid passed in — no player/combat state — another clean candidate for
  // eventually running standalone (e.g. server-side world generation).
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function buildZoneRampMeshes(zScene, zGrid, zcols, zrows, mapId) {
    const rampCells = [];
    for (let r = 0; r < zrows; r++)
      for (let c = 0; c < zcols; c++)
        if (zGrid[r]?.[c]?.type === deps.TileType.RAMP) rampCells.push([c, r]);
    if (!rampCells.length) return;

    const cornerY = (ci, cj) => {
      let sum = 0, n = 0;
      for (const [dc, dr] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
        const t = zGrid[cj + dr]?.[ci + dc];
        if (t && t.type === deps.TileType.RAMP) { sum += deps.NORMAL_TOP + (t.rampElevation || 0) * deps.PLATEAU_UNIT; n++; }
      }
      return n ? sum / n : null;
    };

    const pos = [], uv = [], idx = [];
    let vi = 0;
    for (const [c, r] of rampCells) {
      const fallback = deps.NORMAL_TOP + (zGrid[r][c].rampElevation || 0) * deps.PLATEAU_UNIT;
      const y00 = cornerY(c, r)     ?? fallback;
      const y10 = cornerY(c+1, r)   ?? fallback;
      const y01 = cornerY(c, r+1)   ?? fallback;
      const y11 = cornerY(c+1, r+1) ?? fallback;
      pos.push(c,y00,r,  c+1,y10,r,  c,y01,r+1,  c+1,y11,r+1);
      uv.push(c,r,  c+1,r,  c,r+1,  c+1,r+1); // world-space (X,Z), same convention as _mergeTileGeos
      idx.push(vi,vi+2,vi+3, vi,vi+3,vi+1); vi += 4;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    deps.displaceZoneGeometry(geo, mapId);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, deps.resolveTileMat(mapId, deps.TileType.PATH));
    mesh.receiveShadow = true;
    zScene.add(mesh);
    deps.markTerrainEdgeId(mesh, deps.terrainCategoryFor(deps.TileType.PATH));

    console.log(`%c[zone:${mapId}] ramp mesh built: ${rampCells.length} tile(s)`, 'color:#22c55e;font-weight:bold');
  }

  // Ramp side curtains: a 1-tile sloped skirt on every cell flagged `rampCurtain`
  // (see buildZoneScene) — each corner takes the average height of whichever
  // adjacent RAMP cells touch it (same averaging buildZoneRampMeshes uses for
  // the ramp surface itself), falling back to the curtain cell's own natural
  // ground height at corners that don't touch a ramp. That tapers the skirt
  // from the ramp's edge down to ground over one tile — the same margin width
  // buildPlateauMesa uses for its cliff face — and picks up the same steep-face
  // stone skin so a ramp's sides read as a cut bank rather than floating grass.
  function buildRampCurtainMeshes(zScene, zGrid, zcols, zrows, mapId) {
    const cells = [];
    for (let r = 0; r < zrows; r++)
      for (let c = 0; c < zcols; c++)
        if (zGrid[r]?.[c]?.rampCurtain) cells.push([c, r]);
    if (!cells.length) return;

    const cornerY = (ci, cj, fallback) => {
      let sum = 0, n = 0;
      for (const [dc, dr] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
        const t = zGrid[cj + dr]?.[ci + dc];
        if (t && t.type === deps.TileType.RAMP) { sum += deps.NORMAL_TOP + (t.rampElevation || 0) * deps.PLATEAU_UNIT; n++; }
      }
      return n ? sum / n : fallback;
    };

    const pos = [], uv = [], idx = [];
    let vi = 0;
    for (const [c, r] of cells) {
      const ground = deps.NORMAL_TOP + (zGrid[r][c].elevTier || 0) * deps.PLATEAU_UNIT;
      const y00 = cornerY(c, r, ground);
      const y10 = cornerY(c + 1, r, ground);
      const y01 = cornerY(c, r + 1, ground);
      const y11 = cornerY(c + 1, r + 1, ground);
      pos.push(c, y00, r,  c + 1, y10, r,  c, y01, r + 1,  c + 1, y11, r + 1);
      uv.push(c,r,  c+1,r,  c,r+1,  c+1,r+1); // world-space (X,Z), same convention as _mergeTileGeos
      idx.push(vi, vi + 2, vi + 3, vi, vi + 3, vi + 1); vi += 4;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    deps.displaceZoneGeometry(geo, mapId);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, deps.resolveTileMat(mapId, deps.TileType.GRASS));
    mesh.receiveShadow = true;
    zScene.add(mesh);
    deps.markTerrainEdgeId(mesh, deps.terrainCategoryFor(deps.TileType.GRASS));

    // Steep ramp-curtain skin is now emitted by buildRockFormationMeshes,
    // after unioning ramp side spans with neighboring plateau cliff spans.

    console.log(`%c[zone:${mapId}] ramp curtain skirt built: ${cells.length} tile(s)`, 'color:#22c55e;font-weight:bold');
  }

  // Unified solved non-walkable rock layer. This mirrors
  // docs/js/terrain-preview.js buildRockFormationGeometry: semantic ramp
  // side spans and ramp/plateau seam spans (plus bare tier steps not
  // touching any plateau mesa) are unioned by tile edge before rendering,
  // so overlapping authored features become one continuous rocky
  // formation while walkable tops/ramp floors stay separate. Plain
  // plateau-cliff spans are excluded — buildPlateauMesa's own mesh
  // renders those directly with a stone material group now, so solving
  // them again here would just double them up.
  function buildRockFormationMeshes(zScene, zGrid, zcols, zrows, mapId) {
    const rampCornerYFor = (ci, cj, fallback = null) => {
      let sum = 0, n = 0;
      for (const [dc, dr] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
        const t = zGrid?.[cj + dr]?.[ci + dc];
        if (t && t.type === deps.TileType.RAMP) { sum += deps.NORMAL_TOP + (t.rampElevation || 0) * deps.PLATEAU_UNIT; n++; }
      }
      return n ? sum / n : fallback;
    };
    const cellCornerHeights = (c, r) => {
      const t = zGrid?.[r]?.[c];
      if (!t) return [deps.NORMAL_TOP, deps.NORMAL_TOP, deps.NORMAL_TOP, deps.NORMAL_TOP];
      if (t.type === deps.TileType.RAMP) {
        const fallback = deps.NORMAL_TOP + (t.rampElevation || 0) * deps.PLATEAU_UNIT;
        return [rampCornerYFor(c, r, fallback), rampCornerYFor(c + 1, r, fallback), rampCornerYFor(c, r + 1, fallback), rampCornerYFor(c + 1, r + 1, fallback)];
      }
      const y = deps.NORMAL_TOP + (t.elevTier || 0) * deps.PLATEAU_UNIT;
      return [y, y, y, y];
    };
    const hash01 = (x, z, salt) => {
      let h = (2166136261 ^ Math.imul(Math.round(x * 8) + salt, 374761393) ^ Math.imul(Math.round(z * 8) - salt, 668265263)) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      return h / 4294967296;
    };
    const spans = new Map();
    const add = (key, axis, x0, z0, x1, z1, top0, top1, bottom0, bottom1, kind) => {
      if (Math.max(top0, top1) - Math.min(bottom0, bottom1) <= 0.04) return;
      const prev = spans.get(key);
      if (!prev) spans.set(key, { key, axis, x0, z0, x1, z1, top0, top1, bottom0, bottom1, kinds: new Set([kind]) });
      else { prev.top0 = Math.max(prev.top0, top0); prev.top1 = Math.max(prev.top1, top1); prev.bottom0 = Math.min(prev.bottom0, bottom0); prev.bottom1 = Math.min(prev.bottom1, bottom1); prev.kinds.add(kind); }
    };
    const kindOf = (a, b) => (a?.type === deps.TileType.RAMP || b?.type === deps.TileType.RAMP) ? ((a?.incline || b?.incline) ? 'ramp_plateau_seam' : 'ramp_side') : ((a?.incline || b?.incline) ? 'plateau_cliff' : 'tier_seam');
    for (let r = 0; r < zrows; r++) for (let c = 0; c < zcols; c++) {
      const t = zGrid?.[r]?.[c]; if (!t) continue;
      const [, y10, y01, y11] = cellCornerHeights(c, r);
      for (const [dc, dr, side] of [[1,0,'E'],[0,1,'S']]) {
        const nt = zGrid?.[r + dr]?.[c + dc];
        const [ny00, ny10, ny01] = cellCornerHeights(c + dc, r + dr);
        const a = side === 'E' ? [y10, y11] : [y01, y11];
        const b = side === 'E' ? [ny00, ny01] : [ny00, ny10];
        const top0 = Math.max(a[0], b[0]), top1 = Math.max(a[1], b[1]);
        const bottom0 = Math.min(a[0], b[0]), bottom1 = Math.min(a[1], b[1]);
        const step = Math.max(top0, top1) - Math.min(bottom0, bottom1);
        if (!(((t.type === deps.TileType.RAMP || nt?.type === deps.TileType.RAMP) && step > 0.04) || (step > 0.04 && (t.incline || nt?.incline || (t.elevTier || 0) !== (nt?.elevTier || 0))))) continue;
        const kind = kindOf(t, nt);
        // A plain plateau_cliff span is exactly the cliff-face margin band
        // buildPlateauMesa's own mesh already renders (now stone-textured
        // directly on that geometry — see its own comment) — solving it a
        // second time here just overlays a second, perfectly flat plane in
        // front of that real sloped surface. Ramp seams/sides and bare tier
        // steps aren't rendered by any other mesh, so those still need this
        // solver.
        if (kind === 'plateau_cliff') continue;
        if (side === 'E') add(`x:${c + 1}:${r}`, 'x', c + 1, r, c + 1, r + 1, top0, top1, bottom0, bottom1, kind);
        else add(`z:${r + 1}:${c}`, 'z', c, r + 1, c + 1, r + 1, top0, top1, bottom0, bottom1, kind);
      }
    }
    const pos = [], idx = []; let vi = 0;
    const pushV = (x, y, z, nx, nz, at, vt) => {
      const rib = (vt > 0.001 && vt < 0.999 && at > 0.001 && at < 0.999) ? (hash01(x, z, Math.round(y * 10)) - 0.5) * 0.16 : 0;
      const ledge = (vt > 0.15 && vt < 0.9 && Math.abs((vt * 5) % 1 - 0.5) < 0.14) ? 0.035 : 0;
      pos.push(x + nx * (rib + ledge), y, z + nz * (rib + ledge));
    };
    for (const s of spans.values()) {
      const nx = s.axis === 'x' ? (hash01(s.x0, s.z0, 7) > 0.5 ? 1 : -1) : 0;
      const nz = s.axis === 'z' ? (hash01(s.x0, s.z0, 11) > 0.5 ? 1 : -1) : 0;
      const segs = 2, base = vi;
      for (let j = 0; j <= segs; j++) for (let i = 0; i <= segs; i++) {
        const at = i / segs, vt = j / segs;
        const x = s.x0 + (s.x1 - s.x0) * at, z = s.z0 + (s.z1 - s.z0) * at;
        const top = s.top0 + (s.top1 - s.top0) * at, bot = s.bottom0 + (s.bottom1 - s.bottom0) * at;
        pushV(x, bot + (top - bot) * (1 - vt), z, nx, nz, at, vt);
      }
      for (let j = 0; j < segs; j++) for (let i = 0; i < segs; i++) {
        const a = base + j * (segs + 1) + i, b = a + 1, c0 = a + (segs + 1), d = c0 + 1;
        idx.push(a, c0, d, a, d, b);
      }
      vi += (segs + 1) * (segs + 1);
    }
    if (!idx.length) return;
    const mat = new THREE.MeshLambertMaterial({ color: 0x5f5a56, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    deps.displaceZoneGeometry(geo, mapId);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    zScene.add(mesh);
    deps.markTerrainEdgeId(mesh, deps.terrainCategoryFor(deps.TileType.ROCK));
    mesh.userData.cameraObstacle = true; // vertical cliff-face skin — see buildPlateauMesa's own tag
    console.log(`%c[zone:${mapId}] solved rock formation built: ${spans.size} edge span(s)`, 'color:#22c55e;font-weight:bold');
  }

  // Waterfall curtain: a vertical sheet at every elevation drop touching a
  // WATERFALL tile — same tier-step detection buildRampCurtainMeshes uses to
  // find a ramp's sides. Returns the spawned mesh(es) for _zoneWaterMeshes.
  function buildWaterfallCurtainMeshes(zScene, zGrid, zcols, zrows, mapId) {
    const cells = [];
    for (let r = 0; r < zrows; r++)
      for (let c = 0; c < zcols; c++)
        if (zGrid[r]?.[c]?.type === deps.TileType.WATERFALL) cells.push([c, r]);
    if (!cells.length) return [];

    const pos = [], uv = [], idx = [];
    let vi = 0;
    for (const [c, r] of cells) {
      const t = zGrid[r][c];
      const selfY = deps.RIVER_TOP + (t.elevTier || 0) * deps.PLATEAU_UNIT;
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nt = zGrid[r + dr]?.[c + dc];
        if (!nt || (nt.elevTier || 0) === (t.elevTier || 0)) continue;
        const neighborIsWater = nt.type === deps.TileType.RIVER || nt.type === deps.TileType.STREAM || nt.type === deps.TileType.WATERFALL;
        const neighborY = (neighborIsWater ? deps.RIVER_TOP : deps.NORMAL_TOP) + (nt.elevTier || 0) * deps.PLATEAU_UNIT;
        const top = Math.max(selfY, neighborY), bottom = Math.min(selfY, neighborY);
        if (top - bottom < 0.01) continue;
        let x0, z0, x1, z1;
        if (dc === 1)       { x0 = c+1; z0 = r;   x1 = c+1; z1 = r+1; }
        else if (dc === -1) { x0 = c;   z0 = r+1; x1 = c;   z1 = r;   }
        else if (dr === 1)  { x0 = c;   z0 = r+1; x1 = c+1; z1 = r+1; }
        else /* dr === -1 */{ x0 = c+1; z0 = r;   x1 = c;   z1 = r;   }
        pos.push(x0, top, z0,  x1, top, z1,  x0, bottom, z0,  x1, bottom, z1);
        uv.push(0,1, 1,1, 0,0, 1,0); // v=1 at top so uFlow=(0,1) scrolls downward
        idx.push(vi, vi+2, vi+3, vi, vi+3, vi+1); vi += 4;
      }
    }
    if (!pos.length) return [];

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    deps.displaceZoneGeometry(geo, mapId);
    geo.computeVertexNormals();

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:  { value: 0 },
        uPhase: { value: 0 },
        uDepth: { value: 0.85 },
        uFlow:  { value: new THREE.Vector2(0, 1) }, // local UV-space "down" — always set, never still-mode
        uColor: { value: new THREE.Color(0x1f6f9c) },
      },
      vertexShader:   deps.waterVertShader,
      fragmentShader: deps.waterFragShader,
      transparent:    true,
      depthWrite:     false,
      side:           THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = false;
    zScene.add(mesh);
    deps.markTerrainEdgeId(mesh, 'water');

    console.log(`%c[zone:${mapId}] waterfall wall built: ${cells.length} cell(s)`, 'color:#22c55e;font-weight:bold');
    return [mesh];
  }

  // River/stream/waterfall water surface — one world-UV merged textured mesh
  // above the sunken beds. Each tile still contributes its own elevation,
  // depth, and flow attributes, so plateau waterways and waterfall pools keep
  // their authored heights without returning to one draw call per tile.
  function buildZoneRiverWaterMeshes(zScene, zGrid, zcols, zrows, mapId) {
    const isWaterTile = (cc, rr) => {
      const t = zGrid[rr]?.[cc]?.type;
      return t === deps.TileType.RIVER || t === deps.TileType.STREAM || t === deps.TileType.WATERFALL;
    };
    const cells = [];
    for (let r = 0; r < zrows; r++) for (let c = 0; c < zcols; c++) {
      const tile = zGrid[r][c];
      if (!isWaterTile(c, r)) continue;
      let fx = (isWaterTile(c + 1, r) ? 1 : 0) - (isWaterTile(c - 1, r) ? 1 : 0);
      let fz = (isWaterTile(c, r + 1) ? 1 : 0) - (isWaterTile(c, r - 1) ? 1 : 0);
      const flen = Math.hypot(fx, fz);
      if (flen > 0.001) { fx /= flen; fz /= flen; } else { fx = 0; fz = 0; }
      const deep = tile.type !== deps.TileType.STREAM;
      const tierY = (tile.elevTier || 0) * deps.PLATEAU_UNIT;
      cells.push({
        col: c, row: r,
        surfaceY: deps.NORMAL_TOP + tierY - (deep ? 0.10 : 0.05),
        depth: deep ? 0.8 : 0.45,
        flowX: fx, flowZ: fz,
      });
    }
    if (!cells.length) return [];
    const mesh = deps.buildMergedWaterMesh(zScene, cells, {
      name: `${mapId}_merged_water`, statKey: `${mapId} waterways`,
      uvWidth: zcols, uvHeight: zrows,
    });
    if (!mesh) return [];
    deps.displaceZoneGeometry(mesh.geometry, mapId);
    mesh.geometry.computeVertexNormals();
    console.log(`%c[zone:${mapId}] merged river/stream/waterfall water surface built: ${cells.length} tile(s), 1 draw call`, 'color:#22c55e;font-weight:bold');
    return [mesh];
  }

  window.ZoneTerrainFeatures = {
    init,
    buildZoneRampMeshes,
    buildRampCurtainMeshes,
    buildRockFormationMeshes,
    buildWaterfallCurtainMeshes,
    buildZoneRiverWaterMeshes,
  };
})();
