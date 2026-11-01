// Hachutu Root Snare: real player portrait/leg/hand renderables are baked once
// at full *world-space* height, cut at the anatomical posterior, and animated
// as throwaway geometry. The actual skinned player, bones and inventory never
// separate; the existing direct-death handler alone owns lethal consequences.
(() => {
  'use strict';
  const THREE=window.THREE;
  if(!THREE)return;
  const DURATION=6,THROW_VIEW_S=.95,MAX_TRIANGLES=32000;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number(n)||0));
  const smooth=t=>{const f=clamp(t,0,1);return f*f*(3-2*f);};
  const assets=()=>window.PlayerBodyTransformComposer?.getPlayerMesh?.()
    ||window.WorldPortraitLife?.getPlayerAvatar?.()?.group||null;
  let current=null,lastEvent='ready',lastError='';
  const counts={captures:0,interrupts:0,splits:0,instantDeaths:0};
  function visibleMeshes(root){
    const meshes=[];
    root?.traverse(node=>{
      if(!node.isMesh||node.isInstancedMesh||!node.geometry?.getAttribute?.('position')||node.visible===false)return;
      for(let parent=node.parent;parent&&parent!==root.parent;parent=parent.parent)if(parent.visible===false)return;
      // Held tools, outline proxies and collider helpers are not part of a person's skin.
      if(node.userData?.hobunjiHeldObjectPlane||node.userData?.hobunjiWeaponAssemblyPart
        ||node.userData?.noCharacterTear||/shadow|hitbox|collision|debug/i.test(node.name||''))return;
      if(node.material?.visible===false)return;
      meshes.push(node);
    });
    return meshes;
  }
  // Baking the actual spine, neck, arm and procedural leg skinning BEFORE
  // horizontal clipping is essential: masking portrait canvases at a guessed
  // pixel row drops independent foot GLBs, pants bones and tall body variants.
  function bakeMeshes(root){
    root.updateWorldMatrix(true,true);
    const records=[],scratch=new THREE.Vector3();let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity,triangles=0; // One actual deformed body bound includes spine, shoulders, garments and separate procedural feet.
    for(const mesh of visibleMeshes(root)){
      mesh.updateWorldMatrix(true,false);
      const geometry=mesh.geometry,position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv'),
        color=geometry.getAttribute('color'),index=geometry.index;
      if(!position?.count||position.count>150000)continue;
      const transform=mesh.isSkinnedMesh?(mesh.applyBoneTransform||mesh.boneTransform):null;
      if(mesh.isSkinnedMesh&&!transform)throw Error('A player skinned mesh cannot be baked with this Three.js runtime');
      mesh.skeleton?.update?.();
      const vertices=[];
      for(let i=0;i<position.count;i++){
        scratch.fromBufferAttribute(position,i);
        if(transform)transform.call(mesh,i,scratch);
        scratch.applyMatrix4(mesh.matrixWorld);
        if(![scratch.x,scratch.y,scratch.z].every(Number.isFinite))continue;
        minX=Math.min(minX,scratch.x);maxX=Math.max(maxX,scratch.x);minY=Math.min(minY,scratch.y);maxY=Math.max(maxY,scratch.y);minZ=Math.min(minZ,scratch.z);maxZ=Math.max(maxZ,scratch.z);
        vertices.push({p:scratch.clone(),u:uv?.getX(i)||0,v:uv?.getY(i)||0,
          color:color?[color.getX(i),color.getY(i),color.getZ(i)]:null});
      }
      if(vertices.length!==position.count)continue;
      const groups=geometry.groups?.length?geometry.groups:[{start:0,count:index?.count||position.count,materialIndex:0}];
      for(const group of groups){
        const start=Math.max(0,Number(group.start)||0),end=Math.min(start+(Number(group.count)||0),index?.count||position.count);
        const material=Array.isArray(mesh.material)?mesh.material[group.materialIndex||0]:mesh.material;
        if(!material||material.visible===false)continue;
        const faces=[];
        for(let i=start;i+2<end;i+=3){
          const a=vertices[index?index.getX(i):i],b=vertices[index?index.getX(i+1):i+1],
            c=vertices[index?index.getX(i+2):i+2];if(!a||!b||!c)continue;
          faces.push([a,b,c]);
          if(++triangles>MAX_TRIANGLES)throw Error('Player tear snapshot exceeds bounded triangle budget');
        }
        if(faces.length)records.push({material,faces,name:mesh.name||'character part'});
      }
    }
    if(!records.length||!Number.isFinite(minY)||maxY-minY<.25)throw Error('No full-height player skin and leg geometry could be captured');
    return {records,minX,maxX,minY,maxY,minZ,maxZ,triangles};
  }
  function interpolate(a,b,t){
    return {p:a.p.clone().lerp(b.p,t),u:a.u+(b.u-a.u)*t,v:a.v+(b.v-a.v)*t,
      color:a.color&&b.color?a.color.map((c,i)=>c+(b.color[i]-c)*t):null};
  }
  function crop(poly,height,keepAbove){
    if(!poly.length)return [];
    const out=[];
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],insideA=keepAbove?a.p.y>=height:a.p.y<=height,
        insideB=keepAbove?b.p.y>=height:b.p.y<=height;
      if(insideA)out.push(a);
      if(insideA!==insideB){
        const d=b.p.y-a.p.y,t=Math.abs(d)>1e-10?clamp((height-a.p.y)/d,0,1):0;
        out.push(interpolate(a,b,t));
      }
    }
    return out;
  }
  function section(parent,source,kind,cutLow,cutHigh,origin){
    const holder=new THREE.Group();holder.name='Hachutu '+kind+' geometry';parent.add(holder);
    let count=0;
    for(const record of source.records){
      const p=[],uv=[],colors=[];let colored=false;
      const emit=vertex=>{
        p.push(vertex.p.x-origin.x,vertex.p.y-origin.y,vertex.p.z-origin.z);
        uv.push(vertex.u,vertex.v);
        colors.push(...(vertex.color||[1,1,1]));
        if(vertex.color)colored=true;
      };
      for(const face of record.faces){
        let poly=face;
        if(kind==='upper')poly=crop(poly,cutHigh,true);
        else if(kind==='lower')poly=crop(poly,cutLow,false);
        else poly=crop(crop(poly,cutLow,true),cutHigh,false);
        if(poly.length<3)continue;
        for(let i=1;i<poly.length-1;i++){emit(poly[0]);emit(poly[i]);emit(poly[i+1]);count++;}
      }
      if(!p.length)continue;
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
      if(colored)geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
      geo.computeVertexNormals();
      const mat=record.material.clone();
      mat.side=THREE.DoubleSide;
      mat.skinning=false;
      const mesh=new THREE.Mesh(geo,mat);
      mesh.name=record.name+' '+kind+' bone-baked silhouette';
      mesh.frustumCulled=false;
      holder.add(mesh);
    }
    if(!count){holder.parent?.remove(holder);return null;}
    return holder;
  }
  function disposeGroup(root){
    if(!root)return;
    root.traverse(mesh=>{
      mesh.geometry?.dispose?.();
      for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material])mat?.dispose?.();
    });
    root.parent?.remove(root);
  }
  function begin({player,areaId,scene,floorY,neckAnchor,feetAnchor}={}){
    if(current)return false;
    const realRoot=assets();
    if(!realRoot?.parent||!scene||!neckAnchor?.point||!feetAnchor?.point||!player)return false;
    let anchor=null,upper=null,lower=null,bridge=null;
    try{
      const baked=bakeMeshes(realRoot),height=baked.maxY-baked.minY;
      const split=baked.minY+height*.43; // Actual full geometry: includes procedural soles and every tall species variant.
      const band=clamp(height*.075,.05,.16),low=split-band/2,high=split+band/2;
      const origin=new THREE.Vector3((Number(player.x)||0)/(Number(window.Combat?.deps?.TILE)||64),
        split,(Number(player.y)||0)/(Number(window.Combat?.deps?.TILE)||64));
      // Use the live geometry centroid for X/Z if the game's body is displaced by
      // body-lean, a mount, or the PNG profile's custom sprite offset.
      origin.x=(baked.minX+baked.maxX)*.5;origin.z=(baked.minZ+baked.maxZ)*.5; // Never let hidden editor drivers inflate the centered shot or apparent actor height.
      anchor=new THREE.Group();anchor.name='Hachutu visual-only split avatar';
      anchor.position.copy(origin);scene.add(anchor);
      upper=section(anchor,baked,'upper',low,high,origin);
      lower=section(anchor,baked,'lower',low,high,origin);
      bridge=section(anchor,baked,'bridge',low,high,origin);
      if(!upper||!lower||!bridge)throw Error('Player capture omitted a body half or the actual waist region');
      const camera=window.CinematicCameraRuntime;
      const beforeCamera=camera?.activeRecord?.()||null;
      const target=new THREE.Vector3(),position=new THREE.Vector3();
      const s={
        realRoot,previousVisible:realRoot.visible,anchor,upper,lower,bridge,player,scene,areaId,origin,
        floorY:Number.isFinite(floorY)?floorY:baked.minY,neckAnchor,feetAnchor,
        minY:baked.minY,maxY:baked.maxY,fullHeight:height,band,span:height*.83,elapsed:0,
        split:false,tossed:false,finished:false,toss:null,beforeCamera,cameraRecord:null,
        target,position,staticLook:new THREE.Vector3(),axis:new THREE.Vector3(0,1,0),nodeAxis:new THREE.Vector3(),up:new THREE.Vector3(0,1,0),
        originalPosition:{x:player.x,y:player.y},tris:baked.triangles};
      realRoot.visible=false;
      current=s;
      // The game already owns a live cinematic blend, safe camera boom and FOV.
      // Dynamic providers keep the entire head-to-sole extension in frame.
      if(camera&&!camera.isActive?.()){
        s.cameraRecord=camera.activate(areaId,{
          id:'hachutu-root-tear',fovDeg:53,blendSeconds:.38,
          positionProvider:()=>s.position,targetProvider:()=>s.target,
          horizontalCameraCollision:true,dialogueFraming:false,stagePlayer:false
        },{reason:'hachutu-root-tear'});
      }
      updateShot(s,0);counts.captures++;lastEvent='dual grip: complete skinned model captured';
      return true;
    }catch(error){
      lastError=String(error?.stack||error);lastEvent='snapshot failed';
      if(anchor)disposeGroup(anchor);
      if(realRoot)realRoot.visible=true;
      current=null;return false;
    }
  }
  function updateShot(s,dt){
    const progress=clamp(s.elapsed/DURATION,0,1);
    const span=s.fullHeight+Math.max(0,s.span*.58*smooth((s.elapsed-3)/3));
    const focusY=s.origin.y+Math.max(.25,span*.13);
    s.target.set(s.origin.x,focusY,s.origin.z);
    const angle=Math.atan2(s.neckAnchor.point.x-s.feetAnchor.point.x,s.neckAnchor.point.z-s.feetAnchor.point.z)
      +Math.PI*.36+progress*.44;
    const radius=Math.max(4.8,s.fullHeight*2.4+span*.48);
    s.position.set(s.origin.x+Math.sin(angle)*radius,
      focusY+Math.max(1.2,s.fullHeight*.48)+progress*.55,
      s.origin.z+Math.cos(angle)*radius);
  }
  function update(dt){
    const s=current;if(!s)return false;
    if(!s.realRoot.parent||!s.anchor.parent){stop('scene-unloaded');return false;}
    if(!(Number(s.player.health)>0)||s.player._deathTransitionStarted){stop('player-died-elsewhere');return false;}
    if(assets()!==s.realRoot){stop('avatar-rebuilt');return false;}
    const camera=window.CinematicCameraRuntime;
    if(s.cameraRecord&&camera?.activeRecord?.()!==s.cameraRecord){stop('camera-overridden');return false;}
    s.realRoot.visible=false;
    s.player.vx=0;s.player.vy=0;
    s.player.x=s.originalPosition.x;s.player.y=s.originalPosition.y;
    s.elapsed+=clamp(dt,0,.05);
    if(!s.split){
      const pose=window.RootSnareRunner?.pullPose?.(s.elapsed,s.span);
      if(!pose){stop('author-timing-missing');return false;}
      const targetAxis=s.nodeAxis.copy(s.neckAnchor.point).sub(s.feetAnchor.point);
      if(targetAxis.lengthSq()<1e-6)targetAxis.set(0,1,0);
      targetAxis.normalize();
      const axis=s.axis.copy(s.up).lerp(targetAxis,smooth(s.elapsed/.75)).normalize();
      s.anchor.quaternion.setFromUnitVectors(s.up,axis); // Same physical neck-to-feet midpoint rotation as the author, now applied to ALL baked player bones.
      const halfway=pose.stretch*.5;
      s.upper.position.set(0,halfway,0);
      s.lower.position.set(0,-halfway,0);
      s.bridge.scale.set(1,1+pose.stretch/s.band,1);
      // Body full-height is preserved because every skinned vertex was baked
      // in world coordinates, not resized to the preview's portrait canvas.
      if(s.elapsed>=pose.duration){
        s.split=true;counts.splits++;
        try{
          s.anchor.updateWorldMatrix(true,true);
          s.toss=window.RootSnareToss?.create?.({
            THREE,parent:s.anchor,upperSource:s.upper,lowerSource:s.lower,
            neckAnchor:s.neckAnchor,feetAnchor:s.feetAnchor,floorY:s.floorY
          });
          if(!s.toss)throw Error('RootSnareToss not loaded');
          s.tossed=true;s.upper.visible=false;s.lower.visible=false;s.bridge.visible=false;
        }catch(error){lastError=String(error?.stack||error);lastEvent='throw snapshot failed, death remains authoritative';}
      }
    }else{
      s.toss?.update?.(dt);
      if(s.elapsed>=DURATION+THROW_VIEW_S&&!s.finished){
        s.finished=true;
        // Death is never a downed state. Restoring visibility occurs in the
        // same frame, so the original body cannot be seen dismembered.
        const died=window.PlayerDowned?.dieImmediately?.('hachutu-root-hands')===true;
        if(died)counts.instantDeaths++;
        else lastError='PlayerDowned.dieImmediately was unavailable';
        stop(died?'instant-death':'death-service-unavailable');
      }
    }
    updateShot(s,dt);
    return true;
  }
  function gripPoint(which,out){
    const s=current;
    if(!s)return null;
    return out.copy(s.origin);
  }
  function gripTarget(which,out){
    const s=current;if(!s)return null;
    const base=which==='neck'?s.maxY-s.fullHeight*.1:s.minY+s.fullHeight*.065;
    const localY=base-s.origin.y+(s.split?0:(which==='neck'?s.upper.position.y:s.lower.position.y));
    out.set(0,localY,0);
    s.anchor.updateWorldMatrix(true,false);
    return s.anchor.localToWorld(out); // Real tilted full-height endpoints drive the fingers, rather than the guessed canvas neck/foot row.
  }
  function stop(reason='canceled'){
    const s=current;if(!s)return false;
    current=null;
    if(s.realRoot?.parent)s.realRoot.visible=s.previousVisible;
    const camera=window.CinematicCameraRuntime;
    if(s.cameraRecord&&camera?.activeRecord?.()===s.cameraRecord)camera.deactivate();
    s.toss?.dispose?.();
    disposeGroup(s.anchor);
    if(reason==='dodge'||reason==='dodge-or-release')counts.interrupts++;
    lastEvent=reason;return true;
  }
  function debug(){
    const s=current;
    return {active:!!s,stage:s?(s.split?'toss':'pull'):'idle',seconds:s?.elapsed||0,
      fullHeight:s?.fullHeight||0,tiltDegrees:s?.anchor?.rotation?.z?+(s.anchor.rotation.z*180/Math.PI).toFixed(1):0,triangles:s?.tris||0,actualPlayerHidden:!!s&&!s.realRoot.visible,
      cameraOwned:!!s?.cameraRecord,tossed:!!s?.tossed,counters:{...counts},lastEvent,lastError};
  }
  window.RootSnarePlayerTear=Object.freeze({begin,update,stop,gripTarget,debug,
    active:()=>!!current,split:()=>!!current?.split,duration:DURATION});
})();
