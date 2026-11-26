// Furniture Author: carried world-object billboard and hand grip authoring.
// These guides exist only in the editor. Exported metadata is consumed by
// Shattercasks and future carryable furniture through their existing meshes.
(() => {
  'use strict';
  if (typeof state === 'undefined' || typeof helperRoot === 'undefined'
    || typeof THREE === 'undefined' || typeof setEditorMode !== 'function') {
    const status=document.getElementById('carryAuthorLoadStatus'); // Mobile-visible reason for a tab whose editor dependencies were unavailable.
    if(status)status.textContent='Carryable editor dependencies are missing. Check the on-screen debug log.';
    return;
  }

  function normalized(value) {
    const obj=value&&typeof value==='object'?value:{};
    const anchor=obj.billboardAnchor||{},pos=anchor.position||{},rot=anchor.rotation||{};
    const back=obj.backCarry||{}; // Default: held transform rotated 180 degrees around the portrait's vertical axis.
    const hand=obj.handTargets||{},hitbox=obj.hitbox||{};
    const vector=(v,fallback)=>Object.fromEntries(['x','y','z']
      .map(key=>[key,Number.isFinite(Number(v?.[key]))?Number(v[key]):fallback[key]]));
    const grip=(v,p)=>({...vector(v,p),rotation:vector(v?.rotation,{x:0,y:0,z:0})});
    const pivot=a=>['posterior','neck'].includes(a?.pivot)?{pivot:a.pivot}:{}; // Family-baby anatomical mount pivot; absent on furniture.
    return {
      enabled:obj.enabled===true,
      billboardAnchor:{
        coordinateSpace:'posterior-relative',...pivot(anchor),
        position:vector(pos,{x:0,y:.53,z:0}),
        rotation:vector(rot,{x:0,y:0,z:0}),
        posteriorOffset:vector(anchor.posteriorOffset,{x:0,y:0,z:0}),
        size:Math.max(.1,Number(anchor.size)||1)
      },
      backCarry:{...pivot(back),
        position:vector(back.position,vector(pos,{x:0,y:.53,z:0})),
        rotation:vector(back.rotation,{x:Number(rot.x)||0,y:(Number(rot.y)||0)+180,z:Number(rot.z)||0}),
        posteriorOffset:vector(back.posteriorOffset,vector(anchor.posteriorOffset,{x:0,y:0,z:0})),
        size:Math.max(.1,Number(back.size)||Number(anchor.size)||1),
        portraitAnchor:vector(back.portraitAnchor,{x:0,y:0,z:0}) // Portrait-local attachment point; the default is its center.
      },
      hitbox:{enabled:hitbox.enabled!==false,
        center:vector(hitbox.center,{x:0.025,y:.25,z:0}),
        size:Object.fromEntries(['x','y','z'].map(axis=>
          [axis,Math.max(.01,Math.abs(Number(hitbox.size?.[axis])||({x:.43,y:.49,z:.31})[axis]))]))},
      handTargets:{
        left:grip(hand.left,{x:-.3,y:.46,z:.08}),
        right:grip(hand.right,{x:.3,y:.46,z:.08})
      },
      ...(obj.elbows&&typeof obj.elbows==='object'?{elbows:Object.fromEntries(['left','right'].map(side=>{
        const e=obj.elbows?.[side];
        return [side,e&&['x','y','z'].every(axis=>Number.isFinite(Number(e[axis])))
          ?vector(e,{x:0,y:0,z:0}):null]; // Exact Attack Editor shoulder-relative elbow pose contract.
      }))}:{}), // Do not add baby-only elbow fields to exported furniture that never had them.
    };
  }
  state.carryable=normalized(state.carryable);

  const tabs=document.querySelector('.tabs');
  const button=document.getElementById('carryModeTab')||document.createElement('button'); // Reuse the permanent tab; avoid duplicates on older editor pages.
  button.type='button';
  button.textContent='Carryable';
  button.dataset.leftTab='carry';
  if(!button.isConnected)tabs.appendChild(button);
  const pane=document.getElementById('tab-carry')||document.createElement('div'); // Replace the permanent diagnostic placeholder with live controls.
  pane.id='tab-carry';
  pane.classList.add('hidden');
  const bootStatus=pane.querySelector('#carryAuthorLoadStatus'); // Keep mobile error reporting available until every editor control is initialized.
  pane.innerHTML=[
    '<section class="fed-section">',
    '<h2>Carryable world objects</h2>',
    '<div class="section"><h2>Family baby grips</h2>',
    '<p class="muted">Move or rotate the baby directly; the adult stays fixed. The left hand grip is offset from the infant posterior, the right from its neck joint, independent of portrait size. Held/back positions remain separate.</p>',
    '<div class="g2"><button type="button" id="carryBabyEdit">Edit baby grips</button><button type="button" id="carryBabyReturn">Return to furniture grips</button></div>',
    '<div class="g3"><button type="button" id="carryBabyMove">Move Baby</button><button type="button" id="carryBabyRotate">Rotate Baby</button><button type="button" id="carryBabyRandom">Random Baby</button></div>',
    '<div class="g2"><button type="button" id="carryBabyApply">Apply baby grips on this device</button><button type="button" id="carryBabyExport">Export baby profile JSON</button></div>',
    '<button type="button" id="carryBabyCopy">Copy baby profile JSON</button>',
    '<textarea id="carryBabyCopyText" hidden readonly aria-label="Baby profile JSON for manual copying" style="width:100%;min-height:6rem"></textarea>',
    '<label>Import baby profile JSON<input type="file" id="carryBabyImport" accept=".json,application/json"></label>',
    '<p class="muted">While editing a baby, Download JSON and Copy Current JSON both export the baby pose (not furniture). Returning to furniture restores both actions. Apply baby grips saves a separate local gameplay override.</p>',
    '<div class="pill" id="carryBabyStatus" role="status">Furniture carry mode selected.</div></div>',
    '<p class="muted">Move Baby translates the infant in all three axes while the adult stays still; Rotate Baby turns the infant about its carried mount. Select Back-carry anchor to switch poses. Purple marks the adult posterior; cyan is the mounted baby pivot.</p>',
    '<label class="row"><input type="checkbox" id="carryEnabled"> Enable carrying for this furniture</label>',
    '<div class="g2"><button type="button" id="carrySelectAnchor">▣ Held anchor</button><button type="button" id="carrySelectBack">▣ Back-carry anchor</button></div>',
    '<div class="g2"><button type="button" id="carrySelectLeft">◉ Left hand grip</button><button type="button" id="carrySelectRight">◉ Right hand grip</button></div>',
    '<div id="carryBabyPortraitSection" class="section" hidden><h2>Baby portrait grips</h2>',
    '<p class="muted">Drag L (yellow) relative to the infant posterior or R (cyan) relative to its neck pivot. The portrait appears above an extra drag region so either grip can go BELOW the artwork. Saved offsets are baby-local distances, NOT percentages of portrait size.</p>',
    '<canvas id="carryBabyGripCanvas" width="280" height="400" style="display:block;width:min(100%,280px);height:auto;touch-action:none;border:1px solid #667"></canvas>',
    '<div class="g3"><label>Anchor offset X<input id="carryBabyOffsetX" type="number" step="0.005"></label>',
    '<label>Anchor offset Y<input id="carryBabyOffsetY" type="number" step="0.005"></label>',
    '<label>Anchor offset Z<input id="carryBabyOffsetZ" type="number" step="0.005"></label></div>',
    '<p class="muted" id="carryBabyGripOrigin">L = posterior · R = neck</p>',
    '<p class="muted" id="carryBabyScaleReadout">Baby portrait proportions loading…</p></div>',
    '<div id="carryBabyElbowSection" class="section" hidden><h2>Carrying arm elbows</h2>',
    '<label class="row"><input id="carryBabyBones" type="checkbox"> Show arm bones (shoulder → elbow → hand)</label>',
    '<p class="muted">The Attack Animation Editor arm solver is used here too. Elbows are offsets from the CARRIER shoulders, not the infant. Green = shoulders, orange = elbows, cyan = hands; bones use the existing shoulder-aim guide and hand rotation. Set halfway creates an authored elbow; Clear restores legacy shoulder aiming.</p>',
    '<div class="g2"><button type="button" id="carryBabyElbowLeft">Edit left elbow</button><button type="button" id="carryBabyElbowRight">Edit right elbow</button></div>',
    '<div class="g2"><button type="button" id="carryBabyMidLeft">Left halfway</button><button type="button" id="carryBabyMidRight">Right halfway</button></div>',
    '<div class="g2"><button type="button" id="carryBabyClearLeft">Clear left elbow</button><button type="button" id="carryBabyClearRight">Clear right elbow</button></div>',
    '<p class="muted" id="carryBabyElbowStatus">Elbows unkeyed; current hands aim toward shoulders.</p>',
    '</div>',
    '<div class="section"><h2>Projectile / impact hitbox</h2>',
    '<label class="row"><input id="carryHitboxEnabled" type="checkbox" checked> Use authored hitbox</label>',
    '<button type="button" id="carrySelectHitbox">▧ Edit hitbox in viewport</button>',
    '<p class="muted">Purple wireframe is the collision box; translate with the gizmo and resize with the half-extents fields. This box affects projectile hits without changing the visible furniture or the carried avatar.</p>',
    '<div class="g3">',
    '<label>Width X<input id="carryHitboxSX" type="number" min="0.01" step="0.01"></label>',
    '<label>Height Y<input id="carryHitboxSY" type="number" min="0.01" step="0.01"></label>',
    '<label>Depth Z<input id="carryHitboxSZ" type="number" min="0.01" step="0.01"></label>',
    '</div></div>',
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
    '<p class="muted">Held and back-stowed poses use the SAME species/gender-adjusted posterior. From hip offsets work in either pose. Back fine offsets below are additional values.</p>',
    '<div class="g3">',
    '<label>From hip X<input id="carryPosteriorX" type="number" step="0.01"></label>',
    '<label>From hip Y<input id="carryPosteriorY" type="number" step="0.01"></label>',
    '<label>From hip Z<input id="carryPosteriorZ" type="number" step="0.01"></label>',
    '</div>',
    '<div id="carryPortraitAnchorRow"><p class="muted">Additional back offset from the anatomical posterior (legacy portraitAnchor data, added to From hip). It no longer replaces the posterior with the portrait center.</p>',
    '<div class="g3">',
    '<label>Back fine X<input id="carryPortraitX" type="number" step="0.01"></label>',
    '<label>Back fine Y<input id="carryPortraitY" type="number" step="0.01"></label>',
    '<label>Back fine Z<input id="carryPortraitZ" type="number" step="0.01"></label>',
    '</div></div>',
    '<div class="section"><h2>Held avatar preview</h2>',
    '<label class="row"><input type="checkbox" id="carryShowAvatar" checked> Show Mao’ao avatar automatically in Carryable mode</label>',
    '<button type="button" id="carryFrameHoldingPose">Frame holding pose</button>',
    '<p class="muted tight">The purple posterior is calculated from the exact avatar model and shared character rig rule; the cyan attachment point is offset from it. Real hands use the combat handFromTool GLB calibration, with editable individual grip rotations.</p>',
    '<div class="pill" id="carryAvatarStatus">An avatar preview appears automatically when Carryable mode opens.</div></div>',
    '<p class="muted">Use the viewport translate / rotate gizmos or edit numeric values. Avatar preview is editor-only; exported JSON retains the invisible billboard anchor and both hand targets.</p>',
    '<div id="carrySummary" class="pill"></div>',
    '</section>'
  ].join('');
  if(bootStatus)pane.prepend(bootStatus); // Module errors after constructing controls must still be visible in the Carryable tab.
  if(!pane.isConnected)document.querySelector('#tab-effects').insertAdjacentElement('afterend',pane);
  const el=id=>document.getElementById(id);
  const BABY_REFERENCE_WIDTH=.3, BABY_REFERENCE_HEIGHT=.3; // Only a fallback until the real newborn portrait model is available.
  let babyPortraitWidth=BABY_REFERENCE_WIDTH,babyPortraitHeight=BABY_REFERENCE_HEIGHT; // Current full PNG-plane dimensions for display only, never grip offset scaling.
  let babyGripAnchors=window.FamilyBabyCarryPose?.anchorsForAvatar?.({},BABY_REFERENCE_WIDTH,BABY_REFERENCE_HEIGHT)||null; // Preview/game share anatomy anchor math.
  let babyFrontCanvas=null; // Random Baby's actual painted portrait, reused by the 2D touch grip author.
  let babyPortraitPlacementRatio=.5; // Rendered PNG position ratio adjusts touch projection for Kenkari/Mao'ao padding, not grip offsets.
  let editingBaby=false, savedFurnitureCarry=null, babyDraft=null; // Preserve ordinary furniture grips while baby guides are active.
  let babyRenderTicket=0, babyPreviewRolls=0; // Async randomized child previews are invalidated on exit and rapid rerolls.
  let babyPreviewStatus=''; // Mobile-visible result/error for the active randomized infant, never serialized into furniture.
  let babyPointerId=null,babyPointerSide=null; // Single active touch/pointer drag on the portrait's L/R hand dots.
  const babyPoseFrame=new THREE.Group(); // Infant-local frame uses the EXACT inverse-of-anchor pose from the gameplay carry solver.
  babyPoseFrame.name='baby_carry_gameplay_transform_preview';helperRoot.add(babyPoseFrame);
  const babyReference=new THREE.Group(); // Non-exported infant art, never part of the furniture JSON.
  babyReference.name='baby_reference_only';
  const babyReferencePlane=new THREE.Mesh(new THREE.PlaneGeometry(BABY_REFERENCE_WIDTH,BABY_REFERENCE_HEIGHT),
    new THREE.MeshBasicMaterial({color:0x9fc9dc,transparent:true,opacity:.45,depthWrite:false,side:THREE.DoubleSide}));
  babyReferencePlane.position.y=BABY_REFERENCE_HEIGHT/2;
  babyReferencePlane.userData.noOutline=true;
  babyReference.add(babyReferencePlane);
  babyReference.visible=false;
  babyPoseFrame.add(babyReference);
  let babyPortraitModel=null; // Only the latest random child portrait lives under the existing infant-reference group.
  const guideRoot=new THREE.Group();
  guideRoot.name='CarryableAuthoringGuides';
  guideRoot.visible=false;
  babyPoseFrame.add(guideRoot); // Hand/grip markers remain in the baby's LOCAL axes as the portrait rotates.
  const babyRotateProxy=new THREE.Group(); // Stable adult-space gizmo pivot at the baby's mount point.
  babyRotateProxy.name='baby_rotation_pivot';babyRotateProxy.userData.carryGuide='baby';
  const babyPivotAxes=new THREE.AxesHelper(.11);babyRotateProxy.add(babyPivotAxes);
  babyRotateProxy.visible=false;helperRoot.add(babyRotateProxy);
  const guides={baby:babyRotateProxy};
  let babyPoseView='anchor'; // Which pose Move/Rotate Baby authors.
  let babyTransformMode='rotate'; // Persist the selected direct baby gizmo mode when guides rebuild.
  babyPivotAxes.visible=false; // The pivot cross only appears when direct rotation is selected.
  // Transient reference model, kept outside root and never included in the exported furniture.
  const heldPreview=new THREE.Group();
  heldPreview.name='carry_avatar_preview_only';
  heldPreview.visible=false;helperRoot.add(heldPreview);
  const elbowGuideRoot=new THREE.Group(); // Selectable orange elbow markers live in the CARRIER frame, unlike baby-local grip markers.
  elbowGuideRoot.name='baby_carry_elbow_editor_guides';heldPreview.add(elbowGuideRoot);
  const elbowShoulderScratch=new THREE.Vector3(),elbowHandScratch=new THREE.Vector3(),elbowWorldScratch=new THREE.Vector3(); // Temporary world↔carrier transforms for midpoint/marker updates.
  let previewEnabled=true,previewStarted=false,previewActor=null,previewHands=null,modelW=.9,modelH=.9;
  let previewPortraitModel=null,previewSource='not-started'; // Replaces the immediate placeholder with loaded portrait art; mobile diagnostics report which is visible.
  let previewPosterior=new THREE.Vector3(0,.42,0),posteriorMarker=null,attachmentMarker=null,attachmentLine=null;
  const handLocalEuler=new THREE.Euler(0,0,0,'XYZ'),handLocalQuat=new THREE.Quaternion();
  const handInverse=new THREE.Quaternion(),handAbsolute=new THREE.Quaternion(),avatarScaleScratch=new THREE.Vector3();
  const handTurn={
    left:new THREE.Quaternion().setFromEuler(new THREE.Euler(0,Math.PI/2,0)),
    right:new THREE.Quaternion().setFromEuler(new THREE.Euler(0,-Math.PI/2,0))};
  const tempRotation=new THREE.Quaternion(),tempOffset=new THREE.Vector3();
  const babyMountWorld=new THREE.Vector3(),babyAnchorWorld=new THREE.Vector3(); // Reused preview math: same posterior-based mount as Shattercasks.alignHeldVase.
  const babyEulerScratch=new THREE.Euler(0,0,0,'XYZ'),babyRotationScratch=new THREE.Quaternion(); // Shared inverse Euler/quaternion conversion for direct baby rotation.
  const status=message=>{const node=document.getElementById('carryAvatarStatus');if(node)node.textContent=message;};
  const previewActive=()=>activeEditorMode==='carry'&&previewEnabled;
  // The Attack Editor's Proximal +Y shoulder/elbow hand solver calls this only for
  // this furniture author's Mao'ao preview avatar; no global player/NPC arm targets are changed.
  window.HobunjiFurnitureBabyElbowFor=(side,avatarRoot)=>
    editingBaby && avatarRoot===previewActor && !babyPoseIsBack() ?state.carryable.elbows?.[side]||null:null;
  function carrierShoulder(side,out) {
    const fromRig=previewHands?.shoulderPositionLocal?.(side,out);
    if(fromRig)return fromRig;
    const profile=window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.['mao-ao::male'];
    const v=profile?.anchors?.[side==='left'?'leftHandShoulder':'rightHandShoulder']?.position;
    if(v && ['x','y','z'].every(axis=>Number.isFinite(Number(v[axis]))))
      return out.set(Number(v.x),Number(v.y),Number(v.z));
    return out.set((side==='left'?-1:1)*modelW*.25,modelH*.72,0); // Missing async shoulder rig only.
  }
  function updateBabyElbowGuides(){
    const show=editingBaby && !babyPoseIsBack() && !!el('carryBabyBones')?.checked && !!previewHands;
    for(const side of ['left','right']){
      const marker=guides[side==='left'?'elbowLeft':'elbowRight'];
      if(!marker)continue;
      marker.visible=show;
      if(!show)continue;
      const shoulder=carrierShoulder(side,elbowShoulderScratch);
      const elbow=state.carryable.elbows?.[side];
      if(elbow)marker.position.copy(shoulder).add(new THREE.Vector3(elbow.x,elbow.y,elbow.z));
      else{
        const hand=state.carryable.handTargets?.[side];
        elbowHandScratch.set(hand?.x||0,hand?.y||0,hand?.z||0);
        babyPoseFrame.updateWorldMatrix(true,false);
        babyPoseFrame.localToWorld(elbowHandScratch);
        elbowGuideRoot.updateWorldMatrix(true,false);
        elbowGuideRoot.worldToLocal(elbowHandScratch);
        marker.position.copy(shoulder).add(elbowHandScratch).multiplyScalar(.5); // Editor-only midpoint, not an authored runtime elbow.
      }
    }
    window.ProceduralHandShoulderAim?.refreshPaperArmGuides?.();
  }
  function setBabyBones(enabled){
    const toggle=el('carryBabyBones');
    if(toggle)toggle.checked=!!enabled;
    window.ProceduralHandShoulderAim?.setPaperArmGuideVisible?.(!!enabled&&editingBaby&&!babyPoseIsBack());
    updateBabyElbowGuides();
  }
  function authorElbowFromMarker(side){
    const marker=guides[side==='left'?'elbowLeft':'elbowRight'];
    if(!marker)return;
    const shoulder=carrierShoulder(side,elbowShoulderScratch);
    const offset=marker.position.clone().sub(shoulder); // Attack Editor convention, shoulder-relative in carrier parent coordinates.
    state.carryable.elbows ||= {};
    state.carryable.elbows[side]={x:Number(offset.x.toFixed(4)),y:Number(offset.y.toFixed(4)),z:Number(offset.z.toFixed(4))};
  }
  function babyPoseIsBack() {
    return state.selectedType==='carry'&&(state.selectedId==='back'||(state.selectedId==='baby'&&babyPoseView==='back'));
  }
  function babyOrientation() {
    babyRotationScratch.setFromEuler(babyEulerScratch.set(
      Number((babyPoseIsBack()?state.carryable.backCarry:state.carryable.billboardAnchor).rotation.x||0)*DEG,
      Number((babyPoseIsBack()?state.carryable.backCarry:state.carryable.billboardAnchor).rotation.y||0)*DEG,
      Number((babyPoseIsBack()?state.carryable.backCarry:state.carryable.billboardAnchor).rotation.z||0)*DEG,'XYZ')).invert();
    return babyRotationScratch;
  }
  function authorBabyTranslation(position) {
    // The mount point is posterior + from-hip offset (+ back fine offset).
    // Moving it translates the BABY without disturbing wrist offsets or mount orientation.
    const a=babyPoseIsBack()?state.carryable.backCarry:state.carryable.billboardAnchor;
    const fine=babyPoseIsBack()?a.portraitAnchor||{}:{};
    a.posteriorOffset ||= {};
    for(const axis of ['x','y','z'])a.posteriorOffset[axis]=Number((
      position[axis]-previewPosterior[axis]-(Number(fine[axis])||0)).toFixed(4));
  }
  function authorBabyRotation(quaternion) {
    // Gameplay applies inverse(anchor), so turn the VISUAL baby's quaternion back into the one existing anchor schema.
    babyEulerScratch.setFromQuaternion(babyRotationScratch.copy(quaternion).invert(),'XYZ');
    const rotation=(babyPoseIsBack()?state.carryable.backCarry:state.carryable.billboardAnchor).rotation;
    for(const axis of ['x','y','z'])rotation[axis]=Number((babyEulerScratch[axis]/DEG).toFixed(4));
  }
  function syncHoldingPreview(){
    heldPreview.visible=previewActive()&&!!previewActor;
    if(!heldPreview.visible&&!editingBaby)return;
    const isBack=babyPoseIsBack();
    const a=isBack?state.carryable.backCarry:state.carryable.billboardAnchor,p=a.position,r=a.rotation;
    const scale=Math.max(.1,Number(a.size)||1);
    const offset=a.posteriorOffset||{};
    const fine=isBack?a.portraitAnchor||{}:{}; // Back fine offset is added to the same posterior as gameplay.
    const mountPoint=previewPosterior;
    const attachmentOffset=tempOffset.set(
      (Number(offset.x)||0)+(Number(fine.x)||0),
      (Number(offset.y)||0)+(Number(fine.y)||0),
      (Number(offset.z)||0)+(Number(fine.z)||0));
    tempRotation.setFromEuler(babyEulerScratch.set(r.x*DEG,r.y*DEG,r.z*DEG,'XYZ'));
    if(editingBaby){
      // Game: baby.quaternion=inverse(anchor.rotation), baby.scale=1/anchor.size,
      // baby.position=adult.posterior+offset-baby.quaternion*(anchor.position/size).
      // Keep the adult at the origin, move the baby instead, and let its grip
      // guides inherit this same transform. No second interpretation of poses.
      if(previewActor){
        previewActor.position.set(0,0,0);
        previewActor.quaternion.identity();
        previewActor.scale.setScalar(1);
      }
      babyPoseFrame.quaternion.copy(tempRotation).invert();
      babyPoseFrame.scale.setScalar(1/scale);
      babyMountWorld.copy(mountPoint).add(attachmentOffset);
      babyAnchorWorld.set(Number(p.x)||0,Number(p.y)||0,Number(p.z)||0)
        .multiplyScalar(1/scale).applyQuaternion(babyPoseFrame.quaternion);
      babyPoseFrame.position.copy(babyMountWorld).sub(babyAnchorWorld);
      babyPoseFrame.updateWorldMatrix(true,true);
      if(state.selectedId!=='baby'||!transformDragging){
        babyRotateProxy.position.copy(babyMountWorld);
        babyRotateProxy.quaternion.copy(babyPoseFrame.quaternion);
      }
    }else{
      babyPoseFrame.position.set(0,0,0);babyPoseFrame.quaternion.identity();babyPoseFrame.scale.setScalar(1);
      // Furniture keeps its previous inverse-mounted static-object preview,
      // without modifying the object's authored transform.
      if(!previewActor)return;
      previewActor.scale.setScalar(scale);
      previewActor.quaternion.copy(tempRotation);
      babyMountWorld.copy(mountPoint).add(attachmentOffset).multiplyScalar(scale).applyQuaternion(tempRotation);
      previewActor.position.set(Number(p.x)||0,Number(p.y)||0,Number(p.z)||0).sub(babyMountWorld);
    }
    if(posteriorMarker)posteriorMarker.position.copy(mountPoint);
    if(attachmentMarker){
      attachmentMarker.position.copy(mountPoint).add(attachmentOffset);
      attachmentLine?.geometry?.setFromPoints?.([mountPoint,attachmentMarker.position]);
    }
    previewActor?.updateWorldMatrix?.(true,true);
    if(previewHands&&previewActor){
      for(const side of ['left','right'])previewHands.setSideVisible?.(side,!isBack);
      (editingBaby?babyPoseFrame:root).updateWorldMatrix(true,false);
      const calibration=window.ProceduralHandAttachments?.modelCalibrationForSpecies?.('mao-ao','male',modelH);
      for(const side of (isBack?[]:['left','right'])){
        const h=state.carryable.handTargets[side],world=new THREE.Vector3(h.x,h.y,h.z);
        (editingBaby?babyPoseFrame:root).localToWorld(world);
        const rr=h.rotation||{};
        handLocalEuler.set((Number(rr.x)||0)*DEG,(Number(rr.y)||0)*DEG,(Number(rr.z)||0)*DEG,'XYZ');
        const q=handLocalQuat.copy(handTurn[side]).multiply(new THREE.Quaternion().setFromEuler(handLocalEuler));
        if(editingBaby)q.premultiply(babyPoseFrame.quaternion); // Hands turn with the infant, not independently through it.
        previewHands.placeHandWorld?.(side,world,q,calibration);
      }
      updateBabyElbowGuides();
    }
    status((editingBaby?'Baby movable/rotatable; adult fixed · ':'')+(isBack?'Back-mounted posterior pose':'Posterior-based held pose')+' · cyan socket at posterior + offset · scale '+scale.toFixed(2));
  }
  function frameHoldingPreview(){
    const bounds=new THREE.Box3().setFromObject(editingBaby?babyReference:root);
    if(heldPreview.visible&&previewActor)bounds.expandByObject(previewActor);
    if(bounds.isEmpty())return;
    const center=bounds.getCenter(new THREE.Vector3()),extents=bounds.getSize(new THREE.Vector3());
    const radius=Math.max(1,extents.x,extents.y,extents.z);
    orbit?.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(radius*1.2,radius*.75,radius*2.1));
    camera.lookAt(center);camera.updateProjectionMatrix();orbit?.update();
  }
  function installPreviewPortrait(portrait,placeholder=false){
    const width=Number(effectiveAvatarConfig().worldModelWidth)||.9;
    const options={backCanvas:portrait.back,profile:portrait.profile,
      speciesId:'mao-ao',gender:'male',appearance:{speciesId:'mao-ao',species:'mao-ao',gender:'male'},
      npcRecord:{species:'mao-ao',gender:'male'},name:'carry_preview_maoao',
      modelWidth:width,modelHeight:width};
    let model;
    if(placeholder)model=buildFallbackSeatedAvatarModel(portrait,options,'mao-ao','male');
    else{
      try{
        model=window.PNGPlaneAvatar?.buildSinglePlaneAvatarModel
          ?window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(THREE,portrait.front,options)
          :buildFallbackSeatedAvatarModel(portrait,options,'mao-ao','male');
      }catch(error){
        log('Carry avatar runtime model unavailable; using rendered portrait plane. '+(error?.message||error),'warn');
        model=buildFallbackSeatedAvatarModel(portrait,options,'mao-ao','male');
      }
    }
    if(!model)throw new Error('Carry preview avatar model could not be constructed');
    const nextHeight=Math.max(.01,Number(model.userData?.portraitModelHeight)||width);
    const nextWidth=Math.max(.01,Number(model.userData?.portraitModelWidth)||width);
    if(!previewActor){
      const actor=new THREE.Group(); // Stable preview transform owns the visible avatar and reference markers.
      actor.name='carry_preview_actor';
      heldPreview.add(actor);previewActor=actor;
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
    }
    if(previewPortraitModel){ // The async actual portrait replaces the placeholder instead of stacking duplicate avatars.
      previewActor.remove(previewPortraitModel);
      disposeObject(previewPortraitModel);
    }
    modelH=nextHeight;modelW=nextWidth;
    model.position.y=modelH/2;
    previewActor.add(model);previewPortraitModel=model;
    const profile=window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.['mao-ao::male']||{};
    const fromModel=posteriorAnchorForModel(model,'mao-ao','male').position;
    const sharedY=window.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(
      profile.posteriorRule,modelH,Number(model.userData?.handAttachY));
    previewPosterior=new THREE.Vector3(
      Number(profile.anchors?.posterior?.position?.x)||fromModel.x,
      Number.isFinite(sharedY)?sharedY:fromModel.y,
      Number(profile.anchors?.posterior?.position?.z)||fromModel.z);
    if(!placeholder&&!previewHands){
      previewHands=window.ProceduralHandAttachments?.attach?.(THREE,previewActor,{
        name:'carry_preview',speciesId:'mao-ao',gender:'male',modelHeight:modelH,
        handAttachY:Number(model.userData?.handAttachY)||modelH*.45,
        avatarRoot:previewActor,
        bodyColors:portrait.profile?.appearance?.bodyColors||portrait.profile?.bodyColors
      })||null;
    }
    previewSource=placeholder?'placeholder':'runtime-portrait'; // Mobile debug distinguishes instant feedback from completed loading.
    if(editingBaby)setBabyBones(!!el('carryBabyBones').checked); // Reconnect paper bones after async GLB arrival.
    syncHoldingPreview();
    if(avatarGroup)avatarGroup.visible=!heldPreview.visible; // Hide the separate Avatar-tab reference when the Carryable preview exists.
    if(previewActive())frameHoldingPreview();
  }
  async function startPreview(){
    if(previewStarted||!previewEnabled)return;
    previewStarted=true;
    try{
      // Opening the Carryable tab must not wait on async portrait or cosmetic assets.
      installPreviewPortrait({front:placeholderAvatarCanvas('runtimePortrait'),back:null,profile:null},true);
      status('Showing Mao’ao reference avatar · loading rendered portrait and hands…');
    }catch(error){
      log('Carry preview immediate avatar failed: '+(error?.stack||error),'warn');
    }
    try{
      const portrait=await renderSeatPortrait('mao-ao','male');
      installPreviewPortrait(portrait);
      if(!previewHands)status('Mao’ao avatar shown; hand assets unavailable, grip guides remain.');
    }catch(error){
      if(previewActor){
        status('Mao’ao reference avatar shown (portrait assets unavailable).');
        log('Carry preview kept visible fallback: '+(error?.stack||error),'warn');
      }else{
        previewStarted=false;
        status('Avatar unavailable: '+(error?.message||error));
        log('Carry preview: '+(error?.stack||error),'warn');
      }
    }
  }
  function setHoldingVisibility(){
    heldPreview.visible=previewActive()&&!!previewActor;
    if(avatarGroup)avatarGroup.visible=!(previewActive()&&!!previewActor);
    if(previewActive())startPreview();
    syncHoldingPreview();
  }
  const originalBuildAvatarFromCanvas=buildAvatarFromCanvas; // Keeps the standalone Avatar-tab model hidden if a late portrait rebuild happens in Carryable mode.
  buildAvatarFromCanvas=function(...args){
    const result=originalBuildAvatarFromCanvas(...args);
    if(avatarGroup)avatarGroup.visible=!(previewActive()&&!!previewActor); // Async cosmetics must not reveal a duplicate avatar over the active Carryable preview.
    return result;
  };
  document.getElementById('carryShowAvatar').addEventListener('change',e=>{
    previewEnabled=!!e.target.checked;setHoldingVisibility();
  });
  document.getElementById('carryFrameHoldingPose').addEventListener('click',frameHoldingPreview);


  function elbowSide(id) { return id==='elbowLeft'?'left':id==='elbowRight'?'right':null; }
  function positionGuide(id) {
    const side=elbowSide(id);
    if(side)return state.carryable.elbows?.[side]||{x:0,y:0,z:0}; // Fields are SHOULDER-RELATIVE; their gizmo is at shoulder + offset.
    const c=state.carryable;
    return id==='anchor'?c.billboardAnchor.position:id==='back'?c.backCarry.position:id==='hitbox'?c.hitbox.center:c.handTargets[id];
  }
  function renderControls() {
    const c=state.carryable,id=state.selectedType==='carry'?state.selectedId:'anchor';
    const pos=id==='baby'?babyRotateProxy.position:positionGuide(id)||c.billboardAnchor.position;
    el('carryEnabled').checked=!!c.enabled;
    el('carryGuideLabel').textContent=id==='baby'?(babyTransformMode==='translate'?'Move baby':'Rotate baby')+' · '+(babyPoseView==='back'?'back carry':'held'):id==='anchor'?'Held anchor':id==='back'?'Back-carry anchor':id==='left'?'Left hand grip':id==='right'?'Right hand grip':id==='elbowLeft'?'Left elbow (shoulder-relative)':id==='elbowRight'?'Right elbow (shoulder-relative)':'Impact hitbox center';
    const portraitSection=el('carryBabyPortraitSection'); // Grip authoring uses image UV, never scene X/Y units.
    if(portraitSection)portraitSection.hidden=!editingBaby;
    const elbowsSection=el('carryBabyElbowSection');
    if(elbowsSection)elbowsSection.hidden=!editingBaby;
    for(const side of ['left','right']){
      const point=state.carryable.elbows?.[side];
      const node=el(side==='left'?'carryBabyElbowLeft':'carryBabyElbowRight');
      node?.classList.toggle('active',elbowSide(id)===side);
      const status=el('carryBabyElbowStatus');
      if(status)status.textContent=['left','right'].map(which=>{
        const v=state.carryable.elbows?.[which];return which+': '+(v?'('+['x','y','z'].map(key=>v[key]?.toFixed?.(3)??v[key]).join(', ')+')':'unset · shoulder fallback');
      }).join(' | ');
    }
    if(editingBaby){
      const side=['left','right'].includes(id)?id:'left';
      const api=window.FamilyBabyCarryPose;
      const off=api?.gripOffset?.(side,state.carryable.handTargets[side],babyGripAnchors,babyPortraitWidth,babyPortraitHeight);
      for(const axis of ['X','Y','Z']){
        const node=el('carryBabyOffset'+axis);
        if(node&&document.activeElement!==node)node.value=Number(off?.[axis.toLowerCase()]||0).toFixed(4);
        if(node)node.disabled=!['left','right'].includes(id);
      }
      const origin=el('carryBabyGripOrigin');
      if(origin)origin.textContent=(side==='left'?'L · baby posterior':'R · baby neck joint')+' → grip offset (baby-local X/Y/Z)';
      const metrics=el('carryBabyScaleReadout');
      if(metrics)metrics.textContent='Baby portrait: '+babyPortraitWidth.toFixed(3)+' × '+babyPortraitHeight.toFixed(3)+' carrier-local units · grip offsets are real distances, not size fractions.';
    }
    drawBabyGripCanvas();
    for(const axis of ['X','Y','Z']) {
      const input=el('carry'+axis);
      if(document.activeElement!==input)input.value=Number(pos[axis.toLowerCase()]||0).toFixed(3);
      input.disabled=false; // Baby X/Y/Z edit the fixed-carrier mount in the same frame as the translation gizmo.
    }
    const r=id==='baby'?babyEulerScratch.setFromQuaternion(babyOrientation(),'XYZ')
      :id==='anchor'?c.billboardAnchor.rotation:id==='back'?c.backCarry.rotation:c.handTargets[id]?.rotation||{};
    el('carryRotationLabel').textContent=id==='baby'?'Baby visual orientation (degrees; inverse-mapped to gameplay mount)'
      :id==='anchor'||id==='back'?'Mount orientation (degrees)':'Hand socket rotation relative to its calibrated GLB (degrees)';
    el('carryAnchorRotation').hidden=id==='hitbox'||!!elbowSide(id); // Elbows author XYZ only, matching Attack Editor.
    el('carryHitboxEnabled').checked=c.hitbox.enabled;
    for(const axis of ['X','Y','Z']) {
      const field=el('carryHitboxS'+axis);
      if(document.activeElement!==field)field.value=Number(c.hitbox.size[axis.toLowerCase()]).toFixed(3);
    }
    el('carrySizeRow').hidden=id!=='anchor'&&id!=='back';
    el('carryPortraitAnchorRow').hidden=id!=='back';
    for(const axis of ['X','Y','Z'])el('carryPosterior'+axis).disabled=id==='baby'; // Select an anchor to move the mount without turning the baby.
    for(const axis of ['X','Y','Z']){
      const input=el('carryR'+axis);
      if(document.activeElement!==input)input.value=(id==='baby'?Number(r[axis.toLowerCase()]/DEG):Number(r[axis.toLowerCase()]||0)).toFixed(2);
      const portraitInput=el('carryPortrait'+axis);
      if(document.activeElement!==portraitInput)portraitInput.value=Number(c.backCarry.portraitAnchor[axis.toLowerCase()]||0).toFixed(3);
      const offsetInput=el('carryPosterior'+axis);
      if(document.activeElement!==offsetInput)offsetInput.value=Number((id==='back'||(id==='baby'&&babyPoseView==='back')?c.backCarry:c.billboardAnchor).posteriorOffset?.[axis.toLowerCase()]||0).toFixed(3);
    }
    if(document.activeElement!==el('carrySize'))el('carrySize').value=(id==='back'?c.backCarry:c.billboardAnchor).size;
    el('carryBabyEdit').disabled=editingBaby;
    el('carryBabyReturn').disabled=!editingBaby;
    el('carryBabyApply').disabled=!editingBaby;
    el('carryBabyCopy').disabled=!editingBaby;
    for(const control of ['carryBabyElbowLeft','carryBabyElbowRight','carryBabyMidLeft','carryBabyMidRight','carryBabyClearLeft','carryBabyClearRight']){
      const node=el(control);if(node)node.disabled=!editingBaby;
    }
    el('carryBabyMove').disabled=!editingBaby;
    el('carryBabyMove').classList.toggle('active',id==='baby'&&babyTransformMode==='translate');
    el('carryBabyRotate').disabled=!editingBaby;
    el('carryBabyRotate').classList.toggle('active',id==='baby'&&babyTransformMode==='rotate');
    el('carryBabyRandom').disabled=!editingBaby;
    syncBabyDownloadButton(); // The main export button must never silently download unrelated furniture while authoring a baby.
    if(editingBaby)el('carryBabyStatus').textContent=babyPreviewStatus||'Editing family baby hand targets and anchors. Random Baby changes only the reference appearance.';
    el('carrySummary').textContent=c.enabled
      ?'Authoring enabled: held/back anchors and both hand positions will be exported.'
      :'Carrying disabled: configure the anchors here and enable when ready.';
    for(const key of ['anchor','back','left','right','hitbox','baby']){
      const idKey='carrySelect'+key[0].toUpperCase()+key.slice(1);
      el(idKey)?.classList.toggle('active',id===key);
    }
  }
  function babyImagePoint(local) {
    const uv=window.FamilyBabyCarryPose?.pointToPortrait?.(local,babyPortraitWidth,babyPortraitHeight);
    return uv?{u:uv.u,v:uv.v+babyPortraitPlacementRatio-.5,depth:uv.depth}:null; // Painted pixel Y includes species placement.
  }
  function babyPointFromImage(uv) {
    return window.FamilyBabyCarryPose?.pointFromPortrait?.(
      {...uv,v:uv.v-babyPortraitPlacementRatio+.5},babyPortraitWidth,babyPortraitHeight);
  }
  function drawBabyGripCanvas() {
    const canvas=el('carryBabyGripCanvas'); // Extra area below the 280px portrait for negative Y hand contact.
    if(!canvas||!editingBaby)return;
    const ctx=canvas.getContext?.('2d');
    if(!ctx)return;
    const size=canvas.width,api=window.FamilyBabyCarryPose;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#263139';ctx.fillRect(0,0,canvas.width,canvas.height);
    if(babyFrontCanvas)ctx.drawImage(babyFrontCanvas,0,0,size,size);
    else{ctx.fillStyle='#9fc9dc';ctx.globalAlpha=.55;ctx.fillRect(size*.35,size*.15,size*.30,size*.7);ctx.globalAlpha=1;}
    ctx.font='12px sans-serif';ctx.textAlign='center';ctx.textBaseline='alphabetic';
    ctx.fillStyle='#c5d5dc';ctx.fillText('Below portrait · hand contact can go here',size/2,size+22);
    for(const side of ['left','right']){
      const origin=babyImagePoint(api?.gripAnchor?.(side,babyGripAnchors,babyPortraitWidth,babyPortraitHeight));
      const uv=babyImagePoint(state.carryable.handTargets[side]);
      if(!uv)continue;
      const x=uv.u*size,y=uv.v*size;
      if(origin){
        ctx.beginPath();ctx.moveTo(origin.u*size,origin.v*size);ctx.lineTo(x,y);
        ctx.lineWidth=1.5;ctx.strokeStyle='#f1f5f9';ctx.stroke();
        ctx.beginPath();ctx.arc(origin.u*size,origin.v*size,5,0,Math.PI*2);
        ctx.fillStyle=side==='left'?'#c788ff':'#f97316';ctx.fill();
      }
      ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);
      ctx.fillStyle=side==='left'?'#e6ca74':'#74d8ed';
      ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#111';ctx.stroke();
      ctx.fillStyle='#111';ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(side==='left'?'L':'R',x,y);
    }
  }
  function setBabyPortraitGrip(side,uv) {
    const api=window.FamilyBabyCarryPose,grip=state.carryable?.handTargets?.[side];
    if(!editingBaby||!api?.gripOffset||!grip)return false;
    const original=babyImagePoint(grip),next=babyPointFromImage({...original,...uv});
    if(!next)return false;
    Object.assign(grip,next); // Live hand coordinates; the exported profile subtracts the appropriate anatomical pivot.
    refreshGuides();syncHoldingPreview();renderControls();
    return true;
  }
  function babyPointerCoordinates(event){
    const canvas=el('carryBabyGripCanvas'),rect=canvas?.getBoundingClientRect?.();
    if(!rect?.width||!rect?.height)return null;
    return {u:(event.clientX-rect.left)/rect.width,
      v:(event.clientY-rect.top)/rect.width}; // Portrait pixel units, including below-portrait v>1.
  }
  const gripCanvas=el('carryBabyGripCanvas');
  gripCanvas?.addEventListener('pointerdown',event=>{
    if(!editingBaby)return;
    const uv=babyPointerCoordinates(event);
    if(!uv)return;
    const distance=side=>{
      const point=babyImagePoint(state.carryable.handTargets[side]);
      return point?Math.hypot(point.u-uv.u,point.v-uv.v):Infinity;
    };
    const nearest=distance('left')<=distance('right')?'left':'right';
    babyPointerSide=nearest;babyPointerId=event.pointerId;
    gripCanvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();select(nearest);setBabyPortraitGrip(nearest,uv);
  });
  gripCanvas?.addEventListener('pointermove',event=>{
    if(!editingBaby||babyPointerId!==event.pointerId||!babyPointerSide)return;
    const uv=babyPointerCoordinates(event);
    if(uv){event.preventDefault();setBabyPortraitGrip(babyPointerSide,uv);}
  });
  const endBabyPointer=event=>{
    if(babyPointerId!==event.pointerId)return;
    babyPointerId=null;babyPointerSide=null;
    if(gripCanvas.hasPointerCapture?.(event.pointerId))gripCanvas.releasePointerCapture(event.pointerId);
  };
  gripCanvas?.addEventListener('pointerup',endBabyPointer);
  gripCanvas?.addEventListener('pointercancel',endBabyPointer);
  for(const axis of ['X','Y','Z'])el('carryBabyOffset'+axis)?.addEventListener('change',()=>{
    const side=['left','right'].includes(state.selectedId)?state.selectedId:null;
    if(!editingBaby||!side)return;
    const api=window.FamilyBabyCarryPose,offset={};
    for(const key of ['x','y','z']){
      const value=Number(el('carryBabyOffset'+key.toUpperCase()).value);
      if(!Number.isFinite(value))return;
      offset[key]=value;
    }
    const next=api?.gripPosition?.(side,offset,babyGripAnchors,babyPortraitWidth,babyPortraitHeight);
    if(!next)return;
    Object.assign(state.carryable.handTargets[side],next);
    refreshGuides();syncHoldingPreview();renderControls();
  });
  function createGuides() {
    for(const item of guideRoot.children.slice()){
      guideRoot.remove(item);
      item.traverse(o=>{o.geometry?.dispose?.();o.material?.dispose?.();});
    }
    for(const old of elbowGuideRoot.children.slice()){elbowGuideRoot.remove(old);old.traverse?.(node=>{node.geometry?.dispose?.();node.material?.dispose?.();});}
    for(const side of ['left','right']){
      const id=side==='left'?'elbowLeft':'elbowRight',marker=new THREE.Group();
      marker.name='carry_baby_'+id;marker.userData.carryGuide=id;
      const ball=new THREE.Mesh(new THREE.SphereGeometry(.027,12,10),
        new THREE.MeshBasicMaterial({color:0xf97316,depthTest:false,depthWrite:false})); // Matches Attack Editor orange elbow.
      ball.renderOrder=10001;marker.add(ball,new THREE.AxesHelper(.095));
      elbowGuideRoot.add(marker);guides[id]=marker;
    }
    for(const id of ['anchor','back','left','right','hitbox']){
      const marker=new THREE.Group();
      marker.name='carry_author_'+id;
      marker.userData.carryGuide=id;
      if(id==='hitbox'){
        const hitWire=new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),
          new THREE.LineBasicMaterial({color:0xc98aff,depthTest:false,depthWrite:false}));
        hitWire.name='carry_hitbox_wireframe';
        hitWire.renderOrder=97;
        marker.add(hitWire);
      }else if(id==='anchor'||id==='back'){
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
    updateBabyElbowGuides();
  }
  function refreshGuides() {
    const c=state.carryable;
    for(const id of ['anchor','back','left','right','hitbox']){
      const marker=guides[id],pos=positionGuide(id);
      if(!marker||!pos)continue;
      marker.position.set(pos.x,pos.y,pos.z);
      if(id==='hitbox'){
        marker.visible=c.hitbox.enabled;
        // Outer marker scale is authoritative so TransformControls scale-gizmo
        // edits can resize the hitbox, not only its numeric inputs.
        marker.scale.set(c.hitbox.size.x,c.hitbox.size.y,c.hitbox.size.z);
      }else if(id==='anchor'||id==='back'){
        const a=id==='back'?c.backCarry:c.billboardAnchor,r=a.rotation;
        marker.rotation.set(r.x*DEG,r.y*DEG,r.z*DEG,'XYZ');
        for(const child of marker.children)child.scale.setScalar(a.size);
      }else{
        const r=c.handTargets[id]?.rotation||{};
        handLocalEuler.set((Number(r.x)||0)*DEG,(Number(r.y)||0)*DEG,(Number(r.z)||0)*DEG,'XYZ');
        marker.quaternion.copy(handTurn[id]).multiply(handAbsolute.setFromEuler(handLocalEuler));
      }
    }
    updateBabyElbowGuides();
  }
  function select(id) {
    if((id==='baby'||elbowSide(id))&&!editingBaby)id='anchor';
    if(!guides[id])return;
    if(id==='anchor'||id==='back')babyPoseView=id; // The next Move/Rotate Baby edits the explicitly chosen held/back pose.
    else if(id==='left'||id==='right'||elbowSide(id))babyPoseView='anchor'; // Hand/elbow controls only operate while the baby is HELD in arms.
    state.selectedType='carry';
    state.selectedId=id;
    if(editingBaby)setBabyBones(!!el('carryBabyBones')?.checked); // Re-enable real paper arms after switching back from back-stow.
    babyPivotAxes.visible=id==='baby'; // Don't overlay an unrelated axis cross on hand/anchor editing.
    if(elbowSide(id))setBabyBones(true); // Elbow selection exposes the authoritative Attack Editor bone chain.
    transform.detach();
    transform.enabled=true;
    transform.visible=true;
    transform.setSpace?.('local'); // Rotation gizmo follows actual calibrated hand socket orientation.
    if(id==='baby')setTransformMode(babyTransformMode); // Select direct translation OR rotation without resetting the user's tool.
    else if(elbowSide(id))setTransformMode('translate'); // Shoulder-relative elbows are position-only in the Attack Editor.
    else if((transform.getMode?.()||'translate')==='scale')setTransformMode('translate');
    syncHoldingPreview();
    transform.attach(guides[id]);
    configureTransformAxesForSelection(); // Uses the shared gizmo rules and updates the mobile-readable frame label for this carry guide.
    renderControls();
    syncHoldingPreview();
  }
  function fromInputs() {
    const id=state.selectedType==='carry'?state.selectedId:'anchor';
    const side=elbowSide(id);
    if(side){
      const parts=['X','Y','Z'].map(axis=>Number(el('carry'+axis).value));
      if(parts.every(Number.isFinite)){
        state.carryable.elbows ||= {};
        state.carryable.elbows[side]={x:parts[0],y:parts[1],z:parts[2]}; // Same shoulder-relative data as Attack Editor elbow keyframes.
        updateBabyElbowGuides();syncHoldingPreview();renderControls();
      }
      return;
    }
    if(id==='baby'){
      const position=['X','Y','Z'].map(axis=>Number(el('carry'+axis).value));
      const angles=['X','Y','Z'].map(axis=>Number(el('carryR'+axis).value));
      if(position.every(Number.isFinite)&&angles.every(Number.isFinite)){
        authorBabyTranslation(new THREE.Vector3(...position));
        babyRotateProxy.quaternion.setFromEuler(babyEulerScratch.set(...angles.map(degrees=>degrees*DEG),'XYZ'));
        authorBabyRotation(babyRotateProxy.quaternion);
        syncHoldingPreview();renderControls();
      }
      return;
    }
    const point=positionGuide(id);
    if(!point)return;
    for(const axis of ['X','Y','Z']){
      const n=Number(el('carry'+axis).value);
      if(Number.isFinite(n))point[axis.toLowerCase()]=n;
    }
    const rotations=id==='anchor'?state.carryable.billboardAnchor.rotation:id==='back'?state.carryable.backCarry.rotation:state.carryable.handTargets[id]?.rotation;
    if(rotations)for(const axis of ['X','Y','Z']){
      const n=Number(el('carryR'+axis).value);
      if(Number.isFinite(n))rotations[axis.toLowerCase()]=n;
    }
    for(const axis of ['X','Y','Z']){
      const n=Number(el('carryHitboxS'+axis).value);
      if(Number.isFinite(n))state.carryable.hitbox.size[axis.toLowerCase()]=Math.max(.01,Math.abs(n));
    }
    if(id==='anchor'||id==='back')(id==='back'?state.carryable.backCarry:state.carryable.billboardAnchor).size=Math.max(.1,Math.min(10,Number(el('carrySize').value)||1));
    for(const axis of ['X','Y','Z']){
      const n=Number(el('carryPosterior'+axis).value);
      if(Number.isFinite(n))(id==='back'?state.carryable.backCarry:state.carryable.billboardAnchor).posteriorOffset[axis.toLowerCase()]=n;
    }
    for(const axis of ['X','Y','Z']){
      const n=Number(el('carryPortrait'+axis).value);
      if(id==='back'&&Number.isFinite(n))state.carryable.backCarry.portraitAnchor[axis.toLowerCase()]=n;
    }
    refreshGuides();
    syncHoldingPreview();
    if(!editingBaby)queueUndoHistory('carryable guide edit'); // Baby guide edits never overwrite furniture undo history.
    renderControls();
  }
  function fromGizmo() {
    if(activeEditorMode!=='carry'||state.selectedType!=='carry')return;
    const id=state.selectedId,marker=guides[id],point=positionGuide(id);
    const side=elbowSide(id);
    if(side){
      if((transform.getMode?.()||'translate')!=='translate'){setTransformMode('translate');return;}
      authorElbowFromMarker(side);
      syncHoldingPreview();renderControls();return;
    }
    if(id==='baby'){
      if((transform.getMode?.()||'translate')==='translate')authorBabyTranslation(babyRotateProxy.position);
      else if((transform.getMode?.()||'translate')==='rotate')authorBabyRotation(babyRotateProxy.quaternion);
      else{setTransformMode(babyTransformMode);syncHoldingPreview();return;}
      syncHoldingPreview();renderControls();
      return;
    }
    if(!marker||!point)return;
    for(const axis of ['x','y','z'])point[axis]=Number(marker.position[axis].toFixed(4));
    if(id==='hitbox'){
      for(const axis of ['x','y','z'])
        state.carryable.hitbox.size[axis]=Math.max(.01,Number(Math.abs(marker.scale[axis]).toFixed(4)));
    }else if(id==='anchor'||id==='back'){
      for(const axis of ['x','y','z'])
        (id==='back'?state.carryable.backCarry:state.carryable.billboardAnchor).rotation[axis]=Number((marker.rotation[axis]*180/Math.PI).toFixed(3));
    }else if(id==='left'||id==='right'){
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
  el('carryBabyBones').onchange=event=>setBabyBones(event.target.checked);
  for(const side of ['left','right']){
    const cap=side==='left'?'Left':'Right';
    el('carryBabyElbow'+cap).onclick=()=>select('elbow'+cap);
    el('carryBabyMid'+cap).onclick=()=>{
      if(!editingBaby)return;
      if(!previewHands){el('carryBabyElbowStatus').textContent='Load the carry preview before authoring a midpoint.';return;}
      setBabyBones(true);
      updateBabyElbowGuides();authorElbowFromMarker(side);syncHoldingPreview();renderControls();select('elbow'+cap);
    };
    el('carryBabyClear'+cap).onclick=()=>{
      if(!editingBaby)return;
      state.carryable.elbows[side]=null;syncHoldingPreview();renderControls();
    };
  }
  el('carryBabyMove').onclick=()=>{babyTransformMode='translate';select('baby');};
  el('carryBabyRotate').onclick=()=>{babyTransformMode='rotate';select('baby');};
  el('carrySelectAnchor').onclick=()=>select('anchor');
  el('carrySelectBack').onclick=()=>select('back');
  el('carrySelectLeft').onclick=()=>select('left');
  el('carrySelectRight').onclick=()=>select('right');
  el('carrySelectHitbox').onclick=()=>select('hitbox');
  el('carryHitboxEnabled').onchange=e=>{
    state.carryable.hitbox.enabled=!!e.target.checked;
    refreshGuides();renderControls();if(!editingBaby)queueUndoHistory('carryable hitbox toggle');
  };
  el('carryEnabled').onchange=event=>{
    state.carryable.enabled=!!event.target.checked;
    if(!editingBaby)queueUndoHistory('carryable toggle');
    renderControls();
  };
  for(const id of ['carryX','carryY','carryZ','carryRX','carryRY','carryRZ','carrySize','carryPosteriorX','carryPosteriorY','carryPosteriorZ','carryPortraitX','carryPortraitY','carryPortraitZ','carryHitboxSX','carryHitboxSY','carryHitboxSZ'])
    el(id).addEventListener('change',fromInputs);
  transform.addEventListener?.('objectChange',fromGizmo);

  function availableBabyIdentities() {
    // The portrait catalog and species gender support are authoritative; do not request invented NPC identities.
    const species=window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species||{};
    const fighters=window.getPortraitFighters?.()||[];
    const seen=new Set(),options=[];
    for(const fighter of fighters){
      const speciesId=String(fighter?.speciesId||'').replaceAll('_','-');
      const gender=String(fighter?.gender||(fighter?.id==='F'?'female':'male')).toLowerCase();
      if(!speciesId||!['male','female'].includes(gender)||!species[speciesId]?.genders?.includes(gender))continue;
      const key=speciesId+'::'+gender;
      if(!seen.has(key)){seen.add(key);options.push({speciesId,gender});}
    }
    return options;
  }
  async function randomBaby() {
    if(!editingBaby)return false;
    const preview=window.NpcAvatarPreview;
    if(!preview?.randomProfile||!preview?.renderProfileToCanvas){
      babyPreviewStatus='NPC portrait generator unavailable; the baby silhouette remains visible.';
      el('carryBabyStatus').textContent=babyPreviewStatus;
      log(babyPreviewStatus,'warn');
      return false;
    }
    const ticket=++babyRenderTicket; // A later click or exit makes an older async portrait harmless.
    const roll=++babyPreviewRolls; // Unique seeded appearance each click; grip values and save are never randomized.
    const button=el('carryBabyRandom');
    babyPreviewStatus='Generating baby #'+roll+'…';
    el('carryBabyStatus').textContent=babyPreviewStatus;
    button.disabled=true; // Avoid starting multiple expensive portrait renders on mobile.
    try{
      window.setPortraitAssetBase?.(window.HOBUNJI_ASSET_BASE); // Reuse the editor's existing GitHub sprite asset root even if Avatar mode was never opened.
      await preview.ensurePortraitCosmetics?.({assetBase:window.HOBUNJI_ASSET_BASE,configBase:window.HOBUNJI_CONFIG_BASE});
      if(ticket!==babyRenderTicket||!editingBaby)return false;
      const candidates=availableBabyIdentities();
      if(!candidates.length)throw new Error('No family-capable portrait species are loaded.');
      const identity=candidates[Math.floor(Math.random()*candidates.length)];
      const seed='furniture-carry-baby-'+roll+'-'+Math.floor(Math.random()*0xffffffff).toString(36);
      const profile=preview.randomProfile(seed,identity);
      if(!profile)throw new Error('The NPC portrait generator did not return a baby appearance.');
      const front=document.createElement('canvas'),back=document.createElement('canvas');
      front.width=back.width=200;front.height=back.height=200;
      await preview.renderProfileToCanvas(front,profile,{seatId:seed,breathingComposer:null});
      if(ticket!==babyRenderTicket||!editingBaby)return false;
      let backCanvas=null; // Only a successfully rendered back may replace the front's safe mirrored fallback.
      try{await preview.renderProfileToCanvas(back,profile,{portraitView:'behind',seatId:seed,breathingComposer:null});backCanvas=back;}
      catch(error){ // Keep the fully colored front portrait if behind art is unavailable.
        log('Baby back portrait unavailable: '+(error?.message||error),'warn');
      }
      if(ticket!==babyRenderTicket||!editingBaby)return false;
      const phase=window.HobunjiRomanceConfig?.family?.phaseScales?.basket||{body:.32,head:.50}; // Family config owns newborn proportions; fallback covers offline editor previews.
      const body=Number(phase.body)>0?Number(phase.body):.32;
      const head=Number(phase.head)>0?Number(phase.head):.50;
      const npcRecord={role:'child',tags:['child','family'],isChild:true,childGrowthStage:'baby',
        childBodyScale:body,childBodyHeightScale:body,childBodyWidthScale:Number(phase.width)||body,childHeadScale:head}; // Same infant proportions as RomanceFamily.childRecord.
      let model=null;
      if(window.PNGPlaneAvatar?.buildSinglePlaneAvatarModel){
        try{
          model=window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(THREE,front,{
            backCanvas,profile,speciesId:identity.speciesId,gender:identity.gender,
            appearance:{speciesId:identity.speciesId,gender:identity.gender},
            npcRecord,name:'furniture_random_baby_reference',modelWidth:.9,modelHeight:.9,neckRig:true,
          });
          const anatomy=window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[identity.speciesId+'::'+identity.gender]?.anatomy||{}; // Live authored full-rig overrides beat defaults.
          const defaults=window.HobunjiCharacterRigScaleDefaults?.scaleFor?.(identity.speciesId,identity.gender)||{x:1,y:1,head:1,offsetY:0};
          const valid=(value,fallback)=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):fallback;
          const bx=valid(anatomy.rigScaleX,valid(anatomy.rigScale,valid(defaults.x,1)));
          const by=valid(anatomy.rigScaleY,valid(anatomy.rigScale,valid(defaults.y,1)));
          const hs=valid(anatomy.headScale,valid(anatomy.rigScale,valid(defaults.head,1)));
          const headJoint=model?.userData?.neckRig?.headScaleJoint;
          const child = window.PNGPlaneAvatar.childScaleFor?.({speciesId:identity.speciesId,gender:identity.gender,npcRecord}); // Same baked species/gender baby proportions as the world portrait.
          headJoint?.scale?.set?.(hs/bx*(child?.headFactorX??head/body),hs/by*(child?.headFactor??head/body),1); // Same x/y head compensation as HobunjiCharacterRigScale.applyHeadCompensation.
          const offset=Number(anatomy.headOffsetY??defaults.offsetY);
          if(headJoint?.position && Number.isFinite(offset))
            headJoint.position.y+=Math.max(-.5,Math.min(.5,offset))*Number(model.userData?.portraitModelHeight||0); // Same authored head Y nudge as gameplay.
        }catch(error){
          log('Baby neck-rig preview failed; using its colored PNG plane instead: '+(error?.message||error),'warn');
        }
      }
      if(!model){ // The fallback uses the SAME newborn world width as the game, never a hardcoded .30 unit baby.
        const config=effectiveAvatarConfig(),speciesSize=config.portraitScaleBySpecies?.[identity.speciesId];
        const scale=Number(speciesSize&&typeof speciesSize==='object'
          ?speciesSize[identity.gender]??speciesSize.default:speciesSize);
        const fullWidth=(Number(config.worldModelWidth)||.9)*body*(Number.isFinite(scale)&&scale>0?scale:1);
        model=new THREE.Mesh(new THREE.PlaneGeometry(fullWidth,fullWidth),
          new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(front),transparent:true,alphaTest:.35,side:THREE.DoubleSide,depthWrite:false}));
        model.userData.portraitModelWidth=fullWidth;model.userData.portraitModelHeight=fullWidth;
      }
      model.traverse?.(child=>{if(child.isMesh){child.userData=child.userData||{};child.userData.noOutline=true;}}); // Baby portraits already contain ink; no generated shell.
      if(ticket!==babyRenderTicket||!editingBaby){disposeObject(model);return false;}
      const width=Math.max(.05,Number(model.userData?.portraitModelWidth)||BABY_REFERENCE_WIDTH);
      const height=Math.max(.05,Number(model.userData?.portraitModelHeight)||BABY_REFERENCE_HEIGHT);
      // Never inflate a Kenkari or other smaller newborn to .30 units: the PNGPlaneAvatar has ALREADY scaled the baby.
      const api=window.FamilyBabyCarryPose;
      const nextAnchors=api?.anchorsForAvatar?.(model.userData,width,height)||null; // Resolve the new baby's real neck/spine origins.
      if(api?.toProfile&&api?.applyFrom){
        const draft=api.toProfile(state.carryable,babyPortraitWidth,babyPortraitHeight,babyGripAnchors);
        api.applyFrom(state.carryable,draft,width,height,nextAnchors); // Keep grip-to-anatomy offsets, not painted pixel locations.
      }
      babyPortraitWidth=width;babyPortraitHeight=height;
      babyGripAnchors=nextAnchors;
      babyPortraitPlacementRatio=Number(model.userData?.portraitVerticalPlacementRatio)||.5;
      babyFrontCanvas=front; // Full painted source canvas for the direct 2D grip controls.
      model.position.y=height/2; // Match the original game avatar floor-origin placement, without a second scale pass.
      babyReference.add(model);
      if(babyPortraitModel){babyReference.remove(babyPortraitModel);disposeObject(babyPortraitModel);}
      babyPortraitModel=model;
      babyReferencePlane.visible=false;
      const label=identity.speciesId.replaceAll('-',' ')+' '+identity.gender;
      babyPreviewStatus='Baby #'+roll+' · '+label+' · '+width.toFixed(3)+' × '+height.toFixed(3)+' carrier-local portrait units · hand grips stay at the same U/V. Grips unchanged.';
      el('carryBabyStatus').textContent=babyPreviewStatus;
      log(babyPreviewStatus);
      refreshGuides();renderControls(); // Refresh the grip dots and Three.js markers to the real baby size.
      syncHoldingPreview();
      frameHoldingPreview();
      return true;
    }catch(error){
      if(ticket!==babyRenderTicket||!editingBaby)return false;
      babyPreviewStatus='Random Baby failed: '+(error?.message||error)+'. Previous preview kept.';
      el('carryBabyStatus').textContent=babyPreviewStatus;
      log(babyPreviewStatus,'warn');
      return false;
    }finally{
      if(ticket===babyRenderTicket)button.disabled=!editingBaby;
    }
  }
  function editBaby(){
    const pose=window.FamilyBabyCarryPose;
    if(!pose?.forSize){
      el('carryBabyStatus').textContent='Baby grip profile unavailable. Check the on-screen error log.';
      log('Baby grip profile failed to load.','error');
      return false;
    }
    if(editingBaby)return true;
    savedFurnitureCarry=state.carryable; // The existing furniture record is not mutated by baby grip editing.
    state.carryable=normalized(babyDraft||pose.forSize(babyPortraitWidth,babyPortraitHeight,babyGripAnchors)); // Use the current portrait dimensions if returning after a Random Baby roll.
    editingBaby=true;babyTransformMode='translate';root.visible=false;babyReference.visible=activeEditorMode==='carry';
    setBabyBones(!!el('carryBabyBones').checked);
    babyRotateProxy.visible=activeEditorMode==='carry';
    babyPoseView='anchor';createGuides();select('baby');setHoldingVisibility();frameHoldingPreview();
    if(!babyPortraitModel)void randomBaby(); // Show a real randomized child immediately, not an empty blue reference.
    return true;
  }
  function returnToFurniture(){
    if(!editingBaby)return;
    babyRenderTicket++; // Invalidate a queued NPC render before the visual/controls are restored.
    babyPointerId=null;babyPointerSide=null; // End any mobile grip drag when leaving baby mode.
    if(el('carryBabyCopyText'))el('carryBabyCopyText').hidden=true; // Don't leave the old infant JSON visible in furniture mode.
    babyDraft=cloneJson(state.carryable); // Keep incomplete mobile edits if the user revisits the baby tab.
    setBabyBones(false); // Existing hand solver's paper arm guides must never leak into furniture mode.
    state.carryable=savedFurnitureCarry;savedFurnitureCarry=null;editingBaby=false;
    root.visible=true;babyReference.visible=false;babyRotateProxy.visible=false;
    babyPoseFrame.position.set(0,0,0);babyPoseFrame.quaternion.identity();babyPoseFrame.scale.setScalar(1);
    createGuides();renderControls();setHoldingVisibility();
    el('carryBabyStatus').textContent='Furniture grips restored; baby settings are separate.';
  }
  function currentBabyProfile(){
    const api=window.FamilyBabyCarryPose; // All copy/download/apply actions use the same current unsaved baby draft.
    if(!api?.toProfile||!api?.snapshot)return null;
    return editingBaby?api.toProfile(state.carryable,babyPortraitWidth,babyPortraitHeight,babyGripAnchors):api.snapshot();
  }
  function applyBaby(){
    if(!editingBaby)return;
    const profile=currentBabyProfile();
    if(!profile)return;
    window.FamilyBabyCarryPose.save(profile); // Device-local authoring override, separate from the save game.
    el('carryBabyStatus').textContent='Baby grips applied on this device. Reload gameplay to load this pose; export JSON to ship it.';
  }
  function exportBaby(){
    const profile=currentBabyProfile();
    if(!profile)return;
    download('family-baby-carry-pose.json',new Blob([JSON.stringify(profile,null,2)+'\\n'],{type:'application/json'}));
    el('carryBabyStatus').textContent='Exported baby profile JSON. Paste its values into DEFAULT_PROFILE in config/family-baby-carry-pose.js for all players.';
  }
  async function copyBaby(){
    const profile=currentBabyProfile(); // Available directly from the Carryable pane, without switching to IO and losing the active draft.
    if(!profile)return false;
    const fallback=el('carryBabyCopyText');
    if(fallback)fallback.hidden=false; // Keep a mobile-visible manual-selection fallback when clipboard permission is blocked.
    const copied=await copyPlainTextWithFallback(JSON.stringify(profile,null,2),fallback,'Baby profile JSON');
    el('carryBabyStatus').textContent=copied
      ?'Current baby profile copied to clipboard.'
      :'Baby JSON is shown below for manual copying; no furniture data was substituted.';
    return copied;
  }
  const mainJsonButton=el('downloadJsonBtn'); // Existing header export switches meaning only while the isolated infant editor is active.
  const furnitureJsonLabel=mainJsonButton?.textContent||'Download JSON';
  const mainCopyButton=el('copyJsonBtn'); // Same baby/furniture mode switch for the IO clipboard action.
  const furnitureCopyLabel=mainCopyButton?.textContent||'Copy Current JSON';
  function syncBabyDownloadButton(){
    if(mainJsonButton)mainJsonButton.textContent=editingBaby?'Download Baby JSON':furnitureJsonLabel;
    if(mainCopyButton)mainCopyButton.textContent=editingBaby?'Copy Baby JSON':furnitureCopyLabel;
  }
  mainJsonButton?.addEventListener('click',event=>{
    if(!editingBaby)return; // Outside baby mode, preserve the original furniture exporter completely.
    event.preventDefault();event.stopImmediatePropagation();
    exportBaby(); // Prevent a second misleading furniture JSON from being downloaded at the same time.
  },true);
  mainCopyButton?.addEventListener('click',event=>{
    if(!editingBaby)return; // Outside baby mode, preserve the original furniture clipboard flow.
    event.preventDefault();event.stopImmediatePropagation();
    const profile=currentBabyProfile();
    if(!profile)return;
    void copyPlainTextWithFallback(JSON.stringify(profile,null,2),el('jsonText'),'Baby profile JSON');
    el('carryBabyStatus').textContent='Baby JSON copied (or selected in the JSON text area if clipboard access was blocked).';
  },true);
  el('carryBabyEdit').onclick=editBaby;
  el('carryBabyRandom').onclick=()=>{void randomBaby();};
  el('carryBabyReturn').onclick=returnToFurniture;
  el('carryBabyApply').onclick=applyBaby;
  el('carryBabyExport').onclick=exportBaby;
  el('carryBabyCopy').onclick=()=>{void copyBaby();};
  el('carryBabyImport').onchange=async event=>{
    const file=event.target.files?.[0];
    if(!file)return;
    try{
      if(file.size>100000)throw Error('Baby profile JSON is unexpectedly large.');
      const api=window.FamilyBabyCarryPose;
      if(!api?.save)throw Error('Shared baby pose module unavailable');
      api.save(JSON.parse(await file.text())); // Import is an explicit action; validate and persist on this device.
      babyDraft=null;
      if(editingBaby){state.carryable=normalized(api.forSize(babyPortraitWidth,babyPortraitHeight,babyGripAnchors));createGuides();renderControls();syncHoldingPreview();}
      el('carryBabyStatus').textContent='Imported and applied baby profile. Reload gameplay to see the new grips.';
    }catch(error){
      el('carryBabyStatus').textContent='Baby profile import failed: '+(error?.message||error);
      log('Baby profile import failed: '+(error?.message||error),'error');
    }finally{event.target.value='';}
  };
  const originalHistoryStatePayload=historyStatePayload; // Existing undo owner; baby drafts are not furniture database edits.
  historyStatePayload=function(...args){
    const payload=originalHistoryStatePayload(...args);
    if(editingBaby&&savedFurnitureCarry)payload.state.carryable=cloneJson(savedFurnitureCarry);
    return payload; // Native gizmo-end callbacks may still queue history: keep its serialized furniture source unchanged.
  };
  const originalRestoreHistoryPayload=restoreHistoryPayload; // An explicit furniture Undo/Redo should exit isolated baby authoring safely.
  restoreHistoryPayload=function(...args){
    if(editingBaby)returnToFurniture();
    return originalRestoreHistoryPayload(...args);
  };
  const originalExport=exportData;
  exportData=function(...args) {
    const data=originalExport(...args);
    data.carryable=cloneJson(editingBaby?savedFurnitureCarry:state.carryable); // No infant settings leak into exported furniture.
    return data;
  };
  const originalLoad=loadData;
  loadData=function(data){
    if(editingBaby)returnToFurniture();
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
    if(editingBaby)root.visible=false;
    createGuides();
    renderControls();
    setHoldingVisibility();
    return result;
  };
  const originalMode=setEditorMode;
  setEditorMode=function(mode){
    if(mode!=='carry'&&editingBaby)returnToFurniture();
    const result=originalMode(mode);
    pane.classList.toggle('hidden',mode!=='carry');
    guideRoot.visible=mode==='carry';
    babyReference.visible=mode==='carry'&&editingBaby;
    babyRotateProxy.visible=mode==='carry'&&editingBaby;
    document.querySelectorAll('[data-left-tab]').forEach(tab=>
      tab.classList.toggle('active',tab.dataset.leftTab===mode));
    if(mode==='carry')select('anchor'); // Furniture default; editBaby() selects the baby grip.
    setHoldingVisibility();
    if(mode==='carry')frameHoldingPreview();
    return result;
  };
  if(!button.onclick)button.addEventListener('click',()=>setEditorMode('carry')); // Only legacy pages without a core tab binding need a second listener.
  createGuides();
  renderControls();
  window.HobunjiCarryableFurnitureAuthor={
    normalize:normalized,
    snapshot:()=>({carryable:cloneJson(state.carryable),editingBaby,randomBabyCount:babyPreviewRolls,randomBabyStatus:babyPreviewStatus,storedFurnitureUnchanged:!!savedFurnitureCarry,babyProfile:window.FamilyBabyCarryPose?.snapshot?.()||null,selected:state.selectedType==='carry'?state.selectedId:null,backPreview:babyPoseIsBack(),preview:{visible:heldPreview.visible,ready:!!previewActor,hands:!!previewHands,source:previewSource,babyPoseView,babyPortraitWidth,babyPortraitHeight,babyGripAnchors,babyBoneView:!!el('carryBabyBones')?.checked,babyElbows:cloneJson(state.carryable?.elbows||{}),babyPortraitUV:false,infantWorldPosition:editingBaby?babyPoseFrame.position.toArray():null,infantWorldQuaternion:editingBaby?babyPoseFrame.quaternion.toArray():null,adultStationary:editingBaby}})
  };
  if(bootStatus)bootStatus.hidden=true; // Hide the pending notice only after the complete Carryable API is ready.
})();