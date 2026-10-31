// Static rooted keyframes driven by existing normalized mechanism progress; transitions change growth only.
(function(root){
  'use strict';
  const clamp=value=>Math.max(0,Math.min(1,Number(value)||0)); // Mechanism triggers and manual scrubbing share the same bounded progress.
  function normalizeFrames(frames,stateCount){
    if(!Array.isArray(frames)||frames.length<2)throw new TypeError('A root mechanism needs at least two keyframes.');
    const result=frames.map(frame=>({progress:Number(frame.progress),state:Number(frame.state),label:String(frame.label||'')})); // Copy caller data before sorting or validating.
    for(let i=0;i<result.length;i++)if(!Number.isFinite(result[i].progress)||result[i].progress<0||result[i].progress>1||!Number.isInteger(result[i].state)||result[i].state<0||result[i].state>=stateCount||(i&&result[i].progress<=result[i-1].progress))throw new TypeError('Root mechanism keyframes must be ordered, finite and reference an existing state.');
    if(result[0].progress!==0||result.at(-1).progress!==1)throw new TypeError('Root mechanism keyframes must cover progress 0 to 1.');
    return result;
  }
  function stateWeights(frames,progress,count,overlap=false){
    const weights=new Array(count).fill(0),p=clamp(progress); // Only the two surrounding rooted poses contribute to a transition.
    let right=1;while(right<frames.length-1&&p>frames[right].progress)right++;
    const a=frames[right-1],b=frames[right],t=(p-a.progress)/(b.progress-a.progress); // Repeated states form true holds rather than retracting/regrowing identical geometry.
    if(a.state===b.state){weights[a.state]=1;return weights;}weights[a.state]=overlap?Math.min(1,2*(1-t)):1-t;weights[b.state]=overlap?Math.min(1,2*t):t;return weights;
  }
  function splitGuides(T,states){
    if(!T.Mesh||states.some(state=>!state.target?.traverse))return {common:null,states}; // Lightweight external adapters keep their existing state contract.
    const maps=states.map(state=>{state.target.updateWorldMatrix(true,true);const entries=new Map();let index=0;state.target.traverse(mesh=>{if(mesh.isMesh){entries.set(String(mesh.userData?.authoredPartId||index++),mesh);}});return entries;}); // V50 snapshots retain stable part IDs across all keyframes.
    const commonKeys=new Set();for(const [key,mesh] of maps[0])if(maps.every(map=>{const other=map.get(key);return other&&other.geometry===mesh.geometry&&other.matrixWorld.elements.every((value,i)=>Math.abs(value-mesh.matrixWorld.elements[i])<1e-8);}))commonKeys.add(key);
    if(!commonKeys.size||commonKeys.size===maps[0].size)return {common:null,states}; // A completely static mechanism is already handled by repeated-state holds.
    const flatten=(entries,common)=>{const group=new T.Group();for(const [key,mesh] of entries)if(commonKeys.has(key)===common){const copy=new T.Mesh(mesh.geometry,mesh.material);mesh.matrixWorld.decompose(copy.position,copy.quaternion,copy.scale);copy.name=mesh.name;copy.userData={...mesh.userData,authoredPartId:key};group.add(copy);}return group;}; // These plain guides borrow immutable buffers and never receive runtime pose interpolation.
    return {common:flatten(maps[0],true),states:states.map((state,index)=>({...state,target:flatten(maps[index],false)}))};
  }
  function samplingSource(T,sources){
    const group=new T.Group();group.userData={generatedStrands:0}; // Combine existing floor and invariant support roots without reparenting either rendered source.
    for(const source of sources)if(source){source.updateWorldMatrix(true,true);group.userData.generatedStrands+=source.userData?.generatedStrands||0;source.traverse(mesh=>{if(mesh.isMesh){const copy=new T.Mesh(mesh.geometry,mesh.material);mesh.matrixWorld.decompose(copy.position,copy.quaternion,copy.scale);group.add(copy);}});}
    return group;
  }
  async function createAsync(options={}){
    const T=options.THREE,states=options.states; // The generator supplies original, unrockified guide meshes captured at its authored keyframes.
    if(!T||!Array.isArray(states)||!states.length||states.length>16)throw new TypeError('Pass 1–16 rooted mechanism states.');
    const frames=normalizeFrames(options.keyframes,states.length),guides=splitGuides(T,states),instances=[],group=new T.Group(); // Every pose is built once and keeps fixed transforms for its entire lifetime.
    group.name=String(options.name||'Root-grown ruin mechanism');
    let complete=false,common=null,source=null;
    try{
      if(guides.common){common=await root.LiveRootGrowth.createAsync({...options,target:guides.common,onProgress:step=>options.onProgress?.({...step,part:'Static supports · '+step.part})});group.add(common.group);source=samplingSource(T,[options.growthSource||common.floorGrowth,common.targetGrowth]);}
      for(let index=0;index<states.length;index++){
        if(options.signal?.aborted)throw Object.assign(new Error('Mechanism preparation cancelled.'),{name:'AbortError'});
        const shared=source||options.growthSource||instances[0]?.floorGrowth; // A flat preview generates its floor once; ruin previews borrow their existing vegetation.
        const api=await root.LiveRootGrowth.createAsync({...options,target:guides.states[index].target,...(shared?{growthSource:shared}:{}),
          onProgress:step=>options.onProgress?.({...step,part:'State '+(index+1)+'/'+states.length+' · '+step.part})});
        instances.push(api);group.add(api.group);
      }
      const duration=Number.isFinite(Number(options.transitionDuration))?Math.max(.15,Math.min(30,Number(options.transitionDuration))):.65; // Default matches the existing ruin progress cadence closely.
      let progress=clamp(options.progress),direction=0,pose=clamp(options.poseProgress),poseTarget=pose,version=0,disposed=false,weights=[]; // Presence and mechanism progress are separate, so Grow/Reset still controls the whole object.
      const apply=()=>{const supportChanged=common&&common.getProgress()!==clamp(progress/.55);if(common)common.setProgress(clamp(progress/.55));const presence=common?clamp((progress-.2)/.8):progress;const next=stateWeights(frames,pose,instances.length,options.supportOverlap===true);let changed=supportChanged||weights.length!==next.length;instances.forEach((api,index)=>{const amount=presence*next[index];if(api.getProgress()!==amount){api.setProgress(amount);changed=true;}if(weights[index]!==next[index])changed=true;for(const part of api.partPlan){const visible=api.recipe.showGuide&&next[index]>0;if(part.mesh.visible!==visible)part.mesh.visible=visible;}});weights=next;if(changed)version++;};
      const nearest=()=>{let best=0;for(let i=1;i<weights.length;i++)if(weights[i]>weights[best])best=i;return instances[best];};
      const api={group,states:instances,commonState:common,keyframes:frames,recipe:instances[0].recipe,rootFinish:instances[0].rootFinish,
        setProgress(value){if(!disposed){progress=clamp(value);apply();}return progress;},getProgress:()=>progress,
        extend(){direction=1;},retract(){direction=-1;},pause(){direction=0;poseTarget=pose;},
        setPoseProgress(value){if(!disposed){pose=poseTarget=clamp(value);apply();}return pose;},
        setPoseTarget(value){if(disposed)return;const target=clamp(value);if(frames[0].state===frames.at(-1).state&&pose===1&&(target===0||target===1)){pose=0;apply();}poseTarget=target;},getPoseProgress:()=>pose,getRenderVersion:()=>version,
        update(deltaSeconds){if(disposed)return progress;const delta=Math.max(0,Math.min(.25,Number(deltaSeconds)||0));let changed=false;
          if(direction){progress=clamp(progress+direction*delta/api.recipe.duration);if(progress===0||progress===1)direction=0;changed=true;}
          if(pose!==poseTarget){const distance=poseTarget-pose;pose+=Math.sign(distance)*Math.min(Math.abs(distance),delta/duration);changed=true;}
          if(changed)apply();common?.update(delta);for(const state of instances)state.update(delta);return progress;
        },
        getDiagnostics(){const base=nearest().getDiagnostics(),floor=(common||instances[0]).getDiagnostics();return {...base,progress,direction,substrate:floor.substrate,preparedVegetation:floor.preparedVegetation,floorDensityPasses:floor.floorDensityPasses,
          mechanism:{type:options.type||'authored',poseProgress:pose,target:poseTarget,transitionDuration:duration,keyframeCount:frames.length,uniqueStates:instances.length,staticParts:common?.partPlan.length||0,weights:weights.slice(),growthOnly:true}};},
        dispose(){if(disposed)return;disposed=true;group.parent?.remove(group);for(let i=instances.length-1;i>=0;i--)instances[i].dispose();common?.dispose();}
      };
      for(const key of ['target','floorGrowth','targetGrowth','branches','connectors','partPlan','partGrowths','emitterVisuals'])Object.defineProperty(api,key,{get:()=>key==='floorGrowth'?(common||instances[0]).floorGrowth:nearest()[key]}); // Keep the existing author/diagnostics contract without moving any pose geometry.
      apply();complete=true;return api;
    }finally{if(!complete){for(let i=instances.length-1;i>=0;i--)instances[i].dispose();common?.dispose();}}
  }
  async function bindRuntimeAsync(options){
    const {THREE:T,specification:spec,scene,surfaces,scope,id}=options;
    let controller=null,complete=false,disposed=false;const ids=[],hidden=[];
    try{
      controller=await createAsync({...options,states:spec.states,keyframes:spec.keyframes,progress:1,supportOverlap:true});
      controller.group.position.copy(spec.anchor);scene.add(controller.group);controller.group.updateWorldMatrix(true,true);
      if(options.type!=='stoneDoor'&&options.type!=='transitDoor'){
        for(const state of [...(controller.commonState?[controller.commonState]:[]),...controller.states])for(const part of state.partPlan){
          // Capture fixed keyframe envelopes once. Native moving-guide bounds never enter collision.
          if(part.mesh.userData.rootSupportEligible===false)continue;const box=new T.Box3().setFromObject(part.mesh),surfaceId=id+':root:'+ids.length;
          if(box.isEmpty())continue;ids.push(surfaceId);
          surfaces.registerSurface({id:surfaceId,scope,priority:12,bounds:{minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z},topY:box.max.y,
            enabled:()=>!disposed&&state.getPartProgress(part.index)>=.85});
        }
      }
      const source=options.source;
      source.traverse(mesh=>{if(mesh.isMesh){const original=mesh.material;if((Array.isArray(original)?original:[original]).every(material=>material?.transparent||material?.depthWrite===false))return;const materials=(Array.isArray(original)?original:[original]).map(material=>{const copy=material.clone();copy.visible=false;return copy;});hidden.push({mesh,original,materials});mesh.material=Array.isArray(original)?materials:materials[0];}});
      const binding={controller,setProgress(value){const pose=clamp(value);if(pose<controller.getPoseProgress()&&options.isOccupied?.())return;if(controller.getPoseProgress()!==pose)controller.setPoseProgress(pose);},
        isDoorClosed:()=>{const state=controller.states[spec.keyframes[0].state];return state.partPlan.some(part=>state.getPartProgress(part.index)>.35);},
        dispose(){if(disposed)return;disposed=true;for(const key of ids)surfaces.remove(key);for(const item of hidden){item.mesh.material=item.original;for(const material of item.materials)material.dispose();}if(source.rootGrowthBinding===binding)delete source.rootGrowthBinding;source.traverse(node=>{delete node.userData.rootGrowthSurfaceSuppressed;});controller.dispose();spec.dispose();}};
      source.rootGrowthBinding=binding;source.traverse(node=>{node.userData.rootGrowthSurfaceSuppressed=true;});complete=true;return binding;
    }finally{if(!complete){for(const key of ids)surfaces.remove(key);for(const item of hidden){item.mesh.material=item.original;for(const material of item.materials)material.dispose();}controller?.dispose();spec.dispose();}}
  }
  root.LiveRootMechanisms={createAsync,bindRuntimeAsync,normalizeFrames,stateWeights};
})(typeof window!=='undefined'?window:globalThis);
