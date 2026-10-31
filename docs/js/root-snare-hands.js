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
    function draw(dt,progress,target,reach,curl,locked=false){
      if(progress<=.0001&&!locked){group.visible=false;return;}
      group.visible=true;hasDrawn=true;
      if(!locked){
        desired.copy(target).sub(anchor.point);
        if(desired.lengthSq()<.00001)desired.copy(anchor.direction);
        desired.normalize();
        // Reroute *all three* arm joints toward the target even halfway
        // through extension, retaining a bias toward the original root.
        desired.multiplyScalar(.91).addScaledVector(anchor.direction,.09).normalize();
        lastAim.lerp(desired,clamp(dt*11,0,1)).normalize();
      }
      const distance=clamp(reach,0,4)*progress,curve=.15*Math.sin(Math.PI*progress);
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
  function create({THREE,room,rootLayers,wallRootLayers,seed='root-snare',count=6,triggerRadius=2.5,
    reach=1.45,extendSpeed=2.4,retractSpeed=1.1,showNodes=false,foliage}={}){
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
      marker.name='Show hidden branch node '+anchor.id;marker.position.copy(anchor.point);marker.visible=!!showNodes;group.add(marker);
      return {hand,marker,progress:0,reach:0,cooldown:0,state:'dormant',
        timer:0,lunges:0,aims:0}; // The root node remains fixed and the capture stays held until manually released.
    });
    const settings={triggerRadius:clamp(Number(triggerRadius)||2.5,.5,7),
      reach:clamp(Number(reach)||1.45,.3,4),extendSpeed:clamp(Number(extendSpeed)||2.4,.15,12),
      retractSpeed:clamp(Number(retractSpeed)||1.1,.15,12)};
    const targetPoint=new T.Vector3(),scratch=new T.Vector3(),carry=new T.Vector3();
    let caught=null,closed=false,lunges=0;
    function actorOf(target){return target?.group||target;}
    function capture(entry,target,actor){
      caught={entry,target,actor}; // The grasp owns the runner until the author explicitly releases it.
      target.setRunning?.(false); // Stop the shared procedural-walk driver, not the render loop.
      entry.state='pulling';entry.timer=0;entry.progress=Math.max(entry.progress,.15);
    }
    function releaseCaptured(){
      if(!caught)return false;
      const {target,entry}=caught;
      caught=null;
      entry.state='retracting';entry.cooldown=1;
      target.setRunning?.(true);
      target.chooseTarget?.();
      return true;
    }
    function update(dt,target){
      if(closed||!target)return false;
      const actor=actorOf(target);if(!actor?.position)return false;
      dt=clamp(Number(dt)||0,0,.05);if(!dt)return false;
      targetPoint.copy(actor.position);targetPoint.y+=1; // Character's chest position drives the spherical palm collider.
      let changed=false;
      for(const entry of entries){
        const hand=entry.hand,anchor=hand.anchor;
        entry.timer+=dt;entry.cooldown=Math.max(0,entry.cooldown-dt);
        if(caught&&caught.entry!==entry)continue;
        const nearDistance=scratch.subVectors(targetPoint,anchor.point).length();
        const near=nearDistance<settings.triggerRadius;
        if(!caught && (entry.state==='dormant'||entry.state==='retracting') &&near&&entry.cooldown===0){
          entry.state='approaching';entry.lunges++;lunges++;entry.timer=0;entry.reach=Math.max(.35,nearDistance);
        }
        if(entry.state==='approaching'){
          const priorAim=hand.aim;
          entry.progress=clamp(entry.progress+dt*settings.extendSpeed,0,1);
          entry.reach=Math.min(settings.reach,Math.max(.2,nearDistance));
          hand.draw(dt,entry.progress,targetPoint,entry.reach,0,false);
          if(hand.aim.distanceToSquared(priorAim)>.0001)entry.aims++;
          // Actual collision, not merely coming within the detection radius.
          if(entry.progress>=.58 && nearDistance<=settings.reach+.58 &&
            hand.collider.center.distanceTo(targetPoint)<=hand.collider.radius+.25){ // Approach visibly opens before contact can wrap the digits.
            capture(entry,target,actor);
          }else if(nearDistance>settings.triggerRadius+.55){
            entry.state='retracting';entry.cooldown=.8;
          }
        }
        if(entry.state==='retracting'){
          entry.progress=clamp(entry.progress-dt*settings.retractSpeed,0,1);
          hand.draw(dt,entry.progress,targetPoint,entry.reach,0,true);
          if(entry.progress<=0){entry.state='dormant';entry.cooldown=.6;hand.group.visible=false;} // A manually released captive must not leave an exposed palm knot.
        }else if(entry.state==='pulling'&&caught?.entry===entry){
          // The entire arm retreats along its own branch path while the hand
          // stays closed; the captive is lerped into that moving palm.
          entry.progress=clamp(entry.progress-dt*settings.retractSpeed*.72,0,1);
          hand.draw(dt,entry.progress,targetPoint,entry.reach,1,true);
          carry.copy(hand.palmPosition).addScaledVector(hand.aim,.18);
          carry.y-=.85; // NPC root remains beneath the center of its trapped torso.
          actor.position.lerp(carry,clamp(dt*13,0,1));
          if(entry.progress<=.001&&actor.position.distanceToSquared(carry)<.01){
            entry.state='held';entry.timer=0;
          }
        }else if(entry.state==='held'&&caught?.entry===entry){
          // Intentionally terminal for now: no devouring, shrinking, removal
          // or automatic release until the rest of the encounter is designed.
          hand.draw(dt,0,targetPoint,0,1,true);
          carry.copy(hand.palmPosition).addScaledVector(hand.aim,.18);
          carry.y-=.85;
          actor.position.lerp(carry,clamp(dt*13,0,1));
        }
        if(entry.state!=='dormant')changed=true; // Dormant hidden roots do not force a redundant preview render each frame.
      }
      return changed;
    }
    return {group,anchors,settings,update,releaseCaptured,setNodeVisibility(v){for(const e of entries)e.marker.visible=!!v;},
      diagnostics(){return {anchors:anchors.map(a=>({id:a.id,role:a.role,sourceRootNode:a.sourceKey,position:a.point.toArray()})),
        active:entries.filter(e=>e.progress>.03||e.state==='held').length,lungeCount:lunges,
        caught:!!caught,held:entries.filter(e=>e.state==='held').length,
        states:entries.map(e=>({node:e.hand.anchor.id,role:e.hand.anchor.role,state:e.state,
          progress:+e.progress.toFixed(3),lunges:e.lunges,reroutes:e.aims,digits:e.hand.digitCount,
          digitRoles:e.hand.digitRoles,wrapped:e.hand.fingerCurl.every(v=>v>.7)})),settings:{...settings}};},
      dispose(){if(closed)return;closed=true;releaseCaptured();group.parent?.remove(group);
        group.traverse(mesh=>{if(mesh.geometry)mesh.geometry.dispose();});
        material.dispose();markerMat.dispose();
      }};
  }
  root.RootSnareHands=Object.freeze({version:2,seeded,sourceNodes,findWallRootNodes,create});
})(typeof window!=='undefined'?window:globalThis);
