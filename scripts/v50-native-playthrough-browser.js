'use strict';
// Playwright drives the ACTUAL generated multi-story V50 floor records.
// This is an instrumented solvability test: it performs authored control
// callbacks, registered projectile-hit callbacks and menu note-result events,
// while checking planar floor routes and physical CellGrid3D gate voxels.
// It does not pretend to test weapon aim, the flute performance UI or real-time
// manual climbing. Those need separate controller-level browser playthroughs.
module.exports=async function runNativeV50Playthrough(page){
  return page.evaluate(async()=>{
    const game=window.DevRandomRuin; // The live runtime provides the only stage and support authority; no generated mock rooms.
    const owner=game?.getNativeV50TestRuntime?.(); // Developer-only reference to real mounted V50 story roots.
    if(!owner?.records?.length)throw new Error('No playable native V50 story records after successful game generation');
    const THREE=window.THREE,DS=window.DynamicSurfaces;
    const hit=window.DevRandomRuinHitPuzzles,controls=()=>game.getInteractionControls();
    const steps=[],sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)); // Used to let the actual renderer and original V50 signal/animation systems tick.
    const key=(x,z)=>Math.floor(x)+','+Math.floor(z);
    const fail=(phase,record,stage,details)=>{throw new Error('V50 autoplay '+JSON.stringify({
      phase,floor:record?.floor,stage:stage?.id||null,kind:stage?.kind||null,
      solved:record?.solved??null,details,
      trace:steps.slice(-14),signals:hit?.snapshot?.()?.signalStates?.slice(0,30),
      state:owner.getState?.().perFloor?.find(row=>row.floor===record?.floor),
    }));};
    const box=object=>object?new THREE.Box3().setFromObject(object):null;
    const point=object=>{
      const bounds=box(object),center=bounds?.getCenter(new THREE.Vector3());
      return center?{x:center.x,y:bounds.min.y,z:center.z}:null;
    };
    const put=async (location,record,stage)=>{
      if(!location||!Number.isFinite(location.x)||!Number.isFinite(location.z))
        fail('invalid checkpoint',record,stage,location);
      const nominal=Number(location.y);
      const surface=DS.sampleSupport(location.x,location.z,{minY:nominal-1.4,maxY:nominal+1.5,pad:.02});
      const y=surface?.y??nominal;
      if(!Number.isFinite(y)||!game.setPlayerWorldPoint({x:location.x,y,z:location.z},{grounded:true,snapCamera:false}))
        fail('unsupported checkpoint',record,stage,{location,surface:surface?.id||null});
      await sleep(70);
      if(Math.abs(Number(game.getPlayerGroundSupportY?.())-y)>.5)
        fail('player support snapped to another floor',record,stage,{location,y,physicalY:game.getPlayerGroundSupportY?.()});
      return y;
    };
    const layout=record=>{
      const meta=record.meta,place=record.place,walk=new Set();
      if(!meta?.floorCells?.length)throw new Error('Native V50 story must retain its original floor-cell topology for solvability testing');
      for(const [c,r] of meta.floorCells){
        const x0=place.originX+c*place.cs,z0=place.originZ+r*place.cs;
        for(let x=Math.floor(x0);x<=Math.floor(x0+place.cs-.000001);x++)
          for(let z=Math.floor(z0);z<=Math.floor(z0+place.cs-.000001);z++)walk.add(key(x,z));
      }
      for(const [x,z] of record.route.tiles)walk.add(key(x,z));
      return walk;
    };
    const nearest=(walk,x,z)=>{
      const centerX=Math.floor(x),centerZ=Math.floor(z);
      for(let radius=0;radius<=12;radius++)
        for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++){
          if(Math.abs(dx)!==radius&&Math.abs(dz)!==radius)continue;
          const cell=key(centerX+dx,centerZ+dz);
          if(walk.has(cell))return cell;
        }
      return null;
    };
    const route=(walk,from,to,blocked)=>{
      const start=nearest(walk,from.x,from.z),end=nearest(walk,to.x,to.z);
      if(!start||!end||blocked.has(start)||blocked.has(end))return null;
      const q=[start],prior=new Map([[start,null]]),dirs=[[1,0],[-1,0],[0,1],[0,-1]];
      for(let i=0;i<q.length;i++){
        const at=q[i];if(at===end)break;
        const [x,z]=at.split(',').map(Number);
        for(const [dx,dz] of dirs){
          const other=key(x+dx,z+dz);
          if(!walk.has(other)||blocked.has(other)||prior.has(other))continue;
          prior.set(other,at);q.push(other);
        }
      }
      if(!prior.has(end))return null;
      const cells=[];for(let at=end;at!==null;at=prior.get(at))cells.push(at);
      return cells.reverse(); // These are actual generator-supported floor cells, not a synthetic shortcut through a sealed gate.
    };
    const closedCells=record=>new Set(record.challenges.filter(stage=>stage.gate?.object.visible)
      .flatMap(stage=>stage.gate.tiles.map(([x,z])=>key(x,z))));
    const trigger=async (control,record,stage)=>{
      if(!control||typeof control.onPress!=='function')fail('missing in-game interaction control',record,stage,control?.kind);
      const result=await control.onPress(); // Same closure that the ordinary keyboard/controller/mobile action bar executes.
      await sleep(65);
      return result;
    };
    const puzzleControl=(kind,object)=>controls().find(control=>control.kind===kind&&control.object===object);
    const floorY=record=>Number(record.challenges[0]?.floorY??record.floor*4);
    const hitCircuit=async (mechanismId,command,record,stage)=>{
      const circuits=hit.getGlyphCircuits();
      const circuit=circuits.find(entry=>entry.mechanismId===mechanismId);
      if(!circuit)fail('V50 glyph circuit not registered',record,stage,{mechanismId,circuits:circuits.map(entry=>entry.mechanismId)});
      const targets=circuit.targets.filter(target=>!command||target.command===command);
      if(!targets.length)fail('V50 glyph command missing hit targets',record,stage,{mechanismId,command});
      for(const target of targets){
        if(target.active)continue;
        if(hit.debugActivateGlyph(target.object)!==true)
          fail('projectile hit callback rejected real V50 glyph',record,stage,{mechanismId,command,target:target.id});
      }
      steps.push({floor:record.floor,stage:stage.id,event:'registered-glyph-hit-callback',mechanismId,command:command||null,hits:targets.length});
      await sleep(260);
    };
    const turnCubes=async(actor,record,stage)=>{
      const data=actor.userData,initial=data.states?.slice(),links=data.linkage;
      if(!Array.isArray(initial)||initial.length!==4||!Array.isArray(links)||links.length!==4)
        fail('native cube puzzle missing original 2x2 state/linkage',record,stage,{states:initial,links});
      const encode=states=>states.join(',');
      const solved=states=>states.every(value=>value===states[0]);
      const q=[initial],prev=new Map([[encode(initial),null]]),edge=new Map(),max=256;
      for(let i=0;i<q.length&&i<max;i++){
        const states=q[i];if(solved(states))break;
        for(let control=0;control<4;control++){
          const next=states.slice();
          for(const index of links[control])next[index]=(next[index]+1)%4;
          const code=encode(next);
          if(prev.has(code))continue;
          prev.set(code,encode(states));edge.set(code,control);q.push(next);
        }
      }
      const goal=q.find(solved);
      if(!goal)fail('real V50 cube scramble has no legal rotation solution',record,stage,{initial});
      const moves=[];for(let at=encode(goal);prev.get(at)!==null;at=prev.get(at))moves.push(edge.get(at));
      moves.reverse();
      await put({...point(actor),y:floorY(record)},record,stage);
      for(const controlIndex of moves){
        const segment=data.rotatingSegments?.[controlIndex]?.segment;
        const control=puzzleControl('v50NativeLinkedCube',segment);
        await trigger(control,record,stage);
      }
      steps.push({floor:record.floor,stage:stage.id,event:'native-cube-controls',moves:moves.length,statesBefore:initial});
      await sleep(900); // V50's native cube solveProgress interpolates on its own render frame clock.
    };
    const turnObelisk=async(actor,record,stage)=>{
      await put({...point(actor),y:floorY(record)},record,stage);
      for(const entry of actor.userData.rotatingSegments||[]){
        const rotation=()=>((Math.round(entry.segment.rotation.y/(Math.PI*.5))%4)+4)%4;
        for(let attempts=0;rotation()!==0&&attempts<4;attempts++)
          await trigger(puzzleControl('v50NativeObelisk',entry.segment),record,stage);
        if(rotation()!==0)fail('obelisk ring did not align',record,stage,entry);
      }
      steps.push({floor:record.floor,stage:stage.id,event:'native-rotating-obelisk-controls'});
    };
    const lightBrazier=async (actor,record,stage)=>{
      const sources=hit.debugTorchSources?.()||[];
      if(!sources.length)fail('V50 braziers need a real lit-torch source',record,stage);
      const target=point(actor);
      const ordered=sources.map(object=>({object,p:point(object)}))
        .filter(row=>row.p&&Math.abs(row.p.y-target.y)<2)
        .sort((a,b)=>Math.hypot(a.p.x-target.x,a.p.z-target.z)-Math.hypot(b.p.x-target.x,b.p.z-target.z));
      if(!ordered.length)fail('no same-story lit-torch source for V50 brazier',record,stage,{target});
      if(hit.isCarryingTorch())hit.dropTorch();
      await put({...ordered[0].p,y:floorY(record)},record,stage);
      if(!hit.debugPickupTorch())fail('actual torch pickup callback failed',record,stage,{source:ordered[0].p});
      await put({...target,y:floorY(record)},record,stage);
      if(!hit.debugIgniteTarget(actor))fail('authored brazier rejected actual fire-transfer callback',record,stage,{target});
      hit.dropTorch();
      steps.push({floor:record.floor,stage:stage.id,event:'torch-pickup-and-contact-callback'});
      await sleep(230);
    };
    const solveNative=async(state,record,stage,depth=0)=>{
      if(!state||depth>6)fail('native puzzle dependency cycle',record,stage,state?.id||null);
      if(state.solved)return;
      const actor=state.linked.find(object=>object.userData?.activatorType!=='torch')||state.linked[0];
      if(!actor){
        const control=puzzleControl('v50NativeMechanism',state.object);
        await put({...point(state.object),y:floorY(record)},record,stage);
        await trigger(control,record,stage);
      }else if(actor.userData.activatorType==='glyphObelisk'){
        await hitCircuit(state.id,null,record,stage);
      }else if(actor.userData.activatorType==='linkedCubePillars'){
        await turnCubes(actor,record,stage);
      }else if(actor.userData.activatorType==='stackedObelisk'){
        await turnObelisk(actor,record,stage);
      }else if(actor.userData.activatorType==='brazier'||actor.userData.activatorType==='torch'){
        await lightBrazier(actor,record,stage);
      }else if(actor.userData.activatorType==='pressurePlate'){
        const block=actor.userData.linkedWeightBlock;
        if(!block)fail('native pressure plate has no authentic pushable burden',record,stage,{state:state.id});
        const path=block.userData?.pushPath||[];
        if(path.length<2)fail('push block lacks authored V50 route',record,stage,{state:state.id});
        if(block.userData.previewMotion?.type==='elevatorPushBlock'){
          const lift=[...record.nativeMechanisms.states.values()].find(candidate=>candidate.motion==='movingDais');
          if(!lift)fail('nested elevator puzzle has no moving dais',record,stage);
          await solveNative(lift,record,stage,depth+1);
        }
        if(block.userData.dropOntoPlateAfterRetraction){
          const bridge=[...record.nativeMechanisms.states.values()].find(candidate=>candidate.motion==='bridgeSequence');
          if(!bridge)fail('bridge-drop puzzle is missing the real V50 bridge',record,stage);
          await hitCircuit(bridge.id,'ON',record,stage);
        }
        for(let index=0;index<path.length-1;index++){
          if(block.userData.dropOntoPlateAfterRetraction&&index===path.length-2)break; // Only the real OFF command may drop the last route step.
          const source=path[index],dest=path[index+1];
          const before=new THREE.Vector3(source.x,source.y,source.z),after=new THREE.Vector3(dest.x,dest.y,dest.z);
          block.parent.localToWorld(before);block.parent.localToWorld(after); // Use the REAL transferred V50 root scale and placement, not local half-unit puzzle coordinates.
          const dx=after.x-before.x,dz=after.z-before.z,length=Math.hypot(dx,dz);
          if(length<.1)fail('authored push route has a zero-length step',record,stage,{index,source,dest});
          const center=point(block);
          await put({x:center.x-dx/length*1.05,z:center.z-dz/length*1.05,y:floorY(record)},record,stage);
          const control=puzzleControl('v50NativePushBlock',block),old={x:block.position.x,y:block.position.y,z:block.position.z};
          await trigger(control,record,stage);
          const moved=Math.hypot(block.position.x-old.x,block.position.z-old.z);
          if(moved<.02&&block.userData.previewMotion?.type!=='elevatorPushBlock')
            fail('real block push did not advance',record,stage,{index,old,next:dest,player:game.getPlayerGroundSupportY?.()});
        }
        if(block.userData.dropOntoPlateAfterRetraction){
          const bridge=[...record.nativeMechanisms.states.values()].find(candidate=>candidate.motion==='bridgeSequence');
          await hitCircuit(bridge.id,'OFF',record,stage);
          await sleep(550);
        }
        steps.push({floor:record.floor,stage:stage.id,event:'native-pressure-plate-pushes',count:path.length-1});
      }else fail('unsupported authored V50 activator family',record,stage,{state:state.id,type:actor.userData.activatorType});
      await sleep(500);
      if(!state.solved)fail('authored V50 mechanism did not signal completion',record,stage,{mechanismId:state.id,progress:state.progress,target:state.target});
    };
    const solveFallback=async(stage,record)=>{
      await put({x:stage.x,z:stage.z,y:stage.floorY},record,stage);
      if(stage.kind==='pressurePlate'){
        await sleep(1100); // The actual player's feet must hold the room's authored plate for 0.8 real seconds.
        steps.push({floor:record.floor,stage:stage.id,event:'real-player-pressure-hold'});
      }else if(stage.kind==='glyphObelisk'||stage.kind==='ceilingRailTargets'){
        await sleep(180);
        if(!stage.linked)fail('canonical projectile bus never registered fallback targets',record,stage);
        for(const target of stage.targets){
          if(!target.hittable?.())fail('registered glyph is not hittable in its active room',record,stage,target.id);
          target.onHit(); // The same guarded target callback invoked by a successful swept ranged projectile.
        }
        steps.push({floor:record.floor,stage:stage.id,event:'registered-projectile-hit-callback',count:stage.targets.length});
      }else if(stage.kind==='dungeonFire'){
        await sleep(220);
        if(!stage.fireLinked||!stage.fireRecord?.isActive?.())fail('native fire-ice challenge did not register a real reactive target',record,stage);
        stage.fireRecord.onBurn(); // Tests production fire target completion; weapon fire-stream collision is verified by separate DungeonFire suites.
        steps.push({floor:record.floor,stage:stage.id,event:'registered-fire-contact-callback'});
      }else if(stage.kind==='melodyEcho'){
        const music=window.MusicMinigame;
        if(!Array.isArray(stage.notes)||stage.notes.length<3)fail('authored Scratchbone echo has no sequence',record,stage);
        window.dispatchEvent(new CustomEvent('hobunji-ruin-melody-result',{detail:{id:stage.id,solved:true}})); // Explicitly a completed-phrase event injection, NOT proof of actual flute input.
        steps.push({floor:record.floor,stage:stage.id,event:'simulated-completed-melody-event',notes:stage.notes.slice()});
        music?.close?.();
      }else if(stage.kind==='ropeChain'){
        if(!stage.ropeLinked)fail('V50 rope physics never registered',record,stage);
        await put(stage.ropeSpec.exit,record,stage);
        steps.push({floor:record.floor,stage:stage.id,event:'rope-exit-checkpoint',warning:'not a physics crossing'});
        await sleep(230);
      }else fail('unknown fallback puzzle type',record,stage,stage.kind);
    };
    for(const record of owner.records){
      const walk=layout(record);
      const entry=record.route.tiles[0],floorStart={x:entry?.[0]+.5,z:entry?.[1]+.5};
      const first=record.analysis.stages[0],startRoom=window.RuinV50NativeFloors.nativeRoom(first,record.place);
      const firstPoint={x:startRoom.x+startRoom.w/2,z:startRoom.z+startRoom.d/2};
      const toFirst=route(walk,floorStart,firstPoint,closedCells(record));
      if(!toFirst)fail('shaft passage cannot reach V50 first challenge',record,record.challenges[0],{floorStart,firstPoint});
      steps.push({floor:record.floor,event:'shaft-to-native-entrance-route',tiles:toFirst.length});
      for(let index=0;index<record.challenges.length;index++){
        const stage=record.challenges[index],nextRoom=index+1<record.analysis.stages.length
          ?record.analysis.stages[index+1]:record.analysis.goalRoom;
        const world=window.RuinV50NativeFloors.nativeRoom(nextRoom,record.place);
        const dest={x:world.x+world.w/2,z:world.z+world.d/2};
        const here={x:stage.x,z:stage.z};
        if(record.solved!==index)fail('stage skipped before its own puzzle was completed',record,stage,{expected:index});
        if(stage.gate?.object.visible!==true)fail('native gate begins unblocked',record,stage);
        if(route(walk,here,dest,closedCells(record)))fail('sealed gate has a physically traversable bypass',record,stage,{here,dest});
        if(stage.kind==='v50Authored'){
          const state=record.nativeMechanisms.states.get(stage.nativeMechanism?.id);
          if(!state)fail('missing native mechanism for authored stage',record,stage,stage.nativeMechanism);
          await put({x:stage.x,z:stage.z,y:stage.floorY},record,stage);
          await solveNative(state,record,stage);
        }else await solveFallback(stage,record);
        await sleep(350);
        if(record.solved!==index+1||stage.gate?.object.visible!==false)
          fail('correct native puzzle input did not open exactly one stage gate',record,stage,{expected:index+1,actual:record.solved,gateVisible:stage.gate?.object.visible});
        for(const [x,z] of stage.gate.tiles){
          const grid=stage.gate.grid,col=grid.xToCol(x+.5),row=grid.zToRow(z+.5);
          const level=grid.yToLevel(stage.gate.surfaceY+.05);
          if(grid.get(col,row,level)!==0)fail('open gate still contains solid collision voxels',record,stage,{x,z,level});
        }
        const passage=route(walk,here,dest,closedCells(record));
        if(!passage)fail('solved gate does not provide a supported map route to next room',record,stage,{here,dest});
        steps.push({floor:record.floor,stage:stage.id,event:'gate-open-route',tiles:passage.length});
      }
      const goal=window.RuinV50NativeFloors.nativeRoom(record.analysis.goalRoom,record.place);
      const brazier=controls().find(control=>control.kind==='v50NativeBrazier'&&control.object===record.goalBrazier.pedestal);
      if(!brazier)fail('the actual native goal brazier is missing its in-game interaction control',record,record.challenges.at(-1));
      await put({x:goal.x+goal.w/2,z:goal.z+goal.d/2,
        y:Number(brazier.floorY)},record,record.challenges.at(-1)); // The goal chamber can lie on a different authored plateau than the previous stage.
      await trigger(brazier,record,record.challenges.at(-1));
      if(!record.lit)fail('genuine native brazier refused completed chamber progression',record,record.challenges.at(-1));
      steps.push({floor:record.floor,event:'native-brazier-lit',stages:record.challenges.length});
    }
    const final=owner.getState();
    if(final.lit!==final.totalBraziers||final.stagesSolved!==final.stagesTotal)
      throw new Error('V50 autoplay did not complete all native stories: '+JSON.stringify({final,steps}));
    return {floors:final.floors,rooms:final.rooms,stages:final.stagesSolved,
      braziers:final.lit,steps,
      limitations:['checkpoint positioning uses the developer world-point helper after proving planar routes; no controller-steered traversal','registered ranged/fire hit callbacks do not independently verify weapon aim or projectile collision','completed melody-result event does not verify live flute input','shaft climbing and rope flight have separate dedicated tests']};
  });
};
