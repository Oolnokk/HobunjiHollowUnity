// Omgurku hybrid calibration. Uses the very same PNGPlaneAvatar wrapper as NPC gameplay.
// Does not instantiate a second NPC, animal actor, walker or alternate art renderer.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const specs = [
    { key:'saddleU', label:'Saddle X (posterior → nose)', min:0, max:1, step:.001, group:'saddleFields' },
    { key:'saddleV', label:'Saddle Y (top → bottom)', min:0, max:1, step:.001, group:'saddleFields' },
    { key:'riderScale', label:'Upper-body scale', min:.5, max:1.5, step:.005, group:'upperFields' },
    { key:'joinDepth', label:'Join depth', min:-.35, max:.35, step:.005, group:'upperFields' },
    { key:'lowerWidth', label:'Lower body width', min:.4, max:5, step:.01, group:'lowerFields' },
    { key:'lowerDeadzoneDegrees', label:'Lower-half deadzone (degrees)', min:0, max:89, step:.5, group:'lowerFields' },
    { key:'lowerHeight', label:'Lower body height', min:.2, max:3, step:.005, group:'lowerFields' },
    { key:'visibleFloorCorrection', label:'Visible floor correction', min:-.75, max:1.5, step:.005, group:'lowerFields' },
    ...['upper','lower'].flatMap(half => ['X','Y','Z'].map(axis => ({
      key:half+'Offset'+axis, label:half+' offset '+axis, min:-1.5, max:1.5, step:.005, group:'offsetFields',
    }))),
  ];
  const state = {
    speciesConfig:null, placement:null, THREE:null, model:null, scene:null, camera:null, renderer:null,
    controls:null, grid:null, image:null, npcs:[], moving:false, elapsed:0, lastTime:0,
    profile:null, built:false, lastError:null,
  };
  function feedback(message, error = false) {
    const el = $('feedback'); el.textContent = message; el.classList.toggle('error', error);
  }
  function copyJSON(value) { return JSON.stringify(value, null, 2) + '\n'; }
  function fillFields() {
    for (const s of specs) {
      const wrap=document.createElement('div'); wrap.className='slid';
      const label=document.createElement('label'); label.htmlFor='range_'+s.key;
      label.textContent=s.label;
      const slider=document.createElement('input');
      slider.id='range_'+s.key; slider.type='range';
      slider.min=s.min; slider.max=s.max; slider.step=s.step; slider.value=state.placement[s.key];
      const number=document.createElement('input');
      number.id='number_'+s.key; number.type='number'; number.min=s.min; number.max=s.max;
      number.step=s.step; number.value=state.placement[s.key];
      const update=value=>{
        const n=Number(value); if(!Number.isFinite(n)) return;
        state.placement[s.key]=clamp(n,s.min,s.max);
        slider.value=String(state.placement[s.key]);
        number.value=String(state.placement[s.key]);
        applyPlacement();
      };
      slider.addEventListener('input',()=>update(slider.value));
      number.addEventListener('change',()=>update(number.value));
      wrap.append(label,slider,number);$(s.group).append(wrap);
    }
  }
  function syncFields() {
    for(const s of specs){
      const val=state.placement[s.key];
      $('range_'+s.key).value=String(val);
      $('number_'+s.key).value=String(val);
    }
    drawSaddleSprite();
  }
  function applyPlacement() {
    const runtime=window.HobunjiOmgurkuSpecies;
    if (!runtime) { feedback('Omgurku runtime not initialized',true); return; }
    state.placement=runtime.setPlacement(state.placement);
    drawSaddleSprite();
    if(state.model && !state.model.userData?.omgurkuComposite)
      feedback('Preview is not an Omgurku composite — see Diagnostics',true);
  }
  function drawSaddleSprite(){
    const canvas=$('spriteCanvas'),ctx=canvas.getContext('2d'),img=state.image;
    const cw=canvas.width,ch=canvas.height;
    ctx.clearRect(0,0,cw,ch);
    ctx.fillStyle='#09121e';ctx.fillRect(0,0,cw,ch);
    let left=0,top=0,w=cw,h=ch;
    if (img?.naturalWidth) {
      const scale=Math.min(cw/img.naturalWidth,ch/img.naturalHeight);
      w=img.naturalWidth*scale;h=img.naturalHeight*scale;
      left=(cw-w)/2;top=(ch-h)/2;
      ctx.imageSmoothingEnabled=false;ctx.drawImage(img,left,top,w,h);
    } else {
      ctx.fillStyle='#b5cce2';ctx.font='16px system-ui';ctx.fillText('Loading lower body sprite…',16,ch/2);
    }
    state.spriteBounds={left,top,w,h};
    if(!state.placement)return;
    const x=left+state.placement.saddleU*w, y=top+state.placement.saddleV*h;
    ctx.lineWidth=3;ctx.strokeStyle='#031622';
    ctx.beginPath();ctx.moveTo(x-13,y);ctx.lineTo(x+13,y);ctx.moveTo(x,y-13);ctx.lineTo(x,y+13);ctx.stroke();
    ctx.lineWidth=1.8;ctx.strokeStyle='#64f8ff';ctx.beginPath();
    ctx.moveTo(x-13,y);ctx.lineTo(x+13,y);ctx.moveTo(x,y-13);ctx.lineTo(x,y+13);ctx.stroke();
    ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.stroke();
  }
  function placeSaddle(event){
    if(!state.placement)return;
    const rect=$('spriteCanvas').getBoundingClientRect(), b=state.spriteBounds;
    if(!b)return;
    const x=(event.clientX-rect.left)*$('spriteCanvas').width/rect.width;
    const y=(event.clientY-rect.top)*$('spriteCanvas').height/rect.height;
    state.placement.saddleU=clamp((x-b.left)/b.w,0,1);
    state.placement.saddleV=clamp((y-b.top)/b.h,0,1);
    applyPlacement();syncFields();
  }
  function wireSaddle(){
    const canvas=$('spriteCanvas');
    canvas.addEventListener('pointerdown',ev=>{
      canvas.setPointerCapture(ev.pointerId);placeSaddle(ev);
    });
    canvas.addEventListener('pointermove',ev=>{ if(canvas.hasPointerCapture(ev.pointerId))placeSaddle(ev); });
  }
  function speciesDocument() {
    if (!state.speciesConfig) throw new Error('Species config has not loaded.');
    // The exported file is drop-in ready for config/species/omgurku.json.
    return { ...state.speciesConfig, hybridPlacement:{ ...state.placement },
      // The authored JSON references the PNG path; the actual uploaded image
      // is downloaded separately, never embedded as a multi-MB data URL.
      connector:window.HobunjiOmgurkuConnectorAuthor?.exportConfig?.()
        || window.HobunjiOmgurkuConnector?.snapshot?.()
        || state.speciesConfig.connector };
  }
  function download(value,filename){
    const url=URL.createObjectURL(new Blob([copyJSON(value)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);
    a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importSettings(file){
    if(!file)return;
    try{
      const data=JSON.parse(await file.text());
      // Supports V10's saddle/join snapshot, as well as our complete species config.
      let settings=data.hybridPlacement || data.placement || data;
      if(data.saddle && data.join){
        settings={
          saddleU:data.saddle.u, saddleV:data.saddle.v,
          joinDepth:data.join.joinDepth, riderScale:data.join.riderScale,
          lowerWidth:data.creaturePlacement?.modelWidth,
          lowerHeight:data.creaturePlacement?.modelHeight,
          visibleFloorCorrection:data.creaturePlacement?.previewVisibleFloorCorrection,
        };
      }
      if(!settings || typeof settings!=='object' || (!Object.hasOwn(settings,'saddleU') && !Object.hasOwn(settings,'lowerWidth')))
        throw new Error('Expected a hybridPlacement object or V10 saddle/join JSON.');
      const next={...state.placement};
      for(const spec of specs){
        const n=Number(settings[spec.key]);
        if(settings[spec.key]!==undefined && Number.isFinite(n))next[spec.key]=clamp(n,spec.min,spec.max);
      }
      if (data.connector) {
        const bridge=window.HobunjiOmgurkuConnector; // Validate before changing either part of a full species import.
        if(data.connector.schema!==bridge.schema || ['sourceTop','sourceBottom','animalNeck']
          .some(key=>!bridge.validateFivePointSpline(data.connector[key])))
          throw new Error('Invalid connector rig in species JSON.');
        window.HobunjiOmgurkuConnectorAuthor.importConfig(data.connector);
      }
      state.placement=next;applyPlacement();syncFields();
      feedback('Imported '+file.name+'; preview updated. Save locally or export to retain changes.');
    }catch(error){feedback('Import failed: '+error.message,true);}
  }
  function setCam(view='angle') {
    if(!state.camera)return;
    const p={
      front:[3.6,1.7,0],side:[0,1.7,4.3],back:[-3.6,1.7,0],angle:[3.6,2.1,4.4],
    }[view] || [3.6,2.1,4.4];
    state.camera.position.set(...p);
    state.controls?.target.set(0,.75,0);state.controls?.update();
    state.camera.lookAt(0,.75,0);
  }
  function resize(){
    if(!state.renderer)return;
    const r=$('viewport').getBoundingClientRect();
    const w=Math.max(1,Math.floor(r.width)),h=Math.max(1,Math.floor(r.height));
    state.renderer.setSize(w,h,false);state.camera.aspect=w/h;state.camera.updateProjectionMatrix();
  }
  function tick(now){
    const dt=Math.min(.05,(now-(state.lastTime||now))/1000);state.lastTime=now;
    if(state.moving && state.model){
      state.elapsed+=dt;
      // Move only the preview root: the SAME 100 ms gameplay gaitTick selects run1/run2.
      const t=(state.elapsed*.8)%2;
      state.model.position.x=(t<1?t:2-t)*.5-.25;
    }else if(state.model)state.model.position.x=0;
    state.controls?.update();
    window.HobunjiOmgurkuWeaponPreview?.update(dt);
    window.RuntimeFrameScheduler.checkpoint('pre-render'); // Drives the same procedural idle/grip hand phase as gameplay.
    if(state.renderer){resizeOnChange();state.renderer.render(state.scene,state.camera);}
    const frame=state.model?.userData?.omgurkuComposite?.frame || 'unavailable';
    if($('frameBadge').textContent!==frame)$('frameBadge').textContent=frame;
  }
  let lastSize='';
  function resizeOnChange(){
    const r=$('viewport').getBoundingClientRect(),key=Math.round(r.width)+'x'+Math.round(r.height);
    if(key!==lastSize){lastSize=key;resize();}
  }
  async function initThree(){
    const modules=await window.PNGPlaneAvatar.loadThreeModules();
    state.THREE=modules.THREE;
    const THREE=state.THREE;
    state.renderer=new THREE.WebGLRenderer({canvas:$('viewport'),antialias:true,alpha:false});
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    state.renderer.outputColorSpace=THREE.SRGBColorSpace;
    state.scene=new THREE.Scene();state.scene.background=new THREE.Color(0x060e18);
    state.camera=new THREE.PerspectiveCamera(45,1,.01,100);
    state.scene.add(new THREE.HemisphereLight(0xffffff,0x182536,1.8));
    const light=new THREE.DirectionalLight(0xffffff,1.1);light.position.set(3,5,4);state.scene.add(light);
    state.grid=new THREE.GridHelper(5,10,0x305076,0x182739);state.grid.position.y=-.17;
    state.scene.add(state.grid);
    if(modules.OrbitControls){
      state.controls=new modules.OrbitControls(state.camera,$('viewport'));
      state.controls.enableDamping=true;state.controls.dampingFactor=.08;
      state.controls.enablePan=true;
    }
    setCam('angle');
    resize();
    // PerpRotation is the gameplay's one shared NPC+animal deadzone solver.
    // It requires the loaded THREE module and angleDiff during initialization.
    window.THREE = THREE;
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='../../js/perp-rotation.js?v=20261026h5e2a9c4';
      script.onload=resolve;
      script.onerror=()=>reject(new Error('Could not load shared gameplay PerpRotation'));
      document.head.append(script);
    });
    window.PerpRotation.init({angleDiff:(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b))});
    window.RuntimeFrameScheduler.setFrameDriver(context=>tick(context.timestamp)); // One clock owns preview animation and the hand-driver checkpoint.
  }
  function getAppearanceRecord(){
    const idx=Number($('npcSelect').value);
    const source=$('npcSelect').value!=='' ? state.npcs[idx]:null;
    const raw=source?.avatarEditor?.rawExport || {};
    const prev=source?.appearance||raw.appearance||{};
    const cosmetics={...prev.cosmetics,hat:'none',hood:'none',hairFront:'none',hairBack:'none',hairSide:'none',hairSideL:'none'};
    return {
      ...(source||{}), id:source?.id||'omgurku-calibration-preview',
      name:source?.name||'Omgurku (calibration preview)',
      appearance:{...prev,speciesId:'omgurku',gender:'male',cosmetics},
    };
  }
  async function rebuildPreview(){
    if(!state.THREE)return;
    const button=$('refreshPreviewBtn');button.disabled=true;
    try{
      const npc=getAppearanceRecord();
      const utils=window.NpcAvatarPreview;
      const profile=utils.buildProfileFromNpcExport(npc)||
        utils.randomProfile('omgurku-calibration', {speciesId:'omgurku',gender:'male'});
      if(!profile)throw new Error('Could not build Omgurku portrait profile from species config.');
      const size=Number(window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.previewPortraitCanvasSize)||200;
      const front=document.createElement('canvas');front.width=front.height=size;
      const back=document.createElement('canvas');back.width=back.height=size;
      await utils.renderProfileToCanvas(front,profile,{seatId:'omgurku-calibration'});
      await utils.renderProfileToCanvas(back,profile,{seatId:'omgurku-calibration',portraitView:'behind'});
      const pctx=$('portrait').getContext('2d');
      pctx.clearRect(0,0,200,200);pctx.drawImage(front,0,0,200,200);
      const next=window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(state.THREE,front,{
        backCanvas:back,profile,appearance:npc.appearance,npcRecord:npc,
        modelWidth:.9,modelHeight:.9,name:'Omgurku_Calibration_NPC',
        userData:{source:'omgurku-calibration',npcId:npc.id},
      });
      if(!next?.userData?.omgurkuComposite){
        window.PNGPlaneAvatar.disposeAvatarModel(next);
        throw new Error('Gameplay Omgurku composite did not build: '+
          (window.HobunjiOmgurkuSpecies?.debugSnapshot()?.lastError||'no Omgurku hybrid wrapper'));
      }
      if(state.model){
        window.HobunjiOmgurkuWeaponPreview.unbind();
        const old=state.model;state.scene.remove(old);
        window.PNGPlaneAvatar.disposeAvatarModel(old);
      }
      state.scene.add(next);state.model=next;state.profile=profile;
      window.HobunjiOmgurkuWeaponPreview.bind(state.THREE,next);
      window.HobunjiOmgurkuConnectorAuthor?.previewReady?.();
      window.HobunjiOmgurkuSpecies.setPreviewFacing(next,Number($('headingRange').value)*Math.PI/180);
      state.built=true;
      applyPlacement();
      $('stagebadge').textContent='Omgurku NPC · Engh-Sho upper + headless Omgurku quadruped';
      feedback('Preview rebuilt from the gameplay hybrid renderer.');
      diagnostics();
    }catch(error){
      state.lastError=String(error.stack||error);
      $('stagebadge').textContent='Preview error — see Diagnostics';
      feedback('Preview failed: '+error.message,true);diagnostics();
    }finally{button.disabled=false;}
  }
  function diagnostics(){
    $('diagnostics').textContent=copyJSON({
      preview:{built:state.built,scene:!!state.scene,three:!!state.THREE,profileSpecies:state.profile?.fighter?.speciesId,
        error:state.lastError, frame:state.model?.userData?.omgurkuComposite?.frame},
      weapon:window.HobunjiOmgurkuWeaponPreview?.snapshot(),
      runtime:window.HobunjiOmgurkuSpecies?.debugSnapshot?.()||null,
      facing:{mode:window.PerpRotation?.CREATURE_PLANE_ROT_MODE,
        npcDeadzoneDegrees:(window.PerpRotation?.PERP_DEAD_RAD||0)*180/Math.PI,
        animalDeadzoneDegrees:state.placement?.lowerDeadzoneDegrees,
        requestedHeadingDegrees:Number($('headingRange').value)},
      placement:state.placement,
    });
  }
  function hookControls(){
    for (const view of ['front','side','back','angle'])
      $(view+'Btn').addEventListener('click',()=>setCam(view));
    $('resetCameraBtn').addEventListener('click',()=>setCam('angle'));
    $('moveBtn').addEventListener('click',()=>{
      state.moving=!state.moving;state.elapsed=0;
      $('moveBtn').textContent=state.moving?'■ Stop':'▶ Run';
      $('moveBtn').setAttribute('aria-pressed',String(state.moving));
    });
    $('refreshPreviewBtn').addEventListener('click',rebuildPreview);
    $('npcSelect').addEventListener('change',rebuildPreview);
    $('headingRange').addEventListener('input',()=>{
      const degrees=Number($('headingRange').value);
      $('headingValue').textContent=degrees+'°';
      if(state.model) window.HobunjiOmgurkuSpecies?.setPreviewFacing?.(state.model,degrees*Math.PI/180);
    });
    $('saveLocalBtn').addEventListener('click',()=>{
      try{
        state.placement=window.HobunjiOmgurkuSpecies.saveLocalPlacement(state.placement);
        feedback('Applied. Reload the game at this same origin to see the calibrated Omgurku.');
        diagnostics();
      }catch(e){feedback('Local save failed: '+e.message,true);}
    });
    $('resetBtn').addEventListener('click',()=>{
      window.HobunjiOmgurkuSpecies.clearLocalPlacement();
      state.placement={...state.speciesConfig.hybridPlacement};
      applyPlacement();syncFields();feedback('Restored authored species placement; local override cleared.');
    });
    $('downloadBtn').addEventListener('click',()=>download(speciesDocument(),'omgurku.json'));
    $('copyBtn').addEventListener('click',async()=>{
      try{
        await navigator.clipboard.writeText(copyJSON(speciesDocument()));
        feedback('Copied complete species JSON.');
      }catch(e){feedback('Copy unavailable: use Download instead ('+e.message+')',true);}
    });
    $('importBtn').addEventListener('click',()=>$('fileInput').click());
    $('fileInput').addEventListener('change',ev=>{
      importSettings(ev.target.files?.[0]);ev.target.value='';
    });
    $('refreshDiagnostics').addEventListener('click',diagnostics);
    wireSaddle();
  }
  async function loadNpcSources(){
    try{
      const response=await fetch('../../config/npcs/hobunji-starter-npc-database.json');
      if(!response.ok)throw Error('HTTP '+response.status);
      const db=await response.json();
      const list=Array.isArray(db)?db:['npcs','records','characters','entries']
        .map(key=>db[key]).find(Array.isArray)||[];
      state.npcs=list.filter(Boolean);
      state.npcs.forEach((npc,i)=>{
        const option=document.createElement('option');option.value=String(i);
        option.textContent=(npc.name||npc.label||npc.id||'NPC '+(i+1))+' — as Omgurku';
        $('npcSelect').append(option);
      });
    }catch(error){feedback('Optional NPC database could not load: '+error.message,true);}
  }
  async function start(){
    hookControls();
    try{
      await window.HobunjiHandRuntimeReady;
      if(!window.HobunjiOmgurkuSpecies)throw Error('Omgurku runtime script did not load from attachment-rig bootstrap.');
      await window.HobunjiOmgurkuSpecies.ready;
      const response=await fetch('../../config/species/omgurku.json');
      if(!response.ok)throw Error('Species JSON HTTP '+response.status);
      state.speciesConfig=await response.json();
      const runtime=window.HobunjiOmgurkuSpecies;
      state.placement={...runtime.debugSnapshot().placement};
      fillFields();
      const img=new Image();
      img.crossOrigin='anonymous'; // The connector author draws this sprite into a canvas.
      img.onload=()=>{state.image=img;drawSaddleSprite();
        window.HobunjiOmgurkuConnectorAuthor?.previewReady?.();};
      img.onerror=()=>feedback('Lower idle sprite failed to load.',true);
      img.src='../../assets/creaturesprites/omgurku-lower_idle.png';
      await window.NpcAvatarPreview.ensurePortraitCosmetics({
        assetBase:new URL('../../assets/',location.href).href,
        configBase:new URL('../../config/',location.href).href,
      });
      await window.HobunjiOmgurkuWeaponPreview.init();
      await initThree();
      await loadNpcSources();
      await rebuildPreview();
      window.addEventListener('resize',resize);
    }catch(error){
      state.lastError=String(error.stack||error);
      $('stagebadge').textContent='Calibration load failed — Diagnostics';
      feedback('Initialization failed: '+error.message,true);
      diagnostics();
      console.error('[omgurku-calibration]',error);
    }
  }
  // Small stable diagnostics interface for automation and mobile remote QA.
  window.HobunjiOmgurkuCalibration={
    snapshot:()=>({ placement:{...state.placement}, hasComposite:!!state.model?.userData?.omgurkuComposite,
      frame:state.model?.userData?.omgurkuComposite?.frame, error:state.lastError }),
    context:()=>({model:state.model,image:state.image}), // Shared author preview and browser diagnostics.
    setPlacement:changes=>{state.placement={...state.placement,...changes};applyPlacement();syncFields();},
  };
  start();
})();