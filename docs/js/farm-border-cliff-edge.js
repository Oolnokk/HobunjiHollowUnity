(() => {
  'use strict';

  const THREE = window.THREE;
  const border = window.BorderTerrain;
  if (!THREE || !border?.buildBorderTerrain || window.FarmBorderCliffEdge?.installed) return;

  // This adapter intentionally loads AFTER the natural-surface / UV / farm-cliff
  // wrappers. The normal farm border is allowed to build first so every existing
  // wrapper keeps its side effects, then only those newly-created border meshes
  // are replaced by the authored edge profile below. The replacement cliff skins
  // use BorderTerrain's stock indexed-quad topology and are sent back through the
  // existing farm natural-surface pipeline explicitly.
  const BORDER_W = 18;
  const SEED = 2026;
  const BLEND_STEPS = 8;
  const ENTRANCE_CENTER_X = 17.5;
  const ENTRANCE_HALF_WIDTH = 1.75;
  const ENTRANCE_FLARE = 0.65;
  const CLIFF_RISE = 3.0;
  const CLIFF_UV_PATCH_WORLD_SIZE = 6; // Used to keep the continuous immediate-edge wall from becoming one farm-wide PNG surface.

  let deps = null;
  let buildCount = 0;
  const stats = {
    replacedBuilds: 0,
    removedOriginalMeshes: 0,
    rebuiltCliffMeshes: 0,
    rebuiltCliffCells: 0,
    raisedInnerVertices: 0,
    clearedEntranceVertices: 0,
    surfacePipelinePasses: 0,
    surfacePipelineScheduled: 0,
    lastError: null,
  };

  function log(message, level = 'render') {
    const text = `[farm-border-edge] ${message}`;
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level);
    else (level === 'warn' ? console.warn : console.debug)(text);
  }

  const previousInit = border.init;
  if (typeof previousInit === 'function') {
    border.init = function (injectedDeps, ...rest) {
      deps = injectedDeps;
      return previousInit.call(this, injectedDeps, ...rest);
    };
  }

  function removeOriginalBuildMeshes(scene, before) {
    if (!scene) return 0;
    const current = [...(scene.children || [])];
    let removed = 0;
    for (const object of current) {
      if (before.has(object) || !object?.isMesh || object?.userData?.backgroundScenery) continue;
      // buildBorderTerrain() itself only adds its grass base + four directional
      // cliff-skin meshes synchronously. Other farm systems build asynchronously
      // or outside this call, so restricting removal to newly-added direct meshes
      // avoids touching roads, buildings, vegetation, Harugasirri, etc.
      scene.remove(object);
      object.geometry?.dispose?.();
      removed++;
    }
    stats.removedOriginalMeshes += removed;
    return removed;
  }

  function buildAuthoritativeFarmBorder(scene) {
    if (!deps || !scene) throw new Error('BorderTerrain dependencies/scene unavailable');

    const BV = BORDER_W * 2;
    const PVW = deps.COLS * 2;
    const PVH = deps.ROWS * 2;
    const GW = PVW + 2 * BV + 1;
    const GH = PVH + 2 * BV + 1;
    const CW = GW - 1;
    const CH = GH - 1;
    let seedState = SEED >>> 0;

    const rng = () => {
      seedState += 0x6D2B79F5;
      let t = Math.imul(seedState ^ seedState >>> 15, seedState | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    const hashDisp = (vi, vj) => {
      let h = (2166136261 ^ (vi * 374761393) ^ (vj * 668265263)) >>> 0;
      h = Math.imul(h ^ h >>> 13, 1274126177) >>> 0;
      return (h / 4294967296 - 0.5) * 0.026;
    };
    const vSteps = (gi, gj) => {
      const vi = gi - BV, vj = gj - BV;
      const dx = Math.max(0, -vi, vi - PVW), dz = Math.max(0, -vj, vj - PVH);
      return Math.sqrt(dx * dx + dz * dz);
    };
    const isPlayable = (ci, cj) => ci >= BV && ci < BV + PVW && cj >= BV && cj < BV + PVH;
    const cv4 = (ci, cj) => [cj * GW + ci, cj * GW + ci + 1, (cj + 1) * GW + ci, (cj + 1) * GW + ci + 1];

    const Y = new Float32Array(GW * GH);
    for (let gj = 0; gj < GH; gj++) for (let gi = 0; gi < GW; gi++) {
      Y[gj * GW + gi] = deps.NORMAL_TOP + hashDisp(gi - BV, gj - BV);
    }

    function pickGroup(ci0, cj0, maxSz) {
      const group = [], seen = new Set([cj0 * CW + ci0]), front = [[ci0, cj0]];
      while (front.length && group.length < maxSz) {
        const fi = Math.floor(rng() * front.length);
        const [ci, cj] = front.splice(fi, 1)[0];
        group.push([ci, cj]);
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const ni = ci + dc, nj = cj + dr;
          if (ni < 0 || ni >= CW || nj < 0 || nj >= CH) continue;
          const nk = nj * CW + ni;
          if (seen.has(nk) || isPlayable(ni, nj)) continue;
          seen.add(nk);
          front.push([ni, nj]);
        }
      }
      return group;
    }

    function raiseGroup(group, amount) {
      let maxY = -Infinity;
      const verts = new Set();
      for (const [ci, cj] of group) for (const vi of cv4(ci, cj)) {
        verts.add(vi);
        if (Y[vi] > maxY) maxY = Y[vi];
      }
      const target = maxY + amount;
      for (const vi of verts) {
        const gi = vi % GW, gj = vi / GW | 0, st = vSteps(gi, gj);
        if (st === 0) continue;
        const blend = Math.min(1, st / BLEND_STEPS);
        const raised = deps.NORMAL_TOP + hashDisp(gi - BV, gj - BV) + blend * (target - deps.NORMAL_TOP);
        if (raised > Y[vi]) Y[vi] = raised;
      }
    }

    function pickCell(outerBias) {
      const rim = BV >> 2;
      for (let attempt = 0; attempt < 300; attempt++) {
        let ci, cj;
        if (rng() < outerBias) {
          const side = Math.floor(rng() * 4);
          if (side === 0) { ci = Math.floor(rng() * CW); cj = Math.floor(rng() * rim); }
          else if (side === 1) { ci = Math.floor(rng() * CW); cj = (CH - 1 - Math.floor(rng() * rim)) | 0; }
          else if (side === 2) { ci = Math.floor(rng() * rim); cj = Math.floor(rng() * CH); }
          else { ci = (CW - 1 - Math.floor(rng() * rim)) | 0; cj = Math.floor(rng() * CH); }
        } else {
          ci = Math.floor(rng() * CW);
          cj = Math.floor(rng() * CH);
        }
        if (!isPlayable(ci, cj)) return [ci, cj];
      }
      return [0, 0];
    }

    for (let p = 0; p < 55; p++) {
      const [ci, cj] = pickCell(0.12);
      raiseGroup(pickGroup(ci, cj, 4 + Math.floor(rng() * 18)), 0.05 + rng() * 0.32);
    }
    for (let p = 0; p < 32; p++) {
      const [ci, cj] = pickCell(0.88);
      raiseGroup(pickGroup(ci, cj, 10 + Math.floor(rng() * 38)), 0.9 + rng() * 3.2);
    }

    const RIM_V = 20;
    const RIM_MIN = deps.NORMAL_TOP + CLIFF_RISE;
    for (let gj = 0; gj < GH; gj++) for (let gi = 0; gi < GW; gi++) {
      if (gj >= RIM_V && gj <= GH - 1 - RIM_V && gi >= RIM_V && gi <= GW - 1 - RIM_V) continue;
      const k = gj * GW + gi;
      if (Y[k] < RIM_MIN) Y[k] = RIM_MIN;
    }

    // Authoritative farm change: the first outside half-tile vertex is already
    // on the cliff plateau, so there is no flat "margin" band between playable
    // farm and cliff. The north entrance remains ground-height through the full
    // 18-unit border and widens slightly as it travels outward.
    let raisedInner = 0, clearedEntrance = 0;
    for (let gj = 0; gj < GH; gj++) for (let gi = 0; gi < GW; gi++) {
      const outsideSteps = vSteps(gi, gj);
      if (outsideSteps <= 0) continue;
      const wx = (gi - BV) * 0.5;
      const wz = (gj - BV) * 0.5;
      const outward = Math.max(0, -wz);
      const half = ENTRANCE_HALF_WIDTH + ENTRANCE_FLARE * Math.min(1, outward / BORDER_W);
      const inEntrance = wz <= 0 && wz >= -BORDER_W && Math.abs(wx - ENTRANCE_CENTER_X) <= half;
      const k = gj * GW + gi;
      if (inEntrance) {
        const target = deps.NORMAL_TOP + hashDisp(gi - BV, gj - BV);
        if (Math.abs(Y[k] - target) > 1e-5) {
          Y[k] = target;
          clearedEntrance++;
        }
      } else {
        const target = deps.NORMAL_TOP + CLIFF_RISE + hashDisp(gi - BV, gj - BV) * 0.35;
        if (Y[k] < target) {
          Y[k] = target;
          raisedInner++;
        }
      }
    }

    const pos = new Float32Array(GW * GH * 3);
    const uv = new Float32Array(GW * GH * 2);
    for (let gj = 0; gj < GH; gj++) for (let gi = 0; gi < GW; gi++) {
      const k = gj * GW + gi, wx = (gi - BV) * 0.5, wz = (gj - BV) * 0.5;
      pos[k * 3] = wx;
      pos[k * 3 + 1] = Y[k];
      pos[k * 3 + 2] = wz;
      uv[k * 2] = wx;
      uv[k * 2 + 1] = wz;
    }

    const indices = [];
    for (let cj = 0; cj < GH - 1; cj++) for (let ci = 0; ci < GW - 1; ci++) {
      if (isPlayable(ci, cj)) continue;
      const v00 = cj * GW + ci, v10 = v00 + 1, v01 = (cj + 1) * GW + ci, v11 = v01 + 1;
      indices.push(v00, v01, v11, v00, v11, v10);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
    geo.computeVertexNormals();
    const baseMesh = new THREE.Mesh(geo, deps.resolveTileMat('farm', deps.TileType.GRASS));
    baseMesh.name = 'FarmBorderTerrainImmediateEdge';
    baseMesh.receiveShadow = true;
    baseMesh.userData = Object.assign({}, baseMesh.userData, { farmBorderImmediateEdge: true });
    scene.add(baseMesh);

    const cliffMat = deps.resolveCliffMat('farm');
    const cliffMeshes = [];
    let cliffCells = 0;
    function elevStoneSkin(gjMin, gjMax, giMin, giMax) {
      const positions = [], skinUv = [], idxArr = [];
      let vi = 0, cells = 0;
      for (let gj = gjMin; gj < gjMax; gj++) for (let gi = giMin; gi < giMax; gi++) {
        const y00 = Y[gj * GW + gi], y10 = Y[gj * GW + gi + 1], y01 = Y[(gj + 1) * GW + gi], y11 = Y[(gj + 1) * GW + gi + 1];
        const cnx = -0.5 * ((y10 + y11) - (y00 + y01));
        const cnz = 0.5 * ((y10 - y01) - (y11 - y00));
        if (cnx * cnx + cnz * cnz <= 0.194) continue;
        const x0 = (gi - BV) * 0.5, x1 = x0 + 0.5, z0 = (gj - BV) * 0.5, z1 = z0 + 0.5;
        positions.push(x0,y00,z0, x1,y10,z0, x0,y01,z1, x1,y11,z1);
        skinUv.push(x0,z0, x1,z0, x0,z1, x1,z1);
        idxArr.push(vi, vi + 2, vi + 3, vi, vi + 3, vi + 1);
        vi += 4;
        cells++;
      }
      if (!positions.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(skinUv, 2));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(idxArr), 1));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, cliffMat);
      mesh.name = 'FarmBorderImmediateCliffSkin';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // This is the same semantic input the normal farm-cliff wrapper receives
      // after NaturalSurfaceMaterials has classified a stock BorderTerrain skin.
      mesh.userData = Object.assign({}, mesh.userData, { naturalSurface: 'cliffs', farmBorderImmediateEdge: true });
      scene.add(mesh);
      cliffMeshes.push(mesh);
      cliffCells += cells;
    }

    elevStoneSkin(0, BV, 0, GW - 1);
    elevStoneSkin(GH - 1 - BV, GH - 1, 0, GW - 1);
    elevStoneSkin(BV, GH - 1 - BV, 0, BV);
    elevStoneSkin(BV, GH - 1 - BV, GW - 1 - BV, GW - 1);

    // Run the established material + surface-detection + one-PNG-per-surface
    // mapper only after every replacement cliff mesh has been created and added.
    // Deferring one microtask also places this pass after the complete wrapped
    // BorderTerrain call stack, so no older synchronous wrapper can overwrite it.
    stats.surfacePipelineScheduled++;
    const applyFinishedCliffSurfaces = () => {
      const farmCliff = window.FarmCliffRockOutline;
      if (farmCliff?.applyRockMaterialAndTextureOutline) {
        farmCliff.applyRockMaterialAndTextureOutline([baseMesh, ...cliffMeshes]);
      } else {
        const natural = window.NaturalSurfaceMaterials;
        for (const mesh of cliffMeshes) natural?.naturalizeMesh?.(mesh, 'rocks');
      }
      const mapper = window.HobunjiSurfaceStretchUV;
      for (const mesh of cliffMeshes) mapper?.mapMesh?.(mesh, {
        label: 'farm-border-immediate-edge:post-create',
        maxPatchWorldSize: CLIFF_UV_PATCH_WORLD_SIZE,
      });
      stats.surfacePipelinePasses++;
    }; // Used once after construction to make the surface mapper authoritative.
    if (typeof queueMicrotask === 'function') queueMicrotask(applyFinishedCliffSurfaces);
    else Promise.resolve().then(applyFinishedCliffSurfaces);

    stats.rebuiltCliffMeshes += cliffMeshes.length;
    stats.rebuiltCliffCells += cliffCells;
    stats.raisedInnerVertices += raisedInner;
    stats.clearedEntranceVertices += clearedEntrance;
    return { baseMesh, cliffMeshes, raisedInner, clearedEntrance, cliffCells };
  }

  const previousBuild = border.buildBorderTerrain;
  border.buildBorderTerrain = function (...args) {
    const scene = deps?.scene;
    const before = new Set(scene?.children || []);
    const result = previousBuild.apply(this, args);
    try {
      const removed = removeOriginalBuildMeshes(scene, before);
      const rebuilt = buildAuthoritativeFarmBorder(scene);
      buildCount++;
      stats.replacedBuilds++;
      stats.lastError = null;
      log(`authoritative rebuild ${buildCount}: removed ${removed} stock mesh(es); cliff begins at playable seam; cleared entrance through full border at x=${ENTRANCE_CENTER_X}; ${rebuilt.cliffMeshes.length} textured cliff skin(s), ${rebuilt.cliffCells} steep cell(s)`);
    } catch (error) {
      stats.lastError = String(error?.message || error);
      log(`authoritative rebuild failed: ${stats.lastError}`, 'warn');
    }
    return result;
  };
  border.__farmBorderCliffEdgePatched = true;

  window.FarmBorderCliffEdge = {
    installed: true,
    snapshot: () => ({
      buildCount,
      entranceCenterX: ENTRANCE_CENTER_X,
      entranceHalfWidth: ENTRANCE_HALF_WIDTH,
      entranceFlare: ENTRANCE_FLARE,
      cliffRise: CLIFF_RISE,
      cliffUvPatchWorldSize: CLIFF_UV_PATCH_WORLD_SIZE,
      ...stats,
    }),
  };
})();
