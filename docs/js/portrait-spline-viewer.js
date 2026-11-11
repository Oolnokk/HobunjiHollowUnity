// True WebGL authoring view for portrait spline appendages.
// Uses the SAME pinned Three.js modules and PortraitSplineRig.posePoints/deformPosition as the game.
// Only the wind-facing pose is edited here; neutral (u,v) placement remains in the 2D rigger.
(() => {
  'use strict';
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const AXES = { x: [1,0,0], y: [0,1,0], z: [0,0,1] };
  const POSE_ROTATIONS = { x: 'pitch', y: 'yaw', z: 'roll' };

  async function create(canvas, handlers = {}) {
    const cfg = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {};
    if (!cfg.threeModuleUrl) throw new Error('The game Three.js module URL was not loaded.');
    const [THREE, orbit] = await Promise.all([
      import(cfg.threeModuleUrl), // Reuse the same pinned build as AvatarPreviewScene, not a new CDN version.
      cfg.orbitControlsModuleUrl ? import(cfg.orbitControlsModuleUrl) : Promise.resolve(null),
    ]);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else renderer.outputEncoding = THREE.sRGBEncoding;
    const scene = new THREE.Scene();scene.background = new THREE.Color(0x0b1726);
    const camera = new THREE.PerspectiveCamera(42, 1, .01, 20);
    const controls = orbit?.OrbitControls ? new orbit.OrbitControls(camera,canvas) : null;
    if (controls) {
      controls.target.set(0,0,.06);
      controls.enableDamping = true;
      controls.dampingFactor = .09;
      controls.minDistance = .6;
      controls.maxDistance = 5;
      controls.addEventListener('change', schedule);
    }
    scene.add(new THREE.HemisphereLight(0xffffff,0x293448,1.3));
    const axes = new THREE.AxesHelper(.38);axes.position.set(-.53,-.53,0);scene.add(axes); // Red X, green Y, blue Z orientation reference.
    const sheetGroup = new THREE.Group();scene.add(sheetGroup);
    const markers = new THREE.Group();scene.add(markers);
    const gizmo = new THREE.Group();scene.add(gizmo);
    const pickable = []; // Active 3D knot spheres and axis handles, no invisible full-scene raycasts.
    const spriteSurface = window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit; // Same PNG-plane material factory as Pants Garment Renderer and AvatarPreviewScene.
    const textureFailures = new Map(); // Captures per-surface mobile CORS/decode/upload issues without hiding the 3D gizmos.
    const headPlane = makeSheet(null,0,THREE.DoubleSide);
    const hairPlane = makeSheet(null,.002,THREE.FrontSide);
    const rearPlane = makeSheet(null,-.002,THREE.BackSide);
    const hoodPlane = makeSheet(null,.001,THREE.DoubleSide,.25);
    const rigidFrontPlane = makeSheet(null,.0008,THREE.FrontSide); // Rigid pixels sit just above the head but beneath the hood and moving 3D hair.
    const rigidRearPlane = makeSheet(null,-.0008,THREE.BackSide); // Rear pixels remain on their unbent portrait surface.
    rigidFrontPlane.name='spline_rigid_front';rigidRearPlane.name='spline_rigid_rear';
    sheetGroup.add(headPlane,hoodPlane,rigidFrontPlane,rigidRearPlane,hairPlane,rearPlane);
    let mode='translate', state=null, disposed=false, dirty=false;
    let verifiedTexturePair=''; // One on-screen GPU-health warning per loaded head/hair pair; avoids mobile readback every pose frame.
    let lastGeometryKey=''; // Only rebuild the deformable ribbon when its points/pose/wind/UV settings actually change.
    let selectedIndex=1, dots=[], handles=[], drag=null;
    const raycaster=new THREE.Raycaster(); // Used only for direct pointer selection and gizmo manipulation.
    const ndc=new THREE.Vector2();
    const axisUnit=axis=>new THREE.Vector3(...AXES[axis]);
    const coordinate=e=>{const box=canvas.getBoundingClientRect();return {x:(e.clientX-box.left)/box.width*2-1,y:1-(e.clientY-box.top)/box.height*2,box};};
    function makeSheet(image,z,side,opacity=1) {
      const label = opacity < 1 ? 'spline_hood_reference' : side===THREE.BackSide ? 'spline_rear' : z===0 ? 'spline_character' : 'spline_hair';
      const overrides={side,transparent:true,depthWrite:z===0,opacity};
      const material = spriteSurface?.makeMaterial
        ? spriteSurface.makeMaterial(THREE,null,label,overrides)
        : new THREE.MeshBasicMaterial({transparent:true,alphaTest:.005,depthWrite:false,side,opacity});
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material);
      mesh.name=label;mesh.position.z=z;mesh.visible=false;
      return mesh;
    }
    function replaceTexture(mesh,image,mirror=false) {
      if(mesh.userData.image===image&&mesh.userData.mirror===mirror&&mesh.material.map)return;
      if(!image){
        mesh.material.map?.dispose();
        mesh.material.map=null;mesh.material.needsUpdate=true;mesh.visible=false;
        mesh.userData.image=null;mesh.userData.pixelStats=null;
        textureFailures.delete(mesh.name);return;
      }
      try {
        const width=Math.round(image.naturalWidth||image.width||0),height=Math.round(image.naturalHeight||image.height||0);
        if(width<1||height<1||width*height>4194304)throw Error('Invalid sprite canvas dimensions '+width+' × '+height);
        const source=document.createElement('canvas'); // Reuse the Pants Rig Author's clean 200px source canvas contract.
        source.width=width;source.height=height;
        const ctx=source.getContext('2d');
        if(!ctx)throw Error('No 2D context for authored portrait texture');
        if(mirror){ctx.translate(width,0);ctx.scale(-1,1);}
        ctx.drawImage(image,0,0,width,height);
        // This check is diagnostic only: unlike the previous DataTexture code it cannot abort a valid sprite upload.
        // A failed alpha read is reported as a possible cross-origin taint, not silently treated as empty artwork.
        let opaque=-1,colored=-1,readError=null;
        try {
          const rgba=ctx.getImageData(0,0,width,height).data;
          opaque=0;colored=0;
          for(let i=0;i<rgba.length;i+=4){
            if(rgba[i+3]<8)continue;
            opaque++;
            if(rgba[i]>12||rgba[i+1]>12||rgba[i+2]>12)colored++;
          }
        }catch(error){readError=error.name+': '+error.message;}
        const texture=spriteSurface?.makeCanvasTexture
          ? spriteSurface.makeCanvasTexture(THREE,source,mesh.name)
          : new THREE.CanvasTexture(source);
        texture.needsUpdate=true;
        const previous=mesh.material.map;
        mesh.material.map=texture;
        if(mesh.material.depthWrite && spriteSurface?.maskAlphaTest)
          mesh.material.alphaTest=Math.max(mesh.material.alphaTest,spriteSurface.maskAlphaTest());
        mesh.material.needsUpdate=true;mesh.visible=true;
        mesh.userData.image=image;mesh.userData.mirror=mirror; // Commit cache identity only after the texture is successfully constructed.
        mesh.userData.pixelStats={width,height,opaque,colored,format:'canonical CanvasTexture',readError};
        previous?.dispose();
        if(readError)textureFailures.set(mesh.name,readError);
        else textureFailures.delete(mesh.name);
      }catch(error){
        const reason=error.name+': '+error.message;
        textureFailures.set(mesh.name,reason);
        mesh.userData.image=null; // A failed attempt must never poison the identical-input retry path.
        mesh.userData.pixelStats={error:reason};
        mesh.material.map?.dispose();mesh.material.map=null;mesh.material.needsUpdate=true;mesh.visible=false;
        handlers.onStatus?.('3D '+mesh.name+' texture failed: '+reason);
      }
    }
    function replaceMeshGeometry(mesh,newGeometry) {
      if(mesh.geometry===newGeometry)return;
      mesh.geometry?.dispose(); // The editor owns the original static plane and every regenerated grid.
      mesh.geometry=newGeometry;mesh.userData.ownsGeometry=true;
    }
    function deformMesh(mesh,rig,posed,rear){
      // Reuse the authored ribbon's vertex buffers during pointer drags; only reallocate if grid density changes.
      const grid=rig.segmentsX+'x'+rig.segmentsY;
      if(mesh.userData.grid!==grid){
        replaceMeshGeometry(mesh,new THREE.PlaneGeometry(1,1,rig.segmentsX,rig.segmentsY));
        mesh.userData.rest=new Float32Array(mesh.geometry.attributes.position.array); // Neutral UV mesh, unchanged by 3D pose deformation.
        mesh.userData.grid=grid;
      }
      const plane=mesh.geometry,p=plane.attributes.position,original=mesh.userData.rest;
      const maskKey=JSON.stringify([rig.regionMasks?.[rear?'rear':'front'],rig.blendRadiusPx]);
      if(mesh.userData.blendKey!==maskKey){
        mesh.userData.blendKey=maskKey; // Rebuild the distance-to-rigid mask only when painting or changing its blend radius.
        mesh.userData.blendField=window.PortraitSplineRig.attachmentBlendField(
          rig.regionMasks?.[rear?'rear':'front'],rig.blendRadiusPx);
      }
      const field=mesh.userData.blendField;
      for(let i=0;i<p.count;i++){
        const u=original[i*3]+.5,v=.5-original[i*3+1];
        const strength=window.PortraitSplineRig.sampleAttachmentBlend(field,rear?1-u:u,v);
        const at=window.PortraitSplineRig.deformPosition(rig,posed,u,v,1,1,strength);
        p.setXYZ(i,at.x,at.y,rear?-at.z:at.z);
      }
      p.needsUpdate=true;plane.computeVertexNormals();plane.computeBoundingSphere();
    }
    function clearChildren(group){
      for(const child of [...group.children]){
        group.remove(child);child.geometry?.dispose?.();child.material?.dispose?.();
      }
    }
    function makeMaterial(color){return new THREE.MeshBasicMaterial({color,depthTest:false,transparent:true,opacity:.95});}
    function addKnots(points){
      clearChildren(markers);dots=[];pickable.length=0;
      const sphere=new THREE.SphereGeometry(.014,12,8);
      for(let i=0;i<points.length;i++){
        const dot=new THREE.Mesh(sphere.clone(),makeMaterial(i===selectedIndex?0xffee91:0x6de8eb));
        dot.position.copy(new THREE.Vector3(points[i].x,points[i].y,points[i].z));
        dot.userData.knotIndex=i;dot.renderOrder=20;markers.add(dot);dots.push(dot);pickable.push(dot);
      }
    }
    function addGizmo(points){
      clearChildren(gizmo);handles=[];
      selectedIndex=clamp(selectedIndex,0,points.length-1);
      if(selectedIndex===0){gizmo.visible=false;return;} // Root knot remains attached to the head; place it in the 2D editor.
      gizmo.visible=true;
      const p=points[selectedIndex];gizmo.position.set(p.x,p.y,p.z);
      const colors={x:0xff626b,y:0x5bed9d,z:0x70b2ff};
      for(const axis of ['x','y','z']){
        const material=makeMaterial(colors[axis]),v=axisUnit(axis);
        if(mode==='translate'){
          const stem=new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,.135,10),material);
          stem.position.copy(v.clone().multiplyScalar(.077));
          stem.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v);
          const tip=new THREE.Mesh(new THREE.ConeGeometry(.02,.041,12),makeMaterial(colors[axis]));
          tip.position.copy(v.clone().multiplyScalar(.162));
          tip.quaternion.copy(stem.quaternion);
          for(const piece of [stem,tip]){piece.userData.axis=axis;piece.renderOrder=22;gizmo.add(piece);handles.push(piece);pickable.push(piece);}
        }else{
          const ring=new THREE.Mesh(new THREE.TorusGeometry(.16,.014,8,48),material);
          if(axis==='x')ring.rotation.y=Math.PI/2;
          else if(axis==='y')ring.rotation.x=Math.PI/2;
          ring.userData.axis=axis;ring.renderOrder=22;gizmo.add(ring);handles.push(ring);pickable.push(ring);
        }
      }
    }
    function update(next){
      if(disposed||!next)return;
      state=next;
      const rig=window.PortraitSplineRig.normalize(next.rig);
      if(!rig)return;
      const selected=clamp(Number(next.selectedKnot)||0,0,rig.points.length-1);
      selectedIndex=selected;
      const posed=window.PortraitSplineRig.posePoints(rig,next.wind||{});
      replaceTexture(headPlane,next.head||null);
      replaceTexture(hairPlane,next.front||null);
      replaceTexture(hoodPlane,next.hood||null);
      replaceTexture(rearPlane,next.rear||null,true);
      replaceTexture(rigidFrontPlane,next.rigidFront||null);
      replaceTexture(rigidRearPlane,next.rigidRear||null,true);
      const geometryKey=JSON.stringify([rig.points,rig.segments,rig.tipFollow,rig.blendRadiusPx,rig.regionMasks,
        rig.width,rig.segmentsX,rig.segmentsY,next.wind]); // Mask edits and hierarchical pose strength must invalidate the live 3D ribbon.
      if(geometryKey!==lastGeometryKey){
        deformMesh(hairPlane,rig,posed.points,false);
        deformMesh(rearPlane,rig,posed.points,true);
        lastGeometryKey=geometryKey;
      }
      if(next.rear){
        rearPlane.position.x=next.rearAligned?0:rig.rearOffset.u;
        rearPlane.position.y=next.rearAligned?0:-rig.rearOffset.v; // Masked rear artwork is already shifted before its pixels are partitioned.
      }
      addKnots(posed.points);addGizmo(posed.points);
      const blocked=posed.collisions;
      handlers.onStatus?.(blocked?blocked+' segment(s) reached the portrait collision limit':null);
      schedule();
    }
    function selectKnot(index){
      if(!state)return;
      selectedIndex=index;
      handlers.onSelect?.(index);
      update({...state,selectedKnot:index});
    }
    function readPose(axis){
      const segment=state?.rig?.segments?.[selectedIndex-1];
      const pose=segment?.poses?.[state.direction];
      if(!pose)return 0;
      return mode==='translate' ? Number(pose.translate?.[axis]||0) : Number(pose[POSE_ROTATIONS[axis]]||0);
    }
    function pointerDown(e){
      if(disposed||!state)return; // Keep knot-picking live even if the anchored root knot currently hides its gizmo.
      const c=coordinate(e);ndc.set(c.x,c.y);raycaster.setFromCamera(ndc,camera);
      const hits=raycaster.intersectObjects(pickable,false);
      if(!hits.length)return; // Empty-space drag remains the normal orbit camera interaction.
      const object=hits[0].object;
      if(object.userData.knotIndex!=null){
        e.stopImmediatePropagation();selectKnot(object.userData.knotIndex);schedule();return;
      }
      if(!object.userData.axis||selectedIndex<1)return;
      e.preventDefault();e.stopImmediatePropagation();
      const axis=object.userData.axis,unit=axisUnit(axis);
      const origin=gizmo.position.clone();
      const base=readPose(axis);
      const start = {x:e.clientX,y:e.clientY};
      const projectedA=origin.clone().project(camera),projectedB=origin.clone().addScaledVector(unit,.15).project(camera);
      const px=(projectedB.x-projectedA.x)*c.box.width/2,py=-(projectedB.y-projectedA.y)*c.box.height/2;
      const screenLenSq=px*px+py*py;
      const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(unit,origin);
      const onPlane=raycaster.ray.intersectPlane(plane,new THREE.Vector3());
      drag={id:e.pointerId,axis,unit,origin,base,start,px,py,screenLenSq,
        baseVector:onPlane&&onPlane.distanceToSquared(origin)>.00002?onPlane.sub(origin).normalize():null};
      controls&&(controls.enabled=false);
      canvas.setPointerCapture(e.pointerId);
    }
    function pointerMove(e){
      if(!drag||e.pointerId!==drag.id||!state)return;
      e.preventDefault();e.stopPropagation();
      const dx=e.clientX-drag.start.x,dy=e.clientY-drag.start.y;
      let value;
      if(mode==='translate'){
        // Project the true world axis into the viewport so dragging an X/Y/Z arrow only changes that component.
        const scale=(dx*drag.px+dy*drag.py)/Math.max(16,drag.screenLenSq);
        value=clamp(drag.base+scale*.15,-.35,.35);
      }else{
        const c=coordinate(e);ndc.set(c.x,c.y);raycaster.setFromCamera(ndc,camera);
        const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(drag.unit,drag.origin);
        const point=raycaster.ray.intersectPlane(plane,new THREE.Vector3());
        if(point&&drag.baseVector&&point.distanceToSquared(drag.origin)>.00002){
          const current=point.sub(drag.origin).normalize();
          const signed=Math.atan2(drag.unit.dot(new THREE.Vector3().crossVectors(drag.baseVector,current)),
            drag.baseVector.dot(current));
          value=clamp(drag.base+signed*180/Math.PI,-85,85);
        }else {
          // Edge-on rotation rings still work on touchscreens and oblique camera angles.
          value=clamp(drag.base+(dx-dy)*.55,-85,85);
        }
      }
      handlers.onEdit?.({index:selectedIndex,mode,axis:drag.axis,rotationKey:POSE_ROTATIONS[drag.axis],value});
    }
    function pointerUp(e){
      if(!drag||e.pointerId!==drag.id)return;
      e.preventDefault();e.stopPropagation();drag=null;
      controls&&(controls.enabled=true);
      if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    }
    canvas.addEventListener('pointerdown',pointerDown,true);
    canvas.addEventListener('pointermove',pointerMove,true);
    canvas.addEventListener('pointerup',pointerUp,true);
    canvas.addEventListener('pointercancel',pointerUp,true);
    function schedule(){
      if(disposed||dirty)return;
      dirty=true;
      requestAnimationFrame(()=>{
        dirty=false;if(disposed)return;
        const rect=canvas.getBoundingClientRect(),w=Math.max(1,Math.round(rect.width)),h=Math.max(1,Math.round(rect.height));
        if(rect.width<2||rect.height<2)return;
        if(canvas.width!==Math.round(w*renderer.getPixelRatio())||canvas.height!==Math.round(h*renderer.getPixelRatio()))
          renderer.setSize(w,h,false);
        if(camera.aspect!==w/h){camera.aspect=w/h;camera.updateProjectionMatrix();}
        controls?.update();
        renderer.render(scene,camera);
        const head=headPlane.material.map,hair=hairPlane.material.map;
        if(textureFailures.size){
          handlers.onStatus?.('3D sprite error: '+[...textureFailures].map(([key,value])=>key+': '+value).join(' | '));
        }
        if(head&&hair){
          const pair=head.id+':'+hair.id;
          if(pair!==verifiedTexturePair){
            verifiedTexturePair=pair;
            const headGpu=probeGpuTexture(head),hairGpu=probeGpuTexture(hair); // Verify actual rendered WebGL pixels, not just material-map existence.
            if(!headGpu?.ok||!hairGpu?.ok)
              handlers.onStatus?.('3D texture pixels did not render correctly. Use Copy 3D diagnostics for the head/hair GPU readback.');
          }
        }
      });
    }
    function setCameraView(view){
      const locations={front:[0,.12,2.2],angle:[1.35,.55,1.75],side:[2.2,.14,0],rear:[0,.12,-2.2]};
      camera.position.set(...(locations[view]||locations.angle));
      camera.lookAt(0,0,0);
      controls?.target.set(0,0,0);controls?.update();
      schedule();
    }
    function setMode(next){if(next!=='translate'&&next!=='rotate')return;mode=next;if(state)update(state);}
    function dispose(){
      disposed=true;
      canvas.removeEventListener('pointerdown',pointerDown,true);
      canvas.removeEventListener('pointermove',pointerMove,true);
      canvas.removeEventListener('pointerup',pointerUp,true);
      canvas.removeEventListener('pointercancel',pointerUp,true);
      controls?.dispose();clearChildren(markers);clearChildren(gizmo);
      for(const mesh of [headPlane,hairPlane,rearPlane,hoodPlane,rigidFrontPlane,rigidRearPlane]){
        mesh.geometry?.dispose();mesh.material.map?.dispose();mesh.material?.dispose();
      }
      axes.geometry?.dispose();axes.material?.dispose?.();renderer.dispose();
    }
    const gpuProbes=new WeakMap(); // One GPU pixel readback per loaded texture, only when mobile diagnostics or browser smoke request it.
    function probeGpuTexture(texture){
      if(!texture)return null;
      if(gpuProbes.has(texture))return gpuProbes.get(texture);
      const target=new THREE.WebGLRenderTarget(48,48,{depthBuffer:false,stencilBuffer:false});
      const probeScene=new THREE.Scene();
      probeScene.background=new THREE.Color(0x0b1726);
      const probeGeometry=new THREE.PlaneGeometry(1,1);
      const probeMaterial=new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.005,depthWrite:false,side:THREE.DoubleSide});
      const probeMesh=new THREE.Mesh(probeGeometry,probeMaterial);
      probeScene.add(probeMesh);
      const probeCamera=new THREE.OrthographicCamera(-.5,.5,.5,-.5,.1,2);
      probeCamera.position.set(0,0,1);
      let check={ok:false,nonBackground:0,black:0,total:48*48};
      const original=renderer.getRenderTarget();
      try{
        renderer.setRenderTarget(target);
        renderer.clear(true,true,true);
        renderer.render(probeScene,probeCamera);
        const pixels=new Uint8Array(48*48*4); // GPU framebuffer bytes, unlike source canvases or mere material-map existence.
        renderer.readRenderTargetPixels(target,0,0,48,48,pixels);
        let colored=0,black=0;
        for(let i=0;i<pixels.length;i+=4){
          const red=pixels[i],green=pixels[i+1],blue=pixels[i+2];
          if(red<4&&green<4&&blue<4)black++;
          if(red>30||green>42||blue>55)colored++;
        }
        check={ok:colored>4,nonBackground:colored,black,total:48*48};
      }catch(error){check={ok:false,error:error.message,nonBackground:0,black:0,total:48*48};}
      finally{
        renderer.setRenderTarget(original);
        target.dispose();probeGeometry.dispose();probeMaterial.dispose();
      }
      gpuProbes.set(texture,check);
      return check;
    }
    function debug(){
      scene.updateMatrixWorld(true);
      const box=canvas.getBoundingClientRect();
      const screen=object=>{
        const pt=object.getWorldPosition(new THREE.Vector3()).project(camera);
        return {x:box.left+(pt.x+1)*box.width/2,y:box.top+(1-pt.y)*box.height/2};
      };
      const arrows=handles.filter(item=>mode==='translate'&&item.geometry?.type==='ConeGeometry')
        .map(item=>({axis:item.userData.axis,...screen(item)}));
      const rings=handles.filter(item=>mode==='rotate'&&item.geometry?.type==='TorusGeometry')
        .map(item=>{
          const point=new THREE.Vector3(.16/Math.SQRT2,.16/Math.SQRT2,0).applyMatrix4(item.matrixWorld).project(camera); // A diagonal ring point avoids intersections where two axis rings cross.
          return {axis:item.userData.axis,x:box.left+(point.x+1)*box.width/2,y:box.top+(1-point.y)*box.height/2};
        });
      return {
        webgl:true,mode,selectedKnot:selectedIndex,knots:dots.length,handles:handles.length,
        ribbonVertices:hairPlane.geometry?.attributes?.position?.count||0,
        stitchedFrontPixels:state?.stitchedFrontPixels||0,
        stitchedRearPixels:state?.stitchedRearPixels||0, // Counts original rigid pixels carried on the flat end of the continuous hair mesh.
        headLoaded:!!headPlane.material.map,hairLoaded:!!hairPlane.material.map,
        textures:{head:headPlane.userData.pixelStats||null,hair:hairPlane.userData.pixelStats||null,
          rear:rearPlane.userData.pixelStats||null,hood:hoodPlane.userData.pixelStats||null,
          rigidFront:rigidFrontPlane.userData.pixelStats||null,rigidRear:rigidRearPlane.userData.pixelStats||null},
        gpuTextureCount:renderer.info.memory.textures,
        textureErrors:Object.fromEntries(textureFailures), // Mobile-accessible reason, including SecurityError on a tainted canvas.
        gpuHead:probeGpuTexture(headPlane.material.map),gpuHair:probeGpuTexture(hairPlane.material.map),
        arrows,rings, // Mobile diagnostics and browser pointer-test coordinates for actual visible gizmo handles.
      };
    }
    setCameraView('angle');
    return { update,setMode,setCameraView,schedule,dispose,debug,THREE };
  }
  window.PortraitSplineViewer={create};
})();
