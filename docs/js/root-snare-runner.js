// Author-only wandering NPC. Gameplay's ProceduralLegAnimation still drives
// the feet; this preview adds grip anchors, directional tug and cartoon split.
((root)=>{
  'use strict';
  const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
  // Directional tug: directly toward the source = 2× movement, away = ½×.
  // Dot-product blending gives 1.25× at 90 degrees (the arithmetic midpoint).
  function tugMultiplier(direction,towardSource){
    const a=direction?.clone?.(),b=towardSource?.clone?.();
    if(!a||!b||a.lengthSq()<1e-10||b.lengthSq()<1e-10)return 1;
    a.y=0;b.y=0;if(a.lengthSq()<1e-10||b.lengthSq()<1e-10)return 1;
    return 1.25+.75*clamp(a.normalize().dot(b.normalize()),-1,1);
  }
  function create({THREE,room,seed='wall-hands-runner',speed=5}={}){
    if(!THREE||!room?.model)throw new TypeError('Root snare runner needs a prepared ruin.');
    const T=THREE,random=root.RootSnareHands?.seeded?.(seed)||Math.random;
    const group=new T.Group();group.name='Simulated running NPC (procedural walk)';
    const upper=new T.Group(),lower=new T.Group();upper.name='Upper torso and neck';lower.name='Pants and procedural feet';
    group.add(upper,lower);
    const wood=new T.MeshBasicMaterial({color:0x826d58}),cloth=new T.MeshBasicMaterial({color:0x6d8a93});
    const head=new T.Mesh(new T.SphereGeometry(.19,12,9),wood);head.position.y=1.45;upper.add(head);
    const chest=new T.Mesh(new T.CylinderGeometry(.22,.26,.65,9),cloth);chest.position.y=1.01;upper.add(chest);
    for(const side of [-1,1]){
      const arm=new T.Group();arm.position.set(side*.265,1.24,0);
      const limb=new T.Mesh(new T.CylinderGeometry(.065,.055,.57,7),wood);limb.position.y=-.3;arm.add(limb);
      upper.add(arm);arm.userData.side=side;
    }
    const pants=new T.Mesh(new T.CylinderGeometry(.21,.25,.36,9),cloth);pants.name='Lower half pants separation';
    pants.position.y=.51;lower.add(pants);
    const legs=root.ProceduralLegAnimation?.attach?.(T,lower,{
      name:'Root snare preview walker',speciesId:'maoao',gender:'male',modelWidth:.62,modelHeight:1.65,
    })||null; // The same authentic leg/foot runtime ported from the Procedural Animation Editor.
    const bridge=new T.Mesh(new T.CylinderGeometry(.16,.16,1,8),wood);
    bridge.name='Cartoon stretchable torso';bridge.visible=false;group.add(bridge);
    const spray=new T.Group();spray.name='Stylized blood particle splurt';group.add(spray);
    const red=new T.MeshBasicMaterial({color:0xbd2634,transparent:true,opacity:.95});
    const particles=[]; // Reused authored droplets; no allocations or scene traversal during the spray.
    const randomSpray=root.RootSnareHands?.seeded?.(seed+':spray')||Math.random;
    for(let i=0;i<24;i++){
      const mesh=new T.Mesh(new T.SphereGeometry(.018+randomSpray()*.035,5,4),red);
      mesh.visible=false;spray.add(mesh);
      particles.push({mesh,velocity:new T.Vector3(),life:0});
    }
    const floor=room.model.children.find(mesh=>mesh.userData?.ruinPreviewRole==='floor');
    const bounds=new T.Box3().setFromObject(floor||room.model);
    const center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3());
    const edgeX=Math.max(.3,size.x*.5-.85),edgeZ=Math.max(.3,size.z*.5-.85);
    const destination=new T.Vector3(center.x,0,center.z),heading=new T.Vector3(),velocity=new T.Vector3();
    const tugVector=new T.Vector3(),desiredVelocity=new T.Vector3(),motion=new T.Vector3();
    const baseY=Number(room.floorY)||0;group.position.set(center.x,baseY,center.z);
    const defaultPosition=group.position.clone();
    let travel=0,turns=0,running=true,speedValue=clamp(Number(speed)||5,.3,8),elapsed=0;
    let gripSource=null,movementMultiplier=1,dual=null,splitCount=0;
    const gripCache=new T.Vector3(),torsoA=new T.Vector3(),torsoB=new T.Vector3();
    function pointOf(which,out){
      const holder=which==='feet'?lower:upper;
      holder.updateWorldMatrix(true,false);
      out.set(0,which==='feet'?.18:1.38,0);
      holder.localToWorld(out);return out;
    }
    function getGripPoint(which,out){return pointOf(which,out||new T.Vector3());}
    function nextDestination(){
      destination.set(center.x+(random()*2-1)*edgeX,baseY,center.z+(random()*2-1)*edgeZ);
      turns++;
    }
    nextDestination();
    function setNeckGrip(anchor){gripSource=anchor?.point?.clone?.()||null;} // Used by the single-hand running tug, not an immobilizer.
    function clearNeckGrip(){gripSource=null;movementMultiplier=1;}
    function updateSpray(dt){
      for(const particle of particles){
        if(particle.life<=0)continue;
        particle.life=Math.max(0,particle.life-dt);
        particle.velocity.y-=5*dt;
        particle.mesh.position.addScaledVector(particle.velocity,dt);
        particle.mesh.visible=particle.life>0;
        particle.mesh.scale.setScalar(Math.max(.1,particle.life/.85));
      }
    }
    function spawnSplurt(worldPoint){
      const origin=group.worldToLocal(worldPoint.clone());
      for(const particle of particles){
        particle.mesh.position.copy(origin);
        particle.velocity.set((randomSpray()-.5)*3,(.8+randomSpray()*2.8),(randomSpray()-.5)*3);
        particle.life=.35+randomSpray()*.5;
        particle.mesh.visible=true;particle.mesh.scale.setScalar(1);
      }
      splitCount++;
    }
    function startDualCapture(neckAnchor,feetAnchor){
      if(dual)return false;
      clearNeckGrip();running=false;velocity.set(0,0,0);
      dual={time:0,stretchTime:3,neckAnchor,feetAnchor,separated:false,lift:0,spread:0};
      return true;
    }
    function updateDualCapture(dt){
      if(!dual)return false;
      dt=clamp(Number(dt)||0,0,.05);
      dual.time+=dt;
      dual.lift=clamp(dual.time/.55,0,1)*1.35;
      group.position.y=baseY+dual.lift;
      const stretch=clamp((dual.time-.55)/dual.stretchTime,0,1);
      // Pull toward each hand's own original source; vertical lift keeps both
      // gripping tips visibly clear of the floor throughout the sequence.
      const axis=tugVector.copy(dual.neckAnchor.point).sub(dual.feetAnchor.point);
      axis.y=.6;if(axis.lengthSq()<.01)axis.set(0,1,0);axis.normalize();
      const distance=stretch*1.65;
      upper.position.copy(axis).multiplyScalar(distance*.5);
      lower.position.copy(axis).multiplyScalar(-distance*.5);
      const top=torsoA.copy(upper.position).add(new T.Vector3(0,.79,0));
      const bottom=torsoB.copy(lower.position).add(new T.Vector3(0,.7,0));
      const middle=new T.Vector3().addVectors(top,bottom).multiplyScalar(.5);
      const bridgeVector=new T.Vector3().subVectors(top,bottom),length=bridgeVector.length();
      bridge.position.copy(middle);
      bridge.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),bridgeVector.normalize());
      bridge.scale.set(.8,Math.max(.01,length),.8);
      bridge.visible=!dual.separated&&stretch>.03;
      dual.spread=distance;
      if(stretch>=1&&!dual.separated){
        dual.separated=true;bridge.visible=false;
        group.updateWorldMatrix(true,true);
        spawnSplurt(group.localToWorld(middle.clone()));
      }
      updateSpray(dt);return true;
    }
    function resetAfterSnare(){
      clearNeckGrip();dual=null;running=true;movementMultiplier=1;
      group.position.copy(defaultPosition);upper.position.set(0,0,0);lower.position.set(0,0,0);
      group.scale.set(1,1,1);bridge.visible=false;velocity.set(0,0,0);
      for(const p of particles){p.life=0;p.mesh.visible=false;}
      nextDestination();return true;
    }
    function runPastHand(anchor){
      if(!anchor?.point||!anchor?.direction)return false;
      resetAfterSnare();
      const limitX=x=>clamp(x,center.x-edgeX,center.x+edgeX),limitZ=z=>clamp(z,center.z-edgeZ,center.z+edgeZ);
      group.position.set(limitX(anchor.point.x+anchor.direction.x*3.1),baseY,limitZ(anchor.point.z+anchor.direction.z*3.1));
      destination.set(limitX(anchor.point.x+anchor.direction.x*.55),baseY,limitZ(anchor.point.z+anchor.direction.z*.55));
      return true;
    }
    function headToAnchor(away=false){
      if(!gripSource)return false;
      const dx=group.position.x-gripSource.x,dz=group.position.z-gripSource.z;
      const length=Math.hypot(dx,dz);
      if(length<.0001)return false;
      heading.set(dx/length*(away?1:-1),0,dz/length*(away?1:-1));
      destination.set(clamp(group.position.x+heading.x*6,center.x-edgeX,center.x+edgeX),baseY,
        clamp(group.position.z+heading.z*6,center.z-edgeZ,center.z+edgeZ));
      velocity.set(0,0,0);return true;
    }
    function update(dt){
      dt=clamp(Number(dt)||0,0,.05);if(!dt)return false;
      if(dual)return updateDualCapture(dt);
      if(!running)return false;
      elapsed+=dt;heading.subVectors(destination,group.position);heading.y=0;
      if(heading.lengthSq()<.25){nextDestination();heading.subVectors(destination,group.position);heading.y=0;}
      if(heading.lengthSq()<1e-6)return false;
      heading.normalize();
      movementMultiplier=1;
      if(gripSource){
        tugVector.copy(gripSource).sub(group.position);tugVector.y=0;
        movementMultiplier=tugMultiplier(heading,tugVector);
        // Weak lateral tether nudges direction but never fully takes away player agency.
        if(tugVector.lengthSq()>.001)heading.lerp(tugVector.normalize(),.08).normalize();
      }
      desiredVelocity.copy(heading).multiplyScalar(speedValue*movementMultiplier);
      velocity.lerp(desiredVelocity,clamp(dt*6,0,1));
      motion.copy(velocity).multiplyScalar(dt);
      const remaining=destination.distanceTo(group.position);
      if(motion.length()>remaining)motion.copy(heading).multiplyScalar(remaining);
      group.position.x=clamp(group.position.x+motion.x,center.x-edgeX,center.x+edgeX);
      group.position.z=clamp(group.position.z+motion.z,center.z-edgeZ,center.z+edgeZ);
      group.rotation.y=Math.atan2(velocity.x,velocity.z);
      travel+=motion.length();
      chest.rotation.z=Math.sin(travel*8)*.035;
      for(const node of upper.children)if(node.isGroup&&node.userData.side)
        node.rotation.x=node.userData.side*Math.sin(travel*6)*.46;
      legs?.update?.(dt,velocity.length(),false,null,{});
      updateSpray(dt);return true;
    }
    let closed=false;
    return {group,update,runPastHand,chooseTarget:nextDestination,getGripPoint,
      setNeckGrip,clearNeckGrip,startDualCapture,updateDualCapture,resetAfterSnare,headToAnchor,
      setSpeed(value){speedValue=clamp(Number(value)||5,.3,8);},
      setRunning(value){running=!!value;},get running(){return running;},
      diagnostics(){return {x:+group.position.x.toFixed(2),z:+group.position.z.toFixed(2),speed:speedValue,
        movementMultiplier:+movementMultiplier.toFixed(3),neckTether:!!gripSource,
        dual:!!dual,stretchSeconds:dual?.time??0,stretchDistance:dual?.spread??0,
        separated:!!dual?.separated,splitCount,turns,authenticFeet:!!legs,elapsed:+elapsed.toFixed(2)};},
      dispose(){if(closed)return;closed=true;legs?.dispose?.();group.parent?.remove(group);
        group.traverse(o=>{o.geometry?.dispose();});wood.dispose();cloth.dispose();red.dispose();}
    };
  }
  root.RootSnareRunner=Object.freeze({create,tugMultiplier});
})(typeof window!=='undefined'?window:globalThis);
