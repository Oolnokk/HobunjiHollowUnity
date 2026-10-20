// Furniture Author: carried world-object billboard and hand grip authoring.
// These guides exist only in the editor. Exported metadata is consumed by
// Shattercasks and future carryable furniture through their existing meshes.
(() => {
  'use strict';
  if (typeof state === 'undefined' || typeof helperRoot === 'undefined'
    || typeof THREE === 'undefined' || typeof setEditorMode !== 'function') return;

  function normalized(value) {
    const obj=value&&typeof value==='object'?value:{};
    const anchor=obj.billboardAnchor||{},pos=anchor.position||{},rot=anchor.rotation||{};
    const hand=obj.handTargets||{};
    const vector=(v,fallback)=>Object.fromEntries(['x','y','z']
      .map(key=>[key,Number.isFinite(Number(v?.[key]))?Number(v[key]):fallback[key]]));
    const grip=(v,p)=>({...vector(v,p),rotation:vector(v?.rotation,{x:0,y:0,z:0})});
    return {
      enabled:obj.enabled===true,
      billboardAnchor:{
        coordinateSpace:'posterior-relative',
        position:vector(pos,{x:0,y:.53,z:0}),
        rotation:vector(rot,{x:0,y:0,z:0}),
        posteriorOffset:vector(anchor.posteriorOffset,{x:0,y:0,z:0}),
        size:Math.max(.1,Number(anchor.size)||1)
      },
      handTargets:{
        left:grip(hand.left,{x:-.3,y:.46,z:.08}),
        right:grip(hand.right,{x:.3,y:.46,z:.08})
      }
    };
  }
  state.carryable=normalized(state.carryable);

  const tabs=document.querySelector('.tabs');
  const button=document.createElement('button');
  button.type='button';
  button.textContent='Carryable';
  button.dataset.leftTab='carry';
  tabs.appendChild(button);
  const pane=document.createElement('div');
  pane.id='tab-carry';
  pane.className='hidden';
  pane.innerHTML=[
    '<section class="fed-section">',
    '<h2>Carryable world objects</h2>',
    '<p class="muted">The orange square marks the furniture-local grip frame aligned with the avatar’s posterior plus the offset below. Purple marks the real posterior on the avatar; cyan marks the attachment point. Rotate the actual hand sockets with the gizmo or degree fields. Only the avatar and guides are editor-only.</p>',
    '<label class="row"><input type="checkbox" id="carryEnabled"> Enable carrying for this furniture</label>',
    '<div class="g2"><button type="button" id="carrySelectAnchor">▣ Billboard anchor</button><button type="button" id="carrySelectLeft">◉ Left hand grip</button></div>',
    '<button type="button" id="carrySelectRight">◉ Right hand grip</button>',
    '<label>Selected guide <strong id="carryGuideLabel">Billboard anchor</strong></label>',
    '<div class="g3">',
    '<label>X<input id="carryX" type="number" step="0.01"></label>',
    '<label>Y<input id="carryY" type="number" step="0.01"></label>',
    '<label>Z<input id="carryZ" type="number" step="0.01"></label>',
    '</div>',
    '<div id="carryAnchorRotation">',
    '<p class="muted" id="carryRotationLabel">Anchor plane orientation (degrees)</p>',
    '<div class="g3">',
    '<label>Pitch<input id="carryRX" type="number" step="1"></label>',
    '<label>Yaw<input id="carryRY" type="number" step="1"></label>',
    '<label>Roll<input id="carryRZ" type="number" step="1"></label>',
    '</div><label id="carrySizeRow">Billboard size <input id="carrySize" type="number" min="0.1" max="10" step="0.05"></label>',
    '</div>',
    '<p class="muted">Attachment offset FROM avatar posterior (character X/Y/Z). These move the held object relative to the body, independently of where the item was placed in the world.</p>',
    '<div class="g3">',
    '<label>From hip X<input id="carryPosteriorX" type="number" step="0.01"></label>',
    '<label>From hip Y<input id="carryPosteriorY" type="number" step="0.01"></label>',
    '<label>From hip Z<input id="carryPosteriorZ" type="number" step="0.01"></label>',
    '</div>',
    '<div class="section"><h2>Held avatar preview</h2>',
    '<label class="row"><input type="checkbox" id="carryShowAvatar" checked> Show Mao’ao avatar holding this object</label>',
    '<button type="button" id="carryFrameHoldingPose">Frame holding pose</button>',
    '<p class="muted tight">The purple posterior is calculated from the exact avatar model and shared character rig rule; the cyan attachment point is offset from it. Real hands use the combat handFromTool GLB calibration, with editable individual grip rotations.</p>',
    '<div class="pill" id="carryAvatarStatus">Avatar loads when Carryable mode opens.</div></div>',
    '<p class="muted">Use the viewport translate / rotate gizmos or edit numeric values. Avatar preview is editor-only; exported JSON retains the invisible billboard anchor and both hand targets.</p>',
    '<div id="carrySummary" class="pill"></div>',
    '</section>'
  ].join('');
  document.querySelector('#tab-effects').insertAdjacentElement('afterend',pane);
  const el=id=>document.getElementById(id);
  const guideRoot=new THREE.Group();
  guideRoot.name='CarryableAuthoringGuides';
  guideRoot.visible=false;
  helperRoot.add(guideRoot);
  const guides={};
  // Transient reference model, kept outside root and never included in the exported furniture.
  const heldPreview=new THREE.Group();
  heldPreview.name='carry_avatar_preview_only';
  heldPreview.visible=false;helperRoot.add(heldPreview);
  let previewEnabled=true,previewStarted=false,previewActor=null,previewHands=null,modelW=.9,modelH=.9;
  let previewPosterior=new THREE.Vector3(0,.42,0),posteriorMarker=null,attachmentMarker=null,attachmentLine=null;
  const handLocalEuler=new THREE.Euler(0,0,0,'XYZ'),handLocalQuat=new THREE.Quaternion();
  const handInverse=new THREE.Quaternion(),handAbsolute=new THREE.Quaternion(),avatarScaleScratch=new THREE.Vector3();
  const handTurn={
    left:new THREE.Quaternion().setFromEuler(new THREE.Euler(0,Math.PI/2,0)),
    right:new THREE.Quaternion().setFromEuler(new THREE.Euler(0,-Math.PI/2,0))};
  const tempRotation=new THREE.Quaternion(),tempOffset=new THREE.Vector3();
  const status=message=>{const node=document.getElementById('carryAvatarStatus');if(node)node.textContent=message;};
  const previewActive=()=>activeEditorMode==='carry'&&previewEnabled;
  function syncHoldingPreview(){
    heldPreview.visible=previewActive()&&!!previewActor;
    if(!heldPreview.visible)return;
    const a=state.carryable.billboardAnchor,p=a.position,r=a.rotation;
    const scale=Math.max(.1,Number(a.size)||1);
    // The preview holds the furniture at its authored transform and solves
    // for the avatar's posterior, exactly inverting the in-game mount solve.
    tempRotation.setFromEuler(new THREE.Euler(r.x*DEG,r.y*DEG,r.z*DEG,'XYZ'));
    previewActor.scale.setScalar(scale);
    previewActor.quaternion.copy(tempRotation);
    const offset=a.posteriorOffset||{};
    tempOffset.copy(previewPosterior).add(new THREE.Vector3(
      Number(offset.x)||0,Number(offset.y)||0,Number(offset.z)||0))
      .multiplyScalar(scale).applyQuaternion(tempRotation);
    previewActor.position.set(p.x,p.y,p.z).sub(tempOffset);
    if(posteriorMarker)posteriorMarker.position.copy(previewPosterior);
    if(attachmentMarker){
      attachmentMarker.position.copy(previewPosterior).add(new THREE.Vector3(
        Number(offset.x)||0,Number(offset.y)||0,Number(offset.z)||0));
      attachmentLine?.geometry?.setFromPoints?.([previewPosterior,attachmentMarker.position]);
    }
    previewActor.updateWorldMatrix(true,true);
    if(previewHands){
      root.updateWorldMatrix(true,false);
      // Hand sockets share the game's authored-world position/rotation path:
      // local grip + canonical side frame + local XYZ grip rotation, and the
      // same model-specific handFromTool correction used by combat.
      const calibration=window.ProceduralHandAttachments?.modelCalibrationForSpecies?.('mao-ao','male',modelH);
      for(const side of ['left','right']){
        const h=state.carryable.handTargets[side],world=new THREE.Vector3(h.x,h.y,h.z);
        root.localToWorld(world);
        const rr=h.rotation||{};
        handLocalEuler.set((Number(rr.x)||0)*DEG,(Number(rr.y)||0)*DEG,(Number(rr.z)||0)*DEG,'XYZ');
        const q=handLocalQuat.copy(handTurn[side]).multiply(new THREE.Quaternion().setFromEuler(handLocalEuler));
        previewHands.placeHandWorld?.(side,world,q,calibration);
      }
    }
    status('Posterior-based held pose · cyan socket at posterior + offset · scale '+scale.toFixed(2));
  }
  function frameHoldingPreview(){
    const bounds=new THREE.Box3().setFromObject(root);
    if(heldPreview.visible&&previewActor)bounds.expandByObject(previewActor);
    if(bounds.isEmpty())return;
    const center=bounds.getCenter(new THREE.Vector3()),extents=bounds.getSize(new THREE.Vector3());
    const radius=Math.max(1,extents.x,extents.y,extents.z);
    orbit?.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(radius*1.2,radius*.75,radius*2.1));
    camera.lookAt(center);camera.updateProjectionMatrix();orbit?.update();
  }
  async function startPreview(){
    if(previewStarted||!previewEnabled)return;
    previewStarted=true;status('Loading Mao’ao avatar and hand models…');
    try{
      const portrait=await renderSeatPortrait('mao-ao','male');
      const width=Number(effectiveAvatarConfig().worldModelWidth)||.9;
      const options={backCanvas:portrait.back,profile:portrait.profile,
        speciesId:'mao-ao',gender:'male',appearance:{speciesId:'mao-ao',species:'mao-ao',gender:'male'},
        npcRecord:{species:'mao-ao',gender:'male'},name:'carry_preview_maoao',
        modelWidth:width,modelHeight:width};
      const model=window.PNGPlaneAvatar?.buildSinglePlaneAvatarModel
        ?window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(THREE,portrait.front,options)
        :buildFallbackSeatedAvatarModel(portrait,options,'mao-ao','male');
      modelH=Math.max(.01,Number(model.userData?.portraitModelHeight)||width);
      modelW=Math.max(.01,Number(model.userData?.portraitModelWidth)||width);
      const actor=new THREE.Group();
      actor.name='carry_preview_actor';
      model.position.y=modelH/2;actor.add(model);heldPreview.add(actor);previewActor=actor;
      const profile=window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.['mao-ao::male']||{};
      const fromModel=posteriorAnchorForModel(model,'mao-ao','male').position;
      const sharedY=window.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(
        profile.posteriorRule,modelH,Number(model.userData?.handAttachY));
      previewPosterior=new THREE.Vector3(
        Number(profile.anchors?.posterior?.position?.x)||fromModel.x,
        Number.isFinite(sharedY)?sharedY:fromModel.y,
        Number(profile.anchors?.posterior?.position?.z)||fromModel.z);
      // Explicit THREE markers live on the avatar, so they follow the same
      // portrait rotation, scale and deadzone as the real rendered character.
      posteriorMarker=new THREE.Group();posteriorMarker.name='carry_reference_posterior';
      const hipBall=new THREE.Mesh(new THREE.SphereGeometry(.02,12,10),
        new THREE.MeshBasicMaterial({color:0xc788ff,depthTest:false,depthWrite:false}));
      hipBall.renderOrder=90;posteriorMarker.add(hipBall,new THREE.AxesHelper(.13));
      attachmentMarker=new THREE.Group();attachmentMarker.name='carry_reference_attachment';
      const attachBall=new THREE.Mesh(new THREE.SphereGeometry(.025,12,10),
        new THREE.MeshBasicMaterial({color:0x73fbef,depthTest:false,depthWrite:false}));
      attachBall.renderOrder=91;attachmentMarker.add(attachBall,new THREE.AxesHelper(.09));
      attachmentLine=new THREE.Line(new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({color:0x9fe9ef,depthTest:false,depthWrite:false}));
      attachmentLine.renderOrder=90;actor.add(posteriorMarker,attachmentMarker,attachmentLine);
      previewHands=window.ProceduralHandAttachments?.attach?.(THREE,actor,{
        name:'carry_preview',speciesId:'mao-ao',gender:'male',modelHeight:modelH,
        handAttachY:Number(model.userData?.handAttachY)||modelH*.45,
        avatarRoot:actor,
        bodyColors:portrait.profile?.appearance?.bodyColors||portrait.profile?.bodyColors
      })||null;
      syncHoldingPreview();if(previewActive())frameHoldingPreview();
      if(!previewHands)status('Mao’ao portrait loaded; hand assets unavailable, grip guides remain.');
    }catch(error){previewStarted=false;status('Avatar unavailable: '+(error?.message||error));log('Carry preview: '+(error?.stack||error),'warn');}
  }
  function setHoldingVisibility(){
    heldPreview.visible=previewActive()&&!!previewActor;
    if(avatarGroup)avatarGroup.visible=!(previewActive()&&!!previewActor);
    if(previewActive())startPreview();
    syncHoldingPreview();
  }
  document.getElementById('carryShowAvatar').addEventListener('change',e=>{
    previewEnabled=!!e.target.checked;setHoldingVisibility();
  });
  document.getElementById('carryFrameHoldingPose').addEventListener('click',frameHoldingPreview);


  function positionGuide(id) {
    const c=state.carryable;
    return id==='anchor'?c.billboardAnchor.position:c.handTargets[id];
  }
  function renderControls() {
    const c=state.carryable,id=state.selectedType==='carry'?state.selectedId:'anchor';
    const pos=positionGuide(id)||c.billboardAnchor.position;
    el('carryEnabled').checked=!!c.enabled;
    el('carryGuideLabel').textContent=id==='anchor'?'Billboard anchor':id==='left'?'Left hand grip':'Right hand grip';
    for(const axis of ['X','Y','Z']) {
      const input=el('carry'+axis);
      if(document.activeElement!==input)input.value=Number(pos[axis.toLowerCase()]||0).toFixed(3);
    }
    const r=id==='anchor'?c.billboardAnchor.rotation:c.handTargets[id]?.rotation||{};
    el('carryRotationLabel').textContent=id==='anchor'?'Anchor orientation (degrees)':'Hand socket rotation relative to its calibrated GLB (degrees)';
    el('carrySizeRow').hidden=id!=='anchor';
    for(const axis of ['X','Y','Z']){
      const input=el('carryR'+axis);
      if(document.activeElement!==input)input.value=Number(r[axis.toLowerCase()]||0).toFixed(2);
      const offsetInput=el('carryPosterior'+axis);
      if(document.activeElement!==offsetInput)offsetInput.value=Number(c.billboardAnchor.posteriorOffset?.[axis.toLowerCase()]||0).toFixed(3);
    }
    if(document.activeElement!==el('carrySize'))el('carrySize').value=c.billboardAnchor.size;
    el('carrySummary').textContent=c.enabled
      ?'Authoring enabled: billboard anchor and both hand positions will be exported.'
      :'Carrying disabled: configure the anchors here and enable when ready.';
    for(const key of ['anchor','left','right']){
      const idKey='carrySelect'+key[0].toUpperCase()+key.slice(1);
      el(idKey)?.classList.toggle('active',id===key);
    }
  }
  function createGuides() {
    for(const item of guideRoot.children.slice()){
      guideRoot.remove(item);
      item.traverse(o=>{o.geometry?.dispose?.();o.material?.dispose?.();});
    }
    for(const id of ['anchor','left','right']){
      const marker=new THREE.Group();
      marker.name='carry_author_'+id;
      marker.userData.carryGuide=id;
      if(id==='anchor'){
        const plane=new THREE.Mesh(new THREE.PlaneGeometry(1,1),
          new THREE.MeshBasicMaterial({color:0xffb75d,transparent:true,opacity:.16,side:THREE.DoubleSide,depthWrite:false,depthTest:false}));
        marker.add(plane);
        const outline=new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.PlaneGeometry(1,1)),
          new THREE.LineBasicMaterial({color:0xffb75d,depthTest:false}));
        marker.add(outline);
      }else{
        // The real calibrated GLBs render in previewHands. These are only
        // nonselectable socket axes for precise translation and rotation.
        const axes=new THREE.AxesHelper(.095);
        axes.renderOrder=92;
        marker.add(axes);
      }
      guideRoot.add(marker);
      guides[id]=marker;
    }
    refreshGuides();
    // Rebind to the new marker after any furniture rebuild or JSON import.
    if(activeEditorMode==='carry')select(state.selectedType==='carry'&&guides[state.selectedId]?state.selectedId:'anchor');
  }
  function refreshGuides() {
    const c=state.carryable;
    for(const id of ['anchor','left','right']){
      const marker=guides[id],pos=positionGuide(id);
      if(!marker||!pos)continue;
      marker.position.set(pos.x,pos.y,pos.z);
      if(id==='anchor'){
        const r=c.billboardAnchor.rotation;
        marker.rotation.set(r.x*DEG,r.y*DEG,r.z*DEG,'XYZ');
        for(const child of marker.children)child.scale.setScalar(c.billboardAnchor.size);
      }else{
        const r=c.handTargets[id]?.rotation||{};
        handLocalEuler.set((Number(r.x)||0)*DEG,(Number(r.y)||0)*DEG,(Number(r.z)||0)*DEG,'XYZ');
        marker.quaternion.copy(handTurn[id]).multiply(handAbsolute.setFromEuler(handLocalEuler));
      }
    }
  }
  function select(id) {
    if(!guides[id])return;
    state.selectedType='carry';
    state.selectedId=id;
    transform.detach();
    transform.enabled=true;
    transform.visible=true;
    transform.setSpace?.('local'); // Rotation gizmo follows actual calibrated hand socket orientation.
    if((transform.getMode?.()||'translate')==='scale')setTransformMode('translate');
    transform.attach(guides[id]);
    renderControls();
  }
  function fromInputs() {
    const id=state.selectedType==='carry'?state.selectedId:'anchor';
    const point=positionGuide(id);
    if(!point)return;
    for(const axis of ['X','Y','Z']){
      const n=Number(el('carry'+axis).value);
      if(Number.isFinite(n))point[axis.toLowerCase()]=n;
    }
    const rotations=id==='anchor'?state.carryable.billboardAnchor.rotation:state.carryable.handTargets[id].rotation;
    for(const axis of ['X','Y','Z']){
      const n=Number(el('carryR'+axis).value);
      if(Number.isFinite(n))rotations[axis.toLowerCase()]=n;
    }
    if(id==='anchor')state.carryable.billboardAnchor.size=Math.max(.1,Math.min(10,Number(el('carrySize').value)||1));
    for(const axis of ['X','Y','Z']){
      const n=Number(el('carryPosterior'+axis).value);
      if(Number.isFinite(n))state.carryable.billboardAnchor.posteriorOffset[axis.toLowerCase()]=n;
    }
    refreshGuides();
    syncHoldingPreview();
    queueUndoHistory('carryable guide edit');
    renderControls();
  }
  function fromGizmo() {
    if(activeEditorMode!=='carry'||state.selectedType!=='carry')return;
    const id=state.selectedId,marker=guides[id],point=positionGuide(id);
    if(!marker||!point)return;
    for(const axis of ['x','y','z'])point[axis]=Number(marker.position[axis].toFixed(4));
    if(id==='anchor'){
      for(const axis of ['x','y','z'])
        state.carryable.billboardAnchor.rotation[axis]=Number((marker.rotation[axis]*180/Math.PI).toFixed(3));
    }else{
      // A hand's gizmo rotates in canonical side-hand space, so recover the
      // authored local correction instead of baking the ±90° wrist basis.
      handInverse.copy(handTurn[id]).invert();
      handAbsolute.copy(handInverse).multiply(marker.quaternion);
      handLocalEuler.setFromQuaternion(handAbsolute,'XYZ');
      for(const axis of ['x','y','z'])
        state.carryable.handTargets[id].rotation[axis]=Number((handLocalEuler[axis]*180/Math.PI).toFixed(3));
    }
    renderControls();
    syncHoldingPreview();
  }
  el('carrySelectAnchor').onclick=()=>select('anchor');
  el('carrySelectLeft').onclick=()=>select('left');
  el('carrySelectRight').onclick=()=>select('right');
  el('carryEnabled').onchange=event=>{
    state.carryable.enabled=!!event.target.checked;
    queueUndoHistory('carryable toggle');
    renderControls();
  };
  for(const id of ['carryX','carryY','carryZ','carryRX','carryRY','carryRZ','carrySize','carryPosteriorX','carryPosteriorY','carryPosteriorZ'])
    el(id).addEventListener('change',fromInputs);
  transform.addEventListener?.('objectChange',fromGizmo);

  const originalExport=exportData;
  exportData=function(...args) {
    const data=originalExport(...args);
    data.carryable=cloneJson(state.carryable);
    return data;
  };
  const originalLoad=loadData;
  loadData=function(data){
    state.carryable=normalized(data?.carryable);
    const result=originalLoad(data);
    createGuides();
    renderControls();
    setHoldingVisibility();
    return result;
  };
  const originalRebuild=rebuildAll;
  rebuildAll=function(...args){
    const result=originalRebuild(...args);
    createGuides();
    renderControls();
    setHoldingVisibility();
    return result;
  };
  const originalMode=setEditorMode;
  setEditorMode=function(mode){
    const result=originalMode(mode);
    pane.classList.toggle('hidden',mode!=='carry');
    guideRoot.visible=mode==='carry';
    document.querySelectorAll('[data-left-tab]').forEach(tab=>
      tab.classList.toggle('active',tab.dataset.leftTab===mode));
    if(mode==='carry')select('anchor');
    setHoldingVisibility();
    if(mode==='carry')frameHoldingPreview();
    return result;
  };
  button.addEventListener('click',()=>setEditorMode('carry'));
  createGuides();
  renderControls();
  window.HobunjiCarryableFurnitureAuthor={
    normalize:normalized,
    snapshot:()=>({carryable:cloneJson(state.carryable),selected:state.selectedType==='carry'?state.selectedId:null,preview:{visible:heldPreview.visible,ready:!!previewActor,hands:!!previewHands}})
  };
})();