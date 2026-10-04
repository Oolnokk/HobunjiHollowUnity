// Uses the base editor's selections, parts, undo history and JSON exports.
(() => {
  'use strict';
  const api = window.FurniturePatternSurfaces; // Shared preview/game surface renderer.
  const panel = document.createElement('section'); // Controls live beside the existing surface editor.
  panel.className = 'card';
  panel.innerHTML = `<h3>Furniture patterns</h3>
    <p>Select a surface or piece. Pattern size is measured in tiles and stays independent of the furniture size.</p>
    <label>Surface slot <input id="fpSlot" value="surface"></label>
    <label>Use <select id="fpMode"><option value="cloth">Cloth / carpet</option><option value="glass">Stained glass</option><option value="engraving">Engraving</option></select></label>
    <label><input id="fpRandom" type="checkbox">Random pattern on each ruin element</label>
    <label>Pattern tile size <input id="fpScale" type="number" min="0.05" max="20" step="0.05" value="1"></label>
    <label>Base dye <input id="fpBase" type="color" value="#b7a185"></label>
    <label>Pattern dye <input id="fpDye" type="color" value="#315b67"></label>
    <label>Engraving core opacity <input id="fpCoreOpacity" type="number" min="0" max="1" step="0.05" value="0.85"></label>
    <button id="fpAuthor" type="button">Choose / draw pattern</button>
    <label>Export name <input id="fpExportName" value="Furniture pattern"></label>
    <label><input id="fpCollectible" type="checkbox" checked>Collectible ruin pattern</label>
    <button id="fpPng" type="button">Export motif PNG</button>
    <button id="fpJson" type="button">Export pattern JSON</button>
    <p id="fpExportHelp">Export both files, then add the pattern to the repository library to use it as a ruin collectible.</p>
    <button id="fpApply" type="button">Apply settings</button>
    <button id="fpClear" type="button">Clear selected pattern</button>
    <button id="fpCarpet" type="button">Add carpet</button>
    <button id="fpBanner" type="button">Load hanging banner preset</button>
    <pre id="fpDebug" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>`;
  document.getElementById('surfaceEditor')?.parentElement?.appendChild(panel);
  const input = id => document.getElementById(id); // Every handler reads current values, rather than stale selected records.

  function target() {
    const surface = selectedSurface(); // Canonical recognized surface selection takes precedence over piece selection.
    return { surface, part: surface ? state.parts.find(part => part.id === surface.partId) : selectedPart() };
  }
  function currentRecord() {
    const { part, surface } = target(); // Finds the exact selected slot, with existing whole-piece defaults as a fallback.
    if (!surface) return part?.patternSurfaces?.[0] || null;
    return part?.patternSurfaces?.find(record => record.slot === surface.id ||
      (record.selector === 'top' && surface.localNormal.y > .7) ||
      (record.selector === 'sides' && Math.abs(surface.localNormal.y) < .7) ||
      (record.selector === 'all') ||
      (record.normal && surface.localNormal.dot(new THREE.Vector3(...record.normal).normalize()) > .97)) || null;
  }
  function settings() {
    const { part, surface } = target(); // Surface-local geometry keeps glass/engraving away from frames or neighboring faces.
    if (!part) return null;
    const record = api.normalize({ ...currentRecord(), slot: currentRecord()?.slot || surface?.id || input('fpSlot').value || 'surface', mode: input('fpMode').value, opacity: input('fpMode').value === 'glass' ? .8 : input('fpMode').value === 'engraving' ? .5 : 1,
      engravingCoreOpacity: input('fpCoreOpacity').value || .85, random: input('fpRandom').checked, scale: input('fpScale').value, palette: [input('fpBase').value, input('fpDye').value],
      ...(surface ? { normal: surface.localNormal.toArray(), localCentroid: surface.localCentroid.toArray(), dimensions: [part.transform.sx,part.transform.sy,part.transform.sz] } : {}) });
    if (surface && ['cylinder','disc','legRound','barrel','cup','sphere'].includes(part.kind) && surface.faceIndices.length > 2) {
      record.selector = surface.recognizedType === 'upward top' ? 'top' : surface.recognizedType === 'underside' ? 'bottom' : 'sides'; // Curved recognized groups wrap their entire cap/side instead of clipping to one averaged normal.
      delete record.normal; delete record.localCentroid; delete record.dimensions;
    }
    return record;
  }
  function commit(record) {
    const { part } = target(); // Part metadata is already serialized by every author/runtime export path.
    if (!part || !record) return;
    if (record.random && !record.patternId && !record.pattern) record.patternId = window.PatternLibrary?.getCatalog?.()[0]?.id;
    if (!record.patternId && !record.pattern) { log('Choose or draw a pattern first.', 'warn'); return; }
    part.patternSurfaces = [...(part.patternSurfaces || []).filter(entry => entry.slot !== record.slot), record];
    if (record.mode === 'glass' && selectedSurface()) window.FurnitureDaylightWindowAuthor?.markSelectedAsWindow?.(); // Keeps the existing daylight aperture and house-window integration.
    rebuildFurnitureMeshes(); queueUndoHistory('edit furniture pattern');
    refresh();
  }
  function refresh() {
    const record = currentRecord(); // No animation polling or competing selection model is needed.
    if (record) {
      input('fpSlot').value = record.slot;
      input('fpMode').value = record.mode;
      input('fpCoreOpacity').value = record.engravingCoreOpacity ?? .85;
      input('fpScale').value = record.scale; input('fpRandom').checked = !!record.random;
      input('fpBase').value = record.palette?.[0] || '#b7a185'; input('fpDye').value = record.palette?.[1] || '#315b67';
    }
    input('fpDebug').textContent = JSON.stringify({ selectedPart: target().part?.id || null, selectedSurface: target().surface?.id || null, patterns: api.debug(root) }, null, 2);
  }
  function mountFurniturePreview(container, partId, record) {
    const previewRenderer = new THREE.WebGLRenderer({antialias:true,alpha:false}); // One isolated context for the open modal; rendered only on changes.
    previewRenderer.setPixelRatio(Math.min(2,window.devicePixelRatio || 1));
    previewRenderer.outputEncoding=renderer.outputEncoding; previewRenderer.toneMapping=renderer.toneMapping; previewRenderer.toneMappingExposure=renderer.toneMappingExposure;
    const previewScene = new THREE.Scene(); // Current furniture and the editor's lighting share their actual visual definitions.
    previewScene.background=scene.background?.clone?.() || new THREE.Color('#11191e');
    for(const child of scene.children) if(child.isLight) previewScene.add(child.clone());
    const furniture = root.clone(true); // Geometry/materials/textures are borrowed; preview cleanup must never dispose editor resources.
    previewScene.add(furniture);
    const previewCamera = camera.clone(); // Retain the current viewing direction while fitting the complete furniture assembly.
    const bounds = new THREE.Box3().setFromObject(furniture), center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3()); // Complete piece bounds anchor the mobile orbit target.
    const direction = camera.position.clone().sub(orbit?.target || center).normalize(); // Starts from the user's existing authoring angle.
    if(direction.lengthSq()<.001)direction.set(1,.8,1).normalize();
    const distance = Math.max(.5,size.length()) / Math.sin(previewCamera.fov*Math.PI/360); // Conservative sphere fit remains visible in the narrow modal.
    previewCamera.position.copy(center).addScaledVector(direction,distance); previewCamera.near=.01; previewCamera.far=Math.max(100,distance*10); previewCamera.lookAt(center);
    const viewport = document.createElement('div'); // Dedicated mount replaces the shared editor's flat image canvas.
    viewport.style.cssText='width:100%;height:min(280px,40vh);min-height:180px;touch-action:none;position:relative';
    previewRenderer.domElement.style.cssText='width:100%;height:100%;max-width:none;max-height:none;display:block;touch-action:none';
    container.replaceChildren(viewport); viewport.appendChild(previewRenderer.domElement);
    const controls = OrbitControls ? new OrbitControls(previewCamera,previewRenderer.domElement) : null; // Existing mouse/touch camera controls provide orbit and pinch zoom.
    if(controls){controls.target.copy(center);controls.enableDamping=false;controls.update();}
    let disposed=false, generation=0, overlays=[]; // Draft changes own only their newly constructed pattern overlays.
    const render = () => { if(!disposed)previewRenderer.render(previewScene,previewCamera); }; // No additional permanent RAF loop.
    const resize = () => { if(disposed)return;const width=Math.max(1,viewport.clientWidth),height=Math.max(1,viewport.clientHeight);previewRenderer.setSize(width,height,false);previewCamera.aspect=width/height;previewCamera.updateProjectionMatrix();render(); }; // CSS layout determines a sharp responsive viewport.
    controls?.addEventListener('change',render);
    const observer = new ResizeObserver(resize); // Refit the canvas when the modal layout changes on mobile.
    observer.observe(viewport); resize();
    const clearDraft = () => { for(const overlay of overlays){overlay.parent?.remove(overlay);overlay.geometry.dispose();overlay.material.dispose();}overlays=[]; }; // Only materials created by applyPart are owned by this preview.
    const selected = []; // Preserve other surfaces and parts while replacing the selected slot's saved decoration.
    furniture.traverse(node=>{if(node.userData?.type==='part'&&node.userData.id===partId)selected.push(node);});
    for(const node of selected)for(const child of [...node.children])if(child.userData?.furniturePattern?.slot===record.slot)node.remove(child); // Detached clones borrow the original resources and are never disposed.
    const part = state.parts.find(part=>part.id===partId); // Same geometry recipe, wind settings and surface metadata as the edited piece.
    return {
      async update(pattern) {
        if(disposed)return;
        const request=++generation; // Ignore asynchronous work from a superseded draft.
        clearDraft();
        for(const node of selected){const previous=new Set(node.children);api.applyPart(node,{...part,patternSurfaces:[{...record,patternId:null,pattern}]});for(const child of node.children)if(!previous.has(child))overlays.push(child);}
        previewScene.updateMatrixWorld(true);
        for(const overlay of overlays)overlay.onBeforeRender?.(); // Resolve world-scale atlas sizing before waiting for pixels.
        const pending=[...overlays]; // Async edits cannot change this generation's readiness/error checks.
        await Promise.all(pending.map(overlay=>overlay.userData.patternReady));
        if(disposed||request!==generation)return;
        if(!pending.length)throw new Error('The selected furniture surface could not be previewed.');
        const failed=pending.find(overlay=>overlay.userData.furniturePattern.status!=='ready'); // Visible modal errors remain usable without mobile devtools.
        if(failed)throw new Error(failed.userData.furniturePattern.status);
        render();
        const engraving=pending[0]?.userData.furniturePattern.engraving; // Show the actual uploaded atlas's coverage and effective opacity, including disappearing cores on very thin motifs.
        if(engraving)return {status:`Stroke ${Math.round(engraving.strokeOpacity*100)}%; core ${Math.round(engraving.coreOpacity*100)}%. Core pixels: ${engraving.corePixels}; soft stroke pixels: ${engraving.strokePixels}. Drag to rotate; pinch to zoom.`};
      },
      dispose(){if(disposed)return;disposed=true;generation++;observer.disconnect();controls?.removeEventListener('change',render);controls?.dispose();clearDraft();previewRenderer.dispose();previewRenderer.forceContextLoss();viewport.remove();},
    };
  }
  async function author() {
    const record = settings(); // Snapshot protects the modal preview from later selection changes.
    if (!record) { log('Select a surface or furniture piece first.', 'warn'); return; }
    const partId = target().part.id; // The modal always previews the piece selected when it opened.
    try {
      await window.RepoPatternLibrary.preloadEditable();
      const entries = window.RepoPatternLibrary.listCached(); // Same repo motifs used by NPC clothes/paint, alongside existing saved/unlocked patterns.
      window.PatternAuthoring.openEditor({ title: 'Furniture surface pattern', initialPattern: await api.editablePattern(record),
        library: { readOnly: true, list: () => [...entries, ...(window.PatternLibrary?.listAvailable?.() || [])],
          get: id => window.RepoPatternLibrary.getCachedEditableById(id) || window.PatternLibrary?.getById?.(id) },
        mountPreview: container => mountFurniturePreview(container,partId,record),
        previewHint: 'Drag to rotate. Pinch or scroll to zoom. Draft changes appear on the selected surface.',
        onSave: async (pattern, id) => commit({ ...record, patternId: id || null, pattern: await api.editablePattern({pattern}) }) });
    } catch (error) { log(`Furniture patterns: ${error.message}`, 'error'); }
  }
  async function exportPattern(kind) {
    try {
      const record = currentRecord(); // Export the saved ink and author settings for the selected slot.
      if (!record) throw new Error('Choose or draw a pattern first.');
      const payload = await window.RepoPatternLibrary.exportDefinition(await api.editablePattern(record), input('fpExportName').value, input('fpCollectible').checked); // Shared repo schema supports decorative and collectible patterns.
      const anchor = document.createElement('a'); // Separate mobile-friendly download buttons avoid collapsed simultaneous downloads.
      const url = kind === 'png' ? payload.motifDataUrl : URL.createObjectURL(new Blob([JSON.stringify(payload.json,null,2)+'\n'],{type:'application/json'})); // JSON references the original ink PNG.
      anchor.href=url; anchor.download=kind === 'png' ? payload.motifFile : payload.jsonFile;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      if(kind === 'json') setTimeout(()=>URL.revokeObjectURL(url),1000);
      input('fpExportHelp').textContent = `PNG → docs/assets/patterns/${payload.motifFile}; JSON → docs/config/patterns/${payload.jsonFile}. Add to docs/config/patterns/index.json: ${JSON.stringify(payload.indexEntry)}`;
    } catch(error) { log(`Pattern export: ${error.message}`,'error'); }
  }
  function addCarpet() {
    const part = pushPart('box', { name: 'Patterned carpet', color: '#b7a185', transform: { x:0,y:.02,z:0,rx:0,ry:0,rz:0,sx:2,sy:.03,sz:2 },
      patternSurfaces: [{ slot:'carpet', mode:'cloth', selector:'top', patternId:'omgurku_knot', scale:1, palette:['#b7a185','#315b67'] }] }); // Added to existing furniture rather than replacing it.
    state.selectedType='part'; state.selectedId=part.id; rebuildAll(); queueUndoHistory('add carpet');
  }
  function loadBannerPreset() {
    clearFurniture(); // The preset replaces the current structure, including prior sign ropes/rigid animations.
    state.tileBase.footprintW=1;state.tileBase.footprintD=1;
    const parts=window.ProceduralFurniture.CATALOG.hangingBanner.map(raw=>pushPart(raw.kind,JSON.parse(JSON.stringify(raw)))); // Same recipe as authored/runtime banners; edits cannot mutate the shared catalog.
    const cloth=parts.find(part=>part.kind==='banner'); // Select the editable cloth rather than the support.
    state.selectedType='part';state.selectedId=cloth.id;
    rebuildAll();applyEntrySurfaceDefaults({materialRules:{mapping:'stretch'}},parts);rebuildFurnitureMeshes();syncControlsFromState?.();frameFurniture();setEditorMode('parts');refresh();
    queueUndoHistory('load hanging banner preset');log('Loaded hanging banner preset: exact store/inn sign beam, with top-pinned cloth replacing the board and ropes.');
  }
  input('fpPng').onclick=()=>exportPattern('png'); input('fpJson').onclick=()=>exportPattern('json');
  input('fpAuthor').onclick=author;
  input('fpApply').onclick=()=>commit(settings());
  input('fpClear').onclick=()=>{ const {part}=target(), record=currentRecord(); if(part&&record) { part.patternSurfaces=part.patternSurfaces.filter(entry=>entry!==record); rebuildFurnitureMeshes(); queueUndoHistory('clear furniture pattern'); } };
  input('fpCarpet').onclick=addCarpet; input('fpBanner').onclick=loadBannerPreset;
  window.FurniturePatternAuthor = { refresh, loadBannerPreset };
  rebuildFurnitureMeshes();
})();
