'use strict';

(() => {
  const THREE = window.THREE;
  const BorderTerrain = window.BorderTerrain;
  if (!THREE || !BorderTerrain || BorderTerrain.__hobunjiBoundaryCurrentGameAuto) return;

  const stats = {
    builds: 0,
    meshesSeen: 0,
    cliffsMapped: 0,
    grassJigsawBaked: 0,
    materialsRestored: 0,
    failures: 0,
    lastError: '',
  };

  function collectMeshes(roots) {
    const meshes = new Set();
    const visit = object => { if (object?.isMesh) meshes.add(object); };
    for (const root of roots) {
      if (!root) continue;
      visit(root);
      root.traverse?.(visit);
    }
    return [...meshes];
  }

  function materialArray(value) {
    return Array.isArray(value) ? value : [value];
  }

  function terrainKey(mesh) {
    const materials = materialArray(mesh?.material);
    for (const material of materials) {
      const key = String(material?.userData?.terrainKey || '').toLowerCase();
      if (key) return key;
    }
    return String(mesh?.userData?.terrainKey || '').toLowerCase();
  }

  function copyTextureSampler(sourceTexture, targetTexture) {
    if (!sourceTexture || !targetTexture) return;
    targetTexture.wrapS = sourceTexture.wrapS;
    targetTexture.wrapT = sourceTexture.wrapT;
    targetTexture.repeat?.copy?.(sourceTexture.repeat);
    targetTexture.offset?.copy?.(sourceTexture.offset);
    targetTexture.center?.copy?.(sourceTexture.center);
    targetTexture.rotation = sourceTexture.rotation;
    targetTexture.matrixAutoUpdate = sourceTexture.matrixAutoUpdate;
    targetTexture.needsUpdate = true;
  }

  function restorePreviewMaterialIdentity(mesh, originalMaterial) {
    const mappedMaterial = mesh.material;
    if (mappedMaterial === originalMaterial) return;

    const mapped = materialArray(mappedMaterial);
    const original = materialArray(originalMaterial);
    for (let index = 0; index < original.length; index++) {
      const target = original[index];
      const source = mapped[index] || mapped[0];
      if (!target || !source) continue;
      copyTextureSampler(source.map, target.map);
      target.userData = Object.assign({}, target.userData || {}, {
        boundaryPreviewCurrentGameSampler: true,
        boundaryPreviewCurrentGameMappedMaterialName: source.name || '',
      });
      target.needsUpdate = true;
    }

    mesh.material = originalMaterial;
    stats.materialsRestored++;

    for (const material of mapped) {
      if (!material || original.includes(material)) continue;
      try {
        if (material.map && !original.some(item => item?.map === material.map)) material.map.dispose?.();
      } catch (_) {}
      try { material.dispose?.(); } catch (_) {}
    }
  }

  function tagNaturalCliff(mesh) {
    mesh.userData = Object.assign({}, mesh.userData || {}, {
      naturalSurface: 'cliffs',
      boundaryPreviewCurrentGameAuto: true,
    });
    const materials = materialArray(mesh.material);
    for (const material of materials) {
      if (!material) continue;
      material.userData = Object.assign({}, material.userData || {}, {
        naturalSurface: 'cliffs',
        boundaryPreviewCurrentGameAuto: true,
      });
    }
  }

  function runCurrentGameAuto(mesh) {
    const key = terrainKey(mesh);
    const originalMaterial = mesh.material;

    if (key === 'cliff') {
      tagNaturalCliff(mesh);
      const mapper = window.HobunjiSurfaceStretchUV;
      const report = mapper?.mapMesh?.(mesh, {
        force: true,
        label: 'boundary-preview-current-game-auto',
      });
      restorePreviewMaterialIdentity(mesh, originalMaterial);
      if (report) {
        mesh.userData = Object.assign({}, mesh.userData || {}, {
          boundaryPreviewCurrentGameOwner: report.finalOwner || report.mapping || 'HobunjiSurfaceStretchUV',
        });
        stats.cliffsMapped++;
        return true;
      }
      stats.failures++;
      stats.lastError = 'cliff mapper unavailable or returned null';
      return false;
    }

    if (key === 'grass') {
      const jigsaw = window.TerrainJigsawUV;
      const report = jigsaw?.bakeMesh?.(mesh, {
        force: true,
        disposeSource: true,
      });
      restorePreviewMaterialIdentity(mesh, originalMaterial);
      if (report) {
        mesh.userData = Object.assign({}, mesh.userData || {}, {
          boundaryPreviewCurrentGameAuto: true,
          boundaryPreviewCurrentGameOwner: 'TerrainJigsawUV',
        });
        stats.grassJigsawBaked++;
        return true;
      }
      stats.failures++;
      stats.lastError = 'grass automatic Jigsaw bake unavailable or returned null';
      return false;
    }
    return false;
  }

  const originalBuild = BorderTerrain.buildTownBorderTerrain;
  if (typeof originalBuild !== 'function') return;

  BorderTerrain.buildTownBorderTerrain = function boundaryCurrentGameAutoBuild(...args) {
    const sceneProto = THREE.Scene?.prototype;
    const previousAdd = sceneProto?.add;
    const roots = [];
    function capturingAdd(...objects) {
      for (const object of objects) if (object) roots.push(object);
      return previousAdd.apply(this, objects);
    }

    if (sceneProto && typeof previousAdd === 'function') sceneProto.add = capturingAdd;
    let result;
    try {
      result = originalBuild.apply(this, args);
    } finally {
      if (sceneProto && sceneProto.add === capturingAdd) sceneProto.add = previousAdd;
    }

    stats.builds++;
    const meshes = collectMeshes(roots);
    stats.meshesSeen += meshes.length;
    for (const mesh of meshes) {
      try { runCurrentGameAuto(mesh); }
      catch (error) {
        stats.failures++;
        stats.lastError = String(error?.message || error);
        console.warn('[boundary-current-game-auto] failed to apply current game terrain pipeline:', error);
      }
    }
    return result;
  };
  BorderTerrain.buildTownBorderTerrain.__hobunjiBoundaryCurrentGameAutoOriginal = originalBuild;
  BorderTerrain.__hobunjiBoundaryCurrentGameAuto = true;

  function relabel() {
    const left = document.getElementById('preview3dLeftLabel');
    const right = document.getElementById('preview3dRightLabel');
    if (left) left.textContent = 'CURRENT GAME AUTO';
    if (right) right.textContent = 'DIRECT JIGSAW';
    const mode = document.getElementById('preview3dMode');
    if (mode) {
      for (const option of mode.options) {
        if (option.value === 'compare') option.textContent = 'Current game vs direct Jigsaw';
        else if (option.value === 'ordinary') option.textContent = 'Current game only';
        else if (option.value === 'protected') option.textContent = 'Direct Jigsaw only';
      }
    }
  }
  relabel();
  window.addEventListener?.('DOMContentLoaded', relabel, { once: true });

  window.BoundaryCurrentGameAuto = {
    installed: true,
    snapshot: () => Object.assign({}, stats),
  };
})();
