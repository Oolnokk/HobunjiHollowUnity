// Root Growth Author: fixed hiding places in real wall/floor roots. Root-like
// branch geometry, three rigged digits, steerable arm and an author-only capture.
((root)=>{
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function seeded(seed){
    let state=2166136261;for(const ch of String(seed))state=Math.imul(state^ch.charCodeAt(0),16777619)>>>0;
    return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  }
  function sourceNodes(T,room,layers,seed){
    if(!room?.model||!Array.isArray(layers))return [];
    room.model.updateWorldMatrix(true,true);
    const center=new T.Box3().setFromObject(room.model).getCenter(new T.Vector3());
    const walls=[],floors=[];
    room.model.traverse(mesh=>{
      if(!mesh.isMesh)return;
      if(mesh.userData?.ruinPreviewRole==='wall')walls.push(new T.Box3().setFromObject(mesh));
      if(mesh.userData?.ruinPreviewRole==='floor')floors.push(new T.Box3().setFromObject(mesh));
    });
    const random=seeded(seed),seen=new Set(),results=[];
    const point=new T.Vector3(),world=new T.Vector3(),future=new T.Vector3(),prior=new T.Vector3();
    const ringPoint=(attr,index,target)=>{
      target.set(0,0,0);
      for(let side=0;side<5;side++){
        const i=index*6+side;
        target.x+=attr.getX(i)*.2;target.y+=attr.getY(i)*.2;target.z+=attr.getZ(i)*.2;
      }
      return target;
    };
    for(const item of layers){
      const layer=item?.layer||item,role=item?.role==='floor'?'floor':'wall';
      if(!layer?.traverse)continue;
      layer.updateWorldMatrix(true,true);
      layer.traverse(mesh=>{
        if(!mesh.isMesh||!mesh.geometry)return;
        const attr=mesh.geometry.getAttribute('position'),rings=attr?.count/6;
        if(!attr||attr.count%6||rings<8)return; // Existing Temple root tubes are five-sided, sixth seam vertex.
        const step=Math.max(7,Math.floor(rings/70));
        for(let ring=3;ring<rings-3;ring+=step){
          ringPoint(attr,ring,point);
          mesh.localToWorld(world.copy(point));
          const local=room.model.worldToLocal(world.clone());
          if(local.y<(Number(room.floorY)||0)-.15||local.y>(Number(room.floorY)||0)+2.95)continue;
          const surfaces=role==='floor'?floors:walls;
          let nearest=Infinity;
          for(const bounds of surfaces)nearest=Math.min(nearest,bounds.distanceToPoint(world));
          if(nearest>(role==='floor'?.45:.48))continue;
          const key=role+':'+Math.round(local.x*4)+','+Math.round(local.y*4)+','+Math.round(local.z*4);
          if(seen.has(key))continue;seen.add(key);
          const tangent=ringPoint(attr,ring+2,future).sub(ringPoint(attr,ring-2,prior)).transformDirection(mesh.matrixWorld);
          const normal=role==='floor'?new T.Vector3(0,1,0):new T.Vector3(center.x-world.x,0,center.z-world.z).normalize();
          if(normal.lengthSq()<.0001)normal.set(0,1,0);
          const direction=normal.multiplyScalar(.84).addScaledVector(tangent,(random()-.45)*.58).normalize();
          if(direction.lengthSq()<.0001)continue;
          results.push({point:local,direction,role,sourceKey:key,rank:random()});
        }
      });
    }
    return results.sort((a,b)=>a.rank-b.rank);
  }
  function findWallRootNodes(T,room,layers,seed,count=6){
    const candidates=sourceNodes(T,room,layers,seed),chosen=[];
    for(const candidate of candidates){
      if(chosen.some(other=>other.point.distanceToSquared(candidate.point)<1.65))continue;
      chosen.push(candidate);
      if(chosen.length>=clamp(Math.round(Number(count)||6),1,14))break;
    }
    return chosen.map((p,index)=>({id:'hidden_root_node_'+(index+1),point:p.point,direction:p.direction,
      role:p.role,sourceKey:p.sourceKey}));
  }
  function branchMesh(T,foliage,material,length,diameter,seed,name){
    if(!foliage?.buildLogMesh)throw new Error('Shared FoliageGenerator.buildLogMesh is required for branch hands.');
    // Build at final length with the game's wonky branch spine and bark noise.
    const mesh=foliage.buildLogMesh({length,logDiameter:diameter,radialSegments:6,ringSegments:8,
      trunkWonk:.14,trunkWonkScale:1.5,trunkTaper:.67,trunkNoise:.2,trunkNoiseOctaves:2,
      useWoodAtlas:false,material,seed});
    mesh.name=name;mesh.castShadow=false;mesh.receiveShadow=false;mesh.layers.enable(1);
    return mesh;
  }
  function makeHand(T,foliage,anchor,material,seed){
    const group=new T.Group();group.name='Hidden root snare '+anchor.id;
    group.userData={hiddenRootNode:anchor.sourceKey,rootSnareId:anchor.id,origin:anchor.role};
    const axis=new T.Vector3(1,0,0),up=new T.Vector3(0,1,0);
    const arm=[];
    for(let i=0;i<3;i++){
      const length=[.6,.51,.4][i],pivot=new T.Group();
      pivot.name='Steerable natural arm joint '+i;group.add(pivot);
      const mesh=branchMesh(T,foliage,material,length,[.145,.11,.083][i],seed+':arm:'+i,'Branch arm '+i);
      pivot.add(mesh);arm.push({pivot,mesh,length});
    }
    const palm=new T.Group();palm.name='Palm fork (branch node)';group.add(palm);
    const knot=branchMesh(T,foliage,material,.25,.14,seed+':fork','Small palm branch cluster');
    knot.position.x=.04;palm.add(knot);
    const fingers=[],specs=[
      {role:'finger',x:-.062,z:-.03,length:.38,tip:.22,spread:-.4},
      {role:'finger',x:.073,z:.027,length:.36,tip:.21,spread:.38},
      {role:'thumb',x:-.055,z:.085,length:.29,tip:.18,spread:-1.08},
    ]; // One junction forks into precisely two fingers and one opposing thumb.
    for(let i=0;i<specs.length;i++){
      const spec=specs[i],knuckle=new T.Group();knuckle.name=spec.role+' base hinge '+i;
      knuckle.position.set(.135,spec.x,spec.z);palm.add(knuckle);
      const first=branchMesh(T,foliage,material,spec.length,.065-i*.006,seed+':digit:'+i+':1','Natural '+spec.role+' segment');
      first.position.x=spec.length*.5;knuckle.add(first);
      const bend=new T.Group();bend.name=spec.role+' flexible branch joint';bend.position.x=spec.length;knuckle.add(bend);
      const tip=branchMesh(T,foliage,material,spec.tip,.037-i*.003,seed+':digit:'+i+':2','Tapered '+spec.role+' tip');
      tip.position.x=spec.tip*.5;bend.add(tip);
      fingers.push({knuckle,bend,spec});
    }
    const lastAim=anchor.direction.clone(),palmPosition=anchor.point.clone();
    const collider=new T.Sphere(palmPosition.clone(),.35); // Authored grasp trigger around the open branch fork.
    const scratch=[new T.Vector3(),new T.Vector3(),new T.Vector3(),new T.Vector3()];
    const delta=new T.Vector3(),desired=new T.Vector3(),side=new T.Vector3();
    let curlAmount=0,hasDrawn=false;
    function draw(dt,progress,target,reach,curl,locked=false,track=false){
      if(progress<=.0001&&!locked){group.visible=false;return;}
      group.visible=true;hasDrawn=true;
      if(!locked||track){
        desired.copy(target).sub(anchor.point);
        if(desired.lengthSq()<.00001)desired.copy(anchor.direction);
        desired.normalize();
        // Reroute *all three* arm joints toward the target even halfway
        // through extension, retaining a bias toward the original root.
        if(track)lastAim.copy(desired); // Both caught fingers track their actual anatomy anchor exactly.
        else{desired.multiplyScalar(.91).addScaledVector(anchor.direction,.09).normalize();
          lastAim.lerp(desired,clamp(dt*11,0,1)).normalize();}
      }
      const distance=clamp(reach,0,15)*progress,curve=.15*Math.sin(Math.PI*progress);
      side.crossVectors(lastAim,up);if(side.lengthSq()<.001)side.set(1,0,0);side.normalize();
      scratch[0].copy(anchor.point);
      scratch[1].copy(anchor.point).addScaledVector(lastAim,distance*.36).addScaledVector(side,curve);
      scratch[2].copy(anchor.point).addScaledVector(lastAim,distance*.71).addScaledVector(side,curve*.6);
      scratch[3].copy(anchor.point).addScaledVector(lastAim,distance);
      for(let i=0;i<3;i++){
        const part=arm[i],a=scratch[i],b=scratch[i+1];
        delta.subVectors(b,a);const length=delta.length();
        part.pivot.position.copy(a);
        if(length>.00001){
          part.pivot.quaternion.setFromUnitVectors(axis,delta.multiplyScalar(1/length));
          // Root segments are generated once with real foliage noise; the
          // bone length changes only during the growth/retraction animation.
          part.mesh.position.x=length*.5;part.mesh.scale.x=Math.max(.001,length/part.length);
        }
        part.pivot.visible=length>.002;
      }
      palmPosition.copy(scratch[3]);collider.center.copy(palmPosition);
      palm.position.copy(palmPosition);
      palm.quaternion.setFromUnitVectors(axis,lastAim);
      palm.scale.setScalar(curl>.9?1:(.32+.68*clamp(progress*4,0,1))); // Keep the captured three-digit fork full-size at its hidden node.
      curlAmount=clamp(curl,0,1);
      for(const finger of fingers){
        const {spec,knuckle,bend}=finger;
        const sign=spec.role==='thumb'?-1:1;
        // Approach = open; after an actual collider hit = full wrap.
        knuckle.rotation.y=spec.spread*(1-curlAmount)+sign*curlAmount*.16;
        knuckle.rotation.z=sign*curlAmount*.72;
        bend.rotation.z=sign*curlAmount*1.14;
      }
    }
    group.visible=false;
    return {group,draw,collider,anchor,palmPosition,get hasDrawn(){return hasDrawn;},
      get digitCount(){return fingers.length;},get digitRoles(){return fingers.map(f=>f.spec.role);},
      get fingerCurl(){return fingers.map(f=>Math.abs(f.bend.rotation.z));},
      get aim(){return lastAim.clone();}};
  }
  function create({THREE,room,rootLayers,wallRootLayers,seed='root-snare',count=6,
    triggerRadius=15,reach=15,extendSpeed=.2,retractSpeed=1.1,showNodes=false,foliage}={}){
    const T=THREE;
    if(!T||!room?.model)throw new TypeError('A prepared ruin is required.');
    const sources=rootLayers||wallRootLayers||[],builder=foliage||root.FoliageGenerator;
    if(!builder?.buildLogMesh)throw new Error('Root snare needs FoliageGenerator.buildLogMesh.');
    const anchors=findWallRootNodes(T,room,sources,seed,count);
    const group=new T.Group();group.name='Wall and floor root snares';
    let sourceMaterial=null;
    for(const item of sources){
      (item?.layer||item)?.traverse?.(mesh=>{
        if(!sourceMaterial&&mesh.isMesh&&mesh.material)sourceMaterial=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
      });
      if(sourceMaterial)break;
    }
    const material=sourceMaterial?.clone?.()||new T.MeshBasicMaterial({color:0x24211d});
    material.side=T.DoubleSide;
    const markerMat=new T.MeshBasicMaterial({color:0xffae6b,depthTest:false});
    const entries=anchors.map((anchor,index)=>{
      const hand=makeHand(T,builder,anchor,material,seed+':'+index);group.add(hand.group);
      const marker=new T.Mesh(new T.SphereGeometry(.062,7,5),markerMat);
      marker.name='Show hidden branch node '+anchor.id;marker.position.copy(anchor.point);
      marker.visible=!!showNodes;group.add(marker);
      return {hand,marker,progress:0,reach:0,cooldown:0,state:'dormant',
        timer:0,lunges:0,aims:0,role:null};
    });
    const settings={count:anchors.length,triggerRadius:clamp(Number(triggerRadius)||15,.5,15),
      reach:clamp(Number(reach)||15,.3,15),extendSpeed:clamp(Number(extendSpeed)||.2,.05,12),
      retractSpeed:clamp(Number(retractSpeed)||1.1,.15,12)};
    const targetPoint=new T.Vector3(),neckPoint=new T.Vector3(),feetPoint=new T.Vector3();
    const delta=new T.Vector3(),toward=new T.Vector3();
    let neckGrip=null,feetGrip=null,captive=null,closed=false,lunges=0,doubleGrabs=0;
    function actorOf(target){return target?.group||target;}
    function gripPoint(target,which,out){
      if(target?.getGripTarget&&target?.diagnostics?.()?.dual)return target.getGripTarget(which,out); // Hand tips follow the same two physical grip targets that drive whole-body tilt.
      if(target?.getGripPoint)return target.getGripPoint(which,out);
      const actor=actorOf(target);out.copy(actor.position);out.y+=which==='neck'?1.38:.18;return out;
    }
    function assignGrip(entry,role,target){
      if(!entry||entry.role||!target)return false;
      entry.role=role;entry.state=role+'-grip';entry.progress=1;entry.timer=0;
      captive=target;
      if(role==='neck'){
        neckGrip=entry;
        target.setNeckGrip?.(entry.hand.anchor); // Unlike the previous fully trapped runner, walking continues at directional tug speed.
      }else{
        feetGrip=entry;
        target.startDualCapture?.(neckGrip.hand.anchor,entry.hand.anchor);
        for(const grip of [neckGrip,feetGrip]){grip.state='double-grip';grip.timer=0;}
        doubleGrabs++;
      }
      return true;
    }
    function releaseCaptured(){
      if(!neckGrip&&!feetGrip)return false;
      const target=captive;
      for(const entry of [neckGrip,feetGrip]){
        if(!entry)continue;
        entry.role=null;entry.state='retracting';entry.cooldown=1;
      }
      neckGrip=null;feetGrip=null;captive=null;
      if(target?.resetAfterSnare)target.resetAfterSnare();
      else{target?.clearNeckGrip?.();target?.setRunning?.(true);target?.chooseTarget?.();}
      return true;
    }
    function previewDoubleGrip(target){
      // Author-only reproducible visual trigger: fast-forward actual root hands
      // into their two collider-grip roles without modifying game behavior.
      if(entries.length<2||!target)return false;
      releaseCaptured();
      assignGrip(entries[0],'neck',target);
      assignGrip(entries[1],'feet',target);
      return true;
    }
    function update(dt,target){
      if(closed||!target)return false;
      const actor=actorOf(target);if(!actor?.position)return false;
      dt=clamp(Number(dt)||0,0,.05);if(!dt)return false;
      gripPoint(target,'neck',neckPoint);gripPoint(target,'feet',feetPoint);
      let changed=false;
      for(const entry of entries){
        const hand=entry.hand,anchor=hand.anchor;
        entry.timer+=dt;entry.cooldown=Math.max(0,entry.cooldown-dt);
        if(entry.role){
          const grip=entry.role==='neck'?neckPoint:feetPoint;
          const distance=delta.subVectors(grip,anchor.point).length();
          const oldAim=hand.aim;
          hand.draw(dt,1,grip,Math.min(settings.reach,distance),1,false,true);
          if(oldAim.distanceToSquared(hand.aim)>.0001)entry.aims++;
          if(feetGrip&&target?.diagnostics?.()?.separated)entry.state='split-held';
          changed=true;continue;
        }
        if(feetGrip){ // A third root cannot independently grab an already suspended victim.
          if(entry.state==='approaching')entry.state='retracting';
        }
        const aim=neckGrip?feetPoint:neckPoint;
        const distance=delta.subVectors(aim,anchor.point).length();
        const near=distance<settings.triggerRadius;
        if(!feetGrip&&(entry.state==='dormant'||entry.state==='retracting')&&near&&entry.cooldown===0){
          entry.state='approaching';entry.lunges++;lunges++;entry.timer=0;
        }
        if(entry.state==='approaching'){
          const oldAim=hand.aim;
          entry.progress=clamp(entry.progress+dt*settings.extendSpeed,0,1);
          entry.reach=Math.min(settings.reach,Math.max(.2,distance));
          hand.draw(dt,entry.progress,aim,entry.reach,0,false);
          if(hand.aim.distanceToSquared(oldAim)>.0001)entry.aims++;
          // A palm sphere against the actual anatomical neck / feet anchor,
          // not the general detection radius, initiates a grip.
          if(entry.progress>=.58&&distance<=settings.reach+.58&&
            hand.collider.center.distanceTo(aim)<=hand.collider.radius+.28){
            assignGrip(entry,neckGrip?'feet':'neck',target);
          }else if(distance>settings.triggerRadius+.55){
            entry.state='retracting';entry.cooldown=.8;
          }
        }
        if(entry.state==='retracting'){
          entry.progress=clamp(entry.progress-dt*settings.retractSpeed,0,1);
          hand.draw(dt,entry.progress,aim,entry.reach,0,true);
          if(entry.progress<=0){entry.state='dormant';entry.cooldown=.6;hand.group.visible=false;}
        }
        if(entry.state!=='dormant')changed=true;
      }
      return changed;
    }
    return {group,anchors,settings,update,releaseCaptured,previewDoubleGrip,
      setNodeVisibility(v){for(const e of entries)e.marker.visible=!!v;},
      diagnostics(){const victim=captive?.diagnostics?.()||null;
        return {anchors:anchors.map(a=>({id:a.id,role:a.role,sourceRootNode:a.sourceKey,position:a.point.toArray()})),
          active:entries.filter(e=>e.state!=='dormant').length,lungeCount:lunges,
          caught:!!neckGrip,neckGrip:neckGrip?.hand.anchor.id||null,feetGrip:feetGrip?.hand.anchor.id||null,
          doubleGrabs,dual:!!feetGrip,split:!!victim?.separated,stretchSeconds:victim?.stretchSeconds||0,
          tugMultiplier:victim?.movementMultiplier??1,
          states:entries.map(e=>({node:e.hand.anchor.id,role:e.role||e.hand.anchor.role,state:e.state,
            progress:+e.progress.toFixed(3),lunges:e.lunges,reroutes:e.aims,
            digits:e.hand.digitCount,digitRoles:e.hand.digitRoles,
            wrapped:e.hand.fingerCurl.every(v=>v>.7)})),settings:{...settings}};},
      dispose(){if(closed)return;closed=true;releaseCaptured();group.parent?.remove(group);
        group.traverse(mesh=>{if(mesh.geometry)mesh.geometry.dispose();});
        material.dispose();markerMat.dispose();
      }};
  }
  root.RootSnareHands=Object.freeze({version:3,seeded,sourceNodes,findWallRootNodes,create});
})(typeof window!=='undefined'?window:globalThis);
