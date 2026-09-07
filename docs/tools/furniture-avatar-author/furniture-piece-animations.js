// Furniture + Avatar Author rigid piece animation extension.
// Independent part motion lives here; processing warps remain deformation-only.
(() => {
'use strict';
const aq=id=>document.getElementById(id);
const aclone=value=>value==null?value:JSON.parse(JSON.stringify(value));
let selectedAnimationId=null, selectedConnectorIndex=0, previewEnabled=true, previewRoot=null;
const hiddenOriginals=new Set();

function runtime(){return window.FurniturePieceAnimationRuntime;}
function ensureAnimations(){if(!Array.isArray(state.pieceAnimations))state.pieceAnimations=[];return state.pieceAnimations;}
function normalizeAnimation(record={}){
  if(runtime()?.normalizeAnimation)return runtime().normalizeAnimation(record);
  return {
    id:record.id||uid('pieceanim'),name:record.name||'Piece Animation',type:record.type||'windSwing',enabled:record.enabled!==false,
    drivenPartId:record.drivenPartId||null,anchorPartId:record.anchorPartId||null,
    pivot:{x:Number(record.pivot?.x)||0,y:Number(record.pivot?.y)||0,z:Number(record.pivot?.z)||0},
    axis:{x:Number(record.axis?.x)||0,y:Number(record.axis?.y)||0,z:Number(record.axis?.z??1)||0},
    amplitudeDeg:Number(record.amplitudeDeg??4.6),maxDeg:Number(record.maxDeg??18),distance:Number(record.distance??.08),speed:Number(record.speed??1.6),
    phaseDeg:Number(record.phaseDeg)||0,windResponse:Number(record.windResponse??1),
    axisBias:{x:Number(record.axisBias?.x??1),z:Number(record.axisBias?.z??1)},windDirectionDeg:Number(record.windDirectionDeg)||0,
    connectors:Array.isArray(record.connectors)?aclone(record.connectors):[]
  };
}
function selectedAnimation(){return ensureAnimations().find(a=>a.id===selectedAnimationId)||null;}
function selectedPartId(){if(state.selectedType==='part')return state.selectedId;if(state.selectedType==='partGroup')return state.selectedPartIds?.[0]||null;return null;}
function partLabel(id){return state.parts.find(p=>p.id===id)?.name||id||'None';}

function clearPreview(){
  if(previewRoot){runtime()?.removeControllers?.(previewRoot);previewRoot.parent?.remove(previewRoot);previewRoot=null;}
  for(const mesh of hiddenOriginals)if(mesh)mesh.visible=true;
  hiddenOriginals.clear();
}
function buildPreview(){
  clearPreview();
  if(!previewEnabled||!ensureAnimations().length||!runtime()?.install)return;
  previewRoot=new THREE.Group();previewRoot.name='furniture_piece_animation_editor_preview';root.add(previewRoot);
  const previewMap=new Map();
  for(const part of state.parts){
    const source=meshes.get(part.id);if(!source)continue;
    const clone=source.clone(true);clone.name=`animation_preview_${part.id}`;clone.userData={...source.userData,animationPreview:true};
    previewRoot.add(clone);previewMap.set(part.id,clone);source.visible=false;hiddenOriginals.add(source);
  }
  runtime().install(previewRoot,{pieceAnimations:aclone(ensureAnimations())},{meshById:previewMap,assetBase:'../../assets/',includeDisabled:true});
}
function schedulePreview(){buildPreview();renderAnimationUi();}

function addAnimation(){
  const driven=selectedPartId()||state.parts[0]?.id||null,anchor=state.parts.find(p=>p.id!==driven)?.id||null;
  const record=normalizeAnimation({
    id:uid('pieceanim'),name:'Wind Swing',type:'windSwing',drivenPartId:driven,anchorPartId:anchor,
    pivot:{x:0,y:-.5,z:0},axis:{x:0,y:0,z:1},amplitudeDeg:4.6,maxDeg:18,speed:1.6,windResponse:1,
    axisBias:{x:1,z:.25},windDirectionDeg:0,connectors:[]
  });
  ensureAnimations().push(record);selectedAnimationId=record.id;selectedConnectorIndex=0;schedulePreview();queueUndoHistory?.('add piece animation');
}
function duplicateAnimation(){const record=selectedAnimation();if(!record)return;const copy=normalizeAnimation({...aclone(record),id:uid('pieceanim'),name:`${record.name} Copy`,phaseDeg:(record.phaseDeg||0)+35});ensureAnimations().push(copy);selectedAnimationId=copy.id;schedulePreview();queueUndoHistory?.('duplicate piece animation');}
function deleteAnimation(){const record=selectedAnimation();if(!record)return;state.pieceAnimations=ensureAnimations().filter(a=>a.id!==record.id);selectedAnimationId=state.pieceAnimations[0]?.id||null;schedulePreview();queueUndoHistory?.('delete piece animation');}
function useSelected(role){const record=selectedAnimation(),id=selectedPartId();if(!record||!id){log('Select one furniture piece first.','warn');return;}if(role==='driven')record.drivenPartId=id;else record.anchorPartId=id;schedulePreview();queueUndoHistory?.(`set animation ${role}`);}

function addConnector(){const record=selectedAnimation();if(!record)return;record.connectors=record.connectors||[];record.connectors.push({anchorOffset:{x:0,y:-.5,z:0},drivenOffset:{x:0,y:.5,z:0},texture:'textures/wavy_surface.png',color:'#6b4728',radius:.012,sides:5,visible:true});selectedConnectorIndex=record.connectors.length-1;schedulePreview();queueUndoHistory?.('add animation rope connector');}
function addTwoRopes(){const record=selectedAnimation();if(!record)return;record.connectors=[-.3,.3].map(x=>({anchorOffset:{x,y:-.5,z:0},drivenOffset:{x:x/.8,y:.5,z:0},texture:'textures/wavy_surface.png',color:'#6b4728',radius:.012,sides:5,visible:true}));selectedConnectorIndex=0;schedulePreview();queueUndoHistory?.('add two rope connectors');}
function deleteConnector(){const record=selectedAnimation();if(!record?.connectors?.length)return;record.connectors.splice(selectedConnectorIndex,1);selectedConnectorIndex=Math.max(0,Math.min(selectedConnectorIndex,record.connectors.length-1));schedulePreview();queueUndoHistory?.('delete animation rope connector');}

function applyWindPreset(direction){
  const r=selectedAnimation();if(!r)return;
  if(direction==='frontBack'){r.windDirectionDeg=0;r.axisBias={x:1,z:.18};}
  else{r.windDirectionDeg=90;r.axisBias={x:.18,z:1};}
  schedulePreview();queueUndoHistory?.('set wind swing direction preset');
}
function readAnimationFields(){
  const r=selectedAnimation();if(!r)return;
  r.name=aq('pieceAnimName').value.trim()||r.name;r.enabled=aq('pieceAnimEnabled').checked;r.type=aq('pieceAnimType').value;
  r.drivenPartId=aq('pieceAnimDriven').value||null;r.anchorPartId=aq('pieceAnimAnchor').value||null;
  r.pivot={x:Number(aq('pieceAnimPivotX').value)||0,y:Number(aq('pieceAnimPivotY').value)||0,z:Number(aq('pieceAnimPivotZ').value)||0};
  r.axis={x:Number(aq('pieceAnimAxisX').value)||0,y:Number(aq('pieceAnimAxisY').value)||0,z:Number(aq('pieceAnimAxisZ').value)||0};
  r.amplitudeDeg=Number(aq('pieceAnimAmplitude').value)||0;r.maxDeg=Math.max(0,Number(aq('pieceAnimMax').value)||0);r.speed=Number(aq('pieceAnimSpeed').value)||0;
  r.distance=Number(aq('pieceAnimDistance').value)||0;r.phaseDeg=Number(aq('pieceAnimPhase').value)||0;r.windResponse=Number(aq('pieceAnimWind').value)||0;
  r.axisBias={x:Math.max(0,Number(aq('pieceAnimBiasX').value)||0),z:Math.max(0,Number(aq('pieceAnimBiasZ').value)||0)};
  r.windDirectionDeg=Number(aq('pieceAnimWindDirection').value)||0;
  schedulePreview();queueUndoHistory?.('edit piece animation');
}
function readConnectorFields(){
  const r=selectedAnimation(),c=r?.connectors?.[selectedConnectorIndex];if(!c)return;
  c.anchorOffset={x:Number(aq('pieceAnimConnAX').value)||0,y:Number(aq('pieceAnimConnAY').value)||0,z:Number(aq('pieceAnimConnAZ').value)||0};
  c.drivenOffset={x:Number(aq('pieceAnimConnDX').value)||0,y:Number(aq('pieceAnimConnDY').value)||0,z:Number(aq('pieceAnimConnDZ').value)||0};
  c.radius=Math.max(.002,Number(aq('pieceAnimConnRadius').value)||.012);c.color=aq('pieceAnimConnColor').value||'#6b4728';c.texture=aq('pieceAnimConnTexture').value.trim()||'textures/wavy_surface.png';c.visible=aq('pieceAnimConnVisible').checked;
  schedulePreview();queueUndoHistory?.('edit animation rope connector');
}

function renderAnimationList(){
  const list=aq('pieceAnimationList');if(!list)return;
  list.innerHTML=ensureAnimations().map(a=>`<div class="item ${a.id===selectedAnimationId?'sel':''}" data-piece-animation="${escapeHtml(a.id)}"><div class="item-title">${escapeHtml(a.name)}</div><div class="item-meta">${escapeHtml(a.type)} · ${escapeHtml(partLabel(a.drivenPartId))}</div></div>`).join('')||'<div class="muted">No rigid piece animations.</div>';
  list.querySelectorAll('[data-piece-animation]').forEach(el=>el.onclick=()=>{selectedAnimationId=el.dataset.pieceAnimation;selectedConnectorIndex=0;renderAnimationUi();buildPreview();});
}
function fillPartSelect(select,value){select.innerHTML='<option value="">None</option>'+state.parts.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');select.value=value||'';}
function renderConnector(){
  const r=selectedAnimation(),list=aq('pieceAnimConnectorList'),editor=aq('pieceAnimConnectorEditor');if(!list||!editor)return;
  const connectors=r?.connectors||[];
  list.innerHTML=connectors.map((c,i)=>`<button data-piece-connector="${i}" class="${i===selectedConnectorIndex?'active':''}">Rope ${i+1}</button>`).join('')||'<span class="muted">No connectors.</span>';
  list.querySelectorAll('[data-piece-connector]').forEach(el=>el.onclick=()=>{selectedConnectorIndex=Number(el.dataset.pieceConnector)||0;renderAnimationUi();});
  const c=connectors[selectedConnectorIndex];editor.classList.toggle('hidden',!c);if(!c)return;
  for(const [id,v] of Object.entries({pieceAnimConnAX:c.anchorOffset?.x??0,pieceAnimConnAY:c.anchorOffset?.y??-.5,pieceAnimConnAZ:c.anchorOffset?.z??0,pieceAnimConnDX:c.drivenOffset?.x??0,pieceAnimConnDY:c.drivenOffset?.y??.5,pieceAnimConnDZ:c.drivenOffset?.z??0,pieceAnimConnRadius:c.radius??.012,pieceAnimConnTexture:c.texture||'textures/wavy_surface.png'}))aq(id).value=v;
  aq('pieceAnimConnColor').value=c.color||'#6b4728';aq('pieceAnimConnVisible').checked=c.visible!==false;
}
function renderAnimationEditor(){
  const editor=aq('pieceAnimationEditor'),r=selectedAnimation();if(!editor)return;editor.classList.toggle('hidden',!r);if(!r)return;
  aq('pieceAnimName').value=r.name;aq('pieceAnimEnabled').checked=r.enabled!==false;aq('pieceAnimType').value=r.type;
  fillPartSelect(aq('pieceAnimDriven'),r.drivenPartId);fillPartSelect(aq('pieceAnimAnchor'),r.anchorPartId);
  for(const [id,v] of Object.entries({
    pieceAnimPivotX:r.pivot?.x??0,pieceAnimPivotY:r.pivot?.y??0,pieceAnimPivotZ:r.pivot?.z??0,
    pieceAnimAxisX:r.axis?.x??0,pieceAnimAxisY:r.axis?.y??0,pieceAnimAxisZ:r.axis?.z??1,
    pieceAnimAmplitude:r.amplitudeDeg??4.6,pieceAnimMax:r.maxDeg??18,pieceAnimSpeed:r.speed??1.6,pieceAnimDistance:r.distance??.08,
    pieceAnimPhase:r.phaseDeg??0,pieceAnimWind:r.windResponse??1,pieceAnimBiasX:r.axisBias?.x??1,pieceAnimBiasZ:r.axisBias?.z??1,
    pieceAnimWindDirection:r.windDirectionDeg??0
  }))aq(id).value=v;
  renderConnector();
}
function renderAnimationUi(){renderAnimationList();renderAnimationEditor();const btn=aq('pieceAnimPreview');if(btn){btn.textContent=previewEnabled?'Preview: ON':'Preview: OFF';btn.classList.toggle('active',previewEnabled);}updateStats?.();}

function loadHangingSignPreset(){
  clearFurniture();state.tileBase.footprintW=1;state.tileBase.footprintD=1;
  const post=pushPart('beam',{id:'hanging_sign_post',name:'Horizontal Sign Post',color:'#60452c',materialRole:'wood',materialTexture:'carved_smooth.png',transform:{x:0,y:1.72,z:0,rx:0,ry:0,rz:0,sx:1.25,sy:.14,sz:.14},topScaleX:1,topScaleZ:1,bottomScaleX:1,bottomScaleZ:1,wonkiness:.01});
  const board=pushPart('box',{id:'hanging_sign_board',name:'Hanging Store / Tavern Board',color:'#765536',materialRole:'wood',materialTexture:'boards.png',materialRotationDeg:90,transform:{x:-.0863,y:.97,z:0,rx:0,ry:0,rz:0,sx:.7,sy:1.1922,sz:.08},topScaleX:1,topScaleZ:1,bottomScaleX:1,bottomScaleZ:1,wonkiness:.012});
  state.pieceAnimations=[normalizeAnimation({
    id:'hanging_sign_wind_swing',name:'Hanging Sign Wind Swing',type:'windSwing',enabled:true,anchorPartId:post.id,drivenPartId:board.id,
    pivot:{x:0,y:-.07,z:0},axis:{x:1,y:0,z:0},amplitudeDeg:6,maxDeg:18,speed:1.6,phaseDeg:0,windResponse:1.7,
    axisBias:{x:1,z:.18},windDirectionDeg:0,
    connectors:[
      {anchorOffset:{x:-.25,y:-.07,z:0},drivenOffset:{x:-.1637,y:.5961,z:0},texture:'textures/wavy_surface.png',color:'#6b4728',radius:.012,sides:5,visible:true},
      {anchorOffset:{x:.25,y:-.07,z:0},drivenOffset:{x:.3363,y:.5961,z:0},texture:'textures/wavy_surface.png',color:'#6b4728',radius:.012,sides:5,visible:true}
    ]
  })];
  selectedAnimationId='hanging_sign_wind_swing';rebuildAll();applyEntrySurfaceDefaults({materialRules:{mapping:'stretch'}},[post,board]);rebuildFurnitureMeshes();syncControlsFromState?.();frameFurniture();setEditorMode('animation');renderAnimationUi();queueUndoHistory?.('load hanging sign animation example');log('Loaded tall vertical-writing hanging sign; ropes are attached to the beam underside and board top.');
}

function installAnimationTab(){
  if(aq('tab-animation'))return;
  const tabs=document.querySelector('aside.panel .tabs');if(!tabs)return;
  const button=document.createElement('button');button.dataset.leftTab='animation';button.textContent='Animation';tabs.insertBefore(button,tabs.querySelector('[data-left-tab="repo"]'));button.onclick=()=>setEditorMode('animation');
  const panel=document.createElement('div');panel.id='tab-animation';panel.className='hidden';
  panel.innerHTML=`
    <div class="section"><h2>Rigid Piece Animation</h2><div class="muted">Moves whole furniture pieces independently. This is separate from deformation / Processing Warp.</div><div class="g2"><button id="pieceAnimAdd" class="ok">＋ Add Animation</button><button id="pieceAnimPreview" class="active">Preview: ON</button></div><button id="pieceAnimHangingExample" style="width:100%;margin-top:6px">Load Hanging Store / Tavern Sign Example</button></div>
    <div class="section"><h2>Animations</h2><div id="pieceAnimationList" class="list"></div></div>
    <div id="pieceAnimationEditor" class="section hidden"><h2>Selected Animation</h2>
      <label>Name</label><input id="pieceAnimName"><label class="row"><input id="pieceAnimEnabled" type="checkbox"> Enabled</label>
      <label>Motion type</label><select id="pieceAnimType"><option value="windSwing">Wind Swing</option><option value="hinge">Hinge / Oscillate</option><option value="spin">Spin</option><option value="bob">Bob</option></select>
      <div class="g2"><div><label>Driven piece</label><select id="pieceAnimDriven"></select><button id="pieceAnimUseDriven">Use Selected Piece</button></div><div><label>Anchor piece</label><select id="pieceAnimAnchor"></select><button id="pieceAnimUseAnchor">Use Selected Piece</button></div></div>
      <hr><label>Pivot in anchor-local coordinates</label><div class="g3"><input id="pieceAnimPivotX" type="number" step=".01"><input id="pieceAnimPivotY" type="number" step=".01"><input id="pieceAnimPivotZ" type="number" step=".01"></div><button id="pieceAnimBottomPivot">Pivot = Anchor Bottom Center</button>
      <label>Axis (hinge / spin / bob)</label><div class="g3"><input id="pieceAnimAxisX" type="number" step=".1"><input id="pieceAnimAxisY" type="number" step=".1"><input id="pieceAnimAxisZ" type="number" step=".1"></div>
      <div class="g2"><div><label>Amplitude °</label><input id="pieceAnimAmplitude" type="number" step=".1"></div><div><label>Max swing °</label><input id="pieceAnimMax" type="number" step=".1"></div><div><label>Speed</label><input id="pieceAnimSpeed" type="number" step=".1"></div><div><label>Bob distance</label><input id="pieceAnimDistance" type="number" step=".01"></div><div><label>Phase °</label><input id="pieceAnimPhase" type="number" step="1"></div><div><label>Wind response</label><input id="pieceAnimWind" type="number" step=".1"></div></div>
      <hr><h3 style="margin:6px 0">Wind Swing Direction</h3><div class="muted tight">0° points front/back (+Z); 90° points left/right (+X). X bias controls front/back tilt. Z bias controls side-to-side tilt.</div>
      <div class="g3"><div><label>Wind direction °</label><input id="pieceAnimWindDirection" type="number" step="1"></div><div><label>X axis bias</label><input id="pieceAnimBiasX" type="number" min="0" max="4" step=".05"></div><div><label>Z axis bias</label><input id="pieceAnimBiasZ" type="number" min="0" max="4" step=".05"></div></div>
      <div class="g2"><button id="pieceAnimFrontBack">Front ↔ Back Preset</button><button id="pieceAnimSideSide">Side ↔ Side Preset</button></div>
      <hr><h3 style="margin:6px 0">Hanging Connectors</h3><div class="g2"><button id="pieceAnimAddConnector">＋ Rope</button><button id="pieceAnimTwoRopes">Two-Rope Preset</button></div><div id="pieceAnimConnectorList" class="row"></div>
      <div id="pieceAnimConnectorEditor" class="hidden"><label>Anchor offset XYZ</label><div class="g3"><input id="pieceAnimConnAX" type="number" step=".01"><input id="pieceAnimConnAY" type="number" step=".01"><input id="pieceAnimConnAZ" type="number" step=".01"></div><label>Driven offset XYZ</label><div class="g3"><input id="pieceAnimConnDX" type="number" step=".01"><input id="pieceAnimConnDY" type="number" step=".01"><input id="pieceAnimConnDZ" type="number" step=".01"></div><div class="g2"><div><label>Radius</label><input id="pieceAnimConnRadius" type="number" step=".002"></div><div><label>Color</label><input id="pieceAnimConnColor" type="color"></div></div><label>Texture path</label><input id="pieceAnimConnTexture"><label class="row"><input id="pieceAnimConnVisible" type="checkbox"> Visible</label><button id="pieceAnimDeleteConnector" class="bad">Delete Rope</button></div>
      <hr><div class="g2"><button id="pieceAnimDuplicate">Duplicate Animation</button><button id="pieceAnimDelete" class="bad">Delete Animation</button></div>
    </div>`;
  tabs.parentElement.appendChild(panel);

  const previousSetEditorMode=setEditorMode;
  setEditorMode=function(mode){
    if(mode!=='animation'){panel.classList.add('hidden');return previousSetEditorMode(mode);}
    activeEditorMode='animation';document.querySelectorAll('[data-left-tab]').forEach(b=>b.classList.toggle('active',b.dataset.leftTab==='animation'));
    ['parts','presets','surfaces','placement','effects','repo','avatar','base','io'].forEach(tab=>aq('tab-'+tab)?.classList.add('hidden'));
    panel.classList.remove('hidden');transform.detach();renderAnimationUi();
  };
  aq('pieceAnimAdd').onclick=addAnimation;aq('pieceAnimPreview').onclick=()=>{previewEnabled=!previewEnabled;buildPreview();renderAnimationUi();};aq('pieceAnimHangingExample').onclick=loadHangingSignPreset;
  aq('pieceAnimUseDriven').onclick=()=>useSelected('driven');aq('pieceAnimUseAnchor').onclick=()=>useSelected('anchor');
  aq('pieceAnimBottomPivot').onclick=()=>{const r=selectedAnimation();if(!r)return;r.pivot={x:0,y:-.5,z:0};schedulePreview();};
  aq('pieceAnimFrontBack').onclick=()=>applyWindPreset('frontBack');aq('pieceAnimSideSide').onclick=()=>applyWindPreset('sideSide');
  aq('pieceAnimAddConnector').onclick=addConnector;aq('pieceAnimTwoRopes').onclick=addTwoRopes;aq('pieceAnimDeleteConnector').onclick=deleteConnector;aq('pieceAnimDuplicate').onclick=duplicateAnimation;aq('pieceAnimDelete').onclick=deleteAnimation;
  ['pieceAnimName','pieceAnimEnabled','pieceAnimType','pieceAnimDriven','pieceAnimAnchor','pieceAnimPivotX','pieceAnimPivotY','pieceAnimPivotZ','pieceAnimAxisX','pieceAnimAxisY','pieceAnimAxisZ','pieceAnimAmplitude','pieceAnimMax','pieceAnimSpeed','pieceAnimDistance','pieceAnimPhase','pieceAnimWind','pieceAnimWindDirection','pieceAnimBiasX','pieceAnimBiasZ'].forEach(id=>aq(id).addEventListener('change',readAnimationFields));
  ['pieceAnimConnAX','pieceAnimConnAY','pieceAnimConnAZ','pieceAnimConnDX','pieceAnimConnDY','pieceAnimConnDZ','pieceAnimConnRadius','pieceAnimConnColor','pieceAnimConnTexture','pieceAnimConnVisible'].forEach(id=>aq(id).addEventListener('change',readConnectorFields));
}

const originalRebuildFurnitureMeshes=rebuildFurnitureMeshes;
rebuildFurnitureMeshes=function rebuildFurnitureMeshesWithPieceAnimations(...args){clearPreview();const out=originalRebuildFurnitureMeshes(...args);buildPreview();return out;};
const originalExport=exportData;
exportData=function exportFurnitureWithPieceAnimations(...args){const data=originalExport(...args);data.pieceAnimations=aclone(ensureAnimations());data.pieceAnimationAuthoring={version:2,model:'rigid-piece-relative',separateFromProcessingWarps:true,windDirection:'furniture-local horizontal degrees',windAxisBias:true};return data;};
const originalLoad=loadData;
loadData=function loadFurnitureWithPieceAnimations(data,...args){clearPreview();state.pieceAnimations=Array.isArray(data?.pieceAnimations)?data.pieceAnimations.map(normalizeAnimation):[];selectedAnimationId=state.pieceAnimations[0]?.id||null;const out=originalLoad(data,...args);buildPreview();renderAnimationUi();return out;};
const originalClear=clearFurniture;
clearFurniture=function clearFurnitureWithPieceAnimations(...args){clearPreview();const out=originalClear(...args);state.pieceAnimations=[];selectedAnimationId=null;renderAnimationUi();return out;};
const originalStats=updateStats;
updateStats=function updateStatsWithPieceAnimations(...args){const out=originalStats(...args),pill=aq('statsPill'),count=ensureAnimations().length;if(pill){if(/ · \d+ animations?\b/.test(pill.textContent))pill.textContent=pill.textContent.replace(/ · \d+ animations?\b/,` · ${count} animations`);else pill.textContent+=` · ${count} animations`;}return out;};

const originalRepoImport=importRepoFurniture;
importRepoFurniture=async function importRepoFurnitureWithPieceAnimations(...args){
  const entry=repoFurnitureEntries.find(candidate=>candidate.id===selectedRepoFurnitureId),before=new Set(state.parts.map(p=>p.id));const out=await originalRepoImport(...args);
  if(entry?.type==='json'){
    try{
      const response=await fetch(REPO_RAW_ROOT+entry.path);
      if(response.ok){
        const data=await response.json();
        if(Array.isArray(data.pieceAnimations)&&Array.isArray(data.parts)){
          const added=state.parts.filter(p=>!before.has(p.id)),idMap=new Map(data.parts.map((p,i)=>[p.id,added[i]?.id]).filter(pair=>pair[1]));
          for(const raw of data.pieceAnimations){const record=normalizeAnimation(aclone(raw));record.id=uid('pieceanim');record.drivenPartId=idMap.get(raw.drivenPartId)||null;record.anchorPartId=idMap.get(raw.anchorPartId)||null;if(record.drivenPartId)ensureAnimations().push(record);}
          selectedAnimationId=ensureAnimations().at(-1)?.id||selectedAnimationId;buildPreview();renderAnimationUi();log(`Imported ${data.pieceAnimations.length} rigid piece animation record${data.pieceAnimations.length===1?'':'s'}.`);
        }
      }
    }catch(error){log(`Piece animation import metadata failed: ${error.message}`,'warn');}
  }
  return out;
};

const originalSaveDatabase=saveCurrentFurnitureToDatabase;
saveCurrentFurnitureToDatabase=function saveCurrentFurnitureWithPieceAnimations(...args){const out=originalSaveDatabase(...args);const key=String(selectedRepoFurnitureId||'').replace(/^database:/,'');if(key&&furnitureDatabase?.entries?.[key]){furnitureDatabase.entries[key].pieceAnimations=aclone(ensureAnimations());if(Array.isArray(state.decals))furnitureDatabase.entries[key].decals=aclone(state.decals);}return out;};
const originalImportDatabase=importFurnitureDatabaseEntry;
importFurnitureDatabaseEntry=function importDatabaseWithPieceAnimations(entryRef,...args){
  const source=furnitureDatabase?.entries?.[entryRef.key],out=originalImportDatabase(entryRef,...args);
  if(source&&Array.isArray(source.pieceAnimations)&&Array.isArray(source.parts)&&Array.isArray(out)){
    const idMap=new Map(source.parts.map((p,i)=>[p.id,out[i]?.id]).filter(pair=>pair[1]));
    for(const raw of source.pieceAnimations){const record=normalizeAnimation(aclone(raw));record.id=uid('pieceanim');record.drivenPartId=idMap.get(raw.drivenPartId)||null;record.anchorPartId=idMap.get(raw.anchorPartId)||null;if(record.drivenPartId)ensureAnimations().push(record);}
    selectedAnimationId=ensureAnimations().at(-1)?.id||selectedAnimationId;buildPreview();renderAnimationUi();
  }
  return out;
};

installAnimationTab();ensureAnimations();renderAnimationUi();log('Rigid furniture piece animation authoring ready.');
})();
