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
    return {
      enabled:obj.enabled===true,
      billboardAnchor:{
        position:vector(pos,{x:0,y:.53,z:0}),
        rotation:vector(rot,{x:0,y:0,z:0}),
        size:Math.max(.1,Number(anchor.size)||1)
      },
      handTargets:{
        left:vector(hand.left,{x:-.3,y:.46,z:.08}),
        right:vector(hand.right,{x:.3,y:.46,z:.08})
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
    '<p class="muted">The square is the invisible 1×1 held-item billboard anchor. Move/rotate it to define how the 3D object hangs against the character. Blue and green points are the actual procedural hand attachment targets. Guides never render in-game.</p>',
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
    '<p class="muted">Anchor plane orientation (degrees)</p>',
    '<div class="g3">',
    '<label>Pitch<input id="carryRX" type="number" step="1"></label>',
    '<label>Yaw<input id="carryRY" type="number" step="1"></label>',
    '<label>Roll<input id="carryRZ" type="number" step="1"></label>',
    '</div><label>Billboard size <input id="carrySize" type="number" min="0.1" max="10" step="0.05"></label>',
    '</div>',
    '<p class="muted">Use the translate / rotate gizmos in the viewport, or type exact values here. Export JSON saves these markers as carryable.billboardAnchor and carryable.handTargets.</p>',
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
    el('carryAnchorRotation').hidden=id!=='anchor';
    if(id==='anchor') {
      const r=c.billboardAnchor.rotation;
      for(const axis of ['X','Y','Z']){
        const input=el('carryR'+axis);
        if(document.activeElement!==input)input.value=Number(r[axis.toLowerCase()]||0).toFixed(2);
      }
      if(document.activeElement!==el('carrySize'))el('carrySize').value=c.billboardAnchor.size;
    }
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
        const mesh=new THREE.Mesh(new THREE.SphereGeometry(.045,12,8),
          new THREE.MeshBasicMaterial({color:id==='left'?0x66aaff:0x69ffaa,depthTest:false}));
        marker.add(mesh);
      }
      guideRoot.add(marker);
      guides[id]=marker;
    }
    refreshGuides();
  }
  function refreshGuides() {
    const c=state.carryable;
    for(const id of ['anchor','left','right']){
      const marker=guides[id],pos=positionGuide(id);
      if(!marker||!pos)continue;
      marker.position.set(pos.x,pos.y,pos.z);
      if(id==='anchor'){
        const r=c.billboardAnchor.rotation;
        marker.rotation.set(r.x*Math.PI/180,r.y*Math.PI/180,r.z*Math.PI/180);
        for(const child of marker.children)child.scale.setScalar(c.billboardAnchor.size);
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
    transform.setSpace?.('world');
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
    if(id==='anchor'){
      for(const axis of ['X','Y','Z']){
        const n=Number(el('carryR'+axis).value);
        if(Number.isFinite(n))state.carryable.billboardAnchor.rotation[axis.toLowerCase()]=n;
      }
      state.carryable.billboardAnchor.size=Math.max(.1,Math.min(10,Number(el('carrySize').value)||1));
    }
    refreshGuides();
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
    }
    renderControls();
  }
  el('carrySelectAnchor').onclick=()=>select('anchor');
  el('carrySelectLeft').onclick=()=>select('left');
  el('carrySelectRight').onclick=()=>select('right');
  el('carryEnabled').onchange=event=>{
    state.carryable.enabled=!!event.target.checked;
    queueUndoHistory('carryable toggle');
    renderControls();
  };
  for(const id of ['carryX','carryY','carryZ','carryRX','carryRY','carryRZ','carrySize'])
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
    return result;
  };
  const originalRebuild=rebuildAll;
  rebuildAll=function(...args){
    const result=originalRebuild(...args);
    createGuides();
    renderControls();
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
    return result;
  };
  button.addEventListener('click',()=>setEditorMode('carry'));
  createGuides();
  renderControls();
  window.HobunjiCarryableFurnitureAuthor={
    normalize:normalized,
    snapshot:()=>({carryable:cloneJson(state.carryable),selected:state.selectedType==='carry'?state.selectedId:null})
  };
})();