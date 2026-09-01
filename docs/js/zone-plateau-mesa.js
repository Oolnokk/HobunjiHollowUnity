(() => {
  'use strict';

  // A wilderness zone's in-bounds elevated plateau/mesa terrain (the flat
  // raised tops players actually walk on, as opposed to js/border-terrain.js's
  // decorative skirt outside the playable grid) — same seam-hash + BFS-blend
  // + steep-face-stone-skin technique as buildZoneBorderTerrain, but blending
  // inward from a plateau's own footprint mask instead of a fixed outer
  // margin, and welding against any ramp tiles painted through its footprint
  // so a ramp's own slope isn't fought by the mesa's generic blend. Extracted
  // out of game.js following the same window.<Namespace> + init(deps)
  // pattern as its sibling systems. Deterministic given the same zone grid/
  // mesa footprint — no player/combat state — another clean candidate for
  // eventually running standalone (e.g. server-side world generation).
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function buildPlateauMesa(zScene, mapId, groupId, bb, elevOffset, zoneBaseElev = 0, zGrid = null) {
    const MARGIN_TILES = 1;
    const BASE = deps.NORMAL_TOP + zoneBaseElev;
    const W = bb.maxC - bb.minC + 1, D = bb.maxR - bb.minR + 1;
    const GW = W * 2 + 1, GH = D * 2 + 1; // vertices, 0.5-tile spacing, matching makeFloorGeo

    const hashDisp = (kx, kz) => {
      let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
      h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.026;
    };

    // Multi-source BFS directly on the VERTEX grid (0.5-tile spacing, same
    // grid as the position buffer below) so every vertex's blend reflects its
    // own true distance to the nearest "outside" point — the bbox's literal
    // edge, or an internal gap in an irregular/concave mask. A vertex is an
    // "outside" seed if it touches the literal grid perimeter, or if any tile
    // it borders is outside the painted footprint mask. Each BFS hop is 0.5
    // tile, so hops*0.5 is exactly the tile-distance the old formula used.
    // (Doing this per-tile-then-min-over-adjacent-tiles, as before, collapses
    // the whole outer ring tile to blend 0 and renders mask cells next to an
    // internal gap as fully raised even though mergeZoneTiles' onRing logic
    // treats them as low ring tiles — both produced the grass-overhang bug.)
    const mask = bb.maskWorldKeys || null;
    // A neighbor is also "inside" (no blend needed there) if a different,
    // touching mesa has already raised it to at least this tier — without
    // this, two side-by-side mesas at the same height each independently
    // trench their own margin band right at the shared border instead of
    // merging into one continuous top ("blending curtains together").
    // Ring cells of another, still-sloping mesa don't count: only an
    // already-flat raised top at >= this tier reads as a seamless match.
    const inMask = (c, r) => {
      if (!mask) return true;
      if (mask.has(`${c},${r}`)) return true;
      const t = zGrid?.[r]?.[c];
      return !!(t && !t.incline && (t.elevTier || 0) >= bb.toTier);
    };
    // Which tile(s) a vertex index borders along one axis — even gi sit on a
    // tile boundary (shared by the tile each side), odd gi sit at a single
    // tile's center. Deliberately NOT clamped to [0,N) — a perimeter vertex
    // (gi=0 or gi=GW-1) needs to see one tile step beyond this mesa's own
    // bbox too, so inMask can detect an adjacent mesa sitting right outside it.
    const axisTiles = (gi, N) => {
      const lo = Math.floor((gi - 1) / 2), hi = Math.floor(gi / 2), out = [lo];
      if (hi !== lo) out.push(hi);
      return out;
    };
    const vIdx = (gi, gj) => gj * GW + gi;
    const CAP = MARGIN_TILES * 2; // hops (0.5 tile each) — cap matches old margin in tiles
    const vertHops = new Int32Array(GW * GH).fill(CAP);
    // A higher tier's footprint sometimes lands right at the edge of a LOWER
    // tier's own ring band instead of fully inset onto its flat top (a tight
    // or irregularly-shaped lower mesa can leave less than one full margin
    // tile of flat interior at some rows/columns). Anchoring every seed
    // vertex to this mesa's own flat `BASE` then makes the upper curtain
    // float a flat ledge above the lower curtain's real (still-sloping,
    // lower) surface — two independently-blended heightfields disagreeing
    // right where they overlap. Anchor each seed to the ACTUAL elevation
    // already staked for whatever tile triggered it instead, so the upper
    // curtain starts from the lower curtain's real height there and the two
    // read as one continuous slope.
    const TOP = BASE + elevOffset;
    const seedHeightAt = (c, r) => {
      const t = zGrid?.[r]?.[c];
      return (t && typeof t.elevTier === 'number') ? deps.NORMAL_TOP + t.elevTier * deps.PLATEAU_UNIT : BASE;
    };
    const vertSeedY = new Float32Array(GW * GH).fill(BASE);
    const queue = [];
    for (let gj = 0; gj < GH; gj++) {
      const trs = axisTiles(gj, D);
      for (let gi = 0; gi < GW; gi++) {
        const tcs = axisTiles(gi, W);
        // A real outer edge (no neighboring mesa raised to match) naturally
        // seeds here too: inMask(c,r) for a world tile beyond the live grid
        // (zGrid[r]?.[c] undefined) falls through to false.
        let seedY = Infinity;
        for (const tc of tcs) for (const tr of trs) {
          const c = bb.minC + tc, r = bb.minR + tr;
          if (!inMask(c, r)) seedY = Math.min(seedY, seedHeightAt(c, r));
        }
        if (seedY !== Infinity) {
          const k = vIdx(gi, gj);
          vertHops[k] = 0; vertSeedY[k] = seedY; queue.push([gi, gj]);
        }
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const [gi, gj] = queue[qi], k0 = vIdx(gi, gj), d0 = vertHops[k0];
      if (d0 >= CAP) continue;
      for (const [dgi, dgj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const ngi = gi + dgi, ngj = gj + dgj;
        if (ngi < 0 || ngi >= GW || ngj < 0 || ngj >= GH) continue;
        const nk = vIdx(ngi, ngj);
        if (d0 + 1 < vertHops[nk]) { vertHops[nk] = d0 + 1; vertSeedY[nk] = vertSeedY[k0]; queue.push([ngi, ngj]); }
      }
    }

    const Y = new Float32Array(GW * GH);
    for (let gj = 0; gj < GH; gj++) {
      for (let gi = 0; gi < GW; gi++) {
        const k = gj*GW+gi;
        const blend = Math.min(1, (vertHops[k] * 0.5) / MARGIN_TILES);
        const kx = bb.minC * 2 + gi, kz = bb.minR * 2 + gj; // absolute seam-hash key, matches adjacent makeFloorGeo tiles
        const seedY = vertSeedY[k];
        Y[k] = seedY + blend * (TOP - seedY) + hashDisp(kx, kz);
      }
    }

    // A ramp painted through this mesa's footprint (e.g. spooling around the
    // mesa's perimeter while climbing) doesn't follow this mesa's generic
    // 1-tile linear blend — it has its own, usually much slower, climb rate —
    // so the two heightfields disagree and visibly fight/clip where they
    // overlap. Wherever a ramp tile sits inside this bbox, snap that tile's
    // 3x3 vertex block onto the ramp's own corner heights (same averaging
    // buildZoneRampMeshes/buildRampCurtainMeshes use) instead of the BFS
    // blend, so the mesa surface there literally follows the ramp instead of
    // independently re-deriving a conflicting slope.
    const rampCornerY = (ci, cj) => {
      let sum = 0, n = 0;
      for (const [dc, dr] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
        const t = zGrid?.[cj + dr]?.[ci + dc];
        if (t && t.type === deps.TileType.RAMP) { sum += deps.NORMAL_TOP + (t.rampElevation || 0) * deps.PLATEAU_UNIT; n++; }
      }
      return n ? sum / n : null;
    };
    const isRampTile = (tc, tr) => zGrid?.[bb.minR + tr]?.[bb.minC + tc]?.type === deps.TileType.RAMP;
    for (let tr = 0; tr < D; tr++) {
      for (let tc = 0; tc < W; tc++) {
        if (!isRampTile(tc, tr)) continue;
        const wc = bb.minC + tc, wr = bb.minR + tr;
        const y00 = rampCornerY(wc, wr), y10 = rampCornerY(wc + 1, wr);
        const y01 = rampCornerY(wc, wr + 1), y11 = rampCornerY(wc + 1, wr + 1);
        for (let dj = 0; dj <= 2; dj++) {
          const fr = dj * 0.5;
          for (let di = 0; di <= 2; di++) {
            const fc = di * 0.5;
            const y = y00*(1-fc)*(1-fr) + y10*fc*(1-fr) + y01*(1-fc)*fr + y11*fc*fr;
            Y[(2*tr+dj)*GW + (2*tc+di)] = y;
          }
        }
      }
    }

    const pos = new Float32Array(GW * GH * 3);
    // World-space (X,Z) UV — same raw-world-units convention as
    // _mergeTileGeos, so resolveTileMat's textured materials (scaled via
    // texture.repeat) tile seamlessly across the mesa lid and line up
    // with the ordinary ground tiles surrounding it.
    const uv = new Float32Array(GW * GH * 2);
    for (let gj = 0; gj < GH; gj++)
      for (let gi = 0; gi < GW; gi++) {
        const k = gj*GW+gi;
        const wx = bb.minC + gi * 0.5, wz = bb.minR + gj * 0.5;
        pos[k*3]   = wx;
        pos[k*3+1] = Y[k];
        pos[k*3+2] = wz;
        uv[k*2] = wx; uv[k*2+1] = wz;
      }

    // Quads fully inside a ramp tile are left as holes — buildZoneRampMeshes
    // already renders that tile's own surface; doubling it here (even at a
    // matching height) just invites z-fighting.
    const quadIsRamp = (gi, gj) => isRampTile(Math.floor(gi / 2), Math.floor(gj / 2));
    // The bbox is just this mesa's bounding rectangle, not its painted shape —
    // an irregular/concave brush stroke leaves bbox cells that were never
    // painted at all. Those still get a flat BFS-blended Y above (so the BFS
    // distance field stays correct for the cells that ARE painted near them),
    // but they must NOT turn into a rendered quad, or the whole bbox reads as
    // a solid rectangular sheet regardless of the actual footprint. Gate on
    // the literal own-mask (bb.maskWorldKeys), not the broader inMask() —
    // inMask() also accepts a tile a DIFFERENT mesa already raised to match,
    // which must still skip rendering here since that tile belongs to the
    // other mesa, not this one.
    const quadInOwnMask = (gi, gj) => !mask || mask.has(`${bb.minC + Math.floor(gi/2)},${bb.minR + Math.floor(gj/2)}`);
    // A river/stream/waterfall/trench/raised cell carved INTO this mesa's own
    // footprint still gets a mask-passing, BFS-blended Y above (so neighboring
    // carved-tile geometry keeps blending against a sane height), but the flat
    // mesa lid/skin must not also render a quad on top of it — buildTerrainTileGeo
    // builds that cell's own carved-bed mesh, and without this check the mesa's
    // solid lid simply painted over it, hiding the channel under flat ground.
    const quadIsCarved = (gi, gj) => deps.CARVED_TILE_TYPES.has(zGrid?.[bb.minR + Math.floor(gj/2)]?.[bb.minC + Math.floor(gi/2)]?.type);
    // A quad's own corners already carry this mesa's real BFS-blended slope
    // (Y above) — steep quads (the cliff-face margin band) are exactly where
    // the old separate buildRockFormationMeshes wall used to get overlaid in
    // front of this same grass surface via polygonOffset, producing both a
    // visibly straight-edged stone plane AND the actual sloped/cliff-shaped
    // grass geometry showing through/around it. Splitting this single mesh's
    // faces into two material groups by the same steep-face rule the old
    // border-terrain stone skin used (faces steeper than ~41 degrees from
    // horizontal) puts the stone color directly on the real cliff geometry
    // instead, with no separate mesh needed.
    const grassIdx = [], stoneIdx = [];
    for (let gj = 0; gj < GH - 1; gj++) {
      for (let gi = 0; gi < GW - 1; gi++) {
        if (quadIsRamp(gi, gj) || quadIsCarved(gi, gj) || !quadInOwnMask(gi, gj)) continue;
        const v00 = gj*GW+gi, v10 = gj*GW+gi+1, v01 = (gj+1)*GW+gi, v11 = (gj+1)*GW+gi+1;
        const y00 = Y[v00], y10 = Y[v10], y01 = Y[v01], y11 = Y[v11];
        const cnx = -0.5 * ((y10 + y11) - (y00 + y01));
        const cnz =  0.5 * ((y10 - y01) - (y11 - y00));
        const steep = cnx * cnx + cnz * cnz > 0.194;
        if (steep) {
          const ownerTile = zGrid?.[bb.minR + Math.floor(gj / 2)]?.[bb.minC + Math.floor(gi / 2)]; // Tags the exact cell whose rendered quad became cliff rock.
          if (ownerTile) ownerTile.mesaCliffFace = true;
          stoneIdx.push(v00, v01, v11, v00, v11, v10);
        } else {
          grassIdx.push(v00, v01, v11, v00, v11, v10);
        }
      }
    }
    const idx = grassIdx.concat(stoneIdx);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    if (grassIdx.length) geo.addGroup(0, grassIdx.length, 0);
    if (stoneIdx.length) geo.addGroup(grassIdx.length, stoneIdx.length, 1);
    deps.displaceZoneGeometry(geo, mapId);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, [deps.resolveTileMat(mapId, deps.TileType.GRASS), deps.resolveTileMat(mapId, deps.TileType.ROCK)]);
    mesh.receiveShadow = true;
    zScene.add(mesh);
    // A plateau's own lid+skin is the primary way the fixed follow camera
    // (see updateCameraPosition) can end up with something tall between
    // itself and the player — flagged so buildZoneScene can collect it
    // for the occlusion raycast.
    mesh.userData.cameraObstacle = true;

    console.log(`%c[zone:${mapId}] plateau mesa built for group ${groupId}: ${W}x${D} tiles, top=${(BASE+elevOffset).toFixed(2)}, margin=${MARGIN_TILES} tile(s), stone faces=${stoneIdx.length / 6}`, 'color:#22c55e;font-weight:bold');
    return mesh;
  }

  window.ZonePlateauMesa = {
    init,
    buildPlateauMesa,
  };
})();
