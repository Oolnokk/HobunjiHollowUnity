// Contextual framing for plate-gated Scratchbone melodies.
// Puzzle owners register their own glyphs; the game camera remains the sole camera writer.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MelodyCameraFraming=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';
  const sources=new Set(); // Registered cave/ruin score groups; only nearby active plates are inspected.
  const SAFE_X=.83,SAFE_TOP=.68,SAFE_BOTTOM=.72; // Leave the score above the instrument controls and below the top HUD.
  const MAX_FOV=82,COMFORTABLE_DISTANCE_RATIO=3.5,MAX_WORLD_DISTANCE=24; // Keep familiar zoom when possible, but let genuinely wide score layouts use more distance on narrow screens.
  const output={offsetX:0,offsetY:0,offsetZ:0,distanceScale:1,fovExtra:0}; // Eased correction consumed by the existing gameplay camera.
  let owner=null,areaKey='',lastTime=null,nextProbe=0,goal=null; // One latched plate and one amortized visibility/framing sample at a time.
  let previousNormalFrame=false; // Discovery is armed only after an unassisted gameplay-camera frame; returning from cinematics cannot trigger from their stale pose.
  let lastReason='idle',visibleTrigger=-1,fitLimited=false; // Compact mobile diagnostics for note discovery and constrained fitting.
  let scratchWorld=null,scratchScreen=null; // Reused Three.js vectors for note projection; never traverse the full scene.

  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const clamp=(number,min,max)=>Math.min(max,Math.max(min,number));
  function register({area,plate,glyphs,isActive}={}){
    if(!plate||!Array.isArray(glyphs)||!glyphs.length)return ()=>{};
    const record={area:String(area||''),plate,glyphs,isActive:typeof isActive==='function'?isActive:()=>true};
    sources.add(record);
    let removed=false; // A reroll/dispose may call its own cleanup more than once.
    return ()=>{
      if(removed)return;
      removed=true;sources.delete(record);
      if(owner===record){owner=null;goal=null;visibleTrigger=-1;lastReason='disposed';}
    };
  }
  function noteVisible(glyph){
    if(!glyph?.parent || glyph.material?.visible===false || glyph.material?.opacity===0)return false;
    for(let node=glyph;node;node=node.parent)if(node.visible===false)return false;
    return true;
  }
  function worldPoint(glyph){
    const Vector3=root.THREE?.Vector3;
    if(glyph?.getWorldPosition&&Vector3){
      scratchWorld ||= new Vector3(); // Shared scratch only; each returned point is a plain immutable-in-this-frame copy.
      glyph.getWorldPosition(scratchWorld);
      return {x:scratchWorld.x,y:scratchWorld.y,z:scratchWorld.z};
    }
    const p=glyph?.position; // Supports isolated geometry tests when Three.js is intentionally absent.
    return p&&[p.x,p.y,p.z].every(Number.isFinite)?{x:p.x,y:p.y,z:p.z}:null;
  }
  function onScreen(point,camera){
    if(!camera)return false;
    if(root.THREE?.Vector3&&camera.projectionMatrix){
      scratchScreen ||= new root.THREE.Vector3(); // One reused projection vector for all notes in a single score.
      scratchScreen.set(point.x,point.y,point.z).project(camera);
      return scratchScreen.z>-1&&scratchScreen.z<1&&Math.abs(scratchScreen.x)<.95
        &&scratchScreen.y<.90&&scratchScreen.y>-.87;
    }
    const p=camera.projectPoint?.(point); // Deterministic unit-test camera, never used by the game renderer.
    return !!p&&p.z>-1&&p.z<1&&Math.abs(p.x)<.95&&Math.abs(p.y)<.9;
  }
  function basis(azimuth,angle){
    const s=Math.sin(azimuth),c=Math.cos(azimuth),sa=Math.sin(angle),ca=Math.cos(angle);
    return {right:{x:c,y:0,z:-s},up:{x:-s*sa,y:ca,z:-c*sa},towardCamera:{x:s*ca,y:sa,z:c*ca}};
  }
  function dot(p,vector){return p.x*vector.x+p.y*vector.y+p.z*vector.z;}
  function subtract(point,focus){return {x:point.x-focus.x,y:point.y-focus.y,z:point.z-focus.z};}
  function requiredDistance(points,focus,axes,tanVertical,aspect){
    let required=.25; // Camera cannot be placed inside the nearest note's projection plane.
    for(const point of points){
      const delta=subtract(point,focus),near=dot(delta,axes.towardCamera);
      const right=Math.abs(dot(delta,axes.right));
      const up=dot(delta,axes.up);
      required=Math.max(required,near+.25,
        near+right/(Math.max(.01,tanVertical*aspect*SAFE_X)),
        near+(up>=0?up/Math.max(.01,tanVertical*SAFE_TOP):-up/Math.max(.01,tanVertical*SAFE_BOTTOM)));
    }
    return required;
  }
  function requiredFov(points,focus,axes,distance,aspect){
    let requiredTan=0;
    for(const point of points){
      const delta=subtract(point,focus),depth=Math.max(.1,distance-dot(delta,axes.towardCamera));
      const up=dot(delta,axes.up);
      requiredTan=Math.max(requiredTan,
        Math.abs(dot(delta,axes.right))/(depth*aspect*SAFE_X),
        up>=0?up/(depth*SAFE_TOP):-up/(depth*SAFE_BOTTOM));
    }
    return Math.atan(requiredTan)*360/Math.PI; // Full vertical field of view in degrees.
  }
  function solve(points,plate,baseTarget,baseDistance,azimuth,angle,fovDeg,aspect){
    if(!points.length||!(baseDistance>0)||!(aspect>0))return null;
    const axes=basis(azimuth,angle); // Uses the real game camera yaw/pitch, not guessed world X/Y spans.
    let left=Infinity,right=-Infinity,low=Infinity,high=-Infinity;
    for(const point of points){
      const relative=subtract(point,baseTarget);
      const h=dot(relative,axes.right),v=dot(relative,axes.up);
      left=Math.min(left,h);right=Math.max(right,h);low=Math.min(low,v);high=Math.max(high,v);
    }
    const shiftH=(left+right)/2,shiftV=(low+high)/2;
    const focus={
      x:baseTarget.x+axes.right.x*shiftH+axes.up.x*shiftV,
      y:baseTarget.y+axes.right.y*shiftH+axes.up.y*shiftV,
      z:baseTarget.z+axes.right.z*shiftH+axes.up.z*shiftV,
    }; // Move the look pivot toward the score's screen-space midpoint without rotating player controls.
    const fitPoints=points.slice(); // Include the plate as a secondary lower-screen anchor; the notes determine the center.
    if(Number.isFinite(Number(plate?.y)))fitPoints.push({
      x:finite(plate.x),y:finite(plate.y)+.65,z:finite(plate.z),
    });
    const baseFov=clamp(finite(fovDeg,42),15,110);
    const tanBase=Math.tan(baseFov*Math.PI/360);
    const wantedDistance=requiredDistance(fitPoints,focus,axes,tanBase,aspect);
    let distance=Math.max(baseDistance,Math.min(wantedDistance,baseDistance*2.35));
    let targetFov=Math.max(baseFov,requiredFov(fitPoints,focus,axes,distance,aspect)+1.5);
    targetFov=Math.min(MAX_FOV,targetFov);
    const fullFitDistance=requiredDistance(fitPoints,focus,axes,Math.tan(targetFov*Math.PI/360),aspect)*1.025; // Actual note extent and aspect ratio determine the necessary boom.
    const distanceLimit=Math.max(baseDistance*COMFORTABLE_DISTANCE_RATIO,Math.min(MAX_WORLD_DISTANCE,fullFitDistance)); // Only extreme world spans are capped, not ordinary portrait framing.
    distance=Math.max(distance,Math.min(distanceLimit,fullFitDistance));
    targetFov=Math.min(MAX_FOV,Math.max(baseFov,requiredFov(fitPoints,focus,axes,distance,aspect)+1.5)); // Reclaim legibility when the longer boom can fit notes with less FOV distortion.
    const possible=requiredFov(fitPoints,focus,axes,distance,aspect)<=MAX_FOV+.25;
    return {offsetX:focus.x-baseTarget.x,offsetY:focus.y-baseTarget.y,offsetZ:focus.z-baseTarget.z,
      distanceScale:distance/baseDistance,fovExtra:Math.max(0,targetFov-baseFov),
      possible,noteCount:points.length};
  }
  function clear(immediate=false){
    owner=null;goal=null;visibleTrigger=-1;fitLimited=false;
    if(immediate){output.offsetX=output.offsetY=output.offsetZ=output.fovExtra=0;output.distanceScale=1;}
  }
  function update({area,playerX,playerZ,camera,baseTarget,baseDistance,azimuth,angle,fovDeg,aspect,enabled=true,now=0}={}){
    const currentArea=String(area||'');
    if(currentArea!==areaKey){clear(true);areaKey=currentArea;lastTime=null;nextProbe=0;previousNormalFrame=false;lastReason='area-changed';}
    if(!enabled||!baseTarget||!Number.isFinite(Number(baseDistance))||!camera){
      clear(true);previousNormalFrame=false;lastReason='camera-owned-elsewhere';return null;
    }
    const dt=lastTime==null?0:clamp((finite(now)-lastTime)/1000,0,.12);
    lastTime=finite(now);
    const onPlate=record=>{
      const p=record.plate;
      return record.area===currentArea&&sources.has(record)&&record.isActive()
        &&Math.hypot(finite(playerX,Infinity)-finite(p.x,Infinity),finite(playerZ,Infinity)-finite(p.z,Infinity))
          <=Math.max(.53,finite(p.radius,.46)+.10);
    };
    if(owner&&!onPlate(owner)){clear();lastReason='left-plate';}
    const residual=Math.abs(output.offsetX)+Math.abs(output.offsetY)+Math.abs(output.offsetZ)
      +Math.abs(output.distanceScale-1)+Math.abs(output.fovExtra); // Prevent a recently assisted frame from counting as a naturally discovered clue on rapid plate re-entry.
    const discoveryReady=previousNormalFrame&&residual<.0005;
    previousNormalFrame=true;
    if(!owner&&discoveryReady&&finite(now)>=nextProbe){
      nextProbe=finite(now)+85; // Once per 85 ms while searching; never raycast/traverse the world's objects.
      for(const source of sources){
        if(!onPlate(source))continue;
        camera.updateMatrixWorld?.(true);
        for(let i=0;i<source.glyphs.length;i++){
          const glyph=source.glyphs[i];
          if(!noteVisible(glyph))continue;
          const point=worldPoint(glyph);
          if(point&&onScreen(point,camera)){
            owner=source;visibleTrigger=i;nextProbe=0;lastReason='note-discovered';break;
          }
        }
        if(owner)break;
      }
    }
    if(owner&&finite(now)>=nextProbe){
      nextProbe=finite(now)+85; // Real note geometry is measured occasionally; camera easing itself remains every frame.
      const points=owner.glyphs.filter(noteVisible).map(worldPoint).filter(Boolean);
      goal=solve(points,owner.plate,baseTarget,baseDistance,finite(azimuth),
        finite(angle),finite(fovDeg,42),Math.max(.25,finite(aspect,1)));
      fitLimited=goal?.possible===false;
      if(!goal){clear();lastReason='notes-unavailable';}
    }
    const target=goal||{offsetX:0,offsetY:0,offsetZ:0,distanceScale:1,fovExtra:0};
    const alpha=1-Math.exp(-5.5*dt); // Same seconds-based lift/zoom feel as the established nearby-tall-surface camera.
    for(const key of ['offsetX','offsetY','offsetZ','distanceScale','fovExtra'])
      output[key]+=(target[key]-output[key])*alpha;
    if(!owner&&Math.abs(output.offsetX)+Math.abs(output.offsetY)+Math.abs(output.offsetZ)
      +Math.abs(output.distanceScale-1)+Math.abs(output.fovExtra)<.0005){
      Object.assign(output,{offsetX:0,offsetY:0,offsetZ:0,distanceScale:1,fovExtra:0});
      return null;
    }
    return output; // Reused value object: no allocation in the camera render loop.
  }
  function isPlateActive(area=areaKey){
    const currentArea=String(area||areaKey); // Reticle callers supply the gameplay area; camera updates maintain the fallback area.
    for(const record of sources){
      if(record.area===currentArea && record.isActive())return true; // Registered owners retire inactive, solved, or disposed music plates.
    }
    return false;
  }
  function debugSnapshot(){
    return {registered:sources.size,active:!!owner,area:areaKey,triggerNote:visibleTrigger,
      reason:lastReason,fitLimited,framing:{...output},notes:goal?.noteCount||0};
  }
  return Object.freeze({register,update,solve,debugSnapshot,isPlateActive,
    reset:()=>{clear(true);previousNormalFrame=false;nextProbe=0;lastTime=null;}, // Authored cinematic takeover must invalidate its outgoing projection before normal gameplay can rediscover a note.
  });
});