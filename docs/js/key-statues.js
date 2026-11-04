// Key Statues — mounted physical Burdens whose dispenser returns after the statue is lost.
(() => {
  'use strict';
  if (window.KeyStatues?.installed || !window.Shattercasks || !window.THREE) return;
  const THREE=window.THREE;
  const dispensers=new Map(); // Map/id -> one live dispenser and its live mounted statue.
  let spawnSerial=0,elapsed=0;
  const currentArea=()=>String(window.GridTileAccessors?.getCurrentArea?.()||window.Combat?.deps?.getCurrentArea?.()||'');
  const currentScene=()=>window.GridTileAccessors?.getActiveScene?.()||window.Combat?.deps?.getActiveScene?.()||null;
  const currentGrid=()=>window.GridTileAccessors?.getActiveGrid?.()||null;
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number(n)||0));
  function linkedPlinth(state) {
    return state.feedPlinthId ? window.FurniturePuzzleRuntime?.getNode?.(state.mapId,state.feedPlinthId)||null : null;
  }
  function isSeated(state) {
    const node=linkedPlinth(state),payload=state.payload; // Prevents recall while the timed defense is legitimately in progress.
    return !!node&&!!payload&&node.userData?.burdenPlatePayload===payload&&!payload.exploded&&payload.group?.parent===node.userData?.burdenPlateAnchor;
  }
  function status(mapId,id) {
    const state=dispensers.get(String(id));
    if(!state||state.disposed||state.mapId!==String(mapId))return 'missing';
    const payload=state.payload;
    if(payload&&!payload.exploded){
      if(isSeated(state))return 'seated';
      if(payload.carried)return 'carried';
      if(payload.keyStatueMounted&&payload.group?.parent===state.anchor)return 'ready';
      if(payload.group?.parent)return 'recallable'; // A dropped, thrown or misplaced statue is never a permanent softlock.
    }
    return 'restoring';
  }
  function recall(mapId,id) {
    const state=dispensers.get(String(id)),current=status(mapId,id);
    if(!state||current==='missing')return {ok:false,message:'That dispenser is no longer available.'};
    if(current==='ready')return {ok:false,message:'The Key Statue is already on its dispenser.'};
    if(current==='carried')return {ok:false,message:'You are already carrying the Key Statue.'};
    if(current==='seated')return {ok:false,message:'The Key Statue is seated in its plinth. Retrieve it there.'};
    if(current==='restoring'){
      if(!state.respawning)queueRespawn(state,'manual-retry');
      return {ok:true,message:'The dispenser is restoring its Key Statue.'};
    }
    if(!window.Shattercasks?.discardBurden?.(state.payload))
      return {ok:false,message:'The old Key Statue could not be recalled.'};
    // discardBurden invokes onLost, which releases the old payload and queues exactly one replacement.
    return {ok:true,message:'The lost Key Statue is returning to the dispenser.'};
  }
  function tileHazard(mapId,x,z) {
    if(String(mapId)!==currentArea()||!currentGrid())return '';
    const tile=currentGrid()?.[Math.floor(z)]?.[Math.floor(x)];
    if(!tile)return 'void';
    const type=String(tile.type||'').toLowerCase();
    if(type==='lava'||Number(tile.lava)>0)return 'lava';
    if(['water','river','stream','lake','pond'].includes(type)||Number(tile.water)>0)return 'water';
    if(['void','boundary','bottomless','pit'].includes(type)||tile.bottomless===true)return 'void';
    return '';
  }
  function getOrCreateAnchor(state) {
    if(state.anchor?.parent)return state.anchor;
    const partId=String(state.puzzle.payloadPartId||'key_statue_button');
    const button=state.root.userData?.meshById?.get?.(partId);
    if(!button)return null;
    const anchor=new THREE.Group();
    anchor.name='key_statue_payload_attachment';
    anchor.position.set(0,.5,0); // BoxGeometry's local top face; it inherits the button's OFF/ON translation.
    button.add(anchor);
    const anchors=state.root.userData.payloadAttachmentAnchors ||= new Map();
    anchors.set('key-statue:'+state.id,anchor); // FurniturePuzzleRuntime keeps this rigid as the button animates.
    state.anchor=anchor;
    return anchor;
  }
  function sceneFor(root) {
    let cursor=root;
    while(cursor) {
      if(cursor.isScene)return cursor;
      cursor=cursor.parent;
    }
    return currentScene(); // Active-scene fallback is only for detached authoring/test roots.
  }
  function lostStatue(state,burden,reason='lost') {
    if(!state||state.disposed||state.payload!==burden)return false;
    const node=linkedPlinth(state);
    if(node?.userData?.burdenPlatePayload===burden)window.FurniturePuzzleRuntime?.cancelBurdenPlate?.(state.mapId,state.feedPlinthId); // A destroyed statue reverses its plinth, even after a prior completed press.
    state.payload=null;
    state.root.userData.keyStatuePayload=null;
    if(state.respawning)return true;
    queueRespawn(state,reason); // queueRespawn is the sole owner of the retry lock.
    return true;
  }
  function queueRespawn(state,reason) {
    if(!state||state.disposed||state.respawning)return false;
    if(state.payload&&!state.payload.exploded&&state.payload.group?.parent)return false;
    state.respawning=true;
    Promise.resolve().then(async()=>{
      let group=null;
      try {
        if(state.disposed||!state.root?.parent)return;
        const anchor=getOrCreateAnchor(state);
        if(!anchor)return; // Retry on a later tick if the authored button mesh has not finished building.
        const data=await window.AuthoredFurniture?.load?.('keyStatue');
        if(!data||state.disposed||!state.root?.parent)return; // A failed/late asset load must not wedge this dispenser in respawning=true.
        const scene=sceneFor(state.root);
        if(!scene)return;
        group=window.AuthoredFurniture?.buildGroup?.(data);
        if(!group)return;
        if(state.disposed||!state.root?.parent){group.parent?.remove(group);return;}
        anchor.add(group);
        group.position.set(0,0,0);group.quaternion.identity();group.scale.setScalar(1);
        group.updateWorldMatrix?.(true,true);
        const burden=window.Shattercasks.registerBurden({
          id:'key_statue_'+state.id+'_'+(++spawnSerial),mapId:state.mapId,scene,group,data,
          kind:'keyStatue',displayName:'Key Statue',hanging:false,
          onImpact:impact,onPickup:record=>{record.keyStatueMounted=false;window.FurniturePuzzleRuntime?.setKeyStatueTaken?.(state.mapId,state.id,true);},
          onLost:(record,cause)=>lostStatue(state,record,cause),
        });
        if(!burden){group.parent?.remove(group);group=null;return;}
        burden.keyStatueMounted=true; // Mounted statues are not consumed by floor hazards beneath their support.
        state.payload=burden;
        state.root.userData.keyStatuePayload=burden;
        window.FurniturePuzzleRuntime?.setKeyStatueTaken?.(state.mapId,state.id,false); // Replacement rises from the sunken button; initial spawns remain at OFF.
      } catch(error) {
        console.warn('[KeyStatues] failed to restore dispenser payload',error);
      } finally {
        state.respawning=false; // Missing assets, meshes and scene transitions remain retryable from tick().
      }
    });
    return true;
  }
  function impact(burden,cause='impact') {
    if(!burden||burden.exploded)return false;
    const position=burden.group?.getWorldPosition?.(new THREE.Vector3())||burden.group?.position;
    if(position&&tileHazard(burden.mapId,position.x,position.z)){
      window.Shattercasks?.discardBurden?.(burden);
      return true;
    }
    return false; // A Key Statue survives ordinary floor/weapon contact; only a lost object is replaced.
  }
  function registerDispenser(mapId,id,root,puzzle={},options={}) {
    if(!root?.isObject3D)return false;
    const key=String(id||root.userData?.puzzleInstanceId||root.id);
    const existing=dispensers.get(key);
    if(existing?.root===root){
      existing.puzzle=puzzle;
      existing.feedPlinthId=String(options.feedPlinthId||existing.feedPlinthId||'');
      getOrCreateAnchor(existing);
      return true;
    }
    const state={id:key,mapId:String(mapId||currentArea()),root,puzzle,feedPlinthId:String(options.feedPlinthId||''),anchor:null,payload:null,respawning:false,disposed:false}; // Each dispenser owns exactly one physical statue, even after recovery.
    dispensers.set(key,state);
    root.userData.keyStatueDispenserId=key;
    getOrCreateAnchor(state);
    queueRespawn(state,'initial');
    return true;
  }
  function unregisterDispenser(mapId,id) {
    const state=dispensers.get(String(id));
    if(!state||state.mapId!==String(mapId))return false;
    state.disposed=true;
    if(state.payload&&!state.payload.exploded)window.Shattercasks?.discardBurden?.(state.payload);
    state.anchor?.parent?.remove(state.anchor);
    dispensers.delete(state.id);
    return true;
  }
  function take(mapId,id) {
    const state=dispensers.get(String(id));
    const payload=state?.payload;
    if(!state||!payload||payload.exploded||!payload.group?.parent)return false;
    return window.Shattercasks?.pickUp?.(payload)||false;
  }
  function tick(dt=0) {
    elapsed+=Math.max(0,Math.min(.1,Number(dt)||0));
    if(elapsed<.15)return;
    elapsed=0;
    for(const state of dispensers.values()) {
      if(state.disposed||!state.root?.parent)continue;
      if(state.payload&&(state.payload.exploded||!state.payload.group?.parent)) {
        const lost=state.payload;
        if(!lost.exploded)window.Shattercasks?.discardBurden?.(lost); // Drop orphaned map records as well as restoring the visible dispenser.
        if(state.payload===lost)lostStatue(state,lost,'detached');
      }
      if(state.payload&&!state.payload.exploded&&!state.payload.carried&&!state.payload.flying&&!state.payload.keyStatueMounted) {
        const world=state.payload.group?.getWorldPosition?.(new THREE.Vector3());
        if(world&&tileHazard(state.mapId,world.x,world.z))window.Shattercasks?.discardBurden?.(state.payload);
      }
      if(!state.payload&&!state.respawning)queueRespawn(state,'missing');
    }
  }
  function debugSnapshot() {
    return {latestChange:'Key Statue is mounted from spawn; pickup animates the plinth down; loss respawns the statue low and animates the plinth back up.',
      dispensers:[...dispensers.values()].map(state=>({
        id:state.id,mapId:state.mapId,taken:!!state.root.userData.keyStatueTaken,feedPlinthId:state.feedPlinthId||null,status:status(state.mapId,state.id),
        payload:state.payload?.id||null,payloadParent:state.payload?.group?.parent?.name||null,
        progress:Number(state.root.userData.puzzleProgress)||0,respawning:state.respawning,
      }))};
  }
  window.KeyStatues=Object.freeze({installed:true,registerDispenser,unregisterDispenser,take,status,recall,tick,debugSnapshot});
})();
