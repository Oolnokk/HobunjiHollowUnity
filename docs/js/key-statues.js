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
  function lostStatue(state,burden,reason='lost') {
    if(!state||state.disposed||state.payload!==burden)return false;
    state.payload=null;
    state.root.userData.keyStatuePayload=null;
    if(state.respawning)return true;
    state.respawning=true;
    queueRespawn(state,reason);
    return true;
  }
  function queueRespawn(state,reason) {
    Promise.resolve().then(async()=>{
      if(state.disposed||!state.root?.parent)return;
      const anchor=getOrCreateAnchor(state);
      if(!anchor)return;
      const data=await window.AuthoredFurniture?.load?.('keyStatue');
      if(!data||state.disposed||!state.root?.parent)return;
      const scene=state.root.getObjectByProperty?.('isScene',true)||currentScene();
      const group=window.AuthoredFurniture?.buildGroup?.(data);
      if(!group)return;
      anchor.add(group);
      group.position.set(0,0,0);group.quaternion.identity();group.scale.setScalar(1);
      group.updateWorldMatrix?.(true,true);
      const burden=window.Shattercasks.registerBurden({
        id:'key_statue_'+state.id+'_'+(++spawnSerial),mapId:state.mapId,scene,group,data,
        kind:'keyStatue',displayName:'Key Statue',hanging:false,
        onImpact:impact,onPickup:record=>{record.keyStatueMounted=false;window.FurniturePuzzleRuntime?.setKeyStatueTaken?.(state.mapId,state.id,true);},
        onLost:(record,cause)=>lostStatue(state,record,cause),
      });
      if(!burden){group.parent?.remove(group);state.respawning=false;return;}
      burden.keyStatueMounted=true; // Mounted statues are not consumed by floor hazards beneath their support.
      state.payload=burden;
      state.root.userData.keyStatuePayload=burden;
      state.respawning=false;
      if(reason!=='initial') window.FurniturePuzzleRuntime?.setKeyStatueTaken?.(state.mapId,state.id,false); // Spawn low on the sunken button, then ride its ON→OFF return animation.
      else window.FurniturePuzzleRuntime?.setKeyStatueTaken?.(state.mapId,state.id,false);
    }).catch(error=>{
      state.respawning=false;
      console.warn('[KeyStatues] failed to restore dispenser payload',error);
    });
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
  function registerDispenser(mapId,id,root,puzzle={}) {
    if(!root?.isObject3D)return false;
    const key=String(id||root.userData?.puzzleInstanceId||root.id);
    const existing=dispensers.get(key);
    if(existing?.root===root){
      existing.puzzle=puzzle;
      getOrCreateAnchor(existing);
      return true;
    }
    const state={id:key,mapId:String(mapId||currentArea()),root,puzzle,anchor:null,payload:null,respawning:false,disposed:false};
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
        id:state.id,mapId:state.mapId,taken:!!state.root.userData.keyStatueTaken,
        payload:state.payload?.id||null,payloadParent:state.payload?.group?.parent?.name||null,
        progress:Number(state.root.userData.puzzleProgress)||0,respawning:state.respawning,
      }))};
  }
  window.KeyStatues=Object.freeze({installed:true,registerDispenser,unregisterDispenser,take,tick,debugSnapshot});
})();
