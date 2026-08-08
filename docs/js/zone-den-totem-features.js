(() => {
  'use strict';

  // Wilderness-zone landmark meshes tied to authored placement data rather
  // than the tile grid itself: animal den rock mounds (a single rounded
  // lump over a den's whole multi-tile footprint, with a hole cut into
  // one side for the mouth) and root totems (a carved-pole placeholder
  // marking each zone's permanent respawn checkpoint). Extracted out of
  // game.js following the same window.<Namespace> + init(deps) pattern as
  // its sibling systems, alongside js/zone-plateau-mesa.js and
  // js/zone-terrain-features.js. Both are deterministic, pure scene-graph
  // generators — no player/combat state.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function buildDenRockMoundGeo(colsTiles, rowsTiles, peakHeight, salt, mouthRect) {
    const CX = Math.max(3, Math.round(colsTiles * deps.ROCK_MOUND_CELLS_PER_TILE));
    const CZ = Math.max(3, Math.round(rowsTiles * deps.ROCK_MOUND_CELLS_PER_TILE));
    const VX = CX + 1, VZ = CZ + 1;
    let _s = (Math.imul(Math.round(colsTiles * 97) + 1, 374761393) ^ Math.imul(Math.round(rowsTiles * 131) + 1, 668265263) ^ Math.imul(salt, 2654435761)) >>> 0;
    const rng = () => { _s += 0x6D2B79F5; let t = Math.imul(_s ^ _s >>> 15, _s | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    // Small per-vertex jitter for a natural rock-surface texture — never
    // large enough to disturb the overall rectangular-contour shape.
    const roughSeed = rng() * 1000;
    const roughDisp = (u, v) => {
      const kx = Math.round(u * CX * 8) | 0, kz = Math.round(v * CZ * 8) | 0;
      let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263) ^ Math.imul(roughSeed | 0, 97)) >>> 0;
      h = Math.imul(h ^ h >>> 13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.16;
    };

    const Y = new Float32Array(VX * VZ);
    for (let vj = 0; vj < VZ; vj++) for (let vi = 0; vi < VX; vi++) {
      const u = vi / CX, v = vj / CZ;
      const edgeDist = Math.min(u, 1 - u, v, 1 - v); // 0 at the true footprint edge, up to 0.5 at dead center
      const norm = Math.min(1, edgeDist * 2);
      const dome = norm * norm * (3 - 2 * norm); // smoothstep — rounded profile, not a flat-topped mesa
      const idxv = vj * VX + vi;
      Y[idxv] = Math.max(0, dome * peakHeight + roughDisp(u, v) * dome);
    }

    // Carve the entrance — a straightforward drop to ~ground level
    // within mouthRect, same as cutting a doorway into a real boulder's
    // face; a thin blended collar around it keeps the cut edge from
    // being a single razor-sharp ring of triangles.
    if (mouthRect) {
      for (let vj = 0; vj < VZ; vj++) for (let vi = 0; vi < VX; vi++) {
        const u = vi / CX, v = vj / CZ;
        const inU = u >= mouthRect.u0 && u <= mouthRect.u1;
        const nearV = Math.max(0, (v - mouthRect.v0) / (1 - mouthRect.v0));
        if (inU && nearV > 0) {
          const idxv = vj * VX + vi;
          Y[idxv] *= Math.max(0, 1 - nearV * 1.6);
        }
      }
    }

    const positions = [];
    for (let vj = 0; vj < VZ; vj++) for (let vi = 0; vi < VX; vi++) positions.push((vi / CX) * colsTiles, Y[vj * VX + vi], (vj / CZ) * rowsTiles);
    const idx = [];
    for (let cj = 0; cj < CZ; cj++) for (let ci = 0; ci < CX; ci++) {
      const v00 = cj * VX + ci, v10 = cj * VX + ci + 1, v01 = (cj + 1) * VX + ci, v11 = (cj + 1) * VX + ci + 1;
      idx.push(v00, v01, v11, v00, v11, v10);
    }
    return { positions, idx, vertexCount: VX * VZ };
  }

  // Animal dens: a single rounded lump over a den's whole multi-tile
  // footprint, with a hole cut into one side — see buildDenRockMoundGeo
  // above for the shape itself; this just places one per den (sunk
  // slightly into the ground) and merges them into one mesh.
  function buildAnimalDenMeshes(zScene, zGrid, dens, mapId) {
    if (!dens || !dens.length) return;
    const DEN_PEAK_HEIGHT = 2.0, DEN_SINK = 0.5;
    const MOUTH_U0 = 0.3, MOUTH_U1 = 0.7, MOUTH_V0 = 0.6;
    const pos = [], idx = []; let vi = 0;
    let denSalt = 0;
    for (const den of dens) {
      const w = den.w || 1, h = den.h || 1;
      const centerCol = den.x + Math.floor(w / 2), centerRow = den.y + Math.floor(h / 2);
      const elevTier = zGrid?.[centerRow]?.[centerCol]?.elevTier || 0;
      const groundY = deps.NORMAL_TOP + elevTier * deps.PLATEAU_UNIT - DEN_SINK;
      const mound = buildDenRockMoundGeo(w, h, DEN_PEAK_HEIGHT, (denSalt += 97), { u0: MOUTH_U0, u1: MOUTH_U1, v0: MOUTH_V0 });
      const base = vi;
      for (let p = 0; p < mound.vertexCount; p++) {
        pos.push(den.x + mound.positions[p * 3], groundY + mound.positions[p * 3 + 1], den.y + mound.positions[p * 3 + 2]);
      }
      for (const i of mound.idx) idx.push(base + i);
      vi += mound.vertexCount;
    }
    if (!idx.length) return;
    const mat = new THREE.MeshLambertMaterial({ color: 0x5f5a56, side: THREE.DoubleSide });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    zScene.add(mesh);
    deps.markTerrainEdgeId(mesh, deps.terrainCategoryFor(deps.TileType.ROCK));
    mesh.userData.cameraObstacle = true;
    console.log(`%c[zone:${mapId}] animal den rock mounds built: ${dens.length}`, 'color:#22c55e;font-weight:bold');
  }

  // Root Totems (see wilderness-map-generator.js's placeRootTotems) — a
  // simple carved-pole placeholder mesh (pole + a few rings + a glowing
  // cap) marking each zone's permanent respawn checkpoint. Purely a
  // visual landmark; the actual nearest-totem lookup on death reads
  // zoneData.rootTotems directly (see respawnPlayer/nearestRootTotemFor),
  // not this mesh.
  function buildRootTotemMeshes(zScene, zGrid, totems, mapId) {
    if (!totems || !totems.length) return;
    const poleMat = new THREE.MeshBasicMaterial({ color: 0x5b3a22 });
    const bandMat = new THREE.MeshBasicMaterial({ color: 0x9a6a35 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x7fe7c4 });
    const group = new THREE.Group();
    for (const totem of totems) {
      const elevTier = zGrid?.[totem.y]?.[totem.x]?.elevTier || 0;
      const groundY = deps.NORMAL_TOP + elevTier * deps.PLATEAU_UNIT;
      const cx = totem.x + 0.5, cz = totem.y + 0.5;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 2.6, 8), poleMat);
      pole.position.set(cx, groundY + 1.3, cz);
      group.add(pole);
      for (let i = 0; i < 3; i++) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.07, 6, 12), bandMat);
        band.rotation.x = Math.PI / 2;
        band.position.set(cx, groundY + 0.55 + i * 0.75, cz);
        group.add(band);
      }
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), glowMat);
      glow.position.set(cx, groundY + 2.75, cz);
      group.add(glow);
    }
    zScene.add(group);
    console.log(`%c[zone:${mapId}] root totems built: ${totems.length}`, 'color:#22c55e;font-weight:bold');
    return group;
  }

  window.ZoneDenTotemFeatures = {
    init,
    buildDenRockMoundGeo,
    buildAnimalDenMeshes,
    buildRootTotemMeshes,
  };
})();
