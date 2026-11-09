// House Editor's wall-mounted fixture panel. Reuses the shared model and
// Interior Editor's FurniturePatternSurfaces/PatternAuthoring controls.
export function mountHouseWallFixtures(ctx) {
  const api=window.HouseWallFixtures;
  if(!api) throw new Error('house-wall-fixtures.js is not loaded');
  const {THREE,state,renderer,camera,faceMeshes,root,pushUndo,refreshExport,rebuildFaceMeshes,log,transform,detachFaceGizmo,setTransformTarget}=ctx;
  const host=document.createElement('section'); // Left-panel section for wall fixture authoring.
  host.className='section';host.id='houseWallFixtureSection';
  host.innerHTML=`
    <h2>4. Wall-mounted objects &amp; windows</h2>
    <p class="hint">Select an editable wall face, then attach at its center or use Pick wall to tap an exact position. Attachments follow that face through vertex edits; game export cuts real window apertures.</p>
    <div class="row"><select id="hwfKind" aria-label="New fixture type">
      <option value="simpleWindow">Simple window</option><option value="crossbarWindow">Crossbar window</option>
      <option value="wideWindow">Wide window</option><option value="sign">Wall sign</option>
      <option value="generalStoreSign">Authored General Store sign</option>
      <option value="innSign">Authored Inn sign</option>
      <option value="authoredWallFurniture">Authored sign / banner by key</option>
      <option value="torch">Wall torch</option></select>
      <label class="field">Authored furniture key<input id="hwfAuthoredKey" placeholder="e.g. a wall-banner key"></label>
      <button id="hwfAttach" type="button">Attach to selected wall</button>
      <button id="hwfPick" type="button">Pick wall position</button></div>
    <div class="hint" id="hwfStatus" role="status">No wall fixture selected.</div>
    <div id="hwfList" class="assetList"></div>
    <div id="hwfSettings" hidden>
      <div class="grid2">
        <label class="field">Wall horizontal (0–1)<input id="hwfU" type="number" min="0" max="1" step=".025"></label>
        <label class="field">Wall height (0–1)<input id="hwfV" type="number" min="0" max="1" step=".025"></label>
        <label class="field">Width<input id="hwfWidth" type="number" min=".05" max="12" step=".05"></label>
        <label class="field">Height<input id="hwfHeight" type="number" min=".05" max="12" step=".05"></label>
        <label class="field">Wall anchor clearance<input id="hwfDepth" type="number" min="-.5" max="1.5" step=".01"></label>
        <label class="field">Orientation<select id="hwfOrientation"><option value="flush">Flush</option><option value="perpendicular">Perpendicular</option></select></label>
        <label class="field">Rotate on wall (degrees)<input id="hwfRotationDeg" type="number" step="1" value="0"></label>
      </div>
      <div class="row" role="group" aria-label="Wall fixture position nudges">
        <label class="field">Nudge step (tiles)<input id="hwfNudgeStep" type="number" min=".005" max="2" step=".025" value=".1"></label>
        <button type="button" id="hwfNudgeLeft" title="Move along wall toward lower U">←</button>
        <button type="button" id="hwfNudgeRight" title="Move along wall toward higher U">→</button>
        <button type="button" id="hwfNudgeUp" title="Move up on wall">↑</button>
        <button type="button" id="hwfNudgeDown" title="Move down on wall">↓</button>
        <button type="button" id="hwfNudgeIn" title="Move closer to wall">Wall −</button>
        <button type="button" id="hwfNudgeOut" title="Move outward (extend authored beam)">Wall +</button>
      </div>
      <p class="hint">Arrows shift the mounting point in tile units along the selected wall, including gables. Wall −/+ moves authored furniture without detaching its beam, or adjusts clearance for ordinary fixtures.</p>
      <div id="hwfAuthoredSettings" hidden>
        <p class="hint">The authored beam's wall end stays fixed. Move the furniture outward to extend only the support; the sign or banner itself is not scaled.</p>
        <div class="row"><label class="field">Furniture outward distance (tiles)<input id="hwfBodyOutset" type="number" min="0" max="6" step=".025"></label>
          <button type="button" id="hwfOutsetMinus">−0.25</button>
          <button type="button" id="hwfOutsetPlus">+0.25</button>
          <button type="button" id="hwfExtendGizmo">Move furniture in 3D</button></div>
        <div class="grid3">
          <label class="field">Source X scale<input id="hwfSourceSX" type="number" step=".01" min=".001"></label>
          <label class="field">Source Y scale<input id="hwfSourceSY" type="number" step=".01" min=".001"></label>
          <label class="field">Source Z scale<input id="hwfSourceSZ" type="number" step=".01" min=".001"></label>
        </div>
      </div>
      <div class="row"><button type="button" id="hwfRotateMinus90">↶ 90°</button><button type="button" id="hwfRotateMinus15">↶ 15°</button><button type="button" id="hwfRotatePlus15">15° ↷</button><button type="button" id="hwfRotatePlus90">90° ↷</button><button type="button" id="hwfGizmo">Rotate in 3D</button></div>
      <p class="hint">Rotate around the wall normal. The window frame and the cutout rotate together, including on gables.</p>
      <div class="row"><button id="hwfApply" type="button">Apply placement</button><button id="hwfReattach" type="button">Reattach to selected wall</button><button id="hwfDelete" class="danger" type="button">Remove</button></div>
      <div id="hwfGlass">
        <h2>Window pane / Interior Editor patterning</h2>
        <label>Pattern <select id="hwfPattern"></select></label>
        <div class="row"><label><input id="hwfSolid" type="checkbox"> Solid glass (no motif)</label></div>
        <div class="grid3">
          <label class="field">Glass base<input id="hwfBase" type="color"></label>
          <label class="field">Pattern ink<input id="hwfInk" type="color"></label>
          <label class="field">Overpass ink<input id="hwfOverpassInk" type="color"></label>
        </div>
        <label class="field">Pattern tile size<input id="hwfScale" type="number" min=".05" max="20" step=".05"></label>
        <div id="hwfPatternPlacement"></div>
        <div class="row"><button id="hwfApplyPattern" type="button">Apply glass pattern</button><button id="hwfEditPattern" type="button">Choose / draw pattern</button></div>
      </div>
    </div>
    <button id="hwfDiagnostics" type="button">Window diagnostics</button><pre class="hint" id="hwfDebug" style="white-space:pre-wrap"></pre>`;
  const sections=document.querySelectorAll('#hpaLeftPanel > .section');
  (sections[2] || document.getElementById('hpaLeftPanel')).after(host);
  const $=id=>host.querySelector('#'+id);
  const findFixture=()=>fixtures().find(f=>f.id===selectedId);
  const fixtures=()=>Array.isArray(state.piece?.wallFixtures)?state.piece.wallFixtures:[];
  const validFaces=()=>new Map((state.piece?.base?.faces||[]).filter(api.validFace).map(f=>[String(f.id),f]));
  const finite=(n,fall=0)=>Number.isFinite(Number(n))?Number(n):fall;
  const reach=f=>Math.max(0,Math.min(6,finite(f?.supportExtension?.maxOutset,6)));
  let selectedId=null; // Current fixture's stable id, used by the inspector and preview highlight.
  let picking=false; // Capture-phase 3D picker intercepts the editor's normal face selection only while armed.
  let preview=null; // Rebuilt editor-only fixture root, never persisted as a GLB asset.
  let patternPlacement=null; // Shared Interior Editor controls for overpass/tile/rotation/offsets.
  let gizmoActive=false; // When true, the existing TransformControls rotates the selected fixture around its local outward axis.
  let gizmoReference=null; // Captured quaternion + degrees at pointer-down for delta rotation without cumulative drift.
  let gizmoMode=null; // 'rotate' or 'extend'; both use the existing TransformControls instance.
  let extensionProxy=null; // A handle parallel to the selected wall normal, independent from fixed mount.
  const diag=()=>({
    fixtureCount:fixtures().length,selectedId,picking,
    unattached:fixtures().filter(f=>!validFaces().has(String(f.faceId))).map(f=>({id:f.id,faceId:f.faceId})),
    patternSystem:!!window.FurniturePatternSurfaces?.renderTile,
    patternLibrary:!!window.RepoPatternLibrary,
    rendererErrors:preview?.children.filter(c=>c.userData.patternError).map(c=>c.userData.patternError)||[]
  });
  window.__houseWallFixturesDebug={snapshot:diag}; // Mobile-accessible, also printed in the panel.
  function status(message){$('hwfStatus').textContent=message;log(message);}
  function refreshPreview() {
    if(gizmoActive)transform.detach(); // The old preview is about to be disposed.
    if(preview){root.remove(preview);preview.userData.disposed=true;
      preview.traverse(n=>{n.geometry?.dispose?.();if(n.material){
        (Array.isArray(n.material)?n.material:[n.material]).forEach(m=>{m.map?.dispose?.();m.dispose?.();});
      }});}
    preview=api.createGroup(THREE,state.piece,null,{previewSelectionId:selectedId});
    root.add(preview);
    if(gizmoActive)attachGizmo(); // Keep the existing rotate control attached to the replacement preview mount.
    const orphan=fixtures().filter(f=>!validFaces().has(String(f.faceId)));
    if(orphan.length)$('hwfStatus').textContent=`${orphan.length} attachment(s) need reattaching after wall regeneration.`;
  }
  function refreshList(){
    const list=$('hwfList');list.replaceChildren();
    for(const f of fixtures()){
      const row=document.createElement('div');row.className='listItem'+(f.id===selectedId?' selected':'');
      const face=validFaces().get(String(f.faceId));
      const name=document.createElement('span');name.textContent=`${f.key} · wall ${f.faceId}${face?'':' (missing!)'}`;
      const button=document.createElement('button');button.type='button';button.textContent='Select';button.onclick=()=>select(f.id);
      row.append(name,button);list.append(row);
    }
    if(!fixtures().length)list.textContent='No wall fixtures yet.';
  }
  function select(id){
    selectedId=id;
    const f=findFixture();
    $('hwfSettings').hidden=!f;
    if(f){
      for(const [field,key] of [['hwfU','u'],['hwfV','v'],['hwfWidth','width'],['hwfHeight','height'],['hwfDepth','depth']]) $(field).value=finite(f[key],0);
      $('hwfOrientation').value=f.orientation||'flush';
      $('hwfRotationDeg').value=Number(f.rotationDeg||0).toFixed(1);
      $('hwfOrientation').disabled=api.isWindow(f)||!!f.authoredFurnitureKey;
      $('hwfWidth').disabled=$('hwfHeight').disabled=!!f.authoredFurnitureKey;
      $('hwfAuthoredSettings').hidden=!f.authoredFurnitureKey;
      if(f.authoredFurnitureKey){
        $('hwfBodyOutset').max=reach(f);
        $('hwfBodyOutset').value=finite(f.bodyOutset,0).toFixed(3);
        const sc=f.authoredScale||[1,1,1];
        ['hwfSourceSX','hwfSourceSY','hwfSourceSZ'].forEach((id,i)=>$(id).value=sc[i]);
      }
      $('hwfGlass').hidden=!api.isWindow(f);
      if(api.isWindow(f))refreshPatternFields();
    }
    if(!f&&gizmoActive)cancelGizmo();
    refreshList();refreshPreview();
  }
  function commit(label,change){
    pushUndo(label);
    change();
    rebuildFaceMeshes();select(selectedId); // Carves the editable wall preview as well as the game build.
  }
  async function add(face,u=.5,v=.5){
    if(!api.validFace(face)){status('Select a wall-tagged quad, not a roof/floor/door.');return;}
    const key=$('hwfKind').value;
    const defaults=api.PRESETS[key];
    const authored=['generalStoreSign','innSign','authoredWallFurniture'].includes(key);
    const sourceKey=key==='authoredWallFurniture' ? $('hwfAuthoredKey').value.trim() : key;
    let authoredOpts={};
    if(authored){
      if(!/^[a-zA-Z0-9_-]+$/.test(sourceKey)){status('Enter a valid authored furniture key.');return;}
      let data=null;
      try{
        const response=await fetch('../../config/furniture-authored/'+encodeURIComponent(sourceKey)+'.json');
        if(response.ok)data=await response.json();
      }catch(error){status('Could not load authored furniture: '+error.message);return;}
      if(!data?.wallOrnament?.anchor||!data.wallOrnament?.extendableSupport){
        status('This sign/banner needs wallOrnament.anchor and extendableSupport in its authored JSON.');return;
      }
      authoredOpts={authoredFurnitureKey:sourceKey,
        authoredAnchor:data.wallOrnament.anchor,
        authoredAttachmentNormal:data.wallOrnament.normal,
        supportExtension:data.wallOrnament.extendableSupport,
        authoredScale:key==='generalStoreSign'?[.393,.563,.557]:[.8,.8,.8],
        orientation:'flush',depth:0,bodyOutset:0};
    }
    const record=api.fitToFace(face,{id:'fixture_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),
      faceId:face.id,key,u,v,width:defaults.width,height:defaults.height,...authoredOpts});
    commit('Attach '+key+' to wall',()=>{
      if(!state.piece.wallFixtures)state.piece.wallFixtures=[];
      state.piece.wallFixtures.push(record);selectedId=record.id;
    });
    picking=false;$('hwfPick').classList.remove('active');
    status(`Attached ${key} to wall ${face.id}.`);
  }
  $('hwfAttach').onclick=()=>{
    const face=state.piece.base.faces.find(f=>state.selectedFaceIds.has(f.id) && api.validFace(f));
    if(!face){status('First select a wall face in the 3D view.');return;}
    add(face);
  };
  $('hwfPick').onclick=()=>{
    picking=!picking;$('hwfPick').classList.toggle('active',picking);
    status(picking?'Tap a wall surface in the 3D viewport to attach.':'Wall picker canceled.');
  };
  const faceAtPointer=event=>{
    const rect=renderer.domElement.getBoundingClientRect();
    const ndc=new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    const ray=new THREE.Raycaster();ray.setFromCamera(ndc,camera);
    const hits=ray.intersectObjects([...faceMeshes.values()],false);
    const picked=hits.find(hit=>api.validFace(state.piece.base.faces.find(f=>f.id===hit.object.userData.faceId)));
    if(!picked)return null;
    const face=state.piece.base.faces.find(f=>f.id===picked.object.userData.faceId);
    const origin=new THREE.Vector3(...face.v[0]),delta=picked.point.clone().sub(origin);
    const horizontal=new THREE.Vector3(...face.v[3]).sub(origin);
    const vertical=new THREE.Vector3(...face.v[1]).sub(origin);
    const uu=horizontal.dot(horizontal),vv=vertical.dot(vertical),uv=horizontal.dot(vertical);
    const du=delta.dot(horizontal),dv=delta.dot(vertical),denom=uu*vv-uv*uv;
    const u=Math.abs(denom)<1e-9?.5:(du*vv-dv*uv)/denom;
    const v=Math.abs(denom)<1e-9?.5:(dv*uu-du*uv)/denom;
    return {face,u:Math.max(0,Math.min(1,u)),v:Math.max(0,Math.min(1,v))};
  };
  renderer.domElement.addEventListener('pointerdown',event=>{
    if(transform.dragging||transform.axis)return;
    if(picking){
      const picked=faceAtPointer(event);
      if(!picked){status('No valid wall under the pointer. Pick a wall, not the roof.');return;}
      event.stopImmediatePropagation();event.preventDefault();add(picked.face,picked.u,picked.v);
      return;
    }
    if(!preview?.children.length)return;
    // A tap on an existing mounted frame selects the fixture BEFORE the
    // normal face picker selects the wall behind it. Also works on mobile.
    const bounds=renderer.domElement.getBoundingClientRect();
    const ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(
      (event.clientX-bounds.left)/bounds.width*2-1,
      -(event.clientY-bounds.top)/bounds.height*2+1),camera);
    const hit=ray.intersectObjects(preview.children,true).find(entry=>{
      let object=entry.object;
      while(object && object!==preview){if(object.userData.wallFixtureId)return true;object=object.parent;}
      return false;
    });
    if(!hit)return;
    // Do not pick an object occluded by a closer wall surface.
    const wallHit=ray.intersectObjects([...faceMeshes.values()],false)[0];
    if(wallHit && wallHit.distance+0.07<hit.distance)return;
    let object=hit.object;
    while(object&&!object.userData.wallFixtureId)object=object.parent;
    if(!object?.userData.wallFixtureId)return;
    event.stopImmediatePropagation();event.preventDefault();
    select(object.userData.wallFixtureId);
  },true);
  $('hwfApply').onclick=()=>{
    if(!findFixture())return;
    commit('Adjust wall fixture',()=>{
      const old=findFixture();
      const value=api.fitToFace(validFaces().get(String(old.faceId))||state.piece.base.faces[0],{...old,u:$('hwfU').value,v:$('hwfV').value,
        width:$('hwfWidth').value,height:$('hwfHeight').value,depth:$('hwfDepth').value,
        orientation:$('hwfOrientation').value,rotationDeg:$('hwfRotationDeg').value,
        ...(old.authoredFurnitureKey?{
          authoredScale:['hwfSourceSX','hwfSourceSY','hwfSourceSZ'].map(id=>Math.max(.001,finite($(id).value,1))),
          bodyOutset:$('hwfBodyOutset').value
        }:{})});
      Object.assign(old,value);
    });status('Fixture placement updated.');
  };
  function moveBody(amount){
    if(!findFixture()?.authoredFurnitureKey)return;
    commit('Move authored furniture outward',()=>{
      const f=findFixture();f.bodyOutset=Math.max(0,Math.min(reach(f),finite(f.bodyOutset,0)+amount));
    });
    status('Furniture moved; wall end of support beam stayed attached.');
  }
  $('hwfOutsetMinus').onclick=()=>moveBody(-.25);
  $('hwfOutsetPlus').onclick=()=>moveBody(.25);
  function nudge(direction) {
    const f=findFixture(),face=validFaces().get(String(f?.faceId));
    if(!f||!face){status('Select a valid wall fixture before nudging.');return;}
    const step=Math.max(.005,Math.min(2,finite($('hwfNudgeStep').value,.1)));
    const [x,y,z]=direction;
    commit('Nudge wall fixture',()=>{
      Object.assign(f,api.nudgeFixture(face,f,x*step,y*step,z*step));
    });
    refreshExport(); // Numeric and button edits are exportable immediately.
    status('Wall fixture nudged '+step+' tiles.');
  }
  for(const [id,direction] of [
    ['hwfNudgeLeft',[-1,0,0]],['hwfNudgeRight',[1,0,0]],
    ['hwfNudgeUp',[0,1,0]],['hwfNudgeDown',[0,-1,0]],
    ['hwfNudgeIn',[0,0,-1]],['hwfNudgeOut',[0,0,1]]
  ])$(id).onclick=()=>nudge(direction);
  function rotateStep(amount){
    if(!findFixture())return;
    commit('Rotate wall fixture',()=>{
      const f=findFixture();Object.assign(f,api.fitToFace(validFaces().get(String(f.faceId)),{
        ...f,rotationDeg:(Number(f.rotationDeg)||0)+amount}));
    });
    status('Window and its wall opening rotated together.');
  }
  for(const [id,amount] of [['hwfRotateMinus90',-90],['hwfRotateMinus15',-15],
    ['hwfRotatePlus15',15],['hwfRotatePlus90',90]]) $(id).onclick=()=>rotateStep(amount);
  function attachGizmo(){
    const mount=preview?.children.find(child=>child.userData.wallFixtureId===selectedId);
    if(!mount){cancelGizmo();return;}
    transform.setSpace('local');
    transform.showX=false;transform.showY=false;transform.showZ=true;
    if(gizmoMode==='extend'){
      const fixture=findFixture();
      if(!fixture?.authoredFurnitureKey){cancelGizmo();return;}
      // Gizmo's blue local Z axis is the actual wall normal. The proxy is
      // separate from the model and fixed anchor, so dragging cannot detach
      // the wall end of the support beam or distort the signboard.
      extensionProxy=new THREE.Group();extensionProxy.name='BodyOutsetDragHandle';
      extensionProxy.position.z=finite(fixture.bodyOutset,0);
      mount.add(extensionProxy);
      transform.setMode('translate');
      transform.attach(extensionProxy);
    }else{
      extensionProxy=null;
      transform.setMode('rotate');
      transform.attach(mount);
    }
    setTransformTarget('wallFixture');
  }
  function cancelGizmo(){
    if(!gizmoActive)return;
    gizmoActive=false;gizmoMode=null;gizmoReference=null;
    transform.detach();setTransformTarget(null);
    if(extensionProxy?.parent)extensionProxy.parent.remove(extensionProxy);
    extensionProxy=null;
    transform.showX=true;transform.showY=true;transform.showZ=true;
    transform.setSpace('world');transform.setMode('translate');
    for(const id of ['hwfGizmo','hwfExtendGizmo'])$(id).classList.remove('active');
    $('hwfGizmo').textContent='Rotate in 3D';
    $('hwfExtendGizmo').textContent='Move furniture in 3D';
  }
  function switchGizmo(mode){
    if(gizmoActive){
      const same=gizmoMode===mode;
      cancelGizmo();
      if(same)return;
    }
    if(!findFixture()){status('Select a fixture first.');return;}
    if(mode==='extend'&&!findFixture().authoredFurnitureKey){
      status('Only authored signs and banners with extendable support beams can move outward.');return;
    }
    gizmoActive=true;gizmoMode=mode;
    state.selectedFaceIds.clear();detachFaceGizmo();
    attachGizmo();
    const button=mode==='extend'?'hwfExtendGizmo':'hwfGizmo';
    $(button).classList.add('active');$(button).textContent='Finish '+(mode==='extend'?'moving':'rotating');
    status(mode==='extend'
      ?'Drag the blue arrow outward. The support beam extends toward the wall automatically.'
      :'Drag the blue rotation ring to rotate this fixture on its wall.');
  }
  $('hwfGizmo').onclick=()=>switchGizmo('rotate');
  $('hwfExtendGizmo').onclick=()=>switchGizmo('extend');
  transform.addEventListener('mouseDown',()=>{
    if(!gizmoActive||!transform.object)return;
    gizmoReference=gizmoMode==='extend'
      ?{bodyOutset:finite(findFixture()?.bodyOutset,0)}
      :{quaternion:transform.object.quaternion.clone(),rotationDeg:finite(findFixture()?.rotationDeg,0)};
  });
  transform.addEventListener('mouseUp',()=>{
    if(!gizmoActive||!gizmoReference)return;
    const wasRotation=gizmoMode==='rotate';
    gizmoReference=null;
    if(wasRotation)rebuildFaceMeshes(); // Windows re-cut only after rotation completes.
    refreshExport();
    if(!wasRotation)refreshPreview(); // Reattach proxy at the committed body offset.
  });
  function onTransformObjectChanged(){
    if(!gizmoActive||!gizmoReference||!transform.object||!findFixture())return;
    if(gizmoMode==='extend'){
      const f=findFixture(),next=Math.max(0,Math.min(reach(f),finite(extensionProxy?.position.z,0)));
      if(extensionProxy)extensionProxy.position.z=next;
      f.bodyOutset=next;
      const mount=preview?.children.find(child=>child.userData.wallFixtureId===selectedId);
      mount?.userData.setBodyOutset?.(next); // Update body + beam together during the drag.
      $('hwfBodyOutset').value=next.toFixed(3);
      return;
    }
    const delta=gizmoReference.quaternion.clone().invert().multiply(transform.object.quaternion);
    const degrees=THREE.MathUtils.radToDeg(2*Math.atan2(delta.z,delta.w));
    findFixture().rotationDeg=(gizmoReference.rotationDeg+degrees+3600)%360;
    $('hwfRotationDeg').value=findFixture().rotationDeg.toFixed(1);
  }
  $('hwfReattach').onclick=()=>{
    const chosen=state.piece.base.faces.find(face=>state.selectedFaceIds.has(face.id)&&api.validFace(face));
    if(!chosen||!findFixture()){status('Select the fixture and an existing wall face first.');return;}
    commit('Reattach wall fixture',()=>{Object.assign(findFixture(),api.fitToFace(chosen,{...findFixture(),faceId:chosen.id}));});status('Attachment bound to selected wall.');
  };
  $('hwfDelete').onclick=()=>{
    if(!findFixture())return;
    commit('Remove wall fixture',()=>{
      state.piece.wallFixtures=fixtures().filter(f=>f.id!==selectedId);selectedId=null;
    });status('Fixture removed.');
  };
  const patternApi=window.FurniturePatternSurfaces;
  if(patternApi?.placementControls) patternPlacement=patternApi.placementControls(
    $('hwfPatternPlacement'),$('hwfBase'),$('hwfInk'),$('hwfOverpassInk'));
  function patternRecord(){
    return patternApi?.normalize?.(findFixture()?.pattern||api.defaultPattern())||api.defaultPattern();
  }
  function refreshPatternFields(){
    const record=patternRecord();
    $('hwfBase').value=record.palette[0];$('hwfInk').value=record.palette[1];
    $('hwfOverpassInk').value=record.palette[2]||record.palette[1];
    $('hwfScale').value=record.scale;$('hwfSolid').checked=!!record.solid;
    const catalog=[...(window.PatternLibrary?.getCatalog?.()||[]),...(window.RepoPatternLibrary?.listCached?.()||[])];
    const select=$('hwfPattern');select.replaceChildren();const seen=new Set();
    for(const entry of [{id:record.patternId,label:record.patternId},...catalog])
      if(entry.id&&!seen.has(entry.id)){seen.add(entry.id);select.add(new Option(entry.label||entry.name||entry.id,entry.id));}
    select.value=record.patternId||'';
    patternPlacement?.refresh(record);
  }
  function readPattern(){
    let record=patternPlacement?.read(patternRecord())||patternRecord();
    const id=$('hwfPattern').value;
    if(id!==record.patternId){
      record.pattern=null;
      record.patterns=[patternApi?.resolvePattern?.({patternId:id})||null,...(record.patterns||[]).slice(1)];
    }
    return patternApi?.normalize?.({...record,patternId:id,solid:$('hwfSolid').checked,
      scale:$('hwfScale').value,palette:[$('hwfBase').value,$('hwfInk').value,$('hwfOverpassInk').value]})||record;
  }
  $('hwfPattern').onchange=()=>{$('hwfSolid').checked=false;};
  $('hwfApplyPattern').onclick=()=>{
    if(!findFixture()||!api.isWindow(findFixture()))return;
    const record=readPattern();
    commit('Pattern house window',()=>{findFixture().pattern=record;});
    status('Window pattern saved to the house piece JSON.');
  };
  $('hwfEditPattern').onclick=async()=>{
    if(!findFixture()||!window.PatternAuthoring?.openEditor){status('Pattern editor is not loaded.');return;}
    const record={...readPattern(),solid:false};
    const initial=await patternApi?.editablePattern?.(record);
    window.PatternAuthoring.openEditor({
      title:'House window glass pattern',initialPattern:initial,
      library:{list:()=>window.PatternLibrary?.listAvailable?.()||[],
        get:id=>window.PatternLibrary?.getById?.(id),
        save:(label,data)=>window.PatternLibrary?.saveToLibrary?.(label,data),
        remove:id=>window.PatternLibrary?.removeSaved?.(id)},
      renderPreview:p=>patternApi.renderTile(record,p),
      onSave:async(pattern,id)=>{
        const snapshot=await patternApi.editablePattern({pattern});
        commit('Draw house window pattern',()=>{if(findFixture())findFixture().pattern={
          ...record,patternId:id||null,pattern:snapshot,patterns:[snapshot,...(record.patterns||[]).slice(1)]};});
      }
    });
  };
  $('hwfDiagnostics').onclick=()=>{$('hwfDebug').textContent=JSON.stringify(diag(),null,2);};
  window.RepoPatternLibrary?.load?.().then(()=>{if(findFixture()&&api.isWindow(findFixture()))refreshPatternFields();})
    .catch(error=>{$('hwfDebug').textContent=String(error?.message||error);});
  refreshPreview();refreshList();
  return {cancelGizmo,onTransformObjectChanged,refresh:()=>{if(selectedId&&!findFixture())selectedId=null;
    $('hwfSettings').hidden=!findFixture();refreshList();refreshPreview();}};
}
