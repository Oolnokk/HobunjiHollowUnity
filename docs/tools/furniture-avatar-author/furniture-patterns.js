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
    <button id="fpAuthor" type="button">Choose / draw pattern</button>
    <button id="fpApply" type="button">Apply settings</button>
    <button id="fpClear" type="button">Clear selected pattern</button>
    <button id="fpCarpet" type="button">Add carpet</button>
    <button id="fpBanner" type="button">Add hanging banner</button>
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
    const record = api.normalize({ ...currentRecord(), slot: currentRecord()?.slot || surface?.id || input('fpSlot').value || 'surface', mode: input('fpMode').value, opacity: input('fpMode').value === 'glass' ? .8 : 1,
      random: input('fpRandom').checked, scale: input('fpScale').value, palette: [input('fpBase').value, input('fpDye').value],
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
      input('fpScale').value = record.scale; input('fpRandom').checked = !!record.random;
      input('fpBase').value = record.palette?.[0] || '#b7a185'; input('fpDye').value = record.palette?.[1] || '#315b67';
    }
    input('fpDebug').textContent = JSON.stringify({ selectedPart: target().part?.id || null, selectedSurface: target().surface?.id || null, patterns: api.debug(root) }, null, 2);
  }
  async function author() {
    const record = settings(); // Snapshot protects the modal preview from later selection changes.
    if (!record) { log('Select a surface or furniture piece first.', 'warn'); return; }
    try {
      await window.RepoPatternLibrary.preloadEditable();
      const entries = window.RepoPatternLibrary.listCached(); // Same repo motifs used by NPC clothes/paint, alongside existing saved/unlocked patterns.
      window.PatternAuthoring.openEditor({ title: 'Furniture surface pattern', initialPattern: await api.editablePattern(record),
        library: { readOnly: true, list: () => [...entries, ...(window.PatternLibrary?.listAvailable?.() || [])],
          get: id => window.RepoPatternLibrary.getCachedEditableById(id) || window.PatternLibrary?.getById?.(id) },
        renderPreview: pattern => api.renderTile(record, pattern),
        onSave: async (pattern, id) => commit({ ...record, patternId: id || null, pattern: await api.editablePattern({pattern}) }) });
    } catch (error) { log(`Furniture patterns: ${error.message}`, 'error'); }
  }
  function addCarpet() {
    const part = pushPart('box', { name: 'Patterned carpet', color: '#b7a185', transform: { x:0,y:.02,z:0,rx:0,ry:0,rz:0,sx:2,sy:.03,sz:2 },
      patternSurfaces: [{ slot:'carpet', mode:'cloth', selector:'top', patternId:'omgurku_knot', scale:1, palette:['#b7a185','#315b67'] }] }); // Added to existing furniture rather than replacing it.
    state.selectedType='part'; state.selectedId=part.id; rebuildAll(); queueUndoHistory('add carpet');
  }
  function addBanner() {
    pushPart('box', { name:'Banner beam', color:'#8b6540', transform:{x:0,y:2.1,z:0,rx:0,ry:0,rz:0,sx:1.4,sy:.1,sz:.12} });
    pushPart('box', { name:'Banner post', color:'#8b6540', transform:{x:-.7,y:1.05,z:0,rx:0,ry:0,rz:0,sx:.1,sy:2.1,sz:.12} });
    const part = pushPart('banner', { name:'Wind banner', bannerWindStrength:.1, transform:{x:0,y:1.45,z:.08,rx:0,ry:0,rz:0,sx:1.2,sy:1.2,sz:.01},
      patternSurfaces:[{slot:'banner',mode:'cloth',patternId:'omgurku_knot',scale:1,palette:['#b7a185','#315b67']}] }); // Top edge attaches to the horizontal beam; shader warps only the hanging fabric.
    state.selectedType='part'; state.selectedId=part.id; rebuildAll(); queueUndoHistory('add banner');
  }
  input('fpAuthor').onclick=author;
  input('fpApply').onclick=()=>commit(settings());
  input('fpClear').onclick=()=>{ const {part}=target(), record=currentRecord(); if(part&&record) { part.patternSurfaces=part.patternSurfaces.filter(entry=>entry!==record); rebuildFurnitureMeshes(); queueUndoHistory('clear furniture pattern'); } };
  input('fpCarpet').onclick=addCarpet; input('fpBanner').onclick=addBanner;
  window.FurniturePatternAuthor = { refresh };
  rebuildFurnitureMeshes();
})();
