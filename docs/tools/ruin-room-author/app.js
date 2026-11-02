(() => {
  'use strict';
  const api = window.DevRandomRuinRoomAuthoring;
  const $ = id => document.getElementById(id);
  const state = { library:null, kind:'template', id:null, spotId:null, placingSpot:false, dirty:false };
  const esc = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const split = value => String(value || '').split(',').map(item=>item.trim()).filter(Boolean);
  const selectedList = () => state.kind === 'template' ? state.library.templates : state.library.proceduralProfiles;
  const selected = () => selectedList().find(item=>item.id===state.id) || null;
  const setStatus = (message,kind='') => { $('status').textContent=message; $('status').className=kind; };
  const newSpot = (index,kind) => ({
    id:'spot-'+index,label:'Placement '+index,x:kind==='template'?0:0.5,z:kind==='template'?0:0.5,
    required:false,maxUses:1,clearance:0,
    allowlists:{mechanisms:['*'],activators:['*'],decorations:['*']}
  });
  const defaultsTemplate = () => ({
    id:'room-template-'+(state.library.templates.length+1),name:'New authored room',enabled:true,weight:1,
    rotations:[0,90,180,270],match:{minDoors:0,maxDoors:8,roomIds:[]},
    footprint:{width:8,height:8,rows:Array(8).fill('########')},
    connections:[],spots:[{...newSpot(1,'template'),x:3,z:3,label:'Center'}],puzzleLinks:[]
  });
  const defaultsProfile = () => ({
    id:'procedural-profile-'+(state.library.proceduralProfiles.length+1),name:'New procedural profile',enabled:true,weight:1,
    match:{minWidth:8,maxWidth:48,minHeight:8,maxHeight:48,minDoors:0,maxDoors:8,sizeClasses:[],roomIds:[]},
    spots:[{...newSpot(1,'profile'),x:.5,z:.5,label:'Center'}],puzzleLinks:[]
  });
  const current = () => selected();
  const markDirty = () => { state.dirty=true; };
  const saveInputs = () => {
    const item=current(); if(!item)return;
    item.name=$('room-name').value.trim()||item.id;
    item.id=$('room-id').value.trim()||item.id;
    item.enabled=$('enabled').checked;
    if(state.kind==='template'){
      item.weight=Number($('weight').value)||0;
      item.rotations=[...$('rotations').selectedOptions].map(option=>Number(option.value));
      item.match.minDoors=Math.max(0,Number($('min-doors').value)||0);
      item.match.maxDoors=Math.max(item.match.minDoors,Number($('max-doors').value)||0);
      item.match.roomIds=split($('room-ids').value);
    }else{
      item.weight=Number($('weight').value)||0;
      item.match.minWidth=Math.max(1,Number($('min-width').value)||1);
      item.match.maxWidth=Math.max(item.match.minWidth,Number($('max-width').value)||1);
      item.match.minHeight=Math.max(1,Number($('min-height').value)||1);
      item.match.maxHeight=Math.max(item.match.minHeight,Number($('max-height').value)||1);
      item.match.minDoors=Math.max(0,Number($('profile-min-doors').value)||0);
      item.match.maxDoors=Math.max(item.match.minDoors,Number($('profile-max-doors').value)||0);
      item.match.sizeClasses=split($('size-classes').value);
      item.match.roomIds=split($('profile-room-ids').value);
    }
    markDirty();
  };
  function renderList(){
    const root=$('definition-list');root.replaceChildren();
    const all=[['template',state.library.templates],['profile',state.library.proceduralProfiles]];
    for(const [kind,items] of all){
      for(const item of items){
        const button=document.createElement('button');button.className='definition-item'+(kind===state.kind&&item.id===state.id?' active':'');
        button.innerHTML='<strong>'+esc(item.name)+'</strong><span>'+esc(kind==='template'?'Footprint template':'Procedural profile')+' · '+esc(item.id)+'</span>';
        button.addEventListener('click',()=>selectDefinition(kind,item.id));root.append(button);
      }
    }
    $('library-count').textContent=String(state.library.templates.length+state.library.proceduralProfiles.length);
    $('library-summary').textContent=state.library.templates.length+' templates · '+state.library.proceduralProfiles.length+' procedural profiles'+(state.dirty?' · unsaved edits':'');
  }
  function renderDefinition(){
    const item=current();if(!item)return;
    $('selected-kind').textContent=state.kind==='template'?'Template':'Procedural';
    $('canvas-title').textContent=state.kind==='template'?'Authored footprint':'Procedural spot layout';
    $('template-tools').classList.toggle('hidden',state.kind!=='template');
    $('profile-preview').classList.toggle('hidden',state.kind!=='profile');
    $('template-properties').classList.toggle('hidden',state.kind!=='template');
    $('profile-properties').classList.toggle('hidden',state.kind!=='profile');
    $('room-name').value=item.name;$('room-id').value=item.id;$('enabled').checked=item.enabled;
    $('weight').value=item.weight;
    if(state.kind==='template'){
      $('foot-width').value=item.footprint.width;$('foot-height').value=item.footprint.height;
      $('rotations').querySelectorAll('option').forEach(option=>option.selected=item.rotations.includes(Number(option.value)));
      $('min-doors').value=item.match.minDoors;$('max-doors').value=item.match.maxDoors;$('room-ids').value=item.match.roomIds.join(', ');
    }else{
      $('min-width').value=item.match.minWidth;$('max-width').value=item.match.maxWidth;
      $('min-height').value=item.match.minHeight;$('max-height').value=item.match.maxHeight;
      $('profile-min-doors').value=item.match.minDoors;$('profile-max-doors').value=item.match.maxDoors;
      $('size-classes').value=item.match.sizeClasses.join(', ');$('profile-room-ids').value=item.match.roomIds.join(', ');
      renderProfilePreview();
    }
    renderGrid();renderSpotList();renderSpotInspector();renderConnections();renderLinks();renderList();
  }
  function renderGrid(){
    const item=current();if(!item||state.kind!=='template')return;
    const root=$('grid');root.replaceChildren();
    root.style.gridTemplateColumns='repeat('+item.footprint.width+',auto)';
    const spotAt=new Map();
    item.spots.forEach(spot=>spotAt.set(Math.floor(spot.x)+','+Math.floor(spot.z),spot));
    for(let z=0;z<item.footprint.height;z++)for(let x=0;x<item.footprint.width;x++){
      const button=document.createElement('button'),floor=item.footprint.rows[z]?.[x]==='#',spot=spotAt.get(x+','+z);
      button.className='cell '+(floor?'floor':'void')+(spot?.id===state.spotId?' selected':'');
      button.title='Cell '+x+','+z+(floor?' · floor':' · void')+(spot?' · '+spot.label:'');
      if(spot){const dot=document.createElement('span');dot.className='spot-dot'+(spot.required?' required':'');button.append(dot);}
      button.addEventListener('click',()=>clickCell(x,z));
      root.append(button);
    }
    $('place-spot-mode').textContent='Place spot: '+(state.placingSpot?'on':'off');
    $('place-spot-mode').classList.toggle('primary',state.placingSpot);
  }
  function renderProfilePreview(){
    const item=current();if(!item||state.kind!=='profile')return;
    const root=$('profile-spot-grid');root.innerHTML='<strong>'+item.spots.length+' normalized placement spots</strong><div class="small muted">U = '+item.spots.map(s=>esc(s.x)).join(', ')+' · V = '+item.spots.map(s=>esc(s.z)).join(', ')+'</div>';
  }
  function renderSpotList(){
    const item=current(),root=$('spot-list');root.replaceChildren();
    (item?.spots||[]).forEach(spot=>{
      const card=document.createElement('div');card.className='list-card'+(spot.id===state.spotId?' selected':'');
      card.innerHTML='<div class="list-card-head"><button data-select="'+esc(spot.id)+'" style="text-align:left;flex:1">'+esc(spot.label)+' <span class="badge">'+esc(spot.id)+'</span></button><button class="danger" data-delete="'+esc(spot.id)+'">×</button></div><div class="small muted">'+esc(spot.allowlists.mechanisms.join(', '))+' / '+esc(spot.allowlists.activators.join(', '))+' / '+esc(spot.allowlists.decorations.join(', '))+'</div>';
      card.querySelector('[data-select]').addEventListener('click',()=>{state.spotId=spot.id;state.placingSpot=false;renderGrid();renderSpotList();renderSpotInspector();});
      card.querySelector('[data-delete]').addEventListener('click',()=>{item.spots=item.spots.filter(entry=>entry.id!==spot.id);item.puzzleLinks=item.puzzleLinks.filter(link=>link.activatorSpot!==spot.id&&link.mechanismSpot!==spot.id);if(state.spotId===spot.id)state.spotId=null;markDirty();renderDefinition();});
      root.append(card);
    });
  }
  function renderSpotInspector(){
    const root=$('spot-inspector'),item=current(),spot=item?.spots.find(entry=>entry.id===state.spotId);
    if(!spot){root.innerHTML='<div class="hint">Select a placement spot to configure its position, occupancy, clearances and independent allowlists.</div>';return;}
    const posLabel=state.kind==='template'?'Cell X / Z':'Normalized U / V';
    root.innerHTML=
      '<h3>'+esc(spot.label)+'</h3>'+
      '<div class="row2"><div class="field"><label for="spot-label">Label</label><input id="spot-label" value="'+esc(spot.label)+'"></div><div class="field"><label for="spot-id">Spot ID</label><input id="spot-id" value="'+esc(spot.id)+'"></div></div>'+
      '<div class="row2"><div class="field"><label for="spot-x">'+posLabel.split(' / ')[0]+'</label><input id="spot-x" type="number" step="'+(state.kind==='template'?1:'.01')+'" value="'+esc(spot.x)+'"></div><div class="field"><label for="spot-z">'+posLabel.split(' / ')[1]+'</label><input id="spot-z" type="number" step="'+(state.kind==='template'?1:'.01')+'" value="'+esc(spot.z)+'"></div></div>'+
      '<div class="row3"><div class="field"><label for="spot-max">Max uses</label><input id="spot-max" type="number" min="1" value="'+esc(spot.maxUses)+'"></div><div class="field"><label for="spot-clearance">Clearance</label><input id="spot-clearance" type="number" min="0" step=".1" value="'+esc(spot.clearance)+'"></div><div class="field"><label class="check" style="margin-top:22px"><input id="spot-required" type="checkbox" '+(spot.required?'checked':'')+'> Required</label></div></div>'+
      '<h3>Mechanism allowlist</h3><div class="field"><label for="allow-mechanisms">Comma-separated IDs; * allows any compatible type</label><textarea id="allow-mechanisms">'+esc(spot.allowlists.mechanisms.join(', '))+'</textarea></div>'+
      '<h3>Activator allowlist</h3><div class="field"><label for="allow-activators">Examples: pressurePlate, lever, projectileTarget</label><textarea id="allow-activators">'+esc(spot.allowlists.activators.join(', '))+'</textarea></div>'+
      '<h3>Decoration allowlist</h3><div class="field"><label for="allow-decorations">Examples: pillar, statue, treasure, rubble, vegetation</label><textarea id="allow-decorations">'+esc(spot.allowlists.decorations.join(', '))+'</textarea></div>'+
      '<div class="actions"><button id="apply-spot" class="primary">Apply spot changes</button><button id="move-spot">Place on footprint</button></div>';
    $('apply-spot').addEventListener('click',saveSpotInputs);
    $('move-spot').addEventListener('click',()=>{if(state.kind==='template'){state.placingSpot=true;renderGrid();setStatus('Tap a walkable floor cell to move '+spot.label+'.');}else setStatus('Edit normalized U/V values directly for procedural spots.');});
  }
  function saveSpotInputs(){
    const item=current(),spot=item?.spots.find(entry=>entry.id===state.spotId);if(!spot)return;
    spot.label=$('spot-label').value.trim()||spot.id;spot.id=$('spot-id').value.trim()||spot.id;
    spot.x=Number($('spot-x').value);spot.z=Number($('spot-z').value);
    spot.maxUses=Math.max(1,Number($('spot-max').value)||1);spot.clearance=Math.max(0,Number($('spot-clearance').value)||0);
    spot.required=$('spot-required').checked;
    spot.allowlists={mechanisms:split($('allow-mechanisms').value),activators:split($('allow-activators').value),decorations:split($('allow-decorations').value)};
    markDirty();renderDefinition();setStatus('Spot updated. Save locally to use it in this browser, or export JSON for the repository library.');
  }
  function clickCell(x,z){
    const item=current();if(!item||state.kind!=='template')return;
    const rows=item.footprint.rows;
    if(state.placingSpot){
      if(rows[z]?.[x]!== '#'){setStatus('Placement spots must sit on walkable floor cells.');return;}
      const spot=item.spots.find(entry=>entry.id===state.spotId);if(!spot){setStatus('Select a spot before placing it.');return;}
      spot.x=x;spot.z=z;state.placingSpot=false;markDirty();renderDefinition();setStatus('Moved '+spot.label+' to '+x+','+z+'.');return;
    }
    const chars=rows.map(row=>[...row]);chars[z][x]=chars[z][x]==='#'?'.':'#';item.footprint.rows=chars.map(row=>row.join(''));
    markDirty();renderGrid();setStatus('Footprint cell '+x+','+z+' changed. Check doorway connections and spot locations before saving.');
  }
  function resizeFootprint(){
    const item=current();if(!item||state.kind!=='template')return;
    const width=Math.max(3,Math.min(48,Math.floor(Number($('foot-width').value)||8)));
    const height=Math.max(3,Math.min(48,Math.floor(Number($('foot-height').value)||8)));
    const rows=Array.from({length:height},(_,z)=>Array.from({length:width},(_,x)=>item.footprint.rows[z]?.[x]||'#').join(''));
    item.footprint={width,height,rows};
    item.spots=item.spots.filter(spot=>spot.x>=0&&spot.z>=0&&spot.x<width&&spot.z<height);
    if(!item.spots.some(spot=>spot.id===state.spotId))state.spotId=null;
    markDirty();renderDefinition();setStatus('Footprint resized to '+width+' × '+height+'. Spots outside the new outline were removed.');
  }
  function renderConnections(){
    const item=current(),root=$('connections');root.replaceChildren();
    if(state.kind!=='template'){root.innerHTML='<div class="hint">Procedural profiles match existing V50 door counts. Door geometry remains owned by the generated network.</div>';return;}
    (item.connections||[]).forEach((connection,index)=>{
      const card=document.createElement('div');card.className='list-card';
      card.innerHTML='<div class="list-card-head"><strong>'+esc(connection.id)+'</strong><button class="danger">Remove</button></div><div class="row3"><div><label>Edge</label><select data-field="side"><option>north</option><option>east</option><option>south</option><option>west</option></select></div><div><label>Offset</label><input data-field="offset" type="number" step=".5" value="'+esc(connection.offset)+'"></div><div><label>Width</label><input data-field="width" type="number" min="1" value="'+esc(connection.width)+'"></div></div><div class="row2"><div><label>Kind</label><select data-field="kind"><option value="corridor">Corridor</option><option value="entrance">Entrance</option></select></div><label class="check" style="margin-top:21px"><input data-field="required" type="checkbox" '+(connection.required?'checked':'')+'> Required</label></div>';
      card.querySelector('[data-field="side"]').value=connection.side;card.querySelector('[data-field="kind"]').value=connection.kind;
      card.querySelectorAll('[data-field]').forEach(input=>input.addEventListener('change',()=>{connection[input.dataset.field]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;markDirty();}));
      card.querySelector('button').addEventListener('click',()=>{item.connections.splice(index,1);markDirty();renderConnections();});
      root.append(card);
    });
  }
  function renderLinks(){
    const item=current(),root=$('links');root.replaceChildren();
    (item.puzzleLinks||[]).forEach((link,index)=>{
      const card=document.createElement('div');card.className='list-card';
      card.innerHTML='<div class="list-card-head"><strong>'+esc(link.id)+'</strong><button class="danger">Remove</button></div><div class="row2"><div><label>Activator spot</label><select data-field="activatorSpot"></select></div><div><label>Mechanism spot</label><select data-field="mechanismSpot"></select></div></div><div class="row2"><div><label>Relation</label><input data-field="relation" value="'+esc(link.relation)+'"></div><label class="check" style="margin-top:21px"><input data-field="required" type="checkbox" '+(link.required?'checked':'')+'> Required</label></div>';
      for(const field of ['activatorSpot','mechanismSpot']){
        const select=card.querySelector('[data-field="'+field+'"]');
        select.innerHTML=item.spots.map(spot=>'<option value="'+esc(spot.id)+'">'+esc(spot.label)+' ('+esc(spot.id)+')</option>').join('');
        select.value=link[field];
      }
      card.querySelectorAll('[data-field]').forEach(input=>input.addEventListener('change',()=>{link[input.dataset.field]=input.type==='checkbox'?input.checked:input.value;markDirty();}));
      card.querySelector('button').addEventListener('click',()=>{item.puzzleLinks.splice(index,1);markDirty();renderLinks();});
      root.append(card);
    });
  }
  function selectDefinition(kind,id){
    saveInputs();if($('spot-label'))saveSpotInputs();
    state.kind=kind;state.id=id;state.spotId=null;state.placingSpot=false;renderDefinition();
  }
  function addDefinition(kind){
    saveInputs();const item=kind==='template'?defaultsTemplate():defaultsProfile();
    selectedListFor(kind).push(item);state.kind=kind;state.id=item.id;state.spotId=item.spots[0]?.id||null;state.placingSpot=false;markDirty();renderDefinition();
    setStatus('Created '+item.name+'. Configure its footprint, spots, connections and puzzle links.');
  }
  function selectedListFor(kind){return kind==='template'?state.library.templates:state.library.proceduralProfiles;}
  function addSpot(){
    saveInputs();const item=current();if(!item)return;
    const spot=newSpot(item.spots.length+1,state.kind);let suffix=item.spots.length+1;
    while(item.spots.some(entry=>entry.id===spot.id))spot.id='spot-'+(++suffix);
    item.spots.push(spot);state.spotId=spot.id;state.placingSpot=state.kind==='template';markDirty();renderDefinition();
    setStatus(state.kind==='template'?'New spot created. Tap a floor cell to position it.':'New normalized spot created. Enter its U/V coordinates.');
  }
  function addConnection(){
    saveInputs();const item=current();if(!item||state.kind!=='template')return;
    const side='north',limit=item.footprint.width;
    item.connections.push({id:'connection-'+(item.connections.length+1),side,offset:Math.floor(limit/2),width:1,kind:'corridor',required:true});
    markDirty();renderConnections();
  }
  function addLink(){
    saveInputs();const item=current();if(!item)return;
    const activator=item.spots.find(spot=>spot.allowlists.activators.length),mechanism=item.spots.find(spot=>spot.allowlists.mechanisms.length);
    if(!activator||!mechanism){setStatus('Create spots with activator and mechanism allowlists before linking them.','bad');return;}
    item.puzzleLinks.push({id:'link-'+(item.puzzleLinks.length+1),activatorSpot:activator.id,mechanismSpot:mechanism.id,relation:'activates',required:true});
    markDirty();renderLinks();
  }
  function validateAndSave(persist){
    saveInputs();if($('spot-label'))saveSpotInputs();
    const validation=api.validateLibrary(state.library);
    if(validation.length){setStatus('Validation found '+validation.length+' issue(s):\n• '+validation.join('\n• '),'bad');return false;}
    const result=api.setLibrary(state.library,{persist,source:'ruin-room-author'});
    if(!result.ok){setStatus(result.errors.join('\n'),'bad');return false;}
    state.library=result.library;state.dirty=false;renderDefinition();
    setStatus(persist?'Saved '+state.library.templates.length+' templates and '+state.library.proceduralProfiles.length+' procedural profiles to this browser. New game generation will use them.':'Library validated.','good');
    return true;
  }
  function exportLibrary(){
    saveInputs();if($('spot-label'))saveSpotInputs();
    const errors=api.validateLibrary(state.library);
    if(errors.length){setStatus('Fix validation errors before exporting:\n• '+errors.join('\n• '),'bad');return;}
    const blob=new Blob([JSON.stringify(state.library,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='room-library.json';link.click();URL.revokeObjectURL(url);
    setStatus('Exported room-library.json. Replace docs/config/ruin-room-authoring/room-library.json in the repository to share these definitions with all players.','good');
  }
  async function importLibrary(file){
    try{
      const parsed=JSON.parse(await file.text()),result=api.normalizeLibrary(parsed);
      if(result.errors.length){setStatus('Import rejected:\n• '+result.errors.join('\n• '),'bad');return;}
      state.library=result.library;state.kind='template';state.id=state.library.templates[0]?.id||state.library.proceduralProfiles[0]?.id;
      if(!state.library.templates.length)state.kind='profile';
      state.spotId=null;state.dirty=true;renderDefinition();setStatus('Imported and validated '+state.library.templates.length+' templates and '+state.library.proceduralProfiles.length+' profiles. Save locally to use them.','good');
    }catch(error){setStatus('Could not import JSON: '+String(error?.message||error),'bad');}
  }
  function bind(){
    $('new-template').addEventListener('click',()=>addDefinition('template'));
    $('new-profile').addEventListener('click',()=>addDefinition('profile'));
    $('save').addEventListener('click',()=>validateAndSave(true));
    $('export').addEventListener('click',exportLibrary);
    $('import').addEventListener('click',()=>$('import-file').click());
    $('import-file').addEventListener('change',event=>{const file=event.target.files?.[0];if(file)importLibrary(file);event.target.value='';});
    $('add-spot').addEventListener('click',addSpot);
    $('add-connection').addEventListener('click',addConnection);
    $('add-link').addEventListener('click',addLink);
    $('resize-footprint').addEventListener('click',resizeFootprint);
    $('all-floor').addEventListener('click',()=>{const item=current();if(item&&state.kind==='template'){item.footprint.rows=Array(item.footprint.height).fill('#'.repeat(item.footprint.width));markDirty();renderGrid();}});
    $('clear-floor').addEventListener('click',()=>{const item=current();if(item&&state.kind==='template'){item.footprint.rows=Array(item.footprint.height).fill('.'.repeat(item.footprint.width));markDirty();renderGrid();}});
    $('place-spot-mode').addEventListener('click',()=>{state.placingSpot=!state.placingSpot;renderGrid();});
    $('delete-definition').addEventListener('click',()=>{
      const item=current();if(!item||!confirm('Delete '+item.name+'?'))return;
      const list=selectedList();const index=list.indexOf(item);if(index>=0)list.splice(index,1);
      state.id=null;state.spotId=null;markDirty();
      const fallback=state.library.templates[0]||state.library.proceduralProfiles[0];
      if(fallback)selectDefinition(state.library.templates.includes(fallback)?'template':'profile',fallback.id);else{state.kind='template';renderList();setStatus('Room definition deleted. Create a new template or profile.');}
    });
    ['room-name','room-id','enabled','weight','rotations','min-doors','max-doors','room-ids','min-width','max-width','min-height','max-height','profile-min-doors','profile-max-doors','size-classes','profile-room-ids'].forEach(id=>{
      $(id).addEventListener('change',()=>{saveInputs();renderList();});
    });
  }
  async function init(){
    if(!api){setStatus('Room authoring runtime is missing. Reload the tools hub and try again.','bad');return;}
    try{
      await api.ready;
      state.library=api.getLibrary();
      if(state.library.templates.length){state.kind='template';state.id=state.library.templates[0].id;}
      else{state.kind='profile';state.id=state.library.proceduralProfiles[0]?.id||null;}
      bind();
      if(state.id)renderDefinition();else renderList();
      const report=api.getLoadReport();
      setStatus('Room library loaded from '+report.source+'. '+state.library.templates.length+' authored templates and '+state.library.proceduralProfiles.length+' procedural profiles available.'+(report.errors.length?'\n'+report.errors.join('\n'):'')+(report.warnings.length?'\n'+report.warnings.join('\n'):''),report.errors.length?'bad':'good');
    }catch(error){setStatus('Room library failed to load: '+String(error?.message||error),'bad');}
  }
  init();
})();