'use strict';

// CURRENT GAME AUTO must be self-contained. The game normally loads these from
// docs/index.html before terrain builds; the Background Scenery author does not.
// Insert them during parsing, then install the comparison wrapper after the page
// has finished loading so the later segmented-Jigsaw owner has also wrapped the
// central mapper.
if (document.readyState === 'loading' && typeof document.write === 'function') {
  if (!window.NaturalSurfaceMaterialConfig) {
    document.write('<script src="../../config/natural-surface-materials.js?v=20260914boundary-current2"><\/script>');
  }
  if (!window.NaturalSurfaceMaterials) {
    document.write('<script src="../../js/natural-surface-materials.js?v=20260914boundary-current2"><\/script>');
  }
}

(() => {
  const FINAL_OWNER = 'surface-split-jigsaw-v2';
  const FARM_PATCH_WORLD_SIZE = 6;
  const stats = {
    installed: false,
    builds: 0,
    meshesSeen: 0,
    cliffsMapped: 0,
    rocksNaturalized: 0,
    grassJigsawBaked: 0,
    missingDependencies: 0,
    failures: 0,
    lastError: '',
    finalOwnerCounts: {},
  };

  function normalizeToolTexturePaths() {
    const config = window.NaturalSurfaceMaterialConfig;
    if (!config || config.__boundaryAuthorPathsNormalized) return;
    const toolPath = value => {
      const raw = String(value || '').trim();
      if (!raw || /^(?:https?:|data:|blob:|\.\.\/\.\.\/)/i.test(raw)) return raw;
      const clean = raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^docs\//, '');
      return clean.startsWith('assets/') ? `../../${clean}` : raw;
    };
    if (config.texture) config.texture = toolPath(config.texture);
    for (const surface of Object.values(config.surfaces || {})) {
      if (surface?.texture) surface.texture = toolPath(surface.texture);
    }
    config.__boundaryAuthorPathsNormalized = true;
  }

  function materialArray(value) {
    return Array.isArray(value) ? value : [value];
  }

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

  function terrainKey(mesh) {
    for (const material of materialArray(mesh?.material)) {
      const key = String(material?.userData?.terrainKey || '').toLowerCase();
      if (key) return key;
    }
    return String(mesh?.userData?.terrainKey || '').toLowerCase();
  }

  function noteOwner(owner) {
    const key = String(owner || 'unknown');
    stats.finalOwnerCounts[key] = (stats.finalOwnerCounts[key] || 0) + 1;
  }

  function finalOwner(mesh, report) {
    return String(
      mesh?.geometry?.userData?.hobunjiSurfaceJigsaw?.owner
      || mesh?.geometry?.userData?.hobunjiSurfaceStretch?.finalOwner
      || report?.finalOwner
      || report?.mapping
      || mesh?.userData?.terrainJigsawFinalOwner
      || 'unknown'
    );
  }

  function tagInitialCliff(mesh) {
    mesh.userData = Object.assign({}, mesh.userData || {}, {
      naturalSurface: 'cliffs',
      boundaryPreviewCurrentGameAuto: true,
    });
    for (const material of materialArray(mesh.material)) {
      if (!material) continue;
      material.userData = Object.assign({}, material.userData || {}, {
        naturalSurface: 'cliffs',
        boundaryPreviewCurrentGameAuto: true,
      });
    }
  }

  function runCurrentGameAuto(mesh) {
    const key = terrainKey(mesh);
    if (key === 'cliff') {
      const natural = window.NaturalSurfaceMaterials;
      const mapper = window.HobunjiSurfaceStretchUV;
      if (!natural?.naturalizeMesh || !mapper?.mapMesh) {
        stats.failures++;
        stats.missingDependencies++;
        stats.lastError = 'CURRENT GAME AUTO missing NaturalSurfaceMaterials or HobunjiSurfaceStretchUV';
        return false;
      }

      // This deliberately mirrors the farm's finished-cliff sequence rather
      // than mapping the clean BorderTerrain preview mesh directly:
      // cliffs -> farm rock material/tint -> central surface split -> segmented
      // Jigsaw final owner. Keep the resulting material; do NOT restore the
      // editor's clean preview material afterward.
      tagInitialCliff(mesh);
      natural.naturalizeMesh(mesh, 'rocks');
      stats.rocksNaturalized++;
      mesh.userData = Object.assign({}, mesh.userData || {}, {
        farmCliffRockMaterial: true,
        farmCliffTextureOutline: true,
        boundaryPreviewRockified: true,
      });

      const report = mapper.mapMesh(mesh, {
        force: true,
        label: 'boundary-preview-current-game-auto:post-rockify',
        maxPatchWorldSize: FARM_PATCH_WORLD_SIZE,
      });
      if (!report) {
        stats.failures++;
        stats.lastError = 'game cliff mapper returned null after rockification';
        return false;
      }

      const owner = finalOwner(mesh, report);
      noteOwner(owner);
      mesh.userData = Object.assign({}, mesh.userData || {}, {
        boundaryPreviewCurrentGameAuto: true,
        boundaryPreviewCurrentGameOwner: owner,
      });
      stats.cliffsMapped++;
      return true;
    }

    if (key === 'grass') {
      const jigsaw = window.TerrainJigsawUV;
      const report = jigsaw?.bakeMesh?.(mesh, { force: true, disposeSource: true });
      if (!report) {
        stats.failures++;
        stats.lastError = 'grass automatic Jigsaw bake unavailable or returned null';
        return false;
      }
      noteOwner('TerrainJigsawUV');
      mesh.userData = Object.assign({}, mesh.userData || {}, {
        boundaryPreviewCurrentGameAuto: true,
        boundaryPreviewCurrentGameOwner: 'TerrainJigsawUV',
      });
      stats.grassJigsawBaked++;
      return true;
    }
    return false;
  }

  function summary() {
    const owners = Object.entries(stats.finalOwnerCounts)
      .map(([owner, count]) => `${owner}=${count}`)
      .join(',');
    const parts = [
      `CURRENT AUTO rockified ${stats.rocksNaturalized}`,
      `cliffs ${stats.cliffsMapped}`,
      `owners ${owners || 'none'}`,
    ];
    if (stats.failures) parts.push(`failures ${stats.failures}${stats.lastError ? ` (${stats.lastError})` : ''}`);
    return parts.join(' · ');
  }

  function installStatusProof() {
    const status = document.getElementById('preview3dStatus');
    if (!status || status.__boundaryCurrentGameAutoObserver || typeof MutationObserver !== 'function') return;
    let writing = false;
    const append = () => {
      if (writing) return;
      const base = String(status.textContent || '').replace(/\s*·\s*CURRENT AUTO rockified[^\n]*$/i, '').trim();
      if (!base) return;
      writing = true;
      status.textContent = `${base} · ${summary()}`;
      writing = false;
    };
    const observer = new MutationObserver(() => queueMicrotask(append));
    observer.observe(status, { childList: true, subtree: true, characterData: true });
    status.__boundaryCurrentGameAutoObserver = observer;
    append();
  }

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

  function install() {
    const THREE = window.THREE;
    const BorderTerrain = window.BorderTerrain;
    if (stats.installed || !THREE || !BorderTerrain) return;
    normalizeToolTexturePaths();

    const originalBuild = BorderTerrain.buildTownBorderTerrain;
    if (typeof originalBuild !== 'function') {
      stats.failures++;
      stats.lastError = 'BorderTerrain.buildTownBorderTerrain missing';
      return;
    }

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
    stats.installed = true;
    relabel();
    installStatusProof();
  }

  window.BoundaryCurrentGameAuto = {
    installed: true,
    expectedFinalOwner: FINAL_OWNER,
    install,
    summary,
    snapshot: () => Object.assign({}, stats, {
      finalOwnerCounts: Object.assign({}, stats.finalOwnerCounts),
    }),
  };

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => { relabel(); installStatusProof(); }, { once: true });
  else { relabel(); installStatusProof(); }
})();
