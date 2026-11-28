// RuinRoomSystem — seamless room ownership, enclosure blueprints and Zelda-style enemy suspension.
// The ruin stays one scene. Story height, not the shared 2D tile map, disambiguates overlapping rooms.
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RuinRoomSystem=api;
})(typeof self!=='undefined'?self:globalThis,function(root){
  'use strict';
  const SLEEP_AREA='__ruin_room_sleep__:'; // Used to let the existing updateHostiles area guard skip inactive-room actors.
  const DOOR_SPAN=3; // Every room entrance uses the generator's three-cell corridor aperture.
  const WALL_HEIGHT=3.6; // Supports the rope-chamber ceiling beams at +3.4 and covers upper projectile routes.
  const PROBE_PERIOD=.3; // Batches hostile ownership detection instead of scanning all hostiles every render frame.
  let live=null; // Shared by the lighting compositor and mobile diagnostics; cleared on dungeon disposal.

  const inside=(room,x,z)=>x>=room.x&&x<room.x+room.w&&z>=room.z&&z<room.z+room.d;
  const key=(x,z)=>x+','+z;
  function planRooms(plan,pitForRoom){
    const rooms=[],doors=[],errors=[],ids=new Set(); // Used to validate all generated room/door identities once per ruin build.
    for(const floor of plan?.floors||[])for(const wing of floor.wings||[]){
      const sources=wing.anteroom?[wing.anteroom,...wing.rooms]:wing.rooms; // Reuse the same manifest for the shaft room.
      for(let i=0;i<sources.length;i++){
        const source=sources[i],name=String(source.id||'');
        const entry=(floor.doorways||[]).find(port=>port.to===name);
        if(!name||ids.has(name)){errors.push('Duplicate or empty room id: '+name);continue;}
        ids.add(name);
        if(![source.x,source.z,source.w,source.d,floor.y].every(Number.isFinite)
          ||source.w<DOOR_SPAN+2||source.d<DOOR_SPAN+2){errors.push(name+': invalid room rectangle');continue;}
        const side=wing.side;
        const p=entry?.point;
        const correct=!!p&&(side==='E'?p.x===source.x
          :side==='W'?p.x===source.x+source.w-1
          :side==='S'?p.z===source.z
          :side==='N'?p.z===source.z+source.d-1:false);
        const across=side==='E'||side==='W'?'z':'x';
        const lo=source[across],hi=lo+source[across==='x'?'w':'d'];
        const centre=p?.[across];
        if(!correct||!Number.isInteger(centre)||centre-1<lo||centre+1>=hi){
          errors.push(name+': entrance not aligned with enclosed three-cell aperture');continue;
        }
        const pit=source.challenge==='ropeChain'?pitForRoom?.(source,side):null;
        if(source.challenge==='ropeChain'&&!pit){errors.push(name+': missing declared rope pit');continue;}
        const blocked=[]; // The one-cell-deep entrance partition leaves exactly the authored doorway unblocked.
        for(let coord=lo;coord<hi;coord++){
          if(Math.abs(coord-centre)<=1)continue;
          const x=across==='x'?coord:p.x,z=across==='z'?coord:p.z;
          blocked.push([x,z]);
        }
        const room={id:name,floor:floor.floor,y:floor.y,wingId:wing.id,side,
          theme:plan.options?.theme||null, // Used to keep diffuse Tothal lighting free of a projected room-shaped frame.
          kind:source.kind,challenge:source.challenge,x:source.x,z:source.z,w:source.w,d:source.d,
          pit,blocked,entry:{x:p.x,z:p.z,axis:across==='z'?'x':'z',span:DOOR_SPAN,
            line:across==='z'?p.x+.5:p.z+.5,across,centre,lo,hi},
          // Per-room values feed the unified darkness overlay, not additional Three.js lights.
          ambient:{darknessOffset:source.kind==='brazier-chamber' ? -.035 : 0,color:plan.options?.theme==='tothal'?[6,18,44]
            :plan.options?.theme==='hronal'?[20,7,2]:[0,0,0]},
        };
        rooms.push(room);
        doors.push({id:name+':entry',roomId:name,from:entry.from,to:name,floor:floor.floor,
          x:p.x+.5,z:p.z+.5,y:floor.y,axis:room.entry.axis,span:DOOR_SPAN,
          initiallyLocked:i>(wing.anteroom?1:0)}); // Anteroom and first puzzle are unlocked; later gates retain progression.
      }
    }
    return {rooms,doors,errors,ok:errors.length===0};
  }

  function v50Rooms(meta,{originX=0,originZ=0,tileScale=2,y=0,prefix='v50',theme='hronal',supportYAt=null}={}){
    const cs=(Number(meta?.cellSize)||.5)*tileScale; // Matches nativeRoom and the original V50 2x horizontal projection, not a second tile grid.
    const color=theme==='tothal'?[6,18,44]:theme==='hronal'?[20,7,2]:[0,0,0];
    if(!(cs>0)||!Number.isFinite(cs))return [];
    return (meta?.rooms||[]).flatMap((raw,index)=>{
      const x=originX+Number(raw.col)*cs,z=originZ+Number(raw.row)*cs;
      const w=Number(raw.w)*cs,d=Number(raw.h)*cs;
      if(![x,z,w,d,y].every(Number.isFinite)||w<=0||d<=0)return [];
      return [{id:prefix+':'+String(raw.id||index),kind:prefix==='v50-ground'?'entrance-chamber':'v50',floor:Math.round(y),theme,
        y,wingId:null,challenge:null,x,z,w,d, // Native V50 chamber footprints may be irregular; retain their exact native light projection.
        supportYAt:typeof supportYAt==='function'?supportYAt:null, // V50 uses the floor's exact plateau height when deciding which room is awake.
        ambient:{darknessOffset:0,color}}];
    });
  }
  function projectedFloorArea(data){
    const p=data?.positions;
    if(!p?.length||p.length%12!==0)return 0; // Each merged quad consists of four vertices, preserving exact floor area.
    let area=0;
    for(let i=0;i<p.length;i+=12){
      const ax=p[i+3]-p[i],az=p[i+5]-p[i+2];
      const bx=p[i+9]-p[i],bz=p[i+11]-p[i+2];
      area+=Math.abs(ax*bz-az*bx);
    }
    return area;
  }
  function floorAudit(room,supportedCells){
    let expected=0,missing=0; // Checks only required floors; a rope pit is a deliberate open volume, not a missing tile.
    for(let z=room.z;z<room.z+room.d;z++)for(let x=room.x;x<room.x+room.w;x++){
      if(room.pit?.contains?.(x+.5,z+.5))continue;
      expected++;
      if(!supportedCells.has(key(x,z)))missing++;
    }
    return {roomId:room.id,expectedFloorTiles:expected,missingFloorTiles:missing,
      ceilingTiles:room.w*room.d,partitionTiles:room.blocked.length,
      deliberateVoidTiles:room.w*room.d-expected,ok:missing===0};
  }

  function wallAudit(room,walkable,wallsX,wallsZ,shaftMouth=null){
    const xEdges=new Set((wallsX||[]).map(([x,z])=>x+','+z));
    const zEdges=new Set((wallsZ||[]).map(([x,z])=>x+','+z));
    let exposed=0,missing=0; // Checks the wall faces emitted by the wing mesher, not an unrelated rectangle outline.
    for(let z=room.z;z<room.z+room.d;z++)for(let x=room.x;x<room.x+room.w;x++){
      for(const [dx,dz,edges,ex,ez] of [
        [-1,0,zEdges,x,z+.5],[1,0,zEdges,x+1,z+.5],
        [0,-1,xEdges,x+.5,z],[0,1,xEdges,x+.5,z+1],
      ]){
        if(walkable.has(key(x+dx,z+dz)))continue; // Adjoining corridors are intentional entrances, not missing masonry.
        const exitsToShaft=shaftMouth?.has(key(x,z)) && (
          (room.side==='E'&&dx===-1)||(room.side==='W'&&dx===1)
          ||(room.side==='S'&&dz===-1)||(room.side==='N'&&dz===1));
        if(exitsToShaft)continue; // The real three-cell portal is an intentional OPENING into the shaft, not missing stone.
        exposed++;
        if(!edges.has(ex+','+ez))missing++;
      }
    }
    return {roomId:room.id,exposedWallEdges:exposed,missingWallEdges:missing,ok:missing===0};
  }
  function makeShell({room,THREE,Faces,parent,material,supportedCells,grid,CG}){
    const audit=floorAudit(room,supportedCells); // Published by the owner; missing walkable support is a hard generation error.
    if(!audit.ok)throw new Error('Ruin room '+room.id+' has '+audit.missingFloorTiles+' missing floor tiles');
    if(!THREE?.Mesh||!Faces?.buildQuads||!Faces?.toGeometry)return {audit,meshes:[]}; // Headless fixtures can audit without a renderer.
    const rects=[{axis:'y',side:-1,plane:0,a0:0,a1:room.w,b0:0,b1:room.d}];
    const roofFaces=Faces.buildQuads(rects,{
      origin:{x:room.x,y:room.y+WALL_HEIGHT,z:room.z},size:{x:1,y:1,z:1},patch:{h:6,v:6},
    });
    const covered=projectedFloorArea(roofFaces); // A ceiling advertised in the room manifest must also exist as actual triangles.
    if(Math.abs(covered-room.w*room.d)>1e-3)throw new Error(
      'Ruin room '+room.id+' has an incomplete ceiling: '+covered+' of '+room.w*room.d);
    const roof=new THREE.Mesh(Faces.toGeometry(THREE,roofFaces),material);
    roof.name='ruin-room-ceiling-'+room.id;
    roof.userData.ruinRoomId=room.id;
    roof.userData.devRuinFootprintIgnore=true; // A ceiling never creates a fake collision floor or a ground-navigation tile.
    parent.add(roof);
    const e=room.entry;
    const runs=[{along:e.across,line:e.line,from:e.lo,to:e.centre-1},
      {along:e.across,line:e.line,from:e.centre+2,to:e.hi}]
      .filter(run=>run.to>run.from);
    const wall=new THREE.Mesh(Faces.toGeometry(THREE,Faces.buildEdgeWallQuads(runs,{
      y0:room.y,y1:room.y+WALL_HEIGHT,thickness:.14,patch:{h:6,v:6},
    })),material);
    wall.name='ruin-room-entry-partition-'+room.id;
    wall.userData.ruinRoomId=room.id;
    parent.add(wall);
    if(Faces.buildEdgeCapQuads&&runs.length){ // The partition's ends are its doorway jambs: cap them so they are not open slits.
      const ends=new THREE.Mesh(Faces.toGeometry(THREE,Faces.buildEdgeCapQuads(runs,{y0:room.y,y1:room.y+WALL_HEIGHT,thickness:.14})),material);
      ends.name='ruin-room-partition-jambs-'+room.id;ends.userData.ruinRoomId=room.id;
      wall.add(ends); // Child of the partition: shares its material, visibility and disposal.
    }
    if(grid?.set&&CG?.KIND){
      for(const [x,z] of room.blocked){
        const c=grid.xToCol(x+.5),r=grid.zToRow(z+.5);
        for(let level=0;level<Math.min(4,grid.levels||4);level++)grid.set(c,r,level,CG.KIND.SOLID);
      }
    }
    return {audit,meshes:[roof,wall]};
  }

  function doorNear(player,door,wasOpen=false,playerY=player?.y){
    if(!player||!door||![player.x,player.z,door.x,door.z].every(Number.isFinite))return false;
    const floor=Number(door.y),height=Number(playerY);
    if(Number.isFinite(floor)&&Number.isFinite(height)&&Math.abs(height-floor)>WALL_HEIGHT+1)return false;
    // Preserve a traversable doorway during vertical jumps and during crossing; the open radius has hysteresis.
    return Math.hypot(player.x-door.x,player.z-door.z)<(wasOpen?3.5:2.8);
  }
  function roomAt(rooms,x,z,y){
    if(!Number.isFinite(x)||!Number.isFinite(z))return null;
    let best=null,distance=Infinity;
    for(const room of rooms){
      if(!inside(room,x,z))continue;
      const localSupport=room.supportYAt?.(x,z); // V50 uses real per-cell plateau elevation rather than the nominal room origin.
      const baseY=Number.isFinite(localSupport)?localSupport:room.y; // Flat authored rooms keep their existing floor-height ownership.
      const delta=Number.isFinite(y)?Math.abs(y-baseY):0;
      if(Number.isFinite(y)&&(y<baseY-.65||y>baseY+WALL_HEIGHT+1))continue; // Never treat an actor below the local deck as being inside the chamber.
      if(delta<distance-1e-6||(Math.abs(delta-distance)<=1e-6&&(!best||room.w*room.d<best.w*best.d))){
        best=room;distance=delta; // A nested V50 puzzle chamber wins over its containing hall at the same elevation.
      }
    }
    return best;
  }

  function roomLightFootprint(room,project){
    if(!room?.wingId||typeof project!=='function')return null; // Only rectangular generated-wing rooms use this geometry; irregular native V50 floors do not.
    const inset=.1,levels=[room.y+.05,room.y+WALL_HEIGHT-.05]; // Bound the lit room from floor to wall top, not just a slice through a player's torso.
    const corners=[[room.x+inset,room.z+inset],[room.x+room.w-inset,room.z+inset],
      [room.x+room.w-inset,room.z+room.d-inset],[room.x+inset,room.z+room.d-inset]];
    const projected=[]; // Eight actual wall-volume corners bound local light only; the 7% full-screen tradition tint never uses this path.
    for(const y of levels)for(const [x,z] of corners){
      const p=project(x,y,z);
      if(!Number.isFinite(p?.x)||!Number.isFinite(p?.y))return null;
      projected.push({x:p.x,y:p.y});
    }
    projected.sort((a,b)=>a.x-b.x||a.y-b.y);
    const turn=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    const lower=[],upper=[]; // Convex hull covers both wall heights under the angled camera without per-light clipping.
    for(const p of projected){
      while(lower.length>1&&turn(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();
      lower.push(p);
    }
    for(let i=projected.length-1;i>=0;i--){
      const p=projected[i];
      while(upper.length>1&&turn(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();
      upper.push(p);
    }
    const hull=lower.slice(0,-1).concat(upper.slice(0,-1));
    if(hull.length<3)return null;
    let area=0; // Degenerate camera projections should not extinguish every lamp.
    for(let i=0;i<hull.length;i++)area+=hull[i].x*hull[(i+1)%hull.length].y-hull[(i+1)%hull.length].x*hull[i].y;
    return Math.abs(area)>.1?hull:null;
  }

  function visual(record,show){
    if(show){
      for(const [node,original] of record.hidden||[])node.visible=original;
      record.hidden=[];return;
    }
    const entity=record.enemy;
    record.hidden=[]; // Save each component's real state: waking a naturally invisible enemy must not reveal it.
    for(const node of [entity.avatarRef?.group,entity.groundShadow,entity._banditToolHolder,
      entity._banditRangedToolHolder,entity._banditTrailMesh]){
      if(!node)continue;
      record.hidden.push([node,node.visible]);node.visible=false;
    }
  }
  function resetHostile(entity,home){
    entity.x=home.x;entity.y=home.y;
    entity.vx=0;entity.vy=0;entity.state='idle';entity.targetPlayer=null;
    entity._chunkCombatTarget=null;entity._banditAction=null;entity._banditLunging=false;
    entity._rangedAction=null;entity.telegraphState=null;entity.wanderTarget={x:home.x,y:home.y};
    if(entity.avatarRef?.group?.position){
      entity.avatarRef.group.position.x=home.x/home.tile;
      entity.avatarRef.group.position.z=home.y/home.tile;
    }
  }
  function mount({layout,getPlayerPosition,getPlayerY,getHostiles,getWalkers,mapId='map_i_dev_random_ruin',tile=64,onRoomChange}={}){
    if(live)live.dispose(); // No room-owned hostiles or compositor masks leak across a ruin reroll.
    const rooms=[...(layout?.rooms||[])],ownership=new Map(); // Tracks each spawned hostile's original map, room and spawn tile.
    const walkersOwnership=new Map(); // Holds only actual ruin NPC walkers, independent of wilderness/town scheduling.
    let active=null,clock=PROBE_PERIOD,transitions=0,resets=0,disposed=false; // Room ownership is reused by lighting and encounter suspension without projecting room boxes.
    // All traditions use source-to-room ownership and a steady viewport overlay; a projected room hull
    // was the camera-moving coloured tunnel frame, not a necessary part of room light isolation.
    const byId=new Map(rooms.map(r=>[r.id,r])); // O(1) stable room-id lookup for encounters and diagnostics.
    const lookup=(x,z,y)=>roomAt(rooms,x,z,y);
    const shaft=layout?.shaft; // The generated shaft is one vertical visual region, distinct from every room and corridor.
    const glyphBounds=new Map(); // Cached region extents: a broad wall may belong to more than one room.
    function registerGlyphBounds(room){
      let low=room.y,high=room.y;
      if(room.supportYAt)for(let z=Math.floor(room.z);z<room.z+room.d;z++)for(let x=Math.floor(room.x);x<room.x+room.w;x++){
        const h=room.supportYAt(x+.5,z+.5);if(Number.isFinite(h)){low=Math.min(low,h);high=Math.max(high,h);}
      }
      glyphBounds.set('room:'+room.id,{minX:room.x-.16,maxX:room.x+room.w+.16,minZ:room.z-.16,maxZ:room.z+room.d+.16,minY:low-.65,maxY:high+WALL_HEIGHT+1});
    }
    if(shaft)glyphBounds.set('shaft',{minX:shaft.x-.16,maxX:shaft.x+shaft.w+.16,minZ:shaft.z-.16,maxZ:shaft.z+shaft.d+.16,minY:-Infinity,maxY:Infinity});
    function glyphRegionAt(x,y,z){
      if(![x,y,z].every(Number.isFinite))return null;
      const room=lookup(x,z,y);
      if(room)return 'room:'+room.id;
      return shaft&&inside(shaft,x,z)?'shaft':null; // Unowned corridors never activate unrelated glyphs.
    }
    const sleepingArea=SLEEP_AREA+mapId;
    function wake(record){
      if(!record.sleeping)return;
      record.enemy.areaId=record.originalArea;
      record.sleeping=false;visual(record,true);
    }
    function sleep(record){
      if(record.sleeping)return;
      const enemy=record.enemy;
      if((Number(enemy.health)||0)<=0)return;
      resetHostile(enemy,record.home);
      enemy.areaId=sleepingArea;record.sleeping=true;visual(record,false);resets++;
    }
    function scanHostiles(){
      const hostiles=getHostiles?.()||root.Combat?.deps?.hostileObjects;
      if(!hostiles)return;
      for(const enemy of hostiles){
        if(!enemy||(Number(enemy.health)||0)<=0||ownership.has(enemy))continue;
        if(enemy.areaId!==mapId&&enemy.zoneId!==mapId)continue;
        const x=Number(enemy.x)/tile,z=Number(enemy.y)/tile;
        const entityY=Number(enemy.surfaceYOverride?.()??enemy.avatarRef?.group?.position?.y??getPlayerY?.());
        const room=lookup(x,z,entityY);
        if(!room)continue;
        const homeX=Number.isFinite(Number(enemy.homeX))?Number(enemy.homeX):Number(enemy.x);
        const homeY=Number.isFinite(Number(enemy.homeY))?Number(enemy.homeY):Number(enemy.y);
        ownership.set(enemy,{enemy,id:room.id,originalArea:enemy.areaId,
          home:{x:homeX,y:homeY,tile},sleeping:false});
      }
      for(const [enemy,record] of ownership){
        if((Number(enemy.health)||0)<=0||!hostiles.has?.(enemy)){ownership.delete(enemy);continue;}
        if(record.id===active?.id)wake(record);
        else sleep(record);
      }
    }
    function scanWalkers(){
      const collection=getWalkers?.()||root._npcWalkers||[];
      const walkers=typeof collection.values==='function'?collection.values():collection;
      if(!walkers?.[Symbol.iterator])return;
      const alive=new Set(); // Removes deleted walker references from this small ruin-only ownership set.
      for(const walker of walkers){
        if(!walker?.root?.position)continue;
        alive.add(walker);
        if(walkersOwnership.has(walker)||walker.area!==mapId)continue;
        const p=walker.root.position,room=lookup(Number(p.x),Number(p.z),Number(p.y));
        if(!room)continue;
        walkersOwnership.set(walker,{id:room.id,area:walker.area,
          originallyVisible:walker.root.visible!==false,sleeping:false});
      }
      for(const [walker,record] of walkersOwnership){
        if(!alive.has(walker)){walkersOwnership.delete(walker);continue;}
        if(walker.area!==record.area&&walker.area!==sleepingArea){
          if(record.sleeping)walker.root.visible=record.originallyVisible;
          walkersOwnership.delete(walker);continue; // Respect an authored transfer to another map.
        }
        const shouldWake=record.id===active?.id;
        if(shouldWake&&record.sleeping){
          walker.area=record.area;walker.root.visible=record.originallyVisible;record.sleeping=false;
        }else if(!shouldWake&&!record.sleeping){
          walker.area=sleepingArea;walker.root.visible=false;record.sleeping=true;
        }
      }
    }
    const session={
      rooms,layout,
      addRooms(additional){
        for(const room of additional||[]){
          if(!room?.id||byId.has(room.id))continue;
          rooms.push(room);byId.set(room.id,room);
          root.CloudForestFog?.invalidateKanthicGlyphs?.();
        }
      }, // Native V50 upper stories are registered after their meshes are mounted in the same scene.
      get activeRoomId(){return active?.id||null;},
      isRoomActive(id){return !!active&&active.id===id;},
      ambient(){
        if(!active?.ambient)return null;
        let illumination=0; // Stable per-room illumination lift used only by the full-viewport darkness pass.
        const kanthic=(active.theme||root.DevRandomRuinLichThemes?.activeTheme?.()||root.DevRandomRuin?.getRuntimeContext?.()?.theme)==='kanthic';
        for(const sources of [
          root.DevRandomRuinLichThemes?.lightSources?.()||[],
          root.RuinLayerPlayable?.roomLights?.()||[],
          root.RuinMultifloorV50Style?.lightSources?.()||[],
          root.DevRandomRuinSanctum?.lightSources?.()||[], // Lit sanctum braziers and its temporary reveal source lift only their room's ambient darkness.
        ])for(const source of sources){
          if(kanthic&&source?.flameAnchor)continue; // Braziers must never brighten the whole Kanthic chamber.
          if(source?.active===false||!Number.isFinite(source?.x)||!Number.isFinite(source?.z)
            ||!Number.isFinite(source?.y)||!inside(active,source.x,source.z))continue;
          if(source.y<active.y-.65||source.y>active.y+WALL_HEIGHT+1)continue;
          illumination=Math.max(illumination,Math.min(1,Math.max(0,Number(source.strength)||0)));
        }
        return {...active.ambient,
          darknessOffset:(active.ambient.darknessOffset||0)-illumination*.13,
          illumination,roomId:active.id}; // Only lit sources in the occupied room reduce its darkness uniformly.
      },
      roomAt:lookup,
      glyphRegionAt,
      glyphRegionBounds(id){
        if(!glyphBounds.has(id)&&typeof id==='string'&&id.startsWith('room:')){
          const room=byId.get(id.slice(5));if(room)registerGlyphBounds(room);
        }
        return glyphBounds.get(id)||null; // Build only a room the player actually visits, not every native room at startup.
      },
      activeGlyphRegion(){const p=getPlayerPosition?.();return p?glyphRegionAt(p.x,Number(getPlayerY?.()),p.z):null;},
      prepareLightClip(){}, // Compatibility hook: the full-screen tint has no projected box or feathered contour.
      withLightRegion(_ctx,_project,draw){
        if(typeof draw!=='function')return false;
        draw(); // No projected room-volume polygon in Hronal, Tothal OR Kanthic; sources are still room-owned.
        return true;
      },
      roomGlowRadius(light,radius){
        const desired=Number(radius),x=Number(light?.x),z=Number(light?.z),y=Number(light?.y);
        if(!(desired>0)||!active?.wingId||!Number.isFinite(x)||!Number.isFinite(z)
          ||!Number.isFinite(y)||!inside(active,x,z)
          ||y<active.y-.65||y>active.y+WALL_HEIGHT+1)return radius;
        const edge=Math.min(x-active.x,active.x+active.w-x,z-active.z,active.z+active.d-z);
        return Math.min(desired,Math.max(.1,edge-.1)); // After source-room filtering, use the active rectangle directly: no second all-room scan per light.
      },
      lightAllowed(light){
        const source=lookup(Number(light?.x),Number(light?.z),Number(light?.y));
        return active?source?.id===active.id:!source; // Sources in other rooms stay dormant; no visible rectangular light cutoffs.
      },
      withLightClip(_ctx,light,_project,draw){
        if(!session.lightAllowed(light)||typeof draw!=='function')return false;
        draw(); // Compatibility name only: ordinary radial light pools remain unclipped by the old room bounding box.
        return true;
      },
      tick(dt){
        if(disposed)return;
        const p=getPlayerPosition?.(),y=Number(getPlayerY?.());
        const next=p?lookup(p.x,p.z,y):null;
        if(next?.id!==active?.id){
          active=next;transitions++;
          scanHostiles();scanWalkers();clock=0; // Room transitions also freeze off-room civilian NPC walkers immediately.
          onRoomChange?.(active?.id||null);
          root.CloudForestFog?.refreshLightingOverlay?.();
        }
        clock+=Math.max(0,Number(dt)||0);
        if(clock>=PROBE_PERIOD){clock=0;scanHostiles();scanWalkers();}
      },
      dispose(){
        if(disposed)return;disposed=true;
        for(const record of ownership.values())if(record.sleeping)wake(record);
        ownership.clear();
        for(const [walker,record] of walkersOwnership){
          if(!record.sleeping)continue;
          walker.area=record.area;walker.root.visible=record.originallyVisible;
        }
        walkersOwnership.clear();if(live===session)live=null;
        root.CloudForestFog?.invalidateKanthicGlyphs?.();
      },
      snapshot(){return {activeRoomId:active?.id||null,totalRooms:rooms.length,
        sleepingEnemies:[...ownership.values()].filter(r=>r.sleeping).length,
        sleepingNpcWalkers:[...walkersOwnership.values()].filter(r=>r.sleeping).length,
        assignedEnemies:ownership.size,transitions,resets,errors:layout?.errors||[],
        lightClip:{mode:'full-screen-tint',featherPx:0,feathered:false,bands:0,canvasPasses:0,passBudget:0,budgetDowngrades:0},
        localLightBoundary:{mode:active?.theme==='kanthic'?'unclipped-kanthic-screen-overlay':active?.theme==='tothal'?'unclipped-tothal-overcast':'unclipped-hronal-screen-overlay',
          active:false,roomIsolated:!!active,canvasPasses:0,illumination:session.ambient()?.illumination||0}};},
    };
    live=session;root.CloudForestFog?.invalidateKanthicGlyphs?.();
    return session;
  }
  return Object.freeze({DOOR_SPAN,WALL_HEIGHT,planRooms,v50Rooms,projectedFloorArea,floorAudit,wallAudit,makeShell,roomAt,doorNear,mount,
    mounted:()=>!!live,
    isRoomActive:id=>live?.isRoomActive(id)===true,
    ambient:()=>live?.ambient()||null,
    glyphRegionAt:(x,y,z)=>live?.glyphRegionAt(x,y,z)||null,
    activeGlyphRegion:()=>live?.activeGlyphRegion()||null,
    glyphRegionBounds:id=>live?.glyphRegionBounds(id)||null,
    lightAllowed:source=>live?live.lightAllowed(source):true,
    withLightClip:(ctx,light,project,draw)=>live?live.withLightClip(ctx,light,project,draw):(draw(),true),
    withLightRegion:(ctx,project,draw)=>live?live.withLightRegion(ctx,project,draw):(typeof draw==='function'?(draw(),true):false),
    roomGlowRadius:(source,radius)=>live?live.roomGlowRadius(source,radius):radius,
    prepareLightClip:project=>live?.prepareLightClip(project),
    debugSnapshot:()=>live?.snapshot()||{activeRoomId:null,totalRooms:0,sleepingEnemies:0}});
});
