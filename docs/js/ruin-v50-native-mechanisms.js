// V50-authored mechanism bridge for each independently generated native dungeon story.
// All geometry and puzzle state are owned by the original V50 objects. This adapter
// supplies the game's shared interaction, projectile, collision and support systems.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinV50NativeMechanisms=api;
})(typeof self!=='undefined'?self:globalThis,function(host){
  'use strict';
  const MOTIONS=new Set(['bridge','bridgeSequence','stoneDoor','movingDais','collapsingStairs']);
  const ACTIVATORS=new Set(['pressurePlate','torch','brazier','glyphObelisk','stackedObelisk','linkedCubePillars']);
  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
  const finite=n=>Number.isFinite(Number(n));

  function inspect(nativeRoot){
    const mechanisms=new Map(),activators=[],blocks=[],fixedBlocks=[],transitDoors=[]; // Fixed V50 push-route shapers must block upper-story players, not just the movable burden.
    nativeRoot?.traverse?.(object=>{
      const d=object.userData||{},motion=d.previewMotion?.type;
      if(d.mechanismId&&MOTIONS.has(motion))mechanisms.set(String(d.mechanismId),object);
      if(d.activatorType&&ACTIVATORS.has(d.activatorType)&&d.linkedMechanismId){
        // V50's glyph sets contain nested carved glyphs. Retain their
        // leaves for the shared projectile runtime, but only one record
        // per actual interactive tower/control group.
        activators.push(object);
      }
      if(d.pushable&&(motion==='pushPuzzleBlock'||motion==='elevatorPushBlock'))blocks.push(object);
      if(d.immovable===true&&d.blockerPurpose)fixedBlocks.push(object);
      if(d.transitDoor)transitDoors.push(object);
    });
    return {mechanisms,activators,blocks,fixedBlocks,transitDoors};
  }
  function namespace(nativeRoot,floor){
    const prefix='native-v50-f'+floor+'-'; // V50 restarts mechanism numbering every generated floor; parent glyph circuits need globally unique keys.
    nativeRoot?.traverse?.(node=>{
      for(const field of ['mechanismId','linkedMechanismId']){
        const id=node.userData?.[field];
        if(id!=null&&!String(id).startsWith(prefix))node.userData[field]=prefix+id;
      }
    });
    return prefix;
  }

  function mount(options={}){
    const {nativeRoot,floor,scope,api,THREE,DynamicSurfaces:DS,getPlayerPosition,getPlayerY,
      addControl,removeControl,heightAt,showToast,onStateChange}=options;
    if(!nativeRoot?.traverse||!api?.applyProgress||!api?.syncPressurePlates||
       !THREE?.Box3||!DS?.registerSurface||!DS?.registerBlocker||typeof addControl!=='function')
      throw new Error('Native V50 mechanisms require the original generator bridge, geometry and game interactions');
    const inventory=inspect(nativeRoot);
    const boxScratch=new THREE.Box3(); // Reused when sampling authored doors, push-block bounds and moving-surface support.
    const states=new Map(),controls=[],surfaceIds=[],blockerIds=[];
    const worldBox=object=>{
      object?.updateWorldMatrix?.(true,true);
      const box=boxScratch.setFromObject(object);
      return box.isEmpty()?null:box;
    };
    const center=object=>{
      const box=worldBox(object);
      return box?box.getCenter(new THREE.Vector3()):object.getWorldPosition?.(new THREE.Vector3())||new THREE.Vector3();
    };
    const bounds=object=>{
      const box=worldBox(object);
      return box?{minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z}:{minX:0,maxX:0,minZ:0,maxZ:0};
    };
    const levelAt=object=>{
      const c=center(object),level=heightAt?.(c.x,c.z);
      return finite(level)?Number(level):Number(options.floorY)||0;
    };
    const nearFloor=object=>{
      const y=Number(getPlayerY?.());
      return Number.isFinite(y)&&Math.abs(y-levelAt(object))<1;
    };
    const control=record=>{addControl(record);controls.push(record);return record;};
    const trackSurface=(id,object,priority=12,enabled=()=>true)=>{
      DS.registerSurface({id,scope,priority,bounds:()=>bounds(object),
        topY:()=>worldBox(object)?.max.y??0,enabled});
      surfaceIds.push(id);
    };
    const trackBlocker=(id,object,enabled=()=>true)=>{
      DS.registerBlocker({id,scope,bounds:()=>bounds(object),enabled,
        blocksAt:(_x,_z,actorHeight,_rec,_radius,context)=>{
          const level=levelAt(object),actorY=Number(context?.y??getPlayerY?.());
          return Number.isFinite(actorY)&&actorY<level+2.65&&actorY+actorHeight>level-.1;
        }});
      blockerIds.push(id);
    };
    for(const [id,object] of inventory.mechanisms){
      const motion=object.userData.previewMotion.type;
      const linked=inventory.activators.filter(activator=>String(activator.userData.linkedMechanismId)===id);
      const state={id,object,motion,linked,target:0,progress:0,solved:false,
        requiresPuzzle:linked.length>0,lastApplied:null,reapplyAfter:0}; // Cache the last native V50 pose to avoid traversing an unchanged mechanism sixty times a second.
      states.set(id,state);
      if(motion==='stoneDoor'){
        const panel=(object.children||[]).find(child=>child.isMesh&&child.geometry)||object;
        trackBlocker(scope+'-stone-door-'+id,panel,()=>state.progress<.88);
      }else if(motion==='bridge'||motion==='bridgeSequence'){
        const bridgeExtended=()=>{
          const range=object.userData.previewRange||object.userData.previewMotion?.previewRange;
          const p=range?.length===2?clamp((state.progress-range[0])/Math.max(.0001,range[1]-range[0]),0,1):state.progress; // Use the exact local motion curve that V50 draws, including nested puzzle preview ranges.
          const extension=motion==='bridgeSequence'
            ?(p<.22?p/.22:p<.76?1:(1-p)/.24):p;
          return extension>.75; // Floor support is never granted under a visually retracted bridge.
        };
        trackSurface(scope+'-moving-bridge-'+id,object,12,bridgeExtended);
      }else if(motion==='movingDais'){
        trackSurface(scope+'-moving-dais-'+id,object.userData.movingDaisPlatform||object,14);
      }else if(motion==='collapsingStairs'){
        for(const [index,tread] of (object.userData.stairTreads||[]).entries())
          trackSurface(scope+'-stair-'+id+'-'+index,tread,12,()=>tread.scale.y>.08);
      }
      if(!state.requiresPuzzle){
        control({kind:'v50NativeMechanism',object,promptRoot:object,
          range:1.9,priority:16,touchIcon:'✋',
          label:()=>motion==='bridgeSequence'?'Trigger Timed Bridge'
            :state.target>.5?'Reset Stone Mechanism':'Activate Stone Mechanism',
          onPress:()=>{
            if(!nearFloor(object))return;
            if(motion==='bridgeSequence'){
              state.progress=0;state.target=1; // The authored bridge opens, holds and retracts as the player crosses. Another press can retrigger it.
            }else state.target=state.target>.5?0:1;
            onStateChange?.();
          }});
      }
    }
    for(const object of inventory.activators){
      const d=object.userData,state=states.get(String(d.linkedMechanismId));
      if(!state)continue;
      if(d.activatorType==='linkedCubePillars'&&Array.isArray(d.rotatingSegments)){
        for(const entry of d.rotatingSegments){
          const segment=entry?.segment,index=Number(entry?.controlIndex);
          if(!segment||!Number.isInteger(index))continue;
          control({kind:'v50NativeLinkedCube',object:segment,promptRoot:segment,range:2.05,
            touchIcon:'↻',priority:26,floorY:levelAt(object),
            label:'Rotate Cube '+(d.labels?.[index]||index+1),
            onPress:()=>{if(!nearFloor(object))return;
              api.rotateLinkedCube?.(object,index,1);onStateChange?.();}});
        }
      }else if(d.activatorType==='stackedObelisk'&&Array.isArray(d.rotatingSegments)){
        const rotations=d.rotatingSegments;
        for(const [index,entry] of rotations.entries()){
          const segment=entry?.segment;
          if(!segment)continue;
          control({kind:'v50NativeObelisk',object:segment,promptRoot:segment,
            range:2.05,priority:26,touchIcon:'↻',floorY:levelAt(object),
            label:'Turn Obelisk Ring '+(index+1),
            onPress:()=>{
              if(!nearFloor(object))return;
              const old=Math.round(segment.rotation.y/(Math.PI*.5));
              segment.rotation.y=((old+1)%4)*(Math.PI*.5);
              const solved=rotations.every(item=>Math.abs(Math.round(item.segment.rotation.y/(Math.PI*.5))%4)===0);
              d.solveProgress=solved?1:0;
              if(solved){
                state.target=1;api.applyProgress(object,1);
                showToast?.('The obelisk aligns.',true);
              }
              onStateChange?.();
            }});
        }
      }
      // Glyphs, torches and braziers are intentionally NOT interact prompts.
      // DevRandomRuinHitPuzzles' real ranged-hit and carried-torch collision
      // code scans this native root, so they remain physical puzzles.
    }
    for(const fixed of inventory.fixedBlocks)
      trackBlocker(scope+'-v50-fixed-block-'+fixed.id,fixed); // Without height-aware collision, the player can walk through original V50 push-puzzle stoppers.
    for(const block of inventory.blocks){
      let route=Array.isArray(block.userData.pushPath)?block.userData.pushPath:null;
      if(!route||route.length<2)continue;
      let step=0; // One push moves a real V50 block one authored route node; reused by the next push and the pressure plate signal.
      const elevator=block.userData.previewMotion?.type==='elevatorPushBlock';
      trackBlocker(scope+'-pushblock-'+block.id,block);
      control({kind:'v50NativePushBlock',object:block,promptRoot:block,range:1.8,
        touchIcon:'✋',priority:23,label:elevator?'Push Lift Block':'Push Stone Block',
        onPress:()=>{
          if(step>=route.length-1||!nearFloor(block))return;
          const next=route[step+1],current=center(block),player=getPlayerPosition?.();
          if(!player)return;
          const dx=Number(next.x)-Number(route[step].x),dz=Number(next.z)-Number(route[step].z);
          const length=Math.hypot(dx,dz);if(length<.001)return;
          // The block is pushed from behind, not remotely activated through walls.
          const pToBlock={x:current.x-player.x,z:current.z-player.z};
          const magnitude=Math.hypot(pToBlock.x,pToBlock.z);
          if(magnitude>2.2||magnitude<.15)return;
          const pushDot=(pToBlock.x*dx+pToBlock.z*dz)/(magnitude*length);
          if(pushDot<.45){showToast?.('Stand behind the stone block to push it.',false);return;}
          if(elevator){
            const routeFraction=(step+1)/(route.length-1);
            const localProgress=.45+.55*routeFraction; // V50's original lift curve reserves 0–.45 for raising the block, then .45–1 for its authored route.
            const range=block.userData.previewRange||block.userData.previewMotion?.previewRange;
            const progress=range?.length===2?range[0]+(range[1]-range[0])*localProgress:localProgress;
            api.applyProgress(block,progress);
          }else{
            block.position.set(Number(next.x),Number(next.y)||0,Number(next.z));
          }
          step++;
          api.syncPressurePlates(nativeRoot);
          onStateChange?.();
        }});
    }
    for(const door of inventory.transitDoors){
      const panel=(door.children||[]).find(child=>child?.isMesh&&child.geometry)||door;
      const box=worldBox(panel),height=box?.max.y-box?.min.y||2;
      const closed=Number(panel.position.y)||0;
      const state={door,panel,open:0,target:0,closed,height};
      trackBlocker(scope+'-transit-door-'+door.id,panel,()=>state.open<.88);
      control({kind:'v50NativeTransitDoor',object:door,promptRoot:door,range:1.9,
        priority:21,touchIcon:'✋',label:()=>state.target?'Close Stone Door':'Open Stone Door',
        onPress:()=>{if(!nearFloor(door))return;state.target=state.target?0:1;}});
      inventory.transitDoors[inventory.transitDoors.indexOf(door)]=state;
    }
    const unreg=options.hitPuzzles?.registerExternalRoot?.(nativeRoot);
    if(typeof unreg!=='function')
      throw new Error('Original V50 glyph and torch hit runtime could not register the native floor');
    let disposed=false; // All interactions, external glyphs, dynamic support and blockers have one floor-scoped owner.
    function tick(dt){
      if(disposed)return;
      const step=Math.max(0,Math.min(.05,Number(dt)||0));
      for(const state of states.values()){
        const d=state.object.userData,plate=d.linkedPressurePlateRoot,cubes=d.linkedCubePuzzleRoot;
        const plateValue=Number(plate?.userData?.weightProgress),cubeValue=Number(cubes?.userData?.solveProgress);
        let desired=state.target;
        if(plate&&Number.isFinite(plateValue))desired=plateValue;
        else if(cubes&&Number.isFinite(cubeValue))desired=cubeValue;
        state.solved=desired>.95; // Real V50 solution signal drives the visible mechanism; never use the substitute wing stage to solve it.
        state.progress+=clamp(desired-state.progress,-step*1.55,step*1.55);
        if(Math.abs(state.progress-desired)<.001)state.progress=desired;
        state.reapplyAfter-=step;
        if(state.lastApplied!==state.progress||state.reapplyAfter<=0){
          api.applyProgress(state.object,state.progress);
          state.lastApplied=state.progress;
          state.reapplyAfter=1; // Unchanged authored stone still gets a periodic restoration pass.
        }
      }
      for(const state of inventory.transitDoors){
        state.open+=clamp(state.target-state.open,-step*2.4,step*2.4);
        state.panel.position.y=state.closed+(state.height+.12)*(state.open*state.open*(3-2*state.open));
      }
    }
    function stageCandidate(room){
      if(!room)return null;
      for(const state of states.values()){
        for(const activator of state.linked){
          const pos=center(activator);
          if(pos.x>room.x+.25&&pos.x<room.x+room.w-.25
            &&pos.z>room.z+.25&&pos.z<room.z+room.d-.25)
            return {id:state.id,kind:activator.userData.activatorType};
        }
      }
      return null;
    }
    function dispose(){
      if(disposed)return;disposed=true;unreg();
      for(const record of controls)removeControl?.(record);
      for(const id of [...surfaceIds,...blockerIds])DS.remove?.(id);
    }
    return {tick,dispose,inventory,states,stageCandidate,
      isSolved:id=>states.get(String(id))?.solved===true,
      getState:()=>({
        mechanisms:states.size,activators:inventory.activators.length,
        pushBlocks:inventory.blocks.length,fixedBlocks:inventory.fixedBlocks.length,
        transitDoors:inventory.transitDoors.length,
        solved:[...states.values()].filter(state=>state.solved).length,
        families:[...new Set(inventory.activators.map(item=>item.userData.activatorType))].sort(),
        motions:[...new Set([...states.values()].map(item=>item.motion))].sort(),
      })};
  }
  return Object.freeze({MOTIONS,ACTIVATORS,inspect,namespace,mount});
});
