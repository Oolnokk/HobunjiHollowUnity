(() => {
  'use strict';

  // Wilderness-zone landmark meshes tied to authored placement data rather
  // than the tile grid itself: animal den rock mounds and composed living
  // Root Totems. Farm and wilderness Root Totems share this renderer.
  function ensureCompanionScript(globalName, fileName) {
    if (window[globalName] || typeof document === 'undefined') return;
    if (document.readyState !== 'loading') {
      console.warn(`[zone root totem] ${globalName} is not loaded; expected ${fileName} before first root-totem build.`);
      return;
    }
    const currentSrc = document.currentScript?.src;
    const src = currentSrc ? new URL(fileName, currentSrc).href : `js/${fileName}`;
    document.write(`<script src="${src}"><\/script>`);
  }

  // Root Totem config first; shared natural-surface config stays authoritative
  // for Shadewood PNG textures/shading.
  ensureCompanionScript('HOBUNJI_ROOT_TOTEM_CONFIG', '../config/root-totem-config.js');
  ensureCompanionScript('NaturalSurfaceMaterialConfig', '../config/natural-surface-materials.js');
  ensureCompanionScript('NaturalSurfaceMaterials', 'natural-surface-materials.js');
  ensureCompanionScript('FurnitureVesselRuntime', 'furniture-vessel-runtime.js');
  ensureCompanionScript('StructuralWrap', 'structural-wrap.js');
  ensureCompanionScript('DeadzoneBillboard', 'deadzone-billboard.js');
  ensureCompanionScript('FoliageGenerator', 'foliage-generator.js');
  ensureCompanionScript('RootTotemSurfaceStyle', 'root-totem-surface-style.js');
  ensureCompanionScript('RootTotemPlants', 'root-totem-plants.js');
  ensureCompanionScript('LifeTotemFurniture', 'life-totem-furniture.js');

  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }
  function canonicalRootTotemRecipe() {
    return window.HOBUNJI_ROOT_TOTEM_CONFIG?.canonicalRecipe || null;
  }

  function buildDenRockMoundGeo(colsTiles, rowsTiles, peakHeight, salt, mouthRect) {
    const CX = Math.max(3, Math.round(colsTiles * deps.ROCK_MOUND_CELLS_PER_TILE));
    const CZ = Math.max(3, Math.round(rowsTiles * deps.ROCK_MOUND_CELLS_PER_TILE));
    const VX = CX + 1, VZ = CZ + 1;
    let _s = (Math.imul(Math.round(colsTiles * 97) + 1, 374761393) ^ Math.imul(Math.round(rowsTiles * 131) + 1, 668265263) ^ Math.imul(salt, 2654435761)) >>> 0;
    const rng = () => { _s += 0x6D2B79F5; let t = Math.imul(_s ^ _s >>> 15, _s | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
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
      const edgeDist = Math.min(u, 1 - u, v, 1 - v);
      const norm = Math.min(1, edgeDist * 2);
      const dome = norm * norm * (3 - 2 * norm);
      Y[vj * VX + vi] = Math.max(0, dome * peakHeight + roughDisp(u, v) * dome);
    }
    if (mouthRect) {
      for (let vj = 0; vj < VZ; vj++) for (let vi = 0; vi < VX; vi++) {
        const u = vi / CX, v = vj / CZ;
        const inU = u >= mouthRect.u0 && u <= mouthRect.u1;
        const nearV = Math.max(0, (v - mouthRect.v0) / (1 - mouthRect.v0));
        if (inU && nearV > 0) Y[vj * VX + vi] *= Math.max(0, 1 - nearV * 1.6);
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

  function buildAnimalDenMeshes(zScene, zGrid, dens, mapId) {
    if (!dens || !dens.length) return;
    const DEN_PEAK_HEIGHT = 2.0, DEN_SINK = 0.5;
    const MOUTH_U0 = 0.3, MOUTH_U1 = 0.7, MOUTH_V0 = 0.6;
    const pos = [], idx = []; let vi = 0, denSalt = 0;
    for (const den of dens) {
      const w = den.w || 1, h = den.h || 1;
      const centerCol = den.x + Math.floor(w / 2), centerRow = den.y + Math.floor(h / 2);
      const elevTier = zGrid?.[centerRow]?.[centerCol]?.elevTier || 0;
      const groundY = deps.NORMAL_TOP + elevTier * deps.PLATEAU_UNIT - DEN_SINK;
      const mound = buildDenRockMoundGeo(w, h, DEN_PEAK_HEIGHT, (denSalt += 97), { u0: MOUTH_U0, u1: MOUTH_U1, v0: MOUTH_V0 });
      const base = vi;
      for (let p = 0; p < mound.vertexCount; p++) pos.push(den.x + mound.positions[p * 3], groundY + mound.positions[p * 3 + 1], den.y + mound.positions[p * 3 + 2]);
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

  function buildRootTotemMeshes(zScene, zGrid, totems, mapId) {
    if (!totems || !totems.length) return;
    const canonicalRecipe = canonicalRootTotemRecipe();
    if (!window.HOBUNJI_ROOT_TOTEM_CONFIG || !window.RootTotemPlants || !canonicalRecipe || !window.StructuralWrap || !window.FoliageGenerator || !window.DeadzoneBillboard || !window.RootTotemSurfaceStyle || !window.NaturalSurfaceMaterials || !window.LifeTotemFurniture?.build) {
      const missing = [
        !window.HOBUNJI_ROOT_TOTEM_CONFIG && 'HOBUNJI_ROOT_TOTEM_CONFIG',
        !window.NaturalSurfaceMaterials && 'NaturalSurfaceMaterials',
        !window.StructuralWrap && 'StructuralWrap',
        !window.FoliageGenerator && 'FoliageGenerator',
        !window.RootTotemSurfaceStyle && 'RootTotemSurfaceStyle',
        !window.DeadzoneBillboard && 'DeadzoneBillboard',
        !window.RootTotemPlants && 'RootTotemPlants',
        !canonicalRecipe && 'rootTotemConfig.canonicalRecipe',
        !window.LifeTotemFurniture?.build && 'LifeTotemFurniture.build',
      ].filter(Boolean).join(', ');
      console.error(`[zone:${mapId}] root-totem visual dependencies missing: ${missing}; checkpoint data remains valid.`);
      return;
    }

    window.RootTotemPlants.clearDiagnostics();
    const group = new THREE.Group();
    group.name = 'rootTotemWorldVisuals';
    for (const totem of totems) {
      const elevTier = zGrid?.[totem.y]?.[totem.x]?.elevTier || 0;
      const groundY = deps.NORMAL_TOP + elevTier * deps.PLATEAU_UNIT;
      const cx = totem.x + 0.5, cz = totem.y + 0.5;
      const worldTotem = window.LifeTotemFurniture.build({ rootTotemPlant: canonicalRecipe, worldRootTotem: true });
      worldTotem.name = 'rootTotemWorldVisual';
      worldTotem.position.set(cx, groundY, cz);
      worldTotem.userData.rootTotemWorldVisual = true;
      worldTotem.userData.rootTotemLocation = { mapId, x: totem.x, y: totem.y };
      worldTotem.userData.canonicalRootTotemRecipe = true;
      group.add(worldTotem);
      const plant = worldTotem.getObjectByName?.('lifeTotemFurniturePlant') || worldTotem;
      window.RootTotemPlants.recordPlacedTotem({ mapId, x: totem.x, y: totem.y, seedU32: canonicalRecipe.seedU32, plant });
    }
    zScene.add(group);
    const message = `root-totem world visuals built: ${totems.length} (configured authored basin + canonical ${canonicalRecipe.sourceTree} recipe)`;
    if (typeof window.__farmLog === 'function') window.__farmLog(`[zone:${mapId}] ${message}`, 'info');
    else console.log(`%c[zone:${mapId}] ${message}`, 'color:#22c55e;font-weight:bold');
    return group;
  }

  const api = { init, canonicalRootTotemRecipe, buildDenRockMoundGeo, buildAnimalDenMeshes, buildRootTotemMeshes };
  Object.defineProperty(api, 'CANONICAL_ROOT_TOTEM_RECIPE', { enumerable: true, get: canonicalRootTotemRecipe });
  window.ZoneDenTotemFeatures = api;
})();
