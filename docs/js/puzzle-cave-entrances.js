// Independently spawned mini-cliff Puzzle Cave entrances, using the same plateau route,
// authored furniture, music bridge, world transitions and dynamic collision
// contracts as the rest of Hobunji Hollow.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PuzzleCaveEntrances=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const areas=new Map(); // Area -> mounted portal records; used for scene cleanup and per-frame transition admission.
  const glyphTextures=new Map(); // Shared immutable Scratchbone textures reused by every exterior music score; portal teardown disposes materials, not their shared maps.
  let deps=null; // WildlifeSpawn's existing game adapter, used for authoritative player, layouts and scene transitions.
  let lastArea=null; // Tracks the immediately previous area so returning from a cave can restore its actual elevated balcony support.
  const portalTag='puzzle-cave-cliff-door'; // Consistent debugging and collider identity for each generated entrance.
  const DOOR_WALL_CLEARANCE=.22; // The normal-size authored door sits slightly in front of mini-cliff rock, never buried in its surface.
  const hash=value=>{let h=2166136261>>>0;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;};
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  const distance=(a,b)=>Math.hypot(Number(a?.x)-Number(b?.x),Number(a?.z)-Number(b?.z));
  const safeArea=area=>String(area||'');
  const sceneGroupName=area=>portalTag+'-'+area;

  function init(injectedDeps={}){deps=injectedDeps;} // Reuses the game-injected player and tile size instead of a second set of globals.
  function eligibleShelf(shelf){
    return !!shelf?.base?.footprint?.length && Array.isArray(shelf.footprint) && shelf.footprint.length>=2 &&
      Number.isFinite(shelf.y) && shelf.y>0 && Number(shelf.width)>=1.7 &&
      Number(shelf.depth)>=1 && shelf.tangent && shelf.normal;
  }
  function plan(network,sites=[]){
    const shelves=(network?.balconies||[]).filter(eligibleShelf); // Only genuine walkable elevated mini-cliffs; never synthetic ground-level doors.
    const taken=new Set(),out=[];
    const available=(sites||[]).filter(p=>p?.contents==='puzzle_cave').slice()
      .sort((a,b)=>String(a.mapId).localeCompare(String(b.mapId)));
    for(const site of available){
      const anchor=site.mouthAnchor||{x:0,y:0};
      const source={x:Number(anchor.x)+.5,z:Number(anchor.y)+.5};
      const candidates=shelves.filter(s=>!taken.has(s.id) && (!site.shelfId || site.shelfId===s.id)).sort((a,b)=>{
        const d=distance(source,a)-distance(source,b);
        return d || String(a.id).localeCompare(String(b.id));
      });
      for(const shelf of candidates){
        const normal=shelf.normal,tangent=shelf.tangent;
        const nearBack={x:shelf.x-normal.x*(shelf.depth*.5-.18),z:shelf.z-normal.z*(shelf.depth*.5-.18)};
        const supports=(x,z)=>root.CliffRouteNetwork?.shelfContains?.(shelf,x,z,-.13)!==false;
        const entryTiles=shelf.footprint
          .filter(t=>supports(t.c+.5,t.r+.5))
          .sort((a,b)=>distance(nearBack,{x:a.c+.5,z:a.r+.5})-distance(nearBack,{x:b.c+.5,z:b.r+.5}));
        if(!entryTiles.length)continue; // A transition tile must actually lie inside the walkable cap outline.
        const entry=entryTiles[0]; // The actual raised tile is authoritative for the world transition, never lower ground.
        const door={x:nearBack.x+normal.x*DOOR_WALL_CLEARANCE,z:nearBack.z+normal.z*DOOR_WALL_CLEARANCE,y:shelf.y}; // Offset toward the open balcony, preserving the same support and collider coordinates.
        const preferred={x:shelf.x+normal.x*Math.min(.68,shelf.depth*.36),
          z:shelf.z+normal.z*Math.min(.68,shelf.depth*.36)};
        const samples=[]; // Valid footfall points: intersection of supported footprint cells and the irregular mini-cliff cap.
        for(const tile of shelf.footprint)for(const dx of [0,-.28,.28])for(const dz of [0,-.28,.28]){
          const x=tile.c+.5+dx,z=tile.r+.5+dz;
          if(!supports(x,z)||Math.hypot(x-(entry.c+.5),z-(entry.r+.5))<=.65
            ||Math.hypot(x-door.x,z-door.z)<=.58)continue; // Music plate and entry are physically separate interactions.
          samples.push({x,z});
        }
        if(!samples.length)continue; // Try the next reachable balcony, not an unsupported plate that traps the cave.
        samples.sort((a,b)=>distance(a,preferred)-distance(b,preferred));
        const plate={...samples[0],y:shelf.y};
        taken.add(shelf.id);
        const melody=hash(site.signature+':outdoor-song')%2===0;
        out.push({mapId:site.mapId,denId:site.denId,site,shelf,door,plate,entry,
          tangent,normal,requiresSong:melody,difficulty:1+(hash(site.signature+':outdoor-difficulty')%5)});
        break;
      }
    }
    return out;
  }
  function stateFor(portal){
    return root.CaveSiteSystem?.exteriorPuzzleState?.(portal.mapId)||{solved:false,tier:1};
  }
  function transitionPool(area){
    const layout=deps?.zoneLayouts?.get?.(area),scene=deps?.zoneScenes?.get?.(area);
    return [...new Set([...(layout?.transitions||[]),...(scene?.transitions||[])])]; // Cached scene can own a DIFFERENT transition object from its layout.
  }
  function ensureIndependentTransitions(area,portal) {
    if(portal.site?.source !== 'independent_cliff')return; // Ordinary cave anchors are never involved in these player-only gates.
    const layout=deps?.zoneLayouts?.get?.(area),info=deps?.zoneScenes?.get?.(area);
    const pools=[layout?.transitions,info?.transitions].filter(Array.isArray); // Scene transitions can be copied later than the layout during construction.
    for(const pool of new Set(pools)){
      if(pool.some(t=>t?.targetMapId===portal.mapId))continue;
      const transition={id:'den_'+portal.denId+'_enter',label:'Small Stone Door',
        col:portal.entry.c,row:portal.entry.r,area,target:'puzzle_cave_locked',
        targetMapId:portal.mapId,targetSpotId:'den_exit',puzzleCaveOnly:true}; // Both cached and fresh entry use the generated cavern's named walkable entrance. // No animal-den footprint, faction/aggro marker, or hostile-interaction target.
      pool.push(transition);
      portal.ownedTransitions.push({pool,transition}); // Exact references removed on scene retirement.
    }
  }
  function applyTransitions(area,portal,enabled){
    for(const t of transitionPool(area)){
      if(t?.targetMapId!==portal.mapId && t?.id!=='den_'+portal.denId+'_enter')continue;
      if(!t.__puzzleCaveOriginal)t.__puzzleCaveOriginal={col:t.col,row:t.row,target:t.target}; // Original position restored when cliff geometry regenerates without a suitable balcony.
      t.col=portal.entry.c;t.row=portal.entry.r;
      t.target=enabled?'building':'puzzle_cave_locked'; // The existing checkTransitionSpots only accepts recognized target types.
      t.puzzleCaveCliffY=portal.shelf.y;
      t.puzzleCaveCliffId=portal.shelf.id;
    }
  }
  function restoreTransitions(area,portal){
    for(const t of transitionPool(area)){
      if(t?.targetMapId!==portal.mapId && t?.id!=='den_'+portal.denId+'_enter')continue;
      const o=t.__puzzleCaveOriginal;
      if(o){t.col=o.col;t.row=o.row;t.target=o.target;delete t.__puzzleCaveOriginal;}
      delete t.puzzleCaveCliffY;delete t.puzzleCaveCliffId;
    }
  }
  function concealDenFacade(portal){
    const scene=deps?.zoneScenes?.get?.(portal.area)?.scene||areas.get(portal.area)?.scene;
    const group=scene?.getObjectByName?.('animalDenEntrances');
    let hidden=false;
    for(const mesh of group?.children||[])if(String(mesh.userData?.denId)===String(portal.denId)){
      if(!portal.hiddenDenMeshes.has(mesh))portal.hiddenDenMeshes.set(mesh,mesh.visible); // Preserve each authored facade's original visibility for scene retirement.
      mesh.visible=false;hidden=true; // Never leave the legacy cave facade overlapping the cliff-mounted entrance.
    }
    portal.facadeHidden=hidden;
    return hidden;
  }
  function syncTransitionRing(portal,allowed){
    const scene=deps?.zoneScenes?.get?.(portal.area)?.scene;
    if(!scene)return;
    if(!portal.ring){
      portal.ring=(scene.children||[]).find(mesh=>mesh.userData?.mapEditorRef?.kind==='spot' &&
        mesh.userData.mapEditorRef.id==='den_'+portal.denId+'_enter')||null;
    }
    if(!portal.ring)return;
    if(!portal.ringRelocated){
      portal.originalRingPosition={x:portal.ring.position.x,y:portal.ring.position.y,z:portal.ring.position.z}; // Preserve the actual cached scene marker for zone rebuilds.
      portal.ring.position.set(portal.entry.c+.5,portal.shelf.y+.02,portal.entry.r+.5);
      portal.ringRelocated=true; // The old ground-level den's marker follows the elevated route exactly once.
    }
    portal.ring.visible=allowed; // A locked gate cannot display a misleading golden "enter" ring.
  }
  function hasPortal(area,denId){
    return !!areas.get(safeArea(area))?.portals?.some(r=>String(r.denId)===String(denId));
  }
  function isGateLocked(portal){return portal.requiresSong&&!portal.solved;}
  function frameToShelf(model,portal){
    model.position.set(portal.door.x,portal.door.y,portal.door.z);
    model.rotation.y=Math.atan2(portal.normal.x,portal.normal.z);
    model.scale.setScalar(1); // Authored cliffDoor already matches woodenDoor's 1x1 tile dimensions; wilderness tiles must not be scaled a second time.
    model.userData.puzzleCaveCliffDoor=true;
  }
  function makeGlyphs(portal,rootGroup){
    const THREE=root.THREE;
    if(!portal.song||!THREE?.TextureLoader)return;
    const columns=Math.min(6,portal.song.notes.length);
    const count=portal.song.notes.length;
    const board=new THREE.Group();
    board.name='puzzle-cave-exterior-score';
    board.position.set(portal.door.x,portal.door.y+1.35,portal.door.z);
    board.rotation.y=Math.atan2(portal.normal.x,portal.normal.z);
    board.translateZ?.(.055);
    for(let index=0;index<count;index++){
      const note=portal.song.notes[index],glyphNumber=note.index+1;
      let texture=glyphTextures.get(glyphNumber); // One loader per Scratchbone note instead of one GPU texture per generated cave.
      if(!texture){
        texture=new THREE.TextureLoader().load('assets/hud/scratchbone'+glyphNumber+'.png');
        if(THREE.SRGBColorSpace)texture.colorSpace=THREE.SRGBColorSpace;
        glyphTextures.set(glyphNumber,texture);
      }
      const material=new THREE.MeshBasicMaterial({map:texture,color:0xc6baab,transparent:true,depthWrite:false,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(.20,.24),material);
      mesh.name='puzzle-cave-outdoor-glyph-'+index;
      mesh.position.set((index%columns-(columns-1)/2)*.23,.21-Math.floor(index/columns)*.27,0);
      board.add(mesh);portal.glyphs.push(mesh);
    }
    rootGroup.add(board);portal.scoreBoard=board;
  }
  function createPresentation(portal,scene){
    const THREE=root.THREE;
    if(!THREE?.Group||!scene?.add)return;
    const group=new THREE.Group();
    group.name=portalTag+'-'+portal.denId;
    scene.add(group);portal.visualRoot=group;
    // The plate belongs on the registered cap, not at terrain height underneath.
    if(portal.requiresSong){
      const plate=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.09,24),
        new THREE.MeshBasicMaterial({color:0x6f6152}));
      plate.name='puzzle-cave-exterior-plate';
      plate.position.set(portal.plate.x,portal.plate.y+.035,portal.plate.z);
      group.add(plate);portal.plateMesh=plate;
    }
    const furniture=root.AuthoredFurniture;
    Promise.resolve(furniture?.load?.('cliffDoor')).then(data=>{
      if(!data||portal.disposed||portal.visualRoot!==group||!furniture?.buildGroup)return;
      const model=furniture.buildGroup({...data,puzzle:null}); // Locked doors cannot be toggled by ordinary furniture interactions.
      frameToShelf(model,portal);
      group.add(model);portal.doorModel=model;
      portal.slab=model.userData?.meshById?.get?.('cliff_door_slab')||null;
      portal.slabMotion=data.puzzle?.motion?.parts?.cliff_door_slab||null;
      makeGlyphs(portal,group);
      moveSlab(portal);
    }).catch(e=>root.__farmLog?.('[puzzle-cave] cliff door failed: '+e.message,'warn'));
  }
  function moveSlab(portal){
    if(portal.slab&&portal.slabMotion){
      const t=clamp(portal.rise,0,1),ease=t*t*(3-2*t);
      const off=portal.slabMotion.off,on=portal.slabMotion.on;
      portal.slab.position.y=off.y+(on.y-off.y)*ease;
      portal.slab.scale.z=off.sz+(on.sz-off.sz)*ease;
    }
    if(portal.scoreBoard){portal.scoreBoard.position.y=portal.door.y+1.35+portal.rise*1.2;portal.scoreBoard.visible=portal.rise<.95;}
  }
  function attachMusic(portal){
    if(!portal.requiresSong||!root.PuzzleCaveMelody?.generate||!root.PuzzleCaveMelody?.createSession)return;
    const song=root.PuzzleCaveMelody.generate(portal.site.signature+':outdoor',{difficulty:portal.difficulty});
    portal.song=song;
    portal.session=root.PuzzleCaveMelody.createSession(song,{
      onSolved:()=>{
        portal.solved=true;portal.justSolved=true;portal.openWait=.95;
        root.CaveSiteSystem?.markExteriorPuzzleSolved?.(portal.mapId,song.rewardTier);
        if(portal.plateMesh?.material?.color)portal.plateMesh.material.color.setHex(0xa6bf73);
      },
      onChanged:snap=>{
        portal.progress=snap;
        for(let i=0;i<portal.glyphs.length;i++)
          portal.glyphs[i].material?.color?.setHex?.(i===snap.activeIndex?0xffd76b:0xc6baab);
      }
    });
    portal.noteHandler=e=>{
      if(portal.disposed||portal.solved||deps?.getCurrentArea?.()!==portal.area
        ||e?.detail?.area!==portal.area)return;
      portal.session.note(e.detail.noteIndex);
    };
    root.addEventListener?.('hobunji-kurraya-puzzle-note',portal.noteHandler);
  }
  function addPhysicalGate(portal){
    const DS=root.DynamicSurfaces;
    if(!DS?.registerBlocker)return;
    const x=portal.door.x,z=portal.door.z,t=portal.tangent;
    const half=.34; // Half of the authored wooden/cliff door's ~0.62-tile slab, plus a small movement margin; no ledge-wide invisible wall.
    const x1=x-t.x*half,x2=x+t.x*half,z1=z-t.z*half,z2=z+t.z*half;
    portal.blockerId=portalTag+':'+portal.area+':'+portal.denId;
    DS.registerBlocker({
      id:portal.blockerId,scope:portalTag+':'+portal.area,
      bounds:{minX:Math.min(x1,x2)-.08,maxX:Math.max(x1,x2)+.08,
        minZ:Math.min(z1,z2)-.08,maxZ:Math.max(z1,z2)+.08},
      enabled:()=>!portal.disposed&&deps?.getCurrentArea?.()===portal.area&&portal.rise<.98, // The global movement blocker query is sometimes unscoped: never obstruct a different area.
      blocksAt:(_x,_z,_height,_record,_radius,opts)=>{
        const y=Number(opts?.worldY??opts?.floorY??opts?.y);
        return !Number.isFinite(y)||Math.abs(y-portal.door.y)<1.1; // Stacked elevations keep lower ground free when the movement query supplies Y.
      },
    });
  }
  function destroyPortal(portal){
    portal.disposed=true;
    if(portal.noteHandler)root.removeEventListener?.('hobunji-kurraya-puzzle-note',portal.noteHandler);
    if(portal.musicOpened)root.MusicMinigame?.close?.();
    if(portal.blockerId)root.DynamicSurfaces?.remove?.(portal.blockerId);
    portal.visualRoot?.parent?.remove?.(portal.visualRoot);
    portal.visualRoot?.traverse?.(child=>{
      if(!child.isMesh)return;
      child.geometry?.dispose?.();
      for(const mat of Array.isArray(child.material)?child.material:[child.material])mat?.dispose?.();
    });
  }
  function clear(area){
    const key=safeArea(area),state=areas.get(key);
    if(!state)return;
    for(const portal of state.portals){
      const den=deps?.zoneLayouts?.get?.(key)?.dens?.find(d=>String(d.id)===String(portal.denId));
      if(den&&portal.originalDenMouth)den.mouthAnchor={...portal.originalDenMouth}; // Do not leave a changed den exit after terrain relocation or scene eviction.
      restoreTransitions(key,portal);
      for(const owned of portal.ownedTransitions || []){
        const index=owned.pool.indexOf(owned.transition); // Release only our own transition, not another cave's copied spot.
        if(index>=0)owned.pool.splice(index,1);
      }
      if(portal.ring){
        if(portal.originalRingPosition)portal.ring.position.set(portal.originalRingPosition.x,portal.originalRingPosition.y,portal.originalRingPosition.z);
        portal.ring.visible=true;portal.ringRelocated=false;
      } // Restore both the visual marker and its location when cliff geometry is retired.
      for(const [mesh,visible] of portal.hiddenDenMeshes)mesh.visible=visible; // The legacy entrance becomes visible again if a future cliff reroll has no usable portal.
      portal.hiddenDenMeshes.clear();
      if(portal.shelf?.puzzleCavePortal===portal.mapId)delete portal.shelf.puzzleCavePortal; // A retired portal must not permanently reserve a reward-bearing ledge.
      destroyPortal(portal);
    }
    areas.delete(key);
  }
  function mount(area,network,scene,sites=null){
    const key=safeArea(area);
    if(!key||!network||!scene)return [];
    const old=areas.get(key);
    if(old?.network===network&&old.scene===scene)return old.portals;
    if(old)clear(key);
    const profiles=sites||root.CaveSiteSystem?.registerOutdoorPuzzleSites?.(key,network?.balconies||[])||root.CaveSiteSystem?.sitesForZone?.(key)||[]; // Independent roll, not the ordinary cave/animal-den pool.
    const portals=plan(network,profiles).map(p=>({
      ...p,area:key,disposed:false,solved:!p.requiresSong,justSolved:false,
      musicOpened:false,lastDown:false,openWait:0,
      rise:p.requiresSong?0:1,progress:null,glyphs:[],visualRoot:null,
      blockerId:null,ownedTransitions:[],hiddenDenMeshes:new Map(),facadeCheckElapsed:0, // Captured visibility and slow recheck for asynchronously added den entrance meshes.
    }));
    const state={area:key,network,scene,portals};
    areas.set(key,state);
    for(const portal of portals){
      ensureIndependentTransitions(key,portal); // Creates dedicated transitions in both layout and loaded scene without generating a den.
      if(portal.requiresSong){
        const saved=stateFor(portal);portal.solved=!!saved.solved;portal.rise=portal.solved?1:0;
        attachMusic(portal);
      }
      portal.shelf.puzzleCavePortal=portal.mapId; // Reserve this cap before the shared reward renderer instantiates its ore/chest.
      const den=deps?.zoneLayouts?.get?.(key)?.dens?.find(d=>String(d.id)===String(portal.denId));
      if(den){
        portal.originalDenMouth=den.mouthAnchor?{...den.mouthAnchor}:null; // The den's X/Z seed and persistent cave signature stay unchanged.
        den.mouthAnchor={x:portal.entry.c,y:portal.entry.r}; // The existing interior exit now points to the true cliff doorway rather than a vanished ground-level facade.
      }
      addPhysicalGate(portal);
      createPresentation(portal,scene);
      concealDenFacade(portal); // Existing den facade is hidden; late-arriving meshes are checked on the runtime clock.
      applyTransitions(key,portal,false); // Default closed until player reaches the actual elevated entry tile.
    }
    return portals;
  }
  function update(dt,activeArea=null){
    const area=safeArea(activeArea||deps?.getCurrentArea?.());
    const state=areas.get(area);
    const wasInside=state?.portals.find(p=>p.mapId===lastArea); // Only a return from THIS cave should place the player on its elevated shelf.
    lastArea=area;
    if(!state)return;
    const player=deps?.player,tile=Number(deps?.TILE)||64;
    if(wasInside&&player&&!player.climbing){
      player.x=(wasInside.entry.c+.5)*tile;player.y=(wasInside.entry.r+.5)*tile;
      player.onCliffBalcony=wasInside.shelf.id;
      player.climbSurfaceY=wasInside.shelf.y; // Same exact elevation owner as the existing cliff climbing movement system.
    }
    const px=Number(player?.x)/tile,pz=Number(player?.y)/tile;
    for(const portal of state.portals){
      if(portal.disposed)continue;
      ensureIndependentTransitions(area,portal); // Late scene copies still get their own player-only portal.
      const onShelf=player?.onCliffBalcony===portal.shelf.id && !player?.climbing;
      const down=onShelf&&Math.hypot(px-portal.plate.x,pz-portal.plate.z)<.55; // A separate activation circle leaves room to step up to the gate after the final note.
      if(portal.session){
        portal.session.step(dt,down);
        if(down&&!portal.lastDown&&!portal.solved){
          portal.musicOpened=!!root.MusicMinigame?.beginPlayerSession?.();
          if(!portal.musicOpened)deps?.showToast?.('Equip an instrument to play this stone song.',false);
        }
        if(!down&&portal.lastDown&&portal.musicOpened&&!portal.solved){
          root.MusicMinigame?.close?.();portal.musicOpened=false;
        }
        if(portal.justSolved&&portal.musicOpened&&portal.openWait<=0){
          root.MusicMinigame?.close?.();portal.musicOpened=false;portal.justSolved=false;
        }
        portal.lastDown=down;
      }
      if(portal.solved&&portal.rise<1){portal.rise=Math.min(1,portal.rise+Math.max(0,Number(dt)||0)/.95);moveSlab(portal);}
      portal.openWait=Math.max(0,portal.openWait-Math.max(0,Number(dt)||0));
      const nearDoor=onShelf&&Math.hypot(px-(portal.entry.c+.5),pz-(portal.entry.r+.5))<.73;
      const enabled=portal.solved&&portal.rise>=.98&&portal.openWait<=0&&nearDoor&&(!portal.requiresSong||!down);
      applyTransitions(area,portal,enabled); // World-transition owner sees a real locked target until the slab has physically risen.
      syncTransitionRing(portal,enabled);
      portal.facadeCheckElapsed+=Math.max(0,Number(dt)||0);
      if(portal.facadeCheckElapsed>=.75||!portal.facadeHidden){
        portal.facadeCheckElapsed=0;concealDenFacade(portal); // Catch late den-facade meshes without scanning every game frame.
      }
    }
  }
  function forgetCave(mapId){
    for(const [area,state] of areas){
      if(!state.portals.some(p=>p.mapId===mapId))continue;
      clear(area); // Relocation requires rebuilding from a new network/anchor, never keeping a stale portal.
    }
  }
  function senseTargets(scene){
    if(!scene)return [];
    const roots=[]; // Mounted authored cliffDoor models, excluding plates, glyphs, and disposed portals.
    for(const state of areas.values()){
      if(state.scene!==scene)continue;
      for(const portal of state.portals)if(!portal.disposed && portal.doorModel?.parent===portal.visualRoot && portal.visualRoot?.parent===scene)
        roots.push(portal.doorModel);
    }
    return roots;
  }
  function debugSnapshot(){
    return {areas:[...areas.values()].map(state=>({area:state.area,count:state.portals.length,
      portals:state.portals.map(p=>({mapId:p.mapId,shelfId:p.shelf.id,door:p.door,
        plate:p.plate,entry:p.entry,locked:isGateLocked(p),solved:p.solved,
        progress:p.progress,rewardTier:p.song?.rewardTier||null,modelReady:!!p.doorModel}))}))};
  }
  return Object.freeze({init,plan,mount,update,clear,forgetCave,hasPortal,senseTargets,debugSnapshot});
});
