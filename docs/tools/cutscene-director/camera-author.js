// Camera authoring and playback use the Director's existing renderer and shared cinematic owner.
(() => {
  'use strict';
  function create({state,save,localToWorld,worldToLocal,toast}) {
    const T = window.THREE, runtime = window.CinematicCameraRuntime; // Shared rendering and persistent shot selection APIs.
    const three = state.three, $ = id => document.getElementById(id); // Director renderer and panel element lookup.
    let selected = '', endpoint = 'position', dragging = false, inspecting = false; // Selected shot/handle and temporary look-through state.
    let savedView = null; // Free author view restored after looking through a shot.
    const group = new T.Group(), handle = new T.Object3D(); // Camera markers and the selected transform-control anchor.
    three.scene.add(group,handle);
    const lookPoint = three.controls.target.clone(); // Current actual aim retained as the start of a camera blend.
    const blend = runtime.createBlendController({camera:three.camera,lookPoint}); // Same interpolation owner used by the live game.
    const gizmo = T.TransformControls ? new T.TransformControls(three.camera,three.renderer.domElement) : null; // Touch-capable world-axis handles for camera and aim-point translation.
    if (gizmo) { three.scene.add(gizmo); gizmo.setMode('translate'); gizmo.setSize(.8); }

    const panel = document.createElement('section'); // Visible camera controls next to the preview rather than buried in cinematic JSON.
    panel.id = 'sceneCameraPanel';
    panel.style.cssText = 'position:absolute;left:8px;top:8px;z-index:5;width:min(290px,calc(100% - 16px));max-height:70%;overflow:auto;background:#101c2fee;border:1px solid #678;padding:10px;border-radius:8px';
    panel.innerHTML = `<details open><summary>Scene cameras</summary><label>Shot<select id="sceneCameraSelect"></select></label><div style="display:flex;gap:5px;flex-wrap:wrap"><button id="sceneCameraLook">Look through</button><button id="sceneCameraUseView">Use current view</button><button id="sceneCameraReturn">Return to author view</button></div><label>Transform handle<select id="sceneCameraEndpoint"><option value="position">Camera position</option><option value="target">Look-at point</option><option value="none">Hide handles</option></select></label><div id="sceneCameraNumbers"></div><label>FOV<input id="sceneCameraFov" type="number" min="10" max="120" step="1"></label><label>Blend seconds<input id="sceneCameraBlend" type="number" min="0" step=".1"></label><div id="sceneCameraStatus" style="font-size:12px;margin-top:5px"></div><p style="font-size:12px">Select a shot, then drag its position or look-at handles. Orbit to compose a view and use “Use current view” to save it. NPC-relative aim fields are offsets from that character’s face.</p></details>`;
    $('viewport-wrap').appendChild(panel);
    const toggle = document.createElement('button'); // Mobile users can hide the panel to regain the full preview.
    toggle.id='sceneCamerasToggle';toggle.textContent='🎥 Scene cameras';toggle.className='small';$('captureCameraBtn').after(toggle);
    toggle.onclick=()=>{panel.hidden=!panel.hidden;group.visible=!panel.hidden&&!state.preview.running;};

    function entries() {
      const p = state.project, list = []; // Current project references; edits update their actual export records.
      if (p.camera3d) list.push({key:'captured',label:'Captured establishing view',camera:p.camera3d,local:true});
      if (p.cinematicCamera) list.push({key:'scene',label:p.cinematicCamera.label||'Scene cinematic camera',camera:p.cinematicCamera});
      const source = state.mapMeta.raw?.cinematicCameras || p.repoMap?.cinematicCameras || []; // Loaded map cameras remain editable as per-project overrides.
      if (!p.cinematicCameras && source.length) p.cinematicCameras=JSON.parse(JSON.stringify(source));
      for (const c of p.cinematicCameras || []) list.push({key:'map:'+c.id,label:c.label||c.id,camera:c});
      for (const st of p.stages) {
        if (st.camera) list.push({key:'stage:'+st.id,label:'Card '+st.id,camera:st.camera,stage:st});
        else if (['pov','follow','npcRelative'].includes(st.cameraMode)) list.push({key:'stage:'+st.id,label:st.cameraMode+' · '+st.id,stage:st,procedural:true});
      }
      return list;
    }
    function current() { return entries().find(e=>e.key===selected); }
    function actor(id) { return state.actorObjects.get(id); }
    function face(id) { const a=actor(id);return a ? {x:a.root.position.x,y:a.root.position.y+(a.avatarHeight||1)*.85,z:a.root.position.z}:null; }
    function targetWorld(c) {
      const id=c.targetNpcId; // Fixed or live NPC-relative camera aim.
      const def=id && state.project.actors.find(a=>a.npcId===id); // Maps the real NPC id to its preview actor.
      const f=def && face(def.id); // Resolved live face for relative aim handles.
      return f ? {x:f.x+(c.target?.x||0),y:f.y+(c.target?.y||0),z:f.z+(c.target?.z||0)} : (c.target||{x:0,y:.8,z:0});
    }
    function toWorld(point) { const w=localToWorld(point.x,point.z);return {x:w.c,y:point.y,z:w.r}; }
    function toLocal(point) { const w=worldToLocal(point.x,point.z);return {x:w.c,y:point.y,z:w.r}; }
    function resolveEntry(e) {
      if (e.procedural) return proceduralShot(e.stage);
      const c=e.camera; // Fixed camera or captured scene-local view.
      return e.local ? {id:'director_establishing',position:toWorld(c.localPos),target:toWorld(c.localTarget),fovDeg:c.fovDeg||42,blendSeconds:c.blendSeconds??.45} : c;
    }
    function proceduralShot(st) {
      const source=st.actorId||st.speakerId, target=st.targetActorId||st.addressedActorId; // Same POV source and target bindings as gameplay.
      const offset=st.cameraOffset||{x:0,y:5,z:8}; // Follow camera's editable world offset.
      const targetProvider=()=>face(target||source)||{x:Number(st.targetWorld?.c||0)+.5,y:Number(st.targetWorld?.y??.8),z:Number(st.targetWorld?.r||0)+.5};
      const positionProvider=()=>{
        if (st.cameraMode==='follow') { const ids=st.followActorIds||[source],sum={x:0,y:.6,z:0};for(const id of ids){const a=actor(id);if(a){sum.x+=a.root.position.x/ids.length;sum.y+=a.root.position.y/ids.length;sum.z+=a.root.position.z/ids.length;}}return {x:sum.x+offset.x,y:sum.y+offset.y,z:sum.z+offset.z}; }
        const f=face(source)||{x:0,y:1,z:0},t=targetProvider(),yaw=Math.atan2(t.x-f.x,t.z-f.z); // Face-relative shoulder view follows its live target.
        if(st.cameraMode==='npcRelative')return{x:f.x+3,y:f.y+.5,z:f.z+3};
        return {x:f.x-Math.sin(yaw)*(st.povBack||0)+Math.cos(yaw)*(st.povSide||0),y:f.y+(st.povHeight||0),z:f.z-Math.cos(yaw)*(st.povBack||0)-Math.sin(yaw)*(st.povSide||0)};
      };
      return {id:`director_${st.cameraMode}_${source}_${target||''}`,shotKey:JSON.stringify([st.povBack,st.povSide,st.povHeight,st.targetWorld,offset,st.followActorIds]),positionProvider,targetProvider:st.cameraMode==='follow'?()=>{const p=positionProvider();return{x:p.x-offset.x,y:p.y-offset.y,z:p.z-offset.z};}:targetProvider,fovDeg:st.fovDeg||65,blendSeconds:st.blendSeconds??.35};
    }
    function clearMarkers() {
      for(const child of [...group.children]){child.traverse(n=>{n.geometry?.dispose();if(n.material){for(const m of Array.isArray(n.material)?n.material:[n.material])m.dispose();}});group.remove(child);}
    }
    function markers() {
      clearMarkers();
      for(const e of entries()){
        if(e.procedural)continue;
        const c=resolveEntry(e),target=targetWorld(c),cam=new T.PerspectiveCamera(c.fovDeg||42,16/9,.1,2); // Frustum marker shows each stored camera's viewing direction.
        cam.position.set(c.position.x,c.position.y,c.position.z);cam.lookAt(target.x,target.y,target.z);cam.updateMatrixWorld(true);
        const helper=new T.CameraHelper(cam);helper.userData.cameraEntry=e.key;group.add(helper);
        const dot=new T.Mesh(new T.SphereGeometry(.18,10,8),new T.MeshBasicMaterial({color:e.key===selected?0xffc65b:0x6fe0ff,depthTest:false})); // Selectable position marker.
        dot.position.copy(cam.position);dot.userData.cameraEntry=e.key;dot.renderOrder=1000;group.add(dot);
      }
      group.visible=!panel.hidden&&!state.preview.running&&!inspecting;
    }
    function sync() {
      const list=entries();if(!list.some(e=>e.key===selected))selected=list[0]?.key||'';
      $('sceneCameraSelect').replaceChildren(...list.map(e=>{const o=document.createElement('option');o.value=e.key;o.textContent=e.label;return o;}));$('sceneCameraSelect').value=selected;
      const e=current(),numbers=$('sceneCameraNumbers');numbers.replaceChildren();
      if(!e){$('sceneCameraStatus').textContent='Capture a view or load a repo scene to edit cameras.';gizmo?.detach();markers();return;}
      const c=resolveEntry(e);$('sceneCameraFov').value=c.fovDeg||42;$('sceneCameraBlend').value=c.blendSeconds??.45;
      const fields=e.procedural ? (e.stage.cameraMode==='follow'?['offset.x','offset.y','offset.z']:['povBack','povSide','povHeight']) : ['position.x','position.y','position.z','target.x','target.y','target.z']; // Direct transforms for fixed shots; rig offsets for actor-bound shots.
      for(const field of fields){const label=document.createElement('label'),input=document.createElement('input');label.textContent=field;input.type='number';input.step='.1';input.dataset.cameraField=field;
        const [part,axis]=field.split('.');const raw=e.local?(part==='position'?e.camera.localPos:e.camera.localTarget):e.camera;
        input.value=e.procedural?(axis?e.stage.cameraOffset?.[axis]??(axis==='y'?5:axis==='z'?8:0):e.stage[part]||0):(e.local?raw[axis]:raw?.[part]?.[axis])??0;
        input.onchange=()=>{const value=Number(input.value);if(!Number.isFinite(value))return;if(e.procedural){if(axis){e.stage.cameraOffset={...(e.stage.cameraOffset||{x:0,y:5,z:8}),[axis]:value};}else e.stage[part]=value;}else if(e.local)raw[axis]=value;else {e.camera[part]={...e.camera[part],[axis]:value};}save();markers();attach();};label.appendChild(input);numbers.appendChild(label);}
      $('sceneCameraStatus').textContent=e.procedural?'Live actor-bound shot: edit its rig offsets above.':'Drag the world-axis handles or edit the transform fields.';
      markers();attach();
    }
    function attach(){const e=current();if(!gizmo||!e||e.procedural||endpoint==='none'||state.preview.running||inspecting){gizmo?.detach();return;}const c=resolveEntry(e),p=endpoint==='target'?targetWorld(c):c.position;handle.position.set(p.x,p.y,p.z);gizmo.attach(handle);}
    function commitHandle(){const e=current();if(!e||e.procedural)return;let p={x:handle.position.x,y:handle.position.y,z:handle.position.z};if(e.local)e.camera[endpoint==='target'?'localTarget':'localPos']=toLocal(p);else{if(endpoint==='target'&&e.camera.targetNpcId){const old=targetWorld(e.camera);p={x:p.x-old.x+(e.camera.target?.x||0),y:p.y-old.y+(e.camera.target?.y||0),z:p.z-old.z+(e.camera.target?.z||0)};}e.camera[endpoint]=p;}save();markers();}
    gizmo?.addEventListener('dragging-changed',e=>{dragging=e.value;three.controls.enabled=!dragging&&!state.preview.running;if(!dragging)sync();});
    gizmo?.addEventListener('objectChange',commitHandle);
    const ray=new T.Raycaster(),ndc=new T.Vector2(); // Reused marker picking objects, event-only.
    three.renderer.domElement.addEventListener('pointerdown',e=>{if(state.preview.running||gizmo?.axis)return;const r=three.renderer.domElement.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(ndc,three.camera);const hit=ray.intersectObjects(group.children,false).find(h=>h.object.userData.cameraEntry);if(hit){selected=hit.object.userData.cameraEntry;sync();}});
    $('sceneCameraSelect').onchange=e=>{selected=e.target.value;sync();};$('sceneCameraEndpoint').onchange=e=>{endpoint=e.target.value;attach();};
    for(const [id,key] of [['sceneCameraFov','fovDeg'],['sceneCameraBlend','blendSeconds']])$(id).onchange=()=>{const e=current(),v=Number($(id).value);if(!e||!Number.isFinite(v))return;(e.procedural?e.stage:e.camera)[key]=key==='fovDeg'?Math.max(10,Math.min(120,v)):Math.max(0,v);save();markers();};
    function restoreView(){if(savedView){three.camera.position.copy(savedView.position);three.controls.target.copy(savedView.target);three.camera.fov=savedView.fov;three.camera.updateProjectionMatrix();three.controls.update();}savedView=null;inspecting=false;sync();}
    $('sceneCameraReturn').onclick=restoreView;
    $('sceneCameraLook').onclick=()=>{const e=current();if(!e||state.preview.running)return;if(!savedView)savedView={position:three.camera.position.clone(),target:three.controls.target.clone(),fov:three.camera.fov};const c=resolveEntry(e),p=c.positionProvider?.()||c.position,t=c.targetProvider?.()||targetWorld(c);inspecting=true;gizmo?.detach();group.visible=false;three.camera.position.set(p.x,p.y,p.z);three.controls.target.set(t.x,t.y,t.z);three.camera.fov=c.fovDeg||42;three.camera.lookAt(three.controls.target);three.camera.updateProjectionMatrix();three.controls.update();};
    $('sceneCameraUseView').onclick=()=>{const e=current();if(!e||e.procedural||state.preview.running){toast('Select a fixed camera to capture this view.');return;}const p=three.camera.position,t=three.controls.target;if(e.local){e.camera.localPos=toLocal(p);e.camera.localTarget=toLocal(t);}else{e.camera.position={x:p.x,y:p.y,z:p.z};e.camera.target={x:t.x,y:t.y,z:t.z};delete e.camera.targetNpcId;e.camera.trackSpeaker=false;}e.camera.fovDeg=three.camera.fov;save();sync();};
    function begin(){restoreView();runtime.deactivate();blend.reset();lookPoint.copy(three.controls.target);runtime.registerArea('director',state.project.cinematicCameras||[]);const e=entries().find(e=>e.key==='scene')||entries().find(e=>e.key==='map:'+state.project.cinematicCameraId)||entries().find(e=>e.local);if(e)runtime.activate('director',resolveEntry(e));gizmo?.detach();group.visible=false;}
    function actorIdFor(st){return state.project.actors.find(a=>a.id===(st.speakerId||st.actorId))?.npcId||st.speakerId||st.actorId;}
    function enterStage(st){const a=actor(st.speakerId||st.actorId), targetWalker=a?{root:a.root,rec:{id:actorIdFor(st)}}:null;const options={targetWalker};if(st.cameraId&&!st.cameraMode)runtime.activate('director',st.cameraId,options);else if(st.cameraMode==='establishing'){const e=entries().find(e=>e.local);if(e)runtime.activate('director',resolveEntry(e));else runtime.deactivate();}else if(['pov','follow','npcRelative'].includes(st.cameraMode))runtime.activate('director',proceduralShot(st));else if(st.cameraMode==='authored'&&st.camera)runtime.activate('director',st.camera);else if(st.cameraMode==='wall')runtime.activate('director',state.project.cinematicCamera||state.project.cinematicCameraId,options);}
    runtime.init({getNpcWalker:id=>{const def=state.project.actors.find(a=>a.npcId===id);const a=def&&actor(def.id);return a?{root:a.root,rec:{id}}:null;},getNpcFacePosition:w=>({x:w.root.position.x,y:w.root.position.y+1,z:w.root.position.z})});
    sync();
    return {sync,begin,enterStage,update(){if(state.preview.running&&blend.apply())three.controls.target.copy(lookPoint);},end(){runtime.deactivate();blend.reset();gizmo?.detach();group.visible=!panel.hidden;},isDragging:()=>dragging||!!gizmo?.axis,snapshot:()=>({...blend.snapshot(),selected,latestChange:'Visible scene cameras, transform handles and persistent playback shots.'})};
  }
  window.CutsceneDirectorCameras={create};
})();
