// Authored wall-root ambush preview. Anchors are picked once from generated root tube nodes;
// update() never searches scenery, moves anchors, or mutates the source vegetation.
((root)=>{
  'use strict';
  function seeded(seed){
    let state=2166136261;for(const ch of String(seed))state=Math.imul(state^ch.charCodeAt(0),16777619)>>>0;
    return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  }
  function findWallRootNodes(THREE,room,rootLayers,seed,count=6){
    if(!room?.model||!Array.isArray(rootLayers))return [];
    const rng=seeded(seed),worldCenter=new THREE.Box3().setFromObject(room.model).getCenter(new THREE.Vector3());
    const wallBoxes=[];room.model.updateWorldMatrix(true,true);
    room.model.traverse(mesh=>{if(mesh.isMesh&&mesh.userData?.ruinPreviewRole==='wall'){
      const bounds=new THREE.Box3().setFromObject(mesh);
      if(!bounds.isEmpty())wallBoxes.push(bounds);
    }});
    const candidates=[];const point=new THREE.Vector3(),center=new THREE.Vector3(),seen=new Set();
    for(const layer of rootLayers){
      layer?.updateWorldMatrix?.(true,true);
      layer?.traverse?.(mesh=>{
        if(!mesh.isMesh||!mesh.geometry)return;
        const position=mesh.geometry.getAttribute('position');
        if(!position||position.count<12||position.count%6)return; // Native root Wrap tubes have six vertices per ring.
        for(let ring=2;ring<position.count/6-2;ring+=18){
          point.set(0,0,0);
          for(let spoke=0;spoke<5;spoke++){
            const id=ring*6+spoke;
            point.x+=position.getX(id)*.2;point.y+=position.getY(id)*.2;point.z+=position.getZ(id)*.2;
          }
          mesh.localToWorld(point);room.model.worldToLocal(point);
          if(point.y<room.floorY+.65||point.y>room.floorY+2.5)continue;
          let distance=Infinity;for(const bounds of wallBoxes){
            const worldPoint=room.model.localToWorld(point.clone());
            distance=Math.min(distance,bounds.distanceToPoint(worldPoint));
          }
          if(distance>.46)continue; // A hand must have an actual wall-root node as its origin.
          const key=Math.round(point.x*3)+','+Math.round(point.y*3)+','+Math.round(point.z*3);
          if(seen.has(key))continue;seen.add(key);
          const direction=new THREE.Vector3(worldCenter.x-point.x,0,worldCenter.z-point.z);
          if(direction.lengthSq()<.01)continue;
          candidates.push({point:point.clone(),direction:direction.normalize(),key,rank:rng()});
        }
      });
    }
    candidates.sort((a,b)=>a.rank-b.rank);
    const chosen=[];
    for(const item of candidates){
      if(chosen.some(other=>other.point.distanceToSquared(item.point)<3.24))continue;
      chosen.push(item);
      if(chosen.length>=Math.min(14,Math.max(1,Math.round(count))))break;
    }
    return chosen.map((node,i)=>({id:'hidden_root_node_'+(i+1),point:node.point,direction:node.direction,sourceKey:node.key}));
  }
  function makeSegment(T,material,radius,name){
    const mesh=new T.Mesh(new T.CylinderGeometry(radius*.66,radius,1,6,1),material);
    mesh.name=name;mesh.castShadow=false;mesh.receiveShadow=false;return mesh;
  }
  function createHand(T,anchor,material){
    const group=new T.Group();group.name='Hidden branch snare · '+anchor.id;
    group.userData={hiddenRootNode:anchor.sourceKey,rootSnareId:anchor.id};
    const stem=[0,1,2].map(i=>{const mesh=makeSegment(T,material,[.07,.056,.042][i],'Growing wooden arm '+i);group.add(mesh);return mesh;});
    const palm=new T.Group();palm.name='Creeping palm';
    const palmShape=new T.Mesh(new T.SphereGeometry(1,7,5),material);
    palmShape.scale.set(.23,.17,.085);palm.add(palmShape);group.add(palm);
    const fingers=[];
    for(let i=0;i<5;i++){
      const fingerRoot=new T.Group();fingerRoot.name=i===4?'Hooking thumb':'Root finger '+(i+1);
      const x=i===4?-.23:(i-1.5)*.115;
      fingerRoot.position.set(x,i===4?-.04:.13,0);
      const bone=makeSegment(T,material,i===4?.044:.035,'Finger branch');
      bone.position.y=i===4?.09:.16;bone.scale.y=i===4?.20:.34;fingerRoot.add(bone);
      const joint=new T.Group();joint.position.y=i===4?.19:.31;
      const tip=makeSegment(T,material,.022,'Claw tip');
      tip.position.y=.10;tip.scale.y=.20;joint.add(tip);fingerRoot.add(joint);
      palm.add(fingerRoot);fingers.push({fingerRoot,joint,index:i});
    }
    const aim=new T.Vector3(),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),
      temp=new T.Vector3(),up=new T.Vector3(0,1,0);
    function draw(progress,target,reach,curl){
      if(progress<=.001){group.visible=false;return;}
      group.visible=true;const outward=anchor.direction;
      const toward=temp.copy(target).sub(anchor.point);
      toward.y=0;if(toward.lengthSq()>.001)toward.normalize();
      const direction=aim.copy(outward).multiplyScalar(.62).addScaledVector(toward,.38).normalize();
      const distance=Math.max(0,reach)*progress;
      a.copy(anchor.point);b.copy(a).addScaledVector(direction,distance*.46);b.y+=Math.sin(progress*Math.PI)*.12;
      c.copy(a).addScaledVector(direction,distance);c.y+=Math.sin(progress*Math.PI)*.07;
      const elbow=new T.Vector3().lerpVectors(b,c,.48);elbow.y+=.055*Math.sin(progress*Math.PI);
      const points=[a,b,elbow,c];
      for(let i=0;i<3;i++){
        const from=points[i],to=points[i+1],delta=new T.Vector3().subVectors(to,from);
        stem[i].position.copy(from).add(to).multiplyScalar(.5);
        stem[i].quaternion.setFromUnitVectors(up,delta.clone().normalize());
        stem[i].scale.y=Math.max(.001,delta.length());
        stem[i].visible=delta.lengthSq()>.00001;
      }
      palm.position.copy(c);palm.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),direction);
      palm.scale.setScalar(.25+.75*Math.min(1,progress*2));
      for(const finger of fingers){
        const t=finger.index===4?-1:1;
        finger.fingerRoot.rotation.z=t*(.12+curl*(finger.index===4?.78:.48));
        finger.joint.rotation.x=-curl*1.12;
      }
    }
    group.visible=false;return {group,draw,anchor};
  }
  function create({THREE,room,wallRootLayers,seed='root-snare',count=6,triggerRadius=2.5,reach=1.45,extendSpeed=2.4,retractSpeed=1.1,showNodes=false}={}){
    if(!THREE||!room?.model)throw new TypeError('Root snare preview requires THREE and a prepared author ruin room.');
    const anchors=findWallRootNodes(THREE,room,wallRootLayers,seed,count);
    const group=new THREE.Group();group.name='Wall-bound root snare hands';
    const material=new THREE.MeshBasicMaterial({color:0x24211d,side:THREE.DoubleSide});
    const markerMaterial=new THREE.MeshBasicMaterial({color:0xffae6b,depthTest:false});
    const entries=anchors.map(anchor=>{
      const hand=createHand(THREE,anchor,material);group.add(hand.group);
      const marker=new THREE.Mesh(new THREE.SphereGeometry(.065,7,5),markerMaterial);
      marker.position.copy(anchor.point);marker.visible=!!showNodes;marker.name='Show hidden branch node '+anchor.id;group.add(marker);
      return {hand,marker,progress:0,cooldown:0,lunges:0,state:'dormant'};
    });
    let activated=0,closed=false;
    const targetPoint=new THREE.Vector3();
    const bound=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
    const settings={count,triggerRadius:bound(Number(triggerRadius)||2.5,.5,7),reach:bound(Number(reach)||1.45,.3,4),
      extendSpeed:bound(Number(extendSpeed)||2.4,.15,12),retractSpeed:bound(Number(retractSpeed)||1.1,.15,12)};
    return {group,anchors,settings,update(dt,target){
      if(closed||!target)return false;
      dt=bound(Number(dt)||0,0,.05);if(!dt)return false;
      targetPoint.copy(target.position||target);targetPoint.y=targetPoint.y+1.0;
      let changed=false;
      for(const entry of entries){
        const {hand}=entry,anchor=hand.anchor;
        const delta=targetPoint.clone().sub(anchor.point),horizontal=Math.hypot(delta.x,delta.z);
        const inFront=delta.x*anchor.direction.x+delta.z*anchor.direction.z>-.1;
        const near=inFront&&horizontal<settings.triggerRadius&&Math.abs(delta.y)<1.85;
        const remain=inFront&&horizontal<settings.triggerRadius+.55&&Math.abs(delta.y)<2.1;
        entry.cooldown=Math.max(0,entry.cooldown-dt);
        if(near&&entry.cooldown<=0&&entry.progress<.02){entry.lunges++;activated++;entry.cooldown=2.3;entry.state='snatching';}
        const targetProgress=near||(remain&&entry.progress>.02)?1:0;
        const previous=entry.progress;
        entry.progress=bound(entry.progress+(targetProgress?settings.extendSpeed:-settings.retractSpeed)*dt,0,1);
        if(entry.progress<=.01&&!remain)entry.state='dormant';
        else if(!remain)entry.state='retracting';
        else if(entry.progress>=.99)entry.state='grasping';
        const curl=bound((settings.reach-horizontal)*1.6+.35,0,1)*entry.progress;
        if(entry.progress>.001||previous>.001){hand.draw(entry.progress,targetPoint,Math.min(settings.reach,Math.max(.22,horizontal+.24)),curl);changed=true;}
      }
      return changed;
    },setNodeVisibility(value){for(const entry of entries)entry.marker.visible=!!value;},
      diagnostics(){return {anchors:anchors.map(a=>({id:a.id,sourceRootNode:a.sourceKey,position:a.point.toArray()})),
        active:entries.filter(e=>e.progress>.03).length,lungeCount:activated,
        states:entries.map(e=>({node:e.hand.anchor.id,state:e.state,progress:+e.progress.toFixed(3),lunges:e.lunges})),settings:{...settings}};},
      dispose(){if(closed)return;closed=true;group.parent?.remove(group);group.traverse(o=>{if(o.geometry)o.geometry.dispose();});material.dispose();markerMaterial.dispose();}
    };
  }
  root.RootSnareHands=Object.freeze({version:1,seeded,findWallRootNodes,create});
})(typeof window!=='undefined'?window:globalThis);
