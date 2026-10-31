// Root-snare author NPC. The same repository portrait -> PNGPlaneAvatar ->
// ProceduralLegAnimation/LegBones pipeline as tools/animation-author, including
// character-specific torso width, pelvis and exact skinned neck pivot.
((root)=>{
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const SNARE_DB='config/npcs/hobunji-starter-npc-database.json';
  let databasePromise=null; // Cached author NPC database; shared by selector and preview rebuilds.
  function tugMultiplier(direction,towardSource){
    const a=direction?.clone?.(),b=towardSource?.clone?.();
    if(!a||!b)return 1;
    a.y=0;b.y=0;if(a.lengthSq()<1e-10||b.lengthSq()<1e-10)return 1;
    return 1.25+.75*clamp(a.normalize().dot(b.normalize()),-1,1);
  }
  async function npcDatabase(){
    if(!databasePromise){
      databasePromise=fetch(SNARE_DB).then(async response=>{
        if(!response.ok)throw Error('NPC database HTTP '+response.status);
        const json=await response.json(),records=Array.isArray(json)?json:json?.npcs||json?.npcDatabase||[];
        if(!Array.isArray(records)||!records.length)throw Error('NPC database contains no NPCs.');
        return records.filter(n=>n&&typeof n==='object'&&(n.appearance||n.species));
      }).catch(error=>{databasePromise=null;throw error;});
    }
    return databasePromise;
  }
  function appearanceFor(npc){
    const raw=npc.avatarEditor?.rawExport||{},profile=raw.profile||raw.avatarProfile||raw.npcProfile||raw;
    const appearance={...(profile.appearance||{}),...(profile.visuals?.appearance||{}),
      ...(raw.appearance||{}),...(npc.appearance||{})};
    appearance.speciesId=String(appearance.speciesId||appearance.species||npc.species||'mao_ao').replace(/_/g,'-');
    appearance.gender=['female','f'].includes(String(appearance.gender||npc.gender||'male').toLowerCase())?'female':'male';
    appearance.cosmetics={...(profile.appearance?.cosmetics||{}),...(raw.appearance?.cosmetics||{}),
      ...(npc.appearance?.cosmetics||{})};
    appearance.bodyColors={...(profile.appearance?.bodyColors||{}),...(raw.appearance?.bodyColors||{}),
      ...(npc.appearance?.bodyColors||{})};
    return appearance;
  }
  function exportNpcForPortrait(npc){
    const raw=npc.avatarEditor?.rawExport||{},profile=raw.profile||raw.avatarProfile||raw.npcProfile||raw;
    const toList=v=>Array.isArray(v)?v.filter(Boolean):v&&typeof v==='object'?Object.values(v).filter(x=>typeof x==='string'&&x):[];
    return {...npc,appearance:appearanceFor(npc),
      equippedCosmetics:toList(raw.equippedCosmetics||profile.equippedCosmetics||npc.equippedCosmetics),
      appliedDyes:raw.appliedDyes||profile.appliedDyes||npc.appliedDyes||{}};
  }
  async function loadNpcPortrait({id=null,seed='root-snare-npc'}={}){
    if(!root.NpcAvatarPreview||!root.PNGPlaneAvatar||!root.renderPortraitProfile)
      throw Error('Load the Animation Author NPC portrait and PNGPlaneAvatar runtimes before generating a snare NPC.');
    const records=await npcDatabase();
    await root.NpcAvatarPreview.ensurePortraitCosmetics({assetBase:'assets/',configBase:'config/'});
    const rng=root.RootSnareHands?.seeded?.(seed)||Math.random;
    const supported=root.getPortraitFighters?.()||[]; // The Animation Author's own portrait fighter list is authoritative.
    const eligible=records.filter(n=>{const a=appearanceFor(n);
      return a.speciesId!=='omgurku'&&supported.some(f=>{
        const species=String(f.speciesId||'').replace(/_/g,'-');
        const gender=f.gender||((f.id==='F')?'female':(f.id==='M')?'male':null);
        return species===a.speciesId&&(!gender||gender===a.gender);
      });
    });
    if(!eligible.length)throw Error('No non-Omgurku NPC is available for this preview.');
    const withPants=eligible.filter(n=>root.PantsGarmentRenderer?.garmentForCosmetics?.(exportNpcForPortrait(n).equippedCosmetics));
    const randomPool=withPants.length?withPants:eligible; // Default showcase favors a real NPC equipped with an authored pants/skirt rig.
    const npc=id?eligible.find(n=>String(n.id||n.name)===String(id)):randomPool[Math.floor(rng()*randomPool.length)];
    if(!npc)throw Error('Chosen NPC is not available in the loaded repository database.');
    const portraitNpc=exportNpcForPortrait(npc);
    const profile=root.NpcAvatarPreview.buildProfileFromNpcExport(portraitNpc);
    if(!profile)throw Error('Could not build a portrait profile for '+(npc.name||npc.id));
    const size=Number(root.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.previewPortraitCanvasSize)||200;
    const front=Object.assign(document.createElement('canvas'),{width:size,height:size});
    const back=Object.assign(document.createElement('canvas'),{width:size,height:size});
    await root.NpcAvatarPreview.renderProfileToCanvas(front,profile,{seatId:npc.id||npc.name||'snare'});
    await root.NpcAvatarPreview.renderProfileToCanvas(back,profile,{seatId:npc.id||npc.name||'snare',portraitView:'behind'});
    return {npc,portraitNpc,profile,front,back};
  }
  function create({THREE,room,seed='wall-hands-runner',speed=5,requireNpc=false}={}){
    if(!THREE||!room?.model)throw new TypeError('Root snare runner needs a prepared ruin.');
    const T=THREE,rng=root.RootSnareHands?.seeded?.(seed)||Math.random;
    const group=new T.Group();group.name='Repository NPC (procedural walking and snare)';
    const bodyPivot=new T.Group();bodyPivot.name='Neck-feet body-axis tilt pivot';group.add(bodyPivot);
    const upper=new T.Group(),lower=new T.Group();
    upper.name='Actual NPC neck and upper portrait rig';lower.name='Actual NPC pants + procedural feet rig';
    bodyPivot.add(upper,lower);
    let legs=null,actualAvatar=null,neckJoint=null,modelHeight=1.65,pelvisY=.75,footY=.18,neckY=1.38;
    let visualMode='awaiting-npc',disposed=false,syntheticMats=[];
    const floor=room.model.children.find(mesh=>mesh.userData?.ruinPreviewRole==='floor');
    const bounds=new T.Box3().setFromObject(floor||room.model),center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3());
    const edgeX=Math.max(.3,size.x*.5-.85),edgeZ=Math.max(.3,size.z*.5-.85),baseY=Number(room.floorY)||0;
    const destination=new T.Vector3(),heading=new T.Vector3(),velocity=new T.Vector3(),tugVector=new T.Vector3();
    const desiredVelocity=new T.Vector3(),motion=new T.Vector3();
    group.position.set(center.x,baseY,center.z);
    const startPosition=group.position.clone();
    let travel=0,turns=0,running=true,speedValue=clamp(Number(speed)||5,.3,8),elapsed=0,gripSource=null,movementMultiplier=1;
    let dual=null,splitCount=0,stretchBridge=null,portraitSource=null;
    const up=new T.Vector3(0,1,0),baseAxis=new T.Vector3(),targetAxis=new T.Vector3(),desiredMid=new T.Vector3();
    const neckStart=new T.Vector3(),feetStart=new T.Vector3(),neckGoal=new T.Vector3(),feetGoal=new T.Vector3();
    const gripResult=new T.Vector3();
    const spray=new T.Group();spray.name='Stylized blood particle splurt';group.add(spray);
    const red=new T.MeshBasicMaterial({color:0xbd2634,transparent:true,opacity:.95});
    const sprayRng=root.RootSnareHands?.seeded?.(seed+':spray')||Math.random;
    const droplets=[];
    for(let i=0;i<24;i++){
      const mesh=new T.Mesh(new T.SphereGeometry(.018+sprayRng()*.035,5,4),red);
      mesh.visible=false;spray.add(mesh);droplets.push({mesh,velocity:new T.Vector3(),life:0});
    }
    function createFallback(){
      // Only for isolated headless harnesses; the public author sets requireNpc=true
      // and never displays these temporary shapes in place of repository assets.
      const skin=new T.MeshBasicMaterial({color:0x826d58}),cloth=new T.MeshBasicMaterial({color:0x6d8a93});
      syntheticMats=[skin,cloth];visualMode='fixture';
      const head=new T.Mesh(new T.SphereGeometry(.19,12,9),skin);head.position.y=1.45;upper.add(head);
      const chest=new T.Mesh(new T.CylinderGeometry(.22,.26,.65,9),cloth);chest.position.y=1.01;upper.add(chest);
      for(const side of [-1,1]){
        const arm=new T.Group();arm.position.set(side*.265,1.24,0);
        const segment=new T.Mesh(new T.CylinderGeometry(.065,.055,.57,7),skin);
        segment.position.y=-.3;arm.add(segment);upper.add(arm);arm.userData.side=side;
      }
      const pants=new T.Mesh(new T.CylinderGeometry(.21,.25,.36,9),cloth);
      pants.position.y=.51;lower.add(pants);
      legs=root.ProceduralLegAnimation?.attach?.(T,lower,{name:'Preview fixture',speciesId:'maoao',
        gender:'male',modelWidth:.62,modelHeight:modelHeight})||null;
    }
    if(!requireNpc)createFallback();
    function maskedCanvas(src,splitY,part){
      const canvas=document.createElement('canvas');canvas.width=src.width;canvas.height=src.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(src,0,0);
      const data=ctx.getImageData(0,0,canvas.width,canvas.height);
      for(let y=0;y<canvas.height;y++)if((part==='upper'&&y>=splitY)||(part==='lower'&&y<splitY))
        for(let x=0;x<canvas.width;x++)data.data[(y*canvas.width+x)*4+3]=0;
      ctx.putImageData(data,0,0);return canvas;
    }
    function installAvatar(rendered){
      if(disposed)return false;
      if(!root.PNGPlaneAvatar?.buildSinglePlaneAvatarModel)throw Error('Real PNGPlaneAvatar renderer not loaded.');
      if(!rendered?.front||!rendered?.back||!rendered?.profile||!rendered?.npc)
        throw Error('A rendered repository NPC with front and rear portrait is required.');
      const {profile,npc,front,back}=rendered,appearance=rendered.portraitNpc?.appearance||appearanceFor(npc);
      const configured=Number(root.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.worldModelWidth);
      const baseWidth=Number.isFinite(configured)&&configured>0?configured:.9;
      const props={backCanvas:back,profile,appearance,npcRecord:npc,
        modelWidth:baseWidth,modelHeight:baseWidth,name:'Snare NPC · '+(npc.name||npc.id)};
      const source=root.PNGPlaneAvatar.buildSinglePlaneAvatarModel(T,front,{...props,neckRig:true});
      const h=Number(source.userData?.portraitModelHeight)||baseWidth,w=Number(source.userData?.portraitModelWidth)||baseWidth;
      const side=String(appearance.speciesId||profile.fighter?.speciesId||'mao_ao'),gender=String(appearance.gender||'male');
      const newLegs=root.ProceduralLegAnimation?.attach?.(T,lower,{name:'Snare '+(npc.name||npc.id),
        speciesId:side,gender,modelWidth:w,modelHeight:h,profile,bodyColors:profile.bodyColors,
        handAttachY:source.userData.handAttachY});
      if(!newLegs){
        root.PNGPlaneAvatar.disposeAvatarModel(source);
        throw Error('The selected NPC cannot use a humanoid procedural foot rig.');
      }
      const posterior=Number(newLegs.standingPosteriorY);
      const stance=newLegs.getRestStance?.();
      const ankle=(Number(stance?.left?.ankle?.y)+Number(stance?.right?.ankle?.y))*.5;
      const ratio=Number(source.userData?.portraitVerticalPlacementRatio)||.5;
      const splitPixel=clamp(Math.round(front.height*(.5+ratio-(Number.isFinite(posterior)?posterior:h*.42)/h)),front.height*.27,front.height*.87);
      const canvases={
        upperFront:maskedCanvas(front,splitPixel,'upper'),upperBack:maskedCanvas(back,splitPixel,'upper'),
        lowerFront:maskedCanvas(front,splitPixel,'lower'),lowerBack:maskedCanvas(back,splitPixel,'lower')
      };
      const upperModel=root.PNGPlaneAvatar.buildSinglePlaneAvatarModel(T,canvases.upperFront,{
        ...props,backCanvas:canvases.upperBack,neckRig:true,name:'Upper '+(npc.name||npc.id)});
      const lowerModel=root.PNGPlaneAvatar.buildSinglePlaneAvatarModel(T,canvases.lowerFront,{
        ...props,backCanvas:canvases.lowerBack,name:'Pants and lower '+(npc.name||npc.id)});
      root.PNGPlaneAvatar.disposeAvatarModel(source); // Derived models now own their own texture/geometry resources.
      legs?.dispose?.();
      for(const node of [...upper.children,...lower.children]){
        if(node===newLegs.group)continue;
        node.parent?.remove(node);node.traverse?.(child=>child.geometry?.dispose?.());
      }
      for(const m of syntheticMats)m.dispose();syntheticMats=[];
      upper.add(upperModel);lower.add(lowerModel);
      // The Animation Author separately skins each NPC's real equipped
      // trousers/skirt to the SAME procedural thigh/calf bones.
      const garment=root.PantsGarmentRenderer;
      const garmentId=garment?.garmentForCosmetics?.(rendered.portraitNpc.equippedCosmetics||[]);
      const garmentRecord=garmentId?root.HOBUNJI_PANTS_RIGS?.garments?.[garmentId]:null;
      const pantsHandle=garmentRecord&&garment?.attachToLegs?.(T,newLegs,{
        avatarGroup:lowerModel,speciesId:side,gender,garmentId,garmentRecord,
        appearance:garment.appearanceFromBodyColors?.(profile.bodyColors)||{},
        name:'Actual NPC pants '+(npc.name||npc.id)
      })||null;
      if(pantsHandle&&garment.buildOverlayMask){
        Promise.resolve(garment.buildOverlayMask(front,profile,{forceEyesOpen:true,seatId:'snare-pants:'+String(npc.id||npc.name)}))
          .then(mask=>{if(!disposed&&actualAvatar?.upperModel===upperModel&&!pantsHandle.disposed){
            pantsHandle.setOverlayMask?.(mask);pantsHandle.update?.();
          }}).catch(()=>{}); // Clothing-mask optional; actual dyed pants remain usable without it.
      }
      // Stretch the actual torso pigment instead of the old wooden-cylinder
      // stand-in: repeat a thin rendered portrait band across the gap.
      if(stretchBridge){stretchBridge.parent?.remove(stretchBridge);stretchBridge.geometry?.dispose();
        stretchBridge.material?.map?.dispose();stretchBridge.material?.dispose();}
      const band=document.createElement('canvas');band.width=front.width;band.height=Math.max(8,Math.round(front.height*.12));
      const bandCtx=band.getContext('2d');
      bandCtx.drawImage(front,0,clamp(splitPixel-band.height*.5,0,front.height-band.height),
        front.width,band.height,0,0,band.width,band.height);
      const bandTexture=new T.CanvasTexture(band);bandTexture.needsUpdate=true;
      stretchBridge=new T.Mesh(new T.PlaneGeometry(w*.7,1),
        new T.MeshBasicMaterial({map:bandTexture,transparent:true,alphaTest:.05,side:T.DoubleSide}));
      stretchBridge.name='Actual NPC stretched waist portrait band';
      stretchBridge.visible=false;bodyPivot.add(stretchBridge);
      legs=newLegs;actualAvatar={npc,profile,upperModel,lowerModel,canvases,pantsHandle};
      modelHeight=h;pelvisY=Number.isFinite(posterior)?posterior:h*.42;
      footY=Number.isFinite(ankle)?ankle:h*.06;
      neckJoint=upperModel.userData?.neckRig?.neckJoint||null;
      neckY=pelvisY+h*.44;
      if(neckJoint){
        upperModel.updateWorldMatrix(true,true);
        upper.worldToLocal(neckJoint.getWorldPosition(gripResult));
        neckY=gripResult.y;
      }
      bodyPivot.position.y=(neckY+footY)*.5;
      upper.position.y=lower.position.y=-bodyPivot.position.y;
      visualMode='repository-npc';
      group.userData.npcId=npc.id||null;group.userData.npcName=npc.name||npc.id||null;
      group.userData.portraitMode='PNGPlaneAvatar real NPC';
      return true;
    }
    function pointOf(which,out){
      const holder=which==='feet'?lower:upper;
      holder.updateWorldMatrix(true,true);
      if(which==='neck'&&neckJoint){
        neckJoint.getWorldPosition(out);
        return out;
      }
      out.set(0,which==='feet'?footY:neckY,0);
      holder.localToWorld(out);return out;
    }
    function getGripPoint(which,out){return pointOf(which,out||new T.Vector3());}
    function nextDestination(){destination.set(center.x+(rng()*2-1)*edgeX,baseY,center.z+(rng()*2-1)*edgeZ);turns++;}
    nextDestination();
    function setNeckGrip(anchor){gripSource=anchor?.point?.clone?.()||null;}
    function clearNeckGrip(){gripSource=null;movementMultiplier=1;}
    function updateSpray(dt){
      for(const p of droplets){if(p.life<=0)continue;p.life=Math.max(0,p.life-dt);
        p.velocity.y-=5*dt;p.mesh.position.addScaledVector(p.velocity,dt);
        p.mesh.visible=p.life>0;p.mesh.scale.setScalar(Math.max(.1,p.life/.85));}
    }
    function spawnSplurt(worldPoint){
      const at=group.worldToLocal(worldPoint.clone());
      for(const p of droplets){
        p.mesh.position.copy(at);
        p.velocity.set((sprayRng()-.5)*3,.8+sprayRng()*2.8,(sprayRng()-.5)*3);
        p.life=.35+sprayRng()*.5;p.mesh.visible=true;p.mesh.scale.setScalar(1);
      }
      splitCount++;
    }
    function startDualCapture(neckAnchor,feetAnchor){
      if(dual)return false;
      getGripPoint('neck',neckStart);getGripPoint('feet',feetStart);
      clearNeckGrip();running=false;velocity.set(0,0,0);
      dual={time:0,stretchTime:3,neckAnchor,feetAnchor,separated:false,lift:0,spread:0,
        initialCenter:neckStart.clone().add(feetStart).multiplyScalar(.5),tiltDeg:0};
      group.rotation.y=0;
      legs?.update?.(0,0,true,null,{airborne:true});
      return true;
    }
    function updateDualCapture(dt){
      if(!dual)return false;
      dt=clamp(Number(dt)||0,0,.05);dual.time+=dt;
      dual.lift=clamp(dual.time/.55,0,1)*1.35;
      const stretch=clamp((dual.time-.55)/dual.stretchTime,0,1);
      const nodeAxis=targetAxis.copy(dual.neckAnchor.point).sub(dual.feetAnchor.point);
      if(nodeAxis.lengthSq()<.0001)nodeAxis.set(0,1,0);
      else nodeAxis.normalize(); // No artificial pitch: the two gripping hands' relative origins dictate the actual body axis.
      // The hands, not an unrelated pitch tween, define the body orientation.
      // They are moved to these anatomical targets below, and the avatar tilt
      // follows the live vector between their neck and foot grips.
      const tiltProgress=clamp(dual.time/.75,0,1);
      baseAxis.copy(up).lerp(nodeAxis,tiltProgress).normalize();
      dual.tiltDeg=Math.acos(clamp(baseAxis.dot(up),-1,1))*180/Math.PI;
      const anatomical=Math.max(.2,neckY-footY),spread=stretch*1.65;
      desiredMid.copy(dual.initialCenter);desiredMid.y+=dual.lift;
      neckGoal.copy(desiredMid).addScaledVector(baseAxis,(anatomical+spread)*.5);
      feetGoal.copy(desiredMid).addScaledVector(baseAxis,-(anatomical+spread)*.5);
      // Joint-space rotation around the physical neck/feet midpoint makes
      // real portrait, pants and GLB feet tilt together without sprite drift.
      group.position.copy(desiredMid).addScaledVector(up,-bodyPivot.position.y);
      bodyPivot.quaternion.setFromUnitVectors(up,baseAxis);
      upper.position.set(0,-bodyPivot.position.y+spread*.5,0);
      lower.position.set(0,-bodyPivot.position.y-spread*.5,0);
      // Native feet hold the airborne (nonwalking) pose during the lift/split.
      legs?.update?.(dt,0,false,null,{airborne:true});
      dual.spread=spread;
      if(stretchBridge){
        stretchBridge.visible=!dual.separated&&stretch>.015;
        stretchBridge.position.set(0,-bodyPivot.position.y+pelvisY,0);
        stretchBridge.scale.y=Math.max(.01,spread);
      }
      if(stretch>=1&&!dual.separated){
        dual.separated=true;if(stretchBridge)stretchBridge.visible=false;
        group.updateWorldMatrix(true,true);
        const splitWorld=upper.localToWorld(new T.Vector3(0,pelvisY,0));
        spawnSplurt(splitWorld);
      }
      updateSpray(dt);return true;
    }
    function getGripTarget(which,out){
      const dest=out||new T.Vector3();
      if(dual)return dest.copy(which==='feet'?feetGoal:neckGoal);
      return getGripPoint(which,dest);
    }
    function resetAfterSnare(){
      clearNeckGrip();dual=null;running=true;movementMultiplier=1;
      group.position.copy(startPosition);group.rotation.set(0,0,0);bodyPivot.quaternion.identity();
      upper.position.set(0,-bodyPivot.position.y,0);lower.position.copy(upper.position);
      if(stretchBridge)stretchBridge.visible=false;velocity.set(0,0,0);
      for(const p of droplets){p.life=0;p.mesh.visible=false;}
      nextDestination();return true;
    }
    function runPastHand(anchor){
      if(!anchor?.point||!anchor?.direction)return false;
      resetAfterSnare();
      const limitX=x=>clamp(x,center.x-edgeX,center.x+edgeX),limitZ=z=>clamp(z,center.z-edgeZ,center.z+edgeZ);
      group.position.set(limitX(anchor.point.x+anchor.direction.x*3.1),baseY,limitZ(anchor.point.z+anchor.direction.z*3.1));
      destination.set(limitX(anchor.point.x+anchor.direction.x*.55),baseY,limitZ(anchor.point.z+anchor.direction.z*.55));return true;
    }
    function headToAnchor(away=false){
      if(!gripSource)return false;
      const dx=group.position.x-gripSource.x,dz=group.position.z-gripSource.z,length=Math.hypot(dx,dz);
      if(length<.0001)return false;
      heading.set(dx/length*(away?1:-1),0,dz/length*(away?1:-1));
      destination.set(clamp(group.position.x+heading.x*6,center.x-edgeX,center.x+edgeX),baseY,
        clamp(group.position.z+heading.z*6,center.z-edgeZ,center.z+edgeZ));
      velocity.set(0,0,0);return true;
    }
    function update(dt){
      dt=clamp(Number(dt)||0,0,.05);if(!dt||visualMode==='awaiting-npc')return false;
      if(dual)return updateDualCapture(dt);
      if(!running)return false;
      elapsed+=dt;heading.subVectors(destination,group.position);heading.y=0;
      if(heading.lengthSq()<.25){nextDestination();heading.subVectors(destination,group.position);heading.y=0;}
      if(heading.lengthSq()<1e-6)return false;
      heading.normalize();movementMultiplier=1;
      if(gripSource){
        tugVector.copy(gripSource).sub(group.position);tugVector.y=0;
        movementMultiplier=tugMultiplier(heading,tugVector);
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
      for(const node of upper.children)if(node.isGroup&&node.userData.side)
        node.rotation.x=node.userData.side*Math.sin(travel*6)*.46;
      legs?.update?.(dt,velocity.length(),false,null,{allowSpeedRun:true});
      updateSpray(dt);return true;
    }
    return {group,update,installAvatar,runPastHand,chooseTarget:nextDestination,getGripPoint,getGripTarget,
      setNeckGrip,clearNeckGrip,startDualCapture,updateDualCapture,resetAfterSnare,headToAnchor,
      setSpeed(value){speedValue=clamp(Number(value)||5,.3,8);},
      setRunning(value){running=!!value;},get running(){return running;},
      get hasRepositoryNpc(){return visualMode==='repository-npc';},
      diagnostics(){return {x:+group.position.x.toFixed(2),z:+group.position.z.toFixed(2),speed:speedValue,
        movementMultiplier:+movementMultiplier.toFixed(3),neckTether:!!gripSource,
        dual:!!dual,stretchSeconds:dual?.time??0,stretchDistance:dual?.spread??0,
        tiltedDegrees:dual?.tiltDeg||0,separated:!!dual?.separated,splitCount,turns,
        authenticFeet:!!legs,npcRig:visualMode,npcName:actualAvatar?.npc?.name||null,
        npcId:actualAvatar?.npc?.id||null,neckBone:!!neckJoint,authenticPants:!!actualAvatar?.pantsHandle,
        anatomy:{neckY,footY,pelvisY,modelHeight},elapsed:+elapsed.toFixed(2)};},
      dispose(){if(disposed)return;disposed=true;legs?.dispose?.();group.parent?.remove(group);
        if(actualAvatar){
          root.PNGPlaneAvatar?.disposeAvatarModel?.(actualAvatar.upperModel);
          root.PNGPlaneAvatar?.disposeAvatarModel?.(actualAvatar.lowerModel);
        }
        group.traverse(o=>{if(o.geometry)o.geometry.dispose();});
        stretchBridge?.material?.map?.dispose?.();stretchBridge?.material?.dispose?.();
        for(const m of syntheticMats)m.dispose();red.dispose();
      }
    };
  }
  root.RootSnareRunner=Object.freeze({create,tugMultiplier,npcDatabase,loadNpcPortrait});
})(typeof window!=='undefined'?window:globalThis);
