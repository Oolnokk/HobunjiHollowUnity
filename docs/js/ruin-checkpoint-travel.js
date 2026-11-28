// RuinCheckpointTravel — persistent per-floor shaft waystones and mutually replacing wing checkpoints.
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
    const records=new Map(),controls=[],flames=[],lights=[],shaftBraziers=[]; // Session-owned destinations, input controls, particles, and light records.
    const unlockedShaftIds=new Set(); // Saved floor identities; only personally discovered shaft braziers may receive teleports.
    let disposed=false,activeId=null,shaftLit=false; // Existing floor-zero ignition and checkpoint save fields remain compatible.
    let activeTravelWheel=null,travelPointerCleanup=null; // One held shaft control and pointer-drag listener may own the existing selection arch.
    let lastBlink=0; // Checkpoint particle presentation reuses the shaft's existing frame callback.
    const now=()=>typeof performance!=='undefined'?performance.now():Date.now();
    const player=()=>{
      const p=getPlayerPosition?.(),y=Number(getPlayerY?.());
      return p&&Number.isFinite(y)?point(p.x,p.z,y):null;
    };
    function fixture(id,kind,at,scale,platformParent=null){
      if(![at.x,at.z,at.y].every(Number.isFinite))return null;
      const holder=new THREE.Group(); // Local parent moves every constituent of this freestanding prop together.
      holder.name='ruin-'+kind+'-'+id.replace(/[^a-z0-9_-]/gi,'-');
      if(platformParent)platformParent.add(holder); // Shaft platforms are already at world X/Y/Z; keep the prop local to its platform.
      else {holder.position.set(at.x,at.y,at.z);group.add(holder);}
      holder.userData.devRuinFootprintIgnore=true;
      const base=new THREE.Mesh(foot,stone);base.scale.setScalar(scale);base.position.y=.31*scale;holder.add(base);
      const dish=new THREE.Mesh(bowl,stone);dish.scale.setScalar(scale);dish.position.y=.73*scale;holder.add(dish);
      const anchor=new THREE.Group(); // Use the canonical campfire emitter with white rather than lich-colored particles.
      anchor.position.y=.9*scale;anchor.visible=false;holder.add(anchor);
      const emberColors=kind==='source'?{colorA:'#ffb25a',colorB:'#ff5f1d'}:{colorA:WHITE_BRIGHT,colorB:WHITE_LOW}; // Tothal ignition is visually distinct from white checkpoint flames.
      const emitter=root.PersistentGroundFire?.attachCampfireFlame?.(anchor,{
        scale:scale*.7,rateScale:.46,...emberColors,
      });
      if(emitter)flames.push(emitter);
      const light={x:at.x,y:at.y+1,z:at.z,floorY:at.y,floorTolerance:1.2,flameAnchor:anchor,
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
      record.holder.userData.fireHazard = lit; // Lit shaft/wing/checkpoint braziers can light the held adventuring torch.
      root.CloudForestFog?.refreshLightingOverlay?.();
    }
    function remember(){
      if(!disposed)onProgressChange?.(); // Explicit state transitions only: never serialize during the render tick.
    }
    function becomeCheckpoint(id){
      const next=records.get(id);
      if(!next||next.kind!=='small'||disposed)return false;
      if(activeId===id)return false; // Proximity can last many frames, but save writes must not.
      if(activeId&&records.get(activeId)?.kind==='small')render(records.get(activeId),false);
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
    shaft.story=0;shaftBraziers.push(shaft);
    for(const floor of plan.floors){
      const story=Number(floor.floor);
      if(!Number.isInteger(story)||story<=0)continue;
      const cell=root.RuinMultifloorV50Style?.chooseHubBrazierCell?.(hub,story);
      if(!cell)throw new Error('Shaft floor '+(story+1)+' has no safe recovery brazier support.');
      const level=story*Number(hub.options?.spacing||plan.options?.floorHeight||16);
      const at=point(g.colToX(cell[0]+.5),g.rowToZ(cell[1]+.5),g.levelToY(level));
      const record=fixture('shaft:'+story,'shaft',at,1.35);
      if(!record)throw new Error('Shaft floor '+(story+1)+' recovery brazier placement is invalid.');
      record.story=story;shaftBraziers.push(record);
    }
    function floorCanStand(x,z,y){
      for(const entry of ruin.shaftGrids?.values?.()||[]){
        if(entry.contains&&!entry.contains(x,z))continue;
        const grid=entry.grid,level=grid.yToLevel(y+.04);
        if(grid.inBounds(grid.xToCol(x),grid.zToRow(z),level)
          &&grid.canStand(grid.xToCol(x),grid.zToRow(z),level))return true;
      }
      return false;
    }
    function roomCheckpoint(room,y,id,heightAt=null,entrySide=null){
      if(!room)return null;
      const nearX=entrySide==='W'?room.x+room.w-1.5:room.x+1.5;
      const farX=entrySide==='W'?room.x+1.5:room.x+room.w-1.5;
      const nearZ=entrySide==='N'?room.z+room.d-1.5:room.z+1.5;
      const farZ=entrySide==='N'?room.z+1.5:room.z+room.d-1.5;
      const positions=entrySide==='E'||entrySide==='W'
        ?[[nearX,room.z+1.5],[nearX,room.z+room.d-1.5],
          [farX,room.z+1.5],[farX,room.z+room.d-1.5]]
        :[[room.x+1.5,nearZ],[room.x+room.w-1.5,nearZ],
          [room.x+1.5,farZ],[room.x+room.w-1.5,farZ]];
      // Favor the entrance bank: a west/north rope room must not put its white checkpoint across the abyss.
      const at=positions.map(([x,z])=>point(x,z,typeof heightAt==='function'?heightAt(x,z):y))
        .find(candidate=>Number.isFinite(candidate.y)&&floorCanStand(candidate.x,candidate.z,candidate.y));
      return at?fixture(id,'small',at,.72):null; // Native V50 plateaus need their actual surface height, not the nominal story datum.
    }
    const ignitionSources=[]; // Permanent short Tothal fire hazards (torch-lighting sources), not projectile-arming or teleport controls.
    const tothal=ruin.hachutu!==true&&String(ruin.theme||'').toLowerCase()==='tothal'; // Hachutu's exclusive temple never receives unrelated Harlyao fire mechanisms.
    if(tothal){
      // Floor-zero's fallback is a separate short brazier, not a prompt that steals Action 2 from tools.
      const shaftHeatAt=[[shaftAt.x+1,shaftAt.z],[shaftAt.x-1,shaftAt.z],
        [shaftAt.x,shaftAt.z+1],[shaftAt.x,shaftAt.z-1]]
        .map(([x,z])=>point(x,z,shaftAt.y)).find(at=>floorCanStand(at.x,at.z,at.y)); // Find an actual standable neighboring tile.
      if(shaftHeatAt){
        const shaftHeat=fixture('shaft-fire','source',shaftHeatAt,.58); // Regular bowl at forehand-swing height.
        if(shaftHeat){render(shaftHeat,true);ignitionSources.push(shaftHeat);}
      }
      const jump=ruin.shaftObeliskRuntime,api=jump?.method==='ropeSwings'?root.RuinRopeShaft:root.RuinJumpShaft; // Both slab shafts carry a brazier on each story's first step.
      if((jump?.method==='jumpPlatforms'||jump?.method==='ropeSwings')&&jump.plan?.routes&&jump.columns&&api?.assignFixture){
        for(const route of jump.plan.routes){
          // First jump of each story is reachable directly from the gallery.
          // Keep its icy surface and reserve only the central prop footprint.
          const platform=jump.plan.platforms.find(p=>p.id===route.platformIds?.[0]);
          const column=platform&&jump.columns.get(platform.id);
          if(!column?.holder||!api.assignFixture(jump.plan,platform.id,'ignitionBrazier'))continue;
          const at=point(platform.x,platform.z,platform.y);
          const source=fixture('ignition:'+platform.id,'source',at,.58,column.holder); // Short, regular lit brazier on the existing jump platform.
          if(source){render(source,true);ignitionSources.push(source);} // render() marks the actual 3D holder as fireHazard.
        }
      }
    }
    for(const floor of plan.floors)for(const wing of floor.wings||[])
      roomCheckpoint(wing.rooms?.[0],floor.y,'wing:'+wing.id,null,wing.side); // One automatic return point at the beginning of each composed wing.
    for(const record of ruin.nativeV50Runtime?.records||[]){
      const first=record.analysis?.stages?.[0];
      const loc=first&&root.RuinV50NativeFloors?.nativeRoom?.(first,record.place);
      if(loc)roomCheckpoint(loc,record.floorY??(plan.floors[record.floor]?.y||0),'native:'+record.floor,record.supportYAt);
    }
    function igniteShaft(record){
      if(disposed||!record||unlockedShaftIds.has(record.id))return false;
      unlockedShaftIds.add(record.id);render(record,true); // Every discovered story remains a permanently lit recovery destination.
      if(record.story===0)shaftLit=true;
      if(!activeId||record.story>0){
        if(activeId&&records.get(activeId)?.kind==='small')render(records.get(activeId),false);
        activeId=record.id; // First discovery of a new upper floor becomes the new death-recovery checkpoint.
      }
      root.RuinInteractionAudio?.igniteTorch?.();
      showToast?.('Floor '+(record.story+1)+' shaft brazier awakened — travel unlocked.',true);
      remember();
      return true;
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
    function fromShaftTap(from){
      const dest=activeId&&activeId!==from?.id?records.get(activeId):null;
      if(!dest){showToast?.('No other checkpoint has been discovered.',false);return false;}
      return teleport(dest,'Returned to the last checkpoint.');
    }
    function travelToShaft(sourceId,destinationId){
      const source=records.get(sourceId),destination=records.get(destinationId);
      if(disposed||!source||!destination||source.kind!=='shaft'||destination.kind!=='shaft'
        ||source===destination||!unlockedShaftIds.has(sourceId)||!unlockedShaftIds.has(destinationId)
        ||!closeEnough(player(),source.at,2.1))return false; // Never trust a stale UI callback or an undiscovered floor.
      return teleport(destination,'Travelled to floor '+(destination.story+1)+' shaft brazier.');
    }
    function travelEntries(source){
      const entries=shaftBraziers.filter(record=>unlockedShaftIds.has(record.id)).map(record=>({
        id:record.id,icon:'✦',label:'Floor '+(record.story+1)+(record.id===source.id?' · Here':''),
        disabled:record.id===source.id,
        onSelect:()=>travelToShaft(source.id,record.id),
      })); // List exactly the discovered shaft fires; the active story is visibly non-selectable.
      entries.push({id:'entrance',icon:'↩',label:'Ruin Entrance',
        onSelect:()=>!disposed&&unlockedShaftIds.has(source.id)&&closeEnough(player(),source.at,2.1)&&toEntrance()});
      entries.push({id:'cancel',icon:'×',label:'Cancel',initial:true,onSelect:()=>{}});
      return entries;
    }
    function holdAction(record,onTap,onHold){
      let pressedAt=null,timer=null,wheelOpen=false; // Per-fixture input ownership protects against stale release after a reroll.
      function openTravelWheel(){
        timer=null;
        if(pressedAt===null||disposed||record.kind!=='shaft'||!unlockedShaftIds.has(record.id)
          ||!closeEnough(player(),record.at,2.1)||typeof root._desktopSelectionArc?.openEntries!=='function')return;
        if(activeTravelWheel&&activeTravelWheel!==record.id)return;
        root._desktopSelectionArc.openEntries('ruin-shaft-travel',travelEntries(record)); // Reuse keyboard/controller/touch held-selection arch, not a second radial menu.
        wheelOpen=true;activeTravelWheel=record.id;
        const doc=root.document; // Pointer events from mobile Action 1 remain captured by its original button after the arch opens.
        if(doc?.addEventListener){
          const move=event=>{
            if(activeTravelWheel===record.id&&event.isPrimary!==false
            &&root._desktopSelectionArc?.currentMode?.()==='entries:ruin-shaft-travel')
              root._desktopSelectionArc?.movePointer?.(event.clientX,event.clientY);
          };
          doc.addEventListener('pointermove',move,true);
          travelPointerCleanup=()=>doc.removeEventListener('pointermove',move,true); // Only while a shaft travel wheel is visible.
        }
      }
      const control={kind:record.kind==='shaft'?'ruinShaftTravel':'ruinCheckpointTravel',
        object:record.holder,promptRoot:record.holder,floorY:record.at.y,
        inputAction:'action1',range:1.8,priority:35,touchIcon:'✦',
        label:()=>record.kind==='shaft'?'Tap: checkpoint · Hold: shaft travel':'Hold: return to shaft',
        onHoldStart:()=>{
          pressedAt=now();
          if(timer!==null)clearTimeout(timer);
          wheelOpen=false;
          if(record.kind==='shaft'&&unlockedShaftIds.has(record.id)&&root._desktopSelectionArc?.openEntries)
            timer=setTimeout(openTravelWheel,root.InputHoldTiming?.thresholdMs?.(350) ?? 350); // Honor the player setting for this early-opening selection wheel.
        },
        onHoldEnd:(detail)=>{
          if(pressedAt===null)return;
          const held=now()-pressedAt;pressedAt=null;
          if(timer!==null){clearTimeout(timer);timer=null;}
          const valid=!disposed&&!detail?.canceled&&!detail?.cancelled&&closeEnough(player(),record.at,2.1);
          if(wheelOpen){
            wheelOpen=false;activeTravelWheel=null;
            travelPointerCleanup?.();travelPointerCleanup=null;
            if(root._desktopSelectionArc?.currentMode?.()!=='entries:ruin-shaft-travel')return;
            if(valid)root._desktopSelectionArc?.releaseSelection?.();
            else root._desktopSelectionArc?.close?.(); // Canceled input/movement cannot commit a destination.
            return;
          }
          if(!valid)return;
          if(held>=(root.InputHoldTiming?.thresholdMs?.(HOLD_MS) ?? HOLD_MS)){
            if(record.kind==='shaft'&&root._desktopSelectionArc?.openEntries)showToast?.('Hold and select a destination to travel.',false);
            else onHold?.(); // Standalone authoring previews without the game's wheel retain the old entrance hold.
          }else onTap?.();
        },
      };
      ruin.controls.push(control);controls.push(control);
    }
    for(const record of shaftBraziers)holdAction(record,()=>fromShaftTap(record),toEntrance);
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
    let deferredDoorCheckpoint=false; // Restored before the sanctum composer builds its door.
    function registerDoorCheckpoint(site,width){
      if(disposed||records.has('sanctum-door')||!site?.shaft)return false;
      const n=site.normal,t=site.tangent,y=Number(site.floorY);
      if(!n||!t||!Number.isFinite(y))return false;
      for(const sign of [1,-1]){
        const x=site.x+t.x*sign*(width/2+.8),z=site.z+t.z*sign*(width/2+.8);
        const at=point(x+n.x*1.35,z+n.z*1.35,y);
        if(!floorCanStand(at.x,at.z,y))continue;
        const record=fixture('sanctum-door','small',at,.65);
        if(!record)return false;
        record.doorGated=true;
        record.holder.position.set(x+n.x*.25,y+.45,z+n.z*.25); // Wall-side dish, with safe gallery respawn point separate from the mount.
        record.holder.children[0].visible=false; // No standing pedestal on the wall.
        const bracket=new THREE.Mesh(foot,stone);bracket.scale.set(.45,.35,.45);bracket.rotation.x=Math.PI/2;bracket.position.set(-n.x*.20,.10,-n.z*.20);bracket.rotation.z=n.x?Math.PI/2:0;record.holder.add(bracket); // Reuse the shared stone geometry for a wall support.
        record.light.x=record.holder.position.x;record.light.z=record.holder.position.z;
        if(deferredDoorCheckpoint){deferredDoorCheckpoint=false;if(activeId&&records.get(activeId)?.kind==='small')render(records.get(activeId),false);activeId=record.id;render(record,true);}
        return true;
      }
      return false;
    }
    function restore(saved){
      if(!snapshotValid(saved,ruin.seed))return false;
      unlockedShaftIds.clear(); // Reroll/save restore must never carry travel access to a different seed.
      for(const story of (Array.isArray(saved.unlockedShaftFloors)?saved.unlockedShaftFloors:[])){
        if(!Number.isInteger(story))continue;
        const record=shaftBraziers.find(entry=>entry.story===story);
        if(record){unlockedShaftIds.add(record.id);render(record,true);}
      }
      if(saved.shaftLit===true){unlockedShaftIds.add('shaft');render(shaft,true);} // Version-1 worlds predate multi-floor unlocks.
      shaftLit=unlockedShaftIds.has('shaft');
      if(records.get(activeId)?.kind==='small')render(records.get(activeId),false);
      activeId=null;
      const wanted=typeof saved.activeCheckpoint==='string'?saved.activeCheckpoint:null;
      deferredDoorCheckpoint=wanted==='sanctum-door'&&!records.has(wanted);
      if(records.get(wanted)?.kind==='shaft'&&unlockedShaftIds.has(wanted))activeId=wanted;
      else if(records.get(wanted)?.kind==='small'){
        activeId=wanted;render(records.get(wanted),true);
      }else if(shaftLit)activeId='shaft';
      else activeId=shaftBraziers.find(record=>unlockedShaftIds.has(record.id))?.id||null;
      return true;
    }
    function tick(dt=0){
      if(disposed)return;
      const p=player();if(!p)return;
      for(const record of records.values()){
        const visible=record.at.y<=p.y+.8; // Match wing meshes: never render an upper-floor checkpoint through the floor below.
        if(record.holder.visible!==visible)record.holder.visible=visible;
      }
      for(const record of shaftBraziers)
        if(!unlockedShaftIds.has(record.id)&&closeEnough(p,record.at,2.1))igniteShaft(record);
      if(activeTravelWheel&&root._desktopSelectionArc?.currentMode?.()!=='entries:ruin-shaft-travel'){
        activeTravelWheel=null;travelPointerCleanup?.();travelPointerCleanup=null; // Backdrop cancel or Dodge must not strand the held input owner.
      }
      for(const record of records.values())if(record.kind==='small'
        &&(!record.doorGated||root.DevRandomRuinSanctum?.isGreatDoorUnlocked?.())
        &&closeEnough(p,record.at,1.55)){becomeCheckpoint(record.id);break;}
      const t=now(); // One shared particle-update cadence; the caller need not supply a frame delta.
      if(t-lastBlink>80){const step=Math.min(.05,Math.max(0,Number(dt)||((t-lastBlink)/1000)));lastBlink=t;for(const f of flames)f.update?.(step);} 
    }
    function activeRespawnPoint(){
      const at=records.get(activeId)?.at;
      return !disposed&&at?point(at.x,at.z,at.y):null; // The white shaft/small brazier is authoritative for every ruin death.
    }
    function serializeProgress(){
      return {shaftLit,activeCheckpoint:activeId,
        unlockedShaftFloors:shaftBraziers.filter(record=>unlockedShaftIds.has(record.id)).map(record=>record.story)}; // Stable story identities, no scene objects.
    }
    function dispose(){
      if(disposed)return;disposed=true;
      if(activeTravelWheel){
        if(root._desktopSelectionArc?.currentMode?.()==='entries:ruin-shaft-travel')root._desktopSelectionArc.close();
        activeTravelWheel=null;
      }
      travelPointerCleanup?.();travelPointerCleanup=null;
      if(liveOwner===owner)liveOwner=null;
      for(const c of controls){const index=ruin.controls.indexOf(c);if(index>=0)ruin.controls.splice(index,1);}
      for(const f of flames)f.dispose?.();
      for(const source of ignitionSources)source.holder.parent?.remove(source.holder); // Platform props have parents outside the checkpoint group's render tree.
      bowl.dispose();foot.dispose();stone.dispose?.();
      group.parent?.remove(group);
    }
    const owner={tick,dispose,restore,serializeProgress,activeRespawnPoint,registerDoorCheckpoint,isActive:()=>!disposed&&root.DevRandomRuin?.getRuntimeContext?.()?.scene===rec.scene,lightSources:()=>lights,
      litSourceObjects:()=>disposed?[]:[...records.values()].filter(record=>record.lit).map(record=>record.holder), // Reuse the actual live furniture geometry instead of 2D tile lookups.
      getState:()=>({shaftLit,activeCheckpoint:activeId,
       shaftTravel:{wheelOpen:!!activeTravelWheel,unlocked:[...unlockedShaftIds],
         floors:shaftBraziers.map(r=>({id:r.id,floor:r.story+1,unlocked:unlockedShaftIds.has(r.id),x:r.at.x,z:r.at.z,y:r.at.y}))},
       ignitionSources:ignitionSources.map(r=>({id:r.id,x:r.at.x,z:r.at.z,y:r.at.y})),
       shaftIgnitionAvailable:false,shaftTorchFireAvailable:ignitionSources.length>0,checkpoints:[...records.values()].filter(r=>r.kind!=='source').map(r=>({id:r.id,lit:r.lit,x:r.at.x,z:r.at.z,y:r.at.y}))})};
    liveOwner=owner;
    return owner;
  }
  return Object.freeze({mount,closeEnough,snapshotValid,HOLD_MS,
    isActive:()=>liveOwner?.isActive?.()===true,activeRespawnPoint:()=>liveOwner?.isActive?.()?liveOwner.activeRespawnPoint():null,
    registerDoorCheckpoint:(site,width)=>liveOwner?.registerDoorCheckpoint(site,width)??false,
    lightSources:()=>liveOwner?.lightSources?.()||[],
    litSourceObjects:()=>liveOwner?.isActive?.()?liveOwner.litSourceObjects():[]});
});
