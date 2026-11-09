// RuinCheckpointTravel — one shaft waystone and mutually replacing white checkpoint braziers.
// Wing completion remains owned by RuinLayerPlayable / RuinV50NativeFloors.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinCheckpointTravel=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  let liveOwner=null; // Lighting compositor reads only the currently mounted ruin's white checkpoint sources.
  const HOLD_MS=550; // Action 1 releases after this duration count as holds, not taps.
  const WHITE_BRIGHT='#ffffff',WHITE_LOW='#d9edff'; // The canonical authored campfire emitter requires six-digit hex strings, not numeric colors.
  function point(x,z,y){return {x:Number(x),z:Number(z),y:Number(y)};}
  function closeEnough(a,b,radius=1.65,yTolerance=.95){
    return !!a&&!!b&&Math.abs(a.y-b.y)<=yTolerance
      &&Math.hypot(a.x-b.x,a.z-b.z)<=radius;
  }
  function snapshotValid(data,seed){
    return data?.version===1&&Number(data.seed)===Number(seed)&&typeof data==='object';
  }
  function mount(options={}){
    const {rec,ruin,plan,hub,getPlayerPosition,getPlayerY,showToast,onProgressChange}=options;
    const THREE=options.THREE||root.THREE;
    if(!rec?.scene||!ruin?.controls||!plan?.floors||!hub?.grid||!THREE?.Group)
      throw new Error('Ruin checkpoint travel requires a mounted playable shaft.');
    const group=new THREE.Group(); // Owns small white-flame furniture without adding its meshes to physical collision.
    group.name='ruin-checkpoint-braziers';rec.scene.add(group);
    const stone=root.ProceduralFurniture?.makePartMaterial?.({
      materialTexture:'carved_smooth.png',materialLighting:'unlit',materialFillMode:'never',color:'#6a6965'
    })||new THREE.MeshBasicMaterial({color:0x6a6965}); // Preserve the ruin's carved-stone material.
    const bowl=new THREE.CylinderGeometry(.4,.34,.24,9); // Shared small checkpoint/shaft bowl.
    const foot=new THREE.CylinderGeometry(.25,.36,.59,8); // Shared narrow pedestal, non-colliding.
    const records=new Map(),controls=[],flames=[],lights=[]; // All interaction, lighting and particle ownership is local to this ruin.
    let disposed=false,activeId=null,shaftLit=false; // Current checkpoint and shaft ignition persist in the world save.
    let lastBlink=0; // Checkpoint particle presentation reuses the shaft's existing frame callback.
    const now=()=>typeof performance!=='undefined'?performance.now():Date.now();
    const player=()=>{
      const p=getPlayerPosition?.(),y=Number(getPlayerY?.());
      return p&&Number.isFinite(y)?point(p.x,p.z,y):null;
    };
    function fixture(id,kind,at,scale){
      if(![at.x,at.z,at.y].every(Number.isFinite))return null;
      const holder=new THREE.Group(); // Local parent moves every constituent of this freestanding prop together.
      holder.name='ruin-'+kind+'-'+id.replace(/[^a-z0-9_-]/gi,'-');
      holder.position.set(at.x,at.y,at.z);holder.userData.devRuinFootprintIgnore=true;group.add(holder);
      const base=new THREE.Mesh(foot,stone);base.scale.setScalar(scale);base.position.y=.31*scale;holder.add(base);
      const dish=new THREE.Mesh(bowl,stone);dish.scale.setScalar(scale);dish.position.y=.73*scale;holder.add(dish);
      const anchor=new THREE.Group(); // Use the canonical campfire emitter with white rather than lich-colored particles.
      anchor.position.y=.9*scale;anchor.visible=false;holder.add(anchor);
      const emitter=root.PersistentGroundFire?.attachCampfireFlame?.(anchor,{
        scale:scale*.7,rateScale:.46,colorA:WHITE_BRIGHT,colorB:WHITE_LOW,
      });
      if(emitter)flames.push(emitter);
      const light={x:at.x,y:at.y+1,z:at.z,floorY:at.y,floorTolerance:1.2,
        radius:kind==='shaft'?8:5,strength:kind==='shaft'?.98:.9,
        color:[240,248,255],active:false}; // Kanthic darkness compositing consumes cached scalar light records.
      lights.push(light);
      const record={id,kind,at,holder,anchor,light,lit:false};
      records.set(id,record);
      return record;
    }
    function render(record,lit){
      if(!record||record.lit===lit)return;
      record.lit=lit;record.anchor.visible=lit;record.light.active=lit;
      root.CloudForestFog?.refreshLightingOverlay?.();
    }
    function remember(){
      if(!disposed)onProgressChange?.(); // Explicit state transitions only: never serialize during the render tick.
    }
    function becomeCheckpoint(id){
      const next=records.get(id);
      if(!next||next.kind!=='small'||disposed)return false;
      if(activeId===id)return false; // Proximity can last many frames, but save writes must not.
      if(activeId&&activeId!=='shaft')render(records.get(activeId),false);
      activeId=id;render(next,true);
      root.RuinInteractionAudio?.igniteTorch?.();
      showToast?.('Checkpoint attuned.',true);
      remember();
      return true;
    }
    const shaftCell=root.RuinMultifloorV50Style?.chooseHubBrazierCell?.(hub,0);
    if(!shaftCell)throw new Error('Shared shaft has no safe floor-zero brazier support.');
    const g=hub.grid,shaftAt=point(g.colToX(shaftCell[0]+.5),g.rowToZ(shaftCell[1]+.5),g.levelToY(0));
    const shaft=fixture('shaft','shaft',shaftAt,1.35);
    function floorCanStand(x,z,y){
      for(const entry of ruin.shaftGrids?.values?.()||[]){
        if(entry.contains&&!entry.contains(x,z))continue;
        const grid=entry.grid,level=grid.yToLevel(y+.04);
        if(grid.inBounds(grid.xToCol(x),grid.zToRow(z),level)
          &&grid.canStand(grid.xToCol(x),grid.zToRow(z),level))return true;
      }
      return false;
    }
    function roomCheckpoint(room,y,id,heightAt=null){
      if(!room)return null;
      const positions=[
        [room.x+1.5,room.z+1.5],[room.x+room.w-1.5,room.z+1.5],
        [room.x+1.5,room.z+room.d-1.5],[room.x+room.w-1.5,room.z+room.d-1.5],
      ]; // Prefer clear room corners, away from central puzzle activators and hallway thresholds.
      const at=positions.map(([x,z])=>point(x,z,typeof heightAt==='function'?heightAt(x,z):y))
        .find(candidate=>Number.isFinite(candidate.y)&&floorCanStand(candidate.x,candidate.z,candidate.y));
      return at?fixture(id,'small',at,.72):null; // Native V50 plateaus need their actual surface height, not the nominal story datum.
    }
    for(const floor of plan.floors)for(const wing of floor.wings||[])
      roomCheckpoint(wing.rooms?.[0],floor.y,'wing:'+wing.id); // One automatic return point at the beginning of each composed wing.
    for(const record of ruin.nativeV50Runtime?.records||[]){
      const first=record.analysis?.stages?.[0];
      const loc=first&&root.RuinV50NativeFloors?.nativeRoom?.(first,record.place);
      if(loc)roomCheckpoint(loc,record.floorY??(plan.floors[record.floor]?.y||0),'native:'+record.floor,record.supportYAt);
    }
    function igniteShaft(){
      if(shaftLit)return;
      shaftLit=true;render(shaft,true); // Once lit, the shaft never extinguishes for this ruin.
      if(!activeId)activeId='shaft'; // A discovered wing checkpoint always wins over the shaft's fallback.
      root.RuinInteractionAudio?.igniteTorch?.();
      showToast?.('Shaft brazier awakened.',true);
      remember();
    }
    function teleport(destination,message){
      const at=destination?.at||destination;
      if(!at||disposed||!player())return false;
      const ok=root.DevRandomRuin?.setPlayerWorldPoint?.(at,{grounded:true,snapCamera:true});
      if(ok){showToast?.(message,true);return true;}
      showToast?.('The waystone cannot reach that landing.',false);
      return false;
    }
    function toEntrance(){
      return teleport(point(ruin.spawn?.x,ruin.spawn?.z,0),'Returned to the ruin entrance.');
    }
    function toShaft(fromWing=false){
      return shaftLit||!fromWing
        ?teleport(shaftAt,'Returned to the shaft brazier.')
        :toEntrance(); // Before first shaft ignition, wing Action 2 has a usable entrance fallback.
    }
    function fromShaftTap(){
      const dest=activeId&&activeId!=='shaft'?records.get(activeId):null;
      if(!dest){showToast?.('No other checkpoint has been discovered.',false);return false;}
      return teleport(dest,'Returned to the last checkpoint.');
    }
    function holdAction(record,onTap,onHold){
      let pressedAt=null; // This particular brazier owns one press/release pair for remapped touch/controller bindings.
      const control={kind:record.kind==='shaft'?'ruinShaftTravel':'ruinCheckpointTravel',
        object:record.holder,promptRoot:record.holder,floorY:record.at.y,
        inputAction:'action1',range:1.8,priority:35,touchIcon:'✦',
        label:()=>record.kind==='shaft'?'Tap: checkpoint · Hold: entrance':'Hold: return to shaft',
        onHoldStart:()=>{pressedAt=now();},
        onHoldEnd:(detail)=>{
          if(pressedAt===null)return;
          const held=now()-pressedAt;pressedAt=null;
          if(detail?.canceled||!closeEnough(player(),record.at,2.1))return; // Canceled inputs or stale held prompts cannot teleport the player from elsewhere.
          if(held>=HOLD_MS)onHold();else onTap?.();
        },
      };
      ruin.controls.push(control);controls.push(control);
    }
    holdAction(shaft,fromShaftTap,toEntrance);
    for(const record of records.values())if(record.kind==='small')
      holdAction(record,null,()=>toShaft(false));
    // Already-lit wing braziers keep their original Action 1 ignition control.
    // Action 2 exists only after successful manual ignition; never bypass the wing's puzzles.
    for(const origin of [...ruin.controls]){
      if(origin.kind!=='layerBrazier'&&origin.kind!=='v50NativeBrazier')continue;
      const control={kind:'ruinWingReturn',object:origin.object,promptRoot:origin.promptRoot||origin.object,
        floorY:origin.floorY,range:origin.range||1.7,inputAction:'action2',
        priority:40,touchIcon:'↥',available:()=>origin.lit?.()===true,
        label:'Return to shaft / entrance',onPress:()=>{if(origin.lit?.())toShaft(true);}};
      ruin.controls.push(control);controls.push(control);
    }
    function restore(saved){
      if(!snapshotValid(saved,ruin.seed))return false;
      shaftLit=saved.shaftLit===true;render(shaft,shaftLit);
      activeId=null;
      const wanted=typeof saved.activeCheckpoint==='string'?saved.activeCheckpoint:null;
      if(wanted==='shaft'&&shaftLit)activeId='shaft';
      else if(records.get(wanted)?.kind==='small'){
        activeId=wanted;render(records.get(wanted),true);
      }else if(shaftLit)activeId='shaft';
      return true;
    }
    function tick(dt=0){
      if(disposed)return;
      const p=player();if(!p)return;
      for(const record of records.values()){
        const visible=record.at.y<=p.y+.8; // Match wing meshes: never render an upper-floor checkpoint through the floor below.
        if(record.holder.visible!==visible)record.holder.visible=visible;
      }
      if(!shaftLit&&closeEnough(p,shaft.at,2.1))igniteShaft();
      for(const record of records.values())if(record.kind==='small'
        &&closeEnough(p,record.at,1.55)){becomeCheckpoint(record.id);break;}
      const t=now(); // One shared particle-update cadence; the caller need not supply a frame delta.
      if(t-lastBlink>80){const step=Math.min(.05,Math.max(0,Number(dt)||((t-lastBlink)/1000)));lastBlink=t;for(const f of flames)f.update?.(step);} 
    }
    function serializeProgress(){
      return {shaftLit,activeCheckpoint:activeId}; // Stable IDs, never Three.js objects or source pointers.
    }
    function dispose(){
      if(disposed)return;disposed=true;
      if(liveOwner===owner)liveOwner=null;
      for(const c of controls){const index=ruin.controls.indexOf(c);if(index>=0)ruin.controls.splice(index,1);}
      for(const f of flames)f.dispose?.();
      bowl.dispose();foot.dispose();stone.dispose?.();
      group.parent?.remove(group);
    }
    const owner={tick,dispose,restore,serializeProgress,lightSources:()=>lights,
      getState:()=>({shaftLit,activeCheckpoint:activeId,checkpoints:[...records.values()].map(r=>({id:r.id,lit:r.lit,x:r.at.x,z:r.at.z,y:r.at.y}))})};
    liveOwner=owner;
    return owner;
  }
  return Object.freeze({mount,closeEnough,snapshotValid,HOLD_MS,lightSources:()=>liveOwner?.lightSources?.()||[]});
});
