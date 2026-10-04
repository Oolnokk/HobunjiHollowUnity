// Isolated, event-rendered views reuse production furniture geometry and pattern surfaces.
(() => {
  'use strict';
  let active = null; // Main preview instance; modal instances own separate resources.
  let windowRecipe = null; // Authored window recipe is fetched once and copied for each tall preview.
  let lastError = null; // Exposed by the existing mobile debug snapshot.
  async function partsFor(mode) {
    if (mode === 'banner') return JSON.parse(JSON.stringify(window.ProceduralFurniture.CATALOG.hangingBanner));
    if (!windowRecipe) {
      const response = await fetch('../../config/furniture-authored/simpleWindow.json'); // Reuse the actual pane and frame instead of inventing another window mesh.
      if (!response.ok) throw new Error(`Window preset failed to load (${response.status})`);
      windowRecipe = await response.json();
    }
    const parts = JSON.parse(JSON.stringify(windowRecipe.parts)); // Tall proportions are confined to the preview copy.
    for (const part of parts) {
      part.transform.y = 1.6 + (part.transform.y - 1.12) * 2;
      part.transform.sy *= 2;
      if (part.id === 'simple_window_pane') {
        part.patternSurfaces = [1,-1].map(direction => ({slot:direction > 0 ? 'church-glass-front' : 'church-glass-back',mode:'glass',normal:[0,0,direction],scale:1,opacity:.8})); // Each pane face receives the same draft and palette.
      }
    }
    return parts;
  }
  function mount(container, mode, palette, selectPatterns = pattern => [pattern]) {
    if (!window.THREE || !THREE.OrbitControls) throw new Error('3D preview dependencies failed to load. Reload to retry.');
    const renderer = new THREE.WebGLRenderer({antialias:true,alpha:false}); // Only this instance owns this context.
    renderer.setPixelRatio(Math.min(2,window.devicePixelRatio || 1));
    renderer.outputEncoding = THREE.sRGBEncoding;
    const scene = new THREE.Scene(); // Neutral background keeps transparent stained glass visible.
    scene.background = new THREE.Color('#777777');
    scene.add(new THREE.HemisphereLight(0xffffff,0x58616e,1));
    const camera = new THREE.PerspectiveCamera(38,1,.01,100); // Fitted to complete furniture bounds after loading.
    const viewport = document.createElement('div'); // Same touch-sized viewport works on the page and in the authoring modal.
    viewport.style.cssText = 'width:100%;height:min(420px,55vh);min-height:230px;touch-action:none';
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    container.replaceChildren(viewport); viewport.appendChild(renderer.domElement);
    const controls = new THREE.OrbitControls(camera,renderer.domElement); // Event-driven orbit/pinch needs no permanent animation loop.
    controls.enableDamping = false;
    let disposed = false, generation = 0, group = null; // Late fetches and replaced drafts cannot resurrect disposed previews.
    const render = () => { if (!disposed && group) renderer.render(scene,camera); }; // Shared by controls, resize and texture completion.
    const resize = () => {
      if (disposed) return;
      const width = Math.max(1,viewport.clientWidth), height = Math.max(1,viewport.clientHeight); // CSS dictates resolution on mobile.
      renderer.setSize(width,height,false); camera.aspect = width/height; camera.updateProjectionMatrix(); render();
    };
    const observer = new ResizeObserver(resize); // Handles portrait/landscape and modal layout changes.
    observer.observe(viewport); controls.addEventListener('change',render);
    function clear() {
      if (!group) return;
      scene.remove(group);
      group.traverse(node => {
        node.geometry?.dispose();
        for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
          if (material.userData?.previewTexture) material.map?.dispose(); // Production pattern textures belong to the shared bounded cache.
          material.dispose();
        }
      });
      group = null;
    }
    async function update(value, nextPalette = palette) {
      const request = ++generation; // Every asynchronous build has one generation identity.
      const parts = await partsFor(mode); // Recipe fetch errors are surfaced by the caller's existing status UI.
      if (disposed || request !== generation) return;
      clear(); group = new THREE.Group(); scene.add(group);
      const pending = []; // Wait for both actual PNG surfaces and production pattern atlases.
      for (const part of parts) {
        const textureName = part.materialTexture; // Runtime loader assumes the game root; this standalone tool resolves assets explicitly.
        delete part.materialTexture;
        for (const record of part.patternSurfaces || []) {
          record.patternId = selectPatterns(value).length ? null : (record.patternId || 'omgurku_knot'); record.pattern = selectPatterns(value)[0] || null;
          record.patterns = selectPatterns(value).filter(Boolean); record.palette = nextPalette;
        }
        const mesh = window.ProceduralFurniture.buildPartMesh(part); // Geometry, wind shader and PNG overlay material stay production-owned.
        group.add(mesh);
        for (const child of mesh.children) if (child.userData.patternReady) pending.push(child.userData.patternReady);
        if (textureName) pending.push(new Promise((resolve,reject) => {
          new THREE.TextureLoader().load('../../assets/textures/' + textureName, texture => {
            if (disposed || request !== generation) { texture.dispose(); resolve(); return; }
            texture.magFilter = THREE.NearestFilter; texture.encoding = THREE.sRGBEncoding;
            mesh.material.map = texture; mesh.material.userData.previewTexture = true; mesh.material.needsUpdate = true;
            render(); resolve();
          },undefined,()=>reject(new Error('Could not load furniture texture: ' + textureName)));
        }));
      }
      scene.updateMatrixWorld(true);
      group.traverse(node => { if (node.userData.furniturePattern) node.onBeforeRender?.(); }); // Resolve atlas size using the final world dimensions.
      const bounds = new THREE.Box3().setFromObject(group), center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3()); // Fit full support/frame, not just the patterned surface.
      if (!viewport.dataset.fitted) {
        controls.target.copy(center);
        camera.position.copy(center).add(new THREE.Vector3(.2,.08,1).normalize().multiplyScalar(Math.max(1,size.length()) / Math.sin(camera.fov*Math.PI/360)));
        controls.update(); viewport.dataset.fitted = '1';
      }
      resize(); await Promise.all(pending);
      if (disposed || request !== generation) return;
      const failures = []; // Surface diagnostics report asynchronous atlas failures without devtools.
      group.traverse(node => { if (node.userData.furniturePattern && node.userData.furniturePattern.status !== 'ready') failures.push(node.userData.furniturePattern.status); });
      if (failures.length && selectPatterns(value).length) throw new Error(failures.join('; '));
      render();
      return {status:'Drag to orbit; pinch or scroll to zoom.'};
    }
    return {mode,update,dispose() {
      if (disposed) return;
      disposed = true; generation++; observer.disconnect(); controls.removeEventListener('change',render); controls.dispose(); clear();
      renderer.dispose(); renderer.forceContextLoss(); viewport.remove();
    }};
  }
  window.PatternFurniturePreview = {
    mount,
    async show(container,mode,patterns,palette) {
      try {
        if (active?.mode !== mode) { active?.dispose(); active = mount(container,mode,palette, value => value); }
        await active.update(patterns,palette); lastError = null;
      } catch (error) { lastError = error.message; document.getElementById('status').textContent = '3D preview: ' + error.message; }
    },
    dispose() { active?.dispose(); active = null; },
    debug() { return {mode:active?.mode || null,lastError,mostRecentChange:'Two-sided church stained glass with a grey 3D preview background, including primary/overpass drafts.'}; },
  };
  window.addEventListener('pagehide',()=>window.PatternFurniturePreview.dispose());
})();
