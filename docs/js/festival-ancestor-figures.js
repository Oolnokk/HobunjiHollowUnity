// Frozen fully assembled NPC-based ancestor figures for the Tzizkhanash shrine furniture.
// The portrait compositor remains the source of species, clothing, age, hair and facial appearance.
(() => {
  'use strict';
  const LIMIT = 3; // Each one-tile shrine presents up to three scaled historical figures.
  const CELL_COUNT = 12; // Each calculated square of the portrait reuses the whole carved_smooth PNG, stretched to that cell.
  const fallback = Object.freeze([
    {id:'unnamed_ancestor_0',name:'Unrecorded ancestor',appearance:{speciesId:'mao-ao',gender:'male',randomSeed:'tzizkhanash-stone-0',cosmetics:{}}},
    {id:'unnamed_ancestor_1',name:'Unrecorded ancestor',appearance:{speciesId:'mao-ao',gender:'female',randomSeed:'tzizkhanash-stone-1',cosmetics:{}}},
    {id:'unnamed_ancestor_2',name:'Unrecorded ancestor',appearance:{speciesId:'mao-ao',gender:'male',randomSeed:'tzizkhanash-stone-2',cosmetics:{}}}
  ]); // Explicitly unnamed fallbacks avoid falsely attributing an invented appearance to an actual deceased NPC.
  const poses = Object.freeze([
    {x:-.29,z:0,scale:.23,tilt:-.10,head:.14,handRise:.13},
    {x:0,z:-.055,scale:.26,tilt:.04,head:-.08,handRise:.05},
    {x:.29,z:0,scale:.22,tilt:.12,head:-.12,handRise:.2}
  ]); // Stable authored statue poses: a greeting, a contemplative stance and a raised hand.
  let stonePromise = null; // One cached source PNG load shared by every shrine; never loaded per statue.
  const active = new Set(); // Kept only for mobile diagnostics and unloading on town layout changes.
  let lastError = '';
  function stoneImage() {
    if (stonePromise) return stonePromise;
    stonePromise = new Promise((resolve,reject)=>{
      const image = new Image();
      image.onload = ()=>resolve(image);
      image.onerror = ()=>reject(new Error('carved_smooth.png could not load'));
      image.src = 'assets/textures/carved_smooth.png';
    }).catch(error=>{ stonePromise=null; throw error; });
    return stonePromise;
  }
  function historicalRecords(record) {
    const authored = Array.isArray(record?.ancestorFigures) ? record.ancestorFigures.filter(r=>r?.appearance) : [];
    if (authored.length) return authored.slice(0,LIMIT); // Map-authored historical NPC exports take precedence without converting them to new living walkers.
    const departed = (window.FestivalSystem?.getNpcs?.() || []).filter(npc =>
      npc?.appearance && (npc.deceased || npc.dead || /deceased/i.test(npc.role || ''))); // Actual dead NPC exports preserve their original appearances when available.
    return departed.length ? departed.slice(0,LIMIT) : fallback;
  }
  function carvedCanvas(original,stone) {
    const width=original.width, height=original.height;
    const output=document.createElement('canvas'); output.width=width; output.height=height;
    const context=output.getContext('2d',{willReadFrequently:true});
    const originalPixels=original.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height);
    const cellW=Math.ceil(width/CELL_COUNT), cellH=Math.ceil(height/CELL_COUNT);
    // Each calculated cell gets its own 0..1 stone texture UV field, rather than tiling by original texture pixels.
    for(let y=0;y<height;y+=cellH)for(let x=0;x<width;x+=cellW)
      context.drawImage(stone,x,y,Math.min(cellW,width-x),Math.min(cellH,height-y));
    const stonePixels=context.getImageData(0,0,width,height);
    const from=originalPixels.data,to=stonePixels.data;
    let painted=0;
    for(let i=0;i<from.length;i+=4) {
      const opaque=from[i+3]>8;
      const nonBlack=from[i]>18||from[i+1]>18||from[i+2]>18;
      if(!opaque) {to[i+3]=0;continue;}
      if(nonBlack) {
        to[i+3]=from[i+3]; // Black outlines remain black; all other visible portrait pixels use the stretched stone surface.
        painted++;
      } else { to[i]=from[i];to[i+1]=from[i+1];to[i+2]=from[i+2];to[i+3]=from[i+3]; }
    }
    context.putImageData(stonePixels,0,0);
    output.dataset && (output.dataset.ancestorStonePixels=String(painted));
    return output;
  }
  function poseFor(record,index) {
    const authored = record?.ancestorPose || record?.statuePose || {}; // Authored historical NPC exports may freeze any of the supported transforms.
    const defaultPose = poses[index] || poses[0];
    const clamp = (field,lower,upper) => {
      const value = Number(authored[field]);
      return Number.isFinite(value) ? Math.max(lower,Math.min(upper,value)) : defaultPose[field];
    };
    return {
      x:clamp('x',-.42,.42),z:clamp('z',-.42,.42),
      scale:clamp('scale',.09,.4),tilt:clamp('tilt',-.45,.45),
      head:clamp('head',-.5,.5),handRise:clamp('handRise',-.2,.4)
    }; // Bounded, serializable statue pose values never mutate the source NPC or turn into an animation loop.
  }
  function staticPose(model,pose,parts) {
    model.position.set(pose.x,.53,pose.z);
    model.scale.setScalar(pose.scale);
    model.rotation.z=pose.tilt;
    const neck=model.userData?.neckRig?.neckJoint;
    if(neck) neck.rotation.z=pose.head;
    // Reuse the real NPC hand and leg rigs, then freeze the transform immediately; no walker, schedule or animation tick exists.
    parts.hands?.setSideIdle?.('left',{position:{y:pose.handRise*model.userData.portraitModelHeight},rotationDeg:{z:12}});
    parts.hands?.setSideIdle?.('right',{position:{y:-pose.handRise*model.userData.portraitModelHeight*.5},rotationDeg:{z:-8}});
    parts.legs?.update?.(0,0,true); // Suppressed movement initializes native feet in the resting stance without starting an animation.
    model.updateMatrixWorld?.(true);
  }
  function addRig(THREE,model,record,profile,source) {
    const data=model.userData || {};
    const options={
      avatarRoot:model, speciesId:record.appearance?.speciesId || profile.fighter?.speciesId,
      gender:record.appearance?.gender || profile.fighter?.gender, profile, npcRecord:record,
      modelWidth:data.portraitModelWidth, modelHeight:data.portraitModelHeight,
      handAttachX:data.handAttachX, handAttachY:data.handAttachY,
      bodyColors:profile.bodyColors, sourceCanvas:source, portraitRig:data.neckRig
    }; // Uses the same species, rig scale and actual attachment coordinates as live NPC assembly.
    return {
      hands:window.ProceduralHandAttachments?.attach?.(THREE,model,options) || null,
      legs:window.ProceduralLegAnimation?.attach?.(THREE,model,options) || null
    };
  }
  async function buildFigure(THREE,record,pose,index,stone) {
    const preview=window.NpcAvatarPreview,avatar=window.PNGPlaneAvatar;
    if(!preview?.buildProfileFromNpcExport||!preview?.renderProfileToCanvas||!avatar?.buildSinglePlaneAvatarModel)
      throw new Error('NPC portrait/rig assembly has not initialized');
    const profile=preview.buildProfileFromNpcExport(record);
    if(!profile)throw new Error('No rendered portrait profile for '+(record.id || record.name || index));
    const front=document.createElement('canvas');front.width=256;front.height=256;
    const back=document.createElement('canvas');back.width=256;back.height=256;
    await preview.renderProfileToCanvas(front,profile,{forceEyesOpen:true,seatId:'ancestor-stone:'+index,breathingComposer:null});
    await preview.renderProfileToCanvas(back,profile,{portraitView:'behind',forceEyesOpen:true,seatId:'ancestor-stone-back:'+index,breathingComposer:null});
    const carvedFront=carvedCanvas(front,stone), carvedBack=carvedCanvas(back,stone);
    const model=avatar.buildSinglePlaneAvatarModel(THREE,carvedFront,{
      name:'tzizkhanash_ancestor_'+index,backCanvas:carvedBack,profile,npcRecord:record,neckRig:true
    });
    model.userData.ancestorSourceId=record.id || record.name || 'unrecorded';
    model.userData.ancestorPose={...pose}; // Mobile inspection can see the frozen authored pose and identity.
    const parts=addRig(THREE,model,record,profile,carvedFront);
    staticPose(model,pose,parts);
    return {model,parts};
  }
  async function decorate(group,record,legacy=null) {
    if(!group || group.userData?.festivalDisposed)return false;
    const entry={group,figures:[],ready:false,failed:false};
    active.add(entry);
    group.userData.ancestorFigureEntry=entry;
    try {
      const [stone]=await Promise.all([stoneImage(),window.NpcAvatarPreview?.ensurePortraitCosmetics?.({configBase:'config/'})]);
      if(group.userData.festivalDisposed)return false;
      const records=historicalRecords(record);
      for(let i=0;i<Math.min(LIMIT,records.length);i++) {
        try {
          const figure=await buildFigure(window.THREE,records[i],poseFor(records[i],i),i,stone);
          if(group.userData.festivalDisposed) {
            figure.parts.hands?.dispose?.(); figure.parts.legs?.dispose?.();
            window.PNGPlaneAvatar?.disposeAvatarModel?.(figure.model);
            break;
          }
          group.add(figure.model);
          entry.figures.push(figure);
        } catch(error) {lastError=String(error?.message||error);}
      }
      entry.ready=entry.figures.length>0;
      entry.failed=!entry.ready;
      if(entry.ready && legacy) legacy.visible=false; // Only replace the old primitive carvings after a real NPC figure exists.
      return entry.ready;
    } catch(error) {
      lastError=String(error?.message||error);
      entry.failed=true;
      return false; // Keep the old authored carvings visible on portrait/texture loading failures.
    }
  }
  function dispose(root) {
    root?.traverse?.(node=>{
      const entry=node.userData?.ancestorFigureEntry;
      if(!entry)return;
      node.userData.festivalDisposed=true; // Prevent pending async bakes from attaching to a removed shrine.
      active.delete(entry);
      for(const figure of entry.figures) {
        figure.parts.hands?.dispose?.(); figure.parts.legs?.dispose?.();
        figure.model.parent?.remove(figure.model);
        window.PNGPlaneAvatar?.disposeAvatarModel?.(figure.model);
      }
      entry.figures.length=0;
      delete node.userData.ancestorFigureEntry;
    });
  }
  function diagnostics(){return {activeShrines:active.size,statues:[...active].reduce((n,e)=>n+e.figures.length,0),ready:[...active].filter(e=>e.ready).length,lastError,texture:'carved_smooth.png',cellsPerAxis:CELL_COUNT};}
  window.FestivalAncestorFigures={decorate,dispose,carvedCanvas,historicalRecords,poseFor,diagnostics};
  window.__tzizkhanashAncestorFiguresDebug=diagnostics; // Copyable mobile diagnostics; no console required.
})();
