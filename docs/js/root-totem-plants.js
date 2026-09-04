// Living Root Totem plant builder. All Root Totem-specific tuning lives in
// docs/config/root-totem-config.js; this module owns growth and assembly only.
window.RootTotemPlants = (() => {
  'use strict';

  function runtimeConfig(){
    const config=window.HOBUNJI_ROOT_TOTEM_CONFIG;
    if(!config)throw new Error('RootTotemPlants requires config/root-totem-config.js.');
    return config;
  }
  const cfg=runtimeConfig(),LIMITS=cfg.limits,DEFAULT_CONFIG=cfg.defaults,CANONICAL_RECIPE=cfg.canonicalRecipe;
  const ROOT_TOTEM_GLOW_COLOR=Number.parseInt(String(cfg.colors.liquid).replace('#',''),16);
  const ROOT_TOTEM_GLOW_SPRITE=cfg.assets.bottleSprite;
  let lastDiagnostics=[];

  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const finiteNumber=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
  const finiteInteger=(value,fallback)=>Math.floor(finiteNumber(value,fallback));
  const bound=(value,fallback,range)=>clamp(finiteNumber(value,fallback),range.min,range.max);
  const intBound=(value,fallback,range)=>clamp(finiteInteger(value,fallback),range.min,range.max);

  function hashString(text){let hash=2166136261>>>0;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return hash>>>0;}
  function seededUnit(seed){let state=seed>>>0;return()=>{state+=0x6D2B79F5;let t=Math.imul(state^(state>>>15),state|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}

  function normalizeConfig(input={}){
    const l=LIMITS;
    return {
      sourceTree:input.sourceTree==='shadewood'?'shadewood':DEFAULT_CONFIG.sourceTree,
      treeCount:intBound(input.treeCount,DEFAULT_CONFIG.treeCount,l.treeCount),
      height:bound(input.height,DEFAULT_CONFIG.height,l.height),
      turns:bound(input.turns,DEFAULT_CONFIG.turns,l.turns),
      radiusStart:bound(input.radiusStart,DEFAULT_CONFIG.radiusStart,l.radius),
      radiusEnd:bound(input.radiusEnd,DEFAULT_CONFIG.radiusEnd,l.radius),
      crossSectionScaleStart:bound(input.crossSectionScaleStart,DEFAULT_CONFIG.crossSectionScaleStart,l.crossSectionScale),
      crossSectionScaleEnd:bound(input.crossSectionScaleEnd,DEFAULT_CONFIG.crossSectionScaleEnd,l.crossSectionScale),
      hostSway:bound(input.hostSway,DEFAULT_CONFIG.hostSway,l.hostSway),
      hostSamples:intBound(input.hostSamples,DEFAULT_CONFIG.hostSamples,l.hostSamples),
      followerWobble:bound(input.followerWobble,DEFAULT_CONFIG.followerWobble,l.followerWobble),
      followerWobbleFrequency:bound(input.followerWobbleFrequency,DEFAULT_CONFIG.followerWobbleFrequency,l.followerWobbleFrequency),
      rootLockFraction:bound(input.rootLockFraction,DEFAULT_CONFIG.rootLockFraction,l.rootLockFraction),
      rootLockTransition:bound(input.rootLockTransition,DEFAULT_CONFIG.rootLockTransition,l.rootLockTransition),
      envelopeRadialQuantile:bound(input.envelopeRadialQuantile,DEFAULT_CONFIG.envelopeRadialQuantile,l.envelopeRadialQuantile),
      glowCount:intBound(input.glowCount,DEFAULT_CONFIG.glowCount,l.glowCount),
      glowRadius:bound(input.glowRadius,DEFAULT_CONFIG.glowRadius,l.glowRadius),
      glowSpriteScale:bound(input.glowSpriteScale,DEFAULT_CONFIG.glowSpriteScale,l.glowSpriteScale),
      glowBottleYScale:bound(input.glowBottleYScale,DEFAULT_CONFIG.glowBottleYScale,l.glowBottleYScale),
      glowRopeLength:bound(input.glowRopeLength,DEFAULT_CONFIG.glowRopeLength,l.glowRopeLength),
      glowRopeRadius:bound(input.glowRopeRadius,DEFAULT_CONFIG.glowRopeRadius,l.glowRopeRadius),
      glowWindResponse:bound(input.glowWindResponse,DEFAULT_CONFIG.glowWindResponse,l.glowWindResponse),
    };
  }

  function log(message,level='info'){
    const line=`[root totem] ${message}`;
    if(typeof window.__farmLog==='function')return window.__farmLog(line,level);
    (level==='error'?console.error:level==='warn'?console.warn:console.log)(line);
  }
  function requireDependencies(){
    if(!window.THREE)throw new Error('RootTotemPlants requires THREE.');
    if(!window.StructuralWrap)throw new Error('RootTotemPlants requires StructuralWrap.');
    if(!window.FoliageGenerator)throw new Error('RootTotemPlants requires FoliageGenerator.');
    if(!window.DeadzoneBillboard)throw new Error('RootTotemPlants requires DeadzoneBillboard.');
  }

  function buildSourceTree(sourceTree,seedU32,index){
    const col=((seedU32^Math.imul(index+1,0x45d9f3b))>>>0)%100003;
    const row=((seedU32^Math.imul(index+7,0x119de1f3))>>>0)%100019;
    const tree=sourceTree==='shadewood'
      ? window.FoliageGenerator.buildShadewoodMesh(col,row,{forceClimbBranch:false})
      : window.FoliageGenerator.buildCrownedPineMesh(col,row);
    const climbBranch=tree.getObjectByName?.('climbBranch');if(climbBranch)climbBranch.visible=false;
    if(tree.userData)delete tree.userData.climbBranchLocal;
    if(sourceTree==='shadewood')window.RootTotemSurfaceStyle?.prepareTreeGeometry?.(tree,{treeIndex:index,seedU32});
    return tree;
  }
  function finalizeSourceTree(tree,sourceTree){
    if(sourceTree==='shadewood')window.RootTotemSurfaceStyle?.finalizeTreeSurface?.(tree);
    return tree;
  }

  function skipEnvelopeMesh(mesh){return !mesh.visible||mesh.userData?.noOutline||mesh.userData?.rootTotemGlow||mesh.name==='climbBranch'||mesh.userData?.isClimbBranch;}
  function measureCombinedTrunk(group,config){
    return window.StructuralWrap.verticalEnvelopeFromObject(group,{
      samples:config.hostSamples,radialQuantile:config.envelopeRadialQuantile,
      minimumRadius:Number(cfg.growth.envelopeMinimumRadius),smoothing:config.hostSway,
      minY:0,maxY:config.height,skipMesh:skipEnvelopeMesh,
    });
  }
  function profileAt(profile,t01){
    if(!profile?.length)return 0;if(profile.length===1)return profile[0]||0;
    const f=clamp(t01,0,1)*(profile.length-1),i0=Math.floor(f),i1=Math.min(profile.length-1,i0+1);
    const a=finiteNumber(profile[i0],0),b=finiteNumber(profile[i1],a);return a+(b-a)*(f-i0);
  }

  function buildGlowCluster(envelope,config,seedU32){
    const T=window.THREE,wrap=window.StructuralWrap,placement=cfg.glowPlacement,bottle=cfg.bottle;
    const frames=wrap.framesFromPoints(envelope.points),random=seededUnit(seedU32^ROOT_TOTEM_GLOW_COLOR);
    const glowGroup=new T.Group(),lightCentroid=new T.Vector3();
    glowGroup.name='rootTotemGlow';glowGroup.userData.noOutline=true;
    glowGroup.userData.rootTotemGlowSprite=ROOT_TOTEM_GLOW_SPRITE;glowGroup.userData.rootTotemGlowColor=ROOT_TOTEM_GLOW_COLOR;

    for(let i=0;i<config.glowCount;i++){
      const spread=config.glowCount<=1?0:i/(config.glowCount-1);
      const u=clamp(placement.verticalStart+spread*placement.verticalSpan+(random()-.5)*placement.verticalJitter,placement.verticalMin,placement.verticalMax);
      const frame=wrap.sampleFrame(frames,u),angle=random()*Math.PI*2;
      const radial=Math.max(placement.minimumRadialDistance,profileAt(envelope.radii,u)*placement.envelopeRadiusScale+random()*placement.radialJitter);
      const position=frame.point.clone().addScaledVector(frame.normal,Math.cos(angle)*radial).addScaledVector(frame.binormal,Math.sin(angle)*radial);
      const radius=config.glowRadius*(placement.bottleRadiusScaleMin+random()*placement.bottleRadiusScaleSpan);
      const ropeLength=config.glowRopeLength*(placement.ropeLengthScaleMin+random()*placement.ropeLengthScaleSpan)*bottle.rope.lengthScale;
      const potion=window.DeadzoneBillboard.createSuspendedTintedPlane({
        name:`rootTotemGlowPotion${i+1}`,spritePath:cfg.assets.bottleSprite,tintHex:ROOT_TOTEM_GLOW_COLOR,
        baseHeight:radius*2,scale:config.glowSpriteScale,yScale:config.glowBottleYScale,
        alphaTest:bottle.billboard.alphaTest,rotationLerp:bottle.billboard.rotationLerp,
        ropeTexture:cfg.assets.ropeTexture,ropeColor:bottle.rope.color,ropeLength,
        ropeRadius:config.glowRopeRadius*bottle.rope.radialScale,ropeSides:bottle.rope.sideCount,
        ropeTaperRatio:bottle.rope.taperRatio,ropeTextureRepeatWorldLength:bottle.rope.textureRepeatWorldLength,
        ropeShellOutline:bottle.rope.shellOutline===true,ropeShellThicknessScale:bottle.rope.shellThicknessScale,
        windResponse:config.glowWindResponse,windConfig:bottle.wind,noOutline:bottle.billboard.noOutline,
      });
      potion.position.copy(position);potion.rotation.y=angle;
      Object.assign(potion.userData,{noOutline:true,rootTotemGlow:true,rootTotemGlowPotion:true,rootTotemGlowIndex:i});
      glowGroup.add(potion);lightCentroid.add(position).y-=ropeLength;
    }

    if(config.glowCount>0&&bottle.light.enabled===true){
      lightCentroid.multiplyScalar(1/config.glowCount);
      const light=window.DeadzoneBillboard.addConfiguredPointLight(glowGroup,bottle.light,'rootTotemBottleClusterPointLight');
      if(light){light.position.add(lightCentroid);glowGroup.userData.rootTotemBottleClusterLight=light;}
    }
    return glowGroup;
  }

  function envelopeSummary(envelope){
    const radii=envelope?.radii||[];if(!radii.length)return null;
    return {minRadius:Math.min(...radii),maxRadius:Math.max(...radii),averageRadius:radii.reduce((sum,r)=>sum+r,0)/radii.length,samples:envelope.samples};
  }

  function buildRootTotemPlant(options={}){
    requireDependencies();
    const T=window.THREE,wrap=window.StructuralWrap,config=normalizeConfig(options);
    const seedU32=Number.isFinite(Number(options.seedU32))?(Number(options.seedU32)>>>0):hashString(String(options.seed??cfg.growth.fallbackSeedLabel));
    const random=seededUnit(seedU32),group=new T.Group(),sequence=[];
    group.name='rootTotemPlant';group.userData.rootTotemPlant=true;group.userData.rootTotemConfig={...config,seedU32};

    const firstTree=buildSourceTree(config.sourceTree,seedU32,0);
    wrap.fitObjectToHeight(firstTree,config.height,{groundY:0,centerXZ:true});
    finalizeSourceTree(firstTree,config.sourceTree);
    firstTree.name='rootTotemTree1';firstTree.userData.rootTotemTreeIndex=0;firstTree.userData.rootTotemGrowthMode='regular-base-tree';group.add(firstTree);
    let envelope=measureCombinedTrunk(group,config);
    sequence.push({treeIndex:0,mode:'regular-base-tree',wrapsPreviousTreeCount:0,resultingCombinedTrunk:envelopeSummary(envelope)});

    for(let i=1;i<config.treeCount;i++){
      const hostBefore=envelope;
      const followerPath=wrap.makeWrappedFollowerPaths(hostBefore.points,{
        count:1,turns:config.turns,radiusProfile:hostBefore.radii,radiusStart:config.radiusStart,radiusEnd:config.radiusEnd,
        phaseOffset:random()*Math.PI*2,wobbleAmplitude:config.followerWobble,wobbleFrequency:config.followerWobbleFrequency,
      })[0];
      const sourceTree=buildSourceTree(config.sourceTree,seedU32,i);
      const wrappedTree=wrap.deformObjectAlongPath(sourceTree,followerPath,{
        name:`rootTotemTree${i+1}`,axis:'y',crossSectionScaleStart:config.crossSectionScaleStart,
        crossSectionScaleEnd:config.crossSectionScaleEnd,rigidStartFraction:config.rootLockFraction,
        rigidStartTransition:config.rootLockTransition,rigidStartDirection:{x:0,y:1,z:0},floorY:0,
        skipMesh:mesh=>mesh.name==='climbBranch'||mesh.userData?.isClimbBranch,
      });
      finalizeSourceTree(wrappedTree,config.sourceTree);
      delete wrappedTree.userData.climbBranchLocal;
      Object.assign(wrappedTree.userData,{rootTotemTreeIndex:i,rootTotemGrowthMode:'wrap-previous-combined-trunk',wrapsPreviousTreeCount:i});
      group.add(wrappedTree);
      envelope=measureCombinedTrunk(group,config);
      sequence.push({treeIndex:i,mode:'wrap-previous-combined-trunk',wrapsPreviousTreeCount:i,hostBefore:envelopeSummary(hostBefore),resultingCombinedTrunk:envelopeSummary(envelope)});
    }

    group.add(buildGlowCluster(envelope,config,seedU32));group.userData.rootTotemSequence=sequence;
    group.userData.rootTotemDiagnostics={
      ...wrap.describeObject(group),sequence,finalCombinedTrunk:envelopeSummary(envelope),
      shadewoodSurface:cfg.shadewoodSurface,
      glow:{
        marker:'suspended-standard-potion-plane',spritePath:cfg.assets.bottleSprite,color:cfg.colors.liquid,count:config.glowCount,
        spriteScale:config.glowSpriteScale,bottleYScale:config.glowBottleYScale,ropeTexture:cfg.assets.ropeTexture,
        ropeLength:config.glowRopeLength*cfg.bottle.rope.lengthScale,ropeRadius:config.glowRopeRadius*cfg.bottle.rope.radialScale,
        ropeShellOutline:cfg.bottle.rope.shellOutline===true,ropeShellThicknessScale:cfg.bottle.rope.shellThicknessScale,
        wind:'shared VegetationCropRendering uTime/uStrength + world-position phase; no independent clock',
        bottleClusterPointLight:!!cfg.bottle.light.enabled,attachmentPoint:'held-item-plane-centered-origin',
        facing:'PerpRotation deadzone billboard',
      },
    };
    return group;
  }

  function buildLifeTotemFurniture(options={}){
    return window.LifeTotemFurniture?.build?.(options)||buildRootTotemPlant({...CANONICAL_RECIPE,...(options.recipe||options.rootTotemPlant||options)});
  }
  function recordPlacedTotem({mapId,x,y,seedU32,plant}){
    const record={mapId,x,y,seedU32,config:plant?.userData?.rootTotemConfig||null,geometry:plant?.userData?.rootTotemDiagnostics||null};
    lastDiagnostics.push(record);const limit=Math.max(1,Math.floor(Number(cfg.growth.diagnosticsHistoryLimit)));
    if(lastDiagnostics.length>limit)lastDiagnostics=lastDiagnostics.slice(-limit);return record;
  }
  function clearDiagnostics(){lastDiagnostics=[];}
  function getDiagnostics(){return lastDiagnostics.map(entry=>JSON.parse(JSON.stringify(entry)));}
  function dumpDiagnostics(){const diagnostics=getDiagnostics();const text=diagnostics.length?JSON.stringify(diagnostics,null,2):'No root totems have been built in this session.';log(text);return text;}

  window.__rootTotemDebug={dump:dumpDiagnostics,get:getDiagnostics,clear:clearDiagnostics};
  return {
    CONFIG:cfg,LIMITS,DEFAULT_CONFIG,CANONICAL_RECIPE,ROOT_TOTEM_GLOW_COLOR,ROOT_TOTEM_GLOW_SPRITE,
    normalizeConfig,buildRootTotemPlant,buildLifeTotemFurniture,recordPlacedTotem,clearDiagnostics,getDiagnostics,dumpDiagnostics,
  };
})();
