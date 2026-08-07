(() => {
  'use strict';

  // Procedural border terrain surrounding the playable farm, town, and
  // wilderness-zone grids (the plateau/cliff skirt that fills the world
  // out to the horizon so there's no visible edge) — buildBorderTerrain()
  // for the farm, buildTownBorderTerrain() for town (same plateau-growth
  // pipeline, with canyon gaps cut through wherever a road crosses the
  // border, plus its own sparse grass billboard belt), and
  // buildZoneBorderTerrain() for wilderness zones (same pipeline again,
  // parameterized by the zone's real size/scene/grid and a per-mapId
  // seed, and welded to the zone's own playable-edge elevation instead of
  // sitting at one flat height). Extracted out of game.js following the
  // same window.<Namespace> + init(deps) pattern as its sibling systems.
  // All three generators are deterministic (fixed seed) and touch only
  // the scene graph — no player/combat state — so, unlike most of what's
  // left in game.js, this is a clean candidate for eventually running
  // standalone (e.g. server-side world generation for multiplayer).
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function buildBorderTerrain() {
    const BORDER_W   = 18;   // border tile width on each side
    const SEED       = 2026;
    const BLEND_STEPS = 8;   // seam-blend zone: 4 tiles = 8 vertex steps

    // ── Grid dims (0.5-unit vertex spacing = makeFloorGeo 2×2 subdivision) ──
    const BV  = BORDER_W * 2;
    const PVW = deps.COLS * 2, PVH = deps.ROWS * 2;
    const GW  = PVW + 2*BV + 1;       // 145 vertex columns
    const GH  = PVH + 2*BV + 1;       // 125 vertex rows
    const CW  = GW - 1, CH = GH - 1;

    // ── Mulberry32 RNG ─────────────────────────────────────────────────────
    let _s = SEED >>> 0;
    const rng = () => {
      _s += 0x6D2B79F5;
      let t = Math.imul(_s ^ _s>>>15, _s|1);
      t ^= t + Math.imul(t ^ t>>>7, t|61);
      return ((t ^ t>>>14) >>> 0) / 4294967296;
    };

    // ── Seam hash — exact copy of makeFloorGeo ─────────────────────────────
    const hashDisp = (vi, vj) => {
      let h = (2166136261 ^ (vi * 374761393) ^ (vj * 668265263)) >>> 0;
      h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.026;
    };

    // Distance (in 0.5-unit vertex steps) of grid vertex (gi,gj) from playable boundary
    const vSteps = (gi, gj) => {
      const vi = gi - BV, vj = gj - BV;
      const dx = Math.max(0, -vi, vi - PVW);
      const dz = Math.max(0, -vj, vj - PVH);
      return Math.sqrt(dx*dx + dz*dz);
    };

    const isPlayable = (ci, cj) => ci>=BV && ci<BV+PVW && cj>=BV && cj<BV+PVH;

    // ── Height map initialised to exact seam heights ───────────────────────
    const Y = new Float32Array(GW * GH);
    for (let gj = 0; gj < GH; gj++)
      for (let gi = 0; gi < GW; gi++)
        Y[gj*GW+gi] = deps.NORMAL_TOP + hashDisp(gi-BV, gj-BV);

    // ── Plateau operations ─────────────────────────────────────────────────
    const cv4 = (ci, cj) => [cj*GW+ci, cj*GW+ci+1, (cj+1)*GW+ci, (cj+1)*GW+ci+1];

    // Random-frontier connected group expansion (border cells only)
    function pickGroup(ci0, cj0, maxSz) {
      const group = [], seen = new Set([cj0*CW+ci0]);
      const front = [[ci0, cj0]];
      while (front.length && group.length < maxSz) {
        const fi = Math.floor(rng() * front.length);
        const [ci, cj] = front.splice(fi, 1)[0];
        group.push([ci, cj]);
        for (const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const ni=ci+dc, nj=cj+dr;
          if (ni<0||ni>=CW||nj<0||nj>=CH) continue;
          const nk = nj*CW+ni;
          if (seen.has(nk) || isPlayable(ni,nj)) continue;
          seen.add(nk); front.push([ni,nj]);
        }
      }
      return group;
    }

    // Raise group verts to (max-in-group + amount).
    // Verts within BLEND_STEPS of the seam are blended proportionally
    // so the raised terrain ramps smoothly down to the seam edge.
    function raiseGroup(group, amount) {
      let maxY = -Infinity;
      const verts = new Set();
      for (const [ci,cj] of group)
        for (const vi of cv4(ci,cj)) { verts.add(vi); if(Y[vi]>maxY) maxY=Y[vi]; }
      const target = maxY + amount;
      for (const vi of verts) {
        const gi = vi%GW, gj = vi/GW|0;
        const st = vSteps(gi, gj);
        if (st === 0) continue;                          // seam — never touch
        const blend  = Math.min(1, st / BLEND_STEPS);   // 0→1 over 4-tile zone
        const raised = deps.NORMAL_TOP + hashDisp(gi-BV, gj-BV) + blend*(target - deps.NORMAL_TOP);
        if (raised > Y[vi]) Y[vi] = raised;             // plateaus only go up
      }
    }

    // Edge-biased seed cell picker (avoids playable area)
    function pickCell(outerBias) {
      const rim = BV >> 2; // outermost-quarter cells per side
      for (let attempt = 0; attempt < 300; attempt++) {
        let ci, cj;
        if (rng() < outerBias) {
          const side = Math.floor(rng() * 4);
          if (side===0) { ci=Math.floor(rng()*CW); cj=Math.floor(rng()*rim); }
          else if(side===1){ ci=Math.floor(rng()*CW); cj=(CH-1-Math.floor(rng()*rim))|0; }
          else if(side===2){ ci=Math.floor(rng()*rim); cj=Math.floor(rng()*CH); }
          else              { ci=(CW-1-Math.floor(rng()*rim))|0; cj=Math.floor(rng()*CH); }
        } else {
          ci=Math.floor(rng()*CW); cj=Math.floor(rng()*CH);
        }
        if (!isPlayable(ci,cj)) return [ci,cj];
      }
      return [0,0];
    }

    // ── Pass 1: rugged plain — small, low plateaus spread across the border ─
    for (let p = 0; p < 55; p++) {
      const [ci,cj] = pickCell(0.12);
      raiseGroup(pickGroup(ci, cj, 4 + Math.floor(rng()*18)), 0.05 + rng()*0.32);
    }

    // ── Pass 2: distant cliffs — tall, strongly edge-biased plateaus ────────
    for (let p = 0; p < 32; p++) {
      const [ci,cj] = pickCell(0.88);
      raiseGroup(pickGroup(ci, cj, 10 + Math.floor(rng()*38)), 0.9 + rng()*3.2);
    }

    // ── Pass 3: guarantee a continuous outer cliff ring ────────────────────
    // Force-raise every vertex in the outermost RIM_V steps of each side
    // so there are no skybox gaps regardless of where random groups landed.
    const RIM_V   = 20;              // ~10 tile-widths from each outer edge
    const RIM_MIN = deps.NORMAL_TOP + 3.0;
    for (let gj = 0; gj < GH; gj++) {
      for (let gi = 0; gi < GW; gi++) {
        if (gj >= RIM_V && gj <= GH-1-RIM_V &&
            gi >= RIM_V && gi <= GW-1-RIM_V) continue; // interior — skip
        const k = gj * GW + gi;
        if (Y[k] < RIM_MIN) Y[k] = RIM_MIN;
      }
    }

    // ── Build geometry (border ring only — playable interior skipped) ───────
    const pos = new Float32Array(GW * GH * 3);
    const uv = new Float32Array(GW * GH * 2); // world-space (X,Z), same convention as _mergeTileGeos
    for (let gj = 0; gj < GH; gj++)
      for (let gi = 0; gi < GW; gi++) {
        const k = gj*GW+gi;
        const wx = (gi-BV)*0.5, wz = (gj-BV)*0.5;
        pos[k*3]   = wx;
        pos[k*3+1] = Y[k];
        pos[k*3+2] = wz;
        uv[k*2] = wx; uv[k*2+1] = wz;
      }

    const indices = [];
    for (let cj = 0; cj < GH-1; cj++)
      for (let ci = 0; ci < GW-1; ci++) {
        if (isPlayable(ci,cj)) continue;
        const v00=cj*GW+ci, v10=cj*GW+ci+1, v01=(cj+1)*GW+ci, v11=(cj+1)*GW+ci+1;
        indices.push(v00, v01, v11,  v00, v11, v10);
      }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, deps.resolveTileMat('farm', deps.TileType.GRASS));
    mesh.receiveShadow = true;
    deps.scene.add(mesh);

    // ── Stone cliff skin: normal-based overlay on border terrain ─────────────
    // Matches the landscape generator's rule: faces with |normal.y| < 0.75
    // (steeper than ~41° from horizontal) are stone; shallower faces are grass.
    // For a 0.5×0.5 cell the diagonal cross product has cny=0.5 always, so the
    // threshold reduces to cnx²+cnz² > 0.194 — no sqrt required.
    const cliffMat = deps.resolveCliffMat('farm');

    function elevStoneSkin(gjMin, gjMax, giMin, giMax) {
      const positions = [], skinUv = [], idxArr = [];
      let vi = 0;
      for (let gj = gjMin; gj < gjMax; gj++) {
        for (let gi = giMin; gi < giMax; gi++) {
          const y00=Y[gj*GW+gi],     y10=Y[gj*GW+gi+1];
          const y01=Y[(gj+1)*GW+gi], y11=Y[(gj+1)*GW+gi+1];
          // Cross product of quad diagonals (SE-NW) × (NE-SW); cny = 0.5 always.
          const cnx = -0.5 * ((y10 + y11) - (y00 + y01));
          const cnz =  0.5 * ((y10 - y01) - (y11 - y00));
          if (cnx * cnx + cnz * cnz <= 0.194) continue;  // near-horizontal → grass
          const x0=(gi-BV)*0.5, x1=x0+0.5;
          const z0=(gj-BV)*0.5, z1=z0+0.5;
          positions.push(x0,y00,z0, x1,y10,z0, x0,y01,z1, x1,y11,z1);
          skinUv.push(x0,z0, x1,z0, x0,z1, x1,z1);
          idxArr.push(vi,vi+2,vi+3, vi,vi+3,vi+1); vi+=4;
        }
      }
      if (!positions.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(skinUv, 2));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(idxArr), 1));
      g.computeVertexNormals();
      deps.scene.add(new THREE.Mesh(g, cliffMat));
    }

    // North border strip (full width)
    elevStoneSkin(0,           BV,          0,          GW - 1);
    // South border strip (full width)
    elevStoneSkin(GH - 1 - BV, GH - 1,      0,          GW - 1);
    // West border strip (middle rows — corners already covered by N/S)
    elevStoneSkin(BV,          GH - 1 - BV, 0,          BV);
    // East border strip (middle rows)
    elevStoneSkin(BV,          GH - 1 - BV, GW - 1 - BV, GW - 1);
  }

  // Wilderness-zone border terrain: same rugged-plain + distant-cliffs
  // passes as buildTownBorderTerrain, parameterized by the zone's real
  // size and a per-zone seed so each zone's border is distinct but stable
  // across visits. Everything the generator touches (scene, grid, size)
  // arrives as a parameter rather than module state, unlike its farm/town
  // siblings above.
  function buildZoneBorderTerrain(zScene, zcols, zrows, mapId, zoneBaseElev = 0, zGrid = null) {
    const BASE        = deps.NORMAL_TOP + zoneBaseElev;
    const BORDER_W    = 18;
    const SEED        = (mapId.split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0)) || 1;
    const BLEND_STEPS = 8;

    const BV  = BORDER_W * 2;
    const PVW = zcols * 2, PVH = zrows * 2;
    const GW  = PVW + 2*BV + 1;
    const GH  = PVH + 2*BV + 1;
    const CW  = GW - 1, CH = GH - 1;

    let _s = SEED >>> 0;
    const rng = () => {
      _s += 0x6D2B79F5;
      let t = Math.imul(_s ^ _s>>>15, _s|1);
      t ^= t + Math.imul(t ^ t>>>7, t|61);
      return ((t ^ t>>>14) >>> 0) / 4294967296;
    };

    const hashDisp = (vi, vj) => {
      let h = (2166136261 ^ (vi * 374761393) ^ (vj * 668265263)) >>> 0;
      h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.026;
    };

    const vSteps = (gi, gj) => {
      const vi = gi - BV, vj = gj - BV;
      const dx = Math.max(0, -vi, vi - PVW);
      const dz = Math.max(0, -vj, vj - PVH);
      return Math.sqrt(dx*dx + dz*dz);
    };

    const isPlayable = (ci, cj) => ci>=BV && ci<BV+PVW && cj>=BV && cj<BV+PVH;

    // Seed height at each border vertex used to sit at one flat BASE
    // everywhere, so the border only ever read as a flat plain/skybox
    // wall with no relation to the actual zone it surrounds — obvious
    // wherever a zone's playable edge itself has cliffs or plateaus.
    // Weld the seam to the real playable-edge elevation instead (same
    // elevTier lookup buildPlateauMesa's seedHeightAt uses), fading back
    // to the flat BASE over SEAM_WELD_STEPS so only the near backdrop
    // reads as a continuation of the zone and the far horizon still
    // reads as generic distant terrain.
    const SEAM_WELD_STEPS = 16; // 8 tiles
    const nearestEdgeElevTier = (gi, gj) => {
      if (!zGrid) return null;
      const col = deps.clamp(Math.floor((gi - BV) / 2), 0, zcols - 1);
      const row = deps.clamp(Math.floor((gj - BV) / 2), 0, zrows - 1);
      const t = zGrid[row]?.[col];
      return (t && typeof t.elevTier === 'number') ? t.elevTier : null;
    };
    const Y = new Float32Array(GW * GH);
    for (let gj = 0; gj < GH; gj++)
      for (let gi = 0; gi < GW; gi++) {
        const jitter = hashDisp(gi-BV, gj-BV);
        const edgeTier = nearestEdgeElevTier(gi, gj);
        if (edgeTier === null) { Y[gj*GW+gi] = BASE + jitter; continue; }
        const edgeY = deps.NORMAL_TOP + edgeTier * deps.PLATEAU_UNIT;
        const weld = 1 - deps.clamp(vSteps(gi, gj) / SEAM_WELD_STEPS, 0, 1);
        Y[gj*GW+gi] = BASE + jitter + weld * (edgeY - BASE);
      }

    const cv4 = (ci, cj) => [cj*GW+ci, cj*GW+ci+1, (cj+1)*GW+ci, (cj+1)*GW+ci+1];

    function pickGroup(ci0, cj0, maxSz) {
      const group = [], seen = new Set([cj0*CW+ci0]);
      const front = [[ci0, cj0]];
      while (front.length && group.length < maxSz) {
        const fi = Math.floor(rng() * front.length);
        const [ci, cj] = front.splice(fi, 1)[0];
        group.push([ci, cj]);
        for (const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const ni=ci+dc, nj=cj+dr;
          if (ni<0||ni>=CW||nj<0||nj>=CH) continue;
          const nk = nj*CW+ni;
          if (seen.has(nk) || isPlayable(ni,nj)) continue;
          seen.add(nk); front.push([ni,nj]);
        }
      }
      return group;
    }

    function raiseGroup(group, amount) {
      let maxY = -Infinity;
      const verts = new Set();
      for (const [ci,cj] of group)
        for (const vi of cv4(ci,cj)) { verts.add(vi); if(Y[vi]>maxY) maxY=Y[vi]; }
      const target = maxY + amount;
      for (const vi of verts) {
        const gi = vi%GW, gj = vi/GW|0;
        const st = vSteps(gi, gj);
        if (st === 0) continue;
        const blend  = Math.min(1, st / BLEND_STEPS);
        const raised = BASE + hashDisp(gi-BV, gj-BV) + blend*(target - BASE);
        if (raised > Y[vi]) Y[vi] = raised;
      }
    }

    function pickCell(outerBias) {
      const rim = BV >> 2;
      for (let attempt = 0; attempt < 300; attempt++) {
        let ci, cj;
        if (rng() < outerBias) {
          const side = Math.floor(rng() * 4);
          if (side===0) { ci=Math.floor(rng()*CW); cj=Math.floor(rng()*rim); }
          else if(side===1){ ci=Math.floor(rng()*CW); cj=(CH-1-Math.floor(rng()*rim))|0; }
          else if(side===2){ ci=Math.floor(rng()*rim); cj=Math.floor(rng()*CH); }
          else              { ci=(CW-1-Math.floor(rng()*rim))|0; cj=Math.floor(rng()*CH); }
        } else {
          ci=Math.floor(rng()*CW); cj=Math.floor(rng()*CH);
        }
        if (!isPlayable(ci,cj)) return [ci,cj];
      }
      return [0,0];
    }

    for (let p = 0; p < 55; p++) {
      const [ci,cj] = pickCell(0.12);
      raiseGroup(pickGroup(ci, cj, 4 + Math.floor(rng()*18)), 0.05 + rng()*0.32);
    }
    for (let p = 0; p < 32; p++) {
      const [ci,cj] = pickCell(0.88);
      raiseGroup(pickGroup(ci, cj, 10 + Math.floor(rng()*38)), 0.9 + rng()*3.2);
    }

    const RIM_V   = 20;
    const RIM_MIN = BASE + 3.0;
    for (let gj = 0; gj < GH; gj++) {
      for (let gi = 0; gi < GW; gi++) {
        if (gj >= RIM_V && gj <= GH-1-RIM_V &&
            gi >= RIM_V && gi <= GW-1-RIM_V) continue;
        const k = gj * GW + gi;
        if (Y[k] < RIM_MIN) Y[k] = RIM_MIN;
      }
    }

    const pos = new Float32Array(GW * GH * 3);
    const uv = new Float32Array(GW * GH * 2); // world-space (X,Z), same convention as _mergeTileGeos
    for (let gj = 0; gj < GH; gj++)
      for (let gi = 0; gi < GW; gi++) {
        const k = gj*GW+gi;
        const wx = (gi-BV)*0.5, wz = (gj-BV)*0.5;
        pos[k*3]   = wx;
        pos[k*3+1] = Y[k];
        pos[k*3+2] = wz;
        uv[k*2] = wx; uv[k*2+1] = wz;
      }

    const idx = [];
    for (let cj = 0; cj < CH; cj++) {
      for (let ci = 0; ci < CW; ci++) {
        if (isPlayable(ci, cj)) continue;
        const [v00,v10,v01,v11] = cv4(ci,cj);
        idx.push(v00, v01, v11, v00, v11, v10);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, deps.resolveTileMat(mapId, deps.TileType.GRASS));
    mesh.receiveShadow = true;
    zScene.add(mesh);

    // Stone cliff skin: same normal-based overlay rule as the farm/town border
    // terrain — faces steeper than ~41° from horizontal get a stone skin instead
    // of grass (cnx²+cnz² > 0.194 for a 0.5×0.5 cell, see buildBorderTerrain).
    const cliffMat = deps.resolveCliffMat(mapId);

    function elevStoneSkin(gjMin, gjMax, giMin, giMax) {
      const skinPos = [], skinUv = [], idxArr = [];
      let vi = 0;
      for (let gj = gjMin; gj < gjMax; gj++) {
        for (let gi = giMin; gi < giMax; gi++) {
          const y00=Y[gj*GW+gi],     y10=Y[gj*GW+gi+1];
          const y01=Y[(gj+1)*GW+gi], y11=Y[(gj+1)*GW+gi+1];
          const cnx = -0.5 * ((y10 + y11) - (y00 + y01));
          const cnz =  0.5 * ((y10 - y01) - (y11 - y00));
          if (cnx * cnx + cnz * cnz <= 0.194) continue;  // near-horizontal → grass
          const x0=(gi-BV)*0.5, x1=x0+0.5;
          const z0=(gj-BV)*0.5, z1=z0+0.5;
          skinPos.push(x0,y00,z0, x1,y10,z0, x0,y01,z1, x1,y11,z1);
          skinUv.push(x0,z0, x1,z0, x0,z1, x1,z1);
          idxArr.push(vi,vi+2,vi+3, vi,vi+3,vi+1); vi+=4;
        }
      }
      if (!skinPos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(skinPos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(skinUv, 2));
      g.setIndex(new THREE.BufferAttribute(idxArr.length > 65535 ? new Uint32Array(idxArr) : new Uint16Array(idxArr), 1));
      g.computeVertexNormals();
      zScene.add(new THREE.Mesh(g, cliffMat));
    }

    elevStoneSkin(0,           BV,          0,          GW - 1); // north strip
    elevStoneSkin(GH - 1 - BV, GH - 1,      0,          GW - 1); // south strip
    elevStoneSkin(BV,          GH - 1 - BV, 0,          BV);      // west strip
    elevStoneSkin(BV,          GH - 1 - BV, GW - 1 - BV, GW - 1); // east strip
  }

  // Town border terrain: same plateau-growth pipeline as the farm's
  // buildBorderTerrain(), but dramatic cliffs (passes 2+3) are restricted
  // to north/west/east — the south already reads as forest and is left
  // low/rolling — and the north/west/east walls are notched with flat
  // "canyon" gaps wherever a road crosses that edge, so paths continue
  // unobstructed off the map instead of dead-ending into rock.
  let _townBorderGrassPoints = [];
  let townBorderGrassBillMesh = null;
  function _buildTownBorderGrassBillboards() {
    const grassBillboardMat = deps.getGrassBillboardMat();
    const townScene = deps.getTownScene();
    if (!grassBillboardMat) return;
    if (townBorderGrassBillMesh) { townScene.remove(townBorderGrassBillMesh); townBorderGrassBillMesh = null; }
    const pts = _townBorderGrassPoints;
    if (!pts.length) return;
    const BLADES = 6;
    townBorderGrassBillMesh = new THREE.InstancedMesh(deps.grassBladeGeo, grassBillboardMat, pts.length * BLADES * 2);
    townBorderGrassBillMesh.frustumCulled = false;
    townBorderGrassBillMesh.visible = deps.getGrassEnabled();
    townBorderGrassBillMesh.userData.isBillboard = true;
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (const { px, pz, py, seed } of pts) {
      const rand = deps.mbRng(seed);
      for (let b = 0; b < BLADES; b++) {
        const ox = (rand() - 0.5) * 0.7, oz = (rand() - 0.5) * 0.7;
        const w  = 0.16 + rand() * 0.10, h = 0.22 + rand() * 0.14;
        const rot = rand() * Math.PI;
        dummy.position.set(px + ox, py, pz + oz);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.set(w, h, 1);
        dummy.updateMatrix();
        townBorderGrassBillMesh.setMatrixAt(idx++, dummy.matrix);
        dummy.rotation.set(0, rot + Math.PI * 0.5, 0);
        dummy.updateMatrix();
        townBorderGrassBillMesh.setMatrixAt(idx++, dummy.matrix);
      }
    }
    townBorderGrassBillMesh.count = idx;
    townBorderGrassBillMesh.instanceMatrix.needsUpdate = true;
    townScene.add(townBorderGrassBillMesh);
  }

  function buildTownBorderTerrain() {
    const townScene = deps.getTownScene();
    const townZone = deps.getTownZone();
    const TCOLS = townZone?.cols || 60, TROWS = townZone?.rows || 50;
    const BORDER_W    = 18;
    const SEED        = 4077;
    const BLEND_STEPS = 8;

    const BV  = BORDER_W * 2;
    const PVW = TCOLS * 2, PVH = TROWS * 2;
    const GW  = PVW + 2*BV + 1;
    const GH  = PVH + 2*BV + 1;
    const CW  = GW - 1, CH = GH - 1;

    let _s = SEED >>> 0;
    const rng = () => {
      _s += 0x6D2B79F5;
      let t = Math.imul(_s ^ _s>>>15, _s|1);
      t ^= t + Math.imul(t ^ t>>>7, t|61);
      return ((t ^ t>>>14) >>> 0) / 4294967296;
    };

    const hashDisp = (vi, vj) => {
      let h = (2166136261 ^ (vi * 374761393) ^ (vj * 668265263)) >>> 0;
      h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.026;
    };

    const vSteps = (gi, gj) => {
      const vi = gi - BV, vj = gj - BV;
      const dx = Math.max(0, -vi, vi - PVW);
      const dz = Math.max(0, -vj, vj - PVH);
      return Math.sqrt(dx*dx + dz*dz);
    };

    const isPlayable = (ci, cj) => ci>=BV && ci<BV+PVW && cj>=BV && cj<BV+PVH;

    const Y = new Float32Array(GW * GH);
    for (let gj = 0; gj < GH; gj++)
      for (let gi = 0; gi < GW; gi++)
        Y[gj*GW+gi] = deps.NORMAL_TOP + hashDisp(gi-BV, gj-BV);

    const cv4 = (ci, cj) => [cj*GW+ci, cj*GW+ci+1, (cj+1)*GW+ci, (cj+1)*GW+ci+1];

    function pickGroup(ci0, cj0, maxSz) {
      const group = [], seen = new Set([cj0*CW+ci0]);
      const front = [[ci0, cj0]];
      while (front.length && group.length < maxSz) {
        const fi = Math.floor(rng() * front.length);
        const [ci, cj] = front.splice(fi, 1)[0];
        group.push([ci, cj]);
        for (const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const ni=ci+dc, nj=cj+dr;
          if (ni<0||ni>=CW||nj<0||nj>=CH) continue;
          const nk = nj*CW+ni;
          if (seen.has(nk) || isPlayable(ni,nj)) continue;
          seen.add(nk); front.push([ni,nj]);
        }
      }
      return group;
    }

    function raiseGroup(group, amount) {
      let maxY = -Infinity;
      const verts = new Set();
      for (const [ci,cj] of group)
        for (const vi of cv4(ci,cj)) { verts.add(vi); if(Y[vi]>maxY) maxY=Y[vi]; }
      const target = maxY + amount;
      for (const vi of verts) {
        const gi = vi%GW, gj = vi/GW|0;
        const st = vSteps(gi, gj);
        if (st === 0) continue;
        const blend  = Math.min(1, st / BLEND_STEPS);
        const raised = deps.NORMAL_TOP + hashDisp(gi-BV, gj-BV) + blend*(target - deps.NORMAL_TOP);
        if (raised > Y[vi]) Y[vi] = raised;
      }
    }

    // Edge-biased seed cell picker restricted to a set of sides
    // (0=north,1=south,2=west,3=east).
    function pickCell(outerBias, sides) {
      const rim = BV >> 2;
      for (let attempt = 0; attempt < 300; attempt++) {
        let ci, cj;
        if (rng() < outerBias) {
          const side = sides[Math.floor(rng() * sides.length)];
          if (side===0) { ci=Math.floor(rng()*CW); cj=Math.floor(rng()*rim); }
          else if(side===1){ ci=Math.floor(rng()*CW); cj=(CH-1-Math.floor(rng()*rim))|0; }
          else if(side===2){ ci=Math.floor(rng()*rim); cj=Math.floor(rng()*CH); }
          else              { ci=(CW-1-Math.floor(rng()*rim))|0; cj=Math.floor(rng()*CH); }
        } else {
          ci=Math.floor(rng()*CW); cj=Math.floor(rng()*CH);
        }
        if (!isPlayable(ci,cj)) return [ci,cj];
      }
      return [0,0];
    }

    // Pass 1: rugged plain on all four sides — keeps the south's forest
    // floor gently uneven too, with no dramatic height.
    for (let p = 0; p < 55; p++) {
      const [ci,cj] = pickCell(0.12, [0,1,2,3]);
      raiseGroup(pickGroup(ci, cj, 4 + Math.floor(rng()*18)), 0.05 + rng()*0.32);
    }

    // Pass 2: distant cliffs — tall, edge-biased plateaus, north/west/east
    // only (side 1 = south is excluded so it stays low).
    const cliffGroups = [];
    for (let p = 0; p < 32; p++) {
      const [ci,cj] = pickCell(0.88, [0,2,3]);
      const group = pickGroup(ci, cj, 10 + Math.floor(rng()*38));
      raiseGroup(group, 0.9 + rng()*3.2);
      cliffGroups.push(group);
    }

    // Pass 2b: sub-plateauing — stack smaller, taller shelves onto the
    // cliffs just raised (seeded from a random cell of the parent group,
    // free to spill past its footprint) so tops break up into irregular,
    // stepped terraces instead of flat single-height mesas. Two rounds
    // of decreasing scale add coarse-then-fine jaggedness.
    let subGroups = cliffGroups;
    for (const [count, sizeRange, amtRange] of [[3, [3, 17], [0.4, 2.2]], [2, [2, 8], [0.2, 1.0]]]) {
      const next = [];
      for (const group of subGroups) {
        const n = 1 + Math.floor(rng() * count);
        for (let s = 0; s < n; s++) {
          const [sci, scj] = group[Math.floor(rng() * group.length)];
          const sub = pickGroup(sci, scj, sizeRange[0] + Math.floor(rng() * (sizeRange[1] - sizeRange[0])));
          raiseGroup(sub, amtRange[0] + rng() * (amtRange[1] - amtRange[0]));
          next.push(sub);
        }
      }
      subGroups = next;
    }

    // Pass 3: guarantee a continuous cliff wall on north/west/east, with
    // canyon gaps cut through wherever a road crosses that edge. The
    // minimum ridge height itself is noisy (chunky, block-quantized) so
    // the skyline isn't a dead-flat shelf.
    const RIM_V   = 20;
    const ridgeNoise = (gi, gj) => {
      const qi = Math.round(gi / 5), qj = Math.round(gj / 5);
      let h = (2166136261 ^ (qi * 374761393) ^ (qj * 668265263)) >>> 0;
      h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
      return (h >>> 0) / 4294967296;
    };
    const rimMinAt = (gi, gj) => deps.NORMAL_TOP + 2.2 + ridgeNoise(gi, gj) * 3.2;

    // Tile col/row range -> vertex-index range (half-open), matching the
    // 0.5-unit vertex spacing used throughout this generator.
    const toViRange = (a, b) => [BV + a*2, BV + (b+1)*2];
    const NORTH_GAP = toViRange(25, 35);   // sp_town_north  (col 30, row 1)
    const WEST_GAP  = toViRange(20, 30);   // spot_2vsub     (col 0,  row 25)
    const EAST_GAP  = toViRange(20, 30);   // spot_d33e9     (col 59, row 25)

    for (let gj = 0; gj < GH; gj++) {
      for (let gi = 0; gi < GW; gi++) {
        const nearN = gj < RIM_V;
        const nearS = gj > GH-1-RIM_V;
        const nearW = gi < RIM_V;
        const nearE = gi > GW-1-RIM_V;
        if (!nearN && !nearW && !nearE) continue;  // south-only or interior — stays low
        if (nearN && !nearW && !nearE && gi >= NORTH_GAP[0] && gi < NORTH_GAP[1]) continue;
        if (nearW && !nearN && !nearS && gj >= WEST_GAP[0]  && gj < WEST_GAP[1])  continue;
        if (nearE && !nearN && !nearS && gj >= EAST_GAP[0]  && gj < EAST_GAP[1])  continue;
        const k = gj * GW + gi;
        const rimMin = rimMinAt(gi, gj);
        if (Y[k] < rimMin) Y[k] = rimMin;
      }
    }

    // Carve the canyons clean through — full border depth on that side,
    // regardless of anything passes 1/2 piled up in the corridor — so
    // each road always has an open, flat path off the map edge.
    const carve = (giMin, giMax, gjMin, gjMax) => {
      for (let gj = gjMin; gj < gjMax; gj++)
        for (let gi = giMin; gi < giMax; gi++)
          Y[gj*GW+gi] = deps.NORMAL_TOP + hashDisp(gi-BV, gj-BV);
    };
    carve(NORTH_GAP[0], NORTH_GAP[1], 0,           BV);
    carve(0,             BV,         WEST_GAP[0],  WEST_GAP[1]);
    carve(BV + PVW,      GW - 1,     EAST_GAP[0],  EAST_GAP[1]);

    // ── Build geometry (border ring only — playable interior skipped) ──
    const pos = new Float32Array(GW * GH * 3);
    const uv = new Float32Array(GW * GH * 2); // world-space (X,Z), same convention as _mergeTileGeos
    for (let gj = 0; gj < GH; gj++)
      for (let gi = 0; gi < GW; gi++) {
        const k = gj*GW+gi;
        const wx = (gi-BV)*0.5, wz = (gj-BV)*0.5;
        pos[k*3]   = wx;
        pos[k*3+1] = Y[k];
        pos[k*3+2] = wz;
        uv[k*2] = wx; uv[k*2+1] = wz;
      }

    const indices = [];
    for (let cj = 0; cj < GH-1; cj++)
      for (let ci = 0; ci < GW-1; ci++) {
        if (isPlayable(ci,cj)) continue;
        const v00=cj*GW+ci, v10=cj*GW+ci+1, v01=(cj+1)*GW+ci, v11=(cj+1)*GW+ci+1;
        indices.push(v00, v01, v11,  v00, v11, v10);
      }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(
      (pos.length/3 > 65535) ? new Uint32Array(indices) : new Uint16Array(indices), 1));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, deps.resolveTileMat('map_hobunji_town', deps.TileType.GRASS));
    mesh.receiveShadow = true;
    townScene.add(mesh);

    // ── Stone cliff skin — north/west/east strips, plus the SW/SE corner
    // blocks where the west/east walls continue down to the south edge.
    const cliffMat = deps.resolveCliffMat('map_hobunji_town');

    function elevStoneSkin(gjMin, gjMax, giMin, giMax) {
      const positions = [], skinUv = [], idxArr = [];
      let vi = 0;
      for (let gj = gjMin; gj < gjMax; gj++) {
        for (let gi = giMin; gi < giMax; gi++) {
          const y00=Y[gj*GW+gi],     y10=Y[gj*GW+gi+1];
          const y01=Y[(gj+1)*GW+gi], y11=Y[(gj+1)*GW+gi+1];
          const cnx = -0.5 * ((y10 + y11) - (y00 + y01));
          const cnz =  0.5 * ((y10 - y01) - (y11 - y00));
          if (cnx * cnx + cnz * cnz <= 0.194) continue;
          const x0=(gi-BV)*0.5, x1=x0+0.5;
          const z0=(gj-BV)*0.5, z1=z0+0.5;
          positions.push(x0,y00,z0, x1,y10,z0, x0,y01,z1, x1,y11,z1);
          skinUv.push(x0,z0, x1,z0, x0,z1, x1,z1);
          idxArr.push(vi,vi+2,vi+3, vi,vi+3,vi+1); vi+=4;
        }
      }
      if (!positions.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(skinUv, 2));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(idxArr), 1));
      g.computeVertexNormals();
      townScene.add(new THREE.Mesh(g, cliffMat));
    }

    elevStoneSkin(0,           BV,          0,           GW - 1);  // north strip (incl. NW/NE corners)
    elevStoneSkin(BV,          GH - 1 - BV, 0,           BV);       // west strip (middle)
    elevStoneSkin(BV,          GH - 1 - BV, GW - 1 - BV, GW - 1);   // east strip (middle)
    elevStoneSkin(GH - 1 - BV, GH - 1,      0,           BV);       // SW corner
    elevStoneSkin(GH - 1 - BV, GH - 1,      GW - 1 - BV, GW - 1);   // SE corner

    // ── Sparse billboard grass on the flatter cells of the new terrain
    // (skips steep cliff faces; denser on the gentle south/Pass-1 hills)
    _townBorderGrassPoints = [];
    for (let cj = 0; cj < CH; cj++) {
      for (let ci = 0; ci < CW; ci++) {
        if (isPlayable(ci, cj)) continue;
        if (vSteps(ci, cj) > 16) continue;   // only near the playable edge
        const y00=Y[cj*GW+ci],     y10=Y[cj*GW+ci+1];
        const y01=Y[(cj+1)*GW+ci], y11=Y[(cj+1)*GW+ci+1];
        const cnx = -0.5 * ((y10 + y11) - (y00 + y01));
        const cnz =  0.5 * ((y10 - y01) - (y11 - y00));
        if (cnx*cnx + cnz*cnz > 0.194) continue;   // cliff face — no grass
        const seed = (ci * 7919 + cj * 104173) >>> 0;
        // Halfway between the old (0.3, too sparse) and the first fix
        // (0.58, too dense) — sits between the inside and outside look.
        if (deps.mbRng(seed)() > 0.44) continue;
        const px = (ci-BV)*0.5 + 0.25, pz = (cj-BV)*0.5 + 0.25;
        const py = (y00+y10+y01+y11) / 4;
        _townBorderGrassPoints.push({ px, pz, py, seed });
      }
    }
    _buildTownBorderGrassBillboards();

    // ── Inaccessible shrubs continuing the forest belt south of the map
    // edge — purely decorative (no tile data out there), skipped over
    // the two road corridors so both south exits stay visually clear,
    // and skipped on the steep SW/SE corner cliff faces.
    if (window.FoliageGenerator) {
      const SOUTH_GAP_A = toViRange(15, 21);   // To Farm (col 18, row 49)
      const SOUTH_GAP_B = toViRange(27, 33);   // To Cloud Forest (col 30, row 49)
      const STEP = 4;   // 2-tile spacing — shrubs are heavy procedural meshes
      for (let cj = BV + PVH; cj < CH; cj += STEP) {
        const depth = cj - (BV + PVH);
        if (depth > 22) continue;   // ~11 tiles south of the map edge
        for (let ci = 0; ci < CW; ci += STEP) {
          if (ci >= SOUTH_GAP_A[0] && ci < SOUTH_GAP_A[1]) continue;
          if (ci >= SOUTH_GAP_B[0] && ci < SOUTH_GAP_B[1]) continue;
          const seed = (777 + ci * 7919 + cj * 104173) >>> 0;
          const r = deps.mbRng(seed);
          if (r() > 0.22) continue;   // sparse clusters
          const y00=Y[cj*GW+ci],     y10=Y[cj*GW+ci+1];
          const y01=Y[(cj+1)*GW+ci], y11=Y[(cj+1)*GW+ci+1];
          const cnx = -0.5 * ((y10 + y11) - (y00 + y01));
          const cnz =  0.5 * ((y10 - y01) - (y11 - y00));
          if (cnx*cnx + cnz*cnz > 0.194) continue;   // steep corner cliff — no shrub
          const px = (ci-BV)*0.5 + 0.25, pz = (cj-BV)*0.5 + 0.25;
          const py = (y00+y10+y01+y11) / 4;
          const vegGroup = window.FoliageGenerator.buildShrubMesh(1000 + ci, 1000 + cj);
          const sc = 1.6 + r() * 1.2;
          vegGroup.scale.set(sc, sc, sc);
          vegGroup.rotation.y = r() * Math.PI * 2;
          vegGroup.position.set(px, py, pz);
          townScene.add(vegGroup);
          deps.markOutline(vegGroup);
        }
      }
    }
  }

  // Called by game.js whenever the "Grass" setting is toggled, alongside
  // its sibling farm/town grass billboard meshes.
  function setGrassVisible(enabled) {
    if (townBorderGrassBillMesh) townBorderGrassBillMesh.visible = enabled;
  }

  window.BorderTerrain = {
    init,
    buildBorderTerrain,
    buildZoneBorderTerrain,
    buildTownBorderTerrain,
    buildTownBorderGrassBillboards: _buildTownBorderGrassBillboards,
    setGrassVisible,
  };
})();
