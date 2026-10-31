// Moving author-only NPC for root ambush timing. Uses the same ProceduralLegAnimation
// rig and LegBones solve as the procedural walking editor/game; no game world is modified.
((root)=>{
  'use strict';
  function create({THREE,room,seed='wall-hands-runner',speed=2.5}={}){
    if(!THREE||!room?.model)throw new TypeError('Root snare runner needs a prepared ruin.');
    const random=root.RootSnareHands?.seeded?.(seed)||Math.random;
    const group=new THREE.Group();group.name='Simulated running NPC (procedural walk)';
    const body=new THREE.Group();group.add(body);
    const wood=new THREE.MeshBasicMaterial({color:0x826d58}),cloth=new THREE.MeshBasicMaterial({color:0x6d8a93});
    const head=new THREE.Mesh(new THREE.SphereGeometry(.19,12,9),wood);head.position.y=1.45;body.add(head);
    const chest=new THREE.Mesh(new THREE.CylinderGeometry(.22,.26,.65,9),cloth);chest.position.y=1.01;body.add(chest);
    for(const side of [-1,1]){
      const arm=new THREE.Group();arm.position.set(side*.265,1.24,0);
      const limb=new THREE.Mesh(new THREE.CylinderGeometry(.065,.055,.57,7),wood);limb.position.y=-.30;arm.add(limb);body.add(arm);
      arm.userData.side=side;
    }
    const legs=root.ProceduralLegAnimation?.attach?.(THREE,group,{
      name:'Root snare preview walker',speciesId:'maoao',gender:'male',modelWidth:.62,modelHeight:1.65,
    })||null; // Uses authentic procedural planted/swinging feet, not a simulated leg sine-wave.
    const floor=room.model.children.find(mesh=>mesh.userData?.ruinPreviewRole==='floor');
    const bounds=new THREE.Box3().setFromObject(floor||room.model);
    const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
    const edgeX=Math.max(.3,size.x*.5-.85),edgeZ=Math.max(.3,size.z*.5-.85);
    const target=new THREE.Vector3(center.x,0,center.z),heading=new THREE.Vector3(),velocity=new THREE.Vector3();
    const baseY=Number(room.floorY)||0;group.position.set(center.x,baseY,center.z);
    let travel=0,turns=0,enabled=true,chosenSpeed=Math.max(.3,Math.min(5,Number(speed)||2.5)),elapsed=0;
    function nextDestination(){target.set(center.x+(random()*2-1)*edgeX,baseY,center.z+(random()*2-1)*edgeZ);turns++;}
    nextDestination();
    function update(dt){
      if(!enabled)return false;
      dt=Math.max(0,Math.min(.05,Number(dt)||0));if(!dt)return false;
      elapsed+=dt;heading.subVectors(target,group.position);heading.y=0;
      if(heading.lengthSq()<.25){nextDestination();heading.subVectors(target,group.position);heading.y=0;}
      if(heading.lengthSq()<1e-6)return false;
      heading.normalize();
      velocity.lerp(heading.clone().multiplyScalar(chosenSpeed),Math.min(1,dt*4.5));
      const step=velocity.clone().multiplyScalar(dt);
      const remaining=target.distanceTo(group.position);if(step.length()>remaining)step.copy(heading).multiplyScalar(remaining); // Avoid overshooting a waypoint during a low-FPS frame.
      group.position.x=Math.min(center.x+edgeX,Math.max(center.x-edgeX,group.position.x+step.x));
      group.position.z=Math.min(center.z+edgeZ,Math.max(center.z-edgeZ,group.position.z+step.z));
      group.rotation.y=Math.atan2(velocity.x,velocity.z);
      travel+=step.length();
      chest.rotation.z=Math.sin(travel*8)*.035;
      body.children.filter(x=>x.isGroup&&x.userData.side).forEach(x=>{x.rotation.x=x.userData.side*Math.sin(travel*6)*.46;});
      legs?.update?.(dt,velocity.length(),false,null,{});
      return true;
    }
    function runPastHand(anchor){
      if(!anchor?.point||!anchor?.direction)return false;
      const d=anchor.direction; // Start in the open interior and run toward this exact concealed node for mobile visual inspection.
      const limitX=x=>Math.max(center.x-edgeX,Math.min(center.x+edgeX,x));
      const limitZ=z=>Math.max(center.z-edgeZ,Math.min(center.z+edgeZ,z));
      group.position.set(limitX(anchor.point.x+d.x*3.1),baseY,limitZ(anchor.point.z+d.z*3.1));
      target.set(limitX(anchor.point.x+d.x*.55),baseY,limitZ(anchor.point.z+d.z*.55));
      velocity.set(0,0,0);enabled=true;return true;
    }
    let closed=false;return {group,update,chooseTarget:nextDestination,runPastHand,setSpeed(v){chosenSpeed=Math.max(.3,Math.min(5,Number(v)||2.5));},
      setRunning(on){enabled=!!on;},get running(){return enabled;},
      diagnostics(){return {x:+group.position.x.toFixed(2),z:+group.position.z.toFixed(2),target:target.toArray(),speed:chosenSpeed,turns,
        authenticFeet:!!legs,elapsed:+elapsed.toFixed(2)};},
      dispose(){if(closed)return;closed=true;legs?.dispose?.();group.parent?.remove(group);group.traverse(o=>{o.geometry?.dispose();});wood.dispose();cloth.dispose();}
    };
  }
  root.RootSnareRunner=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
