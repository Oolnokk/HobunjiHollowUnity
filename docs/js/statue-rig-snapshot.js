// Frozen furniture snapshots of the same species/gender rig that the Multi-Avatar
// Animation Author previews. Read the live model/profile solvers; never maintain
// a second hand/foot placement or body-scale catalog here.
(function(global){
  'use strict';
  if(global.HobunjiStatueRigSnapshot?.version>=1)return;
  const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const positive=(v,f=1)=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):f;
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const axes=v=>({x:positive(v?.x),y:positive(v?.y),z:positive(v?.z)});
  const normalize=value=>String(value||'').trim().toLowerCase().replace(/_/g,'-').replace(/[’']/g,'');
  function authoredProfile(species,gender){
    const characters=global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters||{};
    return characters[species+'::'+gender]||null; // Uses canonical transform-species aliases from the rig config itself.
  }
  function snapshotLegStance(THREE,actor){
    const solver=global.ProceduralLegAnimation?.attach;
    if(typeof solver!=='function')return {stance:null,debug:null,reason:'ProceduralLegAnimation unavailable'};
    const owner=new THREE.Group(); // The temporary, floor-relative actor carrier sampled once at authoring time.
    const footCfg=global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet;
    const originalTable=footCfg?.footScale;
    const key=actor.speciesId,gender=actor.gender;
    const originalEntry=originalTable?.[key];
    let feet=null;
    try{
      // Rig Coordinates' anatomy.footScale is written into this very config
      // before preview-actor construction. Apply it only while sampling this
      // transient statue rig, and restore the shared setting synchronously.
      if(footCfg&&positive(actor.footScale,0)>0){
        footCfg.footScale||={};
        footCfg.footScale[key]={...(originalEntry||{}),[gender]:actor.footScale};
      }
      feet=solver(THREE,owner,{
        speciesId:actor.speciesId,gender:actor.gender,modelWidth:actor.modelWidth,
        modelHeight:actor.modelHeight,handAttachY:actor.handAttachY,
        bodyColors:actor.profile?.bodyColors||{},profile:actor.profile,
        spine:actor.npc?.appearance?.spine||null,name:'statue_snapshot'
      }); // Exactly the same creation call used by the Multi-Avatar Animation Author.
      if(!feet?.getRestStance) return {stance:null,debug:null,reason:'Species has no humanoid procedural feet'};
      feet.update?.(0,0,false,null);
      return {stance:clone(feet.getRestStance()),debug:clone(feet.getStandingPoseDebug?.()||null),reason:null};
    }catch(error){return {stance:null,debug:null,reason:String(error?.message||error)};}
    finally{
      feet?.dispose?.();owner.clear?.();
      if(footCfg){
        if(originalTable){footCfg.footScale=originalTable;if(originalEntry===undefined)delete originalTable[key];else originalTable[key]=originalEntry;}
        else delete footCfg.footScale;
      }
    }
  }
  function resolve({THREE,npc,profile,frame}){
    if(!THREE?.Group||!npc?.appearance||!frame)throw Error('Snapshot requires the real NPC, its avatar profile and Three.js rig');
    const speciesId=normalize(frame.speciesId||npc.appearance.speciesId||profile?.fighter?.speciesId);
    const gender=normalize(npc.appearance.gender||'male');
    const rig=authoredProfile(speciesId,gender);
    const anatomy=rig?.anatomy||{};
    const scaleApi=global.HobunjiCharacterRigScale;
    const whole=scaleApi?.scaleFor?.(speciesId,gender,rig)||{x:1,y:1,head:1,offsetY:0};
    const bodyScale={x:positive(whole.x),y:positive(whole.y),head:positive(whole.head),offsetY:finite(whole.offsetY)};
    const modelWidth=positive(frame.modelWidth,.9),modelHeight=positive(frame.modelHeight,modelWidth);
    const fit=.9/Math.max(modelWidth*bodyScale.x,modelHeight*bodyScale.y); // Exactly one tile-wide authored furniture footprint.
    const width=modelWidth*fit*bodyScale.x,height=modelHeight*fit*bodyScale.y;
    const measuredPlacement=finite(frame.placementRatio,.5);
    const placement=finite(anatomy.portraitVerticalPlacementRatio,measuredPlacement);
    const handAttachY=finite(frame.handAttachY,modelHeight*.4)+(placement-measuredPlacement)*modelHeight; // Multi-Avatar applyCharacterPortraitPlacementV1530 shifts handAttachY by the same placement delta.
    const centerY=placement*height; // PNGPlaneAvatar's floor-anchored canvas placement, not a generic half-height guess.
    const age=scaleApi?.ageFor?.(npc)||null;
    const ageDrop=finite(scaleApi?.ageHunchFraction?.(age));
    const headFactor=positive(frame.childHeadFactor,1);
    const headScale=bodyScale.head*headFactor;
    const shoulders={};
    for(const side of ['left','right']){
      const source=rig?.anchors?.[side+'HandShoulder']||null;
      const pos=source?.position||{};
      const baseWidth=positive(rig?.handShoulderRule?.runtimeBaseWidth,.9);
      const authoredToModel=modelWidth/baseWidth;
      shoulders[side]=source?{
        x:finite(pos.x)*authoredToModel*fit*bodyScale.x,
        y:finite(pos.y)*authoredToModel*fit*bodyScale.y,
        z:finite(pos.z)*authoredToModel*fit*bodyScale.x,
        rotationDeg:clone(source.rotationDeg||{x:0,y:0,z:0})
      }:null;
    }
    // AvatarModel's handAttach metadata already incorporates the canonical
    // arm-length/posterior rule. Applying those offsets a second time here
    // would move the idle hand too low on long-armed species.
    const handX=Math.abs(finite(frame.handAttachX,-modelWidth*.28))*fit*bodyScale.x;
    const handY=handAttachY*fit*bodyScale.y;
    const handsApi=global.HobunjiHandModelProfiles;
    const handModel=handsApi?.modelForSpecies?.(speciesId)||null;
    const handBase=positive(handsApi?.data?.handHeightFraction,.12);
    const handScale=positive(handModel?.scale)*positive(anatomy.handScale,
      positive(handsApi?.speciesScaleFor?.(speciesId,gender))); // Multi-Avatar writes anatomy.handScale into speciesScaleOverrides before building its hand GLBs.
    const handHeight=modelHeight*fit*handBase*handScale;
    const footConfig=global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet||{};
    const authoredFootScale=positive(anatomy.footScale,positive(handsApi?.footScaleFor?.(speciesId,gender)));
    const footHeight=modelHeight*fit*positive(footConfig.footHeightFraction,.11)*
      positive(footConfig.sizeBalanceMultiplier)*authoredFootScale*
      (speciesId==='kenkari'||speciesId==='rakakoan'?1:.75)*2; // Imported GLB normalization: radius*2*autofit(2)*species contact-Y, exactly ProceduralLegAnimation.buildGlbFoot.
    const sampled=snapshotLegStance(THREE,{
      npc,profile,speciesId,gender,modelWidth,modelHeight,handAttachY,footScale:authoredFootScale
    });
    const footFallbackX=modelWidth*positive(footConfig.stanceWidthFraction,.16)*.5;
    const footYFallback=footHeight/(2*Math.max(.001,fit));
    const footPositions={};
    for(const side of ['left','right']){
      const ankle=sampled.stance?.[side]?.ankle||null;
      footPositions[side]={
        x:finite(ankle?.x,(side==='left'?-1:1)*footFallbackX)*fit*bodyScale.x,
        y:finite(ankle?.y,footYFallback)*fit*bodyScale.y,
        z:finite(ankle?.z)*fit*bodyScale.x
      };
    }
    return {
      version:1,speciesId,gender,profileKey:speciesId+'::'+gender,
      rigProfileFound:!!rig,frame:clone(frame),
      modelWidth,modelHeight,fit,bodyScale,anatomy:clone(anatomy),
      placement:{measured:measuredPlacement,authored:placement,handAttachY},
      body:{width,height,centerY},
      head:{scale:headScale,
        offsetY:(bodyScale.offsetY+ageDrop)*modelHeight*fit*bodyScale.y,
        centerScaleX:bodyScale.x,centerScaleY:bodyScale.y},
      hands:{x:handX,y:handY,height:handHeight,
        axes:axes(anatomy.handScaleAxes),shoulders,
        modelPath:handModel?.glb||null,mirrorRight:handModel?.mirrorX!==false,
        handFromTool:clone(handsApi?.handTransformForSpecies?.(speciesId,gender)||null)},
      feet:{height:footHeight,positions:footPositions,
        axes:axes(anatomy.footScaleAxes),restStance:sampled.stance,
        debug:sampled.debug,samplingWarning:sampled.reason},
      provenance:{
        profileMaster:global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.masterConfigVersion||null,
        portraitPlacement:'PNGPlaneAvatar measured model metadata',
        bodyAndHeadScale:'HobunjiCharacterRigScale.scaleFor + age hunch',
        handPosition:'PNGPlaneAvatar handAttachX/Y (includes arm length)',
        handDimensions:'HobunjiHandModelProfiles effectiveScaleFor',
        footPosition:sampled.stance?'ProceduralLegAnimation.getRestStance()':'fallback (solver unavailable)'
      }
    };
  }
  global.HobunjiStatueRigSnapshot=Object.freeze({version:1,authoredProfile,snapshotLegStance,resolve});
})(window);
