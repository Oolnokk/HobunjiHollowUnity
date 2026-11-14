// Optional Furniture Author UI for tile-length furniture, using the same solver as gameplay.
(function (global) {
  'use strict';
  let editor = null; // Injected editor APIs keep this feature separate from the large authoring script.
  const $ = id => document.getElementById(id);
  const number = (id, fallback) => Number.isFinite(Number($(id)?.value)) ? Number($(id).value) : fallback;
  const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const normalize = spec => global.FurnitureTileSpan.normalize(spec);

  function sync() {
    if (!editor || !$('tileSpanEnabled')) return;
    const state = editor.state;
    state.tileSpan = normalize({...state.tileSpan, tileSize:state.tileBase.tileSize});
    const spec = state.tileSpan;
    $('tileSpanEnabled').checked = spec.enabled;
    $('tileSpanAxis').value = spec.axis;
    for (const [id, value] of [['tileSpanStart', spec.startTiles], ['tileSpanMiddle', spec.middleTiles], ['tileSpanEnd', spec.endTiles], ['tileSpanTotal', spec.totalTiles]]) $(id).value = value;
    $('tileSpanStatus').textContent = spec.enabled ? 'Minimum '+spec.baseTiles+' tiles; '+(spec.totalTiles-spec.baseTiles)+' added center tile(s)' : 'Ordinary furniture: no tile stretching';
  }

  function preview() {
    if (!editor || !global.FurnitureTileSpan) return;
    const {state, root, meshes} = editor;
    root.userData.meshById = meshes; // Shared authored meshes, never copies.
    const spec = {...state.tileSpan, tileSize:state.tileBase.tileSize};
    const result = global.FurnitureTileSpan.apply(root, {
      tileSpan: spec, parts: state.parts, recognizedSurfaces: editor.recognizedSurfaceExport()
    }, spec.totalTiles);
    if ($('tileSpanStatus') && result) {
      const diagnostics = root.userData.tileSpanDiagnostics;
      $('tileSpanStatus').textContent = diagnostics
        ? diagnostics.startTiles+' fixed start + '+diagnostics.middleTiles+' middle + '+diagnostics.endTiles+' fixed end'+
          (diagnostics.errors.length ? ' · '+diagnostics.errors.join('; ') : ' · all attachment surfaces connected')
        : 'Ordinary furniture: no tile stretching';
    }
    return result;
  }

  function restOffset(part) {
    const spec = normalize({...editor?.state?.tileSpan,tileSize:editor?.state?.tileBase?.tileSize});
    const delta = spec.enabled ? (spec.totalTiles-spec.baseTiles)*spec.tileSize : 0; // Offset introduced by the active editor preview.
    const shift = part?.tileSpanRole==='start' ? -delta/2 : part?.tileSpanRole==='end' ? delta/2 : 0;
    return {x:spec.axis==='x'?shift:0,z:spec.axis==='z'?shift:0}; // Gizmo writes must convert visual positions to saved base positions.
  }

  function updateSpan() {
    const {state} = editor;
    state.tileSpan = normalize({
      ...state.tileSpan, enabled:$('tileSpanEnabled').checked, axis:$('tileSpanAxis').value,
      startTiles:number('tileSpanStart',2), middleTiles:number('tileSpanMiddle',2),
      endTiles:number('tileSpanEnd',2), totalTiles:number('tileSpanTotal',6),
      tileSize:state.tileBase.tileSize
    });
    if (state.tileSpan.enabled) {
      if (state.tileSpan.axis === 'x') state.tileBase.footprintW = state.tileSpan.totalTiles;
      else state.tileBase.footprintD = state.tileSpan.totalTiles;
    }
    $('footprintW').value = state.tileBase.footprintW;
    $('footprintD').value = state.tileBase.footprintD;
    sync();preview();editor.rebuildTileBase();editor.frameFurniture();editor.queueUndoHistory('change furniture tile span');
  }

  function options(id, values, selected) {
    $(id).innerHTML = values.map(value=>'<option value="'+escape(value.value)+'">'+escape(value.label)+'</option>').join('');
    $(id).value = selected || '';
    if ($(id).selectedIndex < 0) $(id).value = '';
  }

  function selected(part) {
    if (!editor || !part || !$('partTileSpanRole')) return;
    $('partTileSpanRole').value = part.tileSpanRole || 'none';
    $('partTileSpanRoots').classList.toggle('hidden', part.tileSpanRole !== 'stretch');
    const roots = part.tileSpanRoots || {};
    for (const side of ['Start','End']) {
      const key = side.toLowerCase(), source = roots[key] || {};
      const choices = [{value:'',label:'Choose rigid '+key+' piece'}].concat(editor.state.parts
        .filter(other=>other.id!==part.id && (other.tileSpanRole===key || other.id===source.partId))
        .map(other=>({value:other.id,label:other.name+(other.tileSpanRole!==key?' (invalid end role)':'')})));
      options('partTileSpan'+side+'Root', choices, source.partId);
      const surfaces = [{value:'',label:'Automatic outer face'}].concat([...editor.surfaceGroups.values()]
        .filter(surface=>surface.partId===source.partId)
        .map(surface=>({value:surface.id,label:editor.ensureSurfaceSetting(surface).label||surface.recognizedType})));
      options('partTileSpan'+side+'Surface', surfaces, source.surfaceId);
    }
  }

  function updatePart() {
    const part = editor.selectedPart();
    if (!part) return;
    part.tileSpanRole = $('partTileSpanRole').value;
    const roots = part.tileSpanRoots || {};
    for (const side of ['Start','End']) {
      const key = side.toLowerCase(), partId = $('partTileSpan'+side+'Root').value || null;
      const surfaceId = roots[key]?.partId === partId ? ($('partTileSpan'+side+'Surface').value || null) : null;
      roots[key] = {partId, surfaceId, face:key==='start'?'max':'min'};
    }
    part.tileSpanRoots = roots;
    selected(part);preview();editor.updateLists();editor.queueUndoHistory('edit span role or surface roots');
  }

  function stairBridge() {
    const {state, pushPart} = editor;
    editor.beginPreset(6,1);
    const tile = Math.max(.01, state.tileBase.tileSize); // Tile-scale source for every bridge piece.
    const wood = {materialRole:'wood',materialTexture:'carved_smooth.png',color:'#96714b'};
    const step = (role, index) => {
      const height = (index+1)*tile*.22; // Rises toward the central flat deck.
      const x = (role==='start' ? -2.75+index*.5 : 2.75-index*.5)*tile;
      return pushPart('box',{...wood,name:(role==='start'?'Start':'End')+' staircase '+(index+1),
        tileSpanRole:role,transform:{x,y:height/2,z:0,rx:0,ry:0,rz:0,sx:tile*.5,sy:height,sz:tile*.94},
        topScaleX:1,topScaleZ:1,bottomScaleX:1,bottomScaleZ:1});
    };
    let startLanding, endLanding;
    for (let i=0;i<4;i++) startLanding = step('start',i);
    for (let i=0;i<4;i++) endLanding = step('end',i);
    const roots = {start:{partId:startLanding.id,face:'max'},end:{partId:endLanding.id,face:'min'}};
    const deck = pushPart('box',{...wood,name:'Flat bridge deck (stretchable)',
      tileSpanRole:'stretch',tileSpanRoots:JSON.parse(JSON.stringify(roots)),
      transform:{x:0,y:.81*tile,z:0,rx:0,ry:0,rz:0,sx:2*tile,sy:.14*tile,sz:.94*tile},
      topScaleX:1,topScaleZ:1,bottomScaleX:1,bottomScaleZ:1});
    for (const z of [-.42,.42]) {
      for (const side of ['start','end']) pushPart('legSquare',{...wood,
        name:(side==='start'?'Start':'End')+' railing post',
        tileSpanRole:side,transform:{x:(side==='start'?-1:1)*tile,y:1.1*tile,z:z*tile,
          rx:0,ry:0,rz:0,sx:.11*tile,sy:.51*tile,sz:.11*tile}});
      pushPart('beam',{...wood,name:'Stretchable railing '+(z<0?'left':'right'),
        tileSpanRole:'stretch',tileSpanRoots:JSON.parse(JSON.stringify(roots)),
        transform:{x:0,y:1.35*tile,z:z*tile,rx:0,ry:0,rz:0,sx:2*tile,sy:.12*tile,sz:.12*tile},
        topScaleX:1,topScaleZ:1,bottomScaleX:1,bottomScaleZ:1});
    }
    state.tileSpan = {version:1,enabled:true,axis:'x',startTiles:2,middleTiles:2,endTiles:2,totalTiles:8,tileSize:tile};
    editor.setPresetFootprint(8,1);
    sync();editor.rebuildAll();editor.selectObject('part',deck.id,{force:true});editor.frameFurniture();
    editor.queueUndoHistory('create stretchable stair bridge');
    editor.log('Bridge preset: fixed stairs and posts, flexible flat deck and rails. 6-tile base, 8-tile preview.','ok');
  }

  function init(context) {
    if (editor || !context?.state || !global.FurnitureTileSpan) return;
    editor = context;
    const presets = document.querySelector('#tab-presets .section');
    const button = document.createElement('button');
    button.textContent = 'Stair Bridge (Stretchable)';
    button.type = 'button';
    button.onclick = stairBridge;
    presets?.querySelector('.g2')?.appendChild(button);
    const section = document.createElement('div');
    section.className = 'section';
    section.innerHTML = '<h2>Stretch across tiles</h2>'+
      '<label class="row"><input type="checkbox" id="tileSpanEnabled"> Fixed ends + stretchable center</label>'+
      '<div class="g2"><div><label>Axis</label><select id="tileSpanAxis"><option value="x">X · width</option><option value="z">Z · depth</option></select></div>'+
      '<div><label>Total tiles (preview + export)</label><input id="tileSpanTotal" type="number" min="3" max="512"></div></div>'+
      '<div class="g3"><div><label>Start tiles</label><input id="tileSpanStart" type="number" min="1" max="256"></div>'+
      '<div><label>Base middle tiles</label><input id="tileSpanMiddle" type="number" min="1" max="256"></div>'+
      '<div><label>End tiles</label><input id="tileSpanEnd" type="number" min="1" max="256"></div></div>'+
      '<p id="tileSpanStatus" class="muted" role="status"></p>';
    presets?.after(section);
    const partUi = document.createElement('div');
    partUi.id = 'partTileSpanSection';
    partUi.innerHTML = '<hr><h2>Tile-span role / attachments</h2>'+
      '<label>Piece behavior</label><select id="partTileSpanRole"><option value="none">Unchanged</option><option value="start">Rigid beginning</option><option value="stretch">Stretch between surfaces</option><option value="end">Rigid ending</option></select>'+
      '<div id="partTileSpanRoots"><div class="g2"><div><label>Start attached piece</label><select id="partTileSpanStartRoot"></select></div><div><label>End attached piece</label><select id="partTileSpanEndRoot"></select></div></div>'+
      '<div class="g2"><div><label>Start surface</label><select id="partTileSpanStartSurface"></select></div><div><label>End surface</label><select id="partTileSpanEndSurface"></select></div></div>'+
      '<p class="muted">Named surfaces are optional; automatic uses the closest end face along the stretch axis. Attachment surfaces retain their cross-section. Stretch only geometry pieces, not imported GLBs.</p></div>';
    document.querySelector('#partEditor > .section')?.appendChild(partUi);
    for (const id of ['tileSpanEnabled','tileSpanAxis','tileSpanTotal','tileSpanStart','tileSpanMiddle','tileSpanEnd'])
      $(id)?.addEventListener('change',updateSpan);
    for (const id of ['partTileSpanRole','partTileSpanStartRoot','partTileSpanEndRoot','partTileSpanStartSurface','partTileSpanEndSurface'])
      $(id)?.addEventListener('change',updatePart);
    sync();
    if (editor.selectedPart()) selected(editor.selectedPart());
  }
  global.FurnitureTileSpanAuthor = {init,preview,sync,selected,stairBridge,restOffset};
})(window);
