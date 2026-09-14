(() => {
  'use strict';

  if (!/\/tools\/map-editor\/(?:index\.html)?$/.test(location.pathname)) return;
  if (window.__hobunjiMapEditorTerrainTextureFix) return;
  window.__hobunjiMapEditorTerrainTextureFix = true;

  const liveRenderers = new Set(); // Used to redraw the event-driven Map Editor after asynchronous PNG texture callbacks finish.
  let redrawFrame = 0; // Used to collapse several texture completions into one preview redraw.

  function queueRedraw() {
    if (redrawFrame) return;
    redrawFrame = requestAnimationFrame(() => {
      redrawFrame = 0;
      for (const renderer of Array.from(liveRenderers)) {
        const last = renderer?.__hobunjiMapEditorLastRender; // Used as the last scene/camera pair the editor asked this renderer to draw.
        if (!renderer?.domElement?.isConnected || !last?.scene || !last?.camera) {
          liveRenderers.delete(renderer);
          continue;
        }
        try { renderer.render(last.scene, last.camera); } catch (_) {}
      }
    });
  }

  function patchThree() {
    const THREE = window.THREE;
    if (!THREE?.WebGLRenderer?.prototype || !THREE?.TextureLoader?.prototype) return false;

    const rendererProto = THREE.WebGLRenderer.prototype;
    if (!rendererProto.__hobunjiMapEditorTextureRedrawWrapped) {
      const originalRender = rendererProto.render;
      rendererProto.render = function mapEditorTextureAwareRender(scene, camera) {
        this.__hobunjiMapEditorLastRender = { scene, camera }; // Used by late texture callbacks to redraw the exact preview without rebuilding its private editor state.
        liveRenderers.add(this);
        return originalRender.call(this, scene, camera);
      };
      rendererProto.__hobunjiMapEditorTextureRedrawWrapped = true;
    }

    const loaderProto = THREE.TextureLoader.prototype;
    if (!loaderProto.__hobunjiMapEditorTextureLoadWrapped) {
      const originalLoad = loaderProto.load;
      loaderProto.load = function mapEditorTextureAwareLoad(url, onLoad, onProgress, onError) {
        const wrappedLoad = texture => {
          try { onLoad?.(texture); }
          finally { queueRedraw(); } // Used because Map Editor renders on demand; assigning material.map alone does not schedule another frame.
        };
        return originalLoad.call(this, url, wrappedLoad, onProgress, onError);
      };
      loaderProto.__hobunjiMapEditorTextureLoadWrapped = true;
    }
    return true;
  }

  function patchNaturalSurfaceMaterialReplacement() {
    const api = window.NaturalSurfaceMaterials;
    if (!api?.naturalizeMesh || api.__hobunjiMapEditorPreservePreviewMaterial) return !!api?.naturalizeMesh;
    const originalNaturalize = api.naturalizeMesh;
    api.naturalizeMesh = function mapEditorPreservePreviewMaterial(mesh, surface, mapping, ...rest) {
      if (mesh?.isMesh) {
        mesh.userData = Object.assign({}, mesh.userData, {
          naturalSurface: surface,
          toolTerrainPreviewMaterialPreserved: true,
        }); // Used so the shared Tool Hub UV mapper may classify/remap this mesh without detaching resolvePreviewMat's asynchronously populated material object.
        return mesh;
      }
      return originalNaturalize.call(this, mesh, surface, mapping, ...rest);
    };
    api.__hobunjiMapEditorPreservePreviewMaterial = true;
    return true;
  }

  function install() {
    const threeReady = patchThree();
    const materialReady = patchNaturalSurfaceMaterialReplacement();
    if (threeReady && materialReady) {
      window.HobunjiMapEditorTerrainTextureFix = {
        installed: true,
        queueRedraw,
        liveRendererCount: () => liveRenderers.size,
      }; // Used by mobile-visible/manual diagnostics without exposing the Map Editor's private three3d closure.
      return;
    }
    setTimeout(install, 40);
  }

  install();
})();
