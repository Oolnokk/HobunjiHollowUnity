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
      for(let i=0;i<wing.rooms.length;i++){
        const source=wing.rooms[i],name=String(source.id||'');
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
          initiallyLocked:i>0});
      }
    }
    return {rooms,doors,errors,ok:errors.length===0};
  }

  function v50Rooms(meta,{originX=0,originZ=0,tileScale=2,y=0,prefix='v50',theme='hronal'}={}){
    const cs=(Number(meta?.cellSize)||.5)*tileScale; // Matches nativeRoom and the original V50 2x horizontal projection, not a second tile grid.
    const color=theme==='tothal'?[6,18,44]:theme==='hronal'?[20,7,2]:[0,0,0];
    if(!(cs>0)||!Number.isFinite(cs))return [];
    return (meta?.rooms||[]).flatMap((raw,index)=>{
      const x=originX+Number(raw.col)*cs,z=originZ+Number(raw.row)*cs;
      const w=Number(raw.w)*cs,d=Number(raw.h)*cs;
      if(![x,z,w,d,y].every(Number.isFinite)||w<=0||d<=0)return [];
      return [{id:prefix+':'+String(raw.id||index),kind:'v50',floor:Math.round(y),
        y,wingId:null,challenge:null,x,z,w,d,ambient:{darknessOffset:0,color}}];
    });
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

  function makeShell({room,THREE,Faces,parent,material,supportedCells,grid,CG}){
    const audit=floorAudit(room,supportedCells); // Published by the owner; missing walkable support is a hard generation error.
    if(!audit.ok)throw new Error('Ruin room '+room.id+' has '+audit.missingFloorTiles+' missing floor tiles');
    if(!THREE?.Mesh||!Faces?.buildQuads||!Faces?.toGeometry)return {audit,meshes:[]}; // Headless fixtures can audit without a renderer.
    const rects=[{axis:'y',side:-1,plane:0,a0:0,a1:room.w,b0:0,b1:room.d}];
    const roof=new THREE.Mesh(Faces.toGeometry(THREE,Faces.buildQuads(rects,{
      origin:{x:room.x,y:room.y+WALL_HEIGHT,z:room.z},size:{x:1,y:1,z:1},
      patch:{h:6,v:6},
    })),material);
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
    if(grid?.set&&CG?.KIND){
      for(const [x,z] of room.blocked){
        const c=grid.xToCol(x+.5),r=grid.zToRow(z+.5);
        for(let level=0;level<Math.min(4,grid.levels||4);level++)grid.set(c,r,level,CG.KIND.SOLID);
      }
    }
    return {audit,meshes:[roof,wall]};
  }

  function roomAt(rooms,x,z,y){
    if(!Number.isFinite(x)||!Number.isFinite(z))return null;
    let best=null,distance=Infinity;
    for(const room of rooms){
      if(!inside(room,x,z))continue;
      const delta=Number.isFinite(y)?Math.abs(y-room.y):0;
      if(delta<distance&&delta<=WALL_HEIGHT+.65){best=room;distance=delta;}
    }
    return best;
  }

  function visual(entity,show){
    if(entity.avatarRef?.group)entity.avatarRef.group.visible=show;
    if(entity.groundShadow)entity.groundShadow.visible=show;
    if(entity._banditToolHolder)entity._banditToolHolder.visible=show;
    if(entity._banditRangedToolHolder)entity._banditRangedToolHolder.visible=show&&!!entity._rangedMode;
    if(!show&&entity._banditTrailMesh)entity._banditTrailMesh.visible=false;
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
  function mount({layout,getPlayerPosition,getPlayerY,getHostiles,mapId='map_i_dev_random_ruin',tile=64,onRoomChange}={}){
    if(live)live.dispose(); // No room-owned hostiles or compositor masks leak across a ruin reroll.
    const rooms=[...(layout?.rooms||[])],ownership=new Map(); // Tracks each spawned hostile's original map, room and spawn tile.
    let active=null,clock=PROBE_PERIOD,transitions=0,resets=0,disposed=false;
    const byId=new Map(rooms.map(r=>[r.id,r])); // O(1) stable room-id lookup for encounters and diagnostics.
    const lookup=(x,z,y)=>roomAt(rooms,x,z,y);
    const sleepingArea=SLEEP_AREA+mapId;
    function wake(record){
      if(!record.sleeping)return;
      record.enemy.areaId=record.originalArea;
      record.sleeping=false;visual(record.enemy,true);
    }
    function sleep(record){
      if(record.sleeping)return;
      const enemy=record.enemy;
      if((Number(enemy.health)||0)<=0)return;
      resetHostile(enemy,record.home);
      enemy.areaId=sleepingArea;record.sleeping=true;visual(enemy,false);resets++;
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
    const session={
      rooms,layout,
      addRooms(additional){
        for(const room of additional||[]){
          if(!room?.id||byId.has(room.id))continue;
          rooms.push(room);byId.set(room.id,room);
        }
      }, // Native V50 upper stories are registered after their meshes are mounted in the same scene.
      get activeRoomId(){return active?.id||null;},
      isRoomActive(id){return !!active&&active.id===id;},
      ambient(){return active?.ambient||null;}, // Read by the unified overlay, preserving its accessibility-adjusted base darkness.
      roomAt:lookup,
      lightAllowed(light){
        const source=lookup(Number(light?.x),Number(light?.z),Number(light?.y));
        return active?source?.id===active.id:!source; // Closed rooms and the shaft cannot light each other.
      },
      withLightClip(ctx,light,project,draw){
        if(!session.lightAllowed(light))return false;
        const room=lookup(Number(light?.x),Number(light?.z),Number(light?.y));
        if(!room||!ctx?.save||!ctx?.clip||typeof project!=='function'){draw();return true;}
        // Convex hull of the projected room prism encloses walls as well as the floor.
        const p=[];
        for(const y of [room.y-.15,room.y+WALL_HEIGHT+.1])
          for(const x of [room.x,room.x+room.w])
            for(const z of [room.z,room.z+room.d]){
              const v=project(x,y,z);if(Number.isFinite(v?.x)&&Number.isFinite(v?.y))p.push(v);
            }
        if(p.length<3){draw();return true;}
        p.sort((a,b)=>a.x-b.x||a.y-b.y);
        const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
        const hull=[]; // Eight projected corners; avoids expensive mesh/scene searches on the lighting pass.
        for(const q of p){while(hull.length>=2&&cross(hull[hull.length-2],hull[hull.length-1],q)<=0)hull.pop();hull.push(q);}
        const lower=hull.length;
        for(let i=p.length-2;i>=0;i--){const q=p[i];while(hull.length>lower&&cross(hull[hull.length-2],hull[hull.length-1],q)<=0)hull.pop();hull.push(q);}
        hull.pop();
        ctx.save();
        try{
          ctx.beginPath();ctx.moveTo(hull[0].x,hull[0].y);
          for(let i=1;i<hull.length;i++)ctx.lineTo(hull[i].x,hull[i].y);
          ctx.closePath();ctx.clip();draw();
        }finally{ctx.restore();}
        return true;
      },
      tick(dt){
        if(disposed)return;
        const p=getPlayerPosition?.(),y=Number(getPlayerY?.());
        const next=p?lookup(p.x,p.z,y):null;
        if(next?.id!==active?.id){
          active=next;transitions++;
          onRoomChange?.(active?.id||null);
          root.CloudForestFog?.refreshLightingOverlay?.();
        }
        clock+=Math.max(0,Number(dt)||0);
        if(clock>=PROBE_PERIOD){clock=0;scanHostiles();}
      },
      dispose(){
        if(disposed)return;disposed=true;
        for(const record of ownership.values())if(record.sleeping)wake(record);
        ownership.clear();if(live===session)live=null;
      },
      snapshot(){return {activeRoomId:active?.id||null,totalRooms:rooms.length,
        sleepingEnemies:[...ownership.values()].filter(r=>r.sleeping).length,
        assignedEnemies:ownership.size,transitions,resets,errors:layout?.errors||[]};},
    };
    live=session;
    return session;
  }
  return Object.freeze({DOOR_SPAN,WALL_HEIGHT,planRooms,v50Rooms,floorAudit,makeShell,roomAt,mount,
    isRoomActive:id=>live?.isRoomActive(id)===true,
    ambient:()=>live?.ambient()||null,
    lightAllowed:source=>live?live.lightAllowed(source):true,
    withLightClip:(ctx,light,project,draw)=>live?live.withLightClip(ctx,light,project,draw):(draw(),true),
    debugSnapshot:()=>live?.snapshot()||{activeRoomId:null,totalRooms:0,sleepingEnemies:0}});
});
