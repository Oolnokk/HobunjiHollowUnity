// Reusable camera-relative PNG-plane marker + optional rope suspension.
//
// Suspension deliberately does NOT own a game-time/weather loop. Root Totems
// sample the same uTime/uStrength uniforms already updated for vegetation.
(() => {
  'use strict';

  const worldPosition=new THREE.Vector3(), suspensionWorldPosition=new THREE.Vector3();
  const cameraPosition=new THREE.Vector3(), parentQuaternion=new THREE.Quaternion();
  const parentEuler=new THREE.Euler(0,0,0,'YXZ');
  let perpRotationInitialized=false;
  const sharedRopeTextures=new Map();
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

  function angleDiff(a,b){let d=(a-b+Math.PI)%(Math.PI*2);if(d<0)d+=Math.PI*2;return d-Math.PI;}
  function nearestAngleAmong(current,angles){let best=angles[0]??current,bestAbs=Infinity;for(const angle of angles||[]){const distance=Math.abs(angleDiff(angle,current));if(distance<bestAbs){best=angle;bestAbs=distance;}}return best;}
  function requireDependencies(){if(!window.THREE)throw new Error('DeadzoneBillboard requires THREE.');if(!window.PerpRotation?.perpClamp)throw new Error('DeadzoneBillboard requires PerpRotation.');if(!window.SpriteRecolor?.getRecoloredCanvas)throw new Error('DeadzoneBillboard requires SpriteRecolor.');}
  function ensurePerpRotationReady(){if(perpRotationInitialized||!window.PerpRotation?.init)return;window.PerpRotation.init({angleDiff});perpRotationInitialized=true;}

  function localCameraPerps(marker,camera){
    marker.getWorldPosition(worldPosition);camera.getWorldPosition(cameraPosition);
    const viewYawWorld=Math.atan2(cameraPosition.x-worldPosition.x,cameraPosition.z-worldPosition.z);
    let parentYaw=0;
    if(marker.parent){marker.parent.getWorldQuaternion(parentQuaternion);parentEuler.setFromQuaternion(parentQuaternion,'YXZ');parentYaw=parentEuler.y;}
    return [viewYawWorld+Math.PI/2-parentYaw,viewYawWorld-Math.PI/2-parentYaw];
  }
  function updateFacing(marker,camera){
    if(!marker||!camera||!window.PerpRotation?.perpClamp)return;
    ensurePerpRotationReady();
    const perps=localCameraPerps(marker,camera),state=marker.userData.perpState||(marker.userData.perpState={});
    const rawTarget=nearestAngleAmong(marker.rotation.y,perps),settings=marker.userData.deadzoneBillboard||{};
    const deadRad=Number.isFinite(Number(settings.deadRad))?Number(settings.deadRad):window.PerpRotation.PERP_DEAD_RAD;
    const lerp=Number.isFinite(Number(settings.rotationLerp))?Math.max(0,Number(settings.rotationLerp)):1;
    const {effectiveTarget,snapTo}=window.PerpRotation.perpClamp(state,rawTarget,perps,deadRad);
    if(snapTo!==null||lerp>=1)marker.rotation.y=effectiveTarget;
    else marker.rotation.y+=angleDiff(effectiveTarget,marker.rotation.y)*lerp;
  }

  function makeCanvasTexture(canvas,debugName){
    const texture=new THREE.CanvasTexture(canvas);texture.name=debugName;
    if('colorSpace'in texture&&THREE.SRGBColorSpace)texture.colorSpace=THREE.SRGBColorSpace;
    else if('encoding'in texture&&THREE.sRGBEncoding)texture.encoding=THREE.sRGBEncoding;
    texture.needsUpdate=true;return texture;
  }

  function createTintedPlane(options={}){
    requireDependencies();ensurePerpRotationReady();
    const spritePath=options.spritePath;if(!spritePath)throw new Error('DeadzoneBillboard.createTintedPlane requires spritePath.');
    const tintHex=Number(options.tintHex),baseHeight=Math.max(.001,Number(options.baseHeight));
    const scale=Math.max(.01,Number(options.scale)),yScale=Math.max(.01,Number(options.yScale));
    const targetHeight=baseHeight*scale,alphaTest=Math.max(0,Number(options.alphaTest)||0);
    const marker=new THREE.Group();marker.name=options.name||'deadzoneBillboard';
    marker.userData.noOutline=options.noOutline!==false;marker.userData.perpState={};
    marker.userData.deadzoneBillboard={
      spritePath,tintHex,baseHeight,scale,yScale,targetHeight,renderedHeight:targetHeight*yScale,
      attachmentPoint:'held-item-plane-centered-origin',
      deadRad:Number.isFinite(Number(options.deadRad))?Number(options.deadRad):window.PerpRotation.PERP_DEAD_RAD,
      rotationLerp:Number.isFinite(Number(options.rotationLerp))?Number(options.rotationLerp):1,
    };
    window.SpriteRecolor.getRecoloredCanvas(spritePath,tintHex,'keyed').then(canvas=>{
      if(marker.userData.deadzoneBillboardDetached)return;
      const texture=makeCanvasTexture(canvas,`${marker.name}_texture`);
      const geometry=new THREE.PlaneGeometry(targetHeight*(canvas.width/Math.max(1,canvas.height)),targetHeight);
      const material=new THREE.MeshBasicMaterial({map:texture,color:0xffffff,transparent:true,alphaTest,side:THREE.DoubleSide,depthTest:true,depthWrite:false});
      material.name=`${marker.name}_material`;material.toneMapped=false;
      const mesh=new THREE.Mesh(geometry,material);mesh.name=`${marker.name}_plane`;mesh.scale.y=yScale;
      mesh.userData.noOutline=marker.userData.noOutline;mesh.userData.deadzoneBillboardPlane=true;
      mesh.userData.heldItemAttachmentPoint={x:0,y:0,z:0};
      // Camera-facing already requires this render hook. Suspension piggybacks
      // on it, so off-screen bottle assemblies do no sway work.
      mesh.onBeforeRender=(_renderer,_scene,camera)=>{
        updateFacing(marker,camera);
        const suspension=marker.userData.deadzoneSuspensionOwner;
        if(suspension)updateSuspension(suspension);
      };
      marker.add(mesh);marker.userData.deadzoneBillboard.ready=true;
      marker.userData.deadzoneBillboard.aspect=canvas.width/Math.max(1,canvas.height);
    }).catch(error=>{
      marker.userData.deadzoneBillboard.error=error?.message||String(error);
      console.warn(`[deadzone billboard] failed to build ${spritePath}:`,error);
    });
    return marker;
  }

  function ropeTextureForLength(path,length,repeatWorldLength){
    let shared=sharedRopeTextures.get(path);
    if(!shared){
      shared=new THREE.TextureLoader().load(path);shared.wrapS=shared.wrapT=THREE.RepeatWrapping;
      if('colorSpace'in shared&&THREE.SRGBColorSpace)shared.colorSpace=THREE.SRGBColorSpace;
      else if('encoding'in shared&&THREE.sRGBEncoding)shared.encoding=THREE.sRGBEncoding;
      sharedRopeTextures.set(path,shared);
    }
    const texture=shared.clone();texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.repeat.set(1,Math.max(1,length/Math.max(.001,repeatWorldLength)));texture.needsUpdate=true;
    return texture;
  }

  // The game's outline shell uses one shared uThickness. Very thin meshes such
  // as these ropes need a smaller per-draw value or the expanded black shell can
  // engulf the visible surface. This mirrors the existing hand/foot outline
  // adapters: temporarily scale the shared uniform only for this mesh's shell
  // draw, then restore it immediately. No tick/update loop is introduced.
  function installShellThicknessScale(mesh,scale){
    const multiplier=Number(scale);
    if(!mesh?.isMesh||!Number.isFinite(multiplier)||multiplier<=0||Math.abs(multiplier-1)<1e-6)return;
    const previousBefore=typeof mesh.onBeforeRender==='function'?mesh.onBeforeRender:null;
    const previousAfter=typeof mesh.onAfterRender==='function'?mesh.onAfterRender:null;
    const restoreStack=[];
    mesh.onBeforeRender=function ropeShellThicknessBefore(...args){
      previousBefore?.apply(this,args);
      const scene=args[1],material=args[4];
      const uniform=(scene?.overrideMaterial&&material?.isShaderMaterial&&material.side===THREE.BackSide)
        ?material.uniforms?.uThickness:null;
      const previous=Number(uniform?.value);
      if(!uniform||!Number.isFinite(previous)){restoreStack.push(null);return;}
      restoreStack.push({uniform,value:previous});
      uniform.value=previous*multiplier;
      material.uniformsNeedUpdate=true;
    };
    mesh.onAfterRender=function ropeShellThicknessAfter(...args){
      previousAfter?.apply(this,args);
      const restore=restoreStack.pop();
      if(!restore)return;
      restore.uniform.value=restore.value;
      const material=args[4];
      if(material?.isShaderMaterial)material.uniformsNeedUpdate=true;
    };
    mesh.userData.deadzoneRopeShellThicknessScale=multiplier;
  }

  function makeRopeMesh(options){
    const {length,radius,colorHex,name,texturePath,sides,taperRatio,repeatWorldLength,shellOutline,shellThicknessScale}=options;
    const geometry=new THREE.CylinderGeometry(radius,radius*taperRatio,length,sides,1,true);
    const texture=ropeTextureForLength(texturePath,length,repeatWorldLength);
    // Outlined volumetric meshes use a normal FrontSide surface pass; the
    // game's layer-1 shell renderer supplies the expanded black BackSide pass.
    const material=new THREE.MeshLambertMaterial({map:texture,color:colorHex,side:THREE.FrontSide});
    material.name=`${name}_rope_material`;
    const mesh=new THREE.Mesh(geometry,material);mesh.name=`${name}_rope`;mesh.position.y=-length*.5;
    mesh.userData.deadzoneRope=true;
    mesh.userData.noOutline=shellOutline!==true;
    if(shellOutline===true){
      mesh.layers.enable(1);
      installShellThicknessScale(mesh,shellThicknessScale);
    }
    return mesh;
  }

  function liveVegetationWindSnapshot(){
    const material=window.VegetationCropRendering?.getGrassBillboardMat?.();
    const time=Number(material?.uniforms?.uTime?.value),strength=Number(material?.uniforms?.uStrength?.value);
    if(!Number.isFinite(time)||!Number.isFinite(strength))return null;
    return {time,strength:Math.max(0,strength)};
  }
  function sampleVegetationSway(snapshot,phase,amplitudeRad,windConfig){
    if(!snapshot||!windConfig)return{x:0,z:0,strengthScale:0};
    const calm=Math.max(.0001,Number(windConfig.calmStrength));
    const strengthScale=clamp(snapshot.strength/calm,0,Number(windConfig.maximumStrengthScale));
    const amp=amplitudeRad*strengthScale;
    return {
      z:amp*Math.sin(snapshot.time*Number(windConfig.primaryFrequency)+phase),
      x:amp*Number(windConfig.secondaryAmplitudeRatio)*Math.cos(snapshot.time*Number(windConfig.secondaryFrequency)+phase*Number(windConfig.secondaryPhaseMultiplier)),
      strengthScale,
    };
  }
  function spatialWindPhase(assembly,windConfig,offset=0){
    assembly.getWorldPosition(suspensionWorldPosition);
    return suspensionWorldPosition.x*Number(windConfig.spatialPhaseX)+suspensionWorldPosition.z*Number(windConfig.spatialPhaseZ)+offset;
  }
  function updateSuspension(assembly){
    const data=assembly?.userData?.deadzoneSuspension;if(!data||data.detached)return;
    const snapshot=liveVegetationWindSnapshot();if(!snapshot||snapshot.time===data.lastWindTime)return;
    data.lastWindTime=snapshot.time;
    const wind=data.windConfig,phase=spatialWindPhase(assembly,wind,data.windPhaseOffset);
    const ropeLimit=THREE.MathUtils.degToRad(Number(wind.ropeSwingMaxDeg));
    const ropeAmp=THREE.MathUtils.degToRad(Number(wind.ropeAmplitudeDegAtCalm))*data.windResponse;
    const rope=sampleVegetationSway(snapshot,phase,ropeAmp,wind);
    data.ropePivot.rotation.x=clamp(rope.x,-ropeLimit,ropeLimit);
    data.ropePivot.rotation.z=clamp(rope.z,-ropeLimit,ropeLimit);
    const bottleLimit=THREE.MathUtils.degToRad(Number(wind.bottleSwingMaxDeg));
    const bottle=sampleVegetationSway(snapshot,phase-Number(wind.bottlePhaseLag),ropeAmp*Number(wind.bottleAmplitudeScale),wind);
    data.bottlePivot.rotation.x=clamp(bottle.x,-bottleLimit,bottleLimit);
    data.bottlePivot.rotation.z=clamp(bottle.z,-bottleLimit,bottleLimit);
    data.lastWindStrengthScale=rope.strengthScale;data.lastWindPhase=phase;
  }

  function addConfiguredPointLight(parent,lightConfig,name){
    if(!parent||lightConfig?.enabled!==true)return null;
    const light=new THREE.PointLight(lightConfig.color,Number(lightConfig.intensity),Number(lightConfig.distance),Number(lightConfig.decay));
    light.name=name;const offset=lightConfig.offset||{};
    light.position.set(Number(offset.x)||0,Number(offset.y)||0,Number(offset.z)||0);
    light.castShadow=false;light.userData.rootTotemLight=true;
    light.userData.furnitureLightMask=lightConfig.weatherOverlayMask===true;
    parent.add(light);return light;
  }

  function createSuspendedTintedPlane(options={}){
    requireDependencies();
    const name=options.name||'suspendedDeadzoneBillboard';
    const ropeLength=Math.max(.001,Number(options.ropeLength)),ropeRadius=Math.max(.001,Number(options.ropeRadius));
    const windConfig=options.windConfig;if(!windConfig)throw new Error('Suspended DeadzoneBillboard requires windConfig.');
    const assembly=new THREE.Group();assembly.name=`${name}_suspension`;assembly.userData.noOutline=options.noOutline!==false;
    const ropePivot=new THREE.Group();ropePivot.name=`${name}_ropePivot`;
    const rope=makeRopeMesh({
      length:ropeLength,radius:ropeRadius,colorHex:options.ropeColor,name,
      texturePath:options.ropeTexture,sides:Math.max(3,Math.round(Number(options.ropeSides))),
      taperRatio:Number(options.ropeTaperRatio),repeatWorldLength:Number(options.ropeTextureRepeatWorldLength),
      shellOutline:options.ropeShellOutline===true,shellThicknessScale:options.ropeShellThicknessScale,
    });
    ropePivot.add(rope);assembly.add(ropePivot);
    const bottlePivot=new THREE.Group();bottlePivot.name=`${name}_bottlePivot`;bottlePivot.position.y=-ropeLength;ropePivot.add(bottlePivot);
    const marker=createTintedPlane(options);marker.name=name;marker.userData.deadzoneSuspensionOwner=assembly;
    marker.userData.suspensionAttachmentPoint='held-item-plane-centered-origin';bottlePivot.add(marker);
    const pointLight=addConfiguredPointLight(bottlePivot,options.pointLight,`${name}_pointLight`);
    assembly.userData.deadzoneSuspension={
      ropePivot,bottlePivot,marker,rope,pointLight,windPhaseOffset:Number(options.windPhaseOffset)||0,
      windResponse:Number.isFinite(Number(options.windResponse))?Number(options.windResponse):1,
      windConfig,lastWindTime:null,lastWindStrengthScale:0,lastWindPhase:null,detached:false,
      ropeTexture:options.ropeTexture,ropeColor:options.ropeColor,ropeLength,ropeRadius,
    };
    assembly.userData.deadzoneBillboardMarker=marker;
    return assembly;
  }

  function dispose(marker){
    if(!marker)return;
    const suspension=marker.userData?.deadzoneSuspension;if(suspension)suspension.detached=true;
    marker.traverse?.(object=>{
      if(object.userData?.deadzoneBillboard)object.userData.deadzoneBillboardDetached=true;
      object.geometry?.dispose?.();
      const materials=Array.isArray(object.material)?object.material:object.material?[object.material]:[];
      for(const material of materials){material.map?.dispose?.();material.dispose?.();}
    });
  }

  window.DeadzoneBillboard={
    angleDiff,nearestAngleAmong,localCameraPerps,updateFacing,liveVegetationWindSnapshot,
    sampleVegetationSway,spatialWindPhase,updateSuspension,addConfiguredPointLight,
    createTintedPlane,createSuspendedTintedPlane,dispose,
  };
})();
