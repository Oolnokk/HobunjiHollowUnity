// RuinLayerDefense — an actual authored Key Statue / burden-plinth defence
// encounter in one stacked dungeon chamber. All behavior is delegated to
// RuinComposer, FurniturePuzzleRuntime, KeyStatues and RuinEncounters.
// The parent wing still owns navigation and the gate this encounter unlocks.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinLayerDefense=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';

  const PRESS_SECONDS=30; // The plinth press and all scheduled enemy waves use the same 30-second objective clock.
  const PIECE_COLORS=Object.freeze({plinth:0x76685a,statueDispenser:0x9a8370,spawnerPillar:0x71685e});

  function seedFor(value){
    let result=2166136261; // Stable chamber ID to composed-encounter seed: rerolling the same dungeon is deterministic.
    for(const c of String(value))result=Math.imul(result^c.charCodeAt(0),16777619)>>>0;
    return result;
  }

  function create(options={}){
    const {THREE,parent,room,y,id,isActive,getPlayerY,onSolved}=options;
    const G=options.globals||root;
    const composer=options.RuinComposer||G.RuinComposer;
    const furniture=options.AuthoredFurniture||G.AuthoredFurniture;
    const puzzles=options.FurniturePuzzleRuntime||G.FurniturePuzzleRuntime;
    const statues=options.KeyStatues||G.KeyStatues;
    const encounters=options.RuinEncounters||G.RuinEncounters;
    const mapId=String(options.mapId||'map_i_dev_random_ruin');
    if(!THREE?.Group||!parent?.add||!room||!id||typeof onSolved!=='function'
      ||typeof isActive!=='function'||!composer?.compose||!composer?.rooms?.hall)
      throw new Error('Statue-defence chamber requires a valid room and authored RuinComposer.');
    if(room.w<18||room.d<18)throw new Error('Statue defence requires a room at least 18 by 18.');
    const origin={x:room.x+1,z:room.z+1}; // Leave a one-cell border for both actual wing doorway thresholds.
    const inner=composer.rooms.hall({width:room.w-2,depth:room.d-2,ceilingY:3.5});
    const composition=composer.compose(inner,{
      archetype:'vaultHall',seed:seedFor(id),pressSeconds:PRESS_SECONDS,
    });
    if(!composition.ok||!composition.encounter)
      throw new Error('Unsolvable authored Key Statue chamber '+id+': '+composition.reason);
    const plinth=composition.records.find(record=>record.piece==='plinth');
    const dispenser=composition.records.find(record=>record.piece==='statueDispenser');
    if(!plinth?.id||!dispenser?.id)
      throw new Error('Statue defence has no plinth and replenishable dispenser: '+id);
    const prefix='layer-defence-'+id+'-';
    const plinthId=prefix+plinth.id; // Exact FurniturePuzzleRuntime goal queried during this room's stage completion.
    const group=new THREE.Group();group.name='ruin-layer-defence-'+id;
    parent.add(group);
    const placedIds=[],placements=[],controlHandles=[]; // Owned authored scene pieces and per-instance puzzle registrations.
    let encounter=null,loading=null,clock=0,retryAt=0,failures=0; // Async asset state, retried safely after a recoverable loading failure.
    const record={
      id,kind:'statueDefense',solved:false,ready:false,loading:false,disposed:false,
      error:null,attempts:0,plinthId,dispenserId:prefix+dispenser.id,
      composedPieces:composition.records.filter(entry=>entry.key).length,
      enemySchedule:composition.encounter.schedule.length,
      composition,
    };
    const keys=[...new Set(composition.records.map(entry=>entry.key).filter(Boolean))]; // Every required authored asset is preloaded before any live puzzle node is created.

    function releaseInstances(){
      if(encounter){encounters?.remove?.(encounter.id);encounter=null;}
      for(const identifier of placedIds.splice(0))puzzles?.unregisterNode?.(mapId,identifier);
      const geometries=new Set(),materials=new Set(); // Authored meshes are detached before their parent network disposes, so they need explicit per-instance cleanup.
      for(const node of placements.splice(0)){
        node.traverse?.(child=>{
          if(child.geometry&&!child.geometry.userData?.devRuinSharedPrimitive)geometries.add(child.geometry);
          for(const material of Array.isArray(child.material)?child.material:[child.material])
            if(material)materials.add(material);
        });
        node.parent?.remove?.(node);
      }
      for(const geometry of geometries)geometry.dispose?.();
      for(const material of materials)material.dispose?.(); // Texture maps remain owned by the shared authored-asset cache.
      for(const control of controlHandles.splice(0))options.removeControl?.(control);
    }
    function onPressFor(piece,instanceId,node){
      const point={x:node.position.x,z:node.position.z}; // Standard interaction coordinates for the shared controller/touch resolver.
      const isPlinth=piece==='plinth';
      const control={
        kind:isPlinth?'layerDefencePlinth':'layerDefenceDispenser',
        point,object:node,promptRoot:node,range:1.8,floorY:y,priority:95,
        label:()=>{
          const buttons=isPlinth?puzzles?.burdenPlateButtons?.(mapId,instanceId)
            :puzzles?.keyStatueButtons?.(mapId,instanceId);
          return buttons?.[0]?.label||(isPlinth?'Place Key Statue':'Take Key Statue');
        },
        onPress:()=>{
          if(record.disposed||!record.ready||!isActive()
            ||Math.abs(Number(getPlayerY?.())-y)>.9)return {ok:false};
          const buttons=isPlinth?puzzles?.burdenPlateButtons?.(mapId,instanceId)
            :puzzles?.keyStatueButtons?.(mapId,instanceId);
          const choice=buttons?.[0];
          if(choice?.allowed===false)return {ok:false};
          const response=isPlinth
            ?puzzles?.interactBurdenPlate?.(mapId,instanceId,choice?.action)
            :puzzles?.interactKeyStatue?.(mapId,instanceId,choice?.action);
          if(response?.message)options.showToast?.(response.message,!!response.ok);
          return response;
        },
      };
      options.addControl?.(control);controlHandles.push(control);
    }
    async function mount(){
      if(record.disposed||record.ready||record.loading)return;
      record.loading=true;record.attempts++;
      try{
        if(!furniture?.load||!furniture?.buildGroup||!puzzles?.registerNode
          ||!statues?.registerDispenser||!encounters?.create)
          throw new Error('Key Statue, authored furniture or combat encounter runtime is unavailable.');
        const data=new Map(); // The encounter is atomic: a missing sprite/asset cannot leave a partly functioning statue puzzle behind.
        await Promise.all(keys.map(async key=>{
          const asset=await furniture.load(key);
          if(!asset?.parts?.length)throw new Error('Missing authored statue-defence asset: '+key);
          data.set(key,asset);
        }));
        if(record.disposed)return;
        for(const entry of composition.records){
          if(!entry.key)continue; // Solver-only strike/clearance markers never become dummy physical objects.
          const node=furniture.buildGroup(data.get(entry.key),PIECE_COLORS[entry.piece]||0x80766a);
          if(!node)throw new Error('Could not build authored puzzle fixture: '+entry.key);
          const uid=prefix+entry.id;
          node.name=uid;
          node.position.set(origin.x+entry.x,y+(Number(entry.y)||0),origin.z+entry.z);
          node.rotation.y=entry.rotY;
          group.add(node);placements.push(node);
          if(['plinth','statueDispenser'].includes(entry.piece)
            &&!node.userData?.furniturePuzzle)
            throw new Error('Authored '+entry.piece+' lacks required puzzle behaviour: '+entry.key);
          if(node.userData?.furniturePuzzle){
            const inherited=node.userData.furniturePuzzle;
            const override=entry.piece==='plinth'?{
              channel:'Layer-Statue-'+id,completionChannel:'Layer-Statue-Done-'+id,
              motion:{...(inherited.motion||{}),durationSeconds:PRESS_SECONDS},
            }:undefined;
            if(!puzzles.registerNode(mapId,{id:uid,key:entry.key,puzzle:override},node))
              throw new Error('Could not register authored '+entry.piece+' instance '+uid);
            placedIds.push(uid);
          }
          if(entry.piece==='statueDispenser'){
            if(!node.isObject3D)throw new Error('Key Statue dispenser must be a live Three.js scene object: '+uid);
            if(!statues.registerDispenser(mapId,uid,node,node.userData.furniturePuzzle,{
              feedPlinthId:plinthId,
            }))throw new Error('Cannot replenish the Key Statue on retry: '+uid);
          }
          if(['plinth','statueDispenser'].includes(entry.piece))
            onPressFor(entry.piece,uid,node);
        }
        if(record.disposed)return;
        const source=composition.encounter;
        encounter=encounters.create({
          ...source,id:prefix+'combat',mapId,
          objective:{...source.objective,plinthId},
          spawners:(source.spawners||[]).map(s=>({...s,x:origin.x+s.x,z:origin.z+s.z})),
          surfaceY:()=>y, // Enemy feet remain on the generated story's floor rather than on the global ground layer.
        });
        if(!encounter)throw new Error('Cannot arm the real statue-defence enemy waves.');
        record.ready=true;record.error=null;
        options.onLink?.(record);
      }catch(error){
        releaseInstances();
        record.error=String(error?.message||error);
        failures++;retryAt=clock+Math.min(30,5*failures); // Visible mobile diagnostic and bounded retry instead of silently softlocking the gate.
        options.onError?.(record,error);
      }finally{
        record.loading=false;
      }
    }
    record.tick=dt=>{
      if(record.disposed||record.solved)return;
      clock+=Math.min(.1,Math.max(0,Number(dt)||0));
      if(isActive()&&!record.ready&&!record.loading&&clock>=retryAt)
        loading=mount(); // The existing runtime tick owns initialization; later frames inspect its status.
      if(record.ready&&puzzles?.getNode?.(mapId,plinthId)?.userData?.burdenPlateComplete===true){
        record.solved=true;
        onSolved(record); // The parent wing opens its real local 3D gate only after the actual plinth finishes.
      }
    };
    record.dispose=()=>{
      if(record.disposed)return;
      record.disposed=true;
      releaseInstances();
      group.parent?.remove(group);
    };
    return record;
  }
  return Object.freeze({PRESS_SECONDS,seedFor,create});
});
